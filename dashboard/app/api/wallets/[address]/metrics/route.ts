import { NextRequest, NextResponse } from 'next/server'
import { supabase, WalletMetrics, WalletTrade, TimePeriod, getTimePeriodStartDate } from '@/lib/supabase'

interface RouteParams {
  params: Promise<{ address: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { address } = await params
    const { searchParams } = new URL(request.url)
    const period = (searchParams.get('period') || '30d') as TimePeriod

    // Validate address
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }

    // Get start date for the period
    const startDate = getTimePeriodStartDate(period)

    // Build query for trades with time filter
    const query = supabase
      .from('wallet_trades')
      .select('*')
      .eq('address', address.toLowerCase())
      .gte('executed_at', startDate.toISOString())
      .order('executed_at', { ascending: true })

    const { data: trades, error } = await query

    if (error) {
      console.error('Error fetching trades:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Calculate metrics from trades
    const metrics = calculateMetrics(trades || [])

    return NextResponse.json({
      address,
      period,
      metrics,
      tradeCount: trades?.length || 0
    })
  } catch (error) {
    console.error('Error in wallet metrics API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function calculateMetrics(trades: WalletTrade[]): WalletMetrics {
  if (!trades || trades.length === 0) {
    return {
      pnl: 0,
      roi: 0,
      volume: 0,
      tradeCount: 0,
      winRate: 0,
      maxDrawdown: 0,
      buyCount: 0,
      sellCount: 0,
      avgTradeSize: 0,
      uniqueMarkets: 0
    }
  }

  // Basic counts
  const buyCount = trades.filter(t => t.side === 'BUY').length
  const sellCount = trades.filter(t => t.side === 'SELL').length
  const tradeCount = trades.length

  // Volume (total USD traded)
  const volume = trades.reduce((sum, t) => sum + (t.usd_value || 0), 0)

  // Average trade size
  const avgTradeSize = volume / tradeCount

  // Unique markets
  const uniqueMarkets = new Set(trades.map(t => t.condition_id).filter(Boolean)).size

  // PnL calculation
  // For a simple calculation: SELL trades are positive, BUY trades are negative
  // More accurate PnL requires matching buys with sells per market
  const pnl = calculatePnL(trades)

  // ROI
  const totalInvested = trades
    .filter(t => t.side === 'BUY')
    .reduce((sum, t) => sum + (t.usd_value || 0), 0)
  const roi = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0

  // Win rate - per market basis
  const winRate = calculateWinRate(trades)

  // Max drawdown
  const maxDrawdown = calculateMaxDrawdown(trades)

  return {
    pnl,
    roi,
    volume,
    tradeCount,
    winRate,
    maxDrawdown,
    buyCount,
    sellCount,
    avgTradeSize,
    uniqueMarkets
  }
}

function calculatePnL(trades: WalletTrade[]): number {
  // Group trades by market (condition_id)
  const marketTrades: Record<string, WalletTrade[]> = {}

  for (const trade of trades) {
    const key = trade.condition_id || 'unknown'
    if (!marketTrades[key]) {
      marketTrades[key] = []
    }
    marketTrades[key].push(trade)
  }

  let totalPnL = 0

  for (const marketId of Object.keys(marketTrades)) {
    const mTrades = marketTrades[marketId]

    // Sum up: sells add money, buys subtract money
    const marketPnL = mTrades.reduce((sum, t) => {
      const value = t.usd_value || 0
      return sum + (t.side === 'SELL' ? value : -value)
    }, 0)

    totalPnL += marketPnL
  }

  return totalPnL
}

function calculateWinRate(trades: WalletTrade[]): number {
  // Group by market
  const marketTrades: Record<string, WalletTrade[]> = {}

  for (const trade of trades) {
    const key = trade.condition_id || 'unknown'
    if (!marketTrades[key]) {
      marketTrades[key] = []
    }
    marketTrades[key].push(trade)
  }

  let wins = 0
  let total = 0

  for (const marketId of Object.keys(marketTrades)) {
    const mTrades = marketTrades[marketId]

    // Only count markets with both buys and sells (closed positions)
    const hasBuy = mTrades.some(t => t.side === 'BUY')
    const hasSell = mTrades.some(t => t.side === 'SELL')

    if (hasBuy && hasSell) {
      total++

      // Calculate if this market was profitable
      const marketPnL = mTrades.reduce((sum, t) => {
        const value = t.usd_value || 0
        return sum + (t.side === 'SELL' ? value : -value)
      }, 0)

      if (marketPnL > 0) {
        wins++
      }
    }
  }

  return total > 0 ? (wins / total) * 100 : 0
}

function calculateMaxDrawdown(trades: WalletTrade[]): number {
  if (trades.length === 0) return 0

  // Sort by execution time
  const sortedTrades = [...trades].sort((a, b) =>
    new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  )

  // Calculate cumulative PnL over time
  let cumulativePnL = 0
  let peak = 0
  let maxDrawdown = 0

  for (const trade of sortedTrades) {
    const value = trade.usd_value || 0
    cumulativePnL += (trade.side === 'SELL' ? value : -value)

    // Update peak
    if (cumulativePnL > peak) {
      peak = cumulativePnL
    }

    // Calculate drawdown from peak
    const drawdown = peak - cumulativePnL

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }
  }

  // Return as percentage of peak (or absolute if peak is 0)
  return peak > 0 ? (maxDrawdown / peak) * 100 : maxDrawdown
}
