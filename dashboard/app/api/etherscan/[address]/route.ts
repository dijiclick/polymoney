import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isValidEthAddress } from '@/lib/polymarket-api'
import { getUsdcTransfers } from '@/lib/etherscan-api'
import {
  classifyTransfers,
  summarizeFlows,
  calculateTrueRoi,
  calculateTrueDrawdown,
  CapitalFlowSummary,
  TrueMetrics,
} from '@/lib/capital-flows'

// Cache duration: 24 hours
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface EtherscanResponse {
  summary: CapitalFlowSummary
  metrics: TrueMetrics
  cached: boolean
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address: rawAddress } = await params
  const address = rawAddress.toLowerCase()

  if (!isValidEthAddress(address)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 })
  }

  const apiKey = process.env.ETHERSCAN_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not configured' }, { status: 500 })
  }

  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'
  const balanceParam = request.nextUrl.searchParams.get('balance')

  // Check cache
  const { data: dbWallet } = await supabase
    .from('wallets')
    .select('balance, capital_flows_json, capital_flows_cached_at, total_deposited, total_withdrawn, deposit_count, withdrawal_count, true_roi, true_roi_dollar, true_drawdown, true_drawdown_amount, first_deposit_at')
    .eq('address', address)
    .single()

  const isCacheFresh = dbWallet?.capital_flows_cached_at &&
    Date.now() - new Date(dbWallet.capital_flows_cached_at).getTime() < CACHE_DURATION_MS

  // Return cached data if fresh and not forcing refresh
  if (dbWallet && isCacheFresh && !forceRefresh) {
    let events: any[] = []
    try {
      events = dbWallet.capital_flows_json ? JSON.parse(dbWallet.capital_flows_json) : []
    } catch { /* ignore */ }

    const response: EtherscanResponse = {
      summary: {
        totalDeposited: dbWallet.total_deposited || 0,
        totalWithdrawn: dbWallet.total_withdrawn || 0,
        netDeposited: (dbWallet.total_deposited || 0) - (dbWallet.total_withdrawn || 0),
        depositCount: dbWallet.deposit_count || 0,
        withdrawalCount: dbWallet.withdrawal_count || 0,
        firstDepositAt: dbWallet.first_deposit_at ? Math.floor(new Date(dbWallet.first_deposit_at).getTime() / 1000) : null,
        lastDepositAt: null,
        events,
      },
      metrics: {
        trueRoi: dbWallet.true_roi,
        trueRoiDollar: dbWallet.true_roi_dollar,
        trueDrawdown: dbWallet.true_drawdown,
        trueDrawdownAmount: dbWallet.true_drawdown_amount,
      },
      cached: true,
    }
    return NextResponse.json(response)
  }

  // Fetch from Etherscan
  try {
    const transfers = await getUsdcTransfers(address, apiKey)
    const capitalEvents = classifyTransfers(transfers, address)
    const summary = summarizeFlows(capitalEvents)

    // Get current balance for ROI calculation
    const currentBalance = balanceParam
      ? parseFloat(balanceParam)
      : (dbWallet?.balance || 0)

    const roiResult = calculateTrueRoi(currentBalance, summary)

    // Drawdown calculation: currently limited to capital events only
    // (closed position PnL events would improve accuracy but require cached positions data)
    const drawdownResult = calculateTrueDrawdown(capitalEvents, [], currentBalance)

    // Save to database
    const updateData: Record<string, any> = {
      total_deposited: summary.totalDeposited,
      total_withdrawn: summary.totalWithdrawn,
      deposit_count: summary.depositCount,
      withdrawal_count: summary.withdrawalCount,
      true_roi: roiResult.trueRoi,
      true_roi_dollar: roiResult.trueRoiDollar,
      true_drawdown: drawdownResult.trueDrawdown,
      true_drawdown_amount: drawdownResult.trueDrawdownAmount,
      capital_flows_json: JSON.stringify(summary.events),
      capital_flows_cached_at: new Date().toISOString(),
    }

    if (summary.firstDepositAt) {
      updateData.first_deposit_at = new Date(summary.firstDepositAt * 1000).toISOString()
    }

    if (dbWallet) {
      await supabase.from('wallets').update(updateData).eq('address', address)
    }

    const response: EtherscanResponse = {
      summary,
      metrics: {
        trueRoi: roiResult.trueRoi,
        trueRoiDollar: roiResult.trueRoiDollar,
        trueDrawdown: drawdownResult.trueDrawdown,
        trueDrawdownAmount: drawdownResult.trueDrawdownAmount,
      },
      cached: false,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error(`Etherscan fetch error for ${address}:`, error)

    // Return cached data if available (even stale)
    if (dbWallet?.total_deposited != null) {
      let events: any[] = []
      try {
        events = dbWallet.capital_flows_json ? JSON.parse(dbWallet.capital_flows_json) : []
      } catch { /* ignore */ }

      return NextResponse.json({
        summary: {
          totalDeposited: dbWallet.total_deposited || 0,
          totalWithdrawn: dbWallet.total_withdrawn || 0,
          netDeposited: (dbWallet.total_deposited || 0) - (dbWallet.total_withdrawn || 0),
          depositCount: dbWallet.deposit_count || 0,
          withdrawalCount: dbWallet.withdrawal_count || 0,
          firstDepositAt: null,
          lastDepositAt: null,
          events,
        },
        metrics: {
          trueRoi: dbWallet.true_roi,
          trueRoiDollar: dbWallet.true_roi_dollar,
          trueDrawdown: dbWallet.true_drawdown,
          trueDrawdownAmount: dbWallet.true_drawdown_amount,
        },
        cached: true,
        warning: 'Etherscan API unavailable, showing stale data',
      })
    }

    return NextResponse.json({
      error: 'Failed to fetch capital flow data',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 502 })
  }
}
