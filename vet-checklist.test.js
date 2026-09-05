'use strict';
const assert = require('node:assert');
let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const C = require('./vet-checklist.js');

// A minimal accounting pull: only the inputs a test names carry a share; everything else is 0.
function gapKill(name, inputs, extra) {
    const mk = (key, owner, share, me, reference, unit) => ({ key, owner, share, me, reference, unit });
    const get = (k, d) => (inputs[k] !== undefined ? inputs[k] : d);
    const casts = [mk('raid_activity', 'raid', get('raid_activity', 0), 95, 96, 'raid median active %'), mk('own_activity', 'player', get('own_activity', 0), 90, 95, 'active %'),
                   mk('channel_time', 'player', get('channel_time', 0), 1, 0, 'seconds a minute channelling'), mk('cast_pacing', 'player', get('cast_pacing', 0), 20, 24, 'damaging casts a minute')];
    const dmg = [mk('hit_under_cap', 'player', get('hit_under_cap', 0), 202, 160, 'hit rating'), mk('debuffs', 'group', get('debuffs', 0), 1.1, 1.21, 'debuff multiplier'),
                 mk('power_gear', 'player', get('power_gear', 0), 1026, 1007, 'spell power from gear'), mk('power_consumables', 'player', get('power_consumables', 0), 78, 103, 'spell power from consumables'),
                 mk('power_buffs', 'group', get('power_buffs', 0), 0, 40, 'spell power from party buffs'), mk('rotation', 'player', get('rotation', 0), 3065, 3869, 'damage per cast (crits included)')];
    const crit = [mk('crit_gear', 'player', get('crit_gear', 0), 20, 22, 'crit % from gear'), mk('crit_buffs', 'group', get('crit_buffs', 0), 0, 5, 'crit % from party buffs'), mk('crit_luck', 'noise', get('crit_luck', 0), 35, 44, 'measured crit %')];
    const sum = arr => arr.reduce((s, i) => s + i.share, 0);
    return Object.assign({
        name, date: '2026-08-20', rankPercent: 20,
        fight: { durationSec: 186, badPull: false, badPullReason: null, raidActivePercent: 96, sameClass: [] },
        debuffs: { known: true, present: [{ name: 'Curse of the Elements', uptimePercent: 98 }], missing: [{ name: 'Misery', value: '5% spell hit', source: 'a shadow priest' }, { name: 'Shadow Weaving', value: '10% more shadow damage', source: 'a shadow priest' }] },
        me: { amount: 1362, activePercent: 94.5, died: null, potionUse: 0, consumablesKnown: true, consumablesAtPull: ['Well Fed', 'Major Shadow Power'], buffsAtPull: ['Arcane Brilliance'], partyBuffs: ['Arcane Brilliance'],
              flask: null, battleElixir: 'Major Shadow Power', guardianElixir: null, food: 'Well Fed', casts: { 'Shadow Bolt': 65, 'Life Tap': 6, 'Curse of the Elements': 1 },
              abilities: [{ name: 'Shadow Bolt', share: 99, hits: 64, avgHit: 3065, avgCrit: 6261, critPercent: 35.9, resistPercent: 17 }],
              bloodlustPercent: 22, burst: [], stats: { spellHit: 203, spellCrit: 293, spellDamage: 1026 }, damagingCastsPerMinute: 21.3, damagePerDamagingCast: 3841, critRate: 35.4, channelSecPerMin: 0.4 },
        reference: { playersDps: 2217, dps: 2217, topDps: 2600, castsDurationSec: 140, flaskShare: 1, flask: 'Flask of Pure Death', consumablesAtPull: ['Well Fed', 'Flask of Pure Death'],
                     buffsAtPull: ['Moonkin Aura', 'Arcane Brilliance'], casts: { 'Shadow Bolt': 54, 'Curse of Doom': 2, 'Shadowburn': 1, Destruction: 1, 'Life Tap': 6 },
                     abilities: [{ name: 'Shadow Bolt', share: 91, avgHit: 3869, avgCrit: 8162, critPercent: 44, resistPercent: 18, hits: 54 }, { name: 'Curse of Doom', share: 7.2, avgHit: null, hits: 0 }],
                     bloodlustPercent: 28, burst: [{ name: 'Destruction', uses: 1, insideBloodlust: 1 }], damagingCastsPerMinute: 24.3, damagePerDamagingCast: 5474, critRate: 43.6, channelSecPerMin: 0, raidActivePercent: 96.7, debuffs: [], stats: { spellHit: 164, spellCrit: 370, spellDamage: 1007 } },
        findings: [],
        gap: { ratio: 1.63, factors: { casts: { value: 1.14, share: sum(casts), inputs: casts }, dmg: { value: 1.3, share: sum(dmg), inputs: dmg }, crit: { value: 1.06, share: sum(crit), inputs: crit }, residual: { value: 1, share: 0, inputs: [] } } },
    }, extra || {});
}
function sheet(kills, extra) {
    return Object.assign({ player: { name: 'Lovestoned', class: 'WARLOCK', spec: 'Destruction', role: 'caster', metric: 'dps', itemLevel: 126 },
        tier: { zoneName: 'SSC/TK', medianPercent: 28.1 }, gear: { findings: [] }, kills,
        overall: { badPulls: [], ceiling: [], gap: null, droppedKills: [] }, limited: false, nights: [], night: null }, extra || {});
}

