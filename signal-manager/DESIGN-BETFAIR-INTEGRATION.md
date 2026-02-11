# Betfair Integration Design — Value Bet Detection System

> Design date: 2026-02-10
> Goal: Add Betfair Exchange API adapter to signal manager for Polymarket value bet detection

---

## System Overview

Extend the existing signal-manager architecture to include Betfair Exchange odds as a benchmark for detecting mispriced Polymarket markets.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SIGNAL MANAGER                               │
│                                                                      │
│  ┌────────────────┐              ┌────────────────┐                │
│  │  Polymarket    │              │    Betfair     │                │
│  │  Adapter       │              │   Adapter      │                │
│  │  (existing)    │              │    (NEW)       │                │
│  │                │              │                │                │
│  │ - CLOB WS      │              │ - Stream API   │                │
│  │ - Scores WS    │              │ - Market Data  │                │
│  │ - Discovery    │              │ - Betting API  │                │
│  └───────┬────────┘              └───────┬────────┘                │
│          │                               │                          │
│          └───────────┬───────────────────┘                          │
│                      ▼                                               │
│          ┌───────────────────────┐                                  │
│          │   Event Matcher       │                                  │
│          │   (existing, extend)  │                                  │
│          │                       │                                  │
│          │ - Team lookup table   │                                  │
│          │ - Fuzzy matching      │                                  │
│          │ - Sport/league filter │                                  │
│          └───────────┬───────────┘                                  │
│                      ▼                                               │
│          ┌───────────────────────┐                                  │
│          │   Unified State Store │                                  │
│          │   (existing, extend)  │                                  │
│          │                       │                                  │
│          │ UnifiedEvent {        │                                  │
│          │   markets: {          │                                  │
│          │     ml_home_ft: {     │                                  │
│          │       polymarket: {   │                                  │
│          │         value: 2.10   │                                  │
│          │         timestamp     │                                  │
│          │       },              │                                  │
│          │       betfair: {      │                                  │
│          │         value: 1.85   │                                  │
│          │         timestamp     │                                  │
│          │         depth: {...}  │                                  │
│          │       }               │                                  │
│          │     }                 │                                  │
│          │   }                   │                                  │
│          │ }                     │                                  │
│          └───────────┬───────────┘                                  │
│                      ▼                                               │
│          ┌───────────────────────┐                                  │
│          │  Value Signal Engine  │  ◄─── NEW                        │
│          │  (NEW)                │                                  │
│          │                       │                                  │
│          │ - Edge calculation    │                                  │
│          │ - Threshold filtering │                                  │
│          │ - Alert generation    │                                  │
│          └───────────┬───────────┘                                  │
│                      ▼                                               │
│          ┌───────────────────────┐                                  │
│          │  Signal Dispatcher    │                                  │
│          │  (existing)           │                                  │
│          │                       │                                  │
│          │ - Console logger      │                                  │
│          │ - Value logger (NEW)  │                                  │
│          │ - Alert callbacks     │                                  │
│          └───────────────────────┘                                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Betfair Adapter

**Location**: `src/adapters/betfair/index.ts`

**Purpose**: Connect to Betfair Exchange API, subscribe to markets matching Polymarket sports, normalize odds data.

#### Sub-components

##### A. Betfair Authentication (`auth.ts`)
```typescript
interface BetfairAuthConfig {
  appKey: string;          // Betfair API app key (free)
  username: string;        // Betfair account username
  password: string;        // Betfair account password
  certPath?: string;       // Optional: SSL cert for non-interactive login
}

class BetfairAuth {
  async login(config: BetfairAuthConfig): Promise<string>; // returns session token
  async keepAlive(): Promise<void>;                        // extends session
  isAuthenticated(): boolean;
}
```

**Implementation notes**:
- Use interactive login (username/password) for MVP — simpler than cert-based
- Session tokens last 8 hours by default
- keepAlive extends session before expiry (call every 6 hours)
- Store session token in memory only (no persistence needed)

