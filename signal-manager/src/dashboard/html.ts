export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PolyMoney — Signal Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0B0F19;--bg-card:#111827;--bg-hover:#1a2235;--bg-raised:#1E293B;
  --border:#1E293B;--border-h:#334155;
  --text:#E2E8F0;--text-dim:#94A3B8;--text-muted:#64748B;
  --blue:#3B82F6;--amber:#F59E0B;--green:#10B981;--red:#EF4444;
  --lime:#84CC16;--emerald:#059669;
  --radius:8px;--radius-sm:6px;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;overflow:hidden;height:100vh;line-height:1.5}

/* ─── TOP BAR ─── */
.top-bar{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:48px;background:var(--bg-card);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;letter-spacing:.5px}
.brand .dot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0}
.brand .dot.off{background:var(--red)}
.brand .p{color:var(--blue)}.brand .m{color:var(--green)}
.top-right{display:flex;align-items:center;gap:16px}
.adapter{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-dim);padding:4px 10px;background:var(--bg);border-radius:20px}
.adapter .ad{width:5px;height:5px;border-radius:50%}
.ad-on{background:var(--green)}.ad-off{background:var(--red)}.ad-warn{background:var(--amber)}
.top-stats{display:flex;gap:16px;font-size:12px;color:var(--text-muted)}
.top-stats b{color:var(--text);font-weight:600}
.top-stats .live-count{color:var(--red)}
.top-time{font-size:11px;color:var(--text-muted);font-family:'SF Mono','Cascadia Code',monospace}

/* ─── SPORT PILLS ─── */
.sport-bar{display:flex;align-items:center;gap:6px;padding:8px 20px;border-bottom:1px solid var(--border);overflow-x:auto;min-height:40px}
.sport-bar::-webkit-scrollbar{display:none}
.pill{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-muted);transition:all .15s;white-space:nowrap;user-select:none}
.pill:hover{border-color:var(--border-h);color:var(--text)}
.pill.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.pill .cnt{opacity:.6;margin-left:3px;font-weight:400}

/* ─── LAYOUT ─── */
.layout{display:grid;grid-template-columns:1fr 380px;height:calc(100vh - 88px)}
@media(max-width:1100px){.layout{grid-template-columns:1fr}}

/* ─── LEFT PANEL ─── */
.panel-left{display:flex;flex-direction:column;overflow:hidden}

/* ─── SECTION TITLES ─── */
.sec-title{display:flex;align-items:center;gap:8px;padding:12px 20px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-muted);position:sticky;top:0;z-index:2;background:var(--bg)}
.sec-title .sec-dot{width:6px;height:6px;border-radius:50%}
.sec-title .sec-count{font-weight:400;color:var(--text-muted);margin-left:auto;font-size:10px;letter-spacing:0}
.sec-title.live-title .sec-dot{background:var(--red)}
.sec-title.live-title{color:var(--red)}
.sec-title.upcoming-title .sec-dot{background:var(--blue)}
.sec-title.upcoming-title{color:var(--blue)}

/* ─── TABS ─── */
.tab-bar{display:flex;align-items:center;gap:0;border-bottom:1px solid var(--border);padding:0 16px;background:var(--bg)}
.tab{padding:10px 16px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;user-select:none;display:flex;align-items:center;gap:6px}
.tab:hover{color:var(--text)}
.tab.active{color:var(--red);border-bottom-color:var(--red)}
.tab.active.tab-up{color:var(--blue);border-bottom-color:var(--blue)}
.tab-cnt{font-weight:400;font-size:10px;opacity:.7}

/* ─── SCROLLABLE SECTIONS ─── */
.tab-content{flex:1;overflow-y:auto;display:none}
.tab-content.active{display:block}

/* ─── SPORT GROUP HEADER ─── */
.sport-hd{display:flex;align-items:center;gap:6px;padding:8px 20px 4px;font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px;cursor:pointer;user-select:none;transition:color .15s}
.sport-hd:hover{color:var(--text)}
.sport-hd .sp-icon{font-size:13px}
.sport-hd .sp-cnt{font-weight:400;color:var(--text-muted);font-size:10px}
.sport-hd .sp-arrow{font-size:9px;margin-left:2px;transition:transform .2s;display:inline-block}
.sport-hd.closed .sp-arrow{transform:rotate(-90deg)}

