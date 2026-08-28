/* global AssignmentsEngine, HyjalPositions */
'use strict';
const E = AssignmentsEngine;
const HP = HyjalPositions;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';
const POS_KEY = 'raidPositionsState';

// Boss tab → encounter. Winterchill and Anetheron share one formation (and one nudge
// scope); Archimonde is its own map and layout, so its drags live in their own scope.
const BOSS_TABS = {
    winterchill: { enc: 'hyjal-b12' },
    anetheron: { enc: 'hyjal-b12' },
    archimonde: { enc: 'hyjal-archimonde' },
    najentus: { enc: 'bt-najentus' },
};

// Per encounter, two nudge layers per store: `saved` is the template baseline, the
// top-level maps hold live drags since the last save. "Save as template" folds live into
// saved; "Reset nudges" clears only live (back to the template); factory reset clears
// both. `nudges` is keyed by player name, `anchorNudges` by static marker kind
// (boss/clump/station) or by 'party-N' for an Archimonde stack handle.
let posState = { boss: 'winterchill', encounters: {} };

function encId() { return (BOSS_TABS[posState.boss] || BOSS_TABS.winterchill).enc; }
function scopeFor(id) {
    const sc = posState.encounters[id] = posState.encounters[id] || {};
    sc.nudges = sc.nudges || {};
    sc.anchorNudges = sc.anchorNudges || {};
    sc.saved = sc.saved || {};
    sc.saved.nudges = sc.saved.nudges || {};
    sc.saved.anchorNudges = sc.saved.anchorNudges || {};
    return sc;
}
function scope() { return scopeFor(encId()); }
let lastResult = null;
let roster = [];