test('averageShare / largestPull: absent pulls count 0; the biggest pull supplies the numbers', () => {
    const kills = [gapKill('A', { cast_pacing: 40 }), gapKill('B', { cast_pacing: 20 }), gapKill('C', {}, { gap: null })];
    assert.strictEqual(C.averageShare(kills, 'cast_pacing'), 30, 'averaged over the two accounting pulls only');
    assert.strictEqual(C.largestPull(kills, 'cast_pacing').kill.name, 'A');
    assert.strictEqual(C.averageShare([gapKill('C', {}, { gap: null })], 'cast_pacing'), null);
});
test('verdictForShare applies the floor once, to the average; verdictForHabit is the half-of-pulls rule', () => {
    assert.strictEqual(C.verdictForShare(5), 'fail'); assert.strictEqual(C.verdictForShare(3), 'warn'); assert.strictEqual(C.verdictForShare(2), 'pass'); assert.strictEqual(C.verdictForShare(-4), 'pass');
    assert.strictEqual(C.verdictForHabit(3, 5), 'fail'); assert.strictEqual(C.verdictForHabit(2, 5), 'warn'); assert.strictEqual(C.verdictForHabit(0, 5), 'pass'); assert.strictEqual(C.verdictForHabit(0, 0), null);
});
test('castingRows: cast_rate from cast_pacing with the spec\'s filler, activity with the raid median, channel, life_taps info', () => {
    const f = sheet([gapKill('Void Reaver', { cast_pacing: 22, own_activity: 4, channel_time: 1 })]);
    const rows = C.castingRows(f, C.DEFAULT_T);
    const cr = rows.find(r => r.id === 'cast_rate');
    assert.strictEqual(cr.verdict, 'fail'); assert.strictEqual(cr.value, 22); assert.strictEqual(cr.owner, 'player'); assert.strictEqual(cr.category, 'casting');
    assert.strictEqual(cr.text, '20 damaging casts a minute while active against 24 on Void Reaver');
    assert.strictEqual(cr.fix, 'Queue the next Shadow Bolt before the current one lands; move only when you must, and use Shadowburn or Life Tap while moving.');
    const act = rows.find(r => r.id === 'activity');
    assert.strictEqual(act.verdict, 'warn'); assert.strictEqual(act.text, 'Active 90% against 95% for comparable players (your raid: 96%) on Void Reaver');
    assert.strictEqual(rows.find(r => r.id === 'channel').verdict, 'pass');
    const lt = rows.find(r => r.id === 'life_taps');
    assert.strictEqual(lt.verdict, 'info'); assert.strictEqual(lt.value, null); assert.strictEqual(lt.text, 'Life Tap 1.9 a minute; comparable players 2.6');
});
test('castingRows: without an accounting the v2 active_low rule gives a habit row, never a share', () => {
    const k = gapKill('Al\'ar', {}, { gap: null }); k.me.activePercent = 70; k.fight.raidActivePercent = 90;
    const rows = C.castingRows(sheet([k]), C.DEFAULT_T);
    const act = rows.find(r => r.id === 'activity');
    assert.strictEqual(act.verdict, 'fail'); assert.strictEqual(act.value, null); assert.deepStrictEqual(act.pulls, { hit: 1, of: 1 });
    assert.ok(!rows.find(r => r.id === 'cast_rate'), 'no cast_rate row without an accounting');
});
test('groupRows: debuffs names what is missing on how many pulls and who brings it; party_buffs sums crit and power shares; curse is a warn ask', () => {
    const f = sheet([gapKill('Void Reaver', { debuffs: 19, crit_buffs: 8, power_buffs: 3 }), gapKill('Morogrim Tidewalker', { debuffs: 15, crit_buffs: 6 })]);
    const rows = C.groupRows(f);
    const d = rows.find(r => r.id === 'debuffs');
    assert.strictEqual(d.owner, 'group'); assert.strictEqual(d.verdict, 'fail'); assert.strictEqual(d.value, 17);
    assert.strictEqual(d.text, 'No Misery or Shadow Weaving on 2 of 2 pulls (a shadow priest)');
    const b = rows.find(r => r.id === 'party_buffs');
    assert.strictEqual(b.value, 9, 'crit 7 + power 2, each averaged over the accounting pulls first');
    assert.strictEqual(b.text, 'No Moonkin Aura in your group on 2 of 2 pulls (a moonkin)');
    const c = rows.find(r => r.id === 'curse');
    assert.strictEqual(c.verdict, 'warn'); assert.strictEqual(c.owner, 'group'); assert.strictEqual(c.value, null);
    assert.strictEqual(c.text, 'You run Curse of the Elements (assignment); comparable players run Curse of Doom, 7% of their damage');
    assert.strictEqual(c.fix, 'Rotate the assignment or give it to the warlock with the lowest DPS.');
});
test('groupRows: bloodlust ask only when the reference had it and the player did not', () => {
    const k = gapKill('Void Reaver', {}); k.me.bloodlustPercent = 0;
    assert.strictEqual(C.groupRows(sheet([k])).find(r => r.id === 'bloodlust').text, 'No Bloodlust on 1 of 1 pulls while comparable players had it');
    assert.ok(!C.groupRows(sheet([gapKill('Void Reaver', {})])).find(r => r.id === 'bloodlust'));
});
test('raidRows: raid_activity is a row only at 3% or more', () => {
    assert.strictEqual(C.raidRows(sheet([gapKill('Al\'ar', { raid_activity: 6 })]))[0].text, 'Your raid was active 95% of Al\'ar against 96% for the reference raid; phases and downtime, not you');
    assert.deepStrictEqual(C.raidRows(sheet([gapKill('Al\'ar', { raid_activity: 2 })])), []);
});

