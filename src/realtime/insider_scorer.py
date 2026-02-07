"""
Async insider scoring pipeline.

Runs independently from the main trade processor.
Reads from live_trades, scores trades with 6 insider signals,
writes high-scoring trades to insider_alerts table.

Zero coupling with trade_processor.py or wallet_discovery.py.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import aiohttp
from supabase import create_client, Client

logger = logging.getLogger(__name__)


class InsiderScorer:
    """
    Scores trades from live_trades using 6 insider signals.

    Signals:
    1. Wallet Age (20%) — fresh wallets score higher
    2. Size vs Liquidity (20%) — trade size relative to market volume
    3. Market Niche (15%) — low-volume markets score higher
    4. Extreme Odds (20%) — buying <10% or >90% with size
    5. Directional Conviction (15%) — one-sided trading on same market
    6. Category Win Rate (10%) — from wallets table if available
    """

    POLL_INTERVAL = 3.0
    SCORE_THRESHOLD = 50
    CLEANUP_INTERVAL_SECONDS = 3600
    ALERT_RETENTION_DAYS = 30

    # Signal weights (must sum to 1.0)
    W_WALLET_AGE = 0.20
    W_SIZE_LIQUIDITY = 0.20
    W_MARKET_NICHE = 0.15
    W_EXTREME_ODDS = 0.20
    W_CONVICTION = 0.15
    W_CATEGORY_WINRATE = 0.10

    # Cache TTLs
    WALLET_AGE_CACHE_TTL = 86400  # 24h
    MARKET_VOL_CACHE_TTL = 3600   # 1h
    WALLETS_CACHE_TTL = 300       # 5min

    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self._running = False
        self._session: Optional[aiohttp.ClientSession] = None

        # Caches
        self._wallet_age_cache: dict[str, tuple[int, int, float]] = {}  # addr -> (age_days, nonce, cached_at)
        self._market_vol_cache: dict[str, tuple[float, float]] = {}     # condition_id -> (daily_vol, cached_at)
        self._wallets_cache: dict[str, dict] = {}                       # addr -> wallet row
        self._wallets_cache_time: float = 0

        # Session conviction tracking: addr:condition_id -> list of sides
        self._conviction_cache: dict[str, list[str]] = {}

        # Track last processed trade ID
        self._last_id: int = 0

        # Stats
        self._trades_scored = 0
        self._alerts_written = 0
        self._errors = 0

    async def _ensure_session(self) -> None:
        if not self._session or self._session.closed:
            self._session = aiohttp.ClientSession()

    async def _close_session(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def run(self) -> None:
        """Main loop: poll live_trades, score, write insider_alerts."""
        self._running = True
        logger.info("Insider scorer starting...")

        await self._ensure_session()
        await self._load_wallets_cache()

        # Get last processed ID from insider_alerts
        try:
            result = self.supabase.table("insider_alerts").select("id").order(
                "id", desc=True
            ).limit(1).execute()
            # We track by live_trades.id, not insider_alerts.id
            # Start from the latest trade in live_trades
        except Exception:
            pass

        # Get current max ID from live_trades to start from
        try:
            result = self.supabase.table("live_trades").select("id").order(
                "id", desc=True
            ).limit(1).execute()
            if result.data:
                self._last_id = result.data[0]["id"]
                logger.info(f"Starting from live_trades id={self._last_id}")
        except Exception as e:
            logger.warning(f"Failed to get last trade ID: {e}")

        last_cleanup = datetime.now(timezone.utc)
        logger.info("Insider scorer running")

        while self._running:
            try:
                # Poll for new trades
                new_trades = self._fetch_new_trades()

                for trade in new_trades:
                    try:
                        # Skip tiny trades — insiders don't bet $50
                        if float(trade.get("usd_value", 0)) < 200:
                            self._last_id = max(self._last_id, trade.get("id", self._last_id))
                            continue

                        score, signals, details = await self._score_trade(trade)

                        if score >= self.SCORE_THRESHOLD:
                            profitability = self._get_profitability(trade["trader_address"])
                            await self._write_alert(trade, score, signals, details, profitability)

                        self._trades_scored += 1
                        self._last_id = max(self._last_id, trade["id"])

                    except Exception as e:
                        logger.error(f"Error scoring trade {trade.get('trade_id', '?')}: {e}")
                        self._errors += 1
                        self._last_id = max(self._last_id, trade.get("id", self._last_id))

                # Refresh wallets cache periodically
                now_ts = datetime.now(timezone.utc).timestamp()
                if now_ts - self._wallets_cache_time > self.WALLETS_CACHE_TTL:
                    await self._load_wallets_cache()

                # Cleanup old alerts periodically
                now = datetime.now(timezone.utc)
                if (now - last_cleanup).total_seconds() > self.CLEANUP_INTERVAL_SECONDS:
                    await self._cleanup_old_alerts()
                    last_cleanup = now

                await asyncio.sleep(self.POLL_INTERVAL)

            except asyncio.CancelledError:
                logger.info("Insider scorer stopped")
                break
            except Exception as e:
                logger.error(f"Insider scorer error: {e}")
                self._errors += 1
                await asyncio.sleep(self.POLL_INTERVAL)

        await self._close_session()

    def _fetch_new_trades(self) -> list[dict]:
        """Fetch trades from live_trades with id > last_id."""
        try:
            result = (
                self.supabase.table("live_trades")
                .select("*")
                .gt("id", self._last_id)
                .order("id", desc=False)
                .limit(100)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to fetch trades: {e}")
            self._errors += 1
            return []

    async def _score_trade(self, trade: dict) -> tuple[int, list[str], dict]:
        """
        Score a trade using 6 insider signals.

        Returns (composite_score, signal_labels, per_signal_details).
        """
        addr = trade["trader_address"].lower()
        condition_id = trade.get("condition_id", "")
        price = float(trade.get("price", 0.5))
        usd_value = float(trade.get("usd_value", 0))

        # Signal 1: Wallet Age
        age_days, nonce = await self._get_wallet_age(addr)
        s1 = self._score_wallet_age(age_days, nonce)

        # Signal 2: Size vs Liquidity
        market_vol = await self._get_market_daily_volume(condition_id, trade.get("market_slug"))
        s2 = self._score_size_vs_liquidity(usd_value, market_vol)

        # Signal 3: Market Niche
        s3 = self._score_market_niche(market_vol)

        # Signal 4: Extreme Odds
        side = trade.get("side", "BUY")
        s4 = self._score_extreme_odds(price, usd_value, side)

        # Signal 5: Directional Conviction
        self._track_conviction(addr, condition_id, side)
        s5 = self._score_conviction(addr, condition_id)

        # Signal 6: Category Win Rate
        s6 = self._score_category_winrate(addr)

        # Composite score
        composite = int(
            s1 * self.W_WALLET_AGE +
            s2 * self.W_SIZE_LIQUIDITY +
            s3 * self.W_MARKET_NICHE +
            s4 * self.W_EXTREME_ODDS +
            s5 * self.W_CONVICTION +
            s6 * self.W_CATEGORY_WINRATE
        )

        # Build signal labels
        signals = []
        if s1 >= 60:
            signals.append("Fresh Wallet")
        if s2 >= 60:
            signals.append("Oversized")
        if s3 >= 60:
            signals.append("Niche Market")
        if s4 >= 60:
            signals.append("Extreme Odds")
        if s5 >= 60:
            signals.append("High Conviction")
        if s6 >= 60:
            signals.append("Category Expert")

        details = {
            "score_wallet_age": s1,
            "score_size_vs_liquidity": s2,
            "score_market_niche": s3,
            "score_extreme_odds": s4,
            "score_conviction": s5,
            "score_category_winrate": s6,
            "wallet_age_days": age_days,
            "wallet_nonce": nonce,
            "market_daily_volume": market_vol,
        }

        return composite, signals, details

    # ---- Signal Scoring Functions ----

    @staticmethod
    def _score_wallet_age(age_days: int, nonce: int) -> int:
        """Score 0-100 based on wallet age and transaction count."""
        # Age component
        if age_days <= 1:
            age_score = 100
        elif age_days <= 7:
            age_score = 70
        elif age_days <= 30:
            age_score = 30
        else:
            age_score = 0

        # Nonce component (low transaction count = suspicious)
        if nonce <= 5:
            nonce_score = 100
        elif nonce <= 20:
            nonce_score = 60
        elif nonce <= 50:
            nonce_score = 20
        else:
            nonce_score = 0

        # Blend: 60% age, 40% nonce
        return int(age_score * 0.6 + nonce_score * 0.4)

    @staticmethod
    def _score_size_vs_liquidity(usd_value: float, market_daily_vol: float) -> int:
        """Score 0-100 based on trade size relative to market daily volume."""
        if market_daily_vol <= 0:
            return 50  # Unknown market volume — neutral

        ratio = usd_value / market_daily_vol
        if ratio > 0.20:
            return 100
        elif ratio > 0.10:
            return 70
        elif ratio > 0.05:
            return 40
        else:
            return 0

    @staticmethod
    def _score_market_niche(market_daily_vol: float) -> int:
        """Score 0-100 based on how niche/low-volume the market is."""
        if market_daily_vol <= 0:
            return 50  # Unknown

        if market_daily_vol < 10000:
            return 100
        elif market_daily_vol < 50000:
            return 70
        elif market_daily_vol < 200000:
            return 30
        else:
            return 0

    @staticmethod
    def _score_extreme_odds(price: float, usd_value: float, side: str = "BUY") -> int:
        """
        Score 0-100 based on trading at extreme odds with size.

        Key insight: buying LONGSHOT bets (<15%) is the real insider signal.
        Buying at >85% is normal safe-betting behavior, not suspicious.
        Selling a "sure thing" (>85%) with size = insider knows it won't happen.
        """
        if usd_value < 500:
            return 0

        # BUY at very low odds = insider buying longshot (knows outcome)
        if side == "BUY" and price <= 0.10:
            if usd_value >= 5000:
                return 100
            elif usd_value >= 1000:
                return 80
            else:
                return 60
        elif side == "BUY" and price <= 0.20:
            if usd_value >= 5000:
                return 70
            elif usd_value >= 1000:
                return 40
            else:
                return 0

        # SELL at high odds = insider dumping "sure thing" (knows it won't happen)
        if side == "SELL" and price >= 0.85:
            if usd_value >= 5000:
                return 80
            elif usd_value >= 1000:
                return 50
            else:
                return 0

        # Buying at high odds (>85%) is normal behavior — not suspicious
        return 0

    def _score_conviction(self, addr: str, condition_id: str) -> int:
        """Score 0-100 based on directional conviction on this market."""
        key = f"{addr}:{condition_id}"
        sides = self._conviction_cache.get(key, [])

        if len(sides) < 2:
            return 0  # Not enough data

        total = len(sides)
        buy_count = sides.count("BUY")
        sell_count = sides.count("SELL")
        dominant = max(buy_count, sell_count)
        ratio = dominant / total

        if ratio >= 1.0 and total >= 3:
            return 100
        elif ratio >= 0.90 and total >= 3:
            return 60
        elif ratio >= 0.80 and total >= 5:
            return 30
        else:
            return 0

    def _score_category_winrate(self, addr: str) -> int:
        """Score 0-100 based on historical win rate from wallets table."""
        wallet = self._wallets_cache.get(addr.lower())
        if not wallet:
            return 0  # Unknown trader

        win_rate = wallet.get("win_rate_all", 0) or 0
        trade_count = wallet.get("trade_count_all", 0) or 0

        # Need minimum trades for win rate to be meaningful
        if trade_count < 10:
            return 0

        if win_rate >= 90:
            return 100
        elif win_rate >= 80:
            return 60
        elif win_rate >= 70:
            return 30
        else:
            return 0

    # ---- Data Fetching ----

    async def _get_wallet_age(self, address: str) -> tuple[int, int]:
        """
        Get wallet age in days and nonce count.

        Priority:
        1. Cache
        2. wallets table (account_created_at)
        3. Polygon RPC (nonce-based estimate)
        """
        now_ts = datetime.now(timezone.utc).timestamp()

        # Check cache
        if address in self._wallet_age_cache:
            age, nonce, cached_at = self._wallet_age_cache[address]
            if now_ts - cached_at < self.WALLET_AGE_CACHE_TTL:
                return age, nonce

        # Check wallets table
        wallet = self._wallets_cache.get(address)
        if wallet:
            trade_count = wallet.get("trade_count_all", 0) or wallet.get("total_trades", 0) or 0
            created_at = wallet.get("account_created_at")
            if created_at:
                try:
                    created = datetime.fromisoformat(
                        str(created_at).replace("Z", "+00:00")
                    )
                    age_days = (datetime.now(timezone.utc) - created).days
                    nonce = trade_count
                    self._wallet_age_cache[address] = (age_days, nonce, now_ts)
                    return age_days, nonce
                except Exception:
                    pass

            # Wallet is in our DB with trades but no created_at date
            # Polymarket proxy wallets have low on-chain nonce (CLOB trades are off-chain)
            # so Polygon RPC is unreliable. Use trade count as the activity indicator.
            if trade_count > 20:
                self._wallet_age_cache[address] = (365, trade_count, now_ts)
                return 365, trade_count

        # Fallback: Polygon RPC (only for wallets NOT in our DB)
        try:
            nonce = await self._polygon_get_nonce(address)
            # Estimate age from nonce
            if nonce <= 5:
                age_days = 1  # Very new
            elif nonce <= 20:
                age_days = 7
            elif nonce <= 100:
                age_days = 30
            else:
                age_days = 90
            self._wallet_age_cache[address] = (age_days, nonce, now_ts)
            return age_days, nonce
        except Exception as e:
            logger.debug(f"Polygon RPC failed for {address[:10]}: {e}")
            # Default: assume established wallet
            self._wallet_age_cache[address] = (90, 100, now_ts)
            return 90, 100

    async def _polygon_get_nonce(self, address: str) -> int:
        """Get transaction count from Polygon RPC."""
        await self._ensure_session()
        try:
            async with self._session.post(
                "https://polygon-rpc.com",
                json={
                    "jsonrpc": "2.0",
                    "method": "eth_getTransactionCount",
                    "params": [address, "latest"],
                    "id": 1,
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    return 100  # Default to established
                data = await resp.json()
                hex_count = data.get("result", "0x0")
                return int(hex_count, 16)
        except Exception:
            return 100  # Default to established on error

    async def _get_market_daily_volume(self, condition_id: str, market_slug: Optional[str] = None) -> float:
        """Get market daily volume from Gamma API (cached)."""
        now_ts = datetime.now(timezone.utc).timestamp()

        # Check cache
        if condition_id in self._market_vol_cache:
            vol, cached_at = self._market_vol_cache[condition_id]
            if now_ts - cached_at < self.MARKET_VOL_CACHE_TTL:
                return vol

        # Fetch from Gamma API
        try:
            await self._ensure_session()
            url = f"https://gamma-api.polymarket.com/markets?condition_id={condition_id}&limit=1"
            async with self._session.get(
                url, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    self._market_vol_cache[condition_id] = (0, now_ts)
                    return 0
                data = await resp.json()
                if not data or not isinstance(data, list) or len(data) == 0:
                    self._market_vol_cache[condition_id] = (0, now_ts)
                    return 0

                market = data[0]
                # volume24hr is in USDC
                vol_24h = float(market.get("volume24hr", 0) or 0)
                self._market_vol_cache[condition_id] = (vol_24h, now_ts)
                return vol_24h
        except Exception as e:
            logger.debug(f"Gamma API failed for {condition_id[:10]}: {e}")
            self._market_vol_cache[condition_id] = (0, now_ts)
            return 0

    def _track_conviction(self, addr: str, condition_id: str, side: str) -> None:
        """Track trade direction for conviction scoring."""
        key = f"{addr}:{condition_id}"
        if key not in self._conviction_cache:
            self._conviction_cache[key] = []
        self._conviction_cache[key].append(side)
        # Cap at 50 per key
        if len(self._conviction_cache[key]) > 50:
            self._conviction_cache[key] = self._conviction_cache[key][-50:]

    # ---- Profitability ----

    def _get_profitability(self, address: str) -> dict:
        """Join with wallets table for profitability data."""
        wallet = self._wallets_cache.get(address.lower())
        if not wallet:
            return {
                "status": "pending",
                "copy_score": None,
                "profit_factor_30d": None,
                "pnl_all": None,
                "win_rate_all": None,
                "trade_count_all": None,
            }

        copy_score = wallet.get("copy_score", 0) or 0
        pf_30d = wallet.get("profit_factor_30d", 0) or 0
        pnl = wallet.get("pnl_all", 0) or wallet.get("overall_pnl", 0) or 0
        win_rate = wallet.get("win_rate_all", 0) or wallet.get("overall_win_rate", 0) or 0
        trade_count = wallet.get("trade_count_all", 0) or wallet.get("total_trades", 0) or 0

        if copy_score >= 60 and pf_30d >= 1.5:
            status = "copyable"
        elif pnl > 0:
            status = "profitable"
        elif trade_count >= 15:
            status = "unprofitable"
        else:
            status = "unknown"

        return {
            "status": status,
            "copy_score": copy_score if copy_score > 0 else None,
            "profit_factor_30d": pf_30d if pf_30d > 0 else None,
            "pnl_all": pnl if pnl != 0 else None,
            "win_rate_all": win_rate if win_rate > 0 else None,
            "trade_count_all": trade_count if trade_count > 0 else None,
        }

    # ---- Write Alert ----

    async def _write_alert(
        self,
        trade: dict,
        score: int,
        signals: list[str],
        details: dict,
        profitability: dict,
    ) -> None:
        """Write scored trade to insider_alerts table."""
        try:
            alert = {
                "trade_id": trade["trade_id"],
                "trader_address": trade["trader_address"],
                "trader_username": trade.get("trader_username"),
                "market_slug": trade.get("market_slug"),
                "event_slug": trade.get("event_slug"),
                "condition_id": trade.get("condition_id"),
                "side": trade["side"],
                "outcome": trade.get("outcome"),
                "price": float(trade.get("price", 0)),
                "usd_value": float(trade.get("usd_value", 0)),
                "executed_at": trade["executed_at"],
                "score_total": score,
                "score_wallet_age": details["score_wallet_age"],
                "score_size_vs_liquidity": details["score_size_vs_liquidity"],
                "score_market_niche": details["score_market_niche"],
                "score_extreme_odds": details["score_extreme_odds"],
                "score_conviction": details["score_conviction"],
                "score_category_winrate": details["score_category_winrate"],
                "wallet_age_days": details.get("wallet_age_days"),
                "wallet_nonce": details.get("wallet_nonce"),
                "market_daily_volume": details.get("market_daily_volume"),
                "signals": signals,
                "copy_score": profitability.get("copy_score"),
                "profit_factor_30d": profitability.get("profit_factor_30d"),
                "pnl_all": profitability.get("pnl_all"),
                "win_rate_all": profitability.get("win_rate_all"),
                "trade_count_all": profitability.get("trade_count_all"),
                "profitability_status": profitability["status"],
                "scored_at": datetime.now(timezone.utc).isoformat(),
            }

            self.supabase.table("insider_alerts").upsert(
                alert, on_conflict="trade_id"
            ).execute()

            self._alerts_written += 1

            logger.info(
                f"INSIDER ALERT [{score}] {trade['trader_address'][:10]}... "
                f"{trade['side']} ${float(trade.get('usd_value', 0)):,.0f} "
                f"@ {float(trade.get('price', 0)) * 100:.0f}% "
                f"signals=[{', '.join(signals)}] "
                f"profit={profitability['status']}"
            )

        except Exception as e:
            logger.error(f"Failed to write alert: {e}")
            self._errors += 1

    # ---- Cache Loading ----

    async def _load_wallets_cache(self) -> None:
        """Load wallets table into memory for profitability lookups."""
        try:
            # Load all analyzed wallets with pagination (Supabase caps at 1000 per request).
            # A trader may have $165K in positions but <$10 cash, we still need their data.
            self._wallets_cache = {}
            page_size = 1000
            offset = 0

            while True:
                result = (
                    self.supabase.table("wallets")
                    .select(
                        "address, account_created_at, copy_score, profit_factor_30d, "
                        "pnl_all, overall_pnl, win_rate_all, overall_win_rate, "
                        "trade_count_all, total_trades"
                    )
                    .or_("trade_count_all.gt.0,total_trades.gt.0")
                    .range(offset, offset + page_size - 1)
                    .execute()
                )

                rows = result.data or []
                for w in rows:
                    self._wallets_cache[w["address"].lower()] = w

                if len(rows) < page_size:
                    break
                offset += page_size

            self._wallets_cache_time = datetime.now(timezone.utc).timestamp()
            logger.info(f"Wallets cache loaded: {len(self._wallets_cache)} wallets")

        except Exception as e:
            logger.warning(f"Failed to load wallets cache: {e}")

    # ---- Cleanup ----

    async def _cleanup_old_alerts(self) -> None:
        """Delete alerts older than retention period."""
        try:
            cutoff = (
                datetime.now(timezone.utc) - timedelta(days=self.ALERT_RETENTION_DAYS)
            ).isoformat()

            result = self.supabase.table("insider_alerts").delete().lt(
                "created_at", cutoff
            ).execute()

            deleted = len(result.data) if result.data else 0
            if deleted > 0:
                logger.info(f"Cleaned up {deleted} old insider alerts")

        except Exception as e:
            logger.error(f"Alert cleanup failed: {e}")

    # ---- Lifecycle ----

    async def stop(self) -> None:
        """Stop the scorer."""
        self._running = False
        await self._close_session()

    @property
    def stats(self) -> dict:
        return {
            "trades_scored": self._trades_scored,
            "alerts_written": self._alerts_written,
            "errors": self._errors,
            "wallet_age_cache_size": len(self._wallet_age_cache),
            "market_vol_cache_size": len(self._market_vol_cache),
            "wallets_cache_size": len(self._wallets_cache),
            "last_trade_id": self._last_id,
        }
