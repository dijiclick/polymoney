/**
 * Goal Timing Test — Compare goal detection speed across FlashScore, 1xBet, Polymarket
 *
 * Run:  cd signal-manager && npx tsx src/tools/goal-timing.ts
 *
 * Connects to all 3 sources simultaneously, tracks live soccer scores,
 * and logs every goal with ms-precision timestamps to compare latency.
 */

import WebSocket from 'ws';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FlashScoreWS, type FSLiveUpdate } from '../adapters/flashscore/ws-client.js';
import { fetchAllFootball, type FSMatch } from '../adapters/flashscore/http-client.js';
import { ScoresWebSocket, type ScoreUpdate } from '../adapters/polymarket/scores-ws.js';

// ── Log file ────────────────────────────────────────────────────────────────

const LOG_DIR = join(process.cwd(), 'data');
const LOG_FILE = join(LOG_DIR, 'goal-timing.log');

function ensureLogDir(): void {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
}

// Format: timestamp_ms | ISO_time | source | match | before | after | delta_ms | first_source
function logGoal(
  timestamp: number, source: string, match: string,
  before: string, after: string, deltaMs: number, firstSource: string,
): void {
  ensureLogDir();
  const iso = new Date(timestamp).toISOString();
  const line = `${timestamp}\t${iso}\t${source}\t${match}\t${before}\t${after}\t${deltaMs}\t${firstSource}\n`;
  appendFileSync(LOG_FILE, line, 'utf-8');
}

// ── Config ──────────────────────────────────────────────────────────────────

const ONEXBET_BASE = 'https://1xlite-81284.pro';
const ONEXBET_POLL_MS = 500;      // 500ms polling for fastest score detection
const ONEXBET_BATCH = 10;
const PM_SCORES_URL = 'wss://sports-api.polymarket.com/ws';
const SUMMARY_INTERVAL_MS = 5 * 60_000;
const ONEXBET_DISCOVERY_INTERVAL_MS = 60_000;

const HEADERS: Record<string, string> = {
  'Accept': '*/*',
  'DNT': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ── State ───────────────────────────────────────────────────────────────────

interface GoalEvent {
  source: string;
  matchKey: string;
  displayName: string;
  scoreBefore: string;
  scoreAfter: string;
  timestamp: number;
  isoTime: string;
}

// Per-source score state: matchKey → source → current score string
const scoreState = new Map<string, Map<string, string>>();
const goalLog: GoalEvent[] = [];

// FlashScore match cache (WS sends partial updates, HTTP has full data)
const fsMatchCache = new Map<string, FSMatch>();

// 1xBet game tracking
interface XbetGame { id: number; home: string; away: string; league: string; }
let xbetGames: XbetGame[] = [];
const xbetScoreCache = new Map<number, string>(); // gameId → "h-a"

// Filter out virtual/simulated matches from 1xBet
function isVirtualMatch(home: string, away: string): boolean {
  const combined = `${home} ${away}`.toLowerCase();
  // Virtual teams end with "+", Amateur teams, e-sports sims
  if (/\+\s*$/.test(home) || /\+\s*$/.test(away)) return true;
  if (combined.includes('(amateur)') || combined.includes('(reserves)')) return true;
  if (combined.includes('esports') || combined.includes('e-sports')) return true;
  if (combined.includes('(sim)') || combined.includes('cyber')) return true;
  return false;
}

// Connection status
const sourceStatus = { flashscore: false, onexbet: false, polymarket: false };

// ── Team name normalization ─────────────────────────────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\b(fc|cf|sc|ac|as|ss|bk|fk|sk|united|utd|city|town|county|athletic|ath|sporting|sport|club|team|1909)\b/gi, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function makeMatchKey(home: string, away: string): string {
  return `${normalize(home)}__v__${normalize(away)}`;
}

// Fuzzy match: check if two normalized keys refer to the same match
function fuzzyMatchKeys(a: string, b: string): boolean {
  if (a === b) return true;
  const [aHome, aAway] = a.split('__v__');
  const [bHome, bAway] = b.split('__v__');
  if (!aHome || !aAway || !bHome || !bAway) return false;
  return (fuzzyTeam(aHome, bHome) && fuzzyTeam(aAway, bAway));
}

