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
const PLAYER = { name: 'Rotminster', classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', schools: ['shadow'], metric: 'dps' };
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

// --- task-rep-kill: pick a representative kill per boss, not the most recent one
function rk(overrides) {
    return Object.assign({ rankPercent: 50, duration: 100000, startTime: 1000, report: { code: 'X', fightID: 1 } }, overrides || {});
}
test('pickRank: a boss with one rank chooses that rank regardless of duration or median (today\'s behaviour, unchanged)', () => {
    const only = rk({ rankPercent: 12, duration: 999999, startTime: 1 });
    assert.strictEqual(F.pickRank([only], 90), only);
    assert.strictEqual(F.pickRank([only], null), only);
});
test('pickRank: among several ranks, the one nearest the median is chosen, not the most recent', () => {
    const near = rk({ rankPercent: 30, startTime: 1000 });
    const far = rk({ rankPercent: 90, startTime: 5000 }); // most recent, but far from the median
    assert.strictEqual(F.pickRank([far, near], 32), near);
});
test('pickRank: a long-duration outlier is skipped in favour of a shorter, representative pull', () => {
    const shortest = rk({ rankPercent: 40, duration: 100000, startTime: 1000 });
    // Exactly on the median and more recent than `shortest`, so rule 3/4 alone would pick this one.
    // Its duration is more than T.longFightRatio x the shortest duration on this boss, so rule 2
    // demotes it and `shortest` (the only non-outlier candidate) must win instead.
    const outlier = rk({ rankPercent: 41, duration: 100000 * F.T.longFightRatio + 1, startTime: 9000 });
    assert.strictEqual(F.pickRank([shortest, outlier], 41), shortest);
});
test('pickRank: a boss where every rank is a long pull still returns a rank, never null (degrades to "take it")', () => {
    // The demotion rule compares each rank's duration to the SHORTEST duration on the same boss, so
    // the shortest rank can never be excluded by its own rule (ratio to itself is 1). Genuinely
    // reducing the candidate set to zero is therefore unreachable by construction; this proves the
    // uniform-long-pull edge case (every rank equally long, none relatively an outlier) is still
    // handled: a rank comes back, not null, and normal median/recency rules decide which one.
    const a = rk({ rankPercent: 10, duration: 1131000, startTime: 1000 });
    const b = rk({ rankPercent: 90, duration: 1131000, startTime: 2000 });
    const picked = F.pickRank([a, b], 10);
    assert.ok(picked === a || picked === b, 'a rank is always returned, never null/undefined');
    assert.strictEqual(picked, a, 'still picks by median-closeness among the (undemoted) candidates');
});
test('pickRank: ties on distance-to-median break toward the more recent kill', () => {
    const older = rk({ rankPercent: 20, startTime: 1000 });
    const newer = rk({ rankPercent: 40, startTime: 2000 });
    assert.strictEqual(F.pickRank([older, newer], 30), newer); // both 10 away from the median
});
test('pickRank: a null medianPercent falls back to the most recent rank', () => {
    const older = rk({ rankPercent: 80, startTime: 1000 });
    const newer = rk({ rankPercent: 10, startTime: 5000 });
    assert.strictEqual(F.pickRank([older, newer], null), newer);
});
test('pickRank: when no rank carries a rankPercent, falls back to the most recent rank', () => {
    const older = rk({ rankPercent: null, startTime: 1000 });
    const newer = rk({ rankPercent: null, startTime: 5000 });
    assert.strictEqual(F.pickRank([older, newer], 40), newer);
});

test('pickRanks (v2 §4): the representative rank plus the most recent one, deduplicated, at most KILLS_PER_BOSS', () => {
    const oldest = { rankPercent: 5, duration: 100000, startTime: 100, report: { code: 'A', fightID: 1 } };
    const rep = { rankPercent: 30, duration: 100000, startTime: 200, report: { code: 'B', fightID: 1 } };
    const newest = { rankPercent: 90, duration: 100000, startTime: 300, report: { code: 'C', fightID: 1 } };
    assert.strictEqual(F.KILLS_PER_BOSS, 2);
    assert.deepStrictEqual(F.pickRanks([oldest, rep, newest], 31).map(r => r.report.code), ['B', 'C'], 'representative first, then the most recent');
    assert.deepStrictEqual(F.pickRanks([oldest, rep], 31).map(r => r.report.code), ['B'], 'the most recent rank here is the representative itself, so one pull');
    assert.deepStrictEqual(F.pickRanks([oldest, newest], 89).map(r => r.report.code), ['C']);
    assert.deepStrictEqual(F.pickRanks([rep], 31).map(r => r.report.code), ['B']);
    assert.deepStrictEqual(F.pickRanks([], 31), []);
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
    const fc = F.fightContext(FX.kills['50619'].context, 'Rotminster', 'caster', 94.7, 'dps');
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
    assert.strictEqual(fc.me.amount, 1300.7);
    assert.strictEqual(fc.me.metric, 'dps');
    assert.strictEqual(fc.me.died, null);
    assert.strictEqual(fc.me.potionUse, 1);
    assert.strictEqual(fc.me.healthstoneUse, 0);
    assert.ok(fc.meRow && Array.isArray(fc.meRow.gear));
});
test('fightContext on Kaz\'rogal: an 1131 s pull where all 19 DPS parsed under 5 is a bad pull', () => {
    const fc = F.fightContext(FX.kills['50620'].context, 'Rotminster', 'caster', 93);
    assert.strictEqual(fc.fight.durationSec, 1130.6);
    assert.strictEqual(fc.fight.badPull, true);
    assert.ok(/1131s against the fastest reference kills at 93s/.test(fc.fight.badPullReason), fc.fight.badPullReason);
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
test('fightContext (v3): with no role groups in the rankings the raid median active share falls back to every non-pet player row', () => {
    const K = FX.kills['50619'];
    const ctx = JSON.parse(JSON.stringify(K.context));
    ctx.rankings = null;
    const fc = F.fightContext(ctx, 'Rotminster', 'caster', null, 'dps');
    assert.strictEqual(typeof fc.fight.raidActivePercent, 'number');
    assert.strictEqual(fc.fight.raidGroupRank, null, 'no rankings, no rank');
    const withRanks = F.fightContext(K.context, 'Rotminster', 'caster', null, 'dps');
    assert.strictEqual(typeof withRanks.fight.raidActivePercent, 'number');
});
test('fightContext: healers are ranked among healers, tanks among tanks', () => {
    const ctx = { fights: [{ startTime: 0, endTime: 100000 }], rankings: { data: [{ speed: { rankPercent: 50 }, execution: { rankPercent: 50 },
        roles: { dps: { characters: [{ name: 'D', amount: 1000, rankPercent: 50 }] }, healers: { characters: [{ name: 'H1', amount: 900, rankPercent: 60 }, { name: 'H2', amount: 700, rankPercent: 2 }] }, tanks: { characters: [] } } }] } };
    const fc = F.fightContext(ctx, 'h2', 'healer', null, 'hps');
    assert.strictEqual(fc.fight.raidGroup, 'healers');
    assert.strictEqual(fc.fight.raidGroupRank, 2);
    assert.strictEqual(fc.fight.raidGroupCount, 2);
    assert.strictEqual(fc.me.amount, 700);
    assert.strictEqual(fc.me.metric, 'hps');
});
test('fightContext: bad-pull rule 2 is always evaluated over the raid\'s DPS, even for a healer (Minor 10)', () => {
    // 4 of 5 healers parsed under 5 (80%+), but only 1 of 10 dps did. If rule 2 looked at the
    // healer's own group (the pre-fix behaviour) this would read as a bad pull; it should not.
    const dps = Array.from({ length: 10 }, (_, i) => ({ name: 'D' + i, amount: 1000, rankPercent: i === 0 ? 1 : 50 }));
    const healers = [0, 1, 2, 3, 4].map(i => ({ name: 'H' + i, amount: 900, rankPercent: i < 4 ? 1 : 50 }));
    const ctx = { fights: [{ startTime: 0, endTime: 100000 }], rankings: { data: [{ speed: { rankPercent: 50 }, execution: { rankPercent: 50 },
        roles: { dps: { characters: dps }, healers: { characters: healers }, tanks: { characters: [] } } }] },
        deaths: { data: { entries: [] } } };
    const fc = F.fightContext(ctx, 'H0', 'healer', null, 'hps');
    assert.strictEqual(fc.fight.badPull, false, fc.fight.badPullReason);
});
test('fightContext: a raid-wide near-wipe is a bad pull from deaths alone, with no duration baseline (Minor 10 gap-fill)', () => {
    const ctx = {
        fights: [{ startTime: 0, endTime: 300000 }],
        rankings: { data: [{ speed: { rankPercent: 50 }, execution: { rankPercent: 50 },
            roles: { dps: { characters: Array.from({ length: 10 }, (_, i) => ({ name: 'D' + i, amount: 1000, rankPercent: 50 })) },
                     healers: { characters: [{ name: 'Healy', amount: 900, rankPercent: 50 }] }, tanks: { characters: [] } } }] },
        deaths: { data: { entries: Array.from({ length: 8 }, (_, i) => ({ name: 'D' + i, timestamp: i * 1000, killingBlow: { name: 'Boss Ability' } })) } },
    };
    // A healer: no refDurationSec (rule 1 dead), and no dps parsed under 5 (rule 2 silent) — only
    // the deaths rule can catch this near-wipe.
    const fc = F.fightContext(ctx, 'Healy', 'healer', null, 'hps');
    assert.strictEqual(fc.fight.badPull, true);
    assert.ok(/8 of 11 in the raid died/.test(fc.fight.badPullReason), fc.fight.badPullReason);
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
test('lustPercent (v2 §6 fix): Heroism counts the same as Bloodlust, 0 when neither is present, null without a table', () => {
    const s = x => x * 1000;
    const heroismOnly = { data: { totalTime: s(100), auras: [{ name: 'Heroism', totalUptime: s(40) }] } };
    assert.strictEqual(F.lustPercent(heroismOnly), 40);
    const neither = { data: { totalTime: s(100), auras: [] } };
    assert.strictEqual(F.lustPercent(neither), 0);
    assert.strictEqual(F.lustPercent(null), null);
});
test('burstStats (v2 §6): on-use items and potions are short self-buffs that also appear as casts; procs and long buffs are not bursts', () => {
    const s = x => x * 1000;
    const buffs = { data: { totalTime: s(180), auras: [
        { name: 'Bloodlust', totalUptime: s(40), totalUses: 1, bands: [{ startTime: s(100), endTime: s(140) }] },
        { name: 'Destruction', totalUptime: s(15), totalUses: 1, bands: [{ startTime: s(110), endTime: s(125) }] },
        { name: 'Blessing of the Silver Crescent', totalUptime: s(40), totalUses: 2, bands: [{ startTime: s(10), endTime: s(30) }, { startTime: s(150), endTime: s(170) }] },
        { name: 'Fel Armor', totalUptime: s(180), totalUses: 1, bands: [{ startTime: 0, endTime: s(180) }] },
        { name: 'Spell Haste', totalUptime: s(6), totalUses: 1, bands: [{ startTime: s(112), endTime: s(118) }] },
        // Important 1 (whole-branch review): a class self-buff with a same-named cast (Drain Soul's
        // channel shows as both an aura and a cast; Bloodrage likewise) must never read as a burst,
        // no matter how short its bands are — live data caught 7 Drain Soul "uses" on Lady Vashj.
        { name: 'Drain Soul', totalUptime: s(14), totalUses: 7, bands: Array.from({ length: 7 }, (_, i) => ({ startTime: s(20 + i * 5), endTime: s(20 + i * 5 + 2) })) },
        { name: 'Bloodrage', totalUptime: s(10), totalUses: 1, bands: [{ startTime: s(60), endTime: s(70) }] },
    ] } };
    const casts = { data: { entries: [{ name: 'Destruction', total: 1 }, { name: 'Blessing of the Silver Crescent', total: 2 }, { name: 'Fel Armor', total: 1 }, { name: 'Shadow Bolt', total: 40 }, { name: 'Drain Soul', total: 7 }, { name: 'Bloodrage', total: 1 }] } };
    assert.deepStrictEqual(F.burstStats(buffs, casts), [
        { name: 'Destruction', uses: 1, insideBloodlust: 1 },
        { name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 0 },
    ], 'Drain Soul and Bloodrage have a matching cast and short bands too, but BURST_EXCLUDE keeps them out');
    assert.deepStrictEqual(F.burstStats(null, casts), []);
    assert.deepStrictEqual(F.burstStats({ data: { totalTime: 1, auras: [] } }, casts), []);
    assert.strictEqual(F.POTION_LABEL.Destruction, 'Destruction Potion');
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
    assert.strictEqual(ref.abilities[0].hits, 36, 'Important 3: median hits carried through as a per-ability fact');
    assert.strictEqual(ref.stats.spellDamage, 1001);
    assert.strictEqual(ref.stats.spellCrit, 345);
    assert.ok(ref.buffsAtPull.includes('Moonkin Aura') && ref.buffsAtPull.includes('Prayer of Spirit'));
    assert.strictEqual(ref.flaskShare, 1);      // all 3 flasked; Zûl's is the Shattrath form
    assert.strictEqual(ref.flask, 'Flask of Pure Death');
    assert.ok(ref.topDps >= ref.dps);
    assert.deepStrictEqual(ref.itemLevelBand, [122, 126]);
});
test('referenceSummary (v3 fix): no damaging casts on any reference player gives damagePerDamagingCast null, not 0', () => {
    const R = FX.reference['50619'];
    const ranks = F.bandRanks(R.pages.flatMap(p => p.rankings), 124, F.REF.band).slice(0, F.REF.target);
    const ref = F.referenceSummary(ranks, [], db, 'WARLOCK', 'caster', [122, 126]);
    assert.strictEqual(ref.damagePerDamagingCast, null, 'Math.round(median([])) used to silently give 0');
    assert.strictEqual(ref.damagingCastsPerMinute, null);
    assert.strictEqual(ref.critRate, null);
});
test('v3 measurements: me and reference carry damaging casts, damage per cast, crit rate, channel time, raid activity, consumables and debuffs', () => {
    const ref = refFor(50619);
    ['damagingCastsPerMinute', 'damagePerDamagingCast', 'critRate', 'channelSecPerMin', 'raidActivePercent'].forEach(k => assert.strictEqual(typeof ref[k], 'number', k));
    // Controller ruling (cross-task): playersDps is the median amount of the same fetched players
    // the other factors are measured on, distinct from `dps` (the wider rank list's median).
    assert.strictEqual(typeof ref.playersDps, 'number');
    assert.ok(ref.damagingCastsPerMinute < ref.castsPerMinute, 'Life Tap is not a damaging cast');
    assert.ok(Array.isArray(ref.consumablesAtPull) && ref.consumablesAtPull.includes('Flask of Pure Death'));
    // Important 1 fix round: none of the Anetheron reference players in this fixture carry a
    // context.debuffs table at all, so the honest answer is "unknown", not an empty (= "known, and
    // there are none") array — see the dedicated Important 1 test below for the populated case's
    // shape via a clone, and vet-gap.test.js for how explainGap treats this null.
    assert.strictEqual(ref.debuffs, null, 'no Anetheron reference player in this fixture carries a debuff table');
    assert.strictEqual(ref.fastestDurationSec, null, 'a direct referenceSummary call has no ceiling pages');
    assert.strictEqual(typeof ref.stats.intellect, 'number');
    const k = killFor(50619);
    assert.ok(k.me.damagingCastsPerMinute > 0 && k.me.damagingCastsPerMinute < k.me.castsPerMinute);
    assert.strictEqual(k.me.damagePerDamagingCast, Math.round(k.me.abilities.reduce((s, a) => s + a.total, 0) / k.me.abilities.reduce((s, a) => s + (a.total > 0 ? (k.me.casts[a.name] || 0) : 0), 0)));
    assert.ok(k.me.critRate > 20 && k.me.critRate < 35, 'Rotminster crits about a quarter of his damaging hits: ' + k.me.critRate);
    assert.strictEqual(k.me.channelSecPerMin, 0, 'the fixture has no bands');
    assert.strictEqual(typeof k.me.stats.intellect, 'number');
});
test('v3 measurements (Important 1): a reference with every player\'s debuff table deleted reports debuffs as null, not an empty array', () => {
    const FX2 = JSON.parse(JSON.stringify(FX));
    FX2.reference['50619'].players.forEach(p => { delete p.context.debuffs; });
    const R2 = FX2.reference['50619'];
    const ranks2 = F.bandRanks(R2.pages.flatMap(p => p.rankings), 124, F.REF.band).slice(0, F.REF.target);
    const ref2 = F.referenceSummary(ranks2, R2.players, db, 'WARLOCK', 'caster', [122, 126]);
    assert.strictEqual(ref2.debuffs, null);
});
test('v3 measurements: getReference records the fastest in-band kill from the ceiling pages', async () => {
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => { if (q === F.FIGHT_QUERY) return { reportData: { report: null } }; return lb.query(q, vars); };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.strictEqual(ref.summary.fastestDurationSec, 100, 'every synthetic rank lasts 100 s');
});
test('getReference (v3 fix): a ceiling rank missing duration does not poison fastestDurationSec into NaN', async () => {
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) return { reportData: { report: null } };
        const res = await lb.query(q, vars);
        const cr = res.worldData && res.worldData.encounter && res.worldData.encounter.characterRankings;
        if (cr && cr.page === 1 && Array.isArray(cr.rankings)) cr.rankings.forEach(r => { delete r.duration; });
        return res;
    };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.strictEqual(ref.summary.fastestDurationSec, null, 'every in-band rank on the ceiling page is missing duration');
    assert.strictEqual(Number.isNaN(ref.summary.fastestDurationSec), false);
});
test('getReference (v3 fix): fastestDurationSec still finds the fastest among the ceiling rows that do have a duration', async () => {
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) return { reportData: { report: null } };
        const res = await lb.query(q, vars);
        const cr = res.worldData && res.worldData.encounter && res.worldData.encounter.characterRankings;
        if (cr && cr.page === 1 && Array.isArray(cr.rankings)) cr.rankings.forEach((r, i) => { if (i % 2 === 0) delete r.duration; });
        return res;
    };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.strictEqual(ref.summary.fastestDurationSec, 100, 'the surviving half of the rows still last 100 s');
});
test('v3: killFacts carries kill.gap for a pull below its reference; buildFacts carries overall.gap', () => {
    const k = killFor(50619);
    assert.ok(k.gap && k.gap.ratio > 1, 'Rotminster is below the reference on Anetheron');
    const product = ['casts', 'dmg', 'crit', 'residual'].reduce((p, f) => p * k.gap.factors[f].value, 1);
    assert.ok(Math.abs(product - k.gap.ratio) < 1e-6);
    // Controller ruling round 2: with damage per cast normalised by each side's own crit multiplier
    // before the factors are split (so crit is no longer counted once in dmg and again in crit),
    // the fixture's residual moved from -43% to -10% — comfortably inside the medians-of-three
    // mismatch this accounting can't fully close (the reference's casts/damage/crit come from a
    // median of 3 fetched players while the ratio itself is measured against their own amounts,
    // not a single internally-consistent "typical" player).
    assert.ok(Math.abs(k.gap.factors.residual.share) <= 15, 'factors reproduce the ratio up to the medians-of-three mismatch: ' + k.gap.factors.residual.share);
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(facts.overall.gap, { casts: k.gap.factors.casts.share, dmg: k.gap.factors.dmg.share, crit: k.gap.factors.crit.share, residual: k.gap.factors.residual.share }, 'Kaz\'rogal is a bad pull: only Anetheron counts');
});

// --- Task 5: kill facts and player findings
function killFor(enc) {
    const K = FX.kills[String(enc)];
    return F.killFacts({ encounterId: enc, name: NAMES[enc], rank: FX.encounterRankings[String(enc)].ranks[0], context: K.context, tables: K.tables,
                         sourceId: K.sourceID, player: PLAYER, reference: refFor(enc), referenceNote: null, dbIndex: db });
}
const keysOf = fs => fs.map(f => f.key);
test('debuffFacts: shadow caster on Anetheron has Curse of the Elements, lacks Misery and Shadow Weaving', () => {
    const d = F.debuffFacts(K19.context.debuffs, ['shadow']);
    assert.strictEqual(d.known, true);
    assert.deepStrictEqual(d.missing.map(m => m.name), ['Misery', 'Shadow Weaving']);
    const coe = d.present.find(p => p.name === 'Curse of the Elements');
    assert.strictEqual(coe.uptimePercent, 91);
    assert.ok(!d.present.concat(d.missing).some(x => x.name === 'Fire Vulnerability'), 'fire debuffs do not concern a shadow caster');
    assert.strictEqual(F.debuffFacts(null, ['shadow']).known, false);
    assert.deepStrictEqual(F.debuffFacts(K19.context.debuffs, ['physical']).present.map(p => p.name).sort(), ['Curse of Recklessness', 'Faerie Fire', 'Sunder Armor'].concat(F.debuffFacts(K19.context.debuffs, ['physical']).present.some(p => p.name === 'Blood Frenzy') ? ['Blood Frenzy'] : []).sort());
});
test('debuffFacts: uptime is clamped at 100 (hostilityType:Enemies sums a debuff across every add) (Minor 13)', () => {
    const table = { data: { totalTime: 100000, auras: [{ name: 'Sunder Armor', totalUptime: 240000 }] } };
    const d = F.debuffFacts(table, ['physical']);
    const sunder = d.present.find(p => p.name === 'Sunder Armor');
    assert.strictEqual(sunder.uptimePercent, 100, 'a debuff kept up on several Hyjal wave adds must not read as 240%');
});
test('killFacts on Anetheron: identity, url, me, and the player-side findings', () => {
    const k = killFor(50619);
    assert.strictEqual(k.rankPercent, 31.9);
    assert.strictEqual(k.reportCode, 'BcZWRDk2PXaYghpC');
    assert.strictEqual(k.fightId, 57);
    assert.strictEqual(k.wclUrl, 'https://classic.warcraftlogs.com/reports/BcZWRDk2PXaYghpC#fight=57&source=12');
    assert.strictEqual(k.date, '2026-08-30');
    assert.strictEqual(k.fight.badPull, false);
    assert.strictEqual(k.me.consumablesKnown, true);
    assert.strictEqual(k.me.castsPerMinute, 25.2);
    assert.strictEqual(k.me.bloodlustPercent, 31);
    assert.strictEqual(k.me.stats.spellCrit, 222);
    assert.deepStrictEqual(k.me.partyBuffs, ['Arcane Brilliance', 'Greater Blessing of Kings', 'Greater Blessing of Wisdom']);
    const keys = keysOf(k.findings);
    assert.ok(keys.includes('ability_extra'), keys.join());
    assert.ok(!keys.includes('active_low') && !keys.includes('died') && !keys.includes('ability_unused'), keys.join());
    assert.ok(!keys.some(x => ['crit_low', 'hit_low', 'resist_high', 'stat_low', 'casts_low', 'active_low'].includes(x)), 'outcome findings are gone');
    const gapKeys = ['raid_activity', 'own_activity', 'channel_time', 'cast_pacing', 'hit_under_cap', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs', 'rotation', 'crit_gear', 'crit_buffs'];
    const gapF = k.findings.filter(f => gapKeys.includes(f.key));
    assert.ok(gapF.length >= 3, 'the accounting produces findings on Anetheron: ' + keys.join());
    assert.ok(gapF.every(f => ['player', 'group', 'raid'].includes(f.owner) && f.share >= 3 && /Worth \d+% of the gap/.test(f.text)), JSON.stringify(gapF));
    assert.ok(!keys.includes('crit_luck'));
    const gs = k.findings.filter(f => f.key === 'gear_stat');
    const order = ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'];
    assert.ok(gs.every(f => order.includes(f.stat)) && gs.map(f => order.indexOf(f.stat)).every((v, i, a) => i === 0 || a[i - 1] < v), 'gear stats in priority order: ' + gs.map(f => f.stat).join());
    const extra = k.findings.find(f => f.key === 'ability_extra');
    assert.strictEqual(extra.ability, 'Immolate');
    assert.ok(/5 times/.test(extra.text), extra.text);
});
test('killFacts: killsOnBoss and killIndex reach the kill object for the facts sheet (task-rep-kill)', () => {
    assert.strictEqual(killFor(50619).killsOnBoss, 1, 'every existing caller in this file omits it: defaults to 1, the true count for a single-rank fixture kill');
    assert.strictEqual(killFor(50619).killIndex, 1, 'defaults to 1 alongside killsOnBoss');
    const K = FX.kills['50619'];
    const withCount = F.killFacts({ encounterId: 50619, name: NAMES[50619], rank: FX.encounterRankings['50619'].ranks[0], context: K.context, tables: K.tables,
                                     sourceId: K.sourceID, player: PLAYER, reference: refFor(50619), referenceNote: null, dbIndex: db, killsOnBoss: 7, killIndex: 3 });
    assert.strictEqual(withCount.killsOnBoss, 7);
    assert.strictEqual(withCount.killIndex, 3, 'carries the caller-supplied ordinal, not just the count');
});
test('killFacts on Kaz\'rogal: bad pull, consumables unknown, Curse of Doom unused', () => {
    const k = killFor(50620);
    assert.strictEqual(k.fight.badPull, true);
    assert.strictEqual(k.me.consumablesKnown, false);
    assert.deepStrictEqual(k.me.consumablesAtPull, []);
    assert.strictEqual(k.me.stats, null);   // no CombatantInfo and no gear on this kill
    assert.strictEqual(k.gap, null, 'no accounting on a bad pull');
    assert.ok(/1131s/.test(k.fight.badPullReason) && /fastest reference kills/.test(k.fight.badPullReason) && /trash waves/.test(k.fight.badPullReason), k.fight.badPullReason);
    const keys = keysOf(k.findings);
    assert.ok(k.findings.some(f => f.key === 'ability_unused' && f.ability === 'Curse of Doom'), keys.join());
});
test('rotationFindings: a once-per-fight cooldown outside the top 3 by damage share is still "ability_unused" (Minor 20)', () => {
    const kill = {
        name: 'TestBoss', fight: { durationSec: 120 },
        me: { casts: { 'Shadow Bolt': 60 } },
        reference: {
            castsDurationSec: 120, casts: { 'Shadow Bolt': 60, 'Shadowburn': 1 },
            // Shadowburn is NOT in the top 3 by damage share, so the old "top3 or r>=1.5/min"
            // condition never fired for it: r = 1 cast / 2 min = 0.5/min, well under 1.5.
            abilities: [{ name: 'Shadow Bolt', share: 90 }, { name: 'Immolate', share: 5 }, { name: 'Curse of Recklessness', share: 3 }],
        },
    };
    const f = F.rotationFindings(kill);
    const sb = f.find(x => x.ability === 'Shadowburn');
    assert.ok(sb, 'a cooldown the reference casts at least once a fight must be flagged even outside the top 3');
    assert.strictEqual(sb.key, 'ability_unused');
    assert.strictEqual(sb.severity, 'minor', 'minor because it is not one of the reference\'s top-3 damage abilities');
});
test('uptimeFindings: a death before 90% of the fight and active time under 85% are major', () => {
    const base = killFor(50619);
    const dead = Object.assign({}, base, { me: Object.assign({}, base.me, { died: { atSec: 40, by: 'Carrion Swarm' }, activePercent: 70 }) });
    const f = F.uptimeFindings(dead);
    assert.ok(!f.some(x => x.key === 'active_low'), 'activity is an accounting input now');
    assert.ok(f.every(x => x.severity === 'major'));
    assert.ok(/40s of 131s/.test(f[0].text) && /Carrion Swarm/.test(f[0].text), f[0].text);
    const late = Object.assign({}, base, { me: Object.assign({}, base.me, { died: { atSec: 125, by: null } }) });
    assert.ok(!keysOf(F.uptimeFindings(late)).includes('died'), 'a death in the last 10% is not a finding');
});

// --- Task 6: consumables, buffs, debuffs, gear, merge, facts
function rotProfile() {
    const rankings = { medianPerformanceAverage: 14.0, bestPerformanceAverage: 14.0, rankings: [
        { encounter: { id: 50619, name: 'Anetheron' }, medianPercent: 31.9, rankPercent: 31.9, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50620, name: "Kaz'rogal" }, medianPercent: 0.3, rankPercent: 0.3, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50603, name: 'Shade of Akama' }, medianPercent: null, rankPercent: null, totalKills: 0, spec: 'Destruction', bestSpec: 'Destruction' },
    ] };
    return P.buildProfile({ name: 'Rotminster', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'WARLOCK', combatant: null, report: null,
                            rankings, rankingsZone: 1060, fallback: false, metric: 'dps', otherRankings: null, otherZone: 1056, specRankings: rankings, dbIndex: db });
}
const NOTT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
function nottProfile() {
    return P.buildProfile({ name: 'Nottomwro', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'SHAMAN', combatant: NOTT.report.combatant,
                            report: { code: NOTT.report.code, startTime: NOTT.report.startTime, fightName: NOTT.report.fight.name },
                            rankings: NOTT.zoneRankings['1056'], rankingsZone: 1056, fallback: true, metric: 'dps', otherRankings: null, otherZone: 1060,
                            specRankings: NOTT.zoneRankings['1056'], dbIndex: db });
}
test('consumableFindings on Anetheron: a mana elixir instead of a flask, missing group buffs, nothing else', () => {
    const f = F.consumableFindings(killFor(50619));
    assert.deepStrictEqual(keysOf(f).sort(), ['buffs_missing', 'wrong_elixir']);
    const w = f.find(x => x.key === 'wrong_elixir');
    assert.ok(/Elixir of Draenic Wisdom/.test(w.text) && /Flask of Pure Death/.test(w.text), w.text);
    const b = f.find(x => x.key === 'buffs_missing');
    assert.strictEqual(b.scope, 'group');
    assert.ok(b.buffs.includes('Moonkin Aura') && b.buffs.includes('Prayer of Spirit'), b.buffs.join());
    assert.ok(!b.buffs.includes('Arcane Brilliance'));
});
test('consumableFindings: no flask or elixirs, no food, no potion, when the pull row shows none', () => {
    const base = killFor(50619);
    const bare = Object.assign({}, base, { me: Object.assign({}, base.me, { flask: null, battleElixir: null, guardianElixir: null, food: null, consumablesAtPull: [], potionUse: 0 }) });
    const keys = keysOf(F.consumableFindings(bare));
    assert.ok(keys.includes('no_flask_or_elixirs') && keys.includes('no_food') && keys.includes('no_potion'), keys.join());
    assert.ok(!keys.includes('wrong_elixir'));
    const unknown = Object.assign({}, base, { me: Object.assign({}, base.me, { consumablesKnown: false, potionUse: 0 }) });
    assert.deepStrictEqual(keysOf(F.consumableFindings(unknown)), ['no_potion'], 'unknown consumables are not missing consumables');
});
test('consumableFindings / uptimeFindings (Minor 7): a boss name already starting with "The" is not doubled into "the The Lurker Below"', () => {
    const base = killFor(50619);
    const lurker = Object.assign({}, base, { name: 'The Lurker Below', me: Object.assign({}, base.me, { flask: null, battleElixir: null, guardianElixir: null, food: null, consumablesAtPull: [] }) });
    const noFlask = F.consumableFindings(lurker).find(x => x.key === 'no_flask_or_elixirs');
    assert.ok(noFlask && /at The Lurker Below pull/.test(noFlask.text) && !/at the The Lurker Below/.test(noFlask.text), noFlask && noFlask.text);
    // Anetheron itself does not start with "the": the existing wording is untouched.
    const anet = F.consumableFindings(killFor(50619)).find(x => x.key === 'wrong_elixir');
    assert.ok(anet && /at the Anetheron pull/.test(anet.text), anet && anet.text);
});
// v2 §6: the captured fixture's auras carry no `bands` (slimmed at capture). Build them on a
// clone: Rotminster's real Bloodlust window on Anetheron ran 14.7 s to 54.7 s into the fight.
function withBands(rotBlessingInside) {
    const fx2 = JSON.parse(JSON.stringify(FX));
    const k = fx2.kills['50619'];
    const t0 = k.context.fights[0].startTime;
    const band = (a, b) => ({ startTime: t0 + a * 1000, endTime: t0 + b * 1000 });
    const set = (auras, name, bands) => { const a = auras.find(x => x.name === name); if (a) a.bands = bands; };
    set(k.tables.buffs.data.auras, 'Bloodlust', [band(14.7, 54.7)]);
    set(k.tables.buffs.data.auras, 'Destruction', [band(16, 31)]);
    set(k.tables.buffs.data.auras, 'Blessing of the Silver Crescent', [rotBlessingInside ? band(20, 40) : band(70, 90)]);
    fx2.reference['50619'].players.forEach(p => {
        const f0 = p.context.fights[0].startTime;
        const pb = (a, b) => ({ startTime: f0 + a * 1000, endTime: f0 + b * 1000 });
        const auras = p.tables.buffs.data.auras;
        const ensure = (name, bands) => { let a = auras.find(x => x.name === name); if (!a) { a = { name, totalUptime: 1, totalUses: 1 }; auras.push(a); } a.bands = bands; };
        ensure('Bloodlust', [pb(10, 50)]);
        ensure('Destruction', [pb(12, 27)]);
        ensure('Blessing of the Silver Crescent', [pb(15, 35)]);
        const casts = p.tables.casts.data.entries;
        ['Destruction', 'Blessing of the Silver Crescent'].forEach(n => { if (!casts.some(c => c.name === n)) casts.push({ name: n, total: 1 }); });
    });
    return fx2;
}
function killWithBands(fx2) {
    const K = fx2.kills['50619'], R = fx2.reference['50619'];
    const ranks = R.pages.flatMap(p => p.rankings);
    const reference = F.referenceSummary(F.bandRanks(ranks, 124, 2).slice(0, 8), R.players, db, 'WARLOCK', 'caster', [122, 126]);
    return F.killFacts({ encounterId: 50619, name: 'Anetheron', rank: fx2.encounterRankings['50619'].ranks[0], context: K.context, tables: K.tables, sourceId: K.sourceID, player: PLAYER, reference, referenceNote: null, dbIndex: db });
}
test('burst timing (v2 §6): a burst used only outside Bloodlust, where comparable players use it inside, is a minor player finding', () => {
    const kill = killWithBands(withBands(false));
    const byName = (a, b) => a.name.localeCompare(b.name);   // aura order in the tables is not part of the contract
    assert.deepStrictEqual(kill.me.burst.slice().sort(byName), [{ name: 'Blessing of the Silver Crescent', uses: 1, insideBloodlust: 0 }, { name: 'Destruction', uses: 1, insideBloodlust: 1 }]);
    assert.deepStrictEqual(kill.reference.burst.slice().sort(byName), [{ name: 'Blessing of the Silver Crescent', uses: 1, insideBloodlust: 1 }, { name: 'Destruction', uses: 1, insideBloodlust: 1 }]);
    const f = kill.findings.filter(x => x.key === 'burst_outside_bloodlust');
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].text, 'Used Blessing of the Silver Crescent once on Anetheron, never inside Bloodlust; comparable players line it up with Bloodlust');
    assert.deepStrictEqual([f[0].severity, f[0].scope, f[0].ability], ['minor', 'player', 'Blessing of the Silver Crescent']);
});
test('burst timing (v2 §6): inside the window, or a fight with no Bloodlust, gives no finding', () => {
    assert.deepStrictEqual(killWithBands(withBands(true)).findings.filter(x => x.key === 'burst_outside_bloodlust'), []);
    const fx2 = withBands(false);
    const lust = fx2.kills['50619'].tables.buffs.data.auras.find(a => a.name === 'Bloodlust');
    lust.totalUptime = 0; lust.bands = [];
    const kill = killWithBands(fx2);
    assert.strictEqual(kill.me.bloodlustPercent, 0);
    assert.deepStrictEqual(kill.findings.filter(x => x.key === 'burst_outside_bloodlust'), []);
});
test('burst timing (v2 §6 fix): a Heroism-only fight (Alliance shaman) still opens the burst_outside_bloodlust gate', () => {
    const fx2 = withBands(false);
    const lust = fx2.kills['50619'].tables.buffs.data.auras.find(a => a.name === 'Bloodlust');
    lust.name = 'Heroism';   // name only; bands and totalUptime are unchanged
    const kill = killWithBands(fx2);
    assert.ok(kill.me.bloodlustPercent > 0, kill.me.bloodlustPercent);
    const f = kill.findings.filter(x => x.key === 'burst_outside_bloodlust');
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].text, 'Used Blessing of the Silver Crescent once on Anetheron, never inside Bloodlust; comparable players line it up with Bloodlust');
});
test('rotationFindings (v2 §6, Important 1 whole-branch review): an on-use item the reference uses and the player never did reads "Never used …", a potion by its potion name; neither carries "(on-use item)" any more', () => {
    const kill = killWithBands(withBands(true));
    const casts = Object.assign({}, kill.me.casts);
    delete casts['Blessing of the Silver Crescent'];
    delete casts.Destruction;
    const f = F.rotationFindings(Object.assign({}, kill, { me: Object.assign({}, kill.me, { casts }) }));
    const item = f.find(x => x.key === 'ability_unused' && x.ability === 'Blessing of the Silver Crescent');
    assert.ok(item && /^Never used Blessing of the Silver Crescent on Anetheron; comparable players use it [\d.]+ times a minute$/.test(item.text), item && item.text);
    const potion = f.find(x => x.key === 'ability_unused' && x.ability === 'Destruction');
    assert.ok(potion && /^Never used Destruction Potion on Anetheron; comparable players use it [\d.]+ times a minute$/.test(potion.text), potion && potion.text);
});
test('debuffFindings: missing shadow debuffs are a group finding; a low uptime on your own curse is yours', () => {
    const a = F.debuffFindings(killFor(50619), PLAYER);
    assert.deepStrictEqual(keysOf(a), ['debuff_missing']);
    assert.strictEqual(a[0].scope, 'group');
    assert.deepStrictEqual(a[0].debuffs, ['Misery', 'Shadow Weaving']);
    assert.ok(/shadow priest/.test(a[0].text), a[0].text);
    const k = F.debuffFindings(killFor(50620), PLAYER);
    const low = k.find(x => x.key === 'debuff_uptime_low');
    assert.ok(low && low.scope === 'player' && /Curse of the Elements was up 33%/.test(low.text), JSON.stringify(k));
});
test('gearFindings: vetting rules that fail or warn become gear_ findings', () => {
    const p = nottProfile();
    const f = F.gearFindings(p, { gs: 9999 }, Date.parse('2026-09-03T12:00:00Z'));
    const gs = f.find(x => x.key === 'gear_gs');
    assert.ok(gs && gs.severity === 'major' && /GearScore \d+ against the 9999/.test(gs.text), JSON.stringify(f));
    assert.ok(!f.some(x => x.key === 'gear_parse' || x.key === 'gear_stale'));
    assert.deepStrictEqual(F.gearFindings(rotProfile(), {}, Date.now()), [], 'no gear data, no gear findings');
});
test('mergeFindings: bad pulls dropped, ordered by share then severity, uncapped', () => {
    const kills = [killFor(50619), killFor(50620)];
    const m = F.mergeFindings(kills, []);
    assert.ok(!m.some(f => /Kaz'rogal/.test(f.text)), 'nothing from the bad pull');
    assert.ok(!m.some(f => f.key === 'stat_low' || f.key === 'hit_low'));
    assert.ok(m.every((f, i) => i === 0 || (m[i - 1].share || 0) >= (f.share || 0)), 'share descending');
    assert.ok(m.length >= 7, 'no cap at 6: ' + m.length);
    assert.strictEqual(m[0].severity, 'major');
    const sev = m.map(f => f.severity);
    assert.ok(sev.indexOf('minor') === -1 || sev.indexOf('minor') > sev.lastIndexOf('major'), sev.join());
    const withGear = F.mergeFindings(kills, [F.finding('gear_sockets', 'major', 'player', 'Empty sockets: 3')]);
    assert.ok(withGear.some(f => f.key === 'gear_sockets'));
});
test('mergeFindings: equal share breaks the tie by severity, major before minor', () => {
    const k = killFor(50619);
    const gapKeys = ['rotation', 'cast_pacing', 'crit_buffs', 'power_buffs', 'crit_gear'];
    const gapF = k.findings.filter(f => gapKeys.includes(f.key)).slice(0, 2);
    assert.strictEqual(gapF.length, 2, 'fixture must carry at least two gap findings to build the tie');
    const findings = [Object.assign({}, gapF[0], { share: 10, severity: 'minor' }), Object.assign({}, gapF[1], { share: 10, severity: 'major' })];
    const kill = Object.assign({}, k, { findings });
    const m = F.mergeFindings([kill], []);
    const tied = m.filter(f => f.share === 10);
    assert.strictEqual(tied.length, 2);
    assert.strictEqual(tied[0].severity, 'major', 'equal share: major sorts first');
    assert.strictEqual(tied[1].severity, 'minor');
});
test('mergeFindings: the same finding on two bosses is one line with a count, naming which boss the numbers came from (Important 2, Minor 12)', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { name: 'Archimonde' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'rotation');
    assert.strictEqual(crit.count, 2);
    // Important 2: `bosses` names both, but the kept text and numbers are Anetheron's (first
    // seen) verbatim — `measuredOn` records that explicitly instead of leaving it to the model.
    assert.strictEqual(crit.measuredOn, 'Anetheron');
    assert.deepStrictEqual(crit.bosses, ['Anetheron', 'Archimonde']);
    // Minor 12: the count suffix names the boss it was measured on and lands as its own clause,
    // not trailing right after a folded-in stat sentence where it could read as qualifying that.
    assert.ok(/\(numbers measured on Anetheron; seen on 2 of 2 bosses\)/.test(crit.text), crit.text);
});
test('mergeFindings (Minor 6): a multi-pull boss with no date prints just the boss name, not "Boss (null)"', () => {
    const a = Object.assign({}, killFor(50619), { date: null });
    const b = Object.assign({}, killFor(50619), { date: null });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'rotation');
    assert.strictEqual(crit.measuredOn, 'Anetheron', 'no date on the kill: the label falls back to the bare boss name');
    assert.ok(!/null/.test(crit.text), crit.text);
});
test('mergeFindings (v3): a later pull with a larger share for the same finding replaces the numbers and measuredOn', () => {
    const a = killFor(50619);
    const bDate = '2026-09-01';
    const bigger = a.findings.find(f => f.key === 'rotation').share + 10;
    const bFindings = a.findings.map(f => f.key === 'rotation' ? Object.assign({}, f, { share: bigger, me: 9999, reference: 8888 }) : f);
    const b = Object.assign({}, a, { date: bDate, findings: bFindings });
    const m = F.mergeFindings([a, b], []);
    const rot = m.find(f => f.key === 'rotation');
    assert.strictEqual(rot.count, 2);
    assert.strictEqual(rot.measuredOn, 'Anetheron (' + bDate + ')', 'the larger-share pull\'s numbers win');
    assert.strictEqual(rot.me, 9999);
    assert.strictEqual(rot.reference, 8888);
    assert.strictEqual(rot.share, bigger, 'the larger share survives the merge');
});
test('mergeFindings / positives (v2 §4): two pulls of one boss count as pulls and name the date; one pull per boss keeps the v1 wording', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { date: '2026-09-01' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'rotation');
    assert.strictEqual(crit.count, 2);
    assert.strictEqual(crit.measuredOn, 'Anetheron (' + a.date + ')');
    assert.ok(crit.text.endsWith(' (numbers measured on Anetheron (' + a.date + '); seen on 2 of 2 pulls)'), crit.text);
    const pos = F.positives([a, b], 'caster');
    assert.ok(pos.includes('Active 90%+ on every pull'), pos.join(' | '));
    assert.ok(pos.includes('No deaths on any of the 2 pulls'), pos.join(' | '));
    const one = F.positives([a, Object.assign({}, a, { name: 'Archimonde' })], 'caster');
    assert.ok(one.includes('Active 90%+ on every boss'), 'one pull per boss: v1 wording untouched');
});
test('buildFacts: the sheet the model reads', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual([facts.player.name, facts.player.class, facts.player.spec, facts.player.role, facts.player.metric], ['Rotminster', 'WARLOCK', 'Destruction', 'caster', 'dps']);
    assert.strictEqual(facts.tier.zone, 1060);
    assert.strictEqual(facts.tier.medianPercent, 14);
    assert.strictEqual(facts.tier.threshold, V.DEFAULT_THRESHOLDS.parse);
    assert.strictEqual(facts.kills.length, 2);
    assert.deepStrictEqual(facts.overall.badPulls.map(b => b.name), ["Kaz'rogal"]);
    assert.ok(/19 of 19/.test(facts.overall.badPulls[0].reason));
    assert.ok(facts.overall.findings.length >= 3, 'no cap at 6 any more: ' + facts.overall.findings.length);
    assert.ok(facts.overall.positives.includes('Active 91.6% on Anetheron'), facts.overall.positives.join(' | '));
    assert.ok(facts.overall.positives.includes('No death on Anetheron'));
    assert.strictEqual(facts.limited, false);
    assert.deepStrictEqual(facts.overall.droppedKills, [], 'no kills errored, so nothing to record here (Important 5)');
    assert.ok(JSON.stringify(facts).length < 60000, 'sheet stays small enough to send to the model');
});
test('positives: dedupes and aggregates across a full roster instead of repeating the same lines per kill (Minor 8)', () => {
    const mk = (name, over) => ({ name, fight: { badPull: false },
        me: Object.assign({ activePercent: 95, died: null, consumablesKnown: true, flask: 'Flask of Pure Death', battleElixir: null, guardianElixir: null, food: 'Well Fed', stats: {} },
                           over && over.me),
        reference: 'reference' in (over || {}) ? over.reference : null,
    });
    const kills = Array.from({ length: 8 }, (_, i) => mk('Boss' + i, i < 2 ? { me: { activePercent: 60, died: { atSec: 5 } } } : null));
    const out = F.positives(kills, 'caster');
    assert.ok(out.length <= 4, 'spec 5.1 wants a short list, not one per kind that happens to be true: ' + out.join(' | '));
    assert.strictEqual(new Set(out).size, out.length, 'no repeated lines');
    assert.ok(out.some(l => /6 of 8 bosses/.test(l)), out.join(' | '));
    assert.ok(!out.some(l => /Boss2|Boss3|Boss4/.test(l)), 'aggregated, not one line per boss: ' + out.join(' | '));

    // The old code hardcoded me.stats.spellDamage, so a melee player's matching attack power could
    // never produce a positive. Isolate the stat line by suppressing the other three candidates.
    const meleeKills = [mk('Gruul', {
        me: { activePercent: 50, died: { atSec: 3 }, consumablesKnown: false, stats: { attackPower: 1200 } },
        reference: { stats: { attackPower: 1000 } },
    })];
    const meleeOut = F.positives(meleeKills, 'melee');
    assert.ok(meleeOut.some(l => /[Aa]ttack power 1200 matches comparable players on Gruul/.test(l)), meleeOut.join(' | '));
});

