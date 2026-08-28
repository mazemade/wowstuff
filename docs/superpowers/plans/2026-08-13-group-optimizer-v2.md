# Group Optimizer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the group optimizer's invented ordinal buff weights with a sim-calibrated,
DPS-unit, floors-constrained model, and surface top-alternatives and per-seat marginal costs.

**Architecture:** `assignments-engine.js` (single UMD file, browser + node) gets a new score model
(`playerScore = baseline × mult × Π(1+v)^count`), feasibility floors checked lexicographically
before score, and an unrestricted deterministic hill-climb. An offline `calibration/` harness
(node scripts + a pinned wowsims/tbc-new checkout) generates the numbers and rewrites a marked
block in the engine. No runtime sim dependency, no build step.

**Tech Stack:** Plain JS (UMD engine, no deps), node ≥ 18 for scripts, Go toolchain only inside
`calibration/` for `wowsimcli`.

**Spec:** `docs/superpowers/specs/2026-08-13-group-optimizer-v2-design.md` — read it fully first,
plus the validated brief it cites (`2026-08-13-group-optimizer-v2-research-brief.md`).

## Global Constraints

- **Test policy (spec §9):** never modify or delete an existing test EXCEPT the ones the spec
  names. Each allowed update carries a commit-message justification naming the superseding ruling.
  A test failing for any other reason = fix the code or STOP and surface to Max.
- **Max's standing execution rules (memory `executing-written-plans`):** ask before deviating from
  this plan — first structural defect stops the work; prove every new test fails for the predicted
  reason before implementing; never claim completion without pasting real `node
  assignments-engine.test.js` output; one commit per task, no squashing.
- Engine stays one UMD file; no new runtime dependencies for the web app; everything in
  `calibration/` is offline-only.
- Determinism: same roster in, same layout out. No `Math.random`, no `Date.now` in scoring paths.
- The suite currently reports `245 passed, 0 failed`. It must end every task green (with the count
  growing).
- Tasks 2–8 change scoring semantics. If a pre-existing test not named by spec §9 fails after your
  change, classify it: (a) it pins behavior a spec ruling supersedes → update under §9.4 with
  justification; (b) it caught a real bug in your change → fix the code; (c) unclear → STOP and
  surface to Max. Never reclassify silently.

**File map (whole plan):**
- Modify: `assignments-engine.js` (tasks 1–9), `assignments-engine.test.js` (append v2 tests; scoped updates only), `assignments.js` (tasks 9–10), `assignments.css` (task 10, minor)
- Create: `calibration/README.md`, `calibration/links.txt`, `calibration/decode-profiles.mjs`,
  `calibration/build-requests.mjs`, `calibration/run-sims.mjs`, `calibration/make-weights.mjs`,
  `calibration/inject-weights.mjs`, `calibration/measure-gap.mjs`, `calibration/sim-verify.mjs`,
  `calibration/weights.json`, `calibration/floors-report.md` (generated)
- Untouched: `server.js`, `assignments-view.html`, all other apps.

---

### Task 1: Calibration block — `specKey`, `BASELINE`, `BUFF_V`

**Files:**
- Modify: `assignments-engine.js` (insert immediately above the `PARTY_BUFFS` definition, ~line 857)
- Test: `assignments-engine.test.js` (append at end)

**Interfaces:**
- Consumes: `SPEC_TREES` (existing const, top of engine).
- Produces: `specKey(p) -> 'CLASS:Spec'`; `BASELINE: {[specKey]: number}` (healers 0);
  `BUFF_V: {[buffName]: {[specKey]: fraction}}`; helper `expandV(byArchetype)`. All three of
  `specKey`, `BASELINE`, `BUFF_V` are added to the module's export object (bottom of file, next to
  `bucketOf, proposeGroups, ...`). Later tasks and `calibration/inject-weights.mjs` depend on the
  exact marker comments.

- [ ] **Step 1: Write the failing test**

```js
// --- Group optimizer v2 ---
test('v2: BASELINE covers every spec plus Guardian, healers at zero', () => {
    Object.keys(E.SPEC_TREES).forEach(cls => E.SPEC_TREES[cls].forEach(spec => {
        assert.ok((cls + ':' + spec) in E.BASELINE, 'missing baseline for ' + cls + ':' + spec);
    }));
    assert.ok('DRUID:Guardian' in E.BASELINE);
    ['PRIEST:Holy', 'PRIEST:Discipline', 'PALADIN:Holy', 'SHAMAN:Restoration', 'DRUID:Restoration']
        .forEach(k => assert.strictEqual(E.BASELINE[k], 0, k + ' must be 0'));
    assert.ok(E.BASELINE['WARRIOR:Fury'] > 0);
    assert.strictEqual(E.specKey({ class: 'WARRIOR', spec: 'Fury' }), 'WARRIOR:Fury');
    assert.ok(E.BUFF_V['Windfury Totem']['WARRIOR:Fury'] > 0);
    assert.ok(!('HUNTER:Beast Mastery' in E.BUFF_V['Windfury Totem']), 'WF must not apply to hunters');
});
```

- [ ] **Step 2: Run `node assignments-engine.test.js` — expect exactly this test FAILING** (`E.BASELINE` undefined). If it passes, the test is wrong; stop and fix the test.

- [ ] **Step 3: Implement.** Insert above `PARTY_BUFFS`:

```js
    function specKey(p) { return p.class + ':' + (p.spec || ''); }

    // Value tables are keyed by specKey. The hand-written provisional numbers below are
    // expressed per ARCHETYPE and expanded, because that is the granularity the old ordinal
    // table encoded; the calibration harness replaces the whole block with per-spec numbers.
    const SPECS_BY_ARCHETYPE = {
        wfMelee: ['WARRIOR:Arms', 'WARRIOR:Fury', 'ROGUE:Assassination', 'ROGUE:Combat',
                  'ROGUE:Subtlety', 'PALADIN:Retribution'],
        enhShaman: ['SHAMAN:Enhancement'],
        feralCat: ['DRUID:Feral'],
        bear: ['DRUID:Guardian'],
        protWarrior: ['WARRIOR:Protection'],
        protPaladin: ['PALADIN:Protection'],
        hunter: ['HUNTER:Beast Mastery', 'HUNTER:Marksmanship', 'HUNTER:Survival'],
        caster: ['MAGE:Arcane', 'MAGE:Fire', 'MAGE:Frost', 'WARLOCK:Affliction',
                 'WARLOCK:Demonology', 'WARLOCK:Destruction', 'PRIEST:Shadow',
                 'SHAMAN:Elemental', 'DRUID:Balance'],
        healer: ['PRIEST:Discipline', 'PRIEST:Holy', 'PALADIN:Holy', 'SHAMAN:Restoration',
                 'DRUID:Restoration'],
    };
    function expandV(byArchetype) {
        const v = {};
        Object.keys(byArchetype).forEach(a =>
            SPECS_BY_ARCHETYPE[a].forEach(k => { v[k] = byArchetype[a]; }));
        return v;
    }

    // === CALIBRATION START (provisional hand values; regenerated by calibration/inject-weights.mjs — do not hand-edit once generated) ===
    // BASELINE: unbuffed-party sim DPS per spec. Healers are 0 BY DESIGN — they enter the
    // model through floors, never the objective (spec §1). Provisional values only encode
    // plausible magnitudes and ordering.
    const BASELINE = {
        'WARRIOR:Arms': 900, 'WARRIOR:Fury': 1000, 'WARRIOR:Protection': 350,
        'PALADIN:Holy': 0, 'PALADIN:Protection': 400, 'PALADIN:Retribution': 900,
        'HUNTER:Beast Mastery': 1050, 'HUNTER:Marksmanship': 950, 'HUNTER:Survival': 900,
        'ROGUE:Assassination': 950, 'ROGUE:Combat': 1000, 'ROGUE:Subtlety': 800,
        'PRIEST:Discipline': 0, 'PRIEST:Holy': 0, 'PRIEST:Shadow': 900,
        'SHAMAN:Elemental': 950, 'SHAMAN:Enhancement': 900, 'SHAMAN:Restoration': 0,
        'MAGE:Arcane': 1000, 'MAGE:Fire': 950, 'MAGE:Frost': 900,
        'WARLOCK:Affliction': 1000, 'WARLOCK:Demonology': 900, 'WARLOCK:Destruction': 1050,
        'DRUID:Balance': 850, 'DRUID:Feral': 900, 'DRUID:Guardian': 400, 'DRUID:Restoration': 0,
    };
    // BUFF_V: fractional throughput value per (buff, spec). 0.10 = +10% DPS.
    const BUFF_V = {
        'Windfury Totem': expandV({ wfMelee: 0.10, protWarrior: 0.05 }),
        'Grace of Air': expandV({ wfMelee: 0.02, enhShaman: 0.02, feralCat: 0.05, bear: 0.05,
                                  hunter: 0.06, protWarrior: 0.01, protPaladin: 0.01 }),
        'Wrath of Air': expandV({ caster: 0.04, protPaladin: 0.03 }),
        'Strength of Earth': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03,
                                       bear: 0.02, protWarrior: 0.02, protPaladin: 0.01 }),
        'Totem of Wrath': expandV({ caster: 0.06, protPaladin: 0.02 }),
        'Mana Spring Totem': {},
        'Mana Tide Totem': {},
        'Battle Shout': expandV({ wfMelee: 0.04, enhShaman: 0.04, feralCat: 0.04, bear: 0.03,
                                  protWarrior: 0.03 }),
        'Unleashed Rage': expandV({ wfMelee: 0.05, feralCat: 0.04, bear: 0.02,
                                    protWarrior: 0.02, hunter: 0.05 }),
        'Leader of the Pack': expandV({ wfMelee: 0.05, enhShaman: 0.04, feralCat: 0.05,
                                        bear: 0.03, hunter: 0.05, protWarrior: 0.02 }),
        'Ferocious Inspiration': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03,
                                           bear: 0.03, hunter: 0.03, caster: 0.03,
                                           protWarrior: 0.03, protPaladin: 0.03 }),
        'Trueshot Aura': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03, hunter: 0.05,
                                   protWarrior: 0.01 }),
        'Moonkin Aura': expandV({ caster: 0.05 }),
        'Vampiric Touch': expandV({ caster: 0.02 }),
        'Devotion Aura': {},
        'Retribution Aura': {},
        'Concentration Aura': {},
        'Sanctity Aura': { 'PALADIN:Retribution': 0.05, 'PALADIN:Protection': 0.05 },
        'Heroic Presence': expandV({ wfMelee: 0.02, enhShaman: 0.02, feralCat: 0.02, bear: 0.01,
                                     hunter: 0.02, protWarrior: 0.01, protPaladin: 0.01 }),
        'Inspiring Presence': expandV({ caster: 0.02 }),
    };
    // === CALIBRATION END ===
```

