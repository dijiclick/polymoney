/**
 * Goldsky Direct API client for TypeScript/Next.js
 *
 * Data strategy: Query Goldsky GraphQL subgraphs directly
 * - Trades (volume, trade counts) from CLOB subgraph
 * - Positions (PnL, win rate, ROI) from Activity subgraph
 * - Redemptions (resolved positions) from Activity subgraph
 *
 * Metrics Calculation:
 * - PnL = (sellVolume - buyVolume) + redemptionPayouts (includes trading profits)
 * - ROI = PnL / buyVolume * 100
 * - Win Rate = trades sold at profit / total completed trades
 * - Drawdown = max peak-to-trough decline in cumulative PnL
 *
 * Server-side usage only (API routes)
 */

// Goldsky GraphQL endpoints for direct queries (no Mirror tables needed)
const ORDERBOOK_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
const PNL_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
const ACTIVITY_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'

const DECIMALS = 1e6
const DEFAULT_LOOKBACK_DAYS = 30

export interface GoldskyMetrics {
  // 7-Day Metrics
  volume7d: number
  tradeCount7d: number
  pnl7d: number           // Realized PnL from sells + redemptions
  roi7d: number           // ROI based on buy volume
  winRate7d: number       // Based on profitable trades/redemptions
  drawdown7d: number      // Max drawdown percentage

  // 30-Day Metrics
  volume30d: number
  tradeCount30d: number
  pnl30d: number
  roi30d: number
  winRate30d: number
  drawdown30d: number

  // All-Time Summary
  winRateAll: number
  realizedPnl: number     // From positions subgraph
  unrealizedPnl: number   // Estimated from open positions
  totalPnl: number        // realized + unrealized
  roiAll: number

  // Position Counts
  openPositions: number
  closedPositions: number
  totalPositions: number
  winningPositions: number
  losingPositions: number

  // Additional
  uniqueMarkets: number
  totalInvested: number

  // Metadata
  tradesFetched: number
  positionsFetched: number
  lookbackDays: number
}

interface GoldskyTrade {
  timestamp: string
  maker: string
  taker: string
  makerAssetId: string
  takerAssetId: string
  makerAmountFilled: string
  takerAmountFilled: string
}

interface GoldskyPosition {
  tokenId: string
  amount: string
  avgPrice: string
  realizedPnl: string
  totalBought: string
}

interface GoldskyRedemption {
  timestamp: string
  payout: string
  collateral?: string // Amount paid to redeem (cost basis)
}

async function queryGoldsky(endpoint: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Goldsky API error: ${response.status}`)
  }

  const data = await response.json()
  if (data.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`)
  }

  return data.data
}

async function getTradesSince(address: string, sinceTimestamp: number, batchSize = 1000): Promise<GoldskyTrade[]> {
  const addressLower = address.toLowerCase()
  const allTrades: GoldskyTrade[] = []
  const seenIds = new Set<string>()

  // Query for trades where user is maker
  const makerQuery = `
    query($user: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: { maker: $user, timestamp_gte: $since }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `

  // Query for trades where user is taker
  const takerQuery = `
    query($user: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: { taker: $user, timestamp_gte: $since }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `

  // Fetch maker trades
  let skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(ORDERBOOK_SUBGRAPH, makerQuery, {
        user: addressLower,
        since: sinceTimestamp.toString(),
        first: batchSize,
        skip,
      }) as { orderFilledEvents: GoldskyTrade[] }

      if (!data.orderFilledEvents?.length) break
      for (const trade of data.orderFilledEvents) {
        const id = (trade as any).id || `${trade.timestamp}-${trade.maker}-${trade.taker}`
        if (!seenIds.has(id)) {
          seenIds.add(id)
          allTrades.push(trade)
        }
      }
      if (data.orderFilledEvents.length < batchSize) break
      skip += batchSize
    } catch (err) {
      console.error('Error fetching maker trades from Goldsky:', err)
      break
    }
  }

  // Fetch taker trades
  skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(ORDERBOOK_SUBGRAPH, takerQuery, {
        user: addressLower,
        since: sinceTimestamp.toString(),
        first: batchSize,
        skip,
      }) as { orderFilledEvents: GoldskyTrade[] }

      if (!data.orderFilledEvents?.length) break
      for (const trade of data.orderFilledEvents) {
        const id = (trade as any).id || `${trade.timestamp}-${trade.maker}-${trade.taker}`
        if (!seenIds.has(id)) {
          seenIds.add(id)
          allTrades.push(trade)
        }
      }
      if (data.orderFilledEvents.length < batchSize) break
      skip += batchSize
    } catch (err) {
      console.error('Error fetching taker trades from Goldsky:', err)
      break
    }
  }

  return allTrades
}

