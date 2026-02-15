/**
 * SofaScore NATS WebSocket Adapter — Real-time push via NATS protocol
 * wss://ws.sofascore.com:9222/ — auth: user=none, pass=none
 * Topics: sport.football, sport.basketball, etc.
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { SofaScoreAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';
import WebSocket from 'ws';

const log = createLogger('sofascore');

interface MatchMeta {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  league: string;
  startTime: number;
}

export class SofaScoreAdapter implements IFilterableAdapter {
  readonly sourceId = 'sofascore';
  private config: SofaScoreAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private ws: WebSocket | null = null;
  private targetFilter: TargetEventFilter;
  private matchMeta: Map<number, MatchMeta> = new Map();
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private subscribed = false;
  private natsMessageCount = 0;
  private payloadCount = 0;
  private matchedCount = 0;

  constructor(config: SofaScoreAdapterConfig) {
    this.config = config;
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void { this.targetFilter.setTargets(targets); }
  onUpdate(callback: UpdateCallback): void { this.callback = callback; }
  getStatus(): AdapterStatus { return this.status; }

  async start(): Promise<void> {
    this.status = 'connecting';
    log.info('Starting SofaScore NATS adapter...');
    await this.discover();
    this.discoveryTimer = setInterval(() => this.discover().catch(e => log.error('Discovery error:', e.message)), this.config.discoveryIntervalMs || 60_000);
    this.connectWs();
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.status = 'stopped';
    log.info('SofaScore adapter stopped');
  }

  private connectWs(): void {
    const url = this.config.wsUrl || 'wss://ws.sofascore.com:9222/';
    try {
      this.ws = new WebSocket(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });

      this.ws.on('open', () => {
        log.info('NATS WebSocket connected, waiting for INFO...');
        this.status = 'connected';
        this.reconnectAttempt = 0;
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('PING\r\n');
        }, 25000);
      });

      this.ws.on('message', (data: Buffer) => {
        try { this.handleNatsMessage(data.toString()); }
        catch (e: any) { log.debug('NATS parse error:', e.message); }
      });

      this.ws.on('close', () => {
        if (this.status !== 'stopped') {
          this.status = 'reconnecting';
          this.subscribed = false;
          if (this.pingTimer) clearInterval(this.pingTimer);
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        log.error('NATS WS error:', err.message);
        this.status = 'error';
      });
    } catch (err: any) {
      log.error('NATS connect failed:', err.message);
      this.status = 'error';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.status === 'stopped') return;
    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempt, 15)), 30000);
    this.reconnectAttempt++;
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.connectWs(), delay);
  }

  private handleNatsMessage(raw: string): void {
    const lines = raw.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('INFO ')) {
        // Respond with CONNECT using user=none, pass=none (discovered from browser)
        log.debug('Got NATS INFO, sending CONNECT...');
        this.ws?.send('CONNECT {"protocol":1,"version":"3.1.0","lang":"nats.ws","verbose":false,"pedantic":false,"user":"none","pass":"none","headers":true,"no_responders":true}\r\n');

        // Always (re-)subscribe on INFO — NATS server sends INFO periodically
        this.subscribed = true;
        let subId = 1;
        const sports = this.config.sports || ['football'];
        for (const sport of sports) {
          this.ws?.send(`SUB sport.${sport} ${subId}\r\n`);
          subId++;
        }
        log.debug(`Subscribed to ${sports.length} sport topics`);
        continue;
      }

      if (line === 'PING') { this.ws?.send('PONG\r\n'); continue; }
      if (line === '+OK' || line === '' || line === 'PONG') continue;
      if (line.startsWith('-ERR')) {
        log.warn('NATS error:', line);
        if (line.includes('Authentication Timeout') && this.ws) {
          this.ws.close(); // triggers close handler → reconnect
        }
        continue;
      }

      if (line.startsWith('MSG ') || line.startsWith('HMSG ')) {
        this.natsMessageCount++;
        if (this.natsMessageCount <= 3 || this.natsMessageCount % 500 === 0) {
          log.debug(`NATS msg #${this.natsMessageCount}: ${line.substring(0, 80)} | payloads=${this.payloadCount}, matched=${this.matchedCount}`);
        }
        const parts = line.split(' ');
        const numBytes = parseInt(parts[parts.length - 1]);
        const payload = lines[i + 1];
        if (payload) {
          this.processPayload(payload);
          i++;
        }
      }
    }
  }

  private processPayload(payload: string): void {
    if (!this.callback) return;
    this.payloadCount++;
    try {
      // SofaScore sends partial event updates as JSON
      const data = JSON.parse(payload) as any;
      if (!data.id) return;

      const meta = this.matchMeta.get(data.id);
      const homeTeam = data.homeTeam?.name || meta?.homeTeam || '';
      const awayTeam = data.awayTeam?.name || meta?.awayTeam || '';
      if (!homeTeam || !awayTeam) return;

      // Filter to Polymarket events only
      const filterResult = this.targetFilter.check(homeTeam, awayTeam);
      if (!filterResult.matched) return;
      this.matchedCount++;

      // Extract scores — can be nested or flat
      const homeScore = data.homeScore?.current ?? data['homeScore.current'];
      const awayScore = data.awayScore?.current ?? data['awayScore.current'];
      const hasScore = homeScore !== undefined && awayScore !== undefined;

      const sport = data.sport?.slug || meta?.sport || 'soccer';
      const league = data.tournament?.name || meta?.league || '';

      const update: AdapterEventUpdate = {
        sourceId: this.sourceId,
        sourceEventId: `sofascore_${data.id}`,
        sport, league,
        startTime: data.startTimestamp ? data.startTimestamp * 1000 : (meta?.startTime || 0),
        homeTeam, awayTeam,
        status: this.mapStatus(data.status?.code),
        stats: {
          ...(hasScore ? { score: { home: Number(homeScore) || 0, away: Number(awayScore) || 0 } } : {}),
          period: data.status?.description || undefined,
        },
        markets: [],
        timestamp: Date.now(),
      };

      if (this.matchedCount <= 5 || this.matchedCount % 100 === 0) {
        log.debug(`✅ SofaScore match #${this.matchedCount}: ${homeTeam} vs ${awayTeam} | score=${hasScore ? `${homeScore}-${awayScore}` : 'none'} | ${sport}`);
      }
      this.callback(update);
    } catch {
      // Try base64 decode
      try {
        const decoded = Buffer.from(payload, 'base64').toString('utf-8');
        if (decoded.startsWith('{')) this.processPayload(decoded);
      } catch { /* unparseable */ }
    }
  }

  private mapStatus(code?: number): 'live' | 'ended' | 'scheduled' {
    if (!code) return 'live';
    if (code >= 6 && code <= 7) return 'live';
    if (code === 100) return 'ended';
    if (code === 0) return 'scheduled';
    return 'live';
  }

  private async discover(): Promise<void> {
    try {
      const sports = this.config.sports || ['football'];
      for (const sport of sports) {
        const resp = await fetch(
          `https://api.sofascore.com/api/v1/sport/${sport}/events/live`,
          { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }
        );
        if (!resp.ok) { log.debug(`SofaScore REST ${sport}: ${resp.status}`); continue; }
        const data = await resp.json() as any;
        const events = data?.events || [];
        for (const ev of events) {
          if (!ev.id) continue;
          this.matchMeta.set(ev.id, {
            homeTeam: ev.homeTeam?.name || '',
            awayTeam: ev.awayTeam?.name || '',
            sport,
            league: ev.tournament?.name || '',
            startTime: ev.startTimestamp ? ev.startTimestamp * 1000 : 0,
          });
        }
      }
      log.info(`SofaScore discovery: ${this.matchMeta.size} matches cached`);
    } catch (err: any) {
      log.error(`SofaScore discovery failed: ${err.message}`);
    }
  }
}
