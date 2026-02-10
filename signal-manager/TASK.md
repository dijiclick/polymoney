# Signal Manager - Full Fix + Dashboard + FlashScore + 1xBet

## Context
This is a TypeScript sports odds aggregation system. It pulls live odds from multiple sources (Polymarket, 1xBet, FlashScore) and matches them to find arbitrage opportunities. The key insight: FlashScore and 1xBet update scores/odds faster than Polymarket, so we can detect when Polymarket odds are stale and trade on the difference.

## Task 1: Fix All Bugs in Existing Code

### 1xBet Adapter Bugs (src/adapters/onexbet/)

**discovery.ts:**
- Replace `Get1x2_VZip` endpoint with confirmed working endpoints:
  - Single match: `/service-api/LiveFeed/GetGameZip?id={gameId}&lng=en&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=7&country=190&marketType=1`
  - Top live: `/service-api/LiveFeed/GetTopGamesStatZip?lng=en&antisports=66&partner=7`
  - Sports list: `/service-api/LiveFeed/GetSportsShortZip?...`
- The discovery endpoint should use `GetTopGamesStatZip` to find live games

**normalizer.ts:**
- Real API returns `game.Value.GE[].E[][]` (nested arrays per group), NOT flat `game.E[].T`
- Each group has `G` (group ID), and `E` is an array of arrays: `E[marketIdx][0]` where element has `{C, CV, G, GS, T, P?}`
  - C = coefficient (decimal odds)
  - T = market type (1=home, 2=draw, 3=away for group G=1 which is 1X2)
  - P = threshold (for over/under, handicaps)
- Score structure: `SC.FS.S1`/`S2` for full score, `SC.PS` uses `Key/Value` pairs (not S1/S2 directly)

**live-feed.ts:**
- The URL path needs `/service-api/` prefix
- Add `&grMode=4&partner=7&country=190&marketType=1` query params

**config/default.ts:**
- Change `liveFeedBaseUrl` from `https://1xbet.com` to `https://1xlite-81284.pro` (1xbet.com is blocked from this server)
- Enable 1xBet adapter by default (`enabled: true`)

### Polymarket Adapter
- Mostly works but `sportsMarketType` field doesn't always exist. Add fallback to question-based parsing.
- The discovery fetches too many irrelevant tags. Filter to sport-specific tags only (skip tag "1" and "100639" which are generic).

## Task 2: Add FlashScore Adapter

Create `src/adapters/flashscore/` with:
- **discovery.ts** - Fetches match list from FlashScore using Playwright headless browser
  - FlashScore path: `https://www.flashscore.com/{sport}/{country}/{league}/`
  - Returns match IDs, team names, scores, status
  - DOM selectors: `[id^="g_1_"]` for match rows, `.event__participant--home/--away` for teams
- **live-feed.ts** - Polls FlashScore periodically (every 10s) via Playwright for score + odds updates
  - Can also try FlashScore's WebSocket: `wss://p6tt2.fsdatacentre.com/WebSocketConnection-Secure`
- **normalizer.ts** - Converts FlashScore data to AdapterEventUpdate format
- **index.ts** - FlashScore adapter implementing IAdapter

League mappings needed:
```
epl → football/england/premier-league
laliga → football/spain/laliga  
bundesliga → football/germany/bundesliga
ligue1 → football/france/ligue-1
seriea → football/italy/serie-a
ucl → football/europe/champions-league
```

## Task 3: Add FlashScore Adapter Config

Update `src/types/config.ts` to add FlashScoreAdapterConfig:
```typescript
interface FlashScoreAdapterConfig {
  enabled: boolean;
  pollIntervalMs: number;
  leagues: { sport: string; fsPath: string; name: string }[];
}
```

Update Config type to include `flashscore` in adapters.
Update `config/default.ts` accordingly.
Update `src/index.ts` to register FlashScore adapter.

## Task 4: Build Web Dashboard

Create a beautiful real-time dashboard at `src/dashboard/` using:
- A simple HTTP server (no external framework - use node:http)
- WebSocket for real-time updates
- Single HTML file with embedded CSS/JS (serve from the dashboard module)

Dashboard features:
1. **Live Events Table** - All matched events with odds from each source (Polymarket, 1xBet, FlashScore)
2. **Signal Alerts** - When odds diverge significantly between sources, highlight them
3. **Adapter Status** - Show connection status of each adapter (connected/disconnected/error)
4. **Event Count** - Total tracked events
5. **Score Display** - Live scores from FlashScore/1xBet
6. **Odds Comparison** - Side-by-side odds from all sources with delta highlighting
7. **Auto-refresh** - Real-time via WebSocket, no page reload needed

Dashboard should:
- Run on port 3847 (configurable)
- Have a dark theme (modern, clean)
- Be mobile-responsive
- Show timestamps of last update per source
- Color-code odds divergences (green = opportunity, red = stale)

Add dashboard config to Config type and start it from index.ts.

## Task 5: Signal Detection Logic

Create real signal functions in `src/signals/`:
- **odds-divergence.ts** - Detects when odds from fast sources (1xBet/FlashScore) diverge from Polymarket by >X%
- **score-change.ts** - Detects when a goal/score change happens on FlashScore/1xBet but Polymarket hasn't adjusted
- **stale-odds.ts** - Detects when Polymarket odds haven't moved in >30s while other sources are actively changing

Each signal should emit structured alerts that the dashboard can display.

## Task 6: Make it 24/7

- Add process management (graceful restart on errors)
- Add health check endpoint on the dashboard HTTP server (/health)
- Handle adapter reconnection gracefully
- Log to file as well as console

## Task 7: Push to GitHub

- Create branch `feature/signal-manager-v2`
- Commit all changes with meaningful commit messages
- Push to origin

## Important Notes
- The project uses ESM ("type": "module" in package.json)
- TypeScript with strict mode
- No React/Vue/etc - vanilla HTML/CSS/JS for dashboard
- Keep dependencies minimal (ws, playwright for FlashScore)
- Add playwright to package.json dependencies
- The working directory is: /home/aria/.openclaw/workspace/polymoney/signal-manager/
- Git remote: https://github.com/dijiclick/polymoney.git

When completely finished, run this command to notify me:
openclaw system event --text "Done: Signal Manager v2 complete - all bugs fixed, FlashScore adapter added, 1xBet fixed, dashboard built, signals implemented, pushed to feature/signal-manager-v2" --mode now
