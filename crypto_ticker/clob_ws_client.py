"""
CLOB WebSocket client for real-time bid/ask data.

Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
and subscribes to price updates for crypto markets.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Callable, Any, Awaitable
from dataclasses import dataclass, field

import websockets
from websockets.exceptions import ConnectionClosed, ConnectionClosedError

logger = logging.getLogger(__name__)


@dataclass
class TickMessage:
    """Parsed tick message from CLOB WebSocket."""

    event_type: str  # "book", "price_change"
    asset_id: str  # Token ID
    timestamp: datetime  # Tick timestamp (ms precision)

    # Order book data
    best_bid: Optional[float] = None
    best_ask: Optional[float] = None

    # For book events - full order book (optional)
    bids: list[dict] = field(default_factory=list)
    asks: list[dict] = field(default_factory=list)

    # Price change specific
    price: Optional[float] = None
    size: Optional[float] = None
    side: Optional[str] = None

    book_hash: Optional[str] = None
    raw_data: dict = field(repr=False, default_factory=dict)


# Type aliases for callbacks
TickCallback = Callable[[TickMessage], Awaitable[None] | None]
ConnectCallback = Callable[[], Awaitable[None] | None]
DisconnectCallback = Callable[[str], Awaitable[None] | None]


class ClobWebSocketClient:
    """
    CLOB Market Channel WebSocket client.

    Connects to Polymarket's CLOB WebSocket and streams order book updates
    for best bid/ask prices.
    """

    CLOB_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
    RECONNECT_BASE_DELAY = 5  # seconds
    MAX_RECONNECT_DELAY = 60  # seconds
    HEARTBEAT_INTERVAL = 30  # seconds
    CONNECTION_TIMEOUT = 30  # seconds
    STALE_THRESHOLD = 120  # seconds without messages = stale connection

    def __init__(
        self,
        on_tick: TickCallback,
        asset_ids: list[str],
        on_connect: Optional[ConnectCallback] = None,
        on_disconnect: Optional[DisconnectCallback] = None,
    ):
        """
        Initialize CLOB WebSocket client.

        Args:
            on_tick: Async callback for each tick received
            asset_ids: List of token IDs to subscribe to
            on_connect: Optional callback when connected
            on_disconnect: Optional callback when disconnected
        """
        self.on_tick = on_tick
        self.asset_ids = list(asset_ids)
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._reconnect_count = 0
        self._last_message_time: Optional[datetime] = None
        self._message_count = 0
        self._tick_count = 0
        self._error_count = 0
        self._connected_at: Optional[datetime] = None

    async def connect(self) -> None:
        """Establish WebSocket connection and subscribe to markets."""
        while self._running:
            try:
                logger.info(f"Connecting to CLOB WebSocket: {self.CLOB_WS_URL}")

                async with websockets.connect(
                    self.CLOB_WS_URL,
                    ping_interval=self.HEARTBEAT_INTERVAL,
                    ping_timeout=10,
                    close_timeout=10,
                    max_size=10 * 1024 * 1024,  # 10MB max message
                    open_timeout=self.CONNECTION_TIMEOUT,
                ) as ws:
                    self._ws = ws
                    self._reconnect_count = 0
                    self._connected_at = datetime.now(timezone.utc)

                    logger.info("Connected to CLOB WebSocket successfully")

                    if self.on_connect:
                        await self._safe_callback(self.on_connect)

                    # Subscribe to market channel
                    await self._subscribe()

                    # Start stale connection monitor
                    stale_task = asyncio.create_task(self._monitor_stale_connection())

                    try:
                        await self._receive_loop()
                    finally:
                        stale_task.cancel()
                        try:
                            await stale_task
                        except asyncio.CancelledError:
                            pass

            except ConnectionClosed as e:
                logger.warning(f"CLOB connection closed: code={e.code}, reason={e.reason}")
                await self._handle_disconnect(f"Connection closed: {e.reason}")

            except ConnectionClosedError as e:
                logger.warning(f"CLOB connection closed with error: {e}")
                await self._handle_disconnect(str(e))

            except asyncio.TimeoutError:
                logger.error("CLOB connection timeout")
                await self._handle_disconnect("Connection timeout")

            except Exception as e:
                logger.error(f"CLOB error: {type(e).__name__}: {e}")
                self._error_count += 1
                await self._handle_disconnect(str(e))

            # Reconnect with exponential backoff
            if self._running:
                self._reconnect_count += 1
                delay = min(
                    self.RECONNECT_BASE_DELAY * (2 ** min(self._reconnect_count - 1, 4)),
                    self.MAX_RECONNECT_DELAY,
                )
                logger.info(f"Reconnecting in {delay}s (attempt {self._reconnect_count})")
                await asyncio.sleep(delay)

    async def _handle_disconnect(self, reason: str) -> None:
        """Handle disconnection."""
        self._ws = None
        self._connected_at = None
        if self.on_disconnect:
            await self._safe_callback(self.on_disconnect, reason)

    async def _monitor_stale_connection(self) -> None:
        """Monitor for stale connections and force reconnect if no data received."""
        while self._running and self._ws:
            await asyncio.sleep(30)

            if self._last_message_time:
                seconds_since_message = (
                    datetime.now(timezone.utc) - self._last_message_time
                ).total_seconds()

                if seconds_since_message > self.STALE_THRESHOLD:
                    logger.warning(
                        f"Stale connection detected: {seconds_since_message:.0f}s since last message. "
                        "Forcing reconnection..."
                    )
                    if self._ws:
                        try:
                            await self._ws.close(code=4000, reason="Stale connection")
                        except Exception as e:
                            logger.debug(f"Error closing stale connection: {e}")
                    break

    async def _subscribe(self) -> None:
        """Subscribe to the market channel for asset_ids."""
        if not self.asset_ids:
            logger.warning("No asset IDs to subscribe to")
            return

        # Correct Polymarket CLOB subscription format
        # See: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
        subscription = {
            "assets_ids": self.asset_ids,
            "type": "market",
        }

        await self._ws.send(json.dumps(subscription))
        logger.info(f"Subscribed to {len(self.asset_ids)} token IDs")

    async def update_subscriptions(self, new_asset_ids: list[str]) -> None:
        """Update subscriptions by reconnecting with new token list."""
        added = set(new_asset_ids) - set(self.asset_ids)
        if not added:
            return
        self.asset_ids = list(set(self.asset_ids) | set(new_asset_ids))
        # Force reconnect to pick up new subscriptions
        if self._ws:
            logger.info(f"Reconnecting CLOB WS for {len(added)} new tokens")
            try:
                await self._ws.close(code=4001, reason="Subscription update")
            except Exception:
                pass

    async def _receive_loop(self) -> None:
        """Main message receive loop."""
        async for message in self._ws:
            try:
                data = json.loads(message)
                self._last_message_time = datetime.now(timezone.utc)
                self._message_count += 1

                # Debug: log first few messages
                if self._message_count <= 5:
                    logger.info(f"CLOB msg #{self._message_count}: {str(data)[:300]}")

                # Handle array of messages
                if isinstance(data, list):
                    for item in data:
                        await self._process_message(item)
                    continue

                await self._process_message(data)

            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON received: {message[:100]}")
                self._error_count += 1
            except Exception as e:
                logger.error(f"Error processing message: {type(e).__name__}: {e}")
                self._error_count += 1

    async def _process_message(self, data: dict) -> None:
        """Process a single message."""
        if not isinstance(data, dict):
            return

        # Handle price_changes format: {"market": "0x...", "price_changes": [{...}]}
        # This is the primary real-time update format from CLOB WS
        if "price_changes" in data:
            for change in data["price_changes"]:
                tick = self._parse_price_change_message(change)
                if tick:
                    self._tick_count += 1
                    await self._safe_callback(self.on_tick, tick)
            return

        # Handle explicit event_type messages
        event_type = data.get("event_type") or data.get("type")

        if event_type == "price_change":
            tick = self._parse_price_change_message(data)
            if tick:
                self._tick_count += 1
                await self._safe_callback(self.on_tick, tick)

        elif event_type in ("book", "subscribed", "connected"):
            # Skip book snapshots — thin markets have 0.01/0.99 limit orders
            # that don't reflect real prices. Only price_changes have real data.
            logger.debug(f"Skipping {event_type} event")

        elif event_type == "error":
            logger.error(f"CLOB error message: {data}")
            self._error_count += 1

    def _parse_book_message(self, data: dict) -> Optional[TickMessage]:
        """Parse 'book' event into TickMessage."""
        try:
            bids = data.get("bids") or data.get("buys") or []
            asks = data.get("asks") or data.get("sells") or []

            # Best bid is highest bid, best ask is lowest ask
            best_bid = float(bids[0]["price"]) if bids else None
            best_ask = float(asks[0]["price"]) if asks else None

            return TickMessage(
                event_type="book",
                asset_id=data.get("asset_id", ""),
                timestamp=self._parse_timestamp(data.get("timestamp")),
                best_bid=best_bid,
                best_ask=best_ask,
                bids=[{"price": b["price"], "size": b["size"]} for b in bids[:5]],
                asks=[{"price": a["price"], "size": a["size"]} for a in asks[:5]],
                book_hash=data.get("hash"),
                raw_data=data,
            )
        except Exception as e:
            logger.debug(f"Error parsing book message: {e}")
            return None

    def _parse_price_change_message(self, data: dict) -> Optional[TickMessage]:
        """Parse 'price_change' event into TickMessage."""
        try:
            return TickMessage(
                event_type="price_change",
                asset_id=data.get("asset_id", ""),
                timestamp=self._parse_timestamp(data.get("timestamp")),
                best_bid=float(data["best_bid"]) if data.get("best_bid") else None,
                best_ask=float(data["best_ask"]) if data.get("best_ask") else None,
                price=float(data["price"]) if data.get("price") else None,
                size=float(data["size"]) if data.get("size") else None,
                side=data.get("side"),
                book_hash=data.get("hash"),
                raw_data=data,
            )
        except Exception as e:
            logger.debug(f"Error parsing price_change message: {e}")
            return None

    def _parse_generic_tick(self, data: dict) -> Optional[TickMessage]:
        """Parse generic tick data."""
        try:
            bids = data.get("bids") or data.get("buys") or []
            asks = data.get("asks") or data.get("sells") or []

            best_bid = data.get("best_bid")
            best_ask = data.get("best_ask")

            if best_bid is None and bids:
                best_bid = float(bids[0]["price"])
            if best_ask is None and asks:
                best_ask = float(asks[0]["price"])

            return TickMessage(
                event_type="tick",
                asset_id=data.get("asset_id", ""),
                timestamp=self._parse_timestamp(data.get("timestamp")),
                best_bid=float(best_bid) if best_bid else None,
                best_ask=float(best_ask) if best_ask else None,
                raw_data=data,
            )
        except Exception as e:
            logger.debug(f"Error parsing generic tick: {e}")
            return None

    def _parse_timestamp(self, ts: Any) -> datetime:
        """Parse timestamp from various formats."""
        if ts is None:
            return datetime.now(timezone.utc)

        try:
            if isinstance(ts, (int, float)):
                # Handle milliseconds vs seconds
                if ts > 1e12:
                    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                else:
                    return datetime.fromtimestamp(ts, tz=timezone.utc)
            elif isinstance(ts, str):
                return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            pass

        return datetime.now(timezone.utc)

    async def _safe_callback(self, callback: Callable, *args: Any) -> None:
        """Execute callback safely (handles both sync and async)."""
        try:
            result = callback(*args)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            logger.error(f"Callback error: {type(e).__name__}: {e}")
            self._error_count += 1

    async def start(self) -> None:
        """Start the WebSocket client."""
        if self._running:
            logger.warning("CLOB client already running")
            return
        self._running = True
        logger.info("Starting CLOB WebSocket client")
        await self.connect()

    async def stop(self) -> None:
        """Stop the WebSocket client gracefully."""
        logger.info("Stopping CLOB WebSocket client")
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception as e:
                logger.warning(f"Error closing CLOB WebSocket: {e}")
            self._ws = None

    @property
    def is_connected(self) -> bool:
        """Check if currently connected."""
        if self._ws is None:
            return False
        try:
            if hasattr(self._ws, "state"):
                from websockets.protocol import State

                return self._ws.state == State.OPEN
            elif hasattr(self._ws, "open"):
                return self._ws.open
            else:
                return True
        except Exception:
            return False

    @property
    def stats(self) -> dict:
        """Get client statistics."""
        return {
            "connected": self.is_connected,
            "message_count": self._message_count,
            "tick_count": self._tick_count,
            "error_count": self._error_count,
            "last_message": self._last_message_time.isoformat() if self._last_message_time else None,
            "connected_at": self._connected_at.isoformat() if self._connected_at else None,
            "reconnect_count": self._reconnect_count,
            "subscribed_tokens": len(self.asset_ids),
            "uptime_seconds": (
                (datetime.now(timezone.utc) - self._connected_at).total_seconds()
                if self._connected_at
                else 0
            ),
        }
