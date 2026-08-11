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
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer'); // holy/prot judge, ret keeps its damage seal
    assert.strictEqual(duty(r, 'jol').player, 'Bubbles');
    assert.ok(duty(r, 'joc'));                                   // 3 paladins present
    assert.strictEqual(duty(r, 'scorch').player, 'Frostina');    // fire required
    assert.strictEqual(duty(r, 'ff').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hm').player, 'Legolass');
    assert.strictEqual(duty(r, 'demo').player, 'Smashy');        // arms/fury preferred over tank
    assert.strictEqual(r.uncovered.missing.length, 0);
});
test('autoAssign: one curse per warlock, spare lock gets personal curse', () => {
    const r = E.autoAssign(fullRoster(), {});
    const curseHolders = new Set(r.duties.filter(d => ['coe', 'cor'].includes(d.id)).map(d => d.player));
    assert.strictEqual(curseHolders.size, 2);
    const spare = ['Bob', 'Grimshade', 'Doomlord'].find(n => !curseHolders.has(n));
    assert.ok(duty(r, 'curse:' + spare));
});
test('autoAssign: no paladins puts judgements in missing, joc is not applicable', () => {
    const roster = fullRoster().filter(p => p.class !== 'PALADIN');
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.missing.some(u => u.id === 'jow'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'jol'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
    assert.ok(!duty(r, 'joc'));
});
test('autoAssign: with two paladins including a ret, joc is covered and jol goes missing', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer');
    assert.ok(r.uncovered.missing.some(u => u.id === 'jol'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'joc'));
});
test('autoAssign: no warriors falls back demo shout to Curse of Weakness', () => {
    const roster = fullRoster().filter(p => p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    const demo = duty(r, 'demo');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(r.duties.filter(d => d.player === demo.player && ['coe', 'cor', 'demo'].includes(d.id)).length, 1);
    assert.ok(r.uncovered.missing.some(u => u.id === 'sunder'));
});
test('autoAssign: manual override wins and displaced lock still gets a curse duty', () => {
    const r = E.autoAssign(fullRoster(), { coe: { player: 'Grimshade' } });
    assert.strictEqual(duty(r, 'coe').player, 'Grimshade');
    assert.ok(r.duties.some(d => d.player === 'Bob' && (d.id === 'cor' || d.id === 'curse:Bob')));
});
test('autoAssign: spec-unknown players are never auto-picked', () => {
    const roster = [P('Mystery', 'MAGE', null, { flags: ['spec-unknown'] })];
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.missing.some(u => u.id === 'scorch'));
});
test('autoAssign: passives detected from comp', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.ok(r.passives.some(p => p.name === 'Misery' && p.player === 'Shadowmel'));
    assert.ok(r.passives.some(p => p.name === 'Blood Frenzy' && p.player === 'Smashy'));
});
test('autoAssign: empty roster puts all core debuffs in missing', () => {
    const r = E.autoAssign([], {});
    assert.strictEqual(r.duties.length, 0);
    assert.ok(r.uncovered.missing.length >= 8);
});
test('autoAssign: explicitly-unassigned debuff keeps its row with a null player and appears in uncovered', () => {
    const r = E.autoAssign(fullRoster(), { sunder: { player: null } });
    assert.strictEqual(duty(r, 'sunder').player, null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'sunder'));
});
test('autoAssign: no override at all still auto-assigns the debuff normally', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'sunder').player, 'Thunderfist');
    assert.ok(!r.uncovered.missing.some(u => u.id === 'sunder'));
});
test('autoAssign: re-assigning after an explicit unassignment escapes the dead end', () => {
    const cleared = E.autoAssign(fullRoster(), { sunder: { player: null } });
    assert.strictEqual(duty(cleared, 'sunder').player, null);
    const reassigned = E.autoAssign(fullRoster(), { sunder: { player: 'Thunderfist' } });
    assert.strictEqual(duty(reassigned, 'sunder').player, 'Thunderfist');
    assert.ok(!reassigned.uncovered.missing.some(u => u.id === 'sunder'));
});
test('autoAssign: an explicitly cleared row counts as missing, not notApplicable', () => {
    const r = E.autoAssign(fullRoster(), { sunder: { player: null } });
    assert.ok(r.uncovered.missing.some(u => u.id === 'sunder'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'sunder'));
});
test('autoAssign: applicableWhen false skips the entry as notApplicable', () => {
    // No shipped entry uses applicableWhen until Task 4, so exercise the mechanism with a
    // temporary catalog entry. DEBUFF_CATALOG is exported by reference, so push/pop works.
    E.DEBUFF_CATALOG.push({ id: 'testonly', name: 'Test Only', category: 'debuffs',
        class: 'MAGE', preferSpecs: [], applicableWhen: () => false });
    try {
        const r = E.autoAssign(fullRoster(), {});
        assert.ok(!duty(r, 'testonly'));
        assert.ok(r.uncovered.notApplicable.some(u => u.id === 'testonly'));
        assert.ok(!r.uncovered.missing.some(u => u.id === 'testonly'));
    } finally {
        E.DEBUFF_CATALOG.pop();
    }
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
test('autoAssign: explicitly-unassigned innervate keeps its row with a null player and no target', () => {
    const r = E.autoAssign(fullRoster(), { 'innervate:0': { player: null } });
    assert.deepStrictEqual(duty(r, 'innervate:0'), { id: 'innervate:0', name: 'Innervate', category: 'cooldowns', player: null });
    assert.ok(duty(r, 'innervate:1')); // other druid's row is unaffected
});
test('defaultCC: mages sheep moon/triangle', () => {
    assert.deepStrictEqual(E.defaultCC(fullRoster()), [
        { mark: 'moon', ability: 'polymorph', player: 'Frostina' },
        { mark: 'triangle', ability: 'polymorph', player: 'Sheepmaster' },
    ]);
});
test('defaultCC: rows only for available classes', () => {
    const r = E.defaultCC(fullRoster().filter(p => p.class !== 'MAGE'));
    assert.deepStrictEqual(r, []);
});
test('CC_ABILITIES: sap is not offered', () => {
    assert.ok(!E.CC_ABILITIES.some(a => a.id === 'sap'));
});

// --- Task 7: output builders ---
function sampleSheet() {
    const roster = fullRoster();
    roster.find(p => p.name === 'Bob').discordId = '42';
    const r = E.autoAssign(roster, {});
    return { roster, sheet: Object.assign({}, r, { cc: E.defaultCC(roster) }) };
}
test('buildDiscord: has title, sections, and plain names without pings', () => {
    const { roster, sheet } = sampleSheet();
    const out = E.buildDiscord(roster, sheet, { pings: false, title: 'SSC Tuesday' });
    assert.ok(out.includes('SSC Tuesday'));
    assert.ok(out.includes('**Debuffs**'));
    assert.ok(out.includes('**Cooldowns**'));
    assert.ok(out.includes('**Crowd Control**'));
    assert.ok(out.includes('Curse of Elements — Bob'));
    assert.ok(!out.includes('<@'));
});
test('buildDiscord: pings replace linked names only', () => {
    const { roster, sheet } = sampleSheet();
    const out = E.buildDiscord(roster, sheet, { pings: true, title: '' });
    assert.ok(out.includes('<@42>'));
    assert.ok(out.includes('Thunderfist')); // no discordId -> plain
});
test('buildDiscord: healer reserve rendered readably', () => {
    const { roster, sheet } = sampleSheet();
    assert.ok(E.buildDiscord(roster, sheet, { pings: false, title: '' }).includes('healer in need'));
});
test('buildDiscord: uncovered warning included', () => {
    const roster = fullRoster().filter(p => p.class !== 'HUNTER');
    const r = E.autoAssign(roster, {});
    const out = E.buildDiscord(roster, Object.assign({}, r, { cc: [] }), { pings: false, title: '' });
    assert.ok(out.includes('Uncovered'));
    assert.ok(out.includes("Hunter's Mark"));
});
test('buildRaidLines: all lines fit chat limit and carry prefix', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildRaidLines(roster, sheet);
    assert.ok(lines.length >= 1);
    lines.forEach(l => { assert.ok(l.startsWith('/raid ')); assert.ok(l.length <= 255); });
    assert.ok(lines.join(' ').includes('{moon}'));
});
test('buildWhispers: one line per assigned player, duties combined', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildWhispers(roster, sheet);
    const bob = lines.find(l => l.startsWith('/w Bob '));
    assert.ok(bob.includes('Curse of Elements'));
    assert.ok(bob.includes('Soulstone'));
    assert.strictEqual(lines.filter(l => l.startsWith('/w Bob ')).length, 1);
});
test('buildRaidLines: a single over-long item is truncated to fit the chat limit', () => {
    const longName = 'X'.repeat(300);
    const sheet = {
        duties: [{ id: 'long', name: 'Very Long Duty Name That Goes On And On', category: 'debuffs', player: longName }],
        uncovered: [], passives: [], cc: [],
    };
    const lines = E.buildRaidLines([], sheet);
    assert.ok(lines.length >= 1);
    lines.forEach(l => { assert.ok(l.startsWith('/raid ')); assert.ok(l.length <= 255); });
});

