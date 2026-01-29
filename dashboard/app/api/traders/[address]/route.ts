import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getPositions,
  getClosedPositions,
  getActivity,
  getProfile,
  getPortfolioValue,
  parsePositions,
  parseClosedPositions,
  parseTrades,
  isValidEthAddress,
  fetchEventCategories,
  getTopCategory,
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
  // Lite mode: skip heavy operations (activity/bot detection, event categories)
  // Used by the modal for fast position loading (~1-2s vs 5-8s)
  const liteMode = request.nextUrl.searchParams.get('lite') === 'true'

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

    // Parse cached positions if available
    let cachedOpen: any[] = []
    let cachedClosed: any[] = []
    if (dbWallet.cached_positions_json) {
      try {
        const cached = JSON.parse(dbWallet.cached_positions_json)
        cachedOpen = cached.open || []
        cachedClosed = cached.closed || []
      } catch { /* ignore parse errors */ }
    }

    const response: TraderProfileResponse = {
      source: 'database',
      dataFreshness: 'cached',
      cachedAt: dbWallet.metrics_updated_at,
      address,
      username: dbWallet.username,
      profileImage: undefined,
      accountCreatedAt: dbWallet.account_created_at,
      positions: cachedOpen,
      closedPositions: cachedClosed.length > 0 ? cachedClosed : undefined,
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
        maxDrawdown: dbWallet.drawdown_all || 0,
        tradeFrequency: (dbWallet.trade_count_30d || 0) / 30,
        nightTradeRatio: 0,
      },
      copyScore: dbWallet.copy_score || 0,
      copyMetrics: {
        profitFactor30d: dbWallet.profit_factor_30d || 0,
        profitFactorAll: dbWallet.profit_factor_all || 0,
        diffWinRate30d: dbWallet.diff_win_rate_30d || 0,
        diffWinRateAll: dbWallet.diff_win_rate_all || 0,
        weeklyProfitRate: dbWallet.weekly_profit_rate || 0,
        avgTradesPerDay: dbWallet.avg_trades_per_day || 0,
        edgeTrend: (dbWallet.roi_30d || 0) > 0
          ? Math.round(((dbWallet.roi_7d || 0) / dbWallet.roi_30d) * 100) / 100
          : 0,
        calmarRatio: (dbWallet.drawdown_30d || 0) > 0
          ? Math.round(((dbWallet.roi_30d || 0) / dbWallet.drawdown_30d) * 100) / 100
          : (dbWallet.roi_30d || 0) > 0 ? 5.0 : 0,
      },
      scores: undefined,
      isNewlyFetched: false,
      lastUpdatedAt: dbWallet.metrics_updated_at,
      goldskyEnhanced: false,
    }

    return NextResponse.json(response)
  }

  // 5. Fetch live data from Polymarket API
  // Lite mode: only fetch positions + portfolio value (skip activity, profile, categories)
  // Full mode: fetch everything including activity for bot detection and categories
  try {
    const [rawPositions, rawClosedPositions, rawActivity, profile, portfolioValue] = await Promise.all([
      getPositions(address).catch(() => []),
      getClosedPositions(address).catch(() => []),
      liteMode ? Promise.resolve([]) : getActivity(address, 5000, 90).catch(() => []),
      liteMode ? Promise.resolve(dbWallet ? { name: dbWallet.username } : {}) : getProfile(address).catch(() => ({})),
      getPortfolioValue(address).catch(() => 0),
    ])

    // Parse all positions from APIs
    const allPositions = parsePositions(rawPositions)
    // IMPORTANT: /closed-positions only returns WINNING positions (where outcome paid out)
    // Losing positions appear in /positions with redeemable=true and cashPnl < 0
    const apiClosedPositions = parseClosedPositions(rawClosedPositions)

    console.log(`[${address}] Raw positions: ${rawPositions.length}, Raw closed: ${rawClosedPositions.length}`)
    console.log(`[${address}] Parsed positions: ${allPositions.length}, API closed (wins): ${apiClosedPositions.length}`)

    // Separate open positions (currentValue > 0) from resolved positions (currentValue = 0)
    const openPositions = allPositions.filter(p => p.currentValue > 0)

    // Find UNREDEEMED LOSSES from /positions API
    // These are positions where:
    // - currentValue = 0 (position is resolved)
    // - redeemable = true (market has ended, position can be redeemed for $0)
    // - cashPnl < 0 (it's a losing position)
    // Note: We don't filter by conditionId because a user could have both a win and loss
    // on the same market if they hedged (bet on both outcomes)
    const unredeemedLosses = allPositions
      .filter(p => p.currentValue === 0 && p.redeemable === true && p.cashPnl < 0)
      .map(p => ({
        conditionId: p.conditionId,
        title: p.title,
        outcome: p.outcome,
        size: p.size,
        avgPrice: p.avgPrice,
        initialValue: p.size * p.avgPrice,
        finalPrice: 0,
        realizedPnl: p.cashPnl,
        resolvedAt: p.endDate,
        isWin: false,
      }))

    console.log(`[${address}] Unredeemed losses found: ${unredeemedLosses.length}`)

    // Combine API closed positions (wins) with unredeemed losses
    const closedPositions = [...apiClosedPositions, ...unredeemedLosses]
      .sort((a, b) => {
        // Sort by resolved date if available, newest first
        const dateA = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
        const dateB = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
        return dateB - dateA
      })

    console.log(`[${address}] Open: ${openPositions.length}, Total Closed (wins+losses): ${closedPositions.length}`)

    // Get current balance for ROI calculation (prefer live portfolio value)
    const currentBalance = portfolioValue || dbWallet?.balance || 0

    // Calculate all metrics from Polymarket positions data
    // Trade counting: hedged positions (same market, different outcomes) = 1 trade
    // ROI = Account ROI = Total PnL / Initial Balance
    // Max Drawdown = calculated from closed positions chronologically
    // Note: Pass openPositions (not allPositions) to avoid double-counting resolved losses
    const polymarketMetrics = calculatePolymarketMetrics(closedPositions, openPositions, currentBalance)

    // Calculate period-based metrics (7d, 30d, and all-time) from closed positions
    const metrics7d = calculatePeriodMetrics(closedPositions, 7, currentBalance)
    const metrics30d = calculatePeriodMetrics(closedPositions, 30, currentBalance)
    const metricsAll = calculatePeriodMetrics(closedPositions, 36500, currentBalance)

    // Bot detection from activity trades (skip in lite mode, use cached value)
    let isBot = dbWallet?.is_bot || false
    if (!liteMode) {
      const activityTrades = parseTrades(rawActivity)
      const botScore = calculateBotScore(activityTrades)
      isBot = botScore >= 60
    }

    // Count unique markets
    const uniqueClosedMarkets = new Set(closedPositions.map(p => p.conditionId).filter(Boolean)).size
    const uniqueOpenMarkets = new Set(openPositions.map(p => p.conditionId).filter(Boolean)).size
    const uniqueMarkets = uniqueClosedMarkets

    // Fetch event categories for top category calculation (skip in lite mode, use cached value)
    let topCategory = dbWallet?.top_category || ''
    if (!liteMode) {
      const allEventSlugs = [
        ...rawPositions.map((p: any) => String(p.eventSlug || p.slug || '')),
        ...rawClosedPositions.map((p: any) => String(p.eventSlug || p.slug || '')),
      ].filter(Boolean)
      const categoryMap = await fetchEventCategories(allEventSlugs)
      topCategory = getTopCategory(allEventSlugs, categoryMap)
    }

    // 6. Calculate copy-trade metrics
    const profitFactor30d = calculateProfitFactor(closedPositions, 30)
    const profitFactorAll = calculateProfitFactor(closedPositions)
    const diffWinRate30d = calculateDiffWinRate(closedPositions, 30)
    const diffWinRateAll = calculateDiffWinRate(closedPositions)
    const weeklyProfitRate = calculateWeeklyProfitRate(closedPositions)
    const avgTradesPerDay = calculateAvgTradesPerDay(closedPositions)
    const medianProfitPct = calculateMedianProfitPct(closedPositions)
    const copyScore = calculateCopyScore({
      profitFactor30d,
      roi30d: metrics30d.roi,
      drawdown30d: metrics30d.drawdown || 0,
      diffWinRate30d,
      weeklyProfitRate,
      roi7d: metrics7d.roi,
      tradeCountAll: polymarketMetrics.tradeCount,
      medianProfitPct,
      avgTradesPerDay,
      isBot,
    })

    const copyMetrics = {
      profitFactor30d,
      profitFactorAll,
      diffWinRate30d,
      diffWinRateAll,
      weeklyProfitRate,
      copyScore,
      avgTradesPerDay,
      medianProfitPct,
    }

    // 7. Save metrics to database (update existing or insert new wallet)
    // Cache positions as JSON for instant loading on subsequent views
    const cachedPositionsJson = JSON.stringify({
      open: openPositions,
      closed: closedPositions,
    })
    const usernameParam = request.nextUrl.searchParams.get('username')
    if (dbWallet) {
      await updateWalletMetrics(address, polymarketMetrics, metrics7d, metrics30d, metricsAll, uniqueOpenMarkets, uniqueClosedMarkets, topCategory, copyMetrics, currentBalance, isBot, profile, cachedPositionsJson)
    } else if (polymarketMetrics.tradeCount >= 15) {
      // Insert new wallet only if it has enough trades
      try {
        await supabase.from('wallets').insert({
          address,
          source: 'live',
          balance: currentBalance,
          username: (profile as any).name || (profile as any).pseudonym || usernameParam || undefined,
          account_created_at: (profile as any).createdAt || undefined,
          pnl_7d: metrics7d.pnl,
          roi_7d: metrics7d.roi,
          win_rate_7d: metrics7d.winRate,
          volume_7d: metrics7d.volume,
          trade_count_7d: metrics7d.tradeCount,
          drawdown_7d: metrics7d.drawdown,
          pnl_30d: metrics30d.pnl,
          roi_30d: metrics30d.roi,
          win_rate_30d: metrics30d.winRate,
          volume_30d: metrics30d.volume,
          trade_count_30d: metrics30d.tradeCount,
          drawdown_30d: metrics30d.drawdown,
          pnl_all: metricsAll.pnl,
          roi_all: metricsAll.roi,
          win_rate_all: metricsAll.winRate,
          volume_all: metricsAll.volume,
          trade_count_all: metricsAll.tradeCount,
          drawdown_all: metricsAll.drawdown,
          drawdown_amount_all: metricsAll.drawdownAmount,
          total_positions: uniqueClosedMarkets,
          active_positions: uniqueOpenMarkets,
          total_wins: polymarketMetrics.winCount,
          total_losses: polymarketMetrics.lossCount,
          realized_pnl: polymarketMetrics.realizedPnl,
          unrealized_pnl: polymarketMetrics.unrealizedPnl,
          overall_pnl: polymarketMetrics.totalPnl,
          overall_roi: polymarketMetrics.roiAll,
          overall_win_rate: polymarketMetrics.winRateAll,
          total_volume: polymarketMetrics.totalBought,
          total_trades: polymarketMetrics.tradeCount,
          ...(topCategory && { top_category: topCategory }),
          // Bot detection
          is_bot: isBot,
          // Copy-trade metrics
          profit_factor_30d: profitFactor30d,
          profit_factor_all: profitFactorAll,
          diff_win_rate_30d: diffWinRate30d,
          diff_win_rate_all: diffWinRateAll,
          weekly_profit_rate: weeklyProfitRate,
          copy_score: copyScore,
          avg_trades_per_day: avgTradesPerDay,
          median_profit_pct: medianProfitPct,
          metrics_updated_at: new Date().toISOString(),
        })
        // Cache positions separately (column may not exist yet - fails silently)
        if (cachedPositionsJson) {
          await supabase.from('wallets').update({
            cached_positions_json: cachedPositionsJson,
          }).eq('address', address).then(() => {}, () => {})
        }
      } catch (error) {
        console.error('Error inserting new wallet:', error)
      }
    }

    // 8. Build response - all metrics from Polymarket
    const response: TraderProfileResponse = {
      source: dbWallet ? 'mixed' : 'live',
      dataFreshness: 'fresh',
      address,
      username: (profile as any).name || (profile as any).pseudonym || dbWallet?.username || usernameParam || undefined,
      profileImage: (profile as any).profileImage || undefined,
      accountCreatedAt: (profile as any).createdAt || dbWallet?.account_created_at,
      positions: openPositions,
      closedPositions: closedPositions,
      closedPositionsCount: uniqueClosedMarkets,
      trades: [],
      metrics: {
        portfolioValue: currentBalance,
        totalPnl: polymarketMetrics.totalPnl,
        unrealizedPnl: polymarketMetrics.unrealizedPnl,
        realizedPnl: polymarketMetrics.realizedPnl,
        metrics7d,
        metrics30d,
        avgTradeIntervalHours: 0,
        activePositions: uniqueOpenMarkets,
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
        totalPositions: uniqueClosedMarkets + uniqueOpenMarkets,
        maxDrawdown: polymarketMetrics.maxDrawdown,
        tradeFrequency: metrics30d.tradeCount / 30,
        nightTradeRatio: 0,
      },
      copyScore,
      copyMetrics: {
        profitFactor30d,
        profitFactorAll,
        diffWinRate30d,
        diffWinRateAll,
        weeklyProfitRate,
        avgTradesPerDay,
        edgeTrend: metrics30d.roi > 0 ? Math.round((metrics7d.roi / metrics30d.roi) * 100) / 100 : 0,
        calmarRatio: (metrics30d.drawdown || 0) > 0
          ? Math.round((metrics30d.roi / metrics30d.drawdown!) * 100) / 100
          : metrics30d.roi > 0 ? 5.0 : 0,
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
          maxDrawdown: dbWallet.drawdown_all || 0,
          tradeFrequency: (dbWallet.trade_count_30d || 0) / 30,
          nightTradeRatio: 0,
        },
        copyScore: dbWallet.copy_score || 0,
        copyMetrics: {
          profitFactor30d: dbWallet.profit_factor_30d || 0,
          profitFactorAll: dbWallet.profit_factor_all || 0,
          diffWinRate30d: dbWallet.diff_win_rate_30d || 0,
          diffWinRateAll: dbWallet.diff_win_rate_all || 0,
          weeklyProfitRate: dbWallet.weekly_profit_rate || 0,
          avgTradesPerDay: dbWallet.avg_trades_per_day || 0,
          edgeTrend: (dbWallet.roi_30d || 0) > 0
            ? Math.round(((dbWallet.roi_7d || 0) / dbWallet.roi_30d) * 100) / 100
            : 0,
          calmarRatio: (dbWallet.drawdown_30d || 0) > 0
            ? Math.round(((dbWallet.roi_30d || 0) / dbWallet.drawdown_30d) * 100) / 100
            : (dbWallet.roi_30d || 0) > 0 ? 5.0 : 0,
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

  // Group by conditionId to count unique markets (not raw YES/NO entries)
  const marketPnl = new Map<string, number>()
  for (const p of periodPositions) {
    const cid = p.conditionId || ''
    marketPnl.set(cid, (marketPnl.get(cid) || 0) + p.realizedPnl)
  }

  // Calculate win rate based on unique markets
  const tradeCount = marketPnl.size
  let wins = 0
  for (const pnlVal of marketPnl.values()) {
    if (pnlVal > 0) wins++
  }
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0

  // ROI = Period PnL / Starting Balance
  // Starting balance estimated as current_balance - period_pnl
  const estimatedStart = currentBalance - pnl
  let roi: number
  if (estimatedStart > 0) {
    roi = (pnl / estimatedStart) * 100
  } else if (pnl > 0 && volume > 0) {
    roi = (pnl / volume) * 100
  } else {
    roi = 0
  }

  // Use max(estimated_start, current_balance) to avoid near-zero base from withdrawals
  const initialBalance = Math.max(currentBalance - pnl, currentBalance, 1)
  const drawdownResult = calculateMaxDrawdown(periodPositions, initialBalance)

  return {
    pnl: Math.round(pnl * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    tradeCount,
    winRate: Math.round(winRate * 100) / 100,
    drawdown: drawdownResult.percent,
    drawdownAmount: drawdownResult.amount,
  }
}

/**
 * Calculate max drawdown from equity curve.
 * Tracks balance starting from initialBalance, adding realized PnL
 * for each position chronologically.
 * Max Drawdown = (peak - trough) / peak * 100
 */
function calculateMaxDrawdown(
  closedPositions: { realizedPnl: number; resolvedAt?: string }[],
  initialBalance: number = 0,
): { percent: number; amount: number } {
  const sortedPositions = [...closedPositions]
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (sortedPositions.length === 0) return { percent: 0, amount: 0 }

  let balance = initialBalance
  let maxBalance = initialBalance
  let maxDrawdownPercent = 0
  let maxDrawdownAmount = 0

  for (const position of sortedPositions) {
    balance += position.realizedPnl
    if (balance > maxBalance) maxBalance = balance
    if (maxBalance > 0) {
      const drawdownPercent = ((maxBalance - balance) / maxBalance) * 100
      const drawdownAmount = maxBalance - balance
      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent
        maxDrawdownAmount = drawdownAmount
      }
    }
  }

  return {
    percent: Math.min(Math.round(maxDrawdownPercent * 100) / 100, 100),
    amount: Math.round(maxDrawdownAmount * 100) / 100,
  }
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
  openPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; cashPnl: number; currentValue: number }[],
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
  maxDrawdownAmount: number
} {
  // Group positions into trades
  // closedPositions = resolved wins + unredeemed losses
  // openPositions = active/unresolved positions only
  const trades = groupPositionsIntoTrades(closedPositions, openPositions)

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

  // ROI = Total PnL / Initial Capital
  // Initial Capital estimated as current_balance - total_pnl (what was deposited)
  const initialCapital = currentBalance - totalPnl
  let roiAll: number
  if (initialCapital > 0) {
    roiAll = (totalPnl / initialCapital) * 100
  } else if (totalPnl > 0 && totalBoughtResolved > 0) {
    roiAll = (totalPnl / totalBoughtResolved) * 100
  } else {
    roiAll = 0
  }

  // Win rate from resolved trades
  const winRateAll = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0

  // Use max(estimated_start, current_balance) to avoid near-zero base from withdrawals
  const drawdownBase = Math.max(currentBalance - totalPnl, currentBalance, 1)
  const maxDrawdownResult = calculateMaxDrawdown(closedPositions, drawdownBase)

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
    maxDrawdown: maxDrawdownResult.percent,
    maxDrawdownAmount: maxDrawdownResult.amount,
  }
}

