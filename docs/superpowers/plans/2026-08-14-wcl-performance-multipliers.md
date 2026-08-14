# WCL Performance Multipliers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill the existing per-player DPS multiplier (`state.playerMeta[name].mult`) from Warcraft Logs parses, as an editable prefill: `mult = mean over bosses of (player's 4-week median parse DPS ÷ global spec-median DPS)`.

**Architecture:** A new pure UMD module `wcl-mult.js` (loaded by both browser and server, same wrapper as `assignments-engine.js`) holds all math and mapping; `server.js` gains a WCL OAuth token cache plus two proxy endpoints (medians with a 7-day file cache, per-player parses); `assignments.js` gains realm/region settings, a fetch button and prefill logic in the existing Player tuning panel. The engine (`assignments-engine.js`) is **not touched** — `mult` already flows through the score.

**Tech Stack:** Node ≥18 (built-in `fetch`), Express 4, vanilla JS front end, WCL API v2 (GraphQL, client-credentials OAuth). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-wcl-performance-multipliers-design.md`

## Global Constraints

- Multiplier clamp **[0.5, 2.0]**, rounded to **0.01** (spec §2).
- Parse window: **last 4 weeks** (28 × 24 × 3600 × 1000 ms), passed as `nowMs` parameter — no hidden clock in pure code (spec §4).
- Same-spec parses only; healers (BASELINE 0) never fetched or prefixed (spec §2).
- Median-cache TTL **7 days**, stored in `wcl-medians-cache.json` next to `.env`, gitignored (spec §3).
- Credentials `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` in gitignored `.env`; missing creds → HTTP 503 with a clear message (spec §3).
- Overwrite rule: a fetch sets `mult` only when the user hasn't manually diverged (see `shouldOverwrite`, Task 2); `multAuto` always updates (spec §5).
- Tests run with `node wcl-mult.test.js` (same homemade `test(name, fn)` runner as `assignments-engine.test.js`). Run `node assignments-engine.test.js` too before every commit to prove the engine is untouched.
- The WCL zone ID for the Anniversary SSC/TK tier is **verified live in Task 4** — never trusted from memory. Until Task 4, `DEFAULT_ZONE = 0` is an explicit placeholder.
- Spec §6 note: "server endpoints against recorded responses" is satisfied by unit-testing the pure transforms (Tasks 1–3) plus the live end-to-end run (Task 8); `server.js` has no test harness and starting Express in tests is out of scope. This is the plan of record.

---

### Task 1: `wcl-mult.js` skeleton — spec-name mapping and spec list

**Files:**
- Create: `wcl-mult.js`
- Create: `wcl-mult.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: global/module `WclMult` with `specNameToKey(className, specName) -> 'CLASS:Spec' | null`, `WCL_SPECS: [{className, specName, specKey}]` (the 22 non-healer specs), `DEFAULT_ZONE: number` (placeholder `0` until Task 4).
- Engine spec keys must match `assignments-engine.js` `BASELINE` keys exactly (e.g. `'HUNTER:Beast Mastery'`, `'DRUID:Guardian'`).

- [ ] **Step 1: Write the failing test**

Create `wcl-mult.test.js`:

```js
'use strict';
const assert = require('node:assert');
const W = require('./wcl-mult.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: specNameToKey / WCL_SPECS ---
test('specNameToKey: WCL-style names map to engine keys', () => {
    assert.strictEqual(W.specNameToKey('Hunter', 'BeastMastery'), 'HUNTER:Beast Mastery');
    assert.strictEqual(W.specNameToKey('Warlock', 'Destruction'), 'WARLOCK:Destruction');
    assert.strictEqual(W.specNameToKey('Druid', 'Guardian'), 'DRUID:Guardian');
});
test('specNameToKey: engine-style inputs round-trip (class upper, spec with space)', () => {
    assert.strictEqual(W.specNameToKey('HUNTER', 'Beast Mastery'), 'HUNTER:Beast Mastery');
});
test('specNameToKey: unknown class or spec gives null', () => {
    assert.strictEqual(W.specNameToKey('Deathknight', 'Blood'), null);
    assert.strictEqual(W.specNameToKey('Mage', 'Holy'), null);
    assert.strictEqual(W.specNameToKey(null, 'Arms'), null);
});
test('WCL_SPECS: 22 non-healer specs, keys match engine BASELINE, no healers', () => {
    const E = require('./assignments-engine.js');
    assert.strictEqual(W.WCL_SPECS.length, 22);
    W.WCL_SPECS.forEach(s => {
        assert.ok(E.BASELINE[s.specKey] > 0, s.specKey + ' must have a nonzero baseline');
        assert.strictEqual(W.specNameToKey(s.className, s.specName), s.specKey);
    });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node wcl-mult.test.js`
Expected: crash with `Cannot find module './wcl-mult.js'`

