import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Get wallet count before deletion
    const { count } = await supabase
      .from('wallets')
      .select('*', { count: 'exact', head: true })

    // Delete wallets — CASCADE deletes wallet_trades and wallet_leaderboard_rankings
    const { error: walletsErr } = await supabase
      .from('wallets')
      .delete()
      .neq('address', '')

    if (walletsErr) {
      return NextResponse.json({ error: `Failed to delete wallets: ${walletsErr.message}` }, { status: 500 })
    }

    // Delete tracked_wallets (no FK cascade from wallets)
    const { error: trackedErr } = await supabase
      .from('tracked_wallets')
      .delete()
      .neq('address', '')

    if (trackedErr) {
      console.error('Failed to delete tracked_wallets:', trackedErr.message)
    }

    // Delete live_trades (no FK to wallets)
    const { error: liveErr } = await supabase
      .from('live_trades')
      .delete()
      .gt('id', 0)

    if (liveErr) {
      console.error('Failed to delete live_trades:', liveErr.message)
    }

    return NextResponse.json({
      success: true,
      deleted_wallets: count || 0,
    })
  } catch (error) {
    console.error('Error resetting database:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
