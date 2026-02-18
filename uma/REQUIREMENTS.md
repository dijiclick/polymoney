# UMA Arbitrage Scanner - Requirements Specification

## The Opportunity

When a real-world event finishes (e.g., a game ends, an election is called), there's a **window** between:
1. The event finishing IRL
2. Someone submitting a UMA proposal to resolve the Polymarket market

During this window, the market is still trading. You can **buy the winning outcome** at a discount before it resolves to $1.00. The typical window is **minutes to hours** depending on the event.

```
Event finishes IRL ──→ [WINDOW: Buy cheap] ──→ UMA proposal submitted ──→ 2hr liveness ──→ Market resolves
```

---

## System Overview

A 24/7 monitoring service that:
1. **Ingests ALL** Polymarket events/markets (excluding crypto) into Supabase — initial backfill + continuous sync
2. **Monitors** real-world outcomes via tiered detection (price signals → sports APIs → AI search)
3. **Checks** UMA proposal status in **< 1 second** via Alchemy WebSocket (Etherscan polling as backup)
4. **Alerts** when: event finished IRL + no UMA proposal yet = arbitrage window open

---

## Verified API Limits (tested from VPS 46.224.70.178)

| API | Rate Limit | Cost | Confirmed Working from EU VPS |
|-----|-----------|------|-------------------------------|
| Gamma `/events` | **50 req/s** | FREE | YES — returns full data, not geo-blocked |
| Gamma `/markets` | **30 req/s** | FREE | YES |
| CLOB `/midpoint` | **150 req/s** | FREE | YES |
| CLOB `/price` | **150 req/s** | FREE | YES |
| Etherscan v2 getLogs (Polygon) | **3 req/s** (100K/day) | FREE | YES — near-real-time, full event decoding |
| Alchemy WebSocket (Polygon) | Unlimited push events | FREE (300M CU/mo) | Need to set up — ~20 CU/event, ~173K CU/mo |

**Current scale**: ~5,636 non-crypto active events (out of ~7,380 total). Max 500 per page.
**UMA proposal rate**: ~18 proposals/hour across all Polymarket markets.

---

## Functional Requirements

### FR-1: Event/Market Ingestion (ALL events, not just new)

**Initial Backfill:**
- Paginate through ALL non-crypto events: `GET /events?exclude_tag_id=21&limit=500&offset=N`
- ~12 pages to fetch all ~5,636 non-crypto events
- Store every event with ALL its markets and ALL metadata
- Expected time: ~15-30 seconds for full backfill (at 50 req/s limit, this is trivial)
- On startup: skip markets where `umaResolutionStatuses` already shows "proposed"/"settled"/"resolved" — don't create false opportunities from backfill

**Continuous Sync (every 30s):**
- Fetch newest events: `GET /events?exclude_tag_id=21&order=id&ascending=false&limit=100`
- **Any new event or market that appears → immediately upsert into Supabase** (detect by comparing against known IDs in memory)
- Update `active`, `closed`, `endDate` for existing events that changed
- Log every new event/market detection with timestamp

**What we store per event:**
- All fields from Gamma API response (title, description, slug, tags, image, dates, neg_risk, etc.)

**What we store per market (ALL fields from Gamma response):**
- conditionId, questionID, question, description, outcomes, outcomePrices
- clobTokenIds, volume, volumeClob, volume1wk, volume1mo
- bestAsk, lastTradePrice, spread, oneDayPriceChange
- umaBond, umaReward, umaResolutionStatuses, resolvedBy, customLiveness
- active, closed, acceptingOrders, negRisk, endDate, resolutionSource

### FR-2: Real-World Outcome Detection (Tiered Architecture)

**Tier 0 — Polymarket Price Signal (FREE, always-on):**
- Monitor all active markets via Gamma API price data
- **Thresholds (dual-level):**
  - Price > **0.85** → start monitoring closely, add to watchlist
  - Price > **0.90** → trigger immediate Tier 1/2 verification
