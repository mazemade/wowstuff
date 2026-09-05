# Feedback Report v3: Gap Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the list of independent outcome checks with an accounting of the DPS gap whose every factor and input has an owner (player, group, raid, noise), so the note tells players only what they can fix, tells the leader what to ask for, and never silently drops a cause.

**Architecture:** A new Node-only pure module `vet-gap.js` holds the constants (buff values, debuff multipliers, crit maths, stat priorities) and the accounting (`explainGap`, `gapFindings`, `averageGap`). `vet-feedback.js` grows a few measurements (damaging casts, channel time, crit rate, reference raid activity, reference debuffs and consumables, fastest reference kill) and swaps its outcome findings for the accounting's findings. The prompt gets six owner-based sections and a completeness guard; the page shows the factor breakdown. Everything stays deterministic and tested from the fixture, clones and synthetic inputs; the model remains a writer only.

**Tech Stack:** Node 18+, Express 4, vanilla browser JS, no new npm dependencies, headless Chrome over CDP for the smoke.

**Spec:** `docs/superpowers/specs/2026-09-05-feedback-v3-gap-accounting-design.md` (v3). It extends v2 (`2026-09-05-feedback-fair-reference-and-log-selection-design.md`) and v1 (`2026-09-04-parse-feedback-report-design.md`); read all three. Branch: `feedback-v3` stacked on `feedback-v2` (HEAD `c353666` at plan time).

## Global Constraints

- No new npm dependencies. Node 18+. `vet-gap.js` and `vet-feedback.js` are Node-only with the injected `query`; no WCL query is added by this plan.
- Never regenerate `fixtures/wcl-feedback-rotminster.json`. Tests build extra data on deep clones (`JSON.parse(JSON.stringify(FX))` / `MID`) or synthetic objects inside the test files.
- Existing tests keep their assertions verbatim unless a task names the test and gives its new assertion. Tests that asserted the removed outcome keys (`crit_low`, `hit_low`, `resist_high`, `stat_low`, `casts_low`) are rewritten only where Task 4 says.
- Paste the real `N passed, M failed` line from `node vet-feedback.test.js`, `node vet-gap.test.js` and `node server.test.js` at every verification step. Never claim a step passed without it.
- Stage only the files each task names. Never stage `RaidAssign/Scan.lua`, `raid-spec-scan.test.lua`, any `.local.md` plan, or the screenshot in the repo root.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Every number a player is judged against comes from the sheet; constants in `vet-gap.js` feed shares and asks only.
- Shares are whole percents; factor shares of one pull sum to 100 ± 1 including `residual`; input shares of a factor sum to that factor's share ± 1.
- The reference label everywhere is "players at your item level among the top 2000 parses".

---

### Task 1: `vet-gap.js` constants and arithmetic helpers

**Files:**
- Create: `vet-gap.js`
- Create: `vet-gap.test.js`
- Modify: `package.json` (add `&& node vet-gap.test.js` to the `test` script, after `vet-feedback.test.js`)

**Interfaces:**
- Produces: `module.exports = { C, BUFF_VALUES, DEBUFF_MULT, CHANNEL_UTILITY, STAT_PRIORITY, PHASE_BOSSES, BURST_VALUE, FINDING_ANCHOR, share, splitLog, expectedCrit, powerParts, channelSeconds, damagingCastStats, debuffMultiplier }`.
- `share(logValue, G) → integer percent`; `splitLog(remaining, weights) → number[]` (proportional split of a log factor over non-negative weights; all-zero weights → everything to the last entry).
- `expectedCrit({ stats, auras, classToken, spec, role }) → { gear, consumables, buffs, total }` in crit percent.
- `powerParts({ stats, auras, role }) → { gear, consumables, buffs }` in spell power (caster) or attack power (melee/ranged).
- `channelSeconds(buffsTable) → seconds` of `CHANNEL_UTILITY` bands.
- `damagingCastStats(casts, abilities) → { casts, damage, hits, crits }` over abilities with `total > 0`.
- `debuffMultiplier(present, schools) → number` (product of `1 + (m − 1)·uptime` over `DEBUFF_MULT` entries matching the schools).

- [ ] **Step 1: Write the failing tests**

Create `vet-gap.test.js`:

```js
'use strict';
const assert = require('node:assert');
const G = require('./vet-gap.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

test('constants: shapes and the values the spec fixes', () => {
    assert.strictEqual(G.C.CRIT_RATING_PER_PCT, 22.08);
    assert.strictEqual(G.C.HIT_RATING_PER_PCT, 12.62);
    assert.strictEqual(G.C.INT_PER_CRIT.WARLOCK, 81.9);
    assert.strictEqual(G.C.CRIT_BONUS.Destruction, 1);
    assert.strictEqual(G.C.CRIT_BONUS.Affliction, 0.5);
    assert.strictEqual(G.C.CRIT_BONUS.Combat, 1);
    assert.strictEqual(G.C.SPEC_CRIT.Destruction, 8);
    assert.strictEqual(G.C.SPEC_CRIT.Fire, 9);
    assert.strictEqual(G.C.SPEC_CRIT.Unknown, undefined);
    assert.deepStrictEqual(G.C.HIT_CAP, { spell: 16, melee: 9, ranged: 9 });
    assert.deepStrictEqual(G.C.POWER_BASE, { caster: 670, melee: 1000, ranged: 1000, tank: 1000, healer: 670 });
    assert.deepStrictEqual(G.BUFF_VALUES['Flask of Pure Death'], { spellPower: 80, scope: 'consumable' });
    assert.deepStrictEqual(G.BUFF_VALUES['Totem of Wrath'], { critPct: 3, hitPct: 3, scope: 'party' });
    assert.deepStrictEqual(G.BUFF_VALUES['Arcane Brilliance'], { intellect: 40, scope: 'party' });
    assert.deepStrictEqual(G.DEBUFF_MULT['Curse of the Elements'], { mult: 1.10, schools: ['arcane', 'fire', 'frost', 'shadow'] });
    assert.deepStrictEqual(G.STAT_PRIORITY.Destruction, ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste']);
    assert.deepStrictEqual(G.STAT_PRIORITY.Affliction, ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit']);
    assert.deepStrictEqual(G.STAT_PRIORITY.Combat, ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste']);
    assert.ok(G.CHANNEL_UTILITY.includes('Drain Soul') && !G.CHANNEL_UTILITY.includes('Mind Flay'));
    assert.ok(/submerge/i.test(G.PHASE_BOSSES['The Lurker Below']));
    assert.strictEqual(G.BURST_VALUE.default, 0.02);
    assert.strictEqual(G.BURST_VALUE.Destruction, 0.03);
    assert.strictEqual(G.FINDING_ANCHOR.no_flask_or_elixirs, 'flask');
    Object.keys(G.BUFF_VALUES).forEach(n => assert.ok(['party', 'consumable'].includes(G.BUFF_VALUES[n].scope), n));
});
test('share and splitLog: whole percents, proportional split, all-zero weights fall to the last entry', () => {
    const Gln = Math.log(2);
    assert.strictEqual(G.share(Math.log(2), Gln), 100);
    assert.strictEqual(G.share(Math.log(Math.sqrt(2)), Gln), 50);
    assert.strictEqual(G.share(0, Gln), 0);
    assert.strictEqual(G.share(Math.log(2), 0), 0, 'no gap, no share');
    assert.deepStrictEqual(G.splitLog(Math.log(4), [1, 3]), [Math.log(4) / 4, 3 * Math.log(4) / 4]);
    assert.deepStrictEqual(G.splitLog(Math.log(4), [0, 0, 0]), [0, 0, Math.log(4)]);
    assert.deepStrictEqual(G.splitLog(Math.log(4), []), []);
});
test('expectedCrit: Dotwin on Morogrim reproduces his measured 32.1% from gear, talents and Moonkin', () => {
    // 1.7 base + 490/81.9 int + 253/22.08 rating + 8 talents + 5 Moonkin = 32.2
    const e = G.expectedCrit({ stats: { spellCrit: 253, intellect: 490 }, auras: ['Greater Blessing of Kings', 'Moonkin Aura', 'Sanctity Aura'], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' });
    assert.strictEqual(Math.round(e.total * 10) / 10, 32.1, '1.7 + 8 + 253/22.08 + 490/81.9 + 5 = 32.14');
    assert.strictEqual(e.buffs, 5, 'Moonkin only; intellect buffs and Kings are already inside the reported intellect and are not counted again');
    assert.strictEqual(e.consumables, 0);
    const withOwl = G.expectedCrit({ stats: { spellCrit: 306, intellect: 469 }, auras: ['Moonkin Aura', 'Chain of the Twilight Owl', 'Arcane Brilliance', 'Adept\'s Elixir', 'Brilliant Wizard Oil'], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' });
    assert.strictEqual(withOwl.buffs, 7, 'Moonkin 5 + Owl 2; Arcane Brilliance is intellect, not counted again');
    assert.ok(withOwl.consumables > 1.7 && withOwl.consumables < 1.8, '(24 + 14) / 22.08 = 1.72: ' + withOwl.consumables);
    assert.deepStrictEqual(G.expectedCrit({ stats: null, auras: [], classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' }), null, 'no stats, no expectation');
    const melee = G.expectedCrit({ stats: { meleeCrit: 300, agility: 500 }, auras: ['Leader of the Pack'], classToken: 'ROGUE', spec: 'Combat', role: 'melee' });
    assert.ok(melee.buffs === 5 && melee.gear > 0);
});
test('powerParts: gear, consumables and party buffs in spell power or attack power', () => {
    const p = G.powerParts({ stats: { spellDamage: 846 }, auras: ['Flask of Pure Death', 'Well Fed', 'Wrath of Air Totem', 'Prayer of Spirit', 'Superior Wizard Oil'], role: 'caster' });
    assert.deepStrictEqual(p, { gear: 846, consumables: 80 + 23 + 42, buffs: 101 + 40 });
    const m = G.powerParts({ stats: { attackPower: 1500 }, auras: ['Battle Shout', 'Fel Strength Elixir', 'Flask of Relentless Assault'], role: 'melee' });
    assert.deepStrictEqual(m, { gear: 1500, consumables: 90 + 120, buffs: 305 });
    assert.deepStrictEqual(G.powerParts({ stats: null, auras: [], role: 'caster' }), { gear: null, consumables: 0, buffs: 0 });
});
test('channelSeconds and damagingCastStats', () => {
    const s = x => x * 1000;
    const buffs = { data: { totalTime: s(200), auras: [
        { name: 'Drain Soul', bands: [{ startTime: 0, endTime: s(15) }, { startTime: s(100), endTime: s(112) }] },
        { name: 'Blessing of the Silver Crescent', bands: [{ startTime: 0, endTime: s(20) }] },
        { name: 'Fel Armor', bands: [{ startTime: 0, endTime: s(200) }] },
    ] } };
    assert.strictEqual(G.channelSeconds(buffs), 27);
    assert.strictEqual(G.channelSeconds(null), 0);
    const casts = { 'Shadow Bolt': 40, 'Life Tap': 5, 'Curse of Doom': 1, 'Drain Soul': 3, 'Immolate': 2 };
    const abilities = [{ name: 'Shadow Bolt', total: 100000, hits: 40, critPercent: 30 }, { name: 'Curse of Doom', total: 8000, hits: 1, critPercent: 0 }, { name: 'Immolate', total: 3000, hits: 2, critPercent: 50 }, { name: 'Drain Soul', total: 0, hits: 0, critPercent: null }];
    assert.deepStrictEqual(G.damagingCastStats(casts, abilities), { casts: 43, damage: 111000, hits: 43, crits: 13 });
    assert.deepStrictEqual(G.damagingCastStats({}, []), { casts: 0, damage: 0, hits: 0, crits: 0 });
});
test('debuffMultiplier: uptime-weighted product over the schools that matter', () => {
    const present = [{ name: 'Curse of the Elements', uptimePercent: 100 }, { name: 'Shadow Weaving', uptimePercent: 50 }, { name: 'Sunder Armor', uptimePercent: 100 }];
    const m = G.debuffMultiplier(present, ['shadow']);
    assert.ok(Math.abs(m - 1.10 * 1.05) < 1e-9, String(m));
    assert.strictEqual(G.debuffMultiplier([], ['shadow']), 1);
    assert.ok(Math.abs(G.debuffMultiplier(present, ['physical']) - 1.18) < 1e-9, 'Sunder only');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
```

