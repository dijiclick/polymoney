# Signal Manager — System Design

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        SIGNAL MANAGER                            │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Polymarket  │  │   1xbet     │  │  Future...  │  ADAPTERS   │
│  │  Adapter    │  │  Adapter    │  │  Adapter    │  (Layer 1)  │
│  │  (WS)       │  │  (HTTP)     │  │  (WS/HTTP)  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────┐                │
│  │            ADAPTER REGISTRY                  │  (Layer 2)    │
│  │     registers, starts, stops, monitors       │               │
│  └─────────────────────┬───────────────────────┘                │
│                        │                                         │
│                        ▼  AdapterUpdate                          │
│  ┌─────────────────────────────────────────────┐                │
│  │            EVENT MATCHER                     │  (Layer 3)    │
│  │   resolve source event → canonical event     │               │
│  │   pre-computed lookup + fuzzy fallback        │               │
│  └─────────────────────┬───────────────────────┘                │
│                        │                                         │
│                        ▼  MatchedUpdate                          │
│  ┌─────────────────────────────────────────────┐                │
│  │            STATE STORE                       │  (Layer 4)    │
│  │   Map<canonical_id, UnifiedEvent>            │               │
│  │   in-place mutations, object pooling          │               │
│  └─────────────────────┬───────────────────────┘                │
│                        │                                         │
│                        ▼  (event, changedKeys, source)           │
│  ┌─────────────────────────────────────────────┐                │
│  │            SIGNAL DISPATCHER                 │  (Layer 5)    │
│  │   pluggable signal functions                  │               │
│  │   default: no-op / console.log                │               │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Single-threaded.** Research confirms worker thread transfer overhead (50-200µs) exceeds the processing cost of sub-10KB messages. Main thread with object pools and GC tuning is the optimal path for per-message latency.

---

## 2. Directory Structure

```
signal-manager/
├── src/
│   ├── index.ts                    # Entry point — boots everything
│   ├── core/
│   │   ├── engine.ts               # Orchestrator: wires adapters → matcher → store → signals
│   │   ├── state-store.ts          # In-memory Map<id, UnifiedEvent>, in-place mutations
│   │   ├── signal-dispatcher.ts    # Manages pluggable signal functions
│   │   └── object-pool.ts          # Pre-allocated object pools for hot path
│   ├── adapters/
│   │   ├── adapter.interface.ts    # IAdapter interface definition
│   │   ├── adapter-registry.ts     # Registers, starts, stops, monitors adapters
│   │   ├── polymarket/
│   │   │   ├── index.ts            # PolymarketAdapter implements IAdapter
│   │   │   ├── clob-ws.ts          # CLOB WebSocket connection + parsing
│   │   │   ├── scores-ws.ts        # Sports live scores WebSocket
│   │   │   ├── discovery.ts        # Gamma API: sports → events → markets → token IDs
│   │   │   └── normalizer.ts       # Raw Polymarket data → AdapterUpdate
│   │   └── onexbet/
│   │       ├── index.ts            # OnexbetAdapter implements IAdapter
│   │       ├── live-feed.ts        # HTTP polling of LiveFeed endpoints
│   │       ├── discovery.ts        # Sport/league/event enumeration
│   │       ├── normalizer.ts       # Raw 1xbet data → AdapterUpdate
│   │       └── market-map.ts       # T-code → canonical market key mapping
│   ├── matching/
│   │   ├── event-matcher.ts        # Hybrid: lookup table + fuzzy fallback
│   │   ├── team-lookup.ts          # Pre-computed team name → canonical ID
│   │   ├── fuzzy.ts                # Jaro-Winkler + blocking by league+date
│   │   └── normalizer.ts           # Team name normalization (lowercase, strip diacritics, etc.)
│   ├── types/
│   │   ├── unified-event.ts        # UnifiedEvent, MarketEntry, TeamInfo
│   │   ├── adapter-update.ts       # AdapterUpdate (what adapters emit)
│   │   ├── market-keys.ts          # Market key constants and builder helpers
│   │   └── config.ts               # Configuration types
│   └── util/
│       ├── logger.ts               # Structured logging
│       ├── odds.ts                  # Odds conversion (ask→decimal, american→decimal, etc.)
│       └── timing.ts               # High-resolution timing helpers (process.hrtime.bigint)
├── data/
│   ├── team-mappings.json          # Pre-computed team name aliases
│   └── market-type-maps/
│       ├── onexbet.json            # 1xbet T-code → canonical key
│       └── polymarket.json         # Polymarket market type → canonical key
├── config/
│   └── default.ts                  # Default config (poll intervals, endpoints, thresholds)
├── package.json
├── tsconfig.json
├── REQUIREMENTS.md
└── DESIGN.md
```

