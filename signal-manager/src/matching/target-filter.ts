import type { TargetEvent } from '../types/target-event.js';
import { normalizeTeamName } from './normalizer.js';
import { jaroWinkler } from './fuzzy.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('target-filter');

export interface FilterResult {
  matched: boolean;
  targetEvent?: TargetEvent;
  score: number;
}

export class TargetEventFilter {
  private targets: TargetEvent[] = [];
  private threshold: number;

  constructor(threshold: number = 0.75) {
    this.threshold = threshold;
  }

  setTargets(targets: TargetEvent[]): void {
    this.targets = targets;
    log.info(`Target filter updated: ${targets.length} Polymarket events`);
  }

  get targetCount(): number {
    return this.targets.length;
  }

  check(homeTeam: string, awayTeam: string): FilterResult {
    if (this.targets.length === 0) {
      return { matched: true, score: 0 };
    }

    const homeNorm = normalizeTeamName(homeTeam);
    const awayNorm = normalizeTeamName(awayTeam);
    // Each team must individually meet a minimum — prevents "Inter U20" matching "FC Internazionale Milano"
    const minPerTeam = Math.max(0.70, this.threshold - 0.10);

    let bestScore = 0;
    let bestTarget: TargetEvent | undefined;

    for (const target of this.targets) {
      let homeScore = jaroWinkler(homeNorm, target.homeNormalized);
      let awayScore = jaroWinkler(awayNorm, target.awayNormalized);

      // Substring boost: if the shorter name is contained within the longer one
      // and is at least 3 chars, boost score to 0.90. Handles cases like
      // "barys" ⊆ "barys_astana", "furia" ⊆ "furia_esports"
      if (homeScore < minPerTeam) {
        homeScore = this.substringBoost(homeNorm, target.homeNormalized, homeScore);
      }
      if (awayScore < minPerTeam) {
        awayScore = this.substringBoost(awayNorm, target.awayNormalized, awayScore);
      }

      // Both teams must individually meet minimum threshold
      if (homeScore < minPerTeam || awayScore < minPerTeam) continue;

      const avgScore = (homeScore + awayScore) / 2;

      if (avgScore >= 0.98) {
        return { matched: true, targetEvent: target, score: avgScore };
      }

      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestTarget = target;
      }
    }

    if (bestScore >= this.threshold) {
      return { matched: true, targetEvent: bestTarget, score: bestScore };
    }

    return { matched: false, score: bestScore };
  }

  private substringBoost(a: string, b: string, currentScore: number): number {
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    // Must be at least 3 chars to prevent false positives like "b8" matching anything
    if (short.length < 3) return currentScore;
    // Check if shorter is a prefix of or contained within the longer
    if (long.startsWith(short) || long.includes('_' + short) || long.includes(short + '_')) {
      return Math.max(currentScore, 0.90);
    }
    return currentScore;
  }
}
