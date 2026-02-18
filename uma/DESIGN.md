# UMA Arbitrage Scanner - System Design

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VPS (46.224.70.178)                               │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  UMA Scanner Service (PM2: "uma-scanner")                       │    │
│  │  Node.js 20 · TypeScript · ES Modules · ~80MB RAM               │    │
│  │                                                                  │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │    │
│  │  │ Event    │  │ Outcome  │  │ UMA      │  │ Price        │   │    │
│  │  │ Syncer   │  │ Detector │  │ Monitor  │  │ Updater      │   │    │
│  │  │ (30s)    │  │ (30s)    │  │ (WS+5s)  │  │ (10s/30s)    │   │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │    │
│  │       │              │             │                │            │    │
│  │       ▼              ▼             ▼                ▼            │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │              In-Memory State (Maps + Sets)                │   │    │
│  │  │  hotMarkets · knownIds · lastBlock · marketsByQuestion    │   │    │
│  │  └────────────────────────┬─────────────────────────────────┘   │    │
│  │                           │ async write                         │    │
│  │                           ▼                                     │    │
│  │                    ┌─────────────┐                              │    │
│  │                    │  Supabase   │◄─── Dashboard reads          │    │
│  │                    └─────────────┘                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Dashboard (PM2: "polymarket-dashboard")                        │    │
│  │  Next.js 15 · Port 3000                                        │    │
│  │  /uma page reads from Supabase uma_* tables                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘

External Services:
  ├── Gamma API (events, markets, prices, UMA statuses) ← FREE
  ├── CLOB API (midpoint prices) ← FREE
  ├── Alchemy WebSocket (ProposePrice/Dispute/Settle events) ← FREE
  ├── Etherscan v2 (backup getLogs polling) ← FREE
  ├── ESPN API (sports scores) ← FREE
  └── Perplexity Sonar (non-sports outcome verification) ← ~$11/mo
```

---

## 2. Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (ES Modules) | Matches signal-manager. Reuse logger, patterns, types |
| Runtime | Node.js 20 (already on VPS) | No setup needed |
| Module system | `"type": "module"` + `Node16` resolution | Matches signal-manager tsconfig |
| HTTP client | Native `fetch` (Node 20 built-in) | Zero dependencies, same pattern as dashboard |
| WebSocket | `ws` package (already in signal-manager) | Proven, battle-tested on VPS |
| Database | `@supabase/supabase-js` ^2.47.0 | Same version as dashboard |
| Process manager | PM2 | Existing setup, `uma-scanner` process name |
| Build | `tsc` → `dist/` | Matches signal-manager exactly |

**No new system dependencies needed.** All npm packages already exist in the monorepo.

---

## 3. Project Structure

```
uma/
├── src/
│   ├── index.ts                     # Entry point — starts all loops, owns state
│   │
│   ├── state.ts                     # In-memory state container (Maps/Sets)
│   │
│   ├── ingestion/
│   │   ├── backfill.ts              # One-time: fetch all ~5,636 non-crypto events
│   │   ├── syncer.ts                # Loop: poll Gamma for new/updated events (30s)
│   │   └── price-updater.ts         # Loop: CLOB midpoint for hot (10s), Gamma for active (30s)
│   │
│   ├── detection/
│   │   ├── categorizer.ts           # Classify market → sports / non-sports
│   │   ├── tier0-price.ts           # Price signal: flag markets with outcome > 0.85
│   │   ├── tier1-sports.ts          # ESPN scoreboard API → game final?
│   │   └── tier2-perplexity.ts      # Perplexity Sonar → resolved yes/no?
│   │
│   ├── monitoring/
│   │   ├── uma-websocket.ts         # Alchemy eth_subscribe for OOv2 events
│   │   ├── uma-etherscan.ts         # Etherscan v2 getLogs backup (60s)
│   │   ├── uma-gamma.ts             # Gamma umaResolutionStatuses cross-check (5s)
│   │   └── opportunity.ts           # Opportunity lifecycle + actionability scoring
│   │
│   ├── db/
│   │   └── supabase.ts              # Client init + typed upsert/query helpers
│   │
│   └── util/
│       ├── logger.ts                # Copy from signal-manager (same format)
│       ├── config.ts                # Env vars + constants
│       └── normalize.ts             # Question text normalization for matching
│
├── package.json
├── tsconfig.json
└── .env
```

---

## 4. Module Design

### 4.1 Entry Point — `index.ts`

Orchestrates all loops. Owns the state object. Handles graceful shutdown.

```typescript
// Pseudocode — not implementation
import { State } from './state.js';

