"""
Risk management for copy trading.

Provides position limits, exposure controls, and kill switch functionality.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class RiskLimits:
    """Risk limit configuration."""

    # Position limits
    max_position_size_usd: Decimal = Decimal("500")  # Max per market
    max_total_exposure_usd: Decimal = Decimal("5000")  # Total portfolio
    max_single_order_usd: Decimal = Decimal("100")  # Per order

    # Daily limits
    max_daily_loss_usd: Decimal = Decimal("500")
    max_daily_orders: int = 100

    # Copy trading specific
    min_copy_size_usd: Decimal = Decimal("5")  # Don't copy tiny trades
    max_copy_fraction: Decimal = Decimal("0.1")  # Copy 10% of trader's size
    min_trader_score: int = 60  # Minimum copytrade score

    # Market restrictions
    blocked_markets: list[str] = field(default_factory=list)
    allowed_categories: Optional[list[str]] = None  # None = all allowed


@dataclass
class RiskState:
    """Current risk state tracking."""

    total_exposure_usd: Decimal = Decimal("0")
    daily_pnl_usd: Decimal = Decimal("0")
    daily_orders: int = 0
    day_start: datetime = None
    positions: dict[str, Decimal] = field(default_factory=dict)  # market -> size

    def __post_init__(self):
        if self.day_start is None:
            self.day_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )


class RiskManager:
    """
    Manages trading risk limits and kill switch.

    Enforces position limits, daily loss limits, and provides
    emergency stop functionality.
    """

    def __init__(self, limits: Optional[RiskLimits] = None):
        """
        Initialize risk manager.

        Args:
            limits: Risk limit configuration (uses defaults if not provided)
        """
        self.limits = limits or RiskLimits()
        self.state = RiskState()
        self._kill_switch_active = False
        self._kill_switch_reason: Optional[str] = None

        logger.info(
            f"RiskManager initialized: "
            f"max_exposure=${self.limits.max_total_exposure_usd}, "
            f"max_daily_loss=${self.limits.max_daily_loss_usd}"
        )

    def activate_kill_switch(self, reason: str = "Manual activation") -> None:
        """
        Activate kill switch to stop all trading.

        Args:
            reason: Reason for activation
        """
        self._kill_switch_active = True
        self._kill_switch_reason = reason
        logger.warning(f"KILL SWITCH ACTIVATED: {reason}")

    def deactivate_kill_switch(self) -> None:
        """Deactivate kill switch to resume trading."""
        self._kill_switch_active = False
        self._kill_switch_reason = None
        logger.info("Kill switch deactivated")

    @property
    def is_trading_allowed(self) -> bool:
        """Check if trading is currently allowed."""
        return not self._kill_switch_active

    def check_order(
        self,
        market_id: str,
        size_usd: Decimal,
        category: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """
        Check if an order is allowed under current risk limits.

        Args:
            market_id: The market identifier
            size_usd: Order size in USD
            category: Market category (optional)

        Returns:
            Tuple of (allowed: bool, rejection_reason: Optional[str])
        """
        size_usd = Decimal(str(size_usd))

        # Check kill switch
        if self._kill_switch_active:
            return False, f"Kill switch active: {self._kill_switch_reason}"

        # Check daily reset
        self._check_daily_reset()

        # Check single order size
        if size_usd > self.limits.max_single_order_usd:
            return False, (
                f"Order size ${size_usd} exceeds limit "
                f"${self.limits.max_single_order_usd}"
            )

        # Check minimum size
        if size_usd < self.limits.min_copy_size_usd:
            return False, (
                f"Order size ${size_usd} below minimum "
                f"${self.limits.min_copy_size_usd}"
            )

        # Check total exposure
        new_exposure = self.state.total_exposure_usd + size_usd
        if new_exposure > self.limits.max_total_exposure_usd:
            return False, (
                f"Would exceed total exposure limit: "
                f"${new_exposure} > ${self.limits.max_total_exposure_usd}"
            )

        # Check position size for this market
        current_position = self.state.positions.get(market_id, Decimal("0"))
        new_position = current_position + size_usd
        if new_position > self.limits.max_position_size_usd:
            return False, (
                f"Would exceed position limit for {market_id[:16]}...: "
                f"${new_position} > ${self.limits.max_position_size_usd}"
            )

        # Check daily loss limit
        if self.state.daily_pnl_usd < -self.limits.max_daily_loss_usd:
            return False, (
                f"Daily loss limit reached: "
                f"${self.state.daily_pnl_usd} < -${self.limits.max_daily_loss_usd}"
            )

        # Check daily order count
        if self.state.daily_orders >= self.limits.max_daily_orders:
            return False, f"Daily order limit reached: {self.limits.max_daily_orders}"

        # Check blocked markets
        if market_id in self.limits.blocked_markets:
            return False, f"Market {market_id[:16]}... is blocked"

        # Check category restrictions
        if self.limits.allowed_categories is not None:
            if category and category not in self.limits.allowed_categories:
                return False, f"Category '{category}' not in allowed list"

        return True, None

    def calculate_copy_size(
        self,
        original_size_usd: Decimal,
        trader_score: int,
    ) -> Decimal:
        """
        Calculate appropriate copy size based on risk limits.

        Args:
            original_size_usd: The trader's original position size
            trader_score: The trader's copytrade score (0-100)

        Returns:
            Size to copy in USD
        """
        original_size_usd = Decimal(str(original_size_usd))

        # Base copy size is fraction of original
        copy_size = original_size_usd * self.limits.max_copy_fraction

        # Scale by trader score (higher score = copy more)
        score_multiplier = Decimal(str(trader_score)) / Decimal("100")
        copy_size = copy_size * score_multiplier

        # Apply limits
        copy_size = max(copy_size, self.limits.min_copy_size_usd)
        copy_size = min(copy_size, self.limits.max_single_order_usd)

        # Round to 2 decimal places
        copy_size = copy_size.quantize(Decimal("0.01"))

        return copy_size

    def record_order(self, market_id: str, size_usd: Decimal) -> None:
        """
        Record an order for tracking.

        Args:
            market_id: The market identifier
            size_usd: Order size in USD
        """
        size_usd = Decimal(str(size_usd))

        self.state.total_exposure_usd += size_usd
        self.state.daily_orders += 1

        current_position = self.state.positions.get(market_id, Decimal("0"))
        self.state.positions[market_id] = current_position + size_usd

        logger.debug(
            f"Order recorded: {market_id[:16]}... ${size_usd}, "
            f"total exposure: ${self.state.total_exposure_usd}"
        )

    def record_fill(
        self,
        market_id: str,
        size_usd: Decimal,
        pnl_usd: Decimal = Decimal("0"),
    ) -> None:
        """
        Record a fill/close for tracking.

        Args:
            market_id: The market identifier
            size_usd: Position size closed in USD
            pnl_usd: Realized P&L
        """
        size_usd = Decimal(str(size_usd))
        pnl_usd = Decimal(str(pnl_usd))

        # Reduce exposure
        self.state.total_exposure_usd = max(
            Decimal("0"),
            self.state.total_exposure_usd - size_usd
        )

        # Update position
        current_position = self.state.positions.get(market_id, Decimal("0"))
        self.state.positions[market_id] = max(Decimal("0"), current_position - size_usd)

        # Track P&L
        self.state.daily_pnl_usd += pnl_usd

        # Auto-activate kill switch if daily loss exceeded
        if self.state.daily_pnl_usd < -self.limits.max_daily_loss_usd:
            self.activate_kill_switch(
                f"Daily loss limit exceeded: ${self.state.daily_pnl_usd}"
            )

        logger.debug(
            f"Fill recorded: {market_id[:16]}... ${size_usd}, "
            f"PnL: ${pnl_usd}, daily total: ${self.state.daily_pnl_usd}"
        )

    def _check_daily_reset(self) -> None:
        """Reset daily counters if day has changed."""
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        if self.state.day_start < today_start:
            logger.info(
                f"Daily reset: orders={self.state.daily_orders}, "
                f"PnL=${self.state.daily_pnl_usd}"
            )
            self.state.day_start = today_start
            self.state.daily_pnl_usd = Decimal("0")
            self.state.daily_orders = 0

    @property
    def status(self) -> dict:
        """Get current risk status."""
        self._check_daily_reset()

        return {
            "kill_switch_active": self._kill_switch_active,
            "kill_switch_reason": self._kill_switch_reason,
            "trading_allowed": self.is_trading_allowed,
            "total_exposure_usd": float(self.state.total_exposure_usd),
            "exposure_utilization": float(
                self.state.total_exposure_usd / self.limits.max_total_exposure_usd
            ) if self.limits.max_total_exposure_usd > 0 else 0,
            "daily_pnl_usd": float(self.state.daily_pnl_usd),
            "daily_orders": self.state.daily_orders,
            "daily_orders_remaining": (
                self.limits.max_daily_orders - self.state.daily_orders
            ),
            "position_count": len([p for p in self.state.positions.values() if p > 0]),
            "limits": {
                "max_position_size_usd": float(self.limits.max_position_size_usd),
                "max_total_exposure_usd": float(self.limits.max_total_exposure_usd),
                "max_single_order_usd": float(self.limits.max_single_order_usd),
                "max_daily_loss_usd": float(self.limits.max_daily_loss_usd),
                "max_daily_orders": self.limits.max_daily_orders,
            },
        }
