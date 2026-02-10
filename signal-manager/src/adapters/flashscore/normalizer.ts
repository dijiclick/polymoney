import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import type { FlashScoreMatch } from './scraper.js';

const SOURCE_ID = 'flashscore';

export function normalizeMatch(
  match: FlashScoreMatch,
  sport: string,
  leagueName: string
): AdapterEventUpdate {
  let score: { home: number; away: number } | undefined;
  if (match.scoreHome !== null && match.scoreAway !== null) {
    const h = parseInt(match.scoreHome, 10);
    const a = parseInt(match.scoreAway, 10);
    if (!isNaN(h) && !isNaN(a)) {
      score = { home: h, away: a };
    }
  }

  const status = match.isFinished ? 'ended' as const
    : match.isLive ? 'live' as const
    : 'scheduled' as const;

  return {
    sourceId: SOURCE_ID,
    sourceEventId: match.id,
    sport,
    league: leagueName,
    startTime: 0, // FlashScore doesn't give exact timestamps easily
    homeTeam: match.home,
    awayTeam: match.away,
    status,
    stats: score ? { score, elapsed: match.time } : {},
    markets: [], // FlashScore scraping gives scores, not odds (odds would need a separate endpoint)
    timestamp: Date.now(),
  };
}
