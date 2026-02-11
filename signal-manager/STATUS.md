# Signal Manager — Project Status

## What We Built

A real-time sports betting data aggregation system in Node.js/TypeScript that connects to multiple bookmaker data sources, normalizes their data into a unified format, matches events across sources, and feeds updates to a pluggable signal function.

---

## Architecture

```
Adapters (data sources)
    ↓ raw data
Normalizers (per-source)
    ↓ AdapterEventUpdate (unified format)
Event Matcher (hybrid: lookup table + Jaro-Winkler fuzzy)
    ↓ canonical event ID
State Store (in-memory Map, in-place mutations)
    ↓ (event, changedKeys, source)
Signal Dispatcher (pluggable callbacks)
```

Single-threaded. No frameworks. 4 npm dependencies (`ws`, `typescript`, `fast-fuzzy`, `@types/*`).

---

## What's Working

### Polymarket Adapter (fully functional)
- Discovers **129 sport categories** via Gamma API (`/sports` → `/events`)
- Maps **7,660+ tokens** to canonical market keys
- Connects to **CLOB WebSocket** (`wss://ws-subscriptions-clob.polymarket.com/ws/market`)
  - Subscribes to all sport token IDs
  - Extracts `best_ask` from `price_change` events
  - Converts ask price to decimal odds: `1 / ask_price`
  - PING keepalive every 10 seconds
- Connects to **Sports Scores WebSocket** (`wss://sports-api.polymarket.com/ws`)
  - Receives live scores, period, elapsed time
  - Responds to ping/pong
- Uses `sportsMarketType` field for reliable market classification:
  - `moneyline` → `ml_home_ft`, `ml_away_ft`, `draw_ft`
  - `totals` → `o_2_5_ft`, `u_2_5_ft` (threshold from `groupItemTitle`)
  - `spreads` → `handicap_home_m1_5_ft` (team + threshold from `groupItemTitle`)
  - `both_teams_to_score` → `btts_yes_ft`, `btts_no_ft`
- Periodic discovery refresh every 5 minutes for new markets
- Auto-reconnect with exponential backoff

### 1xbet Adapter (structurally complete, untestable locally)
- HTTP polling of `LiveFeed/Get1x2_VZip` and `LiveFeed/GetGameZip`
- T-code → canonical market key mapping (1=ml_home, 2=draw, 3=ml_away, 9=over, 10=under, etc.)
- Diff detection: only emits when odds actually change (hash comparison)
- Odds already decimal (field `C`), passed through directly
- Score parsing from `SC.PS` array
- **Disabled by default** — `1xbet.com` is geo-blocked from most networks. Enable in config when running from colocated servers.

### Core Engine
- Wires adapters → matcher → state store → signals
- Periodic cleanup sweep for ended events (every 60s)
- Query API: `getEvent(id)`, `getAllEvents()`, `getAdapterStatuses()`
- Graceful shutdown on SIGINT/SIGTERM

### Event Matcher
- **Pre-computed lookup table** loaded from `data/team-mappings.json` (15 teams, 55 aliases)
- **Fuzzy fallback**: Jaro-Winkler distance, blocked by sport+league+date, threshold 0.85
- Learned mappings cached at runtime for future lookups
- Canonical event IDs: `sport:league:date:home_vs_away`

### Unified Data Format
- Flat market keys: `{market}_{threshold}_{timespan}`
- Every market key maps to `{ [sourceId]: { value, timestamp } }`
- Examples: `o_2_5_ft`, `ml_home_ft`, `handicap_away_m1_5_ft`, `btts_yes_ft`
- Supports all sports, all time spans (ft, 1h, 2h, q1-q4, ot, map1-5, set1-5)

### Signal Dispatcher
- Pluggable signal functions via `engine.registerSignal(fn)`
- Signature: `(event, changedKeys, source) => void`
- Default: dev logger that prints odds updates to console
- Error-isolated: one bad signal can't crash the system

---

## File Structure (27 source files)

