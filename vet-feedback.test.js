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
    assert.strictEqual(ref.abilities[0].hits, 36, 'Important 3: median hits carried through so damageFindings can gate on sample size');
    assert.strictEqual(ref.stats.spellDamage, 1001);
    assert.strictEqual(ref.stats.spellCrit, 345);
    assert.ok(ref.buffsAtPull.includes('Moonkin Aura') && ref.buffsAtPull.includes('Prayer of Spirit'));
    assert.strictEqual(ref.flaskShare, 1);      // all 3 flasked; Zûl's is the Shattrath form
    assert.strictEqual(ref.flask, 'Flask of Pure Death');
    assert.ok(ref.topDps >= ref.dps);
    assert.deepStrictEqual(ref.itemLevelBand, [122, 126]);
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
    assert.ok(keys.includes('crit_low'), keys.join());
    assert.ok(keys.includes('hit_low'), keys.join());
    assert.ok(keys.includes('stat_low'), keys.join());
    assert.ok(keys.includes('casts_low'), keys.join());
    assert.ok(keys.includes('ability_extra'), keys.join());
    assert.ok(!keys.includes('active_low') && !keys.includes('died') && !keys.includes('ability_unused'), keys.join());
    const crit = k.findings.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.severity, 'major');
    assert.strictEqual(crit.scope, 'player');
    assert.strictEqual(crit.ability, 'Shadow Bolt');
    assert.ok(/26\.2%/.test(crit.text) && /58\.8%/.test(crit.text) && /Anetheron/.test(crit.text), crit.text);
    const hit = k.findings.find(f => f.key === 'hit_low');
    assert.ok(/3087/.test(hit.text) && /4215/.test(hit.text), hit.text);
    const stat = k.findings.find(f => f.key === 'stat_low');
    assert.deepStrictEqual([stat.stat, stat.value, stat.reference, stat.severity], ['spellCrit', 222, 345, 'minor']);
    const extra = k.findings.find(f => f.key === 'ability_extra');
    assert.strictEqual(extra.ability, 'Immolate');
    assert.ok(/5 times/.test(extra.text), extra.text);
    const casts = k.findings.find(f => f.key === 'casts_low');
    assert.ok(/25\.2/.test(casts.text) && /30\.5/.test(casts.text), casts.text);
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
    const keys = keysOf(k.findings);
    assert.ok(keys.includes('active_low'), keys.join());
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
    assert.deepStrictEqual(keysOf(f), ['active_low', 'died']);
    assert.ok(f.every(x => x.severity === 'major'));
    assert.ok(/40s of 131s/.test(f[1].text) && /Carrion Swarm/.test(f[1].text), f[1].text);
    const late = Object.assign({}, base, { me: Object.assign({}, base.me, { died: { atSec: 125, by: null } }) });
    assert.ok(!keysOf(F.uptimeFindings(late)).includes('died'), 'a death in the last 10% is not a finding');
});
test('statFindings: primary stat under 90% is major, nothing without a reference', () => {
    const base = killFor(50619);
    const weak = Object.assign({}, base, { me: Object.assign({}, base.me, { stats: Object.assign({}, base.me.stats, { spellDamage: 800 }) }) });
    const f = F.statFindings(weak, 'caster');
    const sp = f.find(x => x.stat === 'spellDamage');
    assert.strictEqual(sp.severity, 'major');
    assert.ok(/Spell power 800 against 1001/.test(sp.text), sp.text);
    assert.deepStrictEqual(F.statFindings(Object.assign({}, base, { reference: null }), 'caster'), []);
});
test('damageFindings: crit/hit/resist need at least T.minAbilityHits casts on both sides (Important 3)', () => {
    const mk = (hits, refHits) => ({
        name: 'TestBoss',
        me: { abilities: [{ name: 'Shadowburn', share: 40, avgHit: 500, avgCrit: 1000, critPercent: 50, resistPercent: 0, hits }] },
        reference: { abilities: [{ name: 'Shadowburn', share: 40, avgHit: 1000, avgCrit: 2000, critPercent: 100, resistPercent: 0, hits: refHits }] },
    });
    // 1 of 2 casts each side, exactly the "Shadowburn is underperforming: crit 50% vs 100%" case
    // that reproduced live from a two-cast sample: must not produce a finding.
    assert.deepStrictEqual(F.damageFindings(mk(1, 2)), []);
    assert.deepStrictEqual(F.damageFindings(mk(12, 3)), [], 'the reference side also needs the minimum sample');
    const big = F.damageFindings(mk(12, 12));
    assert.ok(big.some(f => f.key === 'crit_low'), JSON.stringify(big));
    assert.ok(big.some(f => f.key === 'hit_low'), JSON.stringify(big));
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
test('mergeFindings: bad pulls dropped, stat_low folded into hit_low, ordered, capped at 6', () => {
    const kills = [killFor(50619), killFor(50620)];
    const m = F.mergeFindings(kills, []);
    assert.ok(m.length <= 6);
    assert.ok(!m.some(f => /Kaz'rogal/.test(f.text)), 'nothing from the bad pull');
    assert.ok(!m.some(f => f.key === 'stat_low'));
    const hit = m.find(f => f.key === 'hit_low');
    assert.ok(hit && /Spell crit rating 222 against 345/.test(hit.text), hit && hit.text);
    assert.deepStrictEqual(hit.stats, [{ stat: 'spellCrit', value: 222, reference: 345 }]);
    assert.strictEqual(m[0].severity, 'major');
    const sev = m.map(f => f.severity);
    assert.ok(sev.indexOf('minor') === -1 || sev.indexOf('minor') > sev.lastIndexOf('major'), sev.join());
    const withGear = F.mergeFindings(kills, [F.finding('gear_sockets', 'major', 'player', 'Empty sockets: 3')]);
    assert.ok(withGear.some(f => f.key === 'gear_sockets'));
});
test('mergeFindings: the same finding on two bosses is one line with a count, naming which boss the numbers came from (Important 2, Minor 12)', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { name: 'Archimonde' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.count, 2);
    // Important 2: `bosses` names both, but the kept text and numbers are Anetheron's (first
    // seen) verbatim — `measuredOn` records that explicitly instead of leaving it to the model.
    assert.strictEqual(crit.measuredOn, 'Anetheron');
    assert.deepStrictEqual(crit.bosses, ['Anetheron', 'Archimonde']);
    // Minor 12: the count suffix names the boss it was measured on and lands as its own clause,
    // not trailing right after a folded-in stat sentence where it could read as qualifying that.
    assert.ok(/\(numbers measured on Anetheron; seen on 2 of 2 bosses\)/.test(crit.text), crit.text);
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
    assert.ok(facts.overall.findings.length >= 3 && facts.overall.findings.length <= 6);
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
    assert.ok(out.length <= 2, 'spec 5.1 wants one or two lines, not one per kind that happens to be true: ' + out.join(' | '));
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
test('buildPrompt: facts-only rules, structure, Anniversary lines, healer note only when limited', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/Use ONLY the facts/.test(p.system));
    assert.ok(/Bloodlust\/Heroism is RAID-wide/.test(p.system));
    assert.ok(/What's holding your damage back/.test(p.system) && /What's fine/.test(p.system) && /Not on you/.test(p.system));
    assert.ok(/Under 350 words/.test(p.system));
    assert.ok(!/healer/i.test(p.system));
    assert.ok(p.user.startsWith('Facts sheet:\n{'));
    assert.ok(p.user.includes('"Rotminster"'));
    const h = F.buildPrompt(Object.assign({}, facts, { limited: true }), RULES);
    assert.ok(/healer/i.test(h.system));
    // Important 2: the system prompt tells the model not to move a merged finding's numbers to a
    // different boss than the one they were measured on.
    assert.ok(/measuredOn/.test(p.system) && /never attach them to another boss/i.test(p.system), p.system);
});
test('buildPrompt: the "holding you back" heading names healing for hps facts, damage for dps facts (Minor 9)', () => {
    const dpsFacts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.strictEqual(dpsFacts.player.metric, 'dps');
    assert.ok(/What's holding your damage back/.test(F.buildPrompt(dpsFacts, RULES).system));
    const hpsFacts = Object.assign({}, dpsFacts, { player: Object.assign({}, dpsFacts.player, { metric: 'hps' }) });
    const p = F.buildPrompt(hpsFacts, RULES);
    assert.ok(/What's holding your healing back/.test(p.system), p.system);
    assert.ok(!/What's holding your damage back/.test(p.system), p.system);
});
test('buildPrompt: sections tell the model to skip themselves when the facts sheet has nothing for them (Minor 14)', () => {
    const badPullOnlyFacts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(badPullOnlyFacts.overall.findings, []);
    assert.deepStrictEqual(badPullOnlyFacts.overall.positives, []);
    assert.ok(badPullOnlyFacts.overall.badPulls.length >= 1);
    const p = F.buildPrompt(badPullOnlyFacts, RULES);
    // The old wording unconditionally ordered "What's holding your damage back" and "What's fine",
    // which for a bad-pull-only player produced a heading with nothing under it.
    assert.ok(/If overall\.findings is empty, skip this section/.test(p.system), p.system);
    assert.ok(/If overall\.positives is empty, skip this section/.test(p.system), p.system);
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

// --- Task 8: orchestration
// A stub WCL that answers from the fixture by query kind and records what was asked. `fx`
// defaults to the captured fixture; task-rep-kill passes a deep-cloned, modified copy to test
// multi-rank selection without mutating the shared fixture other tests read.
function stubQuery(fx) {
    fx = fx || FX;
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
test('fetchFeedback: two kills analysed, references from page 1, cache reused on the second run', async () => {
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
    assert.strictEqual(pageCalls.length, 2, 'page 1 already holds 8 in-band ranks for each boss');
    const playerCalls = s.calls.filter(c => c.q === F.PLAYER_QUERY);
    assert.strictEqual(playerCalls.length, 2 + 2 * F.REF.players);
    assert.strictEqual(refCache.size, 2);
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
    const fx2 = JSON.parse(JSON.stringify(FX));
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
test('fetchFeedback: a healer gets the limited sheet with no reference queries', async () => {
    const s = stubQuery();
    const p = rotProfile();
    p.parses.metric = 'hps';
    const facts = await F.fetchFeedback(s.query, { profile: p, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(facts.limited, true);
    assert.ok(facts.kills.every(k => k.reference === null));
    assert.strictEqual(s.calls.filter(c => c.q.includes('characterRankings(')).length, 0);
    assert.ok(!facts.overall.findings.some(f => ['crit_low', 'hit_low', 'stat_low', 'ability_unused'].includes(f.key)));
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
    assert.strictEqual(pageCalls, 2, 'one page fetch for the first call, one shared fetch for the pair');
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
