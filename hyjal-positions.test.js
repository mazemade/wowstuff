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
test('compute: boss marker carries the per-boss portrait icon', () => {
    const rw = compute(fixtureRoster());
    assert.strictEqual(rw.markers.find(m => m.kind === 'boss').icon, 'maps/rage-winterchill-icon.png');
    const an = compute(fixtureRoster(), { boss: 'anetheron' });
    assert.strictEqual(an.markers.find(m => m.kind === 'boss').icon, 'maps/anetheron-icon.png');
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
test('anetheron: shared ring keeps tank healers opposite, healers out of Swarm, and the station clear', () => {
    const roster = fixtureRoster();
    const duties = [{ id: 'tankheal', players: ['Hpal', 'Cpriest'] }];
    const r = HP.computePositions(roster, E.proposeGroups(roster), duties, { boss: 'anetheron' });
    const boss = r.markers.find(m => m.kind === 'boss');
    const clump = r.markers.find(m => m.kind === 'clump');
    const station = r.markers.find(m => m.kind === 'station');
    const angle = m => Math.atan2((m.y - boss.y) / HP.ENCOUNTERS['hyjal-b12'].aspect, m.x - boss.x) * 180 / Math.PI;
    const meleeAngle = angle(clump);
    const healers = r.markers.filter(m => m.kind === 'ring' && m.role === 'healer');
    const tankHealers = healers.filter(m => duties[0].players.includes(m.name));
    assert.ok(HP.circGap(angle(tankHealers[0]), angle(tankHealers[1])) >= 150,
        'tank healers must occupy opposite sides');
    assert.ok(healers.every(m => HP.circGap(angle(m), meleeAngle) > 30),
        'no healer may occupy the rear melee/Carrion Swarm lane');
    const safeRadius = 0.075; // 15 yards at the shared B12 map scale (0.005/yard).
    assert.ok(r.markers.filter(m => m.kind === 'ring').every(m =>
        Math.hypot(m.x - station.x, (m.y - station.y) / HP.ENCOUNTERS['hyjal-b12'].aspect) > safeRadius),
        'the Infernal landing pulse must not overlap the ring');
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

// --- warnings follow drags (nudges), not the original slot assignment ---
// A dragged marker renders at its nudged position, so the angular warnings must judge
// that position: dragging a tank healer to the far side clears the Carrion warning,
// dragging it next to the other one raises it.
function mirrorNudge(result, name) {
    // A nudge that reflects the named ring marker through the boss.
    const boss = result.markers.find(m => m.kind === 'boss');
    const m = result.markers.find(x => x.name === name);
    return { [name]: { dx: 2 * (boss.x - m.x), dy: 2 * (boss.y - m.y) } };
}
test('warnings: dragging a tank healer to the opposite side clears the Carrion warning', () => {
    // The automatic layout puts this pair on opposite sides. Deliberately stack them,
    // then drag one through the boss to prove the warning follows the rendered map.
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true }),
        mk('H1', 'PRIEST', 'Holy'), mk('H2', 'PALADIN', 'Holy'), mk('D1', 'MAGE', 'Frost')];
    for (let i = 2; i <= 11; i++) roster.push(mk('D' + i, 'MAGE', 'Frost'));
    const byName = {};
    roster.forEach(p => { byName[p.name] = p; });
    const groups = { groups: [
        { players: ['Mt', 'H1', 'H2', 'D1'].map(n => byName[n]) },
        { players: ['D2', 'D3', 'D4', 'D5', 'D6'].map(n => byName[n]) },
        { players: ['D7', 'D8', 'D9', 'D10', 'D11'].map(n => byName[n]) },
    ] };
    const duties = [{ id: 'tankheal', players: ['H1', 'H2'] }];
    const base = HP.computePositions(roster, groups, duties, {});
    const h1 = base.markers.find(m => m.name === 'H1');
    const h2 = base.markers.find(m => m.name === 'H2');
    const together = HP.computePositions(roster, groups, duties, {
        nudges: { H2: { dx: h1.x + 0.01 - h2.x, dy: h1.y - h2.y } },
    });
    assert.ok(together.warnings.some(w => w.includes('Carrion')), 'fixture broke: ' + JSON.stringify(together.warnings));
    const boss = base.markers.find(m => m.kind === 'boss');
    const oppositeH1 = { x: 2 * boss.x - h1.x, y: 2 * boss.y - h1.y };
    const dragged = HP.computePositions(roster, groups, duties, {
        nudges: { H2: { dx: oppositeH1.x - h2.x, dy: oppositeH1.y - h2.y } },
    });
    assert.ok(!dragged.warnings.some(w => w.includes('Carrion')),
        'warning survived the drag: ' + JSON.stringify(dragged.warnings));
});
test('warnings: dragging the tank healers together raises the Carrion warning', () => {
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true }),
        mk('H1', 'PRIEST', 'Holy'), mk('D1', 'MAGE', 'Frost'), mk('D2', 'MAGE', 'Frost'), mk('D3', 'MAGE', 'Frost'),
        mk('H2', 'PALADIN', 'Holy'), mk('D4', 'MAGE', 'Frost'), mk('D5', 'MAGE', 'Frost'), mk('D6', 'MAGE', 'Frost'),
        mk('D7', 'MAGE', 'Frost'), mk('D8', 'MAGE', 'Frost'), mk('D9', 'MAGE', 'Frost'), mk('D10', 'MAGE', 'Frost')];
    const duties = [{ id: 'tankheal', players: ['H1', 'H2'] }];
    const groups = E.proposeGroups(roster);
    const base = HP.computePositions(roster, groups, duties, {});
    assert.ok(!base.warnings.some(w => w.includes('Carrion')), 'fixture broke: ' + JSON.stringify(base.warnings));
    const h1 = base.markers.find(m => m.name === 'H1');
    const h2 = base.markers.find(m => m.name === 'H2');
    const dragged = HP.computePositions(roster, groups, duties, {
        nudges: { H2: { dx: h1.x + 0.01 - h2.x, dy: h1.y - h2.y } },
    });
    assert.ok(dragged.warnings.some(w => w.includes('Carrion')),
        'no warning after dragging the tank healers together: ' + JSON.stringify(dragged.warnings));
});
test('warnings: dragging a bunched healer away clears the bunching warning', () => {
    // The only two healers share a 2-slot wedge on a 13-slot ring (27.7° apart): bunched.
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true }),
        mk('H1', 'PRIEST', 'Holy'), mk('H2', 'PALADIN', 'Holy')];
    for (let i = 1; i <= 11; i++) roster.push(mk('D' + i, 'MAGE', 'Frost'));
    const byName = {};
    roster.forEach(p => { byName[p.name] = p; });
    const groups = { groups: [
        { players: ['Mt', 'H1', 'H2'].map(n => byName[n]) },
        { players: ['D1', 'D2', 'D3', 'D4', 'D5'].map(n => byName[n]) },
        { players: ['D6', 'D7', 'D8', 'D9', 'D10'].map(n => byName[n]) },
        { players: ['D11'].map(n => byName[n]) },
    ] };
    const base = HP.computePositions(roster, groups, [], {});
    assert.ok(base.warnings.some(w => w.includes('bunched')), 'fixture broke: ' + JSON.stringify(base.warnings));
    const dragged = HP.computePositions(roster, groups, [], { nudges: mirrorNudge(base, 'H2') });
    assert.ok(!dragged.warnings.some(w => w.includes('bunched')),
        'bunching warning survived the drag: ' + JSON.stringify(dragged.warnings));
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
test('compute: swapTanks exchanges the boss tank and the station offtank', () => {
    const base = compute(fixtureRoster(), { boss: 'anetheron' });
    const swapped = compute(fixtureRoster(), { boss: 'anetheron', swapTanks: true });
    assert.strictEqual(base.markers.find(m => m.kind === 'mt').name, 'Mt');
    assert.strictEqual(base.markers.find(m => m.kind === 'offtank').name, 'Ot');
    assert.strictEqual(swapped.markers.find(m => m.kind === 'mt').name, 'Ot');
    assert.strictEqual(swapped.markers.find(m => m.kind === 'offtank').name, 'Mt');
});
test('compute: swapTanks on winterchill sends the old MT into the clump', () => {
    const r = compute(fixtureRoster(), { boss: 'winterchill', swapTanks: true });
    assert.strictEqual(r.markers.find(m => m.kind === 'mt').name, 'Ot');
    assert.ok(r.markers.find(m => m.kind === 'clump').names.includes('Mt'));
});
test('compute: swapTanks with a single tank is a no-op', () => {
    const roster = fixtureRoster().filter(p => p.name !== 'Ot');
    const r = compute(roster, { boss: 'anetheron', swapTanks: true });
    assert.strictEqual(r.markers.find(m => m.kind === 'mt').name, 'Mt');
});
test('anetheron: no marker carries the retired infernal-healer tag', () => {
    const r = compute(fixtureRoster(), { boss: 'anetheron' });
    assert.ok(!r.markers.some(m => (m.tags || []).includes('infernal-healer')));
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

// --- anchor nudges ---
test('anchorNudges: boss nudge translates the whole formation rigidly', () => {
    const base = compute(fixtureRoster());
    const moved = compute(fixtureRoster(), { anchorNudges: { boss: { dx: 0.03, dy: -0.02 } } });
    base.markers.forEach(b => {
        const m = moved.markers.find(x => (x.name || x.kind) === (b.name || b.kind));
        assert.ok(Math.abs(m.x - (b.x + 0.03)) < 1e-9, (b.name || b.kind) + ' did not follow in x');
        assert.ok(Math.abs(m.y - (b.y - 0.02)) < 1e-9, (b.name || b.kind) + ' did not follow in y');
    });
});
test('anchorNudges: clump nudge moves only the clump', () => {
    const base = compute(fixtureRoster());
    const moved = compute(fixtureRoster(), { anchorNudges: { clump: { dx: 0.04, dy: 0.01 } } });
    const bc = base.markers.find(m => m.kind === 'clump');
    const mc = moved.markers.find(m => m.kind === 'clump');
    assert.ok(Math.abs(mc.x - (bc.x + 0.04)) < 1e-9 && Math.abs(mc.y - (bc.y + 0.01)) < 1e-9);
    base.markers.filter(m => m.kind !== 'clump').forEach(b => {
        const m = moved.markers.find(x => (x.name || x.kind) === (b.name || b.kind));
        assert.strictEqual(m.x, b.x, (b.name || b.kind) + ' moved');
        assert.strictEqual(m.y, b.y, (b.name || b.kind) + ' moved');
    });
});
test('anchorNudges: station nudge carries the station and the offtank standing at it', () => {
    const base = compute(fixtureRoster(), { boss: 'anetheron' });
    const moved = compute(fixtureRoster(), { boss: 'anetheron', anchorNudges: { station: { dx: -0.03, dy: 0.05 } } });
    ['station', 'offtank'].forEach(kind => {
        const b = base.markers.find(m => m.kind === kind);
        const m = moved.markers.find(x => x.kind === kind);
        assert.ok(Math.abs(m.x - (b.x - 0.03)) < 1e-9 && Math.abs(m.y - (b.y + 0.05)) < 1e-9, kind + ' did not follow');
    });
    const bb = base.markers.find(m => m.kind === 'boss');
    const mb = moved.markers.find(m => m.kind === 'boss');
    assert.strictEqual(mb.x, bb.x, 'boss moved with the station');
});
test('anchorNudges: boss nudge leaves the station (a fixed map feature) in place', () => {
    const base = compute(fixtureRoster(), { boss: 'anetheron' });
    const moved = compute(fixtureRoster(), { boss: 'anetheron', anchorNudges: { boss: { dx: 0.03, dy: -0.02 } } });
    ['station', 'offtank'].forEach(kind => {
        const b = base.markers.find(m => m.kind === kind);
        const m = moved.markers.find(x => x.kind === kind);
        assert.strictEqual(m.x, b.x, kind + ' followed the boss');
        assert.strictEqual(m.y, b.y, kind + ' followed the boss');
    });
});
test('anchorNudges: an absurd boss nudge keeps every marker on the map', () => {
    const r = compute(fixtureRoster(), { anchorNudges: { boss: { dx: 5, dy: 5 }, clump: { dx: -9, dy: 0 } } });
    r.markers.forEach(m => {
        assert.ok(m.x >= 0.01 && m.x <= 0.99, (m.name || m.kind) + ' x out of bounds: ' + m.x);
        assert.ok(m.y >= 0.01 && m.y <= 0.99, (m.name || m.kind) + ' y out of bounds: ' + m.y);
    });
});

// --- nudge layering (save-as-template) ---
test('combineNudges: sums saved and live offsets per key', () => {
    const out = HP.combineNudges(
        { A: { dx: 0.1, dy: 0 }, B: { dx: 0, dy: 0.2 } },
        { B: { dx: 0.05, dy: -0.1 }, C: { dx: 1, dy: 2 } });
    assert.deepStrictEqual(out, {
        A: { dx: 0.1, dy: 0 },
        B: { dx: 0.05, dy: 0.2 + -0.1 },
        C: { dx: 1, dy: 2 },
    });
});
test('combineNudges: tolerates missing layers', () => {
    assert.deepStrictEqual(HP.combineNudges(null, { A: { dx: 1, dy: 1 } }), { A: { dx: 1, dy: 1 } });
    assert.deepStrictEqual(HP.combineNudges({ A: { dx: 1, dy: 1 } }, undefined), { A: { dx: 1, dy: 1 } });
});

// --- healer spread: slot choice inside wedges ---
test('compute: a healer-heavy wedge pushes its healers to the wedge edges', () => {
    // 12 ring slots (30 degrees apart). Both healers live in one 4-slot wedge: the old
    // centered interleave fixes them at wedge slots 1 and 3 (60 degrees apart); choosing
    // slots inside the wedge lets them stand at the edges, 90 degrees apart.
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true }),
        mk('H1', 'PRIEST', 'Holy'), mk('H2', 'PALADIN', 'Holy'),
        mk('D1', 'MAGE', 'Frost'), mk('D2', 'MAGE', 'Frost')];
    for (let i = 3; i <= 10; i++) roster.push(mk('D' + i, 'WARLOCK', 'Destruction'));
    const byName = {};
    roster.forEach(p => { byName[p.name] = p; });
    const groups = { groups: [
        { players: ['Mt', 'H1', 'H2', 'D1', 'D2'].map(n => byName[n]) },
        { players: ['D3', 'D4', 'D5', 'D6'].map(n => byName[n]) },
        { players: ['D7', 'D8', 'D9', 'D10'].map(n => byName[n]) },
    ] };
    const r = HP.computePositions(roster, groups, [], {});
    const healerAngles = r.markers.filter(m => m.kind === 'ring' && m.role === 'healer').map(m => m.angleDeg);
    assert.strictEqual(healerAngles.length, 2);
    assert.ok(HP.circGap(healerAngles[0], healerAngles[1]) >= 90 - 1e-6,
        'healer gap was ' + HP.circGap(healerAngles[0], healerAngles[1]));
});
test('compute: healer slot choice never breaks party contiguity', () => {
    const roster = [mk('Mt', 'WARRIOR', 'Protection', { mt: true }),
        mk('H1', 'PRIEST', 'Holy'), mk('H2', 'PALADIN', 'Holy'), mk('H3', 'SHAMAN', 'Restoration'),
        mk('D1', 'MAGE', 'Frost'), mk('D2', 'MAGE', 'Fire')];
    for (let i = 3; i <= 9; i++) roster.push(mk('D' + i, 'WARLOCK', 'Destruction'));
    const groups = E.proposeGroups(roster);
    const r = HP.computePositions(roster, groups, E.autoAssign(roster, {}).duties, {});
    const ring = r.markers.filter(m => m.kind === 'ring');
    [...new Set(ring.map(m => m.party))].forEach(pi => {
        const idxs = ring.map((m, i) => m.party === pi ? i : -1).filter(i => i !== -1);
        assert.strictEqual(idxs[idxs.length - 1] - idxs[0], idxs.length - 1, 'party ' + pi + ' not contiguous');
    });
});

