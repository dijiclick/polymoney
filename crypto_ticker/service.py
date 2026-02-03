"""
Crypto Ticker Service - Real-time bid/ask tick data from Polymarket crypto markets.

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
    "DOGE": "dogeusdt",
    "ADA": "adausdt",
    "AVAX": "avaxusdt",
    "LINK": "linkusdt",
    "DOT": "dotusdt",
    "MATIC": "maticusdt",
    "SHIB": "shibusdt",
    "LTC": "ltcusdt",
}


class CryptoTickerService:
    """Main service for crypto tick data collection."""

    STATS_INTERVAL = 60
    MARKET_REFRESH_INTERVAL = 300

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.resolver = MarketResolver()
        self.csv_writer = CsvWriter(data_dir)
        self.clob_client: ClobWebSocketClient | None = None
        self.price_client: RtdsPriceClient | None = None

        self._running = False
        self._start_time: datetime | None = None
        self._tick_count = 0

        # Track latest bid/ask per market (condition_id -> {yes: {bid, ask}, no: {bid, ask}})
        self._market_prices: dict[str, dict] = {}

    async def _handle_tick(self, tick: TickMessage) -> None:
        """Handle bid/ask tick from CLOB WebSocket."""
        market = self.resolver.get_market_by_token(tick.asset_id)
        if not market:
            return

        # Determine if this is YES (up) or NO (down) token
        is_yes = tick.asset_id == market.token_id_yes

        # Update market prices
        if market.condition_id not in self._market_prices:
            self._market_prices[market.condition_id] = {
                "yes": {"bid": None, "ask": None},
                "no": {"bid": None, "ask": None},
            }

        prices = self._market_prices[market.condition_id]
        if is_yes:
            if tick.best_bid is not None:
                prices["yes"]["bid"] = tick.best_bid
            if tick.best_ask is not None:
                prices["yes"]["ask"] = tick.best_ask
        else:
            if tick.best_bid is not None:
                prices["no"]["bid"] = tick.best_bid
            if tick.best_ask is not None:
                prices["no"]["ask"] = tick.best_ask

        # Check if we have all 4 prices
        yes_bid = prices["yes"]["bid"]
        yes_ask = prices["yes"]["ask"]
        no_bid = prices["no"]["bid"]
        no_ask = prices["no"]["ask"]

        if None in (yes_bid, yes_ask, no_bid, no_ask):
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
            best_bid_up=yes_bid,
            best_bid_down=no_bid,
            best_ask_up=yes_ask,
            best_ask_down=no_ask,
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
        logger.info("POLYMARKET CRYPTO TICKER SERVICE")
        logger.info("=" * 60)

        # Initialize CSV writer
        await self.csv_writer.initialize()

        # Discover crypto markets
        markets = await self.resolver.refresh_markets()
        if not markets:
            logger.error("No crypto markets found!")
            return

        logger.info(f"Found {len(markets)} crypto markets")
        for m in markets[:5]:
            logger.info(f"  {m.crypto_symbol}_{m.timeframe}: {m.question[:60]}")

        # Get token IDs and symbols
        token_ids = self.resolver.get_all_token_ids()
        symbols = self.resolver.get_unique_symbols()
        rtds_symbols = [SYMBOL_TO_RTDS[s] for s in symbols if s in SYMBOL_TO_RTDS]

        logger.info(f"Subscribing to {len(token_ids)} tokens, {len(rtds_symbols)} price feeds")

        # Create RTDS price client
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

                logger.info(
                    f"[STATS] "
                    f"Ticks: {self._tick_count} written | "
                    f"CLOB: {clob_stats.get('tick_count', 0)} received | "
                    f"Files: {csv_stats.get('open_files', 0)} | "
                    f"Uptime: {uptime_str}"
                )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Stats error: {e}")

    async def _market_refresher(self) -> None:
        """Refresh markets periodically to catch new ones."""
        while self._running:
            try:
                await asyncio.sleep(self.MARKET_REFRESH_INTERVAL)

                old_count = len(self.resolver.get_all_markets())
                await self.resolver.refresh_markets()
                new_count = len(self.resolver.get_all_markets())

                if new_count != old_count:
                    logger.info(f"Market refresh: {old_count} -> {new_count} markets")

                    # Update CLOB subscriptions
                    if self.clob_client:
                        new_tokens = self.resolver.get_all_token_ids()
                        for token_id in new_tokens:
                            if token_id not in self.clob_client.asset_ids:
                                await self.clob_client.add_subscription(token_id)

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
