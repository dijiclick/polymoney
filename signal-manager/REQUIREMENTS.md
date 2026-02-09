# Signal Manager — Requirements Specification

## 1. Project Goal

Build a Node.js system that aggregates real-time sports betting data (odds + live scores) from multiple bookmakers and data providers into a **unified in-memory state**, with a pluggable signal function that receives every update for future arbitrage detection, value bet alerts, and logging.

---

## 2. Functional Requirements

### FR-1: Data Ingestion
- Connect to data sources via **WebSocket** (primary) or **HTTP polling** (fallback)
- Each source is an independent, self-contained **adapter** (module)
- Adapters normalize raw source data into the unified format before emitting
- Adapters must auto-reconnect on disconnect with exponential backoff
- Adapters must handle keepalive/ping-pong per source protocol

### FR-2: Initial Sources

#### FR-2a: Polymarket (WebSocket)
- **CLOB prices**: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
  - Subscribe: `{"assets_ids": ["<token_id>"], "type": "market"}`
  - Extract `best_ask` from `price_change` events — convert to decimal: `1 / best_ask`
  - Send `"PING"` keepalive every ~10 seconds
  - **ONLY use ask prices. Never use the b-word.**
- **Sports discovery**: `GET https://gamma-api.polymarket.com/sports` → events → markets → extract `clobTokenIds`
  - Binary markets: "Team A wins? Yes/No" → each outcome is a separate token
  - Subscribe to Yes token ask prices for each market
- **Live scores**: `wss://sports-api.polymarket.com/ws`
  - Auto-push on connect (no subscription needed)
  - Respond to `ping` with `pong` (5s interval)
  - Provides: `homeTeam`, `awayTeam`, `score`, `period`, `elapsed`, `status`

#### FR-2b: 1xbet (HTTP Polling)
- **1xbet does not use WebSocket for sports data** — their UI is HTTP-based. We use HTTP polling.
- **Live feed**: `https://1xbet.com/LiveFeed/Get1x2_VZip` and `GetGameZip`
  - Odds already in **decimal** format (field `C` = coefficient)
  - Teams in `O1` (home) / `O2` (away) string fields
  - Markets in `E` array: `T` (market type code), `C` (odds), `P` (threshold e.g. 2.5)
  - Scores in `SC.PS` array with `S1`/`S2` per period
- **Sport discovery**: `GetSportsShortZip` for sport ID mapping
- **Full game markets**: `GetGameZip?id=<game_id>&isSubGames=true&GroupEvents=true&countevents=250`
- **Poll interval**: Configurable, as fast as possible without triggering rate limits (needs testing — start at 1-2s)

### FR-3: Event Matching (Hybrid Strategy)
- **Pre-computed mapping table**: Maintain a lookup of known team name variations per source
  - Format: `{ "1xbet:Manchester United": "manchester_united", "polymarket:Man Utd": "manchester_united" }`
- **Fuzzy fallback**: For unknown teams, use Levenshtein distance + league + date/kickoff time as anchors
  - Narrow candidates by `league + date + approximate_kickoff_time` first (reduces to 1-2 candidates)
  - Fuzzy-match team names within that small set
  - Cache the resolved mapping permanently for future lookups
- **Canonical event ID**: Each matched event gets a deterministic canonical ID (e.g. `soccer:premier_league:2026-02-09:manchester_united_vs_liverpool`)

### FR-4: Unified Data Format
- Single flat-key model for all sports (see Section 3 for schema)
- Every market key follows the convention: `{market_type}_{threshold}_{time_span}`
  - Examples: `o2_5_ft`, `btts_ft`, `ml_home_1h`, `handicap_m1_5_q2`
- Each market key maps to an object of `{ [source_id]: { value: number, timestamp: number } }`
- Sources that don't offer a given market simply don't appear in that key
- Stats are sport-specific but stored in a generic `stats` object (typed per sport via schema)
- All odds in **decimal format**. Polymarket: `1 / ask_price`. 1xbet: already decimal.

### FR-5: In-Memory State
- Store **only the latest state** per event in memory
- Every incoming update overwrites the previous value for that source + market
- State is a `Map<canonical_event_id, UnifiedEvent>`
- Completed/resolved events are removed from memory (with optional hook for archival)
- Design the state structure so it can be serialized to a relational DB (MySQL/Postgres) in the future for historical data

### FR-6: Signal Manager (Placeholder)
- A pluggable function that receives **every state update** as input
- Signature: `onUpdate(event: UnifiedEvent, changedKeys: string[], source: string): void`
- The function has access to the full current state of the event (all sources, all markets)
- Default implementation: no-op (or simple console.log in dev mode)
- Must be replaceable without modifying core code (dependency injection or event emitter pattern)
- Future signals: arbitrage detection, odds movement, live stat triggers, value bets

