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
    assert.deepStrictEqual(r.players[0], { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon', group: null, race: null, talents: null });
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
    assert.deepStrictEqual(dave, { name: 'Dave', class: 'WARLOCK', spec: 'Affliction', discordId: '111', flags: [], source: 'raidhelper', group: null, race: null });
    assert.strictEqual(r.title, 'SSC Tuesday');
});
test('parseRaidHelper: a player gets null group and race like every other source', () => {
    // Whole-plan review finding 1: parseAddonExport sets group/race to a value or null on every
    // player, but parseRaidHelper omitted both keys, so a Raid-Helper player read `undefined`
    // there instead — a different value under ===, deepStrictEqual, and JSON.stringify. The
    // plan's stated interface is group: Number|null, race: String|null for every source.
    const r = E.parseRaidHelper(rhFixture());
    const dave = r.players.find(p => p.name === 'Dave');
    assert.strictEqual(dave.group, null);
    assert.strictEqual(dave.race, null);
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
    assert.strictEqual(duty(r, 'armor').player, 'Stabby');   // rogue expose outranks warrior sunder
    assert.strictEqual(duty(r, 'coe').player, 'Bob');            // affliction preferred
    assert.ok(['Grimshade', 'Doomlord'].includes(duty(r, 'cor').player));
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer'); // holy/prot judge, ret keeps its damage seal
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
    assert.ok(duty(r, 'joc'));                                   // 3 paladins present
    assert.strictEqual(duty(r, 'scorch').player, 'Frostina');    // fire required
    assert.strictEqual(duty(r, 'ff').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hm').player, 'Legolass');
    assert.strictEqual(duty(r, 'ap').player, 'Smashy');        // arms/fury preferred over tank
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
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
    assert.ok(!duty(r, 'joc'));
});
test('autoAssign: with two paladins including a ret, both judgements are covered', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer');
    assert.ok(!r.uncovered.missing.some(u => u.id === 'jow'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'joc'));
});
test('autoAssign: no warriors falls back demo shout to Curse of Weakness', () => {
    const roster = fullRoster().filter(p => p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    const demo = duty(r, 'ap');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(r.duties.filter(d => d.player === demo.player && ['coe', 'cor', 'ap'].includes(d.id)).length, 1);
    assert.strictEqual(duty(r, 'armor').player, 'Stabby'); // rogue still covers armor with no warriors
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
    const r = E.autoAssign(fullRoster(), { armor: { player: null } });
    assert.strictEqual(duty(r, 'armor').player, null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'armor'));
});
test('autoAssign: no override at all still auto-assigns the debuff normally', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'armor').player, 'Stabby');
    assert.ok(!r.uncovered.missing.some(u => u.id === 'armor'));
});
test('autoAssign: re-assigning after an explicit unassignment escapes the dead end', () => {
    const cleared = E.autoAssign(fullRoster(), { armor: { player: null } });
    assert.strictEqual(duty(cleared, 'armor').player, null);
    const reassigned = E.autoAssign(fullRoster(), { armor: { player: 'Thunderfist' } });
    assert.strictEqual(duty(reassigned, 'armor').player, 'Thunderfist');
    assert.strictEqual(duty(reassigned, 'armor').name, 'Sunder Armor'); // warrior override picks the warrior provider's label
    assert.ok(!reassigned.uncovered.missing.some(u => u.id === 'armor'));
});
test('autoAssign: an explicitly cleared row counts as missing, not notApplicable', () => {
    const r = E.autoAssign(fullRoster(), { armor: { player: null } });
    assert.ok(r.uncovered.missing.some(u => u.id === 'armor'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'armor'));
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

function rogue(name, spec, rank) {
    const p = P(name, 'ROGUE', spec);
    if (rank !== null) p.talents = { impExposeArmor: rank };
    return p;
}
test('autoAssign: a talented off-spec rogue beats an untalented on-spec one', () => {
    // Subtlety is the preferred spec, but the talent is the thing the spec was a proxy for.
    const r = E.autoAssign([rogue('Asub', 'Subtlety', 0), rogue('Zcombat', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zcombat');
});
test('autoAssign: unknown outranks known-untalented', () => {
    const r = E.autoAssign([rogue('Aknown', 'Combat', 0), rogue('Zunknown', 'Combat', null)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zunknown');
});
test('autoAssign: a higher rank wins inside the talented tier', () => {
    const r = E.autoAssign([rogue('Alow', 'Combat', 1), rogue('Zhigh', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zhigh');
});
test('autoAssign: a row without improvedBy is unaffected by talent data', () => {
    // Both rogues are Subtlety, so spec alone cannot decide armor — only the talent tier
    // can, and Zsub's rank 2 wins it over Asub's rank 0 despite the tied spec, loading
    // Zsub's duty count. hemo has no improvedBy, so its tier ties for both candidates and
    // the pick falls through to duty count, which by then favors Asub.
    const r = E.autoAssign([rogue('Asub', 'Subtlety', 0), rogue('Zsub', 'Subtlety', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zsub');
    assert.strictEqual(duty(r, 'hemo').player, 'Asub');
});
function warrior(name, spec, rank) {
    const p = P(name, 'WARRIOR', spec);
    if (rank !== null) p.talents = { impThunderClap: rank };
    return p;
}
test('autoAssign: improvedBy survives providersOf on a single-class entry', () => {
    // tclap is single-class, so providersOf rebuilds its provider field by field from an
    // explicit allowlist. A field left out of that list is silently dropped, and this row
    // would ignore talents entirely while the providers-based rows worked fine.
    const r = E.autoAssign([warrior('Aarms', 'Arms', 0), warrior('Zprot', 'Protection', 3)], {});
    assert.strictEqual(duty(r, 'tclap').player, 'Zprot');
});
test('autoAssign: a talented player beats one whose talents are unknown', () => {
    // Same spec on both, so specRank cannot decide, and the unknown player sorts first
    // alphabetically — only the tier can put Ztalented ahead.
    const r = E.autoAssign([rogue('Aunknown', 'Combat', null), rogue('Ztalented', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Ztalented');
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
    assert.ok(out.includes('Retdin')); // no discordId -> plain
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
    // A duty carrying `players` instead of `player` (a rotation) rendered by a filter that
    // doesn't know the difference prints "undefined" straight into the macro — guard the
    // whole shape-mismatch class, not just this one instance of it.
    assert.ok(!/undefined/.test(lines.join(' ')));
});
test('buildWhispers: one line per assigned player, duties combined', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildWhispers(roster, sheet);
    const bob = lines.find(l => l.startsWith('/w Bob '));
    assert.ok(bob.includes('Curse of Elements'));
    assert.ok(bob.includes('Soulstone'));
    assert.strictEqual(lines.filter(l => l.startsWith('/w Bob ')).length, 1);
    assert.ok(!/undefined/.test(lines.join(' ')));
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
    const r = E.autoAssign(fullRoster(), { ap: { player: 'Grimshade' } });
    const demo = duty(r, 'ap');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(demo.player, 'Grimshade');
    assert.ok(!r.duties.some(d => d.id === 'curse:Grimshade'));
    assert.strictEqual(r.duties.filter(d => d.player === 'Grimshade' && ['coe', 'cor', 'ap'].includes(d.id)).length, 1);
});
test('autoAssign: overriding demo to a warrior is untouched, still Demoralizing Shout', () => {
    const r = E.autoAssign(fullRoster(), { ap: { player: 'Thunderfist' } });
    const demo = duty(r, 'ap');
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
        { name: 'Dave', class: 'WARLOCK', spec: 'Affliction', discordId: '111', flags: [], source: 'raidhelper', group: null, race: null },
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
    // Assert the rule, not one incidental name: an earlier version named the prot warrior, and
    // went stale the moment a new catalog entry gave him a duty.
    const withDuty = new Set(sheet.duties.filter(d => d.player).map(d => d.player));
    (sheet.cc || []).filter(c => c.player).forEach(c => withDuty.add(c.player));
    // Rotation members carry `players`, not `player` — N1 makes them whisper recipients too,
    // so they belong in this set now, the same way d.player and c.player already did.
    sheet.duties.filter(d => d.players).forEach(d => d.players.forEach(n => withDuty.add(n)));
    assert.ok(names.length, 'expected at least one whisper line');
    names.forEach(n => assert.ok(withDuty.has(n), 'whispered a player with no duties: ' + n));
    assert.ok(!names.includes('Bubbles')); // prot paladin, still duty-free
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
        { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Smashy', class: 'WARRIOR', spec: 'Arms', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Bob', class: 'WARLOCK', spec: 'Affliction', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Grimshade', class: 'WARLOCK', spec: 'Destruction', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Retdin', class: 'PALADIN', spec: 'Retribution', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Lightbringer', class: 'PALADIN', spec: 'Holy', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Frostina', class: 'MAGE', spec: 'Fire', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Moonpie', class: 'DRUID', spec: 'Balance', flags: [], source: 'addon', group: null, race: null, talents: null },
        { name: 'Mystery', class: 'HUNTER', spec: null, flags: ['spec-unknown'], source: 'addon', group: null, race: null, talents: null },
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

test('autoAssign: armor falls back to a warrior when there is no rogue', () => {
    const roster = fullRoster().filter(p => p.class !== 'ROGUE');
    const r = E.autoAssign(roster, {});
    const armor = duty(r, 'armor');
    assert.strictEqual(armor.name, 'Sunder Armor');
    assert.strictEqual(armor.player, 'Thunderfist'); // prot preferred
});
test('autoAssign: armor row is missing only when neither rogue nor warrior is present', () => {
    const roster = fullRoster().filter(p => p.class !== 'ROGUE' && p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    assert.ok(!duty(r, 'armor'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'armor'));
});

test('autoAssign: attack power falls through to a feral druid, then a hunter', () => {
    const noWarNoLock = [P('Clawz', 'DRUID', 'Feral'), P('Legolass', 'HUNTER', 'Marksmanship')];
    const r = E.autoAssign(noWarNoLock, {});
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
    assert.strictEqual(duty(r, 'ap').player, 'Clawz');

    const hunterOnly = E.autoAssign([P('Legolass', 'HUNTER', 'Marksmanship')], {});
    assert.strictEqual(duty(hunterOnly, 'ap').name, 'Screech (pet)');
    assert.strictEqual(duty(hunterOnly, 'ap').player, 'Legolass');
});

test('autoAssign: curse of recklessness carries its tank caution onto the duty', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.ok(/\+136 melee AP/.test(duty(r, 'cor').caution));
});

// --- Whole-plan code review fix wave: finding 1 ---
test('autoAssign: an entry-level caution reaches the duty even on a providers entry', () => {
    E.DEBUFF_CATALOG.push({ id: 'testcaution', name: 'Test Caution', category: 'debuffs',
        caution: 'mind the gap', providers: [{ name: 'Test Provider', class: 'MAGE', preferSpecs: [] }] });
    try {
        const r = E.autoAssign(fullRoster(), {});
        assert.strictEqual(duty(r, 'testcaution').caution, 'mind the gap');
    } finally {
        E.DEBUFF_CATALOG.pop();
    }
});

// --- Whole-plan code review fix wave: finding 2 ---
test('autoAssign: an override cannot give one warlock two curses', () => {
    const locks = [P('Bob', 'WARLOCK', 'Affliction'), P('Grimshade', 'WARLOCK', 'Destruction'),
                   P('Doomlord', 'WARLOCK', 'Demonology')];
    const r = E.autoAssign(locks, { cor: { player: 'Grimshade' }, ap: { player: 'Grimshade' } });
    assert.strictEqual(duty(r, 'cor').player, 'Grimshade');   // first in catalog order, honoured
    assert.notStrictEqual(duty(r, 'ap').player, 'Grimshade'); // second is refused, not stacked
    const curseHolders = ['coe', 'cor', 'ap']
        .map(id => duty(r, id))
        .filter(d => d && d.player === 'Grimshade');
    assert.strictEqual(curseHolders.length, 1);
});

test('parseAddonExport: RSS2 carries subgroup and race', () => {
    const r = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:1:Human;Zapp:SHAMAN:0/41/20:2:Draenei');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, 1);
    assert.strictEqual(r.players[0].race, 'Human');
    assert.strictEqual(r.players[1].group, 2);
    assert.strictEqual(r.players[1].race, 'Draenei');
});
test('parseAddonExport: RSS1 still parses, with group and race null', () => {
    const r = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/6/50');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, null);
    assert.strictEqual(r.players[0].race, null);
    assert.strictEqual(r.players[0].spec, 'Protection');
});
test('parseAddonExport: RSS2 unscanned player keeps group and race', () => {
    const r = E.parseAddonExport('RSS2;Mystery:HUNTER:?:4:Orc');
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.players[0].flags.includes('spec-unknown'));
    assert.strictEqual(r.players[0].group, 4);
    assert.strictEqual(r.players[0].race, 'Orc');
});
test('parseAddonExport: RSS2 tolerates a missing trailing race', () => {
    const r = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:3');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, 3);
    assert.strictEqual(r.players[0].race, null);
});
test('parseAddonExport: an out-of-range subgroup is an error, not a silent bad group', () => {
    const tooHigh = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:9:Human');
    assert.strictEqual(tooHigh.players.length, 0);
    assert.strictEqual(tooHigh.errors.length, 1);

    const tooLow = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:0:Human');
    assert.strictEqual(tooLow.players.length, 0);
    assert.strictEqual(tooLow.errors.length, 1);

    const boundary = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:8:Human');
    assert.deepStrictEqual(boundary.errors, []);
    assert.strictEqual(boundary.players[0].group, 8);
});

// --- Whole-plan review finding 3: the parser's own "partially-upgraded raid" claim ---
test('parseAddonExport: the header does not gate per-line shape, in either direction', () => {
    // The parser's comment says an RSS2 header can carry RSS1-shaped lines (no subgroup/race)
    // and vice versa, because a partially-upgraded raid still needs to parse. That's the stated
    // reason the parser shipped ahead of the addon update, so it earns its own test.
    const rss2HeaderRss1Line = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50');
    assert.deepStrictEqual(rss2HeaderRss1Line.errors, []);
    assert.strictEqual(rss2HeaderRss1Line.players[0].group, null);
    assert.strictEqual(rss2HeaderRss1Line.players[0].race, null);

    const rss1HeaderRss2Line = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/6/50:1:Human');
    assert.deepStrictEqual(rss1HeaderRss2Line.errors, []);
    assert.strictEqual(rss1HeaderRss2Line.players[0].group, 1);
    assert.strictEqual(rss1HeaderRss2Line.players[0].race, 'Human');
});

test('bucketOf: specs map to the right role bucket', () => {
    assert.strictEqual(E.bucketOf(P('a', 'WARRIOR', 'Protection')), 'tanks');
    assert.strictEqual(E.bucketOf(P('b', 'WARRIOR', 'Fury')), 'melee');
    assert.strictEqual(E.bucketOf(P('c', 'PALADIN', 'Holy')), 'healers');
    assert.strictEqual(E.bucketOf(P('d', 'PALADIN', 'Retribution')), 'melee');
    assert.strictEqual(E.bucketOf(P('e', 'DRUID', 'Balance')), 'casters');
    assert.strictEqual(E.bucketOf(P('f', 'DRUID', 'Restoration')), 'healers');
    assert.strictEqual(E.bucketOf(P('g', 'PRIEST', 'Shadow')), 'casters');
    assert.strictEqual(E.bucketOf(P('h', 'PRIEST', 'Holy')), 'healers');
    assert.strictEqual(E.bucketOf(P('i', 'SHAMAN', 'Enhancement')), 'melee');
    assert.strictEqual(E.bucketOf(P('j', 'SHAMAN', 'Elemental')), 'casters');
    assert.strictEqual(E.bucketOf(P('k', 'ROGUE', 'Combat')), 'melee');
    assert.strictEqual(E.bucketOf(P('l', 'MAGE', 'Fire')), 'casters');
    assert.strictEqual(E.bucketOf(P('q', 'PALADIN', 'Protection')), 'tanks');
    assert.strictEqual(E.bucketOf(P('r', 'DRUID', 'Feral')), 'melee');
    assert.strictEqual(E.bucketOf(P('s', 'SHAMAN', 'Restoration')), 'healers');
});
test('bucketOf: hunters are their own bucket, never melee', () => {
    assert.strictEqual(E.bucketOf(P('m', 'HUNTER', 'Beast Mastery')), 'ranged');
    assert.strictEqual(E.bucketOf(P('n', 'HUNTER', 'Survival')), 'ranged');
});
test('bucketOf: a null spec still returns a bucket', () => {
    assert.strictEqual(E.bucketOf(P('o', 'WARLOCK', null)), 'casters');
    assert.strictEqual(E.bucketOf(P('p', 'WARRIOR', null)), 'melee');
});

function raid25() {
    const r = [];
    ['Tank1', 'Tank2'].forEach(n => r.push(P(n, 'WARRIOR', 'Protection')));
    ['Rog1', 'Rog2', 'Rog3'].forEach(n => r.push(P(n, 'ROGUE', 'Combat')));
    r.push(P('Fury1', 'WARRIOR', 'Fury'));
    r.push(P('Ret1', 'PALADIN', 'Retribution'));
    r.push(P('Ret2', 'PALADIN', 'Retribution')); // 25th body — without it the fixture is a 24-man and every "places 25" assertion fails
    ['Hunt1', 'Hunt2', 'Hunt3'].forEach(n => r.push(P(n, 'HUNTER', 'Beast Mastery')));
    ['Mage1', 'Mage2', 'Lock1', 'Lock2'].forEach(n =>
        r.push(P(n, n.indexOf('Mage') === 0 ? 'MAGE' : 'WARLOCK', n.indexOf('Mage') === 0 ? 'Fire' : 'Affliction')));
    r.push(P('Spriest', 'PRIEST', 'Shadow'));
    r.push(P('Boomy', 'DRUID', 'Balance'));
    ['Heal1', 'Heal2'].forEach(n => r.push(P(n, 'PRIEST', 'Holy')));
    r.push(P('Hpal', 'PALADIN', 'Holy'));
    r.push(P('Tree', 'DRUID', 'Restoration'));
    r.push(P('Enh', 'SHAMAN', 'Enhancement'));
    r.push(P('Ele', 'SHAMAN', 'Elemental'));
    r.push(P('Resto', 'SHAMAN', 'Restoration'));
    r.push(P('Feral', 'DRUID', 'Feral'));
    return r;
}
function groupOf(res, name) {
    const g = res.groups.find(g => g.players.some(p => p.name === name));
    return g ? g.role : null;
}

test('proposeGroups: makes five groups of at most five and places everyone', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(res.groups.length, 5);
    res.groups.forEach(g => assert.ok(g.players.length <= 5, g.role + ' has ' + g.players.length));
    assert.strictEqual(res.unplaced.length, 0);
    const placed = res.groups.reduce((n, g) => n + g.players.length, 0);
    assert.strictEqual(placed, 25);
});
test('proposeGroups: no player is placed twice', () => {
    const res = E.proposeGroups(raid25());
    const names = res.groups.flatMap(g => g.players.map(p => p.name));
    assert.strictEqual(new Set(names).size, names.length);
});
test('proposeGroups: shamans seed their matching group, one each', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(groupOf(res, 'Enh'), 'melee');
    assert.strictEqual(groupOf(res, 'Ele'), 'casters');
    assert.strictEqual(groupOf(res, 'Resto'), 'healers');
});
test('proposeGroups: hunters group together, away from windfury', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(groupOf(res, 'Hunt1'), 'ranged');
    assert.strictEqual(groupOf(res, 'Hunt2'), 'ranged');
});
test('proposeGroups: scarce shamans go to melee first, then casters', () => {
    const roster = raid25().filter(p => p.name !== 'Ele' && p.name !== 'Resto');
    const res = E.proposeGroups(roster);
    assert.strictEqual(groupOf(res, 'Enh'), 'melee');
});
test('proposeGroups: a ten-man roster degrades to two groups without throwing', () => {
    const res = E.proposeGroups(raid25().slice(0, 10));
    assert.strictEqual(res.groups.length, 2);
    assert.strictEqual(res.unplaced.length, 0);
});
test('proposeGroups: an empty roster returns no groups and does not throw', () => {
    const res = E.proposeGroups([]);
    assert.strictEqual(res.groups.length, 0);
    assert.strictEqual(res.unplaced.length, 0);
});
test('proposeGroups: group roles reflect who is actually in the roster', () => {
    const healers = [];
    for (let i = 1; i <= 10; i++) healers.push(P('H' + i, 'PRIEST', 'Holy'));
    const res = E.proposeGroups(healers);
    assert.strictEqual(res.groups.length, 2);
    assert.ok(res.groups.some(g => g.role === 'healers'), 'no healers group: ' + res.groups.map(g => g.role).join(','));
    assert.ok(!res.groups.some(g => g.role === 'casters'), 'labelled a priest group casters');
    assert.strictEqual(res.unplaced.length, 0);
});
test('proposeGroups: two players sharing a name are both placed, not silently dropped', () => {
    const roster = [P('Same', 'WARRIOR', 'Fury'), P('Same', 'MAGE', 'Fire'), P('Other', 'ROGUE', 'Combat')];
    const res = E.proposeGroups(roster);
    const accounted = res.groups.reduce((n, g) => n + g.players.length, 0) + res.unplaced.length;
    assert.strictEqual(accounted, 3);
});
test('proposeGroups: spreads draenei across groups rather than doubling up', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Human' }));
    roster.filter(p => ['Rog1', 'Rog2'].includes(p.name)).forEach(p => { p.race = 'Draenei'; });
    const res = E.proposeGroups(roster);
    const perGroup = res.groups.map(g => g.players.filter(p => p.race === 'Draenei').length);
    assert.ok(Math.max.apply(null, perGroup) <= 1, 'a group has two draenei: ' + perGroup.join(','));
});
test('proposeGroups: the draenei pass never changes group sizes', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Draenei' }));
    const res = E.proposeGroups(roster);
    assert.strictEqual(res.groups.reduce((n, g) => n + g.players.length, 0), 25);
    res.groups.forEach(g => assert.ok(g.players.length <= 5));
});
test('proposeGroups: a roster with no race data is unaffected', () => {
    const withRace = E.proposeGroups(raid25().map(p => Object.assign({}, p, { race: null })));
    const without = E.proposeGroups(raid25());
    assert.deepStrictEqual(withRace.groups.map(g => g.players.map(p => p.name)),
                           without.groups.map(g => g.players.map(p => p.name)));
});
test('proposeGroups: a real draenei swap conserves every group size and every player', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Human' }));
    roster.filter(p => ['Rog1', 'Rog2'].includes(p.name)).forEach(p => { p.race = 'Draenei'; });
    const before = E.proposeGroups(roster.map(p => Object.assign({}, p, { race: 'Human' })));
    const after = E.proposeGroups(roster);
    // The swap must actually have fired, or this test proves nothing.
    const perGroup = after.groups.map(g => g.players.filter(p => p.race === 'Draenei').length);
    assert.ok(Math.max.apply(null, perGroup) <= 1, 'no swap fired: ' + perGroup.join(','));
    assert.deepStrictEqual(after.groups.map(g => g.players.length),
                           before.groups.map(g => g.players.length));
    const names = after.groups.flatMap(g => g.players.map(p => p.name)).concat(after.unplaced.map(p => p.name));
    assert.strictEqual(names.length, 25);
    assert.strictEqual(new Set(names).size, 25);
});
test('proposeGroups: each group explains what its composition buys', () => {
    const res = E.proposeGroups(raid25());
    const melee = res.groups.find(g => g.role === 'melee');
    assert.ok(melee.notes.some(t => /Windfury/.test(t)));
    const casters = res.groups.find(g => g.role === 'casters');
    assert.ok(casters.notes.some(t => /Totem of Wrath/.test(t)));
    res.groups.forEach(g => assert.ok(Array.isArray(g.notes)));
});
test('proposeGroups: every note rule fires for the group that actually has its provider', () => {
    const res = E.proposeGroups(raid25());
    const notes = {};
    res.groups.forEach(g => { notes[g.role] = g.notes.join(' | '); });
    assert.ok(/Unleashed Rage/.test(notes.melee), 'melee: ' + notes.melee);
    assert.ok(/Battle Shout/.test(notes.melee), 'melee: ' + notes.melee);
    assert.ok(/Leader of the Pack/.test(notes.melee), 'melee: ' + notes.melee);
    // v2 (spec §9.3): the generic 'A paladin aura' note is superseded by four real rows —
    // a group with k paladins names the top k auras it actually runs.
    assert.ok(/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes.melee), 'melee: ' + notes.melee);
    assert.ok(/Wrath of Air/.test(notes.casters), 'casters: ' + notes.casters);
    assert.ok(/Moonkin Aura/.test(notes.casters), 'casters: ' + notes.casters);
    assert.ok(/Vampiric Touch/.test(notes.casters), 'casters: ' + notes.casters);
    assert.ok(/Mana Tide Totem/.test(notes.healers), 'healers: ' + notes.healers);
    assert.ok(/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes.healers), 'healers: ' + notes.healers);
    assert.ok(/Ferocious Inspiration/.test(notes.ranged), 'ranged: ' + notes.ranged);
});
test('proposeGroups: a group never claims a buff whose provider is not in it', () => {
    const res = E.proposeGroups(raid25());
    const notes = {};
    res.groups.forEach(g => { notes[g.role] = g.notes.join(' | '); });
    // No shaman, no paladin, no warrior-with-Battle-Shout, no BM hunter in the tanks group.
    assert.ok(!/Totem|Wrath of Air|Unleashed Rage/.test(notes.tanks), 'tanks: ' + notes.tanks);
    // v2 (spec §9.3): same rename on the negative side — no paladin, so no NAMED aura.
    assert.ok(!/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes.tanks), 'tanks: ' + notes.tanks);
    assert.ok(!/Ferocious Inspiration/.test(notes.tanks), 'tanks: ' + notes.tanks);
    // Nobody has a race in raid25(), so no group may claim the Draenei presence.
    res.groups.forEach(g => assert.ok(!/Draenei/.test(g.notes.join(' | ')), g.role + ': ' + g.notes.join(' | ')));
});
test('proposeGroups: the draenei note follows the post-swap layout', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Human' }));
    roster.filter(p => ['Rog1', 'Rog2'].includes(p.name)).forEach(p => { p.race = 'Draenei'; });
    const res = E.proposeGroups(roster);
    res.groups.forEach(g => {
        const claims = /Draenei/.test(g.notes.join(' | '));
        const has = g.players.some(p => p.race === 'Draenei');
        assert.strictEqual(claims, has, g.role + ' claims=' + claims + ' has=' + has);
    });
});

// --- Fix wave: whole-plan review of proposeGroups (items 1, 2, 4) ---
test('proposeGroups: a group is labelled by who actually landed in it', () => {
    const priests = [];
    for (let i = 1; i <= 10; i++) priests.push(P('Holy' + i, 'PRIEST', 'Holy'));
    const res = E.proposeGroups(priests);
    res.groups.forEach(g => assert.strictEqual(g.role, 'healers', g.role + ' = ' + g.players.map(p => p.name).join(',')));
});
test('proposeGroups: windfury is only claimed when real melee are there to use it', () => {
    const mix = [P('Enh', 'SHAMAN', 'Enhancement')];
    for (let i = 1; i <= 9; i++) mix.push(P('Holy' + i, 'PRIEST', 'Holy'));
    const res = E.proposeGroups(mix);
    res.groups.forEach(g => assert.ok(!/Windfury/.test(g.notes.join(' | ')),
        g.role + ' wrongly claims windfury: ' + g.players.map(p => p.name).join(',')));
    // and it must still fire where it should
    const melee = E.proposeGroups(raid25()).groups.find(g => g.players.some(p => p.name === 'Enh'));
    assert.ok(/Windfury/.test(melee.notes.join(' | ')), 'lost the real windfury note');
});
test('proposeGroups: does not mutate the caller roster or its players', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Human' }));
    roster.filter(p => ['Rog1', 'Rog2'].includes(p.name)).forEach(p => { p.race = 'Draenei'; });
    const namesBefore = roster.map(p => p.name);
    const snapshot = JSON.stringify(roster);
    E.proposeGroups(roster);
    assert.deepStrictEqual(roster.map(p => p.name), namesBefore); // not reordered
    assert.strictEqual(JSON.stringify(roster), snapshot);          // no field written
});

function palRoster() {
    return [
        P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'),
        P('Bubbles', 'PALADIN', 'Protection'),
        P('Thunderfist', 'WARRIOR', 'Protection'), P('Stabby', 'ROGUE', 'Combat'),
        P('Mage1', 'MAGE', 'Fire'), P('Holymel', 'PRIEST', 'Holy'),
    ];
}

test('GREATER_BLESSINGS: the four blessings, in the order the UI dropdowns show them', () => {
    assert.deepStrictEqual(E.GREATER_BLESSINGS, ['Greater Kings', 'Greater Might', 'Greater Wisdom', 'Greater Salvation']);
});
test('proposeBlessings: only classes present get a column', () => {
    const g = E.proposeBlessings(palRoster(), {});
    // Column order drives both the grid and the Discord line, so pin the engine's own sorted
    // order here rather than sorting both sides — sorting both sides can't tell a sorted
    // column list from an unsorted one.
    assert.deepStrictEqual(g.classes, ['MAGE', 'PALADIN', 'PRIEST', 'ROGUE', 'WARRIOR']);
});
test('proposeBlessings: one row per paladin, ret first', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.strictEqual(g.rows.length, 3);
    assert.strictEqual(g.rows[0].paladin, 'Retdin');
});
test('proposeBlessings: ret covers everything with kings', () => {
    const g = E.proposeBlessings(palRoster(), {});
    g.classes.forEach(c => assert.strictEqual(g.rows[0].cells[c], 'Greater Kings'));
});
test('proposeBlessings: holy splits might to physical, wisdom to casters', () => {
    const g = E.proposeBlessings(palRoster(), {});
    const holy = g.rows.find(r => r.paladin === 'Lightbringer');
    assert.strictEqual(holy.cells.WARRIOR, 'Greater Might');
    assert.strictEqual(holy.cells.ROGUE, 'Greater Might');
    assert.strictEqual(holy.cells.MAGE, 'Greater Wisdom');
    assert.strictEqual(holy.cells.PRIEST, 'Greater Wisdom');
    assert.strictEqual(holy.cells.PALADIN, 'Greater Might');
});
test('proposeBlessings: an override replaces exactly one cell', () => {
    const g = E.proposeBlessings(palRoster(), { 'Retdin|MAGE': 'Greater Salvation' });
    assert.strictEqual(g.rows[0].cells.MAGE, 'Greater Salvation');
    assert.strictEqual(g.rows[0].cells.WARRIOR, 'Greater Kings');
});
test('proposeBlessings: no paladins gives empty rows and a warning', () => {
    const g = E.proposeBlessings(palRoster().filter(p => p.class !== 'PALADIN'), {});
    assert.strictEqual(g.rows.length, 0);
    assert.ok(g.warnings.some(w => /no paladin/i.test(w)));
});
test('proposeBlessings: warns when a class has no blessing at all', () => {
    const g = E.proposeBlessings(palRoster(), { 'Retdin|MAGE': null, 'Lightbringer|MAGE': null, 'Bubbles|MAGE': null });
    assert.ok(g.warnings.some(w => /MAGE/.test(w) && /no blessing/i.test(w)));
});
test('proposeBlessings: warns when two paladins give a class the same blessing', () => {
    const g = E.proposeBlessings(palRoster(), { 'Lightbringer|WARRIOR': 'Greater Kings' });
    assert.ok(g.warnings.some(w => /WARRIOR/.test(w) && /Greater Kings/.test(w)));
});
test('proposeBlessings: a clean default grid has no gap or duplicate warnings', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.deepStrictEqual(g.warnings, []);
});
test('proposeBlessings: the third paladin withholds salvation from classes holding a tank', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.strictEqual(g.rows[2].paladin, 'Bubbles');
    assert.strictEqual(g.rows[2].cells.WARRIOR, null);   // Thunderfist is Protection
    assert.strictEqual(g.rows[2].cells.PALADIN, null);   // Bubbles himself is Protection
    assert.strictEqual(g.rows[2].cells.ROGUE, 'Greater Salvation');
    assert.strictEqual(g.rows[2].cells.MAGE, 'Greater Salvation');
});
test('proposeBlessings: a feral druid counts as a tank for the salvation rule', () => {
    assert.strictEqual(E.proposeBlessings(palRoster().concat([P('Bear', 'DRUID', 'Feral')]), {}).rows[2].cells.DRUID, null);
    assert.strictEqual(E.proposeBlessings(palRoster().concat([P('Moon', 'DRUID', 'Balance')]), {}).rows[2].cells.DRUID, 'Greater Salvation');
});
test('proposeBlessings: a Guardian druid counts as a tank for the salvation rule', () => {
    assert.strictEqual(E.proposeBlessings(palRoster().concat([P('Bear', 'DRUID', 'Guardian')]), {}).rows[2].cells.DRUID, null);
    assert.strictEqual(E.proposeBlessings(palRoster().concat([P('Moon', 'DRUID', 'Balance')]), {}).rows[2].cells.DRUID, 'Greater Salvation');
});

function pala(name, spec, t) {
    const p = P(name, 'PALADIN', spec);
    if (t) p.talents = t;
    return p;
}
test('proposeBlessings: kings goes to the paladin who can actually cast it', () => {
    // Ret sorts first and would take Kings today; they are known-0, the Holy has it.
    const ret = pala('Aret', 'Retribution', { kings: 0, impMight: 5 });
    const holy = pala('Zholy', 'Holy', { kings: 1, impWisdom: 2 });
    const r = E.proposeBlessings([ret, holy, P('Grunt', 'WARRIOR', 'Arms')], {});
    const kingsRow = r.rows.find(row => row.cells.WARRIOR === 'Greater Kings');
    assert.ok(kingsRow, 'no row assigns Greater Kings');
    assert.strictEqual(kingsRow.paladin, 'Zholy');
    // The known-0 Ret slid to the Might/Wisdom plan instead of losing their row.
    const retRow = r.rows.find(row => row.paladin === 'Aret');
    assert.strictEqual(retRow.cells.WARRIOR, 'Greater Might');
});
test('proposeBlessings: when no paladin can cast kings, it is withheld and warned', () => {
    const r = E.proposeBlessings([pala('Aret', 'Retribution', { kings: 0 }),
                                  pala('Zholy', 'Holy', { kings: 0 }),
                                  P('Grunt', 'WARRIOR', 'Arms')], {});
    r.rows.forEach(row => Object.keys(row.cells).forEach(cls => {
        assert.notStrictEqual(row.cells[cls], 'Greater Kings');
    }));
    assert.ok(r.warnings.some(w => /Nobody can cast Blessing of Kings/.test(w)), r.warnings.join('; '));
});
test('proposeBlessings: a manual kings cell on a known-0 paladin warns but is not blocked', () => {
    const r = E.proposeBlessings([pala('Aret', 'Retribution', { kings: 0 }), P('Grunt', 'WARRIOR', 'Arms')],
                                 { 'Aret|WARRIOR': 'Greater Kings' });
    assert.strictEqual(r.rows.find(row => row.paladin === 'Aret').cells.WARRIOR, 'Greater Kings');
    assert.ok(r.warnings.some(w => /Aret cannot cast Blessing of Kings/.test(w)), r.warnings.join('; '));
});
test('proposeBlessings: the might/wisdom row goes to the better-talented paladin', () => {
    // Kings to the Ret (talented). Of the rest, Holy sorts first but is known-0 in both
    // improvements; the Prot has Imp Might — the talent flips the row assignment.
    const ret = pala('Aret', 'Retribution', { kings: 1 });
    const holy = pala('Bholy', 'Holy', { impMight: 0, impWisdom: 0 });
    const prot = pala('Zprot', 'Protection', { impMight: 5 });
    const r = E.proposeBlessings([ret, holy, prot, P('Grunt', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(r.rows.find(row => row.paladin === 'Zprot').cells.WARRIOR, 'Greater Might');
});
test('proposeBlessings: talented in either beats a paladin with no talent data at all', () => {
    // Spec decision 5's ordering is "talented in either > unknown > known-0 in both", which is
    // what Math.min(impMight tier, impWisdom tier) implements. Zprot is known-0 in Wisdom but
    // talented in Might (tiers 0, 2) — min(0, 2) = 0. Bholy has no talent data at all, so both
    // tiers read unknown (1, 1) — min(1, 1) = 1. 0 beats 1, so Zprot must take the row even
    // though Bholy sorts first by both name and spec order. Math.max would flip it: max(0, 2)
    // = 2 loses to max(1, 1) = 1, handing the row to Bholy instead — "talented in both", a
    // different rule the owner did not choose.
    const ret = pala('Aret', 'Retribution', { kings: 1 });
    const holy = pala('Bholy', 'Holy');
    const prot = pala('Zprot', 'Protection', { impMight: 5, impWisdom: 0 });
    const r = E.proposeBlessings([ret, holy, prot, P('Grunt', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(r.rows.find(row => row.paladin === 'Zprot').cells.WARRIOR, 'Greater Might');
});
test('proposeBlessings: a roster with no talent data reproduces the spec-order grid', () => {
    // The degrade-to-today rule for the grid: with every tier unknown, both sorts are
    // stable and paladin N gets plan N exactly as before this plan.
    const r = E.proposeBlessings([pala('Aret', 'Retribution'), pala('Bholy', 'Holy'),
                                  P('Grunt', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(r.rows.find(row => row.paladin === 'Aret').cells.WARRIOR, 'Greater Kings');
    assert.strictEqual(r.rows.find(row => row.paladin === 'Bholy').cells.WARRIOR, 'Greater Might');
    assert.deepStrictEqual(r.warnings, []);
});

test('buildDiscord: renders the blessings grid when present', () => {
    const roster = palRoster();
    const sheet = E.autoAssign(roster, {});
    sheet.blessings = E.proposeBlessings(roster, {});
    const out = E.buildDiscord(roster, sheet, {});
    assert.ok(/Blessings/i.test(out));
    assert.ok(out.includes('Retdin'));
    assert.ok(out.includes('Greater Kings'));
});
test('buildDiscord: omits the blessings section when absent', () => {
    const roster = palRoster();
    const out = E.buildDiscord(roster, E.autoAssign(roster, {}), {});
    assert.ok(!/Blessings/i.test(out));
});
test('buildDiscord: a paladin with an all-null row (4th+) is skipped, not printed with nothing after the colon', () => {
    const roster = palRoster().concat([P('Justice', 'PALADIN', 'Protection')]);
    // BLESSING_PLANS has only 4 entries and the 4th+ plan always returns null, so
    // Justice's row is empty by default — nothing to give with only four blessings.
    const sheet = E.autoAssign(roster, {});
    sheet.blessings = E.proposeBlessings(roster, {});
    const out = E.buildDiscord(roster, sheet, {});
    assert.ok(!out.includes('Justice'));
    assert.ok(out.includes('Retdin'));
    assert.ok(out.includes('Lightbringer'));
    assert.ok(out.includes('Bubbles'));
});
test('buildDiscord: warrior and warlock disambiguate in the blessings line', () => {
    const roster = [
        P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'),
        P('Warry', 'WARRIOR', 'Fury'), P('Locky', 'WARLOCK', 'Affliction'),
    ];
    const sheet = E.autoAssign(roster, {});
    sheet.blessings = E.proposeBlessings(roster, {});
    const out = E.buildDiscord(roster, sheet, {});
    // Ret's row gives everyone Greater Kings, so WARRIOR and WARLOCK land in the same
    // "→ classes" list — with the old `slice(0, 3)` abbreviation both read "WAR" and a
    // raid lead cannot tell them apart.
    const retLine = out.split('\n').find(l => l.includes('Retdin:'));
    assert.ok(retLine.includes('LOCK'));
    assert.ok(!retLine.includes('WAR/WAR'));
});

test('autoAssign: fear ward rotation lists every priest, discipline first', () => {
    // Names are deliberately anti-alphabetical: rankPool falls back to a name sort, so a
    // fixture in alphabetical order cannot tell a working preferSpecs from a missing one.
    const roster = [P('Ashadow', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy'), P('Zdiscy', 'PRIEST', 'Discipline')];
    const r = E.autoAssign(roster, {});
    const fw = duty(r, 'fearward');
    assert.strictEqual(fw.category, 'rotations');
    assert.deepStrictEqual(fw.players, ['Zdiscy', 'Holymel', 'Ashadow']);
});
test('autoAssign: fear ward rotation excludes a priest the addon could not spec', () => {
    // The ROTATIONS block hand-rolls its own spec-unknown check instead of reusing eligible()'s,
    // so it can drift independently — a scan the addon could not read should not put a player
    // on a rotation the raid lead never got to vet.
    const roster = [P('Zdiscy', 'PRIEST', 'Discipline'), P('Unknown', 'PRIEST', null, { flags: ['spec-unknown'] })];
    const r = E.autoAssign(roster, {});
    assert.deepStrictEqual(duty(r, 'fearward').players, ['Zdiscy']);
});
test('autoAssign: tranq shot rotation lists hunters', () => {
    // Anti-alphabetical AND three-deep on purpose: with only two hunters the duty-count tiebreak
    // reproduces the preferSpecs order by itself, so a two-hunter fixture proves nothing.
    const r = E.autoAssign([P('Aaa', 'HUNTER', 'Survival'), P('Mmm', 'HUNTER', 'Marksmanship'),
                            P('Zzz', 'HUNTER', 'Beast Mastery')], {});
    assert.deepStrictEqual(duty(r, 'tranq').players, ['Zzz', 'Mmm', 'Aaa']);
});
test('autoAssign: a rotation with nobody eligible produces no row and no warning', () => {
    const r = E.autoAssign([P('Stabby', 'ROGUE', 'Combat')], {});
    assert.ok(!duty(r, 'fearward'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'fearward'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'fearward'));
});
test('autoAssign: a rotation override replaces the order and drops absent names', () => {
    const roster = [P('Shadowmel', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy')];
    const r = E.autoAssign(roster, { fearward: { players: ['Shadowmel', 'Ghost', 'Holymel'] } });
    assert.deepStrictEqual(duty(r, 'fearward').players, ['Shadowmel', 'Holymel']);
});

// --- I1: assignments.js's recompute() sweep reconciles o.players against roster churn ---
// There is no DOM harness in this repo, so this mirrors the exact block added to recompute()'s
// `Object.values(state.overrides).forEach(...)` sweep in assignments.js, and drives autoAssign
// with its output the way recompute() does — proving the algorithm, since the browser file
// itself can't be required here without a `document`.
function sweepStaleRotationNames(overrides, names) {
    Object.values(overrides).forEach(o => {
        if (o.players) {
            const kept = o.players.filter(n => names.has(n));
            // Only fall back to auto-assignment when the sweep is what emptied the list. A list
            // the lead emptied with ✕ stays empty on purpose — that row is meant to be gone.
            if (!kept.length && o.players.length) delete o.players;
            else o.players = kept;
        }
    });
}
test('I1: roster churn that empties a rotation override falls back to auto-assignment, not a deleted row', () => {
    // Measured case: override fearward = { players: ['OldPriest'] }, roster re-imported with
    // just NewPriest. Without the sweep, autoAssign's own byName filter empties the list and
    // `if (!players.length) return;` drops the Fear Ward row entirely, even though a priest
    // capable of casting it is standing right there.
    const roster = [P('NewPriest', 'PRIEST', 'Holy')];
    const overrides = { fearward: { players: ['OldPriest'] } };
    sweepStaleRotationNames(overrides, new Set(roster.map(p => p.name)));
    assert.ok(!Object.prototype.hasOwnProperty.call(overrides.fearward, 'players'));
    const r = E.autoAssign(roster, overrides);
    assert.deepStrictEqual(duty(r, 'fearward').players, ['NewPriest']);
});
test('I1: roster churn that partially empties a rotation override keeps the survivors, adds nobody', () => {
    // Measured case: override fearward = { players: ['A', 'B'] }, roster [A, C]. B departed and
    // is swept; C is newly present but must NOT be added — that stays the raid lead's call, like
    // every other override (owner ruling).
    const roster = [P('A', 'PRIEST', 'Holy'), P('C', 'PRIEST', 'Holy')];
    const overrides = { fearward: { players: ['A', 'B'] } };
    sweepStaleRotationNames(overrides, new Set(roster.map(p => p.name)));
    const r = E.autoAssign(roster, overrides);
    assert.deepStrictEqual(duty(r, 'fearward').players, ['A']);
});
test('I1: a rotation the lead emptied with X stays empty, the sweep does not resurrect it', () => {
    // Out-of-scope guard: { players: [] } is deliberate (every chip removed by hand), and I1's
    // "only fall back when the sweep itself emptied the list" guard must leave it alone rather
    // than treating an already-empty list as something roster churn caused.
    const roster = [P('A', 'PRIEST', 'Holy')];
    const overrides = { fearward: { players: [] } };
    sweepStaleRotationNames(overrides, new Set(roster.map(p => p.name)));
    assert.ok(Object.prototype.hasOwnProperty.call(overrides.fearward, 'players'));
    assert.deepStrictEqual(overrides.fearward.players, []);
    const r = E.autoAssign(roster, overrides);
    assert.ok(!duty(r, 'fearward'), 'an intentionally emptied rotation must stay hidden, not resume auto-assignment');
});

test('autoAssign: thunder clap, insect swarm and hemorrhage are assigned', () => {
    const roster = [P('Smashy', 'WARRIOR', 'Arms'), P('Moonpie', 'DRUID', 'Balance'),
                    P('Legolass', 'HUNTER', 'Marksmanship'), P('Sneaky', 'ROGUE', 'Subtlety')];
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'tclap').player, 'Smashy');
    assert.strictEqual(duty(r, 'swarm').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hemo').player, 'Sneaky');
});
test('autoAssign: insect swarm needs a balance druid, hemorrhage a sub rogue', () => {
    const r = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Stabby', 'ROGUE', 'Combat')], {});
    assert.ok(!duty(r, 'swarm'));
    assert.ok(!duty(r, 'hemo'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'swarm'));
});
test('autoAssign: a combat rogue makes hemorrhage not applicable, not missing', () => {
    const r = E.autoAssign([P('Stabby', 'ROGUE', 'Combat')], {});
    assert.ok(!duty(r, 'hemo'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'hemo'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'hemo'));
});
test('autoAssign: hemorrhage requires Subtlety specifically, not just any rogue', () => {
    // Anti-alphabetical on purpose, matching the other requireSpec/preferSpecs fixtures in this
    // file: applicableWhen only checks a Sub rogue is present somewhere in the raid, it does not
    // stop the assignment loop from handing the duty to a Combat rogue standing right next to one.
    const r = E.autoAssign([P('Astab', 'ROGUE', 'Combat'), P('Zsneak', 'ROGUE', 'Subtlety')], {});
    assert.strictEqual(duty(r, 'hemo').player, 'Zsneak');
});
test('autoAssign: thunder clap prefers the arms warrior over the tank', () => {
    // Anti-alphabetical on purpose: rankPool's name tiebreak would otherwise produce the same
    // answer whether or not preferSpecs exists.
    const r = E.autoAssign([P('Aegis', 'WARRIOR', 'Protection'), P('Zarms', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(duty(r, 'tclap').player, 'Zarms');
});

test('buildDiscord: renders rotations as a numbered order', () => {
    // Anti-alphabetical on purpose — see F1b.
    const roster = [P('Holymel', 'PRIEST', 'Holy'), P('Zdiscy', 'PRIEST', 'Discipline', { discordId: '77' })];
    const sheet = E.autoAssign(roster, {});
    const out = E.buildDiscord(roster, sheet, {});
    const line = out.split('\n').find(l => /Fear Ward/.test(l));
    assert.ok(line, 'no Fear Ward line in the output');
    assert.ok(line.indexOf('Zdiscy') < line.indexOf('Holymel'), line);
    assert.ok(line.includes('1. Zdiscy'), line); // the numbering itself, not just relative order
    assert.ok(out.includes('**Rotations**'), 'no Rotations heading');
    assert.ok(out.includes('30s cooldown'), 'no rotation note'); // ROTATIONS[].note, e.g. Fear Ward's
    const pinged = E.buildDiscord(roster, sheet, { pings: true });
    const pingedLine = pinged.split('\n').find(l => /Fear Ward/.test(l));
    assert.ok(pingedLine.includes('<@77>'), pingedLine); // rotation names go through nm() too
});
test('buildDiscord: rotations sit between cooldowns and crowd control', () => {
    const roster = [P('Locky', 'WARLOCK', 'Affliction'), P('Zdiscy', 'PRIEST', 'Discipline'),
                    P('Frostina', 'MAGE', 'Frost')];
    const sheet = E.autoAssign(roster, {});
    sheet.cc = E.defaultCC(roster);
    const out = E.buildDiscord(roster, sheet, {});
    const at = s => out.indexOf(s);
    assert.ok(at('**Cooldowns**') !== -1 && at('**Rotations**') !== -1 && at('**Crowd Control**') !== -1,
        'expected all three sections:\n' + out);
    assert.ok(at('**Cooldowns**') < at('**Rotations**'), out);
    assert.ok(at('**Rotations**') < at('**Crowd Control**'), out);
});

test('parseAddonExport: RSS3 carries tracked talent ranks', () => {
    const r = E.parseAddonExport('RSS3;Smashy:WARRIOR:33/28/0:4:Orc:impThunderClap=3,impDemoShout=0').players;
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].group, 4);
    assert.strictEqual(r[0].race, 'Orc');
    assert.deepStrictEqual(r[0].talents, { impThunderClap: 3, impDemoShout: 0 });
});
test('parseAddonExport: rank 0 is data, not absence', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:1:Human:impExposeArmor=0').players;
    assert.strictEqual(r[0].talents.impExposeArmor, 0);
});
test('parseAddonExport: an empty field does not take the later ones with it', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5::Human:impExposeArmor=2').players;
    assert.strictEqual(r[0].group, null);
    assert.strictEqual(r[0].race, 'Human');            // RSS2 dropped this
    assert.strictEqual(r[0].talents.impExposeArmor, 2);
    const r2 = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4::impExposeArmor=2').players;
    assert.strictEqual(r2[0].group, 4);
    assert.strictEqual(r2[0].race, null);
    assert.strictEqual(r2[0].talents.impExposeArmor, 2);
});
test('parseAddonExport: no talent field means unknown, not empty', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human:').players;
    assert.strictEqual(r[0].talents, null);
    const r2 = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human').players;
    assert.strictEqual(r2[0].talents, null);
});
test('parseAddonExport: RSS2 and RSS1 lines still parse, with no talent data', () => {
    const two = E.parseAddonExport('RSS2;Stabby:ROGUE:15/41/5:4:Human').players;
    assert.strictEqual(two[0].group, 4);
    assert.strictEqual(two[0].race, 'Human');
    assert.strictEqual(two[0].talents, null);
    const one = E.parseAddonExport('RSS1;Stabby:ROGUE:15/41/5').players;
    assert.strictEqual(one[0].group, null);
    assert.strictEqual(one[0].race, null);
    assert.strictEqual(one[0].talents, null);
});
test('parseAddonExport: a malformed talent field rejects the line', () => {
    const res = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human:impExposeArmor');
    assert.strictEqual(res.players.length, 0);
    assert.ok(res.errors.some(e => /Stabby/.test(e)));
});
test('parseAddonExport: rejects a field count over the limit, an empty name, and a non-alpha race', () => {
    const tooManyFields = E.parseAddonExport('RSS3;A:ROGUE:1/1/1:4:Human:x=1:extra');
    assert.strictEqual(tooManyFields.players.length, 0);
    assert.strictEqual(tooManyFields.errors.length, 1);

    const emptyName = E.parseAddonExport('RSS3;:ROGUE:1/1/1');
    assert.strictEqual(emptyName.players.length, 0);
    assert.strictEqual(emptyName.errors.length, 1);

    const digitRace = E.parseAddonExport('RSS3;A:ROGUE:1/1/1:4:Hum4n');
    assert.strictEqual(digitRace.players.length, 0);
    assert.strictEqual(digitRace.errors.length, 1);
});

function withTalents(p, t) { p.talents = t; return p; }
test('talentRank: reads the rank the addon reported', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 2 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), 2);
});
test('talentRank: rank 0 is a real answer, not unknown', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 0 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), 0);
});
test('talentRank: no talent data is unknown, not zero', () => {
    assert.strictEqual(E.talentRank(P('Stabby', 'ROGUE', 'Combat'), 'impExposeArmor'), null);
    // scanned, but this key was not among the pairs — the addon could not find the talent
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), {});
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
});
test('talentRank: a key belonging to another class is unknown', () => {
    const p = withTalents(P('Smashy', 'WARRIOR', 'Arms'), { impExposeArmor: 2 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
});
test('talentRank: a rank above maxRank is treated as unknown, not trusted', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 9 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
    assert.deepStrictEqual(E.talentDrift([p]), [{ name: 'Stabby', key: 'impExposeArmor' }]);
});
test('talentDrift: a clean roster reports nothing', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 2 });
    // Smashy carries impExposeArmor's over-maxRank check under a key that belongs to ROGUE,
    // not WARRIOR — talentDrift must not report it, the same cross-class hole talentRank's
    // `def.class !== player.class` check was already fixed for.
    const w = withTalents(P('Smashy', 'WARRIOR', 'Arms'), { impExposeArmor: 9 });
    assert.deepStrictEqual(E.talentDrift([p, w]), []);
});
test('talentRank: a key the table does not know is unknown', () => {
    // The catalog names talent keys by hand in `improvedBy`; a typo there must read as
    // unknown rather than throwing on `def.class`.
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { bogusKey: 3 });
    assert.strictEqual(E.talentRank(p, 'bogusKey'), null);
});

test('autoAssign: an improvedBy row states the talent it found', () => {
    const r = E.autoAssign([rogue('Zcombat', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'Improved Expose Armor 2/2');
});
test('autoAssign: an improvedBy row says so when the talent is missing', () => {
    const r = E.autoAssign([rogue('Zcombat', 'Combat', 0)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'no Improved Expose Armor');
});
test('autoAssign: an improvedBy row says so when the talent is unknown', () => {
    const p = rogue('Zcombat', 'Combat', null);
    p.talents = { hemorrhage: 0 }; // scanned, but impExposeArmor was not among the pairs
    const r = E.autoAssign([p], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'talent unknown');
});
test('autoAssign: a player who was never scanned gets no qualifier at all', () => {
    // The owner's call on the whole-plan review: an unset `talents` means a Raid-Helper
    // signup, a manually added player, or a player the addon never inspected — not a finding,
    // just the common case on most rosters. Saying "talent unknown" there only restates that
    // fact, repeated on every talent-dependent row the player holds, so the row must carry no
    // qualifier at all rather than the old noisy text.
    const r = E.autoAssign([rogue('Zcombat', 'Combat', null)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, undefined);
});
test('autoAssign: a requireTalent row still says talent unknown for a scanned player missing this key', () => {
    // Distinct from the test above: this mage WAS scanned (talents is set), just not for
    // wintersChill. That gap is a real diagnostic — a talent-name drift between the addon and
    // TALENTS, or a known scan-bounds bug in the addon — so it must keep saying so, unlike the
    // wholly-unscanned case.
    const p = mage('Zfrost', 'Frost', null);
    p.talents = { impScorch: 0 };
    const r = E.autoAssign([p], {});
    assert.strictEqual(duty(r, 'wc').qualifier, 'talent unknown');
});
test('autoAssign: a row without improvedBy carries no qualifier', () => {
    // hemo was the example here until it gained requireTalent. The Sunder provider has
    // neither field, so this keeps the invariant on the same row as the three tests above,
    // and additionally pins that a provider without improvedBy does not inherit one.
    const r = E.autoAssign([P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').qualifier, undefined);
});
test('buildDiscord: the qualifier rides along on the duty line', () => {
    const roster = [rogue('Zcombat', 'Combat', 0)];
    const out = E.buildDiscord(roster, E.autoAssign(roster, {}), {});
    const line = out.split('\n').find(l => /Improved Expose Armor —/.test(l));
    assert.ok(line, 'no armor line in the output');
    assert.ok(/\(no Improved Expose Armor\)$/.test(line), line);
});
test('buildDiscord: the qualifier stays ASCII', () => {
    const roster = [rogue('Zcombat', 'Combat', 0)];
    const sheet = E.autoAssign(roster, {});
    sheet.duties.filter(d => d.qualifier).forEach(d => {
        assert.ok(!/[^\x00-\x7F]/.test(d.qualifier), d.qualifier);
    });
    assert.ok(sheet.duties.some(d => d.qualifier), 'expected at least one qualifier to check');
    // The fixture above only ever exercises impExposeArmor's name. Check every entry in the
    // table directly so a future non-ASCII TALENTS name is caught even if no fixture happens
    // to route a qualifier through it.
    Object.keys(E.TALENTS).forEach(key => {
        assert.ok(!/[^\x00-\x7F]/.test(E.TALENTS[key].name), E.TALENTS[key].name);
    });
});

test('RaidSpecScan.lua TRACKED_TALENTS stays in parity with the engine TALENTS table', () => {
    // The talent keys are the one coupling between the two sides of the wire: the addon
    // resolves them by name and exports the key, the engine looks the key back up in
    // TALENTS. An engine-side rename dies loudly across many tests; an addon-side rename is
    // invisible to every other test in this file, because nothing else here executes or
    // reads the Lua. Read with a path relative to __dirname, not cwd — a relative path would
    // silently read the wrong file if the process started elsewhere.
    const fs = require('node:fs');
    const path = require('node:path');
    const luaPath = path.join(__dirname, 'RaidSpecScan', 'RaidSpecScan.lua');
    const lua = fs.readFileSync(luaPath, 'utf8');

    const blockMatch = lua.match(/local TRACKED_TALENTS = \{([\s\S]*?)\n\s*\}/);
    assert.ok(blockMatch, 'could not find TRACKED_TALENTS in RaidSpecScan.lua — did it move or get renamed?');

    const luaTalents = {};
    const classRe = /(\w+)\s*=\s*\{([^{}]*)\}/g;
    let classMatch;
    while ((classMatch = classRe.exec(blockMatch[1]))) {
        const cls = classMatch[1];
        const pairRe = /(\w+)\s*=\s*"([^"]+)"/g;
        let pairMatch;
        while ((pairMatch = pairRe.exec(classMatch[2]))) {
            luaTalents[pairMatch[1]] = { class: cls, name: pairMatch[2] };
        }
    }

    // A parse that matches nothing would leave luaTalents empty and every assertion below
    // vacuously true — which is exactly the failure mode this whole test exists to catch.
    // Fail loudly instead of silently reporting "no mismatches".
    assert.strictEqual(Object.keys(luaTalents).length, 15,
        'parsed the wrong number of talents out of RaidSpecScan.lua — regex likely did not match the table shape');

    assert.deepStrictEqual(Object.keys(luaTalents).sort(), Object.keys(E.TALENTS).sort());
    Object.keys(luaTalents).forEach(key => {
        assert.strictEqual(luaTalents[key].name, E.TALENTS[key].name, `name mismatch for ${key}`);
        assert.strictEqual(luaTalents[key].class, E.TALENTS[key].class, `class mismatch for ${key}`);
    });
});

function lock(name, spec, rank) {
    const p = P(name, 'WARLOCK', spec);
    if (rank !== null) p.talents = { malediction: rank };
    return p;
}
test('autoAssign: curse of elements goes to the lock with Malediction, not the spec guess', () => {
    // Affliction is the preferred spec, but Malediction is the thing the preference proxied.
    const r = E.autoAssign([lock('Aaffl', 'Affliction', 0), lock('Zdestro', 'Destruction', 3)], {});
    assert.strictEqual(duty(r, 'coe').player, 'Zdestro');
    assert.strictEqual(duty(r, 'coe').qualifier, 'Malediction 3/3');
});
function dru(name, spec, key, rank) {
    const p = P(name, 'DRUID', spec);
    if (rank !== null) { p.talents = {}; p.talents[key] = rank; }
    return p;
}
test('autoAssign: faerie fire goes to the druid with Improved Faerie Fire', () => {
    // Balance ranks ahead of Feral on preferSpecs; the talent flips it.
    const r = E.autoAssign([dru('Abal', 'Balance', 'impFaerieFire', 0),
                            dru('Zferal', 'Feral', 'impFaerieFire', 3)], {});
    assert.strictEqual(duty(r, 'ff').player, 'Zferal');
});
test('autoAssign: demoralizing roar goes to the druid with Feral Aggression', () => {
    // No warrior/warlock/hunter in the roster, so ap falls to the druid provider; the
    // Feral preference loses to the talent.
    const r = E.autoAssign([dru('Aferal', 'Feral', 'feralAggression', 0),
                            dru('Zresto', 'Restoration', 'feralAggression', 5)], {});
    assert.strictEqual(duty(r, 'ap').player, 'Zresto');
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
});
function hunt(name, spec, rank) {
    const p = P(name, 'HUNTER', spec);
    if (rank !== null) p.talents = { impHuntersMark: rank };
    return p;
}
test("autoAssign: hunter's mark goes to the hunter whose mark is improved", () => {
    const r = E.autoAssign([hunt('Amm', 'Marksmanship', 0), hunt('Zbm', 'Beast Mastery', 5)], {});
    assert.strictEqual(duty(r, 'hm').player, 'Zbm');
});
test('autoAssign: ranker rows with an unknown talent rank keep their spec-guess pick', () => {
    // The degrade-to-today rule: unknown data must reproduce the current behaviour. Both locks
    // are scanned, but Malediction is not among the pairs the addon found for either — that
    // keeps the qualifier meaningful (see below) without disturbing the pick logic, which only
    // cares that talentRank(p, 'malediction') comes back null for both.
    const aaffl = lock('Aaffl', 'Affliction', null); aaffl.talents = { unrelatedTalent: 0 };
    const zdestro = lock('Zdestro', 'Destruction', null); zdestro.talents = { unrelatedTalent: 0 };
    const r = E.autoAssign([aaffl, zdestro], {});
    assert.strictEqual(duty(r, 'coe').player, 'Aaffl');
    assert.strictEqual(duty(r, 'coe').qualifier, 'talent unknown');
});

function mage(name, spec, rank) {
    const p = P(name, 'MAGE', spec);
    if (rank !== null) p.talents = { wintersChill: rank };
    return p;
}
test('autoAssign: winters chill goes to the mage who has the talent, spec notwithstanding', () => {
    // Tree totals said Fire, but they took Winter's Chill; totals were always a guess.
    const r = E.autoAssign([mage('Zfire', 'Fire', 5)], {});
    assert.strictEqual(duty(r, 'wc').player, 'Zfire');
    assert.strictEqual(duty(r, 'wc').qualifier, "Winter's Chill 5/5");
});
test('autoAssign: a frost mage known to lack winters chill does not get the row', () => {
    const r = E.autoAssign([mage('Afrost', 'Frost', 0)], {});
    assert.ok(!duty(r, 'wc') || duty(r, 'wc').player === null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'wc'));
});
test('autoAssign: a frost mage with unknown talents keeps the row, as today', () => {
    const p = mage('Afrost', 'Frost', null);
    p.talents = { impScorch: 0 }; // scanned, but wintersChill was not among the pairs
    const r = E.autoAssign([p], {});
    assert.strictEqual(duty(r, 'wc').player, 'Afrost');
    assert.strictEqual(duty(r, 'wc').qualifier, 'talent unknown');
});
function subrogue(name, spec, rank) {
    const p = P(name, 'ROGUE', spec);
    if (rank !== null) p.talents = { hemorrhage: rank };
    return p;
}
test('autoAssign: a subtlety rogue known to lack hemorrhage files the row notApplicable', () => {
    // The gate and the applicability warning must agree: known-cannot-cast is the same
    // no-noise case as no-subtlety-rogue-at-all, not a "missing" alarm.
    const r = E.autoAssign([subrogue('Astab', 'Subtlety', 0)], {});
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'hemo'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'hemo'));
});
test('autoAssign: a subtlety rogue with unknown talents keeps hemorrhage, as today', () => {
    const r = E.autoAssign([subrogue('Astab', 'Subtlety', null)], {});
    assert.strictEqual(duty(r, 'hemo').player, 'Astab');
});
test('catalog: all four gate rows carry their requireTalent through providersOf', () => {
    // providersOf rebuilds single-class entries from an explicit field allowlist; a field
    // left off that list is silently dropped, and the gate would never fire.
    [['scorch', 'impScorch'], ['wc', 'wintersChill'], ['swarm', 'insectSwarm'], ['hemo', 'hemorrhage']]
        .forEach(pair => {
            const entry = E.DEBUFF_CATALOG.find(e => e.id === pair[0]);
            assert.strictEqual(E.providersOf(entry)[0].requireTalent, pair[1], pair[0]);
        });
});
function scorchMage(name, spec, rank) {
    const p = P(name, 'MAGE', spec);
    if (rank !== null) p.talents = { impScorch: rank };
    return p;
}
test('autoAssign: improved scorch goes to the frost mage who has the talent, spec notwithstanding', () => {
    // Tree totals said Frost, but they took Improved Scorch; totals were always a guess.
    const r = E.autoAssign([scorchMage('Zfrost', 'Frost', 3)], {});
    assert.strictEqual(duty(r, 'scorch').player, 'Zfrost');
    assert.strictEqual(duty(r, 'scorch').qualifier, 'Improved Scorch 3/3');
});
test('autoAssign: a fire mage known to lack improved scorch does not get the row', () => {
    const r = E.autoAssign([scorchMage('Afire', 'Fire', 0)], {});
    assert.ok(!duty(r, 'scorch') || duty(r, 'scorch').player === null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'scorch'));
});
test('autoAssign: a fire mage with unknown talents keeps improved scorch, as today', () => {
    const p = scorchMage('Afire', 'Fire', null);
    p.talents = { wintersChill: 0 }; // scanned, but impScorch was not among the pairs
    const r = E.autoAssign([p], {});
    assert.strictEqual(duty(r, 'scorch').player, 'Afire');
    assert.strictEqual(duty(r, 'scorch').qualifier, 'talent unknown');
});
test('autoAssign: insect swarm goes to the restoration druid who has the talent, spec notwithstanding', () => {
    // Tree totals said Restoration, but they took Insect Swarm; totals were always a guess.
    const r = E.autoAssign([dru('Zresto', 'Restoration', 'insectSwarm', 1)], {});
    assert.strictEqual(duty(r, 'swarm').player, 'Zresto');
    assert.strictEqual(duty(r, 'swarm').qualifier, 'Insect Swarm 1/1');
});
test('autoAssign: a balance druid known to lack insect swarm does not get the row', () => {
    // swarm has no applicableWhen (unlike hemo) — it deliberately still files missing.
    const r = E.autoAssign([dru('Abal', 'Balance', 'insectSwarm', 0)], {});
    assert.ok(!duty(r, 'swarm') || duty(r, 'swarm').player === null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'swarm'));
});
test('autoAssign: a balance druid with unknown talents keeps insect swarm, as today', () => {
    const p = dru('Abal', 'Balance', 'insectSwarm', null);
    p.talents = { feralAggression: 0 }; // scanned, but insectSwarm was not among the pairs
    const r = E.autoAssign([p], {});
    assert.strictEqual(duty(r, 'swarm').player, 'Abal');
    assert.strictEqual(duty(r, 'swarm').qualifier, 'talent unknown');
});
test('autoAssign: hemorrhage goes to the combat rogue who has the talent, spec notwithstanding', () => {
    // Tree totals said Combat, but they took Hemorrhage; totals were always a guess.
    const r = E.autoAssign([subrogue('Zcombat', 'Combat', 1)], {});
    assert.strictEqual(duty(r, 'hemo').player, 'Zcombat');
    assert.strictEqual(duty(r, 'hemo').qualifier, 'Hemorrhage 1/1');
});

test('autoAssign: a rogue known to lack improved expose armor loses armor to sunder', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', 0), P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').player, 'Ztank');
    assert.strictEqual(duty(r, 'armor').name, 'Sunder Armor');
});
test('autoAssign: a rogue with unknown talents keeps armor ahead of sunder, as today', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', null), P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').player, 'Astab');
    assert.strictEqual(duty(r, 'armor').name, 'Improved Expose Armor');
});
test('autoAssign: a known-untalented rogue still beats an empty armor row', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', 0)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Astab');
    assert.strictEqual(duty(r, 'armor').qualifier, 'no Improved Expose Armor');
});
test('autoAssign: a rogue with an unknown armor talent protects the row even with a known-0 rogue present', () => {
    // Spec decision 6: a provider is demoted only when its BEST eligible candidate is
    // known-untalented. With two rogues, Aunk (impExposeArmor unknown, but scanned — hemorrhage
    // is on record) outranks Zbad (known-0) inside the Improved Expose Armor pool, so the
    // pool's best candidate (pool[0]) is unknown, not known-untalented, and the row must not
    // demote to Sunder Armor even though a known-0 sibling is standing right there. Reading
    // pool[pool.length - 1] instead would grab Zbad and wrongly demote to the Protection
    // warrior's Sunder Armor.
    const aunk = rogue('Aunk', 'Combat', null);
    aunk.talents = { hemorrhage: 0 }; // scanned, but impExposeArmor was not among the pairs
    const r = E.autoAssign([aunk, rogue('Zbad', 'Combat', 0),
                            P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').name, 'Improved Expose Armor');
    assert.strictEqual(duty(r, 'armor').player, 'Aunk');
    assert.strictEqual(duty(r, 'armor').qualifier, 'talent unknown');
});
test('autoAssign: an ap warrior known to lack imp demo shout loses the row to curse of weakness', () => {
    // THREE locks: coe and cor each burn one via the curse-exclusivity group before the ap
    // row runs, so a third is needed for Curse of Weakness to have an eligible caster.
    function dslock(name) { return P(name, 'WARLOCK', 'Affliction'); }
    const war = P('Awar', 'WARRIOR', 'Arms');
    war.talents = { impDemoShout: 0 };
    const r = E.autoAssign([war, dslock('Block'), dslock('Clock'), dslock('Dlock')], {});
    assert.strictEqual(duty(r, 'ap').name, 'Curse of Weakness');
});

test('SELECTABLE_SPECS: druids can be marked Guardian, other classes are unchanged', () => {
    assert.deepStrictEqual(E.SELECTABLE_SPECS.DRUID, ['Balance', 'Feral', 'Guardian', 'Restoration']);
    assert.deepStrictEqual(E.SELECTABLE_SPECS.MAGE, ['Arcane', 'Fire', 'Frost']);
});
test('SPEC_TREES stays positional so talent inference is unaffected', () => {
    assert.deepStrictEqual(E.SPEC_TREES.DRUID, ['Balance', 'Feral', 'Restoration']);
    assert.strictEqual(E.inferSpec('DRUID', [0, 47, 14]).spec, 'Feral');
});
test('isFeralSpec: guardian and feral both count as feral for abilities', () => {
    assert.strictEqual(E.isFeralSpec('Feral'), true);
    assert.strictEqual(E.isFeralSpec('Guardian'), true);
    assert.strictEqual(E.isFeralSpec('Balance'), false);
    assert.strictEqual(E.isFeralSpec(null), false);
});
test('parseRaidHelper: a Guardian signup stays Guardian instead of collapsing to Feral', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Bearface', className: 'Druid', specName: 'Guardian', status: 'primary', userId: '1' },
    ] });
    assert.strictEqual(r.players[0].spec, 'Guardian');
    assert.deepStrictEqual(r.players[0].flags, []);
});

