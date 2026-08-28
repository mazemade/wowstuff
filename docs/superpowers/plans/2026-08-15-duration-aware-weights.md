# Duration-Aware Weights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calibrate the group-optimizer weights at three encounter durations (200/300/520s) with a realistic shadow priest, interpolate between them at runtime, and drive the active duration from the kill times the WCL fetch already downloads.

**Architecture:** The calibration harness grows `--duration`/`--sp-dps` parameters and produces three `weights-<dur>.json` anchor files. `inject-weights.mjs` writes a `CAL_ANCHORS` block into the engine plus empty-shaped `BASELINE`/`BUFF_V`; a hand-written `setEncounterDuration(sec)` fills them by piecewise-linear interpolation, mutating in place so `PARTY_BUFFS`' captured references stay live. `wcl-mult.js` gains `rosterKillDurations` (kill durations already ride the existing `/api/wcl/player` payload); the UI gets a Farm/Long/Custom fight-length control.

**Tech Stack:** Plain JS (UMD engine, no build step), Node ESM scripts in `calibration/`, wowsims CLI (prebuilt at `calibration/vendor/wowsimcli`), `node:assert` test scripts.

**Spec:** `docs/superpowers/specs/2026-08-15-duration-aware-weights-spec.md`

## Global Constraints

- Execute AFTER `docs/superpowers/plans/2026-08-15-optimizer-3cycle-escape.md` (the suite reconciliation in Task 5 assumes its 272-test state).
- `assignments-engine.js` stays one UMD file for node + browser; `wcl-mult.js` likewise. No new dependencies anywhere.
- Anchor durations are exactly `200`, `300`, `520` seconds; `shadowPriestDps` is exactly `1150` at every anchor (spec D1, D2).
- The engine default duration is `200`; `setEncounterDuration` clamps outside `[200, 520]` and must be deterministic and idempotent.
- `BASELINE` and `BUFF_V` sub-objects are mutated in place, never reassigned — `PARTY_BUFFS` captures them by reference at module init (spec D3).
- Tests never key groups by role label; provider-keyed lookup only (spec D7).
- Sim runs use `randomSeed: '42'`, 10000 iterations, level-73 demon target — identical to the 2026-08-13 calibration except duration and SP DPS.
- Engine verification: `node assignments-engine.test.js` from the repo root; wcl-mult verification: `node wcl-mult.test.js`.
- Any engine test that changes the active duration must restore `setEncounterDuration(200)` before finishing.

---

### Task 1: `rosterKillDurations` in wcl-mult.js

**Files:**
- Modify: `wcl-mult.js` (add function + export; the module runs ~124 lines, add after `computeRosterMults`)
- Test: `wcl-mult.test.js`

**Interfaces:**
- Consumes: the module's existing `median(xs)` helper and `WINDOW_MS` constant; rank objects `{startTime: ms-epoch, duration: ms}` from `ranksByEncounter` (verified live: WCL `encounterRankings` ranks carry both fields, and `/api/wcl/player` passes `ranks` through untouched — spec F5).
- Produces: `rosterKillDurations({players: [{ranksByEncounter}], nowMs, windowMs?}) -> {farmMedianSec: number|null, longMedianSec: number|null, perBoss: {encId: {kills, medianSec}}}`. Task 7 consumes this from `assignments.js`.

- [ ] **Step 1: Write the failing tests**

Add to `wcl-mult.test.js`:

```js
test('rosterKillDurations: dedupes shared kills by startTime', () => {
    const now = 1000000000000;
    const rank = (st, dur) => ({ amount: 1000, spec: 'Arcane', startTime: st, duration: dur });
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [
            { ranksByEncounter: { 733: [rank(now - 1000, 150000), rank(now - 2000, 170000)] } },
            { ranksByEncounter: { 733: [rank(now - 1000, 150000)] } }, // same kill seen via a second player
        ],
    });
    assert.strictEqual(res.perBoss[733].kills, 2);
    assert.strictEqual(res.perBoss[733].medianSec, 160);
});
test('rosterKillDurations: splits farm and long at the 300s per-boss threshold', () => {
    const now = 1000000000000;
    const rank = (st, dur) => ({ startTime: st, duration: dur });
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [{ ranksByEncounter: {
            1: [rank(now - 1, 170000), rank(now - 2, 190000)],  // farm boss, median 180s
            2: [rank(now - 3, 210000)],                         // farm boss, 210s
            3: [rank(now - 4, 500000), rank(now - 5, 540000)],  // long boss, median 520s
        } }],
    });
    assert.strictEqual(res.farmMedianSec, 195); // median of the per-boss medians [180, 210]
    assert.strictEqual(res.longMedianSec, 520);
});
test('rosterKillDurations: stale kills are ignored; an empty pool gives nulls', () => {
    const now = 1000000000000;
    const old = now - 29 * 24 * 3600 * 1000; // outside the 28-day window
    const res = W.rosterKillDurations({
        nowMs: now,
        players: [{ ranksByEncounter: { 1: [{ startTime: old, duration: 200000 }] } }],
    });
    assert.strictEqual(res.farmMedianSec, null);
    assert.strictEqual(res.longMedianSec, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node wcl-mult.test.js`