- This is the TRIGGER that activates verification, not ground truth
- Cost: $0 (already fetching prices)

**Tier 1 — Sports APIs (FREE, <1s latency):**
- **ESPN Hidden API** (no key needed): NBA, NFL, MLB, NHL, MLS, MMA, college sports, tennis, golf
  - `site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD`
  - Check `status.type.name === "STATUS_FINAL"` → extract winner/score
- **The Odds API** (500 free req/month): backup for sports scores
  - `GET /v4/sports/{sport}/scores`
- **Categorize sports events** by parsing market question: match team names, league names, date patterns
- **Date matching**: Parse market question for date (regex `\b(Jan|Feb|...|Dec)\s+\d{1,2}\b` or `\d{4}-\d{2}-\d{2}`) — only query scores for the correct date to avoid false positives
- Confidence: 99-100% when game status is FINAL
- **Future enhancement**: Flashscore + SofaScore adapters exist in `signal-manager/src/adapters/` — can be extracted for global sports coverage (soccer, cricket, tennis etc.) beyond ESPN

**Tier 2 — Perplexity Sonar ($0.005-0.008/query):**
- For ALL non-sports events where Tier 0 triggered (price > 0.90) or endDate passed
- Single API call with built-in web search + LLM reasoning
- Supports JSON schema output natively
- Output: `{ resolved: boolean, outcome: "yes"|"no"|"unknown", confidence: 0-100, source_url: string }`
- Only query events where `endDate < NOW()` or price signal triggered

**[DEACTIVATED — future cost optimization] Brave Search + GPT-4o-mini ($0.0003/query):**
- Two-step: Brave News Search → LLM parse. 20x cheaper than Perplexity
- Enable when Perplexity costs need optimizing (no Brave API key set up yet)

**Estimated monthly cost (at ~100 events/day needing verification):**
| Component | Daily | Monthly |
|-----------|-------|---------|
| Sports via ESPN (free) | $0 | $0 |
| Non-sports via Perplexity (~60/day) | $0.36 | $10.80 |
| **Total** | **$0.36** | **~$11** |

### FR-3: UMA Proposal Monitoring (Alchemy WebSocket + Etherscan backup)

**Primary method — Alchemy WebSocket `eth_subscribe` (< 1s latency):**
- Subscribe to `logs` on OptimisticOracleV2 contract filtered by UmaCtfAdapter as requester
- Real-time push notifications — zero polling, instant detection
- Alchemy free tier: 300M compute units/month. At ~20 CU/event × 432 events/day = ~173K CU/month (0.06% of free tier)
- Need to sign up for Alchemy free account (Polygon supported)
```
wss://polygon-mainnet.g.alchemy.com/v2/<API_KEY>
→ eth_subscribe('logs', {
    address: '0xee3afe347d5c74317041e2618c49534daf887c24',
    topics: [
      ['0x6e51dd00...', '0x5165909c...', '0x3f384afb...'],  // ProposePrice OR DisputePrice OR Settle
      '0x000...2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d'    // requester = UmaCtfAdapter
    ]
  })
```
- Auto-reconnect with exponential backoff on disconnect

**Backup method — Etherscan v2 polling (every 60s):**
- `GET https://api.etherscan.io/v2/api?chainid=137&module=logs&action=getLogs`
  - `fromBlock=<last_processed>&toBlock=latest`
  - Same topic filters as WebSocket
- Catches any events missed during WebSocket downtime
- Store `lastProcessedBlock` in local file (not DB) to survive restarts
- 1,440 calls/day = 1.4% of free tier

**Secondary cross-check — Gamma API `umaResolutionStatuses` (every 5s for HOT markets):**
- `GET /markets?id=<market_id>` → check `umaResolutionStatuses`
- Rate limit: 30 req/s — easily supports dozens of hot markets every 5s
- Catches edge cases where on-chain events don't match Gamma state

