# Catalog Rules + Warning Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the four TBC-wrong provider rules in the debuff catalog, and split the `uncovered` warning list into "missing" (a real gap) versus "not applicable" (this comp simply can't have it), so the tool stops crying wolf.

**Architecture:** All logic stays in `assignments-engine.js`, the existing UMD-wrapped pure module. `autoAssign`'s return shape changes, so its three consumers (`assignments.js`, `assignments-view.html`, and `buildDiscord` inside the engine itself) update in the same task that changes it. Catalog entries gain an optional `applicableWhen(roster)` predicate, which replaces the body-counting `minClassCount`.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests are a hand-rolled harness in `assignments-engine.test.js` using `node:assert`, run with `node assignments-engine.test.js`.

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper in `assignments-engine.js`. No `import`/`export`, no JSX, no transpilation.
- **The existing flow must keep working end to end.** An `RSS1` addon export must keep parsing to an identical roster. This plan *does* deliberately change some assignment results — that is the point — but the parse and the import→assign→output pipeline are frozen.
- **Share-link back-compat.** Sheets serialized before this change carry `uncovered` as a flat array. `assignments-view.html` must render both the old flat shape and the new object shape.
- **Spec is a proxy, never proof.** The addon reports talent tab totals only (`41/20/0`), never individual picks. Rules keyed on spec are guesses that the manual override exists to correct. Do not add UI copy implying certainty.
- **All work on branch `debuff-coverage`.** Railway deploys `main`; `main` must stay deployable.
- **Test command:** `node assignments-engine.test.js` — prints `N passed, M failed` and exits non-zero on failure.

---

### Task 1: Pin the RSS1 parse regression fixture

The safety net for everything that follows. `parseAddonExport` must not drift while the catalog changes around it.

**Files:**
- Modify: `assignments-engine.test.js` (append before the final `console.log` summary block at the end of file)

**Interfaces:**
- Consumes: `E.parseAddonExport(text) -> { players, errors }`, where each player is `{ name, class, spec, flags, source }`
- Produces: nothing later tasks depend on. This is a guard.

- [ ] **Step 1: Write the failing test**

Append to `assignments-engine.test.js`, immediately above the final `console.log` line:

```js
test('RSS1 regression: a full raid export parses to exactly this roster', () => {
    const text = 'RSS1;Thunderfist:WARRIOR:5/6/50;Smashy:WARRIOR:33/28/0;' +
        'Bob:WARLOCK:43/0/18;Grimshade:WARLOCK:0/21/40;' +
        'Retdin:PALADIN:0/0/61;Lightbringer:PALADIN:47/14/0;' +
        'Frostina:MAGE:0/48/13;Moonpie:DRUID:43/18/0;Mystery:HUNTER:?';
    const r = E.parseAddonExport(text);
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(r.players, [
        { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon' },
        { name: 'Smashy', class: 'WARRIOR', spec: 'Arms', flags: [], source: 'addon' },
        { name: 'Bob', class: 'WARLOCK', spec: 'Affliction', flags: [], source: 'addon' },
        { name: 'Grimshade', class: 'WARLOCK', spec: 'Destruction', flags: [], source: 'addon' },
        { name: 'Retdin', class: 'PALADIN', spec: 'Retribution', flags: [], source: 'addon' },
        { name: 'Lightbringer', class: 'PALADIN', spec: 'Holy', flags: [], source: 'addon' },
        { name: 'Frostina', class: 'MAGE', spec: 'Fire', flags: [], source: 'addon' },
        { name: 'Moonpie', class: 'DRUID', spec: 'Balance', flags: [], source: 'addon' },
        { name: 'Mystery', class: 'HUNTER', spec: null, flags: ['spec-unknown'], source: 'addon' },
    ]);
});
```

- [ ] **Step 2: Run it and read the output carefully**

Run: `node assignments-engine.test.js`

This test asserts current behaviour, so it may already pass. If it **fails**, do not change `parseAddonExport` — the fixture's expected values are wrong. Read the actual output, confirm the real behaviour is sensible, and correct the fixture to match. Specifically: `Smashy:WARRIOR:33/28/0` reaches the 31-point threshold with no tie, so the parser infers Arms with **no** ambiguity flag — the fixture expects `flags: []`. If the run disagrees, trust the run and fix the fixture.

Expected once correct: `PASS`, and the summary line reports zero failures.

- [ ] **Step 3: Commit**

```bash
git add assignments-engine.test.js
git commit -m "test: pin RSS1 parse output as a regression fixture"
```

---

