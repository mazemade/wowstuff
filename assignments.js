/* global AssignmentsEngine */
'use strict';
const E = AssignmentsEngine;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';

let state = {
    sources: { addon: null, rh: null }, // Player[] or null per source
    manual: [],                          // manually added/edited players
    excluded: [],                        // names removed from the roster by hand
    overrides: {},                       // dutyId -> {player?, target?}
    cc: null,                            // [{mark, ability, player}] or null = engine defaults
    pings: true,
    title: '',
};
let linkMap = {};   // discordId -> character name (persists across roster resets)
let roster = [];
let mergeInfo = { unmatched: { addon: [], raidhelper: [] }, mismatches: [] };
let sheet = null;
let activeTab = 'discord';

function loadState() {
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch (e) { /* fresh start */ }
    try { linkMap = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { linkMap = {}; }
}
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LINK_KEY, JSON.stringify(linkMap));
}

function recompute() {
    mergeInfo = E.mergeRosters(state.sources.addon || [], state.sources.rh || [], linkMap);
    const base = mergeInfo.roster.filter(p =>
        !state.excluded.includes(p.name) && !state.manual.some(m => m.name === p.name));
    const manual = state.manual.filter(m => !state.excluded.includes(m.name)).map(m => {
        const src = mergeInfo.roster.find(p => p.name === m.name);
        return Object.assign({}, m, { discordId: src ? src.discordId : m.discordId });
    });
    roster = base.concat(manual);
    const result = E.autoAssign(roster, state.overrides);
    sheet = Object.assign({}, result, { cc: state.cc || E.defaultCC(roster) });
}

function renderAll() {
    recompute();
    saveState();
    renderRoster();
    renderLinkPanel();
    renderAssignments();
    renderOutput();
}

function setStatus(msg, isError) {
    const el = document.getElementById('importStatus');
    el.textContent = msg;
    el.className = 'status' + (isError ? ' error' : '');
}

// --- Import handlers ---
async function importRaidHelper() {
    const raw = document.getElementById('rhInput').value.trim();
    const m = raw.match(/(\d{5,25})/);
    if (!m) { setStatus('Could not find an event ID in that link.', true); return; }
    setStatus('Fetching event…');
    try {
        const res = await fetch('/api/raidhelper/' + m[1]);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || ('HTTP ' + res.status));
        }
        const parsed = E.parseRaidHelper(await res.json());
        state.sources.rh = parsed.players;
        if (parsed.title) state.title = parsed.title;
        let msg = 'Imported ' + parsed.players.length + ' signups';
        if (parsed.excluded.length) msg += ' · excluded: ' + parsed.excluded.map(x => x.name + ' (' + x.reason + ')').join(', ');
        if (parsed.errors.length) msg += ' · ' + parsed.errors.join('; ');
        setStatus(msg, parsed.errors.length > 0);
        renderAll();
    } catch (err) {
        setStatus('Raid-Helper import failed: ' + err.message, true);
    }
}

function importAddon() {
    const parsed = E.parseAddonExport(document.getElementById('addonInput').value);
    if (!parsed.players.length) { setStatus('No players found in that export.', true); return; }
    state.sources.addon = parsed.players;
    let msg = 'Imported ' + parsed.players.length + ' players from addon scan';
    if (parsed.errors.length) msg += ' · ' + parsed.errors.join('; ');
    setStatus(msg, parsed.errors.length > 0);
    renderAll();
}

