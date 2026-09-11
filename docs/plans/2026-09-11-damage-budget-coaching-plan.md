# Damage-budget coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DPS evaluation lead with a damage budget against a named reference and explain every part of the gap down to named items, gems, enchants, consumables, blessings, raid buffs, procs, luck or execution, each sized in DPS and ordered by size.

**Architecture:** Four new pure modules (mechanics constants, catalogue, budget decomposition, attribution) turn the existing damage table, combatant snapshot, buff bands and gear audit into buckets and causes. A pricing module sizes causes with the existing WoWSims adapter (bonus-stat and buff-toggle scenarios) and sizes execution findings with observed-rate bounds. The coaching layer composes buckets and the renderer leads with them; old saved reports without `budget` render as today.

**Tech Stack:** Node 18+ (tests use `node --test`; browser test needs Node 22+), CommonJS, no new dependencies. WoWSims runner binaries in `evaluation-sim/vendor/` (present on this machine; a full 10,000-iteration run takes about 0.4 s).

**Spec:** `docs/plans/2026-09-11-damage-budget-coaching.md`

## Global Constraints

- No summed total of recoverable DPS anywhere in output; every bucket carries the sentence "These values overlap and do not add up to the gap."
- Absolute DPS from an unvalidated rotation is never shown; only stat-delta prices, labelled.
- Missing data never becomes a zero count; a missing table produces a `limitations` line and the current report.
- No player-name branches in any rule.
- Every constant in `evaluation-mechanics.js` carries a comment naming the pinned wowsims file and line (commit `72e0c8a8feaf62da67add31090666773d6040f69`). A local read-only checkout for verification lives at `/private/tmp/claude-501/-Users-maxvanzoelen-wowstuff/5d21d7ef-43b5-41d3-bf75-c0056882cd34/scratchpad/tbc-new` (sparse: `sim/core`, `sim/<class>`, `proto`). If it is gone, recreate it with: `git clone --filter=blob:none --no-checkout https://github.com/wowsims/tbc-new.git tbc-new && cd tbc-new && git sparse-checkout set sim/core sim/rogue sim/hunter sim/warrior sim/paladin sim/mage sim/warlock sim/priest sim/shaman sim/druid proto && git checkout -q --detach 72e0c8a8feaf62da67add31090666773d6040f69`.
- Commits: one per task, message body only, **no Co-Authored-By trailer** (repo rule).
- Follow TDD literally: run the failing test and confirm it fails for the predicted reason before implementing. If a test passes before implementation, the test is wrong.
- Owner labels in output text: `you`, `raid`, `luck`. Size labels: `priced` ("about N DPS for your build, priced with the validated|unvalidated rotation"), `bound` ("up to about N DPS on this pull"), `unsized` ("not sized").
- Existing tests must keep passing: `npm run test:evaluation`, `npm test`, `npm run test:evaluation-browser`.
- Raw captures in `output/` are local and git-ignored; committed fixtures are the projections under `fixtures/evaluation/`.
- If a plan step is found wrong, stop and ask the user with a recommendation; do not improvise a different design.

---

## File map

| File | Responsibility |
| --- | --- |
| `evaluation-mechanics.js` (new) | Pinned TBC constants, rating conversions, expected outcome rates, binomial variance test |
| `evaluation-catalogue.js` (new) | Aura-at-pull, uptime, proc and debuff catalogues with verified ids, owners and sim changes |
| `evaluation-budget.js` (new) | Per-family four-factor decomposition, expected-vs-observed outcomes, gap identity, headline |
| `evaluation-attribution.js` (new) | Stat, aura, uptime and debuff differences resolved to named sources with owners and sim changes |
| `evaluation-pricing.js` (new) | Sim prices for causes (bonus stats, buff toggles, equipment swaps) with sanity gates; observed-rate bounds |
| `vet-engine.js` (modify `summarizeGear`) | Per-slot `stats` on each gear-audit slot |
| `evaluation-hunter-evidence.js`, `evaluation-rogue-evidence.js` (modify) | Findings declare `bucket` and `measure` |
| `evaluation-coaching.js` (modify) | Buckets, sizes, sorting, night overview from sized items |
| `evaluation-service.js` (modify) | `combinedEvidence` adds `budget`, `causes`; `buildEvaluation` adds pricing stage |
| `evaluation.js`, `evaluation.css` (modify) | Budget-first layout, bucket cards, copy plan order, legacy fallback |
| `fixtures/evaluation/augment-recorded.cjs` (new) | Adds combatant info, buff bands, gear audit and debuffs to the two recorded fixtures from local raw captures |
| `docs/deep-player-evaluation.md` (modify) | Engine 5 section |

Stat indices are the item-database indices already used in `vet-engine.js` (`STAT`) and `evaluation-sim.js` (`statValidation`): 0 strength, 1 agility, 3 intellect, 5 spell damage, 12 spell hit, 13 spell crit, 14 spell haste, 17 attack power, 18 ranged attack power, 20 melee hit, 21 melee crit, 22 melee haste, 24 expertise.

---

### Task 1: Mechanics module

**Files:**
- Create: `evaluation-mechanics.js`
- Test: `evaluation-mechanics.test.js`
- Modify: `package.json` (add the test to `test:evaluation`)

**Interfaces:**
- Produces:
  - `RATING`, `BOSS`, `CRIT_PERCENT_PER_AGILITY`, `ATTACK_POWER_PER_STRENGTH`, `ATTACK_POWER_PER_AGILITY`, `HIT_TALENTS`, `SOURCE_COMMIT`
  - `hitPercentRange({ rating, kind: 'physical'|'spell', classToken })` → `{ min, max, assumption }`
  - `expectedOutcomes({ attack: 'melee-white'|'melee-yellow'|'ranged'|'spell', swings, hitRating, expertiseRating, classToken, inFront })` → `{ rates: { miss:{min,max}, dodge:{min,max}, parry:{min,max}, glance:{min,max}, block:{min,max} }, expected: same shape × swings, assumptions: string[] }`
  - `varianceCheck(observed, expectedRange, swings)` → `{ within: boolean, low, high, sd }`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('./evaluation-mechanics');

test('constants are pinned to the wowsims level-73 attack table', () => {
    assert.equal(M.RATING.physicalHitPerPercent, 15.769233);
    assert.equal(M.RATING.expertisePerQuarterPercent, 3.942308);
    assert.equal(M.BOSS.dodge, 0.065); assert.equal(M.BOSS.parry, 0.14); assert.equal(M.BOSS.glance, 0.24);
    assert.equal(M.BOSS.meleeMiss, 0.08); assert.equal(M.BOSS.dualWieldPenalty, 0.19); assert.equal(M.BOSS.spellMiss, 0.17);
    assert.equal(M.BOSS.hitSuppression, 0.01); assert.equal(M.BOSS.meleeCritSuppression, 0.048);
    assert.equal(M.CRIT_PERCENT_PER_AGILITY.ROGUE, 0.025); assert.equal(M.ATTACK_POWER_PER_STRENGTH.WARRIOR, 2);
    assert.match(M.SOURCE_COMMIT, /^72e0c8a8/);
});

test('Utopik on Winterchill: 226 dual-wield white swings at 272 hit and 0 expertise expect 14.7 dodges and 13 to 24.3 misses', () => {
    const out = M.expectedOutcomes({ attack: 'melee-white', swings: 226, hitRating: 272, expertiseRating: 0, classToken: 'ROGUE' });
    assert.equal(Math.round(out.expected.dodge.min * 10) / 10, 14.7);
    assert.equal(Math.round(out.expected.dodge.max * 10) / 10, 14.7);
    assert.equal(Math.round(out.expected.miss.min * 10) / 10, 13);    // with Precision 5/5
    assert.equal(Math.round(out.expected.miss.max * 10) / 10, 24.3);  // without
    assert.equal(out.expected.parry.max, 0, 'behind the target');
    assert.equal(Math.round(out.expected.glance.min * 10) / 10, 54.2);
    assert.ok(out.assumptions.some(a => /Precision/.test(a)));
});

test('21 expertise rating removes 1.25% dodge (floor of 5 points)', () => {
    const out = M.expectedOutcomes({ attack: 'melee-yellow', swings: 216, hitRating: 252, expertiseRating: 21, classToken: 'ROGUE' });
    assert.equal(Math.round(out.rates.dodge.min * 10000) / 10000, 0.0525);
    assert.equal(out.rates.glance.max, 0, 'yellow attacks never glance');
    assert.equal(out.expected.miss.max, 0, '252 hit rating (15.98%) exceeds the 8% base plus 1% suppression; yellow attacks cannot miss');
});

test('ranged attacks can only miss or be blocked; spells only miss', () => {
    const ranged = M.expectedOutcomes({ attack: 'ranged', swings: 100, hitRating: 0, expertiseRating: 0, classToken: 'HUNTER' });
    assert.equal(ranged.rates.dodge.max, 0); assert.equal(ranged.rates.glance.max, 0);
    assert.equal(Math.round(ranged.rates.miss.max * 1000) / 1000, 0.08, 'suppression only applies to hit above zero (spell_result.go:186 clamps at 0)');
    const spell = M.expectedOutcomes({ attack: 'spell', swings: 100, hitRating: 0, expertiseRating: 0, classToken: 'MAGE' });
    assert.equal(Math.round(spell.rates.miss.max * 1000) / 1000, 0.17);
    assert.equal(spell.rates.dodge.max, 0);
});

