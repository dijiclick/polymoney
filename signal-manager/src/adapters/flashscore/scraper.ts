import { createLogger } from '../../util/logger.js';

const log = createLogger('fs-scraper');

export interface FlashScoreMatch {
  id: string;
  home: string;
  away: string;
  scoreHome: string | null;
  scoreAway: string | null;
  time: string;
  isLive: boolean;
  isFinished: boolean;
}

let browserInstance: any = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;
  try {
    const pw = await import('playwright');
    browserInstance = await pw.chromium.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
    });
    return browserInstance;
  } catch (err) {
    log.error('Failed to launch browser', err);
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

export async function scrapeLeague(fsPath: string): Promise<FlashScoreMatch[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.goto(`https://www.flashscore.com/${fsPath}/`, { 
      timeout: 20000,
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(3000);
    
    const matches: FlashScoreMatch[] = await page.evaluate(() => {
      const rows = document.querySelectorAll('[id^="g_1_"]');
      return Array.from(rows).map(row => {
        const id = row.id.replace('g_1_', '');
        const homeEl = row.querySelector('.event__participant--home, [class*="participant--home"]');
        const awayEl = row.querySelector('.event__participant--away, [class*="participant--away"]');
        const scoreHEl = row.querySelector('.event__score--home, [class*="score--home"]');
        const scoreAEl = row.querySelector('.event__score--away, [class*="score--away"]');
        const timeEl = row.querySelector('.event__time, [class*="time"]');
        const stageEl = row.querySelector('.event__stage--block, [class*="stage"]');
        
        const scoreH = scoreHEl?.textContent?.trim() || null;
        const scoreA = scoreAEl?.textContent?.trim() || null;
        const time = timeEl?.textContent?.trim() || '';
        const stage = stageEl?.textContent?.trim() || '';
        
        const isLive = !!row.querySelector('[class*="stage--live"]') ||
                       /^\d/.test(stage) || stage.includes("'");
        const isFinished = stage === 'Finished' || stage === 'FT' || stage === 'AET' || stage === 'AP';
        
        return {
          id,
          home: homeEl?.textContent?.trim() || '',
          away: awayEl?.textContent?.trim() || '',
          scoreHome: scoreH,
          scoreAway: scoreA,
          time,
          isLive,
          isFinished,
        };
      });
    });
    
    await page.close();
    return matches.filter(m => m.home && m.away);
  } catch (err) {
    await page.close().catch(() => {});
    log.warn(`Failed to scrape ${fsPath}`, err);
    return [];
  }
}