// --- archimonde stack layout ---
function archCompute(roster, opts) {
    return HP.computePositions(roster, E.proposeGroups(roster), E.autoAssign(roster, {}).duties,
        Object.assign({ encounter: 'hyjal-archimonde', boss: 'archimonde' }, opts || {}));
}
function archRoster() {
    // 2 tanks, shamans of all three specs, healers, melee, ranged — enough for 3+ groups
    return [
        mk('Mt', 'WARRIOR', 'Protection', { mt: true }), mk('Ot', 'PALADIN', 'Protection'),
        mk('Rsham', 'SHAMAN', 'Restoration'), mk('Esham', 'SHAMAN', 'Enhancement'), mk('Csham', 'SHAMAN', 'Elemental'),
        mk('Hpal', 'PALADIN', 'Holy'), mk('Cpriest', 'PRIEST', 'Holy'), mk('Rdruid', 'DRUID', 'Restoration'),
        mk('Rog', 'ROGUE', 'Combat'), mk('Warr', 'WARRIOR', 'Fury'), mk('Kitty', 'DRUID', 'Feral'),
        mk('Hunt', 'HUNTER', 'Beast Mastery'), mk('Lock', 'WARLOCK', 'Destruction'), mk('Mage', 'MAGE', 'Frost'),
        mk('Spriest', 'PRIEST', 'Shadow'),
    ];
}
test('registry: hyjal-archimonde exists as a stacks-layout encounter with its own map and boss icon', () => {
    const enc = HP.ENCOUNTERS['hyjal-archimonde'];
    assert.ok(enc);
    assert.strictEqual(enc.layout, 'stacks');
    assert.strictEqual(enc.map, 'maps/hyjal-archimonde.png');
    assert.ok(enc.bosses[0].icon, 'boss icon path missing');
    assert.deepStrictEqual(enc.bosses.map(b => b.id), ['archimonde']);
});
test('stacks: every player renders exactly once — mt at the boss, everyone else in a party stack', () => {
    const roster = archRoster();
    const r = archCompute(roster);
    const names = r.markers.filter(m => m.name).map(m => m.name).sort();
    assert.deepStrictEqual(names, roster.map(p => p.name).sort());
    assert.strictEqual(r.markers.filter(m => m.kind === 'mt').length, 1);
    assert.ok(!r.markers.some(m => m.kind === 'ring' || m.kind === 'clump'), 'ring-layout markers leaked into stacks');
    const stackNames = r.markers.filter(m => m.kind === 'stack').map(m => m.name).sort();
    assert.deepStrictEqual(stackNames, roster.filter(p => p.name !== 'Mt').map(p => p.name).sort());
});
test('stacks: boss marker carries the portrait icon', () => {
    const r = archCompute(archRoster());
    const boss = r.markers.find(m => m.kind === 'boss');
    assert.strictEqual(boss.icon, HP.ENCOUNTERS['hyjal-archimonde'].bosses[0].icon);
});
test('stacks: each group clusters tightly and groups sit apart, one handle per group', () => {
    const enc = HP.ENCOUNTERS['hyjal-archimonde'];
    const r = archCompute(archRoster());
    const stackMarks = r.markers.filter(m => m.kind === 'stack');
    const parties = [...new Set(stackMarks.map(m => m.party))];
    const iso = m => ({ u: m.x, v: m.y / enc.aspect });
    const centroids = {};
    parties.forEach(pi => {
        const ms = stackMarks.filter(m => m.party === pi);
        ms.forEach(a => ms.forEach(b => {
            const d = Math.hypot(iso(a).u - iso(b).u, iso(a).v - iso(b).v);
            assert.ok(d < 0.09, 'party ' + pi + ' members ' + a.name + '/' + b.name + ' are ' + d.toFixed(3) + ' apart');
        }));
        centroids[pi] = {
            u: ms.reduce((s, m) => s + iso(m).u, 0) / ms.length,
            v: ms.reduce((s, m) => s + iso(m).v, 0) / ms.length,
        };
        const handles = r.markers.filter(m => m.kind === 'stackhandle' && m.party === pi);
        assert.strictEqual(handles.length, 1, 'party ' + pi + ' has ' + handles.length + ' handles');
    });
    for (let i = 0; i < parties.length; i++)
        for (let j = i + 1; j < parties.length; j++) {
            const a = centroids[parties[i]], b = centroids[parties[j]];
            const d = Math.hypot(a.u - b.u, a.v - b.v);
            assert.ok(d > 0.05, 'parties ' + parties[i] + ' and ' + parties[j] + ' overlap (' + d.toFixed(3) + ')');
        }
});
test('stacks: a melee-majority group stands near the boss, ranged groups at range', () => {
    const enc = HP.ENCOUNTERS['hyjal-archimonde'];
    const r = archCompute(archRoster());
    const boss = r.markers.find(m => m.kind === 'boss');
    const iso = m => ({ u: m.x, v: m.y / enc.aspect });
    const bossIso = iso(boss);
    const stackMarks = r.markers.filter(m => m.kind === 'stack');
    const parties = [...new Set(stackMarks.map(m => m.party))];
    const dists = {}, meleeish = {};
    parties.forEach(pi => {
        const ms = stackMarks.filter(m => m.party === pi);
        const cu = ms.reduce((s, m) => s + iso(m).u, 0) / ms.length;
        const cv = ms.reduce((s, m) => s + iso(m).v, 0) / ms.length;
        dists[pi] = Math.hypot(cu - bossIso.u, cv - bossIso.v);
        meleeish[pi] = ms.filter(m => m.role === 'melee' || m.role === 'tank').length * 2 > ms.length;
    });
    parties.forEach(pi => {
        if (meleeish[pi]) assert.ok(dists[pi] < 0.11, 'melee group ' + pi + ' is ' + dists[pi].toFixed(3) + ' from the boss');
        else assert.ok(dists[pi] > 0.09, 'ranged group ' + pi + ' is only ' + dists[pi].toFixed(3) + ' from the boss');
    });
    assert.ok(Object.values(meleeish).some(Boolean), 'fixture produced no melee-majority group');
});
test('stacks: shamans are tagged so the renderer can badge them', () => {
    const r = archCompute(archRoster());
    const tagged = r.markers.filter(m => (m.tags || []).includes('shaman')).map(m => m.name).sort();
    assert.deepStrictEqual(tagged, ['Csham', 'Esham', 'Rsham']);
});
test('stacks: a shamanless group warns about Tremor Totem', () => {
    // No shamans at all: every real group must warn.
    const roster = archRoster().filter(p => p.class !== 'SHAMAN');
    const r = archCompute(roster);
    assert.ok(r.warnings.some(w => /shaman/i.test(w) && /tremor/i.test(w)), JSON.stringify(r.warnings));
});
test('stacks: a raid with no mage or druid warns about decursers', () => {
    const roster = archRoster().filter(p => p.class !== 'MAGE' && p.class !== 'DRUID');
    const r = archCompute(roster);
    assert.ok(r.warnings.some(w => /decurs/i.test(w)), JSON.stringify(r.warnings));
    const full = archCompute(archRoster());
    assert.ok(!full.warnings.some(w => /decurs/i.test(w)), 'decurser warning fired with mages present');
});
test('stacks: boss nudge translates the whole scene rigidly', () => {
    const base = archCompute(archRoster());
    const moved = archCompute(archRoster(), { anchorNudges: { boss: { dx: 0.03, dy: -0.02 } } });
    base.markers.forEach(b => {
        const key = b.name || (b.kind + (b.party || ''));
        const m = moved.markers.find(x => (x.name || (x.kind + (x.party || ''))) === key);
        assert.ok(Math.abs(m.x - (b.x + 0.03)) < 1e-9 && Math.abs(m.y - (b.y - 0.02)) < 1e-9, key + ' did not follow');
    });
});
test('stacks: a party anchor nudge moves that stack and its handle, nothing else', () => {
    const base = archCompute(archRoster());
    const someParty = base.markers.find(m => m.kind === 'stack').party;
    const moved = archCompute(archRoster(), { anchorNudges: { ['party-' + someParty]: { dx: 0.05, dy: 0.04 } } });
    base.markers.forEach(b => {
        const key = b.name || (b.kind + (b.party || ''));
        const m = moved.markers.find(x => (x.name || (x.kind + (x.party || ''))) === key);
        const inParty = (b.kind === 'stack' || b.kind === 'stackhandle') && b.party === someParty;
        if (inParty) {
            assert.ok(Math.abs(m.x - (b.x + 0.05)) < 1e-9 && Math.abs(m.y - (b.y + 0.04)) < 1e-9, key + ' did not follow its handle');
        } else {
            assert.strictEqual(m.x, b.x, key + ' moved');
        }
    });
});
test('stacks: person nudges still land on individual stack members', () => {
    const base = archCompute(archRoster());
    const moved = archCompute(archRoster(), { nudges: { Mage: { dx: 0.04, dy: 0.03 } } });
    const b = base.markers.find(m => m.name === 'Mage');
    const m = moved.markers.find(x => x.name === 'Mage');
    assert.ok(Math.abs(m.x - (b.x + 0.04)) < 1e-9 && Math.abs(m.y - (b.y + 0.03)) < 1e-9);
});
test('stacks: all coordinates stay inside the image even under absurd nudges', () => {
    const r = archCompute(archRoster(), { anchorNudges: { boss: { dx: 9, dy: 9 }, 'party-1': { dx: -9, dy: 0 } } });
    r.markers.forEach(m => {
        assert.ok(m.x >= 0.01 && m.x <= 0.99 && m.y >= 0.01 && m.y <= 0.99, (m.name || m.kind) + ' escaped');
    });
});

