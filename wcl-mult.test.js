'use strict';
const assert = require('node:assert');
const W = require('./wcl-mult.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: specNameToKey ---
test('specNameToKey: WCL-style names map to engine keys', () => {
    assert.strictEqual(W.specNameToKey('Hunter', 'BeastMastery'), 'HUNTER:Beast Mastery');
    assert.strictEqual(W.specNameToKey('Warlock', 'Destruction'), 'WARLOCK:Destruction');
    assert.strictEqual(W.specNameToKey('Druid', 'Guardian'), 'DRUID:Guardian');
});
test('specNameToKey: engine-style inputs round-trip (class upper, spec with space)', () => {
    assert.strictEqual(W.specNameToKey('HUNTER', 'Beast Mastery'), 'HUNTER:Beast Mastery');
});
test('specNameToKey: Justicar and Gladiator are the same build as Protection', () => {
    // WCL labels a Protection-talented character that missed the tank thresholds on a kill
    // as Justicar (paladin) or Gladiator (warrior). Same talents, same player.
    assert.strictEqual(W.specNameToKey('Paladin', 'Justicar'), 'PALADIN:Protection');
    assert.strictEqual(W.specNameToKey('Warrior', 'Gladiator'), 'WARRIOR:Protection');
});
test('specNameToKey: role labels for a DIFFERENT build stay unmapped', () => {
    // Champion is an Arms/Fury warrior tanking, Dreamstate a Balance druid out-healing its
    // damage, Warden a feral tank under the bear-form threshold. Each would be scored against
    // a baseline for work they were not doing, so a null (no prefill) is the honest answer.
    assert.strictEqual(W.specNameToKey('Warrior', 'Champion'), null);
    assert.strictEqual(W.specNameToKey('Druid', 'Dreamstate'), null);
    assert.strictEqual(W.specNameToKey('Druid', 'Warden'), null);
    assert.strictEqual(W.specNameToKey('Paladin', 'Gladiator'), null); // warrior-only label
    assert.strictEqual(W.specNameToKey('Warrior', 'Justicar'), null);  // paladin-only label
});
test('specNameToKey: unknown class or spec gives null', () => {
    assert.strictEqual(W.specNameToKey('Deathknight', 'Blood'), null);
    assert.strictEqual(W.specNameToKey('Mage', 'Holy'), null);
    assert.strictEqual(W.specNameToKey(null, 'Arms'), null);
});
test('specNameToKey covers every damage-dealing engine spec, in both name forms', () => {
    const E = require('./assignments-engine.js');
    const damage = Object.keys(E.BASELINE).filter(k => E.BASELINE[k] > 0);
    assert.strictEqual(damage.length, 23);
    damage.forEach(key => {
        const cls = key.slice(0, key.indexOf(':'));
        const spec = key.slice(key.indexOf(':') + 1);
        assert.strictEqual(W.specNameToKey(cls, spec), key);
        // WCL writes multi-word spec names without the space ("BeastMastery").
        assert.strictEqual(W.specNameToKey(cls, spec.replace(/\s+/g, '')), key);
    });
});

// --- Task 2: shouldOverwrite ---
test('shouldOverwrite: untouched meta is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite(undefined), true);
    assert.strictEqual(W.shouldOverwrite({}), true);
    assert.strictEqual(W.shouldOverwrite({ mt: true }), true);
    assert.strictEqual(W.shouldOverwrite({ mult: 1 }), true); // untouched default
});
test('shouldOverwrite: value still equal to last auto is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.12, multAuto: 1.12 }), true);
});
test('shouldOverwrite: manual divergence is protected', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.3, multAuto: 1.12 }), false);
    assert.strictEqual(W.shouldOverwrite({ mult: 0.8 }), false); // manual, never fetched
    assert.strictEqual(W.shouldOverwrite({ mult: 1, multAuto: 1.12 }), false); // deliberately reset to 1
});

// --- Roster-relative multipliers ---
const NOW = 1770000000000; // fixed fake "now"; startTimes are offsets from it
const DAY = 24 * 3600 * 1000;

// One roster entry. amountsByBoss maps encounter id -> a single amount or an array of them.
// `specName` is the WCL-side label written onto every parse; it defaults to matching specKey,
// so a test can make it disagree to exercise the same-spec filter.
function mkPlayer(name, baseline, amountsByBoss, over) {
    const o = Object.assign({ classKey: 'MAGE', specKey: 'MAGE:Fire', specName: 'Fire' }, over);
    const ranksByEncounter = {};
    Object.keys(amountsByBoss || {}).forEach(b => {
        ranksByEncounter[b] = [].concat(amountsByBoss[b]).map(a => ({
            amount: a, spec: o.specName, startTime: NOW - DAY,
        }));
    });
    return { name, baseline, classKey: o.classKey, specKey: o.specKey, ranksByEncounter };
}

test('playerBossMedians: per-boss median, odd and even counts', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [900, 1000, 1100].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
            102: [2000, 3000].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 1000, 102: 2500 });
});
test('playerBossMedians: parses outside the 4-week window are ignored', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [
                { amount: 5000, spec: 'Fire', startTime: NOW - 29 * DAY }, // too old
                { amount: 1050, spec: 'Fire', startTime: NOW - 27 * DAY },
            ],
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 1050 });
});
test('playerBossMedians: off-spec parses are ignored, and a boss with none drops out', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [
                { amount: 5000, spec: 'Arcane', startTime: NOW - DAY },
                { amount: 980, spec: 'Fire', startTime: NOW - DAY },
            ],
            102: [{ amount: 4000, spec: 'Arcane', startTime: NOW - DAY }],
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 980 });
});

