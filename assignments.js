/* global AssignmentsEngine, WclMult */
'use strict';
const E = AssignmentsEngine;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';

let state = {
    sources: { addon: null, rh: null }, // Player[] or null per source
    manual: [],                          // manually added/edited players
    excluded: [],                        // names removed from the roster by hand
    overrides: {},                       // dutyId -> {player?, players?, target?}
    cc: null,                            // [{mark, ability, player}] or null = engine defaults
    pings: true,
    title: '',
    blessings: {},                       // '<paladin>|<CLASS>' -> blessing name or null
    wcl: { server: '', region: 'eu' },   // Warcraft Logs realm slug + region for parse fetching
};
let linkMap = {};   // discordId -> character name (persists across roster resets)
let roster = [];
let mergeInfo = { unmatched: { addon: [], raidhelper: [] }, mismatches: [] };
let sheet = null;
let activeTab = 'discord';
let editingOriginalName = null; // name the manual form was opened for, so a rename can exclude the old entry
let wclStatus = '';             // last WCL fetch outcome; lives outside renderGroups() so the rerender that follows a fetch does not wipe it

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
    roster = E.deriveRoster(state, linkMap);

    // Reconcile stale references left behind by renames, removals or re-imports:
    // any CC/override entry pointing at a name no longer on the roster is cleared here,
    // in the one place every mutation path (edit, remove, re-import) always passes through.
    const names = new Set(roster.map(p => p.name));
    if (state.cc) state.cc.forEach(c => { if (c.player && !names.has(c.player)) c.player = null; });
    Object.values(state.overrides).forEach(o => {
        if (o.player && !names.has(o.player)) delete o.player;
        if (o.target && !names.has(o.target) && o.target !== 'HEALER_RESERVE') delete o.target;
        if (o.players) {
            const kept = o.players.filter(n => names.has(n));
            // Only fall back to auto-assignment when the sweep is what emptied the list. A list
            // the lead emptied with ✕ stays empty on purpose — that row is meant to be gone.
            if (!kept.length && o.players.length) delete o.players;
            else o.players = kept;
        }
    });
    // overrides.healing is keyed by player name, not duty id, so the generic sweep above
    // cannot see its stale names — sweep it the same way blessings cells are swept.
    if (state.overrides.healing) {
        Object.keys(state.overrides.healing).forEach(n => {
            if (!names.has(n)) delete state.overrides.healing[n];
        });
    }
    // Drop cells belonging to a paladin who is no longer on the roster, the same way
    // override players are dropped — otherwise a re-import resurrects a stale grid.
    // Split on the LAST pipe: class tokens never contain one, but a hand-typed name might,
    // and splitting on the first would silently delete that paladin's cells on every render.
    Object.keys(state.blessings || {}).forEach(k => {
        if (!names.has(k.slice(0, k.lastIndexOf('|')))) delete state.blessings[k];
    });

    // Per-player tuning the optimizer reads (spec §6). Keyed by name like state.overrides, so
    // it survives a re-import; the engine treats missing fields as mt:false / mult:1.
    if (!state.playerMeta) state.playerMeta = {};
    roster.forEach(p => {
        const m = state.playerMeta[p.name];
        if (m) { p.mt = !!m.mt; if (typeof m.mult === 'number' && m.mult > 0) p.mult = m.mult; }
    });

    const result = E.autoAssign(roster, state.overrides);
    sheet = Object.assign({}, result, {
        cc: state.cc || E.defaultCC(roster),
        blessings: E.proposeBlessings(roster, state.blessings),
    });
}

