export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PolyMoney Signal Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --blue: #58a6ff; --purple: #bc8cff;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
  
  .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header h1 span { color: var(--blue); }
  .header .status { display: flex; gap: 16px; align-items: center; }
  
  .badge { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
  .badge-green { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-red { background: rgba(248,81,73,0.15); color: var(--red); }
  .badge-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
  
  .container { display: grid; grid-template-columns: 1fr 380px; gap: 0; min-height: calc(100vh - 60px); }
  @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }
  
  .main { padding: 16px; overflow-y: auto; max-height: calc(100vh - 60px); }
  .sidebar { background: var(--bg2); border-left: 1px solid var(--border); padding: 16px; overflow-y: auto; max-height: calc(100vh - 60px); }
  
  .stats { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 140px; }
  .stat-card .label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
  
  .section-title { font-size: 13px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 8px; }
  
  .event-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .event-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .event-teams { font-weight: 600; font-size: 14px; }
  .event-score { font-size: 18px; font-weight: 700; color: var(--green); margin: 0 12px; }
  .event-meta { font-size: 11px; color: var(--text2); }
  .event-live { color: var(--red); font-weight: 600; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  
  .odds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; padding: 8px 14px 10px; }
  .odds-item { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: var(--bg3); border-radius: 4px; font-size: 12px; }
  .odds-key { color: var(--text2); font-weight: 500; }
  .odds-values { display: flex; gap: 8px; }
  .odds-src { font-size: 11px; }
  .odds-src.pm { color: var(--blue); }
  .odds-src.xbet { color: var(--yellow); }
  .odds-src.fs { color: var(--green); }
  .odds-divergent { background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); }
  
  .alert { padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; font-size: 12px; border-left: 3px solid; }
  .alert-high { background: rgba(248,81,73,0.1); border-color: var(--red); }
  .alert-medium { background: rgba(210,153,34,0.1); border-color: var(--yellow); }
  .alert-low { background: rgba(63,185,80,0.1); border-color: var(--green); }
  .alert .time { color: var(--text2); font-size: 10px; }
  .alert .msg { margin-top: 2px; }
  
  .adapter-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .adapter { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg3); border-radius: 6px; }
  .adapter .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot-green { background: var(--green); }
  .dot-red { background: var(--red); }
  .dot-yellow { background: var(--yellow); }
  
  .empty { text-align: center; color: var(--text2); padding: 40px; }
  #conn-status { font-size: 11px; }
</style>
</head>
<body>
<div class="header">
  <h1>💰 <span>PolyMoney</span> Signal Dashboard</h1>
  <div class="status">
    <span id="conn-status" class="badge badge-yellow">Connecting...</span>
    <span id="event-count" class="badge badge-green">0 events</span>
  </div>
</div>

<div class="container">
  <div class="main">
    <div class="stats">
      <div class="stat-card"><div class="label">Live Events</div><div class="value" id="live-count">0</div></div>
      <div class="stat-card"><div class="label">Total Events</div><div class="value" id="total-count">0</div></div>
      <div class="stat-card"><div class="label">Signals</div><div class="value" id="signal-count">0</div></div>
      <div class="stat-card"><div class="label">Uptime</div><div class="value" id="uptime">-</div></div>
    </div>
    
    <div class="section-title">Adapters</div>
    <div class="adapter-list" id="adapters"></div>
    
    <div class="section-title">Live Events</div>
    <div id="events"><div class="empty">Waiting for data...</div></div>
  </div>
  
  <div class="sidebar">
    <div class="section-title">Signal Alerts</div>
    <div id="alerts"><div class="empty">No alerts yet</div></div>
  </div>
</div>

<script>
const SRC_LABELS = { polymarket: 'PM', onexbet: '1xBet', flashscore: 'FS' };
const SRC_CLASS = { polymarket: 'pm', onexbet: 'xbet', flashscore: 'fs' };

let ws;
let state = null;
let startTime = Date.now();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host);
  
  ws.onopen = () => {
    document.getElementById('conn-status').className = 'badge badge-green';
    document.getElementById('conn-status').textContent = 'Connected';
  };
  
  ws.onmessage = (e) => {
    state = JSON.parse(e.data);
    render();
  };
  
  ws.onclose = () => {
    document.getElementById('conn-status').className = 'badge badge-red';
    document.getElementById('conn-status').textContent = 'Disconnected';
    setTimeout(connect, 3000);
  };
}

