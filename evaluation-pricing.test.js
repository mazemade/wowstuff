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

test('when the bucket difference is not positive, the cap falls back to playerDps', () => {
    const uncapped = boundFor({ measure: { lostSeconds: 40, activeRateDps: 900 } }, { differenceDps: -120, playerDps: 500, durationSec: 200 });
    assert.equal(Math.round(uncapped.dps), 180); assert.equal(uncapped.capped, false);
    const capped = boundFor({ measure: { lostSeconds: 40, activeRateDps: 900 } }, { differenceDps: -120, playerDps: 100, durationSec: 200 });
    assert.equal(capped.dps, 100); assert.equal(capped.capped, true);
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

const equipConsumableCauses = [
    { id: 'proc-28830', bucket: 'melee', owner: 'you', sim: { equip: { slot: 12, id: 28830 } } },
    { id: 'proc-bad-slot', bucket: 'melee', owner: 'you', sim: { equip: { slot: 99, id: 1 } } },
    { id: 'aura-flask', bucket: 'all', owner: 'you', sim: { consumable: { field: 'flaskId', id: 22854, clear: ['battleElixirId', 'guardianElixirId'] } } },
    { id: 'aura-haste-pot', bucket: 'all', owner: 'you', sim: { consumable: { field: 'potId', id: 22838 } } },
];
const consumablesBaseline = () => ({ request: { raid: { parties: [{ players: [{ buffs: {}, consumables: { battleElixirId: 22831 }, equipment: { items: new Array(17).fill(null).map(() => ({ id: 1, enchant: 0, gems: [] })) }, bonusStats: undefined }], buffs: {} }], buffs: {}, debuffs: {} }, simOptions: { iterations: 10000, randomSeed: '1' } } });

test('applyChange prices a valid equip cause, rejects an invalid slot, and applies consumable changes', async () => {
    const { calls, deps } = fakeDeps(1600, (request, index) => 1600 + 10 * index);
    deps.buildBaseline = consumablesBaseline;
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes: equipConsumableCauses }, deps);
    assert.equal(result.status, 'priced');
    assert.ok(result.prices['proc-28830']);
    assert.equal(result.prices['proc-bad-slot'], undefined);
    assert.ok(result.assumptions.some(a => a.includes('proc-bad-slot') && a.includes('not a valid equipment index')));
    const equipRequest = calls.find(c => c.raid.parties[0].players[0].equipment.items[12]?.id === 28830);
    assert.deepEqual(equipRequest.raid.parties[0].players[0].equipment.items[12], { id: 28830, enchant: 0, gems: [] });
    const flaskRequest = calls.find(c => c.raid.parties[0].players[0].consumables.flaskId === 22854);
    assert.equal(flaskRequest.raid.parties[0].players[0].consumables.battleElixirId, undefined);
    const potRequest = calls.find(c => c.raid.parties[0].players[0].consumables.potId === 22838);
    assert.ok(potRequest.raid.parties[0].players[0].consumables.potions.includes(22838));
});

test('setPath creates a missing intermediate object instead of throwing', async () => {
    const { calls, deps } = fakeDeps(1600, (request, index) => 1600 + 10 * index);
    deps.buildBaseline = () => ({ request: { raid: { parties: [{ players: [{ consumables: {}, equipment: { items: new Array(17).fill(null).map(() => ({ id: 1, enchant: 0, gems: [] })) }, bonusStats: undefined }], buffs: {} }], buffs: {}, debuffs: {} }, simOptions: { iterations: 10000, randomSeed: '1' } } }); // no 'buffs' key on the player
    const cause = { id: 'aura-25898', bucket: 'all', owner: 'raid', sim: { set: [[['raid', 'parties', 0, 'players', 0, 'buffs', 'blessingOfKings'], true]] } };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes: [cause] }, deps);
    assert.equal(result.status, 'priced');
    assert.equal(calls[1].raid.parties[0].players[0].buffs.blessingOfKings, true);
});

