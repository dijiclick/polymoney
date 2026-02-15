/**
 * Close All Positions & Redeem
 *
 * 1. Cancel all open orders
 * 2. Sell all active positions at best bid (FOK)
 * 3. Redeem resolved positions (gasless relay → on-chain proxy → CLOB sell)
 *
 * Usage:
 *   npx tsc && node dist/src/scripts/close-all.js               # sell + redeem redeemable
 *   npx tsc && node dist/src/scripts/close-all.js --force        # force-redeem ALL active
 *   npx tsc && node dist/src/scripts/close-all.js --dry-run      # preview only
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(process.cwd(), '.env') });

const CLOB_HOST = 'https://clob.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';
const CHAIN_ID = 137;
const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';
const CT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const NEGRISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const WRAPPED_COL = '0x3A3BD7bb9528E159577F7C2e685CC81A765002E2';
const CT_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
];
const NEGRISK_ABI = ['function redeemPositions(bytes32 conditionId, uint256[] amounts) external'];
const PROXY_ABI = ['function exec(address to, uint256 value, bytes data) external returns (bool, bytes memory)'];
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

interface Position {
  asset: string;
  title: string;
  size: number;
  currentPrice: number;
  currentValue: number;
  avgPrice: number;
  cashPnl: number;
  percentPnl: number;
  redeemable: boolean;
  endDate: string;
  proxyWallet?: string;
  conditionId?: string;
  negativeRisk?: boolean;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchPositions(address: string): Promise<Position[]> {
  // Fetch both active and redeemable positions
  const [activeResp, redeemResp] = await Promise.all([
    fetch(`${DATA_API}/positions?user=${address}&limit=100&offset=0`),
    fetch(`${DATA_API}/positions?user=${address}&redeemable=true&sizeThreshold=0`),
  ]);

  const activeData = activeResp.ok ? await activeResp.json() : [];
  const redeemData = redeemResp.ok ? await redeemResp.json() : [];

  // Merge, dedup by asset
  const seen = new Set<string>();
  const all: any[] = [];
  for (const p of [...(Array.isArray(activeData) ? activeData : []), ...(Array.isArray(redeemData) ? redeemData : [])]) {
    if (p.asset && !seen.has(p.asset)) {
      seen.add(p.asset);
      all.push(p);
    }
  }

  return all.map((p: any) => ({
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
    negativeRisk: p.negativeRisk === true,
  }));
}

async function sellAtBestBid(client: ClobClient, tokenId: string, shares: number): Promise<{ success: boolean; orderId?: string; sellPrice?: number; proceeds?: number; error?: string }> {
  const tickSize = await client.getTickSize(tokenId).catch(() => '0.01');
  const negRisk = await client.getNegRisk(tokenId).catch(() => false);
  const tick = Number(tickSize) || 0.01;

  const bookRes = await client.getOrderBook(tokenId);
  const bids = (bookRes as any)?.bids || [];

  if (bids.length === 0) {
    return { success: false, error: 'no_bids_in_orderbook' };
  }

  const bestBid = Math.max(...bids.map((b: any) => Number(b.price)));
  if (bestBid <= 0.01) {
    return { success: false, error: `best_bid_too_low_${(bestBid * 100).toFixed(1)}c` };
  }

  const sellShares = Math.floor(shares * 100) / 100;
  if (sellShares < 0.01) {
    return { success: false, error: 'shares_too_small' };
  }

  const response = await client.createAndPostOrder(
    { tokenID: tokenId, price: bestBid, size: sellShares, side: Side.SELL },
    { tickSize: String(tick) as any, negRisk: !!negRisk },
    'FOK' as any
  );

  const orderId = (response as any)?.orderID || (response as any)?.id || null;
  if (orderId) {
    return { success: true, orderId, sellPrice: bestBid, proceeds: sellShares * bestBid };
  }
  return { success: false, error: 'fok_not_filled' };
}

async function redeemByConditionId(
  conditionId: string,
  funderAddress: string,
  connectedWallet: any,
  relayClient: any,
  isNegRisk = false,
): Promise<{ success: boolean; txHash?: string; method?: string; error?: string }> {
  let targetAddress: string;
  let calldata: string;

  if (isNegRisk) {
    // NegRisk: get actual token balances, call NegRiskAdapter.redeemPositions
    const provider = connectedWallet?.provider || new JsonRpcProvider(POLYGON_RPC);
    const ct = new Contract(CT_ADDRESS, CT_ABI, provider);
    const [collYes, collNo] = await Promise.all([
      ct.getCollectionId(ZERO_BYTES32, conditionId, 1),
      ct.getCollectionId(ZERO_BYTES32, conditionId, 2),
    ]);
    const [posIdYes, posIdNo] = await Promise.all([
      ct.getPositionId(WRAPPED_COL, collYes),
      ct.getPositionId(WRAPPED_COL, collNo),
    ]);
    const [balYes, balNo] = await Promise.all([
      ct.balanceOf(funderAddress, posIdYes),
      ct.balanceOf(funderAddress, posIdNo),
    ]);
    if (balYes.toNumber() === 0 && balNo.toNumber() === 0) {
      return { success: false, error: 'no_tokens_to_redeem' };
    }
    const adapter = new Contract(NEGRISK_ADAPTER, NEGRISK_ABI);
    calldata = adapter.interface.encodeFunctionData('redeemPositions', [
      conditionId, [balYes.toNumber(), balNo.toNumber()]
    ]);
    targetAddress = NEGRISK_ADAPTER;
  } else {
    const ct = new Contract(CT_ADDRESS, CT_ABI);
    calldata = ct.interface.encodeFunctionData('redeemPositions', [
      USDC_ADDRESS, ZERO_BYTES32, conditionId, [1, 2]
    ]);
    targetAddress = CT_ADDRESS;
  }

  // Method 1: Gasless relay
  if (relayClient) {
    try {
      const response = await relayClient.execute(
        [{ to: targetAddress, data: calldata, value: '0' }],
        isNegRisk ? 'redeem-negrisk' : 'redeem'
      );
      const result = await response.wait();
      if (result) {
        return { success: true, txHash: result.transactionHash, method: isNegRisk ? 'relay-negrisk' : 'relay' };
      }
    } catch {
      // Fall through
    }
  }

  // Method 2: On-chain proxy
  if (connectedWallet) {
    try {
      const proxy = new Contract(funderAddress, PROXY_ABI, connectedWallet);
      const tx = await proxy.exec(targetAddress, 0, calldata);
      const receipt = await tx.wait();
      return { success: true, txHash: receipt.transactionHash, method: 'onchain' };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 120) };
    }
  }

  return { success: false, error: 'no_redemption_method' };
}

async function main() {
  const privateKey = process.env.POLY_PRIVATE_KEY;
  const funderAddress = process.env.POLY_FUNDER_ADDRESS;
  const sigType = parseInt(process.env.POLY_SIGNATURE_TYPE || '0') as 0 | 1 | 2;
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  if (!privateKey || !funderAddress) {
    console.error('Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    process.exit(1);
  }

  log(`Wallet: ${funderAddress}`);
  log(`Mode: ${dryRun ? 'DRY RUN' : force ? 'FORCE REDEEM ALL' : 'LIVE'}`);

  // --- Initialize CLOB client ---
  log('Initializing CLOB client...');
  const signer = new Wallet(privateKey);
  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer, undefined, sigType, funderAddress);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient(CLOB_HOST, CHAIN_ID, signer, creds, sigType, funderAddress);
  log('CLOB client ready');

  // --- Initialize on-chain wallet ---
  const provider = new JsonRpcProvider(POLYGON_RPC);
  const connectedWallet = signer.connect(provider);

  // --- Initialize builder relay (optional) ---
  let relayClient: any = null;
  const builderKey = process.env.POLY_BUILDER_KEY;
  const builderSecret = process.env.POLY_BUILDER_SECRET;
  const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;

  if (builderKey && builderSecret && builderPassphrase) {
    try {
      const relayPkg = await import('@polymarket/builder-relayer-client');
      const { BuilderConfig } = await import('@polymarket/builder-signing-sdk');
      const builderConfig = new BuilderConfig({ localBuilderCreds: { key: builderKey, secret: builderSecret, passphrase: builderPassphrase } });
      const relayTxType = sigType === 1 ? relayPkg.RelayerTxType.PROXY : relayPkg.RelayerTxType.SAFE;
      relayClient = new relayPkg.RelayClient('https://relayer-v2.polymarket.com', 137, connectedWallet, builderConfig, relayTxType);
      log('Builder relay ready (gasless redemption)');
    } catch (err: any) {
      log(`Builder relay unavailable: ${err.message}`);
    }
  }

  // --- Step 1: Cancel all open orders ---
  log('\n=== STEP 1: Cancel all open orders ===');
  try {
    const openOrders = await client.getOpenOrders();
    if (Array.isArray(openOrders) && openOrders.length > 0) {
      log(`Found ${openOrders.length} open orders — cancelling...`);
      if (!dryRun) await client.cancelAll();
      log(dryRun ? 'Would cancel all orders' : 'All orders cancelled');
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

  // --- Step 3: Sell active positions at best bid ---
  const toSell = force ? [...active, ...redeemable] : active;
  log(`\n=== STEP 3: Sell ${toSell.length} positions at best bid ===`);

  let totalSold = 0;
  let totalFailed = 0;
  let totalProceeds = 0;

  for (const pos of toSell) {
    if (pos.currentPrice <= 0.01) {
      log(`  ⚠️ ${pos.title} — worthless (${pos.currentPrice}), skipping sell`);
      continue;
    }

    log(`\nSelling: ${pos.title} (${pos.size.toFixed(4)} shares @ ~${pos.currentPrice})...`);

    if (dryRun) {
      const est = pos.size * pos.currentPrice;
      log(`  [DRY RUN] Would sell — estimated $${est.toFixed(2)}`);
      totalProceeds += est;
      totalSold++;
      continue;
    }

    try {
      const result = await sellAtBestBid(client, pos.asset, pos.size);
      if (result.success) {
        log(`  ✅ SOLD at ${((result.sellPrice || 0) * 100).toFixed(0)}¢ — $${(result.proceeds || 0).toFixed(2)} — Order: ${result.orderId}`);
        totalSold++;
        totalProceeds += result.proceeds || 0;
      } else {
        log(`  ⚠️ Sell failed: ${result.error}`);
        totalFailed++;
      }
    } catch (err: any) {
      log(`  ❌ FAILED: ${err.message}`);
      totalFailed++;

      if (err.message?.includes('closed') || err.message?.includes('resolved') || err.message?.includes('not active')) {
        log(`  → Market may be resolved — trying on-chain redeem`);
      }
    }
  }

  // --- Step 4: Redeem resolved positions on-chain ---
  if (redeemable.length > 0 && !dryRun) {
    log(`\n=== STEP 4: Redeem ${redeemable.length} resolved positions ===`);

    const seen = new Set<string>();
    for (const pos of redeemable) {
      const conditionId = pos.conditionId;
      if (!conditionId || seen.has(conditionId)) continue;
      seen.add(conditionId);

      log(`\nRedeeming: ${pos.title} (conditionId: ${conditionId?.slice(0, 10)}...)...`);

      try {
        const result = await redeemByConditionId(conditionId, funderAddress, connectedWallet, relayClient, pos.negativeRisk === true);
        if (result.success) {
          log(`  ✅ REDEEMED (${result.method}) | tx: ${result.txHash}`);
        } else {
          log(`  ❌ Redeem failed: ${result.error}`);
        }
      } catch (err: any) {
        log(`  ❌ Redeem error: ${err.message}`);
      }
    }
  } else if (redeemable.length > 0 && dryRun) {
    log(`\n=== STEP 4: Would redeem ${redeemable.length} resolved positions ===`);
    for (const pos of redeemable) {
      log(`  🔄 ${pos.title} — ${pos.size.toFixed(4)} shares — PnL: $${pos.cashPnl.toFixed(4)}`);
    }
  }

  // --- Summary ---
  log('\n=== SUMMARY ===');
  log(`Positions found: ${positions.length}`);
  log(`Sold: ${totalSold} | Failed: ${totalFailed} | Proceeds: $${totalProceeds.toFixed(2)}`);
  log(`Redeemable: ${redeemable.length}`);

  if (!dryRun) {
    log('\nChecking remaining positions...');
    const remaining = await fetchPositions(funderAddress);
    const activeRemaining = remaining.filter(p => p.size > 0 && !p.redeemable);
    if (activeRemaining.length === 0) {
      log('✅ All active positions closed!');
    } else {
      log(`⚠️  ${activeRemaining.length} positions still open`);
      for (const p of activeRemaining) {
        log(`  - ${p.title}: ${p.size.toFixed(4)} shares`);
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
