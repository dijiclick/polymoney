"""Balance updater - fetches and updates wallet balances from Polymarket API."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Callable

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client

logger = logging.getLogger(__name__)


class BalanceUpdater:
    """
    Updates wallet balances from Polymarket Data API.

    Fetches portfolio value for each wallet and updates the database.
    Used to filter wallets for deeper analysis (balance >= $200).
    """

    def __init__(self):
        self.db = get_supabase_client()
        self.api = PolymarketDataAPI()

    async def update_all_balances(
        self,
        concurrency: int = 10,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """
        Update balances for all wallets.

        Args:
            concurrency: Number of concurrent API requests
            progress_callback: Optional callback(processed, total)

        Returns:
            Summary dict with counts
        """
        wallets = self.db.get_all_wallets()
        total = len(wallets)

        logger.info(f"Updating balances for {total} wallets")

        return await self._update_balances(
            wallets=wallets,
            concurrency=concurrency,
            progress_callback=progress_callback
        )

    async def update_balances_by_source(
        self,
        source: str,
        concurrency: int = 10,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """Update balances for wallets from a specific source."""
        wallets = self.db.get_wallets_by_source(source)
        total = len(wallets)

        logger.info(f"Updating balances for {total} {source} wallets")

        return await self._update_balances(
            wallets=wallets,
            concurrency=concurrency,
            progress_callback=progress_callback
        )

    async def update_stale_balances(
        self,
        hours: int = 24,
        concurrency: int = 10,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """Update balances for wallets not updated in the last N hours."""
        wallets = self.db.get_stale_wallets(hours=hours)
        total = len(wallets)

        logger.info(f"Updating {total} stale wallets (>{hours}h old)")

        return await self._update_balances(
            wallets=wallets,
            concurrency=concurrency,
            progress_callback=progress_callback
        )

    async def _update_balances(
        self,
        wallets: list[dict],
        concurrency: int = 10,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """
        Internal method to update balances for a list of wallets.
        """
        total = len(wallets)
        processed = 0
        updated = 0
        failed = 0
        qualified = 0  # Balance >= $200

        semaphore = asyncio.Semaphore(concurrency)

        async def update_one(wallet: dict):
            nonlocal processed, updated, failed, qualified

            address = wallet["address"]

            async with semaphore:
                try:
                    async with self.api:
                        balance = await self.api.get_portfolio_value(address)

                    self.db.update_wallet(address, {
                        "balance": balance,
                        "balance_updated_at": datetime.utcnow().isoformat(),
                        "updated_at": datetime.utcnow().isoformat()
                    })

                    updated += 1
                    if balance >= 200:
                        qualified += 1

                except Exception as e:
                    logger.error(f"Error updating balance for {address}: {e}")
                    failed += 1

                processed += 1

                if progress_callback and processed % 10 == 0:
                    progress_callback(processed, total)

        # Process in batches to avoid overwhelming the API
        batch_size = 50
        for i in range(0, len(wallets), batch_size):
            batch = wallets[i:i + batch_size]
            tasks = [update_one(w) for w in batch]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Small delay between batches
            await asyncio.sleep(1)

        summary = {
            "total": total,
            "updated": updated,
            "failed": failed,
            "qualified_200": qualified
        }

        logger.info(f"Balance update complete: {summary}")
        return summary

    async def get_qualified_wallets(self, min_balance: float = 200) -> list[dict]:
        """Get wallets with balance >= min_balance."""
        return self.db.get_qualified_wallets(min_balance=min_balance)

    async def get_balance_stats(self) -> dict:
        """Get statistics about wallet balances."""
        wallets = self.db.get_all_wallets()

        if not wallets:
            return {
                "total_wallets": 0,
                "with_balance": 0,
                "qualified_200": 0,
                "total_value": 0,
                "avg_balance": 0,
                "max_balance": 0
            }

        balances = [w.get("balance", 0) or 0 for w in wallets]
        non_zero = [b for b in balances if b > 0]
        qualified = [b for b in balances if b >= 200]

        return {
            "total_wallets": len(wallets),
            "with_balance": len(non_zero),
            "qualified_200": len(qualified),
            "total_value": sum(balances),
            "avg_balance": sum(balances) / len(balances) if balances else 0,
            "max_balance": max(balances) if balances else 0
        }
