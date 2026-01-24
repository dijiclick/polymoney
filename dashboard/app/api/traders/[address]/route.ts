import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getProfile,
  getPortfolioValue,
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

  // 5. Fetch ALL metrics from Goldsky + basic info from Polymarket API
  try {
    // Goldsky: ALL metrics (volume, trades, PnL, win rate, ROI, positions)
    // Polymarket API: Profile info, portfolio value, open positions, and closed positions
    const [goldskyMetrics, profile, portfolioValue, rawPositions, rawClosedPositions] = await Promise.all([
      getGoldskyMetrics(address, 30),
      getProfile(address).catch(() => ({} as { pseudonym?: string; name?: string; profileImage?: string; createdAt?: string })),
      getPortfolioValue(address).catch(() => 0),
      getPositions(address).catch(() => []),
      getClosedPositions(address).catch(() => []),
    ])

    // Parse all positions
    const allPositions = parsePositions(rawPositions)
    const closedPositions = parseClosedPositions(rawClosedPositions)

    // Filter to only truly open positions (currentValue > 0 means still active)
    const openPositions = allPositions.filter(p => p.currentValue > 0)

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

    // 6. Update wallets table with fresh Goldsky data (if wallet exists)
    if (dbWallet) {
      updateWalletMetricsFromGoldsky(address, goldskyMetrics, portfolioValue, openPositions.length, profile)
    }

    // 7. Build response with Goldsky metrics
    const response: TraderProfileResponse = {
      source: dbWallet ? 'mixed' : 'live',
      dataFreshness: 'fresh',
      address,
      username: profile.name || profile.pseudonym || dbWallet?.username,
      profileImage: profile.profileImage,
      accountCreatedAt: profile.createdAt,
      positions: openPositions,
      closedPositions: closedPositions,
      closedPositionsCount: closedPositions.length || goldskyMetrics.closedPositions,
      trades: [], // No trades from Goldsky - would need separate query
      metrics: {
        portfolioValue,
        totalPnl: goldskyMetrics.totalPnl,
        unrealizedPnl: goldskyMetrics.unrealizedPnl,
        realizedPnl: goldskyMetrics.realizedPnl,
        metrics7d,
        metrics30d,
        avgTradeIntervalHours: 0,
        activePositions: goldskyMetrics.openPositions,
        winRate30d: goldskyMetrics.winRate30d,
        winRateAllTime: goldskyMetrics.winRateAll,
        roiPercent: goldskyMetrics.roiAll,
        tradeCount30d: goldskyMetrics.tradeCount30d,
        tradeCountAllTime: goldskyMetrics.tradeCount30d, // Use 30d as proxy
        uniqueMarkets30d: goldskyMetrics.uniqueMarkets,
        accountAgeDays: undefined,
        positionConcentration: 0,
        maxPositionSize: 0,
        avgPositionSize: 0,
        totalPositions: goldskyMetrics.totalPositions,
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
 * Update wallet metrics in Supabase from Goldsky data
 */
async function updateWalletMetricsFromGoldsky(
  address: string,
  metrics: GoldskyMetrics,
  portfolioValue: number,
  activePositionCount: number,
  profile?: { pseudonym?: string; name?: string; profileImage?: string; createdAt?: string }
) {
  try {
    await supabase.from('wallets').update({
      username: profile?.name || profile?.pseudonym,
      account_created_at: profile?.createdAt,
      balance: portfolioValue,
      // 7-day metrics (from Goldsky)
      pnl_7d: metrics.pnl7d,
      roi_7d: metrics.roi7d,
      win_rate_7d: metrics.winRate7d,
      volume_7d: metrics.volume7d,
      trade_count_7d: metrics.tradeCount7d,
      drawdown_7d: metrics.drawdown7d,
      // 30-day metrics (from Goldsky)
      pnl_30d: metrics.pnl30d,
      roi_30d: metrics.roi30d,
      win_rate_30d: metrics.winRate30d,
      volume_30d: metrics.volume30d,
      trade_count_30d: metrics.tradeCount30d,
      drawdown_30d: metrics.drawdown30d,
      // Overall metrics (from Goldsky)
      total_positions: metrics.closedPositions,
      active_positions: activePositionCount,
      total_wins: metrics.winningPositions,
      total_losses: metrics.losingPositions,
      realized_pnl: metrics.realizedPnl,
      unrealized_pnl: metrics.unrealizedPnl,
      overall_pnl: metrics.totalPnl,
      overall_roi: metrics.roiAll,
      overall_win_rate: metrics.winRateAll,
      total_volume: metrics.volume30d,
      total_trades: metrics.tradeCount30d,
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('address', address)
  } catch (error) {
    console.error('Error updating wallet metrics:', error)
  }
}
