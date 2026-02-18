import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createLogger } from './util/logger.js';

const log = createLogger('state');

export interface HotMarket {
  marketId: string;
  question: string;
  questionNorm: string;
  detectedOutcome: string;
  confidence: number;
  detectedAt: number;       // epoch ms
  winningPrice: number;
  currentPrice: number;
  profitPct: number;
  isActionable: boolean;
  eventId: string;
  clobTokenId: string;
  customLiveness: number;
}

interface PersistedState {
  lastProcessedBlock: number;
  backfillComplete: boolean;
  knownEventIds: string[];
  knownMarketIds: string[];
  marketsByQuestion: [string, string][];
}

const STATE_FILE = 'state.json';

export class State {
  hotMarkets = new Map<string, HotMarket>();
  knownEventIds = new Set<string>();
  knownMarketIds = new Set<string>();
  marketsByQuestion = new Map<string, string>();  // normalizedQuestion → marketId
  lastProcessedBlock = 0;
  backfillComplete = false;

  load(): void {
    if (!existsSync(STATE_FILE)) {
      log.info('No state.json found, starting fresh');
      return;
    }
    try {
      const raw = readFileSync(STATE_FILE, 'utf-8');
      const data: PersistedState = JSON.parse(raw);
      this.lastProcessedBlock = data.lastProcessedBlock || 0;
      this.backfillComplete = data.backfillComplete || false;
      for (const id of data.knownEventIds || []) this.knownEventIds.add(id);
      for (const id of data.knownMarketIds || []) this.knownMarketIds.add(id);
      for (const [q, id] of data.marketsByQuestion || []) this.marketsByQuestion.set(q, id);
      log.info(`State loaded: ${this.knownEventIds.size} events, ${this.knownMarketIds.size} markets, block=${this.lastProcessedBlock}, backfill=${this.backfillComplete}`);
    } catch (e: any) {
      log.error('Failed to load state.json', e.message);
    }
  }

  persist(): void {
    try {
      const data: PersistedState = {
        lastProcessedBlock: this.lastProcessedBlock,
        backfillComplete: this.backfillComplete,
        knownEventIds: [...this.knownEventIds],
        knownMarketIds: [...this.knownMarketIds],
        marketsByQuestion: [...this.marketsByQuestion.entries()],
      };
      writeFileSync(STATE_FILE, JSON.stringify(data));
      log.debug(`State persisted: ${this.knownEventIds.size} events, ${this.knownMarketIds.size} markets`);
    } catch (e: any) {
      log.error('Failed to persist state', e.message);
    }
  }

  stats(): { events: number; markets: number; hotMarkets: number; block: number } {
    return {
      events: this.knownEventIds.size,
      markets: this.knownMarketIds.size,
      hotMarkets: this.hotMarkets.size,
      block: this.lastProcessedBlock,
    };
  }
}
