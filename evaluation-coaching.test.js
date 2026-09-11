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
