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

// Raw 1xbet game data from GetGameZip
export interface OnexbetGameData {
  I: number;           // Game ID
  O1: string;          // Home team
  O2: string;          // Away team
  L: string;           // League
  SC?: {               // Score container
    PS?: Array<{       // Period scores
      S1: number;
      S2: number;
    }>;
  };
  E?: Array<{          // Events (markets)
    T: number;         // Market type code
    C: number;         // Coefficient (decimal odds)
    P?: number;        // Point/threshold (e.g. 2.5 for over/under)
    G?: string;        // Group label (period/timespan info)
  }>;
  TI?: any;            // Timer info
  S?: number;          // Sport ID
}

export type GameDataCallback = (gameData: OnexbetGameData) => void;

export class OnexbetLiveFeed {
  private config: OnexbetAdapterConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onGameData: GameDataCallback | null = null;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 5;
  // Diff detection: store previous odds hash per game
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

    // Immediate first poll
    this.pollGames(gameIds);
  }

  async updateGameList(gameIds: number[]): Promise<void> {
    // Clean up hash cache for games no longer tracked
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

        // Diff detection: only emit if odds changed
        const hash = this.computeOddsHash(gameData);
        const prevHash = this.prevOddsHash.get(gameId);
        if (hash === prevHash) continue; // No change
        this.prevOddsHash.set(gameId, hash);

        if (this.onGameData) {
          this.onGameData(gameData);
        }

        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures <= this.maxConsecutiveFailures) {
          log.warn(`Poll failed for game ${gameId} (${this.consecutiveFailures} consecutive)`, err);
        }
      }
    }
  }

  private async fetchGameDetail(gameId: number): Promise<OnexbetGameData | null> {
    const url = `${this.config.liveFeedBaseUrl}/LiveFeed/GetGameZip?id=${gameId}&isSubGames=true&GroupEvents=true&countevents=250&lng=en`;

    const resp = await fetch(url, {
      headers: {
        ...HEADERS,
        'Referer': `${this.config.liveFeedBaseUrl}/en/live/`,
      },
    });

    if (!resp.ok) {
      if (resp.status === 404) return null; // Game ended
      throw new Error(`GetGameZip ${gameId} failed: ${resp.status}`);
    }

    const data = await resp.json() as any;
    // Response may be the game object directly or wrapped in Value
    return (data.Value || data) as OnexbetGameData;
  }

  // Fast hash of odds values for diff detection
  // Uses FNV-1a-like approach: just concatenate T:C pairs
  private computeOddsHash(game: OnexbetGameData): string {
    if (!game.E || game.E.length === 0) return '';
    let hash = '';
    for (let i = 0; i < game.E.length; i++) {
      const e = game.E[i];
      hash += `${e.T}:${e.C};`;
    }
    return hash;
  }
}