/**
 * Update wallet metrics in Supabase from Polymarket calculated data
 */
/**
 * Calculate profit factor from closed positions.
 * Profit Factor = gross wins / abs(gross losses)
 */
function calculateProfitFactor(
  closedPositions: { conditionId: string; realizedPnl: number }[],
  days?: number
): number {
  const cutoffMs = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0
  const positions = days
    ? closedPositions.filter(p => {
        const ra = (p as any).resolvedAt
        return ra ? new Date(ra).getTime() >= cutoffMs : false
      })
    : closedPositions

  // Group by conditionId to get per-market PnL
  const marketPnl = new Map<string, number>()
  for (const p of positions) {
    const cid = p.conditionId || ''
    marketPnl.set(cid, (marketPnl.get(cid) || 0) + p.realizedPnl)
  }

  let grossWins = 0
  let grossLosses = 0
  for (const pnl of marketPnl.values()) {
    if (pnl > 0) grossWins += pnl
    else grossLosses += Math.abs(pnl)
  }

  if (grossLosses > 0) return Math.round((grossWins / grossLosses) * 100) / 100
  if (grossWins > 0) return 10.0
  return 0
}

/**
 * Calculate difficulty-weighted win rate.
 * Difficulty = 1 - avgPrice (lower entry = harder bet = more credit)
 */
