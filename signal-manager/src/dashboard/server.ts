import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Engine } from '../core/engine.js';
import type { DashboardConfig } from '../types/config.js';
import { getAlerts } from '../signals/index.js';
import { getTradeSignals, getClosedOpportunities } from '../signals/trading.js';
import { getReactionLog } from '../signals/reaction-timer.js';
import { TradingController } from '../trading/controller.js';
import { createLogger } from '../util/logger.js';
import { DASHBOARD_HTML } from './html.js';

const log = createLogger('dashboard');

export class Dashboard {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private engine: Engine;
  private config: DashboardConfig;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private tradingController: TradingController | null = null;

  constructor(engine: Engine, config: DashboardConfig) {
    this.engine = engine;
    this.config = config;
  }

  setTradingController(tc: TradingController): void {
    this.tradingController = tc;
  }

  async start(): Promise<void> {
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));
    
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => {
      log.debug('Dashboard client connected');
      ws.send(JSON.stringify(this.buildState()));
    });

    // Broadcast every 1s for near-real-time
    this.broadcastTimer = setInterval(() => {
      this.broadcast();
    }, 1000);

    return new Promise((resolve) => {
      this.httpServer!.listen(this.config.port, '0.0.0.0', () => {
        log.info(`Dashboard running at http://0.0.0.0:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        events: this.engine.eventCount,
        uptime: process.uptime(),
        signals: getTradeSignals().length,
      }));
      return;
    }

    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.buildState()));
      return;
    }

    if (req.url === '/api/signals') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getTradeSignals()));
      return;
    }

    if (req.url === '/api/reactions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getReactionLog()));
      return;
    }

    if (req.url === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.buildStats()));
      return;
    }

    if (req.url === '/api/trading') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.tradingController?.getState() || { initialized: false }));
      return;
    }

    // POST /api/trading/command — execute trading commands
    if (req.url === '/api/trading/command' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { command } = JSON.parse(body);
          if (!this.tradingController) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Trading not configured' }));
            return;
          }
          const result = await this.tradingController.handleCommand(command);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // GET /logs/goal-timing — download goal-timing.log
    if (req.url === '/logs/goal-timing') {
      return this.serveLogFile(res, 'goal-timing.log');
    }
    // GET /logs/reaction-times — download reaction-times.jsonl
    if (req.url === '/logs/reaction-times') {
      return this.serveLogFile(res, 'reaction-times.jsonl');
    }
    // GET /logs/opportunities — download opportunities.jsonl
    if (req.url === '/logs/opportunities') {
      return this.serveLogFile(res, 'opportunities.jsonl');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
  }

  private serveLogFile(res: ServerResponse, filename: string): void {
    const filePath = join(process.cwd(), 'data', filename);
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`${filename} not found`);
      return;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      const ext = filename.endsWith('.jsonl') ? 'application/x-ndjson' : 'text/plain';
      res.writeHead(200, {
        'Content-Type': `${ext}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.end(content);
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error reading ${filename}: ${err.message}`);
    }
  }

  private broadcast(): void {
    if (!this.wss || this.wss.clients.size === 0) return;
    const data = JSON.stringify(this.buildState());
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private buildStats() {
    const reactions = getReactionLog();
    const closed = getClosedOpportunities();
    const active = getTradeSignals();

    // Reaction stats
    const pmReactions: number[] = [];
    const xbReactions: number[] = [];
    for (const r of reactions) {
      for (const t of r.trajectories) {
        if (t.firstReactionMs > 0) {
          if (t.source === 'polymarket') pmReactions.push(t.firstReactionMs);
          else if (t.source === 'onexbet') xbReactions.push(t.firstReactionMs);
        }
      }
    }
    const avg = (arr: number[]) => arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    // Opportunity stats — by market type
    const marketBreakdown: Record<string, { count: number; avgPeakEdge: number; avgDurationMs: number }> = {};
    for (const opp of closed) {
      const mkt = opp.market;
      if (!marketBreakdown[mkt]) marketBreakdown[mkt] = { count: 0, avgPeakEdge: 0, avgDurationMs: 0 };
      const b = marketBreakdown[mkt];
      b.avgPeakEdge = (b.avgPeakEdge * b.count + opp.peakEdge) / (b.count + 1);
      const duration = opp.lastUpdated - opp.firstSeen;
      b.avgDurationMs = (b.avgDurationMs * b.count + duration) / (b.count + 1);
      b.count++;
    }

    return {
      uptime: process.uptime(),
      reactions: {
        goalsTracked: reactions.length,
        pm: { count: pmReactions.length, avgMs: avg(pmReactions), medianMs: median(pmReactions) },
        xbet: { count: xbReactions.length, avgMs: avg(xbReactions), medianMs: median(xbReactions) },
      },
      opportunities: {
        active: active.length,
        closed: closed.length,
        byMarket: marketBreakdown,
      },
    };
  }

  private buildState() {
    const events = this.engine.getAllEvents();
    const adapters: Record<string, string> = {};
    for (const [id, status] of this.engine.getAdapterStatuses()) {
      adapters[id] = status;
    }

    return {
      timestamp: Date.now(),
      eventCount: events.length,
      adapters,
      events: events.map(e => {
        // Collect unique sources across ALL markets
        const sourceSet = new Set<string>();
        for (const sources of Object.values(e.markets)) {
          for (const src of Object.keys(sources)) {
            sourceSet.add(src);
          }
        }

        // Prefer Polymarket name → then any alias → then '?'
        const homeName = e.home.aliases['polymarket'] || e.home.name || Object.values(e.home.aliases)[0] || '?';
        const awayName = e.away.aliases['polymarket'] || e.away.name || Object.values(e.away.aliases)[0] || '?';

        return {
          id: e.id,
          sport: e.sport,
          league: e.league,
          status: e.status,
          home: homeName,
          away: awayName,
          homeAliases: e.home.aliases,
          awayAliases: e.away.aliases,
          sources: Array.from(sourceSet),
          pmSlug: e.polymarketSlug || null,
          startTime: e.startTime || 0,
          score: e.stats.score || null,
          elapsed: e.stats.elapsed || null,
          period: e.stats.period || null,
          markets: Object.fromEntries(
            Object.entries(e.markets).map(([key, sources]) => [
              key,
              Object.fromEntries(
                Object.entries(sources).map(([src, odds]) => [
                  src,
                  { value: odds.value, ts: odds.timestamp }
                ])
              )
            ])
          ),
          lastUpdate: e._lastUpdate,
        };
      }),
      alerts: getAlerts().slice(0, 50),
      tradeSignals: getTradeSignals().slice(0, 100),
      trading: this.tradingController?.getState() || null,
      reactionLog: getReactionLog().slice(0, 50),
    };
  }
}
