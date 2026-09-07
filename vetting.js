/* global AssignmentsEngine, VetEngine */
'use strict';
const V = VetEngine;
const STORAGE_KEY = 'raidVettingState';
const ASSIGN_KEY = 'raidAssignmentsState';
const ASSIGN_LINK_KEY = 'raidAssignmentsLinkMap';
const ZONE = 1060;
const CONCURRENCY = 3;
const RATE_LIMIT_PAUSE_MS = 60 * 1000;

const state = { players: [], thresholds: Object.assign({}, V.DEFAULT_THRESHOLDS), profiles: {}, errors: {} };
const wcl = { server: '', region: 'eu', guild: '' };
let queue = [];
let inFlight = 0;
const inFlightKeys = new Set();
let pausedUntil = 0;
let expanded = null; // name (lower) whose detail row is open
// Set by loadRoster's confirmation/errors, appended by renderSummary so the very next
// renderTable() (e.g. from an in-flight fetch completing) does not silently overwrite it.
// Cleared whenever the player list next changes (add/remove).
let rosterNotice = null;
let saveWarning = null; // set when save() throws; cleared by the next save that succeeds

function load() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { raw = {}; }
    const parsed = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    if (Array.isArray(parsed.players)) {
        state.players = parsed.players.filter(p => p && typeof p === 'object' && typeof p.name === 'string');
    }
    if (parsed.profiles && typeof parsed.profiles === 'object' && !Array.isArray(parsed.profiles)) {
        state.profiles = parsed.profiles;
    }
    if (parsed.errors && typeof parsed.errors === 'object' && !Array.isArray(parsed.errors)) {
        state.errors = parsed.errors;
    }
    state.thresholds = V.parseThresholds(parsed.thresholds);
    try {
        const a = JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {};
        if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; wcl.guild = a.wcl.guild || ''; }
    } catch (e) { /* no assignments state yet */ }
}
function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (saveWarning) { saveWarning = null; renderSaveWarning(); }
}
// A save that throws (browser storage full or disabled) is a page notice, never a row state: the
// profile is in memory and renders normally — it just has to be fetched again after a reload.
// Until 2026-09-07 it was written as the row's error, which hid a perfectly good profile behind
// "error" for every player added after the budget ran out (Bejoux, Smellmystaff).
function noteSaveFailure(err) {
    saveWarning = 'Could not save the player list in browser storage — players still load, but are fetched again after a reload. (' + err.message + ')';
    renderSaveWarning();
}
function renderSaveWarning() {
    const el = document.getElementById('saveWarning');
    if (!el) return;
    el.textContent = saveWarning || '';
    el.classList.toggle('hidden', !saveWarning);
}

const THRESH_LABELS = [
    ['gs', 'GearScore ≥'],
    ['ilvl', 'Avg item level ≥'], ['meleeHit', 'Melee/ranged hit ≥'], ['spellHit', 'Spell hit ≥'],
    ['expertise', 'Expertise (skill) ≥'], ['defense', 'Defense ≥'], ['parse', 'Median parse ≥'],
    ['enchantWarn', 'Enchants missing: warn at'], ['enchantFail', 'fail at'],
    ['socketWarn', 'Sockets empty: warn at'], ['socketFail', 'fail at'], ['staleDays', 'Stale after (days)'],
];

function renderThresholds() {
    const strip = document.getElementById('threshStrip');
    strip.innerHTML = '';
    THRESH_LABELS.forEach(([key, label]) => {
        const l = document.createElement('label');
        l.textContent = label;
        const i = document.createElement('input');
        i.type = 'number'; i.id = 'th-' + key; i.value = state.thresholds[key];
        i.addEventListener('change', () => {
            state.thresholds = V.parseThresholds(Object.assign({}, state.thresholds, { [key]: i.value }));
            i.value = state.thresholds[key];
            save(); renderTable();
        });
        l.appendChild(i);
        strip.appendChild(l);
    });
    const reset = document.createElement('button');
    reset.id = 'resetThresholds'; reset.className = 'btn'; reset.textContent = 'Reset defaults';
    reset.addEventListener('click', () => { state.thresholds = Object.assign({}, V.DEFAULT_THRESHOLDS); save(); renderThresholds(); renderTable(); });
    strip.appendChild(reset);
}

