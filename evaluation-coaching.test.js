'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFightCoaching, buildNightCoaching } = require('./evaluation-coaching');

test('modeled options retain their proof without contradictory duplicate coaching reviews', () => {
    const fight = { findings: [{ id: 'boots-enchant', title: 'Boots have no enchant', evidence: ['The slot was recorded.'] }], simulation: { status: 'complete', actions: [{ id: 'boots', title: 'Enchant boots', gainDps: 5 }] } };
    assert.deepEqual(buildFightCoaching(fight).reviews, []);
    fight.simulation.status = 'unavailable';
    assert.equal(buildFightCoaching(fight).reviews.length, 1, 'unavailable estimates must not hide evidence');
});

test('coaching preserves explicit dispositions and turns legacy findings into review', () => {
    const coaching = buildFightCoaching({ name: 'Teron', findings: [
        { id: 'late', title: 'Cooldown was late', disposition: 'improve', category: 'execution', priority: 'high', action: 'Use it on pull.', why: 'The cast occurred after the recorded window.', verification: 'Compare the next pull.', alternatives: ['Movement may have prevented an earlier cast.'], evidence: [{ text: 'Cast at 0:32.', startSec: 32 }] },
        { id: 'good', title: 'Interrupt landed', disposition: 'keep', evidence: [{ text: 'Kick completed.' }] },
        { id: 'old', title: 'Legacy observation', action: 'Check it.' }
    ], coverage: { depth: { status: 'partial', reviewed: ['interrupts'], unresolved: ['movement route'] } } });
    assert.equal(coaching.improvements[0].what, 'Cooldown was late');
    assert.equal(coaching.keeps[0].what, 'Interrupt landed');
    assert.equal(coaching.reviews[0].what, 'Legacy observation');
    assert.equal(coaching.keeps[0].basis, null, 'good play must not be labelled a correction');
    assert.equal(coaching.reviews[0].basis, null, 'unresolved observations must not be labelled corrections');
    assert.match(coaching.reviews[0].why, /does not establish/i);
    assert.deepEqual(coaching.depth.unresolved, ['movement route']);
});

test('night coaching is deterministic and does not manufacture estimates', () => {
    const result = { fights: [{ name: 'A', findings: [{ id: 'cooldown', title: 'Use cooldown in contact', disposition: 'improve', priority: 'medium', action: 'Use it on contact.', evidence: [{ text: 'Late cast.' }] }, { title: 'Keep clean dispels', disposition: 'keep' }] }, { name: 'B', findings: [{ id: 'cooldown', title: 'Use cooldown in contact', disposition: 'improve', priority: 'high', action: 'Use it on contact.', evidence: [{ text: 'Late cast.' }] }, { title: 'Review target switches', action: 'Inspect targets.' }] }] };
    const night = buildNightCoaching(result);
    assert.match(night.assessment, /Use cooldown in contact on A, B/);
    assert.equal(night.topChanges[0].priority, 'high'); assert.deepEqual(night.topChanges[0].bosses, ['A', 'B']);
    assert.equal(night.keeps.length, 1); assert.equal(night.reviews.length, 1);
    assert.equal(JSON.stringify(night).includes('DPS'), false);
});

test('an incomplete improvement is held for review', () => {
    const coaching = buildFightCoaching({ findings: [{ title: 'Missing proof', disposition: 'improve', action: 'Do something.' }, { title: 'Missing action', disposition: 'improve', evidence: [{ text: 'Observed.' }] }] });
    assert.equal(coaching.improvements.length, 0); assert.equal(coaching.reviews.length, 2);
});

