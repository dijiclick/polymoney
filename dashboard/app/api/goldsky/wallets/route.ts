import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Wallet } from '@/lib/supabase'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const VALID_SORT_COLUMNS = [
  'balance', 'copy_score', 'profit_factor_30d', 'profit_factor_all',
  'weekly_profit_rate', 'avg_trades_per_day', 'median_profit_pct',
  'win_rate_7d', 'win_rate_30d', 'win_rate_all',
  'pnl_7d', 'pnl_30d', 'pnl_all',
  'roi_7d', 'roi_30d', 'roi_all',
  'volume_7d', 'volume_30d', 'volume_all',
  'trade_count_7d', 'trade_count_30d', 'trade_count_all',
  'drawdown_7d', 'drawdown_30d', 'drawdown_all',
  'overall_pnl', 'overall_roi', 'overall_win_rate',
  'realized_pnl', 'unrealized_pnl', 'total_volume',
  'total_positions', 'active_positions', 'total_trades',
  'total_wins', 'total_losses', 'created_at', 'updated_at',
]

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const minBalance = parseFloat(searchParams.get('minBalance') || '0')
    const minWinRate = parseFloat(searchParams.get('minWinRate') || '0')
    const period = searchParams.get('period') || '7d'
    const limit = parseInt(searchParams.get('limit') || '50')
    const sortBy = searchParams.get('sortBy') || 'copy_score'
    const sortAsc = searchParams.get('sortDir') === 'asc'
    const search = searchParams.get('search')?.toLowerCase().trim() || ''

    const cursorSortValue = searchParams.get('cursorSortValue') || null
    const cursorAddress = searchParams.get('cursorAddress') || null

    const safeSortBy = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : 'copy_score'

    let query = supabase
      .from('goldsky_wallets')
      .select('*', { count: 'estimated' })

    if (search) {
      query = query.or(`username.ilike.%${search}%,address.ilike.%${search}%`)
    }

    if (minBalance > 0) {
      query = query.gte('balance', minBalance)
    }

    if (minWinRate > 0) {
      const winRateColumn = period === 'all' ? 'win_rate_all' : period === '30d' ? 'win_rate_30d' : 'win_rate_7d'
      query = query.gte(winRateColumn, minWinRate)
    }

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

    query = query
      .order(safeSortBy, { ascending: sortAsc, nullsFirst: false })
      .order('address', { ascending: sortAsc })
      .limit(limit)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching goldsky wallets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const wallets: Wallet[] = (data || []).map((wallet: any) => ({
      ...wallet,
      source: wallet.source || 'goldsky',
      pnl_7d: wallet.pnl_7d || 0,
      pnl_30d: wallet.pnl_30d || 0,
      roi_7d: wallet.roi_7d || 0,
      roi_30d: wallet.roi_30d || 0,
      win_rate_7d: wallet.win_rate_7d || 0,
      win_rate_30d: wallet.win_rate_30d || 0,
      volume_7d: wallet.volume_7d || 0,
      volume_30d: wallet.volume_30d || 0,
      trade_count_7d: wallet.trade_count_7d || 0,
      trade_count_30d: wallet.trade_count_30d || 0,
      drawdown_7d: wallet.drawdown_7d || 0,
      drawdown_30d: wallet.drawdown_30d || 0,
      pnl_all: wallet.pnl_all || 0,
      roi_all: wallet.roi_all || 0,
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
      overall_roi: wallet.overall_roi || 0,
      overall_win_rate: wallet.overall_win_rate || 0,
      total_volume: wallet.total_volume || 0,
      total_trades: wallet.total_trades || 0,
      top_category: wallet.top_category || '',
      profit_factor_30d: wallet.profit_factor_30d || 0,
      profit_factor_all: wallet.profit_factor_all || 0,
      diff_win_rate_30d: wallet.diff_win_rate_30d || 0,
      diff_win_rate_all: wallet.diff_win_rate_all || 0,
      weekly_profit_rate: wallet.weekly_profit_rate || 0,
      copy_score: wallet.copy_score || 0,
      avg_trades_per_day: wallet.avg_trades_per_day || 0,
    }))

    const lastWallet = wallets.length > 0 ? wallets[wallets.length - 1] : null
    const nextCursor = lastWallet ? {
      sortValue: String((lastWallet as any)[safeSortBy] ?? ''),
      address: lastWallet.address,
    } : null

    return NextResponse.json({
      wallets,
      totalEstimate: count || 0,
      nextCursor,
      hasMore: wallets.length === limit,
    })
  } catch (error) {
    console.error('Error in goldsky wallets API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'stats') {
      const { data: wallets, error } = await supabase
        .from('goldsky_wallets')
        .select('balance, metrics_updated_at')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const stats = {
        total: wallets?.length || 0,
        analyzed: wallets?.filter(w => w.metrics_updated_at).length || 0,
        totalBalance: wallets?.reduce((sum, w) => sum + (w.balance || 0), 0) || 0,
        avgBalance: wallets?.length ? wallets.reduce((sum, w) => sum + (w.balance || 0), 0) / wallets.length : 0,
      }

      return NextResponse.json({ stats })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in goldsky wallets stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
