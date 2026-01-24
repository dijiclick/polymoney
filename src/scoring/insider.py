"""
Enhanced insider trading suspicion scoring algorithm.

Based on research from:
- Polymarket Insider Tracker (GitHub)
- PolyTrack detection methodology
- Academic research on ML-based insider detection
- Real-world case studies (Maduro windfall, OpenAI browser bet)

Detection signals:
1. Fresh wallet patterns (< 5 lifetime transactions)
2. Win rate anomalies (75%+ in specific categories)
3. Timing patterns (positions 1-4 hours before news)
4. Position concentration (40%+ in single bet)
5. Entry at extreme odds (< 15% that resolve 90%+)
6. Volume/sizing anomalies (5-10x normal positions)
7. Niche market focus (< $50k daily volume markets)
8. Coordinated wallet behavior (similar patterns)
"""

from typing import Any


class InsiderScorer:
    """
    Score suspicion that trader has insider information.

    Enhanced scoring weights:
    - New account with big wins (20%)
    - High position concentration (20%)
    - Low entry probability bets (15%)
    - Few unique markets / niche focus (15%)
    - Large max position (10%)
    - Win rate anomaly (10%)
    - Trading volume spike (5%)
    - One-sided trading pattern (5%)
    """

    @staticmethod
    def calculate_score(trader: dict[str, Any]) -> int:
        """Calculate insider suspicion score (0-100)."""
        score = 0

        # 1. New Account + Profitable (0-20 points)
        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)
        transaction_count = trader.get("transaction_count", 100)

        # Fresh wallet detection (< 5 transactions is highly suspicious)
        if transaction_count <= 5:
            if pnl >= 1000:
                score += 20  # Fresh wallet with significant profit
            elif pnl >= 100:
                score += 15
        elif age <= 7 and pnl >= 5000:
            score += 20  # Very new account with big wins
        elif age <= 14 and pnl >= 5000:
            score += 18
        elif age <= 14 and pnl >= 2000:
            score += 15
        elif age <= 30 and pnl >= 2000:
            score += 12
        elif age <= 30 and pnl >= 500:
            score += 8
        elif age <= 60 and pnl >= 1000:
            score += 5

        # 2. Position Concentration (0-20 points)
        # 40-60%+ of capital on single position is red flag
        conc = trader.get("position_concentration", 0)
        if conc >= 90:
            score += 20
        elif conc >= 80:
            score += 18
        elif conc >= 70:
            score += 15
        elif conc >= 60:
            score += 12
        elif conc >= 50:
            score += 10
        elif conc >= 40:
            score += 6

        # 3. Low Entry Probability (0-15 points)
        # Entry at 15-25% odds that later resolve at 90-100%
        entry = trader.get("avg_entry_probability", 50)
        if entry <= 10:
            score += 15  # Extreme underdog betting
        elif entry <= 15:
            score += 13
        elif entry <= 20:
            score += 11
        elif entry <= 25:
            score += 9
        elif entry <= 30:
            score += 7
        elif entry <= 35:
            score += 4

        # 4. Few Unique Markets / Niche Focus (0-15 points)
        markets = trader.get("unique_markets_30d", 10)
        niche_market_ratio = trader.get("niche_market_ratio", 0)  # % of trades in < $50k markets

        if markets == 1:
            score += 12
        elif markets == 2:
            score += 10
        elif markets <= 3:
            score += 7
        elif markets <= 5:
            score += 4

        # Additional points for niche market focus
        if niche_market_ratio >= 80:
            score += 3
        elif niche_market_ratio >= 50:
            score += 2

        # 5. Large Max Position (0-10 points)
        max_pos = trader.get("max_position_size", 0)
        if max_pos >= 50000:
            score += 10
        elif max_pos >= 20000:
            score += 8
        elif max_pos >= 10000:
            score += 6
        elif max_pos >= 5000:
            score += 4
        elif max_pos >= 2000:
            score += 2

        # 6. Win Rate Anomaly (0-10 points)
        # 75-80%+ win rate in specific category is suspicious
        win_rate = trader.get("win_rate", 50)
        category_win_rate = trader.get("category_win_rate", 50)  # Best category
        total_trades = trader.get("total_trades", 0)

        # Need minimum trades for win rate to matter
        if total_trades >= 5:
            if win_rate >= 90:
                score += 10
            elif win_rate >= 80:
                score += 8
            elif win_rate >= 75:
                score += 6
            elif category_win_rate >= 90 and total_trades >= 3:
                score += 5  # Perfect in one category

        # 7. Volume/Sizing Anomaly (0-5 points)
        # Position sizes 5-10x larger than typical
        avg_position = trader.get("avg_position_size", 0)
        if max_pos > 0 and avg_position > 0:
            size_ratio = max_pos / avg_position
            if size_ratio >= 10:
                score += 5
            elif size_ratio >= 5:
                score += 3
            elif size_ratio >= 3:
                score += 1

        # 8. One-Sided Trading Pattern (0-5 points)
        # 95%+ buy or sell pressure is suspicious
        buy_ratio = trader.get("buy_ratio", 50)
        if buy_ratio >= 95 or buy_ratio <= 5:
            score += 5
        elif buy_ratio >= 90 or buy_ratio <= 10:
            score += 3
        elif buy_ratio >= 85 or buy_ratio <= 15:
            score += 1

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
        win_rate = trader.get("win_rate", 50)
        transaction_count = trader.get("transaction_count", 100)

        return {
            "fresh_wallet": {
                "transaction_count": transaction_count,
                "max_points": 5,
                "suspicious": transaction_count <= 5,
                "description": f"{transaction_count} lifetime transactions"
            },
            "new_account_profit": {
                "age_days": age,
                "pnl": pnl,
                "max_points": 20,
                "suspicious": (age <= 30 and pnl >= 500) or (transaction_count <= 5 and pnl >= 100),
                "description": f"{age} day old account with ${pnl:.0f} profit"
            },
            "position_concentration": {
                "value": conc,
                "max_points": 20,
                "suspicious": conc >= 40,
                "description": f"{conc:.1f}% in largest position"
            },
            "entry_probability": {
                "value": entry,
                "max_points": 15,
                "suspicious": entry <= 25,
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
                "max_points": 10,
                "suspicious": max_pos >= 5000,
                "description": f"${max_pos:.0f} largest position"
            },
            "win_rate": {
                "value": win_rate,
                "max_points": 10,
                "suspicious": win_rate >= 75,
                "description": f"{win_rate:.0f}% win rate"
            }
        }

    @staticmethod
    def is_suspicious(trader: dict[str, Any], threshold: int = 55) -> bool:
        """Check if trader shows suspicious insider-like patterns."""
        score = InsiderScorer.calculate_score(trader)
        return score >= threshold

    @staticmethod
    def get_suspicion_level(score: int) -> str:
        """Get suspicion level based on score."""
        if score >= 85:
            return "critical"
        elif score >= 70:
            return "very_high"
        elif score >= 55:
            return "high"
        elif score >= 40:
            return "moderate"
        elif score >= 25:
            return "low"
        else:
            return "minimal"

    @staticmethod
    def get_red_flags(trader: dict[str, Any]) -> list[str]:
        """Get list of specific red flags for this trader."""
        flags = []

        transaction_count = trader.get("transaction_count", 100)
        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)

        # Fresh wallet flag
        if transaction_count <= 5:
            flags.append(f"Fresh wallet ({transaction_count} txns)")
            if pnl >= 1000:
                flags.append(f"${pnl:.0f} profit on fresh wallet")

        # Age-based flags
        if age <= 7:
            flags.append("Brand new account (< 1 week)")
        elif age <= 14:
            flags.append("Very new account (< 2 weeks)")

        if pnl >= 10000 and age <= 30:
            flags.append(f"Exceptional profit (${pnl:.0f}) on new account")
        elif pnl >= 5000 and age <= 30:
            flags.append(f"High profit (${pnl:.0f}) on new account")

        # Position concentration
        conc = trader.get("position_concentration", 0)
        if conc >= 90:
            flags.append(f"Extreme concentration ({conc:.0f}% single bet)")
        elif conc >= 70:
            flags.append(f"Very high concentration ({conc:.0f}% single bet)")
        elif conc >= 50:
            flags.append(f"High concentration ({conc:.0f}% in one position)")

        # Entry probability (underdog betting)
        entry = trader.get("avg_entry_probability", 50)
        if entry <= 15:
            flags.append(f"Extreme underdog bets (avg {entry:.0f}%)")
        elif entry <= 25:
            flags.append(f"Underdog betting (avg {entry:.0f}%)")

        # Market focus
        markets = trader.get("unique_markets_30d", 10)
        if markets == 1:
            flags.append("Single market focus")
        elif markets <= 2:
            flags.append(f"Very narrow focus ({markets} markets)")

        # Niche market focus
        niche_ratio = trader.get("niche_market_ratio", 0)
        if niche_ratio >= 80:
            flags.append("Primarily trades niche markets")

        # Position size
        max_pos = trader.get("max_position_size", 0)
        if max_pos >= 50000:
            flags.append(f"Massive position (${max_pos:,.0f})")
        elif max_pos >= 20000:
            flags.append(f"Very large position (${max_pos:,.0f})")
        elif max_pos >= 10000:
            flags.append(f"Large position (${max_pos:,.0f})")

        # Win rate anomaly
        win_rate = trader.get("win_rate", 50)
        total_trades = trader.get("total_trades", 0)
        if win_rate >= 90 and total_trades >= 5:
            flags.append(f"Exceptional win rate ({win_rate:.0f}%)")
        elif win_rate >= 80 and total_trades >= 5:
            flags.append(f"Very high win rate ({win_rate:.0f}%)")

        # One-sided trading
        buy_ratio = trader.get("buy_ratio", 50)
        if buy_ratio >= 95:
            flags.append("All BUY trades (one-sided)")
        elif buy_ratio <= 5:
            flags.append("All SELL trades (one-sided)")

        # Volume spike (position size ratio)
        avg_pos = trader.get("avg_position_size", 0)
        if max_pos > 0 and avg_pos > 0:
            ratio = max_pos / avg_pos
            if ratio >= 10:
                flags.append(f"Position {ratio:.0f}x larger than average")
            elif ratio >= 5:
                flags.append(f"Position {ratio:.0f}x typical size")

        return flags

    @staticmethod
    def get_confidence_level(trader: dict[str, Any]) -> str:
        """
        Get confidence level for insider classification.

        HIGH: 3+ signals activated
        MEDIUM: 2 signals activated
        LOW: 1 signal activated
        """
        signals = 0

        transaction_count = trader.get("transaction_count", 100)
        age = trader.get("account_age_days", 365)
        pnl = trader.get("total_pnl", 0)
        conc = trader.get("position_concentration", 0)
        entry = trader.get("avg_entry_probability", 50)
        markets = trader.get("unique_markets_30d", 10)
        max_pos = trader.get("max_position_size", 0)
        win_rate = trader.get("win_rate", 50)

        # Fresh wallet with profit
        if transaction_count <= 5 and pnl >= 100:
            signals += 1

        # New account with significant profit
        if age <= 30 and pnl >= 2000:
            signals += 1

        # High position concentration
        if conc >= 60:
            signals += 1

        # Low entry probability
        if entry <= 25:
            signals += 1

        # Narrow market focus
        if markets <= 3:
            signals += 1

        # Large position size
        if max_pos >= 10000:
            signals += 1

        # High win rate
        if win_rate >= 75:
            signals += 1

        if signals >= 3:
            return "HIGH"
        elif signals >= 2:
            return "MEDIUM"
        elif signals >= 1:
            return "LOW"
        else:
            return "NONE"
