"""Trader classification based on scores."""

from typing import Any, Optional

from .bot import BotScorer
from .insider import InsiderScorer


class TraderClassifier:
    """Classify traders into categories based on their scores."""

    def __init__(self, min_score: int = 60):
        self.min_score = min_score

    def classify(self, trader: dict[str, Any]) -> dict[str, Any]:
        """
        Classify a trader and return scores and classification.

        Returns dict with:
        - bot_score
        - insider_score
        - primary_classification
        - classifications (list of all matching)
        """
        bot_score = BotScorer.calculate_score(trader)
        insider_score = InsiderScorer.calculate_score(trader)

        # Determine classifications
        classifications = []
        if bot_score >= self.min_score:
            classifications.append("bot")
        if insider_score >= self.min_score:
            classifications.append("insider")

        # Primary classification is the highest score
        scores = {
            "bot": bot_score,
            "insider": insider_score
        }

        if classifications:
            primary = max(classifications, key=lambda x: scores[x])
        else:
            primary = "none"

        return {
            "bot_score": bot_score,
            "insider_score": insider_score,
            "primary_classification": primary,
            "classifications": classifications,
            "scores": scores
        }

    def get_detailed_analysis(self, trader: dict[str, Any]) -> dict[str, Any]:
        """Get detailed analysis of a trader."""
        classification = self.classify(trader)

        return {
            **classification,
            "bot_breakdown": BotScorer.get_score_breakdown(trader),
            "insider_breakdown": InsiderScorer.get_score_breakdown(trader),
            "bot_confidence": BotScorer.get_confidence(classification["bot_score"]),
            "insider_level": InsiderScorer.get_suspicion_level(classification["insider_score"]),
            "insider_red_flags": InsiderScorer.get_red_flags(trader),
            "bot_type": BotScorer.get_bot_type(trader) if classification["bot_score"] >= self.min_score else None
        }

    def filter_by_classification(
        self,
        traders: list[dict[str, Any]],
        classification: str
    ) -> list[dict[str, Any]]:
        """Filter traders by a specific classification."""
        results = []
        for trader in traders:
            result = self.classify(trader)
            if classification in result["classifications"]:
                results.append({**trader, **result})
        return sorted(results, key=lambda x: x["scores"][classification], reverse=True)

    def rank_traders(
        self,
        traders: list[dict[str, Any]],
        by: str = "bot"
    ) -> list[dict[str, Any]]:
        """Rank traders by a specific score."""
        scored_traders = []
        for trader in traders:
            result = self.classify(trader)
            scored_traders.append({**trader, **result})

        score_key = f"{by}_score"
        return sorted(scored_traders, key=lambda x: x.get(score_key, 0), reverse=True)

    @staticmethod
    def summarize_classifications(classified_traders: list[dict[str, Any]]) -> dict[str, Any]:
        """Summarize classification results."""
        bot_count = sum(1 for t in classified_traders if "bot" in t.get("classifications", []))
        insider_count = sum(1 for t in classified_traders if "insider" in t.get("classifications", []))
        none_count = sum(1 for t in classified_traders if t.get("primary_classification") == "none")

        avg_bot = sum(t.get("bot_score", 0) for t in classified_traders) / len(classified_traders) if classified_traders else 0
        avg_insider = sum(t.get("insider_score", 0) for t in classified_traders) / len(classified_traders) if classified_traders else 0

        return {
            "total_traders": len(classified_traders),
            "likely_bots": bot_count,
            "insider_suspects": insider_count,
            "unclassified": none_count,
            "avg_bot_score": avg_bot,
            "avg_insider_score": avg_insider
        }
