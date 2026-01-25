/**
 * Polymarket Data API client for TypeScript/Next.js
 * Server-side usage only (API routes)
 */

import {
  PolymarketPosition,
  PolymarketClosedPosition,
  TraderMetrics,
  TimePeriodMetrics,
  RawPolymarketPosition,
  RawPolymarketClosedPosition,
  ParsedTrade,
} from './types/trader'

const DATA_API_BASE = 'https://data-api.polymarket.com'
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com'

export interface TraderProfile {
  createdAt?: string
  pseudonym?: string
  name?: string
  profileImage?: string
  bio?: string
  xUsername?: string
  verifiedBadge?: boolean
}

/**
 * Get a trader's public profile from Gamma API
 */
export async function getProfile(address: string): Promise<TraderProfile> {
  try {
    const response = await fetch(`${GAMMA_API_BASE}/public-profile?address=${address}`)
    if (!response.ok) {
      return {}
    }
    return await response.json()
  } catch (error) {
    console.error(`Error getting profile for ${address}:`, error)
    return {}
  }
}

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
 * Get a trader's open positions with pagination
 * API has a hard cap of 50 per request, so we paginate through all results
 */
export async function getPositions(address: string, maxPositions: number = 10000): Promise<RawPolymarketPosition[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allPositions: RawPolymarketPosition[] = []
  let offset = 0

  try {
    while (offset < maxPositions) {
      const response = await fetch(
        `${DATA_API_BASE}/positions?user=${address}&limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!response.ok) {
        if (response.status === 404) return allPositions
        throw new Error(`API error: ${response.status}`)
      }
      const data = await response.json()
      const positions = Array.isArray(data) ? data : []

      if (positions.length === 0) break

      allPositions.push(...positions)

      // If we got less than PAGE_SIZE, we've reached the end
      if (positions.length < PAGE_SIZE) break

      offset += PAGE_SIZE
    }

    return allPositions
  } catch (error) {
    console.error(`Error getting positions for ${address}:`, error)
    return allPositions // Return what we have so far
  }
}

/**
 * Get a trader's closed/resolved positions with pagination
 * API has a hard cap of 50 per request, so we paginate through all results
 * @param address - Wallet address
 * @param maxPositions - Maximum positions to fetch (default 10000)
 * @param days - Only include positions from last N days (default 30)
 */
export async function getClosedPositions(
  address: string,
  maxPositions: number = 10000,
  days: number = 30
): Promise<RawPolymarketClosedPosition[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allPositions: RawPolymarketClosedPosition[] = []
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
  let offset = 0
  let reachedOldData = false

  try {
    while (offset < maxPositions && !reachedOldData) {
      const response = await fetch(
        `${DATA_API_BASE}/closed-positions?user=${address}&limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!response.ok) {
        if (response.status === 404) return allPositions
        throw new Error(`API error: ${response.status}`)
      }
      const data = await response.json()
      const positions = Array.isArray(data) ? data : []

      if (positions.length === 0) break

      // Filter positions by date and check if we've gone past the cutoff
      for (const pos of positions) {
        // Get timestamp from various possible fields
        let posTime = 0
        if (pos.timestamp) {
          posTime = typeof pos.timestamp === 'number' ? pos.timestamp * 1000 : new Date(pos.timestamp).getTime()
        } else if (pos.resolvedAt) {
          posTime = new Date(pos.resolvedAt).getTime()
        } else if (pos.endDate) {
          posTime = new Date(pos.endDate).getTime()
        }

        // If position is within date range, include it
        if (posTime >= cutoffMs || posTime === 0) {
          allPositions.push(pos)
        }

        // Check if we've reached data older than cutoff (API returns sorted by date desc)
        if (posTime > 0 && posTime < cutoffMs) {
          reachedOldData = true
        }
      }

      // If we got less than PAGE_SIZE, we've reached the end
      if (positions.length < PAGE_SIZE) break

      offset += PAGE_SIZE

      // Safety check: stop if we have enough positions
      if (allPositions.length >= maxPositions) break
    }

    return allPositions.slice(0, maxPositions)
  } catch (error) {
    console.error(`Error getting closed positions for ${address}:`, error)
    return allPositions // Return what we have so far
  }
}

/**
 * Get a trader's activity history with pagination
 * API has a hard cap of 50 per request, so we paginate through all results
 * @param address - Wallet address
 * @param maxActivities - Maximum activities to fetch (default 10000)
 * @param days - Only include activities from last N days (default 30)
 */
