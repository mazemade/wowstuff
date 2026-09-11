'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeBudget } = require('./evaluation-budget');
const recorded = require('./fixtures/evaluation/utopik-investigation.json');
const winterchill = () => structuredClone(recorded.fights.find(f => f.name === 'Rage Winterchill'));

test('Utopik on Winterchill: melee bucket carries the four factors from the recorded outcome table', () => {
    const budget = analyzeBudget(winterchill());
    assert.equal(budget.status, 'decomposed');
    assert.equal(budget.reference.name, 'Jofrey');
    assert.equal(Math.round(budget.gapDps), 269); // real capture: 218555/141.355=1546.14 vs 231599/127.625=1814.68, gap 268.54 rounds to 269 (brief's worked example said 268)
    const melee = budget.buckets.find(b => b.id === 'melee');
    assert.equal(melee.attack, 'melee-white');
    assert.equal(melee.outcomes.player.outcomes, 226); assert.equal(melee.outcomes.reference.outcomes, 216);
    assert.equal(melee.outcomes.player.zero.dodge, 15); assert.equal(melee.outcomes.reference.zero.dodge, 6);
    assert.equal(melee.outcomes.player.zero.miss, 13); assert.equal(melee.outcomes.player.zero.total, 30);
    assert.equal(melee.outcomes.player.landed.glance.count, 52);
    assert.equal(Math.round(melee.factors.zeroDamage.expected.player.dodge.min * 10) / 10, 14.7);
    assert.equal(Math.round(melee.factors.zeroDamage.expected.reference.dodge.min * 10) / 10, 11.3);
    assert.equal(melee.factors.zeroDamage.variance.dodge.player.within, true);
    assert.equal(melee.factors.zeroDamage.variance.dodge.reference.within, true, '6 against 11.3 is luck, not a stat');
    const sum = melee.factors.rate.dps + melee.factors.zeroDamage.dps + melee.factors.yield.dps;
    assert.ok(Math.abs(sum - melee.differenceDps) < 0.6, 'factors reconstruct the bucket difference');
    assert.ok(Math.abs(melee.factors.yield.crit.dps + melee.factors.yield.perHit.dps - melee.factors.yield.dps) < 0.6);
    assert.ok(melee.assumptions.some(a => /Precision/.test(a)));
    assert.equal(budget.buckets.find(b => b.id === 'deadly poison vii').factors, null, 'periodic families are not decomposed'); // family() keys on the recorded ability name, "Deadly Poison VII"
});

test('missing reference or hit details degrade to unavailable without inventing counts', () => {
    const raw = winterchill(); raw.references = [];
    assert.equal(analyzeBudget(raw).status, 'unavailable');
    const noDetails = winterchill(); for (const row of noDetails.tables.dmg.data.entries) delete row.hitdetails;
    const budget = analyzeBudget(noDetails);
    assert.equal(budget.status, 'decomposed');
    assert.equal(budget.buckets.find(b => b.id === 'melee').factors, null);
    assert.ok(budget.limitations.some(l => /hit details/.test(l)));
});

test('equal DPS with more stats produces the execution headline', () => {
    const anetheron = structuredClone(recorded.fights.find(f => f.name === 'Anetheron'));
    const budget = analyzeBudget(anetheron);
    assert.match(budget.headline, /matched .* DPS with more stats/);
});
