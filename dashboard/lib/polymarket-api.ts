/**
 * Polymarket Data API client for TypeScript/Next.js
 * Server-side usage only (API routes)
 */

import {
  PolymarketPosition,
  PolymarketClosedPosition,
  TraderMetrics,
  TimePeriodMetrics,
  RawPolymarketPosition,
  RawPolymarketClosedPosition,
  ParsedTrade,
} from './types/trader'

const DATA_API_BASE = 'https://data-api.polymarket.com'
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com'

// Concurrency limit for parallel API requests - SAFE (avoids Cloudflare rate limits)
const PARALLEL_BATCH_SIZE = 10  // Fetch 10 pages at once (500 items per batch)

export interface TraderProfile {
  createdAt?: string
  pseudonym?: string
  name?: string
  profileImage?: string
  bio?: string
  xUsername?: string
  verifiedBadge?: boolean
}

/**
 * Get a trader's public profile from Gamma API
 */
export async function getProfile(address: string): Promise<TraderProfile> {
  try {
    const response = await fetch(`${GAMMA_API_BASE}/public-profile?address=${address}`)
    if (!response.ok) {
      return {}
    }
    return await response.json()
  } catch (error) {
    console.error(`Error getting profile for ${address}:`, error)
    return {}
  }
}

/**
 * Get a trader's portfolio value
 */
export async function getPortfolioValue(address: string): Promise<number> {
  try {
    const response = await fetch(`${DATA_API_BASE}/value?user=${address}`)
    if (!response.ok) {
      if (response.status === 404) return 0
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    if (Array.isArray(data) && data.length > 0) {
      return parseFloat(data[0]?.value || '0')
    }
    return 0
  } catch (error) {
    console.error(`Error getting portfolio value for ${address}:`, error)
    return 0
  }
}

/**
 * Fetch a single page of data from an API endpoint
 */
async function fetchPage<T>(url: string): Promise<{ data: T[]; ok: boolean }> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) return { data: [], ok: true }
      return { data: [], ok: false }
    }
    const data = await response.json()
    return { data: Array.isArray(data) ? data : [], ok: true }
  } catch {
    return { data: [], ok: false }
  }
}

/**
 * Get a trader's open positions with parallel pagination
 * Fetches multiple pages concurrently for faster data retrieval
 */
export async function getPositions(address: string, maxPositions: number = 10000): Promise<RawPolymarketPosition[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allPositions: RawPolymarketPosition[] = []

  try {
    // First, fetch page 0 to check if there's data
    const firstUrl = `${DATA_API_BASE}/positions?user=${address}&limit=${PAGE_SIZE}&offset=0`
    const firstPage = await fetchPage<RawPolymarketPosition>(firstUrl)

    if (!firstPage.ok || firstPage.data.length === 0) {
      return allPositions
    }

    allPositions.push(...firstPage.data)

    // If first page is not full, we're done
    if (firstPage.data.length < PAGE_SIZE) {
      return allPositions
    }

    // Fetch remaining pages in parallel batches
    let offset = PAGE_SIZE
    while (offset < maxPositions) {
      // Create batch of page requests
      const batchUrls: string[] = []
      for (let i = 0; i < PARALLEL_BATCH_SIZE && offset < maxPositions; i++) {
        batchUrls.push(`${DATA_API_BASE}/positions?user=${address}&limit=${PAGE_SIZE}&offset=${offset}`)
        offset += PAGE_SIZE
      }

      // Fetch batch in parallel
      const results = await Promise.all(batchUrls.map(url => fetchPage<RawPolymarketPosition>(url)))

      // Process results in order
      let hasMore = true
      for (const result of results) {
        if (!result.ok || result.data.length === 0) {
          hasMore = false
          break
        }
        allPositions.push(...result.data)
        if (result.data.length < PAGE_SIZE) {
          hasMore = false
          break
        }
      }

      if (!hasMore) break
    }

    return allPositions.slice(0, maxPositions)
  } catch (error) {
    console.error(`Error getting positions for ${address}:`, error)
    return allPositions
  }
}

/**
 * Get a trader's closed/resolved positions with parallel pagination
 * Fetches multiple pages concurrently for faster data retrieval
 * @param address - Wallet address
 * @param maxPositions - Maximum positions to fetch (default 10000)
 * @param days - Only include positions from last N days (0 = all history, default 0)
 */
