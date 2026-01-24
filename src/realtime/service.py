"""
Main service for real-time trade monitoring.

Usage:
    python -m src.realtime.service
"""

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

from src.realtime.rtds_client import RTDSClient, RTDSMessage
from src.realtime.trade_processor import TradeProcessor

logger = logging.getLogger(__name__)


class TradeMonitorService:
    """
    Main service orchestrating RTDS client and trade processor.

    Provides:
    - WebSocket connection to Polymarket RTDS
    - Trade enrichment and storage
    - Alert generation
    - Statistics reporting
    """

    STATS_INTERVAL_SECONDS = 60

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        filter_markets: list[str] | None = None,
        filter_events: list[str] | None = None,
    ):
        """
        Initialize the trade monitor service.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            filter_markets: Optional list of market slugs to filter
            filter_events: Optional list of event slugs to filter
        """
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key

        # Create processor
        self.processor = TradeProcessor(supabase_url, supabase_key)

        # Create WebSocket client
        self.client = RTDSClient(
            on_trade=self._handle_trade,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
            filter_markets=filter_markets,
            filter_events=filter_events,
        )

        self._start_time: datetime | None = None
        self._running = False
        self._stats_task: asyncio.Task | None = None

    async def _handle_trade(self, trade: RTDSMessage) -> None:
        """Handle incoming trade from RTDS."""
        await self.processor.process_trade(trade)

    async def _on_connect(self) -> None:
        """Handle WebSocket connection."""
        logger.info("RTDS connected - monitoring all Polymarket trades")

    async def _on_disconnect(self, reason: str) -> None:
        """Handle WebSocket disconnection."""
        logger.warning(f"RTDS disconnected: {reason}")

    async def start(self) -> None:
        """Start the monitoring service."""
        self._start_time = datetime.now(timezone.utc)
        self._running = True

        logger.info("=" * 60)
        logger.info("POLYMARKET REAL-TIME TRADE MONITOR")
        logger.info("=" * 60)

        # Initialize processor caches
        await self.processor.initialize()

        # Start background tasks
        await self.processor.start_background_tasks()
        self._stats_task = asyncio.create_task(self._stats_reporter())

        logger.info("Trade monitor service started")
        logger.info(f"Whale threshold: ${self.processor.WHALE_THRESHOLD_USD:,}")
        logger.info(f"Watchlist size: {len(self.processor._watchlist_cache)}")
        logger.info("=" * 60)

        # Start WebSocket client (this blocks until stopped)
        try:
            await self.client.start()
        except asyncio.CancelledError:
            logger.info("Service received cancel signal")

    async def stop(self) -> None:
        """Stop the monitoring service gracefully."""
        logger.info("Stopping trade monitor service...")
        self._running = False

        # Stop WebSocket client
        await self.client.stop()

        # Stop background tasks
        if self._stats_task:
            self._stats_task.cancel()
            try:
                await self._stats_task
            except asyncio.CancelledError:
                pass

        await self.processor.stop_background_tasks()

        # Final stats
        self._log_stats()
        logger.info("Trade monitor service stopped")

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

    def _log_stats(self) -> None:
        """Log current statistics."""
        client_stats = self.client.stats
        processor_stats = self.processor.stats

        uptime = client_stats.get("uptime_seconds", 0)
        uptime_str = f"{int(uptime // 3600)}h {int((uptime % 3600) // 60)}m"

        # Discovery stats
        discovery = processor_stats.get("discovery", {})
        discovered = discovery.get("wallets_discovered", 0)
        analyzed = discovery.get("wallets_processed", 0)

        logger.info(
            f"[STATS] "
            f"Trades: {processor_stats['trades_processed']:,} seen, "
            f"{processor_stats['trades_stored']:,} saved (>=$100) | "
            f"Wallets: {discovered:,} discovered, {analyzed:,} analyzed | "
            f"Alerts: {processor_stats['alerts_triggered']} | "
            f"Errors: {processor_stats['errors']} | "
            f"Uptime: {uptime_str}"
        )

    @property
    def stats(self) -> dict:
        """Get combined service statistics."""
        return {
            "client": self.client.stats,
            "processor": self.processor.stats,
            "start_time": self._start_time.isoformat() if self._start_time else None,
            "running": self._running,
        }


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


async def main() -> None:
    """Entry point for the trade monitor service."""
    # Load environment variables
    load_dotenv()

    # Setup logging
    log_level = os.getenv("LOG_LEVEL", "INFO")
    setup_logging(log_level)

    # Get configuration
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        logger.error("SUPABASE_URL and SUPABASE_KEY environment variables required")
        sys.exit(1)

    # Optional filters
    filter_markets = None
    filter_events = None
    if os.getenv("FILTER_MARKETS"):
        filter_markets = os.getenv("FILTER_MARKETS").split(",")
    if os.getenv("FILTER_EVENTS"):
        filter_events = os.getenv("FILTER_EVENTS").split(",")

    # Create service
    service = TradeMonitorService(
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        filter_markets=filter_markets,
        filter_events=filter_events,
    )

    # Setup signal handlers for graceful shutdown
    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def signal_handler() -> None:
        logger.info("Received shutdown signal")
        shutdown_event.set()

    # Register signal handlers (Unix-style, may not work on Windows)
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, signal_handler)
    except NotImplementedError:
        # Windows doesn't support add_signal_handler
        pass

    # Run service
    try:
        # Start service in background
        service_task = asyncio.create_task(service.start())

        # Wait for shutdown signal or service completion
        done, pending = await asyncio.wait(
            [service_task, asyncio.create_task(shutdown_event.wait())],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Cancel pending tasks
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
