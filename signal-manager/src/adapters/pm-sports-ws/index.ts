/**
 * Polymarket Sports WebSocket Adapter
 * 
 * Connects to wss://sports-api.polymarket.com/ws
 * Receives real-time sport_result messages: score changes, period changes, match start/end.
 * No subscription needed — all events broadcast automatically.
 * Must reply "pong" to "ping" every 5s to stay connected.
 */

import WebSocket from 'ws';
import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('pm-sports-ws');

const WS_URL = 'wss://sports-api.polymarket.com/ws';
const RECONNECT_BASE_MS = 2000;
const MAX_RECONNECT_MS = 30000;

interface SportResult {
  gameId: number;
  leagueAbbreviation: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  live: boolean;
  ended: boolean;
  score: string;
  period?: string;
  elapsed?: string;
  turn?: string;
  finishedTimestamp?: string;
}

// Map PM league abbreviations to our sport slugs
const LEAGUE_TO_SPORT: Record<string, string> = {
  nfl: 'nfl', cfb: 'cfb',
  nba: 'nba', ncaab: 'ncaab', wnba: 'wnba',
  mlb: 'mlb',
  nhl: 'nhl',
  epl: 'epl', sea: 'sea', lal: 'lal', bun: 'bun', fl1: 'fl1', ucl: 'ucl', uel: 'uel',
  mls: 'mls', arg: 'arg', bra: 'bra', mex: 'mex',
  atp: 'atp', wta: 'wta',
  cs2: 'cs2', lol: 'lol', dota2: 'dota2', val: 'val', r6siege: 'r6siege', rl: 'rl',
  ufc: 'ufc', mma: 'mma',
  khl: 'khl', shl: 'shl',
};

function parseScore(scoreStr: string): { home: number; away: number } | null {
  if (!scoreStr) return null;
  
  // Simple format: "3-16"
  const simple = scoreStr.match(/^(\d+)-(\d+)$/);
  if (simple) return { home: parseInt(simple[1]), away: parseInt(simple[2]) };
  
  // Esports Bo3/Bo5: "000-000|2-0|Bo3" — use map score (2-0)
  const esports = scoreStr.match(/\|(\d+)-(\d+)\|/);
  if (esports) return { home: parseInt(esports[1]), away: parseInt(esports[2]) };
  
  // Fallback: find any "N-N" pattern
  const fallback = scoreStr.match(/(\d+)-(\d+)/);
  if (fallback) return { home: parseInt(fallback[1]), away: parseInt(fallback[2]) };
  
  return null;
}

export class PmSportsWsAdapter implements IAdapter {
  readonly sourceId = 'pm-sports-ws';
  private ws: WebSocket | null = null;
  private reconnectMs = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private callback: UpdateCallback | null = null;
  private running = false;
  private status: AdapterStatus = 'idle';
  private msgCount = 0;
  private scoreCount = 0;

  async start(): Promise<void> {
    this.running = true;
    this.connect();
    log.warn(`PM Sports WS adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.status = 'stopped';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private connect() {
    if (!this.running) return;
    this.status = 'connecting';
    
    try {
      this.ws = new WebSocket(WS_URL);
      
      this.ws.on('open', () => {
        log.warn('✅ PM Sports WS connected — receiving all live sports updates');
        this.status = 'connected';
        this.reconnectMs = RECONNECT_BASE_MS;
        this.msgCount = 0;
        this.scoreCount = 0;
      });

      this.ws.on('message', (raw: Buffer) => {
        const data = raw.toString();
        
        if (data === 'ping') {
          this.ws?.send('pong');
          return;
        }
        
        this.msgCount++;
        
        try {
          const msg: SportResult = JSON.parse(data);
          this.handleSportResult(msg);
        } catch {
          // Ignore non-JSON messages
        }
      });

      this.ws.on('close', (code) => {
        log.info(`PM Sports WS closed (code=${code})`);
        this.status = 'reconnecting';
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        log.info(`PM Sports WS error: ${err.message}`);
        this.status = 'error';
      });
    } catch (e: any) {
      log.info(`PM Sports WS connect failed: ${e.message}`);
      this.status = 'error';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.running) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectMs);
    this.reconnectMs = Math.min(this.reconnectMs * 1.5, MAX_RECONNECT_MS);
  }

  private handleSportResult(msg: SportResult) {
    const sport = LEAGUE_TO_SPORT[msg.leagueAbbreviation] || msg.leagueAbbreviation;
    const score = parseScore(msg.score);

    const update: AdapterEventUpdate = {
      sourceId: this.sourceId,
      sourceEventId: `pm-sport-${msg.gameId}`,
      sport,
      league: msg.leagueAbbreviation,
      startTime: 0,
      homeTeam: msg.homeTeam,
      awayTeam: msg.awayTeam,
      status: msg.ended ? 'ended' : msg.live ? 'live' : 'scheduled',
      stats: {
        ...(score ? { score } : {}),
        ...(msg.period ? { period: msg.period } : {}),
        ...(msg.elapsed ? { clock: msg.elapsed } : {}),
      },
      markets: [],
      timestamp: Date.now(),
    };

    this.scoreCount++;
    if (this.scoreCount <= 5 || this.scoreCount % 100 === 0) {
      log.warn(`📡 PM Sports | ${msg.homeTeam} vs ${msg.awayTeam} | ${msg.score} | ${msg.period || ''} | ${msg.status} | ${msg.leagueAbbreviation}`);
    }

    this.callback?.(update);
  }
}