/* ─── EVENT CARD ─── */
.ev{margin:2px 12px 2px 12px;border-radius:var(--radius-sm);background:var(--bg-card);border:1px solid transparent;transition:all .15s}
.ev:hover{border-color:var(--border-h)}
.ev.live-ev{border-left:2px solid var(--red)}
.ev-row{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;cursor:pointer;gap:10px}
.ev-left{min-width:0;flex:1}
.ev-teams{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-meta{display:flex;align-items:center;gap:8px;margin-top:2px;font-size:11px;color:var(--text-muted)}
.ev-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.ev-score{font-family:'SF Mono','Cascadia Code',monospace;font-size:16px;font-weight:700;color:var(--green)}
.ev-elapsed{font-size:11px;color:var(--amber);font-weight:600}
.ev-countdown{font-size:11px;color:var(--text-muted);font-family:'SF Mono','Cascadia Code',monospace}
.badge-live{font-size:9px;font-weight:700;color:var(--red);display:flex;align-items:center;gap:3px}
.badge-live::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--red);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.src-tag{font-size:9px;font-weight:600;padding:1px 5px;border-radius:3px;letter-spacing:.3px}
.src-tag.pm{background:rgba(59,130,246,.12);color:var(--blue)}
.src-tag.xbet{background:rgba(245,158,11,.12);color:var(--amber)}
.src-tag.b365{background:rgba(16,185,129,.12);color:var(--green)}
.pm-lnk,.xb-lnk{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;text-decoration:none;font-size:11px;transition:background .15s}
.pm-lnk{background:rgba(59,130,246,.1);color:var(--blue)}
.pm-lnk:hover{background:rgba(59,130,246,.25)}
.xb-lnk{background:rgba(245,158,11,.1);color:var(--amber)}
.xb-lnk:hover{background:rgba(245,158,11,.25)}

/* ─── ODDS TABLE ─── */
.ev-odds{display:none;padding:6px 14px 10px;border-top:1px solid var(--border);background:var(--bg)}
.ev.open .ev-odds{display:block}
.odds-grid{display:grid;grid-template-columns:1fr 80px 80px 70px;gap:0;font-size:11px}
.odds-hd{padding:4px 6px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
.odds-hd:nth-child(2){text-align:center;color:var(--blue)}
.odds-hd:nth-child(3){text-align:center;color:var(--amber)}
.odds-hd:last-child{text-align:center}
.odds-cell{padding:4px 6px;border-bottom:1px solid rgba(30,41,59,.4)}
.odds-lbl{color:var(--text-dim);font-weight:500}
.odds-pm,.odds-xb{text-align:center;font-family:'SF Mono','Cascadia Code',monospace;font-weight:500}
.odds-pm{color:var(--blue)}.odds-xb{color:var(--amber)}
.odds-edge{text-align:center;font-family:'SF Mono','Cascadia Code',monospace;font-weight:600}
.odds-edge.pos{color:var(--green)}.odds-edge.neg{color:var(--red)}
.odds-edge.hot{color:var(--green);background:rgba(16,185,129,.08);border-radius:3px}

/* ─── RIGHT PANEL ─── */
.panel-right{background:var(--bg-card);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
@media(max-width:1100px){.panel-right{border-left:none;border-top:1px solid var(--border)}}

/* ─── SIGNALS SECTION ─── */
.signals-area{flex:1;overflow-y:auto;padding:8px 12px}

.sec-title.sig-title .sec-dot{background:var(--green)}
.sec-title.sig-title{color:var(--green)}

.opp{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:8px;transition:border-color .2s}
.opp.good{border-left:3px solid var(--green)}
.opp.medium{border-left:3px solid var(--amber)}
.opp.suspect{border-left:3px solid var(--red);opacity:.55}
.opp-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.opp-action{font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;letter-spacing:.3px}
.opp-action.yes{background:rgba(16,185,129,.12);color:var(--green)}
.opp-action.no{background:rgba(239,68,68,.12);color:var(--red)}
.opp-edge-box{text-align:right}
.opp-edge{font-family:'SF Mono','Cascadia Code',monospace;font-size:20px;font-weight:800;color:var(--green);line-height:1}
.opp-trend{font-size:12px;margin-left:2px}
.opp-match{font-size:13px;font-weight:600;margin-bottom:2px}
.opp-market{font-size:11px;color:var(--blue);margin-bottom:8px}
.opp-bar{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.opp-bar-label{font-size:10px;font-family:'SF Mono','Cascadia Code',monospace;min-width:62px;white-space:nowrap}
.opp-bar-label.pm-l{color:var(--blue)}.opp-bar-label.xb-l{color:var(--amber);text-align:right}
.opp-track{flex:1;height:4px;background:var(--bg-raised);border-radius:2px;position:relative;overflow:hidden}
.opp-fill{position:absolute;top:0;left:0;height:100%;background:var(--blue);border-radius:2px;transition:width .3s}
.opp-marker{position:absolute;top:-2px;width:2px;height:8px;background:var(--amber);border-radius:1px}
.opp-foot{display:flex;gap:12px;font-size:10px;color:var(--text-muted)}
.opp-foot .v{font-weight:600;color:var(--text-dim)}
.q-badge{font-size:9px;font-weight:600;padding:2px 6px;border-radius:3px}
.q-badge.good{background:rgba(16,185,129,.12);color:var(--green)}
.q-badge.medium{background:rgba(245,158,11,.12);color:var(--amber)}
.q-badge.suspect{background:rgba(239,68,68,.12);color:var(--red)}

/* ─── SESSION STATS ─── */
.session-area{border-top:1px solid var(--border);padding:12px 20px 16px}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-top:8px}
.stat-item{display:flex;justify-content:space-between;align-items:center;font-size:11px}
.stat-item .stat-k{color:var(--text-muted)}
.stat-item .stat-v{font-family:'SF Mono','Cascadia Code',monospace;font-weight:600;color:var(--text)}

/* ─── EMPTY STATES ─── */
.empty{text-align:center;color:var(--text-muted);padding:32px 20px;font-size:12px}
.empty-sm{text-align:center;color:var(--text-muted);padding:16px;font-size:11px}

/* ─── SCROLLBAR ─── */
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-h);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}
</style>
</head>
<body>

