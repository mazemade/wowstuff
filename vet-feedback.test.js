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
test('mergeFindings: the same finding on two bosses is one line with a count', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { name: 'Archimonde' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.count, 2);
    assert.ok(/\(on 2 of 2 bosses\)/.test(crit.text), crit.text);
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
    assert.ok(!('meRow' in facts.kills[0]) && !('meRow' in facts.kills[0].me), 'bulky gear rows are not in the sheet');
    assert.ok(JSON.stringify(facts).length < 60000, 'sheet stays small enough to send to the model');
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

// --- Task 8: orchestration
// A stub WCL that answers from the fixture by query kind and records what was asked.
function stubQuery() {
    const calls = [];
    const byFight = new Map();
    Object.keys(FX.kills).forEach(e => { const k = FX.kills[e]; byFight.set(k.code + '/' + k.fightID, { context: k.context, tables: { [k.sourceID]: k.tables } }); });
    Object.keys(FX.reference).forEach(e => FX.reference[e].players.forEach(p => {
        const key = p.rank.report.code + '/' + p.rank.report.fightID;
        const cur = byFight.get(key) || { context: p.context, tables: {} };
        cur.tables[p.sourceID] = p.tables;
        byFight.set(key, cur);
    }));
    const query = async (q, vars) => {
        calls.push({ q, vars });
        if (q.includes('encounterRankings(')) {
            const ch = { id: 1, classID: 10 };
            Object.keys(FX.encounterRankings).forEach(e => { ch['e' + e] = FX.encounterRankings[e]; });
            return { characterData: { character: ch } };
        }
        if (q === F.FIGHT_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.context : null } }; }
        if (q === F.PLAYER_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.tables[vars.s] || null : null } }; }
        if (q.includes('characterRankings(')) {
            const enc = /encounter\(id:(\d+)\)/.exec(q)[1], page = +/page:(\d+)/.exec(q)[1];
            const pg = FX.reference[enc].pages[page - 1];
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
