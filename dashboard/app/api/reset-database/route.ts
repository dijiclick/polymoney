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

    // Delete wallets
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

    // Delete New system tables (activities + trades have FK to wallets_new, delete children first)
    const { error: activitiesErr } = await supabase
      .from('activities')
      .delete()
      .neq('wallet_address', '')

    if (activitiesErr) {
      console.error('Failed to delete activities:', activitiesErr.message)
    }

    const { error: tradesErr } = await supabase
      .from('trades')
      .delete()
      .gt('id', 0)

    if (tradesErr) {
      console.error('Failed to delete trades:', tradesErr.message)
    }

    const { count: newCount } = await supabase
      .from('wallets_new')
      .select('*', { count: 'exact', head: true })

    const { error: walletsNewErr } = await supabase
      .from('wallets_new')
      .delete()
      .neq('address', '')

    if (walletsNewErr) {
      console.error('Failed to delete wallets_new:', walletsNewErr.message)
    }

    return NextResponse.json({
      success: true,
      deleted_wallets: count || 0,
      deleted_wallets_new: newCount || 0,
      tables: ['wallets', 'tracked_wallets', 'live_trades', 'activities', 'trades', 'wallets_new'],
    })
  } catch (error) {
    console.error('Error resetting database:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
