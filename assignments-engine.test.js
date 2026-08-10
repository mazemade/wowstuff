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

// --- Task 4: mergeRosters ---
function P(name, cls, spec, extra) {
    return Object.assign({ name, class: cls, spec, flags: [] }, extra || {});
}
test('mergeRosters: exact case-insensitive match attaches discordId', () => {
    const r = E.mergeRosters([P('Bob', 'WARLOCK', 'Affliction')], [P('bob', 'WARLOCK', 'Affliction', { discordId: '1' })], {});
    assert.strictEqual(r.roster[0].discordId, '1');
    assert.strictEqual(r.unmatched.raidhelper.length, 0);
});
test('mergeRosters: linkMap match beats name mismatch', () => {
    const r = E.mergeRosters([P('Grimshade', 'WARLOCK', 'Destruction')], [P('Dave', 'WARLOCK', 'Destruction', { discordId: '9' })], { 9: 'Grimshade' });
    assert.strictEqual(r.roster[0].discordId, '9');
});
test('mergeRosters: unique fuzzy containment matches', () => {
    const r = E.mergeRosters([P('Frostina', 'MAGE', 'Fire')], [P('frosti', 'MAGE', 'Fire', { discordId: '2' })], {});
    assert.strictEqual(r.roster[0].discordId, '2');
});
test('mergeRosters: spec disagreement flags and reports, addon wins', () => {
    const r = E.mergeRosters([P('Moonpie', 'DRUID', 'Balance')], [P('Moonpie', 'DRUID', 'Restoration', { discordId: '3' })], {});
    assert.strictEqual(r.roster[0].spec, 'Balance');
    assert.ok(r.roster[0].flags.includes('signed-as:Restoration'));
    assert.deepStrictEqual(r.mismatches, [{ name: 'Moonpie', signed: 'Restoration', actual: 'Balance' }]);
});
test('mergeRosters: unmatched on both sides reported', () => {
    const r = E.mergeRosters([P('Xx', 'ROGUE', 'Combat')], [P('TotallyDifferent', 'ROGUE', 'Combat', { discordId: '4' })], {});
    assert.strictEqual(r.unmatched.raidhelper.length, 1);
    assert.strictEqual(r.unmatched.addon.length, 1);
});
test('mergeRosters: no addon players means raid-helper is the roster', () => {
    const r = E.mergeRosters([], [P('Dave', 'WARLOCK', 'Affliction', { discordId: '1' })], {});
    assert.strictEqual(r.roster.length, 1);
    assert.strictEqual(r.roster[0].name, 'Dave');
});
test('mergeRosters: empty addon path does not mutate caller inputs', () => {
    const rhPlayers = [P('Dave', 'WARLOCK', 'Affliction', { discordId: '1' }), P('Bob', 'MAGE', 'Fire', { discordId: '2' })];
    const originalFlags0 = rhPlayers[0].flags;
    const originalFlags1 = rhPlayers[1].flags;
    const r = E.mergeRosters([], rhPlayers, {});
    r.roster[0].flags.push('mutated');
    r.roster[1].flags.push('mutated2');
    assert.deepStrictEqual(rhPlayers[0].flags, []);
    assert.deepStrictEqual(rhPlayers[1].flags, []);
    assert.strictEqual(rhPlayers[0].flags, originalFlags0);
    assert.strictEqual(rhPlayers[1].flags, originalFlags1);
});

