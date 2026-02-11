import { Engine } from './core/engine.js';
import { PolymarketAdapter } from './adapters/polymarket/index.js';
import { OnexbetAdapter } from './adapters/onexbet/index.js';
import { FlashScoreAdapter } from './adapters/flashscore/index.js';
import { Dashboard } from './dashboard/server.js';
import { DEFAULT_CONFIG } from '../config/default.js';
import { setLogLevel, createLogger } from './util/logger.js';
import { oddsDivergenceSignal, scoreChangeSignal, staleOddsSignal } from './signals/index.js';
import { tradingSignal, scoreTradeSignal } from './signals/trading.js';
import { reactionTimerSignal } from './signals/reaction-timer.js';
import { TradingBot } from './trading/bot.js';
import { TradingController } from './trading/controller.js';
import type { SignalFunction } from './core/signal-dispatcher.js';

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
  const tradingBot = new TradingBot({
    privateKey: process.env.POLY_PRIVATE_KEY || '',
    funderAddress: process.env.POLY_FUNDER_ADDRESS || '',
    signatureType: parseInt(process.env.POLY_SIGNATURE_TYPE || '0') as 0 | 1 | 2,
    armed: false, // Always start disarmed
    minTradeSize: 1.0,
    maxTradeSize: 5.0,
  });

  const tradingController = new TradingController(tradingBot, engine);

  if (process.env.POLY_PRIVATE_KEY) {
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