function calculateDiffWinRate(
  closedPositions: { conditionId: string; avgPrice: number; realizedPnl: number }[],
  days?: number
): number {
  const cutoffMs = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0
  const positions = days
    ? closedPositions.filter(p => {
        const ra = (p as any).resolvedAt
        return ra ? new Date(ra).getTime() >= cutoffMs : false
      })
    : closedPositions

  if (positions.length === 0) return 0

  // Group by conditionId
  const marketPnl = new Map<string, number>()
  const marketPrices = new Map<string, number[]>()
  for (const p of positions) {
    const cid = p.conditionId || ''
    marketPnl.set(cid, (marketPnl.get(cid) || 0) + p.realizedPnl)
    const prices = marketPrices.get(cid) || []
    prices.push(Math.max(0.01, Math.min(p.avgPrice, 0.99)))
    marketPrices.set(cid, prices)
  }

  let totalDifficulty = 0
  let winsDifficulty = 0
  for (const [cid, prices] of marketPrices) {
    const avgEntry = prices.reduce((a, b) => a + b, 0) / prices.length
    const difficulty = 1 - avgEntry
    totalDifficulty += difficulty
    if ((marketPnl.get(cid) || 0) > 0) winsDifficulty += difficulty
  }

  if (totalDifficulty === 0) return 0
  return Math.round((winsDifficulty / totalDifficulty) * 10000) / 100
}

