#!/usr/bin/env node
/**
 * 1xBet Rate Limit Tester
 * Tests progressively faster polling to find the throttle threshold.
 *
 * Tests two endpoint types:
 *   1. Discovery (Get1x2_Zip) — lists all games for a sport
 *   2. Game Detail (GetGameZip) — fetches a single game's odds
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

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fmt(ms) {
  return `${ms.toFixed(0)}ms`;
}

function pct(n, total) {
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ── API Calls ────────────────────────────────────────────────────────

async function fetchDiscovery() {
  const url = `${BASE_URL}/service-api/LiveFeed/Get1x2_Zip?sports=1&count=500&lng=en&getEmpty=true&partner=7&country=190`;
  const start = performance.now();
  const resp = await fetch(url, { headers: HEADERS });
  const elapsed = performance.now() - start;
  const body = resp.ok ? await resp.json() : await resp.text().catch(() => '');
  return { status: resp.status, elapsed, body, ok: resp.ok };
}

async function fetchGameDetail(gameId) {
  const url = `${BASE_URL}/service-api/LiveFeed/GetGameZip?id=${gameId}&lng=en&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=7&country=190&marketType=1`;
  const start = performance.now();
  const resp = await fetch(url, { headers: HEADERS });
  const elapsed = performance.now() - start;
  return { status: resp.status, elapsed, ok: resp.ok };
}

// ── Burst Tester ─────────────────────────────────────────────────────

/**
 * Send `count` requests at a given interval, track results.
 */