##### B. Betfair Market Discovery (`discovery.ts`)
```typescript
interface BetfairMarketFilter {
  eventTypeIds?: string[];     // 1=soccer, 2=tennis, 7481=basketball, etc.
  competitionIds?: string[];   // Specific leagues/tournaments
  marketTypeCodes?: string[];  // MATCH_ODDS (h2h), OVER_UNDER_25, etc.
  marketStartTime?: {          // Time range filter
    from?: string;
    to?: string;
  };
}

interface BetfairMarketCatalogItem {
  marketId: string;               // e.g., "1.234567890"
  marketName: string;             // e.g., "Match Odds"
  eventName: string;              // e.g., "Arsenal v Chelsea"
  eventType: string;              // e.g., "Soccer"
  competition: string;            // e.g., "English Premier League"
  marketStartTime: string;        // ISO timestamp
  runners: Array<{
    selectionId: number;
    runnerName: string;           // e.g., "Arsenal", "Chelsea", "The Draw"
  }>;
}

class BetfairDiscovery {
  async listMarketCatalogue(
    filter: BetfairMarketFilter,
    maxResults: number
  ): Promise<BetfairMarketCatalogItem[]>;

  async getEventTypes(): Promise<Array<{ id: string; name: string }>>;
  async getCompetitions(eventTypeId: string): Promise<Array<{ id: string; name: string }>>;
}
```

**Discovery strategy**:
1. On startup, fetch all soccer (`eventTypeId=1`) MATCH_ODDS markets starting within next 24 hours
2. Filter to major competitions: EPL, La Liga, Bundesliga, Serie A, Champions League, etc. (whitelist in config)
3. Repeat for basketball, tennis, hockey based on Polymarket's active sports
4. Refresh discovery every 30 minutes for new markets

##### C. Betfair Stream Client (`stream.ts`)
```typescript
interface BetfairStreamConfig {
  sessionToken: string;
  appKey: string;
  marketIds: string[];          // Markets to subscribe to
  heartbeatMs: number;          // 500-5000, recommended 2000
  conflateMs?: number;          // Optional: throttle updates (e.g., 1000)
}

interface BetfairMarketChange {
  marketId: string;
  status?: 'OPEN' | 'SUSPENDED' | 'CLOSED';
  runners?: Array<{
    id: number;                 // selectionId
    ltp?: number;               // Last traded price (decimal odds)
    atb?: Array<[number, number]>; // Available to back: [[price, size], ...]
    atl?: Array<[number, number]>; // Available to lay: [[price, size], ...]
  }>;
}

class BetfairStreamClient {
  connect(config: BetfairStreamConfig): Promise<void>;
  subscribe(marketIds: string[]): Promise<void>;
  unsubscribe(marketIds: string[]): Promise<void>;
  on(event: 'market_change', handler: (change: BetfairMarketChange) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  disconnect(): Promise<void>;
}
```

**Stream protocol**:
- Connects to `wss://stream-api.betfair.com:443` via TCP socket with SSL
- JSON-RPC style messages
- Authentication message includes session token + app key
- Market subscription message specifies marketIds
- Updates pushed as JSON objects with market changes
- Heartbeat every N ms to detect connection issues
- Auto-reconnect on disconnect with exponential backoff

##### D. Betfair Normalizer (`normalizer.ts`)
```typescript
class BetfairNormalizer {
  normalizeMarketChange(
    change: BetfairMarketChange,
    catalogItem: BetfairMarketCatalogItem
  ): AdapterEventUpdate | null;
}
```

**Normalization logic**:
- Extract event name, parse teams: `"Arsenal v Chelsea"` → `home="Arsenal"`, `away="Chelsea"`
- Map Betfair market types to canonical keys:
  - `MATCH_ODDS` → `ml_home_ft`, `ml_away_ft`, `draw_ft`
  - `OVER_UNDER_25` → `o_2_5_ft`, `u_2_5_ft`
  - `OVER_UNDER_35` → `o_3_5_ft`, `u_3_5_ft`
  - `ASIAN_HANDICAP_-1_5` → `handicap_home_m1_5_ft`
  - `BTTS_YES` → `btts_yes_ft`, `btts_no_ft`
- Map runner names to canonical outcomes:
  - Runner name matches `home` → `ml_home_ft`
  - Runner name matches `away` → `ml_away_ft`
  - Runner name = "The Draw" → `draw_ft`
  - Runner name = "Over 2.5" → `o_2_5_ft`
- Use `ltp` (last traded price) as primary odds value
- Fallback to best `atb` (available to back) price if `ltp` missing
- Include depth data in SourceOdds: `{ value, timestamp, depth: { atb, atl } }`

