import { NextRequest, NextResponse } from 'next/server'
import { supabase, Wallet, WalletSource } from '@/lib/supabase'

// Valid columns for sorting
const VALID_SORT_COLUMNS = [
  'balance',
  'win_rate_7d',
  'win_rate_30d',
  'pnl_7d',
  'pnl_30d',
  'roi_7d',
  'roi_30d',
  'volume_7d',
  'volume_30d',
  'trade_count_7d',
  'trade_count_30d',
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
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const sortBy = searchParams.get('sortBy') || 'balance'
    const sortDir = searchParams.get('sortDir') === 'asc' ? true : false

    const offset = (page - 1) * limit

    // Validate sort column
    const safeSortBy = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : 'balance'

    // Build query - no more leaderboard join
    let query = supabase
      .from('wallets')
      .select('*', { count: 'exact' })

    // Filter by minimum balance
    if (minBalance > 0) {
      query = query.gte('balance', minBalance)
    }

    // Filter by minimum win rate (based on selected period)
    if (minWinRate > 0) {
      const winRateColumn = period === '30d' ? 'win_rate_30d' : 'win_rate_7d'
      query = query.gte(winRateColumn, minWinRate)
    }

    // Filter by source
    if (source && source !== 'all') {
      query = query.eq('source', source)
    }

    // Sort
    query = query.order(safeSortBy, { ascending: sortDir })

    // Paginate
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching wallets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Simple mapping - no more categories/best_rank processing
    const wallets: Wallet[] = (data || []).map((wallet: any) => ({
      ...wallet,
      // Ensure numeric fields have defaults
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
    }))

    return NextResponse.json({
      wallets,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
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
      // Get aggregate stats
      const { data: wallets, error } = await supabase
        .from('wallets')
        .select('source, balance')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const stats = {
        total: wallets?.length || 0,
        goldsky: wallets?.filter(w => w.source === 'goldsky').length || 0,
        live: wallets?.filter(w => w.source === 'live').length || 0,
        qualified200: wallets?.filter(w => w.balance >= 200).length || 0,
        totalBalance: wallets?.reduce((sum, w) => sum + (w.balance || 0), 0) || 0,
        avgBalance: wallets?.length ? wallets.reduce((sum, w) => sum + (w.balance || 0), 0) / wallets.length : 0
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