function renderRealm() {
    document.getElementById('realmInput').value = wcl.server;
    document.getElementById('regionInput').value = wcl.region;
    document.getElementById('guildInput').value = wcl.guild;
    const el = document.getElementById('realmLine');
    if (!wcl.server) {
        el.className = 'status error';
        el.textContent = 'No realm set — enter the Warcraft Logs realm slug above before adding players.';
    } else {
        el.className = 'status';
        el.textContent = 'Shared with the Assignments page\u2019s Warcraft Logs settings.';
    }
}
// The realm is a setting shared with the Assignments page, so it lives in that page's state blob
// rather than ours. Merge into whatever is there — the blob also holds the roster, and a
// wcl sub-object may carry fetch results (durations) that must survive a realm edit.
function saveRealm() {
    let a = {};
    try { a = JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {}; } catch (e) { a = {}; }
    if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
    a.wcl = Object.assign({}, a.wcl, { server: wcl.server, region: wcl.region, guild: wcl.guild });
    localStorage.setItem(ASSIGN_KEY, JSON.stringify(a));
}
function onRealmChange() {
    wcl.server = document.getElementById('realmInput').value.trim().toLowerCase();
    wcl.region = document.getElementById('regionInput').value || 'eu';
    wcl.guild = document.getElementById('guildInput').value.trim();
    try { saveRealm(); } catch (err) { rosterNotice = 'Could not save the realm locally: ' + err.message; }
    renderRealm();
    // Players added before a realm was set are parked on "No realm set"; a realm change is
    // what unblocks them, so retry those now rather than making the user refresh everything.
    if (wcl.server) {
        Object.keys(state.errors).forEach(key => {
            if (state.errors[key] !== 'No realm set') return;
            delete state.errors[key];
            const p = state.players.find(pl => pl.name.toLowerCase() === key);
            if (p) enqueue(p.name, true);
        });
    }
    refreshLogList();
    renderTable();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// 'SSC / TK' -> 'SSC', 'BT / Hyjal' -> 'BT': the text before the first space or slash.
function shortZoneLabel(zoneName) {
    const m = /^[^\s/]+/.exec(zoneName || '');
    return m ? m[0] : (zoneName || '');
}

// --- fetch queue ---
function enqueue(name, force) {
    const key = name.toLowerCase();
    if (!force && state.profiles[key]) return;
    if (inFlightKeys.has(key)) return;
    if (queue.indexOf(key) === -1) queue.push(key);
    pump();
}
function pump() {
    if (Date.now() < pausedUntil) return;
    while (inFlight < CONCURRENCY && queue.length) {
        const key = queue.shift();
        inFlight++;
        inFlightKeys.add(key);
        fetchOne(key).finally(() => { inFlight--; inFlightKeys.delete(key); pump(); });
    }
    renderSummary();
}
// Folds a /api/vet/parses answer into a pending profile. The result has exactly the shape
// /api/vet/player returns, so every renderer below is shared. A failed parses fetch keeps the
// gear and says why in `missing` — a row is never downgraded to "error" for parses alone.
function mergeParses(profile, body, error) {
    const parses = body && body.parses ? body.parses : null;
    const identity = profile.identity && profile.identity.spec ? profile.identity : (body && body.identity) || profile.identity;
    // 'spec could not be determined' comes from the roster profile, which had no rankings to look
    // at; /api/vet/parses may well have determined it. Drop it and let the line below re-add it
    // only if the merged identity still has no spec.
    const missing = (profile.missing || []).filter(m => !/^no parses|^parses:/.test(m) && m !== 'spec could not be determined');
    if (error) missing.push('parses: ' + error);
    else if (!parses) missing.push('no parses in either tier');
    if (identity && !identity.spec && !missing.includes('spec could not be determined')) missing.push('spec could not be determined');
    const out = Object.assign({}, profile, { parses, identity, missing });
    delete out.parsesPending;
    return out;
}
async function fetchOne(key) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player) return;
    delete state.errors[key];
    if (!wcl.server) { state.errors[key] = 'No realm set'; save(); renderTable(); return; }
    // A profile loaded from a log already has gear; only its parses are outstanding. Those come
    // from /api/vet/parses (two WCL requests) and are merged in; everything else still goes the
    // whole way through /api/vet/player.
    const existing = state.profiles[key];
    const pendingParses = !!(existing && existing.parsesPending);
    const server = player.server || wcl.server;
    try {
        const base = '?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(server) + '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE;
        const url = pendingParses
            ? '/api/vet/parses' + base + (existing.identity && existing.identity.class ? '&class=' + encodeURIComponent(existing.identity.class) : '') +
              (existing.identity && Array.isArray(existing.identity.talentSplit) && existing.identity.talentSplit.length === 3 ? '&talents=' + existing.identity.talentSplit.join(',') : '')
            : '/api/vet/player' + base;
        const res = await fetch(url);
        // Remove all (or a single ×) can run while this request is in flight; a response arriving
        // after the player is gone from state.players must not resurrect its row.
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (res.status === 429) { queue.unshift(key); pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (pendingParses) state.profiles[key] = mergeParses(existing, null, body.error || ('HTTP ' + res.status));
            else state.errors[key] = body.error || ('HTTP ' + res.status);
        }
        else if (pendingParses) { state.profiles[key] = mergeParses(existing, body, null); }
        else { state.profiles[key] = body; }
    } catch (err) {
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (pendingParses) state.profiles[key] = mergeParses(existing, null, 'Network error: ' + err.message);
        else state.errors[key] = 'Network error: ' + err.message;
    }
    // save() can throw (e.g. QuotaExceededError). It must not skip renderTable() below, or the
    // row is stuck on "fetching…" forever; the failure is a page notice, and the row shows the profile.
    try { save(); } catch (err) { noteSaveFailure(err); }
    renderTable();
}
function pause() {
    pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    const el = document.getElementById('rateLimit');
    el.classList.remove('hidden');
    const tick = () => {
        const left = Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
        el.textContent = 'Warcraft Logs rate limit reached — resuming in ' + left + 's (' + queue.length + ' waiting)';
        if (left > 0) setTimeout(tick, 1000);
        else { el.classList.add('hidden'); pump(); }
    };
    tick();
}

