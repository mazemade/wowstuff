'use strict';
const assert = require('node:assert');
const W = require('./wcl-mult.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: specNameToKey ---
test('specNameToKey: WCL-style names map to engine keys', () => {
    assert.strictEqual(W.specNameToKey('Hunter', 'BeastMastery'), 'HUNTER:Beast Mastery');
    assert.strictEqual(W.specNameToKey('Warlock', 'Destruction'), 'WARLOCK:Destruction');
    assert.strictEqual(W.specNameToKey('Druid', 'Guardian'), 'DRUID:Guardian');
});
test('specNameToKey: engine-style inputs round-trip (class upper, spec with space)', () => {
    assert.strictEqual(W.specNameToKey('HUNTER', 'Beast Mastery'), 'HUNTER:Beast Mastery');
});
test('specNameToKey: unknown class or spec gives null', () => {
    assert.strictEqual(W.specNameToKey('Deathknight', 'Blood'), null);
    assert.strictEqual(W.specNameToKey('Mage', 'Holy'), null);
    assert.strictEqual(W.specNameToKey(null, 'Arms'), null);
});
test('specNameToKey covers every damage-dealing engine spec, in both name forms', () => {
    const E = require('./assignments-engine.js');
    const damage = Object.keys(E.BASELINE).filter(k => E.BASELINE[k] > 0);
    assert.strictEqual(damage.length, 23);
    damage.forEach(key => {
        const cls = key.slice(0, key.indexOf(':'));
        const spec = key.slice(key.indexOf(':') + 1);
        assert.strictEqual(W.specNameToKey(cls, spec), key);
        // WCL writes multi-word spec names without the space ("BeastMastery").
        assert.strictEqual(W.specNameToKey(cls, spec.replace(/\s+/g, '')), key);
    });
});

// --- Task 2: shouldOverwrite ---
test('shouldOverwrite: untouched meta is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite(undefined), true);
    assert.strictEqual(W.shouldOverwrite({}), true);
    assert.strictEqual(W.shouldOverwrite({ mt: true }), true);
    assert.strictEqual(W.shouldOverwrite({ mult: 1 }), true); // untouched default
});
test('shouldOverwrite: value still equal to last auto is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.12, multAuto: 1.12 }), true);
});
test('shouldOverwrite: manual divergence is protected', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.3, multAuto: 1.12 }), false);
    assert.strictEqual(W.shouldOverwrite({ mult: 0.8 }), false); // manual, never fetched
    assert.strictEqual(W.shouldOverwrite({ mult: 1, multAuto: 1.12 }), false); // deliberately reset to 1
});

// --- Task 3: computeMult ---
const NOW = 1770000000000; // fixed fake "now"; startTimes are offsets from it
const DAY = 24 * 3600 * 1000;
function mkOpts(over) {
    return Object.assign({
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
        mediansByEncounter: { 101: { 'MAGE:Fire': 1000 }, 102: { 'MAGE:Fire': 2000 } },
        ranksByEncounter: {},
    }, over);
}
test('computeMult: single boss, single parse', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [{ amount: 1120, spec: 'Fire', startTime: NOW - 2 * DAY }],
    } }));
    assert.deepStrictEqual(r, { mult: 1.12, bosses: 1 });
});
test('computeMult: per-boss median (odd and even), then mean across bosses', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        // boss 101: amounts 900,1000,1100 -> median 1000 -> ratio 1.0
        101: [900, 1000, 1100].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
        // boss 102: amounts 2000,3000 -> median 2500 -> ratio 1.25
        102: [2000, 3000].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
    } }));
    assert.deepStrictEqual(r, { mult: 1.13, bosses: 2 }); // mean(1.0, 1.25) = 1.125 -> 1.13
});
test('computeMult: parses outside the 4-week window are ignored', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [
            { amount: 5000, spec: 'Fire', startTime: NOW - 29 * DAY }, // too old
            { amount: 1050, spec: 'Fire', startTime: NOW - 27 * DAY },
        ],
    } }));
    assert.deepStrictEqual(r, { mult: 1.05, bosses: 1 });
});
test('computeMult: off-spec parses are ignored (WCL spec-name form)', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [
            { amount: 5000, spec: 'Arcane', startTime: NOW - DAY },
            { amount: 980, spec: 'Fire', startTime: NOW - DAY },
        ],
    } }));
    assert.deepStrictEqual(r, { mult: 0.98, bosses: 1 });
});
test('computeMult: clamps to [0.5, 2]', () => {
    const hi = W.computeMult(mkOpts({ ranksByEncounter: { 101: [{ amount: 9000, spec: 'Fire', startTime: NOW - DAY }] } }));
    assert.strictEqual(hi.mult, 2);
    const lo = W.computeMult(mkOpts({ ranksByEncounter: { 101: [{ amount: 10, spec: 'Fire', startTime: NOW - DAY }] } }));
    assert.strictEqual(lo.mult, 0.5);
});
test('computeMult: no qualifying data gives null', () => {
    assert.strictEqual(W.computeMult(mkOpts({})), null);
    assert.strictEqual(W.computeMult(mkOpts({ ranksByEncounter: {
        101: [{ amount: 1000, spec: 'Arcane', startTime: NOW - DAY }],
    } })), null);
    // boss the player logged but no median for the spec on that boss
    assert.strictEqual(W.computeMult(mkOpts({
        mediansByEncounter: { 101: {} },
        ranksByEncounter: { 101: [{ amount: 1000, spec: 'Fire', startTime: NOW - DAY }] },
    })), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