### FR-7: Adapter Interface
- Each source adapter must implement a common interface:
  - `start()`: Begin connection and data flow
  - `stop()`: Gracefully disconnect
  - `onUpdate(callback)`: Register the callback that receives normalized updates
  - `getStatus()`: Return connection health (connected, reconnecting, error)
- Adapters are registered in a central registry
- Adding a new source = writing one adapter file + registering it — zero changes to core

### FR-8: Market Coverage
- **Every market** every bookmaker offers for an event
- **Every time span**: full time, 1st half, 2nd half, Q1-Q4, overtime, etc.
- **Player-based markets**: Include if the source provides them, keyed as `player_{player_slug}_{market_type}_{time_span}` (e.g. `player_lebron_james_points_o25_5_ft`). Player slug is lowercase, underscored. If a source doesn't provide a clean player ID, skip player markets for that source rather than guessing.
- Market type codes from each source must be mapped to canonical market keys in the adapter

### FR-9: Odds Format
- All odds stored as **decimal** (European) format
- Polymarket: `1 / ask_price` (e.g. ask at $0.25 → odds 4.00)
- 1xbet: Already decimal (field `C`)
- Any future source with fractional/American/Asian odds must convert in the adapter
- Minimum precision: 3 decimal places

---

## 3. Unified Data Schema

```
UnifiedEvent {
  id: string                          // canonical event ID
  sport: string                       // "soccer", "basketball", "csgo", "dota2", ...
  league: string                      // "premier_league", "nba", "esl_pro_league", ...
  startTime: number                   // Unix timestamp (ms) of scheduled start
  status: "scheduled" | "live" | "ended" | "canceled"

  home: {
    name: string                      // Canonical team name
    aliases: { [source]: string }     // Original name per source
  }
  away: {
    name: string
    aliases: { [source]: string }
  }

  stats: {                            // Sport-specific, only populated for live events
    score?: { home: number, away: number }
    period?: string                   // "1h", "2h", "q1", "q2", "ot", ...
    elapsed?: string                  // "45:00", "Q3 5:18", ...
    [key: string]: any                // corners, cards, possession, rounds, maps, etc.
  }

  markets: {                          // Flat keys, see FR-4 naming convention
    [market_key: string]: {
      [source_id: string]: {
        value: number                 // Decimal odds
        timestamp: number             // Unix ms when this value was received
      }
    }
  }
}
```

### Market Key Naming Convention

**Format**: `{market}_{threshold}_{timespan}`

| Component | Values | Examples |
|-----------|--------|---------|
| **market** | `ml_home`, `ml_away`, `draw`, `o`, `u`, `btts_yes`, `btts_no`, `handicap_home`, `handicap_away`, `corners_o`, `corners_u`, `cards_o`, `cards_u`, `correct_score`, `player_{slug}_{stat}_o`, `player_{slug}_{stat}_u` | |
| **threshold** | Numeric, underscore for decimal | `2_5`, `1_5`, `0_5`, `m1_5` (negative = m prefix) |
| **timespan** | `ft`, `1h`, `2h`, `q1`-`q4`, `ot`, `map1`-`map5`, `set1`-`set5`, `round1`-... | |

**Examples**:
- `ml_home_ft` — Moneyline home team, full time
- `o2_5_ft` — Over 2.5 goals, full time
- `u2_5_1h` — Under 2.5 goals, first half
- `btts_yes_ft` — Both teams to score Yes, full time
- `handicap_home_m1_5_ft` — Home team handicap -1.5, full time
- `corners_o9_5_ft` — Over 9.5 corners, full time
- `player_lebron_james_points_o25_5_ft` — LeBron points over 25.5, full time

---

## 4. Non-Functional Requirements

### NFR-1: Performance
- **Latency target**: Minimize time from source WebSocket message → signal function invocation
- Use **SharedArrayBuffer** and/or **worker threads** for the hot path (parsing + state update + signal invocation)
- Avoid unnecessary object allocations in the update loop (pre-allocate, reuse buffers)
- Use `Map` over plain objects for state (faster for frequent add/delete)
- JSON parsing is a bottleneck — consider streaming JSON parsers or manual extraction for known fields
- **GC mitigation**: Keep the hot path allocation-free where possible. Use object pools for adapter messages. Consider `--max-old-space-size` and `--expose-gc` for manual GC scheduling during idle periods.

### NFR-2: Modularity
- **Adapter pattern**: Each source is a standalone module implementing a common interface
- **Signal function**: Injected via dependency injection or event emitter — replaceable without touching core
- **Core engine**: Source-agnostic — receives normalized updates, manages state, invokes signals
- **Future extensibility**: Adding REST API / WebSocket output = new module, no core changes
- **Future extensibility**: Adding DB persistence = new module subscribing to state changes