- [ ] **Step 3: Write minimal implementation**

Create `wcl-mult.js` with the exact UMD wrapper `assignments-engine.js` uses:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.WclMult = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Verified live in Task 4 — 0 is a deliberate "not yet verified" placeholder.
    const DEFAULT_ZONE = 0;

    // WCL spec names, lowercased with non-letters stripped, per engine class.
    const WCL_SPEC_NAMES = {
        WARRIOR: { arms: 'Arms', fury: 'Fury', protection: 'Protection' },
        PALADIN: { retribution: 'Retribution', protection: 'Protection', holy: 'Holy' },
        HUNTER: { beastmastery: 'Beast Mastery', marksmanship: 'Marksmanship', survival: 'Survival' },
        ROGUE: { assassination: 'Assassination', combat: 'Combat', subtlety: 'Subtlety' },
        PRIEST: { shadow: 'Shadow', holy: 'Holy', discipline: 'Discipline' },
        SHAMAN: { elemental: 'Elemental', enhancement: 'Enhancement', restoration: 'Restoration' },
        MAGE: { arcane: 'Arcane', fire: 'Fire', frost: 'Frost' },
        WARLOCK: { affliction: 'Affliction', demonology: 'Demonology', destruction: 'Destruction' },
        DRUID: { balance: 'Balance', feral: 'Feral', guardian: 'Guardian', restoration: 'Restoration' },
    };

    function specNameToKey(className, specName) {
        if (!className || !specName) return null;
        const cls = String(className).toUpperCase();
        const table = WCL_SPEC_NAMES[cls];
        if (!table) return null;
        const spec = table[String(specName).toLowerCase().replace(/[^a-z]/g, '')];
        return spec ? cls + ':' + spec : null;
    }

    // Every spec with a nonzero engine baseline — what the medians sweep queries.
    // className/specName are the forms WCL's GraphQL arguments expect.
    const WCL_SPECS = [
        ['Warrior', 'Arms'], ['Warrior', 'Fury'], ['Warrior', 'Protection'],
        ['Paladin', 'Retribution'], ['Paladin', 'Protection'],
        ['Hunter', 'BeastMastery'], ['Hunter', 'Marksmanship'], ['Hunter', 'Survival'],
        ['Rogue', 'Assassination'], ['Rogue', 'Combat'], ['Rogue', 'Subtlety'],
        ['Priest', 'Shadow'],
        ['Shaman', 'Elemental'], ['Shaman', 'Enhancement'],
        ['Mage', 'Arcane'], ['Mage', 'Fire'], ['Mage', 'Frost'],
        ['Warlock', 'Affliction'], ['Warlock', 'Demonology'], ['Warlock', 'Destruction'],
        ['Druid', 'Balance'], ['Druid', 'Feral'],
    ].map(([className, specName]) => ({ className, specName, specKey: specNameToKey(className, specName) }));

    return { DEFAULT_ZONE, specNameToKey, WCL_SPECS };
}));
```

Note: `DRUID:Guardian` is deliberately absent from `WCL_SPECS` — on WCL, TBC druid tanks log as `Feral` or `Guardian` depending on partition; Task 4 verifies which and, if `Guardian` exists as a rankable spec there, adds `['Druid', 'Guardian']` (then the count test becomes 23). `specNameToKey` already maps it either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `node wcl-mult.test.js`
Expected: `4 passed, 0 failed`

- [ ] **Step 5: Add the npm test script**

In `package.json` `"scripts"`, add:

```json
"test": "node assignments-engine.test.js && node wcl-mult.test.js"
```

Run: `npm test` — expected: engine suite passes, then wcl suite passes.

- [ ] **Step 6: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js package.json
git commit -m "feat: wcl-mult module — WCL spec-name mapping and spec list"
```

---

### Task 2: `medianPageTarget` and `shouldOverwrite`

**Files:**
- Modify: `wcl-mult.js`
- Modify: `wcl-mult.test.js`

**Interfaces:**
- Produces: `medianPageTarget(count, pageSize = 100) -> { page, index } | null` — 1-based page, 0-based index within the page, locating the median entry of a ranking of `count` entries (lower-middle for even counts). `null` when count is 0/absent.
- Produces: `shouldOverwrite(meta) -> boolean` — whether a fetched value may replace `meta.mult`. True when there is no manual value to protect: `mult` unset, or equal to the last `multAuto`, or equal to the 1.0 default with no `multAuto` recorded.

- [ ] **Step 1: Write the failing tests** (append to `wcl-mult.test.js`, above the summary lines)

