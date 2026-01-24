"""Run leaderboard wallet collector."""

import asyncio
import logging
from src.collectors import LeaderboardWalletCollector

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

async def main():
    print("=" * 60)
    print("  POLYMARKET LEADERBOARD COLLECTOR")
    print("=" * 60)
    print()
    print("Fetching top 1000 traders from all 10 categories...")
    print()

    collector = LeaderboardWalletCollector()

    def progress(category: str, current: int, total: int):
        print(f"  [{current}/{total}] Processed: {category}")

    result = await collector.collect(limit_per_category=1000, progress_callback=progress)

    print()
    print("=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print(f"  Total entries fetched: {result['total_entries']}")
    print(f"  New wallets: {result['new_wallets']}")
    print(f"  Updated wallets: {result['updated_wallets']}")
    print(f"  Rankings stored: {result['rankings_stored']}")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
