/**
 * Copy Trading Simulation Engine
 *
 * Simulates copying another wallet's trades with a configurable execution delay.
 * Uses a statistical slippage model since Polymarket's price history API
 * only offers 1-minute fidelity (insufficient for sub-minute delay simulation).
 */

import { ParsedTrade, PolymarketClosedPosition } from '@/lib/types/trader'
import {
  SlippageParams,
  SlippageResult,
  SimulationConfig,
  SimulatedTrade,
  SimulatedPosition,
  EquityCurvePoint,
  SimulationResult,
  DEFAULT_SLIPPAGE_PARAMS,
} from './types'

// ============================================
// Slippage Estimation
// ============================================

/**
 * Estimate the slippage from a delayed copy trade.
 * Since we can't look up the exact price N seconds later (API only has 1-min fidelity),
 * we use a statistical model:
 *   - Base spread cost (always adverse)
 *   - Price drift from delay (market moves against copy trader)
 *   - Size impact (larger trades move the book more)
 */
export function estimateSlippage(
  params: SlippageParams,
  tradePrice: number,
  tradeSide: 'BUY' | 'SELL',
  tradeUsdValue: number
): SlippageResult {
  // 1. Base spread cost
  const spreadCost = params.baseSpreadPct / 100

  // 2. Price drift from delay (adverse direction)
  const driftCost = (params.driftPerSecondPct / 100) * params.delaySeconds

  // 3. Size impact: larger trades move the book more
  const sizeImpact = (params.sizeImpactFactor / 100) * (tradeUsdValue / 100)

  // 4. Total slippage (always adverse to the copy trader)
  const totalSlippagePct = spreadCost + driftCost + sizeImpact

  // 5. Check if we should skip this trade
  const skipped = totalSlippagePct > params.maxSlippagePct / 100

  // 6. Apply to price
  let adjustedPrice: number
  if (tradeSide === 'BUY') {
    // Buying at a higher price (worse for us)
    adjustedPrice = Math.min(tradePrice + totalSlippagePct, 0.99)
  } else {
    // Selling at a lower price (worse for us)
    adjustedPrice = Math.max(tradePrice - totalSlippagePct, 0.01)
  }

  return {
    adjustedPrice: Math.round(adjustedPrice * 10000) / 10000,
    slippagePct: Math.round(totalSlippagePct * 10000) / 100, // as percentage
    skipped,
  }
}

// ============================================
// Position Tracker (internal)
// ============================================

interface TrackedPosition {
  conditionId: string
  market: string
  outcome: string
  totalShares: number
  totalInvested: number
  avgEntryPrice: number
  originalAvgEntryPrice: number
  tradeCount: number
}

// ============================================
// Core Simulation
// ============================================

/**
 * Run a copy trading simulation.
 *
 * @param config - Simulation parameters
 * @param trades - Historical trades from the target wallet (from getActivity + parseTrades)
 * @param closedPositions - Resolved positions from the target wallet (for outcome resolution)
 * @param portfolioValue - Current portfolio value of the target wallet (for proportional sizing)
 */
