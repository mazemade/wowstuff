# Group Optimizer + AI Second-Opinion Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `proposeGroups` buff-aware (deterministic hill-climb over a party-buff value model) and add an advisory "AI second opinion" button backed by a server-side OpenAI proxy.

**Architecture:** A `PARTY_BUFFS` weight table plus `playerBuffScore`/`scoreLayout` feed a hill-climb pass appended to `proposeGroups`' existing seeding passes; the air-totem `NOTE_RULES` are rewritten to delegate to the same model so score and notes cannot disagree. Separately, `server.js` gains `POST /api/ai-review` (OpenAI chat completions, key from a gitignored `.env`), and the UI gains one button that renders the returned critique as text.

**Tech Stack:** Plain JS (UMD engine, no build step), Node ≥ 18 (global `fetch`, `AbortSignal.timeout`), Express, `node:assert` test harness.

**Spec:** `docs/superpowers/specs/2026-08-13-group-optimizer-ai-review-design.md` — read it before ruling on any ambiguity; it is the authority this plan argues from.

## Global Constraints

- Test command: `node assignments-engine.test.js`. Baseline: **225 passed, 0 failed**; every task ends with 0 failures; expected final count **245 passed, 0 failed** (Task 1 adds 6, Task 2 adds 2, Task 3 adds 4, Task 4 adds 8).
- TDD is literal: run each new test before implementing and confirm it fails for the predicted reason. Where this plan explicitly predicts a coincidental PASS (regression guards), the plan wins — keep the test, do not "fix" it.
- **Never modify `style.css`** — it has uncommitted user edits. UI styling in this plan is inline attributes only.
- **Never modify or delete existing tests.** If an existing test fails after your change, STOP and escalate (status BLOCKED) with the failing output — several existing air-totem tests deliberately pin rulings this plan must preserve.
- Standing ruling the score model must encode: **an Elemental shaman always keeps Wrath of Air** (never Windfury/Grace of Air), matching the existing note tests.
- `.env` already exists at the repo root with `OPENAI_API_KEY` (created out-of-band) and is gitignored. Never print its contents, never commit it, never hardcode a key anywhere.
- Exactly two live OpenAI calls are permitted during this plan: the Task 5 happy-path curl and the Task 7 button click. The automated suite must never make network calls.
- One commit per task; commit messages in the repo's existing style (`feat:`/`fix:`/`docs:` + one-line why).
- Engine code style: 4-space indent, single quotes, `function` declarations inside the UMD body, comments explain constraints not mechanics.

---

### Task 1: Party-buff value model (`buffArchetype`, `PARTY_BUFFS`, `groupBuffs`, `playerBuffScore`)

**Files:**
- Modify: `assignments-engine.js` (insert after `const GROUP_CAP = 5;`, currently line ~829; also extend the export object at the bottom)
- Test: `assignments-engine.test.js` (append new tests immediately BEFORE the final two summary lines `console.log(\`\n${passed} passed...\`)` / `process.exitCode = ...`; same for every later task)

