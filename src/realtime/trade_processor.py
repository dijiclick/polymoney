"""
Trade processor for enriching and storing live trades.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from supabase import create_client, Client

from .rtds_client import RTDSMessage
from .wallet_discovery import WalletDiscoveryProcessor

logger = logging.getLogger(__name__)


class TradeProcessor:
    """
    Processes incoming trades:
    1. Enriches with trader data from existing database
    2. Detects whale trades and patterns
    3. Stores to live_trades table
    """

    # Whale thresholds
    WHALE_THRESHOLD_USD = 10000
    MEGA_WHALE_THRESHOLD_USD = 50000

    # Batch processing settings
    BATCH_SIZE = 50
    BATCH_TIMEOUT_SECONDS = 0.5

    def __init__(self, supabase_url: str, supabase_key: str):
        """
        Initialize trade processor.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
        """
        self.supabase: Client = create_client(supabase_url, supabase_key)

        # Caches (refresh periodically)
        self._trader_cache: dict[str, dict] = {}

        # Session-based tracking for real-time insider detection
        self._session_trades: dict[str, list[dict]] = {}  # trader_addr -> trades

        # Processing queue
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._batch: list[dict] = []
        self._last_flush = datetime.now(timezone.utc)

        # Background tasks
        self._batch_task: Optional[asyncio.Task] = None
        self._cache_task: Optional[asyncio.Task] = None
        self._discovery_tasks: list[asyncio.Task] = []
        self._settings_poller_task: Optional[asyncio.Task] = None

        # Wallet discovery processor
        self._discovery_processor: Optional[WalletDiscoveryProcessor] = None

        # Stats
        self._trades_processed = 0
        self._trades_stored = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load caches from database."""
        logger.info("Initializing trade processor caches...")
        await self._load_trader_cache()
        logger.info(f"Loaded {len(self._trader_cache)} wallets")

        # Initialize wallet discovery processor
        self._discovery_processor = WalletDiscoveryProcessor(self.supabase)
        await self._discovery_processor.initialize()
        logger.info("Wallet discovery processor initialized")

    async def _load_trader_cache(self) -> None:
        """Load known wallets into cache (limited to prevent timeout)."""
        try:
            # Only load wallets with balance to avoid timeout
            result = (
                self.supabase.table("wallets")
                .select("address, source, balance")
                .not_.is_("balance", "null")
                .gte("balance", 100)
                .limit(5000)
                .execute()
            )

            # Build cache with wallet data
            self._trader_cache = {}
            for w in result.data or []:
                addr = w["address"].lower()
                self._trader_cache[addr] = {
                    "address": addr,
                    "source": w.get("source"),
                    "portfolio_value": w.get("balance"),
                    "username": None,
                    "insider_score": None,
                    "insider_level": None,
                    "insider_red_flags": [],
                    "primary_classification": None,
                }

            logger.debug(f"Loaded {len(self._trader_cache)} wallets to cache")

        except Exception as e:
            # Wallet cache is optional - continue without it
            logger.warning(f"Wallet cache not available: {e}")
            self._trader_cache = {}

    def _calculate_realtime_score(self, trade: RTDSMessage) -> tuple[int, list[str]]:
        """
        Calculate heuristic insider score for unknown traders.

        Uses session-based signals to detect suspicious patterns.

        Returns:
            Tuple of (score 0-100, list of red flag strings)
        """
        score = 0
        flags = []
        addr = trade.trader_address.lower()

        # Get trader's session history
        history = self._session_trades.get(addr, [])

        # 1. Trade size (0-30 pts)
        if trade.usd_value >= 5000:
            score += 30
            flags.append("Large trade ($5K+) from new account")
        elif trade.usd_value >= 1000:
            score += 15

        # 2. Market concentration (0-25 pts)
        same_market = sum(1 for t in history if t.get("condition_id") == trade.condition_id)
        if same_market >= 4:
            score += 25
            flags.append(f"Concentrated betting ({same_market + 1} trades same market)")
        elif same_market >= 2:
            score += 15

        # 3. Session volume (0-25 pts)
        total_volume = sum(t.get("usd_value", 0) for t in history) + trade.usd_value
        if total_volume >= 50000:
            score += 25
            flags.append(f"High session volume (${total_volume:,.0f})")
        elif total_volume >= 20000:
            score += 15

        # 4. Off-hours trading (0-10 pts)
        hour = trade.executed_at.hour
        if 2 <= hour <= 6:
            score += 10
            flags.append("Off-hours trading (2-6am UTC)")

        # 5. One-sided trading (0-10 pts)
        if history:
            sides = set(t.get("side") for t in history)
            sides.add(trade.side)
            if len(sides) == 1:
                score += 10
                flags.append(f"One-sided trading (all {trade.side})")

        return min(score, 100), flags

    def _track_session_trade(self, trade: RTDSMessage) -> None:
        """Track trade in session history for real-time scoring."""
        addr = trade.trader_address.lower()
        if addr not in self._session_trades:
            self._session_trades[addr] = []

        self._session_trades[addr].append({
            "condition_id": trade.condition_id,
            "usd_value": trade.usd_value,
            "side": trade.side,
            "executed_at": trade.executed_at,
        })

        # Limit history per trader to prevent memory growth
        if len(self._session_trades[addr]) > 100:
            self._session_trades[addr] = self._session_trades[addr][-100:]

    async def process_trade(self, trade: RTDSMessage) -> None:
        """
        Process a single trade from RTDS.

        This is called for every trade received and must be fast.
        Heavy processing is done asynchronously via the queue.
        """
        self._trades_processed += 1

        # Wallet discovery threshold
        DISCOVERY_THRESHOLD_USD = 100
        # Trade storage threshold (higher to avoid database bloat)
        STORAGE_THRESHOLD_USD = 100

        # Check for new wallet discovery (non-blocking, for trades >= $100)
        if trade.usd_value >= DISCOVERY_THRESHOLD_USD and self._discovery_processor:
            await self._discovery_processor.check_and_queue(
                trade.trader_address,
                trade.usd_value
            )

        # Enrich trade with cached data
        trade_record = self._enrich_trade(trade)

        # Check for whale
        is_whale = trade.usd_value >= self.WHALE_THRESHOLD_USD
        trade_record["is_whale"] = is_whale

        # Check insider
        is_insider = trade_record.get("is_insider_suspect", False)

        # Store trades >= $100 to database for live feed display
        should_store = trade.usd_value >= STORAGE_THRESHOLD_USD or is_whale or is_insider

        if should_store:
            try:
                self._queue.put_nowait(trade_record)
            except asyncio.QueueFull:
                logger.warning("Trade queue full, dropping trade")
                self._errors += 1

    def _enrich_trade(self, trade: RTDSMessage) -> dict:
        """Enrich trade with cached trader data or real-time heuristics."""
        trader_data = self._trader_cache.get(trade.trader_address.lower(), {})

        now = datetime.now(timezone.utc)
        latency_ms = int((now - trade.executed_at).total_seconds() * 1000)

        # Determine insider score and flags
        if trader_data:
            # Known trader - use cached score
            insider_score = trader_data.get("insider_score") or 0
            red_flags = trader_data.get("insider_red_flags") or []
        else:
            # Unknown trader - calculate real-time heuristic score
            insider_score, red_flags = self._calculate_realtime_score(trade)

        is_insider = insider_score >= 60

        # Track trade in session for future scoring
        self._track_session_trade(trade)

        return {
            "trade_id": trade.trade_id,
            "tx_hash": trade.tx_hash,
            "trader_address": trade.trader_address,
            "trader_username": trader_data.get("username"),
            "is_known_trader": bool(trader_data),
            "trader_classification": trader_data.get("primary_classification"),
            "trader_insider_score": insider_score,
            "trader_insider_level": trader_data.get("insider_level"),
            "trader_red_flags": red_flags,
            "is_insider_suspect": is_insider,
            "trader_portfolio_value": trader_data.get("portfolio_value"),
            "condition_id": trade.condition_id,
            "asset_id": trade.asset_id,
            "market_slug": trade.market_slug,
            "market_title": None,
            "event_slug": trade.event_slug,
            "category": None,
            "side": trade.side,
            "outcome": trade.outcome,
            "outcome_index": trade.outcome_index,
            "size": float(trade.size),
            "price": float(trade.price),
            "usd_value": float(trade.usd_value),
            "executed_at": trade.executed_at.isoformat(),
            "received_at": now.isoformat(),
            "processing_latency_ms": latency_ms,
            "is_whale": False,
            "is_insider_suspect": is_insider,
            "raw_data": trade.raw_data,
        }

    async def _cleanup_old_trades(self, retention_days: int = 7) -> None:
        """Delete trades older than retention period to manage database size.

        Regular trades are kept for 1 day, while important trades
        (whales/insiders) are kept for the full retention period.
        """
        try:
            now = datetime.now(timezone.utc)

            # Delete regular (non-important) trades older than 1 day
            regular_cutoff = (now - timedelta(days=1)).isoformat()
            regular_result = self.supabase.table("live_trades").delete().lt(
                "received_at", regular_cutoff
            ).eq("is_whale", False).eq("is_insider_suspect", False).execute()

            regular_deleted = len(regular_result.data) if regular_result.data else 0

            # Delete important trades older than retention period
            important_cutoff = (now - timedelta(days=retention_days)).isoformat()
            important_result = self.supabase.table("live_trades").delete().lt(
                "received_at", important_cutoff
            ).execute()

            important_deleted = len(important_result.data) if important_result.data else 0

            total_deleted = regular_deleted + important_deleted

            if total_deleted > 0:
                logger.info(
                    f"Database cleanup: deleted {regular_deleted} regular trades (>1d), "
                    f"{important_deleted} important trades (>{retention_days}d)"
                )

        except Exception as e:
            logger.error(f"Database cleanup failed: {e}")
            self._errors += 1

    async def flush_batch(self) -> None:
        """Flush accumulated trades to database."""
        if not self._batch:
            return

        batch = self._batch
        self._batch = []

        # Remove raw_data before insert (too large)
        for trade in batch:
            trade.pop("raw_data", None)

        # Deduplicate by trade_id (keep latest) to avoid ON CONFLICT error
        seen_ids: dict[str, dict] = {}
        for trade in batch:
            seen_ids[trade["trade_id"]] = trade
        batch = list(seen_ids.values())

        try:
            # Use upsert to handle duplicate trade_ids
            self.supabase.table("live_trades").upsert(
                batch, on_conflict="trade_id"
            ).execute()

            self._trades_stored += len(batch)
            logger.debug(f"Flushed {len(batch)} trades to database")

        except Exception as e:
            logger.error(f"Failed to flush batch: {e}")
            self._errors += 1
            # Put trades back in queue for retry (limited)
            for trade in batch[:10]:
                try:
                    self._queue.put_nowait(trade)
                except asyncio.QueueFull:
                    break

    async def batch_processor(self) -> None:
        """Background task to batch and flush trades."""
        logger.info("Starting batch processor")

        while True:
            try:
                # Get trade from queue with timeout
                try:
                    trade = await asyncio.wait_for(
                        self._queue.get(), timeout=self.BATCH_TIMEOUT_SECONDS
                    )
                    self._batch.append(trade)
                except asyncio.TimeoutError:
                    pass

                # Flush if batch is full or timeout reached
                now = datetime.now(timezone.utc)
                time_since_flush = (now - self._last_flush).total_seconds()

                should_flush = len(self._batch) >= self.BATCH_SIZE or (
                    self._batch and time_since_flush >= self.BATCH_TIMEOUT_SECONDS
                )

                if should_flush:
                    await self.flush_batch()
                    self._last_flush = now

            except asyncio.CancelledError:
                # Flush remaining on shutdown
                await self.flush_batch()
                logger.info("Batch processor stopped")
                break

            except Exception as e:
                logger.error(f"Batch processor error: {e}")
                self._errors += 1
                await asyncio.sleep(1)

    async def refresh_caches(self) -> None:
        """Periodically refresh caches."""
        logger.info("Starting cache refresh task")

        # Track last cleanup time for database cleanup (runs hourly)
        last_db_cleanup = datetime.now(timezone.utc)
        DB_CLEANUP_INTERVAL = timedelta(hours=1)
        TRADE_RETENTION_DAYS = 7

        while True:
            try:
                await asyncio.sleep(60)  # Refresh every minute

                await self._load_trader_cache()

                # Clean up old session data (> 2 hours) to prevent memory growth
                cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
                for addr in list(self._session_trades.keys()):
                    self._session_trades[addr] = [
                        t for t in self._session_trades[addr]
                        if t["executed_at"] > cutoff
                    ]
                    if not self._session_trades[addr]:
                        del self._session_trades[addr]

                # Database cleanup: delete old trades (runs hourly)
                now = datetime.now(timezone.utc)
                if now - last_db_cleanup >= DB_CLEANUP_INTERVAL:
                    last_db_cleanup = now
                    await self._cleanup_old_trades(TRADE_RETENTION_DAYS)

                logger.debug(
                    f"Caches refreshed: {len(self._trader_cache)} wallets, "
                    f"{len(self._session_trades)} session traders"
                )

            except asyncio.CancelledError:
                logger.info("Cache refresh task stopped")
                break

            except Exception as e:
                logger.error(f"Cache refresh failed: {e}")
                self._errors += 1

    async def start_background_tasks(self) -> None:
        """Start background processing tasks."""
        self._batch_task = asyncio.create_task(self.batch_processor())
        self._cache_task = asyncio.create_task(self.refresh_caches())

        # Start multiple wallet discovery workers + settings poller
        if self._discovery_processor:
            num_workers = self._discovery_processor.NUM_WORKERS
            self._discovery_tasks = [
                asyncio.create_task(self._discovery_processor.process_queue(worker_id=i))
                for i in range(num_workers)
            ]
            self._settings_poller_task = asyncio.create_task(
                self._discovery_processor.poll_settings()
            )
            logger.info(f"Started {num_workers} wallet discovery workers + settings poller")

    async def stop_background_tasks(self) -> None:
        """Stop background tasks gracefully."""
        if self._batch_task:
            self._batch_task.cancel()
            try:
                await self._batch_task
            except asyncio.CancelledError:
                pass

        if self._cache_task:
            self._cache_task.cancel()
            try:
                await self._cache_task
            except asyncio.CancelledError:
                pass

        # Stop settings poller
        if hasattr(self, '_settings_poller_task') and self._settings_poller_task:
            self._settings_poller_task.cancel()
            try:
                await self._settings_poller_task
            except asyncio.CancelledError:
                pass

        # Stop all discovery workers
        for task in self._discovery_tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._discovery_tasks = []

        # Cleanup discovery processor
        if self._discovery_processor:
            await self._discovery_processor.shutdown()

    @property
    def stats(self) -> dict:
        """Get processor statistics."""
        stats = {
            "trades_processed": self._trades_processed,
            "trades_stored": self._trades_stored,
            "errors": self._errors,
            "queue_size": self._queue.qsize(),
            "batch_size": len(self._batch),
            "cached_traders": len(self._trader_cache),
        }

        # Add discovery stats
        if self._discovery_processor:
            discovery_stats = self._discovery_processor.stats
            stats["discovery"] = discovery_stats

        return stats
