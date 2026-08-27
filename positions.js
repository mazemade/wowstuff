/* global AssignmentsEngine, HyjalPositions */
'use strict';
const E = AssignmentsEngine;
const HP = HyjalPositions;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';
const POS_KEY = 'raidPositionsState';
const ENCOUNTER = 'hyjal-b12';

let posState = { boss: 'winterchill', nudges: {} };
let lastResult = null;
let roster = [];

function loadAll() {
    let sheetState = {}, linkMap = {};
    try { sheetState = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* fresh */ }
    try { linkMap = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { /* fresh */ }
    try { Object.assign(posState, JSON.parse(localStorage.getItem(POS_KEY)) || {}); } catch (e) { /* fresh */ }
    roster = E.deriveRoster(sheetState, linkMap);
    return sheetState;
}
function savePos() { localStorage.setItem(POS_KEY, JSON.stringify(posState)); }

function renderAll() {
    const sheetState = loadAll();
    const enc = HP.ENCOUNTERS[ENCOUNTER];
    document.getElementById('encounterName').textContent = enc.name;
    document.getElementById('mapImg').src = enc.map;
    document.getElementById('bossWinterchill').classList.toggle('active', posState.boss === 'winterchill');
    document.getElementById('bossAnetheron').classList.toggle('active', posState.boss === 'anetheron');
    const empty = document.getElementById('emptyState');
    document.querySelectorAll('.pos-marker').forEach(el => el.remove());
    if (!roster.length) { empty.classList.remove('hidden'); lastResult = null; renderWarnings([]); return; }
    empty.classList.add('hidden');
    const duties = E.autoAssign(roster, sheetState.overrides || {}).duties;
    lastResult = HP.computePositions(roster, E.proposeGroups(roster), duties, {
        boss: posState.boss, nudges: posState.nudges, encounter: ENCOUNTER,
    });
    const wrap = document.getElementById('mapWrap');
    lastResult.markers.forEach(m => wrap.appendChild(markerEl(m)));
    renderWarnings(lastResult.warnings);
}

const GLYPHS = { boss: '💀', station: '🔥', clump: '⚔', mt: '🛡', offtank: '🛡', healer: '✚', ranged: '➹', melee: '⚔', tank: '🛡' };

function markerEl(m) {
    const el = document.createElement('div');
    const isPerson = !!m.name;
    el.className = 'pos-marker pos-kind-' + m.kind + (m.role ? ' pos-role-' + m.role : '') + (isPerson ? '' : ' static');
    el.style.left = (m.x * 100) + '%';
    el.style.top = (m.y * 100) + '%';
    if (isPerson) el.dataset.name = m.name;
    const dot = document.createElement('div');
    dot.className = 'pos-dot';
    dot.textContent = GLYPHS[m.kind === 'ring' ? m.role : m.kind] || '●';
    el.appendChild(dot);
    const label = document.createElement('div');
    label.className = 'pos-label';
    label.textContent = m.kind === 'clump' ? m.names.join('\n') : (m.name || m.label || '');
    el.appendChild(label);
    if ((m.tags || []).includes('infernal-healer')) {
        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '→ infernal station';
        label.appendChild(tag);
    }
    if (isPerson) wireDrag(el, m);
    return el;
}

function wireDrag(el, m) {
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
            const prev = posState.nudges[m.name] || { dx: 0, dy: 0 };
            // computed base already includes prev nudge; the new nudge is prev + this drag's delta
            posState.nudges[m.name] = { dx: prev.dx + (fx - baseX), dy: prev.dy + (fy - baseY) };
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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('bossWinterchill').addEventListener('click', () => { posState.boss = 'winterchill'; savePos(); renderAll(); });
    document.getElementById('bossAnetheron').addEventListener('click', () => { posState.boss = 'anetheron'; savePos(); renderAll(); });
    document.getElementById('resetNudges').addEventListener('click', () => { posState.nudges = {}; savePos(); renderAll(); });
    renderAll();
});
