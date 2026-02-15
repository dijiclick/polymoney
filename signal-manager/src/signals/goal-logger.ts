/**
 * Goal Logger — Clean console output for soccer goals with source timing.
 *
 * Emits an immediate "⚽ GOAL" line when a soccer goal is detected,
 * then after 20s emits a consolidated source-timing summary showing
 * which adapter reported first and the delays of subsequent sources.
 */

import type { SignalFunction } from '../core/signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('goal');

interface GoalTimingEntry {
  eventId: string;
  match: string;
  prevScore: string;
  newScore: string;
  firstSource: string;
  firstTime: number;
  sourceTimes: Map<string, number>;
  timer: ReturnType<typeof setTimeout>;
  emitted: boolean;
}

const pendingTimings = new Map<string, GoalTimingEntry>();
const lastKnownScore = new Map<string, { home: number; away: number }>();

function emitTimingSummary(key: string): void {
  const entry = pendingTimings.get(key);
  if (!entry || entry.emitted) return;
  entry.emitted = true;
  pendingTimings.delete(key);

  const sorted = Array.from(entry.sourceTimes.entries())
    .sort(([, a], [, b]) => a - b);

  if (sorted.length <= 1) return; // Only one source reported — no timing comparison

  const firstTime = sorted[0][1];
  const parts = sorted.map(([src, ts], i) => {
    const delay = (ts - firstTime) / 1000;
    return i === 0 ? `${src} (0.0s)` : `${src} (+${delay.toFixed(1)}s)`;
  });

  log.warn(`   ${parts.join(' → ')}`);
}

export const goalLoggerSignal: SignalFunction = (event, changedKeys, source) => {
  if (!changedKeys.includes('__score')) return;
  if (!event.stats.score) return;
  if (event.sport !== 'soccer') return;

  const score = event.stats.score;
  const prevScore = lastKnownScore.get(event.id);
  lastKnownScore.set(event.id, { ...score });

  // Skip first-time bootstrap (no previous score known)
  if (!prevScore) return;

  // Skip if score didn't actually change
  if (prevScore.home === score.home && prevScore.away === score.away) return;

  const key = `${event.id}_${score.home}-${score.away}`;
  const now = Date.now();

  // If this score was already seen (another source reporting same goal), just record timing
  const existing = pendingTimings.get(key);
  if (existing) {
    if (!existing.sourceTimes.has(source)) {
      existing.sourceTimes.set(source, now);
    }
    return;
  }

  // New goal detected — emit immediate line
  const match = `${event.home.name || '?'} vs ${event.away.name || '?'}`;
  log.warn(`⚽ GOAL | ${match} | ${prevScore.home}-${prevScore.away} → ${score.home}-${score.away} | Source: ${source}`);

  const entry: GoalTimingEntry = {
    eventId: event.id,
    match,
    prevScore: `${prevScore.home}-${prevScore.away}`,
    newScore: `${score.home}-${score.away}`,
    firstSource: source,
    firstTime: now,
    sourceTimes: new Map([[source, now]]),
    timer: setTimeout(() => emitTimingSummary(key), 20_000),
    emitted: false,
  };
  pendingTimings.set(key, entry);

  // Evict old entries
  if (pendingTimings.size > 100) {
    const oldest = Array.from(pendingTimings.entries())
      .sort((a, b) => a[1].firstTime - b[1].firstTime)[0];
    if (oldest) {
      clearTimeout(oldest[1].timer);
      pendingTimings.delete(oldest[0]);
    }
  }
};