test('consumableRows: flask fails on elixirs when comparable players flask; the value is the larger of the accounting share and the nominal', () => {
    const k1 = gapKill('Lady Vashj', { power_consumables: 1 }), k2 = gapKill('Al\'ar', { power_consumables: 3 });
    k1.me.consumablesAtPull = ['Elixir of Draenic Wisdom', 'Major Shadow Power', 'Well Fed']; k1.me.guardianElixir = 'Elixir of Draenic Wisdom';
    const rows = C.consumableRows(sheet([k1, k2]), C.DEFAULT_T);
    const fl = rows.find(r => r.id === 'flask');
    assert.strictEqual(fl.verdict, 'fail'); assert.deepStrictEqual(fl.pulls, { hit: 2, of: 2 }); assert.strictEqual(fl.value, 2);
    assert.strictEqual(fl.text, 'Flask: Elixir of Draenic Wisdom + Major Shadow Power at the Lady Vashj pull; comparable players run Flask of Pure Death');
    assert.strictEqual(fl.fix, 'Run Flask of Pure Death at every pull.');
    assert.strictEqual(rows.find(r => r.id === 'food').verdict, 'pass');
    assert.ok(!rows.find(r => r.id === 'oil'), 'no oil row when the reference shows none');
});
test('consumableRows: flask passes with a flask; fails with neither flask nor both elixirs even without a reference', () => {
    const ok = gapKill('A', {}); ok.me.flask = 'Flask of Pure Death'; ok.me.consumablesAtPull = ['Flask of Pure Death', 'Well Fed'];
    assert.strictEqual(C.consumableRows(sheet([ok]), C.DEFAULT_T).find(r => r.id === 'flask').verdict, 'pass');
    const bare = gapKill('B', {}, { reference: null, gap: null }); bare.me.consumablesAtPull = ['Well Fed']; bare.me.battleElixir = null;
    const fl = C.consumableRows(sheet([bare]), C.DEFAULT_T).find(r => r.id === 'flask');
    assert.strictEqual(fl.verdict, 'fail'); assert.strictEqual(fl.text, 'Flask: nothing at the B pull'); assert.strictEqual(fl.fix, 'Run a flask at every pull.');
});
test('consumableRows: potion fails on zero potions or on never using the reference\'s damage potion; value 3 per reference potion, capped at 6', () => {
    const k1 = gapKill('Void Reaver', {}), k2 = gapKill('Al\'ar', {}), k3 = gapKill('Lady Vashj', {});
    k2.reference.casts = { 'Shadow Bolt': 80, Destruction: 2 }; k3.me.potionUse = 1; k3.me.casts.Destruction = 1;
    const p = C.consumableRows(sheet([k1, k2, k3]), C.DEFAULT_T).find(r => r.id === 'potion');
    assert.strictEqual(p.verdict, 'fail'); assert.deepStrictEqual(p.pulls, { hit: 2, of: 3 }); assert.strictEqual(p.value, 3);
    assert.strictEqual(p.text, 'Destruction Potion: 0 on 2 of 3 pulls; comparable players use 1–2 a pull (up to 2 in a fight this long)');
    assert.strictEqual(p.fix, 'Pop one on the pull and again every two minutes.');
    const short = gapKill('Short', {}); short.fight.durationSec = 40;
    assert.ok(!C.consumableRows(sheet([short]), C.DEFAULT_T).find(r => r.id === 'potion'), 'a fight under potionMinSec is not measurable');
});
test('cooldownRows: burst_timing names the item fired outside Bloodlust', () => {
    const k = gapKill('Void Reaver', {}); k.me.burst = [{ name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 0 }]; k.reference.burst = [{ name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 1 }];
    const b = C.cooldownRows(sheet([k])).find(r => r.id === 'burst_timing');
    assert.strictEqual(b.verdict, 'fail'); assert.strictEqual(b.value, 2);
    assert.strictEqual(b.text, 'Blessing of the Silver Crescent used outside Bloodlust on 1 of 1 pulls; comparable players line it up with Bloodlust');
    assert.strictEqual(b.fix, 'Hold Blessing of the Silver Crescent for Bloodlust.');
    assert.ok(!C.cooldownRows(sheet([gapKill('A', {})])).find(r => r.id === 'burst_timing'));
});

