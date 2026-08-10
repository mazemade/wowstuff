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
let editingOriginalName = null; // name the manual form was opened for, so a rename can exclude the old entry

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
        if (!parsed.players.length) {
            let msg = 'No usable signups found in that event.';
            if (parsed.excluded.length) msg += ' Excluded: ' + parsed.excluded.map(x => x.name + ' (' + x.reason + ')').join(', ');
            if (parsed.errors.length) msg += ' · ' + parsed.errors.join('; ');
            setStatus(msg, true);
            return;
        }
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
    editingOriginalName = player ? player.name : null;
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
    if (editingOriginalName && editingOriginalName !== name && !state.excluded.includes(editingOriginalName)) {
        state.excluded.push(editingOriginalName);
    }
    editingOriginalName = null;
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
    if (state.cc) {
        state.cc.forEach(c => { if (c.player === name) c.player = null; });
    }
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
        pill.appendChild(document.createTextNode(p.name + ' · ' + (p.spec || '?')));
        (p.flags || [])
            .map(f => f === 'spec-unknown' ? '?spec' : f === 'spec-ambiguous' ? '~spec' : f)
            .forEach(f => {
                const flagEl = document.createElement('span');
                flagEl.className = 'flag';
                flagEl.textContent = f;
                pill.appendChild(flagEl);
            });
        pill.appendChild(document.createTextNode(' '));
        const editBtn = document.createElement('button');
        editBtn.title = 'Edit';
        editBtn.dataset.act = 'edit';
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', () => openManualForm(p));
        const delBtn = document.createElement('button');
        delBtn.title = 'Remove';
        delBtn.dataset.act = 'del';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => removePlayer(p.name));
        pill.appendChild(editBtn);
        pill.appendChild(delBtn);
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
    panel.innerHTML = '';
    const warnDiv = document.createElement('div');
    warnDiv.className = 'warn';
    warnDiv.textContent = 'Unlinked Raid-Helper signups — link them to characters to enable @pings:';
    panel.appendChild(warnDiv);
    needsLink.forEach(rh => {
        const row = document.createElement('div');
        row.className = 'link-row';
        const label = document.createElement('span');
        label.textContent = rh.name + ' (' + rh.class + ')';
        row.appendChild(label);
        row.appendChild(document.createTextNode(' ▸ '));
        const select = document.createElement('select');
        candidates.forEach(p => select.appendChild(new Option(p.name, p.name)));
        row.appendChild(select);
        row.appendChild(document.createTextNode(' '));
        const linkBtn = document.createElement('button');
        linkBtn.className = 'btn';
        linkBtn.textContent = 'Link';
        linkBtn.addEventListener('click', () => {
            linkMap[rh.discordId] = select.value;
            renderAll();
        });
        row.appendChild(linkBtn);
        panel.appendChild(row);
    });
}

// --- Assignments rendering ---
function eligibleForDuty(dutyId) {
    if (dutyId.startsWith('innervate:')) return roster.filter(p => p.class === 'DRUID');
    if (dutyId.startsWith('soulstone:')) return roster.filter(p => p.class === 'WARLOCK');
    const entry = E.DEBUFF_CATALOG.find(e => e.id === dutyId);
    if (!entry) return roster;
    return roster.filter(p => p.class === entry.class || (entry.fallback && p.class === entry.fallback.class));
}

function makeSelect(options, current, allowEmpty, onChange) {
    const sel = document.createElement('select');
    if (allowEmpty) sel.appendChild(new Option('— unassigned —', ''));
    options.forEach(o => sel.appendChild(new Option(o.label, o.value)));
    sel.value = current || '';
    sel.addEventListener('change', () => onChange(sel.value || null));
    return sel;
}

function playerOptions(players) {
    return players.map(p => ({ value: p.name, label: p.name + ' (' + (p.spec || '?') + ')' }));
}

function dutyRow(d) {
    const row = document.createElement('div');
    row.className = 'assign-row';
    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name;
    row.appendChild(label);

    if (d.id.startsWith('curse:')) { // personal curse: fixed player, no dropdown
        const who = document.createElement('span');
        who.textContent = d.player;
        row.appendChild(who);
        return row;
    }

    row.appendChild(makeSelect(playerOptions(eligibleForDuty(d.id)), d.player, true, val => {
        state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { player: val });
        renderAll();
    }));

    if (d.id.startsWith('innervate:') || d.id.startsWith('soulstone:')) {
        const on = document.createElement('span');
        on.textContent = 'on';
        row.appendChild(on);
        const targetOpts = playerOptions(roster);
        if (d.id.startsWith('innervate:')) targetOpts.push({ value: 'HEALER_RESERVE', label: '💚 healer in need' });
        row.appendChild(makeSelect(targetOpts, d.target, true, val => {
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { target: val });
            renderAll();
        }));
    }
    return row;
}

