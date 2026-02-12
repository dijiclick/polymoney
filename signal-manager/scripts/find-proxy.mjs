/**
 * Find Polymarket proxy wallet for the signer address.
 * Checks the Polymarket proxy factory contract on Polygon.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from '@ethersproject/wallet';

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

const RPC = 'https://polygon-rpc.com';

async function rpcCall(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  return j.result;
}

async function main() {
  const pk = process.env.POLY_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) { console.error('No private key'); process.exit(1); }

  const wallet = new Wallet(pk);
  const signer = wallet.address.toLowerCase();
  console.log('Signer (EOA):', wallet.address);

  // Check EOA nonce
  const nonce = parseInt(await rpcCall('eth_getTransactionCount', [wallet.address, 'latest']), 16);
  console.log('EOA nonce:', nonce);

  // Check USDC balance of EOA
  const USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
  const balData = '0x70a08231000000000000000000000000' + signer.slice(2);
  const balResult = await rpcCall('eth_call', [{ to: USDC, data: balData }, 'latest']);
  const eoaBal = parseInt(balResult || '0x0', 16) / 1e6;
  console.log('EOA USDC.e balance:', eoaBal.toFixed(2));

  // Try Polymarket proxy factory
  // Known factory: 0xaB45c5A4B0c941a2F231C04C3f49182e1A254052
  const factories = [
    '0xaB45c5A4B0c941a2F231C04C3f49182e1A254052',
    '0x539E1a6E4AAA2a7fFC2DC237B06f4E3De0e0D6D8',
    '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  ];

  // Function selector for getProxy(address) = 0x0b36e3bf
  const getProxySelector = '0x0b36e3bf';
  const paddedAddr = '000000000000000000000000' + signer.slice(2);

  let foundProxy = null;

  for (const factory of factories) {
    try {
      const callData = getProxySelector + paddedAddr;
      const result = await rpcCall('eth_call', [{ to: factory, data: callData }, 'latest']);
      if (result && result.length === 66) {
        const proxyAddr = '0x' + result.slice(26);
        if (proxyAddr !== '0x0000000000000000000000000000000000000000') {
          console.log(`\nProxy found via factory ${factory}:`);
          console.log('  Proxy address:', proxyAddr);
          foundProxy = proxyAddr;

          // Check USDC balance
          const proxyBalData = '0x70a08231000000000000000000000000' + proxyAddr.slice(2).toLowerCase();
          const proxyBalResult = await rpcCall('eth_call', [{ to: USDC, data: proxyBalData }, 'latest']);
          const proxyBal = parseInt(proxyBalResult || '0x0', 16) / 1e6;
          console.log('  Proxy USDC.e balance:', proxyBal.toFixed(2));

          // Check positions
          const r = await fetch('https://data-api.polymarket.com/positions?user=' + proxyAddr);
          if (r.ok) {
            const pos = await r.json();
            console.log('  Polymarket positions:', pos.length);
          }
          break;
        }
      }
    } catch (err) {
      console.log(`Factory ${factory}: error - ${err.message}`);
    }
  }

  if (!foundProxy) {
    console.log('\nNo proxy wallet found via known factories.');
    console.log('\nTo use this wallet for trading, you need to:');
    console.log(`1. Send USDC.e to ${wallet.address} on Polygon`);
    console.log('2. Send some POL for gas fees (~0.1 POL)');
    console.log('3. Approve USDC for Polymarket CTF Exchange contract');
    console.log('\nOR if you have a Polymarket web account:');
    console.log('1. Go to polymarket.com → Settings → Export wallet');
    console.log('2. Note your deposit address (proxy wallet)');
    console.log('3. Update .env: POLY_FUNDER_ADDRESS=<proxy_address> and POLY_SIGNATURE_TYPE=2');
  } else {
    console.log('\n--- Recommended .env ---');
    console.log(`POLY_PRIVATE_KEY=${pk}`);
    console.log(`POLY_FUNDER_ADDRESS=${foundProxy}`);
    console.log('POLY_SIGNATURE_TYPE=2');
  }
}

main().catch(console.error);
