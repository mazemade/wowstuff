# Talent Catalog Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track every talent that decides a real assignment (15 total, 11 new), gate the four talent-is-the-spell rows and Greater Kings on actual castability, and let a known-untalented provider lose its row to the next provider.

**Architecture:** The shipped RSS3/`TALENTS`/`talentRank`/`rankPool`-tier machinery is extended, not changed: more keys in both tables, `improvedBy` on four more catalog objects, a new `requireTalent` gate consulted by `eligible()` with `requireSpec` kept as the unknown-data fallback, a talent-aware plan→paladin matching in `proposeBlessings`, and a two-pass provider loop where only a *known-untalented* best candidate demotes a provider. The governing rule everywhere: **a player with no talent data behaves exactly as today** — no surface may get worse for a Raid-Helper-only roster.

**Tech Stack:** Plain ES5-compatible JavaScript in a UMD wrapper, no build step. Lua 5.1 for the addon. Tests via `node assignments-engine.test.js`.

**Spec:** `docs/superpowers/specs/2026-08-13-talent-catalog-expansion-design.md`

**Depends on:** the `debuff-coverage` branch through commit `bb14fff` (plan 7 complete). Baseline at plan start: **173 passed, 0 failed**.

## Global Constraints

- **Test counts are stated as deltas AND absolutes.** The previous plan's absolute counts went stale twice. If your observed baseline differs from a task's stated start count, the *delta* is authoritative: recompute the expected absolute, say so in your report, and never rationalise a missing test because a stale absolute happened to match.
- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper. No dependencies.
- **Unknown talent data must degrade to today's behaviour.** `talents: null` (Raid-Helper signups, manual adds, un-inspectable players) must produce byte-identical assignments, blessings, and warnings to the current tree. Every task that touches ranking or gating carries a test pinning this.
- **RSS1/RSS2/RSS3 parsing is untouched.** This plan adds no wire-format change — only more `key=rank` pairs inside the existing RSS3 talent field. The pinned `RSS1 regression` fixture must not be edited.
- **The Lua↔JS parity test is the coupling guard.** `TRACKED_TALENTS` (addon) and `TALENTS` (engine) must agree on key set, English name, and class; the parity test's expected count moves 4 → 15 in Task 1 and any later drift fails the suite.
- **Talent names and maxRanks are provisional until the owner's in-game `/tprobe` check.** A wrong name degrades to `talent unknown` (safe); a wrong maxRank surfaces via `talentDrift` (visible). Neither blocks this plan.
- **All emitted duty text stays ASCII.** The fix-wave test already sweeps every `TALENTS[k].name`; the new names must keep it green (apostrophes in "Winter's Chill" / "Improved Hunter's Mark" are ASCII 0x27 — fine).
- **Every new test must be proven falsifiable by mutation** — apply the named mutation to a scratch copy under the session scratchpad, run, paste the real failure, restore. Re-run the key mutations at plan end (Task 6), not only when each test is written.
- **Overrides deliberately bypass `requireTalent`**, exactly as they bypass `applicableWhen` today: an explicit override is the lead telling the tool it is wrong. Only the curse/judgement exclusivity groups are hard rules.
- **Test command:** `node assignments-engine.test.js` (prints `N passed, M failed`, exits non-zero on failure). **Lua syntax check:** `luajit -b RaidSpecScan/RaidSpecScan.lua /dev/null` (`luajit` at `/opt/homebrew/bin/luajit`).
- **Worktree path trap:** shell cwd can silently reset to the primary checkout. Use absolute paths or `cd` to the worktree at the start of every command. A wildly wrong test count is the tell.

---

## Prerequisite

- [ ] **P1: Reinstall `RaidSpecScan` 3.1 before any in-game verification.** Task 1 bumps the worktree copy; copy `RaidSpecScan.lua` + `RaidSpecScan.toc` over `/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/` when ready to verify in-game, and restart the client (a `/reload` may not repick a changed `.toc`). Nothing in Tasks 1–6 is blocked by this.

---

### Task 1: Track the 11 new talents on both sides of the wire

