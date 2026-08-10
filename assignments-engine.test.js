'use strict';
const assert = require('node:assert');
const E = require('./assignments-engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: inferSpec ---
test('inferSpec: deep prot warrior', () => {
    assert.deepStrictEqual(E.inferSpec('WARRIOR', [5, 5, 51]), { spec: 'Protection', ambiguous: false });
});
test('inferSpec: affliction lock', () => {
    assert.deepStrictEqual(E.inferSpec('WARLOCK', [41, 7, 13]), { spec: 'Affliction', ambiguous: false });
});
test('inferSpec: shallow hybrid is ambiguous but guessed', () => {
    const r = E.inferSpec('DRUID', [21, 20, 20]);
    assert.strictEqual(r.spec, 'Balance');
    assert.strictEqual(r.ambiguous, true);
});
test('inferSpec: exact tie is ambiguous', () => {
    assert.strictEqual(E.inferSpec('MAGE', [30, 30, 1]).ambiguous, true);
});
test('inferSpec: zero points gives null spec', () => {
    assert.deepStrictEqual(E.inferSpec('PRIEST', [0, 0, 0]), { spec: null, ambiguous: true });
});
test('inferSpec: unknown class gives null', () => {
    assert.deepStrictEqual(E.inferSpec('DEATHKNIGHT', [51, 0, 0]), { spec: null, ambiguous: true });
});

// --- Task 2: parseAddonExport ---
test('parseAddonExport: happy path with header', () => {
    const r = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/5/51;Bob:WARLOCK:41/7/13');
    assert.strictEqual(r.errors.length, 0);
    assert.deepStrictEqual(r.players[0], { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon' });
    assert.strictEqual(r.players[1].spec, 'Affliction');
});
test('parseAddonExport: newline separated works', () => {
    const r = E.parseAddonExport('Frostina:MAGE:10/48/3\nStabby:ROGUE:15/41/5');
    assert.strictEqual(r.players.length, 2);
    assert.strictEqual(r.players[0].spec, 'Fire');
});
test('parseAddonExport: unscanned player flagged spec-unknown', () => {
    const r = E.parseAddonExport('Afkguy:HUNTER:?');
    assert.strictEqual(r.players[0].spec, null);
    assert.deepStrictEqual(r.players[0].flags, ['spec-unknown']);
});
test('parseAddonExport: ambiguous build flagged but keeps guess', () => {
    const r = E.parseAddonExport('Hybrid:DRUID:21/20/20');
    assert.strictEqual(r.players[0].spec, 'Balance');
    assert.deepStrictEqual(r.players[0].flags, ['spec-ambiguous']);
});
test('parseAddonExport: junk lines collected as errors', () => {
    const r = E.parseAddonExport('RSS1;garbage here;Bob:WARLOCK:41/7/13;Nope:BADCLASS:1/2/3');
    assert.strictEqual(r.players.length, 1);
    assert.strictEqual(r.errors.length, 2);
});
test('parseAddonExport: empty input gives empty result', () => {
    assert.deepStrictEqual(E.parseAddonExport(''), { players: [], errors: [] });
});

// --- Task 3: parseRaidHelper ---
function rhFixture() {
    return {
        title: 'SSC Tuesday',
        signUps: [
            { name: 'Dave', className: 'Warlock', specName: 'Affliction', userId: 111, status: 'primary' },
            { name: 'Pyro', className: 'Mage', specName: 'Fire', userId: '222', status: 'primary' },
            { name: 'Benchy', className: 'Bench', specName: 'Bench', userId: 333, status: 'primary' },
            { name: 'Maybe', className: 'Rogue', specName: 'Combat', userId: 444, status: 'queued' },
            { name: 'Tanky', className: 'Paladin', specName: 'Protection1', userId: 555, status: 'primary' },
            { name: 'Petguy', className: 'Hunter', specName: 'Beastmastery', userId: 666, status: 'primary' },
            { name: 'Wat', className: 'Boomkin', specName: 'Balance', userId: 777, status: 'primary' },
            { name: 'NoSpec', className: 'Priest', specName: 'Flex', userId: 888, status: 'primary' },
        ],
    };
}
test('parseRaidHelper: primary signups become players with discordId', () => {
    const r = E.parseRaidHelper(rhFixture());
    const dave = r.players.find(p => p.name === 'Dave');
    assert.deepStrictEqual(dave, { name: 'Dave', class: 'WARLOCK', spec: 'Affliction', discordId: '111', flags: [], source: 'raidhelper' });
    assert.strictEqual(r.title, 'SSC Tuesday');
});
test('parseRaidHelper: bench and non-primary are excluded with reasons', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.deepStrictEqual(r.excluded, [{ name: 'Benchy', reason: 'Bench' }, { name: 'Maybe', reason: 'queued' }]);
});
test('parseRaidHelper: spec names normalized', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.strictEqual(r.players.find(p => p.name === 'Tanky').spec, 'Protection');
    assert.strictEqual(r.players.find(p => p.name === 'Petguy').spec, 'Beast Mastery');
});
test('parseRaidHelper: unknown class is an error, unknown spec is flagged', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.strictEqual(r.errors.length, 1);
    assert.ok(r.errors[0].includes('Boomkin'));
    const ns = r.players.find(p => p.name === 'NoSpec');
    assert.strictEqual(ns.spec, null);
    assert.deepStrictEqual(ns.flags, ['spec-unknown']);
});
test('parseRaidHelper: empty event reports error', () => {
    const r = E.parseRaidHelper({});
    assert.deepStrictEqual(r.players, []);
    assert.strictEqual(r.errors.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
