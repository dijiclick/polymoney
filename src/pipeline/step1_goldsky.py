"""Step 1: Extract addresses from Goldsky blockchain data."""

import logging
from datetime import datetime
from typing import Optional

from ..scrapers.goldsky import GoldskyScraper
from ..database.supabase import get_supabase_client
from ..config.filters import FilterConfig

logger = logging.getLogger(__name__)


class Step1Goldsky:
    """Step 1: Extract unique trader addresses from blockchain events."""

    def __init__(self, filters: Optional[FilterConfig] = None):
        self.filters = filters or FilterConfig.load()
        self.min_trades = self.filters.pipeline.step1_goldsky.min_trades
        self.db = get_supabase_client()

    async def run(
        self,
        days: int = 30,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run Step 1: Extract all addresses from Goldsky.

        Returns dict with statistics.
        """
        logger.info(f"Starting Step 1: Goldsky extraction for {days} days")
        logger.info(f"Min trades filter: {self.min_trades}")

        async with GoldskyScraper() as scraper:
            addresses = await scraper.scrape_addresses(
                days=days,
                progress_callback=progress_callback
            )

        total_addresses = len(addresses)
        logger.info(f"Found {total_addresses} unique addresses")

        # Filter by minimum trades
        qualified = {
            addr: data for addr, data in addresses.items()
            if data["trade_count"] >= self.min_trades
        }

        eliminated = total_addresses - len(qualified)
        logger.info(f"Qualified: {len(qualified)}, Eliminated: {eliminated}")

        # Save to database
        await self._save_to_database(qualified, addresses)

        return {
            "total_found": total_addresses,
            "qualified": len(qualified),
            "eliminated": eliminated,
            "min_trades_filter": self.min_trades
        }

    async def _save_to_database(
        self,
        qualified: dict[str, dict],
        all_addresses: dict[str, dict]
    ):
        """Save addresses to database."""
        logger.info("Saving qualified addresses to database...")

        batch = []
        batch_size = 500

        for addr, data in qualified.items():
            trader_data = {
                "address": addr,
                "trade_count_30d": data["trade_count"],
                "last_trade_at": data["last_trade_at"].isoformat(),
                "first_trade_at": data["first_trade_at"].isoformat(),
                "pipeline_step": 2,  # Ready for Step 2
                "last_updated_at": datetime.now().isoformat()
            }
            batch.append(trader_data)

            if len(batch) >= batch_size:
                self.db.upsert_traders_batch(batch)
                batch = []

        if batch:
            self.db.upsert_traders_batch(batch)

        # Save eliminated addresses with reason
        logger.info("Saving eliminated addresses...")
        eliminated_batch = []

        for addr, data in all_addresses.items():
            if addr in qualified:
                continue

            trader_data = {
                "address": addr,
                "trade_count_30d": data["trade_count"],
                "last_trade_at": data["last_trade_at"].isoformat(),
                "first_trade_at": data["first_trade_at"].isoformat(),
                "pipeline_step": 1,
                "eliminated_at_step": 1,
                "elimination_reason": f"Trade count {data['trade_count']} < {self.min_trades}",
                "last_updated_at": datetime.now().isoformat()
            }
            eliminated_batch.append(trader_data)

            if len(eliminated_batch) >= batch_size:
                self.db.upsert_traders_batch(eliminated_batch)
                eliminated_batch = []

        if eliminated_batch:
            self.db.upsert_traders_batch(eliminated_batch)

        logger.info("Database save complete")

    async def run_incremental(
        self,
        days: int = 1,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Run incremental update for new addresses only.

        Checks for addresses not already in database.
        """
        logger.info(f"Starting incremental Step 1 for {days} days")

        async with GoldskyScraper() as scraper:
            addresses = await scraper.scrape_addresses(
                days=days,
                progress_callback=progress_callback
            )

        # Filter out existing addresses
        existing = set()
        for addr in addresses.keys():
            trader = self.db.get_trader(addr)
            if trader:
                existing.add(addr)

        new_addresses = {
            addr: data for addr, data in addresses.items()
            if addr not in existing
        }

        logger.info(f"Found {len(new_addresses)} new addresses")

        if not new_addresses:
            return {"new_addresses": 0, "qualified": 0}

        # Filter by minimum trades
        qualified = {
            addr: data for addr, data in new_addresses.items()
            if data["trade_count"] >= self.min_trades
        }

        await self._save_to_database(qualified, new_addresses)

        return {
            "new_addresses": len(new_addresses),
            "qualified": len(qualified),
            "eliminated": len(new_addresses) - len(qualified)
        }
