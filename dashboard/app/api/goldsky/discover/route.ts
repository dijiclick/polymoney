import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTraderMetricsWithCopyScore } from '@/lib/goldsky-api'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/goldsky/discover
 *
 * Discovers wallets with $100+ trades from Polymarket CLOB API,
 * then immediately analyzes each with Goldsky subgraphs.
 *
 * Returns SSE stream with progress events.
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
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

      try {
        send({ type: 'phase', phase: 'discovering', message: 'Fetching recent trades from Polymarket...' })

        // Step 1: Discover wallets from Polymarket CLOB API
        const discoveredAddresses = await discoverWalletsFromPolymarket()

        send({
          type: 'discovered',
          total: discoveredAddresses.length,
          message: `Found ${discoveredAddresses.length} wallets with $100+ trades`,
        })

        if (discoveredAddresses.length === 0) {
          send({ type: 'done', discovered: 0, analyzed: 0, skipped: 0 })
          controller.close()
          return
        }

        // Step 2: Filter out already-known wallets
        const { data: existing } = await supabase
          .from('goldsky_wallets')
          .select('address, metrics_updated_at')

        const existingMap = new Map<string, string | null>()
        for (const w of existing || []) {
          existingMap.set(w.address.toLowerCase(), w.metrics_updated_at)
        }

        // Filter: new wallets + stale wallets (>24h old)
        const now = Date.now()
        const STALE_MS = 24 * 60 * 60 * 1000
        const toAnalyze = discoveredAddresses.filter(addr => {
          const lower = addr.toLowerCase()
          const lastUpdated = existingMap.get(lower)
          if (!lastUpdated) return true // New wallet
          return (now - new Date(lastUpdated).getTime()) > STALE_MS // Stale
        })

        const skipped = discoveredAddresses.length - toAnalyze.length

        send({
          type: 'phase',
          phase: 'analyzing',
          toAnalyze: toAnalyze.length,
          skipped,
          message: `Analyzing ${toAnalyze.length} wallets with Goldsky (${skipped} skipped, already fresh)`,
        })

        // Step 3: Analyze each wallet with Goldsky and store
        let analyzed = 0
        let failed = 0

        for (let i = 0; i < toAnalyze.length; i++) {
          if (abortSignal.aborted) {
            send({ type: 'aborted', analyzed, failed })
            controller.close()
            return
          }

          const address = toAnalyze[i]
          try {
            const metrics = await getTraderMetricsWithCopyScore(address)

            // Fetch username from Gamma API and balance from Polymarket Data API
            let username: string | null = null
            let balance = 0

            try {
              const profileRes = await fetch(
                `https://gamma-api.polymarket.com/public-profile?address=${address}`,
                { signal: AbortSignal.timeout(5000) }
              )
              if (profileRes.ok) {
                const profile = await profileRes.json()
                username = profile?.name || profile?.pseudonym || null
              }
            } catch {
              // Profile fetch failed, not critical
            }

            // Fetch portfolio value from Polymarket Data API
            try {
              const valueRes = await fetch(
                `https://data-api.polymarket.com/value?user=${address}`,
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

            // Upsert into goldsky_wallets
            await supabase.from('goldsky_wallets').upsert({
              address: address.toLowerCase(),
              source: 'goldsky',
              username,
              balance,
              balance_updated_at: new Date().toISOString(),
              // 7d
              pnl_7d: metrics.pnl7d,
              roi_7d: metrics.roi7d,
              win_rate_7d: metrics.winRate7d,
              volume_7d: metrics.volume7d,
              trade_count_7d: metrics.tradeCount7d,
              drawdown_7d: metrics.drawdown7d,
              // 30d
              pnl_30d: metrics.pnl30d,
              roi_30d: metrics.roi30d,
              win_rate_30d: metrics.winRate30d,
              volume_30d: metrics.volume30d,
              trade_count_30d: metrics.tradeCount30d,
              drawdown_30d: metrics.drawdown30d,
              // All-time
              pnl_all: metrics.totalPnl,
              roi_all: metrics.roiAll,
              win_rate_all: metrics.winRateAll,
              volume_all: metrics.volumeAll,
              trade_count_all: metrics.tradeCountAll,
              drawdown_all: metrics.drawdownAll,
              drawdown_amount_all: metrics.drawdownAmountAll,
              // Position counts
              total_positions: metrics.closedPositions,
              active_positions: metrics.openPositions,
              total_wins: metrics.winningPositions,
              total_losses: metrics.losingPositions,
              // PnL
              realized_pnl: metrics.realizedPnl,
              unrealized_pnl: metrics.unrealizedPnl,
              overall_pnl: metrics.totalPnl,
              overall_roi: metrics.roiAll,
              overall_win_rate: metrics.winRateAll,
              total_volume: metrics.volumeAll,
              total_trades: metrics.tradeCountAll,
              // Copy-trade
              profit_factor_30d: metrics.profitFactor30d,
              profit_factor_all: metrics.profitFactorAll,
              weekly_profit_rate: metrics.weeklyProfitRate,
              copy_score: metrics.copyScore,
              avg_trades_per_day: metrics.avgTradesPerDay,
              median_profit_pct: metrics.medianProfitPct,
              // Meta
              metrics_updated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: 'address' })

            analyzed++
            send({
              type: 'progress',
              current: i + 1,
              total: toAnalyze.length,
              analyzed,
              failed,
              address,
              username,
              balance,
              copyScore: metrics.copyScore,
              pnl: metrics.totalPnl,
            })
          } catch (err) {
            failed++
            send({
              type: 'progress',
              current: i + 1,
              total: toAnalyze.length,
              analyzed,
              failed,
              address,
              error: err instanceof Error ? err.message : 'Unknown error',
            })
          }
        }

        send({ type: 'done', discovered: discoveredAddresses.length, analyzed, failed, skipped })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Discovery failed' })
      }

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

/**
 * Discover wallets with $100+ trades from Polymarket CLOB API.
 * Fetches recent trades from active markets and extracts unique addresses.
 */
async function discoverWalletsFromPolymarket(): Promise<string[]> {
  const addresses = new Set<string>()

  try {
    // Fetch active markets from Gamma API
    const marketsRes = await fetch(
      'https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false',
      { signal: AbortSignal.timeout(15000) }
    )
    if (!marketsRes.ok) throw new Error(`Gamma API error: ${marketsRes.status}`)

    const events = await marketsRes.json()
    if (!Array.isArray(events)) return []

    // Collect token IDs from active markets
    const tokenIds: string[] = []
    for (const event of events) {
      const markets = event.markets || []
      for (const market of markets) {
        if (market.clobTokenIds) {
          // clobTokenIds is a JSON string like "[\"id1\",\"id2\"]"
          try {
            const ids = typeof market.clobTokenIds === 'string'
              ? JSON.parse(market.clobTokenIds)
              : market.clobTokenIds
            if (Array.isArray(ids)) tokenIds.push(...ids)
          } catch {
            // Skip malformed token IDs
          }
        }
      }
    }

    // Fetch trades for each token ID from CLOB API
    // Process in batches to avoid overwhelming the API
    const BATCH_SIZE = 5
    for (let i = 0; i < Math.min(tokenIds.length, 40); i += BATCH_SIZE) {
      const batch = tokenIds.slice(i, i + BATCH_SIZE)
      const promises = batch.map(tokenId => fetchTradesForToken(tokenId, addresses))
      await Promise.all(promises)

      // Small delay between batches
      if (i + BATCH_SIZE < tokenIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
  } catch (err) {
    console.error('Error discovering wallets from Polymarket:', err)
  }

  return Array.from(addresses)
}

async function fetchTradesForToken(tokenId: string, addresses: Set<string>): Promise<void> {
  try {
    const url = `https://clob.polymarket.com/trades?asset_id=${tokenId}&limit=100`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return

    const data = await res.json()
    const trades = Array.isArray(data) ? data : (data?.trades || data?.data || [])

    for (const trade of trades) {
      // Calculate USD value: size * price
      const size = parseFloat(trade.size || '0')
      const price = parseFloat(trade.price || '0')
      const usdValue = size * price

      if (usdValue >= 100) {
        // Extract maker and taker addresses
        const maker = trade.maker_address || trade.maker || ''
        const taker = trade.taker_address || trade.taker || ''

        if (maker && /^0x[a-fA-F0-9]{40}$/.test(maker)) addresses.add(maker.toLowerCase())
        if (taker && /^0x[a-fA-F0-9]{40}$/.test(taker)) addresses.add(taker.toLowerCase())
      }
    }
  } catch {
    // Individual token trade fetch failed, continue
  }
}
