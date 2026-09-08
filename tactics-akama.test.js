'use strict';
const assert = require('node:assert/strict');
const D = require('./tactics-data.js');
const L = require('./tactics-layout.js');
assert.deepEqual(Object.keys(D.FIGHTS), ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary', 'bt-bloodboil'], 'tabs follow Black Temple boss order');
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
    assert.equal(fight.scenes.length, 10);
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
test('the slow walk gathers stable tank-held adds at the moving Shade before cleanup', () => {
    const sc = prepare('walk'), at = t => A.simulate(fight, sc, t);
    assert.deepEqual(sc.sequence, { initialChannels: 1, kills: [2000], wavesAt: 0, approachAt: 2000, gatherAt: 5000, cleanupAt: 7000, engageAt: 14000, winAt: 26000 });
    const beforeCleanup = at(6000), cleaning = at(7500), engaged = at(14500);
    const waveIds = frame => frame.npcs.filter(n => n.id !== 'defender').map(n => n.id).sort();
    assert.equal(beforeCleanup.stage, 'approach');
    assert.equal(beforeCleanup.damageTarget, 'adds');
    assert.equal(beforeCleanup.npcs.length, 7);
    assert.deepEqual(waveIds(beforeCleanup), waveIds(at(5000)));
    sc.tanks.forEach(id => assert.ok(L.dist(fight, beforeCleanup.pos[id], beforeCleanup.boss) <= 10, id + ' is beside the moving Shade'));
    beforeCleanup.npcs.forEach(n => {
        if (!n.targetId) return;
        assert.ok(sc.tanks.includes(n.targetId));
        assert.ok(L.dist(fight, n.at, beforeCleanup.pos[n.targetId]) < 10, n.id + ' follows its real tank');
    });
    assert.ok(cleaning.npcs.some(n => n.id !== 'defender' && n.hp < 1), 'cleanup shows add health progress');
    assert.equal(engaged.damageTarget, 'shade');
    assert.equal(engaged.phase, 2);
});
test('default cleanup begins after rendezvous and never clears an add without its tank', () => {
    for (const id of ['walk', 'cycle']) {
        const sc = prepare(id), seq = sc.sequence, at = t => A.simulate(fight, sc, t);
        const gathered = at(seq.gatherAt), beforeCleanup = at(seq.cleanupAt - 1);
        assert.equal(gathered.npcs.length, 7);
        assert.equal(beforeCleanup.npcs.length, 7);
        assert.ok(gathered.npcs.filter(n => n.kind !== 'defender').every(n => L.dist(fight, n.at, gathered.boss) <= 16));
        assert.ok(at(seq.cleanupAt + 1600).npcs.every(n => n.kind === 'defender'));
        assert.equal(at(seq.cleanupAt + 3000).npcs.length, 0, 'default cleanup clears the final Defender before engagement');
        assert.equal(at(seq.engageAt - 1).bossTarget, null);
        assert.equal(at(seq.engageAt).bossTarget, 'akama');
    }
    const partial = prepare('walk', { tanks: ['Left'], ranged: ['Damage'] });
    const unmanaged = A.simulate(fight, partial, partial.sequence.cleanupAt + 1600).npcs.filter(n => n.targetId === null);
    assert.ok(unmanaged.length);
    assert.ok(unmanaged.every(n => n.hp === 1));
});
test('alternate tanks keep their stacked positions through release and its AoE covers both target groups', () => {
    const sc = prepare('aoe'), seq = sc.sequence, at = t => A.simulate(fight, sc, t);
    const beforeRelease = at(seq.approachAt - 1), release = at(seq.approachAt), cleave = at(seq.aoeAt);
    sc.tanks.forEach(id => assert.ok(L.dist(fight, beforeRelease.pos[id], release.pos[id]) < 1.5, id + ' does not snap back to a doorway'));
    cleave.npcs.filter(n => n.kind !== 'channeler').forEach(n => assert.ok(L.dist(fight, n.at, cleave.aoe.at) <= cleave.aoe.radiusYards));
});
test('walk exports name the current tank and damage jobs rather than stale doorway assignments', () => {
    const sc = prepare('walk', { tanks: ['Left', 'Right'], ranged: ['Damage'] }), frame = A.simulate(fight, sc, 7500), text = A.copyText(fight, sc, frame);
    assert.match(text, /hold adds for cleanup/i);
    assert.match(text, /clean up adds during the Shade’s walk/i);
    assert.doesNotMatch(text, /Left door; control incoming adds|Right door; control incoming adds/i);
});
test('shared walk and AoE calls replace repeated tank labels on the map', () => {
    for (const [id, time] of [['walk', 5000], ['walk', 7500], ['aoe', 6000], ['aoe', 7000]]) {
        const sc = prepare(id), frame = A.simulate(fight, sc, time);
        assert.ok(frame.call);
        sc.tanks.forEach(tank => assert.equal(frame.roles[tank], undefined, id + ' shows one shared call instead of overlapping tank labels'));
    }
    const positioning = prepare('positioning');
    assert.ok(positioning.raid.filter(p => p.kind === 'tank').every(p => p.label));
});
test('alternate stack keeps its Channeler state and never invents AoE damage without a damage role', () => {
    const named = prepare('aoe', { tanks: ['Left', 'Right'], ranged: ['Damage'] });
    const stack = A.simulate(fight, named, named.sequence.stackAt);
    assert.equal(stack.stage, 'gather');
    assert.match(A.copyText(fight, named, stack), /hold stacked adds at the Channelers/i);
    const noDamage = prepare('aoe', { tanks: ['Left', 'Right'], healers: ['Healer'] });
    const frame = A.simulate(fight, noDamage, noDamage.sequence.aoeAt + 500);
    assert.equal(frame.stage, 'gather');
    assert.equal(frame.damageTarget, null);
    assert.equal(frame.aoe, null);
    assert.equal(frame.channels.length, 6);
    assert.ok(frame.npcs.filter(n => n.kind !== 'channeler').every(n => n.hp === 1));
});
test('the alternative channeler AoE pull keeps the wave through the stack, cleaves it, then changes damage to the Shade', () => {
    const sc = prepare('aoe'), at = t => A.simulate(fight, sc, t);
    assert.equal(sc.sequence.strategy, 'channeler-aoe');
    assert.equal(at(6000).damageTarget, 'channels');
    assert.equal(at(6000).npcs.filter(n => n.kind === 'channeler').length, 6);
    assert.equal(at(6000).npcs.filter(n => n.id !== 'defender' && n.kind !== 'channeler').length, 6);
    const cleave = at(7000);
    assert.equal(cleave.stage, 'aoe');
    assert.equal(cleave.damageTarget, 'channels-and-adds');
    assert.ok(cleave.aoe, 'AoE is an explicit beneficial effect');
    assert.ok(cleave.npcs.some(n => n.kind !== 'channeler' && n.id !== 'defender' && n.hp < 1));
    const release = at(12600);
    assert.equal(release.channels.length, 0);
    assert.equal(release.damageTarget, 'shade');
    assert.ok(release.npcs.some(n => n.id === 'defender' && sc.tanks.includes(n.targetId)));
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
test('walk, cycle and alternate frames seek deterministically across incomplete and oversized rosters', () => {
    const rosters = [
        { tanks: ['Solo tank'] }, { healers: ['Solo healer'] }, { ranged: ['Solo damage'] },
        { tanks: ['Tank'], healers: ['Healer'], ranged: ['Damage'] },
        { tanks: ['Left', 'Right'], healers: ['Healer'], melee: ['Damage'] },
        { tanks: ['L', 'R', 'S', 'Extra'], ranged: Array.from({ length: 29 }, (_, i) => 'R' + i) }
    ];
    for (const id of ['walk', 'cycle', 'aoe']) for (const roster of rosters) {
        const sc = prepare(id, roster), times = new Set([0, sc.duration]);
        Object.values(sc.sequence).forEach(value => {
            if (Number.isFinite(value)) [value - 1, value, value + 1].forEach(t => times.add(t));
        });
        [...times].forEach(t => {
            const frame = A.simulate(fight, sc, t);
            Object.values(frame.pos).forEach(p => assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)));
            assert.ok(Number.isFinite(frame.bossHp) && Number.isFinite(frame.akamaHp));
            frame.npcs.forEach(n => assert.ok(!n.targetId || sc.tanks.includes(n.targetId)));
        });
        const middle = Math.floor(sc.duration / 2), direct = A.simulate(fight, sc, middle);
        A.simulate(fight, sc, sc.duration); A.simulate(fight, sc, 0);
        assert.deepEqual(A.simulate(fight, sc, middle), direct, id + ' direct seek');
    }
});
console.log(`\n${passed} Shade of Akama checks passed`);