---

## 3. TypeScript Interfaces

### 3a. UnifiedEvent (the core data structure)

```typescript
// types/unified-event.ts

interface SourceOdds {
  value: number;       // Decimal odds (e.g. 1.85, 4.00)
  timestamp: number;   // Unix ms when received from source
}

interface MarketSources {
  [sourceId: string]: SourceOdds;   // e.g. { polymarket: {...}, onexbet: {...} }
}

interface TeamInfo {
  name: string;                       // Canonical name ("manchester_united")
  aliases: { [source: string]: string }; // { onexbet: "Manchester United", polymarket: "Man Utd" }
}

interface EventStats {
  score?: { home: number; away: number };
  period?: string;       // "1h", "2h", "q1", "ot", ...
  elapsed?: string;      // "45:00", "Q3 5:18"
  [key: string]: any;    // Sport-specific: corners, cards, rounds, maps, etc.
}

type EventStatus = 'scheduled' | 'live' | 'ended' | 'canceled';

interface UnifiedEvent {
  id: string;            // Canonical event ID
  sport: string;         // "soccer", "basketball", "csgo", ...
  league: string;        // "premier_league", "nba", ...
  startTime: number;     // Scheduled start, Unix ms
  status: EventStatus;
  home: TeamInfo;
  away: TeamInfo;
  stats: EventStats;
  markets: { [marketKey: string]: MarketSources };  // Flat keys
  _lastUpdate: number;   // Internal: last update timestamp for cleanup
}
```

### 3b. AdapterUpdate (what adapters emit)

```typescript
// types/adapter-update.ts

interface AdapterMarketUpdate {
  key: string;          // Canonical market key (e.g. "o2_5_ft")
  value: number;        // Decimal odds
}

interface AdapterEventUpdate {
  sourceId: string;          // "polymarket", "onexbet"
  sourceEventId: string;     // Source-specific event ID

  // Event identification (for matching)
  sport: string;
  league: string;
  startTime: number;         // Unix ms
  homeTeam: string;          // Raw name from source
  awayTeam: string;          // Raw name from source

  // Status + stats (optional, may not change every update)
  status?: EventStatus;
  stats?: Partial<EventStats>;

  // Markets (the main payload — only include changed markets)
  markets: AdapterMarketUpdate[];

  // Timestamp of this update
  timestamp: number;
}
```

### 3c. Adapter Interface

```typescript
// adapters/adapter.interface.ts

type AdapterStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';

type UpdateCallback = (update: AdapterEventUpdate) => void;

interface IAdapter {
  readonly sourceId: string;       // "polymarket", "onexbet"
  start(): Promise<void>;
  stop(): Promise<void>;
  onUpdate(callback: UpdateCallback): void;
  getStatus(): AdapterStatus;
}
```

### 3d. Signal Function Interface

```typescript
// core/signal-dispatcher.ts

type SignalFunction = (
  event: UnifiedEvent,
  changedKeys: string[],   // Which market keys changed in this update
  source: string            // Which adapter triggered this update
) => void;
```

### 3e. Configuration

