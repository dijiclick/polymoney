"""
Goldsky client for querying locally-synced Polymarket data.

This module provides the same interface as data_api.py but queries
Goldsky-synced data from local Supabase tables instead of Polymarket APIs.

Tables used:
- goldsky_user_positions: Aggregated position data
- goldsky_user_balances: Current share holdings
- goldsky_order_filled: Order fill events (trade timeline)
- token_market_mapping: Token ID to condition/outcome mapping
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, TYPE_CHECKING

from supabase import Client

if TYPE_CHECKING:
    from ..execution.clob_client import ClobClient

logger = logging.getLogger(__name__)

# USDC scaling factor (6 decimals)
USDC_SCALE = 1_000_000

# Price cache TTL in seconds
PRICE_CACHE_TTL = 60


class PriceCache:
    """
    Shared price cache for CLOB prices.

    Fetches and caches token prices to avoid per-wallet API calls.
    Prices are refreshed after TTL expires.
    """

    def __init__(self, clob_client: Optional["ClobClient"] = None):
        self._clob_client = clob_client
        self._cache: dict[str, float] = {}
        self._last_refresh: datetime = datetime.min.replace(tzinfo=timezone.utc)
        self._ttl = PRICE_CACHE_TTL

    def set_clob_client(self, clob_client: "ClobClient") -> None:
        """Set the CLOB client for price fetching."""
        self._clob_client = clob_client

    async def get_price(self, token_id: str) -> Optional[float]:
        """
        Get cached price for a token.

        Returns midpoint price (avg of bid/ask) or None if not available.
        """
        if token_id in self._cache:
            return self._cache[token_id]

        # Fetch if not in cache
        if self._clob_client:
            try:
                bid, ask = await self._clob_client.get_price(token_id)
                if bid and ask:
                    price = float((bid + ask) / 2)
                    self._cache[token_id] = price
                    return price
                elif bid:
                    price = float(bid)
                    self._cache[token_id] = price
                    return price
                elif ask:
                    price = float(ask)
                    self._cache[token_id] = price
                    return price
            except Exception as e:
                logger.debug(f"Failed to fetch price for {token_id[:16]}...: {e}")

        return None

    async def get_prices_batch(self, token_ids: list[str]) -> dict[str, float]:
        """
        Get prices for multiple tokens.

        Fetches missing prices concurrently.
        """
        # Find tokens not in cache
        missing = [t for t in token_ids if t not in self._cache]

        if missing and self._clob_client:
            # Fetch missing prices concurrently (limit concurrency)
            semaphore = asyncio.Semaphore(10)

            async def fetch_with_limit(token_id: str):
                async with semaphore:
                    await self.get_price(token_id)

            await asyncio.gather(*[fetch_with_limit(t) for t in missing])

        return {t: self._cache.get(t, 0) for t in token_ids}

    def clear(self) -> None:
        """Clear the price cache."""
        self._cache.clear()
        self._last_refresh = datetime.min.replace(tzinfo=timezone.utc)

    @property
    def size(self) -> int:
        """Number of cached prices."""
        return len(self._cache)


# Global shared price cache instance
_price_cache: Optional[PriceCache] = None


def get_price_cache() -> PriceCache:
    """Get the shared price cache instance."""
    global _price_cache
    if _price_cache is None:
        _price_cache = PriceCache()
    return _price_cache


class GoldskyClient:
    """
    Client for querying Goldsky-synced Polymarket data from Supabase.

    Provides similar interface to PolymarketDataAPI but uses local tables
    instead of external API calls.
    """

    def __init__(self, supabase: Client):
        """
        Initialize Goldsky client.

        Args:
            supabase: Supabase client instance
        """
        self.supabase = supabase

    # =========================================================================
    # Position Data
    # =========================================================================

    def get_user_positions(self, address: str) -> list[dict]:
        """
        Get user positions from Goldsky data.

        Args:
            address: Wallet address (proxy wallet)

        Returns:
            List of position records with:
            - token_id, amount, avg_price, realized_pnl, total_bought
        """
        try:
            result = (
                self.supabase.table("goldsky_user_positions")
                .select("*")
                .ilike("user", address)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Error getting Goldsky positions for {address}: {e}")
            return []

    def get_user_positions_with_mapping(self, address: str) -> list[dict]:
        """
        Get user positions with market mapping (condition_id, outcome).

        Args:
            address: Wallet address

        Returns:
            List of positions with market info attached
        """
        try:
            # Join with token_market_mapping
            result = (
                self.supabase.table("goldsky_user_positions")
                .select("*, token_market_mapping(condition_id, outcome, market_slug, question)")
                .ilike("user", address)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Error getting Goldsky positions with mapping for {address}: {e}")
            return []

    # =========================================================================
    # Balance Data
    # =========================================================================

    def get_user_balances(self, address: str) -> list[dict]:
        """
        Get user token balances from Goldsky data.

        Args:
            address: Wallet address

        Returns:
            List of balance records with:
            - asset (token_id), balance
        """
        try:
            result = (
                self.supabase.table("goldsky_user_balances")
                .select("*")
                .ilike("user", address)
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Error getting Goldsky balances for {address}: {e}")
            return []

    async def calculate_portfolio_value(self, address: str) -> float:
        """
        Calculate portfolio value (NAV) from balances + CLOB prices.

        This replaces the Polymarket /portfolio-value endpoint by:
        1. Getting holdings from goldsky_user_balances
        2. Fetching prices from shared CLOB price cache
        3. Calculating NAV = sum(holdings * price)

        Args:
            address: Wallet address

        Returns:
            Portfolio value in USD
        """
        balances = self.get_user_balances(address)
        if not balances:
            return 0.0

        price_cache = get_price_cache()
        total_value = 0.0

        # Get all token IDs
        token_ids = []
        for bal in balances:
            token_id = bal.get("asset") or bal.get("token_id")
            if token_id:
                token_ids.append(token_id)

        # Fetch prices in batch
        prices = await price_cache.get_prices_batch(token_ids)

        # Calculate NAV
        for bal in balances:
            token_id = bal.get("asset") or bal.get("token_id")
            balance = float(bal.get("balance", 0) or 0)

            # Scale balance if needed (check if raw or scaled)
            if balance > 1_000_000_000:
                balance = balance / USDC_SCALE

            price = prices.get(token_id, 0)
            if price > 0 and balance > 0:
                total_value += balance * price

        return round(total_value, 2)

    # =========================================================================
    # Order Fill Events (Timeline)
    # =========================================================================

    def get_order_fills(
        self,
        address: str,
        days: int = 0,
        limit: int = 10000
    ) -> list[dict]:
        """
        Get order fill events for a user.

        Args:
            address: Wallet address
            days: Filter to last N days (0 = all history)
            limit: Maximum records to return

        Returns:
            List of fill events with:
            - timestamp, maker, taker, amounts, fee, asset IDs
        """
        try:
            # Build query for fills where user is maker OR taker
            # Supabase doesn't support OR in filters directly, so we do two queries
            maker_result = (
                self.supabase.table("goldsky_order_filled")
                .select("*")
                .ilike("maker", address)
                .order("timestamp", desc=True)
                .limit(limit)
                .execute()
            )

            taker_result = (
                self.supabase.table("goldsky_order_filled")
                .select("*")
                .ilike("taker", address)
                .order("timestamp", desc=True)
                .limit(limit)
                .execute()
            )

            # Combine and dedupe by ID
            all_fills = {}
            for fill in (maker_result.data or []) + (taker_result.data or []):
                all_fills[fill["id"]] = fill

            # Sort by timestamp descending
            fills = sorted(all_fills.values(), key=lambda x: x.get("timestamp", 0), reverse=True)

            # Filter by days if specified
            if days > 0:
                cutoff_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
                fills = [f for f in fills if f.get("timestamp", 0) >= cutoff_ts]

            return fills[:limit]

        except Exception as e:
            logger.error(f"Error getting Goldsky fills for {address}: {e}")
            return []

    def get_order_fills_with_mapping(
        self,
        address: str,
        days: int = 0,
        limit: int = 10000
    ) -> list[dict]:
        """
        Get order fills with market mapping attached.

        Returns fills enriched with condition_id, outcome from token_market_mapping.
        """
        fills = self.get_order_fills(address, days, limit)

        if not fills:
            return []

        # Get all unique token IDs
        token_ids = set()
        for fill in fills:
            is_maker = fill.get("maker", "").lower() == address.lower()
            token_id = fill.get("maker_asset_id") if is_maker else fill.get("taker_asset_id")
            if token_id:
                token_ids.add(token_id)

        # Fetch mappings for all tokens
        try:
            mapping_result = (
                self.supabase.table("token_market_mapping")
                .select("token_id, condition_id, outcome, market_slug, question")
                .in_("token_id", list(token_ids))
                .execute()
            )
            mappings = {m["token_id"]: m for m in (mapping_result.data or [])}
        except Exception as e:
            logger.warning(f"Error fetching token mappings: {e}")
            mappings = {}

        # Enrich fills with mapping
        for fill in fills:
            is_maker = fill.get("maker", "").lower() == address.lower()
            token_id = fill.get("maker_asset_id") if is_maker else fill.get("taker_asset_id")
            fill["is_maker"] = is_maker
            fill["token_id"] = token_id
            if token_id and token_id in mappings:
                fill["condition_id"] = mappings[token_id].get("condition_id")
                fill["outcome"] = mappings[token_id].get("outcome")
                fill["market_slug"] = mappings[token_id].get("market_slug")
                fill["question"] = mappings[token_id].get("question")

        return fills

    # =========================================================================
    # Aggregated Metrics
    # =========================================================================

    def get_position_summary(self, address: str) -> dict:
        """
        Get aggregated position summary for a user.

        Returns:
            Dict with:
            - total_realized_pnl: Sum of realized PnL (scaled to USD)
            - total_bought: Total USDC invested (scaled to USD)
            - position_count: Number of positions
            - win_count: Positions with positive PnL
            - loss_count: Positions with negative/zero PnL
        """
        positions = self.get_user_positions(address)

        if not positions:
            return {
                "total_realized_pnl": 0,
                "total_bought": 0,
                "position_count": 0,
                "win_count": 0,
                "loss_count": 0,
                "open_count": 0
            }

        total_realized_pnl = 0
        total_bought = 0
        win_count = 0
        loss_count = 0
        open_count = 0

        for pos in positions:
            # Scale values if needed (check if already in USD or raw)
            pnl = float(pos.get("realized_pnl", 0) or 0)
            bought = float(pos.get("total_bought", 0) or 0)
            amount = float(pos.get("amount", 0) or 0)

            # Detect if values need scaling (if > 1M, likely needs scaling)
            if abs(pnl) > 1_000_000_000:
                pnl = pnl / USDC_SCALE
            if bought > 1_000_000_000:
                bought = bought / USDC_SCALE

            total_realized_pnl += pnl
            total_bought += bought

            if pnl > 0:
                win_count += 1
            elif pnl < 0:
                loss_count += 1

            if amount > 0:
                open_count += 1

        return {
            "total_realized_pnl": round(total_realized_pnl, 2),
            "total_bought": round(total_bought, 2),
            "position_count": len(positions),
            "win_count": win_count,
            "loss_count": loss_count,
            "open_count": open_count
        }

    def calculate_period_metrics(
        self,
        address: str,
        days: int,
        current_balance: float = 0
    ) -> dict:
        """
        Calculate metrics for a specific time period using order fills.

        This replaces the period metrics calculation that uses Polymarket API's
        closed-positions endpoint.

        Args:
            address: Wallet address
            days: Time period in days (7 or 30)
            current_balance: Current portfolio balance for drawdown calculation

        Returns:
            Dict with pnl, roi, volume, trade_count, win_rate, drawdown
        """
        fills = self.get_order_fills_with_mapping(address, days=days)

        if not fills:
            return {
                "pnl": 0,
                "roi": 0,
                "volume": 0,
                "trade_count": 0,
                "win_rate": 0,
                "drawdown": 0
            }

        # Group fills by condition_id to calculate position-level metrics
        market_fills: dict[str, list[dict]] = {}
        for fill in fills:
            condition_id = fill.get("condition_id") or fill.get("token_id") or "unknown"
            if condition_id not in market_fills:
                market_fills[condition_id] = []
            market_fills[condition_id].append(fill)

        # Calculate metrics
        total_volume = 0
        total_pnl = 0
        trade_count = len(fills)

        # For each market, calculate net PnL
        # This is simplified - actual PnL requires knowing resolution status
        for condition_id, condition_fills in market_fills.items():
            for fill in condition_fills:
                is_maker = fill.get("is_maker", False)
                # Taker amount is usually USDC
                usdc_amount = float(fill.get("taker_amount_filled", 0) or 0)
                if usdc_amount > 1_000_000_000:
                    usdc_amount = usdc_amount / USDC_SCALE
                total_volume += usdc_amount

        # For PnL and win rate, we need the position summary
        # Period PnL from fills alone is complex; use position data as approximation
        positions = self.get_user_positions(address)

        # Calculate basic ROI
        roi = (total_pnl / total_volume * 100) if total_volume > 0 else 0

        # Win rate from position data
        win_count = sum(1 for p in positions if float(p.get("realized_pnl", 0) or 0) > 0)
        loss_count = sum(1 for p in positions if float(p.get("realized_pnl", 0) or 0) < 0)
        total_resolved = win_count + loss_count
        win_rate = (win_count / total_resolved * 100) if total_resolved > 0 else 0

        # Calculate drawdown from fill timeline
        drawdown = self._calculate_max_drawdown_from_fills(fills, current_balance)

        return {
            "pnl": round(total_pnl, 2),
            "roi": round(roi, 2),
            "volume": round(total_volume, 2),
            "trade_count": trade_count,
            "win_rate": round(win_rate, 2),
            "drawdown": drawdown
        }

    def _calculate_max_drawdown_from_fills(
        self,
        fills: list[dict],
        initial_balance: float = 0
    ) -> float:
        """
        Calculate max drawdown from order fills.

        This is an approximation based on fill events, not actual realized PnL events.
        """
        if not fills:
            return 0

        # Sort fills by timestamp ascending
        sorted_fills = sorted(fills, key=lambda x: x.get("timestamp", 0))

        balance = initial_balance
        max_balance = initial_balance
        max_drawdown_pct = 0

        for fill in sorted_fills:
            # Estimate balance change from fill
            # This is simplified - actual PnL depends on resolution
            is_maker = fill.get("is_maker", False)
            usdc_amount = float(fill.get("taker_amount_filled", 0) or 0)
            if usdc_amount > 1_000_000_000:
                usdc_amount = usdc_amount / USDC_SCALE

            # For buys: balance decreases, for sells: balance increases
            # This is a rough approximation
            if not is_maker:  # Taker is buyer
                balance -= usdc_amount
            else:
                balance += usdc_amount

            if balance > max_balance:
                max_balance = balance

            if max_balance > 0:
                drawdown_pct = ((max_balance - balance) / max_balance) * 100
                if drawdown_pct > max_drawdown_pct:
                    max_drawdown_pct = drawdown_pct

        return min(round(max_drawdown_pct, 2), 100)

    # =========================================================================
    # Full Trader Data (Similar to PolymarketDataAPI interface)
    # =========================================================================

    def get_full_trader_data(self, address: str) -> dict:
        """
        Get comprehensive trader data from Goldsky tables.

        Returns data in a format compatible with wallet_discovery.py.
        """
        positions = self.get_user_positions_with_mapping(address)
        balances = self.get_user_balances(address)
        fills = self.get_order_fills_with_mapping(address, days=0, limit=5000)
        summary = self.get_position_summary(address)

        return {
            "address": address,
            "positions": positions,
            "balances": balances,
            "fills": fills,
            "summary": summary
        }

    # =========================================================================
    # Comparison with Polymarket API (for validation)
    # =========================================================================

    def compare_with_polymarket(
        self,
        address: str,
        polymarket_data: dict
    ) -> dict:
        """
        Compare Goldsky data with Polymarket API data.

        Args:
            address: Wallet address
            polymarket_data: Data from Polymarket Data API

        Returns:
            Dict with comparison results and discrepancies
        """
        goldsky_summary = self.get_position_summary(address)

        # Extract Polymarket metrics from closed positions
        polymarket_closed = polymarket_data.get("closed_positions", [])
        pm_realized_pnl = sum(float(p.get("realizedPnl", 0)) for p in polymarket_closed)
        pm_total_bought = sum(
            float(p.get("totalBought", 0)) or (float(p.get("size", 0)) * float(p.get("avgPrice", 0)))
            for p in polymarket_closed
        )
        pm_position_count = len(polymarket_closed)

        # Calculate deltas
        pnl_delta = goldsky_summary["total_realized_pnl"] - pm_realized_pnl
        bought_delta = goldsky_summary["total_bought"] - pm_total_bought
        count_delta = goldsky_summary["position_count"] - pm_position_count

        # Calculate relative differences
        pnl_diff_pct = (abs(pnl_delta) / abs(pm_realized_pnl) * 100) if pm_realized_pnl != 0 else 0
        bought_diff_pct = (abs(bought_delta) / pm_total_bought * 100) if pm_total_bought > 0 else 0

        return {
            "goldsky": goldsky_summary,
            "polymarket": {
                "total_realized_pnl": round(pm_realized_pnl, 2),
                "total_bought": round(pm_total_bought, 2),
                "position_count": pm_position_count
            },
            "deltas": {
                "pnl_delta": round(pnl_delta, 2),
                "bought_delta": round(bought_delta, 2),
                "count_delta": count_delta
            },
            "diff_percentages": {
                "pnl_diff_pct": round(pnl_diff_pct, 2),
                "bought_diff_pct": round(bought_diff_pct, 2)
            },
            "within_tolerance": pnl_diff_pct < 1 and bought_diff_pct < 1
        }