function loadAll() {
    let sheetState = {}, linkMap = {};
    try { sheetState = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* fresh */ }
    try { linkMap = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { /* fresh */ }
    try { Object.assign(posState, JSON.parse(localStorage.getItem(POS_KEY)) || {}); } catch (e) { /* fresh */ }
    roster = E.deriveRoster(sheetState, linkMap);

    // Migrate older stored shapes: flat nudge fields (pre-encounter-scoping) belonged to
    // the hyjal-b12 formation, the only encounter that existed when they were written.
    posState.encounters = posState.encounters || {};
    if (posState.nudges || posState.anchorNudges || posState.saved) {
        posState.encounters['hyjal-b12'] = posState.encounters['hyjal-b12'] || {
            nudges: posState.nudges || {},
            anchorNudges: posState.anchorNudges || {},
            saved: posState.saved || {},
        };
        delete posState.nudges; delete posState.anchorNudges; delete posState.saved;
        savePos();
    }

    // Sweep stale nudges the same way the sheet sweeps stale cc/override references: a nudge
    // keyed to a name that fell off the roster (rename, removal, re-import) is dead weight that
    // would otherwise sit in storage forever, only ever surfacing again if the name is reused.
    // All name-keyed layers in every encounter scope get swept. Anchor nudges are keyed by
    // fixed marker kinds or party numbers and never go stale.
    const names = new Set(roster.map(p => p.name));
    let sweepChanged = false;
    Object.keys(posState.encounters).forEach(id => {
        const sc = scopeFor(id);
        [sc.nudges, sc.saved.nudges].forEach(layer => {
            Object.keys(layer).forEach(n => {
                if (!names.has(n)) { delete layer[n]; sweepChanged = true; }
            });
        });
    });
    if (sweepChanged) savePos();

    return sheetState;
}
function savePos() { localStorage.setItem(POS_KEY, JSON.stringify(posState)); }

function renderAll() {
    const sheetState = loadAll();
    const enc = HP.ENCOUNTERS[encId()];
    document.getElementById('encounterName').textContent = enc.name;
    document.getElementById('mapImg').src = enc.map;
    document.getElementById('bossWinterchill').classList.toggle('active', posState.boss === 'winterchill');
    document.getElementById('bossAnetheron').classList.toggle('active', posState.boss === 'anetheron');
    document.getElementById('bossArchimonde').classList.toggle('active', posState.boss === 'archimonde');
    document.getElementById('bossNajentus').classList.toggle('active', posState.boss === 'najentus');
    // Swap is per boss (not per encounter scope — Winterchill and Anetheron share one).
    // On ring layouts the tanks trade duties; on stacks layouts the second tank takes the
    // boss and the old MT rejoins their group's stack.
    const swapped = !!(posState.swapTanks || {})[posState.boss];
    const swapBtn = document.getElementById('swapTanks');
    swapBtn.classList.toggle('active', swapped);
    const empty = document.getElementById('emptyState');
    document.querySelectorAll('.pos-marker').forEach(el => el.remove());
    if (!roster.length) { empty.classList.remove('hidden'); lastResult = null; renderWarnings([]); return; }
    empty.classList.add('hidden');
    const duties = E.autoAssign(roster, sheetState.overrides || {}).duties;
    const sc = scope();
    lastResult = HP.computePositions(roster, E.proposeGroups(roster), duties, {
        boss: posState.boss, encounter: enc.id, swapTanks: swapped,
        nudges: HP.combineNudges(sc.saved.nudges, sc.nudges),
        anchorNudges: HP.combineNudges(sc.saved.anchorNudges, sc.anchorNudges),
    });
    const wrap = document.getElementById('mapWrap');
    lastResult.markers.forEach(m => wrap.appendChild(markerEl(m)));
    renderWarnings(lastResult.warnings);
}

const GLYPHS = { boss: '💀', station: '🔥', clump: '⚔', mt: '🛡', offtank: '🛡', healer: '✚', ranged: '➹', melee: '⚔', tank: '🛡' };

function markerEl(m) {
    const el = document.createElement('div');
    const isPerson = !!m.name;
    el.className = 'pos-marker pos-kind-' + m.kind + (m.role ? ' pos-role-' + m.role : '')
        + (m.icon ? ' pos-has-icon' : '');
    el.style.left = (m.x * 100) + '%';
    el.style.top = (m.y * 100) + '%';
    if (isPerson) el.dataset.name = m.name;
    const dot = document.createElement('div');
    dot.className = 'pos-dot';
    if (m.icon) {
        const img = document.createElement('img');
        img.src = m.icon;
        img.alt = m.label || '';
        img.draggable = false;
        dot.appendChild(img);
    } else if (m.kind === 'stackhandle') {
        dot.textContent = m.label;
    } else {
        dot.textContent = GLYPHS[m.kind === 'ring' || m.kind === 'stack' ? m.role : m.kind] || '●';
    }
    if ((m.tags || []).includes('shaman')) {
        const badge = document.createElement('span');
        badge.className = 'pos-badge';
        badge.textContent = '⚡';
        badge.title = 'Shaman — Tremor Totem';
        dot.appendChild(badge);
    }
    el.appendChild(dot);
    const label = document.createElement('div');
    label.className = 'pos-label';
    label.textContent = m.kind === 'clump' ? m.names.join('\n')
        : (m.kind === 'stackhandle' ? '' : (m.name || m.label || ''));
    if (m.kind === 'stack') label.title = m.name;
    el.appendChild(label);
    // Everything is draggable: people write a name-keyed nudge; static markers write an
    // anchor nudge — keyed by kind (boss/clump/station) or by party for a stack handle,
    // which moves its whole group. Dragging the boss moves the entire formation —
    // computePositions treats its nudge as a rigid translation.
    wireDrag(el, m, isPerson ? 'nudges' : 'anchorNudges',
        isPerson ? m.name : (m.kind === 'stackhandle' ? 'party-' + m.party : m.kind));
    return el;
}

function wireDrag(el, m, store, key) {
    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const wrap = document.getElementById('mapWrap').getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const baseX = m.x, baseY = m.y;
        let moved = false;
        const onMove = ev => {
            const fx = baseX + (ev.clientX - startX) / wrap.width;
            const fy = baseY + (ev.clientY - startY) / wrap.height;
            moved = true;
            el.style.left = (Math.min(0.99, Math.max(0.01, fx)) * 100) + '%';
            el.style.top = (Math.min(0.99, Math.max(0.01, fy)) * 100) + '%';
        };
        const onUp = ev => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            if (!moved) return;
            const fx = Math.min(0.99, Math.max(0.01, baseX + (ev.clientX - startX) / wrap.width));
            const fy = Math.min(0.99, Math.max(0.01, baseY + (ev.clientY - startY) / wrap.height));
            const layer = scope()[store];
            const prev = layer[key] || { dx: 0, dy: 0 };
            // computed base already includes saved+live nudges; the drag's delta lands on
            // the LIVE layer, so "Reset nudges" undoes it while the saved template stands
            layer[key] = { dx: prev.dx + (fx - baseX), dy: prev.dy + (fy - baseY) };
            savePos();
            renderAll();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
    });
}

function renderWarnings(warnings) {
    const box = document.getElementById('posWarnings');
    box.classList.toggle('hidden', !warnings.length);
    box.textContent = warnings.join('\n');
}

