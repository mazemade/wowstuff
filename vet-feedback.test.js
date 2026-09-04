'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vet-engine.js');
const P = require('./vet-profile.js');
const F = require('./vet-feedback.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-feedback-rotminster.json'), 'utf8'));
const db = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));
const PLAYER = { name: 'Rotminster', classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', schools: ['shadow'] };
const NAMES = { 50619: 'Anetheron', 50620: "Kaz'rogal" };

// --- Task 1: names, schools, kill selection
test('wclSpecName strips spaces the way WCL spells specs', () => {
    assert.strictEqual(F.wclSpecName('Beast Mastery'), 'BeastMastery');
    assert.strictEqual(F.wclSpecName('Destruction'), 'Destruction');
    assert.strictEqual(F.WCL_CLASS_NAME.WARLOCK, 'Warlock');
});
test('schoolsOf: casters by spec, physical roles physical, healers none', () => {
    assert.deepStrictEqual(F.schoolsOf('WARLOCK', 'Destruction', 'caster'), ['shadow']);
    assert.deepStrictEqual(F.schoolsOf('MAGE', 'Fire', 'caster'), ['fire']);
    assert.deepStrictEqual(F.schoolsOf('ROGUE', 'Combat', 'melee'), ['physical']);
    assert.deepStrictEqual(F.schoolsOf('PALADIN', 'Retribution', 'melee'), ['physical', 'holy']);
    assert.deepStrictEqual(F.schoolsOf('PRIEST', 'Holy', 'healer'), []);
});
test('pickKills: killed bosses only, lowest median first, capped at KILL_LIMIT', () => {
    const bosses = [];
    for (let i = 0; i < 12; i++) bosses.push({ encounterId: 100 + i, name: 'B' + i, medianPercent: 50 - i, kills: i === 3 ? 0 : 1 });
    bosses.push({ encounterId: 200, name: 'NoMedian', medianPercent: null, kills: 1 });
    const picked = F.pickKills({ parses: { bosses } });
    assert.strictEqual(picked.length, F.KILL_LIMIT);
    assert.strictEqual(picked[0].encounterId, 111);          // median 39, the lowest
    assert.ok(!picked.some(k => k.encounterId === 103));     // no kills
    assert.ok(!picked.some(k => k.encounterId === 200));     // null median sorts last, past the cap
    assert.deepStrictEqual(F.pickKills({ parses: null }), []);
});
test('median and round1', () => {
    assert.strictEqual(F.median([3, 1, 2]), 2);
    assert.strictEqual(F.median([4, 1, 2, 3]), 2.5);
    assert.strictEqual(F.median([]), null);
    assert.strictEqual(F.round1(130.855), 130.9);
    assert.strictEqual(F.round1(null), null);
});

// --- Task 2: fight context
test('fightContext on Anetheron: length, active time, raid rank, potions, not a bad pull', () => {
    const fc = F.fightContext(FX.kills['50619'].context, 'Rotminster', 'caster', 94.7);
    assert.strictEqual(fc.fight.durationSec, 130.9);
    assert.strictEqual(fc.fight.referenceDurationSec, 94.7);
    assert.strictEqual(fc.fight.raidGroup, 'dps');
    assert.strictEqual(fc.fight.raidGroupCount, 16);
    assert.strictEqual(fc.fight.raidGroupRank, 9);
    assert.strictEqual(fc.fight.raidGroupMedianPercent, 25.5);
    assert.strictEqual(fc.fight.raidDeaths, 1);
    assert.strictEqual(fc.fight.raidSpeedPercent, 30);
    assert.strictEqual(fc.fight.raidActivePercent, 92.4);
    assert.strictEqual(fc.fight.badPull, false);
    assert.strictEqual(fc.fight.badPullReason, null);
    assert.strictEqual(fc.me.activePercent, 91.6);
    assert.strictEqual(fc.me.dps, 1300.7);
    assert.strictEqual(fc.me.died, null);
    assert.strictEqual(fc.me.potionUse, 1);
    assert.strictEqual(fc.me.healthstoneUse, 0);
    assert.ok(fc.meRow && Array.isArray(fc.meRow.gear));
});
test('fightContext on Kaz\'rogal: an 1131 s pull where all 19 DPS parsed under 5 is a bad pull', () => {
    const fc = F.fightContext(FX.kills['50620'].context, 'Rotminster', 'caster', 93);
    assert.strictEqual(fc.fight.durationSec, 1130.6);
    assert.strictEqual(fc.fight.badPull, true);
    assert.ok(/1131s against a typical 93s/.test(fc.fight.badPullReason), fc.fight.badPullReason);
    assert.ok(/19 of 19 dps in the raid parsed under 5/.test(fc.fight.badPullReason), fc.fight.badPullReason);
    assert.strictEqual(fc.me.activePercent, 16.7);
    assert.strictEqual(fc.me.potionUse, 2);
    assert.strictEqual(fc.fight.raidDeaths, 3);
});
test('fightContext: a death is reported with time and killing blow; missing tables give nulls', () => {
    const fc = F.fightContext(FX.kills['50619'].context, 'Slyvester', 'caster', null);
    assert.deepStrictEqual(fc.me.died, { atSec: 33, by: 'Immolation' });
    const empty = F.fightContext({}, 'Nobody', 'caster', null);
    assert.strictEqual(empty.fight.durationSec, null);
    assert.strictEqual(empty.fight.raidGroupCount, 0);
    assert.strictEqual(empty.fight.badPull, false);
    assert.strictEqual(empty.me.activePercent, null);
    assert.strictEqual(empty.meRow, null);
});
test('fightContext: healers are ranked among healers, tanks among tanks', () => {
    const ctx = { fights: [{ startTime: 0, endTime: 100000 }], rankings: { data: [{ speed: { rankPercent: 50 }, execution: { rankPercent: 50 },
        roles: { dps: { characters: [{ name: 'D', amount: 1000, rankPercent: 50 }] }, healers: { characters: [{ name: 'H1', amount: 900, rankPercent: 60 }, { name: 'H2', amount: 700, rankPercent: 2 }] }, tanks: { characters: [] } } }] } };
    const fc = F.fightContext(ctx, 'h2', 'healer', null);
    assert.strictEqual(fc.fight.raidGroup, 'healers');
    assert.strictEqual(fc.fight.raidGroupRank, 2);
    assert.strictEqual(fc.fight.raidGroupCount, 2);
    assert.strictEqual(fc.me.dps, 700);
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