// --- Task 7: prompt and number guard
const RULES = ['- Bloodlust/Heroism is RAID-wide.', '- Everything else is party-scoped.'];
test('buildFacts / buildPrompt (v2 §7): the two worst live pulls with a ceiling reach the sheet; the prompt asks for every finding and a "Where you stand" line', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const ref = refFor(50619);
    assert.deepStrictEqual(facts.overall.ceiling, [{ name: 'Anetheron', date: killFor(50619).date, me: 1300.7, dps: ref.dps, topDps: ref.topDps }], 'Kaz\'rogal is a bad pull and stays out');
    const three = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619), Object.assign({}, killFor(50619), { name: 'B', rankPercent: 10 }), Object.assign({}, killFor(50619), { name: 'C', rankPercent: 50 })], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(three.overall.ceiling.map(c => c.name), ['B', 'Anetheron'], 'lowest rankPercent first, capped at two');
    const none = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [Object.assign({}, killFor(50619), { reference: null })], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(none.overall.ceiling, []);
    // Important 2 (whole-branch review): a reference IS present but its topDps is explicitly null
    // (the band never appeared on the top pages, spec §3 step 4) must not fall back to a number —
    // that is exactly the "best of the middle sample" bug the reviewer flagged.
    const withNullTopDps = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [Object.assign({}, killFor(50619), { reference: Object.assign({}, killFor(50619).reference, { topDps: null }) })], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(withNullTopDps.overall.ceiling, [], 'a reference with an explicit null topDps yields no ceiling entry, not a middle-sample number');
    // An all-bad-pull sheet (Kaz'rogal only) has no live pull to stand on at all.
    const allBad = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(allBad.overall.ceiling, [], 'an all-bad-pull sheet gives no ceiling entries either');
    const p = F.buildPrompt(facts, RULES);
    // v3: findings are no longer a flat "overall.findings" dump — section 3 now lists player-owned
    // findings by owner, biggest share first, but keeps the same "do not drop any" guarantee.
    assert.ok(/every finding whose owner is "player"/.test(p.system) && /Do not drop any/.test(p.system), p.system);
    // v3: the ceiling section moved from 3b to 6 in the new seven-section structure.
    assert.ok(/6\. If overall\.ceiling is not empty/.test(p.system) && /Where you stand/.test(p.system), p.system);
    assert.ok(!/at most 5/.test(p.system));
    assert.strictEqual(F.checkNumbers('Where you stand: on Anetheron you did ' + Math.round(facts.overall.ceiling[0].me) + ' against ' + ref.dps + ' typical and ' + ref.topDps + ' at best.', facts).ok, true);
});
test('buildPrompt: facts-only rules, structure, Anniversary lines, healer note only when limited', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/Use ONLY the facts/.test(p.system));
    assert.ok(/Bloodlust\/Heroism is RAID-wide/.test(p.system));
    // v3: the metric-dependent "What's holding your damage/healing back" heading is gone — the
    // owner-based sections have fixed names regardless of metric.
    assert.ok(p.system.includes('What you can fix') && /What's fine/.test(p.system) && /Not on you/.test(p.system));
    assert.ok(/Under 450 words/.test(p.system));
    assert.ok(!/healer/i.test(p.system));
    assert.ok(p.user.startsWith('Facts sheet:\n{'));
    assert.ok(p.user.includes('"Rotminster"'));
    const h = F.buildPrompt(Object.assign({}, facts, { limited: true }), RULES);
    assert.ok(/healer/i.test(h.system));
    // Important 2: the system prompt tells the model not to move a merged finding's numbers to a
    // different boss than the one they were measured on.
    assert.ok(/measuredOn/.test(p.system) && /never attach them to another boss/i.test(p.system), p.system);
});
test('buildPrompt (v3): the owner-based section names no longer vary with the player\'s metric (was Minor 9)', () => {
    // v3 retires the metric-dependent "What's holding your damage/healing back" heading in favour
    // of fixed owner-based section names ("What you can fix" etc.) that read the same for hps and
    // dps facts alike; the healer-only note (facts.limited) is the only metric-driven wording left.
    const dpsFacts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.strictEqual(dpsFacts.player.metric, 'dps');
    assert.ok(!/What's holding your damage back/.test(F.buildPrompt(dpsFacts, RULES).system));
    const hpsFacts = Object.assign({}, dpsFacts, { player: Object.assign({}, dpsFacts.player, { metric: 'hps' }) });
    const p = F.buildPrompt(hpsFacts, RULES);
    assert.ok(!/What's holding your healing back/.test(p.system), p.system);
    assert.ok(!/What's holding your damage back/.test(p.system), p.system);
    assert.ok(p.system.includes('What you can fix'), p.system);
});
test('buildPrompt: sections tell the model to skip themselves when the facts sheet has nothing for them (Minor 14)', () => {
    const badPullOnlyFacts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(badPullOnlyFacts.overall.findings, []);
    assert.deepStrictEqual(badPullOnlyFacts.overall.positives, []);
    assert.ok(badPullOnlyFacts.overall.badPulls.length >= 1);
    const p = F.buildPrompt(badPullOnlyFacts, RULES);
    // v3: the old wording unconditionally ordered "What's holding your damage back" and "What's
    // fine", which for a bad-pull-only player produced a heading with nothing under it. Section 3
    // ("What you can fix") now lists every finding whose owner is "player" — naturally empty when
    // overall.findings is empty, with no separate skip instruction needed. Sections 5 ("What's
    // fine") and 7 ("Not on you") still guard explicitly on their source arrays being non-empty.
    assert.ok(/every finding whose owner is "player"/.test(p.system), p.system);
    assert.ok(/If overall\.positives is not empty, a line "What\'s fine"/.test(p.system), p.system);
    assert.ok(/If overall\.badPulls is not empty or any finding has owner "raid", a line "Not on you"/.test(p.system), p.system);
});
test('buildPrompt (v3): six owner-based sections, the gap summary, the relabelled reference, no cap on findings', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    ['Where the gap comes from', 'What you can fix', 'Ask your raid leader', "What's fine", 'Where you stand', 'Not on you'].forEach(s => assert.ok(p.system.includes(s), s));
    assert.ok(/overall\.gap/.test(p.system) && /unexplained/.test(p.system));
    assert.ok(/among the top 2000 parses/.test(p.system));
    assert.ok(/owner is "player"/.test(p.system) && /owner is "group"/.test(p.system) && /owner is "raid"/.test(p.system));
    assert.ok(/Under 450 words/.test(p.system) && !/at most 5/.test(p.system));
    assert.ok(/share/.test(p.system), 'the model is told what share means');
});
test('completeReply (v3): findings the model left out are appended under "Also:"; nothing appended when all are present', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const all = facts.overall.findings;
    assert.ok(all.length >= 5);
    const full = all.map(f => f.text).join(' ');
    assert.deepStrictEqual(F.completeReply(full, facts).appended, []);
    const partial = all.slice(1).map(f => f.text).join(' ');
    const r = F.completeReply(partial, facts);
    assert.deepStrictEqual(r.appended, [all[0].text]);
    assert.ok(r.text.endsWith('\n\nAlso:\n' + all[0].text));
    const facts2 = Object.assign({}, facts, { overall: Object.assign({}, facts.overall, { findings: [{ key: 'no_food', text: 'No food buff at the Anetheron pull', me: null }] }) });
    assert.deepStrictEqual(F.completeReply('You had no food on the pull.', facts2).appended, [], 'the anchor word is enough for a finding without a number');
    assert.deepStrictEqual(F.completeReply('Nice work.', facts2).appended, ['No food buff at the Anetheron pull']);
});
test('completeReply (fix round 1): both of a finding\'s numbers must appear, and a finding\'s own token beats a generic key-level anchor', () => {
    const withFindings = findings => ({ overall: { findings } });

    // Review repro 1: a channel_time finding's headline number (me: 6) was satisfied by an
    // unrelated "6" elsewhere in the reply, and its reference (0) was never checked at all.
    const channel = { key: 'channel_time', me: 6, reference: 0, text: 'Channelling Drain Soul and other utility 6 seconds of every minute on Anetheron; comparable players 0.' };
    assert.deepStrictEqual(F.completeReply('You died 6 times less than last week.', withFindings([channel])).appended, [channel.text]);
    assert.deepStrictEqual(F.completeReply('You channel 6 seconds a minute; comparable players channel about 0.', withFindings([channel])).appended, []);

    // Review repro 2: ability_extra/ability_ratio both anchored on the generic word "comparable",
    // which appears in almost any reply. A finding carrying its own `ability` field now anchors on
    // that ability name instead of the key-level fallback.
    const drainSoul = { key: 'ability_extra', ability: 'Drain Soul', text: 'Cast Drain Soul 7 times on Anetheron; comparable players do not use it' };
    assert.deepStrictEqual(F.completeReply('Your crit rating is 222 against the 345 comparable players carry.', withFindings([drainSoul])).appended, [drainSoul.text]);
    assert.deepStrictEqual(F.completeReply('You cast Drain Soul seven times.', withFindings([drainSoul])).appended, [], 'anchor \'Drain Soul\'');

    // A finding with two real numbers and no anchor at all (power_gear, crit_buffs, ...): both
    // numbers must appear; either one missing means the finding was dropped.
    const powerGear = { key: 'power_gear', me: 846, reference: 1004, text: 'Spell power from gear 846 against 1004 for players at your item level among the top 2000 parses.' };
    assert.deepStrictEqual(F.completeReply('846 against 1004', withFindings([powerGear])).appended, []);
    assert.deepStrictEqual(F.completeReply('846 spell power', withFindings([powerGear])).appended, [powerGear.text], 'reference missing');
});
test('checkNumbers: figures from the sheet pass with rounding, foreign figures fail, small numbers ignored', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const good = 'Rotminster, Destruction warlock, BT/Hyjal, median parse 14.\n1. Crit: your Shadow Bolts crit 26% of the time; comparable players crit 59%. Your crit rating is 222 against 345.\n2. Shadow Bolt hit for 3,087 against 4215.\nWhat\'s fine: active 92%, no deaths.';
    assert.deepStrictEqual(F.checkNumbers(good, facts), { ok: true, foreign: [] });
    const bad = good + '\nAim for 7777 DPS next week.';
    const r = F.checkNumbers(bad, facts);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.foreign, [7777]);
    assert.strictEqual(F.checkNumbers('Three things, in 2 groups of 5.', facts).ok, true);
});
test('checkNumbers (Important 7): empty reply, a reply with no digits, and a rounded fact +/-1 exactly', () => {
    assert.deepStrictEqual(F.checkNumbers('', { a: 91.6 }), { ok: true, foreign: [] });
    assert.deepStrictEqual(F.checkNumbers('Great work out there, no numbers needed.', { a: 91.6 }), { ok: true, foreign: [] });
    // Widening 1: the old composed tolerance ({round,floor,ceil} of the fact vs {r-1,r,r+1} of the
    // reply) let a reply of 93 pass against a fact of 91.6 (a 1.4 gap, from rounding both sides).
    // Spec 5.2 wants a strict +/-1 against the raw fact, so this must now fail.
    const r = F.checkNumbers('score 93', { a: 91.6 });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.deepStrictEqual(r.foreign, [93]);
    // A reply within +/-1 of the raw fact still passes.
    assert.deepStrictEqual(F.checkNumbers('score 92', { a: 91.6 }), { ok: true, foreign: [] });
});
test('checkNumbers (Important 7): facts are read from real numbers, not harvested out of JSON strings', () => {
    const facts = { reportCode: 'BcZWRDk2PXaYghpC', wclUrl: 'https://classic.warcraftlogs.com/reports/x#fight=57&source=12', date: '2026-08-30', amount: 50 };
    // Old code ran numbersIn() over JSON.stringify(facts), which pulls digits out of the report
    // code ("...Dk2..." -> 2), the URL ("fight=57&source=12" -> 57, 12) and the date (2026, 8, 30).
    // None of those are real facts, so a reply inventing 2026 or 57 must still be rejected.
    const r = F.checkNumbers('Aim to hit 2026 next time, or at least 57.', facts);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.deepStrictEqual(r.foreign.sort((a, b) => a - b), [57, 2026]);
    assert.strictEqual(F.checkNumbers('You did 50 last time.', facts).ok, true);
});
test('checkNumbers (v2 Task 9 fix): numbers inside finding texts and ISO date components are facts; other strings still are not', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false, night: { code: 'X', date: '2026-09-04', medianPercent: 22 }, nights: [] });
    facts.gear = Object.assign({}, facts.gear, { findings: [{ key: 'gear_hit', severity: 'major', scope: 'player', text: 'Hit rating 188 against the 202 the raid asks for' }] });
    assert.strictEqual(F.checkNumbers('Hit rating 188 against the 202 the raid asks for.', facts).ok, true, 'a threshold that lives only in a finding text');
    assert.strictEqual(F.checkNumbers('Raid night of 4 September 2026.', facts).ok, true, 'a date component from night.date');
    assert.strictEqual(F.checkNumbers('On ' + killFor(50619).date.slice(0, 4) + '-' + killFor(50619).date.slice(5, 7) + ' you pulled it.', facts).ok, true, 'year and month from a kill date');
    // killFor(50619).fightId (57) cannot demonstrate the wclUrl-leak guard on the full `facts`
    // object above: fightId is ALSO a genuine field in its own right (see the killFacts test
    // "identity, url, me, and the player-side findings"), so 57 is a real fact independent of
    // wclUrl, and the fixture is dense enough that even the source id (12) sits within +/-1 of an
    // unrelated real stat (Shadow Bolt resistPercent 11.9). Isolate the invariant instead: the
    // real wclUrl string, alone, must not leak the fight/source ids it encodes.
    const wclUrl = killFor(50619).wclUrl;
    assert.ok(/fight=57&source=12/.test(wclUrl), wclUrl);
    assert.strictEqual(F.checkNumbers('Fight 57 was fine.', { kills: [{ wclUrl }] }).ok, false, 'a wclUrl fight id must not become an acceptable number');
    assert.strictEqual(F.checkNumbers('Sourced from 12.', { kills: [{ wclUrl }] }).ok, false, 'a wclUrl source id must not become an acceptable number');
});

