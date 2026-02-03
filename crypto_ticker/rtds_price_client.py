"""
Polymarket RTDS WebSocket client for real-time crypto prices.

Connects to Polymarket's RTDS WebSocket to get BTC/ETH spot prices
via the crypto_prices topic.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Callable, Awaitable

import websockets
from websockets.exceptions import ConnectionClosed, ConnectionClosedError

logger = logging.getLogger(__name__)


PriceCallback = Callable[[str, float, int], Awaitable[None] | None]


class RtdsPriceClient:
    """
    Polymarket RTDS WebSocket client for crypto spot prices.

    Subscribes to crypto_prices topic to get real-time BTC/ETH prices.
    """

    # Polymarket RTDS WebSocket
    RTDS_WS_URL = "wss://ws-live-data.polymarket.com"
    RECONNECT_BASE_DELAY = 5
    MAX_RECONNECT_DELAY = 60
    CONNECTION_TIMEOUT = 30
    STALE_THRESHOLD = 120
    PING_INTERVAL = 5  # RTDS recommends ping every 5 seconds

    def __init__(
        self,
        symbols: list[str],
        on_price: Optional[PriceCallback] = None,
    ):
        """
        Args:
            symbols: List of symbols like ["btcusdt", "ethusdt"]
            on_price: Optional callback(symbol, price, timestamp_ms)
        """
        self.symbols = [s.lower() for s in symbols]
        self.on_price = on_price

        self._ws = None
        self._running = False
        self._reconnect_count = 0
        self._last_message_time = None
        self._prices: dict[str, tuple[float, int]] = {}  # symbol -> (price, timestamp_ms)

    def get_price(self, symbol: str) -> Optional[tuple[float, int]]:
        """Get latest price for symbol. Returns (price, timestamp_ms) or None."""
        return self._prices.get(symbol.lower())

    async def connect(self) -> None:
        """Establish WebSocket connection."""
        while self._running:
            try:
                logger.info(f"Connecting to RTDS: {self.RTDS_WS_URL}")

                async with websockets.connect(
                    self.RTDS_WS_URL,
                    ping_interval=self.PING_INTERVAL,
                    ping_timeout=10,
                    close_timeout=10,
                    max_size=10 * 1024 * 1024,
                    open_timeout=self.CONNECTION_TIMEOUT,
                ) as ws:
                    self._ws = ws
                    self._reconnect_count = 0
                    logger.info("Connected to RTDS for crypto prices")

                    # Subscribe to crypto_prices topic
                    await self._subscribe()

                    stale_task = asyncio.create_task(self._monitor_stale())
                    try:
                        await self._receive_loop()
                    finally:
                        stale_task.cancel()
                        try:
                            await stale_task
                        except asyncio.CancelledError:
                            pass

            except (ConnectionClosed, ConnectionClosedError) as e:
                logger.warning(f"RTDS connection closed: {e}")
            except asyncio.TimeoutError:
                logger.error("RTDS connection timeout")
            except Exception as e:
                logger.error(f"RTDS error: {type(e).__name__}: {e}")

            if self._running:
                self._reconnect_count += 1
                delay = min(
                    self.RECONNECT_BASE_DELAY * (2 ** min(self._reconnect_count - 1, 4)),
                    self.MAX_RECONNECT_DELAY,
                )
                logger.info(f"RTDS reconnecting in {delay}s")
                await asyncio.sleep(delay)

    async def _subscribe(self) -> None:
        """Subscribe to crypto_prices topic."""
        # Subscribe to all crypto prices (no filter) - we filter locally by symbols
        # RTDS requires filters as JSON string if provided
        subscription = {
            "action": "subscribe",
            "subscriptions": [
                {
                    "topic": "crypto_prices",
                    "type": "update",
                }
            ],
        }

        await self._ws.send(json.dumps(subscription))
        logger.info(f"Subscribed to crypto prices (filtering for: {self.symbols})")

    async def _monitor_stale(self) -> None:
        """Monitor for stale connection."""
        while self._running and self._ws:
            await asyncio.sleep(30)
            if self._last_message_time:
                elapsed = (datetime.now(timezone.utc) - self._last_message_time).total_seconds()
                if elapsed > self.STALE_THRESHOLD:
                    logger.warning(f"RTDS stale: {elapsed:.0f}s")
                    if self._ws:
                        try:
                            await self._ws.close(code=4000, reason="Stale")
                        except Exception:
                            pass
                    break

    async def _receive_loop(self) -> None:
        """Main message receive loop."""
        msg_count = 0
        async for message in self._ws:
            try:
                data = json.loads(message)
                self._last_message_time = datetime.now(timezone.utc)
                msg_count += 1

                # Debug first few messages
                if msg_count <= 3:
                    logger.info(f"RTDS msg #{msg_count}: {str(data)[:200]}")

                # Handle crypto_prices messages
                topic = data.get("topic")
                msg_type = data.get("type")

                if topic == "crypto_prices" and msg_type == "update":
                    payload = data.get("payload", {})
                    symbol = payload.get("symbol", "").lower()
                    value = payload.get("value")
                    timestamp_ms = payload.get("timestamp", 0)

                    # Only process symbols we care about
                    if symbol and value is not None and symbol in self.symbols:
                        price = float(value)
                        self._prices[symbol] = (price, int(timestamp_ms))

                        if self.on_price:
                            try:
                                result = self.on_price(symbol, price, int(timestamp_ms))
                                if asyncio.iscoroutine(result):
                                    await result
                            except Exception as e:
                                logger.debug(f"Price callback error: {e}")

                elif msg_type == "subscribed":
                    logger.debug(f"Subscription confirmed: {data}")

                elif msg_type == "error":
                    logger.error(f"RTDS error: {data}")

            except json.JSONDecodeError:
                pass
            except Exception as e:
                logger.debug(f"RTDS message error: {e}")

    async def start(self) -> None:
        """Start the client."""
        if self._running:
            return
        self._running = True
        await self.connect()

    async def stop(self) -> None:
        """Stop the client."""
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    @property
    def is_connected(self) -> bool:
        """Check if connected."""
        return self._ws is not None
