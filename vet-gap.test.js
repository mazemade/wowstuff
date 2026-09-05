'use strict';
const assert = require('node:assert');
const G = require('./vet-gap.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

test('constants: shapes and the values the spec fixes', () => {
    assert.strictEqual(G.C.CRIT_RATING_PER_PCT, 22.08);
    assert.strictEqual(G.C.HIT_RATING_PER_PCT, 12.62);
    assert.strictEqual(G.C.INT_PER_CRIT.WARLOCK, 81.9);
    assert.strictEqual(G.C.CRIT_BONUS.Destruction, 1);
    assert.strictEqual(G.C.CRIT_BONUS.Affliction, 0.5);
    assert.strictEqual(G.C.CRIT_BONUS.Combat, 1);
    assert.strictEqual(G.C.SPEC_CRIT.Destruction, 8);
    assert.strictEqual(G.C.SPEC_CRIT.Fire, 9);
    assert.strictEqual(G.C.SPEC_CRIT.Protection, 0);
    assert.strictEqual(G.C.SPEC_CRIT.Unknown, undefined);
    assert.deepStrictEqual(G.C.HIT_CAP, { spell: 16, melee: 9, ranged: 9 });
    assert.deepStrictEqual(G.C.POWER_BASE, { caster: 670, melee: 1000, ranged: 1000, tank: 1000, healer: 670 });
    assert.deepStrictEqual(G.BUFF_VALUES['Flask of Pure Death'], { spellPower: 80, scope: 'consumable' });
    assert.deepStrictEqual(G.BUFF_VALUES['Totem of Wrath'], { critPct: 3, hitPct: 3, scope: 'party' });
    assert.deepStrictEqual(G.BUFF_VALUES['Arcane Brilliance'], { intellect: 40, scope: 'party' });
    assert.deepStrictEqual(G.DEBUFF_MULT['Curse of the Elements'], { mult: 1.10, schools: ['arcane', 'fire', 'frost', 'shadow'] });
    assert.deepStrictEqual(G.STAT_PRIORITY.Destruction, ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste']);
    assert.deepStrictEqual(G.STAT_PRIORITY.Affliction, ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit']);
    assert.deepStrictEqual(G.STAT_PRIORITY.Combat, ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste']);
    assert.deepStrictEqual(G.STAT_PRIORITY.Protection, ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste']);
    assert.ok(G.CHANNEL_UTILITY.includes('Drain Soul') && !G.CHANNEL_UTILITY.includes('Mind Flay'));
    assert.ok(/submerge/i.test(G.PHASE_BOSSES['The Lurker Below']));
    assert.strictEqual(G.BURST_VALUE.default, 0.02);
    assert.strictEqual(G.BURST_VALUE.Destruction, 0.03);
    assert.strictEqual(G.FINDING_ANCHOR.no_flask_or_elixirs, 'flask');
    Object.keys(G.BUFF_VALUES).forEach(n => assert.ok(['party', 'consumable'].includes(G.BUFF_VALUES[n].scope), n));
});
test('share and splitLog: whole percents, proportional split, all-zero weights fall to the last entry', () => {
    const Gln = Math.log(2);
    assert.strictEqual(G.share(Math.log(2), Gln), 100);
    assert.strictEqual(G.share(Math.log(Math.sqrt(2)), Gln), 50);
    assert.strictEqual(G.share(0, Gln), 0);
    assert.strictEqual(G.share(Math.log(2), 0), 0, 'no gap, no share');
    assert.deepStrictEqual(G.splitLog(Math.log(4), [1, 3]), [Math.log(4) / 4, 3 * Math.log(4) / 4]);
    assert.deepStrictEqual(G.splitLog(Math.log(4), [0, 0, 0]), [0, 0, Math.log(4)]);
    assert.deepStrictEqual(G.splitLog(Math.log(4), []), []);
});
test('expectedCrit: Dotwin on Morogrim reproduces his measured 32.1% from gear, talents and Moonkin', () => {
    // 1.7 base + 490/81.9 int + 253/22.08 rating + 8 talents + 5 Moonkin = 32.2
    const e = G.expectedCrit({ stats: { spellCrit: 253, intellect: 490 }, auras: ['Greater Blessing of Kings', 'Moonkin Aura', 'Sanctity Aura'], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' });
    assert.strictEqual(Math.round(e.total * 10) / 10, 32.1, '1.7 + 8 + 253/22.08 + 490/81.9 + 5 = 32.14');
    assert.strictEqual(e.buffs, 5, 'Moonkin only; intellect buffs and Kings are already inside the reported intellect and are not counted again');
    assert.strictEqual(e.consumables, 0);
    const withOwl = G.expectedCrit({ stats: { spellCrit: 306, intellect: 469 }, auras: ['Moonkin Aura', 'Chain of the Twilight Owl', 'Arcane Brilliance', 'Adept\'s Elixir', 'Brilliant Wizard Oil'], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' });
    assert.strictEqual(withOwl.buffs, 7, 'Moonkin 5 + Owl 2; Arcane Brilliance is intellect, not counted again');
    assert.ok(withOwl.consumables > 1.7 && withOwl.consumables < 1.8, '(24 + 14) / 22.08 = 1.72: ' + withOwl.consumables);
    assert.strictEqual(Math.round(withOwl.total * 10) / 10, 38, '1.7 + 8 + 306/22.08 + 469/81.9 + 38/22.08 + 7 = 38.0');
    assert.deepStrictEqual(G.expectedCrit({ stats: null, auras: [], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' }), null, 'no stats, no expectation');
    const melee = G.expectedCrit({ stats: { meleeCrit: 300, agility: 500 }, auras: ['Leader of the Pack'], classToken: 'ROGUE', spec: 'Combat', role: 'melee' });
    assert.ok(melee.buffs === 5 && melee.gear > 0);
});
test('powerParts: gear, consumables and party buffs in spell power or attack power', () => {
    const p = G.powerParts({ stats: { spellDamage: 846 }, auras: ['Flask of Pure Death', 'Well Fed', 'Wrath of Air Totem', 'Prayer of Spirit', 'Superior Wizard Oil'], role: 'caster' });
    assert.deepStrictEqual(p, { gear: 846, consumables: 80 + 23 + 42, buffs: 101 + 40 });
    const m = G.powerParts({ stats: { attackPower: 1500 }, auras: ['Battle Shout', 'Fel Strength Elixir', 'Flask of Relentless Assault'], role: 'melee' });
    assert.deepStrictEqual(m, { gear: 1500, consumables: 90 + 120, buffs: 305 });
    assert.deepStrictEqual(G.powerParts({ stats: null, auras: [], role: 'caster' }), { gear: null, consumables: 0, buffs: 0 });
});
test('channelSeconds and damagingCastStats', () => {
    const s = x => x * 1000;
    const buffs = { data: { totalTime: s(200), auras: [
        { name: 'Drain Soul', bands: [{ startTime: 0, endTime: s(15) }, { startTime: s(100), endTime: s(112) }] },
        { name: 'Blessing of the Silver Crescent', bands: [{ startTime: 0, endTime: s(20) }] },
        { name: 'Fel Armor', bands: [{ startTime: 0, endTime: s(200) }] },
    ] } };
    assert.strictEqual(G.channelSeconds(buffs), 27);
    assert.strictEqual(G.channelSeconds(null), 0);
    const casts = { 'Shadow Bolt': 40, 'Life Tap': 5, 'Curse of Doom': 1, 'Drain Soul': 3, 'Immolate': 2 };
    const abilities = [{ name: 'Shadow Bolt', total: 100000, hits: 40, critPercent: 30 }, { name: 'Curse of Doom', total: 8000, hits: 1, critPercent: 0 }, { name: 'Immolate', total: 3000, hits: 2, critPercent: 50 }, { name: 'Drain Soul', total: 0, hits: 0, critPercent: null }];
    assert.deepStrictEqual(G.damagingCastStats(casts, abilities), { casts: 43, damage: 111000, hits: 43, crits: 13 });
    assert.deepStrictEqual(G.damagingCastStats({}, []), { casts: 0, damage: 0, hits: 0, crits: 0 });
});
test('debuffMultiplier: uptime-weighted product over the schools that matter', () => {
    const present = [{ name: 'Curse of the Elements', uptimePercent: 100 }, { name: 'Shadow Weaving', uptimePercent: 50 }, { name: 'Sunder Armor', uptimePercent: 100 }];
    const m = G.debuffMultiplier(present, ['shadow']);
    assert.ok(Math.abs(m - 1.10 * 1.05) < 1e-9, String(m));
    assert.strictEqual(G.debuffMultiplier([], ['shadow']), 1);
    assert.ok(Math.abs(G.debuffMultiplier(present, ['physical']) - 1.18) < 1e-9, 'Sunder only');
});

// A hand-built pull in the shape killFacts produces, with a reference twice as strong in every
// measured way, so every factor is exercised.
function pull(over) {
    const base = {
        name: 'Morogrim Tidewalker', rankPercent: 19,
        fight: { durationSec: 200, raidActivePercent: 70, badPull: false },
        debuffs: { known: true, present: [{ name: 'Curse of the Elements', uptimePercent: 100 }], missing: [] },
        me: { amount: 1000, activePercent: 60, damagingCastsPerMinute: 17, damagePerDamagingCast: 2900, critRate: 32, channelSecPerMin: 6,
              consumablesAtPull: [], buffsAtPull: ['Moonkin Aura'], stats: { spellDamage: 846, spellCrit: 253, spellHit: 181, intellect: 490 } },
        reference: { dps: 2200, playersDps: 2200, raidActivePercent: 85, activePercent: 85, damagingCastsPerMinute: 24, damagePerDamagingCast: 4000, critRate: 46, channelSecPerMin: 0,
                     consumablesAtPull: ['Flask of Pure Death', 'Well Fed'], buffsAtPull: ['Moonkin Aura', 'Chain of the Twilight Owl', 'Prayer of Spirit', 'Wrath of Air Totem'],
                     stats: { spellDamage: 1004, spellCrit: 306, spellHit: 202, intellect: 490 },
                     debuffs: [{ name: 'Curse of the Elements', uptimePercent: 100 }, { name: 'Shadow Weaving', uptimePercent: 100 }] },
    };
    return Object.assign(base, over || {});
}
const PLAYER = { classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', schools: ['shadow'] };
const sumShares = inputs => inputs.reduce((s, i) => s + i.share, 0);
test('explainGap: factors multiply back to the ratio and shares sum to 100', () => {
    const g = G.explainGap(pull(), PLAYER);
    assert.ok(g && Math.abs(g.ratio - 2.2) < 1e-9);
    const product = g.factors.casts.value * g.factors.dmg.value * g.factors.crit.value * g.factors.residual.value;
    assert.ok(Math.abs(product - g.ratio) < 1e-6, 'product ' + product);
    const total = ['casts', 'dmg', 'crit', 'residual'].reduce((s, k) => s + g.factors[k].share, 0);
    assert.ok(Math.abs(total - 100) <= 1, 'shares sum ' + total);
    ['casts', 'dmg', 'crit'].forEach(k => assert.ok(Math.abs(sumShares(g.factors[k].inputs) - g.factors[k].share) <= 1, k + ' inputs ' + sumShares(g.factors[k].inputs) + ' vs ' + g.factors[k].share));
    assert.strictEqual(g.factors.casts.inputs.find(i => i.key === 'own_activity').share, 20, 'ln((85/85)/(60/70)) / ln 2.2');
    assert.ok(Math.abs(g.factors.casts.value - 24 / 17) < 1e-9);
    assert.ok(Math.abs(g.factors.dmg.value - (4000 / 1.46) / (2900 / 1.32)) < 1e-9, 'damage per cast normalised by the crit multiplier on each side');
    assert.ok(Math.abs(g.factors.crit.value - 1.46 / 1.32) < 1e-9, 'Ruin doubles crits');
});
test('explainGap: input owners and the meaning of each input', () => {
    const g = G.explainGap(pull(), PLAYER);
    const by = f => Object.fromEntries(g.factors[f].inputs.map(i => [i.key, i]));
    const c = by('casts');
    assert.deepStrictEqual(Object.keys(c), ['raid_activity', 'own_activity', 'channel_time', 'cast_pacing']);
    assert.strictEqual(c.raid_activity.owner, 'raid'); assert.strictEqual(c.own_activity.owner, 'player');
    assert.deepStrictEqual([c.raid_activity.me, c.raid_activity.reference], [70, 85]);
    assert.deepStrictEqual([c.own_activity.me, c.own_activity.reference], [60, 85]);
    assert.deepStrictEqual([c.channel_time.me, c.channel_time.reference, c.channel_time.unit], [6, 0, 'seconds a minute channelling']);
    const d = by('dmg');
    assert.deepStrictEqual(Object.keys(d), ['hit_under_cap', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs', 'rotation']);
    assert.strictEqual(d.debuffs.owner, 'group'); assert.strictEqual(d.power_buffs.owner, 'group'); assert.strictEqual(d.power_gear.owner, 'player');
    assert.deepStrictEqual([d.power_gear.me, d.power_gear.reference], [846, 1004]);
    assert.deepStrictEqual([d.power_consumables.me, d.power_consumables.reference], [0, 103]);
    assert.deepStrictEqual([d.power_buffs.me, d.power_buffs.reference], [0, 141]);
    assert.deepStrictEqual([d.hit_under_cap.me, d.hit_under_cap.reference], [181, 202]);
    assert.ok(d.hit_under_cap.share >= 1 && d.hit_under_cap.share <= 3, '21 rating under the cap is a 1.7% miss chance: ' + d.hit_under_cap.share);
    assert.ok(d.debuffs.share >= 10 && d.debuffs.share <= 14, 'Shadow Weaving missing is a 1.10 multiplier: ' + d.debuffs.share);
    assert.ok(d.power_gear.share > 0 && d.power_consumables.share > 0 && d.power_buffs.share > 0, 'all three power sources are behind');
    assert.ok(d.rotation.share >= 0 && d.rotation.share <= 2, 'power explains the rest of the per-cast gap here: ' + d.rotation.share);
    const k = by('crit');
    assert.deepStrictEqual(Object.keys(k), ['crit_gear', 'crit_buffs', 'crit_luck']);
    assert.strictEqual(k.crit_luck.owner, 'noise');
    assert.ok(k.crit_gear.share >= 0 && k.crit_buffs.share >= 0, 'both sides of the expectation move up: gear ' + k.crit_gear.share + ' buffs ' + k.crit_buffs.share);
    assert.ok(k.crit_luck.share > k.crit_gear.share + k.crit_buffs.share, 'expected 32.1 vs 36.5 against measured 32 vs 46: luck carries most of the crit gap: luck ' + k.crit_luck.share);
});
test('explainGap: no accounting without a gap, a reference, or the measurements; missing stats leave power on rotation', () => {
    assert.strictEqual(G.explainGap(pull({ reference: null }), PLAYER), null);
    assert.strictEqual(G.explainGap(pull({ me: Object.assign({}, pull().me, { amount: 2500 }) }), PLAYER), null, 'above the reference');
    assert.strictEqual(G.explainGap(pull({ me: Object.assign({}, pull().me, { damagingCastsPerMinute: null }) }), PLAYER), null);
    const p = pull(); p.me = Object.assign({}, p.me, { stats: null }); p.reference = Object.assign({}, p.reference, { stats: null });
    const g = G.explainGap(p, PLAYER);
    const d = Object.fromEntries(g.factors.dmg.inputs.map(i => [i.key, i]));
    assert.strictEqual(d.power_gear.share, 0); assert.strictEqual(d.hit_under_cap.share, 0);
    assert.ok(d.rotation.share > 0);
    assert.strictEqual(g.factors.crit.inputs.find(i => i.key === 'crit_luck').share, g.factors.crit.share, 'no stats: the whole crit factor is unexplained');
});
test('explainGap: a raid at the reference raid median with the player at his raid median puts nothing on activity', () => {
    const p = pull(); p.fight = Object.assign({}, p.fight, { raidActivePercent: 85 }); p.me = Object.assign({}, p.me, { activePercent: 85 });
    const g = G.explainGap(p, PLAYER);
    const c = Object.fromEntries(g.factors.casts.inputs.map(i => [i.key, i]));
    assert.strictEqual(c.raid_activity.share, 0); assert.strictEqual(c.own_activity.share, 0);
    assert.ok(c.channel_time.share > 0 && c.cast_pacing.share > 0);
});
test('averageGap: mean factor shares over pulls with an accounting; null when none', () => {
    const a = G.explainGap(pull(), PLAYER), b = G.explainGap(pull({ me: Object.assign({}, pull().me, { critRate: 46 }) }), PLAYER);
    const avg = G.averageGap([{ gap: a }, { gap: b }, { gap: null }]);
    assert.strictEqual(avg.crit, Math.round((a.factors.crit.share + b.factors.crit.share) / 2));
    assert.strictEqual(avg.casts, Math.round((a.factors.casts.share + b.factors.casts.share) / 2));
    assert.strictEqual(G.averageGap([{ gap: null }]), null);
});
test('explainGap (Important 1): an unknown debuff table on either side puts nothing on debuffs, not a fabricated share', () => {
    const g1 = G.explainGap(pull({ debuffs: { known: false, present: [] } }), PLAYER);
    const d1 = Object.fromEntries(g1.factors.dmg.inputs.map(i => [i.key, i]));
    assert.strictEqual(d1.debuffs.share, 0);
    assert.ok(Math.abs(sumShares(g1.factors.dmg.inputs) - g1.factors.dmg.share) <= 1, 'dmg inputs ' + sumShares(g1.factors.dmg.inputs) + ' vs ' + g1.factors.dmg.share);
    const g2 = G.explainGap(pull({ reference: Object.assign({}, pull().reference, { debuffs: null }) }), PLAYER);
    const d2 = Object.fromEntries(g2.factors.dmg.inputs.map(i => [i.key, i]));
    assert.strictEqual(d2.debuffs.share, 0);
});
test('explainGap (Important 2): a ratio that rounds down to exactly 1 returns null, not an all-zero accounting', () => {
    assert.strictEqual(G.explainGap(pull({ me: Object.assign({}, pull().me, { amount: 2199.9 }) }), PLAYER), null, '2200 / 2199.9 rounds to 1.000');
});
test('explainGap (controller ruling): the ratio is measured against playersDps, the same players the factors come from, not the wider reference.dps', () => {
    const p = pull({ reference: Object.assign({}, pull().reference, { playersDps: 2400, dps: 2200 }) });
    const g = G.explainGap(p, PLAYER);
    assert.strictEqual(g.ratio, 2.4, 'me.amount is 1000: 2400 / 1000, not 2200 / 1000');
});
test('explainGap (controller ruling round 2): a pull whose numbers are internally consistent (DPS = casts/min x damage per cast / 60, both sides) leaves nothing on residual', () => {
    // damagePerDamagingCast already has crit damage baked in (it is total damage over casts); if
    // the crit factor were applied on top of that unnormalised number, the factors would multiply
    // out past the ratio and residual would come out sharply negative (the fixture measured -43%
    // before this fix). Here casts/min x damage-per-cast/60 reproduces amount/dps exactly on both
    // sides, so a correct accounting has nothing left over for residual to explain.
    const me = Object.assign({}, pull().me, { amount: 17 * 2900 / 60, damagingCastsPerMinute: 17, damagePerDamagingCast: 2900, critRate: 32 });
    const reference = Object.assign({}, pull().reference, { playersDps: 24 * 4000 / 60, dps: 24 * 4000 / 60, damagingCastsPerMinute: 24, damagePerDamagingCast: 4000, critRate: 46 });
    const g = G.explainGap(pull({ me, reference }), PLAYER);
    // residual.share can come back as -0 (Math.round of a very small negative log): 0 either way.
    assert.strictEqual(Math.abs(g.factors.residual.share), 0);
    // explainGap rounds `ratio` to 3 decimals before dividing it back out (Task 3: so the >1 gate,
    // G and residual all agree on the same number) — that rounding, not the fix, is the only source
    // of the tiny remaining gap from exactly 1 here; 1e-3 comfortably covers its worst case (~2.6e-4
    // relative at this ratio) while still proving residual is not the ~13% multiplicative miss the
    // pre-fix double-counted-crit accounting produced.
    assert.ok(Math.abs(g.factors.residual.value - 1) < 1e-3, 'residual value ' + g.factors.residual.value);
});

test('gapFindings: one finding per input at or above minShare, with owner, share, numbers and a sentence; luck never becomes a finding', () => {
    const g = G.explainGap(pull(), PLAYER);
    const f = G.gapFindings(Object.assign(pull(), { gap: g }), PLAYER, { minShare: 3 });
    assert.ok(f.every(x => x.share >= 3 && ['player', 'group', 'raid'].includes(x.owner) && typeof x.text === 'string' && x.text.length > 20));
    assert.ok(!f.some(x => x.key === 'crit_luck'));
    const keys = f.map(x => x.key);
    ['raid_activity', 'own_activity', 'channel_time', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs'].forEach(k => assert.ok(keys.includes(k), k + ' in ' + keys.join()));
    assert.ok(!keys.includes('cast_pacing'), 'pacing is negative on this pull (the reference casts slower while active once activity and channelling are taken out)');
    const ch = f.find(x => x.key === 'channel_time');
    assert.strictEqual(ch.text, 'Channelling Drain Soul and other utility 6 seconds of every minute on Morogrim Tidewalker; comparable players 0. Worth ' + ch.share + '% of the gap');
    const ra = f.find(x => x.key === 'raid_activity');
    assert.strictEqual(ra.owner, 'raid');
    assert.ok(/raid was active 70% of Morogrim Tidewalker against 85% for the reference raid/.test(ra.text), ra.text);
    const pb = f.find(x => x.key === 'power_buffs');
    assert.ok(/141 spell power from party buffs .* you had 0/.test(pb.text), pb.text);
    assert.ok(f.every((x, i) => i === 0 || f[i - 1].share >= x.share), 'ordered by share');
});
test('statPriorityFindings: hit under the cap hides the stats below it; at the cap, the next stat under its bar shows', () => {
    const me = { spellHit: 181, spellDamage: 846, spellCrit: 253, spellHaste: 0 }, ref = { spellHit: 202, spellDamage: 1004, spellCrit: 306, spellHaste: 80 };
    const under = G.statPriorityFindings({ me, reference: ref, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'Morogrim Tidewalker' });
    assert.deepStrictEqual(under.map(f => f.stat), ['spellHit'], 'only hit while hit is under the cap');
    assert.strictEqual(under[0].text, 'Hit rating 181 against the 202 the raid asks for; get hit to the cap before any other stat');
    const capped = G.statPriorityFindings({ me: Object.assign({}, me, { spellHit: 205 }), reference: ref, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'Morogrim Tidewalker' });
    assert.deepStrictEqual(capped.map(f => f.stat), ['spellDamage', 'spellCrit', 'spellHaste'], 'every stat under its bar, in priority order');
    assert.strictEqual(capped[0].text, 'Spell power from gear 846 against 1004 for players at your item level among the top 2000 parses');
    assert.deepStrictEqual(G.statPriorityFindings({ me, reference: null, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'X' }), []);
});
test('statPriorityFindings (final review item 2): a stat line carries share null, never a literal 0% of the gap', () => {
    const me = { spellHit: 205, spellDamage: 846, spellCrit: 253, spellHaste: 0 }, ref = { spellHit: 202, spellDamage: 1004, spellCrit: 306, spellHaste: 80 };
    const out = G.statPriorityFindings({ me, reference: ref, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'Morogrim Tidewalker' });
    assert.ok(out.length >= 1);
    out.forEach(f => assert.strictEqual(f.share, null, f.stat + ' must carry no share, not 0'));
});
test('share (final review item 11): a tiny negative log rounds to a plain 0, never -0', () => {
    assert.ok(Object.is(G.share(-1e-9, 1), 0), 'Math.round of a tiny negative is -0 without the || 0');
    assert.strictEqual(G.share(0, 1), 0);
    assert.strictEqual(G.share(Math.log(2), Math.log(2)), 100);
});
test('statPriorityFindings (final review item 11): without a hitCap the bar is the raid cap in rating, not the reference gear', () => {
    const caster = G.statPriorityFindings({ me: { spellHit: 69, spellDamage: 846 }, reference: { spellHit: 100, spellDamage: 1004 }, spec: 'Destruction', role: 'caster', hitCap: null, boss: 'Anetheron' });
    assert.strictEqual(caster[0].stat, 'spellHit');
    assert.ok(/against the 202 the raid asks for/.test(caster[0].text), caster[0].text);
    assert.strictEqual(caster[0].reference, 202);
    const melee = G.statPriorityFindings({ me: { meleeHit: 50, attackPower: 1000 }, reference: { meleeHit: 100, attackPower: 2000 }, spec: 'Combat', role: 'melee', boss: 'Gruul' });
    assert.ok(/against the 142 the raid asks for/.test(melee[0].text), melee[0].text);
});
test('FINDING_ANCHOR (fix round 2): every key gapFindings can emit has an anchor phrase that is actually in its own text', () => {
    const KEYS = ['raid_activity', 'own_activity', 'channel_time', 'cast_pacing', 'hit_under_cap', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs', 'rotation', 'crit_gear', 'crit_buffs'];
    KEYS.forEach(k => assert.ok(k in G.FINDING_ANCHOR, k + ' has no anchor'));
    // gapText isn't exported, so drive every key through the real, exported gapFindings entry
    // point instead (a hand-built gap with one input per key, all above minShare) rather than
    // relying only on whichever keys the pull() fixture happens to produce.
    const mk = (key, me, reference) => ({ key, owner: 'player', share: 20, me, reference });
    const gap = { factors: {
        casts: { inputs: [mk('raid_activity', 70, 92), mk('own_activity', 85, 92), mk('channel_time', 6, 0), mk('cast_pacing', 25, 30)] },
        dmg: { inputs: [mk('hit_under_cap', 250, 300), mk('debuffs', 1.1, 1.15), mk('power_gear', 800, 1000), mk('power_consumables', 50, 103), mk('power_buffs', 40, 60), mk('rotation', 500, 600)] },
        crit: { inputs: [mk('crit_gear', 10, 20), mk('crit_buffs', 5, 7)] },
    } };
    const findings = G.gapFindings({ name: 'TestBoss', gap }, { role: 'caster' }, { minShare: 3 });
    assert.strictEqual(findings.length, KEYS.length, 'every key produced a finding: ' + findings.map(f => f.key).join());
    findings.forEach(f => {
        const anchor = G.FINDING_ANCHOR[f.key];
        assert.ok(f.text.toLowerCase().includes(anchor.toLowerCase()), f.key + ': anchor "' + anchor + '" not in "' + f.text + '"');
    });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
