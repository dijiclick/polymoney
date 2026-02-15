/**
 * GoalTrader — Auto buy on score change detection, smart exit strategy
 *
 * Entry: When 1xBet detects a score change, buy the favored ML outcome on Polymarket.
 * Works across ALL sports — soccer goals, basketball runs, hockey goals, etc.
 * Exit: 3-layer strategy based on price stabilization, take-profit, time limit, or stop-loss.
 *
 * Handles moneyline (match winner) markets: ml_home_ft, ml_away_ft, draw_ft.
 */

import type { UnifiedEvent } from '../types/unified-event.js';
import type { SignalFunction } from '../core/signal-dispatcher.js';
import type { TradingBot } from './bot.js';
import { logGoalTrade, type GoalTradeLog } from './position-log.js';
import { createLogger } from '../util/logger.js';
import { getFastestSource } from '../dashboard/server.js';

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
  /** Hard exit after this many ms (default: 3 min) */
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
  /** Prefer fastest source — only trade immediately when the historically fastest source reports.
   *  Slower sources wait `slowSourceDelayMs` for the fast source to confirm before trading. */
  preferFastestSource: boolean;
  /** How long to wait for fastest source before accepting a slower source's goal (ms) */
  slowSourceDelayMs: number;
}

const DEFAULT_CONFIG: GoalTraderConfig = {
  enabled: false,
  hardExitMs: 60_000,            // 1 min → sell
  stabilizationQuietMs: 999_999, // disabled — just use hard exit
  minHoldMs: 60_000,             // hold full 1 min
  stopLossPp: 99,                // disabled
  takeProfitPct: 99,             // disabled
  skipExtendingLead: true,       // don't buy extending leads
  sizeLarge: 1.0,                // $1 flat
  sizeMedium: 1.0,               // $1 flat
  sizeSmall: 1.0,                // $1 flat
  preferFastestSource: false,    // buy on first source
  slowSourceDelayMs: 0,          // no delay
};

const ML_KEYS = ['ml_home_ft', 'ml_away_ft', 'draw_ft'];

// Expected move in probability points by goal type (soccer-baseline)
const EXPECTED_MOVE: Record<GoalType, number> = {
  equalizer: 35,
  go_ahead: 18,
  opening: 8,
  extending: 3,
};

// Sport categories for score-change handling
type SportCategory = 'low_scoring' | 'high_scoring' | 'set_based' | 'round_based';

function getSportCategory(sport: string): SportCategory {
  const s = sport.toLowerCase();
  // High-scoring: basketball, esports (frequent scoring, small per-point impact)
  if (s.includes('basketball') || s === 'nba' || s === 'ncaab' || s === 'cbb'
    || s.startsWith('bk') || s.startsWith('esports') || s === 'cs2' || s === 'lol'
    || s === 'dota2' || s === 'val' || s === 'baseball' || s === 'mlb' || s === 'kbo'
    || s === 'cricket' || s.startsWith('cr') || s === 'ipl' || s === 'american_football'
    || s === 'nfl' || s === 'cfb') {
    return 'high_scoring';
  }
  // Set-based: tennis (games within sets, need set changes to trade)
  if (s.includes('tennis') || s === 'atp' || s === 'wta' || s === 'volleyball') {
    return 'set_based';
  }
  // Round-based: MMA/UFC, boxing (round finishes matter)
  if (s === 'mma' || s === 'ufc' || s === 'boxing' || s === 'zuffa') {
    return 'round_based';
  }
  // Low-scoring: soccer, ice hockey, rugby (each score event is significant)
  return 'low_scoring';
}

// Minimum score delta required to trigger a trade, by sport category
const MIN_SCORE_DELTA: Record<SportCategory, number> = {
  low_scoring: 1,     // Soccer/hockey: every goal matters
  high_scoring: 5,    // Basketball: need 5+ point swing to be meaningful
  set_based: 1,       // Tennis: set-level changes only (handled in logic)
  round_based: 0,     // MMA: any finish signal
};

// --- Goal Activity Log (for dashboard) ---

export interface GoalActivity {
  ts: number;
  match: string;
  score: string;
  prevScore: string;
  source: string;
  sport: string;
  goalType: GoalType | null;
  action: 'BUY' | 'SKIP' | 'PENDING' | 'DRY_BUY';
  reason: string;
  /** Trade details if action is BUY/DRY_BUY */
  trade?: { side: string; market: string; price: number; size: number; latencyMs: number };
}

// --- GoalTrader class ---

