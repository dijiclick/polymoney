/**
 * bet365 pipe-delimited data format parser.
 *
 * Format overview:
 *   F|...records...|   (F = Full / initial snapshot)
 *   U|...records...|   (U = Update / delta)
 *
 * Each record: TYPE;KEY=VALUE;KEY=VALUE;|
 * Record types: CS (content section), CL (classification/league), CT (competition/tournament),
 *   EV (event/match), MA (market), PA (participant/selection), etc.
 *
 * Key fields on EV records:
 *   FI = fixture ID, NA = name, TM = time/kickoff, TU = epoch, CL = classification/sport ID,
 *   T1 = home team, T2 = away team, SC = score, SS = set score, TS = total score,
 *   TT = match time/elapsed, MD = match data (period info), ID = record ID
 *
 * Key fields on PA (participant/odds) records:
 *   OD = odds (fractional like "13/20" or decimal), NA = selection name, ID = selection ID,
 *   FI = fixture ID, OR = order
 *
 * Key fields on MA (market) records:
 *   NA = market name, FI = fixture ID, ID = market ID
 */

export interface Bet365Record {
  type: string;
  fields: Record<string, string>;
}

export interface Bet365Event {
  id: string;           // FI (fixture ID)
  name: string;         // NA
  homeTeam: string;     // T1 or parsed from NA
  awayTeam: string;     // T2 or parsed from NA
  sportId: string;      // CL (classification)
  league: string;       // CT or parent CL name
  leagueId: string;     // league/competition ID
  startTime: number;    // TU (epoch) or parsed from TM
  score?: { home: number; away: number };
  setScore?: string;    // SS (for tennis)
  elapsed?: string;     // TT (match time)
  period?: string;      // MD or parsed period
  isLive: boolean;
  markets: Bet365Market[];
  raw: Record<string, string>;
}

export interface Bet365Market {
  id: string;
  name: string;        // NA on MA record
  selections: Bet365Selection[];
}

export interface Bet365Selection {
  id: string;
  name: string;        // NA on PA record
  odds: number;        // OD parsed to decimal
  oddsRaw: string;     // Original odds string
  order?: number;
}

/** Parse a pipe-delimited bet365 message into records */
export function parseRecords(data: string): Bet365Record[] {
  const records: Bet365Record[] = [];
  // Strip topic prefix if present (e.g. "\x14InPlay_1_9\x01F|...")
  let body = data;
  const topicEnd = body.indexOf('\x01');
  if (topicEnd !== -1 && topicEnd < 100) {
    body = body.slice(topicEnd + 1);
  }

  // Split by pipe, each segment is a record
  const segments = body.split('|');
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed || trimmed === 'F' || trimmed === 'U') continue;

    const parts = trimmed.split(';').filter(Boolean);
    if (parts.length === 0) continue;

    // First part is the record type
    const type = parts[0];
    const fields: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq !== -1) {
        fields[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
      }
    }
    records.push({ type, fields });
  }
  return records;
}

/** Parse fractional odds (e.g. "13/20") to decimal probability, or decimal odds string */
export function parseFractionalOdds(oddsStr: string): number {
  if (!oddsStr) return 0;
  // Fractional: "13/20"
  if (oddsStr.includes('/')) {
    const [num, den] = oddsStr.split('/').map(Number);
    if (!den || isNaN(num) || isNaN(den)) return 0;
    // Decimal odds = (num/den) + 1
    return (num / den) + 1;
  }
  // Decimal odds string
  const dec = parseFloat(oddsStr);
  return isNaN(dec) ? 0 : dec;
}

/** Convert decimal odds to implied probability */
export function oddsToProb(decimalOdds: number): number {
  if (decimalOdds <= 0) return 0;
  return 1 / decimalOdds;
}

/** Parse score string like "1-0" or "2-1" */
export function parseScore(scoreStr: string): { home: number; away: number } | undefined {
  if (!scoreStr) return undefined;
  const match = scoreStr.match(/^(\d+)-(\d+)$/);
  if (!match) return undefined;
  return { home: parseInt(match[1]), away: parseInt(match[2]) };
}

/**
 * Extract structured events from a set of parsed records.
 * Records come in a hierarchy: CL (classification) → CT (competition) → EV (event) → MA (market) → PA (selection)
 * We build events by tracking the current context.
 */