async function main() {
  const state = new State();

  // Phase 1: Backfill (runs once on first start, skips if state.json has data)
  await backfill(state);

  // Phase 2: Start persistent connections
  const umaWs = startUmaWebSocket(state);       // Alchemy WS — runs forever

  // Phase 3: Start polling loops
  const loops = [
    startEventSyncer(state),          // 30s — Gamma events
    startOutcomeDetector(state),      // 30s — ESPN + Perplexity
    startEtherscanBackup(state),      // 60s — Etherscan getLogs
    startGammaCrossCheck(state),      // 5s  — Gamma UMA status for hot markets
    startPriceUpdater(state),         // 10s/30s — CLOB + Gamma prices
  ];

  // Phase 4: Periodic state persistence
  setInterval(() => state.persist(), 60_000);

  // Phase 5: Status reporting
  setInterval(() => reportStatus(state), 30_000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log.info('Shutting down...');
    state.persist();
    umaWs.close();
    process.exit(0);
  });
}
```

### 4.2 State Container — `state.ts`

All fast-path data lives here. Zero DB round-trips for hot loops.

```typescript
interface HotMarket {
  marketId: string;                // polymarket_market_id
  question: string;                // market question
  questionNorm: string;            // normalized for matching
  detectedOutcome: string;         // "Yes" | "No" | team name
  confidence: number;              // 0-100
  detectedAt: Date;
  winningPrice: number;            // price of winning outcome when detected
  currentPrice: number;            // updated every 10s
  profitPct: number;               // (1 - currentPrice) / currentPrice * 100
  isActionable: boolean;           // passes liquidity filter
  eventId: string;
  clobTokenId: string;             // for CLOB /midpoint lookups
  customLiveness: number;          // seconds (default 7200)
}

class State {
  // Fast lookups
  hotMarkets: Map<string, HotMarket>;        // marketId → hot market info
  knownEventIds: Set<string>;                // polymarket_event_id set
  knownMarketIds: Set<string>;               // polymarket_market_id set
  marketsByQuestion: Map<string, string>;     // normalizedQuestion → marketId

  // Tracking
  lastProcessedBlock: number;                // Etherscan backup cursor
  backfillComplete: boolean;

