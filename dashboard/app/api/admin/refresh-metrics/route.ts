import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTraderMetrics } from '@/lib/goldsky-api'
import { getProfile, getPortfolioValue, getPositions, parsePositions } from '@/lib/polymarket-api'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * POST /api/admin/refresh-metrics
 *
 * Batch refresh wallet metrics. Supports:
 * - ?limit=10 - refresh top N wallets by balance
 * - ?address=0x... - refresh specific wallet
 * - ?all=true - refresh all wallets (use with caution)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const limit = parseInt(searchParams.get('limit') || '10')
  const specificAddress = searchParams.get('address')
  const refreshAll = searchParams.get('all') === 'true'

  let query = supabase.from('wallets').select('address, username')

  if (specificAddress) {
    query = query.eq('address', specificAddress.toLowerCase())
  } else if (!refreshAll) {
    query = query.order('balance', { ascending: false }).limit(limit)
  }

  const { data: wallets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ message: 'No wallets found' })
  }

  const results: { address: string; username?: string; success: boolean; error?: string }[] = []

  for (const wallet of wallets) {
    try {
      // Fetch fresh data
      const [metrics, profile, portfolioValue, rawPositions] = await Promise.all([
        getTraderMetrics(wallet.address, 30),
        getProfile(wallet.address).catch(() => ({})),
        getPortfolioValue(wallet.address).catch(() => 0),
        getPositions(wallet.address).catch(() => []),
      ])

      const positions = parsePositions(rawPositions)

      // Update database
      const { error: updateError } = await supabase.from('wallets').update({
        username: (profile as any).name || (profile as any).pseudonym || wallet.username,
        account_created_at: (profile as any).createdAt,
        balance: portfolioValue,
        // 7-day metrics
        pnl_7d: metrics.pnl7d,
        roi_7d: metrics.roi7d,
        win_rate_7d: metrics.winRate7d,
        volume_7d: metrics.volume7d,
        trade_count_7d: metrics.tradeCount7d,
        drawdown_7d: metrics.drawdown7d,
        // 30-day metrics
        pnl_30d: metrics.pnl30d,
        roi_30d: metrics.roi30d,
        win_rate_30d: metrics.winRate30d,
        volume_30d: metrics.volume30d,
        trade_count_30d: metrics.tradeCount30d,
        drawdown_30d: metrics.drawdown30d,
        // Overall metrics
        total_positions: metrics.closedPositions,
        active_positions: positions.length,
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
      }).eq('address', wallet.address)

      if (updateError) {
        results.push({ address: wallet.address, username: wallet.username, success: false, error: updateError.message })
      } else {
        results.push({ address: wallet.address, username: wallet.username, success: true })
      }
    } catch (err) {
      results.push({
        address: wallet.address,
        username: wallet.username,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  return NextResponse.json({
    summary: {
      total: results.length,
      success: successCount,
      failed: failedCount,
    },
    results,
  })
}

/**
 * GET /api/admin/refresh-metrics
 * Returns current refresh status / wallet count
 */
export async function GET() {
  const { count, error } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    totalWallets: count,
    estimatedTimeMinutes: Math.ceil((count || 0) * 2 / 60), // ~2 seconds per wallet
    usage: {
      refreshTop10: 'POST /api/admin/refresh-metrics?limit=10',
      refreshAll: 'POST /api/admin/refresh-metrics?all=true',
      refreshOne: 'POST /api/admin/refresh-metrics?address=0x...',
    }
  })
}
