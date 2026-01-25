"""Polymarket Data API client."""

import asyncio
import logging
from typing import Optional
from datetime import datetime

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config.settings import get_settings

logger = logging.getLogger(__name__)

# Parallel fetching settings - SAFE (avoids Cloudflare rate limits)
PAGE_SIZE = 50
PARALLEL_BATCH_SIZE = 10  # Fetch 10 pages at once (500 items per batch)


class PolymarketDataAPI:
    """Client for Polymarket Data API."""

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.api.polymarket.base_url
        self.rate_limit = self.settings.api.polymarket.rate_limit
        self._session: Optional[aiohttp.ClientSession] = None
        self._request_count = 0
        self._last_request_time = datetime.now()

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def _ensure_session(self):
        """Ensure we have an active session."""
        if not self._session:
            self._session = aiohttp.ClientSession()

    async def _rate_limit_wait(self):
        """Wait to respect rate limits."""
        self._request_count += 1
        if self._request_count >= self.rate_limit:
            elapsed = (datetime.now() - self._last_request_time).total_seconds()
            if elapsed < 60:
                wait_time = 60 - elapsed
                logger.debug(f"Rate limit reached, waiting {wait_time:.1f}s")
                await asyncio.sleep(wait_time)
            self._request_count = 0
            self._last_request_time = datetime.now()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10)
    )
    async def _get(self, endpoint: str, params: Optional[dict] = None) -> dict | list:
        """Make a GET request to the API."""
        await self._ensure_session()
        await self._rate_limit_wait()

        url = f"{self.base_url}/{endpoint}"

        async with self._session.get(url, params=params) as response:
            if response.status == 404:
                return []
            if response.status != 200:
                text = await response.text()
                logger.error(f"API error: {response.status} - {text}")
                raise Exception(f"API error: {response.status}")

            return await response.json()

    async def _fetch_page(self, endpoint: str, params: dict) -> tuple[list, bool]:
        """
        Fetch a single page of data.
        Returns (data, ok) tuple.
        """
        try:
            result = await self._get(endpoint, params)
            if isinstance(result, list):
                return result, True
            return [], True
        except Exception as e:
            logger.debug(f"Page fetch failed: {e}")
            return [], False

    async def _fetch_all_pages(
        self,
        endpoint: str,
        base_params: dict,
        page_size: int = PAGE_SIZE
    ) -> list[dict]:
        """
        Fetch all pages of data using parallel batch fetching.

        Strategy:
        1. Fetch first batch of pages in parallel
        2. If any page returns data, fetch more batches
        3. Stop when a batch returns all empty pages
        """
        all_data = []
        offset = 0

        while True:
            # Create batch of page requests
            batch_tasks = []
            for i in range(PARALLEL_BATCH_SIZE):
                params = {**base_params, "limit": page_size, "offset": offset + (i * page_size)}
                batch_tasks.append(self._fetch_page(endpoint, params))

            # Execute batch in parallel
            results = await asyncio.gather(*batch_tasks)

            # Process results
            batch_has_data = False
            for data, ok in results:
                if ok and data:
                    all_data.extend(data)
                    batch_has_data = True

            # If no pages in batch had data, we're done
            if not batch_has_data:
                break

            offset += PARALLEL_BATCH_SIZE * page_size

            # Safety limit: max 100 batches (50,000 items)
            if offset >= 50000:
                logger.warning(f"Hit safety limit for {endpoint}")
                break

        return all_data

    # =========================================================================
    # Profile Endpoint (Gamma API)
    # =========================================================================

    async def get_profile(self, address: str) -> dict:
        """Get a trader's public profile from Gamma API."""
        try:
            await self._ensure_session()
            await self._rate_limit_wait()

            url = f"https://gamma-api.polymarket.com/public-profile"
            async with self._session.get(url, params={"address": address}) as response:
                if response.status == 404:
                    return {}
                if response.status != 200:
                    return {}
                return await response.json()
        except Exception as e:
            logger.error(f"Error getting profile for {address}: {e}")
            return {}

    # =========================================================================
    # Trader Data Endpoints
    # =========================================================================

    async def get_portfolio_value(self, address: str) -> float:
        """Get a trader's portfolio value."""
        try:
            result = await self._get("value", {"user": address})
            if isinstance(result, list) and len(result) > 0:
                return float(result[0].get("value", 0))
            return 0
        except Exception as e:
            logger.error(f"Error getting portfolio value for {address}: {e}")
            return 0

    async def get_positions(self, address: str) -> list[dict]:
        """Get a trader's open positions with full pagination."""
        try:
            return await self._fetch_all_pages("positions", {"user": address})
        except Exception as e:
            logger.error(f"Error getting positions for {address}: {e}")
            return []

    async def get_closed_positions(self, address: str) -> list[dict]:
        """Get a trader's closed/resolved positions with full pagination."""
        try:
            # Use TIMESTAMP sorting to ensure we get all positions in order
            return await self._fetch_all_pages(
                "closed-positions",
                {
                    "user": address,
                    "sortBy": "TIMESTAMP",
                    "sortDirection": "DESC"
                }
            )
        except Exception as e:
            logger.error(f"Error getting closed positions for {address}: {e}")
            return []

    async def get_activity(self, address: str) -> list[dict]:
        """Get a trader's activity history with full pagination."""
        try:
            return await self._fetch_all_pages("activity", {"user": address})
        except Exception as e:
            logger.error(f"Error getting activity for {address}: {e}")
            return []

    async def get_trades(self, address: str) -> list[dict]:
        """Get a trader's individual trades."""
        try:
            result = await self._get("trades", {"user": address})
            if isinstance(result, list):
                return result
            return []
        except Exception as e:
            logger.error(f"Error getting trades for {address}: {e}")
            return []

    # =========================================================================
    # Batch Operations
    # =========================================================================

    async def get_multiple_portfolio_values(
        self,
        addresses: list[str],
        concurrency: int = 10
    ) -> dict[str, float]:
        """Get portfolio values for multiple addresses concurrently."""
        results = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def fetch_one(addr: str):
            async with semaphore:
                value = await self.get_portfolio_value(addr)
                results[addr] = value

        tasks = [fetch_one(addr) for addr in addresses]
        await asyncio.gather(*tasks, return_exceptions=True)
        return results

    async def get_full_trader_data(self, address: str) -> dict:
        """Get all data for a single trader."""
        portfolio_value = await self.get_portfolio_value(address)
        positions = await self.get_positions(address)
        closed_positions = await self.get_closed_positions(address)
        activity = await self.get_activity(address)

        return {
            "address": address,
            "portfolio_value": portfolio_value,
            "positions": positions,
            "closed_positions": closed_positions,
            "activity": activity
        }

    # =========================================================================
    # Position Analysis Helpers
    # =========================================================================

    def parse_positions(self, positions: list[dict]) -> dict:
        """Parse positions and calculate metrics."""
        if not positions:
            return {
                "total_positions": 0,
                "active_positions": 0,
                "avg_position_size": 0,
                "max_position_size": 0,
                "position_concentration": 0,
                "total_value": 0,
                "unrealized_pnl": 0
            }

        sizes = []
        total_value = 0
        unrealized_pnl = 0

        for pos in positions:
            size = float(pos.get("currentValue", 0))
            sizes.append(size)
            total_value += size
            unrealized_pnl += float(pos.get("cashPnl", 0))

        max_size = max(sizes) if sizes else 0
        avg_size = sum(sizes) / len(sizes) if sizes else 0
        concentration = (max_size / total_value * 100) if total_value > 0 else 0

        return {
            "total_positions": len(positions),
            "active_positions": len(positions),
            "avg_position_size": avg_size,
            "max_position_size": max_size,
            "position_concentration": concentration,
            "total_value": total_value,
            "unrealized_pnl": unrealized_pnl
        }

    def parse_closed_positions(self, closed_positions: list[dict], days: int = 30) -> dict:
        """Parse closed positions and calculate win rate."""
        if not closed_positions:
            return {
                "closed_positions_30d": 0,
                "winning_positions_30d": 0,
                "win_rate_30d": 0,
                "closed_positions_alltime": 0,
                "winning_positions_alltime": 0,
                "win_rate_alltime": 0,
                "realized_pnl": 0
            }

        now = datetime.now()
        cutoff_timestamp = int((now.timestamp()) - (days * 86400))

        positions_30d = []
        positions_alltime = closed_positions
        realized_pnl = 0

        for pos in closed_positions:
            pnl = float(pos.get("realizedPnl", 0))
            realized_pnl += pnl

            timestamp = pos.get("timestamp", 0)
            if timestamp and timestamp >= cutoff_timestamp:
                positions_30d.append(pos)

        wins_30d = sum(1 for p in positions_30d if float(p.get("realizedPnl", 0)) > 0)
        wins_alltime = sum(1 for p in positions_alltime if float(p.get("realizedPnl", 0)) > 0)

        return {
            "closed_positions_30d": len(positions_30d),
            "winning_positions_30d": wins_30d,
            "win_rate_30d": (wins_30d / len(positions_30d) * 100) if positions_30d else 0,
            "closed_positions_alltime": len(positions_alltime),
            "winning_positions_alltime": wins_alltime,
            "win_rate_alltime": (wins_alltime / len(positions_alltime) * 100) if positions_alltime else 0,
            "realized_pnl": realized_pnl
        }