<div class="top-bar">
  <div class="brand">
    <div class="dot" id="ws-dot"></div>
    <span><span class="p">POLY</span><span class="m">MONEY</span></span>
  </div>
  <div class="top-right">
    <div id="adapters" style="display:flex;gap:6px"></div>
    <div class="top-stats">
      <span>Matched <b id="s-events">0</b></span>
      <span>Live <b id="s-live" class="live-count">0</b></span>
      <span>Signals <b id="s-sigs">0</b></span>
    </div>
    <div class="top-time" id="s-time">--:--:--</div>
  </div>
</div>

<div class="sport-bar" id="sport-bar"></div>

<div class="layout">
  <div class="panel-left">
    <div class="tab-bar" id="tab-bar">
      <div class="tab active" id="tab-live" onclick="setTab(&quot;live&quot;)"><span class="sec-dot" style="width:6px;height:6px;border-radius:50%;background:var(--red)"></span>LIVE <span class="tab-cnt" id="tab-live-cnt">0</span></div>
      <div class="tab tab-up" id="tab-up" onclick="setTab(&quot;upcoming&quot;)"><span class="sec-dot" style="width:6px;height:6px;border-radius:50%;background:var(--blue)"></span>UPCOMING <span class="tab-cnt" id="tab-up-cnt">0</span></div>
    </div>
    <div class="tab-content active" id="sec-live"></div>
    <div class="tab-content" id="sec-up"></div>
  </div>
  <div class="panel-right">
    <div class="sec-title sig-title"><div class="sec-dot"></div>SIGNALS<span class="sec-count" id="sig-cnt">0</span></div>
    <div class="signals-area" id="signals"><div class="empty">Waiting for signals...</div></div>
    <div class="session-area">
      <div class="sec-title" style="padding:0 0 4px"><div class="sec-dot" style="background:var(--text-muted)"></div>SESSION</div>
      <div class="stat-grid" id="stats"></div>
    </div>
  </div>
</div>

<script>
var ws, state=null, sportFilter='all', activeTab='live', openEvents=new Set(), closedGroups=new Set(), startedAt=0;

