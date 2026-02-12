/**
 * Position Logger — persists goal trade entries and exits to JSONL
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(process.cwd(), 'data');
const LOG_FILE = join(LOG_DIR, 'goal-trades.jsonl');

function ensureDir(): void {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
}

export interface GoalTradeLog {
  id: string;
  eventId: string;
  match: string;
  market: string;
  goalType: string;
  score: string;
  side: 'YES' | 'NO';
  entry: { time: number; price: number; amount: number; shares: number };
  exit?: { time: number; price: number; reason: string };
  pnl?: number;
  durationMs?: number;
}

export function logGoalTrade(trade: GoalTradeLog): void {
  ensureDir();
  appendFileSync(LOG_FILE, JSON.stringify(trade) + '\n', 'utf-8');
}
