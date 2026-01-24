/**
 * Goldsky GraphQL API client for TypeScript/Next.js
 *
 * Fetches ALL metrics from on-chain data via Goldsky subgraphs:
 * - Trades (volume, trade counts) from orderbook subgraph
 * - Positions (PnL, win rate, ROI) from PnL subgraph
 * - Redemptions (resolved positions) from activity subgraph
 *
 * No need for Polymarket REST API for metrics.
 * Server-side usage only (API routes)
 */

// Goldsky subgraph endpoints
const ORDERBOOK_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
const PNL_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
const ACTIVITY_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'

const DECIMALS = 1e6
const DEFAULT_LOOKBACK_DAYS = 30

export interface GoldskyMetrics {
  // 7-Day Metrics
  volume7d: number
  tradeCount7d: number
  pnl7d: number
  roi7d: number
  winRate7d: number
  drawdown7d: number

  // 30-Day Metrics
  volume30d: number
  tradeCount30d: number
  pnl30d: number
  roi30d: number
  winRate30d: number
  drawdown30d: number

  // All-Time Summary (lightweight)
  winRateAll: number
  realizedPnl: number
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

  // Maker trades query
  const makerQuery = `
    query($address: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
      trades: orderFilledEvents(
        where: { maker: $address, timestamp_gte: $since }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        timestamp maker taker makerAssetId takerAssetId makerAmountFilled takerAmountFilled
      }
    }
  `

  // Fetch maker trades
  let skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(ORDERBOOK_SUBGRAPH, makerQuery, {
        address: addressLower, since: sinceTimestamp.toString(), first: batchSize, skip,
      }) as { trades: GoldskyTrade[] }
      if (!data.trades?.length) break
      allTrades.push(...data.trades)
      if (data.trades.length < batchSize) break
      skip += batchSize
    } catch {
      break
    }
  }

  // Taker trades query
  const takerQuery = makerQuery.replace('maker:', 'taker:')
  skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(ORDERBOOK_SUBGRAPH, takerQuery, {
        address: addressLower, since: sinceTimestamp.toString(), first: batchSize, skip,
      }) as { trades: GoldskyTrade[] }
      if (!data.trades?.length) break
      allTrades.push(...data.trades)
      if (data.trades.length < batchSize) break
      skip += batchSize
    } catch {
      break
    }
  }

  return allTrades
}

async function getUserPositions(address: string, batchSize = 1000): Promise<GoldskyPosition[]> {
  const addressLower = address.toLowerCase()
  const allPositions: GoldskyPosition[] = []

  const query = `
    query($user: String!, $first: Int!, $skip: Int!) {
      userPositions(where: { user: $user }, first: $first, skip: $skip) {
        tokenId amount avgPrice realizedPnl totalBought
      }
    }
  `

  let skip = 0
  while (true) {
    try {
      const data = await queryGoldsky(PNL_SUBGRAPH, query, {
        user: addressLower, first: batchSize, skip,
      }) as { userPositions: GoldskyPosition[] }
      if (!data.userPositions?.length) break
      allPositions.push(...data.userPositions)
      if (data.userPositions.length < batchSize) break
      skip += batchSize
    } catch {
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
  side: string
  usdValue: number
  cashFlow: number
}

function parseTrade(trade: GoldskyTrade, address: string): ParsedTrade {
  const addressLower = address.toLowerCase()
  const timestamp = parseInt(trade.timestamp)
  const isMaker = trade.maker.toLowerCase() === addressLower

  const makerAmount = parseInt(trade.makerAmountFilled) / DECIMALS
  const takerAmount = parseInt(trade.takerAmountFilled) / DECIMALS

  let side: string
  let usdValue: number
  let cashFlow: number

  if (isMaker) {
    if (trade.makerAssetId === '0') {
      // Maker gave USDC (BUY) - cash outflow
      side = 'BUY'
      usdValue = makerAmount
      cashFlow = -makerAmount
    } else {
      // Maker gave tokens (SELL) - cash inflow
      side = 'SELL'
      usdValue = takerAmount
      cashFlow = takerAmount
    }
  } else {
    if (trade.takerAssetId === '0') {
      // Taker gave USDC (BUY) - cash outflow
      side = 'BUY'
      usdValue = takerAmount
      cashFlow = -takerAmount
    } else {
      // Taker gave tokens (SELL) - cash inflow
      side = 'SELL'
      usdValue = makerAmount
      cashFlow = makerAmount
    }
  }

  return { timestamp, side, usdValue, cashFlow }
}

function calculatePeriodMetrics(
  trades: ParsedTrade[],
  redemptions: GoldskyRedemption[]
): { roi: number; drawdown: number; buyVolume: number; sellVolume: number } {
  if (!trades.length) {
    return { roi: 0, drawdown: 0, buyVolume: 0, sellVolume: 0 }
  }

  // Calculate buy/sell volumes
  const buyVolume = trades.filter(t => t.side === 'BUY').reduce((sum, t) => sum + t.usdValue, 0)
  const sellVolume = trades.filter(t => t.side === 'SELL').reduce((sum, t) => sum + t.usdValue, 0)

  // Add redemption payouts to returns
  const redemptionPayouts = redemptions.reduce((sum, r) => sum + parseInt(r.payout || '0') / DECIMALS, 0)

  // ROI = (returns - investment) / investment * 100
  const totalReturns = sellVolume + redemptionPayouts
  const roi = buyVolume > 0 ? ((totalReturns - buyVolume) / buyVolume) * 100 : 0

  // Calculate drawdown from cumulative cash flow
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp)

  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0

  for (const trade of sortedTrades) {
    cumulative += trade.cashFlow
    if (cumulative > peak) {
      peak = cumulative
    }
    const drawdown = peak - cumulative
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }
  }

  // Drawdown as percentage of peak (if peak > 0)
  const drawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0

  return {
    roi: Math.round(roi * 100) / 100,
    drawdown: Math.round(drawdownPct * 100) / 100,
    buyVolume: Math.round(buyVolume * 100) / 100,
    sellVolume: Math.round(sellVolume * 100) / 100,
  }
}

