"""Goldsky wallet collector - extracts wallet addresses from blockchain transactions."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Callable

from ..scrapers.goldsky import GoldskyScraper
from ..database.supabase import get_supabase_client

logger = logging.getLogger(__name__)


class GoldskyWalletCollector:
    """
    Collects wallet addresses from Goldsky blockchain data.

    Extracts unique addresses from on-chain trade events and stores them
    in the wallets table with source='goldsky'.
    """

    def __init__(self):
        self.db = get_supabase_client()
        self.scraper = GoldskyScraper()

    async def collect(
        self,
        days: int = 30,
        progress_callback: Optional[Callable[[int, int, int], None]] = None
    ) -> dict:
        """
        Collect wallet addresses from Goldsky transactions.

        Args:
            days: Number of days to scan
            progress_callback: Optional callback(processed, total, new_wallets)

        Returns:
            Summary dict with counts
        """
        logger.info(f"Starting Goldsky wallet collection for {days} days")

        new_wallets = 0
        updated_wallets = 0
        total_addresses = 0

        async with self.scraper:
            addresses = await self.scraper.scrape_addresses(days=days)
            total_addresses = len(addresses)

            logger.info(f"Found {total_addresses} unique addresses from Goldsky")

            # Process in batches
            batch_size = 100
            address_list = list(addresses.items())

            for i in range(0, len(address_list), batch_size):
                batch = address_list[i:i + batch_size]

                for address, data in batch:
                    result = await self._upsert_wallet(address, data)
                    if result.get("is_new"):
                        new_wallets += 1
                    else:
                        updated_wallets += 1

                if progress_callback:
                    progress_callback(i + len(batch), total_addresses, new_wallets)

                # Small delay between batches
                await asyncio.sleep(0.1)

        summary = {
            "total_addresses": total_addresses,
            "new_wallets": new_wallets,
            "updated_wallets": updated_wallets,
            "days_scanned": days
        }

        logger.info(f"Goldsky collection complete: {summary}")
        return summary

    async def _upsert_wallet(self, address: str, data: dict) -> dict:
        """
        Upsert a wallet with source logic.

        If wallet exists with different source, update to 'both'.
        """
        address = address.lower()

        # Check if wallet exists
        existing = self.db.get_wallet(address)

        if existing:
            # Update source to 'both' if it was from leaderboard
            new_source = 'both' if existing['source'] == 'leaderboard' else existing['source']

            self.db.update_wallet(address, {
                "source": new_source,
                "updated_at": datetime.utcnow().isoformat()
            })

            return {"is_new": False, "source": new_source}
        else:
            # Insert new wallet
            self.db.upsert_wallet({
                "address": address,
                "source": "goldsky",
                "balance": 0,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            })

            return {"is_new": True, "source": "goldsky"}

    async def collect_streaming(
        self,
        days: int = 30,
        batch_size: int = 10000,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """
        Stream-based collection for memory efficiency with large datasets.

        Processes addresses in batches without holding all in memory.
        """
        logger.info(f"Starting streaming Goldsky collection for {days} days")

        new_wallets = 0
        updated_wallets = 0
        total_addresses = 0
        batch_count = 0

        async with self.scraper:
            async for batch in self.scraper.stream_addresses(days=days, batch_size=batch_size):
                batch_count += 1

                for address, data in batch:
                    total_addresses += 1
                    result = await self._upsert_wallet(address, data)
                    if result.get("is_new"):
                        new_wallets += 1
                    else:
                        updated_wallets += 1

                if progress_callback:
                    progress_callback(batch_count, total_addresses)

                logger.debug(f"Processed batch {batch_count}: {len(batch)} addresses")
                await asyncio.sleep(0.1)

        summary = {
            "total_addresses": total_addresses,
            "new_wallets": new_wallets,
            "updated_wallets": updated_wallets,
            "batches_processed": batch_count,
            "days_scanned": days
        }

        logger.info(f"Streaming Goldsky collection complete: {summary}")
        return summary
