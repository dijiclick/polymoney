import { createLogger } from '../../util/logger.js';
import type { PolymarketAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import { normalizeTeamName } from '../../matching/normalizer.js';

const log = createLogger('pm-discovery');

export interface PolymarketMarket {
  conditionId: string;
  slug: string;
  question: string;
  outcomes: string;              // '["Yes", "No"]'
  outcomePrices: string;         // '["0.65", "0.35"]'
  clobTokenIds: string;          // '["token_yes", "token_no"]' — JSON array string!
  active: boolean;
  closed: boolean;
  sportsMarketType?: string;     // "moneyline", "totals", "spreads", "both_teams_to_score"
  groupItemTitle?: string;       // "O/U 2.5", "Sunderland AFC (-1.5)", etc.
  groupItemThreshold?: number;
  bestAsk?: string;
  lastTradePrice?: number | string;
}

export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  markets: PolymarketMarket[];
  startDate?: string;
  endDate?: string;
}

export interface PolymarketSport {
  id: number;
  sport: string;       // "epl", "nba", "cs2", ...
  tags: string;        // comma-separated tag IDs
  series?: string;
}

// Token mapping: token_id → { event info + market type }
export interface TokenMapping {
  tokenId: string;
  eventId: string;
  eventSlug: string;
  conditionId: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  marketType: string;     // "ml_home", "ml_away", "o", "u", etc.
  threshold?: number;
  timespan: string;
  startTime: number;
  isYesToken: boolean;
  initialPrice?: number;
}

export class PolymarketDiscovery {
  private config: PolymarketAdapterConfig;
  private tokenMap: Map<string, TokenMapping> = new Map();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  // Deduplicate tag fetches: many sports share tags
  private fetchedTags: Set<string> = new Set();

  constructor(config: PolymarketAdapterConfig) {
    this.config = config;
  }

  async discover(): Promise<Map<string, TokenMapping>> {
    try {
      const sports = await this.fetchSports();
      log.info(`Found ${sports.length} sports categories`);

      // Collect unique tag IDs (many sports share tag "1")
      const uniqueTags = new Map<string, string>(); // tagId → first sport slug
      for (const sport of sports) {
        const tagIds = sport.tags.split(',').map(t => t.trim()).filter(Boolean);
        for (const tagId of tagIds) {
          if (!uniqueTags.has(tagId)) {
            uniqueTags.set(tagId, sport.sport);
          }
        }
      }

      // Filter to unfetched, non-broad tags
      const tagsToFetch: [string, string][] = [];
      for (const [tagId, sportSlug] of uniqueTags) {
        if (tagId === '1' || this.fetchedTags.has(tagId)) continue;
        tagsToFetch.push([tagId, sportSlug]);
      }
      log.info(`Fetching events for ${tagsToFetch.length} unique tags (parallel batches of 10)...`);

      // Fetch in parallel batches of 10 to avoid hammering the API
      const BATCH = 10;
      for (let i = 0; i < tagsToFetch.length; i += BATCH) {
        const batch = tagsToFetch.slice(i, i + BATCH);
        await Promise.all(batch.map(([tagId, sportSlug]) =>
          this.fetchEventsForTag(tagId, sportSlug).then(() => this.fetchedTags.add(tagId))
        ));
      }

      log.info(`Discovery complete: ${this.tokenMap.size} tokens mapped`);
      return this.tokenMap;
    } catch (err) {
      log.error('Discovery failed', err);
      return this.tokenMap;
    }
  }

  getTargetEvents(): TargetEvent[] {
    const seen = new Set<string>();
    const targets: TargetEvent[] = [];

    for (const mapping of this.tokenMap.values()) {
      if (seen.has(mapping.eventId)) continue;
      seen.add(mapping.eventId);

      targets.push({
        eventId: mapping.eventId,
        homeTeam: mapping.homeTeam,
        awayTeam: mapping.awayTeam,
        homeNormalized: normalizeTeamName(mapping.homeTeam),
        awayNormalized: normalizeTeamName(mapping.awayTeam),
        sport: mapping.sport,
        league: mapping.league,
        startTime: mapping.startTime,
      });
    }

    return targets;
  }