// --- v2 Task 1: leaderboard geometry (spec v2 §3)
// A synthetic leaderboard: `pages` pages of 100 ranks, DPS falling with rank, item level cycling
// through `levels` so every band is spread evenly across the board. `calls` records the page
// numbers asked for, in order. Past the last page WCL answers with no `rankings` key at all.
function leaderboard(pages, levels) {
    const calls = [];
    const query = async q => {
        const page = +/page:(\d+)/.exec(q)[1];
        calls.push(page);
        if (page > pages) return { worldData: { encounter: { characterRankings: { page, hasMorePages: false, count: 0 } } } };
        const rankings = Array.from({ length: 100 }, (_, i) => {
            const rank = (page - 1) * 100 + i + 1;
            return { name: 'P' + rank, class: 'Warlock', spec: 'Destruction', amount: 5000 - rank, duration: 100000,
                     bracketData: levels[rank % levels.length], startTime: 1, report: { code: 'R' + rank, fightID: 1 } };
        });
        return { worldData: { encounter: { characterRankings: { page, hasMorePages: page < pages, count: 100, rankings } } } };
    };
    return { calls, query };
}
test('middlePageOrder: outward from the middle, clipped to the leaderboard and the page budget', () => {
    assert.deepStrictEqual(F.middlePageOrder(20, 5), [10, 11, 9, 12, 8]);
    assert.deepStrictEqual(F.middlePageOrder(3, 5), [2, 3, 1]);
    assert.deepStrictEqual(F.middlePageOrder(2, 5), [1, 2]);
    assert.deepStrictEqual(F.middlePageOrder(1, 5), [1]);
    assert.deepStrictEqual(F.middlePageOrder(20, 2), [10, 11]);
    assert.strictEqual(F.globalRank(1, 0), 1);
    assert.strictEqual(F.globalRank(10, 99), 1000);
});
test('findLastPage: binary search over hasMorePages finds the length in at most 6 page reads; the page memo never re-reads', async () => {
    const lb = leaderboard(20, [124]);
    const fetchPage = F.pageFetcher(lb.query, 1, 'Warlock', 'Destruction', 'eu');
    assert.strictEqual(await F.findLastPage(fetchPage, F.REF.maxSearchPages), 20);
    assert.ok(lb.calls.length <= 6, 'pages read: ' + lb.calls.join(','));
    const before = lb.calls.length;
    await fetchPage(20); await fetchPage(20);
    assert.strictEqual(lb.calls.length, before, 'memoised');
    const one = leaderboard(1, [124]);
    assert.strictEqual(await F.findLastPage(F.pageFetcher(one.query, 1, 'Warlock', 'Destruction', 'eu'), F.REF.maxSearchPages), 1);
    const empty = leaderboard(0, [124]);
    assert.strictEqual(await F.findLastPage(F.pageFetcher(empty.query, 1, 'Warlock', 'Destruction', 'eu'), F.REF.maxSearchPages), 1, 'an empty leaderboard reads as one (empty) page');
    const past = await F.pageFetcher(empty.query, 1, 'Warlock', 'Destruction', 'eu')(5);
    assert.deepStrictEqual(past, { page: 5, hasMorePages: false, rankings: [] }, 'a page past the end (no rankings key) reads as empty and last');
    assert.strictEqual(F.REF.topPages, 3);
    assert.strictEqual(F.REF.lengthCacheMs, 7 * 24 * 60 * 60 * 1000);
});

