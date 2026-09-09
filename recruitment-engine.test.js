'use strict';
const assert = require('node:assert');
const E = require('./recruitment-engine.js');
let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (err) { failed++; console.error('FAIL -', name, '\n   ', err.message); }
}
function player(cls, spec, extra) { return Object.assign({ class: cls, spec: spec, flags: [] }, extra); }

test('profiles: exposes all selectable raid profiles and editorial defaults', () => {
    assert.deepStrictEqual(E.PROFILES.map(p => p.id), ['general', 'bt', 'hyjal', 'ssc', 'tk', 'gruul', 'mag']);
    assert.deepStrictEqual(E.PROFILES.find(p => p.id === 'gruul').tanks, 2);
    assert.ok(E.PROFILES.find(p => p.id === 'mag').notes[0].includes('strategy-dependent'));
});
test('20-player roster: returns five sequential invitations and fills role gaps first', () => {
    const r = E.recommend(Array.from({ length: 20 }, () => player('MAGE', 'Arcane')), { raidId: 'general' });
    assert.strictEqual(r.openSlots, 5);
    assert.strictEqual(r.recommendations.length, 5);
    assert.ok(r.recommendations.every(x => x.role === 'tank' || x.role === 'healer'));
});
test('empty roster: plans a complete 25-player raid', () => {
    const r = E.recommend([], { raidId: 'general' });
    assert.strictEqual(r.openSlots, 25);
    assert.strictEqual(r.recommendations.length, 25);
    assert.deepStrictEqual(r.current, { tanks: 0, healers: 0, dps: 0, unknown: 0 });
});
test('full and over-cap rosters: preserve shortages but do not suggest removals', () => {
    const full = Array.from({ length: 25 }, () => player('MAGE', 'Arcane'));
    const a = E.recommend(full, { raidId: 'general' });
    const b = E.recommend(full.concat(player('MAGE', 'Arcane')), { raidId: 'general' });
    assert.strictEqual(a.openSlots, 0); assert.strictEqual(b.openSlots, 0);
    assert.deepStrictEqual(a.recommendations, []); assert.deepStrictEqual(b.recommendations, []);
    assert.ok(a.warnings.some(w => w.includes('No open slots')));
});
test('targets: invalid values are bounded and their sum never exceeds 25', () => {
    const r = E.recommend([], { raidId: 'general', tanks: 99, healers: 99 });
    assert.deepStrictEqual(r.targets, { tanks: 25, healers: 0, dps: 0 });
    assert.deepStrictEqual(E.recommend([], { tanks: -5, healers: 'bad' }).targets, { tanks: 0, healers: 6, dps: 19 });
    assert.deepStrictEqual(E.recommend([], { tanks: null, healers: '' }).targets, { tanks: 3, healers: 6, dps: 16 });
});
test('unknown and ambiguous specs: occupy a slot but do not become healer or DPS coverage', () => {
    const r = E.recommend([player('PRIEST', null, { flags: ['spec-unknown'] }), player('MAGE', 'Fire', { flags: ['spec-ambiguous'] }), player('MAGE', 'NotASpec')], {});
    assert.deepStrictEqual(r.current, { tanks: 0, healers: 0, dps: 0, unknown: 3 });
    assert.ok(r.warnings.some(w => w.includes('Unresolved roster members')));
});
test('main-tank and druid semantics: only valid MT classes tank; Guardian tanks; addon Feral needs verification', () => {
    const r = E.recommend([
        player('MAGE', 'Arcane', { mt: true }), player('WARRIOR', 'Fury', { mt: true }),
        player('DRUID', 'Guardian'), player('DRUID', 'Feral', { source: 'addon', name: 'FeralScan' }),
    ], {});
    assert.deepStrictEqual(r.current, { tanks: 2, healers: 0, dps: 1, unknown: 1 });
    assert.ok(r.warnings.some(w => w.includes('verify bear or cat')));
});
test('known zero talents: do not claim missing standard-spec utilities are covered', () => {
    const r = E.recommend([player('PALADIN', 'Protection', { talents: { kings: 0 } })], { tanks: 2, healers: 0 });
    const kings = r.recommendations.find(x => x.class === 'PALADIN' && x.reasons.some(reason => reason.includes('Kings coverage')));
    assert.ok(kings && kings.reasons.some(reason => reason.includes('Kings coverage')));
});
test('party synergy: enhancement wins over elemental for melee, elemental over enhancement for casters', () => {
    const base = [player('PALADIN', 'Protection'), player('WARLOCK', 'Affliction', { talents: { malediction: 3 } }), player('DRUID', 'Balance', { talents: { impFaerieFire: 3 } }), player('HUNTER', 'Beast Mastery'), player('PRIEST', 'Shadow')];
    const melee = base.concat(Array.from({ length: 15 }, () => player('ROGUE', 'Combat')));
    const casters = base.concat(Array.from({ length: 15 }, () => player('MAGE', 'Arcane')));
    const m = E.recommend(melee, { tanks: 1, healers: 0 }).recommendations;
    const c = E.recommend(casters, { tanks: 1, healers: 0 }).recommendations;
    assert.strictEqual(m.find(x => x.class === 'SHAMAN').spec, 'Enhancement');
    assert.strictEqual(c.find(x => x.class === 'SHAMAN').spec, 'Elemental');
});
test('repeated providers diminish: a short roster does not receive five shamans for Bloodlust', () => {
    const r = E.recommend(Array.from({ length: 20 }, () => player('ROGUE', 'Combat')), { tanks: 0, healers: 0 });
    assert.ok(r.recommendations.filter(x => x.class === 'SHAMAN').length < 5);
    assert.ok(r.recommendations.filter(x => x.reasons.join(' ').toLowerCase().includes('bloodlust')).length <= 1);
});
test('encounter specialists: missing priority classes are selected with direct reasons', () => {
    [['bt', 'MAGE', 'Council'], ['ssc', 'WARLOCK', 'Leotheras'], ['tk', 'WARLOCK', 'Capernian'], ['gruul', 'WARLOCK', 'Olm'], ['hyjal', 'PALADIN', 'AoE']].forEach(function (fixture) {
        const opts = fixture[0] === 'hyjal' ? { raidId: fixture[0] } : { raidId: fixture[0], tanks: 0, healers: 0 };
        const r = E.recommend(Array.from({ length: 20 }, () => player('ROGUE', 'Combat')), opts);
        assert.ok(r.recommendations.some(x => x.class === fixture[1] && x.reasons.some(reason => reason.includes(fixture[2]))), fixture[0]);
    });
});
test('shortage that cannot fit: leaves the warning visible', () => {
    const r = E.recommend(Array.from({ length: 24 }, () => player('MAGE', 'Arcane')), { tanks: 3, healers: 6 });
    assert.strictEqual(r.recommendations.length, 1);
    assert.ok(r.warnings.some(w => w.includes('tank target short by 2 after')));
    assert.ok(r.warnings.some(w => w.includes('healer target short by 6 after')));
});
test('deterministic and readonly: same input gives same output and is unchanged', () => {
    const roster = [player('WARRIOR', 'Protection', { name: 'Tank', flags: [] }), player('DRUID', 'Feral', { source: 'addon', name: 'Scan', flags: [] })];
    const before = JSON.stringify(roster);
    const a = E.recommend(roster, { raidId: 'bt' }); const b = E.recommend(roster, { raidId: 'bt' });
    assert.deepStrictEqual(a, b); assert.strictEqual(JSON.stringify(roster), before);
});
test('role gate: a mixed roster missing one tank and two healers gets those three roles before DPS', () => {
    const roster = [player('WARRIOR', 'Protection')]
        .concat(Array.from({ length: 4 }, () => player('PRIEST', 'Holy')))
        .concat(Array.from({ length: 15 }, () => player('WARLOCK', 'Destruction')));
    const r = E.recommend(roster, { tanks: 2, healers: 6 });
    assert.deepStrictEqual(r.recommendations.reduce((out, x) => { out[x.role]++; return out; }, { tank: 0, healer: 0, dps: 0 }), { tank: 1, healer: 2, dps: 2 });
    assert.ok(r.recommendations.slice(0, 3).every(x => x.role !== 'dps'));
});
test('normal caster filler: destruction is a viable recommended caster DPS spec', () => {
    const roster = [player('WARRIOR', 'Protection'), player('PALADIN', 'Protection', { talents: { kings: 1 } }), player('DRUID', 'Guardian'), player('PALADIN', 'Holy')]
        .concat(Array.from({ length: 5 }, () => player('PRIEST', 'Holy')))
        .concat(Array.from({ length: 4 }, () => player('MAGE', 'Arcane')))
        .concat([player('WARLOCK', 'Affliction', { talents: { malediction: 3 } }), player('DRUID', 'Balance', { talents: { impFaerieFire: 3 } }), player('PRIEST', 'Shadow'), player('PALADIN', 'Retribution'), player('SHAMAN', 'Elemental'), player('SHAMAN', 'Elemental'), player('SHAMAN', 'Elemental'), player('HUNTER', 'Beast Mastery')]);
    const r = E.recommend(roster, {});
    assert.ok(r.recommendations.some(x => x.spec === 'Destruction'));
});
test('full roster: reports missing encounter readiness without inventing invitations', () => {
    const r = E.recommend(Array.from({ length: 25 }, () => player('ROGUE', 'Combat')), { raidId: 'bt' });
    assert.deepStrictEqual(r.recommendations, []);
    assert.ok(r.warnings.some(w => w.includes('Council mage-tank')));
    assert.ok(r.warnings.some(w => w.includes('Illidan demon')));
});
test('known zero Malediction and Improved Faerie Fire remain uncovered', () => {
    const roster = [player('WARLOCK', 'Affliction', { talents: { malediction: 0 } }), player('DRUID', 'Balance', { talents: { impFaerieFire: 0 } })];
    const r = E.recommend(roster, { tanks: 0, healers: 0 });
    assert.ok(r.recommendations.some(x => x.spec === 'Affliction' && x.reasons.some(y => y.includes('Malediction'))));
    assert.ok(r.recommendations.some(x => x.spec === 'Balance' && x.reasons.some(y => y.includes('Improved Faerie Fire'))));
});

