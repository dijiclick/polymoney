"""
Standalone metrics calculator - recalculates 7d/30d metrics for all wallets.

Run this script to update metrics without re-fetching trades:
    python -m scripts.run_metrics
"""

import asyncio
import logging
from datetime import datetime

from src.collectors import MetricsCalculator

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
    print("*" + "  WALLET METRICS CALCULATOR".center(58) + "*")
    print("*" + " " * 58 + "*")
    print("*" * 60)
    print()
    print(f"Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("Calculating 7d and 30d metrics (PnL, ROI, Win Rate)...")
    print()

    calculator = MetricsCalculator()

    last_print = [0]

    def progress(processed: int, total: int):
        if processed - last_print[0] >= 50 or processed == total:
            pct = (processed / total * 100) if total > 0 else 0
            print(f"  Progress: {processed}/{total} ({pct:.1f}%)")
            last_print[0] = processed

    result = await calculator.update_all_metrics(progress_callback=progress)

    # Summary
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    print()
    print("=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print()
    print(f"  Total wallets: {result['total']}")
    print(f"  Updated: {result['updated']}")
    print(f"  Skipped (no trades): {result['skipped']}")
    print(f"  Errors: {result['errors']}")
    print()
    print(f"  Duration: {duration:.1f}s")
    print(f"  Completed at: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