export function extractEvents(records: Bet365Record[]): Bet365Event[] {
  const events: Bet365Event[] = [];
  let currentSportId = '';
  let currentLeague = '';
  let currentLeagueId = '';
  let currentEvent: Bet365Event | null = null;
  let currentMarket: Bet365Market | null = null;

  for (const rec of records) {
    switch (rec.type) {
      case 'CL': {
        currentSportId = rec.fields['ID'] || currentSportId;
        currentLeague = rec.fields['NA'] || '';
        currentLeagueId = rec.fields['ID'] || '';
        break;
      }
      case 'CT': {
        // Competition/tournament — more specific than CL
        currentLeague = rec.fields['NA'] || currentLeague;
        currentLeagueId = rec.fields['ID'] || currentLeagueId;
        break;
      }
      case 'EV': {
        // Flush previous event
        if (currentEvent) {
          if (currentMarket && currentMarket.selections.length > 0) {
            currentEvent.markets.push(currentMarket);
          }
          events.push(currentEvent);
        }
        currentMarket = null;

        const name = rec.fields['NA'] || '';
        const fi = rec.fields['FI'] || rec.fields['ID'] || '';
        let home = rec.fields['T1'] || '';
        let away = rec.fields['T2'] || '';

        // If T1/T2 not present, try parsing from NA ("Team A v Team B")
        if (!home && !away && name.includes(' v ')) {
          const [h, a] = name.split(' v ');
          home = h?.trim() || '';
          away = a?.trim() || '';
        }
        if (!home && !away && name.includes(' vs ')) {
          const [h, a] = name.split(' vs ');
          home = h?.trim() || '';
          away = a?.trim() || '';
        }

        // Parse start time
        let startTime = 0;
        if (rec.fields['TU']) {
          startTime = parseInt(rec.fields['TU']) * 1000; // epoch seconds → ms
        }

        currentEvent = {
          id: fi,
          name,
          homeTeam: home,
          awayTeam: away,
          sportId: currentSportId,
          league: currentLeague,
          leagueId: currentLeagueId,
          startTime,
          score: parseScore(rec.fields['SS'] || rec.fields['SC'] || ''),
          setScore: rec.fields['SS'],
          elapsed: rec.fields['TT'] || rec.fields['TM'] || undefined,
          period: rec.fields['MD'] || undefined,
          isLive: (rec.fields['LI'] === '1' || rec.fields['IB'] === '1'),
          markets: [],
          raw: rec.fields,
        };
        break;
      }
      case 'MA': {
        // Flush previous market
        if (currentMarket && currentMarket.selections.length > 0 && currentEvent) {
          currentEvent.markets.push(currentMarket);
        }
        currentMarket = {
          id: rec.fields['ID'] || '',
          name: rec.fields['NA'] || '',
          selections: [],
        };
        break;
      }
      case 'PA': {
        if (!currentMarket) {
          currentMarket = { id: 'unknown', name: 'Unknown', selections: [] };
        }
        const oddsRaw = rec.fields['OD'] || '';
        const odds = parseFractionalOdds(oddsRaw);
        currentMarket.selections.push({
          id: rec.fields['ID'] || '',
          name: rec.fields['NA'] || '',
          odds,
          oddsRaw,
          order: rec.fields['OR'] ? parseInt(rec.fields['OR']) : undefined,
        });
        break;
      }
      default:
        // Other record types (CS, ER, IN, etc.) — skip
        break;
    }
  }

  // Flush last event
  if (currentEvent) {
    if (currentMarket && currentMarket.selections.length > 0) {
      currentEvent.markets.push(currentMarket);
    }
    events.push(currentEvent);
  }

  return events;
}

/**
 * Parse an update message (U|...) and return field-level updates keyed by record type+ID.
 * Updates reference records by their path in the hierarchy.
 */
export interface Bet365Update {
  topic: string;
  isFullSnapshot: boolean;
  records: Bet365Record[];
  events: Bet365Event[];
}

export function parseMessage(rawData: string): Bet365Update {
  // Extract topic
  let topic = '';
  const topicEnd = rawData.indexOf('\x01');
  if (topicEnd !== -1) {
    // Topic may be prefixed with control char (\x14)
    const topicRaw = rawData.slice(0, topicEnd);
    topic = topicRaw.replace(/[\x00-\x1f]/g, '');
  }

  const body = topicEnd !== -1 ? rawData.slice(topicEnd + 1) : rawData;
  const isFullSnapshot = body.startsWith('F|');

  const records = parseRecords(rawData);
  const events = extractEvents(records);

  return { topic, isFullSnapshot, records, events };
}
