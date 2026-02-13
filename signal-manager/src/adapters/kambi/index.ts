/**
 * Kambi/Unibet Adapter — HTTP polling, FASTEST free live score source
 * No auth, ~140-190ms latency per request
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { KambiAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('kambi');

const SPORT_MAP: Record<string, string> = {
  'football': 'soccer', 'tennis': 'tennis', 'basketball': 'basketball',
  'ice_hockey': 'ice_hockey', 'american_football': 'american_football',
  'baseball': 'baseball', 'mma': 'mma', 'esports': 'esports',
};

export class KambiAdapter implements IFilterableAdapter {
  readonly sourceId = 'kambi';
  private config: KambiAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private targetFilter: TargetEventFilter;
  private knownEvents: Map<number, string> = new Map();

  constructor(config: KambiAdapterConfig) {
    this.config = config;
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void { this.targetFilter.setTargets(targets); }
  onUpdate(callback: UpdateCallback): void { this.callback = callback; }
  getStatus(): AdapterStatus { return this.status; }

  async start(): Promise<void> {
    this.status = 'connecting';
    log.info('Starting Kambi adapter...');
    await this.poll();
    this.status = 'connected';
    this.pollTimer = setInterval(() => this.poll().catch(e => log.error('Poll error:', e.message)), this.config.pollIntervalMs);
    log.info(`Kambi adapter running (${this.config.pollIntervalMs}ms poll)`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.status = 'stopped';
    log.info('Kambi adapter stopped');
  }

  private async poll(): Promise<void> {
    try {
      const sports = ['football', 'basketball', 'tennis', 'ice_hockey', 'esports'];
      let events: any[] = [];
      for (const sport of sports) {
        try {
          const resp = await fetch(
            `${this.config.baseUrl}/offering/v2018/ub/listView/${sport}/all/all/all/in-play.json?lang=en_GB&market=GB&ncid=${Date.now()}`,
            { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(this.config.timeoutMs || 8000) }
          );
          if (!resp.ok) continue;
          const data = await resp.json() as any;
          if (data?.events) events = events.concat(data.events);
        } catch { /* skip */ }
      }
      this.status = 'connected';
      for (const ev of events) {
        const update = this.parseEvent(ev);
        if (update && this.callback) this.callback(update);
      }
    } catch (err: any) {
      log.error('Kambi poll failed:', err.message);
      if (this.status === 'connected') this.status = 'reconnecting';
    }
  }

  private parseEvent(ev: any): AdapterEventUpdate | null {
    const event = ev.event;
    if (!event) return null;
    const delimiter = event.nameDelimiter || ' - ';
    const parts = (event.name || '').split(delimiter);
    if (parts.length < 2) return null;
    const homeTeam = (event.homeName || parts[0] || '').trim();
    const awayTeam = (event.awayName || parts[1] || '').trim();
    if (!homeTeam || !awayTeam) return null;

    const filterResult = this.targetFilter.check(homeTeam, awayTeam);
    if (!filterResult.matched) return null;
    this.knownEvents.set(event.id, `${homeTeam}:${awayTeam}`);

    const sportPath = (event.path?.[0]?.name || '').toLowerCase().replace(/ /g, '_');
    const sport = SPORT_MAP[sportPath] || sportPath;
    const league = event.path?.slice(1).map((p: any) => p.name).join(' > ') || '';

    const markets: AdapterEventUpdate['markets'] = [];
    if (ev.betOffers) {
      for (const offer of ev.betOffers) {
        if (!offer.outcomes) continue;
        for (const outcome of offer.outcomes) {
          if (outcome.odds) {
            const key = this.marketKey(offer, outcome, homeTeam, awayTeam);
            markets.push({ key, value: outcome.odds / 1000 });
          }
        }
      }
    }

    const score = ev.liveData?.score;
    const matchClock = ev.liveData?.matchClock;

    return {
      sourceId: this.sourceId,
      sourceEventId: `kambi_${event.id}`,
      sport, league,
      startTime: new Date(event.start).getTime(),
      homeTeam, awayTeam,
      status: event.state === 'STARTED' ? 'live' : event.state === 'FINISHED' ? 'ended' : 'scheduled',
      stats: {
        ...(score ? { score: { home: parseInt(score.home) || 0, away: parseInt(score.away) || 0 } } : {}),
        ...(matchClock ? { elapsed: `${matchClock.minute}'`, period: matchClock.period } : {}),
      },
      markets,
      timestamp: Date.now(),
    };
  }

  private marketKey(offer: any, outcome: any, home: string, away: string): string {
    const type = (offer.betOfferType?.name || 'unknown').toLowerCase();
    const label = (outcome.label || '').toLowerCase();
    if (type.includes('match') || type.includes('1x2') || type.includes('moneyline')) {
      if (label === '1' || label.includes(home.toLowerCase().slice(0, 5))) return 'home_ml_ft';
      if (label === '2' || label.includes(away.toLowerCase().slice(0, 5))) return 'away_ml_ft';
      if (label === 'x' || label === 'draw') return 'draw_ft';
    }
    if (type.includes('over/under') || type.includes('total')) {
      const line = offer.line ? offer.line / 1000 : '';
      if (label.includes('over')) return `over_${line}_ft`;
      if (label.includes('under')) return `under_${line}_ft`;
    }
    return `kambi_${type}_${label}`.replace(/[^a-z0-9_]/g, '_');
  }
}
