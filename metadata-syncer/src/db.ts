import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('db');

let client: SupabaseClient;

function getDb(): SupabaseClient {
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    log.info('Supabase client initialized');
  }
  return client;
}

export interface EventRow {
  polymarket_event_id: string;
  title: string;
  description?: string;
  slug?: string;
  category?: string;
  tags?: any;
  image?: string;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  active?: boolean;
  closed?: boolean;
  neg_risk?: boolean;
  neg_risk_market_id?: string | null;
  markets_count?: number;
  total_volume?: number;
}

export interface MarketRow {
  event_id: number;
  polymarket_market_id: string;
  condition_id?: string;
  question_id?: string;
  question: string;
  description?: string;
  slug?: string;
  outcomes?: any;
  outcome_prices?: any;
  clob_token_ids?: any;
  best_ask?: number;
  last_trade_price?: number;
  spread?: number;
  volume?: number;
  volume_1d?: number;
  one_day_price_change?: number;
  end_date?: string | null;
  resolution_source?: string;
  custom_liveness?: number;
  uma_resolution_statuses?: any;
  resolved_by?: string;
  status: string;
  active?: boolean;
  closed?: boolean;
  accepting_orders?: boolean;
  neg_risk?: boolean;
  automatically_resolved?: boolean;
  question_normalized: string;
}

export async function upsertEvent(row: EventRow): Promise<number | null> {
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

export async function upsertMarket(row: MarketRow): Promise<number | null> {
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

export async function verifyConnection(): Promise<number> {
  const db = getDb();
  const { count, error } = await db.from('uma_events').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Supabase connection failed: ${error.message}`);
  return count ?? 0;
}

export async function getCounts(): Promise<{ events: number; markets: number }> {
  const db = getDb();
  const [e, m] = await Promise.all([
    db.from('uma_events').select('*', { count: 'exact', head: true }),
    db.from('uma_markets').select('*', { count: 'exact', head: true }),
  ]);
  return { events: e.count ?? 0, markets: m.count ?? 0 };
}
