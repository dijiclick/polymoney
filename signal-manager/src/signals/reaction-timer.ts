import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('reaction-timer');

// --- Price trajectory tracking ---

interface PricePoint {
  delta: number;   // ms since goal
  value: number;   // decimal odds
  prob: number;    // implied probability %
}

interface PerTrajectory {
  initial: number;          // decimal odds at goal moment (0 if source didn't exist)
  points: PricePoint[];     // all changes after goal
  lastMeaningfulChangeAt: number; // last time prob moved by >= STABLE_PROB_PP
  stabilized: boolean;      // this individual trajectory is done
}

interface OddsSnapshot {
  [market: string]: {
    polymarket?: { value: number; ts: number };
    onexbet?: { value: number; ts: number };
  };
}

interface PendingGoal {
  eventId: string;
  match: string;
  league: string;
  scoreBefore: { home: number; away: number };
  scoreAfter: { home: number; away: number };
  detectedAt: number;
  detectedBy: string;
  oddsSnapshot: OddsSnapshot;
  trajectories: Map<string, PerTrajectory>;
  finalized: boolean;
}

export interface TrajectoryEntry {
  source: string;
  market: string;
  initialOdds: number;
  initialProb: number;
  stableOdds: number;
  stableProb: number;
  peakProb: number;          // highest probability seen
  troughProb: number;        // lowest probability seen
  totalProbChange: number;   // percentage points
  firstReactionMs: number;
  stableAfterMs: number;
  priceUpdates: number;
}

export interface ReactionLogEntry {
  goalId: string;
  timestamp: number;
  match: string;
  league: string;
  scoreBefore: string;
  scoreAfter: string;
  detectedBy: string;
  trajectories: TrajectoryEntry[];
}

const STABLE_PROB_PP = 0.5;         // <0.5pp move = not meaningful
const STABLE_PER_TRAJ_MS = 15_000;  // 15s of no meaningful move per trajectory = stable
const MAX_TRACKING_MS = 3 * 60_000; // 3 min max tracking
const MAX_PENDING = 50;

const pendingGoals: Map<string, PendingGoal> = new Map();
const reactionLog: ReactionLogEntry[] = [];
let goalCounter = 0;

const LOG_DIR = join(process.cwd(), 'data');
const LOG_FILE = join(LOG_DIR, 'reaction-times.jsonl');

function ensureLogDir(): void {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
}

