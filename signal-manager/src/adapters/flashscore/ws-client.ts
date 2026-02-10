/**
 * FlashScore WebSocket Client — Sub-second live push updates
 * Protocol reverse-engineered from browser WS captures
 */

import WebSocket from 'ws';
import { createLogger } from '../../util/logger.js';

const log = createLogger('fs-ws');

const WS_SERVERS = [
  'wss://p1tt2.fsdatacentre.com/WebSocketConnection-Secure',
  'wss://p3tt2.fsdatacentre.com/WebSocketConnection-Secure',
  'wss://p4tt2.fsdatacentre.com/WebSocketConnection-Secure',
  'wss://p7tt2.fsdatacentre.com/WebSocketConnection-Secure',
  'wss://p9tt2.fsdatacentre.com/WebSocketConnection-Secure',
];

const SEP = '\x1e';
const TERM = '\x7f';

export interface FSLiveUpdate {
  matchId: string;
  home?: string;
  away?: string;
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  statusCode?: string;
  league?: string;
  country?: string;
  startTime?: number;
  isGoal?: boolean;
  isRedCard?: boolean;
  rawFields: Record<string, string>;
}

export type OnUpdateFn = (updates: FSLiveUpdate[]) => void;
export type OnConnectFn = (connected: boolean) => void;

export class FlashScoreWS {
  private ws: WebSocket | null = null;
  private serverIdx = 0;
  private onUpdateFn: OnUpdateFn | null = null;
  private onConnectFn: OnConnectFn | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private alive = false;
  private stopping = false;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private serverChallenge = '';  // Server's challenge bytes to echo in subscribe

  onUpdate(fn: OnUpdateFn): void { this.onUpdateFn = fn; }
  onConnect(fn: OnConnectFn): void { this.onConnectFn = fn; }

  connect(): void {
    this.stopping = false;
    this.doConnect();
  }

  disconnect(): void {
    this.stopping = true;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.alive;
  }

  private doConnect(): void {
    if (this.stopping) return;
    this.cleanup();

    const url = WS_SERVERS[this.serverIdx % WS_SERVERS.length];
    log.info(`Connecting to FlashScore WS: ${url}`);

    this.ws = new WebSocket(url, {
      headers: {
        'Origin': 'https://www.flashscore.com',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    this.ws.on('open', () => {
      log.info('FlashScore WS connected, sending handshake');
      // Handshake: \x01\x01 + SEP + \x05\x08 + SEP + "#PushClient..." + SEP + "$\x01" + SEP + "-\x02" + SEP + \x7f
      const hs = '\x01\x01' + SEP + '\x05\x08' + SEP +
        '#PushClient WebSocket Client v5.1.3' + SEP +
        '$\x01' + SEP + '-\x02' + SEP + TERM;
      this.ws!.send(hs);
    });

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const str = typeof data === 'string' ? data : data.toString('utf8');
        this.handleMessage(str);
      } catch (err: any) {
        log.warn(`WS message parse error: ${err.message}`);
      }
    });

    this.ws.on('error', (err: Error) => {
      log.warn(`FlashScore WS error: ${err.message}`);
    });

    this.ws.on('close', (code: number) => {
      log.info(`FlashScore WS closed (code ${code})`);
      this.alive = false;
      this.onConnectFn?.(false);
      this.scheduleReconnect();
    });
  }

  private handleMessage(str: string): void {
    // Remove leading 0x7f terminators (message boundary markers)
    let msg = str;
    while (msg.startsWith(TERM)) msg = msg.substring(1);
    if (!msg) return;

    const firstByte = msg.charCodeAt(0);

    // Handshake response: starts with \x01\x06
    // Contains server challenge bytes that we must echo in subscribe
    if (firstByte === 0x01 && msg.charCodeAt(1) === 0x06) {
      // Extract challenge: bytes between first two SEPs after \x01\x06
      // Format: \x01\x06 + challenge_bytes + SEP + ...
      const afterType = msg.substring(2);  // skip \x01\x06
      const sepIdx = afterType.indexOf(SEP);
      if (sepIdx > 0) {
        this.serverChallenge = afterType.substring(0, sepIdx);
      }
      
      log.info('Handshake accepted, subscribing to live football');
      this.subscribeAll();
      this.alive = true;
      this.reconnectDelay = 1000;
      this.onConnectFn?.(true);
      this.startPing();
      return;
    }

    // Data messages: \x03\x01 + channel + SEP + payload
    if (firstByte === 0x03 && msg.charCodeAt(1) === 0x01) {
      this.parseDataMessage(msg);
      return;
    }

    // Ping: \x09
    if (firstByte === 0x09) {
      this.ws?.send('\x0a' + TERM);
      return;
    }
  }

