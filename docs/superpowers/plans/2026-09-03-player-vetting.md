# Player Vetting Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Vetting" page in the web tool that, from a character name alone, shows gear, hit and other stats, enchants, sockets and parses from Warcraft Logs, and gives a pass / warn / fail / unverified verdict against editable thresholds.

**Architecture:** The server route `GET /api/vet/player` runs three Warcraft Logs (WCL) GraphQL queries, joins the logged gear with a committed, trimmed wowsims item table, and returns one profile object. A pure UMD module `vet-engine.js` holds all stat math, spec/role detection, cap arithmetic and rule evaluation, shared by the server (via `vet-profile.js`) and the browser page. The page `vetting.html` renders a table with a threshold strip and a detail panel.

**Tech Stack:** Node 18+ (no new dependencies), Express 4, vanilla browser JS, the repo's hand-rolled `assert`-based node test runner (`node <file>.test.js`), headless Chrome over CDP for the browser smoke check.

**Spec:** `docs/superpowers/specs/2026-09-03-player-vetting-design.md`

## Global Constraints

- No new npm dependencies (`package.json` has only `express`).
- Node `>=18`; the server uses global `fetch`.
- WCL classic API v2 at `https://classic.warcraftlogs.com/api/v2/client`, authenticated by the existing `getWclToken()` / `wclQuery()` in `server.js`. Never hardcode credentials; they come from `.env` (`WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`).
- Current tier zone id **1060** (BT / Hyjal). Previous tier **1056** (SSC / TK) is the parse fallback. Both addressed by id, never looked up in `worldData.zones`.
- `calibration/vendor/` is gitignored. The server reads **`data/tbc-item-db.json`**, which is committed; never read `calibration/vendor/tbc-new/assets/database/db.json` at runtime.
- UMD module pattern exactly as in `wcl-mult.js` (works under `require` and as a browser global).
- Test files follow `wcl-mult.test.js`: `assert` from `node:assert`, a local `test(name, fn)` helper, a final `${passed} passed, ${failed} failed` line and `process.exitCode = failed ? 1 : 0`.
- Level-70 rating constants: 15.77 rating per 1% melee/ranged hit, 12.62 per 1% spell hit, 3.94 rating per expertise skill point, 2.37 defense rating per defense skill point, base defense skill 350.
- Rules default (spec §6): ilvl ≥ 125, melee/ranged hit ≥ 142, spell hit ≥ 202, expertise skill ≥ 26 (warn only), defense skill ≥ 490, median parse ≥ 40, enchants missing warn ≥ 1 / fail ≥ 3, empty sockets warn ≥ 1 / fail ≥ 3, data age warn past 28 days.
- Every failure on the page is a row state. No `alert()`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `calibration/extract-item-db.mjs` (create) | Reads the gitignored wowsims `db.json`, writes the trimmed `data/tbc-item-db.json`. Run by hand per wowsims update. |
| `data/tbc-item-db.json` (create, committed) | Items, gems, enchants with sparse stats. Read by the server. |
| `fixtures/wcl-vet-nottomwro.json` (already on disk, untracked) | Real WCL responses captured 2026-09-03 for one Spineshatter enhancement shaman. Used by every fixture test. |
| `vet-engine.js` (create) | Pure logic: slot table, stat sums, socket bonuses, spec/role detection, hit allowances, thresholds, rule evaluation, sorting. |
| `vet-engine.test.js` (create) | Node tests for the above. |
| `vet-profile.js` (create) | Node-only: WCL query strings, `fetchProfile(query, params, dbIndex)` orchestration with zone fallback, `buildProfile(...)` join. |
| `vet-profile.test.js` (create) | Node tests with a stubbed `query`. |
| `server.js` (modify) | Load the item table lazily, add `GET /api/vet/player` with a 15-minute cache. |
| `assignments-engine.js` (modify) | Export `SPECS_BY_ARCHETYPE` so `vet-engine.js` can derive roles from it. |
| `vetting.html`, `vetting.js`, `vetting.css` (create) | The page. |
| `assignments.html`, `positions.html` (modify) | Add the "Vetting" tab. |
| `package.json` (modify) | Add the two new test files to `npm test`. |
| `README.md` (modify) | Document the page and the extractor. |

---

### Task 1: Trimmed item table and the WCL fixture

**Files:**
- Create: `calibration/extract-item-db.mjs`
- Create: `data/tbc-item-db.json` (generated)
- Create: `data/tbc-item-db.test.js`
- Commit: `fixtures/wcl-vet-nottomwro.json` (already written to disk during design; verify it exists)
- Modify: `package.json` (test script)

**Interfaces:**
- Produces `data/tbc-item-db.json` with shape:
  ```
  { generatedAt: "YYYY-MM-DD", source: "wowsims/tbc-new assets/database/db.json",
    items:    [ { id, name, type, handType?, weaponType?, rangedWeaponType?, ilvl, quality,
                  gemSockets: [colorCode…], socketBonus: {statIdx: value}, stats: {statIdx: value} } ],
    gems:     [ { id, name, color, stats: {statIdx: value} } ],
    enchants: [ { effectId, name, type, stats: {statIdx: value} } ] }
  ```
  Stat indices follow the wowsims `Stat` enum (0 str, 1 agi, 2 sta, 3 int, 4 healing, 5 spell dmg, 12 spell hit, 13 spell crit, 14 spell haste, 16 spirit, 17 AP, 18 RAP, 20 melee hit, 21 melee crit, 22 melee haste, 23 ArP, 24 expertise, 25 defense, 26 block rating, 27 block value, 28 dodge, 29 parry, 31 armor, 35 mp5).
  Colour codes: 1 meta, 2 red, 3 blue, 4 yellow, 5 green, 6 orange, 7 purple, 8 prismatic. Item `type`: 1 head, 2 neck, 3 shoulder, 4 back, 5 chest, 6 wrist, 7 hands, 8 waist, 9 legs, 10 feet, 11 finger, 12 trinket, 13 weapon, 14 ranged. `handType`: 1 main hand, 2 one hand, 3 off hand, 4 two hand. `weaponType` 5 = held in off hand, 7 = shield. `rangedWeaponType` 1 bow, 2 crossbow, 3 gun, 4 thrown, 5 wand, 6–9 relics.

- [ ] **Step 1: Confirm the fixture exists and inspect it**

Run: `ls -la fixtures/wcl-vet-nottomwro.json && node -e 'const f=require("./fixtures/wcl-vet-nottomwro.json"); console.log(f.character.classID, f.report.actors[0].name, f.report.combatant.gear.length, f.zoneRankings["1060"].rankings.length)'`
Expected: file exists (~31 KB); prints `9 Nottomwro 19 14`.
If the file is missing, recreate it with the capture script in the spec §9 (character `Nottomwro`, server `spineshatter`, region `eu`, zones 1060 and 1056, first fight of the newest report, actors trimmed to that one player). The fixture keys must be `character.{id,classID,recentReports}`, `zoneRankings.{"1060","1056"}`, `report.{code,startTime,fight,actors,combatant}`.

- [ ] **Step 2: Write the failing test for the item table**

Create `data/tbc-item-db.test.js`:

```js
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node data/tbc-item-db.test.js`
Expected: throws `ENOENT ... tbc-item-db.json` (the table does not exist yet).

- [ ] **Step 4: Write the extractor**

Create `calibration/extract-item-db.mjs`:

```js
#!/usr/bin/env node
// Trims the pinned wowsims item database down to what the vetting page needs and writes it to
// data/tbc-item-db.json, which IS committed. calibration/vendor/ is gitignored, so the server
// must never read db.json directly — a fresh checkout or the Railway deploy would not have it.
//
// Run from the repo root after updating the wowsims checkout:
//   node calibration/extract-item-db.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = new URL('./vendor/tbc-new/assets/database/db.json', import.meta.url);
const OUT = new URL('../data/tbc-item-db.json', import.meta.url);

// wowsims stores stats as a 42-slot array (gems, enchants, socket bonuses) or as an object
// keyed by stat index (items). Both become { index: value } with zeros dropped.
function sparse(stats) {
    const out = {};
    if (Array.isArray(stats)) stats.forEach((v, i) => { if (v) out[i] = v; });
    else if (stats && typeof stats === 'object') Object.keys(stats).forEach(k => { if (stats[k]) out[k] = stats[k]; });
    return out;
}

const db = JSON.parse(readFileSync(SRC, 'utf8'));

const items = db.items
    .filter(i => i.scalingOptions && i.scalingOptions['0'])
    .map(i => {
        const so = i.scalingOptions['0'];
        const o = { id: i.id, name: i.name, type: i.type || 0, ilvl: so.ilvl || 0, quality: i.quality || 0,
                    gemSockets: i.gemSockets || [], socketBonus: sparse(i.socketBonus), stats: sparse(so.stats) };
        if (i.handType) o.handType = i.handType;
        if (i.weaponType) o.weaponType = i.weaponType;
        if (i.rangedWeaponType) o.rangedWeaponType = i.rangedWeaponType;
        return o;
    });
const gems = db.gems.map(g => ({ id: g.id, name: g.name, color: g.color || 0, stats: sparse(g.stats) }));
const enchants = db.enchants.map(e => ({ effectId: e.effectId, name: e.name, type: e.type || 0, stats: sparse(e.stats) }));

const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'wowsims/tbc-new assets/database/db.json',
    items, gems, enchants,
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`wrote ${items.length} items, ${gems.length} gems, ${enchants.length} enchants`);
```

- [ ] **Step 5: Generate the table and run the test**

Run: `node calibration/extract-item-db.mjs && ls -la data/tbc-item-db.json && node data/tbc-item-db.test.js`
Expected: `wrote 8257 items, 214 gems, 141 enchants` (counts may differ by a few if the checkout moved), a file around 1 MB, and `6 passed, 0 failed`.

- [ ] **Step 6: Wire the test into npm test**

In `package.json`, change the `test` script to:

```
"test": "node assignments-engine.test.js && node wcl-mult.test.js && node hyjal-positions.test.js && node data/tbc-item-db.test.js"
```

Run: `npm test`
Expected: every suite prints its `N passed, 0 failed` line; exit code 0.

- [ ] **Step 7: Commit**

