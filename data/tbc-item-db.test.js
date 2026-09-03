'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'tbc-item-db.json'), 'utf8'));
const item = id => db.items.find(i => i.id === id);
const gem = id => db.gems.find(g => g.id === id);
const enchant = id => db.enchants.find(e => e.effectId === id);

test('table has the three sections and thousands of items', () => {
    assert.ok(db.items.length > 8000, 'items: ' + db.items.length);
    assert.ok(db.gems.length > 200, 'gems: ' + db.gems.length);
    assert.ok(db.enchants.length > 130, 'enchants: ' + db.enchants.length);
});
test('Cataclysm Helm keeps sockets, sparse stats, sparse socket bonus and ilvl', () => {
    const it = item(30190);
    assert.strictEqual(it.name, 'Cataclysm Helm');
    assert.strictEqual(it.type, 1);
    assert.strictEqual(it.ilvl, 133);
    assert.strictEqual(it.quality, 4);
    assert.deepStrictEqual(it.gemSockets, [1, 4]);
    assert.deepStrictEqual(it.socketBonus, { 1: 4 });
    assert.deepStrictEqual(it.stats, { 0: 41, 1: 32, 2: 46, 3: 23, 20: 21, 31: 759 });
});
test('weapons keep handType and weaponType, ranged keeps rangedWeaponType', () => {
    assert.strictEqual(item(32838).handType, 3);          // Warglaive of Azzinoth (off hand)
    assert.strictEqual(item(32838).weaponType, 9);        // sword
    assert.strictEqual(item(27815).type, 14);             // Totem of the Astral Winds
    assert.strictEqual(item(27815).rangedWeaponType, 8);  // totem relic
});
test('gems keep colour and sparse stats', () => {
    assert.deepStrictEqual(gem(32409), { id: 32409, name: 'Relentless Earthstorm Diamond', color: 1, stats: { 1: 12 } });
    assert.deepStrictEqual(gem(24058).stats, { 0: 4, 21: 4 });
});
test('enchants keep effectId, type and sparse stats; proc-only enchants keep an empty stats object', () => {
    assert.deepStrictEqual(enchant(3003), { effectId: 3003, name: 'Glyph of Ferocity', type: 1, stats: { 17: 34, 18: 34, 20: 16 } });
    assert.deepStrictEqual(enchant(2673).stats, {});     // Mongoose is a proc, no static stats
    assert.strictEqual(enchant(2673).name, 'Enchant Weapon - Mongoose');
});
test('no item carries a zero-valued stat (sparse means zeros are dropped)', () => {
    for (const it of db.items) for (const k in it.stats) assert.notStrictEqual(it.stats[k], 0, it.id);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