/**
 * Get complete trading metrics from Goldsky on-chain data.
 *
 * This fetches ALL metrics including:
 * - Volume (7d, 30d)
 * - Trade count (7d, 30d)
 * - PnL (7d, 30d)
 * - Win rate (7d, 30d)
 * - ROI (7d, 30d)
 * - Drawdown (7d, 30d)
 * - Position counts (open, closed, wins, losses)
 */
export async function getTraderMetrics(
  address: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<GoldskyMetrics> {
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

  // Parse trades and filter by time period
  const parsedTrades = trades.map(t => parseTrade(t, address))
  const trades7d = parsedTrades.filter(t => t.timestamp >= cutoff7d)
  const trades30d = parsedTrades

  // Calculate volume
  const volume7d = trades7d.reduce((sum, t) => sum + t.usdValue, 0)
  const volume30d = trades30d.reduce((sum, t) => sum + t.usdValue, 0)

  // Calculate ROI and drawdown for each period
  const metrics7d = calculatePeriodMetrics(trades7d, redemptions7d)
  const metrics30d = calculatePeriodMetrics(trades30d, redemptions30d)

  // Calculate position metrics (all-time from positions subgraph)
  let totalRealizedPnl = 0
  let totalBought = 0
  let openPositions = 0
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

    if (amount > 0.001) {
      openPositions++
    } else if (realizedPnl > 0.01) {
      winningPositions++
    } else if (realizedPnl < -0.01) {
      losingPositions++
    }
  }

  const closedPositions = winningPositions + losingPositions
  const winRateAll = closedPositions > 0 ? (winningPositions / closedPositions) * 100 : 0
  const roiAll = totalBought > 0 ? (totalRealizedPnl / totalBought) * 100 : 0

  // Calculate time-period win rates from redemptions
  const wins7d = redemptions7d.filter(r => parseInt(r.payout || '0') > 0).length
  const winRate7d = redemptions7d.length > 0 ? (wins7d / redemptions7d.length) * 100 : 0

  const wins30d = redemptions30d.filter(r => parseInt(r.payout || '0') > 0).length
  const winRate30d = redemptions30d.length > 0 ? (wins30d / redemptions30d.length) * 100 : 0

  // Calculate PnL for time periods
  const pnl7d = redemptions7d.reduce((sum, r) => sum + parseInt(r.payout || '0') / DECIMALS, 0)
  const pnl30d = redemptions30d.reduce((sum, r) => sum + parseInt(r.payout || '0') / DECIMALS, 0)

  return {
    // 7-Day Metrics
    volume7d: Math.round(volume7d * 100) / 100,
    tradeCount7d: trades7d.length,
    pnl7d: Math.round(pnl7d * 100) / 100,
    roi7d: metrics7d.roi,
    winRate7d: Math.round(winRate7d * 100) / 100,
    drawdown7d: metrics7d.drawdown,

    // 30-Day Metrics
    volume30d: Math.round(volume30d * 100) / 100,
    tradeCount30d: trades30d.length,
    pnl30d: Math.round(pnl30d * 100) / 100,
    roi30d: metrics30d.roi,
    winRate30d: Math.round(winRate30d * 100) / 100,
    drawdown30d: metrics30d.drawdown,

    // All-Time Summary (lightweight)
    winRateAll: Math.round(winRateAll * 100) / 100,
    realizedPnl: Math.round(totalRealizedPnl * 100) / 100,
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