test('spellRows: one unused row over all pulls, curses/racials/utility/potions excluded, reference rates as a range', () => {
    const k1 = gapKill('Void Reaver', {}), k2 = gapKill('Lady Vashj', {});
    k2.reference.casts = { 'Shadow Bolt': 83, Shadowburn: 9, 'Curse of Agony': 7, 'Blood Fury': 1, 'Life Tap': 14, Destruction: 1 }; k2.reference.castsDurationSec = 420; k2.fight.durationSec = 465;
    const rows = C.spellRows(sheet([k1, k2]), C.DEFAULT_T);
    const u = rows.find(r => r.id === 'unused');
    assert.strictEqual(u.verdict, 'fail'); assert.strictEqual(u.value, 2); assert.deepStrictEqual(u.pulls, { hit: 2, of: 2 });
    assert.strictEqual(u.text, 'Never cast: Shadowburn (comparable players 0.4–1.3 a minute)');
    assert.strictEqual(u.fix, 'Use it while moving and under 25% boss health when you have shards.');
    assert.strictEqual(rows.filter(r => r.id === 'unused').length, 1);
});
test('spellRows: under_used is a warn on the reference\'s top-3 abilities cast under 70% of their rate; extra is info', () => {
    const k = gapKill('Lady Vashj', {}); k.me.casts = { 'Shadow Bolt': 71, Shadowburn: 5, 'Seed of Corruption': 8, 'Curse of the Elements': 8 }; k.fight.durationSec = 465;
    k.reference.casts = { 'Shadow Bolt': 83, Shadowburn: 9 }; k.reference.castsDurationSec = 420;
    k.reference.abilities = [{ name: 'Shadow Bolt', share: 86 }, { name: 'Shadowburn', share: 5 }];
    const rows = C.spellRows(sheet([k]), C.DEFAULT_T);
    const uu = rows.find(r => r.id === 'under_used');
    assert.strictEqual(uu.verdict, 'warn'); assert.strictEqual(uu.text, 'Shadowburn 0.6 a minute against 1.3 for comparable players on Lady Vashj');
    const ex = rows.find(r => r.id === 'extra');
    assert.strictEqual(ex.verdict, 'info'); assert.strictEqual(ex.text, 'Cast while comparable players do not: Seed of Corruption (8 on Lady Vashj)');
    assert.ok(!rows.find(r => r.id === 'unused'));
});