```js
// --- Task 2: medianPageTarget / shouldOverwrite ---
test('medianPageTarget: small counts stay on page 1', () => {
    assert.deepStrictEqual(W.medianPageTarget(1), { page: 1, index: 0 });
    assert.deepStrictEqual(W.medianPageTarget(100), { page: 1, index: 49 });
    assert.deepStrictEqual(W.medianPageTarget(7), { page: 1, index: 3 });
});
test('medianPageTarget: large counts land mid-population', () => {
    // count 2500 -> median position 1249 (0-based) -> page 13, index 49
    assert.deepStrictEqual(W.medianPageTarget(2500), { page: 13, index: 49 });
    assert.deepStrictEqual(W.medianPageTarget(201), { page: 2, index: 0 });
});
test('medianPageTarget: zero or missing count gives null', () => {
    assert.strictEqual(W.medianPageTarget(0), null);
    assert.strictEqual(W.medianPageTarget(undefined), null);
});
test('shouldOverwrite: untouched meta is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite(undefined), true);
    assert.strictEqual(W.shouldOverwrite({}), true);
    assert.strictEqual(W.shouldOverwrite({ mt: true }), true);
    assert.strictEqual(W.shouldOverwrite({ mult: 1 }), true); // untouched default
});
test('shouldOverwrite: value still equal to last auto is overwritable', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.12, multAuto: 1.12 }), true);
});
test('shouldOverwrite: manual divergence is protected', () => {
    assert.strictEqual(W.shouldOverwrite({ mult: 1.3, multAuto: 1.12 }), false);
    assert.strictEqual(W.shouldOverwrite({ mult: 0.8 }), false); // manual, never fetched
    assert.strictEqual(W.shouldOverwrite({ mult: 1, multAuto: 1.12 }), false); // deliberately reset to 1
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node wcl-mult.test.js`
Expected: the 4 Task-1 tests pass, the new ones FAIL (`W.medianPageTarget is not a function`).

- [ ] **Step 3: Implement** (inside the factory in `wcl-mult.js`; add both names to the returned object)

```js
    function medianPageTarget(count, pageSize) {
        if (!count || count < 1) return null;
        const ps = pageSize || 100;
        const pos = Math.floor((count - 1) / 2); // lower-middle, 0-based
        return { page: Math.floor(pos / ps) + 1, index: pos % ps };
    }

    function shouldOverwrite(meta) {
        if (!meta || typeof meta.mult !== 'number') return true;
        if (typeof meta.multAuto === 'number') return meta.mult === meta.multAuto;
        return meta.mult === 1;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node wcl-mult.test.js`
Expected: `10 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: median page arithmetic and prefill-overwrite rule"
```

---

### Task 3: `computeMult` — the multiplier itself

**Files:**
- Modify: `wcl-mult.js`
- Modify: `wcl-mult.test.js`

