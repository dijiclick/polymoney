import type { TimeSpan } from '../../types/market-keys.js';
import { encodeThreshold } from '../../types/market-keys.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('1xbet-market-map');

// Known 1xbet T-codes → canonical market base keys
// Source: reverse-engineered from 1xbet LiveFeed API
const T_CODE_MAP: Record<number, string> = {
  // 1X2
  1: 'ml_home',
  2: 'draw',
  3: 'ml_away',
  // Double chance
  4: 'dc_1x',
  5: 'dc_12',
  6: 'dc_x2',
  // Totals
  9: 'o',     // Over (needs threshold from P field)
  10: 'u',    // Under (needs threshold from P field)
  // Handicap
  7: 'handicap_home',  // (needs threshold from P field)
  8: 'handicap_away',  // (needs threshold from P field)
  // Both teams to score
  // (T-codes for BTTS vary — will be discovered and added)
};

// Unknown T-codes we've seen but not yet mapped (logged once)
const loggedUnknowns = new Set<number>();

// Time span suffixes based on 1xbet sub-game grouping
const PERIOD_MAP: Record<string, TimeSpan> = {
  'full': 'ft',
  '1st half': '1h',
  '2nd half': '2h',
  '1st quarter': 'q1',
  '2nd quarter': 'q2',
  '3rd quarter': 'q3',
  '4th quarter': 'q4',
  'overtime': 'ot',
  '1st period': 'q1',
  '2nd period': 'q2',
  '3rd period': 'q3',
  '1st set': 'set1',
  '2nd set': 'set2',
  '3rd set': 'set3',
  '4th set': 'set4',
  '5th set': 'set5',
  '1st map': 'map1',
  '2nd map': 'map2',
  '3rd map': 'map3',
};

export function mapMarket(
  tCode: number,
  threshold: number | undefined,
  periodLabel: string
): string | null {
  const baseKey = T_CODE_MAP[tCode];
  if (!baseKey) {
    if (!loggedUnknowns.has(tCode)) {
      loggedUnknowns.add(tCode);
      log.debug(`Unknown T-code: ${tCode} (threshold: ${threshold}, period: ${periodLabel})`);
    }
    return null;
  }

  const timespan = resolveTimespan(periodLabel);

  // Markets that need a threshold
  if (threshold !== undefined && (baseKey === 'o' || baseKey === 'u' || baseKey === 'handicap_home' || baseKey === 'handicap_away')) {
    return `${baseKey}_${encodeThreshold(threshold)}_${timespan}`;
  }

  return `${baseKey}_${timespan}`;
}

function resolveTimespan(label: string): TimeSpan {
  if (!label) return 'ft';
  const normalized = label.toLowerCase().trim();
  return PERIOD_MAP[normalized] || 'ft';
}

// Sport ID mapping — 1xBet sport ID → canonical slug
// Covers all sports that overlap with Polymarket
export const SPORT_IDS: Record<number, string> = {
  // Traditional sports
  1: 'soccer',
  2: 'ice_hockey',
  3: 'basketball',
  4: 'tennis',
  5: 'volleyball',
  6: 'table_tennis',
  9: 'rugby',
  12: 'baseball',
  13: 'american_football',
  14: 'aussie_rules',
  17: 'cricket',
  22: 'golf',
  36: 'handball',
  40: 'boxing',
  62: 'mma',
  66: 'cricket',       // alternate cricket ID
  114: 'rugby',        // alternate rugby ID

  // Esports
  43: 'esports',       // generic esports
  85: 'esports_fifa',
  86: 'esports_cs2',
  97: 'esports_dota2',
  106: 'esports_lol',
  109: 'esports_rl',
  125: 'esports_cod',
  150: 'esports_sc2',
  298: 'esports_ow',
};

export function sportIdToSlug(id: number): string {
  return SPORT_IDS[id] || `sport_${id}`;
}

// 1xBet URL path slugs (for Referer header) — different from canonical names
const URL_SLUGS: Record<number, string> = {
  1: 'football',
  2: 'ice-hockey',
  3: 'basketball',
  4: 'tennis',
  5: 'volleyball',
  6: 'table-tennis',
  9: 'rugby',
  12: 'baseball',
  13: 'american-football',
  17: 'cricket',
  22: 'golf',
  40: 'boxing',
  62: 'mma',
  85: 'esports-fifa',
  86: 'esports-counter-strike',
  97: 'esports-dota-2',
  106: 'esports-league-of-legends',
  109: 'esports-rocket-league',
  125: 'esports-call-of-duty',
  150: 'esports-starcraft-2',
  298: 'esports-overwatch',
};

export function sportIdToUrlSlug(id: number): string {
  return URL_SLUGS[id] || sportIdToSlug(id).replace(/_/g, '-');
}