export function runSimulation(
  config: SimulationConfig,
  trades: ParsedTrade[],
  closedPositions: PolymarketClosedPosition[],
  portfolioValue: number
): SimulationResult {
  const startTime = Date.now()

  // Sort trades chronologically (oldest first)
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)

  // Filter by time period
  const cutoffTimestamp = Math.floor((Date.now() - config.timePeriodDays * 24 * 60 * 60 * 1000) / 1000)
  const periodTrades = sortedTrades.filter(t => t.timestamp >= cutoffTimestamp)

  // Build resolution map: conditionId -> { isWin, realizedPnl, resolvedAt, avgPrice }
  const resolutionMap = new Map<string, PolymarketClosedPosition>()
  for (const pos of closedPositions) {
    // Key by conditionId + outcome for unique position identification
    const key = `${pos.conditionId}:${pos.outcome || ''}`
    resolutionMap.set(key, pos)
  }

  // Calculate scale factor for proportional sizing
  // Use peak deployed capital from trade history instead of portfolio snapshot,
  // because the current portfolio value may be near-zero if the wallet has
  // withdrawn or closed most positions, causing an absurdly high scaleFactor.
  let peakDeployed = 0
  let currentDeployed = 0
  for (const t of periodTrades) {
    if (t.side === 'BUY') {
      currentDeployed += t.usdValue
    } else {
      currentDeployed = Math.max(0, currentDeployed - t.usdValue)
    }
    if (currentDeployed > peakDeployed) peakDeployed = currentDeployed
  }
  const referenceCapital = Math.max(portfolioValue, peakDeployed, 1000)
  const scaleFactor = config.startingCapital / referenceCapital

  // State
  let capital = config.startingCapital
  const positions = new Map<string, TrackedPosition>()
  const simulatedTrades: SimulatedTrade[] = []
  const equityCurve: EquityCurvePoint[] = []
  let originalCumPnl = 0
  let totalSlippageSum = 0
  let slippageCount = 0

  // Add initial equity curve point
  equityCurve.push({
    timestamp: periodTrades.length > 0 ? periodTrades[0].timestamp : Math.floor(Date.now() / 1000),
    date: new Date((periodTrades.length > 0 ? periodTrades[0].timestamp : Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    simulatedCapital: capital,
    originalCumPnl: 0,
  })

  // Process each trade
  for (const trade of periodTrades) {
    if (!trade.conditionId) continue // Skip trades without conditionId

    const posKey = `${trade.conditionId}:${trade.outcome || ''}`
    const capitalBefore = capital

    // Calculate slippage
    const slippage = estimateSlippage(
      config.slippageParams,
      trade.price,
      trade.side,
      trade.usdValue
    )

    // Calculate proportional trade size
    const scaledUsdValue = trade.usdValue * scaleFactor

    // Check skip conditions
    let skipped = false
    let skipReason: string | undefined

    if (slippage.skipped) {
      skipped = true
      skipReason = `Slippage ${slippage.slippagePct.toFixed(2)}% exceeds max ${config.slippageParams.maxSlippagePct}%`
    } else if (trade.side === 'BUY') {
      // BUY trades: cap at available capital (proportional sizing already applied,
      // but for large wallets the scaled value can exceed our capital - that's fine,
      // we just invest what we can, up to maxPositionPct)
      if (capital <= 0.01) {
        skipped = true
        skipReason = 'No capital available'
      }
    } else if (trade.side === 'SELL') {
      const existing = positions.get(posKey)
      if (!existing || existing.totalShares <= 0) {
        skipped = true
        skipReason = 'No position to sell'
      }
    }

    if (skipped) {
      simulatedTrades.push({
        timestamp: trade.timestamp,
        conditionId: trade.conditionId,
        market: trade.market,
        outcome: trade.outcome || '',
        side: trade.side,
        originalPrice: trade.price,
        originalUsdValue: trade.usdValue,
        adjustedPrice: slippage.adjustedPrice,
        slippagePct: slippage.slippagePct,
        simulatedUsdValue: 0,
        simulatedShares: 0,
        skipped: true,
        skipReason,
        capitalBefore,
        capitalAfter: capital,
      })
      continue
    }

    totalSlippageSum += slippage.slippagePct
    slippageCount++

    if (trade.side === 'BUY') {
      // Cap at maxPositionPct of capital
      const maxPositionSize = capital * (config.maxPositionPct / 100)
      const actualUsdValue = Math.min(scaledUsdValue, maxPositionSize, capital)
      const shares = actualUsdValue / slippage.adjustedPrice

      capital -= actualUsdValue

      // Update or create position
      const existing = positions.get(posKey)
      if (existing) {
        const totalInvested = existing.totalInvested + actualUsdValue
        const totalShares = existing.totalShares + shares
        existing.avgEntryPrice = totalInvested / totalShares
        existing.originalAvgEntryPrice =
          (existing.originalAvgEntryPrice * existing.totalShares + trade.price * shares) /
          (existing.totalShares + shares)
        existing.totalShares = totalShares
        existing.totalInvested = totalInvested
        existing.tradeCount++
      } else {
        positions.set(posKey, {
          conditionId: trade.conditionId,
          market: trade.market,
          outcome: trade.outcome || '',
          totalShares: shares,
          totalInvested: actualUsdValue,
          avgEntryPrice: slippage.adjustedPrice,
          originalAvgEntryPrice: trade.price,
          tradeCount: 1,
        })
      }

      simulatedTrades.push({
        timestamp: trade.timestamp,
        conditionId: trade.conditionId,
        market: trade.market,
        outcome: trade.outcome || '',
        side: 'BUY',
        originalPrice: trade.price,
        originalUsdValue: trade.usdValue,
        adjustedPrice: slippage.adjustedPrice,
        slippagePct: slippage.slippagePct,
        simulatedUsdValue: actualUsdValue,
        simulatedShares: shares,
        skipped: false,
        capitalBefore,
        capitalAfter: capital,
      })
    } else {
      // SELL
      const existing = positions.get(posKey)!
      const sharesToSell = Math.min(
        scaledUsdValue / trade.price, // proportional shares
        existing.totalShares
      )
      const proceeds = sharesToSell * slippage.adjustedPrice
      capital += proceeds

      // Reduce position
      const costBasis = sharesToSell * existing.avgEntryPrice
      existing.totalShares -= sharesToSell
      existing.totalInvested -= costBasis

      if (existing.totalShares <= 0.001) {
        existing.totalShares = 0
        existing.totalInvested = 0
      }

      simulatedTrades.push({
        timestamp: trade.timestamp,
        conditionId: trade.conditionId,
        market: trade.market,
        outcome: trade.outcome || '',
        side: 'SELL',
        originalPrice: trade.price,
        originalUsdValue: trade.usdValue,
        adjustedPrice: slippage.adjustedPrice,
        slippagePct: slippage.slippagePct,
        simulatedUsdValue: proceeds,
        simulatedShares: sharesToSell,
        skipped: false,
        capitalBefore,
        capitalAfter: capital,
      })
    }

    // Track equity curve (sample every trade)
    // Total portfolio = cash + value of all open positions (at cost basis)
    let positionsValue = 0
    for (const [, pos] of positions) {
      positionsValue += pos.totalInvested
    }
    equityCurve.push({
      timestamp: trade.timestamp,
      date: new Date(trade.timestamp * 1000).toISOString(),
      simulatedCapital: capital + positionsValue,
      originalCumPnl,
    })
  }

  // Resolve positions using closedPositions data
  const finalPositions: SimulatedPosition[] = []
  let totalRealized = 0
  let winCount = 0
  let lossCount = 0
  let unrealizedPnl = 0
  let openPositionCount = 0

  for (const [posKey, pos] of positions.entries()) {
    const resolution = resolutionMap.get(posKey)

    if (resolution && pos.totalShares > 0) {
      // Position has been resolved
      const isWin = resolution.isWin
      let pnl: number

      if (isWin) {
        // Win: each share pays $1.00
        pnl = pos.totalShares * (1 - pos.avgEntryPrice)
      } else {
        // Loss: each share pays $0.00
        pnl = -pos.totalInvested
      }

      capital += pos.totalInvested + pnl // Return invested + P&L
      totalRealized += pnl

      if (pnl > 0) winCount++
      else lossCount++

      // Calculate original P&L for this position
      const originalPnl = resolution.realizedPnl

      finalPositions.push({
        conditionId: pos.conditionId,
        market: pos.market,
        outcome: pos.outcome,
        avgEntryPrice: pos.avgEntryPrice,
        originalAvgEntryPrice: pos.originalAvgEntryPrice,
        totalShares: pos.totalShares,
        totalInvested: pos.totalInvested,
        resolved: true,
        isWin,
        resolvedAt: resolution.resolvedAt,
        realizedPnl: Math.round(pnl * 100) / 100,
        originalRealizedPnl: originalPnl,
      })
    } else if (pos.totalShares > 0) {
      // Position still open (not yet resolved)
      openPositionCount++
      // Estimate unrealized value (assume current price ~ last trade price as proxy)
      // Without live price data, we mark unrealized as 0
      unrealizedPnl += 0

      finalPositions.push({
        conditionId: pos.conditionId,
        market: pos.market,
        outcome: pos.outcome,
        avgEntryPrice: pos.avgEntryPrice,
        originalAvgEntryPrice: pos.originalAvgEntryPrice,
        totalShares: pos.totalShares,
        totalInvested: pos.totalInvested,
        resolved: false,
        isWin: false,
        realizedPnl: 0,
        originalRealizedPnl: 0,
      })
    }
  }

  // Calculate original wallet metrics for comparison
  const periodClosedPositions = closedPositions.filter(p => {
    if (!p.resolvedAt) return false
    const resolvedTimestamp = new Date(p.resolvedAt).getTime() / 1000
    return resolvedTimestamp >= cutoffTimestamp
  })

  const originalPnl = periodClosedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const originalWins = periodClosedPositions.filter(p => p.realizedPnl > 0).length
  const originalWinRate = periodClosedPositions.length > 0
    ? (originalWins / periodClosedPositions.length) * 100
    : 0
  const originalInvested = periodClosedPositions.reduce((sum, p) => sum + p.initialValue, 0)
  const originalRoi = originalInvested > 0 ? (originalPnl / originalInvested) * 100 : 0

  // Final metrics
  const totalPnl = capital - config.startingCapital
  const totalRoi = (totalPnl / config.startingCapital) * 100
  const resolvedCount = winCount + lossCount
  const winRate = resolvedCount > 0 ? (winCount / resolvedCount) * 100 : 0
  const avgSlippage = slippageCount > 0 ? totalSlippageSum / slippageCount : 0
  const performanceRatio = originalRoi !== 0 ? totalRoi / originalRoi : 0

  // Calculate max drawdown from equity curve
  const maxDrawdown = calculateMaxDrawdown(equityCurve.map(p => p.simulatedCapital))

  // Update equity curve with final state
  if (equityCurve.length > 0) {
    const lastPoint = equityCurve[equityCurve.length - 1]
    if (lastPoint.simulatedCapital !== capital) {
      equityCurve.push({
        timestamp: Math.floor(Date.now() / 1000),
        date: new Date().toISOString(),
        simulatedCapital: capital,
        originalCumPnl: originalPnl,
      })
    }
  }

  return {
    config,
    finalCapital: Math.round(capital * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalRoi: Math.round(totalRoi * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    winCount,
    lossCount,
    tradeCount: simulatedTrades.filter(t => !t.skipped).length,
    skippedTrades: simulatedTrades.filter(t => t.skipped).length,
    avgSlippage: Math.round(avgSlippage * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    originalPnl: Math.round(originalPnl * 100) / 100,
    originalRoi: Math.round(originalRoi * 100) / 100,
    originalWinRate: Math.round(originalWinRate * 100) / 100,
    performanceRatio: Math.round(performanceRatio * 100) / 100,
    trades: simulatedTrades,
    positions: finalPositions,
    equityCurve,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    openPositionCount,
    simulatedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    totalTradesFetched: trades.length,
  }
}

/**
 * Calculate max drawdown from a series of capital values.
 * Returns the maximum peak-to-trough decline as a percentage.
 */
function calculateMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0

  let peak = values[0]
  let maxDD = 0

  for (const value of values) {
    if (value > peak) peak = value
    const dd = peak > 0 ? ((peak - value) / peak) * 100 : 0
    if (dd > maxDD) maxDD = dd
  }

  return maxDD
}
