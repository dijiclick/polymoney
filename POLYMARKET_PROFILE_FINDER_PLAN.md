# Polymarket Profile Finder - Complete Technical Plan

> **Version:** 1.0  
> **Date:** January 2025  
> **Runtime:** Local Machine  
> **Database:** Supabase (PostgreSQL)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Target Profiles](#2-goals--target-profiles)
3. [Data Sources & APIs](#3-data-sources--apis)
4. [Time & Resource Estimates](#4-time--resource-estimates)
5. [Fail-Fast Pipeline Architecture](#5-fail-fast-pipeline-architecture)
6. [Database Schema](#6-database-schema)
7. [Metrics & Calculations](#7-metrics--calculations)
8. [Classification Algorithms](#8-classification-algorithms)
9. [Filter Configuration](#9-filter-configuration)
10. [Implementation Phases](#10-implementation-phases)
11. [File Structure](#11-file-structure)
12. [Operational Procedures](#12-operational-procedures)
13. [Risk & Mitigation](#13-risk--mitigation)

---

## 1. Executive Summary

### What This System Does

A Python-based tool that:
1. Scrapes ALL active Polymarket traders from blockchain data
2. Filters them through a fail-fast pipeline (eliminating unqualified traders early)
3. Classifies qualified traders into 3 categories
4. Stores results in Supabase for querying and tracking

### The 3 Target Profiles

| Profile | Description | Use Case |
|---------|-------------|----------|
| 🎯 **Copy Trade** | Consistent, skilled human traders | Follow their trades |
| 🤖 **Winning Bots** | Automated systems with proven edge | Study their patterns |
| 🐋 **Insider/Whales** | Large bets on obscure events, new accounts | Early signals |

### Key Constraints

- **Minimum Filters:** 10 trades, $10 min position, $200 balance
- **Metrics:** Win rate (30d + alltime), ROI, max drawdown
- **Runtime:** Local machine, recurring execution

---

## 2. Goals & Target Profiles

### 2.1 Profile 1: Copy Trade Candidates 🎯

**Who they are:** Experienced traders with consistent profits, diversified across markets, manageable risk.

**Why copy them:** Proven track record, human decision-making (adaptable), steady returns.

**Ideal characteristics:**
```
├── Win rate 30d: >= 60%
├── Account age: >= 60 days
├── Unique markets: >= 5 (diversified)
├── Max drawdown: <= 30%
├── Trade frequency: 0.5 - 5 trades/day (active but not bot-like)
├── ROI 30d: >= 20%
└── Portfolio: >= $500
```

### 2.2 Profile 2: Winning Bots/Algos 🤖

**Who they are:** Automated trading systems operating 24/7 with consistent execution.

**Why track them:** Identify market inefficiencies they exploit, understand automated strategies.

**Ideal characteristics:**
```
├── Trade count 30d: >= 100 (high frequency)
├── Win rate: >= 55%
├── Max drawdown: <= 20% (tight risk management)
├── Trade time variance: Low (regular intervals)
├── Night trading ratio: > 30% (24/7 operation)
├── Position size variance: < 20% (consistent sizing)
└── Portfolio: >= $1,000
```

### 2.3 Profile 3: Insider/Whale Hunters 🐋

**Who they are:** Accounts making large, concentrated bets on unusual events, often with new accounts.

**Why track them:** Potential insider information, early signals on obscure events.

**Ideal characteristics:**
```
├── Max position size: >= $5,000
├── Position concentration: >= 50% (one big bet)
├── Account age: < 30 days (new account)
├── Unique markets: <= 3 (very focused)
├── Entry probability: < 30% (betting underdogs)
├── Category: Often "MENTIONS" or obscure events
└── PnL concentration: > 80% from few bets
```

---

## 3. Data Sources & APIs

### 3.1 Goldsky GraphQL (On-Chain Data)

**Purpose:** Get ALL trader addresses active in timeframe

**Endpoint:**
```
https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn
```

**Key Query:** `orderFilledEvents`
```graphql
query GetOrderFilledEvents($first: Int!, $timestamp_lt: BigInt!, $timestamp_gte: BigInt!) {
    orderFilledEvents(
        first: $first,
        orderBy: timestamp,
        orderDirection: desc,
        where: {
            timestamp_lt: $timestamp_lt,
            timestamp_gte: $timestamp_gte
        }
    ) {
        timestamp
        maker
        taker
        makerAmountFilled
        takerAmountFilled
    }
}
```

**Data Retrieved:**
| Field | Description |
|-------|-------------|
| `maker` | Address that created the order |
| `taker` | Address that filled the order |
| `timestamp` | Unix timestamp of trade |
| `makerAmountFilled` | Amount maker paid/received |
| `takerAmountFilled` | Amount taker paid/received |

**Limits:**
- Max 1000 results per query
- No hard rate limit (recommended: 10 req/sec)
- Must paginate using timestamp

**What we can calculate from Goldsky:**
- ✅ Total unique addresses
- ✅ Trade count per address
- ✅ Last activity timestamp
- ✅ First activity timestamp (account age)
- ❌ Cannot get: balance, positions, win rate

---

### 3.2 Polymarket Data API

**Base URL:** `https://data-api.polymarket.com`

**Endpoints Used:**

| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `GET /value?user={addr}` | Portfolio value | ~100/min |
| `GET /positions?user={addr}` | Current open positions | ~60/min |
| `GET /closed-positions?user={addr}` | Resolved positions (win rate) | ~60/min |
| `GET /activity?user={addr}` | Trade history & patterns | ~60/min |
| `GET /trades?user={addr}` | Individual trades | ~60/min |

**Response Examples:**

#### /value
```json
[{"user": "0x...", "value": 1234.56}]
```

#### /positions
```json
[{
    "proxyWallet": "0x...",
    "title": "Market Title",
    "outcome": "Yes",
    "size": 1000,
    "avgPrice": 0.45,
    "initialValue": 450,
    "currentValue": 600,
    "cashPnl": 150,
    "percentPnl": 33.3,
    "curPrice": 0.60
}]
```

#### /closed-positions
```json
[{
    "proxyWallet": "0x...",
    "title": "Resolved Market",
    "avgPrice": 0.30,
    "totalBought": 1000,
    "realizedPnl": 700,
    "curPrice": 1,
    "timestamp": 1704067200
}]
```

---

### 3.3 Platform Wallets (Exclude)

These addresses should be excluded from analysis:

```
0xc5d563a36ae78145c45a50134d48a1215220f80a  (Polymarket Platform)
0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e  (Polymarket Platform)
0x0000000000000000000000000000000000000000  (Null address)
```

---

## 4. Time & Resource Estimates

### 4.1 Assumptions

| Parameter | Conservative | Realistic | Optimistic |
|-----------|-------------|-----------|------------|
| Total Polymarket users | 2,000,000 | 2,000,000 | 2,000,000 |
| Active in 30 days (%) | 10% | 5% | 3% |
| **Active addresses** | **200,000** | **100,000** | **60,000** |

### 4.2 Goldsky Scraping (Step 1)

**Variables:**
- Events per 30 days: ~5-10 million trades
- Batch size: 1000 events per query
- Queries needed: 5,000 - 10,000

**Time Calculation:**
```
Queries: 10,000 (worst case)
Rate: 10 requests/second
Time: 10,000 / 10 = 1,000 seconds = ~17 minutes

With safety margin (5 req/sec):
Time: 10,000 / 5 = 2,000 seconds = ~33 minutes
```

| Scenario | Queries | Time (5 req/s) |
|----------|---------|----------------|
| Optimistic | 3,000 | 10 minutes |
| Realistic | 7,000 | 23 minutes |
| Conservative | 12,000 | 40 minutes |

---

### 4.3 Data API Processing (Steps 2-5)

**Without Fail-Fast (BAD):**
```
200,000 addresses × 5 API calls each = 1,000,000 calls
At 60 calls/min = 16,667 minutes = 278 hours = 11.5 DAYS 😱
```

**With Fail-Fast Pipeline (GOOD):**

| Step | Input | Pass Rate | Output | API Calls | Time (60/min) |
|------|------:|----------:|-------:|----------:|--------------:|
| 1. Goldsky | 200,000 | 50% (10+ trades) | 100,000 | 0 | 0 |
| 2. Balance | 100,000 | 15% (>$200) | 15,000 | 100,000 | 28 hours |
| 3. Positions | 15,000 | 70% | 10,500 | 15,000 | 4 hours |
| 4. Win Rate | 10,500 | 50% | 5,250 | 10,500 | 3 hours |
| 5. Deep Analysis | 5,250 | 100% | 5,250 | 15,750 | 4.4 hours |
| **TOTAL** | | | | **141,250** | **~40 hours** |

### 4.4 Summary: Total Time Estimates

| Scenario | Active Users | Total Time | Parallel (10x) |
|----------|-------------:|------------|----------------|
| **Optimistic** | 60,000 | ~20 hours | ~2 hours |
| **Realistic** | 100,000 | ~40 hours | ~4 hours |
| **Conservative** | 200,000 | ~80 hours | ~8 hours |

### 4.5 Parallelization Strategy

Running 10 concurrent workers:

```
Sequential: 40 hours
Parallel (10 workers): 4 hours
Parallel (20 workers): 2 hours (risk of rate limiting)
```

**Recommended:** 10 concurrent workers with 100ms delay between batches

---

### 4.6 Daily Incremental Updates

After initial scan, daily updates are much faster:

| Metric | Initial Scan | Daily Update |
|--------|-------------|--------------|
| New addresses | 100,000 | ~3,000 |
| API calls | 141,250 | ~15,000 |
| Time (parallel) | 4 hours | 20-30 minutes |

---

## 5. Fail-Fast Pipeline Architecture

### 5.1 Pipeline Overview

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           FAIL-FAST PIPELINE                                   ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 1: Goldsky Extraction                               [FREE]        │  ║
║  │  ════════════════════════════                                           │  ║
║  │                                                                         │  ║
║  │  Input:  Blockchain events (30 days)                                    │  ║
║  │  Output: Unique addresses + trade_count + last_activity                 │  ║
║  │                                                                         │  ║
║  │  ❌ ELIMINATE: trade_count < 10                                         │  ║
║  │                                                                         │  ║
║  │  200,000 addresses → 100,000 remain (50% eliminated)                    │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                      ↓                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 2: Balance Check                                    [1 API call]  │  ║
║  │  ═════════════════════                                                  │  ║
║  │                                                                         │  ║
║  │  Endpoint: GET /value?user={address}                                    │  ║
║  │  Output:   portfolio_value                                              │  ║
║  │                                                                         │  ║
║  │  ❌ ELIMINATE: portfolio_value < $200                                   │  ║
║  │                                                                         │  ║
║  │  100,000 addresses → 15,000 remain (85% eliminated)                     │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                      ↓                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 3: Positions Analysis                               [1 API call]  │  ║
║  │  ══════════════════════════                                             │  ║
║  │                                                                         │  ║
║  │  Endpoint: GET /positions?user={address}                                │  ║
║  │  Output:   positions[], avg_size, max_size, concentration               │  ║
║  │                                                                         │  ║
║  │  ❌ ELIMINATE: max_position_size < $10                                  │  ║
║  │  ❌ ELIMINATE: total_positions == 0 AND no closed positions             │  ║
║  │                                                                         │  ║
║  │  15,000 addresses → 10,500 remain (30% eliminated)                      │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                      ↓                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 4: Win Rate Calculation                             [1 API call]  │  ║
║  │  ════════════════════════════                                           │  ║
║  │                                                                         │  ║
║  │  Endpoint: GET /closed-positions?user={address}                         │  ║
║  │  Output:   win_rate_30d, win_rate_alltime, total_pnl, roi               │  ║
║  │                                                                         │  ║
║  │  ❌ ELIMINATE: win_rate < 40% AND total_pnl < 0                         │  ║
║  │               (must have EITHER decent win rate OR positive pnl)        │  ║
║  │                                                                         │  ║
║  │  10,500 addresses → 5,250 remain (50% eliminated)                       │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                      ↓                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 5: Deep Analysis                                    [1-3 calls]   │  ║
║  │  ═════════════════════                                                  │  ║
║  │                                                                         │  ║
║  │  Endpoint: GET /activity?user={address}                                 │  ║
║  │  Output:   trade_patterns, max_drawdown, account_age, categories        │  ║
║  │                                                                         │  ║
║  │  NO ELIMINATION - Calculate all advanced metrics                        │  ║
║  │                                                                         │  ║
║  │  5,250 addresses → 5,250 fully analyzed                                 │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                      ↓                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │  STEP 6: Classification & Scoring                         [No API]      │  ║
║  │  ════════════════════════════════                                       │  ║
║  │                                                                         │  ║
║  │  Apply scoring algorithms for:                                          │  ║
║  │  ├── 🎯 Copy Trade Score (0-100)                                        │  ║
║  │  ├── 🤖 Bot Likelihood Score (0-100)                                    │  ║
║  │  └── 🐋 Insider Suspicion Score (0-100)                                 │  ║
║  │                                                                         │  ║
║  │  Save to Supabase with all metrics                                      │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### 5.2 Pipeline State Machine

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  STEP 1  │────▶│  STEP 2  │────▶│  STEP 3  │────▶│  STEP 4  │────▶│  STEP 5  │────▶│  STEP 6  │
│ Goldsky  │     │ Balance  │     │ Positions│     │ Win Rate │     │  Deep    │     │ Classify │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │                │
     ▼                ▼                ▼                ▼                ▼
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ELIMINATED│     │ELIMINATED│     │ELIMINATED│     │ELIMINATED│     │ COMPLETE │
│< 10 trade│     │ < $200   │     │ < $10 pos│     │bad perf. │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
```

Each trader record stores:
- `pipeline_step`: Current step (1-6)
- `eliminated_at_step`: NULL if qualified, step number if eliminated
- `elimination_reason`: Why they were eliminated

---

## 6. Database Schema

### 6.1 Supabase Tables

```sql
-- ============================================================================
-- TABLE: traders
-- Main table storing all trader data and metrics
-- ============================================================================

CREATE TABLE traders (
    -- Primary Key
    address TEXT PRIMARY KEY,
    
    -- Basic Info
    username TEXT,
    profile_image TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 1: Goldsky Data (from blockchain)
    -- ════════════════════════════════════════════════════════════════════════
    trade_count_30d INT DEFAULT 0,
    trade_count_alltime INT DEFAULT 0,
    last_trade_at TIMESTAMPTZ,
    first_trade_at TIMESTAMPTZ,
    account_age_days INT GENERATED ALWAYS AS (
        EXTRACT(DAY FROM (NOW() - first_trade_at))
    ) STORED,
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 2: Balance Data
    -- ════════════════════════════════════════════════════════════════════════
    portfolio_value DECIMAL(18,2) DEFAULT 0,
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 3: Position Data
    -- ════════════════════════════════════════════════════════════════════════
    total_positions INT DEFAULT 0,
    active_positions INT DEFAULT 0,
    avg_position_size DECIMAL(18,2) DEFAULT 0,
    max_position_size DECIMAL(18,2) DEFAULT 0,
    position_concentration DECIMAL(5,2) DEFAULT 0,  -- % in largest position
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 4: Performance Data
    -- ════════════════════════════════════════════════════════════════════════
    -- Win Rate
    closed_positions_30d INT DEFAULT 0,
    winning_positions_30d INT DEFAULT 0,
    win_rate_30d DECIMAL(5,2) DEFAULT 0,
    
    closed_positions_alltime INT DEFAULT 0,
    winning_positions_alltime INT DEFAULT 0,
    win_rate_alltime DECIMAL(5,2) DEFAULT 0,
    
    -- PnL & ROI
    total_pnl DECIMAL(18,2) DEFAULT 0,
    realized_pnl DECIMAL(18,2) DEFAULT 0,
    unrealized_pnl DECIMAL(18,2) DEFAULT 0,
    total_invested DECIMAL(18,2) DEFAULT 0,
    roi_percent DECIMAL(10,2) DEFAULT 0,
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 5: Advanced Metrics
    -- ════════════════════════════════════════════════════════════════════════
    max_drawdown DECIMAL(5,2) DEFAULT 0,
    trade_frequency DECIMAL(5,2) DEFAULT 0,  -- trades per day
    unique_markets_30d INT DEFAULT 0,
    
    -- Bot Detection Metrics
    trade_time_variance_hours DECIMAL(5,2),  -- std dev of trade hours
    night_trade_ratio DECIMAL(5,2) DEFAULT 0,  -- % trades 00:00-06:00 UTC
    position_size_variance DECIMAL(5,2),  -- consistency of bet sizing
    avg_hold_duration_hours DECIMAL(10,2),
    
    -- Insider Detection Metrics
    avg_entry_probability DECIMAL(5,2),  -- avg market % when they bought
    pnl_concentration DECIMAL(5,2),  -- % of pnl from top 3 bets
    category_concentration TEXT,  -- most traded category
    
    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 6: Classification Scores
    -- ════════════════════════════════════════════════════════════════════════
    copytrade_score INT DEFAULT 0 CHECK (copytrade_score >= 0 AND copytrade_score <= 100),
    bot_score INT DEFAULT 0 CHECK (bot_score >= 0 AND bot_score <= 100),
    insider_score INT DEFAULT 0 CHECK (insider_score >= 0 AND insider_score <= 100),
    
    -- Primary classification (highest score)
    primary_classification TEXT CHECK (primary_classification IN ('copytrade', 'bot', 'insider', 'none')),
    
    -- ════════════════════════════════════════════════════════════════════════
    -- Pipeline Tracking
    -- ════════════════════════════════════════════════════════════════════════
    pipeline_step INT DEFAULT 1 CHECK (pipeline_step >= 1 AND pipeline_step <= 6),
    eliminated_at_step INT,
    elimination_reason TEXT,
    
    -- ════════════════════════════════════════════════════════════════════════
    -- Metadata
    -- ════════════════════════════════════════════════════════════════════════
    is_platform_wallet BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: trader_positions
-- Current open positions for qualified traders
-- ============================================================================

CREATE TABLE trader_positions (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,
    
    -- Market Info
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    category TEXT,
    
    -- Position Details
    outcome TEXT,  -- 'Yes' or 'No'
    outcome_index INT,
    size DECIMAL(18,6),
    avg_price DECIMAL(10,6),
    current_price DECIMAL(10,6),
    
    -- Values
    initial_value DECIMAL(18,2),
    current_value DECIMAL(18,2),
    pnl DECIMAL(18,2),
    pnl_percent DECIMAL(10,2),
    
    -- Dates
    end_date TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(address, condition_id, outcome_index)
);

-- ============================================================================
-- TABLE: trader_closed_positions  
-- Historical resolved positions for performance tracking
-- ============================================================================

CREATE TABLE trader_closed_positions (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,
    
    -- Market Info
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    
    -- Position Details
    outcome TEXT,
    avg_price DECIMAL(10,6),
    total_bought DECIMAL(18,6),
    final_price DECIMAL(10,6),  -- 0 or 1 typically
    
    -- Result
    realized_pnl DECIMAL(18,2),
    is_win BOOLEAN,
    
    -- Timing
    resolved_at TIMESTAMPTZ,
    
    UNIQUE(address, condition_id, outcome)
);

-- ============================================================================
-- TABLE: watchlist
-- User-curated list of traders to monitor
-- ============================================================================

CREATE TABLE watchlist (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,
    
    list_type TEXT NOT NULL CHECK (list_type IN ('copytrade', 'bot', 'insider', 'custom')),
    priority INT DEFAULT 0,  -- Higher = more important
    
    notes TEXT,
    alert_on_new_trade BOOLEAN DEFAULT FALSE,
    alert_on_large_position BOOLEAN DEFAULT FALSE,
    alert_threshold_usd DECIMAL(18,2) DEFAULT 1000,
    
    added_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(address, list_type)
);

-- ============================================================================
-- TABLE: pipeline_runs
-- Track execution history
-- ============================================================================

CREATE TABLE pipeline_runs (
    id BIGSERIAL PRIMARY KEY,
    
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    
    -- Stats
    addresses_found INT DEFAULT 0,
    addresses_processed INT DEFAULT 0,
    step1_passed INT DEFAULT 0,
    step2_passed INT DEFAULT 0,
    step3_passed INT DEFAULT 0,
    step4_passed INT DEFAULT 0,
    step5_passed INT DEFAULT 0,
    final_qualified INT DEFAULT 0,
    
    -- Classification Results
    copytrade_found INT DEFAULT 0,
    bot_found INT DEFAULT 0,
    insider_found INT DEFAULT 0,
    
    -- Performance
    api_calls_made INT DEFAULT 0,
    errors_count INT DEFAULT 0,
    duration_seconds INT,
    
    error_log TEXT
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Pipeline processing
CREATE INDEX idx_traders_pipeline_step ON traders(pipeline_step) WHERE eliminated_at_step IS NULL;
CREATE INDEX idx_traders_eliminated ON traders(eliminated_at_step) WHERE eliminated_at_step IS NOT NULL;

-- Classification queries
CREATE INDEX idx_traders_copytrade ON traders(copytrade_score DESC) WHERE copytrade_score >= 50;
CREATE INDEX idx_traders_bot ON traders(bot_score DESC) WHERE bot_score >= 50;
CREATE INDEX idx_traders_insider ON traders(insider_score DESC) WHERE insider_score >= 50;

-- Common filters
CREATE INDEX idx_traders_portfolio ON traders(portfolio_value DESC);
CREATE INDEX idx_traders_winrate ON traders(win_rate_30d DESC);
CREATE INDEX idx_traders_pnl ON traders(total_pnl DESC);
CREATE INDEX idx_traders_last_trade ON traders(last_trade_at DESC);

-- Position lookups
CREATE INDEX idx_positions_address ON trader_positions(address);
CREATE INDEX idx_closed_positions_address ON trader_closed_positions(address);

-- Watchlist
CREATE INDEX idx_watchlist_type ON watchlist(list_type);
```

### 6.2 Useful Views

```sql
-- ============================================================================
-- VIEW: Top Copy Trade Candidates
-- ============================================================================

CREATE VIEW v_copytrade_candidates AS
SELECT 
    address,
    username,
    portfolio_value,
    win_rate_30d,
    win_rate_alltime,
    roi_percent,
    max_drawdown,
    trade_count_30d,
    unique_markets_30d,
    copytrade_score,
    account_age_days
FROM traders
WHERE 
    copytrade_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY copytrade_score DESC;

-- ============================================================================
-- VIEW: Likely Bots
-- ============================================================================

CREATE VIEW v_likely_bots AS
SELECT 
    address,
    username,
    portfolio_value,
    win_rate_30d,
    trade_count_30d,
    trade_frequency,
    night_trade_ratio,
    trade_time_variance_hours,
    bot_score
FROM traders
WHERE 
    bot_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY bot_score DESC;

-- ============================================================================
-- VIEW: Insider Suspects
-- ============================================================================

CREATE VIEW v_insider_suspects AS
SELECT 
    address,
    username,
    portfolio_value,
    max_position_size,
    position_concentration,
    avg_entry_probability,
    account_age_days,
    unique_markets_30d,
    insider_score
FROM traders
WHERE 
    insider_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY insider_score DESC;
```

---

## 7. Metrics & Calculations

### 7.1 Win Rate Calculation

```python
def calculate_win_rate(closed_positions: List[dict], days: int = None) -> dict:
    """
    Calculate win rate from closed positions.
    
    A position is a WIN if:
    - realized_pnl > 0
    OR
    - final_price == 1 and they bet YES
    - final_price == 0 and they bet NO
    """
    
    if days:
        cutoff = datetime.now() - timedelta(days=days)
        positions = [p for p in closed_positions if p['resolved_at'] >= cutoff]
    else:
        positions = closed_positions
    
    if not positions:
        return {'win_rate': 0, 'wins': 0, 'total': 0}
    
    wins = sum(1 for p in positions if p['realized_pnl'] > 0)
    total = len(positions)
    
    return {
        'win_rate': (wins / total) * 100,
        'wins': wins,
        'total': total
    }
```

### 7.2 ROI Calculation

```python
def calculate_roi(positions: List[dict], closed_positions: List[dict]) -> dict:
    """
    ROI = (Total Returns - Total Invested) / Total Invested * 100
    
    Total Invested = Sum of all initial position values
    Total Returns = Current value + Realized PnL from closed
    """
    
    # Current positions
    current_value = sum(p['current_value'] for p in positions)
    initial_value = sum(p['initial_value'] for p in positions)
    
    # Closed positions
    realized_pnl = sum(p['realized_pnl'] for p in closed_positions)
    closed_invested = sum(p['total_bought'] * p['avg_price'] for p in closed_positions)
    
    total_invested = initial_value + closed_invested
    total_returns = current_value + realized_pnl + closed_invested
    
    if total_invested == 0:
        return {'roi_percent': 0, 'total_invested': 0}
    
    roi = ((total_returns - total_invested) / total_invested) * 100
    
    return {
        'roi_percent': roi,
        'total_invested': total_invested,
        'total_returns': total_returns,
        'unrealized_pnl': current_value - initial_value,
        'realized_pnl': realized_pnl
    }
```

### 7.3 Max Drawdown Calculation

```python
def calculate_max_drawdown(activity: List[dict]) -> float:
    """
    Max Drawdown = Maximum peak-to-trough decline
    
    Requires tracking cumulative PnL over time.
    """
    
    if not activity:
        return 0
    
    # Sort by timestamp
    sorted_activity = sorted(activity, key=lambda x: x['timestamp'])
    
    # Calculate cumulative PnL
    cumulative_pnl = 0
    peak = 0
    max_drawdown = 0
    
    for event in sorted_activity:
        if event['type'] == 'TRADE':
            # Approximate PnL from trade
            pnl = event.get('realized_pnl', 0)
            cumulative_pnl += pnl
            
            if cumulative_pnl > peak:
                peak = cumulative_pnl
            
            drawdown = (peak - cumulative_pnl) / peak if peak > 0 else 0
            max_drawdown = max(max_drawdown, drawdown)
    
    return max_drawdown * 100  # Return as percentage
```

### 7.4 Bot Detection Metrics

```python
def calculate_bot_indicators(activity: List[dict]) -> dict:
    """
    Calculate metrics that indicate automated trading.
    """
    
    if not activity:
        return {}
    
    trades = [a for a in activity if a['type'] == 'TRADE']
    
    if len(trades) < 10:
        return {}
    
    # 1. Trade Time Variance (bots trade at regular intervals)
    timestamps = [t['timestamp'] for t in trades]
    intervals = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]
    time_variance = statistics.stdev(intervals) if len(intervals) > 1 else float('inf')
    
    # 2. Night Trading Ratio (bots trade 24/7)
    night_trades = sum(1 for t in trades 
                       if datetime.fromtimestamp(t['timestamp']).hour in range(0, 6))
    night_ratio = night_trades / len(trades) * 100
    
    # 3. Position Size Variance (bots use consistent sizing)
    sizes = [t['usdcSize'] for t in trades if t.get('usdcSize')]
    size_variance = (statistics.stdev(sizes) / statistics.mean(sizes) * 100) if sizes else 0
    
    # 4. Trade Frequency
    days_active = (max(timestamps) - min(timestamps)) / 86400
    trade_frequency = len(trades) / days_active if days_active > 0 else 0
    
    return {
        'trade_time_variance_hours': time_variance / 3600,
        'night_trade_ratio': night_ratio,
        'position_size_variance': size_variance,
        'trade_frequency': trade_frequency
    }
```

### 7.5 Insider Detection Metrics

```python
def calculate_insider_indicators(positions: List[dict], closed: List[dict], activity: List[dict]) -> dict:
    """
    Calculate metrics that indicate potential insider trading.
    """
    
    # 1. Average Entry Probability (insiders buy underdogs)
    entry_prices = [p['avg_price'] for p in positions] + [c['avg_price'] for c in closed]
    avg_entry_prob = statistics.mean(entry_prices) * 100 if entry_prices else 50
    
    # 2. Position Concentration (insiders focus on few bets)
    all_positions = positions + closed
    if all_positions:
        values = [p.get('initial_value', 0) or p.get('total_bought', 0) * p.get('avg_price', 0) 
                  for p in all_positions]
        total = sum(values)
        max_position = max(values) if values else 0
        concentration = (max_position / total * 100) if total > 0 else 0
    else:
        concentration = 0
    
    # 3. PnL Concentration (big wins from few bets)
    if closed:
        pnls = sorted([c['realized_pnl'] for c in closed], reverse=True)
        total_pnl = sum(p for p in pnls if p > 0)
        top3_pnl = sum(pnls[:3]) if len(pnls) >= 3 else sum(pnls)
        pnl_concentration = (top3_pnl / total_pnl * 100) if total_pnl > 0 else 0
    else:
        pnl_concentration = 0
    
    # 4. Unique Markets (insiders focus narrowly)
    unique_markets = len(set(p.get('market_slug') for p in all_positions))
    
    return {
        'avg_entry_probability': avg_entry_prob,
        'position_concentration': concentration,
        'pnl_concentration': pnl_concentration,
        'unique_markets_30d': unique_markets
    }
```

---

## 8. Classification Algorithms

### 8.1 Copy Trade Score (0-100)

```python
def calculate_copytrade_score(trader: dict) -> int:
    """
    Score traders on their suitability for copy trading.
    
    Factors (weights):
    - Win rate 30d (25%)
    - ROI (20%)
    - Max drawdown (20%)
    - Account age (15%)
    - Diversification (10%)
    - Consistency (10%)
    """
    
    score = 0
    
    # Win Rate (0-25 points)
    wr = trader['win_rate_30d']
    if wr >= 70: score += 25
    elif wr >= 65: score += 22
    elif wr >= 60: score += 18
    elif wr >= 55: score += 12
    elif wr >= 50: score += 5
    
    # ROI (0-20 points)
    roi = trader['roi_percent']
    if roi >= 50: score += 20
    elif roi >= 30: score += 16
    elif roi >= 20: score += 12
    elif roi >= 10: score += 8
    elif roi >= 0: score += 4
    
    # Max Drawdown (0-20 points, lower is better)
    dd = trader['max_drawdown']
    if dd <= 10: score += 20
    elif dd <= 20: score += 16
    elif dd <= 30: score += 12
    elif dd <= 40: score += 6
    elif dd <= 50: score += 2
    
    # Account Age (0-15 points)
    age = trader['account_age_days']
    if age >= 180: score += 15
    elif age >= 90: score += 12
    elif age >= 60: score += 9
    elif age >= 30: score += 5
    
    # Diversification (0-10 points)
    markets = trader['unique_markets_30d']
    if markets >= 10: score += 10
    elif markets >= 7: score += 8
    elif markets >= 5: score += 6
    elif markets >= 3: score += 3
    
    # Consistency - Trade Frequency (0-10 points)
    freq = trader['trade_frequency']
    if 0.5 <= freq <= 5: score += 10  # Sweet spot
    elif 0.2 <= freq <= 10: score += 6
    elif freq > 0: score += 2
    
    return min(100, score)
```

### 8.2 Bot Score (0-100)

```python
def calculate_bot_score(trader: dict) -> int:
    """
    Score likelihood that trader is a bot.
    
    Indicators (weights):
    - High trade frequency (25%)
    - Low time variance (25%)
    - Night trading (20%)
    - Consistent position sizing (15%)
    - Short hold duration (15%)
    """
    
    score = 0
    
    # High Trade Frequency (0-25 points)
    freq = trader['trade_frequency']
    if freq >= 50: score += 25
    elif freq >= 20: score += 20
    elif freq >= 10: score += 15
    elif freq >= 5: score += 8
    
    # Low Time Variance (0-25 points)
    variance = trader.get('trade_time_variance_hours', float('inf'))
    if variance <= 0.5: score += 25
    elif variance <= 1: score += 20
    elif variance <= 2: score += 15
    elif variance <= 4: score += 8
    
    # Night Trading (0-20 points)
    night = trader.get('night_trade_ratio', 0)
    if night >= 40: score += 20
    elif night >= 30: score += 15
    elif night >= 20: score += 10
    elif night >= 10: score += 5
    
    # Consistent Position Sizing (0-15 points)
    size_var = trader.get('position_size_variance', 100)
    if size_var <= 10: score += 15
    elif size_var <= 20: score += 12
    elif size_var <= 30: score += 8
    elif size_var <= 50: score += 4
    
    # Short Hold Duration (0-15 points)
    hold = trader.get('avg_hold_duration_hours', float('inf'))
    if hold <= 2: score += 15
    elif hold <= 6: score += 12
    elif hold <= 12: score += 8
    elif hold <= 24: score += 4
    
    return min(100, score)
```

### 8.3 Insider Score (0-100)

```python
def calculate_insider_score(trader: dict) -> int:
    """
    Score suspicion that trader has insider information.
    
    Indicators (weights):
    - New account with big wins (25%)
    - High position concentration (25%)
    - Low entry probability bets (20%)
    - Few unique markets (15%)
    - Large max position (15%)
    """
    
    score = 0
    
    # New Account + Profitable (0-25 points)
    age = trader['account_age_days']
    pnl = trader['total_pnl']
    if age <= 14 and pnl >= 5000: score += 25
    elif age <= 30 and pnl >= 2000: score += 20
    elif age <= 30 and pnl >= 500: score += 12
    elif age <= 60 and pnl >= 1000: score += 6
    
    # Position Concentration (0-25 points)
    conc = trader.get('position_concentration', 0)
    if conc >= 80: score += 25
    elif conc >= 60: score += 20
    elif conc >= 50: score += 15
    elif conc >= 40: score += 8
    
    # Low Entry Probability (0-20 points)
    entry = trader.get('avg_entry_probability', 50)
    if entry <= 15: score += 20
    elif entry <= 25: score += 16
    elif entry <= 30: score += 12
    elif entry <= 35: score += 6
    
    # Few Unique Markets (0-15 points)
    markets = trader['unique_markets_30d']
    if markets == 1: score += 15
    elif markets == 2: score += 12
    elif markets <= 3: score += 8
    elif markets <= 5: score += 4
    
    # Large Max Position (0-15 points)
    max_pos = trader['max_position_size']
    if max_pos >= 50000: score += 15
    elif max_pos >= 20000: score += 12
    elif max_pos >= 10000: score += 9
    elif max_pos >= 5000: score += 6
    elif max_pos >= 2000: score += 3
    
    return min(100, score)
```

---

## 9. Filter Configuration

### 9.1 Default Filters (config.yaml)

```yaml
# ============================================================================
# POLYMARKET PROFILE FINDER - FILTER CONFIGURATION
# ============================================================================

# Global filters (applied to all profiles)
global:
  min_trades_30d: 10
  min_portfolio_value: 200
  min_position_size: 10
  exclude_platform_wallets: true

# Pipeline step filters
pipeline:
  step1_goldsky:
    min_trades: 10
    
  step2_balance:
    min_portfolio_value: 200
    
  step3_positions:
    min_position_size: 10
    require_positions: false  # Allow if they have closed positions
    
  step4_performance:
    # Pass if EITHER condition is met
    min_win_rate: 40
    min_total_pnl: 0
    require_one: true  # OR logic, not AND

# Profile-specific filters
profiles:
  copytrade:
    enabled: true
    min_score: 60
    filters:
      min_win_rate_30d: 60
      min_account_age_days: 60
      max_drawdown: 30
      min_unique_markets: 5
      min_portfolio_value: 500
      trade_frequency_range: [0.5, 5]  # trades per day
      
  bot:
    enabled: true
    min_score: 60
    filters:
      min_trades_30d: 100
      min_win_rate_30d: 55
      max_drawdown: 20
      min_portfolio_value: 1000
      min_trade_frequency: 10
      
  insider:
    enabled: true
    min_score: 60
    filters:
      min_max_position_size: 5000
      min_position_concentration: 50
      max_account_age_days: 30
      max_unique_markets: 3

# Advanced filters (optional)
advanced:
  categories:
    include: []  # Empty = all categories
    exclude: []
    
  time_filters:
    only_recent_activity: true
    max_days_since_trade: 7
    
  performance_filters:
    min_roi_30d: null
    max_losing_streak: null
```

### 9.2 Custom Filter Examples

```python
# Example: Find crypto-focused traders with high volume
custom_filter_crypto_whales = {
    'category_concentration': 'CRYPTO',
    'min_portfolio_value': 10000,
    'min_trades_30d': 50,
    'min_win_rate_30d': 55
}

# Example: Find sports bettors with consistent profits
custom_filter_sports_pros = {
    'category_concentration': 'SPORTS',
    'min_win_rate_alltime': 55,
    'min_closed_positions': 100,
    'max_drawdown': 25
}

# Example: Find new accounts making big bets on politics
custom_filter_political_insiders = {
    'category_concentration': 'POLITICS',
    'max_account_age_days': 14,
    'min_max_position_size': 10000,
    'min_total_pnl': 0
}
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Days 1-2)

```
□ Set up Supabase project
  □ Create database schema
  □ Set up indexes
  □ Create views
  □ Configure RLS policies

□ Set up Python project
  □ Create virtual environment
  □ Install dependencies
  □ Create config structure
  □ Set up logging

□ Implement Goldsky scraper
  □ GraphQL client
  □ Pagination logic
  □ Address extraction
  □ Trade count aggregation
```

### Phase 2: Core Pipeline (Days 3-5)

```
□ Implement Step 1: Goldsky extraction
  □ Batch processing
  □ Resume capability
  □ Progress tracking

□ Implement Step 2: Balance check
  □ Parallel API calls
  □ Rate limiting
  □ Error handling

□ Implement Step 3: Positions analysis
  □ Position parsing
  □ Metric calculation
  □ Database updates

□ Implement Step 4: Win rate calculation
  □ Closed positions fetching
  □ 30d vs alltime logic
  □ ROI calculation

□ Implement Step 5: Deep analysis
  □ Activity fetching
  □ Bot indicators
  □ Insider indicators
  □ Drawdown calculation
```

### Phase 3: Classification (Days 6-7)

```
□ Implement scoring algorithms
  □ Copy trade score
  □ Bot score
  □ Insider score

□ Implement classification logic
  □ Score thresholds
  □ Primary classification
  □ Reason tracking

□ Create CLI interface
  □ Run commands
  □ Filter queries
  □ Export results
```

### Phase 4: Operations (Days 8-10)

```
□ Implement incremental updates
  □ Daily new addresses
  □ Re-check qualified
  □ Cleanup old data

□ Add monitoring
  □ Pipeline run tracking
  □ Error reporting
  □ Performance metrics

□ Create utilities
  □ Export to CSV
  □ Watchlist management
  □ Quick queries

□ Testing & documentation
  □ Unit tests
  □ Integration tests
  □ User documentation
```

---

## 11. File Structure

```
polymarket-finder/
├── README.md
├── requirements.txt
├── config.yaml                    # Filter configuration
├── .env                           # Supabase credentials
│
├── src/
│   ├── __init__.py
│   │
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings.py            # Load config
│   │   └── filters.py             # Filter definitions
│   │
│   ├── scrapers/
│   │   ├── __init__.py
│   │   ├── goldsky.py             # GraphQL scraper
│   │   └── data_api.py            # Polymarket Data API client
│   │
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── runner.py              # Main pipeline orchestrator
│   │   ├── step1_goldsky.py       # Extract addresses
│   │   ├── step2_balance.py       # Check balance
│   │   ├── step3_positions.py     # Analyze positions
│   │   ├── step4_winrate.py       # Calculate performance
│   │   ├── step5_analysis.py      # Deep analysis
│   │   └── step6_classify.py      # Classification
│   │
│   ├── metrics/
│   │   ├── __init__.py
│   │   ├── calculations.py        # Metric calculations
│   │   ├── bot_detection.py       # Bot indicators
│   │   └── insider_detection.py   # Insider indicators
│   │
│   ├── scoring/
│   │   ├── __init__.py
│   │   ├── copytrade.py           # Copy trade scoring
│   │   ├── bot.py                 # Bot scoring
│   │   └── insider.py             # Insider scoring
│   │
│   ├── database/
│   │   ├── __init__.py
│   │   ├── supabase.py            # Supabase client
│   │   ├── models.py              # Data models
│   │   └── queries.py             # Common queries
│   │
│   └── utils/
│       ├── __init__.py
│       ├── logging.py             # Logging setup
│       ├── rate_limiter.py        # API rate limiting
│       └── helpers.py             # Utility functions
│
├── scripts/
│   ├── setup_database.sql         # Database schema
│   ├── run_pipeline.py            # CLI entry point
│   ├── run_incremental.py         # Daily update script
│   └── export_results.py          # Export to CSV
│
├── tests/
│   ├── __init__.py
│   ├── test_goldsky.py
│   ├── test_metrics.py
│   └── test_scoring.py
│
└── data/
    ├── exports/                   # CSV exports
    └── cache/                     # Local cache (optional)
```

---

## 12. Operational Procedures

### 12.1 Initial Full Scan

```bash
# 1. Setup environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
# Edit .env with Supabase credentials

# 3. Initialize database
python scripts/setup_database.py

# 4. Run full scan (4-8 hours)
python scripts/run_pipeline.py --full --days 30

# 5. Monitor progress
tail -f logs/pipeline.log
```

### 12.2 Daily Incremental Update

```bash
# Run daily (recommended: cron job at 3 AM)
python scripts/run_incremental.py

# Or with cron:
0 3 * * * cd /path/to/polymarket-finder && ./venv/bin/python scripts/run_incremental.py
```

### 12.3 Query Results

```python
# Python
from src.database.queries import get_top_traders

# Get top copy trade candidates
traders = get_top_traders(profile='copytrade', limit=50)

# Get likely bots
bots = get_top_traders(profile='bot', limit=50)

# Get insider suspects
insiders = get_top_traders(profile='insider', limit=50)

# Custom query
from src.database.queries import custom_filter
results = custom_filter({
    'min_portfolio_value': 5000,
    'min_win_rate_30d': 65,
    'category': 'POLITICS'
})
```

### 12.4 Export Results

```bash
# Export to CSV
python scripts/export_results.py --profile copytrade --output data/exports/copytrade.csv
python scripts/export_results.py --profile bot --output data/exports/bots.csv
python scripts/export_results.py --profile insider --output data/exports/insiders.csv

# Export all qualified traders
python scripts/export_results.py --all --output data/exports/all_qualified.csv
```

---

## 13. Risk & Mitigation

### 13.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| API rate limiting | Pipeline stalls | Implement exponential backoff, parallel workers |
| Goldsky downtime | Can't get new addresses | Cache last known state, retry logic |
| Data API changes | Broken parsing | Version API responses, alert on schema changes |
| Large data volume | Memory issues | Stream processing, batch commits |
| Network failures | Lost progress | Checkpoint system, resume capability |

### 13.2 Data Quality Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate addresses | Inflated counts | Unique constraint, deduplication |
| Stale data | Wrong classifications | Daily updates, timestamp tracking |
| Missing positions | Wrong win rate | Validate completeness, flag incomplete |
| Platform changes | Outdated metrics | Monitor Polymarket updates |

### 13.3 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Long runtime | Resource usage | Run overnight, cloud option |
| Storage costs | Budget overrun | Monitor Supabase usage, cleanup old data |
| Classification errors | Wrong profiles | Manual review sample, tuning |

---

## Appendix A: API Response Samples

### Goldsky orderFilledEvents

```json
{
  "data": {
    "orderFilledEvents": [
      {
        "id": "0xabc..._0xdef...",
        "timestamp": "1704067200",
        "maker": "0x1234567890abcdef1234567890abcdef12345678",
        "taker": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "makerAmountFilled": "1000000",
        "takerAmountFilled": "500000"
      }
    ]
  }
}
```

### Data API /value

```json
[
  {
    "user": "0x1234567890abcdef1234567890abcdef12345678",
    "value": 1234.56
  }
]
```

### Data API /positions

```json
[
  {
    "proxyWallet": "0x...",
    "asset": "12345...",
    "conditionId": "0x...",
    "size": 1000.5,
    "avgPrice": 0.45,
    "initialValue": 450.225,
    "currentValue": 600.30,
    "cashPnl": 150.075,
    "percentPnl": 33.33,
    "totalBought": 1000.5,
    "realizedPnl": 0,
    "curPrice": 0.60,
    "redeemable": false,
    "title": "Will X happen?",
    "slug": "will-x-happen",
    "eventSlug": "x-event",
    "outcome": "Yes",
    "outcomeIndex": 0,
    "endDate": "2025-12-31"
  }
]
```

### Data API /closed-positions

```json
[
  {
    "proxyWallet": "0x...",
    "asset": "12345...",
    "conditionId": "0x...",
    "avgPrice": 0.30,
    "totalBought": 1000,
    "realizedPnl": 700,
    "curPrice": 1,
    "title": "Did Y happen?",
    "slug": "did-y-happen",
    "outcome": "Yes",
    "timestamp": 1704067200
  }
]
```

---

## Appendix B: Supabase Setup

### 1. Create Project

1. Go to https://supabase.com
2. Create new project
3. Note down:
   - Project URL
   - API Key (anon/public)
   - Service Role Key (for backend)

### 2. Run Schema

```sql
-- Copy entire schema from Section 6 and run in SQL Editor
```

### 3. Environment Variables

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
```

---

## Appendix C: Dependencies

```txt
# requirements.txt

# HTTP & Async
aiohttp>=3.9.0
httpx>=0.26.0

# Database
supabase>=2.3.0
asyncpg>=0.29.0

# Data Processing
pandas>=2.1.0
numpy>=1.26.0

# Configuration
pyyaml>=6.0.0
python-dotenv>=1.0.0

# CLI
click>=8.1.0
rich>=13.7.0

# Utilities
tenacity>=8.2.0  # Retry logic
ratelimit>=2.2.0  # Rate limiting

# Development
pytest>=7.4.0
pytest-asyncio>=0.23.0
black>=24.1.0
```

Update Data Sources & APIs (Due to 2026 Changes)
Verify/add authentication: Add API key support in data_api.py. Polymarket now offers developer keys (free for <50K calls/month; apply at polymarket.com/developers).
Enhance Goldsky query: Add cursor pagination alongside timestamp (per their updated docs). Example updated query:graphqlquery GetOrderFilledEvents($first: Int!, $cursor: String) {
    orderFilledEvents(first: $first, after: $cursor) {
        ...fields...
    }
}
Add fallback: If /activity is rate-limited, use /trades as a secondary endpoint for patterns.
Change: In Section 3, add a subsection on "Authentication & Monitoring" with code for key rotation and error alerts.
---

*Document generated for Polymarket Profile Finder v1.0*
