export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PolyMoney</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#090d15;--bg-card:#0f1520;--bg-hover:#141c2b;
  --border:#1a2332;--border-h:#253244;
  --text:#d4dae4;--text-dim:#7a869a;--text-muted:#4a5568;
  --blue:#3b82f6;--green:#10b981;--red:#ef4444;--amber:#f59e0b;
  --mono:'SF Mono','Cascadia Code','Fira Code',monospace;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;font-size:12px;overflow:hidden;height:100vh;line-height:1.4}

/* ─── TOP BAR ─── */
.bar{display:flex;align-items:center;height:40px;padding:0 16px;background:var(--bg-card);border-bottom:1px solid var(--border);gap:16px}
.brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.5px;flex-shrink:0}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);transition:background .3s}
.dot.off{background:var(--red)}
.tabs{display:flex;gap:0;margin-left:8px}
.tab{padding:10px 14px;font-size:11px;font-weight:600;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;user-select:none;letter-spacing:.5px;text-transform:uppercase}
.tab:hover{color:var(--text-dim)}
.tab.on{color:var(--text);border-bottom-color:var(--blue)}
.tab .tc{font-size:9px;font-weight:400;opacity:.5;margin-left:3px}
.right{display:flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0}
.adapters{display:flex;gap:4px}
.ad{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);padding:2px 8px;background:rgba(255,255,255,.02);border-radius:12px}
.ad-dot{width:4px;height:4px;border-radius:50%}
.ad-ok{background:var(--green)}.ad-err{background:var(--red)}.ad-warn{background:var(--amber)}
.clock{font-size:10px;color:var(--text-muted);font-family:var(--mono)}

/* ─── PAGES ─── */
.wrap{height:calc(100vh - 40px);overflow:hidden}
.page{height:100%;overflow-y:auto;display:none;padding:8px 12px}
.page.on{display:block}

/* ─── SPORT GROUP ─── */
.grp{margin-bottom:2px}
.grp-hd{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:11px;font-weight:600;color:var(--text-dim);cursor:pointer;user-select:none;border-radius:4px;transition:background .1s}
.grp-hd:hover{background:rgba(255,255,255,.03)}
.grp-hd .arrow{font-size:8px;color:var(--text-muted);transition:transform .15s;width:12px;text-align:center}
.grp-hd.open .arrow{transform:rotate(90deg)}
.grp-hd .cnt{color:var(--text-muted);font-weight:400;font-size:10px}
.grp-body{display:none;padding:0 0 4px 0}
.grp-hd.open+.grp-body{display:block}

