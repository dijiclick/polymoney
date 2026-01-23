import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database tables
export interface PipelineRun {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  current_step: number
  current_step_name: string
  progress_percent: number
  started_at: string
  completed_at?: string
  total_addresses_found: number
  final_qualified: number
  copytrade_found: number
  bot_found: number
  api_calls_made: number
  errors_count: number
  last_error?: string
  days_to_scan: number
}

export interface StepProgress {
  id: number
  run_id: string
  step_number: number
  step_name: string
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed'
  total_items: number
  processed_items: number
  passed_items: number
  failed_items: number
  items_per_second: number
  estimated_remaining_seconds?: number
  started_at?: string
  completed_at?: string
}

export interface LogEntry {
  id: number
  run_id: string
  timestamp: string
  level: 'debug' | 'info' | 'success' | 'warning' | 'error'
  step_number?: number
  message: string
  address?: string
  details?: Record<string, unknown>
}

export interface Trader {
  address: string
  username?: string
  profile_image?: string
  portfolio_value: number
  win_rate_30d: number
  win_rate_alltime: number
  roi_percent: number
  max_drawdown: number
  trade_count_30d: number
  trade_count_alltime: number
  unique_markets_30d: number
  account_age_days: number
  copytrade_score: number
  bot_score: number
  primary_classification: 'copytrade' | 'bot' | 'none' | null
  total_pnl: number
  pipeline_step: number
  eliminated_at_step?: number
  elimination_reason?: string
  trade_frequency: number
  night_trade_ratio: number
}

export interface WatchlistEntry {
  id: number
  address: string
  list_type: 'copytrade' | 'bot' | 'custom'
  priority: number
  notes?: string
  alert_on_new_trade: boolean
  alert_threshold_usd: number
  added_at: string
  traders?: Trader
}

// Live Trade Monitoring Types
export interface LiveTrade {
  id: number
  trade_id: string
  tx_hash?: string
  trader_address: string
  trader_username?: string
  is_known_trader: boolean
  trader_classification?: 'copytrade' | 'bot' | 'none'
  trader_copytrade_score?: number
  trader_bot_score?: number
  trader_portfolio_value?: number
  condition_id: string
  asset_id?: string
  market_slug?: string
  market_title?: string
  event_slug?: string
  category?: string
  side: 'BUY' | 'SELL'
  outcome?: string
  outcome_index?: number
  size: number
  price: number
  usd_value: number
  executed_at: string
  received_at: string
  processing_latency_ms?: number
  is_whale: boolean
  is_watchlist: boolean
  alert_triggered: boolean
  created_at: string
}

export interface TradeAlert {
  id: number
  trade_id: string
  trader_address: string
  alert_type: 'whale_trade' | 'watchlist_activity' | 'unusual_time' | 'concentration' | 'new_market_entry' | 'pattern_detected'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description?: string
  metadata?: Record<string, unknown>
  acknowledged: boolean
  acknowledged_at?: string
  created_at: string
}

export interface TradeFilter {
  minUsdValue?: number
  maxUsdValue?: number
  categories?: string[]
  sides?: ('BUY' | 'SELL')[]
  whalesOnly?: boolean
  watchlistOnly?: boolean
  knownTradersOnly?: boolean
  marketSlug?: string
  traderAddress?: string
}

export interface TradeStats {
  total_trades: number
  total_volume: number
  unique_traders: number
  unique_markets: number
  avg_trade_size: number
  largest_trade: number
  whale_trades: number
  whale_volume: number
  avg_latency_ms: number
}
