import WebSocket from 'ws';
import { createLogger } from '../../util/logger.js';

const log = createLogger('pm-clob-ws');

export interface PriceChangeEvent {
  asset_id: string;
  price: string;
  size: string;
  side: string;
  best_bid: string;
  best_ask: string;
}

export interface ClobMessage {
  event_type: string;
  market?: string;
  timestamp?: string;
  price_changes?: PriceChangeEvent[];
  // last_trade_price event
  asset_id?: string;
  price?: string;
  side?: string;
  size?: string;
  // book event
  sells?: Array<{ price: string; size: string }>;
}

export interface PriceData {
  bestBid: number;
  bestAsk: number;
  lastTradePrice: number;
  midpoint: number;       // computed display price matching PM UI
}

type PriceCallback = (tokenId: string, price: PriceData, timestamp: number) => void;

export class ClobWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private pingInterval: number;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private subscribedTokens: Set<string> = new Set();
  private onPrice: PriceCallback | null = null;
  private _connected = false;
  private stopping = false;
  // Track last known prices per token for midpoint computation
  private lastTrade: Map<string, number> = new Map();

  constructor(url: string, pingIntervalMs: number) {
    this.url = url;
    this.pingInterval = pingIntervalMs;
  }

  onPriceChange(callback: PriceCallback): void {
    this.onPrice = callback;
  }

  async connect(tokenIds: string[]): Promise<void> {
    this.stopping = false;
    for (const t of tokenIds) this.subscribedTokens.add(t);

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          log.info(`Connected to CLOB WS (${this.subscribedTokens.size} tokens)`);
          this._connected = true;
          this.reconnectDelay = 1000;

          // Subscribe
          if (this.subscribedTokens.size > 0) {
            this.sendSubscribe(Array.from(this.subscribedTokens));
          }

          // Start ping
          this.startPing();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this._connected = false;
          this.stopPing();
          if (!this.stopping) {
            log.warn(`CLOB WS closed (${code}), reconnecting in ${this.reconnectDelay}ms`);
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (err) => {
          log.error('CLOB WS error', err.message);
          if (!this._connected) reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  subscribe(tokenIds: string[]): void {
    for (const t of tokenIds) this.subscribedTokens.add(t);
    if (this._connected && this.ws) {
      const msg = JSON.stringify({ assets_ids: tokenIds, operation: 'subscribe' });
      this.ws.send(msg);
      log.debug(`Subscribed to ${tokenIds.length} new tokens`);
    }
  }

  unsubscribe(tokenIds: string[]): void {
    for (const t of tokenIds) this.subscribedTokens.delete(t);
    if (this._connected && this.ws) {
      const msg = JSON.stringify({ assets_ids: tokenIds, operation: 'unsubscribe' });
      this.ws.send(msg);
    }
  }

  close(): void {
    this.stopping = true;
    this.stopPing();
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
    try {
      const str = data.toString();
      if (str === 'PONG') return; // Response to our ping

      const msg: ClobMessage = JSON.parse(str);

      if (msg.event_type === 'price_change' && msg.price_changes) {
        const ts = msg.timestamp ? parseInt(msg.timestamp, 10) : Date.now();
        for (let i = 0; i < msg.price_changes.length; i++) {
          const pc = msg.price_changes[i];
          const bestBid = pc.best_bid ? parseFloat(pc.best_bid) : 0;
          const bestAsk = pc.best_ask ? parseFloat(pc.best_ask) : 0;

          if (bestAsk > 0 && bestAsk <= 1 && this.onPrice) {
            const lastTrade = this.lastTrade.get(pc.asset_id) || 0;
            const priceData = this.computeDisplayPrice(bestBid, bestAsk, lastTrade);
            this.onPrice(pc.asset_id, priceData, ts);
          }
        }
      } else if (msg.event_type === 'last_trade_price' && msg.asset_id && msg.price) {
        const ts = msg.timestamp ? parseInt(msg.timestamp, 10) : Date.now();
        const tradePrice = parseFloat(msg.price);
        if (tradePrice > 0 && tradePrice <= 1) {
          this.lastTrade.set(msg.asset_id, tradePrice);
          // Don't emit here — wait for next price_change with updated bid/ask
        }
      }
      // Skip "book" events — use price_change for best bid/ask
    } catch {
      // Ignore parse errors silently — could be non-JSON keepalive
    }
  }

  /** Replicate PM UI display price: midpoint if spread ≤ 10c, else last trade */
  private computeDisplayPrice(bestBid: number, bestAsk: number, lastTradePrice: number): PriceData {
    const spread = bestAsk - bestBid;
    let midpoint: number;

    if (bestBid > 0 && spread <= 0.10) {
      // Tight spread: use midpoint (PM UI behavior)
      midpoint = (bestBid + bestAsk) / 2;
    } else if (lastTradePrice > 0) {
      // Wide spread: use last trade price
      midpoint = lastTradePrice;
    } else {
      // Fallback: use best_ask (our old behavior)
      midpoint = bestAsk;
    }

    return { bestBid, bestAsk, lastTradePrice, midpoint };
  }

  private sendSubscribe(tokenIds: string[]): void {
    if (!this.ws) return;
    const msg = JSON.stringify({ assets_ids: tokenIds, type: 'market' });
    this.ws.send(msg);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this._connected) {
        this.ws.send('PING');
      }
    }, this.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(async () => {
      log.info('Reconnecting CLOB WS...');
      try {
        await this.connect(Array.from(this.subscribedTokens));
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }
}
