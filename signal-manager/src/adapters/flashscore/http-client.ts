/**
 * FlashScore HTTP Client — Pure HTTP, no Playwright needed
 * Uses the global.flashscore.ninja feed API with x-fsign header
 */

import https from 'node:https';
import { createLogger } from '../../util/logger.js';

const log = createLogger('fs-http');

const FEED_BASE = 'https://global.flashscore.ninja/2/x/feed/';
const HEADERS = {
  'x-fsign': 'SW9D1eZo',
  'x-geoip': '1',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  'Referer': 'https://www.flashscore.com/',
};

export interface FSMatch {
  id: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  minute: string;
  status: 'live' | 'finished' | 'scheduled' | 'unknown';
  league: string;
  country: string;
  startTime: number | null;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: 8000 }, res => {
      let data = '';
      res.on('data', (c: Buffer) => data += c.toString());
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Parse FlashScore proprietary feed format */
function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split('¬')) {
    const idx = part.indexOf('÷');
    if (idx > 0) {
      fields[part.substring(0, idx)] = part.substring(idx + 1);
    }
  }
  return fields;
}

/** Fetch all football matches (live + scheduled) */
export async function fetchAllFootball(): Promise<FSMatch[]> {
  const data = await httpGet(FEED_BASE + 'f_1_0_0_en_1');
  if (!data || data.length < 10) return [];

  const matches: FSMatch[] = [];
  let currentLeague = '';
  let currentCountry = '';

  // Split by ~AA÷ for individual match records
  // But also look for league headers: ~ZA÷ = sport, ZB÷ = league
  const sections = data.split('~');

  for (const section of sections) {
    const fields = parseFields(section);

    // League/tournament header
    if (fields.ZA) currentCountry = fields.ZA;
    if (fields.ZEE) currentLeague = fields.ZEE || fields.ZC || '';

    // Match record (has AA = match ID)
    if (fields.AA && fields.AE && fields.AF) {
      const statusCode = fields.AB;
      let status: FSMatch['status'] = 'unknown';
      if (statusCode === '2' || statusCode === '3') status = 'live';
      else if (statusCode === '3' || statusCode === '4') status = 'finished';
      else if (statusCode === '1') status = 'scheduled';

      matches.push({
        id: fields.AA,
        home: fields.AE,
        away: fields.AF,
        homeScore: fields.AG !== undefined ? parseInt(fields.AG) || 0 : null,
        awayScore: fields.AH !== undefined ? parseInt(fields.AH) || 0 : null,
        minute: fields.AC || '',
        status,
        league: currentLeague,
        country: currentCountry,
        startTime: fields.AD ? parseInt(fields.AD) : null,
      });
    }
  }

  return matches;
}

/** Fetch only live update delta (smaller payload, faster) */
export async function fetchLiveUpdates(): Promise<FSMatch[]> {
  const data = await httpGet(FEED_BASE + 'r_1_1');
  if (!data || data.length < 5) return [];

  const matches: FSMatch[] = [];
  const sections = data.split('~');

  for (const section of sections) {
    const fields = parseFields(section);
    if (fields.AA) {
      matches.push({
        id: fields.AA,
        home: fields.AE || '',
        away: fields.AF || '',
        homeScore: fields.AG !== undefined ? parseInt(fields.AG) || 0 : null,
        awayScore: fields.AH !== undefined ? parseInt(fields.AH) || 0 : null,
        minute: fields.AC || '',
        status: fields.AB === '2' ? 'live' : (fields.AB === '3' ? 'finished' : 'unknown'),
        league: '',
        country: '',
        startTime: fields.AD ? parseInt(fields.AD) : null,
      });
    }
  }

  return matches;
}

/** Fetch detail for a specific match */
export async function fetchMatchDetail(matchId: string): Promise<Record<string, string> | null> {
  try {
    const data = await httpGet(FEED_BASE + 'dc_1_' + matchId);
    if (!data || data.length < 5) return null;
    return parseFields(data);
  } catch {
    return null;
  }
}
