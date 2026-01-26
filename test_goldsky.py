"""Test Goldsky data for a wallet."""
import os
from dotenv import load_dotenv
load_dotenv()

from supabase import create_client

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

wallet = "0xc92fe1c5f324c58d0be12b8728be18a92375361f"

print("=" * 60)
print("GOLDSKY DATA (from local Supabase tables)")
print("=" * 60)

# 1. User Positions - use eq instead of ilike for faster query
print("\n[1] goldsky_user_positions:")
try:
    # Try with lowercase wallet
    wallet_lower = wallet.lower()
    positions = supabase.table("goldsky_user_positions").select("*").eq("user", wallet_lower).execute()
    print(f"   Found {len(positions.data)} positions")
    if positions.data:
        # Scale values if needed (Goldsky uses raw integers)
        SCALE = 1_000_000
        total_pnl = 0
        total_bought = 0
        for p in positions.data:
            pnl = float(p.get("realized_pnl", 0) or 0)
            bought = float(p.get("total_bought", 0) or 0)
            # Scale if large values
            if abs(pnl) > 1_000_000_000:
                pnl = pnl / SCALE
            if bought > 1_000_000_000:
                bought = bought / SCALE
            total_pnl += pnl
            total_bought += bought

        wins = sum(1 for p in positions.data if float(p.get("realized_pnl", 0) or 0) > 0)
        losses = sum(1 for p in positions.data if float(p.get("realized_pnl", 0) or 0) < 0)
        print(f"   Total realized PnL: ${total_pnl:,.2f}")
        print(f"   Total bought: ${total_bought:,.2f}")
        print(f"   Wins: {wins}, Losses: {losses}")
        if wins + losses > 0:
            print(f"   Win rate: {wins/(wins+losses)*100:.1f}%")
        if total_bought > 0:
            print(f"   ROI: {(total_pnl/total_bought)*100:.1f}%")
    else:
        # Check total records in table
        count = supabase.table("goldsky_user_positions").select("id", count="exact").limit(1).execute()
        print(f"   (Table has {count.count} total records)")
except Exception as e:
    print(f"   Error: {e}")

# 2. User Balances
print("\n[2] goldsky_user_balances:")
try:
    balances = supabase.table("goldsky_user_balances").select("*").ilike("user", wallet).execute()
    print(f"   Found {len(balances.data)} token balances")
    if balances.data:
        for b in balances.data[:5]:
            asset = b.get("asset", "")[:30] if b.get("asset") else "N/A"
            balance = float(b.get("balance", 0) or 0)
            print(f"   - {asset}... : {balance:,.2f}")
except Exception as e:
    print(f"   Error: {e}")

# 3. Order Fills
print("\n[3] goldsky_order_filled:")
try:
    fills_maker = supabase.table("goldsky_order_filled").select("*").ilike("maker", wallet).limit(100).execute()
    fills_taker = supabase.table("goldsky_order_filled").select("*").ilike("taker", wallet).limit(100).execute()
    total_fills = len(fills_maker.data) + len(fills_taker.data)
    print(f"   Found {total_fills} order fills (maker: {len(fills_maker.data)}, taker: {len(fills_taker.data)})")
except Exception as e:
    print(f"   Error: {e}")

print("\n" + "=" * 60)
print("POLYMARKET API DATA (for comparison)")
print("=" * 60)

import asyncio
import aiohttp

