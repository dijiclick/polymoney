#!/usr/bin/env node
/**
 * Signal Manager — Interactive Launcher with Session Logging
 *
 * Starts the signal manager and optionally enables auto goal trading.
 * All output is logged to data/sessions/session-YYYY-MM-DD_HH-MM-SS.log
 *
 * Usage: node run.mjs
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --- Session Logger ---
const SESSION_DIR = resolve(__dirname, 'data', 'sessions');
mkdirSync(SESSION_DIR, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = resolve(SESSION_DIR, `session-${ts}.log`);
const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

/** Write to both console and log file */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  logStream.write(line + '\n');
}

/** Write raw line from child process to both console and log */
function logRaw(data) {
  const text = data.toString();
  process.stdout.write(text);
  logStream.write(text);
}

const PORT = 3847;
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function banner() {
  const lines = [
    '',
    '  ╔══════════════════════════════════════════╗',
    '  ║     POLYMARKET SIGNAL MANAGER v2         ║',
    '  ║     Goal Detection + Auto Trading        ║',
    '  ╚══════════════════════════════════════════╝',
    '',
    `  Wallet: ${process.env.POLY_FUNDER_ADDRESS || 'NOT SET'}`,
    `  Trading key: ${process.env.POLY_PRIVATE_KEY ? 'loaded' : 'MISSING'}`,
    `  Log file: ${LOG_FILE}`,
    '',
  ];
  for (const l of lines) log(l);
}

async function sendCommand(cmd) {
  try {
    const r = await fetch(`http://localhost:${PORT}/api/trading/command`, {
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

async function waitForServer(maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** Periodically snapshot trading state to log */
function startStateLogger() {
  return setInterval(async () => {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/goal-trader`);
      if (!r.ok) return;
      const state = await r.json();
      if (!state.enabled) return;

      const summary = {
        time: new Date().toISOString(),
        enabled: state.enabled,
        openPositions: state.openPositions?.length || 0,
        totalTrades: state.totalTrades,
        totalPnl: state.totalPnl,
      };

      // Log open positions
      if (state.openPositions?.length > 0) {
        const posLines = state.openPositions.map(p => {
          const hold = ((Date.now() - p.entryTime) / 1000).toFixed(0);
          return `    ${p.match} | ${p.side} ${p.marketKey} @ ${p.entryPrice.toFixed(3)} → ${p.lastPrice.toFixed(3)} | ${hold}s | ${p.goalType}`;
        });
        logStream.write(`[${summary.time}] [STATE] Trades: ${summary.totalTrades} | P&L: $${summary.totalPnl.toFixed(3)} | Open: ${summary.openPositions}\n`);
        for (const l of posLines) logStream.write(l + '\n');
      }

      // Log recent trades summary
      if (state.recentTrades?.length > 0) {
        const last = state.recentTrades[0];
        if (last.exitTime && Date.now() - last.exitTime < 65000) {
          // Trade closed in the last minute — log it prominently
          logStream.write(`[${summary.time}] [TRADE_CLOSED] ${last.match} | ${last.side} ${last.marketKey} | Entry: ${last.entryPrice.toFixed(3)} → Exit: ${last.exitPrice.toFixed(3)} | P&L: $${last.pnl?.toFixed(3)} | Reason: ${last.exitReason} | Hold: ${((last.exitTime - last.entryTime) / 1000).toFixed(0)}s\n`);
        }
      }
    } catch { /* server not ready */ }
  }, 60_000); // Every 60s
}

async function main() {
  banner();

  if (!process.env.POLY_PRIVATE_KEY || !process.env.POLY_FUNDER_ADDRESS) {
    log('  ERROR: Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS in .env');
    log('  Run: node scripts/test-connection.mjs to set up');
    process.exit(1);
  }

  const answer = await ask('  Enable auto goal trading? (y/n): ');
  const enableAutoTrade = answer.trim().toLowerCase().startsWith('y');

  log('');
  if (enableAutoTrade) {
    log('  Mode: AUTO TRADING — bot will arm + GoalTrader ON');
    log('  The bot will auto-buy on goals and auto-sell on exit signals');
  } else {
    log('  Mode: MONITOR ONLY — signals will fire but no trades');
  }
  log('');

  rl.close();

  // Start the signal manager as a child process (pipe stdout/stderr for logging)
  log('  Starting signal manager...');
  const child = spawn('node', [
    '--max-old-space-size=4096',
    '--max-semi-space-size=64',
    resolve(__dirname, 'dist', 'src', 'index.js'),
  ], {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
  });

  // Pipe child output to both console and log file
  child.stdout.on('data', logRaw);
  child.stderr.on('data', logRaw);

  child.on('error', (err) => {
    log(`  Failed to start: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    log(`\n  Signal manager exited (code ${code})`);
    logStream.write(`\n=== SESSION ENDED ${new Date().toISOString()} ===\n`);
    logStream.end();
    process.exit(code || 0);
  });

  // Forward SIGINT/SIGTERM to child
  let stopping = false;
  const gracefulStop = () => {
    if (stopping) return;
    stopping = true;
    log('\n  Shutting down...');
    logStream.write(`\n=== SHUTDOWN REQUESTED ${new Date().toISOString()} ===\n`);
    child.kill('SIGINT');
    // Force kill after 10s
    setTimeout(() => {
      log('  Force killing...');
      child.kill('SIGKILL');
    }, 10000);
  };
  process.on('SIGINT', gracefulStop);
  process.on('SIGTERM', gracefulStop);

  // Wait for server to be ready, then send commands
  log('  Waiting for dashboard to start...');
  const ready = await waitForServer();

  if (!ready) {
    log('  Dashboard did not start in time');
    return;
  }

  log(`  Dashboard ready at http://localhost:${PORT}`);

  // Start periodic state logger
  const stateTimer = startStateLogger();
  child.on('exit', () => clearInterval(stateTimer));

  if (enableAutoTrade) {
    log('');
    log('  Arming bot...');
    const armResult = await sendCommand('arm');
    log(`  > ${armResult}`);

    log('  Enabling GoalTrader...');
    const gtResult = await sendCommand('goaltrader on');
    log(`  > ${gtResult}`);

    log('');
    log('  ============================================');
    log('  AUTO TRADING ACTIVE');
    log('  - Monitoring 1xBet for goals');
    log('  - Will auto-buy ML outcomes on Polymarket');
    log('  - Exit: stabilization / take-profit / stop-loss');
    log('  - Trade size: $1 per goal');
    log('  ============================================');
    log('');
    log('  Press Ctrl+C to stop');
    log('');
  } else {
    log('');
    log('  Monitor mode active. To enable trading later:');
    log(`    curl -X POST http://localhost:${PORT}/api/trading/command -d '{"command":"arm"}'`);
    log(`    curl -X POST http://localhost:${PORT}/api/trading/command -d '{"command":"goaltrader on"}'`);
    log('');
    log('  Press Ctrl+C to stop');
  }
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  logStream.write(`\n=== FATAL ERROR ${new Date().toISOString()} ===\n${err.stack || err}\n`);
  logStream.end();
  process.exit(1);
});