export async function getClosedPositions(
  address: string,
  maxPositions: number = 10000,
  days: number = 0
): Promise<RawPolymarketClosedPosition[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allPositions: RawPolymarketClosedPosition[] = []
  const baseUrl = `${DATA_API_BASE}/closed-positions?user=${address}&limit=${PAGE_SIZE}&sortBy=TIMESTAMP&sortDirection=DESC`

  try {
    // First, fetch page 0 to check if there's data
    const firstPage = await fetchPage<RawPolymarketClosedPosition>(`${baseUrl}&offset=0`)

    if (!firstPage.ok || firstPage.data.length === 0) {
      return allPositions
    }

    // For date filtering, use sequential fetching (early termination needed)
    if (days > 0) {
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
      let offset = 0

      while (offset < maxPositions) {
        const page = offset === 0 ? firstPage : await fetchPage<RawPolymarketClosedPosition>(`${baseUrl}&offset=${offset}`)

        if (!page.ok || page.data.length === 0) break

        let reachedOldData = false
        for (const pos of page.data) {
          let posTime = 0
          if (pos.timestamp) {
            posTime = typeof pos.timestamp === 'number' ? pos.timestamp * 1000 : new Date(pos.timestamp).getTime()
          } else if (pos.resolvedAt) {
            posTime = new Date(pos.resolvedAt).getTime()
          } else if (pos.endDate) {
            posTime = new Date(pos.endDate).getTime()
          }

          if (posTime >= cutoffMs || posTime === 0) {
            allPositions.push(pos)
          } else if (posTime > 0 && posTime < cutoffMs) {
            reachedOldData = true
            break
          }
        }

        if (reachedOldData || page.data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      return allPositions.slice(0, maxPositions)
    }

    // No date filter - use parallel fetching for all history
    allPositions.push(...firstPage.data)

    if (firstPage.data.length < PAGE_SIZE) {
      return allPositions
    }

    // Fetch remaining pages in parallel batches
    let offset = PAGE_SIZE
    while (offset < maxPositions) {
      const batchUrls: string[] = []
      for (let i = 0; i < PARALLEL_BATCH_SIZE && offset < maxPositions; i++) {
        batchUrls.push(`${baseUrl}&offset=${offset}`)
        offset += PAGE_SIZE
      }

      const results = await Promise.all(batchUrls.map(url => fetchPage<RawPolymarketClosedPosition>(url)))

      let hasMore = true
      for (const result of results) {
        if (!result.ok || result.data.length === 0) {
          hasMore = false
          break
        }
        allPositions.push(...result.data)
        if (result.data.length < PAGE_SIZE) {
          hasMore = false
          break
        }
      }

      if (!hasMore) break
    }

    return allPositions.slice(0, maxPositions)
  } catch (error) {
    console.error(`Error getting closed positions for ${address}:`, error)
    return allPositions
  }
}

/**
 * Get a trader's activity history with parallel pagination
 * Fetches multiple pages concurrently for faster data retrieval
 * @param address - Wallet address
 * @param maxActivities - Maximum activities to fetch (default 10000)
 * @param days - Only include activities from last N days (0 = all history, default 0)
 */
export async function getActivity(
  address: string,
  maxActivities: number = 10000,
  days: number = 0
): Promise<unknown[]> {
  const PAGE_SIZE = 50 // API hard cap
  const allActivities: unknown[] = []
  const baseUrl = `${DATA_API_BASE}/activity?user=${address}&limit=${PAGE_SIZE}`

  try {
    // First, fetch page 0 to check if there's data
    const firstPage = await fetchPage<unknown>(`${baseUrl}&offset=0`)

    if (!firstPage.ok || firstPage.data.length === 0) {
      return allActivities
    }

    // For date filtering, use sequential fetching (early termination needed)
    if (days > 0) {
      const cutoffTimestamp = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000)
      let offset = 0

      while (offset < maxActivities) {
        const page = offset === 0 ? firstPage : await fetchPage<unknown>(`${baseUrl}&offset=${offset}`)

        if (!page.ok || page.data.length === 0) break

        let reachedOldData = false
        for (const activity of page.data) {
          const activityData = activity as { timestamp?: number }
          const activityTime = activityData.timestamp || 0

          if (activityTime >= cutoffTimestamp || activityTime === 0) {
            allActivities.push(activity)
          } else if (activityTime > 0 && activityTime < cutoffTimestamp) {
            reachedOldData = true
            break
          }
        }

        if (reachedOldData || page.data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      return allActivities.slice(0, maxActivities)
    }

    // No date filter - use parallel fetching for all history
    allActivities.push(...firstPage.data)

    if (firstPage.data.length < PAGE_SIZE) {
      return allActivities
    }

    // Fetch remaining pages in parallel batches
    let offset = PAGE_SIZE
    while (offset < maxActivities) {
      const batchUrls: string[] = []
      for (let i = 0; i < PARALLEL_BATCH_SIZE && offset < maxActivities; i++) {
        batchUrls.push(`${baseUrl}&offset=${offset}`)
        offset += PAGE_SIZE
      }

      const results = await Promise.all(batchUrls.map(url => fetchPage<unknown>(url)))

      let hasMore = true
      for (const result of results) {
        if (!result.ok || result.data.length === 0) {
          hasMore = false
          break
        }
        allActivities.push(...result.data)
        if (result.data.length < PAGE_SIZE) {
          hasMore = false
          break
        }
      }

      if (!hasMore) break
    }

    return allActivities.slice(0, maxActivities)
  } catch (error) {
    console.error(`Error getting activity for ${address}:`, error)
    return allActivities
  }
}

/**
 * Parse raw positions into typed positions
 */
export function parsePositions(rawPositions: RawPolymarketPosition[]): PolymarketPosition[] {
  return rawPositions.map((pos) => ({
    conditionId: pos.conditionId,
    asset: pos.asset,
    marketSlug: pos.slug,
    title: pos.title,
    outcome: pos.outcome,
    outcomeIndex: pos.outcomeIndex || 0,
    size: parseFloat(pos.size || '0'),
    avgPrice: parseFloat(pos.avgPrice || '0'),
    currentPrice: parseFloat(pos.curPrice || '0'),
    initialValue: parseFloat(pos.initialValue || '0'),
    currentValue: parseFloat(pos.currentValue || '0'),
    cashPnl: parseFloat(pos.cashPnl || '0'),
    percentPnl: parseFloat(pos.percentPnl || '0'),
    endDate: pos.endDate,
    redeemable: pos.redeemable,  // Preserve redeemable flag for resolved position detection
  }))
}

/**
 * Parse raw closed positions into typed closed positions
 * Handles both old (cashPnl, size) and new (realizedPnl, totalBought) API formats
 */
export function parseClosedPositions(rawPositions: RawPolymarketClosedPosition[]): PolymarketClosedPosition[] {
  return rawPositions.map((pos) => {
    // Handle both field name formats from API
    const pnl = pos.realizedPnl !== undefined
      ? (typeof pos.realizedPnl === 'number' ? pos.realizedPnl : parseFloat(pos.realizedPnl))
      : parseFloat(pos.cashPnl || '0')

    const avgPrice = typeof pos.avgPrice === 'number'
      ? pos.avgPrice
      : parseFloat(String(pos.avgPrice || '0'))

    // Size and initialValue can come from 'size' or 'totalBought'
    let size = 0
    let initialValue = 0
    if (pos.totalBought !== undefined) {
      const totalBought = typeof pos.totalBought === 'number'
        ? pos.totalBought
        : parseFloat(pos.totalBought)
      initialValue = totalBought
      size = avgPrice > 0 ? totalBought / avgPrice : 0
    }
    if (pos.size) {
      size = parseFloat(pos.size)
      // If we didn't get initialValue from totalBought, compute it
      if (initialValue <= 0) {
        initialValue = size * avgPrice
      }
    }

    // Resolve date from either resolvedAt, endDate, or timestamp
    let resolvedAt = pos.resolvedAt
    if (!resolvedAt && pos.timestamp) {
      resolvedAt = new Date(pos.timestamp * 1000).toISOString()
    } else if (!resolvedAt && pos.endDate) {
      resolvedAt = pos.endDate
    }

    return {
      conditionId: pos.conditionId,
      title: pos.title,
      outcome: pos.outcome,
      marketSlug: pos.slug || pos.eventSlug || undefined,
      size: Math.round(size * 100) / 100,
      avgPrice: Math.round(avgPrice * 10000) / 10000,
      initialValue: Math.round(initialValue * 100) / 100,
      finalPrice: 0, // Not available from API
      realizedPnl: Math.round(pnl * 100) / 100,
      resolvedAt,
      isWin: pnl > 0,
    }
  })
}

interface ActivityTrade {
  type?: string
  side?: string
  size?: string | number
  usdcSize?: string | number
  price?: string | number
  cashPnl?: string | number
  timestamp?: number | string
  title?: string
  slug?: string
  outcome?: string
  outcomeIndex?: string | number
  transactionHash?: string
  conditionId?: string
  asset?: string
}

/**
 * Parse activity trades into structured format
 */
export function parseTrades(activity: unknown[]): ParsedTrade[] {
  const trades = (activity as ActivityTrade[]).filter(a => a.type === 'TRADE')

  return trades.map(t => ({
    timestamp: typeof t.timestamp === 'number' ? t.timestamp : parseInt(String(t.timestamp || 0)),
    side: (t.side?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
    market: t.title || t.slug || 'Unknown',
    outcome: t.outcome,
    size: parseFloat(String(t.size || 0)),
    price: parseFloat(String(t.price || 0)),
    usdValue: parseFloat(String(t.usdcSize || 0)),
    txHash: t.transactionHash,
    conditionId: t.conditionId,
    asset: t.asset,
    outcomeIndex: t.outcomeIndex !== undefined ? parseInt(String(t.outcomeIndex)) : undefined,
  })).sort((a, b) => b.timestamp - a.timestamp) // Most recent first
}

/**
 * Calculate metrics for a specific time period
 */
function calculatePeriodMetrics(
  trades: ParsedTrade[],
  positions: PolymarketPosition[],
  closedPositions: PolymarketClosedPosition[],
  days: number
): TimePeriodMetrics {
  const now = Date.now()
  const cutoffMs = now - days * 24 * 60 * 60 * 1000

  // Filter trades by time period (timestamp is in seconds)
  const periodTrades = trades.filter(t => t.timestamp * 1000 >= cutoffMs)

  // Calculate volume (total USD traded in period)
  const volume = periodTrades.reduce((sum, t) => sum + t.usdValue, 0)

  // Filter closed positions by resolution date for win rate calculation
  const periodClosedPositions = closedPositions.filter(p => {
    if (!p.resolvedAt) return false
    const resolvedMs = new Date(p.resolvedAt).getTime()
    return resolvedMs >= cutoffMs
  })

  // Calculate PnL from positions resolved in this period
  const realizedPnl = periodClosedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)

  // Calculate win rate from positions resolved in this period
  const winningPositions = periodClosedPositions.filter(p => p.realizedPnl > 0)
  const winRate = periodClosedPositions.length > 0
    ? (winningPositions.length / periodClosedPositions.length) * 100
    : 0

  return {
    pnl: realizedPnl,
    volume,
    tradeCount: periodTrades.length,
    winRate,
    positionsResolved: periodClosedPositions.length,
    winningPositions: winningPositions.length,
    losingPositions: periodClosedPositions.length - winningPositions.length,
  }
}

/**
 * Calculate average time between trades in hours
 */
function calculateAvgTradeInterval(trades: ParsedTrade[]): number {
  if (trades.length < 2) return 0

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp)
  let totalIntervalMs = 0

  for (let i = 1; i < sorted.length; i++) {
    totalIntervalMs += (sorted[i].timestamp - sorted[i - 1].timestamp) * 1000
  }

  const avgMs = totalIntervalMs / (sorted.length - 1)
  return avgMs / (1000 * 60 * 60) // Convert to hours
}

/**
 * Calculate trader metrics from positions and activity data
 */
export function calculateMetrics(
  portfolioValue: number,
  positions: PolymarketPosition[],
  closedPositions: PolymarketClosedPosition[],
  activity: unknown[]
): TraderMetrics {
  // Parse all trades
  const allTrades = parseTrades(activity)

  // Calculate time-period metrics (now includes closedPositions for accurate win rate)
  const metrics7d = calculatePeriodMetrics(allTrades, positions, closedPositions, 7)
  const metrics30d = calculatePeriodMetrics(allTrades, positions, closedPositions, 30)

  // Calculate average trade interval
  const avgTradeIntervalHours = calculateAvgTradeInterval(allTrades)

  // Position metrics
  const currentValues = positions.map((p) => p.currentValue)
  const totalPositionValue = currentValues.reduce((sum, v) => sum + v, 0)
  const maxPositionSize = currentValues.length > 0 ? Math.max(...currentValues) : 0
  const avgPositionSize = currentValues.length > 0 ? totalPositionValue / currentValues.length : 0
  const positionConcentration = totalPositionValue > 0 ? (maxPositionSize / totalPositionValue) * 100 : 0

  // PnL calculations
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.cashPnl, 0)
  const realizedPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0)
  const totalPnl = unrealizedPnl + realizedPnl

  // Win rate calculation (all-time from closed positions)
  const totalWins = closedPositions.filter(p => p.realizedPnl > 0).length
  const winRateAllTime = closedPositions.length > 0
    ? (totalWins / closedPositions.length) * 100
    : 0

  // Unique markets
  const marketSet = new Set<string>()
  positions.forEach((p) => marketSet.add(p.conditionId))
  closedPositions.forEach((p) => marketSet.add(p.conditionId))

  return {
    portfolioValue,
    totalPnl,
    unrealizedPnl,
    realizedPnl,

    // Time-period metrics
    metrics7d,
    metrics30d,
    avgTradeIntervalHours,
    activePositions: positions.length,

    // Legacy fields for compatibility
    winRate30d: metrics30d.winRate,
    winRateAllTime,
    tradeCount30d: metrics30d.tradeCount,
    tradeCountAllTime: allTrades.length,
    uniqueMarkets30d: marketSet.size,
    positionConcentration,
    maxPositionSize,
    avgPositionSize,
    totalPositions: closedPositions.length,
    maxDrawdown: 0, // Not available from API
    tradeFrequency: metrics30d.tradeCount / 30,
    nightTradeRatio: 0,
  }
}

