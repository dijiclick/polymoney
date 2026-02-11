import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { FlashScoreAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import { FlashScoreWS, type FSLiveUpdate } from './ws-client.js';
import { fetchAllFootball, type FSMatch } from './http-client.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';
import type { AdapterEventUpdate, AdapterMarketUpdate } from '../../types/adapter-update.js';

const log = createLogger('fs-adapter');

export class FlashScoreAdapter implements IFilterableAdapter {
  readonly sourceId = 'flashscore';
  private config: FlashScoreAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private ws: FlashScoreWS;
  private matchCache: Map<string, FSMatch> = new Map();
  private fullPollTimer: ReturnType<typeof setInterval> | null = null;
  private wsUpdateCount = 0;
  private targetFilter: TargetEventFilter;
  private allowedMatchIds: Set<string> = new Set();
  private matchedTargets: Map<string, TargetEvent> = new Map();

  constructor(config: FlashScoreAdapterConfig) {
    this.config = config;
    this.ws = new FlashScoreWS();
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void {
    this.targetFilter.setTargets(targets);
    this.rebuildAllowedSet();
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

    // Rebuild allowed set now that match cache is populated
    this.rebuildAllowedSet();

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

    log.info(`FlashScore adapter started — ${this.matchCache.size} matches cached, ${this.allowedMatchIds.size} match Polymarket targets`);
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

  private rebuildAllowedSet(): void {
    this.allowedMatchIds.clear();
    this.matchedTargets.clear();
    if (this.targetFilter.targetCount === 0) return; // empty = allow all

    for (const [id, m] of this.matchCache) {
      if (m.home && m.away) {
        const result = this.targetFilter.check(m.home, m.away);
        if (result.matched) {
          this.allowedMatchIds.add(id);
          if (result.targetEvent) {
            this.matchedTargets.set(id, result.targetEvent);
          }
        }
      }
    }
    log.info(`Rebuilt allowed set: ${this.allowedMatchIds.size}/${this.matchCache.size} matches pass filter`);
  }

  private isAllowed(matchId: string, home: string, away: string): boolean {
    if (this.targetFilter.targetCount === 0) return true; // no filter = allow all
    if (this.allowedMatchIds.has(matchId)) return true;

    // New match not in cache yet — check dynamically
    const result = this.targetFilter.check(home, away);
    if (result.matched) {
      this.allowedMatchIds.add(matchId);
      if (result.targetEvent) {
        this.matchedTargets.set(matchId, result.targetEvent);
      }
      return true;
    }
    return false;
  }

  private emitMatch(m: FSMatch): void {
    if (!this.callback || !m.home || !m.away) return;
    if (!this.isAllowed(m.id, m.home, m.away)) return;

    const markets: AdapterMarketUpdate[] = [];

    if (m.homeScore !== null && m.awayScore !== null) {
      markets.push({ key: '__score', value: m.homeScore * 100 + m.awayScore });
    }

    // Use Polymarket target metadata when available for consistent event matching
    const target = this.matchedTargets.get(m.id);

    const update: AdapterEventUpdate = {
      sourceId: 'flashscore',
      sourceEventId: m.id,
      sport: target?.sport || 'football',
      league: target?.league || m.league || '',
      startTime: target?.startTime || m.startTime || 0,
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