// --- Manual add/edit ---
function openManualForm(player) {
    document.getElementById('manualForm').classList.remove('hidden');
    const clsSel = document.getElementById('manualClass');
    clsSel.innerHTML = Object.keys(E.SPEC_TREES).map(c => '<option value="' + c + '">' + c + '</option>').join('');
    if (player) {
        document.getElementById('manualName').value = player.name;
        clsSel.value = player.class;
    }
    fillManualSpecs(player ? player.spec : null);
}
function fillManualSpecs(selected) {
    const cls = document.getElementById('manualClass').value;
    const specSel = document.getElementById('manualSpec');
    specSel.innerHTML = E.SPEC_TREES[cls].map(s => '<option value="' + s + '">' + s + '</option>').join('');
    if (selected && E.SPEC_TREES[cls].includes(selected)) specSel.value = selected;
}
function saveManualPlayer() {
    const name = document.getElementById('manualName').value.trim();
    if (!name) { setStatus('Name is required.', true); return; }
    state.manual = state.manual.filter(m => m.name !== name);
    state.manual.push({
        name,
        class: document.getElementById('manualClass').value,
        spec: document.getElementById('manualSpec').value,
        flags: [], source: 'manual',
    });
    state.excluded = state.excluded.filter(n => n !== name);
    document.getElementById('manualForm').classList.add('hidden');
    document.getElementById('manualName').value = '';
    renderAll();
}
function removePlayer(name) {
    state.excluded.push(name);
    Object.keys(state.overrides).forEach(id => {
        if (state.overrides[id] && state.overrides[id].player === name) delete state.overrides[id].player;
        if (state.overrides[id] && state.overrides[id].target === name) delete state.overrides[id].target;
    });
    renderAll();
}

// --- Roster rendering ---
function renderRoster() {
    document.getElementById('rosterCount').textContent = roster.length;
    const box = document.getElementById('rosterPills');
    box.innerHTML = '';
    roster.forEach(p => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.style.background = E.CLASS_COLORS[p.class] || '#999';
        const flags = (p.flags || [])
            .map(f => f === 'spec-unknown' ? '?spec' : f === 'spec-ambiguous' ? '~spec' : f)
            .map(f => '<span class="flag">' + f + '</span>').join('');
        pill.innerHTML = p.name + ' · ' + (p.spec || '?') + flags +
            ' <button title="Edit" data-act="edit">✎</button><button title="Remove" data-act="del">✕</button>';
        pill.querySelector('[data-act=edit]').addEventListener('click', () => openManualForm(p));
        pill.querySelector('[data-act=del]').addEventListener('click', () => removePlayer(p.name));
        box.appendChild(pill);
    });
}

// --- Identity linking (unmatched Raid-Helper signups -> addon characters) ---
function renderLinkPanel() {
    const panel = document.getElementById('linkPanel');
    const needsLink = mergeInfo.unmatched.raidhelper;
    const candidates = mergeInfo.unmatched.addon;
    if (!needsLink.length || !candidates.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="warn">Unlinked Raid-Helper signups — link them to characters to enable @pings:</div>';
    needsLink.forEach(rh => {
        const row = document.createElement('div');
        row.className = 'link-row';
        const opts = candidates.map(p => '<option value="' + p.name + '">' + p.name + '</option>').join('');
        row.innerHTML = '<span>' + rh.name + ' (' + rh.class + ')</span> ▸ <select>' + opts +
            '</select> <button class="btn">Link</button>';
        row.querySelector('button').addEventListener('click', () => {
            linkMap[rh.discordId] = row.querySelector('select').value;
            renderAll();
        });
        panel.appendChild(row);
    });
}

// --- Stubs completed in later tasks ---
function renderAssignments() { /* Task 10 */ }
function renderOutput() { /* Task 11 */ }

// --- Wiring ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    document.getElementById('rhImportBtn').addEventListener('click', importRaidHelper);
    document.getElementById('addonImportBtn').addEventListener('click', importAddon);
    document.getElementById('addPlayerBtn').addEventListener('click', () => openManualForm(null));
    document.getElementById('manualClass').addEventListener('change', () => fillManualSpecs(null));
    document.getElementById('manualSaveBtn').addEventListener('click', saveManualPlayer);
    document.getElementById('manualCancelBtn').addEventListener('click', () =>
        document.getElementById('manualForm').classList.add('hidden'));
    document.getElementById('clearRosterBtn').addEventListener('click', () => {
        if (!confirm('Clear the whole roster and assignments? (Name links are kept.)')) return;
        state = { sources: { addon: null, rh: null }, manual: [], excluded: [], overrides: {}, cc: null, pings: state.pings, title: '' };
        renderAll();
    });
    document.getElementById('autoAssignBtn').addEventListener('click', () => {
        state.overrides = {};
        state.cc = null;
        renderAll();
    });
    renderAll();
});