```typescript
// types/config.ts

interface AdapterConfig {
  enabled: boolean;
  // Polymarket-specific
  clobWsUrl?: string;
  scoresWsUrl?: string;
  gammaApiUrl?: string;
  pingIntervalMs?: number;
  // 1xbet-specific
  liveFeedBaseUrl?: string;
  pollIntervalMs?: number;
  sportIds?: number[];
}

interface MatcherConfig {
  fuzzyThreshold: number;          // Jaro-Winkler score, default 0.85
  kickoffToleranceMs: number;      // ±30 min default
  teamMappingsPath: string;        // Path to team-mappings.json
}

interface Config {
  adapters: { [sourceId: string]: AdapterConfig };
  matcher: MatcherConfig;
  cleanupIntervalMs: number;       // How often to sweep ended events (default 60s)
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

---

## 4. Data Flow (Hot Path)

```
 Source WS/HTTP message arrives
           │
           ▼
 ┌─────────────────────────┐
 │   Adapter.parse()       │  Adapter-specific: parse raw JSON/binary
 │   Adapter.normalize()   │  Convert to AdapterEventUpdate
 │                          │  - Map source market codes → canonical keys
 │                          │  - Convert odds to decimal
 │                          │  - Only emit changed markets (diff detection)
 └────────────┬────────────┘
              │ AdapterEventUpdate
              ▼
 ┌─────────────────────────┐
 │   EventMatcher.match()  │  1. normalize(homeTeam, awayTeam)
 │                          │  2. lookup table → hit? → canonical ID (O(1), <1µs)
 │                          │  3. miss? → block by league+date → fuzzy match (<50ms)
 │                          │  4. still miss? → create new event (single-source)
 │                          │  5. cache new mapping for future
 └────────────┬────────────┘
              │ canonicalEventId
              ▼
 ┌─────────────────────────┐
 │   StateStore.update()   │  1. get or create UnifiedEvent in Map
 │                          │  2. merge team aliases
 │                          │  3. update stats (in-place)
 │                          │  4. update markets (in-place, track changedKeys[])
 │                          │  5. set _lastUpdate timestamp
 └────────────┬────────────┘
              │ (event, changedKeys, source)
              ▼
 ┌─────────────────────────┐
 │ SignalDispatcher.emit()  │  Call each registered signal function synchronously
 │                          │  Default: no-op
 └──────────────────────────┘
```

**Critical path metrics target**: <3ms p50, <10ms p99 (message receipt → signal invocation)

---

## 5. Module Designs

### 5a. Engine (Orchestrator)

```typescript
// core/engine.ts — pseudo-code

class Engine {
  private registry: AdapterRegistry;
  private matcher: EventMatcher;
  private store: StateStore;
  private signals: SignalDispatcher;
  private cleanupTimer: NodeJS.Timer;

  constructor(config: Config) {
    this.store = new StateStore();
    this.matcher = new EventMatcher(config.matcher);
    this.signals = new SignalDispatcher();
    this.registry = new AdapterRegistry();

    // Cleanup sweep for ended events
    this.cleanupTimer = setInterval(() => this.store.sweep(), config.cleanupIntervalMs);
  }

  registerAdapter(adapter: IAdapter): void {
    adapter.onUpdate((update) => this.handleUpdate(update));
    this.registry.register(adapter);
  }

  registerSignal(fn: SignalFunction): void {
    this.signals.register(fn);
  }

  private handleUpdate(update: AdapterEventUpdate): void {
    // 1. Match to canonical event
    const eventId = this.matcher.match(update);

    // 2. Apply update to state
    const { event, changedKeys } = this.store.update(eventId, update);

    // 3. Fire signals
    this.signals.emit(event, changedKeys, update.sourceId);
  }

  async start(): Promise<void> {
    await this.registry.startAll();
  }

  async stop(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.registry.stopAll();
  }

  // Query API (for future REST/WS layer)
  getEvent(id: string): UnifiedEvent | undefined {
    return this.store.get(id);
  }

  getAllEvents(): UnifiedEvent[] {
    return this.store.getAll();
  }
}
```

### 5b. StateStore

```typescript
// core/state-store.ts — pseudo-code

class StateStore {
  private events: Map<string, UnifiedEvent> = new Map();

