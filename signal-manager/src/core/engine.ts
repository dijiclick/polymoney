import type { Config } from '../types/config.js';
import type { UnifiedEvent } from '../types/unified-event.js';
import type { IAdapter } from '../adapters/adapter.interface.js';
import { isFilterableAdapter } from '../adapters/adapter.interface.js';
import type { PolymarketAdapter } from '../adapters/polymarket/index.js';
import { AdapterRegistry } from '../adapters/adapter-registry.js';
import { EventMatcher } from '../matching/event-matcher.js';
import { StateStore } from './state-store.js';
import { SignalDispatcher, type SignalFunction } from './signal-dispatcher.js';
import { createLogger } from '../util/logger.js';
import { recordAdapterUpdate, recordScoreChange } from '../dashboard/server.js';

const log = createLogger('engine');

export class Engine {
  private registry: AdapterRegistry;
  private matcher: EventMatcher;
  private store: StateStore;
  private signals: SignalDispatcher;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: Config;
  private polymarketAdapter: PolymarketAdapter | null = null;

  constructor(config: Config) {
    this.config = config;
    this.store = new StateStore();
    this.matcher = new EventMatcher(config.matcher);
    this.signals = new SignalDispatcher();
    this.registry = new AdapterRegistry();
  }

  registerAdapter(adapter: IAdapter): void {
    adapter.onUpdate((update) => {
      // Track adapter latency
      recordAdapterUpdate(update.sourceId, Date.now() - update.timestamp);
      // Hot path: match → update → signal
      const { eventId, canonicalLeague, swapped } = this.matcher.match(update);

      // If source reports home/away in reverse order, normalize
      if (swapped) {
        const tmpTeam = update.homeTeam;
        update.homeTeam = update.awayTeam;
        update.awayTeam = tmpTeam;
        if (update.stats?.score) {
          const tmpScore = update.stats.score.home;
          update.stats.score.home = update.stats.score.away;
          update.stats.score.away = tmpScore;
        }
        // Swap directional market keys
        update.markets = update.markets.map(m => ({
          ...m,
          key: m.key
            .replace(/\bhome\b/g, '__HOME__')
            .replace(/\baway\b/g, 'home')
            .replace(/__HOME__/g, 'away'),
        }));
      }

      const { event, changedKeys } = this.store.update(eventId, update, canonicalLeague);

      // Merge league info
      if (canonicalLeague) {
        event.canonicalLeague = canonicalLeague;
        const leagueAliases = this.matcher.getLeagueAliases(update.sport, canonicalLeague);
        for (const src in leagueAliases) {
          event.leagueAliases[src] = leagueAliases[src];
        }
      }

      // Set canonical team names — prefer Polymarket names as source of truth
      if (!event.home.name) {
        event.home.name = update.homeTeam;
        event.away.name = update.awayTeam;
      } else if (update.sourceId === 'polymarket') {
        event.home.name = update.homeTeam;
        event.away.name = update.awayTeam;
      }

      // Track score changes for speed comparison
      if (changedKeys.includes('__score') && event.stats.score) {
        recordScoreChange(update.sourceId, eventId, event.home.name || update.homeTeam, event.away.name || update.awayTeam, event.stats.score.home, event.stats.score.away);
        // Diagnostic: log score-only adapter score reports
        if (update.markets.length === 0) {
          log.debug(`⚡ Score: ${update.sourceId} | ${event.home.name || update.homeTeam} vs ${event.away.name || update.awayTeam} | ${event.stats.score.home}-${event.stats.score.away}`);
        }
      }

      if (changedKeys.length > 0) {
        this.signals.emit(event, changedKeys, update.sourceId);
      }
    });

    if (adapter.sourceId === 'polymarket') {
      this.polymarketAdapter = adapter as PolymarketAdapter;
    }

    this.registry.register(adapter);
  }

  registerSignal(fn: SignalFunction): void {
    this.signals.register(fn);
  }

  unregisterSignal(fn: SignalFunction): void {
    this.signals.unregister(fn);
  }

  async start(): Promise<void> {
    log.info('Starting engine...');
    this.cleanupTimer = setInterval(() => this.store.sweep(), this.config.cleanupIntervalMs);

    if (!this.polymarketAdapter) {
      // No Polymarket adapter — start all normally (fallback)
      log.info('No Polymarket adapter registered, starting all adapters without filtering');
      await this.registry.startAll();
      log.info('Engine started');
      return;
    }

    // Phase 1: Start Polymarket first (discovers sports markets)
    log.info('Phase 1: Starting Polymarket adapter (discovery)...');
    await this.polymarketAdapter.start();

    // Phase 2: Extract target events and distribute to filterable adapters
    const targets = this.polymarketAdapter.getTargetEvents();
    log.info(`Phase 2: Distributing ${targets.length} target events to secondary adapters`);

    for (const adapter of this.registry.getAll()) {
      if (adapter.sourceId === 'polymarket') continue;
      if (isFilterableAdapter(adapter)) {
        adapter.setTargetFilter(targets);
      }
    }

    // Phase 3: Wire periodic refresh — when PM rediscovers, propagate new targets
    this.polymarketAdapter.onTargetsUpdated((updatedTargets) => {
      log.info(`Target refresh: ${updatedTargets.length} Polymarket events, propagating to adapters`);
      for (const adapter of this.registry.getAll()) {
        if (adapter.sourceId === 'polymarket') continue;
        if (isFilterableAdapter(adapter)) {
          adapter.setTargetFilter(updatedTargets);
        }
      }
    });

    // Phase 4: Start remaining adapters (they now have target filters set)
    log.info('Phase 4: Starting secondary adapters...');
    await this.registry.startAllExcept('polymarket');

    log.info('Engine started (Polymarket-first funnel active)');
  }

  async stop(): Promise<void> {
    log.info('Stopping engine...');
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.registry.stopAll();
    log.info('Engine stopped');
  }

  // Query API
  getEvent(id: string): UnifiedEvent | undefined {
    return this.store.get(id);
  }

  getAllEvents(): UnifiedEvent[] {
    return this.store.getAll();
  }

  getAdapterStatuses(): Map<string, string> {
    return this.registry.getStatuses();
  }

  get eventCount(): number {
    return this.store.size;
  }
}
