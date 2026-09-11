'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./evaluation-catalogue');

test('auras at pull resolve to owners, slots and sim changes', () => {
    const flask = C.lookupAura(28520);
    assert.equal(flask.name, 'Flask of Relentless Assault'); assert.equal(flask.owner, 'you'); assert.equal(flask.slot, 'flask');
    assert.deepEqual(flask.sim, { consumable: { field: 'flaskId', id: 22854, clear: ['battleElixirId', 'guardianElixirId'] } });
    const agility = C.lookupAura(28497);
    assert.equal(agility.name, 'Elixir of Major Agility'); assert.equal(agility.slot, 'battle');
    const kings = C.lookupAura(25898);
    assert.equal(kings.owner, 'raid'); assert.deepEqual(kings.sim, { set: [[['raid', 'parties', 0, 'players', 0, 'buffs', 'blessingOfKings'], true]] });
    assert.equal(C.lookupAura(12174).kind, 'scroll');
    assert.equal(C.lookupAura(999999), null);
});

test('uptime auras know raid buffs, procs with their items and own cooldowns', () => {
    assert.equal(C.lookupUptime(30807).kind, 'raid-buff'); assert.equal(C.lookupUptime(30807).owner, 'raid');
    assert.equal(C.lookupUptime(34775).kind, 'proc'); assert.equal(C.lookupUptime(34775).itemId, 28830);
    assert.equal(C.procForItem(28830).id, 34775);
    assert.equal(C.lookupUptime(36041).itemId, 29962);
    assert.equal(C.lookupUptime(28093).enchantId, 2673, 'Lightning Speed comes from Mongoose');
    assert.equal(C.lookupUptime(6774).kind, 'maintained'); assert.equal(C.lookupUptime(6774).owner, 'you');
    assert.equal(C.lookupUptime(35476).kind, 'raid-buff'); assert.equal(C.lookupUptime(32182).kind, 'raid-buff');
});

test('debuffs are raid owned and name what they affect', () => {
    assert.equal(C.lookupDebuff(25225).name, 'Sunder Armor'); assert.equal(C.lookupDebuff(25225).owner, 'raid');
    assert.equal(C.lookupDebuff(26993).name, 'Faerie Fire'); assert.equal(C.lookupDebuff(25602).name, 'Faerie Fire');
    assert.equal(C.lookupDebuff(34501).affects, 'perHit');
});

// --- Final fix wave ---

test('auras at pull carry a stat affinity so a stat gap only names buffs that supply that stat', () => {
    assert.deepEqual(C.lookupAura(25898).stats, [0, 1, 3], 'Kings gives strength, agility and intellect');
    assert.deepEqual(C.lookupAura(2048).stats, [17, 18], 'Battle Shout is attack power only');
    assert.deepEqual(C.lookupAura(24932).stats, [21], 'Leader of the Pack is melee/ranged crit');
    assert.deepEqual(C.lookupAura(20218).stats, [], 'Sanctity Aura supplies no rated stat');
    assert.deepEqual(C.lookupAura(27143).stats, [], 'Wisdom is mana regeneration, not a damage stat');
    assert.deepEqual(C.lookupAura(33261).stats, [1, 17, 18], 'Warp Burger');
    assert.deepEqual(C.lookupAura(33077).stats, [1], 'Grace of Air Totem');
    assert.deepEqual(C.lookupAura(33082).stats, [0], 'Strength of Earth Totem');
    assert.deepEqual(C.lookupAura(12174).stats, [1]); assert.deepEqual(C.lookupAura(12179).stats, [0]);
    assert.deepEqual(C.lookupAura(28497).stats, [1, 21], 'Elixir of Major Agility also gives crit');
    assert.deepEqual(C.lookupAura(11406).stats, [17, 18], 'Elixir of Demonslaying is demon attack power');
    assert.deepEqual(C.lookupAura(27141).stats, [17, 18]); assert.deepEqual(C.lookupAura(30807).stats, [17, 18]);
    assert.deepEqual(C.lookupAura(27127).stats, [3]); assert.deepEqual(C.lookupAura(32999).stats, []);
    assert.deepEqual(C.lookupAura(33256).stats, [0]); assert.deepEqual(C.lookupAura(33254).stats, [5]);
    assert.deepEqual(C.lookupAura(28520).stats, [17, 18]);
    for (const entry of C.AURAS_AT_PULL.values()) assert.ok(Array.isArray(entry.stats), entry.name + ' needs an explicit affinity');
});

test('Drums of Battle is an aura at pull as well as an uptime band, with the same sim change', () => {
    const drums = C.lookupAura(35476);
    assert.ok(drums, 'Drums of Battle must be resolvable at pull');
    assert.equal(drums.kind, 'party'); assert.equal(drums.owner, 'raid');
    assert.deepEqual(drums.stats, [22, 14]);
    assert.deepEqual(drums.sim, C.lookupUptime(35476).sim);
});

test('the scroll stat delta keeps its own field so the affinity list is unambiguous', () => {
    assert.deepEqual(C.lookupAura(12174).statDelta, { 1: 20 });
    assert.deepEqual(C.lookupAura(12179).statDelta, { 0: 20 });
});

test('uptime bands that supply a rated stat carry the same affinity', () => {
    assert.deepEqual(C.lookupUptime(35476).stats, [22, 14]);
    assert.deepEqual(C.lookupUptime(2048).stats, [17, 18]);
    assert.deepEqual(C.lookupUptime(24932).stats, [21]);
    assert.deepEqual(C.lookupUptime(2825).stats, [], 'Bloodlust is a percentage, not a haste rating');
});
