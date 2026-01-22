"""Step 2: Check portfolio balance."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig
from ..utils.helpers import chunks

logger = logging.getLogger(__name__)


class Step2Balance:
    """Step 2: Check portfolio balance and filter by minimum value."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.min_balance = self.filters.pipeline.step2_balance.min_portfolio_value
        self.db = get_supabase_client()

    async def run(
        self,
        batch_size: int = 100,
        concurrency: int = 10,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run Step 2: Check balances for all Step 1 qualified traders.

        Returns statistics dict.
        """
        logger.info(f"Starting Step 2: Balance check (min ${self.min_balance})")

        # Get all traders at step 2 (passed step 1)
        traders = []
        offset = 0
        limit = 1000

        while True:
            batch = self.db.get_traders_by_step(step=2, limit=limit, offset=offset)
            if not batch:
                break
            traders.extend(batch)
            offset += limit

        logger.info(f"Found {len(traders)} traders to check")

        if not traders:
            return {"checked": 0, "qualified": 0, "eliminated": 0}

        # Process in batches
        qualified_count = 0
        eliminated_count = 0
        processed = 0

        async with PolymarketDataAPI() as api:
            for batch in chunks(traders, batch_size):
                results = await self._process_batch(api, batch, concurrency)

                for addr, balance in results.items():
                    if balance >= self.min_balance:
                        self.db.update_trader_step(
                            addr,
                            step=3,
                            data={
                                "portfolio_value": balance,
                                "last_updated_at": datetime.now().isoformat()
                            }
                        )
                        qualified_count += 1
                    else:
                        self.db.eliminate_trader(
                            addr,
                            step=2,
                            reason=f"Balance ${balance:.2f} < ${self.min_balance}"
                        )
                        eliminated_count += 1

                processed += len(batch)
                if progress_callback:
                    progress_callback(processed, len(traders), qualified_count, eliminated_count)

                logger.debug(f"Processed {processed}/{len(traders)}")

        logger.info(f"Step 2 complete: {qualified_count} qualified, {eliminated_count} eliminated")

        return {
            "checked": processed,
            "qualified": qualified_count,
            "eliminated": eliminated_count,
            "min_balance": self.min_balance
        }

    async def _process_batch(
        self,
        api: PolymarketDataAPI,
        traders: list[dict],
        concurrency: int
    ) -> dict[str, float]:
        """Process a batch of traders and get their balances."""
        addresses = [t["address"] for t in traders]
        return await api.get_multiple_portfolio_values(addresses, concurrency)

    async def run_single(self, address: str) -> dict:
        """Check balance for a single address."""
        async with PolymarketDataAPI() as api:
            balance = await api.get_portfolio_value(address)

        qualified = balance >= self.min_balance

        if qualified:
            self.db.update_trader_step(
                address,
                step=3,
                data={"portfolio_value": balance}
            )
        else:
            self.db.eliminate_trader(
                address,
                step=2,
                reason=f"Balance ${balance:.2f} < ${self.min_balance}"
            )

        return {
            "address": address,
            "balance": balance,
            "qualified": qualified
        }
