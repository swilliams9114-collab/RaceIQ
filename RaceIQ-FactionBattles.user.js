// ==UserScript==
// @name         RaceIQ - Faction Battles Module
// @namespace    raceiq.aurora.surrealis.battles
// @version      0.1.0
// @description  Lightweight Faction vs Faction race module for RaceIQ.
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
    version: '0.1.0',
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
    battles: []
  };

  let state = null;
  let selectedBattleId = '';

  const clone = obj => JSON.parse(JSON.stringify(obj));
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function uid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `battle-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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
      placementPrizes: {
        first: '',
        second: '',
        third: ''
      },
      rngPrize: {
        prize: 'Xanax',
        qtyPerWinner: 1,
        winnerCount: 0,
        finishersOnly: true,
        excludePodium: false
      },
      results: [],
      teamScore: null,
      rngWinners: [],
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
      @media(max-width:420px){#${MOD.viewId} .rib-grid{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function battleListHtml() {
    if (!state.battles.length) {
      return '<div class="rib-small">No faction battles yet.</div>';
    }

    return `<div class="rib-list">${state.battles.map(b => `
      <div class="rib-row">
        <b>Aurora Surrealis vs ${esc(b.opponent || 'Opponent TBD')}</b><br>
        <span class="rib-pill">${esc(b.format)}</span>
        <span class="rib-pill">${esc(b.status)}</span>
        <span class="rib-pill">${esc(b.date || 'Date TBD')}</span>
        <div class="rib-small">${esc(b.track || 'Track TBD')} • ${esc(b.laps)} laps • Class ${esc(b.raceClass)}</div>
        <div class="rib-actions">
          <button class="rib-btn secondary" data-rib-action="open" data-id="${esc(b.id)}">Open</button>
        </div>
      </div>`).join('')}</div>`;
  }

  function battleEditorHtml(b) {
    if (!b) return '';

    const slots = battleFormatCount(b.format);
    const message = renderParticipantMessage(b);

    return `
      <div class="rib-card">
        <h3>Battle Setup</h3>
        <div class="rib-grid">
          <div>
            <label class="rib-label">Opponent faction</label>
            <input class="rib-input" id="rib-opponent" value="${esc(b.opponent)}">
          </div>
          <div>
            <label class="rib-label">Format</label>
            <select class="rib-select" id="rib-format">
              <option value="4v4" ${b.format==='4v4'?'selected':''}>4v4</option>
              <option value="8v8" ${b.format==='8v8'?'selected':''}>8v8</option>
            </select>
          </div>
          <div>
            <label class="rib-label">Date</label>
            <input class="rib-input" id="rib-date" type="date" value="${esc(b.date)}">
          </div>
          <div>
            <label class="rib-label">Time (TCT)</label>
            <input class="rib-input" id="rib-time" value="${esc(b.time)}">
          </div>
          <div>
            <label class="rib-label">Track</label>
            <input class="rib-input" id="rib-track" value="${esc(b.track)}">
          </div>
          <div>
            <label class="rib-label">Laps</label>
            <input class="rib-input" id="rib-laps" type="number" min="1" value="${esc(b.laps)}">
          </div>
          <div>
            <label class="rib-label">Class</label>
            <input class="rib-input" id="rib-class" value="${esc(b.raceClass)}">
          </div>
          <div>
            <label class="rib-label">Password</label>
            <input class="rib-input" id="rib-password" value="${esc(b.password)}">
          </div>
        </div>
        <label class="rib-label"><input id="rib-no-upgrades" type="checkbox" ${b.noUpgrades?'checked':''}> No upgrades</label>
        <label class="rib-label">Race ID (optional until race exists)</label>
        <input class="rib-input" id="rib-race-id" value="${esc(b.raceId)}">
        <button class="rib-btn" data-rib-action="save-battle">Save Battle</button>
      </div>

      <div class="rib-card">
        <h3>Team Rosters</h3>
        <div class="rib-small">${slots} racers per faction. Enter one racer name per line.</div>
        <label class="rib-label">Aurora Surrealis (${slots})</label>
        <textarea class="rib-textarea" id="rib-our-roster">${esc((b.ourRoster || []).join('\n'))}</textarea>
        <label class="rib-label">${esc(b.opponent || 'Opponent')} (${slots})</label>
        <textarea class="rib-textarea" id="rib-opponent-roster">${esc((b.opponentRoster || []).join('\n'))}</textarea>
        <button class="rib-btn" data-rib-action="save-rosters">Save Rosters</button>
      </div>

      <div class="rib-card">
        <h3>Placement Prizes</h3>
        <label class="rib-label">1st place</label>
        <input class="rib-input" id="rib-first-prize" value="${esc(b.placementPrizes.first)}" placeholder="Example: 1x FHC">
        <label class="rib-label">2nd place</label>
        <input class="rib-input" id="rib-second-prize" value="${esc(b.placementPrizes.second)}" placeholder="Example: 3x Xanax">
        <label class="rib-label">3rd place</label>
        <input class="rib-input" id="rib-third-prize" value="${esc(b.placementPrizes.third)}" placeholder="Example: 2x Xanax">
        <button class="rib-btn" data-rib-action="save-placement">Save Placement Prizes</button>
      </div>

      <div class="rib-card">
        <h3>RNG Prize Setup</h3>
        <div class="rib-grid">
          <div>
            <label class="rib-label">Prize</label>
            <input class="rib-input" id="rib-rng-prize" value="${esc(b.rngPrize.prize)}">
          </div>
          <div>
            <label class="rib-label">Qty / winner</label>
            <input class="rib-input" id="rib-rng-qty" type="number" min="1" value="${esc(b.rngPrize.qtyPerWinner)}">
          </div>
          <div>
            <label class="rib-label">Random winners</label>
            <input class="rib-input" id="rib-rng-winners" type="number" min="0" value="${esc(b.rngPrize.winnerCount)}">
          </div>
        </div>
        <label class="rib-label"><input id="rib-rng-finishers" type="checkbox" ${b.rngPrize.finishersOnly?'checked':''}> Finishers only</label>
        <label class="rib-label"><input id="rib-rng-exclude-podium" type="checkbox" ${b.rngPrize.excludePodium?'checked':''}> Exclude 1st/2nd/3rd from RNG pool</label>
        <button class="rib-btn" data-rib-action="save-rng">Save RNG Setup</button>
      </div>

      <div class="rib-card">
        <h3>Participant Message</h3>
        <div class="rib-small">Password and all race details are filled from this battle's setup.</div><br>
        <div class="rib-pre">${esc(message)}</div>
        <button class="rib-btn" data-rib-action="copy-message">Copy Participant Message</button>
      </div>

      <div class="rib-card">
        <h3>Battle Status</h3>
        <div>
          ${['DRAFT','READY','RACING','RESULTS','PRIZES','CLOSED'].map(s => `<span class="rib-pill">${s === b.status ? '● ' : ''}${s}</span>`).join('')}
        </div>
        <label class="rib-label">Change status</label>
        <select class="rib-select" id="rib-status">
          ${['DRAFT','READY','RACING','RESULTS','PRIZES','CLOSED'].map(s => `<option value="${s}" ${s===b.status?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="rib-btn secondary" data-rib-action="save-status">Save Status</button>
      </div>
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
            b.placementPrizes.first = String(document.getElementById('rib-first-prize')?.value || '').trim();
            b.placementPrizes.second = String(document.getElementById('rib-second-prize')?.value || '').trim();
            b.placementPrizes.third = String(document.getElementById('rib-third-prize')?.value || '').trim();
            b.updatedAt = new Date().toISOString();
            await save();
            toast('Placement prizes saved.');
            return;
          }

          if (action === 'save-rng') {
            b.rngPrize.prize = String(document.getElementById('rib-rng-prize')?.value || 'Xanax').trim() || 'Xanax';
            b.rngPrize.qtyPerWinner = Math.max(1, Number(document.getElementById('rib-rng-qty')?.value || 1));
            b.rngPrize.winnerCount = Math.max(0, Number(document.getElementById('rib-rng-winners')?.value || 0));
            b.rngPrize.finishersOnly = Boolean(document.getElementById('rib-rng-finishers')?.checked);
            b.rngPrize.excludePodium = Boolean(document.getElementById('rib-rng-exclude-podium')?.checked);
            b.updatedAt = new Date().toISOString();
            await save();
            toast('RNG prize setup saved.');
            return;
          }

          if (action === 'copy-message') {
            await saveBattleSetup(b);
            await copyText(renderParticipantMessage(b));
            return;
          }

          if (action === 'save-status') {
            const next = String(document.getElementById('rib-status')?.value || 'DRAFT');
            b.status = next;
            if (next === 'CLOSED') b.closedAt = new Date().toISOString();
            b.updatedAt = new Date().toISOString();
            await save();
            renderBattles();
            toast(`Battle status: ${next}`);
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