**Match proposals to our markets:**
- ancillaryData contains `title: <exact market question>` — matches our stored `question` field
- **Normalize before matching**: lowercase, trim whitespace, remove special chars (ancillaryData encoding can add artifacts)
- Also cross-reference via `initializer` hash in ancillaryData

**Track states:** `none` → `proposed` → `disputed` / `settled` → `resolved`
- `none` + outcome detected = **OPPORTUNITY OPEN**
- `proposed` = window closing (check `customLiveness` — some markets have < 2hr liveness)

### FR-4: Price Updates (FAST)

**Hot markets (outcome detected, opportunity open):**
- Update prices every **10 seconds** via CLOB `/midpoint`
- CLOB `/midpoint` at 150 req/s — can check hundreds of markets per second
- Crucial for showing accurate profit % on the dashboard

**Active markets (endDate approaching, no outcome yet):**
- Update prices every **30 seconds** via batch from Gamma `/markets`
- Used to detect Tier 0 price signals (outcome > 0.85/0.90)

**All other markets:**
- Updated during regular ingestion sync (every 30s) — prices come with the event data

### FR-5: Opportunity Alerting & Dashboard

**Dashboard page at `/uma` in existing Next.js app:**

**Section 1: LIVE OPPORTUNITIES (top priority)**
- Markets where: outcome detected + no UMA proposal + confidence >= 80 + is_actionable
- Columns:
  - Market question / event name
  - Detected outcome (Yes/No/team name)
  - Confidence score (color-coded: green >= 90, yellow >= 80)
  - Current winning price (e.g., $0.82)
  - Potential profit % (e.g., 21.9%)
  - Time since event ended (e.g., "4 min ago")
  - UMA status indicator (pulsing "No Proposal" badge)
  - Liveness period remaining (some markets != 2hr)
  - Direct link to Polymarket market page
- Auto-refreshes every 5 seconds
- Sound/visual alert on new opportunity
- Auto-dismiss when UMA proposal detected

**Section 2: RECENT RESOLUTIONS**
- Last 50 events that went through the full cycle
- Columns: Event, Outcome, Window Duration (time between event end and UMA proposal), Max Profit % available
- Helps understand typical window sizes per category

**Section 3: EVENT BROWSER**
- All tracked events with filtering/search
- Filter by: category, active/closed, has outcome, UMA status
- Columns: Event, Category, Markets count, End Date, Status, UMA Status

**Section 4: STATS**
- Average window duration by category
- Opportunities found today/this week/this month
- Average potential profit %
- Detection speed histogram

---

## Data Model (Supabase)

### Table: `uma_events`
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| polymarket_event_id | text UNIQUE | Gamma API event ID |
| title | text | Event title |
| description | text | Event description |
| slug | text | URL slug |
| category | text | sports/politics/entertainment/science/weather/other |
| subcategory | text | e.g., NBA, NFL, Soccer, US Politics |
| tags | jsonb | Array of tag objects from Gamma |
| image | text | Event image URL |
| start_date | timestamptz | Event start date |
| end_date | timestamptz | Event end date |
| neg_risk | boolean | Multi-outcome event (NegRisk)? |
| neg_risk_market_id | text | NegRisk group market ID |
| active | boolean | Still active on Polymarket |
| closed | boolean | Market closed |
| markets_count | integer | Number of markets in this event |
| total_volume | numeric | Sum of all market volumes |
| raw_data | jsonb | Full Gamma API response for this event |
| created_at | timestamptz | When we first ingested it |
| updated_at | timestamptz | Last metadata update |

