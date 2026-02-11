import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import type { OnexbetGameData } from './live-feed.js';
import type { OnexbetGameSummary } from './discovery.js';
import type { TargetEvent } from '../../types/target-event.js';
import { mapMarket, sportIdToSlug } from './market-map.js';

const SOURCE_ID = 'onexbet';

export function normalizeGameData(
  game: OnexbetGameData,
  summary: OnexbetGameSummary | undefined,
  target?: TargetEvent
): AdapterEventUpdate | null {
  // GetGameZip wraps data in .Value
  const val = game.Value || game as any;

  // val.S from GetGameZip is timestamp, not sport ID — use summary.S for sport ID
  const sportId = summary?.S || 1;
  // Use Polymarket target metadata when available for consistent event matching
  const sport = target?.sport || sportIdToSlug(sportId);
  const league = target?.league || val.L || summary?.L || '';
  // summary.T already has start time (set from API's S field in discovery)
  const startTime = target?.startTime || (summary?.T || val.S || 0) * 1000;
  const homeTeam = val.O1 || summary?.O1 || '';
  const awayTeam = val.O2 || summary?.O2 || '';

  if (!homeTeam || !awayTeam) return null;

  // Parse markets from GE (Grouped Events) structure
  const markets: AdapterEventUpdate['markets'] = [];
  
  if (val.GE && Array.isArray(val.GE)) {
    for (const group of val.GE) {
      const groupId = group.G;
      if (!group.E || !Array.isArray(group.E)) continue;
      
      for (const marketArr of group.E) {
        if (!Array.isArray(marketArr) || marketArr.length === 0) continue;
        const m = marketArr[0]; // First element contains the data
        
        if (!m.C || m.C <= 1) continue;
        
        const threshold = m.P !== undefined && m.P !== 0 ? m.P : undefined;
        // Build market key from group + type
        const marketKey = mapMarketFromGroup(groupId, m.T, threshold);
        
        if (marketKey) {
          markets.push({
            key: marketKey,
            value: Math.round(m.C * 1000) / 1000,
          });
        }
      }
    }
  }

  if (markets.length === 0) return null;

  // Parse score from SC structure
  let score: { home: number; away: number } | undefined;
  if (val.SC) {
    if (val.SC.FS) {
      score = { home: val.SC.FS.S1 || 0, away: val.SC.FS.S2 || 0 };
    } else if (val.SC.PS && Array.isArray(val.SC.PS)) {
      let totalHome = 0, totalAway = 0;
      for (const period of val.SC.PS) {
        const v = period.Value || period;
        totalHome += v.S1 || 0;
        totalAway += v.S2 || 0;
      }
      score = { home: totalHome, away: totalAway };
    }
  }

  return {
    sourceId: SOURCE_ID,
    sourceEventId: String(game.I),
    sport,
    league,
    startTime,
    homeTeam,
    awayTeam,
    status: score ? 'live' : 'scheduled',
    stats: score ? { score } : {},
    markets,
    timestamp: Date.now(),
  };
}

// Map group + type to canonical market key
function mapMarketFromGroup(groupId: number, typeCode: number, threshold?: number): string | null {
  // Group 1 = 1X2 (Match Result)
  if (groupId === 1) {
    switch (typeCode) {
      case 1: return 'ml_home_ft';
      case 2: return 'draw_ft';
      case 3: return 'ml_away_ft';
    }
  }
  
  // Group 2 = Double Chance
  if (groupId === 2) {
    switch (typeCode) {
      case 1: return 'dc_1x_ft';
      case 2: return 'dc_12_ft';
      case 3: return 'dc_x2_ft';
    }
  }
  
  // Group 17 = Total (Over/Under)
  if (groupId === 17 && threshold !== undefined) {
    const t = String(threshold).replace('.', '_');
    switch (typeCode) {
      case 9: return `o_${t}_ft`;
      case 10: return `u_${t}_ft`;
    }
  }
  
  // Group 18 = Handicap
  if (groupId === 18 && threshold !== undefined) {
    const prefix = threshold < 0 ? 'm' : '';
    const t = String(Math.abs(threshold)).replace('.', '_');
    switch (typeCode) {
      case 7: return `handicap_home_${prefix}${t}_ft`;
      case 8: return `handicap_away_${prefix}${t}_ft`;
    }
  }
  
  // Group 19 = Both Teams to Score
  if (groupId === 19) {
    switch (typeCode) {
      case 1: return 'btts_yes_ft';
      case 2: return 'btts_no_ft';
    }
  }

  // Use the existing mapMarket for flat T-codes as fallback
  return mapMarket(typeCode, threshold, '');
}
