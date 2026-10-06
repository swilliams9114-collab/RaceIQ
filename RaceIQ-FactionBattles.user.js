// ==UserScript==
// @name         RaceIQ - Faction Battles Module
// @namespace    raceiq.aurora.surrealis.battles
// @version      0.2.0
// @description  Lightweight Faction vs Faction race module for RaceIQ with sync, team scoring, podium prizes, RNG prizes, and separate history.
// @author       Aurora Surrealis
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  if (window.top !== window.self) return;

  const MOD = {
    name: 'Faction Battles',
    version: '0.2.0',
    apiBase: 'https://api.torn.com/v2',
    apiKey: '###PDA-APIKEY###',
    storageKey: 'raceiq_faction_battles_v1',
    panelId: 'raceiq-panel',
    tabId: 'raceiq-battles-tab',
    viewId: 'raceiq-battles-view',
    styleId: 'raceiq-battles-style'
  };

  const DEFAULT_TEMPLATE = `Aurora Surrealis vs {opponent}

{format} faction race
{date} @ {time} TCT
{track} • {laps} laps • Class {class}
{upgradesShort}
Password: {password}

Good luck!`;

  const DEFAULT_STATE = {
    schema: 1,
    participantMessageTemplate: DEFAULT_TEMPLATE,
    userCache: {},
    battles: []
  };

  let state = null;
  let selectedBattleId = '';

  const clone = obj => JSON.parse(JSON.stringify(obj));
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

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
    if (!state.participantMessageTemplate) state.participantMessageTemplate = DEFAULT_TEMPLATE;
    if (!state.userCache || typeof state.userCache !== 'object') state.userCache = {};

    // Backward-compatible migration for v0.1 battles.
    state.battles.forEach(b => {
      if (!Array.isArray(b.results)) b.results = [];
      if (!Array.isArray(b.rngWinners)) b.rngWinners = [];
      if (!Array.isArray(b.ourRoster)) b.ourRoster = [];
      if (!Array.isArray(b.opponentRoster)) b.opponentRoster = [];
      if (!b.placementPrizes) b.placementPrizes = {first:'',second:'',third:''};
      if (!b.rngPrize) b.rngPrize = {prize:'Xanax',qtyPerWinner:1,winnerCount:0,finishersOnly:true,excludePodium:false};
      if (!b.teamScore) b.teamScore = null;
      if (!Array.isArray(b.placementAwards)) b.placementAwards = [];
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
    const id = uid();
    const battle = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'DRAFT',
      opponent: '',
      format: '4v4',
      date: '',
      time: '2200',
      track: '',
      laps: 60,
      raceClass: 'E',
      noUpgrades: true,
      password: '',
      raceId: '',
      ourRoster: [],
      opponentRoster: [],
      placementPrizes: {first:'',second:'',third:''},
      rngPrize: {
        prize: 'Xanax',
        qtyPerWinner: 1,
        winnerCount: 0,
        finishersOnly: true,
        excludePodium: false
      },
      results: [],
      teamScore: null,
      placementAwards: [],
      rngWinners: [],
      syncedAt: '',
      closedAt: ''
    };
    state.battles.unshift(battle);
    selectedBattleId = id;
    return battle;
  }

  function selectedBattle() {
    return state.battles.find(b => b.id === selectedBattleId) || state.battles[0] || null;
  }

  function battleFormatCount(format) {
    return format === '8v8' ? 8 : 4;
  }

  function expectedParticipants(battle) {
    return battleFormatCount(battle.format) * 2;
  }

  function isLocked(b) {
    return b?.status === 'CLOSED';
  }

  function renderParticipantMessage(battle) {
    const values = {
      opponent: battle.opponent || 'Opponent Faction',
      format: battle.format || '4v4',
      date: battle.date || 'TBD',
      time: battle.time || '2200',
      track: battle.track || 'TBD',
      laps: battle.laps || 60,
      class: battle.raceClass || 'E',
      upgradesShort: battle.noUpgrades ? 'NO UPGRADES.' : 'Upgrades allowed.',
      password: battle.password || 'TBD'
    };

    return String(state.participantMessageTemplate || DEFAULT_TEMPLATE)
      .replace(/\{([a-zA-Z0-9]+)\}/g, (_, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    } catch (_) {
      window.prompt('Copy this text:', text);
    }
  }

  function toast(msg) {
    let el = document.getElementById('raceiq-battles-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'raceiq-battles-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#eaf0f6;color:#111;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px Arial;box-shadow:0 3px 15px #0008';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  // ---------- Torn API ----------
  async function apiGet(path, allow404=false) {
    const url = MOD.apiBase + path;
    const headers = {
      'Authorization': `ApiKey ${MOD.apiKey}`,
      'Accept': 'application/json'
    };

    if (typeof PDA_httpGet === 'function') {
      const response = await PDA_httpGet(url, headers);
      const status = Number(response?.status || 0);
      let data = {};
      try { data = JSON.parse(response?.responseText || '{}'); } catch (_) {}
      if (status >= 200 && status < 300 && !data?.error) return data;
      if (allow404 && [400,404].includes(status)) return null;
      const msg = data?.error?.error || data?.error?.message || response?.responseText || `HTTP ${status}`;
      throw new Error(`Torn API: ${msg}`);
    }

    const res = await fetch(url, {headers});
    const data = await res.json().catch(() => ({}));
    if (res.ok && !data?.error) return data;
    if (allow404 && [400,404].includes(res.status)) return null;
    throw new Error(`Torn API: ${data?.error?.error || data?.error?.message || res.statusText}`);
  }

  function unwrapRace(payload, raceId) {
    if (payload?.race && !Array.isArray(payload.race)) return payload.race;
    if (payload?.races) {
      const arr = Array.isArray(payload.races) ? payload.races : Object.values(payload.races);
      return arr.find(r => String(r.id ?? r.race_id ?? '') === String(raceId)) || payload;
    }
    return payload;
  }

  async function fetchRace(raceId) {
    let data = await apiGet(`/racing/${encodeURIComponent(raceId)}/race`, true);
    if (data) return unwrapRace(data, raceId);
    data = await apiGet(`/racing?selections=race&id=${encodeURIComponent(raceId)}`, true);
    if (data) return unwrapRace(data, raceId);
    throw new Error(`Race ${raceId} was not returned by Torn.`);
  }

  function extractRacers(race) {
    if (!race) return [];
    const keys = ['racers','drivers','participants','results','cars'];
    let raw = null;
    for (const key of keys) {
      if (Array.isArray(race[key])) { raw = race[key]; break; }
    }
    if (!raw && race.race) return extractRacers(race.race);
    if (!raw) return [];

    return raw.map(r => ({
      id: String(r.driver_id ?? r.user_id ?? r.player_id ?? r.id ?? r.user?.id ?? r.driver?.id ?? ''),
      name: String(r.driver_name ?? r.user_name ?? r.player_name ?? r.name ?? r.user?.name ?? r.driver?.name ?? '').trim(),
      finish: Number(r.position ?? r.place ?? r.rank ?? r.result?.position ?? 0) || 0
    })).filter(r => r.id || r.name);
  }

  async function resolveName(id) {
    const clean = String(id || '').trim();
    if (!clean) return '';
    const cached = String(state.userCache?.[clean] || '').trim();
    if (cached) return cached;

    try {
      const data = await apiGet(`/user/${encodeURIComponent(clean)}/basic`);
      const candidates = [data?.profile, data?.basic, data?.user, data?.player, data].filter(Boolean);
      for (const x of candidates) {
        const name = String(x?.name ?? x?.user_name ?? x?.player_name ?? '').trim();
        if (name) {
          state.userCache[clean] = name;
          return name;
        }
      }
    } catch (_) {}
    return '';
  }

  async function resolveResults(racers) {
    const out = [];
    for (const r of racers) {
      const copy = {...r};
      if (!copy.name && copy.id) copy.name = await resolveName(copy.id);
      if (copy.id && copy.name) state.userCache[copy.id] = copy.name;
      out.push(copy);
    }
    return out;
  }

  // ---------- battle scoring ----------
  function rosterTeamForName(b, name) {
    const key = norm(name);
    if (!key) return '';
    if ((b.ourRoster || []).some(x => norm(x) === key)) return 'AURORA';
    if ((b.opponentRoster || []).some(x => norm(x) === key)) return 'OPPONENT';
    return '';
  }

  function scoreBattle(b) {
    const maxPoints = expectedParticipants(b);
    const scored = (b.results || [])
      .filter(r => r.finish > 0 && r.team)
      .map(r => ({...r, teamPoints: Math.max(0, maxPoints + 1 - r.finish)}));

    const ours = scored.filter(r => r.team === 'AURORA');
    const theirs = scored.filter(r => r.team === 'OPPONENT');
    const ourScore = ours.reduce((s,r) => s + r.teamPoints, 0);
    const opponentScore = theirs.reduce((s,r) => s + r.teamPoints, 0);

    const ourFinishes = ours.map(r => r.finish).sort((a,b) => a-b);
    const theirFinishes = theirs.map(r => r.finish).sort((a,b) => a-b);

    let winner = 'TIE';
    if (ourScore > opponentScore) winner = 'AURORA';
    else if (opponentScore > ourScore) winner = 'OPPONENT';
    else {
      const len = Math.max(ourFinishes.length, theirFinishes.length);
      for (let i=0; i<len; i++) {
        const a = ourFinishes[i] ?? 9999;
        const t = theirFinishes[i] ?? 9999;
        if (a < t) { winner = 'AURORA'; break; }
        if (t < a) { winner = 'OPPONENT'; break; }
      }
    }

    b.results = scored.sort((a,b) => a.finish - b.finish);
    b.teamScore = {
      aurora: ourScore,
      opponent: opponentScore,
      winner,
      tiebreak: 'score → best finish → next-best finish'
    };

    const podium = b.results.filter(r => r.finish > 0).sort((a,b)=>a.finish-b.finish).slice(0,3);
    b.placementAwards = podium.map((r, index) => ({
      place: index + 1,
      racerId: r.id,
      racer: r.name,
      team: r.team,
      prize: index === 0 ? b.placementPrizes.first : index === 1 ? b.placementPrizes.second : b.placementPrizes.third
    }));
  }

  async function syncBattleResults(b) {
    if (isLocked(b)) throw new Error('This battle is CLOSED. Reopen it before changing results.');
    if (!b.raceId) throw new Error('Enter the Torn Race ID first.');

    const required = battleFormatCount(b.format);
    if ((b.ourRoster || []).length !== required || (b.opponentRoster || []).length !== required) {
      throw new Error(`${b.format} requires exactly ${required} racers on each saved roster before scoring.`);
    }

    const race = await fetchRace(b.raceId);
    const racers = await resolveResults(extractRacers(race));
    if (!racers.length) throw new Error('Torn returned no racers for this race yet.');

    const mapped = racers.map(r => ({
      ...r,
      team: rosterTeamForName(b, r.name)
    }));

    const rostered = mapped.filter(r => r.team);
    const unknown = mapped.filter(r => !r.team);
    const expected = expectedParticipants(b);

    if (rostered.length !== expected) {
      const unknownText = unknown.length
        ? ` Unmatched racer(s): ${unknown.map(x => x.name || x.id || '?').join(', ')}.`
        : '';
      throw new Error(`Matched ${rostered.length}/${expected} expected rostered racers.${unknownText} Check roster spelling before syncing.`);
    }

    b.results = rostered;
    b.syncedAt = new Date().toISOString();
    b.status = 'RESULTS';
    scoreBattle(b);
    b.updatedAt = new Date().toISOString();
    await save();

    return {
      imported: b.results.length,
      unknown: unknown.length,
      aurora: b.teamScore.aurora,
      opponent: b.teamScore.opponent,
      winner: b.teamScore.winner
    };
  }

  function secureRandomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    if (window.crypto?.getRandomValues) {
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      const buf = new Uint32Array(1);
      let value;
      do {
        window.crypto.getRandomValues(buf);
        value = buf[0];
      } while (value >= limit);
      return value % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function randomUnique(items, count) {
    const arr = [...items];
    for (let i=arr.length-1; i>0; i--) {
      const j = secureRandomInt(i+1);
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr.slice(0, Math.min(count, arr.length));
  }

  async function runBattleRng(b) {
    if (isLocked(b)) throw new Error('This battle is CLOSED.');
    if (!(b.results || []).length) throw new Error('Sync official race results before running RNG.');
    if ((b.rngWinners || []).length) throw new Error('RNG has already been run for this battle.');

    const count = Math.max(0, Number(b.rngPrize?.winnerCount || 0));
    if (!count) throw new Error('Set the number of RNG winners first.');

    let pool = [...b.results];
    if (b.rngPrize.finishersOnly) pool = pool.filter(r => r.finish > 0);
    if (b.rngPrize.excludePodium) pool = pool.filter(r => r.finish > 3);

    if (count > pool.length) {
      throw new Error(`Only ${pool.length} racers are eligible for RNG, but ${count} winners were requested.`);
    }

    if (!confirm(
      `Faction Battle RNG\n\n${pool.length} eligible racers\n${count} winner(s)\n${b.rngPrize.qtyPerWinner}x ${b.rngPrize.prize} each\n\nRun draw?`
    )) return null;

    const selected = randomUnique(pool, count);
    const drawId = uid('rng');

    b.rngWinners = selected.map((r,i) => ({
      drawId,
      winnerNumber: i+1,
      racerId: r.id,
      racer: r.name,
      team: r.team,
      prize: b.rngPrize.prize,
      qty: Number(b.rngPrize.qtyPerWinner || 1),
      drawnAt: new Date().toISOString(),
      randomSource: window.crypto?.getRandomValues ? 'crypto' : 'math'
    }));
    b.status = 'PRIZES';
    b.updatedAt = new Date().toISOString();
    await save();
    return b.rngWinners;
  }

  async function closeBattle(b) {
    if (!(b.results || []).length) throw new Error('Sync results before closing this battle.');

    if (!confirm(
      `Close this faction battle?\n\nAurora ${b.teamScore?.aurora ?? 0} - ${b.teamScore?.opponent ?? 0} ${b.opponent || 'Opponent'}\n\nClosed battles are locked from result and RNG changes.`
    )) return false;

    b.status = 'CLOSED';
    b.closedAt = new Date().toISOString();
    b.updatedAt = b.closedAt;
    await save();
    return true;
  }

  function resultSummaryText(b) {
    if (!(b.results || []).length) return 'No synced results yet.';
    const winner = b.teamScore?.winner === 'AURORA'
      ? 'Aurora Surrealis wins'
      : b.teamScore?.winner === 'OPPONENT'
        ? `${b.opponent || 'Opponent'} wins`
        : 'Tie';

    let out = `Aurora Surrealis vs ${b.opponent || 'Opponent'}\n`;
    out += `${b.format} • ${b.track || 'TBD'}\n\n`;
    out += `TEAM SCORE\nAurora Surrealis ${b.teamScore?.aurora ?? 0}\n${b.opponent || 'Opponent'} ${b.teamScore?.opponent ?? 0}\n${winner}\n\n`;
    out += 'PODIUM\n';
    (b.placementAwards || []).forEach(a => {
      out += `${a.place}. ${a.racer}${a.prize ? ` — ${a.prize}` : ''}\n`;
    });

    if ((b.rngWinners || []).length) {
      out += '\nRNG WINNERS\n';
      b.rngWinners.forEach(w => {
        out += `${w.winnerNumber}. ${w.racer} — ${w.qty}x ${w.prize}\n`;
      });
    }
    return out.trim();
  }

  // ---------- UI ----------
  function injectStyle() {
    if (document.getElementById(MOD.styleId)) return;
    const style = document.createElement('style');
    style.id = MOD.styleId;
    style.textContent = `
      #${MOD.viewId} .rib-card{background:#1a2029;border:1px solid #303845;border-radius:12px;padding:12px;margin:0 0 10px}
      #${MOD.viewId} .rib-card h3{margin:0 0 10px;font-size:15px}
      #${MOD.viewId} .rib-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      #${MOD.viewId} .rib-input,#${MOD.viewId} .rib-select,#${MOD.viewId} .rib-textarea{width:100%;box-sizing:border-box;background:#10151c;color:#fff;border:1px solid #3b4654;border-radius:8px;padding:9px;margin:3px 0 8px}
      #${MOD.viewId} .rib-textarea{min-height:130px;resize:vertical;font-family:Arial,sans-serif;line-height:1.35}
      #${MOD.viewId} .rib-label{font-size:11px;color:#aeb8c5;display:block;margin-top:7px}
      #${MOD.viewId} .rib-btn{border:0;border-radius:9px;padding:10px 12px;background:#dce5ef;color:#111;font-weight:700;margin:3px 3px 3px 0}
      #${MOD.viewId} .rib-btn.secondary{background:#2a3441;color:#eef2f6;border:1px solid #3c4857}
      #${MOD.viewId} .rib-btn.danger{background:#7b2b2b;color:#fff}
      #${MOD.viewId} .rib-pill{display:inline-block;border:1px solid #3d4855;border-radius:999px;padding:3px 7px;font-size:10px;color:#cdd6e0;background:#222a35;margin:2px 3px 2px 0}
      #${MOD.viewId} .rib-small{font-size:11px;color:#9eabb9}
      #${MOD.viewId} .rib-list{display:grid;gap:8px}
      #${MOD.viewId} .rib-row{background:#151b23;border:1px solid #303845;border-radius:10px;padding:10px}
      #${MOD.viewId} .rib-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      #${MOD.viewId} .rib-actions .rib-btn{flex:1;min-width:90px;margin:0}
      #${MOD.viewId} .rib-pre{white-space:pre-wrap;background:#0e1319;border:1px solid #303844;border-radius:9px;padding:10px;font-size:12px;line-height:1.4}
      #${MOD.viewId} .rib-score{font-size:24px;font-weight:800}
      #${MOD.viewId} .rib-result{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #303845}
      @media(max-width:420px){#${MOD.viewId} .rib-grid{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function battleListHtml() {
    if (!state.battles.length) return '<div class="rib-small">No faction battles yet.</div>';

    return `<div class="rib-list">${state.battles.map(b => `
      <div class="rib-row">
        <b>Aurora Surrealis vs ${esc(b.opponent || 'Opponent TBD')}</b><br>
        <span class="rib-pill">${esc(b.format)}</span>
        <span class="rib-pill">${esc(b.status)}</span>
        <span class="rib-pill">${esc(b.date || 'Date TBD')}</span>
        ${b.teamScore ? `<span class="rib-pill">Score ${esc(b.teamScore.aurora)}-${esc(b.teamScore.opponent)}</span>` : ''}
        <div class="rib-small">${esc(b.track || 'Track TBD')} • ${esc(b.laps)} laps • Class ${esc(b.raceClass)}</div>
        <div class="rib-actions">
          <button class="rib-btn secondary" data-rib-action="open" data-id="${esc(b.id)}">Open</button>
        </div>
      </div>`).join('')}</div>`;
  }

  function resultsHtml(b) {
    if (!(b.results || []).length) {
      return `<div class="rib-card">
        <h3>Results & Settlement</h3>
        <div class="rib-small">Enter the official Torn Race ID, save the battle, then sync results after the race finishes.</div>
        <button class="rib-btn" data-rib-action="sync-results">Sync Official Results</button>
      </div>`;
    }

    const winnerText = b.teamScore?.winner === 'AURORA'
      ? 'AURORA WINS'
      : b.teamScore?.winner === 'OPPONENT'
        ? `${String(b.opponent || 'OPPONENT').toUpperCase()} WINS`
        : 'TIE';

    return `
      <div class="rib-card">
        <h3>Team Result</h3>
        <div class="rib-grid">
          <div><div class="rib-small">Aurora Surrealis</div><div class="rib-score">${esc(b.teamScore?.aurora ?? 0)}</div></div>
          <div><div class="rib-small">${esc(b.opponent || 'Opponent')}</div><div class="rib-score">${esc(b.teamScore?.opponent ?? 0)}</div></div>
        </div>
        <br><b>${esc(winnerText)}</b>
        <div class="rib-small">Tiebreak: score → best finish → next-best finish</div>
        <div class="rib-actions">
          ${!isLocked(b) ? `<button class="rib-btn secondary" data-rib-action="sync-results">Re-sync Results</button>` : ''}
          <button class="rib-btn secondary" data-rib-action="copy-results">Copy Result Summary</button>
        </div>
      </div>

      <div class="rib-card">
        <h3>Official Finish</h3>
        ${(b.results || []).map(r => `
          <div class="rib-result">
            <b>#${esc(r.finish)}</b>
            <span>${esc(r.name)}<br><span class="rib-small">${r.team === 'AURORA' ? 'Aurora Surrealis' : esc(b.opponent || 'Opponent')}</span></span>
            <span>${esc(r.teamPoints)} pts</span>
          </div>`).join('')}
      </div>

      <div class="rib-card">
        <h3>Podium Prizes</h3>
        ${(b.placementAwards || []).map(a => `
          <div class="rib-row">
            <b>${esc(a.place)}. ${esc(a.racer)}</b>
            <div class="rib-small">${a.team === 'AURORA' ? 'Aurora Surrealis' : esc(b.opponent || 'Opponent')}</div>
            <div>${esc(a.prize || 'No prize configured')}</div>
          </div>`).join('')}
      </div>

      <div class="rib-card">
        <h3>RNG Prizes</h3>
        ${(b.rngWinners || []).length ? `
          ${(b.rngWinners || []).map(w => `
            <div class="rib-row"><b>${esc(w.racer)}</b><div>${esc(w.qty)}x ${esc(w.prize)}</div></div>
          `).join('')}
        ` : `
          <div class="rib-small">No RNG draw recorded yet.</div><br>
          ${!isLocked(b) ? `<button class="rib-btn" data-rib-action="run-rng">Run RNG Draw</button>` : ''}
        `}
      </div>

      <div class="rib-card">
        <h3>Close Battle</h3>
        ${isLocked(b)
          ? `<div class="rib-small">Closed ${esc(b.closedAt ? new Date(b.closedAt).toLocaleString() : '')}. Results and RNG are locked.</div>`
          : `<div class="rib-small">Close only after results and prizes have been verified.</div><br><button class="rib-btn danger" data-rib-action="close-battle">Close & Lock Battle</button>`
        }
      </div>
    `;
  }

  function battleEditorHtml(b) {
    if (!b) return '';

    const slots = battleFormatCount(b.format);
    const message = renderParticipantMessage(b);
    const locked = isLocked(b);

    return `
      <div class="rib-card">
        <h3>Battle Setup</h3>
        <div class="rib-grid">
          <div><label class="rib-label">Opponent faction</label><input class="rib-input" id="rib-opponent" value="${esc(b.opponent)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Format</label><select class="rib-select" id="rib-format" ${locked?'disabled':''}><option value="4v4" ${b.format==='4v4'?'selected':''}>4v4</option><option value="8v8" ${b.format==='8v8'?'selected':''}>8v8</option></select></div>
          <div><label class="rib-label">Date</label><input class="rib-input" id="rib-date" type="date" value="${esc(b.date)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Time (TCT)</label><input class="rib-input" id="rib-time" value="${esc(b.time)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Track</label><input class="rib-input" id="rib-track" value="${esc(b.track)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Laps</label><input class="rib-input" id="rib-laps" type="number" min="1" value="${esc(b.laps)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Class</label><input class="rib-input" id="rib-class" value="${esc(b.raceClass)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Password</label><input class="rib-input" id="rib-password" value="${esc(b.password)}" ${locked?'disabled':''}></div>
        </div>
        <label class="rib-label"><input id="rib-no-upgrades" type="checkbox" ${b.noUpgrades?'checked':''} ${locked?'disabled':''}> No upgrades</label>
        <label class="rib-label">Race ID</label>
        <input class="rib-input" id="rib-race-id" value="${esc(b.raceId)}" ${locked?'disabled':''}>
        ${!locked ? `<button class="rib-btn" data-rib-action="save-battle">Save Battle</button>` : ''}
      </div>

      <div class="rib-card">
        <h3>Team Rosters</h3>
        <div class="rib-small">${slots} racers per faction. Enter one racer name per line. Names must match Torn names for automatic scoring.</div>
        <label class="rib-label">Aurora Surrealis (${slots})</label>
        <textarea class="rib-textarea" id="rib-our-roster" ${locked?'disabled':''}>${esc((b.ourRoster || []).join('\n'))}</textarea>
        <label class="rib-label">${esc(b.opponent || 'Opponent')} (${slots})</label>
        <textarea class="rib-textarea" id="rib-opponent-roster" ${locked?'disabled':''}>${esc((b.opponentRoster || []).join('\n'))}</textarea>
        ${!locked ? `<button class="rib-btn" data-rib-action="save-rosters">Save Rosters</button>` : ''}
      </div>

      <div class="rib-card">
        <h3>Placement Prizes</h3>
        <label class="rib-label">1st place</label><input class="rib-input" id="rib-first-prize" value="${esc(b.placementPrizes.first)}" placeholder="Example: 1x FHC" ${locked?'disabled':''}>
        <label class="rib-label">2nd place</label><input class="rib-input" id="rib-second-prize" value="${esc(b.placementPrizes.second)}" placeholder="Example: 3x Xanax" ${locked?'disabled':''}>
        <label class="rib-label">3rd place</label><input class="rib-input" id="rib-third-prize" value="${esc(b.placementPrizes.third)}" placeholder="Example: 2x Xanax" ${locked?'disabled':''}>
        ${!locked ? `<button class="rib-btn" data-rib-action="save-placement">Save Placement Prizes</button>` : ''}
      </div>

      <div class="rib-card">
        <h3>RNG Prize Setup</h3>
        <div class="rib-grid">
          <div><label class="rib-label">Prize</label><input class="rib-input" id="rib-rng-prize" value="${esc(b.rngPrize.prize)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Qty / winner</label><input class="rib-input" id="rib-rng-qty" type="number" min="1" value="${esc(b.rngPrize.qtyPerWinner)}" ${locked?'disabled':''}></div>
          <div><label class="rib-label">Random winners</label><input class="rib-input" id="rib-rng-winners" type="number" min="0" value="${esc(b.rngPrize.winnerCount)}" ${locked?'disabled':''}></div>
        </div>
        <label class="rib-label"><input id="rib-rng-finishers" type="checkbox" ${b.rngPrize.finishersOnly?'checked':''} ${locked?'disabled':''}> Finishers only</label>
        <label class="rib-label"><input id="rib-rng-exclude-podium" type="checkbox" ${b.rngPrize.excludePodium?'checked':''} ${locked?'disabled':''}> Exclude 1st/2nd/3rd from RNG pool</label>
        ${!locked ? `<button class="rib-btn" data-rib-action="save-rng">Save RNG Setup</button>` : ''}
      </div>

      <div class="rib-card">
        <h3>Participant Message</h3>
        <div class="rib-small">Password and all race details are filled from this battle's setup.</div><br>
        <div class="rib-pre">${esc(message)}</div>
        <button class="rib-btn" data-rib-action="copy-message">Copy Participant Message</button>
      </div>

      ${resultsHtml(b)}
    `;
  }

  function settingsHtml() {
    return `
      <div class="rib-card">
        <h3>Participant Message Template</h3>
        <div class="rib-small">Available placeholders: {opponent}, {format}, {date}, {time}, {track}, {laps}, {class}, {upgradesShort}, {password}</div>
        <textarea class="rib-textarea" id="rib-message-template">${esc(state.participantMessageTemplate)}</textarea>
        <button class="rib-btn" data-rib-action="save-template">Save Template</button>
        <button class="rib-btn secondary" data-rib-action="reset-template">Restore Default</button>
      </div>`;
  }

  function renderBattles() {
    const body = document.querySelector(`#${MOD.panelId} .ri-body`);
    if (!body) return;

    const b = selectedBattle();
    body.innerHTML = `
      <div id="${MOD.viewId}">
        <div class="rib-card">
          <h3>Faction Battles <span class="rib-small">v${MOD.version}</span></h3>
          <div class="rib-small">Separate from Season standings, Championship, and normal RaceIQ prize history.</div>
          <div class="rib-actions">
            <button class="rib-btn" data-rib-action="new">+ New Battle</button>
            <button class="rib-btn secondary" data-rib-action="show-list">Battle History</button>
            <button class="rib-btn secondary" data-rib-action="show-settings">Message Template</button>
          </div>
        </div>
        <div id="rib-content">${b ? battleEditorHtml(b) : battleListHtml()}</div>
      </div>`;

    bindBattleEvents();
  }

  function showList() {
    const content = document.getElementById('rib-content');
    if (content) content.innerHTML = `<div class="rib-card"><h3>Faction Battle History</h3>${battleListHtml()}</div>`;
    bindBattleEvents();
  }

  function showSettings() {
    const content = document.getElementById('rib-content');
    if (content) content.innerHTML = settingsHtml();
    bindBattleEvents();
  }

  function readRoster(id) {
    return String(document.getElementById(id)?.value || '')
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  async function saveBattleSetup(b) {
    if (isLocked(b)) throw new Error('This battle is CLOSED.');
    b.opponent = String(document.getElementById('rib-opponent')?.value || '').trim();
    b.format = document.getElementById('rib-format')?.value === '8v8' ? '8v8' : '4v4';
    b.date = String(document.getElementById('rib-date')?.value || '').trim();
    b.time = String(document.getElementById('rib-time')?.value || '2200').trim();
    b.track = String(document.getElementById('rib-track')?.value || '').trim();
    b.laps = Math.max(1, Number(document.getElementById('rib-laps')?.value || 60));
    b.raceClass = String(document.getElementById('rib-class')?.value || 'E').trim() || 'E';
    b.password = String(document.getElementById('rib-password')?.value || '').trim();
    b.noUpgrades = Boolean(document.getElementById('rib-no-upgrades')?.checked);
    b.raceId = String(document.getElementById('rib-race-id')?.value || '').trim();
    b.updatedAt = new Date().toISOString();
    await save();
  }

  function bindBattleEvents() {
    document.querySelectorAll('[data-rib-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.ribAction;
        const b = selectedBattle();

        try {
          if (action === 'new') {
            newBattle();
            await save();
            renderBattles();
            return;
          }

          if (action === 'show-list') { showList(); return; }
          if (action === 'show-settings') { showSettings(); return; }

          if (action === 'open') {
            selectedBattleId = btn.dataset.id || '';
            renderBattles();
            return;
          }

          if (action === 'save-template') {
            const value = String(document.getElementById('rib-message-template')?.value || '').trim();
            if (!value) throw new Error('Message template cannot be blank.');
            state.participantMessageTemplate = value;
            await save();
            toast('Participant message template saved.');
            return;
          }

          if (action === 'reset-template') {
            state.participantMessageTemplate = DEFAULT_TEMPLATE;
            await save();
            showSettings();
            toast('Default participant message restored.');
            return;
          }

          if (!b) throw new Error('No battle is selected.');

          if (action === 'save-battle') {
            await saveBattleSetup(b);
            renderBattles();
            toast('Battle setup saved.');
            return;
          }

          if (action === 'save-rosters') {
            if (isLocked(b)) throw new Error('This battle is CLOSED.');
            const required = battleFormatCount(b.format);
            const ours = readRoster('rib-our-roster');
            const theirs = readRoster('rib-opponent-roster');
            if (ours.length > required || theirs.length > required) {
              throw new Error(`${b.format} allows a maximum of ${required} racers per faction.`);
            }
            b.ourRoster = ours;
            b.opponentRoster = theirs;
            b.updatedAt = new Date().toISOString();
            await save();
            toast('Rosters saved.');
            return;
          }

          if (action === 'save-placement') {
            if (isLocked(b)) throw new Error('This battle is CLOSED.');
            b.placementPrizes.first = String(document.getElementById('rib-first-prize')?.value || '').trim();
            b.placementPrizes.second = String(document.getElementById('rib-second-prize')?.value || '').trim();
            b.placementPrizes.third = String(document.getElementById('rib-third-prize')?.value || '').trim();
            b.updatedAt = new Date().toISOString();
            await save();
            toast('Placement prizes saved.');
            return;
          }

          if (action === 'save-rng') {
            if (isLocked(b)) throw new Error('This battle is CLOSED.');
            b.rngPrize.prize = String(document.getElementById('rib-rng-prize')?.value || 'Xanax').trim() || 'Xanax';
            b.rngPrize.qtyPerWinner = Math.max(1, Number(document.getElementById('rib-rng-qty')?.value || 1));
            b.rngPrize.winnerCount = Math.max(0, Number(document.getElementById('rib-rng-winners')?.value || 0));
            b.rngPrize.finishersOnly = Boolean(document.getElementById('rib-rng-finishers')?.checked);
            b.rngPrize.excludePodium = Boolean(document.getElementById('rib-rng-exclude-podium')?.checked);
            b.updatedAt = new Date().toISOString();
            await save();
            renderBattles();
            toast('RNG prize setup saved.');
            return;
          }

          if (action === 'copy-message') {
            if (!isLocked(b)) await saveBattleSetup(b);
            await copyText(renderParticipantMessage(b));
            return;
          }

          if (action === 'sync-results') {
            if (!isLocked(b)) await saveBattleSetup(b);
            const result = await syncBattleResults(b);
            renderBattles();
            toast(`Synced ${result.imported} racers. Score ${result.aurora}-${result.opponent}.`);
            return;
          }

          if (action === 'run-rng') {
            await runBattleRng(b);
            renderBattles();
            toast('Faction Battle RNG completed.');
            return;
          }

          if (action === 'copy-results') {
            await copyText(resultSummaryText(b));
            return;
          }

          if (action === 'close-battle') {
            const closed = await closeBattle(b);
            if (closed) {
              renderBattles();
              toast('Battle closed and locked.');
            }
            return;
          }
        } catch (e) {
          alert(`RaceIQ Faction Battles\n\n${e.message || e}`);
        }
      });
    });
  }

  function ensureTab() {
    const panel = document.getElementById(MOD.panelId);
    const tabs = panel?.querySelector('.ri-tabs');
    if (!tabs) return false;

    if (document.getElementById(MOD.tabId)) return true;

    const btn = document.createElement('button');
    btn.id = MOD.tabId;
    btn.className = 'ri-tab';
    btn.textContent = 'Battles';
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      panel.querySelectorAll('.ri-tab').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      renderBattles();
    });
    tabs.appendChild(btn);
    return true;
  }

  try {
    await load();
    injectStyle();
    ensureTab();

    const observer = new MutationObserver(() => {
      if (document.getElementById(MOD.panelId)) ensureTab();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});

    console.log(`[RaceIQ Faction Battles] v${MOD.version} loaded`);
  } catch (e) {
    console.error('[RaceIQ Faction Battles] startup error', e);
  }
})();