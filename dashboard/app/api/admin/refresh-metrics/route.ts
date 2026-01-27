import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getProfile,
  getPortfolioValue,
  getPositions,
  getClosedPositions,
  parsePositions,
  parseClosedPositions,
} from '@/lib/polymarket-api'
import { TimePeriodMetrics } from '@/lib/types/trader'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Trade grouping for metrics calculation
 */
interface Trade {
  conditionId: string
  totalPnl: number
  totalBought: number
  isResolved: boolean
  outcomes: Set<string>
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

  // Convert to trades
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
      // Single outcome - each entry is a separate trade
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
 * Calculate max drawdown from equity curve.
 * Tracks balance starting from initialBalance, adding realized PnL
 * for each position chronologically.
 * Max Drawdown = (peak - trough) / peak * 100
 */
function calculateMaxDrawdown(
  closedPositions: { realizedPnl: number; resolvedAt?: string }[],
  initialBalance: number = 0,
): number {
  const sortedPositions = [...closedPositions]
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (sortedPositions.length === 0) return 0

  let balance = initialBalance
  let maxBalance = initialBalance
  let maxDrawdownPercent = 0

  for (const position of sortedPositions) {
    balance += position.realizedPnl
    if (balance > maxBalance) maxBalance = balance
    if (maxBalance > 0) {
      const drawdownPercent = ((maxBalance - balance) / maxBalance) * 100
      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent
      }
    }
  }

  return Math.min(Math.round(maxDrawdownPercent * 100) / 100, 100)
}

/**
 * Calculate period-based metrics (7d, 30d) from closed positions
 */
function calculatePeriodMetrics(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number; isWin: boolean; resolvedAt?: string }[],
  days: number,
  currentBalance: number = 0
): TimePeriodMetrics {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoffMs = cutoffDate.getTime()

  const periodPositions = closedPositions.filter(p => {
    if (!p.resolvedAt) return false
    return new Date(p.resolvedAt).getTime() >= cutoffMs
  })

  if (periodPositions.length === 0) {
    return { pnl: 0, roi: 0, volume: 0, tradeCount: 0, winRate: 0, drawdown: 0 }
  }

  const pnl = periodPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
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

  // ROI = Period PnL / Period Volume (capital deployed in this period)
  const roi = volume > 0 ? (pnl / volume) * 100 : 0
  // Use max(estimated_start, current_balance) to avoid near-zero base from withdrawals
  const initialBalance = Math.max(currentBalance - pnl, currentBalance, 1)
  const drawdown = calculateMaxDrawdown(periodPositions, initialBalance)

  return {
    pnl: Math.round(pnl * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    tradeCount,
    winRate: Math.round(winRate * 100) / 100,
    drawdown,
  }
}

/**
 * Calculate all metrics from Polymarket positions data
 */
function calculatePolymarketMetrics(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number; isWin: boolean; resolvedAt?: string }[],
  allPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; cashPnl: number; currentValue: number }[],
  currentBalance: number = 0
) {
  const trades = groupPositionsIntoTrades(closedPositions, allPositions)

  let realizedPnl = 0
  let unrealizedPnl = 0
  let totalBoughtResolved = 0
  let winCount = 0
  let lossCount = 0
  let activeTradeCount = 0

  for (const trade of trades) {
    if (trade.isResolved) {
      realizedPnl += trade.totalPnl
      totalBoughtResolved += trade.totalBought
      if (trade.totalPnl > 0) winCount++
      else lossCount++
    } else {
      unrealizedPnl += trade.totalPnl
      activeTradeCount++
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl
  const tradeCount = winCount + lossCount
  // ROI = Total PnL / Total Capital Deployed (totalBoughtResolved)
  // More reliable than initialBalance which can be negative when users withdraw profits
  const roiAll = totalBoughtResolved > 0 ? (totalPnl / totalBoughtResolved) * 100 : 0
  const winRateAll = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0
  // Use max(estimated_start, current_balance) to avoid near-zero base from withdrawals
  const drawdownBase = Math.max(currentBalance - totalPnl, currentBalance, 1)
  const maxDrawdown = calculateMaxDrawdown(closedPositions, drawdownBase)

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
 * POST /api/admin/refresh-metrics
 *
 * Batch refresh wallet metrics using Polymarket API. Supports:
 * - ?limit=10 - refresh top N wallets by balance
 * - ?address=0x... - refresh specific wallet
 * - ?all=true - refresh all wallets (use with caution)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const limit = parseInt(searchParams.get('limit') || '10')
  const specificAddress = searchParams.get('address')
  const refreshAll = searchParams.get('all') === 'true'

  let query = supabase.from('wallets').select('address, username, balance')

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
      // Fetch fresh data from Polymarket API
      const [profile, portfolioValue, rawPositions, rawClosedPositions] = await Promise.all([
        getProfile(wallet.address).catch(() => ({})),
        getPortfolioValue(wallet.address).catch(() => wallet.balance || 0),
        getPositions(wallet.address).catch(() => []),
        getClosedPositions(wallet.address).catch(() => []),
      ])

      // Parse positions
      const allPositions = parsePositions(rawPositions)
      const apiClosedPositions = parseClosedPositions(rawClosedPositions)

      // Separate open positions from resolved
      const openPositions = allPositions.filter(p => p.currentValue > 0)
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

      const closedPositions = [...apiClosedPositions, ...additionalResolved]
        .sort((a, b) => {
          const dateA = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
          const dateB = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
          return dateB - dateA
        })

      // Calculate metrics
      const currentBalance = portfolioValue || wallet.balance || 0
      const polymetrics = calculatePolymarketMetrics(closedPositions, allPositions, currentBalance)
      const metrics7d = calculatePeriodMetrics(closedPositions, 7, currentBalance)
      const metrics30d = calculatePeriodMetrics(closedPositions, 30, currentBalance)
      const metricsAll = calculatePeriodMetrics(closedPositions, 36500, currentBalance) // ~100 years = all time

      // Update database
      const { error: updateError } = await supabase.from('wallets').update({
        username: (profile as any).name || (profile as any).pseudonym || wallet.username,
        account_created_at: (profile as any).createdAt,
        balance: portfolioValue,
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
        total_positions: new Set(closedPositions.map((p: any) => p.conditionId).filter(Boolean)).size,
        active_positions: new Set(openPositions.map((p: any) => p.conditionId).filter(Boolean)).size,
        total_wins: polymetrics.winCount,
        total_losses: polymetrics.lossCount,
        realized_pnl: polymetrics.realizedPnl,
        unrealized_pnl: polymetrics.unrealizedPnl,
        overall_pnl: polymetrics.totalPnl,
        overall_roi: polymetrics.roiAll,
        overall_win_rate: polymetrics.winRateAll,
        total_volume: polymetrics.totalBought,
        total_trades: polymetrics.tradeCount,
        // All-time period metrics
        pnl_all: metricsAll.pnl,
        roi_all: metricsAll.roi,
        win_rate_all: metricsAll.winRate,
        volume_all: metricsAll.volume,
        trade_count_all: metricsAll.tradeCount,
        drawdown_all: metricsAll.drawdown,
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
