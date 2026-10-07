// ==UserScript==
// @name         RaceIQ - Faction Battles Module
// @namespace    raceiq.aurora.surrealis.battles
// @version      0.4.6
// @description  Lightweight Faction vs Faction race module for RaceIQ with host-only support, sync, scoring, podium prizes, RNG prizes, and separate history.
// @author       Aurora Surrealis
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';
  if (window.top !== window.self) return;

  const MOD = {
    version: '0.4.6',
    apiBase: 'https://api.torn.com/v2',
    apiKey: '###PDA-APIKEY###',
    storageKey: 'raceiq_faction_battles_v1',
    panelId: 'raceiq-panel',
    tabId: 'raceiq-battles-tab',
    viewId: 'raceiq-battles-view',
    styleId: 'raceiq-battles-style'
  };

  const DEFAULT_TEMPLATE = `Aurora Surrealis vs {opponent}\n\n{format} faction race\n{date} @ {time} TCT\n{track} • {laps} laps • Class {class}\n{upgradesShort}\nPassword: {password}\n\nGood luck!`;

  const DEFAULT_STATE = {
    schema: 1,
    participantMessageTemplate: DEFAULT_TEMPLATE,
    userCache: {},
    battles: []
  };

  let state = null;
  let selectedBattleId = '';

  const clone = x => JSON.parse(JSON.stringify(x));
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const norm = v => String(v || '').trim().replace(/\s+/g,' ').toLowerCase();

  function uid(prefix='battle') {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  }

  async function load() {
    if (typeof PDA_storage !== 'undefined') {
      const saved = await PDA_storage.get(MOD.storageKey, null);
      state = saved?.schema === 1 ? saved : clone(DEFAULT_STATE);
    } else {
      const raw = localStorage.getItem(MOD.storageKey);
      state = raw ? JSON.parse(raw) : clone(DEFAULT_STATE);
    }
    if (!Array.isArray(state.battles)) state.battles = [];
    if (!state.userCache || typeof state.userCache !== 'object') state.userCache = {};
    if (!state.participantMessageTemplate) state.participantMessageTemplate = DEFAULT_TEMPLATE;

    state.battles.forEach(b => {
      if (!Array.isArray(b.results)) b.results = [];
      if (!Array.isArray(b.rngWinners)) b.rngWinners = [];
      if (!Array.isArray(b.ourRoster)) b.ourRoster = [];
      if (!Array.isArray(b.opponentRoster)) b.opponentRoster = [];
      if (!Array.isArray(b.placementAwards)) b.placementAwards = [];
      if (!b.placementPrizes) b.placementPrizes = {first:'',second:'',third:''};
      if (!b.rngPrize) b.rngPrize = {prize:'Xanax',qtyPerWinner:1,winnerCount:0,finishersOnly:true,excludePodium:false};
      if (!b.hostParticipation) b.hostParticipation = 'HOST_ONLY';
      if (b.hostName == null) b.hostName = '_samara_';
      if (b.hostId == null) b.hostId = '';
      if (!Array.isArray(b.ignoredHostResults)) b.ignoredHostResults = [];
      if (!b.syncedAt) b.syncedAt = '';
      if (!b.closedAt) b.closedAt = '';
    });
    await save();
  }

  async function save() {
    if (typeof PDA_storage !== 'undefined') await PDA_storage.set(MOD.storageKey, state);
    else localStorage.setItem(MOD.storageKey, JSON.stringify(state));
  }

  function newBattle() {
    const b = {
      id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status:'DRAFT', opponent:'', format:'4v4', date:'', time:'2200', track:'', laps:60,
      raceClass:'E', noUpgrades:true, password:'', raceId:'',
      hostParticipation:'HOST_ONLY', hostName:'_samara_', hostId:'', ignoredHostResults:[],
      ourRoster:[], opponentRoster:[],
      placementPrizes:{first:'',second:'',third:''},
      rngPrize:{prize:'Xanax',qtyPerWinner:1,winnerCount:0,finishersOnly:true,excludePodium:false},
      results:[], teamScore:null, placementAwards:[], rngWinners:[], syncedAt:'', closedAt:''
    };
    state.battles.unshift(b);
    selectedBattleId = b.id;
    return b;
  }

  function selectedBattle() { return state.battles.find(b => b.id === selectedBattleId) || state.battles[0] || null; }
  function teamSize(b) { return b.format === '8v8' ? 8 : 4; }
  function expectedCompetitors(b) { return teamSize(b) * 2; }
  function isLocked(b) { return b?.status === 'CLOSED'; }

  function renderParticipantMessage(b) {
    const vals = {
      opponent:b.opponent || 'Opponent Faction', format:b.format || '4v4', date:b.date || 'TBD', time:b.time || '2200',
      track:b.track || 'TBD', laps:b.laps || 60, class:b.raceClass || 'E',
      upgradesShort:b.noUpgrades ? 'NO UPGRADES.' : 'Upgrades allowed.', password:b.password || 'TBD'
    };
    return String(state.participantMessageTemplate || DEFAULT_TEMPLATE)
      .replace(/\{([a-zA-Z0-9]+)\}/g, (_,k) => Object.prototype.hasOwnProperty.call(vals,k) ? String(vals[k]) : `{${k}}`)
      .replace(/\n{3,}/g,'\n\n').trim();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); }
    catch (_) { window.prompt('Copy this text:', text); }
  }

  function toast(msg) {
    let el = document.getElementById('raceiq-battles-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'raceiq-battles-toast';
      el.style.cssText='position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#eaf0f6;color:#111;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px Arial;box-shadow:0 3px 15px #0008';
      document.body.appendChild(el);
    }
    el.textContent=msg; el.style.display='block'; setTimeout(()=>el.style.display='none',2200);
  }

  async function apiGet(path, allow404=false) {
    const url = MOD.apiBase + path;
    const headers = {'Authorization':`ApiKey ${MOD.apiKey}`,'Accept':'application/json'};
    if (typeof PDA_httpGet === 'function') {
      const r = await PDA_httpGet(url, headers); const status=Number(r?.status||0); let data={};
      try { data=JSON.parse(r?.responseText||'{}'); } catch (_) {}
      if (status>=200 && status<300 && !data?.error) return data;
      if (allow404 && [400,404].includes(status)) return null;
      throw new Error(`Torn API: ${data?.error?.error || data?.error?.message || r?.responseText || `HTTP ${status}`}`);
    }
    const res=await fetch(url,{headers}); const data=await res.json().catch(()=>({}));
    if (res.ok && !data?.error) return data;
    if (allow404 && [400,404].includes(res.status)) return null;
    throw new Error(`Torn API: ${data?.error?.error || data?.error?.message || res.statusText}`);
  }

  function unwrapRace(payload,id) {
    if (payload?.race && !Array.isArray(payload.race)) return payload.race;
    if (payload?.races) {
      const arr=Array.isArray(payload.races)?payload.races:Object.values(payload.races);
      return arr.find(r=>String(r.id??r.race_id??'')===String(id)) || payload;
    }
    return payload;
  }

  async function fetchRace(id) {
    let data=await apiGet(`/racing/${encodeURIComponent(id)}/race`,true); if (data) return unwrapRace(data,id);
    data=await apiGet(`/racing?selections=race&id=${encodeURIComponent(id)}`,true); if (data) return unwrapRace(data,id);
    throw new Error(`Race ${id} was not returned by Torn.`);
  }

  function battleScheduledTs(b) {
    const date=String(b?.date||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const digits=String(b?.time||'2200').replace(/\D/g,'').padStart(4,'0').slice(-4);
    const ms=Date.parse(`${date}T${digits.slice(0,2)}:${digits.slice(2,4)}:00Z`);
    return Number.isFinite(ms) ? Math.floor(ms/1000) : 0;
  }

  function normalizeRaceList(payload) {
    const src=payload?.races;
    const raw=Array.isArray(src) ? src : (src && typeof src==='object' ? Object.values(src) : []);
    return raw.map(r=>({
      id:String(r.id??r.race_id??''),
      title:String(r.title??r.name??r.race_name??'').trim(),
      status:String(r.status??r.state??'').trim(),
      start:Number(r.schedule?.start??r.start_time??0)||0,
      participants:Number(r.participants?.current??r.participants??0)||0
    })).filter(r=>r.id);
  }

  async function findBattleRace(b) {
    if(isLocked(b)) throw new Error('This battle is CLOSED.');

    const target=battleScheduledTs(b);
    const merged=new Map();
    const sources=[];

    // Best source first: races the current API-key owner has actually been involved with.
    try {
      const mine=normalizeRaceList(await apiGet('/user/races?cat=custom&limit=100&sort=DESC'));
      mine.forEach(r=>{ if(r.id) merged.set(String(r.id),{...r,source:'MY_RACES'}); });
      if(mine.length) sources.push(`My races: ${mine.length}`);
    } catch (_) {}

    // Fallback/global discovery. Torn's racing list can include open, in-progress and finished races.
    const requests=[
      '/racing/races?cat=custom&limit=100&sort=DESC',
      '/racing/races?cat=custom&limit=100&sort=ASC'
    ];
    if(target) {
      requests.push(`/racing/races?cat=custom&limit=100&sort=ASC&from=${target-(7*24*60*60)}&to=${target+(7*24*60*60)}`);
      requests.push(`/racing/races?cat=custom&limit=100&sort=DESC&from=${target-(24*60*60)}&to=${target+(24*60*60)}`);
    }

    for(const path of requests) {
      try {
        const list=normalizeRaceList(await apiGet(path));
        list.forEach(r=>{
          if(!r.id) return;
          const key=String(r.id);
          if(!merged.has(key)) merged.set(key,{...r,source:'GLOBAL'});
        });
      } catch (_) {}
    }

    const races=[...merged.values()];
    if(!races.length) throw new Error('Torn returned no races from either My Races or the global custom-race searches.');

    let ranked=races.sort((a,z)=>{
      // Saved battle date/time is the strongest signal. "My race" is only a tiebreaker.
      if(target) {
        const ad=a.start?Math.abs(a.start-target):Number.MAX_SAFE_INTEGER;
        const zd=z.start?Math.abs(z.start-target):Number.MAX_SAFE_INTEGER;
        if(ad!==zd) return ad-zd;
      }
      if(a.source!==z.source) return a.source==='MY_RACES' ? -1 : 1;
      return (z.start||0)-(a.start||0);
    });

    // When a battle date/time exists, keep the picker focused on that day/window instead
    // of letting newer races crowd the wanted race out of the list.
    if(target) {
      const within24=ranked.filter(r=>r.start && Math.abs(r.start-target)<=24*60*60);
      if(within24.length) ranked=within24;
    }

    b.raceChoices=ranked.slice(0,100);
    b.updatedAt=new Date().toISOString();
    await save();
    renderBattles();
    const targetText=target ? new Date(target*1000).toISOString().slice(0,16).replace('T',' ')+' TCT' : 'saved time';
    toast(`Found ${b.raceChoices.length} races near ${targetText}.`);
    return null;
  }

  function raceChoicesHtml(b) {
    const choices=Array.isArray(b.raceChoices)?b.raceChoices:[];
    if(!choices.length) return '';
    return `<div class="rib-card"><h3>Select Race</h3><div class="rib-small">Races closest to the saved battle date/time are shown first. MY RACE is used only as a secondary match.</div>${choices.map(r=>{
      const when=r.start ? new Date(r.start*1000).toISOString().slice(0,16).replace('T',' ')+' TCT' : 'Time unknown';
      const count=r.participants ? ` • ${r.participants} racers` : '';
      return `<button class="rib-btn secondary" style="width:100%;text-align:left;margin-top:7px" data-rib-action="choose-race" data-race-id="${esc(r.id)}"><b>${r.source==='MY_RACES'?'★ ':''}${esc(r.title||'Untitled race')}</b><br><span class="rib-small">${esc(when+count)} • ID ${esc(r.id)}${r.source==='MY_RACES'?' • MY RACE':''}</span></button>`;
    }).join('')}<button class="rib-btn secondary" data-rib-action="cancel-race-list">Cancel</button></div>`;
  }

  async function chooseBattleRace(b,raceId) {
    const chosen=(b.raceChoices||[]).find(r=>String(r.id)===String(raceId));
    if(!chosen) throw new Error('That race is no longer in the finder list. Run Find Race again.');
    b.raceId=chosen.id;
    b.foundRaceTitle=chosen.title||'';
    b.foundRaceAt=chosen.start||0;
    b.raceChoices=[];
    b.updatedAt=new Date().toISOString();
    await save();
    return chosen;
  }

  function extractRacers(race) {
    if (!race) return [];
    const keys=['racers','drivers','participants','results','cars']; let raw=null;
    for (const k of keys) if (Array.isArray(race[k])) { raw=race[k]; break; }
    if (!raw && race.race) return extractRacers(race.race);
    if (!raw) return [];
    return raw.map(r=>({
      id:String(r.driver_id??r.user_id??r.player_id??r.id??r.user?.id??r.driver?.id??''),
      name:String(r.driver_name??r.user_name??r.player_name??r.name??r.user?.name??r.driver?.name??'').trim(),
      finish:Number(r.position??r.place??r.rank??r.result?.position??0)||0
    })).filter(r=>r.id||r.name);
  }

  async function resolveName(id) {
    const clean=String(id||'').trim(); if (!clean) return '';
    const cached=String(state.userCache?.[clean]||'').trim(); if (cached) return cached;
    try {
      const data=await apiGet(`/user/${encodeURIComponent(clean)}/basic`);
      for (const x of [data?.profile,data?.basic,data?.user,data?.player,data].filter(Boolean)) {
        const name=String(x?.name??x?.user_name??x?.player_name??'').trim();
        if (name) { state.userCache[clean]=name; return name; }
      }
    } catch (_) {}
    return '';
  }

  async function resolveResults(rows) {
    const out=[];
    for (const r of rows) {
      const x={...r}; if (!x.name && x.id) x.name=await resolveName(x.id); if (x.id&&x.name) state.userCache[x.id]=x.name; out.push(x);
    }
    return out;
  }

  function isHostRacer(b,r) {
    const id=String(r?.id||'').trim(); const name=norm(r?.name);
    const hostId=String(b.hostId||'').trim(); const hostName=norm(b.hostName);
    return Boolean((hostId && id===hostId) || (hostName && name===hostName));
  }

  function rosterTeamForName(b,name) {
    const k=norm(name); if (!k) return '';
    if ((b.ourRoster||[]).some(x=>norm(x)===k)) return 'AURORA';
    if ((b.opponentRoster||[]).some(x=>norm(x)===k)) return 'OPPONENT';
    return '';
  }

  function scoreBattle(b) {
    const maxPoints=expectedCompetitors(b);
    const scored=(b.results||[]).filter(r=>r.finish>0&&r.team).map(r=>({...r,teamPoints:Math.max(0,maxPoints+1-r.finish)}));
    const ours=scored.filter(r=>r.team==='AURORA'), theirs=scored.filter(r=>r.team==='OPPONENT');
    const ourScore=ours.reduce((s,r)=>s+r.teamPoints,0), oppScore=theirs.reduce((s,r)=>s+r.teamPoints,0);
    const a=ours.map(r=>r.finish).sort((x,y)=>x-y), t=theirs.map(r=>r.finish).sort((x,y)=>x-y);
    let winner='TIE';
    if (ourScore>oppScore) winner='AURORA'; else if (oppScore>ourScore) winner='OPPONENT'; else {
      for (let i=0;i<Math.max(a.length,t.length);i++) { const x=a[i]??9999,y=t[i]??9999; if(x<y){winner='AURORA';break;} if(y<x){winner='OPPONENT';break;} }
    }
    b.results=scored.sort((x,y)=>x.finish-y.finish);
    b.teamScore={aurora:ourScore,opponent:oppScore,winner,tiebreak:'score → best finish → next-best finish'};
    b.placementAwards=b.results.slice(0,3).map((r,i)=>({place:i+1,racerId:r.id,racer:r.name,team:r.team,prize:i===0?b.placementPrizes.first:i===1?b.placementPrizes.second:b.placementPrizes.third}));
  }

  async function syncBattleResults(b) {
    if (isLocked(b)) throw new Error('This battle is CLOSED. Reopen it before changing results.');
    if (!b.raceId) throw new Error('Enter the Torn Race ID first.');
    const required=teamSize(b);
    if ((b.ourRoster||[]).length!==required || (b.opponentRoster||[]).length!==required) throw new Error(`${b.format} requires exactly ${required} racers on each saved roster before scoring.`);
    if (b.hostParticipation==='HOST_ONLY' && !String(b.hostName||'').trim() && !String(b.hostId||'').trim()) throw new Error('Enter the host racer name or ID before using Host only mode.');

    const race=await fetchRace(b.raceId);
    let racers=await resolveResults(extractRacers(race));
    if (!racers.length) throw new Error('Torn returned no racers for this race yet.');

    b.ignoredHostResults=[];
    if (b.hostParticipation==='HOST_ONLY') {
      b.ignoredHostResults=racers.filter(r=>isHostRacer(b,r));
      racers=racers.filter(r=>!isHostRacer(b,r));
    }

    // Re-rank after removing a host-only entry so team scoring and podium use competitor-only positions.
    racers=racers.filter(r=>r.finish>0).sort((a,b)=>a.finish-b.finish).map((r,i)=>({...r,rawFinish:r.finish,finish:i+1}));

    const mapped=racers.map(r=>({...r,team:rosterTeamForName(b,r.name)}));
    const rostered=mapped.filter(r=>r.team); const unknown=mapped.filter(r=>!r.team); const expected=expectedCompetitors(b);
    if (rostered.length!==expected) {
      const unknownText=unknown.length?` Unmatched racer(s): ${unknown.map(x=>x.name||x.id||'?').join(', ')}.`:'';
      throw new Error(`Matched ${rostered.length}/${expected} expected competitors.${unknownText} Check roster spelling and Host participation.`);
    }

    b.results=rostered; b.syncedAt=new Date().toISOString(); b.status='RESULTS'; scoreBattle(b); b.updatedAt=new Date().toISOString(); await save();
    return {imported:b.results.length,ignoredHost:b.ignoredHostResults.length,aurora:b.teamScore.aurora,opponent:b.teamScore.opponent,winner:b.teamScore.winner};
  }

  function secureRandomInt(max) {
    if (max<=1) return 0;
    if (window.crypto?.getRandomValues) { const limit=Math.floor(0x100000000/max)*max; const buf=new Uint32Array(1); let v; do{window.crypto.getRandomValues(buf);v=buf[0];}while(v>=limit); return v%max; }
    return Math.floor(Math.random()*max);
  }
  function randomUnique(items,count) { const a=[...items]; for(let i=a.length-1;i>0;i--){const j=secureRandomInt(i+1);[a[i],a[j]]=[a[j],a[i]];} return a.slice(0,Math.min(count,a.length)); }

  async function runBattleRng(b) {
    if (isLocked(b)) throw new Error('This battle is CLOSED.');
    if (!(b.results||[]).length) throw new Error('Sync official race results before running RNG.');
    if ((b.rngWinners||[]).length) throw new Error('RNG has already been run for this battle.');
    const count=Math.max(0,Number(b.rngPrize?.winnerCount||0)); if(!count) throw new Error('Set the number of RNG winners first.');
    let pool=[...b.results]; if(b.rngPrize.finishersOnly) pool=pool.filter(r=>r.finish>0); if(b.rngPrize.excludePodium) pool=pool.filter(r=>r.finish>3);
    if(count>pool.length) throw new Error(`Only ${pool.length} racers are eligible for RNG, but ${count} winners were requested.`);
    if(!confirm(`Faction Battle RNG\n\n${pool.length} eligible racers\n${count} winner(s)\n${b.rngPrize.qtyPerWinner}x ${b.rngPrize.prize} each\n\nRun draw?`)) return null;
    const selected=randomUnique(pool,count), drawId=uid('rng');
    b.rngWinners=selected.map((r,i)=>({drawId,winnerNumber:i+1,racerId:r.id,racer:r.name,team:r.team,prize:b.rngPrize.prize,qty:Number(b.rngPrize.qtyPerWinner||1),drawnAt:new Date().toISOString(),randomSource:window.crypto?.getRandomValues?'crypto':'math'}));
    b.status='PRIZES'; b.updatedAt=new Date().toISOString(); await save(); return b.rngWinners;
  }

  async function closeBattle(b) {
    if (!(b.results||[]).length) throw new Error('Sync results before closing this battle.');
    if(!confirm(`Close this faction battle?\n\nAurora ${b.teamScore?.aurora??0} - ${b.teamScore?.opponent??0} ${b.opponent||'Opponent'}\n\nClosed battles are locked from result and RNG changes.`)) return false;
    b.status='CLOSED'; b.closedAt=new Date().toISOString(); b.updatedAt=b.closedAt; await save(); return true;
  }

  function resultSummaryText(b) {
    if (!(b.results||[]).length) return 'No synced results yet.';
    const winner=b.teamScore?.winner==='AURORA'?'Aurora Surrealis wins':b.teamScore?.winner==='OPPONENT'?`${b.opponent||'Opponent'} wins`:'Tie';
    let out=`Aurora Surrealis vs ${b.opponent||'Opponent'}\n${b.format} • ${b.track||'TBD'}\n\nTEAM SCORE\nAurora Surrealis ${b.teamScore?.aurora??0}\n${b.opponent||'Opponent'} ${b.teamScore?.opponent??0}\n${winner}\n\nPODIUM\n`;
    (b.placementAwards||[]).forEach(a=>out+=`${a.place}. ${a.racer}${a.prize?` — ${a.prize}`:''}\n`);
    if((b.rngWinners||[]).length){out+='\nRNG WINNERS\n';b.rngWinners.forEach(w=>out+=`${w.winnerNumber}. ${w.racer} — ${w.qty}x ${w.prize}\n`);}
    return out.trim();
  }

  function injectStyle() {
    if(document.getElementById(MOD.styleId)) return;
    const s=document.createElement('style'); s.id=MOD.styleId; s.textContent=`
      #${MOD.viewId} .rib-card{background:#1a2029;border:1px solid #303845;border-radius:12px;padding:12px;margin:0 0 10px}
      #${MOD.viewId} .rib-card h3{margin:0 0 10px;font-size:15px} #${MOD.viewId} .rib-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      #${MOD.viewId} .rib-input,#${MOD.viewId} .rib-select,#${MOD.viewId} .rib-textarea{width:100%;box-sizing:border-box;background:#10151c;color:#fff;border:1px solid #3b4654;border-radius:8px;padding:9px;margin:3px 0 8px}
      #${MOD.viewId} .rib-textarea{min-height:110px;resize:vertical;font-family:Arial,sans-serif;line-height:1.35} #${MOD.viewId} .rib-label{font-size:11px;color:#aeb8c5;display:block;margin-top:7px}
      #${MOD.viewId} .rib-btn{border:0;border-radius:9px;padding:10px 12px;background:#dce5ef;color:#111;font-weight:700;margin:3px 3px 3px 0} #${MOD.viewId} .rib-btn.secondary{background:#2a3441;color:#eef2f6;border:1px solid #3c4857} #${MOD.viewId} .rib-btn.danger{background:#7b2b2b;color:#fff}
      #${MOD.viewId} .rib-pill{display:inline-block;border:1px solid #3d4855;border-radius:999px;padding:3px 7px;font-size:10px;color:#cdd6e0;background:#222a35;margin:2px 3px 2px 0} #${MOD.viewId} .rib-small{font-size:11px;color:#9eabb9}
      #${MOD.viewId} .rib-row{background:#151b23;border:1px solid #303845;border-radius:10px;padding:10px;margin:7px 0} #${MOD.viewId} .rib-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px} #${MOD.viewId} .rib-actions .rib-btn{flex:1;min-width:90px;margin:0}
      #${MOD.viewId} .rib-pre{white-space:pre-wrap;background:#0e1319;border:1px solid #303844;border-radius:9px;padding:10px;font-size:12px;line-height:1.4} #${MOD.viewId} .rib-score{font-size:24px;font-weight:800}
      #${MOD.viewId} .rib-result{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #303845} @media(max-width:420px){#${MOD.viewId} .rib-grid{grid-template-columns:1fr 1fr}}
    `; document.head.appendChild(s);
  }

  function battleListHtml() {
    if(!state.battles.length) return '<div class="rib-small">No faction battles yet.</div>';
    return state.battles.map(b=>`<div class="rib-row"><b>Aurora Surrealis vs ${esc(b.opponent||'Opponent TBD')}</b><br><span class="rib-pill">${esc(b.format)}</span><span class="rib-pill">${esc(b.status)}</span><span class="rib-pill">${esc(b.hostParticipation==='HOST_ONLY'?'Host only':'Host racing')}</span>${b.teamScore?`<span class="rib-pill">Score ${esc(b.teamScore.aurora)}-${esc(b.teamScore.opponent)}</span>`:''}<div class="rib-small">${esc(b.date||'Date TBD')} • ${esc(b.track||'Track TBD')}</div><button class="rib-btn secondary" data-rib-action="open" data-id="${esc(b.id)}">Open</button></div>`).join('');
  }

  function resultsHtml(b) {
    if(!(b.results||[]).length) return `<div class="rib-card"><h3>Results & Settlement</h3><div class="rib-small">Save the official Torn Race ID, then sync after the race finishes.</div><br><button class="rib-btn" data-rib-action="sync-results">Sync Official Results</button></div>`;
    const wt=b.teamScore?.winner==='AURORA'?'AURORA WINS':b.teamScore?.winner==='OPPONENT'?`${String(b.opponent||'OPPONENT').toUpperCase()} WINS`:'TIE';
    return `<div class="rib-card"><h3>Team Result</h3><div class="rib-grid"><div><div class="rib-small">Aurora Surrealis</div><div class="rib-score">${esc(b.teamScore?.aurora??0)}</div></div><div><div class="rib-small">${esc(b.opponent||'Opponent')}</div><div class="rib-score">${esc(b.teamScore?.opponent??0)}</div></div></div><br><b>${esc(wt)}</b>${(b.ignoredHostResults||[]).length?`<div class="rib-small">Host-only entry ignored: ${esc(b.ignoredHostResults.map(x=>x.name||x.id).join(', '))}. Competitor positions were re-ranked.</div>`:''}<div class="rib-actions">${!isLocked(b)?'<button class="rib-btn secondary" data-rib-action="sync-results">Re-sync Results</button>':''}<button class="rib-btn secondary" data-rib-action="copy-results">Copy Result Summary</button></div></div>
      <div class="rib-card"><h3>Official Competitive Finish</h3>${b.results.map(r=>`<div class="rib-result"><b>#${esc(r.finish)}</b><span>${esc(r.name)}<br><span class="rib-small">${r.team==='AURORA'?'Aurora Surrealis':esc(b.opponent||'Opponent')}${r.rawFinish&&r.rawFinish!==r.finish?` • Torn #${esc(r.rawFinish)}`:''}</span></span><span>${esc(r.teamPoints)} pts</span></div>`).join('')}</div>
      <div class="rib-card"><h3>Podium Prizes</h3>${(b.placementAwards||[]).map(a=>`<div class="rib-row"><b>${esc(a.place)}. ${esc(a.racer)}</b><div>${esc(a.prize||'No prize configured')}</div></div>`).join('')}</div>
      <div class="rib-card"><h3>RNG Prizes</h3>${(b.rngWinners||[]).length?b.rngWinners.map(w=>`<div class="rib-row"><b>${esc(w.racer)}</b><div>${esc(w.qty)}x ${esc(w.prize)}</div></div>`).join(''):`<div class="rib-small">No RNG draw recorded yet.</div><br>${!isLocked(b)?'<button class="rib-btn" data-rib-action="run-rng">Run RNG Draw</button>':''}`}</div>
      <div class="rib-card"><h3>Close Battle</h3>${isLocked(b)?`<div class="rib-small">Closed ${esc(b.closedAt?new Date(b.closedAt).toLocaleString():'')}. Results and RNG are locked.</div>`:'<div class="rib-small">Close only after results and prizes have been verified.</div><br><button class="rib-btn danger" data-rib-action="close-battle">Close & Lock Battle</button>'}</div>`;
  }

  function battleEditorHtml(b) {
    const locked=isLocked(b), slots=teamSize(b), message=renderParticipantMessage(b);
    return `<div class="rib-card"><h3>Battle Setup <span class="rib-small">Battles v${MOD.version}</span></h3><div class="rib-grid">
      <div><label class="rib-label">Opponent faction</label><input class="rib-input" id="rib-opponent" value="${esc(b.opponent)}" ${locked?'disabled':''}></div>
      <div><label class="rib-label">Format</label><select class="rib-select" id="rib-format" ${locked?'disabled':''}><option value="4v4" ${b.format==='4v4'?'selected':''}>4v4</option><option value="8v8" ${b.format==='8v8'?'selected':''}>8v8</option></select></div>
      <div><label class="rib-label">Date</label><input class="rib-input" id="rib-date" type="date" value="${esc(b.date)}" ${locked?'disabled':''}></div><div><label class="rib-label">Time (TCT)</label><input class="rib-input" id="rib-time" value="${esc(b.time)}" ${locked?'disabled':''}></div>
      <div><label class="rib-label">Track</label><input class="rib-input" id="rib-track" value="${esc(b.track)}" ${locked?'disabled':''}></div><div><label class="rib-label">Laps</label><input class="rib-input" id="rib-laps" type="number" min="1" value="${esc(b.laps)}" ${locked?'disabled':''}></div>
      <div><label class="rib-label">Class</label><input class="rib-input" id="rib-class" value="${esc(b.raceClass)}" ${locked?'disabled':''}></div><div><label class="rib-label">Password</label><input class="rib-input" id="rib-password" value="${esc(b.password)}" ${locked?'disabled':''}></div></div>
      <label class="rib-label"><input id="rib-no-upgrades" type="checkbox" ${b.noUpgrades?'checked':''} ${locked?'disabled':''}> No upgrades</label><label class="rib-label">Race ID</label><input class="rib-input" id="rib-race-id" value="${esc(b.raceId)}" ${locked?'disabled':''}>${b.raceId?`<div class="rib-small">Linked race: ${esc(b.foundRaceTitle||'Race '+b.raceId)}</div>`:''}<div class="rib-actions">${!locked?'<button class="rib-btn secondary" data-rib-action="find-race">Find Race</button>':''}${!locked&&b.raceId?'<button class="rib-btn secondary" data-rib-action="unlink-race">Clear Linked Race</button>':''}${!locked?'<button class="rib-btn" data-rib-action="save-battle">Save Battle</button>':''}</div></div>

      <div class="rib-card"><h3>Host Participation</h3><div class="rib-small">Use Host only when you joined Torn's race only because you created it. Host-only entries are removed before team scoring, podiums, and RNG.</div>
      <label class="rib-label">Host racer name</label><input class="rib-input" id="rib-host-name" value="${esc(b.hostName||'')}" ${locked?'disabled':''}>
      <label class="rib-label">Host racer ID (optional)</label><input class="rib-input" id="rib-host-id" value="${esc(b.hostId||'')}" ${locked?'disabled':''}>
      <select class="rib-select" id="rib-host-participation" ${locked?'disabled':''}><option value="HOST_ONLY" ${b.hostParticipation==='HOST_ONLY'?'selected':''}>Host only — do not count me</option><option value="COMPETING" ${b.hostParticipation==='COMPETING'?'selected':''}>Competing racer — count me normally</option></select>${!locked?'<button class="rib-btn" data-rib-action="save-host">Save Host Rule</button>':''}</div>

      <div class="rib-card"><h3>Team Rosters</h3><div class="rib-small">${slots} actual racers per faction. Do not put the host in Aurora's roster when using Host only.</div><label class="rib-label">Aurora Surrealis (${slots})</label><textarea class="rib-textarea" id="rib-our-roster" ${locked?'disabled':''}>${esc((b.ourRoster||[]).join('\n'))}</textarea><label class="rib-label">${esc(b.opponent||'Opponent')} (${slots})</label><textarea class="rib-textarea" id="rib-opponent-roster" ${locked?'disabled':''}>${esc((b.opponentRoster||[]).join('\n'))}</textarea>${!locked?'<button class="rib-btn" data-rib-action="save-rosters">Save Rosters</button>':''}</div>

      <div class="rib-card"><h3>Placement Prizes</h3><label class="rib-label">1st place</label><input class="rib-input" id="rib-first-prize" value="${esc(b.placementPrizes.first)}" ${locked?'disabled':''}><label class="rib-label">2nd place</label><input class="rib-input" id="rib-second-prize" value="${esc(b.placementPrizes.second)}" ${locked?'disabled':''}><label class="rib-label">3rd place</label><input class="rib-input" id="rib-third-prize" value="${esc(b.placementPrizes.third)}" ${locked?'disabled':''}>${!locked?'<button class="rib-btn" data-rib-action="save-placement">Save Placement Prizes</button>':''}</div>

      <div class="rib-card"><h3>RNG Prize Setup</h3><div class="rib-grid"><div><label class="rib-label">Prize</label><input class="rib-input" id="rib-rng-prize" value="${esc(b.rngPrize.prize)}" ${locked?'disabled':''}></div><div><label class="rib-label">Qty / winner</label><input class="rib-input" id="rib-rng-qty" type="number" min="1" value="${esc(b.rngPrize.qtyPerWinner)}" ${locked?'disabled':''}></div><div><label class="rib-label">Random winners</label><input class="rib-input" id="rib-rng-winners" type="number" min="0" value="${esc(b.rngPrize.winnerCount)}" ${locked?'disabled':''}></div></div><label class="rib-label"><input id="rib-rng-finishers" type="checkbox" ${b.rngPrize.finishersOnly?'checked':''} ${locked?'disabled':''}> Finishers only</label><label class="rib-label"><input id="rib-rng-exclude-podium" type="checkbox" ${b.rngPrize.excludePodium?'checked':''} ${locked?'disabled':''}> Exclude 1st/2nd/3rd from RNG pool</label>${!locked?'<button class="rib-btn" data-rib-action="save-rng">Save RNG Setup</button>':''}</div>

      ${raceChoicesHtml(b)}<div class="rib-card"><h3>Participant Message</h3><div class="rib-pre">${esc(message)}</div><button class="rib-btn" data-rib-action="copy-message">Copy Participant Message</button></div>${resultsHtml(b)}`;
  }

  function settingsHtml() { return `<div class="rib-card"><h3>Participant Message Template</h3><div class="rib-small">Placeholders: {opponent}, {format}, {date}, {time}, {track}, {laps}, {class}, {upgradesShort}, {password}</div><textarea class="rib-textarea" id="rib-message-template">${esc(state.participantMessageTemplate)}</textarea><button class="rib-btn" data-rib-action="save-template">Save Template</button><button class="rib-btn secondary" data-rib-action="reset-template">Restore Default</button></div>`; }

  function renderBattles() {
    const body=document.querySelector(`#${MOD.panelId} .ri-body`); if(!body) return;
    const b=selectedBattle(); body.innerHTML=`<div id="${MOD.viewId}"><div class="rib-card"><h3>Faction Battles <span class="rib-small">v${MOD.version}</span></h3><div class="rib-small">Separate from Season standings, Championship, and normal RaceIQ prize history.</div><div class="rib-actions"><button class="rib-btn" data-rib-action="new">+ New Battle</button><button class="rib-btn secondary" data-rib-action="show-list">Battle History</button><button class="rib-btn secondary" data-rib-action="show-settings">Message Template</button></div></div><div id="rib-content">${b?battleEditorHtml(b):battleListHtml()}</div></div>`; bindEvents();
  }
  function showList(){const c=document.getElementById('rib-content');if(c)c.innerHTML=`<div class="rib-card"><h3>Faction Battle History</h3>${battleListHtml()}</div>`;bindEvents();}
  function showSettings(){const c=document.getElementById('rib-content');if(c)c.innerHTML=settingsHtml();bindEvents();}
  function readRoster(id){return String(document.getElementById(id)?.value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);}

  async function saveBattleSetup(b){
    if(isLocked(b)) throw new Error('This battle is CLOSED.');
    b.opponent=String(document.getElementById('rib-opponent')?.value||'').trim(); b.format=document.getElementById('rib-format')?.value==='8v8'?'8v8':'4v4'; b.date=String(document.getElementById('rib-date')?.value||'').trim(); b.time=String(document.getElementById('rib-time')?.value||'2200').trim(); b.track=String(document.getElementById('rib-track')?.value||'').trim(); b.laps=Math.max(1,Number(document.getElementById('rib-laps')?.value||60)); b.raceClass=String(document.getElementById('rib-class')?.value||'E').trim()||'E'; b.password=String(document.getElementById('rib-password')?.value||'').trim(); b.noUpgrades=Boolean(document.getElementById('rib-no-upgrades')?.checked); b.raceId=String(document.getElementById('rib-race-id')?.value||'').trim(); b.updatedAt=new Date().toISOString(); await save();
  }

  function bindEvents(){document.querySelectorAll('[data-rib-action]').forEach(btn=>btn.addEventListener('click',async()=>{const a=btn.dataset.ribAction,b=selectedBattle();try{
    if(a==='new'){newBattle();await save();renderBattles();return;} if(a==='show-list'){showList();return;} if(a==='show-settings'){showSettings();return;} if(a==='open'){selectedBattleId=btn.dataset.id||'';renderBattles();return;}
    if(a==='save-template'){const v=String(document.getElementById('rib-message-template')?.value||'').trim();if(!v)throw new Error('Message template cannot be blank.');state.participantMessageTemplate=v;await save();toast('Participant message template saved.');return;} if(a==='reset-template'){state.participantMessageTemplate=DEFAULT_TEMPLATE;await save();showSettings();toast('Default participant message restored.');return;}
    if(!b) throw new Error('No battle is selected.');
    if(a==='save-battle'){await saveBattleSetup(b);renderBattles();toast('Battle setup saved.');return;}
    if(a==='find-race'){await saveBattleSetup(b);await findBattleRace(b);return;}
    if(a==='choose-race'){const chosen=await chooseBattleRace(b,btn.dataset.raceId||'');renderBattles();toast(`Linked race ${chosen.id}.`);return;}
    if(a==='unlink-race'){b.raceId='';b.foundRaceTitle='';b.foundRaceAt=0;b.raceChoices=[];b.results=[];b.teamScore=null;b.placementAwards=[];b.rngWinners=[];b.syncedAt='';b.status='DRAFT';b.updatedAt=new Date().toISOString();await save();renderBattles();toast('Race unlinked.');return;}
    if(a==='cancel-race-list'){b.raceChoices=[];await save();renderBattles();return;}
    if(a==='save-host'){if(isLocked(b))throw new Error('This battle is CLOSED.');b.hostName=String(document.getElementById('rib-host-name')?.value||'').trim();b.hostId=String(document.getElementById('rib-host-id')?.value||'').trim();b.hostParticipation=document.getElementById('rib-host-participation')?.value==='COMPETING'?'COMPETING':'HOST_ONLY';b.updatedAt=new Date().toISOString();await save();renderBattles();toast(b.hostParticipation==='HOST_ONLY'?'Host will not count.':'Host will count as a racer.');return;}
    if(a==='save-rosters'){if(isLocked(b))throw new Error('This battle is CLOSED.');const n=teamSize(b),ours=readRoster('rib-our-roster'),theirs=readRoster('rib-opponent-roster');if(ours.length>n||theirs.length>n)throw new Error(`${b.format} allows a maximum of ${n} racers per faction.`);b.ourRoster=ours;b.opponentRoster=theirs;b.updatedAt=new Date().toISOString();await save();toast('Rosters saved.');return;}
    if(a==='save-placement'){b.placementPrizes.first=String(document.getElementById('rib-first-prize')?.value||'').trim();b.placementPrizes.second=String(document.getElementById('rib-second-prize')?.value||'').trim();b.placementPrizes.third=String(document.getElementById('rib-third-prize')?.value||'').trim();await save();toast('Placement prizes saved.');return;}
    if(a==='save-rng'){b.rngPrize.prize=String(document.getElementById('rib-rng-prize')?.value||'Xanax').trim()||'Xanax';b.rngPrize.qtyPerWinner=Math.max(1,Number(document.getElementById('rib-rng-qty')?.value||1));b.rngPrize.winnerCount=Math.max(0,Number(document.getElementById('rib-rng-winners')?.value||0));b.rngPrize.finishersOnly=Boolean(document.getElementById('rib-rng-finishers')?.checked);b.rngPrize.excludePodium=Boolean(document.getElementById('rib-rng-exclude-podium')?.checked);await save();renderBattles();toast('RNG prize setup saved.');return;}
    if(a==='copy-message'){if(!isLocked(b))await saveBattleSetup(b);await copyText(renderParticipantMessage(b));return;} if(a==='sync-results'){if(!isLocked(b))await saveBattleSetup(b);const r=await syncBattleResults(b);renderBattles();toast(`Synced ${r.imported} racers${r.ignoredHost?`; ignored ${r.ignoredHost} host`:''}. Score ${r.aurora}-${r.opponent}.`);return;} if(a==='run-rng'){await runBattleRng(b);renderBattles();toast('Faction Battle RNG completed.');return;} if(a==='copy-results'){await copyText(resultSummaryText(b));return;} if(a==='close-battle'){if(await closeBattle(b)){renderBattles();toast('Battle closed and locked.');}return;}
  }catch(e){alert(`RaceIQ Faction Battles\n\n${e.message||e}`);}}));}

  function ensureTab(){const panel=document.getElementById(MOD.panelId),tabs=panel?.querySelector('.ri-tabs');if(!tabs)return false;if(document.getElementById(MOD.tabId))return true;const btn=document.createElement('button');btn.id=MOD.tabId;btn.className='ri-tab';btn.textContent='Battles';btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();panel.querySelectorAll('.ri-tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');renderBattles();});tabs.appendChild(btn);return true;}

  try{await load();injectStyle();ensureTab();const observer=new MutationObserver(()=>{if(document.getElementById(MOD.panelId))ensureTab();});observer.observe(document.documentElement,{childList:true,subtree:true});console.log(`[RaceIQ Faction Battles] v${MOD.version} loaded`);}catch(e){console.error('[RaceIQ Faction Battles] startup error',e);}
})();