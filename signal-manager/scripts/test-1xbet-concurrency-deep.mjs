#!/usr/bin/env node
/**
 * Deep concurrency test for 1xBet — zoom in on the 8-24 range
 * and test sustained fast sequential with longer duration.
 */

const BASE_URL = 'https://1xlite-81284.pro';

const HEADERS = {
  'Accept': '*/*',
  'DNT': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': `${BASE_URL}/en/live/football/`,
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(ms) { return `${ms.toFixed(0)}ms`; }

async function fetchDiscovery() {
  const url = `${BASE_URL}/service-api/LiveFeed/Get1x2_Zip?sports=1&count=500&lng=en&getEmpty=true&partner=7&country=190`;
  const start = performance.now();
  const resp = await fetch(url, { headers: HEADERS });
  const elapsed = performance.now() - start;
  const body = resp.ok ? await resp.json() : null;
  return { status: resp.status, elapsed, body, ok: resp.ok };
}

async function fetchGameDetail(gameId) {
  const url = `${BASE_URL}/service-api/LiveFeed/GetGameZip?id=${gameId}&lng=en&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=7&country=190&marketType=1`;
  const start = performance.now();
  const resp = await fetch(url, { headers: HEADERS });
  const elapsed = performance.now() - start;
  return { status: resp.status, elapsed, ok: resp.ok };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  1xBet Deep Concurrency & Sustained Speed Test');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Get game IDs
  const disc = await fetchDiscovery();
  if (!disc.ok) { console.error('Discovery failed'); process.exit(1); }
  const items = disc.body?.Value || disc.body || [];
  const gameIds = (Array.isArray(items) ? items : []).filter(g => g.I).map(g => g.I).slice(0, 30);
  console.log(`  Got ${gameIds.length} games\n`);

  // ── Test 1: Fine-grained concurrency (8, 10, 12, 14, 16, 20) ──
  console.log('══ Test 1: Concurrency granularity ══');
  console.log('  10 rounds each, 200ms gap between rounds\n');

  const concurrencies = [8, 10, 12, 14, 16, 20];
  for (const conc of concurrencies) {
    const rounds = 10;
    const results = [];

    process.stdout.write(`  [${String(conc).padStart(2)} concurrent] `);
    for (let round = 0; round < rounds; round++) {
      const gids = gameIds.slice(0, conc);
      const batch = await Promise.allSettled(
        gids.map(id => fetchGameDetail(id))
      );
      for (const r of batch) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
          process.stdout.write(r.value.ok ? '.' : `[${r.value.status}]`);
        } else {
          results.push({ status: 0, elapsed: 0, ok: false });
          process.stdout.write('X');
        }
      }
      if (round < rounds - 1) await sleep(200);
    }

    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
    const times = results.filter(r => r.ok).map(r => r.elapsed);
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)] || 0;

    const tag = fail === 0 ? '✅' : fail <= 2 ? '⚠️' : '❌';
    console.log(`\n    ${tag} ${ok}/${results.length} ok | ${fail} fail | avg=${fmt(avgMs)} p95=${fmt(p95)}`);

    await sleep(3000);
  }

  // ── Test 2: Sustained 250ms sequential for 60 seconds ──
  console.log('\n══ Test 2: Sustained 250ms polling for 60s ══\n');
  {
    const interval = 250;
    const duration = 60000;
    const count = Math.floor(duration / interval);
    const results = [];
    const testId = gameIds[0];
    const startTime = Date.now();

    process.stdout.write(`  [250ms × ${count} reqs] `);
    for (let i = 0; i < count; i++) {
      try {
        const r = await fetchGameDetail(testId);
        results.push(r);
        if (i % 10 === 0) process.stdout.write(r.ok ? '.' : `[${r.status}]`);
      } catch {
        results.push({ status: 0, elapsed: 0, ok: false });
        process.stdout.write('X');
      }
      if (i < count - 1) await sleep(interval);
    }

    const elapsed = Date.now() - startTime;
    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
    const times = results.filter(r => r.ok).map(r => r.elapsed);
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    console.log(`\n    ${fail === 0 ? '✅' : '❌'} ${ok}/${results.length} ok in ${(elapsed/1000).toFixed(1)}s | avg=${fmt(avgMs)}`);
  }

  await sleep(3000);

  // ── Test 3: Sustained 100ms sequential for 30 seconds ──
  console.log('\n══ Test 3: Sustained 100ms polling for 30s ══\n');
  {
    const interval = 100;
    const duration = 30000;
    const count = Math.floor(duration / interval);
    const results = [];
    const testId = gameIds[0];

    process.stdout.write(`  [100ms × ${count} reqs] `);
    for (let i = 0; i < count; i++) {
      try {
        const r = await fetchGameDetail(testId);
        results.push(r);
        if (i % 20 === 0) process.stdout.write(r.ok ? '.' : `[${r.status}]`);
      } catch {
        results.push({ status: 0, elapsed: 0, ok: false });
        process.stdout.write('X');
      }
      if (i < count - 1) await sleep(interval);
    }

    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
    const times = results.filter(r => r.ok).map(r => r.elapsed);
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    console.log(`\n    ${fail === 0 ? '✅' : '❌'} ${ok}/${results.length} ok | avg=${fmt(avgMs)}`);
  }

  await sleep(3000);

  // ── Test 4: Realistic worst case — 8 concurrent + 500ms cycle for 30s ──
  console.log('\n══ Test 4: Realistic batch polling — 8 games every 500ms for 30s ══\n');
  {
    const batchSize = 8;
    const interval = 500;
    const duration = 30000;
    const rounds = Math.floor(duration / interval);
    const gids = gameIds.slice(0, batchSize);
    const results = [];

    process.stdout.write(`  [8 concurrent × ${rounds} rounds] `);
    for (let i = 0; i < rounds; i++) {
      const batch = await Promise.allSettled(
        gids.map(id => fetchGameDetail(id))
      );
      for (const r of batch) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push({ status: 0, elapsed: 0, ok: false });
        }
      }
      const batchOk = batch.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      process.stdout.write(batchOk === batchSize ? '.' : `[${batchOk}/${batchSize}]`);
      if (i < rounds - 1) await sleep(interval);
    }

    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
    const times = results.filter(r => r.ok).map(r => r.elapsed);
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    console.log(`\n    ${fail === 0 ? '✅' : '❌'} ${ok}/${results.length} ok | avg=${fmt(avgMs)} | effective rate: ${(results.length / 30).toFixed(1)} req/s`);
  }

  await sleep(3000);

  // ── Test 5: Realistic worst case — 8 concurrent + 1000ms cycle for 30s (current config) ──
  console.log('\n══ Test 5: Current config equivalent — 8 games every 1000ms for 30s ══\n');
  {
    const batchSize = 8;
    const interval = 1000;
    const duration = 30000;
    const rounds = Math.floor(duration / interval);
    const gids = gameIds.slice(0, batchSize);
    const results = [];

    process.stdout.write(`  [8 concurrent × ${rounds} rounds] `);
    for (let i = 0; i < rounds; i++) {
      const batch = await Promise.allSettled(
        gids.map(id => fetchGameDetail(id))
      );
      for (const r of batch) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push({ status: 0, elapsed: 0, ok: false });
        }
      }
      const batchOk = batch.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      process.stdout.write(batchOk === batchSize ? '.' : `[${batchOk}/${batchSize}]`);
      if (i < rounds - 1) await sleep(interval);
    }

    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
    const times = results.filter(r => r.ok).map(r => r.elapsed);
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    console.log(`\n    ${fail === 0 ? '✅' : '❌'} ${ok}/${results.length} ok | avg=${fmt(avgMs)} | effective rate: ${(results.length / 30).toFixed(1)} req/s`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => { console.error(err); process.exit(1); });