test('buckets carry causes and findings sorted by size, with the whole-pull bucket first', () => {
    const fight = { name: 'Winterchill', durationSec: 141.4,
        budget: { status: 'decomposed', gapDps: 268, headline: null, player: { name: 'Utopik', dps: 1546 }, reference: { name: 'Jofrey', dps: 1815 }, limitations: ['These values overlap and do not add up to the gap.'], residualDps: 0,
            buckets: [{ id: 'melee', name: 'Melee', attack: 'melee-white', playerDps: 874, referenceDps: 1057, differenceDps: 183, factors: {}, assumptions: [] }, { id: 'rupture', name: 'Rupture', attack: 'periodic', playerDps: 57, referenceDps: 60, differenceDps: 3, factors: null, assumptions: [] }] },
        causes: [
            { id: 'stat-expertise', bucket: 'melee', factor: 'zeroDamage', kind: 'gear', owner: 'you', title: 'Close the expertise gap', observation: 'o', action: 'a', evidence: [], sim: { bonusStats: { 24: 21 } } },
            { id: 'luck-melee-miss', bucket: 'melee', factor: 'zeroDamage', kind: 'luck', owner: 'luck', title: 'Misses differ', observation: 'o', action: 'none', evidence: [] },
            { id: 'aura-flask', bucket: 'all', factor: 'perHit', kind: 'consumable', owner: 'you', title: 'Flask', observation: 'o', action: 'a', evidence: [], sim: {} },
            { id: 'uptime-30807', bucket: 'all', factor: 'perHit', kind: 'raid-buff', owner: 'raid', title: 'Unleashed Rage', observation: 'o', action: 'a', evidence: [], sim: {} }],
        pricing: { status: 'priced', rotation: 'unvalidated', prices: { 'stat-expertise': { dps: 18 }, 'aura-flask': { dps: 31 }, 'uptime-30807': { dps: 45 } } },
        findings: [{ id: 'rogue-snd-midfight-gap', title: 'SnD gap', disposition: 'improve', action: 'Refresh', evidence: [{ text: 'gap' }], bucket: 'melee', measure: { lostSeconds: 3.5, activeRateDps: 262 } },
                   { id: 'survived-kill', title: 'Survived', disposition: 'keep', evidence: [{ text: 'x' }] }] };
    const c = buildFightCoaching(fight);
    assert.deepEqual(c.buckets.map(b => b.id), ['all', 'melee']);
    assert.deepEqual(c.buckets[0].items.map(i => i.id), ['uptime-30807', 'aura-flask']);
    assert.equal(c.buckets[0].items[0].size.kind, 'priced'); assert.match(c.buckets[0].items[0].size.label, /45 DPS.*unvalidated/);
    assert.deepEqual(c.buckets[1].items.map(i => i.id), ['stat-expertise', 'rogue-snd-midfight-gap', 'luck-melee-miss']);
    assert.equal(c.buckets[1].items[1].size.kind, 'bound'); assert.equal(Math.round(c.buckets[1].items[1].size.dps), 7);
    assert.equal(c.buckets[1].items[2].size.kind, 'variance');
    assert.equal(c.buckets[1].note, 'These values overlap and do not add up to the gap.');
    assert.equal(c.sized[0].id, 'uptime-30807');
    assert.match(c.assessment, /1546.*1815/s); assert.match(c.assessment, /Unleashed Rage/);
    assert.equal(c.improvements.length, 1, 'legacy lists still exist');
});

test('coaching buckets omit the heavy outcomes payload but keep factors and assumptions', () => {
    const fight = { name: 'A', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 100, player: { dps: 1000 }, reference: { dps: 1100 }, limitations: [], residualDps: 0,
            buckets: [{ id: 'melee', name: 'Melee', attack: 'melee-white', playerDps: 900, referenceDps: 1000, differenceDps: 100, factors: { zeroDamage: 1 }, assumptions: ['a'], outcomes: { player: {}, reference: {} } }] },
        causes: [], findings: [] };
    const c = buildFightCoaching(fight);
    const melee = c.buckets.find(b => b.id === 'melee');
    assert.equal(melee.outcomes, undefined, 'outcomes should not be copied into coaching buckets');
    assert.deepEqual(melee.factors, { zeroDamage: 1 });
    assert.deepEqual(melee.assumptions, ['a']);
});