test('a throwing combatant lookup yields unavailable without throwing out of priceCauses', async () => {
    const { deps } = fakeDeps(1600, () => 1600);
    deps.combatant = () => { throw new Error('combatant boom'); };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes }, deps);
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /combatant boom/);
});

test('an incomplete combatant equipment snapshot is unavailable', async () => {
    const { deps } = fakeDeps(1600, () => 1600);
    deps.combatant = () => ({ gear: new Array(10).fill({ id: 0 }), talents: [] });
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes }, deps);
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /complete combatant equipment snapshot/);
});

test('a malformed budget bucket list during sizing yields unavailable, never throws', async () => {
    const { deps } = fakeDeps(1600, () => 1600);
    const brokenBudget = { ...budget, buckets: null };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget: brokenBudget, causes }, deps);
    assert.equal(result.status, 'unavailable'); assert.ok(result.reason);
});

test('the sanity gate is satisfied by the reference DPS alone', async () => {
    const { deps } = fakeDeps(1900, () => 1900);
    const refSaneBudget = { status: 'decomposed', gapDps: 268, player: { dps: 900 }, reference: { dps: 1815 }, buckets: [{ id: 'melee', differenceDps: 183 }] };
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget: refSaneBudget, causes }, deps);
    assert.equal(result.status, 'priced');
});

test('at most 12 scenarios run after the baseline, even with 13 sim-bearing causes', async () => {
    const { calls, deps } = fakeDeps(1600, (request, index) => 1600 + index);
    const manyCauses = Array.from({ length: 13 }, (unused, i) => ({ id: 'stat-' + i, bucket: 'melee', owner: 'you', sim: { bonusStats: { [i]: 1 } } }));
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes: manyCauses }, deps);
    assert.equal(result.status, 'priced');
    assert.equal(calls.length, 13);
});

test('a scenario whose simulate throws leaves that cause unpriced, with an assumption, and keeps a negative price on another', async () => {
    const calls = [];
    const deps2 = {
        modelFor: () => ({ kind: 'native', model: { id: 'hunter-bm', role: 'DPS', requiresTalentOverride: false } }),
        combatant: () => ({ gear: new Array(19).fill({ id: 0 }), talents: [] }),
        buildBaseline: () => ({ request: { raid: { parties: [{ players: [{ buffs: {}, consumables: {}, equipment: { items: new Array(17).fill(null).map(() => ({ id: 1, enchant: 0, gems: [] })) }, bonusStats: undefined }], buffs: {} }], buffs: {}, debuffs: {} }, simOptions: { iterations: 10000, randomSeed: '1' } } }),
        checkedBinaries: async () => ({ sim: 'fake', stats: 'fake' }),
        simulate: async (request) => { calls.push(request); if (calls.length === 2) throw new Error('sim exploded'); return { dps: calls.length === 1 ? 1600 : 1550, iterations: request.simOptions.iterations }; },
    };
    const twoCauses = [
        { id: 'stat-a', bucket: 'melee', owner: 'you', sim: { bonusStats: { 1: 1 } } },
        { id: 'stat-b', bucket: 'melee', owner: 'you', sim: { bonusStats: { 2: 1 } } },
    ];
    const result = await priceCauses({ player: { classToken: 'HUNTER', spec: 'Beast Mastery' }, modelOverrides: { talentsString: 'x' } }, { budget, causes: twoCauses }, deps2);
    assert.equal(result.status, 'priced');
    assert.equal(result.prices['stat-a'], undefined);
    assert.ok(result.assumptions.some(a => a.includes('stat-a') && a.includes('sim exploded')));
    assert.equal(result.prices['stat-b'].dps, -50);
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
    assert.equal(result.status, 'withheld'); assert.match(result.reason, /well below/); assert.match(result.reason, /Model settings/);
    assert.match(result.reason, /1546 DPS/); assert.match(result.reason, /1815 DPS/);
    assert.doesNotMatch(result.reason, /666|667/, 'an unvalidated rotation never prints an absolute model DPS');
    assert.equal(result.baselineDps, 666, 'the baseline stays in the result for callers that may use it');
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