Expected: 3 failures, each `W.rosterKillDurations is not a function`.

- [ ] **Step 3: Implement**

In `wcl-mult.js`, after `computeRosterMults` and before the `return {...}` line, add:

```js
    // Per-boss kill durations from the same ranksByEncounter payload the multiplier pass
    // already fetches (spec F5) — durations need zero extra API calls. Kills are shared
    // events: every fetched player carries the same kill, so ranks dedupe by startTime
    // before the median. Farm/long medians are medians of PER-BOSS medians, never of the
    // raw pool — equal boss weighting, so attendance skew cannot tilt the number. The
    // split exists because the guild's kill times are bimodal (spec F1): farm bosses sit
    // at ~2m30s-3m30s while Vashj and Kael run ~8m, and one pooled median would
    // misrepresent both.
    const LONG_BOSS_SEC = 300;
    function rosterKillDurations(opts) {
        const windowMs = opts.windowMs || WINDOW_MS;
        const byBoss = {};
        (opts.players || []).forEach(function (p) {
            const ranks = (p && p.ranksByEncounter) || {};
            Object.keys(ranks).forEach(function (encId) {
                (ranks[encId] || [])
                    .filter(r => r && typeof r.duration === 'number' && typeof r.startTime === 'number')
                    .filter(r => opts.nowMs - r.startTime <= windowMs)
                    .forEach(function (r) {
                        (byBoss[encId] = byBoss[encId] || {})[r.startTime] = r.duration;
                    });
            });
        });
        const perBoss = {};
        Object.keys(byBoss).forEach(function (encId) {
            const durs = Object.keys(byBoss[encId]).map(k => byBoss[encId][k]);
            const m = median(durs);
            if (m !== null) perBoss[encId] = { kills: durs.length, medianSec: Math.round(m / 1000) };
        });
        const meds = Object.keys(perBoss).map(b => perBoss[b].medianSec);
        const farm = meds.filter(s => s <= LONG_BOSS_SEC);
        const long = meds.filter(s => s > LONG_BOSS_SEC);
        return {
            farmMedianSec: farm.length ? Math.round(median(farm)) : null,
            longMedianSec: long.length ? Math.round(median(long)) : null,
            perBoss: perBoss,
        };
    }
```

and add `rosterKillDurations` to the module's return object:

```js
    return { DEFAULT_ZONE, specNameToKey, shouldOverwrite, playerBossMedians, computeRosterMults, rosterKillDurations };
```

- [ ] **Step 4: Run the tests**

Run: `node wcl-mult.test.js`
Expected: all pass — 21 existing + 3 new = `24 passed, 0 failed`. Paste the real output.

- [ ] **Step 5: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: rosterKillDurations — farm/long kill medians from the existing WCL payload"
```

---

### Task 2: Parameterize `build-requests.mjs` and `run-sims.mjs`

**Files:**
- Modify: `calibration/build-requests.mjs` (duration + SP DPS + output dir)
- Modify: `calibration/run-sims.mjs` (request dir + results path flags)

**Interfaces:**
- Produces: `node build-requests.mjs --duration <sec> [--sp-dps <dps>]` → `out/requests-<sec>/` (396 request files); `node run-sims.mjs --requests ./out/requests-<sec>/ --out ./out/results-<sec>.json [--resume]`. Task 4 runs these.

- [ ] **Step 1: Add the flags to build-requests.mjs**

At the top of `calibration/build-requests.mjs`, directly after the `import` line, add:

```js
const args = process.argv.slice(2);
function argOf(flag, dflt) {
    const i = args.indexOf(flag);
    return i === -1 ? dflt : args[i + 1];
}
// Spec D1: anchors are simmed one duration at a time. Spec D2: the SP feeding Vampiric
// Touch is a real raid member, not wowsims' 500-dps default — 1150 ≈ the measured Shadow
// unbuffed baseline, which itself moves only ~3% across the anchor range. VT scales
// SUB-linearly in this number (spec F4), which is exactly why it is set here at sim time
// instead of scaled after the fact.
const DURATION = parseInt(argOf('--duration', '200'), 10);
const SP_DPS = parseInt(argOf('--sp-dps', '1150'), 10);
```

Then three replacements:

1. `const BASE_INDIVIDUAL = { unleashedRage: true, shadowPriestDps: 500 };`
   → `const BASE_INDIVIDUAL = { unleashedRage: true, shadowPriestDps: SP_DPS };`
2. In `makeRequest`, `duration: 180,` → `duration: DURATION,`
3. Both `'./out/requests/'` occurrences (the `mkdirSync` and the `writeFileSync` template) →
   `` `./out/requests-${DURATION}/` `` (the writeFileSync line becomes
   `` writeFileSync(here(`./out/requests-${DURATION}/${specFile}__${name}.json`), JSON.stringify(req, null, 1)); ``)

Note `ALL_INDIVIDUAL_OFF` keeps `shadowPriestDps: 0` — the unbuffed baseline must stay unbuffed.

- [ ] **Step 2: Add the flags to run-sims.mjs**

In `calibration/run-sims.mjs`, replace:

```js
const outPath = here('./out/results.json');