function fuzzyTeam(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Check if main words overlap (at least 1 word with 4+ chars matching)
  const aWords = a.split('_').filter(w => w.length >= 4);
  const bWords = b.split('_').filter(w => w.length >= 4);
  if (aWords.length === 0 || bWords.length === 0) return false;
  const overlap = aWords.filter(w => bWords.includes(w)).length;
  // Require at least 1 significant word in common
  return overlap >= 1;
}

// Find existing match key that fuzzy-matches, or return the given key
function resolveMatchKey(candidateKey: string): string {
  for (const existingKey of scoreState.keys()) {
    if (fuzzyMatchKeys(existingKey, candidateKey)) return existingKey;
  }
  return candidateKey;
}

// ── Score change handler ────────────────────────────────────────────────────

function onScore(source: string, rawKey: string, displayName: string, home: number, away: number): void {
  const now = Date.now();
  const newScore = `${home}-${away}`;
  const matchKey = resolveMatchKey(rawKey);

  if (!scoreState.has(matchKey)) scoreState.set(matchKey, new Map());
  const match = scoreState.get(matchKey)!;

  const prevScore = match.get(source) || '?-?';
  if (prevScore === newScore) return;
  match.set(source, newScore);

  // Skip startup artifacts (first score seen from this source for this match)
  if (prevScore === '?-?') return;

  // Real goal detected
  const timeStr = new Date(now).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const event: GoalEvent = {
    source,
    matchKey,
    displayName,
    scoreBefore: prevScore,
    scoreAfter: newScore,
    timestamp: now,
    isoTime: timeStr,
  };
  goalLog.push(event);

  // Find same goal from other sources
  const sameGoal = goalLog.filter(
    g => g.matchKey === matchKey && g.scoreAfter === newScore && g.source !== source
  );

  const srcPad = source.padEnd(11);
  const namePad = displayName.padEnd(45);

  if (sameGoal.length > 0) {
    const first = sameGoal.reduce((a, b) => a.timestamp < b.timestamp ? a : b);
    const delta = now - first.timestamp;
    console.log(`\x1b[33m⚽ [${timeStr}] ${srcPad} | ${namePad} | ${prevScore} → ${newScore} | +${formatMs(delta)} after ${first.source}\x1b[0m`);
    logGoal(now, source, displayName, prevScore, newScore, delta, first.source);
  } else {
    console.log(`\x1b[32m⚽ [${timeStr}] ${srcPad} | ${namePad} | ${prevScore} → ${newScore} | FIRST\x1b[0m`);
    logGoal(now, source, displayName, prevScore, newScore, 0, source);
  }

  // Show all sources' timing for this goal once 2+ have reported
  if (sameGoal.length === 1) {
    // Second source just arrived — print comparison
    const all = goalLog.filter(g => g.matchKey === matchKey && g.scoreAfter === newScore);
    printGoalComparison(all, displayName, newScore);
  } else if (sameGoal.length === 2) {
    // Third source arrived — update comparison
    const all = goalLog.filter(g => g.matchKey === matchKey && g.scoreAfter === newScore);
    printGoalComparison(all, displayName, newScore);
  }
}

function printGoalComparison(events: GoalEvent[], match: string, score: string): void {
  if (events.length < 2) return;
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0];
  console.log(`   ┌─ ${match} → ${score}`);
  for (const e of sorted) {
    const delta = e.timestamp - first.timestamp;
    const marker = delta === 0 ? '🥇' : delta < 3000 ? '🥈' : '🥉';
    console.log(`   │  ${marker} ${e.source.padEnd(11)} @ ${e.isoTime}  ${delta === 0 ? 'FIRST' : `+${formatMs(delta)}`}`);
  }
  // Show which sources haven't reported yet
  const reported = new Set(events.map(e => e.source));
  const missing = ['FLASHSCORE', '1XBET', 'POLYMARKET'].filter(s => !reported.has(s));
  if (missing.length > 0) {
    console.log(`   │  ⏳ waiting: ${missing.join(', ')}`);
  }
  console.log(`   └─`);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── FlashScore (WebSocket + HTTP bootstrap) ─────────────────────────────────

