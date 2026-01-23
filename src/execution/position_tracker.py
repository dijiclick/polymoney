"""
Position tracker for copy trading.

Tracks executed orders and positions with Supabase persistence.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from supabase import Client

from .clob_client import Order, OrderSide, OrderStatus

logger = logging.getLogger(__name__)


@dataclass
class Position:
    """Represents a trading position."""

    id: str
    market_id: str
    condition_id: str
    token_id: str
    side: OrderSide
    size: Decimal
    avg_price: Decimal
    current_price: Optional[Decimal] = None
    unrealized_pnl: Optional[Decimal] = None
    copied_from: Optional[str] = None  # Trader address if copy trade
    created_at: datetime = None
    updated_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now(timezone.utc)
        if self.updated_at is None:
            self.updated_at = self.created_at

    def update_price(self, price: Decimal) -> None:
        """Update current price and calculate unrealized P&L."""
        self.current_price = Decimal(str(price))
        self.updated_at = datetime.now(timezone.utc)

        # Calculate unrealized P&L
        if self.side == OrderSide.BUY:
            # Long: profit if price goes up
            self.unrealized_pnl = (self.current_price - self.avg_price) * self.size
        else:
            # Short: profit if price goes down
            self.unrealized_pnl = (self.avg_price - self.current_price) * self.size

    def to_dict(self) -> dict:
        """Convert to dictionary for database storage."""
        return {
            "id": self.id,
            "market_id": self.market_id,
            "condition_id": self.condition_id,
            "token_id": self.token_id,
            "side": self.side.value,
            "size": float(self.size),
            "avg_price": float(self.avg_price),
            "current_price": float(self.current_price) if self.current_price else None,
            "unrealized_pnl": float(self.unrealized_pnl) if self.unrealized_pnl else None,
            "copied_from": self.copied_from,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass
class CopyTradeLog:
    """Log entry for a copy trade execution."""

    id: str
    source_trader: str
    source_trade_id: str
    our_order_id: str
    market_id: str
    condition_id: str
    side: OrderSide
    source_size: Decimal
    copy_size: Decimal
    source_price: Decimal
    our_price: Decimal
    trader_score: int
    status: str  # 'executed', 'rejected', 'failed'
    rejection_reason: Optional[str] = None
    created_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        """Convert to dictionary for database storage."""
        return {
            "id": self.id,
            "source_trader": self.source_trader,
            "source_trade_id": self.source_trade_id,
            "our_order_id": self.our_order_id,
            "market_id": self.market_id,
            "condition_id": self.condition_id,
            "side": self.side.value,
            "source_size": float(self.source_size),
            "copy_size": float(self.copy_size),
            "source_price": float(self.source_price),
            "our_price": float(self.our_price),
            "trader_score": self.trader_score,
            "status": self.status,
            "rejection_reason": self.rejection_reason,
            "created_at": self.created_at.isoformat(),
        }


class PositionTracker:
    """
    Tracks positions and order history with Supabase persistence.

    Provides position management, P&L tracking, and audit logging
    for copy trading operations.
    """

    def __init__(self, supabase: Client):
        """
        Initialize position tracker.

        Args:
            supabase: Supabase client instance
        """
        self.supabase = supabase

        # In-memory cache
        self._positions: dict[str, Position] = {}  # token_id -> Position
        self._orders: dict[str, Order] = {}  # order_id -> Order
        self._copy_logs: list[CopyTradeLog] = []

        # Stats
        self._total_trades = 0
        self._total_pnl = Decimal("0")

        logger.info("PositionTracker initialized")

    async def load_positions(self) -> None:
        """Load existing positions from database."""
        try:
            result = self.supabase.table("user_positions").select("*").execute()

            for row in result.data or []:
                position = Position(
                    id=row["id"],
                    market_id=row["market_id"],
                    condition_id=row["condition_id"],
                    token_id=row["token_id"],
                    side=OrderSide(row["side"]),
                    size=Decimal(str(row["size"])),
                    avg_price=Decimal(str(row["avg_price"])),
                    current_price=Decimal(str(row["current_price"])) if row.get("current_price") else None,
                    unrealized_pnl=Decimal(str(row["unrealized_pnl"])) if row.get("unrealized_pnl") else None,
                    copied_from=row.get("copied_from"),
                )
                self._positions[position.token_id] = position

            logger.info(f"Loaded {len(self._positions)} positions from database")

        except Exception as e:
            logger.error(f"Failed to load positions: {e}")

    async def save_position(self, position: Position) -> None:
        """Save position to database."""
        try:
            self.supabase.table("user_positions").upsert(
                position.to_dict(),
                on_conflict="id"
            ).execute()

            logger.debug(f"Saved position: {position.id}")

        except Exception as e:
            logger.error(f"Failed to save position: {e}")

    async def record_order(
        self,
        order: Order,
        copied_from: Optional[str] = None,
    ) -> None:
        """
        Record an order execution.

        Args:
            order: The executed order
            copied_from: Address of trader we copied (if copy trade)
        """
        self._orders[order.order_id] = order
        self._total_trades += 1

        # Store order in database
        try:
            order_data = {
                "id": str(uuid4()),
                "order_id": order.order_id,
                "token_id": order.token_id,
                "side": order.side.value,
                "size": float(order.size),
                "price": float(order.price),
                "status": order.status.value,
                "filled_size": float(order.filled_size),
                "copied_from": copied_from,
                "created_at": order.created_at.isoformat(),
                "error_message": order.error_message,
            }

            self.supabase.table("user_orders").insert(order_data).execute()
            logger.debug(f"Recorded order: {order.order_id}")

        except Exception as e:
            logger.error(f"Failed to record order: {e}")

        # Update position if order is filled
        if order.status in (OrderStatus.FILLED, OrderStatus.PARTIAL):
            await self._update_position_from_order(order, copied_from)

    async def _update_position_from_order(
        self,
        order: Order,
        copied_from: Optional[str] = None,
    ) -> None:
        """Update position based on filled order."""
        token_id = order.token_id
        filled_size = order.filled_size if order.filled_size > 0 else order.size

        existing = self._positions.get(token_id)

        if existing:
            # Update existing position
            if existing.side == order.side:
                # Adding to position - calculate new average price
                total_size = existing.size + filled_size
                total_cost = (existing.size * existing.avg_price) + (filled_size * order.price)
                existing.size = total_size
                existing.avg_price = total_cost / total_size
            else:
                # Closing/reducing position
                if filled_size >= existing.size:
                    # Fully closed
                    del self._positions[token_id]
                    # Delete from database
                    try:
                        self.supabase.table("user_positions").delete().eq(
                            "token_id", token_id
                        ).execute()
                    except Exception as e:
                        logger.error(f"Failed to delete position: {e}")
                    return
                else:
                    # Partial close
                    existing.size -= filled_size

            existing.updated_at = datetime.now(timezone.utc)
            await self.save_position(existing)

        else:
            # Create new position
            position = Position(
                id=str(uuid4()),
                market_id=order.token_id,  # We'll need market lookup
                condition_id=order.token_id,  # Placeholder
                token_id=token_id,
                side=order.side,
                size=filled_size,
                avg_price=order.price,
                copied_from=copied_from,
            )
            self._positions[token_id] = position
            await self.save_position(position)

    async def log_copy_trade(
        self,
        source_trader: str,
        source_trade_id: str,
        our_order: Order,
        market_id: str,
        condition_id: str,
        source_size: Decimal,
        source_price: Decimal,
        trader_score: int,
        status: str,
        rejection_reason: Optional[str] = None,
    ) -> None:
        """
        Log a copy trade attempt for audit.

        Args:
            source_trader: Address of trader we copied
            source_trade_id: ID of the original trade
            our_order: Our executed order (may be None if rejected)
            market_id: Market identifier
            condition_id: Condition identifier
            source_size: Original trade size
            source_price: Original trade price
            trader_score: Trader's copytrade score
            status: 'executed', 'rejected', or 'failed'
            rejection_reason: Reason if rejected
        """
        log_entry = CopyTradeLog(
            id=str(uuid4()),
            source_trader=source_trader,
            source_trade_id=source_trade_id,
            our_order_id=our_order.order_id if our_order else "none",
            market_id=market_id,
            condition_id=condition_id,
            side=our_order.side if our_order else OrderSide.BUY,
            source_size=Decimal(str(source_size)),
            copy_size=our_order.size if our_order else Decimal("0"),
            source_price=Decimal(str(source_price)),
            our_price=our_order.price if our_order else Decimal("0"),
            trader_score=trader_score,
            status=status,
            rejection_reason=rejection_reason,
        )

        self._copy_logs.append(log_entry)

        # Keep only recent logs in memory
        if len(self._copy_logs) > 1000:
            self._copy_logs = self._copy_logs[-500:]

        # Store to database
        try:
            self.supabase.table("copy_trade_log").insert(
                log_entry.to_dict()
            ).execute()

            logger.debug(
                f"Logged copy trade: {status} from {source_trader[:8]}... "
                f"(score={trader_score})"
            )

        except Exception as e:
            logger.error(f"Failed to log copy trade: {e}")

    def get_position(self, token_id: str) -> Optional[Position]:
        """Get position for a token."""
        return self._positions.get(token_id)

    def get_all_positions(self) -> list[Position]:
        """Get all current positions."""
        return list(self._positions.values())

    def get_total_exposure(self) -> Decimal:
        """Get total position exposure in USD."""
        return sum(
            p.size * (p.current_price or p.avg_price)
            for p in self._positions.values()
        )

    def get_total_unrealized_pnl(self) -> Decimal:
        """Get total unrealized P&L."""
        return sum(
            p.unrealized_pnl or Decimal("0")
            for p in self._positions.values()
        )

    async def update_prices(self, prices: dict[str, Decimal]) -> None:
        """
        Update current prices for positions.

        Args:
            prices: Dict of token_id -> current price
        """
        for token_id, price in prices.items():
            position = self._positions.get(token_id)
            if position:
                position.update_price(price)
                await self.save_position(position)

    @property
    def stats(self) -> dict:
        """Get tracker statistics."""
        positions = self.get_all_positions()

        return {
            "position_count": len(positions),
            "total_exposure_usd": float(self.get_total_exposure()),
            "total_unrealized_pnl": float(self.get_total_unrealized_pnl()),
            "total_trades": self._total_trades,
            "copy_logs_count": len(self._copy_logs),
            "positions": [
                {
                    "token_id": p.token_id[:16] + "...",
                    "side": p.side.value,
                    "size": float(p.size),
                    "avg_price": float(p.avg_price),
                    "current_price": float(p.current_price) if p.current_price else None,
                    "unrealized_pnl": float(p.unrealized_pnl) if p.unrealized_pnl else None,
                }
                for p in positions
            ],
        }