test('nuke_hit: observed / expected from the accounting\'s power and debuff inputs; fail under 0.9; text explains the split', () => {
    // me power 1026+78+0 = 1104, ref 1007+103+40 = 1150, K 670 → 0.975; debuffs 1.1/1.21 → 0.909; expected 0.886; observed 3065/3869 = 0.792 → residual 0.894.
    const k = gapKill('Void Reaver', { rotation: 42 });
    const n = C.nukeRows(sheet([k])).find(r => r.id === 'nuke_hit');
    assert.strictEqual(n.verdict, 'fail'); assert.strictEqual(n.value, 42); assert.strictEqual(n.owner, 'player');
    assert.strictEqual(n.text, 'Shadow Bolt hits for 3065 non-crit against 3869 at the same spell power on Void Reaver; raid debuffs explain about 9%, the remaining 11% is talents, spell rank or gear that logs cannot show');
    assert.strictEqual(n.fix, C.NUKE_FIX.Destruction);
    const fine = gapKill('A', {}); fine.me.abilities[0].avgHit = 3500;
    assert.strictEqual(C.nukeRows(sheet([fine])).find(r => r.id === 'nuke_hit').verdict, 'pass');
});
test('gearRows: hit from the current profile (value/bar) beats the pull; stat rows are warns; enchants/sockets from gear findings', () => {
    const f = sheet([gapKill('A', { hit_under_cap: -5 })], { gear: { findings: [
        { key: 'gear_hit', severity: 'major', scope: 'player', text: 'Hit rating 185 against the 202 the raid asks for', value: 185, bar: 202 },
        { key: 'gear_enchants', severity: 'minor', scope: 'player', text: 'Missing enchants: 2 (Bracers, Boots)', value: 2, bar: null },
    ] } });
    f.kills[0].findings = [{ key: 'gear_stat', owner: 'player', severity: 'minor', scope: 'player', share: null, stat: 'spellCrit', text: 'Spell crit rating 297 against 354 for players at your item level among the top 2000 parses', me: 297, reference: 354 }];
    const rows = C.gearRows(f);
    const hit = rows.find(r => r.id === 'hit');
    assert.strictEqual(hit.verdict, 'fail'); assert.strictEqual(hit.me, 185); assert.strictEqual(hit.reference, 202); assert.strictEqual(hit.value, 1);
    assert.strictEqual(hit.text, 'Hit: 185 on your current gear against the 202 cap'); assert.strictEqual(hit.fix, 'Reach 202 hit before any other stat.');
    const crit = rows.find(r => r.id === 'stat_spellCrit');
    assert.strictEqual(crit.verdict, 'warn'); assert.strictEqual(crit.text, 'Spell crit rating 297 against 354 for comparable players'); assert.strictEqual(crit.fix, 'Prefer spell crit when upgrading.');
    const en = rows.find(r => r.id === 'enchants');
    assert.strictEqual(en.verdict, 'warn'); assert.strictEqual(en.fix, 'Enchant Bracers, Boots.');
});
test('gearRows: hit at the cap on the profile is a pass row; no profile hit falls back to the pull\'s hit input', () => {
    const f = sheet([gapKill('A', {})], { gear: { findings: [] } });
    assert.ok(!C.gearRows(f).find(r => r.id === 'hit'), 'no hit row without a profile hit or a positive hit share');
    const g = sheet([gapKill('A', { hit_under_cap: 6 })], { gear: { findings: [] } });
    g.kills[0].gap.factors.dmg.inputs.find(i => i.key === 'hit_under_cap').me = 150;
    const h = C.gearRows(g).find(r => r.id === 'hit');
    assert.strictEqual(h.verdict, 'fail'); assert.strictEqual(h.value, 6); assert.strictEqual(h.text, 'Hit: 150 at the A pull against the 202 cap');
});
test('passRows: deaths and power_gear passes only when every pull passes', () => {
    const a = gapKill('A', {}), b = gapKill('B', { power_gear: 0 });
    b.gap.factors.dmg.inputs.find(i => i.key === 'power_gear').me = 1006; b.gap.factors.dmg.inputs.find(i => i.key === 'power_gear').reference = 1044;
    const ids = C.passRows(sheet([a, b])).map(r => r.id);
    assert.ok(ids.includes('deaths') && !ids.includes('power_gear'));
    assert.ok(C.passRows(sheet([a])).map(r => r.id).includes('power_gear'));
    a.me.died = { atSec: 10, by: 'Arcane Orb' };
    assert.ok(!C.passRows(sheet([a])).map(r => r.id).includes('deaths'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
