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
const inFlightKeys = new Set();
let pausedUntil = 0;
let expanded = null; // name (lower) whose detail row is open

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
function statRows(p) {
    const c = p.computed || {}, r = p.reported || {};
    const line = (label, comp, rep) => [label, comp == null ? '—' : comp, rep == null ? '—' : rep];
    return [
        line('Spell damage', c.spellDamage, null), line('Healing', c.healing, null),
        line('Attack power', c.attackPower, null), line('Ranged AP', c.rangedAttackPower, null),
        line('Melee hit', c.meleeHit, r.hitMelee), line('Ranged hit', c.rangedHit, r.hitRanged), line('Spell hit', c.spellHit, r.hitSpell),
        line('Expertise', c.expertiseSkill + ' (' + c.expertiseRating + ' rating)', r.expertise),
        line('Melee crit', c.meleeCrit, r.critMelee), line('Spell crit', c.spellCrit, r.critSpell),
        line('Melee haste', c.meleeHaste, r.hasteMelee), line('Spell haste', c.spellHaste, r.hasteSpell),
        line('Defense', c.defenseSkill + ' (' + c.defenseRating + ' rating)', null), line('MP5', c.mp5, null),
        line('Dodge / parry / block', null, [r.dodge, r.parry, r.block].join(' / ')), line('Armor', null, r.armor),
        line('Str / Agi / Sta / Int / Spi', null, [r.strength, r.agility, r.stamina, r.intellect, r.spirit].join(' / ')),
    ];
}
function detailRow(r) {
    const p = r.profile;
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 12;
    const grid = document.createElement('div');
    grid.className = 'detail-grid';

    // Gear
    const gearBox = document.createElement('div');
    gearBox.innerHTML = '<h4>Gear' + (p.gearSummary ? ' — avg ' + p.gearSummary.avgItemLevel + (p.gearSummary.setBonusesApplied ? '' : ' (set bonuses not included)') : '') + '</h4>';
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
        const t = document.createElement('table');
        t.innerHTML = '<tr><th>Boss</th><th>median</th><th>best</th><th>kills</th></tr>';
        p.parses.bosses.forEach(b => {
            const row = document.createElement('tr');
            row.innerHTML = '<td>' + escapeHtml(b.name || '') + '</td><td>' + (b.medianPercent == null ? '—' : Math.round(b.medianPercent)) + '</td><td>' + (b.bestPercent == null ? '—' : Math.round(b.bestPercent)) + '</td><td>' + b.kills + '</td>';
            t.appendChild(row);
        });
        parseBox.appendChild(t);
    } else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No parses.</div>');
    if (p.lastSeen) parseBox.insertAdjacentHTML('beforeend', '<div class="status">Last seen: ' + escapeHtml(new Date(p.lastSeen.timestamp).toLocaleDateString()) + ' — ' + escapeHtml(p.lastSeen.fightName || '') + '</div>');
    if (p.missing && p.missing.length) parseBox.insertAdjacentHTML('beforeend', '<div class="warn">' + p.missing.map(escapeHtml).join('<br>') + '</div>');
    grid.appendChild(parseBox);

    td.appendChild(grid);
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
function loadRoster() {
    let a = null, link = {};
    try { a = JSON.parse(localStorage.getItem(ASSIGN_KEY)); } catch (e) { /* none */ }
    try { link = JSON.parse(localStorage.getItem(ASSIGN_LINK_KEY)) || {}; } catch (e) { link = {}; }
    const el = document.getElementById('summary');
    if (!a || !a.sources) { el.textContent = 'No roster found — import one on the Assignments page first.'; return; }
    const roster = AssignmentsEngine.deriveRoster(a, link);
    if (!roster.length) { el.textContent = 'The Assignments roster is empty.'; return; }
    let added = 0;
    roster.forEach(p => { if (!state.players.some(x => x.name.toLowerCase() === p.name.toLowerCase())) added++; addPlayer(p.name); });
    el.textContent = 'Loaded ' + roster.length + ' from the roster (' + added + ' new).';
}

// Exposed for the headless smoke test.
window.vetAdd = addPlayer;
window.vetState = () => state;
