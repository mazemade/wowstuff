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

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
