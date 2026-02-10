import type { UnifiedEvent } from '../types/unified-event.js';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('trading');

export type TradeAction = 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO' | 'HOLD';

export interface TradeSignal {
  id: string;
  timestamp: number;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;           // e.g. "ml_home_ft"
  action: TradeAction;
  confidence: number;       // 0-100
  reason: string;
  polyPrice: number;        // Current Polymarket price (0-1)
  fairPrice: number;        // Estimated fair price from fast sources
  edge: number;             // % edge
  expectedProfit: number;   // Expected profit per $1
  urgency: 'low' | 'medium' | 'high' | 'critical';
  source: string;           // Which fast source triggered this
  score?: { home: number; away: number };
}

const MAX_SIGNALS = 500;
const signals: TradeSignal[] = [];
let signalCounter = 0;

export function getTradeSignals(): TradeSignal[] {
  return signals;
}

// Convert decimal odds to implied probability
function oddsToProb(decimal: number): number {
  if (decimal <= 0) return 0;
  return 1 / decimal;
}

// Convert Polymarket ask price to probability
function askToProb(ask: number): number {
  return ask; // Ask price IS the probability on Polymarket
}

function addSignal(signal: TradeSignal): void {
  signals.unshift(signal);
  if (signals.length > MAX_SIGNALS) signals.length = MAX_SIGNALS;
}

// Main trading signal: compare Polymarket implied prob vs 1xBet/FlashScore
export const tradingSignal: SignalFunction = (event, changedKeys, source) => {
  // Only trigger on market changes, not score-only updates
  const marketKeys = changedKeys.filter(k => !k.startsWith('__'));
  if (marketKeys.length === 0) return;

  // Check each market that has multi-source data
  for (const key of marketKeys) {
    const sources = event.markets[key];
    if (!sources) continue;

    const polyData = sources['polymarket'];
    const xbetData = sources['onexbet'];

    // Need at least Polymarket + one fast source
    if (!polyData) continue;
    if (!xbetData) continue;

    const polyDecimal = polyData.value;     // Decimal odds from Polymarket
    const polyProb = oddsToProb(polyDecimal); // Implied probability
    const xbetProb = oddsToProb(xbetData.value);

    // Calculate edge: how much Polymarket misprices vs 1xBet
    // Positive edge = Polymarket thinks outcome is LESS likely than 1xBet
    // → BUY YES on Polymarket (it's underpriced)
    // Negative edge = Polymarket thinks outcome is MORE likely
    // → BUY NO on Polymarket (YES is overpriced)

    const edge = (xbetProb - polyProb) * 100; // In percentage points
    const absEdge = Math.abs(edge);

    // Minimum 5% edge to signal
    if (absEdge < 5) continue;

    // Check for stale data (>60s old = ignore)
    const now = Date.now();
    const polyAge = now - polyData.timestamp;
    const xbetAge = now - xbetData.timestamp;
    if (polyAge > 60000 || xbetAge > 60000) continue;

    const polyPrice = polyProb; // Price to buy YES
    const fairPrice = xbetProb;

    let action: TradeAction;
    let reason: string;
    let expectedProfit: number;

    if (edge > 0) {
      // Polymarket underprices this outcome → BUY YES
      action = 'BUY_YES';
      reason = `1xBet implies ${(xbetProb * 100).toFixed(1)}% but Poly prices at ${(polyProb * 100).toFixed(1)}% — underpriced by ${absEdge.toFixed(1)}pp`;
      expectedProfit = (fairPrice - polyPrice) / polyPrice;
    } else {
      // Polymarket overprices this outcome → BUY NO (sell YES)
      action = 'BUY_NO';
      reason = `1xBet implies ${(xbetProb * 100).toFixed(1)}% but Poly prices at ${(polyProb * 100).toFixed(1)}% — overpriced by ${absEdge.toFixed(1)}pp`;
      expectedProfit = (polyPrice - fairPrice) / (1 - polyPrice);
    }

    const confidence = Math.min(95, Math.round(absEdge * 3));
    const urgency: TradeSignal['urgency'] =
      absEdge > 20 ? 'critical' :
      absEdge > 15 ? 'high' :
      absEdge > 10 ? 'medium' : 'low';

    const signal: TradeSignal = {
      id: `sig_${++signalCounter}`,
      timestamp: now,
      eventId: event.id,
      homeTeam: event.home.name || Object.values(event.home.aliases)[0] || '?',
      awayTeam: event.away.name || Object.values(event.away.aliases)[0] || '?',
      league: event.league,
      market: key,
      action,
      confidence,
      reason,
      polyPrice,
      fairPrice,
      edge: absEdge,
      expectedProfit: Math.round(expectedProfit * 10000) / 100, // as %
      urgency,
      source,
      score: event.stats.score,
    };

    addSignal(signal);

    if (urgency === 'critical' || urgency === 'high') {
      log.info(`🚨 ${action} | ${signal.homeTeam} vs ${signal.awayTeam} | ${formatMarketKey(key)} | Edge: ${absEdge.toFixed(1)}% | ${reason}`);
    }
  }
};

