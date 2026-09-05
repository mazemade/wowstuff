/* global AssignmentsEngine, VetEngine */
'use strict';
const V = VetEngine;
const STORAGE_KEY = 'raidVettingState';
const ASSIGN_KEY = 'raidAssignmentsState';
const ASSIGN_LINK_KEY = 'raidAssignmentsLinkMap';
const ZONE = 1060;
const CONCURRENCY = 3;
const RATE_LIMIT_PAUSE_MS = 60 * 1000;

const state = { players: [], thresholds: Object.assign({}, V.DEFAULT_THRESHOLDS), profiles: {}, errors: {}, feedback: {} };
const wcl = { server: '', region: 'eu' };
let queue = [];
let inFlight = 0;
const inFlightKeys = new Set();
let pausedUntil = 0;
let expanded = null; // name (lower) whose detail row is open
// Set by loadRoster's confirmation/errors, appended by renderSummary so the very next
// renderTable() (e.g. from an in-flight fetch completing) does not silently overwrite it.
// Cleared whenever the player list next changes (add/remove).
let rosterNotice = null;
const feedbackInFlight = new Set(); // keys with a report request running
const feedbackErrors = {};          // key -> last request error, cleared on the next request
// Minor 18: removeAll() and the "Refresh all" handler clear state.feedback but must also drop any
// stale feedbackErrors, or re-adding a player with the same name in the same session surfaces an
// old error message before any new request is made.
function clearFeedbackErrors() { Object.keys(feedbackErrors).forEach(k => delete feedbackErrors[k]); }

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
    if (parsed.feedback && typeof parsed.feedback === 'object' && !Array.isArray(parsed.feedback)) {
        state.feedback = parsed.feedback;
    }
    state.thresholds = V.parseThresholds(parsed.thresholds);
    try {
        const a = JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {};
        if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; }
    } catch (e) { /* no assignments state yet */ }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

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
    a.wcl = Object.assign({}, a.wcl, { server: wcl.server, region: wcl.region });
    localStorage.setItem(ASSIGN_KEY, JSON.stringify(a));
}
function onRealmChange() {
    wcl.server = document.getElementById('realmInput').value.trim().toLowerCase();
    wcl.region = document.getElementById('regionInput').value || 'eu';
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
async function fetchOne(key) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player) return;
    delete state.errors[key];
    if (!wcl.server) { state.errors[key] = 'No realm set'; save(); renderTable(); return; }
    try {
        const url = '/api/vet/player?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(wcl.server) +
            '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE;
        const res = await fetch(url);
        // Remove all (or a single ×) can run while this request is in flight; a response arriving
        // after the player is gone from state.players must not resurrect its row.
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (res.status === 429) { queue.unshift(key); pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { state.errors[key] = body.error || ('HTTP ' + res.status); }
        else { state.profiles[key] = body; }
    } catch (err) {
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        state.errors[key] = 'Network error: ' + err.message;
    }
    // save() can throw (e.g. QuotaExceededError). It must not skip renderTable() below, or the
    // row is stuck on "fetching…" forever with no error state — every failure is a row state.
    try { save(); } catch (err) { if (!state.errors[key]) state.errors[key] = 'Could not save locally: ' + err.message; }
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

// --- feedback report ---
async function requestFeedback(key, reportCode) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player || feedbackInFlight.has(key)) return;
    delete feedbackErrors[key];
    if (!wcl.server) { feedbackErrors[key] = 'No realm set'; renderTable(); return; }
    feedbackInFlight.add(key);
    renderTable();
    try {
        const url = '/api/vet/feedback?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(wcl.server) +
            '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE + '&thresholds=' + encodeURIComponent(JSON.stringify(state.thresholds)) +
            (reportCode ? '&report=' + encodeURIComponent(reportCode) : '');
        const res = await fetch(url);
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (res.status === 429) { feedbackErrors[key] = 'Warcraft Logs rate limit reached — try again after the pause'; pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { feedbackErrors[key] = body.error || ('HTTP ' + res.status); return; }
        const got = { report: body.report || null, reportError: body.reportError || null, generatedAt: body.generatedAt, facts: body.facts };
        const prev = state.feedback[key] || {};
        // v2 §8: the across-kills report and the last fetched night live side by side; `selected`
        // remembers which one the box shows.
        state.feedback[key] = reportCode
            ? Object.assign({}, prev, { night: Object.assign({ code: reportCode }, got), selected: reportCode })
            : Object.assign({}, prev, got, { selected: 'all' });
        try { save(); } catch (err) { feedbackErrors[key] = 'Report shown but could not be saved locally: ' + err.message; }
    } catch (err) {
        feedbackErrors[key] = 'Network error: ' + err.message;
    } finally {
        feedbackInFlight.delete(key);
        renderTable();
    }
}
function copyText(text, btn) {
    const done = ok => { const was = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = was; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); return; }
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
}
// The facts sheet's findings as plain text, for when the model wrote nothing usable.
function fallbackReport(facts) {
    const head = facts.night
        ? 'raid night of ' + facts.night.date + ', median parse that night ' + Math.round(facts.night.medianPercent)
        : 'median parse ' + Math.round(facts.tier.medianPercent);
    const lines = [facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + facts.tier.zoneName + ', ' + head];
    // Mirrors vet-feedback.js's buildPrompt: label the section by metric so a healer does not
    // read "damage" over their HPS findings.
    const holdingBackHeading = facts.player.metric === 'hps' ? "What's holding your healing back" : "What's holding your damage back";
    // Minor 14: a bad-pull-only player has empty overall.findings and overall.positives. Skip each
    // heading whose list is empty rather than rendering it bare, and when both are empty say so in
    // one line — this is the path a leader sees on an OpenAI outage, so it has to read well alone.
    if (facts.overall.findings.length) {
        lines.push('', holdingBackHeading);
        facts.overall.findings.forEach((f, i) => lines.push((i + 1) + '. ' + f.text));
    }
    if (facts.overall.positives.length) lines.push('', "What's fine", facts.overall.positives.join('. ') + '.');
    if (facts.overall.ceiling && facts.overall.ceiling.length) {
        lines.push('', 'Where you stand');
        facts.overall.ceiling.forEach(c => lines.push(c.name + ': you ' + c.me + ', players at your item level ' + c.dps + ', the best at your item level ' + c.topDps));
    }
    if (!facts.overall.findings.length && !facts.overall.positives.length) {
        lines.push('', facts.overall.badPulls.length ? 'Nothing to flag beyond the bad pulls below.' : 'Nothing to flag.');
    }
    if (facts.overall.badPulls.length) { lines.push('', 'Not on you'); facts.overall.badPulls.forEach(b => lines.push(b.name + (b.date ? ' ' + b.date : '') + ' (' + b.rankPercent + '): ' + b.reason)); }
    return lines.join('\n');
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
    try { save(); } catch (err) { state.errors[r.name.toLowerCase()] = 'Could not save locally: ' + err.message; }
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
function removePlayer(name) {
    const key = name.toLowerCase();
    state.players = state.players.filter(p => p.name.toLowerCase() !== key);
    delete state.profiles[key]; delete state.errors[key];
    delete state.feedback[key]; delete feedbackErrors[key];
    queue = queue.filter(k => k !== key);
    rosterNotice = null;
    save(); renderTable();
}
function removeAll() {
    state.players = [];
    state.profiles = {};
    state.errors = {};
    state.feedback = {};
    clearFeedbackErrors();
    queue = [];
    expanded = null;
    rosterNotice = null;
    // save() can throw (e.g. QuotaExceededError); surface it as a status, same as loadRoster's
    // own guarded save — never throw or alert.
    try { save(); } catch (err) { rosterNotice = 'Could not save locally: ' + err.message; }
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
        ['gs', 'ilvl', 'hit', 'expertise', 'defense', 'parse', 'enchants', 'sockets', 'stale'].forEach(k => {
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
        const count = v => rs.filter(r => r.verdict === v).length;
        const pending = rs.filter(r => r.pending).length;
        text = count('pass') + ' pass · ' + count('warn') + ' warn · ' + count('fail') + ' fail · ' +
            count('unverified') + ' unverified · ' + count('error') + ' error' + (pending ? ' · ' + pending + ' fetching' : '');
    }
    el.textContent = rosterNotice ? text + ' — ' + rosterNotice : text;
}
function toggleDetail(key) { expanded = expanded === key ? null : key; renderTable(); }
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
function factsTable(facts) {
    const t = document.createElement('table');
    t.className = 'facts-table';
    // Minor 11 / carried finding: label the column by metric so a healer's HPS is not shown under
    // a header literally saying "DPS" (the same mislabelling the me.dps -> me.amount rename in
    // vet-feedback.js was meant to remove, just moved from the model's prose into this header).
    const metricLabel = facts.player.metric === 'hps' ? 'HPS' : 'DPS';
    t.innerHTML = '<tr><th>Boss</th><th>Parse</th><th>Length</th><th>Active</th><th>Raid rank</th><th>' + metricLabel + ' vs band</th><th>Crit vs band</th><th>Pull consumables</th><th>Log</th></tr>';
    const multi = new Set(facts.kills.map(k => k.name)).size < facts.kills.length;
    facts.kills.forEach(k => {
        const tr = document.createElement('tr');
        if (k.fight.badPull) { tr.className = 'bad-pull'; tr.title = k.fight.badPullReason; }
        const ref = k.reference;
        const topMe = k.me.abilities[0], topRef = ref && topMe ? ref.abilities.find(a => a.name === topMe.name) : null;
        const fmt = x => (x == null ? '—' : x);
        const cells = [
            escapeHtml(k.name) + (k.killsOnBoss > 1 ? ' <span class="cell-unknown">(kill ' + escapeHtml(String(k.killIndex)) + ' of ' + escapeHtml(String(k.killsOnBoss)) + ' kills)</span>' : '') +
                (k.fight.badPull ? ' <span class="cell-unknown">(bad pull)</span>' : '') +
                (multi && k.date ? ' <span class="cell-unknown">' + escapeHtml(k.date) + '</span>' : ''),
            fmt(k.rankPercent == null ? null : Math.round(k.rankPercent)),
            fmt(k.fight.durationSec == null ? null : Math.round(k.fight.durationSec) + 's') + (ref && ref.durationSec != null ? ' / ' + Math.round(ref.durationSec) + 's' : ''),
            fmt(k.me.activePercent == null ? null : k.me.activePercent + '%'),
            k.fight.raidGroupRank ? k.fight.raidGroupRank + ' of ' + k.fight.raidGroupCount : '—',
            // Defensive rather than a live bug today: a reference only exists once >= 3 in-band
            // ranks were collected, and both fields are medians over that non-empty array. Guarded
            // anyway to match the fmt() treatment the neighbouring cells get.
            fmt(k.me.amount) + (ref && ref.dps != null ? ' / ' + ref.dps : ''),
            topMe && topMe.critPercent != null ? escapeHtml(topMe.name) + ' ' + topMe.critPercent + '%' + (topRef && topRef.critPercent != null ? ' / ' + topRef.critPercent + '%' : '') : '—',
            k.me.consumablesKnown ? (k.me.consumablesAtPull.length ? escapeHtml(k.me.consumablesAtPull.join(', ')) : '<span class="slot-missing">none</span>') : '<span class="cell-unknown">unknown</span>',
            '<a href="' + escapeHtml(k.wclUrl) + '" target="_blank" rel="noopener">WCL</a>',
        ];
        tr.innerHTML = cells.map(c => '<td>' + c + '</td>').join('');
        t.appendChild(tr);
    });
    return t;
}
function feedbackBox(r) {
    const box = document.createElement('div');
    box.className = 'feedback-box';
    const fb = state.feedback[r.key];
    const busy = feedbackInFlight.has(r.key);
    // v2 §8: the default (across-kills) sheet lists the player's raid nights; the select picks
    // which report the box shows and which one the button fetches.
    const nights = fb && fb.facts && Array.isArray(fb.facts.nights) ? fb.facts.nights : [];
    const selected = fb && fb.selected && fb.selected !== 'all' && nights.some(n => n.code === fb.selected) ? fb.selected : 'all';
    const shown = selected === 'all' ? fb : (fb.night && fb.night.code === selected ? fb.night : null);
    if (nights.length) {
        const sel = document.createElement('select');
        sel.className = 'feedback-night';
        sel.innerHTML = '<option value="all">Across kills</option>' + nights.map(n =>
            '<option value="' + escapeHtml(n.code) + '">' + escapeHtml(n.date + ' · ' + n.bosses.length + (n.bosses.length === 1 ? ' boss' : ' bosses') + ' · median ' + Math.round(n.medianPercent)) + '</option>').join('');
        sel.value = selected;
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', e => { e.stopPropagation(); fb.selected = sel.value; try { save(); } catch (err) { feedbackErrors[r.key] = 'Could not save locally: ' + err.message; } renderTable(); });
        box.appendChild(sel);
    }
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = busy ? 'Analysing…' : (shown ? 'Refresh report' : 'Feedback report');
    btn.disabled = busy || !r.profile.parses;
    if (!r.profile.parses) btn.title = 'No parses to analyse';
    btn.addEventListener('click', e => { e.stopPropagation(); requestFeedback(r.key, selected === 'all' ? null : selected); });
    box.appendChild(btn);
    if (feedbackErrors[r.key]) box.insertAdjacentHTML('beforeend', '<div class="status error feedback-status">' + escapeHtml(feedbackErrors[r.key]) + '</div>');
    if (!shown) return box;
    const text = shown.report || (shown.facts ? fallbackReport(shown.facts) : '');
    if (shown.reportError) box.insertAdjacentHTML('beforeend', '<div class="status feedback-status">' + escapeHtml(shown.reportError) + '</div>');
    const pre = document.createElement('pre');
    pre.className = 'feedback-report';
    pre.textContent = text;
    box.appendChild(pre);
    const actions = document.createElement('div');
    actions.className = 'feedback-actions';
    const copy = document.createElement('button');
    copy.className = 'btn btn-primary'; copy.textContent = 'Copy';
    copy.addEventListener('click', e => { e.stopPropagation(); copyText(text, copy); });
    actions.appendChild(copy);
    if (shown.generatedAt) actions.insertAdjacentHTML('beforeend', '<span class="status">' + escapeHtml(new Date(shown.generatedAt).toLocaleString()) + '</span>');
    box.appendChild(actions);
    if (shown.facts) {
        const det = document.createElement('details');
        det.innerHTML = '<summary>Facts</summary>';
        const ceiling = shown.facts.overall && Array.isArray(shown.facts.overall.ceiling) ? shown.facts.overall.ceiling : [];
        if (ceiling.length) det.insertAdjacentHTML('beforeend', '<div class="status feedback-ceiling">Where you stand: ' + ceiling.map(c =>
            escapeHtml(c.name) + ' ' + escapeHtml(String(c.me)) + ' vs ' + escapeHtml(String(c.dps)) + ' typical, ' + escapeHtml(String(c.topDps)) + ' best at your item level').join(' · ') + '</div>');
        det.appendChild(factsTable(shown.facts));
        box.appendChild(det);
    }
    return box;
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
    } else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No parses.</div>');
    if (p.lastSeen) parseBox.insertAdjacentHTML('beforeend', '<div class="status">Last seen: ' + escapeHtml(new Date(p.lastSeen.timestamp).toLocaleDateString()) + ' — ' + escapeHtml(p.lastSeen.fightName || '') + '</div>');
    if (p.missing && p.missing.length) parseBox.insertAdjacentHTML('beforeend', '<div class="warn">' + p.missing.map(escapeHtml).join('<br>') + '</div>');
    parseBox.appendChild(feedbackBox(r));
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
        state.profiles = {}; state.errors = {}; state.feedback = {}; clearFeedbackErrors(); save(); renderTable();
        state.players.forEach(p => enqueue(p.name, true));
    });
    document.getElementById('realmInput').addEventListener('change', onRealmChange);
    document.getElementById('regionInput').addEventListener('change', onRealmChange);
    document.getElementById('loadRosterBtn').addEventListener('click', loadRoster);
    document.getElementById('removeAllBtn').addEventListener('click', removeAll);
    // Resume anything not yet fetched (e.g. after a reload mid-queue).
    state.players.forEach(p => enqueue(p.name, false));
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
window.vetFeedback = requestFeedback;
