"""
RTDS WebSocket client for real-time Polymarket trade monitoring.

Connects to wss://ws-live-data.polymarket.com and subscribes to
the activity/trades topic to receive all trades in real-time.
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
class RTDSMessage:
    """Parsed RTDS trade message."""

    trade_id: str
    trader_address: str
    condition_id: str
    asset_id: Optional[str]
    event_slug: Optional[str]
    market_slug: Optional[str]
    side: str  # BUY or SELL
    outcome: Optional[str]
    outcome_index: int
    size: float
    price: float
    usd_value: float
    tx_hash: Optional[str]
    executed_at: datetime
    raw_data: dict = field(repr=False)


# Type alias for callbacks
TradeCallback = Callable[[RTDSMessage], Awaitable[None] | None]
ConnectCallback = Callable[[], Awaitable[None] | None]
DisconnectCallback = Callable[[str], Awaitable[None] | None]


class RTDSClient:
    """
    Real-Time Data Service WebSocket client.

    Connects to Polymarket's RTDS and streams all trade events
    with automatic reconnection and backpressure handling.

    Usage:
        async def handle_trade(trade: RTDSMessage):
            print(f"Trade: {trade.trader_address} {trade.side} ${trade.usd_value}")

        client = RTDSClient(on_trade=handle_trade)
        await client.start()
    """

    RTDS_URL = "wss://ws-live-data.polymarket.com"
    RECONNECT_BASE_DELAY = 5  # seconds
    MAX_RECONNECT_DELAY = 60  # seconds
    HEARTBEAT_INTERVAL = 30  # seconds
    CONNECTION_TIMEOUT = 30  # seconds

    def __init__(
        self,
        on_trade: TradeCallback,
        on_connect: Optional[ConnectCallback] = None,
        on_disconnect: Optional[DisconnectCallback] = None,
        filter_markets: Optional[list[str]] = None,
        filter_events: Optional[list[str]] = None,
    ):
        """
        Initialize RTDS client.

        Args:
            on_trade: Async callback for each trade received
            on_connect: Optional async callback when connected
            on_disconnect: Optional async callback when disconnected
            filter_markets: Optional list of market_slugs to filter (empty = all)
            filter_events: Optional list of event_slugs to filter (empty = all)
        """
        self.on_trade = on_trade
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        self.filter_markets = filter_markets
        self.filter_events = filter_events

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._running = False
        self._reconnect_count = 0
        self._last_message_time: Optional[datetime] = None
        self._message_count = 0
        self._trade_count = 0
        self._error_count = 0
        self._connected_at: Optional[datetime] = None

    async def connect(self) -> None:
        """Establish WebSocket connection and subscribe to trades."""
        while self._running:
            try:
                logger.info(f"Connecting to RTDS: {self.RTDS_URL}")

                async with websockets.connect(
                    self.RTDS_URL,
                    ping_interval=self.HEARTBEAT_INTERVAL,
                    ping_timeout=10,
                    close_timeout=10,
                    max_size=10 * 1024 * 1024,  # 10MB max message
                    open_timeout=self.CONNECTION_TIMEOUT,
                ) as ws:
                    self._ws = ws
                    self._reconnect_count = 0
                    self._connected_at = datetime.now(timezone.utc)

                    logger.info("Connected to RTDS successfully")

                    if self.on_connect:
                        await self._safe_callback(self.on_connect)

                    # Subscribe to trades
                    await self._subscribe()

                    # Process messages
                    await self._receive_loop()

            except ConnectionClosed as e:
                logger.warning(f"RTDS connection closed: code={e.code}, reason={e.reason}")
                await self._handle_disconnect(f"Connection closed: {e.reason}")

            except ConnectionClosedError as e:
                logger.warning(f"RTDS connection closed with error: {e}")
                await self._handle_disconnect(str(e))

            except asyncio.TimeoutError:
                logger.error("RTDS connection timeout")
                await self._handle_disconnect("Connection timeout")

            except Exception as e:
                logger.error(f"RTDS error: {type(e).__name__}: {e}")
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

    async def _subscribe(self) -> None:
        """Subscribe to the activity/trades topic."""
        # Build subscription message
        subscription = {
            "topic": "activity",
            "type": "trades",
        }

        # Add filters if specified
        filters = {}
        if self.filter_markets:
            filters["market_slug"] = self.filter_markets[0] if len(self.filter_markets) == 1 else None
        if self.filter_events:
            filters["event_slug"] = self.filter_events[0] if len(self.filter_events) == 1 else None

        if filters:
            subscription["filters"] = json.dumps({k: v for k, v in filters.items() if v})

        subscribe_msg = {
            "action": "subscribe",
            "subscriptions": [subscription],
        }

        await self._ws.send(json.dumps(subscribe_msg))
        logger.info(f"Subscribed to activity/trades topic (filters: {filters or 'none'})")

    async def _receive_loop(self) -> None:
        """Main message receive loop."""
        async for message in self._ws:
            try:
                data = json.loads(message)
                self._last_message_time = datetime.now(timezone.utc)
                self._message_count += 1

                # Handle different message types
                msg_type = data.get("type") or data.get("topic")

                if msg_type in ("trade", "trades", "activity"):
                    # Could be a single trade or wrapped in payload
                    payload = data.get("payload", data)

                    # Handle array of trades
                    if isinstance(payload, list):
                        for trade_data in payload:
                            await self._process_trade(trade_data)
                    else:
                        await self._process_trade(payload)

                elif msg_type == "subscribed":
                    logger.debug(f"Subscription confirmed: {data}")

                elif msg_type == "error":
                    logger.error(f"RTDS error message: {data}")
                    self._error_count += 1

                elif msg_type == "pong":
                    logger.debug("Received pong")

                else:
                    logger.debug(f"Unknown message type: {msg_type}, data: {str(data)[:200]}")

            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON received: {message[:100]}")
                self._error_count += 1
            except Exception as e:
                logger.error(f"Error processing message: {type(e).__name__}: {e}")
                self._error_count += 1

    async def _process_trade(self, data: dict) -> None:
        """Process a single trade message."""
        trade = self._parse_trade(data)
        if trade:
            self._trade_count += 1
            await self._safe_callback(self.on_trade, trade)

    def _parse_trade(self, data: dict) -> Optional[RTDSMessage]:
        """Parse raw RTDS message into RTDSMessage."""
        try:
            # Extract trade ID
            trade_id = (
                data.get("id")
                or data.get("tradeId")
                or data.get("trade_id")
                or f"{data.get('user', 'unknown')}_{data.get('timestamp', 0)}"
            )

            # Extract trader address (proxyWallet is the main field in RTDS)
            trader_address = (
                data.get("proxyWallet")
                or data.get("user")
                or data.get("userAddress")
                or data.get("trader_address")
                or data.get("maker")
                or data.get("taker")
            )
            if not trader_address:
                logger.debug(f"No trader address in trade: {str(data)[:200]}")
                return None
            trader_address = trader_address.lower()

            # Extract execution timestamp
            ts = data.get("timestamp") or data.get("executedAt") or data.get("executed_at")
            if ts:
                if isinstance(ts, (int, float)):
                    # Handle milliseconds vs seconds
                    if ts > 1e12:
                        executed_at = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                    else:
                        executed_at = datetime.fromtimestamp(ts, tz=timezone.utc)
                elif isinstance(ts, str):
                    executed_at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                else:
                    executed_at = datetime.now(timezone.utc)
            else:
                executed_at = datetime.now(timezone.utc)

            # Extract size and price
            size = float(data.get("size") or data.get("amount") or 0)
            price = float(data.get("price") or data.get("avgPrice") or 0)

            # Calculate USD value (size * price for shares, or direct if already USD)
            usd_value = float(data.get("usdValue") or data.get("usd_value") or (size * price))

            # Extract side
            side = (data.get("side") or data.get("type") or "BUY").upper()
            if side not in ("BUY", "SELL"):
                # Map common variations
                side = "BUY" if side in ("LONG", "YES", "0") else "SELL"

            # Extract condition/market info
            condition_id = (
                data.get("conditionId")
                or data.get("condition_id")
                or data.get("marketId")
                or data.get("market_id")
                or ""
            )

            # Extract market slug (RTDS uses 'slug' field)
            market_slug = (
                data.get("slug")
                or data.get("marketSlug")
                or data.get("market_slug")
            )

            # Extract event slug
            event_slug = (
                data.get("eventSlug")
                or data.get("event_slug")
            )

            return RTDSMessage(
                trade_id=str(trade_id),
                trader_address=trader_address,
                condition_id=str(condition_id),
                asset_id=data.get("asset") or data.get("assetId") or data.get("asset_id"),
                event_slug=event_slug,
                market_slug=market_slug,
                side=side,
                outcome=data.get("outcome") or data.get("outcomeName") or data.get("outcome_name"),
                outcome_index=int(data.get("outcomeIndex") or data.get("outcome_index") or 0),
                size=size,
                price=price,
                usd_value=usd_value,
                tx_hash=data.get("transactionHash") or data.get("txHash") or data.get("tx_hash"),
                executed_at=executed_at,
                raw_data=data,
            )

        except Exception as e:
            logger.error(f"Failed to parse trade: {e}, data: {str(data)[:200]}")
            self._error_count += 1
            return None

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
            logger.warning("Client already running")
            return
        self._running = True
        logger.info("Starting RTDS client")
        await self.connect()

    async def stop(self) -> None:
        """Stop the WebSocket client gracefully."""
        logger.info("Stopping RTDS client")
        self._running = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception as e:
                logger.warning(f"Error closing WebSocket: {e}")
            self._ws = None

    @property
    def is_connected(self) -> bool:
        """Check if currently connected."""
        return self._ws is not None and self._ws.open

    @property
    def stats(self) -> dict:
        """Get client statistics."""
        return {
            "connected": self.is_connected,
            "message_count": self._message_count,
            "trade_count": self._trade_count,
            "error_count": self._error_count,
            "last_message": self._last_message_time.isoformat() if self._last_message_time else None,
            "connected_at": self._connected_at.isoformat() if self._connected_at else None,
            "reconnect_count": self._reconnect_count,
            "uptime_seconds": (
                (datetime.now(timezone.utc) - self._connected_at).total_seconds()
                if self._connected_at
                else 0
            ),
        }
