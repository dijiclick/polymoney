import { config } from '../util/config.js';
import { createLogger } from '../util/logger.js';
import { normalize } from '../util/normalize.js';
import { upsertEvent, upsertMarket, type UmaEventRow, type UmaMarketRow } from '../db/supabase.js';
import type { State } from '../state.js';

const log = createLogger('backfill');

interface GammaEvent {
  id: string;
  title: string;
  description?: string;
  slug?: string;
  tags?: { id: number; slug: string; label: string }[];
  image?: string;
  startDate?: string;
  endDate?: string;
  negRisk?: boolean;
  negRiskMarketID?: string;
  active?: boolean;
  closed?: boolean;
  markets?: GammaMarket[];
  volume?: number;
}

interface GammaMarket {
  id: string;
  conditionId?: string;
  questionID?: string;
  question: string;
  description?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  volume?: number;
  volumeClob?: number;
  volume24hr?: number;
  volume1wk?: number;
  volume1mo?: number;
  oneDayPriceChange?: number;
  endDate?: string;
  resolutionSource?: string;
  umaBond?: string;
  umaReward?: string;
  customLiveness?: number;
  umaResolutionStatuses?: any[];
  resolvedBy?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  negRisk?: boolean;
  automaticallyResolved?: boolean;
}

export async function backfill(state: State): Promise<void> {
  log.info('Starting backfill of all non-crypto events...');
  let offset = 0;
  let totalEvents = 0;
  let totalMarkets = 0;
  let page = 0;

  while (true) {
    page++;
    const url = `${config.GAMMA_BASE}/events?exclude_tag_id=${config.CRYPTO_TAG_ID}&limit=${config.GAMMA_PAGE_SIZE}&offset=${offset}&active=true&closed=false`;

    let events: GammaEvent[];
    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.error(`Gamma API ${res.status} at offset ${offset}`);
        break;
      }
      events = await res.json() as GammaEvent[];
    } catch (e: any) {
      log.error(`Gamma fetch failed at offset ${offset}`, e.message);
      break;
    }

    if (!events || events.length === 0) {
      log.info(`Backfill page ${page}: empty response, done.`);
      break;
    }

    log.info(`Backfill page ${page}: ${events.length} events (offset ${offset})`);

    for (const event of events) {
      const eventRow: UmaEventRow = {
        polymarket_event_id: event.id,
        title: event.title,
        description: event.description,
        slug: event.slug,
        tags: event.tags || [],
        image: event.image,
        start_date: event.startDate || null as any,
        end_date: event.endDate || null as any,
        neg_risk: event.negRisk || false,
        neg_risk_market_id: event.negRiskMarketID || null as any,
        active: event.active ?? true,
        closed: event.closed ?? false,
        markets_count: event.markets?.length || 0,
        total_volume: event.volume || 0,
      };

      const eventDbId = await upsertEvent(eventRow);
      if (!eventDbId) continue;

      state.knownEventIds.add(event.id);
      totalEvents++;

      for (const mkt of event.markets || []) {
        // Skip fully resolved markets (UMA-settled, payout done)
        let statuses = mkt.umaResolutionStatuses || [];
        if (typeof statuses === 'string') {
          try { statuses = JSON.parse(statuses); } catch { statuses = []; }
        }
        if (Array.isArray(statuses) && statuses.some((s: any) => s === 'settled' || s?.status === 'settled')) continue;

        const qNorm = normalize(mkt.question);
        const marketRow: UmaMarketRow = {
          event_id: eventDbId,
          polymarket_market_id: mkt.id,
          condition_id: mkt.conditionId,
          question_id: mkt.questionID,
          question: mkt.question,
          question_normalized: qNorm,
          description: mkt.description,
          slug: mkt.slug,
          outcomes: parseJsonSafe(mkt.outcomes, ['Yes', 'No']),
          outcome_prices: parseJsonSafe(mkt.outcomePrices, null),
          clob_token_ids: parseJsonSafe(mkt.clobTokenIds, null),
          best_ask: mkt.bestAsk,
          last_trade_price: mkt.lastTradePrice,
          spread: mkt.spread,
          volume: mkt.volume || 0,
          volume_clob: mkt.volumeClob || 0,
          volume_1d: mkt.volume24hr || 0,
          volume_1wk: mkt.volume1wk || 0,
          volume_1mo: mkt.volume1mo || 0,
          one_day_price_change: mkt.oneDayPriceChange,
          end_date: mkt.endDate || null as any,
          resolution_source: mkt.resolutionSource,
          uma_bond: mkt.umaBond ? Number(mkt.umaBond) : undefined,
          uma_reward: mkt.umaReward ? Number(mkt.umaReward) : undefined,
          custom_liveness: mkt.customLiveness || 7200,
          uma_resolution_statuses: mkt.umaResolutionStatuses || [],
          resolved_by: mkt.resolvedBy,
          active: mkt.active ?? true,
          closed: mkt.closed ?? false,
          accepting_orders: mkt.acceptingOrders ?? true,
          neg_risk: mkt.negRisk ?? false,
          automatically_resolved: mkt.automaticallyResolved ?? false,
        };

        await upsertMarket(marketRow);
        state.knownMarketIds.add(mkt.id);
        state.marketsByQuestion.set(qNorm, mkt.id);
        totalMarkets++;
      }
    }

    offset += events.length;

    // Rate limit: ~2 req/s to be safe
    await sleep(500);
  }

  state.backfillComplete = true;
  state.persist();
  log.info(`Backfill complete: ${totalEvents} events, ${totalMarkets} markets`);
}

function parseJsonSafe(str: string | undefined, fallback: any): any {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Re-export types for syncer
export type { GammaEvent, GammaMarket };
