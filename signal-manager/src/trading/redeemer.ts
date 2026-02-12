/**
 * Auto-Redeemer — Automatically sell resolved/redeemable Polymarket positions
 * 
 * Since the proxy wallet has no MATIC for gas, we redeem by selling
 * winning shares at $0.99 (near face value) via the CLOB orderbook.
 * This is gasless as Polymarket handles order execution.
 */

import { createLogger } from '../util/logger.js';

const log = createLogger('redeemer');

interface TradingBot {
  sellPosition(tokenId: string, shares: number, price: number, opts?: { eventName?: string }): Promise<any>;
}

export class AutoRedeemer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private funderAddress: string;
  private checkIntervalMs: number;
  private tradingBot: TradingBot | null = null;
  private redeemHistory: { time: number; title: string; amount: number; pnl: number }[] = [];

  constructor(_privateKey: string, funderAddress: string, checkIntervalMs = 60_000) {
    this.funderAddress = funderAddress;
    this.checkIntervalMs = checkIntervalMs;
  }

  setTradingBot(bot: TradingBot): void {
    this.tradingBot = bot;
  }

  start(): void {
    if (this.timer) return;
    log.warn('Auto-redeemer started (checking every ' + (this.checkIntervalMs / 1000) + 's) — gasless via CLOB sell');
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

      for (const pos of redeemable) {
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

    if (!this.tradingBot) {
      log.error(`No trading bot set — cannot sell to redeem ${title}`);
      return;
    }

    if (!asset) {
      log.error(`No asset/tokenId for ${title}`);
      return;
    }

    // For resolved winning positions, sell at 0.99 (just under face value)
    // For resolved losing positions (curPrice=0), nothing to sell
    if (curPrice <= 0.01) {
      log.warn(`⚠️ ${title} — resolved at $0, nothing to recover`);
      return;
    }

    const sellPrice = Math.min(curPrice, 0.99);

    log.warn(`💰 REDEEMING via SELL | ${title} | ${size.toFixed(2)} shares @ ${sellPrice} | P&L: $${pnl.toFixed(2)}`);

    const result = await this.tradingBot.sellPosition(asset, size, sellPrice, { eventName: `redeem: ${title.slice(0, 40)}` });

    if (result.success) {
      log.warn(`✅ REDEEMED | ${title} | ${result.orderId || 'ok'} | ${result.executionMs}ms`);
      this.redeemHistory.unshift({ time: Date.now(), title, amount: size * sellPrice, pnl });
      if (this.redeemHistory.length > 50) this.redeemHistory.length = 50;
    } else {
      log.error(`❌ Redeem sell failed: ${result.error}`);
    }
  }

  getState() {
    return {
      running: !!this.timer,
      recentRedeems: this.redeemHistory.slice(0, 10),
      totalRedeemed: this.redeemHistory.length,
    };
  }
}
