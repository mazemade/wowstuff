'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./evaluation-mechanics');

test('constants are pinned to the wowsims level-73 attack table', () => {
    assert.equal(M.RATING.physicalHitPerPercent, 15.769233);
    assert.equal(M.RATING.expertisePerQuarterPercent, 3.942308);
    assert.equal(M.BOSS.dodge, 0.065); assert.equal(M.BOSS.parry, 0.14); assert.equal(M.BOSS.glance, 0.24);
    assert.equal(M.BOSS.meleeMiss, 0.08); assert.equal(M.BOSS.dualWieldPenalty, 0.19); assert.equal(M.BOSS.spellMiss, 0.17);
    assert.equal(M.BOSS.hitSuppression, 0.01); assert.equal(M.BOSS.meleeCritSuppression, 0.048);
    assert.equal(M.CRIT_PERCENT_PER_AGILITY.ROGUE, 0.025); assert.equal(M.ATTACK_POWER_PER_STRENGTH.WARRIOR, 2);
    assert.match(M.SOURCE_COMMIT, /^72e0c8a8/);
});

test('Utopik on Winterchill: 226 dual-wield white swings at 272 hit and 0 expertise expect 14.7 dodges and 13 to 24.3 misses', () => {
    const out = M.expectedOutcomes({ attack: 'melee-white', swings: 226, hitRating: 272, expertiseRating: 0, classToken: 'ROGUE' });
    assert.equal(Math.round(out.expected.dodge.min * 10) / 10, 14.7);
    assert.equal(Math.round(out.expected.dodge.max * 10) / 10, 14.7);
    assert.equal(Math.round(out.expected.miss.min * 10) / 10, 13);    // with Precision 5/5
    assert.equal(Math.round(out.expected.miss.max * 10) / 10, 24.3);  // without
    assert.equal(out.expected.parry.max, 0, 'behind the target');
    assert.equal(Math.round(out.expected.glance.min * 10) / 10, 54.2);
    assert.ok(out.assumptions.some(a => /Precision/.test(a)));
});

test('21 expertise rating removes 1.25% dodge (floor of 5 points)', () => {
    const out = M.expectedOutcomes({ attack: 'melee-yellow', swings: 216, hitRating: 252, expertiseRating: 21, classToken: 'ROGUE' });
    assert.equal(Math.round(out.rates.dodge.min * 10000) / 10000, 0.0525);
    assert.equal(out.rates.glance.max, 0, 'yellow attacks never glance');
    assert.equal(out.expected.miss.max, 0, '252 hit rating (15.98%) exceeds the 8% base plus 1% suppression; yellow attacks cannot miss');
});

test('ranged attacks can only miss or be blocked; spells only miss', () => {
    const ranged = M.expectedOutcomes({ attack: 'ranged', swings: 100, hitRating: 0, expertiseRating: 0, classToken: 'HUNTER' });
    assert.equal(ranged.rates.dodge.max, 0); assert.equal(ranged.rates.glance.max, 0);
    assert.equal(Math.round(ranged.rates.miss.max * 1000) / 1000, 0.08, 'suppression only applies to hit above zero (spell_result.go:186 clamps at 0)');
    const spell = M.expectedOutcomes({ attack: 'spell', swings: 100, hitRating: 0, expertiseRating: 0, classToken: 'MAGE' });
    assert.equal(Math.round(spell.rates.miss.max * 1000) / 1000, 0.17);
    assert.equal(spell.rates.dodge.max, 0);
    const highHit = M.expectedOutcomes({ attack: 'spell', swings: 100, hitRating: 300, expertiseRating: 0, classToken: 'MAGE' });
    assert.equal(highHit.rates.miss.min, 0.01, 'spell miss floors at 1% (spell_result.go:261 math.Max(0.01, 1-hitChance))');
});

test('variance check uses two binomial standard deviations around the expected range', () => {
    const v = M.varianceCheck(15, { min: 14.7, max: 14.7 }, 226);
    assert.equal(v.within, true);
    const lucky = M.varianceCheck(6, { min: 11.3, max: 11.3 }, 216);
    assert.equal(lucky.within, true, '6 against 11.3 is within 2 sd (sd about 3.3)');
    const far = M.varianceCheck(30, { min: 11.3, max: 11.3 }, 216);
    assert.equal(far.within, false);
});
