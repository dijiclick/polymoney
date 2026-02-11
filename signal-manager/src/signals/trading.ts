import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { UnifiedEvent } from '../types/unified-event.js';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('trading');

export type TradeAction = 'BUY_YES' | 'BUY_NO' | 'HOLD';

export interface Opportunity {
  id: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  action: TradeAction;
  edge: number;            // absolute pp edge
  edgeDirection: number;   // positive = PM underpriced, negative = PM overpriced
  polyProb: number;        // PM implied probability (0-100)
  xbetProb: number;        // 1xBet implied probability (0-100)
  polyOdds: number;        // PM decimal odds
  xbetOdds: number;        // 1xBet decimal odds
  polyAgeMs: number;       // how old PM data is
  xbetAgeMs: number;       // how old 1xBet data is
  quality: 'good' | 'medium' | 'suspect';
  qualityNote: string;
  firstSeen: number;       // when first detected
  lastUpdated: number;     // when last refreshed
  belowThresholdSince: number | null;
  suspectSince: number | null;    // when quality first became 'suspect'
  peakEdge: number;        // highest edge seen during lifetime
  score?: { home: number; away: number };
  eventStatus: string;
  edgeHistory: number[];   // last N edge values for trend
}

interface ClosedOpportunityLog {
  id: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  action: TradeAction;
  peakEdge: number;
  finalEdge: number;
  quality: string;
  firstSeen: number;
  closedAt: number;
  durationMs: number;
  eventStatus: string;
  polyProb: number;
  xbetProb: number;
}

// Active opportunities — one per event+market, updates in-place
const opportunities: Map<string, Opportunity> = new Map();
// Historical log of closed opportunities (in-memory)
const closedOpportunities: Opportunity[] = [];

let idCounter = 0;

const MAX_EDGE_HISTORY = 20;
const MIN_EDGE_PP = 3;           // minimum 3pp edge to show
const MAX_SANE_EDGE_PP = 35;     // >35pp is likely data error
const STALE_LIVE_MS = 30_000;    // 30s for live events
const STALE_PREMATCH_MS = 600_000; // 10min for pre-match
const EXPIRE_NO_EDGE_MS = 30_000;  // remove opportunity 30s after edge drops below threshold

const LOG_DIR = join(process.cwd(), 'data');
const OPP_LOG_FILE = join(LOG_DIR, 'opportunities.jsonl');

function ensureLogDir(): void {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
}

