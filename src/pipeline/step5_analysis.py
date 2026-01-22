"""Step 5: Deep analysis for bot and insider detection."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig
from ..metrics.calculations import MetricsCalculator
from ..metrics.bot_detection import BotDetector
from ..metrics.insider_detection import InsiderDetector
from ..utils.helpers import chunks

logger = logging.getLogger(__name__)


class Step5Analysis:
    """Step 5: Deep analysis for advanced metrics."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.db = get_supabase_client()
        self.calc = MetricsCalculator()
        self.bot_detector = BotDetector()
        self.insider_detector = InsiderDetector()

    async def run(
        self,
        batch_size: int = 30,
        concurrency: int = 5,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run Step 5: Deep analysis for all Step 4 qualified traders.

        This step does not eliminate traders - it calculates advanced metrics.
        """
        logger.info("Starting Step 5: Deep analysis")

        # Get all traders at step 5
        traders = []
        offset = 0
        limit = 1000

        while True:
            batch = self.db.get_traders_by_step(step=5, limit=limit, offset=offset)
            if not batch:
                break
            traders.extend(batch)
            offset += limit

        logger.info(f"Found {len(traders)} traders to analyze")

        if not traders:
            return {"analyzed": 0}

        processed = 0

        async with PolymarketDataAPI() as api:
            for batch in chunks(traders, batch_size):
                results = await self._process_batch(api, batch, concurrency)

                for addr, data in results.items():
                    self.db.update_trader_step(
                        addr,
                        step=6,
                        data={
                            "max_drawdown": data.get("max_drawdown", 0),
                            "trade_frequency": data.get("trade_frequency", 0),
                            "unique_markets_30d": data.get("unique_markets", 0),
                            "trade_time_variance_hours": data.get("trade_time_variance_hours"),
                            "night_trade_ratio": data.get("night_trade_ratio", 0),
                            "position_size_variance": data.get("position_size_variance"),
                            "avg_hold_duration_hours": data.get("avg_hold_duration_hours"),
                            "avg_entry_probability": data.get("avg_entry_probability"),
                            "pnl_concentration": data.get("pnl_concentration"),
                            "category_concentration": data.get("category_concentration"),
                            "last_updated_at": datetime.now().isoformat()
                        }
                    )

                processed += len(batch)
                if progress_callback:
                    # Step 5 doesn't eliminate traders, so eliminated count is 0
                    progress_callback(processed, len(traders), processed, 0)

                logger.debug(f"Processed {processed}/{len(traders)}")

        logger.info(f"Step 5 complete: {processed} traders analyzed")

        return {"analyzed": processed}

    async def _process_batch(
        self,
        api: PolymarketDataAPI,
        traders: list[dict],
        concurrency: int
    ) -> dict[str, dict]:
        """Process a batch of traders for deep analysis."""
        results = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def fetch_one(trader: dict):
            async with semaphore:
                addr = trader["address"]

                # Fetch all data
                positions = await api.get_positions(addr)
                closed = await api.get_closed_positions(addr)
                activity = await api.get_activity(addr)

                # Calculate metrics
                max_drawdown = self.calc.calculate_max_drawdown(activity)
                trade_frequency = self.calc.calculate_trade_frequency(activity)
                unique_markets = self.calc.calculate_unique_markets(positions, closed)
                hold_duration = self.calc.calculate_hold_duration(activity)

                # Bot detection metrics
                bot_indicators = self.bot_detector.calculate_indicators(activity)

                # Insider detection metrics
                insider_indicators = self.insider_detector.calculate_indicators(
                    positions, closed, activity
                )

                results[addr] = {
                    "max_drawdown": max_drawdown,
                    "trade_frequency": trade_frequency,
                    "unique_markets": unique_markets,
                    "avg_hold_duration_hours": hold_duration,
                    **bot_indicators,
                    **insider_indicators
                }

        tasks = [fetch_one(t) for t in traders]
        await asyncio.gather(*tasks, return_exceptions=True)
        return results

    async def run_single(self, address: str) -> dict:
        """Run deep analysis for a single address."""
        async with PolymarketDataAPI() as api:
            positions = await api.get_positions(address)
            closed = await api.get_closed_positions(address)
            activity = await api.get_activity(address)

        # Calculate all metrics
        max_drawdown = self.calc.calculate_max_drawdown(activity)
        trade_frequency = self.calc.calculate_trade_frequency(activity)
        unique_markets = self.calc.calculate_unique_markets(positions, closed)
        hold_duration = self.calc.calculate_hold_duration(activity)

        bot_indicators = self.bot_detector.calculate_indicators(activity)
        insider_indicators = self.insider_detector.calculate_indicators(
            positions, closed, activity
        )

        data = {
            "max_drawdown": max_drawdown,
            "trade_frequency": trade_frequency,
            "unique_markets": unique_markets,
            "avg_hold_duration_hours": hold_duration,
            **bot_indicators,
            **insider_indicators
        }

        self.db.update_trader_step(
            address,
            step=6,
            data={
                "max_drawdown": data.get("max_drawdown", 0),
                "trade_frequency": data.get("trade_frequency", 0),
                "unique_markets_30d": data.get("unique_markets", 0),
                "trade_time_variance_hours": data.get("trade_time_variance_hours"),
                "night_trade_ratio": data.get("night_trade_ratio", 0),
                "position_size_variance": data.get("position_size_variance"),
                "avg_hold_duration_hours": data.get("avg_hold_duration_hours"),
                "avg_entry_probability": data.get("avg_entry_probability"),
                "pnl_concentration": data.get("pnl_concentration"),
                "category_concentration": data.get("category_concentration")
            }
        )

        return {
            "address": address,
            "metrics": data
        }
