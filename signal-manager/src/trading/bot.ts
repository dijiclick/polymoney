/**
 * Polymarket Trading Bot
 * 
 * Fast FOK (Fill-Or-Kill) trading on Polymarket CLOB.
 * ONLY activates when explicitly enabled by user.
 * Trades minimum amounts for testing.
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';

const CLOB_HOST = 'https://clob.polymarket.com';
const RACE_COUNT = 3;

// Undici pool for persistent connections — lazy init
let _pool: any = null;
async function getPool(): Promise<any> {
  if (_pool) return _pool;
  try {
    const { Pool } = await import('undici');
    _pool = new Pool(CLOB_HOST, {
      connections: 10,
      pipelining: 1,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
    return _pool;
  } catch {
    return null;
  }
}

export interface TradingConfig {
  /** Polymarket CLOB host */
  host: string;
  /** Polygon private key (hex) */
  privateKey: string;
  /** Funder/proxy wallet address */
  funderAddress: string;
  /** 0=EOA, 1=Magic/Email, 2=GnosisSafe */
  signatureType: 0 | 1 | 2;
  /** Chain ID (137 for Polygon) */
  chainId: number;
  /** Whether bot is armed (can actually trade) */
  armed: boolean;
  /** Min trade size in USDC (default: 1.0 — Polymarket minimum is ~$1) */
  minTradeSize: number;
  /** Max trade size in USDC */
  maxTradeSize: number;
  /** Max open positions at once */
  maxOpenPositions: number;
  /** Cooldown between trades on same token (ms) */
  tradeCooldownMs: number;
}

export interface TradeRequest {
  /** Token ID to trade */
  tokenId: string;
  /** BUY or SELL */
  side: 'BUY' | 'SELL';
  /** YES or NO token */
  outcome: 'YES' | 'NO';
  /** Amount in USDC */
  amount: number;
  /** Price (0.01 to 0.99) */
  price: number;
  /** Order type: FOK for fastest, GTC for limit */
  orderType: 'FOK' | 'GTC' | 'GTD';
  /** Tick size for this market */
  tickSize: '0.01' | '0.001';
  /** Whether this is a negRisk market */
  negRisk: boolean;
  /** Event name (for logging) */
  eventName?: string;
  /** Market key (for logging) */
  marketKey?: string;
  /** Signal that triggered this trade */
  signalId?: string;
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  error?: string;
  request: TradeRequest;
  timestamp: number;
  executionMs: number;
}

export interface Position {
  tokenId: string;
  side: 'YES' | 'NO';
  size: number;
  avgPrice: number;
  eventName: string;
  openedAt: number;
}

const DEFAULT_CONFIG: TradingConfig = {
  host: 'https://clob.polymarket.com',
  privateKey: '',
  funderAddress: '',
  signatureType: 0,
  chainId: 137,
  armed: false,       // SAFETY: disabled by default
  minTradeSize: 1.0,  // $1 minimum
  maxTradeSize: 5.0,  // $5 max for testing
  maxOpenPositions: 5,
  tradeCooldownMs: 5000,
};

export class TradingBot extends EventEmitter {
  private config: TradingConfig;
  private client: ClobClient | null = null;
  private initialized = false;
  private positions: Map<string, Position> = new Map();
  private tradeHistory: TradeResult[] = [];
  private lastTradeTime: Map<string, number> = new Map();
  private totalPnL = 0;
  private marketInfoCache: Map<string, { tickSize: string; negRisk: boolean }> = new Map();

  /** Pre-cache tickSize & negRisk for a token (call when PM tokens are discovered) */
  async precacheMarketInfo(tokenId: string): Promise<void> {
    if (this.marketInfoCache.has(tokenId) || !this.client) return;
    try {
      const [ts, nr] = await Promise.all([
        this.client.getTickSize(tokenId).catch(() => '0.01'),
        this.client.getNegRisk(tokenId).catch(() => false),
      ]);
      this.marketInfoCache.set(tokenId, { tickSize: String(ts) || '0.01', negRisk: !!nr });
    } catch { /* ignore */ }
  }
  // Racing credentials (stored after deriveApiKey)
  private apiKey = '';
  private apiSecret = '';
  private apiPassphrase = '';
  private walletAddress = '';
  private hmacKeyBuffer: Buffer | null = null;

