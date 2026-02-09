import type { EventStatus, EventStats } from './unified-event.js';

export interface AdapterMarketUpdate {
  key: string;
  value: number;
}

export interface AdapterEventUpdate {
  sourceId: string;
  sourceEventId: string;
  sport: string;
  league: string;
  startTime: number;
  homeTeam: string;
  awayTeam: string;
  status?: EventStatus;
  stats?: Partial<EventStats>;
  markets: AdapterMarketUpdate[];
  timestamp: number;
}
