import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

const DATA_API_BASE = 'https://data-api.polymarket.com'

type Status = 'healthy' | 'degraded' | 'down'

interface ServiceStatus {
  status: Status
  latency_ms: number
  detail?: string
}

interface HealthResponse {
  overall: Status
  services: {
    vps_service: ServiceStatus & { last_trade_at?: string; last_wallet_update?: string }
    polymarket_api: ServiceStatus
    supabase: ServiceStatus & { wallet_count?: number }
  }
  checked_at: string
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const [vpsResult, apiResult, dbResult] = await Promise.allSettled([
    checkVpsService(),
    checkPolymarketApi(),
    checkSupabase(),
  ])

  const vps = vpsResult.status === 'fulfilled'
    ? vpsResult.value
    : { status: 'down' as Status, latency_ms: 0, detail: 'Check failed' }
  const api = apiResult.status === 'fulfilled'
    ? apiResult.value
    : { status: 'down' as Status, latency_ms: 0, detail: 'Check failed' }
  const db = dbResult.status === 'fulfilled'
    ? dbResult.value
    : { status: 'down' as Status, latency_ms: 0, detail: 'Check failed' }

  const statuses = [vps.status, api.status, db.status]
  let overall: Status = 'healthy'
  if (statuses.includes('down')) overall = 'down'
  else if (statuses.includes('degraded')) overall = 'degraded'

  const response: HealthResponse = {
    overall,
    services: {
      vps_service: vps,
      polymarket_api: api,
      supabase: db,
    },
    checked_at: new Date().toISOString(),
  }

  return NextResponse.json(response)
}

async function checkVpsService(): Promise<ServiceStatus & { last_trade_at?: string; last_wallet_update?: string; wallet_discovery_enabled?: boolean }> {
  const start = Date.now()
  try {
    const [tradeRes, walletRes, settingsRes] = await Promise.all([
      supabase
        .from('live_trades')
        .select('received_at')
        .order('received_at', { ascending: false })
        .limit(1),
      supabase
        .from('wallets')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'wallet_discovery_enabled')
        .single(),
    ])

    const latency = Date.now() - start

    if (tradeRes.error) {
      return { status: 'down', latency_ms: latency, detail: tradeRes.error.message }
    }

    const lastTradeAt = tradeRes.data?.[0]?.received_at
    const lastWalletUpdate = walletRes.data?.[0]?.updated_at

    if (!lastTradeAt) {
      return { status: 'down', latency_ms: latency, detail: 'No trades found', last_wallet_update: lastWalletUpdate }
    }

    const ageMs = Date.now() - new Date(lastTradeAt).getTime()
    const ageMinutes = ageMs / (1000 * 60)

    let status: Status = 'healthy'
    let detail: string

    if (ageMinutes > 15) {
      status = 'down'
      detail = `No trades in ${Math.round(ageMinutes)}m`
    } else if (ageMinutes > 5) {
      status = 'degraded'
      detail = `Last trade ${Math.round(ageMinutes)}m ago`
    } else if (ageMinutes < 1) {
      detail = `Last trade ${Math.round(ageMs / 1000)}s ago`
    } else {
      detail = `Last trade ${Math.round(ageMinutes)}m ago`
    }

    // Extract discovery enabled state
    let discoveryEnabled = true
    if (settingsRes.data && !settingsRes.error) {
      const val = settingsRes.data.value
      discoveryEnabled = typeof val === 'boolean' ? val : String(val).toLowerCase() === 'true'
    }

    return { status, latency_ms: latency, detail, last_trade_at: lastTradeAt, last_wallet_update: lastWalletUpdate, wallet_discovery_enabled: discoveryEnabled }
  } catch {
    return { status: 'down', latency_ms: Date.now() - start, detail: 'Check failed' }
  }
}

async function checkPolymarketApi(): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(
      `${DATA_API_BASE}/value?user=0x0000000000000000000000000000000000000000`,
      { signal: controller.signal, cache: 'no-store' }
    )
    clearTimeout(timeout)

    const latency = Date.now() - start

    if (response.ok) {
      return { status: 'healthy', latency_ms: latency, detail: `${latency}ms` }
    }
    return { status: 'down', latency_ms: latency, detail: `HTTP ${response.status}` }
  } catch {
    return { status: 'down', latency_ms: Date.now() - start, detail: 'Timeout or unreachable' }
  }
}

async function checkSupabase(): Promise<ServiceStatus & { wallet_count?: number }> {
  const start = Date.now()
  try {
    const { count, error } = await supabase
      .from('wallets')
      .select('*', { count: 'exact', head: true })

    const latency = Date.now() - start

    if (error) {
      return { status: 'down', latency_ms: latency, detail: error.message }
    }

    return { status: 'healthy', latency_ms: latency, detail: `${latency}ms`, wallet_count: count || 0 }
  } catch {
    return { status: 'down', latency_ms: Date.now() - start, detail: 'Connection failed' }
  }
}
