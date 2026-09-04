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

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