  update(eventId: string, update: AdapterEventUpdate): { event: UnifiedEvent; changedKeys: string[] } {
    let event = this.events.get(eventId);
    const changedKeys: string[] = [];

    if (!event) {
      // Create new event (in-place, no spread operators)
      event = this.createEvent(eventId, update);
      this.events.set(eventId, event);
      // All markets are "changed" for new events
      for (const m of update.markets) changedKeys.push(m.key);
    } else {
      // Merge markets (in-place mutation)
      for (const m of update.markets) {
        if (!event.markets[m.key]) {
          event.markets[m.key] = {};
        }
        const existing = event.markets[m.key][update.sourceId];
        // Only mark as changed if value actually changed
        if (!existing || existing.value !== m.value) {
          changedKeys.push(m.key);
        }
        event.markets[m.key][update.sourceId] = { value: m.value, timestamp: update.timestamp };
      }

      // Merge stats (in-place)
      if (update.stats) {
        Object.assign(event.stats, update.stats);
      }

      // Merge status
      if (update.status) {
        event.status = update.status;
      }

      // Merge alias
      event.home.aliases[update.sourceId] = update.homeTeam;
      event.away.aliases[update.sourceId] = update.awayTeam;
    }

    event._lastUpdate = Date.now();
    return { event, changedKeys };
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, event] of this.events) {
      // Remove ended events after 5 minutes of no updates
      if (event.status === 'ended' && now - event._lastUpdate > 5 * 60 * 1000) {
        this.events.delete(id);
      }
    }
  }

  get(id: string): UnifiedEvent | undefined { return this.events.get(id); }
  getAll(): UnifiedEvent[] { return Array.from(this.events.values()); }
  get size(): number { return this.events.size; }
}
```

### 5c. EventMatcher

```typescript
// matching/event-matcher.ts — pseudo-code

class EventMatcher {
  private teamLookup: Map<string, string>;    // "source:rawname" → canonical
  private eventIndex: Map<string, string[]>;   // "league:date" → [eventId, ...]
  private config: MatcherConfig;

  constructor(config: MatcherConfig) {
    this.config = config;
    this.teamLookup = new Map();
    this.eventIndex = new Map();
    this.loadTeamMappings(config.teamMappingsPath);
  }

  match(update: AdapterEventUpdate): string {
    const homeCanonical = this.resolveTeam(update.sourceId, update.homeTeam);
    const awayCanonical = this.resolveTeam(update.sourceId, update.awayTeam);

    if (homeCanonical && awayCanonical) {
      // Fast path: both teams known → deterministic ID
      return this.buildEventId(update.sport, update.league, update.startTime, homeCanonical, awayCanonical);
    }

    // Slow path: fuzzy match within same league + date block
    const blockKey = `${update.sport}:${update.league}:${this.dateKey(update.startTime)}`;
    const candidates = this.eventIndex.get(blockKey) || [];

    for (const candidateId of candidates) {
      const score = this.fuzzyScore(update, candidateId);
      if (score >= this.config.fuzzyThreshold) {
        // Learn this mapping for future
        this.cacheTeamMapping(update.sourceId, update.homeTeam, candidateId);
        this.cacheTeamMapping(update.sourceId, update.awayTeam, candidateId);
        return candidateId;
      }
    }

    // No match — create new canonical event
    const normalizedHome = normalizeTeamName(update.homeTeam);
    const normalizedAway = normalizeTeamName(update.awayTeam);
    const newId = this.buildEventId(update.sport, update.league, update.startTime, normalizedHome, normalizedAway);
    this.indexEvent(blockKey, newId);
    this.cacheTeamMapping(update.sourceId, update.homeTeam, normalizedHome);
    this.cacheTeamMapping(update.sourceId, update.awayTeam, normalizedAway);
    return newId;
  }

  private resolveTeam(source: string, rawName: string): string | null {
    return this.teamLookup.get(`${source}:${rawName.toLowerCase()}`) || null;
  }

  private buildEventId(sport: string, league: string, startTime: number, home: string, away: string): string {
    const date = new Date(startTime).toISOString().slice(0, 10); // YYYY-MM-DD
    return `${sport}:${league}:${date}:${home}_vs_${away}`;
  }
}
```

**String normalization pipeline** (applied before any matching):
```
input → lowercase → NFD decompose → strip diacritics → strip punctuation
      → collapse whitespace → strip common suffixes (FC, CF, SC, United, Utd, City)
      → trim
