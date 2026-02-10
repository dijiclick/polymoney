/**
 * Polymarket Trading Bot
 * 
 * Fast FOK (Fill-Or-Kill) trading on Polymarket CLOB.
 * ONLY activates when explicitly enabled by user.
 * Trades minimum amounts for testing.
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { EventEmitter } from 'events';

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
      
      // Create client and derive API creds
      const tempClient = new ClobClient(
        this.config.host,
        this.config.chainId,
        signer
      );
      const creds = await tempClient.createOrDeriveApiKey();
      
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

    // Amount bounds
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

    // Cooldown check
    const lastTrade = this.lastTradeTime.get(req.tokenId);
    if (lastTrade && (start - lastTrade) < this.config.tradeCooldownMs) {
      result.error = `Cooldown: ${this.config.tradeCooldownMs - (start - lastTrade)}ms remaining`;
      result.executionMs = Date.now() - start;
      this.tradeHistory.push(result);
      return result;
    }

    // Position limit check
    if (req.side === 'BUY' && this.positions.size >= this.config.maxOpenPositions) {
      result.error = `Max positions (${this.config.maxOpenPositions}) reached`;
      result.executionMs = Date.now() - start;
      this.tradeHistory.push(result);
      return result;
    }

    try {
      const side = req.side === 'BUY' ? Side.BUY : Side.SELL;
      const size = req.amount / req.price; // Convert USDC amount to shares

      if (req.orderType === 'FOK') {
        // Market order (FOK) — fastest execution
        const signed = await this.client.createMarketOrder({
          tokenID: req.tokenId,
          amount: req.amount,
          side,
          orderType: OrderType.FOK,
        });
        const resp = await this.client.postOrder(signed, OrderType.FOK);
        result.success = resp?.success ?? !!resp?.orderID;
        result.orderId = resp?.orderID;
      } else {
        // Limit order (GTC/GTD)
        const orderType = req.orderType === 'GTD' ? OrderType.GTD : OrderType.GTC;
        const resp = await this.client.createAndPostOrder(
          {
            tokenID: req.tokenId,
            price: req.price,
            side,
            size,
          },
          { tickSize: req.tickSize, negRisk: req.negRisk },
          orderType
        );
        result.success = resp?.success ?? !!resp?.orderID;
        result.orderId = resp?.orderID;
      }

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

      this.log('INFO', `✅ ${req.side} ${req.outcome} $${req.amount} @ ${req.price} — ${result.executionMs}ms — ${req.eventName || req.tokenId}`);
    } catch (err: any) {
      result.error = err.message;
      result.executionMs = Date.now() - start;
      this.log('ERROR', `❌ Trade failed: ${err.message}`);
    }

    this.tradeHistory.push(result);
    this.emit('trade', result);
    return result;
  }

  /** Quick buy YES shares at market price */
  async buyYes(tokenId: string, amount: number, price: number, opts: { tickSize?: '0.01' | '0.001'; negRisk?: boolean; eventName?: string } = {}): Promise<TradeResult> {
    return this.trade({
      tokenId,
      side: 'BUY',
      outcome: 'YES',
      amount,
      price,
      orderType: 'FOK',
      tickSize: opts.tickSize || '0.01',
      negRisk: opts.negRisk ?? false,
      eventName: opts.eventName,
    });
  }

  /** Quick buy NO shares at market price */
  async buyNo(tokenId: string, amount: number, price: number, opts: { tickSize?: '0.01' | '0.001'; negRisk?: boolean; eventName?: string } = {}): Promise<TradeResult> {
    return this.trade({
      tokenId,
      side: 'BUY',
      outcome: 'NO',
      amount,
      price,
      orderType: 'FOK',
      tickSize: opts.tickSize || '0.01',
      negRisk: opts.negRisk ?? false,
      eventName: opts.eventName,
    });
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

  private log(level: string, msg: string) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${level}] [trading-bot] ${msg}`);
  }
}