test('variance check uses two binomial standard deviations around the expected range', () => {
    const v = M.varianceCheck(15, { min: 14.7, max: 14.7 }, 226);
    assert.equal(v.within, true);
    const lucky = M.varianceCheck(6, { min: 11.3, max: 11.3 }, 216);
    assert.equal(lucky.within, true, '6 against 11.3 is within 2 sd (sd about 3.3)');
    const far = M.varianceCheck(30, { min: 11.3, max: 11.3 }, 216);
    assert.equal(far.within, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-mechanics.test.js`
Expected: FAIL with `Cannot find module './evaluation-mechanics'`

- [ ] **Step 3: Verify each constant against the pinned checkout before writing it**

Run from the scratchpad checkout:
```bash
sed -n 12,22p sim/core/base_stats_auto_gen.go      # rating conversions
sed -n 24,35p sim/core/base_stats_auto_gen.go      # CritPerAgiMaxLevel
sed -n 393,403p sim/core/target.go                 # level-73 column is the fifth value
sed -n 570,577p sim/core/spell_outcome.go          # dual-wield +0.19 on white swings only
sed -n 174,187p sim/core/spell_result.go           # expertise floor(rating/3.942308)/400, hit suppression
grep -n "AddStat(stats.PhysicalHitPercent" sim/rogue/talents_combat.go sim/hunter/talents.go
grep -rn "AddStatDependency(stats.Strength, stats.AttackPower" sim/*/*.go | grep -v _test | grep -v pet
grep -n "OutcomeRangedHit\b" -A 12 sim/core/spell_outcome.go | grep -c "Dodge"   # expect 0
```
If any value differs from the code below, use the source value, fix the test expectation, and record the file:line in the comment. If a spell-hit talent for a caster class cannot be found by grep, leave its entry out of `HIT_TALENTS` and let the range be 0 to 10 with the assumption text "spell-hit talents are not verified for this class".

- [ ] **Step 4: Write the module**

```js
'use strict';
// Every value below is read from the pinned wowsims/tbc-new checkout. Do not change a
// number without changing the file:line reference beside it.
const SOURCE_COMMIT = '72e0c8a8feaf62da67add31090666773d6040f69';

const RATING = { // sim/core/base_stats_auto_gen.go:12-22
    expertisePerQuarterPercent: 3.942308,
    physicalHitPerPercent: 15.769233, spellHitPerPercent: 12.615385,
    physicalCritPerPercent: 22.076923, spellCritPerPercent: 22.076923,
    physicalHastePerPercent: 15.769233, spellHastePerPercent: 15.76923,
};
const BOSS = { // sim/core/target.go:393-403 (fifth column = level 73); dual-wield: sim/core/spell_outcome.go:573-574
    level: 73, spellMiss: 0.17, meleeMiss: 0.08, dualWieldPenalty: 0.19, block: 0.05, dodge: 0.065, parry: 0.14,
    glance: 0.24, glanceMultiplier: 0.75, hitSuppression: 0.01, meleeCritSuppression: 0.048, spellCritSuppression: 0.021,
};
const CRIT_PERCENT_PER_AGILITY = { WARRIOR: 0.0303, PALADIN: 0.04, HUNTER: 0.025, ROGUE: 0.025, PRIEST: 0.04, SHAMAN: 0.04, MAGE: 0.04, WARLOCK: 0.0405, DRUID: 0.04 }; // sim/core/base_stats_auto_gen.go:24-35
const ATTACK_POWER_PER_STRENGTH = { WARRIOR: 2, PALADIN: 2, SHAMAN: 2, HUNTER: 1, ROGUE: 1, DRUID: 1, WARLOCK: 1 }; // sim/<class>/<class>.go AddStatDependency(stats.Strength, stats.AttackPower, n)
const ATTACK_POWER_PER_AGILITY = { HUNTER: 1, ROGUE: 1 }; // sim/hunter/hunter.go:278, sim/rogue/rogue.go:211 (hunter ranged AP also 1 per agility, hunter.go:279)
// WCL combatant data does not expose talent ranks. These only widen the expected range and are named in the assumption text.
const HIT_TALENTS = {
    ROGUE: { name: 'Precision', percent: 5, kind: 'physical' },      // sim/rogue/talents_combat.go:85-90
    HUNTER: { name: 'Surefooted', percent: 3, kind: 'physical' },    // sim/hunter/talents.go:521-526
};
const SPELL_TALENT_RANGE = 10; // widest TBC spell-hit talent (Shadow Focus / Suppression); used when no verified entry exists

const clamp = (value) => Math.max(0, value);
const range = (min, max) => ({ min: Math.min(min, max), max: Math.max(min, max) });
const scale = (r, n) => ({ min: r.min * n, max: r.max * n });

function hitPercentRange({ rating = 0, kind = 'physical', classToken = '' }) {
    const per = kind === 'spell' ? RATING.spellHitPerPercent : RATING.physicalHitPerPercent;
    const base = (Number(rating) || 0) / per;
    const talent = HIT_TALENTS[String(classToken).toUpperCase()];
    const extra = talent && talent.kind === kind ? talent.percent : kind === 'spell' ? SPELL_TALENT_RANGE : 0;
    const assumption = extra
        ? (talent && talent.kind === kind ? talent.name + ' is not recorded by Warcraft Logs; the expected range spans 0/' + talent.percent + ' to ' + talent.percent + '/' + talent.percent + '.'
            : 'Spell-hit talents are not verified for this class; the expected range spans 0 to ' + SPELL_TALENT_RANGE + '% talent hit.')
        : null;
    return { ...range(base, base + extra), assumption };
}

function expectedOutcomes({ attack, swings = 0, hitRating = 0, expertiseRating = 0, classToken = '', inFront = false }) {
    const assumptions = [];
    const zero = { min: 0, max: 0 };
    const kind = attack === 'spell' ? 'spell' : 'physical';
    const hit = hitPercentRange({ rating: hitRating, kind, classToken });
    if (hit.assumption) assumptions.push(hit.assumption);
    let miss;
    if (attack === 'spell') miss = range(clamp(BOSS.spellMiss - hit.max / 100), clamp(BOSS.spellMiss - hit.min / 100));
    else {
        const penalty = attack === 'melee-white' ? BOSS.dualWieldPenalty : 0; // sim/core/spell_outcome.go:573; ranged and yellow use the no-penalty path (:591, :467)
        miss = range(clamp(BOSS.meleeMiss + penalty - clamp(hit.max / 100 - BOSS.hitSuppression)), clamp(BOSS.meleeMiss + penalty - clamp(hit.min / 100 - BOSS.hitSuppression)));
        if (attack === 'melee-white') assumptions.push('Dual-wield white swings carry the 19% miss penalty; if this player used a single weapon the expected misses are lower.');
    }
    const suppression = Math.floor((Number(expertiseRating) || 0) / RATING.expertisePerQuarterPercent) / 400; // sim/core/spell_result.go:174-177
    const physicalMelee = attack === 'melee-white' || attack === 'melee-yellow';
    const dodge = physicalMelee ? range(clamp(BOSS.dodge - suppression), clamp(BOSS.dodge - suppression)) : zero;
    const parry = physicalMelee && inFront ? range(clamp(BOSS.parry - suppression), clamp(BOSS.parry - suppression)) : zero;
    if (physicalMelee && !inFront) assumptions.push('Parries are expected to be zero from behind the target; recorded parries mean time spent in front.');
    const glance = attack === 'melee-white' ? range(BOSS.glance, BOSS.glance) : zero; // sim/core/spell_outcome.go:232-240 (white only)
    const block = attack === 'ranged' ? range(BOSS.block, BOSS.block) : zero;
    const rates = { miss, dodge, parry, glance, block };
    return { rates, expected: Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, scale(r, swings)])), assumptions };
}

function varianceCheck(observed, expectedRange, swings) {
    const n = Math.max(1, Number(swings) || 0);
    const p = Math.min(0.5, Math.max(expectedRange.min, expectedRange.max) / n);
    const sd = Math.sqrt(n * p * (1 - p));
    const low = expectedRange.min - 2 * sd, high = expectedRange.max + 2 * sd;
    return { within: observed >= low && observed <= high, low, high, sd };
}

module.exports = { SOURCE_COMMIT, RATING, BOSS, CRIT_PERCENT_PER_AGILITY, ATTACK_POWER_PER_STRENGTH, ATTACK_POWER_PER_AGILITY, HIT_TALENTS, hitPercentRange, expectedOutcomes, varianceCheck };
```

- [ ] **Step 5: Run the test**

Run: `node --test evaluation-mechanics.test.js`
Expected: PASS (5 tests). If the Winterchill numbers are off by rounding, check `hitSuppression` handling: hit 272 → 17.25%, minus 1% suppression → 16.25%; white miss without talent = 0.27 − 0.1625 = 0.1075 × 226 = 24.3; with Precision 5 = 0.0575 × 226 = 13.0.

- [ ] **Step 6: Register and commit**

Edit `package.json` `test:evaluation`: insert `evaluation-mechanics.test.js` into the second `node --test` group (after `evaluation-acceptance.test.js`).

```bash
git add evaluation-mechanics.js evaluation-mechanics.test.js package.json
git commit -m "feat(evaluation): pinned TBC mechanics constants and expected outcome rates"
```

---

### Task 2: Catalogue module

**Files:**
- Create: `evaluation-catalogue.js`, `evaluation-catalogue.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `AURAS_AT_PULL`: Map spellId → `{ id, name, kind: 'consumable'|'scroll'|'blessing'|'party'|'raid', slot?: 'flask'|'battle'|'guardian'|'food', owner: 'you'|'raid', sim: SimChange|null, stats?: {index: delta} }`
  - `UPTIME`: Map spellId → `{ id, name, kind: 'raid-buff'|'proc'|'cooldown'|'maintained'|'potion', owner, itemId?: number, enchantId?: number, sim: SimChange|null, affects: 'rate'|'perHit'|'crit'|'all' }`
  - `DEBUFFS`: Map spellId → `{ id, name, owner: 'raid', affects, sim: SimChange|null }`
  - `lookupAura(id)`, `lookupUptime(id)`, `lookupDebuff(id)`, `procForItem(itemId)`
  - `SimChange` = `{ set: [[pathArray, value], ...] }` or `{ bonusStats: {index: delta} }` or `{ equip: { slot: simSlotIndex, id } }` or `{ consumable: { field, id, clear: [fields] } }`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-catalogue.test.js`
Expected: FAIL with `Cannot find module './evaluation-catalogue'`

- [ ] **Step 3: Verify the Drums aura mapping and scroll fields before writing**

```bash
grep -n "35476\|DrumsOfBattle" sim/core/buffs.go | head          # which Drums enum value carries aura 35476
grep -n "scroll_agi\|scroll_str" proto/common.proto              # consumes field names (JSON camelCase: scrollAgi, scrollStr)
```
Use the enum value that registers 35476 for the `drums` sim change. If none registers 35476, set `sim: null` for Drums and keep the cause unpriced.

- [ ] **Step 4: Write the module**

All ids below were harvested by name from the Sept 10 raw captures (`output/utopik-deep-dive/raw-*.json`, `output/funkell-deep-dive/raw-*.json`) or are the pairs already used in `evaluation-sim.js` `applyRecordedConsumables`.

```js
'use strict';
// Verified ids only. An id that is not in these tables is never guessed into a source.
const player = (...rest) => ['raid', 'parties', 0, 'players', 0, ...rest];
const party = (...rest) => ['raid', 'parties', 0, 'buffs', ...rest];
const raid = (...rest) => ['raid', 'buffs', ...rest];
const consumable = (field, id, clear = []) => ({ consumable: { field, id, clear } });
const set = (...pairs) => ({ set: pairs });

const AURAS_AT_PULL = new Map([
    // Consumables: aura id → sim item id (pairs from evaluation-sim.js applyRecordedConsumables)
    [28520, { name: 'Flask of Relentless Assault', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22854, ['battleElixirId', 'guardianElixirId']) }],
    [28540, { name: 'Flask of Pure Death', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22866, ['battleElixirId', 'guardianElixirId']) }],
    [28521, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']) }],
    [46840, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']) }],
    [28497, { name: 'Elixir of Major Agility', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22831) }],
    [11406, { name: 'Elixir of Demonslaying', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 9224) }],
    [33721, { name: "Adept's Elixir", kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 28103) }],
    [28503, { name: 'Elixir of Major Shadow Power', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22545) }],
    [33256, { name: 'Roasted Clefthoof', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27658) }],
    [33254, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657) }],
    [33263, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657) }],
    [33261, { name: 'Warp Burger', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27659) }],
    [43764, { name: 'Well Fed (food not identified)', kind: 'consumable', slot: 'food', owner: 'you', sim: null }],
    [12174, { name: 'Scroll of Agility V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollAgi'), true]), stats: { 1: 20 } }],
    [12179, { name: 'Scroll of Strength V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollStr'), true]), stats: { 0: 20 } }],
    // Blessings and party/raid buffs present at pull (sim toggles as in evaluation-sim.js buildModelBaseline)
    [25898, { name: 'Greater Blessing of Kings', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfKings'), true]) }],
    [27141, { name: 'Greater Blessing of Might', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfMight'), 'TristateEffectImproved']) }],
    [25895, { name: 'Greater Blessing of Salvation', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfSalvation'), true]) }],
    [27143, { name: 'Greater Blessing of Wisdom', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfWisdom'), 'TristateEffectImproved']) }],
    [24932, { name: 'Leader of the Pack', kind: 'party', owner: 'raid', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']) }],
    [2048, { name: 'Battle Shout', kind: 'party', owner: 'raid', sim: set([party('battleShout'), 'TristateEffectRegular']) }],
    [30807, { name: 'Unleashed Rage', kind: 'party', owner: 'raid', sim: set([player('buffs', 'unleashedRage'), true]) }],
    [33077, { name: 'Grace of Air Totem', kind: 'party', owner: 'raid', sim: set([party('graceOfAirTotem'), 'TristateEffectRegular']) }],
    [33082, { name: 'Strength of Earth Totem', kind: 'party', owner: 'raid', sim: set([party('strengthOfEarthTotem'), 'TristateEffectRegular']) }],
    [25584, { name: 'Windfury Totem', kind: 'party', owner: 'raid', sim: set([party('windfuryTotem'), 'TristateEffectRegular']) }],
    [34456, { name: 'Ferocious Inspiration', kind: 'party', owner: 'raid', sim: set([party('ferociousInspiration'), 1]) }],
    [20218, { name: 'Sanctity Aura', kind: 'party', owner: 'raid', sim: set([party('sanctityAura'), 'TristateEffectImproved']) }],
    [27127, { name: 'Arcane Brilliance', kind: 'raid', owner: 'raid', sim: set([raid('arcaneBrilliance'), true]) }],
    [25392, { name: 'Prayer of Fortitude', kind: 'raid', owner: 'raid', sim: set([raid('powerWordFortitude'), 'TristateEffectImproved']) }],
    [26991, { name: 'Gift of the Wild', kind: 'raid', owner: 'raid', sim: set([raid('giftOfTheWild'), 'TristateEffectRegular']) }],
    [32999, { name: 'Prayer of Spirit', kind: 'raid', owner: 'raid', sim: set([raid('divineSpirit'), 'TristateEffectRegular']) }],
].map(([id, entry]) => [id, { id, ...entry }]));

const UPTIME = new Map([
    [2825, { name: 'Bloodlust', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null }],
    [32182, { name: 'Heroism', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null }],
    [35476, { name: 'Drums of Battle', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: set([party('drums'), 'DRUMS_ENUM_FROM_STEP_3']) }],
    [30807, { name: 'Unleashed Rage', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([player('buffs', 'unleashedRage'), true]) }],
    [24932, { name: 'Leader of the Pack', kind: 'raid-buff', owner: 'raid', affects: 'crit', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']) }],
    [2048, { name: 'Battle Shout', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([party('battleShout'), 'TristateEffectRegular']) }],
    [34456, { name: 'Ferocious Inspiration', kind: 'raid-buff', owner: 'raid', affects: 'all', sim: set([party('ferociousInspiration'), 1]) }],
    [34775, { name: 'Dragonspine Flurry', kind: 'proc', owner: 'luck', itemId: 28830, affects: 'rate', sim: null }],
    [36041, { name: 'Heartrazor', kind: 'proc', owner: 'luck', itemId: 29962, affects: 'perHit', sim: null }],
    [28093, { name: 'Lightning Speed', kind: 'proc', owner: 'luck', enchantId: 2673, affects: 'rate', sim: null }],
    [28507, { name: 'Haste Potion', kind: 'potion', owner: 'you', affects: 'rate', sim: consumable('potId', 22838) }],
    [28508, { name: 'Destruction Potion', kind: 'potion', owner: 'you', affects: 'all', sim: consumable('potId', 22839) }],
    [6774, { name: 'Slice and Dice', kind: 'maintained', owner: 'you', affects: 'rate', sim: null }],
    [3045, { name: 'Rapid Fire', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [19574, { name: 'Bestial Wrath', kind: 'cooldown', owner: 'you', affects: 'all', sim: null }],
    [13750, { name: 'Adrenaline Rush', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [13877, { name: 'Blade Flurry', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [12292, { name: 'Death Wish', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [1719, { name: 'Recklessness', kind: 'cooldown', owner: 'you', affects: 'crit', sim: null }],
    [31884, { name: 'Avenging Wrath', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [12042, { name: 'Arcane Power', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [12472, { name: 'Icy Veins', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [14177, { name: 'Cold Blood', kind: 'cooldown', owner: 'you', affects: 'crit', sim: null }],
    [31238, { name: 'Find Weakness', kind: 'maintained', owner: 'you', affects: 'perHit', sim: null }],
].map(([id, entry]) => [id, { id, ...entry }]));

const DEBUFFS = new Map([
    [25225, { name: 'Sunder Armor', affects: 'perHit', sim: set([['raid', 'debuffs', 'sunderArmor'], true]) }],
    [26866, { name: 'Expose Armor', affects: 'perHit', sim: set([['raid', 'debuffs', 'exposeArmor'], 'TristateEffectImproved']) }],
    [26993, { name: 'Faerie Fire', affects: 'perHit', sim: set([['raid', 'debuffs', 'faerieFire'], 'TristateEffectRegular']) }],
    [25602, { name: 'Faerie Fire', affects: 'perHit', sim: set([['raid', 'debuffs', 'faerieFire'], 'TristateEffectRegular']) }],
    [27226, { name: 'Curse of Recklessness', affects: 'perHit', sim: set([['raid', 'debuffs', 'curseOfRecklessness'], true]) }],
    [27228, { name: 'Curse of the Elements', affects: 'perHit', sim: null }],
    [33200, { name: 'Misery', affects: 'perHit', sim: null }],
    [15258, { name: 'Shadow Weaving', affects: 'perHit', sim: null }],
    [27159, { name: 'Judgement of the Crusader', affects: 'perHit', sim: null }],
    [34501, { name: 'Expose Weakness', affects: 'perHit', sim: null }],
    [14325, { name: "Hunter's Mark", affects: 'perHit', sim: null }],
].map(([id, entry]) => [id, { id, owner: 'raid', ...entry }]));

const byItem = new Map([...UPTIME.values()].filter(e => e.itemId).map(e => [e.itemId, e]));
const lookup = (map) => (id) => map.get(Number(id)) || null;
module.exports = { AURAS_AT_PULL, UPTIME, DEBUFFS, lookupAura: lookup(AURAS_AT_PULL), lookupUptime: lookup(UPTIME), lookupDebuff: lookup(DEBUFFS), procForItem: (id) => byItem.get(Number(id)) || null };
```
Replace `'DRUMS_ENUM_FROM_STEP_3'` with the enum string found in Step 3 (for example `'GreaterDrumsOfBattle'`), or set `sim: null`.

- [ ] **Step 5: Run the test**

Run: `node --test evaluation-catalogue.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Register and commit**

Add `evaluation-catalogue.test.js` to `test:evaluation` next to the mechanics test.

```bash
git add evaluation-catalogue.js evaluation-catalogue.test.js package.json
git commit -m "feat(evaluation): verified aura, uptime, proc and debuff catalogue"
```

---

### Task 3: Per-slot gear stats and recorded-fixture augmentation

The attribution and budget tests in later tasks need the reference player's combatant info, buff bands and gear audit in the committed fixtures. Today `fixtures/evaluation/utopik-investigation.json` references carry only `dmg`, `casts` and `buffs`, and `fixtures/evaluation/funkell-hunter.json` references carry only `dmg`. The raw captures in `output/` have everything.

**Files:**
- Modify: `vet-engine.js` (`summarizeGear`, around line 148-205)
- Create: `fixtures/evaluation/augment-recorded.cjs`
- Modify: `fixtures/evaluation/utopik-investigation.json`, `fixtures/evaluation/funkell-hunter.json` (regenerated)
- Test: `vet-engine.test.js` (add one test), `evaluation-acceptance.test.js` (add one fixture-shape test)

**Interfaces:**
- Produces: each `gearAudit.slots[i]` gains `stats: {index: value}` = item stats + enchant stats + gem stats + socket bonus when active. `unknownItems` unchanged.
- Fixture fights gain `tables.ci`, `tables.buffs`, `gearAudit`, `context.debuffs`; fixture references gain `tables.ci`, `tables.buffs`, `gearAudit`, `context.dmgAll`.

- [ ] **Step 1: Write the failing tests**

In `vet-engine.test.js` (it uses the repo's `test(name, fn)` pattern; copy the style of the neighbouring gear tests) add:

```js
test('summarizeGear exposes per-slot stats including enchant, gems and active socket bonus', () => {
    const db = V.indexDb(require('./data/tbc-item-db.json'));
    const gear = new Array(19).fill(null).map(() => ({ id: 0 }));
    gear[0] = { id: 30146, permanentEnchant: 3003, gems: [{ id: 32409 }, { id: 33131 }] }; // Deathmantle Helm, Glyph of Ferocity, meta + Crimson Sun
    gear[15] = { id: 30103, permanentEnchant: 2673, gems: [] }; // Fang of Vashj + Mongoose
    const audit = V.summarizeGear(gear, db, 'ROGUE');
    const head = audit.slots.find(s => s.key === 'head'), mh = audit.slots.find(s => s.key === 'mainHand' || s.label === 'Main hand');
    assert.strictEqual(mh.stats[24], 21, 'Fang of Vashj supplies 21 expertise');
    assert.ok(head.stats[1] >= 12, 'meta gem agility is included');
    assert.ok(Object.keys(head.stats).length > 3);
});
```

In `evaluation-acceptance.test.js` add:

```js
test('recorded fixtures carry reference combatant info, buff bands and gear audits', () => {
    const utopik = require('./fixtures/evaluation/utopik-investigation.json').fights[0];
    assert.ok(utopik.tables.ci && utopik.gearAudit && utopik.context.debuffs, 'own snapshot, audit and debuffs');
    const jofrey = utopik.references.find(r => r.player.name === 'Jofrey');
    assert.ok(jofrey.tables.ci && jofrey.tables.buffs && jofrey.gearAudit && jofrey.context.dmgAll, 'reference snapshot, bands, audit, totals');
    assert.equal(jofrey.gearAudit.slots.find(s => s.label === 'Main hand').stats[24], 21);
    const funkell = require('./fixtures/evaluation/funkell-hunter.json').fights.find(f => f.name === 'Archimonde');
    assert.ok(funkell.tables.ci && funkell.references[0].tables.ci && funkell.references[0].gearAudit);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node vet-engine.test.js 2>&1 | grep -A2 "per-slot"` → FAIL (`stats` undefined on slot)
Run: `node --test evaluation-acceptance.test.js` → the new test FAILS (`jofrey.tables.ci` undefined)

- [ ] **Step 3: Add per-slot stats in `summarizeGear`**

Inside the `slots = SLOTS.map(slot => { ... })` callback in `vet-engine.js`, keep a local accumulator and add the stats of item, enchant, gems and active socket bonus to both the global `stats` and the local one. Concretely: after `const item = db.items.get(g.id);` add `const slotStats = {};`; change `addStats(stats, item && item.stats);` to also call `addStats(slotStats, item && item.stats);` and do the same for the enchant, each gem and the socket bonus; in the returned slot object add `stats: slotStats`. `addStats` already exists in the file. Do not touch the `empty: true` early return.

- [ ] **Step 4: Write the augmentation script**

```js
'use strict';
// Adds the fields the damage-budget engine needs to the two recorded fixtures, from local raw
// captures that are not committed. Run from the repo root: node fixtures/evaluation/augment-recorded.cjs
const fs = require('fs'), path = require('path');
const V = require('../../vet-engine');
const db = V.indexDb(require('../../data/tbc-item-db.json'));
const root = path.join(__dirname, '..', '..');
const bands = (table) => table && { data: { auras: (table.data?.auras || []).map(a => ({ name: a.name, guid: a.guid, type: a.type, totalUptime: a.totalUptime, totalUses: a.totalUses, bands: a.bands })) } };
const audit = (ci, classToken) => { const row = ci?.data?.[0]; if (!row?.gear) return undefined; const a = V.summarizeGear(row.gear.map(g => ({ ...g, gems: g.gems?.filter(gem => gem.id > 0) })), db, classToken); return { slots: a.slots, unknownItems: a.unknownItems }; };
const ciFor = (raw) => { const row = raw.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId); return row ? { data: [row] } : undefined; };
function augment(fixtureFile, rawDir) {
    const file = path.join(root, 'fixtures', 'evaluation', fixtureFile);
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const fight of fixture.fights) {
        const raw = JSON.parse(fs.readFileSync(path.join(root, 'output', rawDir, 'raw-' + fight.fightId + '.json'), 'utf8'));
        fight.tables.ci ||= ciFor(raw); fight.tables.buffs ||= bands(raw.tables.buffs); fight.gearAudit ||= audit(fight.tables.ci, raw.player.classToken);
        fight.context.debuffs ||= bands(raw.context.debuffs); fight.context.dmgAll ||= raw.context.dmgAll;
        for (const ref of fight.references || []) {
            const source = (raw.references || []).find(r => r.reportCode === ref.reportCode && r.fightId === ref.fightId && r.sourceId === ref.sourceId);
            if (!source) continue;
            ref.tables.ci = ciFor(source); ref.tables.buffs = bands(source.tables.buffs); ref.gearAudit = audit(ref.tables.ci, source.player.classToken);
            ref.context.dmgAll = { data: { entries: (source.context?.dmgAll?.data?.entries || []).filter(a => a.id === source.sourceId).map(a => ({ id: a.id, name: a.name, total: a.total, activeTime: a.activeTime })) } };
        }
    }
    fs.writeFileSync(file, JSON.stringify(fixture));
    console.log('augmented', fixtureFile);
}
augment('utopik-investigation.json', 'utopik-deep-dive');
augment('funkell-hunter.json', 'funkell-deep-dive');
```

Run: `node fixtures/evaluation/augment-recorded.cjs`
Expected: two `augmented` lines; `git diff --stat fixtures/` shows both files grew by well under 300 KB each.

- [ ] **Step 5: Run the tests**

Run: `node vet-engine.test.js && node --test evaluation-acceptance.test.js && npm run test:evaluation`
Expected: all PASS. The existing acceptance assertions must be unchanged; if any existing assertion fails because a reference now has combatant info (for example a different reference gets chosen), stop and report before changing expectations.

- [ ] **Step 6: Commit**

```bash
git add vet-engine.js vet-engine.test.js fixtures/evaluation/augment-recorded.cjs fixtures/evaluation/utopik-investigation.json fixtures/evaluation/funkell-hunter.json evaluation-acceptance.test.js
git commit -m "feat(evaluation): per-slot gear stats and reference snapshots in recorded fixtures"
```

---

### Task 4: Budget decomposition

**Files:**
- Create: `evaluation-budget.js`, `evaluation-budget.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `chooseReference`, `family`, `group` from `evaluation-damage-analysis.js`; `expectedOutcomes`, `varianceCheck` from `evaluation-mechanics.js`.
- Produces: `analyzeBudget(raw)` →
```js
{ status: 'decomposed'|'unavailable', reason?,
  player: { name, url, dps, durationSec }, reference: { name, url, dps, durationSec }, gapDps, headline,
  buckets: [{ id, name, attack, playerDps, referenceDps, differenceDps,
      outcomes: { player: Profile, reference: Profile },
      factors: { zeroDamage: { player: share, reference: share, expected: { player: {miss,dodge,parry,...}, reference }, variance: { miss: {within, ...}, dodge, parry }, dps },
                 rate: { player: perMinute, reference: perMinute, dps },
                 yield: { player: avgLanded, reference: avgLanded, dps, crit: { player: share, reference: share, dps }, perHit: { player: normalAvg, reference: normalAvg, dps } } } | null,
      assumptions: string[] }],
  residualDps, limitations: string[] }
```
`Profile` = `{ outcomes, zero: { miss, dodge, parry, resist, block, total }, landed: { hit: {count,total}, crit: {count,total}, glance: {count,total}, blocked: {count,total}, tick: {count,total}, resisted: {count,total}, count, total } }`.

Attack kind per family: `'melee'` family → `melee-white`; role `melee` other direct families → `melee-yellow`; role `ranged` → `ranged`; role `caster` → `spell`; `pet-damage` → `pet`; families with ticks and no hits → `periodic`. Only `melee-white`, `melee-yellow`, `ranged`, `spell` get `factors`; the others keep `factors: null` with a note.

The gap identity per bucket, with rates per second: `P = rP(1−zP)aP`, `R = rR(1−zR)aR`;
`rate.dps = (rR − rP)(1−zP)aP`, `zeroDamage.dps = rR((1−zR) − (1−zP))aP`, `yield.dps = rR(1−zR)(aR − aP)`; these three sum to `R − P` exactly. Inside yield: `crit.dps = rR(1−zR)(cR − cP)(critAvgP − normalAvgP)` and `perHit.dps = yield.dps − crit.dps`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeBudget } = require('./evaluation-budget');
const recorded = require('./fixtures/evaluation/utopik-investigation.json');
const winterchill = () => structuredClone(recorded.fights.find(f => f.name === 'Rage Winterchill'));

test('Utopik on Winterchill: melee bucket carries the four factors from the recorded outcome table', () => {
    const budget = analyzeBudget(winterchill());
    assert.equal(budget.status, 'decomposed');
    assert.equal(budget.reference.name, 'Jofrey');
    assert.equal(Math.round(budget.gapDps), 268);
    const melee = budget.buckets.find(b => b.id === 'melee');
    assert.equal(melee.attack, 'melee-white');
    assert.equal(melee.outcomes.player.outcomes, 226); assert.equal(melee.outcomes.reference.outcomes, 216);
    assert.equal(melee.outcomes.player.zero.dodge, 15); assert.equal(melee.outcomes.reference.zero.dodge, 6);
    assert.equal(melee.outcomes.player.zero.miss, 13); assert.equal(melee.outcomes.player.zero.total, 30);
    assert.equal(melee.outcomes.player.landed.glance.count, 52);
    assert.equal(Math.round(melee.factors.zeroDamage.expected.player.dodge.min * 10) / 10, 14.7);
    assert.equal(Math.round(melee.factors.zeroDamage.expected.reference.dodge.min * 10) / 10, 11.3);
    assert.equal(melee.factors.zeroDamage.variance.dodge.player.within, true);
    assert.equal(melee.factors.zeroDamage.variance.dodge.reference.within, true, '6 against 11.3 is luck, not a stat');
    const sum = melee.factors.rate.dps + melee.factors.zeroDamage.dps + melee.factors.yield.dps;
    assert.ok(Math.abs(sum - melee.differenceDps) < 0.6, 'factors reconstruct the bucket difference');
    assert.ok(Math.abs(melee.factors.yield.crit.dps + melee.factors.yield.perHit.dps - melee.factors.yield.dps) < 0.6);
    assert.ok(melee.assumptions.some(a => /Precision/.test(a)));
    assert.equal(budget.buckets.find(b => b.id === 'deadly poison').factors, null, 'periodic families are not decomposed');
});

test('missing reference or hit details degrade to unavailable without inventing counts', () => {
    const raw = winterchill(); raw.references = [];
    assert.equal(analyzeBudget(raw).status, 'unavailable');
    const noDetails = winterchill(); for (const row of noDetails.tables.dmg.data.entries) delete row.hitdetails;
    const budget = analyzeBudget(noDetails);
    assert.equal(budget.status, 'decomposed');
    assert.equal(budget.buckets.find(b => b.id === 'melee').factors, null);
    assert.ok(budget.limitations.some(l => /hit details/.test(l)));
});

test('equal DPS with more stats produces the execution headline', () => {
    const anetheron = structuredClone(recorded.fights.find(f => f.name === 'Anetheron'));
    const budget = analyzeBudget(anetheron);
    assert.match(budget.headline, /matched .* DPS with more stats/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-budget.test.js`
Expected: FAIL with `Cannot find module './evaluation-budget'`

- [ ] **Step 3: Write the module**

```js
'use strict';
// Arithmetic description of an observed gap. Nothing here is a recoverable-DPS estimate.
const { chooseReference, family } = require('./evaluation-damage-analysis.js');
const { expectedOutcomes, varianceCheck } = require('./evaluation-mechanics.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const entries = t => Array.isArray(t?.data?.entries) ? t.data.entries : null;
const fightOf = raw => raw?.context?.fights?.find(f => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const f = fightOf(raw); return f && (f.endTime - f.startTime) / 1000; };
const urlOf = raw => 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
const ci = raw => raw?.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId);
const actorDps = (raw, fallback) => { const a = entries(raw.context?.dmgAll)?.find(x => x.id === raw.sourceId); return finite(a?.total) ? a.total / durationOf(raw) : fallback; };
const ZERO = { Miss: 'miss', Dodge: 'dodge', Parry: 'parry', Resist: 'resist', Block: 'block', Immune: 'immune', Absorb: 'absorb' };
const LANDED = { Hit: 'hit', 'Critical Hit': 'crit', 'Glancing Blow': 'glance', 'Blocked Hit': 'blocked', 'Blocked Critical Hit': 'blocked', Tick: 'tick', 'Critical Tick': 'tick', 'Resisted Hit': 'resisted', 'Resisted Critical Hit': 'resisted', 'Resisted Tick': 'resisted', 'Resisted Critical Tick': 'resisted' };

function profile(table, familyId) {
    const rows = (entries(table) || []).filter(r => family(r).id === familyId && finite(r.total));
    if (!rows.length) return null;
    const p = { outcomes: 0, total: 0, zero: { miss: 0, dodge: 0, parry: 0, resist: 0, block: 0, immune: 0, absorb: 0, total: 0 }, landed: { count: 0, total: 0 }, detailed: true };
    for (const key of Object.values(LANDED)) p.landed[key] = { count: 0, total: 0 };
    for (const r of rows) {
        p.total += r.total;
        if (!Array.isArray(r.hitdetails) || !Array.isArray(r.missdetails)) { p.detailed = false; continue; }
        for (const m of r.missdetails) { const k = ZERO[m.type]; if (!k) { p.detailed = false; continue; } p.zero[k] += m.count; p.zero.total += m.count; p.outcomes += m.count; }
        for (const h of r.hitdetails) { const k = LANDED[h.type]; if (!k) { p.detailed = false; continue; } p.landed[k].count += h.count; p.landed[k].total += h.total; p.landed.count += h.count; p.landed.total += h.total; p.outcomes += h.count; }
    }
    return p;
}

function attackKind(raw, fam, own, other) {
    if (fam.id === 'pet-damage') return 'pet';
    const role = raw.player?.role;
    const p = own || other;
    if (p && p.landed.tick.count > 0 && p.landed.hit.count === 0 && p.landed.crit.count === 0) return 'periodic';
    if (fam.id === 'melee') return 'melee-white';
    if (role === 'ranged') return 'ranged';
    if (role === 'caster') return 'spell';
    if (role === 'melee') return 'melee-yellow';
    return 'other';
}

function factorsFor(attack, own, other, duration, otherDuration, ownCi, otherCi, classToken, assumptions) {
    if (!own || !other || !own.detailed || !other.detailed || !own.outcomes || !other.outcomes) return null;
    const hitKey = attack === 'spell' ? 'hitSpell' : attack === 'ranged' ? 'hitRanged' : 'hitMelee';
    const expect = (p, c) => expectedOutcomes({ attack, swings: p.outcomes, hitRating: c?.[hitKey] ?? 0, expertiseRating: c?.expertise ?? 0, classToken, inFront: p.zero.parry > 0 });
    const eP = expect(own, ownCi), eR = expect(other, otherCi);
    for (const a of [...eP.assumptions, ...eR.assumptions]) if (!assumptions.includes(a)) assumptions.push(a);
    if (!ownCi || !otherCi) assumptions.push('A combatant snapshot is missing on one side; expected outcome rates use zero hit and expertise rating for it.');
    const variance = {};
    for (const key of ['miss', 'dodge', 'parry']) variance[key] = { player: varianceCheck(own.zero[key], eP.expected[key], own.outcomes), reference: varianceCheck(other.zero[key], eR.expected[key], other.outcomes) };
    const rP = own.outcomes / duration, rR = other.outcomes / otherDuration;
    const zP = own.zero.total / own.outcomes, zR = other.zero.total / other.outcomes;
    const aP = own.landed.count ? own.landed.total / own.landed.count : 0, aR = other.landed.count ? other.landed.total / other.landed.count : 0;
    const cP = own.landed.count ? own.landed.crit.count / own.landed.count : 0, cR = other.landed.count ? other.landed.crit.count / other.landed.count : 0;
    const normal = p => p.landed.hit.count ? p.landed.hit.total / p.landed.hit.count : null, critAvg = p => p.landed.crit.count ? p.landed.crit.total / p.landed.crit.count : null;
    const rate = (rR - rP) * (1 - zP) * aP, zero = rR * ((1 - zR) - (1 - zP)) * aP, yieldDps = rR * (1 - zR) * (aR - aP);
    const critDps = normal(own) !== null && critAvg(own) !== null ? rR * (1 - zR) * (cR - cP) * (critAvg(own) - normal(own)) : 0;
    return {
        zeroDamage: { player: round(100 * zP), reference: round(100 * zR), expected: { player: eP.expected, reference: eR.expected }, rates: { player: eP.rates, reference: eR.rates }, variance, dps: round(zero) },
        rate: { player: round(rP * 60), reference: round(rR * 60), dps: round(rate) },
        yield: { player: round(aP), reference: round(aR), dps: round(yieldDps), crit: { player: round(100 * cP), reference: round(100 * cR), dps: round(critDps) }, perHit: { player: round(normal(own)), reference: round(normal(other)), critAverage: { player: round(critAvg(own)), reference: round(critAvg(other)) }, dps: round(yieldDps - critDps) } },
    };
}

function headlineFor(gap, playerDps, ownCi, otherCi, referenceName, role) {
    if (!ownCi || !otherCi || !finite(playerDps) || !finite(gap)) return null;
    const primary = role === 'caster' ? [['intellect', 'intellect'], ['spellPower', 'spell power']] : role === 'ranged' ? [['agility', 'agility'], ['intellect', 'intellect']] : [['strength', 'strength'], ['agility', 'agility']];
    const more = primary.filter(([k]) => finite(ownCi[k]) && finite(otherCi[k]) && ownCi[k] > otherCi[k] * 1.1);
    if (Math.abs(gap) <= 0.02 * playerDps && more.length) return 'You matched ' + referenceName + "'s DPS with more stats (" + more.map(([, l]) => l).join(', ') + '); the difference is in execution.';
    return null;
}

function analyzeBudget(raw) {
    if (['healer', 'tank'].includes(raw.player?.role) || !raw.player?.spec) return { status: 'unavailable', reason: 'Damage budgets apply to DPS roles.', buckets: [], limitations: [] };
    const reference = chooseReference(raw), duration = durationOf(raw), otherDuration = durationOf(reference);
    if (!reference || !(duration > 0) || !entries(raw.tables?.dmg)) return { status: 'unavailable', reason: 'An independent same-spec reference with a damage table is required.', buckets: [], limitations: [] };
    const limitations = [], assumptionsAll = [];
    const own = entries(raw.tables.dmg), other = entries(reference.tables.dmg);
    const ids = [...new Set([...own, ...other].filter(r => finite(r.total)).map(r => family(r).id))];
    const ownCi = ci(raw), otherCi = ci(reference), classToken = String(raw.player.classToken || '').toUpperCase();
    let anyUndetailed = false;
    const buckets = ids.map(id => {
        const fam = family([...own, ...other].find(r => family(r).id === id));
        const p = profile(raw.tables.dmg, id), r = profile(reference.tables.dmg, id);
        const playerDps = (p?.total || 0) / duration, referenceDps = (r?.total || 0) / otherDuration;
        const attack = attackKind(raw, fam, p, r);
        const assumptions = [];
        const decomposable = ['melee-white', 'melee-yellow', 'ranged', 'spell'].includes(attack);
        const factors = decomposable ? factorsFor(attack, p, r, duration, otherDuration, ownCi, otherCi, classToken, assumptions) : null;
        if (decomposable && !factors && (p && !p.detailed || r && !r.detailed)) anyUndetailed = true;
        return { id, name: fam.name, attack, playerDps: round(playerDps), referenceDps: round(referenceDps), differenceDps: round(referenceDps - playerDps), outcomes: { player: p, reference: r }, factors, assumptions };
    }).sort((a, b) => b.differenceDps - a.differenceDps);
    if (anyUndetailed) limitations.push('Some damage rows have no hit details; those buckets show totals only.');
    const ownTotal = buckets.reduce((s, b) => s + b.playerDps, 0), otherTotal = buckets.reduce((s, b) => s + b.referenceDps, 0);
    const playerDps = actorDps(raw, ownTotal), referenceDps = actorDps(reference, otherTotal);
    const gap = referenceDps - playerDps, accounted = buckets.reduce((s, b) => s + b.differenceDps, 0);
    if (Math.abs(gap - accounted) > 1) limitations.push(round(gap - accounted) + ' DPS of the gap lies outside the compared ability rows.');
    limitations.push('These values overlap and do not add up to the gap.');
    limitations.push('Target armor, weapon damage ranges and positioning are not compared.');
    return { status: 'decomposed', player: { name: raw.player.name, url: urlOf(raw), dps: round(playerDps), durationSec: round(duration) }, reference: { name: reference.player.name, url: urlOf(reference), dps: round(referenceDps), durationSec: round(otherDuration) },
        gapDps: round(gap), headline: headlineFor(gap, playerDps, ownCi, otherCi, reference.player.name, raw.player.role), buckets, residualDps: round(gap - accounted), limitations };
}
module.exports = { analyzeBudget, profile, attackKind };
```

- [ ] **Step 4: Run the test**

Run: `node --test evaluation-budget.test.js`
Expected: PASS (3 tests). If the Anetheron headline test fails because the recorded reference for Anetheron is not Mooyootoo or the gap is above 2%, print `budget.player.dps`, `budget.reference.dps` and the two snapshots, and report before changing the rule.

- [ ] **Step 5: Register and commit**

```bash
git add evaluation-budget.js evaluation-budget.test.js package.json
git commit -m "feat(evaluation): damage budget with four-factor decomposition and expected outcomes"
```

---

### Task 5: Attribution to named sources

**Files:**
- Create: `evaluation-attribution.js`, `evaluation-attribution.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `analyzeBudget` output; catalogue; `chooseReference`; gear audit slots with `stats`; combatant `auras`; buff bands; `context.debuffs`.
- Produces: `attributeCauses(raw, budget)` → `{ causes: Cause[], checks: [], limitations: [] }` where
```js
Cause = { id, bucket, factor: 'zeroDamage'|'rate'|'crit'|'perHit'|'all', kind, owner: 'you'|'raid'|'luck', title, observation, action, verification,
          evidence: [{ text, url }], statDelta: {index: delta} | null, sim: SimChange | null, priority: 'high'|'medium'|'low' }
```
Bucket mapping for stats: expertise and melee hit → bucket `melee` and every `melee-yellow` bucket, factor `zeroDamage` (one cause, `bucket: 'melee'`, `alsoBuckets: [...]`); ranged hit → `auto shot` bucket family id (`'auto shot'`) or the largest `ranged` bucket; spell hit → largest `spell` bucket; crit ratings and agility crit → factor `crit` on the largest bucket of that attack kind; haste → `rate`; attack power, strength, agility (AP part), spell power, intellect → `perHit`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeBudget } = require('./evaluation-budget');
const { attributeCauses } = require('./evaluation-attribution');
const recorded = require('./fixtures/evaluation/utopik-investigation.json');
const fight = name => structuredClone(recorded.fights.find(f => f.name === name));
const causesFor = name => { const raw = fight(name); return attributeCauses(raw, analyzeBudget(raw)).causes; };

test('Winterchill expertise gap resolves to Fang of Vashj with the reference luck stated', () => {
    const causes = causesFor('Rage Winterchill');
    const expertise = causes.find(c => c.id === 'stat-expertise');
    assert.equal(expertise.owner, 'you'); assert.equal(expertise.kind, 'gear'); assert.equal(expertise.bucket, 'melee'); assert.equal(expertise.factor, 'zeroDamage');
    assert.match(expertise.observation, /15 dodges against 6/);
    assert.match(expertise.observation, /0 expertise.*21/s);
    assert.ok(expertise.evidence.some(e => /Fang of Vashj/.test(e.text) && /21 expertise/.test(e.text)));
    assert.match(expertise.observation, /luck|variance/i, 'the reference dodge count below expectation is named');
    assert.deepEqual(expertise.statDelta, { 24: 21 });
    assert.deepEqual(expertise.sim, { bonusStats: { 24: 21 } });
    const miss = causes.find(c => c.id === 'luck-melee-miss');
    assert.equal(miss.owner, 'luck'); assert.match(miss.observation, /13 misses against 6/);
});

test('Winterchill auras at pull: flask against elixir, Kings, Unleashed Rage; trinket without damage stats', () => {
    const causes = causesFor('Rage Winterchill');
    const flask = causes.find(c => c.id === 'aura-flask');
    assert.equal(flask.owner, 'you'); assert.match(flask.observation, /Elixir of Major Agility/); assert.match(flask.observation, /Flask of Relentless Assault/);
    assert.deepEqual(flask.sim, { consumable: { field: 'flaskId', id: 22854, clear: ['battleElixirId', 'guardianElixirId'] } });
    const kings = causes.find(c => c.id === 'aura-25898');
    assert.equal(kings.owner, 'raid'); assert.match(kings.title, /Blessing of Kings/);
    const ur = causes.find(c => c.id === 'uptime-30807');
    assert.equal(ur.owner, 'raid'); assert.match(ur.observation, /80%/); assert.match(ur.observation, /0%/);
    const dst = causes.find(c => c.id === 'proc-28830');
    assert.equal(dst.owner, 'you'); assert.match(dst.observation, /Dragonspine Trophy/); assert.match(dst.observation, /Medallion of the Horde/);
    assert.deepEqual(dst.sim, { equip: { slot: 12, id: 28830, replaces: 28240 } });
    const drums = causes.find(c => c.id === 'uptime-35476');
    assert.equal(drums.owner, 'raid');
    const snd = causes.find(c => c.id === 'uptime-6774');
    assert.equal(snd, undefined, 'the player has more Slice and Dice uptime than the reference; no cause');
});

test('no cause is manufactured when both sides lack a table', () => {
    const raw = fight('Rage Winterchill'); delete raw.tables.buffs; for (const r of raw.references) delete r.tables.buffs;
    const result = attributeCauses(raw, analyzeBudget(raw));
    assert.ok(!result.causes.some(c => c.id.startsWith('uptime-')));
    assert.ok(result.limitations.some(l => /[Bb]uff bands/.test(l)));
});

test('Bloodlust and Heroism are one family, so a faction difference is not a cause', () => {
    const causes = causesFor('Rage Winterchill');
    assert.equal(causes.find(c => c.id === 'uptime-32182'), undefined);
    assert.equal(causes.find(c => c.id === 'uptime-2825'), undefined, 'Utopik 28% Bloodlust against Jofrey 31% Heroism is below the 10-point threshold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-attribution.test.js`
Expected: FAIL with `Cannot find module './evaluation-attribution'`

- [ ] **Step 3: Write the module**

```js
'use strict';
// Resolves each factor difference to a named source. A stat the equipment cannot explain is
// attributed to auras when an aura difference exists, otherwise it stays 'unexplained'.
const { chooseReference } = require('./evaluation-damage-analysis.js');
const { lookupAura, lookupUptime, lookupDebuff, procForItem } = require('./evaluation-catalogue.js');
const { RATING, CRIT_PERCENT_PER_AGILITY, ATTACK_POWER_PER_STRENGTH, ATTACK_POWER_PER_AGILITY } = require('./evaluation-mechanics.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const fightOf = raw => raw?.context?.fights?.find(f => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const f = fightOf(raw); return f && (f.endTime - f.startTime) / 1000; };
const urlOf = raw => 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
const ci = raw => raw?.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId);
// Gear-audit slot keys (vet-engine.js SLOTS) → WoWSims equipment index (evaluation-sim.js normalizeGear order)
const SLOT_TO_SIM = { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, finger1: 10, finger2: 11, trinket1: 12, trinket2: 13, mainHand: 14, offHand: 15, ranged: 16 };
const UPTIME_ALIAS = new Map([[32182, 2825]]); // Heroism and Bloodlust are one family
const DAMAGE_STAT_KEYS = new Set(['0', '1', '3', '5', '12', '13', '14', '17', '18', '20', '21', '22', '24']);
// Stat rows: [snapshot key, item-db index, label, factor, threshold, roles]
const STATS = [
    ['expertise', 24, 'expertise', 'zeroDamage', 4, ['melee']], ['hitMelee', 20, 'melee hit rating', 'zeroDamage', 8, ['melee']], ['hitRanged', 20, 'ranged hit rating', 'zeroDamage', 8, ['ranged']], ['hitSpell', 12, 'spell hit rating', 'zeroDamage', 8, ['caster']],
    ['critMelee', 21, 'melee crit rating', 'crit', 11, ['melee']], ['critRanged', 21, 'ranged crit rating', 'crit', 11, ['ranged']], ['critSpell', 13, 'spell crit rating', 'crit', 11, ['caster']],
    ['hasteMelee', 22, 'melee haste rating', 'rate', 8, ['melee']], ['hasteRanged', 22, 'ranged haste rating', 'rate', 8, ['ranged']], ['hasteSpell', 14, 'spell haste rating', 'rate', 8, ['caster']],
    ['strength', 0, 'strength', 'perHit', 20, ['melee']], ['agility', 1, 'agility', 'perHit', 20, ['melee', 'ranged']], ['intellect', 3, 'intellect', 'perHit', 20, ['caster', 'ranged']],
];

function slotStat(slot, index) { return Number(slot?.stats?.[index]) || 0; }
function describeSlot(slot, index) { return slot.label + ': ' + slot.name + (slot.enchant ? ' (' + slot.enchant.name + ')' : '') + (slot.gems?.length ? ' [' + slot.gems.map(g => g.name).join(', ') + ']' : '') + ' supplies ' + slotStat(slot, index); }

function targetBucket(budget, factor, role, statKey) {
    const kinds = role === 'caster' ? ['spell'] : role === 'ranged' ? ['ranged'] : statKey === 'expertise' || statKey === 'hitMelee' ? ['melee-white'] : ['melee-white', 'melee-yellow'];
    const candidates = budget.buckets.filter(b => kinds.includes(b.attack) && b.factors);
    if (!candidates.length) return null;
    const primary = candidates.find(b => b.id === 'melee') || candidates[0];
    return { bucket: primary.id, alsoBuckets: candidates.filter(b => b !== primary).map(b => b.id) };
}

function attributeCauses(raw, budget) {
    const out = { causes: [], checks: [], limitations: [] };
    if (!budget || budget.status !== 'decomposed') return out;
    const reference = chooseReference(raw);
    const own = ci(raw), other = ci(reference), role = raw.player?.role, classToken = String(raw.player?.classToken || '').toUpperCase();
    const ev = (text, r = raw) => ({ text, url: urlOf(r) });
    const push = c => out.causes.push({ priority: 'medium', verification: 'Compare the same snapshot and outcome counts on the next comparable pull.', evidence: [], statDelta: null, sim: null, ...c });
    const zeroNote = (bucket, key) => {
        const f = bucket?.factors?.zeroDamage; if (!f) return '';
        const p = bucket.outcomes.player.zero[key], r = bucket.outcomes.reference.zero[key];
        const eP = f.expected.player[key], eR = f.expected.reference[key];
        const fmt = e => Math.abs(e.max - e.min) < 0.05 ? round(e.min) : round(e.min) + ' to ' + round(e.max);
        const luckP = f.variance[key].player.within ? '' : ' (outside normal variance)', luckR = f.variance[key].reference.within ? (r < eR.min ? ' below expectation, so part of this line is luck' : '') : ' (outside normal variance)';
        return p + ' ' + (key === 'miss' ? 'misses' : key === 'dodge' ? 'dodges' : 'parries') + ' against ' + r + '. Expected from the recorded ratings: ' + fmt(eP) + ' for you' + luckP + ', ' + fmt(eR) + ' for ' + reference.player.name + luckR + '.';
    };
    // 1. Stat snapshot differences resolved through equipment
    if (own && other) {
        const slots = raw.gearAudit?.slots, otherSlots = reference.gearAudit?.slots;
        for (const [key, index, label, factor, threshold, roles] of STATS) {
            if (!roles.includes(role) || !finite(own[key]) || !finite(other[key])) continue;
            const diff = other[key] - own[key];
            if (Math.abs(diff) < threshold) continue;
            const target = targetBucket(budget, factor, role, key); if (!target) continue;
            const bucket = budget.buckets.find(b => b.id === target.bucket);
            const evidence = [];
            let gearDiff = null;
            if (slots && otherSlots) {
                gearDiff = 0;
                for (const s of slots) { const o = otherSlots.find(x => x.key === s.key); if (!o) continue; const d = slotStat(o, index) - slotStat(s, index); if (d) { gearDiff += d; evidence.push(ev('Your ' + describeSlot(s, index) + ' ' + label + '.')); evidence.push(ev(reference.player.name + "'s " + describeSlot(o, index) + ' ' + label + '.', reference)); } }
            }
            const unexplained = gearDiff === null ? null : diff - gearDiff;
            const observation = (key === 'expertise' ? zeroNote(bucket, 'dodge') + ' ' : key.startsWith('hit') ? zeroNote(bucket, 'miss') + ' ' : '') + 'You have ' + own[key] + ' ' + label + '; ' + reference.player.name + ' has ' + other[key] + '.' + (gearDiff === null ? ' Equipment stats are unavailable for one side.' : Math.abs(unexplained) <= Math.max(5, Math.abs(diff) * 0.15) ? ' The difference comes from equipment.' : ' Equipment explains ' + round(gearDiff) + ' of it; the remaining ' + round(unexplained) + ' is buffs, scrolls or consumables at pull.');
            // Only a stat the reference has more of becomes a cause; the luck lines below carry the counts either way.
            if (diff > 0) push({ id: 'stat-' + key.replace(/Melee|Ranged|Spell/, ''), bucket: target.bucket, alsoBuckets: target.alsoBuckets, factor, kind: 'gear', owner: 'you', title: 'Close the ' + label + ' gap', observation, action: gearDiff > 0 ? 'Compare the named slots above; the reference item, gem or enchant supplies the stat you lack.' : 'The stat gap is not from equipment; check the aura causes below.', evidence, statDelta: { [index]: round(diff) }, sim: { bonusStats: { [index]: round(diff) } }, priority: factor === 'zeroDamage' ? 'high' : 'medium' });
        }
        // Luck lines for miss/dodge/parry not covered by a stat cause
        for (const bucket of budget.buckets.filter(b => b.factors)) for (const key of ['miss', 'dodge', 'parry']) {
            const covered = out.causes.some(c => c.id.startsWith('stat-') && (c.bucket === bucket.id || list(c.alsoBuckets).includes(bucket.id)) && c.factor === 'zeroDamage' && ((key === 'dodge' && c.id === 'stat-expertise') || (key === 'miss' && c.id === 'stat-hit')));
            const p = bucket.outcomes.player.zero[key], r = bucket.outcomes.reference.zero[key];
            if (covered || p === r || (!p && !r)) continue;
            push({ id: 'luck-' + bucket.id + '-' + key, bucket: bucket.id, factor: 'zeroDamage', kind: 'luck', owner: 'luck', title: (key === 'miss' ? 'Misses' : key === 'dodge' ? 'Dodges' : 'Parries') + ' on ' + bucket.name + ' differ without a stat difference', observation: zeroNote(bucket, key), action: key === 'parry' && p > r ? 'Parries only happen from the front; check positioning on the next pull.' : 'No change; this is variance on a short pull.', evidence: [ev('Outcome counts come from the recorded damage table.')], priority: 'low' });
        }
    } else out.limitations.push('A combatant snapshot is missing on one side; stat causes are not compared.');
    // 2. Auras at pull
    if (own?.auras && other?.auras) {
        const ownIds = new Set(own.auras.map(a => Number(a.ability))), otherIds = new Set(other.auras.map(a => Number(a.ability)));
        const bySlot = (ids) => { const m = new Map(); for (const id of ids) { const e = lookupAura(id); if (e?.slot) m.set(e.slot, e); } return m; };
        const ownSlots = bySlot(ownIds), otherSlots = bySlot(otherIds);
        // A flask occupies both elixir slots. Compare what the reference has in each slot with
        // whatever the player has covering that slot.
        const covering = (slots, slot) => slots.get(slot) || (slot === 'battle' || slot === 'guardian' ? slots.get('flask') : null) || (slot === 'flask' ? slots.get('battle') || slots.get('guardian') : null);
        for (const slot of ['flask', 'battle', 'guardian', 'food']) {
            const theirs = otherSlots.get(slot); if (!theirs) continue;
            const mine = covering(ownSlots, slot);
            if (mine && (mine.id === theirs.id || (mine.slot === 'flask' && slot !== 'flask'))) continue;
            const label = slot === 'food' ? 'food buff' : slot === 'flask' ? 'flask' : slot + ' elixir';
            push({ id: 'aura-' + slot, bucket: 'all', factor: 'perHit', kind: 'consumable', owner: 'you', title: theirs.name + ' at pull', observation: 'At pull you had ' + (mine ? mine.name : 'no ' + label) + '; ' + reference.player.name + ' had ' + theirs.name + '.', action: 'Use ' + theirs.name + ' or an equivalent before the pull and recheck after every wipe.', evidence: [ev('Your auras at pull: ' + own.auras.map(a => a.name).join(', ') + '.'), ev(reference.player.name + "'s auras at pull: " + other.auras.map(a => a.name).join(', ') + '.', reference)], sim: theirs.sim, priority: 'high' });
        }
        for (const id of otherIds) {
            const e = lookupAura(id); if (!e || e.slot || ownIds.has(id)) continue;
            if (e.kind === 'blessing' && e.id === 25898 && ownIds.has(25895)) push({ id: 'aura-25898', bucket: 'all', factor: 'perHit', kind: 'blessing', owner: 'raid', title: 'Greater Blessing of Kings instead of Salvation', observation: 'You had Salvation; ' + reference.player.name + ' had Kings (+10% to all stats).', action: 'Ask for Kings if your threat allows it; otherwise keep Salvation.', evidence: [ev('Auras at pull are recorded in the combatant snapshot.')], sim: { set: [...e.sim.set, [['raid', 'parties', 0, 'players', 0, 'buffs', 'blessingOfSalvation'], false]] }, priority: 'medium' });
            else push({ id: 'aura-' + id, bucket: 'all', factor: 'perHit', kind: e.kind, owner: e.owner, title: e.name + ' was on ' + reference.player.name + ' and not on you', observation: e.name + ' is recorded on the reference at pull and absent from your snapshot.', action: e.owner === 'raid' ? 'Ask your raid leader whether ' + e.name + ' can reach your group.' : 'Apply ' + e.name + ' before the pull.', evidence: [ev('Auras at pull are recorded in the combatant snapshot.')], sim: e.sim, statDelta: e.stats || null, priority: 'medium' });
        }
    } else out.limitations.push('Auras at pull are missing on one side; consumable and blessing causes are not compared.');
    // 3. Buff uptime differences
    const ownBands = raw.tables?.buffs?.data?.auras, otherBands = reference.tables?.buffs?.data?.auras;
    if (Array.isArray(ownBands) && Array.isArray(otherBands)) {
        const d = durationOf(raw), dR = durationOf(reference);
        const canonicalId = id => UPTIME_ALIAS.get(id) || id;
        const pct = (rows, id, dur) => { const total = rows.filter(a => canonicalId(Number(a.guid)) === id).reduce((s, r) => s + (finite(r.totalUptime) ? r.totalUptime : 0), 0); return Math.min(100, 100 * total / (dur * 1000)); };
        const ids = new Set([...ownBands, ...otherBands].map(a => canonicalId(Number(a.guid))).filter(id => lookupUptime(id)));
        for (const id of ids) {
            const e = lookupUptime(id), mine = pct(ownBands, id, d), theirs = pct(otherBands, id, dR);
            if (theirs - mine < 10) continue;
            const affects = e.affects === 'all' ? 'perHit' : e.affects;
            if (e.kind === 'proc') {
                const item = e.itemId, wearer = reference.gearAudit?.slots?.find(s => s.id === item), mineToo = raw.gearAudit?.slots?.find(s => s.id === item);
                if (mineToo || !wearer) { push({ id: 'proc-' + id, bucket: 'all', factor: affects, kind: 'proc', owner: 'luck', title: e.name + ' proc uptime', observation: e.name + ' was active ' + round(mine) + '% of your pull and ' + round(theirs) + '% of ' + reference.player.name + "'s.", action: 'No change; proc uptime is variance.', evidence: [ev('Buff bands from both logs.')], priority: 'low' }); continue; }
                const trinkets = (raw.gearAudit?.slots || []).filter(s => /^trinket/.test(s.key) && s.id);
                const weakest = trinkets.find(s => !Object.keys(s.stats || {}).some(k => DAMAGE_STAT_KEYS.has(k))) || null;
                push({ id: 'proc-' + item, bucket: 'all', factor: affects, kind: 'gear', owner: 'you', title: wearer.name + ' proc uptime', observation: reference.player.name + ' had ' + e.name + ' from ' + wearer.name + ' active ' + round(theirs) + '% of the pull. You do not wear it' + (weakest ? '; you wore ' + weakest.name + ', which has no damage stats' : '') + '.', action: weakest ? 'Never raid with ' + weakest.name + ' equipped; any damage trinket beats it.' : 'Compare ' + wearer.name + ' with your trinkets.', evidence: [ev(reference.player.name + ' equipped ' + wearer.name + '.', reference), ...(weakest ? [ev('Your ' + weakest.label + ': ' + weakest.name + '.')] : [])], sim: weakest ? { equip: { slot: SLOT_TO_SIM[weakest.key], id: item, replaces: weakest.id } } : null, priority: 'high' });
                continue;
            }
            push({ id: 'uptime-' + id, bucket: 'all', factor: affects, kind: e.kind, owner: e.owner, title: e.name + ' uptime', observation: e.name + ' was active ' + round(mine) + '% of your pull and ' + round(theirs) + '% of ' + reference.player.name + "'s.", action: e.owner === 'raid' ? 'Ask your raid leader whether ' + e.name + ' can be provided to your group.' : 'Keep ' + e.name + ' running; compare the bands on the next pull.', evidence: [ev('Buff bands from both logs.')], sim: e.sim, priority: e.owner === 'you' ? 'high' : 'medium' });
        }
    } else out.limitations.push('Buff bands are missing on one side; uptime causes are not compared.');
    // 4. Target debuffs
    const ownDebuffs = raw.context?.debuffs?.data?.auras, otherDebuffs = reference.context?.debuffs?.data?.auras;
    if (Array.isArray(ownDebuffs) && Array.isArray(otherDebuffs)) {
        for (const [id, e] of [...new Set([...ownDebuffs, ...otherDebuffs].map(a => Number(a.guid)))].map(id => [id, lookupDebuff(id)]).filter(([, e]) => e)) {
            const mine = ownDebuffs.some(a => Number(a.guid) === id), theirs = otherDebuffs.some(a => Number(a.guid) === id);
            if (mine || !theirs) continue;
            push({ id: 'debuff-' + id, bucket: 'all', factor: e.affects, kind: 'debuff', owner: 'raid', title: e.name + ' was on the reference target only', observation: e.name + ' is recorded on ' + reference.player.name + "'s target and not on yours.", action: 'Ask your raid leader who is assigned to keep ' + e.name + ' on the boss.', evidence: [ev('Debuff tables from both reports.')], sim: e.sim, priority: 'medium' });
        }
    } else out.limitations.push('Target debuff tables are not available for both pulls; debuff causes are not compared.');
    out.checks.push({ id: 'attribution', label: 'Named sources behind the gap', status: 'checked', reason: out.causes.length + ' causes resolved.' });
    return out;
}
module.exports = { attributeCauses };
```

- [ ] **Step 4: Run the test**

Run: `node --test evaluation-attribution.test.js`
Expected: PASS (4 tests). The `list` helper used in the `covered` check is `const list = v => Array.isArray(v) ? v : [];` — add it next to `finite`. If `Drums of Battle` has no `sim` (Task 2 Step 3 found no aura mapping), the drums cause still exists with `sim: null`.

- [ ] **Step 5: Register and commit**

```bash
git add evaluation-attribution.js evaluation-attribution.test.js package.json
git commit -m "feat(evaluation): attribute factor differences to named items, auras, uptimes and debuffs"
```

---

### Task 6: Execution findings declare bucket and measure

**Files:**
- Modify: `evaluation-hunter-evidence.js` (pet survival, Kill Command, Steady Shot findings), `evaluation-rogue-evidence.js` (`rogue-snd-midfight-gap`)
- Test: `evaluation-hunter-evidence.test.js`, `evaluation-rogue-evidence.test.js`

**Interfaces:**
- Produces on findings: `bucket` (damage family id: `'pet-damage'`, `'kill command'`, `'steady shot'`, `'melee'`) and `measure: { lostSeconds, activeRateDps, note }` or `measure: { lostCasts, averageDamage, note }`.
  - Pet survival: `lostSeconds` = summed dead-window seconds; `activeRateDps` = `petTotal / (duration − lostSeconds)`.
  - Kill Command: `lostCasts` = expired opportunities; `averageDamage` = mean landed Kill Command damage on this pull (0 if none landed).
  - Steady Shot gaps: `lostSeconds` = summed gap seconds beyond 3 s each; `activeRateDps` = Steady Shot total ÷ (duration − lostSeconds).
  - Slice and Dice gap: `lostSeconds` = gap length; `activeRateDps` = melee DPS × 0.3 with note "Slice and Dice is 30% attack speed with 3/3 Improved Slice and Dice; the talent is not recorded" (range 20 to 30%).

- [ ] **Step 1: Write the failing tests**

Append to `evaluation-hunter-evidence.test.js`:

```js
test('pet survival findings carry a bucket and an observed-rate measure', () => {
    const arch = finding(raw('Archimonde'), 'hunter-pet-survival');
    assert.equal(arch.bucket, 'pet-damage');
    assert.equal(Math.round(arch.measure.lostSeconds * 10) / 10, 115.7);
    assert.ok(arch.measure.activeRateDps > 300 && arch.measure.activeRateDps < 600, 'pet rate while alive, not over the whole pull: ' + arch.measure.activeRateDps);
    const kc = finding(raw("Kaz'rogal"), 'hunter-kill-command');
    assert.equal(kc.bucket, 'kill command'); assert.equal(kc.measure.lostCasts, 2); assert.ok(kc.measure.averageDamage > 0);
    const steady = finding(raw("Kaz'rogal"), 'hunter-shot-rhythm');
    assert.equal(steady.bucket, 'steady shot'); assert.ok(steady.measure.lostSeconds > 40 && steady.measure.lostSeconds < 60, 'five gaps minus three seconds each: ' + steady.measure.lostSeconds);
    assert.ok(steady.measure.activeRateDps > 364.8, 'rate outside the gaps exceeds the whole-pull 364.8 DPS');
});
```
The finding ids are `hunter-pet-survival` (line 97), `hunter-shot-rhythm` (line 140) and `hunter-kill-command` (line 183) in `evaluation-hunter-evidence.js`.

Append to `evaluation-rogue-evidence.test.js`:

```js
test('the Slice and Dice gap finding carries a melee bucket and a bounded measure', () => {
    const raw = structuredClone(require('./fixtures/evaluation/utopik-investigation.json').fights.find(f => f.name === 'Rage Winterchill'));
    const snd = analyzeRogue(raw).findings.find(f => f.id === 'rogue-snd-midfight-gap');
    assert.equal(snd.bucket, 'melee');
    assert.equal(Math.round(snd.measure.lostSeconds * 10) / 10, 3.5);
    assert.ok(snd.measure.activeRateDps > 200 && snd.measure.activeRateDps < 300, '30% of 874 melee DPS');
    assert.match(snd.measure.note, /Improved Slice and Dice/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test evaluation-hunter-evidence.test.js evaluation-rogue-evidence.test.js`
Expected: the two new tests FAIL with `bucket` undefined.

- [ ] **Step 3: Implement**

Hunter (`evaluation-hunter-evidence.js`):
- In the `deadWindows.length` branch (the `add(sharedPullDeath ? 'hunter-pull-survival' : 'hunter-pet-survival', …)` call at line 97), add to its options object:
```js
bucket: 'pet-damage', measure: { lostSeconds: round(seconds), activeRateDps: round(petTotal / Math.max(1, duration - seconds)), note: 'Pet damage rate while the pet was alive on this pull.' },
```
- In the `missed.length >= 2` branch (`add('hunter-kill-command', …)` at line 183), compute before the call `const kcDamage = own.filter(e => e.type === 'damage' && spell(e) === 34026 && e.amount > 0);` and add to its options object:
```js
bucket: 'kill command', measure: { lostCasts: missed.length, averageDamage: kcDamage.length ? round(kcDamage.reduce((s, e) => s + e.amount, 0) / kcDamage.length) : 0, note: "One Kill Command per expired opportunity at this pull's average landed damage." },
```
- In the `gaps.length` branch (`add('hunter-shot-rhythm', …)` at line 140), compute before the call `const lostSteady = gaps.reduce((s, w) => s + Math.max(0, (w.end.timestamp - w.start.timestamp) / 1000 - 3), 0); const steadyTotal = damage.reduce((sum, e) => sum + e.amount, 0);` (move the existing `damage` declaration above it) and add to its options object:
```js
bucket: 'steady shot', measure: { lostSeconds: round(lostSteady), activeRateDps: round(steadyTotal / Math.max(1, duration - lostSteady)), note: 'Steady Shot rate outside the gaps; the first three seconds of each gap are allowed for movement.' },
```

Rogue (`evaluation-rogue-evidence.js`, `rogue-snd-midfight-gap`): the `add` helper takes `impact` as its last parameter; add two more optional parameters `bucket` and `measure` after it and spread them into the finding (`...(bucket ? { bucket } : {}), ...(measure ? { measure } : {})`). At the call site pass `undefined` for `impact`, then `'melee'`, then `{ lostSeconds: round(between.end - between.start), activeRateDps: round(0.3 * meleeTotal / d), note: 'Slice and Dice is 30% attack speed with 3/3 Improved Slice and Dice and 20% without; the talent is not recorded.' }` where `meleeTotal` is the sum of `amount` over `events` with `spell(e) === 1 && e.type === 'damage'`.

- [ ] **Step 4: Run the tests**

Run: `node --test evaluation-hunter-evidence.test.js evaluation-rogue-evidence.test.js evaluation-acceptance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add evaluation-hunter-evidence.js evaluation-hunter-evidence.test.js evaluation-rogue-evidence.js evaluation-rogue-evidence.test.js
git commit -m "feat(evaluation): execution findings declare their damage bucket and observed-rate measure"
```

---

### Task 7: Pricing and bounds

**Files:**
- Create: `evaluation-pricing.js`, `evaluation-pricing.test.js`
- Modify: `evaluation-sim.js` (export `simulate`, `checkedBinaries`, `computeStats` through `_internals`), `package.json`

**Interfaces:**
- Produces:
  - `boundFor(finding, bucket)` (pure) → `{ kind: 'bound', dps, label, capped }` or `{ kind: 'unsized', label: 'not sized' }`.
  - `priceCauses(raw, { budget, causes }, deps = {})` (async) → `{ status: 'priced'|'unavailable'|'withheld', reason?, baselineDps?, rotation: 'validated'|'unvalidated', prices: { [causeId]: { dps, iterations } }, assumptions: string[] }`.
  - `SANITY = { low: 0.7, high: 1.5 }`, `ITERATIONS = 3000`, `MAX_SCENARIOS = 12`.
  - `deps`: `{ modelFor, combatant, buildBaseline, checkedBinaries, simulate }` defaulting to the sim adapter internals; tests inject fakes.
- Rules:
  - Bound: `dps = min(activeRateDps × lostSeconds / durationSec, |bucket.differenceDps|)` for seconds measures, `lostCasts × averageDamage / durationSec` for cast measures; `capped: true` when the cap applied; label `up to about N DPS on this pull`.
  - Pricing gate 1: model must be `native` and not a tank; healers never reach here. No talent gate: the sanity gate decides.
  - Rotation label: `unvalidated` when `model.requiresTalentOverride`, `model.id === 'rogue-assassination'`, or no `raw.modelOverrides.talentsString`; otherwise `validated`.
  - Sanity gate: `baseline / max(budget.player.dps, budget.reference.dps)` must be within `[0.7, 1.5]`; otherwise `status: 'withheld'` with reason `'The model baseline (N DPS) cannot reproduce the observed N DPS; enter your talents in Model settings to price gear and buffs.'`.
  - Scenario per cause with `sim` and owner `you` or `raid`, at most `MAX_SCENARIOS` ordered by the absolute difference of the cause's bucket (`'all'` counts as the gap); apply `sim.set` pairs, `sim.bonusStats` (a 40-slot array with the deltas, `pseudoStats: []`), `sim.consumable` (set field, delete `clear` fields, for `potId` also push into `potions`), `sim.equip` (replace the item at `slot` with `{ id, enchant: 0, gems: [] }`). Iterations `ITERATIONS`, seed as baseline.
  - Price = `round(scenario.dps − baseline.dps)`; keep zero and negative prices (label "no measurable gain in the model").

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-pricing.test.js`
Expected: FAIL with `Cannot find module './evaluation-pricing'`

- [ ] **Step 3: Export the sim helpers and write the module**

In `evaluation-sim.js` add `simulate, checkedBinaries, computeStats` to the `_internals` object in `module.exports`.

```js
'use strict';
// Sizes causes with the pinned simulator (same character, one change) and execution findings
// with observed-rate bounds. Never sums; never prints absolute DPS from an unvalidated rotation.
const Models = require('./evaluation-models.js');
const Sim = require('./evaluation-sim.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const clone = v => JSON.parse(JSON.stringify(v));
const SANITY = { low: 0.7, high: 1.5 };
const ITERATIONS = 3000;
const MAX_SCENARIOS = 12;

function boundFor(finding, bucket) {
    const m = finding?.measure, duration = Number(bucket?.durationSec);
    if (!m || !(duration > 0)) return { kind: 'unsized', label: 'not sized' };
    let dps = null;
    if (finite(m.lostSeconds) && finite(m.activeRateDps)) dps = m.activeRateDps * m.lostSeconds / duration;
    else if (finite(m.lostCasts) && finite(m.averageDamage)) dps = m.lostCasts * m.averageDamage / duration;
    if (!finite(dps) || dps <= 0) return { kind: 'unsized', label: 'not sized' };
    const cap = finite(bucket?.differenceDps) && bucket.differenceDps > 0 ? bucket.differenceDps : Infinity;
    const capped = dps > cap;
    const value = round(Math.min(dps, cap));
    return { kind: 'bound', dps: value, capped, label: 'up to about ' + Math.round(value) + ' DPS on this pull' + (capped ? ' (capped at the bucket difference)' : '') + (m.note ? '. ' + m.note : '') };
}

function setPath(target, path, value) { let node = target; for (const key of path.slice(0, -1)) node = node[key]; node[path[path.length - 1]] = value; }
function applyChange(request, change) {
    const player = request.raid.parties[0].players[0];
    if (change.set) for (const [path, value] of change.set) setPath(request, path, value);
    if (change.bonusStats) { const stats = new Array(40).fill(0); for (const [index, delta] of Object.entries(change.bonusStats)) stats[Number(index)] = Number(delta); player.bonusStats = { stats, pseudoStats: [] }; }
    if (change.consumable) { const c = player.consumables || (player.consumables = {}); c[change.consumable.field] = change.consumable.id; for (const f of change.consumable.clear || []) delete c[f]; if (change.consumable.field === 'potId') c.potions = [...new Set([...(c.potions || []), change.consumable.id])]; }
    if (change.equip) player.equipment.items[change.equip.slot] = { id: change.equip.id, enchant: 0, gems: [] };
}

async function priceCauses(raw, { budget, causes }, deps = {}) {
    const d = { modelFor: Models.modelFor, combatant: Sim._internals.combatant, buildBaseline: Sim._internals.buildModelBaseline, checkedBinaries: Sim._internals.checkedBinaries, simulate: Sim._internals.simulate, ...deps };
    const result = { status: 'unavailable', rotation: 'unvalidated', prices: {}, assumptions: [] };
    if (!budget || budget.status !== 'decomposed') return { ...result, reason: 'No damage budget to price.' };
    const resolved = d.modelFor(raw?.player);
    if (resolved.kind !== 'native' || resolved.model.role === 'TANK') return { ...result, reason: resolved.reason || 'No native DPS model for this specialization.' };
    const model = resolved.model;
    result.rotation = model.requiresTalentOverride || model.id === 'rogue-assassination' || !raw?.modelOverrides?.talentsString ? 'unvalidated' : 'validated';
    let binaries; try { binaries = await d.checkedBinaries(); } catch (error) { return { ...result, reason: error.message }; }
    const info = d.combatant(raw);
    if (!info?.gear) return { ...result, reason: 'A combatant equipment snapshot is required to price changes.' };
    let built; try { built = d.buildBaseline(raw, info, model); } catch (error) { return { ...result, reason: 'Model build failed: ' + error.message }; }
    const baselineRequest = clone(built.request); baselineRequest.simOptions.iterations = ITERATIONS;
    let baseline; try { baseline = await d.simulate(baselineRequest, binaries.sim); } catch (error) { return { ...result, reason: 'WoWSims execution failed: ' + error.message }; }
    const observed = Math.max(Number(budget.player?.dps) || 0, Number(budget.reference?.dps) || 0);
    const ratio = observed > 0 ? baseline.dps / observed : 0;
    result.baselineDps = Math.round(baseline.dps);
    if (ratio < SANITY.low || ratio > SANITY.high) return { ...result, status: 'withheld', reason: 'The model baseline (' + Math.round(baseline.dps) + ' DPS) cannot reproduce the observed ' + Math.round(observed) + ' DPS; enter your talents in Model settings to price gear and buffs.' };
    const size = c => c.bucket === 'all' ? Math.abs(Number(budget.gapDps) || 0) : Math.abs(Number(budget.buckets.find(b => b.id === c.bucket)?.differenceDps) || 0);
    const priced = (causes || []).filter(c => c.sim && ['you', 'raid'].includes(c.owner)).sort((a, b) => size(b) - size(a)).slice(0, MAX_SCENARIOS);
    for (const cause of priced) {
        const request = clone(built.request); request.simOptions.iterations = ITERATIONS;
        try { applyChange(request, cause.sim); const run = await d.simulate(request, binaries.sim); result.prices[cause.id] = { dps: Math.round(run.dps - baseline.dps), iterations: run.iterations }; }
        catch (error) { result.assumptions.push(cause.id + ' could not be priced: ' + error.message); }
    }
    result.status = 'priced';
    result.assumptions.unshift('Prices are one change at a time on your reconstructed character with ' + ITERATIONS + ' iterations; ' + (result.rotation === 'validated' ? 'validated rotation.' : 'unvalidated rotation, so only stat deltas are shown and never an absolute DPS.'));
    return result;
}
module.exports = { boundFor, priceCauses, applyChange, SANITY, ITERATIONS, MAX_SCENARIOS };
```

- [ ] **Step 4: Run the tests**

Run: `node --test evaluation-pricing.test.js evaluation-sim.test.js`
Expected: PASS

- [ ] **Step 5: Live check against the real binaries (not part of npm test)**

```bash
node -e '
const { analyzeBudget } = require("./evaluation-budget"); const { attributeCauses } = require("./evaluation-attribution"); const { priceCauses } = require("./evaluation-pricing");
(async () => { for (const [dir, id] of [["funkell-deep-dive", 22], ["utopik-deep-dive", 11]]) { const raw = require("./output/" + dir + "/raw-" + id + ".json"); const budget = analyzeBudget(raw); const { causes } = attributeCauses(raw, budget); const r = await priceCauses(raw, { budget, causes }); console.log(dir, r.status, r.rotation, r.baselineDps, r.reason || "", JSON.stringify(r.prices)); } })();'
```
Expected: Funkell Anetheron `priced` with a baseline near 1950 and a price per cause; Utopik Winterchill `withheld` with the 666-DPS reason. Paste the output in the task report.

- [ ] **Step 6: Register and commit**

```bash
git add evaluation-pricing.js evaluation-pricing.test.js evaluation-sim.js package.json
git commit -m "feat(evaluation): sim-priced causes with sanity gates and observed-rate bounds"
```

---

### Task 8: Coaching composition with buckets and sizes

**Files:**
- Modify: `evaluation-coaching.js`, `evaluation-coaching.test.js`

**Interfaces:**
- Consumes: `fight.budget`, `fight.causes`, `fight.pricing`, `fight.findings`, `fight.durationSec`; `boundFor` from pricing.
- Produces (added to the existing `buildFightCoaching` result, which keeps `assessment`, `improvements`, `keeps`, `reviews`, `depth`, `openQuestions`):
```js
buckets: [{ id, name, attack, playerDps, referenceDps, differenceDps, factors, assumptions,
            items: [ { ...cause or coachingFinding, itemKind: 'cause'|'finding', size: { kind, dps, label } } ] sorted by size desc, owner you before raid,
            note: 'These values overlap and do not add up to the gap.' }],
budget: { player, reference, gapDps, headline, limitations, residualDps, pricing: { status, rotation, reason, baselineDps } },
sized: [ top items across buckets with { bucket } ]
```
- Night (`buildNightCoaching`): adds `topSized` (five largest sized items across fights, deduped by `id` keeping the largest, each with `bosses: []` and `size`), and `bossLines: [{ boss, playerDps, referenceDps, gapDps, topBucket }]`; `assessment` becomes "Across N pulls the biggest sized lever is <title> (<size label>) on <bosses>." when any sized item exists, else the current text.
- Sizing: a cause gets `{ kind: 'priced', dps, label: 'about N DPS for your build, priced with the (un)validated rotation' }` when `pricing.prices[cause.id]` exists, else `{ kind: 'unsized', label: pricing.status === 'withheld' ? 'not sized: ' + pricing.reason : 'not sized' }`; owner `luck` causes are always `{ kind: 'variance', dps: 0, label: 'variance' }`. A finding with `measure` gets `boundFor(finding, bucket)`; without, `unsized`.
- Sorting key: priced and bound by `dps` desc, then variance, then unsized; ties owner `you` < `raid` < `luck`.
- Bucket membership: items whose `bucket` (or `alsoBuckets`) matches; `bucket: 'all'` items go into a synthetic first bucket `{ id: 'all', name: 'Whole pull (buffs, consumables, raid support)' }`; findings without `bucket` go to `{ id: 'pull', name: 'Execution and survival' }`. Buckets with no items and `|differenceDps| < 20` are dropped.

- [ ] **Step 1: Write the failing test**

Append to `evaluation-coaching.test.js`:

```js
test('buckets carry causes and findings sorted by size, with the whole-pull bucket first', () => {
    const fight = { name: 'Winterchill', durationSec: 141.4,
        budget: { status: 'decomposed', gapDps: 268, headline: null, player: { name: 'Utopik', dps: 1546 }, reference: { name: 'Jofrey', dps: 1815 }, limitations: ['These values overlap and do not add up to the gap.'], residualDps: 0,
            buckets: [{ id: 'melee', name: 'Melee', attack: 'melee-white', playerDps: 874, referenceDps: 1057, differenceDps: 183, factors: {}, assumptions: [] }, { id: 'rupture', name: 'Rupture', attack: 'periodic', playerDps: 57, referenceDps: 60, differenceDps: 3, factors: null, assumptions: [] }] },
        causes: [
            { id: 'stat-expertise', bucket: 'melee', factor: 'zeroDamage', kind: 'gear', owner: 'you', title: 'Close the expertise gap', observation: 'o', action: 'a', evidence: [], sim: { bonusStats: { 24: 21 } } },
            { id: 'luck-melee-miss', bucket: 'melee', factor: 'zeroDamage', kind: 'luck', owner: 'luck', title: 'Misses differ', observation: 'o', action: 'none', evidence: [] },
            { id: 'aura-flask', bucket: 'all', factor: 'perHit', kind: 'consumable', owner: 'you', title: 'Flask', observation: 'o', action: 'a', evidence: [], sim: {} },
            { id: 'uptime-30807', bucket: 'all', factor: 'perHit', kind: 'raid-buff', owner: 'raid', title: 'Unleashed Rage', observation: 'o', action: 'a', evidence: [], sim: {} }],
        pricing: { status: 'priced', rotation: 'unvalidated', prices: { 'stat-expertise': { dps: 18 }, 'aura-flask': { dps: 31 }, 'uptime-30807': { dps: 45 } } },
        findings: [{ id: 'rogue-snd-midfight-gap', title: 'SnD gap', disposition: 'improve', action: 'Refresh', evidence: [{ text: 'gap' }], bucket: 'melee', measure: { lostSeconds: 3.5, activeRateDps: 262 } },
                   { id: 'survived-kill', title: 'Survived', disposition: 'keep', evidence: [{ text: 'x' }] }] };
    const c = buildFightCoaching(fight);
    assert.deepEqual(c.buckets.map(b => b.id), ['all', 'melee']);
    assert.deepEqual(c.buckets[0].items.map(i => i.id), ['uptime-30807', 'aura-flask']);
    assert.equal(c.buckets[0].items[0].size.kind, 'priced'); assert.match(c.buckets[0].items[0].size.label, /45 DPS.*unvalidated/);
    assert.deepEqual(c.buckets[1].items.map(i => i.id), ['stat-expertise', 'rogue-snd-midfight-gap', 'luck-melee-miss']);
    assert.equal(c.buckets[1].items[1].size.kind, 'bound'); assert.equal(Math.round(c.buckets[1].items[1].size.dps), 6);
    assert.equal(c.buckets[1].items[2].size.kind, 'variance');
    assert.equal(c.buckets[1].note, 'These values overlap and do not add up to the gap.');
    assert.equal(c.sized[0].id, 'uptime-30807');
    assert.match(c.assessment, /1546.*1815/s); assert.match(c.assessment, /Unleashed Rage/);
    assert.equal(c.improvements.length, 1, 'legacy lists still exist');
});

test('withheld pricing labels every cause and old reports without a budget keep the current shape', () => {
    const fight = { name: 'A', durationSec: 100, budget: { status: 'decomposed', gapDps: 100, player: { dps: 1000 }, reference: { dps: 1100 }, buckets: [], limitations: [] }, causes: [{ id: 'stat-hit', bucket: 'all', owner: 'you', title: 't', observation: 'o', action: 'a', evidence: [], sim: {} }], pricing: { status: 'withheld', reason: 'The model baseline (666 DPS) cannot reproduce the observed 1815 DPS; enter your talents in Model settings to price gear and buffs.', prices: {} }, findings: [] };
    const c = buildFightCoaching(fight);
    assert.match(c.buckets[0].items[0].size.label, /not sized: The model baseline/);
    const legacy = buildFightCoaching({ name: 'B', findings: [{ id: 'x', title: 'X', disposition: 'improve', action: 'a', evidence: ['e'] }] });
    assert.equal(legacy.buckets, undefined); assert.equal(legacy.improvements.length, 1);
    const night = buildNightCoaching({ fights: [{ name: 'A', coaching: c }, { name: 'B', coaching: legacy }] });
    assert.equal(night.topSized.length, 0, 'unsized items never reach the night top list');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test evaluation-coaching.test.js`
Expected: the two new tests FAIL (`c.buckets` undefined).

- [ ] **Step 3: Implement**

Add at the top of `evaluation-coaching.js`: `const { boundFor } = require('./evaluation-pricing.js');`.

Add these helpers and use them inside `buildFightCoaching` after `reviews` is computed:

```js
const sizeRank = (s) => ({ priced: 0, bound: 0, variance: 1, unsized: 2 })[s?.kind] ?? 3;
const ownerRank = (o) => ({ you: 0, player: 0, raid: 1, luck: 2 })[o] ?? 3;
function sizeForCause(cause, pricing) {
    if (cause.owner === 'luck') return { kind: 'variance', dps: 0, label: 'variance' };
    const price = pricing?.prices?.[cause.id];
    if (price && Number.isFinite(price.dps)) return { kind: 'priced', dps: price.dps, label: 'about ' + price.dps + ' DPS for your build, priced with the ' + (pricing.rotation === 'validated' ? 'validated' : 'unvalidated') + ' rotation' };
    return { kind: 'unsized', dps: null, label: pricing?.status === 'withheld' && pricing.reason ? 'not sized: ' + pricing.reason : 'not sized' };
}
function sortItems(items) {
    return items.sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || ((b.size?.dps ?? -1) - (a.size?.dps ?? -1)) || ownerRank(a.owner) - ownerRank(b.owner) || String(a.title || a.what).localeCompare(String(b.title || b.what)));
}
function buildBuckets(fight, improvements) {
    const budget = fight.budget; if (!budget || budget.status !== 'decomposed') return null;
    const pricing = fight.pricing || { status: 'unavailable', prices: {} };
    const duration = fight.durationSec;
    const all = { id: 'all', name: 'Whole pull (buffs, consumables, raid support)', differenceDps: budget.gapDps, durationSec: duration, items: [] };
    const pull = { id: 'pull', name: 'Execution and survival', differenceDps: null, durationSec: duration, items: [] };
    const buckets = list(budget.buckets).map(b => ({ ...b, durationSec: duration, items: [] }));
    const find = id => id === 'all' ? all : buckets.find(b => b.id === id) || null;
    for (const cause of list(fight.causes)) {
        const item = { ...cause, itemKind: 'cause', size: sizeForCause(cause, pricing) };
        const targets = [cause.bucket, ...list(cause.alsoBuckets)].map(find).filter(Boolean);
        (targets.length ? targets : [pull]).forEach((t, i) => t.items.push(i ? { ...item, mirrored: true } : item));
    }
    for (const finding of improvements) {
        const source = list(fight.findings).find(f => f.id === finding.id) || {};
        const target = find(source.bucket) || pull;
        target.items.push({ ...finding, bucket: target.id, itemKind: 'finding', size: source.measure ? boundFor(source, target) : { kind: 'unsized', dps: null, label: 'not sized' } });
    }
    const result = [all, ...buckets.filter(b => b.items.length || Math.abs(b.differenceDps) >= 20), pull].filter(b => b.items.length || (b.id !== 'pull' && b.id !== 'all'));
    for (const b of result) { sortItems(b.items); b.note = 'These values overlap and do not add up to the gap.'; }
    return result;
}
```

In `buildFightCoaching`, after computing `improvements`, `keeps`, `reviews`:
```js
const buckets = buildBuckets(fight, improvements);
const sized = buckets ? sortItems(buckets.flatMap(b => b.items.filter(i => ['priced', 'bound'].includes(i.size?.kind) && !i.mirrored).map(i => ({ ...i, bucket: b.id })))) : [];
let assessment;
if (buckets) {
    const budget = fight.budget;
    assessment = 'On ' + name + ' you did ' + Math.round(budget.player.dps) + ' DPS against ' + budget.reference.name + "'s " + Math.round(budget.reference.dps) + '.' + (budget.headline ? ' ' + budget.headline : '') + (sized.length ? ' The biggest sized lever: ' + (sized[0].title || sized[0].what) + ' (' + sized[0].size.label + ').' : ' No cause could be sized on this pull.');
} else if (improvements.length) assessment = /* existing text */ ...
```
Keep the rest of the existing branches, and return `{ ...existing, ...(buckets ? { buckets, sized, budget: { player: fight.budget.player, reference: fight.budget.reference, gapDps: fight.budget.gapDps, headline: fight.budget.headline, residualDps: fight.budget.residualDps, limitations: fight.budget.limitations, pricing: { status: fight.pricing?.status || 'unavailable', rotation: fight.pricing?.rotation, reason: fight.pricing?.reason, baselineDps: fight.pricing?.baselineDps } } } : {}) }`.

In `buildNightCoaching`: collect `sized` across `fightCoaching`, dedupe by `id` keeping the larger `size.dps` and accumulating `bosses`, sort with `sortItems`, `topSized = first 5`; `bossLines` from each fight's `budget`; when `topSized.length`, `assessment = 'Across ' + n + ' pull(s) the biggest sized lever is ' + title + ' (' + label + ') on ' + bosses.join(', ') + '.'`. Keep `topChanges`, `improvements`, `keeps`, `reviews`, `openQuestions`, `fights`.

- [ ] **Step 4: Run the tests**

Run: `node --test evaluation-coaching.test.js evaluation-acceptance.test.js`
Expected: PASS. The existing night-coaching test asserts `JSON.stringify(night).includes('DPS') === false` for a fixture with no budget; it must still pass because no `budget` means no sizes.

- [ ] **Step 5: Commit**

```bash
git add evaluation-coaching.js evaluation-coaching.test.js
git commit -m "feat(evaluation): bucketed coaching with sized causes and findings"
```

---

### Task 9: Service integration and recorded acceptance

**Files:**
- Modify: `evaluation-service.js` (`combinedEvidence`, `buildEvaluation`), `fixtures/evaluation/recorded-coaching.cjs`, `evaluation-acceptance.test.js`, `evaluation-service.test.js`

**Interfaces:**
- `combinedEvidence(raw)` adds `budget: analyzeBudget(raw)` and `causes: attributeCauses(raw, budget).causes`, merges attribution `checks` and `limitations` into the existing lists, and removes the legacy `damage-driver-*`, `throughput-stat-context` and `comparison-equipment` findings when `budget.status === 'decomposed'` (they are superseded by buckets and causes).
- `buildEvaluation` runs `fight.pricing = await price(raw, fight)` after `fight.simulation` with progress stage `'pricing'` and message `'Pricing gear and buff changes for ' + raw.name + '.'`; `deps.priceCauses` overrides for tests; failure → `{ status: 'unavailable', reason, prices: {} }`.
- Recorded fixture helper sets `pricing: { status: 'unavailable', reason: 'Recorded evidence replay; no simulator.', prices: {} }` so bounds still appear and prices do not.

- [ ] **Step 1: Write the failing tests**

Append to `evaluation-acceptance.test.js`:

```js
test('recorded Utopik Winterchill leads with the budget and names every source behind the melee bucket', () => {
    const w = byBoss('Rage Winterchill');
    assert.equal(w.budget.status, 'decomposed'); assert.equal(Math.round(w.budget.gapDps), 268);
    const ids = w.coaching.buckets.flatMap(b => b.items.map(i => i.id));
    for (const id of ['stat-expertise', 'luck-melee-miss', 'aura-flask', 'aura-25898', 'uptime-30807', 'proc-28830', 'rogue-snd-midfight-gap']) assert.ok(ids.includes(id), id);
    const melee = w.coaching.buckets.find(b => b.id === 'melee');
    assert.equal(melee.items.find(i => i.id === 'rogue-snd-midfight-gap').size.kind, 'bound');
    assert.equal(melee.items.find(i => i.id === 'stat-expertise').size.kind, 'unsized', 'no simulator in the recorded replay');
    assert.ok(!w.findings.some(f => f.id.startsWith('damage-driver-') || f.id === 'comparison-equipment'), 'legacy driver cards are superseded');
    assert.match(w.coaching.assessment, /1546 DPS against Jofrey's 1815/);
});
test('recorded Utopik Anetheron states the execution headline and the expertise gear action', () => {
    const a = byBoss('Anetheron');
    assert.match(a.budget.headline || '', /matched .* with more stats/);
    assert.ok(a.causes.some(c => c.id === 'stat-expertise' && /Fang of Vashj|Mooyootoo/.test(c.evidence.map(e => e.text).join(' '))));
});
test('recorded Funkell Archimonde bounds the pet bucket and keeps Kill Command below it', () => {
    const { combinedEvidence } = require('./evaluation-service');
    const raw = structuredClone(require('./fixtures/evaluation/funkell-hunter.json').fights.find(f => f.name === 'Archimonde'));
    const fight = { name: 'Archimonde', durationSec: 231.3, ...combinedEvidence(raw), pricing: { status: 'unavailable', prices: {} } };
    const coaching = buildFightCoaching(fight);
    const pet = coaching.buckets.find(b => b.id === 'pet-damage');
    assert.ok(pet, 'pet bucket'); assert.equal(pet.items[0].id, 'hunter-pet-survival'); assert.equal(pet.items[0].size.kind, 'bound');
    assert.ok(pet.items[0].size.dps > 150 && pet.items[0].size.dps <= Math.abs(pet.differenceDps), 'bound between 150 and the bucket difference: ' + pet.items[0].size.dps);
    const kc = coaching.sized.find(i => i.id.startsWith('hunter-kill-command'));
    if (kc) assert.ok(kc.size.dps < pet.items[0].size.dps);
});
```

Append to `evaluation-service.test.js` (it already fakes `deps.query`, `deps.evaluateFight`; follow the neighbouring `buildEvaluation` test's setup):

```js
test('buildEvaluation prices causes after simulation and survives a pricing failure', async () => {
    const context = { fights: [{ id: 38, name: 'Anetheron', startTime: 100, endTime: 120100 }], masterData: { actors: [{ id: 4, name: 'Warrior' }] } };
    const stages = [];
    const result = await buildEvaluation({ name: 'Warrior', report: 'abcdefghijklmnop' }, {
        loadProfile: async () => ({ profile: { parses: {} } }), getDbIndex: () => ({}),
        query: async q => ({ reportData: { report: q === F.FIGHT_QUERY ? context : q === F.PLAYER_QUERY ? {} : { events: { data: [], nextPageTimestamp: null } } } }),
        fetchFeedback: async query => {
            await query(F.FIGHT_QUERY, { c: 'abcdefghijklmnop', f: [38] });
            await query(F.PLAYER_QUERY, { c: 'abcdefghijklmnop', f: [38], s: 4 });
            return { player: { name: 'Warrior' }, kills: [{ name: 'Anetheron', reportCode: 'abcdefghijklmnop', fightId: 38 }] };
        },
        analyzeFight: raw => ({ findings: [{ title: 'Measured observation' }], limitations: [], budget: { status: 'unavailable', buckets: [], limitations: [] }, causes: [] }),
        evaluateFight: async () => ({ status: 'unsupported', reason: 'test', actions: [], packages: [], assumptions: [] }),
        priceCauses: async () => { throw new Error('boom'); },
    }, progress => { stages.push(progress.stage); });
    assert.equal(result.fights[0].pricing.status, 'unavailable');
    assert.match(result.fights[0].pricing.reason, /boom/);
    assert.ok(stages.includes('pricing'));
    assert.equal(result.fights[0].findings[0].title, 'Measured observation');
});
```
This mirrors the neighbouring "simulation failure leaves useful evidence" test; `F` is already required at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test evaluation-acceptance.test.js evaluation-service.test.js`
Expected: new tests FAIL (`w.budget` undefined; pricing missing).

- [ ] **Step 3: Implement**

`evaluation-service.js`:
- Require `{ analyzeBudget }` from `./evaluation-budget.js`, `{ attributeCauses }` from `./evaluation-attribution.js`, `{ priceCauses }` from `./evaluation-pricing.js`.
- In `combinedEvidence`, after `damage` is computed: `const budget = analyzeBudget(raw); const attribution = attributeCauses(raw, budget);` push `attribution.checks` and `attribution.limitations` into `common`; when `budget.status === 'decomposed'`, filter `common.findings` to drop ids matching `/^damage-driver-/`, `'throughput-stat-context'`, `'comparison-equipment'`; add `budget` and `causes: attribution.causes` to the returned object.
- In `buildEvaluation`, after the simulation try/catch: 
```js
await progress({ stage: 'pricing', message: 'Pricing gear and buff changes for ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result);
try { fight.pricing = await (deps.priceCauses || priceCauses)(raw, { budget: fight.budget, causes: fight.causes }); }
catch (error) { fight.pricing = { status: 'unavailable', reason: 'Pricing could not finish: ' + error.message, prices: {} }; }
```
before `fight.coaching = buildFightCoaching(fight);`.
- `fixtures/evaluation/recorded-coaching.cjs`: add `pricing: { status: 'unavailable', reason: 'Recorded evidence replay; no simulator.', prices: {} }` to each fight before `buildFightCoaching`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:evaluation`
Expected: PASS. If an existing acceptance assertion now fails because `damage-driver-*` findings were removed (for example a `reviews` count), update that assertion only after confirming the removed finding is one of the three superseded ids; otherwise stop and report.

- [ ] **Step 5: Commit**

```bash
git add evaluation-service.js evaluation-service.test.js fixtures/evaluation/recorded-coaching.cjs evaluation-acceptance.test.js
git commit -m "feat(evaluation): budget, causes and pricing in the evaluation pipeline"
```

---

### Task 10: Budget-first page, copy plan and browser test

**Files:**
- Modify: `evaluation.js` (renderer; both app and shared views run the same file), `evaluation.css`, `evaluation-browser.test.mjs`

**Interfaces:**
- Consumes: `fight.coaching.buckets`, `fight.coaching.budget`, `fight.coaching.sized`, `current.coaching.topSized`, `current.coaching.bossLines`.
- Renders, when `coaching.buckets` exists:
  1. `.budget-strip`: You N · Reference N (linked name) · Gap N, then `headline` if any, then the pricing status line (`Prices: validated rotation` / `unvalidated rotation` / `not available: reason`).
  2. `.bucket` per bucket: header `<h3>` name, `you N · ref N · diff ±N`; for decomposed buckets a `.factor-line` with the four factors ("Zero-damage outcomes 13% vs 7% (−N DPS) · Rate 95.9 vs 101.5/min (−N) · Per landed hit 546 vs 624 (−N, crit share N)"); then `.bucket-items` cards: `<span class="owner">` owner label (`you` → "You", `raid` → "Raid", `luck` → "Luck") · size label; `<h4>` title; observation paragraph; **Next:** action; **Verify:** verification; `<details>` evidence (reuse `detail()`); the bucket `note` in `.model-note`.
  3. Then the existing "Keep, review & coverage" collapsed section, then the tested-options section (collapsed under a `<details>` titled "Tested packages"), then the observed strip and background details unchanged.
- When `coaching.buckets` is absent (old saved reports, healers, tanks): render exactly as today.
- Night overview: when `topSized.length`, an ordered list of `topSized` with `title · size label · bosses`, followed by `bossLines` as "Boss: you N vs ref N, gap N, largest bucket X"; else the current list.
- Copy plan (`planText`): for fights with buckets, emit `Budget: you N DPS, <ref> N DPS, gap N.` then per bucket `Bucket <name>: you N, ref N, diff N.` and per item `- [<owner>] <title> — <size label>. <observation> Next: <action>` and in `full` mode the evidence lines; keep the legacy branches for fights without buckets.

- [ ] **Step 1: Extend the browser test (it fails first)**

In `evaluation-browser.test.mjs`, in the recorded Utopik section after navigating to `?report=NvByqL74tMA3X9Vc&sourceId=5`, before the existing Archimonde assertions add:

```js
  await evaluate("document.querySelector('#fight-tab-0').click()");
  const winterchillText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(winterchillText, /1,546[\s\S]*1,815[\s\S]*268/, 'budget strip leads');
  assert.match(winterchillText, /Fang of Vashj/); assert.match(winterchillText, /Flask of Relentless Assault/); assert.match(winterchillText, /Medallion of the Horde/);
  assert.match(winterchillText, /up to about \d+ DPS on this pull/);
  assert.match(winterchillText, /These values overlap and do not add up to the gap/);
  assert.ok(winterchillText.indexOf('Whole pull') < winterchillText.indexOf('Keep doing'), 'buckets come before the collapsed legacy sections');
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied?.includes('Budget: you 1546')", 'budget plan');
  assert.match(await evaluate('window.__copied'), /\[you\] Close the expertise gap/);
```
and in the shared recipient section assert the same `Fang of Vashj` text appears on `#fight-tab-0`. Update the existing Utopik assertion `assert.doesNotMatch(await evaluate('window.__copied'), /Damage source:|Open question:/)` to `assert.doesNotMatch(..., /Open question:/)` because the plan now legitimately carries budget lines.

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:evaluation-browser`
Expected: FAIL at "budget strip leads" (the text does not contain the new strip yet). Requires Node 22+ and Chrome; see the harness notes in `evaluation-browser.test.mjs` head.

- [ ] **Step 3: Implement the renderer**

In `evaluation.js` add (near `coachingHtml`):

```js
    const ownerTag = value => ({ you: 'You', player: 'You', raid: 'Raid', luck: 'Luck' }[value] || 'Review');
    const sizeText = size => esc(size && size.label ? size.label : 'not sized');
    function bucketItemHtml(item) {
        const title = item.title || item.what || 'Finding';
        const action = item.itemKind === 'finding' ? item.change : item.action;
        return '<article class="bucket-item owner-' + esc(item.owner || 'review') + ' size-' + esc(item.size?.kind || 'unsized') + '"><span class="owner">' + ownerTag(item.owner) + ' · ' + sizeText(item.size) + '</span><h4>' + esc(title) + '</h4>' +
            (item.observation || item.observed ? '<p class="bucket-observation">' + esc(item.observation || item.observed) + '</p>' : '') + (item.why && item.itemKind === 'finding' ? '<p><strong>Why it matters:</strong> ' + esc(item.why) + '</p>' : '') +
            (action ? '<p class="coaching-change"><strong>Next:</strong> ' + esc(action) + '</p>' : '') + (item.verification ? '<p><strong>Verify:</strong> ' + esc(item.verification) + '</p>' : '') + detail('Inspect the evidence', item.evidence) + '</article>';
    }
    function factorLineHtml(b) {
        const f = b.factors; if (!f) return '';
        const signed = v => number(v) ? (v > 0 ? '−' : '+') + fmt(Math.abs(v)) + ' DPS' : '—';
        return '<p class="factor-line">Zero-damage outcomes ' + esc(f.zeroDamage.player) + '% vs ' + esc(f.zeroDamage.reference) + '% (' + signed(f.zeroDamage.dps) + ') · Rate ' + esc(f.rate.player) + ' vs ' + esc(f.rate.reference) + '/min (' + signed(f.rate.dps) + ') · Per landed hit ' + fmt(f.yield.player) + ' vs ' + fmt(f.yield.reference) + ' (' + signed(f.yield.dps) + '; crit share ' + esc(f.yield.crit.player) + '% vs ' + esc(f.yield.crit.reference) + '%)</p>' + (list(b.assumptions).length ? '<p class="model-note">' + esc(b.assumptions.join(' ')) + '</p>' : '');
    }
    function budgetHtml(coaching) {
        const budget = coaching.budget, buckets = list(coaching.buckets); if (!budget) return '';
        const pricing = budget.pricing || {};
        const priceLine = pricing.status === 'priced' ? 'Prices use the ' + (pricing.rotation === 'validated' ? 'validated' : 'unvalidated') + ' rotation on your recorded gear.' : 'Prices are not available: ' + (pricing.reason || 'no simulator run.');
        const strip = '<div class="budget-strip"><div class="stat"><span class="stat-label">You</span><span class="stat-number">' + fmt(budget.player.dps) + '</span><span class="stat-unit">DPS</span></div><div class="stat"><span class="stat-label">' + link(budget.reference.url, budget.reference.name) + '</span><span class="stat-number">' + fmt(budget.reference.dps) + '</span><span class="stat-unit">DPS</span></div><div class="stat"><span class="stat-label">Gap</span><span class="stat-number">' + fmt(budget.gapDps) + '</span><span class="stat-unit">DPS</span></div></div>';
        const bucketHtml = buckets.map(b => '<section class="bucket"><div class="bucket-head"><h3>' + esc(b.name) + '</h3>' + (number(b.playerDps) ? '<span class="muted">you ' + fmt(b.playerDps) + ' · ref ' + fmt(b.referenceDps) + ' · diff ' + (b.differenceDps > 0 ? '+' : '') + fmt(b.differenceDps) + ' DPS</span>' : '') + '</div>' + factorLineHtml(b) + '<div class="bucket-items">' + b.items.filter(i => !i.mirrored).map(bucketItemHtml).join('') + '</div><p class="model-note">' + esc(b.note) + '</p></section>').join('');
        return '<section class="report-section budget-section"><p class="eyebrow">Damage budget</p><h2>Where the gap is and what it is worth</h2><p class="coaching-assessment">' + esc(coaching.assessment) + '</p>' + strip + (budget.headline ? '<p class="budget-headline">' + esc(budget.headline) + '</p>' : '') + '<p class="model-note">' + esc(priceLine) + ' ' + esc(list(budget.limitations).join(' ')) + '</p>' + bucketHtml + '</section>';
    }
```

In `renderFight`, when `coaching && list(coaching.buckets).length`: build `primary = budgetHtml(coaching) + '<details class="background-details coaching-background"><summary>Keep, review & coverage</summary>' + keepHtml + reviewHtml + coverage + '</details>'` (extract the keep/review/coverage builders from `coachingHtml` into a helper `coachingSecondaryHtml(coaching)` so both paths share it) and wrap `optionsHtml` in `<details class="background-details"><summary>Tested packages</summary>…</details>`; otherwise keep `coachingHtml(coaching) + priorityFindingsHtml(priorityFindings) + optionsHtml`. The order becomes: fight title, primary, priority findings (only in legacy path), tested packages, observed strip, background details.

In `nightCoachingHtml`: if `list(coaching.topSized).length`, render `<ol class="night-priorities">` of `topSized` (`<strong>title</strong><span>size label · bosses</span>`) and a `<ul class="boss-lines">` of `bossLines` (`Boss: you N vs ref N, gap N, largest bucket X`); otherwise keep the current list.

In `planText`: at the top of each fight, when `coaching.buckets` exist, push `'Budget: you ' + Math.round(budget.player.dps) + ' DPS, ' + budget.reference.name + ' ' + Math.round(budget.reference.dps) + ' DPS, gap ' + Math.round(budget.gapDps) + '.'`, then per bucket `'Bucket ' + b.name + ': you ' + … ` and per non-mirrored item `'- [' + (item.owner === 'player' ? 'you' : item.owner) + '] ' + title + ' — ' + size label + '. ' + observation + (action ? ' Next: ' + action : '')`, with evidence lines in `full` mode; skip the legacy coaching lines for those fights.

`evaluation.css`: add `.budget-strip` (same look as `.observed-strip`), `.bucket` (border-top, padding-block 14px), `.bucket-head` (flex, wrap, baseline), `.factor-line` (13px, muted), `.bucket-items` (grid, `minmax(260px,1fr)`, gap 10px, single column under 640px), `.bucket-item` (like `.coaching-item`; `owner-raid` border-left amber, `owner-luck` border-left muted, `size-unsized` opacity .85), `.budget-headline` (bold ink). Reuse existing tokens (`--ink`, `--muted`, `--amber`).

- [ ] **Step 4: Run the browser test and the unit suites**

Run: `npm run test:evaluation-browser && npm run test:evaluation`
Expected: PASS. Save the Utopik screenshot the test writes (`utopik-coaching-browser.png` in the temp dir) and look at it: the budget strip must be the first thing under the fight title, and the page must not scroll horizontally at 400px (the test's mobile check covers this).

- [ ] **Step 5: Commit**

```bash
git add evaluation.js evaluation.css evaluation-browser.test.mjs
git commit -m "feat(evaluation): budget-first report with sized buckets on app and shared pages"
```

---

### Task 11: Documentation, full verification and live replay

**Files:**
- Modify: `docs/deep-player-evaluation.md`
- Regenerate: `output/utopik-deep-dive/product-final.md`, `output/funkell-deep-dive/product-final.md` (local, ignored; for inspection only)

- [ ] **Step 1: Document engine 5**

Add a section "Damage budget (engine 5)" to `docs/deep-player-evaluation.md` covering: the budget-first order, the four factors and their arithmetic identity, the source resolution chain (equipment via the item database, auras at pull, buff bands, debuffs), the three size kinds and their labels, the sanity gate and the talent hint for Assassination, owner labels, the "values overlap" rule, and what is not compared (armor, weapon damage range, positioning). Bump `VERSION` in `evaluation-service.js` to `'deep-evaluation-5'` and mention that saved reports from older engines render in the previous layout.

- [ ] **Step 2: Full test run**

Run: `npm test && npm run test:evaluation-browser`
Expected: all PASS. Paste the tail of both outputs in the report.

- [ ] **Step 3: Live replay of the recorded captures through the real pipeline**

```bash
node -e '
const S = require("./evaluation-service"); const { buildFightCoaching, buildNightCoaching } = require("./evaluation-coaching"); const { priceCauses } = require("./evaluation-pricing");
(async () => { for (const [dir, ids, name] of [["utopik-deep-dive", [11,22,35,47,49], "Utopik"], ["funkell-deep-dive", [11,22,35,47,49], "Funkell"]]) {
  const result = { fights: [] };
  for (const id of ids) { const raw = require("./output/" + dir + "/raw-" + id + ".json"); const f = raw.context.fights.find(x => x.id === raw.fightId);
    const fight = { name: raw.name, durationSec: (f.endTime - f.startTime) / 1000, ...S.combinedEvidence(raw), simulation: { status: "unsupported", actions: [], packages: [] } };
    fight.pricing = await priceCauses(raw, { budget: fight.budget, causes: fight.causes }); fight.coaching = buildFightCoaching(fight); result.fights.push(fight); }
  result.coaching = buildNightCoaching(result);
  const lines = [name, result.coaching.assessment, ""];
  for (const fight of result.fights) { lines.push("## " + fight.name, fight.coaching.assessment, "Pricing: " + fight.pricing.status + " " + (fight.pricing.reason || ""), "");
    for (const b of fight.coaching.buckets || []) { lines.push("### " + b.name + " (you " + b.playerDps + ", ref " + b.referenceDps + ", diff " + b.differenceDps + ")"); for (const i of b.items.filter(i => !i.mirrored)) lines.push("- [" + i.owner + "] " + (i.title || i.what) + " — " + i.size.label + "\n  " + (i.observation || i.observed || "") + "\n  Next: " + (i.action || i.change || "")); lines.push(""); } }
  require("fs").writeFileSync("./output/" + dir + "/product-budget.md", lines.join("\n")); console.log("wrote", dir); } })();'
```
Read both `product-budget.md` files end to end and check against the spec's acceptance cases: Winterchill melee bucket with expertise/Fang of Vashj, luck lines, flask, Kings, Unleashed Rage, Dragonspine Trophy with Medallion, Slice and Dice bound; Anetheron headline; Funkell Archimonde pet bound above Kill Command; Funkell prices present (baseline near observed). List every sentence that reads as vague ("points to gear") or wrong, and fix the producing rule before finishing.

- [ ] **Step 4: Commit**

```bash
git add docs/deep-player-evaluation.md evaluation-service.js
git commit -m "docs(evaluation): damage budget engine 5"
```

- [ ] **Step 5: Report**

Report to the user: the commit list, the pasted test output, the two `product-budget.md` paths, the Funkell prices, the Utopik `withheld` reason, and every mechanics assumption the report prints (Precision range, dual-wield penalty, parry-from-behind).
