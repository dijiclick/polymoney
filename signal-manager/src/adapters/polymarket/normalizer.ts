import type { AdapterEventUpdate, AdapterMarketUpdate } from '../../types/adapter-update.js';
import type { TokenMapping } from './discovery.js';
import type { ScoreUpdate } from './scores-ws.js';
import { askToDecimal } from '../../util/odds.js';
import { encodeThreshold } from '../../types/market-keys.js';

const SOURCE_ID = 'polymarket';

export function normalizePriceChange(
  mapping: TokenMapping,
  bestAsk: number,
  timestamp: number
): AdapterEventUpdate {
  const decimalOdds = askToDecimal(bestAsk);
  const marketKey = buildMarketKey(mapping);

  return {
    sourceId: SOURCE_ID,
    sourceEventId: mapping.eventId,
    sourceEventSlug: mapping.eventSlug,
    sport: mapping.sport,
    league: mapping.league,
    startTime: mapping.startTime,
    homeTeam: mapping.homeTeam,
    awayTeam: mapping.awayTeam,
    markets: [{ key: marketKey, value: decimalOdds, tokenId: mapping.tokenId }],
    timestamp,
  };
}

export function normalizeScoreUpdate(
  scoreUpdate: ScoreUpdate,
  eventMapping: { sport: string; homeTeam: string; awayTeam: string; startTime: number; eventId: string } | null
): AdapterEventUpdate | null {
  if (!eventMapping) return null;

  // Parse score "3-16" → { home: 3, away: 16 }
  const scoreParts = scoreUpdate.score?.split('-');
  const score = scoreParts && scoreParts.length === 2
    ? { home: parseInt(scoreParts[0], 10), away: parseInt(scoreParts[1], 10) }
    : undefined;

  return {
    sourceId: SOURCE_ID,
    sourceEventId: eventMapping.eventId,
    sport: eventMapping.sport,
    league: scoreUpdate.leagueAbbreviation || '',
    startTime: eventMapping.startTime,
    homeTeam: eventMapping.homeTeam || scoreUpdate.homeTeam,
    awayTeam: eventMapping.awayTeam || scoreUpdate.awayTeam,
    status: scoreUpdate.ended ? 'ended' : scoreUpdate.live ? 'live' : 'scheduled',
    stats: {
      score,
      period: scoreUpdate.period,
      elapsed: scoreUpdate.elapsed,
    },
    markets: [], // Score updates don't carry odds
    timestamp: Date.now(),
  };
}

function buildMarketKey(mapping: TokenMapping): string {
  const { marketType, threshold, timespan } = mapping;
  if (threshold !== undefined) {
    return `${marketType}_${encodeThreshold(threshold)}_${timespan}`;
  }
  return `${marketType}_${timespan}`;
}
