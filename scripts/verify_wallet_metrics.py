"""
Debug script to verify wallet metrics calculation.

Usage:
    python -m scripts.verify_wallet_metrics <wallet_address>

Metrics Formulas:
    - Realized PnL = sum of realizedPnl from closed-positions
    - Unrealized PnL = sum of cashPnl from open positions
    - Total PnL = Realized + Unrealized
    - Initial Capital = Current Balance - Total PnL
    - ROI = Total PnL / Initial Capital * 100
    - Win Rate = Wins / (Wins + Losses) * 100 (resolved trades only)
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
from src.scrapers.data_api import PolymarketDataAPI


async def verify_wallet(address: str):
    """Verify metrics calculation for a single wallet."""
    print("=" * 70)
    print(f"WALLET METRICS VERIFICATION")
    print(f"Address: {address}")
    print("=" * 70)

    async with PolymarketDataAPI() as api:
        # Step 1: Fetch all raw data
        print("\n[1] FETCHING RAW DATA FROM POLYMARKET API...")

        positions, closed_positions, balance_data, profile = await asyncio.gather(
            api.get_positions(address),
            api.get_closed_positions(address),
            api.get_total_balance(address),
            api.get_profile(address),
        )

        total_balance, position_value, usdc_cash = balance_data

        print(f"    Open positions: {len(positions)}")
        print(f"    Closed positions: {len(closed_positions)}")
        print(f"    Portfolio value (positions): ${position_value:,.2f}")
        print(f"    USDC cash balance: ${usdc_cash:,.2f}")
        print(f"    Total balance: ${total_balance:,.2f}")
        print(f"    Username: {profile.get('name') or profile.get('pseudonym') or 'N/A'}")

        # Step 2: Calculate realized PnL from CLOSED positions only
        print("\n[2] REALIZED PNL (from closed-positions endpoint)...")

        realized_pnl = 0
        total_bought_closed = 0
        wins = 0
        losses = 0

        for pos in closed_positions:
            pnl = float(pos.get("realizedPnl", 0))
            bought = float(pos.get("totalBought", 0))
            realized_pnl += pnl
            total_bought_closed += bought
            if pnl > 0:
                wins += 1
            else:
                losses += 1

        print(f"    Sum of realizedPnl: ${realized_pnl:,.2f}")
        print(f"    Sum of totalBought: ${total_bought_closed:,.2f}")
        print(f"    Winning positions: {wins}")
        print(f"    Losing positions: {losses}")

        # Step 3: Calculate unrealized PnL from OPEN positions only
        print("\n[3] UNREALIZED PNL (from positions endpoint)...")

        unrealized_pnl = 0
        total_initial_value = 0
        open_with_value = 0
        open_worthless = 0

        for pos in positions:
            pnl = float(pos.get("cashPnl", 0))
            initial = float(pos.get("initialValue", 0))
            current = float(pos.get("currentValue", 0))
            unrealized_pnl += pnl
            total_initial_value += initial
            if current > 0:
                open_with_value += 1
            else:
                open_worthless += 1

        print(f"    Sum of cashPnl: ${unrealized_pnl:,.2f}")
        print(f"    Sum of initialValue: ${total_initial_value:,.2f}")
        print(f"    Positions with value: {open_with_value}")
        print(f"    Positions worth $0: {open_worthless} (not yet resolved)")

        # Step 4: Calculate total PnL
        print("\n[4] TOTAL PNL CALCULATION...")

        total_pnl = realized_pnl + unrealized_pnl
        print(f"    Total PnL = Realized + Unrealized")
        print(f"    Total PnL = ${realized_pnl:,.2f} + (${unrealized_pnl:,.2f})")
        print(f"    Total PnL = ${total_pnl:,.2f}")

        # Step 5: Calculate initial capital
        print("\n[5] INITIAL CAPITAL CALCULATION...")

        initial_capital = total_balance - total_pnl
        print(f"    Initial Capital = Current Balance - Total PnL")
        print(f"    Initial Capital = ${total_balance:,.2f} - (${total_pnl:,.2f})")
        print(f"    Initial Capital = ${initial_capital:,.2f}")

        # Step 6: Calculate ROI
        print("\n[6] ROI CALCULATION...")

        if initial_capital > 0:
            roi = (total_pnl / initial_capital) * 100
            print(f"    ROI = Total PnL / Initial Capital * 100")
            print(f"    ROI = ${total_pnl:,.2f} / ${initial_capital:,.2f} * 100")
        elif total_pnl > 0 and total_bought_closed > 0:
            roi = (total_pnl / total_bought_closed) * 100
            print(f"    (Using totalBought as fallback since initial_capital <= 0)")
            print(f"    ROI = Total PnL / Total Bought * 100")
        elif total_pnl < 0 and total_balance == 0:
            roi = -100.0
            print(f"    (Lost everything, ROI = -100%)")
        else:
            roi = 0
            print(f"    (Cannot calculate ROI)")

        print(f"    ROI = {roi:.2f}%")

        # Step 7: Calculate win rate (RESOLVED trades only)
        print("\n[7] WIN RATE CALCULATION (resolved trades only)...")

        total_resolved = wins + losses
        if total_resolved > 0:
            win_rate = (wins / total_resolved) * 100
            print(f"    Win Rate = Wins / Resolved Trades * 100")
            print(f"    Win Rate = {wins} / {total_resolved} * 100")
        else:
            win_rate = 0
            print(f"    (No resolved trades)")

        print(f"    Win Rate = {win_rate:.2f}%")

        # Step 8: Breakdown of open positions
        print("\n[8] OPEN POSITIONS BREAKDOWN...")

        # Show positions with value > 0
        active_positions = [p for p in positions if float(p.get("currentValue", 0)) > 0]
        print(f"    Active positions (value > $0): {len(active_positions)}")
        for i, pos in enumerate(active_positions[:5]):
            current = float(pos.get("currentValue", 0))
            initial = float(pos.get("initialValue", 0))
            pnl = float(pos.get("cashPnl", 0))
            print(f"      {i+1}. {pos.get('outcome', 'N/A')}: ${current:,.2f} (bought: ${initial:,.2f}, pnl: ${pnl:,.2f})")

        # Step 9: Summary and comparison
        print("\n" + "=" * 70)
        print("FINAL CALCULATED METRICS (Our System):")
        print("=" * 70)
        print(f"    Balance: ${total_balance:,.2f}")
        print(f"    Realized PnL: ${realized_pnl:,.2f}")
        print(f"    Unrealized PnL: ${unrealized_pnl:,.2f}")
        print(f"    Total PnL: ${total_pnl:,.2f}")
        print(f"    Initial Capital: ${initial_capital:,.2f}")
        print(f"    ROI: {roi:.2f}%")
        print(f"    Win Rate: {win_rate:.2f}% (from {total_resolved} resolved trades)")
        print(f"    Closed Positions: {len(closed_positions)}")
        print(f"    Open Positions: {len(positions)} ({open_with_value} active, {open_worthless} worthless)")
        print("=" * 70)

        print("\n[NOTE] Polymarket website may show different P&L values because:")
        print("    - They might use a different calculation formula")
        print("    - They might not include all unrealized losses")
        print("    - Data refresh timing differences")


async def main():
    load_dotenv()

    if len(sys.argv) < 2:
        # Default test wallet: @yehuangz
        address = "0xba9c90eb69f83b3287773549b01cec7c5eacd2c1"
        print(f"Usage: python -m scripts.verify_wallet_metrics <wallet_address>")
        print(f"Using default test address (@yehuangz): {address}")
    else:
        address = sys.argv[1]

    await verify_wallet(address)


if __name__ == "__main__":
    asyncio.run(main())