test('mergeRosters: a Guardian signup refines the addon Feral rather than being overwritten', () => {
    const addon = [{ name: 'Bearface', class: 'DRUID', spec: 'Feral', flags: [], source: 'addon' }];
    const rh = [{ name: 'Bearface', class: 'DRUID', spec: 'Guardian', discordId: '1', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    const bear = r.roster.find(p => p.name === 'Bearface');
    assert.strictEqual(bear.spec, 'Guardian');
    assert.deepStrictEqual(r.mismatches, []);
    assert.ok(!bear.flags.some(f => /signed-as/.test(f)));
});
test('mergeRosters: Feral signup against an addon Feral is not a mismatch either', () => {
    const addon = [{ name: 'Kitty', class: 'DRUID', spec: 'Feral', flags: [], source: 'addon' }];
    const rh = [{ name: 'Kitty', class: 'DRUID', spec: 'Feral', discordId: '2', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    assert.strictEqual(r.roster[0].spec, 'Feral');
    assert.deepStrictEqual(r.mismatches, []);
});
test('mergeRosters: a genuine spec disagreement is still flagged', () => {
    const addon = [{ name: 'Moonpie', class: 'DRUID', spec: 'Balance', flags: [], source: 'addon' }];
    const rh = [{ name: 'Moonpie', class: 'DRUID', spec: 'Restoration', discordId: '3', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    assert.strictEqual(r.roster[0].spec, 'Balance');
    assert.strictEqual(r.mismatches.length, 1);
});

test('autoAssign: a Guardian druid can take faerie fire and demoralizing roar', () => {
    // A cat is in the roster so preferSpecs ordering is actually exercised — with a lone druid
    // the pool has one candidate and this would pass whether or not Guardian is preferred.
    const r = E.autoAssign([P('Kitty', 'DRUID', 'Feral'), P('Bearface', 'DRUID', 'Guardian')], {});
    assert.strictEqual(duty(r, 'ff').player, 'Bearface');
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
    assert.strictEqual(duty(r, 'ap').player, 'Bearface');
});
test('autoAssign: a Guardian druid provides Mangle', () => {
    const r = E.autoAssign([P('Bearface', 'DRUID', 'Guardian')], {});
    assert.ok(r.passives.some(p => p.name === 'Mangle' && p.player === 'Bearface'));
});
test('autoAssign: faerie fire prefers balance, then guardian, then cat, then resto', () => {
    const all = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Kitty', 'DRUID', 'Feral'),
                              P('Bearface', 'DRUID', 'Guardian'), P('Moonpie', 'DRUID', 'Balance')], {});
    assert.strictEqual(duty(all, 'ff').player, 'Moonpie');
    const noBalance = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Kitty', 'DRUID', 'Feral'),
                                    P('Bearface', 'DRUID', 'Guardian')], {});
    assert.strictEqual(duty(noBalance, 'ff').player, 'Bearface'); // bear keeps FF up for threat anyway
});

test('parseRaidHelper: Tank pseudo-class resolves to the real class via its spec', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Warbear', className: 'Tank', specName: 'Guardian', userId: 1, status: 'primary' },
        { name: 'Bubbles', className: 'Tank', specName: 'Protection1', userId: 2, status: 'primary' },
        { name: 'Shieldy', className: 'Tank', specName: 'Protection', userId: 3, status: 'primary' },
    ] });
    assert.strictEqual(r.errors.length, 0);
    const by = n => r.players.find(p => p.name === n);
    assert.deepStrictEqual([by('Warbear').class, by('Warbear').spec], ['DRUID', 'Guardian']);
    assert.deepStrictEqual([by('Bubbles').class, by('Bubbles').spec], ['PALADIN', 'Protection']);
    assert.deepStrictEqual([by('Shieldy').class, by('Shieldy').spec], ['WARRIOR', 'Protection']);
});
test('parseRaidHelper: a Tank signup with an unrecognized spec is an error, not a crash', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Confused', className: 'Tank', specName: 'Holy', userId: 4, status: 'primary' },
    ] });
    assert.strictEqual(r.players.length, 0);
    assert.strictEqual(r.errors.length, 1);
    assert.ok(r.errors[0].includes('tank spec') && r.errors[0].includes('Confused'));
});

