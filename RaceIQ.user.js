// ==UserScript==
// @name         RaceIQ - Aurora Surrealis Race Manager
// @namespace    raceiq.aurora.surrealis
// @version      1.0.14
// @description  Mobile-first TornPDA race manager with race sync, automatic racer-name repair, standings, prizes, Championship, sharing, diagnostics, and backups.
// @homepageURL  https://github.com/swilliams9114-collab/RaceIQ
// @supportURL   https://github.com/swilliams9114-collab/RaceIQ/issues
// @author       Aurora Surrealis
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  if (window.top !== window.self) return;

  const APP = {
    name: 'RaceIQ',
    version: '1.0.14',
    apiBase: 'https://api.torn.com/v2',
    apiKey: '###PDA-APIKEY###',
    storageKey: 'raceiq_state_v1',
    snapshotPrefix: 'raceiq_snapshot_',
    buttonId: 'raceiq-floating-button',
    navWrapperId: 'raceiq-nav-wrapper',
    navButtonId: 'raceiq-nav-car',
    panelId: 'raceiq-panel',
    styleId: 'raceiq-style',
    defaultSeason: 'Season 1',
    qualifyingWeeks: 8,
    championshipWeeks: 4,
    points: [10,9,8,7,6,5,4,3,2,1],
    factionName: 'Aurora Surrealis'
  };

  const DEFAULT_STATE = {
    schema: 1,
    season: {
      name: 'Season 1',
      qualifyingWeeks: 8,
      championshipWeeks: 4,
      defaultTime: '2200',
      defaultLaps: 60,
      defaultClass: 'E',
      noUpgrades: true
    },
    qualifying: Array.from({length: 8}, (_, i) => ({
      week: i + 1,
      raceId: '',
      name: `AS Week ${i + 1} Season 1`,
      date: '',
      time: '2200',
      track: '',
      laps: 60,
      raceClass: 'E',
      password: '',
      status: 'Planned',
      results: [],
      syncedAt: ''
    })),
    championship: {
      started: false,
      finalists: [],
      races: Array.from({length: 4}, (_, i) => ({
        week: i + 1,
        raceId: '',
        name: `AS Championship Week ${i + 1} Season 1`,
        date: '',
        time: '2200',
        track: '',
        laps: 60,
        raceClass: 'E',
        password: '',
        status: 'Planned',
        results: [],
        syncedAt: ''
      }))
    },
    prizes: {
      inventory: [
        {name: 'Xanax', stock: 0, qtyPerWinner: 1, reserve: 0}
      ],
      history: []
    },
    grandPrix: [],
    archives: [],
    userCache: {},
    settings: {
      factionOnly: true,
      finishedOnly: true,
      defaultWinners: 5,
      shareTopCount: 12,
      announcementTemplate:
`AURORA SURREALIS — WEEK {week}

Race: {race}
Date/Time: {date} @ {time} TCT
Track: {track}
Laps: {laps}
Class: {class}
Upgrades: {upgrades}
Password: {password}

Top 8 after Week 8 advance to the Championship.
This is qualifying race {week} of {qualifyingWeeks}.
{cutoffLine}
{bubbleLine}

Weekly random prize: {winnerCount} winner(s), {prizeQty}x {prizeName} each.

Join the race, earn points, and fight for a Championship spot!`,
      reminderTemplate:
`AS Week {week} — {track}, {laps} laps, Class {class}, {date} @ {time} TCT. {upgradesShort} Password: {password}. Top 8 after Week 8 advance!`
    },
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastApiCheck: '',
      lastFactionSync: ''
    }
  };

  let state = null;
  let factionIndex = { byId: new Set(), byName: new Set(), namesById: new Map(), count: 0, loadedAt: 0 };
  let currentTab = 'home';
  let busy = false;

  // ---------- helpers ----------
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const normName = value => String(value || '')
    .trim().replace(/\s+/g, ' ').toLowerCase();

  const normTitle = value => String(value || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');

  function normalizeStatus(value) {
    const s = String(value || '').toLowerCase().trim().replace(/\s+/g, '_');
    if (s.includes('progress') || s === 'running') return 'in_progress';
    if (s.includes('finish') || s.includes('complete')) return 'finished';
    if (s.includes('open') || s.includes('waiting') || s.includes('recruit')) return 'open';
    if (s === 'planned') return 'planned';
    return s;
  }

  function displayStatus(value) {
    const s = normalizeStatus(value);
    if (s === 'in_progress') return 'In Progress';
    if (s === 'finished') return 'Completed';
    if (s === 'open') return 'Open';
    if (s === 'planned') return 'Planned';
    return value || '';
  }

  function pointsForFinish(finish) {
    const f = Number(finish);
    if (!Number.isFinite(f) || f <= 0) return 0;
    return f <= 10 ? Math.max(1, 11 - f) : 1;
  }

  function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  function currentQualifyingWeek() {
    const active = state.qualifying.find(r => ['Open','In Progress'].includes(displayStatus(r.status)));
    if (active) return active.week;
    const next = state.qualifying.find(r => displayStatus(r.status) !== 'Completed');
    return next ? next.week : 8;
  }

  function currentChampionshipWeek() {
    const active = state.championship.races.find(r => ['Open','In Progress'].includes(displayStatus(r.status)));
    if (active) return active.week;
    const next = state.championship.races.find(r => displayStatus(r.status) !== 'Completed');
    return next ? next.week : 4;
  }

  function phase() {
    const done = state.qualifying.filter(r => displayStatus(r.status) === 'Completed').length;
    if (done < 8) return 'QUALIFYING';
    if (!state.championship.started) return 'READY FOR CHAMPIONSHIP';
    const cDone = state.championship.races.filter(r => displayStatus(r.status) === 'Completed').length;
    return cDone < 4 ? 'CHAMPIONSHIP' : 'SEASON COMPLETE';
  }

  function qualifyingProgress() {
    const completed = state.qualifying.filter(r => displayStatus(r.status) === 'Completed').length;
    const linked = state.qualifying.filter(r => String(r.raceId || '').trim()).length;
    const synced = state.qualifying.filter(r => (r.results || []).length > 0).length;
    return {completed, linked, synced};
  }

  function raceLoadStatus(r) {
    if ((r.results || []).length > 0) return 'SYNCED';
    if (String(r.raceId || '').trim()) return 'LINKED';
    return 'MISSING';
  }

  function raceDateTimeMs(race) {
    const date = String(race?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;

    const digits = String(race?.time || '2200').replace(/\D/g, '').padStart(4, '0').slice(-4);
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4);

    // Torn City Time is UTC.
    const ms = Date.parse(`${date}T${hh}:${mm}:00Z`);
    return Number.isFinite(ms) ? ms : 0;
  }

  function countdownText(race) {
    const target = raceDateTimeMs(race);
    if (!target) return 'Set race date to enable countdown';

    const diff = target - Date.now();
    if (diff <= 0) {
      if (displayStatus(race?.status) === 'Completed') return 'Race completed';
      return 'Scheduled time has passed';
    }

    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function ageText(iso) {
    if (!iso) return 'Never';
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return 'Unknown';

    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function systemHealthSummary() {
    const issues = [];
    const warnings = [];
    const backupValidation = validateBackupState(state);
    const standings = aggregateQualifying();

    if (!backupValidation.ok) {
      issues.push('Stored data structure needs attention');
    }

    const missingNames = state.qualifying.reduce(
      (sum,r) => sum + (r.results || []).filter(x => !x.name).length,
      0
    );
    if (missingNames) issues.push(`${missingNames} racer name(s) unresolved`);

    const names = standings.map(r => normName(r.name)).filter(Boolean);
    const duplicateNames = names.filter((n,i) => names.indexOf(n) !== i);
    if (duplicateNames.length) issues.push('Duplicate racers detected in standings');

    const completedWithoutResults = state.qualifying.filter(
      r => displayStatus(r.status) === 'Completed' && !(r.results || []).length
    );
    if (completedWithoutResults.length) {
      issues.push(
        `Completed race(s) missing results: ${completedWithoutResults.map(r => 'W' + r.week).join(', ')}`
      );
    }

    const progress = qualifyingProgress();
    const currentWeek = currentQualifyingWeek();
    const currentRace = state.qualifying[currentWeek - 1];

    if (progress.synced < progress.completed) {
      warnings.push('Some completed races have not been synced');
    }

    if (
      currentRace &&
      displayStatus(currentRace.status) !== 'Completed' &&
      (!currentRace.date || !currentRace.track)
    ) {
      warnings.push(`Week ${currentWeek} setup is incomplete`);
    }

    if (!state.meta?.lastManualBackup) {
      warnings.push('No manual backup recorded yet');
    }

    const apiAge = state.meta?.lastApiCheck ? Date.now() - Date.parse(state.meta.lastApiCheck) : Infinity;
    if (apiAge > 24 * 60 * 60 * 1000) {
      warnings.push('Full API diagnostics have not run in the last 24h');
    }

    const status = issues.length ? 'ISSUES' : warnings.length ? 'ATTENTION' : 'GOOD';
    return {
      status,
      issues,
      warnings,
      apiAgeText: ageText(state.meta?.lastApiCheck),
      factionAgeText: ageText(state.meta?.lastFactionSync),
      backupAgeText: ageText(state.meta?.lastManualBackup)
    };
  }

  // ---------- TornPDA storage ----------
  async function loadState() {
    if (typeof PDA_storage !== 'undefined') {
      const saved = await PDA_storage.get(APP.storageKey, null);
      state = saved && saved.schema === 1 ? saved : clone(DEFAULT_STATE);
    } else {
      // Browser fallback for desktop testing only.
      const raw = localStorage.getItem(APP.storageKey);
      state = raw ? JSON.parse(raw) : clone(DEFAULT_STATE);
    }

    // V1-compatible migration: preserve existing race/prize data.
    if (!state.userCache || typeof state.userCache !== 'object') state.userCache = {};
    if (!state.meta) state.meta = clone(DEFAULT_STATE.meta);
    if (!Array.isArray(state.qualifying)) state.qualifying = clone(DEFAULT_STATE.qualifying);
    if (!state.championship) state.championship = clone(DEFAULT_STATE.championship);
    if (!state.settings || typeof state.settings !== 'object') state.settings = clone(DEFAULT_STATE.settings);
    if (!state.settings.announcementTemplate) state.settings.announcementTemplate = DEFAULT_STATE.settings.announcementTemplate;
    if (!state.settings.reminderTemplate) state.settings.reminderTemplate = DEFAULT_STATE.settings.reminderTemplate;

    await saveState(false);
  }

  async function saveState(snapshot = false) {
    state.meta.updatedAt = new Date().toISOString();

    if (typeof PDA_storage !== 'undefined') {
      if (snapshot) await createSnapshot();
      await PDA_storage.set(APP.storageKey, state);
    } else {
      localStorage.setItem(APP.storageKey, JSON.stringify(state));
    }
  }

  async function createSnapshot(label = 'auto') {
    if (typeof PDA_storage === 'undefined') return null;

    const key = `${APP.snapshotPrefix}${Date.now()}_${label}`;
    const payload = {
      createdAt: new Date().toISOString(),
      label,
      appVersion: APP.version,
      state: clone(state)
    };

    await PDA_storage.set(key, payload);

    const keys = (await PDA_storage.list())
      .filter(k => k.startsWith(APP.snapshotPrefix))
      .sort();

    while (keys.length > 10) {
      await PDA_storage.delete(keys.shift());
    }

    return {key, ...payload};
  }

  async function listSnapshots() {
    if (typeof PDA_storage === 'undefined') return [];

    const keys = (await PDA_storage.list())
      .filter(k => k.startsWith(APP.snapshotPrefix))
      .sort()
      .reverse();

    const rows = [];
    for (const key of keys.slice(0,10)) {
      try {
        const snap = await PDA_storage.get(key, null);
        if (snap?.state) rows.push({key, ...snap});
      } catch (_) {}
    }
    return rows;
  }

  async function restoreSnapshot(key) {
    if (typeof PDA_storage === 'undefined') {
      throw new Error('Snapshots are only available inside TornPDA storage.');
    }

    const snap = await PDA_storage.get(key, null);
    if (!snap?.state || snap.state.schema !== 1) {
      throw new Error('That snapshot is missing or invalid.');
    }

    if (!confirm(
      `Restore snapshot from ${new Date(snap.createdAt).toLocaleString()}?\n\n` +
      `Label: ${snap.label || 'snapshot'}\n\n` +
      `Your current state will be snapshotted first.`
    )) return false;

    await createSnapshot('before_snapshot_restore');
    state = clone(snap.state);
    await saveState(false);
    return true;
  }

  // ---------- API ----------
  async function apiGet(path, allow404 = false) {
    const url = APP.apiBase + path;
    const headers = {
      'Authorization': `ApiKey ${APP.apiKey}`,
      'Accept': 'application/json'
    };

    let response;
    if (typeof PDA_httpGet === 'function') {
      response = await PDA_httpGet(url, headers);
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

  async function fetchFactionMembers(force = false) {
    if (!force && factionIndex.count && Date.now() - factionIndex.loadedAt < 10 * 60 * 1000) {
      return factionIndex;
    }

    const data = await apiGet('/faction/members');
    const raw = data?.members ?? data?.faction?.members ?? [];
    const arr = Array.isArray(raw)
      ? raw
      : Object.entries(raw || {}).map(([id, v]) => ({...v, id: v?.id ?? id}));

    const byId = new Set();
    const byName = new Set();
    const namesById = new Map();

    arr.forEach(m => {
      const id = String(m?.id ?? m?.user_id ?? m?.player_id ?? '').trim();
      const rawName = String(m?.name ?? m?.user_name ?? m?.player_name ?? '').trim();
      const name = normName(rawName);

      if (id) byId.add(id);
      if (name) byName.add(name);
      if (id && rawName) {
        namesById.set(id, rawName);
        state.userCache[id] = rawName;
      }
    });

    factionIndex = {
      byId,
      byName,
      namesById,
      count: Math.max(byId.size, byName.size),
      loadedAt: Date.now()
    };

    state.meta.lastFactionSync = new Date().toISOString();
    await saveState(false);
    return factionIndex;
  }

  function isFactionMember(racer) {
    const id = String(racer?.id || '').trim();
    const name = normName(racer?.name);
    return Boolean((id && factionIndex.byId.has(id)) || (name && factionIndex.byName.has(name)));
  }

  function normalizeRaceList(payload) {
    const raw = Array.isArray(payload?.races) ? payload.races : [];
    return raw.map(r => ({
      id: String(r.id ?? r.race_id ?? ''),
      title: String(r.title ?? r.name ?? r.race_name ?? '').trim(),
      status: displayStatus(r.status ?? r.state ?? ''),
      start: Number(r.schedule?.start ?? r.start_time ?? 0),
      participantCount: Number(r.participants?.current ?? r.participants ?? 0)
    })).filter(r => r.id && r.title);
  }

  async function fetchLatestCustomRaces() {
    return normalizeRaceList(await apiGet('/racing/races?cat=custom&limit=100&sort=DESC'));
  }

  function bestTitleMatch(races, title) {
    const expected = normTitle(title);
    let matches = races.filter(r => normTitle(r.title) === expected);

    if (!matches.length) {
      matches = races.filter(r => {
        const a = normTitle(r.title);
        return a && expected && (a.includes(expected) || expected.includes(a));
      });
    }

    matches.sort((a,b) => {
      const rank = s => normalizeStatus(s) === 'in_progress' ? 3 :
        normalizeStatus(s) === 'open' ? 2 :
        normalizeStatus(s) === 'finished' ? 1 : 0;
      return rank(b.status) - rank(a.status) || Number(b.id) - Number(a.id);
    });

    return matches[0] || null;
  }

  function raceScheduledTimestamp(date, time = '2200') {
    const d = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;

    const digits = String(time || '2200').replace(/\D/g, '').padStart(4, '0').slice(-4);
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const ms = Date.parse(`${d}T${hh}:${mm}:00Z`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  async function fetchCustomRacesWindow(fromTs, toTs) {
    return normalizeRaceList(await apiGet(
      `/racing/races?cat=custom&limit=100&sort=DESC&from=${fromTs}&to=${toTs}`
    ));
  }

  async function searchHistoricalRaceByTitle(title, date, time = '2200') {
    const center = raceScheduledTimestamp(date, time);
    if (!center) return null;

    const windows = [
      [center - 90 * 60, center + 90 * 60],
      [center - 4 * 60 * 60, center + 4 * 60 * 60],
      [center - 12 * 60 * 60, center + 12 * 60 * 60]
    ];

    let calls = 0;
    const maxCalls = 16;

    async function searchWindow(fromTs, toTs, depth = 0) {
      if (calls >= maxCalls) return null;
      calls++;

      const races = await fetchCustomRacesWindow(fromTs, toTs);
      const found = bestTitleMatch(races, title);
      if (found) return found;

      if (races.length >= 100 && depth < 5 && (toTs - fromTs) > 15 * 60) {
        const mid = Math.floor((fromTs + toTs) / 2);
        const newer = await searchWindow(mid + 1, toTs, depth + 1);
        if (newer) return newer;
        return await searchWindow(fromTs, mid, depth + 1);
      }

      return null;
    }

    for (const [fromTs, toTs] of windows) {
      const found = await searchWindow(fromTs, toTs);
      if (found) return found;
      if (calls >= maxCalls) break;
    }

    return null;
  }

  async function findRaceByTitle(title, preferredDate = '', preferredTime = '2200') {
    const latest = await fetchLatestCustomRaces();
    const recent = bestTitleMatch(latest, title);
    if (recent) return recent;

    if (preferredDate) {
      return await searchHistoricalRaceByTitle(title, preferredDate, preferredTime);
    }

    return null;
  }

  async function fetchRace(raceId) {
    let data = await apiGet(`/racing/${encodeURIComponent(raceId)}/race`, true);
    if (data) return unwrapRace(data, raceId);
    data = await apiGet(`/racing?selections=race&id=${encodeURIComponent(raceId)}`, true);
    if (data) return unwrapRace(data, raceId);
    throw new Error(`Race ${raceId} was not returned by Torn.`);
  }

  function unwrapRace(payload, raceId) {
    if (payload?.race && !Array.isArray(payload.race)) return payload.race;
    if (payload?.races) {
      const arr = Array.isArray(payload.races) ? payload.races : Object.values(payload.races);
      return arr.find(r => String(r.id ?? r.race_id ?? '') === String(raceId)) || payload;
    }
    return payload;
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
      position: Number(r.position ?? r.place ?? r.rank ?? r.result?.position ?? 0) || 0
    })).filter(r => r.id || r.name);
  }

  function extractBasicUser(payload, fallbackId = '') {
    const candidates = [
      payload?.profile,
      payload?.basic,
      payload?.user,
      payload?.player,
      payload
    ].filter(Boolean);

    for (const item of candidates) {
      const id = String(item?.id ?? item?.user_id ?? item?.player_id ?? fallbackId ?? '').trim();
      const name = String(item?.name ?? item?.user_name ?? item?.player_name ?? '').trim();
      if (name) return {id, name};
    }

    return {id: String(fallbackId || ''), name: ''};
  }

  function needsNameRepair(value, id = '') {
    const name = String(value || '').trim();
    if (!name) return true;
    if (id && name === `Player ${id}`) return true;
    return /^Player\s+\d+$/i.test(name);
  }

  async function resolveNameForId(id, allowUserFallback = true) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return {name: '', source: 'unresolved'};

    const factionName = factionIndex.namesById?.get(cleanId) || '';
    if (factionName) {
      state.userCache[cleanId] = factionName;
      return {name: factionName, source: 'faction'};
    }

    const cached = String(state.userCache?.[cleanId] || '').trim();
    if (cached && !needsNameRepair(cached, cleanId)) {
      return {name: cached, source: 'cache'};
    }

    if (allowUserFallback) {
      try {
        const data = await apiGet(`/user/${encodeURIComponent(cleanId)}/basic`);
        const user = extractBasicUser(data, cleanId);
        if (user.name) {
          state.userCache[cleanId] = user.name;
          return {name: user.name, source: 'userApi'};
        }
      } catch (e) {
        console.warn(`[RaceIQ] Could not resolve racer name for ${cleanId}`, e);
      }
    }

    return {name: '', source: 'unresolved'};
  }

  async function repairStoredRacerNames(allowUserFallback = true) {
    const stats = {fromFaction: 0, fromCache: 0, fromUserApi: 0, unresolved: 0, changed: 0};
    const raceGroups = [
      ...(state.qualifying || []),
      ...((state.championship && state.championship.races) || [])
    ];

    for (const race of raceGroups) {
      for (const result of (race.results || [])) {
        const id = String(result.id || '').trim();
        if (!id || !needsNameRepair(result.name, id)) continue;

        const resolved = await resolveNameForId(id, allowUserFallback);
        if (resolved.name) {
          result.name = resolved.name;
          stats.changed += 1;
          if (resolved.source === 'faction') stats.fromFaction += 1;
          else if (resolved.source === 'cache') stats.fromCache += 1;
          else if (resolved.source === 'userApi') stats.fromUserApi += 1;
        } else {
          stats.unresolved += 1;
        }
      }
    }

    if (stats.changed) await saveState(false);
    return stats;
  }

  async function resolveRacerNames(racers) {
    const resolved = [];

    for (const racer of racers) {
      const copy = {...racer};
      const id = String(copy.id || '').trim();

      if (id && needsNameRepair(copy.name, id)) {
        const lookup = await resolveNameForId(id, true);
        if (lookup.name) copy.name = lookup.name;
      }

      if (copy.name && id && !needsNameRepair(copy.name, id)) {
        state.userCache[id] = copy.name;
      }

      resolved.push(copy);
    }

    return resolved;
  }

  // ---------- race sync ----------
  async function linkRace(kind, week) {
    const target = kind === 'qualifying'
      ? state.qualifying[week - 1]
      : state.championship.races[week - 1];

    if (!target) throw new Error('Race setup entry not found.');
    if (!target.name.trim()) throw new Error('Enter the race name first.');

    const found = await findRaceByTitle(target.name, target.date, target.time);
    if (!found) {
      const hint = target.date
        ? `I searched recent races and around ${target.date} at ${target.time || '2200'} TCT.`
        : 'This is probably an older race. Tap Edit and add the race date, then use Find.';
      throw new Error(`Could not find "${target.name}". ${hint}`);
    }

    target.raceId = found.id;
    target.status = found.status;
    await saveState(false);
    return found;
  }

  async function syncRace(kind, week) {
    await fetchFactionMembers(false);

    const target = kind === 'qualifying'
      ? state.qualifying[week - 1]
      : state.championship.races[week - 1];

    if (!target.raceId) await linkRace(kind, week);

    const race = await fetchRace(target.raceId);
    const all = extractRacers(race);
    const eligible = all.filter(r => !state.settings.factionOnly || isFactionMember(r));
    const named = await resolveRacerNames(eligible);

    target.results = named
      .filter(r => !state.settings.finishedOnly || r.position > 0)
      .map(r => ({
        id: r.id,
        name: r.name,
        finish: r.position,
        points: pointsForFinish(r.position)
      }))
      .sort((a,b) => (a.finish || 9999) - (b.finish || 9999));

    target.status = displayStatus(race?.status ?? race?.state ?? race?.race_status ?? target.status);
    target.syncedAt = new Date().toISOString();

    if (target.results.length && target.results.every(r => r.finish > 0)) {
      const rawStatus = normalizeStatus(race?.status ?? race?.state ?? race?.race_status ?? '');
      if (rawStatus === 'finished') target.status = 'Completed';
    }

    await saveState(false);

    const unresolved = target.results.filter(r => !r.name).length;
    return {
      imported: target.results.length,
      skipped: Math.max(0, all.length - eligible.length),
      unresolved,
      status: target.status
    };
  }

  // ---------- standings ----------
  function aggregateQualifying() {
    const map = new Map();
    const nameToId = new Map();

    for (const race of state.qualifying) {
      for (const result of race.results) {
        const id = String(result.id || '').trim();
        const name = String(result.name || state.userCache?.[id] || '').trim();
        if (id && name) nameToId.set(normName(name), id);
      }
    }

    for (const race of state.qualifying) {
      race.results.forEach(result => {
        if (!result.finish) return;

        const rawId = String(result.id || '').trim();
        const cachedName = rawId ? state.userCache?.[rawId] : '';
        const name = String(result.name || cachedName || '').trim();
        const inferredId = rawId || (name ? nameToId.get(normName(name)) : '') || '';

        const key = inferredId
          ? `id:${inferredId}`
          : name
          ? `name:${normName(name)}`
          : '';

        if (!key) return;

        let entry = map.get(key);
        if (!entry) {
          entry = {
            id: inferredId,
            name: name || (inferredId ? `Player ${inferredId}` : 'Unknown Racer'),
            finishes: Array(8).fill(null),
            pointsByWeek: Array(8).fill(0)
          };
          map.set(key, entry);
        }

        if (name) entry.name = name;
        if (inferredId) entry.id = inferredId;
        entry.finishes[race.week - 1] = result.finish;
        entry.pointsByWeek[race.week - 1] = pointsForFinish(result.finish);
      });
    }

    const rows = Array.from(map.values()).map(r => {
      const total = r.pointsByWeek.reduce((a,b) => a + b, 0);
      const starts = r.finishes.filter(v => v !== null).length;
      const wins = r.finishes.filter(v => v === 1).length;
      const podiums = r.finishes.filter(v => v !== null && v <= 3).length;
      const top10 = r.finishes.filter(v => v !== null && v <= 10).length;
      const valid = r.finishes.filter(v => v !== null);
      const best = valid.length ? Math.min(...valid) : null;
      const avg = valid.length ? valid.reduce((a,b) => a+b, 0) / valid.length : null;
      return {...r,total,starts,wins,podiums,top10,best,avg};
    }).filter(r => r.starts > 0);

    rows.sort((a,b) =>
      b.total - a.total ||
      b.wins - a.wins ||
      b.podiums - a.podiums ||
      b.starts - a.starts ||
      a.name.localeCompare(b.name)
    );

    return rows.map((r,i) => ({
      ...r,
      rank: i + 1,
      status: i < 8 ? 'QUALIFYING' : i < 12 ? 'BUBBLE' : ''
    }));
  }

  function aggregateChampionship() {
    if (!state.championship.started) return [];

    const finalists = clone(state.championship.finalists);
    return finalists.map(f => {
      const finishes = Array(4).fill(null);
      const pointsByWeek = Array(4).fill(0);

      state.championship.races.forEach(race => {
        const result = race.results.find(x =>
          (f.id && x.id && String(f.id) === String(x.id)) ||
          normName(f.name) === normName(x.name)
        );
        if (result?.finish) {
          finishes[race.week - 1] = result.finish;
          pointsByWeek[race.week - 1] = pointsForFinish(result.finish);
        }
      });

      const points = pointsByWeek.reduce((a,b) => a+b, 0);
      const starts = finishes.filter(v => v !== null).length;
      const wins = finishes.filter(v => v === 1).length;
      const podiums = finishes.filter(v => v !== null && v <= 3).length;
      return {...f, finishes, pointsByWeek, points, starts, wins, podiums};
    }).sort((a,b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.podiums - a.podiums ||
      a.qualifyingSeed - b.qualifyingSeed
    ).map((r,i) => ({...r, rank:i+1}));
  }

  async function startChampionship() {
    const standings = aggregateQualifying();
    const completed = state.qualifying.filter(r => displayStatus(r.status) === 'Completed').length;

    if (completed < state.season.qualifyingWeeks) {
      throw new Error(
        `Championship is not ready yet. ${completed}/${state.season.qualifyingWeeks} qualifying races are complete.`
      );
    }

    if (standings.length < 8) {
      throw new Error('Not enough qualifying racers to lock a Top 8.');
    }

    const top8 = standings.slice(0,8);
    const summary = top8.map(r => `#${r.rank} ${r.name} — ${r.total} pts`).join('\n');

    if (!confirm(
      `Lock the Championship Top 8?\n\n` +
      `${summary}\n\n` +
      `Qualifying points will be saved as seeds, but Championship points start at 0.\n\n` +
      `Continue?`
    )) return;

    await createSnapshot('before_championship');

    state.championship.started = true;
    state.championship.finalists = top8.map(r => ({
      id: r.id,
      name: r.name,
      qualifyingSeed: r.rank,
      qualifyingPoints: r.total
    }));

    await saveState(false);
  }

  // ---------- prizes ----------
  function getPrize(name) {
    return state.prizes.inventory.find(p => p.name === name);
  }

  function eligibleForWeeklyDraw(week) {
    const race = state.qualifying[week - 1];
    return (race?.results || []).filter(r => r.name && r.finish > 0);
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
    for (let i = arr.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, Math.min(count, arr.length));
  }

  function latestSyncedQualifyingWeek() {
    const synced = state.qualifying
      .filter(r => (r.results || []).length > 0)
      .map(r => r.week);
    return synced.length ? Math.max(...synced) : 1;
  }

  function drawHistoryForWeek(week) {
    return state.prizes.history.filter(h => Number(h.week) === Number(week));
  }

  function groupedPrizeDraws(limit = 8) {
    const byId = new Map();

    for (const h of state.prizes.history) {
      const id = h.id || `legacy-${h.week}-${h.timestamp || ''}-${h.prize || ''}`;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          week: h.week,
          timestamp: h.timestamp || '',
          prize: h.prize,
          qtyPerWinner: Number(h.qty || 1),
          winners: [],
          restorable: Boolean(h.id)
        });
      }
      byId.get(id).winners.push(h);
    }

    return [...byId.values()]
      .sort((a,b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, limit);
  }

  async function undoPrizeDraw(drawId) {
    const entries = state.prizes.history.filter(h => h.id === drawId);
    if (!entries.length) throw new Error('That prize draw could not be found.');

    const prizeName = entries[0].prize;
    const prize = getPrize(prizeName);
    const restoreQty = entries.reduce((sum, h) => sum + Number(h.qty || 0), 0);

    const names = entries.map(h => h.racer).join(', ');
    if (!confirm(
      `Undo this prize draw?\n\n` +
      `Week ${entries[0].week}\n` +
      `${entries.length} winner(s): ${names}\n` +
      `Restore ${restoreQty}x ${prizeName} to inventory\n\n` +
      `This removes only this draw from RaceIQ history.`
    )) return false;

    await createSnapshot('before_undo_prize_draw');

    state.prizes.history = state.prizes.history.filter(h => h.id !== drawId);

    if (prize) {
      prize.stock = Number(prize.stock || 0) + restoreQty;
    }

    await saveState(false);
    return true;
  }

  async function drawWeeklyPrize(week, prizeName, winnerCount) {
    const eligible = eligibleForWeeklyDraw(week);
    if (!eligible.length) throw new Error(`Week ${week} has no eligible finished racers.`);

    const prize = getPrize(prizeName);
    if (!prize) throw new Error(`Prize "${prizeName}" is not configured.`);

    const winners = Math.max(1, Number(winnerCount) || 1);
    if (winners > eligible.length) {
      throw new Error(`Week ${week} only has ${eligible.length} eligible racers, so you cannot draw ${winners} unique winners.`);
    }

    const totalQty = winners * Number(prize.qtyPerWinner || 1);
    const available = Number(prize.stock || 0) - Number(prize.reserve || 0);
    if (available < totalQty) {
      throw new Error(`Not enough ${prize.name}. Need ${totalQty}; only ${available} available above reserve.`);
    }

    if (!confirm(
      `Week ${week} prize draw\n\n` +
      `${eligible.length} eligible racers\n` +
      `${winners} winner(s)\n` +
      `${prize.qtyPerWinner}x ${prize.name} each\n\n` +
      `Run random draw?`
    )) return null;

    await createSnapshot('before_prize_draw');
    const selected = randomUnique(eligible, winners);
    const drawId = `W${week}-${Date.now()}`;

    selected.forEach((winner, index) => {
      state.prizes.history.push({
        id: drawId,
        timestamp: new Date().toISOString(),
        type: 'QUALIFYING',
        week,
        winnerNumber: index + 1,
        racerId: winner.id,
        racer: winner.name,
        prize: prize.name,
        qty: Number(prize.qtyPerWinner || 1),
        eligibleCount: eligible.length,
        randomSource: window.crypto?.getRandomValues ? 'crypto' : 'math'
      });
    });

    prize.stock = Number(prize.stock || 0) - totalQty;
    await saveState(false);
    return {drawId, selected, prize: clone(prize)};
  }

  // ---------- share messages ----------
  function shareTop8() {
    const s = aggregateQualifying();
    const top = s.slice(0,8);
    const bubble = s.slice(8,12);
    let out = `AURORA SURREALIS — ${state.season.name.toUpperCase()} QUALIFYING\n\n`;
    out += `CURRENT TOP 8\n`;
    top.forEach(r => out += `${r.rank}. ${r.name} — ${r.total} pts | ${r.starts} starts | ${r.wins}W | ${r.podiums} podiums\n`);
    if (bubble.length) {
      out += `\nBUBBLE WATCH\n`;
      bubble.forEach(r => out += `${r.rank}. ${r.name} — ${r.total} pts\n`);
    }
    out += `\nTop 8 after Week 8 advance to the Championship.`;
    return out;
  }
  function shareBubbleWatch() {
    const s = aggregateQualifying();
    const eighth = s[7];
    const bubble = s.slice(8, 12);

    let out = `AURORA SURREALIS — BUBBLE WATCH\n\n`;

    if (!eighth) return out + 'Not enough racers are currently ranked to calculate the Top 8 cutoff.';

    out += `CHAMPIONSHIP CUT LINE\n#8 ${eighth.name} — ${eighth.total} pts\n\n`;

    if (!bubble.length) {
      out += 'No racers are currently listed below the cut line.';
      return out;
    }

    out += 'CHASING THE TOP 8\n';
    bubble.forEach(r => {
      const gap = Math.max(0, eighth.total - r.total);
      out += `#${r.rank} ${r.name} — ${r.total} pts • ${gap} pt${gap===1?'':'s'} back\n`;
    });

    out += '\nTop 8 after Week 8 advance to the Championship.';
    return out;
  }

  function shareFullStandings() {
    const s = aggregateQualifying();
    let out = `AURORA SURREALIS — ${state.season.name.toUpperCase()} STANDINGS\n\n`;
    s.forEach(r => out += `${r.rank}. ${r.name} — ${r.total} pts (${r.starts} starts)\n`);
    return out;
  }

  function shareWeekResults(week) {
    const race = state.qualifying[week - 1];
    let out = `AURORA SURREALIS — WEEK ${week} RESULTS\n`;
    out += `${race.name || `Week ${week}`}\n\n`;
    if (!race.results.length) return out + `No synced results yet.`;
    race.results.forEach(r => out += `${r.finish}. ${r.name} — ${r.points} pts\n`);
    return out;
  }

  function sharePrizeWinners() {
    const draws = groupedPrizeDraws(1);
    if (!draws.length) return 'AURORA SURREALIS — PRIZE WINNERS\n\nNo prize draw has been recorded yet.';

    const draw = draws[0];
    let out = `AURORA SURREALIS — WEEK ${draw.week} PRIZE WINNERS\n\n`;
    draw.winners
      .slice()
      .sort((a,b) => Number(a.winnerNumber || 999) - Number(b.winnerNumber || 999))
      .forEach((h,i) => {
        out += `${i+1}. ${h.racer} — ${h.qty}x ${h.prize}\n`;
      });

    out += '\nThanks for racing!';
    return out;
  }

  function renderRaceMessageTemplate(template, week) {
    const race = state.qualifying[week - 1];
    const standings = aggregateQualifying();
    const eighth = standings[7];
    const ninth = standings[8];
    const xanax = getPrize('Xanax') || {name:'Xanax',qtyPerWinner:1};

    const values = {
      week,
      qualifyingWeeks: state.season.qualifyingWeeks,
      race: race?.name || `AS Week ${week} ${state.season.name}`,
      date: race?.date || 'TBD',
      time: race?.time || '2200',
      track: race?.track || 'TBD',
      laps: race?.laps || 60,
      class: race?.raceClass || 'E',
      upgrades: state.season.noUpgrades ? 'Not Allowed' : 'Allowed',
      upgradesShort: state.season.noUpgrades ? 'NO UPGRADES.' : 'Upgrades allowed.',
      password: race?.password || 'TBD',
      winnerCount: state.settings.defaultWinners,
      prizeQty: xanax.qtyPerWinner || 1,
      prizeName: xanax.name || 'Xanax',
      cutoffLine: eighth ? `Current cutoff: #8 ${eighth.name} — ${eighth.total} pts` : '',
      bubbleLine: ninth ? `Bubble: #9 ${ninth.name} — ${ninth.total} pts` : ''
    };

    return String(template || '').replace(/\{([a-zA-Z0-9]+)\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
    ).replace(/\n{3,}/g, '\n\n').trim();
  }

  function raceAnnouncement(week, short = false) {
    const template = short
      ? state.settings.reminderTemplate
      : state.settings.announcementTemplate;
    return renderRaceMessageTemplate(template, week);
  }

  function resultsAnnouncement(week) {
    const race = state.qualifying[week - 1];
    if (!race.results.length) return `Week ${week} has no synced results yet.`;

    const podium = race.results.slice(0,3);
    const standings = aggregateQualifying();
    const eighth = standings[7];
    const ninth = standings[8];

    let out = `AURORA SURREALIS — WEEK ${week} COMPLETE\n\n`;
    out += `${race.name}\n\nPODIUM\n`;
    podium.forEach(r => out += `${r.finish}. ${r.name} — ${r.points} pts\n`);

    out += `\n${race.results.length} faction racers finished this week.`;
    out += '\nStandings have been updated.';

    if (eighth) out += `\n\nCurrent #8: ${eighth.name} — ${eighth.total} pts`;
    if (ninth) {
      const gap = Math.max(0, eighth.total - ninth.total);
      out += `\n#9: ${ninth.name} — ${ninth.total} pts • Gap ${gap}`;
    }

    out += '\n\nTop 8 after Week 8 advance to the Championship.';
    return out;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard.');
    } catch (_) {
      window.prompt('Copy this text:', text);
    }
  }

  // ---------- backup ----------
  function backupSummary(sourceState = state) {
    const qualifyingSynced = (sourceState.qualifying || []).filter(r => (r.results || []).length > 0).length;
    const qualifyingResults = (sourceState.qualifying || []).reduce((sum,r) => sum + (r.results || []).length, 0);
    const prizeDraws = new Set((sourceState.prizes?.history || []).map(h => h.id || `${h.week}-${h.timestamp}-${h.prize}`)).size;
    const championshipStarted = Boolean(sourceState.championship?.started);

    return {
      qualifyingSynced,
      qualifyingResults,
      prizeDraws,
      championshipStarted
    };
  }

  function validateBackupState(incoming) {
    const problems = [];

    if (!incoming || incoming.schema !== 1) problems.push('schema must be 1');
    if (!Array.isArray(incoming?.qualifying) || incoming.qualifying.length !== 8) problems.push('must contain 8 qualifying races');
    if (!Array.isArray(incoming?.championship?.races) || incoming.championship.races.length !== 4) problems.push('must contain 4 Championship races');
    if (!incoming?.prizes || !Array.isArray(incoming.prizes.inventory) || !Array.isArray(incoming.prizes.history)) {
      problems.push('prize data is missing');
    }

    return {ok: problems.length === 0, problems};
  }

  async function copyBackup() {
    const payload = {
      app: APP.name,
      version: APP.version,
      exportedAt: new Date().toISOString(),
      summary: backupSummary(state),
      state
    };

    await copyText(JSON.stringify(payload));
    state.meta.lastManualBackup = payload.exportedAt;
    await saveState(false);
  }

  async function importBackup() {
    const raw = prompt('Paste a RaceIQ backup JSON:');
    if (!raw) return;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error('That text is not valid JSON.');
    }

    const incoming = parsed?.state || parsed;
    const validation = validateBackupState(incoming);
    if (!validation.ok) {
      throw new Error(`Invalid RaceIQ backup: ${validation.problems.join('; ')}.`);
    }

    const summary = backupSummary(incoming);
    const exportedAt = parsed?.exportedAt || incoming?.meta?.updatedAt || 'unknown time';

    if (!confirm(
      `Import this RaceIQ backup?\n\n` +
      `Backup date: ${exportedAt}\n` +
      `Qualifying races loaded: ${summary.qualifyingSynced}/8\n` +
      `Stored qualifying results: ${summary.qualifyingResults}\n` +
      `Prize draws: ${summary.prizeDraws}\n` +
      `Championship started: ${summary.championshipStarted ? 'Yes' : 'No'}\n\n` +
      `A safety snapshot of your current data will be created first.`
    )) return;

    await createSnapshot('before_import');
    state = clone(incoming);
    if (!state.userCache || typeof state.userCache !== 'object') state.userCache = {};
    await saveState(false);
  }

  // ---------- diagnostics ----------
  async function runDiagnostics() {
    const rows = [];
    const push = (name, ok, detail) => rows.push({name, status: ok ? 'PASS' : 'FAIL', detail});

    push('Storage loaded', !!state, `Schema ${state?.schema}`);
    push('8 qualifying races', state.qualifying.length === 8, `${state.qualifying.length} configured`);
    push('4 Championship races', state.championship.races.length === 4, `${state.championship.races.length} configured`);

    const backupValidation = validateBackupState(state);
    push(
      'Backup structure',
      backupValidation.ok,
      backupValidation.ok ? 'Current state can be exported as a valid V1 backup' : backupValidation.problems.join('; ')
    );

    try {
      const info = await apiGet('/key/info');
      push('Torn API key', !!info, 'API responded successfully');
      state.meta.lastApiCheck = new Date().toISOString();
    } catch (e) {
      push('Torn API key', false, e.message);
    }

    let repairStats = {fromFaction: 0, fromCache: 0, fromUserApi: 0, unresolved: 0, changed: 0};
    try {
      const faction = await fetchFactionMembers(true);
      push('Faction roster', faction.count > 0, `${faction.count} faction members loaded`);
      repairStats = await repairStoredRacerNames(true);
      push(
        'Stored racer name repair',
        repairStats.unresolved === 0,
        `${repairStats.changed} repaired • faction ${repairStats.fromFaction} • cache ${repairStats.fromCache} • user API ${repairStats.fromUserApi} • unresolved ${repairStats.unresolved}`
      );
    } catch (e) {
      push('Faction roster', false, e.message);
    }

    const standings = aggregateQualifying();
    const names = standings.map(r => normName(r.name));
    const dupes = names.filter((n,i) => names.indexOf(n) !== i);
    push('No duplicate standings racers', dupes.length === 0, dupes.length ? [...new Set(dupes)].join(', ') : 'No duplicates');

    const missingNames = [];
    const badFinish = [];

    state.qualifying.forEach(r => r.results.forEach(x => {
      if (!x.name) missingNames.push(`W${r.week}:${x.id || '?'}`);
      if (!x.finish || x.finish < 1) badFinish.push(`W${r.week}:${x.name || x.id || '?'}`);
    }));

    push(
      'Racer names resolved',
      missingNames.length === 0,
      missingNames.length
        ? `${missingNames.length} result(s) missing a name: ${missingNames.slice(0, 8).join(', ')}${missingNames.length > 8 ? '…' : ''}`
        : 'All stored racers have names'
    );

    push(
      'Valid qualifying finishes',
      badFinish.length === 0,
      badFinish.length ? badFinish.join(', ') : 'All stored results have a valid finish'
    );

    const health = systemHealthSummary();
    rows.push({
      name: 'Home health summary',
      status: health.status === 'ISSUES' ? 'FAIL' : 'PASS',
      detail: health.status === 'GOOD'
        ? 'No local data problems detected'
        : [...health.issues, ...health.warnings].join('; ')
    });

    const result = rows.map(r => `${r.status}: ${r.name} — ${r.detail}`).join('\n');
    await saveState(false);
    alert(`RaceIQ Diagnostics\n\n${result}`);
  }

  // ---------- UI ----------
  function injectStyle() {
    if (document.getElementById(APP.styleId)) return;
    const style = document.createElement('style');
    style.id = APP.styleId;
    style.textContent = `
      #${APP.navWrapperId}{
        list-style:none;
        display:flex;
        align-items:center;
        justify-content:center
      }
      #${APP.navButtonId}{
        position:relative;
        display:flex;
        align-items:center;
        justify-content:center;
        width:34px;
        height:34px;
        padding:0;
        margin:0;
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer
      }
      #${APP.navButtonId} svg{
        width:22px;
        height:22px;
        display:block;
        fill:currentColor
      }
      #${APP.navButtonId}:active{
        transform:scale(.94)
      }
      #${APP.panelId}{
        position:fixed;inset:0;z-index:2147483646;background:#11151b;
        color:#eef2f6;font-family:Arial,sans-serif;display:none;overflow:auto;
      }
      #${APP.panelId}.open{display:block}
      .ri-head{position:sticky;top:0;z-index:3;background:#171d25;border-bottom:1px solid #303846;padding:10px 12px}
      .ri-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .ri-title h2{margin:0;font-size:18px}
      .ri-close{background:#2d3540;color:#fff;border:0;border-radius:8px;padding:8px 11px}
      .ri-tabs{display:flex;gap:6px;overflow-x:auto;padding:8px 0 0}
      .ri-tab{white-space:nowrap;background:#232b35;color:#cfd7e1;border:1px solid #36404d;border-radius:18px;padding:7px 11px;font-size:12px}
      .ri-tab.active{background:#e9eef5;color:#111;border-color:#e9eef5}
      .ri-body{padding:12px;max-width:760px;margin:0 auto 90px}
      .ri-card{background:#1a2029;border:1px solid #303845;border-radius:12px;padding:12px;margin:0 0 10px}
      .ri-card h3{margin:0 0 10px;font-size:15px}
      .ri-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .ri-stat{background:#222a35;border-radius:9px;padding:10px}
      .ri-stat b{display:block;font-size:18px;margin-top:3px}
      .ri-btn{border:0;border-radius:9px;padding:10px 12px;background:#dce5ef;color:#111;font-weight:700;margin:3px 3px 3px 0}
      .ri-btn.secondary{background:#2a3441;color:#eef2f6;border:1px solid #3c4857}
      .ri-btn.danger{background:#7b2b2b;color:#fff}
      .ri-input,.ri-select{width:100%;box-sizing:border-box;background:#10151c;color:#fff;border:1px solid #3b4654;border-radius:8px;padding:9px;margin:3px 0 8px}
      .ri-textarea{width:100%;min-height:180px;box-sizing:border-box;background:#10151c;color:#fff;border:1px solid #3b4654;border-radius:8px;padding:10px;margin:3px 0 8px;font-family:Arial,sans-serif;line-height:1.35;resize:vertical}
      .ri-label{font-size:11px;color:#aeb8c5;display:block;margin-top:7px}
      .ri-table{width:100%;border-collapse:collapse;font-size:12px}
      .ri-table th,.ri-table td{padding:7px 5px;border-bottom:1px solid #313946;text-align:left}
      .ri-table th{color:#aeb8c5;font-weight:700}
      .ri-top8{font-weight:700}
      .ri-bubble{color:#ffd27a}
      .ri-good{color:#8ee59a}.ri-warn{color:#ffd27a}.ri-muted{color:#96a1ae}
      .ri-pre{white-space:pre-wrap;background:#0e1319;border:1px solid #303844;border-radius:9px;padding:10px;font-size:12px;line-height:1.4}
      .ri-row{display:flex;gap:8px;align-items:center}
      .ri-row>*{flex:1}
      .ri-small{font-size:11px;color:#9eabb9}
      .ri-progress{width:100%;height:9px;background:#0e1319;border:1px solid #303844;border-radius:999px;overflow:hidden;margin-top:8px}
      .ri-progress>span{display:block;height:100%;background:#dce5ef;width:0}
      .ri-race-list{display:grid;gap:9px}
      .ri-race-card{background:#151b23;border:1px solid #303845;border-radius:10px;padding:10px}
      .ri-race-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .ri-race-title{font-weight:700;line-height:1.2}
      .ri-race-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
      .ri-pill{display:inline-block;border:1px solid #3d4855;border-radius:999px;padding:3px 7px;font-size:10px;color:#cdd6e0;background:#222a35}
      .ri-pill.good{border-color:#42634a}
      .ri-pill.warn{border-color:#766331}
      .ri-pill.bad{border-color:#693a3a}
      .ri-race-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
      .ri-race-actions .ri-btn{flex:1;min-width:78px;margin:0}
      .ri-countdown{font-size:26px;font-weight:800;line-height:1.1;margin:6px 0}
      .ri-next-meta{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
      .ri-health{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .ri-health-status{font-size:18px;font-weight:800}
      .ri-health-list{margin:8px 0 0;padding-left:18px;color:#cfd7e1;font-size:12px;line-height:1.45}
      .ri-health-good{color:#8ee59a}
      .ri-health-warn{color:#ffd27a}
      .ri-health-bad{color:#ff9a9a}
      @media(max-width:420px){.ri-grid{grid-template-columns:1fr 1fr}.ri-body{padding:9px}.ri-card{padding:10px}}
    `;
    document.head.appendChild(style);
  }

  function carIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18.92 6.01A2 2 0 0 0 17.03 4.7H6.97a2 2 0 0 0-1.89 1.31L3.5 10.5A2.5 2.5 0 0 0 2 12.79V17a1 1 0 0 0 1 1h1v1.25a.75.75 0 0 0 .75.75h1.5a.75.75 0 0 0 .75-.75V18h10v1.25a.75.75 0 0 0 .75.75h1.5a.75.75 0 0 0 .75-.75V18h1a1 1 0 0 0 1-1v-4.21a2.5 2.5 0 0 0-1.5-2.29l-1.58-4.49ZM6.97 6.7h10.06l1.18 3.35H5.79L6.97 6.7ZM6.25 15.5A1.25 1.25 0 1 1 6.25 13a1.25 1.25 0 0 1 0 2.5Zm11.5 0A1.25 1.25 0 1 1 17.75 13a1.25 1.25 0 0 1 0 2.5Z"/>
      </svg>
    `;
  }

  function toggleRaceIQPanel() {
    const panel = document.getElementById(APP.panelId);
    if (!panel) return;

    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);

    if (opening) render();
  }

  function ensureNavLauncher() {
    if (document.getElementById(APP.navWrapperId)) return true;

    // Proven Torn mobile header anchor used by RestockIQ:
    // insert directly before the global-search <li>.
    const searchWrapper = document.querySelector('li.find-wrapper');
    if (!searchWrapper?.parentNode) return false;

    const wrapper = document.createElement('li');
    wrapper.id = APP.navWrapperId;

    const button = document.createElement('button');
    button.id = APP.navButtonId;
    button.type = 'button';
    button.setAttribute('aria-label', 'Open RaceIQ');
    button.setAttribute('title', 'RaceIQ');
    button.innerHTML = carIconSvg();
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleRaceIQPanel();
    });

    wrapper.appendChild(button);
    searchWrapper.parentNode.insertBefore(wrapper, searchWrapper);
    return true;
  }

  function createUI() {
    injectStyle();

    if (!document.getElementById(APP.panelId)) {
      const panel = document.createElement('div');
      panel.id = APP.panelId;
      document.body.appendChild(panel);
    }
    ensureNavLauncher();
    render();
  }

  function navHtml() {
    const tabs = [
      ['home','Home'],['race','Race'],['standings','Standings'],
      ['prizes','Prizes'],['champ','Championship'],['share','Share'],['settings','Settings']
    ];
    return tabs.map(([id,label]) =>
      `<button class="ri-tab ${currentTab===id?'active':''}" data-tab="${id}">${label}</button>`
    ).join('');
  }

  function shell(content) {
    return `
      <div class="ri-head">
        <div class="ri-title"><h2>RaceIQ <span class="ri-small">v${APP.version}</span></h2><button class="ri-close" data-action="close">✕</button></div>
        <div class="ri-tabs">${navHtml()}</div>
      </div>
      <div class="ri-body">${content}</div>`;
  }

  function homeView() {
    const p = phase();
    const qDone = state.qualifying.filter(r => displayStatus(r.status)==='Completed').length;
    const cDone = state.championship.races.filter(r => displayStatus(r.status)==='Completed').length;
    const standings = aggregateQualifying();
    const week = currentQualifyingWeek();
    const race = state.qualifying[week-1];
    const progress = qualifyingProgress();
    const pct = Math.round((progress.synced / state.season.qualifyingWeeks) * 100);
    const countdown = countdownText(race);
    const health = systemHealthSummary();
    const healthClass = health.status === 'GOOD'
      ? 'ri-health-good'
      : health.status === 'ATTENTION'
        ? 'ri-health-warn'
        : 'ri-health-bad';

    const healthItems = [...health.issues, ...health.warnings].slice(0,4);

    return `
      <div class="ri-card">
        <h3>${esc(APP.factionName)} — ${esc(state.season.name)}</h3>
        <div class="ri-grid">
          <div class="ri-stat">Phase<b>${esc(p)}</b></div>
          <div class="ri-stat">Qualifying<b>${qDone}/8</b></div>
          <div class="ri-stat">Championship<b>${cDone}/4</b></div>
          <div class="ri-stat">Tracked Racers<b>${standings.length}</b></div>
        </div>
      </div>

      <div class="ri-card">
        <div class="ri-health">
          <div>
            <h3 style="margin-bottom:3px">System Health</h3>
            <div class="ri-small">Local checks run whenever this screen opens</div>
          </div>
          <div class="ri-health-status ${healthClass}">${health.status}</div>
        </div>

        ${healthItems.length ? `
          <ul class="ri-health-list">
            ${healthItems.map(item => `<li>${esc(item)}</li>`).join('')}
          </ul>
        ` : `
          <div class="ri-small" style="margin-top:8px">No local data problems detected.</div>
        `}

        <div class="ri-next-meta">
          <span class="ri-pill">API check: ${esc(health.apiAgeText)}</span>
          <span class="ri-pill">Faction sync: ${esc(health.factionAgeText)}</span>
          <span class="ri-pill">Manual backup: ${esc(health.backupAgeText)}</span>
        </div>

        <button class="ri-btn secondary" data-action="diagnostics">Run Full Diagnostics</button>
      </div>

      <div class="ri-card">
        <h3>Season Progress</h3>
        <div class="ri-small">${progress.synced}/8 qualifying races loaded • ${progress.linked}/8 linked</div>
        <div class="ri-progress"><span style="width:${pct}%"></span></div>
      </div>

      <div class="ri-card">
        <h3>Next Race — Week ${week}</h3>
        <div class="ri-race-title">${esc(race?.name || `AS Week ${week} ${state.season.name}`)}</div>
        <div class="ri-countdown">${esc(countdown)}</div>

        <div class="ri-next-meta">
          <span class="ri-pill">${race?.date ? esc(race.date) : 'Date TBD'}</span>
          <span class="ri-pill">${esc(race?.time || '2200')} TCT</span>
          <span class="ri-pill">${esc(race?.track || 'Track TBD')}</span>
          <span class="ri-pill">${esc(race?.laps || 60)} laps</span>
          <span class="ri-pill">Class ${esc(race?.raceClass || 'E')}</span>
          <span class="ri-pill">${state.season.noUpgrades ? 'No Upgrades' : 'Upgrades Allowed'}</span>
        </div>

        <div class="ri-race-actions">
          <button class="ri-btn" data-action="edit-current-race">Set Up Week ${week}</button>
          <button class="ri-btn secondary" data-action="announcement-current">Copy Announcement</button>
          <button class="ri-btn secondary" data-action="announcement-short">Copy Reminder</button>
        </div>
      </div>

      <div class="ri-card">
        <h3>Quick Operations</h3>
        <button class="ri-btn" data-action="sync-current">Sync Current Race</button>
        <button class="ri-btn secondary" data-action="link-current">Find / Link Race</button>
        <button class="ri-btn secondary" data-action="copy-top8">Copy Top 8</button>
      </div>`;
  }

  function raceView() {
    const cards = state.qualifying.map(r => {
      const load = raceLoadStatus(r);
      const loadClass = load === 'SYNCED' ? 'good' : load === 'LINKED' ? 'warn' : 'bad';
      return `
        <div class="ri-race-card">
          <div class="ri-race-card-head">
            <div>
              <div class="ri-race-title">Week ${r.week} — ${esc(r.name)}</div>
              <div class="ri-small">${r.date ? esc(r.date) : 'Date not set'}${r.time ? ` • ${esc(r.time)} TCT` : ''}</div>
            </div>
            <span class="ri-pill ${loadClass}">${load}</span>
          </div>
          <div class="ri-race-meta">
            <span class="ri-pill">${esc(displayStatus(r.status || 'Planned'))}</span>
            <span class="ri-pill">${(r.results || []).length} results</span>
            ${r.raceId ? `<span class="ri-pill">ID ${esc(r.raceId)}</span>` : ''}
          </div>
          <div class="ri-race-actions">
            <button class="ri-btn" data-action="sync-race" data-week="${r.week}">Sync</button>
            <button class="ri-btn secondary" data-action="find-race" data-week="${r.week}">Find</button>
            <button class="ri-btn secondary" data-action="edit-race" data-week="${r.week}">Edit</button>
            <button class="ri-btn secondary" data-action="announce-race" data-week="${r.week}">Message</button>
          </div>
        </div>`;
    }).join('');

    const progress = qualifyingProgress();

    return `
      <div class="ri-card">
        <h3>Qualifying Races</h3>
        <div class="ri-small">${progress.synced}/8 synced • ${progress.linked}/8 linked. Use Find for older races; if a date is known, RaceIQ searches around the scheduled TCT time.</div>
      </div>
      <div class="ri-race-list">${cards}</div>
      <div class="ri-card">
        <button class="ri-btn secondary" data-action="sync-all">Sync All Linked Races</button>
      </div>`;
  }

  function standingsView() {
    const standings = aggregateQualifying();
    const rows = standings.map(r => `
      <tr class="${r.rank<=8?'ri-top8':r.rank<=12?'ri-bubble':''}">
        <td>${r.rank}</td><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.starts}</td><td>${r.wins}</td><td>${r.podiums}</td>
      </tr>`).join('');

    const eighth = standings[7], ninth = standings[8];
    const gap = eighth && ninth ? eighth.total - ninth.total : null;

    return `
      <div class="ri-card">
        <h3>Qualifying Standings</h3>
        ${eighth ? `<div class="ri-small">Cut line: #8 ${esc(eighth.name)} ${eighth.total} pts${ninth ? ` • #9 ${esc(ninth.name)} ${ninth.total} pts • Gap ${gap}`:''}</div><br>`:''}
        <table class="ri-table"><thead><tr><th>#</th><th>Racer</th><th>Pts</th><th>Starts</th><th>Wins</th><th>Pod.</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No synced results yet.</td></tr>'}</tbody></table>
      </div>
      <div class="ri-card">
        <button class="ri-btn" data-action="copy-top8">Copy Top 8</button>
        <button class="ri-btn secondary" data-action="copy-full">Copy Full Standings</button>
      </div>`;
  }

  function prizesView() {
    const defaultWeek = latestSyncedQualifyingWeek();
    const defaultEligible = eligibleForWeeklyDraw(defaultWeek);
    const defaultPrize = state.prizes.inventory[0] || {name:'',stock:0,qtyPerWinner:1,reserve:0};
    const available = Math.max(0, Number(defaultPrize.stock || 0) - Number(defaultPrize.reserve || 0));
    const needed = Number(state.settings.defaultWinners || 5) * Number(defaultPrize.qtyPerWinner || 1);
    const priorDraws = drawHistoryForWeek(defaultWeek);

    const inv = state.prizes.inventory.map((p,i) => {
      const usable = Math.max(0, Number(p.stock || 0) - Number(p.reserve || 0));
      return `
        <div class="ri-race-card">
          <div class="ri-race-card-head">
            <div>
              <div class="ri-race-title">${esc(p.name)}</div>
              <div class="ri-small">${usable} available above reserve</div>
            </div>
            <span class="ri-pill">${p.stock} stock</span>
          </div>
          <div class="ri-race-meta">
            <span class="ri-pill">${p.qtyPerWinner} / winner</span>
            <span class="ri-pill">${p.reserve} reserve</span>
          </div>
          <div class="ri-race-actions">
            <button class="ri-btn secondary" data-action="edit-prize" data-index="${i}">Edit Prize</button>
          </div>
        </div>
      `;
    }).join('');

    const hist = state.prizes.history.slice(-12).reverse().map(h => `
      <tr>
        <td>W${h.week}</td>
        <td>${esc(h.racer)}</td>
        <td>${h.qty}x ${esc(h.prize)}</td>
      </tr>
    `).join('');

    const recentDraws = groupedPrizeDraws().map(draw => {
      const winnerNames = draw.winners.map(w => esc(w.racer)).join(', ');
      const totalQty = draw.winners.reduce((sum,w) => sum + Number(w.qty || 0), 0);
      return `
        <div class="ri-race-card">
          <div class="ri-race-card-head">
            <div>
              <div class="ri-race-title">Week ${draw.week} — ${esc(draw.prize)}</div>
              <div class="ri-small">${draw.winners.length} winner(s) • ${totalQty}x total</div>
            </div>
            <span class="ri-pill">${draw.timestamp ? new Date(draw.timestamp).toLocaleString() : 'Saved draw'}</span>
          </div>
          <div class="ri-small" style="margin-top:8px">${winnerNames}</div>
          ${draw.restorable ? `
            <div class="ri-race-actions">
              <button class="ri-btn danger" data-action="undo-prize-draw" data-draw-id="${esc(draw.id)}">Undo Draw</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="ri-card">
        <h3>Weekly Prize Draw</h3>
        <div class="ri-grid">
          <div class="ri-stat">Eligible<b id="ri-eligible-count">${defaultEligible.length}</b></div>
          <div class="ri-stat">Prior Winners<b id="ri-prior-count">${priorDraws.length}</b></div>
          <div class="ri-stat">Available<b id="ri-available-count">${available}</b></div>
          <div class="ri-stat">Needed<b id="ri-needed-count">${needed}</b></div>
        </div>

        <label class="ri-label">Week</label>
        <select class="ri-select" id="ri-draw-week">
          ${state.qualifying.map(r=>`<option value="${r.week}" ${r.week===defaultWeek?'selected':''}>Week ${r.week} — ${(r.results||[]).length} racers</option>`).join('')}
        </select>

        <label class="ri-label">Prize</label>
        <select class="ri-select" id="ri-draw-prize">
          ${state.prizes.inventory.map((p,i)=>`<option value="${esc(p.name)}" ${i===0?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select>

        <label class="ri-label">Number of winners</label>
        <input class="ri-input" id="ri-draw-count" type="number" min="1" value="${state.settings.defaultWinners}">

        <div class="ri-small" id="ri-draw-summary">
          Equal chance for every eligible racer who finished Week ${defaultWeek}. Winners are unique within this draw.
        </div><br>

        <button class="ri-btn" data-action="preview-prize-pool">View Eligible Racers</button>
        <button class="ri-btn" data-action="draw-prize">Run Random Draw</button>
      </div>

      <div class="ri-card">
        <h3>Prize Inventory</h3>
        <div class="ri-race-list">${inv || '<div class="ri-small">No prizes configured.</div>'}</div><br>
        <button class="ri-btn secondary" data-action="add-prize">Add Prize</button>
      </div>

      <div class="ri-card">
        <h3>Recent Draws</h3>
        <div class="ri-small">Undo restores the deducted prize stock and removes only that draw from RaceIQ history.</div><br>
        <div class="ri-race-list">
          ${recentDraws || '<div class="ri-small">No prize draws yet.</div>'}
        </div>
        <br>
        <button class="ri-btn secondary" data-action="copy-prize-winners">Copy Winners</button>
      </div>
    `;
  }

  function champView() {
    const qs = aggregateQualifying();
    const cs = aggregateChampionship();
    const completed = state.qualifying.filter(r => displayStatus(r.status) === 'Completed').length;
    const remaining = Math.max(0, state.season.qualifyingWeeks - completed);
    const ready = completed >= state.season.qualifyingWeeks && qs.length >= 8;

    const projected = qs.slice(0,8);
    const eighth = qs[7];
    const ninth = qs[8];
    const gap = eighth && ninth ? Math.max(0, eighth.total - ninth.total) : null;

    const projectedCards = projected.map(r => `
      <div class="ri-race-card">
        <div class="ri-race-card-head">
          <div>
            <div class="ri-race-title">#${r.rank} ${esc(r.name)}</div>
            <div class="ri-small">${r.starts} starts • ${r.wins} win(s) • ${r.podiums} podium(s)</div>
          </div>
          <span class="ri-pill good">${r.total} pts</span>
        </div>
      </div>
    `).join('');

    const finalists = state.championship.finalists.map(f => `
      <div class="ri-race-card">
        <div class="ri-race-card-head">
          <div>
            <div class="ri-race-title">Seed #${f.qualifyingSeed} — ${esc(f.name)}</div>
            <div class="ri-small">Qualified with ${f.qualifyingPoints} pts</div>
          </div>
          <span class="ri-pill good">LOCKED</span>
        </div>
      </div>
    `).join('');

    const standings = cs.map(r => `
      <tr>
        <td>${r.rank}</td>
        <td>${esc(r.name)}</td>
        <td>${r.points}</td>
        <td>${r.wins}</td>
        <td>${r.podiums}</td>
      </tr>
    `).join('');

    return `
      <div class="ri-card">
        <h3>Championship Readiness</h3>

        <div class="ri-grid">
          <div class="ri-stat">Qualifying<b>${completed}/8</b></div>
          <div class="ri-stat">Remaining<b>${remaining}</b></div>
          <div class="ri-stat">Projected Top 8<b>${projected.length}/8</b></div>
          <div class="ri-stat">Status<b>${state.championship.started ? 'LOCKED' : ready ? 'READY' : 'NOT READY'}</b></div>
        </div>

        <br>
        <div class="ri-small">
          ${state.championship.started
            ? 'Championship finalists are locked. Championship points are separate from qualifying points.'
            : ready
              ? 'All qualifying races are complete. Review the projected Top 8 before locking the Championship field.'
              : `Championship cannot be locked yet. ${remaining} qualifying race${remaining===1?'':'s'} remain.`}
        </div>

        ${!state.championship.started && ready ? `
          <br>
          <button class="ri-btn" data-action="start-champ">Lock Top 8 & Start Championship</button>
        ` : ''}
      </div>

      ${!state.championship.started ? `
        <div class="ri-card">
          <h3>Projected Championship Field</h3>
          ${eighth ? `
            <div class="ri-small">
              Current cutoff: #8 ${esc(eighth.name)} — ${eighth.total} pts
              ${ninth ? ` • #9 ${esc(ninth.name)} — ${ninth.total} pts • Gap ${gap}` : ''}
            </div><br>
          ` : '<div class="ri-small">Not enough ranked racers yet to calculate the Championship cutoff.</div><br>'}

          <div class="ri-race-list">
            ${projectedCards || '<div class="ri-small">No projected finalists yet.</div>'}
          </div>

          <br>
          <button class="ri-btn secondary" data-action="copy-projected-top8">Copy Projected Top 8</button>
        </div>
      ` : `
        <div class="ri-card">
          <h3>Locked Finalists</h3>
          <div class="ri-race-list">${finalists}</div>
        </div>
      `}

      ${state.championship.started ? `
        <div class="ri-card">
          <h3>Championship Standings</h3>
          <div class="ri-small">Championship points reset to 0 when the field is locked.</div><br>
          <table class="ri-table">
            <thead><tr><th>#</th><th>Racer</th><th>Pts</th><th>Wins</th><th>Pod.</th></tr></thead>
            <tbody>${standings || '<tr><td colspan="5">No Championship results yet.</td></tr>'}</tbody>
          </table>
        </div>

        <div class="ri-card">
          <button class="ri-btn" data-action="sync-champ">Sync Current Championship Race</button>
        </div>
      ` : ''}
    `;
  }

  function shareView() {
    const nextWeek = currentQualifyingWeek();
    const latestWeek = latestSyncedQualifyingWeek();
    const standings = aggregateQualifying();
    const eighth = standings[7];
    const ninth = standings[8];
    const gap = eighth && ninth ? Math.max(0, eighth.total - ninth.total) : null;

    return `
      <div class="ri-card">
        <h3>Standings Share</h3>
        <div class="ri-small">
          ${eighth ? `Current cutoff: #8 ${esc(eighth.name)} ${eighth.total} pts${ninth ? ` • #9 ${esc(ninth.name)} ${ninth.total} pts • Gap ${gap}` : ''}` : 'Standings are still building.'}
        </div><br>

        <div class="ri-race-actions">
          <button class="ri-btn" data-action="copy-top8">Copy Top 8</button>
          <button class="ri-btn secondary" data-action="copy-bubble">Bubble Watch</button>
          <button class="ri-btn secondary" data-action="copy-full">Full Standings</button>
        </div>
      </div>

      <div class="ri-card">
        <h3>Completed Race Posts</h3>
        <label class="ri-label">Week</label>
        <select class="ri-select" id="ri-share-results-week">
          ${state.qualifying.map(r=>`<option value="${r.week}" ${r.week===latestWeek?'selected':''}>Week ${r.week} — ${(r.results||[]).length ? (r.results||[]).length + ' results' : 'not synced'}</option>`).join('')}
        </select>

        <div class="ri-race-actions">
          <button class="ri-btn" data-action="copy-selected-results">Full Results</button>
          <button class="ri-btn secondary" data-action="copy-selected-results-post">Results Post</button>
          <button class="ri-btn secondary" data-action="copy-prize-winners">Latest Prize Winners</button>
        </div>
      </div>

      <div class="ri-card">
        <h3>Next Race Messages — Week ${nextWeek}</h3>
        <div class="ri-small">
          Uses the Week ${nextWeek} race setup. Fields that are not configured yet will appear as TBD.
        </div><br>
        <div class="ri-race-actions">
          <button class="ri-btn" data-action="announcement-current">Full Announcement</button>
          <button class="ri-btn secondary" data-action="announcement-short">Short Reminder</button>
        </div>
      </div>
    `;
  }

  function settingsView() {
    const summary = backupSummary(state);
    const lastBackup = state.meta?.lastManualBackup
      ? new Date(state.meta.lastManualBackup).toLocaleString()
      : 'No manual backup recorded yet';

    return `
      <div class="ri-card">
        <h3>Season Settings</h3>

        <label class="ri-label">Season name</label>
        <input class="ri-input" id="ri-season-name" value="${esc(state.season.name)}">

        <label class="ri-label">Default weekly winners</label>
        <input class="ri-input" id="ri-default-winners" type="number" min="1" value="${state.settings.defaultWinners}">

        <label class="ri-label">
          <input id="ri-faction-only" type="checkbox" ${state.settings.factionOnly?'checked':''}>
          Faction members only
        </label>

        <label class="ri-label">
          <input id="ri-finished-only" type="checkbox" ${state.settings.finishedOnly?'checked':''}>
          Finished racers only
        </label><br>

        <button class="ri-btn" data-action="save-settings">Save Settings</button>
      </div>

      <div class="ri-card">
        <h3>Message Templates</h3>
        <div class="ri-small">
          These templates stay editable. RaceIQ replaces placeholders with the live race setup when you copy a message.
        </div><br>

        <label class="ri-label">Full race announcement</label>
        <textarea class="ri-textarea" id="ri-announcement-template">${esc(state.settings.announcementTemplate)}</textarea>

        <label class="ri-label">Short reminder</label>
        <textarea class="ri-textarea" id="ri-reminder-template">${esc(state.settings.reminderTemplate)}</textarea>

        <div class="ri-small">
          Available placeholders: {week}, {qualifyingWeeks}, {race}, {date}, {time}, {track}, {laps}, {class},
          {upgrades}, {upgradesShort}, {password}, {winnerCount}, {prizeQty}, {prizeName}, {cutoffLine}, {bubbleLine}
        </div><br>

        <button class="ri-btn" data-action="save-message-templates">Save Message Templates</button>
        <button class="ri-btn secondary" data-action="reset-message-templates">Restore Default Templates</button>
      </div>

      <div class="ri-card">
        <h3>Backup & Recovery</h3>

        <div class="ri-grid">
          <div class="ri-stat">Races Loaded<b>${summary.qualifyingSynced}/8</b></div>
          <div class="ri-stat">Results Stored<b>${summary.qualifyingResults}</b></div>
          <div class="ri-stat">Prize Draws<b>${summary.prizeDraws}</b></div>
          <div class="ri-stat">Championship<b>${summary.championshipStarted ? 'STARTED' : 'NOT STARTED'}</b></div>
        </div>

        <br>
        <div class="ri-small">Last manual backup: ${esc(lastBackup)}</div><br>

        <button class="ri-btn" data-action="copy-backup">Copy Full Backup JSON</button>
        <button class="ri-btn secondary" data-action="import-backup">Import Backup JSON</button>
        <button class="ri-btn secondary" data-action="create-snapshot">Create Safety Snapshot</button>
        <button class="ri-btn secondary" data-action="view-snapshots">View / Restore Snapshots</button>
      </div>

      <div class="ri-card">
        <h3>System Safety</h3>
        <button class="ri-btn secondary" data-action="diagnostics">Run Diagnostics</button>
        <div class="ri-small">
          Reset is intentionally protected. It creates a snapshot first and requires a typed confirmation.
        </div><br>
        <button class="ri-btn danger" data-action="reset-season">Reset RaceIQ Data</button>
      </div>`;
  }

  function render() {
    const panel = document.getElementById(APP.panelId);
    if (!panel || !state) return;
    const views = {
      home:homeView, race:raceView, standings:standingsView,
      prizes:prizesView, champ:champView, share:shareView, settings:settingsView
    };
    panel.innerHTML = shell((views[currentTab] || homeView)());
    bindEvents();
  }

  function toast(msg) {
    let el = document.getElementById('raceiq-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'raceiq-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#eaf0f6;color:#111;padding:10px 14px;border-radius:8px;z-index:2147483647;font:13px Arial;box-shadow:0 3px 15px #0008';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2600);
  }

  async function runBusy(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.error('[RaceIQ]', e);
      alert(`RaceIQ\n\n${e.message || e}`);
    } finally {
      busy = false;
      render();
    }
  }

  async function editRace(week) {
    const r = state.qualifying[week-1];
    const name = prompt(`Week ${week} race name:`, r.name); if (name === null) return;
    const date = prompt(`Week ${week} date (example: 2026-09-20):`, r.date); if (date === null) return;
    const track = prompt(`Week ${week} track:`, r.track); if (track === null) return;
    const laps = prompt(`Week ${week} laps:`, r.laps); if (laps === null) return;
    const cls = prompt(`Week ${week} class:`, r.raceClass); if (cls === null) return;
    const pw = prompt(`Week ${week} password:`, r.password); if (pw === null) return;
    const id = prompt(`Week ${week} Race ID (blank = auto-find):`, r.raceId); if (id === null) return;

    r.name = name.trim();
    r.date = date.trim();
    r.track = track.trim();
    r.laps = Number(laps) || 60;
    r.raceClass = cls.trim() || 'E';
    r.password = pw.trim();
    r.raceId = id.trim();
    await saveState(false);
  }

  async function editPrize(index) {
    const p = state.prizes.inventory[index];
    const stock = prompt(`${p.name} stock:`, p.stock); if (stock === null) return;
    const qty = prompt(`${p.name} quantity per winner:`, p.qtyPerWinner); if (qty === null) return;
    const reserve = prompt(`${p.name} reserve:`, p.reserve); if (reserve === null) return;
    p.stock = Math.max(0, Number(stock) || 0);
    p.qtyPerWinner = Math.max(1, Number(qty) || 1);
    p.reserve = Math.max(0, Number(reserve) || 0);
    await saveState(false);
  }

  async function addPrize() {
    const name = prompt('Prize name:');
    if (!name) return;
    state.prizes.inventory.push({name:name.trim(),stock:0,qtyPerWinner:1,reserve:0});
    await saveState(false);
  }

  function previewAndCopy(text, title='Preview') {
    const ok = confirm(`${title}\n\n${text}\n\nCopy this text?`);
    if (ok) copyText(text);
  }

  function bindEvents() {
    document.querySelectorAll(`#${APP.panelId} [data-tab]`).forEach(btn => {
      btn.addEventListener('click', () => { currentTab = btn.dataset.tab; render(); });
    });

    const drawWeekEl = document.getElementById('ri-draw-week');
    const drawPrizeEl = document.getElementById('ri-draw-prize');
    const drawCountEl = document.getElementById('ri-draw-count');

    const refreshDrawSummary = () => {
      if (!drawWeekEl || !drawPrizeEl || !drawCountEl) return;

      const week = Number(drawWeekEl.value);
      const prize = getPrize(drawPrizeEl.value);
      const count = Math.max(1, Number(drawCountEl.value) || 1);
      const eligible = eligibleForWeeklyDraw(week);
      const usable = prize ? Math.max(0, Number(prize.stock || 0) - Number(prize.reserve || 0)) : 0;
      const needed = prize ? count * Number(prize.qtyPerWinner || 1) : 0;
      const prior = drawHistoryForWeek(week).length;

      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
      };

      setText('ri-eligible-count', eligible.length);
      setText('ri-prior-count', prior);
      setText('ri-available-count', usable);
      setText('ri-needed-count', needed);

      const summary = document.getElementById('ri-draw-summary');
      if (summary) {
        summary.textContent =
          `Equal chance for ${eligible.length} eligible Week ${week} racer(s). ` +
          `${count} unique winner(s), ${prize?.qtyPerWinner || 1}x ${prize?.name || 'prize'} each.`;
      }
    };

    [drawWeekEl, drawPrizeEl, drawCountEl].forEach(el => {
      if (el) {
        el.addEventListener('change', refreshDrawSummary);
        el.addEventListener('input', refreshDrawSummary);
      }
    });

    document.querySelectorAll(`#${APP.panelId} [data-action]`).forEach(btn => {
      btn.addEventListener('click', () => runBusy(async () => {
        const action = btn.dataset.action;

        if (action === 'close') {
          document.getElementById(APP.panelId)?.classList.remove('open');
          return;
        }
        if (action === 'link-current') {
          const week = currentQualifyingWeek();
          const r = await linkRace('qualifying', week);
          toast(`Linked Week ${week}: Race ${r.id}`); return;
        }
        if (action === 'edit-current-race') {
          await editRace(currentQualifyingWeek()); return;
        }
        if (action === 'sync-current') {
          const week = currentQualifyingWeek();
          const result = await syncRace('qualifying', week);
          toast(`Week ${week}: ${result.imported} racers synced`); return;
        }
        if (action === 'sync-race') {
          const week = Number(btn.dataset.week);
          const result = await syncRace('qualifying', week);
          const suffix = result.unresolved ? ` • ${result.unresolved} name(s) unresolved` : '';
          toast(`Week ${week}: ${result.imported} racers synced${suffix}`); return;
        }
        if (action === 'find-race') {
          const week = Number(btn.dataset.week);
          const target = state.qualifying[week - 1];

          if (!target.date) {
            const knownDates = {
              1: '2026-08-16',
              2: '2026-08-23',
              3: '2026-08-30',
              5: '2026-09-20'
            };

            const suggested = knownDates[week] || '';
            const date = prompt(
              `Week ${week} race date (YYYY-MM-DD). RaceIQ uses this to search historical races:`,
              suggested
            );
            if (date === null) return;
            target.date = date.trim();
            await saveState(false);
          }

          const found = await linkRace('qualifying', week);
          toast(`Week ${week}: linked Race ID ${found.id}`); return;
        }
        if (action === 'sync-all') {
          for (let w=1; w<=8; w++) {
            const r = state.qualifying[w-1];
            if (!r.raceId) continue;
            try { await syncRace('qualifying', w); } catch (e) { console.warn(`Week ${w}`, e); }
          }
          toast('Available races synced.'); return;
        }
        if (action === 'edit-race') { await editRace(Number(btn.dataset.week)); return; }
        if (action === 'announce-race') {
          const week = Number(btn.dataset.week);
          previewAndCopy(raceAnnouncement(week, false), `Week ${week} Race Announcement`); return;
        }
        if (action === 'copy-top8') { await copyText(shareTop8()); return; }
        if (action === 'copy-full') { await copyText(shareFullStandings()); return; }
        if (action === 'copy-bubble') { await copyText(shareBubbleWatch()); return; }
        if (action === 'copy-selected-results') {
          const week = Number(document.getElementById('ri-share-results-week')?.value || latestSyncedQualifyingWeek());
          await copyText(shareWeekResults(week)); return;
        }
        if (action === 'copy-selected-results-post') {
          const week = Number(document.getElementById('ri-share-results-week')?.value || latestSyncedQualifyingWeek());
          await copyText(resultsAnnouncement(week)); return;
        }
        if (action === 'copy-results') { await copyText(shareWeekResults(Number(btn.dataset.week))); return; }
        if (action === 'copy-prize-winners') { await copyText(sharePrizeWinners()); return; }
        if (action === 'announcement-current') {
          previewAndCopy(raceAnnouncement(currentQualifyingWeek(), false), 'Race Announcement'); return;
        }
        if (action === 'announcement-short') {
          previewAndCopy(raceAnnouncement(currentQualifyingWeek(), true), 'Short Reminder'); return;
        }
        if (action === 'results-message') {
          previewAndCopy(resultsAnnouncement(currentQualifyingWeek()), 'Results Post'); return;
        }
        if (action === 'edit-prize') { await editPrize(Number(btn.dataset.index)); return; }
        if (action === 'add-prize') { await addPrize(); return; }
        if (action === 'preview-prize-pool') {
          const week = Number(document.getElementById('ri-draw-week').value);
          const eligible = eligibleForWeeklyDraw(week);
          if (!eligible.length) throw new Error(`Week ${week} has no eligible finished racers.`);

          const names = eligible
            .slice()
            .sort((a,b) => a.name.localeCompare(b.name))
            .map((r,i) => `${i+1}. ${r.name}`)
            .join('\n');

          alert(`Week ${week} Eligible Prize Pool — ${eligible.length} racers\n\n${names}`);
          return;
        }

        if (action === 'undo-prize-draw') {
          const drawId = btn.dataset.drawId;
          const undone = await undoPrizeDraw(drawId);
          if (undone) toast('Prize draw undone and stock restored.');
          return;
        }

        if (action === 'draw-prize') {
          const week = Number(document.getElementById('ri-draw-week').value);
          const prize = document.getElementById('ri-draw-prize').value;
          const count = Number(document.getElementById('ri-draw-count').value);
          const draw = await drawWeeklyPrize(week, prize, count);
          if (draw) {
            const names = draw.selected.map((x,i)=>`${i+1}. ${x.name}`).join('\n');
            previewAndCopy(`AURORA SURREALIS — WEEK ${week} PRIZE WINNERS\n\n${names}\n\nEach winner receives ${draw.prize.qtyPerWinner}x ${draw.prize.name}.`, 'Prize Draw Complete');
          }
          return;
        }
        if (action === 'copy-projected-top8') {
          const s = aggregateQualifying().slice(0,8);
          let out = `AURORA SURREALIS — PROJECTED CHAMPIONSHIP TOP 8\n\n`;
          s.forEach(r => out += `#${r.rank} ${r.name} — ${r.total} pts\n`);
          out += `\nProjection only. Finalists lock after Week 8 qualifying is complete.`;
          await copyText(out); return;
        }
        if (action === 'start-champ') { await startChampionship(); return; }
        if (action === 'sync-champ') {
          const week = currentChampionshipWeek();
          const result = await syncRace('championship', week);
          toast(`Championship W${week}: ${result.imported} racers synced`); return;
        }
        if (action === 'create-snapshot') {
          const snap = await createSnapshot('manual');
          toast(snap ? 'Safety snapshot created.' : 'Snapshots unavailable outside TornPDA.');
          return;
        }

        if (action === 'view-snapshots') {
          const snaps = await listSnapshots();
          if (!snaps.length) {
            alert('RaceIQ Snapshots\n\nNo snapshots are currently stored.');
            return;
          }

          const list = snaps.map((s,i) =>
            `${i+1}. ${new Date(s.createdAt).toLocaleString()} — ${s.label || 'snapshot'}`
          ).join('\n');

          const choice = prompt(
            `RaceIQ Snapshots\n\n${list}\n\nEnter a snapshot number to restore, or Cancel to leave unchanged:`
          );

          if (choice === null || String(choice).trim() === '') return;

          const index = Number(choice) - 1;
          if (!Number.isInteger(index) || index < 0 || index >= snaps.length) {
            throw new Error('That snapshot number is not valid.');
          }

          const restored = await restoreSnapshot(snaps[index].key);
          if (restored) toast('Snapshot restored.');
          return;
        }

        if (action === 'save-message-templates') {
          const full = document.getElementById('ri-announcement-template')?.value ?? '';
          const short = document.getElementById('ri-reminder-template')?.value ?? '';

          if (!full.trim() || !short.trim()) {
            throw new Error('Both message templates must contain text.');
          }

          state.settings.announcementTemplate = full;
          state.settings.reminderTemplate = short;
          await saveState(false);
          toast('Message templates saved.');
          return;
        }

        if (action === 'reset-message-templates') {
          if (!confirm('Restore the default RaceIQ announcement and reminder templates?')) return;
          state.settings.announcementTemplate = DEFAULT_STATE.settings.announcementTemplate;
          state.settings.reminderTemplate = DEFAULT_STATE.settings.reminderTemplate;
          await saveState(false);
          toast('Default message templates restored.');
          return;
        }

        if (action === 'save-settings') {
          const oldName = state.season.name;
          state.season.name = document.getElementById('ri-season-name').value.trim() || oldName;
          state.settings.defaultWinners = Math.max(1, Number(document.getElementById('ri-default-winners').value) || 5);
          state.settings.factionOnly = document.getElementById('ri-faction-only').checked;
          state.settings.finishedOnly = document.getElementById('ri-finished-only').checked;
          await saveState(false); toast('Settings saved.'); return;
        }
        if (action === 'copy-backup') { await copyBackup(); return; }
        if (action === 'import-backup') { await importBackup(); return; }
        if (action === 'diagnostics') { await runDiagnostics(); return; }
        if (action === 'reset-season') {
          const typed = prompt(
            'DANGER: This resets all RaceIQ season data on this device.\n\nType RESET RACEIQ exactly to continue:'
          );

          if (typed !== 'RESET RACEIQ') {
            if (typed !== null) toast('Reset cancelled.');
            return;
          }

          if (!confirm(
            'Final confirmation: create a recovery snapshot and reset RaceIQ to a blank Season 1 state?'
          )) return;

          await createSnapshot('before_reset');
          state = clone(DEFAULT_STATE);
          await saveState(false);
          toast('RaceIQ reset. Recovery snapshot preserved.');
          return;
        }
      }));
    });
  }

  // ---------- boot ----------
  try {
    await loadState();

    // Repair names from existing synced races on every upgrade/startup.
    // Faction members are authoritative for faction-only RaceIQ results.
    try {
      await fetchFactionMembers(true);
      const repaired = await repairStoredRacerNames(true);
      if (repaired.changed || repaired.unresolved) {
        console.log('[RaceIQ] name repair', repaired);
      }
    } catch (e) {
      console.warn('[RaceIQ] startup name repair skipped', e);
    }

    createUI();

    // Re-inject after Torn SPA navigation if needed.
    const observer = new MutationObserver(() => {
      if (!document.getElementById(APP.panelId)) {
        createUI();
        return;
      }

      // Torn replaces parts of its header during SPA navigation.
      // Re-add only the RaceIQ launcher when that happens.
      if (!document.getElementById(APP.navWrapperId)) {
        ensureNavLauncher();
      }
    });
    observer.observe(document.documentElement, {childList:true,subtree:true});

    console.log(`[RaceIQ] v${APP.version} loaded`);
  } catch (e) {
    console.error('[RaceIQ] startup error', e);
  }

})();