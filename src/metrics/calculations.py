"""Core metrics calculations."""

import statistics
from datetime import datetime, timedelta
from typing import Optional


class MetricsCalculator:
    """Calculate trading metrics from position and activity data."""

    @staticmethod
    def calculate_win_rate(closed_positions: list[dict], days: Optional[int] = None) -> dict:
        """
        Calculate win rate from closed positions.

        A position is a WIN if realized_pnl > 0.
        """
        if days:
            cutoff = datetime.now() - timedelta(days=days)
            cutoff_ts = int(cutoff.timestamp())
            positions = [
                p for p in closed_positions
                if p.get("timestamp", 0) >= cutoff_ts
            ]
        else:
            positions = closed_positions

        if not positions:
            return {"win_rate": 0, "wins": 0, "total": 0}

        wins = sum(1 for p in positions if float(p.get("realizedPnl", 0)) > 0)
        total = len(positions)

        return {
            "win_rate": (wins / total) * 100 if total > 0 else 0,
            "wins": wins,
            "total": total
        }

    @staticmethod
    def calculate_roi(
        positions: list[dict],
        closed_positions: list[dict],
        current_balance: float = 0
    ) -> dict:
        """
        Calculate ROI from positions.

        Account ROI = Total PnL / Initial Capital * 100
        Initial Capital = Current Balance - Total PnL
        """
        # Current positions
        current_value = sum(float(p.get("currentValue", 0)) for p in positions)
        initial_value = sum(float(p.get("initialValue", 0)) for p in positions)

        # Closed positions
        realized_pnl = sum(float(p.get("realizedPnl", 0)) for p in closed_positions)
        closed_invested = sum(
            float(p.get("totalBought", 0)) * float(p.get("avgPrice", 0))
            for p in closed_positions
        )

        total_invested = initial_value + closed_invested
        unrealized_pnl = current_value - initial_value
        total_pnl = realized_pnl + unrealized_pnl

        if total_invested == 0:
            return {
                "roi_percent": 0,
                "total_invested": 0,
                "total_returns": 0,
                "unrealized_pnl": 0,
                "realized_pnl": 0
            }

        # Account-level ROI: PnL / Initial Capital
        initial_capital = current_balance - total_pnl
        if initial_capital > 0:
            roi = (total_pnl / initial_capital) * 100
        elif total_pnl > 0 and total_invested > 0:
            roi = (total_pnl / total_invested) * 100  # Fallback: profitable but withdrew
        elif total_pnl < 0 and current_balance == 0:
            roi = -100.0
        else:
            roi = 0

        total_returns = current_value + realized_pnl + closed_invested

        return {
            "roi_percent": roi,
            "total_invested": total_invested,
            "total_returns": total_returns,
            "unrealized_pnl": unrealized_pnl,
            "realized_pnl": realized_pnl
        }

    @staticmethod
    def calculate_max_drawdown(activity: list[dict]) -> float:
        """
        Calculate maximum drawdown from activity.

        Max Drawdown = Maximum peak-to-trough decline.
        """
        if not activity:
            return 0

        # Sort by timestamp
        sorted_activity = sorted(activity, key=lambda x: x.get("timestamp", 0))

        cumulative_pnl = 0
        peak = 0
        max_drawdown = 0

        for event in sorted_activity:
            if event.get("type") in ["TRADE", "BUY", "SELL"]:
                pnl = float(event.get("realizedPnl", 0))
                cumulative_pnl += pnl

                if cumulative_pnl > peak:
                    peak = cumulative_pnl

                if peak > 0:
                    drawdown = (peak - cumulative_pnl) / peak
                    max_drawdown = max(max_drawdown, drawdown)

        return max_drawdown * 100

    @staticmethod
    def calculate_trade_frequency(activity: list[dict], days: int = 30) -> float:
        """Calculate average trades per day."""
        if not activity:
            return 0

        trades = [a for a in activity if a.get("type") in ["TRADE", "BUY", "SELL"]]
        if not trades:
            return 0

        timestamps = [t.get("timestamp", 0) for t in trades if t.get("timestamp")]
        if len(timestamps) < 2:
            return len(trades) / days

        min_ts = min(timestamps)
        max_ts = max(timestamps)
        days_active = (max_ts - min_ts) / 86400

        if days_active <= 0:
            return len(trades)

        return len(trades) / days_active

    @staticmethod
    def calculate_unique_markets(positions: list[dict], closed_positions: list[dict]) -> int:
        """Count unique markets traded."""
        market_slugs = set()

        for pos in positions:
            if slug := pos.get("slug"):
                market_slugs.add(slug)

        for pos in closed_positions:
            if slug := pos.get("slug"):
                market_slugs.add(slug)

        return len(market_slugs)

    @staticmethod
    def calculate_position_metrics(positions: list[dict]) -> dict:
        """Calculate position-related metrics."""
        if not positions:
            return {
                "total_positions": 0,
                "active_positions": 0,
                "avg_position_size": 0,
                "max_position_size": 0,
                "position_concentration": 0
            }

        values = [float(p.get("currentValue", 0)) for p in positions]
        total_value = sum(values)
        max_value = max(values) if values else 0
        avg_value = total_value / len(values) if values else 0

        concentration = (max_value / total_value * 100) if total_value > 0 else 0

        return {
            "total_positions": len(positions),
            "active_positions": len([p for p in positions if float(p.get("size", 0)) > 0]),
            "avg_position_size": avg_value,
            "max_position_size": max_value,
            "position_concentration": concentration
        }

    @staticmethod
    def calculate_total_pnl(
        positions: list[dict],
        closed_positions: list[dict]
    ) -> dict:
        """Calculate total PnL breakdown."""
        unrealized = sum(float(p.get("cashPnl", 0)) for p in positions)
        realized = sum(float(p.get("realizedPnl", 0)) for p in closed_positions)

        return {
            "unrealized_pnl": unrealized,
            "realized_pnl": realized,
            "total_pnl": unrealized + realized
        }

    @staticmethod
    def calculate_account_age(first_trade_at: datetime) -> int:
        """Calculate account age in days."""
        if not first_trade_at:
            return 0
        return (datetime.now() - first_trade_at).days

    @staticmethod
    def calculate_hold_duration(activity: list[dict]) -> float:
        """Calculate average hold duration in hours."""
        if not activity:
            return 0

        # Group trades by market
        market_trades: dict[str, list] = {}
        for event in activity:
            if event.get("type") not in ["TRADE", "BUY", "SELL"]:
                continue
            market = event.get("slug") or event.get("conditionId", "unknown")
            if market not in market_trades:
                market_trades[market] = []
            market_trades[market].append(event)

        hold_durations = []
        for market, trades in market_trades.items():
            if len(trades) < 2:
                continue
            timestamps = sorted([t.get("timestamp", 0) for t in trades])
            for i in range(1, len(timestamps)):
                duration_hours = (timestamps[i] - timestamps[i-1]) / 3600
                hold_durations.append(duration_hours)

        if not hold_durations:
            return 0

        return statistics.mean(hold_durations)