async function getUserPositions(address: string, batchSize = 1000): Promise<GoldskyPosition[]> {
  const addressLower = address.toLowerCase()
  const allPositions: GoldskyPosition[] = []

  // Query Goldsky GraphQL API directly for user positions
  const query = `
    query($user: String!, $first: Int!, $skip: Int!) {
      userPositions(
        where: { user: $user }
        first: $first
        skip: $skip
      ) {
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  let skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(PNL_SUBGRAPH, query, {
        user: addressLower,
        first: batchSize,
        skip,
      }) as { userPositions: GoldskyPosition[] }

      if (!data.userPositions?.length) break
      allPositions.push(...data.userPositions)
      if (data.userPositions.length < batchSize) break
      skip += batchSize
    } catch (err) {
      console.error('Error fetching positions from Goldsky:', err)
      break
    }
  }

  return allPositions
}

async function getRedemptions(address: string, sinceTimestamp: number, batchSize = 1000): Promise<GoldskyRedemption[]> {
  const addressLower = address.toLowerCase()
  const allRedemptions: GoldskyRedemption[] = []

  const query = `
    query($user: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
      redemptions(
        where: { redeemer: $user, timestamp_gte: $since }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        timestamp payout
      }
    }
  `

  let skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(ACTIVITY_SUBGRAPH, query, {
        user: addressLower, since: sinceTimestamp.toString(), first: batchSize, skip,
      }) as { redemptions: GoldskyRedemption[] }
      if (!data.redemptions?.length) break
      allRedemptions.push(...data.redemptions)
      if (data.redemptions.length < batchSize) break
      skip += batchSize
    } catch {
      break
    }
  }

  return allRedemptions
}

interface ParsedTrade {
  timestamp: number
  side: 'BUY' | 'SELL'
  usdValue: number
  tokenId: string  // To track per-token P&L
}

function parseTrade(trade: GoldskyTrade, address: string): ParsedTrade {
  const addressLower = address.toLowerCase()
  const timestamp = parseInt(trade.timestamp)
  const isMaker = trade.maker.toLowerCase() === addressLower

  const makerAmount = parseInt(trade.makerAmountFilled) / DECIMALS
  const takerAmount = parseInt(trade.takerAmountFilled) / DECIMALS

  let side: 'BUY' | 'SELL'
  let usdValue: number
  let tokenId: string

  if (isMaker) {
    if (trade.makerAssetId === '0') {
      // Maker gave USDC (BUY)
      side = 'BUY'
      usdValue = makerAmount
      tokenId = trade.takerAssetId
    } else {
      // Maker gave tokens (SELL)
      side = 'SELL'
      usdValue = takerAmount
      tokenId = trade.makerAssetId
    }
  } else {
    if (trade.takerAssetId === '0') {
      // Taker gave USDC (BUY)
      side = 'BUY'
      usdValue = takerAmount
      tokenId = trade.makerAssetId
    } else {
      // Taker gave tokens (SELL)
      side = 'SELL'
      usdValue = makerAmount
      tokenId = trade.takerAssetId
    }
  }

  return { timestamp, side, usdValue, tokenId }
}

interface TokenPnL {
  tokenId: string
  totalBought: number
  totalSold: number
  redemptionPayout: number
  netPnl: number
  isComplete: boolean // true if all tokens sold or redeemed
  isWin: boolean
}

/**
 * Calculate per-token P&L by matching buys with sells/redemptions
 */
function calculateTokenPnL(
  trades: ParsedTrade[],
  redemptions: GoldskyRedemption[]
): { tokenPnLs: Map<string, TokenPnL>; totalPnl: number; totalBuyVolume: number; totalSellVolume: number } {
  const tokenPnLs = new Map<string, TokenPnL>()

  // Group trades by token
  for (const trade of trades) {
    let pnl = tokenPnLs.get(trade.tokenId)
    if (!pnl) {
      pnl = {
        tokenId: trade.tokenId,
        totalBought: 0,
        totalSold: 0,
        redemptionPayout: 0,
        netPnl: 0,
        isComplete: false,
        isWin: false,
      }
      tokenPnLs.set(trade.tokenId, pnl)
    }

    if (trade.side === 'BUY') {
      pnl.totalBought += trade.usdValue
    } else {
      pnl.totalSold += trade.usdValue
    }
  }

  // Add redemption payouts (these are pure profit, we already paid for tokens via buys)
  for (const redemption of redemptions) {
    const payout = parseInt(redemption.payout || '0') / DECIMALS
    // We don't know which tokenId the redemption is for, so add to a special bucket
    // In reality, redemption is profit from a winning bet
    let pnl = tokenPnLs.get('__redemptions__')
    if (!pnl) {
      pnl = {
        tokenId: '__redemptions__',
        totalBought: 0,
        totalSold: 0,
        redemptionPayout: 0,
        netPnl: 0,
        isComplete: true,
        isWin: true,
      }
      tokenPnLs.set('__redemptions__', pnl)
    }
    pnl.redemptionPayout += payout
  }

  // Calculate net PnL for each token
  let totalPnl = 0
  let totalBuyVolume = 0
  let totalSellVolume = 0

  for (const pnl of tokenPnLs.values()) {
    // Net PnL = money out - money in
    // Sells and redemptions are money out, buys are money in
    pnl.netPnl = (pnl.totalSold + pnl.redemptionPayout) - pnl.totalBought
    pnl.isComplete = pnl.totalSold > 0 || pnl.redemptionPayout > 0
    pnl.isWin = pnl.netPnl > 0

    totalPnl += pnl.netPnl
    totalBuyVolume += pnl.totalBought
    totalSellVolume += pnl.totalSold + pnl.redemptionPayout
  }

  return { tokenPnLs, totalPnl, totalBuyVolume, totalSellVolume }
}

/**
 * Calculate drawdown from cumulative P&L curve
 *
 * Drawdown = (peak - trough) / peak * 100
 * We track running P&L and find the maximum decline from any peak
 */
interface DrawdownResult {
  percent: number   // Max drawdown as percentage of peak
  amount: number    // Max drawdown in dollar amount
}

function calculateDrawdown(trades: ParsedTrade[], redemptions: GoldskyRedemption[]): DrawdownResult {
  if (trades.length === 0) return { percent: 0, amount: 0 }

  // Create P&L events sorted by time
  interface PnLEvent {
    timestamp: number
    pnlDelta: number // positive = profit, negative = loss
  }

  const events: PnLEvent[] = []

  // For each trade: BUY = cost (negative), SELL = revenue (positive)
  for (const trade of trades) {
    events.push({
      timestamp: trade.timestamp,
      pnlDelta: trade.side === 'SELL' ? trade.usdValue : -trade.usdValue,
    })
  }

  // Redemptions are pure profit
  for (const r of redemptions) {
    const payout = parseInt(r.payout || '0') / DECIMALS
    events.push({
      timestamp: parseInt(r.timestamp),
      pnlDelta: payout,
    })
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp)

  // Calculate running P&L and track drawdown
  let cumulativePnL = 0
  let peakPnL = 0
  let maxDrawdown = 0

  for (const event of events) {
    cumulativePnL += event.pnlDelta

    // Update peak if we hit a new high
    if (cumulativePnL > peakPnL) {
      peakPnL = cumulativePnL
    }

    // Calculate current drawdown from peak
    if (peakPnL > 0) {
      const currentDrawdown = peakPnL - cumulativePnL
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown
      }
    }
  }

  // If peak is 0, negative, or too small (< $10), there's no meaningful drawdown
  // This avoids noise from very small positions that can show 100% drawdown
  if (peakPnL < 10) return { percent: 0, amount: 0 }

  const drawdownPercent = Math.round((maxDrawdown / peakPnL) * 100 * 100) / 100

  // Cap drawdown percentage at 100% (can't lose more than you made)
  return {
    percent: Math.min(drawdownPercent, 100),
    amount: Math.round(maxDrawdown * 100) / 100,
  }
}

/**
 * Calculate win rate from completed trades
 * A "win" is a token position that was sold or redeemed for more than it cost
 */
function calculateWinRate(tokenPnLs: Map<string, TokenPnL>): { winRate: number; wins: number; losses: number } {
  let wins = 0
  let losses = 0

  for (const pnl of tokenPnLs.values()) {
    // Only count completed positions (sold or redeemed)
    if (!pnl.isComplete) continue
    // Skip the redemptions bucket for counting individual wins
    if (pnl.tokenId === '__redemptions__') {
      // Redemptions are wins by definition
      wins++
      continue
    }

    if (pnl.netPnl > 0.01) {
      wins++
    } else if (pnl.netPnl < -0.01) {
      losses++
    }
    // Positions with ~0 PnL are not counted
  }

  const total = wins + losses
  const winRate = total > 0 ? (wins / total) * 100 : 0

  return { winRate, wins, losses }
}

interface PeriodMetrics {
  pnl: number
  roi: number
  winRate: number
  drawdown: number
  drawdownAmount: number
  buyVolume: number
  sellVolume: number
  wins: number
  losses: number
}

function calculatePeriodMetrics(
  trades: ParsedTrade[],
  redemptions: GoldskyRedemption[],
  periodLabel: string = 'unknown'
): PeriodMetrics {
  console.log(`\n========== PERIOD METRICS [${periodLabel}] ==========`)
  console.log(`Trades: ${trades.length}, Redemptions: ${redemptions.length}`)

  if (!trades.length && !redemptions.length) {
    console.log(`No activity for ${periodLabel}`)
    return { pnl: 0, roi: 0, winRate: 0, drawdown: 0, drawdownAmount: 0, buyVolume: 0, sellVolume: 0, wins: 0, losses: 0 }
  }

  // Calculate token-level P&L
  const { tokenPnLs, totalPnl, totalBuyVolume, totalSellVolume } = calculateTokenPnL(trades, redemptions)

  console.log(`Buy Volume: $${totalBuyVolume.toFixed(2)}`)
  console.log(`Sell Volume (incl. redemptions): $${totalSellVolume.toFixed(2)}`)
  console.log(`Net PnL: $${totalPnl.toFixed(2)}`)

  // Calculate ROI
  const roi = totalBuyVolume > 0 ? (totalPnl / totalBuyVolume) * 100 : 0
  console.log(`ROI: ${roi.toFixed(2)}%`)

  // Calculate win rate
  const { winRate, wins, losses } = calculateWinRate(tokenPnLs)
  console.log(`Win Rate: ${winRate.toFixed(2)}% (${wins} wins, ${losses} losses)`)

  // Calculate drawdown
  const drawdownResult = calculateDrawdown(trades, redemptions)
  console.log(`Drawdown: ${drawdownResult.percent.toFixed(2)}% ($${drawdownResult.amount.toFixed(2)})`)

  console.log(`========== END [${periodLabel}] ==========\n`)

  return {
    pnl: Math.round(totalPnl * 100) / 100,
    roi: Math.round(roi * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    drawdown: drawdownResult.percent,
    drawdownAmount: drawdownResult.amount,
    buyVolume: Math.round(totalBuyVolume * 100) / 100,
    sellVolume: Math.round(totalSellVolume * 100) / 100,
    wins,
    losses,
  }
}

/**
 * Estimate unrealized P&L from open positions
 * Uses avgPrice and amount from positions, estimates current value
 *
 * Note: This is an estimate since we don't have real-time prices
 * The actual unrealized PnL comes from Polymarket's portfolio value API
 */
function estimateUnrealizedPnL(positions: GoldskyPosition[]): { unrealizedPnl: number; openPositions: number } {
  let unrealizedPnl = 0
  let openPositions = 0

  for (const pos of positions) {
    const amount = parseInt(pos.amount || '0') / DECIMALS
    const avgPrice = parseInt(pos.avgPrice || '0') / DECIMALS
    const totalBought = parseInt(pos.totalBought || '0') / DECIMALS

    // Skip closed positions
    if (amount < 0.001) continue

    openPositions++

    // Estimate current value: assume market price is near avgPrice for now
    // This is a rough estimate - the real unrealized PnL comes from Polymarket API
    // We'll track cost basis for future use
    const costBasis = amount * avgPrice

    // For now, just report the position exists
    // Real unrealized P&L will be calculated when we have current prices
    // unrealizedPnl += currentValue - costBasis
    console.log(`Open position: tokenId=${pos.tokenId?.slice(0, 10)}, amount=${amount.toFixed(2)}, avgPrice=${avgPrice.toFixed(4)}, costBasis=$${costBasis.toFixed(2)}`)
  }

  return { unrealizedPnl, openPositions }
}

/**
 * Get complete trading metrics from Goldsky on-chain data.
 */
export async function getTraderMetrics(
  address: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<GoldskyMetrics> {
  console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`)
  console.log(`║          GOLDSKY METRICS - ${address.slice(0, 10)}...                    ║`)
  console.log(`╚══════════════════════════════════════════════════════════════════════╝`)

  const now = Date.now() / 1000
  const cutoff7d = Math.floor(now - 7 * 24 * 60 * 60)
  const cutoff30d = Math.floor(now - 30 * 24 * 60 * 60)

  // Fetch all data in parallel
  const [trades, positions, redemptions7d, redemptions30d] = await Promise.all([
    getTradesSince(address, cutoff30d).catch(() => [] as GoldskyTrade[]),
    getUserPositions(address).catch(() => [] as GoldskyPosition[]),
    getRedemptions(address, cutoff7d).catch(() => [] as GoldskyRedemption[]),
    getRedemptions(address, cutoff30d).catch(() => [] as GoldskyRedemption[]),
  ])

  console.log(`\n📊 Data fetched: ${trades.length} trades, ${positions.length} positions`)
  console.log(`   Redemptions: 7d=${redemptions7d.length}, 30d=${redemptions30d.length}`)

  // Parse trades and filter by time period
  const parsedTrades = trades.map(t => parseTrade(t, address))
  const trades7d = parsedTrades.filter(t => t.timestamp >= cutoff7d)
  const trades30d = parsedTrades

  // Calculate volume
  const volume7d = trades7d.reduce((sum, t) => sum + t.usdValue, 0)
  const volume30d = trades30d.reduce((sum, t) => sum + t.usdValue, 0)

  // Calculate period metrics (PnL, ROI, win rate, drawdown)
  const metrics7d = calculatePeriodMetrics(trades7d, redemptions7d, '7d')
  const metrics30d = calculatePeriodMetrics(trades30d, redemptions30d, '30d')

  // Calculate all-time position metrics
  let totalRealizedPnl = 0
  let totalBought = 0
  let winningPositions = 0
  let losingPositions = 0
  const uniqueMarkets = new Set<string>()

  for (const pos of positions) {
    const realizedPnl = parseInt(pos.realizedPnl || '0') / DECIMALS
    const amount = parseInt(pos.amount || '0') / DECIMALS
    const bought = parseInt(pos.totalBought || '0') / DECIMALS

    totalRealizedPnl += realizedPnl
    totalBought += bought

    if (pos.tokenId) {
      uniqueMarkets.add(pos.tokenId)
    }

    // Count closed positions by realized PnL
    if (amount < 0.001) { // Position is closed
      if (realizedPnl > 0.01) {
        winningPositions++
      } else if (realizedPnl < -0.01) {
        losingPositions++
      }
    }
  }

  // Estimate unrealized P&L
  const { unrealizedPnl, openPositions } = estimateUnrealizedPnL(positions)

  const closedPositions = winningPositions + losingPositions
  const winRateAll = closedPositions > 0 ? (winningPositions / closedPositions) * 100 : 0
  const roiAll = totalBought > 0 ? (totalRealizedPnl / totalBought) * 100 : 0
  const totalPnl = totalRealizedPnl + unrealizedPnl

  console.log(`\n📈 All-Time: PnL=$${totalRealizedPnl.toFixed(2)}, ROI=${roiAll.toFixed(2)}%, WinRate=${winRateAll.toFixed(2)}%`)
  console.log(`   Positions: ${openPositions} open, ${closedPositions} closed (${winningPositions}W/${losingPositions}L)`)

  return {
    // 7-Day Metrics
    volume7d: Math.round(volume7d * 100) / 100,
    tradeCount7d: trades7d.length,
    pnl7d: metrics7d.pnl,
    roi7d: metrics7d.roi,
    winRate7d: metrics7d.winRate,
    drawdown7d: metrics7d.drawdown,

    // 30-Day Metrics
    volume30d: Math.round(volume30d * 100) / 100,
    tradeCount30d: trades30d.length,
    pnl30d: metrics30d.pnl,
    roi30d: metrics30d.roi,
    winRate30d: metrics30d.winRate,
    drawdown30d: metrics30d.drawdown,

    // All-Time Summary
    winRateAll: Math.round(winRateAll * 100) / 100,
    realizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    roiAll: Math.round(roiAll * 100) / 100,

    // Position Counts
    openPositions,
    closedPositions,
    totalPositions: openPositions + closedPositions,
    winningPositions,
    losingPositions,

    // Additional
    uniqueMarkets: uniqueMarkets.size,
    totalInvested: Math.round(totalBought * 100) / 100,

    // Metadata
    tradesFetched: trades.length,
    positionsFetched: positions.length,
    lookbackDays,
  }
}

