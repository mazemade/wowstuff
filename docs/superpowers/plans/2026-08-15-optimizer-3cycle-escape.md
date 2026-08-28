# Optimizer 3-Cycle Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `proposeGroups`' hill-climb reach optima that need a three-way player rotation, without losing determinism, and make `scoreLayout` cheap enough to afford the bigger neighbourhood.

**Architecture:** Two changes inside `proposeGroups`' climb in the single-file UMD engine: (1) `scoreLayout` computes each group's buff set once per group instead of once per player; (2) a deterministic 3-cycle escape pass that runs only when no 2-swap or move improves. One existing test keys groups by a non-unique role label and gets re-keyed by provider.

**Tech Stack:** Plain JS (UMD, no build step), `node:assert` test script (`node assignments-engine.test.js`).

**Spec:** `docs/superpowers/specs/2026-08-15-duration-aware-weights-spec.md` (§F6, §D6, §D7)

## Global Constraints

- `assignments-engine.js` stays one UMD file loadable by both node and the browser — no imports, no build step.
- `proposeGroups` must stay deterministic: fixed enumeration order, first-found keeps ties. No `Math.random()`, no `Date.now()` in engine logic.
- Public exports must not lose members; `playerBuffScore` / `playerScore` signatures unchanged.
- Verification is `node assignments-engine.test.js` from the repo root (the Scan.lua parity test reads `RaidAssign/Scan.lua` relative to the test file, so run from the repo root).
- Background evidence: the verified prototype of this exact change produced +0.42% on the 2026-08-14 roster and +0.56% on the `raid25()` fixture, both confirmed global by 450 random restarts. Do not expect score changes on rosters whose optima are 2-swap-reachable.

---

### Task 1: Hoist `groupBuffs` in `scoreLayout`

`scoreLayout` currently calls `playerScore` per player, and each call recomputes `groupBuffs(players)` for the whole group — 5× redundant work per group, multiplied by every candidate the climb evaluates. Task 2 adds a neighbourhood ~10× larger, so this refactor comes first.

**Files:**
- Modify: `assignments-engine.js:1289-1295` (the `scoreLayout` function)
- Test: `assignments-engine.test.js` (add one test near the other `v2:` scoring tests, directly after the test named `v2: proposeGroups returns score, violations, alternates, marginals`)

**Interfaces:**
- Consumes: `groupBuffs(players)`, `specKey(p)`, `multOf(p)`, `BASELINE` — all existing module-internal helpers.
- Produces: `scoreLayout(groups)` with identical results and signature; Task 2 relies on it being cheap.

- [ ] **Step 1: Write the equivalence guard test**

This is a pure refactor, so the test is an equivalence guard: it must pass before AND after, and it pins the refactor to the definition it must preserve (`playerScore = BASELINE × mult × (1 + playerBuffScore)`). Add to `assignments-engine.test.js`:

```js
test('v2: scoreLayout equals the sum of playerScore over every group', () => {
    const res = E.proposeGroups(raid25());
    const direct = res.groups.reduce((sum, g) =>
        sum + g.players.reduce((s, p) => s + E.playerScore(p, g.players), 0), 0);
    assert.ok(Math.abs(E.scoreLayout(res.groups) - direct) < 1e-6,
        'scoreLayout ' + E.scoreLayout(res.groups) + ' != sum of playerScore ' + direct);
});
```

- [ ] **Step 2: Run the suite — the new test must pass against the CURRENT implementation**

Run: `node assignments-engine.test.js`
Expected: `271 passed, 0 failed` (270 existing + this guard). If it fails now, the test is wrong — fix the test, not the engine.

- [ ] **Step 3: Replace `scoreLayout` with the hoisted version**

In `assignments-engine.js`, replace:

