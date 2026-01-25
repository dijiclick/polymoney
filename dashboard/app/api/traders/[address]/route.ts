import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getPositions,
  getClosedPositions,
  parsePositions,
  parseClosedPositions,
  isValidEthAddress,
} from '@/lib/polymarket-api'
import { TraderProfileResponse, TraderFetchError, TimePeriodMetrics } from '@/lib/types/trader'

// Cache duration: 5 minutes
const CACHE_DURATION_MS = 5 * 60 * 1000

// Create Supabase client with service role for caching
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: rawAddress } = await params
  const address = rawAddress.toLowerCase()

  // 1. Validate address format
  if (!isValidEthAddress(address)) {
    const error: TraderFetchError = {
      error: 'Invalid Ethereum address format',
      code: 'INVALID_ADDRESS',
    }
    return NextResponse.json(error, { status: 400 })
  }

  // Check if force refresh requested
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  // 2. Check database for cached data from wallets table (unified source)
  const { data: dbWallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('address', address)
    .single()

  // 3. Check if cached data is fresh enough (using metrics_updated_at)
  const isFresh = dbWallet?.metrics_updated_at &&
    Date.now() - new Date(dbWallet.metrics_updated_at).getTime() < CACHE_DURATION_MS

  // 4. If fresh cached data and no force refresh, return it from wallets table
  if (dbWallet && isFresh && !forceRefresh) {
    const metrics7d: TimePeriodMetrics = {
      pnl: dbWallet.pnl_7d || 0,
      roi: dbWallet.roi_7d || 0,
      volume: dbWallet.volume_7d || 0,
      tradeCount: dbWallet.trade_count_7d || 0,
      winRate: dbWallet.win_rate_7d || 0,
      drawdown: dbWallet.drawdown_7d || 0,
    }

    const metrics30d: TimePeriodMetrics = {
      pnl: dbWallet.pnl_30d || 0,
      roi: dbWallet.roi_30d || 0,
      volume: dbWallet.volume_30d || 0,
      tradeCount: dbWallet.trade_count_30d || 0,
      winRate: dbWallet.win_rate_30d || 0,
      drawdown: dbWallet.drawdown_30d || 0,
    }

    const response: TraderProfileResponse = {
      source: 'database',
      dataFreshness: 'cached',
      cachedAt: dbWallet.metrics_updated_at,
      address,
      username: dbWallet.username,
      profileImage: undefined,
      accountCreatedAt: dbWallet.account_created_at,
      positions: [],
      closedPositionsCount: dbWallet.total_positions || 0,
      trades: [],
      metrics: {
        portfolioValue: dbWallet.balance || 0,
        totalPnl: dbWallet.overall_pnl || 0,
        unrealizedPnl: dbWallet.unrealized_pnl || 0,
        realizedPnl: dbWallet.realized_pnl || 0,
        metrics7d,
        metrics30d,
        avgTradeIntervalHours: 0,
        activePositions: dbWallet.active_positions || 0,
        winRate30d: dbWallet.win_rate_30d || 0,
        winRateAllTime: dbWallet.overall_win_rate || 0,
        roiPercent: dbWallet.overall_roi || 0,
        tradeCount30d: dbWallet.trade_count_30d || 0,
        tradeCountAllTime: dbWallet.total_trades || 0,
        uniqueMarkets30d: 0,
        accountAgeDays: undefined,
        positionConcentration: 0,
        maxPositionSize: 0,
        avgPositionSize: 0,
        totalPositions: (dbWallet.total_positions || 0) + (dbWallet.active_positions || 0),
        maxDrawdown: 0,
        tradeFrequency: (dbWallet.trade_count_30d || 0) / 30,
        nightTradeRatio: 0,
      },
      scores: undefined,
      isNewlyFetched: false,
      lastUpdatedAt: dbWallet.metrics_updated_at,
      goldskyEnhanced: false,
    }

    return NextResponse.json(response)
  }

  // 5. Fetch live data from Polymarket API
  try {
    const [rawPositions, rawClosedPositions] = await Promise.all([
      getPositions(address).catch(() => []),
      getClosedPositions(address).catch(() => []),
    ])

    // Parse all positions from APIs
    const allPositions = parsePositions(rawPositions)
    // /closed-positions returns ALL resolved positions (both wins and losses)
    const apiClosedPositions = parseClosedPositions(rawClosedPositions)

    console.log(`[${address}] Raw positions: ${rawPositions.length}, Raw closed: ${rawClosedPositions.length}`)
    console.log(`[${address}] Parsed positions: ${allPositions.length}, API closed: ${apiClosedPositions.length}`)

    // Separate open positions (currentValue > 0) from resolved positions (currentValue = 0)
    const openPositions = allPositions.filter(p => p.currentValue > 0)

    // Find resolved positions from /positions that aren't in /closed-positions
    // This can happen if there's a delay in the API or for edge cases
    const apiClosedConditionIds = new Set(apiClosedPositions.map(p => p.conditionId))
    const additionalResolved = allPositions
      .filter(p => p.currentValue === 0 && !apiClosedConditionIds.has(p.conditionId))
      .map(p => ({
        conditionId: p.conditionId,
        title: p.title,
        outcome: p.outcome,
        size: p.size,
        avgPrice: p.avgPrice,
        finalPrice: 0,
        realizedPnl: p.cashPnl,
        resolvedAt: p.endDate,
        isWin: p.cashPnl > 0,
      }))

    // Combine API closed positions with any additional resolved ones
    const closedPositions = [...apiClosedPositions, ...additionalResolved]
      .sort((a, b) => {
        // Sort by resolved date if available, newest first
        const dateA = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
        const dateB = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
        return dateB - dateA
      })

    console.log(`[${address}] Open: ${openPositions.length}, Closed: ${closedPositions.length}`)

    // Get current balance for ROI calculation
    const currentBalance = dbWallet?.balance || 0

    // Calculate all metrics from Polymarket positions data
    // Trade counting: hedged positions (same market, different outcomes) = 1 trade
    // ROI = Account ROI = Total PnL / Initial Balance
    // Max Drawdown = calculated from closed positions chronologically
    const polymarketMetrics = calculatePolymarketMetrics(closedPositions, allPositions, currentBalance)

    // Calculate period-based metrics (7d and 30d) from closed positions
    const metrics7d = calculatePeriodMetrics(closedPositions, 7, currentBalance)
    const metrics30d = calculatePeriodMetrics(closedPositions, 30, currentBalance)

    // 6. Update wallets table with fresh data (if wallet exists)
    if (dbWallet) {
      updateWalletMetrics(address, polymarketMetrics, metrics7d, metrics30d, openPositions.length, closedPositions.length)
    }

    // Count unique markets
    const uniqueMarkets = new Set(closedPositions.map(p => p.conditionId)).size

    // 7. Build response - all metrics from Polymarket
    const response: TraderProfileResponse = {
      source: dbWallet ? 'mixed' : 'live',
      dataFreshness: 'fresh',
      address,
      username: dbWallet?.username,
      profileImage: undefined,
      accountCreatedAt: dbWallet?.account_created_at,
      positions: openPositions,
      closedPositions: closedPositions,
      closedPositionsCount: closedPositions.length,
      trades: [],
      metrics: {
        portfolioValue: dbWallet?.balance || 0,
        totalPnl: polymarketMetrics.totalPnl,
        unrealizedPnl: polymarketMetrics.unrealizedPnl,
        realizedPnl: polymarketMetrics.realizedPnl,
        metrics7d,
        metrics30d,
        avgTradeIntervalHours: 0,
        activePositions: openPositions.length,
        winRate30d: metrics30d.winRate,
        winRateAllTime: polymarketMetrics.winRateAll,
        roiPercent: polymarketMetrics.roiAll,
        tradeCount30d: metrics30d.tradeCount,
        tradeCountAllTime: polymarketMetrics.tradeCount,
        uniqueMarkets30d: uniqueMarkets,
        accountAgeDays: undefined,
        positionConcentration: 0,
        maxPositionSize: 0,
        avgPositionSize: 0,
        totalPositions: closedPositions.length + openPositions.length,
        maxDrawdown: polymarketMetrics.maxDrawdown,
        tradeFrequency: metrics30d.tradeCount / 30,
        nightTradeRatio: 0,
      },
      scores: undefined,
      isNewlyFetched: true,
      lastUpdatedAt: new Date().toISOString(),
      goldskyEnhanced: false,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching trader data:', error)

    // If Goldsky fails but we have stale cached data, return it with warning
    if (dbWallet) {
      const stalePeriodMetrics7d: TimePeriodMetrics = {
        pnl: dbWallet.pnl_7d || 0,
        roi: dbWallet.roi_7d || 0,
        volume: dbWallet.volume_7d || 0,
        tradeCount: dbWallet.trade_count_7d || 0,
        winRate: dbWallet.win_rate_7d || 0,
        drawdown: dbWallet.drawdown_7d || 0,
      }

      const stalePeriodMetrics30d: TimePeriodMetrics = {
        pnl: dbWallet.pnl_30d || 0,
        roi: dbWallet.roi_30d || 0,
        volume: dbWallet.volume_30d || 0,
        tradeCount: dbWallet.trade_count_30d || 0,
        winRate: dbWallet.win_rate_30d || 0,
        drawdown: dbWallet.drawdown_30d || 0,
      }

      const response: TraderProfileResponse = {
        source: 'database',
        dataFreshness: 'stale',
        cachedAt: dbWallet.metrics_updated_at,
        address,
        username: dbWallet.username,
        profileImage: undefined,
        accountCreatedAt: dbWallet.account_created_at,
        positions: [],
        closedPositionsCount: dbWallet.total_positions || 0,
        trades: [],
        metrics: {
          portfolioValue: dbWallet.balance || 0,
          totalPnl: dbWallet.overall_pnl || 0,
          unrealizedPnl: dbWallet.unrealized_pnl || 0,
          realizedPnl: dbWallet.realized_pnl || 0,
          metrics7d: stalePeriodMetrics7d,
          metrics30d: stalePeriodMetrics30d,
          avgTradeIntervalHours: 0,
          activePositions: dbWallet.active_positions || 0,
          winRate30d: dbWallet.win_rate_30d || 0,
          winRateAllTime: dbWallet.overall_win_rate || 0,
          roiPercent: dbWallet.overall_roi || 0,
          tradeCount30d: dbWallet.trade_count_30d || 0,
          tradeCountAllTime: dbWallet.total_trades || 0,
          uniqueMarkets30d: 0,
          accountAgeDays: undefined,
          positionConcentration: 0,
          maxPositionSize: 0,
          avgPositionSize: 0,
          totalPositions: (dbWallet.total_positions || 0) + (dbWallet.active_positions || 0),
          maxDrawdown: 0,
          tradeFrequency: (dbWallet.trade_count_30d || 0) / 30,
          nightTradeRatio: 0,
        },
        scores: undefined,
        isNewlyFetched: false,
        lastUpdatedAt: dbWallet.metrics_updated_at,
        warning: 'Live data unavailable, showing cached data',
        goldskyEnhanced: false,
      }

      return NextResponse.json(response)
    }

    // No cached data and API failed
    const notFoundError: TraderFetchError = {
      error: 'Trader not found or API unavailable',
      code: 'NOT_FOUND',
      details: error instanceof Error ? error.message : 'Unknown error',
    }
    return NextResponse.json(notFoundError, { status: 404 })
  }
}

/**
 * Trade counting logic:
 * - Same conditionId + different outcomes (hedging) = 1 trade
 * - Same conditionId + same outcome (re-entry) = multiple trades
 *
 * A "trade" is a complete position cycle. Simultaneous hedged positions count as 1 trade.
 */
interface Trade {
  conditionId: string
  totalPnl: number
  totalBought: number
  isResolved: boolean
  outcomes: Set<string> // Track unique outcomes for this trade
}

/**
 * Group positions into trades
 * - Positions with same conditionId and different outcomes are hedged (1 trade)
 * - Positions with same conditionId and same outcome are re-entries (separate trades)
 */
function groupPositionsIntoTrades(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number }[],
  openPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; cashPnl: number; currentValue: number }[]
): Trade[] {
  // First, group by conditionId
  const marketGroups = new Map<string, {
    outcomes: Map<string, { pnl: number; bought: number; isResolved: boolean }[]>
  }>()

  // Process closed positions
  for (const pos of closedPositions) {
    const outcome = pos.outcome || 'unknown'
    if (!marketGroups.has(pos.conditionId)) {
      marketGroups.set(pos.conditionId, { outcomes: new Map() })
    }
    const group = marketGroups.get(pos.conditionId)!
    if (!group.outcomes.has(outcome)) {
      group.outcomes.set(outcome, [])
    }
    group.outcomes.get(outcome)!.push({
      pnl: pos.realizedPnl,
      bought: pos.size * pos.avgPrice,
      isResolved: true,
    })
  }

  // Process open positions
  for (const pos of openPositions) {
    const outcome = pos.outcome || 'unknown'
    const isResolvedNotRedeemed = pos.currentValue === 0
    if (!marketGroups.has(pos.conditionId)) {
      marketGroups.set(pos.conditionId, { outcomes: new Map() })
    }
    const group = marketGroups.get(pos.conditionId)!
    if (!group.outcomes.has(outcome)) {
      group.outcomes.set(outcome, [])
    }
    group.outcomes.get(outcome)!.push({
      pnl: pos.cashPnl,
      bought: pos.size * pos.avgPrice,
      isResolved: isResolvedNotRedeemed,
    })
  }

  // Now convert to trades
  const trades: Trade[] = []

  for (const [conditionId, group] of marketGroups) {
    const outcomeKeys = Array.from(group.outcomes.keys())

    if (outcomeKeys.length > 1) {
      // Multiple outcomes (hedging) = 1 trade with combined PnL
      let totalPnl = 0
      let totalBought = 0
      let isResolved = false
      const outcomes = new Set<string>()

      for (const [outcome, entries] of group.outcomes) {
        outcomes.add(outcome)
        for (const entry of entries) {
          totalPnl += entry.pnl
          totalBought += entry.bought
          if (entry.isResolved) isResolved = true
        }
      }

      trades.push({ conditionId, totalPnl, totalBought, isResolved, outcomes })
    } else {
      // Single outcome - each entry is a separate trade (could be re-entries)
      const outcome = outcomeKeys[0]
      const entries = group.outcomes.get(outcome)!

      for (const entry of entries) {
        trades.push({
          conditionId,
          totalPnl: entry.pnl,
          totalBought: entry.bought,
          isResolved: entry.isResolved,
          outcomes: new Set([outcome]),
        })
      }
    }
  }

  return trades
}