- [ ] **Step 2: Run to verify it fails**

Run: `node vet-gap.test.js 2>&1 | tail -3`
Expected: `Cannot find module './vet-gap.js'` (or `0 passed, 6 failed` once the file exists empty).

- [ ] **Step 3: Implement `vet-gap.js`**

```js
'use strict';
// Node-only. The DPS-gap accounting for the parse feedback report (spec v3): constants, the
// arithmetic that turns gear, buffs and debuffs into expected crit and power, and the helpers the
// accounting in explainGap (Task 3) is built from. Nothing here queries WCL. Constants feed shares
// and asks; a player is never judged against one of them directly.

// Rating conversions at level 70 and crit maths per class/spec.
const C = {
    CRIT_RATING_PER_PCT: 22.08, HIT_RATING_PER_PCT: 12.62, MELEE_HIT_RATING_PER_PCT: 15.77, AGI_PER_CRIT: { ROGUE: 40, HUNTER: 40, DRUID: 25, WARRIOR: 33, PALADIN: 25, SHAMAN: 25 },
    BASE_CRIT: { caster: 1.7, melee: 0, ranged: 0, tank: 0, healer: 1.7 },
    INT_PER_CRIT: { WARLOCK: 81.9, MAGE: 80, PRIEST: 80, DRUID: 80, SHAMAN: 80, PALADIN: 80 },
    // Damage a crit adds relative to a hit: Ruin, Spell Power, Vengeance, Elemental Fury and all
    // physical crits double; plain spell crits add half.
    CRIT_BONUS: { Destruction: 1, Fire: 1, Arcane: 1, Balance: 1, Elemental: 1, Affliction: 0.5, Demonology: 0.5, Frost: 0.5, Shadow: 0.5, Discipline: 0.5, Holy: 0.5, Restoration: 0.5,
                  Combat: 1, Assassination: 1, Subtlety: 1, Fury: 1, Arms: 1, Protection: 1, Retribution: 1, Enhancement: 1, Feral: 1, BeastMastery: 1, Marksmanship: 1, Survival: 1 },
    // Crit percent the spec's talents add to its main damaging spells (spec v3 §3.3).
    SPEC_CRIT: { Destruction: 8, Affliction: 3, Demonology: 3, Fire: 9, Arcane: 3, Frost: 0, Shadow: 0, Balance: 4, Elemental: 5, Retribution: 0, Enhancement: 0,
                 Combat: 5, Assassination: 5, Subtlety: 5, Fury: 5, Arms: 5, Feral: 0, BeastMastery: 0, Marksmanship: 5, Survival: 5 },
    HIT_CAP: { spell: 16, melee: 9, ranged: 9 },
    // Base damage of the main ability expressed in power points (Shadow Bolt: ~575 average base
    // damage at a 0.857 coefficient ≈ 670 spell power). Damage per cast scales with power + base.
    POWER_BASE: { caster: 670, melee: 1000, ranged: 1000, tank: 1000, healer: 670 },
};

// Buffs at pull with the value they add (spec v3 §7). `scope` says who owns it: a consumable is
// the player's, a party buff is an ask.
const BUFF_VALUES = {
    'Flask of Pure Death': { spellPower: 80, scope: 'consumable' }, 'Flask of Blinding Light': { spellPower: 80, scope: 'consumable' },
    'Flask of Supreme Power': { spellPower: 70, scope: 'consumable' }, 'Flask of Relentless Assault': { attackPower: 120, scope: 'consumable' },
    'Elixir of Major Shadow Power': { spellPower: 55, scope: 'consumable' }, 'Major Shadow Power': { spellPower: 55, scope: 'consumable' },
    'Elixir of Major Firepower': { spellPower: 55, scope: 'consumable' }, 'Major Firepower': { spellPower: 55, scope: 'consumable' },
    'Elixir of Major Frost Power': { spellPower: 55, scope: 'consumable' }, 'Major Frost Power': { spellPower: 55, scope: 'consumable' },
    "Adept's Elixir": { spellPower: 24, critRating: 24, scope: 'consumable' }, 'Greater Arcane Elixir': { spellPower: 35, scope: 'consumable' },
    'Elixir of Major Agility': { agility: 30, critRating: 20, scope: 'consumable' }, 'Elixir of Major Strength': { strength: 35, scope: 'consumable' },
    'Fel Strength Elixir': { attackPower: 90, scope: 'consumable' },
    'Brilliant Wizard Oil': { spellPower: 14, critRating: 14, scope: 'consumable' }, 'Superior Wizard Oil': { spellPower: 42, scope: 'consumable' },
    'Well Fed': { spellPower: 23, attackPower: 40, scope: 'consumable' },
    'Wrath of Air Totem': { spellPower: 101, scope: 'party' }, 'Totem of Wrath': { critPct: 3, hitPct: 3, scope: 'party' },
    'Moonkin Aura': { critPct: 5, scope: 'party' }, 'Chain of the Twilight Owl': { critPct: 2, scope: 'party' },
    'Eye of the Night': { spellPower: 34, scope: 'party' }, 'Prayer of Spirit': { spellPower: 40, scope: 'party' }, 'Divine Spirit': { spellPower: 40, scope: 'party' },
    'Arcane Brilliance': { intellect: 40, scope: 'party' }, 'Arcane Intellect': { intellect: 40, scope: 'party' },
    'Greater Blessing of Kings': { statsPct: 10, scope: 'party' }, 'Blessing of Kings': { statsPct: 10, scope: 'party' },
    'Fel Intelligence': { intellect: 48, scope: 'party' },
    'Battle Shout': { attackPower: 305, scope: 'party' }, 'Trueshot Aura': { attackPower: 125, scope: 'party' },
    'Strength of Earth Totem': { strength: 86, scope: 'party' }, 'Unleashed Rage': { attackPowerPct: 10, scope: 'party' },
    'Grace of Air Totem': { agility: 77, scope: 'party' }, 'Leader of the Pack': { critPct: 5, scope: 'party' }, 'Ferocious Inspiration': { damagePct: 3, scope: 'party' },
};

// Raid debuffs on the boss and what they multiply (spec v3 §3.2). Armour debuffs are expressed as
// the physical multiplier they are worth against a 6200-armour boss.
const DEBUFF_MULT = {
    'Curse of the Elements': { mult: 1.10, schools: ['arcane', 'fire', 'frost', 'shadow'] },
    'Shadow Weaving': { mult: 1.10, schools: ['shadow'] },
    'Fire Vulnerability': { mult: 1.15, schools: ['fire'] },
    'Sunder Armor': { mult: 1.18, schools: ['physical'] }, 'Expose Armor': { mult: 1.18, schools: ['physical'] },
    'Faerie Fire': { mult: 1.04, schools: ['physical'] }, 'Faerie Fire (Feral)': { mult: 1.04, schools: ['physical'] },
    'Curse of Recklessness': { mult: 1.05, schools: ['physical'] },
    'Blood Frenzy': { mult: 1.04, schools: ['physical'] },
};

// Channelled utility: time inside these auras is time not spent on damage.
const CHANNEL_UTILITY = ['Drain Soul', 'Drain Life', 'Drain Mana', 'Health Funnel', 'Evocation'];

// Gear-stat findings appear in this order, and a stat lower in the list is not reported while a
// higher one is under its bar (spec v3 §4).
const STAT_PRIORITY = {
    Destruction: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Affliction: ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit'], Demonology: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Fire: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Arcane: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Frost: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Shadow: ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit'], Balance: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Elemental: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Combat: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Assassination: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Subtlety: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    Fury: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Arms: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Retribution: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    Enhancement: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Feral: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    BeastMastery: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'], Marksmanship: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'], Survival: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'],
};

// Why a raid that took much longer than the reference's kill did less damage per second: phases
// the fast kill skipped or shortened. Used in the bad-pull text (spec v3 §3.4).
const PHASE_BOSSES = {
    'The Lurker Below': 'Lurker submerges 90 seconds in and is untargetable for 60 seconds; the reference kills him before that',
    'Lady Vashj': 'phase 2 has no boss to hit while striders and cores are handled',
    'Morogrim Tidewalker': 'Watery Grave and the murloc waves cost casting time',
    "Kael'thas Sunstrider": 'four advisor phases and the weapons come before the boss',
    'Leotheras the Blind': 'demon form and whirlwinds force movement',
    'High Astromancer Solarian': 'the split phases have no boss to hit',
    "Al'ar": 'phase 1 platform swaps and phase 2 dive bombs force movement',
    'Hydross the Unstable': 'the resistance-gear transitions cost casting time',
    'Fathom-Lord Karathress': 'three adds die before the boss takes real damage',
    'Rage Winterchill': 'the trash waves count in the pull time', 'Anetheron': 'the trash waves count in the pull time',
    "Kaz'rogal": 'the trash waves count in the pull time', 'Azgalor': 'the trash waves count in the pull time',
};

// Fraction of a fight's damage a properly timed burst is worth (spec v3 §3.5).
const BURST_VALUE = { default: 0.02, Destruction: 0.03, Haste: 0.03 };

// A word the note must contain for each finding without a headline number (completeness guard).
const FINDING_ANCHOR = {
    no_flask_or_elixirs: 'flask', wrong_elixir: 'flask', no_food: 'food', no_oil: 'oil', no_potion: 'potion', died: 'died',
    buffs_missing: 'group', debuff_missing: 'debuff', bloodlust_uptime: 'Bloodlust', gear_enchants: 'enchant', gear_sockets: 'socket',
    burst_outside_bloodlust: 'Bloodlust', ability_unused: 'never', ability_extra: 'comparable', ability_ratio: 'comparable',
    raid_activity: 'raid', channel_time: 'channel', cast_pacing: 'between casts', debuff_uptime_low: 'up',
};

function share(logValue, G) { return G > 0 ? Math.round(100 * logValue / G) : 0; }
function splitLog(remaining, weights) {
    const w = (weights || []).map(x => (typeof x === 'number' && x > 0 ? x : 0));
    const sum = w.reduce((s, x) => s + x, 0);
    if (!w.length) return [];
    if (!sum) return w.map((x, i) => (i === w.length - 1 ? remaining : 0));
    return w.map(x => remaining * x / sum);
}

function auraValue(auras, key) {
    return (auras || []).reduce((s, n) => s + ((BUFF_VALUES[n] || {})[key] || 0), 0);
}
function auraValueByScope(auras, key, scope) {
    return (auras || []).reduce((s, n) => { const b = BUFF_VALUES[n]; return s + (b && b.scope === scope ? (b[key] || 0) : 0); }, 0);
}

// Expected crit chance (percent) from what the player brought and what the group gave them.
function expectedCrit(o) {
    const { stats, auras, classToken, spec, role } = o;
    if (!stats) return null;
    const cls = String(classToken || '').toUpperCase();
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const rating = physical ? (role === 'ranged' ? stats.rangedCrit : stats.meleeCrit) : stats.spellCrit;
    // Intellect and agility buffs (Arcane Brilliance, Kings, Grace of Air) are already inside the
    // stat WCL reports for the player and are unknowable for reference players; neither side counts
    // them again here. Party buffs contribute only their flat crit percent.
    let gear, consumables, buffs;
    if (physical) {
        const perCrit = C.AGI_PER_CRIT[cls] || 40;
        const agi = typeof stats.agility === 'number' ? stats.agility : 0;
        gear = (rating || 0) / C.CRIT_RATING_PER_PCT + agi / perCrit;
        consumables = auraValueByScope(auras, 'critRating', 'consumable') / C.CRIT_RATING_PER_PCT + auraValueByScope(auras, 'agility', 'consumable') / perCrit;
        buffs = auraValueByScope(auras, 'critPct', 'party');
    } else {
        const perCrit = C.INT_PER_CRIT[cls] || 80;
        const int = typeof stats.intellect === 'number' ? stats.intellect : 0;
        gear = (rating || 0) / C.CRIT_RATING_PER_PCT + int / perCrit;
        consumables = auraValueByScope(auras, 'critRating', 'consumable') / C.CRIT_RATING_PER_PCT;
        buffs = auraValueByScope(auras, 'critPct', 'party');
    }
    const base = C.BASE_CRIT[role] || 0, talents = C.SPEC_CRIT[spec] || 0;
    return { gear, consumables, buffs, total: base + talents + gear + consumables + buffs };
}

// Spell power or attack power from gear, consumables and party buffs.
function powerParts(o) {
    const { stats, auras, role } = o;
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const key = physical ? 'attackPower' : 'spellPower';
    const gearKey = physical ? (role === 'ranged' ? 'rangedAttackPower' : 'attackPower') : 'spellDamage';
    const gear = stats && typeof stats[gearKey] === 'number' ? stats[gearKey] : null;
    let consumables = auraValueByScope(auras, key, 'consumable'), buffs = auraValueByScope(auras, key, 'party');
    if (physical) {
        consumables += 2 * auraValueByScope(auras, 'strength', 'consumable') + auraValueByScope(auras, 'agility', 'consumable');
        buffs += 2 * auraValueByScope(auras, 'strength', 'party') + auraValueByScope(auras, 'agility', 'party') + (gear || 0) * auraValue(auras, 'attackPowerPct') / 100;
    }

    return { gear, consumables, buffs };
}

function channelSeconds(buffsTable) {
    const d = buffsTable && buffsTable.data;
    const auras = d && Array.isArray(d.auras) ? d.auras : [];
    return auras.filter(a => a && CHANNEL_UTILITY.includes(a.name)).flatMap(a => Array.isArray(a.bands) ? a.bands : [])
        .reduce((s, b) => s + Math.max(0, (b.endTime - b.startTime) / 1000), 0);
}

// Casts, damage, hits and crits over the abilities that actually did damage.
function damagingCastStats(casts, abilities) {
    const out = { casts: 0, damage: 0, hits: 0, crits: 0 };
    (abilities || []).forEach(a => {
        if (!a || !(a.total > 0)) return;
        out.casts += (casts && casts[a.name]) || 0;
        out.damage += a.total;
        out.hits += a.hits || 0;
        out.crits += a.hits && typeof a.critPercent === 'number' ? Math.round(a.hits * a.critPercent / 100) : 0;
    });
    return out;
}

function debuffMultiplier(present, schools) {
    return (present || []).reduce((m, p) => {
        const d = DEBUFF_MULT[p.name];
        if (!d || !d.schools.some(s => (schools || []).includes(s)) || typeof p.uptimePercent !== 'number') return m;
        return m * (1 + (d.mult - 1) * p.uptimePercent / 100);
    }, 1);
}

module.exports = { C, BUFF_VALUES, DEBUFF_MULT, CHANNEL_UTILITY, STAT_PRIORITY, PHASE_BOSSES, BURST_VALUE, FINDING_ANCHOR, share, splitLog, expectedCrit, powerParts, channelSeconds, damagingCastStats, debuffMultiplier };
```

