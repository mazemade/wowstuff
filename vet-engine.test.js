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

// --- Task 3: spec/role, allowances, rules ---
test('normalizeWclSpec: WCL labels map onto engine spec names, role labels fold or drop', () => {
    assert.strictEqual(V.normalizeWclSpec('SHAMAN', 'Enhancement'), 'Enhancement');
    assert.strictEqual(V.normalizeWclSpec('HUNTER', 'BeastMastery'), 'Beast Mastery');
    assert.strictEqual(V.normalizeWclSpec('PALADIN', 'Justicar'), 'Protection');
    assert.strictEqual(V.normalizeWclSpec('WARRIOR', 'Gladiator'), 'Protection');
    assert.strictEqual(V.normalizeWclSpec('DRUID', 'Guardian'), 'Guardian');
    assert.strictEqual(V.normalizeWclSpec('DRUID', 'Warden'), null);
    assert.strictEqual(V.normalizeWclSpec('MAGE', 'Holy'), null);
});
test('roleOf: every engine spec lands on one of five roles', () => {
    assert.strictEqual(V.roleOf('WARRIOR', 'Protection'), 'tank');
    assert.strictEqual(V.roleOf('DRUID', 'Guardian'), 'tank');
    assert.strictEqual(V.roleOf('PRIEST', 'Holy'), 'healer');
    assert.strictEqual(V.roleOf('HUNTER', 'Survival'), 'ranged');
    assert.strictEqual(V.roleOf('MAGE', 'Fire'), 'caster');
    assert.strictEqual(V.roleOf('SHAMAN', 'Enhancement'), 'melee');
    assert.strictEqual(V.roleOf('DRUID', 'Feral'), 'melee');
    assert.strictEqual(V.roleOf('DRUID', 'Nope'), null);
});
test('detectSpec: talents decide when unambiguous; WCL label fills in when not', () => {
    assert.deepStrictEqual(V.detectSpec('SHAMAN', [2, 45, 14], null), { spec: 'Enhancement', role: 'melee', detectedFrom: 'talents', ambiguous: false });
    assert.deepStrictEqual(V.detectSpec('PRIEST', [20, 20, 21], 'Holy'), { spec: 'Holy', role: 'healer', detectedFrom: 'wcl', ambiguous: true });
    assert.deepStrictEqual(V.detectSpec('DRUID', [0, 45, 16], 'Guardian'), { spec: 'Guardian', role: 'tank', detectedFrom: 'talents', ambiguous: false });
    assert.deepStrictEqual(V.detectSpec('MAGE', null, null), { spec: null, role: null, detectedFrom: null, ambiguous: true });
});
test('hitAllowanceRating: percent to rating with the right constant per role', () => {
    assert.strictEqual(V.hitAllowanceRating('SHAMAN', 'Enhancement', 'melee', [2, 45, 14]), 95);
    assert.strictEqual(V.hitAllowanceRating('ROGUE', 'Combat', 'melee', [15, 41, 5]), 79);
    assert.strictEqual(V.hitAllowanceRating('PRIEST', 'Shadow', 'caster', [14, 0, 47]), 126);
    assert.strictEqual(V.hitAllowanceRating('MAGE', 'Frost', 'caster', [0, 0, 61]), 38);
    assert.strictEqual(V.hitAllowanceRating('PALADIN', 'Retribution', 'melee', [0, 4, 57]), 0);
});
test('parseThresholds: finite numbers override, junk falls back to defaults', () => {
    const t = V.parseThresholds({ ilvl: '130', parse: 'abc', staleDays: null, bogus: 1 });
    assert.strictEqual(t.ilvl, 130);
    assert.strictEqual(t.parse, V.DEFAULT_THRESHOLDS.parse, 'junk falls back to whatever the current default is');
    assert.strictEqual(t.staleDays, 28);
    assert.strictEqual(t.bogus, undefined);
});