function writeClosedOpp(opp: Opportunity): void {
  ensureLogDir();
  const now = Date.now();
  const entry: ClosedOpportunityLog = {
    id: opp.id,
    eventId: opp.eventId,
    homeTeam: opp.homeTeam,
    awayTeam: opp.awayTeam,
    league: opp.league,
    market: opp.market,
    action: opp.action,
    peakEdge: opp.peakEdge,
    finalEdge: opp.edge,
    quality: opp.quality,
    firstSeen: opp.firstSeen,
    closedAt: now,
    durationMs: now - opp.firstSeen,
    eventStatus: opp.eventStatus,
    polyProb: opp.polyProb,
    xbetProb: opp.xbetProb,
  };
  appendFileSync(OPP_LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

export function getTradeSignals(): Opportunity[] {
  // Return only active, non-suspect opportunities
  return Array.from(opportunities.values())
    .filter(o => o.belowThresholdSince === null && o.quality !== 'suspect')
    .sort((a, b) => {
      const qOrder = { good: 0, medium: 1, suspect: 2 };
      const qDiff = qOrder[a.quality] - qOrder[b.quality];
      if (qDiff !== 0) return qDiff;
      return b.edge - a.edge;
    });
}

export function getClosedOpportunities(): Opportunity[] {
  return closedOpportunities;
}

function toProb(decimal: number): number {
  if (decimal <= 0) return 0;
  return (1 / decimal) * 100;
}

function closeOpportunity(key: string, opp: Opportunity): void {
  opportunities.delete(key);
  closedOpportunities.unshift(opp);
  if (closedOpportunities.length > 200) closedOpportunities.length = 200;
  // Only persist opportunities that had a real edge at some point
  if (opp.peakEdge >= MIN_EDGE_PP) {
    writeClosedOpp(opp);
  }
}

// Main trading signal — processes ALL market keys with both sources
export const tradingSignal: SignalFunction = (event, changedKeys, source) => {
  // Accept any market key (not just ML) — skip internal keys
  const marketKeys = changedKeys.filter(k => !k.startsWith('__'));
  if (marketKeys.length === 0) return;

  const now = Date.now();

  for (const key of marketKeys) {
    const sources = event.markets[key];
    if (!sources) continue;

    const polyData = sources['polymarket'];
    const xbetData = sources['onexbet'];

    // Need both sources
    if (!polyData || !xbetData) continue;

    const polyProb = toProb(polyData.value);
    const xbetProb = toProb(xbetData.value);
    const edgeDirection = xbetProb - polyProb; // positive = PM underpriced
    const absEdge = Math.abs(edgeDirection);

    const polyAge = now - polyData.timestamp;
    const xbetAge = now - xbetData.timestamp;

    const oppKey = `${event.id}:${key}`;
    const existing = opportunities.get(oppKey);

    // === Quality assessment ===
    const isLive = event.status === 'live';
    const staleThreshold = isLive ? STALE_LIVE_MS : STALE_PREMATCH_MS;

    let quality: 'good' | 'medium' | 'suspect' = 'good';
    let qualityNote = '';

    if (absEdge > MAX_SANE_EDGE_PP) {
      quality = 'suspect';
      qualityNote = `Edge ${absEdge.toFixed(0)}pp too high — likely data mismatch`;
    } else if (polyAge > staleThreshold) {
      quality = 'suspect';
      qualityNote = `PM data stale (${Math.round(polyAge / 1000)}s old)`;
    } else if (xbetAge > staleThreshold) {
      quality = isLive ? 'suspect' : 'medium';
      qualityNote = `1xBet data ${Math.round(xbetAge / 1000)}s old`;
    } else if (absEdge > 20) {
      quality = 'medium';
      qualityNote = 'Very large edge — verify manually';
    }

    if (quality === 'good' && absEdge < 8 && absEdge >= MIN_EDGE_PP) {
      qualityNote = 'Sources close, edge within normal range';
    }

    // === Edge below threshold → update or skip ===
    if (absEdge < MIN_EDGE_PP) {
      if (existing) {
        existing.edge = absEdge;
        existing.edgeDirection = edgeDirection;
        existing.action = edgeDirection > 0 ? 'BUY_YES' : 'BUY_NO';
        existing.polyProb = polyProb;
        existing.xbetProb = xbetProb;
        existing.polyOdds = polyData.value;
        existing.xbetOdds = xbetData.value;
        existing.polyAgeMs = polyAge;
        existing.xbetAgeMs = xbetAge;
        existing.quality = quality;
        existing.qualityNote = qualityNote || 'Edge below threshold';
        existing.lastUpdated = now;
        existing.score = event.stats.score;
        existing.eventStatus = event.status;
        if (existing.belowThresholdSince === null) {
          existing.belowThresholdSince = now;
        }
        existing.suspectSince = quality === 'suspect' ? (existing.suspectSince ?? now) : null;
        existing.edgeHistory.push(absEdge);
        if (existing.edgeHistory.length > MAX_EDGE_HISTORY) existing.edgeHistory.shift();
      }
      continue;
    }

    // === Create or update opportunity ===
    const action: TradeAction = edgeDirection > 0 ? 'BUY_YES' : 'BUY_NO';
    const homeName = event.home.name || Object.values(event.home.aliases)[0] || '?';
    const awayName = event.away.name || Object.values(event.away.aliases)[0] || '?';

    if (existing) {
      existing.action = action;
      existing.edge = absEdge;
      existing.edgeDirection = edgeDirection;
      existing.polyProb = polyProb;
      existing.xbetProb = xbetProb;
      existing.polyOdds = polyData.value;
      existing.xbetOdds = xbetData.value;
      existing.polyAgeMs = polyAge;
      existing.xbetAgeMs = xbetAge;
      existing.quality = quality;
      existing.qualityNote = qualityNote;
      existing.lastUpdated = now;
      existing.belowThresholdSince = null;
      existing.suspectSince = quality === 'suspect' ? (existing.suspectSince ?? now) : null;
      if (absEdge > existing.peakEdge) existing.peakEdge = absEdge;
      existing.score = event.stats.score;
      existing.eventStatus = event.status;
      existing.edgeHistory.push(absEdge);
      if (existing.edgeHistory.length > MAX_EDGE_HISTORY) existing.edgeHistory.shift();
    } else {
      const opp: Opportunity = {
        id: `opp_${++idCounter}`,
        eventId: event.id,
        homeTeam: homeName,
        awayTeam: awayName,
        league: event.league,
        market: key,
        action,
        edge: absEdge,
        edgeDirection,
        polyProb,
        xbetProb,
        polyOdds: polyData.value,
        xbetOdds: xbetData.value,
        polyAgeMs: polyAge,
        xbetAgeMs: xbetAge,
        quality,
        qualityNote,
        firstSeen: now,
        lastUpdated: now,
        belowThresholdSince: null,
        suspectSince: quality === 'suspect' ? now : null,
        peakEdge: absEdge,
        score: event.stats.score,
        eventStatus: event.status,
        edgeHistory: [absEdge],
      };
      opportunities.set(oppKey, opp);

      if (quality !== 'suspect') {
        log.info(
          `📊 NEW ${action} | ${homeName} vs ${awayName} | ${key.replace(/_ft$/, '')} | ` +
          `PM:${polyProb.toFixed(1)}% vs 1xBet:${xbetProb.toFixed(1)}% | Edge:${absEdge.toFixed(1)}pp [${quality}]`
        );
      }
    }
  }
};

// Score-based trading: when a goal happens but Polymarket hasn't reacted
// Only for ML markets where we can infer direction from the score
const ML_KEYS = ['ml_home_ft', 'ml_away_ft', 'draw_ft'];

export const scoreTradeSignal: SignalFunction = (event, changedKeys, source) => {
  if (source === 'polymarket') return;
  if (!changedKeys.includes('__score')) return;
  if (!event.stats.score) return;

  const { score } = event.stats;
  const now = Date.now();

  for (const key of ML_KEYS) {
    const sources = event.markets[key];
    if (!sources?.polymarket) continue;

    const polyAge = now - sources.polymarket.timestamp;

    if (polyAge > 10000) {
      const polyProb = toProb(sources.polymarket.value);
      const homeName = event.home.name || Object.values(event.home.aliases)[0] || '?';
      const awayName = event.away.name || Object.values(event.away.aliases)[0] || '?';

      let action: TradeAction;
      if (key === 'ml_home_ft') {
        action = score.home > score.away ? 'BUY_YES' : 'BUY_NO';
      } else if (key === 'ml_away_ft') {
        action = score.away > score.home ? 'BUY_YES' : 'BUY_NO';
      } else {
        action = score.home === score.away ? 'BUY_YES' : 'BUY_NO';
      }

      const oppKey = `${event.id}:${key}`;
      if (!opportunities.has(oppKey)) {
        opportunities.set(oppKey, {
          id: `opp_${++idCounter}`,
          eventId: event.id,
          homeTeam: homeName,
          awayTeam: awayName,
          league: event.league,
          market: key,
          action,
          edge: 0,
          edgeDirection: 0,
          polyProb,
          xbetProb: 0,
          polyOdds: sources.polymarket.value,
          xbetOdds: 0,
          polyAgeMs: polyAge,
          xbetAgeMs: 0,
          quality: 'medium',
          qualityNote: `Goal ${score.home}-${score.away} but PM stale (${Math.round(polyAge / 1000)}s)`,
          firstSeen: now,
          lastUpdated: now,
          belowThresholdSince: now,
          suspectSince: null,
          peakEdge: 0,
          score,
          eventStatus: event.status,
          edgeHistory: [0],
        });

        log.info(
          `⚽ GOAL SIGNAL | ${homeName} vs ${awayName} | ${score.home}-${score.away} | ` +
          `${key.replace(/_ft$/, '')} | PM stale by ${Math.round(polyAge / 1000)}s`
        );
      }
    }
  }
};

// Periodic cleanup: remove stale opportunities
setInterval(() => {
  const now = Date.now();
  for (const [key, opp] of opportunities) {
    const age = now - opp.lastUpdated;

    // Remove opportunities that haven't been updated in 60s
    if (age > 60_000) {
      closeOpportunity(key, opp);
      continue;
    }

    // Remove opportunities where edge has been below threshold for 30s
    if (opp.belowThresholdSince !== null && (now - opp.belowThresholdSince) > EXPIRE_NO_EDGE_MS) {
      closeOpportunity(key, opp);
      continue;
    }

    // Remove suspect opportunities after 60s (data mismatches that won't resolve)
    if (opp.suspectSince !== null && (now - opp.suspectSince) > 60_000) {
      closeOpportunity(key, opp);
    }
  }
}, 10_000);
