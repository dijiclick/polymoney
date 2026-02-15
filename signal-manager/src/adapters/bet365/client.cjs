/**
 * Bet365 Live Scores Client
 *
 * Intercepts bet365's proprietary "Readit" push protocol over WebSocket
 * for real-time live match data.
 *
 * Modes:
 *   1. CDP mode (default, recommended) — automatically launches Chrome with
 *      --remote-debugging-port and navigates to bet365. If Chrome is already
 *      running with the debug port, connects to the existing instance.
 *      Uses Chrome DevTools Protocol to intercept WS frames from a real,
 *      unmodified Chrome session, bypassing bet365's anti-bot detection.
 *
 *   2. Launch mode — launches a new Playwright browser. May trigger bet365's
 *      anti-bot (XCFT challenge + automation detection), which can cause the
 *      WS data to be silently blocked. Not recommended.
 *
 * Protocol:  Readit (proprietary binary-text hybrid) over WebSocket
 * WS URL:    wss://premws-pt{n}.365lpodds.com:443/zap/?uid={uid}
 * Transport: zap-protocol-v2
 *
 * Wire format:
 *   Sub-messages delimited by \x08 (MESSAGE_DELIM)
 *   Each starts with message type byte:
 *     20 = INITIAL_TOPIC_LOAD (full snapshot)
 *     21 = DELTA (incremental update)
 *     24 = SERVER_PING
 *   Topic and data separated by \x01 (RECORD_DELIM)
 *   Data: type char (F/U/I/D) + pipe-delimited nodes
 *   Node: nodeType;field1=value1;field2=value2;
 *
 * Node types:
 *   CL = Classification (sport)    CT = Competition
 *   EV = Event (match)             MA = Market
 *   PA = Participant (selection)   IN = Info
 *
 * EV fields (live match):
 *   NA = match name ("Home v Away")    SS = score ("1-0")
 *   TM = timer minutes                 TS = timer seconds
 *   TT = timer ticking (1/0)           TU = timer update timestamp
 *   GO = period ("1st","2nd","HT")     ML = match length (90)
 *   FI = fixture ID                    CT = competition name
 *   UC = update comment flash ("Goal","Red Card","Full time")
 *   SU = suspended (0/1)               VI = video available
 *
 * Topics:
 *   InPlay_1_9         — lightweight in-play overview (all sports)
 *   OVInPlay_1_9       — in-play with full market data
 *   OV{fi}C{sp}A_1_9   — full data for a single event
 *   __time             — server time sync
 *
 * Requires: npm install playwright
 * Note: bet365 may be geo-restricted. Use a UK/EU/AU connection.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  url: 'https://www.bet365.com/#/IP/',
  cdpUrl: 'http://localhost:9222',
  inPlayTopic: 'InPlay_1_9',
  ovInPlayTopic: 'OVInPlay_1_9',
  lang: 1,
  zone: 9,
};

// ─── Wire Protocol Constants ─────────────────────────────────────────────────

const DELIM = {
  RECORD:    '\x01', // separates topic from data within a sub-message
  FIELD:     '\x02', // separates fields within header
  HS_MSG:    '\x03', // handshake message boundary
  MESSAGE:   '\x08', // separates sub-messages within a frame
  HS_END:    '\x00', // end of handshake
};

const MSG = {
  INITIAL_TOPIC_LOAD: 20,
  DELTA:              21,
  CLIENT_SUBSCRIBE:   22,
  CLIENT_UNSUBSCRIBE: 23,
  SERVER_PING:        24,
  CLIENT_PING:        25,
  SWAP_SUBSCRIPTIONS: 26,
  CLIENT_ABORT:       28,
  CLIENT_CLOSE:       29,
  ACK_ITL:            30,
  ACK_DELTA:          31,
};

const DATA = {
  SNAPSHOT: 'F',
  UPDATE:  'U',
  INSERT:  'I',
  DELETE:  'D',
};

const ENCODING = {
  NONE:       0,
  ENCRYPTED:  17,
  COMPRESSED: 18,
  BASE64:     19,
};

// ─── Period / Status ─────────────────────────────────────────────────────────

const PERIOD = {
  '1st':    '1st half',
  '2nd':    '2nd half',
  'HT':     'Halftime',
  'FT':     'Full time',
  'ET':     'Extra time',
  'ET1':    'Extra time 1st half',
  'ET2':    'Extra time 2nd half',
  'PEN':    'Penalties',
  'Postp.': 'Postponed',
  'Int':    'Interrupted',
  'Aband.': 'Abandoned',
  'Canc.':  'Cancelled',
  'AP':     'After penalties',
  'AET':    'After extra time',
  'Break':  'Break',
};

const LIVE_PERIODS = new Set(['1st', '2nd', 'ET', 'ET1', 'ET2', 'PEN']);
const BREAK_PERIODS = new Set(['HT', 'Break']);
const FINISHED_PERIODS = new Set(['FT', 'AP', 'AET', 'Aband.', 'Canc.']);

// ─── Sport Classification IDs ────────────────────────────────────────────────

const SPORT = {
  1:  'Soccer',
  18: 'Basketball',
  13: 'Tennis',
  17: 'Ice Hockey',
  14: 'Snooker',
  8:  'Rugby Union',
  16: 'Baseball',
  12: 'American Football',
  3:  'Cricket',
  91: 'Volleyball',
  78: 'Handball',
  36: 'Australian Rules',
  66: 'Bowls',
  75: 'Gaelic Sports',
  90: 'Floorball',
  95: 'Badminton',
  110: 'Water Polo',
  107: 'Squash',
  151: 'E-Sports',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseScore(ss) {
  if (!ss || ss === '') return null;
  // Soccer: "1-0", Tennis: "6-4,1-0", Basketball: "87-92"
  const main = ss.split(',')[0]; // take first segment for multi-set sports
  const parts = main.split('-');
  if (parts.length !== 2) return null;
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away)) return null;
  return { home, away };
}

function parseName(na) {
  if (!na) return { home: '?', away: '?' };
  // bet365 uses " v " for most sports, " @ " for basketball/american football,
  // " vs " occasionally for some basketball/other leagues
  let idx = na.indexOf(' v ');
  let sepLen = 3;
  if (idx === -1) {
    idx = na.indexOf(' @ ');
  }
  if (idx === -1) {
    idx = na.indexOf(' vs ');
    sepLen = 4;
  }
  if (idx === -1) return { home: na, away: '?' };
  return {
    home: na.substring(0, idx).trim(),
    away: na.substring(idx + sepLen).trim(),
  };
}

/**
 * Extract fixture ID from EV node fields.
 * FI field is only present on some nodes; most encode it in the ID field.
 * ID format: "188751438C1A_1_9" → fixture ID = "188751438"
 * IT format: "OV188751438C1A_1_9" → fixture ID = "188751438"
 */
