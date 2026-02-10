import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Engine } from '../core/engine.js';
import type { DashboardConfig } from '../types/config.js';
import { getAlerts } from '../signals/index.js';
import { createLogger } from '../util/logger.js';
import { DASHBOARD_HTML } from './html.js';

const log = createLogger('dashboard');

export class Dashboard {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private engine: Engine;
  private config: DashboardConfig;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor(engine: Engine, config: DashboardConfig) {
    this.engine = engine;
    this.config = config;
  }

  async start(): Promise<void> {
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));
    
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => {
      log.debug('Dashboard client connected');
      // Send initial state
      ws.send(JSON.stringify(this.buildState()));
    });

    // Broadcast state every 2s
    this.broadcastTimer = setInterval(() => {
      this.broadcast();
    }, 2000);

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
      res.end(JSON.stringify({ status: 'ok', events: this.engine.eventCount, uptime: process.uptime() }));
      return;
    }

    if (req.url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.buildState()));
      return;
    }

    // Serve dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
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
      events: events.map(e => ({
        id: e.id,
        sport: e.sport,
        league: e.league,
        status: e.status,
        home: e.home.name || Object.values(e.home.aliases)[0] || '?',
        away: e.away.name || Object.values(e.away.aliases)[0] || '?',
        homeAliases: e.home.aliases,
        awayAliases: e.away.aliases,
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
      })),
      alerts: getAlerts().slice(0, 50),
    };
  }
}
