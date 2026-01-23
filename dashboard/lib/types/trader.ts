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
}

export interface PolymarketClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  size: number
  avgPrice: number
  finalPrice: number
  realizedPnl: number
  resolvedAt?: string
  isWin: boolean
}

export interface TraderMetrics {
  portfolioValue: number
  totalPnl: number
  unrealizedPnl: number
  realizedPnl: number
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
  activePositions: number
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

  // Positions
  positions: PolymarketPosition[]
  closedPositionsCount: number

  // Calculated metrics
  metrics: TraderMetrics

  // Classification scores (only if from DB pipeline)
  scores?: TraderScores

  // Metadata
  isNewlyFetched: boolean
  lastUpdatedAt?: string
  warning?: string
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
}

export interface RawPolymarketClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  size: string
  avgPrice: string
  cashPnl: string
  percentPnl: string
  resolvedAt?: string
  resolvedOutcome?: string
}

export interface RawPolymarketActivity {
  timestamp: number
  type: string
  conditionId: string
  size: string
  price: string
  side: 'BUY' | 'SELL'
}
