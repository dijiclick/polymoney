/**
 * Polymarket Data API client for TypeScript/Next.js
 * Server-side usage only (API routes)
 */

import {
  PolymarketPosition,
  PolymarketClosedPosition,
  TraderMetrics,
  RawPolymarketPosition,
  RawPolymarketClosedPosition,
} from './types/trader'

const DATA_API_BASE = 'https://data-api.polymarket.com'

/**
 * Get a trader's portfolio value
 */
export async function getPortfolioValue(address: string): Promise<number> {
  try {
    const response = await fetch(`${DATA_API_BASE}/value?user=${address}`)
    if (!response.ok) {
      if (response.status === 404) return 0
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    if (Array.isArray(data) && data.length > 0) {
      return parseFloat(data[0]?.value || '0')
    }
    return 0
  } catch (error) {
    console.error(`Error getting portfolio value for ${address}:`, error)
    return 0
  }
}

/**
 * Get a trader's open positions
 */
export async function getPositions(address: string): Promise<RawPolymarketPosition[]> {
  try {
    const response = await fetch(`${DATA_API_BASE}/positions?user=${address}`)
    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error(`Error getting positions for ${address}:`, error)
    return []
  }
}

/**
 * Get a trader's closed/resolved positions
 */
export async function getClosedPositions(address: string): Promise<RawPolymarketClosedPosition[]> {
  try {
    const response = await fetch(`${DATA_API_BASE}/closed-positions?user=${address}`)
    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error(`Error getting closed positions for ${address}:`, error)
    return []
  }
}

/**
 * Get a trader's activity history
 */
export async function getActivity(address: string): Promise<unknown[]> {
  try {
    const response = await fetch(`${DATA_API_BASE}/activity?user=${address}`)
    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error(`Error getting activity for ${address}:`, error)
    return []
  }
}

/**
 * Get all trader data in parallel
 */
export async function getFullTraderData(address: string): Promise<{
  portfolioValue: number
  positions: RawPolymarketPosition[]
  closedPositions: RawPolymarketClosedPosition[]
  activity: unknown[]
}> {
  const [portfolioValue, positions, closedPositions, activity] = await Promise.all([
    getPortfolioValue(address),
    getPositions(address),
    getClosedPositions(address),
    getActivity(address),
  ])

  return {
    portfolioValue,
    positions,
    closedPositions,
    activity,
  }
}

/**
 * Parse raw positions into typed positions
 */
export function parsePositions(rawPositions: RawPolymarketPosition[]): PolymarketPosition[] {
  return rawPositions.map((pos) => ({
    conditionId: pos.conditionId,
    asset: pos.asset,
    marketSlug: pos.slug,
    title: pos.title,
    outcome: pos.outcome,
    outcomeIndex: pos.outcomeIndex || 0,
    size: parseFloat(pos.size || '0'),
    avgPrice: parseFloat(pos.avgPrice || '0'),
    currentPrice: parseFloat(pos.curPrice || '0'),
    initialValue: parseFloat(pos.initialValue || '0'),
    currentValue: parseFloat(pos.currentValue || '0'),
    cashPnl: parseFloat(pos.cashPnl || '0'),
    percentPnl: parseFloat(pos.percentPnl || '0'),
    endDate: pos.endDate,
  }))
}

/**
 * Parse raw closed positions into typed closed positions
 */
export function parseClosedPositions(rawPositions: RawPolymarketClosedPosition[]): PolymarketClosedPosition[] {
  return rawPositions.map((pos) => {
    const pnl = parseFloat(pos.cashPnl || '0')
    return {
      conditionId: pos.conditionId,
      title: pos.title,
      outcome: pos.outcome,
      size: parseFloat(pos.size || '0'),
      avgPrice: parseFloat(pos.avgPrice || '0'),
      finalPrice: 0, // Not always available in raw data
      realizedPnl: pnl,
      resolvedAt: pos.resolvedAt,
      isWin: pnl > 0,
    }
  })
}

/**
 * Calculate trader metrics from positions and activity data
 */
export function calculateMetrics(
  portfolioValue: number,
  positions: PolymarketPosition[],
  closedPositions: PolymarketClosedPosition[],
  activity: unknown[]
): TraderMetrics {
  // Position metrics
  const currentValues = positions.map((p) => p.currentValue)
  const totalPositionValue = currentValues.reduce((sum, v) => sum + v, 0)
  const maxPositionSize = currentValues.length > 0 ? Math.max(...currentValues) : 0
  const avgPositionSize = currentValues.length > 0 ? totalPositionValue / currentValues.length : 0
  const positionConcentration = totalPositionValue > 0 ? (maxPositionSize / totalPositionValue) * 100 : 0

  // PnL calculations
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0)
  const realizedPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const totalPnl = unrealizedPnl + realizedPnl

  // Win rate calculations
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  // For 30d win rate, we'd need timestamps on closed positions
  // For now, calculate overall win rate
  const winningPositions = closedPositions.filter((p) => p.isWin)
  const winRateAllTime = closedPositions.length > 0 ? (winningPositions.length / closedPositions.length) * 100 : 0

  // Approximate 30d win rate (if we had timestamps)
  // For now use alltime as approximation
  const winRate30d = winRateAllTime

  // ROI calculation
  const totalInvested = portfolioValue + Math.abs(realizedPnl) - unrealizedPnl
  const roiPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // Trade count from activity
  const tradeCount30d = Array.isArray(activity) ? activity.length : 0
  const tradeCountAllTime = tradeCount30d + closedPositions.length

  // Unique markets
  const marketSet = new Set<string>()
  positions.forEach((p) => marketSet.add(p.conditionId))
  closedPositions.forEach((p) => marketSet.add(p.conditionId))
  const uniqueMarkets30d = marketSet.size

  return {
    portfolioValue,
    totalPnl,
    unrealizedPnl,
    realizedPnl,
    winRate30d,
    winRateAllTime,
    roiPercent,
    tradeCount30d,
    tradeCountAllTime,
    uniqueMarkets30d,
    positionConcentration,
    maxPositionSize,
    avgPositionSize,
    activePositions: positions.length,
    totalPositions: positions.length + closedPositions.length,
    maxDrawdown: 0, // Would need historical data to calculate
    tradeFrequency: tradeCount30d / 30, // trades per day
    nightTradeRatio: 0, // Would need trade timestamps to calculate
  }
}

/**
 * Validate Ethereum address format
 */
export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}
