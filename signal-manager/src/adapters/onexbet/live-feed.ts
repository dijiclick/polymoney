import type { OnexbetAdapterConfig } from '../../types/config.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('1xbet-feed');

const HEADERS: Record<string, string> = {
  'Accept': '*/*',
  'DNT': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Raw 1xbet game data from GetGameZip (real structure)
export interface OnexbetGameData {
  I: number;
  Value?: {
    O1?: string;
    O2?: string;
    L?: string;
    S?: number;
    SC?: {
      FS?: { S1?: number; S2?: number };  // Full score
      PS?: Array<{ Key: string; Value: { S1: number; S2: number } }>;  // Period scores
    };
    GE?: Array<{       // Grouped events
      G: number;       // Group ID (1=1X2, etc.)
      GS?: number;
      E: Array<Array<{ // Nested arrays: E[marketIdx][0]
        C: number;     // Coefficient (decimal odds)
        CV?: number;
        G: number;     // Group
        GS?: number;
        T: number;     // Market type within group
        P?: number;    // Threshold
      }>>;
    }>;
    TI?: any;
  };
  // Flat fallback fields
  O1?: string;
  O2?: string;
  L?: string;
  S?: number;
}

export type GameDataCallback = (gameData: OnexbetGameData) => void;

export class OnexbetLiveFeed {
  private config: OnexbetAdapterConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onGameData: GameDataCallback | null = null;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 10;
  private prevOddsHash: Map<number, string> = new Map();

  constructor(config: OnexbetAdapterConfig) {
    this.config = config;
  }

  onData(callback: GameDataCallback): void {
    this.onGameData = callback;
  }

  startPolling(gameIds: number[]): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      await this.pollGames(gameIds);
    }, this.config.pollIntervalMs);

    this.pollGames(gameIds);
  }

  async updateGameList(gameIds: number[]): Promise<void> {
    for (const id of this.prevOddsHash.keys()) {
      if (!gameIds.includes(id)) {
        this.prevOddsHash.delete(id);
      }
    }
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  get isPolling(): boolean {
    return this.pollTimer !== null;
  }

  private async pollGames(gameIds: number[]): Promise<void> {
    for (const gameId of gameIds) {
      try {
        const gameData = await this.fetchGameDetail(gameId);
        if (!gameData) continue;

        const hash = this.computeOddsHash(gameData);
        const prevHash = this.prevOddsHash.get(gameId);
        if (hash === prevHash) continue;
        this.prevOddsHash.set(gameId, hash);

        if (this.onGameData) {
          this.onGameData(gameData);
        }

        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures <= this.maxConsecutiveFailures) {
          log.warn(`Poll failed for game ${gameId} (${this.consecutiveFailures}x)`, err);
        }
      }
    }
  }

  private async fetchGameDetail(gameId: number): Promise<OnexbetGameData | null> {
    const url = `${this.config.liveFeedBaseUrl}/service-api/LiveFeed/GetGameZip?id=${gameId}&lng=en&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=7&country=190&marketType=1`;

    const resp = await fetch(url, {
      headers: {
        ...HEADERS,
        'Referer': `${this.config.liveFeedBaseUrl}/en/live/`,
      },
    });

    if (!resp.ok) {
      if (resp.status === 404) return null;
      throw new Error(`GetGameZip ${gameId} failed: ${resp.status}`);
    }

    const data = await resp.json() as any;
    return data as OnexbetGameData;
  }

  private computeOddsHash(game: OnexbetGameData): string {
    const val = game.Value || game;
    const ge = (val as any).GE;
    if (!ge || !Array.isArray(ge)) return '';
    
    let hash = '';
    for (const group of ge) {
      if (!group.E) continue;
      for (const market of group.E) {
        if (!Array.isArray(market) || market.length === 0) continue;
        const m = market[0];
        hash += `${group.G}:${m.T}:${m.C};`;
      }
    }
    return hash;
  }
}
