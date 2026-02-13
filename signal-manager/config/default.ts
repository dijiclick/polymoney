import type { Config } from '../src/types/config.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONFIG: Config = {
  adapters: {
    polymarket: {
      enabled: true,
      clobWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
      scoresWsUrl: 'wss://sports-api.polymarket.com/ws',
      gammaApiUrl: 'https://gamma-api.polymarket.com',
      pingIntervalMs: 10_000,
      discoveryIntervalMs: 5 * 60 * 1000,
    },
    onexbet: {
      enabled: true,
      liveFeedBaseUrl: 'https://1xlite-65169.pro',
      pollIntervalMs: 200,
      sportIds: [
        // Traditional sports
        1,   // Soccer
        2,   // Ice Hockey (NHL, KHL, SHL, AHL)
        3,   // Basketball (NBA, NCAAB, Euro)
        4,   // Tennis (ATP, WTA)
        12,  // Baseball (MLB, KBO)
        13,  // American Football (NFL, CFB)
        17,  // Cricket (IPL, T20, ODI)
        62,  // MMA/UFC
        // Esports
        40,  // Esports (main — pro tournaments: Dota2, CS2, LoL under this ID)
        85,  // EA Sports FC / FIFA
        86,  // Counter-Strike 2
        89,  // Esports Ice Hockey
        91,  // Esports Basketball
        94,  // Esports Tennis
        97,  // Dota 2
        106, // League of Legends
        109, // Rocket League
        125, // Call of Duty
        150, // StarCraft 2
        298, // Overwatch
      ],
    },
    bet365: {
      enabled: true,
      baseUrl: 'https://www.bet365.com',
      wsUrl: 'wss://premws-pt1.365lpodds.com/zap/',
      sportIds: [1, 13, 18, 17, 151],
      cookieRefreshMs: 30 * 60 * 1000,
    },
    flashscore: {
      enabled: false,
      pollIntervalMs: 15_000,
      leagues: [
        { sport: 'soccer', fsPath: 'football/england/premier-league', name: 'EPL' },
        { sport: 'soccer', fsPath: 'football/spain/laliga', name: 'La Liga' },
        { sport: 'soccer', fsPath: 'football/germany/bundesliga', name: 'Bundesliga' },
        { sport: 'soccer', fsPath: 'football/france/ligue-1', name: 'Ligue 1' },
        { sport: 'soccer', fsPath: 'football/italy/serie-a', name: 'Serie A' },
        { sport: 'soccer', fsPath: 'football/europe/champions-league', name: 'Champions League' },
        { sport: 'soccer', fsPath: 'football/europe/europa-league', name: 'Europa League' },
      ],
    },
  },
  dashboard: {
    enabled: true,
    port: 3847,
  },
  matcher: {
    fuzzyThreshold: 0.75,
    crossSourceThreshold: 0.88,
    kickoffToleranceMs: 30 * 60 * 1000,
    teamMappingsPath: resolve(__dirname, '..', '..', 'data', 'team-mappings.json'),
  },
  cleanupIntervalMs: 60_000,
  logLevel: 'warn',
};
