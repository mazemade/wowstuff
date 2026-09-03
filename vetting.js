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
const wcl = { server: '', region: 'eu' };
let queue = [];
let inFlight = 0;
let pausedUntil = 0;
let expanded = null; // name (lower) whose detail row is open

function load() {
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch (e) { /* fresh */ }
    state.thresholds = V.parseThresholds(state.thresholds);
    try {
        const a = JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {};
        if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; }
    } catch (e) { /* no assignments state yet */ }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const THRESH_LABELS = [
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
    const el = document.getElementById('realmLine');
    if (!wcl.server) {
        el.className = 'status error';
        el.innerHTML = 'No realm set — enter the Warcraft Logs realm slug under Player tuning on the <a href="./">Assignments page</a> first.';
    } else {
        el.className = 'status';
        el.innerHTML = 'Realm: <b>' + escapeHtml(wcl.server) + '</b> (' + escapeHtml(wcl.region.toUpperCase()) + ') — change on the <a href="./">Assignments page</a>.';
    }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- fetch queue ---
function enqueue(name, force) {
    const key = name.toLowerCase();
    if (!force && state.profiles[key]) return;
    if (queue.indexOf(key) === -1) queue.push(key);
    pump();
}
function pump() {
    if (Date.now() < pausedUntil) return;
    while (inFlight < CONCURRENCY && queue.length) {
        const key = queue.shift();
        inFlight++;
        fetchOne(key).finally(() => { inFlight--; pump(); });
    }
    renderSummary();
}
async function fetchOne(key) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player) return;
    delete state.errors[key];
    if (!wcl.server) { state.errors[key] = 'No realm set'; save(); renderTable(); return; }
    try {
        const url = '/api/vet/player?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(wcl.server) +
            '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE;
        const res = await fetch(url);
        if (res.status === 429) { queue.unshift(key); pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { state.errors[key] = body.error || ('HTTP ' + res.status); }
        else { state.profiles[key] = body; }
    } catch (err) { state.errors[key] = 'Network error: ' + err.message; }
    save(); renderTable();
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
function addPlayer(name) {
    const clean = String(name || '').trim().replace(/[^\p{L}\p{M}'-]/gu, '');
    if (clean.length < 2) return false;
    if (!state.players.some(p => p.name.toLowerCase() === clean.toLowerCase())) state.players.push({ name: clean });
    save(); renderTable(); enqueue(clean, false);
    return true;
}
function removePlayer(name) {
    const key = name.toLowerCase();
    state.players = state.players.filter(p => p.name.toLowerCase() !== key);
    delete state.profiles[key]; delete state.errors[key];
    queue = queue.filter(k => k !== key);
    save(); renderTable();
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
        td.textContent = r.value + ' / ' + cap + (r.value < cap ? ' (−' + (cap - r.value) + ')' : '');
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
        verdictTd.innerHTML = '<span class="verdict ' + r.realVerdict + '">' + r.realVerdict + '</span>' +
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
        ['ilvl', 'hit', 'expertise', 'defense', 'parse', 'enchants', 'sockets', 'stale'].forEach(k => {
            const td = ruleCell(byKey[k]);
            if (k === 'parse' && r.profile && r.profile.parses && r.profile.parses.fallback) td.textContent += ' (SSC/TK)';
            tr.appendChild(td);
        });
        const rm = document.createElement('td');
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
    if (!rs.length) { el.textContent = 'No players yet — add a name or load the roster.'; return; }
    const count = v => rs.filter(r => r.verdict === v).length;
    const pending = rs.filter(r => r.pending).length;
    el.textContent = count('pass') + ' pass · ' + count('warn') + ' warn · ' + count('fail') + ' fail · ' +
        count('unverified') + ' unverified · ' + count('error') + ' error' + (pending ? ' · ' + pending + ' fetching' : '');
}
function toggleDetail(key) { expanded = expanded === key ? null : key; renderTable(); }
function detailRow(r) {
    // Filled in by Task 7. Until then, an empty row keeps the click harmless.
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 12;
    td.textContent = 'Details coming in Task 7.';
    tr.appendChild(td);
    return tr;
}

// --- wiring ---
document.addEventListener('DOMContentLoaded', () => {
    load();
    renderRealm();
    renderThresholds();
    renderTable();
    const input = document.getElementById('nameInput');
    const add = () => { if (addPlayer(input.value)) input.value = ''; input.focus(); };
    document.getElementById('addBtn').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    document.getElementById('refreshBtn').addEventListener('click', () => {
        state.profiles = {}; state.errors = {}; save(); renderTable();
        state.players.forEach(p => enqueue(p.name, true));
    });
    document.getElementById('loadRosterBtn').addEventListener('click', loadRoster);
    // Resume anything not yet fetched (e.g. after a reload mid-queue).
    state.players.forEach(p => enqueue(p.name, false));
});
function loadRoster() { /* Task 7 */ }

// Exposed for the headless smoke test.
window.vetAdd = addPlayer;
window.vetState = () => state;
