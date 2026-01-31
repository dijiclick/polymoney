import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const DATA_API_BASE = 'https://data-api.polymarket.com'
// The Activity API accepts limit up to 1000 and has a hard offset cap at 3000.
// Beyond offset 3000 the API silently returns duplicate data.
// With limit=1000 we get up to 4000 unique records (3000 + 1000).
const PAGE_SIZE = 1000
const MAX_OFFSET = 3000
const REQUEST_DELAY_MS = 100
const BACKFILL_DAYS = 30

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey)
}

interface ActivityRecord {
  timestamp: number
  type: string
  conditionId: string
  size: string
  price: string
  side: 'BUY' | 'SELL'
  usdcSize?: string
  title?: string
  slug?: string
  outcome?: string
  transactionHash?: string
}

interface TradeBuildState {
  id?: number
  wallet_address: string
  condition_id: string
  market_title: string | null
  market_slug: string | null
  primary_outcome: string
  yes_shares: number
  no_shares: number
  closed: boolean
  open_timestamp: number
  close_timestamp: number | null
  number_of_buys: number
  number_of_sells: number
  total_volume_bought: number
  total_volume_sold: number
  roi: number
  pnl: number
  avg_entry_price: number
  avg_exit_price: number
  profit_pct: number
  totalEntryShares: number
  totalExitShares: number
  dirty: boolean
}

interface ClosedPosition {
  conditionId: string
  title: string
  outcome: string
  size: number
  avgPrice: number
  totalBought: number
  realizedPnl: number
  resolvedAt: string | null
  isWin: boolean
}

// Inline implementations to avoid import issues with @new alias at runtime