// --- black temple: najentus spread-stacks encounter ---
function najCompute(roster, opts) {
    return HP.computePositions(roster, E.proposeGroups(roster), E.autoAssign(roster, {}).duties,
        Object.assign({ encounter: 'bt-najentus', boss: 'najentus' }, opts || {}));
}
test('registry: bt-najentus exists as a stacks-layout encounter with its own map and boss icon', () => {
    const enc = HP.ENCOUNTERS['bt-najentus'];
    assert.ok(enc);
    assert.strictEqual(enc.layout, 'stacks');
    assert.strictEqual(enc.map, 'maps/bt-najentus.png');
    assert.deepStrictEqual(enc.bosses.map(b => b.id), ['najentus']);
    assert.ok(enc.bosses[0].icon, 'boss icon path missing');
});
test('najentus: stack members spread for Impaling Spine — looser than the Archimonde default', () => {
    // Same roster on both encounters: every within-stack neighbour gap on Naj'entus must
    // beat Archimonde's 0.030 grid pitch, in isotropic (aspect-corrected) space.
    const roster = archRoster();
    const minNeighbourGap = (r, encId) => {
        const enc = HP.ENCOUNTERS[encId];
        const iso = m => ({ u: m.x, v: m.y / enc.aspect });
        const stacks = {};
        r.markers.filter(m => m.kind === 'stack').forEach(m => { (stacks[m.party] = stacks[m.party] || []).push(m); });
        let min = Infinity;
        Object.values(stacks).forEach(ms => {
            for (let i = 0; i < ms.length; i++)
                for (let j = i + 1; j < ms.length; j++)
                    min = Math.min(min, Math.hypot(iso(ms[i]).u - iso(ms[j]).u, iso(ms[i]).v - iso(ms[j]).v));
        });
        return min;
    };
    const naj = minNeighbourGap(najCompute(roster), 'bt-najentus');
    const arch = minNeighbourGap(archCompute(roster), 'hyjal-archimonde');
    assert.ok(naj > 0.045, 'najentus min member gap ' + naj.toFixed(3) + ' is not spine-spread');
    assert.ok(Math.abs(arch - 0.030) < 1e-6, 'archimonde grid pitch changed: ' + arch.toFixed(3));
});
test('najentus: no tremor or decurser warnings — those are Archimonde mechanics', () => {
    // A roster with no shamans and no mage/druid trips both warnings on Archimonde;
    // Naj’entus has no fear and no curse, so neither may fire there.
    const roster = archRoster().filter(p => p.class !== 'SHAMAN' && p.class !== 'MAGE' && p.class !== 'DRUID');
    const naj = najCompute(roster);
    assert.ok(!naj.warnings.some(w => /tremor/i.test(w)), JSON.stringify(naj.warnings));
    assert.ok(!naj.warnings.some(w => /decurs/i.test(w)), JSON.stringify(naj.warnings));
    const arch = archCompute(roster);
    assert.ok(arch.warnings.some(w => /tremor/i.test(w)) && arch.warnings.some(w => /decurs/i.test(w)),
        'archimonde lost its warnings: ' + JSON.stringify(arch.warnings));
});
test('stacks: swapTanks sends the second tank to the boss and the old MT to a stack', () => {
    const base = archCompute(archRoster());
    assert.strictEqual(base.markers.find(m => m.kind === 'mt').name, 'Mt');
    const swapped = archCompute(archRoster(), { swapTanks: true });
    assert.strictEqual(swapped.markers.find(m => m.kind === 'mt').name, 'Ot');
    assert.ok(swapped.markers.some(m => m.kind === 'stack' && m.name === 'Mt'),
        'old MT did not fall back to a group stack');
});
test('stacks: swapTanks with a single tank is a no-op', () => {
    const roster = archRoster().filter(p => p.name !== 'Ot');
    const r = archCompute(roster, { swapTanks: true });
    assert.strictEqual(r.markers.find(m => m.kind === 'mt').name, 'Mt');
});
test('najentus: no stack handle lands on the boss portrait', () => {
    // Loose spacing must not push a melee group's handle (one row above its stack) onto
    // the boss icon at the center of the formation.
    const enc = HP.ENCOUNTERS['bt-najentus'];
    const r = najCompute(archRoster());
    const boss = r.markers.find(m => m.kind === 'boss');
    const iso = m => ({ u: m.x, v: m.y / enc.aspect });
    r.markers.filter(m => m.kind === 'stackhandle').forEach(h => {
        const d = Math.hypot(iso(h).u - iso(boss).u, iso(h).v - iso(boss).v);
        assert.ok(d > 0.05, 'handle G' + h.party + ' is ' + d.toFixed(3) + ' from the boss icon');
    });
});
test('najentus: melee-majority group stands at the boss, ranged groups spread at range', () => {
    const enc = HP.ENCOUNTERS['bt-najentus'];
    const r = najCompute(archRoster());
    const boss = r.markers.find(m => m.kind === 'boss');
    const iso = m => ({ u: m.x, v: m.y / enc.aspect });
    const stacks = {};
    r.markers.filter(m => m.kind === 'stack').forEach(m => { (stacks[m.party] = stacks[m.party] || []).push(m); });
    Object.keys(stacks).forEach(pi => {
        const ms = stacks[pi];
        const cu = ms.reduce((s, m) => s + iso(m).u, 0) / ms.length;
        const cv = ms.reduce((s, m) => s + iso(m).v, 0) / ms.length;
        const d = Math.hypot(cu - iso(boss).u, cv - iso(boss).v);
        const meleeish = ms.filter(m => m.role === 'melee' || m.role === 'tank').length * 2 > ms.length;
        if (meleeish) assert.ok(d < 0.13, 'melee group ' + pi + ' is ' + d.toFixed(3) + ' from the boss');
        else assert.ok(d > 0.15, 'ranged group ' + pi + ' is only ' + d.toFixed(3) + ' from the boss');
    });
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
