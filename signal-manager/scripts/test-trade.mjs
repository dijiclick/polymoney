/**
 * Full integration test — connects to Polymarket CLOB with proxy wallet
 * and attempts a small FOK order to verify everything works.
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  } catch { /* */ }
}

loadEnv();

async function main() {
  const pk = process.env.POLY_PRIVATE_KEY;
  const funder = process.env.POLY_FUNDER_ADDRESS;
  const sigType = parseInt(process.env.POLY_SIGNATURE_TYPE || '2');

  if (!pk || !funder) {
    console.error('Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    process.exit(1);
  }

  const w = new Wallet(pk);

  console.log('=== Full Integration Test ===');
  console.log('Signer:', w.address);
  console.log('Funder (proxy):', funder);
  console.log('Signature type:', sigType);

  // Initialize exactly like bot.ts does
  const tempClient = new ClobClient('https://clob.polymarket.com', 137, w);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient('https://clob.polymarket.com', 137, w, creds, sigType, funder);

  console.log('\n1. Client initialized OK');
  console.log('   API key:', creds.key.slice(0, 12) + '...');

  // Test open orders
  const orders = await client.getOpenOrders();
  console.log('2. Open orders:', orders.length);

  // Find an active market with orderbook
  console.log('\n3. Looking for an active market...');

  let testToken = null;
  let testPrice = null;
  let testMarketName = null;
  let minOrderSize = null;

  // Try sports first, then any high-volume market
  const queries = [
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&tag=Soccer',
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&tag=Sports',
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&order=volume24hr&ascending=false',
  ];

  for (const url of queries) {
    if (testToken) break;
    try {
      const resp = await fetch(url);
      const markets = await resp.json();

      for (const m of markets) {
        const tokens = JSON.parse(m.clobTokenIds || '[]');
        if (tokens.length === 0) continue;
        try {
          const book = await client.getOrderBook(tokens[0]);
          if (book && book.bids && book.bids.length > 2) {
            testToken = tokens[0];
            testPrice = parseFloat(book.bids[0].price);
            testMarketName = m.question ? m.question.slice(0, 60) : 'Unknown';
            minOrderSize = book.min_order_size;
            console.log('   Found:', testMarketName);
            console.log('   Token:', testToken.slice(0, 30) + '...');
            console.log('   Best bid:', testPrice, '| Best ask:', book.asks[0]?.price);
            console.log('   Min order size:', minOrderSize);
            break;
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  if (!testToken) {
    console.log('   No active market found with orderbook. Skipping trade test.');
    console.log('\n=== PARTIAL TEST — connection verified ===');
    return;
  }

  // Test creating and posting a FOK buy order for $1
  console.log('\n4. Testing $1 FOK BUY order...');
  try {
    const signed = await client.createMarketOrder({
      tokenID: testToken,
      amount: 1.0,
      side: Side.BUY,
      orderType: OrderType.FOK,
      funderAddress: funder,
    });
    console.log('   Order signed successfully');
    console.log('   Posting to CLOB...');
    const resp = await client.postOrder(signed, OrderType.FOK);
    console.log('   Response:', JSON.stringify(resp));

    if (resp && (resp.success || resp.orderID)) {
      console.log('\n   *** TRADE EXECUTED! Order ID:', resp.orderID, '***');
    } else {
      console.log('\n   Order posted but may not have filled (FOK = fill-or-kill)');
    }
  } catch (err) {
    const errData = err.response?.data || err.message || err;
    console.log('   Order error:', JSON.stringify(errData));

    // If minimum order size issue, try $5
    if (String(errData).includes('min') || String(errData).includes('size')) {
      console.log('\n   Retrying with $5...');
      try {
        const signed = await client.createMarketOrder({
          tokenID: testToken,
          amount: 5.0,
          side: Side.BUY,
          orderType: OrderType.FOK,
          funderAddress: funder,
        });
        const resp = await client.postOrder(signed, OrderType.FOK);
        console.log('   $5 Response:', JSON.stringify(resp));
      } catch (err2) {
        console.log('   $5 also failed:', err2.response?.data || err2.message);
      }
    }
  }

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
