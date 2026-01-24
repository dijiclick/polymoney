import { NextRequest, NextResponse } from 'next/server'
import { supabase, Wallet, WalletSource } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') as WalletSource | 'all' | null
    const category = searchParams.get('category')
    const minBalance = parseFloat(searchParams.get('minBalance') || '0')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const sortBy = searchParams.get('sortBy') || 'balance'
    const sortDir = searchParams.get('sortDir') === 'asc' ? true : false

    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('wallets')
      .select('*, wallet_leaderboard_rankings(*)', { count: 'exact' })

    // Filter by minimum balance
    if (minBalance > 0) {
      query = query.gte('balance', minBalance)
    }

    // Filter by source
    if (source && source !== 'all') {
      if (source === 'both') {
        query = query.eq('source', 'both')
      } else {
        // Include 'both' when filtering by specific source
        query = query.or(`source.eq.${source},source.eq.both`)
      }
    }

    // Sort
    query = query.order(sortBy, { ascending: sortDir })

    // Paginate
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching wallets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Process wallets to add computed fields
    const wallets: Wallet[] = (data || []).map((wallet: any) => {
      const rankings = wallet.wallet_leaderboard_rankings || []
      const categories = [...new Set(rankings.map((r: any) => r.category))]
      const bestRank = rankings.length > 0
        ? Math.min(...rankings.map((r: any) => r.rank))
        : null

      return {
        ...wallet,
        categories: categories.length > 0 ? categories : undefined,
        best_rank: bestRank
      }
    })

    // Filter by category if specified
    let filteredWallets = wallets
    if (category) {
      filteredWallets = wallets.filter(w =>
        w.categories?.includes(category)
      )
    }

    return NextResponse.json({
      wallets: filteredWallets,
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
        goldsky: wallets?.filter(w => w.source === 'goldsky' || w.source === 'both').length || 0,
        leaderboard: wallets?.filter(w => w.source === 'leaderboard' || w.source === 'both').length || 0,
        both: wallets?.filter(w => w.source === 'both').length || 0,
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