// --- Task 8: whole-branch review fixes — explicit-target overrides honored ---
test('autoAssign: explicitly-null target on innervate:0 drops the target key, player unchanged', () => {
    const r = E.autoAssign(fullRoster(), { 'innervate:0': { target: null } });
    const d = duty(r, 'innervate:0');
    assert.strictEqual(d.player, 'Moonpie'); // unchanged default druid
    assert.ok(!Object.prototype.hasOwnProperty.call(d, 'target'));
});
test('autoAssign: explicitly-null target on soulstone:0 drops the target key, player unchanged', () => {
    const r = E.autoAssign(fullRoster(), { 'soulstone:0': { target: null } });
    const d = duty(r, 'soulstone:0');
    assert.strictEqual(d.player, 'Bob'); // unchanged default lock
    assert.ok(!Object.prototype.hasOwnProperty.call(d, 'target'));
});
test('autoAssign: override with only a player key still gets its default target', () => {
    const r = E.autoAssign(fullRoster(), { 'innervate:0': { player: 'Treebeard' } });
    const d = duty(r, 'innervate:0');
    assert.strictEqual(d.player, 'Treebeard');
    assert.strictEqual(d.target, 'Frostina'); // default target expression still applies
});

// --- Task 9: whole-branch review fixes — demo override to a warlock respects curse exclusivity ---
test('autoAssign: overriding demo to a warlock records Curse of Weakness and skips the personal curse', () => {
    const r = E.autoAssign(fullRoster(), { demo: { player: 'Grimshade' } });
    const demo = duty(r, 'demo');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(demo.player, 'Grimshade');
    assert.ok(!r.duties.some(d => d.id === 'curse:Grimshade'));
    assert.strictEqual(r.duties.filter(d => d.player === 'Grimshade' && ['coe', 'cor', 'demo'].includes(d.id)).length, 1);
});
test('autoAssign: overriding demo to a warrior is untouched, still Demoralizing Shout', () => {
    const r = E.autoAssign(fullRoster(), { demo: { player: 'Thunderfist' } });
    const demo = duty(r, 'demo');
    assert.strictEqual(demo.name, 'Demoralizing Shout');
    assert.strictEqual(demo.player, 'Thunderfist');
});

