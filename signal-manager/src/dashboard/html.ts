export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PolyMoney — Live Trading Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0e14;--bg2:#131922;--bg3:#1a2233;--bg4:#243044;--border:#2a3a4e;--text:#e0e8f0;--text2:#7a8a9e;--green:#00e676;--red:#ff1744;--yellow:#ffc400;--blue:#448aff;--purple:#b388ff;--cyan:#18ffff;--orange:#ff9100}
body{background:var(--bg);color:var(--text);font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:13px;overflow:hidden;height:100vh}

.top-bar{background:linear-gradient(90deg,var(--bg2),var(--bg3));border-bottom:1px solid var(--border);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;height:44px}
.top-bar h1{font-size:16px;font-weight:700;letter-spacing:1px}
.top-bar h1 .poly{color:var(--blue)}
.top-bar h1 .money{color:var(--green)}
.top-bar .right{display:flex;gap:12px;align-items:center;font-size:11px}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--green);animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.stat{color:var(--text2)}.stat b{color:var(--text)}

.layout{display:grid;grid-template-columns:1fr 420px;height:calc(100vh - 44px)}
@media(max-width:1000px){.layout{grid-template-columns:1fr}}

.left{display:flex;flex-direction:column;overflow:hidden}
.right-panel{background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}

/* Signal Feed */
.signal-header{padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center}
.signal-feed{flex:1;overflow-y:auto;padding:6px}
.signal-card{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:border-color .2s}
.signal-card:hover{border-color:var(--blue)}
.signal-card.critical{border-left:3px solid var(--red);background:rgba(255,23,68,.06)}
.signal-card.high{border-left:3px solid var(--orange);background:rgba(255,145,0,.04)}
.signal-card.medium{border-left:3px solid var(--yellow)}
.signal-card.low{border-left:3px solid var(--blue)}
.sig-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.sig-action{font-weight:700;font-size:13px;padding:2px 8px;border-radius:3px}
.sig-action.buy{background:rgba(0,230,118,.15);color:var(--green)}
.sig-action.sell{background:rgba(255,23,68,.15);color:var(--red)}
.sig-match{font-size:12px;font-weight:600}
.sig-market{color:var(--cyan);font-size:11px}
.sig-reason{color:var(--text2);font-size:11px;margin-top:3px;line-height:1.4}
.sig-meta{display:flex;gap:12px;margin-top:5px;font-size:10px;color:var(--text2)}
.sig-meta .edge{color:var(--green);font-weight:700}
.sig-meta .conf{color:var(--yellow)}
.sig-time{font-size:10px;color:var(--text2)}

/* Events Table */
.events-header{padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.events-header h2{font-size:12px;font-weight:600;color:var(--cyan);text-transform:uppercase;letter-spacing:1px}
.events-header .filter{display:flex;gap:6px}
.events-header .filter button{background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;font-family:inherit}
.events-header .filter button.active{background:var(--blue);color:#fff;border-color:var(--blue)}

.events-list{flex:1;overflow-y:auto;padding:6px}
.ev{background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-bottom:4px;overflow:hidden}
.ev.live{border-left:3px solid var(--red)}
.ev-top{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer}
.ev-top:hover{background:var(--bg3)}
.ev-teams{font-weight:600;font-size:13px}
.ev-score{font-size:16px;font-weight:800;color:var(--green);margin:0 10px;min-width:50px;text-align:center}
.ev-live-badge{color:var(--red);font-size:10px;font-weight:700;animation:blink 2s infinite}
.ev-league{color:var(--text2);font-size:10px}

.ev-odds{display:none;padding:6px 12px 10px;border-top:1px solid var(--border);background:var(--bg)}
.ev.open .ev-odds{display:block}
.odds-row{display:grid;grid-template-columns:120px 1fr 1fr 1fr;gap:4px;padding:3px 0;font-size:11px;align-items:center;border-bottom:1px solid rgba(42,58,78,.3)}
.odds-row:last-child{border-bottom:none}
.odds-label{color:var(--text2);font-weight:500}
.odds-cell{text-align:center;padding:2px 6px;border-radius:3px}
.odds-cell.pm{color:var(--blue)}
.odds-cell.xbet{color:var(--yellow)}
.odds-cell.fs{color:var(--cyan)}
.odds-cell.divergent{background:rgba(255,23,68,.15);color:var(--red);font-weight:700}
.odds-cell.opportunity{background:rgba(0,230,118,.12);color:var(--green);font-weight:700}
.odds-header{font-weight:600;color:var(--text2);font-size:10px;text-transform:uppercase}

/* Adapter status */
.adapters{display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border)}
.adapter-pill{display:flex;align-items:center;gap:5px;padding:3px 10px;background:var(--bg3);border-radius:12px;font-size:11px}
.adapter-pill .dot{width:6px;height:6px;border-radius:50%}
.dot-on{background:var(--green)}.dot-off{background:var(--red)}.dot-warn{background:var(--yellow)}

.empty-state{text-align:center;color:var(--text2);padding:40px;font-size:12px}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:3px}
</style>
</head>
<body>
<div class="top-bar">
  <h1>💰 <span class="poly">POLY</span><span class="money">MONEY</span></h1>
  <div class="right">
    <div class="pulse" id="ws-dot"></div>
    <span class="stat">Events: <b id="s-events">0</b></span>
    <span class="stat">Signals: <b id="s-signals">0</b></span>
    <span class="stat">Live: <b id="s-live" style="color:var(--red)">0</b></span>
    <span class="stat" id="s-latency"></span>
  </div>