  // Persist to/from state.json on disk
  persist(): void;
  load(): void;
}
```

### 4.3 Ingestion — `backfill.ts`

```
First run:
  for offset = 0, 500, 1000, ... until empty:
    GET /events?exclude_tag_id=21&limit=500&offset=N&active=true
    for each event:
      upsert into uma_events
      for each market in event.markets:
        upsert into uma_markets
        add to knownEventIds, knownMarketIds, marketsByQuestion
        if umaResolutionStatuses already has "proposed"/"settled":
          skip (don't create false opportunity)
  state.backfillComplete = true
  state.persist()
```

Sequential pagination (not parallel) — 12 requests at 1/s = 12 seconds. Safe.

### 4.4 Ingestion — `syncer.ts`

```
Every 30s:
  GET /events?exclude_tag_id=21&order=id&ascending=false&limit=100
  for each event:
    if event.id NOT in knownEventIds:
      → NEW EVENT: upsert + log "New event: {title}"
    for each market in event.markets:
      if market.id NOT in knownMarketIds:
        → NEW MARKET: upsert + log "New market: {question}"
      else:
        → UPDATE: upsert (prices, status, volume change)
    add to knownIds + marketsByQuestion
```

### 4.5 Detection — `categorizer.ts`

Simple keyword-based classification. No AI needed.

```typescript
function categorize(question: string, tags: Tag[]): { category: string; subcategory: string } {
  const q = question.toLowerCase();
  const tagSlugs = tags.map(t => t.slug);

  // Sports detection — check tags first (most reliable)
  if (tagSlugs.some(s => SPORTS_TAGS.includes(s))) {
    const sub = detectSportsLeague(q); // NBA, NFL, MLB, NHL, MLS, etc.
    return { category: 'sports', subcategory: sub };
  }

  // Keyword-based fallbacks
  if (SPORTS_PATTERNS.some(p => p.test(q))) return { category: 'sports', subcategory: detectSportsLeague(q) };
  if (POLITICS_PATTERNS.some(p => p.test(q))) return { category: 'politics', subcategory: 'general' };
  if (WEATHER_PATTERNS.some(p => p.test(q))) return { category: 'weather', subcategory: 'temperature' };

  return { category: 'other', subcategory: 'general' };
}

// Examples of patterns:
// SPORTS_TAGS = ['nba', 'nfl', 'mlb', 'nhl', 'soccer', 'mma', 'tennis', ...]
// SPORTS_PATTERNS = [/\bwin\b.*\b(game|match|series|tournament)\b/, /\bvs\.?\b/, ...]
// POLITICS_PATTERNS = [/\b(president|election|congress|senate|vote)\b/, ...]
// WEATHER_PATTERNS = [/\btemperature\b/, /\bhighest temp\b/, /°[FC]\b/, ...]
```

### 4.6 Detection — `tier0-price.ts`

```
Input: All active markets from latest sync
Output: Markets flagged for verification

for each market where active=true and no outcome detected:
  prices = JSON.parse(market.outcome_prices)
  maxPrice = Math.max(...prices.map(Number))

  if maxPrice >= 0.90:
    → trigger immediate Tier 1/2 verification
  elif maxPrice >= 0.85:
    → add to watchlist (check more frequently)
```

### 4.7 Detection — `tier1-sports.ts`

```typescript
interface SportsResult {
  resolved: boolean;
  outcome: string;      // "Yes" | "No" | team name
  confidence: number;   // 99-100 when FINAL
  source: string;       // "espn"
  rawData: any;
}

async function checkESPN(question: string, subcategory: string, endDate: string): Promise<SportsResult | null> {
  // 1. Parse date from question or endDate
  const date = parseEventDate(question, endDate); // "20260218"

  // 2. Map subcategory to ESPN path
  const espnPath = ESPN_PATHS[subcategory]; // e.g., "basketball/nba"
  if (!espnPath) return null;

  // 3. Fetch scoreboard
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`;
  const data = await fetchJSON(url);

  // 4. Find matching game by team names in question
  for (const event of data.events) {
    if (matchesQuestion(event, question)) {
      if (event.status.type.name === 'STATUS_FINAL') {
        const winner = determineWinner(event);
        return { resolved: true, outcome: winner, confidence: 100, source: 'espn', rawData: event };
      }
      return { resolved: false, outcome: 'unknown', confidence: 0, source: 'espn', rawData: null };
    }
  }
  return null; // no matching game found
}

// ESPN league paths
const ESPN_PATHS: Record<string, string> = {
  'nba': 'basketball/nba',
  'nfl': 'football/nfl',
  'mlb': 'baseball/mlb',
  'nhl': 'hockey/nhl',
  'mls': 'soccer/usa.1',
  'ncaab': 'basketball/mens-college-basketball',
  'ncaaf': 'football/college-football',
  'mma': 'mma/ufc',
  // ... more leagues
};
```

### 4.8 Detection — `tier2-perplexity.ts`

```typescript
interface PerplexityResult {
  resolved: boolean;
  outcome: 'yes' | 'no' | 'unknown';
  confidence: number;
  sourceUrl: string;
  reasoning: string;
}

async function checkPerplexity(question: string, description: string): Promise<PerplexityResult> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: 'You determine if real-world events have happened. Return JSON only.'
        },
        {
          role: 'user',
          content: `Has this event resolved? Question: "${question}"\nContext: ${description}\n\nReturn JSON: { "resolved": boolean, "outcome": "yes"|"no"|"unknown", "confidence": 0-100, "source_url": "url", "reasoning": "brief explanation" }`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}
```

### 4.9 Monitoring — `uma-websocket.ts`

Primary UMA detection. < 1 second latency.

```typescript
import WebSocket from 'ws';

class UmaWebSocketMonitor {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor(private state: State, private onProposal: (event: UmaEvent) => void) {}

  start(): void {
    this.connect();
  }

  private connect(): void {
    const url = `wss://polygon-mainnet.g.alchemy.com/v2/${config.ALCHEMY_API_KEY}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      log.info('Alchemy WebSocket connected');
      this.reconnectDelay = 1000; // reset backoff

      // Subscribe to ProposePrice + DisputePrice + Settle from UmaCtfAdapter
      this.ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['logs', {
          address: '0xee3afe347d5c74317041e2618c49534daf887c24',
          topics: [
            [TOPIC_PROPOSE, TOPIC_DISPUTE, TOPIC_SETTLE],
            TOPIC_UMA_ADAPTER,
          ],
        }],
      }));
    });

    this.ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        const logEntry = msg.params.result;
        const decoded = decodeUmaEvent(logEntry);
        if (decoded) this.onProposal(decoded);
      }
    });

    this.ws.on('close', () => {
      log.warn(`WS closed, reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    });

    this.ws.on('error', (err) => {
      log.error('WS error', err.message);
    });
  }

  close(): void {
    this.ws?.close();
  }
}
```

### 4.10 Monitoring — `uma-etherscan.ts`

Backup polling. Catches events missed during WS downtime.

```typescript
async function pollEtherscan(state: State): Promise<UmaEvent[]> {
  const fromBlock = state.lastProcessedBlock || await getLatestBlock() - 1000;
  const url = `https://api.etherscan.io/v2/api?chainid=137&module=logs&action=getLogs`
    + `&address=${OOV2_ADDRESS}`
    + `&topic0=${TOPIC_PROPOSE}`
    + `&topic0_1_opr=and`
    + `&topic1=${TOPIC_UMA_ADAPTER}`
    + `&fromBlock=${fromBlock}&toBlock=latest`
    + `&page=1&offset=1000`
    + `&apikey=${config.ETHERSCAN_API_KEY}`;

  const data = await fetchJSON(url);
  if (data.status !== '1') return [];

  const events: UmaEvent[] = [];
  for (const log of data.result) {
    const decoded = decodeUmaEvent(log);
    if (decoded) events.push(decoded);
    state.lastProcessedBlock = Math.max(state.lastProcessedBlock, parseInt(log.blockNumber, 16));
  }
  return events;
}
```

### 4.11 Monitoring — `opportunity.ts`

Lifecycle management. Connects detection → UMA monitoring → dashboard.

```typescript
async function processDetectedOutcome(state: State, market: UmaMarket, result: DetectionResult): Promise<void> {
  // 1. Write to uma_outcomes
  const outcome = {
    market_id: market.id,
    detected_outcome: result.outcome,
    confidence: result.confidence,
    detection_tier: result.tier,
    detection_source: result.source,
    detection_data: result.rawData,
    detected_at: new Date().toISOString(),
    uma_status: 'none',
    winning_price_at_detection: getWinningPrice(market, result.outcome),
    potential_profit_pct: calcProfitPct(getWinningPrice(market, result.outcome)),
    is_opportunity: true,
    is_actionable: checkActionability(market),
  };
  await db.upsertOutcome(outcome);

  // 2. Add to hot markets for fast UMA checking
  state.hotMarkets.set(market.polymarket_market_id, {
    marketId: market.polymarket_market_id,
    question: market.question,
    questionNorm: normalize(market.question),
    detectedOutcome: result.outcome,
    confidence: result.confidence,
    detectedAt: new Date(),
    winningPrice: outcome.winning_price_at_detection,
    currentPrice: outcome.winning_price_at_detection,
    profitPct: outcome.potential_profit_pct,
    isActionable: outcome.is_actionable,
    eventId: market.event_id,
    clobTokenId: getWinningTokenId(market, result.outcome),
    customLiveness: market.custom_liveness || 7200,
  });

  log.info(`OPPORTUNITY: ${market.question} → ${result.outcome} (${result.confidence}%) price=$${outcome.winning_price_at_detection} profit=${outcome.potential_profit_pct.toFixed(1)}%`);
}

async function processUmaProposal(state: State, event: UmaEvent): Promise<void> {
  // Match to our market by normalized question title
  const marketId = state.marketsByQuestion.get(normalize(event.title));
  if (!marketId) return; // not our market or already resolved

  const hot = state.hotMarkets.get(marketId);

  // Update outcome in DB
  await db.updateOutcomeUmaStatus(marketId, {
    uma_status: 'proposed',
    uma_proposed_at: new Date(event.timestamp * 1000).toISOString(),
    uma_proposed_outcome: event.proposedPrice > 0n ? 'Yes' : 'No',
    uma_proposer: event.proposer,
    uma_expiration: new Date(event.expirationTimestamp * 1000).toISOString(),
    is_opportunity: false,
    window_duration_sec: hot ? Math.floor((Date.now() - hot.detectedAt.getTime()) / 1000) : null,
  });

  // Remove from hot markets
  state.hotMarkets.delete(marketId);

  if (hot) {
    log.info(`WINDOW CLOSED: ${event.title} — window was ${hot ? formatDuration(Date.now() - hot.detectedAt.getTime()) : '?'}`);
  }
}

function checkActionability(market: UmaMarket): boolean {
  return (
    (market.volume_1d || 0) > 5000 &&
    (market.best_ask || 1) < 0.97 &&
    (market.spread || 1) < 0.05 &&
    market.accepting_orders === true
  );
}
```

### 4.12 Shared — `normalize.ts`

```typescript
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''""]/g, "'")     // normalize quotes
    .replace(/\s+/g, ' ')        // collapse whitespace
    .replace(/[^\w\s'.-]/g, '')  // remove special chars except common ones
    .trim();
}
```

### 4.13 Shared — `config.ts`

```typescript
import 'dotenv/config';

export const config = {
  // Supabase
  SUPABASE_URL: env('SUPABASE_URL'),
  SUPABASE_KEY: env('SUPABASE_SERVICE_KEY'),

  // Alchemy (WebSocket)
  ALCHEMY_API_KEY: env('ALCHEMY_API_KEY'),

  // Etherscan v2 (backup)
  ETHERSCAN_API_KEY: env('ETHERSCAN_API_KEY'),

  // Perplexity Sonar
  PERPLEXITY_API_KEY: env('PERPLEXITY_API_KEY'),

  // Constants
  GAMMA_BASE: 'https://gamma-api.polymarket.com',
  CLOB_BASE: 'https://clob.polymarket.com',
  CRYPTO_TAG_ID: 21,
  OOV2_ADDRESS: '0xee3afe347d5c74317041e2618c49534daf887c24',
  UMA_ADAPTER: '0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d',

  // Thresholds
  PRICE_WATCHLIST: 0.85,
  PRICE_TRIGGER: 0.90,
  MIN_CONFIDENCE: 80,

  // Actionability
  MIN_DAILY_VOLUME: 5000,
  MAX_BEST_ASK: 0.97,
  MAX_SPREAD: 0.05,

  // Intervals (ms)
  SYNC_INTERVAL: 30_000,
  DETECTION_INTERVAL: 30_000,
  ETHERSCAN_INTERVAL: 60_000,
  GAMMA_CHECK_INTERVAL: 5_000,
  HOT_PRICE_INTERVAL: 10_000,
  ACTIVE_PRICE_INTERVAL: 30_000,
  STATE_PERSIST_INTERVAL: 60_000,
  STATUS_REPORT_INTERVAL: 30_000,
} as const;

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}
```

---

## 5. Data Flow Sequences

### 5.1 New Event Detection

```
Gamma API → syncer.ts
  │
  ├─ event.id not in knownEventIds?
  │   ├─ YES → upsert uma_events + uma_markets
  │   │        add to knownEventIds, knownMarketIds, marketsByQuestion
  │   │        log "New event: {title} with {n} markets"
  │   │
  │   └─ NO → update changed fields (prices, volume, status)
  │
  └─ Return count of new events/markets
