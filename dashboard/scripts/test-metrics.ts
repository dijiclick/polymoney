/**
 * Test script to debug ROI/Win Rate calculation for a specific wallet
 * Run with: npx tsx scripts/test-metrics.ts
 *
 * Trade counting logic:
 * - Same conditionId + different outcomes (hedging) = 1 trade
 * - Same conditionId + same outcome (re-entry) = separate trades
 *
 * ROI calculation:
 * - Account ROI = Total PnL / Initial Balance * 100
 * - Initial Balance = Current Balance - Total PnL
 */

const DATA_API_BASE = 'https://data-api.polymarket.com'

interface RawPosition {
  conditionId: string
  title: string
  outcome: string
  size?: string
  avgPrice: string | number
  currentValue?: string
  cashPnl?: string
  totalBought?: number
  realizedPnl?: number
  resolvedAt?: string
  endDate?: string
  timestamp?: number
}

interface Trade {
  conditionId: string
  title: string
  totalPnl: number
  totalBought: number
  isResolved: boolean
  outcomes: Set<string>
  entries: { outcome: string; pnl: number; bought: number }[]
  resolvedAt?: string
}

async function fetchPositions(address: string): Promise<RawPosition[]> {
  const response = await fetch(`${DATA_API_BASE}/positions?user=${address}&limit=50`)
  return response.json()
}

async function fetchClosedPositions(address: string): Promise<RawPosition[]> {
  const response = await fetch(`${DATA_API_BASE}/closed-positions?user=${address}&limit=100`)
  return response.json()
}

/**
 * Calculate max drawdown from closed positions
 *
 * Max Drawdown = highest (maxBalance - currentBalance) / maxBalance * 100
 *
 * We track portfolio balance over time:
 * 1. Start with initial balance
 * 2. As each position resolves, add its realized P&L to balance
 * 3. Track max balance seen so far
 * 4. Calculate drawdown when balance drops below max
 * 5. Return the maximum drawdown percentage
 */
function calculateMaxDrawdown(
  closedPositions: { pnl: number; resolvedAt?: string }[],
  initialBalance: number = 0
): { maxDrawdown: number; maxBalance: number; minBalance: number } {
  // Sort positions by resolution date chronologically
  const sortedPositions = [...closedPositions]
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (sortedPositions.length === 0) {
    return { maxDrawdown: 0, maxBalance: initialBalance, minBalance: initialBalance }
  }

  // Track running balance and max balance
  let balance = initialBalance
  let maxBalance = initialBalance
  let minBalance = initialBalance
  let maxDrawdownPercent = 0
  let drawdownMaxBalance = initialBalance
  let drawdownMinBalance = initialBalance

  for (const position of sortedPositions) {
    // Add realized P&L to balance
    balance += position.pnl

    // Track min balance
    if (balance < minBalance) {
      minBalance = balance
    }

    // Update max balance if we hit a new high
    if (balance > maxBalance) {
      maxBalance = balance
    }

    // Calculate current drawdown from max
    if (maxBalance > 0) {
      const drawdownPercent = ((maxBalance - balance) / maxBalance) * 100
      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent
        drawdownMaxBalance = maxBalance
        drawdownMinBalance = balance
      }
    }
  }

  return {
    maxDrawdown: Math.min(Math.round(maxDrawdownPercent * 100) / 100, 100),
    maxBalance: drawdownMaxBalance,
    minBalance: drawdownMinBalance,
  }
}

/**
 * Group positions into trades:
 * - Same conditionId + different outcomes = 1 trade (hedging)
 * - Same conditionId + same outcome = separate trades (re-entry)
 */