function renderAll() {
    recompute();
    saveState();
    renderRoster();
    renderLinkPanel();
    renderAssignments();
    renderGroups();
    renderBlessings();
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
    document.getElementById('manualName').value = player ? player.name : '';
    if (player) clsSel.value = player.class;
    fillManualSpecs(player ? player.spec : null);
}
function fillManualSpecs(selected) {
    const cls = document.getElementById('manualClass').value;
    const specSel = document.getElementById('manualSpec');
    specSel.innerHTML = E.SELECTABLE_SPECS[cls].map(s => '<option value="' + s + '">' + s + '</option>').join('');
    if (selected && E.SELECTABLE_SPECS[cls].includes(selected)) specSel.value = selected;
}
function saveManualPlayer() {
    const name = document.getElementById('manualName').value.trim();
    if (!name) { setStatus('Name is required.', true); return; }
    state.manual = state.manual.filter(m => m.name !== name);
    state.manual.push({
        name,
        class: document.getElementById('manualClass').value,
        spec: document.getElementById('manualSpec').value,
        flags: [], source: 'manual', group: null, race: null,
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
    // Stale cc/override references to `name` are cleaned up by recompute()'s
    // roster-membership sweep (called from renderAll() below), so no cleanup needed here.
    state.excluded.push(name);
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
    const classes = E.providersOf(entry).map(pr => pr.class);
    return roster.filter(p => classes.indexOf(p.class) !== -1);
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

    if (d.qualifier) {
        const q = document.createElement('span');
        q.className = 'duty-qualifier';
        q.textContent = '(' + d.qualifier + ')';
        row.appendChild(q);
    }

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
    if (d.caution) {
        const note = document.createElement('span');
        note.className = 'duty-caution';
        note.title = d.caution;
        note.textContent = 'ⓘ';
        row.appendChild(note);
    }
    return row;
}

function rotationRow(d) {
    const wrap = document.createElement('div');
    wrap.className = 'assign-row rotation';

    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name;
    if (d.note) label.title = d.note;
    wrap.appendChild(label);

    const list = document.createElement('div');
    list.className = 'rotation-list';
    d.players.forEach((name, i) => {
        const chip = document.createElement('span');
        chip.className = 'rotation-chip';
        chip.textContent = (i + 1) + '. ' + name;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'chip-btn';
        up.textContent = '↑';
        up.disabled = i === 0;
        up.setAttribute('aria-label', 'Move ' + name + ' earlier');
        up.addEventListener('click', () => {
            const order = d.players.slice();
            order.splice(i - 1, 0, order.splice(i, 1)[0]);
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { players: order });
            renderAll();
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'chip-btn';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Remove ' + name + ' from ' + d.name);
        del.addEventListener('click', () => {
            // Remove by index, not by name: a roster merged from the addon, Raid-Helper and
            // manual entries can hold two players with the same name, and filtering by name
            // would delete both chips.
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id],
                { players: d.players.filter((n, j) => j !== i) });
            renderAll();
        });

        chip.appendChild(up);
        chip.appendChild(del);
        list.appendChild(chip);
    });
    wrap.appendChild(list);
    return wrap;
}

function healingRow(d) {
    const wrap = document.createElement('div');
    wrap.className = 'assign-row rotation';
    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name + (d.targets && d.targets.length ? ' (' + d.targets.join(', ') + ')' : '');
    if (d.note) label.title = d.note;
    wrap.appendChild(label);
    const list = document.createElement('div');
    list.className = 'rotation-list';
    d.players.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'rotation-chip';
        chip.textContent = name;
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'chip-btn';
        move.textContent = '⇄';
        move.setAttribute('aria-label', 'Move ' + name + ' to ' + (d.id === 'tankheal' ? 'raid' : 'tank') + ' healing');
        move.addEventListener('click', () => {
            const map = Object.assign({}, state.overrides.healing);
            map[name] = d.id === 'tankheal' ? 'raid' : 'tank';
            state.overrides.healing = map;
            renderAll();
        });
        chip.appendChild(move);
        list.appendChild(chip);
    });
    wrap.appendChild(list);
    return wrap;
}

function markIcon(mark) {
    const span = document.createElement('span');
    span.className = 'rt-icon rt-' + mark;
    return span;
}

