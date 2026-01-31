# AGENT INSTRUCTIONS

When working on this project, if you discover important context, patterns, gotchas, or design decisions that would help future sessions, suggest adding them to this file. This is a living document — keep it accurate and useful.

---

# Polymarket Trade Analytics

Standalone Node.js (ESM) system that discovers Polymarket traders in real-time and builds a complete trade history database from the Activity API.

## Goal

Collect clean, granular trade data so any metric, ratio, or report can be computed from stored data at query time. The system prioritizes **data structure over features** — when the data is right, analytics are just SQL.

## Architecture

```
RTDS WebSocket (live trades)
       │
       ▼
  live-sync.js ── discovers wallets from trades >= $100
       │
       ▼
  sync-wallet.js ── fetches Activity API → builds trades → stores in Supabase
       │
       ▼
  Supabase (wallets_new, trades, activities)
       │
       ▼
  Dashboard (Next.js) ── reads from Supabase, has its own sync route
```

## Folder Structure

```
new/
├── lib/
│   ├── supabase.js        ── Supabase client, loads .env from new/.env
│   ├── activity-api.js    ── Polymarket Activity API client (pagination, incremental fetch)
│   ├── trade-builder.js   ── Trade state machine (VWAP, PnL, share tracking)
│   ├── metrics.js         ── Wallet-level metric aggregation
│   ├── rtds-client.js     ── WebSocket client for live trade stream
│   └── utils.js           ── Address validation, formatting helpers
├── scripts/
│   ├── add-wallet.js      ── Manually add a wallet to tracking
│   ├── sync-wallet.js     ── Sync single wallet (core logic, also exported)
│   ├── sync-all.js        ── Batch sync all wallets (with concurrency)
│   └── live-sync.js       ── Main production script: RTDS discovery + continuous sync
├── db/
│   ├── schema.sql         ── Full table definitions (reference)
│   └── migration_001_enriched_data.sql ── VWAP + profit_factor columns
├── package.json           ── ESM ("type": "module"), deps: supabase-js, ws, dotenv
└── .env                   ── SUPABASE_URL, SUPABASE_KEY, MAX_FETCH_DAYS, MAX_TRADES_PER_WALLET
```

## Database Tables

### wallets_new
Primary wallet tracking. Metrics are pre-computed on each sync.

| Column | Type | Purpose |
|--------|------|---------|
| address | TEXT PK | Ethereum address (lowercase) |
| username | TEXT | Optional Polymarket username |
| total_pnl | NUMERIC(14,2) | Sum of closed trade PnL |
| total_roi | NUMERIC(10,4) | (totalPnl / totalVolumeBought) * 100 |
| win_rate | NUMERIC(6,2) | (wins / closedTrades) * 100 |
| profit_factor | NUMERIC(8,2) | grossWins / abs(grossLosses), cap 10.0 |
| open_trade_count | INT | Currently open trades |
| closed_trade_count | INT | Completed trades |
| total_volume_bought | NUMERIC(14,2) | All USDC spent |
| total_volume_sold | NUMERIC(14,2) | All USDC received |
| avg_hold_duration_hours | NUMERIC(10,2) | Mean trade duration |
| metrics_updated_at | BIGINT | Unix seconds when metrics last computed |
| last_activity_timestamp | BIGINT | For incremental sync (fetch only newer) |
| last_synced_at | TIMESTAMPTZ | Last successful sync |

### trades
One row per entry-to-exit cycle per market. Re-entries create new rows.

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL PK | Auto ID |
| wallet_address | TEXT FK | → wallets_new |
| condition_id | TEXT | Polymarket market ID |
| market_title, market_slug | TEXT | Market metadata |
| primary_outcome | TEXT | "Yes" or "No" (initial position side) |
| yes_shares, no_shares | NUMERIC(18,6) | Current share counts |
| closed | BOOLEAN | All shares = 0 |
| open_timestamp, close_timestamp | TIMESTAMPTZ | Trade lifecycle |
| number_of_buys, number_of_sells | INT | Transaction counts |
| total_volume_bought, total_volume_sold | NUMERIC(14,2) | USDC in/out |
| avg_entry_price, avg_exit_price | NUMERIC(10,6) | VWAP prices |
| roi, pnl | NUMERIC | Performance |
| profit_pct | NUMERIC(10,4) | (pnl / volume_bought) * 100 |