```bash
git add calibration/extract-item-db.mjs data/tbc-item-db.json data/tbc-item-db.test.js fixtures/wcl-vet-nottomwro.json package.json
git commit -m "feat: committed trimmed wowsims item table and a real WCL vetting fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: vet-engine — gear summary and stat sums

**Files:**
- Create: `vet-engine.js`
- Create: `vet-engine.test.js`
- Modify: `assignments-engine.js` (export `SPECS_BY_ARCHETYPE`, around line 2528 in the `return {…}` block)
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `data/tbc-item-db.json` shape from Task 1; `AssignmentsEngine.SPEC_TREES`, `AssignmentsEngine.inferSpec(cls, points)` (existing), `AssignmentsEngine.SPECS_BY_ARCHETYPE` (exported here).
- Produces (all on the module object `VetEngine`):
  - `STAT` — named stat indices, e.g. `STAT.MELEE_HIT === 20`.
  - `SLOTS` — 17-entry array of `{ key, wclIndex, label }` in this order: head(0), neck(1), shoulder(2), chest(4), waist(5), legs(6), feet(7), wrist(8), hands(9), finger1(10), finger2(11), trinket1(12), trinket2(13), back(14), mainHand(15), offHand(16), ranged(17). WCL indices 3 (shirt) and 18 (tabard) are skipped.
  - `indexDb(dbJson) -> { items: Map<id,item>, gems: Map<id,gem>, enchants: Map<effectId,enchant> }`
  - `summarizeGear(wclGear, dbIndex, classToken) -> { slots, avgItemLevel, stats, missingEnchants, emptySockets, unknownItems, socketBonusesApplied: true, setBonusesApplied: false }` where each `slots[i]` is `{ key, label, id, name, itemLevel, quality, enchant: {id,name}|null, gems: [{id,name}], sockets: number, emptySockets: number, enchantable: boolean }` or `{ key, label, id: 0, empty: true }` for an empty slot; `stats` is `{ statIdx: total }`.
  - `RATING` — `{ MELEE_HIT_PER_PCT: 15.77, SPELL_HIT_PER_PCT: 12.62, EXPERTISE_PER_POINT: 3.94, DEFENSE_PER_POINT: 2.37, BASE_DEFENSE: 350 }`.
  - `derivedStats(stats, reported) -> computed` per spec §3.2: `{ spellDamage, healing, attackPower, rangedAttackPower, defenseRating, defenseSkill, expertiseRating, expertiseSkill, mp5, spellHit, meleeHit, rangedHit, spellCrit, meleeCrit, meleeHaste, spellHaste, armor, strength, agility, stamina, intellect, spirit }`. Ratings come from `reported` when present and non-null, otherwise from `stats`. `meleeHit` uses `reported.hitMelee`, `rangedHit` uses `reported.hitRanged`, `spellHit` uses `reported.hitSpell`, `expertiseRating` uses `reported.expertise`; `expertiseSkill = Math.floor(expertiseRating / 3.94)`; `defenseSkill = 350 + Math.floor(defenseRating / 2.37)`. `attackPower`, `spellDamage`, `healing`, `mp5`, `defenseRating` are gear-only (WCL does not report them).

- [ ] **Step 1: Export SPECS_BY_ARCHETYPE from the engine**

In `assignments-engine.js`, in the final `return { … }` block, change the line
`specKey, BASELINE, BUFF_V, PARTY_BUFFS, groupBuffs, layoutViolations,` to
`specKey, BASELINE, BUFF_V, PARTY_BUFFS, SPECS_BY_ARCHETYPE, groupBuffs, layoutViolations,`.

Run: `node assignments-engine.test.js | tail -1`
Expected: unchanged pass count, `0 failed`.

- [ ] **Step 2: Write the failing tests**

Create `vet-engine.test.js`:

```js
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
```

- [ ] **Step 3: Run to verify failure**

Run: `node vet-engine.test.js`
Expected: `Cannot find module './vet-engine.js'`.

- [ ] **Step 4: Implement vet-engine.js (gear part)**

Create `vet-engine.js`:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.VetEngine = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    // wowsims Stat enum indices (proto/common.proto). Only the ones the page reads are named.
    const STAT = {
        STRENGTH: 0, AGILITY: 1, STAMINA: 2, INTELLECT: 3, HEALING: 4, SPELL_DAMAGE: 5,
        SPELL_HIT: 12, SPELL_CRIT: 13, SPELL_HASTE: 14, SPIRIT: 16,
        ATTACK_POWER: 17, RANGED_ATTACK_POWER: 18, MELEE_HIT: 20, MELEE_CRIT: 21, MELEE_HASTE: 22,
        ARMOR_PEN: 23, EXPERTISE: 24, DEFENSE: 25, BLOCK_RATING: 26, BLOCK_VALUE: 27,
        DODGE: 28, PARRY: 29, ARMOR: 31, MP5: 35,
    };

    const RATING = {
        MELEE_HIT_PER_PCT: 15.77, SPELL_HIT_PER_PCT: 12.62,
        EXPERTISE_PER_POINT: 3.94, DEFENSE_PER_POINT: 2.37, BASE_DEFENSE: 350,
    };

    // WCL's combatantinfo gear array is in inventory-slot order; 3 (shirt) and 18 (tabard) are
    // cosmetic and skipped.
    const SLOTS = [
        { key: 'head', wclIndex: 0, label: 'Head' }, { key: 'neck', wclIndex: 1, label: 'Neck' },
        { key: 'shoulder', wclIndex: 2, label: 'Shoulder' }, { key: 'chest', wclIndex: 4, label: 'Chest' },
        { key: 'waist', wclIndex: 5, label: 'Waist' }, { key: 'legs', wclIndex: 6, label: 'Legs' },
        { key: 'feet', wclIndex: 7, label: 'Feet' }, { key: 'wrist', wclIndex: 8, label: 'Wrist' },
        { key: 'hands', wclIndex: 9, label: 'Hands' }, { key: 'finger1', wclIndex: 10, label: 'Ring 1' },
        { key: 'finger2', wclIndex: 11, label: 'Ring 2' }, { key: 'trinket1', wclIndex: 12, label: 'Trinket 1' },
        { key: 'trinket2', wclIndex: 13, label: 'Trinket 2' }, { key: 'back', wclIndex: 14, label: 'Back' },
        { key: 'mainHand', wclIndex: 15, label: 'Main hand' }, { key: 'offHand', wclIndex: 16, label: 'Off hand' },
        { key: 'ranged', wclIndex: 17, label: 'Ranged' },
    ];

    // Gem colour -> socket colours it satisfies (wowsims GemColor: 1 meta 2 red 3 blue 4 yellow
    // 5 green 6 orange 7 purple 8 prismatic).
    const GEM_FITS = { 1: [1], 2: [2], 3: [3], 4: [4], 5: [3, 4], 6: [2, 4], 7: [2, 3], 8: [2, 3, 4] };

    const ALWAYS_ENCHANTABLE = { head: 1, shoulder: 1, back: 1, chest: 1, wrist: 1, hands: 1, legs: 1, feet: 1, mainHand: 1 };
    const WEAPON_TYPE_HELD = 5;
    const RANGED_ENCHANTABLE = { 1: true, 2: true, 3: true }; // bow, crossbow, gun (scopes)

    function indexDb(db) {
        return {
            items: new Map(db.items.map(i => [i.id, i])),
            gems: new Map(db.gems.map(g => [g.id, g])),
            enchants: new Map(db.enchants.map(e => [e.effectId, e])),
        };
    }

    function addStats(into, stats) {
        if (!stats) return;
        Object.keys(stats).forEach(k => { into[k] = (into[k] || 0) + stats[k]; });
    }

    function isEnchantable(slotKey, item, classToken, ringEnchanter) {
        if (ALWAYS_ENCHANTABLE[slotKey]) return true;
        // A weapon or a shield can be enchanted; a held-in-off-hand item cannot.
        if (slotKey === 'offHand') return !!item && item.type === 13 && item.weaponType !== WEAPON_TYPE_HELD;
        if (slotKey === 'ranged') return classToken === 'HUNTER' && !!item && !!RANGED_ENCHANTABLE[item.rangedWeaponType];
        if (slotKey === 'finger1' || slotKey === 'finger2') return ringEnchanter;
        return false;
    }

    function summarizeGear(wclGear, db, classToken) {
        const gear = Array.isArray(wclGear) ? wclGear : [];
        const stats = {};
        const unknownItems = [];
        // An enchanted ring means the player is an enchanter, so both rings count as enchantable.
        const ringEnchanter = [10, 11].some(i => gear[i] && gear[i].id && gear[i].permanentEnchant);
        let ilvlSum = 0, missingEnchants = 0, emptySockets = 0;
        const slots = SLOTS.map(slot => {
            const g = gear[slot.wclIndex];
            if (!g || !g.id) return { key: slot.key, label: slot.label, id: 0, empty: true };
            const item = db.items.get(g.id);
            if (!item) unknownItems.push(g.id);
            const itemLevel = g.itemLevel || (item && item.ilvl) || 0;
            ilvlSum += itemLevel;
            addStats(stats, item && item.stats);
            let enchant = null;
            if (g.permanentEnchant) {
                const e = db.enchants.get(g.permanentEnchant);
                enchant = { id: g.permanentEnchant, name: e ? e.name : 'Unknown enchant ' + g.permanentEnchant };
                addStats(stats, e && e.stats);
            }
            const sockets = item ? (item.gemSockets || []) : [];
            const gemsIn = (g.gems || []).map(x => {
                const gem = db.gems.get(x.id);
                addStats(stats, gem && gem.stats);
                return { id: x.id, name: gem ? gem.name : 'Unknown gem ' + x.id, color: gem ? gem.color : 0 };
            });
            const slotEmpty = Math.max(0, sockets.length - gemsIn.length);
            emptySockets += slotEmpty;
            const bonusActive = sockets.length > 0 && slotEmpty === 0 &&
                sockets.every((c, j) => gemsIn[j] && (GEM_FITS[gemsIn[j].color] || []).indexOf(c) !== -1);
            if (bonusActive) addStats(stats, item.socketBonus);
            const enchantable = isEnchantable(slot.key, item, classToken, ringEnchanter);
            if (enchantable && !enchant) missingEnchants++;
            return {
                key: slot.key, label: slot.label, id: g.id, name: item ? item.name : 'Unknown item ' + g.id,
                itemLevel, quality: g.quality != null ? g.quality : (item ? item.quality : 0),
                enchant, gems: gemsIn.map(x => ({ id: x.id, name: x.name })), sockets: sockets.length,
                emptySockets: slotEmpty, socketBonusActive: bonusActive, enchantable,
            };
        });
        return {
            slots, avgItemLevel: Math.round(ilvlSum / SLOTS.length * 100) / 100, stats,
            missingEnchants, emptySockets, unknownItems,
            socketBonusesApplied: true, setBonusesApplied: false,
        };
    }

    function pick(reported, key, fallback) {
        return reported && typeof reported[key] === 'number' ? reported[key] : (fallback || 0);
    }

    function derivedStats(stats, reported) {
        const s = stats || {};
        const expertiseRating = pick(reported, 'expertise', s[STAT.EXPERTISE]);
        const defenseRating = s[STAT.DEFENSE] || 0;
        return {
            spellDamage: s[STAT.SPELL_DAMAGE] || 0, healing: s[STAT.HEALING] || 0,
            attackPower: s[STAT.ATTACK_POWER] || 0, rangedAttackPower: s[STAT.RANGED_ATTACK_POWER] || 0,
            mp5: s[STAT.MP5] || 0,
            defenseRating, defenseSkill: RATING.BASE_DEFENSE + Math.floor(defenseRating / RATING.DEFENSE_PER_POINT),
            expertiseRating, expertiseSkill: Math.floor(expertiseRating / RATING.EXPERTISE_PER_POINT),
            meleeHit: pick(reported, 'hitMelee', s[STAT.MELEE_HIT]),
            rangedHit: pick(reported, 'hitRanged', s[STAT.MELEE_HIT]),
            spellHit: pick(reported, 'hitSpell', s[STAT.SPELL_HIT]),
            meleeCrit: pick(reported, 'critMelee', s[STAT.MELEE_CRIT]),
            spellCrit: pick(reported, 'critSpell', s[STAT.SPELL_CRIT]),
            meleeHaste: pick(reported, 'hasteMelee', s[STAT.MELEE_HASTE]),
            spellHaste: pick(reported, 'hasteSpell', s[STAT.SPELL_HASTE]),
            armor: pick(reported, 'armor', s[STAT.ARMOR]),
            strength: pick(reported, 'strength', s[STAT.STRENGTH]), agility: pick(reported, 'agility', s[STAT.AGILITY]),
            stamina: pick(reported, 'stamina', s[STAT.STAMINA]), intellect: pick(reported, 'intellect', s[STAT.INTELLECT]),
            spirit: pick(reported, 'spirit', s[STAT.SPIRIT]),
        };
    }

    return { STAT, RATING, SLOTS, GEM_FITS, indexDb, summarizeGear, derivedStats };
}));
```

- [ ] **Step 5: Run the tests**

Run: `node vet-engine.test.js`
Expected: `11 passed, 0 failed`.

- [ ] **Step 6: Add to npm test and commit**

`package.json` test script becomes:
```
"test": "node assignments-engine.test.js && node wcl-mult.test.js && node hyjal-positions.test.js && node data/tbc-item-db.test.js && node vet-engine.test.js"
```

Run: `npm test` — expected all suites `0 failed`.

