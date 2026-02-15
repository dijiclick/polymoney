import { normalizeLeague, tokenContains } from './normalizer.js';
import { jaroWinkler } from './fuzzy.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('league-matcher');

const LEAGUE_FUZZY_THRESHOLD = 0.75;

interface CanonicalLeague {
  normalized: string;             // normalized form (first-seen), used as canonical ID
  sport: string;                  // sport must match for grouping
  aliases: Map<string, string>;   // sourceId → raw league name
}

export class LeagueMatcher {
  private leagues: CanonicalLeague[] = [];
  // Fast lookup: "sport:normalizedLeague" → index into leagues[]
  private exactIndex: Map<string, number> = new Map();

  /**
   * Resolve an incoming league name to a canonical league ID.
   * Returns the normalized canonical league string.
   */
  resolve(sport: string, rawLeague: string, sourceId: string): string {
    const normalized = normalizeLeague(rawLeague);
    const exactKey = `${sport}:${normalized}`;

    // Fast path: exact normalized match
    const exactIdx = this.exactIndex.get(exactKey);
    if (exactIdx !== undefined) {
      const league = this.leagues[exactIdx];
      league.aliases.set(sourceId, rawLeague);
      return league.normalized;
    }

    // Slow path: fuzzy match against all leagues in the same sport
    let bestScore = 0;
    let bestIdx = -1;

    for (let i = 0; i < this.leagues.length; i++) {
      const candidate = this.leagues[i];
      if (candidate.sport !== sport) continue;

      // Token containment check (e.g., "indo d4" vs "indonesia liga 4")
      if (tokenContains(normalized.replace(/_/g, ' '), candidate.normalized.replace(/_/g, ' '))) {
        // Strong match — token containment
        if (bestScore < 0.90) {
          bestScore = 0.90;
          bestIdx = i;
        }
        continue;
      }

      // Jaro-Winkler on normalized league names
      const score = jaroWinkler(normalized, candidate.normalized);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= LEAGUE_FUZZY_THRESHOLD) {
      const league = this.leagues[bestIdx];
      league.aliases.set(sourceId, rawLeague);
      // Also index this normalized form for future exact lookups
      this.exactIndex.set(exactKey, bestIdx);
      log.debug(`League matched: "${rawLeague}" → "${league.normalized}" (score: ${bestScore.toFixed(3)})`);
      return league.normalized;
    }

    // No match — create new canonical league
    const newLeague: CanonicalLeague = {
      normalized,
      sport,
      aliases: new Map([[sourceId, rawLeague]]),
    };
    const newIdx = this.leagues.length;
    this.leagues.push(newLeague);
    this.exactIndex.set(exactKey, newIdx);
    log.debug(`New league: "${rawLeague}" → "${normalized}" (sport: ${sport})`);
    return normalized;
  }

  /**
   * Add a league alias learned from a successful event match.
   * When events match across different league names, we learn the mapping.
   */
  addAlias(sport: string, canonicalLeague: string, sourceId: string, rawLeague: string): void {
    const key = `${sport}:${canonicalLeague}`;
    const idx = this.exactIndex.get(key);
    if (idx !== undefined) {
      const league = this.leagues[idx];
      league.aliases.set(sourceId, rawLeague);
      // Index the normalized form of this alias for future exact lookups
      const normalized = normalizeLeague(rawLeague);
      const aliasKey = `${sport}:${normalized}`;
      if (!this.exactIndex.has(aliasKey)) {
        this.exactIndex.set(aliasKey, idx);
        log.debug(`League alias learned: "${rawLeague}" → "${canonicalLeague}" (from event match)`);
      }
    }
  }

  /** Get all source aliases for a canonical league */
  getAliases(sport: string, canonicalLeague: string): { [sourceId: string]: string } {
    const key = `${sport}:${canonicalLeague}`;
    const idx = this.exactIndex.get(key);
    if (idx === undefined) return {};
    const league = this.leagues[idx];
    const result: { [sourceId: string]: string } = {};
    for (const [src, raw] of league.aliases) {
      result[src] = raw;
    }
    return result;
  }
}
