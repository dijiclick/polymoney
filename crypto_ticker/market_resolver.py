"""
Market resolver for Polymarket crypto prediction markets.

Discovers crypto price markets (daily BTC/ETH markets) from the Gamma API.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class CryptoMarket:
    """Represents a Polymarket crypto prediction market."""

    condition_id: str
    market_slug: str
    question: str
    crypto_symbol: str  # BTC, ETH
    timeframe: str  # daily, weekly, monthly
    token_id_yes: str  # clobTokenId for YES outcome
    token_id_no: str  # clobTokenId for NO outcome
    price_level: Optional[float] = None  # e.g., 82000 for "$82k"
    event_slug: str = ""
    active: bool = True


class MarketResolver:
    """
    Discovers Polymarket crypto price markets from Gamma API.
    """

    GAMMA_API = "https://gamma-api.polymarket.com"

    def __init__(self):
        self._markets: dict[str, CryptoMarket] = {}  # condition_id -> market
        self._token_to_market: dict[str, CryptoMarket] = {}  # token_id -> market
        self._client: Optional[httpx.AsyncClient] = None
        self._refresh_lock = asyncio.Lock()

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30)
        return self._client

    async def close(self) -> None:
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def refresh_markets(self) -> list[CryptoMarket]:
        """Fetch crypto markets from Gamma API."""
        async with self._refresh_lock:
            client = await self._get_client()
            markets = []

            logger.info("Refreshing crypto markets from Gamma API...")

            try:
                # Get active events with high volume
                resp = await client.get(
                    f"{self.GAMMA_API}/events",
                    params={
                        "active": "true",
                        "closed": "false",
                        "order": "volume24hr",
                        "ascending": "false",
                        "limit": "200",
                    },
                )
                resp.raise_for_status()
                events = resp.json()

                for event in events:
                    slug = event.get("slug", "").lower()
                    title = event.get("title", "").lower()

                    # Check if this is a crypto price event
                    if not self._is_crypto_event(slug, title):
                        continue

                    # Extract crypto symbol and timeframe
                    crypto_symbol = self._extract_symbol(slug, title)
                    timeframe = self._extract_timeframe(slug, title)

                    if not crypto_symbol:
                        continue

                    # Process each market in the event
                    for market_data in event.get("markets", []):
                        crypto_market = self._parse_market(
                            market_data, crypto_symbol, timeframe, slug
                        )
                        if crypto_market:
                            markets.append(crypto_market)
                            self._markets[crypto_market.condition_id] = crypto_market
                            self._token_to_market[crypto_market.token_id_yes] = crypto_market
                            self._token_to_market[crypto_market.token_id_no] = crypto_market

                logger.info(f"Discovered {len(markets)} crypto markets")
                for m in markets[:5]:
                    logger.info(f"  {m.crypto_symbol}_{m.timeframe}: {m.question[:50]}")

                return markets

            except httpx.HTTPError as e:
                logger.error(f"HTTP error fetching markets: {e}")
                return list(self._markets.values())
            except Exception as e:
                logger.error(f"Error fetching markets: {e}")
                return list(self._markets.values())

    def _is_crypto_event(self, slug: str, title: str) -> bool:
        """Check if this is a crypto price event."""
        text = f"{slug} {title}"
        # Must contain bitcoin/ethereum and price-related keywords
        has_crypto = any(x in text for x in ["bitcoin", "btc", "ethereum", "eth"])
        has_price = any(x in text for x in ["above", "price", "hit"])
        return has_crypto and has_price

    def _extract_symbol(self, slug: str, title: str) -> Optional[str]:
        """Extract crypto symbol from slug/title."""
        text = f"{slug} {title}".lower()
        if "bitcoin" in text or "btc" in text:
            return "BTC"
        if "ethereum" in text or "eth" in text:
            return "ETH"
        return None

    def _extract_timeframe(self, slug: str, title: str) -> str:
        """Extract timeframe from slug/title."""
        text = f"{slug} {title}".lower()
        if "weekly" in text or "week" in text:
            return "weekly"
        if "monthly" in text or "month" in text:
            return "monthly"
        if re.search(r"on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+", text):
            return "daily"
        if re.search(r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+-\d+", text):
            return "weekly"
        return "daily"  # default

    def _parse_market(
        self, market: dict, crypto_symbol: str, timeframe: str, event_slug: str
    ) -> Optional[CryptoMarket]:
        """Parse market data into CryptoMarket."""
        try:
            condition_id = market.get("conditionId")
            question = market.get("question", "")
            slug = market.get("slug", "")
            clob_token_ids_raw = market.get("clobTokenIds", "[]")
            # clobTokenIds can be a JSON string or a list
            if isinstance(clob_token_ids_raw, str):
                try:
                    clob_token_ids = json.loads(clob_token_ids_raw)
                except json.JSONDecodeError:
                    clob_token_ids = []
            else:
                clob_token_ids = clob_token_ids_raw

            if not condition_id or len(clob_token_ids) < 2:
                return None

            # clobTokenIds: [YES_token, NO_token]
            token_id_yes = clob_token_ids[0]
            token_id_no = clob_token_ids[1]

            # Extract price level from question (e.g., "$82,000" -> 82000)
            price_level = self._extract_price_level(question)

            return CryptoMarket(
                condition_id=condition_id,
                market_slug=slug,
                question=question,
                crypto_symbol=crypto_symbol,
                timeframe=timeframe,
                token_id_yes=token_id_yes,
                token_id_no=token_id_no,
                price_level=price_level,
                event_slug=event_slug,
                active=True,
            )

        except Exception as e:
            logger.debug(f"Error parsing market: {e}")
            return None

    def _extract_price_level(self, question: str) -> Optional[float]:
        """Extract price level from question."""
        patterns = [
            r"\$?([\d,]+)k\b",  # $82k
            r"\$?([\d,]+),000",  # $82,000
            r"above\s+\$?([\d,]+)",  # above 82000
            r"\$?([\d,]+)\s*\?",  # $82000?
        ]
        for pattern in patterns:
            match = re.search(pattern, question, re.IGNORECASE)
            if match:
                value = match.group(1).replace(",", "")
                try:
                    if "k" in pattern:
                        return float(value) * 1000
                    return float(value)
                except ValueError:
                    pass
        return None

    def get_market_by_token(self, token_id: str) -> Optional[CryptoMarket]:
        """Get market by token ID."""
        return self._token_to_market.get(token_id)

    def get_market_by_condition(self, condition_id: str) -> Optional[CryptoMarket]:
        """Get market by condition ID."""
        return self._markets.get(condition_id)

    def get_all_token_ids(self) -> list[str]:
        """Get all token IDs (YES and NO) for subscription."""
        ids = []
        for market in self._markets.values():
            ids.append(market.token_id_yes)
            ids.append(market.token_id_no)
        return ids

    def get_all_markets(self) -> list[CryptoMarket]:
        """Get all discovered markets."""
        return list(self._markets.values())

    def get_markets_by_symbol(self, symbol: str) -> list[CryptoMarket]:
        """Get all markets for a specific crypto symbol."""
        return [m for m in self._markets.values() if m.crypto_symbol == symbol]

    def get_unique_symbols(self) -> set[str]:
        """Get set of all unique crypto symbols found."""
        return {m.crypto_symbol for m in self._markets.values()}