test('computeRosterMults: a uniform roster is all 1.0', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
    ] });
    assert.deepStrictEqual(r, {
        A: { mult: 1, bosses: 1 }, B: { mult: 1, bosses: 1 }, C: { mult: 1, bosses: 1 },
    });
});
test('computeRosterMults: BASELINE carries the cross-spec scale', () => {
    // A is a 1000-baseline mage doing 1200; B and C are 2000-baseline hunters on baseline.
    // The roster scale is median(1.2, 1.0, 1.0) = 1.0, so only A moves.
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1200 }),
        mkPlayer('B', 2000, { 101: 2000 }, { classKey: 'HUNTER', specKey: 'HUNTER:Beast Mastery', specName: 'BeastMastery' }),
        mkPlayer('C', 2000, { 101: 2000 }, { classKey: 'HUNTER', specKey: 'HUNTER:Beast Mastery', specName: 'BeastMastery' }),
    ] });
    assert.deepStrictEqual(r.A, { mult: 1.2, bosses: 1 });
    assert.deepStrictEqual(r.B, { mult: 1, bosses: 1 });
});
test('computeRosterMults: the per-boss scale absorbs a fight that pays double', () => {
    // Boss 102 pays exactly 2x boss 101 for everyone, so nobody's multiplier moves.
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 900, 102: 1800 }),
        mkPlayer('B', 1000, { 101: 1000, 102: 2000 }),
        mkPlayer('C', 1000, { 101: 1100, 102: 2200 }),
    ] });
    assert.deepStrictEqual(r.A, { mult: 0.9, bosses: 2 });
    assert.deepStrictEqual(r.C, { mult: 1.1, bosses: 2 });
});
test('computeRosterMults: the scale is a median, so one hero does not move it', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('D', 1000, { 101: 1500 }),
    ] });
    assert.strictEqual(r.A.mult, 1);   // a mean-based scale would drag this to 0.89
    assert.strictEqual(r.D.mult, 1.5);
});
test('computeRosterMults: a boss under the 3-player floor is skipped', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000, 102: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('D', 1000, { 102: 5000 }), // only on the 2-player boss
    ] });
    assert.deepStrictEqual(r.A, { mult: 1, bosses: 1 }); // boss 102 contributed nothing
    assert.strictEqual(r.D, undefined);                  // no qualifying boss at all
});
test('computeRosterMults: minPlayersPerBoss is overridable', () => {
    const players = [mkPlayer('A', 1000, { 101: 1000 }), mkPlayer('B', 1000, { 101: 2000 })];
    assert.deepStrictEqual(W.computeRosterMults({ nowMs: NOW, players }), {});
    const r = W.computeRosterMults({ nowMs: NOW, players, minPlayersPerBoss: 2 });
    assert.strictEqual(r.A.mult, 0.67); // scale = median(1, 2) = 1.5 -> 1000/1500
    assert.strictEqual(r.B.mult, 1.33);
});
test('computeRosterMults: clamps to [0.5, 2]', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('HI', 1000, { 101: 9000 }),
        mkPlayer('LO', 1000, { 101: 10 }),
    ] });
    assert.strictEqual(r.HI.mult, 2);
    assert.strictEqual(r.LO.mult, 0.5);
});
test('computeRosterMults: zero-baseline players are excluded and do not move the scale', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('Healer', 0, { 101: 400 }),
    ] });
    assert.strictEqual(r.Healer, undefined);
    assert.strictEqual(r.A.mult, 1); // scale unchanged by the excluded entry
});
test('computeRosterMults: a player with no qualifying parses is absent', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('Offspec', 1000, { 101: 1000 }, { specKey: 'MAGE:Arcane' }), // rostered Arcane, parses say Fire
        mkPlayer('Empty', 1000, {}),                                          // no parses at all
    ] });
    assert.strictEqual(r.Offspec, undefined);
    assert.strictEqual(r.Empty, undefined);
    assert.strictEqual(Object.keys(r).length, 3);
});

// --- rosterKillDurations ---
test('rosterKillDurations: dedupes shared kills by startTime', () => {
    const now = 1000000000000;
    const rank = (st, dur) => ({ amount: 1000, spec: 'Arcane', startTime: st, duration: dur });
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [
            { ranksByEncounter: { 733: [rank(now - 1000, 150000), rank(now - 2000, 170000)] } },
            { ranksByEncounter: { 733: [rank(now - 1000, 150000)] } }, // same kill seen via a second player
        ],
    });
    assert.strictEqual(res.perBoss[733].kills, 2);
    assert.strictEqual(res.perBoss[733].medianSec, 160);
});
test('rosterKillDurations: splits farm and long at the 300s per-boss threshold', () => {
    const now = 1000000000000;
    const rank = (st, dur) => ({ startTime: st, duration: dur });
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [{ ranksByEncounter: {
            1: [rank(now - 1, 170000), rank(now - 2, 190000)],  // farm boss, median 180s
            2: [rank(now - 3, 210000)],                         // farm boss, 210s
            3: [rank(now - 4, 500000), rank(now - 5, 540000)],  // long boss, median 520s
        } }],
    });
    assert.strictEqual(res.farmMedianSec, 195); // median of the per-boss medians [180, 210]
    assert.strictEqual(res.longMedianSec, 520);
});
test('rosterKillDurations: stale kills are ignored; an empty pool gives nulls', () => {
    const now = 1000000000000;
    const old = now - 29 * 24 * 3600 * 1000; // outside the 28-day window
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [{ ranksByEncounter: { 1: [{ startTime: old, duration: 200000 }] } }],
    });
    assert.strictEqual(res.farmMedianSec, null);
    assert.strictEqual(res.longMedianSec, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
