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
      liveFeedBaseUrl: 'https://1xlite-81284.pro',
      pollIntervalMs: 5_000,
      sportIds: [1], // Soccer
    },
    flashscore: {
      enabled: true,
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
    kickoffToleranceMs: 30 * 60 * 1000,
    teamMappingsPath: resolve(__dirname, '..', '..', 'data', 'team-mappings.json'),
  },
  cleanupIntervalMs: 60_000,
  logLevel: 'info',
};