### Table: `uma_markets`
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| event_id | integer | FK → uma_events |
| polymarket_market_id | text UNIQUE | Gamma API market ID |
| condition_id | text | CTF condition ID |
| question_id | text | UMA question ID |
| question | text | Market question text |
| question_normalized | text | Lowercase, trimmed for matching |
| description | text | Full resolution criteria |
| slug | text | URL slug |
| outcomes | jsonb | ["Yes", "No"] or custom outcome names |
| outcome_prices | jsonb | Current prices per outcome |
| clob_token_ids | jsonb | Token IDs for CLOB trading |
| best_ask | numeric | Current best ask |
| last_trade_price | numeric | Most recent trade price |
| spread | numeric | Current bid/ask spread |
| volume | numeric | Total volume (all-time) |
| volume_clob | numeric | CLOB volume |
| volume_1d | numeric | 24hr volume |
| volume_1wk | numeric | 7-day volume |
| volume_1mo | numeric | 30-day volume |
| one_day_price_change | numeric | 24hr price change |
| end_date | timestamptz | Market end date |
| resolution_source | text | URL of resolution source |
| uma_bond | numeric | Bond amount for proposals (USDC) |
| uma_reward | numeric | Reward for proposers (USDC) |
| custom_liveness | integer | Liveness period in seconds (default 7200 = 2hr) |
| uma_resolution_statuses | jsonb | Raw UMA statuses from Gamma |
| resolved_by | text | Adapter contract address |
| active | boolean | Accepting orders |
| closed | boolean | Market closed |
| accepting_orders | boolean | Currently accepting orders |
| neg_risk | boolean | Part of NegRisk group |
| automatically_resolved | boolean | Auto-resolved by system |
| raw_data | jsonb | Full Gamma market object |
| created_at | timestamptz | When we first ingested |
| updated_at | timestamptz | Last update |

### Table: `uma_outcomes`
| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| market_id | integer | FK → uma_markets |
| detected_outcome | text | Which outcome won (e.g., "Yes", "Lakers") |
| confidence | integer | 0-100 confidence score |
| detection_tier | text | tier0_price/tier1_sports/tier2_perplexity |
| detection_source | text | Specific source (espn, perplexity, etc.) |
| detection_data | jsonb | Raw API response / search results / citations |
| detected_at | timestamptz | When we detected the outcome |
| uma_status | text | none/requested/proposed/disputed/settled/resolved |
| uma_proposed_at | timestamptz | When UMA proposal was submitted |
| uma_proposed_outcome | text | What the proposer proposed |
| uma_proposer | text | Address of the proposer |
| uma_expiration | timestamptz | When liveness window expires |
| window_duration_sec | integer | Seconds between our detection and UMA proposal |
| winning_price_at_detection | numeric | Price of winning outcome when we detected it |
| potential_profit_pct | numeric | (1.0 - price) / price * 100 |
| is_opportunity | boolean | Currently an open opportunity |
| is_actionable | boolean | Meets liquidity/spread thresholds |
| notified | boolean | Whether dashboard was notified |
| created_at | timestamptz | Record creation |
| updated_at | timestamptz | Last update |

### Indexes
```sql
CREATE INDEX idx_uma_events_active ON uma_events(active, closed);
CREATE INDEX idx_uma_events_end_date ON uma_events(end_date) WHERE active = true;
CREATE INDEX idx_uma_markets_event ON uma_markets(event_id);
CREATE INDEX idx_uma_markets_end_date ON uma_markets(end_date) WHERE active = true;
CREATE INDEX idx_uma_markets_condition ON uma_markets(condition_id);
CREATE INDEX idx_uma_markets_question_norm ON uma_markets(question_normalized);
CREATE INDEX idx_uma_outcomes_opportunity ON uma_outcomes(is_opportunity) WHERE is_opportunity = true;
CREATE INDEX idx_uma_outcomes_actionable ON uma_outcomes(is_actionable) WHERE is_actionable = true;
CREATE INDEX idx_uma_outcomes_market ON uma_outcomes(market_id);
CREATE INDEX idx_uma_outcomes_uma_status ON uma_outcomes(uma_status);
```

---

## Actionability Filter

