# Provider Lists + Expose Armor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one duty row be satisfied by any of several classes, best available first — so Improved Expose Armor can displace Sunder Armor, and the attack-power row can fall through Demo Shout → Curse of Weakness → Demoralizing Roar → Screech.

**Architecture:** Generalizes the existing two-element `fallback` field into an ordered `providers` array on catalog entries. Entries without `providers` are normalized to a single-provider list at read time, so the assignment loop has exactly one code path. `fallback` is deleted. This is a net reduction in engine code.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests via `node assignments-engine.test.js`.

**Depends on:** `2026-08-11-catalog-rules-and-warning-split.md` (needs the `uncovered.missing` shape).

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper.
- **Task 1 is behaviour-preserving.** It is a refactor: every existing test must pass without modification. If a test needs changing in Task 1, the refactor is wrong.
- **Spec is a proxy, never proof.** Talent picks are invisible to the addon. Provider order is a spec-level guess the manual override exists to correct.
- **Override keys change in Task 2** (`sunder` → `armor`, `demo` → `ap`). Saved overrides under the old keys are silently ignored, which just means auto-assign re-picks those two rows once. Acceptable; call it out in the commit message.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Generalize `fallback` into `providers` (pure refactor)

**Files:**
- Modify: `assignments-engine.js:162-174` (catalog), `:219-271` (`autoAssign`), and the module export object
- Modify: `assignments.js:226-232` (`eligibleForDuty`)

**Interfaces:**
- Produces: `providersOf(entry) -> [{ name, class, preferSpecs, requireSpec, group, caution }]`, **exported** from the engine, and catalog entries may carry `providers: [...]`. Tasks 2–4 rely on both, and `assignments.js` uses the export for dropdown eligibility.

- [ ] **Step 1: Confirm the current tests pass before touching anything**

Run: `node assignments-engine.test.js`

Expected: zero failures. This is the baseline the refactor must preserve. If anything already fails, stop and fix that first — do not refactor on a red suite.

- [ ] **Step 2: Add the normalizer**

In `assignments-engine.js`, immediately after the `DEBUFF_CATALOG` array, add:

```js
    // One effect can have several possible providers, best first. Entries that name a single
    // class are just a one-element list, so the assignment loop has one code path rather
    // than a special case for fallbacks. `caution` must ride along here: the assignment loop
    // only ever hands provider-derived objects to record(), so any entry-level field a duty
    // needs to carry has to survive this normalization.
    function providersOf(entry) {
        if (entry.providers) return entry.providers;
        return [{ name: entry.name, class: entry.class, preferSpecs: entry.preferSpecs,
                  requireSpec: entry.requireSpec, group: entry.group, caution: entry.caution }];
    }
```

Add `providersOf` to the module's export object at the bottom of the file, alongside `DEBUFF_CATALOG, PASSIVES, autoAssign` — the UI needs it in Step 5.

- [ ] **Step 3: Convert the `demo` entry to a provider list**

Replace the `demo` entry (currently the last entry, using `fallback`):

```js
        { id: 'demo', name: 'Demoralizing Shout', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'],
          fallback: { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' } },
```

with:

```js
        { id: 'demo', name: 'Demoralizing Shout', category: 'debuffs', providers: [
            { name: 'Demoralizing Shout', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'] },
            { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
        ] },
```

- [ ] **Step 4: Rewrite the catalog loop to walk providers**

In `autoAssign`, replace the whole body of the `DEBUFF_CATALOG.forEach` callback — from the `const o = overrides[entry.id] || {};` line down to and including the final `uncovered.missing.push(...)` — with:

