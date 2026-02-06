"""
Market resolver for Polymarket crypto up-or-down prediction markets.

Discovers rotating 15m/1h/4h markets by computing expected slugs and
querying the Gamma API.

Slug patterns:
  15m: {sym}-updown-15m-{unix_ts}        (ts rounded to 900s)
  1h:  {name}-up-or-down-{month}-{day}-{hour}{ampm}-et
  4h:  {sym}-updown-4h-{unix_ts}         (ts aligned to ET 4h blocks)
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ET offset from UTC (EST = -5, EDT = -4)
ET_OFFSET_HOURS = 5  # Using EST; adjust if EDT needed


@dataclass
class CryptoMarket:
    """Represents a Polymarket crypto up-or-down market."""

    condition_id: str
    market_slug: str
    question: str
    crypto_symbol: str  # BTC, ETH, SOL, XRP
    timeframe: str  # 15m, 1h, 4h
    token_id_up: str  # clobTokenId for Up outcome
    token_id_down: str  # clobTokenId for Down outcome
    event_slug: str = ""
    active: bool = True


# Symbols and their full names (used in 1h slug pattern)
SYMBOLS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "XRP": "xrp",
}

TIMEFRAMES = ["15m", "1h", "4h"]


class MarketResolver:
    """
    Discovers current Polymarket crypto up-or-down markets.

    These markets rotate every period (15m/1h/4h), so we compute
    the expected slug and query the Gamma API for each.
    """

    GAMMA_API = "https://gamma-api.polymarket.com"

    def __init__(self):
        self._markets: dict[str, CryptoMarket] = {}  # key (SYM_TF) -> market
        self._token_to_market: dict[str, CryptoMarket] = {}  # token_id -> market
        self._client: Optional[httpx.AsyncClient] = None
        self._refresh_lock = asyncio.Lock()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _compute_slugs(self, symbol: str, timeframe: str) -> list[str]:
        """Compute candidate slugs for a symbol+timeframe pair."""
        sym = symbol.lower()
        name = SYMBOLS[symbol]
        now_ts = int(time.time())
        slugs = []

        if timeframe == "15m":
            # Slug: btc-updown-15m-{ts}, ts rounded to 900s
            base = (now_ts // 900) * 900
            for offset in [0, -1, 1]:
                slugs.append(f"{sym}-updown-15m-{base + offset * 900}")

        elif timeframe == "1h":
            # Slug: bitcoin-up-or-down-{month}-{day}-{hour}{ampm}-et
            et_now = datetime.now(timezone.utc) - timedelta(hours=ET_OFFSET_HOURS)
            for h_offset in [0, -1, 1]:
                dt = et_now + timedelta(hours=h_offset)
                month = dt.strftime("%B").lower()
                day = dt.day
                h = dt.hour
                ampm = "am" if h < 12 else "pm"
                h12 = h % 12 if h % 12 != 0 else 12
                slugs.append(f"{name}-up-or-down-{month}-{day}-{h12}{ampm}-et")

        elif timeframe == "4h":
            # Slug: btc-updown-4h-{ts}, ts aligned to ET 4h blocks
            # ET 4h blocks start at 00:00 ET = 05:00 UTC
            et_base = ET_OFFSET_HOURS * 3600
            base = ((now_ts - et_base) // 14400) * 14400 + et_base
            for offset in [0, -1, 1]:
                slugs.append(f"{sym}-updown-4h-{base + offset * 14400}")

        return slugs

    async def _fetch_market(self, slug: str) -> Optional[dict]:
        """Fetch a single market by exact slug from Gamma API."""
        client = await self._get_client()
        try:
            resp = await client.get(
                f"{self.GAMMA_API}/markets",
                params={"slug": slug, "limit": "1"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data and len(data) > 0:
                return data[0]
        except Exception as e:
            logger.debug(f"Error fetching {slug}: {e}")
        return None

    def _parse_market(
        self, market_data: dict, symbol: str, timeframe: str
    ) -> Optional[CryptoMarket]:
        """Parse Gamma API market data into CryptoMarket."""
        try:
            condition_id = market_data.get("conditionId")
            slug = market_data.get("slug", "")
            question = market_data.get("question", "")
            tokens_raw = market_data.get("clobTokenIds", "[]")

            if isinstance(tokens_raw, str):
                tokens = json.loads(tokens_raw)
            else:
                tokens = tokens_raw

            if not condition_id or len(tokens) < 2:
                return None

            return CryptoMarket(
                condition_id=condition_id,
                market_slug=slug,
                question=question,
                crypto_symbol=symbol,
                timeframe=timeframe,
                token_id_up=tokens[0],
                token_id_down=tokens[1],
                event_slug=slug,
                active=True,
            )
        except Exception as e:
            logger.debug(f"Error parsing market: {e}")
            return None

    async def refresh_markets(self) -> list[CryptoMarket]:
        """Discover current markets for all symbol+timeframe combos."""
        async with self._refresh_lock:
            old_tokens = set(self._token_to_market.keys())
            new_markets: dict[str, CryptoMarket] = {}
            new_token_map: dict[str, CryptoMarket] = {}

            # Fetch all combos concurrently
            tasks = []
            for symbol in SYMBOLS:
                for tf in TIMEFRAMES:
                    tasks.append(self._resolve_one(symbol, tf))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    logger.debug(f"Resolve error: {result}")
                    continue
                if result is None:
                    continue
                market = result
                key = f"{market.crypto_symbol}_{market.timeframe}"
                new_markets[key] = market
                new_token_map[market.token_id_up] = market
                new_token_map[market.token_id_down] = market

            self._markets = new_markets
            self._token_to_market = new_token_map

            new_tokens = set(new_token_map.keys())
            added = new_tokens - old_tokens
            removed = old_tokens - new_tokens

            logger.info(
                f"Markets: {len(new_markets)} active | "
                f"+{len(added)} tokens, -{len(removed)} tokens"
            )
            for key, m in sorted(new_markets.items()):
                logger.info(f"  {key}: {m.question[:60]}")

            return list(new_markets.values())

    async def _resolve_one(
        self, symbol: str, timeframe: str
    ) -> Optional[CryptoMarket]:
        """Resolve the current market for one symbol+timeframe."""
        slugs = self._compute_slugs(symbol, timeframe)
        for slug in slugs:
            market_data = await self._fetch_market(slug)
            if market_data:
                active = market_data.get("active", False)
                closed = market_data.get("closed", True)
                if active and not closed:
                    return self._parse_market(market_data, symbol, timeframe)
        return None

    def get_market_by_token(self, token_id: str) -> Optional[CryptoMarket]:
        return self._token_to_market.get(token_id)

    def get_all_token_ids(self) -> list[str]:
        ids = []
        for market in self._markets.values():
            ids.append(market.token_id_up)
            ids.append(market.token_id_down)
        return ids

    def get_all_markets(self) -> list[CryptoMarket]:
        return list(self._markets.values())

    def get_unique_symbols(self) -> set[str]:
        return {m.crypto_symbol for m in self._markets.values()}

    def get_new_token_ids(self, old_tokens: set[str]) -> set[str]:
        """Get token IDs that are new since last check."""
        current = set(self.get_all_token_ids())
        return current - old_tokens

    def get_removed_token_ids(self, old_tokens: set[str]) -> set[str]:
        """Get token IDs that were removed since last check."""
        current = set(self.get_all_token_ids())
        return old_tokens - current
