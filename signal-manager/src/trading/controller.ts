/**
 * Trading Bot Controller
 * 
 * Handles commands from dashboard API and signal integration.
 * Commands: arm, disarm, buy, sell, cancel, status, positions
 */

import { TradingBot, TradeRequest, TradingConfig } from './bot.js';
import type { Engine } from '../core/engine.js';

export class TradingController {
  private bot: TradingBot;
  private engine: Engine;
  private autoTradeEnabled = false;

  constructor(bot: TradingBot, engine: Engine) {
    this.bot = bot;
    this.engine = engine;
  }

  /** Handle a command string (from Telegram or API) */
  async handleCommand(cmd: string): Promise<string> {
    const parts = cmd.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();

    switch (action) {
      case 'arm':
        this.bot.arm();
        return '🔴 Bot ARMED — live trading enabled!';

      case 'disarm':
        this.bot.disarm();
        return '🟢 Bot DISARMED — dry run mode.';

      case 'status':
        return this.getStatusText();

      case 'positions':
        return this.getPositionsText();

      case 'history':
        return this.getHistoryText();

      case 'cancel':
        const cancelled = await this.bot.cancelAll();
        return cancelled ? '✅ All orders cancelled.' : '❌ Failed to cancel orders.';

      case 'autotrade':
        this.autoTradeEnabled = !this.autoTradeEnabled;
        return `Auto-trade: ${this.autoTradeEnabled ? '🟢 ON' : '🔴 OFF'}`;

      case 'buy': {
        // buy <tokenId> <amount> <price> [eventName]
        if (parts.length < 4) return 'Usage: buy <tokenId> <amount> <price> [eventName]';
        const res = await this.bot.buyYes(parts[1], parseFloat(parts[2]), parseFloat(parts[3]), { eventName: parts.slice(4).join(' ') });
        return res.success ? `✅ Buy OK — ${res.orderId} (${res.executionMs}ms)` : `❌ Buy failed: ${res.error}`;
      }

      case 'sell': {
        // sell <tokenId> <amount> <price>
        if (parts.length < 4) return 'Usage: sell <tokenId> <amount> <price>';
        const res = await this.bot.trade({
          tokenId: parts[1],
          side: 'SELL',
          outcome: 'YES',
          amount: parseFloat(parts[2]),
          price: parseFloat(parts[3]),
          orderType: 'FOK',
          tickSize: '0.01',
          negRisk: false,
        });
        return res.success ? `✅ Sell OK — ${res.orderId} (${res.executionMs}ms)` : `❌ Sell failed: ${res.error}`;
      }

      case 'quickbuy': {
        // quickbuy <eventSearch> <amount>
        // Finds a matching event and buys the best opportunity
        if (parts.length < 3) return 'Usage: quickbuy <eventSearch> <amount>';
        return await this.quickBuy(parts[1], parseFloat(parts[2]));
      }

      default:
        return `Unknown command: ${action}\nCommands: arm, disarm, status, positions, history, cancel, autotrade, buy, sell, quickbuy`;
    }
  }

  /** Handle a trading signal from the signal engine */
  async handleSignal(signal: any): Promise<void> {
    if (!this.autoTradeEnabled) return;
    if (!this.bot.isArmed) return;

    // Only act on high-confidence signals
    if (signal.type === 'TRADE_SIGNAL' && signal.data?.confidence >= 0.7) {
      const { tokenId, action, price, edge, eventName } = signal.data;
      if (!tokenId || !action || !price) return;

      const amount = this.bot['config'].minTradeSize; // Use minimum for auto trades
      const side = action.includes('BUY') ? 'BUY' : 'SELL';
      const outcome = action.includes('NO') ? 'NO' : 'YES';

      await this.bot.trade({
        tokenId,
        side: side as 'BUY' | 'SELL',
        outcome: outcome as 'YES' | 'NO',
        amount,
        price,
        orderType: 'FOK',
        tickSize: '0.01',
        negRisk: false,
        eventName,
        signalId: signal.id,
      });
    }
  }

  /** Quick buy by searching events */
  private async quickBuy(search: string, amount: number): Promise<string> {
    const events = this.engine.getAllEvents();
    const match = events.find((e: any) => {
      const name = `${e.home?.name || ''} vs ${e.away?.name || ''}`;
      return name.toLowerCase().includes(search.toLowerCase());
    });
    if (!match) return `❌ No event matching "${search}"`;

    const matchName = `${match.home?.name} vs ${match.away?.name}`;
    if (!match.markets) return `❌ No market data for ${matchName}`;

    // Find first market with a Polymarket price
    for (const [key, market] of Object.entries(match.markets) as any[]) {
      if (market?.polymarket) {
        const price = market.polymarket.value;
        const tokenId = (market as any).__tokenId;
        if (tokenId && price > 0 && price < 1) {
          const res = await this.bot.buyYes(tokenId, amount, price, { eventName: matchName });
          return res.success 
            ? `✅ Bought ${matchName} ${key} @ ${price} — $${amount} — ${res.executionMs}ms`
            : `❌ Failed: ${res.error}`;
        }
      }
    }
    return `❌ No tradeable market found for ${matchName}`;
  }

  private getStatusText(): string {
    const s = this.bot.getState();
    return [
      `🤖 Trading Bot Status`,
      `Initialized: ${s.initialized ? '✅' : '❌'}`,
      `Armed: ${s.armed ? '🔴 LIVE' : '🟢 DRY RUN'}`,
      `Auto-trade: ${this.autoTradeEnabled ? '🟢 ON' : '🔴 OFF'}`,
      `Positions: ${s.openPositions}/${s.maxPositions}`,
      `Trades: ${s.tradeCount}`,
      `Trade size: $${s.minTradeSize} - $${s.maxTradeSize}`,
    ].join('\n');
  }

  private getPositionsText(): string {
    const s = this.bot.getState();
    const positions = Object.values(s.positions) as any[];
    if (positions.length === 0) return '📭 No open positions.';
    return positions.map((p: any) => 
      `• ${p.eventName || p.tokenId} — ${p.side} ${p.size.toFixed(2)} shares @ $${p.avgPrice.toFixed(3)}`
    ).join('\n');
  }

  private getHistoryText(): string {
    const s = this.bot.getState();
    if (s.recentTrades.length === 0) return '📭 No trades yet.';
    return s.recentTrades.slice(-10).map((t: any) => {
      const icon = t.success ? '✅' : '❌';
      const mode = t.orderId?.startsWith('DRY') ? '[DRY]' : '';
      return `${icon} ${mode} ${t.request.side} ${t.request.outcome} $${t.request.amount} @ ${t.request.price} — ${t.executionMs}ms`;
    }).join('\n');
  }

  /** Get state for dashboard API */
  getState() {
    return {
      ...this.bot.getState(),
      autoTradeEnabled: this.autoTradeEnabled,
    };
  }
}
