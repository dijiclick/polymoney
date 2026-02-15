import type { AdapterEventUpdate } from '../types/adapter-update.js';
import type { MatcherConfig } from '../types/config.js';
import { TeamLookup } from './team-lookup.js';
import { LeagueMatcher } from './league-matcher.js';
import { normalizeTeamName, consonantSkeleton, tokenContains, substringContains } from './normalizer.js';
import { jaroWinkler } from './fuzzy.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('event-matcher');

export interface MatchResult {
  eventId: string;
  canonicalLeague: string;
  swapped: boolean;
}

interface EventIdParts {
  home: string;
  away: string;
}

export class EventMatcher {
  private teamLookup: TeamLookup;
  readonly leagueMatcher: LeagueMatcher;
  private eventIndex: Map<string, string[]> = new Map();       // "sport:league:date" → [eventId, ...]
  private eventTeams: Map<string, EventIdParts> = new Map();   // eventId → { home, away } normalized names
  private teamNameIndex: Map<string, string> = new Map();      // "normalizedHome|normalizedAway" → eventId
  private teamPairIndex: Map<string, string> = new Map();      // "sport:home_vs_away" → eventId (for swap detection)
  private eventSources: Map<string, Set<string>> = new Map();  // eventId → Set of sourceIds
  private scoreCache: Map<string, { home: number; away: number }> = new Map();
  private config: MatcherConfig;

  constructor(config: MatcherConfig) {
    this.config = config;
    this.teamLookup = new TeamLookup();
    this.teamLookup.loadFromFile(config.teamMappingsPath);
    this.leagueMatcher = new LeagueMatcher();
  }

  /** Update score cache for score-based confirmation */
  updateScore(eventId: string, score: { home: number; away: number }): void {
    this.scoreCache.set(eventId, { ...score });
  }

  /** Get league aliases for a canonical league */
  getLeagueAliases(sport: string, canonicalLeague: string): { [sourceId: string]: string } {
    return this.leagueMatcher.getAliases(sport, canonicalLeague);
  }