function groupIntoTrades(
  closedPositions: RawPosition[],
  openPositions: RawPosition[]
): Trade[] {
  // First, group by conditionId
  const marketGroups = new Map<string, {
    title: string
    outcomes: Map<string, { pnl: number; bought: number; isResolved: boolean; resolvedAt?: string }[]>
  }>()

  // Process closed positions
  for (const pos of closedPositions) {
    const pnl = pos.realizedPnl ?? parseFloat(pos.cashPnl || '0')
    const avgPrice = typeof pos.avgPrice === 'number' ? pos.avgPrice : parseFloat(pos.avgPrice || '0')
    const size = pos.size ? parseFloat(pos.size) : (pos.totalBought && avgPrice > 0 ? pos.totalBought / avgPrice : 0)
    const bought = size * avgPrice
    // Get resolved date from various possible fields
    let resolvedAt = pos.resolvedAt
    if (!resolvedAt && pos.timestamp) {
      resolvedAt = new Date(pos.timestamp * 1000).toISOString()
    } else if (!resolvedAt && pos.endDate) {
      resolvedAt = pos.endDate
    }

    if (!marketGroups.has(pos.conditionId)) {
      marketGroups.set(pos.conditionId, { title: pos.title, outcomes: new Map() })
    }
    const group = marketGroups.get(pos.conditionId)!
    if (!group.outcomes.has(pos.outcome)) {
      group.outcomes.set(pos.outcome, [])
    }
    group.outcomes.get(pos.outcome)!.push({ pnl, bought, isResolved: true, resolvedAt })
  }

  // Process open positions
  for (const pos of openPositions) {
    const pnl = parseFloat(pos.cashPnl || '0')
    const avgPrice = typeof pos.avgPrice === 'number' ? pos.avgPrice : parseFloat(pos.avgPrice || '0')
    const size = pos.size ? parseFloat(pos.size) : 0
    const bought = size * avgPrice
    const currentValue = parseFloat(pos.currentValue || '0')
    const isResolvedNotRedeemed = currentValue === 0

    if (!marketGroups.has(pos.conditionId)) {
      marketGroups.set(pos.conditionId, { title: pos.title, outcomes: new Map() })
    }
    const group = marketGroups.get(pos.conditionId)!
    if (!group.outcomes.has(pos.outcome)) {
      group.outcomes.set(pos.outcome, [])
    }
    group.outcomes.get(pos.outcome)!.push({ pnl, bought, isResolved: isResolvedNotRedeemed })
  }

  // Convert to trades
  const trades: Trade[] = []

  for (const [conditionId, group] of marketGroups) {
    const outcomeKeys = Array.from(group.outcomes.keys())

    if (outcomeKeys.length > 1) {
      // Multiple outcomes (hedging) = 1 trade
      let totalPnl = 0
      let totalBought = 0
      let isResolved = false
      let latestResolvedAt: string | undefined
      const outcomes = new Set<string>()
      const entries: { outcome: string; pnl: number; bought: number }[] = []

      for (const [outcome, posEntries] of group.outcomes) {
        outcomes.add(outcome)
        for (const entry of posEntries) {
          totalPnl += entry.pnl
          totalBought += entry.bought
          entries.push({ outcome, pnl: entry.pnl, bought: entry.bought })
          if (entry.isResolved) isResolved = true
          if (entry.resolvedAt && (!latestResolvedAt || entry.resolvedAt > latestResolvedAt)) {
            latestResolvedAt = entry.resolvedAt
          }
        }
      }

      trades.push({ conditionId, title: group.title, totalPnl, totalBought, isResolved, outcomes, entries, resolvedAt: latestResolvedAt })
    } else {
      // Single outcome - each entry is a separate trade (re-entries)
      const outcome = outcomeKeys[0]
      const posEntries = group.outcomes.get(outcome)!

      for (const entry of posEntries) {
        trades.push({
          conditionId,
          title: group.title,
          totalPnl: entry.pnl,
          totalBought: entry.bought,
          isResolved: entry.isResolved,
          outcomes: new Set([outcome]),
          entries: [{ outcome, pnl: entry.pnl, bought: entry.bought }],
          resolvedAt: entry.resolvedAt,
        })
      }
    }
  }

  return trades
}

