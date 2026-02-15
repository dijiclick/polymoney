// Team name normalization pipeline:
// input → lowercase → NFD decompose → strip diacritics → transliterate
//       → strip country codes → strip punctuation → strip common suffixes
//       → collapse whitespace → trim

const COMMON_SUFFIXES = /\b(fc|cf|sc|ac|as|ss|bk|fk|sk|united|utd|city|town|county|athletic|ath|sporting|sport|club|team)\b/g;

// Country codes in parentheses: (Kaz), (Arm), (USA), (Bra), etc.
const COUNTRY_CODE = /\s*\([a-z]{2,4}\)\s*/g;

// Non-ASCII Latin characters that NFD doesn't decompose into ASCII base + combining mark.
// These get stripped by \w if not transliterated first.
const TRANSLITERATE: Record<string, string> = {
  'ə': 'e', 'ı': 'i', 'ø': 'o', 'æ': 'ae', 'ð': 'd',
  'þ': 'th', 'ł': 'l', 'đ': 'd', 'ß': 'ss', 'œ': 'oe',
};
const TRANSLIT_RE = new RegExp(`[${Object.keys(TRANSLITERATE).join('')}]`, 'g');

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(TRANSLIT_RE, ch => TRANSLITERATE[ch] || ch) // transliterate remaining non-ASCII
    .replace(COUNTRY_CODE, ' ')      // strip country codes like (Kaz), (Arm)
    .replace(/[^\w\s]/g, '')         // strip punctuation
    .replace(COMMON_SUFFIXES, '')     // strip common suffixes
    .replace(/\s+/g, '_')            // collapse whitespace to underscore
    .replace(/^_+|_+$/g, '')         // trim leading/trailing underscores
    .replace(/_+/g, '_');            // collapse consecutive underscores
}

/** Strip vowels from a normalized name — consonant skeleton for fuzzy matching. */
export function consonantSkeleton(normalized: string): string {
  return normalized.replace(/[aeiou]/g, '');
}

export function normalizeLeague(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Split a normalized (or raw) name into lowercase, diacritics-stripped tokens */
export function toTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Check if all tokens of the shorter name appear in the longer name's tokens.
 * Returns true if `a` is a token-subset of `b` or vice-versa.
 */
export function tokenContains(a: string, b: string): boolean {
  const tokA = toTokens(a);
  const tokB = toTokens(b);
  if (tokA.length === 0 || tokB.length === 0) return false;
  const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  const longerSet = new Set(longer);
  for (let i = 0; i < shorter.length; i++) {
    if (!longerSet.has(shorter[i])) return false;
  }
  return true;
}

/** Check if one normalized string contains the other as a substring */
export function substringContains(a: string, b: string): boolean {
  const na = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]/g, '');
  const nb = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]/g, '');
  if (na.length === 0 || nb.length === 0) return false;
  return na.includes(nb) || nb.includes(na);
}
