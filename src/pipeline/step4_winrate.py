"""Step 4: Calculate win rate and performance metrics."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig
from ..metrics.calculations import MetricsCalculator
from ..utils.helpers import chunks

logger = logging.getLogger(__name__)


class Step4WinRate:
    """Step 4: Calculate win rate and ROI."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.min_win_rate = self.filters.pipeline.step4_performance.min_win_rate
        self.min_pnl = self.filters.pipeline.step4_performance.min_total_pnl
        self.require_one = self.filters.pipeline.step4_performance.require_one
        self.db = get_supabase_client()
        self.calc = MetricsCalculator()

    async def run(
        self,
        batch_size: int = 50,
        concurrency: int = 10,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run Step 4: Calculate win rate for all Step 3 qualified traders.
        """
        logger.info(f"Starting Step 4: Win rate calculation")
        logger.info(f"Filters: min_win_rate={self.min_win_rate}%, min_pnl=${self.min_pnl}, require_one={self.require_one}")

        # Get all traders at step 4
        traders = []
        offset = 0
        limit = 1000

        while True:
            batch = self.db.get_traders_by_step(step=4, limit=limit, offset=offset)
            if not batch:
                break
            traders.extend(batch)
            offset += limit

        logger.info(f"Found {len(traders)} traders to analyze")

        if not traders:
            return {"analyzed": 0, "qualified": 0, "eliminated": 0}

        qualified_count = 0
        eliminated_count = 0
        processed = 0

        async with PolymarketDataAPI() as api:
            for batch in chunks(traders, batch_size):
                results = await self._process_batch(api, batch, concurrency)

                for addr, data in results.items():
                    passed, reason = self._evaluate(data)

                    if passed:
                        self.db.update_trader_step(
                            addr,
                            step=5,
                            data={
                                "closed_positions_30d": data["closed_positions_30d"],
                                "winning_positions_30d": data["winning_positions_30d"],
                                "win_rate_30d": data["win_rate_30d"],
                                "closed_positions_alltime": data["closed_positions_alltime"],
                                "winning_positions_alltime": data["winning_positions_alltime"],
                                "win_rate_alltime": data["win_rate_alltime"],
                                "realized_pnl": data["realized_pnl"],
                                "roi_percent": data.get("roi_percent", 0),
                                "total_pnl": data.get("total_pnl", 0),
                                "last_updated_at": datetime.now().isoformat()
                            }
                        )
                        qualified_count += 1
                    else:
                        self.db.eliminate_trader(addr, step=4, reason=reason)
                        eliminated_count += 1

                processed += len(batch)
                if progress_callback:
                    progress_callback(processed, len(traders), qualified_count, eliminated_count)

                logger.debug(f"Processed {processed}/{len(traders)}")

        logger.info(f"Step 4 complete: {qualified_count} qualified, {eliminated_count} eliminated")

        return {
            "analyzed": processed,
            "qualified": qualified_count,
            "eliminated": eliminated_count
        }

    async def _process_batch(
        self,
        api: PolymarketDataAPI,
        traders: list[dict],
        concurrency: int
    ) -> dict[str, dict]:
        """Process a batch of traders and calculate their performance."""
        results = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def fetch_one(trader: dict):
            async with semaphore:
                addr = trader["address"]
                positions = await api.get_positions(addr)
                closed = await api.get_closed_positions(addr)

                # Parse and calculate
                win_rate_data = api.parse_closed_positions(closed, days=30)
                roi_data = self.calc.calculate_roi(positions, closed)
                pnl_data = self.calc.calculate_total_pnl(positions, closed)

                results[addr] = {
                    **win_rate_data,
                    **roi_data,
                    **pnl_data,
                    "positions": positions,
                    "closed_positions": closed
                }

        tasks = [fetch_one(t) for t in traders]
        await asyncio.gather(*tasks, return_exceptions=True)
        return results

    def _evaluate(self, data: dict) -> tuple[bool, str]:
        """Evaluate if trader passes Step 4 filters."""
        win_rate = data.get("win_rate_30d", 0)
        total_pnl = data.get("total_pnl", 0)

        if self.require_one:
            # Pass if EITHER condition is met
            if win_rate >= self.min_win_rate or total_pnl >= self.min_pnl:
                return True, ""
            return False, f"Win rate {win_rate:.1f}% < {self.min_win_rate}% AND PnL ${total_pnl:.2f} < ${self.min_pnl}"
        else:
            # Pass only if BOTH conditions are met
            if win_rate < self.min_win_rate:
                return False, f"Win rate {win_rate:.1f}% < {self.min_win_rate}%"
            if total_pnl < self.min_pnl:
                return False, f"PnL ${total_pnl:.2f} < ${self.min_pnl}"
            return True, ""

    async def run_single(self, address: str) -> dict:
        """Calculate performance for a single address."""
        async with PolymarketDataAPI() as api:
            positions = await api.get_positions(address)
            closed = await api.get_closed_positions(address)

        win_rate_data = api.parse_closed_positions(closed, days=30)
        roi_data = self.calc.calculate_roi(positions, closed)
        pnl_data = self.calc.calculate_total_pnl(positions, closed)

        data = {**win_rate_data, **roi_data, **pnl_data}
        passed, reason = self._evaluate(data)

        if passed:
            self.db.update_trader_step(
                address,
                step=5,
                data={
                    "closed_positions_30d": data["closed_positions_30d"],
                    "winning_positions_30d": data["winning_positions_30d"],
                    "win_rate_30d": data["win_rate_30d"],
                    "closed_positions_alltime": data["closed_positions_alltime"],
                    "winning_positions_alltime": data["winning_positions_alltime"],
                    "win_rate_alltime": data["win_rate_alltime"],
                    "realized_pnl": data["realized_pnl"],
                    "roi_percent": data.get("roi_percent", 0),
                    "total_pnl": data.get("total_pnl", 0)
                }
            )
        else:
            self.db.eliminate_trader(address, step=4, reason=reason)

        return {
            "address": address,
            "performance": data,
            "qualified": passed,
            "reason": reason
        }