</div>

<div class="layout">
  <div class="left">
    <div class="adapters" id="adapters"></div>
    <div class="events-header">
      <h2>📡 Live Events & Odds</h2>
      <div class="filter">
        <button class="active" data-filter="all">All</button>
        <button data-filter="live">Live</button>
        <button data-filter="multi">Multi-Source</button>
        <button data-filter="opportunity">💰 Opps</button>
      </div>
    </div>
    <div class="events-list" id="events"><div class="empty-state">Connecting...</div></div>
  </div>
  
  <div class="right-panel">
    <div class="signal-header">
      <span>🚨 Trade Signals</span>
      <span id="sig-count" style="color:var(--text2)">0</span>
    </div>
    <div class="signal-feed" id="signals"><div class="empty-state">Waiting for signals...</div></div>
  </div>
</div>

<audio id="alert-sound" preload="auto">
  <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Kj4+LhXdsa2d0gIuTlZKKgnhualxVW2l4h5OYl5KKgXVpYl1dZHJ/jJOYl5KIf3NoXVhZYGx6iJOYmJWNg3htZF9dYWp1goyTl5iWkId9cWhgXF5mbniGjpOXmJaSiH9zZ2BcX2ZueoiPk5eYlpGGfHFoYF1fZ3B8iZGUl5eWkYZ8cWhhXmBocX2KkpWXl5WRhXtwaWFeYWlzf4uTlpeXlI+Ee29nYV9haXV/i5KUlpaVkIN7b2diYGJpdICMk5WWlZOQg3pvZ2JhY2p2goyTlZaVk5CDe3BnY2FjancA" type="audio/wav">
</audio>

<script>
const SRC = {polymarket:'PM',onexbet:'1xBet',flashscore:'FS'};
const SRC_CLS = {polymarket:'pm',onexbet:'xbet',flashscore:'fs'};
let ws, state=null, prevSignalCount=0, filter='all', openEvents=new Set();

// Filter buttons
document.querySelectorAll('.filter button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    renderEvents();
  };
});

function connect(){
  const p=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(p+'://'+location.host);
  ws.onopen=()=>{document.getElementById('ws-dot').style.background='var(--green)'};
  ws.onmessage=e=>{
    const prev=state;
    state=JSON.parse(e.data);
    render();
    // Alert sound on new critical/high signals
    if(prev && state.tradeSignals.length>prev.tradeSignals.length){
      const newest=state.tradeSignals[0];
      if(newest&&(newest.urgency==='critical'||newest.urgency==='high')){
        try{document.getElementById('alert-sound').play().catch(()=>{})}catch(e){}
      }
    }
  };
  ws.onclose=()=>{
    document.getElementById('ws-dot').style.background='var(--red)';
    setTimeout(connect,2000);
  };
}

function render(){
  if(!state)return;
  const live=state.events.filter(e=>e.status==='live');
  document.getElementById('s-events').textContent=state.eventCount;
  document.getElementById('s-signals').textContent=state.tradeSignals.length;
  document.getElementById('s-live').textContent=live.length;
  document.getElementById('s-latency').innerHTML='Updated: <b>'+new Date().toLocaleTimeString()+'</b>';
  
  // Adapters
  const ad=document.getElementById('adapters');
  ad.innerHTML=Object.entries(state.adapters).map(([id,s])=>{
    const dot=s==='connected'?'dot-on':s==='error'?'dot-off':'dot-warn';
    return '<div class="adapter-pill"><div class="dot '+dot+'"></div>'+(SRC[id]||id)+'</div>';
  }).join('');
  
  renderEvents();
  renderSignals();
}

