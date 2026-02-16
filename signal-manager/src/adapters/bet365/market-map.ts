import type { AdapterMarketUpdate } from '../../types/adapter-update.js';
import { encodeThreshold } from '../../types/market-keys.js';

/**
 * Bet365 market/selection → canonical market key mapper.
 *
 * Bet365 Readit protocol sends MA (Market) and PA (Participant/Selection) nodes.
 * MA.NA = market name (e.g. "Full Time Result")
 * PA.NA = selection name (e.g. "Arsenal", "Draw", "Chelsea")
 * PA.OD = decimal odds (e.g. "2.100")
 * PA.HD = handicap value (e.g. "-1.5")
 *
 * For 1X2 markets, selections are ordered: [home, draw, away].
 * We identify draw by name, then treat remaining as home (first) / away (second).
 */

interface RawSelection {
  name: string;
  odds: number | null;
  handicap: string | null;
}

interface RawMarket {
  name: string;
  suspended: boolean;
  selections: Record<string, RawSelection>;
}

const DRAW_NAMES = new Set(['draw', 'the draw', 'x']);

export function mapBet365Odds(rawMarkets: Record<string, RawMarket>): AdapterMarketUpdate[] {
  const result: AdapterMarketUpdate[] = [];

  for (const market of Object.values(rawMarkets)) {
    if (market.suspended) continue;
    const sels = Object.values(market.selections).filter(s => s.odds != null && s.odds > 1);
    if (sels.length === 0) continue;

    const mn = market.name.toLowerCase().trim();

    // ── Full Time Result / 1X2 ──
    if (mn === 'full time result' || mn === 'match result' || mn === '1x2') {
      const drawSel = sels.find(s => DRAW_NAMES.has(s.name.toLowerCase().trim()));
      const nonDraw = sels.filter(s => s !== drawSel);
      if (drawSel) result.push({ key: 'draw_ft', value: drawSel.odds! });
      if (nonDraw.length >= 2) {
        result.push({ key: 'ml_home_ft', value: nonDraw[0].odds! });
        result.push({ key: 'ml_away_ft', value: nonDraw[1].odds! });
      }
      continue;
    }

    // ── Double Chance ──
    if (mn === 'double chance') {
      for (const sel of sels) {
        const sn = sel.name.toLowerCase().trim();
        if (sn === '1x' || sn === 'home or draw' || sn.includes('/draw')) {
          result.push({ key: 'dc_1x_ft', value: sel.odds! });
        } else if (sn === '12' || sn === 'home or away' || (sn.includes('/') && !sn.includes('draw'))) {
          result.push({ key: 'dc_12_ft', value: sel.odds! });
        } else if (sn === 'x2' || sn === 'draw or away' || sn.startsWith('draw/')) {
          result.push({ key: 'dc_x2_ft', value: sel.odds! });
        }
      }
      continue;
    }

    // ── Both Teams To Score ──
    if (mn === 'both teams to score') {
      for (const sel of sels) {
        const sn = sel.name.toLowerCase().trim();
        if (sn === 'yes') result.push({ key: 'btts_yes_ft', value: sel.odds! });
        if (sn === 'no') result.push({ key: 'btts_no_ft', value: sel.odds! });
      }
      continue;
    }

    // ── Over/Under Goals ──
    const ouMatch = mn.match(/(?:goals?\s*)?over\s*\/?\s*under\s*([\d.]+)/i)
      || mn.match(/(?:match\s*)?total\s*(?:goals?\s*)?([\d.]+)/i);
    if (ouMatch) {
      const line = parseFloat(ouMatch[1]);
      if (isNaN(line)) continue;
      const thresh = encodeThreshold(line);
      for (const sel of sels) {
        const sn = sel.name.toLowerCase().trim();
        if (sn.startsWith('over') || sn === 'o') {
          result.push({ key: `o_${thresh}_ft`, value: sel.odds! });
        } else if (sn.startsWith('under') || sn === 'u') {
          result.push({ key: `u_${thresh}_ft`, value: sel.odds! });
        }
      }
      continue;
    }

    // ── Alternative Total Goals (e.g. "Alternative Match Goals") ──
    if (mn.includes('alternative') && (mn.includes('goal') || mn.includes('total'))) {
      for (const sel of sels) {
        const selMatch = sel.name.match(/^(over|under)\s*([\d.]+)/i);
        if (!selMatch) continue;
        const direction = selMatch[1].toLowerCase();
        const line = parseFloat(selMatch[2]);
        if (isNaN(line)) continue;
        const thresh = encodeThreshold(line);
        const prefix = direction === 'over' ? 'o' : 'u';
        result.push({ key: `${prefix}_${thresh}_ft`, value: sel.odds! });
      }
      continue;
    }

    // ── Asian Handicap ──
    if (mn.includes('handicap') && !mn.includes('corner') && !mn.includes('card')) {
      for (const sel of sels) {
        if (!sel.handicap) continue;
        const hc = parseFloat(sel.handicap);
        if (isNaN(hc)) continue;
        // Positive handicap = that team gets the advantage, negative = disadvantage
        // First selection = home, second = away
        const thresh = encodeThreshold(hc);
        const sn = sel.name.toLowerCase().trim();
        // Try to determine home/away from position or name
        const idx = sels.indexOf(sel);
        if (idx === 0) {
          result.push({ key: `handicap_home_${thresh}_ft`, value: sel.odds! });
        } else if (idx === 1) {
          result.push({ key: `handicap_away_${thresh}_ft`, value: sel.odds! });
        }
      }
      continue;
    }
  }

  return result;
}
