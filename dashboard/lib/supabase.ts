import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
  drawdown_amount_all: number  // max drawdown all-time in dollar amount
  // ===== WIN/LOSS COUNTS (positions with positive vs negative PnL) =====
  wins_7d: number           // winning positions resolved in 7d
  losses_7d: number         // losing positions resolved in 7d
  wins_30d: number          // winning positions resolved in 30d
  losses_30d: number        // losing positions resolved in 30d
  wins_all: number          // winning positions all-time
  losses_all: number        // losing positions all-time
  // ===== SUM PROFIT PCT (sum of per-trade profit percentages) =====
  sum_profit_pct_7d: number | null
  sum_profit_pct_30d: number | null
  sum_profit_pct_all: number | null
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
  // ===== COPY-TRADE METRICS =====
  profit_factor_30d: number   // 30d gross wins / abs(gross losses)
  profit_factor_all: number   // all-time gross wins / abs(gross losses)
  diff_win_rate_30d: number   // 30d difficulty-weighted win rate
  diff_win_rate_all: number   // all-time difficulty-weighted win rate
  weekly_profit_rate: number  // % of active weeks profitable
  copy_score: number          // composite copy-trade score (0-100)
  avg_trades_per_day: number  // average trades per active day
  median_profit_pct: number | null  // median profit % per trade (IQR outlier removal)
  sell_ratio: number | null         // % of orders that are sells (high = active trader/scalper)
  trades_per_market: number | null  // avg orders per unique market (high = frequent re-entry)
  avg_hold_duration_hours: number | null  // average time holding positions (hours)
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

// Helper to get days from time period
export function getTimePeriodDays(period: TimePeriod): number {
  switch (period) {
    case '7d': return 7
    case '30d': return 30
    case 'all': return 36500 // ~100 years
  }
}

