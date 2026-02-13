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
    log.info('Harvesting fresh bet365 session...');

    try {
      if (!this.browser) {
        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      }

      if (this.context) {
        await this.context.close().catch(() => {});
      }

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-GB',
      });

      const page = await this.context.newPage();

      // Intercept the sports-configuration response to get SST and SESSION_ID
      let sst = '';
      let sessionId = '';
      let zoneId = '1';
      let languageId = '1';

      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/defaultapi/sports-configuration') && response.status() === 200) {
            const text = await response.text();
            // Extract SST
            const sstMatch = text.match(/"SST":"([^"]+)"/);
            if (sstMatch) sst = sstMatch[1];
            // Extract SESSION_ID
            const sidMatch = text.match(/"SESSION_ID":"([^"]+)"/);
            if (sidMatch) sessionId = sidMatch[1];
            // Extract ZID (zone)
            const zidMatch = text.match(/"ZID":"(\d+)"/);
            if (zidMatch) zoneId = zidMatch[1];
            // Extract LANGUAGE_ID
            const lidMatch = text.match(/"LANGUAGE_ID":"(\d+)"/);
            if (lidMatch) languageId = lidMatch[1];
          }
        } catch {
          // ignore parse errors on responses
        }
      });

      // Navigate to bet365
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for Cloudflare challenge to resolve and sports-configuration to load
      await page.waitForTimeout(5_000);

      // Try to wait for the sports-configuration response
      if (!sessionId) {
        try {
          await page.waitForResponse(
            (r) => r.url().includes('/defaultapi/sports-configuration'),
            { timeout: 15_000 }
          );
        } catch {
          log.warn('sports-configuration response not intercepted, will try cookies anyway');
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

      if (!sessionId) {
        throw new Error('Failed to obtain SESSION_ID from bet365');
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

      log.info(`Session harvested: SID=${sessionId.slice(0, 12)}... SST=${sst ? sst.slice(0, 20) + '...' : 'N/A'} zone=${zoneId} cookies=${Object.keys(cookies).length}`);
      return this.currentSession;
    } catch (err: any) {
      log.error(`Cookie harvest failed: ${err.message}`);
      throw err;
    }
  }

  /** Start periodic refresh of session */
  startAutoRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(async () => {
      try {
        await this.harvest();
      } catch (err) {
        log.warn('Auto-refresh failed, will retry next interval', err);
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
    // Session older than 2x refresh interval is considered stale
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