```bash
git add vet-engine.js vet-engine.test.js assignments-engine.js package.json
git commit -m "feat: vet-engine gear summary and stat sums from logged gear

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: vet-engine — spec/role detection, hit allowances, rules and verdict

**Files:**
- Modify: `vet-engine.js`
- Modify: `vet-engine.test.js`

**Interfaces:**
- Consumes: `E.SPEC_TREES`, `E.inferSpec(cls, points) -> { spec, ambiguous }`, `E.SPECS_BY_ARCHETYPE` (Task 2).
- Produces on `VetEngine`:
  - `WCL_CLASS_IDS` — `{ 2:'DRUID', 3:'HUNTER', 4:'MAGE', 6:'PALADIN', 7:'PRIEST', 8:'ROGUE', 9:'SHAMAN', 10:'WARLOCK', 11:'WARRIOR' }` (verified against `gameData.classes` on 2026-09-03).
  - `normalizeWclSpec(classToken, name) -> spec | null` (`'Justicar'`→`'Protection'` for paladins, `'Gladiator'`→`'Protection'` for warriors, `'Guardian'` kept for druids, others matched against `SPEC_TREES` case-insensitively; unknown → null).
  - `roleOf(classToken, spec) -> 'tank' | 'healer' | 'melee' | 'ranged' | 'caster' | null` from `SPECS_BY_ARCHETYPE`: `healer`→healer; `bear`, `protWarrior`, `protPaladin`→tank; `caster`→caster; `hunter`→ranged; `wfMelee`, `enhShaman`, `feralCat`→melee.
  - `detectSpec(classToken, talentPoints, wclSpecName) -> { spec, role, detectedFrom: 'talents'|'wcl'|null, ambiguous }`. Talents first via `E.inferSpec`; when ambiguous or absent, `normalizeWclSpec`. A druid inferred `Feral` whose WCL label is `Guardian` becomes `Guardian`.
  - `TALENT_HIT_ALLOWANCE` — `{ 'WARRIOR:Arms': 3, 'WARRIOR:Fury': 3, 'ROGUE:Assassination': 5, 'ROGUE:Combat': 5, 'ROGUE:Subtlety': 5, 'SHAMAN:Enhancement': 6, 'HUNTER:Beast Mastery': 3, 'HUNTER:Marksmanship': 3, 'HUNTER:Survival': 3, 'MAGE:Fire': 3, 'MAGE:Frost': 3, 'MAGE:Arcane': 10, 'WARLOCK:Affliction': 10, 'PRIEST:Shadow': 10, 'DRUID:Balance': 4, 'SHAMAN:Elemental': 6 }` in percent.
  - `hitAllowanceRating(classToken, spec, role) -> number` — percent × 12.62 for casters, × 15.77 otherwise, rounded.
  - `DEFAULT_THRESHOLDS` — `{ ilvl: 125, meleeHit: 142, spellHit: 202, expertise: 26, defense: 490, parse: 40, enchantWarn: 1, enchantFail: 3, socketWarn: 1, socketFail: 3, staleDays: 28 }`.
  - `parseThresholds(obj) -> thresholds` — merges finite numbers from `obj` over the defaults; anything else falls back.
  - `evaluate(profile, thresholds, nowMs) -> { verdict, rules, reasons }` where `rules` is an array of `{ key, label, applies, status: 'pass'|'warn'|'fail'|'unknown', value, threshold, effective, note }`, `verdict` is `'pass'|'warn'|'fail'|'unverified'`, and `reasons` is the short list of labels for failed and warned rules (e.g. `['hit −24', 'enchants 2']`).
  - `VERDICT_ORDER` — `{ fail: 0, warn: 1, unverified: 2, pass: 3 }` and `sortRows(rows)` sorting by verdict then name (rows are `{ name, verdict }` plus anything).

Rule semantics (spec §6):

| key | applies when | value | status |
|---|---|---|---|
| `ilvl` | `computed` present | `computed.avgItemLevel` | fail if `< ilvl` |
| `hit` | role melee → `meleeHit`; ranged → `rangedHit`; caster → `spellHit`; tank/healer → not applicable | rating | effective = threshold − allowance; fail if `< effective` |
| `expertise` | role melee, or tank with class WARRIOR/PALADIN | `expertiseSkill` | warn if `< expertise` |
| `defense` | role tank and class ≠ DRUID | `defenseSkill` | fail if `< defense` |
| `parse` | always applies; unknown when `parses` null | `parses.medianPercent` | fail if `< parse` |
| `enchants` | `computed` present | `gearSummary.missingEnchants` | fail if `≥ enchantFail`, else warn if `≥ enchantWarn` |
| `sockets` | same | `gearSummary.emptySockets` | same with socket thresholds |
| `stale` | always; unknown when `lastSeen` null | days since `lastSeen.timestamp` | warn if `> staleDays` |

A rule whose data is absent has `status: 'unknown'`. A rule that does not apply to the role has `applies: false` and is skipped in the verdict. Verdict: any fail → `fail`; else any warn → `warn`; else any unknown → `unverified`; else `pass`.

The `profile` passed in is the server's profile (Task 4) and carries `identity.class`, `identity.spec`, `identity.role`, `computed`, `gearSummary: { missingEnchants, emptySockets }`, `gearOnly: { meleeHit, spellHit } | null` (the hit ratings summed from gear alone, before WCL's reported value replaced them), `parses`, `lastSeen`.

Spec §4 disagreement note: when `gearOnly` is present and the gear-summed hit differs from the value used by more than 5% of the role's threshold, the hit rule's `note` gets ` · gear sums to X, WCL reported Y` appended. That usually means the logged gear is not what was equipped at the pull.

- [ ] **Step 1: Append failing tests**

Append to `vet-engine.test.js` before the final summary lines:

```js
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
    assert.strictEqual(V.hitAllowanceRating('SHAMAN', 'Enhancement', 'melee'), 95);
    assert.strictEqual(V.hitAllowanceRating('ROGUE', 'Combat', 'melee'), 79);
    assert.strictEqual(V.hitAllowanceRating('PRIEST', 'Shadow', 'caster'), 126);
    assert.strictEqual(V.hitAllowanceRating('MAGE', 'Frost', 'caster'), 38);
    assert.strictEqual(V.hitAllowanceRating('PALADIN', 'Retribution', 'melee'), 0);
});
test('parseThresholds: finite numbers override, junk falls back to defaults', () => {
    const t = V.parseThresholds({ ilvl: '130', parse: 'abc', staleDays: null, bogus: 1 });
    assert.strictEqual(t.ilvl, 130);
    assert.strictEqual(t.parse, 40);
    assert.strictEqual(t.staleDays, 28);
    assert.strictEqual(t.bogus, undefined);
});

