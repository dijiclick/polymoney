import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { OnexbetAdapterConfig } from '../../types/config.js';
import { OnexbetDiscovery } from './discovery.js';
import { OnexbetLiveFeed } from './live-feed.js';
import { normalizeGameData } from './normalizer.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('1xbet-adapter');

export class OnexbetAdapter implements IAdapter {
  readonly sourceId = 'onexbet';
  private config: OnexbetAdapterConfig;
  private discovery: OnexbetDiscovery;
  private liveFeed: OnexbetLiveFeed;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private gameIds: number[] = [];

  constructor(config: OnexbetAdapterConfig) {
    this.config = config;
    this.discovery = new OnexbetDiscovery(config);
    this.liveFeed = new OnexbetLiveFeed(config);
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('1xbet adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';

    try {
      // 1. Discover live events
      const games = await this.discovery.discoverLiveEvents();
      this.gameIds = games.map(g => g.I);
      log.info(`Discovered ${games.length} live games`);

      // 2. Set up live feed handler
      this.liveFeed.onData((gameData) => {
        if (!this.callback) return;
        const summary = this.discovery.getTrackedGame(gameData.I);
        const update = normalizeGameData(gameData, summary);
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
          const games = await this.discovery.discoverLiveEvents();
          const newGameIds = games.map(g => g.I);

          // Check for new games
          const added = newGameIds.filter(id => !this.gameIds.includes(id));
          if (added.length > 0) {
            log.info(`New live games discovered: ${added.length}`);
          }

          this.gameIds = newGameIds;
          this.liveFeed.updateGameList(newGameIds);

          // Restart polling if needed
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
}