**Interfaces:**
- Produces: `computeMult({ ranksByEncounter, mediansByEncounter, classKey, specKey, nowMs, windowMs? }) -> { mult, bosses } | null`
  - `ranksByEncounter`: `{ [encounterId]: [{ amount, spec, startTime }] }` — the player's parses (shape produced by Task 6's endpoint).
  - `mediansByEncounter`: `{ [encounterId]: { [specKey]: number } }` (shape produced by Task 5's endpoint).
  - `classKey`: engine class (`'HUNTER'`), `specKey`: engine key (`'HUNTER:Beast Mastery'`).
  - `windowMs` defaults to 28 days. Returns `null` when no boss yields a ratio.

- [ ] **Step 1: Write the failing tests** (append above the summary lines)

```js
// --- Task 3: computeMult ---
const NOW = 1770000000000; // fixed fake "now"; startTimes are offsets from it
const DAY = 24 * 3600 * 1000;
function mkOpts(over) {
    return Object.assign({
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
        mediansByEncounter: { 101: { 'MAGE:Fire': 1000 }, 102: { 'MAGE:Fire': 2000 } },
        ranksByEncounter: {},
    }, over);
}
test('computeMult: single boss, single parse', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [{ amount: 1120, spec: 'Fire', startTime: NOW - 2 * DAY }],
    } }));
    assert.deepStrictEqual(r, { mult: 1.12, bosses: 1 });
});
test('computeMult: per-boss median (odd and even), then mean across bosses', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        // boss 101: amounts 900,1000,1100 -> median 1000 -> ratio 1.0
        101: [900, 1000, 1100].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
        // boss 102: amounts 2000,3000 -> median 2500 -> ratio 1.25
        102: [2000, 3000].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
    } }));
    assert.deepStrictEqual(r, { mult: 1.13, bosses: 2 }); // mean(1.0, 1.25) = 1.125 -> 1.13
});
test('computeMult: parses outside the 4-week window are ignored', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [
            { amount: 5000, spec: 'Fire', startTime: NOW - 29 * DAY }, // too old
            { amount: 1050, spec: 'Fire', startTime: NOW - 27 * DAY },
        ],
    } }));
    assert.deepStrictEqual(r, { mult: 1.05, bosses: 1 });
});
test('computeMult: off-spec parses are ignored (WCL spec-name form)', () => {
    const r = W.computeMult(mkOpts({ ranksByEncounter: {
        101: [
            { amount: 5000, spec: 'Arcane', startTime: NOW - DAY },
            { amount: 980, spec: 'Fire', startTime: NOW - DAY },
        ],
    } }));
    assert.deepStrictEqual(r, { mult: 0.98, bosses: 1 });
});
test('computeMult: clamps to [0.5, 2]', () => {
    const hi = W.computeMult(mkOpts({ ranksByEncounter: { 101: [{ amount: 9000, spec: 'Fire', startTime: NOW - DAY }] } }));
    assert.strictEqual(hi.mult, 2);
    const lo = W.computeMult(mkOpts({ ranksByEncounter: { 101: [{ amount: 10, spec: 'Fire', startTime: NOW - DAY }] } }));
    assert.strictEqual(lo.mult, 0.5);
});
test('computeMult: no qualifying data gives null', () => {
    assert.strictEqual(W.computeMult(mkOpts({})), null);
    assert.strictEqual(W.computeMult(mkOpts({ ranksByEncounter: {
        101: [{ amount: 1000, spec: 'Arcane', startTime: NOW - DAY }],
    } })), null);
    // boss the player logged but no median for the spec on that boss
    assert.strictEqual(W.computeMult(mkOpts({
        mediansByEncounter: { 101: {} },
        ranksByEncounter: { 101: [{ amount: 1000, spec: 'Fire', startTime: NOW - DAY }] },
    })), null);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node wcl-mult.test.js`
Expected: Task 1–2 tests pass; new tests FAIL (`W.computeMult is not a function`).

- [ ] **Step 3: Implement** (inside the factory; export `computeMult`)

```js
    function median(xs) {
        if (!xs.length) return null;
        const s = xs.slice().sort((a, b) => a - b);
        const n = s.length;
        return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }

    function computeMult(opts) {
        const windowMs = opts.windowMs || 28 * 24 * 3600 * 1000;
        const medians = opts.mediansByEncounter || {};
        const ratios = [];
        Object.keys(medians).forEach(function (encId) {
            const specMedian = medians[encId] && medians[encId][opts.specKey];
            if (!(specMedian > 0)) return;
            const amounts = ((opts.ranksByEncounter || {})[encId] || [])
                .filter(r => r && typeof r.amount === 'number' && typeof r.startTime === 'number')
                .filter(r => opts.nowMs - r.startTime <= windowMs)
                .filter(r => specNameToKey(opts.classKey, r.spec) === opts.specKey)
                .map(r => r.amount);
            const m = median(amounts);
            if (m !== null) ratios.push(m / specMedian);
        });
        if (!ratios.length) return null;
        const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const mult = Math.min(2, Math.max(0.5, Math.round(mean * 100) / 100));
        return { mult, bosses: ratios.length };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node wcl-mult.test.js`
Expected: `16 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: computeMult — 4-week same-spec median vs global spec median"
```

---

### Task 4: Live WCL probe — verify zone ID, spec names and response shapes

**Files:**
- Modify: `wcl-mult.js` (set the real `DEFAULT_ZONE`; adjust `WCL_SPECS`/mapping only if the probe contradicts them)
- Modify: `wcl-mult.test.js` (same adjustments, e.g. spec count 22 → 23 if druid `Guardian` is rankable)

**Interfaces:**
- Consumes: nothing from code — this is an API reconnaissance task.
- Produces: verified `DEFAULT_ZONE`, confirmed GraphQL field names that Tasks 5–6 rely on: `characterRankings` (`count`, `rankings[].amount`), `encounterRankings` (`ranks[].amount`, `ranks[].spec`, `ranks[].startTime`).

**Prerequisite — credentials.** Check `.env` for `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`. If absent, STOP and ask the user for them (they are created free at the WCL site under "API Clients"). Do not invent values; do not commit them.

- [ ] **Step 1: Get a token**

```bash
cd /Users/maxvanzoelen/wowstuff
CLIENT_ID=$(grep '^WCL_CLIENT_ID=' .env | cut -d= -f2)
CLIENT_SECRET=$(grep '^WCL_CLIENT_SECRET=' .env | cut -d= -f2)
TOKEN=$(curl -s -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials \
  https://www.warcraftlogs.com/oauth/token | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
echo "token acquired: ${TOKEN:0:12}…"
```

- [ ] **Step 2: Find the Anniversary SSC/TK zone**

```bash
curl -s https://www.warcraftlogs.com/api/v2/client -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{worldData{zones{id name expansion{id name}}}}"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.worldData.zones.map(z=>z.id+" "+z.name+" ["+z.expansion.name+"]").join("\n")'
```

Pick the zone whose name is the SSC/TK tier for the **Anniversary/Fresh TBC** expansion entry (names like "Serpentshrine Cavern / Tempest Keep"). If more than one candidate looks plausible (e.g. both a 2021-Classic and an Anniversary partition), list them to the user and ask which matches their guild's logs. Record the chosen ID.

- [ ] **Step 3: Verify encounter list and characterRankings shape for that zone**

```bash
ZONE=<chosen id>
curl -s https://www.warcraftlogs.com/api/v2/client -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"{worldData{zone(id:$ZONE){name encounters{id name}}}}\"}"
# then, with one encounter id E from the output:
curl -s https://www.warcraftlogs.com/api/v2/client -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"{worldData{encounter(id:E){characterRankings(className:\\\"Mage\\\",specName:\\\"Fire\\\",metric:dps,page:1)}}}\"}"
```

Confirm the rankings JSON has `count` and `rankings[].amount`. Also probe `className:"Druid", specName:"Guardian"` — if it returns a nonzero `count`, add `['Druid','Guardian']` to `WCL_SPECS` in `wcl-mult.js` and bump the count assertion in the Task-1 test to 23; if it errors or is empty, leave the list at 22.

- [ ] **Step 4: Verify encounterRankings shape for a character**

Ask the user for one known character name + realm slug + region from their guild, then:

```bash
curl -s https://www.warcraftlogs.com/api/v2/client -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"{characterData{character(name:\\\"NAME\\\",serverSlug:\\\"SLUG\\\",serverRegion:\\\"eu\\\"){r: encounterRankings(encounterID:E,metric:dps)}}}\"}"
```

Confirm `ranks[]` entries carry `amount`, `spec`, `startTime` (ms). If any field name differs from what Tasks 3/5/6 assume, update the plan's code and the Task-3 fixtures NOW, before the server work — and say so in the commit message.

- [ ] **Step 5: Record the zone ID and commit**

In `wcl-mult.js`, replace the placeholder:

```js
    // Verified live 2026-08-XX against WCL API v2 (Anniversary SSC/TK tier).
    const DEFAULT_ZONE = <verified id>;
```

Run: `npm test` — expected: all pass.

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: verified WCL zone id and response shapes for Anniversary SSC/TK"
```

---

### Task 5: server.js — WCL auth + `/api/wcl/medians`

**Files:**
- Modify: `server.js` (add below the Raid-Helper proxy, around line 78)
- Modify: `.gitignore` (add `wcl-medians-cache.json`; create `.gitignore` if it doesn't exist, and check `.env` is already listed)

**Interfaces:**
- Consumes: `WclMult.WCL_SPECS`, `WclMult.medianPageTarget` (Tasks 1–2) via `require('./wcl-mult.js')`.
- Produces: `GET /api/wcl/medians?zone=<id>[&refresh=1]` → `{ fetchedAt, zone, name, encounters: [{id, name}], medians: { [encounterId]: { [specKey]: amount } } }`. Errors: 400 bad zone, 404 unknown zone, 503 no credentials, 429 rate-limited, 502/504 upstream trouble — always JSON `{ error }`.

- [ ] **Step 1: Add the WCL plumbing to server.js**

```js
// --- Warcraft Logs proxy (client-credentials OAuth; secrets live in .env) -------------
const WclMult = require('./wcl-mult.js');
const WCL_API = 'https://www.warcraftlogs.com/api/v2/client';
const WCL_CACHE_FILE = path.join(__dirname, 'wcl-medians-cache.json');
const WCL_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

let wclToken = null; // { token, expiresAt } — cached until shortly before expiry
async function getWclToken() {
  if (!process.env.WCL_CLIENT_ID || !process.env.WCL_CLIENT_SECRET) {
    const e = new Error('WCL API credentials not configured (WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env)');
    e.code = 'NO_CREDS';
    throw e;
  }
  if (wclToken && Date.now() < wclToken.expiresAt - 60000) return wclToken.token;
  const res = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.WCL_CLIENT_ID + ':' + process.env.WCL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('WCL token request failed: ' + res.status);
  const data = await res.json();
  wclToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return wclToken.token;
}

async function wclQuery(query, variables) {
  const token = await getWclToken();
  const res = await fetch(WCL_API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) { const e = new Error('WCL rate limit reached — try again later'); e.code = 'RATE_LIMIT'; throw e; }
  if (!res.ok) throw new Error('WCL returned ' + res.status);
  const data = await res.json();
  if (data.errors && data.errors.length) throw new Error('WCL GraphQL: ' + data.errors[0].message);
  return data.data;
}

function wclErrorResponse(res, err, what) {
  console.error(what + ' failed:', err);
  if (err.code === 'NO_CREDS') return res.status(503).json({ error: err.message });
  if (err.code === 'RATE_LIMIT') return res.status(429).json({ error: err.message });
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    return res.status(504).json({ error: what + ' timed out' });
  }
  res.status(502).json({ error: err.message || (what + ' failed') });
}
```

- [ ] **Step 2: Add the medians endpoint**

```js
const RANKINGS_QUERY = 'query($id:Int!,$cls:String!,$spec:String!,$page:Int!){worldData{encounter(id:$id){' +
  'characterRankings(className:$cls,specName:$spec,metric:dps,page:$page)}}}';

