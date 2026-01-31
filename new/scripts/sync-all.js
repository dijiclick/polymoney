import { getSupabase } from '../lib/supabase.js'
import { syncWallet } from './sync-wallet.js'
import { formatAddress } from '../lib/utils.js'

async function main() {
  const concurrency = parseInt(process.argv[2] || '1', 10)
  const supabase = getSupabase()

  // Get all tracked wallets
  const { data: wallets, error } = await supabase
    .from('wallets_new')
    .select('address, username')
    .order('added_at', { ascending: true })

  if (error || !wallets) {
    console.error('Failed to fetch wallets:', error?.message)
    process.exit(1)
  }

  if (wallets.length === 0) {
    console.log('No wallets to sync. Add wallets first:')
    console.log('  node scripts/add-wallet.js <address>')
    return
  }

  console.log(`Syncing ${wallets.length} wallets (concurrency: ${concurrency})...`)
  console.log('\u2500'.repeat(60))

  let success = 0
  let failed = 0

  if (concurrency <= 1) {
    // Sequential processing
    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i]
      const label = w.username || formatAddress(w.address)
      console.log(`\n[${i + 1}/${wallets.length}] ${label}`)

      const result = await syncWallet(w.address)
      if (result.success) {
        success++
      } else {
        failed++
        console.error(`  FAILED: ${result.error}`)
      }
    }
  } else {
    // Parallel processing with concurrency limit
    const queue = [...wallets]
    let index = 0

    async function worker() {
      while (index < queue.length) {
        const i = index++
        const w = queue[i]
        const label = w.username || formatAddress(w.address)
        console.log(`\n[${i + 1}/${queue.length}] ${label}`)

        const result = await syncWallet(w.address)
        if (result.success) {
          success++
        } else {
          failed++
          console.error(`  FAILED: ${result.error}`)
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
    await Promise.all(workers)
  }

  console.log('\n' + '\u2500'.repeat(60))
  console.log(`Sync complete: ${success} success, ${failed} failed out of ${wallets.length} wallets.`)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