```js
            const o = overrides[entry.id] || {};
            const provs = providersOf(entry);

            if (o.player && byName[o.player]) {
                const chosen = byName[o.player];
                // Honour the override even for an off-list class: fall back to the first
                // provider's label rather than dropping the assignment on the floor.
                const prov = provs.find(pr => pr.class === chosen.class) || provs[0];
                record(Object.assign({}, prov, { id: entry.id, category: entry.category }), prov.name, chosen);
                return;
            }
            if (isExplicitlyUnassigned(o)) {
                record(entry, entry.name, null);
                uncovered.missing.push({ id: entry.id, name: entry.name });
                return;
            }
            for (let i = 0; i < provs.length; i++) {
                const prov = Object.assign({}, provs[i], { id: entry.id, category: entry.category });
                const pool = rankPool(roster.filter(p => eligible(p, prov)), prov, dutyCount);
                if (pool.length) { record(prov, prov.name, pool[0]); return; }
            }
            uncovered.missing.push({ id: entry.id, name: entry.name });
```

Keep the `minClassCount` and `applicableWhen` guards above this untouched.

- [ ] **Step 5: Point the UI's dropdown eligibility at the provider list**

`eligibleForDuty` in `assignments.js` still filters on `entry.class` and the now-deleted `entry.fallback`. For a provider-list entry both are `undefined`, so its dropdown would offer nobody — making manual override impossible on exactly the rows whose provider order is a guess. Replace the function (`assignments.js:226-232`):

```js
function eligibleForDuty(dutyId) {
    if (dutyId.startsWith('innervate:')) return roster.filter(p => p.class === 'DRUID');
    if (dutyId.startsWith('soulstone:')) return roster.filter(p => p.class === 'WARLOCK');
    const entry = E.DEBUFF_CATALOG.find(e => e.id === dutyId);
    if (!entry) return roster;
    const classes = E.providersOf(entry).map(pr => pr.class);
    return roster.filter(p => classes.indexOf(p.class) !== -1);
}
```

This is behaviour-preserving too: for single-class entries the provider list is exactly `[entry.class]`, and for the old `demo` entry the fallback class is now the second provider.

- [ ] **Step 6: Run the tests — every one must pass unmodified**

Run: `node assignments-engine.test.js`

Expected: zero failures, with **no test edits**. In particular `autoAssign: no warriors falls back demo shout to Curse of Weakness` must still pass — that test is the proof the refactor preserved behaviour.

- [ ] **Step 7: Commit**

```bash
git add assignments-engine.js assignments.js
git commit -m "refactor: generalize duty fallback into an ordered provider list"
```

---

### Task 2: Improved Expose Armor as a provider of the armor row

**Files:**
- Modify: `assignments-engine.js` (`sunder` entry)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `providers` from Task 1.
- Produces: duty id `armor` replaces `sunder`.

- [ ] **Step 1: Write the failing tests**

In `assignments-engine.test.js`, the test `autoAssign: full comp covers all core debuffs with right players` asserts on `duty(r, 'sunder')`. Change that line to:

```js
    assert.strictEqual(duty(r, 'armor').player, 'Stabby');   // rogue expose outranks warrior sunder
```

The tests `explicitly-unassigned debuff keeps its row`, `no override at all still auto-assigns`, and `re-assigning after an explicit unassignment` all key on `sunder`. Change every `'sunder'` string in them to `'armor'`. In `no override at all still auto-assigns`, the auto-pick changes, so its expected player becomes `'Stabby'`. In `re-assigning after an explicit unassignment` the override *names* Thunderfist, so the expectation must **stay** Thunderfist — the point of the test is that the override is honoured. Replace that test wholesale to avoid any half-edit:

```js
test('autoAssign: re-assigning after an explicit unassignment escapes the dead end', () => {
    const cleared = E.autoAssign(fullRoster(), { armor: { player: null } });
    assert.strictEqual(duty(cleared, 'armor').player, null);
    const reassigned = E.autoAssign(fullRoster(), { armor: { player: 'Thunderfist' } });
    assert.strictEqual(duty(reassigned, 'armor').player, 'Thunderfist');
    assert.strictEqual(duty(reassigned, 'armor').name, 'Sunder Armor'); // warrior override picks the warrior provider's label
    assert.ok(!reassigned.uncovered.missing.some(u => u.id === 'armor'));
});
```