**Files:**
- Modify: `RaidSpecScan/RaidSpecScan.lua` (`TRACKED_TALENTS`)
- Modify: `RaidSpecScan/RaidSpecScan.toc` (`## Version`)
- Modify: `assignments-engine.js` (`TALENTS`)
- Modify: `assignments-engine.test.js` (the Lua↔JS parity test's count assertion)

**Interfaces:**
- Produces: 11 new keys available in both `TRACKED_TALENTS` and `TALENTS`: `malediction`, `impFaerieFire`, `feralAggression`, `insectSwarm`, `impHuntersMark`, `impMight`, `impWisdom`, `kings`, `impScorch`, `wintersChill`, `hemorrhage`. Tasks 2–5 reference them by these exact strings.

- [ ] **Step 1: Make the parity test demand 15 keys (the failing test)**

Find the Lua↔JS parity test in `assignments-engine.test.js` (search for `TRACKED_TALENTS`). It asserts the number of parsed Lua pairs — currently 4. Change that count assertion to **15**, touching nothing else in the test. Read its parsing regexes while you are there: the class-section regex uses `[^{}]*`, which spans newlines, so the grown multi-line table parses without regex changes — but verify that against the final table shape in Step 3, and STOP and report if the regex genuinely cannot parse it rather than rewriting the test's logic.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node assignments-engine.test.js`
Expected: exactly one failure — the parity test, on the count (4 !== 15). Baseline check: 172 passed, 1 failed.

- [ ] **Step 3: Grow the addon table**

In `RaidSpecScan/RaidSpecScan.lua`, replace the whole `TRACKED_TALENTS` table with:

```lua
local TRACKED_TALENTS = {
    ROGUE   = { impExposeArmor  = "Improved Expose Armor",
                hemorrhage      = "Hemorrhage" },
    WARRIOR = { impThunderClap  = "Improved Thunder Clap",
                impDemoShout    = "Improved Demoralizing Shout" },
    PALADIN = { impSealCrusader = "Improved Seal of the Crusader",
                kings           = "Blessing of Kings",
                impMight        = "Improved Blessing of Might",
                impWisdom       = "Improved Blessing of Wisdom" },
    WARLOCK = { malediction     = "Malediction" },
    DRUID   = { impFaerieFire   = "Improved Faerie Fire",
                feralAggression = "Feral Aggression",
                insectSwarm     = "Insect Swarm" },
    MAGE    = { impScorch       = "Improved Scorch",
                wintersChill    = "Winter's Chill" },
    HUNTER  = { impHuntersMark  = "Improved Hunter's Mark" },
}
```

In `RaidSpecScan/RaidSpecScan.toc`, change `## Version: 3.0` to `## Version: 3.1`. The wire format does not change — `TalentPairs` already emits every tracked key for the class, so the field simply carries more pairs.

- [ ] **Step 4: Grow the engine table**

In `assignments-engine.js`, replace the `TALENTS` table with (double quotes where a name holds an apostrophe):

```js
    // The talents the catalog reasons about, under the same keys RaidSpecScan exports. The
    // addon resolved these by name at scan time, so there are no coordinates here to drift.
    // `maxRank` is the guard for the one thing that CAN drift: these keys and the addon's
    // TRACKED_TALENTS are maintained on opposite sides of the wire.
    const TALENTS = {
        impExposeArmor:  { class: 'ROGUE',   maxRank: 2, name: 'Improved Expose Armor' },
        hemorrhage:      { class: 'ROGUE',   maxRank: 1, name: 'Hemorrhage' },
        impThunderClap:  { class: 'WARRIOR', maxRank: 3, name: 'Improved Thunder Clap' },
        impDemoShout:    { class: 'WARRIOR', maxRank: 5, name: 'Improved Demoralizing Shout' },
        impSealCrusader: { class: 'PALADIN', maxRank: 3, name: 'Improved Seal of the Crusader' },
        kings:           { class: 'PALADIN', maxRank: 1, name: 'Blessing of Kings' },
        impMight:        { class: 'PALADIN', maxRank: 5, name: 'Improved Blessing of Might' },
        impWisdom:       { class: 'PALADIN', maxRank: 2, name: 'Improved Blessing of Wisdom' },
        malediction:     { class: 'WARLOCK', maxRank: 3, name: 'Malediction' },
        impFaerieFire:   { class: 'DRUID',   maxRank: 3, name: 'Improved Faerie Fire' },
        feralAggression: { class: 'DRUID',   maxRank: 5, name: 'Feral Aggression' },
        insectSwarm:     { class: 'DRUID',   maxRank: 1, name: 'Insect Swarm' },
        impScorch:       { class: 'MAGE',    maxRank: 3, name: 'Improved Scorch' },
        wintersChill:    { class: 'MAGE',    maxRank: 5, name: "Winter's Chill" },
        impHuntersMark:  { class: 'HUNTER',  maxRank: 5, name: "Improved Hunter's Mark" },
    };
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `node assignments-engine.test.js`
Expected: **173 passed, 0 failed** (delta 0 — the parity test is the only changed test, now demanding and finding 15). The fix-wave ASCII sweep over `TALENTS[k].name` covers the new names automatically.

- [ ] **Step 6: Syntax-check the addon**

Run: `luajit -b RaidSpecScan/RaidSpecScan.lua /dev/null`
Expected: no output, exit 0.

- [ ] **Step 7: Prove the parity test still has teeth at the new size**

On a scratch copy of the worktree files (engine, test, and the `RaidSpecScan/` directory — the parity test reads the Lua file, so the scratch dir needs it), rename `malediction` to `maledictionX` in the **Lua** table only. Run the suite there. Expected: exactly one failure, the parity test. Paste the real output, discard the scratch copy.

- [ ] **Step 8: Commit**

```bash
git add RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc assignments-engine.js assignments-engine.test.js
git commit -m "feat: track the eleven talents the rest of the catalog needs"
```

---

### Task 2: Four new ranker rows

**Files:**
- Modify: `assignments-engine.js` (`DEBUFF_CATALOG` — four objects)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Task 1's keys.
- Produces: `improvedBy` on the `coe` entry (`malediction`), the `ff` entry (`impFaerieFire`), the `hm` entry (`impHuntersMark`), and the Demoralizing Roar provider inside `ap` (`feralAggression`). The existing `rankPool` tier and `record()` qualifier logic pick these up with no code change — this task is catalog wiring plus proof.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`. Every fixture is anti-alphabetical on purpose: `rankPool` falls back to `a.name.localeCompare(b.name)`, so a fixture whose alphabetical order matches its expected order proves nothing.

```js
function lock(name, spec, rank) {
    const p = P(name, 'WARLOCK', spec);
    if (rank !== null) p.talents = { malediction: rank };
    return p;
}
test('autoAssign: curse of elements goes to the lock with Malediction, not the spec guess', () => {
    // Affliction is the preferred spec, but Malediction is the thing the preference proxied.
    const r = E.autoAssign([lock('Aaffl', 'Affliction', 0), lock('Zdestro', 'Destruction', 3)], {});
    assert.strictEqual(duty(r, 'coe').player, 'Zdestro');
    assert.strictEqual(duty(r, 'coe').qualifier, 'Malediction 3/3');
});
function dru(name, spec, key, rank) {
    const p = P(name, 'DRUID', spec);
    if (rank !== null) { p.talents = {}; p.talents[key] = rank; }
    return p;
}
test('autoAssign: faerie fire goes to the druid with Improved Faerie Fire', () => {
    // Balance ranks ahead of Feral on preferSpecs; the talent flips it.
    const r = E.autoAssign([dru('Abal', 'Balance', 'impFaerieFire', 0),
                            dru('Zferal', 'Feral', 'impFaerieFire', 3)], {});
    assert.strictEqual(duty(r, 'ff').player, 'Zferal');
});
test('autoAssign: demoralizing roar goes to the druid with Feral Aggression', () => {
    // No warrior/warlock/hunter in the roster, so ap falls to the druid provider; the
    // Feral preference loses to the talent.
    const r = E.autoAssign([dru('Aferal', 'Feral', 'feralAggression', 0),
                            dru('Zresto', 'Restoration', 'feralAggression', 5)], {});
    assert.strictEqual(duty(r, 'ap').player, 'Zresto');
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
});
function hunt(name, spec, rank) {
    const p = P(name, 'HUNTER', spec);
    if (rank !== null) p.talents = { impHuntersMark: rank };
    return p;
}
test("autoAssign: hunter's mark goes to the hunter whose mark is improved", () => {
    const r = E.autoAssign([hunt('Amm', 'Marksmanship', 0), hunt('Zbm', 'Beast Mastery', 5)], {});
    assert.strictEqual(duty(r, 'hm').player, 'Zbm');
});
test('autoAssign: ranker rows with no talent data keep their spec-guess pick', () => {
    // The degrade-to-today rule: unknown data must reproduce the current behaviour.
    const r = E.autoAssign([lock('Aaffl', 'Affliction', null), lock('Zdestro', 'Destruction', null)], {});
    assert.strictEqual(duty(r, 'coe').player, 'Aaffl');
    assert.strictEqual(duty(r, 'coe').qualifier, 'talent unknown');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: the first four FAIL (without `improvedBy`, spec order and the name tiebreak pick the `A…` player, and no qualifier is set). The fifth fails only on its qualifier assertion (`undefined !== 'talent unknown'`) — the pick itself already behaves. State exactly which assertions failed in your report.

- [ ] **Step 3: Wire the four catalog objects**

In `DEBUFF_CATALOG`:

```js
        { id: 'coe', name: 'Curse of Elements', category: 'debuffs', class: 'WARLOCK', preferSpecs: ['Affliction'], group: 'curse', improvedBy: 'malediction' },
```

```js
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Feral'], improvedBy: 'impFaerieFire' },
```

```js
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'], improvedBy: 'impHuntersMark' },
```

And on the `ap` entry's druid provider:

```js
            { name: 'Demoralizing Roar', class: 'DRUID', preferSpecs: ['Feral'], improvedBy: 'feralAggression' },
```

Leave every other field of those objects exactly as it is (comments included).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: **178 passed, 0 failed** (+5). If any pre-existing test fails, STOP and report which assignment moved — do not adjust the test.

- [ ] **Step 5: Prove the wiring is load-bearing**

On a scratch copy, delete all four `improvedBy` additions at once, run. Expected: the first four new tests fail (the fifth's qualifier assertion also goes back to `undefined` — five failures total is correct; report what you observe). Paste the output, restore.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: rank coe, ff, demo roar and hunter's mark by their real talents"
```

---

### Task 3: Gates — the talent is the spell

**Files:**
- Modify: `assignments-engine.js` (`gateAllows`, `eligible`, `record`, `providersOf`, four catalog entries)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Task 1's keys; `talentRank` from the shipped plan.
- Produces: `gateAllows(p, talentKey, fallbackSpec)` (exported), `requireTalent` honoured on entries and surviving `providersOf`, and gate rows carrying the same `qualifier` improvedBy rows do. Task 4's provider loop and Task 5's blessings rely on the tier semantics being identical to `rankPool`'s.

- [ ] **Step 1: Write the failing tests**

The prior plan's `rogue(name, spec, rank)` helper carries `impExposeArmor`; do not reuse it here.

```js
function mage(name, spec, rank) {
    const p = P(name, 'MAGE', spec);
    if (rank !== null) p.talents = { wintersChill: rank };
    return p;
}
test('autoAssign: winters chill goes to the mage who has the talent, spec notwithstanding', () => {
    // Tree totals said Fire, but they took Winter's Chill; totals were always a guess.
    const r = E.autoAssign([mage('Zfire', 'Fire', 5)], {});
    assert.strictEqual(duty(r, 'wc').player, 'Zfire');
    assert.strictEqual(duty(r, 'wc').qualifier, "Winter's Chill 5/5");
});
test('autoAssign: a frost mage known to lack winters chill does not get the row', () => {
    const r = E.autoAssign([mage('Afrost', 'Frost', 0)], {});
    assert.ok(!duty(r, 'wc') || duty(r, 'wc').player === null);
    assert.ok(r.uncovered.missing.some(u => u.id === 'wc'));
});
test('autoAssign: a frost mage with unknown talents keeps the row, as today', () => {
    const r = E.autoAssign([mage('Afrost', 'Frost', null)], {});
    assert.strictEqual(duty(r, 'wc').player, 'Afrost');
    assert.strictEqual(duty(r, 'wc').qualifier, 'talent unknown');
});
function subrogue(name, spec, rank) {
    const p = P(name, 'ROGUE', spec);
    if (rank !== null) p.talents = { hemorrhage: rank };
    return p;
}
test('autoAssign: a subtlety rogue known to lack hemorrhage files the row notApplicable', () => {
    // The gate and the applicability warning must agree: known-cannot-cast is the same
    // no-noise case as no-subtlety-rogue-at-all, not a "missing" alarm.
    const r = E.autoAssign([subrogue('Astab', 'Subtlety', 0)], {});
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'hemo'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'hemo'));
});
test('autoAssign: a subtlety rogue with unknown talents keeps hemorrhage, as today', () => {
    const r = E.autoAssign([subrogue('Astab', 'Subtlety', null)], {});
    assert.strictEqual(duty(r, 'hemo').player, 'Astab');
});
test('catalog: all four gate rows carry their requireTalent through providersOf', () => {
    // providersOf rebuilds single-class entries from an explicit field allowlist; a field
    // left off that list is silently dropped, and the gate would never fire.
    [['scorch', 'impScorch'], ['wc', 'wintersChill'], ['swarm', 'insectSwarm'], ['hemo', 'hemorrhage']]
        .forEach(pair => {
            const entry = E.DEBUFF_CATALOG.find(e => e.id === pair[0]);
            assert.strictEqual(E.providersOf(entry)[0].requireTalent, pair[1], pair[0]);
        });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: all six FAIL. Test 1 fails because `requireSpec: 'Frost'` excludes the Fire mage; test 2 because the known-0 mage still gets the row; tests 3/5 on their qualifier/pick assertions; test 4 because known-0 files as covered, not notApplicable; test 6 because `requireTalent` does not exist yet.

- [ ] **Step 3: Implement `gateAllows` and wire `eligible`, `record`, `providersOf`**

Add next to `talentRank` (module level, so the catalog's `applicableWhen` closures can reach it):

```js
    // The gate for talents that ARE the spell (Winter's Chill, Hemorrhage, ...): a known
    // rank decides outright — a positive rank can cast regardless of what the tree totals
    // implied, rank 0 cannot cast at all. Only when the scan told us nothing does the old
    // spec proxy get a vote. This is the degrade-to-today rule as one function.
    function gateAllows(p, talentKey, fallbackSpec) {
        const rank = talentRank(p, talentKey);
        if (rank !== null) return rank > 0;
        return !fallbackSpec || p.spec === fallbackSpec;
    }
```

In `eligible()` inside `autoAssign`, replace the single `requireSpec` line:

```js
            if (entry.requireTalent) {
                if (!gateAllows(p, entry.requireTalent, entry.requireSpec)) return false;
            } else if (entry.requireSpec && p.spec !== entry.requireSpec) return false;
```

In `record()`, make the qualifier cover gate rows too — change the condition and key:

```js
            const explainKey = entry.improvedBy || entry.requireTalent;
            if (explainKey && player) {
                const def = TALENTS[explainKey];
                const rank = talentRank(player, explainKey);
                if (def) {
                    if (rank === null) d.qualifier = 'talent unknown';
                    else if (rank === 0) d.qualifier = 'no ' + def.name;
                    else d.qualifier = def.name + ' ' + rank + '/' + def.maxRank;
                }
            }
```

(The `entry.improvedBy && player` comment block above it stays; reword its first line to "An improvedBy or requireTalent row can pick an off-spec player…".)

In `providersOf`, add `requireTalent` to the single-class allowlist:

```js
        return [{ name: entry.name, class: entry.class, preferSpecs: entry.preferSpecs,
                  requireSpec: entry.requireSpec, requireTalent: entry.requireTalent,
                  group: entry.group, caution: entry.caution,
                  improvedBy: entry.improvedBy }];
```

Export `gateAllows` alongside `talentRank` in the module's return object.

- [ ] **Step 4: Wire the four catalog entries**

```js
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire', requireTalent: 'impScorch' },
```

```js
        { id: 'wc', name: "Winter's Chill", category: 'debuffs', class: 'MAGE', requireSpec: 'Frost', requireTalent: 'wintersChill' },
```

```js
        { id: 'swarm', name: 'Insect Swarm', category: 'debuffs', class: 'DRUID', requireSpec: 'Balance', requireTalent: 'insectSwarm' },
```

For `hemo`, add `requireTalent: 'hemorrhage'` and replace its `applicableWhen` so the warning agrees with the gate:

```js
        { id: 'hemo', name: 'Hemorrhage', category: 'debuffs', class: 'ROGUE', requireSpec: 'Subtlety', requireTalent: 'hemorrhage',
          applicableWhen: roster => roster.some(p => p.class === 'ROGUE' && gateAllows(p, 'hemorrhage', 'Subtlety')) },
```

Keep the comment block above `hemo` as-is.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: **184 passed, 0 failed** (+6). If a pre-existing test fails, STOP and report — in particular any `scorch`/`wc`/`swarm`/`hemo` fixture built with `P()` (no talents) must be unaffected, because unknown falls back to `requireSpec`.

- [ ] **Step 6: Prove the gate and the allowlist are load-bearing**

Two mutations on scratch copies, run then discarded, output pasted:

1. In `gateAllows`, change `if (rank !== null) return rank > 0;` to `if (rank !== null) return true;`. Expected: the known-0 tests fail (`a frost mage known to lack winters chill…` and `…files the row notApplicable`).
2. Remove `requireTalent: entry.requireTalent,` from the `providersOf` allowlist. Expected: `winters chill goes to the mage who has the talent` and the wiring test fail — the gate rows are all single-class, so the allowlist is what carries the field.

- [ ] **Step 7: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: gate scorch, wc, swarm and hemo on the talent, not the tree totals"
```

---

### Task 4: A known-untalented provider loses the row

**Files:**
- Modify: `assignments-engine.js` (the provider loop inside `autoAssign`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `talentTier` (module-level, from the shipped plan) and Task 2/3 wiring.
- Produces: provider demotion semantics. No new exports.

- [ ] **Step 1: Write the failing tests**

The shipped `rogue(name, spec, rank)` helper (carrying `impExposeArmor`) is in scope — reuse it, do not redefine it.

```js
test('autoAssign: a rogue known to lack improved expose armor loses armor to sunder', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', 0), P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').player, 'Ztank');
    assert.strictEqual(duty(r, 'armor').name, 'Sunder Armor');
});
test('autoAssign: a rogue with unknown talents keeps armor ahead of sunder, as today', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', null), P('Ztank', 'WARRIOR', 'Protection')], {});
    assert.strictEqual(duty(r, 'armor').player, 'Astab');
    assert.strictEqual(duty(r, 'armor').name, 'Improved Expose Armor');
});
test('autoAssign: a known-untalented rogue still beats an empty armor row', () => {
    const r = E.autoAssign([rogue('Astab', 'Combat', 0)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Astab');
    assert.strictEqual(duty(r, 'armor').qualifier, 'no Improved Expose Armor');
});
test('autoAssign: an ap warrior known to lack imp demo shout loses the row to curse of weakness', () => {
    // THREE locks: coe and cor each burn one via the curse-exclusivity group before the ap
    // row runs, so a third is needed for Curse of Weakness to have an eligible caster.
    function dslock(name) { return P(name, 'WARLOCK', 'Affliction'); }
    const war = P('Awar', 'WARRIOR', 'Arms');
    war.talents = { impDemoShout: 0 };
    const r = E.autoAssign([war, dslock('Block'), dslock('Clock'), dslock('Dlock')], {});
    assert.strictEqual(duty(r, 'ap').name, 'Curse of Weakness');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: tests 1 and 4 FAIL (the rogue/warrior keeps the row today); tests 2 and 3 already pass — they pin the behaviour that must NOT change, and their teeth come from Step 5's mutation, which must not break them.

- [ ] **Step 3: Rework the provider loop**

In `autoAssign`, replace the `for (let i = 0; i < provs.length; i++) { ... }` loop and the `uncovered.missing.push` line that follows it with:

```js
            // A provider whose best candidate is KNOWN to lack the improving talent loses its
            // place in line: pass 1 takes the first provider in catalog order whose best
            // candidate is not tier 2, pass 2 accepts anyone. Unknown data (tier 1) never
            // demotes — a Raid-Helper roster keeps today's order — and a known-untalented
            // candidate still beats an empty row.
            const ranked = [];
            for (let i = 0; i < provs.length; i++) {
                const prov = Object.assign({}, provs[i], { id: entry.id, category: entry.category });
                const pool = rankPool(roster.filter(p => eligible(p, prov)), prov, dutyCount);
                if (pool.length) ranked.push({ prov: prov, pool: pool });
            }
            let pick = null;
            for (let i = 0; i < ranked.length && !pick; i++) {
                if (talentTier(ranked[i].pool[0], ranked[i].prov) !== 2) pick = ranked[i];
            }
            if (!pick && ranked.length) pick = ranked[0];
            if (pick) { record(pick.prov, pick.prov.name, pick.pool[0]); return; }
            uncovered.missing.push({ id: entry.id, name: entry.name });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: **188 passed, 0 failed** (+4). Pre-existing provider tests (armor/ap orderings with talentless fixtures) must be untouched — every candidate there is tier 1 or the row has no `improvedBy`, so pass 1 picks the first provider exactly as the old loop did. A pre-existing failure is a STOP-and-report.

- [ ] **Step 5: Prove the demotion is load-bearing and the pins hold**

On a scratch copy, revert the two-pass pick to first-non-empty (`let pick = ranked.length ? ranked[0] : null;` replacing the pass-1 loop and fallback). Expected: tests 1 and 4 fail; tests 2 and 3 still pass (they don't depend on demotion — that is the point of pinning them). Paste output, restore.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: let a known-untalented provider lose its row to the next one"
```

---

### Task 5: Blessings — the Kings gate and talent-aware plan matching

**Files:**
- Modify: `assignments-engine.js` (`proposeBlessings` and a `blessingTier` helper)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `talentRank`, Task 1's `kings`/`impMight`/`impWisdom` keys.
- Produces: talent-aware plan→paladin matching; two new warning strings (exact text below — the UI renders `warnings` verbatim). `BLESSING_PLANS`, `GREATER_BLESSINGS`, cell keys, and override semantics unchanged.

- [ ] **Step 1: Write the failing tests**

```js
function pala(name, spec, t) {
    const p = P(name, 'PALADIN', spec);
    if (t) p.talents = t;
    return p;
}
test('proposeBlessings: kings goes to the paladin who can actually cast it', () => {
    // Ret sorts first and would take Kings today; they are known-0, the Holy has it.
    const ret = pala('Aret', 'Retribution', { kings: 0, impMight: 5 });
    const holy = pala('Zholy', 'Holy', { kings: 1, impWisdom: 2 });
    const r = E.proposeBlessings([ret, holy, P('Grunt', 'WARRIOR', 'Arms')], {});
    const kingsRow = r.rows.find(row => row.cells.WARRIOR === 'Greater Kings');
    assert.ok(kingsRow, 'no row assigns Greater Kings');
    assert.strictEqual(kingsRow.paladin, 'Zholy');
    // The known-0 Ret slid to the Might/Wisdom plan instead of losing their row.
    const retRow = r.rows.find(row => row.paladin === 'Aret');
    assert.strictEqual(retRow.cells.WARRIOR, 'Greater Might');
});
test('proposeBlessings: when no paladin can cast kings, it is withheld and warned', () => {
    const r = E.proposeBlessings([pala('Aret', 'Retribution', { kings: 0 }),
                                  pala('Zholy', 'Holy', { kings: 0 }),
                                  P('Grunt', 'WARRIOR', 'Arms')], {});
    r.rows.forEach(row => Object.keys(row.cells).forEach(cls => {
        assert.notStrictEqual(row.cells[cls], 'Greater Kings');
    }));
    assert.ok(r.warnings.some(w => /Nobody can cast Blessing of Kings/.test(w)), r.warnings.join('; '));
});
test('proposeBlessings: a manual kings cell on a known-0 paladin warns but is not blocked', () => {
    const r = E.proposeBlessings([pala('Aret', 'Retribution', { kings: 0 }), P('Grunt', 'WARRIOR', 'Arms')],
                                 { 'Aret|WARRIOR': 'Greater Kings' });
    assert.strictEqual(r.rows.find(row => row.paladin === 'Aret').cells.WARRIOR, 'Greater Kings');
    assert.ok(r.warnings.some(w => /Aret cannot cast Blessing of Kings/.test(w)), r.warnings.join('; '));
});
test('proposeBlessings: the might/wisdom row goes to the better-talented paladin', () => {
    // Kings to the Ret (talented). Of the rest, Holy sorts first but is known-0 in both
    // improvements; the Prot has Imp Might — the talent flips the row assignment.
    const ret = pala('Aret', 'Retribution', { kings: 1 });
    const holy = pala('Bholy', 'Holy', { impMight: 0, impWisdom: 0 });
    const prot = pala('Zprot', 'Protection', { impMight: 5 });
    const r = E.proposeBlessings([ret, holy, prot, P('Grunt', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(r.rows.find(row => row.paladin === 'Zprot').cells.WARRIOR, 'Greater Might');
});
test('proposeBlessings: a roster with no talent data reproduces the spec-order grid', () => {
    // The degrade-to-today rule for the grid: with every tier unknown, both sorts are
    // stable and paladin N gets plan N exactly as before this plan.
    const r = E.proposeBlessings([pala('Aret', 'Retribution'), pala('Bholy', 'Holy'),
                                  P('Grunt', 'WARRIOR', 'Arms')], {});
    assert.strictEqual(r.rows.find(row => row.paladin === 'Aret').cells.WARRIOR, 'Greater Kings');
    assert.strictEqual(r.rows.find(row => row.paladin === 'Bholy').cells.WARRIOR, 'Greater Might');
    assert.deepStrictEqual(r.warnings, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: tests 1–4 FAIL (Kings blindly goes to the first-sorted paladin; no warnings exist). Test 5 must already PASS — it pins current behaviour, and its teeth are Step 5's stability check. Say so explicitly in the report.

- [ ] **Step 3: Implement the matching**

Add above `proposeBlessings`:

```js
    // 0 = talented, 1 = unknown, 2 = known-untalented — the same ordering rankPool's tier
    // uses, so the grid and the duty rows cannot disagree about what talent data means.
    function blessingTier(pal, key) {
        const r = talentRank(pal, key);
        return r === null ? 1 : (r > 0 ? 0 : 2);
    }
```

In `proposeBlessings`, replace the block from `const rows = paladins.map((pal, i) => {` through the end of the `rows` assignment, and the `const warnings = [];` line above it, with:

```js
        const warnings = [];

        // Match plans to paladins talent-aware. Kings is a 1-point Protection talent, not a
        // baseline spell: a paladin known not to have it cannot cast it at all, so they are
        // excluded from that plan rather than merely ranked last. With no talent data every
        // tier is 1, every sort below is stable, and paladin N gets plan N exactly as before.
        const planOf = {};
        const unassigned = paladins.slice();
        function takeBest(tierOf, exclude) {
            const pool = exclude ? unassigned.filter(p => tierOf(p) !== 2) : unassigned;
            if (!pool.length) return null;
            const best = pool.slice().sort((a, b) =>
                tierOf(a) - tierOf(b) || paladins.indexOf(a) - paladins.indexOf(b))[0];
            unassigned.splice(unassigned.indexOf(best), 1);
            return best;
        }
        const kingsPal = takeBest(p => blessingTier(p, 'kings'), true);
        if (kingsPal) planOf[kingsPal.name] = 0;
        else if (paladins.length) warnings.push('Nobody can cast Blessing of Kings — it is a Protection talent.');
        const mwPal = takeBest(p => Math.min(blessingTier(p, 'impMight'), blessingTier(p, 'impWisdom')), false);
        if (mwPal) planOf[mwPal.name] = 1;
        const salvPal = takeBest(function () { return 0; }, false);
        if (salvPal) planOf[salvPal.name] = 2;
        unassigned.slice().forEach(p => { planOf[p.name] = 3; });

        const rows = paladins.map(pal => {
            const plan = BLESSING_PLANS[planOf[pal.name]] || BLESSING_PLANS[BLESSING_PLANS.length - 1];
            const cells = {};
            classes.forEach(cls => {
                const key = pal.name + '|' + cls;
                cells[cls] = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : plan(cls, roster);
            });
            return { paladin: pal.name, spec: pal.spec, cells };
        });

        // A manually assigned cell is never blocked (respecs happen, the lead may know
        // better), but a Kings cell on a paladin the scan says cannot cast it deserves the
        // same visibility as a duplicate blessing.
        rows.forEach(r => {
            const pal = paladins.find(p => p.name === r.paladin);
            if (blessingTier(pal, 'kings') === 2
                && classes.some(cls => r.cells[cls] === 'Greater Kings')) {
                warnings.push(r.paladin + ' cannot cast Blessing of Kings (talent not taken).');
            }
        });
```

Delete the old `const warnings = [];` that sat below the rows — and ONLY the declaration. The
`if (!paladins.length && roster.length) warnings.push('No paladin in the raid — no blessings at
all.');` line right after it, and the whole per-class no-blessing/duplicate warning loop below
that, both stay exactly as they are; they now append to the `warnings` declared above the
matching. The function's final `return { classes, rows, warnings };` is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: **193 passed, 0 failed** (+5). **Every pre-existing `proposeBlessings` test uses talentless fixtures and is the byte-identical proof for the degrade-to-today rule** — if any of them fails, the matching is not stable and that is a defect, not a fixture to update. STOP and report.

- [ ] **Step 5: Prove the gate and the ordering are load-bearing**

Two mutations on scratch copies, run then discarded, output pasted:

1. In `takeBest`'s call for Kings, pass `false` instead of `true` (stop excluding known-0). Expected: `when no paladin can cast kings…` fails (Kings gets assigned anyway), and `kings goes to the paladin who can actually cast it` still passes only if tier sorting alone saves it — report exactly which of the two failed.
2. Change `blessingTier` to always return 1. Expected: `kings goes to the paladin who can actually cast it` and `the might/wisdom row goes to the better-talented paladin` fail; the no-talent-data test must still pass (its stability is the point).

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: gate greater kings on the talent and match blessing plans talent-aware"
```

---

### Task 6: Browser verification, end-of-plan mutation sweep, docs

**Files:**
- Modify: `docs/superpowers/BRANCH-STATE.md`
- No production code. If a step here uncovers a defect, STOP and report rather than patching inline.

- [ ] **Step 1: Browser-verify the gates and the Kings grid**

There is no browser tool. Use the CDP driver in the worktree at `.superpowers/tools/cdp.js` (usage: `node cdp.js <url> <script-file>`; `verify-blessings.js` beside it is the better starting point — one Chrome session, `Page.navigate` calls). Start the server with `npm start` (port 3000) if not running. Chrome cold start can exceed two minutes; run as a background task. Never click `Share link`; stub `window.confirm`.

Import (values are synthetic; the tool does not validate point totals against talent legality):

```
RSS3;Zfire:MAGE:0/45/16:1:Human:impScorch=3,wintersChill=5;Afrost:MAGE:0/16/45:1:Human:impScorch=0,wintersChill=0;Aret:PALADIN:0/0/61:2:Human:impSealCrusader=3,kings=0,impMight=5,impWisdom=0;Zholy:PALADIN:61/0/0:2:Human:impSealCrusader=0,kings=1,impMight=0,impWisdom=2
```

Confirm and paste actual observed output for each:
1. The Winter's Chill row is assigned to `Zfire` with `(Winter's Chill 5/5)` beside it — `Afrost` is the on-spec mage and must not have it.
2. The Improved Scorch row is assigned to `Zfire` (`Afrost` is known-0).
3. The blessings grid gives Greater Kings to `Zholy`, not the first-sorted `Aret`; `Aret`'s row carries Might/Wisdom.
4. Re-import with `kings=0` on **both** paladins: no Kings cell anywhere, and the warning `Nobody can cast Blessing of Kings — it is a Protection talent.` renders.
5. Zero console errors and zero page exceptions across all navigations.

- [ ] **Step 2: Re-run the mutation battery against the final tree**

Coverage is not a one-time property on this branch. On scratch copies (each including `RaidSpecScan/` — the parity test reads it), apply, run, record, restore, one at a time:

| # | mutation | must fail (at least) |
|---|---|---|
| 1 | Lua: rename `malediction` → `maledictionX` | the parity test |
| 2 | delete all four Task 2 `improvedBy` additions | the four Task 2 ranker tests |
| 3 | `gateAllows`: known rank always allows | the two known-0 gate tests |
| 4 | drop `requireTalent` from the `providersOf` allowlist | wc-talented + wiring tests |
| 5 | provider loop reverted to first-non-empty | rogue-0-loses-armor + ap-CoW tests |
| 6 | `takeBest(kings)` stops excluding known-0 | the no-paladin-can-cast warning test |
| 7 | `blessingTier` always returns 1 | kings-to-talented + might/wisdom tests |
| 8 | delete the whole talent block from `rankPool` (the shipped six lines) | the six shipped tier tests AND Task 2's ranker tests |
| 9 | delete `preferSpecs` from the `tranq` entry | `tranq shot rotation lists hunters` |

Any survivor is a STOP-and-report. Paste the per-mutation results as a table with real counts.

- [ ] **Step 3: Update BRANCH-STATE.md**

Add plan 8 to the plan table (state its final commit), update HEAD/suite-count/commit-count in section 1, move the resolved items: the `armor`/`ap` cross-provider gap closes (remove the "What is planned next" cross-provider paragraph, replace with whatever is genuinely next), Kings gate now exists. Add to section 5's in-game checklist: verify the 11 new talent names via `/tprobe` (a mismatch reads as permanently `talent unknown`), and check whether `Improved Curse of Weakness` exists in 2.5.x before adding it as a CoW ranker.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/BRANCH-STATE.md
git commit -m "docs: record the talent catalog expansion in BRANCH-STATE"
```

---

## After the plan

In-game, once `RaidSpecScan` 3.1 is installed (prerequisite P1):

1. `/specscan` still exports `RSS3;` and the talent fields now carry the new keys for paladins, mages, warlocks, druids, hunters and rogues present in the raid.
2. `/tprobe`-check the 11 new names and max ranks against real talent panes, one player per class. A misspelled name shows up as a permanently-unknown row, not an error.
3. A paladin without the Kings talent: the grid refuses to auto-assign them Greater Kings; the warning reads correctly when nobody can.
4. Confirm whether **Improved Curse of Weakness** exists in 2.5.x. If yes, report its exact name, ranks and effect to the owner — it becomes a one-line `improvedBy` on the CoW provider in a follow-up commit, not part of this plan.
5. The BRANCH-STATE §5 RSS3 checklist from the previous plan still applies to the reinstall.

## Open questions for the implementer

- **The 11 new talent names are English strings typed from the design doc, not captured from the client.** If a row never sees talent data in-game, check the spelling with `/tprobe target <partial name>` before suspecting the logic — a name that does not match is silently omitted, which reads as unknown. That is the intended, safe degradation.
- **`maxRank` values for `wintersChill` (5) and `impWisdom` (2) are the least certain.** A too-low maxRank makes a legitimate rank read as unknown and appear in `talentDrift` — diagnosable, not silent.
- **The `joc` row deliberately keeps `requireSpec: 'Retribution'` + `improvedBy`** rather than converting to a `requireTalent` gate — see spec decision 3. Do not "fix" it.
- **`talentTier`'s no-`improvedBy` short-circuit is a known equivalent mutant** (documented in BRANCH-STATE §6) — do not use it as a falsifiability probe, and do not file it as a coverage gap.
