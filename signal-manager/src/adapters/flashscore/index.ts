import type { IAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { FlashScoreAdapterConfig } from '../../types/config.js';
import { scrapeLeague, closeBrowser } from './scraper.js';
import { normalizeMatch } from './normalizer.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('fs-adapter');

export class FlashScoreAdapter implements IAdapter {
  readonly sourceId = 'flashscore';
  private config: FlashScoreAdapterConfig;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private leagueIndex = 0;

  constructor(config: FlashScoreAdapterConfig) {
    this.config = config;
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.info('FlashScore adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';
    log.info(`FlashScore adapter starting with ${this.config.leagues.length} leagues`);

    // Initial scrape of all leagues
    await this.scrapeAllLeagues();
    this.status = 'connected';

    // Rotate through leagues on each poll interval
    this.pollTimer = setInterval(async () => {
      await this.scrapeNextLeague();
    }, this.config.pollIntervalMs);

    log.info('FlashScore adapter started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await closeBrowser();
    this.status = 'stopped';
    log.info('FlashScore adapter stopped');
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private async scrapeAllLeagues(): Promise<void> {
    for (const league of this.config.leagues) {
      try {
        const matches = await scrapeLeague(league.fsPath);
        log.info(`${league.name}: ${matches.length} matches`);
        this.emitMatches(matches, league.sport, league.name);
      } catch (err) {
        log.warn(`Failed to scrape ${league.name}`, err);
      }
    }
  }

  private async scrapeNextLeague(): Promise<void> {
    if (this.config.leagues.length === 0) return;
    
    const league = this.config.leagues[this.leagueIndex % this.config.leagues.length];
    this.leagueIndex++;

    try {
      const matches = await scrapeLeague(league.fsPath);
      this.emitMatches(matches, league.sport, league.name);
    } catch (err) {
      log.warn(`Poll failed for ${league.name}`, err);
    }
  }

  private emitMatches(matches: any[], sport: string, leagueName: string): void {
    if (!this.callback) return;
    for (const match of matches) {
      const update = normalizeMatch(match, sport, leagueName);
      this.callback(update);
    }
  }
}
