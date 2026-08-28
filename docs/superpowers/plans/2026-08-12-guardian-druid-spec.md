# Guardian as a First-Class Druid Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a feral druid be marked as a tank (Guardian) rather than a cat, so the group proposer stops putting bear tanks in the melee group and the raid lead can correct it by hand when the roster is imported.

**Architecture:** Talent tab totals cannot distinguish bear from cat — both are the same tree — so Guardian can only ever arrive from a human: the manual player form, or Raid-Helper, which already sends `Guardian` as a signup spec and which the engine currently throws away. `SPEC_TREES` keeps its tab-position meaning and is left alone; a parallel `SELECTABLE_SPECS` adds Guardian for the dropdown. For every *ability* purpose Guardian is Feral (bears cast Faerie Fire, Demoralizing Roar and give Leader of the Pack); it differs only in group role.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests via `node assignments-engine.test.js`.

**Depends on:** `2026-08-11-providers-and-expose-armor.md` (Task 4 edits the `ap` provider list and the `ff` entry as restructured there). Must land **before** `2026-08-11-group-layout-proposer.md`, which needs Guardian to bucket as a tank.

## Global Constraints

- **`SPEC_TREES` is positional and must not gain Guardian.** `inferSpec` indexes it by talent tab (0/1/2) — a fourth entry would silently corrupt spec inference for every druid. Guardian lives in a separate list.
- **Guardian is Feral for abilities, tank for grouping.** Any check that asks "can this druid do X" must accept both. Only role/bucket questions distinguish them.
- **The addon can never report Guardian.** It reports `Feral` from tab totals. Guardian must therefore survive the merge against an addon scan that disagrees — see Task 2, which is the whole reason this plan is not two lines long.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Guardian as a selectable spec

**Files:**
- Modify: `assignments-engine.js:7-17` (add `SELECTABLE_SPECS` and `isFeralSpec` below `SPEC_TREES`), `:73` (`RH_SPEC_ALIASES`), `:112` (RH spec canonicalization)
- Modify: `assignments.js:123-127` (`fillManualSpecs`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: `SELECTABLE_SPECS -> { CLASS: [String] }` (every class, druids gaining `Guardian`) and `isFeralSpec(spec) -> boolean`. Tasks 2–4 and the group-layout plan rely on both.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('SELECTABLE_SPECS: druids can be marked Guardian, other classes are unchanged', () => {
    assert.deepStrictEqual(E.SELECTABLE_SPECS.DRUID, ['Balance', 'Feral', 'Guardian', 'Restoration']);
    assert.deepStrictEqual(E.SELECTABLE_SPECS.MAGE, ['Arcane', 'Fire', 'Frost']);
});
test('SPEC_TREES stays positional so talent inference is unaffected', () => {
    assert.deepStrictEqual(E.SPEC_TREES.DRUID, ['Balance', 'Feral', 'Restoration']);
    assert.strictEqual(E.inferSpec('DRUID', [0, 47, 14]).spec, 'Feral');
});
test('isFeralSpec: guardian and feral both count as feral for abilities', () => {
    assert.strictEqual(E.isFeralSpec('Feral'), true);
    assert.strictEqual(E.isFeralSpec('Guardian'), true);
    assert.strictEqual(E.isFeralSpec('Balance'), false);
    assert.strictEqual(E.isFeralSpec(null), false);
});
test('parseRaidHelper: a Guardian signup stays Guardian instead of collapsing to Feral', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Bearface', className: 'Druid', specName: 'Guardian', status: 'primary', userId: '1' },
    ] });
    assert.strictEqual(r.players[0].spec, 'Guardian');
    assert.deepStrictEqual(r.players[0].flags, []);
});
```

Before writing these, read the existing `parseRaidHelper` tests to copy the exact event-object shape that function expects — the field names above are a best guess and the real ones must be used.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `SELECTABLE_SPECS` and `isFeralSpec` are undefined, and the Guardian signup comes back as `Feral` via the alias.

- [ ] **Step 3: Implement**

In `assignments-engine.js`, immediately after the `SPEC_TREES` object, add:

```js
    // SPEC_TREES is positional — inferSpec indexes it by talent tab, so it must stay three
    // entries per class. Guardian is a role a human declares, not something talent totals can
    // reveal (bear and cat are the same tree), so it lives here instead.
    const SELECTABLE_SPECS = Object.keys(SPEC_TREES).reduce((acc, cls) => {
        acc[cls] = SPEC_TREES[cls].slice();
        return acc;
    }, {});
    SELECTABLE_SPECS.DRUID = ['Balance', 'Feral', 'Guardian', 'Restoration'];

    // A bear casts Faerie Fire, Demoralizing Roar and carries Leader of the Pack exactly like
    // a cat. Guardian differs only in which group it belongs to.
    function isFeralSpec(spec) { return spec === 'Feral' || spec === 'Guardian'; }
