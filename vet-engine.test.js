'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vet-engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// A tiny synthetic table: one helm with a meta+yellow socket and a +4 crit socket bonus,
// one ring, one main-hand sword, one held off-hand, one shield, one bow, two gems, one enchant.
const MINI_DB = {
    items: [
        { id: 1, name: 'Test Helm', type: 1, ilvl: 130, quality: 4, gemSockets: [1, 4], socketBonus: { 21: 4 }, stats: { 0: 40, 20: 20 } },
        { id: 2, name: 'Test Ring', type: 11, ilvl: 120, quality: 3, gemSockets: [], socketBonus: {}, stats: { 17: 50 } },
        { id: 3, name: 'Test Sword', type: 13, handType: 1, weaponType: 9, ilvl: 140, quality: 4, gemSockets: [], socketBonus: {}, stats: { 20: 10, 24: 20 } },
        { id: 4, name: 'Test Orb', type: 13, handType: 3, weaponType: 5, ilvl: 100, quality: 3, gemSockets: [], socketBonus: {}, stats: { 5: 30 } },
        { id: 5, name: 'Test Shield', type: 13, handType: 3, weaponType: 7, ilvl: 110, quality: 3, gemSockets: [], socketBonus: {}, stats: { 25: 24, 31: 4000 } },
        { id: 6, name: 'Test Bow', type: 14, rangedWeaponType: 1, ilvl: 115, quality: 3, gemSockets: [], socketBonus: {}, stats: { 18: 30 } },
        { id: 7, name: 'Test Chest', type: 5, ilvl: 125, quality: 4, gemSockets: [2, 3], socketBonus: { 0: 6 }, stats: { 2: 30 } },
    ],
    gems: [
        { id: 100, name: 'Test Meta', color: 1, stats: { 1: 12 } },
        { id: 101, name: 'Test Yellow', color: 4, stats: { 21: 8 } },
        { id: 102, name: 'Test Red', color: 2, stats: { 0: 8 } },
    ],
    enchants: [
        { effectId: 500, name: 'Test Helm Enchant', type: 1, stats: { 17: 34 } },
        { effectId: 501, name: 'Test Weapon Enchant', type: 13, stats: {} },
    ],
};
const mini = V.indexDb(MINI_DB);

// Build a 19-entry WCL gear array with only the given wclIndex -> item entries filled.
function wclGear(entries) {
    const gear = [];
    for (let i = 0; i < 19; i++) gear.push({ id: 0, itemLevel: 0 });
    Object.keys(entries).forEach(i => { gear[+i] = entries[i]; });
    return gear;
}