/**
 * Calculate period-based metrics (7d, 30d) from closed positions
 * Filters positions by resolvedAt date and calculates metrics for that period
 */
function calculatePeriodMetrics(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number; isWin: boolean; resolvedAt?: string }[],
  days: number,
  currentBalance: number = 0
): TimePeriodMetrics {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoffMs = cutoffDate.getTime()

  // Filter positions resolved within the period
  const periodPositions = closedPositions.filter(p => {
    if (!p.resolvedAt) return false
    return new Date(p.resolvedAt).getTime() >= cutoffMs
  })

  if (periodPositions.length === 0) {
    return {
      pnl: 0,
      roi: 0,
      volume: 0,
      tradeCount: 0,
      winRate: 0,
      drawdown: 0,
    }
  }

  // Calculate PnL
  const pnl = periodPositions.reduce((sum, p) => sum + p.realizedPnl, 0)

  // Calculate volume (total bought)
  const volume = periodPositions.reduce((sum, p) => sum + (p.size * p.avgPrice), 0)

  // Calculate win rate
  const wins = periodPositions.filter(p => p.realizedPnl > 0).length
  const winRate = periodPositions.length > 0 ? (wins / periodPositions.length) * 100 : 0

  // ROI = Period PnL / Period Volume (capital deployed in this period)
  const roi = volume > 0 ? (pnl / volume) * 100 : 0

  // Calculate drawdown for period
  const totalPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const initialBalance = Math.max(currentBalance - totalPnl, 1) // Ensure positive for drawdown calc
  const drawdown = calculateMaxDrawdown(periodPositions, initialBalance)

  return {
    pnl: Math.round(pnl * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    tradeCount: periodPositions.length,
    winRate: Math.round(winRate * 100) / 100,
    drawdown,
  }
}

/**
 * Calculate max drawdown from closed positions
 *
 * Max Drawdown = highest (maxBalance - currentBalance) / maxBalance * 100
 *
 * We track portfolio balance over time:
 * 1. Start with initial balance
 * 2. As each position resolves, add its realized P&L to balance
 * 3. Track max balance seen so far
 * 4. Calculate drawdown when balance drops below max
 * 5. Return the maximum drawdown percentage
 *
 * @param closedPositions - Array of closed positions with realizedPnl and resolvedAt
 * @param initialBalance - Starting balance
 */
function calculateMaxDrawdown(
  closedPositions: { realizedPnl: number; resolvedAt?: string }[],
  initialBalance: number = 0
): number {
  // Sort positions by resolution date chronologically
  const sortedPositions = [...closedPositions]
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (sortedPositions.length === 0) return 0

  // Track running balance and max balance
  let balance = initialBalance
  let maxBalance = initialBalance
  let maxDrawdownPercent = 0

  for (const position of sortedPositions) {
    // Add realized P&L to balance
    balance += position.realizedPnl

    // Update max balance if we hit a new high
    if (balance > maxBalance) {
      maxBalance = balance
    }

    // Calculate current drawdown from max
    if (maxBalance > 0) {
      const drawdownPercent = ((maxBalance - balance) / maxBalance) * 100
      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent
      }
    }
  }

  // Cap at 100%
  return Math.min(Math.round(maxDrawdownPercent * 100) / 100, 100)
}

