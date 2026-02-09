import { Engine } from './core/engine.js';
import { PolymarketAdapter } from './adapters/polymarket/index.js';
import { OnexbetAdapter } from './adapters/onexbet/index.js';
import { DEFAULT_CONFIG } from '../config/default.js';
import { setLogLevel, createLogger } from './util/logger.js';
import type { SignalFunction } from './core/signal-dispatcher.js';

const log = createLogger('main');

// Default signal: log updates in dev mode
const devSignal: SignalFunction = (event, changedKeys, source) => {
  if (changedKeys.length === 0) return;
  const marketSummary = changedKeys.slice(0, 3).map(key => {
    const sources = event.markets[key];
    if (!sources) return `${key}: (no data)`;
    const vals = Object.entries(sources)
      .map(([src, odds]) => `${src}=${odds.value.toFixed(3)}`)
      .join(', ');
    return `${key}: ${vals}`;
  }).join(' | ');

  log.info(
    `[${source}] ${event.home.aliases[source] || event.home.name} vs ${event.away.aliases[source] || event.away.name} | ${marketSummary}${changedKeys.length > 3 ? ` (+${changedKeys.length - 3} more)` : ''}`
  );
};

async function main() {
  const config = DEFAULT_CONFIG;
  setLogLevel(config.logLevel);

  log.info('Signal Manager starting...');
  log.info(`Config: Polymarket=${config.adapters.polymarket.enabled}, 1xbet=${config.adapters.onexbet.enabled}`);

  // Create engine
  const engine = new Engine(config);

  // Register signal (placeholder — replace with real signals later)
  engine.registerSignal(devSignal);

  // Register adapters
  if (config.adapters.polymarket.enabled) {
    engine.registerAdapter(new PolymarketAdapter(config.adapters.polymarket));
  }
  if (config.adapters.onexbet.enabled) {
    engine.registerAdapter(new OnexbetAdapter(config.adapters.onexbet));
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
    await engine.stop();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info('Signal Manager running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});

// Export for programmatic use
export { Engine } from './core/engine.js';
export { PolymarketAdapter } from './adapters/polymarket/index.js';
export { OnexbetAdapter } from './adapters/onexbet/index.js';
export type { SignalFunction } from './core/signal-dispatcher.js';
export type { UnifiedEvent } from './types/unified-event.js';
export type { AdapterEventUpdate } from './types/adapter-update.js';
export type { IAdapter } from './adapters/adapter.interface.js';
export type { Config } from './types/config.js';