// Score-based trading: when a goal happens on 1xBet but Polymarket hasn't reacted
export const scoreTradeSignal: SignalFunction = (event, changedKeys, source) => {
  if (source === 'polymarket') return;
  if (!changedKeys.includes('__score')) return;
  if (!event.stats.score) return;

  const { score } = event.stats;
  const now = Date.now();

  // Check if Polymarket odds are stale (haven't updated recently)
  // Look at moneyline markets
  for (const key of ['ml_home_ft', 'ml_away_ft', 'draw_ft']) {
    const sources = event.markets[key];
    if (!sources?.polymarket) continue;

    const polyAge = now - sources.polymarket.timestamp;

    // If Polymarket hasn't updated in >5 seconds after a score change, signal
    if (polyAge > 5000) {
      const polyProb = oddsToProb(sources.polymarket.value);

      // Determine which side the goal favors
      let action: TradeAction;
      let reason: string;

      if (key === 'ml_home_ft') {
        // Home scored → home win more likely → BUY YES if Polymarket still low
        if (score.home > score.away) {
          action = 'BUY_YES';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Home leading but Poly hasn't updated (${(polyAge/1000).toFixed(0)}s stale)`;
        } else {
          action = 'BUY_NO';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Home trailing but Poly hasn't updated (${(polyAge/1000).toFixed(0)}s stale)`;
        }
      } else if (key === 'ml_away_ft') {
        if (score.away > score.home) {
          action = 'BUY_YES';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Away leading but Poly hasn't updated (${(polyAge/1000).toFixed(0)}s stale)`;
        } else {
          action = 'BUY_NO';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Away trailing but Poly hasn't updated (${(polyAge/1000).toFixed(0)}s stale)`;
        }
      } else {
        // Draw market — if scores are equal, draw more likely
        if (score.home === score.away) {
          action = 'BUY_YES';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Scores level, draw more likely, Poly stale (${(polyAge/1000).toFixed(0)}s)`;
        } else {
          action = 'BUY_NO';
          reason = `⚽ GOAL! ${score.home}-${score.away} — Not level, draw less likely, Poly stale (${(polyAge/1000).toFixed(0)}s)`;
        }
      }

      addSignal({
        id: `sig_${++signalCounter}`,
        timestamp: now,
        eventId: event.id,
        homeTeam: event.home.name || Object.values(event.home.aliases)[0] || '?',
        awayTeam: event.away.name || Object.values(event.away.aliases)[0] || '?',
        league: event.league,
        market: key,
        action,
        confidence: 80,
        reason,
        polyPrice: polyProb,
        fairPrice: 0, // Unknown — the speed advantage IS the edge
        edge: 0,
        expectedProfit: 0,
        urgency: 'critical',
        source,
        score,
      });
    }
  }
};

function formatMarketKey(key: string): string {
  return key.replace(/_ft$/, '').replace(/_/g, ' ').toUpperCase();
}
