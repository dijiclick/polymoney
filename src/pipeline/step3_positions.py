"""Step 3: Analyze positions."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig
from ..utils.helpers import chunks

logger = logging.getLogger(__name__)


class Step3Positions:
    """Step 3: Analyze current positions."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.min_position_size = self.filters.pipeline.step3_positions.min_position_size
        self.require_positions = self.filters.pipeline.step3_positions.require_positions
        self.db = get_supabase_client()

    async def run(
        self,
        batch_size: int = 50,
        concurrency: int = 10,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run Step 3: Analyze positions for all Step 2 qualified traders.
        """
        logger.info(f"Starting Step 3: Position analysis (min ${self.min_position_size})")

        # Get all traders at step 3
        traders = []
        offset = 0
        limit = 1000

        while True:
            batch = self.db.get_traders_by_step(step=3, limit=limit, offset=offset)
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
                            step=4,
                            data={
                                "total_positions": data["total_positions"],
                                "active_positions": data["active_positions"],
                                "avg_position_size": data["avg_position_size"],
                                "max_position_size": data["max_position_size"],
                                "position_concentration": data["position_concentration"],
                                "last_updated_at": datetime.now().isoformat()
                            }
                        )
                        qualified_count += 1
                    else:
                        self.db.eliminate_trader(addr, step=3, reason=reason)
                        eliminated_count += 1

                processed += len(batch)
                if progress_callback:
                    progress_callback(processed, len(traders), qualified_count, eliminated_count)

                logger.debug(f"Processed {processed}/{len(traders)}")

        logger.info(f"Step 3 complete: {qualified_count} qualified, {eliminated_count} eliminated")

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
        """Process a batch of traders and get their position data."""
        results = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def fetch_one(trader: dict):
            async with semaphore:
                addr = trader["address"]
                positions = await api.get_positions(addr)
                parsed = api.parse_positions(positions)
                results[addr] = {**parsed, "positions": positions}

        tasks = [fetch_one(t) for t in traders]
        await asyncio.gather(*tasks, return_exceptions=True)
        return results

    def _evaluate(self, data: dict) -> tuple[bool, str]:
        """Evaluate if trader passes Step 3 filters."""
        max_size = data.get("max_position_size", 0)
        total_positions = data.get("total_positions", 0)

        if max_size < self.min_position_size:
            if self.require_positions or total_positions == 0:
                return False, f"Max position ${max_size:.2f} < ${self.min_position_size}"

        # If they have no positions but require_positions is False,
        # they pass (might have closed positions)
        if total_positions == 0 and not self.require_positions:
            return True, ""

        return True, ""

    async def run_single(self, address: str) -> dict:
        """Analyze positions for a single address."""
        async with PolymarketDataAPI() as api:
            positions = await api.get_positions(address)
            parsed = api.parse_positions(positions)

        passed, reason = self._evaluate(parsed)

        if passed:
            self.db.update_trader_step(
                address,
                step=4,
                data={
                    "total_positions": parsed["total_positions"],
                    "active_positions": parsed["active_positions"],
                    "avg_position_size": parsed["avg_position_size"],
                    "max_position_size": parsed["max_position_size"],
                    "position_concentration": parsed["position_concentration"]
                }
            )
        else:
            self.db.eliminate_trader(address, step=3, reason=reason)

        return {
            "address": address,
            "positions": parsed,
            "qualified": passed,
            "reason": reason
        }
