import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../util/config.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('db');

let client: SupabaseClient;

export function getDb(): SupabaseClient {
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    log.info('Supabase client initialized');
  }
  return client;
}

// ─── Event upserts ───

export interface UmaEventRow {
  polymarket_event_id: string;
  title: string;
  description?: string;
  slug?: string;
  category?: string;
  subcategory?: string;
  tags?: any;
  image?: string;
  start_date?: string;
  end_date?: string;
  neg_risk?: boolean;
  neg_risk_market_id?: string;
  active?: boolean;
  closed?: boolean;
  markets_count?: number;
  total_volume?: number;
  raw_data?: any;
}

export async function upsertEvent(row: UmaEventRow): Promise<number | null> {
  const db = getDb();
  const { data, error } = await db
    .from('uma_events')
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'polymarket_event_id' }
    )
    .select('id')
    .single();

  if (error) {
    log.error(`upsert event ${row.polymarket_event_id} failed`, error.message);
    return null;
  }
  return data?.id ?? null;
}

// ─── Market upserts ───

export interface UmaMarketRow {
  event_id: number;
  polymarket_market_id: string;
  condition_id?: string;
  question_id?: string;
  question: string;
  question_normalized: string;
  description?: string;
  slug?: string;
  outcomes?: any;
  outcome_prices?: any;
  clob_token_ids?: any;
  best_ask?: number;
  last_trade_price?: number;
  spread?: number;
  volume?: number;
  volume_clob?: number;
  volume_1d?: number;
  volume_1wk?: number;
  volume_1mo?: number;
  one_day_price_change?: number;
  end_date?: string;
  resolution_source?: string;
  uma_bond?: number;
  uma_reward?: number;
  custom_liveness?: number;
  uma_resolution_statuses?: any;
  resolved_by?: string;
  active?: boolean;
  closed?: boolean;
  accepting_orders?: boolean;
  neg_risk?: boolean;
  automatically_resolved?: boolean;
  raw_data?: any;
}

export async function upsertMarket(row: UmaMarketRow): Promise<number | null> {
  const db = getDb();
  const { data, error } = await db
    .from('uma_markets')
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'polymarket_market_id' }
    )
    .select('id')
    .single();

  if (error) {
    log.error(`upsert market ${row.polymarket_market_id} failed`, error.message);
    return null;
  }
  return data?.id ?? null;
}

// ─── Outcome upserts ───

export interface UmaOutcomeRow {
  market_id: number;
  detected_outcome: string;
  confidence: number;
  detection_tier: string;
  detection_source: string;
  detection_data?: any;
  detected_at: string;
  uma_status?: string;
  uma_proposed_at?: string;
  uma_proposed_outcome?: string;
  uma_proposer?: string;
  uma_expiration?: string;
  window_duration_sec?: number;
  winning_price_at_detection?: number;
  potential_profit_pct?: number;
  is_opportunity?: boolean;
  is_actionable?: boolean;
}

export async function upsertOutcome(row: UmaOutcomeRow): Promise<number | null> {
  const db = getDb();
  const { data, error } = await db
    .from('uma_outcomes')
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: 'market_id' }
    )
    .select('id')
    .single();

  if (error) {
    log.error(`upsert outcome for market ${row.market_id} failed`, error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function updateOutcomeUmaStatus(
  marketId: string,
  update: {
    uma_status: string;
    uma_proposed_at?: string;
    uma_proposed_outcome?: string;
    uma_proposer?: string;
    uma_expiration?: string;
    is_opportunity?: boolean;
    window_duration_sec?: number;
  }
): Promise<void> {
  const db = getDb();
  // First find the outcome by market's polymarket_market_id
  const { data: market } = await db
    .from('uma_markets')
    .select('id')
    .eq('polymarket_market_id', marketId)
    .single();

  if (!market) return;

  const { error } = await db
    .from('uma_outcomes')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('market_id', market.id);

  if (error) {
    log.error(`update outcome UMA status for ${marketId} failed`, error.message);
  }
}

// ─── Query helpers ───

export async function getMarketDbId(polymarketMarketId: string): Promise<number | null> {
  const db = getDb();
  const { data } = await db
    .from('uma_markets')
    .select('id')
    .eq('polymarket_market_id', polymarketMarketId)
    .single();
  return data?.id ?? null;
}

export async function getActiveMarkets(): Promise<any[]> {
  const db = getDb();
  const results: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db
      .from('uma_markets')
      .select('*')
      .eq('active', true)
      .eq('closed', false)
      .range(from, from + pageSize - 1);
    if (error) { log.error('getActiveMarkets failed', error.message); break; }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}
