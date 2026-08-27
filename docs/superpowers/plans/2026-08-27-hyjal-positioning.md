# Hyjal Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Positioning page that auto-assigns the imported roster to spread positions on a map of the Hyjal ballista area (Rage Winterchill / Anetheron), with party-adjacency, healer spread, drag-to-nudge, share-view rendering and copy-as-image.

**Architecture:** A new pure engine-style module `hyjal-positions.js` (UMD, node-testable) holds an encounter registry and a deterministic `computePositions` that places tanks/melee at fixed anchors and healers/ranged on a procedural ring in contiguous party wedges. A new `positions.html`/`positions.js` page renders it over the map image and shares state with the sheet via the existing localStorage keys. The sheet's share payload gains a precomputed `positions` block that `assignments-view.html` renders read-only.

**Tech Stack:** Plain browser JS (no build step, no framework), Express static serving (unchanged), custom node test harness (`node <file>.test.js`), headless Chrome over CDP for UI verification.

**Spec:** `docs/superpowers/specs/2026-08-27-hyjal-positioning-design.md`

## Global Constraints

- Plain JS only; no new npm dependencies; no build step. Node >= 18.
- New engine module follows the UMD pattern of `assignments-engine.js` (`module.exports` in node, `root.HyjalPositions` in browser).
- All map coordinates are **fractions of the image** (`x` of width, `y` of height) so the background can be swapped. Distance/angle math converts with `ASPECT = 1698/926` (the natural size of `maps/hyjal-ballista.png`).
- `computePositions` is **pure and deterministic**: same inputs → same output. No `Date.now`, no randomness.
- Test files use the repo's harness style: `test(name, fn)` with `node:assert`, printing `ok -`/`FAIL -` and exiting non-zero on failure (copy the pattern from `assignments-engine.test.js` lines 1–10).
- Commit after every task with a `feat:`/`refactor:`/`test:` conventional message ending in the Claude co-author trailer used by this repo.
- The user-facing name of the page is **Positioning**; the encounter is **“Hyjal · Rage Winterchill & Anetheron”**.
- UI verification: `npm start` serves on `http://localhost:3000`. No browser tool exists — drive headless Chrome over CDP from a node script (Chrome binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; node has global `WebSocket`). Gotchas: the driver must call `process.exit()` at the end (the Chrome child keeps the event loop alive); never trigger clipboard APIs headlessly; Chrome cold start can exceed 2 minutes — run browser checks as background tasks.

## Existing interfaces this plan builds on (verified 2026-08-27)

- `AssignmentsEngine` (UMD, `assignments-engine.js`): `bucketOf(p)` → `'tanks'|'healers'|'melee'|'casters'|'ranged'` (hunters are `'ranged'`, ele/boomkin/spriest `'casters'`); `proposeGroups(roster)` → `{ groups: [{role, players: Player[]}], ... }` (max 5 groups, shaman-seeded); `autoAssign(roster, overrides)` → `{ duties, uncovered, passives }` where `duties` contains `{id:'tankheal', players:[names], targets:[tankNames]}` and `{id:'raidheal', players:[names]}`.
- Player objects: `{ name, class /* 'WARRIOR' */, spec /* 'Protection' */, flags: [], mt?: true, group, ... }`.
- Sheet page state: localStorage `raidAssignmentsState` (shape at `assignments.js:7–19`) and `raidAssignmentsLinkMap`; roster is derived in `recompute()` (`assignments.js:35–54`).
- Share link: `buildShareLink()` (`assignments.js:845–854`) base64-encodes `{title, sheet}` into `assignments-view.html?data=...`.
- Map assets already in repo: `maps/hyjal-ballista.png` (clean background, 1698×926), `maps/reference-winterchill-annotated.png` (digitization reference).

---

### Task 1: Extract `deriveRoster` into the engine

The positions page must derive the same roster the sheet shows, without duplicating `recompute()`. Extract the pure part (merge + exclusions + manual overlay) into the engine; the stale-reference sweeping stays in `assignments.js`.

**Files:**
- Modify: `assignments-engine.js` (add `deriveRoster`, export it)
- Modify: `assignments.js:35–54` (use it)
- Test: `assignments-engine.test.js` (append)

**Interfaces:**
- Produces: `E.deriveRoster(state, linkMap)` → `Player[]`. `state` needs `{sources: {addon, rh}, manual: [], excluded: []}`; missing fields tolerated (`state.sources || {}` etc.). Pure — does not mutate `state`.

- [ ] **Step 1: Write the failing tests** (append to `assignments-engine.test.js` before the summary lines at the bottom; keep the existing `passed/failed` accounting)

```js
// --- deriveRoster ---
test('deriveRoster: merges sources minus excluded plus manual', () => {
    const state = {
        sources: { addon: [
            { name: 'Tanka', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon', group: 1, race: null, talents: null },
            { name: 'Gone', class: 'ROGUE', spec: 'Combat', flags: [], source: 'addon', group: 2, race: null, talents: null },
        ], rh: null },
        manual: [{ name: 'Handy', class: 'MAGE', spec: 'Frost', flags: [], source: 'manual' }],
        excluded: ['Gone'],
    };
    const r = E.deriveRoster(state, {});
    assert.deepStrictEqual(r.map(p => p.name).sort(), ['Handy', 'Tanka']);
});
test('deriveRoster: manual entry overrides scanned player but keeps addon-only fields', () => {
    const state = {
        sources: { addon: [{ name: 'Resp', class: 'PRIEST', spec: 'Shadow', flags: [], source: 'addon', group: 3, race: 'Dwarf', talents: [14, 0, 47] }], rh: null },
        manual: [{ name: 'Resp', class: 'PRIEST', spec: 'Holy', flags: [], source: 'manual', group: null, race: null, talents: null }],
        excluded: [],
    };
    const r = E.deriveRoster(state, {});
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].spec, 'Holy');       // manual form wins
    assert.strictEqual(r[0].group, 3);            // addon-supplied fields survive
    assert.strictEqual(r[0].race, 'Dwarf');
    assert.deepStrictEqual(r[0].talents, [14, 0, 47]);
});
test('deriveRoster: tolerates empty state', () => {
    assert.deepStrictEqual(E.deriveRoster({}, {}), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 3 FAIL lines saying `E.deriveRoster is not a function`; exit non-zero.

- [ ] **Step 3: Implement `deriveRoster` in `assignments-engine.js`**

Add near `mergeRosters` (it is the only caller of it inside the engine). This is a **move** of `assignments.js:36–54` made pure — keep the manual-field-reattachment comment block that travels with it (the INVARIANT note about addon-supplied fields):

```js
    // Pure roster derivation shared by the sheet and the positioning page: merged sources,
    // minus excluded names, with manual entries overlaid. Stale-reference sweeping of
    // overrides/cc stays with the sheet — it mutates state, this must not.
    function deriveRoster(state, linkMap) {
        const sources = state.sources || {};
        const merged = mergeRosters(sources.addon || [], sources.rh || [], linkMap || {}).roster;
        const excluded = state.excluded || [];
        const manualIn = state.manual || [];
        const base = merged.filter(p => !excluded.includes(p.name) && !manualIn.some(m => m.name === p.name));
        const manual = manualIn.filter(m => !excluded.includes(m.name)).map(m => {
            const src = merged.find(p => p.name === m.name);
            // [carry over the existing INVARIANT comment from assignments.js here verbatim]
            return Object.assign({}, m, {
                discordId: src ? src.discordId : m.discordId,
                group: src && src.group != null ? src.group : m.group,
                race: src && src.race != null ? src.race : m.race,
                talents: src && src.talents != null ? src.talents : m.talents,
            });
        });
        return base.concat(manual);
    }