var SPORT_ICONS={
  soccer:'\\u26BD',football:'\\u26BD',basketball:'\\uD83C\\uDFC0',ice_hockey:'\\uD83C\\uDFD2',
  tennis:'\\uD83C\\uDFBE',baseball:'\\u26BE',american_football:'\\uD83C\\uDFC8',
  cricket:'\\uD83C\\uDFCF',mma:'\\uD83E\\uDD4A',boxing:'\\uD83E\\uDD4A',rugby:'\\uD83C\\uDFC9',
  golf:'\\u26F3',esports:'\\uD83C\\uDFAE',table_tennis:'\\uD83C\\uDFD3',
  volleyball:'\\uD83C\\uDFD0',handball:'\\uD83E\\uDD3E',
  epl:'\\u26BD',sea:'\\u26BD',lal:'\\u26BD',bun:'\\u26BD',fl1:'\\u26BD',ucl:'\\u26BD',uel:'\\u26BD',
  mls:'\\u26BD',arg:'\\u26BD',mex:'\\u26BD',ere:'\\u26BD',den:'\\u26BD',tur:'\\u26BD',
  crint:'\\u26BD',spl:'\\u26BD',rpl:'\\u26BD',bra:'\\u26BD',por:'\\u26BD',sco:'\\u26BD',
  bel:'\\u26BD',sui:'\\u26BD',jpn:'\\u26BD',kor:'\\u26BD',chn:'\\u26BD',col:'\\u26BD',
  dfb:'\\u26BD',copa:'\\u26BD',itc:'\\u26BD',
  nba:'\\uD83C\\uDFC0',ncaab:'\\uD83C\\uDFC0',cbb:'\\uD83C\\uDFC0',wnba:'\\uD83C\\uDFC0',
  nhl:'\\uD83C\\uDFD2',khl:'\\uD83C\\uDFD2',shl:'\\uD83C\\uDFD2',ahl:'\\uD83C\\uDFD2',
  atp:'\\uD83C\\uDFBE',wta:'\\uD83C\\uDFBE',
  nfl:'\\uD83C\\uDFC8',cfb:'\\uD83C\\uDFC8',
  mlb:'\\u26BE',kbo:'\\u26BE',npb:'\\u26BE',
  ufc:'\\uD83E\\uDD4A',
  cs2:'\\uD83C\\uDFAE',lol:'\\uD83C\\uDFAE',dota2:'\\uD83C\\uDFAE',val:'\\uD83C\\uDFAE',r6siege:'\\uD83C\\uDFAE',
  esports_cs2:'\\uD83C\\uDFAE',esports_lol:'\\uD83C\\uDFAE',esports_dota2:'\\uD83C\\uDFAE',esports_rl:'\\uD83C\\uDFAE',
  cwbb:'\\uD83C\\uDFC0',bkarg:'\\uD83C\\uDFC0',bkligend:'\\uD83C\\uDFC0',bknbl:'\\uD83C\\uDFC0',bkkbl:'\\uD83C\\uDFC0',bkseriea:'\\uD83C\\uDFC0',bkfr1:'\\uD83C\\uDFC0',
  aus:'\\u26BD',sud:'\\u26BD',lib:'\\u26BD',cde:'\\u26BD',cdr:'\\u26BD',
  rus:'\\u26BD',rusixnat:'\\u26BD',rusrp:'\\u26BD',rutopft:'\\u26BD',ruurc:'\\u26BD',
  mwoh:'\\uD83C\\uDFD2',wwoh:'\\uD83C\\uDFD2',hok:'\\uD83C\\uDFD2',
  craus:'\\uD83C\\uDFCF'
};
var SPORT_LABELS={
  soccer:'Soccer',ice_hockey:'Hockey',basketball:'Basketball',tennis:'Tennis',baseball:'Baseball',
  american_football:'Am. Football',cricket:'Cricket',mma:'MMA',rugby:'Rugby',golf:'Golf',
  esports:'Esports',table_tennis:'Table Tennis',volleyball:'Volleyball',handball:'Handball',
  epl:'EPL',sea:'Serie A',lal:'La Liga',bun:'Bundesliga',fl1:'Ligue 1',
  ucl:'UCL',uel:'Europa League',mls:'MLS',arg:'Argentina',mex:'Liga MX',
  ere:'Eredivisie',den:'Denmark',tur:'Turkey',crint:'Copa Int',spl:'Saudi PL',
  rpl:'Russia PL',bra:'Brazil',por:'Portugal',sco:'Scotland',bel:'Belgium',
  sui:'Switzerland',jpn:'J-League',kor:'K-League',col:'Colombia',
  dfb:'DFB Pokal',copa:'Copa',itc:'Coppa Italia',
  nba:'NBA',ncaab:'NCAAB',wnba:'WNBA',nhl:'NHL',khl:'KHL',shl:'SHL',ahl:'AHL',
  atp:'ATP',wta:'WTA',nfl:'NFL',cfb:'CFB',mlb:'MLB',kbo:'KBO',npb:'NPB',ufc:'UFC',
  cs2:'CS2',lol:'LoL',dota2:'Dota 2',val:'Valorant',r6siege:'R6 Siege',
  esports_cs2:'CS2',esports_lol:'LoL',esports_dota2:'Dota 2',esports_rl:'Rocket League',
  cwbb:'CWBB',bkarg:'BK Argentina',bkligend:'Liga Endesa',bknbl:'NBL',bkkbl:'KBL',bkseriea:'BK Serie A',bkfr1:'LNB Pro A',
  aus:'Australia',sud:'Sudamericana',lib:'Libertadores',cde:'Copa Ecuador',cdr:'Copa del Rey',
  rus:'Russia',rusixnat:'Russia Cup',rusrp:'Russia PL',rutopft:'Russia Top',ruurc:'Russia URC',
  mwoh:'Women Hockey',wwoh:'Women WC Hockey',hok:'Hockey',
  craus:'Cricket AUS'
};
var SPORT_GROUPS={
  soccer:'Soccer',football:'Soccer',
  epl:'Soccer',sea:'Soccer',lal:'Soccer',bun:'Soccer',fl1:'Soccer',ucl:'Soccer',uel:'Soccer',
  mls:'Soccer',arg:'Soccer',mex:'Soccer',ere:'Soccer',den:'Soccer',tur:'Soccer',
  crint:'Soccer',spl:'Soccer',rpl:'Soccer',bra:'Soccer',por:'Soccer',sco:'Soccer',
  bel:'Soccer',sui:'Soccer',jpn:'Soccer',kor:'Soccer',chn:'Soccer',col:'Soccer',
  dfb:'Soccer',copa:'Soccer',itc:'Soccer',aus:'Soccer',sud:'Soccer',lib:'Soccer',
  cde:'Soccer',cdr:'Soccer',rus:'Soccer',rusixnat:'Soccer',rusrp:'Soccer',rutopft:'Soccer',ruurc:'Soccer',
  basketball:'Basketball',nba:'Basketball',ncaab:'Basketball',wnba:'Basketball',cbb:'Basketball',
  cwbb:'Basketball',bkarg:'Basketball',bkligend:'Basketball',bknbl:'Basketball',bkkbl:'Basketball',bkseriea:'Basketball',bkfr1:'Basketball',
  ice_hockey:'Hockey',nhl:'Hockey',khl:'Hockey',shl:'Hockey',ahl:'Hockey',mwoh:'Hockey',wwoh:'Hockey',hok:'Hockey',
  tennis:'Tennis',atp:'Tennis',wta:'Tennis',
  american_football:'Am. Football',nfl:'Am. Football',cfb:'Am. Football',
  baseball:'Baseball',mlb:'Baseball',kbo:'Baseball',npb:'Baseball',
  mma:'MMA',boxing:'MMA',ufc:'MMA',
  cs2:'CS2',esports_cs2:'CS2',
  dota2:'Dota 2',esports_dota2:'Dota 2',
  lol:'LoL',esports_lol:'LoL',
  val:'Valorant',r6siege:'R6 Siege',esports_rl:'Rocket League',
  cricket:'Cricket',craus:'Cricket',
  rugby:'Rugby',golf:'Golf',table_tennis:'Table Tennis',volleyball:'Volleyball',handball:'Handball',
  esports:'Esports'
};
var GROUP_ICONS={
  'Soccer':'\\u26BD','Basketball':'\\uD83C\\uDFC0','Hockey':'\\uD83C\\uDFD2',
  'Tennis':'\\uD83C\\uDFBE','Am. Football':'\\uD83C\\uDFC8','Baseball':'\\u26BE',
  'MMA':'\\uD83E\\uDD4A','CS2':'\\uD83C\\uDFAE','Dota 2':'\\uD83C\\uDFAE',
  'LoL':'\\uD83C\\uDFAE','Valorant':'\\uD83C\\uDFAE','R6 Siege':'\\uD83C\\uDFAE',
  'Rocket League':'\\uD83C\\uDFAE','Cricket':'\\uD83C\\uDFCF','Rugby':'\\uD83C\\uDFC9',
  'Golf':'\\u26F3','Table Tennis':'\\uD83C\\uDFD3','Volleyball':'\\uD83C\\uDFD0',
  'Handball':'\\uD83E\\uDD3E','Esports':'\\uD83C\\uDFAE'
};
function sportGroup(s){return SPORT_GROUPS[s]||SPORT_GROUPS[(s||'').split('_')[0]]||s||'Other';}
function grpIcon(g){return GROUP_ICONS[g]||'\\uD83C\\uDFC6';}
function spIcon(s){return SPORT_ICONS[s]||SPORT_ICONS[(s||'').split('_')[0]]||'\\uD83C\\uDFC6';}
function spLabel(s){return SPORT_LABELS[s]||s;}