/**
 * Calculate metrics from Polymarket positions data
 *
 * Trade counting:
 * - Same conditionId + different outcomes (hedging) = 1 trade
 * - Same conditionId + same outcome (re-entry) = separate trades
 *
 * ROI calculation:
 * - Account ROI = Total PnL / Initial Balance * 100
 * - Initial Balance = Current Balance - Total PnL (estimated from portfolio value)
 */
function calculatePolymarketMetrics(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number; isWin: boolean; resolvedAt?: string }[],
  allPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; cashPnl: number; currentValue: number }[],
  currentBalance: number = 0
): {
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  totalBought: number
  roiAll: number
  winRateAll: number
  winCount: number
  lossCount: number
  tradeCount: number
  activeTradeCount: number
  maxDrawdown: number
} {
  // Group positions into trades
  const trades = groupPositionsIntoTrades(closedPositions, allPositions)

  // Calculate metrics from trades
  let realizedPnl = 0
  let unrealizedPnl = 0
  let totalBoughtResolved = 0
  let winCount = 0
  let lossCount = 0
  let activeTradeCount = 0

  for (const trade of trades) {
    if (trade.isResolved) {
      // Resolved trade: count in win rate and ROI
      realizedPnl += trade.totalPnl
      totalBoughtResolved += trade.totalBought
      if (trade.totalPnl > 0) {
        winCount++
      } else {
        lossCount++
      }
    } else {
      // Active trade: track separately, don't count in win rate
      unrealizedPnl += trade.totalPnl
      activeTradeCount++
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl
  const tradeCount = winCount + lossCount

  // ROI = Total PnL / Total Capital Deployed (totalBoughtResolved)
  // More reliable than initialBalance which can be negative when users withdraw profits
  const roiAll = totalBoughtResolved > 0 ? (totalPnl / totalBoughtResolved) * 100 : 0

  // Win rate from resolved trades
  const winRateAll = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0

  // Calculate max drawdown from closed positions
  const initialBalance = Math.max(currentBalance - totalPnl, 1) // Ensure positive for drawdown calc
  const maxDrawdown = calculateMaxDrawdown(closedPositions, initialBalance)

  return {
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalBought: Math.round(totalBoughtResolved * 100) / 100,
    roiAll: Math.round(roiAll * 100) / 100,
    winRateAll: Math.round(winRateAll * 100) / 100,
    winCount,
    lossCount,
    tradeCount,
    activeTradeCount,
    maxDrawdown,
  }
}

/**
 * Update wallet metrics in Supabase from Polymarket calculated data
 */
async function updateWalletMetrics(
  address: string,
  polymarketMetrics: {
    realizedPnl: number
    unrealizedPnl: number
    totalPnl: number
    totalBought: number
    roiAll: number
    winRateAll: number
    winCount: number
    lossCount: number
    tradeCount: number
    activeTradeCount: number
    maxDrawdown: number
  },
  metrics7d: TimePeriodMetrics,
  metrics30d: TimePeriodMetrics,
  activePositionCount: number,
  closedPositionCount: number
) {
  try {
    await supabase.from('wallets').update({
      // 7-day metrics
      pnl_7d: metrics7d.pnl,
      roi_7d: metrics7d.roi,
      win_rate_7d: metrics7d.winRate,
      volume_7d: metrics7d.volume,
      trade_count_7d: metrics7d.tradeCount,
      drawdown_7d: metrics7d.drawdown,
      // 30-day metrics
      pnl_30d: metrics30d.pnl,
      roi_30d: metrics30d.roi,
      win_rate_30d: metrics30d.winRate,
      volume_30d: metrics30d.volume,
      trade_count_30d: metrics30d.tradeCount,
      drawdown_30d: metrics30d.drawdown,
      // Overall metrics
      total_positions: closedPositionCount,
      active_positions: activePositionCount,
      total_wins: polymarketMetrics.winCount,
      total_losses: polymarketMetrics.lossCount,
      realized_pnl: polymarketMetrics.realizedPnl,
      unrealized_pnl: polymarketMetrics.unrealizedPnl,
      overall_pnl: polymarketMetrics.totalPnl,
      overall_roi: polymarketMetrics.roiAll,
      overall_win_rate: polymarketMetrics.winRateAll,
      total_volume: polymarketMetrics.totalBought,
      total_trades: polymarketMetrics.tradeCount,
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('address', address)
  } catch (error) {
    console.error('Error updating wallet metrics:', error)
  }
}
