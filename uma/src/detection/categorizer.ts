const SPORTS_TAGS = new Set([
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'soccer', 'football', 'basketball',
  'baseball', 'hockey', 'tennis', 'mma', 'ufc', 'boxing', 'ncaab', 'ncaaf',
  'cricket', 'rugby', 'golf', 'f1', 'nascar', 'olympics', 'sports',
  'epl', 'la-liga', 'serie-a', 'bundesliga', 'champions-league', 'world-cup',
]);

const SPORTS_PATTERNS = [
  /\bwin\b.*\b(game|match|series|tournament|championship|cup|ring|title)\b/i,
  /\bvs\.?\b/i,
  /\b(nba|nfl|mlb|nhl|mls|ufc|atp|wta|pga)\b/i,
  /\b(playoffs?|finals?|super bowl|world series|stanley cup)\b/i,
  /\b(touchdown|home run|slam dunk|goal|knockout)\b/i,
  /\bover\/under\b/i,
  /\b(quarterback|pitcher|goalie|striker)\b/i,
  /\b(score|points|yards|rushing|passing)\s+(over|under|more|fewer)\b/i,
];

const POLITICS_PATTERNS = [
  /\b(president|election|congress|senate|vote|ballot|governor|mayor)\b/i,
  /\b(democrat|republican|gop|dnc|rnc)\b/i,
  /\b(trump|biden|harris|desantis|newsom)\b/i,
  /\b(legislation|bill|law|executive order|impeach)\b/i,
];

const WEATHER_PATTERNS = [
  /\btemperature\b/i,
  /\bhighest temp\b/i,
  /\b°[FC]\b/,
  /\b(hurricane|tornado|earthquake|flood|wildfire)\b/i,
];

const LEAGUE_MAP: [RegExp, string][] = [
  [/\bnba\b/i, 'nba'],
  [/\bnfl\b/i, 'nfl'],
  [/\bmlb\b/i, 'mlb'],
  [/\bnhl\b/i, 'nhl'],
  [/\bmls\b/i, 'mls'],
  [/\bncaa\b.*\bbasketball\b/i, 'ncaab'],
  [/\bncaab\b/i, 'ncaab'],
  [/\bmarch madness\b/i, 'ncaab'],
  [/\bncaa\b.*\bfootball\b/i, 'ncaaf'],
  [/\bncaaf\b/i, 'ncaaf'],
  [/\bufc\b|\bmma\b/i, 'mma'],
  [/\bepl\b|\bpremier league\b/i, 'epl'],
  [/\bla liga\b/i, 'laliga'],
  [/\bserie a\b/i, 'seriea'],
  [/\bbundesliga\b/i, 'bundesliga'],
  [/\bchampions league\b/i, 'ucl'],
  [/\bf1\b|\bformula\s*1\b/i, 'f1'],
  [/\btennis\b|\batp\b|\bwta\b/i, 'tennis'],
  [/\bgolf\b|\bpga\b|\bmasters\b/i, 'golf'],
];

function detectLeague(question: string): string {
  for (const [pattern, league] of LEAGUE_MAP) {
    if (pattern.test(question)) return league;
  }
  return 'unknown';
}

export function categorize(
  question: string,
  tags?: { id?: number; slug?: string; label?: string }[]
): { category: string; subcategory: string } {
  const tagSlugs = (tags || []).map(t => t.slug || '').filter(Boolean);

  // Check tags first (most reliable)
  if (tagSlugs.some(s => SPORTS_TAGS.has(s))) {
    return { category: 'sports', subcategory: detectLeague(question) };
  }

  // Keyword fallbacks
  if (SPORTS_PATTERNS.some(p => p.test(question))) {
    return { category: 'sports', subcategory: detectLeague(question) };
  }
  if (POLITICS_PATTERNS.some(p => p.test(question))) {
    return { category: 'politics', subcategory: 'general' };
  }
  if (WEATHER_PATTERNS.some(p => p.test(question))) {
    return { category: 'weather', subcategory: 'general' };
  }

  return { category: 'other', subcategory: 'general' };
}