app.get('/api/wcl/medians', async (req, res) => {
  const zone = parseInt(req.query.zone, 10);
  if (!Number.isInteger(zone) || zone <= 0) return res.status(400).json({ error: 'Invalid zone id' });
  try {
    if (!req.query.refresh) {
      try {
        const cached = JSON.parse(fs.readFileSync(WCL_CACHE_FILE, 'utf8'));
        if (cached.zone === zone && Date.now() - cached.fetchedAt < WCL_CACHE_TTL_MS) return res.json(cached);
      } catch (e) { /* no cache yet — fall through to a live sweep */ }
    }
    const zd = await wclQuery('query($zone:Int!){worldData{zone(id:$zone){name encounters{id name}}}}', { zone });
    const z = zd.worldData.zone;
    if (!z) return res.status(404).json({ error: 'Unknown WCL zone ' + zone });
    const medians = {};
    for (const enc of z.encounters) {
      medians[enc.id] = {};
      for (const s of WclMult.WCL_SPECS) {
        const vars = { id: enc.id, cls: s.className, spec: s.specName };
        const first = await wclQuery(RANKINGS_QUERY, Object.assign({ page: 1 }, vars));
        const r1 = first.worldData.encounter.characterRankings;
        const target = WclMult.medianPageTarget(r1 && r1.count);
        if (!target) continue; // nobody ranked on this spec/boss
        let rankings = r1.rankings;
        if (target.page !== 1) {
          const mid = await wclQuery(RANKINGS_QUERY, Object.assign({ page: target.page }, vars));
          rankings = mid.worldData.encounter.characterRankings.rankings;
        }
        const entry = rankings && rankings[target.index];
        if (entry && typeof entry.amount === 'number') medians[enc.id][s.specKey] = entry.amount;
      }
    }
    const payload = { fetchedAt: Date.now(), zone, name: z.name, encounters: z.encounters, medians };
    fs.writeFileSync(WCL_CACHE_FILE, JSON.stringify(payload));
    res.json(payload);
  } catch (err) { wclErrorResponse(res, err, 'WCL medians sweep'); }
});
```

- [ ] **Step 3: Gitignore the cache file**

Ensure `.gitignore` contains `wcl-medians-cache.json` (and that `.env` is already there — it should be; if not, add it and tell the user).

- [ ] **Step 4: Verify live**

Run: `node server.js` (in background), then:

```bash
time curl -s "http://localhost:3000/api/wcl/medians?zone=<DEFAULT_ZONE>" | node -pe '
  const d = JSON.parse(require("fs").readFileSync(0));
  d.name + ": " + d.encounters.length + " encounters, sample medians: " +
  JSON.stringify(d.medians[d.encounters[0].id])'
