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

export interface UnifiedEvent {
  id: string;
  sport: string;
  league: string;
  startTime: number;
  status: EventStatus;
  home: TeamInfo;
  away: TeamInfo;
  stats: EventStats;
  markets: { [marketKey: string]: MarketSources };
  _lastUpdate: number;
}