// --- Task 10: whole-branch review fixes — duplicate addon names rejected ---
test('parseAddonExport: duplicate name is flagged as an error and the duplicate is skipped', () => {
    const r = E.parseAddonExport('Bob:WARLOCK:41/7/13;Bob:MAGE:60/0/0');
    assert.strictEqual(r.players.length, 1);
    assert.strictEqual(r.players[0].class, 'WARLOCK');
    assert.ok(r.errors.includes('Duplicate name: Bob'));
});

// --- Task 11: whole-branch review fixes — parseRaidHelper truthy non-array signUps ---
test('parseRaidHelper: truthy non-array signUps reports the error instead of throwing', () => {
    const r = E.parseRaidHelper({ title: 'X', signUps: { not: 'an array' } });
    assert.deepStrictEqual(r.players, []);
    assert.strictEqual(r.errors.length, 1);
    assert.ok(r.errors[0].includes('No signups found'));
});

// --- Raid-Helper endpoint fix: tolerate the other field casing ---
test('parseRaidHelper: lowercase signups/class/spec/userid are read', () => {
    const r = E.parseRaidHelper({
        title: 'Kara',
        signups: [{ name: 'Dave', class: 'Warlock', spec: 'Affliction', userid: 111 }],
    });
    assert.deepStrictEqual(r.players, [
        { name: 'Dave', class: 'WARLOCK', spec: 'Affliction', discordId: '111', flags: [], source: 'raidhelper' },
    ]);
    assert.strictEqual(r.title, 'Kara');
});
test('parseRaidHelper: class and spec names match regardless of case', () => {
    const r = E.parseRaidHelper({ signUps: [{ name: 'Petguy', className: 'hunter', specName: 'BEASTMASTERY' }] });
    assert.strictEqual(r.errors.length, 0);
    assert.strictEqual(r.players[0].class, 'HUNTER');
    assert.strictEqual(r.players[0].spec, 'Beast Mastery');
});
test('parseRaidHelper: lowercase bench is still excluded, keeping the raw reason', () => {
    const r = E.parseRaidHelper({ signUps: [{ name: 'Benchy', className: 'bench' }] });
    assert.deepStrictEqual(r.excluded, [{ name: 'Benchy', reason: 'bench' }]);
    assert.deepStrictEqual(r.players, []);
});

