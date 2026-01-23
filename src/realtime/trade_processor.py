"""
Trade processor for enriching, storing, and alerting on live trades.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client, Client

from .rtds_client import RTDSMessage

logger = logging.getLogger(__name__)


class TradeProcessor:
    """
    Processes incoming trades:
    1. Enriches with trader data from existing database
    2. Detects whale trades and patterns
    3. Stores to live_trades table
    4. Triggers alerts when rules match
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
        self._watchlist_cache: set[str] = set()
        self._watchlist_config: dict[str, dict] = {}  # address -> config
        self._alert_rules: list[dict] = []

        # Processing queue
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._batch: list[dict] = []
        self._last_flush = datetime.now(timezone.utc)

        # Background tasks
        self._batch_task: Optional[asyncio.Task] = None
        self._cache_task: Optional[asyncio.Task] = None

        # Stats
        self._trades_processed = 0
        self._trades_stored = 0
        self._alerts_triggered = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load caches from database."""
        logger.info("Initializing trade processor caches...")
        await asyncio.gather(
            self._load_trader_cache(),
            self._load_watchlist(),
            self._load_alert_rules(),
            return_exceptions=True,
        )
        logger.info(
            f"Loaded {len(self._trader_cache)} traders, "
            f"{len(self._watchlist_cache)} watchlist, "
            f"{len(self._alert_rules)} alert rules"
        )

    async def _load_trader_cache(self) -> None:
        """Load known traders into cache."""
        try:
            result = (
                self.supabase.table("traders")
                .select(
                    "address, username, copytrade_score, bot_score, "
                    "primary_classification, portfolio_value"
                )
                .execute()
            )

            self._trader_cache = {t["address"].lower(): t for t in (result.data or [])}
            logger.debug(f"Loaded {len(self._trader_cache)} traders to cache")

        except Exception as e:
            logger.error(f"Failed to load trader cache: {e}")
            self._errors += 1

    async def _load_watchlist(self) -> None:
        """Load watchlist addresses and config."""
        try:
            result = self.supabase.table("watchlist").select("address, min_trade_size, alert_threshold_usd").execute()

            self._watchlist_cache = set()
            self._watchlist_config = {}

            for w in result.data or []:
                addr = w["address"].lower()
                self._watchlist_cache.add(addr)
                self._watchlist_config[addr] = {
                    "min_trade_size": float(w.get("min_trade_size") or 0),
                    "alert_threshold": float(w.get("alert_threshold_usd") or 0),
                }

            logger.debug(f"Loaded {len(self._watchlist_cache)} watchlist addresses")

        except Exception as e:
            logger.error(f"Failed to load watchlist: {e}")
            self._errors += 1

    async def _load_alert_rules(self) -> None:
        """Load alert rules."""
        try:
            result = self.supabase.table("alert_rules").select("*").eq("enabled", True).execute()

            self._alert_rules = result.data or []
            logger.debug(f"Loaded {len(self._alert_rules)} alert rules")

        except Exception as e:
            logger.error(f"Failed to load alert rules: {e}")
            self._errors += 1

    async def process_trade(self, trade: RTDSMessage) -> None:
        """
        Process a single trade from RTDS.

        This is called for every trade received and must be fast.
        Heavy processing is done asynchronously via the queue.
        """
        self._trades_processed += 1

        # Enrich trade with cached data
        trade_record = self._enrich_trade(trade)

        # Check for whale
        trade_record["is_whale"] = trade.usd_value >= self.WHALE_THRESHOLD_USD

        # Check watchlist
        is_watchlist = trade.trader_address in self._watchlist_cache
        trade_record["is_watchlist"] = is_watchlist

        # Add to batch queue (non-blocking)
        try:
            self._queue.put_nowait(trade_record)
        except asyncio.QueueFull:
            logger.warning("Trade queue full, dropping trade")
            self._errors += 1
            return

        # Trigger immediate alerts for critical events
        if trade_record["is_whale"] or is_watchlist:
            asyncio.create_task(self._check_alerts(trade_record))

    def _enrich_trade(self, trade: RTDSMessage) -> dict:
        """Enrich trade with cached trader data."""
        trader_data = self._trader_cache.get(trade.trader_address, {})

        now = datetime.now(timezone.utc)
        latency_ms = int((now - trade.executed_at).total_seconds() * 1000)

        return {
            "trade_id": trade.trade_id,
            "tx_hash": trade.tx_hash,
            "trader_address": trade.trader_address,
            "trader_username": trader_data.get("username"),
            "is_known_trader": bool(trader_data),
            "trader_classification": trader_data.get("primary_classification"),
            "trader_copytrade_score": trader_data.get("copytrade_score"),
            "trader_bot_score": trader_data.get("bot_score"),
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
            "is_watchlist": False,
            "alert_triggered": False,
            "raw_data": trade.raw_data,
        }

    async def _check_alerts(self, trade: dict) -> None:
        """Check alert rules and trigger if matched."""
        for rule in self._alert_rules:
            try:
                if self._rule_matches(rule, trade):
                    await self._trigger_alert(rule, trade)
            except Exception as e:
                logger.error(f"Error checking alert rule {rule.get('id')}: {e}")
                self._errors += 1

    def _rule_matches(self, rule: dict, trade: dict) -> bool:
        """Check if a trade matches an alert rule."""
        conditions = rule.get("conditions", {})
        rule_type = rule.get("rule_type")

        # Watchlist activity - only match if trader is on watchlist
        if rule_type == "watchlist_activity":
            if not trade["is_watchlist"]:
                return False
            # Check minimum trade size from watchlist config
            config = self._watchlist_config.get(trade["trader_address"], {})
            min_size = config.get("min_trade_size", 0)
            if trade["usd_value"] < min_size:
                return False
            return True

        # Whale check
        if "min_usd_value" in conditions:
            if trade["usd_value"] < conditions["min_usd_value"]:
                return False

        # Category check
        if "categories" in conditions:
            if trade.get("category") and trade["category"] not in conditions["categories"]:
                return False

        # Time check (unusual hours in UTC)
        if "hours" in conditions:
            try:
                executed_at = datetime.fromisoformat(trade["executed_at"].replace("Z", "+00:00"))
                hour = executed_at.hour
                if hour not in conditions["hours"]:
                    return False
            except Exception:
                pass

        # Side check
        if "sides" in conditions:
            if trade["side"] not in conditions["sides"]:
                return False

        return True

    async def _trigger_alert(self, rule: dict, trade: dict) -> None:
        """Create an alert record."""
        # Build alert title
        usd_formatted = f"${trade['usd_value']:,.0f}"
        trader_display = trade.get("trader_username") or f"{trade['trader_address'][:8]}..."

        alert = {
            "trade_id": trade["trade_id"],
            "trader_address": trade["trader_address"],
            "alert_type": rule["rule_type"],
            "severity": rule.get("alert_severity", "info"),
            "title": f"{rule['name']}: {usd_formatted}",
            "description": (
                f"{trader_display} {trade['side']} {trade.get('outcome', 'position')} "
                f"on {trade.get('market_slug', 'unknown market')}"
            ),
            "metadata": {
                "usd_value": trade["usd_value"],
                "market_slug": trade.get("market_slug"),
                "side": trade["side"],
                "outcome": trade.get("outcome"),
                "rule_id": rule.get("id"),
                "is_known_trader": trade.get("is_known_trader"),
                "trader_classification": trade.get("trader_classification"),
            },
        }

        try:
            self.supabase.table("trade_alerts").insert(alert).execute()
            trade["alert_triggered"] = True
            self._alerts_triggered += 1
            logger.info(f"Alert triggered: {alert['title']} - {alert['description']}")

        except Exception as e:
            logger.error(f"Failed to create alert: {e}")
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
            for trade in batch[:10]:  # Only retry first 10
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

        while True:
            try:
                await asyncio.sleep(60)  # Refresh every minute

                await asyncio.gather(
                    self._load_trader_cache(),
                    self._load_watchlist(),
                    self._load_alert_rules(),
                    return_exceptions=True,
                )

                logger.debug(
                    f"Caches refreshed: {len(self._trader_cache)} traders, "
                    f"{len(self._watchlist_cache)} watchlist"
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

    @property
    def stats(self) -> dict:
        """Get processor statistics."""
        return {
            "trades_processed": self._trades_processed,
            "trades_stored": self._trades_stored,
            "alerts_triggered": self._alerts_triggered,
            "errors": self._errors,
            "queue_size": self._queue.qsize(),
            "batch_size": len(self._batch),
            "cached_traders": len(self._trader_cache),
            "watchlist_size": len(self._watchlist_cache),
            "alert_rules": len(self._alert_rules),
        }
