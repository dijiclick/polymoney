import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getPositions,
  getClosedPositions,
  parsePositions,
  parseClosedPositions,
  isValidEthAddress,
} from '@/lib/polymarket-api'
import { getTraderMetrics as getGoldskyMetrics, GoldskyMetrics } from '@/lib/goldsky-api'
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
      goldskyEnhanced: true, // Cached data comes from Goldsky
    }

    return NextResponse.json(response)
  }

  // 5. Fetch live data: Goldsky for trade metrics, Polymarket for positions only
  try {
    // Goldsky: Trade metrics (volume, trades, PnL, win rate, drawdown)
    // Polymarket API: Only positions (open and closed)
    const [goldskyMetrics, rawPositions, rawClosedPositions] = await Promise.all([
      getGoldskyMetrics(address, 30),
      getPositions(address).catch(() => []),
      getClosedPositions(address).catch(() => []),
    ])

    // Parse all positions
    const allPositions = parsePositions(rawPositions)
    const redeemedWins = parseClosedPositions(rawClosedPositions)

    // Separate open positions (currentValue > 0) from resolved losses (currentValue = 0)
    const openPositions = allPositions.filter(p => p.currentValue > 0)

    // Resolved losses are positions with currentValue = 0 that aren't in the redeemed wins
    // These are bets that lost and the market resolved against the user
    const redeemedConditionIds = new Set(redeemedWins.map(p => p.conditionId))
    const resolvedLosses = allPositions
      .filter(p => p.currentValue === 0 && !redeemedConditionIds.has(p.conditionId))
      .map(p => ({
        conditionId: p.conditionId,
        title: p.title,
        outcome: p.outcome,
        size: p.size,
        avgPrice: p.avgPrice,
        finalPrice: 0,
        realizedPnl: p.cashPnl, // This will be negative for losses
        resolvedAt: p.endDate,
        isWin: false,
      }))

    // Combine redeemed wins and resolved losses for the closed positions list
    const closedPositions = [...redeemedWins, ...resolvedLosses]
      .sort((a, b) => {
        // Sort by resolved date if available, newest first
        const dateA = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
        const dateB = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
        return dateB - dateA
      })

    // Calculate ROI from Polymarket closed positions data (matches Polymarket's calculation)
    // ROI = realizedPnl / totalBought * 100
    const polymarketMetrics = calculatePolymarketMetrics(closedPositions, allPositions)

    // Build metrics from Goldsky data (includes ROI and drawdown for each period)
    const metrics7d: TimePeriodMetrics = {
      pnl: goldskyMetrics.pnl7d,
      roi: goldskyMetrics.roi7d,
      volume: goldskyMetrics.volume7d,
      tradeCount: goldskyMetrics.tradeCount7d,
      winRate: goldskyMetrics.winRate7d,
      drawdown: goldskyMetrics.drawdown7d,
    }

    const metrics30d: TimePeriodMetrics = {
      pnl: goldskyMetrics.pnl30d,
      roi: goldskyMetrics.roi30d,
      volume: goldskyMetrics.volume30d,
      tradeCount: goldskyMetrics.tradeCount30d,
      winRate: goldskyMetrics.winRate30d,
      drawdown: goldskyMetrics.drawdown30d,
    }

    // 6. Update wallets table with fresh data (if wallet exists)
    if (dbWallet) {
      updateWalletMetrics(address, goldskyMetrics, polymarketMetrics, openPositions.length, closedPositions.length)
    }

    // 7. Build response - positions from Polymarket, metrics from Goldsky/calculated
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
        // Use Polymarket calculated PnL (matches their UI)
        totalPnl: polymarketMetrics.totalPnl,
        unrealizedPnl: polymarketMetrics.unrealizedPnl,
        realizedPnl: polymarketMetrics.realizedPnl,
        metrics7d,
        metrics30d,
        avgTradeIntervalHours: 0,
        activePositions: openPositions.length, // Use Polymarket API count, not Goldsky
        winRate30d: goldskyMetrics.winRate30d,
        // Use Polymarket calculated win rate and ROI (matches their UI)
        winRateAllTime: polymarketMetrics.winRateAll,
        roiPercent: polymarketMetrics.roiAll,
        tradeCount30d: goldskyMetrics.tradeCount30d,
        tradeCountAllTime: goldskyMetrics.tradeCount30d, // Use 30d as proxy
        uniqueMarkets30d: goldskyMetrics.uniqueMarkets,
        accountAgeDays: undefined,
        positionConcentration: 0,
        maxPositionSize: 0,
        avgPositionSize: 0,
        totalPositions: closedPositions.length + openPositions.length, // Use actual counts
        maxDrawdown: goldskyMetrics.drawdown30d,
        tradeFrequency: goldskyMetrics.tradeCount30d / 30,
        nightTradeRatio: 0,
      },
      scores: undefined,
      isNewlyFetched: true,
      lastUpdatedAt: new Date().toISOString(),
      goldskyEnhanced: true,
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
        goldskyEnhanced: true,
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
 * Calculate metrics from Polymarket positions data (matches Polymarket's ROI calculation)
 * ROI = realizedPnl / totalBought * 100
 */
function calculatePolymarketMetrics(
  closedPositions: { size: number; avgPrice: number; realizedPnl: number; isWin: boolean }[],
  allPositions: { size: number; avgPrice: number; cashPnl: number; currentValue: number }[]
): {
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  totalBought: number
  roiAll: number
  winRateAll: number
  winCount: number
  lossCount: number
} {
  // Calculate total realized PnL and total bought from closed positions
  let realizedPnl = 0
  let totalBoughtClosed = 0
  let winCount = 0
  let lossCount = 0

  for (const pos of closedPositions) {
    realizedPnl += pos.realizedPnl
    totalBoughtClosed += pos.size * pos.avgPrice // Initial investment
    if (pos.isWin) {
      winCount++
    } else {
      lossCount++
    }
  }

  // Calculate unrealized PnL from open positions
  let unrealizedPnl = 0
  for (const pos of allPositions) {
    if (pos.currentValue > 0) {
      unrealizedPnl += pos.cashPnl
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl

  // Calculate ROI: realizedPnl / totalBought * 100 (matches Polymarket's calculation)
  const roiAll = totalBoughtClosed > 0 ? (realizedPnl / totalBoughtClosed) * 100 : 0

  // Win rate from closed positions
  const totalClosed = winCount + lossCount
  const winRateAll = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0

  return {
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalBought: Math.round(totalBoughtClosed * 100) / 100,
    roiAll: Math.round(roiAll * 100) / 100,
    winRateAll: Math.round(winRateAll * 100) / 100,
    winCount,
    lossCount,
  }
}

/**
 * Update wallet metrics in Supabase from Goldsky + calculated data
 */
async function updateWalletMetrics(
  address: string,
  goldskyMetrics: GoldskyMetrics,
  polymarketMetrics: {
    realizedPnl: number
    unrealizedPnl: number
    totalPnl: number
    roiAll: number
    winRateAll: number
    winCount: number
    lossCount: number
  },
  activePositionCount: number,
  closedPositionCount: number
) {
  try {
    await supabase.from('wallets').update({
      // 7-day metrics (from Goldsky - volume, trades, drawdown)
      pnl_7d: goldskyMetrics.pnl7d,
      roi_7d: goldskyMetrics.roi7d,
      win_rate_7d: goldskyMetrics.winRate7d,
      volume_7d: goldskyMetrics.volume7d,
      trade_count_7d: goldskyMetrics.tradeCount7d,
      drawdown_7d: goldskyMetrics.drawdown7d,
      // 30-day metrics (from Goldsky - volume, trades, drawdown)
      pnl_30d: goldskyMetrics.pnl30d,
      roi_30d: goldskyMetrics.roi30d,
      win_rate_30d: goldskyMetrics.winRate30d,
      volume_30d: goldskyMetrics.volume30d,
      trade_count_30d: goldskyMetrics.tradeCount30d,
      drawdown_30d: goldskyMetrics.drawdown30d,
      // Overall metrics - use Polymarket calculations (matches their UI)
      total_positions: closedPositionCount,
      active_positions: activePositionCount,
      total_wins: polymarketMetrics.winCount,
      total_losses: polymarketMetrics.lossCount,
      realized_pnl: polymarketMetrics.realizedPnl,
      unrealized_pnl: polymarketMetrics.unrealizedPnl,
      overall_pnl: polymarketMetrics.totalPnl,
      overall_roi: polymarketMetrics.roiAll,
      overall_win_rate: polymarketMetrics.winRateAll,
      total_volume: goldskyMetrics.volume30d,
      total_trades: goldskyMetrics.tradeCount30d,
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('address', address)
  } catch (error) {
    console.error('Error updating wallet metrics:', error)
  }
}
