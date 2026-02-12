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

/* Opportunity Panel */
.signal-header{padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center}
.signal-feed{flex:1;overflow-y:auto;padding:6px}
.opp-card{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;transition:border-color .2s}
.opp-card.good{border-left:3px solid var(--green)}
.opp-card.medium{border-left:3px solid var(--yellow)}
.opp-card.suspect{border-left:3px solid var(--red);opacity:.6}
.opp-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.opp-action{font-weight:700;font-size:12px;padding:2px 8px;border-radius:3px}
.opp-action.yes{background:rgba(0,230,118,.15);color:var(--green)}
.opp-action.no{background:rgba(255,23,68,.15);color:var(--red)}
.opp-edge{font-size:16px;font-weight:800;color:var(--green)}
.opp-match{font-size:12px;font-weight:600}
.opp-market{color:var(--cyan);font-size:11px}
.opp-bar{display:flex;align-items:center;gap:6px;margin:6px 0 4px;font-size:11px}
.opp-bar-track{flex:1;height:6px;background:var(--bg);border-radius:3px;position:relative;overflow:hidden}
.opp-bar-pm{position:absolute;top:0;height:100%;background:var(--blue);border-radius:3px;transition:width .3s}
.opp-bar-xb{position:absolute;top:0;height:100%;border-right:2px solid var(--yellow)}
.opp-probs{display:flex;justify-content:space-between;font-size:10px;color:var(--text2)}
.opp-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:10px;color:var(--text2)}
.opp-meta .val{font-weight:600}
.opp-quality{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600}
.opp-quality.good{background:rgba(0,230,118,.15);color:var(--green)}
.opp-quality.medium{background:rgba(255,196,0,.15);color:var(--yellow)}
.opp-quality.suspect{background:rgba(255,23,68,.15);color:var(--red)}
.opp-trend{font-size:11px;font-weight:600;margin-left:4px}

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

/* Source badges */
.src-badges{display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle}
.src-badge{font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;letter-spacing:.5px}
.src-badge.pm{background:rgba(68,138,255,.2);color:var(--blue)}
.src-badge.xbet{background:rgba(255,196,0,.15);color:var(--yellow)}
.src-badge.fs{background:rgba(24,255,255,.15);color:var(--cyan)}
.ev-elapsed{font-size:11px;color:var(--yellow);font-weight:600;margin-left:6px}
.pm-link{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:6px;border-radius:4px;background:rgba(68,138,255,.15);color:var(--blue);text-decoration:none;font-size:13px;font-weight:700;vertical-align:middle;transition:background .2s}
.pm-link:hover{background:rgba(68,138,255,.35)}
.ev-countdown{font-size:12px;color:var(--text2);font-weight:500;padding:2px 8px;background:var(--bg3);border-radius:4px;white-space:nowrap}

/* Sport filter pills */
.sport-filter{display:flex;flex-wrap:wrap;gap:4px;padding:6px 14px;border-bottom:1px solid var(--border);min-height:28px}
.sport-pill{padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg3);color:var(--text2);transition:all .15s;white-space:nowrap}
.sport-pill:hover{border-color:var(--blue);color:var(--text)}
.sport-pill.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.sport-pill .count{font-weight:400;opacity:.7;margin-left:3px}

/* Sport group headers */
.sport-group-header{padding:6px 14px;font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;gap:6px;position:sticky;top:0;z-index:1}
.sport-group-header .sport-icon{font-size:14px}
.sport-group-header .sport-count{color:var(--text2);font-weight:400;font-size:10px}

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
    <span class="stat">Opps: <b id="s-signals">0</b></span>
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
    <div class="sport-filter" id="sport-filter"></div>
    <div class="events-list" id="events"><div class="empty-state">Connecting...</div></div>
  </div>
  
  <div class="right-panel">
    <div class="signal-header">
      <span>📊 Live Opportunities</span>
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
let ws, state=null, prevSignalCount=0, filter='all', sportFilter='all', openEvents=new Set();

