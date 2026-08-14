'use strict';
const assert = require('node:assert');
const W = require('./wcl-mult.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: specNameToKey / WCL_SPECS ---
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
test('WCL_SPECS: 22 non-healer specs, keys match engine BASELINE, no healers', () => {
    const E = require('./assignments-engine.js');
    assert.strictEqual(W.WCL_SPECS.length, 22);
    W.WCL_SPECS.forEach(s => {
        assert.ok(E.BASELINE[s.specKey] > 0, s.specKey + ' must have a nonzero baseline');
        assert.strictEqual(W.specNameToKey(s.className, s.specName), s.specKey);
    });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
