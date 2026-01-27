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
export type TimePeriod = '7d' | '30d' | 'all'

export interface Wallet {
  address: string
  source: WalletSource
  balance: number
  balance_updated_at?: string
  username?: string
  account_created_at?: string
  // ===== PERIOD METRICS (independently calculated) =====
  // 7-day: based on trades EXECUTED and positions RESOLVED in last 7 days
  pnl_7d: number           // realized PnL from positions resolved in 7d
  roi_7d: number           // ROI for positions resolved in 7d
  win_rate_7d: number      // win rate for positions resolved in 7d
  volume_7d: number        // volume from trades executed in 7d
  trade_count_7d: number   // trades executed in 7d
  // 30-day: based on trades EXECUTED and positions RESOLVED in last 30 days
  pnl_30d: number          // realized PnL from positions resolved in 30d
  roi_30d: number          // ROI for positions resolved in 30d
  win_rate_30d: number     // win rate for positions resolved in 30d
  volume_30d: number       // volume from trades executed in 30d
  trade_count_30d: number  // trades executed in 30d
  // ===== DRAWDOWN METRICS =====
  drawdown_7d: number      // max drawdown in last 7 days (percentage)
  drawdown_30d: number     // max drawdown in last 30 days (percentage)
  // ===== ALL-TIME METRICS (consistent naming with 7d/30d) =====
  pnl_all: number          // realized PnL from all positions
  roi_all: number          // ROI for all positions
  win_rate_all: number     // win rate for all positions
  volume_all: number       // total volume all-time
  trade_count_all: number  // total trades all-time
  drawdown_all: number     // max drawdown all-time (percentage)
  // ===== OVERALL/LEGACY METRICS (matches Polymarket profile) =====
  total_positions: number   // closed positions (all-time)
  active_positions: number  // currently open positions
  total_wins: number        // positions with positive PnL
  total_losses: number      // positions with negative/zero PnL
  realized_pnl: number      // sum of all realized PnL
  unrealized_pnl: number    // sum of cashPnl from open positions
  overall_pnl: number       // realized + unrealized
  overall_roi: number       // overall ROI percentage
  overall_win_rate: number  // total_wins / total_positions * 100
  total_volume: number      // all-time volume
  total_trades: number      // all-time trade count
  top_category?: string     // most frequently traded market category
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
    case 'all': return 36500 // ~100 years
  }
}

// Helper to get start date from time period
export function getTimePeriodStartDate(period: TimePeriod): Date {
  const days = getTimePeriodDays(period)
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}
