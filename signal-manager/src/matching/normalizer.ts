// Team name normalization pipeline:
// input → lowercase → NFD decompose → strip diacritics → strip punctuation
//       → collapse whitespace → strip common suffixes → trim

const COMMON_SUFFIXES = /\b(fc|cf|sc|ac|as|ss|bk|fk|sk|united|utd|city|town|county|athletic|ath|sporting|sport|esports|esport|gaming|club|team)\b/g;

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^\w\s]/g, '')         // strip punctuation
    .replace(COMMON_SUFFIXES, '')     // strip common suffixes
    .replace(/\s+/g, '_')            // collapse whitespace to underscore
    .replace(/^_+|_+$/g, '')         // trim leading/trailing underscores
    .replace(/_+/g, '_');            // collapse consecutive underscores
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
