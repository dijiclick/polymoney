"""Goldsky GraphQL scraper for on-chain trade data."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import AsyncGenerator, Optional

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config.settings import get_settings

logger = logging.getLogger(__name__)


class GoldskyScraper:
    """Scraper for Goldsky GraphQL API to get on-chain trade data."""

    QUERY = """
    query GetOrderFilledEvents($first: Int!, $timestamp_lt: BigInt!, $timestamp_gte: BigInt!) {
        orderFilledEvents(
            first: $first,
            orderBy: timestamp,
            orderDirection: desc,
            where: {
                timestamp_lt: $timestamp_lt,
                timestamp_gte: $timestamp_gte
            }
        ) {
            timestamp
            maker
            taker
            makerAmountFilled
            takerAmountFilled
        }
    }
    """

    def __init__(self):
        self.settings = get_settings()
        self.endpoint = self.settings.api.goldsky.endpoint
        self.batch_size = self.settings.api.goldsky.batch_size
        self.rate_limit = self.settings.api.goldsky.rate_limit
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10)
    )
    async def _fetch_events(
        self,
        timestamp_lt: int,
        timestamp_gte: int,
        first: int = 1000
    ) -> list[dict]:
        """Fetch order filled events from Goldsky."""
        if not self._session:
            self._session = aiohttp.ClientSession()

        variables = {
            "first": first,
            "timestamp_lt": str(timestamp_lt),
            "timestamp_gte": str(timestamp_gte)
        }

        payload = {
            "query": self.QUERY,
            "variables": variables
        }

        async with self._session.post(self.endpoint, json=payload) as response:
            if response.status != 200:
                text = await response.text()
                logger.error(f"Goldsky API error: {response.status} - {text}")
                raise Exception(f"Goldsky API error: {response.status}")

            data = await response.json()

            if "errors" in data:
                logger.error(f"GraphQL errors: {data['errors']}")
                raise Exception(f"GraphQL errors: {data['errors']}")

            return data.get("data", {}).get("orderFilledEvents", [])

    async def scrape_addresses(
        self,
        days: int = 30,
        progress_callback: Optional[callable] = None
    ) -> dict[str, dict]:
        """
        Scrape all unique addresses from trade events in the given time period.

        Returns a dict of address -> {trade_count, last_trade_at, first_trade_at}
        """
        addresses: dict[str, dict] = {}
        platform_wallets = set(self.settings.platform_wallets)

        now = int(datetime.now().timestamp())
        start_time = int((datetime.now() - timedelta(days=days)).timestamp())

        current_timestamp = now
        total_events = 0
        batch_count = 0

        logger.info(f"Starting Goldsky scrape for {days} days")
        logger.info(f"Time range: {datetime.fromtimestamp(start_time)} to {datetime.fromtimestamp(now)}")

        while current_timestamp > start_time:
            try:
                events = await self._fetch_events(
                    timestamp_lt=current_timestamp,
                    timestamp_gte=start_time,
                    first=self.batch_size
                )

                if not events:
                    break

                batch_count += 1
                total_events += len(events)

                for event in events:
                    timestamp = int(event["timestamp"])
                    trade_time = datetime.fromtimestamp(timestamp)

                    # Process maker
                    maker = event["maker"].lower()
                    if maker not in platform_wallets:
                        if maker not in addresses:
                            addresses[maker] = {
                                "trade_count": 0,
                                "last_trade_at": trade_time,
                                "first_trade_at": trade_time
                            }
                        addresses[maker]["trade_count"] += 1
                        if trade_time > addresses[maker]["last_trade_at"]:
                            addresses[maker]["last_trade_at"] = trade_time
                        if trade_time < addresses[maker]["first_trade_at"]:
                            addresses[maker]["first_trade_at"] = trade_time

                    # Process taker
                    taker = event["taker"].lower()
                    if taker not in platform_wallets:
                        if taker not in addresses:
                            addresses[taker] = {
                                "trade_count": 0,
                                "last_trade_at": trade_time,
                                "first_trade_at": trade_time
                            }
                        addresses[taker]["trade_count"] += 1
                        if trade_time > addresses[taker]["last_trade_at"]:
                            addresses[taker]["last_trade_at"] = trade_time
                        if trade_time < addresses[taker]["first_trade_at"]:
                            addresses[taker]["first_trade_at"] = trade_time

                # Update pagination cursor
                oldest_timestamp = min(int(e["timestamp"]) for e in events)
                current_timestamp = oldest_timestamp

                if progress_callback:
                    # For Goldsky extraction, total_events is "total" and len(addresses) is "qualified"
                    # No eliminations happen during extraction itself
                    progress_callback(batch_count, total_events, len(addresses), 0)

                # Rate limiting
                await asyncio.sleep(1 / self.rate_limit)

                logger.debug(f"Batch {batch_count}: {len(events)} events, {len(addresses)} unique addresses")

            except Exception as e:
                logger.error(f"Error in batch {batch_count}: {e}")
                await asyncio.sleep(5)  # Back off on error
                continue

        logger.info(f"Goldsky scrape complete: {total_events} events, {len(addresses)} unique addresses")
        return addresses

    async def stream_addresses(
        self,
        days: int = 30,
        batch_size: int = 10000
    ) -> AsyncGenerator[list[tuple[str, dict]], None]:
        """
        Stream addresses in batches for memory-efficient processing.

        Yields batches of (address, data) tuples.
        """
        addresses: dict[str, dict] = {}
        platform_wallets = set(self.settings.platform_wallets)

        now = int(datetime.now().timestamp())
        start_time = int((datetime.now() - timedelta(days=days)).timestamp())
        current_timestamp = now

        while current_timestamp > start_time:
            try:
                events = await self._fetch_events(
                    timestamp_lt=current_timestamp,
                    timestamp_gte=start_time,
                    first=self.batch_size
                )

                if not events:
                    break

                for event in events:
                    timestamp = int(event["timestamp"])
                    trade_time = datetime.fromtimestamp(timestamp)

                    for addr_key in ["maker", "taker"]:
                        addr = event[addr_key].lower()
                        if addr in platform_wallets:
                            continue

                        if addr not in addresses:
                            addresses[addr] = {
                                "trade_count": 0,
                                "last_trade_at": trade_time,
                                "first_trade_at": trade_time
                            }
                        addresses[addr]["trade_count"] += 1
                        if trade_time > addresses[addr]["last_trade_at"]:
                            addresses[addr]["last_trade_at"] = trade_time
                        if trade_time < addresses[addr]["first_trade_at"]:
                            addresses[addr]["first_trade_at"] = trade_time

                # Yield batch when we have enough addresses
                if len(addresses) >= batch_size:
                    yield list(addresses.items())
                    addresses.clear()

                oldest_timestamp = min(int(e["timestamp"]) for e in events)
                current_timestamp = oldest_timestamp

                await asyncio.sleep(1 / self.rate_limit)

            except Exception as e:
                logger.error(f"Error streaming addresses: {e}")
                await asyncio.sleep(5)
                continue

        # Yield remaining addresses
        if addresses:
            yield list(addresses.items())
