"""
Copy trading engine for Polymarket.

Monitors trades from qualified traders and automatically mirrors
their positions with configurable risk management.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Callable, Awaitable

from supabase import Client

from ..realtime.rtds_client import RTDSMessage
from .clob_client import ClobClient, OrderSide
from .position_tracker import PositionTracker
from .risk_manager import RiskManager, RiskLimits

logger = logging.getLogger(__name__)


@dataclass
class CopyTraderConfig:
    """Configuration for copy trading."""

    # Enable/disable
    enabled: bool = False
    paper_trading: bool = True

    # Trader selection
    min_copytrade_score: int = 60
    copy_from_watchlist_only: bool = False

    # Sizing
    copy_fraction: Decimal = Decimal("0.1")  # Copy 10% of their size
    min_copy_size_usd: Decimal = Decimal("5")
    max_copy_size_usd: Decimal = Decimal("100")

    # Filters
    min_trade_size_usd: Decimal = Decimal("50")  # Only copy trades >= $50
    allowed_categories: Optional[list[str]] = None
    blocked_markets: Optional[list[str]] = None

    # Timing
    max_delay_seconds: int = 30  # Skip if trade is too old


class CopyTrader:
    """
    Automated copy trading engine.

    Listens to real-time trades from RTDS and automatically copies
    trades from qualified traders based on their copytrade score.

    Usage:
        copy_trader = CopyTrader(
            clob_client=clob_client,
            supabase=supabase_client,
            config=CopyTraderConfig(enabled=True, paper_trading=True),
        )
        await copy_trader.initialize()

        # Hook into RTDS trade processor
        async def on_trade(trade: RTDSMessage):
            await copy_trader.evaluate_trade(trade)
    """

    def __init__(
        self,
        clob_client: ClobClient,
        supabase: Client,
        config: Optional[CopyTraderConfig] = None,
        risk_limits: Optional[RiskLimits] = None,
    ):
        """
        Initialize copy trader.

        Args:
            clob_client: CLOB client for order execution
            supabase: Supabase client for database access
            config: Copy trading configuration
            risk_limits: Risk management limits
        """
        self.clob_client = clob_client
        self.supabase = supabase
        self.config = config or CopyTraderConfig()

        # Components
        self.risk_manager = RiskManager(risk_limits)
        self.position_tracker = PositionTracker(supabase)

        # Caches
        self._trader_cache: dict[str, dict] = {}
        self._watchlist: set[str] = set()
        self._recent_copies: dict[str, datetime] = {}  # trade_id -> copy time

        # Stats
        self._trades_evaluated = 0
        self._trades_copied = 0
        self._trades_rejected = 0
        self._copy_volume_usd = Decimal("0")

        logger.info(
            f"CopyTrader initialized: "
            f"enabled={self.config.enabled}, "
            f"paper={self.config.paper_trading}, "
            f"min_score={self.config.min_copytrade_score}"
        )

    async def initialize(self) -> None:
        """Initialize caches and load state."""
        logger.info("Initializing CopyTrader...")

        await asyncio.gather(
            self._load_trader_cache(),
            self._load_watchlist(),
            self.position_tracker.load_positions(),
            return_exceptions=True,
        )

        logger.info(
            f"CopyTrader ready: "
            f"{len(self._trader_cache)} traders cached, "
            f"{len(self._watchlist)} in watchlist"
        )

    async def _load_trader_cache(self) -> None:
        """Load qualified traders into cache."""
        try:
            result = (
                self.supabase.table("traders")
                .select("address, copytrade_score, bot_score, insider_score, primary_classification")
                .gte("copytrade_score", self.config.min_copytrade_score)
                .execute()
            )

            self._trader_cache = {
                t["address"].lower(): t
                for t in (result.data or [])
            }

            logger.debug(f"Loaded {len(self._trader_cache)} qualified traders")

        except Exception as e:
            logger.error(f"Failed to load trader cache: {e}")

    async def _load_watchlist(self) -> None:
        """Load watchlist addresses."""
        try:
            result = (
                self.supabase.table("watchlist")
                .select("address")
                .eq("list_type", "copy")
                .execute()
            )

            self._watchlist = {
                w["address"].lower()
                for w in (result.data or [])
            }

            logger.debug(f"Loaded {len(self._watchlist)} watchlist addresses")

        except Exception as e:
            logger.error(f"Failed to load watchlist: {e}")

    async def evaluate_trade(self, trade: RTDSMessage) -> None:
        """
        Evaluate a trade for potential copying.

        This is the main entry point called by the trade processor
        for each incoming trade.

        Args:
            trade: The RTDS trade message
        """
        if not self.config.enabled:
            return

        self._trades_evaluated += 1

        # Quick checks before detailed evaluation
        trader_addr = trade.trader_address.lower()

        # Check if we've already copied this trade
        if trade.trade_id in self._recent_copies:
            return

        # Check watchlist-only mode
        if self.config.copy_from_watchlist_only:
            if trader_addr not in self._watchlist:
                return

        # Get trader info
        trader = self._trader_cache.get(trader_addr)
        if not trader:
            return  # Unknown or unqualified trader

        # Check minimum score
        copytrade_score = trader.get("copytrade_score", 0)
        if copytrade_score < self.config.min_copytrade_score:
            return

        # Check trade size
        if trade.usd_value < float(self.config.min_trade_size_usd):
            return

        # Check trade age
        age_seconds = (datetime.now(timezone.utc) - trade.executed_at).total_seconds()
        if age_seconds > self.config.max_delay_seconds:
            logger.debug(
                f"Skipping stale trade from {trader_addr[:8]}... "
                f"(age={age_seconds:.0f}s)"
            )
            return

        # Evaluate and potentially copy
        await self._copy_trade(trade, trader)

    async def _copy_trade(self, trade: RTDSMessage, trader: dict) -> None:
        """
        Attempt to copy a trade.

        Args:
            trade: The trade to copy
            trader: Trader info from cache
        """
        trader_addr = trade.trader_address.lower()
        copytrade_score = trader.get("copytrade_score", 0)

        # Calculate copy size
        source_size_usd = Decimal(str(trade.usd_value))
        copy_size = self.risk_manager.calculate_copy_size(
            source_size_usd,
            copytrade_score,
        )

        # Apply config limits
        copy_size = max(copy_size, self.config.min_copy_size_usd)
        copy_size = min(copy_size, self.config.max_copy_size_usd)

        # Convert to shares (size in USD / price)
        price = Decimal(str(trade.price)) if trade.price > 0 else Decimal("0.5")
        copy_shares = copy_size / price
        copy_shares = copy_shares.quantize(Decimal("0.01"))

        # Get market ID (use asset_id or condition_id)
        market_id = trade.asset_id or trade.condition_id

        # Check risk limits
        allowed, rejection_reason = self.risk_manager.check_order(
            market_id=market_id,
            size_usd=copy_size,
            category=None,  # Would need market lookup
        )

        if not allowed:
            self._trades_rejected += 1

            await self.position_tracker.log_copy_trade(
                source_trader=trader_addr,
                source_trade_id=trade.trade_id,
                our_order=None,
                market_id=market_id,
                condition_id=trade.condition_id,
                source_size=source_size_usd,
                source_price=price,
                trader_score=copytrade_score,
                status="rejected",
                rejection_reason=rejection_reason,
            )

            logger.info(
                f"Rejected copy trade: {rejection_reason} "
                f"(trader={trader_addr[:8]}..., score={copytrade_score})"
            )
            return

        # Determine order side
        side = OrderSide.BUY if trade.side == "BUY" else OrderSide.SELL

        logger.info(
            f"Copying trade: {side.value} {copy_shares} @ {price} "
            f"(${copy_size}) from {trader_addr[:8]}... "
            f"(score={copytrade_score}, original=${source_size_usd})"
        )

        # Execute order
        try:
            order = await self.clob_client.place_order(
                token_id=market_id,
                side=side,
                size=copy_shares,
                price=price,
            )

            # Record in tracking
            self.risk_manager.record_order(market_id, copy_size)
            await self.position_tracker.record_order(order, copied_from=trader_addr)
            await self.position_tracker.log_copy_trade(
                source_trader=trader_addr,
                source_trade_id=trade.trade_id,
                our_order=order,
                market_id=market_id,
                condition_id=trade.condition_id,
                source_size=source_size_usd,
                source_price=price,
                trader_score=copytrade_score,
                status="executed" if order.error_message is None else "failed",
                rejection_reason=order.error_message,
            )

            # Mark as copied
            self._recent_copies[trade.trade_id] = datetime.now(timezone.utc)
            self._trades_copied += 1
            self._copy_volume_usd += copy_size

            # Clean old entries from recent_copies
            if len(self._recent_copies) > 10000:
                cutoff = datetime.now(timezone.utc)
                self._recent_copies = {
                    k: v for k, v in self._recent_copies.items()
                    if (cutoff - v).total_seconds() < 3600
                }

            logger.info(
                f"Copy trade executed: order={order.order_id}, "
                f"status={order.status.value}"
            )

        except Exception as e:
            logger.error(f"Failed to copy trade: {e}")
            self._trades_rejected += 1

            await self.position_tracker.log_copy_trade(
                source_trader=trader_addr,
                source_trade_id=trade.trade_id,
                our_order=None,
                market_id=market_id,
                condition_id=trade.condition_id,
                source_size=source_size_usd,
                source_price=price,
                trader_score=copytrade_score,
                status="failed",
                rejection_reason=str(e),
            )

    async def refresh_caches(self) -> None:
        """Refresh trader and watchlist caches."""
        await asyncio.gather(
            self._load_trader_cache(),
            self._load_watchlist(),
            return_exceptions=True,
        )

    def enable(self) -> None:
        """Enable copy trading."""
        self.config.enabled = True
        logger.info("Copy trading ENABLED")

    def disable(self) -> None:
        """Disable copy trading."""
        self.config.enabled = False
        logger.info("Copy trading DISABLED")

    def set_paper_mode(self, paper: bool) -> None:
        """Set paper trading mode."""
        self.config.paper_trading = paper
        self.clob_client.paper_trading = paper
        logger.info(f"Paper trading mode: {paper}")

    @property
    def stats(self) -> dict:
        """Get copy trader statistics."""
        return {
            "enabled": self.config.enabled,
            "paper_trading": self.config.paper_trading,
            "trades_evaluated": self._trades_evaluated,
            "trades_copied": self._trades_copied,
            "trades_rejected": self._trades_rejected,
            "copy_rate": (
                self._trades_copied / self._trades_evaluated
                if self._trades_evaluated > 0 else 0
            ),
            "copy_volume_usd": float(self._copy_volume_usd),
            "qualified_traders": len(self._trader_cache),
            "watchlist_size": len(self._watchlist),
            "config": {
                "min_copytrade_score": self.config.min_copytrade_score,
                "copy_fraction": float(self.config.copy_fraction),
                "min_trade_size_usd": float(self.config.min_trade_size_usd),
                "copy_from_watchlist_only": self.config.copy_from_watchlist_only,
            },
            "risk": self.risk_manager.status,
            "positions": self.position_tracker.stats,
        }


async def create_copy_trader(
    private_key: str,
    api_key: Optional[str],
    api_secret: Optional[str],
    api_passphrase: Optional[str],
    supabase_url: str,
    supabase_key: str,
    config: Optional[CopyTraderConfig] = None,
    risk_limits: Optional[RiskLimits] = None,
) -> CopyTrader:
    """
    Factory function to create and initialize a CopyTrader.

    Args:
        private_key: Ethereum wallet private key
        api_key: Polymarket API key
        api_secret: Polymarket API secret
        api_passphrase: Polymarket API passphrase
        supabase_url: Supabase project URL
        supabase_key: Supabase service key
        config: Copy trading configuration
        risk_limits: Risk management limits

    Returns:
        Initialized CopyTrader instance
    """
    from supabase import create_client

    # Create CLOB client
    paper_trading = config.paper_trading if config else True
    clob_client = ClobClient(
        private_key=private_key,
        api_key=api_key,
        api_secret=api_secret,
        api_passphrase=api_passphrase,
        paper_trading=paper_trading,
    )

    # Create Supabase client
    supabase = create_client(supabase_url, supabase_key)

    # Create copy trader
    copy_trader = CopyTrader(
        clob_client=clob_client,
        supabase=supabase,
        config=config,
        risk_limits=risk_limits,
    )

    # Initialize
    await copy_trader.initialize()

    return copy_trader