// --- Addon whispers: RSW1 paste payload ---
test('buildAddonWhispers: RSW1 header, then one Name=body line per player', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n');
    assert.strictEqual(lines[0], 'RSW1');
    const bob = lines.filter(l => l.startsWith('Bob='));
    assert.strictEqual(bob.length, 1);
    assert.ok(bob[0].includes('Curse of Elements'));
    assert.ok(bob[0].includes('Soulstone'));
});
test('buildAddonWhispers: same recipients as the Whispers tab', () => {
    const { roster, sheet } = sampleSheet();
    const fromAddon = E.buildAddonWhispers(roster, sheet).split('\n').slice(1)
        .map(l => l.slice(0, l.indexOf('=')));
    const fromWhispers = E.buildWhispers(roster, sheet).map(l => l.split(' ')[1]);
    assert.deepStrictEqual(
        Array.from(new Set(fromAddon)).sort(),
        Array.from(new Set(fromWhispers)).sort());
});
test('buildAddonWhispers: players with no duties get no line', () => {
    const { roster, sheet } = sampleSheet();
    const names = E.buildAddonWhispers(roster, sheet).split('\n').slice(1)
        .map(l => l.slice(0, l.indexOf('=')));
    assert.ok(!names.includes('Stabby'));
});
test('buildAddonWhispers: mark tokens survive verbatim', () => {
    const { roster, sheet } = sampleSheet();
    assert.ok(E.buildAddonWhispers(roster, sheet).includes('Polymorph on {moon}'));
});
test('buildAddonWhispers: duty text containing ; / and parentheses survives intact', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n').slice(1);
    const personal = lines.find(l => l.includes('Curse of Doom/Agony (personal)'));
    assert.ok(personal, 'expected a spare warlock to carry the personal curse');
    // The name/body split is on the FIRST '=', so a body may contain anything else.
    const name = personal.slice(0, personal.indexOf('='));
    assert.ok(name.length > 0 && name.indexOf(' ') === -1);
});
test('buildAddonWhispers: a heavily loaded player splits across lines, all within 255', () => {
    const sheet = {
        duties: Array.from({ length: 30 }, (_, i) => ({
            id: 'd' + i, name: 'Very Long Duty Name Number ' + i, category: 'debuffs', player: 'Bob',
        })),
        uncovered: [], passives: [], cc: [],
    };
    const lines = E.buildAddonWhispers([], sheet).split('\n').slice(1);
    assert.ok(lines.length > 1, 'expected the payload to wrap onto several lines');
    lines.forEach(l => {
        assert.ok(l.startsWith('Bob='));
        const body = l.slice('Bob='.length);
        assert.ok(body.length <= 255, 'body was ' + body.length + ' chars');
        assert.ok(body.startsWith('Your assignments: '));
    });
});

// --- Final review: = inside a duty body must not break the name split ---
test('buildAddonWhispers: a duty name containing = still splits on the FIRST = only', () => {
    const sheet = {
        duties: [{ id: 'eq', name: 'DPS = 100%', category: 'debuffs', player: 'Bob' }],
        uncovered: [], passives: [], cc: [],
    };
    const lines = E.buildAddonWhispers([], sheet).split('\n').slice(1);
    assert.strictEqual(lines.length, 1);
    const line = lines[0];
    const eq = line.indexOf('=');
    const name = line.slice(0, eq);
    const body = line.slice(eq + 1);
    assert.strictEqual(name, 'Bob');
    assert.ok(body.includes('DPS = 100%'));
});