  private subscribeAll(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const channels = ['/fs/fs3_sys_1', '/fs/fs3_service', '/fs/fs3_u_1_1'];
    
    // Build subscribe message: for each channel:
    // \x01\x01 + channel + SEP + \x05\x08 + SEP + challenge + SEP + "(<" + SEP + "-\x02" + SEP + TERM
    // All concatenated into one message
    let sub = '';
    for (const ch of channels) {
      sub += '\x01\x01' + ch + SEP + '\x05\x08' + SEP +
        '\x06' + this.serverChallenge + SEP +
        '(<' + SEP + '-\x02' + SEP + TERM;
    }
    // End with \x01\x01 (trailing marker seen in capture)
    sub += '\x01\x01';
    
    this.ws.send(sub);
    log.info(`Subscribed to ${channels.length} channels`);
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('\x09' + TERM);
      }
    }, 25000);
  }

  private parseDataMessage(msg: string): void {
    // Format: \x03\x01 + channel + SEP + \x02 + payload + SEP + ...
    const parts = msg.split(SEP);
    if (parts.length < 2) return;

    // Channel is in parts[0] after \x03\x01
    const channel = parts[0].substring(2);
    
    // Find the payload part (starts with \x02)
    let payload = '';
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('\x02')) {
        payload = parts[i].substring(1);
        break;
      }
    }

    if (!payload) return;

    // Only process football data channel
    if (!channel.includes('fs3_u_1_1')) return;

    const updates = this.parseFlashScoreData(payload);
    if (updates.length > 0) {
      this.onUpdateFn?.(updates);
    }
  }

  private parseFlashScoreData(raw: string): FSLiveUpdate[] {
    const updates: FSLiveUpdate[] = [];
    // Data uses ÷ (UTF-8: c3 b7) as key-value separator and ¬ (c2 ac) as field separator
    // ~ separates match records
    const sections = raw.split('~');

    let currentLeague = '';
    let currentCountry = '';

    for (const section of sections) {
      if (!section) continue;
      const fields = this.parseFields(section);

      if (fields.ZA) currentCountry = fields.ZA;
      if (fields.ZEE) currentLeague = fields.ZEE || fields.ZC || '';

      if (fields.AA) {
        const update: FSLiveUpdate = {
          matchId: fields.AA,
          rawFields: fields,
        };

        if (fields.AE) update.home = fields.AE;
        if (fields.AF) update.away = fields.AF;
        if (fields.AG !== undefined) update.homeScore = parseInt(fields.AG) || 0;
        if (fields.AH !== undefined) update.awayScore = parseInt(fields.AH) || 0;
        if (fields.AC) update.minute = fields.AC;
        if (fields.AB) update.statusCode = fields.AB;
        if (fields.AD) update.startTime = parseInt(fields.AD);
        if (fields.AR) update.startTime = parseInt(fields.AR);
        if (currentLeague) update.league = currentLeague;
        if (currentCountry) update.country = currentCountry;

        // Score change markers
        if (fields.SCA !== undefined || fields.SCB !== undefined) update.isGoal = true;
        // Goal/red card indicators
        if (fields.AT) update.isGoal = true;  // AT = goal scored team
        if (fields.BA !== undefined) update.isRedCard = parseInt(fields.BA) > 0;

        updates.push(update);
      }
    }

    return updates;
  }

  private parseFields(raw: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const part of raw.split('\xac')) {  // ¬ = 0xac in latin1... 
      const idx = part.indexOf('\xf7');  // ÷ = 0xf7 in latin1
      if (idx > 0) {
        fields[part.substring(0, idx)] = part.substring(idx + 1);
      }
    }
    // Also try UTF-8 encoded versions
    for (const part of raw.split('¬')) {
      const idx = part.indexOf('÷');
      if (idx > 0) {
        fields[part.substring(0, idx)] = part.substring(idx + 1);
      }
    }
    return fields;
  }

  private scheduleReconnect(): void {
    if (this.stopping) return;
    this.serverIdx++;
    log.info(`Reconnecting in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => this.doConnect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private cleanup(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.alive = false;
  }
}