**Sport/league mapping**:
```typescript
const BETFAIR_EVENT_TYPE_MAP: Record<string, string> = {
  '1': 'football',      // Soccer
  '7522': 'basketball', // Basketball
  '7511': 'baseball',   // Baseball
  '7524': 'tennis',     // Tennis
  '6423': 'americanfootball', // American Football
  '7': 'horseracing',   // (exclude if not on Polymarket)
  // ... add as needed
};

const BETFAIR_COMPETITION_MAP: Record<string, string> = {
  '10932509': 'EPL',           // English Premier League
  '117': 'La Liga',            // Spanish La Liga
  '59': 'Bundesliga',          // German Bundesliga
  '81': 'Serie A',             // Italian Serie A
  '228': 'Champions League',   // UEFA Champions League
  // ... whitelist major competitions
};
```

#### Main Adapter Class

**File**: `src/adapters/betfair/index.ts`
```typescript
export class BetfairAdapter implements IAdapter {
  private auth: BetfairAuth;
  private discovery: BetfairDiscovery;
  private stream: BetfairStreamClient;
  private normalizer: BetfairNormalizer;
  private marketCatalog: Map<string, BetfairMarketCatalogItem>;
  private discoveryInterval: NodeJS.Timeout | null = null;

  constructor(private config: BetfairAdapterConfig) {
    this.auth = new BetfairAuth();
    this.discovery = new BetfairDiscovery();
    this.stream = new BetfairStreamClient();
    this.normalizer = new BetfairNormalizer();
    this.marketCatalog = new Map();
  }

  async start(): Promise<void> {
    // 1. Authenticate
    const sessionToken = await this.auth.login({
      appKey: this.config.appKey,
      username: this.config.username,
      password: this.config.password,
    });

    // 2. Discover markets
    await this.runDiscovery();

    // 3. Connect to stream
    await this.stream.connect({
      sessionToken,
      appKey: this.config.appKey,
      marketIds: Array.from(this.marketCatalog.keys()),
      heartbeatMs: 2000,
      conflateMs: 1000, // Throttle to 1 update/second per market
    });

    // 4. Subscribe to market changes
    this.stream.on('market_change', (change) => this.handleMarketChange(change));

    // 5. Schedule periodic discovery refresh (every 30 min)
    this.discoveryInterval = setInterval(() => this.runDiscovery(), 30 * 60 * 1000);

    // 6. Schedule keep-alive (every 6 hours)
    setInterval(() => this.auth.keepAlive(), 6 * 60 * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    await this.stream.disconnect();
  }

  private async runDiscovery(): Promise<void> {
    const filter: BetfairMarketFilter = {
      eventTypeIds: ['1', '7522', '7524'], // Soccer, Basketball, Tennis
      marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'OVER_UNDER_35'],
      marketStartTime: {
        from: new Date().toISOString(),
        to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    };

    const markets = await this.discovery.listMarketCatalogue(filter, 1000);

    // Update catalog
    const newMarketIds: string[] = [];
    for (const market of markets) {
      if (!this.marketCatalog.has(market.marketId)) {
        newMarketIds.push(market.marketId);
      }
      this.marketCatalog.set(market.marketId, market);
    }

    // Subscribe to new markets
    if (newMarketIds.length > 0 && this.stream) {
      await this.stream.subscribe(newMarketIds);
    }
  }

  private handleMarketChange(change: BetfairMarketChange): void {
    const catalogItem = this.marketCatalog.get(change.marketId);
    if (!catalogItem) return;

    const update = this.normalizer.normalizeMarketChange(change, catalogItem);
    if (update) {
      this.emit('event_update', update);
    }
  }
}
```

---

### 2. Event Matcher Extensions

**File**: `src/matching/event-matcher.ts` (extend existing)

**New requirements**:
- Match Betfair event names (`"Arsenal v Chelsea"`) to Polymarket event names (`"Arsenal vs Chelsea"`)
- Betfair uses `"v"` as separator, Polymarket uses `"vs"`
- Normalize both to common format before matching: `normalizeTeamName()` already handles this
- Add Betfair-specific team aliases to `data/team-mappings.json`

**Example aliases to add**:
```json
{
  "canonical": "Arsenal",
  "aliases": ["Arsenal", "Arsenal FC", "The Gunners"]
},
{
  "canonical": "Chelsea",
  "aliases": ["Chelsea", "Chelsea FC", "The Blues"]
}
```

