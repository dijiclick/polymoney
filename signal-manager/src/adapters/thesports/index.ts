/**
 * TheSports.com MQTT Adapter — Real-time push via MQTT WebSocket
 * ~117 msgs/10s, MessagePack encoded, no auth
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { TheSportsAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';
import mqtt from 'mqtt';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let msgpackDecode: ((buf: Buffer) => any) | null = null;
try { const mp = require('msgpack-lite'); msgpackDecode = (buf: Buffer) => mp.decode(buf); } catch { /* */ }

const log = createLogger('thesports');

const SPORT_MAP: Record<number, string> = {
  1: 'soccer', 2: 'basketball', 3: 'tennis', 4: 'ice_hockey',
  5: 'baseball', 100: 'esports', 102: 'esports', 103: 'esports', 104: 'esports',
};

interface MatchMeta { homeTeam: string; awayTeam: string; sport: string; league: string; startTime: number; }

export class TheSportsAdapter implements IFilterableAdapter {
  readonly sourceId = 'thesports';
  private config: TheSportsAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private client: mqtt.MqttClient | null = null;
  private targetFilter: TargetEventFilter;
  private matchMeta: Map<string, MatchMeta> = new Map();
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TheSportsAdapterConfig) {
    this.config = config;
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void { this.targetFilter.setTargets(targets); }
  onUpdate(callback: UpdateCallback): void { this.callback = callback; }
  getStatus(): AdapterStatus { return this.status; }

  async start(): Promise<void> {
    this.status = 'connecting';
    log.info('Starting TheSports MQTT adapter...');
    await this.discover();
    this.discoveryTimer = setInterval(() => this.discover().catch(e => log.error('Discovery error:', e.message)), this.config.discoveryIntervalMs || 60_000);
    this.connectMqtt();
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.client) { this.client.end(true); this.client = null; }
    this.status = 'stopped';
    log.info('TheSports adapter stopped');
  }

  private connectMqtt(): void {
    const url = this.config.mqttUrl || 'wss://www.thesports.com/mqtt';
    this.client = mqtt.connect(url, {
      protocolVersion: 4, keepalive: 30, reconnectPeriod: 5000,
      connectTimeout: 10000, clean: true, rejectUnauthorized: false,
    });

    this.client.on('connect', () => {
      log.info('MQTT connected');
      this.status = 'connected';
      this.client!.subscribe('production/thesportswww/match/lives', { qos: 0 }, (err) => {
        if (err) log.error('Subscribe error:', err.message);
        else log.info('Subscribed to match/lives');
      });
    });

    this.client.on('message', (_topic, payload) => {
      let data: any;
      try { data = JSON.parse(payload.toString()); } catch {
        if (msgpackDecode) { try { data = msgpackDecode(payload); } catch { return; } } else return;
      }
      if (!data || !data.match_id) return;
      this.processUpdate(data);
    });

    this.client.on('error', (err) => { log.error('MQTT error:', err.message); this.status = 'error'; });
    this.client.on('close', () => { if (this.status !== 'stopped') this.status = 'reconnecting'; });
  }

  private processUpdate(update: any): void {
    if (!this.callback) return;
    const matchId = String(update.match_id);
    let meta = this.matchMeta.get(matchId);
    const homeTeam = meta?.homeTeam || update.home_team_name || '';
    const awayTeam = meta?.awayTeam || update.away_team_name || '';
    if (!meta && homeTeam && awayTeam) {
      meta = { homeTeam, awayTeam, sport: SPORT_MAP[update.sport_id] || 'unknown', league: '', startTime: 0 };
      this.matchMeta.set(matchId, meta);
    }
    if (!homeTeam || !awayTeam) return;

    const filterResult = this.targetFilter.check(homeTeam, awayTeam);
    if (!filterResult.matched) return;

    this.callback({
      sourceId: this.sourceId,
      sourceEventId: `thesports_${matchId}`,
      sport: meta?.sport || SPORT_MAP[update.sport_id] || 'unknown',
      league: meta?.league || '',
      startTime: meta?.startTime || 0,
      homeTeam, awayTeam,
      status: (update.status_id >= 2 && update.status_id <= 8) ? 'live' : (update.status_id >= 9) ? 'ended' : 'scheduled',
      stats: {
        score: { home: Number(update.home_score) || 0, away: Number(update.away_score) || 0 },
        period: update.status_name || undefined,
        elapsed: update.timer !== undefined ? `${update.timer}'` : undefined,
      },
      markets: [],
      timestamp: Date.now(),
    });
  }

  private async discover(): Promise<void> {
    try {
      for (const sportId of (this.config.sportIds || [1, 2, 3])) {
        const resp = await fetch(`https://www.thesports.com/portal_api/www/match/live?sport_id=${sportId}&lang=en`,
          { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;
        const data = await resp.json() as any;
        const groups = data?.data || [];
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const matches = group?.matches || [];
          if (!Array.isArray(matches)) continue;
          for (const match of matches) {
            const id = String(match.id || '');
            if (!id) continue;
            const homeTeam = match.home?.name || '';
            const awayTeam = match.away?.name || '';
            if (!homeTeam || !awayTeam) continue;
            this.matchMeta.set(id, {
              homeTeam, awayTeam,
              sport: SPORT_MAP[sportId] || 'unknown',
              league: match.unique_tournament?.name || '',
              startTime: match.match_time ? match.match_time * 1000 : 0,
            });
          }
        }
      }
      log.info(`TheSports discovery: ${this.matchMeta.size} matches cached`);
    } catch (err: any) { log.error('Discovery failed:', err.message); }
  }
}