Then add `specKey, BASELINE, BUFF_V,` to the export object at the bottom of the file.

- [ ] **Step 4: Run `node assignments-engine.test.js` — expect 246 passed, 0 failed.** (Nothing consumes the new constants yet, so nothing else may move.)

- [ ] **Step 5: Commit** — `git add assignments-engine.js assignments-engine.test.js && git commit -m "feat: v2 calibration block — specKey, per-spec baselines and buff values"`

---

### Task 2: Score model in DPS units — schema migration, cohesion removal

**Files:**
- Modify: `assignments-engine.js` — `PARTY_BUFFS` rows (~857–906), `groupBuffs` (~908–928), `playerBuffScore` (~930–932), `scoreLayout` (~934–946), `NOTE_RULES`'s `airChoice` (~1130–1133); exports.
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Consumes: `specKey`, `BASELINE`, `BUFF_V` (Task 1); existing `bucketOf`, `isFeralSpec`.
- Produces (later tasks rely on these EXACT shapes):
  - `PARTY_BUFFS` row: `{ name, element?, mode: 'once'|'stacks', count: ps => integer, v: object }`
  - `groupBuffs(players) -> [{ buff: row, count: integer }]` (exported)
  - `multOf(p) -> number` (internal; `p.mult` default 1)
  - `playerBuffScore(p, players) -> uplift fraction` (Π(1+v)^count − 1) (already exported)
  - `playerScore(p, players) -> BASELINE × mult × (1 + uplift)` (exported)
  - `scoreLayout(groups) -> Σ playerScore` — **no cohesion term**
  - `PARTY_BUFFS` exported (calibration + tests need the row list)

- [ ] **Step 1: Write the failing tests**

```js
test('v2: playerScore = baseline × compounded buff uplift', () => {
    const g = [P('Fu', 'WARRIOR', 'Fury'), P('Ro', 'ROGUE', 'Combat')];
    const bs = E.BUFF_V['Battle Shout']['ROGUE:Combat'];
    assert.ok(bs > 0);
    assert.ok(Math.abs(E.playerScore(g[1], g) - E.BASELINE['ROGUE:Combat'] * (1 + bs)) < 1e-6,
        'got ' + E.playerScore(g[1], g));
});
test('v2: healers score zero in the objective', () => {
    const g = [P('H', 'PRIEST', 'Holy'), P('Fu', 'WARRIOR', 'Fury')];
    assert.strictEqual(E.playerScore(g[0], g), 0);
});
test('v2: manual multiplier scales a player\'s score', () => {
    const p = P('Fu', 'WARRIOR', 'Fury');
    const s1 = E.playerScore(p, [p]);
    p.mult = 1.5;
    assert.ok(Math.abs(E.playerScore(p, [p]) - 1.5 * s1) < 1e-6);
});
test('v2: scoreLayout has no cohesion term', () => {
    const groups = [{ role: 'casters', players: [P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')] }];
    // Two mages provide nothing to each other: score must be exactly the sum of baselines.
    assert.strictEqual(E.scoreLayout(groups), 2 * E.BASELINE['MAGE:Arcane']);
});
```

- [ ] **Step 2: Run — expect these four FAILING** (`playerScore` not exported; cohesion adds 0.5). Paste output.

- [ ] **Step 3: Implement.**
  1. Rewrite every `PARTY_BUFFS` row: `provided: ps => ...` becomes `count: ps => <same filter>.length`, add `mode: 'once'`, replace `w: {...}` with `v: BUFF_V['<row name>'] || {}`. Keep the same 16 rows and `element: 'air'` markers for now (content changes come in Tasks 3–6; Blood Pact keeps `v: {}` until Task 3 removes it, and the old generic `'Paladin aura'` row keeps `v: {}` until Task 5 replaces it).
  2. Replace `groupBuffs`/`playerBuffScore`/`scoreLayout` with:

```js
    function multOf(p) { return typeof p.mult === 'number' ? p.mult : 1; }

    function groupValueOf(buff, players) {
        return players.reduce((s, p) =>
            s + (BASELINE[specKey(p)] || 0) * multOf(p) * (buff.v[specKey(p)] || 0), 0);
    }

    function groupBuffs(players) {
        const active = [];
        PARTY_BUFFS.filter(b => !b.element).forEach(b => {
            const n = b.count(players);
            if (n > 0) active.push({ buff: b, count: b.mode === 'stacks' ? n : 1 });
        });
        const airs = PARTY_BUFFS.filter(b => b.element === 'air' && b.count(players) > 0);
        if (airs.length) {
            // Elemental pin (established ruling); otherwise argmax of group DPS value,
            // ties keep table order (WF first). Twisting arrives in Task 4.
            let bestAir = null;
            if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental')) {
                bestAir = airs.filter(b => b.name === 'Wrath of Air')[0];
            } else {
                let bestVal = -1;
                airs.forEach(b => {
                    const v = groupValueOf(b, players);
                    if (v > bestVal) { bestVal = v; bestAir = b; }
                });
            }
            if (bestAir) active.push({ buff: bestAir, count: 1 });
        }
        return active;
    }

    function playerBuffScore(p, players) {
        return groupBuffs(players).reduce((f, a) =>
            f * Math.pow(1 + (a.buff.v[specKey(p)] || 0), a.count), 1) - 1;
    }

    function playerScore(p, players) {
        return (BASELINE[specKey(p)] || 0) * multOf(p) * (1 + playerBuffScore(p, players));
    }

    function scoreLayout(groups) {
        return groups.reduce((sum, g) =>
            sum + g.players.reduce((s, p) => s + playerScore(p, g.players), 0), 0);
    }
```

  3. `airChoice(g)` inside `proposeGroups` becomes:

```js
        function airChoice(g) {
            const air = groupBuffs(g.players).filter(a => a.buff.element === 'air')[0];
            return air ? air.buff.name : null;
        }
```

  4. Export `playerScore`, `groupBuffs`, `PARTY_BUFFS`.

- [ ] **Step 4: Run the full suite.** Expect the 4 new tests green. Some pre-existing layout-pin tests may now fail because units changed — classify each per Global Constraints (most likely legitimate §9.4 updates: the relative order the ordinals encoded is preserved by the provisional values, so widespread failures suggest a bug in your change, not the units). Paste the final green output.

- [ ] **Step 5: Commit** — `feat: v2 score model — DPS units, multiplicative buffs, cohesion term removed` (+ one `§9.4` justification line per updated test, if any).

---

### Task 3: Row content — FI stacks, Unleashed Rage for hunters, Mana Spring, Blood Pact dropped

**Files:**
- Modify: `assignments-engine.js` (`PARTY_BUFFS` rows, `NOTE_RULES`)
- Test: `assignments-engine.test.js` (append + ONE scoped update)

