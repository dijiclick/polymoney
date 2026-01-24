import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database tables

export interface WatchlistEntry {
  id: number
  address: string
  list_type: 'copytrade' | 'bot' | 'custom'
  priority: number
  notes?: string
  alert_on_new_trade: boolean
  alert_threshold_usd: number
  added_at: string
}

// Live Trade Monitoring Types
export interface LiveTrade {
  id: number
  trade_id: string
  tx_hash?: string
  trader_address: string
  trader_username?: string
  is_known_trader: boolean
  trader_classification?: 'copytrade' | 'bot' | 'insider' | 'none'
  trader_copytrade_score?: number
  trader_bot_score?: number
  trader_insider_score?: number
  trader_insider_level?: 'very_high' | 'high' | 'moderate' | 'low' | 'minimal'
  trader_red_flags?: string[]
  is_insider_suspect: boolean
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
  alert_type: 'whale_trade' | 'watchlist_activity' | 'insider_activity' | 'unusual_time' | 'concentration' | 'new_market_entry' | 'pattern_detected'
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
  insidersOnly?: boolean
  minInsiderScore?: number
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

// ============================================
// Wallet Analytics Types
// ============================================

export type WalletSource = 'goldsky' | 'live'
export type TimePeriod = '7d' | '30d'

export interface Wallet {
  address: string
  source: WalletSource
  balance: number
  balance_updated_at?: string
  // Pre-calculated metrics stored in DB
  pnl_7d: number
  pnl_30d: number
  roi_7d: number
  roi_30d: number
  win_rate_7d: number
  win_rate_30d: number
  volume_7d: number
  volume_30d: number
  trade_count_7d: number
  trade_count_30d: number
  metrics_updated_at?: string
  created_at: string
  updated_at: string
}

export interface WalletTrade {
  id: number
  address: string
  trade_id?: string
  condition_id?: string
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
  tx_hash?: string
  created_at: string
}

export interface WalletMetrics {
  pnl: number
  roi: number
  volume: number
  tradeCount: number
  winRate: number
  maxDrawdown: number
  buyCount: number
  sellCount: number
  avgTradeSize: number
  uniqueMarkets: number
}

export interface WalletFilter {
  source?: WalletSource | 'all'
  minBalance?: number
  minWinRate?: number
  timePeriod: TimePeriod
}

export interface WalletWithMetrics extends Wallet {
  metrics?: WalletMetrics
}

// Helper to get days from time period
export function getTimePeriodDays(period: TimePeriod): number {
  switch (period) {
    case '7d': return 7
    case '30d': return 30
  }
}

// Helper to get start date from time period
export function getTimePeriodStartDate(period: TimePeriod): Date {
  const days = getTimePeriodDays(period)
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}