const SPORT_ICONS={
  soccer:'\u26BD',football:'\u26BD',epl:'\u26BD',lal:'\u26BD',bun:'\u26BD',fl1:'\u26BD',sea:'\u26BD',ucl:'\u26BD',mls:'\u26BD',uel:'\u26BD',
  basketball:'\uD83C\uDFC0',nba:'\uD83C\uDFC0',ncaab:'\uD83C\uDFC0',cbb:'\uD83C\uDFC0',wnba:'\uD83C\uDFC0',
  ice_hockey:'\uD83C\uDFD2',nhl:'\uD83C\uDFD2',khl:'\uD83C\uDFD2',shl:'\uD83C\uDFD2',ahl:'\uD83C\uDFD2',
  tennis:'\uD83C\uDFBE',atp:'\uD83C\uDFBE',wta:'\uD83C\uDFBE',
  baseball:'\u26BE',mlb:'\u26BE',kbo:'\u26BE',
  american_football:'\uD83C\uDFC8',nfl:'\uD83C\uDFC8',cfb:'\uD83C\uDFC8',
  cricket:'\uD83C\uDFCF',ipl:'\uD83C\uDFCF',
  mma:'\uD83E\uDD4A',ufc:'\uD83E\uDD4A',boxing:'\uD83E\uDD4A',
  rugby:'\uD83C\uDFC9',
  golf:'\u26F3',
  esports:'\uD83C\uDFAE',esports_cs2:'\uD83C\uDFAE',esports_lol:'\uD83C\uDFAE',esports_dota2:'\uD83C\uDFAE',esports_rl:'\uD83C\uDFAE',esports_cod:'\uD83C\uDFAE',esports_ow:'\uD83C\uDFAE',esports_sc2:'\uD83C\uDFAE',esports_fifa:'\uD83C\uDFAE',
  cs2:'\uD83C\uDFAE',lol:'\uD83C\uDFAE',dota2:'\uD83C\uDFAE',val:'\uD83C\uDFAE',
};
function sportIcon(s){return SPORT_ICONS[s]||SPORT_ICONS[(s||'').split('_')[0]]||'\uD83C\uDFC6';}
function sportLabel(s){
  const map={soccer:'Soccer',ice_hockey:'Hockey',basketball:'Basketball',tennis:'Tennis',baseball:'Baseball',
    american_football:'Football',cricket:'Cricket',mma:'MMA',rugby:'Rugby',golf:'Golf',
    esports:'Esports',esports_cs2:'CS2',esports_lol:'LoL',esports_dota2:'Dota 2',esports_rl:'Rocket League',
    esports_cod:'CoD',esports_ow:'Overwatch',esports_sc2:'StarCraft',esports_fifa:'EA FC',
    nba:'NBA',nhl:'NHL',nfl:'NFL',mlb:'MLB',atp:'ATP',wta:'WTA',ufc:'UFC',ipl:'IPL',
    epl:'EPL',ucl:'UCL',mls:'MLS',ncaab:'NCAAB',cs2:'CS2',lol:'LoL',dota2:'Dota 2',val:'Valorant'};
  return map[s]||s;
}

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
    // Alert sound on new good opportunities
    if(prev && state.tradeSignals.length>prev.tradeSignals.length){
      const newest=state.tradeSignals[0];
      if(newest&&newest.quality==='good'&&newest.edge>10){
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

  renderSportPills();
  renderEvents();
  renderSignals();
}

function renderSportPills(){
  if(!state)return;
  // Count events per sport (only PM-matched events)
  const sportCounts={};
  for(const ev of state.events){
    if(!Object.keys(ev.markets).some(k=>!k.startsWith('__')&&ev.markets[k].polymarket))continue;
    const s=ev.sport||'unknown';
    sportCounts[s]=(sportCounts[s]||0)+1;
  }
  const sorted=Object.entries(sportCounts).sort((a,b)=>b[1]-a[1]);
  const total=sorted.reduce((s,e)=>s+e[1],0);
  const el=document.getElementById('sport-filter');
  if(sorted.length<=1){el.innerHTML='';return;}
  el.innerHTML='<div class="sport-pill'+(sportFilter==='all'?' active':'')+'" onclick="setSportFilter(\'all\')">All<span class="count">'+total+'</span></div>'+sorted.map(([s,c])=>{
    return '<div class="sport-pill'+(sportFilter===s?' active':'')+'" onclick="setSportFilter(\''+s+'\')">'+sportIcon(s)+' '+sportLabel(s)+'<span class="count">'+c+'</span></div>';
  }).join('');
}

function setSportFilter(s){sportFilter=s;renderSportPills();renderEvents();}

function renderEvents(){
  if(!state)return;
  let evs=[...state.events].sort((a,b)=>{
    if(a.status==='live'&&b.status!=='live')return -1;
    if(b.status==='live'&&a.status!=='live')return 1;
    const aMulti=Object.values(a.markets).some(m=>Object.keys(m).length>1);
    const bMulti=Object.values(b.markets).some(m=>Object.keys(m).length>1);
    if(aMulti&&!bMulti)return -1;
    if(bMulti&&!aMulti)return 1;
    const aSrc=(a.sources||[]).length;const bSrc=(b.sources||[]).length;
    if(aSrc!==bSrc)return bSrc-aSrc;
    return a.id<b.id?-1:a.id>b.id?1:0;
  });

  // Hide events with no Polymarket markets
  evs=evs.filter(e=>Object.keys(e.markets).some(k=>!k.startsWith('__')&&e.markets[k].polymarket));

  // Sport filter
  if(sportFilter!=='all')evs=evs.filter(e=>(e.sport||'unknown')===sportFilter);

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

  // Group by sport
  const groups={};
  for(const ev of evs.slice(0,150)){
    const s=ev.sport||'unknown';
    if(!groups[s])groups[s]=[];
    groups[s].push(ev);
  }
  // Sort groups: live events first, then by count
  const groupOrder=Object.entries(groups).sort((a,b)=>{
    const aLive=a[1].filter(e=>e.status==='live').length;
    const bLive=b[1].filter(e=>e.status==='live').length;
    if(aLive!==bLive)return bLive-aLive;
    return b[1].length-a[1].length;
  });

  let html='';
  for(const [sport,sportEvs] of groupOrder){
    const liveCount=sportEvs.filter(e=>e.status==='live').length;
    const liveTag=liveCount>0?' <span style="color:var(--red);font-size:9px">'+liveCount+' LIVE</span>':'';
    html+='<div class="sport-group-header"><span class="sport-icon">'+sportIcon(sport)+'</span>'+sportLabel(sport)+' <span class="sport-count">('+sportEvs.length+')'+liveTag+'</span></div>';
    html+=sportEvs.map(ev=>{
    const isLive=ev.status==='live';
    const isOpen=openEvents.has(ev.id);
    const sc=ev.score?ev.score.home+' - '+ev.score.away:'';
    const elapsed=ev.elapsed||'';
    // Countdown for scheduled (non-live) events
    let countdown='';
    if(ev.status!=='live'&&ev.startTime>0){
      const diffMs=ev.startTime-Date.now();
      if(diffMs>0){
        const d=Math.floor(diffMs/86400000);
        const h=Math.floor((diffMs%86400000)/3600000);
        const m=Math.floor((diffMs%3600000)/60000);
        countdown=d>0?d+'d '+h+'h':h>0?h+'h '+m+'m':m+'m';
      } else {
        countdown='starting...';
      }
    }
    const mkeys=Object.keys(ev.markets).filter(k=>!k.startsWith('__')).sort();
    const srcCount=ev.sources?ev.sources.length:1;
    const pmKeys_count=mkeys.filter(k=>ev.markets[k].polymarket).length;
    const mktCount=pmKeys_count;

    // Source badges
    const SRC_MAP={polymarket:{label:'PM',cls:'pm'},onexbet:{label:'1xBet',cls:'xbet'},flashscore:{label:'FS',cls:'fs'}};
    const badges=(ev.sources||[]).map(s=>{const m=SRC_MAP[s];return m?'<span class="src-badge '+m.cls+'">'+m.label+'</span>':'';}).join('');

    // Get FlashScore live score for this event
    const fsScore=ev.markets['__score']&&ev.markets['__score'].flashscore;
    const fsScoreText=fsScore?Math.floor(fsScore.value/100)+' - '+(fsScore.value%100):'';

    let oddsHtml='<div class="odds-row"><div class="odds-header">Market</div><div class="odds-header" style="text-align:center;color:var(--blue)">PM (%)</div><div class="odds-header" style="text-align:center;color:var(--yellow)">1xBet (%)</div><div class="odds-header" style="text-align:center;color:var(--cyan)">FS Live</div></div>';

    // Only show markets that have Polymarket odds, ML first then draw then rest
    const pmKeys=mkeys.filter(k=>ev.markets[k].polymarket).sort((a,b)=>{
      const order=k=>{if(k.startsWith('ml_home'))return 0;if(k.startsWith('ml_away'))return 1;if(k.startsWith('draw'))return 2;return 3;};
      const d=order(a)-order(b);if(d!==0)return d;return a<b?-1:a>b?1:0;
    });
    for(const k of pmKeys.slice(0,15)){
      const srcs=ev.markets[k];
      const pm=srcs.polymarket;
      const xb=srcs.onexbet;

      // Convert to implied probability for divergence check
      const toProb=(o)=>{if(!o)return null;return 1/o.value;};
      const pmProb=toProb(pm);
      const xbProb=toProb(xb);
      const probs=[pmProb,xbProb].filter(p=>p!==null);
      let hasDivergence=false;
      if(probs.length>=2){
        const maxP=Math.max(...probs);const minP=Math.min(...probs);
        if(maxP-minP>0.10)hasDivergence=true;
      }

      // PM: show probability % as main, decimal underneath
      const fmtPm=(o)=>{if(!o)return '<div class="odds-cell" style="color:var(--text2)">\\u2014</div>';const pct=(1/o.value*100);return '<div class="odds-cell pm'+(hasDivergence?' divergent':'')+'">'+pct.toFixed(1)+'%<br><span style="font-size:9px;color:var(--text2)">'+o.value.toFixed(2)+'</span></div>';};
      // 1xBet: show probability % as main, decimal underneath (same as PM)
      const fmtXb=(o)=>{if(!o)return '<div class="odds-cell" style="color:var(--text2)">\\u2014</div>';const pct=(1/o.value*100);return '<div class="odds-cell xbet'+(hasDivergence?' divergent':'')+'">'+pct.toFixed(1)+'%<br><span style="font-size:9px;color:var(--text2)">'+o.value.toFixed(2)+'</span></div>';};
      // FS: show live score in every row
      const fsFmt='<div class="odds-cell fs">'+(fsScoreText||'\\u2014')+'</div>';

      oddsHtml+='<div class="odds-row"><div class="odds-label">'+fmtKey(k)+'</div>'+fmtPm(pm)+fmtXb(xb)+fsFmt+'</div>';
    }

    const srcText=srcCount===1?'1 source':srcCount+' sources';
    const pmLink=ev.pmSlug?'<a href="https://polymarket.com/event/'+ev.pmSlug+'" target="_blank" rel="noopener" class="pm-link" title="Open on Polymarket" onclick="event.stopPropagation()">&#x2197;</a>':'';
    const rightInfo=sc?'<span class="ev-score">'+sc+'</span>'+(elapsed?'<span class="ev-elapsed">'+elapsed+'</span>':''):countdown?'<span class="ev-countdown">\u23F0 '+countdown+'</span>':'';
    return '<div class="ev'+(isLive?' live':'')+(isOpen?' open':'')+'" data-id="'+ev.id+'"><div class="ev-top" onclick="toggleEv(&quot;'+ev.id+'&quot;)"><div><span class="ev-teams">'+ev.home+' vs '+ev.away+'</span>'+pmLink+(isLive?' <span class="ev-live-badge">\u25CF LIVE</span>':'')+'<span class="src-badges">'+badges+'</span><br><span class="ev-league">'+ev.league+' \u00B7 '+mktCount+' markets \u00B7 '+srcText+'</span></div><div>'+rightInfo+'</div></div><div class="ev-odds">'+oddsHtml+'</div></div>';
  }).join('');
  }
  el.innerHTML=html;
}

function renderSignals(){
  if(!state)return;
  const el=document.getElementById('signals');
  const opps=state.tradeSignals||[];
  document.getElementById('sig-count').textContent=opps.length;

  if(opps.length===0){el.innerHTML='<div class="empty-state">No opportunities detected.<br>Opportunities appear when PM and 1xBet odds diverge by 3+pp.</div>';return;}

  el.innerHTML=opps.map(o=>{
    const isYes=o.action==='BUY_YES';
    const activeFor=Math.floor((Date.now()-o.firstSeen)/1000);
    const activeStr=activeFor<60?activeFor+'s':Math.floor(activeFor/60)+'m '+activeFor%60+'s';
    const scoreTxt=o.score?o.score.home+'-'+o.score.away:'';
    const statusBadge=o.eventStatus==='live'?'<span style="color:var(--red);font-weight:700;font-size:9px"> \u25CF LIVE</span>':'';

    // Edge trend from history
    let trendIcon='';
    if(o.edgeHistory&&o.edgeHistory.length>=3){
      const recent=o.edgeHistory.slice(-3);
      const avg1=(recent[0]+recent[1])/2;
      const last=recent[2];
      if(last>avg1+0.5)trendIcon='<span class="opp-trend" style="color:var(--green)">\u2191</span>';
      else if(last<avg1-0.5)trendIcon='<span class="opp-trend" style="color:var(--red)">\u2193</span>';
      else trendIcon='<span class="opp-trend" style="color:var(--text2)">\u2192</span>';
    }

    // Probability comparison bar
    const pmPct=Math.min(100,Math.max(0,o.polyProb));
    const xbPct=Math.min(100,Math.max(0,o.xbetProb));
    const bar='<div class="opp-bar"><span style="color:var(--blue);min-width:40px">PM '+pmPct.toFixed(1)+'%</span><div class="opp-bar-track"><div class="opp-bar-pm" style="width:'+pmPct+'%"></div><div class="opp-bar-xb" style="left:'+xbPct+'%"></div></div><span style="color:var(--yellow);min-width:40px;text-align:right">'+xbPct.toFixed(1)+'% 1xB</span></div>';

    // Data freshness
    const pmFresh=o.polyAgeMs<5000?'<span class="val" style="color:var(--green)">&lt;5s</span>':o.polyAgeMs<30000?'<span class="val">'+Math.round(o.polyAgeMs/1000)+'s</span>':'<span class="val" style="color:var(--red)">'+Math.round(o.polyAgeMs/1000)+'s</span>';
    const xbFresh=o.xbetAgeMs<10000?'<span class="val" style="color:var(--green)">&lt;10s</span>':o.xbetAgeMs<60000?'<span class="val">'+Math.round(o.xbetAgeMs/1000)+'s</span>':'<span class="val" style="color:var(--red)">'+Math.round(o.xbetAgeMs/1000)+'s</span>';

    return '<div class="opp-card '+o.quality+'"><div class="opp-top"><div><span class="opp-action '+(isYes?'yes':'no')+'">'+o.action.replace('_',' ')+'</span> <span class="opp-quality '+o.quality+'">'+o.quality.toUpperCase()+'</span></div><div style="text-align:right"><span class="opp-edge">'+o.edge.toFixed(1)+'pp</span>'+trendIcon+'</div></div><div class="opp-match">'+o.homeTeam+' vs '+o.awayTeam+(scoreTxt?' <span style="color:var(--green)">'+scoreTxt+'</span>':'')+statusBadge+'</div><div class="opp-market">'+fmtKey(o.market)+'</div>'+bar+'<div class="opp-meta"><span>Active: <span class="val">'+activeStr+'</span></span><span>PM: '+pmFresh+'</span><span>1xBet: '+xbFresh+'</span></div>'+(o.qualityNote?'<div style="font-size:9px;color:var(--text2);margin-top:3px;font-style:italic">'+o.qualityNote+'</div>':'')+'</div>';
  }).join('');
}

function toggleEv(id){openEvents.has(id)?openEvents.delete(id):openEvents.add(id);renderEvents();}
function fmtKey(k){
  return k
    .replace(/_ft$/,'')
    .replace(/^ml_home$/,'ML Home')
    .replace(/^ml_away$/,'ML Away')
    .replace(/^draw$/,'Draw')
    .replace(/^dc_1x$/,'DC 1X')
    .replace(/^dc_12$/,'DC 12')
    .replace(/^dc_x2$/,'DC X2')
    .replace(/^o_(\d+)_(\d+)$/,'Over $1.$2')
    .replace(/^u_(\d+)_(\d+)$/,'Under $1.$2')
    .replace(/^handicap_home$/,'Handicap Home')
    .replace(/^handicap_away$/,'Handicap Away')
    .replace(/^btts_yes$/,'BTTS Yes')
    .replace(/^btts_no$/,'BTTS No')
    .replace(/_/g,' ')
    .replace(/\b\w/g,c=>c.toUpperCase());
}

connect();
</script>
</body>
</html>`;
