"""Polymarket Data API client with per-endpoint rate limiting."""

import asyncio
import logging
import time
from typing import Optional
from datetime import datetime

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config.settings import get_settings

logger = logging.getLogger(__name__)

# Page size for pagination
PAGE_SIZE = 50

# USDC.e contract on Polygon (used by Polymarket)
USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
USDC_DECIMALS = 6

# Polygon RPC endpoint (free public endpoint)
POLYGON_RPC_URL = "https://polygon-rpc.com"

# Per-endpoint rate limits (requests per second)
# Official Polymarket limits: positions/closed-positions=15/s, trades=20/s, general=100/s
# We use conservative values below the limits
ENDPOINT_RATE_LIMITS = {
    "positions": 10,        # 10 req/s (limit: 15)
    "closed-positions": 10, # 10 req/s (limit: 15)
    "activity": 30,         # 30 req/s (limit: 100)
    "value": 30,            # 30 req/s (limit: 100)
    "trades": 15,           # 15 req/s (limit: 20)
}

# Batch sizes per endpoint (how many parallel requests)
ENDPOINT_BATCH_SIZES = {
    "positions": 5,         # 5 parallel = 0.5s per batch at 10 req/s
    "closed-positions": 5,  # 5 parallel = 0.5s per batch at 10 req/s
    "activity": 10,         # 10 parallel = 0.33s per batch at 30 req/s
}


class EndpointRateLimiter:
    """Per-endpoint rate limiter using token bucket algorithm."""

    def __init__(self, rate: float):
        """
        Args:
            rate: Maximum requests per second
        """
        self.rate = rate
        self.tokens = rate
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self):
        """Wait until a request can be made."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.tokens = min(self.rate, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens < 1:
                wait_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 0
            else:
                self.tokens -= 1


class PolymarketDataAPI:
    """Client for Polymarket Data API with per-endpoint rate limiting."""

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.api.polymarket.base_url
        self._session: Optional[aiohttp.ClientSession] = None

        # Per-endpoint rate limiters
        self._rate_limiters: dict[str, EndpointRateLimiter] = {}
        for endpoint, rate in ENDPOINT_RATE_LIMITS.items():
            self._rate_limiters[endpoint] = EndpointRateLimiter(rate)

        # Default rate limiter for unknown endpoints
        self._default_limiter = EndpointRateLimiter(30)

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

    def _get_rate_limiter(self, endpoint: str) -> EndpointRateLimiter:
        """Get the rate limiter for an endpoint."""
        return self._rate_limiters.get(endpoint, self._default_limiter)

    def _get_batch_size(self, endpoint: str) -> int:
        """Get the batch size for an endpoint."""
        return ENDPOINT_BATCH_SIZES.get(endpoint, 5)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30)
    )
    async def _get(self, endpoint: str, params: Optional[dict] = None) -> dict | list:
        """Make a GET request to the API with rate limiting."""
        await self._ensure_session()

        # Apply per-endpoint rate limiting
        limiter = self._get_rate_limiter(endpoint)
        await limiter.acquire()

        url = f"{self.base_url}/{endpoint}"

        async with self._session.get(url, params=params) as response:
            if response.status == 404:
                return []
            if response.status == 429:
                # Rate limited - wait and retry
                retry_after = int(response.headers.get("Retry-After", 10))
                logger.warning(f"Rate limited on {endpoint}, waiting {retry_after}s")
                await asyncio.sleep(retry_after)
                raise Exception(f"Rate limited: {response.status}")
            if response.status != 200:
                text = await response.text()
                logger.error(f"API error on {endpoint}: {response.status}")
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
            logger.debug(f"Page fetch failed for {endpoint}: {e}")
            return [], False

    async def _fetch_all_pages(
        self,
        endpoint: str,
        base_params: dict,
        page_size: int = PAGE_SIZE
    ) -> list[dict]:
        """
        Fetch all pages of data using rate-limited parallel batching.

        Uses endpoint-specific batch sizes to respect rate limits.
        """
        all_data = []
        offset = 0
        batch_size = self._get_batch_size(endpoint)

        while True:
            # Create batch of page requests
            batch_tasks = []
            for i in range(batch_size):
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

            offset += batch_size * page_size

            # Safety limit: max 200 batches (10,000 items for batch_size=5)
            if offset >= 50000:
                logger.warning(f"Hit safety limit for {endpoint}")
                break

        return all_data

    # =========================================================================
    # Profile Endpoint (Gamma API - separate rate limit)
    # =========================================================================

    async def get_profile(self, address: str) -> dict:
        """Get a trader's public profile from Gamma API."""
        try:
            await self._ensure_session()
            # Gamma API has its own rate limits, use default limiter
            await self._default_limiter.acquire()

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
        """Get a trader's portfolio value (positions only, no USDC cash)."""
        try:
            result = await self._get("value", {"user": address})
            if isinstance(result, list) and len(result) > 0:
                return float(result[0].get("value", 0))
            return 0
        except Exception as e:
            logger.error(f"Error getting portfolio value for {address}: {e}")
            return 0

    async def get_usdc_balance(self, address: str) -> float:
        """
        Get USDC.e balance for a wallet on Polygon via RPC.

        This is needed because /value endpoint only returns position value,
        not USDC cash balance. For accurate ROI calculation, we need both.
        """
        await self._ensure_session()

        # ERC-20 balanceOf function selector + address (padded to 32 bytes)
        # balanceOf(address) = 0x70a08231
        address_padded = address.lower().replace("0x", "").zfill(64)
        data = f"0x70a08231{address_padded}"

        payload = {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [
                {
                    "to": USDC_CONTRACT,
                    "data": data
                },
                "latest"
            ],
            "id": 1
        }

        try:
            async with self._session.post(
                POLYGON_RPC_URL,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    if "result" in result and result["result"]:
                        # Convert hex to int, then to USD (6 decimals)
                        balance_raw = int(result["result"], 16)
                        balance_usd = balance_raw / (10 ** USDC_DECIMALS)
                        return balance_usd
                return 0
        except Exception as e:
            logger.debug(f"Error getting USDC balance for {address}: {e}")
            return 0

    async def get_total_balance(self, address: str) -> tuple[float, float, float]:
        """
        Get total balance including positions and USDC cash.

        Returns:
            Tuple of (total_balance, position_value, usdc_cash)
        """
        position_value, usdc_cash = await asyncio.gather(
            self.get_portfolio_value(address),
            self.get_usdc_balance(address)
        )
        total = position_value + usdc_cash
        return total, position_value, usdc_cash

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
        concurrency: int = 5
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
        """Get all data for a single trader (sequential to respect rate limits)."""
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
