"""
Goldsky Wallet Collector - extracts wallet addresses from blockchain transactions.

This script:
1. Scans Goldsky blockchain data for the last 30 days
2. Extracts unique wallet addresses from trade events
3. Stores wallets with source='goldsky'
"""

import asyncio
import logging
from datetime import datetime

from src.collectors import GoldskyWalletCollector

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def main():
    start_time = datetime.now()

    print()
    print("*" * 60)
    print("*" + " " * 58 + "*")
    print("*" + "  GOLDSKY WALLET COLLECTOR".center(58) + "*")
    print("*" + " " * 58 + "*")
    print("*" * 60)
    print()
    print(f"Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("Extracting wallet addresses from blockchain transactions...")
    print("Scanning the last 30 days of Polymarket trades...")
    print()

    collector = GoldskyWalletCollector()

    def progress(processed: int, total: int, new_wallets: int):
        pct = (processed / total * 100) if total > 0 else 0
        print(f"  Progress: {processed}/{total} ({pct:.1f}%) - {new_wallets} new wallets")

    result = await collector.collect(days=30, progress_callback=progress)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    minutes = int(duration // 60)
    seconds = int(duration % 60)

    print()
    print("=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print()
    print(f"  Total addresses found:  {result['total_addresses']}")
    print(f"  New wallets:            {result['new_wallets']}")
    print(f"  Updated wallets:        {result['updated_wallets']}")
    print(f"  Days scanned:           {result['days_scanned']}")
    print()
    print(f"  Duration: {minutes}m {seconds}s")
    print(f"  Completed at: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