### activities
Raw activity audit log. Every TRADE and REDEEM event stored.

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL PK | Auto ID |
| wallet_address | TEXT FK | → wallets_new |
| condition_id | TEXT | Market ID |
| transaction_hash | TEXT | Blockchain tx hash |
| timestamp | BIGINT | Unix seconds |
| type | TEXT | "TRADE" or "REDEEM" |
| side | TEXT | "BUY" or "SELL" |
| outcome | TEXT | "Yes" or "No" |
| size, price, usdc_size | NUMERIC | Trade details |
| UNIQUE(wallet_address, transaction_hash, condition_id, side, outcome) |

## Key Design Decisions

### REDEEM = SELL
Market resolution payouts (REDEEM events) are treated identically to sells. They appear in the Activity API with positive USDC value and flow through the existing effective-side logic. No special columns needed.

### Opposite-side buys = SELL
Buying the opposite outcome of the primary position is an effective sell. The `primary_outcome` field determines which side is "entry" and which is "exit":
```
effectiveSide = (activity.side === 'BUY')
  ? (outcome === primary_outcome ? 'BUY' : 'SELL')
  : (outcome === primary_outcome ? 'SELL' : 'BUY')
```

### PnL = volume_sold - volume_bought
Because REDEEMs and opposite-direction buys both count as sells (adding to `total_volume_sold`), PnL is simply the difference between USDC received and USDC spent.

### No balance/profile/positions API
The system tracks realized PnL only from trade history. No account-level ROI, no unrealized PnL, no current_price columns.

### Time-period metrics at query time
7d/30d/all-time metrics are NOT stored as columns. Filter trades by `close_timestamp` at query time instead.

### Incremental sync
`last_activity_timestamp` tracks where we left off. Activity API returns newest-first, so we stop pagination when we hit data older than this timestamp.

### VWAP (Volume-Weighted Average Price)
Entry and exit prices are tracked using running accumulators (`totalEntryShares`, `totalExitShares`) that are NOT stored in DB. They're reconstructed from `total_volume_bought / avg_entry_price` when loading open trades.

```
new_avg = (old_avg * old_shares + price * new_shares) / (old_shares + new_shares)
```

### Trade closure
A trade closes when `yes_shares == 0 AND no_shares == 0`. Any new activity on the same `condition_id` after closure creates a new trade row.

## External APIs

### Activity API
- **URL**: `https://data-api.polymarket.com/activity?user={address}&limit=50&offset={offset}`
- Returns: timestamp, type, conditionId, size, price, side, usdcSize, title, slug, outcome, transactionHash
- Pagination: 50 per page, newest-first
- Types: TRADE, REDEEM (we filter for these two)

### RTDS WebSocket
- **URL**: `wss://ws-live-data.polymarket.com`
- Subscribe: `{ action: "subscribe", subscriptions: [{ topic: "activity", type: "trades" }] }`
- Broadcasts all Polymarket trades in real-time
- Used only for wallet discovery (trades >= $100)
- Heartbeat: ping every 30s, reconnect on 120s stale timeout

## Running

```bash
# Add a wallet manually
node scripts/add-wallet.js 0x...

# Sync one wallet
node scripts/sync-wallet.js 0x...

# Sync all tracked wallets (with optional concurrency)
node scripts/sync-all.js 3

# Production: live discovery + continuous sync
node scripts/live-sync.js --workers=3 --cooldown=60
```

## Dashboard Integration

The Next.js dashboard at `dashboard/` has its own sync route at `dashboard/app/api/new/sync/route.ts` that mirrors the trade-builder logic (VWAP, REDEEM, profit_pct, profit_factor). This route is self-contained — no imports from `new/`. The dashboard reads from the same Supabase tables (wallets_new, trades, activities).

## What the stored data enables (query-time metrics)

| Metric | How |
|--------|-----|
| Equity curve / Drawdown | `SELECT pnl, close_timestamp FROM trades WHERE closed ORDER BY close_timestamp` |
| Difficulty-weighted win rate | `SUM(1 - avg_entry_price WHERE pnl > 0) / SUM(1 - avg_entry_price)` |
| Weekly profit rate | Group trades by ISO week of close_timestamp |
| Median profit % | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY profit_pct)` |
| Max single loss % | `MIN(profit_pct) WHERE closed AND pnl < 0` |
| Copy score | Combine profit_factor + weekly_profit_rate + drawdown + trade_count + median_profit_pct |
| 7d/30d stats | Filter by `close_timestamp >= now() - interval 'N days'` |
| Profit factor per period | Group closed trades by period, compute grossWins/grossLosses |
