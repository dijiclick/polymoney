import { createLogger } from '../util/logger.js';

const log = createLogger('espn');

const ESPN_PATHS: Record<string, string> = {
  'nba': 'basketball/nba',
  'nfl': 'football/nfl',
  'mlb': 'baseball/mlb',
  'nhl': 'hockey/nhl',
  'mls': 'soccer/usa.1',
  'ncaab': 'basketball/mens-college-basketball',
  'ncaaf': 'football/college-football',
  'mma': 'mma/ufc',
  'epl': 'soccer/eng.1',
  'laliga': 'soccer/esp.1',
  'seriea': 'soccer/ita.1',
  'bundesliga': 'soccer/ger.1',
  'ucl': 'soccer/uefa.champions',
};

interface ESPNResult {
  resolved: boolean;
  outcome: string;
  confidence: number;
  source: string;
}

export async function checkESPN(
  question: string,
  subcategory: string,
  endDate?: string
): Promise<ESPNResult | null> {
  const espnPath = ESPN_PATHS[subcategory];
  if (!espnPath) return null;

  // Parse date from question or endDate
  const date = parseEventDate(question, endDate);
  if (!date) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`;

  const res = await fetch(url);
  if (!res.ok) {
    log.warn(`ESPN API ${res.status} for ${espnPath} on ${date}`);
    return null;
  }
  const data = await res.json();
  if (!data.events || data.events.length === 0) return null;

  // Find matching game
  const qLower = question.toLowerCase();
  for (const event of data.events) {
    if (!matchesQuestion(event, qLower)) continue;

    const status = event.status?.type?.name;
    if (status === 'STATUS_FINAL' || status === 'STATUS_FULL_TIME') {
      const winner = determineWinner(event, qLower);
      if (winner) {
        return { resolved: true, outcome: winner, confidence: 100, source: `espn:${subcategory}` };
      }
    }
    // Game found but not finished
    return { resolved: false, outcome: 'unknown', confidence: 0, source: `espn:${subcategory}` };
  }

  return null; // No matching game
}

function matchesQuestion(event: any, qLower: string): boolean {
  const competitors = event.competitions?.[0]?.competitors || [];
  let matched = 0;
  for (const c of competitors) {
    const name = (c.team?.displayName || c.team?.shortDisplayName || '').toLowerCase();
    const abbr = (c.team?.abbreviation || '').toLowerCase();
    if (qLower.includes(name) || qLower.includes(abbr)) matched++;
  }
  return matched >= 1; // At least one team name found in question
}

function determineWinner(event: any, qLower: string): string | null {
  const competitors = event.competitions?.[0]?.competitors || [];
  if (competitors.length < 2) return null;

  const sorted = [...competitors].sort((a: any, b: any) => {
    return Number(b.score || 0) - Number(a.score || 0);
  });

  const winnerName = sorted[0].team?.displayName || '';
  const loserName = sorted[1].team?.displayName || '';

  // Check if question is "Will X win?" style
  if (qLower.includes(winnerName.toLowerCase())) {
    return 'Yes';
  }
  if (qLower.includes(loserName.toLowerCase())) {
    // Question asks about the losing team
    return 'No';
  }

  return winnerName; // Return team name if can't determine yes/no
}

function parseEventDate(question: string, endDate?: string): string | null {
  // Try endDate first
  if (endDate) {
    const d = new Date(endDate);
    if (!isNaN(d.getTime())) {
      return formatESPNDate(d);
    }
  }

  // Try parsing date from question text
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,                    // MM/DD/YYYY
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,                     // Month DD, YYYY
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i,
  ];

  for (const pattern of datePatterns) {
    const match = question.match(pattern);
    if (match) {
      const d = new Date(match[0]);
      if (!isNaN(d.getTime())) return formatESPNDate(d);
    }
  }

  // Default to today
  return formatESPNDate(new Date());
}

function formatESPNDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
