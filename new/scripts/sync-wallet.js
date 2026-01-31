import { getSupabase, getConfig } from '../lib/supabase.js'
import { fetchActivities, fetchClosedPositions, fetchUnredeemedLosses } from '../lib/activity-api.js'
import { buildTrades, tradeStateToDbRow } from '../lib/trade-builder.js'
import { calculateWalletMetrics } from '../lib/metrics.js'
import { isValidAddress, formatAddress } from '../lib/utils.js'
import { timestampToISO } from '../lib/utils.js'

/**
 * Sync a single wallet's trade history.
 * Can be called from CLI or imported by sync-all / live-sync.
 *
 * Uses a hybrid approach:
 *  1. Fetch activities from the Activity API (max ~4000 due to offset cap)
 *  2. Build trades from those activities
 *  3. If activities don't cover 30 days, backfill from /closed-positions + /positions
 *     to create simplified trade records for resolved markets the activity API missed
 */
export async function syncWallet(address) {
  const supabase = getSupabase()
  const config = getConfig()

  // 1. Get wallet from DB
  const { data: wallet, error: walletErr } = await supabase
    .from('wallets_new')
    .select('*')
    .eq('address', address)
    .single()

  if (walletErr || !wallet) {
    return {
      address,
      newActivities: 0,
      tradesUpdated: 0,
      tradesCreated: 0,
      success: false,
      error: 'Wallet not found in DB. Run add-wallet first.',
    }
  }

  const sinceTimestamp = wallet.last_activity_timestamp || 0

  // 2. Fetch new activities from Polymarket API
  //    No maxDays limit — normal traders get full history from activities alone.
  //    High-frequency traders hit the API offset cap (~4000 records) and the
  //    backfill step below covers the last 30 days from /closed-positions.
  console.log(`  Fetching activities for ${formatAddress(address)}...`)
  const newActivities = await fetchActivities(address, {
    maxTrades: config.maxTradesPerWallet,
    sinceTimestamp,
  })

  if (newActivities.length === 0) {
    console.log('  No new activities found.')
    // Still update last_synced_at
    await supabase
      .from('wallets_new')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('address', address)

    return {
      address,
      newActivities: 0,
      tradesUpdated: 0,
      tradesCreated: 0,
      success: true,
    }
  }

  console.log(`  Found ${newActivities.length} new activities.`)

  // 3. Get existing open trades for this wallet
  const { data: openTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('wallet_address', address)
    .eq('closed', false)

  // 4. Build/update trades from activities
  const { upsertTrades, newActivitiesForDb } = buildTrades(
    address,
    newActivities,
    openTrades || []
  )

  let tradesCreated = 0
  let tradesUpdated = 0

  // 5. Upsert trades to DB
  for (const trade of upsertTrades) {
    const row = tradeStateToDbRow(trade)

    if (trade.id) {
      // Update existing trade
      const { error } = await supabase
        .from('trades')
        .update(row)
        .eq('id', trade.id)

      if (error) {
        console.error(`  Failed to update trade ${trade.id}:`, error.message)
      } else {
        tradesUpdated++
      }
    } else {
      // Insert new trade
      const { error } = await supabase
        .from('trades')
        .insert(row)

      if (error) {
        console.error('  Failed to insert trade:', error.message)
      } else {
        tradesCreated++
      }
    }
  }

  // 6. Insert activities (ignore duplicates)
  const activityRows = newActivitiesForDb.map(a => ({
    wallet_address: address,
    condition_id: a.conditionId,
    transaction_hash: a.transactionHash || null,
    timestamp: a.timestamp,
    type: a.type,
    side: a.side,
    outcome: a.outcome || null,
    size: parseFloat(a.size || '0'),
    price: parseFloat(a.price || '0'),
    usdc_size: parseFloat(a.usdcSize || '0'),
    title: a.title || null,
    slug: a.slug || null,
  }))

  // Batch insert activities (skip duplicates via onConflict)
  if (activityRows.length > 0) {
    const BATCH_SIZE = 500
    for (let i = 0; i < activityRows.length; i += BATCH_SIZE) {
      const batch = activityRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase
        .from('activities')
        .upsert(batch, {
          onConflict: 'wallet_address,transaction_hash,condition_id,side,outcome',
          ignoreDuplicates: true,
        })

      if (error) {
        console.error('  Failed to insert activities batch:', error.message)
      }
    }
  }

  // 7. Backfill from /closed-positions for high-volume traders
  //    The Activity API caps at ~4000 records. If that doesn't cover 30 days,
  //    fetch closed positions (no cap) and create trade records for any markets
  //    not already tracked by the activity-based trade builder.
  const BACKFILL_DAYS = 30
  const oldestActivityTs = newActivities.length > 0
    ? Math.min(...newActivities.map(a => a.timestamp).filter(t => t > 0))
    : 0
  const thirtyDaysAgoTs = Math.floor((Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000) / 1000)

  let backfillCount = 0
  if (oldestActivityTs > thirtyDaysAgoTs) {
    // Activities don't reach 30 days back — need backfill
    console.log(`  Activities only reach ${new Date(oldestActivityTs * 1000).toISOString().slice(0, 10)}. Backfilling from /closed-positions...`)

    // Get all existing trade condition_ids to avoid duplicates
    const { data: existingTrades } = await supabase
      .from('trades')
      .select('condition_id')
      .eq('wallet_address', address)

    const existingCids = new Set((existingTrades || []).map(t => t.condition_id))

    // Fetch closed positions (wins) + unredeemed losses for the backfill window
    const [closedPositions, unredeemedLosses] = await Promise.all([
      fetchClosedPositions(address, { maxDays: BACKFILL_DAYS }),
      fetchUnredeemedLosses(address),
    ])

    console.log(`  Found ${closedPositions.length} closed positions + ${unredeemedLosses.length} unredeemed losses for backfill.`)

    // Combine and group by conditionId — one trade per market
    const allResolved = [...closedPositions, ...unredeemedLosses]
    const marketMap = new Map()
    for (const pos of allResolved) {
      if (!pos.conditionId || existingCids.has(pos.conditionId)) continue
      if (!marketMap.has(pos.conditionId)) {
        marketMap.set(pos.conditionId, { positions: [], title: pos.title })
      }
      marketMap.get(pos.conditionId).positions.push(pos)
    }

    // Create simplified trade records for each market not already tracked
    for (const [conditionId, { positions, title }] of marketMap) {
      const totalBought = positions.reduce((s, p) => s + p.totalBought, 0)
      const totalPnl = positions.reduce((s, p) => s + p.realizedPnl, 0)
      const totalSold = totalBought + totalPnl
      const firstOutcome = positions[0]?.outcome || 'Yes'
      // Use the resolvedAt from the position as close timestamp
      const resolvedAt = positions[0]?.resolvedAt || null
      const resolvedTs = resolvedAt ? Math.floor(new Date(resolvedAt).getTime() / 1000) : 0
      // Estimate open timestamp as 1 day before resolution (we don't have exact data)
      const openTs = resolvedTs > 0 ? resolvedTs - 86400 : 0

      const row = {
        wallet_address: address,
        condition_id: conditionId,
        market_title: title || null,
        market_slug: null,
        primary_outcome: firstOutcome,
        yes_shares: 0,
        no_shares: 0,
        closed: true,
        open_timestamp: openTs > 0 ? timestampToISO(openTs) : null,
        close_timestamp: resolvedTs > 0 ? timestampToISO(resolvedTs) : null,
        number_of_buys: positions.length,
        number_of_sells: positions.length,
        total_volume_bought: Math.round(totalBought * 100) / 100,
        total_volume_sold: Math.round(Math.max(0, totalSold) * 100) / 100,
        roi: totalBought > 0 ? Math.round((totalPnl / totalBought) * 10000) / 100 : 0,
        pnl: Math.round(totalPnl * 100) / 100,
        avg_entry_price: positions.length > 0 ? positions[0].avgPrice : 0,
        avg_exit_price: 0,
        profit_pct: totalBought > 0 ? Math.round((totalPnl / totalBought) * 10000) / 100 : 0,
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase.from('trades').insert(row)
      if (!error) {
        backfillCount++
      } else if (!error.message?.includes('duplicate')) {
        console.error(`  Backfill insert error for ${conditionId}:`, error.message)
      }
    }

    if (backfillCount > 0) {
      console.log(`  Backfilled ${backfillCount} trades from closed positions.`)
    }
  }

  // 8. Recalculate wallet metrics from ALL trades
  const { data: allTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('wallet_address', address)

  const metrics = calculateWalletMetrics(allTrades || [])

  // Find the latest activity timestamp
  const maxTimestamp = newActivities.reduce(
    (max, a) => Math.max(max, a.timestamp),
    sinceTimestamp
  )

  // 9. Update wallet with metrics (including period + drawdown)
  await supabase
    .from('wallets_new')
    .update({
      total_pnl: metrics.totalPnl,
      total_roi: metrics.totalRoi,
      win_rate: metrics.winRate,
      open_trade_count: metrics.openTradeCount,
      closed_trade_count: metrics.closedTradeCount,
      total_volume_bought: metrics.totalVolumeBought,
      total_volume_sold: metrics.totalVolumeSold,
      avg_hold_duration_hours: metrics.avgHoldDurationHours,
      profit_factor: metrics.profitFactor,
      metrics_updated_at: metrics.metricsUpdatedAt,
      drawdown_all: metrics.drawdownAll,
      // 7-day period metrics
      pnl_7d: metrics.metrics7d.pnl,
      roi_7d: metrics.metrics7d.roi,
      win_rate_7d: metrics.metrics7d.winRate,
      volume_7d: metrics.metrics7d.volume,
      trade_count_7d: metrics.metrics7d.tradeCount,
      drawdown_7d: metrics.metrics7d.drawdown,
      // 30-day period metrics
      pnl_30d: metrics.metrics30d.pnl,
      roi_30d: metrics.metrics30d.roi,
      win_rate_30d: metrics.metrics30d.winRate,
      volume_30d: metrics.metrics30d.volume,
      trade_count_30d: metrics.metrics30d.tradeCount,
      drawdown_30d: metrics.metrics30d.drawdown,
      last_synced_at: new Date().toISOString(),
      last_activity_timestamp: maxTimestamp,
      updated_at: new Date().toISOString(),
    })
    .eq('address', address)

  console.log(`  Sync complete: ${tradesCreated} new trades, ${tradesUpdated} updated, ${backfillCount} backfilled.`)
  console.log(`  Metrics: PnL=$${metrics.totalPnl}, ROI=${metrics.totalRoi}%, WR=${metrics.winRate}%, PF=${metrics.profitFactor}, DD=${metrics.drawdownAll}%, Open=${metrics.openTradeCount}, Closed=${metrics.closedTradeCount}`)

  return {
    address,
    newActivities: newActivities.length,
    tradesCreated,
    tradesUpdated,
    backfillCount,
    success: true,
  }
}

// CLI entry point
async function main() {
  const address = process.argv[2]?.toLowerCase()

  if (!address) {
    console.error('Usage: node scripts/sync-wallet.js <address>')
    process.exit(1)
  }

  if (!isValidAddress(address)) {
    console.error(`Invalid Ethereum address: ${address}`)
    process.exit(1)
  }

  console.log(`Syncing wallet ${address}...`)
  const result = await syncWallet(address)

  if (!result.success) {
    console.error(`Sync failed: ${result.error}`)
    process.exit(1)
  }

  console.log('Done.')
}

// Only run main when called directly
const isDirectRun = process.argv[1]?.includes('sync-wallet')
if (isDirectRun) {
  main().catch(err => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
}
