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

// Sport ID mapping (will be expanded as we discover more)
export const SPORT_IDS: Record<number, string> = {
  1: 'soccer',
  2: 'ice_hockey',
  3: 'basketball',
  4: 'handball',
  5: 'tennis',
  12: 'american_football',
  40: 'boxing',
  43: 'esports',
  // TODO: Call GetSportsShortZip and fill this out
};

export function sportIdToSlug(id: number): string {
  return SPORT_IDS[id] || `sport_${id}`;
}
