/**
 * Order Client
 *
 * A standalone, reusable module for placing orders on Polymarket.
 * Handles connection warmup, pre-signing, and fast order submission.
 *
 * @example
 * ```typescript
 * import { createOrderClient } from './src/order-client';
 *
 * const client = await createOrderClient({
 *   privateKey: '0x...',
 *   tokens: { yes: 'token-id-yes', no: 'token-id-no' },
 * });
 *
 * const result = await client.buy('yes', 4, 24);  // buy 4 shares at 24¢
 * await client.stop();
 * ```
 */

import { Wallet } from 'ethers';
import { ClobClient, Side } from '@polymarket/clob-client';
import { ConnectionManager } from './connection.js';
import { PreSignManager } from './presign.js';
import { fastPostOrderRacing, warmupPool, getPoolStats } from './racing.js';
import type {
  OrderClientConfig,
  DerivedCredentials,
  MarketTokens,
  OrderDirection,
  OrderResult,
} from './types.js';

export * from './types.js';

const CLOB_API_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137; // Polygon mainnet

export class OrderClient {
  private connection!: ConnectionManager;
  private presign!: PreSignManager;
  private clobClient!: ClobClient;
  private tokens: MarketTokens;
  private privateKey: string;
  private proxyAddress?: string;
  private signatureType: number;
  private defaultShares: number;
  private initialized: boolean = false;
  private lastPreSignShares: number = 0;

  constructor(config: OrderClientConfig) {
    this.privateKey = config.privateKey;
    this.tokens = config.tokens;
    this.defaultShares = config.defaultShares;
    this.proxyAddress = config.proxyAddress;
    this.signatureType = config.signatureType ?? 0;
  }

  /**
   * Initialize the client (create wallet, derive credentials, warmup, pre-sign)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create wallet from private key
    const wallet = new Wallet(this.privateKey);
    const walletAddress = wallet.address;
    console.log(`[order-client] wallet: ${walletAddress}`);

    // Create initial CLOB client with wallet for L1 auth
    const initialClient = new ClobClient(
      CLOB_API_URL,
      CHAIN_ID,
      wallet,
      undefined,
      this.signatureType,
      this.proxyAddress
    );

    // Derive API credentials
    console.log('[order-client] deriving API credentials...');
    const rawCredentials = await initialClient.createOrDeriveApiKey();
    const credentials: DerivedCredentials = {
      apiKey: rawCredentials.key,
      apiSecret: rawCredentials.secret,
      apiPassphrase: rawCredentials.passphrase,
    };
    console.log('[order-client] credentials obtained');

    // Create authenticated CLOB client with L2 credentials
    this.clobClient = new ClobClient(
      CLOB_API_URL,
      CHAIN_ID,
      wallet,
      {
        key: credentials.apiKey,
        secret: credentials.apiSecret,
        passphrase: credentials.apiPassphrase,
      },
      this.signatureType,
      this.proxyAddress
    );

    // Initialize connection manager and presign manager
    this.connection = new ConnectionManager(
      credentials,
      walletAddress,
      this.clobClient
    );
    this.presign = new PreSignManager(this.clobClient, this.tokens);

    // Warm up connections (legacy + undici pool)
    await this.connection.warmup();
    await warmupPool();

    // Cache market params
    await this.presign.cacheAllMarketParams();

    // Pre-sign orders
    await this.presign.preSignOrders(this.defaultShares);
    this.lastPreSignShares = this.defaultShares;

    // Start keep-alive pings
    this.connection.startKeepAlive();

    this.initialized = true;
    console.log('[order-client] initialized');
  }

  /**
   * Buy shares of an outcome
   *
   * @param direction - 'yes' or 'no'
   * @param shares - Number of shares to buy
   * @param priceCents - Price in cents (1-99)
   * @returns Order result with success status and fill info
   */
  async buy(direction: OrderDirection, shares: number, priceCents: number): Promise<OrderResult> {
    if (!this.initialized) {
      return { success: false, error: 'Client not initialized' };
    }

    if (priceCents < 1 || priceCents > 99) {
      return { success: false, error: 'Price must be between 1 and 99 cents' };
    }

    // Refresh pre-signed orders if period changed or size changed
    await this.presign.refreshIfNeeded(shares);

    const tokenId = this.presign.getTokenId(direction);
    const cachedOptions = this.presign.getCachedOrderOptions(tokenId);

    if (!cachedOptions) {
      return { success: false, error: 'Market params not cached' };
    }

    // Try to use pre-signed order first
    const preSignedOrder = this.presign.getPreSignedOrder(direction, priceCents);

    try {
      const startTime = performance.now();
      let result: any;
      let orderSize: number;

      if (preSignedOrder && preSignedOrder.size >= shares) {
        // Use pre-signed order (fast path)
        console.log(`⚡ [order-client] using pre-signed order for ${direction} @ ${priceCents}¢`);
        result = await fastPostOrderRacing(preSignedOrder.signedOrder, this.connection);
        orderSize = preSignedOrder.size;
      } else {
        // Fall back to fresh order (slower path)
        console.log(`📝 [order-client] creating fresh order for ${direction} @ ${priceCents}¢`);
        const minShares = this.presign.getMinSharesForPrice(priceCents);
        orderSize = Math.max(shares, minShares);

        const signedOrder = await (this.clobClient as any).createOrder({
          tokenID: tokenId,
          side: Side.BUY,
          price: priceCents / 100,
          size: orderSize,
        }, cachedOptions);

        result = await fastPostOrderRacing(signedOrder, this.connection);
      }

      const elapsed = performance.now() - startTime;

      if (result && result.orderID && !result.errorMsg) {
        console.log(`✅ [order-client] order success: ${result.orderID.slice(0, 12)}... (${elapsed.toFixed(0)}ms)`);
        return {
          success: true,
          orderId: result.orderID,
        };
      } else {
        const errMsg = result?.errorMsg || 'No orderID returned';
        console.log(`❌ [order-client] order failed: ${errMsg} (${elapsed.toFixed(0)}ms)`);
        return { success: false, error: errMsg };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`❌ [order-client] order error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    this.connection.stopKeepAlive();
    this.initialized = false;
    console.log('[order-client] stopped');
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the authenticated CLOB client (for external use like fetching orders)
   */
  getClobClient(): ClobClient {
    return this.clobClient;
  }
}

/**
 * Create and initialize an order client
 *
 * @param config - Configuration with privateKey, tokens, and defaultShares
 */
export async function createOrderClient(config: OrderClientConfig): Promise<OrderClient> {
  const client = new OrderClient(config);
  await client.initialize();
  return client;
}

// Export pool utilities for debugging
export { getPoolStats };
