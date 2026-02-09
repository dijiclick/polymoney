import type { OnexbetAdapterConfig } from '../../types/config.js';
import { sportIdToSlug } from './market-map.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('1xbet-discovery');

const HEADERS: Record<string, string> = {
  'Accept': '*/*',
  'DNT': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

export interface OnexbetGameSummary {
  I: number;    // Game ID
  O1: string;   // Home team
  O2: string;   // Away team
  L: string;    // League
  CN?: string;  // Country name
  S: number;    // Sport ID
  T: number;    // Start time (unix seconds)
}

export class OnexbetDiscovery {
  private config: OnexbetAdapterConfig;
  private trackedGames: Map<number, OnexbetGameSummary> = new Map();

  constructor(config: OnexbetAdapterConfig) {
    this.config = config;
  }

  async discoverLiveEvents(): Promise<OnexbetGameSummary[]> {
    const allGames: OnexbetGameSummary[] = [];

    for (const sportId of this.config.sportIds) {
      try {
        const games = await this.fetchLiveGames(sportId);
        allGames.push(...games);
      } catch (err) {
        log.warn(`Failed to discover sport ${sportId}`, err);
      }
    }

    // Update tracked games
    for (const game of allGames) {
      this.trackedGames.set(game.I, game);
    }

    return allGames;
  }

  private async fetchLiveGames(sportId: number): Promise<OnexbetGameSummary[]> {
    const url = `${this.config.liveFeedBaseUrl}/LiveFeed/Get1x2_VZip?sports=${sportId}&count=500&lng=en&mode=4&getEmpty=false`;

    const resp = await fetch(url, {
      headers: {
        ...HEADERS,
        'Referer': `${this.config.liveFeedBaseUrl}/en/live/${sportIdToSlug(sportId)}/`,
      },
    });

    if (!resp.ok) {
      throw new Error(`GET Get1x2_VZip sport=${sportId} failed: ${resp.status}`);
    }

    const data = await resp.json() as any;
    const games: OnexbetGameSummary[] = [];

    // Response is { Value: [...] }
    const items = data.Value || data || [];
    for (const item of (Array.isArray(items) ? items : [])) {
      if (item.I && item.O1 && item.O2) {
        games.push({
          I: item.I,
          O1: item.O1,
          O2: item.O2,
          L: item.L || '',
          CN: item.CN,
          S: sportId,
          T: item.T || 0,
        });
      }
    }

    log.debug(`Sport ${sportId}: found ${games.length} live games`);
    return games;
  }

  getTrackedGame(gameId: number): OnexbetGameSummary | undefined {
    return this.trackedGames.get(gameId);
  }

  get trackedCount(): number {
    return this.trackedGames.size;
  }
}
