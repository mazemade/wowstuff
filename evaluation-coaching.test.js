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

test('withheld pricing labels every cause and old reports without a budget keep the current shape', () => {
    const fight = { name: 'A', durationSec: 100, budget: { status: 'decomposed', gapDps: 100, player: { dps: 1000 }, reference: { dps: 1100 }, buckets: [], limitations: [] }, causes: [{ id: 'stat-hit', bucket: 'all', owner: 'you', title: 't', observation: 'o', action: 'a', evidence: [], sim: {} }], pricing: { status: 'withheld', reason: 'The model baseline (666 DPS) cannot reproduce the observed 1815 DPS; enter your talents in Model settings to price gear and buffs.', prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    assert.match(c.buckets[0].items[0].size.label, /not sized: The model baseline/);
    const legacy = buildFightCoaching({ name: 'B', findings: [{ id: 'x', title: 'X', disposition: 'improve', action: 'a', evidence: ['e'] }] });
    assert.equal(legacy.buckets, undefined); assert.equal(legacy.improvements.length, 1);
    const night = buildNightCoaching({ fights: [{ name: 'A', coaching: c }, { name: 'B', coaching: legacy }] });
    assert.equal(night.topSized.length, 0, 'unsized items never reach the night top list');
});
