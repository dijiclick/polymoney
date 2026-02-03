import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActivity, getClosedPositions, getPositions, getPortfolioValue, parseTrades, parsePositions, parseClosedPositions } from '@/lib/polymarket-api'
import { runSimulation } from '@/lib/simulation/engine'
import { SimulationConfig, DEFAULT_SLIPPAGE_PARAMS, SimulationResult } from '@/lib/simulation/types'
import crypto from 'crypto'

// Use service role for write operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

function hashTrades(trades: unknown[]): string {
  const data = JSON.stringify(trades.map((t: any) => t.timestamp).sort())
  return crypto.createHash('md5').update(data).digest('hex')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      address,
      startingCapital = 1000,
      delaySeconds = 2,
      timePeriodDays = 30,
      slippageParams,
      maxPositionPct = 20,
      forceRefresh = false,
    } = body

    // Validate
    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }
    if (startingCapital <= 0 || startingCapital > 1000000) {
      return NextResponse.json({ error: 'Starting capital must be between $1 and $1,000,000' }, { status: 400 })
    }
    if (delaySeconds < 0 || delaySeconds > 60) {
      return NextResponse.json({ error: 'Delay must be between 0 and 60 seconds' }, { status: 400 })
    }

    const config: SimulationConfig = {
      address: address.toLowerCase(),
      startingCapital,
      delaySeconds,
      timePeriodDays,
      slippageParams: {
        ...DEFAULT_SLIPPAGE_PARAMS,
        delaySeconds,
        ...(slippageParams || {}),
      },
      maxPositionPct,
    }

    // Check cache (unless forceRefresh)
    if (!forceRefresh) {
      try {
        const { data: cached } = await supabase
          .from('copy_simulations')
          .select('*')
          .eq('address', config.address)
          .eq('starting_capital', config.startingCapital)
          .eq('delay_seconds', config.delaySeconds)
          .eq('time_period_days', config.timePeriodDays)
          .order('simulated_at', { ascending: false })
          .limit(1)
          .single()

        if (cached) {
          // Check if cache is recent (< 1 hour old)
          const cacheAge = Date.now() - new Date(cached.simulated_at).getTime()
          if (cacheAge < 60 * 60 * 1000) {
            const result: SimulationResult = {
              config,
              finalCapital: cached.final_capital,
              totalPnl: cached.total_pnl,
              totalRoi: cached.total_roi,
              winRate: cached.win_rate,
              winCount: cached.win_count,
              lossCount: cached.loss_count,
              tradeCount: cached.trade_count,
              skippedTrades: cached.skipped_trades,
              avgSlippage: cached.avg_slippage,
              maxDrawdown: cached.max_drawdown,
              originalPnl: cached.original_pnl,
              originalRoi: cached.original_roi,
              originalWinRate: cached.original_win_rate,
              performanceRatio: cached.performance_ratio,
              trades: cached.trades_json || [],
              positions: cached.positions_json || [],
              equityCurve: cached.equity_curve_json || [],
              unrealizedPnl: cached.unrealized_pnl || 0,
              openPositionCount: cached.open_position_count || 0,
              simulatedAt: cached.simulated_at,
              durationMs: cached.duration_ms,
              totalTradesFetched: cached.total_trades_fetched || 0,
            }
            return NextResponse.json({ result, cached: true })
          }
        }
      } catch {
        // Cache table may not exist yet - continue without cache
      }
    }

    // Fetch data from Polymarket API
    const [activity, rawClosedPositions, rawPositions, portfolioValue] = await Promise.all([
      getActivity(config.address, 10000, config.timePeriodDays),
      getClosedPositions(config.address, 10000, config.timePeriodDays),
      getPositions(config.address, 10000),
      getPortfolioValue(config.address),
    ])

    const trades = parseTrades(activity)
    const closedPositions = parseClosedPositions(rawClosedPositions)

    // Also extract unredeemed losses from open positions (same logic as wallet_discovery)
    const positions = parsePositions(rawPositions)
    const unredeemedLosses = positions.filter(p =>
      p.redeemable === true && p.cashPnl < 0
    ).map(p => ({
      conditionId: p.conditionId,
      title: p.title,
      outcome: p.outcome,
      size: p.size,
      avgPrice: p.avgPrice,
      initialValue: p.initialValue,
      finalPrice: 0,
      realizedPnl: p.cashPnl,
      resolvedAt: p.endDate,
      isWin: false,
    }))

    const allClosedPositions = [...closedPositions, ...unredeemedLosses]

    if (trades.length === 0) {
      return NextResponse.json({
        error: 'No trades found for this wallet in the selected time period',
        tradesFound: 0,
      }, { status: 404 })
    }

    // Run simulation
    const result = runSimulation(config, trades, allClosedPositions, portfolioValue)

    // Cache result in Supabase (non-critical)
    const tradesHash = hashTrades(activity)
    try {
      await supabase.from('copy_simulations').insert({
        address: config.address,
        starting_capital: config.startingCapital,
        delay_seconds: config.delaySeconds,
        time_period_days: config.timePeriodDays,
        slippage_params: config.slippageParams,
        final_capital: result.finalCapital,
        total_pnl: result.totalPnl,
        total_roi: result.totalRoi,
        win_rate: result.winRate,
        win_count: result.winCount,
        loss_count: result.lossCount,
        trade_count: result.tradeCount,
        skipped_trades: result.skippedTrades,
        avg_slippage: result.avgSlippage,
        max_drawdown: result.maxDrawdown,
        original_roi: result.originalRoi,
        original_pnl: result.originalPnl,
        original_win_rate: result.originalWinRate,
        performance_ratio: result.performanceRatio,
        unrealized_pnl: result.unrealizedPnl,
        open_position_count: result.openPositionCount,
        trades_json: result.trades,
        positions_json: result.positions,
        equity_curve_json: result.equityCurve,
        simulated_at: result.simulatedAt,
        duration_ms: result.durationMs,
        total_trades_fetched: result.totalTradesFetched,
        trades_hash: tradesHash,
      })
    } catch {
      // Cache failure is non-critical
    }

    return NextResponse.json({ result, cached: false })
  } catch (error) {
    console.error('Simulation error:', error)
    return NextResponse.json(
      { error: 'Simulation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
