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

    # Processing settings
    # Each wallet needs 4 API calls, rate limit is 60/min
    # With 3 workers processing 1 wallet every 0.8s each = ~15 wallets/min = ~60 API calls/min
    NUM_WORKERS = 3
    REQUEST_INTERVAL = 0.8  # seconds between wallet processing per worker

    MAX_QUEUE_SIZE = 500  # Larger queue to handle bursts
    HISTORY_DAYS = 30
    REANALYSIS_COOLDOWN_DAYS = 3  # Don't re-analyze wallets within this period

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
        self._wallet_last_analyzed: dict[str, datetime] = {}  # addr -> last analysis time
        self._pending_wallets: set[str] = set()

        # Processing queue (priority queue would be nice but asyncio doesn't have one)
        self._queue: asyncio.Queue[tuple[str, float]] = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)

        # Per-worker rate limiting
        self._worker_last_request: dict[int, datetime] = {}

        # Stats
        self._wallets_discovered = 0  # New wallets seen (>= $100 trades)
        self._wallets_skipped_cooldown = 0  # Skipped due to recent analysis
        self._wallets_processed = 0  # Actually analyzed
        self._trades_stored = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load existing wallet addresses and last analysis times into memory cache."""
        try:
            logger.info("Loading wallet addresses into cache...")
            result = self.supabase.table("wallets").select("address, metrics_updated_at").execute()

            self._known_wallets = set()
            self._wallet_last_analyzed = {}

            for w in result.data or []:
                addr = w["address"].lower()
                self._known_wallets.add(addr)

                # Parse last analysis time
                if w.get("metrics_updated_at"):
                    try:
                        last_analyzed = datetime.fromisoformat(
                            str(w["metrics_updated_at"]).replace("Z", "+00:00")
                        )
                        self._wallet_last_analyzed[addr] = last_analyzed
                    except Exception:
                        pass

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
        Check if wallet needs analysis and queue for processing.

        Wallets are analyzed if:
        1. Never seen before, OR
        2. Last analyzed more than REANALYSIS_COOLDOWN_DAYS ago

        Args:
            trader_address: The wallet address
            usd_value: The trade value in USD

        Returns:
            True if wallet was queued, False if skipped or queue full
        """
        addr = trader_address.lower()

        # Always count as discovered (>= $100 trade)
        self._wallets_discovered += 1

        # Skip if already pending
        if addr in self._pending_wallets:
            return False

        # Check if wallet was recently analyzed (within cooldown period)
        if addr in self._known_wallets:
            last_analyzed = self._wallet_last_analyzed.get(addr)
            if last_analyzed:
                now = datetime.now(timezone.utc)
                days_since = (now - last_analyzed).days
                if days_since < self.REANALYSIS_COOLDOWN_DAYS:
                    # Skip - analyzed recently
                    return False

            # Wallet exists but needs re-analysis (older than cooldown)
            logger.debug(f"Wallet {addr[:10]}... needs re-analysis")

        # Try to queue
        try:
            self._queue.put_nowait((addr, usd_value))
            self._pending_wallets.add(addr)
            is_new = addr not in self._known_wallets
            logger.info(
                f"{'New' if is_new else 'Re-analyzing'} wallet: {addr[:10]}... "
                f"(${usd_value:,.0f} trade)"
            )
            return True

        except asyncio.QueueFull:
            # Queue is full - only add if this is a high-value trade
            if usd_value >= 1000:
                logger.warning(f"Queue full, but high-value trade (${usd_value:,.0f}) - wallet will be processed later")
            return False

    async def process_queue(self, worker_id: int = 0) -> None:
        """Background task to process discovery queue.

        Args:
            worker_id: Unique ID for this worker (for rate limiting)
        """
        logger.info(f"Starting wallet discovery worker {worker_id}")
        self._worker_last_request[worker_id] = datetime.now(timezone.utc)

        while True:
            try:
                # Get wallet from queue
                addr, usd_value = await self._queue.get()

                try:
                    # Rate limit - wait between requests for this worker
                    await self._rate_limit_wait(worker_id)

                    # Process the wallet
                    await self._process_wallet(addr)

                except Exception as e:
                    logger.error(f"Error processing wallet {addr[:10]}...: {e}")
                    self._errors += 1

                finally:
                    self._pending_wallets.discard(addr)
                    self._queue.task_done()

            except asyncio.CancelledError:
                logger.info(f"Wallet discovery worker {worker_id} stopped")
                break

            except Exception as e:
                logger.error(f"Unexpected error in discovery worker {worker_id}: {e}")
                self._errors += 1
                await asyncio.sleep(1)

    async def _rate_limit_wait(self, worker_id: int) -> None:
        """Wait to respect rate limits for a specific worker."""
        now = datetime.now(timezone.utc)
        last_request = self._worker_last_request.get(worker_id, now)
        elapsed = (now - last_request).total_seconds()

        if elapsed < self.REQUEST_INTERVAL:
            wait_time = self.REQUEST_INTERVAL - elapsed
            await asyncio.sleep(wait_time)

        self._worker_last_request[worker_id] = datetime.now(timezone.utc)

    async def _process_wallet(self, address: str) -> None:
        """
        Process a single wallet: fetch data, calculate metrics, store.

        Args:
            address: The wallet address to process
        """
        if not self._api:
            raise RuntimeError("API client not initialized")

        logger.debug(f"Processing wallet: {address[:10]}...")

        # Fetch ALL data in parallel (major performance improvement)
        # This reduces ~800ms sequential to ~250ms parallel
        portfolio_value, profile, closed_positions, activity = await asyncio.gather(
            self._api.get_portfolio_value(address),
            self._api.get_profile(address),
            self._api.get_closed_positions(address),
            self._api.get_activity(address),
        )

        # Filter to only trades
        trades = [a for a in activity if a.get("type") == "TRADE"]

        # Calculate metrics from CLOSED POSITIONS (win rate, PnL) and TRADES (volume)
        metrics_7d = self._calculate_metrics(closed_positions, trades, days=7)
        metrics_30d = self._calculate_metrics(closed_positions, trades, days=30)

        # IMPORTANT: Save wallet FIRST (before trades) to satisfy foreign key constraint
        wallet_data = {
            "address": address,
            "source": "live",
            "balance": portfolio_value,
            "balance_updated_at": datetime.now(timezone.utc).isoformat(),
            "username": profile.get("pseudonym") or profile.get("name"),
            "account_created_at": profile.get("createdAt"),
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

        # Update caches
        now = datetime.now(timezone.utc)
        self._known_wallets.add(address)
        self._wallet_last_analyzed[address] = now

        # NOW store trades (after wallet exists in DB)
        stored_trades = await self._store_trades(address, trades)

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
            # Deduplicate by trade_id (in case API returns duplicates)
            seen_ids = set()
            unique_records = []
            for record in trade_records:
                trade_id = record["trade_id"]
                if trade_id not in seen_ids:
                    seen_ids.add(trade_id)
                    unique_records.append(record)

            try:
                self.supabase.table("wallet_trades").upsert(
                    unique_records, on_conflict="address,trade_id"
                ).execute()
            except Exception as e:
                logger.error(f"Failed to store trades for {address[:10]}...: {e}")
                return 0

            return len(unique_records)

        return 0

    def _calculate_metrics(self, closed_positions: list[dict], trades: list[dict], days: int) -> dict:
        """
        Calculate metrics from closed positions and trade history.

        Win rate and PnL are calculated from CLOSED POSITIONS (resolved markets).
        Volume is calculated from TRADES.

        Args:
            closed_positions: List of closed position records from API
            trades: List of trade records from API
            days: Number of days to include (7 or 30)

        Returns:
            Dict with pnl, roi, win_rate, volume, trade_count
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        # =====================================================================
        # Calculate win rate and PnL from CLOSED POSITIONS
        # =====================================================================
        period_positions = []
        for pos in closed_positions:
            # Closed positions use "endDate" for when the market resolved
            end_date = pos.get("endDate")
            if end_date:
                try:
                    if isinstance(end_date, (int, float)):
                        resolved_at = datetime.fromtimestamp(end_date, tz=timezone.utc)
                    else:
                        resolved_at = datetime.fromisoformat(str(end_date).replace("Z", "+00:00"))
                    if resolved_at >= cutoff:
                        period_positions.append(pos)
                except Exception:
                    pass

        # Calculate PnL and win rate from closed positions
        total_pnl = 0
        total_invested = 0
        winning_positions = 0

        for pos in period_positions:
            realized_pnl = float(pos.get("realizedPnl", 0))

            # Calculate initial investment: totalBought * avgPrice
            # (initialValue field doesn't exist in API response)
            total_bought = float(pos.get("totalBought", 0))
            avg_price = float(pos.get("avgPrice", 0))
            initial_value = total_bought * avg_price

            total_pnl += realized_pnl
            total_invested += initial_value

            if realized_pnl > 0:
                winning_positions += 1

        # Win rate: percentage of closed positions with positive PnL
        win_rate = (winning_positions / len(period_positions) * 100) if period_positions else 0

        # ROI: total PnL / total invested
        roi = (total_pnl / total_invested * 100) if total_invested > 0 else 0

        # =====================================================================
        # Calculate volume and trade count from TRADES
        # =====================================================================
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

        # Calculate volume from trades
        total_volume = 0
        for trade in period_trades:
            usd_value = float(trade.get("usdcSize") or 0)
            if usd_value == 0:
                size = float(trade.get("size") or 0)
                price = float(trade.get("price") or 0)
                usd_value = size * price
            total_volume += usd_value

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
            "wallets_discovered": self._wallets_discovered,  # Total $100+ trades seen
            "wallets_processed": self._wallets_processed,    # Actually analyzed
            "trades_stored": self._trades_stored,
            "errors": self._errors,
        }
