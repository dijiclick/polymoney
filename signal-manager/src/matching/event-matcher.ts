import type { AdapterEventUpdate } from '../types/adapter-update.js';
import type { MatcherConfig } from '../types/config.js';
import { TeamLookup } from './team-lookup.js';
import { normalizeTeamName } from './normalizer.js';
import { jaroWinkler } from './fuzzy.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('event-matcher');

interface EventIdParts {
  home: string;
  away: string;
}

export class EventMatcher {
  private teamLookup: TeamLookup;
  private eventIndex: Map<string, string[]> = new Map();       // "sport:league:date" → [eventId, ...]
  private eventTeams: Map<string, EventIdParts> = new Map();   // eventId → { home, away } normalized names
  private teamNameIndex: Map<string, string> = new Map();      // "normalizedHome|normalizedAway" → eventId
  private eventSources: Map<string, Set<string>> = new Map();  // eventId → Set of sourceIds
  private config: MatcherConfig;

  constructor(config: MatcherConfig) {
    this.config = config;
    this.teamLookup = new TeamLookup();
    this.teamLookup.loadFromFile(config.teamMappingsPath);
  }

  match(update: AdapterEventUpdate): string {
    const homeCanonical = this.teamLookup.resolve(update.sourceId, update.homeTeam);
    const awayCanonical = this.teamLookup.resolve(update.sourceId, update.awayTeam);

    if (homeCanonical && awayCanonical) {
      // Fast path: both teams known from lookup cache
      const teamKey = `${homeCanonical}|${awayCanonical}`;
      const existingId = this.teamNameIndex.get(teamKey);
      if (existingId && this.eventTeams.has(existingId)) {
        this.trackSource(existingId, update.sourceId);
        return existingId;
      }
      // Not indexed yet — build event ID using this update's metadata
      const eventId = this.buildEventId(update.sport, update.league, update.startTime, homeCanonical, awayCanonical);
      this.ensureIndexed(update, eventId, homeCanonical, awayCanonical);
      return eventId;
    }

    const normalizedHome = normalizeTeamName(update.homeTeam);
    const normalizedAway = normalizeTeamName(update.awayTeam);

    // Step 1: Exact team name match (works across all sources regardless of sport/league/date)
    const teamKey = `${normalizedHome}|${normalizedAway}`;
    const existingByTeam = this.teamNameIndex.get(teamKey);
    if (existingByTeam && this.eventTeams.has(existingByTeam)) {
      this.trackSource(existingByTeam, update.sourceId);
      this.teamLookup.cache(update.sourceId, update.homeTeam, normalizedHome);
      this.teamLookup.cache(update.sourceId, update.awayTeam, normalizedAway);
      return existingByTeam;
    }

    // Step 2: Block-key fuzzy match (same sport + league + date)
    const blockKey = this.buildBlockKey(update.sport, update.league, update.startTime);
    const blockCandidates = this.eventIndex.get(blockKey);

    if (blockCandidates && blockCandidates.length > 0) {
      const result = this.fuzzySearch(normalizedHome, normalizedAway, blockCandidates);
      if (result) {
        this.trackSource(result.id, update.sourceId);
        this.cacheMatch(update, result.id, result.parts);
        log.debug(`Block-key matched "${update.homeTeam} vs ${update.awayTeam}" → ${result.id} (${result.score.toFixed(3)})`);
        return result.id;
      }
    }

    // Step 3: Global fuzzy scan across ALL events (cross-source fallback)
    // ONLY considers events that do NOT already have data from this source
    // This prevents same-source false merges (e.g. two different PM cricket matches)
    const candidatesFromOtherSources: string[] = [];
    for (const [eventId, sources] of this.eventSources) {
      if (!sources.has(update.sourceId)) {
        candidatesFromOtherSources.push(eventId);
      }
    }
    if (candidatesFromOtherSources.length > 0) {
      const crossThreshold = this.config.crossSourceThreshold || 0.88;
      const result = this.fuzzySearch(normalizedHome, normalizedAway, candidatesFromOtherSources, crossThreshold);
      if (result) {
        this.trackSource(result.id, update.sourceId);
        this.cacheMatch(update, result.id, result.parts);
        log.info(`Cross-source matched [${update.sourceId}] "${update.homeTeam} vs ${update.awayTeam}" → ${result.id} (${result.score.toFixed(3)})`);
        return result.id;
      }
    }

    // Step 4: No match — create new canonical event
    const newId = this.buildEventId(update.sport, update.league, update.startTime, normalizedHome, normalizedAway);
    this.ensureIndexed(update, newId, normalizedHome, normalizedAway);
    this.teamLookup.cache(update.sourceId, update.homeTeam, normalizedHome);
    this.teamLookup.cache(update.sourceId, update.awayTeam, normalizedAway);
    log.debug(`New event: ${newId} from ${update.sourceId}`);
    return newId;
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
