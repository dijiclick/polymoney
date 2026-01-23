import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getFullTraderData,
  parsePositions,
  parseClosedPositions,
  calculateMetrics,
  isValidEthAddress,
} from '@/lib/polymarket-api'
import { TraderProfileResponse, TraderFetchError } from '@/lib/types/trader'

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

  // 2. Check database for cached data
  const { data: dbTrader } = await supabase
    .from('traders')
    .select('*')
    .eq('address', address)
    .single()

  // 3. Check if cached data is fresh enough
  const isFresh = dbTrader?.last_updated_at &&
    Date.now() - new Date(dbTrader.last_updated_at).getTime() < CACHE_DURATION_MS

  // 4. If fresh cached data and no force refresh, return it
  if (dbTrader && isFresh && !forceRefresh) {
    // Also fetch positions from DB
    const { data: dbPositions } = await supabase
      .from('trader_positions')
      .select('*')
      .eq('address', address)
      .order('current_value', { ascending: false })

    const response: TraderProfileResponse = {
      source: 'database',
      dataFreshness: 'cached',
      cachedAt: dbTrader.last_updated_at,
      address,
      username: dbTrader.username,
      profileImage: dbTrader.profile_image,
      positions: (dbPositions || []).map((p) => ({
        conditionId: p.condition_id,
        asset: p.asset_id || '',
        marketSlug: p.market_slug,
        title: p.market_title,
        outcome: p.outcome,
        outcomeIndex: p.outcome_index || 0,
        size: p.size || 0,
        avgPrice: p.avg_price || 0,
        currentPrice: p.current_price || 0,
        initialValue: p.initial_value || 0,
        currentValue: p.current_value || 0,
        cashPnl: p.pnl || 0,
        percentPnl: p.pnl_percent || 0,
      })),
      closedPositionsCount: dbTrader.closed_positions_alltime || 0,
      metrics: {
        portfolioValue: dbTrader.portfolio_value || 0,
        totalPnl: dbTrader.total_pnl || 0,
        unrealizedPnl: dbTrader.unrealized_pnl || 0,
        realizedPnl: dbTrader.realized_pnl || 0,
        winRate30d: dbTrader.win_rate_30d || 0,
        winRateAllTime: dbTrader.win_rate_alltime || 0,
        roiPercent: dbTrader.roi_percent || 0,
        tradeCount30d: dbTrader.trade_count_30d || 0,
        tradeCountAllTime: dbTrader.trade_count_alltime || 0,
        uniqueMarkets30d: dbTrader.unique_markets_30d || 0,
        accountAgeDays: dbTrader.account_age_days,
        positionConcentration: dbTrader.position_concentration || 0,
        maxPositionSize: dbTrader.max_position_size || 0,
        avgPositionSize: dbTrader.avg_position_size || 0,
        activePositions: dbTrader.active_positions || 0,
        totalPositions: dbTrader.total_positions || 0,
        maxDrawdown: dbTrader.max_drawdown || 0,
        tradeFrequency: dbTrader.trade_frequency || 0,
        nightTradeRatio: dbTrader.night_trade_ratio || 0,
      },
      scores: dbTrader.copytrade_score !== null ? {
        copytradeScore: dbTrader.copytrade_score || 0,
        botScore: dbTrader.bot_score || 0,
        insiderScore: dbTrader.insider_score || 0,
        insiderLevel: dbTrader.insider_level,
        insiderRedFlags: dbTrader.insider_red_flags,
        primaryClassification: dbTrader.primary_classification,
      } : undefined,
      isNewlyFetched: false,
      lastUpdatedAt: dbTrader.last_updated_at,
    }

    return NextResponse.json(response)
  }

  // 5. Fetch from Polymarket API
  try {
    const liveData = await getFullTraderData(address)

    // 6. Parse and calculate metrics
    const positions = parsePositions(liveData.positions)
    const closedPositions = parseClosedPositions(liveData.closedPositions)
    const metrics = calculateMetrics(
      liveData.portfolioValue,
      positions,
      closedPositions,
      liveData.activity
    )

    // 7. Cache to database (don't await, run in background)
    cacheTraderData(address, metrics, positions, closedPositions)

    // 8. Build response
    const response: TraderProfileResponse = {
      source: dbTrader ? 'mixed' : 'live',
      dataFreshness: 'fresh',
      address,
      username: dbTrader?.username,
      profileImage: dbTrader?.profile_image,
      positions,
      closedPositionsCount: closedPositions.length,
      metrics,
      scores: dbTrader?.copytrade_score !== null && dbTrader?.copytrade_score !== undefined ? {
        copytradeScore: dbTrader.copytrade_score || 0,
        botScore: dbTrader.bot_score || 0,
        insiderScore: dbTrader.insider_score || 0,
        insiderLevel: dbTrader.insider_level,
        insiderRedFlags: dbTrader.insider_red_flags,
        primaryClassification: dbTrader.primary_classification,
      } : undefined,
      isNewlyFetched: true,
      lastUpdatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching trader data:', error)

    // If API fails but we have stale cached data, return it with warning
    if (dbTrader) {
      const { data: dbPositions } = await supabase
        .from('trader_positions')
        .select('*')
        .eq('address', address)
        .order('current_value', { ascending: false })

      const response: TraderProfileResponse = {
        source: 'database',
        dataFreshness: 'stale',
        cachedAt: dbTrader.last_updated_at,
        address,
        username: dbTrader.username,
        profileImage: dbTrader.profile_image,
        positions: (dbPositions || []).map((p) => ({
          conditionId: p.condition_id,
          asset: p.asset_id || '',
          marketSlug: p.market_slug,
          title: p.market_title,
          outcome: p.outcome,
          outcomeIndex: p.outcome_index || 0,
          size: p.size || 0,
          avgPrice: p.avg_price || 0,
          currentPrice: p.current_price || 0,
          initialValue: p.initial_value || 0,
          currentValue: p.current_value || 0,
          cashPnl: p.pnl || 0,
          percentPnl: p.pnl_percent || 0,
        })),
        closedPositionsCount: dbTrader.closed_positions_alltime || 0,
        metrics: {
          portfolioValue: dbTrader.portfolio_value || 0,
          totalPnl: dbTrader.total_pnl || 0,
          unrealizedPnl: dbTrader.unrealized_pnl || 0,
          realizedPnl: dbTrader.realized_pnl || 0,
          winRate30d: dbTrader.win_rate_30d || 0,
          winRateAllTime: dbTrader.win_rate_alltime || 0,
          roiPercent: dbTrader.roi_percent || 0,
          tradeCount30d: dbTrader.trade_count_30d || 0,
          tradeCountAllTime: dbTrader.trade_count_alltime || 0,
          uniqueMarkets30d: dbTrader.unique_markets_30d || 0,
          accountAgeDays: dbTrader.account_age_days,
          positionConcentration: dbTrader.position_concentration || 0,
          maxPositionSize: dbTrader.max_position_size || 0,
          avgPositionSize: dbTrader.avg_position_size || 0,
          activePositions: dbTrader.active_positions || 0,
          totalPositions: dbTrader.total_positions || 0,
          maxDrawdown: dbTrader.max_drawdown || 0,
          tradeFrequency: dbTrader.trade_frequency || 0,
          nightTradeRatio: dbTrader.night_trade_ratio || 0,
        },
        scores: dbTrader.copytrade_score !== null ? {
          copytradeScore: dbTrader.copytrade_score || 0,
          botScore: dbTrader.bot_score || 0,
          insiderScore: dbTrader.insider_score || 0,
          insiderLevel: dbTrader.insider_level,
          insiderRedFlags: dbTrader.insider_red_flags,
          primaryClassification: dbTrader.primary_classification,
        } : undefined,
        isNewlyFetched: false,
        lastUpdatedAt: dbTrader.last_updated_at,
        warning: 'Live data unavailable, showing cached data',
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
 * Cache trader data to Supabase (runs in background)
 */
async function cacheTraderData(
  address: string,
  metrics: TraderProfileResponse['metrics'],
  positions: TraderProfileResponse['positions'],
  closedPositions: { conditionId: string; title?: string; outcome?: string; realizedPnl: number; isWin: boolean }[]
) {
  try {
    // Upsert trader metrics
    await supabase.from('traders').upsert({
      address,
      portfolio_value: metrics.portfolioValue,
      total_pnl: metrics.totalPnl,
      unrealized_pnl: metrics.unrealizedPnl,
      realized_pnl: metrics.realizedPnl,
      win_rate_30d: metrics.winRate30d,
      win_rate_alltime: metrics.winRateAllTime,
      roi_percent: metrics.roiPercent,
      trade_count_30d: metrics.tradeCount30d,
      trade_count_alltime: metrics.tradeCountAllTime,
      unique_markets_30d: metrics.uniqueMarkets30d,
      position_concentration: metrics.positionConcentration,
      max_position_size: metrics.maxPositionSize,
      avg_position_size: metrics.avgPositionSize,
      active_positions: metrics.activePositions,
      total_positions: metrics.totalPositions,
      max_drawdown: metrics.maxDrawdown,
      trade_frequency: metrics.tradeFrequency,
      night_trade_ratio: metrics.nightTradeRatio,
      closed_positions_alltime: closedPositions.length,
      last_updated_at: new Date().toISOString(),
    }, {
      onConflict: 'address',
    })

    // Delete old positions and insert new ones
    await supabase.from('trader_positions').delete().eq('address', address)

    if (positions.length > 0) {
      await supabase.from('trader_positions').insert(
        positions.map((p) => ({
          address,
          condition_id: p.conditionId,
          asset_id: p.asset,
          market_slug: p.marketSlug,
          market_title: p.title,
          outcome: p.outcome,
          outcome_index: p.outcomeIndex,
          size: p.size,
          avg_price: p.avgPrice,
          current_price: p.currentPrice,
          initial_value: p.initialValue,
          current_value: p.currentValue,
          pnl: p.cashPnl,
          pnl_percent: p.percentPnl,
        }))
      )
    }
  } catch (error) {
    console.error('Error caching trader data:', error)
  }
}