// Top-level category tags to look for in event tags (in priority order)
const TOP_LEVEL_CATEGORIES = new Set([
  'Sports', 'Politics', 'Crypto', 'Science', 'Pop Culture',
  'Tech', 'Business', 'Entertainment', 'Finance', 'World',
  'Geopolitics', 'AI', 'Climate', 'Health',
])

/**
 * Extract the primary category from an event's tags array.
 * Prefers broad top-level tags (Sports, Politics, Crypto, etc.)
 * Falls back to the first tag if no top-level match.
 */
function extractCategoryFromTags(tags: Array<{ label: string; slug?: string }>): string {
  if (!tags || tags.length === 0) return ''
  // Find the first top-level category tag
  for (const tag of tags) {
    if (TOP_LEVEL_CATEGORIES.has(tag.label)) return tag.label
  }
  // Fall back to first tag that isn't a generic tag
  const filtered = tags.filter(t => t.label !== 'All' && t.label !== 'Featured')
  return filtered.length > 0 ? filtered[0].label : tags[0].label
}

/**
 * Fetch event categories from Gamma API for a list of event slugs.
 * Returns a Map of eventSlug -> category string.
 * Batches slugs into chunks of 20 to avoid URL length limits.
 */
export async function fetchEventCategories(eventSlugs: string[]): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>()
  const uniqueSlugs = [...new Set(eventSlugs.filter(Boolean))]

  if (uniqueSlugs.length === 0) return categoryMap

  // Split into chunks of 20 slugs to avoid URL length limits
  const CHUNK_SIZE = 20
  const chunks: string[][] = []
  for (let i = 0; i < uniqueSlugs.length; i += CHUNK_SIZE) {
    chunks.push(uniqueSlugs.slice(i, i + CHUNK_SIZE))
  }

  try {
    // Fetch all chunks in parallel
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const slugParams = chunk.map(s => `slug=${encodeURIComponent(s)}`).join('&')
          const res = await fetch(`${GAMMA_API_BASE}/events?limit=${chunk.length}&${slugParams}`, {
            signal: AbortSignal.timeout(10000),
          })
          if (!res.ok) return []
          const events = await res.json()
          return Array.isArray(events) ? events : []
        } catch {
          return []
        }
      })
    )

    for (const events of results) {
      for (const event of events) {
        const slug = event.slug
        if (slug) {
          const category = extractCategoryFromTags(event.tags || [])
          if (category) categoryMap.set(slug, category)
        }
      }
    }
  } catch {
    // Silently fail - category is non-critical
  }

  return categoryMap
}

/**
 * Determine the top (most traded) category from event slugs and a category map.
 * Returns the category with the most unique events.
 */
export function getTopCategory(
  eventSlugs: string[],
  categoryMap: Map<string, string>
): string {
  const categoryCounts = new Map<string, number>()
  const seenSlugs = new Set<string>()

  for (const slug of eventSlugs) {
    if (!slug || seenSlugs.has(slug)) continue
    seenSlugs.add(slug)
    const cat = categoryMap.get(slug)
    if (cat) {
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    }
  }

  let topCategory = ''
  let maxCount = 0
  for (const [cat, count] of categoryCounts) {
    if (count > maxCount) {
      maxCount = count
      topCategory = cat
    }
  }

  return topCategory
}

/**
 * Validate Ethereum address format
 */
export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}
