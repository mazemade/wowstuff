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

// --- Task 3: ability, cast, aura and stat facts
const K19 = FX.kills['50619'], K20 = FX.kills['50620'];
test('abilityStats: Shadow Bolt on Anetheron, sorted by damage', () => {
    const ab = F.abilityStats(K19.tables.dmg);
    assert.strictEqual(ab[0].name, 'Shadow Bolt');
    assert.strictEqual(ab[0].hits, 42);
    assert.strictEqual(ab[0].critPercent, 26.2);
    assert.strictEqual(ab[0].avgHit, 3087);
    assert.strictEqual(ab[0].avgCrit, 6500);
    assert.strictEqual(ab[0].share, 93.3);
    assert.strictEqual(ab[0].resistPercent, 11.9);
    assert.deepStrictEqual(F.abilityStats(null), []);
});
test('castCounts and castsPerMinute', () => {
    const casts = F.castCounts(K19.tables.casts);
    assert.strictEqual(casts['Shadow Bolt'], 43);
    assert.strictEqual(casts.Immolate, 5);
    assert.strictEqual(F.castsPerMinute(casts, 130.855), 25.2);
    assert.strictEqual(F.castsPerMinute(casts, null), null);
    assert.deepStrictEqual(F.castCounts(undefined), {});
});
test('buffUptime: Bloodlust 31% on Anetheron, 0 when absent, null without a table', () => {
    assert.strictEqual(F.buffUptime(K19.tables.buffs, 'Bloodlust'), 31);
    assert.strictEqual(F.buffUptime(K19.tables.buffs, 'Not A Buff'), 0);
    assert.strictEqual(F.buffUptime(null, 'Bloodlust'), null);
});
test('classifyAuras: elixirs, food, flask forms, everything else is a buff', () => {
    const c = F.classifyAuras(K19.tables.ci.data[0].auras.map(a => a.name));
    assert.strictEqual(c.flask, null);
    assert.strictEqual(c.battleElixir, 'Major Shadow Power');
    assert.strictEqual(c.guardianElixir, 'Elixir of Draenic Wisdom');
    assert.strictEqual(c.food, 'Well Fed');
    assert.deepStrictEqual(c.consumables, ['Elixir of Draenic Wisdom', 'Major Shadow Power', 'Well Fed']);
    assert.ok(c.buffs.includes('Arcane Brilliance') && c.buffs.includes('Greater Blessing of Kings'));
    assert.strictEqual(F.classifyAuras(['Pure Death of Shattrath']).flask, 'Pure Death of Shattrath');
    assert.strictEqual(F.classifyAuras(['Flask of Pure Death']).flask, 'Flask of Pure Death');
    assert.strictEqual(F.classifyAuras(["Adept's Elixir"]).battleElixir, "Adept's Elixir");
    assert.strictEqual(F.isUtilityGuardian('Elixir of Draenic Wisdom'), true);
    assert.strictEqual(F.isUtilityGuardian('Elixir of Major Fortitude'), false);
});
test('canonBuffs: party buffs for the role, aliases folded, order of the table', () => {
    const cosmos = FX.reference['50619'].players[1].tables.ci.data[0].auras.map(a => a.name);
    const b = F.canonBuffs(cosmos, 'caster');
    assert.ok(b.includes('Moonkin Aura') && b.includes('Prayer of Spirit') && b.includes('Arcane Brilliance'));
    assert.ok(!b.includes('Greater Blessing of Salvation'));
    assert.deepStrictEqual(F.canonBuffs(['Divine Spirit', 'Battle Shout'], 'melee'), ['Battle Shout']);
    assert.deepStrictEqual(F.canonBuffs(['Divine Spirit'], 'caster'), ['Prayer of Spirit']);
});
test('playerStats: from the CombatantInfo gear with reported ratings, or from the fight-wide row', () => {
    const s = F.playerStats(K19.tables.ci.data[0], null, db, 'WARLOCK');
    assert.strictEqual(s.spellDamage, 986);
    assert.strictEqual(s.spellCrit, 222);
    assert.strictEqual(s.spellHit, 207);
    assert.strictEqual(s.gearScore, 1854);
    assert.strictEqual(s.avgItemLevel, 123.82);
    const refRow = FX.reference['50619'].players[0].context.dmgAll.data.entries[0];
    const s2 = F.playerStats(null, refRow, db, 'WARLOCK');
    assert.strictEqual(s2.spellDamage, 1001);   // gear-only stats from the fight-wide row
    const bare = K20.context.dmgAll.data.entries.find(e => e.name === 'Rotminster');
    assert.strictEqual(F.playerStats(null, bare, db, 'WARLOCK'), null);   // WCL logged no gear on that kill
    assert.strictEqual(F.playerStats(null, null, db, 'WARLOCK'), null);
});

// --- Task 4: reference
function refFor(enc) {
    const R = FX.reference[String(enc)];
    const ranks = F.bandRanks(R.pages.flatMap(p => p.rankings), 124, F.REF.band).slice(0, F.REF.target);
    return F.referenceSummary(ranks, R.players, db, 'WARLOCK', 'caster', [122, 126]);
}
test('bandRanks: item level within the band, page order kept, empty when nobody fits', () => {
    const all = FX.reference['50619'].pages.flatMap(p => p.rankings);
    const page1 = F.bandRanks(FX.reference['50619'].pages[0].rankings, 124, 2);
    assert.strictEqual(page1.length, 29);
    assert.strictEqual(F.bandRanks(all, 124, 2).length, 74);
    assert.ok(F.bandRanks(all, 124, 2).every(r => Math.abs(r.bracketData - 124) <= 2));
    assert.deepStrictEqual(F.bandRanks(all, 200, 2), []);
    assert.strictEqual(F.bandRanks(all, 124, 2)[0].name, FX.reference['50619'].players[0].rank.name);
});
test('referenceSummary on Anetheron: medians over 8 ranks and 3 players', () => {
    const ref = refFor(50619);
    assert.strictEqual(ref.sampleSize, 8);
    assert.strictEqual(ref.playersCompared, 3);
    assert.strictEqual(ref.dps, 2684);
    assert.strictEqual(ref.durationSec, 94.7);
    assert.strictEqual(ref.activePercent, 89.5);
    assert.strictEqual(ref.castsPerMinute, 30.5);
    assert.strictEqual(ref.casts['Shadow Bolt'], 36);
    assert.strictEqual(ref.casts['Life Tap'], 2);
    assert.strictEqual(ref.casts.Shadowburn, undefined, 'only one of three cast it, so it is not a reference ability');
    assert.strictEqual(ref.abilities[0].name, 'Shadow Bolt');
    assert.strictEqual(ref.abilities[0].critPercent, 58.8);
    assert.strictEqual(ref.abilities[0].avgHit, 4215);
    assert.strictEqual(ref.stats.spellDamage, 1001);
    assert.strictEqual(ref.stats.spellCrit, 345);
    assert.ok(ref.buffsAtPull.includes('Moonkin Aura') && ref.buffsAtPull.includes('Prayer of Spirit'));
    assert.strictEqual(ref.flaskShare, 1);      // all 3 flasked; Zûl's is the Shattrath form
    assert.strictEqual(ref.flask, 'Flask of Pure Death');
    assert.ok(ref.topDps >= ref.dps);
    assert.deepStrictEqual(ref.itemLevelBand, [122, 126]);
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