test('bucketOf: Guardian is a tank, not melee', () => {
    assert.strictEqual(E.bucketOf(P('bear', 'DRUID', 'Guardian')), 'tanks');
});
test('proposeGroups: a Guardian lands with the tanks and still notes Leader of the Pack', () => {
    const roster = raid25().map(p => p.name === 'Feral' ? P('Feral', 'DRUID', 'Guardian') : p);
    const res = E.proposeGroups(roster);
    assert.strictEqual(groupOf(res, 'Feral'), 'tanks');
    const tanks = res.groups.find(g => g.players.some(p => p.name === 'Feral'));
    assert.ok(tanks.notes.some(t => /Leader of the Pack/.test(t)));
});

test('proposeGroups: two resto shamans never share a group', () => {
    const roster = raid25().filter(p => p.name !== 'Ret2').concat([P('Resto2', 'SHAMAN', 'Restoration')]);
    const res = E.proposeGroups(roster);
    assert.notStrictEqual(groupOf(res, 'Resto'), groupOf(res, 'Resto2'));
});
test('proposeGroups: the spare resto shaman lands in a group that had no shaman', () => {
    const roster = raid25().filter(p => p.name !== 'Ret2').concat([P('Resto2', 'SHAMAN', 'Restoration')]);
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto2'));
    assert.strictEqual(g.players.filter(p => p.class === 'SHAMAN').length, 1);
});

