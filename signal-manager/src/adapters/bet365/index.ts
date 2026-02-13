import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { Bet365AdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import type { AdapterEventUpdate } from '../../types/adapter-update.js';
import { chromium, type Browser, type BrowserContext, type Page, type WebSocket as PwWebSocket } from 'playwright';
import { parseMessage, oddsToProb, type Bet365Event } from './parser.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('bet365-adapter');

// Stealth script to evade Cloudflare
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
`;

const WIN_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Map bet365 sport classification IDs to our normalized sport names */
const SPORT_MAP: Record<string, string> = {
  '1': 'soccer',
  '13': 'tennis',
  '18': 'basketball',
  '17': 'ice-hockey',
  '151': 'esports',
  '3': 'cricket',
  '12': 'american-football',
  '16': 'baseball',
  '92': 'table-tennis',
  '91': 'volleyball',
  '78': 'handball',
  '9': 'boxing',
  '15': 'darts',
};

export class Bet365Adapter implements IFilterableAdapter {
  readonly sourceId = 'bet365';
  private config: Bet365AdapterConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private targetFilter: TargetEventFilter;
  private eventCache: Map<string, Bet365Event> = new Map();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private wsMessageCount = 0;
  private wsSentCount = 0;
  private activeWsCount = 0;
  private wsConnected = false;

  constructor(config: Bet365AdapterConfig) {
    this.config = config;
    this.targetFilter = new TargetEventFilter(0.75);
  }

  onUpdate(callback: UpdateCallback): void {
    this.callback = callback;
  }

  setTargetFilter(targets: TargetEvent[]): void {
    this.targetFilter.setTargets(targets);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      log.warn('bet365 adapter disabled');
      this.status = 'stopped';
      return;
    }

    this.status = 'connecting';
    log.warn('Starting bet365 adapter (browser-intercept mode)...');

    try {
      await this._launchAndConnect();
    } catch (err: any) {
      log.error(`Failed to start bet365 adapter: ${err.message}`);
      this.status = 'error';

      // Retry after 30s
      this.refreshTimer = setInterval(async () => {
        try {
          await this._cleanup();
          await this._launchAndConnect();
          if (this.refreshTimer && this.wsConnected) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
          }
        } catch {
          log.warn('bet365 retry failed, will try again');
        }
      }, 30_000);
    }
  }

  private async _launchAndConnect(): Promise<void> {
    // 1. Launch browser
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: WIN_CHROME_UA,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });

    this.page = await this.context.newPage();
    await this.page.addInitScript(STEALTH_SCRIPT);

    // 2. Listen for WebSocket connections from the page
    this.page.on('websocket', (ws: PwWebSocket) => {
      const url = ws.url();
      log.warn(`Page WS opened: ${url}`);

      // Only intercept bet365 data WS (365lpodds.com)
      if (!url.includes('365lpodds.com')) return;

      this.activeWsCount++;
      this.wsConnected = true;
      this.status = 'connected';
      log.warn(`bet365 WS intercepted (#${this.activeWsCount})`);

      ws.on('framesent', (frame) => {
        this.wsSentCount++;
        const payload = typeof frame.payload === 'string'
          ? frame.payload
          : Buffer.isBuffer(frame.payload)
            ? (frame.payload as Buffer).toString('utf-8')
            : '';
        if (this.wsSentCount <= 10) {
          const safe = payload.replace(/[\x00-\x1f]/g, '.').slice(0, 120);
          log.warn(`bet365 SENT #${this.wsSentCount}: len=${payload.length} ${safe}`);
        }
      });

      ws.on('framereceived', (frame) => {
        const payload = typeof frame.payload === 'string'
          ? frame.payload
          : Buffer.isBuffer(frame.payload)
            ? (frame.payload as Buffer).toString('utf-8')
            : null;
        if (payload) {
          this._handleWsData(payload);
        }
      });

      ws.on('close', () => {
        this.activeWsCount = Math.max(0, this.activeWsCount - 1);
        log.warn(`bet365 WS closed (${this.activeWsCount} remaining)`);
        if (this.activeWsCount === 0) {
          this.wsConnected = false;
          this.status = 'reconnecting';
        }
      });
    });

    // 3. Navigate to bet365 in-play
    log.warn('Navigating to bet365...');
    await this.page.goto('https://www.bet365.com/#/IP/', {
      waitUntil: 'load',
      timeout: 45_000,
    });

    // Wait for Cloudflare
    await this._waitForCloudflare();

    // Accept cookie consent banner (required for full data flow)
    await this._acceptCookies();

    // Wait for bet365 SPA to initialize (look for key DOM elements)
    log.warn('Waiting for SPA to initialize...');
    try {
      await this.page.waitForSelector('.ovm-FixtureDetailsTwoWay, .ovm-Fixture, .ipo-Competition, .ip-ControlBar, .wn-WebNavModuleContainer', {
        timeout: 15_000,
      });
      log.warn('SPA elements detected');
    } catch {
      log.warn('SPA elements not found, continuing anyway...');
    }

    // Give the SPA a moment to set up WS subscriptions
    await this.page.waitForTimeout(5_000);
    log.warn(`After SPA init: ${this.wsMessageCount} recv, ${this.wsSentCount} sent`);

    // If no data yet, try clicking individual sports in the In-Play sidebar
    if (this.wsMessageCount < 20) {
      log.warn('Few frames — trying sport-specific in-play pages...');

      // Navigate to in-play soccer specifically
      try {
        await this.page.goto('https://www.bet365.com/#/IP/B1/', {
          waitUntil: 'load',
          timeout: 20_000,
        });
        await this.page.waitForTimeout(5_000);
        log.warn(`After soccer in-play: ${this.wsMessageCount} recv, ${this.wsSentCount} sent`);
      } catch {
        log.warn('Soccer in-play navigation failed');
      }
    }

    // Still no data? Try clicking visible event links in the page
    if (this.wsMessageCount < 20) {
      log.warn('Still few frames — clicking on first visible event...');
      try {
        // Try clicking a fixture link to trigger market subscription
        const fixture = await this.page.$('.ovm-FixtureDetailsTwoWay, .ovm-Fixture, .ipo-EventRow');
        if (fixture) {
          await fixture.click();
          log.warn('Clicked a fixture');
          await this.page.waitForTimeout(5_000);
        }
      } catch {}
    }

    // Debug: dump page title and URL
    try {
      const title = await this.page.title();
      const url = this.page.url();
      log.warn(`Page state: title="${title}" url=${url}`);
    } catch {}

    log.warn(`bet365 adapter ready: ${this.wsMessageCount} recv, ${this.wsSentCount} sent, connected=${this.wsConnected}`);

    // Periodic page refresh to keep session alive (every 20min)
    this.refreshTimer = setInterval(async () => {
      if (!this.page) return;
      try {
        log.warn('Refreshing bet365 page...');
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this._waitForCloudflare();
        await this._acceptCookies();
        const btn = await this.page.$('text=In-Play');
        if (btn) await btn.click();
        await this.page.waitForTimeout(5_000);
      } catch (err: any) {
        log.warn(`Page refresh failed: ${err.message}`);
      }
    }, 20 * 60_000);
  }

  private async _acceptCookies(): Promise<void> {
    if (!this.page) return;
    try {
      // Try multiple selectors for the cookie consent banner
      const selectors = [
        'button:has-text("Accept All")',
        'text=Accept All',
        'button:has-text("Accept")',
        '#onetrust-accept-btn-handler',
        '.cc-accept-all',
      ];
      for (const sel of selectors) {
        const btn = await this.page.$(sel);
        if (btn) {
          await btn.click();
          log.warn(`Cookie consent accepted via: ${sel}`);
          await this.page.waitForTimeout(1_000);
          return;
        }
      }
      log.warn('No cookie consent banner found (may already be accepted)');
    } catch (err: any) {
      log.warn(`Cookie accept failed: ${err.message}`);
    }
  }

  private async _waitForCloudflare(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForTimeout(3_000);

    for (let i = 0; i < 6; i++) {
      const content = await this.page.content();
      const title = await this.page.title();
      const isCf = content.includes('challenge-platform') ||
        content.includes('Just a moment') ||
        content.includes('cf-challenge') ||
        title.includes('Just a moment');

      if (!isCf) {
        log.warn(`Cloudflare bypassed (attempt ${i + 1})`);
        return;
      }
      log.warn(`Cloudflare challenge (attempt ${i + 1}/6), waiting 5s...`);
      await this.page.waitForTimeout(5_000);
    }
    log.warn('Cloudflare may not have resolved');
  }

  private _handleWsData(data: string): void {
    if (!this.callback) return;
    this.wsMessageCount++;

    // Log first messages and periodic updates for debugging
    if (this.wsMessageCount <= 20) {
      log.warn(`bet365 frame #${this.wsMessageCount}: len=${data.length} prefix=${data.slice(0, 100).replace(/[\x00-\x1f]/g, '.')}`);
    } else if (this.wsMessageCount % 50 === 0) {
      log.warn(`bet365 frames: ${this.wsMessageCount} total`);
    }

    // Skip control/heartbeat messages
    if (data.length < 10 || data.startsWith('100') || data.startsWith('101')) return;

    try {
      const parsed = parseMessage(data);
      if (parsed.events.length === 0) return;

      for (const ev of parsed.events) {
        // Filter by configured sport IDs
        if (this.config.sportIds.length > 0) {
          const sportNum = parseInt(ev.sportId);
          if (!isNaN(sportNum) && !this.config.sportIds.includes(sportNum)) continue;
        }

        if (!ev.homeTeam || !ev.awayTeam) continue;

        // Apply target filter if set
        if (this.targetFilter.targetCount > 0) {
          const result = this.targetFilter.check(ev.homeTeam, ev.awayTeam);
          if (!result.matched) continue;
        }

        this.eventCache.set(ev.id, ev);

        const update = this._normalizeEvent(ev);
        if (update && update.markets.length > 0) {
          log.warn(`bet365 event: ${update.homeTeam} vs ${update.awayTeam} | ${update.markets.length} markets`);
          this.callback(update);
        }
      }
    } catch (err) {
      // Silently skip unparseable messages
    }
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    await this._cleanup();
    this.status = 'stopped';
    log.warn('bet365 adapter stopped');
  }

  private async _cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.wsConnected = false;
  }

  getStatus(): AdapterStatus {
    return this.status;
  }

  private _normalizeEvent(ev: Bet365Event): AdapterEventUpdate | null {
    const sport = SPORT_MAP[ev.sportId] || `sport-${ev.sportId}`;

    const markets: AdapterEventUpdate['markets'] = [];

    for (const market of ev.markets) {
      const mName = market.name.toLowerCase();

      // Match Result / 1X2
      if (mName.includes('match result') || mName.includes('full time result') ||
          mName.includes('match winner') || mName === '1x2' || mName === 'match odds') {
        for (const sel of market.selections) {
          const selName = sel.name.toLowerCase();
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;

          if (selName === ev.homeTeam.toLowerCase() || sel.order === 1 || selName === '1' || selName === 'home') {
            markets.push({ key: 'ml_home_ft', value: prob });
          } else if (selName === ev.awayTeam.toLowerCase() || sel.order === 3 || selName === '2' || selName === 'away') {
            markets.push({ key: 'ml_away_ft', value: prob });
          } else if (selName === 'draw' || selName === 'x' || sel.order === 2) {
            markets.push({ key: 'draw_ft', value: prob });
          }
        }
      }

      // Moneyline (basketball, hockey, tennis — no draw)
      if (mName.includes('money line') || mName.includes('moneyline') || mName.includes('to win')) {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          if (sel.order === 1 || sel.name === ev.homeTeam) {
            markets.push({ key: 'ml_home_ft', value: prob });
          } else if (sel.order === 2 || sel.name === ev.awayTeam) {
            markets.push({ key: 'ml_away_ft', value: prob });
          }
        }
      }

      // Over/Under totals — normalize to o_X_X_ft / u_X_X_ft format
      if (mName.includes('over/under') || mName.includes('total goals') || mName.includes('total points')) {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          const selName = sel.name.toLowerCase();
          const lineMatch = selName.match(/(over|under)\s+([\d.]+)/);
          if (lineMatch) {
            const prefix = lineMatch[1] === 'over' ? 'o' : 'u';
            const line = lineMatch[2].replace('.', '_'); // 2.5 → 2_5
            markets.push({ key: `${prefix}_${line}_ft`, value: prob });
          }
        }
      }

      // Both Teams to Score
      if (mName.includes('both teams to score') || mName === 'btts') {
        for (const sel of market.selections) {
          const prob = oddsToProb(sel.odds);
          if (prob <= 0) continue;
          if (sel.name.toLowerCase() === 'yes') {
            markets.push({ key: 'btts_yes_ft', value: prob });
          } else if (sel.name.toLowerCase() === 'no') {
            markets.push({ key: 'btts_no_ft', value: prob });
          }
        }
      }
    }

    return {
      sourceId: this.sourceId,
      sourceEventId: ev.id,
      sport,
      league: ev.league || 'Unknown',
      startTime: ev.startTime || 0,
      homeTeam: ev.homeTeam,
      awayTeam: ev.awayTeam,
      status: ev.isLive ? 'live' : 'scheduled',
      stats: {
        score: ev.score,
        elapsed: ev.elapsed,
        period: ev.period,
      },
      markets,
      timestamp: Date.now(),
    };
  }
}