function connect(){
  var p=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(p+'://'+location.host);
  ws.onopen=function(){document.getElementById('ws-dot').className='dot';};
  ws.onmessage=function(e){
    var prev=state;
    state=JSON.parse(e.data);
    if(!startedAt)startedAt=Date.now();
    render();
  };
  ws.onclose=function(){
    document.getElementById('ws-dot').className='dot off';
    setTimeout(connect,2000);
  };
}

/* ─── Helpers ─── */
function hasMulti(ev){return Object.keys(ev.markets).some(function(k){if(k.startsWith('__'))return false;var s=Object.keys(ev.markets[k]);return (s.indexOf('polymarket')>=0&&s.indexOf('onexbet')>=0)||(s.indexOf('polymarket')>=0&&s.indexOf('bet365')>=0);});}
function getFiltered(){
  if(!state)return{live:[],upcoming:[]};
  var live=[],up=[];
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(!hasMulti(ev))continue;
    var grp=sportGroup(ev.sport);
    if(sportFilter!=='all'&&grp!==sportFilter)continue;
    if(ev.status==='live')live.push(ev);
    else up.push(ev);
  }
  up.sort(function(a,b){return(a.startTime||0)-(b.startTime||0);});
  return{live:live,upcoming:up};
}
function groupBySport(arr){
  var g={};
  for(var i=0;i<arr.length;i++){var grp=sportGroup(arr[i].sport);if(!g[grp])g[grp]=[];g[grp].push(arr[i]);}
  return Object.entries(g).sort(function(a,b){if(a[0]==='Soccer')return -1;if(b[0]==='Soccer')return 1;return b[1].length-a[1].length;});
}

/* ─── Main Render ─── */
function render(){
  if(!state)return;
  var d=getFiltered();
  var multiCount=d.live.length+(d.upcoming?d.upcoming.length:0);
  document.getElementById('s-events').textContent=multiCount;
  document.getElementById('s-live').textContent=d.live.length;
  document.getElementById('s-sigs').textContent=(state.tradeSignals||[]).length;
  document.getElementById('s-time').textContent=new Date().toLocaleTimeString();
  renderAdapters();
  renderSportPills();
  renderLive(d.live);
  renderUpcoming(d.upcoming);
  renderSignals();
  renderSession();
}

function renderAdapters(){
  var el=document.getElementById('adapters');
  var h='';
  var entries=Object.entries(state.adapters);
  for(var i=0;i<entries.length;i++){
    var id=entries[i][0],s=entries[i][1];
    var cls=s==='connected'?'ad-on':s==='error'?'ad-off':'ad-warn';
    var label=id==='polymarket'?'PM':id==='onexbet'?'1xBet':id==='bet365'?'b365':id;
    h+='<div class="adapter"><div class="ad '+cls+'"></div>'+label+'</div>';
  }
  el.innerHTML=h;
}

