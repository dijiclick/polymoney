import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params
  const supabase = getSupabase()

  // Get wallet info
  const { data: wallet, error: walletErr } = await supabase
    .from('wallets_new')
    .select('*')
    .eq('address', address.toLowerCase())
    .single()

  if (walletErr || !wallet) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
  }

  // Get all trades for this wallet, open first then closed, newest first
  const { data: trades, error: tradesErr } = await supabase
    .from('trades')
    .select('*')
    .eq('wallet_address', address.toLowerCase())
    .order('closed', { ascending: true })
    .order('open_timestamp', { ascending: false })

  if (tradesErr) {
    return NextResponse.json({ error: tradesErr.message }, { status: 500 })
  }

  return NextResponse.json({
    wallet,
    trades: trades || [],
  })
}