function drawMarkers(ctx, W, H, markers, icons) {
    markers.forEach(m => {
        const x = m.x * W, y = m.y * H;
        const R = m.kind === 'boss' ? 26 : (m.kind === 'stack' ? 15 : (m.kind === 'stackhandle' ? 13 : 20));
        if (m.kind === 'stackhandle') {
            // pill with the group label
            ctx.font = 'bold 14px sans-serif';
            const w = ctx.measureText(m.label).width + 16;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - w / 2, y - R, w, R * 2, R);
            else ctx.rect(x - w / 2, y - R, w, R * 2);
            ctx.fillStyle = '#444c56'; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
            ctx.fillText(m.label, x, y + 5);
            return;
        }
        const iconImg = m.icon && icons && icons[m.icon];
        if (iconImg) {
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(iconImg, x - R, y - R, R * 2, R * 2);
            ctx.restore();
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(x, y, R, 0, Math.PI * 2);
            ctx.fillStyle = { healer: '#1d5c46', ranged: '#7a1f24', melee: '#7a1f24', tank: '#1d3557' }[m.role]
                || { boss: '#3a2b4d', station: '#274156', clump: '#7a1f24', mt: '#1d3557', offtank: '#1d3557' }[m.kind]
                || '#444';
            ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.font = 'bold ' + R + 'px sans-serif';
            ctx.fillText(GLYPHS[m.kind === 'ring' || m.kind === 'stack' ? m.role : m.kind] || '●', x, y + R * 0.35);
        }
        if ((m.tags || []).includes('shaman')) {
            ctx.font = 'bold 14px sans-serif';
            ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
            ctx.fillStyle = '#ffd166';
            ctx.fillText('⚡', x + R * 0.9, y - R * 0.6);
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = '#fff';
        const labelPx = m.kind === 'stack' ? 12 : 15;
        ctx.font = 'bold ' + labelPx + 'px sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
        const lines = m.kind === 'clump' ? m.names : [(m.name || m.label || '')];
        if (m.kind === 'station') {
            lines.forEach((ln, i) => ctx.fillText(ln, x, y - R - 8 - (lines.length - 1 - i) * 16));
        } else {
            lines.forEach((ln, i) => ctx.fillText(ln, x, y + R + labelPx + 1 + i * 16));
        }
        ctx.shadowBlur = 0;
    });
}

async function copyImage() {
    if (!lastResult) return;
    const img = document.getElementById('mapImg');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // Preload any marker icons (the Archimonde portrait) before drawing.
    const icons = {};
    await Promise.all([...new Set(lastResult.markers.map(m => m.icon).filter(Boolean))].map(src =>
        new Promise(res => {
            const im = new Image();
            im.onload = () => { icons[src] = im; res(); };
            im.onerror = res; // fall back to the plain glyph dot
            im.src = src;
        })));
    drawMarkers(ctx, canvas.width, canvas.height, lastResult.markers, icons);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const btn = document.getElementById('copyImageBtn');
    if (!blob) {
        btn.textContent = '⚠ Export failed';
        setTimeout(() => { btn.textContent = '📋 Copy as image'; }, 1500);
        return;
    }
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        btn.textContent = '✅ Copied';
    } catch (e) {
        // clipboard is unavailable (permissions, headless): fall back to a download
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hyjal-positions.png';
        a.click();
        btn.textContent = '⬇ Saved';
    }
    setTimeout(() => { btn.textContent = '📋 Copy as image'; }, 1500);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('bossWinterchill').addEventListener('click', () => { posState.boss = 'winterchill'; savePos(); renderAll(); });
    document.getElementById('bossAnetheron').addEventListener('click', () => { posState.boss = 'anetheron'; savePos(); renderAll(); });
    document.getElementById('bossArchimonde').addEventListener('click', () => { posState.boss = 'archimonde'; savePos(); renderAll(); });
    document.getElementById('bossNajentus').addEventListener('click', () => { posState.boss = 'najentus'; savePos(); renderAll(); });
    // The template buttons act on the CURRENT tab's encounter scope only: saving an
    // Archimonde layout leaves the Winterchill/Anetheron template alone, and vice versa.
    document.getElementById('saveTemplate').addEventListener('click', () => {
        const sc = scope();
        sc.saved = {
            nudges: HP.combineNudges(sc.saved.nudges, sc.nudges),
            anchorNudges: HP.combineNudges(sc.saved.anchorNudges, sc.anchorNudges),
        };
        sc.nudges = {}; sc.anchorNudges = {};
        savePos(); renderAll();
        const btn = document.getElementById('saveTemplate');
        btn.textContent = '✅ Saved';
        setTimeout(() => { btn.textContent = '💾 Save as template'; }, 1500);
    });
    document.getElementById('swapTanks').addEventListener('click', () => {
        posState.swapTanks = posState.swapTanks || {};
        posState.swapTanks[posState.boss] = !posState.swapTanks[posState.boss];
        savePos(); renderAll();
    });
    document.getElementById('resetNudges').addEventListener('click', () => {
        const sc = scope();
        sc.nudges = {}; sc.anchorNudges = {}; savePos(); renderAll();
    });
    document.getElementById('factoryReset').addEventListener('click', () => {
        if (!confirm('Discard this encounter’s saved template and all drags, and return to the computed layout?')) return;
        posState.encounters[encId()] = { nudges: {}, anchorNudges: {}, saved: { nudges: {}, anchorNudges: {} } };
        savePos(); renderAll();
    });
    document.getElementById('copyImageBtn').addEventListener('click', copyImage);
    renderAll();
});