**No code changes needed** — existing fuzzy matcher should handle Betfair events with minimal alias additions.

---

### 3. Unified State Store Extensions

**File**: `src/core/state-store.ts` (extend existing)

**Current structure** (already supports multiple sources):
```typescript
interface UnifiedEvent {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: Date;
  markets: Record<string, Record<string, SourceOdds>>; // market key → source ID → odds
}

interface SourceOdds {
  value: number;
  timestamp: number;
}
```

**Extension needed**:
```typescript
interface SourceOdds {
  value: number;
  timestamp: number;
  depth?: {                  // NEW: optional depth data (Betfair only)
    atb?: Array<[number, number]>; // [[price, size], ...]
    atl?: Array<[number, number]>;
  };
}
```

**Why**: Betfair provides order book depth (available to back/lay at different prices). Store this for advanced signal logic (e.g., check if large size available at good price).

**No other changes needed** — existing state store already handles multi-source odds.

---

### 4. Value Signal Engine (NEW)

**File**: `src/signals/value-detector.ts` (new file)

**Purpose**: Calculate edge between Polymarket and Betfair odds, generate alerts when edge exceeds threshold.

```typescript
interface ValueSignalConfig {
  minEdgePercent: number;          // e.g., 5 = alert when edge > 5%
  minLiquidityUSD: number;         // e.g., 500 = only alert if Betfair liquidity > $500
  allowedSports: string[];         // e.g., ['football', 'basketball']
  allowedMarkets: string[];        // e.g., ['ml_home_ft', 'ml_away_ft', 'draw_ft']
}

interface ValueAlert {
  eventId: string;
  eventName: string;
  sport: string;
  league: string;
  marketKey: string;
  polymarketOdds: number;
  betfairOdds: number;
  polymarketImpliedProb: number;   // 1 / odds (no margin adjustment)
  betfairImpliedProb: number;      // 1 / odds (no margin adjustment)
  edge: number;                    // percentage points
  direction: 'polymarket_over' | 'polymarket_under';
  betfairLiquidity: number;        // USD available at best price
  timestamp: number;
}

class ValueSignalEngine {
  constructor(private config: ValueSignalConfig) {}

  // Called by signal dispatcher when state updates
  detectValue(event: UnifiedEvent, changedKeys: string[], source: string): ValueAlert | null {
    // 1. Filter: only process events with both polymarket + betfair data
    for (const marketKey of changedKeys) {
      const marketData = event.markets[marketKey];
      if (!marketData || !marketData.polymarket || !marketData.betfair) continue;

      // 2. Filter: sport/market allowed?
      if (!this.config.allowedSports.includes(event.sport)) continue;
      if (!this.config.allowedMarkets.includes(marketKey)) continue;

      const pmOdds = marketData.polymarket.value;
      const bfOdds = marketData.betfair.value;

      // 3. Calculate implied probabilities (no margin adjustment for simplicity)
      const pmProb = (1 / pmOdds) * 100;
      const bfProb = (1 / bfOdds) * 100;

      // 4. Calculate edge (percentage points)
      const edge = Math.abs(pmProb - bfProb);

      // 5. Filter: edge exceeds threshold?
      if (edge < this.config.minEdgePercent) continue;

      // 6. Check Betfair liquidity
      const liquidity = this.calculateLiquidity(marketData.betfair.depth);
      if (liquidity < this.config.minLiquidityUSD) continue;

      // 7. Generate alert
      return {
        eventId: event.id,
        eventName: `${event.homeTeam} vs ${event.awayTeam}`,
        sport: event.sport,
        league: event.league,
        marketKey,
        polymarketOdds: pmOdds,
        betfairOdds: bfOdds,
        polymarketImpliedProb: pmProb,
        betfairImpliedProb: bfProb,
        edge,
        direction: pmProb > bfProb ? 'polymarket_over' : 'polymarket_under',
        betfairLiquidity: liquidity,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  private calculateLiquidity(depth?: SourceOdds['depth']): number {
    if (!depth?.atb || depth.atb.length === 0) return 0;

    // Sum available liquidity at best 3 price levels (atb = available to back)
    const topLevels = depth.atb.slice(0, 3);
    const totalSize = topLevels.reduce((sum, [price, size]) => sum + size, 0);

    // Assume 1 size unit ≈ $1 (approximation, Betfair uses GBP but close enough)
    return totalSize;
  }
}
```