  startPeriodicRefresh(
    onNewTokens: (tokens: string[]) => void,
    onTargetsUpdated?: (targets: TargetEvent[]) => void,
  ): void {
    this.refreshTimer = setInterval(async () => {
      const oldTokens = new Set(this.tokenMap.keys());
      this.fetchedTags.clear(); // Re-fetch all tags
      await this.discover();

      const newTokenIds: string[] = [];
      for (const tokenId of this.tokenMap.keys()) {
        if (!oldTokens.has(tokenId)) {
          newTokenIds.push(tokenId);
        }
      }

      if (newTokenIds.length > 0) {
        log.info(`Discovered ${newTokenIds.length} new tokens`);
        onNewTokens(newTokenIds);
      }

      if (onTargetsUpdated) {
        onTargetsUpdated(this.getTargetEvents());
      }
    }, this.config.discoveryIntervalMs);
  }

  stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getTokenMapping(tokenId: string): TokenMapping | undefined {
    return this.tokenMap.get(tokenId);
  }

  getAllTokenIds(): string[] {
    return Array.from(this.tokenMap.keys());
  }

  private async fetchSports(): Promise<PolymarketSport[]> {
    const resp = await fetch(`${this.config.gammaApiUrl}/sports`);
    if (!resp.ok) throw new Error(`GET /sports failed: ${resp.status}`);
    return resp.json() as Promise<PolymarketSport[]>;
  }

  private async fetchEventsForTag(tagId: string, sportSlug: string): Promise<void> {
    try {
      const url = `${this.config.gammaApiUrl}/events?tag_id=${tagId}&closed=false&limit=100`;
      const resp = await fetch(url);
      if (!resp.ok) {
        log.warn(`GET events for tag ${tagId} failed: ${resp.status}`);
        return;
      }
      const events = (await resp.json()) as PolymarketEvent[];

      for (const event of events) {
        this.processEvent(event, sportSlug);
      }
    } catch (err) {
      log.warn(`Failed to fetch events for tag ${tagId}`, err);
    }
  }

  private processEvent(event: PolymarketEvent, sportSlug: string): void {
    if (!event.markets || event.markets.length === 0) return;

    // Extract team names from event title: "Team A vs. Team B"
    const { home, away } = this.parseTeamsFromTitle(event.title);
    if (!home || !away) return; // Skip non-matchup events

    const startTime = event.endDate
      ? new Date(event.endDate).getTime()
      : event.startDate
        ? new Date(event.startDate).getTime()
        : Date.now();

    for (const market of event.markets) {
      if (market.closed || !market.active) continue;
      if (!market.clobTokenIds) continue;

      // Parse clobTokenIds — it's a JSON array string: '["token1", "token2"]'
      let tokenIds: string[];
      try {
        const parsed = JSON.parse(market.clobTokenIds);
        if (Array.isArray(parsed)) {
          tokenIds = parsed;
        } else {
          // Fallback: comma-separated
          tokenIds = market.clobTokenIds.split(',').map(t => t.trim());
        }
      } catch {
        tokenIds = market.clobTokenIds.split(',').map(t => t.trim());
      }

      if (tokenIds.length !== 2) continue;

      // Classify market using sportsMarketType field (much more reliable than parsing question)
      const marketInfo = this.classifyMarket(market, home, away);
      if (!marketInfo) continue;

      const seededPrices = this.parseInitialOutcomePrices(market.outcomePrices);
      const yesSeedPrice = this.parseUnitPrice(market.lastTradePrice) ?? seededPrices[0];
      const noSeedPrice = seededPrices[1]
        ?? (yesSeedPrice !== undefined ? this.parseUnitPrice(1 - yesSeedPrice) : undefined);

      // Yes token (index 0)
      this.tokenMap.set(tokenIds[0], {
        tokenId: tokenIds[0],
        eventId: event.id,
        eventSlug: event.slug,
        conditionId: market.conditionId,
        sport: sportSlug,
        league: sportSlug, // Use sport slug as league for now
        homeTeam: home,
        awayTeam: away,
        marketType: marketInfo.yesMarketKey,
        threshold: marketInfo.threshold,
        timespan: 'ft',
        startTime,
        isYesToken: true,
        initialPrice: yesSeedPrice,
      });

      // No token (index 1)
      if (marketInfo.noMarketKey) {
        this.tokenMap.set(tokenIds[1], {
          tokenId: tokenIds[1],
          eventId: event.id,
          eventSlug: event.slug,
          conditionId: market.conditionId,
          sport: sportSlug,
          league: sportSlug,
          homeTeam: home,
          awayTeam: away,
          marketType: marketInfo.noMarketKey,
          threshold: marketInfo.threshold,
          timespan: 'ft',
          startTime,
          isYesToken: false,
          initialPrice: noSeedPrice,
        });
      }
    }
  }