**Interfaces:**
- Consumes: `isFeralSpec(spec)` (already in the engine, top of the UMD body).
- Produces: `playerBuffScore(p, players)` → number; `groupBuffs(players)` → array of buff rows (each `{ name, element?, provided, w }`), at most one row with `element === 'air'`; `buffArchetype(p)` → string. `playerBuffScore` is exported; `groupBuffs`/`buffArchetype`/`PARTY_BUFFS` stay internal. Task 2 consumes `playerBuffScore`; Task 3 consumes `groupBuffs`.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js` (before the summary lines):

```js
// --- Optimizer Task 1: party-buff value model ---
test('playerBuffScore: rogue with an enhancement shaman gets Windfury, Strength of Earth, Unleashed Rage', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Rog', 'ROGUE', 'Combat')];
    assert.strictEqual(E.playerBuffScore(g[1], g), 18); // WF 10 + SoE 3 + UR 5
});
test('playerBuffScore: enhancement shaman gains nothing from its own Windfury Totem', () => {
    const g = [P('Enh', 'SHAMAN', 'Enhancement'), P('Rog', 'ROGUE', 'Combat')];
    assert.strictEqual(E.playerBuffScore(g[0], g), 3); // SoE only — imbues beat the totem, UR is its own
});
test('playerBuffScore: hunter with a resto shaman scores Grace of Air, not Windfury', () => {
    const g = [P('Resto', 'SHAMAN', 'Restoration'), P('Hunt', 'HUNTER', 'Beast Mastery')];
    assert.strictEqual(E.playerBuffScore(g[1], g), 11); // GoA 7 + Mana Tide 1 + own Ferocious 3
});
test('playerBuffScore: caster with a resto shaman scores Wrath of Air', () => {
    const g = [P('Resto', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    assert.strictEqual(E.playerBuffScore(g[1], g), 9); // WoA 7 + Mana Tide 2
});
test('playerBuffScore: a second same-spec shaman adds nothing', () => {
    const one = [P('Resto', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    const two = [P('Resto', 'SHAMAN', 'Restoration'), P('Resto2', 'SHAMAN', 'Restoration'), P('Mage', 'MAGE', 'Arcane')];
    assert.strictEqual(E.playerBuffScore(two[2], two), E.playerBuffScore(one[1], one));
});
test('playerBuffScore: an Elemental shaman pins air to Wrath of Air even with melee', () => {
    const g = [P('Ele', 'SHAMAN', 'Elemental'), P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat')];
    assert.strictEqual(E.playerBuffScore(g[1], g), 3); // SoE 3 only — no Windfury, ToW is caster-only
});
```

- [ ] **Step 2: Run the tests, confirm they fail for the right reason**

Run: `node assignments-engine.test.js 2>&1 | grep -A1 "FAIL"`
Expected: exactly the 6 new tests FAIL with `E.playerBuffScore is not a function`. Total `225 passed, 6 failed`.

- [ ] **Step 3: Implement the model**

In `assignments-engine.js`, directly after the line `const GROUP_CAP = 5;`, insert:

```js
    // Party-buff value model (spec: docs/superpowers/specs/2026-08-13-group-optimizer-
    // ai-review-design.md). Units are ordinal, not simulated: 10 is the largest single
    // delta in the game (Windfury on a windfury user), 1 is minor. Only the ORDER of
    // the weights needs to be right — the optimizer compares sums, never absolute values.
    function buffArchetype(p) {
        switch (p.class) {
            case 'WARRIOR': return p.spec === 'Protection' ? 'protWarrior' : 'wfMelee';
            case 'ROGUE':   return 'wfMelee';
            case 'PALADIN': return p.spec === 'Protection' ? 'protPaladin'
                                 : (p.spec === 'Holy' ? 'healer' : 'wfMelee');
            case 'DRUID':   return p.spec === 'Restoration' ? 'healer'
                                 : (p.spec === 'Balance' ? 'caster'
                                 : (p.spec === 'Guardian' ? 'bear' : 'feralCat'));
            case 'PRIEST':  return p.spec === 'Shadow' ? 'caster' : 'healer';
            case 'SHAMAN':  return p.spec === 'Enhancement' ? 'enhShaman'
                                 : (p.spec === 'Elemental' ? 'caster' : 'healer');
            case 'HUNTER':  return 'hunter';
            default:        return 'caster'; // mage, warlock
        }
    }

    // element:'air' rows compete — a shaman runs ONE air totem, so groupBuffs picks a
    // single air row per group. Windfury is absent for enhShaman (own imbues), feralCat
    // and bear (weapon-imbue totems do not affect shapeshifted druids) and hunters
    // (main-hand proc, ranged attacks never trigger it). A buff provided twice still
    // counts once: `provided` is a boolean over the whole group.
    const PARTY_BUFFS = [
        { name: 'Windfury Totem', element: 'air',
          provided: ps => ps.some(p => p.class === 'SHAMAN'),
          w: { wfMelee: 10, protWarrior: 5 } },
        { name: 'Grace of Air', element: 'air',
          provided: ps => ps.some(p => p.class === 'SHAMAN'),
          w: { wfMelee: 2, enhShaman: 2, feralCat: 5, bear: 5, hunter: 7, protWarrior: 1, protPaladin: 1 } },
        { name: 'Wrath of Air', element: 'air',
          provided: ps => ps.some(p => p.class === 'SHAMAN'),
          w: { caster: 7, healer: 3, protPaladin: 1 } },
        { name: 'Strength of Earth',
          provided: ps => ps.some(p => p.class === 'SHAMAN'),
          w: { wfMelee: 3, enhShaman: 3, feralCat: 3, bear: 2, protWarrior: 2, protPaladin: 1 } },
        { name: 'Totem of Wrath',
          provided: ps => ps.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental'),
          w: { caster: 7, healer: 1, protPaladin: 1 } },
        { name: 'Mana Tide Totem',
          provided: ps => ps.some(p => p.class === 'SHAMAN' && p.spec === 'Restoration'),
          w: { enhShaman: 1, hunter: 1, caster: 2, healer: 6, protPaladin: 1 } },
        { name: 'Battle Shout',
          provided: ps => ps.some(p => p.class === 'WARRIOR'),
          w: { wfMelee: 4, enhShaman: 4, feralCat: 4, bear: 3, protWarrior: 3 } },
        { name: 'Unleashed Rage',
          provided: ps => ps.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement'),
          w: { wfMelee: 5, feralCat: 4, bear: 2, protWarrior: 2 } },
        { name: 'Leader of the Pack',
          provided: ps => ps.some(p => p.class === 'DRUID' && isFeralSpec(p.spec)),
          w: { wfMelee: 5, enhShaman: 4, feralCat: 5, bear: 3, hunter: 5, protWarrior: 2 } },
        { name: 'Ferocious Inspiration',
          provided: ps => ps.some(p => p.class === 'HUNTER' && p.spec === 'Beast Mastery'),
          w: { wfMelee: 3, enhShaman: 3, feralCat: 3, bear: 1, hunter: 3, caster: 3, protWarrior: 1, protPaladin: 1 } },
        { name: 'Trueshot Aura',
          provided: ps => ps.some(p => p.class === 'HUNTER' && p.spec === 'Marksmanship'),
          w: { wfMelee: 3, enhShaman: 3, feralCat: 3, bear: 1, hunter: 5, protWarrior: 1 } },
        { name: 'Moonkin Aura',
          provided: ps => ps.some(p => p.class === 'DRUID' && p.spec === 'Balance'),
          w: { caster: 4, healer: 1 } },
        { name: 'Vampiric Touch',
          provided: ps => ps.some(p => p.class === 'PRIEST' && p.spec === 'Shadow'),
          w: { caster: 4, healer: 3, protPaladin: 1 } },
        { name: 'Blood Pact',
          provided: ps => ps.some(p => p.class === 'WARLOCK'),
          w: { wfMelee: 1, enhShaman: 1, feralCat: 1, bear: 1, hunter: 1, caster: 1, healer: 1, protWarrior: 2, protPaladin: 2 } },
        { name: 'Paladin aura',
          provided: ps => ps.some(p => p.class === 'PALADIN'),
          w: { wfMelee: 1, enhShaman: 1, feralCat: 1, bear: 1, hunter: 1, caster: 1, healer: 1, protWarrior: 1, protPaladin: 1 } },
        { name: 'Draenei presence',
          provided: ps => ps.some(p => p.race === 'Draenei'),
          w: { wfMelee: 2, enhShaman: 2, hunter: 2, caster: 2, protWarrior: 2 } },
    ];

    function groupBuffs(players) {
        const active = PARTY_BUFFS.filter(b => !b.element && b.provided(players));
        const airs = PARTY_BUFFS.filter(b => b.element === 'air' && b.provided(players));
        if (airs.length) {
            // An Elemental shaman always keeps Wrath of Air — established ruling (it will
            // not sacrifice its own spell damage to imbue melee), and the existing air-note
            // tests pin it. Otherwise: argmax of group value, ties keep table order (WF first).
            let bestAir = null;
            if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental')) {
                bestAir = airs.filter(b => b.name === 'Wrath of Air')[0];
            } else {
                let bestVal = -1;
                airs.forEach(b => {
                    const v = players.reduce((s, p) => s + (b.w[buffArchetype(p)] || 0), 0);
                    if (v > bestVal) { bestVal = v; bestAir = b; }
                });
            }
            if (bestAir) active.push(bestAir);
        }
        return active;
    }

    function playerBuffScore(p, players) {
        return groupBuffs(players).reduce((s, b) => s + (b.w[buffArchetype(p)] || 0), 0);
    }
```

Then add `playerBuffScore,` to the export object at the bottom of the file, on the line with `bucketOf, proposeGroups,` (making it `bucketOf, proposeGroups, playerBuffScore,`).

- [ ] **Step 4: Run the full suite**

Run: `node assignments-engine.test.js 2>&1 | tail -3`
Expected: `231 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: party-buff value model with one-air-totem choice per group"
```

---

### Task 2: `scoreLayout` with the cohesion nudge

**Files:**
- Modify: `assignments-engine.js` (insert directly after the `playerBuffScore` function from Task 1; extend exports)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `playerBuffScore(p, players)` (Task 1), `bucketOf(p)` (existing).
- Produces: `scoreLayout(groups)` → number, where `groups` is `[{ players: [...] }, ...]`. Exported. Task 4 consumes it.

- [ ] **Step 1: Write the failing tests**

```js
// --- Optimizer Task 2: scoreLayout ---
test('scoreLayout: fury warrior and rogue share Battle Shout plus cohesion', () => {
    const g = [{ players: [P('War', 'WARRIOR', 'Fury'), P('Rog', 'ROGUE', 'Combat')] }];
    assert.ok(Math.abs(E.scoreLayout(g) - 8.5) < 1e-9); // shout 4+4, cohesion 0.25 x 2 same-bucket
});
test('scoreLayout: cohesion prefers same-bucket grouping when buffs tie', () => {
    const together = [{ players: [P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')] }, { players: [P('Rog', 'ROGUE', 'Combat')] }];
    const split = [{ players: [P('M1', 'MAGE', 'Arcane'), P('Rog', 'ROGUE', 'Combat')] }, { players: [P('M2', 'MAGE', 'Arcane')] }];
    assert.ok(E.scoreLayout(together) > E.scoreLayout(split));
});
```

- [ ] **Step 2: Run, confirm both fail with `E.scoreLayout is not a function`**

Run: `node assignments-engine.test.js 2>&1 | tail -3` — expected `231 passed, 2 failed`.

- [ ] **Step 3: Implement**

Directly after the `playerBuffScore` function:

```js
    // Layout score = buff coverage plus a small cohesion nudge (0.25 per player in the
    // group's most common bucket). 0.25 is deliberately below the smallest buff weight:
    // cohesion breaks near-ties toward recognizable role groups but never outweighs a
    // real buff gain.
    function scoreLayout(groups) {
        return groups.reduce((sum, g) => {
            const perPlayer = g.players.reduce((s, p) => s + playerBuffScore(p, g.players), 0);
            const tally = {};
            g.players.forEach(p => { const b = bucketOf(p); tally[b] = (tally[b] || 0) + 1; });
            const majority = Object.keys(tally).reduce((m, k) => Math.max(m, tally[k]), 0);
            return sum + perPlayer + 0.25 * majority;
        }, 0);
    }
```

Add `scoreLayout,` to the exports next to `playerBuffScore,`.

- [ ] **Step 4: Run the full suite** — expected `233 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: layout score sums buff coverage with a small role-cohesion nudge"
```

---

### Task 3: Note rules — air delegation + Trueshot Aura + Blood Pact

**Files:**
- Modify: `assignments-engine.js` — the `NOTE_RULES` array inside `proposeGroups` (currently lines ~933-971)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `groupBuffs(players)` (Task 1, internal — same UMD scope, callable directly).
- Produces: unchanged `{ groups, unplaced }` from `proposeGroups`; note texts consumed by the UI and Task 4's fixture tests. New note texts, verbatim: `'Trueshot Aura (+125 attack power)'`, `'Blood Pact (+70 stamina, needs the imp out)'`.

- [ ] **Step 1: Write the failing tests**

```js
// --- Optimizer Task 3: note rules ---
test('NOTE_RULES: Trueshot Aura printed for an MM hunter with melee', () => {
    const res = E.proposeGroups([P('Legolas', 'HUNTER', 'Marksmanship'), P('Rog', 'ROGUE', 'Combat')]);
    assert.ok(res.groups[0].notes.some(t => /Trueshot/.test(t)), res.groups[0].notes.join(' | '));
});
test('NOTE_RULES: no Trueshot note for a lone MM among casters', () => {
    const res = E.proposeGroups([P('Legolas', 'HUNTER', 'Marksmanship'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane')]);
    res.groups.forEach(g => assert.ok(!g.notes.some(t => /Trueshot/.test(t)), g.notes.join(' | ')));
});
test('NOTE_RULES: Blood Pact printed for any warlock group', () => {
    const res = E.proposeGroups([P('Lock', 'WARLOCK', 'Destruction'), P('Mage', 'MAGE', 'Arcane')]);
    assert.ok(res.groups[0].notes.some(t => /Blood Pact/.test(t)), res.groups[0].notes.join(' | '));
});
test('NOTE_RULES: air delegation — resto shaman with a cat and a bear claims Grace of Air', () => {
    const res = E.proposeGroups([P('Resto', 'SHAMAN', 'Restoration'), P('Cat', 'DRUID', 'Feral'), P('Bear', 'DRUID', 'Guardian')]);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto'));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), 'missing Grace of Air: ' + g.notes.join(' | '));
    const airNotes = g.notes.filter(t => /Wrath of Air|Grace of Air|Windfury Totem/.test(t));
    assert.strictEqual(airNotes.length, 1, 'air notes: ' + airNotes.join(' | '));
});
```

- [ ] **Step 2: Run, confirm predicted failures**

Expected: tests 1, 3 and 4 FAIL (no Trueshot rule, no Blood Pact rule, and the old rules print `Windfury Totem (baseline)` for the cat+bear group because Grace of Air currently requires a HUNTER). Test 2 PASSES coincidentally — the plan predicts this; it exists to pin the beneficiary condition once the rule lands. Total `233 passed, 3 failed`.

- [ ] **Step 3: Implement**

Inside `proposeGroups`, add this helper immediately above `const NOTE_RULES = [`:

```js
        // The air-note rules delegate to the score model's air-totem choice, so the notes
        // and the optimizer can never disagree about which air totem a group runs — and the
        // one-air-note invariant holds by construction instead of by rule coordination.
        function airChoice(g) {
            const air = groupBuffs(g.players).filter(b => b.element === 'air')[0];
            return air ? air.name : null;
        }
```

Then replace the four air-related rules. The `'Windfury Totem + Strength of Earth'` rule (and its `has`), the long air-consistency comment block above `'Grace of Air (+77 agility)'`, and the `'Grace of Air (+77 agility)'`, `'Wrath of Air (+101 spell damage and healing)'` and `'Windfury Totem (baseline)'` rules become:

```js
            { text: 'Windfury Totem + Strength of Earth',
              has: g => airChoice(g) === 'Windfury Totem'
                     && g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
```

(keep `'Unleashed Rage (+10% AP)'` and `'Totem of Wrath (+3% spell hit and crit)'` exactly where and as they are), and where the old Wrath of Air / Grace of Air / baseline Windfury rules and the long comment stood:

```js
            { text: 'Wrath of Air (+101 spell damage and healing)',
              has: g => airChoice(g) === 'Wrath of Air' },
            { text: 'Grace of Air (+77 agility)',
              has: g => airChoice(g) === 'Grace of Air' },
            { text: 'Windfury Totem (baseline)',
              has: g => airChoice(g) === 'Windfury Totem'
                     && !g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
```

Note the old unconditional `'Wrath of Air (+101 ...)'` rule (keyed on Elemental presence) is REPLACED by the `airChoice` version above — the Elemental pin inside `groupBuffs` keeps its behavior identical. Finally add the two new rules, Trueshot after the `'Ferocious Inspiration ...'` rule and Blood Pact after the `'Vampiric Touch ...'` rule:

```js
            { text: 'Trueshot Aura (+125 attack power)',
              has: g => g.players.some(p => p.class === 'HUNTER' && p.spec === 'Marksmanship')
                     && g.players.some(p => !(p.class === 'HUNTER' && p.spec === 'Marksmanship')
                          && (bucketOf(p) === 'melee' || bucketOf(p) === 'tanks' || bucketOf(p) === 'ranged')) },
```

```js
            { text: 'Blood Pact (+70 stamina, needs the imp out)',
              has: g => g.players.some(p => p.class === 'WARLOCK') },
```

- [ ] **Step 4: Run the full suite** — expected `237 passed, 0 failed`. If any PRE-EXISTING test fails (the air-note tests from the anniversary plan are the risk surface), STOP and escalate BLOCKED with the output — do not adjust old tests or weights on your own.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: air notes delegate to the buff model; Trueshot and Blood Pact notes"
```

---

### Task 4: Hill-climb optimizer pass in `proposeGroups`

**Files:**
- Modify: `assignments-engine.js` — inside `proposeGroups`: insert the hill-climb after the draenei swap pass, and MOVE the relabel block after it
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `scoreLayout(groups)` (Task 2), `GROUP_CAP` (existing).
- Produces: `proposeGroups` return shape unchanged (`{ groups, unplaced }`); layouts now buff-optimal and still deterministic.

- [ ] **Step 1: Write the tests**

```js
// --- Optimizer Task 4: hill-climb ---
const LIVE22 = [
    P('Haku', 'SHAMAN', 'Enhancement'), P('Slyvester', 'SHAMAN', 'Elemental'),
    P('Gouken', 'SHAMAN', 'Restoration'), P('Wopten', 'SHAMAN', 'Restoration'),
    P('Culuneta', 'WARRIOR', 'Fury'), P('RedNeko', 'WARRIOR', 'Fury'), P('Davina', 'WARRIOR', 'Arms'),
    P('Warzilla', 'DRUID', 'Feral'), P('Smellmywand', 'DRUID', 'Guardian'),
    P('Sylvanor', 'PALADIN', 'Protection'),
    P('Xavamros', 'ROGUE', 'Combat'), P('Utopik', 'ROGUE', 'Combat'),
    P('Bejoux', 'MAGE', 'Arcane'), P('Craqu', 'MAGE', 'Arcane'), P('JohnNooze', 'MAGE', 'Arcane'),
    P('Cartis', 'WARLOCK', 'Destruction'), P('Lovestoned', 'WARLOCK', 'Destruction'),
    P('Conny', 'HUNTER', 'Beast Mastery'), P('Funkell', 'HUNTER', 'Beast Mastery'), P('Produdu', 'HUNTER', 'Survival'),
    P('Frawa', 'DRUID', 'Restoration'), P('Sspope', 'PRIEST', 'Holy'),
];
test('optimizer: a hunter dumped with casters moves to the Grace of Air group', () => {
    const roster = [
        P('Enh', 'SHAMAN', 'Enhancement'), P('Fury', 'WARRIOR', 'Fury'),
        P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat'), P('R3', 'ROGUE', 'Combat'),
        P('Ele', 'SHAMAN', 'Elemental'), P('Mage', 'MAGE', 'Arcane'), P('Lock', 'WARLOCK', 'Destruction'),
        P('Resto', 'SHAMAN', 'Restoration'), P('Holy', 'PRIEST', 'Holy'),
        P('MM', 'HUNTER', 'Marksmanship'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'MM'));
    assert.ok(g.players.some(p => p.name === 'Resto'), 'MM should sit with the resto shaman, got: ' + g.players.map(p => p.name).join(','));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), g.notes.join(' | '));
});
test('optimizer: 22-man fixture puts the Guardian with the hunters', () => {
    const res = E.proposeGroups(LIVE22);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Smellmywand'));
    assert.ok(g.players.filter(p => p.class === 'HUNTER').length >= 2,
        'Guardian group: ' + g.players.map(p => p.name).join(','));
});
test('optimizer: layouts are deterministic across runs', () => {
    const a = E.proposeGroups(LIVE22).groups.map(g => g.players.map(p => p.name));
    const b = E.proposeGroups(LIVE22).groups.map(g => g.players.map(p => p.name));
    assert.deepStrictEqual(a, b);
});
test('optimizer: everyone placed exactly once, no group over cap', () => {
    const res = E.proposeGroups(LIVE22);
    const names = res.groups.reduce((acc, g) => acc.concat(g.players.map(p => p.name)), []);
    assert.strictEqual(names.length, 22);
    assert.strictEqual(new Set(names).size, 22);
    res.groups.forEach(g => assert.ok(g.players.length <= 5));
    assert.strictEqual(res.unplaced.length, 0);
});
test('optimizer: the two resto shamans stay in different groups', () => {
    const res = E.proposeGroups(LIVE22);
    const g1 = res.groups.find(g => g.players.some(p => p.name === 'Gouken'));
    assert.ok(!g1.players.some(p => p.name === 'Wopten'));
});
test('optimizer: both destro locks sit with caster totems', () => {
    const res = E.proposeGroups(LIVE22);
    ['Cartis', 'Lovestoned'].forEach(name => {
        const g = res.groups.find(g => g.players.some(p => p.name === name));
        assert.ok(g.notes.some(t => /Wrath of Air|Totem of Wrath/.test(t)),
            name + ' notes: ' + g.notes.join(' | '));
    });
});
test('optimizer: the enhancement shaman keeps a windfury group', () => {
    const res = E.proposeGroups(LIVE22);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Haku'));
    const wf = g.players.filter(p => p.class === 'WARRIOR' && p.spec !== 'Protection' || p.class === 'ROGUE');
    assert.ok(wf.length >= 3, 'windfury users with Haku: ' + wf.length);
});
test('optimizer: an already-clean seed comes back unchanged', () => {
    const roster = [
        P('Enh', 'SHAMAN', 'Enhancement'), P('F1', 'WARRIOR', 'Fury'), P('F2', 'WARRIOR', 'Fury'),
        P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat'),
        P('Ele', 'SHAMAN', 'Elemental'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane'),
        P('Lock', 'WARLOCK', 'Destruction'), P('Holy', 'PRIEST', 'Holy'),
    ];
    const res = E.proposeGroups(roster);
    const melee = res.groups.find(g => g.players.some(p => p.name === 'Enh'));
    assert.deepStrictEqual(melee.players.map(p => p.name).sort(), ['Enh', 'F1', 'F2', 'R1', 'R2']);
    const casters = res.groups.find(g => g.players.some(p => p.name === 'Ele'));
    assert.deepStrictEqual(casters.players.map(p => p.name).sort(), ['Ele', 'Holy', 'Lock', 'M1', 'M2']);
});
```

- [ ] **Step 2: Run, confirm predicted failures**

Expected: tests 1 and 2 FAIL — the MM hunter stays parked with the casters (fullest-first overflow) and the Guardian stays in the 2-man tank group. Tests 3-8 PASS coincidentally and the plan predicts this: they pin seed behaviors (determinism, placement invariants, shaman spread, the post-Task-3 caster-totem notes, the windfury core, the clean-seed shape) that the optimizer must NOT break. Total `237 passed, 2 failed`.

- [ ] **Step 3: Implement**

Two edits inside `proposeGroups`:

**(a)** CUT the relabel block — the comment starting `// The role list is chosen up front from which buckets exist,` through the `});` that closes its `groups.forEach` (currently lines ~891-903) — you will re-paste it below.

**(b)** After the draenei swap pass (the `});` closing the `groups.forEach` that swaps surplus draenei), insert the hill-climb, then re-paste the relabel block after it, so the final order is: overflow → draenei swaps → hill-climb → relabel → NOTE_RULES:

```js
        // 4. Buff-aware hill-climb (spec: docs/superpowers/specs/2026-08-13-group-
        // optimizer-ai-review-design.md). Enumerate every cross-group swap and every move
        // into an empty seat in a fixed order, apply the single best strictly-positive
        // improvement, repeat until nothing improves. Determinism is the point: the seed
        // is deterministic, the enumeration order is deterministic, and ties keep the
        // first candidate found, so the same roster always yields the same layout. The
        // iteration cap is a runaway guard, not a tuning knob — convergence happens in a
        // handful of moves on any real roster.
        function trySwap(gA, iA, gB, iB) {
            const t = gA.players[iA]; gA.players[iA] = gB.players[iB]; gB.players[iB] = t;
        }
        for (let iter = 0; iter < 500; iter++) {
            const base = scoreLayout(groups);
            let best = null;
            for (let a = 0; a < groups.length; a++) {
                for (let ia = 0; ia < groups[a].players.length; ia++) {
                    for (let b = 0; b < groups.length; b++) {
                        if (b === a) continue;
                        if (b > a) { // each swap pair once
                            for (let ib = 0; ib < groups[b].players.length; ib++) {
                                trySwap(groups[a], ia, groups[b], ib);
                                const d = scoreLayout(groups) - base;
                                trySwap(groups[a], ia, groups[b], ib);
                                if (d > 0 && (!best || d > best.delta)) best = { delta: d, kind: 'swap', a, ia, b, ib };
                            }
                        }
                        if (groups[b].players.length < GROUP_CAP) {
                            const p = groups[a].players[ia];
                            groups[a].players.splice(ia, 1);
                            groups[b].players.push(p);
                            const d = scoreLayout(groups) - base;
                            groups[b].players.pop();
                            groups[a].players.splice(ia, 0, p);
                            if (d > 0 && (!best || d > best.delta)) best = { delta: d, kind: 'move', a, ia, b };
                        }
                    }
                }
            }
            if (!best) break;
            if (best.kind === 'swap') trySwap(groups[best.a], best.ia, groups[best.b], best.ib);
            else groups[best.b].players.push(groups[best.a].players.splice(best.ia, 1)[0]);
        }
```

The relabel block's own comment and code stay byte-identical — it only moves, because relabeling must describe the optimizer's final composition, not the seed's.

- [ ] **Step 4: Run the full suite** — expected `245 passed, 0 failed`. If test 2 or 6 fails with a plausible-looking alternate layout, do NOT weaken the assertion — escalate BLOCKED with the actual group listing so the controller can rule against the spec.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: deterministic buff-aware hill-climb over the seeded group layout"
```

---

### Task 5: `POST /api/ai-review` OpenAI proxy in server.js

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `.env` at repo root (exists, gitignored) providing `OPENAI_API_KEY`; optional `OPENAI_MODEL` (default `gpt-5-mini`).
- Produces: `POST /api/ai-review` accepting any JSON body, returning `{ review: string }` on success or `{ error: string }` with status 503 (no key) / 502 (upstream error) / 504 (timeout). Task 6's button consumes this.

- [ ] **Step 1: Implement the .env loader and JSON body parsing**

In `server.js`, change the top of the file: add `const fs = require('fs');` under the existing requires, and after `const PORT = ...` add:

```js
// Minimal KEY=VALUE reader for the gitignored .env (OpenAI key). No dependency, no
// quoting rules. Real environment variables win so a deployment can override the file.
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch (err) { /* no .env is fine — the AI endpoint answers 503 */ }
```

Directly under the existing `app.use(express.static(...))` line add:

```js
app.use(express.json({ limit: '1mb' }));
```

- [ ] **Step 2: Implement the endpoint**

Insert after the `/api/raidhelper/:eventId` route, before the catch-all `app.get('*', ...)`:

```js
// Advisory AI second opinion on the whole assignment sheet. The client sends its live
// state; we wrap it in a system prompt that states the Anniversary rules so the model
// cannot repeat the rule-ignorant critiques a bare ChatGPT produces. Display-only:
// nothing here ever mutates an assignment.
const AI_SYSTEM_PROMPT = [
  'You are reviewing a World of Warcraft TBC Anniversary-realm raid assignment sheet.',
  'Anniversary rules you must respect (they differ from original TBC):',
  '- Bloodlust/Heroism is RAID-wide (10-minute Sated-style debuff). It is never a reason to group anyone.',
  '- Everything else is party-scoped: all shaman totems, paladin auras, Battle Shout, Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration, Vampiric Touch, Mana Tide, Blood Pact, and draenei presences.',
  '- A shaman runs only ONE air totem at a time: Windfury, Grace of Air and Wrath of Air are all air totems.',
  '- Windfury Totem does not affect shapeshifted druids or hunters, and enhancement shamans use their own weapon imbues instead.',
  '- A non-enhancement shaman grouped with melee is expected to drop Windfury as baseline; the group notes say which totem each group gets.',
  'Critique the group layout, debuff assignments, blessings and uncovered list as an advisory second opinion.',
  'Suggest concrete swaps where they genuinely help; say so if the sheet is already sound.',
  'Under 400 words. Plain text, no markdown headings.',
].join('\n');

app.post('/api/ai-review', async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'No OPENAI_API_KEY configured — put it in .env next to server.js' });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Review this sheet:\n${JSON.stringify(req.body)}` },
        ],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `OpenAI returned ${upstream.status}`;
      return res.status(502).json({ error: msg });
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return res.status(502).json({ error: 'OpenAI returned an empty response' });
    res.json({ review: text });
  } catch (err) {
    console.error('AI review failed:', err);
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'OpenAI request timed out' });
    }
    res.status(502).json({ error: 'Failed to reach OpenAI' });
  }
});
```

Note `server.js` uses 2-space indent and template literals — match it (it is the one file in this repo that does).

- [ ] **Step 3: Test the no-key path (no network needed)**

```bash
OPENAI_API_KEY= PORT=3199 node server.js &
curl -s --retry 5 --retry-delay 1 --retry-connrefused -X POST localhost:3199/api/ai-review -H 'Content-Type: application/json' -d '{}'
kill %1
```

(`curl --retry-connrefused` does the waiting — plain `sleep` is blocked in this harness.)

Expected: `{"error":"No OPENAI_API_KEY configured — put it in .env next to server.js"}` (the empty env var is defined, so the .env loader must NOT override it — this also proves the precedence rule).

- [ ] **Step 4: Test the live path (the one permitted OpenAI call for this task)**

```bash
PORT=3199 node server.js &
curl -s --retry 5 --retry-delay 1 --retry-connrefused -X POST localhost:3199/api/ai-review -H 'Content-Type: application/json' \
  -d '{"roster":[{"name":"Test","class":"WARRIOR","spec":"Fury"}],"groups":[{"group":1,"role":"melee","players":["Test (Fury WARRIOR)"],"notes":["Battle Shout"]}]}'
kill %1
```

Expected: HTTP 200 with `{"review":"..."}` containing prose. If OpenAI rejects the MODEL NAME, STOP and escalate BLOCKED quoting the exact error body — the controller picks the replacement model; do not guess one. Do not print or echo the key while debugging.

- [ ] **Step 5: Run the engine suite (must be untouched)** — expected `245 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: /api/ai-review proxies the sheet to OpenAI with Anniversary rules pinned"
```

---

### Task 6: The "AI second opinion" button

**Files:**
- Modify: `assignments.html` (the Group layout panel, currently lines 60-61)
- Modify: `assignments.js` (the listener-wiring section where `autoAssignBtn` gets its handler, currently line ~597)

**Interfaces:**
- Consumes: `POST /api/ai-review` (Task 5); globals `roster`, `sheet` (populated by `recompute()`), `E.proposeGroups`; existing `.hidden` CSS class and `.btn` class.
- Produces: `#aiReviewBtn`, `#aiReviewBox` DOM ids (Task 7's driver clicks/reads them).

- [ ] **Step 1: Add the markup**

In `assignments.html`, replace:

```html
            <h2>4 · Group layout <span class="hint">(advisory — move people in-game yourself; Bloodlust is raid-wide on Anniversary and ignored here)</span></h2>
            <div id="groupsBox"></div>
```

with:

```html
            <h2>4 · Group layout <span class="hint">(advisory — move people in-game yourself; Bloodlust is raid-wide on Anniversary and ignored here)</span> <button class="btn" id="aiReviewBtn" style="float: right;">AI second opinion</button></h2>
            <div id="groupsBox"></div>
            <div id="aiReviewBox" class="hidden" style="white-space: pre-wrap; margin-top: 10px; opacity: 0.9;"></div>
```

(Inline styles are deliberate — `style.css` is off-limits per Global Constraints.)

- [ ] **Step 2: Wire the button**

In `assignments.js`, directly after the `autoAssignBtn` listener block, add:

```js
    document.getElementById('aiReviewBtn').addEventListener('click', async () => {
        const btn = document.getElementById('aiReviewBtn');
        const box = document.getElementById('aiReviewBox');
        box.classList.remove('hidden');
        if (!roster.length) { box.textContent = 'Import a roster first.'; return; }
        box.textContent = 'Asking for a second opinion…';
        btn.disabled = true;
        try {
            const payload = {
                roster: roster.map(p => ({ name: p.name, class: p.class, spec: p.spec, race: p.race })),
                groups: E.proposeGroups(roster).groups.map((g, i) => ({
                    group: i + 1, role: g.role,
                    players: g.players.map(p => p.name + ' (' + (p.spec || '?') + ' ' + p.class + ')'),
                    notes: g.notes,
                })),
                duties: sheet.duties,
                uncovered: sheet.uncovered,
                passives: sheet.passives,
                crowdControl: sheet.cc,
                blessings: sheet.blessings.rows.map(r => ({ paladin: r.paladin, spec: r.spec, perClass: r.cells })),
                blessingWarnings: sheet.blessings.warnings,
            };
            const resp = await fetch('/api/ai-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            box.textContent = resp.ok ? data.review : ('AI review failed: ' + (data.error || resp.status));
        } catch (e) {
            box.textContent = 'AI review failed: ' + e.message;
        } finally {
            btn.disabled = false;
        }
    });
```

(`r.paladin` is already the paladin's NAME string, not an object — see `proposeBlessings`. The response is display-only; nothing here writes to `state`, `roster` or `sheet`.)

- [ ] **Step 3: Syntax-check and run the suite**

```bash
node --check assignments.js && node assignments-engine.test.js 2>&1 | tail -1
```

Expected: no syntax error; `245 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add assignments.html assignments.js
git commit -m "feat: AI second-opinion button renders the advisory review under the groups"
```

---

### Task 7: End-to-end verification (no commit)

**Files:**
- Create: `ai-verify.js` inside this plan's SDD workspace directory (git-ignored `.superpowers/sdd/...`) — throwaway driver, never committed.

**Interfaces:**
- Consumes: the running server on port 3111, headless Chrome over CDP on port 9333, live Raid-Helper event `1536119496337653871`, `#aiReviewBtn`/`#aiReviewBox` (Task 6). This task performs the second permitted live OpenAI call.

- [ ] **Step 1: Full suite on the final tree**

Run: `node assignments-engine.test.js 2>&1 | tail -1` — expected `245 passed, 0 failed`. Paste the real output in the report.

- [ ] **Step 2: Start the server and clean Chrome state**

```bash
cd "$(git rev-parse --show-toplevel)"
PORT=3111 node server.js &
pkill -f "remote-debugging-port=9333" || true
rm -rf "$WORKSPACE/chrome-profile"   # $WORKSPACE = this plan's .superpowers/sdd directory, where ai-verify.js lives
```

(Orphaned Chrome instances holding port 9333 silently serve STALE pages from a previous run — kill them every time; this is a known harness gotcha.)

- [ ] **Step 3: Write the driver**

Create `ai-verify.js` in the SDD workspace with exactly:

```js
// Headless-Chrome CDP driver: import the live Raid-Helper event, auto-assign, dump the
// group layout, then click the AI second-opinion button and wait for the review text.
// Must call process.exit() — the Chrome child otherwise keeps Node alive forever.
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const APP = 'http://localhost:3111/';
const EVENT = '1536119496337653871';

const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + __dirname + '/chrome-profile',
    '--remote-debugging-port=' + PORT, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wsUrl() {
    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
            const page = (await r.json()).find(t => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch (e) { /* chrome not up yet */ }
        await sleep(1000);
    }
    throw new Error('Chrome never came up');
}

async function main() {
    const ws = new WebSocket(await wsUrl());
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params) => new Promise(res => {
        const myId = ++id;
        pending.set(myId, res);
        ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    });
    const evalJs = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
        return r.result && r.result.result && r.result.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: APP });
    for (let i = 0; i < 60; i++) {
        const ready = await evalJs('typeof importRaidHelper === "function" && !!document.getElementById("rhInput")').catch(() => false);
        if (ready) break;
        await sleep(500);
    }
    await evalJs('window.confirm = () => true; "ok"');
    await evalJs(`(function(){
        const el = document.getElementById('rhInput');
        el.value = ${JSON.stringify(EVENT)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('rhImportBtn').click();
        return 'clicked';
    })()`);
    let status = '';
    for (let i = 0; i < 60; i++) {
        status = await evalJs('document.getElementById("importStatus").textContent');
        if (status && !/Fetching/.test(status)) break;
        await sleep(500);
    }
    await evalJs('document.getElementById("autoAssignBtn").click(); "clicked"');
    await sleep(1500);

    console.log(await evalJs(`(function(){
        const groups = document.getElementById('groupsBox').innerText;
        return JSON.stringify({
            status: document.getElementById('importStatus').textContent,
            statusIsError: document.getElementById('importStatus').className.includes('error'),
            mentionsBloodlust: /bloodlust|heroism/i.test(groups),
            groups,
        }, null, 2);
    })()`));

    await evalJs('document.getElementById("aiReviewBtn").click(); "clicked"');
    let review = '';
    for (let i = 0; i < 90; i++) {
        review = await evalJs('document.getElementById("aiReviewBox").textContent');
        if (review && !/^Asking/.test(review)) break;
        await sleep(1000);
    }
    console.log('===== AI REVIEW =====\n' + review);
    process.exit(0);
}

main().catch(e => { console.error('DRIVER FAILED: ' + e.message); process.exit(1); });
```

- [ ] **Step 4: Run it and check every assertion by eye**

Run: `node <path>/ai-verify.js` (timeout ≥ 180s). Then verify, quoting the actual output in the report:

1. `statusIsError` is false and `status` reports the import (no `Unknown class "Tank"` errors).
2. In `groups`: the Guardian (`Mr.SmellmyWand`) shares a group with hunters; the enhancement shaman's group has the Windfury + Strength of Earth note; each warlock's group notes claim Wrath of Air or Totem of Wrath; each group's notes claim at most ONE air totem; `mentionsBloodlust` is false.
3. The AI review text is non-empty prose that does not start with `AI review failed`.
4. The live roster may have drifted since this plan was written — if a specific NAME is gone, judge the properties (Guardian-with-hunters, one air totem per group) rather than the names, and say so in the report.

- [ ] **Step 5: Clean up**

```bash
pkill -f "remote-debugging-port=9333" || true
kill %1 2>/dev/null || true
```

No commit for this task — it produces a verification report, not code.
