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
test('compute: melee clump sits behind the boss, opposite the main tank', () => {
    const r = compute(fixtureRoster());
    const enc = HP.ENCOUNTERS['hyjal-b12'];
    const clump = r.markers.find(m => m.kind === 'clump');
    // Work in isotropic (aspect-corrected) space so "behind" is a screen direction.
    const boss = enc.anchors.boss, mt = enc.anchors.mt;
    const toMt = { u: mt.x - boss.x, v: (mt.y - boss.y) / enc.aspect };
    const toClump = { u: clump.x - boss.x, v: (clump.y - boss.y) / enc.aspect };
    const len = w => Math.hypot(w.u, w.v);
    const cos = (toMt.u * toClump.u + toMt.v * toClump.v) / (len(toMt) * len(toClump));
    assert.ok(cos < -0.9, 'clump is not opposite the MT (cos=' + cos.toFixed(2) + ')');
    assert.ok(len(toClump) > 0.02 && len(toClump) < 0.09,
        'clump is not in melee range of the boss (dist=' + len(toClump).toFixed(3) + ')');
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

// --- healer spread ---
test('interleaveHealers: healers land evenly inside the wedge', () => {
    const w = [mk('H1','PRIEST','Holy'), mk('H2','PRIEST','Holy'), mk('D1','MAGE','Frost'),
               mk('D2','MAGE','Frost'), mk('D3','MAGE','Frost'), mk('D4','MAGE','Frost')];
    const out = HP.interleaveHealers(w, p => p.class === 'PRIEST');
    const idxs = out.map((p, i) => p.class === 'PRIEST' ? i : -1).filter(i => i !== -1);
    assert.strictEqual(idxs[1] - idxs[0], 3, 'healers should be 3 slots apart in a 6-wedge');
});
test('compute: healers are never on adjacent slots when avoidable', () => {
    // 3 healers, 6 dps on the ring: worst legal gap is 120deg with 9 slots (=40deg each) -> min gap >= 80deg
    const roster = [
        mk('Mt','WARRIOR','Protection',{mt:true}),
        mk('H1','PRIEST','Holy'), mk('H2','SHAMAN','Restoration'), mk('H3','PALADIN','Holy'),
        mk('D1','MAGE','Frost'), mk('D2','MAGE','Fire'), mk('D3','WARLOCK','Destruction'),
        mk('D4','HUNTER','Marksmanship'), mk('D5','HUNTER','Survival'), mk('D6','PRIEST','Shadow'),
    ];
    const r = compute(roster);
    const ring = r.markers.filter(m => m.kind === 'ring');
    const healerAngles = ring.filter(m => m.role === 'healer').map(m => m.angleDeg);
    let minGap = 360;
    for (let i = 0; i < healerAngles.length; i++)
        for (let j = i + 1; j < healerAngles.length; j++)
            minGap = Math.min(minGap, HP.circGap(healerAngles[i], healerAngles[j]));
    assert.ok(minGap >= 80, 'healer min gap was ' + minGap);
});
test('compute: the two tank healers end up on opposite sides', () => {
    const roster = fixtureRoster();
    const duties = E.autoAssign(roster, {}).duties;
    const tankHealers = duties.find(d => d.id === 'tankheal').players;
    const r = HP.computePositions(roster, E.proposeGroups(roster), duties, {});
    const ring = r.markers.filter(m => m.kind === 'ring');
    const angles = tankHealers.map(nm => ring.find(m => m.name === nm)).filter(Boolean).map(m => m.angleDeg);
    if (angles.length === 2) assert.ok(HP.circGap(angles[0], angles[1]) >= 120, 'tank healers ' + HP.circGap(angles[0], angles[1]) + 'deg apart');
});
test('compute: warning when healers are forced into a bunch', () => {
    // 18 ring slots (20° apart); the healers group is a 5-healer wedge, so adjacent
    // healers are unavoidable and the absolute 30° bunching threshold must fire.
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true })];
    for (let i = 0; i < 6; i++) roster.push(mk('H' + i, 'PRIEST', 'Holy'));
    for (let i = 0; i < 12; i++) roster.push(mk('D' + i, 'MAGE', 'Frost'));
    const r = compute(roster);
    assert.ok(r.warnings.some(w => w.includes('bunched')), JSON.stringify(r.warnings));
});
test('compute: warning when a party wedge spans more than 90 degrees', () => {
    const roster = [];
    for (let i = 0; i < 8; i++) roster.push(mk('M' + i, 'MAGE', 'Frost'));  // one 8-man caster party impossible: cap 5/group
    roster.push(mk('H1','PRIEST','Holy'));
    const r = compute(roster);
    const ring = r.markers.filter(m => m.kind === 'ring');
    const byParty = {};
    ring.forEach(m => { (byParty[m.party] = byParty[m.party] || []).push(m); });
    const overWide = Object.values(byParty).some(list => (list.length - 1) * 360 / ring.length > 90);
    if (overWide) assert.ok(r.warnings.some(w => w.includes('totem range')), JSON.stringify(r.warnings));
});

