export interface SourceOdds {
  value: number;
  timestamp: number;
}

export interface MarketSources {
  [sourceId: string]: SourceOdds;
}

export interface TeamInfo {
  name: string;
  aliases: { [source: string]: string };
}

export interface EventStats {
  score?: { home: number; away: number };
  period?: string;
  elapsed?: string;
  [key: string]: any;
}

export type EventStatus = 'scheduled' | 'live' | 'ended' | 'canceled';

export type IncidentType = 'goal' | 'corner' | 'card' | 'red_card' | 'penalty' | 'var' | 'substitution' | 'other';

export interface Incident {
  key: string;
  type: IncidentType;
  team: 'home' | 'away' | 'none';
  description: string;
  sources: { [sourceId: string]: number };
  firstSource: string;
  firstTimestamp: number;
}

export interface UnifiedEvent {
  id: string;
  sport: string;
  league: string;
  canonicalLeague: string;
  leagueAliases: { [sourceId: string]: string };
  startTime: number;
  status: EventStatus;
  home: TeamInfo;
  away: TeamInfo;
  stats: EventStats;
  markets: { [marketKey: string]: MarketSources };
  /** Polymarket CLOB token IDs: marketKey → tokenId */
  _tokenIds: Record<string, string>;
  /** Previous score before last update (for goal classification) */
  _prevScore?: { home: number; away: number };
  /** Source that last set the score (for cross-source dedup) */
  _lastScoreSource?: string;
  polymarketSlug?: string;
  /** Per-source external event IDs (e.g. 1xBet game ID) */
  _sourceEventIds: Record<string, string>;
  sourceEventIds: Record<string, string>;
  incidents: Incident[];
  _sourceScores: { [sourceId: string]: { home: number; away: number } };
  _lastUpdate: number;
}
