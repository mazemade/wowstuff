'use strict';
const assert = require('node:assert/strict');
const D = require('./tactics-data.js');
const L = require('./tactics-layout.js');
assert.deepEqual(Object.keys(D.FIGHTS), ['bt-najentus', 'bt-supremus', 'bt-akama'], 'tabs follow Black Temple boss order');
const A = require('./tactics-akama.js');
const fight = D.FIGHTS['bt-akama'];
const prepare = (id, roster) => A.prepareScene(fight, fight.scenes.find(s => s.id === id), L.assign(fight, roster));
const prepareWithClasses = (id, roster, classes) => {
    const assigned = L.assign(fight, roster);
    assigned.forEach(p => { p.class = classes[p.name] || null; });
    return A.prepareScene(fight, fight.scenes.find(s => s.id === id), assigned);
};
let passed = 0;
function test(name, fn) { fn(); console.log('ok -', name); passed++; }

test('every chapter has guidance, highlights, assets and independent finite frames', () => {
    const fs = require('node:fs');
    [fight.map, fight.portrait, ...fight.abilities.map(a => a.icon)].forEach(p => assert.ok(fs.existsSync(p), p));
    assert.equal(fight.scenes.length, 8);
    fight.scenes.forEach(s => {
        ['call', 'why', 'caption', 'mistake', 'chapter'].forEach(k => assert.ok(s[k], s.id + k));
        assert.ok(s.jobs.length >= 3);
        s.highlight.forEach(id => assert.ok(fight.abilities.some(a => a.id === id)));
        const sc = prepare(s.id);
        [0, s.duration / 2, s.duration].forEach(t => {
            const frame = A.simulate(fight, sc, t);
            assert.equal(Object.keys(frame.pos).length, 25);
            Object.values(frame.pos).forEach(p => assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)));
            assert.ok(fight.stateLabels[frame.stage]);
        });
    });
});
test('channelers die in order, lose their beams and do not acquire a tank', () => {
    const sc = prepare('channelers'), at = t => A.simulate(fight, sc, t);
    assert.equal(at(0).channels.length, 6);
    assert.equal(at(2000).channels.length, 5);
    assert.equal(at(12000).channels.length, 0);
    assert.ok(at(0).npcs.filter(n => n.kind === 'channeler').every(n => !n.targetId));
});
test('sorcerers restore a binding until killed and direct seeks restore it', () => {
    const sc = prepare('sorcerers'), at = t => A.simulate(fight, sc, t);
    assert.equal(at(0).channels.length, 1);
    assert.equal(at(4000).channels.length, 2);
    assert.equal(at(8000).channels.length, 1);
    const direct = at(5000); at(sc.duration); at(0);
    assert.deepEqual(at(5000), direct);
});
test('doorway enemies are picked up by real tanks and defenders stay off healers', () => {
    const sc = prepare('doorways'), frame = A.simulate(fight, sc, 7000);
    const adds = frame.npcs.filter(n => ['elementalist', 'spiritbinder', 'rogue', 'defender'].includes(n.kind));
    assert.equal(adds.length, 7);
    adds.forEach(n => assert.ok(sc.raid.some(p => p.id === n.targetId && p.kind === 'tank')));
    assert.equal(new Set(adds.map(n => n.targetId)).size, 3);
});
test('fire stays on its original ground while affected players leave its radius', () => {
    const sc = prepare('fire'), start = A.simulate(fight, sc, 1500), moved = A.simulate(fight, sc, 4500);
    assert.equal(start.hazards.length, 1);
    assert.deepEqual(start.hazards[0].at, moved.hazards[0].at);
    assert.ok(start.hazards[0].affectedIds.length);
    start.hazards[0].affectedIds.forEach(id => assert.ok(L.dist(fight, moved.pos[id], moved.hazards[0].at) > moved.hazards[0].radiusYards));
    assert.equal(A.simulate(fight, sc, 7500).hazards.length, 0);
});
test('final burn begins in its final formation with only a surviving controlled add', () => {
    const sc = prepare('burn'), frame = A.simulate(fight, sc, 5000);
    assert.equal(frame.phase, 2);
    assert.equal(frame.bossTarget, 'akama');
    assert.ok(frame.akamaHp < 1 && frame.bossHp < 1);
    assert.ok(frame.npcs.some(n => n.kind === 'defender' && n.targetId));
    assert.ok(frame.npcs.every(n => n.kind === 'defender'));
    const start = A.simulate(fight, sc, 0);
    assert.ok(start.npcs.every(n => n.kind === 'defender'));
    sc.raid.filter(p => p.name).forEach(p => assert.notDeepEqual(start.pos[p.id], sc.baseById[p.id]));
    const end = A.simulate(fight, sc, sc.duration);
    assert.equal(end.stage, 'complete'); assert.equal(end.bossHp, 0); assert.ok(end.akamaHp > 0);
    assert.equal(end.npcs.length, 0);
});
test('class names are case-insensitive for traps and third-tank support follows the non-paladin side', () => {
    const roster = { tanks: ['Left tank', 'Right tank', 'Support'], ranged: ['Hunter'] };
    const rightPaladin = prepareWithClasses('positioning', roster, { 'Right tank': 'PALADIN', Hunter: 'HUNTER' });
    assert.equal(rightPaladin.hasTraps, true);
    assert.equal(rightPaladin.tankJobs[rightPaladin.tanks[2]], 'Left support');
    const leftPaladin = prepareWithClasses('positioning', roster, { 'Left tank': 'PALADIN' });
    assert.equal(leftPaladin.tankJobs[leftPaladin.tanks[2]], 'Right support');
    const unknownClasses = prepare('positioning', roster);
    assert.equal(unknownClasses.tankJobs[unknownClasses.tanks[2]], 'Right support · example');
    const mechanicScene = prepareWithClasses('doorways', roster, { 'Right tank': 'PALADIN' });
    assert.equal(A.simulate(fight, mechanicScene, 2000).roles[mechanicScene.tanks[2]], 'Support');
});
test('a protection paladin imported third still takes a door and leaves the other side for support', () => {
    const roster = { tanks: ['Warrior', 'Guardian', 'ProtPaladin'], ranged: ['Hunter'] };
    const sc = prepareWithClasses('positioning', roster, { ProtPaladin: 'PROTPALADIN', Hunter: 'HUNTER' });
    const namedTank = id => sc.raid.find(p => p.id === id).name;
    assert.deepEqual(sc.tanks.slice(0, 3).map(namedTank), ['Warrior', 'ProtPaladin', 'Guardian']);
    assert.equal(sc.tankJobs[sc.tanks[1]], 'Right door');
    assert.equal(sc.tankJobs[sc.tanks[2]], 'Left support');
});
test('a roster without damage roles never advances the authored burn into a fake kill', () => {
    const sc = prepare('burn', { tanks: ['Tank'], healers: ['Healer'] });
    const frame = A.simulate(fight, sc, sc.duration);
    assert.equal(frame.phase, 1);
    assert.equal(frame.stage, 'bound');
    assert.equal(frame.bossHp, 1);
    assert.equal(frame.akamaHp, 1);
    assert.notEqual(frame.stage, 'complete');
    assert.match(frame.call, /No damage role loaded/);
});
test('completed exports retain roster names without stale tank, healing or burn instructions', () => {
    const sc = prepare('burn');
    const text = A.copyText(fight, sc, A.simulate(fight, sc, sc.duration));
    assert.match(text, /Shade defeated\. No active jobs remain\./);
    assert.doesNotMatch(text, /hold surviving adds|heal assigned add tanks|Lust and burn the Shade/i);
});
test('frames clamp time and never mutate encounter, prepared scene or assigned roster', () => {
    const sc = prepare('cycle'), before = JSON.stringify({ fight, sc });
    const direct = A.simulate(fight, sc, 26000);
    A.simulate(fight, sc, sc.duration); A.simulate(fight, sc, 0);
    assert.deepEqual(A.simulate(fight, sc, 26000), direct);
    assert.deepEqual(A.simulate(fight, sc, -100), A.simulate(fight, sc, 0));
    assert.deepEqual(A.simulate(fight, sc, Infinity), A.simulate(fight, sc, 0));
    assert.equal(JSON.stringify({ fight, sc }), before);
});
test('partial, two-tank and oversized rosters preserve every player without inventing roles', () => {
    for (const roster of [
        { tanks: ['Solo tank'] }, { ranged: ['Solo damage'] },
        { tanks: ['Left', 'Right'], healers: ['Heal'], ranged: ['Range'] },
        { tanks: ['L', 'R', 'D', 'Extra'], ranged: Array.from({ length: 29 }, (_, i) => 'R' + i) }
    ]) {
        const sc = prepare('cycle', roster), names = Object.values(roster).flat();
        assert.deepEqual(sc.raid.map(p => p.name).sort(), [...names].sort());
        const frame = A.simulate(fight, sc, 26000);
        const text = A.copyText(fight, sc, frame);
        names.forEach(n => assert.ok(text.includes(n)));
        assert.doesNotMatch(text, /Hateful|Misdirect|spine|volcano/i);
        frame.npcs.forEach(n => { if (n.targetId) assert.ok(sc.raid.some(p => p.id === n.targetId && p.kind === 'tank')); });
        if ((roster.tanks || []).length < 2) assert.ok(sc.missingRoles.length);
    }
});
console.log(`\n${passed} Shade of Akama checks passed`);
