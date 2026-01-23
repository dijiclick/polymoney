"""
Polymarket CLOB API client wrapper.

Provides order execution capabilities using the official py-clob-client SDK.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional, Any

from py_clob_client.client import ClobClient as PyClobClient
from py_clob_client.clob_types import OrderArgs, OrderType, ApiCreds
from py_clob_client.constants import POLYGON

logger = logging.getLogger(__name__)


class OrderSide(str, Enum):
    """Order side enum."""
    BUY = "BUY"
    SELL = "SELL"


class OrderStatus(str, Enum):
    """Order status enum."""
    PENDING = "pending"
    OPEN = "open"
    FILLED = "filled"
    PARTIAL = "partial"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass
class Order:
    """Represents an order."""
    order_id: str
    token_id: str
    side: OrderSide
    size: Decimal
    price: Decimal
    status: OrderStatus
    filled_size: Decimal = Decimal("0")
    created_at: datetime = None
    updated_at: datetime = None
    error_message: Optional[str] = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now(timezone.utc)
        if self.updated_at is None:
            self.updated_at = self.created_at


@dataclass
class Fill:
    """Represents a trade fill."""
    fill_id: str
    order_id: str
    token_id: str
    side: OrderSide
    size: Decimal
    price: Decimal
    fee: Decimal
    timestamp: datetime


class ClobClient:
    """
    Wrapper around py-clob-client for Polymarket CLOB operations.

    Provides async-compatible order management with paper trading support.
    """

    def __init__(
        self,
        private_key: str,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        api_passphrase: Optional[str] = None,
        chain_id: int = POLYGON,
        paper_trading: bool = True,
    ):
        """
        Initialize CLOB client.

        Args:
            private_key: Ethereum wallet private key
            api_key: Polymarket API key (optional for read-only)
            api_secret: Polymarket API secret
            api_passphrase: Polymarket API passphrase
            chain_id: Chain ID (default: Polygon mainnet)
            paper_trading: If True, simulate orders without execution
        """
        self.paper_trading = paper_trading
        self._private_key = private_key
        self._chain_id = chain_id

        # Initialize py-clob-client
        creds = None
        if api_key and api_secret and api_passphrase:
            creds = ApiCreds(
                api_key=api_key,
                api_secret=api_secret,
                api_passphrase=api_passphrase,
            )

        self._client = PyClobClient(
            host="https://clob.polymarket.com",
            key=private_key,
            chain_id=chain_id,
            creds=creds,
        )

        # Paper trading state
        self._paper_orders: dict[str, Order] = {}
        self._paper_order_counter = 0

        # Stats
        self._orders_placed = 0
        self._orders_cancelled = 0
        self._total_volume = Decimal("0")

        logger.info(
            f"ClobClient initialized (paper_trading={paper_trading}, "
            f"chain_id={chain_id})"
        )

    async def get_orderbook(self, token_id: str) -> dict:
        """
        Get order book for a token.

        Args:
            token_id: The token/asset ID

        Returns:
            Order book with bids and asks
        """
        try:
            # py-clob-client is synchronous, run in executor
            loop = asyncio.get_event_loop()
            book = await loop.run_in_executor(
                None, self._client.get_order_book, token_id
            )
            return book
        except Exception as e:
            logger.error(f"Failed to get orderbook for {token_id}: {e}")
            raise

    async def get_price(self, token_id: str) -> tuple[Optional[Decimal], Optional[Decimal]]:
        """
        Get current best bid/ask for a token.

        Args:
            token_id: The token/asset ID

        Returns:
            Tuple of (best_bid, best_ask) prices, None if no liquidity
        """
        try:
            book = await self.get_orderbook(token_id)

            best_bid = None
            best_ask = None

            if book.get("bids"):
                best_bid = Decimal(str(book["bids"][0]["price"]))
            if book.get("asks"):
                best_ask = Decimal(str(book["asks"][0]["price"]))

            return best_bid, best_ask

        except Exception as e:
            logger.error(f"Failed to get price for {token_id}: {e}")
            return None, None

    async def place_order(
        self,
        token_id: str,
        side: OrderSide,
        size: Decimal,
        price: Decimal,
        order_type: str = "GTC",
    ) -> Order:
        """
        Place an order.

        Args:
            token_id: The token/asset ID
            side: BUY or SELL
            size: Order size in shares
            price: Limit price
            order_type: Order type (GTC, FOK, IOC)

        Returns:
            Order object with status
        """
        size = Decimal(str(size))
        price = Decimal(str(price))

        logger.info(
            f"Placing order: {side.value} {size} @ {price} "
            f"(token={token_id[:16]}..., paper={self.paper_trading})"
        )

        if self.paper_trading:
            return await self._place_paper_order(token_id, side, size, price)

        try:
            # Build order args for py-clob-client
            order_args = OrderArgs(
                token_id=token_id,
                price=float(price),
                size=float(size),
                side=side.value,
            )

            # Determine order type
            if order_type == "FOK":
                py_order_type = OrderType.FOK
            elif order_type == "IOC":
                py_order_type = OrderType.IOC
            else:
                py_order_type = OrderType.GTC

            # Execute order (synchronous SDK)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self._client.create_and_post_order(order_args, py_order_type),
            )

            order = Order(
                order_id=result.get("orderID") or result.get("id", "unknown"),
                token_id=token_id,
                side=side,
                size=size,
                price=price,
                status=OrderStatus.OPEN,
            )

            self._orders_placed += 1
            self._total_volume += size * price

            logger.info(f"Order placed: {order.order_id}")
            return order

        except Exception as e:
            logger.error(f"Failed to place order: {e}")
            return Order(
                order_id=f"failed_{datetime.now().timestamp()}",
                token_id=token_id,
                side=side,
                size=size,
                price=price,
                status=OrderStatus.FAILED,
                error_message=str(e),
            )

    async def _place_paper_order(
        self,
        token_id: str,
        side: OrderSide,
        size: Decimal,
        price: Decimal,
    ) -> Order:
        """Simulate order placement for paper trading."""
        self._paper_order_counter += 1
        order_id = f"paper_{self._paper_order_counter}"

        order = Order(
            order_id=order_id,
            token_id=token_id,
            side=side,
            size=size,
            price=price,
            status=OrderStatus.OPEN,
        )

        # Simulate immediate fill for market-like orders
        # In reality, check against orderbook
        best_bid, best_ask = await self.get_price(token_id)

        can_fill = False
        if side == OrderSide.BUY and best_ask and price >= best_ask:
            can_fill = True
        elif side == OrderSide.SELL and best_bid and price <= best_bid:
            can_fill = True

        if can_fill:
            order.status = OrderStatus.FILLED
            order.filled_size = size
            logger.info(f"Paper order filled: {order_id}")
        else:
            logger.info(f"Paper order open: {order_id} (waiting for fill)")

        self._paper_orders[order_id] = order
        self._orders_placed += 1
        self._total_volume += size * price

        return order

    async def cancel_order(self, order_id: str) -> bool:
        """
        Cancel an order.

        Args:
            order_id: The order ID to cancel

        Returns:
            True if cancelled successfully
        """
        logger.info(f"Cancelling order: {order_id}")

        if self.paper_trading:
            if order_id in self._paper_orders:
                self._paper_orders[order_id].status = OrderStatus.CANCELLED
                self._orders_cancelled += 1
                return True
            return False

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, self._client.cancel, order_id
            )
            self._orders_cancelled += 1
            return True

        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False

    async def get_order(self, order_id: str) -> Optional[Order]:
        """
        Get order status.

        Args:
            order_id: The order ID

        Returns:
            Order object or None if not found
        """
        if self.paper_trading:
            return self._paper_orders.get(order_id)

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, self._client.get_order, order_id
            )

            if not result:
                return None

            # Map status
            status_map = {
                "OPEN": OrderStatus.OPEN,
                "FILLED": OrderStatus.FILLED,
                "CANCELLED": OrderStatus.CANCELLED,
                "EXPIRED": OrderStatus.CANCELLED,
            }
            status = status_map.get(result.get("status", ""), OrderStatus.PENDING)

            return Order(
                order_id=order_id,
                token_id=result.get("asset_id", ""),
                side=OrderSide(result.get("side", "BUY")),
                size=Decimal(str(result.get("original_size", 0))),
                price=Decimal(str(result.get("price", 0))),
                status=status,
                filled_size=Decimal(str(result.get("size_matched", 0))),
            )

        except Exception as e:
            logger.error(f"Failed to get order {order_id}: {e}")
            return None

    async def get_open_orders(self) -> list[Order]:
        """Get all open orders."""
        if self.paper_trading:
            return [
                o for o in self._paper_orders.values()
                if o.status == OrderStatus.OPEN
            ]

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, self._client.get_orders
            )

            orders = []
            for r in result:
                if r.get("status") == "OPEN":
                    orders.append(Order(
                        order_id=r.get("id", ""),
                        token_id=r.get("asset_id", ""),
                        side=OrderSide(r.get("side", "BUY")),
                        size=Decimal(str(r.get("original_size", 0))),
                        price=Decimal(str(r.get("price", 0))),
                        status=OrderStatus.OPEN,
                        filled_size=Decimal(str(r.get("size_matched", 0))),
                    ))

            return orders

        except Exception as e:
            logger.error(f"Failed to get open orders: {e}")
            return []

    async def cancel_all_orders(self) -> int:
        """
        Cancel all open orders.

        Returns:
            Number of orders cancelled
        """
        logger.info("Cancelling all orders")

        open_orders = await self.get_open_orders()
        cancelled = 0

        for order in open_orders:
            if await self.cancel_order(order.order_id):
                cancelled += 1

        logger.info(f"Cancelled {cancelled} orders")
        return cancelled

    @property
    def stats(self) -> dict:
        """Get client statistics."""
        return {
            "paper_trading": self.paper_trading,
            "orders_placed": self._orders_placed,
            "orders_cancelled": self._orders_cancelled,
            "total_volume": float(self._total_volume),
            "open_orders": len([
                o for o in self._paper_orders.values()
                if o.status == OrderStatus.OPEN
            ]) if self.paper_trading else 0,
        }