async function burstTest(label, fetchFn, intervalMs, count) {
  const results = [];

  for (let i = 0; i < count; i++) {
    try {
      const r = await fetchFn();
      results.push(r);
      process.stdout.write(r.ok ? '.' : `[${r.status}]`);
    } catch (err) {
      results.push({ status: 0, elapsed: 0, ok: false, error: err.message });
      process.stdout.write('[ERR]');
    }
    if (i < count - 1) await sleep(intervalMs);
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  const times = results.filter(r => r.ok).map(r => r.elapsed);
  const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const maxMs = times.length ? Math.max(...times) : 0;
  const minMs = times.length ? Math.min(...times) : 0;
  const statuses = {};
  for (const r of results) {
    const k = r.error ? `ERR:${r.error.substring(0, 30)}` : String(r.status);
    statuses[k] = (statuses[k] || 0) + 1;
  }

  console.log('');
  console.log(`  ${label} @ ${intervalMs}ms interval, ${count} requests:`);
  console.log(`    OK: ${ok}/${count} (${pct(ok, count)})  |  Failed: ${fail}`);
  console.log(`    Latency: avg=${fmt(avgMs)} min=${fmt(minMs)} max=${fmt(maxMs)}`);
  console.log(`    Status breakdown: ${JSON.stringify(statuses)}`);

  return { ok, fail, avgMs, maxMs, statuses, throttled: fail > 0 };
}

// ── Parallel Burst Tester ────────────────────────────────────────────

async function parallelBurstTest(label, fetchFn, concurrency, rounds) {
  const results = [];

  for (let round = 0; round < rounds; round++) {
    const batch = await Promise.allSettled(
      Array.from({ length: concurrency }, () => fetchFn())
    );
    for (const r of batch) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
        process.stdout.write(r.value.ok ? '.' : `[${r.value.status}]`);
      } else {
        results.push({ status: 0, elapsed: 0, ok: false, error: r.reason?.message });
        process.stdout.write('[ERR]');
      }
    }
    if (round < rounds - 1) await sleep(200); // Small gap between rounds
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  const times = results.filter(r => r.ok).map(r => r.elapsed);
  const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const statuses = {};
  for (const r of results) {
    const k = r.error ? `ERR:${r.error.substring(0, 30)}` : String(r.status);
    statuses[k] = (statuses[k] || 0) + 1;
  }

  console.log('');
  console.log(`  ${label} — ${concurrency} concurrent × ${rounds} rounds:`);
  console.log(`    OK: ${ok}/${results.length} (${pct(ok, results.length)})  |  Failed: ${fail}`);
  console.log(`    Avg latency: ${fmt(avgMs)}`);
  console.log(`    Statuses: ${JSON.stringify(statuses)}`);

  return { ok, fail, throttled: fail > 0 };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  1xBet Rate Limit Test');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Get some game IDs via discovery
  console.log('── Phase 0: Discovery (get game IDs) ──');
  const disc = await fetchDiscovery();
  if (!disc.ok) {
    console.error(`Discovery failed with status ${disc.status}. Cannot proceed.`);
    if (typeof disc.body === 'string') console.error(disc.body.substring(0, 500));
    process.exit(1);
  }

  const items = disc.body?.Value || disc.body || [];
  const gameIds = (Array.isArray(items) ? items : [])
    .filter(g => g.I)
    .map(g => g.I)
    .slice(0, 20); // Use up to 20 games

  console.log(`  Found ${gameIds.length} live games. Using IDs: ${gameIds.slice(0, 5).join(', ')}...`);
  console.log(`  Discovery latency: ${fmt(disc.elapsed)}\n`);

  if (gameIds.length === 0) {
    console.log('No live games found. Testing with discovery endpoint only.\n');
  }

  // Pick one game for single-game polling tests
  const testGameId = gameIds[0];
  const fetchSingleGame = () => fetchGameDetail(testGameId);

  // ── Phase 1: Sequential polling at decreasing intervals ──
  console.log('══ Phase 1: Sequential Single-Game Polling ══');
  console.log('  (Same game polled repeatedly at decreasing intervals)\n');

  const intervals = [5000, 3000, 2000, 1000, 500, 250, 100];
  const phase1Results = [];

  for (const interval of intervals) {
    const count = Math.min(Math.max(Math.ceil(10000 / interval), 10), 30); // ~10s per test, 10-30 requests
    process.stdout.write(`  [${interval}ms] `);
    const r = await burstTest('GameDetail', fetchSingleGame, interval, count);
    phase1Results.push({ interval, ...r });

    if (r.throttled) {
      console.log(`  ⚠ THROTTLING DETECTED at ${interval}ms interval!\n`);
    }

    // Cool down between tests
    await sleep(3000);
  }

  // ── Phase 2: Sequential discovery endpoint polling ──
  console.log('\n══ Phase 2: Sequential Discovery Polling ══');
  console.log('  (Discovery endpoint polled at decreasing intervals)\n');

  const discIntervals = [5000, 3000, 2000, 1000, 500, 250];
  const phase2Results = [];

  for (const interval of discIntervals) {
    const count = Math.min(Math.max(Math.ceil(8000 / interval), 8), 20);
    process.stdout.write(`  [${interval}ms] `);
    const r = await burstTest('Discovery', fetchDiscovery, interval, count);
    phase2Results.push({ interval, ...r });

    if (r.throttled) {
      console.log(`  ⚠ THROTTLING DETECTED at ${interval}ms interval!\n`);
    }

    await sleep(3000);
  }

  // ── Phase 3: Concurrent requests (simulating batch polling) ──
  if (gameIds.length >= 3) {
    console.log('\n══ Phase 3: Concurrent Game Detail Requests ══');
    console.log('  (Multiple games fetched in parallel)\n');

    const concurrencies = [3, 5, 8, 12, 16, 24];
    const phase3Results = [];

    for (const conc of concurrencies) {
      const gids = gameIds.slice(0, conc);
      const fetchRandomGame = () => {
        const id = gids[Math.floor(Math.random() * gids.length)];
        return fetchGameDetail(id);
      };

      process.stdout.write(`  [${conc} concurrent] `);
      const r = await parallelBurstTest('GameDetail', fetchRandomGame, conc, 5);
      phase3Results.push({ concurrency: conc, ...r });

      if (r.throttled) {
        console.log(`  ⚠ THROTTLING DETECTED at concurrency ${conc}!\n`);
      }

      await sleep(3000);
    }
  }

  // ── Phase 4: Sustained fast polling (stress test) ──
  console.log('\n══ Phase 4: Sustained Fast Polling (60s at various speeds) ══\n');

  const sustainedIntervals = [2000, 1000, 500];
  for (const interval of sustainedIntervals) {
    const duration = 20000; // 20s per test
    const count = Math.floor(duration / interval);
    process.stdout.write(`  [${interval}ms × ${count} reqs over ${duration/1000}s] `);
    const r = await burstTest('Sustained', fetchSingleGame, interval, count);

    if (r.throttled) {
      console.log(`  ⚠ THROTTLING DETECTED during sustained ${interval}ms polling!`);
    } else {
      console.log(`  ✓ Sustained ${interval}ms polling OK`);
    }

    await sleep(5000); // Longer cool down
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Phase 1 — Single Game Sequential:');
  for (const r of phase1Results) {
    const status = r.throttled ? '❌ THROTTLED' : '✅ OK';
    console.log(`  ${r.interval}ms interval: ${status} (${r.ok} ok, ${r.fail} fail, avg ${fmt(r.avgMs)})`);
  }

  console.log('\nPhase 2 — Discovery Sequential:');
  for (const r of phase2Results) {
    const status = r.throttled ? '❌ THROTTLED' : '✅ OK';
    console.log(`  ${r.interval}ms interval: ${status} (${r.ok} ok, ${r.fail} fail, avg ${fmt(r.avgMs)})`);
  }

  // Find safe limit
  const safePhase1 = phase1Results.filter(r => !r.throttled);
  const fastestSafe = safePhase1.length ? safePhase1[safePhase1.length - 1].interval : null;

  console.log('\n── Recommendation ──');
  if (fastestSafe !== null) {
    console.log(`  Fastest safe sequential interval: ${fastestSafe}ms`);
    console.log(`  Recommended with safety margin: ${Math.ceil(fastestSafe * 1.5)}ms`);
  } else {
    console.log('  Could not determine safe interval — all tests passed or all failed.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});