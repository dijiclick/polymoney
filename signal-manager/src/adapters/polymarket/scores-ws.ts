import WebSocket from 'ws';
import { createLogger } from '../../util/logger.js';

const log = createLogger('pm-scores-ws');

export interface ScoreUpdate {
  gameId: number;
  leagueAbbreviation: string;
  homeTeam: string;
  awayTeam: string;
  status: string;  // "InProgress", "Ended", etc.
  score: string;   // "3-16"
  period: string;  // "Q4", "1H", "2H", etc.
  elapsed: string; // "5:18"
  live: boolean;
  ended: boolean;
}

type ScoreCallback = (update: ScoreUpdate) => void;

export class ScoresWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private onScore: ScoreCallback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private _connected = false;
  private stopping = false;

  constructor(url: string) {
    this.url = url;
  }

  onScoreUpdate(callback: ScoreCallback): void {
    this.onScore = callback;
  }

  async connect(): Promise<void> {
    this.stopping = false;

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          log.info('Connected to Sports Scores WS');
          this._connected = true;
          this.reconnectDelay = 1000;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          this._connected = false;
          if (!this.stopping) {
            log.warn(`Scores WS closed, reconnecting in ${this.reconnectDelay}ms`);
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err) => {
          log.error('Scores WS error', err.message);
          if (!this._connected) reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  close(): void {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  get connected(): boolean {
    return this._connected;
  }

  private handleMessage(data: WebSocket.Data): void {
    const str = data.toString();

    // Respond to ping with pong
    if (str === 'ping') {
      if (this.ws && this._connected) {
        this.ws.send('pong');
      }
      return;
    }

    try {
      const update: ScoreUpdate = JSON.parse(str);
      if (update.gameId !== undefined && this.onScore) {
        this.onScore(update);
      }
    } catch {
      // Non-JSON message, ignore
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      log.info('Reconnecting Scores WS...');
      try {
        await this.connect();
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }
}