// --- Task 5: autoAssign debuffs ---
function fullRoster() {
    return [
        P('Thunderfist', 'WARRIOR', 'Protection'), P('Smashy', 'WARRIOR', 'Arms'),
        P('Bob', 'WARLOCK', 'Affliction'), P('Grimshade', 'WARLOCK', 'Destruction'), P('Doomlord', 'WARLOCK', 'Demonology'),
        P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'), P('Bubbles', 'PALADIN', 'Protection'),
        P('Frostina', 'MAGE', 'Fire'), P('Sheepmaster', 'MAGE', 'Frost'),
        P('Moonpie', 'DRUID', 'Balance'), P('Treebeard', 'DRUID', 'Restoration'),
        P('Shadowmel', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy'),
        P('Legolass', 'HUNTER', 'Marksmanship'), P('Stabby', 'ROGUE', 'Combat'),
    ];
}
function duty(r, id) { return r.duties.find(d => d.id === id); }

test('autoAssign: full comp covers all core debuffs with right players', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'sunder').player, 'Thunderfist'); // prot preferred
    assert.strictEqual(duty(r, 'coe').player, 'Bob');            // affliction preferred
    assert.ok(['Grimshade', 'Doomlord'].includes(duty(r, 'cor').player));
    assert.strictEqual(duty(r, 'jow').player, 'Retdin');
    assert.strictEqual(duty(r, 'jol').player, 'Lightbringer');
    assert.ok(duty(r, 'joc'));                                   // 3 paladins present
    assert.strictEqual(duty(r, 'scorch').player, 'Frostina');    // fire required
    assert.strictEqual(duty(r, 'ff').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hm').player, 'Legolass');
    assert.strictEqual(duty(r, 'demo').player, 'Smashy');        // arms/fury preferred over tank
    assert.strictEqual(r.uncovered.length, 0);
});
test('autoAssign: one curse per warlock, spare lock gets personal curse', () => {
    const r = E.autoAssign(fullRoster(), {});
    const lockDuties = r.duties.filter(d => ['Bob', 'Grimshade', 'Doomlord'].includes(d.player));
    const curseHolders = new Set(r.duties.filter(d => ['coe', 'cor'].includes(d.id)).map(d => d.player));
    assert.strictEqual(curseHolders.size, 2);
    const spare = ['Bob', 'Grimshade', 'Doomlord'].find(n => !curseHolders.has(n));
    assert.ok(duty(r, 'curse:' + spare));
});
test('autoAssign: no paladins puts judgements in uncovered, joc omitted', () => {
    const roster = fullRoster().filter(p => p.class !== 'PALADIN');
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.some(u => u.id === 'jow'));
    assert.ok(r.uncovered.some(u => u.id === 'jol'));
    assert.ok(!r.uncovered.some(u => u.id === 'joc'));
    assert.ok(!duty(r, 'joc'));
});
test('autoAssign: only 2 paladins means no joc row at all', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.ok(!duty(r, 'joc'));
    assert.ok(!r.uncovered.some(u => u.id === 'joc'));
});
test('autoAssign: no warriors falls back demo shout to Curse of Weakness', () => {
    const roster = fullRoster().filter(p => p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    const demo = duty(r, 'demo');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(r.duties.filter(d => d.player === demo.player && ['coe', 'cor', 'demo'].includes(d.id)).length, 1);
    assert.ok(r.uncovered.some(u => u.id === 'sunder'));
});
test('autoAssign: manual override wins and displaced lock still gets a curse duty', () => {
    const r = E.autoAssign(fullRoster(), { coe: { player: 'Grimshade' } });
    assert.strictEqual(duty(r, 'coe').player, 'Grimshade');
    assert.ok(r.duties.some(d => d.player === 'Bob' && (d.id === 'cor' || d.id === 'curse:Bob')));
});
test('autoAssign: spec-unknown players are never auto-picked', () => {
    const roster = [P('Mystery', 'MAGE', null, { flags: ['spec-unknown'] })];
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.some(u => u.id === 'scorch'));
});
test('autoAssign: passives detected from comp', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.ok(r.passives.some(p => p.name === 'Misery' && p.player === 'Shadowmel'));
    assert.ok(r.passives.some(p => p.name === 'Blood Frenzy' && p.player === 'Smashy'));
    assert.ok(r.passives.some(p => p.name === "Winter's Chill" && p.player === 'Sheepmaster'));
});
test('autoAssign: empty roster gives all core debuffs uncovered', () => {
    const r = E.autoAssign([], {});
    assert.strictEqual(r.duties.length, 0);
    assert.ok(r.uncovered.length >= 8);
});

// --- Task 6: cooldowns + CC ---
test('autoAssign: two druids innervate first mage and reserve last', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.deepStrictEqual(duty(r, 'innervate:0'), { id: 'innervate:0', name: 'Innervate', category: 'cooldowns', player: 'Moonpie', target: 'Frostina' });
    assert.strictEqual(duty(r, 'innervate:1').target, 'HEALER_RESERVE');
});
test('autoAssign: lone druid reserves innervate for healers', () => {
    const roster = fullRoster().filter(p => p.name !== 'Treebeard');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'innervate:0').target, 'HEALER_RESERVE');
});
test('autoAssign: soulstone goes to first lock on holy priest', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'soulstone:0').player, 'Bob');
    assert.strictEqual(duty(r, 'soulstone:0').target, 'Holymel');
});
test('autoAssign: soulstone target falls back to non-priest healer', () => {
    const roster = fullRoster().filter(p => p.name !== 'Holymel');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'soulstone:0').target, 'Lightbringer'); // holy paladin
});
test('autoAssign: innervate target override honored', () => {
    const r = E.autoAssign(fullRoster(), { 'innervate:0': { target: 'Sheepmaster' } });
    assert.strictEqual(duty(r, 'innervate:0').target, 'Sheepmaster');
});
test('defaultCC: mages sheep moon/triangle, rogue saps square', () => {
    assert.deepStrictEqual(E.defaultCC(fullRoster()), [
        { mark: 'moon', ability: 'polymorph', player: 'Frostina' },
        { mark: 'triangle', ability: 'polymorph', player: 'Sheepmaster' },
        { mark: 'square', ability: 'sap', player: 'Stabby' },
    ]);
});
test('defaultCC: rows only for available classes', () => {
    const r = E.defaultCC(fullRoster().filter(p => p.class !== 'MAGE' && p.class !== 'ROGUE'));
    assert.deepStrictEqual(r, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