const NOW = Date.parse('2026-09-03T12:00:00Z');
function profile(over) {
    return Object.assign({
        identity: { class: 'SHAMAN', spec: 'Enhancement', role: 'melee' },
        computed: { avgItemLevel: 131.82, meleeHit: 171, rangedHit: 171, spellHit: 0, expertiseSkill: 0, defenseSkill: 350 },
        gearSummary: { missingEnchants: 0, emptySockets: 0 },
        parses: { medianPercent: 82.9, zone: 1060 },
        lastSeen: { timestamp: NOW - 2 * 86400e3 },
    }, over);
}
test('evaluate: the fixture-like enhancement shaman is a warn (expertise 0/26), nothing fails', () => {
    const r = V.evaluate(profile(), V.DEFAULT_THRESHOLDS, NOW);
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
    const mage = V.evaluate(profile({ identity: { class: 'MAGE', spec: 'Frost', role: 'caster' }, computed: { avgItemLevel: 130, spellHit: 164, expertiseSkill: 0, defenseSkill: 350 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(mage.rules.find(x => x.key === 'hit').status, 'pass');       // 164 >= 202-38
    assert.strictEqual(mage.rules.find(x => x.key === 'expertise').applies, false);
    const healer = V.evaluate(profile({ identity: { class: 'PRIEST', spec: 'Holy', role: 'healer' } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(healer.rules.find(x => x.key === 'hit').applies, false);
    const tank = V.evaluate(profile({ identity: { class: 'WARRIOR', spec: 'Protection', role: 'tank' }, computed: { avgItemLevel: 130, meleeHit: 0, expertiseSkill: 10, defenseSkill: 480 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(tank.verdict, 'fail');
    assert.strictEqual(tank.rules.find(x => x.key === 'defense').status, 'fail');
    assert.strictEqual(tank.rules.find(x => x.key === 'expertise').status, 'warn');
    const bear = V.evaluate(profile({ identity: { class: 'DRUID', spec: 'Guardian', role: 'tank' }, computed: { avgItemLevel: 130, defenseSkill: 350, expertiseSkill: 0 } }), V.DEFAULT_THRESHOLDS, NOW);
    assert.strictEqual(bear.rules.find(x => x.key === 'defense').applies, false);
    assert.strictEqual(bear.rules.find(x => x.key === 'expertise').applies, false);
});
test('evaluate: enchants and sockets warn at 1 and fail at 3; parse below threshold fails', () => {
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 1, emptySockets: 0 }, computed: profile().computed, }), V.DEFAULT_THRESHOLDS, NOW).rules.find(x => x.key === 'enchants').status, 'warn');
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 3, emptySockets: 0 } }), V.DEFAULT_THRESHOLDS, NOW).verdict, 'fail');
    assert.strictEqual(V.evaluate(profile({ gearSummary: { missingEnchants: 0, emptySockets: 4 } }), V.DEFAULT_THRESHOLDS, NOW).verdict, 'fail');
    assert.strictEqual(V.evaluate(profile({ parses: { medianPercent: 12, zone: 1060 } }), V.DEFAULT_THRESHOLDS, NOW).verdict, 'fail');
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
test('sortRows: fail, warn, unverified, pass, then by name', () => {
    const rows = [{ name: 'b', verdict: 'pass' }, { name: 'a', verdict: 'pass' }, { name: 'z', verdict: 'fail' }, { name: 'u', verdict: 'unverified' }, { name: 'w', verdict: 'warn' }];
    assert.deepStrictEqual(V.sortRows(rows).map(r => r.name), ['z', 'w', 'u', 'a', 'b']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node vet-engine.test.js | grep -c FAIL`
Expected: `12` (every new test fails with "is not a function").

- [ ] **Step 3: Implement**

In `vet-engine.js`, add before the `return` statement:

```js
    const WCL_CLASS_IDS = { 2: 'DRUID', 3: 'HUNTER', 4: 'MAGE', 6: 'PALADIN', 7: 'PRIEST', 8: 'ROGUE', 9: 'SHAMAN', 10: 'WARLOCK', 11: 'WARRIOR' };

    const WCL_SPEC_FOLD = { 'PALADIN:justicar': 'Protection', 'WARRIOR:gladiator': 'Protection', 'DRUID:guardian': 'Guardian' };

    function normalizeWclSpec(classToken, name) {
        if (!classToken || !name) return null;
        const cls = String(classToken).toUpperCase();
        const flat = String(name).toLowerCase().replace(/[^a-z]/g, '');
        const folded = WCL_SPEC_FOLD[cls + ':' + flat];
        if (folded) return folded;
        const trees = E.SPEC_TREES[cls] || [];
        const hit = trees.find(t => t.toLowerCase().replace(/[^a-z]/g, '') === flat);
        return hit || null;
    }

    const ARCHETYPE_ROLE = {
        healer: 'healer', bear: 'tank', protWarrior: 'tank', protPaladin: 'tank',
        caster: 'caster', hunter: 'ranged', wfMelee: 'melee', enhShaman: 'melee', feralCat: 'melee',
    };
    const ROLE_BY_SPEC = {};
    Object.keys(E.SPECS_BY_ARCHETYPE).forEach(a => E.SPECS_BY_ARCHETYPE[a].forEach(k => { ROLE_BY_SPEC[k] = ARCHETYPE_ROLE[a] || null; }));

    function roleOf(classToken, spec) {
        return ROLE_BY_SPEC[String(classToken).toUpperCase() + ':' + spec] || null;
    }

    function detectSpec(classToken, talentPoints, wclSpecName) {
        const cls = classToken ? String(classToken).toUpperCase() : null;
        let spec = null, detectedFrom = null, ambiguous = true;
        if (cls && Array.isArray(talentPoints) && talentPoints.length === 3) {
            const r = E.inferSpec(cls, talentPoints);
            if (r.spec && !r.ambiguous) { spec = r.spec; detectedFrom = 'talents'; ambiguous = false; }
        }
        const fromWcl = cls ? normalizeWclSpec(cls, wclSpecName) : null;
        if (!spec && fromWcl) { spec = fromWcl; detectedFrom = 'wcl'; }
        // Bear and cat share a tree; only WCL's kill classification can tell them apart.
        if (cls === 'DRUID' && spec === 'Feral' && fromWcl === 'Guardian') spec = 'Guardian';
        return { spec, role: spec ? roleOf(cls, spec) : null, detectedFrom, ambiguous };
    }

    // Hit granted by the talents every standard build takes, in percent (spec §6).
    const TALENT_HIT_ALLOWANCE = {
        'WARRIOR:Arms': 3, 'WARRIOR:Fury': 3,
        'ROGUE:Assassination': 5, 'ROGUE:Combat': 5, 'ROGUE:Subtlety': 5,
        'SHAMAN:Enhancement': 6,
        'HUNTER:Beast Mastery': 3, 'HUNTER:Marksmanship': 3, 'HUNTER:Survival': 3,
        'MAGE:Fire': 3, 'MAGE:Frost': 3, 'MAGE:Arcane': 10,
        'WARLOCK:Affliction': 10, 'PRIEST:Shadow': 10, 'DRUID:Balance': 4, 'SHAMAN:Elemental': 6,
    };

    function hitAllowanceRating(classToken, spec, role) {
        const pct = TALENT_HIT_ALLOWANCE[String(classToken).toUpperCase() + ':' + spec] || 0;
        const per = role === 'caster' ? RATING.SPELL_HIT_PER_PCT : RATING.MELEE_HIT_PER_PCT;
        return Math.round(pct * per);
    }

    const DEFAULT_THRESHOLDS = {
        ilvl: 125, meleeHit: 142, spellHit: 202, expertise: 26, defense: 490, parse: 40,
        enchantWarn: 1, enchantFail: 3, socketWarn: 1, socketFail: 3, staleDays: 28,
    };

    function parseThresholds(obj) {
        const t = Object.assign({}, DEFAULT_THRESHOLDS);
        if (obj && typeof obj === 'object') Object.keys(DEFAULT_THRESHOLDS).forEach(k => {
            const v = Number(obj[k]);
            if (obj[k] !== null && obj[k] !== '' && Number.isFinite(v)) t[k] = v;
        });
        return t;
    }

    function rule(key, label, applies, status, value, threshold, effective, note) {
        return { key, label, applies, status, value, threshold, effective, note: note || '' };
    }

    function evaluate(profile, thresholds, nowMs) {
        const t = parseThresholds(thresholds);
        const id = profile.identity || {};
        const cls = id.class ? String(id.class).toUpperCase() : null;
        const role = id.role || null;
        const c = profile.computed || null;
        const g = profile.gearSummary || null;
        const rules = [];

        rules.push(c ? rule('ilvl', 'item level', true, c.avgItemLevel < t.ilvl ? 'fail' : 'pass', c.avgItemLevel, t.ilvl, t.ilvl)
                     : rule('ilvl', 'item level', true, 'unknown', null, t.ilvl, t.ilvl, 'no gear data'));

        const hitApplies = role === 'melee' || role === 'ranged' || role === 'caster';
        if (!hitApplies) rules.push(rule('hit', 'hit', false, 'pass', null, null, null));
        else {
            const threshold = role === 'caster' ? t.spellHit : t.meleeHit;
            const allowance = hitAllowanceRating(cls, id.spec, role);
            const effective = threshold - allowance;
            const value = c ? (role === 'caster' ? c.spellHit : role === 'ranged' ? c.rangedHit : c.meleeHit) : null;
            let note = allowance ? threshold + ' − ' + allowance + ' from talents = ' + effective : '';
            const gearOnly = profile.gearOnly;
            if (c && gearOnly) {
                const fromGear = role === 'caster' ? gearOnly.spellHit : gearOnly.meleeHit;
                if (typeof fromGear === 'number' && Math.abs(fromGear - value) > 0.05 * threshold) {
                    note += (note ? ' · ' : '') + 'gear sums to ' + fromGear + ', WCL reported ' + value;
                }
            }
            rules.push(c ? rule('hit', 'hit', true, value < effective ? 'fail' : 'pass', value, threshold, effective, note)
                         : rule('hit', 'hit', true, 'unknown', null, threshold, effective, 'no gear data'));
        }

        const expApplies = role === 'melee' || (role === 'tank' && (cls === 'WARRIOR' || cls === 'PALADIN'));
        if (!expApplies) rules.push(rule('expertise', 'expertise', false, 'pass', null, null, null));
        else rules.push(c ? rule('expertise', 'expertise', true, c.expertiseSkill < t.expertise ? 'warn' : 'pass', c.expertiseSkill, t.expertise, t.expertise)
                          : rule('expertise', 'expertise', true, 'unknown', null, t.expertise, t.expertise, 'no gear data'));

        const defApplies = role === 'tank' && cls !== 'DRUID';
        if (!defApplies) rules.push(rule('defense', 'defense', false, 'pass', null, null, null));
        else rules.push(c ? rule('defense', 'defense', true, c.defenseSkill < t.defense ? 'fail' : 'pass', c.defenseSkill, t.defense, t.defense)
                          : rule('defense', 'defense', true, 'unknown', null, t.defense, t.defense, 'no gear data'));

        const p = profile.parses;
        rules.push(p && typeof p.medianPercent === 'number'
            ? rule('parse', 'parse', true, p.medianPercent < t.parse ? 'fail' : 'pass', Math.round(p.medianPercent), t.parse, t.parse, p.fallback ? 'previous tier' : '')
            : rule('parse', 'parse', true, 'unknown', null, t.parse, t.parse, 'no parses in either tier'));

        function countRule(key, label, value, warnAt, failAt) {
            if (!g) return rule(key, label, true, 'unknown', null, warnAt, warnAt, 'no gear data');
            const status = value >= failAt ? 'fail' : value >= warnAt ? 'warn' : 'pass';
            return rule(key, label, true, status, value, warnAt, failAt, 'warn at ' + warnAt + ', fail at ' + failAt);
        }
        rules.push(countRule('enchants', 'enchants missing', g ? g.missingEnchants : null, t.enchantWarn, t.enchantFail));
        rules.push(countRule('sockets', 'sockets empty', g ? g.emptySockets : null, t.socketWarn, t.socketFail));

        const ls = profile.lastSeen;
        if (ls && typeof ls.timestamp === 'number') {
            const days = Math.floor((nowMs - ls.timestamp) / 86400e3);
            rules.push(rule('stale', 'last seen', true, days > t.staleDays ? 'warn' : 'pass', days, t.staleDays, t.staleDays, days + ' days ago'));
        } else rules.push(rule('stale', 'last seen', true, 'unknown', null, t.staleDays, t.staleDays, 'never logged'));

        const live = rules.filter(r => r.applies);
        const verdict = live.some(r => r.status === 'fail') ? 'fail'
            : live.some(r => r.status === 'warn') ? 'warn'
            : live.some(r => r.status === 'unknown') ? 'unverified' : 'pass';

        const reasons = live.filter(r => r.status === 'fail' || r.status === 'warn').map(r => {
            if (r.key === 'hit') return 'hit ' + r.value + '/' + r.effective + ' (−' + (r.effective - r.value) + ')';
            if (r.key === 'enchants' || r.key === 'sockets') return r.label + ' ' + r.value;
            if (r.key === 'stale') return 'last seen ' + r.value + 'd ago';
            return r.label + ' ' + r.value + '/' + r.threshold;
        });
        return { verdict, rules, reasons };
    }

    const VERDICT_ORDER = { fail: 0, warn: 1, unverified: 2, pass: 3 };
    function sortRows(rows) {
        return rows.slice().sort((a, b) =>
            (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) || String(a.name).localeCompare(String(b.name)));
    }
```

and extend the return to:

```js
    return {
        STAT, RATING, SLOTS, GEM_FITS, WCL_CLASS_IDS, TALENT_HIT_ALLOWANCE, DEFAULT_THRESHOLDS, VERDICT_ORDER,
        indexDb, summarizeGear, derivedStats,
        normalizeWclSpec, roleOf, detectSpec, hitAllowanceRating, parseThresholds, evaluate, sortRows,
    };
```

- [ ] **Step 4: Run the tests**

Run: `node vet-engine.test.js`
Expected: `23 passed, 0 failed` (11 from Task 2 plus 12 here). If the `reasons` assertion in the "warn" test fails on the wording, the expected string is `expertise 0/26` — match the code to the test, not the other way round.

- [ ] **Step 5: Commit**

```bash
git add vet-engine.js vet-engine.test.js
git commit -m "feat: vet-engine spec/role detection, hit allowances and the verdict rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: vet-profile — WCL orchestration and the profile join (node only)

**Files:**
- Create: `vet-profile.js`
- Create: `vet-profile.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `VetEngine` (Tasks 2–3), the fixture, `query(graphql, variables) -> Promise<data>` injected by the caller (the server passes its `wclQuery`).
- Produces (module exports):
  - `ZONE_NAMES = { 1060: 'BT / Hyjal', 1056: 'SSC / TK' }`, `PREVIOUS_ZONE = { 1060: 1056 }`.
  - `CHAR_QUERY`, `REPORT_QUERY`, `RANK_QUERY` — the GraphQL strings.
  - `fetchProfile(query, { name, server, region, zone }, dbIndex, nowMs?) -> Promise<profile | null>` (null when WCL has no such character).
  - `buildProfile({ name, server, region, zone, classToken, combatant, report, rankings, rankingsZone, fallback, dbIndex }) -> profile` — pure.

Profile shape (spec §3.2 plus the fields the evaluator reads):

```
{ name, server, region, zone,
  identity: { class, spec, role, talentSplit, detectedFrom },
  lastSeen: { reportCode, fightName, timestamp } | null,
  gear: slots[] | null,                       // VetEngine.summarizeGear(...).slots
  gearSummary: { avgItemLevel, missingEnchants, emptySockets, unknownItems,
                 socketBonusesApplied, setBonusesApplied } | null,
  gearOnly: { meleeHit, spellHit } | null,   // summed from gear before reported values win
  reported: {…19 WCL fields…} | null,
  computed: VetEngine.derivedStats(...) + { avgItemLevel } | null,
  parses: { zone, zoneName, fallback, metric, medianPercent, bestPercent,
            bosses: [{ encounterId, name, medianPercent, bestPercent, kills, fastestKillMs }] } | null,
  missing: string[] }
```

Orchestration (spec §3.1):

1. `CHAR_QUERY` → `character { id classID recentReports(limit:3) { data { code startTime fights(killType:Encounters) { id name } } } }`. Null character → return `null`.
2. `classToken = VetEngine.WCL_CLASS_IDS[classID]`.
3. For each report (newest first) that has fights: `REPORT_QUERY` with `fightIDs: [lastFightId]` (the last fight of the report — the player is most likely present at the end of the night). Find the actor named `name` (case-insensitive) in `masterData.actors`, then the combatant row with that `sourceID`. First hit wins; stop querying. If none in three reports, `combatant = null` and `missing` gets `'no combatant data in last 3 reports'`.
4. `talentSplit = combatant ? combatant.talents.map(t => t.id) : null`; `detectSpec(classToken, talentSplit, null)`.
5. `metric = role === 'healer' ? 'hps' : 'dps'`. `RANK_QUERY(zone, metric)`. If no ranking has `totalKills > 0`, query `PREVIOUS_ZONE[zone]` with the same metric; `fallback = true` when the previous zone is used. If neither has kills, `rankings = null`.
6. If spec was still unknown, re-run `detectSpec(classToken, talentSplit, rankings.rankings[0].bestSpec)`; if that yields a healer and the metric was `dps`, re-query rankings with `hps` (same zone that had kills).
7. `buildProfile(...)`.

- [ ] **Step 1: Write the failing tests**

Create `vet-profile.test.js`:

```js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vet-engine.js');
const P = require('./vet-profile.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}
const pending = [];

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
const db = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));
const PARAMS = { name: 'Nottomwro', server: 'spineshatter', region: 'eu', zone: 1060 };
const NOW = Date.parse('2026-09-03T12:00:00Z');

// A stub WCL: answers by query kind and records what was asked.
function stubQuery(opts) {
    const o = Object.assign({ character: true, combatant: true, kills1060: true, kills1056: true }, opts);
    const calls = [];
    return { calls, query: async (q, vars) => {
        calls.push({ q, vars });
        if (q === P.CHAR_QUERY) return { characterData: { character: o.character ? { id: FX.character.id, classID: FX.character.classID, recentReports: FX.character.recentReports } : null } };
        if (q === P.REPORT_QUERY) {
            const combatant = o.combatant && vars.code === FX.report.code ? [FX.report.combatant] : [];
            return { reportData: { report: { masterData: { actors: FX.report.actors }, events: { data: combatant } } } };
        }
        if (q === P.RANK_QUERY) {
            const zr = JSON.parse(JSON.stringify(FX.zoneRankings[String(vars.zone)]));
            if ((vars.zone === 1060 && !o.kills1060) || (vars.zone === 1056 && !o.kills1056)) zr.rankings.forEach(r => { r.totalKills = 0; r.medianPercent = null; });
            if (vars.metric === 'hps') { zr.medianPerformanceAverage = 47.5; zr.rankings.forEach(r => { r.medianPercent = 47.5; }); }
            return { characterData: { character: { zoneRankings: zr } } };
        }
        throw new Error('unexpected query');
    } };
}

test('fetchProfile: happy path joins gear, reported stats, spec and current-tier parses', async () => {
    const s = stubQuery();
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.name, 'Nottomwro');
    assert.deepStrictEqual(p.identity, { class: 'SHAMAN', spec: 'Enhancement', role: 'melee', talentSplit: [2, 45, 14], detectedFrom: 'talents' });
    assert.strictEqual(p.gear.length, 17);
    assert.strictEqual(p.gearSummary.avgItemLevel, 131.82);
    assert.strictEqual(p.reported.hitMelee, 171);
    assert.strictEqual(p.computed.meleeHit, 171);
    assert.strictEqual(p.computed.attackPower, 870);
    assert.deepStrictEqual(p.gearOnly, { meleeHit: 171, spellHit: 0 });
    assert.strictEqual(p.parses.zone, 1060);
    assert.strictEqual(p.parses.zoneName, 'BT / Hyjal');
    assert.strictEqual(p.parses.fallback, false);
    assert.strictEqual(p.parses.metric, 'dps');
    assert.strictEqual(Math.round(p.parses.medianPercent), 83);
    assert.strictEqual(p.parses.bosses.length, 14);
    assert.strictEqual(p.parses.bosses[0].name, "High Warlord Naj'entus");
    assert.strictEqual(p.parses.bosses[0].kills, 2);
    assert.strictEqual(p.lastSeen.reportCode, FX.report.code);
    assert.strictEqual(p.lastSeen.timestamp, FX.report.startTime);
    assert.deepStrictEqual(p.missing, []);
    // One report query only: the first report had the row.
    assert.strictEqual(s.calls.filter(c => c.q === P.REPORT_QUERY).length, 1);
    assert.strictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).length, 1);
});

test('fetchProfile: unknown character returns null', async () => {
    const s = stubQuery({ character: false });
    assert.strictEqual(await P.fetchProfile(s.query, PARAMS, db, NOW), null);
});

test('fetchProfile: no combatant row in three reports → gear null, missing says so, parses still present', async () => {
    const s = stubQuery({ combatant: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.gear, null);
    assert.strictEqual(p.computed, null);
    assert.strictEqual(p.reported, null);
    assert.strictEqual(p.lastSeen, null);
    assert.deepStrictEqual(p.missing, ['no combatant data in last 3 reports']);
    assert.strictEqual(s.calls.filter(c => c.q === P.REPORT_QUERY).length, 3);
    // Spec falls back to WCL's label from the rankings.
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.identity.detectedFrom, 'wcl');
    assert.strictEqual(p.parses.zone, 1060);
});

test('fetchProfile: no kills in the current tier falls back to SSC/TK and says so', async () => {
    const s = stubQuery({ kills1060: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.parses.zone, 1056);
    assert.strictEqual(p.parses.zoneName, 'SSC / TK');
    assert.strictEqual(p.parses.fallback, true);
    assert.strictEqual(Math.round(p.parses.medianPercent), 52);
    assert.strictEqual(p.parses.bosses.length, 10);
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.zone), [1060, 1056]);
});

test('fetchProfile: no kills anywhere → parses null and a missing entry', async () => {
    const s = stubQuery({ kills1060: false, kills1056: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.parses, null);
    assert.ok(p.missing.indexOf('no parses in BT / Hyjal or SSC / TK') !== -1, p.missing.join(','));
});

test('fetchProfile: a healer is ranked by hps', async () => {
    // Force a healer: same fixture, but talents say Restoration (tree 3 of shaman).
    const s = stubQuery();
    const orig = s.query;
    s.query = async (q, vars) => {
        const d = await orig(q, vars);
        if (q === P.REPORT_QUERY && d.reportData.report.events.data.length) {
            const row = JSON.parse(JSON.stringify(d.reportData.report.events.data[0]));
            row.talents = [{ id: 0 }, { id: 8 }, { id: 53 }];
            d.reportData.report.events.data = [row];
        }
        return d;
    };
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.identity.role, 'healer');
    assert.strictEqual(p.parses.metric, 'hps');
    assert.strictEqual(p.parses.medianPercent, 47.5);
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.metric), ['hps']);
});

