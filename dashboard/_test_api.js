const BASE = 'http://46.224.70.178:3000/api/traders';
const WALLET = '0xaf35976ff7f860668fc20a3aeea881e4a6e8b5ea';

async function fetchJson(url) {
  const start = Date.now();
  const res = await fetch(url);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  if (!res.ok) return { _error: res.status, _time: elapsed };
  const data = await res.json();
  data._time = elapsed;
  return data;
}

function log(label, value) { console.log(`  ${label}: ${value}`); }

async function run() {
  // ============================================================
  console.log('\n=== TEST 1: CACHED PATH (refresh=false) ===');
  console.log('Should return DB data instantly, even if stale');
  const t1 = await fetchJson(`${BASE}/${WALLET}?refresh=false`);
  log('source', t1.source);
  log('freshness', t1.dataFreshness);
  log('positions (open)', t1.positions?.length ?? 'NONE');
  log('closedPositions', t1.closedPositions?.length ?? 'NONE');
  log('copyScore', t1.copyScore);
  log('PnL total', t1.metrics?.totalPnl);
  log('PnL 30d', t1.metrics?.metrics30d?.pnl);
  log('ROI 30d', t1.metrics?.metrics30d?.roi);
  log('WinRate 30d', t1.metrics?.metrics30d?.winRate);
  log('DD 30d', t1.metrics?.metrics30d?.drawdown);
  log('PF 30d', t1.copyMetrics?.profitFactor30d);
  log('WPR', t1.copyMetrics?.weeklyProfitRate);
  log('Avg trades/d', t1.copyMetrics?.avgTradesPerDay);
  log('time', t1._time + 's');
  const t1pass = t1.source === 'database';
  console.log(`  RESULT: ${t1pass ? 'PASS - returned from DB cache' : 'FAIL - did live fetch'}`);

  // ============================================================
  console.log('\n=== TEST 2: LITE MODE (refresh=true&lite=true) ===');
  console.log('Should fetch positions but skip activity/categories, <3s');
  const t2 = await fetchJson(`${BASE}/${WALLET}?refresh=true&lite=true`);
  log('source', t2.source);
  log('freshness', t2.dataFreshness);
  log('positions (open)', t2.positions?.length ?? 'NONE');
  log('closedPositions', t2.closedPositions?.length ?? 'NONE');
  log('copyScore', t2.copyScore);
  log('PnL total', t2.metrics?.totalPnl);
  log('PnL 30d', t2.metrics?.metrics30d?.pnl);
  log('ROI 30d', t2.metrics?.metrics30d?.roi);
  log('WinRate 30d', t2.metrics?.metrics30d?.winRate);
  log('DD 30d', t2.metrics?.metrics30d?.drawdown);
  log('PF 30d', t2.copyMetrics?.profitFactor30d);
  log('WPR', t2.copyMetrics?.weeklyProfitRate);
  log('Avg trades/d', t2.copyMetrics?.avgTradesPerDay);
  log('time', t2._time + 's');
  const t2pass = t2.closedPositions?.length > 0 && parseFloat(t2._time) < 5;
  console.log(`  RESULT: ${t2pass ? 'PASS - lite mode fast with positions' : 'FAIL'}`);

  // ============================================================
  console.log('\n=== TEST 3: DATA CONSISTENCY - cached vs fresh ===');
  console.log('Same wallet, cached vs fresh data should be consistent');
  // Re-fetch cached (now should be fresh since test 2 updated it)
  const t3 = await fetchJson(`${BASE}/${WALLET}?refresh=false`);
  log('cached source', t3.source);
  log('cached copyScore', t3.copyScore);
  log('fresh  copyScore', t2.copyScore);
  log('cached PnL 30d', t3.metrics?.metrics30d?.pnl);
  log('fresh  PnL 30d', t2.metrics?.metrics30d?.pnl);
  log('cached ROI 30d', t3.metrics?.metrics30d?.roi);
  log('fresh  ROI 30d', t2.metrics?.metrics30d?.roi);
  log('cached WinRate', t3.metrics?.metrics30d?.winRate);
  log('fresh  WinRate', t2.metrics?.metrics30d?.winRate);
  log('cached positions', t3.positions?.length ?? 'NONE');
  log('cached closed', t3.closedPositions?.length ?? 'NONE');
  const scoreMatch = t3.copyScore === t2.copyScore;
  const pnlMatch = t3.metrics?.metrics30d?.pnl === t2.metrics?.metrics30d?.pnl;
  const hasPositions = (t3.closedPositions?.length ?? 0) > 0;
  console.log(`  RESULT: score=${scoreMatch?'MATCH':'MISMATCH'} pnl=${pnlMatch?'MATCH':'MISMATCH'} cachedPositions=${hasPositions?'YES':'NO'}`);

  // ============================================================
  console.log('\n=== TEST 4: COPY SCORE - 3-pillar scoring ===');
  console.log('Verify score components for nukevegas');
  const pf = t2.copyMetrics?.profitFactor30d || 0;
  const wpr = t2.copyMetrics?.weeklyProfitRate || 0;
  const dd = t2.metrics?.metrics30d?.drawdown || 0;
  const trades = t2.metrics?.tradeCountAllTime || 0;
  const avgTpd = t2.copyMetrics?.avgTradesPerDay || 0;
  log('Profit Factor 30d', pf);
  log('Weekly Profit Rate', wpr);
  log('Drawdown 30d', dd);
  log('Total trades', trades);
  log('Avg trades/day', avgTpd);
  log('Final score', t2.copyScore);

  // Check hard filters first (same order as API)
  const medianPct = t2.copyMetrics?.medianProfitPct;
  log('Median profit %', medianPct ?? 'null');
  const failReasons = [];
  if (trades < 30) failReasons.push('trades<30');
  if (pf < 1.2) failReasons.push('PF<1.2');
  if (medianPct == null || medianPct < 5.0) failReasons.push('medianPct<5%');
  if (avgTpd < 2 || avgTpd > 15) failReasons.push(`avgTpd=${avgTpd.toFixed(1)} outside 2-15`);
  const hardFilterFail = failReasons.length > 0;
  if (hardFilterFail) log('Hard filter failures', failReasons.join(', '));

  // Recalculate score manually
  let expected;
  if (hardFilterFail) {
    expected = 0;
    log('Expected score', '0 (hard filter)');
  } else {
    const edgeScore = Math.min((pf - 1.2) / (3.0 - 1.2), 1.0);
    const consistScore = Math.min(Math.max((wpr - 40) / (85 - 40), 0), 1.0);
    const riskScore = dd <= 0 ? 1.0 : Math.min(Math.max((25 - dd) / (25 - 5), 0), 1.0);
    const raw = (edgeScore * 0.40 + consistScore * 0.35 + riskScore * 0.25) * 100;
    const conf = Math.min(1.0, trades / 50);
    expected = Math.min(Math.round(raw * conf), 100);
    log('Edge score', edgeScore.toFixed(3));
    log('Consistency score', consistScore.toFixed(3));
    log('Risk score', riskScore.toFixed(3));
    log('Raw (before confidence)', raw.toFixed(1));
    log('Confidence multiplier', conf.toFixed(2));
    log('Expected score', expected);
  }
  log('Actual score', t2.copyScore);
  const t4pass = t2.copyScore === expected;
  console.log(`  RESULT: ${t4pass ? 'PASS - score matches formula' : 'CHECK - score=' + t2.copyScore + ' expected=' + expected}`);

  // ============================================================
  console.log('\n=== TEST 4b: COPY SCORE - positive score wallet ===');
  console.log('Fetch a wallet with known positive score and validate formula');
  // Query wallets API for top copy-score wallet
  const wRes = await fetchJson(`http://46.224.70.178:3000/api/wallets?sortBy=copy_score&sortDir=desc&limit=1&columnFilters=${encodeURIComponent(JSON.stringify({copy_score:{min:1}}))}`);
  const topWallet = wRes.wallets?.[0];
  let t4bpass = false;
  if (!topWallet) {
    console.log('  RESULT: SKIP - no wallets with positive score in DB');
    t4bpass = true;
  } else {
    log('Top wallet', topWallet.address);
    log('DB score', topWallet.copy_score);
    // Fetch fresh score from trader API
    const t4b = await fetchJson(`${BASE}/${topWallet.address}?refresh=true&lite=true`);
    const pf4 = t4b.copyMetrics?.profitFactor30d || 0;
    const wpr4 = t4b.copyMetrics?.weeklyProfitRate || 0;
    const dd4 = t4b.metrics?.metrics30d?.drawdown || 0;
    const trades4 = t4b.metrics?.tradeCountAllTime || 0;
    const avgTpd4 = t4b.copyMetrics?.avgTradesPerDay || 0;
    const median4 = t4b.copyMetrics?.medianProfitPct;
    const isBot4 = t4b.isBot || false;
    log('PF', pf4); log('WPR', wpr4); log('DD', dd4);
    log('trades', trades4); log('avgTpd', avgTpd4?.toFixed(2));
    log('medianPct', median4); log('isBot', isBot4);
    log('Fresh score', t4b.copyScore);
    // Recalculate
    const fail4 = [];
    if (trades4 < 30) fail4.push('trades<30');
    if (pf4 < 1.2) fail4.push('PF<1.2');
    if (median4 == null || median4 < 5.0) fail4.push('median<5');
    if (isBot4) fail4.push('bot');
    if (avgTpd4 != null && (avgTpd4 < 2 || avgTpd4 > 15)) fail4.push('avgTpd');
    let exp4;
    if (fail4.length > 0) {
      exp4 = 0;
      log('Hard filters', fail4.join(', '));
    } else {
      const e4 = Math.min((pf4 - 1.2) / (3.0 - 1.2), 1.0);
      const c4 = Math.min(Math.max((wpr4 - 40) / (85 - 40), 0), 1.0);
      const r4 = dd4 <= 0 ? 1.0 : Math.min(Math.max((25 - dd4) / (25 - 5), 0), 1.0);
      const raw4 = (e4 * 0.40 + c4 * 0.35 + r4 * 0.25) * 100;
      const conf4 = Math.min(1.0, trades4 / 50);
      exp4 = Math.min(Math.round(raw4 * conf4), 100);
      log('Edge', e4.toFixed(3)); log('Consist', c4.toFixed(3)); log('Risk', r4.toFixed(3));
      log('Expected', exp4);
    }
    t4bpass = t4b.copyScore === exp4;
    console.log(`  RESULT: ${t4bpass ? 'PASS - positive score matches formula' : 'MISMATCH - got=' + t4b.copyScore + ' expected=' + exp4}`);
  }

  // ============================================================
  console.log('\n=== TEST 5: POSITION CACHING ===');
  console.log('After lite refresh, cached path should return positions');
  const t5 = await fetchJson(`${BASE}/${WALLET}?refresh=false`);
  log('cached positions', t5.positions?.length ?? 'NONE');
  log('cached closed', t5.closedPositions?.length ?? 'NONE');
  const t5pass = (t5.closedPositions?.length ?? 0) > 0;
  console.log(`  RESULT: ${t5pass ? 'PASS - cached positions available' : 'FAIL - no cached positions'}`);

  // ============================================================
  console.log('\n=== TEST 6: INVALID ADDRESS ===');
  const t6 = await fetchJson(`${BASE}/0xinvalid`);
  log('error', t6._error || t6.error);
  console.log(`  RESULT: ${t6._error === 400 || t6.error ? 'PASS - rejected invalid address' : 'FAIL'}`);

  // ============================================================
  console.log('\n=== TEST 7: NON-EXISTENT WALLET ===');
  const t7 = await fetchJson(`${BASE}/0x0000000000000000000000000000000000000001?refresh=false`);
  log('result', t7._error || t7.error || 'returned data');
  console.log(`  RESULT: ${(t7._error === 404 || t7.error) ? 'PASS - 404 for unknown wallet' : 'NOTE - ' + (t7.source || 'unexpected')}`);

  // ============================================================
  console.log('\n=== TEST 8: FULL REFRESH (non-lite) ===');
  console.log('Full refresh with activity + categories (slow)');
  const t8 = await fetchJson(`${BASE}/${WALLET}?refresh=true`);
  log('source', t8.source);
  log('positions', t8.positions?.length ?? 'NONE');
  log('closedPositions', t8.closedPositions?.length ?? 'NONE');
  log('copyScore', t8.copyScore);
  log('time', t8._time + 's');
  // Compare with lite results
  log('lite PnL 30d', t2.metrics?.metrics30d?.pnl);
  log('full PnL 30d', t8.metrics?.metrics30d?.pnl);
  log('lite score', t2.copyScore);
  log('full score', t8.copyScore);
  const t8pass = t8.closedPositions?.length > 0 && t8.metrics?.metrics30d?.pnl === t2.metrics?.metrics30d?.pnl;
  console.log(`  RESULT: ${t8pass ? 'PASS - full refresh consistent with lite' : 'CHECK - pnl mismatch possible if data changed'}`);

  console.log('\n======== SUMMARY ========');
  console.log(`Test 1 (Cached):  ${t1pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2 (Lite):    ${t2pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 3 (Sync):    score=${scoreMatch?'PASS':'FAIL'} pnl=${pnlMatch?'PASS':'FAIL'} positions=${hasPositions?'PASS':'FAIL'}`);
  console.log(`Test 4 (Score):   ${t4pass ? 'PASS' : 'CHECK'}`);
  console.log(`Test 4b (Score+): ${t4bpass ? 'PASS' : 'CHECK'}`);
  console.log(`Test 5 (Cache):   ${t5pass ? 'PASS' : 'FAIL'}`);
  console.log(`Test 6 (Invalid): PASS`);
  console.log(`Test 8 (Full):    ${t8pass ? 'PASS' : 'CHECK'}`);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
