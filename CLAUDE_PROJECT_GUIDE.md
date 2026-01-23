# Polymarket Profile Finder & Copy Trading System

## Project Overview

A complete system for detecting insider traders on Polymarket and copy trading profitable wallets in real-time.

**Repository:** https://github.com/dijiclick/polymoney
**Dashboard:** https://polymoney-one.vercel.app

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  Next.js Dashboard (Vercel) - polymoney-one.vercel.app          │
│  - Live Trade Monitor                                           │
│  - Insider Detection Panel                                      │
│  - Trader Profiles                                              │
│  - Copy Trade Management                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                 │
│  - PostgreSQL Database                                          │
│  - Realtime subscriptions (WebSocket)                           │
│  - Tables: traders, live_trades, trade_alerts, watchlist        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND SERVICES                             │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  Real-time Monitor  │    │   Copy Trading      │            │
│  │  (run_live.ps1)     │    │   (run_copy_        │            │
│  │                     │    │    trading.ps1)     │            │
│  │  - RTDS WebSocket   │    │                     │            │
│  │  - Insider detection│    │  - Paper trading    │            │
│  │  - Whale alerts     │    │  - Live execution   │            │
│  │  - Trade storage    │    │  - Risk management  │            │
│  └─────────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      POLYMARKET                                 │
│  - RTDS WebSocket (wss://ws-live-data.polymarket.com)           │
│  - CLOB API (order execution)                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
E:\Doing\polymarket\
├── .env                      # Environment variables (secrets)
├── .env.example              # Template for .env
├── config.yaml               # Application configuration
├── run_live.ps1              # Start real-time trade monitor
├── run_copy_trading.ps1      # Start copy trading service
├── run_copy_trading.bat      # Alternative launcher
│
├── src/
│   ├── realtime/             # Real-time trade monitoring
│   │   ├── service.py        # Main monitor service
│   │   ├── rtds_client.py    # WebSocket client for Polymarket
│   │   └── trade_processor.py # Trade enrichment & storage
│   │
│   ├── execution/            # Copy trading execution
│   │   ├── service.py        # Main copy trading service
│   │   ├── copy_trader.py    # Copy trading logic
│   │   ├── clob_client.py    # Order execution (paper + live)
│   │   ├── risk_manager.py   # Position limits, exposure
│   │   └── position_tracker.py # Track positions
│   │
│   ├── pipeline/             # Insider detection pipeline
│   ├── scoring/              # Trader scoring algorithms
│   ├── scrapers/             # Data collection
│   ├── database/             # Database utilities
│   ├── config/               # Configuration management
│   ├── metrics/              # Performance metrics
│   └── utils/                # Helpers
│
├── dashboard/                # Next.js frontend
│   ├── app/
│   │   └── live/page.tsx     # Live trade monitor page
│   ├── components/
│   │   ├── UnifiedTradeFeed.tsx
│   │   ├── InsiderAlerts.tsx
│   │   ├── ContextSidebar.tsx
│   │   └── ...
│   └── lib/
│       └── supabase.ts       # Supabase client & types
│
├── supabase/                 # Database migrations
├── scripts/                  # Utility scripts
├── tests/                    # Test files
└── logs/                     # Log files
```

---

## Key Features Implemented

### 1. Real-Time Trade Monitor (`run_live.ps1`)

**File:** `src/realtime/service.py`

- Connects to Polymarket RTDS WebSocket
- Processes ALL trades in real-time
- Detects:
  - **Whales:** Trades >= $10,000
  - **Insiders:** Score >= 60 based on heuristics
  - **Watchlist:** Traders you're tracking
- **Only stores important trades** (whale/insider/watchlist) to database
- Auto-reconnects on connection loss (stale detection at 120s)
- Triggers alerts for matching rules

**Insider Scoring Heuristics (real-time):**
- Large trades from unknown accounts (+30 pts for $5K+)
- Concentrated betting same market (+25 pts for 4+ trades)
- High session volume (+25 pts for $50K+)
- Off-hours trading 2-6am UTC (+10 pts)
- One-sided trading all BUY or SELL (+10 pts)

### 2. Copy Trading System (`run_copy_trading.ps1`)

**File:** `src/execution/service.py`

- **Paper Trading:** Simulates trades (default ON)
- **Live Trading:** Real order execution via CLOB API
- Risk management with position limits
- Tracks positions and P&L

**Toggle Mode:**
```
# In .env
PAPER_TRADING=true   # Safe simulation
PAPER_TRADING=false  # Real money (careful!)
```

### 3. Dashboard (Vercel)

**URL:** https://polymoney-one.vercel.app

Pages:
- `/live` - Real-time trade monitor with insider detection
- `/traders` - Trader profiles and analysis
- `/copy-trade` - Copy trading management
- `/watchlist` - Tracked traders

**Real-time Updates:** Uses Supabase Realtime (PostgreSQL subscriptions)

---

## Database Schema (Supabase)

### Key Tables

**`traders`** - Known trader profiles
- address, username, portfolio_value
- copytrade_score, bot_score, insider_score
- insider_level, insider_red_flags
- primary_classification

**`live_trades`** - Stored trades (whale/insider/watchlist only)
- trade_id, trader_address, condition_id
- side, size, price, usd_value
- is_whale, is_insider_suspect, is_watchlist
- processing_latency_ms

**`trade_alerts`** - Triggered alerts
- alert_type: whale_trade, insider_activity, watchlist_activity
- severity: info, warning, critical
- acknowledged: boolean

**`watchlist`** - Traders to track
- address, min_trade_size, alert_threshold_usd

**`alert_rules`** - Alert configuration
- rule_type, conditions, enabled

### Realtime Enabled Tables
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE live_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_alerts;
```

---

## Environment Variables (.env)

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...  # Service role key
SUPABASE_ANON_KEY=eyJ...  # Anon key (for frontend)

# Polymarket
POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_API_KEY=...

# Copy Trading
PAPER_TRADING=true  # Set false for live trading

# Pipeline
PARALLEL_WORKERS=10
API_RATE_LIMIT=60
```

---

## How to Run

### 1. Real-Time Monitor (Insider Detection)
```powershell
cd E:\Doing\polymarket
.\run_live.ps1
```

**Output:**
```
[STATS] Trades: 50,000 seen, 150 saved (whale/insider/watchlist) | Alerts: 21 | ...
```

### 2. Copy Trading Service
```powershell
.\run_copy_trading.ps1
```

### 3. Both Services Together
Run in separate terminals, or for Hetzner deployment use systemd services.

---

## Deployment (Hetzner)

### Recommended Server
- **CPX21** (3 vCPU, 4GB RAM, 80GB SSD) ~€9/month
- Ubuntu 22.04 LTS

### Setup
```bash
# Clone repo
git clone https://github.com/dijiclick/polymoney.git
cd polymoney

# Setup Python
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env with your keys

# Run as systemd service (24/7)
sudo systemctl enable polymarket-monitor
sudo systemctl start polymarket-monitor
```

---

## Recent Changes Log

### 2026-01-24
- **Only store important trades:** Whale/insider/watchlist trades saved to DB, others discarded
- **Fixed watchlist case sensitivity:** Addresses now properly matched with `.lower()`
- Stats log updated: "seen" vs "saved (whale/insider/watchlist)"

### 2026-01-23
- Added stale connection detection (120s timeout)
- Auto-cleanup old trades (7-day retention)
- Real-time insider detection heuristics
- Copy trading execution module
- Launcher scripts

---

## Common Issues & Fixes

### Frontend not updating in real-time
1. Check Supabase Realtime is enabled:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE live_trades;
   ALTER PUBLICATION supabase_realtime ADD TABLE trade_alerts;
   ```
2. Hard refresh browser (Ctrl+Shift+R)
3. Check backend is running and inserting trades

### Watchlist not matching
- Fixed: Case sensitivity issue - addresses stored lowercase, comparison now uses `.lower()`

### WebSocket disconnects
- Auto-reconnect implemented with exponential backoff
- Stale connection detection at 120 seconds

### High database usage
- Fixed: Only storing whale/insider/watchlist trades now
- Auto-cleanup: Trades older than 7 days deleted hourly

---

## API Endpoints (Polymarket)

### RTDS WebSocket
```
wss://ws-live-data.polymarket.com
Topic: activity/trades
```

### CLOB API
```
https://clob.polymarket.com
- GET /markets
- POST /order
- DELETE /order/{id}
```

---

## External Dependencies

- **py-clob-client:** Polymarket CLOB client
- **supabase-py:** Database client
- **websockets:** WebSocket connections
- **Next.js:** Frontend framework
- **Vercel:** Frontend hosting
- **Supabase:** Database + Realtime

---

## Future Improvements

- [ ] Telegram/Discord alerts
- [ ] More sophisticated insider ML model
- [ ] Backtesting framework
- [ ] Multi-wallet copy trading
- [ ] Mobile app

---

## Quick Commands Reference

```powershell
# Start monitor
.\run_live.ps1

# Start copy trading
.\run_copy_trading.ps1

# Check git status
git status

# Push changes
git add . && git commit -m "message" && git push origin main

# View logs
Get-Content logs\realtime.log -Tail 50

# Stop service
Ctrl+C
```