function renderSportPills(){
  var counts={};
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(!hasMulti(ev))continue;
    var grp=sportGroup(ev.sport);
    counts[grp]=(counts[grp]||0)+1;
  }
  var sorted=Object.entries(counts).sort(function(a,b){if(a[0]==='Soccer')return -1;if(b[0]==='Soccer')return 1;return b[1]-a[1];});
  var total=sorted.reduce(function(s,e){return s+e[1];},0);
  var el=document.getElementById('sport-bar');
  if(total===0){el.innerHTML='<div class="pill active">No dual-source events yet</div>';return;}
  var h='<div class="pill'+(sportFilter==='all'?' active':'')+'" onclick="setSport(this,\\'all\\')">All<span class="cnt">'+total+'</span></div>';
  for(var i=0;i<sorted.length;i++){
    var g=sorted[i][0],c=sorted[i][1];
    h+='<div class="pill'+(sportFilter===g?' active':'')+'" onclick="setSport(this,\\''+g+'\\')">'+grpIcon(g)+' '+g+'<span class="cnt">'+c+'</span></div>';
  }
  el.innerHTML=h;
}
function setSport(el,s){sportFilter=s;render();}
function setTab(t){
  activeTab=t;
  document.getElementById('tab-live').className=t==='live'?'tab active':'tab';
  document.getElementById('tab-up').className=t==='upcoming'?'tab tab-up active':'tab tab-up';
  document.getElementById('sec-live').className=t==='live'?'tab-content active':'tab-content';
  document.getElementById('sec-up').className=t==='upcoming'?'tab-content active':'tab-content';
}

/* ─── Live Events Section ─── */
function renderLive(evs){
  document.getElementById('tab-live-cnt').textContent=evs.length;
  var el=document.getElementById('sec-live');
  if(evs.length===0){
    el.innerHTML='<div class="empty-sm">No live events</div>';
    return;
  }
  var h='';
  var groups=groupBySport(evs);
  for(var g=0;g<groups.length;g++){
    var grp=groups[g][0],items=groups[g][1];
    var gKey='live_'+grp,isClosed=closedGroups.has(gKey);
    h+='<div class="sport-hd'+(isClosed?' closed':'')+'" onclick="toggleGroup(\\''+gKey.replace(/'/g,"\\\\'")+'\\')"><span class="sp-icon">'+grpIcon(grp)+'</span>'+grp+' <span class="sp-cnt">('+items.length+')</span><span class="sp-arrow">\\u25BC</span></div>';
    if(!isClosed){for(var i=0;i<items.length;i++) h+=renderEvent(items[i],true);}
  }
  el.innerHTML=h;
}

/* ─── Upcoming Events Section ─── */
function renderUpcoming(evs){
  document.getElementById('tab-up-cnt').textContent=evs.length;
  var el=document.getElementById('sec-up');
  if(evs.length===0){
    el.innerHTML='<div class="empty-sm">No upcoming events</div>';
    return;
  }
  var h='';
  var groups=groupBySport(evs);
  for(var g=0;g<groups.length;g++){
    var grp=groups[g][0],items=groups[g][1];
    var gKey='up_'+grp,isClosed=closedGroups.has(gKey);
    h+='<div class="sport-hd'+(isClosed?' closed':'')+'" onclick="toggleGroup(\\''+gKey.replace(/'/g,"\\\\'")+'\\')"><span class="sp-icon">'+grpIcon(grp)+'</span>'+grp+' <span class="sp-cnt">('+items.length+')</span><span class="sp-arrow">\\u25BC</span></div>';
    if(!isClosed){for(var i=0;i<Math.min(items.length,50);i++) h+=renderEvent(items[i],false);}
  }
  el.innerHTML=h;
}

/* ─── Single Event Card ─── */
function renderEvent(ev,isLive){
  var isOpen=openEvents.has(ev.id);
  var sc=ev.score?ev.score.home+' \\u2013 '+ev.score.away:'';
  var elapsed=ev.elapsed||'';
  var countdown='';
  if(!isLive&&ev.startTime>0){
    var diff=ev.startTime-Date.now();
    if(diff>0){var dd=Math.floor(diff/86400000),hh=Math.floor((diff%86400000)/3600000),mm=Math.floor((diff%3600000)/60000);countdown=dd>0?dd+'d '+hh+'h':hh>0?hh+'h '+mm+'m':mm+'m';}
    else countdown='starting';
  }
  var mkeys=Object.keys(ev.markets).filter(function(k){return !k.startsWith('__')&&ev.markets[k].polymarket;});
  var srcMap={polymarket:{l:'PM',c:'pm'},onexbet:{l:'1xBet',c:'xbet'},bet365:{l:'b365',c:'b365'}};
  var badges='';
  if(ev.sources){for(var s=0;s<ev.sources.length;s++){var m=srcMap[ev.sources[s]];if(m)badges+='<span class="src-tag '+m.c+'">'+m.l+'</span> ';}}
  var pmLink=ev.pmSlug?'<a href="https://polymarket.com/event/'+ev.pmSlug+'" target="_blank" rel="noopener" class="pm-lnk" onclick="event.stopPropagation()" title="Polymarket">\\u2197</a>':'';
  var xbLink=ev.xbetUrl?'<a href="'+ev.xbetUrl+'" target="_blank" rel="noopener" class="xb-lnk" onclick="event.stopPropagation()" title="1xBet">\\u2197</a>':'';

  var rightHtml='';
  if(isLive){
    rightHtml=(sc?'<span class="ev-score">'+sc+'</span>':'')+(elapsed?'<span class="ev-elapsed">'+elapsed+'</span>':'');
  }else{
    rightHtml=countdown?'<span class="ev-countdown">'+countdown+'</span>':'';
  }

  var oddsHtml=renderOdds(ev,mkeys);

  return '<div class="ev'+(isLive?' live-ev':'')+(isOpen?' open':'')+'" data-id="'+ev.id+'">'
    +'<div class="ev-row" onclick="toggle(\\''+ev.id.replace(/'/g,"\\\\'")+'\\')"><div class="ev-left"><div class="ev-teams">'+ev.home+' vs '+ev.away+' '+pmLink+xbLink+'</div>'
    +'<div class="ev-meta">'+(isLive?'<span class="badge-live">LIVE</span>':'')+badges+'<span style="color:var(--text-dim)">'+spLabel(ev.sport)+'</span><span>'+mkeys.length+' markets</span></div>'
    +'</div><div class="ev-right">'+rightHtml+'</div></div>'
    +'<div class="ev-odds">'+oddsHtml+'</div></div>';
}

