import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { FlashScoreAdapterConfig } from '../../types/config.js';
import { FlashScoreWS, type FSLiveUpdate } from './ws-client.js';
import { fetchAllFootball, type FSMatch } from './http-client.js';
import { createLogger } from '../../util/logger.js';
import type { AdapterEventUpdate, AdapterMarketUpdate } from '../../types/adapter-update.js';

const log = createLogger('fs-adapter');

export class FlashScoreAdapter implements IAdapter {
  readonly sourceId = 'flashscore';
  private config: FlashScoreAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private ws: FlashScoreWS;
  private matchCache: Map<string, FSMatch> = new Map();
  private fullPollTimer: ReturnType<typeof setInterval> | null = null;
  private wsUpdateCount = 0;

  constructor(config: FlashScoreAdapterConfig) {
    this.config = config;
    this.ws = new FlashScoreWS();
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
    log.info('FlashScore WebSocket adapter starting');

    // HTTP full fetch first to populate match cache (names, leagues, etc.)
    await this.fullFetch();

    // Set up WebSocket for real-time push updates
    this.ws.onUpdate((updates) => this.handleWsUpdates(updates));
    this.ws.onConnect((connected) => {
      if (connected) {
        this.status = 'connected';
        log.info(`FlashScore WS connected — ${this.matchCache.size} matches in cache`);
      } else {
        this.status = 'connecting';
        log.warn('FlashScore WS disconnected, will reconnect');
      }
    });

    this.ws.connect();

    // HTTP full refresh every 120s as fallback (catch new matches, WS might miss discovery)
    this.fullPollTimer = setInterval(() => this.fullFetch(), 120000);

    log.info(`FlashScore adapter started — ${this.matchCache.size} matches cached`);
  }

  async stop(): Promise<void> {
    this.ws.disconnect();
    if (this.fullPollTimer) { clearInterval(this.fullPollTimer); this.fullPollTimer = null; }
    this.status = 'stopped';
    log.info(`FlashScore adapter stopped (processed ${this.wsUpdateCount} WS updates)`);
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private handleWsUpdates(updates: FSLiveUpdate[]): void {
    for (const u of updates) {
      this.wsUpdateCount++;
      const cached = this.matchCache.get(u.matchId);

      // Build/merge match object
      const match: FSMatch = {
        id: u.matchId,
        home: u.home || cached?.home || '',
        away: u.away || cached?.away || '',
        homeScore: u.homeScore ?? cached?.homeScore ?? null,
        awayScore: u.awayScore ?? cached?.awayScore ?? null,
        minute: u.minute || cached?.minute || '',
        status: this.parseStatus(u.statusCode) || cached?.status || 'unknown',
        league: u.league || cached?.league || '',
        country: u.country || cached?.country || '',
        startTime: u.startTime || cached?.startTime || null,
      };

      // Detect goals
      if (cached && (match.homeScore !== cached.homeScore || match.awayScore !== cached.awayScore)) {
        if (match.homeScore !== null && match.awayScore !== null) {
          log.info(`⚽ GOAL! ${match.home} ${match.homeScore}:${match.awayScore} ${match.away} (${match.minute}')`);
        }
      }

      if (u.isRedCard) {
        log.info(`🟥 RED CARD in ${match.home} vs ${match.away} (${match.minute}')`);
      }

      this.matchCache.set(u.matchId, match);

      // Only emit live matches
      if (match.status === 'live' && match.home && match.away) {
        this.emitMatch(match);
      }
    }
  }

  private parseStatus(code?: string): FSMatch['status'] | null {
    if (!code) return null;
    if (code === '2' || code === '3') return 'live';
    if (code === '4' || code === '11') return 'finished';
    if (code === '1') return 'scheduled';
    return null;
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

      log.info(`FlashScore HTTP: ${matches.length} total, ${liveCount} live`);
    } catch (err: any) {
      log.warn(`FlashScore HTTP fetch failed: ${err.message}`);
    }
  }

  private emitMatch(m: FSMatch): void {
    if (!this.callback || !m.home || !m.away) return;

    const markets: AdapterMarketUpdate[] = [];

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
