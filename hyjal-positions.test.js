'use strict';
const assert = require('node:assert');
const HP = require('./hyjal-positions.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- registry ---
test('registry: hyjal-b12 exists with map, anchors, two bosses', () => {
    const enc = HP.ENCOUNTERS['hyjal-b12'];
    assert.ok(enc);
    assert.strictEqual(enc.map, 'maps/hyjal-ballista.png');
    assert.deepStrictEqual(enc.bosses.map(b => b.id), ['winterchill', 'anetheron']);
    assert.ok(enc.anchors.boss.x > 0 && enc.anchors.boss.x < 1);
    assert.ok(enc.bosses[1].station, 'anetheron carries the infernal station anchor');
});

// --- geometry ---
test('slotAngles: even spacing from the start angle', () => {
    assert.deepStrictEqual(HP.slotAngles(4, -90), [-90, 0, 90, 180]);
});
test('angleToXY: 0 degrees is straight right, aspect-corrected', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, 0, 2.0);
    assert.ok(Math.abs(p.x - 0.6) < 1e-9);
    assert.ok(Math.abs(p.y - 0.5) < 1e-9);
});
test('angleToXY: -90 degrees is straight up, y shrinks by r*aspect', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, -90, 2.0);
    assert.ok(Math.abs(p.x - 0.5) < 1e-9);
    assert.ok(Math.abs(p.y - 0.3) < 1e-9);   // 0.5 - 0.1*2.0
});
test('circGap: wraps around', () => {
    assert.strictEqual(HP.circGap(-170, 170), 20);
    assert.strictEqual(HP.circGap(0, 180), 180);
});

const E = require('./assignments-engine.js');
function mk(name, cls, spec, extra) {
    return Object.assign({ name, class: cls, spec, flags: [] }, extra || {});
}
// 10-player fixture: 2 tanks, 3 healers, 2 melee, 3 ranged/casters
function fixtureRoster() {
    return [
        mk('Mt', 'WARRIOR', 'Protection', { mt: true }), mk('Ot', 'PALADIN', 'Protection'),
        mk('Hpal', 'PALADIN', 'Holy'), mk('Rsham', 'SHAMAN', 'Restoration'), mk('Cpriest', 'PRIEST', 'Holy'),
        mk('Rog', 'ROGUE', 'Combat'), mk('Warr', 'WARRIOR', 'Fury'),
        mk('Hunt', 'HUNTER', 'Beast Mastery'), mk('Lock', 'WARLOCK', 'Destruction'), mk('Mage', 'MAGE', 'Frost'),
    ];
}
function compute(roster, opts) {
    return HP.computePositions(roster, E.proposeGroups(roster), E.autoAssign(roster, {}).duties, opts || {});
}

// --- computePositions basics ---
test('compute: every non-melee non-tank player gets exactly one ring marker', () => {
    const r = compute(fixtureRoster());
    const ring = r.markers.filter(m => m.kind === 'ring');
    assert.deepStrictEqual(ring.map(m => m.name).sort(), ['Cpriest', 'Hpal', 'Hunt', 'Lock', 'Mage', 'Rsham']);
});
test('compute: mt at the boss anchor side, melee in one clump with names', () => {
    const r = compute(fixtureRoster());
    assert.strictEqual(r.markers.filter(m => m.kind === 'mt').length, 1);
    const clump = r.markers.find(m => m.kind === 'clump');
    assert.ok(clump.names.includes('Rog') && clump.names.includes('Warr'));
});
test('compute: winterchill puts the offtank in the clump, not a station', () => {
    const r = compute(fixtureRoster(), { boss: 'winterchill' });
    assert.ok(!r.markers.some(m => m.kind === 'station'));
    assert.ok(r.markers.find(m => m.kind === 'clump').names.includes('Ot'));
});
test('compute: party members sit on adjacent ring slots', () => {
    const roster = fixtureRoster();
    const groups = E.proposeGroups(roster);
    const r = HP.computePositions(roster, groups, E.autoAssign(roster, {}).duties, {});
    const ring = r.markers.filter(m => m.kind === 'ring');
    // slot order is marker order; every party's members must be contiguous in it
    const parties = [...new Set(ring.map(m => m.party))];
    parties.forEach(pi => {
        const idxs = ring.map((m, i) => m.party === pi ? i : -1).filter(i => i !== -1);
        const span = idxs[idxs.length - 1] - idxs[0];
        assert.strictEqual(span, idxs.length - 1, 'party ' + pi + ' is not contiguous');
    });
});
test('compute: all coordinates are inside the image', () => {
    const r = compute(fixtureRoster());
    r.markers.forEach(m => {
        assert.ok(m.x > 0 && m.x < 1 && m.y > 0 && m.y < 1, (m.name || m.kind) + ' escaped the map');
    });
});
test('compute: deterministic', () => {
    assert.deepStrictEqual(compute(fixtureRoster()), compute(fixtureRoster()));
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