test('buildProfile: is pure and does not need the network', () => {
    const p = P.buildProfile({ name: 'X', server: 's', region: 'eu', zone: 1060, classToken: 'SHAMAN',
        combatant: FX.report.combatant, report: { code: FX.report.code, startTime: FX.report.startTime, fightName: FX.report.fight.name },
        rankings: FX.zoneRankings['1060'], rankingsZone: 1060, fallback: false, metric: 'dps', dbIndex: db });
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.gearSummary.missingEnchants, 0);
    assert.strictEqual(p.lastSeen.fightName, 'Hydross the Unstable');
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node vet-profile.test.js`
Expected: `Cannot find module './vet-profile.js'`.

- [ ] **Step 3: Implement vet-profile.js**

```js
'use strict';
// Node-only: turns Warcraft Logs answers into one vetting profile. The GraphQL `query`
// function is injected so the server passes its authenticated wclQuery and the tests pass a stub.
const V = require('./vet-engine.js');

const ZONE_NAMES = { 1060: 'BT / Hyjal', 1056: 'SSC / TK' };
const PREVIOUS_ZONE = { 1060: 1056 };
const RECENT_REPORTS = 3;

const CHAR_QUERY = 'query($name:String!,$server:String!,$region:String!){characterData{character(name:$name,serverSlug:$server,serverRegion:$region){' +
    'id classID recentReports(limit:' + RECENT_REPORTS + '){data{code startTime fights(killType:Encounters){id name}}}}}}';
const REPORT_QUERY = 'query($code:String!,$fights:[Int]!){reportData{report(code:$code){' +
    'masterData{actors(type:"Player"){id name server subType}} events(dataType:CombatantInfo,fightIDs:$fights,limit:100){data}}}}';
const RANK_QUERY = 'query($name:String!,$server:String!,$region:String!,$zone:Int!,$metric:CharacterRankingMetricType!){characterData{' +
    'character(name:$name,serverSlug:$server,serverRegion:$region){zoneRankings(zoneID:$zone,metric:$metric)}}}';

const REPORTED_FIELDS = ['hitMelee', 'hitRanged', 'hitSpell', 'expertise', 'critMelee', 'critRanged', 'critSpell',
    'hasteMelee', 'hasteRanged', 'hasteSpell', 'dodge', 'parry', 'block', 'armor',
    'strength', 'agility', 'stamina', 'intellect', 'spirit'];

function hasKills(zr) {
    return !!(zr && Array.isArray(zr.rankings) && zr.rankings.some(r => r && r.totalKills > 0));
}

function buildParses(rankings, zone, fallback, metric) {
    if (!hasKills(rankings)) return null;
    return {
        zone, zoneName: ZONE_NAMES[zone] || String(zone), fallback: !!fallback, metric,
        medianPercent: typeof rankings.medianPerformanceAverage === 'number' ? rankings.medianPerformanceAverage : null,
        bestPercent: typeof rankings.bestPerformanceAverage === 'number' ? rankings.bestPerformanceAverage : null,
        bosses: rankings.rankings.map(r => ({
            encounterId: r.encounter && r.encounter.id, name: r.encounter && r.encounter.name,
            medianPercent: typeof r.medianPercent === 'number' ? r.medianPercent : null,
            bestPercent: typeof r.rankPercent === 'number' ? r.rankPercent : null,
            kills: r.totalKills || 0, fastestKillMs: r.fastestKill || null,
        })),
    };
}

function buildProfile(a) {
    const missing = [];
    const talentSplit = a.combatant && Array.isArray(a.combatant.talents) ? a.combatant.talents.map(t => t.id) : null;
    const wclSpec = a.rankings && a.rankings.rankings && a.rankings.rankings[0] ? (a.rankings.rankings[0].bestSpec || a.rankings.rankings[0].spec) : null;
    const det = V.detectSpec(a.classToken, talentSplit, wclSpec);
    let gear = null, gearSummary = null, gearOnly = null, reported = null, computed = null, lastSeen = null;
    if (a.combatant) {
        const s = V.summarizeGear(a.combatant.gear, a.dbIndex, a.classToken);
        gear = s.slots;
        gearSummary = { avgItemLevel: s.avgItemLevel, missingEnchants: s.missingEnchants, emptySockets: s.emptySockets,
                        unknownItems: s.unknownItems, socketBonusesApplied: s.socketBonusesApplied, setBonusesApplied: s.setBonusesApplied };
        gearOnly = { meleeHit: s.stats[V.STAT.MELEE_HIT] || 0, spellHit: s.stats[V.STAT.SPELL_HIT] || 0 };
        reported = {};
        REPORTED_FIELDS.forEach(k => { reported[k] = typeof a.combatant[k] === 'number' ? a.combatant[k] : null; });
        computed = Object.assign(V.derivedStats(s.stats, reported), { avgItemLevel: s.avgItemLevel });
        if (s.unknownItems.length) missing.push('items not in the table: ' + s.unknownItems.join(', '));
        lastSeen = { reportCode: a.report.code, fightName: a.report.fightName, timestamp: a.report.startTime };
    } else {
        missing.push('no combatant data in last ' + RECENT_REPORTS + ' reports');
    }
    const parses = buildParses(a.rankings, a.rankingsZone, a.fallback, a.metric);
    if (!parses) missing.push('no parses in ' + ZONE_NAMES[a.zone] + (PREVIOUS_ZONE[a.zone] ? ' or ' + ZONE_NAMES[PREVIOUS_ZONE[a.zone]] : ''));
    if (!det.spec) missing.push('spec could not be determined');
    return {
        name: a.name, server: a.server, region: a.region, zone: a.zone,
        identity: { class: a.classToken || null, spec: det.spec, role: det.role, talentSplit, detectedFrom: det.detectedFrom },
        lastSeen, gear, gearSummary, gearOnly, reported, computed, parses, missing,
    };
}

async function fetchProfile(query, params, dbIndex) {
    const { name, server, region, zone } = params;
    const cd = await query(CHAR_QUERY, { name, server, region });
    const ch = cd && cd.characterData && cd.characterData.character;
    if (!ch) return null;
    const classToken = V.WCL_CLASS_IDS[ch.classID] || null;

    let combatant = null, report = null;
    const reports = (ch.recentReports && ch.recentReports.data) || [];
    for (const rep of reports) {
        if (!rep.fights || !rep.fights.length) continue;
        const fight = rep.fights[rep.fights.length - 1];
        const rd = await query(REPORT_QUERY, { code: rep.code, fights: [fight.id] });
        const r = rd && rd.reportData && rd.reportData.report;
        if (!r) continue;
        const actor = (r.masterData.actors || []).find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
        const row = actor ? (r.events.data || []).find(e => e.sourceID === actor.id) : null;
        if (row) { combatant = row; report = { code: rep.code, startTime: rep.startTime, fightName: fight.name }; break; }
    }

    const talentSplit = combatant && Array.isArray(combatant.talents) ? combatant.talents.map(t => t.id) : null;
    let det = V.detectSpec(classToken, talentSplit, null);
    let metric = det.role === 'healer' ? 'hps' : 'dps';

    async function rank(z, m) {
        const d = await query(RANK_QUERY, { name, server, region, zone: z, metric: m });
        return d && d.characterData && d.characterData.character ? d.characterData.character.zoneRankings : null;
    }
    let rankingsZone = zone, fallback = false;
    let rankings = await rank(zone, metric);
    if (!hasKills(rankings) && PREVIOUS_ZONE[zone]) {
        const prev = await rank(PREVIOUS_ZONE[zone], metric);
        if (hasKills(prev)) { rankings = prev; rankingsZone = PREVIOUS_ZONE[zone]; fallback = true; }
    }
    if (!det.spec && hasKills(rankings)) {
        const first = rankings.rankings.find(r => r.totalKills > 0);
        det = V.detectSpec(classToken, talentSplit, first.bestSpec || first.spec);
        if (det.role === 'healer' && metric === 'dps') { metric = 'hps'; rankings = await rank(rankingsZone, metric); }
    }
    return buildProfile({ name, server, region, zone, classToken, combatant, report, rankings, rankingsZone, fallback, metric, dbIndex });
}

module.exports = { ZONE_NAMES, PREVIOUS_ZONE, CHAR_QUERY, REPORT_QUERY, RANK_QUERY, buildProfile, fetchProfile };
```

Check the `RANK_QUERY` enum name against the live schema before trusting it: run the probe in the spec §9 with `metric:$metric` typed as `CharacterRankingMetricType!`. If WCL rejects the variable type, inline the metric into the query string instead (`zoneRankings(zoneID:$zone,metric:dps)` built with string concatenation for `dps` / `hps`) and keep `vars.metric` in the call so the tests still see it: pass `metric` in the variables object even if the string does not reference it.

- [ ] **Step 4: Run the tests**

Run: `node vet-profile.test.js`
Expected: `7 passed, 0 failed`.

- [ ] **Step 5: Add to npm test and commit**

`package.json` test script becomes:
```
"test": "node assignments-engine.test.js && node wcl-mult.test.js && node hyjal-positions.test.js && node data/tbc-item-db.test.js && node vet-engine.test.js && node vet-profile.test.js"
```

```bash
git add vet-profile.js vet-profile.test.js package.json
git commit -m "feat: vet-profile joins WCL gear, stats and parses into one vetting profile

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Server route `/api/vet/player`

**Files:**
- Modify: `server.js` (after the `/api/wcl/player` route, before the AI review route)

**Interfaces:**
- Consumes: `wclQuery`, `wclErrorResponse` (existing), `vet-profile.fetchProfile`, `VetEngine.indexDb`.
- Produces: `GET /api/vet/player?name&server&region&zone` → `200 profile`, `404 { error: 'Character not found on Warcraft Logs' }`, `400` on bad params, `429 { error }` on WCL rate limit, `503` when credentials are missing, `500` when the item table cannot load. Response header `X-Vet-Cache: hit|miss`.

- [ ] **Step 1: Add the route**

Insert into `server.js` after the `/api/wcl/player` handler:

```js
// --- Player vetting: one profile per character from Warcraft Logs plus the committed item table.
const VetEngine = require('./vet-engine.js');
const VetProfile = require('./vet-profile.js');

let vetDbIndex = null;
function getVetDbIndex() {
  if (vetDbIndex) return vetDbIndex;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8'));
  vetDbIndex = VetEngine.indexDb(raw);
  return vetDbIndex;
}

const VET_CACHE_MS = 15 * 60 * 1000;
const vetCache = new Map(); // key -> { at, profile }

app.get('/api/vet/player', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone;
  const hit = vetCache.get(key);
  if (hit && Date.now() - hit.at < VET_CACHE_MS) { res.set('X-Vet-Cache', 'hit'); return res.json(hit.profile); }
  let db;
  try { db = getVetDbIndex(); }
  catch (err) { console.error('item table load failed:', err); return res.status(500).json({ error: 'Item table data/tbc-item-db.json is missing or unreadable' }); }
  try {
    const profile = await VetProfile.fetchProfile(wclQuery, { name, server, region, zone }, db);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    vetCache.set(key, { at: Date.now(), profile });
    res.set('X-Vet-Cache', 'miss');
    res.json(profile);
  } catch (err) { wclErrorResponse(res, err, 'WCL vetting lookup'); }
});
```

- [ ] **Step 2: Verify live against WCL**

Run (server in one shell, `npm start`; then):

```bash
curl -s 'http://localhost:3000/api/vet/player?name=Nottomwro&server=spineshatter&region=eu&zone=1060' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(p.identity, p.gearSummary, p.computed.meleeHit, p.parses && p.parses.zoneName, p.parses && Math.round(p.parses.medianPercent), p.missing)})'
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/vet/player?name=Nosuchplayerxyz&server=spineshatter&region=eu'
curl -s -D - -o /dev/null 'http://localhost:3000/api/vet/player?name=Nottomwro&server=spineshatter&region=eu&zone=1060' | grep -i x-vet-cache
```

Expected: the first prints identity `{ class: 'SHAMAN', spec: 'Enhancement', role: 'melee', … }`, a gear summary with `missingEnchants: 0`, melee hit `171`, `'BT / Hyjal'`, a median in the 80s (live numbers drift), and `missing: []`. The second prints `404`. The third prints `X-Vet-Cache: hit`. Paste the actual output into the commit message body or the task notes.

If `RANK_QUERY` errors with a GraphQL type message, apply the fallback described in Task 4 Step 3 and re-run `node vet-profile.test.js`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: /api/vet/player route with a 15-minute per-character cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Vetting page — inputs, thresholds, fetch queue, table

**Files:**
- Create: `vetting.html`, `vetting.js`, `vetting.css`
- Modify: `assignments.html` (nav, lines 12–15), `positions.html` (nav, lines 13–16)

**Interfaces:**
- Consumes: `/api/vet/player`, `VetEngine.{parseThresholds, DEFAULT_THRESHOLDS, evaluate, sortRows}`, local storage keys `raidAssignmentsState` (for `wcl.server` / `wcl.region`, and roster in Task 7) and `raidVettingState`.
- Produces: page state `{ players: [{ name }], thresholds, profiles: { [nameLower]: profile }, errors: { [nameLower]: string } }` in `raidVettingState`. Global functions on `window` for the smoke test: `vetAdd(name)`, `vetState()`.

Page anatomy (spec §3.3), all ids fixed so the smoke test and Task 7 can address them:

```
nav.page-tabs (Assignments / Positioning / Vetting active)
header  h1 "Player Vetting"  p "Gear, hit, enchants and parses from Warcraft Logs — before you invite"
section.panel#inputs
  div.import-row: input#nameInput placeholder "Character name"  button#addBtn "Add"
                  button#loadRosterBtn "Load roster"  button#refreshBtn "Refresh all"
  div.status#realmLine  e.g. "Realm: spineshatter (EU) — change on the Assignments page" | error when unset
section.panel#thresholds
  div.thresh-strip: eleven labelled number inputs with ids th-ilvl th-meleeHit th-spellHit th-expertise th-defense
                    th-parse th-enchantWarn th-enchantFail th-socketWarn th-socketFail th-staleDays
                    button#resetThresholds "Reset defaults"
section.panel#results
  div.status#summary   "3 pass · 1 warn · 2 fail · 1 unverified"   plus #rateLimit (hidden unless paused)
  table#vetTable  thead: Verdict | Name | Spec | iLvl | Hit | Expertise | Defense | Parse | Enchants | Sockets | Last seen | (x)
```

Cell rendering rules: each rule cell shows `value / threshold` (for hit: `value / effective`), with `(−n)` appended when under; class `cell-pass`, `cell-warn`, `cell-fail`, `cell-unknown` (`?` with `title` = rule note), `cell-na` (`—`) when the rule does not apply. The verdict cell shows the verdict word plus `reasons.join(', ')` in small text. The parse cell appends ` (SSC/TK)` when `parses.fallback`. A row whose fetch failed shows the verdict `error`, the message in the name cell's `title`, and every rule cell `?`.

- [ ] **Step 1: Create vetting.css**

```css
/* Vetting page — extends style.css + assignments.css */
.thresh-strip { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; }
.thresh-strip label { display: flex; flex-direction: column; font-size: 0.8em; color: #b0b0b0; gap: 3px; }
.thresh-strip input { width: 70px; background: rgba(0,0,0,0.3); border: 1px solid #555; border-radius: 6px; color: #e0e0e0; padding: 5px 6px; }
.table-wrap { overflow-x: auto; }
#vetTable { width: 100%; border-collapse: collapse; font-size: 0.92em; }
#vetTable th, #vetTable td { padding: 6px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
#vetTable th { color: #ffd700; font-weight: 600; }
#vetTable tbody tr { cursor: pointer; }
#vetTable tbody tr:hover { background: rgba(255,255,255,0.04); }
.cell-pass { color: #8fe38f; }
.cell-warn { color: #ffd166; }
.cell-fail { color: #ff6b6b; font-weight: 600; }
.cell-unknown, .cell-na { color: #777; }
.verdict { font-weight: 700; text-transform: uppercase; font-size: 0.85em; }
.verdict.pass { color: #8fe38f; } .verdict.warn { color: #ffd166; } .verdict.fail { color: #ff6b6b; }
.verdict.unverified { color: #9ab; } .verdict.error { color: #c77; }
.reasons { display: block; font-size: 0.8em; color: #b0b0b0; font-weight: 400; text-transform: none; }
.remove-btn { background: none; border: none; color: #888; cursor: pointer; font-size: 1em; }
.remove-btn:hover { color: #ff6b6b; }
.detail-row td { white-space: normal; background: rgba(0,0,0,0.25); }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.detail-grid h4 { color: #ffd700; margin: 0 0 6px; font-size: 0.95em; }
.detail-grid table { width: 100%; font-size: 0.85em; }
.detail-grid td { padding: 2px 6px; border: none; }
.slot-missing { color: #ff6b6b; }
.slot-ok { color: #8fe38f; }
@media (max-width: 1000px) { .detail-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Create vetting.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Player Vetting</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="assignments.css">
    <link rel="stylesheet" href="vetting.css">
</head>
<body>
    <div class="container">
        <nav class="page-tabs">
            <a href="./" class="page-tab">Assignments</a>
            <a href="positions.html" class="page-tab">Positioning</a>
            <a href="vetting.html" class="page-tab active">Vetting</a>
        </nav>
        <header>
            <h1>Player Vetting</h1>
            <p>Gear, hit, enchants and parses from Warcraft Logs — before you invite</p>
        </header>
        <section class="panel" id="inputs">
            <div class="import-row">
                <input id="nameInput" type="text" placeholder="Character name" autocomplete="off">
                <button id="addBtn" class="btn btn-primary">Add</button>
                <button id="loadRosterBtn" class="btn">Load roster</button>
                <button id="refreshBtn" class="btn">Refresh all</button>
            </div>
            <div class="status" id="realmLine"></div>
        </section>
        <section class="panel" id="thresholds">
            <h2>Thresholds</h2>
            <div class="thresh-strip" id="threshStrip"></div>
        </section>
        <section class="panel" id="results">
            <div class="status" id="summary">No players yet — add a name or load the roster.</div>
            <div class="warn hidden" id="rateLimit"></div>
            <div class="table-wrap">
                <table id="vetTable">
                    <thead><tr>
                        <th>Verdict</th><th>Name</th><th>Spec</th><th>iLvl</th><th>Hit</th><th>Expertise</th>
                        <th>Defense</th><th>Parse</th><th>Enchants</th><th>Sockets</th><th>Last seen</th><th></th>
                    </tr></thead>
                    <tbody id="vetBody"></tbody>
                </table>
            </div>
        </section>
    </div>
    <script src="assignments-engine.js"></script>
    <script src="vet-engine.js"></script>
    <script src="vetting.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create vetting.js**

```js
/* global AssignmentsEngine, VetEngine */
'use strict';
const V = VetEngine;
const STORAGE_KEY = 'raidVettingState';
const ASSIGN_KEY = 'raidAssignmentsState';
const ASSIGN_LINK_KEY = 'raidAssignmentsLinkMap';
const ZONE = 1060;
const CONCURRENCY = 3;
const RATE_LIMIT_PAUSE_MS = 60 * 1000;

const state = { players: [], thresholds: Object.assign({}, V.DEFAULT_THRESHOLDS), profiles: {}, errors: {} };
const wcl = { server: '', region: 'eu' };
let queue = [];
let inFlight = 0;
let pausedUntil = 0;
let expanded = null; // name (lower) whose detail row is open

function load() {
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch (e) { /* fresh */ }
    state.thresholds = V.parseThresholds(state.thresholds);
    try {
        const a = JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {};
        if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; }
    } catch (e) { /* no assignments state yet */ }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const THRESH_LABELS = [
    ['ilvl', 'Avg item level ≥'], ['meleeHit', 'Melee/ranged hit ≥'], ['spellHit', 'Spell hit ≥'],
    ['expertise', 'Expertise (skill) ≥'], ['defense', 'Defense ≥'], ['parse', 'Median parse ≥'],
    ['enchantWarn', 'Enchants missing: warn at'], ['enchantFail', 'fail at'],
    ['socketWarn', 'Sockets empty: warn at'], ['socketFail', 'fail at'], ['staleDays', 'Stale after (days)'],
];

function renderThresholds() {
    const strip = document.getElementById('threshStrip');
    strip.innerHTML = '';
    THRESH_LABELS.forEach(([key, label]) => {
        const l = document.createElement('label');
        l.textContent = label;
        const i = document.createElement('input');
        i.type = 'number'; i.id = 'th-' + key; i.value = state.thresholds[key];
        i.addEventListener('change', () => {
            state.thresholds = V.parseThresholds(Object.assign({}, state.thresholds, { [key]: i.value }));
            i.value = state.thresholds[key];
            save(); renderTable();
        });
        l.appendChild(i);
        strip.appendChild(l);
    });
    const reset = document.createElement('button');
    reset.id = 'resetThresholds'; reset.className = 'btn'; reset.textContent = 'Reset defaults';
    reset.addEventListener('click', () => { state.thresholds = Object.assign({}, V.DEFAULT_THRESHOLDS); save(); renderThresholds(); renderTable(); });
    strip.appendChild(reset);
}

function renderRealm() {
    const el = document.getElementById('realmLine');
    if (!wcl.server) {
        el.className = 'status error';
        el.innerHTML = 'No realm set — enter the Warcraft Logs realm slug under Player tuning on the <a href="./">Assignments page</a> first.';
    } else {
        el.className = 'status';
        el.innerHTML = 'Realm: <b>' + escapeHtml(wcl.server) + '</b> (' + escapeHtml(wcl.region.toUpperCase()) + ') — change on the <a href="./">Assignments page</a>.';
    }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- fetch queue ---
function enqueue(name, force) {
    const key = name.toLowerCase();
    if (!force && state.profiles[key]) return;
    if (queue.indexOf(key) === -1) queue.push(key);
    pump();
}
function pump() {
    if (Date.now() < pausedUntil) return;
    while (inFlight < CONCURRENCY && queue.length) {
        const key = queue.shift();
        inFlight++;
        fetchOne(key).finally(() => { inFlight--; pump(); });
    }
    renderSummary();
}
async function fetchOne(key) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player) return;
    delete state.errors[key];
    if (!wcl.server) { state.errors[key] = 'No realm set'; save(); renderTable(); return; }
    try {
        const url = '/api/vet/player?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(wcl.server) +
            '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE;
        const res = await fetch(url);
        if (res.status === 429) { queue.unshift(key); pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { state.errors[key] = body.error || ('HTTP ' + res.status); }
        else { state.profiles[key] = body; }
    } catch (err) { state.errors[key] = 'Network error: ' + err.message; }
    save(); renderTable();
}
function pause() {
    pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
    const el = document.getElementById('rateLimit');
    el.classList.remove('hidden');
    const tick = () => {
        const left = Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));
        el.textContent = 'Warcraft Logs rate limit reached — resuming in ' + left + 's (' + queue.length + ' waiting)';
        if (left > 0) setTimeout(tick, 1000);
        else { el.classList.add('hidden'); pump(); }
    };
    tick();
}

