import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshOneWallet, RefreshResult } from '@/lib/refresh-wallet'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * POST /api/admin/refresh-metrics
 *
 * Batch refresh wallet metrics using Polymarket API. Supports:
 * - ?limit=10 - refresh top N wallets by balance
 * - ?address=0x... - refresh specific wallet
 * - ?all=true - refresh all wallets (use with caution)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const limit = parseInt(searchParams.get('limit') || '10')
  const specificAddress = searchParams.get('address')
  const refreshAll = searchParams.get('all') === 'true'

  let query = supabase.from('wallets').select('address, username, balance')

  if (specificAddress) {
    query = query.eq('address', specificAddress.toLowerCase())
  } else if (!refreshAll) {
    query = query.order('balance', { ascending: false }).limit(limit)
  }

  const { data: wallets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ message: 'No wallets found' })
  }

  const results: RefreshResult[] = []

  for (const wallet of wallets) {
    const result = await refreshOneWallet(wallet)
    results.push(result)
  }

  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  return NextResponse.json({
    summary: {
      total: results.length,
      success: successCount,
      failed: failedCount,
    },
    results,
  })
}

/**
 * GET /api/admin/refresh-metrics
 * Returns current refresh status / wallet count
 */
export async function GET() {
  const { count, error } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    totalWallets: count,
    estimatedTimeMinutes: Math.ceil((count || 0) * 2 / 60),
    usage: {
      refreshTop10: 'POST /api/admin/refresh-metrics?limit=10',
      refreshAll: 'POST /api/admin/refresh-metrics?all=true',
      refreshOne: 'POST /api/admin/refresh-metrics?address=0x...',
    }
  })
}
