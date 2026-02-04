import { ParsedTrade, PolymarketClosedPosition } from '@/lib/types/trader'

// ============================================
// Slippage Model
// ============================================

export interface SlippageParams {
  delaySeconds: number        // execution delay (default 2)
  baseSpreadPct: number       // typical bid-ask spread (default 0.5%)
  driftPerSecondPct: number   // average price drift per second (default 0.15%)
  sizeImpactFactor: number    // additional slippage per $100 traded (default 0.02%)
  maxSlippagePct: number      // skip trade if slippage exceeds this (default 5%)
}

export const DEFAULT_SLIPPAGE_PARAMS: SlippageParams = {
  delaySeconds: 2,
  baseSpreadPct: 0.5,
  driftPerSecondPct: 0.15,
  sizeImpactFactor: 0.02,
  maxSlippagePct: 5,
}

// ============================================
// Simulation Config
// ============================================

export interface SimulationConfig {
  address: string
  startingCapital: number       // e.g., $1000
  delaySeconds: number          // e.g., 2
  timePeriodDays: number        // e.g., 30
  slippageParams: SlippageParams
  maxPositionPct: number        // max % of capital per single position (default 20%)
}

export const DEFAULT_SIMULATION_CONFIG: Omit<SimulationConfig, 'address'> = {
  startingCapital: 1000,
  delaySeconds: 2,
  timePeriodDays: 30,
  slippageParams: DEFAULT_SLIPPAGE_PARAMS,
  maxPositionPct: 20,
}

// ============================================
// Simulation Results
// ============================================

export interface SlippageResult {
  adjustedPrice: number
  slippagePct: number
  skipped: boolean
}

export interface SimulatedTrade {
  timestamp: number
  conditionId: string
  market: string
  outcome: string
  side: 'BUY' | 'SELL'
  // Original
  originalPrice: number
  originalUsdValue: number
  // Simulated
  adjustedPrice: number
  slippagePct: number
  simulatedUsdValue: number
  simulatedShares: number
  // Status
  skipped: boolean
  skipReason?: string
  // Capital tracking
  capitalBefore: number
  capitalAfter: number
}

export interface SimulatedPosition {
  conditionId: string
  market: string
  outcome: string
  // Entry
  avgEntryPrice: number           // simulated (slipped) price
  originalAvgEntryPrice: number   // original trader's price
  totalShares: number
  totalInvested: number
  // Resolution
  resolved: boolean
  isWin: boolean
  resolvedAt?: string
  // P&L
  realizedPnl: number
  originalRealizedPnl: number
}

export interface EquityCurvePoint {
  timestamp: number
  date: string                    // ISO date
  simulatedCapital: number        // running capital
  originalCumPnl: number          // original wallet cumulative PnL
}

export interface SimulationResult {
  config: SimulationConfig

  // Summary metrics
  finalCapital: number
  totalPnl: number
  totalRoi: number
  winRate: number
  winCount: number
  lossCount: number
  tradeCount: number
  skippedTrades: number
  avgSlippage: number
  maxDrawdown: number

  // Comparison with original wallet
  originalPnl: number
  originalRoi: number
  originalWinRate: number
  performanceRatio: number        // simulated ROI / original ROI

  // Detail data
  trades: SimulatedTrade[]
  positions: SimulatedPosition[]
  equityCurve: EquityCurvePoint[]

  // Open positions (not yet resolved)
  unrealizedPnl: number
  openPositionCount: number

  // Metadata
  simulatedAt: string
  durationMs: number
  totalTradesFetched: number
}
