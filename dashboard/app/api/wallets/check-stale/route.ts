import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/wallets/check-stale
 * Body: { addresses: string[] }
 * Returns addresses whose metrics_updated_at is null or older than 1 day
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const addresses: string[] = body.addresses

  if (!addresses || addresses.length === 0) {
    return NextResponse.json({ stale: [] })
  }

  // Cap batch size
  const batch = addresses.slice(0, 100).map(a => a.toLowerCase())

  const { data, error } = await supabase
    .from('wallets')
    .select('address, metrics_updated_at')
    .in('address', batch)

  if (error) {
    return NextResponse.json({ stale: [] })
  }

  const now = Date.now()
  const foundMap = new Map<string, string | null>()
  for (const row of data || []) {
    foundMap.set(row.address, row.metrics_updated_at)
  }

  const stale: string[] = []
  for (const addr of batch) {
    const updatedAt = foundMap.get(addr)
    if (!updatedAt || now - new Date(updatedAt).getTime() > ONE_DAY_MS) {
      stale.push(addr)
    }
  }

  return NextResponse.json({ stale })
}