// --- playerMeta overlay (deriveRoster now applies it; this checks computePositions honors
// whatever deriveRoster hands it, mirroring how the positions page consumes E.deriveRoster) ---
test('compute: an mt-flagged second tank (via deriveRoster-shaped state) becomes the mt marker', () => {
    const state = {
        sources: { addon: [
            { name: 'Firstank', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon', group: 1, race: null, talents: null },
            { name: 'Secondtank', class: 'PALADIN', spec: 'Protection', flags: [], source: 'addon', group: 1, race: null, talents: null },
            { name: 'Priest', class: 'PRIEST', spec: 'Holy', flags: [], source: 'addon', group: 1, race: null, talents: null },
        ], rh: null },
        manual: [], excluded: [],
        // Only the SECOND tank is flagged MT — the case that used to only reach the roster
        // through the sheet's inline overlay, not through E.deriveRoster alone.
        playerMeta: { Secondtank: { mt: true } },
    };
    const roster = E.deriveRoster(state, {});
    const r = compute(roster);
    const mtMarker = r.markers.find(m => m.kind === 'mt');
    assert.ok(mtMarker, 'no mt marker rendered');
    assert.strictEqual(mtMarker.name, 'Secondtank');
});

// --- anetheron mode ---
test('anetheron: offtank moves to the station and it renders', () => {
    const r = compute(fixtureRoster(), { boss: 'anetheron' });
    const station = r.markers.find(m => m.kind === 'station');
    const ot = r.markers.find(m => m.kind === 'offtank');
    assert.ok(station && ot);
    assert.strictEqual(ot.name, 'Ot');
    assert.ok(!r.markers.find(m => m.kind === 'clump').names.includes('Ot'));
});
test('anetheron: the raid healer nearest the station is tagged infernal-healer', () => {
    const roster = fixtureRoster();
    const duties = E.autoAssign(roster, {}).duties;
    const raidHealers = duties.find(d => d.id === 'raidheal').players;
    const r = HP.computePositions(roster, E.proposeGroups(roster), duties, { boss: 'anetheron' });
    const tagged = r.markers.filter(m => (m.tags || []).includes('infernal-healer'));
    assert.strictEqual(tagged.length, 1);   // fixture has < 4 raid healers -> exactly 1
    assert.ok(raidHealers.includes(tagged[0].name), 'tagged a tank healer instead of a raid healer');
});
test('anetheron: single-tank roster warns about the station but still renders it', () => {
    const roster = fixtureRoster().filter(p => p.name !== 'Ot');
    const r = compute(roster, { boss: 'anetheron' });
    assert.ok(r.warnings.some(w => w.includes('No second tank')), JSON.stringify(r.warnings));
    // The station is a fixed map feature (the infernal spawn point), not something that should
    // vanish just because there is no offtank to man it — only the offtank person-marker is
    // conditional on having a second tank.
    assert.ok(r.markers.some(m => m.kind === 'station'), 'station marker missing with no offtank');
    assert.ok(!r.markers.some(m => m.kind === 'offtank'), 'no offtank should mean no offtank marker');
});
test('winterchill: no infernal-healer tags', () => {
    const r = compute(fixtureRoster(), { boss: 'winterchill' });
    assert.ok(!r.markers.some(m => (m.tags || []).includes('infernal-healer')));
});

// --- nudges ---
test('nudges: shift the named marker and only that marker', () => {
    const base = compute(fixtureRoster());
    const nudged = compute(fixtureRoster(), { nudges: { Hunt: { dx: 0.05, dy: -0.02 } } });
    const b = base.markers.find(m => m.name === 'Hunt');
    const v = nudged.markers.find(m => m.name === 'Hunt');
    assert.ok(Math.abs(v.x - (b.x + 0.05)) < 1e-9 && Math.abs(v.y - (b.y - 0.02)) < 1e-9);
    const others = base.markers.filter(m => m.name && m.name !== 'Hunt');
    others.forEach(o => {
        const o2 = nudged.markers.find(m => m.name === o.name);
        assert.strictEqual(o2.x, o.x);
    });
});
test('nudges: an absurd nudge is clamped inside the map bounds', () => {
    // A stored nudge from a previous, larger map (or just a stray drag) plus a base position
    // change should never be able to push a marker off the image.
    const r = compute(fixtureRoster(), { nudges: { Hunt: { dx: 5, dy: -5 } } });
    const hunt = r.markers.find(m => m.name === 'Hunt');
    assert.ok(hunt.x >= 0.01 && hunt.x <= 0.99, 'x out of bounds: ' + hunt.x);
    assert.ok(hunt.y >= 0.01 && hunt.y <= 0.99, 'y out of bounds: ' + hunt.y);
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