function render() {
  if (!state) return;
  
  const liveEvents = state.events.filter(e => e.status === 'live');
  document.getElementById('live-count').textContent = liveEvents.length;
  document.getElementById('total-count').textContent = state.eventCount;
  document.getElementById('signal-count').textContent = state.alerts.length;
  document.getElementById('event-count').textContent = state.eventCount + ' events';
  
  // Uptime
  const secs = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  document.getElementById('uptime').textContent = h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  
  // Adapters
  const adEl = document.getElementById('adapters');
  adEl.innerHTML = Object.entries(state.adapters).map(([id, status]) => {
    const dotClass = status === 'connected' ? 'dot-green' : status === 'error' ? 'dot-red' : 'dot-yellow';
    return '<div class="adapter"><div class="dot ' + dotClass + '"></div><strong>' + (SRC_LABELS[id] || id) + '</strong><span style="color:var(--text2)">' + status + '</span></div>';
  }).join('');
  
  // Events - sort: live first, then by update time
  const sorted = [...state.events].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    return b.lastUpdate - a.lastUpdate;
  });
  
  const evEl = document.getElementById('events');
  if (sorted.length === 0) {
    evEl.innerHTML = '<div class="empty">No events tracked yet. Waiting for adapters...</div>';
    return;
  }
  
  evEl.innerHTML = sorted.map(ev => {
    const isLive = ev.status === 'live';
    const scoreStr = ev.score ? ev.score.home + ' - ' + ev.score.away : '';
    const elapsed = ev.elapsed || ev.period || '';
    
    let oddsHtml = '';
    const marketKeys = Object.keys(ev.markets).filter(k => !k.startsWith('__')).sort();
    
    for (const key of marketKeys.slice(0, 12)) {
      const sources = ev.markets[key];
      const vals = Object.entries(sources);
      if (vals.length === 0) continue;
      
      // Check divergence
      let maxDiff = 0;
      if (vals.length >= 2) {
        for (let i = 0; i < vals.length; i++) {
          for (let j = i+1; j < vals.length; j++) {
            const d = Math.abs(vals[i][1].value - vals[j][1].value) / ((vals[i][1].value + vals[j][1].value) / 2) * 100;
            if (d > maxDiff) maxDiff = d;
          }
        }
      }
      
      const divergent = maxDiff > 10;
      const valStr = vals.map(([src, o]) => '<span class="odds-src ' + (SRC_CLASS[src]||'') + '">' + (SRC_LABELS[src]||src) + ':' + o.value.toFixed(2) + '</span>').join('');
      
      oddsHtml += '<div class="odds-item' + (divergent ? ' odds-divergent' : '') + '"><span class="odds-key">' + formatKey(key) + '</span><div class="odds-values">' + valStr + '</div></div>';
    }
    
    return '<div class="event-card"><div class="event-header"><div><span class="event-teams">' + ev.home + ' vs ' + ev.away + '</span>' + (isLive ? ' <span class="event-live">● LIVE</span>' : '') + '</div><div>' + (scoreStr ? '<span class="event-score">' + scoreStr + '</span>' : '') + '<span class="event-meta">' + elapsed + ' · ' + ev.league + '</span></div></div>' + (oddsHtml ? '<div class="odds-grid">' + oddsHtml + '</div>' : '') + '</div>';
  }).join('');
  
  // Alerts
  const alEl = document.getElementById('alerts');
  if (state.alerts.length === 0) {
    alEl.innerHTML = '<div class="empty">No alerts yet</div>';
  } else {
    alEl.innerHTML = state.alerts.slice(0, 50).map(a => {
      const ago = Math.floor((Date.now() - a.timestamp) / 1000);
      const timeStr = ago < 60 ? ago + 's ago' : Math.floor(ago/60) + 'm ago';
      return '<div class="alert alert-' + a.severity + '"><div class="time">' + a.type.replace(/_/g,' ') + ' · ' + timeStr + '</div><div class="msg">' + a.message + '</div></div>';
    }).join('');
  }
}

function formatKey(key) {
  return key.replace(/_ft$/, '').replace(/_/g, ' ').replace(/^ml /, 'ML ').replace(/^dc /, 'DC ').toUpperCase();
}

connect();
setInterval(() => { if (state) render(); }, 5000); // Update uptime
</script>
</body>
</html>`;