// ============================================
// COPY-TRADE METRICS (Goldsky-sourced)
// ============================================

export interface GoldskyFullMetrics extends GoldskyMetrics {
  // Copy-trade metrics
  profitFactor30d: number
  profitFactorAll: number
  weeklyProfitRate: number
  copyScore: number
  avgTradesPerDay: number
  medianProfitPct: number | null
  // All-time breakdown
  volumeAll: number
  tradeCountAll: number
  drawdownAll: number
  drawdownAmountAll: number
  grossWins30d: number
  grossLosses30d: number
}

function calcProfitFactor(tokenPnLs: Map<string, TokenPnL>): number {
  let grossWins = 0
  let grossLosses = 0
  for (const pnl of tokenPnLs.values()) {
    if (!pnl.isComplete) continue
    if (pnl.netPnl > 0.01) grossWins += pnl.netPnl
    else if (pnl.netPnl < -0.01) grossLosses += Math.abs(pnl.netPnl)
  }
  if (grossLosses > 0) return Math.round((grossWins / grossLosses) * 100) / 100
  if (grossWins > 0) return 10.0
  return 0
}

function calcGrossWinsLosses(tokenPnLs: Map<string, TokenPnL>): { grossWins: number; grossLosses: number } {
  let grossWins = 0
  let grossLosses = 0
  for (const pnl of tokenPnLs.values()) {
    if (!pnl.isComplete) continue
    if (pnl.netPnl > 0.01) grossWins += pnl.netPnl
    else if (pnl.netPnl < -0.01) grossLosses += Math.abs(pnl.netPnl)
  }
  return { grossWins, grossLosses }
}