# Second call must return instantly from cache:
time curl -s "http://localhost:3000/api/wcl/medians?zone=<DEFAULT_ZONE>" >/dev/null
```

Expected: first call slow (hundreds of queries — 1–3 min is normal), plausible per-spec DPS medians (hundreds-to-thousands range, mages ≈ warlocks > tanks); second call sub-second. Also check the no-creds path once by temporarily renaming the two `.env` keys → expect 503 JSON, then restore. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add server.js .gitignore
git commit -m "feat: /api/wcl/medians — cached global spec-median sweep via WCL v2"
```

---

### Task 6: server.js — `/api/wcl/player`

**Files:**
- Modify: `server.js` (directly below the medians endpoint)

**Interfaces:**
- Consumes: the medians cache file for the encounter list (falls back to a live zone query when absent).
- Produces: `GET /api/wcl/player?name=&server=&region=&zone=` → `{ name, ranksByEncounter: { [encounterId]: ranks[] } }` where `ranks[]` is WCL's `encounterRankings.ranks` array passed through (entries carry `amount`, `spec`, `startTime`). 404 when WCL has no such character; the client treats that as "no logs".

- [ ] **Step 1: Implement the endpoint**

```js
app.get('/api/wcl/player', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10);
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  if (!Number.isInteger(zone) || zone <= 0) return res.status(400).json({ error: 'Invalid zone id' });
  try {
    let encounters = null;
    try {
      const cached = JSON.parse(fs.readFileSync(WCL_CACHE_FILE, 'utf8'));
      if (cached.zone === zone) encounters = cached.encounters;
    } catch (e) { /* no cache */ }
    if (!encounters) {
      const zd = await wclQuery('query($zone:Int!){worldData{zone(id:$zone){encounters{id name}}}}', { zone });
      if (!zd.worldData.zone) return res.status(404).json({ error: 'Unknown WCL zone ' + zone });
      encounters = zd.worldData.zone.encounters;
    }
    // One query, one alias per encounter. encounterRankings is a JSON scalar in WCL's
    // schema, so per-field selection is neither possible nor needed.
    const aliases = encounters
      .map(e => 'e' + e.id + ': encounterRankings(encounterID:' + e.id + ',metric:dps)')
      .join(' ');
    const q = 'query($name:String!,$server:String!,$region:String!){characterData{' +
      'character(name:$name,serverSlug:$server,serverRegion:$region){' + aliases + '}}}';
    const data = await wclQuery(q, { name, server, region });
    const ch = data.characterData.character;
    if (!ch) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    const ranksByEncounter = {};
    encounters.forEach(e => {
      const blob = ch['e' + e.id];
      ranksByEncounter[e.id] = (blob && Array.isArray(blob.ranks)) ? blob.ranks : [];
    });
    res.json({ name, ranksByEncounter });
  } catch (err) { wclErrorResponse(res, err, 'WCL player lookup'); }
});
```

