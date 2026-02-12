/**
 * GoalTrader — Auto buy on goal detection, smart exit strategy
 *
 * Entry: When 1xBet detects a goal, immediately buy the favored ML outcome on Polymarket.
 * Exit: 3-layer strategy based on price stabilization, take-profit, time limit, or stop-loss.
 *
 * Only handles moneyline (match winner) markets: ml_home_ft, ml_away_ft, draw_ft.
 */

import type { UnifiedEvent } from '../types/unified-event.js';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import type { TradingBot } from './bot.js';
import { logGoalTrade, type GoalTradeLog } from './position-log.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('goal-trader');

// --- Types ---

export type GoalType = 'equalizer' | 'go_ahead' | 'opening' | 'extending';

export interface ManagedPosition {
  id: string;
  tokenId: string;
  eventId: string;
  marketKey: string;
  match: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  shares: number;
  amount: number;
  entryTime: number;
  goalType: GoalType;
  score: { home: number; away: number };
  expectedMovePp: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  hardExitTime: number;
  lastPriceUpdate: number;
  lastPrice: number;
  priceUpdateCount: number;
  peakPrice: number;
  settled: boolean;
  exitReason?: string;
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
}

export interface GoalTraderConfig {
  enabled: boolean;
  /** Hard exit after this many ms (default: 5 min) */
  hardExitMs: number;
  /** Price stabilized when no update for this many ms (default: 15s) */
  stabilizationQuietMs: number;
  /** Minimum hold time before stabilization exit (default: 60s) */
  minHoldMs: number;
  /** Stop loss in probability points (default: 3pp) */
  stopLossPp: number;
  /** Take profit at this fraction of expected move (default: 0.80) */
  takeProfitPct: number;
  /** Skip extending-lead goals (small expected move) */
  skipExtendingLead: boolean;
  /** Trade size for different goal types (USDC) */
  sizeLarge: number;
  sizeMedium: number;
  sizeSmall: number;
}

const DEFAULT_CONFIG: GoalTraderConfig = {
  enabled: false,
  hardExitMs: 300_000,           // 5 min
  stabilizationQuietMs: 15_000,  // 15s quiet = stabilized
  minHoldMs: 60_000,             // hold at least 60s
  stopLossPp: 3,                 // 3pp stop loss
  takeProfitPct: 0.80,           // exit at 80% of expected move
  skipExtendingLead: true,
  sizeLarge: 5.0,
  sizeMedium: 3.0,
  sizeSmall: 1.0,
};

const ML_KEYS = ['ml_home_ft', 'ml_away_ft', 'draw_ft'];

// Expected move in probability points by goal type
const EXPECTED_MOVE: Record<GoalType, number> = {
  equalizer: 35,
  go_ahead: 18,
  opening: 8,
  extending: 3,
};

// --- GoalTrader class ---

export class GoalTrader {
  private config: GoalTraderConfig;
  private bot: TradingBot;
  private positions: Map<string, ManagedPosition> = new Map();
  private history: ManagedPosition[] = [];
  private exitTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;
  // Track goals we've already acted on to avoid double-entry
  private processedGoals: Set<string> = new Set();

