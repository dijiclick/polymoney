import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { Bet365AdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { Bet365CookieHarvester } from './cookie-harvester.js';
import { Bet365WsClient } from './ws-client.js';
import { parseMessage, oddsToProb, type Bet365Event } from './parser.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('bet365-adapter');

/** Map bet365 sport classification IDs to our normalized sport names */
const SPORT_MAP: Record<string, string> = {
  '1': 'soccer',
  '13': 'tennis',
  '18': 'basketball',
  '17': 'ice-hockey',
  '151': 'esports',
  '3': 'cricket',
  '12': 'american-football',
  '16': 'baseball',
  '92': 'table-tennis',
  '91': 'volleyball',
  '78': 'handball',
  '9': 'boxing',
  '15': 'darts',
};

export class Bet365Adapter implements IFilterableAdapter {
  readonly sourceId = 'bet365';
  private config: Bet365AdapterConfig;
  private harvester: Bet365CookieHarvester;
  private wsClient: Bet365WsClient | null = null;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private targetFilter: TargetEventFilter;
  private eventCache: Map<string, Bet365Event> = new Map();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Bet365AdapterConfig) {
    this.config = config;
    this.harvester = new Bet365CookieHarvester(
      config.baseUrl || 'https://www.bet365.com',
      config.cookieRefreshMs || 30 * 60 * 1000
    );
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
      log.info('bet365 adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';
    log.info('Starting bet365 adapter...');

    try {
      // 1. Harvest fresh cookies/session
      const session = await this.harvester.harvest();
      this.harvester.startAutoRefresh();

      // 2. Build subscription topics
      const langId = session.languageId || '1';
      const zoneId = session.zoneId || '1';
      const topics = [
        `InPlay_${langId}_${zoneId}`,
        `OVInPlay_${langId}_${zoneId}`,
      ];

      // 3. Connect WebSocket
      this.wsClient = new Bet365WsClient(
        session,
        this.config.wsUrl || 'wss://premws-pt1.365lpodds.com/zap/'
      );

      this.wsClient.onData((topic, data) => {
        this._handleWsData(topic, data);
      });

      await this.wsClient.connect(topics);

      // 4. Periodically update WS client with fresh session
      this.refreshTimer = setInterval(() => {
        const freshSession = this.harvester.getSession();
        if (freshSession && this.wsClient) {
          this.wsClient.updateSession(freshSession);
        }
      }, 60_000);

      this.status = this.wsClient.isConnected() ? 'connected' : 'reconnecting';
      log.info(`bet365 adapter started (status: ${this.status})`);
    } catch (err: any) {
      log.error(`Failed to start bet365 adapter: ${err.message}`);
      this.status = 'error';

      // Retry loop
      this.refreshTimer = setInterval(async () => {
        try {
          const session = await this.harvester.harvest();
          const langId = session.languageId || '1';
          const zoneId = session.zoneId || '1';

          this.wsClient = new Bet365WsClient(
            session,
            this.config.wsUrl || 'wss://premws-pt1.365lpodds.com/zap/'
          );
          this.wsClient.onData((topic, data) => this._handleWsData(topic, data));
          await this.wsClient.connect([
            `InPlay_${langId}_${zoneId}`,
            `OVInPlay_${langId}_${zoneId}`,
          ]);

          if (this.wsClient.isConnected()) {
            this.status = 'connected';
            log.info('bet365 adapter recovered');
          }
        } catch {
          // Still failing, keep retrying
        }
      }, 30_000);
    }
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    await this.harvester.close();
    this.status = 'stopped';
    log.info('bet365 adapter stopped');
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private _handleWsData(topic: string, data: string): void {
    if (!this.callback) return;

    // Skip time sync and config topics
    if (topic === '__time' || topic.startsWith('P-') || topic.startsWith('P_') ||
        topic.startsWith('PV') || topic.startsWith('S_') || topic.startsWith('Media_')) {
      return;
    }

    try {
      const parsed = parseMessage(data);
      if (parsed.events.length === 0) return;

      for (const ev of parsed.events) {
        // Filter by configured sport IDs
        if (this.config.sportIds.length > 0) {
          const sportNum = parseInt(ev.sportId);
          if (!isNaN(sportNum) && !this.config.sportIds.includes(sportNum)) continue;
        }

        // Skip events without team names
        if (!ev.homeTeam || !ev.awayTeam) continue;

        // Apply target filter if set
        if (this.targetFilter.targetCount > 0) {
          const result = this.targetFilter.check(ev.homeTeam, ev.awayTeam);
          if (!result.matched) continue;
        }

        // Cache event for delta updates
        this.eventCache.set(ev.id, ev);

        // Build normalized update
        const update = this._normalizeEvent(ev);
        if (update) {
          this.callback(update);
        }
      }
    } catch (err) {
      log.debug(`Parse error on topic ${topic}: ${err}`);
    }
  }

  private _normalizeEvent(ev: Bet365Event): AdapterEventUpdate | null {
    const sport = SPORT_MAP[ev.sportId] || `sport-${ev.sportId}`;

    const markets: AdapterEventUpdate['markets'] = [];

    // Extract odds from markets
    for (const market of ev.markets) {
      const mName = market.name.toLowerCase();

      // Match Result / 1X2
      if (mName.includes('match result') || mName.includes('full time result') ||
          mName.includes('match winner') || mName === '1x2' || mName === 'match odds') {
        for (const sel of market.selections) {
          const selName = sel.name.toLowerCase();
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;

          if (selName === ev.homeTeam.toLowerCase() || sel.order === 1 || selName === '1' || selName === 'home') {
            markets.push({ key: 'home_win', value: prob });
          } else if (selName === ev.awayTeam.toLowerCase() || sel.order === 3 || selName === '2' || selName === 'away') {
            markets.push({ key: 'away_win', value: prob });
          } else if (selName === 'draw' || selName === 'x' || sel.order === 2) {
            markets.push({ key: 'draw', value: prob });
          }
        }
      }

      // Moneyline (basketball, hockey, tennis — no draw)
      if (mName.includes('money line') || mName.includes('moneyline') || mName.includes('to win')) {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          if (sel.order === 1 || sel.name === ev.homeTeam) {
            markets.push({ key: 'home_win', value: prob });
          } else if (sel.order === 2 || sel.name === ev.awayTeam) {
            markets.push({ key: 'away_win', value: prob });
          }
        }
      }

      // Over/Under totals
      if (mName.includes('over/under') || mName.includes('total goals') || mName.includes('total points')) {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          const selName = sel.name.toLowerCase();
          // Extract line from selection name: "Over 2.5" → 2.5
          const lineMatch = selName.match(/(over|under)\s+([\d.]+)/);
          if (lineMatch) {
            const direction = lineMatch[1];
            const line = lineMatch[2];
            markets.push({ key: `${direction}_${line}`, value: prob });
          }
        }
      }

      // Both Teams to Score
      if (mName.includes('both teams to score') || mName === 'btts') {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          if (sel.name.toLowerCase() === 'yes') {
            markets.push({ key: 'btts_yes', value: prob });
          } else if (sel.name.toLowerCase() === 'no') {
            markets.push({ key: 'btts_no', value: prob });
          }
        }
      }
    }

    return {
      sourceId: this.sourceId,
      sourceEventId: ev.id,
      sport,
      league: ev.league || 'Unknown',
      startTime: ev.startTime || 0,
      homeTeam: ev.homeTeam,
      awayTeam: ev.awayTeam,
      status: ev.isLive ? 'live' : 'scheduled',
      stats: {
        score: ev.score,
        elapsed: ev.elapsed,
        period: ev.period,
      },
      markets,
      timestamp: Date.now(),
    };
  }
}