function calcWeeklyProfitRate(trades: ParsedTrade[], redemptions: GoldskyRedemption[]): number {
  if (!trades.length && !redemptions.length) return 0

  const weekPnl = new Map<string, number>()

  // Group trade PnL by ISO week
  for (const trade of trades) {
    const d = new Date(trade.timestamp * 1000)
    const iso = getISOWeek(d)
    const current = weekPnl.get(iso) || 0
    weekPnl.set(iso, current + (trade.side === 'SELL' ? trade.usdValue : -trade.usdValue))
  }

  // Add redemption payouts
  for (const r of redemptions) {
    const payout = parseInt(r.payout || '0') / DECIMALS
    const d = new Date(parseInt(r.timestamp) * 1000)
    const iso = getISOWeek(d)
    const current = weekPnl.get(iso) || 0
    weekPnl.set(iso, current + payout)
  }

  if (weekPnl.size === 0) return 0
  const profitable = Array.from(weekPnl.values()).filter(v => v > 0).length
  return Math.round((profitable / weekPnl.size) * 100 * 100) / 100
}

function getISOWeek(d: Date): string {
  const year = d.getUTCFullYear()
  // ISO week calculation
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfYear = Math.floor((d.getTime() - new Date(Date.UTC(year, 0, 1)).getTime()) / 86400000) + 1
  const weekNum = Math.ceil((dayOfYear + jan4.getUTCDay() - 1) / 7)
  return `${year}-W${String(weekNum).padStart(2, '0')}`
}