Not all detected opportunities are worth alerting on. An opportunity is `is_actionable = true` when:

```
volume_1d > 5000           -- $5K+ daily volume (liquid market)
AND best_ask < 0.97        -- At least 3% upside
AND spread < 0.05          -- Tight bid/ask spread
AND accepting_orders = true -- Market still accepting orders
```

Dashboard shows BOTH `is_opportunity` (all detected windows) and `is_actionable` (worth acting on), but prioritizes actionable ones in the alert section.

---

## Technical Architecture

### Where It Runs
- **VPS** (46.224.70.178) — all read APIs confirmed working from EU VPS
- **Language**: TypeScript (Node.js) — consistent with existing dashboard stack
- **Process**: Standalone service managed by PM2 alongside the dashboard
- **Path**: `/opt/polymarket/uma/` on VPS

### In-Memory State

Hot markets list lives in memory (zero-latency lookups), synced to Supabase asynchronously:

```typescript
// In-memory state — no DB round-trip for 5s/10s loops
const hotMarkets = new Map<string, HotMarket>();  // outcome detected, no proposal yet
const knownEventIds = new Set<string>();           // for detecting new events during sync
const knownMarketIds = new Set<string>();           // for detecting new markets during sync
let lastProcessedBlock = 0;                         // for Etherscan backup polling

// Persisted to local file on shutdown, loaded on startup
// Supabase is source of truth but memory is the fast path
```

### Components
```
uma/
├── src/
│   ├── index.ts                  # Entry point, orchestrates all loops + in-memory state
│   ├── ingestion/
│   │   ├── backfill.ts           # Initial full backfill of all non-crypto events
│   │   ├── event-syncer.ts       # Continuous sync (new + updated events every 30s)
│   │   └── price-updater.ts      # Fast price updates (10s for hot, 30s for active)
│   ├── detection/
│   │   ├── categorizer.ts        # Classify event → sports/politics/entertainment/etc
│   │   ├── tier0-price.ts        # Polymarket price signal detection (>0.85/0.90)
│   │   ├── tier1-sports.ts       # ESPN + Odds API for sports outcomes
│   │   └── tier2-perplexity.ts   # Perplexity Sonar for all non-sports events
│   ├── monitoring/
│   │   ├── uma-websocket.ts      # Alchemy WebSocket eth_subscribe for ProposePrice/Dispute/Settle
│   │   ├── uma-etherscan.ts      # Etherscan v2 backup polling (every 60s)
│   │   ├── uma-gamma.ts          # Cross-check hot markets via Gamma umaResolutionStatuses
│   │   └── opportunity.ts        # Opportunity lifecycle + actionability scoring
│   ├── db/
│   │   └── supabase.ts           # Supabase client, upserts, queries
│   └── utils/
│       ├── logger.ts             # Structured logging with timestamps
│       └── config.ts             # Environment config
├── state.json                    # Persisted: lastProcessedBlock, hotMarkets (survives restarts)
├── package.json
├── tsconfig.json
└── .env
```

### Dashboard Integration
- New page: `dashboard/app/uma/page.tsx`
- New API routes:
  - `GET /api/uma/opportunities` — current open arbitrage windows (real-time)
  - `GET /api/uma/events?category=&status=&page=` — all tracked events with filtering
  - `GET /api/uma/stats` — summary statistics
  - `GET /api/uma/markets/[id]` — single market detail with UMA history

### Processing Loops