async function debugWallet(address: string, currentBalance: number = 0) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`Debugging wallet: ${address}`)
  console.log('='.repeat(80))

  // Fetch data
  const [openPositions, closedPositions] = await Promise.all([
    fetchPositions(address),
    fetchClosedPositions(address),
  ])

  console.log(`\n📊 Raw Data:`)
  console.log(`   Open positions: ${openPositions.length}`)
  console.log(`   Closed position entries: ${closedPositions.length}`)
  console.log(`   Current Balance: $${currentBalance.toFixed(2)}`)

  // Group into trades
  const trades = groupIntoTrades(closedPositions, openPositions)

  console.log(`\n📈 Total Trades: ${trades.length}`)

  // Show hedged trades (multiple outcomes in same market)
  console.log(`\n🔄 Hedged Trades (multiple outcomes = 1 trade):`)
  let hedgeCount = 0
  for (const trade of trades) {
    if (trade.outcomes.size > 1) {
      hedgeCount++
      console.log(`   ${trade.title.substring(0, 50)}...`)
      for (const entry of trade.entries) {
        console.log(`      - ${entry.outcome}: PnL $${entry.pnl.toFixed(2)}, Bought $${entry.bought.toFixed(2)}`)
      }
      console.log(`      = Combined: PnL $${trade.totalPnl.toFixed(2)} (${trade.totalPnl > 0 ? 'WIN' : 'LOSS'})`)
    }
  }
  if (hedgeCount === 0) console.log('   None found')

  // Calculate metrics
  let realizedPnl = 0
  let totalBoughtResolved = 0
  let winCount = 0
  let lossCount = 0
  let activeTradeCount = 0
  let unrealizedPnl = 0

  const wins: string[] = []
  const losses: string[] = []

  for (const trade of trades) {
    if (trade.isResolved) {
      realizedPnl += trade.totalPnl
      totalBoughtResolved += trade.totalBought
      if (trade.totalPnl > 0) {
        winCount++
        wins.push(`${trade.title.substring(0, 40)}: +$${trade.totalPnl.toFixed(2)}`)
      } else {
        lossCount++
        losses.push(`${trade.title.substring(0, 40)}: $${trade.totalPnl.toFixed(2)}`)
      }
    } else {
      unrealizedPnl += trade.totalPnl
      activeTradeCount++
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl
  const tradeCount = winCount + lossCount

  // Account ROI = Total PnL / Initial Balance * 100
  // Initial Balance = Current Balance - Total PnL
  const initialBalance = currentBalance - totalPnl
  const accountRoi = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0

  // Capital Deployed ROI (for comparison)
  const capitalRoi = totalBoughtResolved > 0 ? (realizedPnl / totalBoughtResolved) * 100 : 0

  const winRateAll = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0

  console.log(`\n✅ Wins (${winCount}):`)
  wins.slice(0, 5).forEach(w => console.log(`   ${w}`))
  if (wins.length > 5) console.log(`   ... and ${wins.length - 5} more`)

  console.log(`\n❌ Losses (${lossCount}):`)
  losses.forEach(l => console.log(`   ${l}`))

  console.log(`\n📊 Final Metrics:`)
  console.log(`   Trade Count (resolved): ${tradeCount}`)
  console.log(`   Active Trades: ${activeTradeCount}`)
  console.log(`   Wins: ${winCount}`)
  console.log(`   Losses: ${lossCount}`)
  console.log(`   Win Rate: ${winRateAll.toFixed(2)}%`)
  console.log(`   `)
  console.log(`   Realized PnL: $${realizedPnl.toFixed(2)}`)
  console.log(`   Unrealized PnL: $${unrealizedPnl.toFixed(2)}`)
  console.log(`   Total PnL: $${totalPnl.toFixed(2)}`)
  console.log(`   `)
  console.log(`   Current Balance: $${currentBalance.toFixed(2)}`)
  console.log(`   Initial Balance (estimated): $${initialBalance.toFixed(2)}`)
  console.log(`   Account ROI: ${accountRoi.toFixed(2)}%`)
  console.log(`   `)
  console.log(`   Total Invested (resolved): $${totalBoughtResolved.toFixed(2)}`)
  console.log(`   Capital Deployed ROI: ${capitalRoi.toFixed(2)}% (for reference)`)

  // Calculate Max Drawdown from resolved trades
  // Build list of resolved trades with P&L and resolvedAt
  const resolvedTrades = trades
    .filter(t => t.isResolved && t.resolvedAt)
    .map(t => ({ pnl: t.totalPnl, resolvedAt: t.resolvedAt }))

  const { maxDrawdown, maxBalance, minBalance } = calculateMaxDrawdown(resolvedTrades, initialBalance)

  console.log(`   `)
  console.log(`   📉 Max Drawdown: ${maxDrawdown.toFixed(2)}%`)
  console.log(`   Peak Balance (during DD): $${maxBalance.toFixed(2)}`)
  console.log(`   Trough Balance (during DD): $${minBalance.toFixed(2)}`)

  return {
    tradeCount,
    activeTradeCount,
    winCount,
    lossCount,
    winRate: winRateAll,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalBought: totalBoughtResolved,
    currentBalance,
    initialBalance,
    accountRoi,
    capitalRoi,
    maxDrawdown,
    maxBalance,
    minBalance,
  }
}

// Run the test
const testAddress = '0xc92fe1c5f324c58d0be12b8728be18a92375361f'
// User reported: started with $9.32, now has $0.47
const currentBalance = 0.47

debugWallet(testAddress, currentBalance)
  .then(metrics => {
    console.log('\n' + '='.repeat(80))
    console.log('Summary JSON:')
    console.log(JSON.stringify(metrics, null, 2))
  })
  .catch(console.error)