/* ─── EVENT CARD ─── */
.ev{margin:1px 0;border-radius:4px;background:var(--bg-card);border:1px solid transparent;transition:border-color .1s}
.ev:hover{border-color:var(--border)}
.ev.live{border-left:2px solid var(--red)}
.ev-row{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;gap:8px}
.ev-l{min-width:0;flex:1}
.ev-teams{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-meta{display:flex;align-items:center;gap:6px;margin-top:1px;font-size:10px;color:var(--text-muted)}
.ev-r{display:flex;align-items:center;gap:8px;flex-shrink:0}
.ev-score{font-family:var(--mono);font-size:14px;font-weight:700;color:var(--green)}
.ev-time{font-size:10px;color:var(--amber);font-weight:600}
.ev-cd{font-size:10px;color:var(--text-muted);font-family:var(--mono)}
.badge-live{font-size:8px;font-weight:700;color:var(--red);display:flex;align-items:center;gap:3px}
.badge-live::before{content:'';width:4px;height:4px;border-radius:50%;background:var(--red);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.src-tag{font-size:8px;font-weight:600;padding:1px 4px;border-radius:2px;letter-spacing:.3px}
.src-tag.pm{background:rgba(59,130,246,.1);color:var(--blue)}
.src-tag.xbet{background:rgba(245,158,11,.1);color:var(--amber)}
.src-tag.kambi{background:rgba(16,185,129,.1);color:var(--green)}
.src-tag.pinn{background:rgba(245,158,11,.1);color:#f59e0b}
.src-tag.thesports{background:rgba(139,92,246,.1);color:#8b5cf6}
.src-tag.sofascore{background:rgba(139,92,246,.1);color:#8b5cf6}
.lnk{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;text-decoration:none;font-size:10px;transition:background .15s}
.lnk-pm{background:rgba(59,130,246,.08);color:var(--blue)}
.lnk-pm:hover{background:rgba(59,130,246,.2)}
.lnk-xb{background:rgba(245,158,11,.08);color:var(--amber)}
.lnk-xb:hover{background:rgba(245,158,11,.2)}

/* ─── ODDS TABLE ─── */
.ev-odds{display:none;padding:4px 10px 8px;border-top:1px solid var(--border);background:rgba(0,0,0,.15)}
.ev.open .ev-odds{display:block}
.odds-tbl{width:100%;border-collapse:collapse;font-size:10px;font-family:var(--mono)}
.odds-tbl th{padding:3px 4px;font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:center;border-bottom:1px solid var(--border)}
.odds-tbl th:first-child{text-align:left}
.odds-tbl td{padding:3px 4px;text-align:center;border-bottom:1px solid rgba(255,255,255,.02)}
.odds-tbl td:first-child{text-align:left;color:var(--text-dim);font-weight:500;font-family:-apple-system,sans-serif}
.c-pm{color:var(--blue)}.c-xb{color:var(--amber)}.c-kb{color:var(--green)}.c-pn{color:var(--text-dim)}.c-ts{color:#ec4899}.c-sf{color:#8b5cf6}
.edge-hot{color:var(--green);font-weight:700;background:rgba(16,185,129,.06);border-radius:2px}
.edge-pos{color:var(--green)}.edge-neg{color:var(--red)}

/* ─── LOGS TABLE ─── */
.log-tbl{width:100%;border-collapse:collapse;font-size:11px;font-family:var(--mono)}
.log-tbl th{padding:5px 6px;font-size:9px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:center;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg)}
.log-tbl th:first-child{text-align:left}
.log-tbl td{padding:4px 6px;text-align:center;border-bottom:1px solid rgba(255,255,255,.02)}
.log-tbl td:first-child{text-align:left;font-family:-apple-system,sans-serif;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.win-cell{color:var(--green);font-weight:700}
.fast-cell{color:var(--text)}
.slow-cell{color:var(--amber)}
.vslow-cell{color:var(--red)}
.miss-cell{color:var(--border-h)}
.log-age{color:var(--text-muted);font-size:9px;margin-right:4px}

/* ─── BOT TAB ─── */
.bot-ctl{padding:12px;border-bottom:1px solid var(--border)}
.start-btn{width:100%;padding:12px;border-radius:6px;border:none;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;transition:all .15s;text-transform:uppercase}
.start-btn.off{background:linear-gradient(135deg,#10b981,#059669);color:#fff}
.start-btn.off:hover{background:linear-gradient(135deg,#34d399,#10b981)}
.start-btn.on{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff}
.start-btn.on:hover{background:linear-gradient(135deg,#f87171,#ef4444)}
.bot-status{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.badge{font-size:9px;font-weight:700;padding:3px 8px;border-radius:3px;letter-spacing:.3px}
.badge-on{background:rgba(16,185,129,.12);color:var(--green)}
.badge-off{background:rgba(100,116,139,.1);color:var(--text-muted)}
.badge-armed{background:rgba(239,68,68,.12);color:var(--red)}
.badge-pnl{font-family:var(--mono)}

/* ─── OPEN POSITIONS ─── */
.pos-section{padding:8px 12px;border-bottom:1px solid var(--border)}
.section-hd{font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.pos-card{background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:8px 10px;margin-bottom:4px}
.pos-top{display:flex;justify-content:space-between;align-items:center}
.pos-match{font-size:11px;font-weight:600}
.pos-pnl{font-family:var(--mono);font-size:12px;font-weight:700}
.pos-detail{font-size:10px;color:var(--text-muted);font-family:var(--mono);margin-top:2px}
.pos-bar{height:2px;background:var(--border);border-radius:1px;margin-top:4px;overflow:hidden}
.pos-fill{height:100%;border-radius:1px;transition:width .3s}

/* ─── GOAL LOG ─── */
.goal-log{padding:0 12px}
.gl-row{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.02)}
.gl-top{display:flex;align-items:center;gap:6px}
.gl-action{font-size:8px;font-weight:700;padding:2px 5px;border-radius:2px;letter-spacing:.3px;flex-shrink:0}
.gl-buy{background:rgba(16,185,129,.1);color:var(--green)}
.gl-dry{background:rgba(59,130,246,.1);color:var(--blue)}
.gl-skip{background:rgba(100,116,139,.06);color:var(--text-muted)}
.gl-pend{background:rgba(245,158,11,.1);color:var(--amber)}
.gl-match{font-size:11px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gl-age{font-size:9px;color:var(--text-muted);flex-shrink:0}
.gl-info{font-size:10px;color:var(--text-muted);font-family:var(--mono);margin-top:2px;display:flex;gap:8px}
.gl-trade{font-size:10px;font-family:var(--mono);color:var(--green);margin-top:1px}
.gl-reason{font-size:10px;color:var(--text-muted);margin-top:1px}

/* ─── EMPTY ─── */
.empty{text-align:center;color:var(--text-muted);padding:40px 20px;font-size:11px}

/* ─── SCROLLBAR ─── */
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
::-webkit-scrollbar-thumb:hover{background:var(--border-h)}
</style>
</head>
<body>

<div class="bar">
  <div class="brand"><div class="dot" id="ws-dot"></div><span style="color:var(--blue)">POLY</span><span style="color:var(--green)">MONEY</span></div>
  <div class="tabs" id="tabs">
    <div class="tab on" onclick="go('live')">Live<span class="tc" id="tc-live">0</span></div>
    <div class="tab" onclick="go('upcoming')">Upcoming<span class="tc" id="tc-up">0</span></div>
    <div class="tab" onclick="go('logs')">Logs<span class="tc" id="tc-logs">0</span></div>
    <div class="tab" onclick="go('bot')">Bot</div>
  </div>
  <div class="right">
    <div class="adapters" id="adapters"></div>
    <div class="clock" id="clock">--:--</div>
  </div>
</div>

<div class="wrap">
  <div class="page on" id="p-live"></div>
  <div class="page" id="p-upcoming"></div>
  <div class="page" id="p-logs"></div>
  <div class="page" id="p-bot"></div>
</div>

<script>
var ws,state=null,page='live',openEvents=new Set(),openGroups=new Set();

/* ─── Sport mappings ─── */
var SG={soccer:'Soccer',football:'Soccer',epl:'Soccer',sea:'Soccer',lal:'Soccer',bun:'Soccer',fl1:'Soccer',ucl:'Soccer',uel:'Soccer',mls:'Soccer',arg:'Soccer',mex:'Soccer',ere:'Soccer',den:'Soccer',tur:'Soccer',crint:'Soccer',spl:'Soccer',rpl:'Soccer',bra:'Soccer',por:'Soccer',sco:'Soccer',bel:'Soccer',sui:'Soccer',jpn:'Soccer',kor:'Soccer',chn:'Soccer',col:'Soccer',dfb:'Soccer',copa:'Soccer',itc:'Soccer',aus:'Soccer',sud:'Soccer',lib:'Soccer',cde:'Soccer',cdr:'Soccer',rus:'Soccer',rusixnat:'Soccer',rusrp:'Soccer',rutopft:'Soccer',ruurc:'Soccer',basketball:'Basketball',nba:'Basketball',ncaab:'Basketball',wnba:'Basketball',cbb:'Basketball',cwbb:'Basketball',bkarg:'Basketball',bkligend:'Basketball',bknbl:'Basketball',bkkbl:'Basketball',bkseriea:'Basketball',bkfr1:'Basketball',ice_hockey:'Hockey',nhl:'Hockey',khl:'Hockey',shl:'Hockey',ahl:'Hockey',mwoh:'Hockey',wwoh:'Hockey',hok:'Hockey',tennis:'Tennis',atp:'Tennis',wta:'Tennis',american_football:'Am. Football',nfl:'Am. Football',cfb:'Am. Football',baseball:'Baseball',mlb:'Baseball',kbo:'Baseball',npb:'Baseball',mma:'MMA',boxing:'MMA',ufc:'MMA',cs2:'Esports',esports_cs2:'Esports',dota2:'Esports',esports_dota2:'Esports',lol:'Esports',esports_lol:'Esports',val:'Esports',r6siege:'Esports',esports_rl:'Esports',esports:'Esports',cricket:'Cricket',craus:'Cricket',rugby:'Rugby',golf:'Golf',table_tennis:'Table Tennis',volleyball:'Volleyball',handball:'Handball'};
var GI={'Soccer':'\\u26BD','Basketball':'\\uD83C\\uDFC0','Hockey':'\\uD83C\\uDFD2','Tennis':'\\uD83C\\uDFBE','Am. Football':'\\uD83C\\uDFC8','Baseball':'\\u26BE','MMA':'\\uD83E\\uDD4A','Esports':'\\uD83C\\uDFAE','Cricket':'\\uD83C\\uDFCF','Rugby':'\\uD83C\\uDFC9','Golf':'\\u26F3','Table Tennis':'\\uD83C\\uDFD3','Volleyball':'\\uD83C\\uDFD0','Handball':'\\uD83E\\uDD3E'};
var SL={epl:'EPL',sea:'Serie A',lal:'La Liga',bun:'Bundesliga',fl1:'Ligue 1',ucl:'UCL',uel:'Europa',mls:'MLS',nba:'NBA',ncaab:'NCAAB',nhl:'NHL',khl:'KHL',atp:'ATP',wta:'WTA',nfl:'NFL',cfb:'CFB',mlb:'MLB',ufc:'UFC',cs2:'CS2',lol:'LoL',dota2:'Dota 2'};
function sg(s){return SG[s]||SG[(s||'').split('_')[0]]||s||'Other';}
function gi(g){return GI[g]||'\\uD83C\\uDFC6';}
function sl(s){return SL[s]||s;}
function srcN(s){return s==='polymarket'||s==='pm-sports-ws'?'PM':s==='onexbet'?'1xBet':s==='kambi'?'Kambi':s==='sofascore'?'Sofa':s==='thesports'?'TSprt':s==='pinnacle'?'Pinn':s==='flashscore'?'Flash':s;}

/* ─── WebSocket ─── */
function connect(){
  var p=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(p+'://'+location.host);
  ws.onopen=function(){document.getElementById('ws-dot').className='dot';};
  ws.onmessage=function(e){state=JSON.parse(e.data);render();};
  ws.onclose=function(){document.getElementById('ws-dot').className='dot off';setTimeout(connect,2000);};
}

/* ─── Navigation ─── */
function go(p){
  page=p;
  var names=['live','upcoming','logs','bot'];
  var tabs=document.getElementById('tabs').children;
  for(var i=0;i<names.length;i++){
    tabs[i].className=names[i]===p?'tab on':'tab';
    document.getElementById('p-'+names[i]).className=names[i]===p?'page on':'page';
  }
}

/* ─── Helpers ─── */
function hasPM(ev){return Object.keys(ev.markets).some(function(k){return !k.startsWith('__')&&ev.markets[k].polymarket;});}
function getEvents(){
  if(!state)return{live:[],up:[]};
  var live=[],up=[];
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(!hasPM(ev))continue;
    if(ev.status==='live')live.push(ev);
    else up.push(ev);
  }
  up.sort(function(a,b){return(a.startTime||0)-(b.startTime||0);});
  return{live:live,up:up};
}
function groupBy(arr){
  var g={};
  for(var i=0;i<arr.length;i++){var k=sg(arr[i].sport);if(!g[k])g[k]=[];g[k].push(arr[i]);}
  return Object.entries(g).sort(function(a,b){if(a[0]==='Soccer')return -1;if(b[0]==='Soccer')return 1;return b[1].length-a[1].length;});
}
function ageStr(ms){var s=Math.round((Date.now()-ms)/1000);return s<60?s+'s':s<3600?Math.floor(s/60)+'m':Math.floor(s/3600)+'h';}

/* ─── Render ─── */
function render(){
  if(!state)return;
  var d=getEvents();
  document.getElementById('tc-live').textContent=d.live.length;
  document.getElementById('tc-up').textContent=d.up.length;
  document.getElementById('tc-logs').textContent=(state.speedLog||[]).length;
  document.getElementById('clock').textContent=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  renderAdapters();
  renderEvents(d.live,'p-live',true);
  renderEvents(d.up,'p-upcoming',false);
  renderLogs();
  renderBot();
}

function renderAdapters(){
  var h='';
  var entries=Object.entries(state.adapters);
  for(var i=0;i<entries.length;i++){
    var id=entries[i][0],s=entries[i][1];
    var cls=s==='connected'?'ad-ok':s==='error'?'ad-err':'ad-warn';
    h+='<div class="ad"><div class="ad-dot '+cls+'"></div>'+srcN(id)+'</div>';
  }
  document.getElementById('adapters').innerHTML=h;
}

/* ─── Event List (Live + Upcoming) ─── */
function renderEvents(evs,containerId,isLive){
  var el=document.getElementById(containerId);
  if(evs.length===0){el.innerHTML='<div class="empty">No '+(isLive?'live':'upcoming')+' events</div>';return;}
  var h='';
  var groups=groupBy(evs);
  for(var g=0;g<groups.length;g++){
    var grp=groups[g][0],items=groups[g][1];
    var gk=(isLive?'l_':'u_')+grp;
    var isOpen=openGroups.has(gk);
    h+='<div class="grp"><div class="grp-hd'+(isOpen?' open':'')+'" onclick="tg(\\''+gk.replace(/'/g,"\\\\'")+'\\')"><span class="arrow">\\u25B6</span>'+gi(grp)+' '+grp+' <span class="cnt">'+items.length+'</span></div>';
    h+='<div class="grp-body">';
    if(isOpen){for(var i=0;i<items.length;i++)h+=renderEv(items[i],isLive);}
    h+='</div></div>';
  }
  el.innerHTML=h;
}

function renderEv(ev,isLive){
  var isOpen=openEvents.has(ev.id);
  var sc=ev.score?ev.score.home+' - '+ev.score.away:'';
  var elapsed=ev.elapsed||'';
  var cd='';
  if(!isLive&&ev.startTime>0){
    var diff=ev.startTime-Date.now();
    if(diff>0){var dd=Math.floor(diff/86400000),hh=Math.floor((diff%86400000)/3600000),mm=Math.floor((diff%3600000)/60000);cd=dd>0?dd+'d '+hh+'h':hh>0?hh+'h '+mm+'m':mm+'m';}
    else cd='starting';
  }
  var mkeys=Object.keys(ev.markets).filter(function(k){return !k.startsWith('__')&&ev.markets[k].polymarket;});
  var srcMap={polymarket:{l:'PM',c:'pm'},onexbet:{l:'1xBet',c:'xbet'},kambi:{l:'Kambi',c:'kambi'},pinnacle:{l:'Pinn',c:'pinn'},thesports:{l:'TSprt',c:'thesports'},sofascore:{l:'Sofa',c:'sofascore'}};
  var badges='';
  if(ev.sources){for(var s=0;s<ev.sources.length;s++){var m=srcMap[ev.sources[s]];if(m)badges+='<span class="src-tag '+m.c+'">'+m.l+'</span> ';}}
  var pmLink=ev.pmSlug?'<a href="https://polymarket.com/event/'+ev.pmSlug+'" target="_blank" rel="noopener" class="lnk lnk-pm" onclick="event.stopPropagation()">\\u2197</a>':'';
  var xbLink=ev.xbetUrl?'<a href="'+ev.xbetUrl+'" target="_blank" rel="noopener" class="lnk lnk-xb" onclick="event.stopPropagation()">\\u2197</a>':'';
  var rHtml='';
  if(isLive){rHtml=(sc?'<span class="ev-score">'+sc+'</span>':'')+(elapsed?'<span class="ev-time">'+elapsed+'</span>':'');}
  else{rHtml=cd?'<span class="ev-cd">'+cd+'</span>':'';}
  return '<div class="ev'+(isLive?' live':'')+(isOpen?' open':'')+'" data-id="'+ev.id+'">'
    +'<div class="ev-row" onclick="te(\\''+ev.id.replace(/'/g,"\\\\'")+'\\')"><div class="ev-l"><div class="ev-teams">'+ev.home+' vs '+ev.away+' '+pmLink+xbLink+'</div>'
    +'<div class="ev-meta">'+(isLive?'<span class="badge-live">LIVE</span>':'')+badges+'<span>'+sl(ev.sport)+'</span><span>'+mkeys.length+'m</span></div>'
    +'</div><div class="ev-r">'+rHtml+'</div></div>'
    +'<div class="ev-odds">'+renderOdds(ev,mkeys)+'</div></div>';
}

function renderOdds(ev,mkeys){
  var sorted=mkeys.slice().sort(function(a,b){
    function o(k){if(k.startsWith('ml_home'))return 0;if(k.startsWith('ml_away'))return 1;if(k.startsWith('draw'))return 2;return 3;}
    var d=o(a)-o(b);if(d!==0)return d;return a<b?-1:a>b?1:0;
  });
  var h='<table class="odds-tbl"><thead><tr><th>Market</th><th class="c-pm">PM</th><th class="c-xb">1xBet</th><th class="c-kb">Kambi</th><th class="c-pn">Pinn</th><th class="c-ts">TSprt</th><th class="c-sf">Sofa</th><th>Edge</th></tr></thead><tbody>';
  for(var i=0;i<Math.min(sorted.length,15);i++){
    var k=sorted[i],srcs=ev.markets[k];
    var pm=srcs.polymarket,xb=srcs.onexbet,kb=srcs.kambi,pn=srcs.pinnacle,ts=srcs.thesports,sf=srcs.sofascore;
    var pmP=pm?(1/pm.value*100):null,xbP=xb?(1/xb.value*100):null,kbP=kb?(1/kb.value*100):null,pnP=pn?(1/pn.value*100):null,tsP=ts?(1/ts.value*100):null,sfP=sf?(1/sf.value*100):null;
    var allSec=[xbP,kbP,pnP,tsP,sfP].filter(function(v){return v!==null;});
    var secBest=allSec.length>0?Math.max.apply(null,allSec):null;
    var edge=(pmP!==null&&secBest!==null)?secBest-pmP:null;
    var edgeAbs=edge!==null?Math.abs(edge):0;
    var eCls=edgeAbs>=3?'edge-hot':edge!==null&&edge>0?'edge-pos':'edge-neg';
    h+='<tr><td>'+fmtKey(k)+'</td>'
      +'<td class="c-pm">'+(pmP!==null?pmP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="c-xb">'+(xbP!==null?xbP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="c-kb">'+(kbP!==null?kbP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="c-pn">'+(pnP!==null?pnP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="c-ts">'+(tsP!==null?tsP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="c-sf">'+(sfP!==null?sfP.toFixed(1)+'%':'\\u2014')+'</td>'
      +'<td class="'+eCls+'">'+(edge!==null?(edge>0?'+':'')+edge.toFixed(1)+'%':'\\u2014')+'</td></tr>';
  }
  h+='</tbody></table>';
  return h;
}

/* ─── Logs Tab (Source Speed Race) ─── */
function renderLogs(){
  var el=document.getElementById('p-logs');
  var sl=state.speedLog||[];
  if(sl.length===0){el.innerHTML='<div class="empty">No source races yet — waiting for score changes across multiple sources</div>';return;}
  var allSrcs={};
  for(var i=0;i<sl.length;i++){var times=sl[i].times||[];for(var j=0;j<times.length;j++)allSrcs[times[j].src]=1;}
  var srcList=Object.keys(allSrcs).sort();
  var h='<table class="log-tbl"><thead><tr><th>Match</th><th>Score</th>';
  for(var si=0;si<srcList.length;si++)h+='<th>'+srcN(srcList[si])+'</th>';
  h+='</tr></thead><tbody>';
  for(var i=0;i<Math.min(sl.length,80);i++){
    var r=sl[i];
    var srcMs={},times=r.times||[],minMs=Infinity;
    for(var j=0;j<times.length;j++){srcMs[times[j].src]=times[j].ms;if(times[j].ms<minMs)minMs=times[j].ms;}
    h+='<tr><td><span class="log-age">'+ageStr(r.ts)+'</span>'+r.match+'</td>';
    h+='<td style="color:var(--amber);font-weight:700">'+r.score+'</td>';
    for(var si=0;si<srcList.length;si++){
      var ms=srcMs[srcList[si]];
      if(ms===undefined){h+='<td class="miss-cell">\\u2014</td>';}
      else{
        var isWin=ms===minMs;
        var delta=ms-minMs;
        var cls=isWin?'win-cell':delta<500?'fast-cell':delta<2000?'slow-cell':'vslow-cell';
        var txt=isWin?'\\u2714 0s':'+'+(delta<1000?(delta/1000).toFixed(1):(delta/1000).toFixed(0))+'s';
        h+='<td class="'+cls+'">'+txt+'</td>';
      }
    }
    h+='</tr>';
  }
  h+='</tbody></table>';
  el.innerHTML=h;
}

/* ─── Bot Tab ─── */
function renderBot(){
  var el=document.getElementById('p-bot');
  var trading=state.trading;
  if(!trading){el.innerHTML='<div class="empty">Trading not configured — no POLY_PRIVATE_KEY</div>';return;}
  var gt=trading.goalTrader||{};
  var isActive=gt.enabled&&trading.armed;
  var h='';

  /* ─ Control ─ */
  h+='<div class="bot-ctl">';
  h+='<button class="start-btn '+(isActive?'on':'off')+'" onclick="toggleBot()">'+( isActive?'\\u25A0  STOP TRADING':'\\u25B6  START AUTO TRADING')+'</button>';
  h+='<div class="bot-status">';
  h+='<span class="badge '+(trading.armed?'badge-armed':'badge-off')+'">'+(trading.armed?'ARMED':'DISARMED')+'</span>';
  h+='<span class="badge '+(gt.enabled?'badge-on':'badge-off')+'">GT '+(gt.enabled?'ON':'OFF')+'</span>';
  if(state.fastestSource)h+='<span class="badge badge-on" style="color:var(--amber);background:rgba(245,158,11,.08)">\\u26A1 '+srcN(state.fastestSource)+'</span>';
  var tc=gt.totalTrades||0;
  var pnl=gt.totalPnl||0;
  h+='<span class="badge badge-off">'+tc+' trades</span>';
  if(tc>0)h+='<span class="badge badge-pnl" style="color:'+(pnl>=0?'var(--green)':'var(--red)')+';background:'+(pnl>=0?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)')+'">'+(pnl>=0?'+':'')+pnl.toFixed(3)+' USDC</span>';
  h+='</div></div>';

  /* ─ Open Positions ─ */
  var positions=gt.openPositions||[];
  if(positions.length>0){
    h+='<div class="pos-section"><div class="section-hd">Open Positions ('+positions.length+')</div>';
    for(var i=0;i<positions.length;i++){
      var p=positions[i];
      var hold=((Date.now()-p.entryTime)/1000).toFixed(0);
      var maxHold=180;
      var pct=Math.min(100,Math.round(hold/maxHold*100));
      var livePnl=p.pnl||((p.lastPrice-p.entryPrice)*p.shares);
      var pnlCol=livePnl>=0?'var(--green)':'var(--red)';
      h+='<div class="pos-card">';
      h+='<div class="pos-top"><span class="pos-match">'+p.match+'</span><span class="pos-pnl" style="color:'+pnlCol+'">'+(livePnl>=0?'+':'')+livePnl.toFixed(3)+'</span></div>';
      h+='<div class="pos-detail">'+p.side+' '+fmtKey(p.marketKey)+' @ '+(p.entryPrice*100).toFixed(1)+'% \\u2192 '+(p.lastPrice*100).toFixed(1)+'% \\u00B7 '+hold+'s/180s \\u00B7 '+p.goalType+'</div>';
      h+='<div class="pos-bar"><div class="pos-fill" style="width:'+pct+'%;background:'+(pct>80?'var(--red)':pct>50?'var(--amber)':'var(--green)')+'"></div></div>';
      h+='</div>';
    }
    h+='</div>';
  }

  /* ─ Goal Activity Log ─ */
  var goalLog=gt.goalLog||[];
  h+='<div class="goal-log"><div class="section-hd" style="margin-top:8px">Activity Log ('+goalLog.length+')</div>';
  if(goalLog.length===0){
    h+='<div class="empty" style="padding:20px">'+(gt.enabled?'Waiting for score changes...':'Start trading to see activity')+'</div>';
  } else {
    for(var i=0;i<Math.min(goalLog.length,100);i++){
      var g=goalLog[i];
      var aCls='gl-skip',aLbl=g.action;
      if(g.action==='BUY'){aCls='gl-buy';aLbl='BOUGHT';}
      else if(g.action==='DRY_BUY'){aCls='gl-dry';aLbl='DRY BUY';}
      else if(g.action==='PENDING'){aCls='gl-pend';aLbl='PENDING';}
      else if(g.action==='SKIP'){aCls='gl-skip';aLbl='SKIP';}
      h+='<div class="gl-row"><div class="gl-top">';
      h+='<span class="gl-action '+aCls+'">'+aLbl+'</span>';
      h+='<span class="gl-match">'+g.match+'</span>';
      h+='<span class="gl-age">'+ageStr(g.ts)+'</span>';
      h+='</div>';
      h+='<div class="gl-info"><span style="color:var(--amber)">'+(g.prevScore||'?')+' \\u2192 '+g.score+'</span><span>via '+srcN(g.source)+'</span>';
      if(g.goalType)h+='<span>'+g.goalType+'</span>';
      h+='</div>';
      if(g.trade){
        h+='<div class="gl-trade">'+g.trade.side+' '+fmtKey(g.trade.market)+' @ '+(g.trade.price*100).toFixed(1)+'% \\u00B7 $'+g.trade.size;
        if(g.trade.latencyMs)h+=' \\u00B7 '+g.trade.latencyMs+'ms';
        h+='</div>';
      } else if(g.action==='SKIP'||g.action==='PENDING'){
        h+='<div class="gl-reason">'+g.reason+'</div>';
      }
      h+='</div>';
    }
  }
  h+='</div>';
  el.innerHTML=h;
}

/* ─── Bot Toggle ─── */
function toggleBot(){
  var trading=state&&state.trading;
  if(!trading)return;
  var isActive=trading.goalTrader&&trading.goalTrader.enabled&&trading.armed;
  if(isActive){
    sendCmd('disarm');
    sendCmd('goaltrader off');
  } else {
    sendCmd('arm');
    sendCmd('goaltrader on');
  }
}

function sendCmd(cmd){
  fetch('/api/trading/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd})})
    .then(function(r){return r.json();})
    .then(function(d){if(d.error)console.error('CMD:',d.error);})
    .catch(function(e){console.error(e);});
}

/* ─── Toggle helpers ─── */
function te(id){if(openEvents.has(id))openEvents.delete(id);else openEvents.add(id);render();}
function tg(key){if(openGroups.has(key))openGroups.delete(key);else openGroups.add(key);render();}
function fmtKey(k){
  return k.replace(/_ft$/,'')
    .replace(/^ml_home$/,'ML Home').replace(/^ml_away$/,'ML Away').replace(/^draw$/,'Draw')
    .replace(/^dc_1x$/,'DC 1X').replace(/^dc_12$/,'DC 12').replace(/^dc_x2$/,'DC X2')
    .replace(/^o_(\\d+)_(\\d+)$/,'Over $1.$2').replace(/^u_(\\d+)_(\\d+)$/,'Under $1.$2')
    .replace(/^handicap_home$/,'HC Home').replace(/^handicap_away$/,'HC Away')
    .replace(/^handicap_home_m(\\d+)_(\\d+)$/,'HC Home -$1.$2').replace(/^handicap_away_m(\\d+)_(\\d+)$/,'HC Away -$1.$2')
    .replace(/^btts_yes$/,'BTTS Yes').replace(/^btts_no$/,'BTTS No')
    .replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase();});
}

connect();
</script>
</body>
</html>`;
