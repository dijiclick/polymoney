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

        # Portfolio value
        print("\n[2] /value:")
        async with session.get(f"{BASE}/value", params={"user": wallet}) as resp:
            if resp.status == 200:
                data = await resp.json()
                if isinstance(data, list) and len(data) > 0:
                    print(f"   Portfolio value: ${float(data[0].get('value', 0)):,.2f}")
                else:
                    print(f"   Data: {data}")
            else:
                print(f"   Status: {resp.status}")

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
                    pm_pnl = sum(float(p.get("realizedPnl", 0)) for p in data)
                    pm_bought = sum(float(p.get("totalBought", 0) or 0) for p in data)
                    wins = sum(1 for p in data if float(p.get("realizedPnl", 0)) > 0)
                    losses = sum(1 for p in data if float(p.get("realizedPnl", 0)) < 0)
                    print(f"   Total realized PnL: ${pm_pnl:,.2f}")
                    print(f"   Total bought: ${pm_bought:,.2f}")
                    print(f"   Wins: {wins}, Losses: {losses}")
                    if wins + losses > 0:
                        print(f"   Win rate: {wins/(wins+losses)*100:.1f}%")
                    # Get portfolio value for ROI calculation
                    async with session.get(f"{BASE}/value", params={"user": wallet}) as val_resp:
                        portfolio_val = 0
                        if val_resp.status == 200:
                            val_data = await val_resp.json()
                            if isinstance(val_data, list) and len(val_data) > 0:
                                portfolio_val = float(val_data[0].get('value', 0))
                    # ROI = PnL / Initial Capital, where Initial Capital = Current Balance - PnL
                    initial_capital = portfolio_val - pm_pnl
                    if initial_capital > 0:
                        roi = (pm_pnl / initial_capital) * 100
                    elif pm_pnl < 0 and portfolio_val == 0:
                        roi = -100.0  # Lost everything
                    else:
                        roi = 0
                    print(f"   Initial Capital: ${initial_capital:.2f}")
                    print(f"   ROI: {roi:.1f}%")
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