function writeLogEntry(entry: ReactionLogEntry): void {
  ensureLogDir();
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

function toProb(decimal: number): number {
  if (decimal <= 0) return 0;
  return Math.round((1 / decimal) * 10000) / 100;
}

// Score tracking per event
const lastKnownScore: Map<string, { home: number; away: number }> = new Map();

export function getReactionLog(): ReactionLogEntry[] {
  return reactionLog;
}

export function getPendingGoals(): { eventId: string; match: string; score: string; age: number; tracking: number }[] {
  const now = Date.now();
  return Array.from(pendingGoals.values()).map(p => ({
    eventId: p.eventId,
    match: p.match,
    score: `${p.scoreAfter.home}-${p.scoreAfter.away}`,
    age: Math.round((now - p.detectedAt) / 1000),
    tracking: p.trajectories.size,
  }));
}

export const reactionTimerSignal: SignalFunction = (event, changedKeys, source) => {
  const now = Date.now();

  // === STEP 1: Detect score changes ===
  if (changedKeys.includes('__score') && source !== 'polymarket' && event.stats.score) {
    const prevScore = lastKnownScore.get(event.id) || null;
    const newScore = { ...event.stats.score };
    lastKnownScore.set(event.id, newScore);

    // Skip startup artifacts: first score seen for an event is not a real goal
    if (!prevScore) return;

    if (prevScore.home === newScore.home && prevScore.away === newScore.away) return;

    const goalKey = `${event.id}_${newScore.home}-${newScore.away}`;
    if (pendingGoals.has(goalKey)) return;

    // Snapshot ALL markets with odds data (not just ML)
    const snapshot: OddsSnapshot = {};
    const trajectories = new Map<string, PerTrajectory>();

    for (const [mk, sources] of Object.entries(event.markets)) {
      if (mk.startsWith('__')) continue; // skip internal keys
      const mktSnapshot: OddsSnapshot[string] = {};
      let hasData = false;
      if (sources.polymarket) {
        mktSnapshot.polymarket = { value: sources.polymarket.value, ts: sources.polymarket.timestamp };
        trajectories.set(`polymarket:${mk}`, { initial: sources.polymarket.value, points: [], lastMeaningfulChangeAt: now, stabilized: false });
        hasData = true;
      }
      if (sources.onexbet) {
        mktSnapshot.onexbet = { value: sources.onexbet.value, ts: sources.onexbet.timestamp };
        trajectories.set(`onexbet:${mk}`, { initial: sources.onexbet.value, points: [], lastMeaningfulChangeAt: now, stabilized: false });
        hasData = true;
      }
      if (hasData) snapshot[mk] = mktSnapshot;
    }

    const matchName = `${event.home.name || '?'} vs ${event.away.name || '?'}`;
    pendingGoals.set(goalKey, {
      eventId: event.id,
      match: matchName,
      league: event.league,
      scoreBefore: prevScore,
      scoreAfter: newScore,
      detectedAt: now,
      detectedBy: source,
      oddsSnapshot: snapshot,
      trajectories,
      finalized: false,
    });

    log.info(
      `⏱ SCORE [${source}] ${matchName} | ${event.sport || '?'} | ${prevScore.home}-${prevScore.away} → ${newScore.home}-${newScore.away} | Tracking ${trajectories.size} streams across ${Object.keys(snapshot).length} markets`
    );

    // Evict oldest if too many
    if (pendingGoals.size > MAX_PENDING) {
      const oldest = Array.from(pendingGoals.entries())
        .sort((a, b) => a[1].detectedAt - b[1].detectedAt)[0];
      if (oldest) finalizePendingGoal(oldest[0], oldest[1]);
    }
  }

  // === STEP 2: Track ALL odds changes on pending goals ===
  if (source !== 'polymarket' && source !== 'onexbet') return;

  // Accept any changed market key (not just ML)
  const relevantKeys = changedKeys.filter(k => !k.startsWith('__'));
  if (relevantKeys.length === 0) return;

  for (const [goalKey, pending] of pendingGoals) {
    if (pending.eventId !== event.id || pending.finalized) continue;
    if (now - pending.detectedAt > MAX_TRACKING_MS) {
      finalizePendingGoal(goalKey, pending);
      continue;
    }

    for (const mk of relevantKeys) {
      const currentSources = event.markets[mk];
      if (!currentSources) continue;

      const tKey = `${source}:${mk}`;
      const sourceData = currentSources[source];
      if (!sourceData) continue;

      let traj = pending.trajectories.get(tKey);
      if (!traj) {
        // Source appeared after goal — set initial to current value (not 0)
        traj = { initial: sourceData.value, points: [], lastMeaningfulChangeAt: now, stabilized: false };
        pending.trajectories.set(tKey, traj);
      }

      if (traj.stabilized) continue; // already done tracking this trajectory

      const lastValue = traj.points.length > 0 ? traj.points[traj.points.length - 1].value : traj.initial;
      if (sourceData.value !== lastValue) {
        const delta = now - pending.detectedAt;
        const newProb = toProb(sourceData.value);
        const lastProb = toProb(lastValue);

        traj.points.push({ delta, value: sourceData.value, prob: newProb });

        // Check if this was a meaningful move
        if (Math.abs(newProb - lastProb) >= STABLE_PROB_PP) {
          traj.lastMeaningfulChangeAt = now;
        }

        // Log first reaction
        if (traj.points.length === 1) {
          const srcLabel = source === 'polymarket' ? 'PM' : '1xBet';
          const initProb = toProb(traj.initial);
          log.debug(
            `⏱ ${srcLabel} FIRST [${(delta / 1000).toFixed(1)}s] ${pending.match} | ${mk} | ${initProb.toFixed(1)}% → ${newProb.toFixed(1)}% (Δ${(newProb - initProb).toFixed(1)}pp)`
          );
        }
      }
    }
  }
};

function finalizePendingGoal(goalKey: string, pending: PendingGoal): void {
  if (pending.finalized) return;
  pending.finalized = true;
  pendingGoals.delete(goalKey);

  const trajEntries: TrajectoryEntry[] = [];

  for (const [tKey, traj] of pending.trajectories) {
    const [source, market] = tKey.split(':');
    const initialProb = toProb(traj.initial);

    if (traj.points.length === 0) continue; // no data = skip entirely

    const stableValue = traj.points[traj.points.length - 1].value;
    const stableProb = toProb(stableValue);

    // Compute peak and trough
    let peakProb = initialProb;
    let troughProb = initialProb;
    for (const pt of traj.points) {
      if (pt.prob > peakProb) peakProb = pt.prob;
      if (pt.prob < troughProb) troughProb = pt.prob;
    }

    trajEntries.push({
      source,
      market,
      initialOdds: Math.round(traj.initial * 1000) / 1000,
      initialProb,
      stableOdds: Math.round(stableValue * 1000) / 1000,
      stableProb,
      peakProb,
      troughProb,
      totalProbChange: Math.round((stableProb - initialProb) * 100) / 100,
      firstReactionMs: traj.points[0].delta,
      stableAfterMs: traj.points[traj.points.length - 1].delta,
      priceUpdates: traj.points.length,
    });
  }

  if (trajEntries.length === 0) return; // no meaningful data to log

  const entry: ReactionLogEntry = {
    goalId: `goal_${++goalCounter}`,
    timestamp: pending.detectedAt,
    match: pending.match,
    league: pending.league,
    scoreBefore: `${pending.scoreBefore.home}-${pending.scoreBefore.away}`,
    scoreAfter: `${pending.scoreAfter.home}-${pending.scoreAfter.away}`,
    detectedBy: pending.detectedBy,
    trajectories: trajEntries,
  };

  reactionLog.unshift(entry);
  if (reactionLog.length > 200) reactionLog.length = 200;
  writeLogEntry(entry);

  // Log summary — group by source
  const pmTrajs = trajEntries.filter(t => t.source === 'polymarket');
  const xbTrajs = trajEntries.filter(t => t.source === 'onexbet');

  const fmtTraj = (t: TrajectoryEntry) => {
    const mkt = t.market.replace(/_ft$/, '').replace(/_/g, ' ');
    return `${mkt}: ${t.initialProb.toFixed(1)}%→${t.stableProb.toFixed(1)}% (${t.totalProbChange > 0 ? '+' : ''}${t.totalProbChange.toFixed(1)}pp, peak:${t.peakProb.toFixed(0)}% low:${t.troughProb.toFixed(0)}%) @${(t.firstReactionMs / 1000).toFixed(1)}s [${t.priceUpdates}]`;
  };

  log.info(`⏱ STABILIZED ${entry.match} | ${entry.scoreBefore} → ${entry.scoreAfter} | by ${entry.detectedBy} | ${trajEntries.length} trajectories`);
  if (pmTrajs.length > 0) {
    log.info(`  PM: ${pmTrajs.map(fmtTraj).join(' | ')}`);
  }
  if (xbTrajs.length > 0) {
    log.info(`  1xBet: ${xbTrajs.map(fmtTraj).join(' | ')}`);
  }
}

// Periodic check: finalize goals with all trajectories stable, or past max time
setInterval(() => {
  const now = Date.now();
  for (const [goalKey, pending] of pendingGoals) {
    if (pending.finalized) continue;
    const totalAge = now - pending.detectedAt;

    // Max time exceeded
    if (totalAge >= MAX_TRACKING_MS) {
      finalizePendingGoal(goalKey, pending);
      continue;
    }

    // Per-trajectory stabilization: mark individual trajectories as stable
    let allStable = true;
    for (const [, traj] of pending.trajectories) {
      if (traj.stabilized) continue;
      const sinceMeaningful = now - traj.lastMeaningfulChangeAt;
      if (sinceMeaningful >= STABLE_PER_TRAJ_MS) {
        traj.stabilized = true;
      } else {
        allStable = false;
      }
    }

    // If ALL trajectories are stable, finalize early
    if (allStable && pending.trajectories.size > 0) {
      finalizePendingGoal(goalKey, pending);
    }
  }
}, 5_000);