// --- players ---
// Sanitizes and de-dupes a name into state.players without saving/rendering/enqueueing, so
// loadRoster can add many players and pay for one save+render instead of one per player.
// Returns { name, added } (added: false when the sanitized name already existed) or null when
// the name was rejected by the sanitizer.
function insertPlayer(name) {
    const clean = String(name || '').trim().replace(/[^\p{L}\p{M}'-]/gu, '');
    if (clean.length < 2) return null;
    const existed = state.players.some(p => p.name.toLowerCase() === clean.toLowerCase());
    if (!existed) state.players.push({ name: clean });
    return { name: clean, added: !existed };
}
function addPlayer(name) {
    const r = insertPlayer(name);
    if (!r) return false;
    rosterNotice = null;
    // save() can throw (e.g. QuotaExceededError); it must not skip renderTable()/enqueue() below.
    try { save(); } catch (err) { noteSaveFailure(err); }
    renderTable();
    enqueue(r.name, false);
    return true;
}
// Batch intake for several names at once — the #add= fragment, a pasted list, a typed comma
// list, the Assignments roster. One save and one render for the lot; enqueue per name so each
// fetch starts immediately. `source` names where they came from in the summary notice.
function addPlayers(names, source) {
    let added = 0, total = 0;
    names.forEach(n => {
        const r = insertPlayer(n);
        if (!r) return;
        total++;
        if (r.added) added++;
        enqueue(r.name, false);
    });
    if (!total) { rosterNotice = source ? 'Nothing usable in the ' + source + '.' : null; renderSummary(); return 0; }
    // The players are already in state.players regardless of whether this save succeeds — a
    // failure here must not report a false success; the notice has to say the list could not
    // be persisted, or the next reload silently reverts it with no error anywhere.
    const summary = source ? 'Added ' + total + ' from the ' + source + ' (' + added + ' new).' : null;
    try {
        save();
        rosterNotice = summary;
    } catch (err) {
        rosterNotice = (summary || 'Added ' + total + ',') + ' but could not save locally: ' + err.message;
    }
    renderTable();
    return total;
}
// The addon's copy link is vetting.html#add=Name,Name. Consume it on load and whenever the
// hash changes (pasting into the address bar of the open tab), then drop it from the URL so a
// reload or bookmark does not add everyone again.
function takeFragment() {
    const names = V.namesFromHash(location.hash);
    if (!names.length) return;
    history.replaceState(null, '', location.pathname + location.search);
    addPlayers(names, 'link');
}

// --- logs-first B4: a whole raid from one report ---
let logListFor = ''; // guild/server/region the select was last filled for
// Bumped by Remove all so a roster response that lands after the user emptied the table can tell
// that its whole payload is stale.
let clearEpoch = 0;
async function refreshLogList() {
    const sel = document.getElementById('logSelect');
    const want = wcl.guild && wcl.server ? wcl.region + '/' + wcl.server + '/' + wcl.guild.toLowerCase() : '';
    if (want === logListFor) return;
    logListFor = want;
    sel.innerHTML = '<option value="">' + (want ? 'Loading raid nights…' : 'Recent raid nights (set a guild)') + '</option>';
    if (!want) return;
    try {
        const res = await fetch('/api/wcl/logs?guild=' + encodeURIComponent(wcl.guild) + '&server=' + encodeURIComponent(wcl.server) + '&region=' + encodeURIComponent(wcl.region));
        const body = await res.json().catch(() => ({}));
        if (logListFor !== want) return; // settings changed while this was in flight
        // Fix round 2 (Important): logListFor is the in-flight guard, so a failure has to release
        // it — otherwise one 500 leaves every later refreshLogList() short-circuiting on
        // `want === logListFor` and the select is stuck on the error text for the whole session.
        if (!res.ok) { logListFor = ''; sel.innerHTML = '<option value="">' + escapeHtml(body.error || ('HTTP ' + res.status)) + '</option>'; return; }
        const logs = Array.isArray(body.logs) ? body.logs : [];
        sel.innerHTML = '<option value="">' + (logs.length ? 'Recent raid nights…' : 'No logs for ' + escapeHtml(wcl.guild)) + '</option>' +
            logs.map(l => '<option value="' + escapeHtml(l.code) + '">' + escapeHtml(l.date + ' · ' + (l.zone ? shortZoneLabel(l.zone.name) : '?') + ' · ' + l.title) + '</option>').join('');
    } catch (err) { if (logListFor === want) { logListFor = ''; sel.innerHTML = '<option value="">Network error: ' + escapeHtml(err.message) + '</option>'; } }
}
// Loads every player of a report into the table with a pending profile (gear now, parses
// streaming through the queue). `quiet` (Refresh all) keeps the roster notice as it is.
async function loadReport(code, opts) {
    opts = opts || {};
    const btn = document.getElementById('loadLogBtn');
    btn.disabled = true;
    if (!opts.quiet) { rosterNotice = 'Reading report ' + code + ' from Warcraft Logs…'; renderSummary(); }
    // Who was on the table when the request went out, so the response can tell which of the
    // players it is about to add were removed by hand while it was in flight.
    const before = new Set(state.players.map(p => p.name.toLowerCase()));
    const epoch = clearEpoch;
    try {
        const res = await fetch('/api/wcl/log/' + encodeURIComponent(code) + '/roster?zone=' + ZONE + '&server=' + encodeURIComponent(wcl.server) + '&region=' + encodeURIComponent(wcl.region));
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) { pause(); rosterNotice = 'Warcraft Logs rate limit reached — the log was not loaded.'; renderSummary(); return false; }
        if (!res.ok) { rosterNotice = body.error || ('HTTP ' + res.status); renderSummary(); return false; }
        // Remove all ran while this was out: the user emptied the table on purpose, so a whole raid
        // must not reappear underneath them.
        if (clearEpoch !== epoch) { rosterNotice = 'The player list was cleared while ' + code + ' was loading — nothing was added.'; renderSummary(); return false; }
        // × on a single player, likewise: they were on the table when the request went out and are
        // gone now, so this response must not resurrect them (the guard fetchOne already uses).
        const present = new Set(state.players.map(p => p.name.toLowerCase()));
        const removedDuring = new Set(Array.from(before).filter(k => !present.has(k)));
        const rep = body.report || {};
        let added = 0;
        (body.players || []).forEach(p => {
            const r = insertPlayer(p.name);
            if (!r) return;
            const key = r.name.toLowerCase();
            if (removedDuring.has(key)) { if (r.added) state.players = state.players.filter(pl => pl.name.toLowerCase() !== key); return; }
            if (r.added) added++;
            const player = state.players.find(pl => pl.name.toLowerCase() === key);
            player.source = { report: code, date: rep.date || null, zone: rep.zone ? rep.zone.name : null, fightName: p.lastSeen ? p.lastSeen.fightName : null };
            player.server = p.server || null;
            state.profiles[key] = p;
            delete state.errors[key];
            enqueue(r.name, true);
        });
        // The first log loaded fills in the guild when none is set — the log picker then works.
        if (!wcl.guild && rep.guild && rep.guild.name) { wcl.guild = rep.guild.name; try { saveRealm(); } catch (e) { /* notice below still shows */ } renderRealm(); refreshLogList(); }
        const summary = 'Loaded ' + (body.players || []).length + ' players from ' + (rep.date || code) + (rep.zone ? ' · ' + rep.zone.name : '') + ' (' + added + ' new). Parses are loading.';
        // Fix round 2 (Minor): the quiet contract holds here too — a failed save must not write
        // the notice Refresh all promised to leave alone. The fact is not lost: every player just
        // added is enqueued above, and the failure itself is the page's save notice.
        try { save(); } catch (err) { noteSaveFailure(err); }
        if (!opts.quiet) rosterNotice = summary;
        renderTable();
        return true;
    } catch (err) { rosterNotice = 'Network error: ' + err.message; renderSummary(); return false; }
    finally { btn.disabled = false; }
}
function loadLog() {
    const raw = document.getElementById('logInput').value.trim();
    const typed = V.parseReportCode(raw);
    // Typed-but-unparseable must not fall through to the selected night — the user would be shown
    // a different raid from the one they pasted, with no way to tell.
    if (raw && !typed) { rosterNotice = 'Not a Warcraft Logs report code or URL: ' + raw; renderSummary(); return; }
    const code = typed || document.getElementById('logSelect').value;
    if (!code) { rosterNotice = 'Pick a raid night or paste a Warcraft Logs report code / URL.'; renderSummary(); return; }
    if (!wcl.server) { rosterNotice = 'No realm set — enter the Warcraft Logs realm slug first.'; renderSummary(); return; }
    // Fix round 2 (Minor): clear the paste only once the load actually succeeded — a 404/429/
    // network failure used to wipe it, leaving the user to find the report code again. (A typed-
    // but-unparseable paste already keeps its text, above.)
    const input = document.getElementById('logInput');
    loadReport(code).then(ok => { if (ok) input.value = ''; });
}
function removePlayer(name) {
    const key = name.toLowerCase();
    state.players = state.players.filter(p => p.name.toLowerCase() !== key);
    delete state.profiles[key]; delete state.errors[key];
    queue = queue.filter(k => k !== key);
    rosterNotice = null;
    save(); renderTable();
}
function removeAll() {
    clearEpoch++;
    state.players = [];
    state.profiles = {};
    state.errors = {};
    queue = [];
    expanded = null;
    rosterNotice = null;
    // save() can throw (e.g. QuotaExceededError); surface it as the page's save notice — never
    // throw or alert.
    try { save(); } catch (err) { noteSaveFailure(err); }
    renderTable();
}

// --- table ---
function rows() {
    const now = Date.now();
    return state.players.map(p => {
        const key = p.name.toLowerCase();
        const profile = state.profiles[key];
        if (state.errors[key]) return { name: p.name, key, verdict: 'error', error: state.errors[key], profile: null, rules: [], reasons: [] };
        if (!profile) return { name: p.name, key, verdict: 'unverified', pending: true, profile: null, rules: [], reasons: ['fetching…'] };
        const ev = V.evaluate(profile, state.thresholds, now);
        // logs-first B4: gear is here, parses are streaming — shown as pending, never as
        // "unverified, no parses" while the request is still out.
        if (profile.parsesPending) return { name: p.name, key, verdict: 'unverified', pending: true, parsesPending: true, profile, rules: ev.rules, reasons: ['parses loading…'] };
        return { name: p.name, key, verdict: ev.verdict, profile, rules: ev.rules, reasons: ev.reasons };
    });
}
function ruleCell(r) {
    const td = document.createElement('td');
    if (!r || !r.applies) { td.className = 'cell-na'; td.textContent = '—'; return td; }
    if (r.status === 'unknown') { td.className = 'cell-unknown'; td.textContent = '?'; td.title = r.note; return td; }
    td.className = 'cell-' + r.status;
    if (r.key === 'stale') td.textContent = r.value + 'd';
    else if (r.key === 'enchants' || r.key === 'sockets') td.textContent = String(r.value);
    else {
        const cap = r.key === 'hit' ? r.effective : r.threshold;
        td.textContent = r.value + ' / ' + cap + (r.value < cap ? ' (−' + (Math.round((cap - r.value) * 100) / 100) + ')' : '');
    }
    td.title = r.note || '';
    return td;
}
function renderTable() {
    const body = document.getElementById('vetBody');
    body.innerHTML = '';
    const sorted = V.sortRows(rows().map(r => Object.assign({}, r, { verdict: r.verdict === 'error' ? 'unverified' : r.verdict, realVerdict: r.verdict })));
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        tr.dataset.name = r.name;
        const verdictTd = document.createElement('td');
        verdictTd.innerHTML = (r.parsesPending ? '<span class="verdict pending">…</span>' : '<span class="verdict ' + r.realVerdict + '">' + r.realVerdict + '</span>') +
            (r.reasons.length ? '<span class="reasons">' + escapeHtml(r.reasons.join(', ')) + '</span>' : '');
        tr.appendChild(verdictTd);
        const nameTd = document.createElement('td');
        nameTd.textContent = r.name;
        if (r.error) nameTd.title = r.error;
        tr.appendChild(nameTd);
        const specTd = document.createElement('td');
        specTd.textContent = r.profile && r.profile.identity.spec ? r.profile.identity.spec : '?';
        if (r.profile && r.profile.identity.class) specTd.style.color = (AssignmentsEngine.CLASS_COLORS || {})[r.profile.identity.class] || '';
        tr.appendChild(specTd);
        const byKey = Object.fromEntries(r.rules.map(x => [x.key, x]));
        ['gs', 'ilvl', 'hit', 'expertise', 'defense', 'parse', 'enchants', 'sockets', 'stale'].forEach(k => {
            if (k === 'parse' && r.parsesPending) { const td = document.createElement('td'); td.className = 'cell-pending'; td.textContent = '…'; td.title = 'parses loading'; tr.appendChild(td); return; }
            const td = ruleCell(byKey[k]);
            if (k === 'parse' && r.profile && r.profile.parses) {
                const parses = r.profile.parses;
                if (parses.other) {
                    td.textContent += ' (' + escapeHtml(shortZoneLabel(parses.zoneName)) + ' · ' +
                        escapeHtml(shortZoneLabel(parses.other.zoneName)) + ' ' + Math.round(parses.other.medianPercent) + ')';
                } else if (parses.fallback) {
                    td.textContent += ' (' + escapeHtml(parses.zoneName) + ')';
                }
            }
            tr.appendChild(td);
        });
        const rm = document.createElement('td');
        if (r.profile && r.profile.parses && wcl.server) {
            const rep = document.createElement('a');
            rep.className = 'report-link'; rep.textContent = 'Report'; rep.href = feedbackUrl(r); rep.target = '_blank'; rep.rel = 'noopener'; rep.title = 'Open the feedback report in a new tab';
            rep.addEventListener('click', e => e.stopPropagation());
            rm.appendChild(rep);
        }
        const btn = document.createElement('button');
        btn.className = 'remove-btn'; btn.textContent = '×'; btn.title = 'Remove';
        btn.addEventListener('click', e => { e.stopPropagation(); removePlayer(r.name); });
        rm.appendChild(btn);
        tr.appendChild(rm);
        tr.addEventListener('click', () => toggleDetail(r.key));
        body.appendChild(tr);
        if (expanded === r.key && r.profile) body.appendChild(detailRow(r));
    });
    renderSummary();
}
function renderSummary() {
    const el = document.getElementById('summary');
    const rs = rows();
    let text;
    if (!rs.length) { text = 'No players yet — add a name or load the roster.'; }
    else {
        const count = v => rs.filter(r => r.verdict === v && !r.pending).length;
        const pending = rs.filter(r => r.pending).length;
        text = count('pass') + ' pass · ' + count('warn') + ' warn · ' + count('fail') + ' fail · ' +
            count('unverified') + ' unverified · ' + count('error') + ' error' + (pending ? ' · ' + pending + ' fetching' : '');
    }
    el.textContent = rosterNotice ? text + ' — ' + rosterNotice : text;
}
function toggleDetail(key) { expanded = expanded === key ? null : key; renderTable(); }
function feedbackUrl(r) {
    const player = state.players.find(p => p.name.toLowerCase() === r.key) || {};
    return 'feedback.html?name=' + encodeURIComponent(r.name) + '&server=' + encodeURIComponent(player.server || wcl.server) + '&region=' + encodeURIComponent(wcl.region) +
           '&zone=' + ZONE + '&thresholds=' + encodeURIComponent(JSON.stringify(state.thresholds)) +
           // logs-first B4: a row that came from a log opens its report on that night.
           (player.source && player.source.report ? '&report=' + encodeURIComponent(player.source.report) : '');
}
function statRows(p) {
    // computedFromGear is gear-only (never backfilled by what WCL reported), so the left column
    // can actually disagree with the right one. Older profiles cached before this field existed
    // fall back to today's (tautological) behaviour rather than throwing.
    const c = p.computedFromGear || p.computed || {}, r = p.reported || {};
    const line = (label, comp, rep) => [label, comp == null ? '—' : comp, rep == null ? '—' : rep];
    const id = p.identity || {};
    const defTalent = V.defenseAllowanceSkill(id.class, id.spec, id.talentSplit);
    return [
        line('Spell damage', c.spellDamage, null), line('Healing', c.healing, null),
        line('Attack power', c.attackPower, null), line('Ranged AP', c.rangedAttackPower, null),
        line('Melee hit', c.meleeHit, r.hitMelee), line('Ranged hit', c.rangedHit, r.hitRanged), line('Spell hit', c.spellHit, r.hitSpell),
        line('Expertise', c.expertiseSkill + ' (' + c.expertiseRating + ' rating)', r.expertise),
        line('Melee crit', c.meleeCrit, r.critMelee), line('Spell crit', c.spellCrit, r.critSpell),
        line('Melee haste', c.meleeHaste, r.hasteMelee), line('Spell haste', c.spellHaste, r.hasteSpell),
        line('Defense', c.defenseSkill + ' (' + c.defenseRating + ' rating)' + (defTalent ? ' + ' + defTalent + ' Anticipation' : ''), null), line('MP5', c.mp5, null),
        line('Dodge / parry / block', null, [r.dodge, r.parry, r.block].join(' / ')), line('Armor', c.armor, r.armor),
        line('Str / Agi / Sta / Int / Spi', [c.strength, c.agility, c.stamina, c.intellect, c.spirit].join(' / '),
             [r.strength, r.agility, r.stamina, r.intellect, r.spirit].join(' / ')),
    ];
}
function bossTable(bosses) {
    const t = document.createElement('table');
    t.innerHTML = '<tr><th>Boss</th><th>median</th><th>best</th><th>kills</th></tr>';
    bosses.forEach(b => {
        const row = document.createElement('tr');
        row.innerHTML = '<td>' + escapeHtml(b.name || '') + '</td><td>' + (b.medianPercent == null ? '—' : Math.round(b.medianPercent)) + '</td><td>' + (b.bestPercent == null ? '—' : Math.round(b.bestPercent)) + '</td><td>' + b.kills + '</td>';
        t.appendChild(row);
    });
    return t;
}
function detailRow(r) {
    const p = r.profile;
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 13;
    const grid = document.createElement('div');
    grid.className = 'detail-grid';

    // Gear
    const gearBox = document.createElement('div');
    const gsSummary = p.gearSummary;
    const gsHeadingParts = gsSummary ? [
        typeof gsSummary.gearScore === 'number' ? 'GearScore ' + gsSummary.gearScore : null,
        'avg ilvl ' + gsSummary.avgItemLevel,
    ].filter(Boolean).join(' · ') : '';
    gearBox.innerHTML = '<h4>Gear' + (gsSummary ? ' — ' + gsHeadingParts + (gsSummary.setBonusesApplied ? '' : ' (set bonuses not included)') : '') + '</h4>';
    if (p.gear) {
        const t = document.createElement('table');
        p.gear.forEach(s => {
            const row = document.createElement('tr');
            if (s.empty) { row.innerHTML = '<td>' + escapeHtml(s.label) + '</td><td class="slot-missing" colspan="3">empty</td>'; t.appendChild(row); return; }
            const ench = s.enchantable ? (s.enchant ? '<span class="slot-ok">' + escapeHtml(s.enchant.name) + '</span>' : '<span class="slot-missing">no enchant</span>') : '';
            const gems = s.sockets ? (s.gems.map(g => escapeHtml(g.name)).join(', ') + (s.emptySockets ? ' <span class="slot-missing">' + s.emptySockets + ' empty</span>' : '')) : '';
            row.innerHTML = '<td>' + escapeHtml(s.label) + '</td><td>' + escapeHtml(s.name) + ' <span class="cell-unknown">' + s.itemLevel + '</span></td><td>' + ench + '</td><td>' + gems + '</td>';
            t.appendChild(row);
        });
        gearBox.appendChild(t);
    } else gearBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No gear data.</div>');
    grid.appendChild(gearBox);

    // Stats
    const statBox = document.createElement('div');
    statBox.innerHTML = '<h4>Stats (from gear · reported by WCL)</h4>';
    if (p.computed) {
        const t = document.createElement('table');
        t.innerHTML = '<tr><th></th><th>gear</th><th>WCL</th></tr>';
        statRows(p).forEach(([l, a, b]) => { const row = document.createElement('tr'); row.innerHTML = '<td>' + l + '</td><td>' + escapeHtml(String(a)) + '</td><td>' + escapeHtml(String(b)) + '</td>'; t.appendChild(row); });
        statBox.appendChild(t);
    } else statBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No stat data.</div>');
    grid.appendChild(statBox);

    // Parses + missing
    const parseBox = document.createElement('div');
    parseBox.innerHTML = '<h4>Parses' + (p.parses ? ' — ' + escapeHtml(p.parses.zoneName) + ' (' + p.parses.metric + ')' : '') + '</h4>';
    if (p.parses) {
        parseBox.appendChild(bossTable(p.parses.bosses));
        if (p.parses.other) {
            const otherHeading = document.createElement('h4');
            otherHeading.textContent = p.parses.other.zoneName + ' — ' + Math.round(p.parses.other.medianPercent) + ' median';
            parseBox.appendChild(otherHeading);
            parseBox.appendChild(bossTable(p.parses.other.bosses));
        }
    } else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">' + (p.parsesPending ? 'Parses loading…' : 'No parses.') + '</div>');
    if (p.lastSeen) parseBox.insertAdjacentHTML('beforeend', '<div class="status">Last seen: ' + escapeHtml(new Date(p.lastSeen.timestamp).toLocaleDateString()) + ' — ' + escapeHtml(p.lastSeen.fightName || '') + '</div>');
    if (p.missing && p.missing.length) parseBox.insertAdjacentHTML('beforeend', '<div class="warn">' + p.missing.map(escapeHtml).join('<br>') + '</div>');
    if (p.parses && wcl.server) {
        const rep = document.createElement('a');
        rep.className = 'report-link'; rep.textContent = 'Feedback report →'; rep.href = feedbackUrl(r); rep.target = '_blank'; rep.rel = 'noopener';
        rep.addEventListener('click', e => e.stopPropagation());
        parseBox.appendChild(rep);
    }
    grid.appendChild(parseBox);

    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
}

