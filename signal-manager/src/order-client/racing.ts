/**
 * Fast POST Racing
 *
 * Handles HMAC signing, payload transformation, and racing parallel requests.
 */

import type { ConnectionManager } from './connection.js';

const CLOB_HOST = 'https://clob.polymarket.com';
const RACE_CONNECTION_COUNT = 3;

// Detect runtime and create appropriate pool
const isBun = typeof (globalThis as any).Bun !== 'undefined';

// Undici pool (Node.js only) - lazy initialized
let pool: any = null;

async function getPool() {
  if (pool) return pool;

  if (isBun) {
    // Bun doesn't support undici - use native fetch wrapper
    console.log('[racing] Bun detected - using native fetch');
    return null;
  }

  try {
    const { Pool } = await import('undici');
    pool = new Pool(CLOB_HOST, {
      connections: 10,
      pipelining: 1,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connect: {
        rejectUnauthorized: true,
      },
    });
    console.log('[racing] undici Pool created');
    return pool;
  } catch (e) {
    console.log('[racing] undici not available, using fetch');
    return null;
  }
}

/**
 * Transform a signed order to API payload format
 */
export function orderToPayload(signedOrder: any, apiKey: string): any {
  return {
    deferExec: false,
    order: {
      salt: parseInt(signedOrder.salt, 10),
      maker: signedOrder.maker,
      signer: signedOrder.signer,
      taker: signedOrder.taker,
      tokenId: signedOrder.tokenId,
      makerAmount: signedOrder.makerAmount,
      takerAmount: signedOrder.takerAmount,
      side: signedOrder.side === 0 ? 'BUY' : 'SELL',
      expiration: signedOrder.expiration,
      nonce: signedOrder.nonce,
      feeRateBps: signedOrder.feeRateBps,
      signatureType: signedOrder.signatureType,
      signature: signedOrder.signature,
    },
    owner: apiKey,
    orderType: 'FAK',  // Fill-And-Kill for immediate execution
    postOnly: false,
  };
}

/**
 * Race multiple parallel fetch requests - first successful response wins
 */
export async function fastPostOrderRacing(
  signedOrder: any,
  connection: ConnectionManager
): Promise<any> {
  const creds = connection.getCredentials();
  const t0 = performance.now();

  const payload = orderToPayload(signedOrder, creds.apiKey);
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp}POST/order${body}`;
  const signature = connection.signHmac(message);

  const t1 = performance.now();

  const headers = {
    'Content-Type': 'application/json',
    'POLY_ADDRESS': creds.walletAddress,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': `${timestamp}`,
    'POLY_API_KEY': creds.apiKey,
    'POLY_PASSPHRASE': creds.apiPassphrase,
  };

  // Fire N parallel requests
  const raceResults: { index: number; time: number; status: 'success' | 'error' | 'duplicate'; result?: any; error?: string }[] = [];
  const undiciPool = await getPool();

  return new Promise((resolve, reject) => {
    let resolved = false;
    let completedCount = 0;

    for (let i = 0; i < RACE_CONNECTION_COUNT; i++) {
      const reqStart = performance.now();

      // Use undici pool if available, otherwise fetch
      const requestPromise = undiciPool
        ? undiciPool.request({ method: 'POST', path: '/order', headers, body })
            .then(async ({ statusCode, body: respBody }: { statusCode: number; body: any }) => {
              const text = await respBody.text();
              return { statusCode, text };
            })
        : fetch(`${CLOB_HOST}/order`, { method: 'POST', headers, body })
            .then(async (resp) => {
              const text = await resp.text();
              return { statusCode: resp.status, text };
            });

      requestPromise
        .then(async ({ statusCode, text }: { statusCode: number; text: string }) => {
          const ttfb = performance.now() - reqStart;
          connection.trackTtfb(ttfb);

          let data: any;
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: text };
          }

          if (statusCode < 200 || statusCode >= 300) {
            const errMsg = data.error || `HTTP ${statusCode}`;

            // Check for duplicate order (means another connection already succeeded)
            if (errMsg.includes('Duplicated') || errMsg.includes('duplicate')) {
              raceResults.push({ index: i, time: ttfb, status: 'duplicate' });
              console.log(`  [race] #${i + 1}: ${ttfb.toFixed(0)}ms (duplicate - other won)`);
            } else {
              raceResults.push({ index: i, time: ttfb, status: 'error', error: errMsg });
              console.log(`  [race] #${i + 1}: ${ttfb.toFixed(0)}ms (error: ${errMsg.slice(0, 30)})`);
            }
            return;
          }

          const result = data as { orderID?: string; errorMsg?: string };
          const totalTime = performance.now() - reqStart;

          // Check if valid success
          if (!resolved && result && result.orderID && !result.errorMsg) {
            resolved = true;
            raceResults.push({ index: i, time: totalTime, status: 'success', result });

            const prepTime = t1 - t0;
            console.log(`⚡ [race] #${i + 1} WON: prep=${prepTime.toFixed(1)}ms, ttfb=${ttfb.toFixed(0)}ms, total=\x1b[36m${totalTime.toFixed(0)}ms\x1b[0m`);

            resolve(result);
          } else if (result?.errorMsg) {
            raceResults.push({ index: i, time: totalTime, status: 'error', error: result.errorMsg });
          }
        })
        .catch((err: unknown) => {
          const time = performance.now() - reqStart;
          const errMsg = err instanceof Error ? err.message : String(err);
          raceResults.push({ index: i, time, status: 'error', error: errMsg });
          console.log(`  [race] #${i + 1}: ${time.toFixed(0)}ms (network error)`);
        })
        .finally(() => {
          completedCount++;

          // If all completed and none succeeded
          if (completedCount === RACE_CONNECTION_COUNT && !resolved) {
            const errors = raceResults.filter(r => r.status === 'error').map(r => r.error).join('; ');
            reject(new Error(`All ${RACE_CONNECTION_COUNT} racing requests failed: ${errors}`));
          }
        });
    }
  });
}

