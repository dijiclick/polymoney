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
      discoveryIntervalMs: 5 * 60 * 1000, // 5 min
    },
    onexbet: {
      enabled: false, // Enable when running from a network that can reach 1xbet
      liveFeedBaseUrl: 'https://1xbet.com', // Change to regional mirror if needed (e.g. 1xbet.cr)
      pollIntervalMs: 2_000,
      sportIds: [1], // Soccer first
    },
  },
  matcher: {
    fuzzyThreshold: 0.85,
    kickoffToleranceMs: 30 * 60 * 1000,
    // __dirname is dist/config/ at runtime, so go up 2 levels to project root
    teamMappingsPath: resolve(__dirname, '..', '..', 'data', 'team-mappings.json'),
  },
  cleanupIntervalMs: 60_000,
  logLevel: 'info',
};