async function startFlashScore(): Promise<void> {
  // 1. HTTP fetch for initial match cache
  console.log('[FLASHSCORE] Fetching initial match list via HTTP...');
  try {
    const matches = await fetchAllFootball();
    const liveCount = matches.filter(m => m.status === 'live').length;
    console.log(`[FLASHSCORE] ${matches.length} total matches, ${liveCount} live`);

    for (const m of matches) {
      fsMatchCache.set(m.id, m);
      if (m.status === 'live' && m.homeScore !== null && m.awayScore !== null) {
        const key = makeMatchKey(m.home, m.away);
        const resolved = resolveMatchKey(key);
        if (!scoreState.has(resolved)) scoreState.set(resolved, new Map());
        scoreState.get(resolved)!.set('FLASHSCORE', `${m.homeScore}-${m.awayScore}`);
      }
    }
  } catch (err: any) {
    console.error(`[FLASHSCORE] HTTP fetch failed: ${err.message}`);
  }

  // 2. WebSocket for real-time updates
  const ws = new FlashScoreWS();
  ws.onUpdate((updates: FSLiveUpdate[]) => {
    for (const u of updates) {
      // Merge into cache
      const cached = fsMatchCache.get(u.matchId);
      const home = u.home || cached?.home || '';
      const away = u.away || cached?.away || '';
      if (!home || !away) continue;

      // Update cache
      if (cached) {
        if (u.home) cached.home = u.home;
        if (u.away) cached.away = u.away;
        if (u.homeScore !== undefined) cached.homeScore = u.homeScore;
        if (u.awayScore !== undefined) cached.awayScore = u.awayScore;
        if (u.minute) cached.minute = u.minute;
      } else {
        fsMatchCache.set(u.matchId, {
          id: u.matchId,
          home, away,
          homeScore: u.homeScore ?? null,
          awayScore: u.awayScore ?? null,
          minute: u.minute || '',
          status: 'live',
          league: u.league || '',
          country: u.country || '',
          startTime: u.startTime ?? null,
        });
      }

      // Detect score changes
      const homeScore = u.homeScore ?? cached?.homeScore;
      const awayScore = u.awayScore ?? cached?.awayScore;
      if (homeScore === undefined || homeScore === null ||
          awayScore === undefined || awayScore === null) continue;

      const key = makeMatchKey(home, away);
      const display = `${home} vs ${away}`;
      onScore('FLASHSCORE', key, display, homeScore, awayScore);
    }
  });

  ws.onConnect((connected) => {
    sourceStatus.flashscore = connected;
    if (connected) {
      console.log('[FLASHSCORE] WebSocket connected — live push active');
    } else {
      console.log('[FLASHSCORE] WebSocket disconnected');
    }
  });

  ws.connect();
}

// ── 1xBet (HTTP discovery + polling) ────────────────────────────────────────

async function discoverXbetGames(): Promise<XbetGame[]> {
  const url = `${ONEXBET_BASE}/service-api/LiveFeed/Get1x2_Zip?sports=1&count=500&lng=en&getEmpty=true&partner=7&country=190`;
  const resp = await fetch(url, {
    headers: { ...HEADERS, 'Referer': `${ONEXBET_BASE}/en/live/football/` },
  });
  if (!resp.ok) throw new Error(`1xBet discovery: ${resp.status}`);
  const data = await resp.json() as any;
  const items = data.Value || data || [];
  const games: XbetGame[] = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (item.I && item.O1 && item.O2) {
      if (isVirtualMatch(item.O1, item.O2)) continue;
      games.push({ id: item.I, home: item.O1, away: item.O2, league: item.L || '' });
    }
  }
  return games;
}