function extractFI(fields) {
  if (fields.FI) return fields.FI;
  if (fields.ID) {
    const m = fields.ID.match(/^(\d+)C/);
    if (m) return m[1];
  }
  if (fields.IT) {
    const m = fields.IT.match(/(\d+)C/);
    if (m) return m[1];
  }
  return null;
}

// ─── Node Parser ─────────────────────────────────────────────────────────────

/**
 * Parse the data portion of a snapshot or delta message into an array of nodes.
 *
 * Data format: {typeChar}|{nodeType};{k}={v};{k}={v};|{nodeType};...;|
 * typeChar: F=SNAPSHOT, U=UPDATE, I=INSERT, D=DELETE
 *
 * Returns: [{ dataType, nodeType, fields: { k: v, ... } }, ...]
 */
function parseNodes(dataStr) {
  if (!dataStr || dataStr.length === 0) return [];

  const dataType = dataStr[0]; // F, U, I, D
  const rest = dataStr.substring(1);

  // Split by pipe, filter empties
  const segments = rest.split('|').filter(s => s.length > 0);
  const nodes = [];

  for (const seg of segments) {
    const parts = seg.split(';').filter(s => s.length > 0);
    if (parts.length === 0) continue;

    // First part: if it's 2-3 chars without '=', it's a node type code
    let nodeType = null;
    let startIdx = 0;

    if (parts[0].length <= 3 && !parts[0].includes('=')) {
      nodeType = parts[0];
      startIdx = 1;
    }

    const fields = {};
    for (let i = startIdx; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx !== -1) {
        fields[parts[i].substring(0, eqIdx)] = parts[i].substring(eqIdx + 1);
      }
    }

    nodes.push({ dataType, nodeType, fields });
  }

  return nodes;
}

