import { getSupabase } from '../lib/supabase.js'
import { isValidAddress } from '../lib/utils.js'

async function main() {
  const address = process.argv[2]?.toLowerCase()

  if (!address) {
    console.error('Usage: node scripts/add-wallet.js <address>')
    process.exit(1)
  }

  if (!isValidAddress(address)) {
    console.error(`Invalid Ethereum address: ${address}`)
    process.exit(1)
  }

  const supabase = getSupabase()

  // Check if already exists
  const { data: existing } = await supabase
    .from('wallets_new')
    .select('address')
    .eq('address', address)
    .single()

  if (existing) {
    console.log(`Wallet ${address} already tracked.`)
    return
  }

  // Insert new wallet
  const { error } = await supabase
    .from('wallets_new')
    .insert({ address })

  if (error) {
    console.error('Failed to add wallet:', error.message)
    process.exit(1)
  }

  console.log(`Added wallet ${address} to tracking.`)
  console.log('Run sync to fetch trade history:')
  console.log(`  node scripts/sync-wallet.js ${address}`)
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