### NFR-3: Reliability
- Auto-reconnect with exponential backoff (cap at 30s) for all WebSocket connections
- Connection health monitoring with configurable stale-data timeout
- Graceful degradation: if one source disconnects, others continue unaffected
- Clean shutdown: close all connections, flush any pending operations

### NFR-4: Future-Proofing
- State structure must be serializable to relational DB rows (flat market keys help here)
- Adapter registry allows runtime add/remove of sources
- Market key convention is extensible — new market types just add new keys
- Per-sport stat schemas can be added incrementally without breaking existing ones

---

## 5. User Stories / Acceptance Criteria

### US-1: As a developer, I can add a new data source by writing one adapter file
- **AC**: New adapter implements `start()`, `stop()`, `onUpdate()`, `getStatus()`
- **AC**: Register adapter in config → it starts receiving data
- **AC**: Zero changes to core engine, state management, or other adapters

### US-2: As the system, I receive Polymarket sports odds via CLOB WebSocket
- **AC**: Discover sports markets via Gamma API
- **AC**: Subscribe to Yes token IDs on CLOB WebSocket
- **AC**: Convert ask price to decimal odds (`1 / ask_price`)
- **AC**: Updates flow into unified state under `polymarket` source key
- **AC**: Auto-reconnect on disconnect

### US-3: As the system, I receive 1xbet odds via HTTP polling (then WebSocket)
- **AC**: Poll LiveFeed endpoints at configurable interval
- **AC**: Parse `E` array for all markets, map `T` codes to canonical market keys
- **AC**: Odds already decimal — store `C` value directly
- **AC**: Updates flow into unified state under `onexbet` source key

### US-4: As the system, I match events across sources
- **AC**: Known teams resolve instantly via pre-computed mapping table
- **AC**: Unknown teams fall back to fuzzy match (league + date + Levenshtein)
- **AC**: Resolved mappings are cached for future use
- **AC**: Unmatched events still stored (with single-source data)

### US-5: As the system, I maintain latest state in memory
- **AC**: Each update overwrites previous value for that source + market key
- **AC**: Full event state retrievable by canonical ID
- **AC**: Ended events are cleaned up from memory

### US-6: As a developer, I can plug in a signal function
- **AC**: Default signal function is a no-op
- **AC**: Signal receives: full event state, list of changed keys, source that triggered the update
- **AC**: Signal function is replaceable via config/injection without code changes

### US-7: As the system, every market and time span from a source is captured
- **AC**: All market types mapped to canonical flat keys
- **AC**: All time spans (ft, 1h, 2h, q1-q4, ot, etc.) properly suffixed
- **AC**: Player markets included where source provides clean player identification

---

## 6. Open Questions

| # | Question | Impact | Suggested Resolution |
|---|----------|--------|---------------------|
| 1 | 1xbet market type code (`T`) full mapping | Needed to map all markets to canonical keys | Capture `GetGameZip` response for a few games across sports, catalog all `T` values |
| 2 | 1xbet sport ID mapping | Needed to discover events per sport | Call `GetSportsShortZip`, build lookup table |
| 3 | 1xbet poll rate limits | How fast can we poll before getting blocked? | Test incrementally starting at 2s, measure response times |
| 4 | Polymarket sports market types | What market types exist beyond moneyline (spreads? totals?) | Query Gamma API with `sports_market_types` param |
| 5 | Team name mapping — bootstrap data | Initial mapping table for top leagues/teams | Can be partially auto-generated from both sources, then manually verified |
| 6 | Player market identification | How to reliably get player slugs from each source | Defer player markets to Phase 2 if clean solution isn't obvious from initial data |
| 7 | Historical data schema | When we add DB persistence, what granularity? Every tick or sampled? | Decide when implementing DB module — current schema is compatible with both |

---

## 7. Constraints

- **Language**: Node.js (TypeScript recommended for type safety on the unified schema)
- **WebSocket lib**: `ws`
- **No third-party odds APIs**: Direct from source only
- **In-memory only** for v1 (no DB)
- **Folder**: `signal-manager/` at project root
- **Odds format**: Decimal only. Polymarket: `1 / ask_price`. Never the b-word.

---

## 8. Phase Plan (Suggested)

| Phase | Scope |
|-------|-------|
| **Phase 1** | Core engine + unified schema + Polymarket adapter (WS) + 1xbet adapter (HTTP poll) + event matching + placeholder signal |
| **Phase 2** | Player markets + more sports coverage + optimize 1xbet poll frequency |
| **Phase 3** | Additional sources + REST/WS output API + signal implementations (arbitrage, value bets) |
| **Phase 4** | DB persistence module + historical data + dashboard integration |

---

## Next Steps

After approval of these requirements:
- `/sc:design` — System architecture, module boundaries, data flow diagrams
- `/sc:workflow` — Implementation task breakdown for Phase 1