```

**Fuzzy algorithm**: Jaro-Winkler distance (better for short strings with prefix similarity like "Manchester" / "Man"). Package: `cmpstr` or `fast-fuzzy`.

### 5d. Polymarket Adapter

```
PolymarketAdapter
├── start()
│   ├── discovery.ts: GET /sports → tag IDs
│   │                 GET /events?tag_id=X → markets → clobTokenIds
│   │                 Build token→event mapping
│   ├── clob-ws.ts:  Connect to wss://...ws/market
│   │                Subscribe {"assets_ids": [...], "type": "market"}
│   │                PING every 10s
│   │                On "price_change" → extract best_ask → 1/ask → decimal odds
│   ├── scores-ws.ts: Connect to wss://sports-api.polymarket.com/ws
│   │                 On message → parse score/period/elapsed
│   │                 Respond to ping with pong
│   └── normalizer.ts: Raw events → AdapterEventUpdate
│                       Map each Polymarket market to canonical key
│                       Map token ID → event + market type
├── stop()
│   Close both WS connections
├── onUpdate(cb)
│   Store callback, called by normalizer
└── getStatus()
    Return worst status of the two WS connections
```

**Polymarket market key mapping** (binary markets):
- "Will Team A win?" Yes token ask → `ml_home_ft` (decimal = 1/ask)
- "Will Team A win?" No token ask → `ml_away_ft` or could derive from complement
- "Over 210.5 total?" Yes → `o210_5_ft`, No → `u210_5_ft`
- Spread markets: "Team A -3.5?" Yes → `handicap_home_m3_5_ft`

**Discovery refresh**: Re-poll Gamma API every 5 minutes for new markets. Dynamic subscribe/unsubscribe to CLOB WS as markets appear/resolve.

### 5e. 1xbet Adapter

```
OnexbetAdapter
├── start()
│   ├── discovery.ts:  GET GetSportsShortZip → sport ID map
│   │                  For each sport: GET Get1x2_VZip → event list
│   ├── live-feed.ts:  Poll loop at configurable interval
│   │                  GET Get1x2_VZip → list of live events with basic odds
│   │                  GET GetGameZip?id=X → full markets for tracked events
│   │                  Diff detection: only emit if odds changed
│   ├── normalizer.ts: Raw 1xbet → AdapterEventUpdate
│   │                  Map T-codes → canonical market keys (via market-map.ts)
│   │                  Group by time span (sub-games → timespan suffix)
│   │                  Odds already decimal (field C), pass through
│   └── market-map.ts: T-code lookup table (loaded from data/market-type-maps/onexbet.json)
│                       Maps: 1→ml_home, 2→draw, 3→ml_away, 9→o, 10→u, etc.
├── stop()
│   Clear poll timers
├── onUpdate(cb)
│   Store callback
└── getStatus()
    'connected' if last poll succeeded, 'error' if last N polls failed
```

**Poll strategy**:
1. **Overview poll** (`Get1x2_VZip`): Every N seconds, get all live events with basic odds
2. **Detail poll** (`GetGameZip`): For each event, get full market depth
3. **Diff detection**: Compare with previous response, only emit changed markets
4. Headers: standard browser User-Agent + Referer to avoid blocks

### 5f. Signal Dispatcher

```typescript
// core/signal-dispatcher.ts — pseudo-code

class SignalDispatcher {
  private signals: SignalFunction[] = [];

  register(fn: SignalFunction): void {
    this.signals.push(fn);
  }

  unregister(fn: SignalFunction): void {
    this.signals = this.signals.filter(s => s !== fn);
  }

