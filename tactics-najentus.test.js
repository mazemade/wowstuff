'use strict';
const assert = require('node:assert/strict');
const D = require('./tactics-data.js');
const L = require('./tactics-layout.js');
const N = require('./tactics-najentus.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok -', name); } catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); } }
const fight = D.FIGHTS['bt-najentus'];
const prepare = (id, roster) => N.prepareScene(fight, fight.scenes.find(s => s.id === id), L.assign(fight, roster || null));

test('cycle reconstructs impales, inventory, shield break and burst at exact boundaries', () => {
    const assigned = L.assign(fight, null), scene = N.prepareScene(fight, fight.scenes.find(s => s.id === 'cycle'), assigned);
    const original = JSON.stringify({ scene, assigned, fight });
    const at = t => N.simulate(fight, scene, t);
    const holder = scene.resolved.impales[0].rescuer, victim = scene.resolved.impales[0].victim;
    assert.ok(at(23999).impaled.includes(victim));
    assert.ok(!at(24000).impaled.includes(victim));
    assert.equal(at(24000).holders[holder], 1);
    assert.equal(at(60000).shield, true);
    assert.equal(at(64999).ready, false);
    assert.equal(at(65000).ready, true);
    assert.equal(at(66999).holders[holder], 1);
    assert.equal(at(67000).holders[holder] || 0, 0);
    assert.equal(at(67699).shield, true);
    assert.equal(at(67700).shield, false);
    assert.equal(at(67700).burst.damage, 8500);
    const extraction = at(24000);
    at(76000); at(0); at(67700);
    assert.deepEqual(at(24000), extraction);
    assert.equal(JSON.stringify({ scene, assigned, fight }), original);
});

test('pinned victim stays fixed while a deterministic eligible helper rescues and keeps the item', () => {
    const scene = prepare('impale');
    const cast = scene.resolved.impales[0], before = N.simulate(fight, scene, 2000), near = N.simulate(fight, scene, 4000);
    assert.notEqual(cast.victim, cast.rescuer);
    assert.deepEqual(before.pos[cast.victim], near.pos[cast.victim]);
    assert.equal(N.simulate(fight, scene, 4499).holders[cast.rescuer] || 0, 0);
    assert.equal(N.simulate(fight, scene, 4500).holders[cast.rescuer], 1);
    assert.equal(N.simulate(fight, scene, 4500).holders[cast.victim] || 0, 0);
});

test('standalone shield and burst own declared inventory and only throw from a ready holder in range', () => {
    const shield = prepare('shield'), burst = prepare('burst'), holder = burst.resolved.throwHolder;
    assert.ok(shield.resolved.initialHolders[shield.resolved.throwHolder]);
    assert.equal(N.simulate(fight, shield, 8999).shield, true);
    assert.equal(N.simulate(fight, burst, 3499).projectile, null);
    assert.equal(N.simulate(fight, burst, 5000).holders[holder] || 0, 0);
    assert.ok(N.simulate(fight, burst, 5001).projectile);
    assert.ok(L.dist(fight, N.simulate(fight, burst, 5000).pos[holder], fight.bossAt) <= 25);
    const waiting = N.simulate(fight, shield, 4500);
    assert.equal(waiting.shield, true);
    assert.equal(waiting.holders[shield.resolved.throwHolder], 1);
    assert.equal(waiting.stage, 'ready');
    assert.equal(waiting.call, 'Raid ready. Wait for the call.');
});

test('Needle highlights real nearby players without mutating the formation', () => {
    const scene = prepare('needle'), initial = N.simulate(fight, scene, 0), hit = N.simulate(fight, scene, 1000), done = N.simulate(fight, scene, 6500);
    assert.ok(hit.needles.length && hit.needles[0].hitIds.length >= 2);
    assert.deepEqual(hit.needles.map(n => n.targetId), scene.resolved.needleTargets);
    assert.ok(hit.needles.every(n => n.hitIds.every(id => scene.raid.some(p => p.id === id))));
    assert.ok(hit.needles[0].hitIds.every(id => scene.raid.some(p => p.id === id)));
    assert.notDeepEqual(initial.pos, done.pos, 'the authored close neighbor returns to their home');
    assert.deepEqual(done.pos[scene.resolved.clustered.neighborId], scene.resolved.clustered.original);
});

