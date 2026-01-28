#!/usr/bin/env python3
"""
Sync token to market mapping from Polymarket APIs.

This script populates the token_market_mapping table which maps
token_id (used by Goldsky) to condition_id/outcome (used for metrics).

Data sources:
1. Polymarket CLOB API - for active market tokens
2. Gamma API - for market metadata

Usage:
    python scripts/sync_token_mapping.py [--full]

Options:
    --full    Fetch all markets (not just active ones)
"""

import asyncio
import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import aiohttp
from supabase import create_client

from src.config.settings import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Polymarket API endpoints
CLOB_API_BASE = "https://clob.polymarket.com"
GAMMA_API_BASE = "https://gamma-api.polymarket.com"


class TokenMappingSync:
    """Sync token to market mappings from Polymarket APIs."""

    def __init__(self):
        self.settings = get_settings()
        self.supabase = create_client(
            self.settings.supabase.url,
            self.settings.supabase.key
        )
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()

    async def fetch_gamma_markets(self, limit: int = 100, offset: int = 0) -> list[dict]:
        """Fetch markets from Gamma API."""
        try:
            url = f"{GAMMA_API_BASE}/markets"
            params = {
                "limit": limit,
                "offset": offset,
                "closed": "false"  # Only active markets
            }

            async with self._session.get(url, params=params) as response:
                if response.status != 200:
                    logger.warning(f"Gamma API returned {response.status}")
                    return []
                return await response.json()
        except Exception as e:
            logger.error(f"Error fetching Gamma markets: {e}")
            return []

    async def fetch_clob_markets(self) -> list[dict]:
        """Fetch markets from CLOB API."""
        try:
            url = f"{CLOB_API_BASE}/markets"
            async with self._session.get(url) as response:
                if response.status != 200:
                    logger.warning(f"CLOB API returned {response.status}")
                    return []
                data = await response.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"Error fetching CLOB markets: {e}")
            return []

    def extract_token_mappings(self, markets: list[dict]) -> list[dict]:
        """Extract token to market mappings from market data."""
        mappings = []

        for market in markets:
            condition_id = market.get("conditionId") or market.get("condition_id")
            if not condition_id:
                continue

            question = market.get("question") or market.get("title") or ""
            slug = market.get("slug") or market.get("market_slug") or ""
            end_date = market.get("endDate") or market.get("end_date_iso")

            # Handle different token field formats
            tokens = market.get("tokens") or market.get("clobTokenIds") or []

            if isinstance(tokens, list) and len(tokens) >= 2:
                # Format: [{"token_id": "...", "outcome": "Yes"}, ...]
                if isinstance(tokens[0], dict):
                    for token in tokens:
                        token_id = token.get("token_id") or token.get("tokenId")
                        outcome = token.get("outcome") or ""
                        outcome_index = token.get("outcome_index", 0)
                        if token_id:
                            mappings.append({
                                "token_id": token_id,
                                "condition_id": condition_id,
                                "outcome": outcome,
                                "outcome_index": outcome_index,
                                "market_slug": slug,
                                "question": question[:500] if question else None,
                                "end_date": end_date,
                                "updated_at": datetime.now(timezone.utc).isoformat()
                            })
                # Format: ["token_id_1", "token_id_2"]
                elif isinstance(tokens[0], str):
                    outcomes = ["Yes", "No"]
                    for i, token_id in enumerate(tokens[:2]):
                        mappings.append({
                            "token_id": token_id,
                            "condition_id": condition_id,
                            "outcome": outcomes[i] if i < len(outcomes) else f"Outcome {i}",
                            "outcome_index": i,
                            "market_slug": slug,
                            "question": question[:500] if question else None,
                            "end_date": end_date,
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        })

            # Also check for direct token fields
            token_yes = market.get("clobTokenIds", [None, None])[0] if isinstance(market.get("clobTokenIds"), list) else None
            token_no = market.get("clobTokenIds", [None, None])[1] if isinstance(market.get("clobTokenIds"), list) else None

            if token_yes and not any(m["token_id"] == token_yes for m in mappings):
                mappings.append({
                    "token_id": token_yes,
                    "condition_id": condition_id,
                    "outcome": "Yes",
                    "outcome_index": 0,
                    "market_slug": slug,
                    "question": question[:500] if question else None,
                    "end_date": end_date,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })

            if token_no and not any(m["token_id"] == token_no for m in mappings):
                mappings.append({
                    "token_id": token_no,
                    "condition_id": condition_id,
                    "outcome": "No",
                    "outcome_index": 1,
                    "market_slug": slug,
                    "question": question[:500] if question else None,
                    "end_date": end_date,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })

        return mappings

    async def sync_mappings(self, mappings: list[dict]) -> tuple[int, int]:
        """Upsert token mappings to database."""
        if not mappings:
            return 0, 0

        # Deduplicate by token_id
        seen = set()
        unique_mappings = []
        for m in mappings:
            if m["token_id"] not in seen:
                seen.add(m["token_id"])
                unique_mappings.append(m)

        # Batch upsert
        batch_size = 100
        total_upserted = 0
        errors = 0

        for i in range(0, len(unique_mappings), batch_size):
            batch = unique_mappings[i:i + batch_size]
            try:
                self.supabase.table("token_market_mapping").upsert(
                    batch,
                    on_conflict="token_id"
                ).execute()
                total_upserted += len(batch)
            except Exception as e:
                logger.error(f"Error upserting batch: {e}")
                errors += len(batch)

        return total_upserted, errors

    async def run(self, full_sync: bool = False) -> dict:
        """Run the token mapping sync."""
        logger.info("Starting token mapping sync...")

        all_markets = []

        # Fetch from CLOB API
        logger.info("Fetching markets from CLOB API...")
        clob_markets = await self.fetch_clob_markets()
        logger.info(f"Fetched {len(clob_markets)} markets from CLOB API")
        all_markets.extend(clob_markets)

        # Fetch from Gamma API (paginated)
        if full_sync:
            logger.info("Fetching all markets from Gamma API...")
            offset = 0
            limit = 100
            while True:
                gamma_markets = await self.fetch_gamma_markets(limit=limit, offset=offset)
                if not gamma_markets:
                    break
                all_markets.extend(gamma_markets)
                logger.info(f"Fetched {len(gamma_markets)} markets from Gamma API (offset {offset})")
                offset += limit
                await asyncio.sleep(0.5)  # Rate limiting
        else:
            # Just fetch first page
            gamma_markets = await self.fetch_gamma_markets(limit=100, offset=0)
            all_markets.extend(gamma_markets)
            logger.info(f"Fetched {len(gamma_markets)} markets from Gamma API")

        # Extract token mappings
        logger.info("Extracting token mappings...")
        mappings = self.extract_token_mappings(all_markets)
        logger.info(f"Extracted {len(mappings)} token mappings")

        # Sync to database
        logger.info("Syncing to database...")
        upserted, errors = await self.sync_mappings(mappings)

        result = {
            "markets_fetched": len(all_markets),
            "mappings_extracted": len(mappings),
            "mappings_upserted": upserted,
            "errors": errors
        }

        logger.info(f"Sync complete: {result}")
        return result


async def main():
    parser = argparse.ArgumentParser(description="Sync token to market mappings")
    parser.add_argument("--full", action="store_true", help="Fetch all markets (paginated)")
    args = parser.parse_args()

    async with TokenMappingSync() as sync:
        result = await sync.run(full_sync=args.full)
        print(f"\nSync complete!")
        print(f"  Markets fetched: {result['markets_fetched']}")
        print(f"  Mappings extracted: {result['mappings_extracted']}")
        print(f"  Mappings upserted: {result['mappings_upserted']}")
        print(f"  Errors: {result['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