```js
    // Layout score = raid DPS in real units. No cohesion term: once weights are % DPS,
    // the old 0.25 nudge is a unit collision, not a tiebreak (brief §8 Q3). Readability
    // comes from the seed, the relabel pass and the deterministic enumeration order.
    function scoreLayout(groups) {
        return groups.reduce((sum, g) =>
            sum + g.players.reduce((s, p) => s + playerScore(p, g.players), 0), 0);
    }
```

with:

```js
    // Layout score = raid DPS in real units. No cohesion term: once weights are % DPS,
    // the old 0.25 nudge is a unit collision, not a tiebreak (brief §8 Q3). Readability
    // comes from the seed, the relabel pass and the deterministic enumeration order.
    //
    // groupBuffs is computed ONCE per group, not once per player: playerScore(p, players)
    // would recompute the group's whole buff set for every member, and the climb scores
    // thousands of candidate layouts. Must stay numerically identical to summing
    // playerScore — the 'scoreLayout equals the sum of playerScore' test pins that.
    function scoreLayout(groups) {
        return groups.reduce((sum, g) => {
            const active = groupBuffs(g.players);
            return sum + g.players.reduce((s, p) => {
                const k = specKey(p);
                const f = active.reduce((m, a) =>
                    m * Math.pow(1 + (a.buff.v[k] || 0), a.count), 1);
                return s + (BASELINE[k] || 0) * multOf(p) * f;
            }, 0);
        }, 0);
    }
```

(`f` is `1 + playerBuffScore`, so `baseline × mult × f` equals `playerScore` exactly.)

- [ ] **Step 4: Run the suite**

Run: `node assignments-engine.test.js`
Expected: `271 passed, 0 failed`. Paste the real output; any failure means the refactor is NOT equivalent — fix the refactor, never the guard test.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "perf: compute groupBuffs once per group in scoreLayout"
```

---

### Task 2: 3-cycle escape pass in the climb

**Files:**
- Modify: `assignments-engine.js:1419-1421` (add `rotate` beside `trySwap`), `assignments-engine.js:1466-1469` (escape pass + apply branch; line numbers pre-Task-1 — locate by the code excerpts below, not by number)
- Modify: `assignments-engine.test.js:995-1002` (the test `proposeGroups: each group explains what its composition buys` — re-keyed by provider, see Step 5)
- Test: `assignments-engine.test.js` (new invariant test, added next to Task 1's guard test)

**Interfaces:**
- Consumes: `layoutViolations(groups)`, `scoreLayout(groups)` (Task 1's version), the climb's existing `consider(cand)` / `best` mechanics.
- Produces: `proposeGroups` results that admit no improving 3-cycle. No API change; `best.kind === 'rotate'` is internal.

- [ ] **Step 1: Write the failing invariant test**

Weight-independent by design (it must survive the duration-aware recalibration planned separately): after convergence, no single 3-cycle may improve `(violations, score)` lexicographically. Add to `assignments-engine.test.js`:

```js
test('v2: the climb result admits no improving 3-cycle', () => {
    const res = E.proposeGroups(raid25());
    const groups = res.groups.map(g => ({ role: g.role, players: g.players.slice() }));
    const v0 = E.layoutViolations(groups), s0 = E.scoreLayout(groups);
    // rot() applied three times restores the original seats.
    function rot(a, ia, b, ib, c, ic) {
        const t = groups[a].players[ia];
        groups[a].players[ia] = groups[c].players[ic];
        groups[c].players[ic] = groups[b].players[ib];
        groups[b].players[ib] = t;
    }
    let found = null;
    for (let a = 0; a < groups.length; a++)
    for (let ia = 0; ia < groups[a].players.length; ia++)
    for (let b = 0; b < groups.length; b++) {
        if (b === a) continue;
        for (let ib = 0; ib < groups[b].players.length; ib++)
        for (let c = 0; c < groups.length; c++) {
            if (c === a || c === b) continue;
            for (let ic = 0; ic < groups[c].players.length; ic++) {
                rot(a, ia, b, ib, c, ic);
                const v = E.layoutViolations(groups), s = E.scoreLayout(groups);
                if (!found && (v < v0 || (v === v0 && s > s0 + 1e-6))) {
                    found = 'a 3-cycle improves the converged layout by ' + (s - s0).toFixed(1)
                        + ' dps (violations ' + v0 + ' -> ' + v + ')';
                }
                rot(a, ia, b, ib, c, ic); rot(a, ia, b, ib, c, ic);
            }
        }
    }
    assert.strictEqual(found, null, found || '');
});
```

- [ ] **Step 2: Run it to verify it fails against the current engine**

Run: `node assignments-engine.test.js`
Expected: exactly one failure — this new test, with a message like `a 3-cycle improves the converged layout by 22x.x dps (violations 0 -> 0)`. (The prototype measured +0.56% ≈ +226 dps on `raid25()`.) If it PASSES here, something is wrong — the fixture is known to have a 3-cycle-only improvement; stop and investigate before proceeding.

- [ ] **Step 3: Add the `rotate` helper**

In `assignments-engine.js`, directly after:

```js
        function trySwap(gA, iA, gB, iB) {
            const t = gA.players[iA]; gA.players[iA] = gB.players[iB]; gB.players[iB] = t;
        }
