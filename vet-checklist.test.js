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
    assert.strictEqual(cr.text, 'Casting: 20 damaging casts a minute while active against 24 on Void Reaver');
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
test('castingRows (final review 4): a passing activity row renders a short, number-free line for Fine', () => {
    const rows = C.castingRows(sheet([gapKill('Void Reaver', { own_activity: 1 })]), C.DEFAULT_T);
    const act = rows.find(r => r.id === 'activity');
    assert.strictEqual(act.verdict, 'pass'); assert.strictEqual(act.text, 'active throughout');
    const k = gapKill('Al\'ar', {}, { gap: null }); k.me.activePercent = 95; k.fight.raidActivePercent = 90;
    const act2 = C.castingRows(sheet([k]), C.DEFAULT_T).find(r => r.id === 'activity');
    assert.strictEqual(act2.verdict, 'pass'); assert.strictEqual(act2.text, 'active throughout', 'v2 active_low pass must also be short');
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
test('consumableRows (final review 8): without a reference damage potion the fallback label is capitalised', () => {
    const k = gapKill('A', {}); k.reference.casts = { 'Shadow Bolt': 54, 'Life Tap': 6 };
    const p = C.consumableRows(sheet([k]), C.DEFAULT_T).find(r => r.id === 'potion');
    assert.strictEqual(p.text, 'Potion: 0 on 1 of 1 pulls (up to 2 in a fight this long)');
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
    assert.strictEqual(n.text, 'Shadow Bolt hits for 3065 non-crit against 3869 at the same spell power on Void Reaver; raid debuffs explain about 9%, the remaining 11% is talents, ability rank or gear that logs cannot show');
    assert.strictEqual(n.fix, C.NUKE_FIX.Destruction);
    const fine = gapKill('A', {}); fine.me.abilities[0].avgHit = 3500;
    assert.strictEqual(C.nukeRows(sheet([fine])).find(r => r.id === 'nuke_hit').verdict, 'pass');
});
test('nuke_hit (final review 1): an unknown debuff comparison is not blamed for the shortfall', () => {
    const k = gapKill('Void Reaver', { rotation: 42 });
    k.gap.factors.dmg.inputs.find(i => i.key === 'debuffs').me = null;
    k.gap.factors.dmg.inputs.find(i => i.key === 'debuffs').reference = null;
    const n = C.nukeRows(sheet([k])).find(r => r.id === 'nuke_hit');
    assert.ok(!/raid debuffs explain about/.test(n.text), n.text);
    assert.strictEqual(n.text, 'Shadow Bolt hits for 3065 non-crit against 3869 at the same spell power on Void Reaver; raid debuffs could not be compared on this pull, so the remaining 19% is raid debuffs, talents, ability rank or gear that logs cannot show');
});
test('nuke_hit (final review 2): debuffs that favour the player are not credited, and never render a negative percent', () => {
    const k = gapKill('Void Reaver', { rotation: 42 });
    k.gap.factors.dmg.inputs.find(i => i.key === 'debuffs').me = 1.3;
    k.gap.factors.dmg.inputs.find(i => i.key === 'debuffs').reference = 1.1;
    const n = C.nukeRows(sheet([k])).find(r => r.id === 'nuke_hit');
    assert.ok(!/-\d/.test(n.text), n.text);
    assert.ok(!/raid debuffs explain/.test(n.text), n.text);
    assert.strictEqual(n.text, 'Shadow Bolt hits for 3065 non-crit against 3869 at the same spell power on Void Reaver; the remaining 31% is talents, ability rank or gear that logs cannot show');
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
    assert.strictEqual(hit.text, 'Hit: 185 on your current gear against the 202 your raid asks for'); assert.strictEqual(hit.fix, 'Reach 202 hit before any other stat.');
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

const fs = require('node:fs'), path = require('node:path');
const LOVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-lovestoned-v3.json'), 'utf8'));

test('buildChecklist: verdict from the median ratio and the owner sums; ids unique; caps applied and the overflow kept in rows', () => {
    const kills = [];
    // cast_pacing and own_activity each push their own player-owned fail row on top of the three
    // gear fails below, and flask/potion/unused/nuke_hit fall out of the fixture's own defaults —
    // nine distinct player fails in total, so 3 + 5 caps leave exactly one (sockets) as overflow.
    for (let i = 0; i < 9; i++) { const k = gapKill('B' + i, { cast_pacing: 10, own_activity: 6 }); kills.push(k); }
    const f = sheet(kills, { gear: { findings: [
        { key: 'gear_hit', severity: 'major', scope: 'player', text: 'Hit rating 150 against the 202 the raid asks for', value: 150, bar: 202 },
        { key: 'gear_enchants', severity: 'major', scope: 'player', text: 'Missing enchants: 3 (Head, Bracers, Boots)', value: 3, bar: null },
        { key: 'gear_sockets', severity: 'major', scope: 'player', text: 'Empty sockets: 2', value: 2, bar: null } ] } });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    const ids = cl.rows.map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids');
    const fails = cl.rows.filter(r => r.owner === 'player' && r.verdict === 'fail').map(r => r.id);
    assert.ok(fails.length >= 9, 'expected at least 9 player fails, got: ' + fails.join(', '));
    assert.strictEqual(cl.fixFirst.length, 3); assert.strictEqual(cl.also.length, 5); assert.ok(cl.asks.length <= 3);
    assert.strictEqual(cl.fixFirst[0], 'cast_rate', 'largest value first');
    const overflow = fails.filter(id => !cl.fixFirst.includes(id) && !cl.also.includes(id));
    assert.deepStrictEqual(overflow, ['sockets'], 'row dump: ' + JSON.stringify(cl.rows.map(r => [r.id, r.owner, r.verdict, r.value])));
    assert.ok(cl.rows.some(r => r.id === 'sockets'), 'overflow id must still be in rows');
    const text = C.renderReport(cl, f);
    assert.ok(!text.includes(cl.rows.find(r => r.id === 'sockets').text), 'overflow row text leaked into the report');
    assert.strictEqual(cl.verdict.ratioPercent, 61, '1362 / 2217');
});
test('buildChecklist: healer sheet skips the accounting sections and group asks (final review 11)', () => {
    // This kill's debuffs/party_buffs/curse would all produce group rows on a full sheet (see the
    // groupRows test above) — the point here is that a limited sheet must not render any of them.
    const k = gapKill('A', { cast_pacing: 10 });
    const f = sheet([k], { limited: true });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    assert.strictEqual(cl.verdict, null);
    const skipped = ['nuke_hit', 'unused', 'under_used', 'extra', 'burst_timing', 'debuffs', 'party_buffs', 'bloodlust', 'curse'];
    const ids = cl.rows.map(r => r.id);
    assert.ok(skipped.every(id => !ids.includes(id)), 'row dump: ' + JSON.stringify(ids));
    assert.deepStrictEqual(cl.asks, [], 'a limited sheet must have no group asks');
    assert.ok(cl.fixFirst.length > 0, 'need at least one player fail so the section actually renders');
    const text = C.renderReport(cl, f);
    assert.ok(text.includes('\nWhat\'s holding your healing back\n'), text);
    assert.ok(!text.includes('Fix first'), text);
    assert.ok(!text.includes('Ask your raid leader'), text);
    assert.ok(text.endsWith('Pick one thing to change next raid.'), text.slice(-80));
});
test('buildChecklist: no accounting means no verdict; a player above the reference gets passes only', () => {
    const k = gapKill('A', {}, { gap: null }); k.me.amount = 2500; k.me.flask = 'Flask of Pure Death'; k.me.potionUse = 2;
    k.me.casts.Destruction = 1; k.me.casts.Shadowburn = 1;
    const cl = C.buildChecklist(sheet([k]), C.DEFAULT_T);
    assert.strictEqual(cl.verdict, null);
    assert.deepStrictEqual(cl.fixFirst, []);
    assert.ok(cl.fine.includes('food') && cl.fine.includes('deaths'));
});
test('buildChecklist: stand carries the ceiling pulls with same-class peers; bad pulls are grouped by boss with a month only where the boss also has a live pull', () => {
    const live = gapKill('Lady Vashj', {}, { date: '2026-08-09' }); live.fight.sameClass = [{ name: 'Cartis', amount: 640, isMe: false }, { name: 'Lovestoned', amount: 577, isMe: true }, { name: 'Xeasha', amount: 512, isMe: false }];
    const bad = (name, date) => ({ name, date, rankPercent: 1, fight: { badPull: true, badPullReason: 'x' }, me: {}, findings: [], gap: null });
    const f = sheet([live, bad('Lady Vashj', '2026-05-24'), bad('Leotheras the Blind', '2026-08-09'), bad('Leotheras the Blind', '2026-07-19')],
                    { overall: { badPulls: [{ name: 'Lady Vashj', date: '2026-05-24', reason: 'x' }, { name: 'Leotheras the Blind', date: '2026-08-09', reason: 'x' }, { name: 'Leotheras the Blind', date: '2026-07-19', reason: 'x' }],
                                 ceiling: [{ name: 'Lady Vashj', date: '2026-08-09', me: 577.3, dps: 1180, topDps: 1445 }], gap: null, droppedKills: [] } });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    assert.deepStrictEqual(cl.stand, [{ name: 'Lady Vashj', date: '2026-08-09', me: 577, sameClass: [640, 512], dps: 1180, topDps: 1445 }]);
    assert.deepStrictEqual(cl.notOnYou.badPulls, { total: 4, live: 1, groups: [{ name: 'Lady Vashj', count: 1, months: ['May'] }, { name: 'Leotheras the Blind', count: 2, months: [] }] });
});
test('buildChecklist (final review 6): repeated bad-pull months for the same boss are deduped', () => {
    const live = gapKill('Lady Vashj', {}, { date: '2026-08-09' });
    const bad = (name, date) => ({ name, date, rankPercent: 1, fight: { badPull: true, badPullReason: 'x' }, me: {}, findings: [], gap: null });
    const f = sheet([live, bad('Lady Vashj', '2026-05-24'), bad('Lady Vashj', '2026-05-30')],
                    { overall: { badPulls: [{ name: 'Lady Vashj', date: '2026-05-24', reason: 'x' }, { name: 'Lady Vashj', date: '2026-05-30', reason: 'x' }],
                                 ceiling: [], gap: null, droppedKills: [] } });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    assert.deepStrictEqual(cl.notOnYou.badPulls.groups, [{ name: 'Lady Vashj', count: 2, months: ['May'] }], 'the two May bad pulls must collapse to one month, not "May, May"');
    const text = C.renderReport(cl, f);
    assert.ok(text.includes('Lady Vashj ×2 (May)') && !text.includes('May, May'), text);
});
test('fractionWord', () => {
    assert.strictEqual(C.fractionWord(85), 'almost all'); assert.strictEqual(C.fractionWord(74), 'about three quarters'); assert.strictEqual(C.fractionWord(62), 'most');
    assert.strictEqual(C.fractionWord(50), 'about half'); assert.strictEqual(C.fractionWord(30), 'about a third'); assert.strictEqual(C.fractionWord(20), 'about a quarter'); assert.strictEqual(C.fractionWord(10), 'a small part'); assert.strictEqual(C.fractionWord(3), null);
});
test('golden (Lovestoned, v3 sheet captured 2026-09-05): verdict 59, nuke/cast/activity first, one potion line, one curse line, under 480 words', () => {
    const cl = C.buildChecklist(LOVE, C.DEFAULT_T);
    assert.strictEqual(cl.verdict.ratioPercent, 59);
    assert.deepStrictEqual(cl.fixFirst, ['nuke_hit', 'cast_rate', 'activity']);
    assert.strictEqual(cl.rows.find(r => r.id === 'nuke_hit').value, 36);
    assert.strictEqual(cl.rows.find(r => r.id === 'cast_rate').value, 31);
    const act = cl.rows.find(r => r.id === 'activity').value; assert.ok(act >= 7 && act <= 10, 'activity ~8: ' + act);
    assert.ok(cl.also.indexOf('potion') === 0 && cl.also.includes('flask'), 'potion first in Also, flask present: ' + cl.also.join(','));
    assert.strictEqual(cl.asks[0], 'debuffs');
    assert.strictEqual(cl.rows.find(r => r.id === 'curse').owner, 'group');
    const ids = cl.rows.map(r => r.id); assert.strictEqual(new Set(ids).size, ids.length);
    const text = C.renderReport(cl, LOVE);
    assert.strictEqual((text.match(/Destruction Potion/g) || []).length, 1, text);
    assert.strictEqual((text.match(/Curse of the Elements/g) || []).length, 1, text);
    // The caps bound the text; 480 is the real bound (the spec's own §5 example is 448 words — its "under 320" was an authoring error, corrected 2026-09-05).
    assert.ok(text.split(/\s+/).length < 480, 'words: ' + text.split(/\s+/).length);
    assert.ok(text.startsWith('Lovestoned — Destruction, '), text.split('\n')[0]);
    assert.ok(text.includes('\nFix first\n1. Shadow Bolt hits for '), text);
    assert.ok(text.includes('\nAsk your raid leader\n- No Misery or Shadow Weaving on 5 of 5 pulls (a shadow priest). (~17%)'), text);
    assert.ok(text.includes('8 of 13 pulls were raid-wide bad pulls ('), text);
    assert.ok(text.endsWith('Pick one thing to change next raid.'), text.slice(-80));
});

// --- ref-above B2: an auto-attack is never the ability the advice is built on
test('mainAbility (ref-above B2): auto-attacks are skipped so a melee gets a real ability', () => {
    // Tipsi's real Anetheron reference: Melee 40.3%, Heroic Strike 32.6%, Mortal Strike 10.8%.
    const warrior = { reference: { abilities: [{ name: 'Melee', share: 40.3 }, { name: 'Heroic Strike', share: 32.6 }, { name: 'Mortal Strike', share: 10.8 }] } };
    assert.strictEqual(C.mainAbility(warrior), 'Heroic Strike');
    const hunter = { reference: { abilities: [{ name: 'Auto Shot', share: 45 }, { name: 'Steady Shot', share: 30 }] } };
    assert.strictEqual(C.mainAbility(hunter), 'Steady Shot');
    const caster = { reference: { abilities: [{ name: 'Shadow Bolt', share: 90 }] } };
    assert.strictEqual(C.mainAbility(caster), 'Shadow Bolt', 'a caster is unaffected');
    assert.strictEqual(C.mainAbility({ reference: { abilities: [{ name: 'Melee', share: 100 }] } }), 'spell', 'nothing but auto-attacks falls back');
    assert.strictEqual(C.mainAbility({}), 'spell');
});

// --- ref-above C1: a melee report never says "spell power", and the title names the right tier

// nukeRows reads player.role, one accounting pull's power_* / debuffs inputs, and the main
// ability's avgHit on both sides. Park the whole power total on power_gear and zero the other
// two so the number the report prints is exactly the one the test asked for, and give a
// physical role an auto-attack ahead of its real ability so ref-above B2's skip is exercised
// rather than dodged.
function nukeFacts(o) {
    const k = gapKill('Anetheron', {});
    const gear = C.inputOf(k, 'power_gear');
    gear.me = o.myPower; gear.reference = o.refPower;
    ['power_consumables', 'power_buffs'].forEach(key => { const i = C.inputOf(k, key); i.me = 0; i.reference = 0; });
    const physical = o.role === 'melee' || o.role === 'ranged' || o.role === 'tank';
    const main = physical ? 'Mortal Strike' : 'Shadow Bolt';
    k.me.abilities = [{ name: main, share: 99, hits: 60, avgHit: 2400, avgCrit: 4800, critPercent: 30, resistPercent: 0 }];
    k.reference.abilities = (physical ? [{ name: 'Melee', share: 40, avgHit: 900, hits: 200 }] : [])
        .concat([{ name: main, share: 55, hits: 60, avgHit: 3600, avgCrit: 7200, critPercent: 40, resistPercent: 0 }]);
    return sheet([k], { player: physical ? { name: 'Saiden', class: 'PALADIN', spec: 'Retribution', role: o.role, metric: 'dps', itemLevel: 141 }
                                        : { name: 'Lovestoned', class: 'WARLOCK', spec: 'Destruction', role: o.role, metric: 'dps', itemLevel: 126 } });
}
// renderReport's first line needs only player, tier and (when the report is one night) night —
// the rest of the sheet is here so buildChecklist has a pull to work from.
function reportFacts(o) {
    return sheet([gapKill('Anetheron', {})], {
        player: { name: 'Utopik', class: 'ROGUE', spec: 'Assassination', role: 'melee', metric: 'dps', itemLevel: 141 },
        tier: { zoneName: o.tierZone, medianPercent: 28.1 },
        night: o.nightZone ? { code: 'aBc123', date: o.nightDate, medianPercent: 31.4, zoneName: o.nightZone } : null });
}

test('nukeRows (ref-above C1): the power word follows the role', () => {
    // Sáiden, a Retribution paladin, read "you had 673 spell power, they had 835".
    const melee = nukeFacts({ role: 'melee', myPower: 673, refPower: 835 });
    const text = C.nukeRows(melee).map(r => r.text).join(' ');
    assert.ok(/attack power/.test(text), 'melee reads attack power: ' + text);
    assert.ok(!/spell power/.test(text), 'and never spell power: ' + text);
    const caster = nukeFacts({ role: 'caster', myPower: 1099, refPower: 1016 });
    assert.ok(/spell power/.test(C.nukeRows(caster).map(r => r.text).join(' ')), 'a caster is unchanged');
});
test('nukeRemainder (ref-above C1): the remainder clause says ability rank, not spell rank', () => {
    const text = C.nukeRows(nukeFacts({ role: 'melee', myPower: 673, refPower: 835 })).map(r => r.text).join(' ');
    // Fix round 1, Finding 2: assert the clause is THERE. Absence alone passes trivially if the
    // fixture's verdict ever flips to pass, because nukeRemainder is then never appended at all.
    assert.ok(/ability rank/.test(text), 'the remainder clause is present and renamed: ' + text);
    assert.ok(!/spell rank/.test(text), 'no spell rank for a melee: ' + text);
});
test('renderReport (ref-above C1): the title names the night\'s tier, not the gating tier', () => {
    // Utopik's night was BT / Hyjal; his profile gates on SSC / TK, and the title said SSC / TK.
    const facts = reportFacts({ tierZone: 'SSC / TK', nightZone: 'BT / Hyjal', nightDate: '2026-09-06' });
    const out = C.renderReport(C.buildChecklist(facts), facts);
    assert.ok(/BT \/ Hyjal/.test(out.split('\n')[0]), 'title: ' + out.split('\n')[0]);
    assert.ok(!/SSC \/ TK/.test(out.split('\n')[0]), 'title: ' + out.split('\n')[0]);
    const noNight = reportFacts({ tierZone: 'SSC / TK', nightZone: null, nightDate: null });
    assert.ok(/SSC \/ TK/.test(C.renderReport(C.buildChecklist(noNight), noNight).split('\n')[0]), 'an all-kills report still names the gating tier');
});

// Fix round 1, Finding 1: the cast-pacing branch needs both sides pinned. A physical role's row is
// filtered out of the rendered report, so only a direct castingRows call can see its fix text.
// castFacts gives the pull a real cast_pacing share (gapKill defaults it to 0, which still builds a
// row but describes nothing) and a reference ability the role would actually press.
function castFacts(role, cls, spec, main) {
    const k = gapKill('Anetheron', { cast_pacing: 30 });
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    k.reference.abilities = (physical ? [{ name: 'Melee', share: 40, avgHit: 900, hits: 200 }] : [])
        .concat([{ name: main, share: 55, hits: 60, avgHit: 3600, avgCrit: 7200, critPercent: 40, resistPercent: 0 }]);
    return sheet([k], { player: { name: 'Tester', class: cls, spec, role, metric: 'dps', itemLevel: 141 } });
}
const castFix = facts => C.castingRows(facts, C.DEFAULT_T).find(r => r.id === 'cast_rate').fix;

test('castingRows (ref-above C1): the cast-pacing fix follows the role', () => {
    // A melee presses a button; they have no cast to queue and no movement filler to cast.
    const melee = castFix(castFacts('melee', 'WARRIOR', 'Arms', 'Mortal Strike'));
    assert.ok(/Mortal Strike/.test(melee), 'a melee is told which ability: ' + melee);
    assert.ok(!/Queue the next/.test(melee), 'a melee never queues a cast: ' + melee);
    assert.ok(!/while moving/.test(melee), 'and gets no movement-filler clause: ' + melee);
    // 'ranged' is the value a later edit is most likely to drop from the predicate, so pin it.
    const hunter = castFix(castFacts('ranged', 'HUNTER', 'Marksmanship', 'Steady Shot'));
    assert.ok(/Steady Shot/.test(hunter), 'a hunter is told which ability: ' + hunter);
    assert.ok(!/Queue the next/.test(hunter), 'a hunter never queues a cast: ' + hunter);
    assert.ok(!/while moving/.test(hunter), 'and gets no movement-filler clause: ' + hunter);
    const tank = castFix(castFacts('tank', 'WARRIOR', 'Protection', 'Devastate'));
    assert.ok(!/Queue the next/.test(tank), 'a tank never queues a cast: ' + tank);
    // The mirror: a caster's advice must be exactly what it always was.
    const caster = castFix(castFacts('caster', 'WARLOCK', 'Destruction', 'Shadow Bolt'));
    assert.ok(/Queue the next Shadow Bolt before the current one lands/.test(caster), 'a caster still queues: ' + caster);
    assert.ok(/use Shadowburn or Life Tap while moving/.test(caster), 'and still gets the filler: ' + caster);
});

test('renderReport (ref-above C2): a share above 100% is printed without a percentage, not as "169%"', () => {
    const facts = reportFacts({ tierZone: 'BT / Hyjal', nightZone: 'BT / Hyjal', nightDate: '2026-09-06' });
    const cl = C.buildChecklist(facts);
    // The brief named cast_rate; on this fixture that row builds but never reaches a rendered
    // section, so nothing it carries would be printed and every assertion below would be vacuous.
    // Nor will any nominal-value row do: a consumables row's value is structurally small, so it
    // could never carry the 169 under test. Pin a real gap-share row -- nuke_hit's value IS
    // averageShare(kills, 'rotation'), the same family of number that produced the 169% report.
    const id = cl.also[0];
    const row = cl.rows.find(r => r.id === id);
    assert.ok(row, 'the fixture must render a gap-share row to pin; also = ' + cl.also.join(','));
    assert.strictEqual(id, 'nuke_hit', 'the pinned row is the rotation-share one, not a nominal-value row');
    row.value = 169;
    const out = C.renderReport(cl, facts);
    assert.ok(!/169%/.test(out), 'no 169% anywhere: ' + out);
    assert.ok(!/~1\d\d%/.test(out), 'no three-digit share at all: ' + out);
    // Fix round 1, Finding 3: the cap is two-sided -- "outside 0-100%" includes below 0.
    row.value = -62;
    assert.ok(!/-62%/.test(C.renderReport(cl, facts)), 'a negative share prints no percentage either: ' + C.renderReport(cl, facts));
    row.value = 54;
    assert.ok(/\(~54%\)/.test(C.renderReport(cl, facts)), 'an ordinary share still prints');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
