import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { FlashScoreAdapterConfig } from '../../types/config.js';
import { fetchAllFootball, fetchLiveUpdates, type FSMatch } from './http-client.js';
import { createLogger } from '../../util/logger.js';
import type { AdapterEventUpdate, AdapterMarketUpdate } from '../../types/adapter-update.js';

const log = createLogger('fs-adapter');

export class FlashScoreAdapter implements IAdapter {
  readonly sourceId = 'flashscore';
  private config: FlashScoreAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private fullPollTimer: ReturnType<typeof setInterval> | null = null;
  private matchCache: Map<string, FSMatch> = new Map();
  private lastLiveCount = 0;

  constructor(config: FlashScoreAdapterConfig) {
    this.config = config;
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('FlashScore adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';
    log.info('FlashScore HTTP adapter starting (no Playwright)');

    // Full fetch on start
    await this.fullFetch();
    this.status = 'connected';

    // Live updates every 2s (fast, small payload ~1KB)
    this.pollTimer = setInterval(async () => {
      await this.livePoll();
    }, 2000);

    // Full refresh every 60s (bigger payload ~400KB, gets new matches)
    this.fullPollTimer = setInterval(async () => {
      await this.fullFetch();
    }, 60000);

    log.info(`FlashScore adapter started — ${this.matchCache.size} matches cached, ${this.lastLiveCount} live`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.fullPollTimer) { clearInterval(this.fullPollTimer); this.fullPollTimer = null; }
    this.status = 'stopped';
    log.info('FlashScore adapter stopped');
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private async fullFetch(): Promise<void> {
    try {
      const matches = await fetchAllFootball();
      let liveCount = 0;

      for (const m of matches) {
        this.matchCache.set(m.id, m);
        if (m.status === 'live') {
          liveCount++;
          this.emitMatch(m);
        }
      }

      this.lastLiveCount = liveCount;
      log.info(`FlashScore full: ${matches.length} total, ${liveCount} live`);
    } catch (err: any) {
      log.warn(`FlashScore full fetch failed: ${err.message}`);
    }
  }

  private async livePoll(): Promise<void> {
    try {
      const updates = await fetchLiveUpdates();
      for (const u of updates) {
        const cached = this.matchCache.get(u.id);
        
        // Merge with cached data (delta updates may be partial)
        if (cached) {
          const merged: FSMatch = {
            ...cached,
            homeScore: u.homeScore ?? cached.homeScore,
            awayScore: u.awayScore ?? cached.awayScore,
            minute: u.minute || cached.minute,
            status: u.status !== 'unknown' ? u.status : cached.status,
          };
          
          // Detect score change
          if (merged.homeScore !== cached.homeScore || merged.awayScore !== cached.awayScore) {
            log.info(`⚽ GOAL! ${merged.home} ${merged.homeScore}:${merged.awayScore} ${merged.away} (${merged.minute}')`);
          }
          
          this.matchCache.set(u.id, merged);
          this.emitMatch(merged);
        }
      }
    } catch (err: any) {
      // Silent on transient errors
    }
  }

  private emitMatch(m: FSMatch): void {
    if (!this.callback || !m.home || !m.away) return;

    const markets: AdapterMarketUpdate[] = [];

    // Emit score as a special market key
    if (m.homeScore !== null && m.awayScore !== null) {
      markets.push({ key: '__score', value: m.homeScore * 100 + m.awayScore });
    }

    const update: AdapterEventUpdate = {
      sourceId: 'flashscore',
      sourceEventId: m.id,
      sport: 'football',
      league: m.league || '',
      startTime: m.startTime || 0,
      homeTeam: m.home,
      awayTeam: m.away,
      status: m.status === 'live' ? 'live' : (m.status === 'finished' ? 'ended' : 'scheduled'),
      stats: {
        score: m.homeScore !== null ? { home: m.homeScore, away: m.awayScore || 0 } : undefined,
        elapsed: m.minute || undefined,
      },
      markets,
      timestamp: Date.now(),
    };

    this.callback(update);
  }
}
