"""
Combined collector - full wallet analytics pipeline.

This script:
1. Fetches top 1000 traders from all 10 leaderboard categories
2. Updates portfolio values for all wallets
3. Fetches trade history for qualified wallets (portfolio >= $200)
4. Metrics (PnL, ROI, Win Rate) calculated from trade data in dashboard
"""

import asyncio
import logging
from datetime import datetime

from src.collectors import LeaderboardWalletCollector, BalanceUpdater, TradeHistoryCollector

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def run_leaderboard():
    """Step 1: Collect wallets from leaderboard."""
    print()
    print("=" * 60)
    print("  STEP 1: LEADERBOARD COLLECTION")
    print("=" * 60)
    print()
    print("Fetching top 1000 traders from all 10 categories...")
    print()

    collector = LeaderboardWalletCollector()

    def progress(category: str, current: int, total: int):
        print(f"  [{current}/{total}] {category}")

    result = await collector.collect(
        limit_per_category=1000,
        progress_callback=progress
    )

    print()
    print(f"  Total entries: {result['total_entries']}")
    print(f"  New wallets: {result['new_wallets']}")
    print(f"  Updated wallets: {result['updated_wallets']}")

    return result


async def run_balance_update():
    """Step 2: Update portfolio values for all wallets."""
    print()
    print("=" * 60)
    print("  STEP 2: PORTFOLIO VALUE UPDATE")
    print("=" * 60)
    print()
    print("Fetching portfolio values from Polymarket API...")
    print()

    updater = BalanceUpdater()

    last_print = [0]

    def progress(processed: int, total: int):
        if processed - last_print[0] >= 50 or processed == total:
            pct = (processed / total * 100) if total > 0 else 0
            print(f"  Progress: {processed}/{total} ({pct:.1f}%)")
            last_print[0] = processed

    result = await updater.update_all_balances(
        concurrency=10,
        progress_callback=progress
    )

    print()
    print(f"  Updated: {result['updated']}")
    print(f"  Failed: {result['failed']}")
    print(f"  Qualified ($200+): {result['qualified_200']}")

    return result


async def run_trade_collection(min_balance: float = 200):
    """Step 3: Fetch trade history for qualified wallets."""
    print()
    print("=" * 60)
    print("  STEP 3: TRADE HISTORY COLLECTION")
    print("=" * 60)
    print()
    print(f"Fetching trades for wallets with portfolio >= ${min_balance}...")
    print()

    collector = TradeHistoryCollector()

    last_print = [0]

    def progress(processed: int, total: int, trades: int):
        if processed - last_print[0] >= 10 or processed == total:
            pct = (processed / total * 100) if total > 0 else 0
            print(f"  Progress: {processed}/{total} ({pct:.1f}%) - {trades} trades")
            last_print[0] = processed

    result = await collector.collect_for_qualified_wallets(
        min_balance=min_balance,
        concurrency=5,
        progress_callback=progress
    )

    print()
    print(f"  Wallets processed: {result['processed']}")
    print(f"  Wallets with trades: {result['wallets_with_trades']}")
    print(f"  Total trades stored: {result['total_trades_stored']}")
    print(f"  Failed: {result['failed']}")

    return result


async def main():
    start_time = datetime.now()

    print()
    print("*" * 60)
    print("*" + " " * 58 + "*")
    print("*" + "  POLYMARKET WALLET ANALYTICS".center(58) + "*")
    print("*" + " " * 58 + "*")
    print("*" * 60)
    print()
    print(f"Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Step 1: Collect from leaderboard
    leaderboard_result = await run_leaderboard()

    # Step 2: Update portfolio values
    balance_result = await run_balance_update()

    # Step 3: Fetch trade history for qualified wallets
    trade_result = await run_trade_collection(min_balance=200)

    # Summary
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    minutes = int(duration // 60)
    seconds = int(duration % 60)

    print()
    print("=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)
    print()
    print(f"  Leaderboard entries:    {leaderboard_result['total_entries']}")
    print(f"  New wallets found:      {leaderboard_result['new_wallets']}")
    print(f"  Portfolio values set:   {balance_result['updated']}")
    print(f"  Qualified wallets:      {balance_result['qualified_200']}")
    print(f"  Trades collected:       {trade_result['total_trades_stored']}")
    print()
    print(f"  Duration: {minutes}m {seconds}s")
    print(f"  Completed at: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
