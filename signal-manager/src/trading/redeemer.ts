/**
 * Auto-Redeemer — Automatically redeem resolved Polymarket positions
 *
 * Tries gasless relay first (Polymarket pays gas), falls back to on-chain proxy.
 * Works for both winning (returns USDC) and losing (burns tokens, clears position).
 *
 * Also supports selling active positions at best bid via CLOB (for non-resolved markets).
 */

import { Wallet } from '@ethersproject/wallet';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import { createLogger } from '../util/logger.js';

const log = createLogger('redeemer');

const POLYGON_RPC = 'https://polygon-rpc.com';
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const CT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CT_ABI = ['function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external'];
const PROXY_ABI = ['function exec(address to, uint256 value, bytes data) external returns (bool, bytes memory)'];
const ZERO_BYTES32 = '0x' + '0'.repeat(64);

interface TradingBot {
  sellPosition(tokenId: string, shares: number, price: number, opts?: { eventName?: string }): Promise<any>;
}

export class AutoRedeemer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private funderAddress: string;
  private checkIntervalMs: number;
  private tradingBot: TradingBot | null = null;
  private redeemHistory: { time: number; title: string; amount: number; pnl: number; method: string }[] = [];
  private failedAssets: Map<string, number> = new Map();  // asset → fail count, skip after 3 failures

  // On-chain redemption
  private connectedWallet: any = null;
  private relayClient: any = null;

  constructor(privateKey: string, funderAddress: string, checkIntervalMs = 60_000) {
    this.funderAddress = funderAddress;
    this.checkIntervalMs = checkIntervalMs;

    // Set up on-chain wallet
    try {
      const wallet = new Wallet(privateKey);
      const provider = new JsonRpcProvider(POLYGON_RPC);
      this.connectedWallet = wallet.connect(provider);
    } catch (err: any) {
      log.error(`Failed to create wallet: ${err.message}`);
    }

    // Set up builder relay (gasless redemption) if credentials available
    const builderKey = process.env.POLY_BUILDER_KEY;
    const builderSecret = process.env.POLY_BUILDER_SECRET;
    const builderPassphrase = process.env.POLY_BUILDER_PASSPHRASE;

    if (builderKey && builderSecret && builderPassphrase) {
      this.initRelay(builderKey, builderSecret, builderPassphrase).catch(() => {});
    }
  }

  private async initRelay(key: string, secret: string, passphrase: string): Promise<void> {
    try {
      const relayPkg = await import('@polymarket/builder-relayer-client');
      const { BuilderConfig } = await import('@polymarket/builder-signing-sdk');
      const builderCreds = { key, secret, passphrase };
      const builderConfig = new BuilderConfig({ localBuilderCreds: builderCreds });
      const sigType = Number(process.env.POLY_SIGNATURE_TYPE || '1');
      const relayTxType = sigType === 1 ? relayPkg.RelayerTxType.PROXY : relayPkg.RelayerTxType.SAFE;
      this.relayClient = new relayPkg.RelayClient(RELAYER_URL, 137, this.connectedWallet, builderConfig, relayTxType);
      log.warn('Builder relay initialized (gasless redemption available)');
    } catch (err: any) {
      log.error(`Builder relay init failed: ${err.message} — will use CLOB sell fallback`);
    }
  }

  setTradingBot(bot: TradingBot): void {
    this.tradingBot = bot;
  }

  start(): void {
    if (this.timer) return;
    const hasRelay = !!this.relayClient;
    const hasOnChain = !!this.connectedWallet;
    const hasCLOB = !!this.tradingBot;
    log.warn(`Auto-redeemer started (checking every ${this.checkIntervalMs / 1000}s) — relay:${hasRelay} onchain:${hasOnChain} clob-sell:${hasCLOB}`);
    this.checkAndRedeem().catch(() => {});
    this.timer = setInterval(() => this.checkAndRedeem().catch(() => {}), this.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkAndRedeem(): Promise<void> {
    try {
      const resp = await fetch(
        `https://data-api.polymarket.com/positions?user=${this.funderAddress}&redeemable=true&sizeThreshold=0`,
        { signal: AbortSignal.timeout(10000) }
      );

      if (!resp.ok) {
        log.error(`Failed to fetch positions: ${resp.status}`);
        return;
      }

      const positions: any[] = await resp.json();
      const redeemable = positions.filter((p: any) => p.redeemable && Number(p.size) > 0);

      if (redeemable.length === 0) return;

      log.warn(`Found ${redeemable.length} redeemable position(s)`);

      // Dedupe by conditionId for on-chain redemption
      const seen = new Set<string>();
      for (const pos of redeemable) {
        const conditionId = pos.conditionId;
        if (conditionId && seen.has(conditionId)) continue;
        if (conditionId) seen.add(conditionId);

        try {
          await this.redeemPosition(pos);
        } catch (err: any) {
          log.error(`Redeem failed for ${pos.title || '?'}: ${err.message}`);
        }
      }
    } catch (err: any) {
      if (!err.message?.includes('abort')) {
        log.error(`Redeem check failed: ${err.message}`);
      }
    }
  }

  private async redeemPosition(pos: any): Promise<void> {
    const title = pos.title || '?';
    const size = Number(pos.size) || 0;
    const pnl = Number(pos.cashPnl) || 0;
    const asset = pos.asset || '';
    const curPrice = Number(pos.curPrice) || 0;
    const conditionId = pos.conditionId || '';

    // For resolved losing positions (curPrice=0), nothing to recover via sell
    if (curPrice <= 0.01 && !conditionId) {
      log.warn(`⚠️ ${title} — resolved at $0, nothing to recover`);
      return;
    }

    // Method 1: On-chain redemption via relay (gasless — preferred)
    if (conditionId && this.relayClient) {
      log.warn(`💰 REDEEMING via relay | ${title} | ${size.toFixed(2)} shares | P&L: $${pnl.toFixed(2)}`);
      try {
        const result = await this.redeemByConditionId(conditionId);
        if (result.success) {
          log.warn(`✅ REDEEMED (relay) | ${title} | tx: ${result.txHash}`);
          this.redeemHistory.unshift({ time: Date.now(), title, amount: size * curPrice, pnl, method: 'relay' });
          if (this.redeemHistory.length > 50) this.redeemHistory.length = 50;
          return;
        }
      } catch (err: any) {
        log.error(`Relay redeem failed for ${title}: ${err.message} — trying fallback`);
      }
    }

    // Method 2: On-chain redemption via proxy (requires MATIC)
    if (conditionId && this.connectedWallet) {
      log.warn(`💰 REDEEMING via on-chain proxy | ${title} | ${size.toFixed(2)} shares`);
      try {
        const result = await this.redeemByConditionId(conditionId);
        if (result.success) {
          log.warn(`✅ REDEEMED (onchain) | ${title} | tx: ${result.txHash}`);
          this.redeemHistory.unshift({ time: Date.now(), title, amount: size * curPrice, pnl, method: 'onchain' });
          if (this.redeemHistory.length > 50) this.redeemHistory.length = 50;
          return;
        }
      } catch (err: any) {
        log.error(`On-chain redeem failed for ${title}: ${err.message} — trying CLOB sell`);
      }
    }

    // Method 3: CLOB sell fallback (gasless — sells at best bid)
    if (curPrice <= 0.01) {
      log.warn(`⚠️ ${title} — resolved at $0, nothing to recover`);
      return;
    }

    if (!this.tradingBot) {
      log.error(`No trading bot set — cannot sell to redeem ${title}`);
      return;
    }

    if (!asset) {
      log.error(`No asset/tokenId for ${title}`);
      return;
    }

    // Skip assets that have failed too many times (resolved markets with no orderbook)
    const failCount = this.failedAssets.get(asset) || 0;
    if (failCount >= 3) return;

    const sellPrice = Math.min(curPrice, 0.99);
    log.warn(`💰 REDEEMING via CLOB sell | ${title} | ${size.toFixed(2)} shares @ ${sellPrice} | P&L: $${pnl.toFixed(2)}`);

    const result = await this.tradingBot.sellPosition(asset, size, sellPrice, { eventName: `redeem: ${title.slice(0, 40)}` });

    if (result.success) {
      log.warn(`✅ REDEEMED (sell) | ${title} | ${result.orderId || 'ok'} | ${result.executionMs}ms`);
      this.redeemHistory.unshift({ time: Date.now(), title, amount: size * sellPrice, pnl, method: 'sell' });
      if (this.redeemHistory.length > 50) this.redeemHistory.length = 50;
      this.failedAssets.delete(asset);
    } else {
      const errMsg = result.error || '';
      if (!errMsg || errMsg.includes('404') || errMsg.includes('no_bids') || errMsg.includes('orderbook') || errMsg.includes('does not exist')) {
        this.failedAssets.set(asset, failCount + 1);
        log.warn(`Market likely resolved (no orderbook) — skipping ${title} (attempt ${failCount + 1}/3)`);
      } else {
        log.error(`❌ Redeem sell failed: ${errMsg}`);
      }
    }
  }

  /**
   * Redeem a position by conditionId via on-chain transaction.
   * Tries gasless relay first, falls back to on-chain proxy.
   */
  private async redeemByConditionId(conditionId: string): Promise<{ success: boolean; txHash?: string; method?: string; error?: string }> {
    const ct = new Contract(CT_ADDRESS, CT_ABI);
    const calldata = ct.interface.encodeFunctionData('redeemPositions', [
      USDC_ADDRESS, ZERO_BYTES32, conditionId, [1, 2]
    ]);

    // Try gasless relay first
    if (this.relayClient) {
      try {
        const response = await this.relayClient.execute(
          [{ to: CT_ADDRESS, data: calldata, value: '0' }],
          'redeem'
        );
        const result = await response.wait();
        if (result) {
          return { success: true, txHash: result.transactionHash, method: 'relay' };
        }
      } catch {
        // Fall through to on-chain
      }
    }

    // Direct on-chain via proxy (requires MATIC for gas)
    if (this.connectedWallet) {
      try {
        const proxy = new Contract(this.funderAddress, PROXY_ABI, this.connectedWallet);
        const tx = await proxy.exec(CT_ADDRESS, 0, calldata);
        const receipt = await tx.wait();
        return { success: true, txHash: receipt.transactionHash, method: 'onchain' };
      } catch (err: any) {
        return { success: false, error: err.message?.slice(0, 120) };
      }
    }

    return { success: false, error: 'no_redemption_method_available' };
  }

  /**
   * Force-redeem ALL active positions (bypasses redeemable filter).
   * Useful for clearing stuck positions.
   */
  async forceRedeemAll(): Promise<{ redeemed: number; failed: number; details: any[] }> {
    const results = { redeemed: 0, failed: 0, details: [] as any[] };

    const resp = await fetch(
      `https://data-api.polymarket.com/positions?user=${this.funderAddress}&sizeThreshold=0.1`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!resp.ok) return { ...results, ...{ error: `Data API returned ${resp.status}` } };

    const positions: any[] = await resp.json();
    const active = positions.filter((p: any) => Number(p.size || 0) > 0);

    if (active.length === 0) return results;

    // Dedupe by conditionId
    const seen = new Set<string>();
    const unique = active.filter((p: any) => {
      if (!p.conditionId || seen.has(p.conditionId)) return false;
      seen.add(p.conditionId);
      return true;
    });

    for (const pos of unique) {
      const detail: any = {
        title: pos.title?.slice(0, 60),
        outcome: pos.outcome,
        conditionId: pos.conditionId,
        size: Number(pos.size || 0),
        curPrice: Number(pos.curPrice || 0),
      };

      try {
        const result = await this.redeemByConditionId(pos.conditionId);
        if (result.success) {
          results.redeemed++;
          Object.assign(detail, { status: 'redeemed', txHash: result.txHash, method: result.method });
        } else {
          results.failed++;
          Object.assign(detail, { status: 'failed', error: result.error });
        }
      } catch (err: any) {
        results.failed++;
        Object.assign(detail, { status: 'error', error: err.message });
      }

      results.details.push(detail);
    }

    return results;
  }

  /** Trigger an immediate redeem check (called after sell cycle) */
  async checkNow(): Promise<void> {
    return this.checkAndRedeem();
  }

  getState() {
    return {
      running: !!this.timer,
      hasRelay: !!this.relayClient,
      hasOnChain: !!this.connectedWallet,
      recentRedeems: this.redeemHistory.slice(0, 10),
      totalRedeemed: this.redeemHistory.length,
    };
  }
}