// v2 §3: the reference players are the in-band ranks nearest the MIDDLE of the leaderboard. The
// fixture was captured under v1 (top three in band), so rebuild its pages around the three
// captured players: page 1 = 97 out-of-band filler rows + the three players (global ranks
// 98–100, the middle of a two-page board is rank 100), page 2 = 3 filler rows + every other
// captured rank. Filler is item level 60: outside any band the tests use, even widened.
function midFixture() {
    const fx = JSON.parse(JSON.stringify(FX));
    Object.keys(fx.reference).forEach(enc => {
        const ref = fx.reference[enc];
        const rows = ref.pages.flatMap(p => p.rankings);
        const isPlayer = r => ref.players.some(p => p.rank.name === r.name && p.rank.report.code === r.report.code);
        const players = ref.players.map(p => rows.find(r => r.name === p.rank.name && r.report.code === p.rank.report.code));
        const others = rows.filter(r => !isPlayer(r));
        const filler = i => ({ name: 'Filler' + i, class: 'Warlock', spec: 'Destruction', amount: 1, duration: 100000, bracketData: 60, startTime: 1, report: { code: 'FILLER', fightID: i } });
        ref.pages = [
            { page: 1, hasMorePages: true, count: 100, rankings: Array.from({ length: 97 }, (_, i) => filler(i)).concat(players) },
            { page: 2, hasMorePages: false, count: 3 + others.length, rankings: Array.from({ length: 3 }, (_, i) => filler(100 + i)).concat(others) },
        ];
    });
    return fx;
}
const MID = midFixture();