```
signal-manager/
├── src/
│   ├── index.ts                          # Entry point, boots engine
│   ├── core/
│   │   ├── engine.ts                     # Orchestrator
│   │   ├── state-store.ts                # In-memory state (Map)
│   │   └── signal-dispatcher.ts          # Pluggable signals
│   ├── adapters/
│   │   ├── adapter.interface.ts          # IAdapter contract
│   │   ├── adapter-registry.ts           # Start/stop/monitor adapters
│   │   ├── polymarket/
│   │   │   ├── index.ts                  # PolymarketAdapter
│   │   │   ├── clob-ws.ts                # CLOB WebSocket client
│   │   │   ├── scores-ws.ts              # Sports scores WebSocket
│   │   │   ├── discovery.ts              # Gamma API market discovery
│   │   │   └── normalizer.ts             # Raw → AdapterEventUpdate
│   │   └── onexbet/
│   │       ├── index.ts                  # OnexbetAdapter
│   │       ├── live-feed.ts              # HTTP polling + diff detection
│   │       ├── discovery.ts              # Sport/event enumeration
│   │       ├── normalizer.ts             # Raw → AdapterEventUpdate
│   │       └── market-map.ts             # T-code → canonical key
│   ├── matching/
│   │   ├── event-matcher.ts              # Hybrid lookup + fuzzy
│   │   ├── team-lookup.ts                # Pre-computed aliases
│   │   ├── fuzzy.ts                      # Jaro-Winkler implementation
│   │   └── normalizer.ts                 # Team name normalization
│   ├── types/
│   │   ├── unified-event.ts              # UnifiedEvent, SourceOdds
│   │   ├── adapter-update.ts             # AdapterEventUpdate
│   │   ├── market-keys.ts                # Key builders + constants
│   │   └── config.ts                     # Config types
│   └── util/
│       ├── logger.ts                     # Structured logging
│       ├── odds.ts                       # Ask→decimal, american→decimal
│       └── timing.ts                     # High-res timing
├── data/
│   ├── team-mappings.json                # 15 teams, 55 aliases
│   └── market-type-maps/
│       ├── onexbet.json                  # T-code mapping (10 known codes)
│       └── polymarket.json               # Reserved for future
├── config/
│   └── default.ts                        # Default configuration
├── package.json
├── tsconfig.json
├── REQUIREMENTS.md                       # Full requirements spec
└── DESIGN.md                             # System architecture doc
```

---

## How To Run

```bash
cd signal-manager
npm install
npm run build
npm start                    # with GC-tuned V8 flags
npm run start:trace-gc       # to monitor GC pauses
```

---

## Sample Output

```
[INFO] [pm-discovery] Found 129 sports categories
[INFO] [pm-discovery] Discovery complete: 7660 tokens mapped
[INFO] [pm-clob-ws] Connected to CLOB WS (7660 tokens)
[INFO] [pm-scores-ws] Connected to Sports Scores WS

[polymarket] Cavaliers vs Nuggets | o_236_5_ft: polymarket=1.818
[polymarket] FC Famalicão vs AVS Futebol | handicap_home_m1_5_ft: polymarket=2.439
[polymarket] CA Boca Juniors vs Racing Club | btts_yes_ft: polymarket=1.031
[polymarket] Galatasaray SK vs Eyüpspor | draw_ft: polymarket=11.111
[polymarket] Benfica vs Real Madrid CF | ml_home_ft: polymarket=4.000
```

---

## What's NOT Built Yet

| Item | Phase |
|------|-------|
| Real signal logic (arbitrage, value bets, odds movement) | Phase 3 |
| REST API / WebSocket server for output | Phase 3 |
| Player-based markets | Phase 2 |
| Database persistence (historical odds) | Phase 4 |
| More data sources beyond Polymarket + 1xbet | Phase 3 |
| Full 1xbet T-code mapping (only 10 of ~100+ known) | Phase 2 |
| Team mappings for all leagues (only 15 top teams seeded) | Ongoing |
| Dashboard integration | Phase 4 |

---

## Bugs Found & Fixed During Testing

1. `clobTokenIds` was a JSON array string, not comma-separated — fixed parser
2. Team mappings path resolved to `dist/` instead of project root — fixed path
3. Market classification was fragile regex on question text — switched to `sportsMarketType` field
4. Market keys missing underscore before threshold (`handicap_homem2_5` → `handicap_home_m2_5`) — fixed
5. Tag "1" (all sports) caused redundant fetches — skipped, deduplicated
6. 1xbet geo-blocked — disabled by default, adapter works from colocated servers
