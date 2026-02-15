/**
 * Connection Management
 *
 * Handles credential caching, connection warmup, and keep-alive pings.
 */

import { createHmac } from 'crypto';
import type { ClobClient } from '@polymarket/clob-client';
import type { DerivedCredentials, ConnectionState } from './types.js';

const CLOB_HOST = 'https://clob.polymarket.com';
const RACE_CONNECTION_COUNT = 3;

export class ConnectionManager {
  private apiKey: string;
  private apiPassphrase: string;
  private walletAddress: string;
  private hmacKeyBuffer: Buffer;
  private clobClient: ClobClient;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private state: ConnectionState = {
    warmedUp: false,
    requestCount: 0,
    firstTtfb: null,
    recentTtfbs: [],
  };

  constructor(
    credentials: DerivedCredentials,
    walletAddress: string,
    clobClient: ClobClient
  ) {
    this.apiKey = credentials.apiKey;
    this.apiPassphrase = credentials.apiPassphrase;
    this.walletAddress = walletAddress;
    this.clobClient = clobClient;
    // Store key as Buffer for synchronous HMAC (much faster than Web Crypto)
    this.hmacKeyBuffer = Buffer.from(credentials.apiSecret, 'base64');
  }

  /**
   * Sign a message using HMAC-SHA256 (synchronous, ~0.1ms)
   */
  signHmac(message: string): string {
    const sig = createHmac('sha256', this.hmacKeyBuffer).update(message).digest('base64');
    return sig.replace(/\+/g, '-').replace(/\//g, '_');  // URL-safe base64
  }

  /**
   * Get cached credentials for request headers
   */
  getCredentials(): { apiKey: string; apiPassphrase: string; walletAddress: string } {
    return {
      apiKey: this.apiKey,
      apiPassphrase: this.apiPassphrase,
      walletAddress: this.walletAddress,
    };
  }

  /**
   * Warm up connections to the CLOB API
   * Establishes TCP+TLS connections before first real order
   */
  async warmup(): Promise<void> {
    const t0 = performance.now();

    // First, sequential warmup to /time (fast, establishes base connection)
    try {
      const t1 = performance.now();
      await fetch(`${CLOB_HOST}/time`, { method: 'GET' });
      console.log(`[order-client] warmup /time: ${(performance.now() - t1).toFixed(0)}ms`);
    } catch {
      // Ignore warmup errors
    }

    // Then, parallel warmup to /order (matches racing pattern)
    const warmupPromises: Promise<void>[] = [];

    for (let i = 0; i < RACE_CONNECTION_COUNT; i++) {
      const t1 = performance.now();
      warmupPromises.push(
        fetch(`${CLOB_HOST}/order`, { method: 'GET' })
          .then((resp) => {
            console.log(`[order-client] warmup /order #${i + 1}: ${(performance.now() - t1).toFixed(0)}ms (${resp.status})`);
          })
          .catch(() => {
            console.log(`[order-client] warmup /order #${i + 1}: ${(performance.now() - t1).toFixed(0)}ms (error)`);
          })
      );
    }

    await Promise.all(warmupPromises);

    this.state.warmedUp = true;
    this.state.firstTtfb = 50;
    this.state.requestCount = 1;

    const total = performance.now() - t0;
    console.log(`[order-client] ${RACE_CONNECTION_COUNT} connections warmed up in ${total.toFixed(0)}ms`);
  }

  /**
   * Start keep-alive pings to maintain warm connections
   */
  startKeepAlive(): void {
    if (this.keepAliveInterval) return;

    // Ping every 20 seconds
    this.keepAliveInterval = setInterval(async () => {
      try {
        await this.clobClient.getServerTime();
      } catch {
        // Ignore ping errors
      }
    }, 20000);

    // Initial ping to measure baseline latency
    (async () => {
      const t0 = performance.now();
      try {
        await this.clobClient.getServerTime();
        const latency = performance.now() - t0;
        console.log(`[order-client] keep-alive started, latency: ${latency.toFixed(0)}ms`);
      } catch {
        console.log(`[order-client] keep-alive started, initial ping failed`);
      }
    })();
  }

  /**
   * Stop keep-alive pings
   */
  stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Track request timing for connection reuse detection
   */
  trackTtfb(ttfb: number): void {
    this.state.requestCount++;

    if (this.state.requestCount === 1) {
      this.state.firstTtfb = ttfb;
    } else {
      this.state.recentTtfbs.push(ttfb);
      if (this.state.recentTtfbs.length > 10) {
        this.state.recentTtfbs.shift();
      }
    }
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return { ...this.state };
  }

  /**
   * Check if connection is warmed up
   */
  isWarmedUp(): boolean {
    return this.state.warmedUp;
  }
}