### Task 2: Split `uncovered` into missing vs notApplicable

**Files:**
- Modify: `assignments-engine.js:219-315` (`autoAssign`)
- Modify: `assignments-engine.test.js` (three existing tests + two new)

**Interfaces:**
- Consumes: `DEBUFF_CATALOG` entries as they exist today.
- Produces: `autoAssign(roster, overrides)` now returns
  `{ duties, uncovered: { missing: [{id, name}], notApplicable: [{id, name}] }, passives }`.
  Catalog entries may carry `applicableWhen(roster) -> boolean`. Tasks 4 and 5 rely on both.

- [ ] **Step 1: Write the failing tests**

In `assignments-engine.test.js`, replace the three existing tests that read `uncovered` as an array. Find and replace each in place:

Replace `test('autoAssign: no paladins puts judgements in uncovered, joc omitted', ...)` with:

```js
test('autoAssign: no paladins puts judgements in missing, joc is not applicable', () => {
    const roster = fullRoster().filter(p => p.class !== 'PALADIN');
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.missing.some(u => u.id === 'jow'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'jol'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
    assert.ok(!duty(r, 'joc'));
});
```

Replace `test('autoAssign: only 2 paladins means no joc row at all', ...)` with:

```js
test('autoAssign: only 2 paladins puts joc in notApplicable, not missing', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.ok(!duty(r, 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
});
```

Replace `test('autoAssign: empty roster gives all core debuffs uncovered', ...)` with:

```js
test('autoAssign: empty roster puts all core debuffs in missing', () => {
    const r = E.autoAssign([], {});
    assert.strictEqual(r.duties.length, 0);
    assert.ok(r.uncovered.missing.length >= 8);
});
```

Then update the remaining six assertions that call `.uncovered.some(...)` or `.uncovered.length` — in the tests named `full comp covers all core debuffs`, `no warriors falls back demo shout`, `spec-unknown players are never auto-picked`, `explicitly-unassigned debuff keeps its row`, `no override at all still auto-assigns the debuff normally`, and `re-assigning after an explicit unassignment` — changing each `r.uncovered` to `r.uncovered.missing`. For `full comp`, `assert.strictEqual(r.uncovered.length, 0)` becomes:

```js
    assert.strictEqual(r.uncovered.missing.length, 0);
```

Finally add two new tests immediately after them:

```js
test('autoAssign: an explicitly cleared row counts as missing, not notApplicable', () => {
    const r = E.autoAssign(fullRoster(), { sunder: { player: null } });
    assert.ok(r.uncovered.missing.some(u => u.id === 'sunder'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'sunder'));
});
test('autoAssign: applicableWhen false skips the entry as notApplicable', () => {
    // No shipped entry uses applicableWhen until Task 4, so exercise the mechanism with a
    // temporary catalog entry. DEBUFF_CATALOG is exported by reference, so push/pop works.
    E.DEBUFF_CATALOG.push({ id: 'testonly', name: 'Test Only', category: 'debuffs',
        class: 'MAGE', preferSpecs: [], applicableWhen: () => false });
    try {
        const r = E.autoAssign(fullRoster(), {});
        assert.ok(!duty(r, 'testonly'));
        assert.ok(r.uncovered.notApplicable.some(u => u.id === 'testonly'));
        assert.ok(!r.uncovered.missing.some(u => u.id === 'testonly'));
    } finally {
        E.DEBUFF_CATALOG.pop();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: multiple FAILs reading `Cannot read properties of undefined (reading 'some')` or similar, because `uncovered` is still an array.

- [ ] **Step 3: Change the engine**

In `assignments-engine.js`, inside `autoAssign`, replace line 222:

```js
        const uncovered = [];
```

with:

```js
        // missing = the raid wants this and nobody can provide it. notApplicable = this
        // comp cannot have it at all, so warning about it would be noise.
        const uncovered = { missing: [], notApplicable: [] };
```

Replace the `DEBUFF_CATALOG.forEach` guard on line 253:

```js
            if (entry.minClassCount && roster.filter(p => p.class === entry.class).length < entry.minClassCount) return;
```

with:

```js
            if (entry.minClassCount && roster.filter(p => p.class === entry.class).length < entry.minClassCount) {
                uncovered.notApplicable.push({ id: entry.id, name: entry.name });
                return;
            }
            if (entry.applicableWhen && !entry.applicableWhen(roster)) {
                uncovered.notApplicable.push({ id: entry.id, name: entry.name });
                return;
            }