In `no warriors falls back demo shout to Curse of Weakness`, the line `assert.ok(r.uncovered.missing.some(u => u.id === 'sunder'))` is now wrong twice over — the id changed, and the roster still has a rogue, so armor is covered. Replace it with:

```js
    assert.strictEqual(duty(r, 'armor').player, 'Stabby'); // rogue still covers armor with no warriors
```

Append two new tests above the final `console.log`:

```js
test('autoAssign: armor falls back to a warrior when there is no rogue', () => {
    const roster = fullRoster().filter(p => p.class !== 'ROGUE');
    const r = E.autoAssign(roster, {});
    const armor = duty(r, 'armor');
    assert.strictEqual(armor.name, 'Sunder Armor');
    assert.strictEqual(armor.player, 'Thunderfist'); // prot preferred
});
test('autoAssign: armor row is missing only when neither rogue nor warrior is present', () => {
    const roster = fullRoster().filter(p => p.class !== 'ROGUE' && p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    assert.ok(!duty(r, 'armor'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'armor'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAILs on every `armor` reference — no such duty id exists yet.

- [ ] **Step 3: Replace the `sunder` entry**

Make it the first entry of `DEBUFF_CATALOG`:

```js
        // Expose blocks Sunder outright ("A more powerful spell is already active"), so this
        // is one row with two providers, not two rows that cancel. Improved Expose Armor is
        // 3075 armor against a maxed Sunder stack's 2600 — worth roughly 3.5% raid physical.
        { id: 'armor', name: 'Major armor reduction', category: 'debuffs', providers: [
            { name: 'Improved Expose Armor', class: 'ROGUE', preferSpecs: ['Subtlety', 'Combat'] },
            { name: 'Sunder Armor', class: 'WARRIOR', preferSpecs: ['Protection'] },
        ] },
```

Faerie Fire and Curse of Recklessness stack with this and stay their own rows — do not touch them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: improved expose armor displaces sunder on the armor row

Duty id sunder -> armor. Saved overrides under the old key are ignored,
so that one row re-picks itself on next auto-assign."
```

---

### Task 3: Demoralizing Roar and Screech as attack-power providers

**Files:**
- Modify: `assignments-engine.js` (`demo` entry)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `providers` from Task 1.
- Produces: duty id `ap` replaces `demo`.

- [ ] **Step 1: Write the failing tests**

Change every `'demo'` duty id in existing tests to `'ap'` — in `full comp covers all core debuffs` (`duty(r, 'ap').player` still expects `'Smashy'`), and in `no warriors falls back demo shout to Curse of Weakness` (the `duty(r, 'demo')` lookup and the `['coe', 'cor', 'demo']` array both become `'ap'`).

Append above the final `console.log`:

