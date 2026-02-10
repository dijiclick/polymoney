import { Engine } from './core/engine.js';
import { PolymarketAdapter } from './adapters/polymarket/index.js';
import { OnexbetAdapter } from './adapters/onexbet/index.js';
import { FlashScoreAdapter } from './adapters/flashscore/index.js';
import { Dashboard } from './dashboard/server.js';
import { DEFAULT_CONFIG } from '../config/default.js';
import { setLogLevel, createLogger } from './util/logger.js';
import { oddsDivergenceSignal, scoreChangeSignal, staleOddsSignal } from './signals/index.js';
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

  // Start dashboard
  let dashboard: Dashboard | null = null;
  if (config.dashboard.enabled) {
    dashboard = new Dashboard(engine, config.dashboard);
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
