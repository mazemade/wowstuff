'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boundFor, priceCauses, SANITY } = require('./evaluation-pricing');

test('bounds use the observed rate and are capped at the bucket difference', () => {
    const b = boundFor({ measure: { lostSeconds: 115.7, activeRateDps: 440 } }, { differenceDps: 486, durationSec: 231.3 });
    assert.equal(b.kind, 'bound'); assert.equal(Math.round(b.dps), 220); assert.equal(b.capped, false); assert.match(b.label, /up to about 220 DPS on this pull/);
    const capped = boundFor({ measure: { lostSeconds: 200, activeRateDps: 1000 } }, { differenceDps: 150, durationSec: 231.3 });
    assert.equal(capped.dps, 150); assert.equal(capped.capped, true);
    const casts = boundFor({ measure: { lostCasts: 2, averageDamage: 700 } }, { differenceDps: 300, durationSec: 182 });
    assert.equal(Math.round(casts.dps * 10) / 10, 7.7);
    assert.equal(boundFor({}, { differenceDps: 10, durationSec: 100 }).kind, 'unsized');
});

const fakeDeps = (baselineDps, scenarioDps) => {
    const calls = [];
    return { calls, deps: {
        modelFor: () => ({ kind: 'native', model: { id: 'hunter-bm', role: 'DPS', requiresTalentOverride: false } }),
        combatant: () => ({ gear: new Array(19).fill({ id: 0 }), talents: [] }),
        buildBaseline: () => ({ request: { raid: { parties: [{ players: [{ buffs: {}, consumables: {}, equipment: { items: new Array(17).fill(null).map(() => ({ id: 1, enchant: 0, gems: [] })) }, bonusStats: undefined }], buffs: {} }], buffs: {}, debuffs: {} }, simOptions: { iterations: 10000, randomSeed: '1' } } }),
        checkedBinaries: async () => ({ sim: 'fake', stats: 'fake' }),
        simulate: async (request) => { calls.push(request); return { dps: calls.length === 1 ? baselineDps : scenarioDps(request, calls.length - 1), iterations: request.simOptions.iterations }; },
    } };
};
const budget = { status: 'decomposed', gapDps: 268, player: { dps: 1546 }, reference: { dps: 1815 }, buckets: [{ id: 'melee', differenceDps: 183 }] };
const causes = [
    { id: 'stat-expertise', bucket: 'melee', owner: 'you', sim: { bonusStats: { 24: 21 } } },
    { id: 'aura-25898', bucket: 'all', owner: 'raid', sim: { set: [[['raid', 'parties', 0, 'players', 0, 'buffs', 'blessingOfKings'], true]] } },
    { id: 'luck-melee-miss', bucket: 'melee', owner: 'luck', sim: null },
];

test('prices each cause against the same baseline with its change applied, largest bucket first', async () => {
    const { calls, deps } = fakeDeps(1600, (request, index) => 1600 + 10 * index);
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes }, deps);
    assert.equal(result.status, 'priced'); assert.equal(result.rotation, 'validated');
    // Kings is bucket 'all' (gap 268) so it runs before the melee-bucket expertise cause (183).
    assert.equal(result.prices['aura-25898'].dps, 10); assert.equal(result.prices['stat-expertise'].dps, 20);
    assert.equal(result.prices['luck-melee-miss'], undefined);
    assert.equal(calls[1].raid.parties[0].players[0].buffs.blessingOfKings, true);
    assert.equal(calls[1].raid.parties[0].players[0].bonusStats, undefined, 'each scenario starts from a clean clone of the baseline');
    assert.equal(calls[2].raid.parties[0].players[0].bonusStats.stats[24], 21);
    assert.equal(calls[2].raid.parties[0].players[0].buffs.blessingOfKings, undefined);
    assert.equal(calls[1].simOptions.iterations, 3000);
});

test('a baseline sane for either the player or the reference DPS is priced', async () => {
    const { deps } = fakeDeps(1949, (request, index) => 1949 + 10 * index);
    const eitherBudget = { status: 'decomposed', gapDps: 268, player: { dps: 2127 }, reference: { dps: 2965 }, buckets: [{ id: 'melee', differenceDps: 183 }] };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget: eitherBudget, causes }, deps);
    assert.equal(result.status, 'priced');
    assert.equal(result.baselineDps, 1949);
});

test('a baseline far from both observed values withholds every price with an actionable reason', async () => {
    const { deps } = fakeDeps(666, () => 700);
    const result = await priceCauses({ player: { classToken: 'ROGUE', spec: 'Assassination' } }, { budget, causes }, deps);
    assert.equal(result.status, 'withheld'); assert.match(result.reason, /666 DPS/); assert.match(result.reason, /Model settings/);
    assert.deepEqual(result.prices, {});
    assert.ok(666 / 1815 < SANITY.low);
});

test('an unvalidated rotation is labelled but still priced when the baseline is sane', async () => {
    const { deps } = fakeDeps(1500, () => 1530);
    deps.modelFor = () => ({ kind: 'native', model: { id: 'rogue-assassination', role: 'DPS', requiresTalentOverride: true } });
    const result = await priceCauses({ player: { classToken: 'ROGUE', spec: 'Assassination' }, modelOverrides: { talentsString: 'x' } }, { budget, causes }, deps);
    assert.equal(result.status, 'priced'); assert.equal(result.rotation, 'unvalidated');
});

test('simulator failure leaves causes unpriced with the reason', async () => {
    const { deps } = fakeDeps(1600, () => 1600);
    deps.checkedBinaries = async () => { throw new Error('WoWSims runner is not installed'); };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' } }, { budget, causes }, deps);
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /not installed/);
});
