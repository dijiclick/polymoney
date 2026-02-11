import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { PolymarketAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import { PolymarketDiscovery } from './discovery.js';
import { ClobWebSocket } from './clob-ws.js';
import { ScoresWebSocket } from './scores-ws.js';
import { normalizePriceChange, normalizeScoreUpdate } from './normalizer.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('pm-adapter');

export class PolymarketAdapter implements IAdapter {
  readonly sourceId = 'polymarket';
  private config: PolymarketAdapterConfig;
  private discovery: PolymarketDiscovery;
  private clobWs: ClobWebSocket;
  private scoresWs: ScoresWebSocket;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private onTargetsUpdatedFn: ((targets: TargetEvent[]) => void) | null = null;

  constructor(config: PolymarketAdapterConfig) {
    this.config = config;
    this.discovery = new PolymarketDiscovery(config);
    this.clobWs = new ClobWebSocket(config.clobWsUrl, config.pingIntervalMs);
    this.scoresWs = new ScoresWebSocket(config.scoresWsUrl);
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('Polymarket adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';

    // 1. Discover sports markets
    const tokenMap = await this.discovery.discover();
    const tokenIds = this.discovery.getAllTokenIds();

    if (tokenIds.length === 0) {
      log.warn('No sports tokens found');
      this.status = 'connected'; // Still connected, just no data
      return;
    }

    // 2. Set up CLOB WS price handler
    this.clobWs.onPriceChange((tokenId, priceData, timestamp) => {
      if (!this.callback) return;
      const mapping = this.discovery.getTokenMapping(tokenId);
      if (!mapping) return;

      const update = normalizePriceChange(mapping, priceData.midpoint, timestamp);
      this.callback(update);
    });

    // 3. Set up Scores WS handler
    this.scoresWs.onScoreUpdate((scoreUpdate) => {
      if (!this.callback) return;

      // Try to find matching event in our token map by team names
      // This is a simple linear scan — acceptable since score updates are infrequent
      const eventMapping = this.findEventByTeams(scoreUpdate.homeTeam, scoreUpdate.awayTeam);
      const update = normalizeScoreUpdate(scoreUpdate, eventMapping);
      if (update) {
        this.callback(update);
      }
    });

    // 4. Connect both WebSockets
    try {
      await Promise.all([
        this.clobWs.connect(tokenIds),
        this.scoresWs.connect(),
      ]);
      this.status = 'connected';
      log.info(`Polymarket adapter started: ${tokenIds.length} tokens subscribed`);
    } catch (err) {
      log.error('Failed to connect', err);
      this.status = 'error';
      throw err;
    }

    // 5. Periodic discovery refresh for new markets
    this.discovery.startPeriodicRefresh(
      (newTokens) => {
        this.clobWs.subscribe(newTokens);
      },
      (targets) => {
        this.onTargetsUpdatedFn?.(targets);
      },
    );
  }

  getTargetEvents(): TargetEvent[] {
    return this.discovery.getTargetEvents();
  }

  onTargetsUpdated(fn: (targets: TargetEvent[]) => void): void {
    this.onTargetsUpdatedFn = fn;
  }

  async stop(): Promise<void> {
    this.discovery.stopPeriodicRefresh();
    this.clobWs.close();
    this.scoresWs.close();
    this.status = 'stopped';
    log.info('Polymarket adapter stopped');
  }

  getStatus(): AdapterStatus {
    if (this.status === 'stopped' || this.status === 'idle') return this.status;
    // Return worst status of the two connections
    if (!this.clobWs.connected && !this.scoresWs.connected) return 'error';
    if (!this.clobWs.connected || !this.scoresWs.connected) return 'reconnecting';
    return 'connected';
  }

  private findEventByTeams(
    homeTeam: string,
    awayTeam: string
  ): { sport: string; homeTeam: string; awayTeam: string; startTime: number; eventId: string } | null {
    const homeLower = homeTeam.toLowerCase();
    const awayLower = awayTeam.toLowerCase();

    // Scan token map for matching teams
    for (const mapping of this.discovery['tokenMap'].values()) {
      if (
        mapping.homeTeam.toLowerCase().includes(homeLower) ||
        homeLower.includes(mapping.homeTeam.toLowerCase())
      ) {
        if (
          mapping.awayTeam.toLowerCase().includes(awayLower) ||
          awayLower.includes(mapping.awayTeam.toLowerCase())
        ) {
          return {
            sport: mapping.sport,
            homeTeam: mapping.homeTeam,
            awayTeam: mapping.awayTeam,
            startTime: mapping.startTime,
            eventId: mapping.eventId,
          };
        }
      }
    }
    return null;
  }
}