async function fetchPage(url: string): Promise<{ ok: boolean; data: unknown[] }> {
  try {
    const response = await fetch(url)
    if (!response.ok) return { ok: false, data: [] }
    const data = await response.json()
    return { ok: true, data: Array.isArray(data) ? data : [] }
  } catch {
    return { ok: false, data: [] }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseActivity(raw: Record<string, unknown>): ActivityRecord {
  return {
    timestamp: (raw.timestamp as number) || 0,
    type: (raw.type as string) || '',
    conditionId: (raw.conditionId as string) || '',
    size: String(raw.size || '0'),
    price: String(raw.price || '0'),
    side: ((raw.side as string) || 'BUY').toUpperCase() as 'BUY' | 'SELL',
    usdcSize: String(raw.usdcSize || '0'),
    title: (raw.title as string) || undefined,
    slug: (raw.slug as string) || undefined,
    outcome: (raw.outcome as string) || undefined,
    transactionHash: (raw.transactionHash as string) || undefined,
  }
}

async function fetchActivities(
  address: string,
  options: { maxTrades?: number; maxDays?: number; sinceTimestamp?: number } = {}
): Promise<ActivityRecord[]> {
  const { maxTrades = 10000, maxDays = 0, sinceTimestamp = 0 } = options
  const allActivities: ActivityRecord[] = []
  const baseUrl = `${DATA_API_BASE}/activity?user=${address}&limit=${PAGE_SIZE}`
  const daysCutoff = maxDays > 0 ? Math.floor((Date.now() - maxDays * 24 * 60 * 60 * 1000) / 1000) : 0
  const cutoff = Math.max(daysCutoff, sinceTimestamp)

  // Track the oldest timestamp from the previous page to detect API duplicate responses
  let prevOldestTimestamp: number | null = null

  let offset = 0
  while (offset < maxTrades && offset <= MAX_OFFSET) {
    const page = await fetchPage(`${baseUrl}&offset=${offset}`)
    if (!page.ok || page.data.length === 0) break

    // Detect duplicate page (API returns same data beyond offset cap)
    const pageData = page.data as Record<string, unknown>[]
    const pageOldest = pageData.length > 0
      ? ((pageData[pageData.length - 1].timestamp as number) || 0)
      : 0
    if (prevOldestTimestamp !== null && pageOldest === prevOldestTimestamp) {
      break // Hit the API offset cap
    }
    prevOldestTimestamp = pageOldest

    let reachedOldData = false
    for (const raw of pageData) {
      const ts = (raw.timestamp as number) || 0

      if (cutoff > 0 && ts > 0 && ts < cutoff) {
        reachedOldData = true
        break
      }

      if (isRelevantType(raw.type as string)) {
        allActivities.push(parseActivity(raw))
      }
    }

    if (reachedOldData || page.data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    await delay(REQUEST_DELAY_MS)
  }

  return allActivities.slice(0, maxTrades)
}

/**
 * Fetch closed positions (wins) from /closed-positions API.
 * No offset cap — returns full history. Used for backfilling.
 */
async function fetchClosedPositions(
  address: string,
  options: { maxDays?: number } = {}
): Promise<ClosedPosition[]> {
  const { maxDays = 30 } = options
  const cutoffMs = maxDays > 0 ? Date.now() - maxDays * 24 * 60 * 60 * 1000 : 0
  const baseUrl = `${DATA_API_BASE}/closed-positions?user=${address}&sortBy=TIMESTAMP&sortDirection=DESC&limit=50`

  const all: ClosedPosition[] = []
  let offset = 0

  while (true) {
    const page = await fetchPage(`${baseUrl}&offset=${offset}`)
    if (!page.ok || page.data.length === 0) break

    let reachedOldData = false
    for (const raw of page.data as Record<string, unknown>[]) {
      const resolvedAt = (raw.resolvedAt as string) || (raw.endDate as string) ||
        (raw.timestamp ? new Date((raw.timestamp as number) * 1000).toISOString() : null)
      const resolvedMs = resolvedAt ? new Date(resolvedAt).getTime() : 0

      if (cutoffMs > 0 && resolvedMs > 0 && resolvedMs < cutoffMs) {
        reachedOldData = true
        break
      }

      all.push(parseClosedPosition(raw))
    }

    if (reachedOldData || page.data.length < 50) break
    offset += 50
    await delay(REQUEST_DELAY_MS)
  }

  return all
}

/**
 * Fetch unredeemed losses from /positions API.
 * These are resolved positions with $0 value and negative PnL.
 */
async function fetchUnredeemedLosses(address: string): Promise<ClosedPosition[]> {
  const baseUrl = `${DATA_API_BASE}/positions?user=${address}&limit=50`
  const all: ClosedPosition[] = []
  let offset = 0

  while (true) {
    const page = await fetchPage(`${baseUrl}&offset=${offset}`)
    if (!page.ok || page.data.length === 0) break

    for (const raw of page.data as Record<string, unknown>[]) {
      const currentValue = parseFloat(String(raw.currentValue || '0'))
      const cashPnl = parseFloat(String(raw.cashPnl || '0'))
      const redeemable = raw.redeemable === true

      if (currentValue === 0 && redeemable && cashPnl < 0) {
        const size = parseFloat(String(raw.size || '0'))
        const avgPrice = parseFloat(String(raw.avgPrice || '0'))
        all.push({
          conditionId: (raw.conditionId as string) || '',
          title: (raw.title as string) || '',
          outcome: (raw.outcome as string) || '',
          size: Math.round(size * 100) / 100,
          avgPrice: Math.round(avgPrice * 10000) / 10000,
          totalBought: Math.round(size * avgPrice * 100) / 100,
          realizedPnl: Math.round(cashPnl * 100) / 100,
          resolvedAt: (raw.endDate as string) || null,
          isWin: false,
        })
      }
    }

    if (page.data.length < 50) break
    offset += 50
    await delay(REQUEST_DELAY_MS)
  }

  return all
}

function parseClosedPosition(raw: Record<string, unknown>): ClosedPosition {
  const pnl = raw.realizedPnl !== undefined
    ? (typeof raw.realizedPnl === 'number' ? raw.realizedPnl : parseFloat(String(raw.realizedPnl)))
    : parseFloat(String(raw.cashPnl || '0'))
  const avgPrice = typeof raw.avgPrice === 'number' ? raw.avgPrice : parseFloat(String(raw.avgPrice || '0'))
  let size = 0, totalBought = 0
  if (raw.totalBought !== undefined) {
    totalBought = typeof raw.totalBought === 'number' ? raw.totalBought : parseFloat(String(raw.totalBought))
    size = avgPrice > 0 ? totalBought / avgPrice : 0
  }
  if (raw.size) {
    size = parseFloat(String(raw.size))
    if (totalBought <= 0) totalBought = size * avgPrice
  }
  let resolvedAt = (raw.resolvedAt as string) || null
  if (!resolvedAt && raw.timestamp) resolvedAt = new Date((raw.timestamp as number) * 1000).toISOString()
  else if (!resolvedAt && raw.endDate) resolvedAt = raw.endDate as string

  return {
    conditionId: (raw.conditionId as string) || '',
    title: (raw.title as string) || '',
    outcome: (raw.outcome as string) || '',
    size: Math.round(size * 100) / 100,
    avgPrice: Math.round(avgPrice * 10000) / 10000,
    totalBought: Math.round(totalBought * 100) / 100,
    realizedPnl: Math.round(pnl * 100) / 100,
    resolvedAt,
    isWin: pnl > 0,
  }
}

function roundShares(n: number): number { return Math.round(n * 1_000_000) / 1_000_000 }
function round2(n: number): number { return Math.round(n * 100) / 100 }
function round4(n: number): number { return Math.round(n * 10000) / 10000 }
function round6(n: number): number { return Math.round(n * 1_000_000) / 1_000_000 }
function timestampToISO(ts: number): string { return new Date(ts * 1000).toISOString() }
function isRelevantType(type: string): boolean { return type === 'TRADE' || type === 'REDEEM' }

function calcDrawdown(closedTrades: DbTrade[]): number {
  const sorted = closedTrades
    .filter(t => t.close_timestamp)
    .sort((a, b) => new Date(a.close_timestamp!).getTime() - new Date(b.close_timestamp!).getTime())
  if (sorted.length === 0) return 0
  let cumPnl = 0, peak = 0, maxDD = 0
  for (const t of sorted) {
    cumPnl += Number(t.pnl)
    if (cumPnl > peak) peak = cumPnl
    if (peak > 0) {
      const dd = ((peak - cumPnl) / peak) * 100
      if (dd > maxDD) maxDD = dd
    }
  }
  return maxDD
}

function calcPeriodMetrics(closedTrades: DbTrade[], days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const pt = closedTrades.filter(t => t.close_timestamp && new Date(t.close_timestamp) >= cutoff)
  const pnl = pt.reduce((s, t) => s + Number(t.pnl), 0)
  const volBought = pt.reduce((s, t) => s + Number(t.total_volume_bought), 0)
  const roi = volBought > 0 ? (pnl / volBought) * 100 : 0
  const wins = pt.filter(t => Number(t.pnl) > 0).length
  const winRate = pt.length > 0 ? (wins / pt.length) * 100 : 0
  const volume = pt.reduce((s, t) => s + Number(t.total_volume_bought) + Number(t.total_volume_sold), 0)
  const drawdown = calcDrawdown(pt as DbTrade[])
  return { pnl: round2(pnl), roi: round2(roi), winRate: round2(winRate), volume: round2(volume), tradeCount: pt.length, drawdown: round2(drawdown) }
}

interface DbTrade {
  id: number
  wallet_address: string
  condition_id: string
  market_title: string | null
  market_slug: string | null
  primary_outcome: string | null
  yes_shares: number
  no_shares: number
  closed: boolean
  open_timestamp: string
  close_timestamp: string | null
  number_of_buys: number
  number_of_sells: number
  total_volume_bought: number
  total_volume_sold: number
  roi: number
  pnl: number
  avg_entry_price: number
  avg_exit_price: number
  profit_pct: number
}

function buildTrades(
  walletAddress: string,
  newActivities: ActivityRecord[],
  existingOpenTrades: DbTrade[]
): { upsertTrades: TradeBuildState[]; newActivitiesForDb: ActivityRecord[] } {
  const sorted = [...newActivities].sort((a, b) => a.timestamp - b.timestamp)
  const openTradesMap = new Map<string, TradeBuildState>()

  for (const trade of existingOpenTrades) {
    if (!trade.closed) {
      const avgEntry = Number(trade.avg_entry_price) || 0
      const avgExit = Number(trade.avg_exit_price) || 0
      const volBought = Number(trade.total_volume_bought) || 0
      const volSold = Number(trade.total_volume_sold) || 0
      openTradesMap.set(trade.condition_id, {
        id: trade.id,
        wallet_address: trade.wallet_address,
        condition_id: trade.condition_id,
        market_title: trade.market_title,
        market_slug: trade.market_slug,
        primary_outcome: trade.primary_outcome || 'Yes',
        yes_shares: Number(trade.yes_shares) || 0,
        no_shares: Number(trade.no_shares) || 0,
        closed: false,
        open_timestamp: new Date(trade.open_timestamp).getTime() / 1000,
        close_timestamp: null,
        number_of_buys: trade.number_of_buys,
        number_of_sells: trade.number_of_sells,
        total_volume_bought: volBought,
        total_volume_sold: volSold,
        roi: Number(trade.roi) || 0,
        pnl: Number(trade.pnl) || 0,
        avg_entry_price: avgEntry,
        avg_exit_price: avgExit,
        profit_pct: Number(trade.profit_pct) || 0,
        totalEntryShares: avgEntry > 0 ? volBought / avgEntry : 0,
        totalExitShares: avgExit > 0 ? volSold / avgExit : 0,
        dirty: false,
      })
    }
  }

  const allModifiedTrades: TradeBuildState[] = []

  for (const activity of sorted) {
    const { conditionId } = activity
    const usdcSize = parseFloat(activity.usdcSize || '0')
    const size = parseFloat(activity.size || '0')
    const outcome = activity.outcome || 'Yes'

    let trade = openTradesMap.get(conditionId)
    if (!trade) {
      trade = {
        wallet_address: walletAddress,
        condition_id: conditionId,
        market_title: activity.title || null,
        market_slug: activity.slug || null,
        primary_outcome: outcome,
        yes_shares: 0, no_shares: 0,
        closed: false,
        open_timestamp: activity.timestamp,
        close_timestamp: null,
        number_of_buys: 0, number_of_sells: 0,
        total_volume_bought: 0, total_volume_sold: 0,
        roi: 0, pnl: 0,
        avg_entry_price: 0, avg_exit_price: 0, profit_pct: 0,
        totalEntryShares: 0, totalExitShares: 0,
        dirty: true,
      }
      openTradesMap.set(conditionId, trade)
      allModifiedTrades.push(trade)
    }

    trade.dirty = true
    if (activity.title && !trade.market_title) trade.market_title = activity.title
    if (activity.slug && !trade.market_slug) trade.market_slug = activity.slug

    const isPrimaryOutcome = outcome === trade.primary_outcome
    let effectiveSide: 'BUY' | 'SELL'
    if (activity.side === 'BUY') {
      effectiveSide = isPrimaryOutcome ? 'BUY' : 'SELL'
    } else {
      effectiveSide = isPrimaryOutcome ? 'SELL' : 'BUY'
    }

    if (activity.side === 'BUY') {
      if (outcome === 'Yes') trade.yes_shares += size
      else trade.no_shares += size
    } else {
      if (outcome === 'Yes') trade.yes_shares -= size
      else trade.no_shares -= size
    }

    trade.yes_shares = Math.max(0, roundShares(trade.yes_shares))
    trade.no_shares = Math.max(0, roundShares(trade.no_shares))

    const price = parseFloat(activity.price || '0')

    if (effectiveSide === 'BUY') {
      trade.number_of_buys++
      trade.total_volume_bought += usdcSize
      // VWAP for entry price
      if (size > 0 && price > 0) {
        trade.avg_entry_price = (trade.avg_entry_price * trade.totalEntryShares + price * size)
          / (trade.totalEntryShares + size)
        trade.totalEntryShares += size
      }
    } else {
      trade.number_of_sells++
      trade.total_volume_sold += usdcSize
      // VWAP for exit price
      if (size > 0 && price > 0) {
        trade.avg_exit_price = (trade.avg_exit_price * trade.totalExitShares + price * size)
          / (trade.totalExitShares + size)
        trade.totalExitShares += size
      }
    }

    if (trade.yes_shares <= 0 && trade.no_shares <= 0) {
      trade.closed = true
      trade.close_timestamp = activity.timestamp
      trade.pnl = round2(trade.total_volume_sold - trade.total_volume_bought)
      trade.roi = trade.total_volume_bought > 0
        ? round4((trade.pnl / trade.total_volume_bought) * 100)
        : 0
      trade.profit_pct = trade.total_volume_bought > 0
        ? round4((trade.pnl / trade.total_volume_bought) * 100)
        : 0
      openTradesMap.delete(conditionId)
    }
  }

  Array.from(openTradesMap.values()).forEach(trade => {
    if (trade.dirty && !allModifiedTrades.includes(trade)) {
      allModifiedTrades.push(trade)
    }
  })

  return { upsertTrades: allModifiedTrades.filter(t => t.dirty), newActivitiesForDb: sorted }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const address = (body.address || '').toLowerCase()

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }

    const supabase = getSupabase()
    const maxFetchDays = parseInt(process.env.MAX_FETCH_DAYS || '90', 10)
    const maxTradesPerWallet = parseInt(process.env.MAX_TRADES_PER_WALLET || '5000', 10)

    // Ensure wallet exists
    const { data: wallet } = await supabase
      .from('wallets_new')
      .select('*')
      .eq('address', address)
      .single()

    if (!wallet) {
      // Auto-add wallet
      await supabase.from('wallets_new').insert({ address })
    }

    const sinceTimestamp = wallet?.last_activity_timestamp || 0

    // Fetch activities — no maxDays limit so normal traders get full history.
    // High-frequency traders hit the API offset cap (~4000 records) and the
    // backfill step below covers the last 30 days from /closed-positions.
    const newActivities = await fetchActivities(address, {
      maxTrades: maxTradesPerWallet,
      sinceTimestamp,
    })

    if (newActivities.length === 0) {
      await supabase
        .from('wallets_new')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('address', address)

      return NextResponse.json({
        success: true,
        newActivities: 0,
        tradesCreated: 0,
        tradesUpdated: 0,
      })
    }

    // Get open trades
    const { data: openTrades } = await supabase
      .from('trades')
      .select('*')
      .eq('wallet_address', address)
      .eq('closed', false)

    // Build trades
    const { upsertTrades, newActivitiesForDb } = buildTrades(
      address,
      newActivities,
      (openTrades || []) as DbTrade[]
    )

    let tradesCreated = 0
    let tradesUpdated = 0

    for (const trade of upsertTrades) {
      const row: Record<string, unknown> = {
        wallet_address: trade.wallet_address,
        condition_id: trade.condition_id,
        market_title: trade.market_title,
        market_slug: trade.market_slug,
        primary_outcome: trade.primary_outcome,
        yes_shares: roundShares(trade.yes_shares),
        no_shares: roundShares(trade.no_shares),
        closed: trade.closed,
        open_timestamp: timestampToISO(trade.open_timestamp),
        close_timestamp: trade.close_timestamp ? timestampToISO(trade.close_timestamp) : null,
        number_of_buys: trade.number_of_buys,
        number_of_sells: trade.number_of_sells,
        total_volume_bought: round2(trade.total_volume_bought),
        total_volume_sold: round2(trade.total_volume_sold),
        roi: round4(trade.roi),
        pnl: round2(trade.pnl),
        avg_entry_price: round6(trade.avg_entry_price),
        avg_exit_price: round6(trade.avg_exit_price),
        profit_pct: round4(trade.profit_pct),
        updated_at: new Date().toISOString(),
      }

      if (trade.id) {
        await supabase.from('trades').update(row).eq('id', trade.id)
        tradesUpdated++
      } else {
        await supabase.from('trades').insert(row)
        tradesCreated++
      }
    }

    // Insert activities
    const activityRows = newActivitiesForDb.map(a => ({
      wallet_address: address,
      condition_id: a.conditionId,
      transaction_hash: a.transactionHash || null,
      timestamp: a.timestamp,
      type: a.type,
      side: a.side,
      outcome: a.outcome || null,
      size: parseFloat(a.size || '0'),
      price: parseFloat(a.price || '0'),
      usdc_size: parseFloat(a.usdcSize || '0'),
      title: a.title || null,
      slug: a.slug || null,
    }))

    const BATCH_SIZE = 500
    for (let i = 0; i < activityRows.length; i += BATCH_SIZE) {
      const batch = activityRows.slice(i, i + BATCH_SIZE)
      await supabase
        .from('activities')
        .upsert(batch, {
          onConflict: 'wallet_address,transaction_hash,condition_id,side,outcome',
          ignoreDuplicates: true,
        })
    }

    // Backfill from /closed-positions for high-volume traders
    // The Activity API caps at ~4000 records. If that doesn't cover 30 days,
    // fetch closed positions (no cap) and create trade records for any markets
    // not already tracked by the activity-based trade builder.
    const oldestActivityTs = newActivities.length > 0
      ? Math.min(...newActivities.map(a => a.timestamp).filter(t => t > 0))
      : 0
    const thirtyDaysAgoTs = Math.floor((Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000) / 1000)

    let backfillCount = 0
    if (oldestActivityTs > thirtyDaysAgoTs) {
      // Activities don't reach 30 days back — need backfill
      console.log(`[${address}] Activities only reach ${new Date(oldestActivityTs * 1000).toISOString().slice(0, 10)}. Backfilling...`)

      // Get existing trade condition_ids to avoid duplicates
      const { data: existingTrades } = await supabase
        .from('trades')
        .select('condition_id')
        .eq('wallet_address', address)

      const existingCids = new Set((existingTrades || []).map((t: { condition_id: string }) => t.condition_id))

      // Fetch closed positions (wins) + unredeemed losses
      const [closedPositions, unredeemedLosses] = await Promise.all([
        fetchClosedPositions(address, { maxDays: BACKFILL_DAYS }),
        fetchUnredeemedLosses(address),
      ])

      console.log(`[${address}] Backfill: ${closedPositions.length} closed + ${unredeemedLosses.length} unredeemed losses`)

      // Group by conditionId — one trade per market
      const allResolved = [...closedPositions, ...unredeemedLosses]
      const marketMap = new Map<string, { positions: ClosedPosition[]; title: string }>()
      for (const pos of allResolved) {
        if (!pos.conditionId || existingCids.has(pos.conditionId)) continue
        if (!marketMap.has(pos.conditionId)) {
          marketMap.set(pos.conditionId, { positions: [], title: pos.title })
        }
        marketMap.get(pos.conditionId)!.positions.push(pos)
      }

      // Create simplified trade records for each missing market
      for (const [conditionId, { positions, title }] of marketMap) {
        const totalBought = positions.reduce((s, p) => s + p.totalBought, 0)
        const totalPnl = positions.reduce((s, p) => s + p.realizedPnl, 0)
        const totalSold = totalBought + totalPnl
        const firstOutcome = positions[0]?.outcome || 'Yes'
        const resolvedAt = positions[0]?.resolvedAt || null
        const resolvedTs = resolvedAt ? Math.floor(new Date(resolvedAt).getTime() / 1000) : 0
        const openTs = resolvedTs > 0 ? resolvedTs - 86400 : 0

        const row: Record<string, unknown> = {
          wallet_address: address,
          condition_id: conditionId,
          market_title: title || null,
          market_slug: null,
          primary_outcome: firstOutcome,
          yes_shares: 0,
          no_shares: 0,
          closed: true,
          open_timestamp: openTs > 0 ? timestampToISO(openTs) : null,
          close_timestamp: resolvedTs > 0 ? timestampToISO(resolvedTs) : null,
          number_of_buys: positions.length,
          number_of_sells: positions.length,
          total_volume_bought: round2(totalBought),
          total_volume_sold: round2(Math.max(0, totalSold)),
          roi: totalBought > 0 ? round4((totalPnl / totalBought) * 100) : 0,
          pnl: round2(totalPnl),
          avg_entry_price: positions.length > 0 ? positions[0].avgPrice : 0,
          avg_exit_price: 0,
          profit_pct: totalBought > 0 ? round4((totalPnl / totalBought) * 100) : 0,
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase.from('trades').insert(row)
        if (!error) {
          backfillCount++
        }
      }

      if (backfillCount > 0) {
        console.log(`[${address}] Backfilled ${backfillCount} trades from closed positions.`)
      }
    }

    // Recalculate wallet metrics from ALL trades (including backfilled)
    const { data: allTrades } = await supabase
      .from('trades')
      .select('*')
      .eq('wallet_address', address)

    const trades = (allTrades || []) as DbTrade[]
    const closedTrades = trades.filter(t => t.closed)
    const openTradesList = trades.filter(t => !t.closed)
    const totalPnl = closedTrades.reduce((sum, t) => sum + Number(t.pnl), 0)
    const totalVolBought = trades.reduce((sum, t) => sum + Number(t.total_volume_bought), 0)
    const totalVolSold = trades.reduce((sum, t) => sum + Number(t.total_volume_sold), 0)
    const totalRoi = totalVolBought > 0 ? (totalPnl / totalVolBought) * 100 : 0
    const wins = closedTrades.filter(t => Number(t.pnl) > 0).length
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0

    const durations = closedTrades
      .filter(t => t.close_timestamp && t.open_timestamp)
      .map(t => {
        const open = new Date(t.open_timestamp).getTime()
        const close = new Date(t.close_timestamp!).getTime()
        return (close - open) / (1000 * 60 * 60)
      })
      .filter(d => d > 0)
    const avgHold = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null

    // Profit factor
    const grossWins = closedTrades.filter(t => Number(t.pnl) > 0).reduce((sum, t) => sum + Number(t.pnl), 0)
    const grossLosses = closedTrades.filter(t => Number(t.pnl) < 0).reduce((sum, t) => sum + Math.abs(Number(t.pnl)), 0)
    const profitFactor = grossLosses > 0 ? round2(grossWins / grossLosses) : (grossWins > 0 ? 10.0 : 0)
    const metricsUpdatedAt = Math.floor(Date.now() / 1000)

    // Period metrics + drawdown
    const m7d = calcPeriodMetrics(closedTrades, 7)
    const m30d = calcPeriodMetrics(closedTrades, 30)
    const drawdownAll = calcDrawdown(closedTrades)

    const maxTimestamp = newActivities.reduce(
      (max, a) => Math.max(max, a.timestamp),
      sinceTimestamp
    )

    await supabase
      .from('wallets_new')
      .update({
        total_pnl: round2(totalPnl),
        total_roi: round2(totalRoi),
        win_rate: round2(winRate),
        open_trade_count: openTradesList.length,
        closed_trade_count: closedTrades.length,
        total_volume_bought: round2(totalVolBought),
        total_volume_sold: round2(totalVolSold),
        avg_hold_duration_hours: avgHold !== null ? round2(avgHold) : null,
        profit_factor: profitFactor,
        metrics_updated_at: metricsUpdatedAt,
        drawdown_all: round2(drawdownAll),
        // 7-day period metrics
        pnl_7d: m7d.pnl,
        roi_7d: m7d.roi,
        win_rate_7d: m7d.winRate,
        volume_7d: m7d.volume,
        trade_count_7d: m7d.tradeCount,
        drawdown_7d: m7d.drawdown,
        // 30-day period metrics
        pnl_30d: m30d.pnl,
        roi_30d: m30d.roi,
        win_rate_30d: m30d.winRate,
        volume_30d: m30d.volume,
        trade_count_30d: m30d.tradeCount,
        drawdown_30d: m30d.drawdown,
        last_synced_at: new Date().toISOString(),
        last_activity_timestamp: maxTimestamp,
        updated_at: new Date().toISOString(),
      })
      .eq('address', address)

    return NextResponse.json({
      success: true,
      newActivities: newActivities.length,
      tradesCreated,
      tradesUpdated,
      backfillCount,
      metrics: {
        totalPnl: round2(totalPnl),
        totalRoi: round2(totalRoi),
        winRate: round2(winRate),
        openTrades: openTradesList.length,
        closedTrades: closedTrades.length,
      },
    })
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