/**
 * Single fast POST (no racing) - useful for testing or when racing is not needed
 */
export async function fastPostOrder(
  signedOrder: any,
  connection: ConnectionManager
): Promise<any> {
  const creds = connection.getCredentials();
  const t0 = performance.now();

  const payload = orderToPayload(signedOrder, creds.apiKey);
  const body = JSON.stringify(payload);

  const t1 = performance.now();

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp}POST/order${body}`;
  const signature = connection.signHmac(message);

  const t2 = performance.now();

  const headers = {
    'Content-Type': 'application/json',
    'POLY_ADDRESS': creds.walletAddress,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': `${timestamp}`,
    'POLY_API_KEY': creds.apiKey,
    'POLY_PASSPHRASE': creds.apiPassphrase,
  };

  const undiciPool = await getPool();

  let statusCode: number;
  let text: string;

  if (undiciPool) {
    const resp = await undiciPool.request({ method: 'POST', path: '/order', headers, body });
    statusCode = resp.statusCode;
    text = await resp.body.text();
  } else {
    const resp = await fetch(`${CLOB_HOST}/order`, { method: 'POST', headers, body });
    statusCode = resp.status;
    text = await resp.text();
  }

  const t3 = performance.now();
  const ttfb = t3 - t2;
  connection.trackTtfb(ttfb);

  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    result = { errorMsg: text };
  }

  if (statusCode < 200 || statusCode >= 300) {
    return { errorMsg: result.error || `HTTP ${statusCode}` };
  }

  const t4 = performance.now();

  console.log(`⚡ fastPost: payload=${(t1-t0).toFixed(1)}ms, hmac=${(t2-t1).toFixed(1)}ms, ttfb=${ttfb.toFixed(0)}ms, body=${(t4-t3).toFixed(0)}ms, total=${(t4-t0).toFixed(0)}ms`);

  return result;
}

/**
 * Warm up the undici pool by making initial requests
 */
export async function warmupPool(): Promise<void> {
  const undiciPool = await getPool();

  if (!undiciPool) {
    console.log('[racing] No undici pool - using fetch (no warmup needed)');
    return;
  }

  const t0 = performance.now();

  // Parallel warmup requests to establish connections
  const warmupPromises = [];
  for (let i = 0; i < RACE_CONNECTION_COUNT; i++) {
    const t1 = performance.now();
    warmupPromises.push(
      undiciPool.request({ method: 'GET', path: '/time' })
        .then(async ({ statusCode, body }: { statusCode: number; body: any }) => {
          await body.text(); // Consume body
          console.log(`[undici] warmup #${i + 1}: ${(performance.now() - t1).toFixed(0)}ms (${statusCode})`);
        })
        .catch(() => {
          console.log(`[undici] warmup #${i + 1}: ${(performance.now() - t1).toFixed(0)}ms (error)`);
        })
    );
  }

  await Promise.all(warmupPromises);
  console.log(`[undici] pool warmed up in ${(performance.now() - t0).toFixed(0)}ms`);
}

/** Get pool stats for debugging */
export function getPoolStats() {
  return pool?.stats ?? null;
}