const results = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const files = readdirSync(here('./out/requests/')).filter(f => f.endsWith('.json')).sort();
const resume = process.argv.includes('--resume');
```

with:

```js
const args = process.argv.slice(2);
function argOf(flag, dflt) {
    const i = args.indexOf(flag);
    return i === -1 ? dflt : args[i + 1];
}
const reqDir = argOf('--requests', './out/requests/').replace(/\/?$/, '/');
const outPath = here(argOf('--out', './out/results.json'));

const results = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const files = readdirSync(here(reqDir)).filter(f => f.endsWith('.json')).sort();
const resume = process.argv.includes('--resume');
```

and, inside the loop, `const inPath = here('./out/requests/' + f).pathname;` → `const inPath = here(reqDir + f).pathname;`

- [ ] **Step 3: Smoke-verify without simming**

Run:

```bash
cd calibration
node build-requests.mjs --duration 200
node -e "
const r = require('./out/requests-200/MAGE_Arcane__BASELINE.json');
const u = require('./out/requests-200/MAGE_Arcane__UNBUFFED.json');
console.log('duration:', r.encounter.duration, '| sp dps:', r.raid.parties[0].players[0].buffs.shadowPriestDps,
  '| unbuffed sp dps:', u.raid.parties[0].players[0].buffs.shadowPriestDps);