  match(update: AdapterEventUpdate): MatchResult {
    const canonicalLeague = this.leagueMatcher.resolve(update.sport, update.league, update.sourceId);
    const homeCanonical = this.teamLookup.resolve(update.sourceId, update.homeTeam);
    const awayCanonical = this.teamLookup.resolve(update.sourceId, update.awayTeam);

    const r = (eventId: string, swapped = false): MatchResult => ({ eventId, canonicalLeague, swapped });

    if (homeCanonical && awayCanonical) {
      // Fast path: both teams known from lookup cache — check both orderings
      const pairKey = `${update.sport}:${homeCanonical}_vs_${awayCanonical}`;
      const swapKey = `${update.sport}:${awayCanonical}_vs_${homeCanonical}`;
      const existingId = this.teamPairIndex.get(pairKey) || this.teamPairIndex.get(swapKey);
      if (existingId && this.eventTeams.has(existingId)) {
        const swapped = !!this.teamPairIndex.get(swapKey) && !this.teamPairIndex.get(pairKey);
        this.trackSource(existingId, update.sourceId);
        this.leagueMatcher.addAlias(update.sport, canonicalLeague, update.sourceId, update.league);
        return r(existingId, swapped);
      }
      const teamKey = `${homeCanonical}|${awayCanonical}`;
      const existingByKey = this.teamNameIndex.get(teamKey);
      if (existingByKey && this.eventTeams.has(existingByKey)) {
        this.trackSource(existingByKey, update.sourceId);
        return r(existingByKey);
      }
      const eventId = this.buildEventId(update.sport, canonicalLeague, update.startTime, homeCanonical, awayCanonical);
      this.ensureIndexed(update, eventId, homeCanonical, awayCanonical);
      return r(eventId);
    }

    const normalizedHome = normalizeTeamName(update.homeTeam);
    const normalizedAway = normalizeTeamName(update.awayTeam);

    // Step 1: Exact team name match — try both orderings for swap detection
    const teamKey = `${normalizedHome}|${normalizedAway}`;
    const swapTeamKey = `${normalizedAway}|${normalizedHome}`;
    const existingByTeam = this.teamNameIndex.get(teamKey) || this.teamNameIndex.get(swapTeamKey);
    if (existingByTeam && this.eventTeams.has(existingByTeam)) {
      const swapped = !!this.teamNameIndex.get(swapTeamKey) && !this.teamNameIndex.get(teamKey);
      this.trackSource(existingByTeam, update.sourceId);
      this.teamLookup.cache(update.sourceId, update.homeTeam, normalizedHome);
      this.teamLookup.cache(update.sourceId, update.awayTeam, normalizedAway);
      return r(existingByTeam, swapped);
    }

    // Step 2: Block-key fuzzy match (same sport + league + date)
    const blockKey = this.buildBlockKey(update.sport, canonicalLeague, update.startTime);
    const blockCandidates = this.eventIndex.get(blockKey);

    if (blockCandidates && blockCandidates.length > 0) {
      const result = this.fuzzySearchWithSwap(normalizedHome, normalizedAway, blockCandidates);
      if (result) {
        this.trackSource(result.id, update.sourceId);
        this.cacheMatch(update, result.id, result.parts);
        log.debug(`Block-key matched "${update.homeTeam} vs ${update.awayTeam}" → ${result.id} (${result.score.toFixed(3)}${result.swapped ? ' SWAPPED' : ''})`);
        return r(result.id, result.swapped);
      }
    }

    // Step 3: Global fuzzy scan — cross-source only
    const candidatesFromOtherSources: string[] = [];
    for (const [eventId, sources] of this.eventSources) {
      if (!sources.has(update.sourceId)) {
        candidatesFromOtherSources.push(eventId);
      }
    }
    if (candidatesFromOtherSources.length > 0) {
      const crossThreshold = this.config.crossSourceThreshold || 0.88;
      const result = this.fuzzySearchWithSwap(normalizedHome, normalizedAway, candidatesFromOtherSources, crossThreshold);
      if (result) {
        this.trackSource(result.id, update.sourceId);
        this.cacheMatch(update, result.id, result.parts);
        log.info(`Cross-source matched [${update.sourceId}] "${update.homeTeam} vs ${update.awayTeam}" → ${result.id} (${result.score.toFixed(3)}${result.swapped ? ' SWAPPED' : ''})`);
        return r(result.id, result.swapped);
      }
    }

    // Step 4: No match — create new canonical event
    const newId = this.buildEventId(update.sport, canonicalLeague, update.startTime, normalizedHome, normalizedAway);
    this.ensureIndexed(update, newId, normalizedHome, normalizedAway);
    this.teamLookup.cache(update.sourceId, update.homeTeam, normalizedHome);
    this.teamLookup.cache(update.sourceId, update.awayTeam, normalizedAway);
    log.debug(`New event: ${newId} from ${update.sourceId}`);
    return r(newId);
  }

  /** Fuzzy search with swap detection — tries both home/away orderings */
  private fuzzySearchWithSwap(
    normalizedHome: string,
    normalizedAway: string,
    candidateIds: string[],
    thresholdOverride?: number
  ): { id: string; score: number; parts: EventIdParts; swapped: boolean } | null {
    const normal = this.fuzzySearch(normalizedHome, normalizedAway, candidateIds, thresholdOverride);
    const swapped = this.fuzzySearch(normalizedAway, normalizedHome, candidateIds, thresholdOverride);
    if (normal && swapped) {
      return normal.score >= swapped.score
        ? { ...normal, swapped: false }
        : { ...swapped, swapped: true };
    }
    if (normal) return { ...normal, swapped: false };
    if (swapped) return { ...swapped, swapped: true };
    return null;
  }