// --- Task 8: orchestration
// A stub WCL that answers from the fixture by query kind and records what was asked. `fx`
// defaults to the captured fixture; task-rep-kill passes a deep-cloned, modified copy to test
// multi-rank selection without mutating the shared fixture other tests read.
function stubQuery(fx) {
    fx = fx || MID;
    const calls = [];
    const byFight = new Map();
    Object.keys(fx.kills).forEach(e => { const k = fx.kills[e]; byFight.set(k.code + '/' + k.fightID, { context: k.context, tables: { [k.sourceID]: k.tables } }); });
    Object.keys(fx.reference).forEach(e => fx.reference[e].players.forEach(p => {
        const key = p.rank.report.code + '/' + p.rank.report.fightID;
        const cur = byFight.get(key) || { context: p.context, tables: {} };
        cur.tables[p.sourceID] = p.tables;
        byFight.set(key, cur);
    }));
    const query = async (q, vars) => {
        calls.push({ q, vars });
        if (q.includes('encounterRankings(')) {
            const ch = { id: 1, classID: 10 };
            Object.keys(fx.encounterRankings).forEach(e => { ch['e' + e] = fx.encounterRankings[e]; });
            return { characterData: { character: ch } };
        }
        if (q === F.FIGHT_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.context : null } }; }
        if (q === F.PLAYER_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.tables[vars.s] || null : null } }; }
        if (q.includes('characterRankings(')) {
            const enc = /encounter\(id:(\d+)\)/.exec(q)[1], page = +/page:(\d+)/.exec(q)[1];
            const pg = fx.reference[enc].pages[page - 1];
            return { worldData: { encounter: { characterRankings: pg || { page, hasMorePages: false, count: 0, rankings: [] } } } };
        }
        throw new Error('unexpected query: ' + q.slice(0, 60));
    };
    return { calls, query };
}
test('query builders', () => {
    assert.ok(F.encounterRankQuery([50619, 50620], 'dps').includes('e50619:encounterRankings(encounterID:50619,metric:dps)'));
    assert.ok(F.encounterRankQuery([1], 'hps').includes('metric:hps'));
    assert.ok(/serverSlug:\$server/.test(F.encounterRankQuery([1], 'dps')));
    const rq = F.refPageQuery(50619, 'Warlock', 'Destruction', 'eu', 2);
    assert.ok(rq.includes('encounter(id:50619)') && rq.includes('className:"Warlock"') && rq.includes('specName:"Destruction"') && rq.includes('serverRegion:"eu"') && rq.includes('page:2'));
    assert.ok(F.FIGHT_QUERY.includes('debuffs:table(dataType:Debuffs') && F.FIGHT_QUERY.includes('summary:table(dataType:Summary'));
    assert.ok(F.PLAYER_QUERY.includes('ci:events(dataType:CombatantInfo'));
});
test('mapLimit keeps at most N in flight and returns results in order', async () => {
    let inFlight = 0, peak = 0;
    const out = await F.mapLimit([1, 2, 3, 4, 5], 2, async x => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return x * 2; });
    assert.deepStrictEqual(out, [2, 4, 6, 8, 10]);
    assert.strictEqual(peak, 2);
});
test('fetchFeedback: two kills analysed, references built around the middle of the board, cache reused on the second run', async () => {
    const s = stubQuery();
    const refCache = new Map();
    const now = Date.now();
    const facts = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache, thresholds: {}, now });
    assert.strictEqual(facts.kills.length, 2);
    assert.deepStrictEqual(facts.kills.map(k => k.name), ["Kaz'rogal", 'Anetheron'], 'worst parse first');
    assert.strictEqual(facts.kills[1].reference.sampleSize, 8);
    assert.deepStrictEqual(facts.kills[1].reference.itemLevelBand, [122, 126]);
    assert.strictEqual(facts.overall.badPulls.length, 1);
    // task-rep-kill: every current-roster boss has exactly one rank, so killsOnBoss/killIndex must
    // both read 1 and the chosen kill, hence the whole report, must be a strict no-op against
    // today's live data.
    assert.strictEqual(facts.kills[0].killsOnBoss, 1);
    assert.strictEqual(facts.kills[0].killIndex, 1);
    assert.strictEqual(facts.kills[1].killsOnBoss, 1);
    assert.strictEqual(facts.kills[1].killIndex, 1);
    const pageCalls = s.calls.filter(c => c.q.includes('characterRankings('));
    // v2 §3: per boss, the length walk over 64 pages reaches the fixture's 2-page board in 5
    // reads (32, 16, 8, 4, 2 — page 2 is non-empty with hasMorePages:false), the benchmark then
    // reads page 1 (6th), and the ceiling re-reads page 1 from the memo. Two bosses → 12.
    assert.strictEqual(pageCalls.length, 12, 'pages asked: ' + pageCalls.map(c => /page:(\d+)/.exec(c.q)[1]).join(','));
    assert.strictEqual(facts.kills[1].reference.benchmark, 'median');
    assert.strictEqual(facts.kills[1].reference.topDps, Math.round(Math.max(...MID.reference['50619'].players.map(p => p.rank.amount))), 'the ceiling is the best in-band DPS on the top pages: the three players are the only in-band rows on page 1');
    const playerCalls = s.calls.filter(c => c.q === F.PLAYER_QUERY);
    assert.strictEqual(playerCalls.length, 2 + 2 * F.REF.players);
    // v2 §3: leaderboardLength caches the length under its own 'len:' key in the same refCache,
    // alongside the band-keyed entry — 2 boss encounters -> 4 entries, not 2.
    assert.strictEqual(refCache.size, 4);
    const before = s.calls.length;
    await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache, thresholds: {}, now: now + 1000 });
    assert.strictEqual(s.calls.slice(before).filter(c => c.q.includes('characterRankings(')).length, 0, 'reference cache hit');
    assert.strictEqual(s.calls.slice(before).filter(c => c.q === F.PLAYER_QUERY).length, 2, 'only the player\'s own tables again');
});
test('fetchFeedback (task-rep-kill): a boss with several ranks analyses the one nearest the median, and the reference band still comes from that CHOSEN rank\'s item level', async () => {
    // Give Anetheron two decoy ranks around the real one: a more-recent one far from the median
    // (rankPercent 90, built from Kaz'rogal's real fixture report so it resolves like a genuine
    // kill), and an even-older one also far from the median. The old recency sort would have
    // picked the more-recent decoy; the new rule must pick the real, median-matching rank in the
    // middle, and killIndex must reflect its chronological position (2nd oldest of 3), not "1".
    const fx2 = JSON.parse(JSON.stringify(MID));
    const az = FX.kills['50620'];
    const original = fx2.encounterRankings['50619'].ranks[0];
    fx2.encounterRankings['50619'].ranks.push(
        { rankPercent: 90, duration: 90000, amount: 4000, bracketData: 110, spec: 'Destruction',
          startTime: original.startTime + 100000, report: { code: az.code, fightID: az.fightID } },
        { rankPercent: 5, duration: 95000, amount: 500, bracketData: 118, spec: 'Destruction',
          startTime: original.startTime - 100000, report: { code: 'FAKE_OLDEST_NEVER_FETCHED', fightID: 999 } },
    );
    const s = stubQuery(fx2);
    const facts = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    const anetheron = facts.kills.find(k => k.name === 'Anetheron');
    assert.ok(anetheron, 'Anetheron kill is present (the wrong choice has no fixture data under encounter 50619 and would resolve to nothing)');
    assert.strictEqual(anetheron.reportCode, original.report.code, 'the median-nearest rank was fetched, not the most recent one');
    assert.strictEqual(anetheron.fightId, original.report.fightID);
    assert.strictEqual(anetheron.killsOnBoss, 3);
    assert.strictEqual(anetheron.killIndex, 2, 'the chosen rank is the 2nd oldest of 3, not the 1st (proves the index is a real ordinal, not a hardcoded 1)');
    // The reference band must still come from the CHOSEN rank's bracketData (124), not either
    // decoy's (110 or 118); the fixture only has reference pages for the 124 band.
    assert.deepStrictEqual(anetheron.reference.itemLevelBand, [122, 126]);
});
test('fetchFeedback (v2 §4): a boss with several ranks analyses the representative AND the most recent pull; one-rank bosses are unchanged', async () => {
    const fx2 = JSON.parse(JSON.stringify(MID));
    const az = FX.kills['50620'];
    const original = fx2.encounterRankings['50619'].ranks[0];
    // The most recent decoy resolves to Kaz'rogal's real report so it fetches like a genuine kill.
    fx2.encounterRankings['50619'].ranks.push(
        { rankPercent: 90, duration: 90000, amount: 4000, bracketData: 124, spec: 'Destruction', startTime: original.startTime + 100000, report: { code: az.code, fightID: az.fightID } },
        { rankPercent: 5, duration: 95000, amount: 500, bracketData: 118, spec: 'Destruction', startTime: original.startTime - 100000, report: { code: 'FAKE_OLDEST_NEVER_FETCHED', fightID: 999 } },
    );
    const s = stubQuery(fx2);
    const facts = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.deepStrictEqual(facts.kills.map(k => [k.name, k.killIndex, k.killsOnBoss]), [["Kaz'rogal", 1, 1], ['Anetheron', 2, 3], ['Anetheron', 3, 3]], 'worst parse first; the representative (2nd oldest) and the most recent (3rd) Anetheron pulls');
    assert.strictEqual(s.calls.filter(c => c.q === F.FIGHT_QUERY && c.vars.c === 'FAKE_OLDEST_NEVER_FETCHED').length, 0, 'the oldest decoy is neither representative nor most recent');
    const bad = facts.overall.badPulls.find(b => b.name === 'Anetheron');
    assert.ok(bad && bad.date === new Date(original.startTime + 100000).toISOString().slice(0, 10), 'the decoy pull is Kaz\'rogal\'s 1131 s fight, a bad pull, listed with its date');
});
// v2 §5: a fixture clone where Anetheron has a second kill inside Kaz'rogal's report, so the two
// captured reports form two raid nights, Kaz'rogal's being the newer.
// NOTE (deviation from the brief, disclosed in task-4-report.md): the captured fixture's
// Anetheron and Kaz'rogal kills are both logged under ONE real WCL report code (the same player
// killed both in one raid session), so FX.kills['50619'].code === FX.kills['50620'].code already,
// before this helper runs. Reusing az.code verbatim (as the brief's twoNights did) therefore left
// every rank on the same code, so buildNights's Map (one entry per distinct code) could only ever
// produce ONE night, not two. Giving Anetheron's original rank a report code of its own is the
// minimal change that actually realizes "two raid nights" the tests below exercise.
function twoNights() {
    const fx2 = JSON.parse(JSON.stringify(MID));
    const az = FX.kills['50620'];
    const anet = fx2.encounterRankings['50619'].ranks[0];
    anet.report = Object.assign({}, anet.report, { code: anet.report.code + '_OLDER_NIGHT' });
    const later = anet.startTime + 100000;
    fx2.encounterRankings['50620'].ranks[0].startTime = later;
    fx2.encounterRankings['50619'].ranks.push({ rankPercent: 90, duration: 90000, amount: 4000, bracketData: 124, spec: 'Destruction', startTime: later + 5000, report: { code: az.code, fightID: az.fightID } });
    return fx2;
}
test('buildNights (v2 §5.1): kills grouped by report code, newest first, bosses worst first, with the night\'s median', () => {
    const fx2 = twoNights();
    const ch = { e50619: fx2.encounterRankings['50619'], e50620: fx2.encounterRankings['50620'] };
    const nights = F.buildNights(ch, [{ encounterId: 50619, name: 'Anetheron' }, { encounterId: 50620, name: "Kaz'rogal" }]);
    const kazCode = FX.kills['50620'].code, anetCode = fx2.encounterRankings['50619'].ranks[0].report.code;
    const kazPct = F.round1(FX.encounterRankings['50620'].ranks[0].rankPercent);
    assert.deepStrictEqual(nights.map(n => n.code), [kazCode, anetCode]);
    assert.strictEqual(nights[0].date, new Date(fx2.encounterRankings['50620'].ranks[0].startTime).toISOString().slice(0, 10), 'the earliest kill of the night dates it');
    assert.deepStrictEqual(nights[0].bosses.map(b => b.name), ["Kaz'rogal", 'Anetheron']);
    assert.strictEqual(nights[0].medianPercent, F.round1((kazPct + 90) / 2));
    assert.deepStrictEqual(nights[1].bosses.map(b => [b.name, b.rankPercent]), [['Anetheron', F.round1(FX.encounterRankings['50619'].ranks[0].rankPercent)]]);
    assert.strictEqual(F.NIGHT_LIMIT, 10);
    assert.deepStrictEqual(F.buildNights({}, [{ encounterId: 1, name: 'X' }]), []);
});
test('fetchFeedback (v2 §5): the default sheet lists the nights; report=<code> analyses only that night; an unknown code gives noKills', async () => {
    const fx2 = twoNights();
    const kazCode = FX.kills['50620'].code, anetCode = fx2.encounterRankings['50619'].ranks[0].report.code;
    const s = stubQuery(fx2);
    const all = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(all.night, null);
    assert.deepStrictEqual(all.nights.map(n => n.code), [kazCode, anetCode]);
    const night = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now(), report: kazCode });
    assert.deepStrictEqual(night.kills.map(k => [k.name, k.reportCode, k.killIndex, k.killsOnBoss]), [["Kaz'rogal", kazCode, 1, 1], ['Anetheron', kazCode, 2, 2]], 'only that report\'s ranks, worst first');
    assert.deepStrictEqual(night.night, { code: kazCode, date: all.nights[0].date, medianPercent: all.nights[0].medianPercent });
    assert.deepStrictEqual(night.nights.map(n => n.code), all.nights.map(n => n.code), 'the list rides along in night mode too');
    assert.deepStrictEqual(await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now(), report: 'ZZZZZZZZZZZZZZZZ' }), { noKills: true });
});
test('fetchFeedback (Minor 4, whole-branch review): a requested night older than the ten listed still gets its own date and medianPercent, not null', async () => {
    const fx2 = twoNights();
    const anetRank = fx2.encounterRankings['50619'].ranks[0];
    const anetCode = anetRank.report.code;
    const later = anetRank.startTime + 500000;
    // Eleven newer decoy report codes, one boss reference apiece, so buildNights's NIGHT_LIMIT (10)
    // pushes anetCode's own night entry off the list entirely; none of these decoys resolve to any
    // fixture data, which is fine since only facts.night is asserted below.
    for (let i = 0; i < 11; i++) {
        fx2.encounterRankings['50619'].ranks.push({
            rankPercent: 50, duration: 90000, amount: 1000, bracketData: 124, spec: 'Destruction',
            startTime: later + i * 1000, report: { code: 'DECOY' + String(i).padStart(11, '0'), fightID: 1 },
        });
    }
    const s = stubQuery(fx2);
    const night = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now(), report: anetCode });
    assert.ok(!night.nights.some(n => n.code === anetCode), 'sanity: the requested night really was pushed out of the ten listed');
    assert.strictEqual(night.night.code, anetCode);
    assert.strictEqual(night.night.date, new Date(anetRank.startTime).toISOString().slice(0, 10), 'derived from the requested night\'s own ranks, not null');
    assert.strictEqual(night.night.medianPercent, F.round1(F.round1(anetRank.rankPercent)), 'derived from the requested night\'s own ranks, not null');
});
test('fetchFeedback (v2 §5.1): encounterRankings is asked for every killed boss of the zone, not only the picked ones', async () => {
    const rankings = { medianPerformanceAverage: 20, bestPerformanceAverage: 20, rankings: Array.from({ length: 10 }, (_, i) => (
        { encounter: { id: 50600 + i, name: 'B' + i }, medianPercent: 10 + i, rankPercent: 10 + i, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' })) };
    const profile = P.buildProfile({ name: 'Rotminster', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'WARLOCK', combatant: null, report: null,
                                     rankings, rankingsZone: 1060, fallback: false, metric: 'dps', otherRankings: null, otherZone: 1056, specRankings: rankings, dbIndex: db });
    const s = stubQuery();
    await F.fetchFeedback(s.query, { profile, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    const q = s.calls.find(c => c.q.includes('encounterRankings(')).q;
    assert.strictEqual((q.match(/encounterRankings\(/g) || []).length, 10, 'ten killed bosses, ten aliases, although only KILL_LIMIT are analysed');
});
test('buildPrompt (v2 §5.2): the header rule covers the raid-night case', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false, night: { code: 'X', date: '2026-09-01', medianPercent: 20 }, nights: [] });
    assert.deepStrictEqual(facts.night, { code: 'X', date: '2026-09-01', medianPercent: 20 });
    assert.deepStrictEqual(facts.nights, []);
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/raid night of/.test(p.system) && /median parse that night/.test(p.system), p.system);
});
test('fetchFeedback: a healer gets the limited sheet with no reference queries', async () => {
    const s = stubQuery();
    const p = rotProfile();
    p.parses.metric = 'hps';
    const facts = await F.fetchFeedback(s.query, { profile: p, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(facts.limited, true);
    assert.ok(facts.kills.every(k => k.reference === null));
    assert.strictEqual(s.calls.filter(c => c.q.includes('characterRankings(')).length, 0);
    assert.ok(!facts.overall.findings.some(f => ['crit_low', 'hit_low', 'stat_low', 'ability_unused', 'power_gear', 'crit_gear'].includes(f.key)));
});
test('fetchFeedback: no parses gives null; WCL errors propagate', async () => {
    const s = stubQuery();
    const p = rotProfile();
    p.parses = null;
    assert.strictEqual(await F.fetchFeedback(s.query, { profile: p, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() }), null);
    const boom = async () => { const e = new Error('WCL rate limit reached'); e.code = 'RATE_LIMIT'; throw e; };
    await assert.rejects(F.fetchFeedback(boom, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() }), /rate limit/);
});
test('fetchFeedback: a kill whose report errors is dropped with a reason, the rest of the request still succeeds (Important 5)', async () => {
    const s = stubQuery();
    const kazCode = FX.kills['50620'].code, kazFight = FX.kills['50620'].fightID;
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY && vars.c === kazCode && vars.f[0] === kazFight) throw new Error('GraphQL error: report is private');
        return s.query(q, vars);
    };
    const facts = await F.fetchFeedback(query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(facts.kills.length, 1, 'the erroring kill is dropped, not the whole request');
    assert.strictEqual(facts.kills[0].name, 'Anetheron');
    assert.deepStrictEqual(facts.overall.droppedKills, [{ name: "Kaz'rogal", reason: 'GraphQL error: report is private' }]);
});
test('fetchFeedback: a 429 partway through the pipeline still aborts the whole request (Important 5, spec §3.2)', async () => {
    const s = stubQuery();
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) { const e = new Error('WCL rate limit reached'); e.code = 'RATE_LIMIT'; throw e; }
        return s.query(q, vars);
    };
    await assert.rejects(
        F.fetchFeedback(query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() }),
        e => e.code === 'RATE_LIMIT'
    );
});
test('getReference: a reference player whose report errors is skipped, not fatal (Important 5)', async () => {
    const s = stubQuery();
    const badPlayer = FX.reference['50619'].players[0];
    const query = async (q, vars) => {
        if (q === F.PLAYER_QUERY && vars.c + '/' + vars.f[0] === badPlayer.rank.report.code + '/' + badPlayer.rank.report.fightID)
            throw new Error('GraphQL error: table unavailable');
        return s.query(q, vars);
    };
    const ref = await F.getReference(query, { encounterId: 50619, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.ok(ref.summary, 'the reference is still built from the surviving players');
    assert.strictEqual(ref.summary.playersCompared, F.REF.players - 1);
});
test('getReference: a 429 from a reference player still aborts (Important 5, spec §3.2)', async () => {
    const s = stubQuery();
    const badPlayer = FX.reference['50619'].players[0];
    const query = async (q, vars) => {
        if (q === F.PLAYER_QUERY && vars.c + '/' + vars.f[0] === badPlayer.rank.report.code + '/' + badPlayer.rank.report.fightID) {
            const e = new Error('WCL rate limit reached'); e.code = 'RATE_LIMIT'; throw e;
        }
        return s.query(q, vars);
    };
    await assert.rejects(
        F.getReference(query, { encounterId: 50619, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() }),
        e => e.code === 'RATE_LIMIT'
    );
});
test('getReference: an unrecognised class token short-circuits without querying WCL (Minor 16)', async () => {
    let called = false;
    const query = async () => { called = true; throw new Error('should not be called'); };
    const r = await F.getReference(query, { encounterId: 1, classToken: 'DEATHKNIGHT', spec: 'Blood', role: 'tank', region: 'eu', itemLevel: 120, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.strictEqual(r.summary, null);
    assert.ok(/class/i.test(r.note), r.note);
    assert.strictEqual(called, false);
});
test('getReference: two players a level apart in the same spec share one reference fetch (Important 4)', async () => {
    const s = stubQuery();
    const refCache = new Map();
    const base = { encounterId: 50619, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', dbIndex: db, refCache, now: Date.now() };
    const a = await F.getReference(s.query, Object.assign({ itemLevel: 124 }, base));
    assert.ok(a.summary, 'sanity: the first fetch actually built a reference');
    const before = s.calls.length;
    // Old code keyed strictly on itemLevel +/- REF.band (124 -> [122,126], 125 -> [123,127]): two
    // different strings, so a second Destruction warlock one item level over paid the ~35-point
    // reference fetch again. 125 is within the [122,126] band already cached for 124.
    const b = await F.getReference(s.query, Object.assign({ itemLevel: 125 }, base));
    assert.strictEqual(s.calls.length, before, 'no new WCL calls for a nearby item level already covered by the cached band');
    assert.strictEqual(b, a, 'the same cached reference object is reused');
});
test('getReference: widens once when the band is thin, gives a note when still too few, shares in-flight work', async () => {
    const pages = FX.reference['50619'].pages;
    const thin = pages.flatMap(p => p.rankings).filter(r => r.bracketData === 119);
    const twoPages = { page: 1, hasMorePages: false, count: thin.length, rankings: thin };
    let pageCalls = 0;
    const query = async q => {
        if (q.includes('characterRankings(')) { pageCalls++; return { worldData: { encounter: { characterRankings: twoPages } } }; }
        throw new Error('no fight data in this stub');
    };
    const base = { encounterId: 50619, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', dbIndex: db, now: Date.now() };
    const none = await F.getReference(query, Object.assign({ itemLevel: 150, refCache: new Map() }, base));
    assert.strictEqual(none.summary, null);
    assert.ok(/too few same-item-level parses/.test(none.note));
    const cache = new Map();
    const a = F.getReference(query, Object.assign({ itemLevel: 150, refCache: cache }, base));
    const b = F.getReference(query, Object.assign({ itemLevel: 150, refCache: cache }, base));
    await Promise.all([a, b]);
    // This stub answers every page number with the same page and hasMorePages:false. If that
    // page is non-empty the length walk stops at its first probe (32) and the benchmark reads 5
    // pages outward from 16; if it is empty the walk probes 32,16,8,4,2,1 and the benchmark reads
    // page 1 from the memo. Six page fetches per reference build either way; the widened pass
    // and the ceiling always hit the memo. 6 for `none`, 6 shared by the pair.
    assert.strictEqual(pageCalls, 12, 'six page fetches for the first call, six shared by the pair');
});
test('getReference (v2 §3): reference players are the in-band ranks nearest the middle, not the top; dps is their median; the ceiling is the band\'s best', async () => {
    // Item levels cycle 120/124/128 by rank, so for a 124 player only ranks ≡ 1 (mod 3) are in
    // band. On a 20-page board the middle is rank 1000, which falls on page 10 (ranks 901-1000):
    // that single page already holds far more than REF.target in-band ranks, so collect() (one
    // page read per loop turn, stopping once it has enough) never reads page 11 — every candidate
    // it sorts by distance from 1000 is <= 1000. Nearest are 1000, 997, 994, …
    const lb = leaderboard(20, [120, 124, 128]);
    const fights = [];
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) { fights.push(vars.c); return { reportData: { report: { masterData: { actors: [{ id: 7, name: 'P' + vars.c.slice(1), subType: 'Warlock' }] }, fights: [{ id: 1, startTime: 0, endTime: 100000, kill: true }] } } }; }
        if (q === F.PLAYER_QUERY) return { reportData: { report: { dmg: null, casts: null, buffs: null, ci: null } } };
        return lb.query(q, vars);
    };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.deepStrictEqual(fights, ['R1000', 'R997', 'R994'], 'nearest the middle first, all from page 10 (the only benchmark page read)');
    assert.strictEqual(ref.summary.playersCompared, 3);
    assert.strictEqual(ref.summary.sampleSize, 8);
    assert.strictEqual(ref.summary.dps, 4011, 'median of amounts 4021,4018,4015,4012,4009,4006,4003,4000 (ranks 979,982,985,988,991,994,997,1000)');
    assert.strictEqual(ref.summary.topDps, 4999, 'rank 1 is in band: the ceiling comes from page 1, not from the benchmark ranks');
    assert.strictEqual(ref.summary.benchmark, 'median');
    assert.deepStrictEqual(ref.summary.itemLevelBand, [122, 126]);
    assert.deepStrictEqual(lb.calls, [32, 16, 24, 20, 10, 1], 'length walk, one benchmark page (page 10 alone clears REF.target), one ceiling page');
});
test('getReference (Important 2, whole-branch review): topDps is null, not the benchmark\'s own max, when the band never appears on the top pages', async () => {
    // Every rank on this board is item level 124 (in band for a 124 player), so the benchmark
    // pages (around the middle, page 10) find plenty. Pages 1-3 (the ceiling read) are patched to
    // report every rank as item level 60 — out of band — so the ceiling read finds nothing.
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => {
        const m = /page:(\d+)/.exec(q);
        const res = await lb.query(q, vars);
        if (m && +m[1] <= 3) {
            const cr = res.worldData.encounter.characterRankings;
            if (Array.isArray(cr.rankings)) cr.rankings = cr.rankings.map(r => Object.assign({}, r, { bracketData: 60 }));
        }
        return res;
    };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.ok(ref.summary, 'sanity: the benchmark itself still found in-band ranks around the middle');
    assert.strictEqual(ref.summary.topDps, null, 'the band never appeared on pages 1-3: null, not the benchmark\'s own max');
    assert.strictEqual(typeof ref.summary.dps, 'number', 'dps (the benchmark median) is unaffected by the ceiling read finding nothing');
});
test('referenceSummary (Important 2): an explicit null topDps stays null; the legacy 6-argument call (no topDps) keeps falling back to the benchmark max', () => {
    const ranks = [{ amount: 100 }, { amount: 200 }, { amount: 300 }];
    const withNull = F.referenceSummary(ranks, [], db, 'WARLOCK', 'caster', [122, 126], null);
    assert.strictEqual(withNull.topDps, null);
    const legacy = F.referenceSummary(ranks, [], db, 'WARLOCK', 'caster', [122, 126]);
    assert.strictEqual(legacy.topDps, 300, 'no 7th argument at all: old callers (and these tests) keep the fallback');
    const explicit = F.referenceSummary(ranks, [], db, 'WARLOCK', 'caster', [122, 126], 999);
    assert.strictEqual(explicit.topDps, 999);
});
test('getReference (v2 §3): the leaderboard length is cached for a week and shared across bands', async () => {
    const lb = leaderboard(20, [120, 124, 128]);
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) return { reportData: { report: null } };
        return lb.query(q, vars);
    };
    const refCache = new Map(), now = Date.now();
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache, now });
    const before = lb.calls.length;
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 128, dbIndex: db, refCache, now: now + 1000 });
    assert.deepStrictEqual(lb.calls.slice(before), [10, 1], 'a different band re-reads only the benchmark and ceiling pages, never the length walk');
    assert.strictEqual(refCache.get('len:1/WARLOCK/Destruction/eu/').value, 20);
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 100, dbIndex: db, refCache, now: now + F.REF.lengthCacheMs + 1 });
    assert.ok(lb.calls.slice(before + 2).includes(32), 'after a week the length is walked again');
});
test('buildPrompt (v3): "comparable players" are relabelled as the top-2000-parses reference at the player\'s item level', () => {
    // v3 relabels the reference definition from "middle of the leaderboard" wording to
    // GAP.REF_LABEL ("players at your item level among the top 2000 parses").
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/among the top 2000 parses/.test(p.system) && /reference\.topDps/.test(p.system), p.system);
});

test('rotationFindings (v3): a utility cast the reference never makes is an extra when the player makes it once a minute', () => {
    const k = killFor(50619);
    const casts = Object.assign({}, k.me.casts, { 'Drain Soul': 7 });
    const f = F.rotationFindings(Object.assign({}, k, { me: Object.assign({}, k.me, { casts }) }));
    const x = f.find(y => y.key === 'ability_extra' && y.ability === 'Drain Soul');
    assert.ok(x && /Cast Drain Soul 7 times on Anetheron; comparable players do not use it/.test(x.text), x && x.text);
    const lt = f.find(y => y.key === 'ability_extra' && y.ability === 'Life Tap');
    assert.strictEqual(lt, undefined, 'the reference casts Life Tap too');
});
test('positives (v3): an input where the player is ahead of the reference is a positive', () => {
    const k = killFor(50619);
    const g = JSON.parse(JSON.stringify(k.gap));
    g.factors.casts.inputs.find(i => i.key === 'own_activity').share = -5;
    const pos = F.positives([Object.assign({}, k, { gap: g })], 'caster');
    assert.ok(pos.some(p => /ahead of comparable players on activity/.test(p)), pos.join(' | '));
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
