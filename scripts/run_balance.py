"""Run balance updater to fetch portfolio values for all wallets."""

import asyncio
import logging
from src.collectors import BalanceUpdater

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

async def main():
    print("=" * 60)
    print("  POLYMARKET BALANCE UPDATER")
    print("=" * 60)
    print()
    print("Fetching portfolio values for all wallets...")
    print()

    updater = BalanceUpdater()

    def progress(processed: int, total: int):
        pct = (processed / total * 100) if total > 0 else 0
        print(f"  Progress: {processed}/{total} ({pct:.1f}%)")

    result = await updater.update_all_balances(
        concurrency=10,
        progress_callback=progress
    )

    print()
    print("=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print(f"  Total wallets: {result['total']}")
    print(f"  Updated: {result['updated']}")
    print(f"  Failed: {result['failed']}")
    print(f"  Qualified ($200+): {result['qualified_200']}")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