**Usage in signal dispatcher**:
```typescript
// src/core/signal-dispatcher.ts (extend existing)
import { ValueSignalEngine } from '../signals/value-detector';

class SignalDispatcher {
  private valueEngine: ValueSignalEngine;

  constructor() {
    this.valueEngine = new ValueSignalEngine({
      minEdgePercent: 5,
      minLiquidityUSD: 500,
      allowedSports: ['football', 'basketball', 'tennis'],
      allowedMarkets: ['ml_home_ft', 'ml_away_ft', 'draw_ft', 'o_2_5_ft', 'u_2_5_ft'],
    });
  }

  dispatch(event: UnifiedEvent, changedKeys: string[], source: string): void {
    // Existing signals...

    // NEW: Value detection
    const valueAlert = this.valueEngine.detectValue(event, changedKeys, source);
    if (valueAlert) {
      this.emitValueAlert(valueAlert);
    }
  }

  private emitValueAlert(alert: ValueAlert): void {
    const direction = alert.direction === 'polymarket_over' ? '📈 OVERPRICED' : '📉 UNDERPRICED';
    const edgeSign = alert.direction === 'polymarket_over' ? '+' : '-';

    console.log(`\n🎯 VALUE OPPORTUNITY ${direction}`);
    console.log(`Event: ${alert.eventName} (${alert.league})`);
    console.log(`Market: ${alert.marketKey}`);
    console.log(`Polymarket: ${alert.polymarketOdds.toFixed(2)} (${alert.polymarketImpliedProb.toFixed(1)}%)`);
    console.log(`Betfair:    ${alert.betfairOdds.toFixed(2)} (${alert.betfairImpliedProb.toFixed(1)}%)`);
    console.log(`Edge:       ${edgeSign}${alert.edge.toFixed(1)}% | Liquidity: $${alert.betfairLiquidity.toFixed(0)}`);
    console.log(`---`);
  }
}
```

**Sample output**:
```
🎯 VALUE OPPORTUNITY 📈 OVERPRICED
Event: Arsenal vs Chelsea (English Premier League)
Market: ml_home_ft
Polymarket: 2.10 (47.6%)
Betfair:    1.85 (54.1%)
Edge:       +6.5% | Liquidity: $2,340
---
```

---

### 5. Configuration

**File**: `config/default.ts` (extend existing)

```typescript
export const config = {
  adapters: {
    polymarket: {
      enabled: true,
      // ... existing config
    },
    betfair: {
      enabled: true,  // NEW
      appKey: process.env.BETFAIR_APP_KEY || '',
      username: process.env.BETFAIR_USERNAME || '',
      password: process.env.BETFAIR_PASSWORD || '',
      sports: ['football', 'basketball', 'tennis'], // Match Polymarket coverage
      competitions: {
        football: [
          '10932509', // EPL
          '117',      // La Liga
          '59',       // Bundesliga
          '81',       // Serie A
          '228',      // Champions League
          '12',       // EFL Championship
        ],
        basketball: [
          '7522',     // NBA
        ],
        tennis: [
          // All tennis (no competition filter)
        ],
      },
      streamConfig: {
        heartbeatMs: 2000,
        conflateMs: 1000, // Throttle to 1 update/sec
      },
    },
    onexbet: {
      enabled: false,  // Disable 1xbet for now
    },
  },
  signals: {
    value: {
      minEdgePercent: 5,
      minLiquidityUSD: 500,
      allowedSports: ['football', 'basketball', 'tennis'],
      allowedMarkets: ['ml_home_ft', 'ml_away_ft', 'draw_ft', 'o_2_5_ft', 'u_2_5_ft'],
    },
  },
};
```

**Environment variables** (`.env` file):
```bash
# Betfair API credentials (get from https://developer.betfair.com)
BETFAIR_APP_KEY=your_app_key_here
BETFAIR_USERNAME=your_betfair_username
BETFAIR_PASSWORD=your_betfair_password
```

---

## Data Flow Sequence

### Startup Sequence
```
1. Engine starts
2. BetfairAdapter.start()
   a. Authenticate → get session token
   b. Discover markets (soccer/basketball/tennis, next 24h)
   c. Connect to Stream API (WSS)
   d. Subscribe to discovered market IDs
   e. Start heartbeat + keep-alive timers
3. PolymarketAdapter.start() (existing)
4. Both adapters emit event_update → EventMatcher → StateStore → SignalDispatcher
```