```
┌─────────────────────────────────────────────────────────────────┐
│ LOOP 1: Event Sync (every 30s)                                  │
│  • Fetch newest events from Gamma (exclude crypto tag 21)       │
│  • Upsert events + all markets into Supabase + update memory    │
│  • Prices come included — serves as baseline price update       │
│  • On first run: full backfill of all ~5,636 non-crypto events  │
│  • New event/market → log + add to knownIds sets                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LOOP 2: Outcome Detection (every 30s)                           │
│  • Scan markets where endDate < NOW() and no outcome detected   │
│  • Also scan markets where any outcome price > 0.85 (watchlist) │
│  • Price > 0.90 → trigger immediate verification:               │
│    Sports → ESPN/Odds API (free, instant)                       │
│    Non-sports → Perplexity Sonar ($0.006/query)                 │
│  • Write detected outcomes to uma_outcomes + add to hotMarkets  │
│  • Compute is_actionable based on liquidity filter              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PERSISTENT: UMA Alchemy WebSocket (< 1s latency)                │
│  • eth_subscribe logs on OOv2 filtered by UmaCtfAdapter         │
│  • Receives ProposePrice/DisputePrice/Settle in real-time       │
│  • Decode ancillaryData title → match to our market (normalize) │
│  • Update hotMarkets map + DB immediately                       │
│  • Auto-reconnect with exponential backoff                      │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ LOOP 3a: UMA Etherscan Backup (every 60s)                       │
│  • Poll Etherscan v2 for any events missed by WebSocket         │
│  • fromBlock=lastProcessed (persisted in state.json)            │
│  • 1,440 calls/day = 1.4% of free tier                         │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│ LOOP 3b: UMA Gamma Cross-check (every 5s for HOT markets)      │
│  • Reads from in-memory hotMarkets map (zero DB latency)        │
│  • Check Gamma API umaResolutionStatuses per market             │
│  • Confirms on-chain data, catches edge cases                   │
│  • When proposal detected: record window_duration, close opp    │
│  • Typically only 5-20 hot markets at any time                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LOOP 4: Price Refresh (10s for hot, 30s for approaching)        │
│  • Hot markets (from memory): CLOB /midpoint every 10s          │
│  • Markets with endDate in next 2hr: Gamma prices every 30s     │
│  • Enables real-time profit % display on dashboard              │
└─────────────────────────────────────────────────────────────────┘
```

### UMA Resolution Flow (what we monitor)

```
Polymarket creates market
  └→ UmaCtfAdapter.initialize() → sends requestPrice() to OptimisticOracleV2
      └→ State: "Requested" (waiting for real-world event)

Event happens IRL
  └→ *** OUR DETECTION WINDOW ***
      └→ We detect outcome, check if anyone proposed yet

Whitelisted proposer submits proposePrice()
  └→ State: "Proposed" — posts $750 USDC bond
      └→ Liveness window begins (customLiveness field — usually 2hr, sometimes less)
          └→ *** WINDOW CLOSING — still technically tradeable ***

No dispute after liveness period
  └→ State: "Settled" → UmaCtfAdapter.resolve() → market redeemable

If disputed (rare):
  └→ First dispute: QuestionReset, new proposal round
  └→ Second dispute: escalated to UMA DVM vote (48-96hr)
```

**How we detect each state change:**
- **WebSocket (primary, <1s)**: Alchemy pushes ProposePrice/DisputePrice/Settle events
- **Etherscan (backup, 60s)**: Catches anything missed during WS downtime
- **Gamma (cross-check, 5s)**: Confirms on-chain state via `umaResolutionStatuses`

---

## API Keys Needed

| Service | Key | Cost | Purpose |
|---------|-----|------|---------|
| Supabase | Already have | Free | Database |
| Polymarket Gamma API | No key needed | Free | Events, markets, prices, UMA status |
| Polymarket CLOB API | No key needed (reads) | Free | Fast price updates |
| Alchemy (Polygon) | **Need to sign up** (free) | Free (300M CU/mo) | WebSocket UMA proposal detection |
| Etherscan v2 API | Already have (`ETHERSCAN_API_KEY`) | Free (3 req/s, 100K/day) | Backup UMA polling |
| ESPN API | No key needed | Free | US sports scores |
| Perplexity Sonar | **Need API key** | $0.006/query | Non-sports outcome detection |
| The Odds API | Need API key | Free 500 req/mo | Sports scores backup |