  constructor(config: Partial<TradingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Initialize the CLOB client (requires private key) */
  async initialize(): Promise<boolean> {
    if (!this.config.privateKey || !this.config.funderAddress) {
      this.log('WARN', 'Cannot initialize: missing privateKey or funderAddress');
      return false;
    }

    try {
      const signer = new Wallet(this.config.privateKey);

      // Create client with signature type for correct API key derivation
      const tempClient = new ClobClient(
        this.config.host,
        this.config.chainId,
        signer,
        undefined, // no creds yet
        this.config.signatureType,
        this.config.funderAddress
      );
      const creds = await tempClient.createOrDeriveApiKey();

      // Store creds for racing POST
      this.apiKey = (creds as any).apiKey || (creds as any).key || '';
      this.apiSecret = (creds as any).secret || '';
      this.apiPassphrase = (creds as any).passphrase || '';
      // POLY_ADDRESS must match the address the API key was derived for (signer, not funder)
      this.walletAddress = signer.address;
      this.hmacKeyBuffer = Buffer.from(this.apiSecret, 'base64');

      this.log('INFO', `API creds: key=${this.apiKey.slice(0,8)}… secret=${this.apiSecret.length}chars passphrase=${this.apiPassphrase.length}chars addr=${this.walletAddress}`);

      // Warm up undici pool
      getPool().catch(() => {});

      // Reinitialize with full auth
      this.client = new ClobClient(
        this.config.host,
        this.config.chainId,
        signer,
        creds,
        this.config.signatureType,
        this.config.funderAddress
      );

      this.initialized = true;
      this.log('INFO', `Trading bot initialized. Funder: ${this.config.funderAddress}`);
      this.log('INFO', `Armed: ${this.config.armed ? '🔴 YES — LIVE TRADING' : '🟢 NO — DRY RUN'}`);

      // Validate creds by fetching open orders
      try {
        const orders = await this.client.getOpenOrders();
        this.log('INFO', `Creds validated — ${Array.isArray(orders) ? orders.length : 0} open orders`);
      } catch (e: any) {
        this.log('ERROR', `Creds validation FAILED: ${e.message}`);
      }
      return true;
    } catch (err: any) {
      this.log('ERROR', `Failed to initialize: ${err.message}`);
      return false;
    }
  }

  /** ARM the bot — enables real trading */
  arm(): void {
    this.config.armed = true;
    this.log('WARN', '🔴 BOT ARMED — Live trading enabled!');
    this.emit('armed');
  }

  /** DISARM the bot — stops real trading */
  disarm(): void {
    this.config.armed = false;
    this.log('INFO', '🟢 Bot disarmed — dry run mode');
    this.emit('disarmed');
  }

  get isArmed(): boolean { return this.config.armed; }
  get isInitialized(): boolean { return this.initialized; }

  /** Execute a trade (FOK for speed) */
  async trade(req: TradeRequest): Promise<TradeResult> {
    const start = Date.now();
    const result: TradeResult = {
      success: false,
      request: req,
      timestamp: start,
      executionMs: 0,
    };

    // Safety checks
    if (!this.initialized || !this.client) {
      result.error = 'Bot not initialized';
      result.executionMs = Date.now() - start;
      this.tradeHistory.push(result);
      return result;
    }

    if (!this.config.armed) {
      // Dry run — simulate
      result.success = true;
      result.orderId = `DRY-${Date.now()}`;
      result.executionMs = Date.now() - start;
      this.log('INFO', `[DRY RUN] ${req.side} ${req.outcome} $${req.amount} @ ${req.price} on ${req.eventName || req.tokenId}`);
      this.tradeHistory.push(result);
      this.emit('trade', result);
      return result;
    }

    // Amount bounds (only enforce on BUY — sells need to close full position)
    if (req.side === 'BUY') {
      if (req.amount < this.config.minTradeSize) {
        result.error = `Amount $${req.amount} below minimum $${this.config.minTradeSize}`;
        result.executionMs = Date.now() - start;
        this.tradeHistory.push(result);
        return result;
      }
      if (req.amount > this.config.maxTradeSize) {
        result.error = `Amount $${req.amount} above maximum $${this.config.maxTradeSize}`;
        result.executionMs = Date.now() - start;
        this.tradeHistory.push(result);
        return result;
      }
    }

    // No cooldown — execute immediately

    // Position limit check
    if (req.side === 'BUY' && this.positions.size >= this.config.maxOpenPositions) {
      result.error = `Max positions (${this.config.maxOpenPositions}) reached`;
      result.executionMs = Date.now() - start;
      this.tradeHistory.push(result);
      return result;
    }

    try {
      const side = req.side === 'BUY' ? Side.BUY : Side.SELL;
      let size = req.side === 'BUY'
        ? Math.floor(req.amount / req.price)  // shares from USDC amount
        : req.amount / req.price;              // for sells, amount already computed

      // Enforce $1 minimum for marketable orders
      if (size * req.price < 1 && req.price > 0) {
        size = Math.ceil(1 / req.price);
      }

      // Use createAndPostOrder for all order types (explicit price control)
      const orderType = req.orderType === 'GTD' ? OrderType.GTD
        : req.orderType === 'GTC' ? OrderType.GTC
        : 'FOK' as any;

      // Step 1: Sign the order via SDK (handles CTF exchange signature)
      const signedOrder = await this.client.createOrder(
        {
          tokenID: req.tokenId,
          price: req.price,
          side,
          size,
        },
        { tickSize: req.tickSize, negRisk: req.negRisk },
      );

      // Step 2: Submit via racing POST (3 parallel, first wins)
      const resp = await this.racePostOrder(signedOrder, orderType === 'FOK' ? 'FAK' : String(orderType));
      result.success = !!resp?.orderID && !resp?.errorMsg;
      result.orderId = resp?.orderID;

      // Track position
      if (result.success && req.side === 'BUY') {
        this.positions.set(req.tokenId, {
          tokenId: req.tokenId,
          side: req.outcome,
          size: req.amount / req.price,
          avgPrice: req.price,
          eventName: req.eventName || '',
          openedAt: start,
        });
      } else if (result.success && req.side === 'SELL') {
        this.positions.delete(req.tokenId);
      }

      this.lastTradeTime.set(req.tokenId, Date.now());
      result.executionMs = Date.now() - start;

      if (result.success) {
        this.log('WARN', `✅ ${req.side} ${req.outcome} $${req.amount} @ ${req.price} — ${result.executionMs}ms — ${req.eventName || req.tokenId} [${result.orderId?.slice(0, 8)}]`);
      } else {
        this.log('INFO', `⚪ ${req.side} ${req.outcome} NOT FILLED @ ${req.price} — ${result.executionMs}ms — ${req.eventName || req.tokenId}`);
      }
    } catch (err: any) {
      result.error = err.message;
      result.executionMs = Date.now() - start;
      this.log('ERROR', `❌ Trade failed: ${err.message}`);
    }

    this.tradeHistory.push(result);
    this.emit('trade', result);
    return result;
  }

  /** Quick buy YES shares at best ask (FOK) */
  async buyYes(tokenId: string, amount: number, price: number, opts: { tickSize?: '0.01' | '0.001'; negRisk?: boolean; eventName?: string; orderType?: 'FOK' | 'GTC' } = {}): Promise<TradeResult> {
    return this.buyOutcome(tokenId, 'YES', amount, price, opts);
  }

  /** Quick buy NO shares at best ask (FOK) */
  async buyNo(tokenId: string, amount: number, price: number, opts: { tickSize?: '0.01' | '0.001'; negRisk?: boolean; eventName?: string; orderType?: 'FOK' | 'GTC' } = {}): Promise<TradeResult> {
    return this.buyOutcome(tokenId, 'NO', amount, price, opts);
  }

  /** Buy at market — reads orderbook for best ask (FOK) */
  async buyAtMarket(tokenId: string, outcome: 'YES' | 'NO', amount: number, opts: { eventName?: string; price?: number } = {}): Promise<TradeResult> {
    return this.buyOutcome(tokenId, outcome, amount, opts.price || 0, { ...opts, orderType: 'FOK' });
  }

  /** Internal: buy with orderbook best-ask detection and auto tickSize/negRisk */
  private async buyOutcome(tokenId: string, outcome: 'YES' | 'NO', amount: number, price: number, opts: { tickSize?: '0.01' | '0.001'; negRisk?: boolean; eventName?: string; orderType?: 'FOK' | 'GTC' } = {}): Promise<TradeResult> {
    const start = Date.now();

    if (!this.initialized || !this.client) {
      return { success: false, error: 'Bot not initialized', request: { tokenId, side: 'BUY', outcome, amount, price, orderType: 'FOK', tickSize: '0.01', negRisk: false, eventName: opts.eventName }, timestamp: start, executionMs: 0 };
    }

    // Auto-detect tickSize and negRisk (cached + parallel for speed)
    let tickSize: string = opts.tickSize || '0.01';
    let negRisk = opts.negRisk ?? false;
    const needTickSize = !opts.tickSize;
    const needNegRisk = opts.negRisk === undefined;
    if (needTickSize || needNegRisk) {
      const cached = this.marketInfoCache.get(tokenId);
      if (cached) {
        if (needTickSize) tickSize = cached.tickSize;
        if (needNegRisk) negRisk = cached.negRisk;
      } else {
        const [ts, nr] = await Promise.all([
          needTickSize ? this.client!.getTickSize(tokenId).catch(() => '0.01') : tickSize,
          needNegRisk ? this.client!.getNegRisk(tokenId).catch(() => false) : negRisk,
        ]);
        if (needTickSize) tickSize = String(ts) || '0.01';
        if (needNegRisk) negRisk = !!nr;
        this.marketInfoCache.set(tokenId, { tickSize, negRisk: !!negRisk });
      }
    }

    // Read orderbook for best ask if no price provided
    let buyPrice = price;
    if (!buyPrice || buyPrice <= 0) {
      try {
        const bookRes = await this.client.getOrderBook(tokenId);
        const asks = bookRes?.asks || [];
        if (asks.length === 0) {
          return { success: false, error: 'no_asks_in_orderbook', request: { tokenId, side: 'BUY', outcome, amount, price: 0, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
        }
        buyPrice = Math.min(...asks.map((a: any) => Number(a.price)));
      } catch (err: any) {
        return { success: false, error: `orderbook_error: ${err.message}`, request: { tokenId, side: 'BUY', outcome, amount, price: 0, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
      }
    }

    if (buyPrice <= 0 || buyPrice >= 1) {
      return { success: false, error: `invalid_price_${buyPrice}`, request: { tokenId, side: 'BUY', outcome, amount, price: buyPrice, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
    }

    // Polymarket minimum: $1 for marketable (FAK/FOK), 5 shares for GTC
    let shares = Math.floor(amount / buyPrice);
    const isMarketable = (opts.orderType || 'FOK') !== 'GTC';
    if (isMarketable) {
      // FAK/FOK: minimum $1 order value
      if (shares * buyPrice < 1) {
        shares = Math.ceil(1 / buyPrice);
      }
    } else {
      // GTC: minimum 5 shares
      if (shares < 5) shares = 5;
    }
    if (shares < 1) {
      return { success: false, error: 'order_too_small', request: { tokenId, side: 'BUY', outcome, amount, price: buyPrice, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
    }

    return this.trade({
      tokenId,
      side: 'BUY',
      outcome,
      amount: shares * buyPrice,
      price: buyPrice,
      orderType: opts.orderType || 'FOK',
      tickSize: tickSize as any,
      negRisk,
      eventName: opts.eventName,
    });
  }

  /** Get orderbook summary (best bid/ask, spread, depth) */
  async getOrderBookSummary(tokenId: string): Promise<{ bestBid: number | null; bestAsk: number | null; spread: number | null; bidDepth: number; askDepth: number } | null> {
    if (!this.client) return null;
    try {
      const bookRes = await this.client.getOrderBook(tokenId);
      const bids = bookRes?.bids || [];
      const asks = bookRes?.asks || [];
      const bestBid = bids.length > 0 ? Math.max(...bids.map((b: any) => Number(b.price))) : null;
      const bestAsk = asks.length > 0 ? Math.min(...asks.map((a: any) => Number(a.price))) : null;
      const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
      const bidDepth = bids.reduce((sum: number, b: any) => sum + Number(b.size) * Number(b.price), 0);
      const askDepth = asks.reduce((sum: number, a: any) => sum + Number(a.size) * Number(a.price), 0);
      return { bestBid, bestAsk, spread, bidDepth, askDepth };
    } catch { return null; }
  }

  /** Sell an existing position at best bid (FOK) */
  async sellPosition(tokenId: string, shares: number, price: number, opts: { eventName?: string } = {}): Promise<TradeResult> {
    const start = Date.now();
    const pos = this.positions.get(tokenId);
    const outcome = pos?.side || 'YES';

    if (!this.initialized || !this.client) {
      return { success: false, error: 'Bot not initialized', request: { tokenId, side: 'SELL', outcome, amount: shares * price, price, orderType: 'FOK', tickSize: '0.01', negRisk: false, eventName: opts.eventName }, timestamp: start, executionMs: 0 };
    }

    // Get tick size and negRisk (cached + parallel for speed)
    let tickSize: string = '0.01';
    let negRisk = false;
    const cached = this.marketInfoCache.get(tokenId);
    if (cached) {
      tickSize = cached.tickSize;
      negRisk = cached.negRisk;
    } else {
      const [ts, nr] = await Promise.all([
        this.client!.getTickSize(tokenId).catch(() => '0.01'),
        this.client!.getNegRisk(tokenId).catch(() => false),
      ]);
      tickSize = String(ts) || '0.01';
      negRisk = !!nr;
      this.marketInfoCache.set(tokenId, { tickSize, negRisk });
    }

    // Read orderbook to find best bid (skip if price already provided for speed)
    let bestBid = price;
    if (price <= 0.01) {
      try {
        const bookRes = await this.client.getOrderBook(tokenId);
        const bids = bookRes?.bids || [];
        if (bids.length > 0) {
          bestBid = Math.max(...bids.map((b: any) => Number(b.price)));
        }
      } catch { /* use provided price */ }
    }

    if (bestBid <= 0.01) {
      return { success: false, error: `best_bid_too_low_${(bestBid * 100).toFixed(1)}c`, request: { tokenId, side: 'SELL', outcome, amount: shares * bestBid, price: bestBid, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
    }

    let sellShares = Math.floor(shares * 100) / 100;
    if (sellShares < 0.01) {
      return { success: false, error: 'shares_too_small', request: { tokenId, side: 'SELL', outcome, amount: sellShares * bestBid, price: bestBid, orderType: 'FOK', tickSize: tickSize as any, negRisk, eventName: opts.eventName }, timestamp: start, executionMs: Date.now() - start };
    }

    // Polymarket minimum: $1 for marketable (FAK/FOK) sells
    if (sellShares * bestBid < 1 && bestBid > 0) {
      // Bump shares to meet $1 minimum (will sell what we have — CLOB handles partial)
      sellShares = Math.max(sellShares, Math.ceil(1 / bestBid));
    }

    return this.trade({
      tokenId,
      side: 'SELL',
      outcome,
      amount: sellShares * bestBid,
      price: bestBid,
      orderType: 'FOK',
      tickSize: tickSize as any,
      negRisk,
      eventName: opts.eventName,
    });
  }

  /** Get a position by tokenId */
  getPosition(tokenId: string): Position | undefined {
    return this.positions.get(tokenId);
  }

  /** Cancel all open orders */
  async cancelAll(): Promise<boolean> {
    if (!this.client || !this.initialized) return false;
    try {
      await this.client.cancelAll();
      this.log('INFO', 'All orders cancelled');
      return true;
    } catch (err: any) {
      this.log('ERROR', `Cancel all failed: ${err.message}`);
      return false;
    }
  }

  /** Get current orderbook for a token */
  async getOrderBook(tokenId: string) {
    if (!this.client) return null;
    try {
      return await this.client.getOrderBook(tokenId);
    } catch { return null; }
  }

  /** Get midpoint price for a token */
  async getMidpoint(tokenId: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      const mid = await this.client.getMidpoint(tokenId);
      return parseFloat(mid as any);
    } catch { return null; }
  }

  /** Get open orders */
  async getOpenOrders() {
    if (!this.client) return [];
    try {
      return await this.client.getOpenOrders();
    } catch { return []; }
  }

  /** Get state for dashboard */
  getState() {
    return {
      initialized: this.initialized,
      armed: this.config.armed,
      positions: Object.fromEntries(this.positions),
      openPositions: this.positions.size,
      maxPositions: this.config.maxOpenPositions,
      tradeCount: this.tradeHistory.length,
      recentTrades: this.tradeHistory.slice(-20),
      totalPnL: this.totalPnL,
      minTradeSize: this.config.minTradeSize,
      maxTradeSize: this.config.maxTradeSize,
    };
  }

  /** Race N parallel POST /order requests — first successful response wins */
  private async racePostOrder(signedOrder: any, orderType: string): Promise<{ orderID?: string; errorMsg?: string }> {
    const payload = {
      deferExec: false,
      order: {
        salt: parseInt(signedOrder.salt, 10),
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        taker: signedOrder.taker,
        tokenId: signedOrder.tokenId,
        makerAmount: signedOrder.makerAmount,
        takerAmount: signedOrder.takerAmount,
        side: signedOrder.side === 0 ? 'BUY' : 'SELL',
        expiration: signedOrder.expiration,
        nonce: signedOrder.nonce,
        feeRateBps: signedOrder.feeRateBps,
        signatureType: signedOrder.signatureType,
        signature: signedOrder.signature,
      },
      owner: this.apiKey,
      orderType,
      postOnly: false,
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${timestamp}POST/order${body}`;
    const signature = createHmac('sha256', this.hmacKeyBuffer!)
      .update(message)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'POLY_ADDRESS': this.walletAddress,
      'POLY_SIGNATURE': signature,
      'POLY_TIMESTAMP': `${timestamp}`,
      'POLY_API_KEY': this.apiKey,
      'POLY_PASSPHRASE': this.apiPassphrase,
    };

    const pool = await getPool();

    return new Promise((resolve, reject) => {
      let resolved = false;
      let completed = 0;
      const errors: string[] = [];

      for (let i = 0; i < RACE_COUNT; i++) {
        const t0 = performance.now();

        const req = pool
          ? pool.request({ method: 'POST', path: '/order', headers, body })
              .then(async ({ statusCode, body: rb }: any) => ({ statusCode, text: await rb.text() }))
          : fetch(`${CLOB_HOST}/order`, { method: 'POST', headers, body })
              .then(async (r) => ({ statusCode: r.status, text: await r.text() }));

        req
          .then(({ statusCode, text }: { statusCode: number; text: string }) => {
            const ms = (performance.now() - t0).toFixed(0);
            let data: any;
            try { data = JSON.parse(text); } catch { data = { error: text }; }

            if (statusCode >= 200 && statusCode < 300 && data?.orderID && !data?.errorMsg) {
              if (!resolved) {
                resolved = true;
                this.log('INFO', `⚡ Race #${i+1} won: ${ms}ms [${data.orderID.slice(0,8)}]`);
                resolve(data);
              }
            } else {
              const err = data?.error || data?.errorMsg || `HTTP ${statusCode}`;
              if (err.includes('Duplicat') || err.includes('duplicat')) {
                this.log('INFO', `  Race #${i+1}: ${ms}ms (duplicate — other won)`);
              } else {
                errors.push(err);
                this.log('WARN', `  Race #${i+1}: ${ms}ms HTTP${statusCode} — ${JSON.stringify(data).slice(0,200)}`);
              }
            }
          })
          .catch((e: any) => {
            errors.push(e.message || String(e));
          })
          .finally(() => {
            completed++;
            if (completed === RACE_COUNT && !resolved) {
              reject(new Error(`All ${RACE_COUNT} racing requests failed: ${errors.join('; ')}`));
            }
          });
      }
    });
  }

  private log(level: string, msg: string) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${level}] [trading-bot] ${msg}`);
  }
}