### Runtime Data Flow
```
Betfair Stream API
  ↓ (push update)
BetfairStreamClient receives market_change
  ↓
BetfairNormalizer.normalizeMarketChange()
  ↓
AdapterEventUpdate {
  source: 'betfair',
  sport: 'football',
  league: 'English Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  startTime: Date,
  markets: {
    ml_home_ft: { value: 1.85, timestamp: ... },
    draw_ft: { value: 3.50, timestamp: ... },
    ml_away_ft: { value: 4.20, timestamp: ... },
  }
}
  ↓
EventMatcher.match()
  - Lookup: "Arsenal" + "Chelsea" → event ID
  - Fuzzy match if not found
  ↓
StateStore.updateEvent()
  - Merge betfair odds into existing event (if Polymarket already tracked it)
  - event.markets.ml_home_ft.betfair = { value: 1.85, timestamp, depth }
  ↓
SignalDispatcher.dispatch(event, ['ml_home_ft'], 'betfair')
  ↓
ValueSignalEngine.detectValue()
  - Compare event.markets.ml_home_ft.polymarket vs .betfair
  - If edge > 5% → return ValueAlert
  ↓
Console output:
  🎯 VALUE OPPORTUNITY 📈 OVERPRICED
  Event: Arsenal vs Chelsea (English Premier League)
  Market: ml_home_ft
  Polymarket: 2.10 (47.6%)
  Betfair:    1.85 (54.1%)
  Edge:       +6.5% | Liquidity: $2,340
```

---

## Dependencies

### New NPM Packages
```json
{
  "dependencies": {
    "betfair-ts": "^1.0.0"  // TypeScript client for Betfair API (if available)
  }
}
```

**Alternative**: If no good npm package exists, implement raw Betfair API calls using `https` module and WebSocket (`ws` already installed).

### Betfair API Documentation
- Developer portal: https://developer.betfair.com
- Stream API spec: https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/Exchange+Stream+API
- Python reference (port to TS): https://github.com/betfair-datascientists/API

---

## Testing Strategy

### Unit Tests
- `BetfairNormalizer` — test market type mapping, team name parsing
- `ValueSignalEngine` — test edge calculation, threshold filtering
- `BetfairAuth` — mock login, test token refresh

### Integration Tests
- Full adapter flow: mock Betfair Stream API responses, verify AdapterEventUpdates emitted
- Event matching: verify Betfair events match to Polymarket events correctly

### Manual Testing
1. Run signal manager with Betfair enabled
2. Verify console shows both Polymarket and Betfair odds for same events
3. Artificially create edge by only running one adapter → verify value alerts trigger
4. Test reconnection: kill Betfair connection, verify auto-reconnect

---

## Rollout Plan

### Phase 1: Basic Integration (MVP)
- Implement BetfairAuth, BetfairDiscovery, BetfairStreamClient
- Implement BetfairNormalizer (MATCH_ODDS only → ml_home/away/draw)
- Extend StateStore to store Betfair odds
- Test: verify Betfair odds appear in console alongside Polymarket

### Phase 2: Value Detection
- Implement ValueSignalEngine
- Wire into SignalDispatcher
- Test: create artificial edge scenarios, verify alerts

### Phase 3: Additional Markets
- Add OVER_UNDER → o_2_5_ft, u_2_5_ft
- Add BTTS → btts_yes_ft, btts_no_ft
- Expand sports: basketball, tennis

### Phase 4: Advanced Features
- Historical tracking: log all value alerts to JSON file
- Filtering: ignore events with low Polymarket volume
- Betfair margin adjustment: use overround to adjust implied probabilities
- Alert webhooks: POST to Discord/Telegram bot

---

## Edge Cases & Error Handling

### 1. Betfair market not found on Polymarket
- EventMatcher returns no match
- Betfair odds stored in state but no Polymarket comparison possible
- No value alert generated (requires both sources)
- **Solution**: Log unmatched events for debugging, expand team aliases

### 2. Polymarket market not found on Betfair
- Common for niche Polymarket sports (e.g., some esports)
- No Betfair odds available
- **Solution**: Value detection skips these events (requires both sources)

### 3. Session token expires mid-stream
- Stream connection drops
- **Solution**: Auto-reconnect triggers re-authentication, new stream connection