test('withheld pricing labels every cause and old reports without a budget keep the current shape', () => {
    const fight = { name: 'A', durationSec: 100, budget: { status: 'decomposed', gapDps: 100, player: { dps: 1000 }, reference: { dps: 1100 }, buckets: [], limitations: [] }, causes: [{ id: 'stat-hit', bucket: 'all', owner: 'you', title: 't', observation: 'o', action: 'a', evidence: [], sim: {} }], pricing: { status: 'withheld', reason: "The model lands well below both your observed 1000 DPS and Jofrey's 1100 DPS, so gear and buff prices are withheld; enter your talents in Model settings to price them.", prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    assert.match(c.buckets[0].items[0].size.label, /not sized: The model lands well below/);
    const legacy = buildFightCoaching({ name: 'B', findings: [{ id: 'x', title: 'X', disposition: 'improve', action: 'a', evidence: ['e'] }] });
    assert.equal(legacy.buckets, undefined); assert.equal(legacy.improvements.length, 1);
    const night = buildNightCoaching({ fights: [{ name: 'A', coaching: c }, { name: 'B', coaching: legacy }] });
    assert.equal(night.topSized.length, 0, 'unsized items never reach the night top list');
});

test('the tested-options suffix still appears on a bucketed fight assessment', () => {
    const fight = { name: 'Sized', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 20, player: { dps: 500 }, reference: { dps: 520 }, buckets: [], limitations: [] },
        causes: [], pricing: { status: 'unavailable', prices: {} }, findings: [],
        simulation: { status: 'complete', actions: [{ id: 'boots', title: 'Enchant boots', gainDps: 5 }] } };
    const c = buildFightCoaching(fight);
    assert.equal(c.improvements.length, 0);
    assert.match(c.assessment, /1 separately modeled option is available below/);
});

test('a priced cause with a negative price is labelled no measurable gain and sorts between a bound item and variance', () => {
    const fight = { name: 'Neg', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 50, player: { dps: 500 }, reference: { dps: 550 }, buckets: [{ id: 'melee', name: 'Melee', differenceDps: 50 }], limitations: [] },
        causes: [
            { id: 'neg-cause', bucket: 'melee', owner: 'you', title: 'Negative thing', evidence: [] },
            { id: 'luck-cause', bucket: 'melee', owner: 'luck', title: 'Luck thing', evidence: [] },
        ],
        pricing: { status: 'priced', rotation: 'validated', prices: { 'neg-cause': { dps: -3 } } },
        findings: [{ id: 'bound-finding', title: 'Gap', disposition: 'improve', action: 'Fix', evidence: [{ text: 'x' }], bucket: 'melee', measure: { lostSeconds: 5, activeRateDps: 100 } }] };
    const c = buildFightCoaching(fight);
    const melee = c.buckets.find((b) => b.id === 'melee');
    assert.deepEqual(melee.items.map((i) => i.id), ['bound-finding', 'neg-cause', 'luck-cause']);
    assert.equal(melee.items[1].size.label, 'no measurable gain in the model');
});

test('budget.pricing.baselineDps is present only when the rotation is validated', () => {
    const base = { name: 'Base', durationSec: 100, budget: { status: 'decomposed', gapDps: 10, player: { dps: 100 }, reference: { dps: 110 }, buckets: [], limitations: [] }, causes: [], findings: [] };
    const validated = buildFightCoaching({ ...base, pricing: { status: 'priced', rotation: 'validated', baselineDps: 999, prices: {} } });
    const unvalidated = buildFightCoaching({ ...base, pricing: { status: 'priced', rotation: 'unvalidated', baselineDps: 999, prices: {} } });
    assert.equal(validated.budget.pricing.baselineDps, 999);
    assert.equal(unvalidated.budget.pricing.baselineDps, undefined);
});

