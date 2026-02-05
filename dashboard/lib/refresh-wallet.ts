import { createClient } from '@supabase/supabase-js'
import {
  getProfile,
  getPortfolioValue,
  getPositions,
  getClosedPositions,
  getActivity,
  parsePositions,
  parseClosedPositions,
  parseTrades,
  fetchEventCategories,
  getTopCategory,
} from '@/lib/polymarket-api'
import { TimePeriodMetrics, PolymarketClosedPosition } from '@/lib/types/trader'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export function getServiceSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

// --- Calculation helpers ---

interface Trade {
  conditionId: string
  totalPnl: number
  totalBought: number
  isResolved: boolean
  outcomes: Set<string>
}

function groupPositionsIntoTrades(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number }[],
  openPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; cashPnl: number; currentValue: number }[]
): Trade[] {
  const marketGroups = new Map<string, {
    outcomes: Map<string, { pnl: number; bought: number; isResolved: boolean }[]>
  }>()

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

  const trades: Trade[] = []

  for (const [conditionId, group] of marketGroups) {
    const outcomeKeys = Array.from(group.outcomes.keys())

    if (outcomeKeys.length > 1) {
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


function calculatePeriodMetrics(
  closedPositions: { conditionId: string; outcome?: string; size: number; avgPrice: number; realizedPnl: number; isWin: boolean; resolvedAt?: string; initialValue?: number }[],
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
    return { pnl: 0, volume: 0, tradeCount: 0, winRate: 0, drawdown: 0, winningPositions: 0, losingPositions: 0 }
  }

  const pnl = periodPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const volume = periodPositions.reduce((sum, p) => sum + (p.size * p.avgPrice), 0)

  const marketPnl = new Map<string, number>()
  for (const p of periodPositions) {
    const cid = p.conditionId || ''
    marketPnl.set(cid, (marketPnl.get(cid) || 0) + p.realizedPnl)
  }

  const tradeCount = marketPnl.size
  let wins = 0
  for (const pnlVal of marketPnl.values()) {
    if (pnlVal > 0) wins++
  }
  const losses = tradeCount - wins
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0

  const avgPositionSize = tradeCount > 0 ? volume / tradeCount : 0
  const initialBalance = Math.max(currentBalance - pnl, currentBalance, avgPositionSize * 3, 1)
  const drawdownResult = calculateMaxDrawdown(periodPositions, initialBalance)

  return {
    pnl: Math.round(pnl * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    tradeCount,
    winRate: Math.round(winRate * 100) / 100,
    drawdown: drawdownResult.percent,
    drawdownAmount: drawdownResult.amount,
    winningPositions: wins,
    losingPositions: losses,
  }
}

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

  const winRateAll = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0
  const avgTradeSize = tradeCount > 0 ? totalBoughtResolved / tradeCount : 0
  const drawdownBase = Math.max(currentBalance - totalPnl, currentBalance, avgTradeSize * 3, 1)
  const maxDrawdownResult = calculateMaxDrawdown(closedPositions, drawdownBase)

  return {
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalBought: Math.round(totalBoughtResolved * 100) / 100,
    winRateAll: Math.round(winRateAll * 100) / 100,
    winCount,
    lossCount,
    tradeCount,
    activeTradeCount,
    maxDrawdown: maxDrawdownResult.percent,
    maxDrawdownAmount: maxDrawdownResult.amount,
  }
}

// --- Copy score calculation helpers ---

function calculateProfitFactor(
  closedPositions: { conditionId: string; realizedPnl: number; resolvedAt?: string }[],
  days?: number
): number {
  const cutoffMs = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0
  const positions = days
    ? closedPositions.filter(p => p.resolvedAt ? new Date(p.resolvedAt).getTime() >= cutoffMs : false)
    : closedPositions

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

function calculateDiffWinRate(
  closedPositions: { conditionId: string; avgPrice: number; realizedPnl: number; resolvedAt?: string }[],
  days?: number
): number {
  const cutoffMs = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0
  const positions = days
    ? closedPositions.filter(p => p.resolvedAt ? new Date(p.resolvedAt).getTime() >= cutoffMs : false)
    : closedPositions

  if (positions.length === 0) return 0

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

function calculateWeeklyProfitRate(
  closedPositions: { realizedPnl: number; resolvedAt?: string }[]
): number {
  const weekPnl = new Map<string, number>()
  for (const p of closedPositions) {
    if (!p.resolvedAt) continue
    const dt = new Date(p.resolvedAt)
    if (isNaN(dt.getTime())) continue
    const startOfYear = new Date(dt.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((dt.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7)
    const key = `${dt.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    weekPnl.set(key, (weekPnl.get(key) || 0) + p.realizedPnl)
  }

  if (weekPnl.size === 0) return 0
  const profitableWeeks = Array.from(weekPnl.values()).filter(v => v > 0).length
  return Math.round((profitableWeeks / weekPnl.size) * 10000) / 100
}

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
  closedPositions: { size: number; avgPrice: number; initialValue?: number; realizedPnl: number }[]
): number | null {
  const profitPcts: number[] = []

  for (const pos of closedPositions) {
    const initialValue = (pos.initialValue && pos.initialValue > 0) ? pos.initialValue : pos.size * pos.avgPrice
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
 * 3-pillar formula: Edge (40%), Consistency (35%), Risk (25%).
 */
function calculateCopyScore(params: {
  profitFactor30d: number
  drawdown30d: number
  weeklyProfitRate: number
  tradeCountAll: number
  medianProfitPct: number | null
  avgTradesPerDay?: number
}): number {
  const { profitFactor30d, drawdown30d, weeklyProfitRate, tradeCountAll, medianProfitPct, avgTradesPerDay } = params

  // Hard filters
  if (tradeCountAll < 30) return 0
  if (profitFactor30d < 1.2) return 0
  if (medianProfitPct == null || medianProfitPct < 5.0) return 0
  if (avgTradesPerDay != null && (avgTradesPerDay < 2 || avgTradesPerDay > 15)) return 0

  // Pillar 1: Edge (40%) — Profit Factor 1.2 → 0, 3.0+ → 1.0
  const edgeScore = Math.min((profitFactor30d - 1.2) / (3.0 - 1.2), 1.0)

  // Pillar 2: Consistency (35%) — Weekly profit rate 40% → 0, 85%+ → 1.0
  const consistencyScore = Math.min(Math.max((weeklyProfitRate - 40) / (85 - 40), 0), 1.0)

  // Pillar 3: Risk (25%) — Inverse drawdown: DD 5% → 1.0, DD 25%+ → 0
  const riskScore = drawdown30d <= 0
    ? 1.0
    : Math.min(Math.max((25 - drawdown30d) / (25 - 5), 0), 1.0)

  const rawScore = (
    edgeScore * 0.40 +
    consistencyScore * 0.35 +
    riskScore * 0.25
  ) * 100

  const confidence = Math.min(1.0, tradeCountAll / 50)
  return Math.min(Math.round(rawScore * confidence), 100)
}

async function fetchTradeStats(address: string): Promise<{ sellRatio: number; tradesPerMarket: number }> {
  try {
    const allTrades: any[] = []
    let offset = 0
    const limit = 500

    while (allTrades.length < 2000) {
      const res = await fetch(
        `https://data-api.polymarket.com/trades?user=${address}&limit=${limit}&offset=${offset}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } }
      )
      if (!res.ok) break
      const data = await res.json()
      if (!data || !Array.isArray(data) || data.length === 0) break
      allTrades.push(...data)
      if (data.length < limit) break
      offset += limit
    }

    if (allTrades.length === 0) return { sellRatio: 0, tradesPerMarket: 0 }

    let buyCount = 0, sellCount = 0
    const markets = new Set<string>()
    for (const t of allTrades) {
      if (t.side === 'BUY') buyCount++
      else if (t.side === 'SELL') sellCount++
      if (t.conditionId) markets.add(t.conditionId)
    }

    const total = buyCount + sellCount
    const sellRatio = total > 0 ? Math.round((sellCount / total) * 10000) / 100 : 0
    const tradesPerMarket = markets.size > 0 ? Math.round((total / markets.size) * 100) / 100 : 0

    return { sellRatio, tradesPerMarket }
  } catch {
    return { sellRatio: 0, tradesPerMarket: 0 }
  }
}

// --- Per-wallet refresh function ---

export interface RefreshResult {
  address: string
  username?: string
  success: boolean
  error?: string
}

export async function refreshOneWallet(
  wallet: { address: string; username?: string; balance?: number }
): Promise<RefreshResult> {
  const supabase = getServiceSupabase()

  try {
    const [profile, portfolioValue, rawPositions, rawClosedPositions, rawActivity] = await Promise.all([
      getProfile(wallet.address).catch(() => ({})),
      getPortfolioValue(wallet.address).catch(() => wallet.balance || 0),
      getPositions(wallet.address).catch(() => []),
      getClosedPositions(wallet.address).catch(() => []),
      getActivity(wallet.address).catch(() => []),
    ])

    const allPositions = parsePositions(rawPositions)
    const apiClosedPositions = parseClosedPositions(rawClosedPositions)

    const openPositions = allPositions.filter(p => p.currentValue > 0)

    // IMPORTANT: /closed-positions only returns REDEEMED positions (mostly wins).
    // Losing positions stay in /positions with currentValue=0, redeemable=true, cashPnl<0.
    // Don't filter by conditionId — hedged positions can have wins and losses on same market.
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

    const closedPositions = [...apiClosedPositions, ...unredeemedLosses]
      .sort((a, b) => {
        const dateA = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0
        const dateB = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0
        return dateB - dateA
      })

    // Compute hold durations from activity data
    const parsedActivityTrades = parseTrades(rawActivity)
    computeHoldDurations(closedPositions as PolymarketClosedPosition[], parsedActivityTrades)
    const avgHoldDurationHours = computeAvgHoldDuration(closedPositions as PolymarketClosedPosition[])

    const currentBalance = portfolioValue || wallet.balance || 0
    const polymetrics = calculatePolymarketMetrics(closedPositions, openPositions, currentBalance)
    const metrics7d = calculatePeriodMetrics(closedPositions, 7, currentBalance)
    const metrics30d = calculatePeriodMetrics(closedPositions, 30, currentBalance)
    const metricsAll = calculatePeriodMetrics(closedPositions, 36500, currentBalance)

    const allEventSlugs = [
      ...rawPositions.map((p: any) => String(p.eventSlug || p.slug || '')),
      ...rawClosedPositions.map((p: any) => String(p.eventSlug || p.slug || '')),
    ].filter(Boolean)
    const categoryMap = await fetchEventCategories(allEventSlugs)
    const topCategory = getTopCategory(allEventSlugs, categoryMap)

    // Fetch sell ratio and trades per market from raw trades
    const tradeStats = await fetchTradeStats(wallet.address)

    // Calculate copy-trade metrics
    const profitFactor30d = calculateProfitFactor(closedPositions, 30)
    const profitFactorAll = calculateProfitFactor(closedPositions)
    const diffWinRate30d = calculateDiffWinRate(closedPositions, 30)
    const diffWinRateAll = calculateDiffWinRate(closedPositions)
    const weeklyProfitRate = calculateWeeklyProfitRate(closedPositions)
    const avgTradesPerDay = calculateAvgTradesPerDay(closedPositions)
    const medianProfitPct = calculateMedianProfitPct(closedPositions)
    const copyScore = calculateCopyScore({
      profitFactor30d,
      drawdown30d: metrics30d.drawdown || 0,
      weeklyProfitRate,
      tradeCountAll: polymetrics.tradeCount,
      medianProfitPct,
      avgTradesPerDay,
    })

    const { error: updateError } = await supabase.from('wallets').update({
      username: (profile as any).name || (profile as any).pseudonym || wallet.username,
      account_created_at: (profile as any).createdAt,
      balance: portfolioValue,
      pnl_7d: metrics7d.pnl,
      win_rate_7d: metrics7d.winRate,
      volume_7d: metrics7d.volume,
      trade_count_7d: metrics7d.tradeCount,
      drawdown_7d: metrics7d.drawdown,
      wins_7d: metrics7d.winningPositions || 0,
      losses_7d: metrics7d.losingPositions || 0,
      pnl_30d: metrics30d.pnl,
      win_rate_30d: metrics30d.winRate,
      volume_30d: metrics30d.volume,
      trade_count_30d: metrics30d.tradeCount,
      drawdown_30d: metrics30d.drawdown,
      wins_30d: metrics30d.winningPositions || 0,
      losses_30d: metrics30d.losingPositions || 0,
      total_positions: new Set(closedPositions.map((p: any) => p.conditionId).filter(Boolean)).size,
      active_positions: new Set(openPositions.map((p: any) => p.conditionId).filter(Boolean)).size,
      total_wins: polymetrics.winCount,
      total_losses: polymetrics.lossCount,
      realized_pnl: polymetrics.realizedPnl,
      unrealized_pnl: polymetrics.unrealizedPnl,
      overall_pnl: polymetrics.totalPnl,
      overall_win_rate: polymetrics.winRateAll,
      total_volume: polymetrics.totalBought,
      total_trades: polymetrics.tradeCount,
      pnl_all: metricsAll.pnl,
      win_rate_all: metricsAll.winRate,
      volume_all: metricsAll.volume,
      trade_count_all: metricsAll.tradeCount,
      drawdown_all: metricsAll.drawdown,
      drawdown_amount_all: metricsAll.drawdownAmount,
      wins_all: metricsAll.winningPositions || 0,
      losses_all: metricsAll.losingPositions || 0,
      top_category: topCategory || null,
      // Copy-trade metrics
      profit_factor_30d: profitFactor30d,
      profit_factor_all: profitFactorAll,
      diff_win_rate_30d: diffWinRate30d,
      diff_win_rate_all: diffWinRateAll,
      weekly_profit_rate: weeklyProfitRate,
      copy_score: copyScore,
      avg_trades_per_day: avgTradesPerDay,
      median_profit_pct: medianProfitPct,
      sell_ratio: tradeStats.sellRatio,
      trades_per_market: tradeStats.tradesPerMarket,
      ...(avgHoldDurationHours != null && { avg_hold_duration_hours: avgHoldDurationHours }),
      metrics_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('address', wallet.address)

    if (updateError) {
      return { address: wallet.address, username: wallet.username, success: false, error: updateError.message }
    }

    return { address: wallet.address, username: wallet.username, success: true }
  } catch (err) {
    return {
      address: wallet.address,
      username: wallet.username,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

function computeHoldDurations(
  closedPositions: PolymarketClosedPosition[],
  trades: { timestamp: number; side: 'BUY' | 'SELL'; conditionId?: string }[]
): void {
  const firstBuyMap = new Map<string, number>()
  for (const trade of trades) {
    if (trade.side !== 'BUY' || !trade.conditionId) continue
    const tsMs = trade.timestamp * 1000
    const existing = firstBuyMap.get(trade.conditionId)
    if (!existing || tsMs < existing) {
      firstBuyMap.set(trade.conditionId, tsMs)
    }
  }
  for (const pos of closedPositions) {
    const firstBuy = firstBuyMap.get(pos.conditionId)
    if (!firstBuy || !pos.resolvedAt) continue
    const resolvedMs = new Date(pos.resolvedAt).getTime()
    const duration = resolvedMs - firstBuy
    if (duration > 0) {
      pos.holdDurationMs = duration
    }
  }
}

function computeAvgHoldDuration(
  closedPositions: PolymarketClosedPosition[]
): number | null {
  const durations = closedPositions
    .filter(p => p.holdDurationMs != null && p.holdDurationMs > 0)
    .map(p => p.holdDurationMs!)
  if (durations.length === 0) return null
  const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length
  return Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10
}