test('SLOTS: 17 slots in WCL order, shirt and tabard skipped', () => {
    assert.strictEqual(V.SLOTS.length, 17);
    assert.deepStrictEqual(V.SLOTS.map(s => s.wclIndex), [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.strictEqual(V.SLOTS[0].key, 'head');
    assert.strictEqual(V.SLOTS[16].key, 'ranged');
});

test('summarizeGear: sums item, gem and enchant stats and the socket bonus when colours match', () => {
    const gear = wclGear({ 0: { id: 1, itemLevel: 130, permanentEnchant: 500, gems: [{ id: 100 }, { id: 101 }] } });
    const s = V.summarizeGear(gear, mini, 'WARRIOR');
    assert.strictEqual(s.stats[0], 40);            // str from helm
    assert.strictEqual(s.stats[20], 20);           // melee hit from helm
    assert.strictEqual(s.stats[17], 34);           // AP from enchant
    assert.strictEqual(s.stats[1], 12);            // agi from meta gem
    assert.strictEqual(s.stats[21], 8 + 4);        // crit: yellow gem + socket bonus
    assert.strictEqual(s.slots[0].emptySockets, 0);
    assert.strictEqual(s.slots[0].enchant.name, 'Test Helm Enchant');
    assert.strictEqual(s.socketBonusesApplied, true);
    assert.strictEqual(s.setBonusesApplied, false);
});

test('summarizeGear: socket bonus withheld when a gem colour does not match or a socket is empty', () => {
    const wrongColour = V.summarizeGear(wclGear({ 0: { id: 1, itemLevel: 130, gems: [{ id: 100 }, { id: 102 }] } }), mini, 'WARRIOR');
    assert.strictEqual(wrongColour.stats[21], undefined);   // red gem in yellow socket: no +4 crit
    assert.strictEqual(wrongColour.stats[0], 40 + 8);       // the red gem's str still counts
    const empty = V.summarizeGear(wclGear({ 0: { id: 1, itemLevel: 130, gems: [{ id: 100 }] } }), mini, 'WARRIOR');
    assert.strictEqual(empty.stats[21], undefined);
    assert.strictEqual(empty.slots[0].emptySockets, 1);
    assert.strictEqual(empty.emptySockets, 1);
});

test('summarizeGear: orange/purple/green/prismatic gems match two or three colours', () => {
    const db = V.indexDb({ items: [{ id: 7, name: 'Test Chest', type: 5, ilvl: 125, quality: 4, gemSockets: [2, 3], socketBonus: { 0: 6 }, stats: {} }],
        gems: [{ id: 200, name: 'Purple', color: 7, stats: {} }, { id: 201, name: 'Green', color: 5, stats: {} },
               { id: 202, name: 'Orange', color: 6, stats: {} }, { id: 203, name: 'Prismatic', color: 8, stats: {} }], enchants: [] });
    const ok = V.summarizeGear(wclGear({ 4: { id: 7, itemLevel: 125, gems: [{ id: 200 }, { id: 201 }] } }), db, 'WARRIOR');
    assert.strictEqual(ok.stats[0], 6, 'purple fits red, green fits blue');
    const ok2 = V.summarizeGear(wclGear({ 4: { id: 7, itemLevel: 125, gems: [{ id: 203 }, { id: 203 }] } }), db, 'WARRIOR');
    assert.strictEqual(ok2.stats[0], 6, 'prismatic fits any coloured socket');
    const bad = V.summarizeGear(wclGear({ 4: { id: 7, itemLevel: 125, gems: [{ id: 202 }, { id: 202 }] } }), db, 'WARRIOR');
    assert.strictEqual(bad.stats[0], undefined, 'orange does not fit blue');
});

test('summarizeGear: average item level over 17 slots, empty slot counts as 0 and is flagged', () => {
    const s = V.summarizeGear(wclGear({ 0: { id: 1, itemLevel: 130 }, 10: { id: 2, itemLevel: 120 } }), mini, 'WARRIOR');
    assert.strictEqual(s.avgItemLevel, Math.round((130 + 120) / 17 * 100) / 100);
    assert.strictEqual(s.slots.filter(x => x.empty).length, 15);
});

test('summarizeGear: enchantable slots — head/shoulder/back/chest/wrist/hands/legs/feet/weapons; rings only when one ring is enchanted; ranged only for hunters with a bow/gun/crossbow', () => {
    // Warrior: helm (no enchant), main-hand sword (enchanted), held orb, ring without enchant.
    const s = V.summarizeGear(wclGear({
        0: { id: 1, itemLevel: 130 }, 15: { id: 3, itemLevel: 140, permanentEnchant: 501 },
        16: { id: 4, itemLevel: 100 }, 10: { id: 2, itemLevel: 120 }, 17: { id: 6, itemLevel: 115 },
    }), mini, 'WARRIOR');
    const bySlot = Object.fromEntries(s.slots.map(x => [x.key, x]));
    assert.strictEqual(bySlot.head.enchantable, true);
    assert.strictEqual(bySlot.mainHand.enchantable, true);
    assert.strictEqual(bySlot.offHand.enchantable, false, 'held item cannot be enchanted');
    assert.strictEqual(bySlot.finger1.enchantable, false, 'rings only count for enchanters');
    assert.strictEqual(bySlot.ranged.enchantable, false, 'scopes only count for hunters');
    assert.strictEqual(s.missingEnchants, 1, 'only the helm is missing');
    // Shield in off hand is enchantable.
    const sh = V.summarizeGear(wclGear({ 16: { id: 5, itemLevel: 110 } }), mini, 'PALADIN');
    assert.strictEqual(sh.slots.find(x => x.key === 'offHand').enchantable, true);
    assert.strictEqual(sh.missingEnchants, 1);
    // Hunter with a bow: ranged enchantable.
    const h = V.summarizeGear(wclGear({ 17: { id: 6, itemLevel: 115 } }), mini, 'HUNTER');
    assert.strictEqual(h.slots.find(x => x.key === 'ranged').enchantable, true);
    // Enchanter: one ring enchanted makes both rings count.
    const e = V.summarizeGear(wclGear({ 10: { id: 2, itemLevel: 120, permanentEnchant: 500 }, 11: { id: 2, itemLevel: 120 } }), mini, 'MAGE');
    assert.strictEqual(e.missingEnchants, 1);
});

test('summarizeGear: unknown item ids are listed and skipped, never thrown', () => {
    const s = V.summarizeGear(wclGear({ 0: { id: 999999, itemLevel: 100 } }), mini, 'WARRIOR');
    assert.deepStrictEqual(s.unknownItems, [999999]);
    assert.strictEqual(s.slots[0].name, 'Unknown item 999999');
    assert.strictEqual(s.slots[0].itemLevel, 100, 'WCL ilvl still used for the average');
});

test('derivedStats: reported ratings win, gear-only stats come from the sum, skills derived', () => {
    const c = V.derivedStats({ 5: 100, 4: 200, 17: 500, 25: 120, 24: 60, 35: 12, 20: 50 },
                             { hitMelee: 171, hitRanged: 171, hitSpell: 0, expertise: 0, critMelee: 157 });
    assert.strictEqual(c.spellDamage, 100);
    assert.strictEqual(c.healing, 200);
    assert.strictEqual(c.attackPower, 500);
    assert.strictEqual(c.mp5, 12);
    assert.strictEqual(c.meleeHit, 171, 'reported beats the 50 from gear');
    assert.strictEqual(c.expertiseRating, 0, 'reported 0 beats the 60 from gear');
    assert.strictEqual(c.expertiseSkill, 0);
    assert.strictEqual(c.defenseRating, 120);
    assert.strictEqual(c.defenseSkill, 350 + Math.floor(120 / 2.37));
    assert.strictEqual(c.meleeCrit, 157);
});

test('derivedStats: without a reported block, everything comes from gear', () => {
    const c = V.derivedStats({ 20: 50, 24: 79, 12: 30 }, null);
    assert.strictEqual(c.meleeHit, 50);
    assert.strictEqual(c.spellHit, 30);
    assert.strictEqual(c.expertiseSkill, Math.floor(79 / 3.94));
});

// Real data: the captured fixture against the committed table. Computed melee hit and haste
// must equal what WCL measured — that equality is the proof the join is right.
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
const realDb = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));

test('fixture: computed melee hit and haste equal the WCL-reported values', () => {
    const s = V.summarizeGear(REAL.report.combatant.gear, realDb, 'SHAMAN');
    assert.strictEqual(s.stats[20], REAL.report.combatant.hitMelee);   // 171
    assert.strictEqual(s.stats[22], REAL.report.combatant.hasteMelee); // 65
    assert.strictEqual(s.stats[17], 870);
    assert.deepStrictEqual(s.unknownItems, []);
});
test('fixture: average item level 131.82, no missing enchants, no empty sockets', () => {
    const s = V.summarizeGear(REAL.report.combatant.gear, realDb, 'SHAMAN');
    assert.strictEqual(s.avgItemLevel, 131.82);
    assert.strictEqual(s.missingEnchants, 0);
    assert.strictEqual(s.emptySockets, 0);
    assert.strictEqual(s.slots.find(x => x.key === 'mainHand').enchant.name, 'Enchant Weapon - Mongoose');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
