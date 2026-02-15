/**
 * Pre-Sign Manager
 *
 * Caches market parameters and pre-signs orders for instant submission.
 * Missing from original zip — reconstructed from usage in index.ts.
 */

import type { ClobClient } from '@polymarket/clob-client';
import type { MarketTokens, OrderDirection } from './types.js';

export class PreSignManager {
  private clobClient: ClobClient;
  private tokens: MarketTokens;
  private marketParams: Map<string, any> = new Map();
  private preSignedOrders: Map<string, any> = new Map();
  private lastRefresh: number = 0;
  private refreshIntervalMs = 60_000; // Re-sign every 60s

  constructor(clobClient: ClobClient, tokens: MarketTokens) {
    this.clobClient = clobClient;
    this.tokens = tokens;
  }

  getTokenId(direction: OrderDirection): string {
    return direction === 'yes' ? this.tokens.yes : this.tokens.no;
  }

  async cacheAllMarketParams(): Promise<void> {
    for (const [side, tokenId] of [['yes', this.tokens.yes], ['no', this.tokens.no]] as const) {
      try {
        // Fetch tick size and min order size from CLOB
        const orderBook = await (this.clobClient as any).getOrderBook(tokenId);
        this.marketParams.set(tokenId, {
          tickSize: orderBook?.min_tick_size || '0.01',
          minSize: orderBook?.minimum_order_size || 1,
        });
        console.log(`[presign] Cached market params for ${side}: tick=${this.marketParams.get(tokenId)?.tickSize}`);
      } catch (e: any) {
        console.warn(`[presign] Failed to cache params for ${side}: ${e.message}`);
        this.marketParams.set(tokenId, { tickSize: '0.01', minSize: 1 });
      }
    }
  }

  async preSignOrders(defaultShares: number): Promise<void> {
    // Pre-sign orders for common price points (90-99¢)
    for (const direction of ['yes', 'no'] as OrderDirection[]) {
      const tokenId = this.getTokenId(direction);
      for (let price = 90; price <= 99; price++) {
        const key = `${direction}-${price}`;
        try {
          const order = await (this.clobClient as any).createOrder({
            tokenID: tokenId,
            price: price / 100,
            size: defaultShares,
            side: 'BUY',
          });
          this.preSignedOrders.set(key, order);
        } catch (e: any) {
          // Non-critical — will sign on-demand
        }
      }
    }
    this.lastRefresh = Date.now();
    console.log(`[presign] Pre-signed ${this.preSignedOrders.size} orders`);
  }

  async refreshIfNeeded(shares?: number): Promise<void> {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      await this.preSignOrders(shares || 10);
    }
  }

  getPreSignedOrder(direction: OrderDirection, priceCents: number): any | null {
    return this.preSignedOrders.get(`${direction}-${priceCents}`) || null;
  }

  getCachedOrderOptions(tokenId: string): any {
    return this.marketParams.get(tokenId) || { tickSize: '0.01', minSize: 1 };
  }

  getMinSharesForPrice(priceCents: number): number {
    // Minimum $1 trade / price = min shares
    return Math.ceil(100 / priceCents);
  }
}