  constructor(bot: TradingBot, config: Partial<GoalTraderConfig> = {}) {
    this.bot = bot;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the exit monitor loop */
  start(): void {
    if (this.exitTimer) return;
    this.exitTimer = setInterval(() => this.checkExits(), 1000);
    log.info(`GoalTrader started (enabled=${this.config.enabled})`);
  }

  stop(): void {
    if (this.exitTimer) {
      clearInterval(this.exitTimer);
      this.exitTimer = null;
    }
  }

  enable(): void { this.config.enabled = true; log.info('GoalTrader ENABLED'); }
  disable(): void { this.config.enabled = false; log.info('GoalTrader DISABLED'); }
  get isEnabled(): boolean { return this.config.enabled; }

  /**
   * Signal handler — registered with the engine's signal dispatcher.
   * Receives ALL event updates. Uses score changes for entry, price changes for exit monitoring.
   */
  get signalHandler(): SignalFunction {
    return (event: UnifiedEvent, changedKeys: string[], source: string) => {
      // --- Entry: goal detected from non-PM source ---
      if (changedKeys.includes('__score')) {
        if (source === 'polymarket') {
          log.debug(`Score change from PM (ignored for trading) | ${event.home.name || '?'} vs ${event.away.name || '?'} | score=${event.stats.score?.home}-${event.stats.score?.away}`);
        } else {
          this.handleGoal(event, source);
        }
      }

      // --- Exit monitoring: PM price updates for open positions ---
      if (source === 'polymarket') {
        for (const key of changedKeys) {
          if (key.startsWith('__')) continue;
          this.handlePriceUpdate(event, key);
        }
      }
    };
  }

  // --- Entry Logic ---

  private handleGoal(event: UnifiedEvent, source: string): void {
    const match = this.matchName(event);

    if (!this.config.enabled) {
      log.debug(`Goal signal ignored (GoalTrader disabled) | ${match} | source=${source}`);
      return;
    }
    if (!event.stats.score) {
      log.warn(`Goal signal but no score data | ${match} | source=${source}`);
      return;
    }

    const score = event.stats.score;
    const prevScore = event._prevScore || { home: 0, away: 0 };

    log.info(`⚽ GOAL DETECTED | ${match} | ${prevScore.home}-${prevScore.away} → ${score.home}-${score.away} | source=${source}`);

    // Deduplicate: don't act on the same goal twice
    const goalKey = `${event.id}:${score.home}-${score.away}`;
    if (this.processedGoals.has(goalKey)) {
      log.info(`⚽ Goal already processed (dedup) | ${match} | ${score.home}-${score.away}`);
      return;
    }
    this.processedGoals.add(goalKey);

    // Classify the goal
    const goalType = this.classifyGoal(score, prevScore);

    if (goalType === 'extending' && this.config.skipExtendingLead) {
      log.info(`⚽ SKIP extending goal ${score.home}-${score.away} | ${match}`);
      return;
    }

    // Determine which ML market to buy and the direction
    const { marketKey, side } = this.inferTrade(score, prevScore);
    if (!marketKey) {
      log.warn(`⚽ Could not infer trade direction | ${match} | ${score.home}-${score.away}`);
      return;
    }

    // Get tokenId from the pipeline
    const tokenId = event._tokenIds[marketKey];
    if (!tokenId) {
      const availableTokens = Object.keys(event._tokenIds).join(', ') || 'none';
      log.warn(`⚽ No tokenId for ${marketKey} on ${match} — available: [${availableTokens}]`);
      return;
    }

    // Get current PM price for this market
    const pmData = event.markets[marketKey]?.polymarket;
    if (!pmData) {
      const availableMarkets = Object.keys(event.markets).join(', ') || 'none';
      log.warn(`⚽ No PM price for ${marketKey} on ${match} — available markets: [${availableMarkets}]`);
      return;
    }

    // Don't buy if we already have a position on this event
    for (const pos of this.positions.values()) {
      if (pos.eventId === event.id) {
        log.info(`⚽ Already have position on ${match} — skipping`);
        return;
      }
    }

    const entryPrice = 1 / pmData.value; // Convert decimal odds to probability
    const expectedMove = EXPECTED_MOVE[goalType];
    const tradeSize = this.getTradeSize(goalType);

    // Calculate exit targets
    const takeProfitPrice = side === 'YES'
      ? Math.min(0.95, entryPrice + (expectedMove * this.config.takeProfitPct) / 100)
      : Math.max(0.05, entryPrice - (expectedMove * this.config.takeProfitPct) / 100);
    const stopLossPrice = side === 'YES'
      ? Math.max(0.01, entryPrice - this.config.stopLossPp / 100)
      : Math.min(0.99, entryPrice + this.config.stopLossPp / 100);

    const now = Date.now();

    log.info(
      `⚽ GOAL TRADE | ${match} | ${score.home}-${score.away} | Type: ${goalType} | ` +
      `${side} ${marketKey} @ ${entryPrice.toFixed(3)} | Size: $${tradeSize} | ` +
      `TP: ${takeProfitPrice.toFixed(3)} | SL: ${stopLossPrice.toFixed(3)} | Expected: +${expectedMove}pp`
    );

    // Execute buy
    this.executeBuy(event, tokenId, marketKey, side, entryPrice, tradeSize, goalType, score, expectedMove, takeProfitPrice, stopLossPrice, match);
  }

  private async executeBuy(
    event: UnifiedEvent, tokenId: string, marketKey: string,
    side: 'YES' | 'NO', price: number, amount: number,
    goalType: GoalType, score: { home: number; away: number },
    expectedMovePp: number, takeProfitPrice: number, stopLossPrice: number,
    match: string,
  ): Promise<void> {
    const buyFn = side === 'YES' ? this.bot.buyYes.bind(this.bot) : this.bot.buyNo.bind(this.bot);
    const result = await buyFn(tokenId, amount, price, { eventName: match });

    if (!result.success) {
      log.error(`⚽ BUY FAILED: ${result.error} | ${match} ${marketKey}`);
      return;
    }

    const now = Date.now();
    const shares = amount / price;
    const pos: ManagedPosition = {
      id: `gt_${++this.idCounter}`,
      tokenId,
      eventId: event.id,
      marketKey,
      match,
      side,
      entryPrice: price,
      shares,
      amount,
      entryTime: now,
      goalType,
      score,
      expectedMovePp,
      takeProfitPrice,
      stopLossPrice,
      hardExitTime: now + this.config.hardExitMs,
      lastPriceUpdate: now,
      lastPrice: price,
      priceUpdateCount: 0,
      peakPrice: price,
      settled: false,
    };

    this.positions.set(tokenId, pos);

    // Log entry
    logGoalTrade({
      id: pos.id,
      eventId: event.id,
      match,
      market: marketKey,
      goalType,
      score: `${score.home}-${score.away}`,
      side,
      entry: { time: now, price, amount, shares },
    });

    log.info(`✅ BOUGHT ${side} ${marketKey} | ${match} | ${shares.toFixed(1)} shares @ ${price.toFixed(3)} | ${result.executionMs}ms`);
  }

  // --- Exit Monitoring ---

  private handlePriceUpdate(event: UnifiedEvent, marketKey: string): void {
    // Find any position matching this event + market
    for (const pos of this.positions.values()) {
      if (pos.eventId !== event.id || pos.marketKey !== marketKey) continue;

      const pmData = event.markets[marketKey]?.polymarket;
      if (!pmData) continue;

      const currentPrice = 1 / pmData.value; // decimal odds to probability
      const now = Date.now();

      pos.lastPrice = currentPrice;
      pos.lastPriceUpdate = now;
      pos.priceUpdateCount++;
      if ((pos.side === 'YES' && currentPrice > pos.peakPrice) ||
          (pos.side === 'NO' && currentPrice < pos.peakPrice)) {
        pos.peakPrice = currentPrice;
      }

      // Check take profit
      if (pos.side === 'YES' && currentPrice >= pos.takeProfitPrice) {
        this.executeExit(pos, 'take_profit');
        return;
      }
      if (pos.side === 'NO' && currentPrice <= pos.takeProfitPrice) {
        this.executeExit(pos, 'take_profit');
        return;
      }

      // Check stop loss
      if (pos.side === 'YES' && currentPrice <= pos.stopLossPrice) {
        this.executeExit(pos, 'stop_loss');
        return;
      }
      if (pos.side === 'NO' && currentPrice >= pos.stopLossPrice) {
        this.executeExit(pos, 'stop_loss');
        return;
      }
    }
  }

  /** Periodic check for time-based exits */
  private checkExits(): void {
    const now = Date.now();
    for (const pos of this.positions.values()) {
      if (pos.settled) continue;

      // Hard time exit
      if (now >= pos.hardExitTime) {
        this.executeExit(pos, 'hard_time_exit');
        continue;
      }

      // Stabilization exit: no price update for stabilizationQuietMs AND held > minHoldMs
      const holdTime = now - pos.entryTime;
      const quietTime = now - pos.lastPriceUpdate;
      if (holdTime >= this.config.minHoldMs && quietTime >= this.config.stabilizationQuietMs) {
        this.executeExit(pos, 'stabilized');
        continue;
      }
    }
  }

  private async executeExit(pos: ManagedPosition, reason: string): Promise<void> {
    if (pos.settled) return;
    pos.settled = true;

    const now = Date.now();
    const exitPrice = pos.lastPrice;
    const pnl = pos.side === 'YES'
      ? (exitPrice - pos.entryPrice) * pos.shares
      : (pos.entryPrice - exitPrice) * pos.shares;

    log.info(
      `💰 EXIT ${pos.match} | ${pos.marketKey} | Reason: ${reason} | ` +
      `Entry: ${pos.entryPrice.toFixed(3)} → Exit: ${exitPrice.toFixed(3)} | ` +
      `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(3)} | Hold: ${((now - pos.entryTime) / 1000).toFixed(0)}s | ` +
      `Updates: ${pos.priceUpdateCount}`
    );

    // Execute sell
    const result = await this.bot.sellPosition(pos.tokenId, pos.shares, exitPrice, { eventName: pos.match });
    if (!result.success) {
      log.error(`❌ SELL FAILED: ${result.error} | Retrying at wider price...`);
      // Retry at a worse price (2pp worse)
      const worsePrice = pos.side === 'YES'
        ? Math.max(0.01, exitPrice - 0.02)
        : Math.min(0.99, exitPrice + 0.02);
      await this.bot.sellPosition(pos.tokenId, pos.shares, worsePrice, { eventName: pos.match });
    }

    pos.exitReason = reason;
    pos.exitPrice = exitPrice;
    pos.exitTime = now;
    pos.pnl = pnl;

    // Log exit
    logGoalTrade({
      id: pos.id,
      eventId: pos.eventId,
      match: pos.match,
      market: pos.marketKey,
      goalType: pos.goalType,
      score: `${pos.score.home}-${pos.score.away}`,
      side: pos.side,
      entry: { time: pos.entryTime, price: pos.entryPrice, amount: pos.amount, shares: pos.shares },
      exit: { time: now, price: exitPrice, reason },
      pnl,
      durationMs: now - pos.entryTime,
    });

    // Move to history
    this.positions.delete(pos.tokenId);
    this.history.unshift(pos);
    if (this.history.length > 100) this.history.length = 100;
  }

  // --- Goal Classification ---

  private classifyGoal(
    score: { home: number; away: number },
    prevScore: { home: number; away: number },
  ): GoalType {
    const totalGoals = score.home + score.away;
    const prevTotalGoals = prevScore.home + prevScore.away;
    const whoScored = score.home > prevScore.home ? 'home' : 'away';

    // Equalizer: was losing, now tied
    if (score.home === score.away && prevScore.home !== prevScore.away) {
      return 'equalizer';
    }

    // Go-ahead: was tied or losing, now winning
    const prevLeader = prevScore.home > prevScore.away ? 'home' : prevScore.away > prevScore.home ? 'away' : 'tied';
    const newLeader = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'tied';
    if (prevLeader !== newLeader && newLeader !== 'tied') {
      return 'go_ahead';
    }

    // Opening goal: 0-0 → 1-0 or 0-1
    if (prevTotalGoals === 0 && totalGoals === 1) {
      return 'opening';
    }

    // Extending lead: already winning, scores again
    return 'extending';
  }

  /** Determine which ML market to buy and which side (YES/NO) */
  private inferTrade(
    score: { home: number; away: number },
    prevScore: { home: number; away: number },
  ): { marketKey: string | null; side: 'YES' | 'NO' } {
    const whoScored = score.home > prevScore.home ? 'home' : 'away';

    // After a goal, buy the outcome most favored by the new score
    if (score.home > score.away) {
      // Home is winning → buy ml_home YES
      return { marketKey: 'ml_home_ft', side: 'YES' };
    } else if (score.away > score.home) {
      // Away is winning → buy ml_away YES
      return { marketKey: 'ml_away_ft', side: 'YES' };
    } else {
      // Tied (equalizer) → buy draw YES
      return { marketKey: 'draw_ft', side: 'YES' };
    }
  }

  private getTradeSize(goalType: GoalType): number {
    switch (goalType) {
      case 'equalizer':
      case 'go_ahead':
        return this.config.sizeLarge;
      case 'opening':
        return this.config.sizeMedium;
      case 'extending':
        return this.config.sizeSmall;
    }
  }

  private matchName(event: UnifiedEvent): string {
    const home = event.home.aliases['polymarket'] || event.home.name || Object.values(event.home.aliases)[0] || '?';
    const away = event.away.aliases['polymarket'] || event.away.name || Object.values(event.away.aliases)[0] || '?';
    return `${home} vs ${away}`;
  }

  // --- State for dashboard ---

  getState() {
    const totalPnl = this.history.reduce((sum, p) => sum + (p.pnl || 0), 0);
    return {
      enabled: this.config.enabled,
      openPositions: Array.from(this.positions.values()),
      recentTrades: this.history.slice(0, 20),
      totalTrades: this.history.length,
      totalPnl,
      config: {
        hardExitMs: this.config.hardExitMs,
        stabilizationQuietMs: this.config.stabilizationQuietMs,
        minHoldMs: this.config.minHoldMs,
        stopLossPp: this.config.stopLossPp,
        takeProfitPct: this.config.takeProfitPct,
        skipExtendingLead: this.config.skipExtendingLead,
        sizeLarge: this.config.sizeLarge,
        sizeMedium: this.config.sizeMedium,
        sizeSmall: this.config.sizeSmall,
      },
    };
  }
}
