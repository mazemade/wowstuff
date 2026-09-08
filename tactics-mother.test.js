'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Data = require('./tactics-data.js');
const Layout = require('./tactics-layout.js');
const Mother = require('./tactics-mother.js');
const Steps = require('./tactics-steps.js');
const fight = Data.FIGHTS['bt-mother'];
const prep = (id, roster) => Mother.prepareScene(fight, fight.scenes.find(s => s.id === id), Layout.assign(fight, roster));
const frame = (scene, t) => Mother.simulate(fight, scene, t);
assert.deepEqual(fight.scenes.map(s => s.id), ['overview', 'positioning', 'saber', 'attraction', 'return', 'beams', 'finish', 'cycle', 'door']);
for (const scene of fight.scenes) {
    assert(Steps.forFight(fight.id).forScene(scene.id).length);
    assert(scene.highlight.every(id => fight.abilities.some(a => a.id === id)), scene.id + ' spell details resolve');
}
for (const ability of fight.abilities) {
    assert(fs.existsSync(ability.icon));
    assert(ability.url || Number.isInteger(ability.spell), ability.name + ' has a real reference');
}
for (const id of ['positioning', 'door']) {
    const sc = prep(id), f = frame(sc, 0);
    assert.equal(sc.tanks.length, 3);
    sc.tanks.forEach(tank => assert.deepEqual(f.pos[tank], f.pos[sc.tanks[0]], 'tanks truly pixel-stack'));
    const backline = sc.raid.filter(p => ['healer', 'ranged'].includes(p.kind));
    assert(backline.every(p => Layout.dist(fight, f.pos[p.id], f.boss) > 18));
    assert.equal(new Set(backline.map(p => JSON.stringify(f.pos[p.id]))).size, backline.length, 'backline tokens do not overlap exactly');
    if (id === 'door') assert(backline.every(p => f.pos[p.id].y >= .89), 'door backline occupies one corner');
}
const saber = prep('saber');
assert.equal(frame(saber, 1500).saber.targetIds.length, 3);
assert(frame(saber, 1500).hp[saber.tanks[0]] < frame(saber, 4500).hp[saber.tanks[0]], 'healers recover the tank after a Lash');

const attraction = prep('attraction'), returning = prep('return');
assert.equal(attraction.fatalTargets.length, 3);
assert(attraction.fatalTargets.every(id => !attraction.tanks.includes(id)));
let firstClearTime;
for (let t = 0; t <= 5700; t += 50) {
    const f = frame(attraction, t);
    assert.equal(f.fatal.separated, f.fatal.distances.every(d => d.yards >= 25), 'clearance follows current distances at ' + t);
    assert.equal(f.fatal.active, !f.fatal.separated);
    if (f.fatal.separated && firstClearTime === undefined) firstClearTime = t;
    for (const id of attraction.fatalTargets) {
        assert.equal(f.fatal.targetClear[id], f.fatal.distances.filter(d => d.ids.includes(id)).every(d => d.yards >= 25));
        if (!f.fatal.targetClear[id]) for (const other of attraction.raid.filter(p => !attraction.fatalTargets.includes(p.id))) {
            assert(Layout.dist(fight, f.pos[id], f.pos[other.id]) > 15, 'active escape path avoids other raid members');
        }
    }
}
assert(firstClearTime < 5700, 'arrival at an authored endpoint is not the clear trigger');
assert.equal(Object.values(frame(attraction, 3000).fatal.targetClear).filter(Boolean).length, 1, 'one runner clears before the other two');
assert.deepEqual(frame(attraction, attraction.duration).pos, frame(returning, 0).pos, 'return continues from the exact split state');
for (const t of [0, 1200, 2000, 3700, returning.duration]) {
    const f = frame(returning, t);
    assert.equal(f.fatal.active, false);
    assert(Object.values(f.fatal.targetClear).every(Boolean), 'effects stay cleared while distances shrink');
}
assert.deepEqual(frame(returning, 3700).pos, returning.baseById);
assert(frame(returning, 2000).routes.length === 3);
assert.equal(frame(returning, 4000).routes.length, 0, 'return arrows end at home');
for (let t = 0; t <= 3700; t += 50) {
    const f = frame(returning, t);
    for (const id of returning.fatalTargets) {
        if (f.pos[id].x < f.boss.x) assert(Layout.dist(fight, f.pos[id], f.boss) > 18, 'return avoids the frontal tank area');
    }
}

const cycle = prep('cycle');
assert.equal(frame(cycle, 7999).fatal, null, 'no early teleport');
assert.deepEqual(frame(cycle, 8000).pos, frame(attraction, 0).pos);
assert.deepEqual(frame(cycle, 13700).pos, frame(returning, 0).pos);
assert.deepEqual(frame(cycle, 15700).pos, frame(returning, 2000).pos, 'full cycle actually travels home');
assert.deepEqual(frame(cycle, 17400).pos, cycle.baseById);
const complete = frame(cycle, 40000);
assert.equal(complete.stage, 'complete');
assert.equal(complete.bossHp, 0);
assert.equal(complete.bossVisible, false);
assert.deepEqual(complete.instructionRows, []);
assert.deepEqual(complete.roles, {});
assert.equal(complete.shriek, null);
assert.equal(complete.saber, null);
assert.equal(frame(prep('finish'), 0).bossHp, .1);

for (const roster of [{ tanks: ['Tank'] }, { ranged: ['Mage'] }, { tanks: ['A', 'B', 'C'], healers: ['H'] }, { tanks: ['A', 'B'], melee: ['M'], healers: ['H'] }]) {
    for (const source of fight.scenes) {
        const sc = prep(source.id, roster);
        for (const t of [0, source.duration / 2, source.duration]) {
            const f = frame(sc, t);
            assert.equal(Object.keys(f.pos).length, Object.values(roster).flat().length, 'no fabricated player');
            assert(Object.values(f.pos).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
            assert.notEqual(f.stage, 'complete', 'incomplete roster cannot demonstrate a kill');
            if (f.bossHp !== undefined) assert(f.bossHp > 0, 'an incomplete roster never displays a defeated boss');
        }
    }
}
const solo = prep('attraction', { tanks: ['Tank'] });
assert.match(Mother.resolveExplanation({ id: 'split' }, solo).title, /missing/i);
const noHealer = prep('saber', { tanks: ['A', 'B', 'C'] });
assert.equal(frame(noHealer, 4500).hp[noHealer.tanks[0]], .65, 'no fabricated healing');
for (const scene of fight.scenes.map(s => prep(s.id))) {
    const expected = frame(scene, scene.duration * .6);
    frame(scene, 0); frame(scene, scene.duration);
    assert.deepEqual(frame(scene, scene.duration * .6), expected, scene.id + ' reverse seeks are deterministic');
}
console.log('Mother Shahraz mechanics, roster, source and timeline checks passed');
