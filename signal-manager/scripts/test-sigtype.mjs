/**
 * Test all signature types to find which one works for posting orders.
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
      process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  } catch { /* */ }
}

loadEnv();

async function findActiveToken(client) {
  const resp = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&order=volume24hr&ascending=false');
  const markets = await resp.json();
  for (const m of markets) {
    const tokens = JSON.parse(m.clobTokenIds || '[]');
    for (const t of tokens) {
      try {
        const book = await client.getOrderBook(t);
        if (book && book.asks && book.asks.length > 0) {
          return { token: t, market: m.question?.slice(0, 50), bestAsk: parseFloat(book.asks[0].price) };
        }
      } catch { /* */ }
    }
  }
  return null;
}

async function testSignatureType(sigType, pk, funder) {
  const w = new Wallet(pk);
  const tempClient = new ClobClient('https://clob.polymarket.com', 137, w);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient('https://clob.polymarket.com', 137, w, creds, sigType, funder);

  const active = await findActiveToken(client);
  if (!active) {
    console.log(`  sigType=${sigType}: No active market found`);
    return false;
  }

  console.log(`  sigType=${sigType}: Testing on "${active.market}" @ ask ${active.bestAsk}...`);

  try {
    // Buy $1 worth at current ask price (should fill immediately)
    const signed = await client.createMarketOrder({
      tokenID: active.token,
      amount: 1.0,
      side: Side.BUY,
      orderType: OrderType.FOK,
      funderAddress: funder,
    });
    const resp = await client.postOrder(signed, OrderType.FOK);
    const success = resp && !resp.error;
    console.log(`  sigType=${sigType}: ${success ? 'SUCCESS' : 'FAILED'} — ${JSON.stringify(resp)}`);
    return success;
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    console.log(`  sigType=${sigType}: ERROR — ${errMsg}`);
    return false;
  }
}

async function main() {
  const pk = process.env.POLY_PRIVATE_KEY;
  const funder = process.env.POLY_FUNDER_ADDRESS;
  const w = new Wallet(pk);

  console.log('Signer EOA:', w.address);
  console.log('Funder/Proxy:', funder);
  console.log('');

  // Test each signature type
  for (const sigType of [0, 1, 2]) {
    const label = ['EOA', 'Magic/Poly Proxy', 'Gnosis Safe'][sigType];
    console.log(`\nTesting signatureType=${sigType} (${label}):`);
    const ok = await testSignatureType(sigType, pk, funder);
    if (ok) {
      console.log(`\n*** signatureType=${sigType} WORKS! ***`);
      console.log(`Update .env: POLY_SIGNATURE_TYPE=${sigType}`);
      break;
    }
  }
}

main().catch(console.error);
