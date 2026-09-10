'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RAIDS, encounterContext } = require('./evaluation-encounters');
test('every TBC raid has explicit encounter context without supplying unverified armor', () => {
    assert.equal(Object.keys(RAIDS).length, 9);
    for (const [raid, names] of Object.entries(RAIDS)) for (const name of names) {
        const context = encounterContext({ name, kill: true });
        assert.equal(context.raid, raid); assert.notEqual(context.model, 'unknown'); assert.equal(context.armor, undefined);
        assert.ok(context.limitations.some(x => /Assignments/.test(x)));
    }
});
test('unknown and multi-phase encounters cannot masquerade as faithful single-target replays', () => {
    assert.equal(encounterContext({ name: 'Unknown Boss' }).model, 'unknown');
    assert.equal(encounterContext({ name: 'Illidan Stormrage' }).model, 'phased');
    assert.equal(encounterContext({ name: 'Anetheron' }).model, 'multi-target');
    assert.match(encounterContext({ name: 'Anetheron', kill: false }).limitations.join(' '), /unsuccessful/);
});
