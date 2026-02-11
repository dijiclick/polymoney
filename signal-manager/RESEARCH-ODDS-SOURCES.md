# Sports Odds Data Sources — Research Findings

> Research date: 2026-02-10
> Goal: Find data sources to compare against Polymarket odds for value bet detection

---

## TL;DR

| Source | Cost | Bookmakers | Real-time | Best for |
|---|---|---|---|---|
| ~~Betfair Exchange API~~ | ~~FREE~~ **$299 activation** | 1 (sharpest exchange) | **YES (streaming)** | ~~NOT FREE~~ |
| **OddsPortal scraping** | **FREE** | **12+** | No (Selenium) | Best free multi-bookmaker |
| **Flashscore scraping** | **FREE** | 1 (API) or many (browser) | Polling | Scores/stats, basic odds |
| The Odds API | $59-119/mo | 50+ | Polling (40-60s stale) | Broad coverage, reliable |
| odds-api.io | ~$125/mo | 250+ | **YES (WebSocket <100ms)** | Best paid option |
| OpticOdds | Custom (expensive) | 200+ | SSE streaming | Institutional |

---

## FREE OPTIONS

### 1. Betfair Exchange API (NOT FREE — CANCELED)

- **URL**: https://developer.betfair.com/exchange-api/
- **Cost**: ~~Free for personal use~~ **$299 activation fee for live streaming access**
- **Data**: Exchange odds (back/lay prices with depth)
- **Delivery**: **Streaming API** — low-latency push, 500ms-5000ms heartbeat
- **Sports**: Football, basketball, tennis, hockey, MMA, cricket, all major sports
- **Python SDK**: `pip install betfairlightweight`
- **Requirements**: Betfair account + API app key + **$299 activation fee**
- **Rate limits**:
  - Streaming: subscribe to markets, get pushed updates
  - Polling fallback: market data request limits apply
  - Stream API market limit exists (check forum for current cap)

**Why this is NOT viable for free use:**
- $299 activation fee makes this a paid service, not free
- Initial research was incorrect about free access
- **Betfair Exchange API is NOT recommended for budget-conscious projects**

**Docs:**
- Exchange Stream API: https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/Exchange+Stream+API
- Python tutorial: https://betfair-datascientists.github.io/api/apiPythontutorial/
- GitHub examples: https://github.com/betfair-datascientists/API

### 2. Flashscore Internal API (Scores/Stats Only)