```js
test('autoAssign: attack power falls through to a feral druid, then a hunter', () => {
    const noWarNoLock = [P('Clawz', 'DRUID', 'Feral'), P('Legolass', 'HUNTER', 'Marksmanship')];
    const r = E.autoAssign(noWarNoLock, {});
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
    assert.strictEqual(duty(r, 'ap').player, 'Clawz');

    const hunterOnly = E.autoAssign([P('Legolass', 'HUNTER', 'Marksmanship')], {});
    assert.strictEqual(duty(hunterOnly, 'ap').name, 'Screech (pet)');
    assert.strictEqual(duty(hunterOnly, 'ap').player, 'Legolass');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAILs on the `ap` id and on the two new providers.

- [ ] **Step 3: Extend the entry**

Replace the `demo` entry built in Task 1 with:

```js
        // Strongest applies, they do not stack. Talented, Demo Shout and CoW tie at -420;
        // untalented, CoW (-350) actually beats Demo Shout (-300). Talent picks are invisible
        // to the addon, so this order is a spec-level guess the override exists to correct.
        { id: 'ap', name: 'Attack power reduction', category: 'debuffs', providers: [
            { name: 'Demoralizing Shout', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'] },
            { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
            { name: 'Demoralizing Roar', class: 'DRUID', preferSpecs: ['Feral'] },
            { name: 'Screech (pet)', class: 'HUNTER', preferSpecs: ['Beast Mastery'] },
        ] },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. Sanity-check one interaction in the output: with the full roster, `ap` takes Smashy (warrior) and the warlocks stay free for their curses — Curse of Weakness must not steal a curse slot while a warrior is available.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: demoralizing roar and screech as attack-power providers"
```

---

### Task 4: Surface the Curse of Recklessness caution

**Files:**
- Modify: `assignments-engine.js` (`cor` entry, `dutyRow` consumers)
- Modify: `assignments.js:240-279` (`dutyRow`)
- Modify: `assignments.css`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: optional `caution` string on a catalog entry, copied onto the recorded duty.

Note: a per-boss opt-out is **not** needed — clearing the row is already an override the UI supports. This task only surfaces *why* you might clear it.

- [ ] **Step 1: Write the failing test**

Append above the final `console.log`:

```js
test('autoAssign: curse of recklessness carries its tank caution onto the duty', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.ok(/\+136 melee AP/.test(duty(r, 'cor').caution));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node assignments-engine.test.js`

Expected: FAIL — `caution` is `undefined`.

- [ ] **Step 3: Add the field and carry it through `record`**

In the `cor` catalog entry, add the field:

```js
        { id: 'cor', name: 'Curse of Recklessness', category: 'debuffs', class: 'WARLOCK', preferSpecs: [], group: 'curse',
          caution: '−800 armor but +136 melee AP on the boss. Clear this row on enrage or AP-scaling fights.' },
```

In `record`, after the line that builds `d`, add:

```js
            if (entry.caution) d.caution = entry.caution;
```

This works because Task 1's `providersOf` copies `caution` onto the normalized provider object — on the assignment paths, `record`'s `entry` parameter is always a provider-derived object, never the raw catalog entry. If this test fails with `caution` undefined, check that `providersOf` still carries the field before touching anything else.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Render it**

In `assignments.js`, inside `dutyRow`, immediately before `return row;` at the end of the function, add:

```js
    if (d.caution) {
        const note = document.createElement('span');
        note.className = 'duty-caution';
        note.title = d.caution;
        note.textContent = 'ⓘ';
        row.appendChild(note);
    }
```

In `assignments.css`, append:

```css
.duty-caution { cursor: help; opacity: 0.7; font-size: 0.9em; }
```

- [ ] **Step 6: Verify in the browser**

Run `npm start`, open `http://localhost:3000`, and import:

```
RSS1;Thunderfist:WARRIOR:5/6/50;Smashy:WARRIOR:33/28/0;Bob:WARLOCK:43/0/18;Grimshade:WARLOCK:0/21/40;Stabby:ROGUE:15/41/5;Clawz:DRUID:0/47/14;Legolass:HUNTER:0/41/20
```

Confirm the Curse of Recklessness row shows an ⓘ whose tooltip reads the caution text. Then open the **Major armor reduction** and **Attack power reduction** dropdowns and confirm each lists players of every provider class (rogue *and* warriors; warriors, warlocks, the feral druid *and* the hunter) — this exercises the `eligibleForDuty` change from Task 1, which had no browser step of its own. Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js assignments.css
git commit -m "feat: surface the curse of recklessness tank caution on its row"
```

---

## Open questions for the implementer

- **Screech is a pet ability**, so "assigning" it to a hunter means assigning it to their pet — and only a Beast Mastery hunter reliably has a screeching pet family up. If this proves noisy in practice, drop the Screech provider; it is the weakest of the four by a wide margin (−209, and only 4 seconds).
- **Improved Expose Armor is a 2-point Subtlety talent**, which most Combat rogues do not take. Preferring `Subtlety` then `Combat` is the best proxy available, but a Combat rogue assigned this row may be applying *unimproved* Expose Armor (2050), which is **worse** than a maxed Sunder stack. If the raid hits this, the fix is to make the rogue provider `requireSpec: 'Subtlety'` so it cleanly falls through to the warrior instead.
