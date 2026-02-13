/**
 * bet365 WebSocket client — connects to the live data feed using harvested session tokens.
 *
 * Protocol:
 * 1. Connect to wss://premws-pt{N}.365lpodds.com/zap/?uid=<random>
 * 2. Receive server hello: "101I<server_id>" or "100I<server_id>"
 * 3. Send auth: \x23\x03P\x01__time,P-ENDP,S_{SESSION_ID},A_{SST}\x00
 * 4. Receive ack: "100I<server_id>"
 * 5. Subscribe: \x16\x00{topic1},{topic2},...\x01
 * 6. Receive push data for subscribed topics
 * 7. Heartbeat: send \x1d\x00 periodically
 */

import WebSocket from 'ws';
import type { Bet365Session } from './cookie-harvester.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('bet365-ws');

// Multiple WS endpoints — bet365 uses regional/load-balanced servers
const WS_ENDPOINTS = [
  'wss://premws-pt3.365lpodds.com/zap/',
  'wss://premws-pt2.365lpodds.com/zap/',
  'wss://premws-pt1.365lpodds.com/zap/',
];

export type WsDataCallback = (topic: string, data: string) => void;

export class Bet365WsClient {
  private ws: WebSocket | null = null;
  private session: Bet365Session;
  private wsUrl: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dataCallback: WsDataCallback | null = null;
  private subscribedTopics: string[] = [];
  private connected = false;
  private stopped = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private serverId = '';
  private endpointIndex = 0;

  constructor(session: Bet365Session, wsUrl = '') {
    this.session = session;
    // Use provided URL or start with first endpoint
    this.wsUrl = wsUrl && !wsUrl.includes('premws-pt1') ? wsUrl : WS_ENDPOINTS[0];
  }

  onData(callback: WsDataCallback): void {
    this.dataCallback = callback;
  }

  updateSession(session: Bet365Session): void {
    this.session = session;
  }

  async connect(topics: string[]): Promise<void> {
    this.subscribedTopics = topics;
    this.stopped = false;
    return this._connect();
  }

  private async _connect(): Promise<void> {
    if (this.stopped) return;

    const uid = Math.floor(Math.random() * 1e15).toString();
    const wsUrl = this.wsUrl;
    const url = `${wsUrl}?uid=${uid}`;

    // Build cookie header from session
    const cookieStr = Object.entries(this.session.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    return new Promise<void>((resolve) => {
      log.warn(`Connecting to ${wsUrl}...`);

      this.ws = new WebSocket(url, {
        headers: {
          'User-Agent': this.session.userAgent,
          'Cookie': cookieStr,
          'Origin': 'https://www.bet365.com',
          'Host': new URL(wsUrl).host,
          'Accept-Language': 'en-GB,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        handshakeTimeout: 10_000,
      });

      let authSent = false;
      let resolved = false;

      this.ws.on('open', () => {
        log.warn('WebSocket connected, waiting for server hello');
        this.reconnectAttempts = 0;
      });

      this.ws.on('message', (data: Buffer | string) => {
        const msg = data.toString();

        // Server hello: "101I..." or "100I..."
        if (!authSent && (msg.startsWith('101') || msg.startsWith('100'))) {
          const idStart = msg.indexOf('I');
          if (idStart !== -1) {
            this.serverId = msg.slice(idStart + 1).replace(/\x00/g, '');
          }

          // Send auth message
          const sessionTopic = `S_${this.session.sessionId}`;
          const allTopics = ['__time', 'P-ENDP', sessionTopic];
          if (this.session.sst) {
            allTopics.push(`A_${this.session.sst}`);
          }
          const authMsg = `\x23\x03P\x01${allTopics.join(',')}\x00`;
          this.ws!.send(authMsg);
          authSent = true;
          log.warn('Auth message sent');

          // Subscribe to topics after a short delay
          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this._subscribe(this.subscribedTopics);
              this.connected = true;
              if (!resolved) {
                resolved = true;
                resolve();
              }
            }
          }, 500);

          // Start heartbeat
          this._startHeartbeat();
          return;
        }

        // Server ack after auth (another 100I...)
        if (msg.startsWith('100') && authSent) {
          return;
        }

        // Data message — extract topic and forward
        this._handleDataMessage(msg);
      });

      this.ws.on('error', (err) => {
        log.warn(`WebSocket error: ${err.message}`);
        // On 403, try next endpoint
        if (err.message.includes('403') && !resolved) {
          this._tryNextEndpoint();
        }
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        this._stopHeartbeat();
        log.warn(`WebSocket closed: ${code} ${reason?.toString() || ''}`);

        if (!resolved) {
          resolved = true;
          resolve(); // Don't block on failed connection
        }

        if (!this.stopped) {
          this._scheduleReconnect();
        }
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 12_000);
    });
  }

  /** Try the next WS endpoint when current one returns 403 */
  private _tryNextEndpoint(): void {
    this.endpointIndex = (this.endpointIndex + 1) % WS_ENDPOINTS.length;
    this.wsUrl = WS_ENDPOINTS[this.endpointIndex];
    log.warn(`Switching to endpoint: ${this.wsUrl}`);
  }

  private _subscribe(topics: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || topics.length === 0) return;
    const msg = `\x16\x00${topics.join(',')}\x01`;
    this.ws.send(msg);
    log.warn(`Subscribed to ${topics.length} topics: ${topics.join(', ')}`);
  }

  private _handleDataMessage(msg: string): void {
    if (!this.dataCallback) return;

    // Data messages are prefixed with \x14{topic}\x01{data}
    const topicMarker = msg.indexOf('\x14');
    const topicEnd = msg.indexOf('\x01');

    if (topicMarker !== -1 && topicEnd > topicMarker) {
      const topic = msg.slice(topicMarker + 1, topicEnd);
      this.dataCallback(topic, msg);
      return;
    }

    // Some messages have topic without \x14 prefix, identified by known topic names
    for (const knownTopic of ['__time', 'InPlay_', 'OVInPlay_', 'Media_', 'P-ENDP', 'P_CONFIG', 'PVG_']) {
      if (msg.startsWith(knownTopic)) {
        const sepIdx = msg.indexOf('\x01');
        if (sepIdx !== -1) {
          const topic = msg.slice(0, sepIdx);
          this.dataCallback(topic, msg);
        } else {
          this.dataCallback(knownTopic, msg);
        }
        return;
      }
    }

    // Fallback: if contains pipe-delimited data, emit as unknown topic
    if (msg.includes('|') && (msg.includes('EV;') || msg.includes('PA;') || msg.includes('CL;'))) {
      this.dataCallback('_unknown', msg);
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('\x1d\x00');
      }
    }, 15_000);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    // On each reconnect, try next endpoint
    this._tryNextEndpoint();

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;
    log.warn(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}) → ${this.wsUrl}`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this._connect();
      } catch (err) {
        log.warn('Reconnect failed');
      }
    }, delay);
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    this.stopped = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    log.warn('Disconnected');
  }
}
