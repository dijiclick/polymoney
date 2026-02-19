import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from './config.js';
import { createLogger, setLogLevel } from './logger.js';
import { computeEventStatus, computeMarketStatus, isSettled } from './status.js';
import { upsertEvent, upsertMarket, verifyConnection, getCounts, type EventRow, type MarketRow } from './db.js';

const log = createLogger('main');

// ─── Types ───

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
  volume24hr?: number;
  oneDayPriceChange?: number;
  endDate?: string;
  resolutionSource?: string;
  customLiveness?: number;
  umaResolutionStatuses?: any[];
  resolvedBy?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  negRisk?: boolean;
  automaticallyResolved?: boolean;
}

// ─── State ───

interface SyncState {
  backfillComplete: boolean;
  backfillOffset: number;
}

const STATE_FILE = 'sync-state.json';

function loadState(): SyncState {
  if (!existsSync(STATE_FILE)) return { backfillComplete: false, backfillOffset: 0 };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { backfillComplete: false, backfillOffset: 0 };
  }
}

function saveState(state: SyncState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

// ─── Helpers ───

function parseJson(str: string | undefined, fallback: any): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019\u201C\u201D]/g, "'").replace(/\s+/g, ' ').replace(/[^\w\s'.\-]/g, '').trim();
}

function categoryFromTags(tags?: { slug?: string; label?: string }[]): string {
  if (!tags || tags.length === 0) return 'other';
  const slugs = tags.map(t => t.slug || '');
  if (slugs.some(s => ['nba', 'nfl', 'mlb', 'nhl', 'soccer', 'mma', 'tennis', 'sports'].includes(s!))) return 'sports';
  if (slugs.some(s => ['politics', 'elections'].includes(s!))) return 'politics';
  return tags[0]?.label?.toLowerCase() || 'other';
}

// ─── Process Events ───

async function processEvents(events: GammaEvent[]): Promise<{ newEvents: number; newMarkets: number; skippedSettled: number }> {
  let newEvents = 0, newMarkets = 0, skippedSettled = 0;

  for (const event of events) {
    const eventRow: EventRow = {
      polymarket_event_id: event.id,
      title: event.title,
      description: event.description,
      slug: event.slug,
      category: categoryFromTags(event.tags),
      tags: event.tags || [],
      image: event.image,
      start_date: event.startDate || null,
      end_date: event.endDate || null,
      status: computeEventStatus(event),
      active: event.active ?? true,
      closed: event.closed ?? false,
      neg_risk: event.negRisk || false,
      neg_risk_market_id: event.negRiskMarketID || null,
      markets_count: event.markets?.length || 0,
      total_volume: event.volume || 0,
    };

    const eventDbId = await upsertEvent(eventRow);
    if (!eventDbId) continue;
    newEvents++;

    for (const mkt of event.markets || []) {
      // Skip settled markets
      if (isSettled(mkt)) {
        skippedSettled++;
        continue;
      }

      const marketRow: MarketRow = {
        event_id: eventDbId,
        polymarket_market_id: mkt.id,
        condition_id: mkt.conditionId,
        question_id: mkt.questionID,
        question: mkt.question,
        question_normalized: normalize(mkt.question),
        description: mkt.description,
        slug: mkt.slug,
        outcomes: parseJson(mkt.outcomes, ['Yes', 'No']),
        outcome_prices: parseJson(mkt.outcomePrices, null),
        clob_token_ids: parseJson(mkt.clobTokenIds, null),
        best_ask: mkt.bestAsk,
        last_trade_price: mkt.lastTradePrice,
        spread: mkt.spread,
        volume: mkt.volume || 0,
        volume_1d: mkt.volume24hr || 0,
        one_day_price_change: mkt.oneDayPriceChange,
        end_date: mkt.endDate || null,
        resolution_source: mkt.resolutionSource,
        custom_liveness: mkt.customLiveness || 7200,
        uma_resolution_statuses: mkt.umaResolutionStatuses || [],
        resolved_by: mkt.resolvedBy,
        status: computeMarketStatus(mkt),
        active: mkt.active ?? true,
        closed: mkt.closed ?? false,
        accepting_orders: mkt.acceptingOrders ?? true,
        neg_risk: mkt.negRisk ?? false,
        automatically_resolved: mkt.automaticallyResolved ?? false,
      };

      const marketDbId = await upsertMarket(marketRow);
      if (marketDbId) newMarkets++;
    }
  }

  return { newEvents, newMarkets, skippedSettled };
}

// ─── Backfill ───

async function backfill(state: SyncState): Promise<void> {
  log.info(`Starting backfill from offset ${state.backfillOffset}...`);
  let offset = state.backfillOffset;
  let page = 0;
  let totalEvents = 0, totalMarkets = 0;

  while (true) {
    page++;
    const url = `${config.GAMMA_BASE}/events?exclude_tag_id=${config.CRYPTO_TAG_ID}&active=true&limit=${config.PAGE_SIZE}&offset=${offset}`;

    let events: GammaEvent[];
    try {
      const res = await fetch(url);
      if (!res.ok) { log.error(`Gamma ${res.status} at offset ${offset}`); break; }
      events = await res.json() as GammaEvent[];
    } catch (e: any) {
      log.error(`Gamma fetch failed at offset ${offset}`, e.message);
      break;
    }

    if (!events || events.length === 0) {
      log.info(`Backfill done at page ${page} (empty response)`);
      break;
    }

    const result = await processEvents(events);
    totalEvents += result.newEvents;
    totalMarkets += result.newMarkets;
    log.info(`Backfill page ${page}: ${events.length} events → ${result.newEvents} upserted, ${result.newMarkets} markets, ${result.skippedSettled} settled skipped (offset ${offset})`);

    offset += events.length;
    state.backfillOffset = offset;
    saveState(state);

    await new Promise(r => setTimeout(r, config.BACKFILL_DELAY));
  }

  state.backfillComplete = true;
  saveState(state);
  log.info(`Backfill complete: ${totalEvents} events, ${totalMarkets} markets`);
}

// ─── Incremental Sync ───

async function syncRecent(): Promise<void> {
  const url = `${config.GAMMA_BASE}/events?exclude_tag_id=${config.CRYPTO_TAG_ID}&active=true&order=id&ascending=false&limit=100`;
  try {
    const res = await fetch(url);
    if (!res.ok) { log.warn(`Gamma ${res.status} during sync`); return; }
    const events: GammaEvent[] = await res.json();
    if (!events || events.length === 0) return;

    const result = await processEvents(events);
    if (result.newEvents > 0 || result.newMarkets > 0) {
      log.info(`Sync: ${result.newEvents} events, ${result.newMarkets} markets updated`);
    }
  } catch (e: any) {
    log.error('Sync failed', e.message);
  }
}

// ─── Main ───

async function main() {
  log.info('Metadata Syncer starting...');
  if (process.env.LOG_LEVEL) setLogLevel(process.env.LOG_LEVEL as any);

  const existingCount = await verifyConnection();
  log.info(`Supabase connected. Existing events: ${existingCount}`);

  const state = loadState();

  // Backfill if needed
  if (!state.backfillComplete) {
    await backfill(state);
  } else {
    log.info('Backfill already complete, starting incremental sync');
  }

  // Start sync loop
  log.info(`Incremental sync every ${config.SYNC_INTERVAL / 1000}s`);
  setInterval(syncRecent, config.SYNC_INTERVAL);

  // Status report
  setInterval(async () => {
    const counts = await getCounts();
    log.info(`STATUS: events=${counts.events} markets=${counts.markets}`);
  }, config.REPORT_INTERVAL);

  // State persistence
  setInterval(() => saveState(state), config.PERSIST_INTERVAL);

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down...');
    saveState(state);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Run first sync immediately after backfill
  syncRecent();

  log.info('Metadata Syncer running.');
}

main().catch(err => {
  log.error('Fatal error', err);
  process.exit(1);
});
