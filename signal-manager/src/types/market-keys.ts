// Market key builder: generates flat canonical keys
// Format: {market}_{threshold}_{timespan}

export type TimeSpan =
  | 'ft' | '1h' | '2h'
  | 'q1' | 'q2' | 'q3' | 'q4'
  | 'ot'
  | 'map1' | 'map2' | 'map3' | 'map4' | 'map5'
  | 'set1' | 'set2' | 'set3' | 'set4' | 'set5'
  | string; // extensible

// Encode threshold: 2.5 → "2_5", -1.5 → "m1_5"
export function encodeThreshold(value: number): string {
  const prefix = value < 0 ? 'm' : '';
  const abs = Math.abs(value);
  const str = abs.toString().replace('.', '_');
  return `${prefix}${str}`;
}

// Build market key
export function buildMarketKey(market: string, timespan: TimeSpan, threshold?: number): string {
  if (threshold !== undefined) {
    return `${market}_${encodeThreshold(threshold)}_${timespan}`;
  }
  return `${market}_${timespan}`;
}

// Common market key builders
export const mk = {
  mlHome: (ts: TimeSpan) => `ml_home_${ts}`,
  mlAway: (ts: TimeSpan) => `ml_away_${ts}`,
  draw: (ts: TimeSpan) => `draw_${ts}`,
  over: (threshold: number, ts: TimeSpan) => `o${encodeThreshold(threshold)}_${ts}`,
  under: (threshold: number, ts: TimeSpan) => `u${encodeThreshold(threshold)}_${ts}`,
  bttsYes: (ts: TimeSpan) => `btts_yes_${ts}`,
  bttsNo: (ts: TimeSpan) => `btts_no_${ts}`,
  handicapHome: (threshold: number, ts: TimeSpan) => `handicap_home_${encodeThreshold(threshold)}_${ts}`,
  handicapAway: (threshold: number, ts: TimeSpan) => `handicap_away_${encodeThreshold(threshold)}_${ts}`,
  cornersOver: (threshold: number, ts: TimeSpan) => `corners_o${encodeThreshold(threshold)}_${ts}`,
  cornersUnder: (threshold: number, ts: TimeSpan) => `corners_u${encodeThreshold(threshold)}_${ts}`,
  cardsOver: (threshold: number, ts: TimeSpan) => `cards_o${encodeThreshold(threshold)}_${ts}`,
  cardsUnder: (threshold: number, ts: TimeSpan) => `cards_u${encodeThreshold(threshold)}_${ts}`,
  correctScore: (home: number, away: number, ts: TimeSpan) => `correct_score_${home}_${away}_${ts}`,
  doubleChance1X: (ts: TimeSpan) => `dc_1x_${ts}`,
  doubleChance12: (ts: TimeSpan) => `dc_12_${ts}`,
  doubleChanceX2: (ts: TimeSpan) => `dc_x2_${ts}`,
  // Player markets
  playerOver: (slug: string, stat: string, threshold: number, ts: TimeSpan) =>
    `player_${slug}_${stat}_o${encodeThreshold(threshold)}_${ts}`,
  playerUnder: (slug: string, stat: string, threshold: number, ts: TimeSpan) =>
    `player_${slug}_${stat}_u${encodeThreshold(threshold)}_${ts}`,
};
