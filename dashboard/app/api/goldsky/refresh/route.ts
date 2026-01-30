import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTraderMetricsWithCopyScore } from '@/lib/goldsky-api'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * POST /api/goldsky/refresh
 *
 * Refresh wallet metrics using Goldsky subgraphs.
 * - ?address=0x... - refresh specific wallet
 * - ?all=true - refresh all goldsky wallets
 * - ?limit=N - refresh top N wallets by volume that need refreshing
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const specificAddress = searchParams.get('address')
  const refreshAll = searchParams.get('all') === 'true'
  const limit = parseInt(searchParams.get('limit') || '10')

  let query = supabase.from('goldsky_wallets').select('address, username')

  if (specificAddress) {
    query = query.eq('address', specificAddress.toLowerCase())
  } else if (!refreshAll) {
    // Refresh wallets that haven't been updated in >1 hour, ordered by volume
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    query = query
      .or(`metrics_updated_at.is.null,metrics_updated_at.lt.${oneHourAgo}`)
      .order('volume_30d', { ascending: false })
      .limit(limit)
  }

  const { data: wallets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // If specific address not yet in table, treat it as a new wallet to analyze
  let walletsToProcess = wallets || []
  if (specificAddress && walletsToProcess.length === 0) {
    walletsToProcess = [{ address: specificAddress.toLowerCase(), username: null }]
  }

  if (walletsToProcess.length === 0) {
    return NextResponse.json({ message: 'No wallets to refresh' })
  }

  const results: Array<{ address: string; success: boolean; error?: string }> = []

  for (const wallet of walletsToProcess) {
    try {
      const metrics = await getTraderMetricsWithCopyScore(wallet.address)

      // Fetch username from Gamma API and balance from Polymarket Data API
      let username = wallet.username
      let balance = 0

      try {
        const profileRes = await fetch(
          `https://gamma-api.polymarket.com/public-profile?address=${wallet.address}`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (profileRes.ok) {
          const profile = await profileRes.json()
          if (!username) {
            username = profile?.name || profile?.pseudonym || null
          }
        }
      } catch {
        // Not critical
      }

      // Fetch portfolio value from Polymarket Data API
      try {
        const valueRes = await fetch(
          `https://data-api.polymarket.com/value?user=${wallet.address}`,
          { signal: AbortSignal.timeout(5000) }
        )
        if (valueRes.ok) {
          const data = await valueRes.json()
          // API returns array: [{"user": "0x...", "value": 123.45}]
          balance = Array.isArray(data) && data[0]
            ? parseFloat(data[0].value || '0') || 0
            : 0
        }
      } catch {
        // Not critical
      }

      await supabase.from('goldsky_wallets').upsert({
        address: wallet.address.toLowerCase(),
        source: 'goldsky',
        username,
        balance,
        balance_updated_at: new Date().toISOString(),
        pnl_7d: metrics.pnl7d,
        roi_7d: metrics.roi7d,
        win_rate_7d: metrics.winRate7d,
        volume_7d: metrics.volume7d,
        trade_count_7d: metrics.tradeCount7d,
        drawdown_7d: metrics.drawdown7d,
        pnl_30d: metrics.pnl30d,
        roi_30d: metrics.roi30d,
        win_rate_30d: metrics.winRate30d,
        volume_30d: metrics.volume30d,
        trade_count_30d: metrics.tradeCount30d,
        drawdown_30d: metrics.drawdown30d,
        pnl_all: metrics.totalPnl,
        roi_all: metrics.roiAll,
        win_rate_all: metrics.winRateAll,
        volume_all: metrics.volumeAll,
        trade_count_all: metrics.tradeCountAll,
        drawdown_all: metrics.drawdownAll,
        drawdown_amount_all: metrics.drawdownAmountAll,
        total_positions: metrics.closedPositions,
        active_positions: metrics.openPositions,
        total_wins: metrics.winningPositions,
        total_losses: metrics.losingPositions,
        realized_pnl: metrics.realizedPnl,
        unrealized_pnl: metrics.unrealizedPnl,
        overall_pnl: metrics.totalPnl,
        overall_roi: metrics.roiAll,
        overall_win_rate: metrics.winRateAll,
        total_volume: metrics.volumeAll,
        total_trades: metrics.tradeCountAll,
        profit_factor_30d: metrics.profitFactor30d,
        profit_factor_all: metrics.profitFactorAll,
        weekly_profit_rate: metrics.weeklyProfitRate,
        copy_score: metrics.copyScore,
        avg_trades_per_day: metrics.avgTradesPerDay,
        median_profit_pct: metrics.medianProfitPct,
        metrics_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address' })

      results.push({ address: wallet.address, success: true })
    } catch (err) {
      results.push({
        address: wallet.address,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  return NextResponse.json({
    summary: { total: results.length, success: successCount, failed: failedCount },
    results,
  })
}

export async function GET() {
  const { count, error } = await supabase
    .from('goldsky_wallets')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    totalWallets: count,
    usage: {
      refreshOne: 'POST /api/goldsky/refresh?address=0x...',
      refreshAll: 'POST /api/goldsky/refresh?all=true',
      refreshTop: 'POST /api/goldsky/refresh?limit=10',
    },
  })
}