  private fuzzySearch(
    normalizedHome: string,
    normalizedAway: string,
    candidateIds: string[],
    thresholdOverride?: number
  ): { id: string; score: number; parts: EventIdParts } | null {
    const threshold = thresholdOverride ?? this.config.fuzzyThreshold;
    // Minimum per-team score prevents one strong match compensating for a weak one
    // e.g. "Al Shabab" vs "Al Ahli" would score high on "Al" prefix but low overall
    const minPerTeam = Math.max(0.70, threshold - 0.12);
    let bestScore = 0;
    let bestId: string | null = null;
    let bestParts: EventIdParts | null = null;

    for (let i = 0; i < candidateIds.length; i++) {
      const candidateId = candidateIds[i];
      const parts = this.eventTeams.get(candidateId);
      if (!parts) continue;

      const homeScore = jaroWinkler(normalizedHome, parts.home);
      const awayScore = jaroWinkler(normalizedAway, parts.away);

      // Both teams must meet minimum threshold individually
      if (homeScore < minPerTeam || awayScore < minPerTeam) continue;

      const avgScore = (homeScore + awayScore) / 2;

      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestId = candidateId;
        bestParts = parts;
      }
    }

    if (bestId && bestParts && bestScore >= threshold) {
      return { id: bestId, score: bestScore, parts: bestParts };
    }
    return null;
  }

  private cacheMatch(update: AdapterEventUpdate, eventId: string, parts: EventIdParts): void {
    this.teamLookup.cache(update.sourceId, update.homeTeam, parts.home);
    this.teamLookup.cache(update.sourceId, update.awayTeam, parts.away);
    // Also index the normalized names from this source for future exact lookups
    const normalizedHome = normalizeTeamName(update.homeTeam);
    const normalizedAway = normalizeTeamName(update.awayTeam);
    const teamKey = `${normalizedHome}|${normalizedAway}`;
    if (!this.teamNameIndex.has(teamKey)) {
      this.teamNameIndex.set(teamKey, eventId);
    }
  }

  private trackSource(eventId: string, sourceId: string): void {
    let sources = this.eventSources.get(eventId);
    if (!sources) {
      sources = new Set();
      this.eventSources.set(eventId, sources);
    }
    sources.add(sourceId);
  }

  private ensureIndexed(update: AdapterEventUpdate, eventId: string, home: string, away: string): void {
    this.trackSource(eventId, update.sourceId);
    if (this.eventTeams.has(eventId)) return;
    this.eventTeams.set(eventId, { home, away });

    // Block key index
    const blockKey = this.buildBlockKey(update.sport, update.league, update.startTime);
    let list = this.eventIndex.get(blockKey);
    if (!list) {
      list = [];
      this.eventIndex.set(blockKey, list);
    }
    list.push(eventId);

    // Team name index
    const teamKey = `${home}|${away}`;
    if (!this.teamNameIndex.has(teamKey)) {
      this.teamNameIndex.set(teamKey, eventId);
    }

    // Team pair index (for swap detection)
    const pairKey = `${update.sport}:${home}_vs_${away}`;
    if (!this.teamPairIndex.has(pairKey)) {
      this.teamPairIndex.set(pairKey, eventId);
    }
  }

  private buildBlockKey(sport: string, league: string, startTime: number): string {
    const date = new Date(startTime).toISOString().slice(0, 10);
    return `${sport}:${league}:${date}`;
  }

  private buildEventId(sport: string, league: string, startTime: number, home: string, away: string): string {
    const date = new Date(startTime).toISOString().slice(0, 10);
    return `${sport}:${league}:${date}:${home}_vs_${away}`;
  }

  // Cleanup: remove events from index when they're swept from state
  removeEvent(eventId: string): void {
    const parts = this.eventTeams.get(eventId);
    if (parts) {
      const teamKey = `${parts.home}|${parts.away}`;
      this.teamNameIndex.delete(teamKey);
    }
    this.eventTeams.delete(eventId);
    this.eventSources.delete(eventId);
  }
}