const NOW = Date.parse('2026-09-03T12:00:00Z');
function profile(over) {
    return Object.assign({
        identity: { class: 'SHAMAN', spec: 'Enhancement', role: 'melee', talentSplit: [2, 45, 14] },
        computed: { avgItemLevel: 131.82, meleeHit: 171, rangedHit: 171, spellHit: 0, expertiseSkill: 0, defenseSkill: 350 },
        gearSummary: { missingEnchants: 0, emptySockets: 0, gearScore: 1800 },
        parses: { medianPercent: 82.9, zone: 1060 },
        lastSeen: { timestamp: NOW - 2 * 86400e3 },
    }, over);
}
test('evaluate: the fixture-like enhancement shaman is a warn (expertise 0/26), nothing fails', () => {
    // Expertise is off by default (calibrated to 0) since nobody in the real roster gears it;
    // this test exercises the warn mechanic itself, so it passes an explicit threshold of 26.
    const t = Object.assign({}, V.DEFAULT_THRESHOLDS, { expertise: 26 });
    const r = V.evaluate(profile(), t, NOW);
    assert.strictEqual(r.verdict, 'warn');
    const hit = r.rules.find(x => x.key === 'hit');
    assert.strictEqual(hit.effective, 142 - 95);
    assert.strictEqual(hit.status, 'pass');
    assert.strictEqual(r.rules.find(x => x.key === 'expertise').status, 'warn');
    assert.strictEqual(r.rules.find(x => x.key === 'defense').applies, false);
    assert.deepStrictEqual(r.reasons, ['expertise 0/26']);
});
test('evaluate: under hit cap fails and the reason shows the shortfall against the effective cap', () => {
    const r = V.evaluate(profile({ computed: { avgItemLevel: 131.82, meleeHit: 30, expertiseSkill: 26, defenseSkill: 350 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(r.verdict, 'fail');
    assert.ok(r.reasons.indexOf('hit 30/47 (−17)') !== -1, r.reasons.join(','));
});
test('evaluate: casters use spell hit, healers and tanks have no hit rule, tanks get defense', () => {
    const mage = V.evaluate(profile({ identity: { class: 'MAGE', spec: 'Frost', role: 'caster', talentSplit: [0, 20, 41] }, computed: { avgItemLevel: 130, spellHit: 164, expertiseSkill: 0, defenseSkill: 350 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(mage.rules.find(x => x.key === 'hit').status, 'pass');       // 164 >= 202-38, 41 Frost reaches Elemental Precision's gate of 3
    assert.strictEqual(mage.rules.find(x => x.key === 'expertise').applies, false);
    const healer = V.evaluate(profile({ identity: { class: 'PRIEST', spec: 'Holy', role: 'healer' } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(healer.rules.find(x => x.key === 'hit').applies, false);
    // Expertise is off by default (0); this sub-case is about the expertise-warn mechanic for a
    // plate tank, so it passes an explicit threshold of 26 rather than relying on the default.
    const tank = V.evaluate(profile({ identity: { class: 'WARRIOR', spec: 'Protection', role: 'tank' }, computed: { avgItemLevel: 130, meleeHit: 0, expertiseSkill: 10, defenseSkill: 480 } }), Object.assign({}, V.DEFAULT_THRESHOLDS, { expertise: 26 }), NOW);
    assert.strictEqual(tank.verdict, 'fail');
    assert.strictEqual(tank.rules.find(x => x.key === 'defense').status, 'fail');
    assert.strictEqual(tank.rules.find(x => x.key === 'expertise').status, 'warn');
    const bear = V.evaluate(profile({ identity: { class: 'DRUID', spec: 'Guardian', role: 'tank' }, computed: { avgItemLevel: 130, defenseSkill: 350, expertiseSkill: 0 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(bear.rules.find(x => x.key === 'defense').applies, false);
    assert.strictEqual(bear.rules.find(x => x.key === 'expertise').applies, false);
});
test('evaluate: enchants and sockets warn at 1 and fail at 3; parse below threshold fails', () => {
    // Enchants are calibrated to warn 2 / fail 4 by default; this test is about the warn/fail
    // mechanic itself, so it exercises the 1/3 shape explicitly rather than the current default.
    const t = Object.assign({}, V.DEFAULT_THRESHOLDS, { enchantWarn: 1, enchantFail: 3 });
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 1, emptySockets: 0 }, computed: profile().computed, }), t, NOW).rules.find(x => x.key === 'enchants').status, 'warn');
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 3, emptySockets: 0 } }), t, NOW).verdict, 'fail');
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 0, emptySockets: 4 } }), t, NOW).verdict, 'fail');
    assert.strictEqual(V.evaluate(profile({ parses: { medianPercent: 12, zone: 1060 } }), t, NOW).verdict, 'fail');
});
test('evaluate: stale data warns; no data at all is unverified, not fail', () => {
    const stale = V.evaluate(profile({ lastSeen: { timestamp: NOW - 40 * 86400e3 }, computed: Object.assign({}, profile().computed, { expertiseSkill: 26 }) }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(stale.verdict, 'warn');
    assert.strictEqual(stale.rules.find(x => x.key === 'stale').value, 40);
    const nothing = V.evaluate({ identity: { class: 'MAGE', spec: null, role: null }, computed: null, gearSummary: null, parses: null, lastSeen: null }, V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(nothing.verdict, 'unverified');
    assert.ok(nothing.rules.every(x => !x.applies || x.status === 'unknown'));
    // Parses but no gear: parse rule still evaluates and can fail.
    const parsesOnly = V.evaluate({ identity: { class: 'MAGE', spec: 'Frost', role: 'caster' }, computed: null, gearSummary: null, parses: { medianPercent: 5, zone: 1056 }, lastSeen: null }, V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(parsesOnly.verdict, 'fail');
});
test('evaluate: hit note flags a gear-vs-reported disagreement over 5% of the threshold', () => {
    const agree = V.evaluate(profile({ gearOnly: { meleeHit: 171, spellHit: 0 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.ok(agree.rules.find(x => x.key === 'hit').note.indexOf('gear sums') === -1);
    const disagree = V.evaluate(profile({ gearOnly: { meleeHit: 120, spellHit: 0 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.ok(disagree.rules.find(x => x.key === 'hit').note.indexOf('gear sums to 120, WCL reported 171') !== -1);
});
test('evaluate: countRule reports unknown, not pass, when gearSummary exists but the count field is missing', () => {
    // An older profile cached in local storage by a previous version of the page can have a
    // gearSummary without missingEnchants/emptySockets. undefined >= failAt/warnAt is false, so
    // the naive comparison silently reports 'pass' instead of 'unknown'.
    const r = V.evaluate(profile({ gearSummary: { gearScore: 1800 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(r.rules.find(x => x.key === 'enchants').status, 'unknown');
    assert.strictEqual(r.rules.find(x => x.key === 'sockets').status, 'unknown');
});
test('evaluate: DEFAULT_THRESHOLDS expertise (off, 0) never warns a melee player with 0 expertise skill', () => {
    // Both existing expertise tests override the threshold back to 26 to exercise the warn
    // mechanic; this pins the actually-shipped calibrated default (expertise off) instead.
    const r = V.evaluate(profile(), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(r.rules.find(x => x.key === 'expertise').status, 'pass');
});
test('sortRows: fail, warn, unverified, pass, then by name', () => {
    const rows = [{ name: 'b', verdict: 'pass' }, { name: 'a', verdict: 'pass' }, { name: 'z', verdict: 'fail' }, { name: 'u', verdict: 'unverified' }, { name: 'w', verdict: 'warn' }];
    assert.deepStrictEqual(V.sortRows(rows).map(r => r.name), ['z', 'w', 'u', 'a', 'b']);
});

// --- Task 9: GearScore, two-hander item level, recalibrated defaults ---
test('itemGearScore: TacoTip brackets are monotonic across the whole TBC range', () => {
    const s = il => V.itemGearScore(il, 4, 'INVTYPE_CHEST');
    assert.strictEqual(s(120), 145);
    assert.strictEqual(s(121), 147, 'the WotLK bracket switch at 120 must NOT apply');
    assert.strictEqual(s(133), 166);
    assert.strictEqual(s(164), 214);
    for (let il = 100; il < 167; il++) assert.ok(s(il + 1) >= s(il), 'not monotonic at ilvl ' + il);
});
test('itemGearScore: slot modifier, quality scaling and the sub-100 epic bracket', () => {
    assert.strictEqual(V.itemGearScore(133, 4, 'INVTYPE_2HWEAPON'), 2 * 166,
        'a two-hander is worth two weapon slots');
    assert.strictEqual(V.itemGearScore(133, 4, 'INVTYPE_NECK'), Math.floor(((133 - 26) / 1.2) * 0.5625 * 1.8618));
    assert.strictEqual(V.itemGearScore(90, 4, 'INVTYPE_CHEST'), Math.floor(((90 - 0.25) / 1.6275) * 1.8618),
        'epics under ilvl 100 use bracket C');
    assert.strictEqual(V.itemGearScore(133, 1, 'INVTYPE_CHEST'), Math.floor(((133 - 8) / 2) * 1.8618 * 0.005),
        'common items are scaled to almost nothing');
    assert.strictEqual(V.itemGearScore(133, 4, 'INVTYPE_BODY'), 0, 'an unscored slot is worth 0');
});
test('gsInvType: weapons and ranged resolve from the item table', () => {
    assert.strictEqual(V.gsInvType('head', null), 'INVTYPE_HEAD');
    assert.strictEqual(V.gsInvType('mainHand', { handType: 4 }), 'INVTYPE_2HWEAPON');
    assert.strictEqual(V.gsInvType('mainHand', { handType: 1 }), 'INVTYPE_WEAPONMAINHAND');
    assert.strictEqual(V.gsInvType('mainHand', { handType: 2 }), 'INVTYPE_WEAPON');
    assert.strictEqual(V.gsInvType('offHand', { handType: 3, weaponType: 7 }), 'INVTYPE_SHIELD');
    assert.strictEqual(V.gsInvType('offHand', { handType: 3, weaponType: 5 }), 'INVTYPE_HOLDABLE');
    assert.strictEqual(V.gsInvType('ranged', { rangedWeaponType: 1 }), 'INVTYPE_RANGEDRIGHT');
    assert.strictEqual(V.gsInvType('ranged', { rangedWeaponType: 8 }), 'INVTYPE_RELIC');
});
test('summarizeGear: a two-handed weapon counts for both weapon slots in avgItemLevel', () => {
    const db = V.indexDb({ items: [
        { id: 20, name: 'Test Greatsword', type: 13, handType: 4, weaponType: 9, ilvl: 136, quality: 4, gemSockets: [], socketBonus: {}, stats: {} },
        { id: 21, name: 'Test 1H', type: 13, handType: 1, weaponType: 9, ilvl: 136, quality: 4, gemSockets: [], socketBonus: {}, stats: {} },
    ], gems: [], enchants: [] });
    const twoH = V.summarizeGear(wclGear({ 15: { id: 20, itemLevel: 136, quality: 4 } }), db, 'WARRIOR');
    assert.strictEqual(twoH.avgItemLevel, Math.round(136 * 2 / 17 * 100) / 100);
    const oneH = V.summarizeGear(wclGear({ 15: { id: 21, itemLevel: 136, quality: 4 } }), db, 'WARRIOR');
    assert.strictEqual(oneH.avgItemLevel, Math.round(136 / 17 * 100) / 100);
    assert.ok(twoH.avgItemLevel > oneH.avgItemLevel, 'the two-hander must not be penalised');
});
test('summarizeGear: gearScore sums the slots, and hunters are re-weighted', () => {
    const db = V.indexDb({ items: [
        { id: 30, name: 'Test Chest', type: 5, ilvl: 133, quality: 4, gemSockets: [], socketBonus: {}, stats: {} },
        { id: 31, name: 'Test Bow', type: 14, rangedWeaponType: 1, ilvl: 133, quality: 4, gemSockets: [], socketBonus: {}, stats: {} },
        { id: 32, name: 'Test 1H', type: 13, handType: 1, weaponType: 9, ilvl: 133, quality: 4, gemSockets: [], socketBonus: {}, stats: {} },
    ], gems: [], enchants: [] });
    const chestOnly = V.summarizeGear(wclGear({ 4: { id: 30, itemLevel: 133, quality: 4 } }), db, 'WARRIOR');
    assert.strictEqual(chestOnly.gearScore, 166);
    const warrior = V.summarizeGear(wclGear({ 17: { id: 31, itemLevel: 133, quality: 4 }, 15: { id: 32, itemLevel: 133, quality: 4 } }), db, 'WARRIOR');
    const hunter = V.summarizeGear(wclGear({ 17: { id: 31, itemLevel: 133, quality: 4 }, 15: { id: 32, itemLevel: 133, quality: 4 } }), db, 'HUNTER');
    assert.ok(hunter.gearScore > warrior.gearScore, 'a hunter\'s bow carries their score');
    assert.strictEqual(hunter.gearScore,
        Math.floor(V.itemGearScore(133, 4, 'INVTYPE_RANGEDRIGHT') * 5.3224) +
        Math.floor(V.itemGearScore(133, 4, 'INVTYPE_WEAPONMAINHAND') * 0.3164));
});
test('DEFAULT_THRESHOLDS: the calibrated values from spec section 6', () => {
    assert.deepStrictEqual(V.DEFAULT_THRESHOLDS, {
        gs: 1700, ilvl: 110, meleeHit: 142, spellHit: 202, expertise: 0, defense: 490, parse: 20,
        enchantWarn: 2, enchantFail: 4, socketWarn: 1, socketFail: 3, staleDays: 28,
    });
});
test('evaluate: gearscore is the gear gate and its reason shows the shortfall', () => {
    const p = profile({ gearSummary: { missingEnchants: 0, emptySockets: 0, gearScore: 1655 } });
    const r = V.evaluate(p, V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(r.verdict, 'fail');
    assert.strictEqual(r.rules.find(x => x.key === 'gs').status, 'fail');
    assert.ok(r.reasons.indexOf('gearscore 1655/1700 (−45)') !== -1, r.reasons.join(','));
    const ok = V.evaluate(profile({ gearSummary: { missingEnchants: 0, emptySockets: 0, gearScore: 1800 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(ok.rules.find(x => x.key === 'gs').status, 'pass');
});
test('evaluate: gearscore is unknown, not a failure, when there is no gear data', () => {
    const r = V.evaluate({ identity: { class: 'MAGE', spec: 'Frost', role: 'caster' }, computed: null,
        gearSummary: null, parses: { medianPercent: 60, zone: 1060 }, lastSeen: null }, V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(r.rules.find(x => x.key === 'gs').status, 'unknown');
    assert.strictEqual(r.verdict, 'unverified');
});
test('evaluate: no reason string prints raw float noise', () => {
    const r = V.evaluate(profile({ computed: { avgItemLevel: 108.35, meleeHit: 171, expertiseSkill: 0, defenseSkill: 350 },
        gearSummary: { missingEnchants: 0, emptySockets: 0, gearScore: 1800 } }), V.DEFAULT_THRESHOLDS, NOW);
    r.reasons.forEach(x => assert.ok(!/\d\.\d{4,}/.test(x), 'unrounded float in reason: ' + x));
    assert.ok(r.reasons.indexOf('item level 108.35/110 (−1.65)') !== -1, r.reasons.join(','));
});
test('fixture: the real shaman scores a plausible GearScore and keeps its item level', () => {
    const s = V.summarizeGear(REAL.report.combatant.gear, realDb, 'SHAMAN');
    assert.strictEqual(s.avgItemLevel, 131.82, 'dual-wielder, so the two-hander rule must not move it');
    assert.ok(s.gearScore > 1500 && s.gearScore < 2200, 'gearScore was ' + s.gearScore);
});
test('evaluate: parse rule names both tiers with rounded medians when parses.other exists', () => {
    const r = V.evaluate(profile({ parses: {
        medianPercent: 51.71, zone: 1056, zoneName: 'SSC / TK', fallback: true,
        other: { zone: 1060, zoneName: 'BT / Hyjal', medianPercent: 17 },
    } }), V.DEFAULT_THRESHOLDS, NOW);
    const parseRule = r.rules.find(x => x.key === 'parse');
    assert.strictEqual(parseRule.note, 'SSC / TK 52 · BT / Hyjal 17');
    assert.strictEqual(parseRule.value, 52, 'still the gating tier\'s median, not the other tier\'s');
});

test('hitAllowanceRating: the allowance is gated on the tree total that can hold the talent', () => {
    assert.strictEqual(V.hitAllowanceRating('HUNTER', 'Beast Mastery', 'ranged', [41, 20, 0]), 0, 'no Survival points, no Surefooted');
    assert.strictEqual(V.hitAllowanceRating('HUNTER', 'Marksmanship', 'ranged', [0, 41, 20]), 47, '20 Survival reaches row 4 + 3 ranks');
    assert.strictEqual(V.hitAllowanceRating('WARRIOR', 'Arms', 'melee', [33, 28, 0]), 0, 'Precision is Fury row 7; 28 does not reach 33');
    assert.strictEqual(V.hitAllowanceRating('WARRIOR', 'Fury', 'melee', [17, 44, 0]), 47);
    assert.strictEqual(V.hitAllowanceRating('PALADIN', 'Retribution', 'melee', [5, 11, 45]), 47, 'Protection row 2 reached');
    assert.strictEqual(V.hitAllowanceRating('PALADIN', 'Retribution', 'melee', [0, 4, 57]), 0);
    assert.strictEqual(V.hitAllowanceRating('MAGE', 'Fire', 'caster', [10, 48, 3]), 38, 'three Frost points hold Elemental Precision');
    assert.strictEqual(V.hitAllowanceRating('MAGE', 'Fire', 'caster', [10, 51, 0]), 0);
    assert.strictEqual(V.hitAllowanceRating('SHAMAN', 'Enhancement', 'melee', null), 0, 'no split, no allowance');
});
test('evaluate: the hit rule uses the gated allowance and explains a withheld one', () => {
    const bm = V.evaluate(profile({ identity: { class: 'HUNTER', spec: 'Beast Mastery', role: 'ranged', talentSplit: [41, 20, 0] },
        computed: { avgItemLevel: 130, rangedHit: 113, expertiseSkill: 0, defenseSkill: 350 } }), V.DEFAULT_THRESHOLDS, NOW);
    const hit = bm.rules.find(x => x.key === 'hit');
    assert.strictEqual(hit.effective, 142, 'no allowance granted');
    assert.strictEqual(hit.status, 'fail');
    assert.ok(/Surefooted/.test(hit.note) && /no allowance/.test(hit.note), hit.note);
    const ret = V.evaluate(profile({ identity: { class: 'PALADIN', spec: 'Retribution', role: 'melee', talentSplit: [5, 11, 45] },
        computed: { avgItemLevel: 130, meleeHit: 113, expertiseSkill: 0, defenseSkill: 350 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(ret.rules.find(x => x.key === 'hit').effective, 95);
    assert.strictEqual(ret.rules.find(x => x.key === 'hit').status, 'pass');
});

// --- name intake: pasted lists and the #add= fragment the addon's copy link carries ---
test('parseNameList: splits on newlines, commas, semicolons and spaces', () => {
    assert.deepStrictEqual(V.parseNameList('Xavamros\nPepasexa, Svartneon;Náme  Other'),
        ['Xavamros', 'Pepasexa', 'Svartneon', 'Náme', 'Other']);
});
test('parseNameList: strips a realm suffix and de-dupes case-insensitively', () => {
    assert.deepStrictEqual(V.parseNameList('Xavamros-Spineshatter xavamros Pepasexa'), ['Xavamros', 'Pepasexa']);
});
test('parseNameList: empty or non-string input gives an empty list', () => {
    assert.deepStrictEqual(V.parseNameList(''), []);
    assert.deepStrictEqual(V.parseNameList(null), []);
    assert.deepStrictEqual(V.parseNameList(' , ;\n'), []);
});
test('namesFromHash: decodes the comma-separated, percent-encoded add= fragment', () => {
    assert.deepStrictEqual(V.namesFromHash('#add=N%C3%A1me,Xavamros-Spineshatter'), ['Náme', 'Xavamros']);
});
test('namesFromHash: anything else is an empty list', () => {
    assert.deepStrictEqual(V.namesFromHash(''), []);
    assert.deepStrictEqual(V.namesFromHash('#other=1'), []);
    assert.deepStrictEqual(V.namesFromHash('#add='), []);
    assert.deepStrictEqual(V.namesFromHash('#add=%E0%A4%A'), [], 'a malformed escape must not throw');
});

test('defenseAllowanceSkill: Anticipation grants 20 defense skill, gated on the Protection tree total', () => {
    assert.strictEqual(V.defenseAllowanceSkill('PALADIN', 'Protection', [0, 40, 21]), 20, 'Sylvanor-style 0/40/21 holds 5/5 Anticipation (Protection row 4)');
    assert.strictEqual(V.defenseAllowanceSkill('PALADIN', 'Protection', [0, 19, 42]), 0, 'row 4 + 5 ranks needs 20 Protection points');
    assert.strictEqual(V.defenseAllowanceSkill('WARRIOR', 'Protection', [8, 5, 48]), 20, 'warrior Anticipation is Protection row 1');
    assert.strictEqual(V.defenseAllowanceSkill('WARRIOR', 'Protection', [33, 24, 4]), 0);
    assert.strictEqual(V.defenseAllowanceSkill('DRUID', 'Guardian', [0, 46, 15]), 0, 'no such talent for bears');
    assert.strictEqual(V.defenseAllowanceSkill('PALADIN', 'Protection', null), 0, 'no split, no allowance');
});
test('evaluate: a prot paladin at 471 from gear passes 490 once Anticipation is counted, and the note says so', () => {
    const r = V.evaluate(profile({ identity: { class: 'PALADIN', spec: 'Protection', role: 'tank', talentSplit: [0, 40, 21] },
        computed: { avgItemLevel: 123.35, meleeHit: 21, expertiseSkill: 0, defenseSkill: 471 } }), V.DEFAULT_THRESHOLDS, NOW);
    const d = r.rules.find(x => x.key === 'defense');
    assert.strictEqual(d.status, 'pass');
    assert.strictEqual(d.value, 491);
    assert.strictEqual(d.note, '471 + 20 from Anticipation = 491');
    assert.strictEqual(r.verdict, 'pass');
});
test('evaluate: a prot warrior whose split cannot hold Anticipation gets no allowance and the note explains why', () => {
    const r = V.evaluate(profile({ identity: { class: 'WARRIOR', spec: 'Protection', role: 'tank', talentSplit: [33, 24, 4] },
        computed: { avgItemLevel: 130, meleeHit: 0, expertiseSkill: 0, defenseSkill: 480 } }), V.DEFAULT_THRESHOLDS, NOW);
    const d = r.rules.find(x => x.key === 'defense');
    assert.strictEqual(d.status, 'fail');
    assert.strictEqual(d.value, 480);
    assert.strictEqual(d.note, 'Anticipation not reachable with 4 Protection (needs 5) — no allowance');
    assert.ok(r.reasons.indexOf('defense 480/490') !== -1, r.reasons.join(','));
});

test('parseReportCode (logs-first B1): a bare code, a report URL with a fragment, anything else null', () => {
    assert.strictEqual(V.parseReportCode('X6mnbPQpGhjJC2TN'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('  X6mnbPQpGhjJC2TN\n'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN#fight=3&type=damage-done'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN/'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('X6mnbPQpGhjJC2T'), null);
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/character/eu/spineshatter/utopik'), null);
    assert.strictEqual(V.parseReportCode(''), null);
    assert.strictEqual(V.parseReportCode(null), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