// --- players ---
function addPlayer(name) {
    const clean = String(name || '').trim().replace(/[^\p{L}\p{M}'-]/gu, '');
    if (clean.length < 2) return false;
    if (!state.players.some(p => p.name.toLowerCase() === clean.toLowerCase())) state.players.push({ name: clean });
    save(); renderTable(); enqueue(clean, false);
    return true;
}
function removePlayer(name) {
    const key = name.toLowerCase();
    state.players = state.players.filter(p => p.name.toLowerCase() !== key);
    delete state.profiles[key]; delete state.errors[key];
    queue = queue.filter(k => k !== key);
    save(); renderTable();
}

// --- table ---
function rows() {
    const now = Date.now();
    return state.players.map(p => {
        const key = p.name.toLowerCase();
        const profile = state.profiles[key];
        if (state.errors[key]) return { name: p.name, key, verdict: 'error', error: state.errors[key], profile: null, rules: [], reasons: [] };
        if (!profile) return { name: p.name, key, verdict: 'unverified', pending: true, profile: null, rules: [], reasons: ['fetching…'] };
        const ev = V.evaluate(profile, state.thresholds, now);
        return { name: p.name, key, verdict: ev.verdict, profile, rules: ev.rules, reasons: ev.reasons };
    });
}
function ruleCell(r) {
    const td = document.createElement('td');
    if (!r || !r.applies) { td.className = 'cell-na'; td.textContent = '—'; return td; }
    if (r.status === 'unknown') { td.className = 'cell-unknown'; td.textContent = '?'; td.title = r.note; return td; }
    td.className = 'cell-' + r.status;
    if (r.key === 'stale') td.textContent = r.value + 'd';
    else if (r.key === 'enchants' || r.key === 'sockets') td.textContent = String(r.value);
    else {
        const cap = r.key === 'hit' ? r.effective : r.threshold;
        td.textContent = r.value + ' / ' + cap + (r.value < cap ? ' (−' + (cap - r.value) + ')' : '');
    }
    td.title = r.note || '';
    return td;
}
function renderTable() {
    const body = document.getElementById('vetBody');
    body.innerHTML = '';
    const sorted = V.sortRows(rows().map(r => Object.assign({}, r, { verdict: r.verdict === 'error' ? 'unverified' : r.verdict, realVerdict: r.verdict })));
    sorted.forEach(r => {
        const tr = document.createElement('tr');
        tr.dataset.name = r.name;
        const verdictTd = document.createElement('td');
        verdictTd.innerHTML = '<span class="verdict ' + r.realVerdict + '">' + r.realVerdict + '</span>' +
            (r.reasons.length ? '<span class="reasons">' + escapeHtml(r.reasons.join(', ')) + '</span>' : '');
        tr.appendChild(verdictTd);
        const nameTd = document.createElement('td');
        nameTd.textContent = r.name;
        if (r.error) nameTd.title = r.error;
        tr.appendChild(nameTd);
        const specTd = document.createElement('td');
        specTd.textContent = r.profile && r.profile.identity.spec ? r.profile.identity.spec : '?';
        if (r.profile && r.profile.identity.class) specTd.style.color = (AssignmentsEngine.CLASS_COLORS || {})[r.profile.identity.class] || '';
        tr.appendChild(specTd);
        const byKey = Object.fromEntries(r.rules.map(x => [x.key, x]));
        ['ilvl', 'hit', 'expertise', 'defense', 'parse', 'enchants', 'sockets', 'stale'].forEach(k => {
            const td = ruleCell(byKey[k]);
            if (k === 'parse' && r.profile && r.profile.parses && r.profile.parses.fallback) td.textContent += ' (SSC/TK)';
            tr.appendChild(td);
        });
        const rm = document.createElement('td');
        const btn = document.createElement('button');
        btn.className = 'remove-btn'; btn.textContent = '×'; btn.title = 'Remove';
        btn.addEventListener('click', e => { e.stopPropagation(); removePlayer(r.name); });
        rm.appendChild(btn);
        tr.appendChild(rm);
        tr.addEventListener('click', () => toggleDetail(r.key));
        body.appendChild(tr);
        if (expanded === r.key && r.profile) body.appendChild(detailRow(r));
    });
    renderSummary();
}
function renderSummary() {
    const el = document.getElementById('summary');
    const rs = rows();
    if (!rs.length) { el.textContent = 'No players yet — add a name or load the roster.'; return; }
    const count = v => rs.filter(r => r.verdict === v).length;
    const pending = rs.filter(r => r.pending).length;
    el.textContent = count('pass') + ' pass · ' + count('warn') + ' warn · ' + count('fail') + ' fail · ' +
        count('unverified') + ' unverified · ' + count('error') + ' error' + (pending ? ' · ' + pending + ' fetching' : '');
}
function toggleDetail(key) { expanded = expanded === key ? null : key; renderTable(); }
function detailRow(r) {
    // Filled in by Task 7. Until then, an empty row keeps the click harmless.
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 12;
    td.textContent = 'Details coming in Task 7.';
    tr.appendChild(td);
    return tr;
}

// --- wiring ---
document.addEventListener('DOMContentLoaded', () => {
    load();
    renderRealm();
    renderThresholds();
    renderTable();
    const input = document.getElementById('nameInput');
    const add = () => { if (addPlayer(input.value)) input.value = ''; input.focus(); };
    document.getElementById('addBtn').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    document.getElementById('refreshBtn').addEventListener('click', () => {
        state.profiles = {}; state.errors = {}; save(); renderTable();
        state.players.forEach(p => enqueue(p.name, true));
    });
    document.getElementById('loadRosterBtn').addEventListener('click', loadRoster);
    // Resume anything not yet fetched (e.g. after a reload mid-queue).
    state.players.forEach(p => enqueue(p.name, false));
});
function loadRoster() { /* Task 7 */ }

// Exposed for the headless smoke test.
window.vetAdd = addPlayer;
window.vetState = () => state;
```

- [ ] **Step 4: Add the Vetting tab to the other pages**

In `assignments.html`, the nav becomes:
```html
        <nav class="page-tabs">
            <a href="./" class="page-tab active">Assignments</a>
            <a href="positions.html" class="page-tab">Positioning</a>
            <a href="vetting.html" class="page-tab">Vetting</a>
        </nav>
```
In `positions.html`:
```html
        <nav class="page-tabs">
            <a href="./" class="page-tab">Assignments</a>
            <a href="positions.html" class="page-tab active">Positioning</a>
            <a href="vetting.html" class="page-tab">Vetting</a>
        </nav>
```

- [ ] **Step 5: Headless smoke test**

Write the driver to the scratchpad (not the repo). It follows the gotchas in the verification-harness memory: explicit `process.exit()`, background run, Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

```js
// scratchpad/vet-smoke.mjs — run with the server already on :3000
import { spawn } from 'node:child_process';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=9333', '--no-first-run', '--user-data-dir=/tmp/vet-smoke-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const waiting = new Map();
async function connect() {
    for (let i = 0; i < 60; i++) {
        try { const list = await (await fetch('http://127.0.0.1:9333/json')).json(); const page = list.find(t => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch (e) { /* not up yet */ }
        await sleep(1000);
    }
    await new Promise(r => { ws.onopen = r; });
    ws.onmessage = m => { const d = JSON.parse(m.data); if (waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
}
function send(method, params) { return new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.result.value; }
try {
    await connect();
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:3000/vetting.html' });
    await sleep(2000);
    // Seed the realm the page reads from the assignments state.
    await evalJs(`localStorage.setItem('raidAssignmentsState', JSON.stringify({ wcl: { server: 'spineshatter', region: 'eu' } })); localStorage.removeItem('raidVettingState'); 'ok'`);
    await send('Page.navigate', { url: 'http://localhost:3000/vetting.html' });
    await sleep(2000);
    console.log('realm line:', await evalJs(`document.getElementById('realmLine').textContent`));
    console.log('added:', await evalJs(`vetAdd('Nottomwro')`));
    for (let i = 0; i < 20; i++) { await sleep(1000); if (await evalJs(`!!vetState().profiles['nottomwro'] || !!vetState().errors['nottomwro']`)) break; }
    console.log('row:', await evalJs(`[...document.querySelectorAll('#vetBody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join(' | '))`));
    console.log('summary:', await evalJs(`document.getElementById('summary').textContent`));
    // Threshold edit re-scores without a refetch.
    await evalJs(`const i = document.getElementById('th-ilvl'); i.value = 140; i.dispatchEvent(new Event('change')); 'ok'`);
    console.log('after ilvl 140:', await evalJs(`document.querySelector('#vetBody tr .verdict').textContent`));
    console.log('bad name:', await evalJs(`vetAdd('Nosuchplayerxyz')`));
    for (let i = 0; i < 20; i++) { await sleep(1000); if (await evalJs(`!!vetState().errors['nosuchplayerxyz']`)) break; }
    console.log('error row title:', await evalJs(`document.querySelector('#vetBody tr[data-name="Nosuchplayerxyz"] td:nth-child(2)').title`));
} finally { chrome.kill(); process.exit(0); }
```

Run: `npm start` in one shell; `node <scratchpad>/vet-smoke.mjs` in another (as a background task; Chrome cold start can be slow).
Expected: realm line names spineshatter; the Nottomwro row reads something like `warn expertise 0/26 | Nottomwro | Enhancement | 131.82 / 125 | 171 / 47 | 0 / 26 (−26) | — | 83 / 40 | 0 | 0 | 0d | ×`; after raising the item level threshold to 140 the verdict becomes `fail` with no new request; the unknown name gets an error row titled `Character not found on Warcraft Logs`. Paste the real output into the commit body.

- [ ] **Step 6: Commit**

```bash
git add vetting.html vetting.js vetting.css assignments.html positions.html
git commit -m "feat: vetting page — thresholds, fetch queue with rate-limit pause, verdict table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Vetting page — detail panel and roster load

**Files:**
- Modify: `vetting.js` (replace `detailRow` and `loadRoster`)

**Interfaces:**
- Consumes: `AssignmentsEngine.deriveRoster(state, linkMap)` → array of `{ name, class, spec, … }`; profile fields `gear`, `computed`, `reported`, `parses`, `missing`, `gearSummary`.

- [ ] **Step 1: Implement the detail row**

Replace the placeholder `detailRow` with:

```js
function statRows(p) {
    const c = p.computed || {}, r = p.reported || {};
    const line = (label, comp, rep) => [label, comp == null ? '—' : comp, rep == null ? '—' : rep];
    return [
        line('Spell damage', c.spellDamage, null), line('Healing', c.healing, null),
        line('Attack power', c.attackPower, null), line('Ranged AP', c.rangedAttackPower, null),
        line('Melee hit', c.meleeHit, r.hitMelee), line('Ranged hit', c.rangedHit, r.hitRanged), line('Spell hit', c.spellHit, r.hitSpell),
        line('Expertise', c.expertiseSkill + ' (' + c.expertiseRating + ' rating)', r.expertise),
        line('Melee crit', c.meleeCrit, r.critMelee), line('Spell crit', c.spellCrit, r.critSpell),
        line('Melee haste', c.meleeHaste, r.hasteMelee), line('Spell haste', c.spellHaste, r.hasteSpell),
        line('Defense', c.defenseSkill + ' (' + c.defenseRating + ' rating)', null), line('MP5', c.mp5, null),
        line('Dodge / parry / block', null, [r.dodge, r.parry, r.block].join(' / ')), line('Armor', null, r.armor),
        line('Str / Agi / Sta / Int / Spi', null, [r.strength, r.agility, r.stamina, r.intellect, r.spirit].join(' / ')),
    ];
}
function detailRow(r) {
    const p = r.profile;
    const tr = document.createElement('tr');
    tr.className = 'detail-row';
    const td = document.createElement('td');
    td.colSpan = 12;
    const grid = document.createElement('div');
    grid.className = 'detail-grid';

    // Gear
    const gearBox = document.createElement('div');
    gearBox.innerHTML = '<h4>Gear' + (p.gearSummary ? ' — avg ' + p.gearSummary.avgItemLevel + (p.gearSummary.setBonusesApplied ? '' : ' (set bonuses not included)') : '') + '</h4>';
    if (p.gear) {
        const t = document.createElement('table');
        p.gear.forEach(s => {
            const row = document.createElement('tr');
            if (s.empty) { row.innerHTML = '<td>' + escapeHtml(s.label) + '</td><td class="slot-missing" colspan="3">empty</td>'; t.appendChild(row); return; }
            const ench = s.enchantable ? (s.enchant ? '<span class="slot-ok">' + escapeHtml(s.enchant.name) + '</span>' : '<span class="slot-missing">no enchant</span>') : '';
            const gems = s.sockets ? (s.gems.map(g => escapeHtml(g.name)).join(', ') + (s.emptySockets ? ' <span class="slot-missing">' + s.emptySockets + ' empty</span>' : '')) : '';
            row.innerHTML = '<td>' + escapeHtml(s.label) + '</td><td>' + escapeHtml(s.name) + ' <span class="cell-unknown">' + s.itemLevel + '</span></td><td>' + ench + '</td><td>' + gems + '</td>';
            t.appendChild(row);
        });
        gearBox.appendChild(t);
    } else gearBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No gear data.</div>');
    grid.appendChild(gearBox);

    // Stats
    const statBox = document.createElement('div');
    statBox.innerHTML = '<h4>Stats (from gear · reported by WCL)</h4>';
    if (p.computed) {
        const t = document.createElement('table');
        t.innerHTML = '<tr><th></th><th>gear</th><th>WCL</th></tr>';
        statRows(p).forEach(([l, a, b]) => { const row = document.createElement('tr'); row.innerHTML = '<td>' + l + '</td><td>' + escapeHtml(String(a)) + '</td><td>' + escapeHtml(String(b)) + '</td>'; t.appendChild(row); });
        statBox.appendChild(t);
    } else statBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No stat data.</div>');
    grid.appendChild(statBox);

    // Parses + missing
    const parseBox = document.createElement('div');
    parseBox.innerHTML = '<h4>Parses' + (p.parses ? ' — ' + escapeHtml(p.parses.zoneName) + ' (' + p.parses.metric + ')' : '') + '</h4>';
    if (p.parses) {
        const t = document.createElement('table');
        t.innerHTML = '<tr><th>Boss</th><th>median</th><th>best</th><th>kills</th></tr>';
        p.parses.bosses.forEach(b => {
            const row = document.createElement('tr');
            row.innerHTML = '<td>' + escapeHtml(b.name || '') + '</td><td>' + (b.medianPercent == null ? '—' : Math.round(b.medianPercent)) + '</td><td>' + (b.bestPercent == null ? '—' : Math.round(b.bestPercent)) + '</td><td>' + b.kills + '</td>';
            t.appendChild(row);
        });
        parseBox.appendChild(t);
    } else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No parses.</div>');
    if (p.lastSeen) parseBox.insertAdjacentHTML('beforeend', '<div class="status">Last seen: ' + escapeHtml(new Date(p.lastSeen.timestamp).toLocaleDateString()) + ' — ' + escapeHtml(p.lastSeen.fightName || '') + '</div>');
    if (p.missing && p.missing.length) parseBox.insertAdjacentHTML('beforeend', '<div class="warn">' + p.missing.map(escapeHtml).join('<br>') + '</div>');
    grid.appendChild(parseBox);

    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
}
```

- [ ] **Step 2: Implement loadRoster**

Replace the `loadRoster` stub:

```js
function loadRoster() {
    let a = null, link = {};
    try { a = JSON.parse(localStorage.getItem(ASSIGN_KEY)); } catch (e) { /* none */ }
    try { link = JSON.parse(localStorage.getItem(ASSIGN_LINK_KEY)) || {}; } catch (e) { link = {}; }
    const el = document.getElementById('summary');
    if (!a || !a.sources) { el.textContent = 'No roster found — import one on the Assignments page first.'; return; }
    const roster = AssignmentsEngine.deriveRoster(a, link);
    if (!roster.length) { el.textContent = 'The Assignments roster is empty.'; return; }
    let added = 0;
    roster.forEach(p => { if (!state.players.some(x => x.name.toLowerCase() === p.name.toLowerCase())) added++; addPlayer(p.name); });
    el.textContent = 'Loaded ' + roster.length + ' from the roster (' + added + ' new).';
}
```

- [ ] **Step 3: Extend the smoke test and run it**

Append to the scratchpad driver before the `finally`:

```js
    await evalJs(`document.querySelector('#vetBody tr[data-name="Nottomwro"]').click(); 'ok'`);
    console.log('detail slots:', await evalJs(`document.querySelectorAll('.detail-row .detail-grid > div:first-child table tr').length`));
    console.log('detail parses:', await evalJs(`document.querySelectorAll('.detail-row .detail-grid > div:last-child table tr').length`));
    await evalJs(`localStorage.setItem('raidAssignmentsState', JSON.stringify({ wcl: { server: 'spineshatter', region: 'eu' }, sources: { addon: [{ name: 'Nottomwro', class: 'SHAMAN', spec: 'Enhancement' }], rh: [] } })); 'ok'`);
    await evalJs(`document.getElementById('loadRosterBtn').click(); 'ok'`);
    console.log('after load roster:', await evalJs(`document.getElementById('summary').textContent`));
```

Run as before. Expected: `detail slots: 17`, `detail parses: 15` (header plus 14 bosses), and the load-roster line `Loaded 1 from the roster (0 new).`. If `deriveRoster` needs more fields in the seeded `addon` entries to produce a player, look at `parseAddonExport` in `assignments-engine.js` for the shape it returns and seed that shape.

- [ ] **Step 4: Commit**

```bash
git add vetting.js
git commit -m "feat: vetting detail panel (gear, stat sheet, parses) and load-roster

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: README, calibration pass, spec update

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-03-player-vetting-design.md` (§6 calibration outcome)

- [ ] **Step 1: README**

Under "The two halves → Web tool", add a bullet after the group layout optimizer:

```
- Player vetting page (`vetting.html`): type a character name or load the roster, and get gear,
  hit and other stats, enchants, sockets and parses from Warcraft Logs with a pass / warn /
  fail / unverified verdict against editable thresholds. Needs the WCL credentials below.
```

Under "Tests", extend the `npm test` comment to `# engine, WCL multiplier, positions, item table, vetting suites`.

Add a short section after "Calibration":

```
## Item table

`data/tbc-item-db.json` is the trimmed wowsims item/gem/enchant table the vetting page's stat
math runs on. Regenerate it after updating the wowsims checkout under `calibration/vendor/`:

```bash
node calibration/extract-item-db.mjs
```
```

- [ ] **Step 2: Calibration pass with the real roster**

This step needs the user. Run the server, open the Vetting page with the realm set, press "Load roster" on the current roster, and hand the user the table. Ask, for each row whose verdict they disagree with, which rule was wrong and what number they would set. Adjust `DEFAULT_THRESHOLDS` in `vet-engine.js` and the `TALENT_HIT_ALLOWANCE` table if a spec's cap is off, update the corresponding tests' expected numbers, and re-run `npm test`.

- [ ] **Step 3: Record the outcome in the spec**

Append to spec §6 under "Calibration pass":

```
**Outcome (YYYY-MM-DD):** <N> rostered players reviewed. Defaults changed: <list or "none">.
Disagreements left as-is and why: <list or "none">.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-03-player-vetting-design.md vet-engine.js vet-engine.test.js
git commit -m "docs: vetting page in README; calibration pass outcome recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
