"""
Wallet discovery processor for live trade monitoring.

Discovers new wallets from live trades >= $100 and fetches their trade history.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable

from supabase import Client

from ..scrapers.data_api import PolymarketDataAPI

logger = logging.getLogger(__name__)


class WalletDiscoveryProcessor:
    """
    Async processor that discovers new wallets from live trades.

    When a trade >= $100 comes in from an unknown wallet:
    1. Queue the wallet for processing
    2. Fetch portfolio value and trade history from Polymarket API
    3. Calculate 7d and 30d metrics (PnL, ROI, win rate, etc.)
    4. Store wallet with metrics and trades in database
    """

    # Rate limiting: 60 requests/minute, but we use 2 per wallet
    RATE_LIMIT_PER_MINUTE = 60
    REQUEST_INTERVAL = 1.0  # seconds between wallet processing

    MAX_QUEUE_SIZE = 100
    HISTORY_DAYS = 30

    def __init__(self, supabase: Client):
        """
        Initialize the wallet discovery processor.

        Args:
            supabase: Supabase client instance
        """
        self.supabase = supabase
        self._api: Optional[PolymarketDataAPI] = None

        # In-memory caches for O(1) lookup
        self._known_wallets: set[str] = set()
        self._pending_wallets: set[str] = set()

        # Processing queue
        self._queue: asyncio.Queue[tuple[str, float]] = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)

        # Rate limiting
        self._last_request_time: datetime = datetime.now(timezone.utc)

        # Stats
        self._wallets_discovered = 0
        self._wallets_processed = 0
        self._trades_stored = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load existing wallet addresses into memory cache."""
        try:
            logger.info("Loading wallet addresses into cache...")
            result = self.supabase.table("wallets").select("address").execute()

            self._known_wallets = {w["address"].lower() for w in result.data} if result.data else set()
            logger.info(f"Loaded {len(self._known_wallets)} wallet addresses into cache")

            # Initialize API client
            self._api = PolymarketDataAPI()
            await self._api.__aenter__()

        except Exception as e:
            logger.error(f"Failed to initialize wallet discovery: {e}")
            self._errors += 1

    async def shutdown(self) -> None:
        """Clean up resources."""
        if self._api:
            await self._api.__aexit__(None, None, None)

    async def check_and_queue(self, trader_address: str, usd_value: float) -> bool:
        """
        Check if wallet is new and queue for processing.

        Args:
            trader_address: The wallet address
            usd_value: The trade value in USD

        Returns:
            True if wallet was queued, False if already known or queue full
        """
        addr = trader_address.lower()

        # Skip if already known or pending
        if addr in self._known_wallets or addr in self._pending_wallets:
            return False

        # Try to queue
        try:
            self._queue.put_nowait((addr, usd_value))
            self._pending_wallets.add(addr)
            self._wallets_discovered += 1
            logger.info(f"New wallet discovered: {addr[:10]}... (${usd_value:,.0f} trade)")
            return True

        except asyncio.QueueFull:
            # Queue is full - only add if this is a high-value trade
            if usd_value >= 1000:
                logger.warning(f"Queue full, but high-value trade (${usd_value:,.0f}) - wallet will be processed later")
            return False

    async def process_queue(self) -> None:
        """Background task to process discovery queue."""
        logger.info("Starting wallet discovery processor")

        while True:
            try:
                # Get wallet from queue
                addr, usd_value = await self._queue.get()

                try:
                    # Rate limit - wait between requests
                    await self._rate_limit_wait()

                    # Process the wallet
                    await self._process_wallet(addr)

                except Exception as e:
                    logger.error(f"Error processing wallet {addr[:10]}...: {e}")
                    self._errors += 1

                finally:
                    self._pending_wallets.discard(addr)
                    self._queue.task_done()

            except asyncio.CancelledError:
                logger.info("Wallet discovery processor stopped")
                break

            except Exception as e:
                logger.error(f"Unexpected error in discovery processor: {e}")
                self._errors += 1
                await asyncio.sleep(1)

    async def _rate_limit_wait(self) -> None:
        """Wait to respect rate limits."""
        now = datetime.now(timezone.utc)
        elapsed = (now - self._last_request_time).total_seconds()

        if elapsed < self.REQUEST_INTERVAL:
            wait_time = self.REQUEST_INTERVAL - elapsed
            await asyncio.sleep(wait_time)

        self._last_request_time = datetime.now(timezone.utc)

    async def _process_wallet(self, address: str) -> None:
        """
        Process a single wallet: fetch data, calculate metrics, store.

        Args:
            address: The wallet address to process
        """
        if not self._api:
            raise RuntimeError("API client not initialized")

        logger.debug(f"Processing wallet: {address[:10]}...")

        # Fetch portfolio value
        portfolio_value = await self._api.get_portfolio_value(address)

        # Fetch activity (includes trades)
        activity = await self._api.get_activity(address)

        # Filter to only trades
        trades = [a for a in activity if a.get("type") == "TRADE"]

        # Parse and store trades
        stored_trades = await self._store_trades(address, trades)

        # Calculate metrics from trades
        metrics_7d = self._calculate_metrics(trades, days=7)
        metrics_30d = self._calculate_metrics(trades, days=30)

        # Save wallet with metrics
        wallet_data = {
            "address": address,
            "source": "live",
            "balance": portfolio_value,
            "balance_updated_at": datetime.now(timezone.utc).isoformat(),
            "pnl_7d": metrics_7d["pnl"],
            "pnl_30d": metrics_30d["pnl"],
            "roi_7d": metrics_7d["roi"],
            "roi_30d": metrics_30d["roi"],
            "win_rate_7d": metrics_7d["win_rate"],
            "win_rate_30d": metrics_30d["win_rate"],
            "volume_7d": metrics_7d["volume"],
            "volume_30d": metrics_30d["volume"],
            "trade_count_7d": metrics_7d["trade_count"],
            "trade_count_30d": metrics_30d["trade_count"],
            "metrics_updated_at": datetime.now(timezone.utc).isoformat(),
        }

        self.supabase.table("wallets").upsert(
            wallet_data, on_conflict="address"
        ).execute()

        # Add to known wallets cache
        self._known_wallets.add(address)
        self._wallets_processed += 1
        self._trades_stored += stored_trades

        logger.info(
            f"Wallet processed: {address[:10]}... | "
            f"balance=${portfolio_value:,.0f} | "
            f"trades={stored_trades} | "
            f"win_rate_7d={metrics_7d['win_rate']:.1f}% | "
            f"win_rate_30d={metrics_30d['win_rate']:.1f}%"
        )

    async def _store_trades(self, address: str, trades: list[dict]) -> int:
        """
        Store trades in wallet_trades table.

        Args:
            address: Wallet address
            trades: List of trade records from API

        Returns:
            Number of trades stored
        """
        if not trades:
            return 0

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=self.HISTORY_DAYS)

        trade_records = []
        for trade in trades:
            # Parse timestamp
            timestamp = trade.get("timestamp")
            if timestamp:
                try:
                    if isinstance(timestamp, (int, float)):
                        executed_at = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                    else:
                        executed_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                except Exception:
                    executed_at = now
            else:
                executed_at = now

            # Skip trades older than cutoff
            if executed_at < cutoff:
                continue

            # Get USD value
            usd_value = float(trade.get("usdcSize") or trade.get("usdValue") or 0)
            if usd_value == 0:
                size = float(trade.get("size") or 0)
                price = float(trade.get("price") or 0)
                usd_value = size * price

            trade_record = {
                "address": address,
                "trade_id": str(trade.get("id") or trade.get("transactionHash") or f"{address}_{timestamp}"),
                "condition_id": trade.get("conditionId"),
                "market_slug": trade.get("slug"),
                "market_title": trade.get("title"),
                "event_slug": trade.get("eventSlug"),
                "category": trade.get("category"),
                "side": trade.get("side", "").upper(),
                "outcome": trade.get("outcome"),
                "outcome_index": trade.get("outcomeIndex"),
                "size": float(trade.get("size") or 0),
                "price": float(trade.get("price") or 0),
                "usd_value": usd_value,
                "executed_at": executed_at.isoformat(),
                "tx_hash": trade.get("transactionHash"),
            }
            trade_records.append(trade_record)

        if trade_records:
            try:
                self.supabase.table("wallet_trades").upsert(
                    trade_records, on_conflict="address,trade_id"
                ).execute()
            except Exception as e:
                logger.error(f"Failed to store trades for {address[:10]}...: {e}")
                return 0

        return len(trade_records)

    def _calculate_metrics(self, trades: list[dict], days: int) -> dict:
        """
        Calculate metrics from trade history.

        Args:
            trades: List of trade records
            days: Number of days to include (7 or 30)

        Returns:
            Dict with pnl, roi, win_rate, volume, trade_count
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        # Filter trades to time period
        period_trades = []
        for trade in trades:
            timestamp = trade.get("timestamp")
            if timestamp:
                try:
                    if isinstance(timestamp, (int, float)):
                        executed_at = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                    else:
                        executed_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                    if executed_at >= cutoff:
                        period_trades.append(trade)
                except Exception:
                    pass

        if not period_trades:
            return {
                "pnl": 0,
                "roi": 0,
                "win_rate": 0,
                "volume": 0,
                "trade_count": 0,
            }

        # Group by market (condition_id)
        market_trades: dict[str, list[dict]] = {}
        for trade in period_trades:
            condition_id = trade.get("conditionId") or "unknown"
            if condition_id not in market_trades:
                market_trades[condition_id] = []
            market_trades[condition_id].append(trade)

        # Calculate per-market PnL and overall metrics
        total_pnl = 0
        total_invested = 0
        total_volume = 0
        winning_markets = 0
        closed_markets = 0

        for market_id, m_trades in market_trades.items():
            market_pnl = 0
            market_buys = 0

            for t in m_trades:
                usd_value = float(t.get("usdcSize") or t.get("usdValue") or 0)
                if usd_value == 0:
                    size = float(t.get("size") or 0)
                    price = float(t.get("price") or 0)
                    usd_value = size * price

                total_volume += usd_value
                side = t.get("side", "").upper()

                if side == "SELL":
                    market_pnl += usd_value
                else:  # BUY
                    market_pnl -= usd_value
                    market_buys += usd_value
                    total_invested += usd_value

            total_pnl += market_pnl

            # Only count markets with both buys and sells as "closed"
            has_buy = any(t.get("side", "").upper() == "BUY" for t in m_trades)
            has_sell = any(t.get("side", "").upper() == "SELL" for t in m_trades)

            if has_buy and has_sell:
                closed_markets += 1
                if market_pnl > 0:
                    winning_markets += 1

        # Calculate final metrics
        roi = (total_pnl / total_invested * 100) if total_invested > 0 else 0
        win_rate = (winning_markets / closed_markets * 100) if closed_markets > 0 else 0

        return {
            "pnl": round(total_pnl, 2),
            "roi": round(roi, 2),
            "win_rate": round(win_rate, 2),
            "volume": round(total_volume, 2),
            "trade_count": len(period_trades),
        }

    def refresh_cache(self, address: str) -> None:
        """Add an address to the known wallets cache."""
        self._known_wallets.add(address.lower())

    @property
    def stats(self) -> dict:
        """Get processor statistics."""
        return {
            "known_wallets": len(self._known_wallets),
            "pending_wallets": len(self._pending_wallets),
            "queue_size": self._queue.qsize(),
            "wallets_discovered": self._wallets_discovered,
            "wallets_processed": self._wallets_processed,
            "trades_stored": self._trades_stored,
            "errors": self._errors,
        }