// ─── Bet365 Client ───────────────────────────────────────────────────────────

class Bet365Client extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  [opts.cdpUrl]           CDP endpoint (e.g. http://localhost:9222)
   * @param {boolean} [opts.headless=false]    Run browser headless (launch mode only)
   * @param {string}  [opts.sport]             Filter by sport name (e.g. 'Soccer')
   * @param {number}  [opts.sportId]           Filter by sport classification ID (e.g. 1)
   * @param {string}  [opts.executablePath]    Path to browser executable (launch mode)
   */
  constructor(opts = {}) {
    super();
    this._cdpUrl = opts.cdpUrl || null;
    this._headless = opts.headless !== undefined ? opts.headless : false;
    this._sportFilter = opts.sport || null;
    this._sportIdFilter = opts.sportId || null;
    this._executablePath = opts.executablePath || null;
    this._cdpPort = opts.cdpPort || 9222;

    /** @type {Map<string, object>} fixtureId -> event data */
    this._events = new Map();

    this._browser = null;
    this._page = null;
    this._cdpSession = null;
    this._chromeProcess = null;
    this._connected = false;
    this._snapshotReceived = false;
    this._startResolve = null;

    /** @type {Map<string, string>} CDP requestId -> WS URL */
    this._wsConnections = new Map();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Connect to bet365 and start intercepting WebSocket push data.
   *
   * Automatically launches Chrome with --remote-debugging-port if not
   * already running, then connects via CDP to intercept WS frames.
   */
  async start() {
    const { chromium } = require('playwright');

    if (this._cdpUrl) {
      // Explicit CDP URL provided — try to connect, launch Chrome if refused
      try {
        await this._startCDP(chromium);
      } catch (err) {
        if (err.message && err.message.includes('ECONNREFUSED')) {
          this.emit('info', `Chrome not running on port ${this._cdpPort}. Launching...`);
          await this._launchChrome();
          this._cdpUrl = `http://localhost:${this._cdpPort}`;
          await this._startCDP(chromium);
        } else {
          throw err;
        }
      }
    } else {
      await this._startLaunch(chromium);
    }

    // Wait for snapshot (or timeout after 15s)
    await new Promise((resolve) => {
      this._startResolve = resolve;
      setTimeout(() => {
        if (this._startResolve) {
          this._startResolve = null;
          resolve();
        }
      }, 15_000);
    });

    this.emit('ready', {
      total: this._events.size,
      live: this.getLiveEvents().length,
    });
  }

  /** Find Chrome executable on the system */
  _findChrome() {
    if (this._executablePath) return this._executablePath;

    const fs = require('fs');
    const candidates = process.platform === 'win32'
      ? [
          path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];

    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }

    // Fallback: hope it's on PATH
    return process.platform === 'win32' ? 'chrome.exe' : 'google-chrome';
  }

  /**
   * Launch Chrome with remote debugging enabled.
   * Uses a dedicated user-data-dir so it doesn't conflict with existing sessions.
   */
  async _launchChrome() {
    const chromePath = this._findChrome();
    const userDataDir = path.join(os.tmpdir(), 'bet365-chrome-profile');

    const args = [
      `--remote-debugging-port=${this._cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      CONFIG.url,
    ];

    this.emit('info', `Launching Chrome: ${chromePath}`);
    this._chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    this._chromeProcess.unref();

    // Wait for CDP to become available
    const http = require('http');
    const maxWait = 15_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const ok = await new Promise((resolve) => {
        const req = http.get(`http://localhost:${this._cdpPort}/json/version`, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      });
      if (ok) {
        // Give the page a moment to start loading
        await new Promise(r => setTimeout(r, 3000));
        return;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Chrome did not start within ${maxWait / 1000}s`);
  }

  /**
   * CDP mode: connect to existing Chrome via DevTools Protocol.
   * Intercepts WS frames using Network domain events.
   */
  async _startCDP(chromium) {
    this._browser = await chromium.connectOverCDP(this._cdpUrl);
    const contexts = this._browser.contexts();

    if (contexts.length === 0) {
      throw new Error('No browser contexts found. Is Chrome running with --remote-debugging-port?');
    }

    // Find the bet365 page
    let bet365Page = null;
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        const url = page.url();
        if (url.includes('bet365.com')) {
          bet365Page = page;
          break;
        }
      }
      if (bet365Page) break;
    }

    if (!bet365Page) {
      bet365Page = contexts[0].pages()[0];
      if (!bet365Page) {
        bet365Page = await contexts[0].newPage();
      }
      this.emit('info', 'No bet365 tab found. Navigating...');
      await bet365Page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }

    this._page = bet365Page;

    // Create a CDP session to intercept WebSocket frames
    this._cdpSession = await bet365Page.context().newCDPSession(bet365Page);
    await this._cdpSession.send('Network.enable');

    // Track WS connections by requestId -> URL
    this._cdpSession.on('Network.webSocketCreated', ({ requestId, url }) => {
      this._wsConnections.set(requestId, url);
      if (url.includes('/zap/') && !url.includes('pshudws')) {
        this._connected = true;
        this.emit('connected', { url });
      }
    });

    this._cdpSession.on('Network.webSocketClosed', ({ requestId }) => {
      const url = this._wsConnections.get(requestId);
      this._wsConnections.delete(requestId);
      if (url && url.includes('/zap/') && !url.includes('pshudws')) {
        this.emit('disconnected');
      }
    });

    // Intercept ALL received WS frames.
    // For pre-existing connections (created before CDP attach), the requestId
    // won't be in our map. We process those frames too using a heuristic:
    // bet365 data frames start with known message type bytes (20, 21, 24).
    this._cdpSession.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
      const url = this._wsConnections.get(requestId);

      // If we know the URL, filter to public data connections only
      if (url) {
        if (!url.includes('/zap/')) return;
        if (url.includes('pshudws')) return;
      }

      // For unknown requestIds (pre-existing connections), try to parse.
      // Non-bet365 frames will be silently ignored by _parseFrame.
      try {
        this._parseFrame(response.payloadData);
      } catch (err) {
        // Silently ignore parse errors from non-bet365 frames
        if (url) this.emit('error', err);
      }
    });

    // Reload the page to force new WS connections that our handlers will catch.
    // This ensures we get the full InPlay snapshot even if connections existed before.
    this.emit('info', 'Reloading bet365 to capture fresh WebSocket data...');
    await this._page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  /**
   * Launch mode: start a new browser and navigate to bet365.
   * WARNING: May trigger anti-bot detection.
   */
  async _startLaunch(chromium) {
    const launchOpts = { headless: this._headless };
    if (this._executablePath) launchOpts.executablePath = this._executablePath;

    // Try system Chrome first for better anti-bot compat
    try {
      launchOpts.channel = 'chrome';
      this._browser = await chromium.launch(launchOpts);
    } catch {
      delete launchOpts.channel;
      this._browser = await chromium.launch(launchOpts);
    }

    const context = await this._browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    // Try to hide automation
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    this._page = await context.newPage();

    // Intercept WebSocket connections
    this._page.on('websocket', (ws) => {
      const url = ws.url();
      if (url.includes('/zap/') && !url.includes('pshudws')) {
        this._handlePlaywrightWs(ws, url);
      }
    });

    try {
      await this._page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (err) {
      this.emit('error', new Error(`Navigation failed: ${err.message}. Is bet365 accessible from your location?`));
    }
  }

  _handlePlaywrightWs(ws, url) {
    this._connected = true;
    this.emit('connected', { url });

    ws.on('framereceived', ({ payload }) => {
      try {
        const data = typeof payload === 'string' ? payload : payload.toString('utf-8');
        this._parseFrame(data);
      } catch (err) {
        this.emit('error', err);
      }
    });

    ws.on('close', () => {
      this._connected = false;
      this.emit('disconnected');
    });
  }

  /** Stop the client and close/disconnect the browser */
  async stop() {
    if (this._cdpSession) {
      try { await this._cdpSession.detach(); } catch {}
      this._cdpSession = null;
    }
    if (this._browser) {
      if (this._cdpUrl) {
        // CDP mode: just disconnect, don't close the browser
        this._browser.close().catch(() => {});
      } else {
        await this._browser.close();
      }
      this._browser = null;
      this._page = null;
    }
    if (this._chromeProcess) {
      try { this._chromeProcess.kill(); } catch {}
      this._chromeProcess = null;
    }
    this._connected = false;
  }

  /** Get all tracked events */
  getEvents() {
    return [...this._events.values()];
  }

  /** Get only currently live events */
  getLiveEvents() {
    return this.getEvents().filter(e =>
      LIVE_PERIODS.has(e.period) || BREAK_PERIODS.has(e.period)
    );
  }

  /** Get a single event by fixture ID */
  getEvent(fixtureId) {
    return this._events.get(String(fixtureId)) || null;
  }

  /**
   * Compute approximate match minute from event timer data.
   * Returns null if timer data is insufficient.
   */
  static matchMinute(event) {
    if (!event?.timer) return null;
    const tm = event.timer;

    if (tm.minutes !== null && tm.minutes !== undefined) {
      let min = tm.minutes;
      if (tm.ticking && tm.updated) {
        const updatedDate = Bet365Client._parseTU(tm.updated);
        if (updatedDate) {
          const elapsed = (Date.now() - updatedDate.getTime()) / 1000;
          min += Math.floor((tm.seconds + elapsed) / 60);
        }
      }
      return min;
    }
    return null;
  }

  /** Parse TU timestamp (YYYYMMDDHHmmss) to Date */
  static _parseTU(tu) {
    if (!tu || tu.length < 14) return null;
    const y = tu.substring(0, 4);
    const m = tu.substring(4, 6);
    const d = tu.substring(6, 8);
    const h = tu.substring(8, 10);
    const mi = tu.substring(10, 12);
    const s = tu.substring(12, 14);
    return new Date(`${y}-${m}-${d}T${h}:${mi}:${s}Z`);
  }

  // ── Frame Parsing ──────────────────────────────────────────────────────

  _parseFrame(raw) {
    // Handshake responses start with ASCII digits (100, 101, 111)
    if (/^1[01]\d/.test(raw)) {
      if (raw.startsWith('100')) {
        this.emit('handshake', { success: true });
      } else if (raw.startsWith('101')) {
        this.emit('handshake', { success: false, xcftChallenge: true });
      }
      // Check for data after handshake delimiter
      const hsEnd = raw.indexOf('\x03');
      if (hsEnd !== -1 && hsEnd < raw.length - 1) {
        raw = raw.substring(hsEnd + 1);
      } else {
        return;
      }
    }

    // Split into sub-messages by MESSAGE_DELIM (\x08)
    const subMessages = raw.split(DELIM.MESSAGE);

    for (const sub of subMessages) {
      if (sub.length < 2) continue;
      this._processSubMessage(sub);
    }
  }

  _processSubMessage(sub) {
    const msgType = sub.charCodeAt(0);

    if (msgType === MSG.SERVER_PING) return;
    if (msgType !== MSG.INITIAL_TOPIC_LOAD && msgType !== MSG.DELTA) return;

    // Check for encoding byte (0, 17, 18, 19) after message type
    let offset = 1;
    const secondByte = sub.charCodeAt(1);
    let encoding = ENCODING.NONE;
    if (secondByte <= 19) {
      encoding = secondByte;
      offset = 2;
    }

    // We can only process NONE encoding
    if (encoding !== ENCODING.NONE) return;

    const body = sub.substring(offset);
    const sepIdx = body.indexOf(DELIM.RECORD);
    if (sepIdx === -1) return;

    const topic = body.substring(0, sepIdx);
    const dataStr = body.substring(sepIdx + 1);

    if (msgType === MSG.INITIAL_TOPIC_LOAD) {
      this._processSnapshot(topic, dataStr);
    } else {
      this._processDelta(topic, dataStr);
    }
  }

  // ── Snapshot Processing ────────────────────────────────────────────────

  _processSnapshot(topic, dataStr) {
    if (!topic.includes('InPlay') && !topic.startsWith('OV')) return;

    const nodes = parseNodes(dataStr);
    if (nodes.length === 0) return;

    let currentSport = null;
    let currentComp = null;
    let eventCount = 0;

    for (const node of nodes) {
      if (node.nodeType === 'CL') {
        currentSport = {
          id: node.fields.IT || node.fields.ID,
          name: node.fields.NA,
        };
        continue;
      }

      if (node.nodeType === 'CT') {
        currentComp = {
          id: node.fields.IT || node.fields.ID,
          name: node.fields.NA,
        };
        continue;
      }

      if (node.nodeType === 'EV') {
        const fi = extractFI(node.fields);
        if (!fi) continue;

        // Apply sport filter
        if (this._sportFilter && currentSport?.name !== this._sportFilter) continue;
        if (this._sportIdFilter && currentSport?.id !== String(this._sportIdFilter)) continue;

        const event = this._createEvent(node.fields, currentSport, currentComp);
        this._events.set(fi, event);
        eventCount++;
      }
    }

    if (eventCount > 0) {
      this._snapshotReceived = true;
      this.emit('snapshot', { topic, events: eventCount, total: this._events.size });

      if (this._startResolve) {
        this._startResolve();
        this._startResolve = null;
      }
    }
  }

  // ── Delta Processing ───────────────────────────────────────────────────

  _processDelta(topic, dataStr) {
    const nodes = parseNodes(dataStr);
    if (nodes.length === 0) return;

    let currentSport = null;
    let currentComp = null;

    for (const node of nodes) {
      if (node.nodeType === 'CL') {
        currentSport = {
          id: node.fields.IT || node.fields.ID,
          name: node.fields.NA,
        };
        continue;
      }

      if (node.nodeType === 'CT') {
        currentComp = {
          id: node.fields.IT || node.fields.ID,
          name: node.fields.NA,
        };
        continue;
      }

      if (node.nodeType === 'EV' || node.nodeType === null) {
        const fi = extractFI(node.fields) || this._fixtureIdFromTopic(topic);
        if (!fi) continue;

        const existing = this._events.get(fi);
        if (!existing) {
          // New event from delta — only create if we have enough context
          if (!node.fields.NA) continue; // skip partial updates for unknown events
          if (this._sportFilter && currentSport?.name !== this._sportFilter) continue;
          if (this._sportIdFilter && currentSport?.id !== String(this._sportIdFilter)) continue;
          const event = this._createEvent(node.fields, currentSport, currentComp);
          this._events.set(fi, event);
          this.emit('update', { fixtureId: fi, match: event, receiveTs: Date.now() });
          continue;
        }

        const snap = this._snapshot(existing);
        const receiveTs = Date.now();
        this._applyDelta(existing, node.fields, currentSport, currentComp);
        this._detectChanges(snap, existing, receiveTs);
        this.emit('update', { fixtureId: fi, match: existing, receiveTs });
      }

      // Handle DELETE
      if (node.dataType === DATA.DELETE && node.nodeType === 'EV') {
        const fi = extractFI(node.fields);
        if (fi && this._events.has(fi)) {
          const removed = this._events.get(fi);
          this._events.delete(fi);
          this.emit('eventRemoved', { fixtureId: fi, match: removed });
        }
      }
    }
  }

  /** Extract fixture ID from event-specific topic like OV{fi}C{sp}A_1_9 */
  _fixtureIdFromTopic(topic) {
    const m = topic.match(/^OV(\d+)C/);
    return m ? m[1] : null;
  }

  // ── Event Construction ─────────────────────────────────────────────────

  _createEvent(fields, sport, comp) {
    const names = parseName(fields.NA);
    const score = parseScore(fields.SS);

    return {
      id: extractFI(fields),
      name: fields.NA || null,
      home: names.home,
      away: names.away,
      score: score || { home: 0, away: 0 },
      scoreStr: fields.SS || null,
      timer: {
        minutes: fields.TM !== undefined ? parseInt(fields.TM, 10) : null,
        seconds: fields.TS !== undefined ? parseInt(fields.TS, 10) : null,
        ticking: fields.TT === '1',
        updated: fields.TU || null,
      },
      period: fields.GO || null,
      periodName: PERIOD[fields.GO] || fields.GO || null,
      competition: fields.CT || comp?.name || null,
      competitionId: comp?.id || null,
      sport: sport?.name || (fields.CL ? SPORT[fields.CL] : null) || null,
      sportId: sport?.id || fields.CL || null,
      matchLength: fields.ML ? parseInt(fields.ML, 10) : null,
      suspended: fields.SU === '1',
      videoAvailable: fields.VI === '1',
      comment: fields.UC || null,
      lastUpdate: Date.now(),
      raw: { ...fields },
    };
  }

  /** Capture fields for change detection */
  _snapshot(event) {
    return {
      scoreHome: event.score?.home,
      scoreAway: event.score?.away,
      scoreStr: event.scoreStr,
      period: event.period,
      comment: event.comment,
    };
  }

  /** Apply delta fields to an existing event (mutates in place) */
  _applyDelta(event, fields, sport, comp) {
    if (fields.NA !== undefined) {
      event.name = fields.NA;
      const names = parseName(fields.NA);
      event.home = names.home;
      event.away = names.away;
    }

    if (fields.SS !== undefined) {
      event.scoreStr = fields.SS;
      const score = parseScore(fields.SS);
      if (score) event.score = score;
    }

    if (fields.TM !== undefined) event.timer.minutes = parseInt(fields.TM, 10);
    if (fields.TS !== undefined) event.timer.seconds = parseInt(fields.TS, 10);
    if (fields.TT !== undefined) event.timer.ticking = fields.TT === '1';
    if (fields.TU !== undefined) event.timer.updated = fields.TU;

    if (fields.GO !== undefined) {
      event.period = fields.GO;
      event.periodName = PERIOD[fields.GO] || fields.GO;
    }

    if (fields.CT !== undefined) event.competition = fields.CT;
    if (fields.ML !== undefined) event.matchLength = parseInt(fields.ML, 10);
    if (fields.SU !== undefined) event.suspended = fields.SU === '1';
    if (fields.VI !== undefined) event.videoAvailable = fields.VI === '1';
    if (fields.UC !== undefined) event.comment = fields.UC || null;

    if (sport?.name) event.sport = sport.name;
    if (sport?.id) event.sportId = sport.id;
    if (comp?.name) event.competition = comp.name;
    if (comp?.id) event.competitionId = comp.id;

    event.lastUpdate = Date.now();

    for (const [k, v] of Object.entries(fields)) {
      event.raw[k] = v;
    }
  }

  // ── Change Detection ───────────────────────────────────────────────────

  _detectChanges(snap, event, receiveTs) {
    const prevPeriod = snap.period;
    const currPeriod = event.period;

    // Score change (goal)
    const prevHome = snap.scoreHome;
    const currHome = event.score?.home;
    const prevAway = snap.scoreAway;
    const currAway = event.score?.away;

    if (prevHome !== undefined && currHome !== undefined && currHome > prevHome) {
      this.emit('goal', {
        team: event.home,
        isHome: true,
        score: `${currHome}-${currAway}`,
        match: event,
        receiveTs,
      });
    }
    if (prevAway !== undefined && currAway !== undefined && currAway > prevAway) {
      this.emit('goal', {
        team: event.away,
        isHome: false,
        score: `${currHome}-${currAway}`,
        match: event,
        receiveTs,
      });
    }

    // Period / status change
    if (prevPeriod && currPeriod && prevPeriod !== currPeriod) {
      this.emit('statusChange', {
        from: PERIOD[prevPeriod] || prevPeriod,
        to: PERIOD[currPeriod] || currPeriod,
        match: event,
        receiveTs,
      });

      // Match kicked off
      if (!LIVE_PERIODS.has(prevPeriod) && !BREAK_PERIODS.has(prevPeriod) && LIVE_PERIODS.has(currPeriod)) {
        this.emit('matchStart', { match: event, receiveTs });
      }

      // Halftime
      if (prevPeriod === '1st' && (currPeriod === 'HT' || currPeriod === 'Break')) {
        this.emit('halftime', {
          match: event,
          score: `${currHome}-${currAway}`,
          receiveTs,
        });
      }

      // Match ended
      if ((LIVE_PERIODS.has(prevPeriod) || BREAK_PERIODS.has(prevPeriod)) && FINISHED_PERIODS.has(currPeriod)) {
        this.emit('matchEnd', {
          match: event,
          score: `${currHome}-${currAway}`,
          receiveTs,
        });
      }
    }

    // Update Comment flash
    const uc = event.comment;
    if (uc && uc !== snap.comment) {
      this.emit('flash', { comment: uc, match: event, receiveTs });
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  CONFIG,
  DELIM,
  MSG,
  DATA,
  ENCODING,
  PERIOD,
  LIVE_PERIODS,
  BREAK_PERIODS,
  FINISHED_PERIODS,
  SPORT,
  parseScore,
  parseName,
  parseNodes,
  extractFI,
  Bet365Client,
};
