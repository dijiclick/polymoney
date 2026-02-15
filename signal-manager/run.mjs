#!/usr/bin/env node
/**
 * Polymarket — Unified Launcher
 *
 * Interactive menu to start the Signal Manager in different modes:
 *   1. Dashboard Only  — monitor goals + timing, no trading
 *   2. Auto Buy/Sell   — goal trader active + dashboard
 *
 * Console shows: source status, soccer goals with timing, trade executions.
 * Full debug output saved to: data/sessions/session-YYYY-MM-DD_HH-MM-SS.log
 */

import { spawn } from 'node:child_process';
import { readFileSync, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { exec } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, '..', 'dashboard');

// Load .env
try {
  const content = readFileSync(resolve(__dirname, '.env'), 'utf-8');
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

// Load dashboard .env.local
for (const envFile of ['.env.local', '.env']) {
  try {
    const content = readFileSync(resolve(DASHBOARD_DIR, envFile), 'utf-8');
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

// --- Session Logger ---
const SESSION_DIR = resolve(__dirname, 'data', 'sessions');
mkdirSync(SESSION_DIR, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = resolve(SESSION_DIR, `session-${ts}.log`);
const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  logStream.write(line + '\n');
}

function logRaw(data) {
  const text = data.toString();
  process.stdout.write(text);
  logStream.write(text);
}

const SM_PORT = 3847;
const DASH_PORT = 3000;

function banner() {
  const lines = [
    '',
    '  ╔══════════════════════════════════════════════════╗',
    '  ║     POLYMARKET GOAL TRADER                       ║',
    '  ╚══════════════════════════════════════════════════╝',
    '',
    `  Wallet:   ${process.env.POLY_FUNDER_ADDRESS || 'NOT SET'}`,
    `  Trading:  ${process.env.POLY_PRIVATE_KEY ? 'key loaded' : 'MISSING'}`,
    `  Log:      ${LOG_FILE}`,
    '',
  ];
  for (const l of lines) log(l);
}

function showMenu() {
  const lines = [
    '  ┌────────────────────────────────────────────────┐',
    '  │  1. Dashboard Only   (monitor goals, no trades) │',
    '  │  2. Auto Buy/Sell    (goal trader + dashboard)  │',
    '  └────────────────────────────────────────────────┘',
    '',
  ];
  for (const l of lines) console.log(l);
}

function askChoice() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Select (1-2): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function killPort(port) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
        if (err || !stdout.trim()) return resolve();
        const pids = new Set();
        for (const line of stdout.trim().split('\n')) {
          const match = line.trim().match(/LISTENING\s+(\d+)/);
          if (match) pids.add(match[1]);
        }
        if (pids.size === 0) return resolve();
        const kills = [...pids].map(p => `taskkill /PID ${p} /F`).join(' & ');
        exec(kills, () => resolve());
      });
    } else {
      exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, () => resolve());
    }
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start ${url}`
    : process.platform === 'darwin' ? `open ${url}`
    : `xdg-open ${url}`;
  exec(cmd, () => {});
}

async function sendCommand(cmd) {
  try {
    const r = await fetch(`http://localhost:${SM_PORT}/api/trading/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    const j = await r.json();
    return j.result || j.error || 'ok';
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function waitForServer(port, path = '/health', maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await fetch(`http://localhost:${port}${path}`);
      if (r.ok || r.status === 404) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function startStateLogger() {
  return setInterval(async () => {
    try {
      // Fetch health + goal-trader state in parallel
      const [healthRes, gtRes] = await Promise.all([
        fetch(`http://localhost:${SM_PORT}/health`).catch(() => null),
        fetch(`http://localhost:${SM_PORT}/api/goal-trader`).catch(() => null),
      ]);

      const health = healthRes?.ok ? await healthRes.json() : null;
      const state = gtRes?.ok ? await gtRes.json() : null;
      const now = new Date().toISOString();

      // Console heartbeat — brief status so you know it's alive
      const events = health?.events || '?';
      const open = state?.openPositions?.length || 0;
      const trades = state?.totalTrades ?? 0;
      const pnl = state?.totalPnl != null ? `$${state.totalPnl.toFixed(2)}` : '—';
      console.log(`  [${now.slice(11, 19)}] heartbeat | Events: ${events} | Trades: ${trades} | P&L: ${pnl} | Open: ${open}`);

      if (!state?.enabled) return;

      // Detailed state to session log file only
      if (state.openPositions?.length > 0) {
        const posLines = state.openPositions.map(p => {
          const hold = ((Date.now() - p.entryTime) / 1000).toFixed(0);
          return `    ${p.match} | ${p.side} ${p.marketKey} @ ${p.entryPrice.toFixed(3)} → ${p.lastPrice.toFixed(3)} | ${hold}s | ${p.goalType}`;
        });
        logStream.write(`[${now}] [STATE] Trades: ${trades} | P&L: ${pnl} | Open: ${open}\n`);
        for (const l of posLines) logStream.write(l + '\n');
      }

      if (state.recentTrades?.length > 0) {
        const last = state.recentTrades[0];
        if (last.exitTime && Date.now() - last.exitTime < 65000) {
          logStream.write(`[${now}] [TRADE_CLOSED] ${last.match} | ${last.side} ${last.marketKey} | Entry: ${last.entryPrice.toFixed(3)} → Exit: ${last.exitPrice.toFixed(3)} | P&L: $${last.pnl?.toFixed(3)} | Reason: ${last.exitReason} | Hold: ${((last.exitTime - last.entryTime) / 1000).toFixed(0)}s\n`);
        }
      }
    } catch { /* server not ready */ }
  }, 60_000);
}

// --- Start Dashboard (Next.js) ---
async function startDashboard() {
  if (!existsSync(DASHBOARD_DIR)) {
    log('  Dashboard directory not found — skipping');
    return null;
  }

  const buildId = resolve(DASHBOARD_DIR, '.next', 'BUILD_ID');
  if (!existsSync(buildId)) {
    log('  Dashboard: no production build found — building...');
    const { execSync } = await import('node:child_process');
    try {
      execSync('npm run build', { cwd: DASHBOARD_DIR, stdio: 'inherit', timeout: 120_000 });
      log('  Dashboard build complete');
    } catch (err) {
      log(`  Dashboard build failed — skipping`);
      return null;
    }
  }

  log(`  Starting dashboard on port ${DASH_PORT}...`);
  const child = spawn('npx', ['next', 'start', '-p', String(DASH_PORT)], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: DASHBOARD_DIR,
    shell: true,
  });

  child.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) logStream.write(`[DASH] ${text}\n`);
  });
  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      logStream.write(`[DASH] ${text}\n`);
      if (text.includes('Error') || text.includes('error')) {
        console.error(`  [DASH ERROR] ${text}`);
      }
    }
  });

  child.on('error', (err) => {
    log(`  Dashboard failed to start: ${err.message}`);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`  Dashboard exited (code ${code})`);
    }
  });

  return child;
}