```

Remove the Guardian alias — line 73 becomes:

```js
    const RH_SPEC_ALIASES = { Beastmastery: 'Beast Mastery' };
```

At line 112, the RH spec is canonicalized against `SPEC_TREES[cls]`, which would now reject Guardian and flag it. Change that lookup to use the selectable list:

```js
            const canonical = SELECTABLE_SPECS[cls].find(s => s.toLowerCase() === spec.toLowerCase());
```

In `assignments.js`, `fillManualSpecs` reads `E.SPEC_TREES[cls]` twice (lines 126–127). Change both to `E.SELECTABLE_SPECS[cls]`.

Export `SELECTABLE_SPECS` and `isFeralSpec`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. If an existing `parseRaidHelper` test asserted that Guardian normalizes to Feral, it is now wrong by design — update it and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments.js assignments-engine.test.js
git commit -m "feat: Guardian as a selectable druid spec, kept distinct from Feral"
```

---

### Task 2: Let Guardian survive the merge

**Files:**
- Modify: `assignments-engine.js:148-153` (spec disagreement handling in `mergeRosters`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `isFeralSpec` from Task 1.

This is the task that makes the feature actually work. The addon reports `Feral` from tab totals and **addon wins on disagreement**, so without this a Raid-Helper Guardian is overwritten by the addon's Feral on every import — and the user's manual correction is undone the next time they paste a scan.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`. Read the existing `mergeRosters` tests first and match their argument shape exactly:

```js
test('mergeRosters: a Guardian signup refines the addon Feral rather than being overwritten', () => {
    const addon = [{ name: 'Bearface', class: 'DRUID', spec: 'Feral', flags: [], source: 'addon' }];
    const rh = [{ name: 'Bearface', class: 'DRUID', spec: 'Guardian', discordId: '1', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    const bear = r.roster.find(p => p.name === 'Bearface');
    assert.strictEqual(bear.spec, 'Guardian');
    assert.deepStrictEqual(r.mismatches, []);
    assert.ok(!bear.flags.some(f => /signed-as/.test(f)));
});
test('mergeRosters: Feral signup against an addon Feral is not a mismatch either', () => {
    const addon = [{ name: 'Kitty', class: 'DRUID', spec: 'Feral', flags: [], source: 'addon' }];
    const rh = [{ name: 'Kitty', class: 'DRUID', spec: 'Feral', discordId: '2', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    assert.strictEqual(r.roster[0].spec, 'Feral');
    assert.deepStrictEqual(r.mismatches, []);
});
test('mergeRosters: a genuine spec disagreement is still flagged', () => {
    const addon = [{ name: 'Moonpie', class: 'DRUID', spec: 'Balance', flags: [], source: 'addon' }];
    const rh = [{ name: 'Moonpie', class: 'DRUID', spec: 'Restoration', discordId: '3', flags: [] }];
    const r = E.mergeRosters(addon, rh, {});
    assert.strictEqual(r.roster[0].spec, 'Balance');
    assert.strictEqual(r.mismatches.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the first test — the merge keeps `Feral` and records a mismatch.

- [ ] **Step 3: Implement**

Replace the spec-disagreement block inside `mergeRosters`:

```js
                if (rh.spec && m.spec && rh.spec !== m.spec) {
                    m.flags.push('signed-as:' + rh.spec);
                    mismatches.push({ name: m.name, signed: rh.spec, actual: m.spec });
                }
```

with:

```js
                if (rh.spec && m.spec && rh.spec !== m.spec) {
                    // Talent totals cannot tell a bear from a cat, so an addon scan always
                    // says Feral. A Guardian signup is strictly more information, not a
                    // contradiction — take it rather than flagging a mismatch that is really
                    // just the addon's blind spot.
                    if (isFeralSpec(rh.spec) && isFeralSpec(m.spec)) {
                        m.spec = rh.spec;
                    } else {
                        m.flags.push('signed-as:' + rh.spec);
                        mismatches.push({ name: m.name, signed: rh.spec, actual: m.spec });
                    }
                }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Verify the manual path in the browser**

Run `npm start`. Import `RSS1;Bearface:DRUID:0/47/14` — Bearface shows as Feral. Now click **+ Add player**, enter `Bearface`, class DRUID, spec **Guardian**, save. Confirm the roster shows Guardian. Then re-paste the same addon export and confirm Bearface is **still** Guardian — the manual entry must not be reverted by a re-scan.

If it does revert, the manual-override path has the same blind spot as the merge and needs the same treatment; report that rather than working around it.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: a Guardian signup refines the addon's Feral instead of being overwritten"
```

---

### Task 3: Guardian is Feral everywhere an ability is involved

**Files:**
- Modify: `assignments-engine.js` (`DEBUFF_CATALOG` `ff` and `ap` entries, `PASSIVES`, `specRank`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `isFeralSpec` from Task 1.

- [ ] **Step 1: Write the failing tests**

```js
test('autoAssign: a Guardian druid can take faerie fire and demoralizing roar', () => {
    const r = E.autoAssign([P('Bearface', 'DRUID', 'Guardian')], {});
    assert.strictEqual(duty(r, 'ff').player, 'Bearface');
    assert.strictEqual(duty(r, 'ap').name, 'Demoralizing Roar');
    assert.strictEqual(duty(r, 'ap').player, 'Bearface');
});
test('autoAssign: a Guardian druid provides Mangle', () => {
    const r = E.autoAssign([P('Bearface', 'DRUID', 'Guardian')], {});
    assert.ok(r.passives.some(p => p.name === 'Mangle' && p.player === 'Bearface'));
});
test('autoAssign: faerie fire prefers balance, then guardian, then cat, then resto', () => {
    const all = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Kitty', 'DRUID', 'Feral'),
                              P('Bearface', 'DRUID', 'Guardian'), P('Moonpie', 'DRUID', 'Balance')], {});
    assert.strictEqual(duty(all, 'ff').player, 'Moonpie');
    const noBalance = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Kitty', 'DRUID', 'Feral'),
                                    P('Bearface', 'DRUID', 'Guardian')], {});
    assert.strictEqual(duty(noBalance, 'ff').player, 'Bearface'); // bear keeps FF up for threat anyway
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `Guardian` is not in any `preferSpecs` list and `PASSIVES` matches `spec === 'Feral'` exactly, so a Guardian is treated as an unremarkable druid.

- [ ] **Step 3: Implement**

Update the `ff` entry's preference order — a bear maintains Faerie Fire for threat regardless, so it outranks a cat:

```js
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Guardian', 'Feral'] },
```

Update the Demoralizing Roar provider inside the `ap` entry:

```js
            { name: 'Demoralizing Roar', class: 'DRUID', preferSpecs: ['Guardian', 'Feral'] },
```

`PASSIVES` matches on exact spec equality (`x.spec === ps.spec`). Give the Mangle entry a spec list instead, and teach the matcher to read it. Replace the Mangle line:

```js
        { name: 'Mangle', class: 'DRUID', spec: 'Feral' },
```

with:

```js
        { name: 'Mangle', class: 'DRUID', specs: ['Feral', 'Guardian'] },
```

and in the `passives` computation inside `autoAssign`, replace the matcher:

```js
            const p = roster.find(x => x.class === ps.class && (!ps.spec || x.spec === ps.spec));
```

with:

```js
            const p = roster.find(x => x.class === ps.class
                && (ps.specs ? ps.specs.indexOf(x.spec) !== -1 : (!ps.spec || x.spec === ps.spec)));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: Guardian druids provide feral abilities and Mangle"
```

---

## Grouping is handled by the group-layout plan, not here

Guardian's effect on party placement — `bucketOf` returning `tanks`, and `anchorScore` calling `isFeralSpec` so a bear still counts as the Leader of the Pack anchor — is written directly into `2026-08-11-group-layout-proposer.md` Task 1, which runs after this plan. Do **not** add a `bucketOf` here; it does not exist yet at this point in the sequence, and duplicating it would give two definitions to keep in sync.

What this plan owes that one is `isFeralSpec`, exported in Task 1.

---

## Open questions for the implementer

- **Leader of the Pack follows the bear into the tank group.** That is correct — the aura is party-scoped and the bear is in that party — but it means the melee group loses +5% crit unless a cat is also present. The group notes will say so honestly; whether the raid wants to move the bear anyway is their call, not the tool's.
- **A Guardian marked manually is still lost if the player is removed and re-added**, because `state.manual` is keyed by name. That matches how every other manual edit behaves, so it is consistent rather than a new bug.
- **Nothing infers Guardian.** If a raid never touches Raid-Helper and never opens the manual form, every druid stays Feral and the tool behaves exactly as it does today. That is the intended fallback.