/**
 * Calculate percentage of active weeks that were profitable.
 */
function calculateWeeklyProfitRate(
  closedPositions: { realizedPnl: number; resolvedAt?: string }[]
): number {
  const weekPnl = new Map<string, number>()
  for (const p of closedPositions) {
    if (!p.resolvedAt) continue
    const dt = new Date(p.resolvedAt)
    if (isNaN(dt.getTime())) continue
    // ISO week key
    const startOfYear = new Date(dt.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((dt.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
    const key = `${dt.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    weekPnl.set(key, (weekPnl.get(key) || 0) + p.realizedPnl)
  }

  if (weekPnl.size === 0) return 0
  const profitableWeeks = Array.from(weekPnl.values()).filter(v => v > 0).length
  return Math.round((profitableWeeks / weekPnl.size) * 10000) / 100
}

/**
 * Calculate average trades per active day.
 */
function calculateAvgTradesPerDay(
  closedPositions: { conditionId: string; resolvedAt?: string }[]
): number {
  const activeDays = new Set<string>()
  for (const p of closedPositions) {
    if (!p.resolvedAt) continue
    const dt = new Date(p.resolvedAt)
    if (isNaN(dt.getTime())) continue
    activeDays.add(dt.toISOString().slice(0, 10))
  }
  if (activeDays.size === 0) return 0
  const uniqueMarkets = new Set(closedPositions.map(p => p.conditionId).filter(Boolean)).size
  return Math.round((uniqueMarkets / activeDays.size) * 100) / 100
}

function calculateMedianProfitPct(
  closedPositions: { size: number; avgPrice: number; realizedPnl: number }[]
): number | null {
  const profitPcts: number[] = []

  for (const pos of closedPositions) {
    const initialValue = pos.size * pos.avgPrice
    if (initialValue <= 0) continue
    const pct = (pos.realizedPnl / initialValue) * 100
    profitPcts.push(pct)
  }

  if (profitPcts.length < 3) return null

  profitPcts.sort((a, b) => a - b)
  const n = profitPcts.length

  const interpolate = (sortedData: number[], fracIdx: number): number => {
    const lower = Math.floor(fracIdx)
    const upper = Math.min(lower + 1, sortedData.length - 1)
    const weight = fracIdx - lower
    return sortedData[lower] * (1 - weight) + sortedData[upper] * weight
  }

  const q1 = interpolate(profitPcts, n * 0.25)
  const q3 = interpolate(profitPcts, n * 0.75)
  const iqr = q3 - q1
  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr

  const filtered = profitPcts.filter(p => p >= lowerBound && p <= upperBound)
  if (filtered.length === 0) return null

  filtered.sort((a, b) => a - b)
  const mid = Math.floor(filtered.length / 2)
  const median = filtered.length % 2 === 0
    ? (filtered[mid - 1] + filtered[mid]) / 2
    : filtered[mid]

  return Math.round(median * 100) / 100
}

/**
 * Calculate composite copy-trade score (0-100).
 * Optimized for small-bankroll copy-trading ($50/trade).
 */
function calculateCopyScore(params: {
  profitFactor30d: number
  roi30d: number
  drawdown30d: number
  diffWinRate30d: number
  weeklyProfitRate: number
  roi7d: number
  tradeCountAll: number
  medianProfitPct: number | null
  avgTradesPerDay?: number
  isBot?: boolean
}): number {
  const { profitFactor30d, drawdown30d, weeklyProfitRate, tradeCountAll, medianProfitPct, avgTradesPerDay, isBot } = params

  // ── Hard Filters ────────────────────────────────────────────────
  // All must pass or score = 0. Designed for copy trading with a bot
  // doing $10-50 per trade, 2-15 trades/day.
  if (tradeCountAll < 30) return 0                                    // Statistical significance
  if (profitFactor30d < 1.2) return 0                                 // Real edge exists
  if (medianProfitPct == null || medianProfitPct < 5.0) return 0      // Per-trade quality
  if (isBot) return 0                                                  // Human traders only
  if (avgTradesPerDay != null && (avgTradesPerDay < 2 || avgTradesPerDay > 15)) return 0  // Fits bot capacity

  // ── Pillar 1: Edge (40%) ────────────────────────────────────────
  // Profit Factor = gross wins / gross losses. THE fundamental measure
  // of trading edge. PF 1.2 (min) → 0, PF 3.0+ → 1.0
  const edgeScore = Math.min((profitFactor30d - 1.2) / (3.0 - 1.2), 1.0)

  // ── Pillar 2: Consistency (35%) ─────────────────────────────────
  // Weekly profit rate = % of active weeks that were profitable.
  // Best predictor of future performance (Darwinex research).
  // 40% → 0, 85%+ → 1.0
  const consistencyScore = Math.min(Math.max((weeklyProfitRate - 40) / (85 - 40), 0), 1.0)

  // ── Pillar 3: Risk (25%) ────────────────────────────────────────
  // Inverse of max drawdown. Lower drawdown = higher score.
  // DD 5% → 1.0 (excellent), DD 25%+ → 0 (dangerous)
  const riskScore = drawdown30d <= 0
    ? 1.0  // No drawdown = perfect
    : Math.min(Math.max((25 - drawdown30d) / (25 - 5), 0), 1.0)

  // ── Weighted Sum ────────────────────────────────────────────────
  const rawScore = (
    edgeScore * 0.40 +
    consistencyScore * 0.35 +
    riskScore * 0.25
  ) * 100

  // ── Confidence Multiplier ───────────────────────────────────────
  // More trades = more statistical confidence in the score.
  const confidence = Math.min(1.0, tradeCountAll / 50)
  return Math.min(Math.round(rawScore * confidence), 100)
}

/**
 * Calculate bot score from parsed activity trades.
 * Score 0-100, threshold >= 60 = likely bot.
 */
function calculateBotScore(
  trades: { timestamp: number; size: number; price: number; usdValue: number; side: 'BUY' | 'SELL' }[]
): number {
  if (trades.length < 5) return 0

  let score = 0

  // 1. Trade frequency (0-25 points) — trades per active day
  const tradeDays = new Set<string>()
  for (const t of trades) {
    if (t.timestamp > 0) tradeDays.add(new Date(t.timestamp * 1000).toISOString().slice(0, 10))
  }
  const freq = tradeDays.size > 0 ? trades.length / tradeDays.size : 0
  if (freq >= 50) score += 25
  else if (freq >= 20) score += 20
  else if (freq >= 10) score += 15
  else if (freq >= 5) score += 8

  // 2. Low time variance (0-25 points) — circular variance of hour-of-day
  const hoursOfDay: number[] = []
  for (const t of trades) {
    if (t.timestamp > 0) {
      const d = new Date(t.timestamp * 1000)
      hoursOfDay.push(d.getUTCHours() + d.getUTCMinutes() / 60)
    }
  }
  if (hoursOfDay.length >= 5) {
    let sinSum = 0, cosSum = 0
    for (const h of hoursOfDay) {
      const angle = (h / 24) * 2 * Math.PI
      sinSum += Math.sin(angle)
      cosSum += Math.cos(angle)
    }
    const R = Math.sqrt((sinSum / hoursOfDay.length) ** 2 + (cosSum / hoursOfDay.length) ** 2)
    const circularVarianceHours = (1 - R) * 12
    if (circularVarianceHours <= 0.5) score += 25
    else if (circularVarianceHours <= 1) score += 20
    else if (circularVarianceHours <= 2) score += 15
    else if (circularVarianceHours <= 4) score += 8
  }

  // 3. Night trading ratio (0-20 points) — % of trades between 1am-6am UTC
  const nightTrades = hoursOfDay.filter(h => h >= 1 && h < 6).length
  const nightRatio = hoursOfDay.length > 0 ? (nightTrades / hoursOfDay.length) * 100 : 0
  if (nightRatio >= 40) score += 20
  else if (nightRatio >= 30) score += 15
  else if (nightRatio >= 20) score += 10
  else if (nightRatio >= 10) score += 5

  // 4. Consistent position sizing (0-15 points) — coefficient of variation %
  const sizes = trades.filter(t => t.usdValue > 0).map(t => t.usdValue)
  if (sizes.length >= 5) {
    const sizeMean = sizes.reduce((a, b) => a + b, 0) / sizes.length
    if (sizeMean > 0) {
      const sizeStd = Math.sqrt(sizes.reduce((sum, s) => sum + (s - sizeMean) ** 2, 0) / sizes.length)
      const cv = (sizeStd / sizeMean) * 100
      if (cv <= 10) score += 15
      else if (cv <= 20) score += 12
      else if (cv <= 30) score += 8
      else if (cv <= 50) score += 4
    }
  }

  // 5. Short hold duration proxy (0-15 points) — avg time between consecutive trades
  const sortedTimestamps = trades.map(t => t.timestamp).filter(t => t > 0).sort((a, b) => a - b)
  if (sortedTimestamps.length >= 2) {
    let totalInterval = 0
    for (let i = 1; i < sortedTimestamps.length; i++) {
      totalInterval += sortedTimestamps[i] - sortedTimestamps[i - 1]
    }
    const avgIntervalHours = (totalInterval / (sortedTimestamps.length - 1)) / 3600
    if (avgIntervalHours <= 2) score += 15
    else if (avgIntervalHours <= 6) score += 12
    else if (avgIntervalHours <= 12) score += 8
    else if (avgIntervalHours <= 24) score += 4
  }

  return Math.min(100, score)
}

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
    maxDrawdownAmount: number
  },
  metrics7d: TimePeriodMetrics,
  metrics30d: TimePeriodMetrics,
  metricsAll: TimePeriodMetrics,
  activePositionCount: number,
  closedPositionCount: number,
  topCategory?: string,
  copyMetrics?: {
    profitFactor30d: number
    profitFactorAll: number
    diffWinRate30d: number
    diffWinRateAll: number
    weeklyProfitRate: number
    copyScore: number
    avgTradesPerDay: number
    medianProfitPct: number | null
  },
  currentBalance?: number,
  isBot?: boolean,
  profile?: any,
  cachedPositionsJson?: string,
) {
  try {
    await supabase.from('wallets').update({
      // Profile info
      ...(profile && (profile.name || profile.pseudonym) && {
        username: profile.name || profile.pseudonym,
      }),
      ...(profile?.createdAt && { account_created_at: profile.createdAt }),
      // Balance
      ...(currentBalance != null && currentBalance > 0 && { balance: currentBalance }),
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
      // All-time period metrics
      pnl_all: metricsAll.pnl,
      roi_all: metricsAll.roi,
      win_rate_all: metricsAll.winRate,
      volume_all: metricsAll.volume,
      trade_count_all: metricsAll.tradeCount,
      drawdown_all: metricsAll.drawdown,
      drawdown_amount_all: metricsAll.drawdownAmount,
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
      ...(topCategory && { top_category: topCategory }),
      // Bot detection
      ...(isBot != null && { is_bot: isBot }),
      // Copy-trade metrics
      ...(copyMetrics && {
        profit_factor_30d: copyMetrics.profitFactor30d,
        profit_factor_all: copyMetrics.profitFactorAll,
        diff_win_rate_30d: copyMetrics.diffWinRate30d,
        diff_win_rate_all: copyMetrics.diffWinRateAll,
        weekly_profit_rate: copyMetrics.weeklyProfitRate,
        copy_score: copyMetrics.copyScore,
        avg_trades_per_day: copyMetrics.avgTradesPerDay,
        median_profit_pct: copyMetrics.medianProfitPct,
      }),
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('address', address)

    // Cache positions separately (column may not exist yet - fails silently)
    if (cachedPositionsJson) {
      await supabase.from('wallets').update({
        cached_positions_json: cachedPositionsJson,
      }).eq('address', address).then(() => {}, () => {})
    }
  } catch (error) {
    console.error('Error updating wallet metrics:', error)
  }
}
