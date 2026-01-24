"""Goldsky GraphQL API client for complete on-chain Polymarket data.

Goldsky provides access to Polymarket's on-chain data via GraphQL subgraphs.
This client fetches ALL metrics from on-chain data:
- Trades (volume, trade counts) from orderbook subgraph
- Positions (PnL, win rate, ROI) from PnL subgraph
- Redemptions (resolved positions) from activity subgraph

No need for Polymarket REST API for metrics - only use it for wallet discovery.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

# Goldsky subgraph endpoints
ORDERBOOK_SUBGRAPH = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn"
PNL_SUBGRAPH = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn"
ACTIVITY_SUBGRAPH = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn"
POSITIONS_SUBGRAPH = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn"

# Token decimals (USDC and position tokens use 6 decimals)
DECIMALS = 1e6

# Default: only fetch last 30 days of trades (for volume/trade count)
DEFAULT_LOOKBACK_DAYS = 30


class GoldskyAPI:
    """Client for Goldsky GraphQL API - fetches ALL metrics from on-chain data."""

    def __init__(self, lookback_days: int = DEFAULT_LOOKBACK_DAYS):
        """
        Initialize Goldsky API client.

        Args:
            lookback_days: Number of days of trade history to fetch for volume (default: 30)
        """
        self._session: Optional[aiohttp.ClientSession] = None
        self.lookback_days = lookback_days

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def _ensure_session(self):
        """Ensure we have an active session."""
        if not self._session:
            self._session = aiohttp.ClientSession()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10)
    )
    async def _query(self, endpoint: str, query: str, variables: dict) -> dict:
        """Execute a GraphQL query."""
        await self._ensure_session()

        async with self._session.post(
            endpoint,
            json={"query": query, "variables": variables},
            timeout=aiohttp.ClientTimeout(total=30)
        ) as response:
            if response.status != 200:
                text = await response.text()
                logger.error(f"Goldsky API error: {response.status} - {text}")
                raise Exception(f"Goldsky API error: {response.status}")

            data = await response.json()
            if "errors" in data:
                logger.error(f"GraphQL error: {data['errors']}")
                raise Exception(f"GraphQL error: {data['errors']}")

            return data.get("data", {})

    # =========================================================================
    # TRADES (from Orderbook Subgraph) - for volume and trade counts
    # =========================================================================

    async def get_trades_since(self, address: str, since_timestamp: int, batch_size: int = 1000) -> list[dict]:
        """Fetch trades for an address since a given timestamp."""
        address = address.lower()
        all_trades = []

        # Query for maker trades
        query = """
        query($address: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
            trades: orderFilledEvents(
                where: { maker: $address, timestamp_gte: $since }
                first: $first
                skip: $skip
                orderBy: timestamp
                orderDirection: desc
            ) {
                id
                timestamp
                maker
                taker
                makerAssetId
                takerAssetId
                makerAmountFilled
                takerAmountFilled
            }
        }
        """

        # Fetch maker trades
        skip = 0
        while True:
            try:
                data = await self._query(
                    ORDERBOOK_SUBGRAPH, query,
                    {"address": address, "since": str(since_timestamp), "first": batch_size, "skip": skip}
                )
                trades = data.get("trades", [])
                if not trades:
                    break
                all_trades.extend(trades)
                if len(trades) < batch_size:
                    break
                skip += batch_size
            except Exception as e:
                logger.error(f"Error fetching maker trades: {e}")
                break

        # Fetch taker trades
        query_taker = query.replace("maker:", "taker:")
        skip = 0
        while True:
            try:
                data = await self._query(
                    ORDERBOOK_SUBGRAPH, query_taker,
                    {"address": address, "since": str(since_timestamp), "first": batch_size, "skip": skip}
                )
                trades = data.get("trades", [])
                if not trades:
                    break
                all_trades.extend(trades)
                if len(trades) < batch_size:
                    break
                skip += batch_size
            except Exception as e:
                logger.error(f"Error fetching taker trades: {e}")
                break

        return all_trades

    def parse_trade(self, trade: dict, address: str) -> dict:
        """Parse a raw trade into structured format with cash flow direction."""
        address_lower = address.lower()
        timestamp = int(trade["timestamp"])
        is_maker = trade["maker"].lower() == address_lower

        maker_amount = int(trade["makerAmountFilled"]) / DECIMALS
        taker_amount = int(trade["takerAmountFilled"]) / DECIMALS

        if is_maker:
            if trade["makerAssetId"] == "0":
                # Maker gave USDC (BUY) - cash outflow
                side, usd_value, cash_flow = "BUY", maker_amount, -maker_amount
            else:
                # Maker gave tokens (SELL) - cash inflow
                side, usd_value, cash_flow = "SELL", taker_amount, taker_amount
        else:
            if trade["takerAssetId"] == "0":
                # Taker gave USDC (BUY) - cash outflow
                side, usd_value, cash_flow = "BUY", taker_amount, -taker_amount
            else:
                # Taker gave tokens (SELL) - cash inflow
                side, usd_value, cash_flow = "SELL", maker_amount, maker_amount

        return {"timestamp": timestamp, "side": side, "usd_value": usd_value, "cash_flow": cash_flow}

    # =========================================================================
    # POSITIONS (from PnL Subgraph) - for PnL, win rate, ROI
    # =========================================================================

    async def get_user_positions(self, address: str, batch_size: int = 1000) -> list[dict]:
        """Fetch all user positions with PnL data from PnL subgraph."""
        address = address.lower()
        all_positions = []

        query = """
        query($user: String!, $first: Int!, $skip: Int!) {
            userPositions(
                where: { user: $user }
                first: $first
                skip: $skip
            ) {
                id
                tokenId
                amount
                avgPrice
                realizedPnl
                totalBought
            }
        }
        """

        skip = 0
        while True:
            try:
                data = await self._query(
                    PNL_SUBGRAPH, query,
                    {"user": address, "first": batch_size, "skip": skip}
                )
                positions = data.get("userPositions", [])
                if not positions:
                    break
                all_positions.extend(positions)
                logger.debug(f"Fetched {len(positions)} positions (total: {len(all_positions)})")
                if len(positions) < batch_size:
                    break
                skip += batch_size
            except Exception as e:
                logger.error(f"Error fetching positions: {e}")
                break

        return all_positions

    # =========================================================================
    # REDEMPTIONS (from Activity Subgraph) - for time-filtered win rate
    # =========================================================================

    async def get_redemptions(self, address: str, since_timestamp: int = 0, batch_size: int = 1000) -> list[dict]:
        """Fetch redemptions (resolved positions) from activity subgraph."""
        address = address.lower()
        all_redemptions = []

        query = """
        query($user: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
            redemptions(
                where: { redeemer: $user, timestamp_gte: $since }
                first: $first
                skip: $skip
                orderBy: timestamp
                orderDirection: desc
            ) {
                id
                timestamp
                condition { id }
                payout
            }
        }
        """

        skip = 0
        while True:
            try:
                data = await self._query(
                    ACTIVITY_SUBGRAPH, query,
                    {"user": address, "since": str(since_timestamp), "first": batch_size, "skip": skip}
                )
                redemptions = data.get("redemptions", [])
                if not redemptions:
                    break
                all_redemptions.extend(redemptions)
                if len(redemptions) < batch_size:
                    break
                skip += batch_size
            except Exception as e:
                logger.error(f"Error fetching redemptions: {e}")
                break

        return all_redemptions

    # =========================================================================
    # COMPLETE METRICS CALCULATION
    # =========================================================================

    def _calculate_period_metrics(self, trades: list[dict], redemptions: list[dict]) -> dict:
        """
        Calculate ROI and drawdown for a specific time period.

        ROI = (Total Sells + Redemption Payouts - Total Buys) / Total Buys * 100
        Drawdown = Maximum peak-to-trough decline in cumulative PnL

        Args:
            trades: List of parsed trades for the period
            redemptions: List of redemptions for the period

        Returns:
            Dict with roi and drawdown for the period
        """
        if not trades:
            return {"roi": 0, "drawdown": 0, "buy_volume": 0, "sell_volume": 0}

        # Calculate buy/sell volumes
        buy_volume = sum(t["usd_value"] for t in trades if t["side"] == "BUY")
        sell_volume = sum(t["usd_value"] for t in trades if t["side"] == "SELL")

        # Add redemption payouts to returns
        redemption_payouts = sum(int(r.get("payout", 0)) / DECIMALS for r in redemptions)

        # ROI = (returns - investment) / investment * 100
        # Returns = sell_volume + redemption_payouts
        # Investment = buy_volume
        total_returns = sell_volume + redemption_payouts
        roi = ((total_returns - buy_volume) / buy_volume * 100) if buy_volume > 0 else 0

        # Calculate drawdown from cumulative cash flow
        # Sort trades by timestamp (oldest first)
        sorted_trades = sorted(trades, key=lambda t: t["timestamp"])

        cumulative = 0
        peak = 0
        max_drawdown = 0

        for trade in sorted_trades:
            cumulative += trade["cash_flow"]
            if cumulative > peak:
                peak = cumulative
            drawdown = peak - cumulative
            if drawdown > max_drawdown:
                max_drawdown = drawdown

        # Drawdown as percentage of peak (if peak > 0), capped at 100%
        drawdown_pct = (max_drawdown / peak * 100) if peak > 0 else 0
        drawdown_pct = min(drawdown_pct, 100)  # Cap at 100%

        return {
            "roi": round(roi, 2),
            "drawdown": round(drawdown_pct, 2),
            "buy_volume": round(buy_volume, 2),
            "sell_volume": round(sell_volume, 2),
        }

    async def get_complete_metrics(self, address: str) -> dict:
        """
        Fetch and calculate ALL metrics from Goldsky on-chain data.

        Returns complete metrics including:
        - Volume (7d, 30d)
        - Trade count (7d, 30d)
        - PnL (7d, 30d)
        - Win rate (7d, 30d)
        - ROI (7d, 30d)
        - Drawdown (7d, 30d)
        - Position counts (open, closed, wins, losses)

        Args:
            address: Ethereum address

        Returns:
            Dict with all calculated metrics
        """
        now = datetime.now(timezone.utc)
        cutoff_7d = int((now - timedelta(days=7)).timestamp())
        cutoff_30d = int((now - timedelta(days=30)).timestamp())

        # Fetch all data in parallel
        trades_task = self.get_trades_since(address, cutoff_30d)
        positions_task = self.get_user_positions(address)
        redemptions_7d_task = self.get_redemptions(address, cutoff_7d)
        redemptions_30d_task = self.get_redemptions(address, cutoff_30d)

        trades, positions, redemptions_7d, redemptions_30d = await asyncio.gather(
            trades_task, positions_task, redemptions_7d_task, redemptions_30d_task,
            return_exceptions=True
        )

        # Handle errors gracefully
        if isinstance(trades, Exception):
            logger.error(f"Failed to fetch trades: {trades}")
            trades = []
        if isinstance(positions, Exception):
            logger.error(f"Failed to fetch positions: {positions}")
            positions = []
        if isinstance(redemptions_7d, Exception):
            redemptions_7d = []
        if isinstance(redemptions_30d, Exception):
            redemptions_30d = []

        # Parse trades and filter by time period
        parsed_trades = [self.parse_trade(t, address) for t in trades]
        trades_7d = [t for t in parsed_trades if t["timestamp"] >= cutoff_7d]
        trades_30d = parsed_trades  # All trades are within 30d (that's what we fetched)

        # Calculate volume
        volume_7d = sum(t["usd_value"] for t in trades_7d)
        volume_30d = sum(t["usd_value"] for t in trades_30d)

        # Calculate ROI and drawdown for each period
        metrics_7d = self._calculate_period_metrics(trades_7d, redemptions_7d)
        metrics_30d = self._calculate_period_metrics(trades_30d, redemptions_30d)

        # Calculate position metrics (all-time from positions subgraph)
        total_realized_pnl = 0
        total_bought = 0
        open_positions = 0
        winning_positions = 0
        losing_positions = 0
        unique_markets = set()

        for pos in positions:
            realized_pnl = int(pos.get("realizedPnl", 0)) / DECIMALS
            amount = int(pos.get("amount", 0)) / DECIMALS
            bought = int(pos.get("totalBought", 0)) / DECIMALS
            token_id = pos.get("tokenId", "")

            total_realized_pnl += realized_pnl
            total_bought += bought

            if token_id:
                unique_markets.add(token_id)

            if amount > 0.001:  # Has balance = open position
                open_positions += 1
            elif realized_pnl > 0.01:  # Positive PnL = win
                winning_positions += 1
            elif realized_pnl < -0.01:  # Negative PnL = loss
                losing_positions += 1

        closed_positions = winning_positions + losing_positions
        win_rate_all = (winning_positions / closed_positions * 100) if closed_positions > 0 else 0
        roi_all = (total_realized_pnl / total_bought * 100) if total_bought > 0 else 0

        # Calculate time-period specific win rates from redemptions
        wins_7d = sum(1 for r in redemptions_7d if int(r.get("payout", 0)) > 0)
        win_rate_7d = (wins_7d / len(redemptions_7d) * 100) if redemptions_7d else 0

        wins_30d = sum(1 for r in redemptions_30d if int(r.get("payout", 0)) > 0)
        win_rate_30d = (wins_30d / len(redemptions_30d) * 100) if redemptions_30d else 0

        # Calculate PnL for time periods (from redemptions)
        pnl_7d = sum(int(r.get("payout", 0)) / DECIMALS for r in redemptions_7d)
        pnl_30d = sum(int(r.get("payout", 0)) / DECIMALS for r in redemptions_30d)

        return {
            # 7-Day Metrics
            "volume_7d": round(volume_7d, 2),
            "trade_count_7d": len(trades_7d),
            "pnl_7d": round(pnl_7d, 2),
            "roi_7d": metrics_7d["roi"],
            "win_rate_7d": round(win_rate_7d, 2),
            "drawdown_7d": metrics_7d["drawdown"],

            # 30-Day Metrics
            "volume_30d": round(volume_30d, 2),
            "trade_count_30d": len(trades_30d),
            "pnl_30d": round(pnl_30d, 2),
            "roi_30d": metrics_30d["roi"],
            "win_rate_30d": round(win_rate_30d, 2),
            "drawdown_30d": metrics_30d["drawdown"],

            # All-Time Summary (lightweight - no extra API calls)
            "win_rate_all": round(win_rate_all, 2),
            "realized_pnl": round(total_realized_pnl, 2),
            "roi_all": round(roi_all, 2),

            # Position Counts
            "open_positions": open_positions,
            "closed_positions": closed_positions,
            "total_positions": open_positions + closed_positions,
            "winning_positions": winning_positions,
            "losing_positions": losing_positions,

            # Additional
            "unique_markets": len(unique_markets),
            "total_invested": round(total_bought, 2),

            # Metadata
            "trades_fetched": len(trades),
            "positions_fetched": len(positions),
            "lookback_days": self.lookback_days,
        }


async def get_trader_metrics(address: str, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> dict:
    """
    Convenience function to get complete trader metrics from Goldsky.

    Args:
        address: Ethereum address
        lookback_days: Days of trade history to fetch (default: 30)

    Returns:
        Dict with all trading metrics from on-chain data
    """
    async with GoldskyAPI(lookback_days=lookback_days) as api:
        return await api.get_complete_metrics(address)
