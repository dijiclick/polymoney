import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const VALID_INTERVALS = [1, 3, 12, 24, 48, 72]

/**
 * GET /api/tracked-wallets
 * Fetch all tracked wallets with their wallet metrics joined
 */
export async function GET() {
  try {
    const { data: tracked, error: trackedError } = await supabase
      .from('tracked_wallets')
      .select('*')
      .order('added_at', { ascending: false })

    if (trackedError) {
      return NextResponse.json({ error: trackedError.message }, { status: 500 })
    }

    if (!tracked || tracked.length === 0) {
      return NextResponse.json({ wallets: [], tracked: [] })
    }

    // Fetch wallet metrics for all tracked addresses
    const addresses = tracked.map(t => t.address)
    const { data: walletData, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .in('address', addresses)

    if (walletError) {
      return NextResponse.json({ error: walletError.message }, { status: 500 })
    }

    // Map wallet data by address for easy lookup
    const walletMap = new Map<string, any>()
    for (const w of walletData || []) {
      walletMap.set(w.address, w)
    }

    // Combine tracked info with wallet metrics
    const wallets = tracked.map(t => {
      const w = walletMap.get(t.address)
      return {
        // Wallet data with defaults
        address: t.address,
        source: w?.source || 'live',
        balance: w?.balance || 0,
        balance_updated_at: w?.balance_updated_at,
        username: w?.username,
        account_created_at: w?.account_created_at,
        pnl_7d: w?.pnl_7d || 0,
        roi_7d: w?.roi_7d || 0,
        win_rate_7d: w?.win_rate_7d || 0,
        volume_7d: w?.volume_7d || 0,
        trade_count_7d: w?.trade_count_7d || 0,
        drawdown_7d: w?.drawdown_7d || 0,
        pnl_30d: w?.pnl_30d || 0,
        roi_30d: w?.roi_30d || 0,
        win_rate_30d: w?.win_rate_30d || 0,
        volume_30d: w?.volume_30d || 0,
        trade_count_30d: w?.trade_count_30d || 0,
        drawdown_30d: w?.drawdown_30d || 0,
        pnl_all: w?.pnl_all || 0,
        roi_all: w?.roi_all || 0,
        win_rate_all: w?.win_rate_all || 0,
        volume_all: w?.volume_all || 0,
        trade_count_all: w?.trade_count_all || 0,
        drawdown_all: w?.drawdown_all || 0,
        drawdown_amount_all: w?.drawdown_amount_all || 0,
        total_positions: w?.total_positions || 0,
        active_positions: w?.active_positions || 0,
        total_wins: w?.total_wins || 0,
        total_losses: w?.total_losses || 0,
        realized_pnl: w?.realized_pnl || 0,
        unrealized_pnl: w?.unrealized_pnl || 0,
        overall_pnl: w?.overall_pnl || 0,
        overall_roi: w?.overall_roi || 0,
        overall_win_rate: w?.overall_win_rate || 0,
        total_volume: w?.total_volume || 0,
        total_trades: w?.total_trades || 0,
        top_category: w?.top_category || '',
        // Copy-trade metrics
        copy_score: w?.copy_score || 0,
        profit_factor_30d: w?.profit_factor_30d || 0,
        profit_factor_all: w?.profit_factor_all || 0,
        diff_win_rate_30d: w?.diff_win_rate_30d || 0,
        diff_win_rate_all: w?.diff_win_rate_all || 0,
        weekly_profit_rate: w?.weekly_profit_rate || 0,
        avg_trades_per_day: w?.avg_trades_per_day || 0,
        median_profit_pct: w?.median_profit_pct ?? null,
        metrics_updated_at: w?.metrics_updated_at,
        created_at: w?.created_at || t.added_at,
        updated_at: w?.updated_at || t.added_at,
      }
    })

    return NextResponse.json({ wallets, tracked })
  } catch (error) {
    console.error('Error fetching tracked wallets:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/tracked-wallets
 * Actions: add, remove, update_interval, check_batch, mark_refreshed
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'add') {
      const address = body.address?.toLowerCase()
      if (!address) {
        return NextResponse.json({ error: 'Address required' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('tracked_wallets')
        .upsert({ address }, { onConflict: 'address' })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, tracked: data })
    }

    if (action === 'remove') {
      const address = body.address?.toLowerCase()
      if (!address) {
        return NextResponse.json({ error: 'Address required' }, { status: 400 })
      }

      const { error } = await supabase
        .from('tracked_wallets')
        .delete()
        .eq('address', address)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'update_interval') {
      const address = body.address?.toLowerCase()
      const interval = body.interval
      if (!address) {
        return NextResponse.json({ error: 'Address required' }, { status: 400 })
      }
      if (!VALID_INTERVALS.includes(interval)) {
        return NextResponse.json({ error: `Invalid interval. Valid: ${VALID_INTERVALS.join(', ')}` }, { status: 400 })
      }

      const { error } = await supabase
        .from('tracked_wallets')
        .update({ update_interval_hours: interval })
        .eq('address', address)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'check_batch') {
      const addresses: string[] = (body.addresses || []).map((a: string) => a.toLowerCase())
      if (addresses.length === 0) {
        return NextResponse.json({ tracked: [] })
      }

      const { data, error } = await supabase
        .from('tracked_wallets')
        .select('address')
        .in('address', addresses)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ tracked: (data || []).map(d => d.address) })
    }

    if (action === 'mark_refreshed') {
      const address = body.address?.toLowerCase()
      if (!address) {
        return NextResponse.json({ error: 'Address required' }, { status: 400 })
      }

      const { error } = await supabase
        .from('tracked_wallets')
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq('address', address)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error in tracked-wallets API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
