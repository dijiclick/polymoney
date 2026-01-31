/**
 * Live wallet discovery + activity-based sync.
 *
 * 1. Connects to Polymarket RTDS WebSocket
 * 2. Watches for trades >= $100
 * 3. Adds new wallets to wallets_new
 * 4. Syncs their trade history from the Activity API
 * 5. Re-syncs existing wallets periodically
 *
 * Usage: node scripts/live-sync.js [--workers=N] [--cooldown=MINUTES]
 */

import { RTDSClient } from '../lib/rtds-client.js'
import { getSupabase } from '../lib/supabase.js'
import { syncWallet } from './sync-wallet.js'
import { formatAddress } from '../lib/utils.js'

// Configuration
const DISCOVERY_THRESHOLD_USD = 100
const SYNC_WORKERS = parseInt(process.argv.find(a => a.startsWith('--workers='))?.split('=')[1] || '3', 10)
const COOLDOWN_MINUTES = parseInt(process.argv.find(a => a.startsWith('--cooldown='))?.split('=')[1] || '60', 10)
const RESYNC_INTERVAL_MS = 30 * 60 * 1000
const STATS_INTERVAL_MS = 60 * 1000
const MAX_QUEUE_SIZE = 5000

// State
const knownWallets = new Set()
const walletLastSynced = new Map()
const pendingQueue = []
const pendingSet = new Set()
let syncInProgress = 0
let totalDiscovered = 0
let totalSynced = 0
let totalFailed = 0

const supabase = getSupabase()

/** Load known wallets from DB at startup */
async function loadKnownWallets() {
  const { data } = await supabase
    .from('wallets_new')
    .select('address, last_synced_at')

  if (data) {
    for (const w of data) {
      knownWallets.add(w.address)
      if (w.last_synced_at) {
        walletLastSynced.set(w.address, new Date(w.last_synced_at).getTime())
      }
    }
    console.log(`[INIT] Loaded ${data.length} known wallets from DB`)
  }
}

/** Add a wallet to the sync queue if not already queued/recently synced */
function enqueueWallet(address) {
  if (pendingSet.has(address)) return
  if (pendingQueue.length >= MAX_QUEUE_SIZE) return

  const lastSync = walletLastSynced.get(address) || 0
  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000
  if (Date.now() - lastSync < cooldownMs) return

  pendingQueue.push(address)
  pendingSet.add(address)
}

/** Process the trade queue - runs SYNC_WORKERS concurrent syncs */
async function processQueue() {
  while (true) {
    if (pendingQueue.length === 0 || syncInProgress >= SYNC_WORKERS) {
      await sleep(500)
      continue
    }

    const address = pendingQueue.shift()
    pendingSet.delete(address)
    syncInProgress++

    ;(async () => {
      try {
        const isNew = !knownWallets.has(address)

        // Always ensure wallet exists in wallets_new before syncing.
        // The in-memory knownWallets Set can become stale if the DB is cleared
        // while this process is running, causing FK constraint errors on trade inserts.
        let username = null
        if (isNew) {
          // Only fetch username for truly new wallets
          try {
            const res = await fetch(`https://polymarket.com/api/profile/${address}`)
            if (res.ok) {
              const data = await res.json()
              username = data?.username || null
            }
          } catch {}
        }

        const upsertData = isNew ? { address, username } : { address }
        const { error } = await supabase
          .from('wallets_new')
          .upsert(upsertData, { onConflict: 'address', ignoreDuplicates: !isNew })

        if (error) {
          console.error(`[DISCOVER] Failed to ensure ${formatAddress(address)}: ${error.message}`)
          totalFailed++
          return
        }

        if (isNew) {
          knownWallets.add(address)
          totalDiscovered++
          console.log(`[DISCOVER] New wallet: ${formatAddress(address)}${username ? ` (@${username})` : ''} | Queue: ${pendingQueue.length}`)
        }

        const result = await syncWallet(address)
        if (result.success) {
          totalSynced++
          walletLastSynced.set(address, Date.now())
          if (result.newActivities > 0) {
            console.log(`[SYNC] ${formatAddress(address)}: ${result.newActivities} activities, ${result.tradesCreated} new trades, ${result.tradesUpdated} updated`)
          }
        } else {
          totalFailed++
          console.error(`[SYNC] ${formatAddress(address)} FAILED: ${result.error}`)
        }
      } catch (err) {
        totalFailed++
        console.error(`[SYNC] ${formatAddress(address)} error:`, err)
      } finally {
        syncInProgress--
      }
    })()
  }
}

/** Periodically re-sync all existing wallets */
async function periodicResync() {
  while (true) {
    await sleep(RESYNC_INTERVAL_MS)

    console.log('[RESYNC] Queueing all wallets for re-sync...')
    const { data: wallets } = await supabase
      .from('wallets_new')
      .select('address')
      .order('last_synced_at', { ascending: true, nullsFirst: true })

    if (wallets) {
      let queued = 0
      for (const w of wallets) {
        enqueueWallet(w.address)
        queued++
      }
      console.log(`[RESYNC] Queued ${queued} wallets (queue size: ${pendingQueue.length})`)
    }
  }
}

/** Print stats periodically */
async function printStats(client) {
  while (true) {
    await sleep(STATS_INTERVAL_MS)
    const stats = client.getStats()
    console.log(
      `[STATS] WS: ${stats.messages} msgs, ${stats.trades} trades, ${stats.qualified} qualified (>=$${DISCOVERY_THRESHOLD_USD}) | ` +
      `Discovered: ${totalDiscovered} | Synced: ${totalSynced} | Failed: ${totalFailed} | ` +
      `Queue: ${pendingQueue.length} | Workers: ${syncInProgress}/${SYNC_WORKERS} | ` +
      `Known: ${knownWallets.size}`
    )
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Handle incoming trade from RTDS */
function handleTrade(trade) {
  enqueueWallet(trade.traderAddress)
}

async function main() {
  console.log('\u2550'.repeat(60))
  console.log('  POLYMARKET LIVE WALLET DISCOVERY + ACTIVITY SYNC')
  console.log('\u2550'.repeat(60))
  console.log()
  console.log(`  Threshold:   $${DISCOVERY_THRESHOLD_USD}+ trades`)
  console.log(`  Workers:     ${SYNC_WORKERS} concurrent syncs`)
  console.log(`  Cooldown:    ${COOLDOWN_MINUTES} minutes between re-syncs`)
  console.log(`  Re-sync:     Every ${RESYNC_INTERVAL_MS / 60000} minutes`)
  console.log()
  console.log('\u2500'.repeat(60))

  await loadKnownWallets()

  const client = new RTDSClient({
    minUsdValue: DISCOVERY_THRESHOLD_USD,
    onTrade: handleTrade,
    onConnect: () => {
      console.log('[RTDS] Connected - watching for live trades...')
    },
    onDisconnect: (reason) => {
      console.log(`[RTDS] Disconnected: ${reason}`)
    },
  })

  const tasks = [
    client.start(),
    processQueue(),
    periodicResync(),
    printStats(client),
  ]

  process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Stopping...')
    client.stop()
    console.log(`[SHUTDOWN] Final stats: Discovered ${totalDiscovered}, Synced ${totalSynced}, Failed ${totalFailed}`)
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    client.stop()
    process.exit(0)
  })

  await Promise.all(tasks)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
