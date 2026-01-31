import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey)
}

const VALID_SORT_COLUMNS = [
  'total_pnl', 'total_roi', 'win_rate', 'profit_factor',
  'open_trade_count', 'closed_trade_count',
  'total_volume_bought', 'total_volume_sold',
  'avg_hold_duration_hours', 'drawdown_all',
  // 7-day
  'pnl_7d', 'roi_7d', 'win_rate_7d', 'volume_7d', 'trade_count_7d', 'drawdown_7d',
  // 30-day
  'pnl_30d', 'roi_30d', 'win_rate_30d', 'volume_30d', 'trade_count_30d', 'drawdown_30d',
]

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const sortBy = searchParams.get('sortBy') || 'total_pnl'
    const sortAsc = searchParams.get('sortDir') === 'asc'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const search = searchParams.get('search')?.toLowerCase().trim() || ''
    const includeStats = searchParams.get('includeStats') === 'true'

    // Cursor pagination
    const cursorSortValue = searchParams.get('cursorSortValue') || null
    const cursorAddress = searchParams.get('cursorAddress') || null

    // Validate sort column
    const safeSortBy = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : 'total_pnl'

    const supabase = getSupabase()

    let query = supabase
      .from('wallets_new')
      .select('*', { count: 'estimated' })

    // Search
    if (search) {
      query = query.or(`address.ilike.%${search}%,username.ilike.%${search}%`)
    }

    // Column filters (min/max ranges)
    const columnFiltersParam = searchParams.get('columnFilters')
    if (columnFiltersParam) {
      try {
        const columnFilters = JSON.parse(columnFiltersParam) as Record<string, { min?: number; max?: number }>
        for (const [column, filter] of Object.entries(columnFilters)) {
          if (!VALID_SORT_COLUMNS.includes(column)) continue
          if (filter.min !== undefined && filter.min !== null) {
            query = query.gte(column, filter.min)
          }
          if (filter.max !== undefined && filter.max !== null) {
            query = query.lte(column, filter.max)
          }
        }
      } catch {
        // Ignore invalid JSON
      }
    }

    // Cursor-based pagination
    if (cursorSortValue !== null && cursorAddress) {
      if (sortAsc) {
        query = query.or(
          `${safeSortBy}.gt.${cursorSortValue},and(${safeSortBy}.eq.${cursorSortValue},address.gt.${cursorAddress})`
        )
      } else {
        query = query.or(
          `${safeSortBy}.lt.${cursorSortValue},and(${safeSortBy}.eq.${cursorSortValue},address.lt.${cursorAddress})`
        )
      }
    }

    // Sort with address as tiebreaker for stable cursor pagination
    query = query
      .order(safeSortBy, { ascending: sortAsc, nullsFirst: false })
      .order('address', { ascending: sortAsc })
      .limit(limit)

    // Run wallet query and optional stats in parallel
    const statsPromise = includeStats
      ? getStats(supabase)
      : Promise.resolve(null)

    const [{ data, error, count }, stats] = await Promise.all([query, statsPromise])

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const wallets = (data || []).map((w: Record<string, unknown>) => ({
      ...w,
      // Ensure numeric defaults
      pnl_7d: w.pnl_7d || 0,
      roi_7d: w.roi_7d || 0,
      win_rate_7d: w.win_rate_7d || 0,
      volume_7d: w.volume_7d || 0,
      trade_count_7d: w.trade_count_7d || 0,
      drawdown_7d: w.drawdown_7d || 0,
      pnl_30d: w.pnl_30d || 0,
      roi_30d: w.roi_30d || 0,
      win_rate_30d: w.win_rate_30d || 0,
      volume_30d: w.volume_30d || 0,
      trade_count_30d: w.trade_count_30d || 0,
      drawdown_30d: w.drawdown_30d || 0,
      drawdown_all: w.drawdown_all || 0,
      total_pnl: w.total_pnl || 0,
      total_roi: w.total_roi || 0,
      win_rate: w.win_rate || 0,
      profit_factor: w.profit_factor || 0,
      open_trade_count: w.open_trade_count || 0,
      closed_trade_count: w.closed_trade_count || 0,
      total_volume_bought: w.total_volume_bought || 0,
      total_volume_sold: w.total_volume_sold || 0,
    }))

    // Build next cursor
    const lastWallet = wallets.length > 0 ? wallets[wallets.length - 1] as Record<string, unknown> : null
    const nextCursor = lastWallet ? {
      sortValue: String(lastWallet[safeSortBy] ?? ''),
      address: lastWallet.address as string,
    } : null

    return NextResponse.json({
      wallets,
      totalEstimate: count || 0,
      nextCursor,
      hasMore: wallets.length === limit,
      ...(stats && { stats }),
    })
  } catch (error) {
    console.error('Error in new wallets API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStats(supabase: any) {
  const { data } = await supabase
    .from('wallets_new')
    .select('total_pnl, win_rate, last_synced_at')

  if (!data) return { tracked: 0, synced: 0, totalPnl: 0, avgWinRate: 0 }

  const synced = data.filter((w: Record<string, unknown>) => w.last_synced_at)
  return {
    tracked: data.length,
    synced: synced.length,
    totalPnl: synced.reduce((s: number, w: Record<string, unknown>) => s + (Number(w.total_pnl) || 0), 0),
    avgWinRate: synced.length > 0
      ? synced.reduce((s: number, w: Record<string, unknown>) => s + (Number(w.win_rate) || 0), 0) / synced.length
      : 0,
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (body.action === 'import-live') {
    const supabase = getSupabase()

    const { data: mainWallets } = await supabase
      .from('wallets')
      .select('address, username')

    if (!mainWallets || mainWallets.length === 0) {
      return NextResponse.json({ imported: 0 })
    }

    const { data: existingNew } = await supabase
      .from('wallets_new')
      .select('address')

    const existingSet = new Set((existingNew || []).map((w: Record<string, unknown>) => w.address))
    const toImport = mainWallets.filter((w: Record<string, unknown>) => !existingSet.has(w.address as string))

    if (toImport.length === 0) {
      return NextResponse.json({ imported: 0 })
    }

    const { error } = await supabase
      .from('wallets_new')
      .upsert(
        toImport.map((w: Record<string, unknown>) => ({
          address: w.address,
          username: w.username || null,
        })),
        { onConflict: 'address' }
      )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ imported: toImport.length })
  }

  if (body.action === 'stats') {
    const supabase = getSupabase()
    const stats = await getStats(supabase)
    return NextResponse.json({ stats })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
