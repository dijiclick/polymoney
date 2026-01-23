"""Step 6: Classify traders based on scores."""

import logging
from datetime import datetime
from typing import Optional

from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig
from ..scoring.classifier import TraderClassifier
from ..utils.helpers import chunks

logger = logging.getLogger(__name__)


class Step6Classify:
    """Step 6: Calculate scores and classify traders."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.db = get_supabase_client()
        self.classifier = TraderClassifier(min_score=60)

    def run(self, progress_callback: Optional[callable] = None) -> dict:
        """
        Run Step 6: Classify all Step 5 analyzed traders.
        """
        logger.info("Starting Step 6: Classification")

        # Get all traders at step 6
        traders = []
        offset = 0
        limit = 1000

        while True:
            batch = self.db.get_traders_by_step(step=6, limit=limit, offset=offset)
            if not batch:
                break
            traders.extend(batch)
            offset += limit

        logger.info(f"Found {len(traders)} traders to classify")

        if not traders:
            return self._empty_stats()

        copytrade_count = 0
        bot_count = 0
        insider_count = 0
        processed = 0

        for batch in chunks(traders, 100):
            for trader in batch:
                classification = self.classifier.get_detailed_analysis(trader)

                # Update trader with scores and insider details
                self.db.upsert_trader({
                    "address": trader["address"],
                    "copytrade_score": classification["copytrade_score"],
                    "bot_score": classification["bot_score"],
                    "insider_score": classification["insider_score"],
                    "insider_level": classification.get("insider_level"),
                    "insider_red_flags": classification.get("insider_red_flags", []),
                    "primary_classification": classification["primary_classification"],
                    "last_updated_at": datetime.now().isoformat()
                })

                # Count classifications
                if "copytrade" in classification["classifications"]:
                    copytrade_count += 1
                if "bot" in classification["classifications"]:
                    bot_count += 1
                if "insider" in classification["classifications"]:
                    insider_count += 1

            processed += len(batch)
            if progress_callback:
                # Step 6 classifies all traders, so no eliminations
                progress_callback(processed, len(traders), processed, 0)

            logger.debug(f"Classified {processed}/{len(traders)}")

        logger.info(f"Step 6 complete: {copytrade_count} copytrade, {bot_count} bots, {insider_count} insiders")

        return {
            "classified": processed,
            "copytrade_candidates": copytrade_count,
            "likely_bots": bot_count,
            "insider_suspects": insider_count
        }

    def run_single(self, address: str) -> dict:
        """Classify a single trader."""
        trader = self.db.get_trader(address)
        if not trader:
            return {"error": "Trader not found"}

        classification = self.classifier.get_detailed_analysis(trader)

        self.db.upsert_trader({
            "address": address,
            "copytrade_score": classification["copytrade_score"],
            "bot_score": classification["bot_score"],
            "insider_score": classification["insider_score"],
            "primary_classification": classification["primary_classification"],
            "last_updated_at": datetime.now().isoformat()
        })

        return {
            "address": address,
            **classification
        }

    def reclassify_all(self, progress_callback: Optional[callable] = None) -> dict:
        """Reclassify all qualified traders (useful after filter changes)."""
        logger.info("Reclassifying all qualified traders")

        traders = self.db.get_qualified_traders(limit=100000)
        logger.info(f"Found {len(traders)} qualified traders")

        if not traders:
            return self._empty_stats()

        copytrade_count = 0
        bot_count = 0
        insider_count = 0
        processed = 0

        for batch in chunks(traders, 100):
            for trader in batch:
                classification = self.classifier.get_detailed_analysis(trader)

                self.db.upsert_trader({
                    "address": trader["address"],
                    "copytrade_score": classification["copytrade_score"],
                    "bot_score": classification["bot_score"],
                    "insider_score": classification["insider_score"],
                    "insider_level": classification.get("insider_level"),
                    "insider_red_flags": classification.get("insider_red_flags", []),
                    "primary_classification": classification["primary_classification"]
                })

                if "copytrade" in classification["classifications"]:
                    copytrade_count += 1
                if "bot" in classification["classifications"]:
                    bot_count += 1
                if "insider" in classification["classifications"]:
                    insider_count += 1

            processed += len(batch)
            if progress_callback:
                progress_callback(processed, len(traders), processed, 0)

        logger.info(f"Reclassification complete")

        return {
            "reclassified": processed,
            "copytrade_candidates": copytrade_count,
            "likely_bots": bot_count,
            "insider_suspects": insider_count
        }

    def _empty_stats(self) -> dict:
        return {
            "classified": 0,
            "copytrade_candidates": 0,
            "likely_bots": 0,
            "insider_suspects": 0
        }