// WoW's raid-target menu: all eight marks visible, one click to set.
// A <select> can't show images in its options, hence buttons.
function markPicker(current, onChange) {
    const box = document.createElement('div');
    box.className = 'mark-picker';
    E.MARKS.forEach(m => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', capitalizeMark(m));
        btn.setAttribute('aria-pressed', String(m === current));
        btn.title = capitalizeMark(m);
        btn.appendChild(markIcon(m));
        btn.addEventListener('click', () => onChange(m));
        box.appendChild(btn);
    });
    return box;
}

function capitalizeMark(m) { return m.charAt(0).toUpperCase() + m.slice(1); }

function ccRow(c, index) {
    const row = document.createElement('div');
    row.className = 'assign-row';
    function materialize() { if (!state.cc) state.cc = sheet.cc.map(x => Object.assign({}, x)); return state.cc; }

    row.appendChild(markPicker(c.mark, val => { materialize()[index].mark = val; renderAll(); }));

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

const ROLE_LABELS = { melee: 'Melee', casters: 'Casters', healers: 'Healers', ranged: 'Hunters', tanks: 'Tanks' };

// These deltas are small by nature — a genuine alternative can sit at -0.03% — so one decimal
// would print "-0.0%" and read as "no difference". Widen the precision until a non-zero digit
// survives, so a real trade-off is never displayed as a wash.
function fmtPct(x) {
    for (const dp of [1, 2, 3]) {
        if (Math.abs(x) >= 0.5 / Math.pow(10, dp)) return x.toFixed(dp);
    }
    return x.toFixed(3);
}

// Spec D5: which encounter duration the weights should assume. Farm is the default — most
// pulls are farm pulls — and the fight-length control shows the measured medians once a
// WCL fetch has run. The fallbacks are the engine's anchor durations.
function activeDurationSec() {
    const w = state.wcl || {};
    const mode = (w.fightLen && w.fightLen.mode) || 'farm';
    if (mode === 'custom') return (w.fightLen && w.fightLen.customSec) || 300;
    if (mode === 'long') return (w.durations && w.durations.longSec) || 520;
    return (w.durations && w.durations.farmSec) || 200;
}

// Every multiplier is relative to the rest of the roster (spec §2), so this fetches the whole
// roster first and computes nothing until it is all in.
async function fetchWclMults(btn, statusEl) {
    state.wcl = state.wcl || { server: '', region: 'eu' };
    if (!state.wcl.server) { statusEl.textContent = 'Set the realm slug first.'; return; }
    if (!WclMult.DEFAULT_ZONE) { statusEl.textContent = 'No WCL zone configured.'; return; }
    btn.disabled = true;
    try {
        const eligible = roster.filter(p => (E.BASELINE[E.specKey(p)] || 0) > 0);
        const fetched = [];
        const noLogs = [];    // WCL has no such character, or no parses in this zone at all
        const wrongSpec = []; // has parses, but none on the spec we have them rostered as
        for (let i = 0; i < eligible.length; i++) {
            const p = eligible[i];
            statusEl.textContent = 'Fetching ' + p.name + ' (' + (i + 1) + '/' + eligible.length + ')…';
            const url = '/api/wcl/player?name=' + encodeURIComponent(p.name) +
                '&server=' + encodeURIComponent(state.wcl.server) +
                '&region=' + (state.wcl.region || 'eu') + '&zone=' + WclMult.DEFAULT_ZONE;
            const r = await fetch(url);
            if (r.status === 404) { noLogs.push(p.name); continue; }
            if (!r.ok) throw new Error((await r.json()).error || 'player fetch failed');
            const data = await r.json();
            fetched.push({
                name: p.name, classKey: p.class, specKey: E.specKey(p),
                baseline: E.BASELINE[E.specKey(p)], ranksByEncounter: data.ranksByEncounter,
            });
        }
        statusEl.textContent = 'Computing…';
        const results = WclMult.computeRosterMults({ players: fetched, nowMs: Date.now() });
        const fetchedAt = Date.now();
        const kd = WclMult.rosterKillDurations({ players: fetched, nowMs: fetchedAt });
        state.wcl.durations = { farmSec: kd.farmMedianSec, longSec: kd.longMedianSec, fetchedAt: fetchedAt };
        let filled = 0;
        eligible.forEach(p => {
            const result = results[p.name];
            if (!result) {
                // Separate "WCL never heard of them" from "they log, but never on this spec" —
                // the Anniversary realm has spec labels the engine has no concept of, and a
                // silent gap there is indistinguishable from a typo'd name without this.
                if (noLogs.indexOf(p.name) < 0) {
                    const got = fetched.find(f => f.name === p.name);
                    const hasParses = got && Object.keys(got.ranksByEncounter || {})
                        .some(k => (got.ranksByEncounter[k] || []).length > 0);
                    (hasParses ? wrongSpec : noLogs).push(p.name);
                }
                return;
            }
            const meta = state.playerMeta[p.name] || {};
            const next = Object.assign({}, meta, {
                multAuto: result.mult,
                multInfo: { bosses: result.bosses, fetchedAt: fetchedAt },
            });
            if (WclMult.shouldOverwrite(meta)) next.mult = result.mult;
            state.playerMeta[p.name] = next;
            filled++;
        });
        wclStatus = 'WCL: ' + filled + '/' + eligible.length + ' computed' +
            (noLogs.length ? ' — no logs: ' + noLogs.join(', ') : '') +
            (wrongSpec.length ? ' — no usable parses (wrong spec, too old, or too few raiders on those bosses): ' + wrongSpec.join(', ') : '');
    } catch (err) {
        wclStatus = 'WCL fetch failed: ' + err.message;
    }
    btn.disabled = false;
    saveState();
    renderAll(); // rebuilds the panel; the new status renders from wclStatus
}

function renderGroups() {
    E.setEncounterDuration(activeDurationSec());
    // A rendered AI review critiques one specific layout. If the layout changes underneath
    // it (import, remove, auto-assign) it must not outlive that layout, so clear and rehide
    // it here rather than leave stale advice on screen with nothing marking it stale.
    const reviewBox = document.getElementById('aiReviewBox');
    if (reviewBox) { reviewBox.textContent = ''; reviewBox.classList.add('hidden'); }
    const box = document.getElementById('groupsBox');
    // Every control inside the tuning panel calls renderAll(), which rebuilds this whole
    // box — so the panel's open/closed state must be carried across the rebuild or each
    // click inside it snaps it shut.
    const prevTune = box.querySelector('details.player-tuning');
    const tuneWasOpen = !!(prevTune && prevTune.open);
    box.innerHTML = '';
    if (!roster.length) { box.textContent = 'Import a roster first.'; return; }

    // Collapsed on first render: two rarely-touched dials that the optimizer genuinely needs —
    // which tank is the MT (the survivability floor) and how a player rates against an
    // average one of their spec (the one case gear changes the structural answer).
    const tune = document.createElement('details');
    tune.open = tuneWasOpen;
    tune.className = 'player-tuning';
    const sum = document.createElement('summary');
    sum.textContent = 'Player tuning (MT flag / DPS multiplier)';
    tune.appendChild(sum);
    // WCL performance prefill: realm/region settings, fetch button, last-fetch status.
    state.wcl = state.wcl || { server: '', region: 'eu' };
    const wclRow = document.createElement('div');
    wclRow.className = 'tuning-row wcl-row';
    const srv = document.createElement('input');
    srv.type = 'text';
    srv.placeholder = 'realm-slug';
    srv.value = state.wcl.server || '';
    srv.title = 'Warcraft Logs realm slug, e.g. "spineshatter"';
    srv.addEventListener('change', () => { state.wcl.server = srv.value.trim().toLowerCase(); saveState(); });
    const reg = document.createElement('select');
    ['eu', 'us'].forEach(r => {
        const o = document.createElement('option');
        o.value = r; o.textContent = r.toUpperCase();
        if ((state.wcl.region || 'eu') === r) o.selected = true;
        reg.appendChild(o);
    });
    reg.addEventListener('change', () => { state.wcl.region = reg.value; saveState(); });
    const fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.textContent = 'Fetch from Warcraft Logs';
    fetchBtn.title = 'Prefill multipliers from your last 4 weeks of parses, measured against the rest of this roster. Manual edits survive a refetch.';
    const status = document.createElement('span');
    status.className = 'wcl-status';
    status.textContent = wclStatus;
    fetchBtn.addEventListener('click', () => fetchWclMults(fetchBtn, status));
    wclRow.appendChild(srv); wclRow.appendChild(reg); wclRow.appendChild(fetchBtn); wclRow.appendChild(status);
    tune.appendChild(wclRow);

    // Fight length: the weights are duration-interpolated (spec D1/D5). Farm by default;
    // chips show the roster's measured medians once a WCL fetch has stored them.
    const flRow = document.createElement('div');
    flRow.className = 'tuning-row';
    const flLabel = document.createElement('span');
    flLabel.textContent = 'Fight length: ';
    flRow.appendChild(flLabel);
    const durs = state.wcl.durations || {};
    const fmtSec = s => Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';
    const flMode = (state.wcl.fightLen && state.wcl.fightLen.mode) || 'farm';
    [['farm', 'Farm ' + (durs.farmSec ? '~' + fmtSec(durs.farmSec) : '(~3m)')],
     ['long', 'Long ' + (durs.longSec ? '~' + fmtSec(durs.longSec) : '(Vashj/Kael)')],
     ['custom', 'Custom']].forEach(([m, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        // btn-primary doubles as the "active" state — it is the app's existing accent
        // (#4778eb) and needs no new CSS.
        b.className = 'btn' + (flMode === m ? ' btn-primary' : '');
        b.textContent = label;
        b.title = 'Which kill duration the group weights should assume. Mana buffs (Vampiric Touch, mana totems) are worth far more on long fights.';
        b.addEventListener('click', () => {
            state.wcl.fightLen = Object.assign({}, state.wcl.fightLen, { mode: m });
            saveState(); renderAll();
        });
        flRow.appendChild(b);
    });
    if (flMode === 'custom') {
        const sec = document.createElement('input');
        sec.type = 'number';
        sec.min = '60'; sec.max = '900'; sec.step = '10';
        sec.value = (state.wcl.fightLen && state.wcl.fightLen.customSec) || 300;
        sec.title = 'Encounter duration in seconds (engine clamps to 200–520)';
        sec.addEventListener('change', () => {
            state.wcl.fightLen = Object.assign({}, state.wcl.fightLen, { customSec: parseInt(sec.value, 10) || 300 });
            saveState(); renderAll();
        });
        flRow.appendChild(sec);
    }
    tune.appendChild(flRow);
    roster.forEach(p => {
        const m = state.playerMeta[p.name] || {};
        const row = document.createElement('div');
        row.className = 'tuning-row';
        const label = document.createElement('span');
        label.textContent = p.name;
        label.style.color = E.CLASS_COLORS[p.class];
        const mt = document.createElement('input');
        mt.type = 'checkbox';
        mt.checked = !!m.mt;
        mt.title = 'Main tank — the optimizer guarantees a shaman in this group';
        mt.addEventListener('change', () => {
            state.playerMeta[p.name] = Object.assign({}, state.playerMeta[p.name], { mt: mt.checked });
            renderAll();
        });
        const mult = document.createElement('input');
        mult.type = 'number';
        mult.min = '0.5'; mult.max = '2'; mult.step = '0.01';
        mult.value = typeof m.mult === 'number' ? m.mult : 1;
        const hasWclData = m.multInfo && typeof m.multAuto === 'number';
        mult.title = hasWclData
            ? 'Relative output vs the rest of this roster (gear/skill), spec-corrected'
            : 'No WCL data — 1.0 is the simulated spec baseline, not measured against this roster';
        if (hasWclData) {
            mult.title += ' — WCL: ' + m.multAuto + ' vs this roster, from ' + m.multInfo.bosses +
                ' boss(es), fetched ' + new Date(m.multInfo.fetchedAt).toISOString().slice(0, 10) +
                (typeof m.mult === 'number' && m.mult !== m.multAuto ? ' (manual override kept)' : '');
        }
        mult.addEventListener('change', () => {
            state.playerMeta[p.name] = Object.assign({}, state.playerMeta[p.name], { mult: parseFloat(mult.value) || 1 });
            renderAll();
        });
        row.appendChild(mt); row.appendChild(label); row.appendChild(mult);
        tune.appendChild(row);
    });
    box.appendChild(tune);

    const res = E.proposeGroups(roster);
    res.groups.forEach((g, i) => {
        const card = document.createElement('div');
        card.className = 'group-card';
        const h = document.createElement('h4');
        h.textContent = 'Group ' + (i + 1) + ' — ' + (ROLE_LABELS[g.role] || g.role);
        card.appendChild(h);
        g.players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'group-player';
            row.textContent = p.name + (p.spec ? ' (' + p.spec + ')' : '');
            row.style.color = E.CLASS_COLORS[p.class];
            if (res.marginals && res.marginals[p.name] != null) {
                row.title = 'Moving ' + p.name + ' to their best other seat costs '
                    + fmtPct(res.marginals[p.name]) + '% raid DPS';
            }
            card.appendChild(row);
        });
        g.notes.forEach(t => {
            const n = document.createElement('div');
            n.className = 'group-note';
            n.textContent = '✓ ' + t;
            card.appendChild(n);
        });
        box.appendChild(card);
    });
    // Keep the tool an argument rather than an oracle (spec §8): show what the layout scores,
    // whether any floor is breached, and the nearest alternatives it rejected.
    if (typeof res.score === 'number') {
        const meta = document.createElement('div');
        meta.className = 'group-note';
        meta.textContent = 'Layout score: ' + Math.round(res.score) + ' raid DPS (model)'
            + (res.violations ? ' — ⚠ floor violations: ' + res.violations : '');
        box.appendChild(meta);
        (res.alternates || []).forEach(a => {
            const alt = document.createElement('div');
            alt.className = 'group-note';
            alt.textContent = 'Alternative: ' + a.change + ' (' + fmtPct(a.deltaPct) + '%)';
            box.appendChild(alt);
        });
    }
    if (res.unplaced.length) {
        const warn = document.createElement('div');
        warn.className = 'warn';
        warn.textContent = '⚠ No room for: ' + res.unplaced.map(p => p.name).join(', ');
        box.appendChild(warn);
    }
}