```

### 5.2 Outcome Detection Pipeline

```
                     ┌─────────────────┐
                     │ Markets where:   │
                     │ endDate < NOW()  │
                     │ OR price > 0.85  │
                     │ AND no outcome   │
                     └────────┬────────┘
                              │
                  ┌───────────┴───────────┐
                  │                       │
          category == sports?       category != sports
                  │                       │
                  ▼                       ▼
          ┌───────────┐          ┌────────────────┐
          │ Tier 1    │          │ price > 0.90   │
          │ ESPN API  │          │ OR endDate past?│
          └─────┬─────┘          └───────┬────────┘
                │                        │
        found & FINAL?              YES  │  NO → skip (wait)
          │       │                      │
         YES     NO                      ▼
          │       │              ┌───────────────┐
          ▼       ▼              │ Tier 2        │
       RESOLVED  try next day/  │ Perplexity    │
                 skip           │ Sonar         │
                                └───────┬───────┘
                                        │
                                confidence >= 80?
                                  │         │
                                 YES       NO → skip (retry next cycle)
                                  │
                                  ▼
                            OUTCOME DETECTED
                            → write uma_outcomes
                            → add to hotMarkets
```

### 5.3 UMA Proposal Detection

```
Alchemy WebSocket (< 1s)              Etherscan Backup (60s)
         │                                      │
         └──────────────┬───────────────────────┘
                        │
                  decodeUmaEvent()
                        │
                  extract title from
                  ancillaryData
                        │
                  normalize(title)
                        │
                  lookup in state.marketsByQuestion
                        │
                  ┌─────┴─────┐
                  │           │
              found?       not found
                  │           │
                  ▼           └→ ignore (not our market / crypto)
           processUmaProposal()
                  │
                  ├─ update uma_outcomes.uma_status → "proposed"
                  ├─ record window_duration_sec
                  ├─ set is_opportunity = false
                  └─ remove from hotMarkets
