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

function drawMarkers(ctx, W, H, markers) {
    markers.forEach(m => {
        const x = m.x * W, y = m.y * H;
        const R = m.kind === 'boss' ? 26 : 20;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = { healer: '#1d5c46', ranged: '#7a1f24', melee: '#7a1f24' }[m.role]
            || { boss: '#3a2b4d', station: '#274156', clump: '#7a1f24', mt: '#1d3557', offtank: '#1d3557' }[m.kind]
            || '#444';
        ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold ' + R + 'px sans-serif';
        ctx.fillText(GLYPHS[m.kind === 'ring' ? m.role : m.kind] || '●', x, y + R * 0.35);
        ctx.font = 'bold 15px sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
        const lines = m.kind === 'clump' ? m.names : [(m.name || m.label || '')];
        lines.forEach((ln, i) => ctx.fillText(ln, x, y + R + 16 + i * 16));
        if ((m.tags || []).includes('infernal-healer')) {
            ctx.fillStyle = '#ffd166';
            ctx.fillText('→ infernal station', x, y + R + 16 + lines.length * 16);
            ctx.fillStyle = '#fff';
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
    drawMarkers(ctx, canvas.width, canvas.height, lastResult.markers);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const btn = document.getElementById('copyImageBtn');
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
    document.getElementById('resetNudges').addEventListener('click', () => { posState.nudges = {}; savePos(); renderAll(); });
    document.getElementById('copyImageBtn').addEventListener('click', copyImage);
    renderAll();
});