```

Add `deriveRoster,` to the return block (line ~2480, next to `mergeRosters`).

In `assignments.js` `recompute()`, replace lines 36–54 (the `mergeInfo`/`base`/`manual`/`roster =` block) with:

```js
    mergeInfo = E.mergeRosters(state.sources.addon || [], state.sources.rh || [], linkMap);
    roster = E.deriveRoster(state, linkMap);
```

(`mergeInfo` is still used for the unmatched/mismatch UI, so the `mergeRosters` call stays; the derivation is no longer hand-rolled. The stale-reference sweep below it is untouched.)

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass including the 3 new ones, exit 0.

- [ ] **Step 5: Verify the sheet still works** (quick CDP smoke: load `http://localhost:3000`, paste an addon import via `AssignmentsEngine.parseAddonExport` path — simplest is evaluating `document.getElementById('addonInput').value='RSS1;A:WARRIOR:5/5/51;B:PRIEST:0/45/5'; document.getElementById('addonImportBtn').click(); roster.length` and asserting `2`.)

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js
git commit -m "refactor: roster derivation moves into the engine as deriveRoster"
```

---

### Task 2: `hyjal-positions.js` module — registry + geometry helpers

**Files:**
- Create: `hyjal-positions.js`
- Create: `hyjal-positions.test.js`
- Modify: `package.json` (test script chains the new file)

**Interfaces:**
- Produces: UMD global `HyjalPositions` / node module with:
  - `ENCOUNTERS` — registry object; `ENCOUNTERS['hyjal-b12']` as below.
  - `slotAngles(n, startDeg)` → `number[]` of `n` angles in degrees, evenly spaced clockwise from `startDeg`.
  - `angleToXY(center, rWidthFrac, deg, aspect)` → `{x, y}` image fractions.
  - `circGap(aDeg, bDeg)` → smallest circular gap in degrees (0–180).
- Consumes: `assignments-engine.js` as a factory dependency (for `bucketOf` in later tasks).

- [ ] **Step 1: Write the failing tests** (new file `hyjal-positions.test.js`, copying the harness pattern)

```js
'use strict';
const assert = require('node:assert');
const HP = require('./hyjal-positions.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- registry ---
test('registry: hyjal-b12 exists with map, anchors, two bosses', () => {
    const enc = HP.ENCOUNTERS['hyjal-b12'];
    assert.ok(enc);
    assert.strictEqual(enc.map, 'maps/hyjal-ballista.png');
    assert.deepStrictEqual(enc.bosses.map(b => b.id), ['winterchill', 'anetheron']);
    assert.ok(enc.anchors.boss.x > 0 && enc.anchors.boss.x < 1);
    assert.ok(enc.bosses[1].station, 'anetheron carries the infernal station anchor');
});

// --- geometry ---
test('slotAngles: even spacing from the start angle', () => {
    assert.deepStrictEqual(HP.slotAngles(4, -90), [-90, 0, 90, 180]);
});
test('angleToXY: 0 degrees is straight right, aspect-corrected', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, 0, 2.0);
    assert.ok(Math.abs(p.x - 0.6) < 1e-9);
    assert.ok(Math.abs(p.y - 0.5) < 1e-9);
});
test('angleToXY: -90 degrees is straight up, y shrinks by r*aspect', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, -90, 2.0);
    assert.ok(Math.abs(p.x - 0.5) < 1e-9);
    assert.ok(Math.abs(p.y - 0.3) < 1e-9);   // 0.5 - 0.1*2.0
});
test('circGap: wraps around', () => {
    assert.strictEqual(HP.circGap(-170, 170), 20);
    assert.strictEqual(HP.circGap(0, 180), 180);
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
```

- [ ] **Step 2: Run to verify failure**

Run: `node hyjal-positions.test.js`
Expected: crash (`Cannot find module './hyjal-positions.js'`).

- [ ] **Step 3: Implement the module skeleton**

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.HyjalPositions = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    // Every coordinate is a fraction of the map image: x of width, y of height. The map can
    // be swapped for another screenshot of the same viewport without touching code. Distance
    // math converts y through the image aspect so rings stay circular on screen.
    const ENCOUNTERS = {
        'hyjal-b12': {
            id: 'hyjal-b12',
            name: 'Hyjal · Rage Winterchill & Anetheron',
            map: 'maps/hyjal-ballista.png',
            aspect: 1698 / 926,
            bosses: [
                { id: 'winterchill', name: 'Rage Winterchill' },
                { id: 'anetheron', name: 'Anetheron',
                  station: { x: 0.65, y: 0.12, label: 'Infernals → Jaina' } },
            ],
            // Digitized from maps/reference-winterchill-annotated.png (same viewport).
            anchors: {
                boss: { x: 0.56, y: 0.40 },
                mt: { x: 0.60, y: 0.37 },
                clump: { x: 0.53, y: 0.46 },
            },
            ring: { rBase: 0.145, rJitter: 0.018, startDeg: -90 },
        },
    };

    function slotAngles(n, startDeg) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(startDeg + i * 360 / n);
        return out;
    }

    function angleToXY(center, r, deg, aspect) {
        const rad = deg * Math.PI / 180;
        return { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) * aspect };
    }

    function circGap(a, b) {
        let d = Math.abs(a - b) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    return { ENCOUNTERS, slotAngles, angleToXY, circGap };
}));
```

- [ ] **Step 4: Run tests, expect all pass.** `node hyjal-positions.test.js`

- [ ] **Step 5: Chain into `npm test`** — in `package.json`:

```json
"test": "node assignments-engine.test.js && node wcl-mult.test.js && node hyjal-positions.test.js"
```

Run `npm test`, expect exit 0.

- [ ] **Step 6: Commit**

```bash
git add hyjal-positions.js hyjal-positions.test.js package.json
git commit -m "feat: hyjal-positions module — encounter registry and ring geometry"
```

---

### Task 3: `computePositions` — classification, anchors, party wedges

**Files:**
- Modify: `hyjal-positions.js`
- Test: `hyjal-positions.test.js`

**Interfaces:**
- Produces: `HP.computePositions(roster, groupsResult, duties, opts)` where `groupsResult = E.proposeGroups(roster)`, `duties = E.autoAssign(roster, overrides).duties`, `opts = { boss: 'winterchill'|'anetheron', nudges: {[name]: {dx, dy}}, encounter: 'hyjal-b12' }` (all opts optional; defaults `winterchill`, `{}`, `'hyjal-b12'`).
  Returns `{ markers, warnings }`:
  - static markers: `{ kind: 'boss', x, y, label }` and (anetheron) `{ kind: 'station', x, y, label }`
  - clump: `{ kind: 'clump', x, y, names: string[] }` (melee + spare tanks; omitted when empty)
  - people: `{ kind: 'mt'|'offtank'|'ring', name, class, role: 'tank'|'healer'|'ranged', x, y, angleDeg?, party?, tags: string[] }`
  Ring markers appear in slot order; `party` is the 1-based group index the player came from.
- Test fixture helper `mk(name, cls, spec, extra)` defined in the test file (below) — later tasks reuse it.

- [ ] **Step 1: Write the failing tests** (append; add the fixture helper near the top of the test file)

```js
const E = require('./assignments-engine.js');
function mk(name, cls, spec, extra) {
    return Object.assign({ name, class: cls, spec, flags: [] }, extra || {});
}
// 10-player fixture: 2 tanks, 3 healers, 2 melee, 3 ranged/casters
function fixtureRoster() {
    return [
        mk('Mt', 'WARRIOR', 'Protection', { mt: true }), mk('Ot', 'PALADIN', 'Protection'),
        mk('Hpal', 'PALADIN', 'Holy'), mk('Rsham', 'SHAMAN', 'Restoration'), mk('Cpriest', 'PRIEST', 'Holy'),
        mk('Rog', 'ROGUE', 'Combat'), mk('Warr', 'WARRIOR', 'Fury'),
        mk('Hunt', 'HUNTER', 'Beast Mastery'), mk('Lock', 'WARLOCK', 'Destruction'), mk('Mage', 'MAGE', 'Frost'),
    ];
}
function compute(roster, opts) {
    return HP.computePositions(roster, E.proposeGroups(roster), E.autoAssign(roster, {}).duties, opts || {});
}

// --- computePositions basics ---
test('compute: every non-melee non-tank player gets exactly one ring marker', () => {
    const r = compute(fixtureRoster());
    const ring = r.markers.filter(m => m.kind === 'ring');
    assert.deepStrictEqual(ring.map(m => m.name).sort(), ['Cpriest', 'Hpal', 'Hunt', 'Lock', 'Mage', 'Rsham']);
});
test('compute: mt at the boss anchor side, melee in one clump with names', () => {
    const r = compute(fixtureRoster());
    assert.strictEqual(r.markers.filter(m => m.kind === 'mt').length, 1);
    const clump = r.markers.find(m => m.kind === 'clump');
    assert.ok(clump.names.includes('Rog') && clump.names.includes('Warr'));
});
test('compute: winterchill puts the offtank in the clump, not a station', () => {
    const r = compute(fixtureRoster(), { boss: 'winterchill' });
    assert.ok(!r.markers.some(m => m.kind === 'station'));
    assert.ok(r.markers.find(m => m.kind === 'clump').names.includes('Ot'));
});
test('compute: party members sit on adjacent ring slots', () => {
    const roster = fixtureRoster();
    const groups = E.proposeGroups(roster);
    const r = HP.computePositions(roster, groups, E.autoAssign(roster, {}).duties, {});
    const ring = r.markers.filter(m => m.kind === 'ring');
    // slot order is marker order; every party's members must be contiguous in it
    const parties = [...new Set(ring.map(m => m.party))];
    parties.forEach(pi => {
        const idxs = ring.map((m, i) => m.party === pi ? i : -1).filter(i => i !== -1);
        const span = idxs[idxs.length - 1] - idxs[0];
        assert.strictEqual(span, idxs.length - 1, 'party ' + pi + ' is not contiguous');
    });
});
test('compute: all coordinates are inside the image', () => {
    const r = compute(fixtureRoster());
    r.markers.forEach(m => {
        assert.ok(m.x > 0 && m.x < 1 && m.y > 0 && m.y < 1, (m.name || m.kind) + ' escaped the map');
    });
});
test('compute: deterministic', () => {
    assert.deepStrictEqual(compute(fixtureRoster()), compute(fixtureRoster()));
});
```

- [ ] **Step 2: Run, expect FAIL** (`HP.computePositions is not a function`).

- [ ] **Step 3: Implement.** Inside the factory:

```js
    function roleOf(p) {
        const b = E.bucketOf(p);
        if (b === 'tanks') return 'tank';
        if (b === 'healers') return 'healer';
        if (b === 'melee') return 'melee';
        return 'ranged'; // casters + hunters both live on the ring
    }

    function pickTanks(roster) {
        const flagged = roster.filter(p => p.mt);
        const tanks = flagged.length ? flagged : roster.filter(p => E.bucketOf(p) === 'tanks');
        return { mt: tanks[0] || null, offtank: tanks[1] || null, spare: tanks.slice(2) };
    }

    function computePositions(roster, groupsResult, duties, opts) {
        opts = opts || {};
        const enc = ENCOUNTERS[opts.encounter || 'hyjal-b12'];
        const bossMode = opts.boss || 'winterchill';
        const bossDef = enc.bosses.find(b => b.id === bossMode) || enc.bosses[0];
        const nudges = opts.nudges || {};
        const markers = [];
        const warnings = [];

        const { mt, offtank, spare } = pickTanks(roster);
        const tankNames = new Set([mt, offtank].concat(spare).filter(Boolean).map(p => p.name));
        const melee = roster.filter(p => !tankNames.has(p.name) && roleOf(p) === 'melee');
        const ringPeople = roster.filter(p => !tankNames.has(p.name) && (roleOf(p) === 'healer' || roleOf(p) === 'ranged'));

        markers.push({ kind: 'boss', x: enc.anchors.boss.x, y: enc.anchors.boss.y, label: bossDef.name });
        if (mt) markers.push(person(mt, 'mt', enc.anchors.mt, null, nudges));

        const clumpNames = melee.map(p => p.name).concat(spare.map(p => p.name));
        if (bossMode === 'anetheron' && offtank) {
            markers.push({ kind: 'station', x: bossDef.station.x, y: bossDef.station.y, label: bossDef.station.label });
            markers.push(person(offtank, 'offtank', bossDef.station, null, nudges));
        } else if (offtank) {
            clumpNames.push(offtank.name);
        }
        if (clumpNames.length) {
            markers.push({ kind: 'clump', x: enc.anchors.clump.x, y: enc.anchors.clump.y, names: clumpNames });
        }

        // Party wedges: each group's ring members stay contiguous (totem range).
        const groups = (groupsResult && groupsResult.groups) || [];
        const onRing = new Set(ringPeople.map(p => p.name));
        const wedges = groups
            .map((g, i) => ({ party: i + 1, players: g.players.filter(p => onRing.has(p.name)) }))
            .filter(w => w.players.length);
        // Anyone not in a proposed group (groups cap at 25) still gets a slot.
        const grouped = new Set(wedges.flatMap(w => w.players.map(p => p.name)));
        const rest = ringPeople.filter(p => !grouped.has(p.name));
        if (rest.length) wedges.push({ party: wedges.length + 1, players: rest });

        const ordered = wedges.flatMap(w => w.players.map(p => ({ p, party: w.party })));
        const n = ordered.length;
        const angles = slotAngles(n, enc.ring.startDeg);
        ordered.forEach((o, i) => {
            const r = enc.ring.rBase + (i % 2 ? enc.ring.rJitter : -enc.ring.rJitter);
            const pos = angleToXY(enc.anchors.boss, r, angles[i], enc.aspect);
            const m = person(o.p, 'ring', pos, angles[i], nudges);
            m.party = o.party;
            markers.push(m);
        });

        return { markers, warnings };
    }

    function person(p, kind, pos, angleDeg, nudges) {
        const nudge = nudges[p.name] || { dx: 0, dy: 0 };
        const m = { kind, name: p.name, class: p.class, role: roleOf(p), x: pos.x + nudge.dx, y: pos.y + nudge.dy, tags: [] };
        if (angleDeg !== null) m.angleDeg = angleDeg;
        return m;
    }
```

Export `computePositions` (and keep `roleOf` internal). Note `roleOf` maps tanks by bucket, but `person()` is only ever called for people already classified — `role` on an mt/offtank marker will be `'tank'` for prot specs and may be e.g. `'melee'` for an mt-flagged Fury warrior; that is fine, `kind` is what rendering keys on.

- [ ] **Step 4: Run tests, expect all pass.** `node hyjal-positions.test.js`

- [ ] **Step 5: Commit**

```bash
git add hyjal-positions.js hyjal-positions.test.js
git commit -m "feat: computePositions — anchors, melee clump and contiguous party wedges"
```

---

### Task 4: Healer spread — wedge permutation search + within-wedge interleave + warnings

Wedge order and within-wedge ordering are the only freedom we have without breaking party adjacency. Search all wedge permutations (≤ 6 wedges → ≤ 720, trivially cheap), with healers interleaved evenly inside each wedge, and score: healers angularly even, the two tank healers opposite.

**Files:**
- Modify: `hyjal-positions.js`
- Test: `hyjal-positions.test.js`

**Interfaces:**
- Consumes: `duties` rows `{id:'tankheal', players:[]}` from `autoAssign`.
- Produces (internal, still exported for tests): `interleaveHealers(players, isHealer)`, `scoreArrangement(orderedRoles, tankHealerIdxs, startDeg)`. Warnings added to `computePositions` output: exact strings below.

- [ ] **Step 1: Write the failing tests**

```js
// --- healer spread ---
test('interleaveHealers: healers land evenly inside the wedge', () => {
    const w = [mk('H1','PRIEST','Holy'), mk('H2','PRIEST','Holy'), mk('D1','MAGE','Frost'),
               mk('D2','MAGE','Frost'), mk('D3','MAGE','Frost'), mk('D4','MAGE','Frost')];
    const out = HP.interleaveHealers(w, p => p.class === 'PRIEST');
    const idxs = out.map((p, i) => p.class === 'PRIEST' ? i : -1).filter(i => i !== -1);
    assert.strictEqual(idxs[1] - idxs[0], 3, 'healers should be 3 slots apart in a 6-wedge');
});
test('compute: healers are never on adjacent slots when avoidable', () => {
    // 3 healers, 6 dps on the ring: worst legal gap is 120deg with 9 slots (=40deg each) -> min gap >= 80deg
    const roster = [
        mk('Mt','WARRIOR','Protection',{mt:true}),
        mk('H1','PRIEST','Holy'), mk('H2','SHAMAN','Restoration'), mk('H3','PALADIN','Holy'),
        mk('D1','MAGE','Frost'), mk('D2','MAGE','Fire'), mk('D3','WARLOCK','Destruction'),
        mk('D4','HUNTER','Marksmanship'), mk('D5','HUNTER','Survival'), mk('D6','PRIEST','Shadow'),
    ];
    const r = compute(roster);
    const ring = r.markers.filter(m => m.kind === 'ring');
    const healerAngles = ring.filter(m => m.role === 'healer').map(m => m.angleDeg);
    let minGap = 360;
    for (let i = 0; i < healerAngles.length; i++)
        for (let j = i + 1; j < healerAngles.length; j++)
            minGap = Math.min(minGap, HP.circGap(healerAngles[i], healerAngles[j]));
    assert.ok(minGap >= 80, 'healer min gap was ' + minGap);
});
test('compute: the two tank healers end up on opposite sides', () => {
    const roster = fixtureRoster();
    const duties = E.autoAssign(roster, {}).duties;
    const tankHealers = duties.find(d => d.id === 'tankheal').players;
    const r = HP.computePositions(roster, E.proposeGroups(roster), duties, {});
    const ring = r.markers.filter(m => m.kind === 'ring');
    const angles = tankHealers.map(nm => ring.find(m => m.name === nm)).filter(Boolean).map(m => m.angleDeg);
    if (angles.length === 2) assert.ok(HP.circGap(angles[0], angles[1]) >= 120, 'tank healers ' + HP.circGap(angles[0], angles[1]) + 'deg apart');
});
test('compute: warning when healers are forced into a bunch', () => {
    // one party of 3 healers among 4 total ring slots cannot spread: expect the bunching warning
    const roster = [
        mk('H1','PRIEST','Holy',{group:1}), mk('H2','PRIEST','Discipline',{group:1}), mk('H3','PALADIN','Holy',{group:1}),
        mk('D1','MAGE','Frost',{group:1}),
    ];
    const r = compute(roster);
    assert.ok(r.warnings.some(w => w.includes('bunched')), JSON.stringify(r.warnings));
});
test('compute: warning when a party wedge spans more than 90 degrees', () => {
    const roster = [];
    for (let i = 0; i < 8; i++) roster.push(mk('M' + i, 'MAGE', 'Frost'));  // one 8-man caster party impossible: cap 5/group
    roster.push(mk('H1','PRIEST','Holy'));
    const r = compute(roster);
    const ring = r.markers.filter(m => m.kind === 'ring');
    const byParty = {};
    ring.forEach(m => { (byParty[m.party] = byParty[m.party] || []).push(m); });
    const overWide = Object.values(byParty).some(list => (list.length - 1) * 360 / ring.length > 90);
    if (overWide) assert.ok(r.warnings.some(w => w.includes('totem range')), JSON.stringify(r.warnings));
});
```

- [ ] **Step 2: Run, expect the new tests to FAIL** (no `interleaveHealers`, no spread logic, no warnings).

- [ ] **Step 3: Implement.** Add to the factory and wire into `computePositions` where `ordered` was built:

```js
    function interleaveHealers(players, isHealer) {
        const healers = players.filter(isHealer);
        const others = players.filter(p => !isHealer(p));
        if (!healers.length || !others.length) return players.slice();
        const len = players.length;
        const out = new Array(len).fill(null);
        healers.forEach((h, j) => {
            let idx = Math.floor((j + 0.5) * len / healers.length) % len;
            while (out[idx]) idx = (idx + 1) % len;
            out[idx] = h;
        });
        let k = 0;
        for (let i = 0; i < len; i++) if (!out[i]) out[i] = others[k++];
        return out;
    }

    function permutations(arr) {
        if (arr.length <= 1) return [arr.slice()];
        const out = [];
        arr.forEach((x, i) => {
            permutations(arr.slice(0, i).concat(arr.slice(i + 1)))
                .forEach(rest => out.push([x].concat(rest)));
        });
        return out;
    }

    // Angular evenness of healers plus tank-healer opposition. Higher is better.
    function scoreArrangement(ordered, isHealer, tankHealerNames, startDeg) {
        const n = ordered.length;
        const angles = slotAngles(n, startDeg);
        const healerAngles = [], thAngles = [];
        ordered.forEach((p, i) => {
            if (isHealer(p)) healerAngles.push(angles[i]);
            if (tankHealerNames.includes(p.name)) thAngles.push(angles[i]);
        });
        let minGap = 360;
        for (let i = 0; i < healerAngles.length; i++)
            for (let j = i + 1; j < healerAngles.length; j++)
                minGap = Math.min(minGap, circGap(healerAngles[i], healerAngles[j]));
        const thSep = thAngles.length === 2 ? circGap(thAngles[0], thAngles[1]) : 180;
        return 2 * minGap + thSep;
    }
```

In `computePositions`, replace `const ordered = wedges.flatMap(...)` with:

```js
        const isHealer = p => roleOf(p) === 'healer';
        const tankHealRow = (duties || []).find(d => d.id === 'tankheal');
        const tankHealerNames = tankHealRow ? tankHealRow.players : [];
        const interleaved = wedges.map(w => ({ party: w.party, players: interleaveHealers(w.players, isHealer) }));
        let best = null, bestScore = -Infinity;
        permutations(interleaved).forEach(perm => {
            const flat = perm.flatMap(w => w.players);
            const s = scoreArrangement(flat, isHealer, tankHealerNames, enc.ring.startDeg);
            if (s > bestScore) { bestScore = s; best = perm; }
        });
        const ordered = (best || []).flatMap(w => w.players.map(p => ({ p, party: w.party })));
```

Warnings, after the ring markers are pushed (`ringMarkers = markers.filter(m => m.kind === 'ring')`):

```js
        const healerMarks = ringMarkers.filter(m => m.role === 'healer');
        if (healerMarks.length >= 2) {
            let minGap = 360;
            for (let i = 0; i < healerMarks.length; i++)
                for (let j = i + 1; j < healerMarks.length; j++)
                    minGap = Math.min(minGap, circGap(healerMarks[i].angleDeg, healerMarks[j].angleDeg));
            if (minGap < 30) warnings.push('Healers are bunched: two healers stand within 30° of each other.');
        }
        const thMarks = ringMarkers.filter(m => tankHealerNames.includes(m.name));
        if (thMarks.length === 2 && circGap(thMarks[0].angleDeg, thMarks[1].angleDeg) < 90)
            warnings.push('Tank healers are on the same side of the boss — one Carrion Swarm can hit both.');
        const byParty = {};
        ringMarkers.forEach(m => { (byParty[m.party] = byParty[m.party] || []).push(m); });
        Object.keys(byParty).forEach(pi => {
            const span = (byParty[pi].length - 1) * 360 / ringMarkers.length;
            if (span > 90) warnings.push('Party ' + pi + ' stretches over ' + Math.round(span) + '° of the ring — totem range may not cover it.');
        });
```

Export `interleaveHealers` and `scoreArrangement`.

- [ ] **Step 4: Run tests.** `node hyjal-positions.test.js` — all pass, including Task 3's (adjacency must survive the permutation search: permuting whole wedges and reordering *within* a wedge both preserve contiguity).

- [ ] **Step 5: Commit**

```bash
git add hyjal-positions.js hyjal-positions.test.js
git commit -m "feat: healer spread — wedge permutation search, interleave, spread warnings"
```

---

### Task 5: Anetheron extras + nudges

**Files:**
- Modify: `hyjal-positions.js`
- Test: `hyjal-positions.test.js`

**Interfaces:**
- Produces: on `boss: 'anetheron'`: ring markers of the chosen infernal-station healers carry `tags: ['infernal-healer']`; warnings `'No second tank for the infernal station.'` and `'No raid healer available for the infernal station.'`. Nudges: `opts.nudges[name] = {dx, dy}` shifts that player's marker; already plumbed through `person()` in Task 3 — this task tests it.

- [ ] **Step 1: Write the failing tests**

```js
// --- anetheron mode ---
test('anetheron: offtank moves to the station and it renders', () => {
    const r = compute(fixtureRoster(), { boss: 'anetheron' });
    const station = r.markers.find(m => m.kind === 'station');
    const ot = r.markers.find(m => m.kind === 'offtank');
    assert.ok(station && ot);
    assert.strictEqual(ot.name, 'Ot');
    assert.ok(!r.markers.find(m => m.kind === 'clump').names.includes('Ot'));
});
test('anetheron: the raid healer nearest the station is tagged infernal-healer', () => {
    const roster = fixtureRoster();
    const duties = E.autoAssign(roster, {}).duties;
    const raidHealers = duties.find(d => d.id === 'raidheal').players;
    const r = HP.computePositions(roster, E.proposeGroups(roster), duties, { boss: 'anetheron' });
    const tagged = r.markers.filter(m => (m.tags || []).includes('infernal-healer'));
    assert.strictEqual(tagged.length, 1);   // fixture has < 4 raid healers -> exactly 1
    assert.ok(raidHealers.includes(tagged[0].name), 'tagged a tank healer instead of a raid healer');
});
test('anetheron: single-tank roster warns about the station', () => {
    const roster = fixtureRoster().filter(p => p.name !== 'Ot');
    const r = compute(roster, { boss: 'anetheron' });
    assert.ok(r.warnings.some(w => w.includes('No second tank')), JSON.stringify(r.warnings));
});
test('winterchill: no infernal-healer tags', () => {
    const r = compute(fixtureRoster(), { boss: 'winterchill' });
    assert.ok(!r.markers.some(m => (m.tags || []).includes('infernal-healer')));
});

// --- nudges ---
test('nudges: shift the named marker and only that marker', () => {
    const base = compute(fixtureRoster());
    const nudged = compute(fixtureRoster(), { nudges: { Hunt: { dx: 0.05, dy: -0.02 } } });
    const b = base.markers.find(m => m.name === 'Hunt');
    const v = nudged.markers.find(m => m.name === 'Hunt');
    assert.ok(Math.abs(v.x - (b.x + 0.05)) < 1e-9 && Math.abs(v.y - (b.y - 0.02)) < 1e-9);
    const others = base.markers.filter(m => m.name && m.name !== 'Hunt');
    others.forEach(o => {
        const o2 = nudged.markers.find(m => m.name === o.name);
        assert.strictEqual(o2.x, o.x);
    });
});
```

- [ ] **Step 2: Run — anetheron tag tests and the warning test FAIL; the nudge test may already pass (plumbed in Task 3); keep it as a regression test.**

- [ ] **Step 3: Implement** in `computePositions`, after warnings:

```js
        if (bossMode === 'anetheron') {
            if (!offtank) warnings.push('No second tank for the infernal station.');
            const raidHealRow = (duties || []).find(d => d.id === 'raidheal');
            const raidHealerNames = raidHealRow ? raidHealRow.players : [];
            const candidates = ringMarkers.filter(m => raidHealerNames.includes(m.name));
            if (!candidates.length) {
                warnings.push('No raid healer available for the infernal station.');
            } else {
                const st = bossDef.station;
                const stAngle = Math.atan2((st.y - enc.anchors.boss.y) / enc.aspect, st.x - enc.anchors.boss.x) * 180 / Math.PI;
                const want = raidHealerNames.length >= 4 ? 2 : 1;
                candidates
                    .slice()
                    .sort((a, b) => circGap(a.angleDeg, stAngle) - circGap(b.angleDeg, stAngle))
                    .slice(0, want)
                    .forEach(m => m.tags.push('infernal-healer'));
            }
        }
```

- [ ] **Step 4: Run all tests.** `npm test` — everything passes.

- [ ] **Step 5: Commit**

```bash
git add hyjal-positions.js hyjal-positions.test.js
git commit -m "feat: anetheron station healers, station warnings, nudge regression test"
```

---

### Task 6: The Positioning page

**Files:**
- Create: `positions.html`
- Create: `positions.css`
- Create: `positions.js`
- Modify: `assignments.css` (shared `.page-tabs` styles)

**Interfaces:**
- Consumes: `E.deriveRoster`, `E.autoAssign`, `E.proposeGroups`, `HP.computePositions`, `HP.ENCOUNTERS`, localStorage `raidAssignmentsState` + `raidAssignmentsLinkMap`.
- Produces: localStorage key `raidPositionsState` = `{ boss: 'winterchill'|'anetheron', nudges: {[name]: {dx, dy}} }`. `positions.js` exposes top-level `lastResult` (the last `computePositions` output) and `renderAll()` for the CDP harness, same bare-reference style as `assignments.js`'s `roster`.
- The map markup contract (Tasks 7–9 rely on it): `#mapWrap` (relative-positioned div) > `#mapImg` (the background `<img>`) + one `div.pos-marker[data-name]` per person marker, positioned with `style.left/top` percentages.

- [ ] **Step 1: `positions.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Raid Positioning</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="assignments.css">
    <link rel="stylesheet" href="positions.css">
</head>
<body>
    <div class="container">
        <nav class="page-tabs">
            <a href="./" class="page-tab">Assignments</a>
            <a href="positions.html" class="page-tab active">Positioning</a>
        </nav>
        <header>
            <h1>Raid Positioning</h1>
            <p id="encounterName"></p>
        </header>
        <section class="panel">
            <div class="tabbar">
                <button class="tab active" id="bossWinterchill">Rage Winterchill</button>
                <button class="tab" id="bossAnetheron">Anetheron</button>
                <span class="spacer"></span>
                <button id="resetNudges" class="btn">Reset nudges</button>
                <button id="copyImageBtn" class="btn">📋 Copy as image</button>
            </div>
            <div id="posWarnings" class="warn hidden"></div>
            <div id="emptyState" class="status hidden">Import a roster on the Assignments page first.</div>
            <div id="mapWrap"><img id="mapImg" alt="Hyjal ballista area"></div>
        </section>
    </div>
    <script src="assignments-engine.js"></script>
    <script src="hyjal-positions.js"></script>
    <script src="positions.js"></script>
</body>
</html>
```

(The Assignments tab links to `./` because `assignments.html` is served as the site root — verify the express static/root route in `server.js` while implementing and use whatever path the sheet actually lives at.)

- [ ] **Step 2: `positions.css`** — map container, markers, tabs:

```css
#mapWrap { position: relative; width: 100%; margin-top: 12px; user-select: none; }
#mapWrap img { display: block; width: 100%; height: auto; border-radius: 8px; }

.pos-marker { position: absolute; transform: translate(-50%, -50%); text-align: center;
              cursor: grab; touch-action: none; z-index: 2; }
.pos-marker.static { cursor: default; }
.pos-dot { width: 28px; height: 28px; border-radius: 50%; margin: 0 auto;
           display: flex; align-items: center; justify-content: center;
           font-size: 15px; color: #fff; border: 2px solid rgba(255,255,255,.85);
           box-shadow: 0 1px 4px rgba(0,0,0,.6); }
.pos-role-healer .pos-dot { background: #1d5c46; }
.pos-role-ranged .pos-dot { background: #7a1f24; }
.pos-role-melee .pos-dot, .pos-kind-clump .pos-dot { background: #7a1f24; }
.pos-kind-mt .pos-dot, .pos-kind-offtank .pos-dot { background: #1d3557; }
.pos-kind-boss .pos-dot { background: #3a2b4d; width: 34px; height: 34px; }
.pos-kind-station .pos-dot { background: #274156; }
.pos-label { margin-top: 2px; font-size: 11px; line-height: 1.25; color: #fff;
             text-shadow: 0 1px 3px #000, 0 0 6px #000; white-space: pre; }
.pos-marker .pos-tag { display: block; font-size: 10px; color: #ffd166; }

.page-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
.page-tab { padding: 8px 16px; border-radius: 8px 8px 0 0; text-decoration: none;
            color: inherit; opacity: .65; background: rgba(255,255,255,.06); }
.page-tab.active { opacity: 1; background: rgba(255,255,255,.14); font-weight: 600; }
```

Put the `.page-tabs` block in `assignments.css` (both pages load it); the rest in `positions.css`. Match the blue-palette theme of the recent retheme (`ed5dbf7`) — read `assignments.css` for the exact accent variables and reuse them instead of the raw rgba values above if variables exist.

- [ ] **Step 3: `positions.js`**

```js
/* global AssignmentsEngine, HyjalPositions */
'use strict';
const E = AssignmentsEngine;
const HP = HyjalPositions;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';
const POS_KEY = 'raidPositionsState';
const ENCOUNTER = 'hyjal-b12';

let posState = { boss: 'winterchill', nudges: {} };
let lastResult = null;
let roster = [];

function loadAll() {
    let sheetState = {}, linkMap = {};
    try { sheetState = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* fresh */ }
    try { linkMap = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { /* fresh */ }
    try { Object.assign(posState, JSON.parse(localStorage.getItem(POS_KEY)) || {}); } catch (e) { /* fresh */ }
    roster = E.deriveRoster(sheetState, linkMap);
    return sheetState;
}
function savePos() { localStorage.setItem(POS_KEY, JSON.stringify(posState)); }

function renderAll() {
    const sheetState = loadAll();
    const enc = HP.ENCOUNTERS[ENCOUNTER];
    document.getElementById('encounterName').textContent = enc.name;
    document.getElementById('mapImg').src = enc.map;
    document.getElementById('bossWinterchill').classList.toggle('active', posState.boss === 'winterchill');
    document.getElementById('bossAnetheron').classList.toggle('active', posState.boss === 'anetheron');
    const empty = document.getElementById('emptyState');
    document.querySelectorAll('.pos-marker').forEach(el => el.remove());
    if (!roster.length) { empty.classList.remove('hidden'); lastResult = null; renderWarnings([]); return; }
    empty.classList.add('hidden');
    const duties = E.autoAssign(roster, sheetState.overrides || {}).duties;
    lastResult = HP.computePositions(roster, E.proposeGroups(roster), duties, {
        boss: posState.boss, nudges: posState.nudges, encounter: ENCOUNTER,
    });
    const wrap = document.getElementById('mapWrap');
    lastResult.markers.forEach(m => wrap.appendChild(markerEl(m)));
    renderWarnings(lastResult.warnings);
}

const GLYPHS = { boss: '💀', station: '🔥', clump: '⚔', mt: '🛡', offtank: '🛡', healer: '✚', ranged: '➹', melee: '⚔', tank: '🛡' };

function markerEl(m) {
    const el = document.createElement('div');
    const isPerson = !!m.name;
    el.className = 'pos-marker pos-kind-' + m.kind + (m.role ? ' pos-role-' + m.role : '') + (isPerson ? '' : ' static');
    el.style.left = (m.x * 100) + '%';
    el.style.top = (m.y * 100) + '%';
    if (isPerson) el.dataset.name = m.name;
    const dot = document.createElement('div');
    dot.className = 'pos-dot';
    dot.textContent = GLYPHS[m.kind === 'ring' ? m.role : m.kind] || '●';
    el.appendChild(dot);
    const label = document.createElement('div');
    label.className = 'pos-label';
    label.textContent = m.kind === 'clump' ? m.names.join('\n') : (m.name || m.label || '');
    el.appendChild(label);
    if ((m.tags || []).includes('infernal-healer')) {
        const tag = document.createElement('span');
        tag.className = 'pos-tag';
        tag.textContent = '→ infernal station';
        label.appendChild(tag);
    }
    return el;
}

function renderWarnings(warnings) {
    const box = document.getElementById('posWarnings');
    box.classList.toggle('hidden', !warnings.length);
    box.textContent = warnings.join('\n');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('bossWinterchill').addEventListener('click', () => { posState.boss = 'winterchill'; savePos(); renderAll(); });
    document.getElementById('bossAnetheron').addEventListener('click', () => { posState.boss = 'anetheron'; savePos(); renderAll(); });
    document.getElementById('resetNudges').addEventListener('click', () => { posState.nudges = {}; savePos(); renderAll(); });
    renderAll();
});
```

`copyImageBtn` is wired in Task 8; leave the button inert for now.

- [ ] **Step 4: Manual + CDP verification** (background task; server via `npm start`):
  1. Load `http://localhost:3000/positions.html` with an empty localStorage → empty-state line shows, no markers, no JS errors in the console log.
  2. Seed a roster: evaluate `localStorage.setItem('raidAssignmentsState', JSON.stringify({sources:{addon: <10-player fixture as parsed players>, rh:null}, manual:[], excluded:[]}))`, reload → expect: boss marker, MT, clump with names, ring markers = healer+ranged count, warnings box state.
  3. Click `#bossAnetheron` → station marker appears, offtank moves, an `→ infernal station` tag shows.
  4. Take a screenshot (`Page.captureScreenshot`), save to the scratchpad, and **look at it**: markers on the map, ring roughly circular, labels legible, nothing off-canvas.
- [ ] **Step 5: Fine-tune anchors from the screenshot.** Compare against `maps/reference-winterchill-annotated.png`; adjust `anchors`/`ring` fractions in the registry if the boss sits off the path crossing or the ring clips the tower. Re-run `npm test` (geometry tests use ratios, not absolute anchors, so tuning does not break them — if a bounds test fails, shrink `rBase`).

- [ ] **Step 6: Commit**

```bash
git add positions.html positions.css positions.js assignments.css
git commit -m "feat: Positioning page — Hyjal map with auto-placed markers and boss toggle"
```

---

### Task 7: Drag-to-nudge

**Files:**
- Modify: `positions.js`

**Interfaces:**
- Consumes: the `#mapWrap`/`.pos-marker[data-name]` markup contract from Task 6; `posState.nudges` shape `{[name]: {dx, dy}}` already honored by `computePositions`.

- [ ] **Step 1: Implement pointer-event dragging.** Add to `positions.js` and call `wireDrag(el, m)` inside `markerEl` for person markers only:

```js
function wireDrag(el, m) {
    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const wrap = document.getElementById('mapWrap').getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const baseX = m.x, baseY = m.y;
        let moved = false;
        const onMove = ev => {
            const fx = baseX + (ev.clientX - startX) / wrap.width;
            const fy = baseY + (ev.clientY - startY) / wrap.height;
            moved = true;
            el.style.left = (Math.min(0.99, Math.max(0.01, fx)) * 100) + '%';
            el.style.top = (Math.min(0.99, Math.max(0.01, fy)) * 100) + '%';
        };
        const onUp = ev => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            if (!moved) return;
            const fx = Math.min(0.99, Math.max(0.01, baseX + (ev.clientX - startX) / wrap.width));
            const fy = Math.min(0.99, Math.max(0.01, baseY + (ev.clientY - startY) / wrap.height));
            const prev = posState.nudges[m.name] || { dx: 0, dy: 0 };
            // computed base already includes prev nudge; the new nudge is prev + this drag's delta
            posState.nudges[m.name] = { dx: prev.dx + (fx - baseX), dy: prev.dy + (fy - baseY) };
            savePos();
            renderAll();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
    });
}
```

- [ ] **Step 2: CDP verification.** Dispatch `Input.dispatchMouseEvent` press/move/release over a named marker; then evaluate `JSON.parse(localStorage.getItem('raidPositionsState')).nudges` and assert the dragged name is present with nonzero `dx`; reload the page and assert the marker's `style.left` differs from an undragged sibling's computed slot; click `#resetNudges` and assert nudges are `{}`.

- [ ] **Step 3: Commit**

```bash
git add positions.js
git commit -m "feat: drag-to-nudge markers with persistent per-player offsets"
```

---

### Task 8: Copy as image

**Files:**
- Modify: `positions.js`

**Interfaces:**
- Produces: `HP`-independent local `drawMarkers(ctx, W, H, markers)` in `positions.js` (canvas mirror of `markerEl`); `copyImageBtn` writes a PNG `ClipboardItem`.

- [ ] **Step 1: Implement**

```js
function drawMarkers(ctx, W, H, markers) {
    markers.forEach(m => {
        const x = m.x * W, y = m.y * H;
        const R = m.kind === 'boss' ? 26 : 20;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = { healer: '#1d5c46', ranged: '#7a1f24', melee: '#7a1f24' }[m.role]
            || { boss: '#3a2b4d', station: '#274156', clump: '#7a1f24', mt: '#1d3557', offtank: '#1d3557' }[m.kind]
            || '#444';
        ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold ' + R + 'px sans-serif';
        ctx.fillText(GLYPHS[m.kind === 'ring' ? m.role : m.kind] || '●', x, y + R * 0.35);
        ctx.font = 'bold 15px sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
        const lines = m.kind === 'clump' ? m.names : [(m.name || m.label || '')];
        lines.forEach((ln, i) => ctx.fillText(ln, x, y + R + 16 + i * 16));
        if ((m.tags || []).includes('infernal-healer')) {
            ctx.fillStyle = '#ffd166';
            ctx.fillText('→ infernal station', x, y + R + 16 + lines.length * 16);
            ctx.fillStyle = '#fff';
        }
        ctx.shadowBlur = 0;
    });
}

async function copyImage() {
    if (!lastResult) return;
    const img = document.getElementById('mapImg');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    drawMarkers(ctx, canvas.width, canvas.height, lastResult.markers);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const btn = document.getElementById('copyImageBtn');
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        btn.textContent = '✅ Copied';
    } catch (e) {
        // clipboard is unavailable (permissions, headless): fall back to a download
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hyjal-positions.png';
        a.click();
        btn.textContent = '⬇ Saved';
    }
    setTimeout(() => { btn.textContent = '📋 Copy as image'; }, 1500);
}
```

Wire `document.getElementById('copyImageBtn').addEventListener('click', copyImage);` in the DOMContentLoaded block.

- [ ] **Step 2: CDP verification — do NOT click the button headlessly** (clipboard hangs headless Chrome). Instead evaluate the canvas pipeline directly: build the canvas + `drawMarkers` exactly as `copyImage` does, then `canvas.toDataURL('image/png').length > 100000`; decode the data URL to the scratchpad and **look at the PNG** — background plus markers plus names.
- [ ] **Step 3: Manually sanity-check in a headed browser if available; otherwise note in the commit that clipboard write is untested headlessly by design.**

- [ ] **Step 4: Commit**

```bash
git add positions.js
git commit -m "feat: copy the positioned map as a PNG for Discord"
```

---

### Task 9: Nav tabs on the sheet, share payload, share-view map

**Files:**
- Modify: `assignments.html` (nav tabs + `hyjal-positions.js` script tag)
- Modify: `assignments.js` (`buildShareLink` gains `positions`)
- Modify: `assignments-view.html` (render map when the payload carries positions)

**Interfaces:**
- Consumes: `buildShareLink()` at `assignments.js:845`; view payload validation `isValidPayload` in `assignments-view.html`.
- Produces: share payload key `positions: { encounter, map, boss, markers, warnings }` — markers precomputed, so the view renders without engine logic. Absence of the key = old links keep working; `isValidPayload` is not changed.

- [ ] **Step 1: Nav tabs on the sheet.** In `assignments.html`, insert directly above `<header>`:

```html
        <nav class="page-tabs">
            <a href="./" class="page-tab active">Assignments</a>
            <a href="positions.html" class="page-tab">Positioning</a>
        </nav>
```

And add `<script src="hyjal-positions.js"></script>` after the `assignments-engine.js` tag.

- [ ] **Step 2: Extend `buildShareLink` in `assignments.js`:**

```js
function buildPositionsPayload() {
    if (!roster.length || typeof HyjalPositions === 'undefined') return null;
    let pos = { boss: 'winterchill', nudges: {} };
    try { Object.assign(pos, JSON.parse(localStorage.getItem('raidPositionsState')) || {}); } catch (e) { /* defaults */ }
    const enc = HyjalPositions.ENCOUNTERS['hyjal-b12'];
    const r = HyjalPositions.computePositions(roster, E.proposeGroups(roster), sheet.duties, {
        boss: pos.boss, nudges: pos.nudges, encounter: enc.id,
    });
    return { encounter: enc.id, map: enc.map, boss: pos.boss, markers: r.markers, warnings: r.warnings };
}
```

and in `buildShareLink()`:

```js
    const payload = { title: state.title, sheet };
    const positions = buildPositionsPayload();
    if (positions) payload.positions = positions;
```

(Check how `sheet` is shaped at that point — `sheet.duties` is used by the healing card render, confirm the property name while editing.)

- [ ] **Step 3: Render in `assignments-view.html`.** Add below the cards div:

```html
        <div id="posSection" class="hidden">
            <h3>Positioning</h3>
            <div id="posWarnings" class="warn hidden"></div>
            <div id="mapWrap"><img id="mapImg" alt="Positioning map"></div>
        </div>
```

Add `<link rel="stylesheet" href="positions.css">` in the head. In the inline script, after the existing sheet rendering, add a read-only marker renderer (structure identical to `markerEl` from Task 6 minus drag and tags wiring — ~25 lines, duplicated on purpose: the view page is deliberately self-contained and engine-free for everything but constants, matching how it already re-implements row rendering):

```js
            if (payload.positions && Array.isArray(payload.positions.markers)) {
                document.getElementById('posSection').classList.remove('hidden');
                document.getElementById('mapImg').src = payload.positions.map;
                const warn = payload.positions.warnings || [];
                const wbox = document.getElementById('posWarnings');
                wbox.classList.toggle('hidden', !warn.length);
                wbox.textContent = warn.join('\n');
                const wrap = document.getElementById('mapWrap');
                payload.positions.markers.forEach(m => wrap.appendChild(viewMarker(m)));
            }
```

with `viewMarker(m)` building the same `.pos-marker`/`.pos-dot`/`.pos-label` DOM (including the `→ infernal station` tag span and the clump name list), always with class `static`.

- [ ] **Step 4: CDP verification.** Seed a roster on the sheet, evaluate `buildShareLink()` (bare reference — do not click the Share button headlessly), load the produced URL, assert `#posSection` visible, marker count matches, screenshot and **look at it**. Also load an OLD-style link (payload without `positions`) and assert the view still renders with `#posSection` hidden.
- [ ] **Step 5: Run `npm test` (should be untouched-green), commit**

```bash
git add assignments.html assignments.js assignments-view.html
git commit -m "feat: share view renders the Hyjal positioning map; nav tabs on the sheet"
```

---

### Task 10: Final verification pass

- [ ] **Step 1:** `npm test` — full suite green; paste the real output into the report.
- [ ] **Step 2:** Full CDP pass covering the user's flow: import roster on sheet → Positioning tab → toggle Anetheron → drag one marker → back to sheet → Share tab → open share URL → map present with the nudge applied. Screenshot each stage into the scratchpad and review them.
- [ ] **Step 3:** Re-read the spec (`docs/superpowers/specs/2026-08-27-hyjal-positioning-design.md`) end-to-end and check every requirement has landed; list any deviation to the user rather than silently reinterpreting.
- [ ] **Step 4:** Commit anything outstanding; report with the superpowers:verification-before-completion discipline (evidence before claims).
