/**
 * bet365 Cookie Harvester — uses Playwright to obtain fresh session cookies and tokens.
 *
 * bet365 is behind Cloudflare WAF, so we need a real browser session to get:
 * - __cf_bm (Cloudflare bot management)
 * - pstk (platform state token = SESSION_ID)
 * - swt (session web token)
 * - SST token (from sports-configuration API response)
 * - SESSION_ID (from flashvars in sports-configuration)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createLogger } from '../../util/logger.js';

const log = createLogger('bet365-cookies');

export interface Bet365Session {
  cookies: Record<string, string>;
  sessionId: string;
  sst: string;
  zoneId: string;
  languageId: string;
  userAgent: string;
  timestamp: number;
}

// Stealth script injected into every page to evade Cloudflare
const STEALTH_SCRIPT = `
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // Fix plugins/mimeTypes
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en-US', 'en'] });
  // Fix chrome runtime
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  // Fix permissions
  const origQuery = window.navigator.permissions?.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  }
`;

// Match system Chrome UA on Windows
const WIN_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class Bet365CookieHarvester {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private currentSession: Bet365Session | null = null;
  private refreshIntervalMs: number;
  private baseUrl: string;

  constructor(baseUrl = 'https://www.bet365.com', refreshIntervalMs = 30 * 60 * 1000) {
    this.baseUrl = baseUrl;
    this.refreshIntervalMs = refreshIntervalMs;
  }

  async harvest(): Promise<Bet365Session> {
    log.warn('Harvesting fresh bet365 session...');

    try {
      if (!this.browser) {
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
      }

      if (this.context) {
        await this.context.close().catch(() => {});
      }

      this.context = await this.browser.newContext({
        userAgent: WIN_CHROME_UA,
        viewport: { width: 1920, height: 1080 },
        locale: 'en-GB',
        timezoneId: 'Europe/London',
      });

      const page = await this.context.newPage();

      // Inject stealth before any navigation
      await page.addInitScript(STEALTH_SCRIPT);

      // Intercept the sports-configuration response to get SST and SESSION_ID
      let sst = '';
      let sessionId = '';
      let zoneId = '1';
      let languageId = '1';
      let configReceived = false;

      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/defaultapi/sports-configuration') && response.status() === 200) {
            const text = await response.text();
            const sstMatch = text.match(/"SST":"([^"]+)"/);
            if (sstMatch) sst = sstMatch[1];
            const sidMatch = text.match(/"SESSION_ID":"([^"]+)"/);
            if (sidMatch) sessionId = sidMatch[1];
            const zidMatch = text.match(/"ZID":"(\d+)"/);
            if (zidMatch) zoneId = zidMatch[1];
            const lidMatch = text.match(/"LANGUAGE_ID":"(\d+)"/);
            if (lidMatch) languageId = lidMatch[1];
            configReceived = true;
            log.warn(`Intercepted sports-config: SID=${sessionId ? sessionId.slice(0, 8) + '...' : 'N/A'}, SST=${sst ? 'yes' : 'no'}`);
          }
        } catch {
          // ignore parse errors on responses
        }
      });

      // Navigate to bet365 — use in-play page to trigger sports-configuration
      log.warn('Navigating to bet365...');
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Check if we hit a Cloudflare challenge
      const cfCheck = await this._waitForCloudflare(page);
      if (!cfCheck) {
        log.warn('Cloudflare challenge may not have resolved. Continuing anyway...');
      }

      // If we haven't received sports-configuration yet, navigate to in-play
      if (!configReceived) {
        log.warn('Navigating to in-play section...');
        try {
          await page.goto(`${this.baseUrl}/#/IP/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await page.waitForTimeout(5_000);
        } catch {
          log.warn('In-play navigation timeout, continuing with what we have');
        }
      }

      // If still no config, try waiting for the response
      if (!configReceived) {
        try {
          await page.waitForResponse(
            (r) => r.url().includes('/defaultapi/sports-configuration'),
            { timeout: 15_000 }
          );
        } catch {
          log.warn('sports-configuration response not intercepted');
        }
      }

      // Extract cookies
      const browserCookies = await this.context.cookies();
      const cookies: Record<string, string> = {};
      for (const c of browserCookies) {
        cookies[c.name] = c.value;
      }

      // Fallback: get SESSION_ID from pstk cookie
      if (!sessionId && cookies['pstk']) {
        sessionId = cookies['pstk'];
      }

      // Log cookie details for debugging
      const cookieNames = Object.keys(cookies);
      const hasCfBm = cookieNames.includes('__cf_bm');
      const hasPstk = cookieNames.includes('pstk');
      log.warn(`Cookies: ${cookieNames.length} total | __cf_bm=${hasCfBm} | pstk=${hasPstk} | names=[${cookieNames.join(',')}]`);

      if (!sessionId) {
        // Try to extract from page JavaScript
        try {
          sessionId = await page.evaluate(() => {
            return (window as any).__bet365?.sessionId ||
                   (window as any).b365?.config?.sessionId ||
                   '';
          }) || '';
        } catch {}
      }

      if (!sessionId) {
        const pageUrl = page.url();
        const title = await page.title();
        log.error(`Failed to obtain SESSION_ID. URL: ${pageUrl}, Title: ${title}, Cookies: ${cookieNames.join(',')}`);
        throw new Error(`Failed to obtain SESSION_ID from bet365 (page: ${title})`);
      }

      const ua = await page.evaluate(() => navigator.userAgent);

      await page.close();

      this.currentSession = {
        cookies,
        sessionId,
        sst,
        zoneId,
        languageId,
        userAgent: ua,
        timestamp: Date.now(),
      };

      log.warn(`Session OK: SID=${sessionId.slice(0, 12)}... SST=${sst ? sst.slice(0, 20) + '...' : 'N/A'} zone=${zoneId} cookies=${cookieNames.length}`);
      return this.currentSession;
    } catch (err: any) {
      log.error(`Cookie harvest failed: ${err.message}`);
      throw err;
    }
  }

  /** Wait for Cloudflare challenge to resolve */
  private async _waitForCloudflare(page: Page): Promise<boolean> {
    // Wait initial 3s for page to settle
    await page.waitForTimeout(3_000);

    // Check if we're on a Cloudflare challenge page
    for (let attempt = 0; attempt < 6; attempt++) {
      const content = await page.content();
      const title = await page.title();

      // Cloudflare challenge indicators
      const isCfChallenge = content.includes('challenge-platform') ||
        content.includes('Just a moment') ||
        content.includes('cf-challenge') ||
        content.includes('Checking your browser') ||
        title.includes('Just a moment');

      if (!isCfChallenge) {
        log.warn(`Cloudflare bypassed (attempt ${attempt + 1})`);
        return true;
      }

      log.warn(`Cloudflare challenge detected (attempt ${attempt + 1}/6), waiting...`);
      await page.waitForTimeout(5_000);
    }

    return false;
  }

  /** Start periodic refresh of session */
  startAutoRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(async () => {
      try {
        await this.harvest();
      } catch (err) {
        log.warn('Auto-refresh failed, will retry next interval');
      }
    }, this.refreshIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getSession(): Bet365Session | null {
    return this.currentSession;
  }

  isSessionValid(): boolean {
    if (!this.currentSession) return false;
    return (Date.now() - this.currentSession.timestamp) < this.refreshIntervalMs * 2;
  }

  async close(): Promise<void> {
    this.stopAutoRefresh();
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