**Total estimated cost: ~$11/month** (Perplexity Sonar for non-sports events)

## Key Contract Addresses (Polygon, chainid=137)

| Contract | Address | Purpose |
|----------|---------|---------|
| OptimisticOracleV2 | `0xee3afe347d5c74317041e2618c49534daf887c24` | Emits ProposePrice/Dispute/Settle events |
| UmaCtfAdapter v3 | `0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d` | Polymarket's active requester (topic1 filter) |
| NegRisk CTF Adapter | Via Gamma `resolvedBy` field | For multi-outcome markets |

## Etherscan v2 Event Topics

| Event | topic0 Hash |
|-------|-------------|
| `ProposePrice` | `0x6e51dd00371aabffa82cd401592f76ed51e98a9ea4b58751c70463a2c78b5ca1` |
| `DisputePrice` | `0x5165909c3d1c01c5d1e121ac6f6d01dda1ba24bc9e1f975b5a375339c15be7f3` |
| `Settle` | `0x3f384afb4bd9f0aef0298c80399950011420eb33b0e1a750b20966270247b9a0` |

---

## Crypto Exclusion Strategy

**Primary filter**: `exclude_tag_id=21` parameter on Gamma API — excludes events tagged as "crypto"

**Secondary keyword filter** (catch events mis-tagged or untagged):
- Exclude if title/question contains: Bitcoin, BTC, Ethereum, ETH, Solana, SOL, cryptocurrency, DeFi, NFT, blockchain, token price, crypto, altcoin, memecoin, DOGE, XRP, stablecoin
- Case-insensitive regex match

---

## Edge Cases to Handle

1. **NegRisk (multi-outcome) markets**: Event "Who wins Super Bowl?" has 32 markets (one per team). If we detect "Chiefs won", then Chiefs=Yes AND all 31 others=No. One detection resolves all markets in the group.

2. **Markets resolving N/A or voided**: Some markets can resolve to "unknown" (p3=0.5). Monitor for `automaticallyResolved=true` or unusual UMA proposed prices.

3. **Already-resolved markets**: Skip markets where `closed=true` and `umaResolutionStatuses` shows "settled"/"resolved". Critical during initial backfill.

4. **Thin liquidity**: Even if we detect opportunity, if it fails the actionability filter (`volume_1d < 5000` or `spread > 0.05`), show but deprioritize. `is_actionable` flag controls alert priority.

5. **ESPN API changes**: Undocumented API could change. Fallback to Perplexity for sports if ESPN fails.

6. **Custom liveness periods**: Some markets have `customLiveness != 7200` (2hr default). Read this field — a market with 1-hour liveness means the window is smaller. Display remaining liveness time on dashboard.

7. **WebSocket disconnects**: Alchemy WS can drop. Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s). Etherscan backup catches any missed events on reconnect.

---

## Success Metrics

- **Detection speed**: Average time from event finishing to our detection < 2 minutes (sports: < 30 seconds)
- **UMA check latency**: < 1 second between proposal submission and our detection (via WebSocket)
- **Window capture rate**: % of arbitrage windows we detect before UMA proposal
- **False positive rate**: < 5% incorrect outcome detections
- **Uptime**: > 99% (24/7 monitoring via PM2)
- **Profit opportunities found**: Track count and average profit % per week
- **Average window duration**: Historical data by category to understand opportunity timing

---

## Future Enhancements (not in v1)

- **Brave Search + GPT-4o-mini**: 20x cheaper than Perplexity ($0.0003/query). Enable when costs matter.
- **Flashscore/SofaScore adapters**: Already exist in `signal-manager/src/adapters/`. Extract for global sports coverage.
- **Telegram alerts**: Push notifications for instant mobile alerts when not watching dashboard.
- **Auto-buying**: Automatically buy winning outcome when opportunity detected with high confidence.