test('malformed records and unknown classes preserve occupied slots without throwing', () => {
    const r = E.recommend([null, 1, {}, player('PRIEST', 'Invalid'), player('__proto__', 'Arcane')]);
    assert.strictEqual(r.current.unknown, 5);
    assert.strictEqual(r.openSlots, 20);
    assert.strictEqual(r.recommendations.length, 20);
});
test('default targets are bounded when tank override consumes the roster', () => {
    [undefined, null, '', 'invalid'].forEach(healers => {
        assert.deepStrictEqual(E.recommend([], { tanks: 25, healers }).targets, { tanks: 25, healers: 0, dps: 0 });
    });
});
test('one Elemental with four caster beneficiaries does not justify another Elemental', () => {
    const roster = [player('SHAMAN', 'Elemental'), ...Array.from({ length: 4 }, () => player('MAGE', 'Arcane')),
        ...Array.from({ length: 19 }, () => player('PRIEST', 'Holy'))];
    const r = E.recommend(roster, { tanks: 0, healers: 19 });
    assert.notStrictEqual(r.recommendations[0].spec, 'Elemental');
});
test('Windfury explanations need weapon users; BM does not cast shaman totems', () => {
    for (const [cls, spec] of [['HUNTER', 'Beast Mastery'], ['DRUID', 'Feral']]) {
        const r = E.recommend(Array.from({ length: 20 }, () => player(cls, spec)), { tanks: 0, healers: 0 });
        r.recommendations.forEach((p, i) => {
            const priorWeaponUser = r.recommendations.slice(0, i).some(x => ['WARRIOR', 'ROGUE', 'PALADIN'].includes(x.class));
            if (!priorWeaponUser) assert.ok(!p.reasons.join(' ').includes('Windfury'));
            if (p.class === 'HUNTER') assert.ok(!p.reasons.join(' ').includes('Grace of Air'));
        });
    }
});
test('complete-plan refinement avoids a fourth paladin solely for another blessing', () => {
    const roster = [player('PALADIN', 'Protection'), player('WARRIOR', 'Protection'),
        player('SHAMAN', 'Restoration'), player('SHAMAN', 'Restoration'), player('DRUID', 'Restoration'), player('PRIEST', 'Holy'),
        player('WARRIOR', 'Arms'), player('WARRIOR', 'Fury'), player('ROGUE', 'Combat'), player('SHAMAN', 'Enhancement'),
        player('HUNTER', 'Beast Mastery'), player('HUNTER', 'Beast Mastery'), player('HUNTER', 'Survival'),
        player('MAGE', 'Arcane'), player('MAGE', 'Fire'), player('WARLOCK', 'Destruction'), player('WARLOCK', 'Affliction'),
        player('PRIEST', 'Shadow'), player('DRUID', 'Balance'), player('SHAMAN', 'Elemental')];
    const r = E.recommend(roster, { raidId: 'bt' });
    assert.ok(r.recommendations.some(p => p.spec === 'Guardian'));
    assert.ok(r.recommendations.filter(p => p.class === 'PALADIN').length <= 2);
    assert.deepStrictEqual(r.projected, { tanks: 3, healers: 6, dps: 16, unknown: 0 });
    assert.deepStrictEqual(r.warnings, []);
});
test('unresolved specs never supply spec buffs but known classes retain baseline abilities', () => {
    const roster = [player('MAGE', null, { name: 'UnknownMage', flags: ['spec-unknown'] }),
        ...Array.from({ length: 23 }, () => player('ROGUE', 'Combat'))];
    const r = E.recommend(roster, { raidId: 'bt', tanks: 0, healers: 0 });
    assert.strictEqual(r.recommendations[0].class, 'WARLOCK');
    assert.ok(r.warnings.some(w => w.includes('UnknownMage')));
});
test('varied feasible partial rosters always reach targets without changing players', () => {
    const options = [['WARRIOR', 'Protection'], ['DRUID', 'Guardian'], ['PRIEST', 'Holy'], ['SHAMAN', 'Restoration'], ['MAGE', 'Arcane'], ['HUNTER', 'Beast Mastery']];
    for (let n = 1; n <= 20; n++) {
        const roster = Array.from({ length: n }, (_, i) => player(...options[(i * 7 + n) % options.length]));
        const before = JSON.stringify(roster);
        const r = E.recommend(roster, { tanks: 3, healers: 6 });
        assert.strictEqual(r.recommendations.length, 25 - n);
        assert.strictEqual(Object.values(r.projected).reduce((a, b) => a + b), 25);
        if (r.current.tanks <= 3 && r.current.healers <= 6 && r.current.dps <= 16)
            assert.deepStrictEqual(r.projected, { tanks: 3, healers: 6, dps: 16, unknown: 0 });
        assert.strictEqual(JSON.stringify(roster), before);
    }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
