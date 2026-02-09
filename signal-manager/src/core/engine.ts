import type { Config } from '../types/config.js';
import type { UnifiedEvent } from '../types/unified-event.js';
import type { IAdapter } from '../adapters/adapter.interface.js';
import { AdapterRegistry } from '../adapters/adapter-registry.js';
import { EventMatcher } from '../matching/event-matcher.js';
import { StateStore } from './state-store.js';
import { SignalDispatcher, type SignalFunction } from './signal-dispatcher.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('engine');

export class Engine {
  private registry: AdapterRegistry;
  private matcher: EventMatcher;
  private store: StateStore;
  private signals: SignalDispatcher;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.store = new StateStore();
    this.matcher = new EventMatcher(config.matcher);
    this.signals = new SignalDispatcher();
    this.registry = new AdapterRegistry();
  }

  registerAdapter(adapter: IAdapter): void {
    adapter.onUpdate((update) => {
      // Hot path: match → update → signal
      const eventId = this.matcher.match(update);
      const { event, changedKeys } = this.store.update(eventId, update);

      // Set canonical team names from matcher resolution
      if (!event.home.name && event.home.aliases[update.sourceId]) {
        const parts = eventId.split(':');
        const teams = parts[parts.length - 1].split('_vs_');
        if (teams.length === 2) {
          event.home.name = teams[0];
          event.away.name = teams[1];
        }
      }

      if (changedKeys.length > 0) {
        this.signals.emit(event, changedKeys, update.sourceId);
      }
    });
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
    await this.registry.startAll();
    log.info('Engine started');
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
