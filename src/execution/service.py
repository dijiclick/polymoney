"""
Copy trading service with RTDS integration.

Usage:
    python -m src.execution.service
"""

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

from src.realtime.rtds_client import RTDSClient, RTDSMessage
from src.realtime.trade_processor import TradeProcessor
from src.execution.copy_trader import CopyTrader, CopyTraderConfig
from src.execution.clob_client import ClobClient
from src.execution.risk_manager import RiskLimits

logger = logging.getLogger(__name__)


class CopyTradingService:
    """
    Service that combines real-time trade monitoring with copy trading.

    Features:
    - Connects to RTDS for real-time Polymarket trades
    - Enriches and stores trades in Supabase
    - Automatically copies trades from qualified traders
    - Tracks positions and P&L
    - Risk management with kill switch
    """

    STATS_INTERVAL_SECONDS = 60
    CACHE_REFRESH_INTERVAL_SECONDS = 300  # 5 minutes

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        private_key: str,
        api_key: str | None = None,
        api_secret: str | None = None,
        api_passphrase: str | None = None,
        copy_config: CopyTraderConfig | None = None,
        risk_limits: RiskLimits | None = None,
    ):
        """
        Initialize copy trading service.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            private_key: Ethereum wallet private key
            api_key: Polymarket API key
            api_secret: Polymarket API secret
            api_passphrase: Polymarket API passphrase
            copy_config: Copy trading configuration
            risk_limits: Risk management limits
        """
        from supabase import create_client

        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.supabase = create_client(supabase_url, supabase_key)

        # Trade processor for enrichment/storage
        self.processor = TradeProcessor(supabase_url, supabase_key)

        # CLOB client for order execution
        copy_config = copy_config or CopyTraderConfig()
        self.clob_client = ClobClient(
            private_key=private_key,
            api_key=api_key,
            api_secret=api_secret,
            api_passphrase=api_passphrase,
            paper_trading=copy_config.paper_trading,
        )

        # Copy trader
        self.copy_trader = CopyTrader(
            clob_client=self.clob_client,
            supabase=self.supabase,
            config=copy_config,
            risk_limits=risk_limits,
        )

        # RTDS client
        self.rtds_client = RTDSClient(
            on_trade=self._handle_trade,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
        )

        self._start_time: datetime | None = None
        self._running = False
        self._stats_task: asyncio.Task | None = None
        self._cache_task: asyncio.Task | None = None

    async def _handle_trade(self, trade: RTDSMessage) -> None:
        """Handle incoming trade from RTDS."""
        # Process for enrichment and storage
        await self.processor.process_trade(trade)

        # Evaluate for copy trading
        await self.copy_trader.evaluate_trade(trade)

    async def _on_connect(self) -> None:
        """Handle WebSocket connection."""
        status = "PAPER" if self.copy_trader.config.paper_trading else "LIVE"
        logger.info(f"RTDS connected - Copy trading [{status}] active")

    async def _on_disconnect(self, reason: str) -> None:
        """Handle WebSocket disconnection."""
        logger.warning(f"RTDS disconnected: {reason}")

    async def start(self) -> None:
        """Start the copy trading service."""
        self._start_time = datetime.now(timezone.utc)
        self._running = True

        mode = "PAPER" if self.copy_trader.config.paper_trading else "LIVE"

        logger.info("=" * 60)
        logger.info(f"POLYMARKET COPY TRADING SERVICE [{mode}]")
        logger.info("=" * 60)

        # Initialize components
        await self.processor.initialize()
        await self.copy_trader.initialize()

        # Start background tasks
        await self.processor.start_background_tasks()
        self._stats_task = asyncio.create_task(self._stats_reporter())
        self._cache_task = asyncio.create_task(self._cache_refresher())

        logger.info(f"Copy trading: {self.copy_trader.config.enabled}")
        logger.info(f"Min copytrade score: {self.copy_trader.config.min_copytrade_score}")
        logger.info(f"Qualified traders: {len(self.copy_trader._trader_cache)}")
        logger.info(f"Risk limits: max_exposure=${self.copy_trader.risk_manager.limits.max_total_exposure_usd}")
        logger.info("=" * 60)

        # Start RTDS client (blocks until stopped)
        try:
            await self.rtds_client.start()
        except asyncio.CancelledError:
            logger.info("Service received cancel signal")

    async def stop(self) -> None:
        """Stop the service gracefully."""
        logger.info("Stopping copy trading service...")
        self._running = False

        # Cancel all open orders if live trading
        if not self.copy_trader.config.paper_trading:
            cancelled = await self.clob_client.cancel_all_orders()
            if cancelled > 0:
                logger.info(f"Cancelled {cancelled} open orders")

        # Stop RTDS client
        await self.rtds_client.stop()

        # Stop background tasks
        for task in [self._stats_task, self._cache_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        await self.processor.stop_background_tasks()

        # Final stats
        self._log_stats()
        logger.info("Copy trading service stopped")

    async def _stats_reporter(self) -> None:
        """Periodically log statistics."""
        while self._running:
            try:
                await asyncio.sleep(self.STATS_INTERVAL_SECONDS)
                self._log_stats()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Stats reporter error: {e}")

    async def _cache_refresher(self) -> None:
        """Periodically refresh copy trader caches."""
        while self._running:
            try:
                await asyncio.sleep(self.CACHE_REFRESH_INTERVAL_SECONDS)
                await self.copy_trader.refresh_caches()
                logger.debug("Caches refreshed")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cache refresh error: {e}")

    def _log_stats(self) -> None:
        """Log current statistics."""
        rtds_stats = self.rtds_client.stats
        processor_stats = self.processor.stats
        copy_stats = self.copy_trader.stats

        uptime = rtds_stats.get("uptime_seconds", 0)
        uptime_str = f"{int(uptime // 3600)}h {int((uptime % 3600) // 60)}m"

        logger.info(
            f"[STATS] "
            f"Trades: {processor_stats['trades_processed']:,} | "
            f"Copied: {copy_stats['trades_copied']} "
            f"(${copy_stats['copy_volume_usd']:,.0f}) | "
            f"Rejected: {copy_stats['trades_rejected']} | "
            f"Positions: {copy_stats['positions']['position_count']} | "
            f"Exposure: ${copy_stats['risk']['total_exposure_usd']:,.0f} | "
            f"Uptime: {uptime_str}"
        )

    @property
    def stats(self) -> dict:
        """Get combined service statistics."""
        return {
            "rtds": self.rtds_client.stats,
            "processor": self.processor.stats,
            "copy_trader": self.copy_trader.stats,
            "clob": self.clob_client.stats,
            "start_time": self._start_time.isoformat() if self._start_time else None,
            "running": self._running,
        }

    # Control methods

    def enable_copy_trading(self) -> None:
        """Enable copy trading."""
        self.copy_trader.enable()

    def disable_copy_trading(self) -> None:
        """Disable copy trading."""
        self.copy_trader.disable()

    def activate_kill_switch(self, reason: str = "Manual") -> None:
        """Activate kill switch to stop all trading."""
        self.copy_trader.risk_manager.activate_kill_switch(reason)

    def deactivate_kill_switch(self) -> None:
        """Deactivate kill switch."""
        self.copy_trader.risk_manager.deactivate_kill_switch()


def setup_logging(level: str = "INFO") -> None:
    """Configure logging."""
    log_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Reduce noise from libraries
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("py_clob_client").setLevel(logging.WARNING)


async def main() -> None:
    """Entry point for the copy trading service."""
    load_dotenv()

    log_level = os.getenv("LOG_LEVEL", "INFO")
    setup_logging(log_level)

    # Required config
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    private_key = os.getenv("POLYMARKET_PRIVATE_KEY")

    if not supabase_url or not supabase_key:
        logger.error("SUPABASE_URL and SUPABASE_KEY required")
        sys.exit(1)

    if not private_key:
        logger.error("POLYMARKET_PRIVATE_KEY required for copy trading")
        sys.exit(1)

    # Optional Polymarket API credentials
    api_key = os.getenv("POLYMARKET_API_KEY")
    api_secret = os.getenv("POLYMARKET_API_SECRET")
    api_passphrase = os.getenv("POLYMARKET_API_PASSPHRASE")

    # Copy trading config from environment
    copy_config = CopyTraderConfig(
        enabled=os.getenv("COPY_TRADING_ENABLED", "false").lower() == "true",
        paper_trading=os.getenv("PAPER_TRADING", "true").lower() == "true",
        min_copytrade_score=int(os.getenv("MIN_COPYTRADE_SCORE", "60")),
        copy_fraction=Decimal(os.getenv("COPY_FRACTION", "0.1")),
        min_copy_size_usd=Decimal(os.getenv("MIN_COPY_SIZE_USD", "5")),
        max_copy_size_usd=Decimal(os.getenv("MAX_COPY_SIZE_USD", "100")),
        min_trade_size_usd=Decimal(os.getenv("MIN_TRADE_SIZE_USD", "50")),
        copy_from_watchlist_only=os.getenv("COPY_WATCHLIST_ONLY", "false").lower() == "true",
    )

    # Risk limits from environment
    risk_limits = RiskLimits(
        max_position_size_usd=Decimal(os.getenv("MAX_POSITION_SIZE_USD", "500")),
        max_total_exposure_usd=Decimal(os.getenv("MAX_TOTAL_EXPOSURE_USD", "5000")),
        max_single_order_usd=Decimal(os.getenv("MAX_SINGLE_ORDER_USD", "100")),
        max_daily_loss_usd=Decimal(os.getenv("MAX_DAILY_LOSS_USD", "500")),
        max_daily_orders=int(os.getenv("MAX_DAILY_ORDERS", "100")),
    )

    # Create service
    service = CopyTradingService(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        private_key=private_key,
        api_key=api_key,
        api_secret=api_secret,
        api_passphrase=api_passphrase,
        copy_config=copy_config,
        risk_limits=risk_limits,
    )

    # Setup signal handlers
    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def signal_handler() -> None:
        logger.info("Received shutdown signal")
        shutdown_event.set()

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, signal_handler)
    except NotImplementedError:
        pass  # Windows

    # Run service
    try:
        service_task = asyncio.create_task(service.start())

        done, pending = await asyncio.wait(
            [service_task, asyncio.create_task(shutdown_event.wait())],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt")

    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