- **Feed API**: `https://local-global.flashscore.ninja/` — custom delimited format (NOT JSON)
  - Auth header: `x-fsign: SW9D1eZo` (static, hasn't changed in 2+ years)
  - Field separator: `¬` (NOT sign), record separator: `~`, key-value: `÷`
  - Field codes: `AA`=matchID, `AB`=status, `DC`=timestamp, `DE`=homeScore, `DF`=awayScore
  - Endpoints: today's matches, match stats, match events, head-to-head, league tables
- **Odds API**: `https://2.ds.lsapp.eu/pq_graphql` — GraphQL, returns JSON
  - Only prematch odds from **1 default bookmaker** (basic home/draw/away)
  - Query: `?_hash=ope&eventId={matchId}&projectId=2&geoIpCode=UA`
- **Full multi-bookmaker odds**: Rendered client-side via JavaScript on flashscore.com
  - **Requires Playwright/Selenium** — 2-10 seconds per match, high resource usage
  - Cloudflare protection on main site
  - Not viable for real-time or at scale
  - Apify's Flashscore scraper is **DEPRECATED**

**Verdict**: Good for live scores and stats. NOT practical for multi-bookmaker odds.

### 3. OddsPortal Scraping

- **URL**: oddsportal.com
- **Data**: Historical and current odds from 12+ bookmakers (1xBet, bet365, Pinnacle, Betway, bwin, Unibet, William Hill, etc.)
- **Method**: Selenium/Playwright required (dynamic JavaScript rendering)
- **Open-source tools**:
  - [OddsHarvester](https://github.com/jordantete/OddsHarvester) — most maintained, JSON/CSV/S3 output, proxy support
  - [OddsPortalScrape](https://github.com/karolmico/OddsPortalScrape) — 12 bookmakers, season scraping
  - [webscraping-oddsportal](https://github.com/scooby75/webscraping-oddsportal) — CSV output
- **Pros**: Multi-bookmaker, free, covers all sports
- **Cons**: Slow (browser automation), not real-time, fragile, resource-heavy
- **Best for**: Historical odds analysis, backtesting, not live value detection

### 4. Oddschecker Scraping

- **URL**: oddschecker.com
- **Data**: Best odds across 10+ bookmakers
- **Method**: Selenium required
- **Tools**: [Oddschecker-Scraper](https://github.com/ChamRoshi/Oddschecker-Scraper)
- **Cons**: Site changes layout frequently to discourage scraping, very fragile
- **Not recommended** for production use

---

## PAID OPTIONS

### 5. The Odds API (the-odds-api.com)

- **Pricing**: Free=500 credits/mo, $30=20K, $59=100K, **$119=5M**, $249=15M
- **Credit system**: 1 credit = 1 region × 1 market per API call. Cost is per sport key, NOT per event.
- **Bookmakers**: 50+ across US/UK/EU/AU regions
  - EU region includes: **Pinnacle**, 1xBet, bet365, Betfair Exchange, Marathon, Unibet, William Hill, bwin, Betsson
- **Sports**: 80+ sport keys (58 soccer leagues, 11 basketball, 8 hockey, 30 tennis, etc.)
- **Delivery**: REST polling only — NO WebSocket
- **Update frequency**: Pre-match 60s, in-play 40s (featured), exchanges 20s
- **Live odds**: YES (same endpoint, in-play when `commence_time` < now)
- **Free endpoints**: `/sports` and `/events` cost 0 credits
- **Polymarket included**: NO

**Credit math for key scenarios:**

| Scenario | Interval | Credits/month | Plan needed |
|---|---|---|---|
| Soccer majors (6 leagues), h2h+totals | 10 min | 77,760 | 100K ($59) |
| Soccer majors, h2h+totals+btts | 5 min | 155,520 | 5M ($119) |
| All Polymarket sports (~20 keys), h2h+totals | 5 min | 345,600 | 5M ($119) |
| All sports + live 60s polling | 60s live | 1,900,000 | 5M ($119) |
| All sports + live 15s polling | 15s live | 5,000,000 | 15M ($249) |

**JSON response format:**
```json
{
  "id": "b308ed60cbb2d1324946c7289190cc88",
  "sport_key": "soccer_epl",
  "home_team": "Arsenal",
  "away_team": "Chelsea",
  "commence_time": "2025-01-15T15:00:00Z",
  "bookmakers": [
    {
      "key": "pinnacle",
      "title": "Pinnacle",
      "last_update": "2025-01-15T14:55:09Z",
      "markets": [
        {
          "key": "h2h",
          "outcomes": [
            { "name": "Arsenal", "price": 1.85 },
            { "name": "Chelsea", "price": 4.20 },
            { "name": "Draw", "price": 3.50 }
          ]
        }
      ]
    }
  ]
}
```

### 6. odds-api.io (BEST PAID OPTION)

- **Pricing**: Starter GBP 99/mo (~$125), Growth GBP 179/mo, Pro GBP 229/mo. WebSocket add-on: +100% of plan cost.
- **Bookmakers**: **250+** (highest count of all providers)
- **Sports**: 20+ sports, 12,000+ leagues
- **Delivery**: REST + **WebSocket (sub-100ms latency)**
- **Free tier**: YES — 2 bookmakers, 100 req/hour, no credit card
- **Polymarket included**: **YES** — normalized alongside traditional bookmakers
- **SDKs**: Python, TypeScript, MCP server
- **SLA**: 99.9% uptime

**Key advantage**: Polymarket is already a data source. Could replace the entire signal manager's Polymarket adapter + add 250 bookmakers through a single WebSocket connection.

**Simplified architecture with odds-api.io:**
```
Current:  Polymarket WS → Normalizer → Matcher → State → Signals
          1xbet HTTP    → Normalizer ↗

With odds-api.io:
          odds-api.io WS → Single Normalizer → State → Signals
          (Polymarket + 250 books already matched & normalized)
```

### 7. OpticOdds (opticodds.com)

- **Pricing**: Custom quotes only (reportedly expensive, enterprise-oriented)
- **Bookmakers**: 200+
- **Delivery**: REST + **SSE streaming** (sub-second latency)
- **Polymarket included**: YES
- **Rate limits**: Streaming 250 req/15s, Standard 2,500 req/15s
- **Features**: "Custom weighted consensus lines" — auto-aggregated fair odds
- **Best for**: Institutional/professional use, budget not a concern

### 8. Other Paid APIs

| API | Bookmakers | Price | WebSocket | Notes |
|---|---|---|---|---|
| SportGameOdds | 80+ | $99/mo+ | Custom tier only | Per-game pricing, 30-60s updates |
| TheRundown | 22+ | $25/mo+ | Enterprise only | US sports focus, limited |
| OddsJam | 100+ | ~$500+/mo | Push feed available | Enterprise, opaque pricing |
| SportsDataIO | varies | varies | No | More stats-focused than odds |

---

## RECOMMENDED ARCHITECTURE (ACTUALLY FREE)

**Betfair is NOT free ($299 activation). Here are the real free options:**

### Option A: OddsPortal Scraping (12+ bookmakers, best free option)
```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Polymarket CLOB WS     │     │  OddsPortal Scraper      │
│  (already built)        │     │  (FREE, requires work)   │
│                         │     │                          │
│  Real-time odds         │     │  Selenium + BeautifulSoup│
│  Live scores            │     │  12+ bookmakers          │
└──────────┬──────────────┘     │  Pinnacle, bet365, 1xBet │
           │                     │  Update every 1-2 min    │
           │                     └──────────┬───────────────┘
           │                                │
           ▼                                ▼
     ┌─────────────────────────────────────────┐
     │         Event Matcher                    │
     │  Match Polymarket ↔ OddsPortal events    │
     └──────────────┬──────────────────────────┘
                    │
                    ▼
     ┌─────────────────────────────────────────┐
     │         Value Signal Engine              │
     │  Compare Polymarket vs consensus odds    │
     │  (average of Pinnacle + sharp books)     │
     └──────────────┬──────────────────────────┘
                    │
                    ▼
     Console alerts when edge > threshold
```

**Pros**: Multi-bookmaker, includes Pinnacle (sharpest), free
**Cons**: Slow (Selenium), fragile (site changes), not real-time

### Option B: Flashscore API + Manual Bookmaker Site Scraping
```
Flashscore GraphQL API (prematch odds, 1 bookmaker) → Basic value signal
+ Scrape individual bookmaker site (e.g., Pinnacle public odds page) → Better benchmark
```

**Pros**: Faster than OddsPortal, simpler
**Cons**: Limited bookmaker coverage, manual scraping required

### Option C: The Odds API Free Tier (500 credits/mo) → Prototype Only
```
Use 500 free credits to validate the value detection concept
If it works, decide whether to pay $59/mo or build scraper
```

## UPGRADE PATH

1. **Phase 1 (Free)**: Betfair Exchange streaming + existing Polymarket WS → console alerts
2. **Phase 2 ($59/mo)**: Add The Odds API for multi-bookmaker consensus → richer signals
3. **Phase 3 ($125/mo)**: Switch to odds-api.io WebSocket for unified real-time feed
4. **Phase 4**: Dashboard integration, historical tracking, automated trading

---

## KEY SOURCES

- Betfair Developer: https://developer.betfair.com/exchange-api/
- Betfair Stream API docs: https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/Exchange+Stream+API
- Betfair Python SDK: https://github.com/betfair-datascientists/API
- The Odds API: https://the-odds-api.com/
- The Odds API docs: https://the-odds-api.com/liveapi/guides/v4/
- The Odds API markets: https://the-odds-api.com/sports-odds-data/betting-markets.html
- odds-api.io: https://odds-api.io
- OpticOdds: https://opticodds.com
- OddsHarvester (OddsPortal scraper): https://github.com/jordantete/OddsHarvester
- fs-football (Flashscore scraper): https://github.com/progeroffline/fs-football
- Flashscore Apify (DEPRECATED): https://apify.com/tomas_jindra/flashscore-scraper
- OddsPortalScrape: https://github.com/karolmico/OddsPortalScrape