// --- wiring ---
document.addEventListener('DOMContentLoaded', () => {
    load();
    // Reports the feedback page cached in localStorage before 2026-09-07 share this page's 5 MB
    // budget; moving them to IndexedDB from here too means the space comes back as soon as the
    // vetting page opens, not only after a feedback report is next viewed.
    if (window.FeedbackCache) FeedbackCache.migrate();
    renderRealm();
    renderThresholds();
    renderTable();
    const input = document.getElementById('nameInput');
    const add = () => {
        const names = V.parseNameList(input.value);
        if (names.length === 1 ? addPlayer(names[0]) : addPlayers(names, 'list')) input.value = '';
        input.focus();
    };
    document.getElementById('addBtn').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    // A pasted list is added on the spot — no Enter, no aiming for the button.
    input.addEventListener('paste', e => {
        const names = V.parseNameList(e.clipboardData ? e.clipboardData.getData('text') : '');
        if (!names.length) return;
        e.preventDefault();
        if (names.length === 1 ? addPlayer(names[0]) : addPlayers(names, 'paste')) input.value = '';
    });
    window.addEventListener('hashchange', takeFragment);
    document.getElementById('refreshBtn').addEventListener('click', () => {
        // Rows that came from a log re-load from it (two requests per distinct report), the
        // rest re-fetch by name as before.
        const reports = Array.from(new Set(state.players.filter(p => p.source && p.source.report).map(p => p.source.report)));
        state.profiles = {}; state.errors = {}; save(); renderTable();
        state.players.filter(p => !(p.source && p.source.report)).forEach(p => enqueue(p.name, true));
        // If a roster re-load fails (404/429/network) its rows have no profile, no error and
        // nothing queued — they would sit on "fetching…" forever with the raid's gear gone from
        // the table. Fall back to fetching each of those players by name.
        reports.forEach(code => loadReport(code, { quiet: true }).then(ok => {
            if (ok) return;
            state.players.filter(p => p.source && p.source.report === code && !state.profiles[p.name.toLowerCase()])
                .forEach(p => enqueue(p.name, true));
        }));
    });
    document.getElementById('realmInput').addEventListener('change', onRealmChange);
    document.getElementById('regionInput').addEventListener('change', onRealmChange);
    document.getElementById('loadRosterBtn').addEventListener('click', loadRoster);
    document.getElementById('removeAllBtn').addEventListener('click', removeAll);
    document.getElementById('loadLogBtn').addEventListener('click', loadLog);
    document.getElementById('logInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadLog(); });
    document.getElementById('guildInput').addEventListener('change', onRealmChange);
    refreshLogList();
    // Resume anything not yet fetched (e.g. after a reload mid-queue). A profile persisted with
    // parsesPending is half-done — enqueue would skip it because a profile exists, leaving the row
    // on "…" forever, so force those.
    state.players.forEach(p => enqueue(p.name, !!(state.profiles[p.name.toLowerCase()] || {}).parsesPending));
    takeFragment();
});
function loadRoster() {
    let a = null, link = {};
    try { a = JSON.parse(localStorage.getItem(ASSIGN_KEY)); } catch (e) { /* none */ }
    try { link = JSON.parse(localStorage.getItem(ASSIGN_LINK_KEY)) || {}; } catch (e) { link = {}; }
    if (!a || !a.sources) { rosterNotice = 'No roster found — import one on the Assignments page first.'; renderSummary(); return; }
    const roster = AssignmentsEngine.deriveRoster(a, link);
    if (!roster.length) { rosterNotice = 'The Assignments roster is empty.'; renderSummary(); return; }
    addPlayers(roster.map(p => p.name), 'roster');
}

// Exposed for the headless smoke test.
window.vetAdd = addPlayer;
window.vetState = () => state;