```

add:

```js
        // A 3-cycle: a's player moves to b's seat, b's to c's, c's back to a's. Two swaps
        // cannot express this while every intermediate layout stays feasible, and with all
        // groups full the move rule never fires — so without this the climb cannot reach
        // layouts that need a three-way rotation. The known case: the profitable 2-swap
        // route breaches the healer floor mid-path and the lexicographic comparison vetoes
        // it, while the 3-cycle routes around the breach (spec §F6). Applying rotate()
        // three times restores the seats, which is how candidates are undone.
        function rotate(gA, iA, gB, iB, gC, iC) {
            const t = gA.players[iA];
            gA.players[iA] = gC.players[iC];
            gC.players[iC] = gB.players[iB];
            gB.players[iB] = t;
        }
```

- [ ] **Step 4: Add the escape pass and the apply branch**

In the climb loop, replace:

```js
            if (!best) break;
            if (best.kind === 'swap') trySwap(groups[best.a], best.ia, groups[best.b], best.ib);
            else groups[best.b].players.push(groups[best.a].players.splice(best.ia, 1)[0]);
```

with:

```js
            // Escape pass: only when no swap or move improves. 3-cycles are roughly an
            // order of magnitude more candidates than the swap pass, so scanning them every
            // iteration would be waste — at a 2-swap local optimum they are the cheapest
            // neighbourhood that can still improve. Fixed enumeration order and first-found
            // ties, so determinism is unchanged.
            if (!best) {
                for (let a = 0; a < groups.length; a++)
                for (let ia = 0; ia < groups[a].players.length; ia++)
                for (let b = 0; b < groups.length; b++) {
                    if (b === a) continue;
                    for (let ib = 0; ib < groups[b].players.length; ib++)
                    for (let c = 0; c < groups.length; c++) {
                        if (c === a || c === b) continue;
                        for (let ic = 0; ic < groups[c].players.length; ic++) {
                            rotate(groups[a], ia, groups[b], ib, groups[c], ic);
                            consider({ kind: 'rotate', a, ia, b, ib, c, ic });
                            rotate(groups[a], ia, groups[b], ib, groups[c], ic);
                            rotate(groups[a], ia, groups[b], ib, groups[c], ic);
                        }
                    }
                }
            }
            if (!best) break;
            if (best.kind === 'swap') trySwap(groups[best.a], best.ia, groups[best.b], best.ib);
            else if (best.kind === 'rotate') rotate(groups[best.a], best.ia, groups[best.b], best.ib, groups[best.c], best.ic);
            else groups[best.b].players.push(groups[best.a].players.splice(best.ia, 1)[0]);
