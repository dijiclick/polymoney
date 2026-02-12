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
      // 1. Discover live + pre-match events, filter to Polymarket targets
      const [liveGames, preMatchGames] = await Promise.all([
        this.discovery.discoverLiveEvents(),
        this.discovery.discoverPreMatchEvents(),
      ]);
      const liveFiltered = this.filterGames(liveGames);
      const preMatchFiltered = this.filterGames(preMatchGames);
      const liveIds = liveFiltered.map(g => g.I);
      const preMatchIds = preMatchFiltered.map(g => g.I);
      this.gameIds = [...liveIds, ...preMatchIds];
      // Log unmatched games for diagnosis
      const allGames = [...liveGames, ...preMatchGames];
      const unmatched = allGames.filter(g => !liveFiltered.some(f => f.I === g.I) && !preMatchFiltered.some(f => f.I === g.I));
      const sportBreakdown: Record<number, { total: number; matched: number }> = {};
      for (const g of allGames) {
        if (!sportBreakdown[g.S]) sportBreakdown[g.S] = { total: 0, matched: 0 };
        sportBreakdown[g.S].total++;
      }
      for (const g of [...liveFiltered, ...preMatchFiltered]) {
        if (sportBreakdown[g.S]) sportBreakdown[g.S].matched++;
      }
      log.info(`Discovered ${liveGames.length} live + ${preMatchGames.length} pre-match, ${liveFiltered.length}+${preMatchFiltered.length} match PM targets`);
      for (const [sid, stats] of Object.entries(sportBreakdown)) {
        if (stats.total > 0) log.info(`  Sport ${sid}: ${stats.matched}/${stats.total} matched`);
      }

      // 2. Tell live feed which IDs are pre-match (uses LineFeed URL)
      this.liveFeed.setPreMatchIds(preMatchIds);

      // 3. Set up feed handler
      this.liveFeed.onData((gameData) => {
        if (!this.callback) return;
        const summary = this.discovery.getTrackedGame(gameData.I);
        const target = this.matchedTargets.get(gameData.I);
        const update = normalizeGameData(gameData, summary, target);
        if (update) {
          this.callback(update);
        }
      });

      // 4. Start polling
      if (this.gameIds.length > 0) {
        this.liveFeed.startPolling(this.gameIds);
      }

      // 5. Re-discover events periodically (every 30s)
      this.discoveryTimer = setInterval(async () => {
        try {
          const [liveGames, preMatchGames] = await Promise.all([
            this.discovery.discoverLiveEvents(),
            this.discovery.discoverPreMatchEvents(),
          ]);
          const liveFiltered = this.filterGames(liveGames);
          const preMatchFiltered = this.filterGames(preMatchGames);
          const newLiveIds = liveFiltered.map(g => g.I);
          const newPreMatchIds = preMatchFiltered.map(g => g.I);
          const newGameIds = [...newLiveIds, ...newPreMatchIds];

          const added = newGameIds.filter(id => !this.gameIds.includes(id));
          if (added.length > 0) {
            log.info(`New PM-matched games: +${added.length} (live=${newLiveIds.length}, pre=${newPreMatchIds.length})`);
          }

          this.gameIds = newGameIds;
          this.liveFeed.setPreMatchIds(newPreMatchIds);
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
      } else if (result.score > 0.5) {
        log.debug(`Near-miss (${result.score.toFixed(2)}): 1xBet "${game.O1}" vs "${game.O2}" (sport ${game.S})`);
      }
    }
    return filtered;
  }
}
