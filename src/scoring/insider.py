"""Insider trading suspicion scoring algorithm."""

from typing import Any


class InsiderScorer:
    """
    Score suspicion that trader has insider information.

    Indicators (weights):
    - New account with big wins (25%)
    - High position concentration (25%)
    - Low entry probability bets (20%)
    - Few unique markets (15%)
    - Large max position (15%)
    """

    @staticmethod
    def calculate_score(trader: dict[str, Any]) -> int:
        """Calculate insider suspicion score (0-100)."""
        score = 0

        # New Account + Profitable (0-25 points)
        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)

        if age <= 14 and pnl >= 5000:
            score += 25
        elif age <= 30 and pnl >= 2000:
            score += 20
        elif age <= 30 and pnl >= 500:
            score += 12
        elif age <= 60 and pnl >= 1000:
            score += 6

        # Position Concentration (0-25 points)
        conc = trader.get("position_concentration", 0)
        if conc >= 80:
            score += 25
        elif conc >= 60:
            score += 20
        elif conc >= 50:
            score += 15
        elif conc >= 40:
            score += 8

        # Low Entry Probability (0-20 points)
        entry = trader.get("avg_entry_probability", 50)
        if entry <= 15:
            score += 20
        elif entry <= 25:
            score += 16
        elif entry <= 30:
            score += 12
        elif entry <= 35:
            score += 6

        # Few Unique Markets (0-15 points)
        markets = trader.get("unique_markets_30d", 10)
        if markets == 1:
            score += 15
        elif markets == 2:
            score += 12
        elif markets <= 3:
            score += 8
        elif markets <= 5:
            score += 4

        # Large Max Position (0-15 points)
        max_pos = trader.get("max_position_size", 0)
        if max_pos >= 50000:
            score += 15
        elif max_pos >= 20000:
            score += 12
        elif max_pos >= 10000:
            score += 9
        elif max_pos >= 5000:
            score += 6
        elif max_pos >= 2000:
            score += 3

        return min(100, score)

    @staticmethod
    def get_score_breakdown(trader: dict[str, Any]) -> dict[str, dict]:
        """Get detailed breakdown of insider indicators."""
        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)
        conc = trader.get("position_concentration", 0)
        entry = trader.get("avg_entry_probability", 50)
        markets = trader.get("unique_markets_30d", 10)
        max_pos = trader.get("max_position_size", 0)

        return {
            "new_account_profit": {
                "age_days": age,
                "pnl": pnl,
                "max_points": 25,
                "suspicious": age <= 30 and pnl >= 500,
                "description": f"{age} day old account with ${pnl:.0f} profit"
            },
            "position_concentration": {
                "value": conc,
                "max_points": 25,
                "suspicious": conc >= 50,
                "description": f"{conc:.1f}% in largest position"
            },
            "entry_probability": {
                "value": entry,
                "max_points": 20,
                "suspicious": entry <= 30,
                "description": f"Avg {entry:.1f}% entry probability"
            },
            "market_focus": {
                "value": markets,
                "max_points": 15,
                "suspicious": markets <= 3,
                "description": f"Only {markets} unique markets"
            },
            "position_size": {
                "value": max_pos,
                "max_points": 15,
                "suspicious": max_pos >= 5000,
                "description": f"${max_pos:.0f} largest position"
            }
        }

    @staticmethod
    def is_suspicious(trader: dict[str, Any], threshold: int = 60) -> bool:
        """Check if trader shows suspicious insider-like patterns."""
        score = InsiderScorer.calculate_score(trader)
        return score >= threshold

    @staticmethod
    def get_suspicion_level(score: int) -> str:
        """Get suspicion level based on score."""
        if score >= 85:
            return "very_high"
        elif score >= 70:
            return "high"
        elif score >= 55:
            return "moderate"
        elif score >= 40:
            return "low"
        else:
            return "minimal"

    @staticmethod
    def get_red_flags(trader: dict[str, Any]) -> list[str]:
        """Get list of specific red flags for this trader."""
        flags = []

        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)

        if age <= 14:
            flags.append("Very new account (< 2 weeks)")
        if pnl >= 5000 and age <= 30:
            flags.append(f"High profit (${pnl:.0f}) on new account")

        conc = trader.get("position_concentration", 0)
        if conc >= 70:
            flags.append(f"Extremely concentrated ({conc:.0f}% in one position)")
        elif conc >= 50:
            flags.append(f"High concentration ({conc:.0f}% in one position)")

        entry = trader.get("avg_entry_probability", 50)
        if entry <= 20:
            flags.append(f"Betting on extreme underdogs (avg {entry:.0f}%)")
        elif entry <= 30:
            flags.append(f"Betting on underdogs (avg {entry:.0f}%)")

        markets = trader.get("unique_markets_30d", 10)
        if markets == 1:
            flags.append("Single market focus")
        elif markets <= 2:
            flags.append(f"Very narrow focus ({markets} markets)")

        max_pos = trader.get("max_position_size", 0)
        if max_pos >= 20000:
            flags.append(f"Very large position (${max_pos:.0f})")
        elif max_pos >= 10000:
            flags.append(f"Large position (${max_pos:.0f})")

        return flags