async def get_polymarket_data():
    BASE = "https://data-api.polymarket.com"
    async with aiohttp.ClientSession() as session:
        # Profile - gamma API
        print("\n[1] /public-profile (gamma API):")
        async with session.get(f"https://gamma-api.polymarket.com/public-profile", params={"address": wallet}) as resp:
            if resp.status == 200:
                data = await resp.json()
                print(f"   Username: {data.get('name') or data.get('pseudonym', 'N/A')}")
            else:
                print(f"   Status: {resp.status}")

        # Portfolio value (positions only)
        print("\n[2] /value (positions only):")
        async with session.get(f"{BASE}/value", params={"user": wallet}) as resp:
            if resp.status == 200:
                data = await resp.json()
                if isinstance(data, list) and len(data) > 0:
                    position_value = float(data[0].get('value', 0))
                    print(f"   Position value: ${position_value:,.2f}")
                else:
                    position_value = 0
                    print(f"   Position value: $0.00")
            else:
                position_value = 0
                print(f"   Status: {resp.status}")

        # USDC Balance via Polygon RPC
        print("\n[2b] USDC Balance (via Polygon RPC):")
        USDC_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
        address_padded = wallet.lower().replace("0x", "").zfill(64)
        data_hex = f"0x70a08231{address_padded}"
        payload = {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"to": USDC_CONTRACT, "data": data_hex}, "latest"],
            "id": 1
        }
        async with session.post("https://polygon-rpc.com", json=payload) as resp:
            usdc_balance = 0
            if resp.status == 200:
                result = await resp.json()
                if "result" in result and result["result"]:
                    balance_raw = int(result["result"], 16)
                    usdc_balance = balance_raw / 1_000_000  # 6 decimals
                    print(f"   USDC cash: ${usdc_balance:.2f}")
            else:
                print(f"   Error fetching USDC balance")

        total_balance = position_value + usdc_balance
        print(f"\n[2c] TOTAL BALANCE: ${total_balance:.2f} (positions: ${position_value:.2f} + USDC: ${usdc_balance:.2f})")

        # Positions
        print("\n[3] /positions:")
        async with session.get(f"{BASE}/positions", params={"user": wallet, "limit": 100}) as resp:
            if resp.status == 200:
                data = await resp.json()
                print(f"   Open positions: {len(data)}")
                if data:
                    for p in data[:3]:
                        print(f"   - {p.get('title', p.get('conditionId', 'N/A'))[:40]}...")
            else:
                print(f"   Status: {resp.status}")

        # Closed positions
        print("\n[4] /closed-positions:")
        async with session.get(f"{BASE}/closed-positions", params={"user": wallet, "limit": 100}) as resp:
            if resp.status == 200:
                data = await resp.json()
                print(f"   Closed positions: {len(data)}")
                if data:
                    # Show ALL fields for first position to find timestamp
                    print("\n   ALL fields in first position:")
                    if data:
                        for k, v in sorted(data[0].items()):
                            print(f"       {k}: {v}")

                    pm_pnl = sum(float(p.get("realizedPnl", 0)) for p in data)
                    pm_bought = sum(float(p.get("totalBought", 0) or 0) for p in data)

                    # Also calculate using initialValue if available
                    pm_initial = sum(float(p.get("initialValue", 0) or 0) for p in data)

                    wins = sum(1 for p in data if float(p.get("realizedPnl", 0)) > 0)
                    losses = sum(1 for p in data if float(p.get("realizedPnl", 0)) < 0)

                    print(f"\n   Summary:")
                    print(f"   Total realized PnL: ${pm_pnl:,.2f}")
                    print(f"   Total bought (volume): ${pm_bought:,.2f}")
                    print(f"   Total initialValue: ${pm_initial:,.2f}")
                    print(f"   Wins: {wins}, Losses: {losses}")
                    if wins + losses > 0:
                        print(f"   Win rate: {wins/(wins+losses)*100:.1f}%")

                    # Use total_balance (positions + USDC) calculated earlier
                    # Method 1: Initial Capital = Current Balance - PnL
                    initial_capital_1 = total_balance - pm_pnl

                    # Method 2: Use initialValue sum (if available)
                    initial_capital_2 = pm_initial if pm_initial > 0 else initial_capital_1

                    print(f"\n   ROI Calculations:")
                    print(f"   Current Balance (total): ${total_balance:.2f}")
                    print(f"   Initial Capital (balance-pnl): ${initial_capital_1:.2f}")
                    print(f"   Initial Capital (initialValue): ${initial_capital_2:.2f}")

                    if initial_capital_1 > 0:
                        roi1 = (pm_pnl / initial_capital_1) * 100
                        print(f"   ROI (method 1): {roi1:.1f}%")

                    if initial_capital_2 > 0:
                        roi2 = (pm_pnl / initial_capital_2) * 100
                        print(f"   ROI (method 2): {roi2:.1f}%")

                    # Calculate max drawdown
                    print(f"\n   Drawdown calculation:")
                    # Use 'timestamp' field (Unix timestamp), not 'resolvedAt'
                    sorted_positions = sorted(
                        [p for p in data if p.get("timestamp")],
                        key=lambda p: p.get("timestamp") or 0
                    )
                    print(f"   Positions with timestamp: {len(sorted_positions)}")

                    # Use user's actual initial capital
                    USER_INITIAL = 9.30  # User confirmed this amount
                    balance = USER_INITIAL
                    peak = USER_INITIAL
                    max_drawdown = 0
                    print(f"\n   Balance timeline (starting at ${USER_INITIAL:.2f}):")
                    for i, p in enumerate(sorted_positions[:10]):  # Show first 10
                        pnl = float(p.get("realizedPnl", 0))
                        balance += pnl
                        if balance > peak:
                            peak = balance
                        dd = ((peak - balance) / peak) * 100 if peak > 0 else 0
                        if dd > max_drawdown:
                            max_drawdown = dd
                        print(f"   [{i+1}] PnL: ${pnl:+.2f} -> Balance: ${balance:.2f} (peak: ${peak:.2f}, DD: {dd:.1f}%)")

                    # Continue calculation for remaining positions
                    for p in sorted_positions[10:]:
                        pnl = float(p.get("realizedPnl", 0))
                        balance += pnl
                        if balance > peak:
                            peak = balance
                        dd = ((peak - balance) / peak) * 100 if peak > 0 else 0
                        if dd > max_drawdown:
                            max_drawdown = dd

                    print(f"\n   Final: Balance=${balance:.2f}, Peak=${peak:.2f}")
                    print(f"   Max Drawdown: {max_drawdown:.1f}%")
            else:
                print(f"   Status: {resp.status}")

asyncio.run(get_polymarket_data())

print("\n" + "=" * 60)
print("SUMMARY - Data Source Comparison")
print("=" * 60)
print("\nGoldsky Mode uses:")
print("  - goldsky_user_positions  -> realized PnL, total bought, win/loss")
print("  - goldsky_user_balances   -> current holdings (for NAV)")
print("  - goldsky_order_filled    -> trade timeline (7d/30d metrics)")
print("  - Polymarket /profile     -> username only")
print("\nPolymarket Mode uses:")
print("  - /closed-positions       -> realized PnL")
print("  - /positions              -> open positions")
print("  - /portfolio-value        -> current NAV")
print("  - /profile                -> username")
