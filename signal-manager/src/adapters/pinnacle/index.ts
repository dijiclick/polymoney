/**
 * Pinnacle Adapter — Free REST API, sharpest odds
 * No auth, ~340-500ms latency. Scores are SLOW — use for odds only
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { PinnacleAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { encodeThreshold } from '../../types/market-keys.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('pinnacle');

const SPORT_MAP: Record<number, string> = {
  29: 'soccer', 4: 'basketball', 33: 'tennis', 19: 'ice_hockey',
  12: 'esports', 5: 'baseball', 15: 'american_football', 9: 'cricket', 22: 'mma',
};

export class PinnacleAdapter implements IFilterableAdapter {
  readonly sourceId = 'pinnacle';
  private config: PinnacleAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private targetFilter: TargetEventFilter;
  private matchedEvents: Map<number, { home: string; away: string; sport: string; league: string }> = new Map();

  constructor(config: PinnacleAdapterConfig) {
    this.config = config;
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void { this.targetFilter.setTargets(targets); }
  onUpdate(callback: UpdateCallback): void { this.callback = callback; }
  getStatus(): AdapterStatus { return this.status; }

  async start(): Promise<void> {
    this.status = 'connecting';
    log.info('Starting Pinnacle adapter...');
    await this.poll();
    this.status = 'connected';
    this.scheduleNext();
    log.info(`Pinnacle adapter running (${this.config.pollIntervalMs}ms poll, rotating brandId cache-bust)`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.status = 'stopped';
    log.info('Pinnacle adapter stopped');
  }

  private scheduleNext(): void {
    this.pollTimer = setTimeout(async () => {
      try { await this.poll(); } catch (e: any) { log.error('Poll error:', e.message); }
      if (this.status !== 'stopped') this.scheduleNext();
    }, this.config.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    for (const sportId of this.config.sportIds) {
      await this.pollSport(sportId);
    }
    if (this.matchedEvents.size > 0) await this.pollOdds();
  }

  private randBrandId(): number { return Math.floor(Math.random() * 1000) + 1; }

  private async pollSport(sportId: number): Promise<void> {
    try {
      const resp = await fetch(
        `${this.config.baseUrl}/sports/${sportId}/matchups/live?withSpecials=false&brandId=${this.randBrandId()}`,
        { headers: { 'Accept': 'application/json', 'X-Api-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R' },
          signal: AbortSignal.timeout(this.config.timeoutMs || 5000) }
      );
      if (!resp.ok) return;
      const matchups = await resp.json() as any[];
      if (!Array.isArray(matchups)) return;
      this.status = 'connected';
      const sport = SPORT_MAP[sportId] || 'unknown';

      for (const m of matchups) {
        if (!m.parent?.participants || m.parent.participants.length < 2 || m.type !== 'matchup') continue;
        const home = m.parent.participants[0]?.name || '';
        const away = m.parent.participants[1]?.name || '';
        if (!home || !away) continue;
        const filterResult = this.targetFilter.check(home, away);
        if (!filterResult.matched) continue;
        const matchupId = m.id;
        const league = m.league?.name || '';
        this.matchedEvents.set(matchupId, { home, away, sport, league });

        const p0 = m.parent.participants[0];
        const p1 = m.parent.participants[1];
        const hasScore = p0?.state?.score !== undefined && p1?.state?.score !== undefined;

        const update: AdapterEventUpdate = {
          sourceId: this.sourceId,
          sourceEventId: `pinnacle_${matchupId}`,
          sport, league,
          startTime: m.startTime ? new Date(m.startTime).getTime() : 0,
          homeTeam: home, awayTeam: away,
          status: 'live',
          stats: {
            ...(hasScore ? { score: { home: parseInt(p0.state.score) || 0, away: parseInt(p1.state.score) || 0 } } : {}),
          },
          markets: [],
          timestamp: Date.now(),
        };
        if (this.callback) this.callback(update);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') log.debug(`Pinnacle sport ${sportId} failed:`, err.message);
    }
  }

  private async pollOdds(): Promise<void> {
    for (const sportId of this.config.sportIds) {
      try {
        const resp = await fetch(
          `${this.config.baseUrl}/sports/${sportId}/markets/live/straight?primaryOnly=true&withSpecials=false&brandId=${this.randBrandId()}`,
          { headers: { 'Accept': 'application/json', 'X-Api-Key': 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R' },
            signal: AbortSignal.timeout(this.config.timeoutMs || 5000) }
        );
        if (!resp.ok) continue;
        const markets = await resp.json() as any[];
        if (!Array.isArray(markets)) continue;

        for (const market of markets) {
          const meta = this.matchedEvents.get(market.matchupId);
          if (!meta || !market.prices) continue;
          const odds: AdapterEventUpdate['markets'] = [];
          for (const price of market.prices) {
            const key = this.mapMarketKey(market.type, price.designation, price.points);
            if (key && price.price) odds.push({ key, value: this.americanToDecimal(price.price) });
          }
          if (odds.length > 0 && this.callback) {
            this.callback({
              sourceId: this.sourceId, sourceEventId: `pinnacle_${market.matchupId}`,
              sport: meta.sport, league: meta.league, startTime: 0,
              homeTeam: meta.home, awayTeam: meta.away, status: 'live',
              stats: {}, markets: odds, timestamp: Date.now(),
            });
          }
        }
      } catch { /* skip */ }
    }
  }

  private mapMarketKey(type: string, designation: string, points?: number): string | null {
    if (type === 'moneyline') {
      if (designation === 'home') return 'ml_home_ft';
      if (designation === 'away') return 'ml_away_ft';
      if (designation === 'draw') return 'draw_ft';
    }
    if (type === 'total' && points !== undefined) {
      const t = encodeThreshold(points);
      if (designation === 'over') return `o_${t}_ft`;
      if (designation === 'under') return `u_${t}_ft`;
    }
    if (type === 'spread' && points !== undefined) {
      const t = encodeThreshold(points);
      if (designation === 'home') return `handicap_home_${t}_ft`;
      if (designation === 'away') return `handicap_away_${t}_ft`;
    }
    return null;
  }

  private americanToDecimal(american: number): number {
    if (american > 0) return (american / 100) + 1;
    if (american < 0) return (100 / Math.abs(american)) + 1;
    return 1;
  }
}
