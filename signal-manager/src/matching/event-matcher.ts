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
  private eventIndex: Map<string, string[]> = new Map();    // "sport:league:date" → [eventId, ...]
  private eventTeams: Map<string, EventIdParts> = new Map(); // eventId → { home, away } normalized names
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
      // Fast path: both teams known
      const eventId = this.buildEventId(update.sport, update.league, update.startTime, homeCanonical, awayCanonical);
      this.ensureIndexed(update, eventId, homeCanonical, awayCanonical);
      return eventId;
    }

    // Slow path: fuzzy match within same league + date block
    const blockKey = this.buildBlockKey(update.sport, update.league, update.startTime);
    const candidates = this.eventIndex.get(blockKey);

    if (candidates && candidates.length > 0) {
      const normalizedHome = normalizeTeamName(update.homeTeam);
      const normalizedAway = normalizeTeamName(update.awayTeam);

      let bestScore = 0;
      let bestId: string | null = null;

      for (let i = 0; i < candidates.length; i++) {
        const candidateId = candidates[i];
        const parts = this.eventTeams.get(candidateId);
        if (!parts) continue;

        // Score: average of home-home and away-away similarity
        const homeScore = jaroWinkler(normalizedHome, parts.home);
        const awayScore = jaroWinkler(normalizedAway, parts.away);
        const avgScore = (homeScore + awayScore) / 2;

        if (avgScore > bestScore) {
          bestScore = avgScore;
          bestId = candidateId;
        }
      }

      if (bestId && bestScore >= this.config.fuzzyThreshold) {
        // Learn this mapping for next time
        const parts = this.eventTeams.get(bestId)!;
        this.teamLookup.cache(update.sourceId, update.homeTeam, parts.home);
        this.teamLookup.cache(update.sourceId, update.awayTeam, parts.away);
        log.debug(`Fuzzy matched "${update.homeTeam} vs ${update.awayTeam}" → ${bestId} (score: ${bestScore.toFixed(3)})`);
        return bestId;
      }
    }

    // No match — create new canonical event
    const normalizedHome = normalizeTeamName(update.homeTeam);
    const normalizedAway = normalizeTeamName(update.awayTeam);
    const newId = this.buildEventId(update.sport, update.league, update.startTime, normalizedHome, normalizedAway);
    this.ensureIndexed(update, newId, normalizedHome, normalizedAway);
    this.teamLookup.cache(update.sourceId, update.homeTeam, normalizedHome);
    this.teamLookup.cache(update.sourceId, update.awayTeam, normalizedAway);
    log.debug(`New event: ${newId} from ${update.sourceId}`);
    return newId;
  }

  private ensureIndexed(update: AdapterEventUpdate, eventId: string, home: string, away: string): void {
    if (this.eventTeams.has(eventId)) return;
    this.eventTeams.set(eventId, { home, away });
    const blockKey = this.buildBlockKey(update.sport, update.league, update.startTime);
    let list = this.eventIndex.get(blockKey);
    if (!list) {
      list = [];
      this.eventIndex.set(blockKey, list);
    }
    list.push(eventId);
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
    this.eventTeams.delete(eventId);
    // We don't clean up eventIndex arrays to avoid O(n) — they'll just accumulate
    // stale IDs that fail eventTeams lookup and get skipped
  }
}
