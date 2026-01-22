"""Copy trade scoring algorithm."""

from typing import Any


class CopytradeScorer:
    """
    Score traders on their suitability for copy trading.

    Factors (weights):
    - Win rate 30d (25%)
    - ROI (20%)
    - Max drawdown (20%)
    - Account age (15%)
    - Diversification (10%)
    - Consistency (10%)
    """

    @staticmethod
    def calculate_score(trader: dict[str, Any]) -> int:
        """Calculate copy trade score (0-100)."""
        score = 0

        # Win Rate (0-25 points)
        wr = trader.get("win_rate_30d", 0)
        if wr >= 70:
            score += 25
        elif wr >= 65:
            score += 22
        elif wr >= 60:
            score += 18
        elif wr >= 55:
            score += 12
        elif wr >= 50:
            score += 5

        # ROI (0-20 points)
        roi = trader.get("roi_percent", 0)
        if roi >= 50:
            score += 20
        elif roi >= 30:
            score += 16
        elif roi >= 20:
            score += 12
        elif roi >= 10:
            score += 8
        elif roi >= 0:
            score += 4

        # Max Drawdown (0-20 points, lower is better)
        dd = trader.get("max_drawdown", 100)
        if dd <= 10:
            score += 20
        elif dd <= 20:
            score += 16
        elif dd <= 30:
            score += 12
        elif dd <= 40:
            score += 6
        elif dd <= 50:
            score += 2

        # Account Age (0-15 points)
        age = trader.get("account_age_days", 0)
        if age >= 180:
            score += 15
        elif age >= 90:
            score += 12
        elif age >= 60:
            score += 9
        elif age >= 30:
            score += 5

        # Diversification (0-10 points)
        markets = trader.get("unique_markets_30d", 0)
        if markets >= 10:
            score += 10
        elif markets >= 7:
            score += 8
        elif markets >= 5:
            score += 6
        elif markets >= 3:
            score += 3

        # Consistency - Trade Frequency (0-10 points)
        freq = trader.get("trade_frequency", 0)
        if 0.5 <= freq <= 5:  # Sweet spot
            score += 10
        elif 0.2 <= freq <= 10:
            score += 6
        elif freq > 0:
            score += 2

        return min(100, score)

    @staticmethod
    def get_score_breakdown(trader: dict[str, Any]) -> dict[str, dict]:
        """Get detailed breakdown of score components."""
        wr = trader.get("win_rate_30d", 0)
        roi = trader.get("roi_percent", 0)
        dd = trader.get("max_drawdown", 100)
        age = trader.get("account_age_days", 0)
        markets = trader.get("unique_markets_30d", 0)
        freq = trader.get("trade_frequency", 0)

        return {
            "win_rate": {
                "value": wr,
                "max_points": 25,
                "points": min(25, max(0, int((wr - 50) / 20 * 25))) if wr >= 50 else 0,
                "description": f"{wr:.1f}% win rate in 30 days"
            },
            "roi": {
                "value": roi,
                "max_points": 20,
                "points": min(20, max(0, int(roi / 50 * 20))) if roi >= 0 else 0,
                "description": f"{roi:.1f}% return on investment"
            },
            "drawdown": {
                "value": dd,
                "max_points": 20,
                "points": max(0, 20 - int(dd / 50 * 20)),
                "description": f"{dd:.1f}% maximum drawdown"
            },
            "account_age": {
                "value": age,
                "max_points": 15,
                "points": min(15, int(age / 180 * 15)),
                "description": f"{age} days old account"
            },
            "diversification": {
                "value": markets,
                "max_points": 10,
                "points": min(10, markets),
                "description": f"{markets} unique markets traded"
            },
            "consistency": {
                "value": freq,
                "max_points": 10,
                "points": 10 if 0.5 <= freq <= 5 else (6 if 0.2 <= freq <= 10 else 2),
                "description": f"{freq:.1f} trades per day"
            }
        }

    @staticmethod
    def is_qualified(trader: dict[str, Any], min_score: int = 60) -> bool:
        """Check if trader qualifies as copy trade candidate."""
        score = CopytradeScorer.calculate_score(trader)
        return score >= min_score

    @staticmethod
    def get_tier(score: int) -> str:
        """Get tier based on score."""
        if score >= 90:
            return "S"
        elif score >= 80:
            return "A"
        elif score >= 70:
            return "B"
        elif score >= 60:
            return "C"
        else:
            return "D"
