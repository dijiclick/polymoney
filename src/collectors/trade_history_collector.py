"""Trade history collector - fetches and stores raw trade data for qualified wallets."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Callable

from ..scrapers.data_api import PolymarketDataAPI
from ..database.supabase import get_supabase_client

logger = logging.getLogger(__name__)


class TradeHistoryCollector:
    """
    Collects raw trade history for qualified wallets.

    Fetches activity from Polymarket API and stores in wallet_trades table.
    Only processes wallets with balance >= $200.
    """

    MIN_BALANCE = 200

    def __init__(self):
        self.db = get_supabase_client()
        self.api = PolymarketDataAPI()

    async def collect_for_qualified_wallets(
        self,
        min_balance: float = 200,
        concurrency: int = 5,
        progress_callback: Optional[Callable[[int, int, int], None]] = None
    ) -> dict:
        """
        Collect trade history for all qualified wallets.

        Args:
            min_balance: Minimum balance threshold
            concurrency: Number of concurrent API requests
            progress_callback: Optional callback(processed, total, trades_stored)

        Returns:
            Summary dict with counts
        """
        wallets = self.db.get_qualified_wallets(min_balance=min_balance)
        total = len(wallets)

        logger.info(f"Collecting trade history for {total} qualified wallets (balance >= ${min_balance})")

        return await self._collect_trades(
            wallets=wallets,
            concurrency=concurrency,
            progress_callback=progress_callback
        )

    async def collect_for_wallet(self, address: str) -> dict:
        """Collect trade history for a single wallet."""
        wallet = self.db.get_wallet(address)
        if not wallet:
            return {"error": "Wallet not found"}

        return await self._collect_trades(
            wallets=[wallet],
            concurrency=1
        )

    async def collect_for_source(
        self,
        source: str,
        min_balance: float = 200,
        concurrency: int = 5,
        progress_callback: Optional[Callable[[int, int, int], None]] = None
    ) -> dict:
        """Collect trade history for wallets from a specific source."""
        wallets = self.db.get_qualified_wallets_by_source(
            source=source,
            min_balance=min_balance
        )
        total = len(wallets)

        logger.info(f"Collecting trades for {total} {source} wallets (balance >= ${min_balance})")

        return await self._collect_trades(
            wallets=wallets,
            concurrency=concurrency,
            progress_callback=progress_callback
        )

    async def _collect_trades(
        self,
        wallets: list[dict],
        concurrency: int = 5,
        progress_callback: Optional[Callable[[int, int, int], None]] = None
    ) -> dict:
        """Internal method to collect trades for a list of wallets."""
        total = len(wallets)
        processed = 0
        total_trades = 0
        wallets_with_trades = 0
        failed = 0

        semaphore = asyncio.Semaphore(concurrency)

        async def collect_one(wallet: dict):
            nonlocal processed, total_trades, wallets_with_trades, failed

            address = wallet["address"]

            async with semaphore:
                try:
                    async with self.api:
                        # Fetch activity with type=TRADE filter
                        activity = await self.api.get_activity(address)

                    # Filter to only TRADE type
                    trades = [a for a in activity if a.get("type") == "TRADE"]

                    if trades:
                        wallets_with_trades += 1

                        # Store each trade
                        for trade in trades:
                            trade_data = self._parse_trade(address, trade)
                            self.db.upsert_wallet_trade(trade_data)
                            total_trades += 1

                except Exception as e:
                    logger.error(f"Error collecting trades for {address}: {e}")
                    failed += 1

                processed += 1

                if progress_callback and processed % 5 == 0:
                    progress_callback(processed, total, total_trades)

        # Process in batches
        batch_size = 20
        for i in range(0, len(wallets), batch_size):
            batch = wallets[i:i + batch_size]
            tasks = [collect_one(w) for w in batch]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Rate limit between batches
            await asyncio.sleep(2)

        summary = {
            "total_wallets": total,
            "processed": processed,
            "wallets_with_trades": wallets_with_trades,
            "total_trades_stored": total_trades,
            "failed": failed
        }

        logger.info(f"Trade collection complete: {summary}")
        return summary

    def _parse_trade(self, address: str, raw: dict) -> dict:
        """Parse raw trade data into database format."""
        # Extract timestamp
        timestamp = raw.get("timestamp")
        if isinstance(timestamp, (int, float)):
            executed_at = datetime.fromtimestamp(timestamp).isoformat()
        elif isinstance(timestamp, str):
            executed_at = timestamp
        else:
            executed_at = datetime.utcnow().isoformat()

        return {
            "address": address.lower(),
            "trade_id": raw.get("id") or raw.get("transactionHash"),
            "condition_id": raw.get("conditionId"),
            "market_slug": raw.get("slug"),
            "market_title": raw.get("title"),
            "event_slug": raw.get("eventSlug"),
            "category": raw.get("category"),
            "side": raw.get("side", "").upper(),
            "outcome": raw.get("outcome"),
            "outcome_index": raw.get("outcomeIndex"),
            "size": float(raw.get("size", 0) or 0),
            "price": float(raw.get("price", 0) or 0),
            "usd_value": float(raw.get("usdcSize", 0) or raw.get("usdValue", 0) or 0),
            "executed_at": executed_at,
            "tx_hash": raw.get("transactionHash"),
            "raw_data": raw,
            "created_at": datetime.utcnow().isoformat()
        }

    async def get_trade_counts(self) -> dict:
        """Get statistics about stored trades."""
        stats = self.db.get_wallet_trade_stats()
        return stats

    async def refresh_trades_for_wallet(
        self,
        address: str,
        days: int = 30
    ) -> dict:
        """
        Refresh trades for a single wallet.

        Deletes existing trades and re-fetches from API.
        """
        # Delete existing trades
        self.db.delete_wallet_trades(address)

        # Collect fresh trades
        wallet = self.db.get_wallet(address)
        if not wallet:
            return {"error": "Wallet not found"}

        return await self._collect_trades(wallets=[wallet], concurrency=1)