```

Replace the two `uncovered.push(...)` calls on lines 262 and 270 with `uncovered.missing.push(...)`. Line 262 becomes:

```js
            if (isExplicitlyUnassigned(o)) { record(entry, entry.name, null); uncovered.missing.push({ id: entry.id, name: entry.name }); return; }
```

and line 270 becomes:

```js
            uncovered.missing.push({ id: entry.id, name: entry.name });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: PASS for every `autoAssign` test. The `buildDiscord` tests at the end of the file may now fail — that is expected and is fixed in Task 3. If only `buildDiscord` tests fail, continue.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: split uncovered into missing and notApplicable"
```

---

### Task 3: Update the three consumers of `uncovered`

**Files:**
- Modify: `assignments-engine.js:351-352` (`buildDiscord`)
- Modify: `assignments.js:335-341`
- Modify: `assignments-view.html:71-75`
- Modify: `assignments-engine.test.js` (one new test)

**Interfaces:**
- Consumes: the `{ missing, notApplicable }` shape from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `assignments-engine.test.js`, above the final `console.log`:

```js
test('buildDiscord warns about missing only, and tolerates a legacy flat uncovered', () => {
    const roster = fullRoster();
    const sheet = E.autoAssign(roster, {});
    sheet.uncovered = { missing: [{ id: 'coe', name: 'Curse of Elements' }],
                        notApplicable: [{ id: 'joc', name: 'Judgement of the Crusader' }] };
    const out = E.buildDiscord(roster, sheet, {});
    assert.ok(out.includes('Curse of Elements'));
    assert.ok(!out.includes('Judgement of the Crusader'));

    const legacy = E.autoAssign(roster, {});
    legacy.uncovered = [{ id: 'coe', name: 'Curse of Elements' }];
    assert.ok(E.buildDiscord(roster, legacy, {}).includes('Curse of Elements'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node assignments-engine.test.js`

Expected: FAIL — `buildDiscord` still calls `sheet.uncovered.length`, which is `undefined` on the object shape, so nothing renders and the first assertion fails.

- [ ] **Step 3: Add a shared normalizer and use it in all three consumers**

In `assignments-engine.js`, add this function immediately above `buildDiscord` (which starts at line 324):

```js
    // Sheets serialized before the missing/notApplicable split carry a flat array. Share
    // links outlive deploys, so both shapes have to render.
    function missingList(uncovered) {
        if (!uncovered) return [];
        return Array.isArray(uncovered) ? uncovered : (uncovered.missing || []);
    }
```

Replace lines 351-352 in `buildDiscord`:

```js
        if (sheet.uncovered && sheet.uncovered.length) {
            lines.push('⚠ **Uncovered:** ' + sheet.uncovered.map(u => u.name).join(', '));
```

with:

```js
        const missing = missingList(sheet.uncovered);
        if (missing.length) {
            lines.push('⚠ **Uncovered:** ' + missing.map(u => u.name).join(', '));
```

Add `missingList` to the module's export object at line 427, alongside `DEBUFF_CATALOG, PASSIVES, autoAssign`:

```js
        DEBUFF_CATALOG, PASSIVES, autoAssign, missingList,
```

In `assignments.js`, replace lines 336-338:

```js
    if (sheet.uncovered.length && roster.length) {
        uncoveredBox.classList.remove('hidden');
        uncoveredBox.textContent = '⚠ Uncovered: ' + sheet.uncovered.map(u => u.name).join(', ');
```

with:

Note both files already alias the engine as `E` at the top (`const E = AssignmentsEngine;`), so call `E.missingList`, not `AssignmentsEngine.missingList`.

```js
    const missing = E.missingList(sheet.uncovered);
    if (missing.length && roster.length) {
        uncoveredBox.classList.remove('hidden');
        uncoveredBox.textContent = '⚠ Uncovered: ' + missing.map(u => u.name).join(', ');
```

In `assignments-view.html`, replace lines 71-74:

```js
            if (sheet.uncovered && sheet.uncovered.length) {
                const u = document.getElementById('uncoveredBox');
```

with:

```js
            const missing = E.missingList(sheet.uncovered);
            if (missing.length) {
                const u = document.getElementById('uncoveredBox');
```

and the `textContent` line below it, changing `sheet.uncovered.map` to `missing.map`. Keep the surrounding lines (`u.classList.remove('hidden')` and whatever follows) untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: PASS, zero failures reported in the summary line.

- [ ] **Step 5: Verify the two browser consumers by hand**

Run: `npm start`, open `http://localhost:3000`, paste this into the addon-export box and click auto-assign:

```
RSS1;Thunderfist:WARRIOR:5/6/50;Bob:WARLOCK:43/0/18;Retdin:PALADIN:0/0/61
```

Expected: the page renders, and the uncovered warning lists real gaps (Improved Scorch, Faerie Fire, Hunter's Mark) without throwing. Open the browser console and confirm there are no errors. Then generate a share link and open it — the view page must render the same warning.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js assignments-view.html
git commit -m "fix: render only real gaps in the uncovered warning, tolerate legacy sheets"
```

---

### Task 4: Correct the paladin judgement rules

**Files:**
- Modify: `assignments-engine.js:166-168` (`jow`, `jol`, `joc` catalog entries)
- Modify: `assignments-engine.test.js` (two existing tests + two new)

**Interfaces:**
- Consumes: `applicableWhen(roster)` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

In `assignments-engine.test.js`, the test `autoAssign: full comp covers all core debuffs with right players` asserts `duty(r, 'jow').player === 'Retdin'`. Retdin is the Retribution paladin, and that preference is exactly what this task inverts. Change those two lines:

```js
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer'); // holy/prot judge, ret keeps its damage seal
    assert.strictEqual(duty(r, 'jol').player, 'Bubbles');
```

Task 2 wrote `autoAssign: only 2 paladins puts joc in notApplicable, not missing` against the old `minClassCount` rule. Under the new rule, two paladins *including* a Ret can and should cover JoC — the Ret takes it, and the third judgement (`jol`) is what goes missing. Replace that whole test with:

```js
test('autoAssign: with two paladins including a ret, joc is covered and jol goes missing', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
    assert.strictEqual(duty(r, 'jow').player, 'Lightbringer');
    assert.ok(r.uncovered.missing.some(u => u.id === 'jol'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'joc'));
});
```

Then append two new tests above the final `console.log`:

```js
test('autoAssign: judgement of the crusader requires a ret paladin, not three paladins', () => {
    const noRet = fullRoster().filter(p => p.name !== 'Retdin');
    const r = E.autoAssign(noRet, {});
    assert.ok(!duty(r, 'joc'));
    assert.ok(r.uncovered.notApplicable.some(u => u.id === 'joc'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'joc'));
});
test('autoAssign: a lone ret paladin is enough for judgement of the crusader', () => {
    const roster = [P('Retdin', 'PALADIN', 'Retribution')];
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'joc').player, 'Retdin');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on `jow` (still picks Retdin), FAIL on the lone-ret test (`joc` is gated behind three paladins, so no duty exists and reading `.player` throws), and FAIL on the rewritten two-paladin test (same gate). The no-ret test **already passes** — under the old rule two paladins land `joc` in notApplicable via `minClassCount`, which is coincidentally the same verdict. That is fine: this test exists to lock in the *reason* after the change, not to fail before it.

- [ ] **Step 3: Change the catalog**

In `assignments-engine.js`, replace lines 166-168:

```js
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Retribution'], group: 'judgement' },
        { id: 'jol', name: 'Judgement of Light', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', preferSpecs: [], group: 'judgement', minClassCount: 3 },
```

with — **note `joc` moves to the front of the three.** The `judgement` group is one-per-paladin and the catalog is processed in order, so if `jow` ran first it would consume a lone Ret (any paladin is eligible at rank 99) and leave `joc` uncoverable. Putting `joc` first reserves the Ret for the one judgement only a Ret can provide:

```js
        // The value here is Improved Seal of the Crusader (Ret tier 2): +3% crit to all
        // attacks on the target. Untalented it is worth nothing, so one Ret beats three bodies.
        // Ordered before jow/jol: judgements are one-per-paladin, so the Ret must be claimed
        // for JoC before the generic judgements can swallow them.
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', requireSpec: 'Retribution', group: 'judgement',
          applicableWhen: roster => roster.some(p => p.class === 'PALADIN' && p.spec === 'Retribution') },
        // Ret keeps Seal of Blood/Command for its own damage; the support paladins judge at
        // pull, and any Ret's Crusader Strike then refreshes every paladin's judgement.
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        { id: 'jol', name: 'Judgement of Light', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: PASS, zero failures.

Note the interaction to sanity-check in the output: with the full roster, `joc` runs first and takes Retdin, then `jow` takes Lightbringer (Holy ranks first) and `jol` falls to Bubbles because `group: 'judgement'` blocks Lightbringer from a second judgement. That is the intended result — verify it rather than assuming it.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: TBC judgement rules — support paladins judge, JoC needs a ret"
```

---

### Task 5: Correct the druid and mage rules

**Files:**
- Modify: `assignments-engine.js:162-174` (`ff` and `scorch` entries, catalog order)
- Modify: `assignments-engine.js:194-202` (`PASSIVES` — remove Winter's Chill)
- Modify: `assignments-engine.test.js` (one existing test + three new)

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the catalog shape.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

In `assignments-engine.test.js`, the test `autoAssign: passives detected from comp` asserts Winter's Chill is a passive. Remove that one line:

```js
    assert.ok(r.passives.some(p => p.name === "Winter's Chill" && p.player === 'Sheepmaster'));
```

Append three new tests above the final `console.log`:

```js
test('autoAssign: faerie fire prefers balance, then feral, then resto', () => {
    const balance = E.autoAssign([P('Moonpie', 'DRUID', 'Balance'), P('Clawz', 'DRUID', 'Feral'), P('Treebeard', 'DRUID', 'Restoration')], {});
    assert.strictEqual(duty(balance, 'ff').player, 'Moonpie');
    const noBalance = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Clawz', 'DRUID', 'Feral')], {});
    assert.strictEqual(duty(noBalance, 'ff').player, 'Clawz');
    const restoOnly = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration')], {});
    assert.strictEqual(duty(restoOnly, 'ff').player, 'Treebeard');
});
test("autoAssign: winter's chill is an assigned duty for a frost mage, not a passive", () => {
    const r = E.autoAssign([P('Sheepmaster', 'MAGE', 'Frost')], {});
    assert.strictEqual(duty(r, 'wc').player, 'Sheepmaster');
    assert.ok(!r.passives.some(p => p.name === "Winter's Chill"));
});
test("autoAssign: winter's chill needs a frost mage specifically", () => {
    const r = E.autoAssign([P('Frostina', 'MAGE', 'Fire')], {});
    assert.ok(!duty(r, 'wc'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'wc'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the Feral-over-Resto case (both rank 99 today, so the alphabetical tiebreak picks Clawz — this may *accidentally* pass; if so, temporarily rename the resto druid to `Aardvark` to prove the test is real, confirm it fails, then rename it back to `Treebeard`). FAIL on both Winter's Chill tests — there is no `wc` entry yet.

- [ ] **Step 3: Change the catalog**

In `assignments-engine.js`, replace the `ff` entry on line 170:

```js
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance'] },
```

with:

```js
        // Improved Faerie Fire (+3% melee/ranged hit) is Balance-only, but the 610 armor
        // applies regardless — so keep the duty and rank Feral above Resto, who would
        // otherwise spend a GCD and mana they would rather heal with.
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Feral'] },
```

Move the `scorch` entry so it sits *after* `hm` in the array, and add `wc` after it. The tail of `DEBUFF_CATALOG` becomes:

```js
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Feral'] },
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'] },
        // Fire Vulnerability is +3% fire damage taken per stack, not spell crit (that is
        // WotLK), and the fire mage maintains it through their own rotation. Low priority.
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire' },
        // A maintained 5-stack debuff, not passive coverage. +2% frost crit per stack.
        // Does not conflict with Improved Scorch — different schools entirely.
        { id: 'wc', name: "Winter's Chill", category: 'debuffs', class: 'MAGE', requireSpec: 'Frost' },
        { id: 'demo', name: 'Demoralizing Shout', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'],
          fallback: { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' } },
```

Delete the original `scorch` line from its old position between `jol` and `ff` (after Task 4's reorder the judgement block ends with `jol`).

Then remove the Winter's Chill line from `PASSIVES` (line 201):

```js
        { name: "Winter's Chill", class: 'MAGE', spec: 'Frost' },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: PASS, zero failures. Confirm the `empty roster` test still reports `missing.length >= 8` — it should now be one higher than before, since `wc` joined the catalog.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: faerie fire spec order, deprioritize scorch, make winter's chill assignable"
```

---

## Open questions for the implementer

Two rules in this plan rest on claims that were not fully verified. Neither blocks implementation, but flag them if you find contradicting evidence:

- **Faerie Fire (Feral) as a TBC Feral talent** is the reason Feral outranks Resto on `ff`. If it turns out a Feral druid cannot cast Faerie Fire in form in 2.5.x, the ranking should collapse back to `['Balance']` and the Feral/Resto order becomes arbitrary again.
- **Which paladin should hold `jol`** is a judgement call, not a researched result. Judgement of Light is situational — worth having in a melee-heavy comp, close to worthless otherwise. If the raid finds it noisy, an `applicableWhen` keyed on melee count would be the follow-up.
