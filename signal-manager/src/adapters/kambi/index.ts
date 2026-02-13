/**
 * Kambi/Unibet Adapter — HTTP polling, FASTEST free live score source
 * No auth, ~140-190ms latency per request
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { KambiAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { encodeThreshold } from '../../types/market-keys.js';
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
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;

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
    await this.discover();
    await this.poll();
    this.status = 'connected';
    this.scheduleNext();
    this.discoveryTimer = setInterval(() => this.discover().catch(e => log.error('Discovery error:', e.message)), 60_000);
    log.info(`Kambi adapter running (${this.config.pollIntervalMs}ms live poll + 60s pre-match discovery)`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.pollTimer = null;
    this.discoveryTimer = null;
    this.status = 'stopped';
    log.info('Kambi adapter stopped');
  }

  private scheduleNext(): void {
    this.pollTimer = setTimeout(async () => {
      try { await this.poll(); } catch (e: any) { log.error('Poll error:', e.message); }
      if (this.status !== 'stopped') this.scheduleNext();
    }, this.config.pollIntervalMs);
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

    // 1X2 / Moneyline
    if (type.includes('match') || type.includes('1x2') || type.includes('moneyline')) {
      if (label === '1' || label.includes(home.toLowerCase().slice(0, 5))) return 'ml_home_ft';
      if (label === '2' || label.includes(away.toLowerCase().slice(0, 5))) return 'ml_away_ft';
      if (label === 'x' || label === 'draw') return 'draw_ft';
    }

    // Over/Under totals
    if (type.includes('over/under') || type.includes('total')) {
      const line = offer.line ? offer.line / 1000 : 0;
      const t = encodeThreshold(line);
      if (label.includes('over')) return `o_${t}_ft`;
      if (label.includes('under')) return `u_${t}_ft`;
    }

    // Handicap
    if (type.includes('handicap')) {
      const line = offer.line ? offer.line / 1000 : 0;
      const t = encodeThreshold(line);
      if (label === '1' || label.includes(home.toLowerCase().slice(0, 5))) return `handicap_home_${t}_ft`;
      if (label === '2' || label.includes(away.toLowerCase().slice(0, 5))) return `handicap_away_${t}_ft`;
    }

    // Both teams to score
    if (type.includes('both teams') || type.includes('btts')) {
      if (label.includes('yes')) return 'btts_yes_ft';
      if (label.includes('no')) return 'btts_no_ft';
    }

    // Double chance
    if (type.includes('double chance')) {
      if (label === '1x') return 'dc_1x_ft';
      if (label === '12') return 'dc_12_ft';
      if (label === 'x2') return 'dc_x2_ft';
    }

    return `kambi_${type}_${label}`.replace(/[^a-z0-9_]/g, '_');
  }

  /** Pre-match discovery — polls all events (live+upcoming) at 60s interval */
  private async discover(): Promise<void> {
    try {
      const sports = ['football', 'basketball', 'tennis', 'ice_hockey', 'esports'];
      let total = 0;
      for (const sport of sports) {
        try {
          const resp = await fetch(
            `${this.config.baseUrl}/offering/v2018/ub/listView/${sport}.json?lang=en_GB&market=GB&ncid=${Date.now()}`,
            { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) }
          );
          if (!resp.ok) continue;
          const data = await resp.json() as any;
          if (!data?.events) continue;
          for (const ev of data.events) {
            const update = this.parseEvent(ev);
            if (update && this.callback) {
              total++;
              this.callback(update);
            }
          }
        } catch { /* skip sport */ }
      }
      log.info(`Kambi discovery: ${total} matched events (live+pre-match)`);
    } catch (err: any) {
      log.error('Kambi discovery failed:', err.message);
    }
  }
}