- [ ] **Step 2: Verify live**

Start `node server.js`, then with the character/realm from Task 4:

```bash
curl -s "http://localhost:3000/api/wcl/player?name=NAME&server=SLUG&region=eu&zone=<DEFAULT_ZONE>" \
  | node -pe 'const d=JSON.parse(require("fs").readFileSync(0));
      Object.entries(d.ranksByEncounter).map(([k,v])=>k+": "+v.length+" ranks").join("\n")'
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/api/wcl/player?name=Nosuchplayerxq&server=SLUG&region=eu&zone=<DEFAULT_ZONE>"
```

Expected: real ranks for the known character; `404` for the fake one. Spot-check one rank object has `amount`, `spec`, `startTime`. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: /api/wcl/player — per-character encounter rankings proxy"
```

---

### Task 7: UI — settings, fetch button, prefill and tooltip

**Files:**
- Modify: `assignments.html:86` (add `<script src="wcl-mult.js"></script>` between the engine and `assignments.js`)
- Modify: `assignments.js` (state default, tuning panel around line 464, new fetch function)
- Modify: `style.css` (only if the new row needs spacing; keep to a couple of rules)

**Interfaces:**
- Consumes: `WclMult.computeMult`, `WclMult.shouldOverwrite`, `WclMult.DEFAULT_ZONE` (browser global via the new script tag); the two endpoints from Tasks 5–6.
- Produces: `state.wcl = { server, region }` (persisted); `state.playerMeta[name]` gains `multAuto: number` and `multInfo: { bosses, fetchedAt }`.

- [ ] **Step 1: Wire the state default**

In the `state` literal at `assignments.js:8`, add:

```js
    wcl: { server: '', region: 'eu' },   // Warcraft Logs realm slug + region for parse fetching
```

(Existing saved states merge via `Object.assign`, so also guard at use: `state.wcl = state.wcl || { server: '', region: 'eu' };` at the top of the fetch handler and settings row builder.)

- [ ] **Step 2: Add the WCL row to the Player tuning panel**

Inside the `tune` details element construction (after `tune.appendChild(sum);`, before the `roster.forEach` rows):

```js
    // WCL performance prefill: realm/region settings, fetch button, last-fetch status.
    state.wcl = state.wcl || { server: '', region: 'eu' };
    const wclRow = document.createElement('div');
    wclRow.className = 'tuning-row wcl-row';
    const srv = document.createElement('input');
    srv.type = 'text';
    srv.placeholder = 'realm-slug';
    srv.value = state.wcl.server || '';
    srv.title = 'Warcraft Logs realm slug, e.g. "spineshatter"';
    srv.addEventListener('change', () => { state.wcl.server = srv.value.trim().toLowerCase(); saveState(); });
    const reg = document.createElement('select');
    ['eu', 'us'].forEach(r => {
        const o = document.createElement('option');
        o.value = r; o.textContent = r.toUpperCase();
        if ((state.wcl.region || 'eu') === r) o.selected = true;
        reg.appendChild(o);
    });
    reg.addEventListener('change', () => { state.wcl.region = reg.value; saveState(); });
    const fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.textContent = 'Fetch from Warcraft Logs';
    fetchBtn.title = 'Prefill multipliers: your 4-week median parse vs the global spec median. Manual edits survive a refetch.';
    const status = document.createElement('span');
    status.className = 'wcl-status';
    status.textContent = wclStatus;
    fetchBtn.addEventListener('click', () => fetchWclMults(fetchBtn, status));
    wclRow.appendChild(srv); wclRow.appendChild(reg); wclRow.appendChild(fetchBtn); wclRow.appendChild(status);
    tune.appendChild(wclRow);
