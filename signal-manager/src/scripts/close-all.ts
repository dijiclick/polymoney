/**
 * Close All Positions & Redeem
 *
 * 1. Cancel all open orders
 * 2. Sell all active positions at market (FOK)
 * 3. Report any redeemable positions
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from signal-manager root (cwd)
dotenv.config({ path: resolve(process.cwd(), '.env') });

const CLOB_HOST = 'https://clob.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';
const CHAIN_ID = 137;

interface Position {
  asset: string;       // tokenId
  title: string;
  size: number;        // shares
  currentPrice: number;
  currentValue: number;
  avgPrice: number;
  cashPnl: number;
  percentPnl: number;
  redeemable: boolean;
  endDate: string;
  proxyWallet?: string;
  conditionId?: string;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchPositions(address: string): Promise<Position[]> {
  const url = `${DATA_API}/positions?user=${address}&limit=100&offset=0`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Data API error: ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data)) return [];

  return data.map((p: any) => ({
    asset: p.asset,
    title: p.title || p.market?.question || 'Unknown',
    size: parseFloat(p.size || '0'),
    currentPrice: parseFloat(p.curPrice || p.currentPrice || '0'),
    currentValue: parseFloat(p.currentValue || '0'),
    avgPrice: parseFloat(p.avgPrice || '0'),
    cashPnl: parseFloat(p.cashPnl || '0'),
    percentPnl: parseFloat(p.percentPnl || '0'),
    redeemable: p.redeemable === true || p.redeemable === 'true',
    endDate: p.endDate || '',
    proxyWallet: p.proxyWallet,
    conditionId: p.conditionId,
  }));
}

async function main() {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  const funderAddress = process.env.POLY_FUNDER_ADDRESS;
  const sigType = parseInt(process.env.POLY_SIGNATURE_TYPE || '0') as 0 | 1 | 2;

  if (!privateKey || !funderAddress) {
    console.error('Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    process.exit(1);
  }

  log(`Wallet: ${funderAddress}`);
  log(`Signature type: ${sigType}`);

  // --- Initialize CLOB client ---
  log('Initializing CLOB client...');
  const signer = new Wallet(privateKey);

  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, sigType, funderAddress);
  const creds = await tempClient.createOrDeriveApiKey();

  const client = new ClobClient(CLOB_HOST, CHAIN_ID, signer, creds, sigType, funderAddress);
  log('CLOB client ready');

  // --- Step 1: Cancel all open orders ---
  log('\n=== STEP 1: Cancel all open orders ===');
  try {
    const openOrders = await client.getOpenOrders();
    if (Array.isArray(openOrders) && openOrders.length > 0) {
      log(`Found ${openOrders.length} open orders — cancelling...`);
      await client.cancelAll();
      log('All orders cancelled');
    } else {
      log('No open orders found');
    }
  } catch (err: any) {
    log(`Cancel orders error: ${err.message}`);
  }

  // --- Step 2: Fetch positions ---
  log('\n=== STEP 2: Fetch positions ===');
  const positions = await fetchPositions(funderAddress);

  if (positions.length === 0) {
    log('No positions found. Done!');
    return;
  }

  log(`Found ${positions.length} positions:\n`);

  const active: Position[] = [];
  const redeemable: Position[] = [];

  for (const pos of positions) {
    const status = pos.redeemable ? 'REDEEMABLE' : 'ACTIVE';
    const pnlSign = pos.cashPnl >= 0 ? '+' : '';
    log(`  [${status}] ${pos.title}`);
    log(`    Size: ${pos.size.toFixed(4)} shares | Price: ${pos.currentPrice} | Value: $${pos.currentValue.toFixed(4)}`);
    log(`    PnL: ${pnlSign}$${pos.cashPnl.toFixed(4)} (${pnlSign}${pos.percentPnl.toFixed(2)}%) | Ends: ${pos.endDate}`);

    if (pos.redeemable) {
      redeemable.push(pos);
    } else if (pos.size > 0) {
      active.push(pos);
    }
  }

  // --- Step 3: Sell active positions ---
  log(`\n=== STEP 3: Sell ${active.length} active positions ===`);

  let totalSold = 0;
  let totalFailed = 0;

  for (const pos of active) {
    log(`\nSelling: ${pos.title} (${pos.size.toFixed(4)} shares @ ~${pos.currentPrice})...`);

    try {
      // Get tick size and negRisk for this market
      let tickSize = '0.01';
      let negRisk = false;
      try {
        const ts = await client.getTickSize(pos.asset);
        if (ts) tickSize = String(ts);
      } catch { /* default 0.01 */ }
      try {
        const nr = await client.getNegRisk(pos.asset);
        negRisk = !!nr;
      } catch { /* default false */ }

      // Create market sell order (FOK)
      const signedOrder = await client.createMarketOrder(
        {
          tokenID: pos.asset,
          amount: pos.size,  // For SELL: amount = shares
          side: Side.SELL,
          feeRateBps: 0,
        },
        { tickSize: tickSize as any, negRisk }
      );

      const result = await client.postOrder(signedOrder, OrderType.FOK);

      if (result?.success || result?.orderID) {
        log(`  ✅ SOLD — Order ID: ${result.orderID || 'ok'}`);
        totalSold++;
      } else {
        log(`  ⚠️  Order submitted but unclear result: ${JSON.stringify(result)}`);
        totalSold++;
      }
    } catch (err: any) {
      log(`  ❌ FAILED: ${err.message}`);
      totalFailed++;

      // If market is closed/resolved, note it
      if (err.message?.includes('closed') || err.message?.includes('resolved') || err.message?.includes('not active')) {
        log(`  → Market may be resolved. Check Polymarket UI to redeem.`);
      }
    }
  }

  // --- Step 4: Report redeemable ---
  if (redeemable.length > 0) {
    log(`\n=== STEP 4: Redeemable positions (${redeemable.length}) ===`);
    log('Note: Redemption requires smart contract interaction.');
    log('Visit https://polymarket.com/portfolio to redeem in the UI.\n');
    for (const pos of redeemable) {
      log(`  🔄 ${pos.title} — ${pos.size.toFixed(4)} shares — PnL: $${pos.cashPnl.toFixed(4)}`);
    }
  }

  // --- Summary ---
  log('\n=== SUMMARY ===');
  log(`Positions found: ${positions.length}`);
  log(`Sold successfully: ${totalSold}`);
  log(`Failed to sell: ${totalFailed}`);
  log(`Redeemable (visit UI): ${redeemable.length}`);

  // Check remaining
  log('\nChecking remaining positions...');
  const remaining = await fetchPositions(funderAddress);
  const activeRemaining = remaining.filter(p => p.size > 0 && !p.redeemable);
  if (activeRemaining.length === 0) {
    log('✅ All active positions closed!');
  } else {
    log(`⚠️  ${activeRemaining.length} positions still open (may need manual closing)`);
    for (const p of activeRemaining) {
      log(`  - ${p.title}: ${p.size.toFixed(4)} shares`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
