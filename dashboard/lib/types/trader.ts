// Types for on-demand trader profile data fetching

export interface PolymarketPosition {
  conditionId: string
  asset: string
  marketSlug?: string
  title?: string
  outcome?: string
  outcomeIndex: number
  size: number
  avgPrice: number
  currentPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  endDate?: string
  redeemable?: boolean  // True if position is resolved and can be redeemed
}

export interface PolymarketClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  size: number
  avgPrice: number
  initialValue: number
  finalPrice: number
  realizedPnl: number
  resolvedAt?: string
  isWin: boolean
}

// Time-period specific metrics (7d, 30d)
export interface TimePeriodMetrics {
  pnl: number
  roi: number
  volume: number  // total trade volume
  tradeCount: number
  winRate: number
  drawdown?: number  // maximum peak-to-trough decline (%)
  drawdownAmount?: number  // maximum peak-to-trough decline in dollars
  growthQuality?: number  // 1-10 score: steadiness (R²) + return magnitude
  sumProfitPct?: number   // sum of (realizedPnl / initialValue * 100) for each position
  // Optional fields
  positionsResolved?: number  // positions resolved in this period
  winningPositions?: number
  losingPositions?: number
}

export interface TraderMetrics {
  portfolioValue: number
  totalPnl: number
  unrealizedPnl: number
  realizedPnl: number

  // Time-period metrics
  metrics7d: TimePeriodMetrics
  metrics30d: TimePeriodMetrics

  // Activity metrics
  avgTradeIntervalHours: number  // average time between trades
  activePositions: number

  // Legacy fields (kept for compatibility)
  winRate30d: number
  winRateAllTime: number
  roiPercent: number
  tradeCount30d: number
  tradeCountAllTime: number
  uniqueMarkets30d: number
  accountAgeDays?: number
  positionConcentration: number
  maxPositionSize: number
  avgPositionSize: number
  totalPositions: number
  maxDrawdown: number
  tradeFrequency: number
  nightTradeRatio: number
  avgHoldDurationHours?: number
}

export interface TraderScores {
  copytradeScore: number
  botScore: number
  insiderScore: number
  insiderLevel?: 'very_high' | 'high' | 'moderate' | 'low' | 'minimal'
  insiderRedFlags?: string[]
  primaryClassification?: 'copytrade' | 'bot' | 'insider' | 'none' | null
}

export interface TraderProfileResponse {
  // Source indicator
  source: 'database' | 'live' | 'mixed'
  dataFreshness: 'fresh' | 'cached' | 'stale'
  cachedAt?: string

  // Basic info
  address: string
  username?: string
  profileImage?: string
  accountCreatedAt?: string  // ISO timestamp of account creation

  // Positions
  positions: PolymarketPosition[]
  closedPositions?: PolymarketClosedPosition[]
  closedPositionsCount: number

  // Recent trades
  trades: ParsedTrade[]

  // Calculated metrics
  metrics: TraderMetrics

  // Classification scores (only if from DB pipeline)
  scores?: TraderScores

  // Copy-trade scoring
  copyScore?: number
  copyMetrics?: {
    profitFactor30d: number
    profitFactorAll: number
    diffWinRate30d: number
    diffWinRateAll: number
    weeklyProfitRate: number
    avgTradesPerDay: number
    medianProfitPct: number | null
    edgeTrend: number
    calmarRatio: number
  }

  // Metadata
  isNewlyFetched: boolean
  lastUpdatedAt?: string
  warning?: string
  goldskyEnhanced?: boolean  // True if metrics were enhanced with Goldsky on-chain data
}

export interface TraderFetchError {
  error: string
  code: 'NOT_FOUND' | 'API_ERROR' | 'INVALID_ADDRESS' | 'RATE_LIMITED'
  details?: string
}

// Raw API response types from Polymarket Data API
export interface RawPolymarketPosition {
  proxyWallet: string
  asset: string
  conditionId: string
  size: string
  avgPrice: string
  initialValue: string
  currentValue: string
  cashPnl: string
  percentPnl: string
  curPrice: string
  endDate?: string
  outcome?: string
  outcomeIndex?: number
  title?: string
  slug?: string
  redeemable?: boolean  // True if market resolved and position can be redeemed
}

export interface RawPolymarketClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  // API can return either size OR totalBought
  size?: string
  totalBought?: number | string
  avgPrice?: number | string
  // API can return either cashPnl OR realizedPnl
  cashPnl?: string
  realizedPnl?: number | string
  percentPnl?: string
  resolvedAt?: string
  resolvedOutcome?: string
  timestamp?: number  // Unix timestamp of resolution
  endDate?: string
}

export interface RawPolymarketActivity {
  timestamp: number
  type: string
  conditionId: string
  size: string
  price: string
  side: 'BUY' | 'SELL'
  usdcSize?: string
  title?: string
  slug?: string
  outcome?: string
  transactionHash?: string
}

// Parsed trade for display
export interface ParsedTrade {
  timestamp: number
  side: 'BUY' | 'SELL'
  market: string
  outcome?: string
  size: number
  price: number
  usdValue: number
  txHash?: string
}