export async function getActivity(
  address: string,
  maxActivities: number = 10000,
  days: number = 30
): Promise<unknown[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allActivities: unknown[] = []
  const cutoffTimestamp = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000) // In seconds
  let offset = 0
  let reachedOldData = false

  try {
    while (offset < maxActivities && !reachedOldData) {
      const response = await fetch(
        `${DATA_API_BASE}/activity?user=${address}&limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!response.ok) {
        if (response.status === 404) return allActivities
        throw new Error(`API error: ${response.status}`)
      }
      const data = await response.json()
      const activities = Array.isArray(data) ? data : []

      if (activities.length === 0) break

      // Filter activities by date (timestamp is in seconds)
      for (const activity of activities) {
        const activityData = activity as { timestamp?: number }
        const activityTime = activityData.timestamp || 0

        // If activity is within date range, include it
        if (activityTime >= cutoffTimestamp || activityTime === 0) {
          allActivities.push(activity)
        }

        // Check if we've reached data older than cutoff (API returns sorted by date desc)
        if (activityTime > 0 && activityTime < cutoffTimestamp) {
          reachedOldData = true
        }
      }

      // If we got less than PAGE_SIZE, we've reached the end
      if (activities.length < PAGE_SIZE) break

      offset += PAGE_SIZE

      // Safety check: stop if we have enough activities
      if (allActivities.length >= maxActivities) break
    }

    return allActivities.slice(0, maxActivities)
  } catch (error) {
    console.error(`Error getting activity for ${address}:`, error)
    return allActivities // Return what we have so far
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
  profile: TraderProfile
}> {
  const [portfolioValue, positions, closedPositions, activity, profile] = await Promise.all([
    getPortfolioValue(address),
    getPositions(address),
    getClosedPositions(address),
    getActivity(address),
    getProfile(address),
  ])

  return {
    portfolioValue,
    positions,
    closedPositions,
    activity,
    profile,
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
 * Handles both old (cashPnl, size) and new (realizedPnl, totalBought) API formats
 */
export function parseClosedPositions(rawPositions: RawPolymarketClosedPosition[]): PolymarketClosedPosition[] {
  return rawPositions.map((pos) => {
    // Handle both field name formats from API
    const pnl = pos.realizedPnl !== undefined
      ? (typeof pos.realizedPnl === 'number' ? pos.realizedPnl : parseFloat(pos.realizedPnl))
      : parseFloat(pos.cashPnl || '0')

    const avgPrice = typeof pos.avgPrice === 'number'
      ? pos.avgPrice
      : parseFloat(String(pos.avgPrice || '0'))

    // Size can come from 'size' or be calculated from 'totalBought'
    let size = 0
    if (pos.size) {
      size = parseFloat(pos.size)
    } else if (pos.totalBought !== undefined) {
      const totalBought = typeof pos.totalBought === 'number'
        ? pos.totalBought
        : parseFloat(pos.totalBought)
      // size = totalBought / avgPrice (since totalBought = size * avgPrice)
      size = avgPrice > 0 ? totalBought / avgPrice : 0
    }

    // Resolve date from either resolvedAt, endDate, or timestamp
    let resolvedAt = pos.resolvedAt
    if (!resolvedAt && pos.timestamp) {
      resolvedAt = new Date(pos.timestamp * 1000).toISOString()
    } else if (!resolvedAt && pos.endDate) {
      resolvedAt = pos.endDate
    }

    return {
      conditionId: pos.conditionId,
      title: pos.title,
      outcome: pos.outcome,
      size: Math.round(size * 100) / 100,
      avgPrice: Math.round(avgPrice * 10000) / 10000,
      finalPrice: 0, // Not available from API
      realizedPnl: Math.round(pnl * 100) / 100,
      resolvedAt,
      isWin: pnl > 0,
    }
  })
}

interface ActivityTrade {
  type?: string
  side?: string
  size?: string | number
  usdcSize?: string | number
  price?: string | number
  cashPnl?: string | number
  timestamp?: number | string
  title?: string
  slug?: string
  outcome?: string
  transactionHash?: string
}

/**
 * Parse activity trades into structured format
 */
export function parseTrades(activity: unknown[]): ParsedTrade[] {
  const trades = (activity as ActivityTrade[]).filter(a => a.type === 'TRADE')

  return trades.map(t => ({
    timestamp: typeof t.timestamp === 'number' ? t.timestamp : parseInt(String(t.timestamp || 0)),
    side: (t.side?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
    market: t.title || t.slug || 'Unknown',
    outcome: t.outcome,
    size: parseFloat(String(t.size || 0)),
    price: parseFloat(String(t.price || 0)),
    usdValue: parseFloat(String(t.usdcSize || 0)),
    txHash: t.transactionHash,
  })).sort((a, b) => b.timestamp - a.timestamp) // Most recent first
}

/**
 * Calculate metrics for a specific time period
 */
function calculatePeriodMetrics(
  trades: ParsedTrade[],
  positions: PolymarketPosition[],
  closedPositions: PolymarketClosedPosition[],
  days: number
): TimePeriodMetrics {
  const now = Date.now()
  const cutoffMs = now - days * 24 * 60 * 60 * 1000

  // Filter trades by time period (timestamp is in seconds)
  const periodTrades = trades.filter(t => t.timestamp * 1000 >= cutoffMs)

  // Calculate volume (total USD traded in period)
  const volume = periodTrades.reduce((sum, t) => sum + t.usdValue, 0)

  // Filter closed positions by resolution date for win rate calculation
  const periodClosedPositions = closedPositions.filter(p => {
    if (!p.resolvedAt) return false
    const resolvedMs = new Date(p.resolvedAt).getTime()
    return resolvedMs >= cutoffMs
  })

  // Calculate PnL from positions resolved in this period
  const realizedPnl = periodClosedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)

  // Calculate win rate from positions resolved in this period
  const winningPositions = periodClosedPositions.filter(p => p.realizedPnl > 0)
  const winRate = periodClosedPositions.length > 0
    ? (winningPositions.length / periodClosedPositions.length) * 100
    : 0

  // Calculate ROI: PnL / invested amount for positions resolved in period
  const invested = periodTrades
    .filter(t => t.side === 'BUY')
    .reduce((sum, t) => sum + t.usdValue, 0)
  const roi = invested > 0 ? (realizedPnl / invested) * 100 : 0

  return {
    pnl: realizedPnl,
    roi,
    volume,
    tradeCount: periodTrades.length,
    winRate,
    positionsResolved: periodClosedPositions.length,
    winningPositions: winningPositions.length,
    losingPositions: periodClosedPositions.length - winningPositions.length,
  }
}

/**
 * Calculate average time between trades in hours
 */
function calculateAvgTradeInterval(trades: ParsedTrade[]): number {
  if (trades.length < 2) return 0

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp)
  let totalIntervalMs = 0

  for (let i = 1; i < sorted.length; i++) {
    totalIntervalMs += (sorted[i].timestamp - sorted[i - 1].timestamp) * 1000
  }

  const avgMs = totalIntervalMs / (sorted.length - 1)
  return avgMs / (1000 * 60 * 60) // Convert to hours
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
  // Parse all trades
  const allTrades = parseTrades(activity)

  // Calculate time-period metrics (now includes closedPositions for accurate win rate)
  const metrics7d = calculatePeriodMetrics(allTrades, positions, closedPositions, 7)
  const metrics30d = calculatePeriodMetrics(allTrades, positions, closedPositions, 30)

  // Calculate average trade interval
  const avgTradeIntervalHours = calculateAvgTradeInterval(allTrades)

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

  // Win rate calculation (all-time from closed positions)
  const totalWins = closedPositions.filter(p => p.realizedPnl > 0).length
  const winRateAllTime = closedPositions.length > 0
    ? (totalWins / closedPositions.length) * 100
    : 0

  // ROI calculation
  const totalInvested = portfolioValue + Math.abs(realizedPnl) - unrealizedPnl
  const roiPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // Unique markets
  const marketSet = new Set<string>()
  positions.forEach((p) => marketSet.add(p.conditionId))
  closedPositions.forEach((p) => marketSet.add(p.conditionId))

  return {
    portfolioValue,
    totalPnl,
    unrealizedPnl,
    realizedPnl,

    // Time-period metrics
    metrics7d,
    metrics30d,
    avgTradeIntervalHours,
    activePositions: positions.length,

    // Legacy fields for compatibility
    winRate30d: metrics30d.winRate,
    winRateAllTime,
    roiPercent,
    tradeCount30d: metrics30d.tradeCount,
    tradeCountAllTime: allTrades.length,
    uniqueMarkets30d: marketSet.size,
    positionConcentration,
    maxPositionSize,
    avgPositionSize,
    totalPositions: closedPositions.length,
    maxDrawdown: 0, // Not available from API
    tradeFrequency: metrics30d.tradeCount / 30,
    nightTradeRatio: 0,
  }
}

/**
 * Validate Ethereum address format
 */
export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}
