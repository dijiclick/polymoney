"""
Crypto Ticker Service - Real-time bid/ask tick data from Polymarket crypto markets.

Collects ticks for rotating up-or-down markets (15m, 1h, 4h) for BTC, ETH, SOL, XRP.

Usage:
    python -m crypto_ticker.service
"""

import asyncio
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add parent directory to path for standalone execution
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

from crypto_ticker.market_resolver import MarketResolver, CryptoMarket
from crypto_ticker.clob_ws_client import ClobWebSocketClient, TickMessage
from crypto_ticker.rtds_price_client import RtdsPriceClient
from crypto_ticker.csv_writer import CsvWriter, TickData

logger = logging.getLogger(__name__)


# Map crypto symbols to RTDS price symbols
SYMBOL_TO_RTDS = {
    "BTC": "btcusdt",
    "ETH": "ethusdt",
    "SOL": "solusdt",
    "XRP": "xrpusdt",
}


class CryptoTickerService:
    """Main service for crypto tick data collection."""

    STATS_INTERVAL = 60
    # Refresh every 60s to catch new 15m markets quickly
    MARKET_REFRESH_INTERVAL = 60

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.resolver = MarketResolver()
        self.csv_writer = CsvWriter(data_dir)
        self.clob_client: ClobWebSocketClient | None = None
        self.price_client: RtdsPriceClient | None = None

        self._running = False
        self._start_time: datetime | None = None
        self._tick_count = 0

        # Track latest bid/ask per market (condition_id -> {up: {bid, ask}, down: {bid, ask}})
        self._market_prices: dict[str, dict] = {}

    async def _handle_tick(self, tick: TickMessage) -> None:
        """Handle bid/ask tick from CLOB WebSocket."""
        market = self.resolver.get_market_by_token(tick.asset_id)
        if not market:
            return

        # Determine if this is Up or Down token
        is_up = tick.asset_id == market.token_id_up

        # Update market prices
        if market.condition_id not in self._market_prices:
            self._market_prices[market.condition_id] = {
                "up": {"bid": None, "ask": None},
                "down": {"bid": None, "ask": None},
            }

        prices = self._market_prices[market.condition_id]
        side = "up" if is_up else "down"
        if tick.best_bid is not None:
            prices[side]["bid"] = tick.best_bid
        if tick.best_ask is not None:
            prices[side]["ask"] = tick.best_ask

        # Check if we have all 4 prices
        up_bid = prices["up"]["bid"]
        up_ask = prices["up"]["ask"]
        down_bid = prices["down"]["bid"]
        down_ask = prices["down"]["ask"]

        if None in (up_bid, up_ask, down_bid, down_ask):
            return  # Wait until we have all prices

        # Get crypto spot price
        rtds_symbol = SYMBOL_TO_RTDS.get(market.crypto_symbol)
        if not rtds_symbol:
            return

        price_data = self.price_client.get_price(rtds_symbol) if self.price_client else None
        if not price_data:
            return  # No price yet

        market_price, _ = price_data
        timestamp_ms = int(tick.timestamp.timestamp() * 1000)

        # Write tick to CSV
        tick_data = TickData(
            symbol=market.crypto_symbol,
            timeframe=market.timeframe,
            best_bid_up=up_bid,
            best_bid_down=down_bid,
            best_ask_up=up_ask,
            best_ask_down=down_ask,
            timestamp_ms=timestamp_ms,
            market_price=market_price,
        )

        await self.csv_writer.write_tick(tick_data)
        self._tick_count += 1

    async def start(self) -> None:
        """Start the service."""
        self._start_time = datetime.now(timezone.utc)
        self._running = True

        logger.info("=" * 60)
        logger.info("POLYMARKET CRYPTO TICKER SERVICE (15m/1h/4h)")
        logger.info("=" * 60)

        # Initialize CSV writer
        await self.csv_writer.initialize()

        # Discover current markets
        markets = await self.resolver.refresh_markets()
        if not markets:
            logger.warning("No markets found on first try, will retry...")

        # Get token IDs and symbols
        token_ids = self.resolver.get_all_token_ids()
        rtds_symbols = list(SYMBOL_TO_RTDS.values())

        logger.info(f"Subscribing to {len(token_ids)} tokens, {len(rtds_symbols)} price feeds")

        # Create RTDS price client (all 4 symbols always)
        self.price_client = RtdsPriceClient(symbols=rtds_symbols)

        # Create CLOB client
        self.clob_client = ClobWebSocketClient(
            on_tick=self._handle_tick,
            asset_ids=token_ids,
        )

        # Start background tasks
        asyncio.create_task(self._stats_reporter())
        asyncio.create_task(self._market_refresher())

        # Start both WebSocket clients
        price_task = asyncio.create_task(self.price_client.start())
        clob_task = asyncio.create_task(self.clob_client.start())

        logger.info("=" * 60)
        logger.info(f"Data directory: {self.data_dir}")
        logger.info("Service started - writing ticks to CSV")
        logger.info("=" * 60)

        # Wait for both to complete (they won't unless stopped)
        try:
            await asyncio.gather(price_task, clob_task)
        except asyncio.CancelledError:
            pass

    async def stop(self) -> None:
        """Stop the service gracefully."""
        logger.info("Stopping crypto ticker service...")
        self._running = False

        if self.clob_client:
            await self.clob_client.stop()
        if self.price_client:
            await self.price_client.stop()

        await self.csv_writer.close()
        await self.resolver.close()

        logger.info(f"Service stopped. Total ticks written: {self._tick_count}")

    async def _stats_reporter(self) -> None:
        """Log statistics periodically."""
        while self._running:
            try:
                await asyncio.sleep(self.STATS_INTERVAL)

                clob_stats = self.clob_client.stats if self.clob_client else {}
                csv_stats = self.csv_writer.stats

                uptime = (datetime.now(timezone.utc) - self._start_time).total_seconds() if self._start_time else 0
                uptime_str = f"{int(uptime // 3600)}h {int((uptime % 3600) // 60)}m"

                active_markets = len(self.resolver.get_all_markets())

                logger.info(
                    f"[STATS] "
                    f"Ticks: {self._tick_count} | "
                    f"CLOB: {clob_stats.get('tick_count', 0)} | "
                    f"Markets: {active_markets} | "
                    f"Files: {csv_stats.get('open_files', 0)} | "
                    f"Uptime: {uptime_str}"
                )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Stats error: {e}")

    async def _market_refresher(self) -> None:
        """Refresh markets every 60s to catch rotating markets."""
        while self._running:
            try:
                await asyncio.sleep(self.MARKET_REFRESH_INTERVAL)

                old_tokens = set(self.resolver.get_all_token_ids())
                await self.resolver.refresh_markets()
                new_tokens = set(self.resolver.get_all_token_ids())

                # Subscribe to new tokens
                added = new_tokens - old_tokens
                if added and self.clob_client:
                    for token_id in added:
                        await self.clob_client.add_subscription(token_id)
                    logger.info(f"Added {len(added)} new token subscriptions")

                # Clean up old market prices for removed markets
                removed = old_tokens - new_tokens
                if removed:
                    # Find condition_ids that no longer have active tokens
                    active_conditions = {
                        m.condition_id for m in self.resolver.get_all_markets()
                    }
                    stale = [
                        cid for cid in self._market_prices
                        if cid not in active_conditions
                    ]
                    for cid in stale:
                        del self._market_prices[cid]

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Market refresh error: {e}")


def setup_logging(level: str = "INFO") -> None:
    """Configure logging."""
    log_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


async def main() -> None:
    """Entry point."""
    load_dotenv()

    log_level = os.getenv("LOG_LEVEL", "INFO")
    setup_logging(log_level)

    data_dir = os.getenv("CRYPTO_TICKER_DATA_DIR", "data/crypto_ticks")

    service = CryptoTickerService(data_dir=data_dir)

    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def signal_handler() -> None:
        logger.info("Received shutdown signal")
        shutdown_event.set()

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, signal_handler)
    except NotImplementedError:
        pass

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
        logger.info("Keyboard interrupt")

    finally:
        await service.stop()


if __name__ == "__main__":
    asyncio.run(main())