```

---

## 6. Database Schema (SQL)

```sql
-- Migration 032: UMA Arbitrage Scanner tables

CREATE TABLE uma_events (
  id                    serial PRIMARY KEY,
  polymarket_event_id   text UNIQUE NOT NULL,
  title                 text NOT NULL,
  description           text,
  slug                  text,
  category              text DEFAULT 'other',
  subcategory           text DEFAULT 'general',
  tags                  jsonb DEFAULT '[]',
  image                 text,
  start_date            timestamptz,
  end_date              timestamptz,
  neg_risk              boolean DEFAULT false,
  neg_risk_market_id    text,
  active                boolean DEFAULT true,
  closed                boolean DEFAULT false,
  markets_count         integer DEFAULT 0,
  total_volume          numeric DEFAULT 0,
  raw_data              jsonb,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE uma_markets (
  id                        serial PRIMARY KEY,
  event_id                  integer REFERENCES uma_events(id),
  polymarket_market_id      text UNIQUE NOT NULL,
  condition_id              text,
  question_id               text,
  question                  text NOT NULL,
  question_normalized       text NOT NULL,
  description               text,
  slug                      text,
  outcomes                  jsonb DEFAULT '["Yes","No"]',
  outcome_prices            jsonb,
  clob_token_ids            jsonb,
  best_ask                  numeric,
  last_trade_price          numeric,
  spread                    numeric,
  volume                    numeric DEFAULT 0,
  volume_clob               numeric DEFAULT 0,
  volume_1d                 numeric DEFAULT 0,
  volume_1wk                numeric DEFAULT 0,
  volume_1mo                numeric DEFAULT 0,
  one_day_price_change      numeric,
  end_date                  timestamptz,
  resolution_source         text,
  uma_bond                  numeric,
  uma_reward                numeric,
  custom_liveness           integer DEFAULT 7200,
  uma_resolution_statuses   jsonb DEFAULT '[]',
  resolved_by               text,
  active                    boolean DEFAULT true,
  closed                    boolean DEFAULT false,
  accepting_orders          boolean DEFAULT true,
  neg_risk                  boolean DEFAULT false,
  automatically_resolved    boolean DEFAULT false,
  raw_data                  jsonb,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

CREATE TABLE uma_outcomes (
  id                          serial PRIMARY KEY,
  market_id                   integer REFERENCES uma_markets(id),
  detected_outcome            text NOT NULL,
  confidence                  integer NOT NULL,
  detection_tier              text NOT NULL,
  detection_source            text NOT NULL,
  detection_data              jsonb,
  detected_at                 timestamptz NOT NULL,
  uma_status                  text DEFAULT 'none',
  uma_proposed_at             timestamptz,
  uma_proposed_outcome        text,
  uma_proposer                text,
  uma_expiration              timestamptz,
  window_duration_sec         integer,
  winning_price_at_detection  numeric,
  potential_profit_pct        numeric,
  is_opportunity              boolean DEFAULT true,
  is_actionable               boolean DEFAULT false,
  notified                    boolean DEFAULT false,
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_uma_events_active ON uma_events(active, closed);
CREATE INDEX idx_uma_events_end_date ON uma_events(end_date) WHERE active = true;
CREATE INDEX idx_uma_events_polymarket_id ON uma_events(polymarket_event_id);
CREATE INDEX idx_uma_markets_event ON uma_markets(event_id);
CREATE INDEX idx_uma_markets_end_date ON uma_markets(end_date) WHERE active = true;
CREATE INDEX idx_uma_markets_condition ON uma_markets(condition_id);
CREATE INDEX idx_uma_markets_question_norm ON uma_markets(question_normalized);
CREATE INDEX idx_uma_markets_polymarket_id ON uma_markets(polymarket_market_id);
CREATE INDEX idx_uma_outcomes_opportunity ON uma_outcomes(is_opportunity) WHERE is_opportunity = true;
CREATE INDEX idx_uma_outcomes_actionable ON uma_outcomes(is_actionable) WHERE is_actionable = true;
CREATE INDEX idx_uma_outcomes_market ON uma_outcomes(market_id);
CREATE INDEX idx_uma_outcomes_uma_status ON uma_outcomes(uma_status);
```

---

## 7. Dashboard API Routes

### `GET /api/uma/opportunities`

Returns current open arbitrage windows. Dashboard polls this every 5s.

```typescript
// Response
{
  opportunities: [{
    market_question: string,
    event_title: string,
    detected_outcome: string,
    confidence: number,
    winning_price: number,
    profit_pct: number,
    time_since_detection: number,   // seconds
    uma_status: 'none',
    is_actionable: boolean,
    custom_liveness: number,
    polymarket_url: string,
    volume_1d: number,
    spread: number,
  }],
  count: number,
  updated_at: string,
}
```

### `GET /api/uma/events?category=&status=&page=&limit=`

Paginated event browser.

### `GET /api/uma/stats`

```typescript
{
  total_events: number,
  total_markets: number,
  opportunities_today: number,
  opportunities_this_week: number,
  avg_window_duration_sec: number,
  avg_profit_pct: number,
  by_category: Record<string, { count: number, avg_window: number }>,
}
```

---

## 8. ABI Decode — ProposePrice Event

The data field of a ProposePrice log contains ABI-encoded non-indexed params:

```
Offset  Bytes  Field
0       32     identifier (bytes32) — always "YES_OR_NO_QUERY" padded
32      32     timestamp (uint256)
64      32     offset to ancillaryData (uint256) — points to byte 192
96      32     proposedPrice (int256) — 1e18 = YES, 0 = NO
128     32     expirationTimestamp (uint256)
160     32     currency (address) — padded to 32 bytes
192     32     ancillaryData length (uint256)
224+    var    ancillaryData bytes (UTF-8 text)
```

```typescript
function decodeProposePriceData(data: string): {
  proposedPrice: bigint;
  expirationTimestamp: number;
  title: string;
} {
  const hex = data.startsWith('0x') ? data.slice(2) : data;

  const proposedPrice = BigInt('0x' + hex.slice(192, 256));
  const expirationTimestamp = Number(BigInt('0x' + hex.slice(256, 320)));

  const ancLen = Number(BigInt('0x' + hex.slice(384, 448)));
  const ancHex = hex.slice(448, 448 + ancLen * 2);
  const ancText = Buffer.from(ancHex, 'hex').toString('utf-8');

  // Extract title
  const titleMatch = ancText.match(/title:\s*(.+?),\s*description:/);
  const title = titleMatch ? titleMatch[1].trim() : '';

  return { proposedPrice, expirationTimestamp, title };
}
```

---

## 9. Package Configuration

### `package.json`

```json
{
  "name": "uma-scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.47.0",
    "dotenv": "^17.3.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13",
    "typescript": "^5.7.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 10. Deployment

```bash
# Build locally
cd uma && npm run build

# Upload to VPS
scp -r dist/ package.json package-lock.json .env root@46.224.70.178:/opt/polymarket/uma/

# On VPS
cd /opt/polymarket/uma && npm ci --production
pm2 start dist/src/index.js --name uma-scanner
pm2 save
```

---

## 11. Memory Budget

| Component | Estimated RAM |
|-----------|--------------|
| Node.js base | ~30 MB |
| ~6K events in knownEventIds | ~1 MB |
| ~20K markets in knownMarketIds + marketsByQuestion | ~5 MB |
| hotMarkets (5-20 entries) | ~0.01 MB |
| WebSocket connection | ~2 MB |
| Fetch buffers / GC headroom | ~20 MB |
| **Total** | **~60 MB** |

VPS has 2.3 GB available. Comfortable.

---

## 12. Error Handling Strategy

| Failure | Impact | Recovery |
|---------|--------|----------|
| Gamma API down | No new events synced | Retry next 30s cycle. Log warning. |
| Alchemy WS drops | UMA detection falls to Etherscan (60s) | Auto-reconnect with backoff. Log. |
| Etherscan API down | No backup UMA polling | WS is primary anyway. Log warning. |
| Perplexity API down | Non-sports detection paused | Retry next cycle. Sports unaffected. |
| ESPN API changes | Sports detection fails | Falls through to Perplexity. Log error. |
| Supabase down | Writes queue in memory | Retry on next persist cycle. |
| Title match fails | Can't link proposal to market | Log unmatched title for debugging. |
| Out of memory | Process crash | PM2 auto-restart. state.json preserves cursor. |

---

## 13. Implementation Order

| Phase | Scope | What to verify |
|-------|-------|---------------|
| **1** | Skeleton: index.ts, config, logger, state, supabase client | Process starts on VPS via PM2 |
| **2** | Backfill + syncer: fetch all events, upsert to DB | All ~5,636 events in uma_events/uma_markets |
| **3** | Tier 0 price detection | Markets with price > 0.85 flagged in logs |
| **4** | UMA WebSocket + Etherscan backup | Live ProposePrice events logged and matched |
| **5** | Tier 1 sports detection (ESPN) | Sports outcomes detected when game ends |
| **6** | Tier 2 Perplexity detection | Non-sports outcomes detected |
| **7** | Opportunity lifecycle + actionability | Full pipeline: detect → monitor → close |
| **8** | Dashboard API routes | `/api/uma/opportunities` returns data |
| **9** | Dashboard `/uma` page | Live opportunities visible in browser |
| **10** | Price updater (10s/30s) | Real-time profit % on dashboard |
