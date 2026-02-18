import { config } from '../util/config.js';
import { createLogger } from '../util/logger.js';
import { normalize } from '../util/normalize.js';
import { upsertOutcome, updateOutcomeUmaStatus, getMarketDbId } from '../db/supabase.js';
import type { State, HotMarket } from '../state.js';
import type { UmaEvent } from './uma-websocket.js';

const log = createLogger('opportunity');

export interface DetectionResult {
  outcome: string;
  confidence: number;
  tier: string;
  source: string;
  rawData: any;
}

export async function processDetectedOutcome(
  state: State,
  market: any,
  result: DetectionResult
): Promise<void> {
  const marketId = market.polymarket_market_id;
  const dbId = market.id || await getMarketDbId(marketId);
  if (!dbId) {
    log.error(`Cannot find DB id for market ${marketId}`);
    return;
  }

  const winningPrice = getWinningPrice(market, result.outcome);
  const profitPct = winningPrice < 1 ? ((1 - winningPrice) / winningPrice) * 100 : 0;
  const isActionable = checkActionability(market);

  // Write to uma_outcomes
  await upsertOutcome({
    market_id: dbId,
    detected_outcome: result.outcome,
    confidence: result.confidence,
    detection_tier: result.tier,
    detection_source: result.source,
    detection_data: result.rawData,
    detected_at: new Date().toISOString(),
    uma_status: 'none',
    winning_price_at_detection: winningPrice,
    potential_profit_pct: profitPct,
    is_opportunity: true,
    is_actionable: isActionable,
  });

  // Get winning token ID for CLOB price tracking
  const clobTokenId = getWinningTokenId(market, result.outcome);

  // Add to hot markets
  state.hotMarkets.set(marketId, {
    marketId,
    question: market.question,
    questionNorm: normalize(market.question),
    detectedOutcome: result.outcome,
    confidence: result.confidence,
    detectedAt: Date.now(),
    winningPrice,
    currentPrice: winningPrice,
    profitPct,
    isActionable,
    eventId: market.event_id?.toString() || '',
    clobTokenId: clobTokenId || '',
    customLiveness: market.custom_liveness || 7200,
  });

  log.info(`OPPORTUNITY: "${market.question.slice(0, 80)}" → ${result.outcome} (${result.confidence}%) price=$${winningPrice.toFixed(3)} profit=${profitPct.toFixed(1)}% actionable=${isActionable}`);
}

export async function processUmaProposal(
  state: State,
  marketId: string,
  event: UmaEvent
): Promise<void> {
  const hot = state.hotMarkets.get(marketId);
  const proposedOutcome = event.proposedPrice > 0n ? 'Yes' : 'No';
  const windowDuration = hot ? Math.floor((Date.now() - hot.detectedAt) / 1000) : null;

  await updateOutcomeUmaStatus(marketId, {
    uma_status: 'proposed',
    uma_proposed_at: new Date().toISOString(),
    uma_proposed_outcome: proposedOutcome,
    uma_expiration: new Date(event.expirationTimestamp * 1000).toISOString(),
    is_opportunity: false,
    window_duration_sec: windowDuration ?? undefined,
  });

  // Remove from hot markets
  state.hotMarkets.delete(marketId);

  if (hot) {
    log.info(`WINDOW CLOSED: "${hot.question.slice(0, 80)}" — window was ${formatDuration(Date.now() - hot.detectedAt)}`);
  } else {
    log.info(`UMA proposal for market ${marketId} (was not in hot markets)`);
  }
}

function checkActionability(market: any): boolean {
  return (
    (market.volume_1d || 0) > config.MIN_DAILY_VOLUME &&
    (market.best_ask || 1) < config.MAX_BEST_ASK &&
    (market.spread || 1) < config.MAX_SPREAD &&
    market.accepting_orders !== false
  );
}

function getWinningPrice(market: any, outcome: string): number {
  const prices: number[] = (market.outcome_prices || []).map(Number);
  const outcomes: string[] = market.outcomes || ['Yes', 'No'];

  // Find index of winning outcome
  const idx = outcomes.findIndex(
    (o: string) => o.toLowerCase() === outcome.toLowerCase()
  );
  if (idx >= 0 && idx < prices.length) return prices[idx];

  // Fallback: return the highest price
  return Math.max(...prices.filter((n: number) => !isNaN(n)), 0);
}

function getWinningTokenId(market: any, outcome: string): string | null {
  const tokenIds: string[] = market.clob_token_ids || [];
  const outcomes: string[] = market.outcomes || ['Yes', 'No'];

  const idx = outcomes.findIndex(
    (o: string) => o.toLowerCase() === outcome.toLowerCase()
  );
  if (idx >= 0 && idx < tokenIds.length) return tokenIds[idx];
  return tokenIds[0] || null;
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