function ccRow(c, index) {
    const row = document.createElement('div');
    row.className = 'assign-row';
    function materialize() { if (!state.cc) state.cc = sheet.cc.map(x => Object.assign({}, x)); return state.cc; }

    const markOpts = E.MARKS.map(m => ({ value: m, label: E.MARK_EMOJI[m] + ' ' + m }));
    row.appendChild(makeSelect(markOpts, c.mark, false, val => { materialize()[index].mark = val; renderAll(); }));

    const abilityOpts = E.CC_ABILITIES.map(a => ({ value: a.id, label: a.name }));
    row.appendChild(makeSelect(abilityOpts, c.ability, false, val => {
        const cc = materialize();
        cc[index].ability = val;
        cc[index].player = null; // class changed, old player likely invalid
        renderAll();
    }));

    const ability = E.CC_ABILITIES.find(a => a.id === c.ability);
    const pool = ability ? roster.filter(p => p.class === ability.class) : roster;
    row.appendChild(makeSelect(playerOptions(pool), c.player, true, val => { materialize()[index].player = val; renderAll(); }));

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = '✕';
    del.addEventListener('click', () => { materialize().splice(index, 1); renderAll(); });
    row.appendChild(del);
    return row;
}

function renderAssignments() {
    const uncoveredBox = document.getElementById('uncoveredBox');
    if (sheet.uncovered.length && roster.length) {
        uncoveredBox.classList.remove('hidden');
        uncoveredBox.textContent = '⚠ Uncovered: ' + sheet.uncovered.map(u => u.name).join(', ');
    } else {
        uncoveredBox.classList.add('hidden');
    }

    const debuffBox = document.getElementById('debuffRows');
    debuffBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'debuffs').forEach(d => debuffBox.appendChild(dutyRow(d)));

    const passiveBox = document.getElementById('passiveRows');
    passiveBox.innerHTML = '';
    sheet.passives.forEach(ps => {
        const row = document.createElement('div');
        row.className = 'assign-row passive';
        row.textContent = ps.name + ' — auto-covered by ' + ps.player;
        passiveBox.appendChild(row);
    });

    const cdBox = document.getElementById('cooldownRows');
    cdBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'cooldowns').forEach(d => cdBox.appendChild(dutyRow(d)));

    const ccBox = document.getElementById('ccRows');
    ccBox.innerHTML = '';
    sheet.cc.forEach((c, i) => ccBox.appendChild(ccRow(c, i)));
}

// --- Output tabs / share link ---
function buildShareLink() {
    const payload = { title: state.title, sheet };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return location.origin + location.pathname.replace('assignments.html', 'assignments-view.html') + '?data=' + encoded;
}

function renderOutput() {
    const box = document.getElementById('outputBox');
    document.getElementById('pingToggle').style.display = activeTab === 'discord' ? '' : 'none';
    if (!roster.length) { box.textContent = 'Import a roster first.'; return; }
    if (activeTab === 'discord') {
        box.textContent = E.buildDiscord(roster, sheet, { pings: state.pings, title: state.title });
    } else if (activeTab === 'raid') {
        box.textContent = E.buildRaidLines(roster, sheet).join('\n');
    } else if (activeTab === 'whispers') {
        box.textContent = E.buildWhispers(roster, sheet).join('\n');
    } else if (activeTab === 'share') {
        box.textContent = buildShareLink();
    }
}

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
    document.getElementById('addCcBtn').addEventListener('click', () => {
        if (!state.cc) state.cc = sheet.cc.map(x => Object.assign({}, x));
        state.cc.push({ mark: 'star', ability: 'polymorph', player: null });
        renderAll();
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            renderOutput();
        });
    });
    const pingCheckbox = document.getElementById('pingCheckbox');
    pingCheckbox.checked = state.pings;
    pingCheckbox.addEventListener('change', () => { state.pings = pingCheckbox.checked; renderAll(); });
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const btn = document.getElementById('copyBtn');
        try {
            if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
            await navigator.clipboard.writeText(document.getElementById('outputBox').textContent);
            btn.textContent = '✅ Copied';
        } catch (e) {
            btn.textContent = '⚠ Copy failed — select the text and copy manually';
        }
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
    });
    renderAll();
});
