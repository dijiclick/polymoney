import type { UnifiedEvent } from '../types/unified-event.js';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('signals');

export interface SignalAlert {
  type: 'odds_divergence' | 'score_change' | 'stale_odds';
  severity: 'low' | 'medium' | 'high';
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  message: string;
  data: Record<string, any>;
  timestamp: number;
}

// Global alerts store for dashboard
const MAX_ALERTS = 200;
const alerts: SignalAlert[] = [];

export function getAlerts(): SignalAlert[] {
  return alerts;
}

function addAlert(alert: SignalAlert): void {
  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
}

// Signal 1: Odds Divergence
// When odds from different sources differ by more than a threshold
export const oddsDivergenceSignal: SignalFunction = (event, changedKeys, source) => {
  for (const key of changedKeys) {
    const sources = event.markets[key];
    if (!sources) continue;
    
    const entries = Object.entries(sources);
    if (entries.length < 2) continue;
    
    // Compare all pairs
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [src1, odds1] = entries[i];
        const [src2, odds2] = entries[j];
        
        const diff = Math.abs(odds1.value - odds2.value);
        const avgOdds = (odds1.value + odds2.value) / 2;
        const pctDiff = (diff / avgOdds) * 100;
        
        if (pctDiff > 10) { // >10% divergence
          const severity = pctDiff > 25 ? 'high' : pctDiff > 15 ? 'medium' : 'low';
          addAlert({
            type: 'odds_divergence',
            severity,
            eventId: event.id,
            homeTeam: event.home.name || '?',
            awayTeam: event.away.name || '?',
            message: `${key}: ${src1}=${odds1.value.toFixed(3)} vs ${src2}=${odds2.value.toFixed(3)} (${pctDiff.toFixed(1)}% diff)`,
            data: { market: key, src1, src2, odds1: odds1.value, odds2: odds2.value, pctDiff },
            timestamp: Date.now(),
          });
        }
      }
    }
  }
};

// Signal 2: Score Change Detection
// When FlashScore/1xBet reports a score change
export const scoreChangeSignal: SignalFunction = (event, changedKeys, source) => {
  if (source === 'polymarket') return; // Polymarket scores are slower, not interesting
  
  if (!event.stats.score) return;
  
  // Check if score key is in changed keys (state-store tracks this)
  const scoreChanged = changedKeys.some(k => k === '__score');
  if (!scoreChanged) return;
  
  const { score } = event.stats;
  addAlert({
    type: 'score_change',
    severity: 'high',
    eventId: event.id,
    homeTeam: event.home.name || '?',
    awayTeam: event.away.name || '?',
    message: `🏆 SCORE! ${event.home.name} ${score.home} - ${score.away} ${event.away.name} [${event.sport || '?'}] (via ${source})`,
    data: { source, score, markets: Object.keys(event.markets) },
    timestamp: Date.now(),
  });
};

// Signal 3: Stale Odds Detection
// When one source hasn't updated while others are actively changing
export const staleOddsSignal: SignalFunction = (event, changedKeys, source) => {
  const now = Date.now();
  const STALE_THRESHOLD = 30_000; // 30 seconds
  
  for (const key of ['ml_home_ft', 'ml_away_ft', 'draw_ft']) {
    const sources = event.markets[key];
    if (!sources) continue;
    
    const entries = Object.entries(sources);
    if (entries.length < 2) continue;
    
    // Find freshest and stalest
    let freshest = { src: '', ts: 0 };
    let stalest = { src: '', ts: Infinity };
    
    for (const [src, odds] of entries) {
      if (odds.timestamp > freshest.ts) freshest = { src, ts: odds.timestamp };
      if (odds.timestamp < stalest.ts) stalest = { src, ts: odds.timestamp };
    }
    
    const gap = freshest.ts - stalest.ts;
    if (gap > STALE_THRESHOLD && stalest.src === 'polymarket') {
      addAlert({
        type: 'stale_odds',
        severity: 'medium',
        eventId: event.id,
        homeTeam: event.home.name || '?',
        awayTeam: event.away.name || '?',
        message: `${key}: Polymarket stale by ${(gap/1000).toFixed(0)}s while ${freshest.src} active`,
        data: { market: key, staleSrc: stalest.src, freshSrc: freshest.src, gapMs: gap },
        timestamp: Date.now(),
      });
    }
  }
};