function calcAvgTradesPerDay(trades: ParsedTrade[]): number {
  if (!trades.length) return 0
  const activeDays = new Set<string>()
  const uniqueTokens = new Set<string>()
  for (const t of trades) {
    const d = new Date(t.timestamp * 1000)
    activeDays.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`)
    uniqueTokens.add(t.tokenId)
  }
  if (activeDays.size === 0) return 0
  return Math.round((uniqueTokens.size / activeDays.size) * 100) / 100
}

function calcMedianProfitPct(tokenPnLs: Map<string, TokenPnL>): number | null {
  const profitPcts: number[] = []
  for (const pnl of tokenPnLs.values()) {
    if (!pnl.isComplete || pnl.tokenId === '__redemptions__') continue
    if (pnl.totalBought <= 0) continue
    const pct = (pnl.netPnl / pnl.totalBought) * 100
    profitPcts.push(pct)
  }

  if (profitPcts.length < 3) return null

  profitPcts.sort((a, b) => a - b)
  const n = profitPcts.length

  const q1Idx = n * 0.25
  const q3Idx = n * 0.75
  const interpolate = (arr: number[], idx: number) => {
    const lower = Math.floor(idx)
    const upper = Math.min(lower + 1, arr.length - 1)
    const weight = idx - lower
    return arr[lower] * (1 - weight) + arr[upper] * weight
  }
  const q1 = interpolate(profitPcts, q1Idx)
  const q3 = interpolate(profitPcts, q3Idx)
  const iqr = q3 - q1

  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr
  const filtered = profitPcts.filter(p => p >= lowerBound && p <= upperBound)
  if (!filtered.length) return null

  filtered.sort((a, b) => a - b)
  const mid = Math.floor(filtered.length / 2)
  const median = filtered.length % 2 === 0
    ? (filtered[mid - 1] + filtered[mid]) / 2
    : filtered[mid]

  return Math.round(median * 100) / 100
}

function calcCopyScore(params: {
  profitFactor30d: number
  drawdown30d: number
  weeklyProfitRate: number
  tradeCountAll: number
  medianProfitPct: number | null
  avgTradesPerDay: number
}): number {
  const { profitFactor30d, drawdown30d, weeklyProfitRate, tradeCountAll, medianProfitPct, avgTradesPerDay } = params

  // Hard filters
  if (tradeCountAll < 30) return 0
  if (profitFactor30d < 1.2) return 0
  if (medianProfitPct === null || medianProfitPct < 5.0) return 0
  if (avgTradesPerDay < 2 || avgTradesPerDay > 15) return 0

  // Pillar 1: Edge (40%) - Profit Factor 1.2→0, 3.0+→1.0
  const edgeScore = Math.min((profitFactor30d - 1.2) / (3.0 - 1.2), 1.0)

  // Pillar 2: Consistency (35%) - Weekly profit rate 40%→0, 85%+→1.0
  const consistencyScore = Math.min(Math.max((weeklyProfitRate - 40) / (85 - 40), 0), 1.0)

  // Pillar 3: Risk (25%) - Drawdown 5%→1.0, 25%+→0
  let riskScore: number
  if (drawdown30d <= 0) riskScore = 1.0
  else riskScore = Math.min(Math.max((25 - drawdown30d) / (25 - 5), 0), 1.0)

  const rawScore = (edgeScore * 0.40 + consistencyScore * 0.35 + riskScore * 0.25) * 100
  const confidence = Math.min(1.0, tradeCountAll / 50)
  return Math.min(Math.round(rawScore * confidence), 100)
}

/**
 * Get complete metrics + copy-trade score from Goldsky on-chain data.
 * Fetches ALL available trade history for accurate copy-score calculation.
 */
export async function getTraderMetricsWithCopyScore(address: string): Promise<GoldskyFullMetrics> {
  const now = Date.now() / 1000
  const cutoff7d = Math.floor(now - 7 * 24 * 60 * 60)
  const cutoff30d = Math.floor(now - 30 * 24 * 60 * 60)
  const cutoffAll = 0

  // Fetch ALL data in parallel
  const [allTradesRaw, positions, redemptions7d, redemptions30d, redemptionsAll] = await Promise.all([
    getTradesSince(address, cutoffAll).catch(() => [] as GoldskyTrade[]),
    getUserPositions(address).catch(() => [] as GoldskyPosition[]),
    getRedemptions(address, cutoff7d).catch(() => [] as GoldskyRedemption[]),
    getRedemptions(address, cutoff30d).catch(() => [] as GoldskyRedemption[]),
    getRedemptions(address, cutoffAll).catch(() => [] as GoldskyRedemption[]),
  ])

  // Parse all trades
  const parsedAll = allTradesRaw.map(t => parseTrade(t, address))
  const parsed7d = parsedAll.filter(t => t.timestamp >= cutoff7d)
  const parsed30d = parsedAll.filter(t => t.timestamp >= cutoff30d)

  // Volume
  const volume7d = parsed7d.reduce((sum, t) => sum + t.usdValue, 0)
  const volume30d = parsed30d.reduce((sum, t) => sum + t.usdValue, 0)
  const volumeAll = parsedAll.reduce((sum, t) => sum + t.usdValue, 0)

  // Period metrics
  const metrics7d = calculatePeriodMetrics(parsed7d, redemptions7d, '7d')
  const metrics30d = calculatePeriodMetrics(parsed30d, redemptions30d, '30d')
  const metricsAll = calculatePeriodMetrics(parsedAll, redemptionsAll, 'all')

  // All-time position metrics from PnL subgraph
  let totalRealizedPnl = 0
  let totalBought = 0
  let winningPositions = 0
  let losingPositions = 0
  const uniqueMarkets = new Set<string>()

  for (const pos of positions) {
    const realizedPnl = parseInt(pos.realizedPnl || '0') / DECIMALS
    const amount = parseInt(pos.amount || '0') / DECIMALS
    const bought = parseInt(pos.totalBought || '0') / DECIMALS

    totalRealizedPnl += realizedPnl
    totalBought += bought
    if (pos.tokenId) uniqueMarkets.add(pos.tokenId)

    if (amount < 0.001) {
      if (realizedPnl > 0.01) winningPositions++
      else if (realizedPnl < -0.01) losingPositions++
    }
  }

  const { unrealizedPnl, openPositions } = estimateUnrealizedPnL(positions)
  const closedPositions = winningPositions + losingPositions
  const winRateAll = closedPositions > 0 ? (winningPositions / closedPositions) * 100 : 0
  const roiAll = totalBought > 0 ? (totalRealizedPnl / totalBought) * 100 : 0
  const totalPnl = totalRealizedPnl + unrealizedPnl

  // Copy-trade metrics
  const { tokenPnLs: tokenPnLs30d } = calculateTokenPnL(parsed30d, redemptions30d)
  const { tokenPnLs: tokenPnLsAll } = calculateTokenPnL(parsedAll, redemptionsAll)

  const profitFactor30d = calcProfitFactor(tokenPnLs30d)
  const profitFactorAll = calcProfitFactor(tokenPnLsAll)
  const { grossWins: grossWins30d, grossLosses: grossLosses30d } = calcGrossWinsLosses(tokenPnLs30d)
  const weeklyProfitRate = calcWeeklyProfitRate(parsedAll, redemptionsAll)
  const avgTradesPerDay = calcAvgTradesPerDay(parsedAll)
  const medianProfitPct = calcMedianProfitPct(tokenPnLsAll)

  const copyScore = calcCopyScore({
    profitFactor30d,
    drawdown30d: metrics30d.drawdown,
    weeklyProfitRate,
    tradeCountAll: parsedAll.length,
    medianProfitPct,
    avgTradesPerDay,
  })

  return {
    // 7-Day
    volume7d: Math.round(volume7d * 100) / 100,
    tradeCount7d: parsed7d.length,
    pnl7d: metrics7d.pnl,
    roi7d: metrics7d.roi,
    winRate7d: metrics7d.winRate,
    drawdown7d: metrics7d.drawdown,

    // 30-Day
    volume30d: Math.round(volume30d * 100) / 100,
    tradeCount30d: parsed30d.length,
    pnl30d: metrics30d.pnl,
    roi30d: metrics30d.roi,
    winRate30d: metrics30d.winRate,
    drawdown30d: metrics30d.drawdown,

    // All-Time Summary
    winRateAll: Math.round(winRateAll * 100) / 100,
    realizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    roiAll: Math.round(roiAll * 100) / 100,

    // Position Counts
    openPositions,
    closedPositions,
    totalPositions: openPositions + closedPositions,
    winningPositions,
    losingPositions,

    // Additional
    uniqueMarkets: uniqueMarkets.size,
    totalInvested: Math.round(totalBought * 100) / 100,

    // Metadata
    tradesFetched: allTradesRaw.length,
    positionsFetched: positions.length,
    lookbackDays: 36500,

    // Copy-trade metrics
    profitFactor30d,
    profitFactorAll,
    weeklyProfitRate,
    copyScore,
    avgTradesPerDay,
    medianProfitPct,
    volumeAll: Math.round(volumeAll * 100) / 100,
    tradeCountAll: parsedAll.length,
    drawdownAll: metricsAll.drawdown,
    drawdownAmountAll: metricsAll.drawdownAmount,
    grossWins30d: Math.round(grossWins30d * 100) / 100,
    grossLosses30d: Math.round(grossLosses30d * 100) / 100,
  }
}
