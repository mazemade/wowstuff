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