async function fetchXbetScore(gameId: number): Promise<{ home: number; away: number } | null> {
  const url = `${ONEXBET_BASE}/service-api/LiveFeed/GetGameZip?id=${gameId}&lng=en&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=7&country=190&marketType=1`;
  try {
    const resp = await fetch(url, {
      headers: { ...HEADERS, 'Referer': `${ONEXBET_BASE}/en/live/` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const val = data.Value || data;
    if (!val?.SC) return null;

    // Prefer period score sums (more reliable than SC.FS which can lag behind)
    if (val.SC.PS && Array.isArray(val.SC.PS) && val.SC.PS.length > 0) {
      let h = 0, a = 0;
      for (const p of val.SC.PS) {
        const v = p.Value || p;
        h += v.S1 || 0;
        a += v.S2 || 0;
      }
      return { home: h, away: a };
    }
    if (val.SC.FS) {
      return { home: val.SC.FS.S1 || 0, away: val.SC.FS.S2 || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function pollXbetOnce(): Promise<void> {
  const games = xbetGames;
  for (let i = 0; i < games.length; i += ONEXBET_BATCH) {
    const batch = games.slice(i, i + ONEXBET_BATCH);
    await Promise.allSettled(batch.map(async (game) => {
      const score = await fetchXbetScore(game.id);
      if (!score) return;

      const newScoreStr = `${score.home}-${score.away}`;
      const prevScoreStr = xbetScoreCache.get(game.id);

      // Monotonic constraint: in soccer, total goals can't decrease.
      // API sometimes flip-flops between SC.FS (stale zeros) and SC.PS (real scores).
      if (prevScoreStr) {
        const [ph, pa] = prevScoreStr.split('-').map(Number);
        if (score.home + score.away < ph + pa) return; // Ignore backwards score
      }

      xbetScoreCache.set(game.id, newScoreStr);

      const key = makeMatchKey(game.home, game.away);
      const display = `${game.home} vs ${game.away}`;
      onScore('1XBET', key, display, score.home, score.away);
    }));
  }
}

async function startOnexbet(): Promise<void> {
  console.log('[1XBET] Discovering live soccer games...');
  try {
    xbetGames = await discoverXbetGames();
    console.log(`[1XBET] Found ${xbetGames.length} live soccer games`);
    sourceStatus.onexbet = true;

    // Seed initial scores
    console.log('[1XBET] Seeding initial scores...');
    await pollXbetOnce();
    console.log('[1XBET] Initial scores seeded');
  } catch (err: any) {
    console.error(`[1XBET] Discovery failed: ${err.message}`);
  }

  // Start fast polling
  const poll = async () => {
    try { await pollXbetOnce(); } catch { /* ignore */ }
  };
  setInterval(poll, ONEXBET_POLL_MS);

  // Re-discover periodically for new matches
  setInterval(async () => {
    try {
      const newGames = await discoverXbetGames();
      const newIds = new Set(newGames.map(g => g.id));
      const oldIds = new Set(xbetGames.map(g => g.id));
      const added = newGames.filter(g => !oldIds.has(g.id));
      const removed = xbetGames.filter(g => !newIds.has(g.id));
      if (added.length > 0 || removed.length > 0) {
        console.log(`[1XBET] Re-discovery: +${added.length} -${removed.length} games (total: ${newGames.length})`);
      }
      xbetGames = newGames;
      // Clean removed games from cache
      for (const g of removed) xbetScoreCache.delete(g.id);
    } catch { /* ignore */ }
  }, ONEXBET_DISCOVERY_INTERVAL_MS);
}

// ── Polymarket (Scores WebSocket) ───────────────────────────────────────────

async function startPolymarket(): Promise<void> {
  console.log('[POLYMARKET] Connecting to scores WebSocket...');
  const ws = new ScoresWebSocket(PM_SCORES_URL);

  ws.onScoreUpdate((update: ScoreUpdate) => {
    if (!update.homeTeam || !update.awayTeam) return;
    if (!update.score) return;

    // Filter to soccer only: soccer periods are "1H", "2H", "HT", "FT", "ET"
    // Basketball/NFL use "Q1"-"Q4", baseball "Top 1"-"Bot 9", etc.
    // Also filter by score magnitude: soccer scores are typically < 15 total
    const period = (update.period || '').toUpperCase();
    const isSoccer = !period || /^(1H|2H|HT|FT|ET|1ST|2ND|OT|PEN)/.test(period);

    // Parse score "3-1" format
    const parts = update.score.split('-').map(s => parseInt(s.trim()));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return;
    const [home, away] = parts;

    // Soccer scores are low — skip if total > 20 (basketball, etc.)
    if (home + away > 20) return;
    if (!isSoccer && home + away > 10) return;

    const key = makeMatchKey(update.homeTeam, update.awayTeam);
    const display = `${update.homeTeam} vs ${update.awayTeam}`;
    onScore('POLYMARKET', key, display, home, away);
  });

  try {
    await ws.connect();
    sourceStatus.polymarket = true;
    console.log('[POLYMARKET] Scores WebSocket connected');
  } catch (err: any) {
    console.error(`[POLYMARKET] Connection failed: ${err.message}`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────

function printSummary(): void {
  if (goalLog.length === 0) {
    console.log('\n📊 No goals detected yet.\n');
    return;
  }

  // Group goals by matchKey + scoreAfter
  const goalGroups = new Map<string, GoalEvent[]>();
  for (const e of goalLog) {
    const gKey = `${e.matchKey}|${e.scoreAfter}`;
    if (!goalGroups.has(gKey)) goalGroups.set(gKey, []);
    goalGroups.get(gKey)!.push(e);
  }

  // Compute per-source stats
  const stats: Record<string, { first: number; deltas: number[] }> = {
    FLASHSCORE: { first: 0, deltas: [] },
    '1XBET': { first: 0, deltas: [] },
    POLYMARKET: { first: 0, deltas: [] },
  };

  let multiSourceGoals = 0;

  for (const events of goalGroups.values()) {
    if (events.length < 2) continue;
    multiSourceGoals++;
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = sorted[0].timestamp;

    // First source gets a "win"
    stats[sorted[0].source].first++;

    for (const e of sorted) {
      stats[e.source].deltas.push(e.timestamp - firstTs);
    }
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 GOAL TIMING SUMMARY — ${goalLog.length} total detections, ${multiSourceGoals} multi-source goals`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`${'Source'.padEnd(14)} | ${'Goals'.padEnd(6)} | ${'First'.padEnd(6)} | ${'Avg Δ'.padEnd(10)} | ${'Med Δ'.padEnd(10)} | ${'Min Δ'.padEnd(10)} | ${'Max Δ'.padEnd(10)}`);
  console.log(`${'-'.repeat(14)}-|-${'-'.repeat(6)}-|-${'-'.repeat(6)}-|-${'-'.repeat(10)}-|-${'-'.repeat(10)}-|-${'-'.repeat(10)}-|-${'-'.repeat(10)}`);

  for (const [source, s] of Object.entries(stats)) {
    if (s.deltas.length === 0) {
      console.log(`${source.padEnd(14)} | ${'0'.padEnd(6)} | ${'0'.padEnd(6)} | ${'—'.padEnd(10)} | ${'—'.padEnd(10)} | ${'—'.padEnd(10)} | ${'—'.padEnd(10)}`);
      continue;
    }
    const sorted = [...s.deltas].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const med = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    console.log(
      `${source.padEnd(14)} | ${String(s.deltas.length).padEnd(6)} | ` +
      `${String(s.first).padEnd(6)} | ${formatMs(avg).padEnd(10)} | ` +
      `${formatMs(med).padEnd(10)} | ${formatMs(min).padEnd(10)} | ${formatMs(max).padEnd(10)}`
    );
  }

  console.log(`${'═'.repeat(80)}\n`);

  // Recent goals
  const recent = goalLog.slice(-10);
  if (recent.length > 0) {
    console.log('Recent detections:');
    for (const e of recent) {
      console.log(`  ${e.isoTime} | ${e.source.padEnd(11)} | ${e.displayName.substring(0, 40).padEnd(40)} | ${e.scoreBefore}→${e.scoreAfter}`);
    }
    console.log('');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        ⚽ GOAL TIMING TEST — 3-Source Comparison            ║');
  console.log('║   FlashScore (WS) vs 1xBet (HTTP) vs Polymarket (WS)       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Start all sources in parallel
  await Promise.allSettled([
    startFlashScore(),
    startOnexbet(),
    startPolymarket(),
  ]);

  console.log('');
  console.log(`Status: FS=${sourceStatus.flashscore ? '✓' : '✗'}  1xBet=${sourceStatus.onexbet ? '✓' : '✗'}  PM=${sourceStatus.polymarket ? '✓' : '✗'}`);
  console.log(`Tracking ${scoreState.size} unique matches across all sources`);
  console.log('Waiting for live goals... (summary every 5 min, Ctrl+C to stop)\n');

  // Print summary periodically
  setInterval(printSummary, SUMMARY_INTERVAL_MS);

  // Also print on SIGINT before exit
  process.on('SIGINT', () => {
    console.log('\n\nFinal summary before exit:');
    printSummary();
    process.exit(0);
  });
}

main().catch(console.error);