  emit(event: UnifiedEvent, changedKeys: string[], source: string): void {
    for (const fn of this.signals) {
      try {
        fn(event, changedKeys, source);
      } catch (err) {
        // Log but don't crash — one bad signal shouldn't kill the system
        console.error(`Signal error:`, err);
      }
    }
  }
}
```

---

## 6. Performance Design

### 6a. GC Mitigation

| Strategy | Implementation |
|----------|----------------|
| **Object pooling** | Pool `AdapterEventUpdate` and `AdapterMarketUpdate` objects. Adapters `get()` from pool, engine `release()` after processing. |
| **In-place mutation** | StateStore never creates new `UnifiedEvent` objects on update. Mutates existing `markets`, `stats`, `aliases` in place. |
| **Avoid spreads** | No `{...obj}` or `[...arr]` on hot path. Use `Object.assign()` or direct property writes. |
| **Map over Object** | State store uses `Map<string, UnifiedEvent>` — faster iteration and deletion than plain objects. |
| **Heap tuning** | `node --max-old-space-size=4096 --max-semi-space-size=64` |
| **Monitor** | `--trace-gc` in dev to verify <10ms GC pauses |

### 6b. JSON Parsing

- For **Polymarket WS** messages (<5KB): Standard `JSON.parse()` — V8 is optimized for this
- For **1xbet HTTP** responses (potentially large): Consider `JSON.parse()` with a size check; if >100KB, use streaming parser (`@streamparser/json`) — but likely unnecessary for v1
- **Never parse what you don't need**: If a field is irrelevant, don't traverse into nested objects

### 6c. Diff Detection in HTTP Polling

1xbet adapter polls repeatedly. To avoid emitting unchanged data:
- Hash the `E` (events/odds) array per game on each poll
- Compare hash with previous — if unchanged, skip emission
- Use a fast hash (xxhash or simple FNV-1a) not crypto hash
- Alternatively: compare `C` (coefficient) values directly for each market

---

## 7. Configuration Defaults

```typescript
const DEFAULT_CONFIG: Config = {
  adapters: {
    polymarket: {
      enabled: true,
      clobWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
      scoresWsUrl: 'wss://sports-api.polymarket.com/ws',
      gammaApiUrl: 'https://gamma-api.polymarket.com',
      pingIntervalMs: 10_000,
    },
    onexbet: {
      enabled: true,
      liveFeedBaseUrl: 'https://1xbet.com',
      pollIntervalMs: 2_000,
      sportIds: [1],  // Start with soccer, expand later
    },
  },
  matcher: {
    fuzzyThreshold: 0.85,
    kickoffToleranceMs: 30 * 60 * 1000,  // ±30 min
    teamMappingsPath: './data/team-mappings.json',
  },
  cleanupIntervalMs: 60_000,
  logLevel: 'info',
};
```

---

## 8. Error Handling & Reliability

| Scenario | Handling |
|----------|----------|
| **WS disconnect** | Exponential backoff: 1s, 2s, 4s, 8s, 16s, cap 30s. Re-subscribe on reconnect. |
| **HTTP poll failure** | Retry next interval. After 5 consecutive failures, log error, continue polling. |
| **JSON parse error** | Log + skip message. Don't crash. |
| **Fuzzy match ambiguity** | If multiple candidates score >0.85, pick highest. Log warning for manual review. |
| **Unknown market type** | Log once (with T-code), skip. Don't crash. Accumulate unknowns for mapping file update. |
| **Signal function throws** | Catch, log error, continue to next signal. Never let a signal crash the engine. |
| **Graceful shutdown** | SIGINT/SIGTERM → stop all adapters → clear timers → process.exit(0) |

---

## 9. Extensibility Points

| Extension | How to Add |
|-----------|------------|
| **New data source** | Create new folder in `adapters/`, implement `IAdapter`, register in config |
| **New signal logic** | Write a function matching `SignalFunction` type, call `engine.registerSignal()` |
| **REST API output** | New module that calls `engine.getEvent()` / `engine.getAllEvents()`, no core changes |
| **WebSocket server** | Subscribe to signal dispatcher, push to connected clients |
| **DB persistence** | Register a signal that writes to DB on each update (or batched) |
| **New sport** | Just add events — the schema handles any sport. Add sport-specific stat types if needed. |
| **New market types** | Add to market-map JSON files + market-keys.ts constants |

---

## 10. Dependencies (Minimal)

| Package | Purpose |
|---------|---------|
| `ws` | WebSocket client (Polymarket) |
| `typescript` | Type safety |
| `fast-fuzzy` or `cmpstr` | Jaro-Winkler string similarity for team matching |
| `undici` | HTTP client for 1xbet polling (faster than node-fetch, built into Node) |

**Zero framework dependencies.** No Express, no Fastify — pure Node.js. HTTP server can be added later as extension.

---

## Next Step

After design approval → `/sc:implement` or `/sc:workflow` to break Phase 1 into implementation tasks.