Add `&& node vet-gap.test.js` to `package.json`'s test script after `node vet-feedback.test.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `node vet-gap.test.js 2>&1 | tail -3`
Expected: `6 passed, 0 failed`. Check the two expectedCrit ranges by hand if either fails: `(24 + 14) / 22.08 = 1.721`, `5 + 2 + 40 / 81.9 = 7.488`, and Dotwin: `1.7 + 8 + 253 / 22.08 + 490 / 81.9 + 5 = 32.18`.

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-gap.test.js package.json
git commit -m "feat(gap): constants and arithmetic for the DPS-gap accounting — buff values, debuff multipliers, crit and power maths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Measurements the accounting needs, on both sides of the sheet

**Files:**
- Modify: `vet-feedback.js` — `STAT_KEYS`, `referenceSummary`, `killFacts`, `getReference` (ceiling read), `fightContext` call for reference players
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: Task 1's `channelSeconds`, `damagingCastStats`, `require('./vet-gap.js')` as `GAP`.
- Produces on `me` (killFacts): `damagingCastsPerMinute`, `damagePerDamagingCast`, `critRate` (percent of damaging hits that crit), `channelSecPerMin`, `stats.intellect/strength/agility` (via `STAT_KEYS`).
- Produces on `reference`: the same four medians; `raidActivePercent` (median over reference players of their raid's median active); `consumablesAtPull` (majority); `debuffs` (`[{ name, uptimePercent }]` medians over reference players' fights for the player's schools); `fastestDurationSec` (shortest in-band kill seen on the ceiling pages, else null).

- [ ] **Step 1: Write the failing tests**

Append after the `referenceSummary on Anetheron` test:

```js
test('v3 measurements: me and reference carry damaging casts, damage per cast, crit rate, channel time, raid activity, consumables and debuffs', () => {
    const ref = refFor(50619);
    ['damagingCastsPerMinute', 'damagePerDamagingCast', 'critRate', 'channelSecPerMin', 'raidActivePercent'].forEach(k => assert.strictEqual(typeof ref[k], 'number', k));
    assert.ok(ref.damagingCastsPerMinute < ref.castsPerMinute, 'Life Tap is not a damaging cast');
    assert.ok(Array.isArray(ref.consumablesAtPull) && ref.consumablesAtPull.includes('Flask of Pure Death'));
    assert.ok(Array.isArray(ref.debuffs) && ref.debuffs.every(d => typeof d.name === 'string' && typeof d.uptimePercent === 'number'));
    assert.strictEqual(ref.fastestDurationSec, null, 'a direct referenceSummary call has no ceiling pages');
    assert.strictEqual(typeof ref.stats.intellect, 'number');
    const k = killFor(50619);
    assert.ok(k.me.damagingCastsPerMinute > 0 && k.me.damagingCastsPerMinute < k.me.castsPerMinute);
    assert.strictEqual(k.me.damagePerDamagingCast, Math.round(k.me.abilities.reduce((s, a) => s + a.total, 0) / k.me.abilities.reduce((s, a) => s + (a.total > 0 ? (k.me.casts[a.name] || 0) : 0), 0)));
    assert.ok(k.me.critRate > 20 && k.me.critRate < 35, 'Rotminster crits about a quarter of his damaging hits: ' + k.me.critRate);
    assert.strictEqual(k.me.channelSecPerMin, 0, 'the fixture has no bands');
    assert.strictEqual(typeof k.me.stats.intellect, 'number');
});
test('v3 measurements: getReference records the fastest in-band kill from the ceiling pages', async () => {
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => { if (q === F.FIGHT_QUERY) return { reportData: { report: null } }; return lb.query(q, vars); };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.strictEqual(ref.summary.fastestDurationSec, 100, 'every synthetic rank lasts 100 s');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -1`
Expected: `86 passed, 2 failed`.

- [ ] **Step 3: Implement**

At the top of `vet-feedback.js` add `const GAP = require('./vet-gap.js');` after the `V` require.

Change `STAT_KEYS` to include `'intellect', 'strength', 'agility'` at the end.

In `referenceSummary`'s `per` map add, after `stats:`:

```js
            dcs: GAP.damagingCastStats(casts, abilityStats(p.tables.dmg)),
            channelSec: GAP.channelSeconds(p.tables.buffs),
            consumables: aur ? aur.consumables : [],
            raidActive: fightContext(p.context, p.rank.name, role, null, 'dps').fight.raidActivePercent,
            debuffs: debuffFacts(p.context.debuffs, schoolsOf(classToken, p.rank.spec, role)).present,
```

(`fightContext`, `debuffFacts` and `schoolsOf` are declared later in the file; function declarations hoist.) Add to the returned summary, after `burst`:

```js
        damagingCastsPerMinute: medOf(per.map(p => p.dur ? round1(60 * p.dcs.casts / p.dur) : null)),
        damagePerDamagingCast: Math.round(median(per.map(p => p.dcs.casts ? p.dcs.damage / p.dcs.casts : null))),
        critRate: medOf(per.map(p => p.dcs.hits ? 100 * p.dcs.crits / p.dcs.hits : null)),
        channelSecPerMin: medOf(per.map(p => p.dur ? 60 * p.channelSec / p.dur : null)),
        raidActivePercent: medOf(per.map(p => p.raidActive)),
        consumablesAtPull: Object.keys(countNames(per.map(p => p.consumables))).filter(n => countNames(per.map(p => p.consumables))[n] >= majority),
        debuffs: Object.keys(countNames(per.map(p => p.debuffs.map(d => d.name)))).filter(n => countNames(per.map(p => p.debuffs.map(d => d.name)))[n] >= majority)
            .map(n => ({ name: n, uptimePercent: medOf(per.map(p => { const d = p.debuffs.find(x => x.name === n); return d ? d.uptimePercent : null; })) })),
        fastestDurationSec: typeof o.fastestDurationSec === 'number' ? o.fastestDurationSec : null,
```

`referenceSummary` gains an eighth parameter `o` (an options object; `topDps` stays the seventh): `function referenceSummary(ranks, players, dbIndex, classToken, role, band, topDps, o) { o = o || {}; …`. In `getReference`, while reading the ceiling pages, also track `let fastest = null;` — for the first page that has in-band ranks, `fastest = Math.round(Math.min.apply(null, ib.map(r => r.duration)) / 1000)` — and pass `{ fastestDurationSec: fastest }` as the eighth argument.

In `killFacts`, after `stats:` in the `me` object add:

```js
        damagingCastsPerMinute: fc.fight.durationSec ? round1(60 * GAP.damagingCastStats(casts, abilityStats(tables.dmg)).casts / fc.fight.durationSec) : null,
        damagePerDamagingCast: (() => { const d = GAP.damagingCastStats(casts, abilityStats(tables.dmg)); return d.casts ? Math.round(d.damage / d.casts) : null; })(),
        critRate: (() => { const d = GAP.damagingCastStats(casts, abilityStats(tables.dmg)); return d.hits ? round1(100 * d.crits / d.hits) : null; })(),
        channelSecPerMin: fc.fight.durationSec ? round1(60 * GAP.channelSeconds(tables.buffs) / fc.fight.durationSec) : null,
```

(Compute `const dcs = GAP.damagingCastStats(casts, abilityStats(tables.dmg));` once above the object and use it in the three places rather than repeating the call.)

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1; node vet-gap.test.js 2>&1 | tail -1`
Expected: `88 passed, 0 failed`; `13 passed, 0 failed`; `6 passed, 0 failed`. The `referenceSummary on Anetheron` test keeps its assertions (new fields are additive).

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): measurements for the gap accounting — damaging casts, damage per cast, crit rate, channel time, reference raid activity, debuffs, consumables, fastest kill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The accounting — `explainGap` and `averageGap`

**Files:**
- Modify: `vet-gap.js` (append), `vet-gap.test.js` (append)
- Modify: `vet-feedback.js` — `killFacts` (`kill.gap`), `buildFacts` (`overall.gap`)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `explainGap(kill, player) → gap | null` with `gap = { ratio, factors: { casts, dmg, crit, residual }, residualShare }`, each factor `{ value, share, inputs: [{ key, owner, share, me, reference, unit }] }`; `averageGap(kills) → { casts, dmg, crit, residual } shares | null`.
- Input keys (fixed strings): casts factor → `raid_activity` (raid), `own_activity` (player), `channel_time` (player), `cast_pacing` (player); dmg factor → `hit_under_cap` (player), `debuffs` (group), `power_gear` (player), `power_consumables` (player), `power_buffs` (group), `rotation` (player); crit factor → `crit_gear` (player), `crit_consumables` (player), `crit_buffs` (group), `crit_luck` (noise).

- [ ] **Step 1: Write the failing tests**

Append to `vet-gap.test.js` before the summary lines:

```js
// A hand-built pull in the shape killFacts produces, with a reference twice as strong in every
// measured way, so every factor is exercised.
function pull(over) {
    const base = {
        name: 'Morogrim Tidewalker', rankPercent: 19,
        fight: { durationSec: 200, raidActivePercent: 70, badPull: false },
        debuffs: { known: true, present: [{ name: 'Curse of the Elements', uptimePercent: 100 }], missing: [] },
        me: { amount: 1000, activePercent: 60, damagingCastsPerMinute: 17, damagePerDamagingCast: 2900, critRate: 32, channelSecPerMin: 6,
              consumablesAtPull: [], buffsAtPull: ['Moonkin Aura'], stats: { spellDamage: 846, spellCrit: 253, spellHit: 181, intellect: 490 } },
        reference: { dps: 2200, raidActivePercent: 85, activePercent: 85, damagingCastsPerMinute: 24, damagePerDamagingCast: 4000, critRate: 46, channelSecPerMin: 0,
                     consumablesAtPull: ['Flask of Pure Death', 'Well Fed'], buffsAtPull: ['Moonkin Aura', 'Chain of the Twilight Owl', 'Prayer of Spirit', 'Wrath of Air Totem'],
                     stats: { spellDamage: 1004, spellCrit: 306, spellHit: 202, intellect: 490 },
                     debuffs: [{ name: 'Curse of the Elements', uptimePercent: 100 }, { name: 'Shadow Weaving', uptimePercent: 100 }] },
    };
    return Object.assign(base, over || {});
}
const PLAYER = { classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', schools: ['shadow'] };
const sumShares = inputs => inputs.reduce((s, i) => s + i.share, 0);
test('explainGap: factors multiply back to the ratio and shares sum to 100', () => {
    const g = G.explainGap(pull(), PLAYER);
    assert.ok(g && Math.abs(g.ratio - 2.2) < 1e-9);
    const product = g.factors.casts.value * g.factors.dmg.value * g.factors.crit.value * g.factors.residual.value;
    assert.ok(Math.abs(product - g.ratio) < 1e-6, 'product ' + product);
    const total = ['casts', 'dmg', 'crit', 'residual'].reduce((s, k) => s + g.factors[k].share, 0);
    assert.ok(Math.abs(total - 100) <= 1, 'shares sum ' + total);
    ['casts', 'dmg', 'crit'].forEach(k => assert.ok(Math.abs(sumShares(g.factors[k].inputs) - g.factors[k].share) <= 1, k + ' inputs ' + sumShares(g.factors[k].inputs) + ' vs ' + g.factors[k].share));
    assert.ok(Math.abs(g.factors.casts.value - 24 / 17) < 1e-9);
    assert.ok(Math.abs(g.factors.dmg.value - 4000 / 2900) < 1e-9);
    assert.ok(Math.abs(g.factors.crit.value - 1.46 / 1.32) < 1e-9, 'Ruin doubles crits');
});
test('explainGap: input owners and the meaning of each input', () => {
    const g = G.explainGap(pull(), PLAYER);
    const by = f => Object.fromEntries(g.factors[f].inputs.map(i => [i.key, i]));
    const c = by('casts');
    assert.deepStrictEqual(Object.keys(c), ['raid_activity', 'own_activity', 'channel_time', 'cast_pacing']);
    assert.strictEqual(c.raid_activity.owner, 'raid'); assert.strictEqual(c.own_activity.owner, 'player');
    assert.deepStrictEqual([c.raid_activity.me, c.raid_activity.reference], [70, 85]);
    assert.deepStrictEqual([c.own_activity.me, c.own_activity.reference], [60, 85]);
    assert.deepStrictEqual([c.channel_time.me, c.channel_time.reference, c.channel_time.unit], [6, 0, 'seconds a minute channelling']);
    const d = by('dmg');
    assert.deepStrictEqual(Object.keys(d), ['hit_under_cap', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs', 'rotation']);
    assert.strictEqual(d.debuffs.owner, 'group'); assert.strictEqual(d.power_buffs.owner, 'group'); assert.strictEqual(d.power_gear.owner, 'player');
    assert.deepStrictEqual([d.power_gear.me, d.power_gear.reference], [846, 1004]);
    assert.deepStrictEqual([d.power_consumables.me, d.power_consumables.reference], [0, 103]);
    assert.deepStrictEqual([d.power_buffs.me, d.power_buffs.reference], [0, 141]);
    assert.deepStrictEqual([d.hit_under_cap.me, d.hit_under_cap.reference], [181, 202]);
    assert.ok(d.hit_under_cap.share >= 1 && d.hit_under_cap.share <= 3, '21 rating under the cap is a 1.7% miss chance: ' + d.hit_under_cap.share);
    assert.ok(d.debuffs.share >= 10 && d.debuffs.share <= 14, 'Shadow Weaving missing is a 1.10 multiplier: ' + d.debuffs.share);
    assert.ok(d.power_gear.share > 0 && d.power_consumables.share > 0 && d.power_buffs.share > 0, 'all three power sources are behind');
    assert.ok(d.rotation.share >= 0 && d.rotation.share <= 2, 'power explains the rest of the per-cast gap here: ' + d.rotation.share);
    const k = by('crit');
    assert.deepStrictEqual(Object.keys(k), ['crit_gear', 'crit_consumables', 'crit_buffs', 'crit_luck']);
    assert.strictEqual(k.crit_luck.owner, 'noise');
    assert.ok(k.crit_gear.share >= 0 && k.crit_buffs.share >= 0, 'both sides of the expectation move up: gear ' + k.crit_gear.share + ' buffs ' + k.crit_buffs.share);
    assert.ok(k.crit_luck.share > k.crit_gear.share + k.crit_buffs.share, 'expected 32.1 vs 36.5 against measured 32 vs 46: luck carries most of the crit gap: luck ' + k.crit_luck.share);
});
test('explainGap: no accounting without a gap, a reference, or the measurements; missing stats leave power on rotation', () => {
    assert.strictEqual(G.explainGap(pull({ reference: null }), PLAYER), null);
    assert.strictEqual(G.explainGap(pull({ me: Object.assign({}, pull().me, { amount: 2500 }) }), PLAYER), null, 'above the reference');
    assert.strictEqual(G.explainGap(pull({ me: Object.assign({}, pull().me, { damagingCastsPerMinute: null }) }), PLAYER), null);
    const p = pull(); p.me = Object.assign({}, p.me, { stats: null }); p.reference = Object.assign({}, p.reference, { stats: null });
    const g = G.explainGap(p, PLAYER);
    const d = Object.fromEntries(g.factors.dmg.inputs.map(i => [i.key, i]));
    assert.strictEqual(d.power_gear.share, 0); assert.strictEqual(d.hit_under_cap.share, 0);
    assert.ok(d.rotation.share > 0);
    assert.strictEqual(g.factors.crit.inputs.find(i => i.key === 'crit_luck').share, g.factors.crit.share, 'no stats: the whole crit factor is unexplained');
});
test('explainGap: a raid at the reference raid median with the player at his raid median puts nothing on activity', () => {
    const p = pull(); p.fight = Object.assign({}, p.fight, { raidActivePercent: 85 }); p.me = Object.assign({}, p.me, { activePercent: 85 });
    const g = G.explainGap(p, PLAYER);
    const c = Object.fromEntries(g.factors.casts.inputs.map(i => [i.key, i]));
    assert.strictEqual(c.raid_activity.share, 0); assert.strictEqual(c.own_activity.share, 0);
    assert.ok(c.channel_time.share > 0 && c.cast_pacing.share > 0);
});
test('averageGap: mean factor shares over pulls with an accounting; null when none', () => {
    const a = G.explainGap(pull(), PLAYER), b = G.explainGap(pull({ me: Object.assign({}, pull().me, { critRate: 46 }) }), PLAYER);
    const avg = G.averageGap([{ gap: a }, { gap: b }, { gap: null }]);
    assert.strictEqual(avg.crit, Math.round((a.factors.crit.share + b.factors.crit.share) / 2));
    assert.strictEqual(avg.casts, Math.round((a.factors.casts.share + b.factors.casts.share) / 2));
    assert.strictEqual(G.averageGap([{ gap: null }]), null);
});
```

Append to `vet-feedback.test.js` after the Task 2 measurement tests:

```js
test('v3: killFacts carries kill.gap for a pull below its reference; buildFacts carries overall.gap', () => {
    const k = killFor(50619);
    assert.ok(k.gap && k.gap.ratio > 1, 'Rotminster is below the reference on Anetheron');
    const product = ['casts', 'dmg', 'crit', 'residual'].reduce((p, f) => p * k.gap.factors[f].value, 1);
    assert.ok(Math.abs(product - k.gap.ratio) < 1e-6);
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(facts.overall.gap, { casts: k.gap.factors.casts.share, dmg: k.gap.factors.dmg.share, crit: k.gap.factors.crit.share, residual: k.gap.factors.residual.share }, 'Kaz\'rogal is a bad pull: only Anetheron counts');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-gap.test.js 2>&1 | tail -1; node vet-feedback.test.js 2>&1 | tail -1`
Expected: `6 passed, 5 failed`; `88 passed, 1 failed`.

- [ ] **Step 3: Implement `explainGap` and `averageGap`**

Append to `vet-gap.js` before `module.exports` (and add `explainGap, averageGap` to the exports):

```js
// --- The accounting (spec v3 §3). Everything is on the log scale so factor shares add up.
const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
const safeLog = r => (r > 0 && isFinite(r) ? Math.log(r) : 0);
function input(key, owner, logValue, G, me, reference, unit) {
    return { key, owner, share: share(logValue, G), me, reference, unit: unit || null, log: logValue };
}
function finish(factor, G) {
    factor.share = share(Math.log(factor.value), G);
    factor.inputs.forEach(i => delete i.log);
    return factor;
}

function explainGap(kill, player) {
    const me = kill && kill.me, ref = kill && kill.reference, fight = kill && kill.fight;
    if (!me || !ref || !fight) return null;
    const need = ['damagingCastsPerMinute', 'damagePerDamagingCast', 'critRate'];
    if (need.some(k => num(me[k]) === null || num(ref[k]) === null) || num(me.amount) === null || num(ref.dps) === null) return null;
    const ratio = ref.dps / me.amount;
    if (!(ratio > 1)) return null;
    const G = Math.log(ratio);
    const role = player.role, spec = player.spec, schools = player.schools || [];
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';

    // Casts factor: raid activity, own activity, channel time, pacing (remainder).
    const casts = { value: ref.damagingCastsPerMinute / me.damagingCastsPerMinute, inputs: [] };
    const myRaid = num(fight.raidActivePercent), refRaid = num(ref.raidActivePercent), myAct = num(me.activePercent), refAct = num(ref.activePercent);
    const raidLog = myRaid && refRaid ? safeLog(refRaid / myRaid) : 0;
    const ownLog = myRaid && refRaid && myAct && refAct ? safeLog((refAct / refRaid) / (myAct / myRaid)) : 0;
    const myCh = num(me.channelSecPerMin) || 0, refCh = num(ref.channelSecPerMin) || 0;
    const chLog = safeLog((60 - refCh) / (60 - myCh));
    const paceLog = Math.log(casts.value) - raidLog - ownLog - chLog;
    casts.inputs.push(input('raid_activity', 'raid', raidLog, G, myRaid, refRaid, 'raid median active %'));
    casts.inputs.push(input('own_activity', 'player', ownLog, G, myAct, refAct, 'active %'));
    casts.inputs.push(input('channel_time', 'player', chLog, G, myCh, refCh, 'seconds a minute channelling'));
    casts.inputs.push(input('cast_pacing', 'player', paceLog, G, me.damagingCastsPerMinute, ref.damagingCastsPerMinute, 'damaging casts a minute'));

    // Damage-per-cast factor: hit, debuffs, power split (gear / consumables / buffs), rotation.
    const dmg = { value: ref.damagePerDamagingCast / me.damagePerDamagingCast, inputs: [] };
    const hitKey = physical ? 'meleeHit' : 'spellHit', perPct = physical ? C.MELEE_HIT_RATING_PER_PCT : C.HIT_RATING_PER_PCT, cap = physical ? C.HIT_CAP[role === 'ranged' ? 'ranged' : 'melee'] : C.HIT_CAP.spell;
    const myHit = me.stats && num(me.stats[hitKey]), refHit = ref.stats && num(ref.stats[hitKey]);
    const miss = h => Math.max(0, cap - h / perPct) / 100;
    const hitLog = myHit !== null && refHit !== null ? safeLog((1 - miss(refHit)) / (1 - miss(myHit))) : 0;
    const myDeb = debuffMultiplier(kill.debuffs && kill.debuffs.present, schools), refDeb = debuffMultiplier(ref.debuffs, schools);
    const debLog = safeLog(refDeb / myDeb);
    const myP = powerParts({ stats: me.stats, auras: (me.consumablesAtPull || []).concat(me.buffsAtPull || []), role });
    const refP = powerParts({ stats: ref.stats, auras: (ref.consumablesAtPull || []).concat(ref.buffsAtPull || []), role });
    const remaining = Math.log(dmg.value) - hitLog - debLog;
    // Damage per cast scales with total power plus the ability's base (POWER_BASE): the log factor
    // that difference explains is split over the three power sources in proportion to their
    // positive gaps, clipped to what is left after hit and debuffs. What power cannot claim is
    // ability choice and misses: rotation. Without gear power on both sides nothing is claimed.
    const K = C.POWER_BASE[role] || 670;
    let powerLogs = [0, 0, 0];
    if (myP.gear !== null && refP.gear !== null && remaining > 0) {
        const myTot = myP.gear + myP.consumables + myP.buffs, refTot = refP.gear + refP.consumables + refP.buffs;
        const total = Math.min(remaining, Math.max(0, safeLog((refTot + K) / (myTot + K))));
        powerLogs = splitLog(total, [refP.gear - myP.gear, refP.consumables - myP.consumables, refP.buffs - myP.buffs]);
    }
    const rotLog = remaining - powerLogs.reduce((s, x) => s + x, 0);
    dmg.inputs.push(input('hit_under_cap', 'player', hitLog, G, myHit, refHit, 'hit rating'));
    dmg.inputs.push(input('debuffs', 'group', debLog, G, Math.round(100 * myDeb) / 100, Math.round(100 * refDeb) / 100, 'debuff multiplier'));
    dmg.inputs.push(input('power_gear', 'player', powerLogs[0], G, myP.gear, refP.gear, physical ? 'attack power from gear' : 'spell power from gear'));
    dmg.inputs.push(input('power_consumables', 'player', powerLogs[1], G, myP.consumables, refP.consumables, physical ? 'attack power from consumables' : 'spell power from consumables'));
    dmg.inputs.push(input('power_buffs', 'group', powerLogs[2], G, myP.buffs, refP.buffs, physical ? 'attack power from party buffs' : 'spell power from party buffs'));
    dmg.inputs.push(input('rotation', 'player', rotLog, G, me.damagePerDamagingCast, ref.damagePerDamagingCast, 'damage per cast'));

    // Crit factor: expected from gear / consumables / buffs, the rest is luck.
    const B = typeof C.CRIT_BONUS[spec] === 'number' ? C.CRIT_BONUS[spec] : 0.5;
    const crit = { value: (1 + ref.critRate / 100 * B) / (1 + me.critRate / 100 * B), inputs: [] };
    const myE = expectedCrit({ stats: me.stats, auras: (me.consumablesAtPull || []).concat(me.buffsAtPull || []), classToken: player.classToken, spec, role });
    const refE = expectedCrit({ stats: ref.stats, auras: (ref.consumablesAtPull || []).concat(ref.buffsAtPull || []), classToken: player.classToken, spec, role });
    const critLogOf = (a, b) => safeLog((1 + b / 100 * B) / (1 + a / 100 * B));
    let gearLog = 0, consLog = 0, buffLog = 0;
    if (myE && refE) {
        // Walk the expected chance up one input at a time, so each input's log is its own step.
        const afterGear = myE.total + (refE.gear - myE.gear), afterCons = afterGear + (refE.consumables - myE.consumables);
        gearLog = critLogOf(myE.total, afterGear);
        consLog = critLogOf(afterGear, afterCons);
        buffLog = critLogOf(afterCons, refE.total);
    }
    const luckLog = Math.log(crit.value) - gearLog - consLog - buffLog;
    crit.inputs.push(input('crit_gear', 'player', gearLog, G, myE ? Math.round(myE.gear * 10) / 10 : null, refE ? Math.round(refE.gear * 10) / 10 : null, 'crit % from gear'));
    crit.inputs.push(input('crit_consumables', 'player', consLog, G, myE ? Math.round(myE.consumables * 10) / 10 : null, refE ? Math.round(refE.consumables * 10) / 10 : null, 'crit % from consumables'));
    crit.inputs.push(input('crit_buffs', 'group', buffLog, G, myE ? Math.round(myE.buffs * 10) / 10 : null, refE ? Math.round(refE.buffs * 10) / 10 : null, 'crit % from party buffs'));
    crit.inputs.push(input('crit_luck', 'noise', luckLog, G, me.critRate, ref.critRate, 'measured crit %'));

    const residual = { value: ratio / (casts.value * dmg.value * crit.value), inputs: [] };
    const factors = { casts: finish(casts, G), dmg: finish(dmg, G), crit: finish(crit, G), residual: finish(residual, G) };
    return { ratio: Math.round(ratio * 1000) / 1000, factors, residualShare: factors.residual.share };
}

function averageGap(kills) {
    const gaps = (kills || []).map(k => k && k.gap).filter(Boolean);
    if (!gaps.length) return null;
    const avg = key => Math.round(gaps.reduce((s, g) => s + g.factors[key].share, 0) / gaps.length);
    return { casts: avg('casts'), dmg: avg('dmg'), crit: avg('crit'), residual: avg('residual') };
}
```

In `vet-feedback.js`: in `killFacts`, after `kill.findings = killFindings(kill, player);` insert before it `kill.gap = kill.fight.badPull ? null : GAP.explainGap(kill, player);` (the object literal must declare `gap: null` so key order is stable; findings are computed after `gap` so Task 4 can read it). In `buildFacts`, add `gap: GAP.averageGap(slim.filter(k => !k.fight.badPull)),` to `overall` after `ceiling`.

- [ ] **Step 4: Run the suites**

Run: `node vet-gap.test.js 2>&1 | tail -1; node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `11 passed, 0 failed`; `89 passed, 0 failed`; `13 passed, 0 failed`. If the power-split test fails on `power_consumables.reference` 103: Flask of Pure Death 80 + Well Fed 23. `power_buffs.reference` 141: Wrath of Air 101 + Prayer of Spirit 40 (the Owl carries crit, not power).

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-gap.test.js vet-feedback.js vet-feedback.test.js
git commit -m "feat(gap): explainGap — the DPS gap as a product of casts, damage per cast, crit and residual, every input with an owner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Findings from the accounting; outcome findings retired; stat priority; utility extras; bad pulls against the fastest kill

**Files:**
- Modify: `vet-gap.js` (`gapFindings`, `statPriorityFindings`), `vet-gap.test.js`
- Modify: `vet-feedback.js` — `T` (add `minShare: 3`), `killFindings`, `rotationFindings` (`ability_extra` for utility), `damageFindings` (removed), `statFindings` (removed), `uptimeFindings` (`active_low`/`casts_low` removed; `died` stays), `fightContext` (fastest duration + phase text), `mergeFindings` (order by share, no cap, `measuredOn` by max share), `positives` ("ahead" lines), `buildFacts`
- Test: `vet-feedback.test.js` (named assertion changes below)

**Interfaces:**
- Produces: `gapFindings(kill, player, thresholds) → finding[]` where each finding is `{ key, owner, severity, scope, share, factor, text, me, reference, unit, ability? }`; `owner` ∈ player/group/raid; `scope` mirrors owner for the prompt's existing rule (`player` or `group`; raid findings use scope `raid`).
- Removed keys: `crit_low`, `hit_low`, `resist_high`, `stat_low`, `casts_low`, `active_low`. New keys: `raid_activity`, `own_activity`, `channel_time`, `cast_pacing`, `hit_under_cap`, `power_gear`, `power_consumables`, `power_buffs`, `rotation`, `crit_gear`, `crit_consumables`, `crit_buffs`, `gear_stat` (one per stat, `stat` field), `debuffs`.
- `mergeFindings` returns every finding (no cap) ordered by `share` desc, then severity, then count; v2's "seen on N of M pulls/bosses" suffix and `measuredOn` rules stay, with `measuredOn` = the pull where the finding's share was largest.

- [ ] **Step 1: Write the failing tests**

Append to `vet-gap.test.js`:

```js
test('gapFindings: one finding per input at or above minShare, with owner, share, numbers and a sentence; luck never becomes a finding', () => {
    const g = G.explainGap(pull(), PLAYER);
    const f = G.gapFindings(Object.assign(pull(), { gap: g }), PLAYER, { minShare: 3 });
    assert.ok(f.every(x => x.share >= 3 && ['player', 'group', 'raid'].includes(x.owner) && typeof x.text === 'string' && x.text.length > 20));
    assert.ok(!f.some(x => x.key === 'crit_luck'));
    const keys = f.map(x => x.key);
    ['raid_activity', 'own_activity', 'channel_time', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs'].forEach(k => assert.ok(keys.includes(k), k + ' in ' + keys.join()));
    assert.ok(!keys.includes('cast_pacing'), 'pacing is negative on this pull (the reference casts slower while active once activity and channelling are taken out)');
    const ch = f.find(x => x.key === 'channel_time');
    assert.strictEqual(ch.text, 'Channelling Drain Soul and other utility 6 seconds of every minute on Morogrim Tidewalker; comparable players 0. Worth ' + ch.share + '% of the gap');
    const ra = f.find(x => x.key === 'raid_activity');
    assert.strictEqual(ra.owner, 'raid');
    assert.ok(/raid was active 70% of Morogrim Tidewalker against 85% for the reference raid/.test(ra.text), ra.text);
    const pb = f.find(x => x.key === 'power_buffs');
    assert.ok(/141 spell power from party buffs .* you had 0/.test(pb.text), pb.text);
    assert.ok(f.every((x, i) => i === 0 || f[i - 1].share >= x.share), 'ordered by share');
});
test('statPriorityFindings: hit under the cap hides the stats below it; at the cap, the next stat under its bar shows', () => {
    const me = { spellHit: 181, spellDamage: 846, spellCrit: 253, spellHaste: 0 }, ref = { spellHit: 202, spellDamage: 1004, spellCrit: 306, spellHaste: 80 };
    const under = G.statPriorityFindings({ me, reference: ref, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'Morogrim Tidewalker' });
    assert.deepStrictEqual(under.map(f => f.stat), ['spellHit'], 'only hit while hit is under the cap');
    assert.strictEqual(under[0].text, 'Hit rating 181 against the 202 the raid asks for; get hit to the cap before any other stat');
    const capped = G.statPriorityFindings({ me: Object.assign({}, me, { spellHit: 205 }), reference: ref, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'Morogrim Tidewalker' });
    assert.deepStrictEqual(capped.map(f => f.stat), ['spellDamage', 'spellCrit', 'spellHaste'], 'every stat under its bar, in priority order');
    assert.strictEqual(capped[0].text, 'Spell power from gear 846 against 1004 for players at your item level among the top 2000 parses');
    assert.deepStrictEqual(G.statPriorityFindings({ me, reference: null, spec: 'Destruction', role: 'caster', hitCap: 202, boss: 'X' }), []);
});
```

In `vet-feedback.test.js`, make these named changes:

1. Test `killFacts on Anetheron: identity, url, me, and the player-side findings` (line ~355): replace the three `assert.ok(keys.includes('crit_low'|'hit_low'|'stat_low'))` lines and the `crit`/`hit`/`stat` blocks after them with:
```js
    assert.ok(!keys.some(x => ['crit_low', 'hit_low', 'resist_high', 'stat_low', 'casts_low', 'active_low'].includes(x)), 'outcome findings are gone');
    const gapKeys = ['raid_activity', 'own_activity', 'channel_time', 'cast_pacing', 'hit_under_cap', 'debuffs', 'power_gear', 'power_consumables', 'power_buffs', 'rotation', 'crit_gear', 'crit_consumables', 'crit_buffs'];
    const gapF = k.findings.filter(f => gapKeys.includes(f.key));
    assert.ok(gapF.length >= 3, 'the accounting produces findings on Anetheron: ' + keys.join());
    assert.ok(gapF.every(f => ['player', 'group', 'raid'].includes(f.owner) && f.share >= 3 && /Worth \d+% of the gap/.test(f.text)), JSON.stringify(gapF));
    assert.ok(!keys.includes('crit_luck'));
    const gs = k.findings.filter(f => f.key === 'gear_stat');
    const order = ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'];
    assert.ok(gs.every(f => order.includes(f.stat)) && gs.map(f => order.indexOf(f.stat)).every((v, i, a) => i === 0 || a[i - 1] < v), 'gear stats in priority order: ' + gs.map(f => f.stat).join());
```
2. Test `damageFindings: crit/hit/resist need at least T.minAbilityHits casts on both sides (Important 3)` (line ~440): delete it entirely (the function is removed).
3. Test `statFindings: primary stat under 90% is major, nothing without a reference`: delete it (replaced by `statPriorityFindings` tests in `vet-gap.test.js`).
4. Test `uptimeFindings: a death before 90% of the fight and active time under 85% are major`: keep the death assertion; replace the active-time assertions with `assert.ok(!f.some(x => x.key === 'active_low'), 'activity is an accounting input now');`.
5. Test `mergeFindings: bad pulls dropped, stat_low folded into hit_low, ordered, capped at 6`: rename to `mergeFindings: bad pulls dropped, ordered by share then severity, uncapped` and replace its body's `stat_low`/`hit_low`/cap assertions with:
```js
    assert.ok(!m.some(f => f.key === 'stat_low' || f.key === 'hit_low'));
    assert.ok(m.every((f, i) => i === 0 || (m[i - 1].share || 0) >= (f.share || 0)), 'share descending');
    assert.ok(m.length >= 7, 'no cap at 6: ' + m.length);
```
6. Tests at lines ~610–640 that look up `crit_low` in a merge (`the same finding on two bosses …` and the v2 `two pulls …` test): change `f.key === 'crit_low'` to `f.key === 'power_gear'` and, in the Important 2 test, `measuredOn` stays `'Anetheron'` (both kills are the same object, equal shares → the first seen).
7. Test `fetchFeedback: a healer gets the limited sheet …` (line ~1077): extend the key list to `['crit_low', 'hit_low', 'stat_low', 'ability_unused', 'power_gear', 'crit_gear']`.
8. Test `killFacts on Kaz'rogal: bad pull, consumables unknown, Curse of Doom unused`: add `assert.strictEqual(k.gap, null, 'no accounting on a bad pull');` and `assert.ok(/1131s/.test(k.fight.badPullReason) && /fastest reference kills/.test(k.fight.badPullReason) && /trash waves/.test(k.fight.badPullReason), k.fight.badPullReason);`.
9. Add:
```js
test('rotationFindings (v3): a utility cast the reference never makes is an extra when the player makes it once a minute', () => {
    const k = killFor(50619);
    const casts = Object.assign({}, k.me.casts, { 'Drain Soul': 7 });
    const f = F.rotationFindings(Object.assign({}, k, { me: Object.assign({}, k.me, { casts }) }));
    const x = f.find(y => y.key === 'ability_extra' && y.ability === 'Drain Soul');
    assert.ok(x && /Cast Drain Soul 7 times on Anetheron; comparable players do not use it/.test(x.text), x && x.text);
    const lt = f.find(y => y.key === 'ability_extra' && y.ability === 'Life Tap');
    assert.strictEqual(lt, undefined, 'the reference casts Life Tap too');
});
test('positives (v3): an input where the player is ahead of the reference is a positive', () => {
    const k = killFor(50619);
    const g = JSON.parse(JSON.stringify(k.gap));
    g.factors.casts.inputs.find(i => i.key === 'own_activity').share = -5;
    const pos = F.positives([Object.assign({}, k, { gap: g })], 'caster');
    assert.ok(pos.some(p => /ahead of comparable players on activity/.test(p)), pos.join(' | '));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-gap.test.js 2>&1 | tail -1; node vet-feedback.test.js 2>&1 | tail -1`
Expected: `11 passed, 2 failed`; the feedback suite shows the changed and new tests failing (`gapFindings is not a function`, key assertions), roughly `82 passed, 7 failed` — the exact count depends on how many of the rewritten assertions the old code happens to satisfy; paste it.

- [ ] **Step 3: Implement**

Append to `vet-gap.js` (export both):

```js
const REF_LABEL = 'players at your item level among the top 2000 parses';
function pct(x) { return typeof x === 'number' ? Math.round(x * 10) / 10 : x; }
function gapText(i, boss) {
    const w = ' Worth ' + i.share + '% of the gap';
    switch (i.key) {
        case 'raid_activity': return 'Your raid was active ' + pct(i.me) + '% of ' + boss + ' against ' + pct(i.reference) + '% for the reference raid; phases and downtime, not you.' + w;
        case 'own_activity': return 'Active ' + pct(i.me) + '% of ' + boss + ' against ' + pct(i.reference) + '% for ' + REF_LABEL + '.' + w;
        case 'channel_time': return 'Channelling Drain Soul and other utility ' + pct(i.me) + ' seconds of every minute on ' + boss + '; comparable players ' + pct(i.reference) + '.' + w;
        case 'cast_pacing': return pct(i.me) + ' damaging casts a minute on ' + boss + ' while active, against ' + pct(i.reference) + '; the time between casts.' + w;
        case 'hit_under_cap': return 'Hit rating ' + i.me + ' against ' + i.reference + ' for ' + REF_LABEL + '; misses are wasted casts.' + w;
        case 'debuffs': return 'Raid debuffs on ' + boss + ' multiplied damage by ' + i.me + ' against ' + i.reference + ' for the reference raid.' + w;
        case 'power_gear': return 'Spell power from gear ' + i.me + ' against ' + i.reference + ' for ' + REF_LABEL + '.' + w;
        case 'power_consumables': return i.reference + ' spell power from flask, elixirs, oil and food for ' + REF_LABEL + '; you had ' + i.me + '.' + w;
        case 'power_buffs': return i.reference + ' spell power from party buffs for ' + REF_LABEL + '; you had ' + i.me + '.' + w;
        case 'rotation': return 'Damage per cast ' + i.me + ' against ' + i.reference + ' after gear, buffs and debuffs are accounted for: ability choice and misses.' + w;
        case 'crit_gear': return 'Crit from gear (rating and intellect) ' + pct(i.me) + '% against ' + pct(i.reference) + '% for ' + REF_LABEL + '.' + w;
        case 'crit_consumables': return 'Crit from consumables ' + pct(i.me) + '% against ' + pct(i.reference) + '%.' + w;
        case 'crit_buffs': return 'Crit from party buffs ' + pct(i.me) + '% against ' + pct(i.reference) + '% for ' + REF_LABEL + '.' + w;
        default: return i.key + ' ' + i.me + ' against ' + i.reference + '.' + w;
    }
}
// spec v3 §4: every input at or above minShare becomes one finding; luck never does.
function gapFindings(kill, player, thresholds) {
    const g = kill && kill.gap;
    if (!g) return [];
    const min = thresholds && typeof thresholds.minShare === 'number' ? thresholds.minShare : 3;
    const out = [];
    ['casts', 'dmg', 'crit'].forEach(fk => g.factors[fk].inputs.forEach(i => {
        if (i.owner === 'noise' || i.share < min) return;
        const physical = player.role === 'melee' || player.role === 'ranged' || player.role === 'tank';
        let text = gapText(i, kill.name);
        if (physical) text = text.replace(/Spell power|spell power/g, m => (m[0] === 'S' ? 'Attack power' : 'attack power'));
        out.push({ key: i.key, owner: i.owner, severity: i.share >= 15 ? 'major' : 'minor', scope: i.owner === 'raid' ? 'raid' : i.owner, share: i.share, factor: fk, text, me: i.me, reference: i.reference, unit: i.unit });
    }));
    return out.sort((a, b) => b.share - a.share);
}
const STAT_TEXT = { spellHit: 'Hit rating', meleeHit: 'Hit rating', expertise: 'Expertise rating', spellDamage: 'Spell power from gear', attackPower: 'Attack power from gear', rangedAttackPower: 'Ranged attack power from gear',
                    spellCrit: 'Spell crit rating', meleeCrit: 'Crit rating', rangedCrit: 'Crit rating', spellHaste: 'Spell haste rating', meleeHaste: 'Haste rating' };
// spec v3 §4: gear stats in priority order; a stat lower in the list is not reported while a
// higher one is under its bar. Hit's bar is the raid's cap; the rest use the reference's gear.
function statPriorityFindings(o) {
    const { me, reference, spec, role, hitCap, boss } = o;
    if (!me || !reference) return [];
    const order = STAT_PRIORITY[spec] || STAT_PRIORITY[role === 'caster' ? 'Destruction' : 'Combat'];
    const out = [];
    for (const stat of order) {
        const mine = me[stat], bar = (stat === 'spellHit' || stat === 'meleeHit') && typeof hitCap === 'number' ? hitCap : reference[stat];
        if (typeof mine !== 'number' || typeof bar !== 'number' || !bar) continue;
        const under = (stat === 'spellHit' || stat === 'meleeHit') ? mine < bar : mine < 0.9 * bar;
        if (!under) continue;
        const isHit = stat === 'spellHit' || stat === 'meleeHit';
        const text = isHit ? STAT_TEXT[stat] + ' ' + mine + ' against the ' + bar + ' the raid asks for; get hit to the cap before any other stat'
                           : STAT_TEXT[stat] + ' ' + mine + ' against ' + bar + ' for ' + REF_LABEL;
        out.push({ key: 'gear_stat', owner: 'player', severity: isHit ? 'major' : 'minor', scope: 'player', share: 0, stat, text, me: mine, reference: bar, boss });
        if (isHit) break;
    }
    return out;
}
```

Add `gapFindings, statPriorityFindings, REF_LABEL` to the exports.

In `vet-feedback.js`:

- `T`: add `minShare: 3,`.
- Delete `damageFindings` and `statFindings` (and their exports); delete the `casts_low` block and the two `active_low` pushes in `uptimeFindings` (keep `died`).
- `killFindings` becomes:
```js
function killFindings(kill, player) {
    const hitCap = kill.hitCap;
    let f = uptimeFindings(kill).concat(
        GAP.gapFindings(kill, player, T),
        GAP.statPriorityFindings({ me: kill.me.stats, reference: kill.reference && kill.reference.stats, spec: player.spec, role: player.role, hitCap, boss: kill.name }),
        rotationFindings(kill), consumableFindings(kill), debuffFindings(kill, player));
    if (!kill.reference && kill.referenceNote) f.push(finding('no_reference', 'info', 'player', kill.referenceNote + ' on ' + kill.name));
    return f.map(x => Object.assign({ owner: x.owner || (x.scope === 'group' ? 'group' : 'player'), share: typeof x.share === 'number' ? x.share : 0 }, x));
}
```
  `killFacts` gains `hitCap` on the kill from its input: `hitCap: typeof input.hitCap === 'number' ? input.hitCap : null`. `fetchFeedback` computes `const th = V.parseThresholds(thresholds || {});` once and passes `hitCap: (role === 'caster' || role === 'healer') ? th.spellHit : th.meleeHit` to every `killFacts` call (the threshold keys are `spellHit` and `meleeHit`, as vetting.js's `THRESH_LABELS` lists them).
- `rotationFindings`: in the `ability_extra` loop replace `if (UTILITY_CAST.test(name) || ref.casts[name]) return;` with `if (ref.casts[name]) return;` so a utility cast the reference never makes counts too (the reference's own utility casts are already in `ref.casts` for the majority).
- `fightContext`: the duration rule uses `refDurationSec` — `killFacts` now passes `reference ? (reference.fastestDurationSec || reference.durationSec) : null`, and the reason text becomes `'the pull took ' + Math.round(durationSec) + 's against the fastest reference kills at ' + Math.round(refDurationSec) + 's' + (GAP.PHASE_BOSSES[name] ? ' (' + GAP.PHASE_BOSSES[name] + ')' : '')` — `fightContext` gains the boss `name` as a sixth argument for that lookup. Update the existing `fightContext on Kaz'rogal` test's reason regex from `/typical/` to `/fastest reference kills/` if it matches on that word.
- `mergeFindings`: drop the `stat_low` folding and the `slice(0, 6)`; sort by `(b.share || 0) - (a.share || 0)`, then `SEVERITY_ORDER`, then count; when a finding is seen again on another pull with a larger `share`, replace its text/numbers/`measuredOn` with that pull's and keep the larger share.
- `positives`: add, after the stat block, lines for gap inputs where the player is ahead: for each key in `['own_activity', 'cast_pacing', 'power_gear', 'crit_gear', 'power_consumables']` whose share is ≤ −3 on every live pull with a gap, push `'Ahead of comparable players on ' + LABEL[key]` with `LABEL = { own_activity: 'activity', cast_pacing: 'cast pacing', power_gear: 'spell power from gear', crit_gear: 'crit from gear', power_consumables: 'consumables' }`; raise the `slice(0, 2)` cap to 4.

- [ ] **Step 4: Run the suites**

Run: `node vet-gap.test.js 2>&1 | tail -1; node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `13 passed, 0 failed`; the feedback suite fully green with its new count (two tests deleted, two added: `89 passed, 0 failed`); `13 passed, 0 failed`. Paste all three.

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-gap.test.js vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): findings come from the gap accounting — owners and shares, stat priority, utility extras, bad pulls against the fastest kill; outcome findings retired

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The note — six owner-based sections, completeness guard, relabelled reference

**Files:**
- Modify: `vet-feedback.js` — `buildPrompt`, new `completeReply(text, facts)`; `module.exports`
- Modify: `server.js` — the model section of `/api/vet/feedback`
- Test: `vet-feedback.test.js`, `server.test.js`

**Interfaces:**
- Produces: `completeReply(text, facts) → { text, appended: string[] }` — appends, under a final line `Also:`, the `text` of every `overall.findings` entry whose headline number (`me`, when numeric) or `FINDING_ANCHOR[key]` word is absent from the reply.
- Prompt sections: header; "Where the gap comes from"; "What you can fix"; "Ask your raid leader"; "What's fine"; "Where you stand"; "Not on you". Under 450 words.

- [ ] **Step 1: Write the failing tests**

`vet-feedback.test.js`:

```js
test('buildPrompt (v3): six owner-based sections, the gap summary, the relabelled reference, no cap on findings', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    ['Where the gap comes from', 'What you can fix', 'Ask your raid leader', "What's fine", 'Where you stand', 'Not on you'].forEach(s => assert.ok(p.system.includes(s), s));
    assert.ok(/overall\.gap/.test(p.system) && /unexplained/.test(p.system));
    assert.ok(/among the top 2000 parses/.test(p.system));
    assert.ok(/owner is "player"/.test(p.system) && /owner is "group"/.test(p.system) && /owner is "raid"/.test(p.system));
    assert.ok(/Under 450 words/.test(p.system) && !/at most 5/.test(p.system));
    assert.ok(/share/.test(p.system), 'the model is told what share means');
});
test('completeReply (v3): findings the model left out are appended under "Also:"; nothing appended when all are present', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const all = facts.overall.findings;
    assert.ok(all.length >= 5);
    const full = all.map(f => f.text).join(' ');
    assert.deepStrictEqual(F.completeReply(full, facts).appended, []);
    const partial = all.slice(1).map(f => f.text).join(' ');
    const r = F.completeReply(partial, facts);
    assert.deepStrictEqual(r.appended, [all[0].text]);
    assert.ok(r.text.endsWith('\n\nAlso:\n' + all[0].text));
    const facts2 = Object.assign({}, facts, { overall: Object.assign({}, facts.overall, { findings: [{ key: 'no_food', text: 'No food buff at the Anetheron pull', me: null }] }) });
    assert.deepStrictEqual(F.completeReply('You had no food on the pull.', facts2).appended, [], 'the anchor word is enough for a finding without a number');
    assert.deepStrictEqual(F.completeReply('Nice work.', facts2).appended, ['No food buff at the Anetheron pull']);
});
```

`server.test.js`:

```js
test('GET /api/vet/feedback (v3): a model reply missing findings is completed under "Also:" and still returned as the report', async () => {
    setupPipeline(async () => 'Rotminster, Destruction, BT / Hyjal, median parse 14\n\nWhat\'s fine\nNo deaths.');
    const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    const body = await r.json();
    assert.strictEqual(body.reportError, null);
    assert.ok(body.report.includes('\n\nAlso:\n'), body.report);
    assert.ok(body.facts.overall.findings.every(f => body.report.includes(f.text)), 'every finding text appears');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `89 passed, 2 failed`; `13 passed, 1 failed`.

- [ ] **Step 3: Implement**

`buildPrompt`'s `system` array becomes (keep the first three lines and the Anniversary rules as they are; replace everything from the `"Comparable players"` line to the end):

```js
        '"Comparable players" means ' + GAP.REF_LABEL + ' on the same boss (each kill\'s reference). reference.topDps is what the best players at that item level reach.',
        'Every finding carries an owner and a share. owner is "player" for things the player can change themselves; owner is "group" for party buffs, raid debuffs and Bloodlust, which are things to ask the raid leader for and never the player\'s failing; owner is "raid" for kill speed, phases and deaths, which are not on the player. share is the percentage of the DPS gap that input accounts for.',
        'A finding\'s numbers were measured on the boss named in its measuredOn field. Never attach them to another boss, even one also listed in that finding\'s bosses array.',
        'Anniversary rules that differ from original TBC:',
    ].concat(rulesLines || [], [
        'Structure, in this order, plain text:',
        '1. One header line: name, spec, tier, then "median parse P" using tier.medianPercent — or, when night is not null, "raid night of <night.date>, median parse that night P" using night.medianPercent.',
        '2. If overall.gap is not null, a line "Where the gap comes from", then one sentence per factor from overall.gap with its share: casting less (casts), weaker casts (dmg), crit (crit), and "the rest is luck or unexplained" for residual when it is 3 or more.',
        '3. A line "What you can fix", then every finding whose owner is "player", biggest share first, each as one short paragraph: what it is, your number next to the comparable-player number, its share of the gap, one concrete fix. Do not drop any.',
        '4. If any finding has owner "group", a line "Ask your raid leader", then each of them with its share, phrased as a request to the raid leader.',
        '5. If overall.positives is not empty, a line "What\'s fine", then one or two sentences built from overall.positives.',
        '6. If overall.ceiling is not empty, a line "Where you stand", then one line per entry: your number (me), what ' + GAP.REF_LABEL + ' do (dps), and what the best at your item level reach (topDps) on that boss.',
        '7. If overall.badPulls is not empty or any finding has owner "raid", a line "Not on you", then one line per bad pull with its reason and one per raid finding.',
        'Under 450 words.',
        facts && facts.limited ? 'This player is a healer: the sheet has no gap accounting, so write only about uptime, deaths, consumables, buffs and gear.' : '',
    ]).filter(Boolean).join('\n');
```

Add before `checkNumbers`:

```js
// spec v3 §5: the model must not drop a finding. Any finding whose headline number (me) or anchor
// word is absent from the reply is appended verbatim under "Also:" instead of rejecting the reply.
function completeReply(text, facts) {
    const findings = facts && facts.overall && Array.isArray(facts.overall.findings) ? facts.overall.findings : [];
    const body = String(text || '');
    const present = f => {
        if (typeof f.me === 'number') { const n = Math.round(f.me); return numbersIn(body).some(x => Math.abs(x - n) <= 1) || body.includes(String(f.me)); }
        const anchor = GAP.FINDING_ANCHOR[f.key];
        return anchor ? body.toLowerCase().includes(anchor.toLowerCase()) : body.includes(f.text);
    };
    const appended = findings.filter(f => !present(f)).map(f => f.text);
    return { text: appended.length ? body + '\n\nAlso:\n' + appended.join('\n') : body, appended };
}
```

Export `completeReply`. In `server.js` replace `if (check.ok) reportText = text;` with `if (check.ok) reportText = VetFeedback.completeReply(text, facts).text;`.

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1; node vet-gap.test.js 2>&1 | tail -1`
Expected: `91 passed, 0 failed`; `14 passed, 0 failed`; `13 passed, 0 failed`. If the v2 test `buildPrompt: sections tell the model to skip themselves (Minor 14)` fails on its regexes, update its three regexes to the new rule texts for sections 3, 5 and 7 (name the change in your report).

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js server.js server.test.js
git commit -m "feat(feedback): the note in owner-based sections with shares; findings the model drops are appended; reference relabelled

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Client — the fallback note in six sections, the gap column and tooltip

**Files:**
- Modify: `vetting.js` — `fallbackReport`, `factsTable`
- Modify: `vetting.css`

- [ ] **Step 1: Implement `fallbackReport`**

Replace the body between the header line and the `Where you stand` block with:

```js
    const byOwner = o => facts.overall.findings.filter(f => (f.owner || (f.scope === 'group' ? 'group' : 'player')) === o);
    const g = facts.overall.gap;
    if (g) {
        lines.push('', 'Where the gap comes from');
        lines.push('Casting less: ' + g.casts + '% of the gap. Weaker casts: ' + g.dmg + '%. Crit: ' + g.crit + '%.' + (g.residual >= 3 ? ' Luck or unexplained: ' + g.residual + '%.' : ''));
    }
    const fixable = byOwner('player'), asks = byOwner('group'), raid = byOwner('raid');
    const heading = facts.player.metric === 'hps' ? "What's holding your healing back" : 'What you can fix';
    if (fixable.length) { lines.push('', heading); fixable.forEach((f, i) => lines.push((i + 1) + '. ' + f.text)); }
    if (asks.length) { lines.push('', 'Ask your raid leader'); asks.forEach((f, i) => lines.push((i + 1) + '. ' + f.text)); }
    if (facts.overall.positives.length) lines.push('', "What's fine", facts.overall.positives.join('. ') + '.');
```

and extend the "Not on you" block to list `raid` findings after the bad pulls: `raid.forEach(f => lines.push(f.text));` (the section renders when either list is non-empty). Keep the "Nothing to flag" line for the case where all three lists and positives are empty.

- [ ] **Step 2: Implement the gap column**

In `factsTable`, add a header `<th>Gap</th>` after `Crit vs band`, and a cell:

```js
            k.gap ? escapeHtml('casts ' + k.gap.factors.casts.share + '% · per cast ' + k.gap.factors.dmg.share + '% · crit ' + k.gap.factors.crit.share + '% · unexplained ' + k.gap.factors.residual.share + '%') : '—',
```

and give the row a `title` listing the inputs when `k.gap` exists: `tr.title = ['casts', 'dmg', 'crit'].flatMap(f => k.gap.factors[f].inputs.map(i => i.key + ' (' + i.owner + ') ' + i.share + '%')).join('\n');` (set only when there is no bad-pull title already). Rename the `Crit vs band` header to `Crit %` (it is an outcome shown to the leader, not a finding).

Add to `vetting.css`: `.facts-table td:nth-child(8) { white-space: nowrap; }`.

- [ ] **Step 3: Verify**

Run: `node --check vetting.js && npm test 2>&1 | grep -E "passed, .* failed"`
Expected: syntax OK and every suite green. Then commit:

```bash
git add vetting.js vetting.css
git commit -m "feat(vetting): fallback note in owner-based sections; gap column and input tooltip in the facts table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Spec notes, full run, smoke, calibration

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md` (one line under §3: "Superseded label (v3): the reference is the middle of the top 2000 parses; see the v3 spec §1.")
- Modify: `README.md` if it documents the endpoint (add: "The facts sheet carries `overall.gap` and per-pull `gap` with the DPS-gap accounting.")

- [ ] **Step 1: Docs and full run**

Make the edits; run `npm test 2>&1 | grep -E "passed, .* failed"` and paste every line.

- [ ] **Step 2: Smoke**

Start `npm start` in the background (check `lsof -i :3000 -sTCP:LISTEN` first; kill any listener that is not yours), poll `vetting.html` for 200, then run the v2 smoke script (`<scratchpad>/v2-smoke.mjs` from the previous plan; if absent, recreate it from that plan's Task 9 Step 3) and paste its output. Expected: both reports render, the across-kills report contains "Where the gap comes from", "What you can fix" and "Ask your raid leader", the facts table has a Gap column with four percentages per live row.

- [ ] **Step 3: Calibration**

```bash
for q in "name=Dotwin&server=spineshatter&region=eu&zone=1056" "name=Rotminster&server=spineshatter&region=eu&zone=1060"; do
  curl -s "http://localhost:3000/api/vet/feedback?$q" > /tmp/fb.json
  node -e 'const b=require("/tmp/fb.json"); console.log("overall gap", JSON.stringify(b.facts.overall.gap)); b.facts.kills.forEach(k=>{ if(!k.gap){console.log(k.name,k.date,"(no accounting: "+(k.fight.badPull?"bad pull":"no gap")+")");return;} const f=k.gap.factors; console.log(k.name,k.date,"| ratio",k.gap.ratio,"| casts",f.casts.share,"dmg",f.dmg.share,"crit",f.crit.share,"res",f.residual.share,"|",["casts","dmg","crit"].flatMap(x=>f[x].inputs.filter(i=>Math.abs(i.share)>=3).map(i=>i.key+" "+i.share)).join(", ")); }); console.log(b.report || ("FALLBACK: "+b.reportError))'
done
```

Paste the output. Check Dotwin's Morogrim (13 Aug or 20 Aug) decomposition against spec §8: casts ≈ 35, dmg ≈ 40, crit ≈ 13, residual ≈ 12, each within ± 8; report the numbers either way. Then stop the server and Chrome.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md README.md
git commit -m "docs: v2 spec points at the v3 accounting; README notes the gap fields

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(Drop `README.md` if unchanged.) Do not push.
