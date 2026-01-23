"""
Execution module for Polymarket trading.

Provides order execution, position tracking, and copy trading capabilities
using the Polymarket CLOB API.

Example usage:

    from src.execution import CopyTrader, CopyTraderConfig, RiskLimits
    from decimal import Decimal

    # Configure copy trading
    config = CopyTraderConfig(
        enabled=True,
        paper_trading=True,  # Start with paper trading!
        min_copytrade_score=60,
        copy_fraction=Decimal("0.1"),
    )

    # Set risk limits
    limits = RiskLimits(
        max_total_exposure_usd=Decimal("5000"),
        max_single_order_usd=Decimal("100"),
    )

    # Create and start copy trader
    copy_trader = await create_copy_trader(
        private_key=os.getenv("POLYMARKET_PRIVATE_KEY"),
        api_key=os.getenv("POLYMARKET_API_KEY"),
        ...
        config=config,
        risk_limits=limits,
    )
"""

from .clob_client import ClobClient, Order, OrderSide, OrderStatus
from .position_tracker import PositionTracker, Position, CopyTradeLog
from .risk_manager import RiskManager, RiskLimits, RiskState
from .copy_trader import CopyTrader, CopyTraderConfig, create_copy_trader

__all__ = [
    # CLOB Client
    "ClobClient",
    "Order",
    "OrderSide",
    "OrderStatus",
    # Position Tracking
    "PositionTracker",
    "Position",
    "CopyTradeLog",
    # Risk Management
    "RiskManager",
    "RiskLimits",
    "RiskState",
    # Copy Trading
    "CopyTrader",
    "CopyTraderConfig",
    "create_copy_trader",
]