```

- [ ] **Step 5: Run the suite; fix the one test the improvement exposes**

Run: `node assignments-engine.test.js`
Expected: the invariant test now passes, and exactly one OTHER test fails: `proposeGroups: each group explains what its composition buys`, on `assert.ok(casters.notes.some(t => /Totem of Wrath/.test(t)))`.

That failure is a pre-existing test bug the better layout exposes, not a regression: with the improved climb, `raid25()` yields TWO groups labelled `casters`, and `find(g => g.role === 'casters')` reads whichever comes first — not the one holding the Elemental shaman. The suite already documents this exact hazard in the test directly below it (`every note rule fires for the group that actually has its provider`, `assignments-engine.test.js:1003-1010`) and mandates provider-keyed lookup. Re-key BOTH role-keyed assertions in the buggy test. Replace:

```js
test('proposeGroups: each group explains what its composition buys', () => {
    const res = E.proposeGroups(raid25());
    const melee = res.groups.find(g => g.role === 'melee');
    assert.ok(melee.notes.some(t => /Windfury/.test(t)));
    const casters = res.groups.find(g => g.role === 'casters');
    assert.ok(casters.notes.some(t => /Totem of Wrath/.test(t)));
    res.groups.forEach(g => assert.ok(Array.isArray(g.notes)));
});
```

with:

```js
test('proposeGroups: each group explains what its composition buys', () => {
    const res = E.proposeGroups(raid25());
    // Role labels are NOT unique (two groups can both relabel 'casters' — see the sibling
    // test below), so key on the provider, never on the label: the group holding the
    // Enhancement shaman claims Windfury, the one holding the Elemental shaman claims
    // Totem of Wrath.
    const enhGroup = res.groups.find(g =>
        g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement'));
    assert.ok(enhGroup.notes.some(t => /Windfury/.test(t)));
    const eleGroup = res.groups.find(g =>
        g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental'));
    assert.ok(eleGroup.notes.some(t => /Totem of Wrath/.test(t)));
    res.groups.forEach(g => assert.ok(Array.isArray(g.notes)));
});
```

- [ ] **Step 6: Run the full suite green**

Run: `node assignments-engine.test.js`
Expected: `272 passed, 0 failed`. Paste the real output. If anything else fails, stop — do not adjust further tests without checking each failure against the intent documented in its own comments (the suite encodes rulings; only layout-cosmetic expectations may move, and this change is expected to touch exactly the one test above).

- [ ] **Step 7: Sanity-check determinism and runtime**

Run:

```bash
node -e "
const E = require('./assignments-engine.js');
const src = require('fs').readFileSync('./assignments-engine.test.js', 'utf8');
const m = src.match(/function raid25\(\)[\s\S]*?\n}/)[0];
const P = (name, cls, spec) => ({ name, class: cls, spec });
const raid25 = eval('(' + m.replace('function raid25()', 'function()') + ')');
const t0 = Date.now();
const a = E.proposeGroups(raid25());
const ms = Date.now() - t0;
const b = E.proposeGroups(raid25());
console.log('deterministic:', JSON.stringify(a.groups.map(g=>g.players.map(p=>p.name)))
  === JSON.stringify(b.groups.map(g=>g.players.map(p=>p.name))));
console.log('score:', a.score.toFixed(1), 'violations:', a.violations, 'runtime:', ms + 'ms');
"
```

Expected: `deterministic: true`, violations `0`, runtime under ~1500ms (the pre-hoist prototype measured 2.7s; Task 1's hoist should bring it well under that). Record the numbers in the commit message.

- [ ] **Step 8: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: 3-cycle escape pass so the climb reaches rotation-only optima

The 2-swap neighbourhood cannot express three-way rotations, and with five
full groups the move rule never fires; the known blocked case routes a
profitable swap through a healer-floor breach that the lexicographic
comparison vetoes. Deterministic: fixed enumeration order, first-found ties.
raid25 fixture: <old score> -> <new score>. Also re-keys the composition
test by provider — role labels are not unique."
```

(Fill the scores from Step 7's output and the pre-change value printed in Step 2's failure message.)
