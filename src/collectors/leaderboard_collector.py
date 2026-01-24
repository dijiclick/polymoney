"""Leaderboard wallet collector - fetches top traders from Polymarket leaderboard API."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Callable

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

from ..database.supabase import get_supabase_client
from ..config.settings import get_settings

logger = logging.getLogger(__name__)


# All leaderboard categories available
LEADERBOARD_CATEGORIES = [
    "OVERALL",
    "POLITICS",
    "SPORTS",
    "CRYPTO",
    "CULTURE",
    "MENTIONS",
    "WEATHER",
    "ECONOMICS",
    "TECH",
    "FINANCE"
]


class LeaderboardWalletCollector:
    """
    Collects top trader wallets from Polymarket leaderboard API.

    Fetches top traders by PnL from each category for the MONTH period
    and stores them with source='leaderboard'.
    """

    BASE_URL = "https://data-api.polymarket.com/leaderboard"

    def __init__(self):
        self.db = get_supabase_client()
        self.settings = get_settings()
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def _ensure_session(self):
        if not self._session:
            self._session = aiohttp.ClientSession()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10)
    )
    async def _fetch_leaderboard(
        self,
        category: str,
        period: str = "MONTH",
        order_by: str = "PNL",
        limit: int = 50
    ) -> list[dict]:
        """Fetch leaderboard data for a category."""
        await self._ensure_session()

        params = {
            "category": category,
            "timePeriod": period,
            "orderBy": order_by,
            "limit": limit
        }

        async with self._session.get(self.BASE_URL, params=params) as response:
            if response.status != 200:
                text = await response.text()
                logger.error(f"Leaderboard API error: {response.status} - {text}")
                raise Exception(f"Leaderboard API error: {response.status}")

            return await response.json()

    async def collect(
        self,
        categories: Optional[list[str]] = None,
        period: str = "MONTH",
        limit_per_category: int = 50,
        progress_callback: Optional[Callable[[str, int, int], None]] = None
    ) -> dict:
        """
        Collect wallet addresses from leaderboard for all categories.

        Args:
            categories: List of categories to fetch (default: all)
            period: Time period (MONTH recommended)
            limit_per_category: Number of traders per category
            progress_callback: Optional callback(category, processed, total)

        Returns:
            Summary dict with counts
        """
        if categories is None:
            categories = LEADERBOARD_CATEGORIES

        logger.info(f"Starting leaderboard collection for {len(categories)} categories")

        new_wallets = 0
        updated_wallets = 0
        total_entries = 0
        rankings_stored = 0
        category_stats = {}

        async with self:
            for idx, category in enumerate(categories):
                try:
                    logger.info(f"Fetching leaderboard for {category}")

                    entries = await self._fetch_leaderboard(
                        category=category,
                        period=period,
                        limit=limit_per_category
                    )

                    category_new = 0
                    category_updated = 0

                    for rank, entry in enumerate(entries, 1):
                        total_entries += 1

                        # Extract wallet address
                        address = self._extract_address(entry)
                        if not address:
                            continue

                        # Upsert wallet
                        result = await self._upsert_wallet(address)
                        if result.get("is_new"):
                            new_wallets += 1
                            category_new += 1
                        else:
                            updated_wallets += 1
                            category_updated += 1

                        # Store ranking metadata
                        await self._store_ranking(
                            address=address,
                            category=category,
                            rank=rank,
                            pnl=entry.get("pnl"),
                            volume=entry.get("volume")
                        )
                        rankings_stored += 1

                    category_stats[category] = {
                        "entries": len(entries),
                        "new_wallets": category_new,
                        "updated_wallets": category_updated
                    }

                    if progress_callback:
                        progress_callback(category, idx + 1, len(categories))

                    # Rate limiting between categories
                    await asyncio.sleep(0.5)

                except Exception as e:
                    logger.error(f"Error fetching {category}: {e}")
                    category_stats[category] = {"error": str(e)}
                    continue

        summary = {
            "total_entries": total_entries,
            "new_wallets": new_wallets,
            "updated_wallets": updated_wallets,
            "rankings_stored": rankings_stored,
            "categories_processed": len([c for c in category_stats if "error" not in category_stats[c]]),
            "category_stats": category_stats
        }

        logger.info(f"Leaderboard collection complete: {new_wallets} new, {updated_wallets} updated")
        return summary

    def _extract_address(self, entry: dict) -> Optional[str]:
        """Extract wallet address from leaderboard entry."""
        # Try different possible field names
        for field in ["proxyWallet", "address", "user", "wallet"]:
            if field in entry and entry[field]:
                return entry[field].lower()
        return None

    async def _upsert_wallet(self, address: str) -> dict:
        """Upsert wallet with source logic."""
        address = address.lower()

        existing = self.db.get_wallet(address)

        if existing:
            new_source = 'both' if existing['source'] == 'goldsky' else existing['source']

            self.db.update_wallet(address, {
                "source": new_source,
                "updated_at": datetime.utcnow().isoformat()
            })

            return {"is_new": False, "source": new_source}
        else:
            self.db.upsert_wallet({
                "address": address,
                "source": "leaderboard",
                "balance": 0,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            })

            return {"is_new": True, "source": "leaderboard"}

    async def _store_ranking(
        self,
        address: str,
        category: str,
        rank: int,
        pnl: Optional[float] = None,
        volume: Optional[float] = None
    ):
        """Store leaderboard ranking metadata."""
        self.db.upsert_leaderboard_ranking({
            "address": address.lower(),
            "category": category,
            "rank": rank,
            "pnl": pnl,
            "volume": volume,
            "fetched_at": datetime.utcnow().isoformat()
        })

    async def collect_single_category(
        self,
        category: str,
        period: str = "MONTH",
        limit: int = 50
    ) -> dict:
        """Collect wallets from a single category."""
        return await self.collect(
            categories=[category],
            period=period,
            limit_per_category=limit
        )