function renderEvents(){
  if(!state)return;
  let evs=[...state.events].sort((a,b)=>{
    if(a.status==='live'&&b.status!=='live')return -1;
    if(b.status==='live'&&a.status!=='live')return 1;
    const aMulti=Object.values(a.markets).some(m=>Object.keys(m).length>1);
    const bMulti=Object.values(b.markets).some(m=>Object.keys(m).length>1);
    if(aMulti&&!bMulti)return -1;
    if(bMulti&&!aMulti)return 1;
    return b.lastUpdate-a.lastUpdate;
  });
  
  if(filter==='live')evs=evs.filter(e=>e.status==='live');
  if(filter==='multi')evs=evs.filter(e=>Object.values(e.markets).some(m=>Object.keys(m).length>1));
  if(filter==='opportunity')evs=evs.filter(e=>{
    return Object.values(e.markets).some(m=>{
      const vals=Object.values(m);
      if(vals.length<2)return false;
      for(let i=0;i<vals.length;i++)for(let j=i+1;j<vals.length;j++){
        const d=Math.abs(vals[i].value-vals[j].value)/((vals[i].value+vals[j].value)/2)*100;
        if(d>10)return true;
      }
      return false;
    });
  });
  
  const el=document.getElementById('events');
  if(evs.length===0){el.innerHTML='<div class="empty-state">No events match filter</div>';return;}
  
  el.innerHTML=evs.slice(0,100).map(ev=>{
    const isLive=ev.status==='live';
    const isOpen=openEvents.has(ev.id);
    const sc=ev.score?ev.score.home+' - '+ev.score.away:'';
    const mkeys=Object.keys(ev.markets).filter(k=>!k.startsWith('__')).sort();
    
    let oddsHtml='<div class="odds-row"><div class="odds-header">Market</div><div class="odds-header" style="text-align:center;color:var(--blue)">Polymarket</div><div class="odds-header" style="text-align:center;color:var(--yellow)">1xBet</div><div class="odds-header" style="text-align:center;color:var(--cyan)">FlashScore</div></div>';
    
    for(const k of mkeys.slice(0,15)){
      const srcs=ev.markets[k];
      const pm=srcs.polymarket;
      const xb=srcs.onexbet;
      const fs=srcs.flashscore;
      
      // Detect divergence
      let hasDivergence=false;
      const vals=Object.values(srcs);
      if(vals.length>=2){
        for(let i=0;i<vals.length;i++)for(let j=i+1;j<vals.length;j++){
          const d=Math.abs(vals[i].value-vals[j].value)/((vals[i].value+vals[j].value)/2)*100;
          if(d>10)hasDivergence=true;
        }
      }
      
      const fmtOdds=(o,cls)=>o?'<div class="odds-cell '+cls+(hasDivergence?' divergent':'')+'">'+o.value.toFixed(3)+'<br><span style="font-size:9px;color:var(--text2)">'+(1/o.value*100).toFixed(1)+'%</span></div>':'<div class="odds-cell" style="color:var(--text2)">—</div>';
      
      oddsHtml+='<div class="odds-row"><div class="odds-label">'+fmtKey(k)+'</div>'+fmtOdds(pm,'pm')+fmtOdds(xb,'xbet')+fmtOdds(fs,'fs')+'</div>';
    }
    
    return '<div class="ev'+(isLive?' live':'')+(isOpen?' open':'')+'" data-id="'+ev.id+'"><div class="ev-top" onclick="toggleEv(&quot;'+ev.id+'&quot;)"><div><span class="ev-teams">'+ev.home+' vs '+ev.away+'</span>'+(isLive?' <span class="ev-live-badge">● LIVE</span>':'')+'<br><span class="ev-league">'+ev.league+' · '+Object.keys(ev.markets).length+' markets · '+Object.keys(Object.values(ev.markets)[0]||{}).length+' sources</span></div><div>'+(sc?'<span class="ev-score">'+sc+'</span>':'')+'</div></div><div class="ev-odds">'+oddsHtml+'</div></div>';
  }).join('');
}

function renderSignals(){
  if(!state)return;
  const el=document.getElementById('signals');
  const sigs=state.tradeSignals;
  document.getElementById('sig-count').textContent=sigs.length;
  
  if(sigs.length===0){el.innerHTML='<div class="empty-state">No trade signals yet.<br>Signals appear when odds diverge between sources.</div>';return;}
  
  el.innerHTML=sigs.slice(0,100).map(s=>{
    const isBuy=s.action.startsWith('BUY');
    const ago=Math.floor((Date.now()-s.timestamp)/1000);
    const timeStr=ago<60?ago+'s':Math.floor(ago/60)+'m';
    const scoreTxt=s.score?s.score.home+'-'+s.score.away:'';
    
    return '<div class="signal-card '+s.urgency+'"><div class="sig-top"><span class="sig-action '+(isBuy?'buy':'sell')+'">'+s.action.replace('_',' ')+'</span><span class="sig-time">'+timeStr+' ago</span></div><div class="sig-match">'+s.homeTeam+' vs '+s.awayTeam+(scoreTxt?' <span style="color:var(--green)">'+scoreTxt+'</span>':'')+'</div><div class="sig-market">'+fmtKey(s.market)+'</div><div class="sig-reason">'+s.reason+'</div><div class="sig-meta"><span class="edge">Edge: '+s.edge.toFixed(1)+'%</span><span class="conf">Conf: '+s.confidence+'%</span><span>Poly: '+(s.polyPrice*100).toFixed(1)+'%</span><span>Fair: '+(s.fairPrice*100).toFixed(1)+'%</span>'+(s.expectedProfit?'<span style="color:var(--green)">+'+s.expectedProfit.toFixed(1)+'%</span>':'')+'</div></div>';
  }).join('');
}

function toggleEv(id){openEvents.has(id)?openEvents.delete(id):openEvents.add(id);renderEvents();}
function fmtKey(k){return k.replace(/_ft$/,'').replace(/_/g,' ').replace(/^ml /,'ML ').replace(/^dc /,'DC ').toUpperCase();}

connect();
</script>
</body>
</html>`;
