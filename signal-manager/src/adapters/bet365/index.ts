import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { Bet365AdapterConfig } from '../../types/config.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import type { EventStatus } from '../../types/unified-event.js';
import { createLogger } from '../../util/logger.js';
import { mapBet365Odds } from './market-map.js';

const log = createLogger('bet365-adapter');

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Bet365Client, LIVE_PERIODS, BREAK_PERIODS, FINISHED_PERIODS, SPORT } = require(
  resolve(__dirname, '..', '..', '..', '..', 'src', 'adapters', 'bet365', 'client.cjs')
);

const SPORT_MAP: Record<string, string> = {
  Soccer: 'soccer',
  Basketball: 'basketball',
  Tennis: 'tennis',
  'Ice Hockey': 'ice_hockey',
  Volleyball: 'volleyball',
  Handball: 'handball',
  Baseball: 'baseball',
  'American Football': 'american_football',
  Cricket: 'cricket',
  'Rugby Union': 'rugby',
  'Australian Rules': 'australian_rules',
  Snooker: 'snooker',
  'E-Sports': 'esports',
};

function mapStatus(period: string | null): EventStatus | undefined {
  if (!period) return undefined;
  if (LIVE_PERIODS.has(period) || BREAK_PERIODS.has(period)) return 'live';
  if (FINISHED_PERIODS.has(period)) return 'ended';
  if (period === 'Postp.' || period === 'Canc.' || period === 'Aband.') return 'canceled';
  return undefined;
}

function periodName(go: string | null): string {
  if (!go) return '';
  switch (go) {
    case '1st': return '1H';
    case '2nd': return '2H';
    case 'HT': return 'HT';
    case 'FT': return 'FT';
    case 'ET': case 'ET1': return 'ET1';
    case 'ET2': return 'ET2';
    case 'PEN': return 'PEN';
    case 'AP': case 'AET': return 'FT';
    case 'Break': return 'BRK';
    default: return go;
  }
}

export class Bet365Adapter implements IAdapter {
  readonly sourceId = 'bet365';
  private config: Bet365AdapterConfig;
  private client: any = null;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';

  constructor(config: Bet365AdapterConfig) {
    this.config = config;
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('Bet365 adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';

    const cdpPort = this.config.cdpPort || 9222;
    this.client = new Bet365Client({
      cdpUrl: `http://localhost:${cdpPort}`,
      cdpPort,
      headless: this.config.headless ?? false,
    });

    this.client.on('connected', () => {
      log.info('Bet365 WebSocket connected');
      this.status = 'connected';
    });

    this.client.on('disconnected', () => {
      log.warn('Bet365 WebSocket disconnected');
      this.status = 'reconnecting';
    });

    this.client.on('error', (err: any) => {
      log.error('Bet365 error', err);
    });

    this.client.on('info', (msg: string) => {
      log.info(msg);
    });

    this.client.on('snapshot', ({ events, total, withOdds }: any) => {
      log.info(`Bet365 snapshot: ${events} events (total: ${total}, with odds: ${withOdds || 0})`);
    });

    this.client.on('update', (data: any) => {
      if (!this.callback) return;
      const match = data.match;
      if (!match) return;

      const update = this._matchToUpdate(match);
      if (update) this.callback(update);
    });

    try {
      await this.client.start();
      this.status = 'connected';
      log.info(`Bet365 adapter started (${this.client.getEvents().length} events tracked)`);
    } catch (err) {
      log.error('Bet365 start failed', err);
      this.status = 'error';
      throw err;
    }
  }

  private _matchToUpdate(match: any): AdapterEventUpdate | null {
    if (!match.home || match.home === '?' || !match.away || match.away === '?') return null;

    const sport = match.sport
      ? (SPORT_MAP[match.sport] || match.sport.toLowerCase())
      : 'unknown';
    const league = match.competition || '';

    return {
      sourceId: 'bet365',
      sourceEventId: String(match.id),
      sport,
      league,
      startTime: 0, // bet365 in-play feed doesn't provide start time
      homeTeam: match.home,
      awayTeam: match.away,
      status: mapStatus(match.period),
      stats: {
        score: {
          home: match.score?.home ?? 0,
          away: match.score?.away ?? 0,
        },
        period: periodName(match.period),
        elapsed: Bet365Client.matchMinute(match) !== null
          ? Bet365Client.matchMinute(match) + "'"
          : '',
      },
      markets: match.odds ? mapBet365Odds(match.odds) : [],
      timestamp: Date.now(),
    };
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.status = 'stopped';
    log.info('Bet365 adapter stopped');
  }

  getStatus(): AdapterStatus {
    return this.status;
  }
}