// --- Start Signal Manager with env overrides ---
function startSignalManager(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };

  const smChild = spawn('node', [
    '--max-old-space-size=4096',
    '--max-semi-space-size=64',
    resolve(__dirname, 'dist', 'src', 'index.js'),
  ], {
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
  });

  smChild.stdout.on('data', logRaw);
  smChild.stderr.on('data', logRaw);

  smChild.on('error', (err) => {
    log(`  Signal manager failed to start: ${err.message}`);
    process.exit(1);
  });

  return smChild;
}

async function main() {
  banner();

  // --- Interactive menu (or --dashboard flag for backward compat) ---
  let mode;
  if (process.argv.includes('--dashboard')) {
    mode = '1';
  } else if (process.argv.includes('--trade')) {
    mode = '2';
  } else {
    showMenu();
    mode = await askChoice();
  }

  if (mode !== '1' && mode !== '2') {
    log('  Invalid choice. Exiting.');
    process.exit(0);
  }

  const isDashboardOnly = mode === '1';
  const isTrading = mode === '2';

  log('');
  log(`  Mode: ${isDashboardOnly ? 'DASHBOARD ONLY (monitoring goals, no trades)' : 'AUTO BUY/SELL (goal trader active)'}`);
  log('');

  // Validate credentials for trading mode
  if (isTrading && (!process.env.POLY_PRIVATE_KEY || !process.env.POLY_FUNDER_ADDRESS)) {
    log('  ERROR: Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    log('  Run: node scripts/test-connection.mjs to set up');
    process.exit(1);
  }

  // Kill stale processes on our ports
  log('  Cleaning up stale processes...');
  await Promise.all([killPort(SM_PORT), killPort(DASH_PORT)]);

  // Start dashboard
  const dashChild = await startDashboard();

  // Start signal manager with appropriate env overrides
  const smEnv = isDashboardOnly
    ? { POLY_GOALTRADER: 'false', POLY_ARMED: 'false' }
    : { POLY_GOALTRADER: 'true', POLY_ARMED: 'true' };

  log('  Starting signal manager...');
  const smChild = startSignalManager(smEnv);

  smChild.on('exit', (code) => {
    log(`\n  Signal manager exited (code ${code})`);
    if (dashChild) dashChild.kill('SIGINT');
    logStream.write(`\n=== SESSION ENDED ${new Date().toISOString()} ===\n`);
    logStream.end();
    process.exit(code || 0);
  });

  // Graceful shutdown
  let stopping = false;
  const gracefulStop = () => {
    if (stopping) return;
    stopping = true;
    log('\n  Shutting down...');
    logStream.write(`\n=== SHUTDOWN REQUESTED ${new Date().toISOString()} ===\n`);
    smChild.kill('SIGINT');
    if (dashChild) dashChild.kill('SIGINT');
    setTimeout(() => {
      log('  Force killing...');
      smChild.kill('SIGKILL');
      if (dashChild) dashChild.kill('SIGKILL');
    }, 10000);
  };
  process.on('SIGINT', gracefulStop);
  process.on('SIGTERM', gracefulStop);

  // Wait for signal manager to be ready
  log('  Waiting for signal manager...');
  const smReady = await waitForServer(SM_PORT, '/health');

  if (!smReady) {
    log('  Signal manager did not start in time');
    return;
  }

  log(`  Signal manager ready at http://localhost:${SM_PORT}`);

  // Check dashboard
  if (dashChild) {
    const dashReady = await waitForServer(DASH_PORT, '/', 15000);
    if (dashReady) {
      log(`  Dashboard ready at http://localhost:${DASH_PORT}`);
    } else {
      log('  Dashboard still starting (check log for status)');
    }
  }

  // Start periodic state logger
  const stateTimer = startStateLogger();
  smChild.on('exit', () => clearInterval(stateTimer));

  // For trading mode: arm bot and enable GoalTrader
  if (isTrading) {
    log('');
    log('  Arming bot...');
    const armResult = await sendCommand('arm');
    log(`  > ${armResult}`);

    log('  Enabling GoalTrader...');
    const gtResult = await sendCommand('goaltrader on');
    log(`  > ${gtResult}`);
  }

  log('');
  log('  ============================================');
  if (isTrading) {
    log('  GOAL TRADING ACTIVE — SOCCER ONLY');
    log('  Console shows:');
    log('    ⚽ Soccer goals + source timing (20s)');
    log('    💰 Buy executions (amount, price, delay)');
    log('    ❌ Failed buys with reason');
    log('    💰 Exits with P&L');
  } else {
    log('  MONITORING MODE — NO TRADING');
    log('  Console shows:');
    log('    ⚽ Soccer goals + source timing (20s)');
    log('    No buy/sell orders placed');
  }
  log('  ============================================');
  log('');
  log(`  Signal Manager: http://localhost:${SM_PORT}`);
  if (dashChild) log(`  Dashboard:      http://localhost:${DASH_PORT}`);
  log(`  Session log:    ${LOG_FILE}`);
  log('');
  log('  Press Ctrl+C to stop');

  // Auto-open dashboard in browser
  openBrowser(`http://localhost:${SM_PORT}`);
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  logStream.write(`\n=== FATAL ERROR ${new Date().toISOString()} ===\n${err.stack || err}\n`);
  logStream.end();
  process.exit(1);
});
