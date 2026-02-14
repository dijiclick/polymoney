#!/usr/bin/env node
/**
 * Polymarket — Unified Launcher
 *
 * Starts the Signal Manager (goal trader) and/or the Next.js Dashboard.
 * Auto-enables goal trading ($1 FOK, 1-min exit, soccer only).
 * All output is logged to data/sessions/session-YYYY-MM-DD_HH-MM-SS.log
 *
 * Usage:
 *   node run.mjs              # Start both Signal Manager + Dashboard
 *   node run.mjs --dashboard  # Start Dashboard only (port 3000)
 */

import { spawn } from 'node:child_process';
import { readFileSync, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, '..', 'dashboard');
const dashboardOnly = process.argv.includes('--dashboard');

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
    '  ║     POLYMARKET — UNIFIED LAUNCHER                ║',
    '  ║     Goal Trader + Dashboard                       ║',
    '  ╚══════════════════════════════════════════════════╝',
    '',
    `  Wallet:  ${process.env.POLY_FUNDER_ADDRESS || 'NOT SET'}`,
    `  Trading: ${process.env.POLY_PRIVATE_KEY ? 'key loaded' : 'MISSING'}`,
    `  Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'not set'}`,
    `  Log:     ${LOG_FILE}`,
    '',
  ];
  for (const l of lines) log(l);
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
      const r = await fetch(`http://localhost:${SM_PORT}/api/goal-trader`);
      if (!r.ok) return;
      const state = await r.json();
      if (!state.enabled) return;

      const summary = {
        time: new Date().toISOString(),
        openPositions: state.openPositions?.length || 0,
        totalTrades: state.totalTrades,
        totalPnl: state.totalPnl,
      };

      if (state.openPositions?.length > 0) {
        const posLines = state.openPositions.map(p => {
          const hold = ((Date.now() - p.entryTime) / 1000).toFixed(0);
          return `    ${p.match} | ${p.side} ${p.marketKey} @ ${p.entryPrice.toFixed(3)} → ${p.lastPrice.toFixed(3)} | ${hold}s | ${p.goalType}`;
        });
        logStream.write(`[${summary.time}] [STATE] Trades: ${summary.totalTrades} | P&L: $${summary.totalPnl.toFixed(3)} | Open: ${summary.openPositions}\n`);
        for (const l of posLines) logStream.write(l + '\n');
      }

      if (state.recentTrades?.length > 0) {
        const last = state.recentTrades[0];
        if (last.exitTime && Date.now() - last.exitTime < 65000) {
          logStream.write(`[${summary.time}] [TRADE_CLOSED] ${last.match} | ${last.side} ${last.marketKey} | Entry: ${last.entryPrice.toFixed(3)} → Exit: ${last.exitPrice.toFixed(3)} | P&L: $${last.pnl?.toFixed(3)} | Reason: ${last.exitReason} | Hold: ${((last.exitTime - last.entryTime) / 1000).toFixed(0)}s\n`);
        }
      }
    } catch { /* server not ready */ }
  }, 60_000);
}

// --- Start Dashboard (Next.js) ---
function startDashboard() {
  if (!existsSync(DASHBOARD_DIR)) {
    log('  Dashboard directory not found — skipping');
    return null;
  }

  const nextBuild = resolve(DASHBOARD_DIR, '.next');
  if (!existsSync(nextBuild)) {
    log('  Dashboard: no .next build found — run "npm run build" in dashboard/ first');
    log('  Skipping dashboard...');
    return null;
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
    if (text) logStream.write(`[DASH] ${text}\n`);
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

async function main() {
  banner();

  // --- Dashboard-only mode ---
  if (dashboardOnly) {
    log('  Mode: DASHBOARD ONLY');
    log('');

    const dashChild = startDashboard();
    if (!dashChild) {
      log('  ERROR: Dashboard could not start');
      process.exit(1);
    }

    let stopping = false;
    const gracefulStop = () => {
      if (stopping) return;
      stopping = true;
      log('\n  Shutting down dashboard...');
      dashChild.kill('SIGINT');
      setTimeout(() => dashChild.kill('SIGKILL'), 5000);
    };
    process.on('SIGINT', gracefulStop);
    process.on('SIGTERM', gracefulStop);
    dashChild.on('exit', (code) => {
      log(`  Dashboard exited (code ${code})`);
      logStream.end();
      process.exit(code || 0);
    });

    const dashReady = await waitForServer(DASH_PORT, '/', 30000);
    if (dashReady) {
      log(`  Dashboard ready at http://localhost:${DASH_PORT}`);
    } else {
      log('  Dashboard still starting...');
    }
    log('');
    log('  Press Ctrl+C to stop');
    return;
  }

  // --- Full mode: Signal Manager + Dashboard ---
  if (!process.env.POLY_PRIVATE_KEY || !process.env.POLY_FUNDER_ADDRESS) {
    log('  ERROR: Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    log('  Run: node scripts/test-connection.mjs to set up');
    process.exit(1);
  }

  log('  Mode: GOAL TRADING — $1 FOK, 1-min exit, soccer only');
  log('');

  // 1. Start dashboard (Next.js)
  const dashChild = startDashboard();

  // 2. Start signal manager
  log('  Starting signal manager...');
  const smChild = spawn('node', [
    '--max-old-space-size=4096',
    '--max-semi-space-size=64',
    resolve(__dirname, 'dist', 'src', 'index.js'),
  ], {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
  });

  smChild.stdout.on('data', logRaw);
  smChild.stderr.on('data', logRaw);

  smChild.on('error', (err) => {
    log(`  Signal manager failed to start: ${err.message}`);
    process.exit(1);
  });

  smChild.on('exit', (code) => {
    log(`\n  Signal manager exited (code ${code})`);
    if (dashChild) dashChild.kill('SIGINT');
    logStream.write(`\n=== SESSION ENDED ${new Date().toISOString()} ===\n`);
    logStream.end();
    process.exit(code || 0);
  });

  // Graceful shutdown — kill both processes
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

  // Arm bot and enable GoalTrader
  log('');
  log('  Arming bot...');
  const armResult = await sendCommand('arm');
  log(`  > ${armResult}`);

  log('  Enabling GoalTrader...');
  const gtResult = await sendCommand('goaltrader on');
  log(`  > ${gtResult}`);

  log('');
  log('  ============================================');
  log('  GOAL TRADING ACTIVE — SOCCER ONLY');
  log('  - Buy $1 FOK on first goal detection');
  log('  - Skip extending leads & odds >90%');
  log('  - Auto-sell after 1 minute');
  log('  ============================================');
  log('');
  log(`  Signal Manager: http://localhost:${SM_PORT}`);
  if (dashChild) log(`  Dashboard:      http://localhost:${DASH_PORT}`);
  log('');
  log('  Press Ctrl+C to stop');
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  logStream.write(`\n=== FATAL ERROR ${new Date().toISOString()} ===\n${err.stack || err}\n`);
  logStream.end();
  process.exit(1);
});
