import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { OnexbetAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import { OnexbetDiscovery, type OnexbetGameSummary } from './discovery.js';
import { OnexbetLiveFeed } from './live-feed.js';
import { normalizeGameData } from './normalizer.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('1xbet-adapter');

export class OnexbetAdapter implements IFilterableAdapter {
  readonly sourceId = 'onexbet';
  private config: OnexbetAdapterConfig;
  private discovery: OnexbetDiscovery;
  private liveFeed: OnexbetLiveFeed;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private gameIds: number[] = [];
  private targetFilter: TargetEventFilter;
  private matchedTargets: Map<number, TargetEvent> = new Map();

  constructor(config: OnexbetAdapterConfig) {
    this.config = config;
    this.discovery = new OnexbetDiscovery(config);
    this.liveFeed = new OnexbetLiveFeed(config);
    this.targetFilter = new TargetEventFilter(0.75);
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  setTargetFilter(targets: TargetEvent[]): void {
    this.targetFilter.setTargets(targets);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('1xbet adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';

    try {
      // 1. Discover live events and filter to Polymarket targets
      const allGames = await this.discovery.discoverLiveEvents();
      const filtered = this.filterGames(allGames);
      this.gameIds = filtered.map(g => g.I);
      log.info(`Discovered ${allGames.length} live games, ${filtered.length} match Polymarket targets`);

      // 2. Set up live feed handler
      this.liveFeed.onData((gameData) => {
        if (!this.callback) return;
        const summary = this.discovery.getTrackedGame(gameData.I);
        const target = this.matchedTargets.get(gameData.I);
        const update = normalizeGameData(gameData, summary, target);
        if (update) {
          this.callback(update);
        }
      });

      // 3. Start polling
      if (this.gameIds.length > 0) {
        this.liveFeed.startPolling(this.gameIds);
      }

      // 4. Re-discover events periodically (every 30s) to find new games
      this.discoveryTimer = setInterval(async () => {
        try {
          const allGames = await this.discovery.discoverLiveEvents();
          const filtered = this.filterGames(allGames);
          const newGameIds = filtered.map(g => g.I);

          const added = newGameIds.filter(id => !this.gameIds.includes(id));
          if (added.length > 0) {
            log.info(`New Polymarket-matched games: ${added.length}`);
          }

          this.gameIds = newGameIds;
          this.liveFeed.updateGameList(newGameIds);

          if (!this.liveFeed.isPolling && newGameIds.length > 0) {
            this.liveFeed.startPolling(newGameIds);
          }
        } catch (err) {
          log.warn('Discovery refresh failed', err);
        }
      }, 30_000);

      this.status = 'connected';
      log.info('1xbet adapter started');
    } catch (err) {
      log.error('Failed to start', err);
      this.status = 'error';
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    this.liveFeed.stopPolling();
    this.status = 'stopped';
    log.info('1xbet adapter stopped');
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private filterGames(games: OnexbetGameSummary[]): OnexbetGameSummary[] {
    if (this.targetFilter.targetCount === 0) {
      return games;
    }

    const filtered: OnexbetGameSummary[] = [];
    for (const game of games) {
      const result = this.targetFilter.check(game.O1, game.O2);
      if (result.matched) {
        filtered.push(game);
        if (result.targetEvent) {
          this.matchedTargets.set(game.I, result.targetEvent);
        }
      }
    }
    return filtered;
  }
}
