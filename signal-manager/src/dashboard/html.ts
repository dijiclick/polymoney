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
.tab.active.tab-goals{color:var(--green);border-bottom-color:var(--green)}

/* ─── GOALS TAB ─── */
.goals-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)}
.gs-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;text-align:center}
.gs-card .gs-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.gs-card .gs-value{font-size:20px;font-weight:800;font-family:'SF Mono','Cascadia Code',monospace}
.gs-card .gs-sub{font-size:10px;color:var(--text-muted);margin-top:2px}
.goal-row{display:flex;align-items:stretch;gap:0;margin:2px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;transition:border-color .15s}
.goal-row:hover{border-color:var(--border-h)}
.goal-winner{width:4px;flex-shrink:0;border-radius:2px 0 0 2px}
.goal-body{flex:1;padding:8px 12px;min-width:0}
.goal-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.goal-match{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.goal-score-change{font-family:'SF Mono','Cascadia Code',monospace;font-size:12px;font-weight:700;color:var(--green)}
.goal-time{font-size:10px;color:var(--text-muted);font-family:'SF Mono','Cascadia Code',monospace;white-space:nowrap}
.goal-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.goal-src{display:flex;align-items:center;gap:4px;font-size:11px;font-family:'SF Mono','Cascadia Code',monospace;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.03);border:1px solid var(--border)}
.goal-src.winner{border-color:var(--green);background:rgba(16,185,129,0.08)}
.goal-src .src-name{font-weight:600;font-size:10px}
.goal-src .src-ms{font-weight:700}
.goal-src .src-delta{font-size:10px;color:var(--text-muted)}
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
.src-tag.kambi{background:rgba(16,185,129,.12);color:var(--green)}
.src-tag.pinn{background:rgba(245,158,11,.12);color:#f59e0b}
.src-tag.thesports{background:rgba(139,92,246,.12);color:#8b5cf6}
.pm-lnk,.xb-lnk{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;text-decoration:none;font-size:11px;transition:background .15s}
.pm-lnk{background:rgba(59,130,246,.1);color:var(--blue)}
.pm-lnk:hover{background:rgba(59,130,246,.25)}
.xb-lnk{background:rgba(245,158,11,.1);color:var(--amber)}
.xb-lnk:hover{background:rgba(245,158,11,.25)}

/* ─── ODDS TABLE ─── */
.ev-odds{display:none;padding:6px 14px 10px;border-top:1px solid var(--border);background:var(--bg)}
.ev.open .ev-odds{display:block}
.odds-grid{display:grid;grid-template-columns:1fr 55px 55px 50px 50px 50px 50px 58px;gap:0;font-size:11px}
.odds-hd{padding:4px 6px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
.odds-hd:nth-child(2){text-align:center;color:var(--blue)}
.odds-hd:nth-child(3){text-align:center;color:var(--amber)}
.odds-hd:nth-child(4){text-align:center;color:var(--green)}
.odds-hd:nth-child(5){text-align:center}
.odds-hd:nth-child(6){text-align:center;color:#ec4899}
.odds-hd:nth-child(7){text-align:center;color:#8b5cf6}
.odds-cell{padding:4px 6px;border-bottom:1px solid rgba(30,41,59,.4)}
.odds-lbl{color:var(--text-dim);font-weight:500}
.odds-pm,.odds-xb,.odds-kb,.odds-pn,.odds-ts,.odds-sf{text-align:center;font-family:'SF Mono','Cascadia Code',monospace;font-weight:500}
.odds-pm{color:var(--blue)}.odds-xb{color:var(--amber)}.odds-kb{color:var(--green)}.odds-pn{color:var(--text-muted)}.odds-ts{color:#ec4899}.odds-sf{color:#8b5cf6}
.odds-edge{text-align:center;font-family:'SF Mono','Cascadia Code',monospace;font-weight:600}
.odds-edge.pos{color:var(--green)}.odds-edge.neg{color:var(--red)}
.odds-edge.hot{color:var(--green);background:rgba(16,185,129,.08);border-radius:3px}

/* ─── RIGHT PANEL ─── */
.panel-right{background:var(--bg-card);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
@media(max-width:1100px){.panel-right{border-left:none;border-top:1px solid var(--border)}}

/* ─── RIGHT PANEL TABS ─── */
.rp-tabs{display:flex;border-bottom:1px solid var(--border);background:var(--bg)}
.rp-tab{padding:10px 14px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;user-select:none}
.rp-tab:hover{color:var(--text)}
.rp-tab.active{color:var(--green);border-bottom-color:var(--green)}
.rp-tab.active.rp-race{color:var(--amber);border-bottom-color:var(--amber)}
.rp-tab.active.rp-trades{color:var(--blue);border-bottom-color:var(--blue)}
.rp-content{flex:1;overflow-y:auto;display:none;padding:10px 14px}
.rp-content.active{display:block}

/* ─── SESSION STATS ─── */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-top:8px}
.stat-item{display:flex;justify-content:space-between;align-items:center;font-size:11px}
.stat-item .stat-k{color:var(--text-muted)}
.stat-item .stat-v{font-family:'SF Mono','Cascadia Code',monospace;font-weight:600;color:var(--text)}

/* ─── RACE LOG ─── */
.race-row{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;font-family:'SF Mono','Cascadia Code',monospace}
.race-row .race-age{color:var(--text-muted);min-width:32px;display:inline-block}
.race-row .race-winner{color:var(--green);font-weight:700}
.race-row .race-match{color:var(--text)}
.race-row .race-score{color:var(--amber);font-weight:600}
.race-row .race-times{color:var(--text-muted);font-size:10px}

/* ─── TRADE LOG ─── */
.trade-row{padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px}
.trade-row .trade-action{font-weight:700;font-size:10px;padding:2px 6px;border-radius:3px;letter-spacing:.3px}
.trade-row .trade-action.buy{background:rgba(16,185,129,.12);color:var(--green)}
.trade-row .trade-action.sell{background:rgba(239,68,68,.12);color:var(--red)}
.trade-row .trade-match{font-weight:600;font-size:12px;margin-top:3px}
.trade-row .trade-detail{color:var(--text-muted);font-size:10px;margin-top:2px;font-family:'SF Mono','Cascadia Code',monospace}

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
      <span>PM <b id="s-events">0</b></span>
      <span>Dual <b id="s-dual">0</b></span>
      <span>Live <b id="s-live" class="live-count">0</b></span>
      <span>Goals <b id="s-goals">0</b></span>
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
      <div class="tab tab-goals" id="tab-goals" onclick="setTab(&quot;goals&quot;)"><span class="sec-dot" style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>GOALS <span class="tab-cnt" id="tab-goals-cnt">0</span></div>
    </div>
    <div class="tab-content active" id="sec-live"></div>
    <div class="tab-content" id="sec-up"></div>
    <div class="tab-content" id="sec-goals"></div>
  </div>
  <div class="panel-right">
    <div class="rp-tabs">
      <div class="rp-tab active" id="rpt-stats" onclick="setRpTab(&quot;stats&quot;)">Stats</div>
      <div class="rp-tab rp-race" id="rpt-race" onclick="setRpTab(&quot;race&quot;)">Race</div>
      <div class="rp-tab rp-trades" id="rpt-trades" onclick="setRpTab(&quot;trades&quot;)">Trades</div>
    </div>
    <div class="rp-content active" id="rpc-stats"></div>
    <div class="rp-content" id="rpc-race"></div>
    <div class="rp-content" id="rpc-trades"></div>
  </div>
</div>

<script>
var ws, state=null, sportFilter='all', activeTab='live', activeRpTab='stats', openEvents=new Set(), closedGroups=new Set(), startedAt=0;

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
function hasPM(ev){return Object.keys(ev.markets).some(function(k){if(k.startsWith('__'))return false;var s=Object.keys(ev.markets[k]);return s.indexOf('polymarket')>=0;});}
function hasMulti(ev){return Object.keys(ev.markets).some(function(k){if(k.startsWith('__'))return false;var s=Object.keys(ev.markets[k]);return s.indexOf('polymarket')>=0&&(s.indexOf('onexbet')>=0||s.indexOf('kambi')>=0||s.indexOf('pinnacle')>=0||s.indexOf('thesports')>=0||s.indexOf('sofascore')>=0);});}
function getFiltered(){
  if(!state)return{live:[],upcoming:[]};
  var live=[],up=[];
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(!hasPM(ev))continue;
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
  var pmCount=d.live.length+(d.upcoming?d.upcoming.length:0);
  var dualCount=0;
  for(var i=0;i<d.live.length;i++){if(hasMulti(d.live[i]))dualCount++;}
  if(d.upcoming){for(var i=0;i<d.upcoming.length;i++){if(hasMulti(d.upcoming[i]))dualCount++;}}
  document.getElementById('s-events').textContent=pmCount;
  document.getElementById('s-dual').textContent=dualCount;
  document.getElementById('s-live').textContent=d.live.length;
  document.getElementById('s-goals').textContent=(state.speedLog||[]).length+(state.reactionLog||[]).length;
  document.getElementById('s-time').textContent=new Date().toLocaleTimeString();
  renderAdapters();
  renderSportPills();
  renderLive(d.live);
  renderUpcoming(d.upcoming);
  renderGoals();
  renderSession();
  renderRace();
  renderTrades();
}

function renderAdapters(){
  var el=document.getElementById('adapters');
  var h='';
  var entries=Object.entries(state.adapters);
  for(var i=0;i<entries.length;i++){
    var id=entries[i][0],s=entries[i][1];
    var cls=s==='connected'?'ad-on':s==='error'?'ad-off':'ad-warn';
    var label=id==='polymarket'?'PM':id==='onexbet'?'1xBet':id==='kambi'?'Kambi':id==='pinnacle'?'Pinn':id==='thesports'?'TSprt':id==='sofascore'?'Sofa':id;
    h+='<div class="adapter"><div class="ad '+cls+'"></div>'+label+'</div>';
  }
  el.innerHTML=h;
}

function renderSportPills(){
  var counts={};
  for(var i=0;i<state.events.length;i++){
    var ev=state.events[i];
    if(!hasPM(ev))continue;
    var grp=sportGroup(ev.sport);
    counts[grp]=(counts[grp]||0)+1;
  }
  var sorted=Object.entries(counts).sort(function(a,b){if(a[0]==='Soccer')return -1;if(b[0]==='Soccer')return 1;return b[1]-a[1];});
  var total=sorted.reduce(function(s,e){return s+e[1];},0);
  var el=document.getElementById('sport-bar');
  if(total===0){el.innerHTML='<div class="pill active">No Polymarket events yet</div>';return;}
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
  document.getElementById('tab-goals').className=t==='goals'?'tab tab-goals active':'tab tab-goals';
  document.getElementById('sec-live').className=t==='live'?'tab-content active':'tab-content';
  document.getElementById('sec-up').className=t==='upcoming'?'tab-content active':'tab-content';
  document.getElementById('sec-goals').className=t==='goals'?'tab-content active':'tab-content';
}
function setRpTab(t){
  activeRpTab=t;
  var tabs=['stats','race','trades'];
  for(var i=0;i<tabs.length;i++){
    var tid=tabs[i];
    document.getElementById('rpt-'+tid).className=tid===t?'rp-tab'+(tid!=='stats'?' rp-'+tid:'')+' active':'rp-tab'+(tid!=='stats'?' rp-'+tid:'');
    document.getElementById('rpc-'+tid).className=tid===t?'rp-content active':'rp-content';
  }
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
  var srcMap={polymarket:{l:'PM',c:'pm'},onexbet:{l:'1xBet',c:'xbet'},kambi:{l:'Kambi',c:'kambi'},pinnacle:{l:'Pinn',c:'pinn'},thesports:{l:'TSprt',c:'thesports'},sofascore:{l:'Sofa',c:'sofascore'}};
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
  var h='<div class="odds-grid"><div class="odds-hd">Market</div><div class="odds-hd">PM</div><div class="odds-hd">1xBet</div><div class="odds-hd">Kambi</div><div class="odds-hd">Pinn</div><div class="odds-hd">TSprt</div><div class="odds-hd">Sofa</div><div class="odds-hd">Edge</div>';
  for(var i=0;i<Math.min(sorted.length,15);i++){
    var k=sorted[i],srcs=ev.markets[k];
    var pm=srcs.polymarket,xb=srcs.onexbet,kb=srcs.kambi,pn=srcs.pinnacle,ts=srcs.thesports,sf=srcs.sofascore;
    var pmP=pm?(1/pm.value*100):null;
    var xbP=xb?(1/xb.value*100):null;
    var kbP=kb?(1/kb.value*100):null;
    var pnP=pn?(1/pn.value*100):null;
    var tsP=ts?(1/ts.value*100):null;
    var sfP=sf?(1/sf.value*100):null;
    // Edge: best secondary vs PM
    var allSec=[xbP,kbP,pnP,tsP,sfP].filter(function(v){return v!==null;});
    var secBest=allSec.length>0?Math.max.apply(null,allSec):null;
    var edge=(pmP!==null&&secBest!==null)?secBest-pmP:null;
    var edgeAbs=edge!==null?Math.abs(edge):0;
    var edgeCls=edgeAbs>=3?'hot':edge!==null&&edge>0?'pos':'neg';
    h+='<div class="odds-cell odds-lbl">'+fmtKey(k)+'</div>'
      +'<div class="odds-cell odds-pm">'+(pmP!==null?pmP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-xb">'+(xbP!==null?xbP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-kb">'+(kbP!==null?kbP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-pn">'+(pnP!==null?pnP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-ts">'+(tsP!==null?tsP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-sf">'+(sfP!==null?sfP.toFixed(1)+'%':'\\u2014')+'</div>'
      +'<div class="odds-cell odds-edge '+edgeCls+'">'+(edge!==null?(edge>0?'+':'')+edge.toFixed(1)+'%':'\\u2014')+'</div>';
  }
  h+='</div>';
  return h;
}

/* ─── Score Race Tab ─── */
function renderRace(){
  var el=document.getElementById('rpc-race');
  var speedLog=state.speedLog||[];
  if(speedLog.length===0){el.innerHTML='<div class="empty">No score races yet<br><span style="font-size:11px;margin-top:4px;display:block">Races appear when multiple sources detect the same score change</span></div>';return;}

  // Collect all sources seen across all races
  var allSrcs={};
  for(var i=0;i<speedLog.length;i++){var times=speedLog[i].times||[];for(var j=0;j<times.length;j++)allSrcs[times[j].src]=1;}
  var srcList=Object.keys(allSrcs).sort();

  var h='<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:\\'SF Mono\\',\\'Cascadia Code\\',monospace">';
  h+='<thead><tr style="border-bottom:1px solid var(--border)">';
  h+='<th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-size:10px">MATCH</th>';
  h+='<th style="text-align:center;padding:4px 4px;color:var(--amber);font-size:10px">SCORE</th>';
  for(var si=0;si<srcList.length;si++){
    h+='<th style="text-align:center;padding:4px 3px;color:var(--text-muted);font-size:9px;min-width:44px">'+fmtSrcName(srcList[si])+'</th>';
  }
  h+='</tr></thead><tbody>';

  for(var i=0;i<Math.min(speedLog.length,60);i++){
    var sl=speedLog[i];
    var age=Math.round((Date.now()-sl.ts)/1000);
    var ageStr=age<60?age+'s':age<3600?Math.floor(age/60)+'m':Math.floor(age/3600)+'h';
    var srcMs={},times=sl.times||[],minMs=Infinity;
    for(var j=0;j<times.length;j++){srcMs[times[j].src]=times[j].ms;if(times[j].ms<minMs)minMs=times[j].ms;}

    h+='<tr style="border-bottom:1px solid rgba(255,255,255,0.03)">';
    h+='<td style="padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px"><span style="color:var(--text-muted);font-size:9px">'+ageStr+'</span> '+sl.match+'</td>';
    h+='<td style="text-align:center;padding:4px 4px;color:var(--amber);font-weight:700">'+sl.score+'</td>';
    for(var si=0;si<srcList.length;si++){
      var ms=srcMs[srcList[si]];
      if(ms===undefined){
        h+='<td style="text-align:center;padding:4px 3px;color:var(--border-h)">\\u2014</td>';
      } else {
        var isWin=ms===minMs;
        var delta=ms-minMs;
        var col=isWin?'var(--green)':delta<500?'var(--text)':delta<2000?'var(--amber)':'var(--red)';
        var txt=isWin?'\\u2714 0':'+'+delta;
        h+='<td style="text-align:center;padding:4px 3px;color:'+col+';font-weight:'+(isWin?'700':'400')+'">'+txt+'<span style="font-size:8px;opacity:.6">ms</span></td>';
      }
    }
    h+='</tr>';
  }
  h+='</tbody></table>';
  el.innerHTML=h;
}

/* ─── Trades Tab ─── */
function renderTrades(){
  var el=document.getElementById('rpc-trades');
  var trading=state.trading;
  if(!trading){el.innerHTML='<div class="empty">Trading not configured<br><span style="font-size:11px;margin-top:4px;display:block">No POLY_PRIVATE_KEY in env</span></div>';return;}
  var gt=trading.goalTrader||{};
  var gtEnabled=gt.enabled;
  var gtArmed=trading.armed;
  var h='';

  // Control buttons
  h+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
  h+='<button onclick="sendCmd(\\'goaltrader '+(gtEnabled?'off':'on')+'\\')" style="padding:5px 12px;border-radius:4px;border:1px solid '+(gtEnabled?'var(--red)':'var(--green)')+';background:'+(gtEnabled?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)')+';color:'+(gtEnabled?'var(--red)':'var(--green)')+';font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px">'+(gtEnabled?'DISABLE GT':'ENABLE GT')+'</button>';
  h+='<button onclick="sendCmd(\\''+(!gtArmed?'arm':'disarm')+'\\')" style="padding:5px 12px;border-radius:4px;border:1px solid '+(gtArmed?'var(--green)':'var(--red)')+';background:'+(gtArmed?'rgba(16,185,129,.1)':'rgba(239,68,68,.08)')+';color:'+(gtArmed?'var(--green)':'var(--red)')+';font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px">'+(gtArmed?'DISARM BOT':'ARM BOT')+'</button>';
  if(state.fastestSource)h+='<span style="font-size:10px;font-weight:600;padding:5px 10px;border-radius:4px;background:rgba(245,158,11,.08);color:var(--amber);border:1px solid rgba(245,158,11,.2)">\\u26A1 '+fmtSrcName(state.fastestSource)+'</span>';
  h+='</div>';

  // Status badges
  h+='<div style="display:flex;gap:6px;margin-bottom:10px">';
  h+='<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;'+(gtEnabled?'background:rgba(16,185,129,.12);color:var(--green)':'background:rgba(239,68,68,.12);color:var(--red)')+'">GT '+(gtEnabled?'ON':'OFF')+'</span>';
  h+='<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;'+(gtArmed?'background:rgba(239,68,68,.15);color:var(--red)':'background:rgba(100,116,139,.12);color:var(--text-muted)')+'">'+(gtArmed?'ARMED':'DRY RUN')+'</span>';
  var tc=gt.totalTrades||0;
  var totalPnl=gt.totalPnl||0;
  h+='<span style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.04);color:var(--text-dim)">'+tc+' trades</span>';
  if(tc>0)h+='<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.04);color:'+(totalPnl>=0?'var(--green)':'var(--red)')+'">'+(totalPnl>=0?'+':'')+totalPnl.toFixed(3)+'</span>';
  h+='</div>';

  // Goal Activity Log
  var goalLog=gt.goalLog||[];
  h+='<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Goal Activity <span style="font-weight:400">('+goalLog.length+')</span></div>';

  if(goalLog.length===0){
    h+='<div class="empty-sm">No goal events yet — '+(gtEnabled?'waiting for score changes':'enable GT to start')+'</div>';
  } else {
    for(var i=0;i<Math.min(goalLog.length,80);i++){
      var g=goalLog[i];
      var age=Math.round((Date.now()-g.ts)/1000);
      var ageStr=age<60?age+'s':age<3600?Math.floor(age/60)+'m':Math.floor(age/3600)+'h';

      var actionCol='var(--text-muted)';
      var actionBg='rgba(100,116,139,.1)';
      var actionLabel=g.action;
      if(g.action==='BUY'){actionCol='var(--green)';actionBg='rgba(16,185,129,.12)';actionLabel='\\u2714 BOUGHT';}
      else if(g.action==='DRY_BUY'){actionCol='var(--blue)';actionBg='rgba(59,130,246,.12)';actionLabel='DRY BUY';}
      else if(g.action==='PENDING'){actionCol='var(--amber)';actionBg='rgba(245,158,11,.12)';actionLabel='\\u23F3 PENDING';}
      else if(g.action==='SKIP'){actionCol='var(--text-muted)';actionBg='rgba(100,116,139,.08)';actionLabel='\\u2716 SKIP';}

      h+='<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03)">';
      h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">';
      h+='<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;background:'+actionBg+';color:'+actionCol+'">'+actionLabel+'</span>';
      h+='<span style="font-size:12px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+g.match+'</span>';
      h+='<span style="font-size:10px;color:var(--text-muted);white-space:nowrap">'+ageStr+'</span>';
      h+='</div>';

      h+='<div style="display:flex;align-items:center;gap:8px;font-size:10px;font-family:\\'SF Mono\\',\\'Cascadia Code\\',monospace">';
      h+='<span style="color:var(--amber);font-weight:600">'+(g.prevScore||'?')+' \\u2192 '+g.score+'</span>';
      h+='<span style="color:var(--text-muted)">via '+fmtSrcName(g.source)+'</span>';
      if(g.goalType)h+='<span style="color:var(--text-dim)">'+g.goalType+'</span>';
      h+='</div>';

      // Trade details or skip reason
      if(g.trade){
        h+='<div style="font-size:10px;font-family:\\'SF Mono\\',\\'Cascadia Code\\',monospace;margin-top:2px;color:var(--green)">';
        h+=g.trade.side+' '+g.trade.market+' @ '+(g.trade.price*100).toFixed(1)+'% · $'+g.trade.size;
        if(g.trade.latencyMs)h+=' · '+g.trade.latencyMs+'ms';
        h+='</div>';
      } else if(g.action==='SKIP'||g.action==='PENDING'){
        h+='<div style="font-size:10px;color:var(--text-muted);margin-top:1px">'+g.reason+'</div>';
      }
      h+='</div>';
    }
  }
  el.innerHTML=h;
}

function sendCmd(cmd){
  fetch('/api/trading/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd})})
    .then(function(r){return r.json();})
    .then(function(d){if(d.result)console.log('CMD:',d.result);if(d.error)console.error('CMD error:',d.error);})
    .catch(function(e){console.error('CMD failed:',e);});
}

/* ─── Goals Tab ─── */
function renderGoals(){
  var speedLog=state.speedLog||[];
  var reactions=state.reactionLog||[];
  var el=document.getElementById('sec-goals');
  var totalGoals=speedLog.length+reactions.length;
  document.getElementById('tab-goals-cnt').textContent=totalGoals;
  if(totalGoals===0){el.innerHTML='<div class="empty">No goals detected yet<br><span style="font-size:11px;margin-top:4px;display:block">Goals appear when score changes are detected across sources</span></div>';return;}

  // Build source win stats from speedLog
  var srcWins={},srcTimes={},srcCount={};
  for(var i=0;i<speedLog.length;i++){
    var sl=speedLog[i];
    var w=sl.winner;
    srcWins[w]=(srcWins[w]||0)+1;
    var times=sl.times||[];
    for(var j=0;j<times.length;j++){
      var t=times[j];
      if(!srcTimes[t.src])srcTimes[t.src]=[];
      srcTimes[t.src].push(t.ms);
      srcCount[t.src]=(srcCount[t.src]||0)+1;
    }
  }
  // Also count from reaction log
  for(var i=0;i<reactions.length;i++){
    var r=reactions[i];
    var detBy=r.detectedBy;
    if(detBy){srcWins[detBy]=(srcWins[detBy]||0)+1;}
  }

  // Summary stats cards
  var allSources=Object.keys(srcWins).sort(function(a,b){return (srcWins[b]||0)-(srcWins[a]||0);});
  var fastestSrc=allSources[0]||'—';
  var totalDetections=allSources.reduce(function(s,k){return s+srcWins[k];},0);

  var h='<div class="goals-stats">';
  h+='<div class="gs-card"><div class="gs-label">Total Goals</div><div class="gs-value" style="color:var(--green)">'+totalGoals+'</div></div>';
  h+='<div class="gs-card"><div class="gs-label">Fastest Source</div><div class="gs-value" style="color:var(--amber);font-size:14px">'+fmtSrcName(fastestSrc)+'</div><div class="gs-sub">'+((srcWins[fastestSrc]||0)/Math.max(totalDetections,1)*100).toFixed(0)+'% first</div></div>';

  // Per-source win cards
  for(var si=0;si<Math.min(allSources.length,5);si++){
    var sn=allSources[si];
    var wins=srcWins[sn]||0;
    var avgMs=0;
    if(srcTimes[sn]&&srcTimes[sn].length>0){avgMs=Math.round(srcTimes[sn].reduce(function(a,b){return a+b;},0)/srcTimes[sn].length);}
    var pct=(wins/Math.max(totalDetections,1)*100).toFixed(0);
    var col=si===0?'var(--green)':si===1?'var(--amber)':'var(--text-dim)';
    h+='<div class="gs-card"><div class="gs-label">'+fmtSrcName(sn)+'</div><div class="gs-value" style="color:'+col+'">'+wins+'<span style="font-size:11px;font-weight:400"> wins</span></div><div class="gs-sub">'+pct+'% · avg '+avgMs+'ms</div></div>';
  }
  h+='</div>';

  // Goal log rows from speedLog (most detailed — has per-source times)
  var allGoals=[];
  for(var i=0;i<speedLog.length;i++){
    var sl=speedLog[i];
    allGoals.push({ts:sl.ts,match:sl.match,score:sl.score,winner:sl.winner,times:sl.times||[],type:'speed'});
  }
  // Add reaction log goals not already in speedLog
  for(var i=0;i<reactions.length;i++){
    var r=reactions[i];
    var dup=false;
    for(var k=0;k<allGoals.length;k++){if(Math.abs(allGoals[k].ts-r.timestamp)<5000&&allGoals[k].score===r.scoreAfter){dup=true;break;}}
    if(!dup){
      var times=[];
      if(r.detectedBy)times.push({src:r.detectedBy,ms:0});
      var trajs=r.trajectories||[];
      for(var j=0;j<trajs.length;j++){
        var already=times.find(function(x){return x.src===trajs[j].source;});
        if(!already)times.push({src:trajs[j].source,ms:trajs[j].firstReactionMs||0});
      }
      allGoals.push({ts:r.timestamp,match:r.match,score:r.scoreAfter,winner:r.detectedBy||'?',times:times,type:'reaction'});
    }
  }
  allGoals.sort(function(a,b){return b.ts-a.ts;});

  for(var i=0;i<Math.min(allGoals.length,100);i++){
    var g=allGoals[i];
    var age=Math.round((Date.now()-g.ts)/1000);
    var ageStr=age<60?age+'s':age<3600?Math.floor(age/60)+'m '+age%60+'s':Math.floor(age/3600)+'h '+Math.floor((age%3600)/60)+'m';
    var timeStr=new Date(g.ts).toLocaleTimeString();

    // Source colors
    var srcColors={polymarket:'var(--blue)',onexbet:'var(--amber)',kambi:'var(--green)',sofascore:'#8b5cf6',thesports:'#ec4899',pinnacle:'#f59e0b','pm-sports-ws':'var(--blue)',flashscore:'#06b6d4'};
    var winColor=srcColors[g.winner]||'var(--green)';

    h+='<div class="goal-row"><div class="goal-winner" style="background:'+winColor+'"></div><div class="goal-body">';
    h+='<div class="goal-top"><div class="goal-match">'+g.match+'</div><div style="display:flex;align-items:center;gap:8px"><div class="goal-score-change">'+g.score+'</div><div class="goal-time">'+timeStr+' ('+ageStr+' ago)</div></div></div>';
    h+='<div class="goal-sources">';

    // Sort by ms (winner first)
    var sorted=g.times.slice().sort(function(a,b){return a.ms-b.ms;});
    var winnerMs=sorted.length>0?sorted[0].ms:0;
    for(var j=0;j<sorted.length;j++){
      var t=sorted[j];
      var isWin=t.ms===winnerMs;
      var delta=t.ms-winnerMs;
      var srcCol=srcColors[t.src]||'var(--text-dim)';
      h+='<div class="goal-src'+(isWin?' winner':'')+'">';
      h+='<span class="src-name" style="color:'+srcCol+'">'+fmtSrcName(t.src)+'</span> ';
      h+='<span class="src-ms" style="color:'+(isWin?'var(--green)':'var(--text)')+'">'+t.ms+'ms</span>';
      if(!isWin&&delta>0)h+=' <span class="src-delta">+'+delta+'ms</span>';
      if(isWin)h+=' <span style="color:var(--green);font-size:10px">\\u2714</span>';
      h+='</div>';
    }
    h+='</div></div></div>';
  }

  if(allGoals.length===0){h+='<div class="empty-sm">No goal timing data yet</div>';}
  el.innerHTML=h;
}

function fmtSrcName(s){
  if(s==='polymarket'||s==='pm-sports-ws')return 'PM';
  if(s==='onexbet')return '1xBet';
  if(s==='kambi')return 'Kambi';
  if(s==='sofascore')return 'Sofa';
  if(s==='thesports')return 'TSprt';
  if(s==='pinnacle')return 'Pinn';
  if(s==='flashscore')return 'Flash';
  return s;
}

/* ─── Session Stats Tab ─── */
function renderSession(){
  var el=document.getElementById('rpc-stats');
  var upSec=state.uptime||0;
  var hh=Math.floor(upSec/3600),mm=Math.floor((upSec%3600)/60);
  var upStr=hh>0?hh+'h '+mm+'m':mm+'m';
  var reactions=state.reactionLog||[];
  var speedLog=state.speedLog||[];
  var totalGoals=speedLog.length+reactions.length;

  var h='<div class="stat-grid">';
  h+=stat('Uptime',upStr);
  h+=stat('Events',''+state.eventCount);
  h+=stat('Goals',''+totalGoals);
  h+=stat('Races',''+speedLog.length);
  h+='</div>';

  // Adapter latency boxes
  var latStats=state.adapterLatency||{};
  var latSrcs=Object.keys(latStats).sort();
  if(latSrcs.length>0){
    h+='<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px">Adapter Latency</div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:6px">';
    for(var li=0;li<latSrcs.length;li++){
      var ls=latSrcs[li];
      var ld=latStats[ls];
      var lbl=fmtSrcName(ls);
      var latC=ld.avg<200?'var(--green)':ld.avg<1000?'#ffd700':'var(--red)';
      h+='<div style="text-align:center;padding:6px;background:rgba(255,255,255,0.03);border-radius:4px">'
        +'<div style="font-size:10px;color:var(--text-muted)">'+lbl+'</div>'
        +'<div style="font-size:16px;font-weight:700;color:'+latC+'">'+ld.avg+'<span style="font-size:9px">ms</span></div>'
        +'<div style="font-size:9px;color:var(--text-muted)">'+ld.count+' upd</div></div>';
    }
    h+='</div>';
  }

  // Source wins summary
  var srcWins=state.sourceWins||{};
  var winSrcs=Object.keys(srcWins).sort(function(a,b){return srcWins[b]-srcWins[a];});
  if(winSrcs.length>0){
    var totalWins=winSrcs.reduce(function(s,k){return s+srcWins[k];},0);
    h+='<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px">Source Wins</div>';
    for(var wi=0;wi<winSrcs.length;wi++){
      var ws2=winSrcs[wi],wc=srcWins[ws2];
      var pct=Math.round(wc/totalWins*100);
      var barCol=wi===0?'var(--green)':wi===1?'var(--amber)':'var(--text-muted)';
      h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px">';
      h+='<span style="min-width:50px;font-weight:600;color:'+barCol+'">'+fmtSrcName(ws2)+'</span>';
      h+='<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+barCol+';border-radius:3px"></div></div>';
      h+='<span style="font-family:monospace;font-weight:700;min-width:32px;text-align:right">'+wc+'</span>';
      h+='<span style="color:var(--text-muted);font-size:10px;min-width:28px;text-align:right">'+pct+'%</span>';
      h+='</div>';
    }
  }

  el.innerHTML=h;
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
