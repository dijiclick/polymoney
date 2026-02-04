import { NextRequest, NextResponse } from 'next/server'
import { supabase, Wallet, WalletSource } from '@/lib/supabase'

// Valid columns for sorting
const VALID_SORT_COLUMNS = [
  'balance',
  // Copy-trade score (primary ranking)
  'copy_score',
  'profit_factor_30d',
  'profit_factor_all',
  'diff_win_rate_30d',
  'diff_win_rate_all',
  'weekly_profit_rate',
  'avg_trades_per_day',
  'median_profit_pct',
  // Period metrics (7d/30d/all)
  'win_rate_7d',
  'win_rate_30d',
  'win_rate_all',
  'pnl_7d',
  'pnl_30d',
  'pnl_all',
  'volume_7d',
  'volume_30d',
  'volume_all',
  'trade_count_7d',
  'trade_count_30d',
  'trade_count_all',
  'wins_7d',
  'wins_30d',
  'wins_all',
  'losses_7d',
  'losses_30d',
  'losses_all',
  'drawdown_7d',
  'drawdown_30d',
  'drawdown_all',
  'drawdown_amount_all',
  // Copy-trade detection metrics
  'sell_ratio',
  'trades_per_market',
  // Overall/legacy metrics
  'overall_win_rate',
  'overall_pnl',
  'realized_pnl',
  'unrealized_pnl',
  'total_volume',
  'total_positions',
  'active_positions',
  'total_trades',
  'total_wins',
  'total_losses',
  'account_created_at',
  'created_at',
  'updated_at'
]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') as WalletSource | 'all' | null
    const minBalance = parseFloat(searchParams.get('minBalance') || '0')
    const minWinRate = parseFloat(searchParams.get('minWinRate') || '0')
    const period = searchParams.get('period') || '7d'
    const limit = parseInt(searchParams.get('limit') || '50')
    const sortBy = searchParams.get('sortBy') || 'balance'
    const sortAsc = searchParams.get('sortDir') === 'asc'

    const search = searchParams.get('search')?.toLowerCase().trim() || ''
    const includeStats = searchParams.get('includeStats') === 'true'

    // Cursor parameters (null = first page)
    const cursorSortValue = searchParams.get('cursorSortValue') || null
    const cursorAddress = searchParams.get('cursorAddress') || null

    // Validate sort column
    const safeSortBy = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : 'balance'

    // Always use exact count (table is small enough, ~11K rows)
    const columnFiltersParam = searchParams.get('columnFilters')
    const hasFilters = search || minBalance > 0 || minWinRate > 0 || (source && source !== 'all') || columnFiltersParam
    let query = supabase
      .from('wallets')
      .select('*', { count: 'exact' })

    // Server-side search by username or address
    if (search) {
      query = query.or(`username.ilike.%${search}%,address.ilike.%${search}%`)
    }

    // Filter by minimum balance
    if (minBalance > 0) {
      query = query.gte('balance', minBalance)
    }

    // Filter by minimum win rate (based on selected period)
    if (minWinRate > 0) {
      const winRateColumn = period === 'all' ? 'win_rate_all' : period === '30d' ? 'win_rate_30d' : 'win_rate_7d'
      query = query.gte(winRateColumn, minWinRate)
    }

    // Filter by source
    if (source && source !== 'all') {
      query = query.eq('source', source)
    }

    // Apply column filters (min/max ranges)
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

    // Cursor-based pagination: filter to rows after the cursor position
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

    // Run wallet query and optional stats query in parallel
    const queryPromise = query
    const statsPromise = includeStats
      ? Promise.resolve(supabase.rpc('get_wallet_stats')).then(r => r.data).catch(() => null)
      : Promise.resolve(null)

    const [{ data, error, count }, statsData] = await Promise.all([queryPromise, statsPromise])

    if (error) {
      console.error('Error fetching wallets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Map with defaults
    const wallets: Wallet[] = (data || []).map((wallet: any) => ({
      ...wallet,
      pnl_7d: wallet.pnl_7d || 0,
      pnl_30d: wallet.pnl_30d || 0,
      win_rate_7d: wallet.win_rate_7d || 0,
      win_rate_30d: wallet.win_rate_30d || 0,
      volume_7d: wallet.volume_7d || 0,
      volume_30d: wallet.volume_30d || 0,
      trade_count_7d: wallet.trade_count_7d || 0,
      trade_count_30d: wallet.trade_count_30d || 0,
      drawdown_7d: wallet.drawdown_7d || 0,
      drawdown_30d: wallet.drawdown_30d || 0,
      pnl_all: wallet.pnl_all || 0,
      win_rate_all: wallet.win_rate_all || 0,
      volume_all: wallet.volume_all || 0,
      trade_count_all: wallet.trade_count_all || 0,
      drawdown_all: wallet.drawdown_all || 0,
      drawdown_amount_all: wallet.drawdown_amount_all || 0,
      total_positions: wallet.total_positions || 0,
      active_positions: wallet.active_positions || 0,
      total_wins: wallet.total_wins || 0,
      total_losses: wallet.total_losses || 0,
      realized_pnl: wallet.realized_pnl || 0,
      unrealized_pnl: wallet.unrealized_pnl || 0,
      overall_pnl: wallet.overall_pnl || 0,
      overall_win_rate: wallet.overall_win_rate || 0,
      total_volume: wallet.total_volume || 0,
      total_trades: wallet.total_trades || 0,
      top_category: wallet.top_category || '',
      // Copy-trade metrics
      profit_factor_30d: wallet.profit_factor_30d || 0,
      profit_factor_all: wallet.profit_factor_all || 0,
      diff_win_rate_30d: wallet.diff_win_rate_30d || 0,
      diff_win_rate_all: wallet.diff_win_rate_all || 0,
      weekly_profit_rate: wallet.weekly_profit_rate || 0,
      copy_score: wallet.copy_score || 0,
      avg_trades_per_day: wallet.avg_trades_per_day || 0,
    }))

    // Build next cursor from the last item
    const lastWallet = wallets.length > 0 ? wallets[wallets.length - 1] : null
    const nextCursor = lastWallet ? {
      sortValue: String((lastWallet as any)[safeSortBy] ?? ''),
      address: lastWallet.address,
    } : null

    return NextResponse.json({
      wallets,
      totalEstimate: count || 0,
      isExactCount: true,
      nextCursor,
      hasMore: wallets.length === limit,
      ...(statsData && { stats: statsData }),
    })
  } catch (error) {
    console.error('Error in wallets API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Get wallet statistics
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'stats') {
      // Try RPC function first (efficient aggregates), fall back to client-side
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_wallet_stats')

      if (!rpcError && rpcData) {
        // Add analyze speed: count wallets analyzed in the last hour
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
        const { count: recentCount } = await supabase
          .from('wallets')
          .select('*', { count: 'exact', head: true })
          .gte('metrics_updated_at', oneHourAgo)
        const analyzedPerHour = recentCount || 0
        const avgSecondsPerWallet = analyzedPerHour > 0 ? Math.round(3600 / analyzedPerHour) : 0

        return NextResponse.json({ stats: { ...rpcData, avgAnalyzeSpeed: avgSecondsPerWallet, analyzedPerHour } })
      }

      // Fallback: use count queries to avoid Supabase 1000-row default limit
      const [totalRes, analyzedRes, speedRes] = await Promise.all([
        supabase.from('wallets').select('*', { count: 'exact', head: true }),
        supabase.from('wallets').select('*', { count: 'exact', head: true }).not('metrics_updated_at', 'is', null),
        supabase.from('wallets').select('*', { count: 'exact', head: true }).gte('metrics_updated_at', new Date(Date.now() - 3600000).toISOString()),
      ])

      if (totalRes.error) {
        return NextResponse.json({ error: totalRes.error.message }, { status: 500 })
      }

      const total = totalRes.count || 0
      const analyzed = analyzedRes.count || 0
      const analyzedPerHour = speedRes.count || 0
      const avgSecondsPerWallet = analyzedPerHour > 0 ? Math.round(3600 / analyzedPerHour) : 0

      const stats = {
        total,
        analyzed,
        avgAnalyzeSpeed: avgSecondsPerWallet,
        analyzedPerHour,
      }

      return NextResponse.json({ stats })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in wallets stats:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