### 4. Betfair API rate limits
- Unlikely with streaming (push-based)
- If discovery polling too aggressive, Betfair may throttle
- **Solution**: Discovery refresh every 30 min (conservative), use conflation on stream

### 5. Large edge due to stale odds
- Betfair last updated 5 min ago, Polymarket just updated
- False positive value alert
- **Solution**: Add timestamp check — only compare if both updated within last 60 seconds

### 6. Market suspended on Betfair
- `status: 'SUSPENDED'` in market change
- Odds invalid during suspension
- **Solution**: Skip value detection if Betfair market not `OPEN`

---

## Performance Considerations

### Memory
- Each Betfair market ≈ 1KB (catalog + depth data)
- 1,000 markets ≈ 1MB
- Expect ~500 active markets at peak (soccer + basketball + tennis)
- **Impact**: Negligible (<10MB total state)

### CPU
- Stream updates pushed, not polled → minimal CPU
- Conflation (1 update/sec) reduces event volume
- Value detection: O(1) per market update (simple arithmetic)
- **Impact**: Negligible (<5% CPU)

### Network
- Stream connection: ~10KB/s at moderate activity
- Discovery refresh: ~100KB every 30 min
- **Impact**: <1 Mbps sustained

---

## Security Considerations

### Credentials Storage
- Store Betfair username/password in `.env` (NOT in code)
- Session token in memory only (no persistence)
- **Never commit `.env` to git**

### API Key Exposure
- Betfair app key is low-sensitivity (public in API calls)
- Session token is high-sensitivity (grants account access)
- Ensure session token not logged or exposed

### Rate Limiting
- Respect Betfair's fair use policy
- Streaming is preferred over polling (Betfair guidance)
- Discovery capped at 1000 markets per request

---

## Monitoring & Observability

### Logs
- Adapter start/stop
- Authentication success/failure
- Discovery: markets found, subscribed
- Stream: connection status, reconnects
- Value alerts: all fields logged

### Metrics (future)
- Events matched: Polymarket + Betfair overlap %
- Value alerts per hour
- Average edge when alert triggered
- Betfair API latency

---

## Future Enhancements

### 1. Historical Value Tracking
- Store all value alerts in SQLite/Postgres
- Track which alerts resulted in profitable trades
- Calculate ROI if alerts were followed

### 2. Advanced Edge Calculation
- Adjust implied probabilities for overround (margin)
- Weight Betfair exchange vs Polymarket based on liquidity
- Use volume-weighted average Betfair price (not just best price)

### 3. Multi-Source Consensus
- Add The Odds API ($59/mo) → compare Polymarket vs Betfair vs Pinnacle
- Consensus fair odds = weighted average of sharp books
- Higher confidence when all sources agree Polymarket mispriced

### 4. Automated Trading
- Polymarket API integration (place orders)
- Risk management (max position size, stop loss)
- Paper trading mode first

### 5. Dashboard Integration
- Add "Value Bets" tab to existing Polymarket dashboard
- Show live value opportunities with sortable columns
- Click to view event details + historical edge chart

---

## Open Questions

1. **Betfair account tier**: Free account sufficient or need premium for full API access?
   - **Research**: Check Betfair developer docs for personal use limits
2. **Team name mapping coverage**: How many aliases needed for accurate matching?
   - **Approach**: Start with top 50 soccer teams, expand as mismatches found
3. **Optimal edge threshold**: 5% too high/low?
   - **Approach**: Start at 5%, tune based on alert volume and false positive rate
4. **Polymarket volume filter**: Should we ignore low-liquidity Polymarket markets?
   - **Approach**: Phase 4 enhancement, not MVP blocker

---

## Summary

This design extends the signal manager with a Betfair Exchange adapter to enable real-time value bet detection against Polymarket. The architecture leverages existing components (event matcher, state store, signal dispatcher) and adds:

1. **BetfairAdapter** — connects to Betfair Stream API, normalizes odds
2. **ValueSignalEngine** — compares Polymarket vs Betfair, alerts on edge > threshold
3. **Config extensions** — Betfair credentials, sport/league filters
4. **Console alerts** — formatted value opportunity notifications

**Development effort**: ~3-5 days for MVP (basic integration + value detection).

**Next step**: Review this design, then use `/sc:implement` to build the components.