function renderBlessings() {
    const box = document.getElementById('blessingGrid');
    const warnBox = document.getElementById('blessingWarnings');
    box.innerHTML = '';
    if (!roster.length) { box.textContent = 'Import a roster first.'; warnBox.classList.add('hidden'); return; }

    const g = E.proposeBlessings(roster, state.blessings);
    const table = document.createElement('table');
    table.className = 'blessing-grid';

    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    g.classes.forEach(c => {
        const th = document.createElement('th');
        th.textContent = E.CLASS_ABBREV[c] || c;
        th.title = c;
        th.style.color = E.CLASS_COLORS[c];
        head.appendChild(th);
    });
    table.appendChild(head);

    const opts = E.GREATER_BLESSINGS.map(b => ({ value: b, label: b.replace('Greater ', 'G.') }));
    g.rows.forEach(row => {
        const tr = document.createElement('tr');
        const name = document.createElement('th');
        name.textContent = row.paladin;
        name.style.color = E.CLASS_COLORS.PALADIN;
        tr.appendChild(name);
        g.classes.forEach(cls => {
            const td = document.createElement('td');
            td.appendChild(makeSelect(opts, row.cells[cls], true, val => {
                state.blessings[row.paladin + '|' + cls] = val;
                renderAll();
            }));
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
    box.appendChild(table);

    if (g.warnings.length) {
        warnBox.classList.remove('hidden');
        warnBox.textContent = '⚠ ' + g.warnings.join('  ·  ');
    } else {
        warnBox.classList.add('hidden');
    }
}

function renderAssignments() {
    const uncoveredBox = document.getElementById('uncoveredBox');
    const missing = E.missingList(sheet.uncovered);
    if (missing.length && roster.length) {
        uncoveredBox.classList.remove('hidden');
        uncoveredBox.textContent = '⚠ Uncovered: ' + missing.map(u => u.name).join(', ');
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

    const healBox = document.getElementById('healingRows');
    healBox.innerHTML = '';
    const healingDuties = sheet.duties.filter(d => d.category === 'healing');
    healingDuties.forEach(d => healBox.appendChild(healingRow(d)));
    if (healingDuties.some(d => d.tanksAutoDetected)) {
        const note = document.createElement('div');
        note.className = 'assign-row passive';
        note.textContent = 'No MTs flagged — using detected tanks. Flag MTs in the player tuning panel.';
        healBox.appendChild(note);
    }

    const ccBox = document.getElementById('ccRows');
    ccBox.innerHTML = '';
    sheet.cc.forEach((c, i) => ccBox.appendChild(ccRow(c, i)));

    const rotBox = document.getElementById('rotationRows');
    rotBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'rotations').forEach(d => rotBox.appendChild(rotationRow(d)));
}

// --- Output tabs / share link ---
function buildShareLink() {
    const payload = { title: state.title, sheet };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    // Resolve against the directory we are served from rather than swapping a filename:
    // this page is the site root now, so a pathname of "/" contains nothing to replace and
    // the old approach silently produced a link back to the tool itself.
    const dir = location.pathname.replace(/[^/]*$/, '');
    return location.origin + dir + 'assignments-view.html?data=' + encodeURIComponent(encoded);
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
    } else if (activeTab === 'addon') {
        E.setEncounterDuration(activeDurationSec());
        box.textContent = E.buildAddonWhispers(roster, sheet, E.proposeGroups(roster));
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
    document.getElementById('manualCancelBtn').addEventListener('click', () => {
        document.getElementById('manualForm').classList.add('hidden');
        document.getElementById('manualName').value = '';
    });
    document.getElementById('clearRosterBtn').addEventListener('click', () => {
        if (!confirm('Clear the whole roster and assignments? (Name links are kept.)')) return;
        // pings and wcl are settings, not roster data, so they survive a clear — see the
        // field-list warning near recompute() above; this literal has already missed one.
        state = { sources: { addon: null, rh: null }, manual: [], excluded: [], overrides: {}, blessings: {}, cc: null, pings: state.pings, wcl: state.wcl, title: '' };
        renderAll();
    });
    document.getElementById('autoAssignBtn').addEventListener('click', () => {
        state.overrides = {};
        state.cc = null;
        state.blessings = {};
        renderAll();
    });
    document.getElementById('aiReviewBtn').addEventListener('click', async () => {
        const btn = document.getElementById('aiReviewBtn');
        const box = document.getElementById('aiReviewBox');
        box.classList.remove('hidden');
        if (!roster.length) { box.textContent = 'Import a roster first.'; return; }
        box.textContent = 'Asking for a second opinion…';
        btn.disabled = true;
        E.setEncounterDuration(activeDurationSec());
        try {
            const payload = {
                roster: roster.map(p => ({ name: p.name, class: p.class, spec: p.spec, race: p.race })),
                groups: E.proposeGroups(roster).groups.map((g, i) => ({
                    group: i + 1, role: g.role,
                    players: g.players.map(p => p.name + ' (' + (p.spec || '?') + ' ' + p.class + ')'),
                    notes: g.notes,
                })),
                fightLengthSec: activeDurationSec(),
                duties: sheet.duties,
                uncovered: sheet.uncovered,
                passives: sheet.passives,
                crowdControl: sheet.cc,
                blessings: sheet.blessings.rows.map(r => ({ paladin: r.paladin, spec: r.spec, perClass: r.cells })),
                blessingWarnings: sheet.blessings.warnings,
            };
            const resp = await fetch('/api/ai-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            box.textContent = resp.ok ? data.review : ('AI review failed: ' + (data.error || resp.status));
        } catch (e) {
            box.textContent = 'AI review failed: ' + e.message;
        } finally {
            btn.disabled = false;
        }
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