  private parseInitialOutcomePrices(raw: string | undefined): Array<number | undefined> {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: Array<number | undefined> = [];
      for (const v of parsed) {
        out.push(this.parseUnitPrice(v));
      }
      return out;
    } catch {
      return [];
    }
  }

  private parseUnitPrice(value: unknown): number | undefined {
    const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 1) return undefined;
    return n;
  }

  private parseTeamsFromTitle(title: string): { home: string; away: string } {
    // Strip Polymarket suffixes like "- More Markets", "- Team Totals", "- Handicaps"
    let cleanTitle = title.replace(/\s*-\s*(More Markets|Team Totals|Handicaps|Player Props|Specials)$/i, '');

    // Strip game/league prefix: "Counter-Strike: Team vs Team" → "Team vs Team"
    // Matches short prefixes (≤25 chars) ending with ": " only if "vs" follows
    cleanTitle = cleanTitle.replace(/^[^:]{1,25}:\s+(?=.+\s+(?:vs\.?|v\.?)\s+)/i, '');

    // Patterns: "Team A vs. Team B", "Team A vs Team B", "Team A v Team B"
    const vsMatch = cleanTitle.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);
    if (vsMatch) {
      let home = vsMatch[1].trim();
      let away = vsMatch[2].trim();

      // Strip esports format suffix: "(BO3) - Tournament Name"
      home = home.replace(/\s*\(BO\d+\)\s*(?:-\s*.+)?$/i, '').trim();
      away = away.replace(/\s*\(BO\d+\)\s*(?:-\s*.+)?$/i, '').trim();

      return { home, away };
    }
    return { home: '', away: '' };
  }

  private classifyMarket(
    market: PolymarketMarket,
    home: string,
    away: string
  ): { yesMarketKey: string; noMarketKey?: string; threshold?: number } | null {
    const type = market.sportsMarketType;
    const question = market.question.toLowerCase();
    const groupTitle = market.groupItemTitle || '';

    switch (type) {
      case 'moneyline': {
        // "Will Team A win?" → ml_home or ml_away
        // "Will ... end in a draw?" → draw
        if (question.includes('draw') || question.includes('tie')) {
          return { yesMarketKey: 'draw' };
        }
        if (this.mentionsTeam(question, home)) {
          return { yesMarketKey: 'ml_home' };
        }
        if (this.mentionsTeam(question, away)) {
          return { yesMarketKey: 'ml_away' };
        }
        return null;
      }

      case 'totals': {
        // groupItemTitle: "O/U 2.5" — parse threshold
        const ouMatch = groupTitle.match(/O\/U\s+(\d+(?:\.\d+)?)/i)
          || question.match(/O\/U\s+(\d+(?:\.\d+)?)/i);
        if (ouMatch) {
          const threshold = parseFloat(ouMatch[1]);
          // Yes token = Over, No token = Under
          return { yesMarketKey: 'o', noMarketKey: 'u', threshold };
        }
        return null;
      }

      case 'spreads': {
        // groupItemTitle: "Sunderland AFC (-1.5)" — parse team + threshold
        const spreadMatch = groupTitle.match(/(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
        if (spreadMatch) {
          const teamName = spreadMatch[1].trim();
          const threshold = parseFloat(spreadMatch[2]);
          if (this.mentionsTeam(teamName.toLowerCase(), home)) {
            return { yesMarketKey: 'handicap_home', threshold };
          }
          if (this.mentionsTeam(teamName.toLowerCase(), away)) {
            return { yesMarketKey: 'handicap_away', threshold };
          }
        }
        return null;
      }

      case 'both_teams_to_score': {
        return { yesMarketKey: 'btts_yes', noMarketKey: 'btts_no' };
      }

      default: {
        // Unknown type — try question-based fallback
        if (question.includes('win')) {
          if (this.mentionsTeam(question, home)) {
            return { yesMarketKey: 'ml_home' };
          }
          if (this.mentionsTeam(question, away)) {
            return { yesMarketKey: 'ml_away' };
          }
        }
        if (type) log.debug(`Unknown sportsMarketType: "${type}" for: "${market.question}"`);
        return null;
      }
    }
  }

  private mentionsTeam(text: string, team: string): boolean {
    const words = team.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return words.some(w => text.includes(w));
  }
}
