/**
 * Sell the test position from the Judy Shelton market.
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

async function main() {
  const pk = process.env.POLY_PRIVATE_KEY;
  const funder = process.env.POLY_FUNDER_ADDRESS;
  const sigType = parseInt(process.env.POLY_SIGNATURE_TYPE || '1');
  const w = new Wallet(pk);

  const tempClient = new ClobClient('https://clob.polymarket.com', 137, w);
  const creds = await tempClient.createOrDeriveApiKey();
  const client = new ClobClient('https://clob.polymarket.com', 137, w, creds, sigType, funder);

  // Token from the successful test trade
  const tokenId = '5031084282167950494806674428243037744881029417420880897305642929037077494331';
  const shares = 24.390242;

  console.log('Selling', shares, 'shares of Judy Shelton market...');

  // Get current orderbook to find best bid
  try {
    const book = await client.getOrderBook(tokenId);
    const bestBid = book?.bids?.[0]?.price;
    console.log('Best bid:', bestBid, '| Bids:', book?.bids?.length, '| Asks:', book?.asks?.length);
  } catch (err) {
    console.log('Orderbook fetch failed:', err.message);
  }

  // Sell via FOK at market
  try {
    const signed = await client.createMarketOrder({
      tokenID: tokenId,
      amount: shares,
      side: Side.SELL,
      orderType: OrderType.FOK,
      funderAddress: funder,
    });
    console.log('Order signed, posting...');
    const resp = await client.postOrder(signed, OrderType.FOK);
    console.log('Response:', JSON.stringify(resp));
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.log('Sell error:', JSON.stringify(errData));

    // Try selling fewer shares in case of rounding
    console.log('\nRetrying with 24 shares...');
    try {
      const signed = await client.createMarketOrder({
        tokenID: tokenId,
        amount: 24,
        side: Side.SELL,
        orderType: OrderType.FOK,
        funderAddress: funder,
      });
      const resp = await client.postOrder(signed, OrderType.FOK);
      console.log('Response:', JSON.stringify(resp));
    } catch (err2) {
      console.log('Retry error:', err2.response?.data || err2.message);
    }
  }
}

main().catch(console.error);