"
```

Expected: `396 requests written`, then `duration: 200 | sp dps: 1150 | unbuffed sp dps: 0`.

- [ ] **Step 4: Commit**

```bash
git add calibration/build-requests.mjs calibration/run-sims.mjs
git commit -m "feat: parameterize calibration requests by duration and shadow-priest dps"
```

---

### Task 3: Parameterize `make-weights.mjs`, prove it reproduces the shipped weights

**Files:**
- Modify: `calibration/make-weights.mjs`

**Interfaces:**
- Produces: `node make-weights.mjs --date <d> --duration <sec> --results <path> --out <path>` → a weights file with the same schema as today (`{meta, baselines, buffs}`) plus `floors-report-<sec>.md`. Tasks 4–5 consume it.

- [ ] **Step 1: Replace the argument handling**

In `calibration/make-weights.mjs`, replace:

```js
const here = p => new URL(p, import.meta.url);
const results = JSON.parse(readFileSync(here('./out/results.json'), 'utf8'));
```

with:

```js
const here = p => new URL(p, import.meta.url);
const args = process.argv.slice(2);
function argOf(flag, dflt) {
    const i = args.indexOf(flag);
    return i === -1 ? dflt : args[i + 1];
}
const DURATION = parseInt(argOf('--duration', '200'), 10);
const results = JSON.parse(readFileSync(here(argOf('--results', './out/results.json')), 'utf8'));
```

Then four replacements:

1. `encounter: '180s single target, level 73 demon',` → `` encounter: `${DURATION}s single target, level 73 demon`, ``
2. `date: process.argv[2] || 'set-me',` → `date: argOf('--date', 'set-me'),`
3. `writeFileSync(here('./weights.json'), JSON.stringify(weights, null, 1));` → `writeFileSync(here(argOf('--out', './weights.json')), JSON.stringify(weights, null, 1));`
4. `writeFileSync(here('./floors-report.md'),` → `` writeFileSync(here(`./floors-report-${DURATION}.md`), `` and in the report body text, `'(180s single target, 10000 iterations)'` → `` `(${DURATION}s single target, 10000 iterations)` `` (keep the surrounding prose intact). Update the usage comment at the top of the file (`Usage: node make-weights.mjs <date>`) to the new flag form.

- [ ] **Step 2: Prove the refactor is identity on the shipped inputs**

The old 180s results are still in `out/results.json`; regenerating from them with the new flags must reproduce `weights.json` byte-for-byte (same math, same meta):

```bash
cd calibration
node make-weights.mjs --date 2026-08-13 --duration 180 --results ./out/results.json --out ./weights-180-check.json
node -e "
const a = require('./weights.json'), b = require('./weights-180-check.json');
console.log(JSON.stringify(a) === JSON.stringify(b) ? 'IDENTICAL' : 'DIFFERS — the refactor changed the math, stop and fix');
"
rm ./weights-180-check.json ./floors-report-180.md
```

Expected: `IDENTICAL`. If it differs, diff the two files; only `meta` may legitimately differ if the shipped file's meta strings deviate — anything under `baselines`/`buffs` differing is a refactor bug.

- [ ] **Step 3: Commit**

```bash
git add calibration/make-weights.mjs
git commit -m "feat: make-weights takes --duration/--results/--out; verified identity on shipped 180s results"
```

---

### Task 4: Run the three anchor calibrations (long-running)

**Files:**
- Create: `calibration/weights-200.json`, `calibration/weights-300.json`, `calibration/weights-520.json`, `calibration/floors-report-200.md` (plus `-300`/`-520`)

**Interfaces:**
- Produces: the three anchor weight files Task 5 injects. Schema identical to the old `weights.json`.

- [ ] **Step 1: Build all requests**

```bash
cd calibration
node build-requests.mjs --duration 200
node build-requests.mjs --duration 300
node build-requests.mjs --duration 520
```

Expected: `396 requests written` three times.

- [ ] **Step 2: Run the sims (≈35–60 min EACH; resumable, run in the background)**

```bash
node run-sims.mjs --requests ./out/requests-200/ --out ./out/results-200.json --resume
node run-sims.mjs --requests ./out/requests-300/ --out ./out/results-300.json --resume
node run-sims.mjs --requests ./out/requests-520/ --out ./out/results-520.json --resume
```

Longer fights sim slower — expect the 520s pass to take roughly double the 200s pass. A crash resumes with the same command (`--resume` skips completed keys). Expected final line each: `done: 396 results`.

- [ ] **Step 3: Produce the anchor weight files**

```bash
node make-weights.mjs --date 2026-08-15 --duration 200 --results ./out/results-200.json --out ./weights-200.json
node make-weights.mjs --date 2026-08-15 --duration 300 --results ./out/results-300.json --out ./weights-300.json
node make-weights.mjs --date 2026-08-15 --duration 520 --results ./out/results-520.json --out ./weights-520.json
```

Each run prints substitutions (5 specs) and clamped negatives — the Windfury-on-caster clamps should appear at every anchor and GROW with duration (they measured −1.3% to −2.2% at 265s); that is the known artifact behaving as documented, not a problem.

- [ ] **Step 4: Sanity-check the anchors against the spec's measured curves**

```bash
node -e "
const w2 = require('./weights-200.json'), w3 = require('./weights-300.json'), w5 = require('./weights-520.json');
const row = (buff, k) => [w2, w3, w5].map(w => (w.buffs[buff] || {})[k] || 0);
const vtEle = row('Vampiric Touch', 'SHAMAN:Elemental');
const vtBoom = row('Vampiric Touch', 'DRUID:Balance');
const wfFury = row('Windfury Totem', 'WARRIOR:Fury');
const baseEle = [w2, w3, w5].map(w => w.baselines['SHAMAN:Elemental']);
console.log('VT ele    ', vtEle, '  expect strictly increasing, roughly 0.08-0.40');
console.log('VT boomkin', vtBoom, '  expect strictly increasing');
console.log('WF fury   ', wfFury, '  expect ~0.097 +/- 0.01 at ALL anchors (physical buffs are duration-flat, spec F3)');
console.log('base ele  ', baseEle, '  expect decreasing');
const ok = vtEle[0] < vtEle[1] && vtEle[1] < vtEle[2]
    && vtBoom[0] < vtBoom[1] && vtBoom[1] < vtBoom[2]
    && Math.abs(wfFury[0] - wfFury[2]) < 0.015
    && baseEle[0] > baseEle[2];
console.log(ok ? 'SANITY OK' : 'SANITY FAILED — do not proceed, compare against spec F2/F3');
"
```

Expected: `SANITY OK`. (Exact values will exceed the spec's F2 table since these run SP@1150, not SP@500 — direction and flatness are what is being checked, not magnitudes.)

- [ ] **Step 5: Commit the evidence**

```bash
git add calibration/weights-200.json calibration/weights-300.json calibration/weights-520.json calibration/floors-report-*.md
git commit -m "data: calibration anchors at 200/300/520s, shadowPriestDps 1150"
```

---

### Task 5: Multi-anchor injection + `setEncounterDuration` in the engine

**Files:**
- Modify: `calibration/inject-weights.mjs` (full rewrite below)
- Modify: `assignments-engine.js` (generated block between the CALIBRATION markers; hand-written interpolation section directly after the END marker; exports)
- Modify: `calibration/weights.json`, `calibration/floors-report.md` (delete — superseded by the anchor files)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `weights-{200,300,520}.json` from Task 4.
- Produces: `E.setEncounterDuration(sec)`, `E.getEncounterDuration()`; `E.BASELINE` / `E.BUFF_V` become duration-dependent (mutated in place). Tasks 6–7 rely on `setEncounterDuration(sec)` with number-of-seconds input, clamped to [200, 520].

- [ ] **Step 1: Write the failing duration tests**

Add to `assignments-engine.test.js`, after the Task-A tests from the 3-cycle plan:

```js
test('duration: interpolation is monotone for VT and restores at anchors', () => {
    E.setEncounterDuration(200);
    const at200 = E.BUFF_V['Vampiric Touch']['SHAMAN:Elemental'] || 0;
    E.setEncounterDuration(250);
    const at250 = E.BUFF_V['Vampiric Touch']['SHAMAN:Elemental'] || 0;
    E.setEncounterDuration(300);
    const at300 = E.BUFF_V['Vampiric Touch']['SHAMAN:Elemental'] || 0;
    E.setEncounterDuration(520);
    const at520 = E.BUFF_V['Vampiric Touch']['SHAMAN:Elemental'] || 0;
    assert.ok(at200 < at250 && at250 < at300 && at300 < at520,
        'VT(ele) not monotone across durations: ' + [at200, at250, at300, at520].join(', '));
    // returning to an anchor restores the exact anchor value (idempotence)
    E.setEncounterDuration(200);
    assert.strictEqual(E.BUFF_V['Vampiric Touch']['SHAMAN:Elemental'] || 0, at200);
});
test('duration: out-of-range clamps to the nearest anchor', () => {
    E.setEncounterDuration(90);
    const low = E.BUFF_V['Vampiric Touch']['MAGE:Arcane'] || 0;
    E.setEncounterDuration(200);
    assert.strictEqual(low, E.BUFF_V['Vampiric Touch']['MAGE:Arcane'] || 0);
    E.setEncounterDuration(2000);
    const hi = E.BUFF_V['Vampiric Touch']['MAGE:Arcane'] || 0;
    E.setEncounterDuration(520);
    assert.strictEqual(hi, E.BUFF_V['Vampiric Touch']['MAGE:Arcane'] || 0);
    E.setEncounterDuration(200);
});
test('duration: PARTY_BUFFS rows see the change (captured references stay live)', () => {
    const row = E.PARTY_BUFFS.filter(b => b.name === 'Vampiric Touch')[0];
    E.setEncounterDuration(520);
    const at520 = row.v['SHAMAN:Elemental'] || 0;
    E.setEncounterDuration(200);
    const at200 = row.v['SHAMAN:Elemental'] || 0;
    assert.ok(at520 > at200,
        'PARTY_BUFFS holds a stale VT table: 520s=' + at520 + ' vs 200s=' + at200);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node assignments-engine.test.js`
Expected: the three new tests fail with `E.setEncounterDuration is not a function`; everything else passes.

- [ ] **Step 3: Rewrite `calibration/inject-weights.mjs`**

Replace the whole file with:

```js
#!/usr/bin/env node
// Rewrites the block between the engine's CALIBRATION markers with the measured tables.
// v3 (spec D1/D3): three duration anchors. The generated block carries CAL_ANCHORS plus
// EMPTY-SHAPED BASELINE/BUFF_V; the hand-written interpolation code that lives directly
// after the END marker fills them via setEncounterDuration(). The shapes matter: every
// buff key must pre-exist so PARTY_BUFFS' `BUFF_V['X'] || {}` captures a live object, not
// an orphan literal. No loader change and no build step.
import { readFileSync, writeFileSync } from 'node:fs';

const here = p => new URL(p, import.meta.url);
const enginePath = here('../assignments-engine.js');
const engine = readFileSync(enginePath, 'utf8');

const DURATIONS = [200, 300, 520];
const anchors = {};
for (const d of DURATIONS) {
    anchors[d] = JSON.parse(readFileSync(here(`./weights-${d}.json`), 'utf8'));
}

const START = /\/\/ === CALIBRATION START[^\n]*\n/;
const END = '// === CALIBRATION END ===';
const startMatch = engine.match(START);
const startIdx = engine.search(START);
const endIdx = engine.indexOf(END);
if (startIdx === -1 || endIdx === -1) throw new Error('calibration markers not found');

// Every row name the engine's PARTY_BUFFS table references must exist IN EVERY anchor, or
// interpolation would silently rate a real buff worthless at some durations. Baseline spec
// sets must match across anchors for the same reason — interpolation walks one anchor's keys.
const required = [...engine.matchAll(/BUFF_V\['([^']+)'\]/g)].map(m => m[1]);
const allBuffNames = new Set(required);
const allSpecKeys = new Set();
for (const d of DURATIONS) {
    Object.keys(anchors[d].buffs).forEach(b => allBuffNames.add(b));
    Object.keys(anchors[d].baselines).forEach(k => allSpecKeys.add(k));
}
for (const d of DURATIONS) {
    for (const b of allBuffNames) anchors[d].buffs[b] = anchors[d].buffs[b] || {};
    for (const k of allSpecKeys) {
        if (anchors[d].baselines[k] == null) {
            throw new Error(`weights-${d}.json is missing baseline ${k} — anchors must cover identical spec sets`);
        }
    }
}

const indent = obj => JSON.stringify(obj, null, 8).replace(/\n/g, '\n    ');
const markerLine = '    // === CALIBRATION START (generated — do not hand-edit; regenerate with calibration/inject-weights.mjs) ===\n';
const provenance = DURATIONS.map(d =>
    `    //   ${d}s: wowsims ${anchors[d].meta.wowsimsSha}, ${anchors[d].meta.encounter}, ` +
    `${anchors[d].meta.iterations} iterations, ${anchors[d].meta.date}.`).join('\n');
const buffShape = {};
for (const b of allBuffNames) buffShape[b] = {};
const anchorsOut = Object.fromEntries(DURATIONS.map(d =>
    [d, { baselines: anchors[d].baselines, buffs: anchors[d].buffs }]));
const block =
    `    // Generated by calibration/inject-weights.mjs from calibration/weights-{${DURATIONS.join(',')}}.json.\n` +
    provenance + '\n' +
    `    // Values below the ${anchors[DURATIONS[0]].meta.noiseFloor} noise floor are recorded as absent, not as small.\n` +
    `    // BASELINE and BUFF_V start EMPTY-SHAPED: setEncounterDuration() (hand-written,\n` +
    `    // directly after the END marker) fills them by interpolating CAL_ANCHORS, mutating\n` +
    `    // in place so the references PARTY_BUFFS captures stay live.\n` +
    `    // DO NOT HAND-EDIT — see calibration/README.md for the caveats these numbers carry.\n` +
    `    const CAL_ANCHORS = ${indent(anchorsOut)};\n` +
    `    const BASELINE = {};\n` +
    `    const BUFF_V = ${indent(buffShape)};\n    `;

writeFileSync(enginePath, engine.slice(0, startIdx - 4) + markerLine + block + engine.slice(endIdx));
console.log('engine calibration block rewritten with anchors ' + DURATIONS.join('/'));
```

- [ ] **Step 4: Run the injection**

```bash
cd calibration && node inject-weights.mjs
```

Expected: `engine calibration block rewritten with anchors 200/300/520`. The engine is now BROKEN (empty tables, no interpolation yet) — that is expected until Step 5.

- [ ] **Step 5: Add the hand-written interpolation section to the engine**

In `assignments-engine.js`, directly after the `// === CALIBRATION END ===` line (and before the comment block introducing `PARTY_BUFFS` — the order matters: the default `setEncounterDuration(200)` call must populate `BUFF_V`'s sub-objects BEFORE `PARTY_BUFFS` captures them), insert:

```js
    // === duration interpolation (hand-written; CAL_ANCHORS above is generated) ===
    // Piecewise-linear between the anchor tables, clamped outside [first, last] (spec D1).
    // Mana marginals are near-linear in duration on the measured grid (spec F2) and every
    // physical buff is flat (spec F3), so linear interpolation cannot invent structure
    // that is not there.
    const CAL_DURATIONS = Object.keys(CAL_ANCHORS).map(Number).sort((a, b) => a - b);
    function tableAt(sec) {
        const ds = CAL_DURATIONS;
        const s = Math.max(ds[0], Math.min(ds[ds.length - 1], sec));
        let lo = ds[0], hi = ds[ds.length - 1];
        for (let i = 0; i < ds.length - 1; i++) {
            if (s >= ds[i] && s <= ds[i + 1]) { lo = ds[i]; hi = ds[i + 1]; break; }
        }
        const t = hi === lo ? 0 : (s - lo) / (hi - lo);
        const A = CAL_ANCHORS[lo], B = CAL_ANCHORS[hi];
        const baselines = {};
        Object.keys(A.baselines).forEach(k => {
            baselines[k] = Math.round(A.baselines[k] + (B.baselines[k] - A.baselines[k]) * t);
        });
        const buffs = {};
        Object.keys(A.buffs).forEach(name => {
            const out = {};
            const av = A.buffs[name], bv = B.buffs[name] || {};
            const keys = {};
            Object.keys(av).forEach(k => { keys[k] = true; });
            Object.keys(bv).forEach(k => { keys[k] = true; });
            Object.keys(keys).forEach(k => {
                const v = (av[k] || 0) + ((bv[k] || 0) - (av[k] || 0)) * t;
                if (v > 0) out[k] = Math.round(v * 1e4) / 1e4;
            });
            buffs[name] = out;
        });
        return { baselines: baselines, buffs: buffs };
    }
    let encounterDuration = 200;
    // Rebuilds the active tables IN PLACE: PARTY_BUFFS captures each BUFF_V sub-object by
    // reference at module init, so the objects are mutated, never replaced (spec D3).
    // Deterministic and idempotent — same input seconds, same tables, every time.
    function setEncounterDuration(sec) {
        const ds = CAL_DURATIONS;
        encounterDuration = Math.max(ds[0], Math.min(ds[ds.length - 1], sec || 200));
        const t = tableAt(encounterDuration);
        Object.keys(BASELINE).forEach(k => { delete BASELINE[k]; });
        Object.assign(BASELINE, t.baselines);
        Object.keys(BUFF_V).forEach(name => {
            const target = BUFF_V[name];
            Object.keys(target).forEach(k => { delete target[k]; });
            Object.assign(target, t.buffs[name] || {});
        });
    }
    function getEncounterDuration() { return encounterDuration; }
    setEncounterDuration(200); // default = farm anchor (spec D5); runs before PARTY_BUFFS binds
```

Then add both functions to the export object at the bottom of the file — change:

```js
        specKey, BASELINE, BUFF_V, PARTY_BUFFS, groupBuffs, layoutViolations,
```

to:

```js
        specKey, BASELINE, BUFF_V, PARTY_BUFFS, groupBuffs, layoutViolations,
        setEncounterDuration, getEncounterDuration,
```

- [ ] **Step 6: Run the suite and reconcile recalibration fallout**

Run: `node assignments-engine.test.js`
Expected: the three duration tests pass. OTHER tests may now fail because the active weights changed (180s @ SP500 → 200s @ SP1150). Reconcile with this decision rule, checking every failure individually:

- A failing test that asserts an **invariant** — floors ordering, determinism, provider-keyed notes, no-improving-3-cycle, draenei dedup, "does not mutate the caller roster" — means the implementation is wrong. Fix the engine, never the test.
- A failing test that asserts a **specific layout or grouping under the old weights** (who lands in which group in a fixture) is fixture drift. Before touching it, read the test's own comments for its documented intent; update the expectation ONLY if the new layout still honors that intent (e.g. "the enh shaman anchors a windfury group" must still hold — WHICH melee sit with him may differ).
- Paste the failing-test list and the final green output into the commit message.

Run until: `275 passed, 0 failed` (272 from the 3-cycle plan + 3 duration tests), with any fixture updates justified inline as comments.

- [ ] **Step 7: Remove the superseded single-duration files**

```bash
git rm calibration/weights.json calibration/floors-report.md
```

- [ ] **Step 8: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js calibration/inject-weights.mjs
git commit -m "feat: duration-interpolated weights — CAL_ANCHORS + setEncounterDuration(200..520)

Anchors 200/300/520s, shadowPriestDps 1150 (spec D1/D2). Tables are rebuilt
in place so PARTY_BUFFS' captured references stay live (spec D3). Default 200s."
```

---

### Task 6: Acceptance gates + README

**Files:**
- Modify: `calibration/sim-verify.mjs` (duration parameter)
- Modify: `calibration/README.md`

**Interfaces:**
- Consumes: `E.setEncounterDuration(sec)` from Task 5.
- Produces: the recorded evidence that the recalibrated model still orders layouts the way the sim does (spec D8).

- [ ] **Step 1: Add a duration argument to sim-verify.mjs**

In `calibration/sim-verify.mjs`:

1. Update the usage comment to `// Usage: node sim-verify.mjs ssc-roster.json [iterations] [durationSec]`.
2. After `const iterations = parseInt(process.argv[3] || '5000', 10);` add:

```js
const duration = parseInt(process.argv[4] || '200', 10);
E.setEncounterDuration(duration); // the model must be asked at the same duration the sim runs
```

3. In `simLayout`, `duration: 180, durationVariation: 0,` → `duration: duration, durationVariation: 0,`

- [ ] **Step 2: Run the exact-vs-climb gap gate**

Run: `node calibration/measure-gap.mjs`
Expected: worst gap **< 1%** across its fixtures (the 2026-08-13 run measured ≤0.08%). If ≥1%: STOP — do not ship the weights; file a follow-up for seed/escape reachability (spec D8, spec out-of-scope list) and surface it to Max.

- [ ] **Step 3: Run sim-verify at both regimes (long-running: two full-raid sim sets)**

```bash
cd calibration
node sim-verify.mjs ssc-roster.json 5000 200
node sim-verify.mjs ssc-roster.json 5000 520
```

Expected: `VERDICT: the sim AGREES with the model's ranking` at both durations. Disagreement is spec §8's trigger to revisit per-player inputs — record it and stop, per the same rule as the 2026-08-13 calibration; it is NOT a licence to tune weights by hand.

- [ ] **Step 4: Update calibration/README.md**

Rewrite the "Rebuilding from scratch" command list to the new flags (three `build-requests`/`run-sims`/`make-weights` invocations + `inject-weights.mjs`, exactly as run in Tasks 4–5). Append two entries to "Judgement calls baked into the numbers":

```markdown
7. **Three duration anchors (200/300/520s), linearly interpolated.** Kill-time data is
   bimodal (farm ~2m30s–3m30s, Vashj/Kael ~8m), and mana-buff marginals ramp near-linearly
   with duration from a ~180s foot while every physical buff stays flat — so the engine
   interpolates between anchor tables instead of shipping one duration's truth
   (spec 2026-08-15, §F1–F3, §D1). The old single 180s table sat at the exact duration
   where mana barely matters yet, which understated Vampiric Touch by up to ~13pp.
8. **`shadowPriestDps: 1150` at every anchor** — the measured Shadow unbuffed baseline
   (moves only ~3% across anchors), replacing wowsims' 500 default that halved VT's value.
   VT scales SUB-linearly in this number, so it is set at sim time; the engine does NOT
   scale VT by the actual shadow priest's multiplier at runtime (known limitation, spec D2).
```

- [ ] **Step 5: Commit**

```bash
git add calibration/sim-verify.mjs calibration/README.md
git commit -m "docs: anchor-calibration rebuild instructions + gates; sim-verify takes a duration"
```

---

### Task 7: Fight-length UI + AI-review awareness

**Files:**
- Modify: `assignments.js` (duration helper, WCL fetch storing medians, fight-length control, `setEncounterDuration` at the three `proposeGroups` call sites, AI payload field)
- Modify: `server.js` (one line in `AI_SYSTEM_PROMPT`)

**Interfaces:**
- Consumes: `WclMult.rosterKillDurations` (Task 1), `E.setEncounterDuration` (Task 5).
- Produces: `state.wcl.durations = {farmSec, longSec, fetchedAt}`, `state.wcl.fightLen = {mode: 'farm'|'long'|'custom', customSec}`, `activeDurationSec()` used before every `proposeGroups` call.

- [ ] **Step 1: Add the duration helper**

In `assignments.js`, directly after the `fmtPct` function (around line 446), add:

```js
// Spec D5: which encounter duration the weights should assume. Farm is the default — most
// pulls are farm pulls — and the fight-length control shows the measured medians once a
// WCL fetch has run. The fallbacks are the engine's anchor durations.
function activeDurationSec() {
    const w = state.wcl || {};
    const mode = (w.fightLen && w.fightLen.mode) || 'farm';
    if (mode === 'custom') return (w.fightLen && w.fightLen.customSec) || 300;
    if (mode === 'long') return (w.durations && w.durations.longSec) || 520;
    return (w.durations && w.durations.farmSec) || 200;
}
```

- [ ] **Step 2: Store kill-duration medians on WCL fetch**

In `fetchWclMults`, directly after `const results = WclMult.computeRosterMults({ players: fetched, nowMs: Date.now() });` and the `const fetchedAt = Date.now();` line, add:

```js
        const kd = WclMult.rosterKillDurations({ players: fetched, nowMs: fetchedAt });
        state.wcl.durations = { farmSec: kd.farmMedianSec, longSec: kd.longMedianSec, fetchedAt: fetchedAt };
```

- [ ] **Step 3: Set the engine duration before every layout computation**

There are three `E.proposeGroups(roster)` call sites (currently `assignments.js:602`, `:757`, `:798` — locate by searching `proposeGroups`, numbers will have drifted). Directly before EACH, add:

```js
    E.setEncounterDuration(activeDurationSec());
```

(For the `renderGroups` site, place it at the top of `renderGroups()` so the whole panel renders under one duration.)

- [ ] **Step 4: Add the fight-length control to the tuning panel**

In `renderGroups()`, after the `wclRow` element is appended to the `tune` details element, add:

```js
    // Fight length: the weights are duration-interpolated (spec D1/D5). Farm by default;
    // chips show the roster's measured medians once a WCL fetch has stored them.
    const flRow = document.createElement('div');
    flRow.className = 'tuning-row';
    const flLabel = document.createElement('span');
    flLabel.textContent = 'Fight length: ';
    flRow.appendChild(flLabel);
    const durs = state.wcl.durations || {};
    const fmtSec = s => Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's';
    const flMode = (state.wcl.fightLen && state.wcl.fightLen.mode) || 'farm';
    [['farm', 'Farm ' + (durs.farmSec ? '~' + fmtSec(durs.farmSec) : '(~3m)')],
     ['long', 'Long ' + (durs.longSec ? '~' + fmtSec(durs.longSec) : '(Vashj/Kael)')],
     ['custom', 'Custom']].forEach(([m, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        // btn-primary doubles as the "active" state — it is the app's existing accent
        // (#4778eb) and needs no new CSS.
        b.className = 'btn' + (flMode === m ? ' btn-primary' : '');
        b.textContent = label;
        b.title = 'Which kill duration the group weights should assume. Mana buffs (Vampiric Touch, mana totems) are worth far more on long fights.';
        b.addEventListener('click', () => {
            state.wcl.fightLen = Object.assign({}, state.wcl.fightLen, { mode: m });
            saveState(); renderAll();
        });
        flRow.appendChild(b);
    });
    if (flMode === 'custom') {
        const sec = document.createElement('input');
        sec.type = 'number';
        sec.min = '60'; sec.max = '900'; sec.step = '10';
        sec.value = (state.wcl.fightLen && state.wcl.fightLen.customSec) || 300;
        sec.title = 'Encounter duration in seconds (engine clamps to 200–520)';
        sec.addEventListener('change', () => {
            state.wcl.fightLen = Object.assign({}, state.wcl.fightLen, { customSec: parseInt(sec.value, 10) || 300 });
            saveState(); renderAll();
        });
        flRow.appendChild(sec);
    }
    tune.appendChild(flRow);
```

No CSS changes needed — `btn-primary` already exists in `style.css:87`.

- [ ] **Step 5: Tell the AI review what duration it is critiquing**

In `assignments.js`, in the AI-review payload object (the one containing `groups: E.proposeGroups(roster).groups.map((g, i) => ({`), add a sibling field:

```js
        fightLengthSec: activeDurationSec(),
```

In `server.js`, add one line to the `AI_SYSTEM_PROMPT` array, after the air-totem line:

```js
  '- Party mana buffs (Vampiric Touch, Mana Spring, Mana Tide) scale strongly with fight length. The payload includes fightLengthSec, and the layout weights already assume it — do not suggest mana-motivated regrouping beyond what the sheet shows unless the actual fight is much longer than fightLengthSec.',
```

- [ ] **Step 6: Verify in the running app**

Follow the CDP harness notes in the auto-memory file `wowstuff-verification-harness.md` (no browser tool here — headless Chrome over CDP). Start `node server.js`, load the assignments page with a saved roster, and verify:

1. The Player-tuning panel shows the Fight-length row with Farm active by default.
2. Clicking Long re-renders the group panel (with a roster containing a shadow priest and casters, the notes/marginals change — VT-related notes become more prominent).
3. Custom shows the seconds input; entering 400 persists across a reload (localStorage state).
4. After a WCL fetch, the Farm/Long chips display measured medians (`~3m24s`-style).
5. The AI-review request body includes `fightLengthSec` (check the network payload).

Screenshot the panel in both Farm and Long modes for the commit.

- [ ] **Step 7: Commit**

```bash
git add assignments.js server.js
git commit -m "feat: fight-length control drives duration-aware weights; AI review told the duration"
```
