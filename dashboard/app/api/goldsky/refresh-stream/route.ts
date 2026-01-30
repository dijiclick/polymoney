import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTraderMetricsWithCopyScore } from '@/lib/goldsky-api'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/goldsky/refresh-stream
 * SSE endpoint for streaming Goldsky wallet refresh progress.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const abortSignal = request.signal

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      // Fetch all goldsky wallet addresses (paginate past 1000-row default)
      const allWallets: { address: string; username: string | null }[] = []
      const PAGE_SIZE = 1000
      let offset = 0

      while (true) {
        const { data, error } = await supabase
          .from('goldsky_wallets')
          .select('address, username')
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) {
          send({ type: 'error', message: error.message })
          controller.close()
          return
        }
        if (!data || data.length === 0) break
        allWallets.push(...data)
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      if (allWallets.length === 0) {
        send({ type: 'error', message: 'No goldsky wallets found' })
        controller.close()
        return
      }

      const total = allWallets.length
      send({ type: 'start', total })

      let success = 0
      let failed = 0

      for (let i = 0; i < total; i++) {
        if (abortSignal.aborted) {
          send({ type: 'aborted', current: i, total, success, failed })
          controller.close()
          return
        }

        const wallet = allWallets[i]
        let ok = false
        let errorMsg: string | undefined

        try {
          const metrics = await getTraderMetricsWithCopyScore(wallet.address)

          // Fetch username if needed
          let username = wallet.username
          if (!username) {
            try {
              const profileRes = await fetch(
                `https://gamma-api.polymarket.com/public-profile?address=${wallet.address}`,
                { signal: AbortSignal.timeout(5000) }
              )
              if (profileRes.ok) {
                const profile = await profileRes.json()
                username = profile?.name || profile?.pseudonym || null
              }
            } catch {
              // Not critical
            }
          }

          await supabase.from('goldsky_wallets').upsert({
            address: wallet.address.toLowerCase(),
            source: 'goldsky',
            username,
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

          ok = true
          success++
        } catch (err) {
          failed++
          errorMsg = err instanceof Error ? err.message : 'Unknown error'
        }

        send({
          type: 'progress',
          current: i + 1,
          total,
          success,
          failed,
          address: wallet.address,
          username: wallet.username || undefined,
          ok,
          error: errorMsg,
        })
      }

      send({ type: 'done', total, success, failed })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