```

Add a module-level `let wclStatus = '';` near the other module state (~line 22) — `renderAll()` rebuilds the panel, so the status string must live outside it to survive the post-fetch rerender.

- [ ] **Step 3: The fetch function** (top level in `assignments.js`)

```js
async function fetchWclMults(btn, statusEl) {
    state.wcl = state.wcl || { server: '', region: 'eu' };
    if (!state.wcl.server) { statusEl.textContent = 'Set the realm slug first.'; return; }
    if (!WclMult.DEFAULT_ZONE) { statusEl.textContent = 'No WCL zone configured.'; return; }
    btn.disabled = true;
    try {
        statusEl.textContent = 'Fetching spec medians…';
        const mRes = await fetch('/api/wcl/medians?zone=' + WclMult.DEFAULT_ZONE);
        if (!mRes.ok) throw new Error((await mRes.json()).error || 'medians fetch failed');
        const medians = await mRes.json();
        const eligible = roster.filter(p => (E.BASELINE[E.specKey(p)] || 0) > 0);
        const noLogs = [];
        let filled = 0;
        for (let i = 0; i < eligible.length; i++) {
            const p = eligible[i];
            statusEl.textContent = 'Fetching ' + p.name + ' (' + (i + 1) + '/' + eligible.length + ')…';
            const url = '/api/wcl/player?name=' + encodeURIComponent(p.name) +
                '&server=' + encodeURIComponent(state.wcl.server) +
                '&region=' + (state.wcl.region || 'eu') + '&zone=' + WclMult.DEFAULT_ZONE;
            const r = await fetch(url);
            if (r.status === 404) { noLogs.push(p.name); continue; }
            if (!r.ok) throw new Error((await r.json()).error || 'player fetch failed');
            const data = await r.json();
            const result = WclMult.computeMult({
                ranksByEncounter: data.ranksByEncounter,
                mediansByEncounter: medians.medians,
                classKey: p.class, specKey: E.specKey(p), nowMs: Date.now(),
            });
            if (!result) { noLogs.push(p.name); continue; }
            const meta = state.playerMeta[p.name] || {};
            const next = Object.assign({}, meta, {
                multAuto: result.mult,
                multInfo: { bosses: result.bosses, fetchedAt: Date.now() },
            });
            if (WclMult.shouldOverwrite(meta)) next.mult = result.mult;
            state.playerMeta[p.name] = next;
            filled++;
        }
        wclStatus = 'WCL: ' + filled + '/' + eligible.length + ' prefilled' +
            (noLogs.length ? ' — no logs: ' + noLogs.join(', ') : '');
    } catch (err) {
        wclStatus = 'WCL fetch failed: ' + err.message;
    }
    saveState();
    renderAll(); // rebuilds the panel; the new status renders from wclStatus
}
```

- [ ] **Step 4: Provenance tooltip and kept-override marker on the mult input**

In the existing `roster.forEach` row builder, after `mult.title = …`, add:

```js
        if (m.multInfo && typeof m.multAuto === 'number') {
            mult.title += ' — WCL: ' + m.multAuto + ' from ' + m.multInfo.bosses +
                ' boss(es), fetched ' + new Date(m.multInfo.fetchedAt).toISOString().slice(0, 10) +
                (typeof m.mult === 'number' && m.mult !== m.multAuto ? ' (manual override kept)' : '');
        }
```

- [ ] **Step 5: Script tag**

In `assignments.html`, before the `assignments.js` include:

```html
    <script src="wcl-mult.js"></script>
```

- [ ] **Step 6: Verify in the real app**

`npm test` first (all green — proves no engine regression). Then start `node server.js` and drive headless Chrome over CDP (no browser tool here — see memory `wowstuff-verification-harness` for the gotchas): load `http://localhost:3000/`, import a roster (a saved state in localStorage or the addon-export path), open the Player tuning panel, set realm/region, click **Fetch from Warcraft Logs**, and screenshot. Confirm: mult inputs filled, tooltip shows provenance, status line lists any no-logs players, and a hand-edited mult then a re-fetch keeps the hand-edited value while updating the tooltip's auto value. Paste the real observed values in the task report.

- [ ] **Step 7: Commit**

```bash
git add assignments.html assignments.js style.css
git commit -m "feat: WCL performance prefill — fetch button, settings and provenance tooltips"
```

---

### Task 8: End-to-end verification and finish

**Files:**
- None new — verification, then merge per the finishing workflow.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every engine test and every wcl-mult test passes. Paste the real tail of the output (`N passed, 0 failed` lines).

- [ ] **Step 2: Cold-start end-to-end**

Delete `wcl-medians-cache.json`, restart `node server.js`, and repeat the Task-7 browser flow once from scratch (slow first medians call, fast second). Sanity-check 2–3 known players against their WCL pages: a strong parser should land > 1.0, a weak one < 1.0. If every mult comes out clamped at 0.5 or 2.0, something is wrong (units, wrong zone, wrong partition) — stop and investigate before declaring success.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — merge to `main` per the repo's existing merge-commit convention.
