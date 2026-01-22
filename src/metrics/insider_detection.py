"""Insider trading detection metrics."""

import statistics
from datetime import datetime
from typing import Optional


class InsiderDetector:
    """Detect potential insider trading patterns."""

    @staticmethod
    def calculate_indicators(
        positions: list[dict],
        closed_positions: list[dict],
        activity: list[dict]
    ) -> dict:
        """
        Calculate metrics that indicate potential insider trading.

        Returns dict with:
        - avg_entry_probability: avg market % when they bought
        - position_concentration: % in largest position
        - pnl_concentration: % of pnl from top 3 bets
        - unique_markets: number of unique markets
        - category_concentration: most traded category
        """
        all_positions = positions + closed_positions

        # 1. Average Entry Probability (insiders buy underdogs)
        entry_prices = []
        for p in all_positions:
            avg_price = p.get("avgPrice")
            if avg_price is not None:
                try:
                    entry_prices.append(float(avg_price))
                except (ValueError, TypeError):
                    pass

        avg_entry_prob = (statistics.mean(entry_prices) * 100) if entry_prices else 50

        # 2. Position Concentration (insiders focus on few bets)
        values = []
        for p in all_positions:
            initial = p.get("initialValue") or (
                (p.get("totalBought") or 0) * (p.get("avgPrice") or 0)
            )
            try:
                values.append(float(initial))
            except (ValueError, TypeError):
                pass

        total_value = sum(values) if values else 0
        max_position = max(values) if values else 0
        position_concentration = (max_position / total_value * 100) if total_value > 0 else 0

        # 3. PnL Concentration (big wins from few bets)
        pnls = []
        for p in closed_positions:
            pnl = p.get("realizedPnl")
            if pnl is not None:
                try:
                    pnls.append(float(pnl))
                except (ValueError, TypeError):
                    pass

        pnls.sort(reverse=True)
        total_positive_pnl = sum(p for p in pnls if p > 0)
        top3_pnl = sum(pnls[:3]) if len(pnls) >= 3 else sum(pnls)
        pnl_concentration = (top3_pnl / total_positive_pnl * 100) if total_positive_pnl > 0 else 0

        # 4. Unique Markets
        market_slugs = set()
        for p in all_positions:
            if slug := p.get("slug"):
                market_slugs.add(slug)
        unique_markets = len(market_slugs)

        # 5. Category Concentration
        categories: dict[str, int] = {}
        for p in all_positions:
            cat = p.get("category") or "unknown"
            categories[cat] = categories.get(cat, 0) + 1

        category_concentration = max(categories, key=categories.get) if categories else None

        return {
            "avg_entry_probability": avg_entry_prob,
            "position_concentration": position_concentration,
            "pnl_concentration": pnl_concentration,
            "unique_markets": unique_markets,
            "category_concentration": category_concentration
        }

    @staticmethod
    def detect_large_single_bets(
        positions: list[dict],
        threshold: float = 5000
    ) -> list[dict]:
        """
        Find positions with value above threshold.

        Large single bets can indicate informed trading.
        """
        large_positions = []
        for p in positions:
            value = float(p.get("currentValue", 0))
            if value >= threshold:
                large_positions.append(p)
        return large_positions

    @staticmethod
    def detect_underdog_betting(
        positions: list[dict],
        closed_positions: list[dict],
        threshold: float = 0.30
    ) -> dict:
        """
        Analyze betting on low-probability outcomes.

        Consistent winning bets on underdogs can indicate insider info.
        """
        all_positions = positions + closed_positions
        underdog_bets = []
        underdog_wins = 0

        for p in all_positions:
            avg_price = p.get("avgPrice")
            if avg_price is None:
                continue

            try:
                price = float(avg_price)
            except (ValueError, TypeError):
                continue

            if price <= threshold:  # Bet on <30% outcome
                underdog_bets.append(p)
                pnl = p.get("realizedPnl")
                if pnl and float(pnl) > 0:
                    underdog_wins += 1

        if not underdog_bets:
            return {
                "underdog_bet_count": 0,
                "underdog_win_rate": 0,
                "underdog_win_count": 0
            }

        return {
            "underdog_bet_count": len(underdog_bets),
            "underdog_win_rate": (underdog_wins / len(underdog_bets)) * 100,
            "underdog_win_count": underdog_wins
        }

    @staticmethod
    def detect_obscure_market_focus(
        positions: list[dict],
        closed_positions: list[dict]
    ) -> dict:
        """
        Check if trader focuses on obscure/niche markets.

        Categories like "MENTIONS" or very specific events can indicate insider info.
        """
        obscure_keywords = [
            "mention", "tweet", "says", "will say",
            "specific", "exact", "particular"
        ]

        all_positions = positions + closed_positions
        obscure_count = 0

        for p in all_positions:
            title = (p.get("title") or "").lower()
            category = (p.get("category") or "").lower()

            for keyword in obscure_keywords:
                if keyword in title or keyword in category:
                    obscure_count += 1
                    break

        return {
            "obscure_market_count": obscure_count,
            "obscure_ratio": (obscure_count / len(all_positions) * 100) if all_positions else 0
        }

    @staticmethod
    def calculate_suspicion_score(
        positions: list[dict],
        closed_positions: list[dict],
        activity: list[dict],
        account_age_days: int,
        total_pnl: float
    ) -> float:
        """
        Calculate overall insider suspicion score.

        Higher score = more suspicious activity.
        """
        indicators = InsiderDetector.calculate_indicators(
            positions, closed_positions, activity
        )

        score = 0

        # New account + profitable = suspicious
        if account_age_days <= 14 and total_pnl >= 5000:
            score += 30
        elif account_age_days <= 30 and total_pnl >= 2000:
            score += 20
        elif account_age_days <= 30 and total_pnl >= 500:
            score += 10

        # High position concentration
        conc = indicators.get("position_concentration", 0)
        if conc >= 80:
            score += 25
        elif conc >= 60:
            score += 15
        elif conc >= 50:
            score += 10

        # Low entry probability (betting underdogs)
        entry = indicators.get("avg_entry_probability", 50)
        if entry <= 15:
            score += 20
        elif entry <= 25:
            score += 15
        elif entry <= 30:
            score += 10

        # Few unique markets
        markets = indicators.get("unique_markets", 10)
        if markets == 1:
            score += 15
        elif markets == 2:
            score += 10
        elif markets <= 3:
            score += 5

        # High PnL concentration
        pnl_conc = indicators.get("pnl_concentration", 0)
        if pnl_conc >= 90:
            score += 10
        elif pnl_conc >= 80:
            score += 5

        return min(100, score)
