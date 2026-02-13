#!/usr/bin/env node
/**
 * Polymarket Dashboard — Auto Launcher with Session Logging
 *
 * Builds (if needed) and starts the Next.js dashboard in production mode.
 * All output is logged to data/sessions/session-YYYY-MM-DD_HH-MM-SS.log
 *
 * Usage: node run.mjs [--dev] [--skip-build] [--port 3000]
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse CLI args ---
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const skipBuild = args.includes('--skip-build');
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 && args[portIdx + 1] ? parseInt(args[portIdx + 1]) : 3000;

// --- Load .env.local ---
for (const envFile of ['.env.local', '.env']) {
  try {
    const content = readFileSync(resolve(__dirname, envFile), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found */ }
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

function banner() {
  const lines = [
    '',
    '  ========================================',
    '    POLYMARKET DASHBOARD',
    '  ========================================',
    '',
    `  Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`,
    `  Port: ${PORT}`,
    `  Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'MISSING'}`,
    `  Etherscan: ${process.env.ETHERSCAN_API_KEY ? 'configured' : 'not set'}`,
    `  Log file: ${LOG_FILE}`,
    '',
  ];
  for (const l of lines) log(l);
}

function checkEnv() {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    log(`  ERROR: Missing env vars: ${missing.join(', ')}`);
    log('  Create .env.local with required variables (see .env.local.example)');
    process.exit(1);
  }
}

async function buildIfNeeded() {
  if (isDev || skipBuild) return;

  const nextDir = resolve(__dirname, '.next');
  if (!existsSync(nextDir)) {
    log('  No .next build found — building...');
  } else {
    // Check if source is newer than build
    try {
      const buildTime = execSync('stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0', { cwd: __dirname }).toString().trim();
      log(`  Build exists (checking freshness...)`);
    } catch {
      log('  Rebuilding...');
    }
  }

  log('  Building Next.js app...');
  try {
    execSync('npm run build', {
      cwd: __dirname,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
      timeout: 120_000,
    });
    log('  Build complete');
  } catch (err) {
    log(`  Build failed: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  banner();
  checkEnv();
  await buildIfNeeded();

  // Start Next.js
  const cmd = isDev ? 'dev' : 'start';
  log(`  Starting Next.js (${cmd}) on port ${PORT}...`);

  const child = spawn('npx', ['next', cmd, '-p', String(PORT)], {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
    shell: true,
  });

  child.stdout.on('data', logRaw);
  child.stderr.on('data', logRaw);

  child.on('error', (err) => {
    log(`  Failed to start: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    log(`\n  Dashboard exited (code ${code})`);
    logStream.write(`\n=== SESSION ENDED ${new Date().toISOString()} ===\n`);
    logStream.end();
    process.exit(code || 0);
  });

  // Graceful shutdown
  let stopping = false;
  const gracefulStop = () => {
    if (stopping) return;
    stopping = true;
    log('\n  Shutting down dashboard...');
    logStream.write(`\n=== SHUTDOWN REQUESTED ${new Date().toISOString()} ===\n`);
    child.kill('SIGINT');
    setTimeout(() => {
      log('  Force killing...');
      child.kill('SIGKILL');
    }, 10000);
  };
  process.on('SIGINT', gracefulStop);
  process.on('SIGTERM', gracefulStop);

  // Wait for server to be ready
  log('  Waiting for server to start...');
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      const r = await fetch(`http://localhost:${PORT}`);
      if (r.ok || r.status === 404) {
        log(`  Dashboard ready at http://localhost:${PORT}`);
        log('');
        log('  Pages:');
        log(`    Wallets:  http://localhost:${PORT}/wallets`);
        log(`    Live:     http://localhost:${PORT}/live`);
        log('');
        log('  Press Ctrl+C to stop');
        return;
      }
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  log('  Server started (health check timed out, but process is running)');
  log(`  Try: http://localhost:${PORT}`);
  log('');
  log('  Press Ctrl+C to stop');
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  logStream.write(`\n=== FATAL ERROR ${new Date().toISOString()} ===\n${err.stack || err}\n`);
  logStream.end();
  process.exit(1);
});
