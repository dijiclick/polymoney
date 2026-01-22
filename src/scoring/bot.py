"""Bot likelihood scoring algorithm."""

from typing import Any


class BotScorer:
    """
    Score likelihood that trader is a bot.

    Indicators (weights):
    - High trade frequency (25%)
    - Low time variance (25%)
    - Night trading (20%)
    - Consistent position sizing (15%)
    - Short hold duration (15%)
    """

    @staticmethod
    def calculate_score(trader: dict[str, Any]) -> int:
        """Calculate bot likelihood score (0-100)."""
        score = 0

        # High Trade Frequency (0-25 points)
        freq = trader.get("trade_frequency", 0)
        if freq >= 50:
            score += 25
        elif freq >= 20:
            score += 20
        elif freq >= 10:
            score += 15
        elif freq >= 5:
            score += 8

        # Low Time Variance (0-25 points)
        variance = trader.get("trade_time_variance_hours")
        if variance is not None:
            if variance <= 0.5:
                score += 25
            elif variance <= 1:
                score += 20
            elif variance <= 2:
                score += 15
            elif variance <= 4:
                score += 8

        # Night Trading (0-20 points)
        night = trader.get("night_trade_ratio", 0)
        if night >= 40:
            score += 20
        elif night >= 30:
            score += 15
        elif night >= 20:
            score += 10
        elif night >= 10:
            score += 5

        # Consistent Position Sizing (0-15 points)
        size_var = trader.get("position_size_variance")
        if size_var is not None:
            if size_var <= 10:
                score += 15
            elif size_var <= 20:
                score += 12
            elif size_var <= 30:
                score += 8
            elif size_var <= 50:
                score += 4

        # Short Hold Duration (0-15 points)
        hold = trader.get("avg_hold_duration_hours")
        if hold is not None:
            if hold <= 2:
                score += 15
            elif hold <= 6:
                score += 12
            elif hold <= 12:
                score += 8
            elif hold <= 24:
                score += 4

        return min(100, score)

    @staticmethod
    def get_score_breakdown(trader: dict[str, Any]) -> dict[str, dict]:
        """Get detailed breakdown of bot indicators."""
        freq = trader.get("trade_frequency", 0)
        variance = trader.get("trade_time_variance_hours")
        night = trader.get("night_trade_ratio", 0)
        size_var = trader.get("position_size_variance")
        hold = trader.get("avg_hold_duration_hours")

        breakdown = {
            "trade_frequency": {
                "value": freq,
                "max_points": 25,
                "threshold": ">=50 for max",
                "indicator": "high" if freq >= 10 else "normal",
                "description": f"{freq:.1f} trades/day"
            },
            "time_variance": {
                "value": variance,
                "max_points": 25,
                "threshold": "<=0.5h for max",
                "indicator": "bot-like" if variance and variance <= 2 else "human-like",
                "description": f"{variance:.2f}h variance" if variance else "N/A"
            },
            "night_trading": {
                "value": night,
                "max_points": 20,
                "threshold": ">=40% for max",
                "indicator": "24/7" if night >= 30 else "normal hours",
                "description": f"{night:.1f}% night trades"
            },
            "size_variance": {
                "value": size_var,
                "max_points": 15,
                "threshold": "<=10% for max",
                "indicator": "consistent" if size_var and size_var <= 20 else "varied",
                "description": f"{size_var:.1f}% variance" if size_var else "N/A"
            },
            "hold_duration": {
                "value": hold,
                "max_points": 15,
                "threshold": "<=2h for max",
                "indicator": "scalper" if hold and hold <= 6 else "holder",
                "description": f"{hold:.1f}h avg hold" if hold else "N/A"
            }
        }

        return breakdown

    @staticmethod
    def is_likely_bot(trader: dict[str, Any], threshold: int = 60) -> bool:
        """Check if trader is likely a bot."""
        score = BotScorer.calculate_score(trader)
        return score >= threshold

    @staticmethod
    def get_bot_type(trader: dict[str, Any]) -> str:
        """Classify the type of bot based on patterns."""
        freq = trader.get("trade_frequency", 0)
        hold = trader.get("avg_hold_duration_hours") or float("inf")
        win_rate = trader.get("win_rate_30d", 0)

        if freq >= 50 and hold <= 1:
            return "high_frequency_scalper"
        elif freq >= 20 and win_rate >= 55:
            return "arbitrage_bot"
        elif freq >= 10 and trader.get("night_trade_ratio", 0) >= 30:
            return "market_maker"
        elif freq >= 5 and trader.get("position_size_variance", 100) <= 20:
            return "systematic_trader"
        else:
            return "unknown_bot_type"

    @staticmethod
    def get_confidence(score: int) -> str:
        """Get confidence level for bot detection."""
        if score >= 85:
            return "very_high"
        elif score >= 70:
            return "high"
        elif score >= 55:
            return "medium"
        elif score >= 40:
            return "low"
        else:
            return "unlikely"