**Interfaces:**
- Consumes: Task 2 schema.
- Produces: FI row `mode: 'stacks'`; new row `'Mana Spring Totem'` (+ note rule `'Mana Spring Totem'`); Blood Pact row and note DELETED; `BUFF_V['Unleashed Rage']['HUNTER:Beast Mastery'] > 0` (already in Task 1's table — this task asserts it flows through).

- [ ] **Step 1: Write the failing tests**

```js
test('v2: Ferocious Inspiration compounds per BM hunter', () => {
    const one = [P('B1', 'HUNTER', 'Beast Mastery'), P('M', 'MAGE', 'Arcane')];
    const two = [P('B1', 'HUNTER', 'Beast Mastery'), P('B2', 'HUNTER', 'Beast Mastery'), P('M', 'MAGE', 'Arcane')];
    const fi = E.BUFF_V['Ferocious Inspiration']['MAGE:Arcane'];
    const base = E.BASELINE['MAGE:Arcane'];
    assert.ok(Math.abs(E.playerScore(two[2], two) - base * Math.pow(1 + fi, 2)) < 1e-6);
    assert.ok(Math.abs(E.playerScore(one[1], one) - base * (1 + fi)) < 1e-6);
});
test('v2: Unleashed Rage reaches hunters', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('B', 'HUNTER', 'Beast Mastery')];
    assert.ok(E.groupBuffs(g).some(a => a.buff.name === 'Unleashed Rage'));
    assert.ok(E.BUFF_V['Unleashed Rage']['HUNTER:Beast Mastery'] > 0);
});
test('v2: Mana Spring Totem is modeled and noted', () => {
    assert.ok(E.PARTY_BUFFS.some(b => b.name === 'Mana Spring Totem'));
    const res = E.proposeGroups([P('Sh', 'SHAMAN', 'Restoration'), P('H', 'PRIEST', 'Holy')]);
    assert.ok(res.groups[0].notes.some(t => /Mana Spring/.test(t)), res.groups[0].notes.join(' | '));
});
test('v2: Blood Pact is gone from the model', () => {
    assert.ok(!E.PARTY_BUFFS.some(b => b.name === 'Blood Pact'));
});
```

- [ ] **Step 2: Run — expect all four FAILING for the predicted reasons** (FI clamped to once; no Mana Spring row; Blood Pact row exists). Paste output.

- [ ] **Step 3: Implement.** In `PARTY_BUFFS`: set FI's `mode: 'stacks'`; add after `'Mana Tide Totem'`:

```js
        { name: 'Mana Spring Totem', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Mana Spring Totem'] || {} },
```

Delete the Blood Pact row. In `NOTE_RULES`: add `{ text: 'Mana Spring Totem', has: g => g.players.some(p => p.class === 'SHAMAN') },` next to the Strength of Earth rule; delete the Blood Pact note rule.

- [ ] **Step 4: Scoped test update (spec §9.2).** Rewrite the existing test `NOTE_RULES: Blood Pact printed for any warlock group` to pin the ABSENCE:

```js
test('NOTE_RULES: Blood Pact is not modeled — no note for warlock groups', () => {
    const res = E.proposeGroups([P('L', 'WARLOCK', 'Destruction'), P('M', 'MAGE', 'Arcane')]);
    assert.ok(!res.groups[0].notes.some(t => /Blood Pact/.test(t)), res.groups[0].notes.join(' | '));
});
```

- [ ] **Step 5: Run full suite — green. Paste output.**

- [ ] **Step 6: Commit** — `feat: v2 rows — FI stacks per BM hunter, UR reaches hunters, Mana Spring added, Blood Pact dropped (spec §9.2: pins buff Max ruled dead — imp never out in raids)`

---

### Task 4: Totem twisting

**Files:**
- Modify: `assignments-engine.js` (`groupBuffs` air branch; `NOTE_RULES` air rules)
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Consumes: Task 2 `groupBuffs` shape.
- Produces: `airChoiceNames(players) -> [names]` used by NOTE_RULES; enh-shaman groups activate BOTH `'Windfury Totem'` and `'Grace of Air'`, never `'Wrath of Air'`.

- [ ] **Step 1: Write the failing tests**

```js
test('v2: twisting — enh shaman group runs Windfury AND Grace of Air', () => {
    const res = E.proposeGroups([P('Enh', 'SHAMAN', 'Enhancement'), P('Fu', 'WARRIOR', 'Fury')]);
    const notes = res.groups[0].notes.join(' | ');
    assert.ok(/Windfury Totem/.test(notes), notes);
    assert.ok(/Grace of Air/.test(notes), notes);
    assert.ok(!/Wrath of Air/.test(notes), notes);
});
test('v2: twisting raises the score of an enh melee group', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Fu', 'WARRIOR', 'Fury')];
    const names = E.groupBuffs(g).map(a => a.buff.name);
    assert.ok(names.indexOf('Windfury Totem') !== -1 && names.indexOf('Grace of Air') !== -1, names.join(','));
});
```

- [ ] **Step 2: Run — expect FAILING** (single-air argmax picks one). Paste output.

- [ ] **Step 3: Implement.** In `groupBuffs`, replace the air branch with:

```js
        const airs = PARTY_BUFFS.filter(b => b.element === 'air' && b.count(players) > 0);
        if (airs.length) {
            if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement')) {
                // Totem twisting (Max's ruling; wowsims `totem_twisting`): Windfury AND
                // Grace of Air together — twist two, not three, so Wrath of Air stays out.
                airs.filter(b => b.name !== 'Wrath of Air')
                    .forEach(b => active.push({ buff: b, count: 1 }));
            } else if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental')) {
                const woa = airs.filter(b => b.name === 'Wrath of Air')[0];
                if (woa) active.push({ buff: woa, count: 1 });
            } else {
                let bestAir = null, bestVal = -1;
                airs.forEach(b => {
                    const v = groupValueOf(b, players);
                    if (v > bestVal) { bestVal = v; bestAir = b; }
                });
                if (bestAir) active.push({ buff: bestAir, count: 1 });
            }
        }
```

In `proposeGroups`, replace `airChoice` with plural and update the air NOTE_RULES to membership tests:

```js
        function airChoiceNames(g) {
            return groupBuffs(g.players).filter(a => a.buff.element === 'air').map(a => a.buff.name);
        }
```

Air note rules become `has: g => airChoiceNames(g).indexOf('Windfury Totem') !== -1 && ...` (same enh/non-enh split for the two Windfury texts; Grace of Air and Wrath of Air rules likewise).

- [ ] **Step 4: Run full suite.** The pre-existing tests `proposeGroups: a lone shaman among hunters notes Grace of Air, not Windfury` (no enh — argmax path) and `optimizer: the enhancement shaman keeps a windfury group` (WF still present under twisting) are PREDICTED to stay green — if either fails, STOP: the implementation is wrong, not the test. Paste output.

- [ ] **Step 5: Commit** — `feat: v2 totem twisting — enh groups run Windfury and Grace of Air together`

---

### Task 5: Paladin aura rows and selection

**Files:**
- Modify: `assignments-engine.js` (`PARTY_BUFFS`, `groupBuffs`, `NOTE_RULES`)
- Test: `assignments-engine.test.js` (append + TWO scoped updates)

**Interfaces:**
- Consumes: Tasks 2/4 `groupBuffs`.
- Produces: four `element: 'aura'` rows (`Devotion Aura`, `Retribution Aura`, `Concentration Aura`, `Sanctity Aura`); a group with `k` paladins activates the top `min(k, available)` auras by `groupValueOf`, stable-sorted (ties keep table order); NOTE_RULES prints each active aura's name; the generic `'Paladin aura'` row and `'A paladin aura'` note are deleted.

- [ ] **Step 1: Write the failing tests**

```js
test('v2: paladin group notes a named aura, generic note gone', () => {
    const res = E.proposeGroups([P('Pal', 'PALADIN', 'Protection'), P('M', 'MAGE', 'Arcane')]);
    const notes = res.groups[0].notes.join(' | ');
    assert.ok(!/A paladin aura/.test(notes), notes);
    assert.ok(/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes), notes);
});
test('v2: Sanctity Aura needs a Retribution paladin and wins for holy-damage specs', () => {
    const two = E.proposeGroups([P('Ret', 'PALADIN', 'Retribution'), P('Pro', 'PALADIN', 'Protection')]);
    assert.ok(/Sanctity Aura/.test(two.groups[0].notes.join(' | ')), two.groups[0].notes.join(' | '));
    const noRet = E.proposeGroups([P('Pro', 'PALADIN', 'Protection'), P('M', 'MAGE', 'Arcane')]);
    assert.ok(!/Sanctity Aura/.test(noRet.groups[0].notes.join(' | ')));
});
test('v2: two paladins activate two auras', () => {
    const g = [P('Ret', 'PALADIN', 'Retribution'), P('Pro', 'PALADIN', 'Protection')];
    assert.strictEqual(E.groupBuffs(g).filter(a => a.buff.element === 'aura').length, 2);
});
```

- [ ] **Step 2: Run — expect FAILING** (generic row still there, no aura element). Paste output.

- [ ] **Step 3: Implement.** Replace the `'Paladin aura'` row with:

```js
        { name: 'Devotion Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Devotion Aura'] || {} },
        { name: 'Retribution Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Retribution Aura'] || {} },
        { name: 'Concentration Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Concentration Aura'] || {} },
        { name: 'Sanctity Aura', element: 'aura', mode: 'once',
          // Ret talent: available only when a Retribution paladin is in the group.
          count: ps => ps.some(p => p.class === 'PALADIN' && p.spec === 'Retribution')
              ? ps.filter(p => p.class === 'PALADIN').length : 0,
          v: BUFF_V['Sanctity Aura'] || {} },
```

In `groupBuffs`, after the air branch:

```js
        const auras = PARTY_BUFFS.filter(b => b.element === 'aura' && b.count(players) > 0);
        if (auras.length) {
            const nPal = players.filter(p => p.class === 'PALADIN').length;
            auras.map(b => ({ b, val: groupValueOf(b, players) }))
                .sort((x, y) => y.val - x.val) // stable: ties keep table order
                .slice(0, Math.min(nPal, auras.length))
                .forEach(x => active.push({ buff: x.b, count: 1 }));
        }
```

In `NOTE_RULES`, replace the `'A paladin aura'` rule with:

```js
            { text: 'Devotion Aura', has: g => auraNames(g).indexOf('Devotion Aura') !== -1 },
            { text: 'Retribution Aura', has: g => auraNames(g).indexOf('Retribution Aura') !== -1 },
            { text: 'Concentration Aura', has: g => auraNames(g).indexOf('Concentration Aura') !== -1 },
            { text: 'Sanctity Aura (+10% Holy damage)', has: g => auraNames(g).indexOf('Sanctity Aura') !== -1 },
```

with `function auraNames(g) { return groupBuffs(g.players).filter(a => a.buff.element === 'aura').map(a => a.buff.name); }` next to `airChoiceNames`.

- [ ] **Step 4: Scoped test updates (spec §9.3).** In the existing NOTE_RULES tests, the three `'A paladin aura'` assertions (positive for melee/healers groups, negative for tank group) become:

```js
    assert.ok(/(Devotion|Retribution|Concentration|Sanctity) Aura/.test(notes.melee), 'melee: ' + notes.melee);
    // ... same pattern for healers, negated for tanks
```

- [ ] **Step 5: Run full suite — green. Paste output.**

- [ ] **Step 6: Commit** — `feat: v2 paladin auras — four real rows with per-group argmax (spec §9.3: generic note superseded by named auras)`

---

### Task 6: Draenei presence split

**Files:**
- Modify: `assignments-engine.js` (`PARTY_BUFFS`, draenei swap pass ~1022–1035, `NOTE_RULES`)
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Consumes: Task 2 schema.
- Produces: rows `'Heroic Presence'` (Draenei WARRIOR/PALADIN/HUNTER) and `'Inspiring Presence'`
  (Draenei MAGE/PRIEST/SHAMAN); helper `presenceKind(p) -> 'melee'|'caster'|null`; swap pass
  dedupes per KIND. **Both note texts keep the substring `Draenei`** so the existing
  claims-match-presence test stays green by construction.

- [ ] **Step 1: Write the failing tests**

```js
test('v2: draenei presences split by class kind', () => {
    const D = (n, cls, spec) => Object.assign(P(n, cls, spec), { race: 'Draenei' });
    const melee = E.proposeGroups([D('Dw', 'WARRIOR', 'Fury'), P('R', 'ROGUE', 'Combat')]).groups[0].notes.join(' | ');
    assert.ok(/Heroic Presence/.test(melee), melee);
    assert.ok(!/Inspiring Presence/.test(melee), melee);
    const caster = E.proposeGroups([D('Dm', 'MAGE', 'Arcane'), P('M', 'MAGE', 'Fire')]).groups[0].notes.join(' | ');
    assert.ok(/Inspiring Presence/.test(caster), caster);
});
test('v2: mixed-kind draenei pair in one group is NOT redundant', () => {
    const D = (n, cls, spec) => Object.assign(P(n, cls, spec), { race: 'Draenei' });
    const g = [D('Dw', 'WARRIOR', 'Fury'), D('Dm', 'MAGE', 'Arcane')];
    const names = E.groupBuffs(g).map(a => a.buff.name);
    assert.ok(names.indexOf('Heroic Presence') !== -1 && names.indexOf('Inspiring Presence') !== -1, names.join(','));
});
```

- [ ] **Step 2: Run — expect FAILING** (single generic presence row). Paste output.

- [ ] **Step 3: Implement.** Replace the `'Draenei presence'` row with:

```js
        { name: 'Heroic Presence', mode: 'once',
          count: ps => ps.filter(p => presenceKind(p) === 'melee').length,
          v: BUFF_V['Heroic Presence'] || {} },
        { name: 'Inspiring Presence', mode: 'once',
          count: ps => ps.filter(p => presenceKind(p) === 'caster').length,
          v: BUFF_V['Inspiring Presence'] || {} },
```

with, above `PARTY_BUFFS`:

```js
    function presenceKind(p) {
        if (p.race !== 'Draenei') return null;
        return ['WARRIOR', 'PALADIN', 'HUNTER'].indexOf(p.class) !== -1 ? 'melee' : 'caster';
    }
```

In the draenei swap pass, group the draenei per kind so only SAME-KIND extras swap out:

```js
        groups.forEach(g => {
            ['melee', 'caster'].forEach(kind => {
                const dr = g.players.filter(p => presenceKind(p) === kind)
                    .sort((a, b) => anchorScore(a) - anchorScore(b));
                dr.slice(1).forEach(extra => {
                    if (!swappable(extra)) return;
                    const target = groups.find(o => o !== g
                        && !o.players.some(p => presenceKind(p) === kind)
                        && o.players.some(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra)));
                    if (!target) return;
                    const swap = target.players.find(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra));
                    g.players[g.players.indexOf(extra)] = swap;
                    target.players[target.players.indexOf(swap)] = extra;
                });
            });
        });
```

Replace the `'+1% hit from Draenei presence'` note rule with two rules whose texts KEEP the word
Draenei: `'+1% hit from Draenei Heroic Presence'` (has: any `presenceKind === 'melee'` member) and
`'+1% spell hit from Draenei Inspiring Presence'` (caster kind).

- [ ] **Step 4: Run full suite.** The existing draenei tests (`raid25` swap-distribution tests, notes-claims test using `/Draenei/`) are PREDICTED green: rogues are melee-kind, and the note texts still contain 'Draenei'. Any failure = STOP and inspect. Paste output.

- [ ] **Step 5: Commit** — `feat: v2 draenei split — Heroic and Inspiring Presence, kind-aware swap pass`

---

### Task 7: Floors — `layoutViolations` + lexicographic climb + MT flag

**Files:**
- Modify: `assignments-engine.js` (new function after `scoreLayout`; hill-climb comparison ~1075–1108; exports)
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Consumes: `airChoiceNames` — move it OUT of `proposeGroups` to module scope (next to `groupBuffs`) so `layoutViolations` can use it; `proposeGroups`'s local references keep working.
- Produces: `layoutViolations(groups) -> number` (exported): +100 per MT-flagged player whose group lacks a shaman; +10 per group holding a Protection paladin without `'Wrath of Air'` among its air choices; +1 per group with ≥ 2 healers (`bucketOf === 'healers'`) and no shaman. Hill-climb compares `(violations, score)` lexicographically.

- [ ] **Step 1: Write the failing tests**

```js
test('v2: layoutViolations weights survival > threat > healing', () => {
    const mk = players => [{ role: 'x', players }];
    assert.strictEqual(E.layoutViolations(mk([Object.assign(P('T', 'WARRIOR', 'Protection'), { mt: true })])), 100);
    assert.strictEqual(E.layoutViolations(mk([P('PP', 'PALADIN', 'Protection')])), 10);
    assert.strictEqual(E.layoutViolations(mk([P('H1', 'PRIEST', 'Holy'), P('H2', 'DRUID', 'Restoration')])), 1);
    assert.strictEqual(E.layoutViolations(mk([P('H1', 'PRIEST', 'Holy'), P('Sh', 'SHAMAN', 'Restoration')])), 0);
});
test('v2: MT flag pulls a shaman into the tank\'s group', () => {
    const roster = [
        Object.assign(P('Tank', 'WARRIOR', 'Protection'), { mt: true }),
        P('Resto', 'SHAMAN', 'Restoration'),
        P('H1', 'PRIEST', 'Holy'), P('H2', 'DRUID', 'Restoration'),
        P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane'), P('M3', 'MAGE', 'Fire'),
    ];
    const res = E.proposeGroups(roster);
    const tankG = res.groups.find(g => g.players.some(p => p.name === 'Tank'));
    assert.ok(tankG.players.some(p => p.class === 'SHAMAN'),
        'MT parked without a shaman: ' + tankG.players.map(p => p.name).join(','));
});
```

- [ ] **Step 2: Run — expect FAILING** (`layoutViolations` undefined). Paste output.

- [ ] **Step 3: Implement.**

```js
    // Floors (spec §2). Weighted so the relax order is healing → threat → never survival:
    // any single survival breach outweighs every possible threat+healing breach combined.
    function layoutViolations(groups) {
        let v = 0;
        groups.forEach(g => {
            const hasShaman = g.players.some(p => p.class === 'SHAMAN');
            g.players.forEach(p => { if (p.mt && !hasShaman) v += 100; });
            if (g.players.some(p => p.class === 'PALADIN' && p.spec === 'Protection')
                && airChoiceNames(g).indexOf('Wrath of Air') === -1) v += 10;
            if (g.players.filter(p => bucketOf(p) === 'healers').length >= 2 && !hasShaman) v += 1;
        });
        return v;
    }
```

(`airChoiceNames(g)` at module scope takes the group object, reading `g.players` — adjust Task 4's
version when moving it.) In the hill-climb, evaluate candidates lexicographically:

```js
        for (let iter = 0; iter < 500; iter++) {
            const baseV = layoutViolations(groups), baseS = scoreLayout(groups);
            let best = null; // { dv, ds, kind, ... } — dv first, then ds, first-found ties kept
            function consider(kind, a, ia, b, ib) {
                const v = layoutViolations(groups), s = scoreLayout(groups);
                const dv = baseV - v, ds = s - baseS;
                if (dv < 0 || (dv === 0 && ds <= 1e-9)) return;
                if (!best || dv > best.dv || (dv === best.dv && ds > best.ds + 1e-9)) {
                    best = { dv, ds, kind, a, ia, b, ib };
                }
            }
            // ... same enumeration loops, calling consider() while the candidate is applied
        }
```

Keep the exact enumeration order (a, ia, b, ib; swaps for b > a; moves for any b with room). The
`relocatable()`/under-full guards stay in place for THIS task — they fall in Task 8.

- [ ] **Step 4: Run full suite — green (MT integration test passes because the move into the healer group survives both guards: the tank overflowed, `bucketOf !== role`). Paste output.**

- [ ] **Step 5: Commit** — `feat: v2 floors — layoutViolations checked lexicographically before score; MT flag honored`

---

### Task 8: Remove the hill-climb guards; scoped SSC regression update; determinism

**Files:**
- Modify: `assignments-engine.js` (delete `relocatable()` and its comment block ~1048–1074; drop the under-full-endpoint condition)
- Test: `assignments-engine.test.js` (append + ONE scoped update)

**Interfaces:**
- Consumes: Task 7 climb structure.
- Produces: every cross-group swap and every move-into-empty-seat is a candidate, filtered only by `(violations, score)` improvement. This is the change that lets two FULL groups trade players (brief §8 Q4).

- [ ] **Step 1: Write the failing test**

```js
test('v2: full groups may trade players when the score says so', () => {
    // Two full groups; the cat is worth more with the warriors, the hunter more with the GoA
    // group — under v1 guards NO swap between two full groups could ever fire.
    const roster = [
        P('Enh', 'SHAMAN', 'Enhancement'), P('W1', 'WARRIOR', 'Fury'), P('W2', 'WARRIOR', 'Fury'),
        P('W3', 'WARRIOR', 'Arms'), P('H1', 'HUNTER', 'Beast Mastery'),
        P('Sh2', 'SHAMAN', 'Restoration'), P('H2', 'HUNTER', 'Beast Mastery'),
        P('H3', 'HUNTER', 'Survival'), P('Cat', 'DRUID', 'Feral'), P('R1', 'ROGUE', 'Combat'),
    ];
    const res = E.proposeGroups(roster);
    const meleeG = res.groups.find(g => g.players.some(p => p.name === 'W1'));
    assert.ok(meleeG.players.some(p => p.name === 'Cat') || meleeG.players.some(p => p.name === 'R1'),
        'no melee-side beneficiary moved in: ' + meleeG.players.map(p => p.name).join(','));
});
test('v2: proposeGroups is deterministic across calls', () => {
    const names = r => r.groups.map(g => g.players.map(p => p.name));
    assert.deepStrictEqual(names(E.proposeGroups(raid25())), names(E.proposeGroups(raid25())));
});
```

⚠️ The first test's expected layout is a PREDICTION. Before trusting it, hand-compute the seed for
this roster (bucketOf: 3 warriors + rogue + cat + enh = melee bucket of 6; hunters bucket of 3;
groups = 2). If the seed already satisfies the assertion, the test cannot fail — verify Step 2
shows a REAL failure under the guards; if it doesn't, redesign the fixture before proceeding
(per Max's prove-tests-fail rule).

- [ ] **Step 2: Run — expect the first test FAILING under the current guards (that failure is the evidence Q4 documented), the determinism test may already pass — if so note it as the predicted coincidental pass and keep it as a regression pin.** Paste output.

- [ ] **Step 3: Implement.** Delete `relocatable()` and its comment block. In the swap branch drop
`(groups[a].players.length < GROUP_CAP || groups[b].players.length < GROUP_CAP) &&` and both
`relocatable(...)` calls; in the move branch drop `relocatable(...)` (keep `groups[b].players.length < GROUP_CAP` — a move needs an empty seat).

- [ ] **Step 4: Scoped test update (spec §9.1).** The regression test `proposeGroups: regression — the 2026-08-13 SSC roster` currently asserts the Guardian shares a group with hunters. Replace its final two assertions with:

```js
    // v2 (spec §9.1): the twisting ruling + real-DPS objective supersede the pinned v1 layout.
    // What the spec REQUIRES: the ferals split so two groups get Leader of the Pack, and no
    // 2-man tank island survives. WHICH feral sits with the melee is the optimizer's call.
    const catG = res.groups.find(g => g.players.some(p => p.name === 'Warzilla'));
    const bearG = res.groups.find(g => g.players.some(p => p.name === 'Smellmystaff'));
    assert.notStrictEqual(catG, bearG, 'ferals must split to double Leader of the Pack');
    assert.ok(!(bearG.players.length === 2 && bearG.players.some(p => p.name === 'Sylvanor')),
        'the 2-man tank island should have dissolved, got: ' + bearG.players.map(p => p.name).join(','));
```

- [ ] **Step 5: Run full suite.** Other layout-pin optimizer tests (destro locks with caster totems, enh keeps WF group, clean seed unchanged) are PREDICTED green — the guards' removal only ADDS candidate moves, and those layouts are already local optima under the new units. Any failure: classify per Global Constraints; if the "clean seed comes back unchanged" test breaks, that is a genuine finding about the new objective — STOP and surface to Max with the before/after layouts. Paste output.

- [ ] **Step 6: Commit** — `feat: v2 unrestricted hill-climb (spec §9.1: guardian-with-hunters pin superseded by twisting ruling + DPS objective)`

---

### Task 9: Output — score, violations, alternates, marginals + panel rendering

**Files:**
- Modify: `assignments-engine.js` (end of `proposeGroups`, before `return`), `assignments.js` (`renderGroups`, ~434–471)
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Consumes: Task 7/8 climb; `trySwap`.
- Produces: `proposeGroups` returns `{ groups, unplaced, score, violations, alternates, marginals }`
  where `alternates: [{ change: string, deltaPct: number }]` (≤ 2, strictly-worse, feasibility-equal,
  sorted best-first) and `marginals: { [name]: costPct }` (≥ 0, cost of the player's best
  alternative seat). UI renders a score line, per-player `title` tooltips, and an alternates box.

- [ ] **Step 1: Write the failing test**

```js
test('v2: proposeGroups returns score, violations, alternates, marginals', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(typeof res.score, 'number');
    assert.ok(res.score > 0);
    assert.strictEqual(typeof res.violations, 'number');
    assert.ok(Array.isArray(res.alternates) && res.alternates.length <= 2);
    res.alternates.forEach(a => {
        assert.strictEqual(typeof a.change, 'string');
        assert.ok(a.deltaPct < 0, 'alternates must be strictly worse: ' + a.deltaPct);
    });
    Object.keys(res.marginals).forEach(n => assert.ok(res.marginals[n] >= 0));
});
```

- [ ] **Step 2: Run — expect FAILING** (`res.score` undefined). Paste output.

- [ ] **Step 3: Implement** in `proposeGroups` after the climb, before the relabel block:

```js
        // Final neighbor sweep (spec §8): the two best strictly-worse alternatives, and each
        // player's marginal seat cost — same enumeration order as the climb, so deterministic.
        const finalV = layoutViolations(groups), finalS = scoreLayout(groups);
        const alternates = [], marginals = {};
        function record(names, s) {
            const deltaPct = finalS ? (s - finalS) / finalS * 100 : 0;
            if (deltaPct < -1e-9) alternates.push({ change: names.join(' ↔ '), deltaPct });
            names.forEach(n => {
                const cost = -deltaPct;
                if (!(n in marginals) || cost < marginals[n]) marginals[n] = cost;
            });
        }
        for (let a = 0; a < groups.length; a++) {
            for (let ia = 0; ia < groups[a].players.length; ia++) {
                for (let b = 0; b < groups.length; b++) {
                    if (b === a) continue;
                    if (b > a) {
                        for (let ib = 0; ib < groups[b].players.length; ib++) {
                            trySwap(groups[a], ia, groups[b], ib);
                            if (layoutViolations(groups) === finalV) {
                                record([groups[b].players[ib].name, groups[a].players[ia].name], scoreLayout(groups));
                            }
                            trySwap(groups[a], ia, groups[b], ib);
                        }
                    }
                    if (groups[b].players.length < GROUP_CAP) {
                        const p = groups[a].players[ia];
                        groups[a].players.splice(ia, 1);
                        groups[b].players.push(p);
                        if (layoutViolations(groups) === finalV) record([p.name], scoreLayout(groups));
                        groups[b].players.pop();
                        groups[a].players.splice(ia, 0, p);
                    }
                }
            }
        }
        alternates.sort((x, y) => y.deltaPct - x.deltaPct);
        alternates.length = Math.min(alternates.length, 2);
        alternates.forEach(a => { a.deltaPct = Math.round(a.deltaPct * 10) / 10; });
        Object.keys(marginals).forEach(n => { marginals[n] = Math.round(marginals[n] * 10) / 10; });
```

(Note: after a swap, `groups[b].players[ib]` holds the player who CAME FROM a and vice versa —
capture both names while swapped, as above.) Extend the return:
`return { groups, unplaced, score: finalS, violations: finalV, alternates, marginals };`

In `renderGroups` (assignments.js), after the group cards loop and before the `unplaced` warning:

```js
    if (typeof res.score === 'number') {
        const meta = document.createElement('div');
        meta.className = 'group-note';
        meta.textContent = 'Layout score: ' + Math.round(res.score) + ' raid DPS (model)'
            + (res.violations ? ' — ⚠ floor violations: ' + res.violations : '');
        box.appendChild(meta);
        (res.alternates || []).forEach(a => {
            const alt = document.createElement('div');
            alt.className = 'group-note';
            alt.textContent = 'Alternative: ' + a.change + ' (' + a.deltaPct + '%)';
            box.appendChild(alt);
        });
    }
```

and inside the per-player row loop:
`if (res.marginals && res.marginals[p.name] != null) row.title = 'Moving ' + p.name + ' to their best other seat costs ' + res.marginals[p.name] + '% raid DPS';`

- [ ] **Step 4: Run full suite — green. Paste output.** UI check per memory `wowstuff-verification-harness` (headless Chrome over CDP — no browser tool in this environment): load `assignments.html`, import the SSC fixture roster, screenshot the Groups panel, confirm score line + alternates render.

- [ ] **Step 5: Commit** — `feat: v2 output — layout score, floor violations, top alternates, per-seat marginal costs`

---

### Task 10: Player tuning UI — MT flag + multiplier

**Files:**
- Modify: `assignments.js` (roster-compute step ~34–78; `renderGroups`), `assignments.css` (one rule)
- Test: manual via the CDP harness (engine behavior was tested in Tasks 2/7)

**Interfaces:**
- Consumes: `state` + `saveState()` + `renderAll()` (existing); `p.mt`/`p.mult` engine reads (Tasks 2/7).
- Produces: `state.playerMeta = { [name]: { mt: boolean, mult: number } }`, applied to every roster player each recompute; a collapsed `<details>` "Player tuning" strip at the top of the Groups panel.

- [ ] **Step 1: Apply meta in the compute step.** Right after the roster array is finalized (immediately before the `E.autoAssign(roster, state.overrides)` call ~line 78):

```js
    if (!state.playerMeta) state.playerMeta = {};
    roster.forEach(p => {
        const m = state.playerMeta[p.name];
        if (m) { p.mt = !!m.mt; if (typeof m.mult === 'number' && m.mult > 0) p.mult = m.mult; }
    });
```

- [ ] **Step 2: Render the strip.** At the top of `renderGroups`, after the `roster.length` guard:

```js
    const tune = document.createElement('details');
    tune.className = 'player-tuning';
    const sum = document.createElement('summary');
    sum.textContent = 'Player tuning (MT flag / DPS multiplier)';
    tune.appendChild(sum);
    roster.forEach(p => {
        const m = state.playerMeta[p.name] || {};
        const row = document.createElement('div');
        row.className = 'tuning-row';
        const label = document.createElement('span');
        label.textContent = p.name;
        label.style.color = E.CLASS_COLORS[p.class];
        const mt = document.createElement('input');
        mt.type = 'checkbox';
        mt.checked = !!m.mt;
        mt.title = 'Main tank — the optimizer guarantees a shaman in this group';
        mt.addEventListener('change', () => {
            state.playerMeta[p.name] = Object.assign({}, state.playerMeta[p.name], { mt: mt.checked });
            renderAll();
        });
        const mult = document.createElement('input');
        mult.type = 'number';
        mult.min = '0.5'; mult.max = '2'; mult.step = '0.05';
        mult.value = typeof m.mult === 'number' ? m.mult : 1;
        mult.title = 'Relative output vs an average player of this spec (gear/skill)';
        mult.addEventListener('change', () => {
            state.playerMeta[p.name] = Object.assign({}, state.playerMeta[p.name], { mult: parseFloat(mult.value) || 1 });
            renderAll();
        });
        row.appendChild(mt); row.appendChild(label); row.appendChild(mult);
        tune.appendChild(row);
    });
    box.appendChild(tune);
```

Add to `assignments.css`: `.tuning-row { display: flex; gap: 8px; align-items: center; } .tuning-row input[type=number] { width: 64px; }`

- [ ] **Step 3: Verify via the CDP harness** (memory `wowstuff-verification-harness`): import the fixture roster, tick MT on the prot warrior, confirm the layout re-renders with a shaman in his group and the setting survives a reload (localStorage). Screenshot before/after.

- [ ] **Step 4: Run `node assignments-engine.test.js` — still green (UI-only change). Paste output.**

- [ ] **Step 5: Commit** — `feat: v2 player tuning — MT flag and manual multiplier, persisted in state.playerMeta`

---

### Task 11: Calibration scaffolding — pinned checkout, profiles via decodelink

**Files:**
- Create: `calibration/README.md`, `calibration/links.txt`, `calibration/decode-profiles.mjs`
- Modify: `.gitignore` (add `calibration/vendor/`, `calibration/out/`)

**Interfaces:**
- Produces: `calibration/vendor/tbc-new` (pinned checkout, gitignored); `calibration/profiles/<CLASS>_<Spec>.json` — one `IndividualSimSettings` protojson per DPS/tank spec (committed); the built `calibration/vendor/wowsimcli` binary.

- [ ] **Step 1: Vendor checkout + build.**

```bash
mkdir -p calibration && cd calibration
git clone --depth 50 https://github.com/wowsims/tbc-new vendor/tbc-new
git -C vendor/tbc-new rev-parse HEAD   # record this SHA in README.md
cd vendor/tbc-new && go build -o ../wowsimcli ./cmd/wowsimcli && cd ../..
./vendor/wowsimcli --help   # expect usage text with `sim` and `decodelink` subcommands
```

If `go build` fails (protos not generated), run the repo's `make` target for Go protos first
(`make proto` or see `vendor/tbc-new/README.md`) — if that also fails, STOP and surface.

- [ ] **Step 2: Verify the hosted UI matches the pinned CLI.** Open `https://wowsims.github.io/tbc/hunter/` (confirmed live 2026-08-13), load the P2/SSC BiS gear preset + default APL + full raid-buff defaults, use the export/share-link feature, then:

```bash
./vendor/wowsimcli decodelink '<pasted link>' > profiles/HUNTER_Beast_Mastery.json
node -e "const j = require('./profiles/HUNTER_Beast_Mastery.json'); if (!j.player || !j.encounter) throw new Error('unexpected shape'); console.log('ok:', Object.keys(j).join(','))"
```

⚠️ **Checkpoint:** if `decodelink` errors or the JSON lacks `player`/`encounter`, the hosted site
is running a different proto vintage than the pinned checkout. STOP and surface to Max with the
two options (build tbc-new's UI locally via its Makefile, or hand-assemble profiles from
`ui/*/presets.ts` + `gear_sets/*.gear.json`). Do not improvise a third path.

- [ ] **Step 3: Capture the remaining profiles.** One share link per spec into `links.txt`
(`<CLASS>:<Spec> <url>` per line), then `decode-profiles.mjs` loops them:

```js
#!/usr/bin/env node
// Decodes every link in links.txt into profiles/<CLASS>_<Spec>.json via wowsimcli.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('./profiles/', import.meta.url), { recursive: true });
for (const raw of readFileSync(new URL('./links.txt', import.meta.url), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Format: `CLASS:Spec Name <url>` — the URL is everything after the LAST space.
    const cut = line.lastIndexOf(' ');
    const specKey = line.slice(0, cut).trim(), url = line.slice(cut + 1);
    if (!/^https?:\/\//.test(url) || specKey.indexOf(':') === -1) { console.error('skipping unparseable line:', line); continue; }
    const [cls, spec] = [specKey.slice(0, specKey.indexOf(':')), specKey.slice(specKey.indexOf(':') + 1)];
    const out = execFileSync(new URL('./vendor/wowsimcli', import.meta.url).pathname, ['decodelink', url]);
    const file = `profiles/${cls}_${spec.replace(/ /g, '_')}.json`;
    writeFileSync(new URL('./' + file, import.meta.url), out);
    console.log('wrote', file);
}
```

Specs to capture (the guild roster's DPS + tanks; healers have no sim and stay baseline 0 by
design): `WARRIOR:Fury`, `WARRIOR:Arms`, `WARRIOR:Protection`, `PALADIN:Retribution`,
`PALADIN:Protection`, `HUNTER:Beast Mastery`, `HUNTER:Survival`, `HUNTER:Marksmanship`,
`ROGUE:Combat`, `PRIEST:Shadow`, `SHAMAN:Elemental`, `SHAMAN:Enhancement`, `MAGE:Arcane`,
`WARLOCK:Destruction`, `DRUID:Feral`, `DRUID:Guardian` (feral_tank_druid page), `DRUID:Balance`.

- [ ] **Step 4: Smoke-run one sim.** Wrap one profile into a `RaidSimRequest` by hand (or run Task 12's builder early) and `./vendor/wowsimcli sim --infile … | node -e "…assert dps.avg > 0"`. Paste the dps number.

- [ ] **Step 5: Write `README.md`**: pinned SHA, capture instructions, and the three standing
caveats copied verbatim from spec §7.5 (Anniversary-vs-2.5.x divergences; BiS spell-hit headroom
overstating Totem of Wrath; single-toggle marginals missing WF×GoA interaction) plus: baseline
runs all air totems simultaneously (unphysical but fine for marginals — noted), `totemTwisting`
stays false, Mana Spring/Tide have no DPS sim and keep zero weights.

- [ ] **Step 6: Commit** — `feat: calibration scaffolding — pinned wowsims checkout, profile capture via decodelink`

---

### Task 12: Calibration pipeline — requests, runs, weights, injection

**Files:**
- Create: `calibration/build-requests.mjs`, `calibration/run-sims.mjs`, `calibration/make-weights.mjs`, `calibration/inject-weights.mjs`
- Generate: `calibration/weights.json`, `calibration/floors-report.md`, rewritten calibration block in `assignments-engine.js`

**Interfaces:**
- Consumes: `profiles/*.json` (Task 11); the engine's `=== CALIBRATION START/END ===` markers (Task 1); `E.PARTY_BUFFS` row names.
- Produces: `weights.json`: `{ meta: { wowsimsSha, encounter, iterations, date }, baselines: { [specKey]: dps }, buffs: { [buffName]: { [specKey]: v } } }`. The injected block defines `BASELINE` and `BUFF_V` as literals (leave `expandV` defined above the markers; it simply goes unused).

- [ ] **Step 1: Verify the toggle vocabulary.** `grep -n "enum TristateEffect" -A 5 calibration/vendor/tbc-new/proto/common.proto` — confirm the value names (expected `TristateEffectMissing/Regular/Improved`). Adjust the maps below if they differ; if the enum is serialized as numbers in decoded profiles, use the numeric forms consistently.

- [ ] **Step 2: `build-requests.mjs`.**

```js
#!/usr/bin/env node
// For each profile: one fully-buffed baseline RaidSimRequest + one request per buff toggled off.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const BASE_PARTY = {
    windfuryTotem: 'TristateEffectImproved', graceOfAirTotem: 'TristateEffectImproved',
    wrathOfAirTotem: 'TristateEffectRegular', strengthOfEarthTotem: 'TristateEffectImproved',
    totemOfWrath: 1, manaSpringTotem: 'TristateEffectRegular', manaTideTotems: 1,
    battleShout: 'TristateEffectImproved', ferociousInspiration: 1, trueshotAura: true,
    moonkinAura: 'TristateEffectRegular', leaderOfThePack: 'TristateEffectRegular',
    sanctityAura: 'TristateEffectRegular', devotionAura: 'TristateEffectRegular',
    retributionAura: 'TristateEffectRegular', concentrationAura: 'TristateEffectRegular',
    draeneiRacialMelee: true, draeneiRacialCaster: true,
};
const BASE_INDIVIDUAL = { unleashedRage: true, shadowPriestDps: 500 };
// buffName (MUST match engine PARTY_BUFFS names) -> [scope, field, offValue]
const TOGGLES = {
    'Windfury Totem': ['party', 'windfuryTotem', 'TristateEffectMissing'],
    'Grace of Air': ['party', 'graceOfAirTotem', 'TristateEffectMissing'],
    'Wrath of Air': ['party', 'wrathOfAirTotem', 'TristateEffectMissing'],
    'Strength of Earth': ['party', 'strengthOfEarthTotem', 'TristateEffectMissing'],
    'Totem of Wrath': ['party', 'totemOfWrath', 0],
    'Battle Shout': ['party', 'battleShout', 'TristateEffectMissing'],
    'Ferocious Inspiration': ['party', 'ferociousInspiration', 0],
    'Trueshot Aura': ['party', 'trueshotAura', false],
    'Moonkin Aura': ['party', 'moonkinAura', 'TristateEffectMissing'],
    'Leader of the Pack': ['party', 'leaderOfThePack', 'TristateEffectMissing'],
    'Sanctity Aura': ['party', 'sanctityAura', 'TristateEffectMissing'],
    'Devotion Aura': ['party', 'devotionAura', 'TristateEffectMissing'],
    'Retribution Aura': ['party', 'retributionAura', 'TristateEffectMissing'],
    'Concentration Aura': ['party', 'concentrationAura', 'TristateEffectMissing'],
    'Heroic Presence': ['party', 'draeneiRacialMelee', false],
    'Inspiring Presence': ['party', 'draeneiRacialCaster', false],
    'Unleashed Rage': ['individual', 'unleashedRage', false],
    'Vampiric Touch': ['individual', 'shadowPriestDps', 0],
};

function makeRequest(settings, partyOverrides, individualOverrides) {
    const player = JSON.parse(JSON.stringify(settings.player));
    player.buffs = Object.assign({}, BASE_INDIVIDUAL, individualOverrides);
    return {
        raid: {
            parties: [{ players: [player], buffs: Object.assign({}, BASE_PARTY, partyOverrides) }],
            buffs: settings.raidBuffs || {},
            debuffs: settings.debuffs || {},
            tanks: settings.tanks || [],
        },
        encounter: Object.assign({}, settings.encounter, { duration: 180, durationVariation: 0 }),
        simOptions: { iterations: 10000, randomSeed: 42 },
    };
}

mkdirSync(new URL('./out/requests/', import.meta.url), { recursive: true });
for (const f of readdirSync(new URL('./profiles/', import.meta.url)).filter(f => f.endsWith('.json'))) {
    const specKey = f.replace('.json', '');
    const settings = JSON.parse(readFileSync(new URL('./profiles/' + f, import.meta.url), 'utf8'));
    const w = (name, req) =>
        writeFileSync(new URL(`./out/requests/${specKey}__${name}.json`, import.meta.url), JSON.stringify(req, null, 1));
    w('BASELINE', makeRequest(settings, {}, {}));
    for (const [buff, [scope, field, off]] of Object.entries(TOGGLES)) {
        w(buff.replace(/ /g, '_'),
          makeRequest(settings, scope === 'party' ? { [field]: off } : {}, scope === 'individual' ? { [field]: off } : {}));
    }
}
console.log('requests written');
```

- [ ] **Step 3: `run-sims.mjs`** — run every request through the CLI, collect metrics:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const cli = new URL('./vendor/wowsimcli', import.meta.url).pathname;
const results = {};
for (const f of readdirSync(new URL('./out/requests/', import.meta.url)).sort()) {
    const inPath = new URL('./out/requests/' + f, import.meta.url).pathname;
    const out = JSON.parse(execFileSync(cli, ['sim', '--infile', inPath], { maxBuffer: 64 * 1024 * 1024 }));
    const m = out.raidMetrics.parties[0].players[0];
    results[f.replace('.json', '')] = {
        dps: m.dps.avg, tps: m.threat && m.threat.avg, dtps: m.dtps && m.dtps.avg,
    };
    console.log(f, '->', Math.round(m.dps.avg), 'dps');
}
writeFileSync(new URL('./out/results.json', import.meta.url), JSON.stringify(results, null, 1));
```

- [ ] **Step 4: `make-weights.mjs`** — `v = baseline/without − 1` per (spec, buff), noise-floored:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const results = JSON.parse(readFileSync(new URL('./out/results.json', import.meta.url), 'utf8'));
const baselines = {}, buffs = {}, floors = [];
for (const key of Object.keys(results)) {
    const [specFile, buffFile] = key.split('__');
    const specKey = specFile.replace('_', ':').replace(/_/g, ' '); // WARRIOR_Beast_Mastery -> WARRIOR:Beast Mastery
    if (buffFile === 'BASELINE') {
        baselines[specKey] = Math.round(results[key].dps);
        if (results[key].tps != null) floors.push({ specKey, tps: results[key].tps, dtps: results[key].dtps });
    }
}
for (const key of Object.keys(results)) {
    const [specFile, buffFile] = key.split('__');
    if (buffFile === 'BASELINE') continue;
    const specKey = specFile.replace('_', ':').replace(/_/g, ' ');
    const buffName = buffFile.replace(/_/g, ' ');
    const v = baselines[specKey] / results[key].dps - 1;
    (buffs[buffName] = buffs[buffName] || {})[specKey] = Math.abs(v) < 0.002 ? 0 : Math.round(v * 1e4) / 1e4;
}
// Healers: no sims by design — zero baselines, present so the engine lookup never misses.
for (const k of ['PRIEST:Holy', 'PRIEST:Discipline', 'PALADIN:Holy', 'SHAMAN:Restoration', 'DRUID:Restoration'])
    baselines[k] = 0;
const weights = {
    meta: { wowsimsSha: process.env.WOWSIMS_SHA || 'see README', encounter: '180s single target',
            iterations: 10000, date: process.argv[2] || 'set-me' },
    baselines, buffs,
};
writeFileSync(new URL('./weights.json', import.meta.url), JSON.stringify(weights, null, 1));
writeFileSync(new URL('./floors-report.md', import.meta.url),
    '# Tank TPS/DTPS from calibration baselines\n\n' +
    floors.map(f => `- ${f.specKey}: TPS ${Math.round(f.tps)}, DTPS ${Math.round(f.dtps)}`).join('\n') + '\n');
console.log('weights.json + floors-report.md written');
```

(Pass the date as an argv — `Date.now` is fine in node scripts, but an explicit stamp keeps reruns
reproducible: `node make-weights.mjs 2026-08-14`.) ⚠️ The `specFile → specKey` reconstruction must
invert Task 11's naming exactly (`CLASS_Spec_Name.json`, class never contains `_`) — the first
`replace('_', ':')` handles it; verify with `HUNTER_Beast_Mastery`.

- [ ] **Step 5: `inject-weights.mjs`** — rewrite the engine block:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const enginePath = new URL('../assignments-engine.js', import.meta.url);
const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8'));
const engine = readFileSync(enginePath, 'utf8');
const START = /\/\/ === CALIBRATION START[^\n]*\n/, END = '// === CALIBRATION END ===';
const startIdx = engine.search(START), endIdx = engine.indexOf(END);
if (startIdx === -1 || endIdx === -1) throw new Error('calibration markers not found');
const headerEnd = startIdx + engine.match(START)[0].length;
const block =
    `    // Generated by calibration/inject-weights.mjs from calibration/weights.json.\n` +
    `    // Provenance: wowsims ${weights.meta.wowsimsSha}, ${weights.meta.encounter}, ` +
    `${weights.meta.iterations} iterations, ${weights.meta.date}. DO NOT HAND-EDIT.\n` +
    `    const BASELINE = ${JSON.stringify(weights.baselines, null, 8).replace(/\n/g, '\n    ')};\n` +
    `    const BUFF_V = ${JSON.stringify(weights.buffs, null, 8).replace(/\n/g, '\n    ')};\n    `;
writeFileSync(enginePath, engine.slice(0, headerEnd) + block + engine.slice(endIdx));
console.log('engine calibration block rewritten');
```

⚠️ `weights.buffs` must contain a key for EVERY `PARTY_BUFFS` row name (Mana Spring/Tide as `{}`) —
add them in make-weights if missing, and assert here:
`['Mana Spring Totem','Mana Tide Totem'].forEach(k => { weights.buffs[k] = weights.buffs[k] || {}; });`

- [ ] **Step 6: Run the full pipeline** (`build-requests` → `run-sims` → `make-weights` → `inject-weights`), then `node assignments-engine.test.js`. Failures now are (b)/(c) classifications — real numbers may legitimately reorder layouts; each newly-failing pinned layout goes through the Global Constraints triage (most will be §9.4 updates justified by "measured value replaced provisional"; anything WEIRD — e.g. Windfury near zero for Fury — means a toggle bug: STOP). Paste suite output and 3 spot-check values (WF/Fury, ToW/Arcane, FI/Destruction) with their baseline-vs-without dps numbers.

- [ ] **Step 7: Commit** — `feat: calibration pipeline — sim-measured per-spec buff values injected into the engine` (weights.json, floors-report.md, scripts, engine block, any §9.4 test updates).

---

### Task 13: Gap measurement — is exact search worth building?

**Files:**
- Create: `calibration/measure-gap.mjs`
- Update: `calibration/README.md` (record the verdict)

**Interfaces:**
- Consumes: `E.proposeGroups`, `E.scoreLayout`, `E.layoutViolations` via `require('../assignments-engine.js')`.
- Produces: printed gap report + a "Gap measurement" section in README. Decision rule (Max's ruling): gap > ~1% → write a follow-up plan for exact set-partitioning search; else record and stop.

- [ ] **Step 1: Write `measure-gap.mjs`.**

```js
#!/usr/bin/env node
// Brute-force the true optimum for small rosters (n <= 11) and compare with the hill-climb.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../assignments-engine.js');

const P = (name, cls, spec) => ({ name, class: cls, spec });
const ROSTERS = {
    'enh-melee-hunters-10': [
        P('Enh', 'SHAMAN', 'Enhancement'), P('W1', 'WARRIOR', 'Fury'), P('W2', 'WARRIOR', 'Fury'),
        P('W3', 'WARRIOR', 'Arms'), P('H1', 'HUNTER', 'Beast Mastery'), P('Sh2', 'SHAMAN', 'Restoration'),
        P('H2', 'HUNTER', 'Beast Mastery'), P('H3', 'HUNTER', 'Survival'), P('Cat', 'DRUID', 'Feral'),
        P('R1', 'ROGUE', 'Combat'),
    ],
    'caster-pally-9': [
        P('Ele', 'SHAMAN', 'Elemental'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane'),
        P('L1', 'WARLOCK', 'Destruction'), P('PP', 'PALADIN', 'Protection'), P('SP', 'PRIEST', 'Shadow'),
        P('H1', 'PRIEST', 'Holy'), P('H2', 'DRUID', 'Restoration'), P('RSh', 'SHAMAN', 'Restoration'),
    ],
};

function bestPartition(roster, groupCount) {
    let best = null;
    const groups = Array.from({ length: groupCount }, () => []);
    (function assign(i, maxUsed) {
        if (i === roster.length) {
            const layout = groups.map(g => ({ role: 'x', players: g.slice() }));
            const v = E.layoutViolations(layout), s = E.scoreLayout(layout);
            if (!best || v < best.v || (v === best.v && s > best.s)) best = { v, s };
            return;
        }
        // canonical: player i may open at most one new group — kills group-permutation symmetry
        for (let g = 0; g <= Math.min(maxUsed + 1, groupCount - 1); g++) {
            if (groups[g].length >= 5) continue;
            groups[g].push(roster[i]);
            assign(i + 1, Math.max(maxUsed, g));
            groups[g].pop();
        }
    })(0, -1);
    return best;
}

for (const [name, roster] of Object.entries(ROSTERS)) {
    const groupCount = Math.min(5, Math.ceil(roster.length / 5));
    const exact = bestPartition(roster, groupCount);
    const res = E.proposeGroups(roster);
    const gapPct = exact.s ? (exact.s - res.score) / exact.s * 100 : 0;
    console.log(`${name}: exact (v=${exact.v}) ${exact.s.toFixed(1)} vs climb (v=${res.violations}) ${res.score.toFixed(1)} -> gap ${gapPct.toFixed(2)}%`);
}
```

- [ ] **Step 2: Run it.** Paste the output. Sanity: gaps must be ≥ −0.01% (the climb can never beat
the true optimum; a negative gap beyond float noise means `bestPartition` and `proposeGroups`
disagree about scoring — likely the climb layout has fewer groups than `groupCount`; investigate before trusting anything).

- [ ] **Step 3: Record the verdict in README** ("Gap measurement (date): X% / Y% — exact search
[not] warranted per Max's ruling") and, if > 1%, note that a follow-up plan is needed — do NOT
build it in this plan.

- [ ] **Step 4: Commit** — `chore: measure hill-climb vs exact optimum gap — verdict recorded`

---

### Task 14: Sim verification of top layouts

**Files:**
- Create: `calibration/sim-verify.mjs`
- Update: `calibration/README.md` (verdict section)

**Interfaces:**
- Consumes: `profiles/*.json` (players by specKey), `E.proposeGroups`, the CLI.
- Produces: for a roster JSON (`[{name, class, spec}]` — export the live roster from the app or hand-write the SSC fixture), sims the model's chosen layout AND its 2 alternates as full raids and reports whether the sim agrees with the model's ranking. Disagreement = the spec's trigger to revisit per-player gear inputs.

- [ ] **Step 1: Write `sim-verify.mjs`.**

```js
#!/usr/bin/env node
// Usage: node sim-verify.mjs roster.json
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const E = require('../assignments-engine.js');

const roster = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const profileFor = p => {
    const f = new URL(`./profiles/${p.class}_${(p.spec || '').replace(/ /g, '_')}.json`, import.meta.url);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; // healers: null, simmed as absent
};
function simLayout(groups, label) {
    const anyProfile = profileFor(roster.find(p => profileFor(p)));
    const req = {
        raid: {
            parties: groups.map(g => ({
                players: g.players.map(p => {
                    const prof = profileFor(p);
                    if (!prof) return null;
                    const pl = JSON.parse(JSON.stringify(prof.player));
                    pl.name = p.name;
                    return pl;
                }).filter(Boolean),
                buffs: {}, // real providers in the party — proto buff bots stay OFF
            })),
            buffs: anyProfile.raidBuffs || {}, debuffs: anyProfile.debuffs || {}, tanks: [],
        },
        encounter: Object.assign({}, anyProfile.encounter, { duration: 180 }),
        simOptions: { iterations: 5000, randomSeed: 42 },
    };
    const inPath = new URL(`./out/verify_${label}.json`, import.meta.url).pathname;
    writeFileSync(inPath, JSON.stringify(req));
    const out = JSON.parse(execFileSync(new URL('./vendor/wowsimcli', import.meta.url).pathname,
        ['sim', '--infile', inPath], { maxBuffer: 64 * 1024 * 1024 }));
    return out.raidMetrics.parties.reduce((s, pt) =>
        s + pt.players.reduce((s2, pl) => s2 + pl.dps.avg, 0), 0);
}
const res = E.proposeGroups(roster);
console.log('model layout:', Math.round(res.score), 'model-DPS; simming...');
console.log('sim says:', Math.round(simLayout(res.groups, 'best')), 'raid DPS');
// Alternates are swap descriptions; to sim them, apply each swap to a copy of the layout by name.
for (let i = 0; i < res.alternates.length; i++) {
    const alt = res.alternates[i];
    const names = alt.change.split(' ↔ ');
    const copy = res.groups.map(g => ({ role: g.role, players: g.players.slice() }));
    if (names.length === 2) {
        const find = n => { for (const g of copy) { const j = g.players.findIndex(p => p.name === n); if (j !== -1) return [g, j]; } };
        const [ga, ia] = find(names[0]), [gb, ib] = find(names[1]);
        const t = ga.players[ia]; ga.players[ia] = gb.players[ib]; gb.players[ib] = t;
        console.log(`alternate ${i + 1} (${alt.change}, model ${alt.deltaPct}%):`,
            Math.round(simLayout(copy, 'alt' + i)), 'raid DPS');
    }
}
```

- [ ] **Step 2: Run it against the SSC fixture roster** (write the Task-8 regression roster to
`calibration/ssc-roster.json`). Paste the model-vs-sim numbers. Agreement criterion: the sim ranks
the model's layout ≥ its alternates (within sim noise, ~0.3% at 5000 iterations). Note: move-type
alternates (single name, no `↔`) are skipped by this script — fine, swaps dominate on full rosters.

- [ ] **Step 3: Record the verdict in README.** If the sim DISAGREES with the model's ranking,
record the numbers and STOP — that is the spec §8 trigger for Max to decide on per-player gear
inputs; do not tune weights ad hoc.

- [ ] **Step 4: Commit** — `chore: sim-verify the model's layout ranking against wowsimcli`

---

## Self-review (done at planning time)

- **Spec coverage:** §1 score model → Tasks 1–2; §2 floors → Task 7; §3 table → Tasks 3–6; §4
  weights layers → Tasks 1 + 12; §5 search → Tasks 7–8; §6 inputs → Task 10 (+ engine reads in
  2/7); §7 harness → Tasks 11–12; §8 output/measurement/verification → Tasks 9, 13, 14; §9 test
  policy → Global Constraints + named steps; §10 exclusions → nowhere (correct).
- **Known planning risks, called out where they bite:** hosted-UI/proto vintage mismatch (Task 11
  checkpoint), TristateEffect value names (Task 12 Step 1), layout-pin fallout when units change
  (Tasks 2, 8, 12 triage), Task 8's fixture prediction (prove-it-fails step), specKey filename
  round-trip (Task 12 Step 4 warning).
- **Type consistency:** `groupBuffs -> [{buff, count}]` consumed by `playerBuffScore` (T2),
  notes (T4–6), `layoutViolations` via `airChoiceNames` (T7); `proposeGroups` return shape (T9)
  consumed by `renderGroups` (T9) and `sim-verify` (T14); `weights.json` shape (T12) consumed by
  `inject-weights` (T12). Names checked: `specKey`, `BASELINE`, `BUFF_V`, `multOf`,
  `groupValueOf`, `presenceKind`, `airChoiceNames`, `auraNames`, `layoutViolations` — each defined
  exactly once, in the task listed first.