/* ─── Odds Table ─── */
function renderOdds(ev,mkeys){
  var sorted=mkeys.slice().sort(function(a,b){
    function o(k){if(k.startsWith('ml_home'))return 0;if(k.startsWith('ml_away'))return 1;if(k.startsWith('draw'))return 2;return 3;}
    var d=o(a)-o(b);if(d!==0)return d;return a<b?-1:a>b?1:0;
  });
  var h='<div class="odds-grid"><div class="odds-hd">Market</div><div class="odds-hd">PM</div><div class="odds-hd">1xBet</div><div class="odds-hd">b365</div><div class="odds-hd">Edge</div>';
  for(var i=0;i<Math.min(sorted.length,15);i++){
    var k=sorted[i],srcs=ev.markets[k];
    var pm=srcs.polymarket,xb=srcs.onexbet,b3=srcs.bet365;
    var pmP=pm?(1/pm.value*100):null;
    var xbP=xb?(1/xb.value*100):null;
    var b3P=b3?(1/b3.value*100):null;
    var edge=(pmP!==null&&xbP!==null)?xbP-pmP:null;
    var edgeAbs=edge!==null?Math.abs(edge):0;
    var edgeCls=edgeAbs>=3?'hot':edge!==null&&edge>0?'pos':'neg';
    h+='<div class="odds-cell odds-lbl">'+fmtKey(k)+'</div>'
      +'<div class="odds-cell odds-pm">'+(pmP!==null?pmP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-xb">'+(xbP!==null?xbP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-b3">'+(b3P!==null?b3P.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-edge '+edgeCls+'">'+(edge!==null?(edge>0?'+':'')+edge.toFixed(1)+'%':'\\u2014')+'</div>';
  }
  h+='</div>';
  return h;
}

/* ─── Signals / Opportunities ─── */
function renderSignals(){
  var el=document.getElementById('signals');
  var opps=state.tradeSignals||[];
  document.getElementById('sig-cnt').textContent=opps.length;
  if(opps.length===0){el.innerHTML='<div class="empty">No opportunities detected<br><span style="font-size:11px;margin-top:4px;display:block">Signals appear when PM & 1xBet diverge by 3%+</span></div>';return;}
  var h='';
  for(var i=0;i<opps.length;i++){
    var o=opps[i];
    var isYes=o.action==='BUY_YES';
    var dur=Math.floor((Date.now()-o.firstSeen)/1000);
    var durStr=dur<60?dur+'s':Math.floor(dur/60)+'m '+dur%60+'s';
    var scoreTxt=o.score?o.score.home+'\\u2013'+o.score.away:'';
    var liveBadge=o.eventStatus==='live'?'<span class="badge-live" style="display:inline-flex;margin-left:6px">LIVE</span>':'';
    var trend='';
    if(o.edgeHistory&&o.edgeHistory.length>=3){
      var r=o.edgeHistory.slice(-3),avg1=(r[0]+r[1])/2,last=r[2];
      if(last>avg1+0.5)trend='<span class="opp-trend" style="color:var(--green)">\\u25B2</span>';
      else if(last<avg1-0.5)trend='<span class="opp-trend" style="color:var(--red)">\\u25BC</span>';
      else trend='<span class="opp-trend" style="color:var(--text-muted)">\\u25B6</span>';
    }
    var pmP=Math.min(100,Math.max(0,o.polyProb));
    var xbP=Math.min(100,Math.max(0,o.xbetProb));
    var pmFr=o.polyAgeMs<5000?'<span class="v" style="color:var(--green)">&lt;5s</span>':o.polyAgeMs<30000?'<span class="v">'+Math.round(o.polyAgeMs/1000)+'s</span>':'<span class="v" style="color:var(--red)">'+Math.round(o.polyAgeMs/1000)+'s</span>';
    var xbFr=o.xbetAgeMs<10000?'<span class="v" style="color:var(--green)">&lt;10s</span>':o.xbetAgeMs<60000?'<span class="v">'+Math.round(o.xbetAgeMs/1000)+'s</span>':'<span class="v" style="color:var(--red)">'+Math.round(o.xbetAgeMs/1000)+'s</span>';

    var escHome=o.homeTeam.replace(/'/g,"\\\\'");
    var escAway=o.awayTeam.replace(/'/g,"\\\\'");
    h+='<div class="opp '+o.quality+'" style="cursor:pointer" onclick="openSignalEvent(\\''+escHome+'\\',\\''+escAway+'\\')">'
      +'<div class="opp-header"><div><span class="opp-action '+(isYes?'yes':'no')+'">'+o.action.replace('_',' ')+'</span> <span class="q-badge '+o.quality+'">'+o.quality.toUpperCase()+'</span></div>'
      +'<div class="opp-edge-box"><span class="opp-edge">'+o.edge.toFixed(1)+'<span style="font-size:12px;font-weight:600">%</span></span>'+trend+'</div></div>'
      +'<div class="opp-match">'+o.homeTeam+' vs '+o.awayTeam+(scoreTxt?' <span style="color:var(--green);font-weight:700">'+scoreTxt+'</span>':'')+liveBadge+'</div>'
      +'<div class="opp-market">'+fmtKey(o.market)+'</div>'
      +'<div class="opp-bar"><span class="opp-bar-label pm-l">PM '+pmP.toFixed(1)+'%</span><div class="opp-track"><div class="opp-fill" style="width:'+pmP+'%"></div><div class="opp-marker" style="left:'+xbP+'%"></div></div><span class="opp-bar-label xb-l">'+xbP.toFixed(1)+'% 1xB</span></div>'
      +'<div class="opp-foot"><span>'+durStr+'</span><span>PM '+pmFr+'</span><span>1xBet '+xbFr+'</span></div>'
      +'</div>';
  }
  el.innerHTML=h;
}

/* ─── Session Stats ─── */
function renderSession(){
  var el=document.getElementById('stats');
  var upSec=state.uptime||0;
  var hh=Math.floor(upSec/3600),mm=Math.floor((upSec%3600)/60);
  var upStr=hh>0?hh+'h '+mm+'m':mm+'m';

  var reactions=state.reactionLog||[];
  var pmR=[],xbR=[];
  for(var i=0;i<reactions.length;i++){
    var ts=reactions[i].trajectories||reactions[i].reactions||[];
    for(var j=0;j<ts.length;j++){
      var t=ts[j];
      var ms=t.firstReactionMs||t.reactionMs||0;
      if(ms>0){
        if(t.source==='polymarket')pmR.push(ms);
        else if(t.source==='onexbet')xbR.push(ms);
      }
    }
  }
  function avg(a){if(!a.length)return 0;return a.reduce(function(s,v){return s+v;},0)/a.length;}

  var closedN=state.closedOpportunityCount||0;
  var activeN=(state.tradeSignals||[]).length;

  el.innerHTML=''
    +stat('Uptime',upStr)
    +stat('Events',''+state.eventCount)
    +stat('Goals',''+reactions.length)
    +stat('Signals',activeN+' / '+closedN)
    +stat('PM React',pmR.length?((avg(pmR)/1000).toFixed(1)+'s'):'\\u2014')
    +stat('1xBet React',xbR.length?((avg(xbR)/1000).toFixed(1)+'s'):'\\u2014');
}
function stat(k,v){return '<div class="stat-item"><span class="stat-k">'+k+'</span><span class="stat-v">'+v+'</span></div>';}

/* ─── Utilities ─── */
function toggle(id){if(openEvents.has(id))openEvents.delete(id);else openEvents.add(id);render();}
function toggleGroup(key){if(closedGroups.has(key))closedGroups.delete(key);else closedGroups.add(key);render();}
function openSignalEvent(home,away){
  if(!state)return;
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(ev.home===home&&ev.away===away){
      openEvents.add(ev.id);
      render();
      var el=document.querySelector('[data-id="'+ev.id.replace(/"/g,'\\\\"')+'"]');
      if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
  }
}
function fmtKey(k){
  return k.replace(/_ft$/,'')
    .replace(/^ml_home$/,'ML Home').replace(/^ml_away$/,'ML Away').replace(/^draw$/,'Draw')
    .replace(/^dc_1x$/,'DC 1X').replace(/^dc_12$/,'DC 12').replace(/^dc_x2$/,'DC X2')
    .replace(/^o_(\\d+)_(\\d+)$/,'Over $1.$2').replace(/^u_(\\d+)_(\\d+)$/,'Under $1.$2')
    .replace(/^handicap_home$/,'Handicap Home').replace(/^handicap_away$/,'Handicap Away')
    .replace(/^handicap_home_m(\\d+)_(\\d+)$/,'HC Home -$1.$2').replace(/^handicap_away_m(\\d+)_(\\d+)$/,'HC Away -$1.$2')
    .replace(/^btts_yes$/,'BTTS Yes').replace(/^btts_no$/,'BTTS No')
    .replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase();});
}

connect();
</script>
</body>
</html>`;
