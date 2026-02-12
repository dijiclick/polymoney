/**
 * Test Polymarket CLOB connection and trading bot setup.
 *
 * Usage: node scripts/test-connection.mjs
 *
 * Tests:
 * 1. Derive wallet address from private key
 * 2. Connect to CLOB API
 * 3. Derive/create API credentials
 * 4. Fetch a sample order book
 * 5. Check USDC balance (if possible)
 */

import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* no .env */ }
}

loadEnv();

const CLOB_HOST = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

async function main() {
  console.log('=== Polymarket CLOB Connection Test ===\n');

  // Step 1: Check private key
  const privateKey = process.env.POLY_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: No private key found. Set POLY_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const wallet = new Wallet(privateKey);
  console.log(`1. Wallet address: ${wallet.address}`);

  const funderAddress = process.env.POLY_FUNDER_ADDRESS || wallet.address;
  const sigType = parseInt(process.env.POLY_SIGNATURE_TYPE || '0');
  console.log(`   Funder address: ${funderAddress}`);
  console.log(`   Signature type: ${sigType} (${['EOA', 'Magic', 'GnosisSafe'][sigType] || 'unknown'})`);

  // Step 2: Create temp client and derive API key
  console.log('\n2. Connecting to CLOB API...');
  try {
    const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet);
    const creds = await tempClient.createOrDeriveApiKey();
    console.log(`   API Key: ${creds.key?.slice(0, 12)}...`);
    console.log(`   API Secret: ${creds.secret?.slice(0, 8)}...`);
    console.log(`   Passphrase: ${creds.passphrase?.slice(0, 8)}...`);

    // Step 3: Create full client
    const client = new ClobClient(
      CLOB_HOST, CHAIN_ID, wallet, creds, sigType, funderAddress
    );
    console.log('   Full client created OK');

    // Step 4: Test API - get open orders
    console.log('\n3. Fetching open orders...');
    try {
      const orders = await client.getOpenOrders();
      console.log(`   Open orders: ${Array.isArray(orders) ? orders.length : 'error'}`);
    } catch (err) {
      console.log(`   Open orders: failed (${err.message}) — this may be normal if sig type is wrong`);
    }

    // Step 5: Test fetching a sample order book (any active market)
    console.log('\n4. Fetching sample market data...');
    try {
      // Get any active market from Polymarket
      const resp = await fetch('https://gamma-api.polymarket.com/markets?active=true&limit=1&order=volume24hr&ascending=false');
      const markets = await resp.json();
      if (markets.length > 0) {
        const m = markets[0];
        console.log(`   Sample market: "${m.question?.slice(0, 60)}..."`);
        const tokens = JSON.parse(m.clobTokenIds || '[]');
        if (tokens.length > 0) {
          const book = await client.getOrderBook(tokens[0]);
          const bids = book?.bids?.length || 0;
          const asks = book?.asks?.length || 0;
          console.log(`   Order book: ${bids} bids, ${asks} asks`);
          console.log(`   Min order size: ${book?.min_order_size || 'unknown'}`);

          try {
            const mid = await client.getMidpoint(tokens[0]);
            console.log(`   Midpoint price: ${mid}`);
          } catch { /* optional */ }
        }
      }
    } catch (err) {
      console.log(`   Market data: failed (${err.message})`);
    }

    console.log('\n=== CONNECTION TEST PASSED ===');
    console.log('\nTo start the signal manager:');
    console.log('  npm run build && bash scripts/start.sh');
    console.log('\nTo enable goal trading (after starting):');
    console.log('  curl -X POST http://localhost:3847/api/trading/command -d \'{"command":"goaltrader on"}\'');

  } catch (err) {
    console.error(`\nERROR: CLOB connection failed: ${err.message}`);
    console.error('\nPossible issues:');
    console.error('  - Wrong private key');
    console.error('  - Wrong signature type (try POLY_SIGNATURE_TYPE=1 or 2)');
    console.error('  - Network issue');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
