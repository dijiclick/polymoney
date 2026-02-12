import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './core/engine.js';
import { PolymarketAdapter } from './adapters/polymarket/index.js';
import { OnexbetAdapter } from './adapters/onexbet/index.js';
import { FlashScoreAdapter } from './adapters/flashscore/index.js';
import { Dashboard } from './dashboard/server.js';
import { DEFAULT_CONFIG } from '../config/default.js';
import { setLogLevel, createLogger } from './util/logger.js';
import { oddsDivergenceSignal, scoreChangeSignal, staleOddsSignal } from './signals/index.js';
import { tradingSignal, scoreTradeSignal, setOpportunityCallback } from './signals/trading.js';
import { reactionTimerSignal } from './signals/reaction-timer.js';
import { TradingBot } from './trading/bot.js';
import { TradingController } from './trading/controller.js';
import { GoalTrader } from './trading/goal-trader.js';
import type { SignalFunction } from './core/signal-dispatcher.js';

// Load .env file (no dotenv dependency needed)
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, '..', '..', '.env');
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
} catch { /* no .env file */ }

const log = createLogger('main');

// Dev signal: log updates
const devSignal: SignalFunction = (event, changedKeys, source) => {
  if (changedKeys.length === 0) return;
  const marketSummary = changedKeys.filter(k => !k.startsWith('__')).slice(0, 3).map(key => {
    const sources = event.markets[key];
    if (!sources) return `${key}: (no data)`;
    const vals = Object.entries(sources)
      .map(([src, odds]) => `${src}=${odds.value.toFixed(3)}`)
      .join(', ');
    return `${key}: ${vals}`;
  }).join(' | ');

  if (marketSummary) {
    log.info(
      `[${source}] ${event.home.aliases[source] || event.home.name} vs ${event.away.aliases[source] || event.away.name} | ${marketSummary}${changedKeys.length > 3 ? ` (+${changedKeys.length - 3} more)` : ''}`
    );
  }
};

async function main() {
  const config = DEFAULT_CONFIG;
  setLogLevel(config.logLevel);

  log.info('Signal Manager v2 starting...');
  log.info(`Adapters: Polymarket=${config.adapters.polymarket.enabled}, 1xBet=${config.adapters.onexbet.enabled}, FlashScore=${config.adapters.flashscore.enabled}`);

  // Create engine
  const engine = new Engine(config);

  // Register signals
  engine.registerSignal(devSignal);
  engine.registerSignal(oddsDivergenceSignal);
  engine.registerSignal(scoreChangeSignal);
  engine.registerSignal(staleOddsSignal);
  engine.registerSignal(tradingSignal);
  engine.registerSignal(scoreTradeSignal);
  engine.registerSignal(reactionTimerSignal);

  // Register adapters
  if (config.adapters.polymarket.enabled) {
    engine.registerAdapter(new PolymarketAdapter(config.adapters.polymarket));
  }
  if (config.adapters.onexbet.enabled) {
    engine.registerAdapter(new OnexbetAdapter(config.adapters.onexbet));
  }
  if (config.adapters.flashscore.enabled) {
    engine.registerAdapter(new FlashScoreAdapter(config.adapters.flashscore));
  }

  // Initialize trading bot (disabled by default — needs credentials in env)
  const polyKey = process.env.POLY_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY || '';
  const tradingBot = new TradingBot({
    privateKey: polyKey,
    funderAddress: process.env.POLY_FUNDER_ADDRESS || '',
    signatureType: parseInt(process.env.POLY_SIGNATURE_TYPE || '0') as 0 | 1 | 2,
    armed: false, // Always start disarmed
    minTradeSize: 1.0,
    maxTradeSize: 1.0,
  });

  const tradingController = new TradingController(tradingBot, engine);

  // Wire auto-trade pipeline: new opportunities → controller.handleSignal
  setOpportunityCallback((opp) => tradingController.handleSignal(opp));

  // Initialize GoalTrader (auto buy on goal + smart exit)
  const goalTrader = new GoalTrader(tradingBot, {
    enabled: false,  // Must be explicitly enabled via command
    sizeLarge: 1.0,
    sizeMedium: 1.0,
    sizeSmall: 1.0,
  });
  engine.registerSignal(goalTrader.signalHandler);
  goalTrader.start();
  tradingController.setGoalTrader(goalTrader);

  if (polyKey) {
    const ok = await tradingBot.initialize();
    if (ok) log.info('Trading bot initialized (DISARMED)');
    else log.warn('Trading bot failed to initialize');
  } else {
    log.info('Trading bot: no POLY_PRIVATE_KEY set — trading disabled');
  }

  // Start dashboard
  let dashboard: Dashboard | null = null;
  if (config.dashboard.enabled) {
    dashboard = new Dashboard(engine, config.dashboard);
    dashboard.setTradingController(tradingController);
    await dashboard.start();
  }

  // Start engine
  await engine.start();

  // Status report every 30s
  const statusTimer = setInterval(() => {
    const statuses = engine.getAdapterStatuses();
    const statusStr = Array.from(statuses.entries())
      .map(([id, s]) => `${id}=${s}`)
      .join(', ');
    log.info(`Status: ${statusStr} | Events: ${engine.eventCount}`);
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(statusTimer);
    if (dashboard) await dashboard.stop();
    await engine.stop();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err);
  });
  process.on('unhandledRejection', (err) => {
    log.error('Unhandled rejection', err);
  });

  log.info('Signal Manager running. Press Ctrl+C to stop.');
  if (config.dashboard.enabled) {
    log.info(`Dashboard: http://0.0.0.0:${config.dashboard.port}`);
  }
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});

// Exports
export { Engine } from './core/engine.js';
export { PolymarketAdapter } from './adapters/polymarket/index.js';
export { OnexbetAdapter } from './adapters/onexbet/index.js';
export { FlashScoreAdapter } from './adapters/flashscore/index.js';
export { Dashboard } from './dashboard/server.js';
export type { SignalFunction } from './core/signal-dispatcher.js';
export type { UnifiedEvent } from './types/unified-event.js';
export type { AdapterEventUpdate } from './types/adapter-update.js';
export type { IAdapter } from './adapters/adapter.interface.js';
export type { Config } from './types/config.js';
