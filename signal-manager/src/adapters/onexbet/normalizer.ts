import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import type { OnexbetGameData } from './live-feed.js';
import type { OnexbetGameSummary } from './discovery.js';
import { mapMarket, sportIdToSlug } from './market-map.js';

const SOURCE_ID = 'onexbet';

export function normalizeGameData(
  game: OnexbetGameData,
  summary: OnexbetGameSummary | undefined
): AdapterEventUpdate | null {
  const sportId = game.S || summary?.S || 1;
  const sport = sportIdToSlug(sportId);
  const league = game.L || summary?.L || '';
  const startTime = (summary?.T || 0) * 1000; // Convert seconds to ms

  // Parse markets
  const markets: AdapterEventUpdate['markets'] = [];
  if (game.E) {
    for (let i = 0; i < game.E.length; i++) {
      const e = game.E[i];
      if (!e.C || e.C <= 1) continue; // Invalid odds

      const threshold = e.P !== undefined && e.P !== 0 ? e.P : undefined;
      const periodLabel = e.G || '';
      const marketKey = mapMarket(e.T, threshold, periodLabel);

      if (marketKey) {
        markets.push({
          key: marketKey,
          value: Math.round(e.C * 1000) / 1000, // Already decimal, round to 3 places
        });
      }
    }
  }

  if (markets.length === 0) return null;

  // Parse score
  let score: { home: number; away: number } | undefined;
  if (game.SC?.PS && game.SC.PS.length > 0) {
    let totalHome = 0;
    let totalAway = 0;
    for (const period of game.SC.PS) {
      totalHome += period.S1 || 0;
      totalAway += period.S2 || 0;
    }
    score = { home: totalHome, away: totalAway };
  }

  return {
    sourceId: SOURCE_ID,
    sourceEventId: String(game.I),
    sport,
    league,
    startTime,
    homeTeam: game.O1 || summary?.O1 || '',
    awayTeam: game.O2 || summary?.O2 || '',
    status: 'live', // If we're polling from LiveFeed, it's live
    stats: score ? { score } : undefined,
    markets,
    timestamp: Date.now(),
  };
}