interface PendingGoal {
  event: UnifiedEvent;
  source: string;
  timer: ReturnType<typeof setTimeout>;
}

export class GoalTrader {
  private config: GoalTraderConfig;
  private bot: TradingBot;
  private positions: Map<string, ManagedPosition> = new Map();
  private scoreDebounce: Map<string, number> = new Map();
  private history: ManagedPosition[] = [];
  private exitTimer: ReturnType<typeof setInterval> | null = null;
  private idCounter = 0;
  // Track goals we've already acted on to avoid double-entry
  private processedGoals: Set<string> = new Set();
  // Pending goals from slow sources waiting for fast source confirmation
  private pendingGoals: Map<string, PendingGoal> = new Map();
  // Activity log for dashboard — every goal event, traded or not
  private goalLog: GoalActivity[] = [];
  // Auto-redeemer reference for triggering immediate redeem after sell
  private redeemer: { checkNow(): Promise<void> } | null = null;

  constructor(bot: TradingBot, config: Partial<GoalTraderConfig> = {}) {
    this.bot = bot;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Connect auto-redeemer for immediate redemption after sells */
  setRedeemer(redeemer: { checkNow(): Promise<void> }): void {
    this.redeemer = redeemer;
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
    const sport = event.sport || '';

    if (!this.config.enabled) {
      if (event.stats.score && event._prevScore) {
        const sc = event.stats.score, ps = event._prevScore;
        this.logActivity({ ts: Date.now(), match, score: `${sc.home}-${sc.away}`, prevScore: `${ps.home}-${ps.away}`, source, sport, goalType: null, action: 'SKIP', reason: 'GoalTrader disabled' });
      }
      return;
    }

    // Only auto-trade goals in soccer matches
    if (sport !== 'soccer') return;
    if (!event.stats.score) {
      return;
    }

    // Skip events with no Polymarket tokens (not tradeable)
    if (!event._tokenIds || Object.keys(event._tokenIds).length === 0) {
      return;
    }

    const score = event.stats.score;
    const sportCategory = getSportCategory(sport);

    // Debounce: ignore score flapping (same event changing score multiple times within 2s)
    const lastScoreTime = this.scoreDebounce.get(event.id);
    const debounceNow = Date.now();
    if (lastScoreTime && (debounceNow - lastScoreTime) < 2000) {
      return; // Too fast — likely 1xBet data flapping
    }
    this.scoreDebounce.set(event.id, debounceNow);

    // _prevScore is only set after the first score change is observed.
    // If undefined, this is the first score we've seen (bootstrap) — not a real goal.
    if (!event._prevScore) {
      log.debug(`First score seen (bootstrap) | ${match} | ${score.home}-${score.away} | sport=${sport} | skipping`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: '?', source, sport, goalType: null, action: 'SKIP', reason: 'Bootstrap (first score)' });
      return;
    }
    const prevScore = event._prevScore;

    // For high-scoring sports (basketball, baseball, esports), require a meaningful swing
    const totalDelta = Math.abs((score.home + score.away) - (prevScore.home + prevScore.away));
    const minDelta = MIN_SCORE_DELTA[sportCategory];
    if (totalDelta < minDelta) {
      log.debug(`Score change too small for ${sport} (delta=${totalDelta}, min=${minDelta}) | ${match}`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType: null, action: 'SKIP', reason: `Delta too small (${totalDelta}<${minDelta})` });
      return;
    }