test('proposeGroups: a lone shaman among hunters notes Grace of Air, not Windfury', () => {
    const roster = [
        P('Resto', 'SHAMAN', 'Restoration'),
        P('Hunt1', 'HUNTER', 'Beast Mastery'), P('Hunt2', 'HUNTER', 'Beast Mastery'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto'));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), 'missing GoA note: ' + g.notes.join(' | '));
    assert.ok(!g.notes.some(t => /Windfury/.test(t)));
});
test('proposeGroups: regression — the 2026-08-13 SSC roster', () => {
    const R = [
        P('Sylvanor', 'PALADIN', 'Protection'), P('Smellmystaff', 'DRUID', 'Guardian'),
        P('Haku', 'SHAMAN', 'Enhancement'), P('Culuneta', 'WARRIOR', 'Fury'),
        P('Davina', 'WARRIOR', 'Arms'), P('RedNeko', 'WARRIOR', 'Fury'),
        P('utopik', 'ROGUE', 'Combat'), P('xavamros', 'ROGUE', 'Combat'),
        P('Warzilla', 'DRUID', 'Feral'),
        P('Connylloyd', 'HUNTER', 'Beast Mastery'), P('Funkell', 'HUNTER', 'Beast Mastery'),
        P('produdu', 'HUNTER', 'Survival'),
        P('Slyvester', 'SHAMAN', 'Elemental'), P('Craqu', 'MAGE', 'Arcane'),
        P('JohnNoozeMusume', 'MAGE', 'Arcane'), P('Cartis', 'WARLOCK', 'Destruction'),
        P('Lovestoned', 'WARLOCK', 'Destruction'),
        P('Gouken', 'SHAMAN', 'Restoration'), P('woptenwodei', 'SHAMAN', 'Restoration'),
        P('Frawa', 'DRUID', 'Restoration'), P('sspope', 'PRIEST', 'Holy'),
    ];
    const res = E.proposeGroups(R);
    // The spec (docs/superpowers/specs/2026-08-13-group-optimizer-ai-review-design.md, sec 2)
    // and this plan's task 4 intend the 2-man tank island to dissolve, not persist — so pinning
    // both tanks to 'tanks' would pin the bug, not the fix. Observed layout: the Guardian joins
    // the hunters' group and no 2-man island of just the two tanks remains.
    const guardianGroup = res.groups.find(g => g.players.some(p => p.name === 'Smellmystaff'));
    assert.ok(guardianGroup.players.some(p => p.class === 'HUNTER'),
        'Guardian should share a group with hunters, got: ' + guardianGroup.players.map(p => p.name).join(','));
    assert.ok(!(guardianGroup.players.length === 2 && guardianGroup.players.some(p => p.name === 'Sylvanor')),
        'the 2-man tank island should have dissolved, got: ' + guardianGroup.players.map(p => p.name).join(','));
    assert.notStrictEqual(groupOf(res, 'Gouken'), groupOf(res, 'woptenwodei'));
    assert.strictEqual(res.groups.filter(g => g.players.some(p => p.class === 'SHAMAN')).length, 4);
    const spare = res.groups.find(g => g.players.some(p => p.name === 'woptenwodei'));
    assert.ok(spare.notes.some(t => /Grace of Air/.test(t)));    // she's with the hunters for GoA
    assert.strictEqual(res.unplaced.length, 0);
});

test('proposeGroups: an Elemental shaman with hunters keeps Wrath of Air, not Grace of Air', () => {
    const roster = [
        P('Ele', 'SHAMAN', 'Elemental'),
        P('Hunt1', 'HUNTER', 'Beast Mastery'), P('Hunt2', 'HUNTER', 'Beast Mastery'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Ele'));
    assert.ok(g.notes.some(t => /Wrath of Air/.test(t)), 'missing Wrath of Air note: ' + g.notes.join(' | '));
    assert.ok(!g.notes.some(t => /Grace of Air/.test(t)), 'wrongly also claims Grace of Air: ' + g.notes.join(' | '));
    const airNotes = g.notes.filter(t => /Wrath of Air|Grace of Air|Windfury Totem/.test(t));
    assert.strictEqual(airNotes.length, 1, 'more than one air totem claimed: ' + airNotes.join(' | '));
});
test('proposeGroups: an Elemental shaman with melee and no hunters keeps Wrath of Air, not baseline Windfury', () => {
    const roster = [
        P('Ele', 'SHAMAN', 'Elemental'),
        P('Rog1', 'ROGUE', 'Combat'), P('Rog2', 'ROGUE', 'Combat'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Ele'));
    assert.ok(g.notes.some(t => /Wrath of Air/.test(t)), 'missing Wrath of Air note: ' + g.notes.join(' | '));
    assert.ok(!g.notes.some(t => /Windfury Totem \(baseline\)/.test(t)), 'wrongly also claims baseline Windfury: ' + g.notes.join(' | '));
    const airNotes = g.notes.filter(t => /Wrath of Air|Grace of Air|Windfury Totem/.test(t));
    assert.strictEqual(airNotes.length, 1, 'more than one air totem claimed: ' + airNotes.join(' | '));
});

// --- Optimizer Task 1: party-buff value model ---
// v2 (spec §9.4): these five pinned ORDINAL sums. The score is now a compounded fraction
// (Π(1+v) − 1), so each expectation is rebuilt from BUFF_V — the claim under test is still
// exactly WHICH buffs reach the player, which is what these tests were written to pin, and
// building it from the table keeps them valid once calibration replaces the numbers.
const uplift = (specK, names) => names.reduce((f, n) => f * (1 + (E.BUFF_V[n][specK] || 0)), 1) - 1;
test('playerBuffScore: rogue with an enhancement shaman gets Windfury, Strength of Earth, Unleashed Rage', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Rog', 'ROGUE', 'Combat')];
    // v2 (spec §9.4): Grace of Air joins the list — the enh shaman TWISTS, so this group
    // runs both air totems rather than the argmax's single pick.
    assert.ok(Math.abs(E.playerBuffScore(g[1], g)
        - uplift('ROGUE:Combat', ['Windfury Totem', 'Grace of Air', 'Strength of Earth', 'Unleashed Rage'])) < 1e-9,
        'got ' + E.playerBuffScore(g[1], g));
});
test('playerBuffScore: enhancement shaman gains nothing from its own Windfury Totem', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Rog', 'ROGUE', 'Combat')];
    // Windfury is still worth exactly nothing to the shaman itself (imbues beat the totem)
    // and Unleashed Rage is its own. v2 (spec §9.4): it does take Grace of Air off its own
    // twist, which the single-air argmax used to spend on Windfury for the rogue.
    assert.ok(Math.abs(E.playerBuffScore(g[0], g)
        - uplift('SHAMAN:Enhancement', ['Grace of Air', 'Strength of Earth'])) < 1e-9,
        'got ' + E.playerBuffScore(g[0], g));
    assert.strictEqual(E.BUFF_V['Windfury Totem']['SHAMAN:Enhancement'], undefined);
});
test('playerBuffScore: hunter with a resto shaman scores Grace of Air, not Windfury', () => {
    const g = [P('Resto', 'SHAMAN', 'Restoration'), P('Hunt', 'HUNTER', 'Beast Mastery')];
    assert.ok(Math.abs(E.playerBuffScore(g[1], g)
        - uplift('HUNTER:Beast Mastery', ['Grace of Air', 'Mana Tide Totem', 'Ferocious Inspiration'])) < 1e-9,
        'got ' + E.playerBuffScore(g[1], g));
});
test('playerBuffScore: caster with a resto shaman scores Wrath of Air', () => {
    const g = [P('Resto', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    assert.ok(Math.abs(E.playerBuffScore(g[1], g)
        - uplift('MAGE:Arcane', ['Wrath of Air', 'Mana Tide Totem'])) < 1e-9,
        'got ' + E.playerBuffScore(g[1], g));
});
test('playerBuffScore: a second same-spec shaman adds nothing', () => {
    const one = [P('Resto', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    const two = [P('Resto', 'SHAMAN', 'Restoration'), P('Resto2', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    assert.strictEqual(E.playerBuffScore(two[2], two), E.playerBuffScore(one[1], one));
});
test('playerBuffScore: an Elemental shaman pins air to Wrath of Air even with melee', () => {
    const g = [P('Ele', 'SHAMAN', 'Elemental'), P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat')];
    // SoE only — no Windfury, ToW is caster-only. (v2 §9.4: ordinal 3 → compounded fraction.)
    assert.ok(Math.abs(E.playerBuffScore(g[1], g) - uplift('ROGUE:Combat', ['Strength of Earth'])) < 1e-9,
        'got ' + E.playerBuffScore(g[1], g));
});

// --- Optimizer Task 2: scoreLayout ---
test('scoreLayout: fury warrior and rogue share Battle Shout, in DPS units', () => {
    // v2 (spec §9.4): the layout score is raid DPS, so this is each baseline lifted by the
    // one buff the pair provides. The cohesion half of the old expectation is gone (§1).
    const g = [{ players: [P('War', 'WARRIOR', 'Fury'), P('Rog', 'ROGUE', 'Combat')] }];
    const want = E.BASELINE['WARRIOR:Fury'] * (1 + E.BUFF_V['Battle Shout']['WARRIOR:Fury'])
        + E.BASELINE['ROGUE:Combat'] * (1 + E.BUFF_V['Battle Shout']['ROGUE:Combat']);
    assert.ok(Math.abs(E.scoreLayout(g) - want) < 1e-9, 'got ' + E.scoreLayout(g) + ' want ' + want);
});
test('scoreLayout: bucket cohesion no longer moves the score', () => {
    // v2 (spec §9.4 / §1): the 0.25 cohesion term was an ordinal-units artifact and is
    // deleted. When no buffs differ, splitting a bucket must now score EXACTLY the same —
    // readability comes from the seed and the relabel pass, not from the objective.
    const together = [{ players: [P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')] }, { players: [P('Rog', 'ROGUE', 'Combat')] }];
    const split = [{ players: [P('M1', 'MAGE', 'Arcane'), P('Rog', 'ROGUE', 'Combat')] }, { players: [P('M2', 'MAGE', 'Arcane')] }];
    assert.strictEqual(E.scoreLayout(together), E.scoreLayout(split));
});

// --- Optimizer Task 3: note rules ---
test('NOTE_RULES: Trueshot Aura printed for an MM hunter with melee', () => {
    const res = E.proposeGroups([P('Legolas', 'HUNTER', 'Marksmanship'), P('Rog', 'ROGUE', 'Combat')]);
    assert.ok(res.groups[0].notes.some(t => /Trueshot/.test(t)), res.groups[0].notes.join(' | '));
});
test('NOTE_RULES: no Trueshot note for a lone MM among casters', () => {
    const res = E.proposeGroups([P('Legolas', 'HUNTER', 'Marksmanship'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')]);
    res.groups.forEach(g => assert.ok(!g.notes.some(t => /Trueshot/.test(t)), g.notes.join(' | ')));
});
// v2 (spec §9.2): Blood Pact is dead in practice — it needs the imp out and nobody raids
// with the imp, which the old note text ("needs the imp out") was already admitting. Max
// ruled it dropped, so this flips from pinning the note to pinning its ABSENCE.
test('NOTE_RULES: Blood Pact is not modeled — no note for warlock groups', () => {
    const res = E.proposeGroups([P('L', 'WARLOCK', 'Destruction'), P('M', 'MAGE', 'Arcane')]);
    assert.ok(!res.groups[0].notes.some(t => /Blood Pact/.test(t)), res.groups[0].notes.join(' | '));
});
test('NOTE_RULES: air delegation — resto shaman with a cat and a bear claims Grace of Air', () => {
    const res = E.proposeGroups([P('Resto', 'SHAMAN', 'Restoration'), P('Cat', 'DRUID', 'Feral'), P('Bear', 'DRUID', 'Guardian')]);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto'));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), 'missing Grace of Air: ' + g.notes.join(' | '));
    const airNotes = g.notes.filter(t => /Wrath of Air|Grace of Air|Windfury Totem/.test(t));
    assert.strictEqual(airNotes.length, 1, 'air notes: ' + airNotes.join(' | '));
});

// --- Optimizer Task 4: hill-climb ---
const LIVE22 = [
    P('Haku', 'SHAMAN', 'Enhancement'), P('Slyvester', 'SHAMAN', 'Elemental'),
    P('Gouken', 'SHAMAN', 'Restoration'), P('Wopten', 'SHAMAN', 'Restoration'),
    P('Culuneta', 'WARRIOR', 'Fury'), P('RedNeko', 'WARRIOR', 'Fury'), P('Davina', 'WARRIOR', 'Arms'),
    P('Warzilla', 'DRUID', 'Feral'), P('Smellmywand', 'DRUID', 'Guardian'),
    P('Sylvanor', 'PALADIN', 'Protection'),
    P('Xavamros', 'ROGUE', 'Combat'), P('Utopik', 'ROGUE', 'Combat'),
    P('Bejoux', 'MAGE', 'Arcane'), P('Craqu', 'MAGE', 'Arcane'), P('JohnNooze', 'MAGE', 'Arcane'),
    P('Cartis', 'WARLOCK', 'Destruction'), P('Lovestoned', 'WARLOCK', 'Destruction'),
    P('Conny', 'HUNTER', 'Beast Mastery'), P('Funkell', 'HUNTER', 'Beast Mastery'), P('Produdu', 'HUNTER', 'Survival'),
    P('Frawa', 'DRUID', 'Restoration'), P('Sspope', 'PRIEST', 'Holy'),
];
test('optimizer: a hunter dumped with casters moves to the Grace of Air group', () => {
    const roster = [
        P('Enh', 'SHAMAN', 'Enhancement'), P('Fury', 'WARRIOR', 'Fury'),
        P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat'), P('R3', 'ROGUE', 'Combat'),
        P('Ele', 'SHAMAN', 'Elemental'), P('Mage', 'MAGE', 'Arcane'), P('Lock', 'WARLOCK', 'Destruction'),
        P('Resto', 'SHAMAN', 'Restoration'), P('Holy', 'PRIEST', 'Holy'),
        P('MM', 'HUNTER', 'Marksmanship'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'MM'));
    assert.ok(g.players.some(p => p.name === 'Resto'), 'MM should sit with the resto shaman, got: ' + g.players.map(p => p.name).join(','));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), g.notes.join(' | '));
});
test('optimizer: 22-man fixture puts the Guardian with the hunters', () => {
    const res = E.proposeGroups(LIVE22);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Smellmywand'));
    assert.ok(g.players.filter(p => p.class === 'HUNTER').length >= 2,
        'Guardian group: ' + g.players.map(p => p.name).join(','));
});
test('optimizer: layouts are deterministic across runs', () => {
    const a = E.proposeGroups(LIVE22).groups.map(g => g.players.map(p => p.name));
    const b = E.proposeGroups(LIVE22).groups.map(g => g.players.map(p => p.name));
    assert.deepStrictEqual(a, b);
});
test('optimizer: everyone placed exactly once, no group over cap', () => {
    const res = E.proposeGroups(LIVE22);
    const names = res.groups.reduce((acc, g) => acc.concat(g.players.map(p => p.name)), []);
    assert.strictEqual(names.length, 22);
    assert.strictEqual(new Set(names).size, 22);
    res.groups.forEach(g => assert.ok(g.players.length <= 5));
    assert.strictEqual(res.unplaced.length, 0);
});
test('optimizer: the two resto shamans stay in different groups', () => {
    const res = E.proposeGroups(LIVE22);
    const g1 = res.groups.find(g => g.players.some(p => p.name === 'Gouken'));
    assert.ok(!g1.players.some(p => p.name === 'Wopten'));
});
test('optimizer: both destro locks sit with caster totems', () => {
    const res = E.proposeGroups(LIVE22);
    ['Cartis', 'Lovestoned'].forEach(name => {
        const g = res.groups.find(g => g.players.some(p => p.name === name));
        assert.ok(g.notes.some(t => /Wrath of Air|Totem of Wrath/.test(t)),
            name + ' notes: ' + g.notes.join(' | '));
    });
});
test('optimizer: the enhancement shaman keeps a windfury group', () => {
    const res = E.proposeGroups(LIVE22);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Haku'));
    const wf = g.players.filter(p => p.class === 'WARRIOR' && p.spec !== 'Protection' || p.class === 'ROGUE');
    assert.ok(wf.length >= 3, 'windfury users with Haku: ' + wf.length);
});
test('optimizer: an already-clean seed comes back unchanged', () => {
    const roster = [
        P('Enh', 'SHAMAN', 'Enhancement'), P('F1', 'WARRIOR', 'Fury'), P('F2', 'WARRIOR', 'Fury'),
        P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat'),
        P('Ele', 'SHAMAN', 'Elemental'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane'),
        P('Lock', 'WARLOCK', 'Destruction'), P('Holy', 'PRIEST', 'Holy'),
    ];
    const res = E.proposeGroups(roster);
    const melee = res.groups.find(g => g.players.some(p => p.name === 'Enh'));
    assert.deepStrictEqual(melee.players.map(p => p.name).sort(), ['Enh', 'F1', 'F2', 'R1', 'R2']);
    const casters = res.groups.find(g => g.players.some(p => p.name === 'Ele'));
    assert.deepStrictEqual(casters.players.map(p => p.name).sort(), ['Ele', 'Holy', 'Lock', 'M1', 'M2']);
});

// --- Group optimizer v2 ---
test('v2: BASELINE covers every spec plus Guardian, healers at zero', () => {
    Object.keys(E.SPEC_TREES).forEach(cls => E.SPEC_TREES[cls].forEach(spec => {
        assert.ok((cls + ':' + spec) in E.BASELINE, 'missing baseline for ' + cls + ':' + spec);
    }));
    assert.ok('DRUID:Guardian' in E.BASELINE);
    ['PRIEST:Holy', 'PRIEST:Discipline', 'PALADIN:Holy', 'SHAMAN:Restoration', 'DRUID:Restoration']
        .forEach(k => assert.strictEqual(E.BASELINE[k], 0, k + ' must be 0'));
    assert.ok(E.BASELINE['WARRIOR:Fury'] > 0);
    assert.strictEqual(E.specKey({ class: 'WARRIOR', spec: 'Fury' }), 'WARRIOR:Fury');
    assert.ok(E.BUFF_V['Windfury Totem']['WARRIOR:Fury'] > 0);
    assert.ok(!('HUNTER:Beast Mastery' in E.BUFF_V['Windfury Totem']), 'WF must not apply to hunters');
});

test('v2: playerScore = baseline × compounded buff uplift', () => {
    const g = [P('Fu', 'WARRIOR', 'Fury'), P('Ro', 'ROGUE', 'Combat')];
    const bs = E.BUFF_V['Battle Shout']['ROGUE:Combat'];
    assert.ok(bs > 0);
    assert.ok(Math.abs(E.playerScore(g[1], g) - E.BASELINE['ROGUE:Combat'] * (1 + bs)) < 1e-6,
        'got ' + E.playerScore(g[1], g));
});
test('v2: healers score zero in the objective', () => {
    const g = [P('H', 'PRIEST', 'Holy'), P('Fu', 'WARRIOR', 'Fury')];
    assert.strictEqual(E.playerScore(g[0], g), 0);
});
test('v2: manual multiplier scales a player\'s score', () => {
    const p = P('Fu', 'WARRIOR', 'Fury');
    const s1 = E.playerScore(p, [p]);
    p.mult = 1.5;
    assert.ok(Math.abs(E.playerScore(p, [p]) - 1.5 * s1) < 1e-6);
});
test('v2: scoreLayout has no cohesion term', () => {
    const groups = [{ role: 'casters', players: [P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')] }];
    // Two mages provide nothing to each other: score must be exactly the sum of baselines.
    assert.strictEqual(E.scoreLayout(groups), 2 * E.BASELINE['MAGE:Arcane']);
});

test('v2: Ferocious Inspiration compounds per BM hunter', () => {
    const one = [P('B1', 'HUNTER', 'Beast Mastery'), P('M', 'MAGE', 'Arcane')];
    const two = [P('B1', 'HUNTER', 'Beast Mastery'), P('B2', 'HUNTER', 'Beast Mastery'), P('M', 'MAGE', 'Arcane')];
    const fi = E.BUFF_V['Ferocious Inspiration']['MAGE:Arcane'];
    const base = E.BASELINE['MAGE:Arcane'];
    assert.ok(Math.abs(E.playerScore(two[2], two) - base * Math.pow(1 + fi, 2)) < 1e-6);
    assert.ok(Math.abs(E.playerScore(one[1], one) - base * (1 + fi)) < 1e-6);
});
test('v2: Unleashed Rage reaches hunters', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('B', 'HUNTER', 'Beast Mastery')];
    assert.ok(E.groupBuffs(g).some(a => a.buff.name === 'Unleashed Rage'));
    assert.ok(E.BUFF_V['Unleashed Rage']['HUNTER:Beast Mastery'] > 0);
});
test('v2: Mana Spring Totem is modeled and noted', () => {
    assert.ok(E.PARTY_BUFFS.some(b => b.name === 'Mana Spring Totem'));
    const res = E.proposeGroups([P('Sh', 'SHAMAN', 'Restoration'), P('H', 'PRIEST', 'Holy')]);
    assert.ok(res.groups[0].notes.some(t => /Mana Spring/.test(t)), res.groups[0].notes.join(' | '));
});
test('v2: Blood Pact is gone from the model', () => {
    assert.ok(!E.PARTY_BUFFS.some(b => b.name === 'Blood Pact'));
});

test('v2: twisting — enh shaman group runs Windfury AND Grace of Air', () => {
    const res = E.proposeGroups([P('Enh', 'SHAMAN', 'Enhancement'), P('Fu', 'WARRIOR', 'Fury')]);
    const notes = res.groups[0].notes.join(' | ');
    assert.ok(/Windfury Totem/.test(notes), notes);
    assert.ok(/Grace of Air/.test(notes), notes);
    assert.ok(!/Wrath of Air/.test(notes), notes);
});
test('v2: twisting raises the score of an enh melee group', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Fu', 'WARRIOR', 'Fury')];
    const names = E.groupBuffs(g).map(a => a.buff.name);
    assert.ok(names.indexOf('Windfury Totem') !== -1 && names.indexOf('Grace of Air') !== -1, names.join(','));
});

test('v2: paladin group notes a named aura, generic note gone', () => {
    const res = E.proposeGroups([P('Pal', 'PALADIN', 'Protection'), P('M', 'MAGE', 'Arcane')]);
    const notes = res.groups[0].notes.join(' | ');
    assert.ok(!/A paladin aura/.test(notes), notes);
    assert.ok(/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes), notes);
});
test('v2: Sanctity Aura needs a Retribution paladin and wins for holy-damage specs', () => {
    const two = E.proposeGroups([P('Ret', 'PALADIN', 'Retribution'), P('Pro', 'PALADIN', 'Protection')]);
    assert.ok(/Sanctity Aura/.test(two.groups[0].notes.join(' | ')), two.groups[0].notes.join(' | '));
    const noRet = E.proposeGroups([P('Pro', 'PALADIN', 'Protection'), P('M', 'MAGE', 'Arcane')]);
    assert.ok(!/Sanctity Aura/.test(noRet.groups[0].notes.join(' | ')));
});
test('v2: two paladins activate two auras', () => {
    const g = [P('Ret', 'PALADIN', 'Retribution'), P('Pro', 'PALADIN', 'Protection')];
    assert.strictEqual(E.groupBuffs(g).filter(a => a.buff.element === 'aura').length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