test('night bossLines topBucket names the bucket with the largest absolute difference, excluding whole-pull and execution', () => {
    const fight = { name: 'Bucketed', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 60, player: { dps: 900 }, reference: { dps: 960 },
            buckets: [{ id: 'melee', name: 'Melee', differenceDps: 40 }, { id: 'rupture', name: 'Rupture', differenceDps: -55 }], limitations: [] },
        causes: [{ id: 'melee-cause', bucket: 'melee', owner: 'you', title: 'Melee thing', evidence: [] }, { id: 'rupture-cause', bucket: 'rupture', owner: 'you', title: 'Rupture thing', evidence: [] }],
        pricing: { status: 'unavailable', prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    const night = buildNightCoaching({ fights: [{ name: 'Bucketed', coaching: c }] });
    assert.equal(night.bossLines[0].topBucket, 'Rupture');
});

test('a zero-priced cause does not become the sized headline or reach the night top list', () => {
    const fight = { name: 'Zero', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 20, player: { dps: 500 }, reference: { dps: 520 }, buckets: [], limitations: [] },
        causes: [{ id: 'zero-cause', bucket: 'all', owner: 'you', title: 'Zero gain', evidence: [] }],
        pricing: { status: 'priced', rotation: 'validated', prices: { 'zero-cause': { dps: 0 } } }, findings: [] };
    const c = buildFightCoaching(fight);
    assert.match(c.assessment, /No cause could be sized/);
    const night = buildNightCoaching({ fights: [{ name: 'Zero', coaching: c }] });
    assert.equal(night.topSized.length, 0);
});

test('a cause whose bucket is duplicated in alsoBuckets is not double counted', () => {
    const fight = { name: 'Dup', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 50, player: { dps: 500 }, reference: { dps: 550 }, buckets: [{ id: 'melee', name: 'Melee', differenceDps: 50 }], limitations: [] },
        causes: [{ id: 'dup-cause', bucket: 'melee', alsoBuckets: ['melee'], owner: 'you', title: 'Dup', evidence: [] }],
        pricing: { status: 'unavailable', prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    const melee = c.buckets.find((b) => b.id === 'melee');
    assert.equal(melee.items.filter((i) => i.id === 'dup-cause').length, 1);
});

test('topSized dedupes repeated boss names when the same encounter recurs across pulls', () => {
    const mkFight = (dps) => ({ name: 'Repeat', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 50, player: { dps: 500 }, reference: { dps: 550 }, buckets: [], limitations: [] },
        causes: [{ id: 'stat-x', bucket: 'all', owner: 'you', title: 'Stat X', evidence: [] }],
        pricing: { status: 'priced', rotation: 'validated', prices: { 'stat-x': { dps } } }, findings: [] });
    const cA = buildFightCoaching(mkFight(10));
    const cB = buildFightCoaching(mkFight(20));
    const night = buildNightCoaching({ fights: [{ name: 'Repeat', coaching: cA }, { name: 'Repeat', coaching: cB }] });
    assert.deepEqual(night.topSized[0].bosses, ['Repeat']);
});

test('a missing reference name falls back to "the reference" in the assessment', () => {
    const fight = { name: 'NoRefName', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 20, player: { dps: 500 }, reference: { dps: 520 }, buckets: [], limitations: [] },
        causes: [], pricing: { status: 'unavailable', prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    assert.match(c.assessment, /the reference's 520/);
    assert.equal(/undefined/.test(c.assessment), false);
});

test('an unsized finding always carries an explicit dps: null on its size, matching the unsized cause shape', () => {
    const fight = { name: 'ExplicitNull', durationSec: 100,
        budget: { status: 'decomposed', gapDps: 20, player: { dps: 500 }, reference: { dps: 520 }, buckets: [{ id: 'melee', name: 'Melee', differenceDps: 20 }], limitations: [] },
        causes: [], pricing: { status: 'unavailable', prices: {} },
        findings: [{ id: 'zero-measure', title: 'No time lost', disposition: 'improve', action: 'a', evidence: [{ text: 'x' }], bucket: 'melee', measure: { lostSeconds: 0, activeRateDps: 100 } }] };
    const c = buildFightCoaching(fight);
    const item = c.buckets.find((b) => b.id === 'melee').items.find((i) => i.id === 'zero-measure');
    assert.equal(item.size.kind, 'unsized');
    assert.equal(item.size.dps, null);
    assert.ok('dps' in item.size);
});