    // For high-scoring sports, only trade on lead changes (not every basket/run)
    if (sportCategory === 'high_scoring') {
      const prevLeader = prevScore.home > prevScore.away ? 'home' : prevScore.away > prevScore.home ? 'away' : 'tied';
      const newLeader = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'tied';
      if (prevLeader === newLeader) {
        log.debug(`High-scoring sport: lead unchanged (${newLeader}) | ${match} | ${score.home}-${score.away}`);
        this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType: null, action: 'SKIP', reason: 'Lead unchanged' });
        return;
      }
    }

    log.warn(`🏆 SCORE CHANGE | ${match} | ${prevScore.home}-${prevScore.away} → ${score.home}-${score.away} | sport=${sport} (${sportCategory}) | source=${source}`);

    // Deduplicate: don't act on the same score twice
    const goalKey = `${event.id}:${score.home}-${score.away}`;
    if (this.processedGoals.has(goalKey)) {
      // If this was a pending goal from a slow source, cancel its timer (fast source confirmed)
      const pending = this.pendingGoals.get(goalKey);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingGoals.delete(goalKey);
      }
      log.debug(`Score dedup | ${match} | ${score.home}-${score.away}`);
      return;
    }

    // === Fastest-source preference ===
    // If enabled, check if this source is the historically fastest.
    // If not, queue the goal and wait briefly for the fastest source to report it.
    if (this.config.preferFastestSource) {
      const fastest = getFastestSource();
      if (fastest && fastest !== source && !this.pendingGoals.has(goalKey)) {
        // This source is NOT the fastest — queue it and wait
        log.info(`⏳ ${source} reported goal, waiting ${this.config.slowSourceDelayMs}ms for ${fastest} | ${match} | ${score.home}-${score.away}`);
        const timer = setTimeout(() => {
          this.pendingGoals.delete(goalKey);
          if (!this.processedGoals.has(goalKey)) {
            log.warn(`⏳ Fastest source (${fastest}) did not confirm in ${this.config.slowSourceDelayMs}ms — executing from ${source}`);
            this.processedGoals.add(goalKey);
            this.executeGoalTrade(event, source, match, sport, score, prevScore, sportCategory, goalKey, debounceNow);
          }
        }, this.config.slowSourceDelayMs);
        this.pendingGoals.set(goalKey, { event, source, timer });
        this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType: null, action: 'PENDING', reason: `Waiting for ${fastest} (${this.config.slowSourceDelayMs}ms)` });
        return;
      }
      // If this IS the fastest source, check if a slow source is pending → cancel it and execute now
      const pending = this.pendingGoals.get(goalKey);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingGoals.delete(goalKey);
        log.info(`⚡ Fastest source (${source}) confirmed goal — cancelling ${pending.source}'s delayed trade`);
      }
    }

    this.processedGoals.add(goalKey);
    this.executeGoalTrade(event, source, match, sport, score, prevScore, sportCategory, goalKey, debounceNow);
  }

  /** Core trade execution — called immediately for fastest source, or after delay for slow sources */
  private executeGoalTrade(
    event: UnifiedEvent, source: string, match: string, sport: string,
    score: { home: number; away: number }, prevScore: { home: number; away: number },
    sportCategory: SportCategory, goalKey: string, goalDetectedAt?: number,
  ): void {
    // Classify the goal
    const goalType = this.classifyGoal(score, prevScore);

    if (goalType === 'extending' && this.config.skipExtendingLead) {
      log.debug(`🏆 SKIP extending lead ${score.home}-${score.away} | ${match}`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: 'Extending lead (skip config)' });
      return;
    }

    // Determine which ML market to buy and the direction
    const { marketKey, side } = this.inferTrade(score, prevScore);
    if (!marketKey) {
      log.warn(`🏆 Could not infer trade direction | ${match} | ${score.home}-${score.away}`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: 'No trade direction' });
      return;
    }

    // Get tokenId from the pipeline
    const tokenId = event._tokenIds[marketKey];
    if (!tokenId) {
      // Try alternative ML keys before giving up
      const altKey = ML_KEYS.find(k => k !== marketKey && event._tokenIds[k]);
      if (!altKey) {
        this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: 'No tokenId' });
        return;
      }
      log.warn(`🏆 No ${marketKey} on ${match}, using ${altKey} instead`);
      return;
    }

    // Get current PM price for this market
    const pmData = event.markets[marketKey]?.polymarket;
    if (!pmData) {
      const availableMarkets = Object.keys(event.markets).join(', ') || 'none';
      log.warn(`🏆 No PM price for ${marketKey} on ${match} — available markets: [${availableMarkets}]`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: 'No PM price' });
      return;
    }

    // Don't buy if we already have a position on this event
    for (const pos of this.positions.values()) {
      if (pos.eventId === event.id) {
        log.warn(`🏆 Already have position on ${match} — skipping`);
        this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: 'Already have position' });
        return;
      }
    }

    const entryPrice = 1 / pmData.value; // Convert decimal odds to probability

    // Skip if price is too extreme — thin orderbook, hard to exit
    if (entryPrice > 0.90 || entryPrice < 0.08) {
      log.warn(`🏆 SKIP price too extreme (${entryPrice.toFixed(3)}) | ${match}`);
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${prevScore.home}-${prevScore.away}`, source, sport, goalType, action: 'SKIP', reason: `Price extreme (${(entryPrice*100).toFixed(0)}%)` });
      return;
    }

    // Scale expected move by sport: hockey goals ~ soccer, high-scoring sports get smaller expected moves
    const moveScale = sportCategory === 'low_scoring' ? 1.0
      : sportCategory === 'high_scoring' ? 0.5
      : sportCategory === 'set_based' ? 0.7
      : 0.8;
    const expectedMove = Math.round(EXPECTED_MOVE[goalType] * moveScale);
    const tradeSize = this.getTradeSize(goalType);

    // Calculate exit targets
    const takeProfitPrice = side === 'YES'
      ? Math.min(0.95, entryPrice + (expectedMove * this.config.takeProfitPct) / 100)
      : Math.max(0.05, entryPrice - (expectedMove * this.config.takeProfitPct) / 100);
    const stopLossPrice = side === 'YES'
      ? Math.max(0.01, entryPrice - this.config.stopLossPp / 100)
      : Math.min(0.99, entryPrice + this.config.stopLossPp / 100);

    const fastest = getFastestSource();
    const isFastest = source === fastest;

    log.warn(
      `🏆 TRADE | ${match} | ${score.home}-${score.away} | Type: ${goalType} | Sport: ${sport} | ` +
      `${side} ${marketKey} @ ${entryPrice.toFixed(3)} | Size: $${tradeSize} | ` +
      `TP: ${takeProfitPrice.toFixed(3)} | SL: ${stopLossPrice.toFixed(3)} | Expected: +${expectedMove}pp | ` +
      `Source: ${source}${isFastest ? ' ⚡FASTEST' : ''}`
    );

    // Execute buy (FOK for immediate execution)
    this.executeBuy(event, tokenId, marketKey, side, entryPrice, tradeSize, goalType, score, expectedMove, takeProfitPrice, stopLossPrice, match, sport, source, goalDetectedAt);
  }

  private async executeBuy(
    event: UnifiedEvent, tokenId: string, marketKey: string,
    side: 'YES' | 'NO', price: number, amount: number,
    goalType: GoalType, score: { home: number; away: number },
    expectedMovePp: number, takeProfitPrice: number, stopLossPrice: number,
    match: string, sport: string, source: string, goalDetectedAt?: number,
  ): Promise<void> {
    // Use buyAtMarket for real orderbook best ask — reliable FOK fill
    const result = await this.bot.buyAtMarket(tokenId, side, amount, { eventName: match });

    if (!result.success) {
      const alertDelay = goalDetectedAt ? `${((Date.now() - goalDetectedAt) / 1000).toFixed(1)}s` : '?';
      log.error(
        `❌ BUY FAILED | ${match} | ${event._prevScore?.home ?? '?'}-${event._prevScore?.away ?? '?'}→${score.home}-${score.away} | ` +
        `${side} ${marketKey} | $${amount} @ ${price.toFixed(3)} | Source: ${source} | ` +
        `Alert→Buy: ${alertDelay} | Reason: ${result.error}`
      );
      this.logActivity({ ts: Date.now(), match, score: `${score.home}-${score.away}`, prevScore: `${(event._prevScore?.home ?? '?')}-${(event._prevScore?.away ?? '?')}`, source, sport, goalType, action: 'SKIP', reason: `Buy failed: ${result.error}` });
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

    const alertDelay = goalDetectedAt ? `${((now - goalDetectedAt) / 1000).toFixed(1)}s` : '?';
    const orderId = result.orderId ? result.orderId.slice(0, 10) : 'n/a';
    log.warn(
      `💰 BUY | ${match} | ${event._prevScore?.home ?? '?'}-${event._prevScore?.away ?? '?'}→${score.home}-${score.away} | ` +
      `Type: ${goalType} | Source: ${source} | ✅ ${result.executionMs}ms | ` +
      `Alert→Buy: ${alertDelay} | ${side} ${marketKey} @ ${price.toFixed(3)} | $${amount.toFixed(2)} | ${shares.toFixed(1)} shares | ${orderId}`
    );

    // Log activity
    const isDry = result.orderId?.startsWith('DRY') || !this.bot.isArmed;
    this.logActivity({
      ts: now, match, score: `${score.home}-${score.away}`, prevScore: `${(event._prevScore?.home ?? '?')}-${(event._prevScore?.away ?? '?')}`,
      source, sport, goalType,
      action: isDry ? 'DRY_BUY' : 'BUY', reason: isDry ? 'Dry run' : 'Executed',
      trade: { side, market: marketKey, price, size: amount, latencyMs: result.executionMs || 0 },
    });
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

    const now = Date.now();
    const exitPrice = pos.lastPrice;
    const pnl = pos.side === 'YES'
      ? (exitPrice - pos.entryPrice) * pos.shares
      : (pos.entryPrice - exitPrice) * pos.shares;

    log.warn(
      `💰 EXIT ${pos.match} | ${pos.marketKey} | Reason: ${reason} | ` +
      `Entry: ${pos.entryPrice.toFixed(3)} → Exit: ${exitPrice.toFixed(3)} | ` +
      `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(3)} | Hold: ${((now - pos.entryTime) / 1000).toFixed(0)}s | ` +
      `Updates: ${pos.priceUpdateCount}`
    );

    // Fetch actual position size from Polymarket API (in case tracked shares differ)
    let sellShares = pos.shares;
    try {
      const actualSize = await this.fetchActualPosition(pos.tokenId);
      if (actualSize > 0) {
        if (Math.abs(actualSize - pos.shares) > 0.01) {
          log.warn(`📊 Actual shares: ${actualSize.toFixed(2)} (tracked: ${pos.shares.toFixed(2)}) — using actual`);
        }
        sellShares = actualSize;
      }
    } catch { /* use tracked shares */ }

    // Aggressive sell retry: try multiple price levels
    let sold = false;
    const sellPrices = [
      exitPrice,                                                   // 1st: at current price
      pos.side === 'YES' ? exitPrice - 0.02 : exitPrice + 0.02,   // 2nd: 2pp worse
      pos.side === 'YES' ? exitPrice - 0.05 : exitPrice + 0.05,   // 3rd: 5pp worse
      pos.side === 'YES' ? 0.01 : 0.99,                           // 4th: dump at any price
    ].map(p => Math.max(0.01, Math.min(0.99, p)));

    for (let i = 0; i < sellPrices.length; i++) {
      const result = await this.bot.sellPosition(pos.tokenId, sellShares, sellPrices[i], { eventName: pos.match });
      if (result.success) {
        log.warn(`✅ SOLD ${pos.match} | ${sellShares.toFixed(2)} shares @ best bid | ${result.executionMs}ms`);
        sold = true;
        break;
      }
      if (i < sellPrices.length - 1) {
        log.warn(`❌ SELL FAILED (attempt ${i + 1}/${sellPrices.length}): ${result.error} | Retrying wider...`);
      } else {
        log.error(`❌ SELL FAILED ALL ${sellPrices.length} ATTEMPTS: ${result.error} | ${pos.match} — will retry next cycle`);
      }
    }

    if (!sold) {
      // DON'T mark as settled — keep in positions so checkExits retries next cycle
      // Extend the hard exit time so it retries in 30s
      pos.hardExitTime = Date.now() + 30_000;
      return;
    }

    // Only mark settled and remove from tracking on successful sell
    pos.settled = true;
    pos.exitReason = reason;
    pos.exitPrice = exitPrice;
    pos.exitTime = Date.now();
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
      exit: { time: Date.now(), price: exitPrice, reason },
      pnl,
      durationMs: Date.now() - pos.entryTime,
    });

    // Move to history
    this.positions.delete(pos.tokenId);
    this.history.unshift(pos);
    if (this.history.length > 100) this.history.length = 100;

    // Trigger redeemer if available (clears resolved positions immediately)
    if (this.redeemer) {
      setTimeout(() => this.redeemer!.checkNow().catch(() => {}), 5000);
    }
  }

  /** Fetch actual position size from Polymarket data API */
  private async fetchActualPosition(tokenId: string): Promise<number> {
    try {
      const funder = process.env.POLY_FUNDER_ADDRESS;
      if (!funder) return 0;
      const resp = await fetch(
        `https://data-api.polymarket.com/positions?user=${funder}&asset=${tokenId}&sizeThreshold=0`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) return 0;
      const positions: any[] = await resp.json();
      const match = positions.find((p: any) => p.asset === tokenId);
      return match ? Number(match.size) || 0 : 0;
    } catch {
      return 0;
    }
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

  private logActivity(entry: GoalActivity): void {
    this.goalLog.unshift(entry);
    if (this.goalLog.length > 200) this.goalLog.length = 200;
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
      fastestSource: getFastestSource(),
      pendingGoals: this.pendingGoals.size,
      goalLog: this.goalLog.slice(0, 100),
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
        preferFastestSource: this.config.preferFastestSource,
        slowSourceDelayMs: this.config.slowSourceDelayMs,
      },
    };
  }
}
