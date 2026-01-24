/**
 * Batch refresh all wallet metrics
 *
 * Run with: npx tsx scripts/refresh-all-metrics.ts
 *
 * This script:
 * 1. Fetches all wallet addresses from Supabase
 * 2. Calls the trader API for each to refresh metrics
 * 3. Shows progress and estimated time
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rrpjxbnqrjlnqnlgicdk.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

// Base URL for API calls
const API_BASE = process.env.API_BASE || 'http://localhost:3000'

// Delay between requests to avoid rate limiting (ms)
const DELAY_MS = 2000

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function refreshWallet(address: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/traders/${address}?refresh=true`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()
    if (data.error) {
      return { success: false, error: data.error }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function main() {
  console.log('🔄 Fetching all wallets from database...\n')

  // Get all wallet addresses
  const { data: wallets, error } = await supabase
    .from('wallets')
    .select('address, username')
    .order('balance', { ascending: false })

  if (error) {
    console.error('❌ Error fetching wallets:', error)
    process.exit(1)
  }

  if (!wallets || wallets.length === 0) {
    console.log('No wallets found')
    process.exit(0)
  }

  console.log(`📊 Found ${wallets.length} wallets to refresh`)
  console.log(`⏱️  Estimated time: ${Math.ceil((wallets.length * DELAY_MS) / 60000)} minutes\n`)

  let success = 0
  let failed = 0
  const startTime = Date.now()

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]
    const progress = `[${i + 1}/${wallets.length}]`
    const name = wallet.username || wallet.address.slice(0, 10) + '...'

    process.stdout.write(`${progress} Refreshing ${name}... `)

    const result = await refreshWallet(wallet.address)

    if (result.success) {
      console.log('✅')
      success++
    } else {
      console.log(`❌ ${result.error}`)
      failed++
    }

    // Progress stats
    if ((i + 1) % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = (i + 1) / elapsed
      const remaining = (wallets.length - i - 1) / rate
      console.log(`\n📈 Progress: ${success} success, ${failed} failed`)
      console.log(`⏱️  Remaining: ~${Math.ceil(remaining / 60)} minutes\n`)
    }

    // Delay between requests
    if (i < wallets.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  const totalTime = (Date.now() - startTime) / 1000

  console.log('\n════════════════════════════════════════')
  console.log('📊 BATCH REFRESH COMPLETE')
  console.log('════════════════════════════════════════')
  console.log(`✅ Success: ${success}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${Math.floor(totalTime % 60)}s`)
}

main().catch(console.error)