test('partial and oversized rosters remain finite, omit unavailable examples and seek deterministically', () => {
    const rosters = [
        { tanks: ['MT'], healers: [], melee: [], ranged: [] },
        { tanks: [], healers: [], melee: [], ranged: ['Solo'] },
        { tanks: ['A', 'B', 'C'], healers: [], melee: [], ranged: Array.from({ length: 28 }, (_, i) => 'R' + i) }
    ];
    rosters.forEach(roster => {
        const scene = prepare('cycle', roster);
        [0, 20000, 24000, 60000, 67000, 67700, 76000].forEach(t => {
            const frame = N.simulate(fight, scene, t);
            Object.values(frame.pos).forEach(p => assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)));
        });
        const direct = N.simulate(fight, scene, 67700);
        N.simulate(fight, scene, 76000); N.simulate(fight, scene, 0);
        assert.deepEqual(N.simulate(fight, scene, 67700), direct);
    });
});

test('cycle leaves the distinct spare holder equipped and drops every raid bar together', () => {
    const scene = prepare('cycle'), frame = N.simulate(fight, scene, 67700);
    const first = scene.resolved.impales[0].rescuer, spare = scene.resolved.impales[1].rescuer;
    assert.equal(frame.holders[first] || 0, 0, 'the called first holder spent one spine');
    assert.equal(frame.holders[spare], 1, 'the second helper retains the spare');
    const before = N.simulate(fight, scene, 67699), after = N.simulate(fight, scene, 67700);
    assert.ok(Object.values(before.hp).every(value => value === 1));
    assert.ok(Object.values(after.hp).every(value => value === .55), 'the raidwide drop is one shared instant');
});

test('helper selection chooses the nearest eligible raider with roster order as the tie breaker', () => {
    const assigned = L.assign(fight, null), source = fight.scenes.find(s => s.id === 'impale');
    const scene = N.prepareScene(fight, source, assigned), pair = scene.resolved.impales[0];
    const candidates = scene.raid.filter(p => p.id !== scene.resolved.mt && p.id !== pair.victim)
        .sort((a, b) => L.dist(fight, scene.baseById[a.id], scene.baseById[pair.victim]) - L.dist(fight, scene.baseById[b.id], scene.baseById[pair.victim]) || a.slotIndex - b.slotIndex);
    assert.equal(pair.rescuer, candidates[0].id);
});

test('a roster without a rescue pair cannot break the shield or invent a burst', () => {
    const scene = prepare('burst', { tanks: ['MT'], healers: [], melee: [], ranged: [] });
    const atThrow = N.simulate(fight, scene, 5000), atHit = N.simulate(fight, scene, 5700);
    assert.equal(scene.resolved.throwHolder, null);
    assert.equal(atThrow.shield, true);
    assert.equal(atThrow.projectile, null);
    assert.equal(atHit.shield, true);
    assert.equal(atHit.burst, null);
    assert.match(atHit.call, /No spine holder/);
});

test('completed recovery returns to normal and one-pair cycles never claim a spare', () => {
    const full = prepare('cycle'), before = N.simulate(fight, full, 74999), done = N.simulate(fight, full, 75000), end = N.simulate(fight, full, 76000);
    assert.equal(before.stage, 'recover');
    [done, end].forEach(frame => {
        assert.equal(frame.stage, 'normal'); assert.equal(frame.ready, false); assert.equal(frame.shield, false);
        assert.equal(frame.call, 'Spread again. Keep the spare spine.'); assert.ok(Object.values(frame.hp).every(value => value === 1));
    });
    const partial = prepare('cycle', { tanks: ['MT'], healers: [], melee: ['Melee'], ranged: ['Range'] });
    assert.equal(partial.resolved.impales.length, 1);
    assert.doesNotMatch(partial.caption + partial.jobs.flat().join(' '), /spare/i);
    const thrown = N.simulate(fight, partial, 67000), recovered = N.simulate(fight, partial, 75000);
    assert.equal(Object.keys(thrown.holders).length, 0);
    assert.equal(thrown.call, 'One holder throws. Prepare for the next shield.');
    assert.equal(recovered.call, 'Spread again. Prepare for the next shield.');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