test('RSS1 regression: a full raid export parses to exactly this roster', () => {
    const text = 'RSS1;Thunderfist:WARRIOR:5/6/50;Smashy:WARRIOR:33/28/0;' +
        'Bob:WARLOCK:43/0/18;Grimshade:WARLOCK:0/21/40;' +
        'Retdin:PALADIN:0/0/61;Lightbringer:PALADIN:47/14/0;' +
        'Frostina:MAGE:0/48/13;Moonpie:DRUID:43/18/0;Mystery:HUNTER:?';
    const r = E.parseAddonExport(text);
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.players, [
        { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon' },
        { name: 'Smashy', class: 'WARRIOR', spec: 'Arms', flags: [], source: 'addon' },
        { name: 'Bob', class: 'WARLOCK', spec: 'Affliction', flags: [], source: 'addon' },
        { name: 'Grimshade', class: 'WARLOCK', spec: 'Destruction', flags: [], source: 'addon' },
        { name: 'Retdin', class: 'PALADIN', spec: 'Retribution', flags: [], source: 'addon' },
        { name: 'Lightbringer', class: 'PALADIN', spec: 'Holy', flags: [], source: 'addon' },
        { name: 'Frostina', class: 'MAGE', spec: 'Fire', flags: [], source: 'addon' },
        { name: 'Moonpie', class: 'DRUID', spec: 'Balance', flags: [], source: 'addon' },
        { name: 'Mystery', class: 'HUNTER', spec: null, flags: ['spec-unknown'], source: 'addon' },
    ]);
});

test('buildDiscord warns about missing only, and tolerates a legacy flat uncovered', () => {
    const roster = fullRoster();
    const sheet = E.autoAssign(roster, {});
    sheet.uncovered = { missing: [{ id: 'coe', name: 'Curse of Elements' }],
                        notApplicable: [{ id: 'joc', name: 'Judgement of the Crusader' }] };
    const out = E.buildDiscord(roster, sheet, {});
    // fullRoster() has enough warlocks/paladins that autoAssign covers both coe and joc as
    // real duties, so their names appear in the Debuffs section regardless of the warning
    // logic under test here. Isolate the warning line itself rather than the whole message.
    const warningLine = out.split('\n').find(l => l.indexOf('Uncovered') !== -1) || '';
    assert.ok(warningLine.includes('Curse of Elements'));
    assert.ok(!warningLine.includes('Judgement of the Crusader'));

    const legacy = E.autoAssign(roster, {});
    legacy.uncovered = [{ id: 'coe', name: 'Curse of Elements' }];
    const legacyOut = E.buildDiscord(roster, legacy, {});
    const legacyWarningLine = legacyOut.split('\n').find(l => l.indexOf('Uncovered') !== -1) || '';
    assert.ok(legacyWarningLine.includes('Curse of Elements'));
});

test('autoAssign: judgement of the crusader requires a ret paladin, not three paladins', () => {
    const noRet = fullRoster().filter(p => p.name !== 'Retdin');
    const r = E.autoAssign(noRet, {});
    assert.ok(!duty(r, 'joc'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
});
test('autoAssign: a lone ret paladin is enough for judgement of the crusader', () => {
    const roster = [P('Retdin', 'PALADIN', 'Retribution')];
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
});

test('autoAssign: faerie fire prefers balance, then feral, then resto', () => {
    const balance = E.autoAssign([P('Moonpie', 'DRUID', 'Balance'), P('Clawz', 'DRUID', 'Feral'), P('Aardvark', 'DRUID', 'Restoration')], {});
    assert.strictEqual(duty(balance, 'ff').player, 'Moonpie');
    const noBalance = E.autoAssign([P('Aardvark', 'DRUID', 'Restoration'), P('Clawz', 'DRUID', 'Feral')], {});
    assert.strictEqual(duty(noBalance, 'ff').player, 'Clawz');
    const restoOnly = E.autoAssign([P('Aardvark', 'DRUID', 'Restoration')], {});
    assert.strictEqual(duty(restoOnly, 'ff').player, 'Aardvark');
});
test("autoAssign: winter's chill is an assigned duty for a frost mage, not a passive", () => {
    const r = E.autoAssign([P('Sheepmaster', 'MAGE', 'Frost')], {});
    assert.strictEqual(duty(r, 'wc').player, 'Sheepmaster');
    assert.ok(!r.passives.some(p => p.name === "Winter's Chill"));
});
test("autoAssign: winter's chill needs a frost mage specifically", () => {
    const r = E.autoAssign([P('Frostina', 'MAGE', 'Fire')], {});
    assert.ok(!duty(r, 'wc'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'wc'));
});

test('autoAssign: an explicit override beats an applicableWhen gate', () => {
    // The addon reports talent tab totals only, so a paladin who never scanned has spec null
    // and joc's predicate reads false. The raid lead knows better; the override must survive.
    const pals = [P('Ambiguous', 'PALADIN', null), P('Lightbringer', 'PALADIN', 'Holy')];
    const r = E.autoAssign(pals, { joc: { player: 'Ambiguous' } });
    assert.strictEqual(duty(r, 'joc').player, 'Ambiguous');
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'joc'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
