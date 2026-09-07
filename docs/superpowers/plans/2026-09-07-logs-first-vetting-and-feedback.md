# Logs-First Vetting and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The feedback report lists raid nights from both tiers and shows the picker before any analysis; the vetting page can load a whole raid from one Warcraft Logs report with gear instantly and parses streaming in.

**Architecture:** Part A (Tasks 1–4) fixes `vet-feedback.js` to read killed bosses from `profile.parses` *and* `profile.parses.other`, adds a cheap `fetchNights` + `/api/vet/nights`, and makes `feedback.js` picker-first. Part B (Tasks 5–10) adds `wcl-logs.js` (guild report list, report roster), splits the rankings half out of `fetchProfile` so `/api/vet/parses` can reuse it, adds three routes, and teaches `vetting.js` to load from a log with a pending-parses overlay. Tier gating in `vet-profile.js` is *not* changed.

**Tech Stack:** Node (no dependencies beyond express, already present), vanilla browser JS, the repo's hand-rolled `test(name, fn)` suites run by `npm test`, headless Chrome over CDP for the page smoke.

**Spec:** `docs/superpowers/specs/2026-09-07-logs-first-vetting-and-feedback-design.md`

## Global Constraints

- No new npm dependencies (repo rule; tests use `node:assert` + `node:http` only).
- Every test suite prints `N passed, M failed` and sets `process.exitCode = failed ? 1 : 0`; new suites must be appended to the `"test"` script in `package.json`.
- Zone ids: 1060 = "BT / Hyjal", 1056 = "SSC / TK" (`ZONE_NAMES`, `PREVIOUS_ZONE` in `vet-profile.js`).
- WCL report codes are exactly 16 alphanumerics: `/^[A-Za-z0-9]{16}$/`.
- All `/api/vet/*` and `/api/wcl/*` GET routes reject a `Sec-Fetch-Site` header other than `same-origin` with 403 (existing rule on `/api/vet/feedback`).
- Server caches: profile/feedback/nights/roster/parses 15 min (`FEEDBACK_CACHE_MS`), guild log list 5 min.
- `selectGating` behaviour in `vet-profile.js` must not change; `vet-profile.test.js` must stay green throughout.
- Comment density and style: match the surrounding file (short "why" comments, spec section references like `(logs-first A1)`).
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run from the repo root: `/Users/maxvanzoelen/wowstuff`. The scratchpad directory named in your system prompt is where throwaway scripts (Task 10) go.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `vet-feedback.js` | + `killedBosses`, `tierList`, `fetchNights`; `pickKills`/`buildNights`/`fetchFeedback`/`killFacts`/`buildFacts` tier-aware |
| `vet-profile.js` | + `fetchRankings` (extracted), `profileFromCombatant`, `buildParses` export; `buildProfile` honours `parsesPending` |
| `vet-engine.js` | + `parseReportCode` (browser + node) |
| `wcl-logs.js` (new) | guild report list, report roster (meta + aliased CombatantInfo) |
| `server.js` | + `vetIdentity` helper, `/api/vet/nights`, `/api/vet/parses`, `/api/wcl/logs`, `/api/wcl/log/:code/roster`, caches + test seams |
| `feedback.js` / `feedback.html` | picker-first load, `all=1`, headline from `facts.tiers` |
| `vetting.js` / `vetting.html` / `vetting.css` | guild setting, Load from log, pending overlay, parses streaming, refresh by source, Report link with `report=` |
| `wcl-logs.test.js` (new), `vet-feedback.test.js`, `vet-profile.test.js`, `vet-engine.test.js`, `server.test.js` | tests |
| `README.md` | vetting + feedback bullets |

---

### Task 1: Killed bosses and nights from both tiers

**Files:**
- Modify: `vet-feedback.js:58-68` (`pickKills`), `:979-997` (`buildNights`), `:1003-1076` (`fetchFeedback`), `:748-785` (`killFacts`), export list `:1078`
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `F.killedBosses(parses) -> [{ encounterId, name, medianPercent, zone, zoneName }]`; nights gain `zone`, `zoneName`; `killFacts(input)` accepts `input.zoneName` and sets `kill.zoneName`; `facts.night` gains `zoneName`.

- [ ] **Step 1: Write the failing tests**

Append to `vet-feedback.test.js` just before the final `Promise.all(pending)` block:

```js
// --- logs-first (2026-09-07 spec A1): bosses and nights come from both tiers
// Utopik's live shape on 2026-09-07: SSC / TK (59.7) gates, BT / Hyjal (55.8) is `other`.
function twoTierProfile() {
    const ssc = { medianPerformanceAverage: 59.7, bestPerformanceAverage: 80, rankings: [
        { encounter: { id: 100730, name: "Al'ar" }, medianPercent: 86.9, rankPercent: 90, totalKills: 11, spec: 'Assassination', bestSpec: 'Assassination' },
        { encounter: { id: 100731, name: 'Void Reaver' }, medianPercent: 85.4, rankPercent: 88, totalKills: 11, spec: 'Assassination', bestSpec: 'Assassination' },
    ] };
    const hyjal = { medianPerformanceAverage: 55.8, bestPerformanceAverage: 63.7, rankings: [
        { encounter: { id: 50619, name: 'Anetheron' }, medianPercent: 81.5, rankPercent: 81.5, totalKills: 2, spec: 'Assassination', bestSpec: 'Assassination' },
        { encounter: { id: 50620, name: "Kaz'rogal" }, medianPercent: 44.0, rankPercent: 44.0, totalKills: 2, spec: 'Assassination', bestSpec: 'Assassination' },
        { encounter: { id: 50604, name: 'Teron Gorefiend' }, medianPercent: null, rankPercent: null, totalKills: 0, spec: null, bestSpec: null },
    ] };
    return P.buildProfile({ name: 'Utopik', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'ROGUE', combatant: null, report: null,
                            rankings: ssc, rankingsZone: 1056, fallback: true, metric: 'dps', otherRankings: hyjal, otherZone: 1060, specRankings: hyjal, dbIndex: db });
}
test('killedBosses (logs-first A1): every killed boss of both tiers, each tagged with its tier', () => {
    const k = F.killedBosses(twoTierProfile().parses);
    assert.deepStrictEqual(k.map(b => [b.encounterId, b.zone, b.zoneName]), [
        [100730, 1056, 'SSC / TK'], [100731, 1056, 'SSC / TK'], [50619, 1060, 'BT / Hyjal'], [50620, 1060, 'BT / Hyjal']]);
    assert.deepStrictEqual(F.killedBosses(null), []);
    assert.deepStrictEqual(F.killedBosses({ bosses: [] }), []);
});
test('pickKills (logs-first A1): the other tier\'s bosses are candidates even when SSC / TK gates', () => {
    const ids = F.pickKills(twoTierProfile()).map(b => b.encounterId);
    assert.ok(ids.includes(50620) && ids.includes(50619), 'Hyjal bosses picked: ' + ids.join(','));
    assert.strictEqual(ids[0], 50620, "Kaz'rogal (44.0) is the lowest median across both tiers");
});
test('buildNights (logs-first A1): a night carries the tier of its bosses', () => {
    const ch = { e50619: { ranks: [{ rankPercent: 81.5, startTime: 1788700000000, report: { code: 'X6mnbPQpGhjJC2TN', fightID: 3 } }] },
                 e100730: { ranks: [{ rankPercent: 90, startTime: 1788600000000, report: { code: 'fDBNk8Wm7Avjq6RJ', fightID: 1 } }] } };
    const nights = F.buildNights(ch, F.killedBosses(twoTierProfile().parses));
    assert.deepStrictEqual(nights.map(n => [n.code, n.zone, n.zoneName]), [['X6mnbPQpGhjJC2TN', 1060, 'BT / Hyjal'], ['fDBNk8Wm7Avjq6RJ', 1056, 'SSC / TK']]);
});
test('fetchFeedback (logs-first A1): asks WCL for encounter rankings of BOTH tiers\' bosses', async () => {
    const calls = [];
    const query = async q => { calls.push(q); return { characterData: { character: null } }; };
    const out = await F.fetchFeedback(query, { profile: twoTierProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(out, null);
    assert.strictEqual(calls.length, 1);
    ['e100730', 'e100731', 'e50619', 'e50620'].forEach(a => assert.ok(calls[0].includes(a + ':encounterRankings(encounterID:' + a.slice(1)), 'missing ' + a));
});
test('killFacts (logs-first A1): a kill carries the tier it was fought in', () => {
    const K = FX.kills['50619'];
    const k = F.killFacts({ encounterId: 50619, name: 'Anetheron', rank: FX.encounterRankings['50619'].ranks[0], context: K.context, tables: K.tables,
                            sourceId: K.sourceID, player: PLAYER, reference: null, referenceNote: null, dbIndex: db, zoneName: 'BT / Hyjal' });
    assert.strictEqual(k.zoneName, 'BT / Hyjal');
    assert.strictEqual(killFor(50619).zoneName, null, 'the old call shape gets null, not undefined');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 5 `FAIL - … (logs-first A1)` lines (`F.killedBosses is not a function`, etc.), rest passing.

- [ ] **Step 3: Implement**

In `vet-feedback.js`, replace `pickKills` (lines 58–68) with:

```js
// logs-first A1: every killed boss the profile knows about — the gating tier AND the other tier —
// each tagged with its tier. Reading `parses.bosses` alone hid every night of the other tier from
// a player who parses better in the previous one (Utopik, 2026-09-07).
function killedBosses(parses) {
    const out = [];
    const take = p => {
        if (!p || !Array.isArray(p.bosses)) return;
        p.bosses.forEach(b => {
            if (!b || !(b.kills > 0) || !b.encounterId) return;
            out.push({ encounterId: b.encounterId, name: b.name, medianPercent: b.medianPercent, zone: p.zone, zoneName: p.zoneName });
        });
    };
    take(parses);
    take(parses && parses.other);
    return out;
}

// The killed bosses of both tiers, lowest median first, capped: the worst parses are where the
// explanation lives, and every boss costs about ten WCL points.
function pickKills(profile) {
    const p = profile && profile.parses;
    if (!p) return [];
    const med = b => (typeof b.medianPercent === 'number' ? b.medianPercent : 101);
    return killedBosses(p).sort((a, b) => med(a) - med(b)).slice(0, KILL_LIMIT);
}
```

In `buildNights`, change the Map entry creation and the output row:

```js
            const n = byCode.get(r.report.code) || { code: r.report.code, startTime: Infinity, bosses: [], zone: b.zone == null ? null : b.zone, zoneName: b.zoneName || null };
```
and
```js
        code: n.code, zone: n.zone, zoneName: n.zoneName, date: isFinite(n.startTime) ? new Date(n.startTime).toISOString().slice(0, 10) : null,
```

In `killFacts`, add `zoneName` to the `kill` object right after `encounterId, name, killsOnBoss, killIndex, …`:

```js
        zoneName: typeof input.zoneName === 'string' ? input.zoneName : null,
```

In `fetchFeedback`:
- replace the `const killed = profile.parses.bosses.filter(...)…` line with `const killed = killedBosses(profile.parses);`
- in the `if (o.report)` branch, set `zoneName` on the night: change `night = { code: o.report, date: n.date, medianPercent: n.medianPercent };` to `night = { code: o.report, date: n.date, medianPercent: n.medianPercent, zoneName: n.zoneName };` and the else-branch literal to include `zoneName: targets[0].zoneName || null,`.
- pass the tier into `killFacts`: add `zoneName: t.zoneName,` to the `killFacts({ encounterId: t.encounterId, name: t.name, … })` call.

Add `killedBosses` to `module.exports` (next to `pickKills`).

- [ ] **Step 4: Run the suite**

Run: `node vet-feedback.test.js 2>&1 | tail -3`
Expected: `… passed, 0 failed`. The existing `fetchFeedback (v2 §5.2)` night test at ~line 1076 uses `deepStrictEqual` on `night.night` — the night now also carries `zoneName: 'BT / Hyjal'` (the fixture profile's bosses are tier-tagged by `killedBosses`); update that expected object to `{ code: kazCode, date: all.nights[0].date, medianPercent: all.nights[0].medianPercent, zoneName: 'BT / Hyjal' }`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "fix(feedback): killed bosses and nights come from both tiers (logs-first A1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `facts.tiers` and `fetchNights`

**Files:**
- Modify: `vet-feedback.js` (`buildFacts` ~line 676, `fetchFeedback`, exports)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `F.tierList(profile) -> [{ zone, zoneName, medianPercent }]` (requested zone first); `facts.tiers`; `F.fetchNights(query, { profile }) -> Promise<{ nights, tiers }>`.

- [ ] **Step 1: Write the failing tests**

Append before the `Promise.all(pending)` block:

```js
test('tierList / facts.tiers (logs-first A2): both tiers with real medians, the requested zone first', () => {
    const tiers = F.tierList(twoTierProfile());
    assert.deepStrictEqual(tiers, [{ zone: 1060, zoneName: 'BT / Hyjal', medianPercent: 55.8 }, { zone: 1056, zoneName: 'SSC / TK', medianPercent: 59.7 }]);
    const one = F.tierList(rotProfile());
    assert.deepStrictEqual(one, [{ zone: 1060, zoneName: 'BT / Hyjal', medianPercent: 14 }]);
    const facts = F.buildFacts({ profile: twoTierProfile(), player: Object.assign({}, PLAYER, { name: 'Utopik' }), kills: [], thresholds: {}, now: Date.now(), nights: [], night: null });
    assert.deepStrictEqual(facts.tiers.map(t => t.zone), [1060, 1056]);
});
test('fetchNights (logs-first A3): one encounterRankings request, nights from both tiers, no analysis', async () => {
    const calls = [];
    const query = async q => {
        calls.push(q);
        return { characterData: { character: {
            e50619: { ranks: [{ rankPercent: 81.5, startTime: 1788700000000, report: { code: 'X6mnbPQpGhjJC2TN', fightID: 3 } }] },
            e50620: { ranks: [] }, e100731: { ranks: [] },
            e100730: { ranks: [{ rankPercent: 90, startTime: 1788600000000, report: { code: 'fDBNk8Wm7Avjq6RJ', fightID: 1 } }] } } } };
    };
    const out = await F.fetchNights(query, { profile: twoTierProfile() });
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(out.nights.map(n => [n.code, n.zoneName]), [['X6mnbPQpGhjJC2TN', 'BT / Hyjal'], ['fDBNk8Wm7Avjq6RJ', 'SSC / TK']]);
    assert.deepStrictEqual(out.tiers.map(t => t.zone), [1060, 1056]);
    assert.deepStrictEqual(await F.fetchNights(query, { profile: { parses: null } }), { nights: [], tiers: [] });
    const gone = await F.fetchNights(async () => ({ characterData: { character: null } }), { profile: twoTierProfile() });
    assert.deepStrictEqual(gone.nights, []);
    assert.strictEqual(gone.tiers.length, 2);
});
```

`rotProfile()` already exists in this file (~line 657).

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 2 FAILs (`F.tierList is not a function`, `F.fetchNights is not a function`).

- [ ] **Step 3: Implement**

Add above `buildFacts`:

```js
// logs-first A2: every tier the player has kills in, with its own WCL median — the page shows
// these side by side rather than a blended average WCL never computed. Requested zone first.
function tierList(profile) {
    const p = profile && profile.parses;
    if (!p) return [];
    const row = t => ({ zone: t.zone, zoneName: t.zoneName, medianPercent: round1(t.medianPercent) });
    const out = [row(p)];
    if (p.other) out.push(row(p.other));
    return out.sort((a, b) => (b.zone === profile.zone) - (a.zone === profile.zone));
}
```

In `buildFacts`, add after the `tier:` line:

```js
        tiers: tierList(profile),
```

Add above `fetchFeedback`:

```js
// logs-first A3: the night picker alone — the profile plus ONE encounterRankings request
// (~5 requests, ~3 s live) instead of the full 140-request analysis the picker used to hide
// behind. Returns { nights, tiers }; nights is empty when the character has no ranked kills.
async function fetchNights(query, o) {
    const { profile } = o;
    if (!profile || !profile.parses) return { nights: [], tiers: [] };
    const killed = killedBosses(profile.parses);
    const tiers = tierList(profile);
    if (!killed.length) return { nights: [], tiers };
    const er = await query(encounterRankQuery(killed.map(t => t.encounterId), profile.parses.metric), { name: profile.name, server: profile.server, region: profile.region });
    const ch = er && er.characterData && er.characterData.character;
    return { nights: ch ? buildNights(ch, killed) : [], tiers };
}
```

Export `tierList` and `fetchNights`.

- [ ] **Step 4: Run the suite**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): facts.tiers and fetchNights — the picker without the analysis (logs-first A2, A3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/vet/nights`

**Files:**
- Modify: `server.js` (after the `/api/vet/player` route ~line 222; `app.__test` seams at the bottom)
- Test: `server.test.js`

**Interfaces:**
- Produces: `vetIdentity(req) -> { name, server, region, zone } | { error }` (server-internal helper used by every new route); route `/api/vet/nights` → `{ nights, tiers }`, header `X-Vet-Cache: hit|miss`; `app.__test.caches.nightsCache`.

- [ ] **Step 1: Write the failing tests**

Append to `server.test.js` before the final `test(... )`-chain closer (the block that calls `srv.close()`), using the existing `setupPipeline`, `SAME_ORIGIN`, `QS`, `IDENTITY_KEY`:

```js
// --- logs-first A3: the night picker endpoint
test('GET /api/vet/nights: profile + one encounterRankings call, nights and tiers, cached', async () => {
    const s = setupPipeline();
    let res = await fetch(base + '/api/vet/nights?' + QS, SAME_ORIGIN);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-vet-cache'), 'miss');
    const body = await res.json();
    assert.ok(Array.isArray(body.nights) && body.nights.length >= 1, 'nights listed');
    assert.deepStrictEqual(body.tiers, [{ zone: 1060, zoneName: 'BT / Hyjal', medianPercent: 14 }]);
    assert.strictEqual(s.calls.filter(c => c.q.includes('encounterRankings(')).length, 1, 'exactly one WCL request beyond the (seeded) profile');
    assert.strictEqual(s.calls.some(c => c.q === F.FIGHT_QUERY), false, 'no analysis ran');
    res = await fetch(base + '/api/vet/nights?' + QS, SAME_ORIGIN);
    assert.strictEqual(res.headers.get('x-vet-cache'), 'hit');
    assert.ok(app.__test.caches.nightsCache.has(IDENTITY_KEY + '/nights'));
});
test('GET /api/vet/nights: validation, cross-origin block, unknown character', async () => {
    setupPipeline();
    assert.strictEqual((await fetch(base + '/api/vet/nights?name=x&server=spineshatter&region=eu', SAME_ORIGIN)).status, 400);
    assert.strictEqual((await fetch(base + '/api/vet/nights?' + QS, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    app.__test.setWclQuery(async q => { if (q === P.CHAR_QUERY) return { characterData: { character: null } }; throw new Error('unexpected ' + q.slice(0, 40)); });
    assert.strictEqual((await fetch(base + '/api/vet/nights?name=Nobody&server=spineshatter&region=eu&zone=1060', SAME_ORIGIN)).status, 404);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node server.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 2 FAILs (status 404 from express's default for an unknown route).

- [ ] **Step 3: Implement**

In `server.js`, directly above `app.get('/api/vet/player', …)` add:

```js
// Shared by the routes added for logs-first (nights, parses, logs, roster): the same name /
// server / region / zone validation /api/vet/player and /api/vet/feedback do inline, and the
// same Sec-Fetch-Site rule /api/vet/feedback explains — page script cannot fake that header, so
// a cross-origin page cannot spend the user's WCL points through these endpoints.
function vetIdentity(req) {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return { status: 403, error: 'Cross-origin requests are not allowed' };
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return { status: 400, error: 'Invalid character name' };
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return { status: 400, error: 'Invalid server slug' };
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return { status: 400, error: 'Invalid region' };
  return { name, server, region, zone, key: region + '/' + server + '/' + name.toLowerCase() + '/' + zone };
}
```

After the `/api/vet/feedback` route (it needs `FEEDBACK_CACHE_MS` and `VetFeedback`, both declared above it) add:

```js
// logs-first A3: the night picker on its own. Profile (cached) + one encounterRankings request.
const nightsCache = new Map(); // identity key + '/nights' -> { at, body }
app.get('/api/vet/nights', async (req, res) => {
  const id = vetIdentity(req);
  if (id.error) return res.status(id.status).json({ error: id.error });
  const key = id.key + '/nights';
  try {
    const hit = nightsCache.get(key);
    if (hit && Date.now() - hit.at < FEEDBACK_CACHE_MS) { res.set('X-Vet-Cache', 'hit'); return res.json(hit.body); }
    const { profile } = await loadProfile(id.name, id.server, id.region, id.zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    const body = await VetFeedback.fetchNights(wclQuery, { profile });
    for (const [k, v] of nightsCache) if (Date.now() - v.at >= FEEDBACK_CACHE_MS) nightsCache.delete(k);
    nightsCache.set(key, { at: Date.now(), body });
    res.set('X-Vet-Cache', 'miss');
    res.json(body);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL nights lookup');
  }
});
```

In `app.__test`: add `nightsCache.clear();` to `resetCaches` and `nightsCache` to `caches`.

- [ ] **Step 4: Run the suite**

Run: `node server.test.js 2>&1 | tail -2`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(server): GET /api/vet/nights — the picker in five WCL requests (logs-first A3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Feedback page — picker first

**Files:**
- Modify: `feedback.js` (lines 4–6 `q`/`key`; `apiUrl`/`load` ~57–77; `render` ~98–111; wiring ~150–157), `feedback.html:31` (initial status text)

**Interfaces:**
- Consumes: `/api/vet/nights` → `{ nights: [{ code, date, zone, zoneName, bosses, medianPercent }], tiers }`; `facts.tiers`, `facts.night.zoneName` from Tasks 1–2.
- Produces: URL contract — bare URL shows the picker only; `?report=<code>` analyses a night; `?all=1` analyses across all kills.

There is no DOM test runner in this repo; the page is verified in Task 10's CDP smoke. This task's steps are edit → manual reasoning check → commit.

- [ ] **Step 1: Query params and keys**

Replace line 5 (`const q = …`) with:

```js
    const q = { name: params.get('name') || '', server: (params.get('server') || '').toLowerCase(), region: (params.get('region') || 'eu').toLowerCase(), zone: params.get('zone') || '1060',
                report: params.get('report') || '', all: params.get('all') === '1', thresholds: params.get('thresholds') || '' };
```

Below `key()` add:

```js
    // logs-first A4: the night list is cached apart from any analysis — it is what the bare URL
    // shows, and it costs five WCL requests, not 140.
    const NIGHTS_TTL = 15 * 60 * 1000;
    const nightsKey = () => 'raidFeedbackNights:' + encodeURIComponent(q.region) + '/' + encodeURIComponent(q.server) + '/' + encodeURIComponent(q.name.toLowerCase()) + '/' + encodeURIComponent(q.zone);
    const shortTier = z => (/^[^\s/]+/.exec(z || '') || [z || ''])[0];
```

- [ ] **Step 2: The picker renderer and the nights loader**

Add after `apiUrl()`:

```js
    function nightsUrl() {
        return '/api/vet/nights?name=' + encodeURIComponent(q.name) + '&server=' + encodeURIComponent(q.server) + '&region=' + encodeURIComponent(q.region) + '&zone=' + encodeURIComponent(q.zone);
    }
    // One renderer for both states: the bare page (nothing selected) and a finished analysis
    // (its night, or 'all', selected). Nights are labelled with their tier — the list now spans
    // BT / Hyjal and SSC / TK.
    function renderPicker(nights, selected) {
        const sel = $('nightSelect');
        sel.classList.remove('hidden');
        const label = n => n.date + ' · ' + shortTier(n.zoneName) + ' · ' + n.bosses.length + (n.bosses.length === 1 ? ' boss' : ' bosses') + ' · median ' + (n.medianPercent == null ? '—' : Math.round(n.medianPercent));
        sel.innerHTML = '<option value="">Choose a raid night…</option>' +
            '<option value="all"' + (nights.length ? '' : ' disabled') + '>Across all kills' + (nights.length ? '' : ' (no ranked kills)') + '</option>' +
            nights.map(n => '<option value="' + escapeHtml(n.code) + '">' + escapeHtml(label(n)) + '</option>').join('');
        sel.value = selected;
    }
    function showPicker(body) {
        $('errorBox').classList.add('hidden');
        $('title').textContent = q.name + ' — feedback report';
        const nights = Array.isArray(body.nights) ? body.nights : [];
        renderPicker(nights, '');
        $('statusLine').textContent = nights.length ? 'Choose a raid night, or analyse across all kills.' : 'No ranked kills on Warcraft Logs for ' + q.name + ' in either tier.';
    }
    async function loadNights(force) {
        let cached = null;
        if (!force) { try { const c = JSON.parse(localStorage.getItem(nightsKey())); if (c && Array.isArray(c.nights) && Date.now() - c.fetchedAt < NIGHTS_TTL) cached = c; } catch (e) { cached = null; } }
        if (cached) { showPicker(cached); return; }
        $('statusLine').textContent = 'Reading ' + q.name + '’s raid nights from Warcraft Logs…';
        $('refreshBtn').disabled = true;
        try {
            const res = await fetch(nightsUrl());
            const body = await res.json().catch(() => ({}));
            if (res.status === 429) { showError('Warcraft Logs rate limit reached — try again in a few minutes.'); return; }
            if (!res.ok) { showError(body.error || ('HTTP ' + res.status)); return; }
            try { localStorage.setItem(nightsKey(), JSON.stringify(Object.assign({}, body, { fetchedAt: Date.now() }))); } catch (e) { /* quota: the page still renders */ }
            showPicker(body);
        } catch (err) { showError('Network error: ' + err.message); }
        finally { $('refreshBtn').disabled = false; }
    }
```

At the top of `load(force)` add as its first line:

```js
        if (!q.report && !q.all) return loadNights(force);
```

- [ ] **Step 3: Headline, title and picker inside `render`**

Replace the `$('title').textContent = …` and `$('statusLine').textContent = …` lines in `render` with:

```js
        const tiers = Array.isArray(facts.tiers) && facts.tiers.length ? facts.tiers : [facts.tier];
        $('title').textContent = facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + (facts.night && facts.night.zoneName ? facts.night.zoneName : tiers[0].zoneName);
        // logs-first A2: across kills, the two tiers' own WCL medians side by side — never a blend.
        $('statusLine').textContent = facts.night
            ? 'Raid night of ' + facts.night.date + (facts.night.zoneName ? ' (' + facts.night.zoneName + ')' : '') + ', median parse that night ' + Math.round(facts.night.medianPercent)
            : 'Median parse across kills: ' + tiers.map(t => t.zoneName + ' ' + Math.round(t.medianPercent)).join(' · ');
```

Replace the `// Night selector` block (the `const sel = $('nightSelect') …` through `sel.value = q.report; }`) with:

```js
        renderPicker(Array.isArray(facts.nights) ? facts.nights : [], q.report || (q.all ? 'all' : ''));
```

- [ ] **Step 4: Picker navigation**

Replace the `$('nightSelect').addEventListener('change', …)` line with:

```js
        $('nightSelect').addEventListener('change', e => {
            const u = new URL(location.href);
            u.searchParams.delete('report'); u.searchParams.delete('all');
            if (e.target.value === 'all') u.searchParams.set('all', '1');
            else if (e.target.value) u.searchParams.set('report', e.target.value);
            else return;
            location.href = u.toString();
        });
```

In `feedback.html` change `<div id="statusLine" class="status">Loading…</div>` to `<div id="statusLine" class="status">Reading raid nights…</div>`.

- [ ] **Step 5: Static check**

Run: `node --check feedback.js && grep -c "loadNights\|renderPicker" feedback.js`
Expected: no syntax error; count ≥ 4.

- [ ] **Step 6: Commit**

```bash
git add feedback.js feedback.html
git commit -m "feat(feedback): show the night picker before running any analysis (logs-first A4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `parseReportCode` in vet-engine

**Files:**
- Modify: `vet-engine.js` (next to `parseNameList`, ~line 456; export list ~line 489)
- Test: `vet-engine.test.js`

**Interfaces:**
- Produces: `V.parseReportCode(text) -> string | null` (browser and node).

- [ ] **Step 1: Write the failing test**

Append to `vet-engine.test.js` before its final `console.log` line:

```js
test('parseReportCode (logs-first B1): a bare code, a report URL with a fragment, anything else null', () => {
    assert.strictEqual(V.parseReportCode('X6mnbPQpGhjJC2TN'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('  X6mnbPQpGhjJC2TN\n'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN#fight=3&type=damage-done'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN/'), 'X6mnbPQpGhjJC2TN');
    assert.strictEqual(V.parseReportCode('X6mnbPQpGhjJC2T'), null);
    assert.strictEqual(V.parseReportCode('https://classic.warcraftlogs.com/character/eu/spineshatter/utopik'), null);
    assert.strictEqual(V.parseReportCode(''), null);
    assert.strictEqual(V.parseReportCode(null), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node vet-engine.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 1 FAIL (`V.parseReportCode is not a function`).

- [ ] **Step 3: Implement**

Add after `namesFromHash` in `vet-engine.js`:

```js
    // A Warcraft Logs report is a 16-character code; people paste either the bare code or a
    // report URL (…/reports/<code>#fight=3). Anything else is null.
    function parseReportCode(text) {
        const s = String(text || '').trim();
        const m = /\/reports\/([A-Za-z0-9]{16})(?:[\/?#]|$)/.exec(s) || /^([A-Za-z0-9]{16})$/.exec(s);
        return m ? m[1] : null;
    }
```

Add `parseReportCode,` to the returned export object after `namesFromHash`.

- [ ] **Step 4: Run the suite**

Run: `node vet-engine.test.js 2>&1 | tail -1`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-engine.js vet-engine.test.js
git commit -m "feat(vet-engine): parseReportCode for pasted codes and report URLs (logs-first B1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `wcl-logs.js` — guild reports and report roster

**Files:**
- Create: `wcl-logs.js`, `wcl-logs.test.js`
- Modify: `package.json` (`"test"` script)

**Interfaces:**
- Produces: `L.GUILD_REPORTS_QUERY`, `L.REPORT_META_QUERY`, `L.combatantQuery(fightIds)`, `L.fetchGuildReports(query, { guild, server, region, limit }) -> Promise<[{ code, title, date, startTime, zone }]>`, `L.fetchReportRoster(query, { code }) -> Promise<{ code, title, date, startTime, zone, guild, fights, players } | null>` where `players[i] = { name, server, classToken, combatant, fightId, fightName }`.

- [ ] **Step 1: Write the failing tests**

Create `wcl-logs.test.js`:

```js
'use strict';
const assert = require('node:assert');
const L = require('./wcl-logs.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// Shapes verified live 2026-09-07 against report X6mnbPQpGhjJC2TN (Animal Kingdom, Spineshatter EU).
const META = { title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' },
    guild: { name: 'Animal Kingdom', server: { slug: 'spineshatter', region: { slug: 'EU' } } },
    masterData: { actors: [{ id: 1, name: 'Utopik', server: 'Spineshatter', subType: 'Rogue' }, { id: 2, name: 'Sspope', server: 'Spineshatter', subType: 'Priest' }, { id: 3, name: 'Latecomer', server: 'Pyrewood Village', subType: 'Mage' }] },
    fights: [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 5, name: 'Anetheron', kill: false }, { id: 9, name: 'Archimonde', kill: true }] };
const row = (sourceID, mark) => ({ sourceID, gear: [{ id: mark }], talents: [{ id: 0 }, { id: 41 }, { id: 20 }] });
function stub(o) {
    o = Object.assign({ meta: META, combatants: { f3: [row(1, 'early'), row(2, 'early')], f5: [row(1, 'mid')], f9: [row(1, 'late'), row(3, 'late'), row(99, 'unknown-actor')] } }, o);
    const calls = [];
    return { calls, query: async (q, vars) => {
        calls.push({ q, vars });
        if (q === L.GUILD_REPORTS_QUERY) return { reportData: { reports: { data: o.reports || [] } } };
        if (q === L.REPORT_META_QUERY) return { reportData: { report: o.meta } };
        if (q.includes('CombatantInfo')) { const rep = {}; Object.keys(o.combatants).forEach(k => { rep[k] = { data: o.combatants[k] }; }); return { reportData: { report: rep } }; }
        throw new Error('unexpected query: ' + q.slice(0, 50));
    } };
}

test('combatantQuery: one CombatantInfo alias per fight in a single request', () => {
    const q = L.combatantQuery([3, 9]);
    assert.ok(q.includes('f3:events(dataType:CombatantInfo,fightIDs:[3],limit:100){data}'));
    assert.ok(q.includes('f9:events(dataType:CombatantInfo,fightIDs:[9],limit:100){data}'));
});
test('fetchGuildReports: newest first, dated, zone carried; empty answer is an empty list', async () => {
    const s = stub({ reports: [
        { code: 'fDBNk8Wm7Avjq6RJ', title: 'SSC / TK', startTime: 1788600000000, zone: { id: 1056, name: 'SSC / TK' } },
        { code: 'X6mnbPQpGhjJC2TN', title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' } },
        { code: null } ] });
    const logs = await L.fetchGuildReports(s.query, { guild: 'Animal Kingdom', server: 'spineshatter', region: 'eu' });
    assert.deepStrictEqual(logs.map(l => [l.code, l.date, l.zone.id]), [['X6mnbPQpGhjJC2TN', '2026-09-06', 1060], ['fDBNk8Wm7Avjq6RJ', '2026-09-05', 1056]]);
    assert.deepStrictEqual(s.calls[0].vars, { guild: 'Animal Kingdom', server: 'spineshatter', region: 'eu', limit: 15 });
    assert.deepStrictEqual(await L.fetchGuildReports(stub({ reports: null }).query, { guild: 'x', server: 's', region: 'eu', limit: 3 }), []);
});
test('fetchReportRoster: two requests; every encounter fight (wipes included); the latest fight\'s row wins per player', async () => {
    const s = stub();
    const r = await L.fetchReportRoster(s.query, { code: 'X6mnbPQpGhjJC2TN' });
    assert.strictEqual(s.calls.length, 2);
    assert.deepStrictEqual(s.calls[1].vars, { code: 'X6mnbPQpGhjJC2TN' });
    assert.deepStrictEqual(r.guild, { name: 'Animal Kingdom', server: 'spineshatter', region: 'eu' });
    assert.strictEqual(r.date, '2026-09-06');
    assert.deepStrictEqual(r.fights, [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 5, name: 'Anetheron', kill: false }, { id: 9, name: 'Archimonde', kill: true }]);
    assert.deepStrictEqual(r.players.map(p => [p.name, p.server, p.classToken, p.fightId, p.fightName, p.combatant.gear[0].id]), [
        ['Latecomer', 'pyrewood-village', 'MAGE', 9, 'Archimonde', 'late'],
        ['Sspope', 'spineshatter', 'PRIEST', 3, 'Rage Winterchill', 'early'],
        ['Utopik', 'spineshatter', 'ROGUE', 9, 'Archimonde', 'late']]);
});
test('fetchReportRoster: no encounter fights → one request and no players; unknown report → null', async () => {
    const s = stub({ meta: Object.assign({}, META, { fights: [] }) });
    const r = await L.fetchReportRoster(s.query, { code: 'X6mnbPQpGhjJC2TN' });
    assert.strictEqual(s.calls.length, 1);
    assert.deepStrictEqual(r.players, []);
    assert.strictEqual(await L.fetchReportRoster(stub({ meta: null }).query, { code: 'X6mnbPQpGhjJC2TN' }), null);
});
test('fetchReportRoster: a report with no guild carries guild: null', async () => {
    const r = await L.fetchReportRoster(stub({ meta: Object.assign({}, META, { guild: null }) }).query, { code: 'ktjzamNDCK2Af6TH' });
    assert.strictEqual(r.guild, null);
    assert.strictEqual(r.code, 'ktjzamNDCK2Af6TH');
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node wcl-logs.test.js`
Expected: `Cannot find module './wcl-logs.js'`.

- [ ] **Step 3: Implement**

Create `wcl-logs.js`:

```js
'use strict';
// Node-only: the "logs" side of Warcraft Logs — a guild's recent raid nights, and everything one
// report says about the players in it. The GraphQL `query` function is injected, as in
// vet-profile.js: the server passes wclQuery, the tests pass a stub. Shapes verified live
// 2026-09-07 (report X6mnbPQpGhjJC2TN: 25 players with full gear in two requests).

const GUILD_REPORTS_QUERY = 'query($guild:String!,$server:String!,$region:String!,$limit:Int!){reportData{' +
    'reports(guildName:$guild,guildServerSlug:$server,guildServerRegion:$region,limit:$limit){data{code title startTime zone{id name}}}}}';
const REPORT_META_QUERY = 'query($code:String!){reportData{report(code:$code){title startTime zone{id name} ' +
    'guild{name server{slug region{slug}}} masterData{actors(type:"Player"){id name server subType}} fights(killType:Encounters){id name kill}}}}';
// One CombatantInfo alias per fight in a single request — the same aliasing trick as
// encounterRankQuery in vet-feedback.js. limit is per alias; a 25-man raid is 25 rows.
function combatantQuery(fightIds) {
    return 'query($code:String!){reportData{report(code:$code){' +
        fightIds.map(id => 'f' + id + ':events(dataType:CombatantInfo,fightIDs:[' + id + '],limit:100){data}').join(' ') + '}}}';
}

const isoDate = ms => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : null);
// WCL's actor `server` is a display name ("Pyrewood Village"); the API wants the slug.
const slugOf = s => (s ? String(s).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : null);

async function fetchGuildReports(query, o) {
    const limit = o.limit || 15;
    const d = await query(GUILD_REPORTS_QUERY, { guild: o.guild, server: o.server, region: o.region, limit });
    const rows = d && d.reportData && d.reportData.reports && Array.isArray(d.reportData.reports.data) ? d.reportData.reports.data : [];
    return rows.filter(r => r && r.code)
        .map(r => ({ code: r.code, title: r.title || '', date: isoDate(r.startTime), startTime: r.startTime, zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null }))
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

// Everyone who was in an encounter fight of the report, with the CombatantInfo row (gear,
// talents, stats at pull) from the LATEST fight they appear in — people swap pieces and specs
// between bosses, and the night's final state is what gets vetted. Wipes count: gear worn on a
// wipe is still the gear. null when WCL does not know the report (or it is private).
async function fetchReportRoster(query, o) {
    const md = await query(REPORT_META_QUERY, { code: o.code });
    const r = md && md.reportData && md.reportData.report;
    if (!r) return null;
    const fights = (Array.isArray(r.fights) ? r.fights : []).filter(f => f && Number.isInteger(f.id)).map(f => ({ id: f.id, name: f.name, kill: !!f.kill }));
    const guild = r.guild && r.guild.name
        ? { name: r.guild.name, server: r.guild.server ? slugOf(r.guild.server.slug) : null,
            region: r.guild.server && r.guild.server.region && r.guild.server.region.slug ? String(r.guild.server.region.slug).toLowerCase() : null }
        : null;
    const out = { code: o.code, title: r.title || '', date: isoDate(r.startTime), startTime: r.startTime,
                  zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null, guild, fights, players: [] };
    if (!fights.length) return out;
    const cd = await query(combatantQuery(fights.map(f => f.id)), { code: o.code });
    const rep = cd && cd.reportData && cd.reportData.report;
    const actors = new Map(((r.masterData && r.masterData.actors) || []).map(a => [a.id, a]));
    const byActor = new Map();
    fights.forEach(f => {
        const alias = rep && rep['f' + f.id];
        (alias && Array.isArray(alias.data) ? alias.data : []).forEach(row => {
            const a = row && actors.get(row.sourceID);
            if (!a || !a.name) return;
            byActor.set(row.sourceID, { name: a.name, server: slugOf(a.server), classToken: a.subType ? String(a.subType).toUpperCase() : null,
                                        combatant: row, fightId: f.id, fightName: f.name });
        });
    });
    out.players = Array.from(byActor.values()).sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

module.exports = { GUILD_REPORTS_QUERY, REPORT_META_QUERY, combatantQuery, fetchGuildReports, fetchReportRoster };
```

In `package.json`, insert `node wcl-logs.test.js && ` immediately before `node vet-profile.test.js` in the `"test"` script.

- [ ] **Step 4: Run the suite**

Run: `node wcl-logs.test.js 2>&1 | tail -2`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add wcl-logs.js wcl-logs.test.js package.json
git commit -m "feat(wcl-logs): guild report list and a report's roster with CombatantInfo (logs-first B1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `fetchRankings` extracted; `profileFromCombatant`

**Files:**
- Modify: `vet-profile.js` (`buildProfile` ~line 55–100, `fetchProfile` ~line 102–158, exports)
- Test: `vet-profile.test.js`

**Interfaces:**
- Produces: `P.fetchRankings(query, { name, server, region, zone, classToken, talentSplit }) -> Promise<{ det, metric, rankings, rankingsZone, fallback, otherRankings, otherZone, specRankings }>`; `P.profileFromCombatant({ name, server, region, zone, classToken, combatant, report, dbIndex }) -> profile` with `parses: null, parsesPending: true`; `P.buildParses` exported.

- [ ] **Step 1: Write the failing tests**

Append to `vet-profile.test.js` before `Promise.all(pending)`:

```js
// --- logs-first B2: the rankings half on its own, and a profile from one CombatantInfo row
test('fetchRankings: the same gating and metric fetchProfile does, from class + talents alone', async () => {
    const s = stubQuery();
    const talentSplit = FX.report.combatant.talents.map(t => t.id);
    const rk = await P.fetchRankings(s.query, Object.assign({}, PARAMS, { classToken: 'SHAMAN', talentSplit }));
    assert.strictEqual(rk.det.spec, 'Enhancement');
    assert.strictEqual(rk.metric, 'dps');
    assert.strictEqual(rk.rankingsZone, 1060);
    assert.strictEqual(rk.fallback, false);
    assert.deepStrictEqual(s.calls.map(c => c.q === P.RANK_QUERY ? c.vars.zone : c.q.slice(0, 5)), [1060, 1056], 'only the two rank queries — no character or report probe');
    const parses = P.buildParses(rk.rankings, rk.rankingsZone, rk.fallback, rk.metric, rk.otherRankings, rk.otherZone);
    assert.strictEqual(parses.zoneName, 'BT / Hyjal');
    assert.strictEqual(parses.bosses.length, 14);
});
test('fetchRankings: no class or talents still detects a healer from WCL and re-ranks by hps', async () => {
    const s = stubQuery();
    const orig = s.query;
    s.query = async (q, vars) => { const d = await orig(q, vars); if (q === P.RANK_QUERY) d.characterData.character.zoneRankings.rankings.forEach(r => { r.bestSpec = 'Restoration'; r.spec = 'Restoration'; }); return d; };
    const rk = await P.fetchRankings(s.query, Object.assign({}, PARAMS, { classToken: 'SHAMAN', talentSplit: null }));
    assert.strictEqual(rk.det.role, 'healer');
    assert.strictEqual(rk.metric, 'hps');
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.metric), ['dps', 'dps', 'hps', 'hps']);
});
test('profileFromCombatant: gear, stats and spec from the row; parses pending, not missing', () => {
    const p = P.profileFromCombatant({ name: 'Nottomwro', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'SHAMAN', combatant: FX.report.combatant,
                                       report: { code: 'X6mnbPQpGhjJC2TN', startTime: 1788700000000, fightName: 'Archimonde' }, dbIndex: db });
    assert.strictEqual(p.parses, null);
    assert.strictEqual(p.parsesPending, true);
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.gearSummary.missingEnchants, 0);
    assert.deepStrictEqual(p.lastSeen, { reportCode: 'X6mnbPQpGhjJC2TN', fightName: 'Archimonde', timestamp: 1788700000000 });
    assert.ok(!p.missing.some(m => /no parses/.test(m)), 'pending parses are not reported as missing: ' + p.missing.join(' | '));
    const full = P.buildProfile({ name: 'X', server: 's', region: 'eu', zone: 1060, classToken: 'SHAMAN', combatant: null, report: null,
                                  rankings: null, rankingsZone: 1060, fallback: false, metric: 'dps', dbIndex: db });
    assert.strictEqual('parsesPending' in full, false, 'the key only appears on pending profiles');
    assert.ok(full.missing.some(m => /no parses/.test(m)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-profile.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 3 FAILs (`P.fetchRankings is not a function`, `P.profileFromCombatant is not a function`).

- [ ] **Step 3: Implement**

In `buildProfile`, change the parses line and the return:

```js
    const parses = buildParses(a.rankings, a.rankingsZone, a.fallback, a.metric, a.otherRankings || null, a.otherZone || null);
    // logs-first B2: a profile built from a report's CombatantInfo has its parses on the way, not
    // missing — the page streams them in and adds the "no parses" line itself if they come back empty.
    if (!parses && !a.parsesPending) missing.push('no parses in ' + (ZONE_NAMES[a.zone] || a.zone) + (PREVIOUS_ZONE[a.zone] ? ' or ' + ZONE_NAMES[PREVIOUS_ZONE[a.zone]] : ''));
    if (!det.spec) missing.push('spec could not be determined');
    return Object.assign({
        name: a.name, server: a.server, region: a.region, zone: a.zone,
        identity: { class: a.classToken || null, spec: det.spec, role: det.role, talentSplit, detectedFrom: det.detectedFrom },
        lastSeen, gear, gearSummary, gearOnly, reported, computed, computedFromGear, parses, missing,
    }, a.parsesPending ? { parsesPending: true } : {});
```

Replace `fetchProfile` from `const talentSplit = combatant && …` to its end with:

```js
    const talentSplit = combatant && Array.isArray(combatant.talents) ? combatant.talents.map(t => t.id) : null;
    const rk = await fetchRankings(query, { name, server, region, zone, classToken, talentSplit });
    return buildProfile(Object.assign({ name, server, region, zone, classToken, combatant, report, dbIndex }, rk));
}

// The rankings half of a profile: tier gating, spec re-detection from WCL's label and the healer
// re-rank. Split out (logs-first B2) so /api/vet/parses — which already knows class and talents
// from a report's CombatantInfo — runs exactly this and nothing else. Behaviour is fetchProfile's,
// unchanged; vet-profile.test.js's gating tests are the guard.
async function fetchRankings(query, o) {
    const { name, server, region, zone, classToken } = o;
    const talentSplit = Array.isArray(o.talentSplit) ? o.talentSplit : null;
    let det = V.detectSpec(classToken, talentSplit, null);
    let metric = det.role === 'healer' ? 'hps' : 'dps';

    async function rank(z, m) {
        const d = await query(RANK_QUERY, { name, server, region, zone: z, metric: m });
        return d && d.characterData && d.characterData.character ? d.characterData.character.zoneRankings : null;
    }
    // Always ranks both the requested zone and its previous tier, then gates on whichever has
    // kills and the higher median — a tie favours the requested zone. The non-gating tier
    // (when it has kills) is returned as the "other" tier so both stay visible. specRankings is
    // separate from gating: it's the requested zone's own blob when it has kills (the freshest
    // evidence of what the player currently plays), else the previous tier's — spec detection
    // must not follow whichever tier happens to gate the parse rule.
    async function selectGating(z, m) {
        const cur = await rank(z, m);
        const prevZone = PREVIOUS_ZONE[z];
        const prev = prevZone ? await rank(prevZone, m) : null;
        const curHas = hasKills(cur), prevHas = hasKills(prev);
        const specRankings = curHas ? cur : (prevHas ? prev : null);
        if (prevZone && prevHas && (!curHas || prev.medianPerformanceAverage > cur.medianPerformanceAverage)) {
            return { rankings: prev, rankingsZone: prevZone, fallback: true, otherRankings: cur, otherZone: z, specRankings };
        }
        return { rankings: cur, rankingsZone: z, fallback: false, otherRankings: prevZone ? prev : null, otherZone: prevZone || null, specRankings };
    }
    let g = await selectGating(zone, metric);
    if (!det.spec && hasKills(g.specRankings)) {
        const first = g.specRankings.rankings.find(r => r.totalKills > 0);
        det = V.detectSpec(classToken, talentSplit, first.bestSpec || first.spec);
        if (det.role === 'healer' && metric === 'dps') {
            // A healer's medians differ from their dps medians, so re-rank and re-gate both
            // tiers (and re-derive specRankings) rather than reusing the dps-based selection.
            metric = 'hps';
            g = await selectGating(zone, metric);
        }
    }
    return Object.assign({ det, metric }, g);
}

// logs-first B2: a profile from one report's CombatantInfo row alone — gear, stats and spec,
// no rankings yet. The vetting page fills parses in through /api/vet/parses.
function profileFromCombatant(a) {
    return buildProfile({ name: a.name, server: a.server, region: a.region, zone: a.zone, classToken: a.classToken, combatant: a.combatant, report: a.report,
                          rankings: null, rankingsZone: a.zone, fallback: false, metric: null, otherRankings: null, otherZone: PREVIOUS_ZONE[a.zone] || null,
                          specRankings: null, dbIndex: a.dbIndex, parsesPending: true });
}
```

(The old inline `rank`/`selectGating`/re-detect block inside `fetchProfile` is deleted — it now lives only in `fetchRankings`.)

Exports: `module.exports = { ZONE_NAMES, PREVIOUS_ZONE, CHAR_QUERY, REPORT_QUERY, RANK_QUERY, buildParses, buildProfile, fetchRankings, profileFromCombatant, fetchProfile };`

- [ ] **Step 4: Run the profile suite, then everything that consumes profiles**

Run: `node vet-profile.test.js 2>&1 | tail -1 && node vet-feedback.test.js 2>&1 | tail -1 && node server.test.js 2>&1 | tail -1`
Expected: three `0 failed` lines. The existing fetchProfile tests (happy path, fallback, gating, Nooze spec, healer re-rank) are the proof the extraction changed nothing.

- [ ] **Step 5: Commit**

```bash
git add vet-profile.js vet-profile.test.js
git commit -m "refactor(vet-profile): fetchRankings split out of fetchProfile; profileFromCombatant (logs-first B2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Routes — `/api/wcl/logs`, `/api/wcl/log/:code/roster`, `/api/vet/parses`

**Files:**
- Modify: `server.js` (after the `/api/vet/nights` route; `app.__test`)
- Test: `server.test.js`

**Interfaces:**
- Consumes: `WclLogs.fetchGuildReports/fetchReportRoster` (Task 6), `VetProfile.fetchRankings/buildParses/profileFromCombatant` (Task 7), `vetIdentity` (Task 3).
- Produces: `GET /api/wcl/logs?guild&server&region` → `{ logs: [...] }`; `GET /api/wcl/log/:code/roster?zone[&server&region]` → `{ report: { code, title, date, zone, guild, fights }, players: [profile] }`; `GET /api/vet/parses?name&server&region&zone[&class&talents]` → `{ parses, identity }`. Caches `logsCache`, `rosterCache`, `parsesCache` on `app.__test.caches`.

- [ ] **Step 1: Write the failing tests**

Append to `server.test.js` (after the Task 3 tests). It needs the Nottomwro fixture and the logs module — add near the top of the file, after the other requires: `const L = require('./wcl-logs.js');` and `const NOTT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));`.

```js
// --- logs-first B3: logs, roster, parses
const META = { title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' },
    guild: { name: 'Animal Kingdom', server: { slug: 'spineshatter', region: { slug: 'EU' } } },
    masterData: { actors: [{ id: 19, name: 'Nottomwro', server: 'Spineshatter', subType: 'Shaman' }, { id: 20, name: 'Sspope', server: 'Spineshatter', subType: 'Priest' }] },
    fights: [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 9, name: 'Archimonde', kill: true }] };
function logsStub(o) {
    o = Object.assign({ meta: META, rankZone: NOTT.zoneRankings }, o);
    const calls = [];
    return { calls, query: async (q, vars) => {
        calls.push({ q, vars });
        if (q === L.GUILD_REPORTS_QUERY) return { reportData: { reports: { data: [{ code: 'X6mnbPQpGhjJC2TN', title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' } }] } } };
        if (q === L.REPORT_META_QUERY) return { reportData: { report: vars.code === 'X6mnbPQpGhjJC2TN' ? o.meta : null } };
        if (q.includes('CombatantInfo')) return { reportData: { report: { f3: { data: [Object.assign({}, NOTT.report.combatant, { sourceID: 20 })] }, f9: { data: [NOTT.report.combatant] } } } };
        if (q === P.RANK_QUERY) return { characterData: { character: vars.name === 'Nobody' ? null : { zoneRankings: JSON.parse(JSON.stringify(o.rankZone[String(vars.zone)])) } } };
        throw new Error('unexpected query: ' + q.slice(0, 50));
    } };
}
test('GET /api/wcl/logs: the guild\'s recent nights, validated and cached 5 minutes', async () => {
    app.__test.resetCaches();
    const s = logsStub(); app.__test.setWclQuery(s.query);
    let res = await fetch(base + '/api/wcl/logs?guild=Animal%20Kingdom&server=spineshatter&region=eu', SAME_ORIGIN);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.logs.map(l => [l.code, l.date, l.zone.name]), [['X6mnbPQpGhjJC2TN', '2026-09-06', 'BT / Hyjal']]);
    res = await fetch(base + '/api/wcl/logs?guild=Animal%20Kingdom&server=spineshatter&region=eu', SAME_ORIGIN);
    assert.strictEqual(res.headers.get('x-vet-cache'), 'hit');
    assert.strictEqual(s.calls.length, 1);
    assert.strictEqual((await fetch(base + '/api/wcl/logs?guild=x&server=spineshatter&region=eu', SAME_ORIGIN)).status, 400);
    assert.strictEqual((await fetch(base + '/api/wcl/logs?guild=Animal%20Kingdom&server=spineshatter&region=eu', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});
test('GET /api/wcl/log/:code/roster: every player as a pending profile with scored gear; 404 for an unknown report', async () => {
    app.__test.resetCaches();
    const s = logsStub(); app.__test.setWclQuery(s.query);
    let res = await fetch(base + '/api/wcl/log/X6mnbPQpGhjJC2TN/roster?zone=1060', SAME_ORIGIN);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.report.guild, { name: 'Animal Kingdom', server: 'spineshatter', region: 'eu' });
    assert.strictEqual(body.report.date, '2026-09-06');
    assert.deepStrictEqual(body.players.map(p => [p.name, p.server, p.region, p.parsesPending, p.parses, p.identity.class, p.lastSeen.fightName]), [
        ['Nottomwro', 'spineshatter', 'eu', true, null, 'SHAMAN', 'Archimonde'], ['Sspope', 'spineshatter', 'eu', true, null, 'PRIEST', 'Rage Winterchill']]);
    assert.strictEqual(typeof body.players[0].gearSummary.gearScore, 'number');
    assert.strictEqual(s.calls.length, 2, 'meta + one aliased CombatantInfo request');
    res = await fetch(base + '/api/wcl/log/X6mnbPQpGhjJC2TN/roster?zone=1060', SAME_ORIGIN);
    assert.strictEqual(res.headers.get('x-vet-cache'), 'hit');
    assert.strictEqual((await fetch(base + '/api/wcl/log/ktjzamNDCK2Af6TH/roster', SAME_ORIGIN)).status, 404);
    assert.strictEqual((await fetch(base + '/api/wcl/log/short/roster', SAME_ORIGIN)).status, 400);
});
test('GET /api/vet/parses: rankings only — two RANK queries, parses + identity, cached; unknown character → parses null', async () => {
    app.__test.resetCaches();
    const s = logsStub(); app.__test.setWclQuery(s.query);
    const qs = 'name=Nottomwro&server=spineshatter&region=eu&zone=1060&class=SHAMAN&talents=' + NOTT.report.combatant.talents.map(t => t.id).join(',');
    let res = await fetch(base + '/api/vet/parses?' + qs, SAME_ORIGIN);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.parses.zoneName, 'BT / Hyjal');
    assert.strictEqual(body.parses.bosses.length, 14);
    assert.deepStrictEqual([body.identity.class, body.identity.spec, body.identity.role], ['SHAMAN', 'Enhancement', 'melee']);
    assert.deepStrictEqual(s.calls.map(c => c.q === P.RANK_QUERY), [true, true]);
    res = await fetch(base + '/api/vet/parses?' + qs, SAME_ORIGIN);
    assert.strictEqual(res.headers.get('x-vet-cache'), 'hit');
    assert.strictEqual((await fetch(base + '/api/vet/parses?name=Nottomwro&server=spineshatter&region=eu&talents=1,2', SAME_ORIGIN)).status, 400, 'talents must be three numbers');
    res = await fetch(base + '/api/vet/parses?name=Nobody&server=spineshatter&region=eu&zone=1060', SAME_ORIGIN);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).parses, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node server.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 3 FAILs (404 from express for unknown routes).

- [ ] **Step 3: Implement**

In `server.js`, after `const VetProfile = require('./vet-profile.js');` add `const WclLogs = require('./wcl-logs.js');`.

After the `/api/vet/nights` route add:

```js
// --- logs-first B3: vet a whole raid from the log it was in.
const LOGS_CACHE_MS = 5 * 60 * 1000;
const logsCache = new Map();   // region/server/guild -> { at, body }
const rosterCache = new Map(); // code/zone -> { at, body }
const parsesCache = new Map(); // identity key + '/parses' -> { at, body }
function cachedJson(cache, key, ttl, res) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= ttl) return false;
  res.set('X-Vet-Cache', 'hit'); res.json(hit.body);
  return true;
}
function storeJson(cache, key, ttl, res, body) {
  for (const [k, v] of cache) if (Date.now() - v.at >= ttl) cache.delete(k);
  cache.set(key, { at: Date.now(), body });
  res.set('X-Vet-Cache', 'miss'); res.json(body);
}

// The guild's recent raid nights — the log picker. One WCL request.
app.get('/api/wcl/logs', async (req, res) => {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  const guild = String(req.query.guild || '').trim();
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  if (!/^[^\/\\"]{2,48}$/.test(guild)) return res.status(400).json({ error: 'Invalid guild name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  const key = region + '/' + server + '/' + guild.toLowerCase();
  try {
    if (cachedJson(logsCache, key, LOGS_CACHE_MS, res)) return;
    const logs = await WclLogs.fetchGuildReports(wclQuery, { guild, server, region, limit: 15 });
    storeJson(logsCache, key, LOGS_CACHE_MS, res, { logs });
  } catch (err) { wclErrorResponse(res, err, 'WCL guild logs lookup'); }
});

// Everyone in one report, each as a profile with scored gear and parses pending. Two WCL requests
// for a whole raid — versus four per player through /api/vet/player.
app.get('/api/wcl/log/:code/roster', async (req, res) => {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  const code = String(req.params.code || '');
  if (!/^[A-Za-z0-9]{16}$/.test(code)) return res.status(400).json({ error: 'Invalid report code' });
  const zone = parseInt(req.query.zone, 10) || 1060;
  const fallbackServer = String(req.query.server || '').toLowerCase();
  const fallbackRegion = String(req.query.region || 'eu').toLowerCase();
  if (fallbackServer && !/^[a-z0-9-]{2,40}$/.test(fallbackServer)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(fallbackRegion)) return res.status(400).json({ error: 'Invalid region' });
  const key = code + '/' + zone;
  try {
    if (cachedJson(rosterCache, key, FEEDBACK_CACHE_MS, res)) return;
    let db;
    try { db = getVetDbIndex(); }
    catch (err) { console.error('item table load failed:', err); return res.status(500).json({ error: 'Item table data/tbc-item-db.json is missing or unreadable' }); }
    const roster = await WclLogs.fetchReportRoster(wclQuery, { code });
    if (!roster) return res.status(404).json({ error: 'Warcraft Logs could not open report ' + code });
    const region = (roster.guild && roster.guild.region) || fallbackRegion;
    const players = roster.players.map(p => VetProfile.profileFromCombatant({
      name: p.name, server: p.server || fallbackServer, region, zone, classToken: p.classToken, combatant: p.combatant,
      report: { code, startTime: roster.startTime, fightName: p.fightName }, dbIndex: db }));
    storeJson(rosterCache, key, FEEDBACK_CACHE_MS, res, {
      report: { code, title: roster.title, date: roster.date, zone: roster.zone, guild: roster.guild, fights: roster.fights }, players });
  } catch (err) { wclErrorResponse(res, err, 'WCL report roster lookup'); }
});

// The parses half of a profile for a player the page already has gear for. Optional class and
// talents (from the report's CombatantInfo) let spec detection skip the WCL-label fallback.
app.get('/api/vet/parses', async (req, res) => {
  const id = vetIdentity(req);
  if (id.error) return res.status(id.status).json({ error: id.error });
  const classToken = req.query.class ? String(req.query.class).toUpperCase() : null;
  if (classToken && !/^[A-Z]{4,8}$/.test(classToken)) return res.status(400).json({ error: 'Invalid class' });
  let talentSplit = null;
  if (req.query.talents) {
    talentSplit = String(req.query.talents).split(',').map(n => parseInt(n, 10));
    if (talentSplit.length !== 3 || talentSplit.some(n => !Number.isInteger(n) || n < 0 || n > 61)) return res.status(400).json({ error: 'Invalid talents' });
  }
  const key = id.key + '/parses';
  try {
    if (cachedJson(parsesCache, key, FEEDBACK_CACHE_MS, res)) return;
    const rk = await VetProfile.fetchRankings(wclQuery, { name: id.name, server: id.server, region: id.region, zone: id.zone, classToken, talentSplit });
    const parses = VetProfile.buildParses(rk.rankings, rk.rankingsZone, rk.fallback, rk.metric, rk.otherRankings, rk.otherZone);
    const identity = { class: classToken, spec: rk.det.spec, role: rk.det.role, talentSplit, detectedFrom: rk.det.detectedFrom };
    storeJson(parsesCache, key, FEEDBACK_CACHE_MS, res, { parses, identity });
  } catch (err) { wclErrorResponse(res, err, 'WCL parses lookup'); }
});
```

In `app.__test`: extend `resetCaches` with `logsCache.clear(); rosterCache.clear(); parsesCache.clear();` and add the three to `caches`.

- [ ] **Step 4: Run the suite**

Run: `node server.test.js 2>&1 | tail -2`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(server): /api/wcl/logs, /api/wcl/log/:code/roster, /api/vet/parses (logs-first B3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Vetting page — load from a log, parses streaming

**Files:**
- Modify: `vetting.html` (import row + realm row), `vetting.css`, `vetting.js` (state/load/save ~1–45, realm ~74–110, queue/fetchOne ~121–165, rows/renderTable ~261–330, renderSummary ~332, feedbackUrl ~346, parseBox ~424, wiring ~450–488)

**Interfaces:**
- Consumes: `/api/wcl/logs`, `/api/wcl/log/:code/roster`, `/api/vet/parses` (Task 8), `V.parseReportCode` (Task 5).
- Produces: `state.players[i].source = { report, date, zone, fightName }`, `state.players[i].server`; `wcl.guild` persisted in the shared `raidAssignmentsState.wcl` blob; Report links carry `&report=<code>` for log-loaded rows.

No DOM test runner exists; Task 10's CDP smoke verifies this page. Steps are edit → `node --check` → commit.

- [ ] **Step 1: HTML and CSS**

In `vetting.html`, after the first `.import-row` `</div>` add:

```html
            <div class="import-row log-row">
                <select id="logSelect" title="Your guild's recent raid nights on Warcraft Logs"><option value="">Recent raid nights…</option></select>
                <input id="logInput" type="text" placeholder="…or paste a report code / URL" autocomplete="off">
                <button id="loadLogBtn" class="btn btn-primary">Load from log</button>
            </div>
```

In the `.realm-row`, after the region `</select>` add:

```html
                <label for="guildInput">Guild</label>
                <input id="guildInput" type="text" placeholder="guild name" autocomplete="off" title="Warcraft Logs guild name, e.g. &quot;Animal Kingdom&quot; — fills the raid-night list">
```

Append to `vetting.css`:

```css
.log-row select { min-width: 280px; }
.log-row input { flex: 1; min-width: 240px; }
.cell-pending { color: #9ab; }
.verdict.pending { color: #9ab; }
```

- [ ] **Step 2: Guild setting**

In `vetting.js`:
- `const wcl = { server: '', region: 'eu' };` → `const wcl = { server: '', region: 'eu', guild: '' };`
- in `load()`: `if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; }` → `if (a.wcl) { wcl.server = a.wcl.server || ''; wcl.region = a.wcl.region || 'eu'; wcl.guild = a.wcl.guild || ''; }`
- in `renderRealm()`, first lines add `document.getElementById('guildInput').value = wcl.guild;`
- in `saveRealm()`: `a.wcl = Object.assign({}, a.wcl, { server: wcl.server, region: wcl.region, guild: wcl.guild });`
- in `onRealmChange()`, after the region line add `wcl.guild = document.getElementById('guildInput').value.trim();` and, as the last statement before `renderTable();`, add `refreshLogList();`.

- [ ] **Step 3: The log list and the roster loader**

Add after `takeFragment()`:

```js
// --- logs-first B4: a whole raid from one report ---
let logListFor = ''; // guild/server/region the select was last filled for
async function refreshLogList() {
    const sel = document.getElementById('logSelect');
    const want = wcl.guild && wcl.server ? wcl.region + '/' + wcl.server + '/' + wcl.guild.toLowerCase() : '';
    if (want === logListFor) return;
    logListFor = want;
    sel.innerHTML = '<option value="">' + (want ? 'Loading raid nights…' : 'Recent raid nights (set a guild)') + '</option>';
    if (!want) return;
    try {
        const res = await fetch('/api/wcl/logs?guild=' + encodeURIComponent(wcl.guild) + '&server=' + encodeURIComponent(wcl.server) + '&region=' + encodeURIComponent(wcl.region));
        const body = await res.json().catch(() => ({}));
        if (logListFor !== want) return; // settings changed while this was in flight
        if (!res.ok) { sel.innerHTML = '<option value="">' + escapeHtml(body.error || ('HTTP ' + res.status)) + '</option>'; return; }
        const logs = Array.isArray(body.logs) ? body.logs : [];
        sel.innerHTML = '<option value="">' + (logs.length ? 'Recent raid nights…' : 'No logs for ' + escapeHtml(wcl.guild)) + '</option>' +
            logs.map(l => '<option value="' + escapeHtml(l.code) + '">' + escapeHtml(l.date + ' · ' + (l.zone ? shortZoneLabel(l.zone.name) : '?') + ' · ' + l.title) + '</option>').join('');
    } catch (err) { if (logListFor === want) sel.innerHTML = '<option value="">Network error: ' + escapeHtml(err.message) + '</option>'; }
}
// Loads every player of a report into the table with a pending profile (gear now, parses
// streaming through the queue). `quiet` (Refresh all) keeps the roster notice as it is.
async function loadReport(code, opts) {
    opts = opts || {};
    const btn = document.getElementById('loadLogBtn');
    btn.disabled = true;
    if (!opts.quiet) { rosterNotice = 'Reading report ' + code + ' from Warcraft Logs…'; renderSummary(); }
    try {
        const res = await fetch('/api/wcl/log/' + encodeURIComponent(code) + '/roster?zone=' + ZONE + '&server=' + encodeURIComponent(wcl.server) + '&region=' + encodeURIComponent(wcl.region));
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) { pause(); rosterNotice = 'Warcraft Logs rate limit reached — the log was not loaded.'; renderSummary(); return false; }
        if (!res.ok) { rosterNotice = body.error || ('HTTP ' + res.status); renderSummary(); return false; }
        const rep = body.report || {};
        let added = 0;
        (body.players || []).forEach(p => {
            const r = insertPlayer(p.name);
            if (!r) return;
            if (r.added) added++;
            const key = r.name.toLowerCase();
            const player = state.players.find(pl => pl.name.toLowerCase() === key);
            player.source = { report: code, date: rep.date || null, zone: rep.zone ? rep.zone.name : null, fightName: p.lastSeen ? p.lastSeen.fightName : null };
            player.server = p.server || null;
            state.profiles[key] = p;
            delete state.errors[key];
            enqueue(r.name, true);
        });
        // The first log loaded fills in the guild when none is set — the log picker then works.
        if (!wcl.guild && rep.guild && rep.guild.name) { wcl.guild = rep.guild.name; try { saveRealm(); } catch (e) { /* notice below still shows */ } renderRealm(); refreshLogList(); }
        const summary = 'Loaded ' + (body.players || []).length + ' players from ' + (rep.date || code) + (rep.zone ? ' · ' + rep.zone.name : '') + ' (' + added + ' new). Parses are loading.';
        try { save(); if (!opts.quiet) rosterNotice = summary; }
        catch (err) { rosterNotice = summary + ' Could not save locally: ' + err.message; }
        renderTable();
        return true;
    } catch (err) { rosterNotice = 'Network error: ' + err.message; renderSummary(); return false; }
    finally { btn.disabled = false; }
}
function loadLog() {
    const typed = V.parseReportCode(document.getElementById('logInput').value);
    const code = typed || document.getElementById('logSelect').value;
    if (!code) { rosterNotice = 'Pick a raid night or paste a Warcraft Logs report code / URL.'; renderSummary(); return; }
    if (!wcl.server) { rosterNotice = 'No realm set — enter the Warcraft Logs realm slug first.'; renderSummary(); return; }
    document.getElementById('logInput').value = '';
    loadReport(code);
}
```

- [ ] **Step 4: Streaming parses through the queue**

Replace the body of `fetchOne(key)` from `try {` through the `else { state.profiles[key] = body; }` line with:

```js
    // A profile loaded from a log already has gear; only its parses are outstanding. Those come
    // from /api/vet/parses (two WCL requests) and are merged in; everything else still goes the
    // whole way through /api/vet/player.
    const existing = state.profiles[key];
    const pendingParses = !!(existing && existing.parsesPending);
    const server = player.server || wcl.server;
    try {
        const base = '?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(server) + '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE;
        const url = pendingParses
            ? '/api/vet/parses' + base + (existing.identity && existing.identity.class ? '&class=' + encodeURIComponent(existing.identity.class) : '') +
              (existing.identity && Array.isArray(existing.identity.talentSplit) && existing.identity.talentSplit.length === 3 ? '&talents=' + existing.identity.talentSplit.join(',') : '')
            : '/api/vet/player' + base;
        const res = await fetch(url);
        // Remove all (or a single ×) can run while this request is in flight; a response arriving
        // after the player is gone from state.players must not resurrect its row.
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (res.status === 429) { queue.unshift(key); pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (pendingParses) state.profiles[key] = mergeParses(existing, null, body.error || ('HTTP ' + res.status));
            else state.errors[key] = body.error || ('HTTP ' + res.status);
        }
        else if (pendingParses) { state.profiles[key] = mergeParses(existing, body, null); }
        else { state.profiles[key] = body; }
```

Replace the existing `catch (err) { … }` block with:

```js
    } catch (err) {
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (pendingParses) state.profiles[key] = mergeParses(existing, null, 'Network error: ' + err.message);
        else state.errors[key] = 'Network error: ' + err.message;
    }
```

(the guarded `save()` + `renderTable()` below stay as they are). Add above `fetchOne`:

```js
// Folds a /api/vet/parses answer into a pending profile. The result has exactly the shape
// /api/vet/player returns, so every renderer below is shared. A failed parses fetch keeps the
// gear and says why in `missing` — a row is never downgraded to "error" for parses alone.
function mergeParses(profile, body, error) {
    const parses = body && body.parses ? body.parses : null;
    const identity = profile.identity && profile.identity.spec ? profile.identity : (body && body.identity) || profile.identity;
    const missing = (profile.missing || []).filter(m => !/^no parses|^parses:/.test(m));
    if (error) missing.push('parses: ' + error);
    else if (!parses) missing.push('no parses in either tier');
    if (identity && !identity.spec && !missing.includes('spec could not be determined')) missing.push('spec could not be determined');
    const out = Object.assign({}, profile, { parses, identity, missing });
    delete out.parsesPending;
    return out;
}
```

- [ ] **Step 5: Pending overlay in rows, table and summary**

In `rows()`, replace the last two lines of the map callback with:

```js
        const ev = V.evaluate(profile, state.thresholds, now);
        // logs-first B4: gear is here, parses are streaming — shown as pending, never as
        // "unverified, no parses" while the request is still out.
        if (profile.parsesPending) return { name: p.name, key, verdict: 'unverified', pending: true, parsesPending: true, profile, rules: ev.rules, reasons: ['parses loading…'] };
        return { name: p.name, key, verdict: ev.verdict, profile, rules: ev.rules, reasons: ev.reasons };
```

In `renderTable()`, the verdict cell: replace `verdictTd.innerHTML = '<span class="verdict ' + r.realVerdict + '">' + r.realVerdict + '</span>' +` with

```js
        verdictTd.innerHTML = (r.parsesPending ? '<span class="verdict pending">…</span>' : '<span class="verdict ' + r.realVerdict + '">' + r.realVerdict + '</span>') +
```

and inside the `['gs', 'ilvl', …].forEach(k => {` loop, before `const td = ruleCell(byKey[k]);`, add:

```js
            if (k === 'parse' && r.parsesPending) { const td = document.createElement('td'); td.className = 'cell-pending'; td.textContent = '…'; td.title = 'parses loading'; tr.appendChild(td); return; }
```

In `renderSummary()`, change `const count = v => rs.filter(r => r.verdict === v).length;` to `const count = v => rs.filter(r => r.verdict === v && !r.pending).length;` (a pending row is counted once, under "fetching", not also as unverified).

In the detail panel (`parseBox`), change `} else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">No parses.</div>');` to

```js
    } else parseBox.insertAdjacentHTML('beforeend', '<div class="cell-unknown">' + (p.parsesPending ? 'Parses loading…' : 'No parses.') + '</div>');
```

- [ ] **Step 6: Report link, Refresh all, wiring**

Replace `feedbackUrl(r)` with:

```js
function feedbackUrl(r) {
    const player = state.players.find(p => p.name.toLowerCase() === r.key) || {};
    return 'feedback.html?name=' + encodeURIComponent(r.name) + '&server=' + encodeURIComponent(player.server || wcl.server) + '&region=' + encodeURIComponent(wcl.region) +
           '&zone=' + ZONE + '&thresholds=' + encodeURIComponent(JSON.stringify(state.thresholds)) +
           // logs-first B4: a row that came from a log opens its report on that night.
           (player.source && player.source.report ? '&report=' + encodeURIComponent(player.source.report) : '');
}
```

Replace the `refreshBtn` click handler with:

```js
    document.getElementById('refreshBtn').addEventListener('click', () => {
        // Rows that came from a log re-load from it (two requests per distinct report), the
        // rest re-fetch by name as before.
        const reports = Array.from(new Set(state.players.filter(p => p.source && p.source.report).map(p => p.source.report)));
        state.profiles = {}; state.errors = {}; save(); renderTable();
        state.players.filter(p => !(p.source && p.source.report)).forEach(p => enqueue(p.name, true));
        reports.forEach(code => loadReport(code, { quiet: true }));
    });
```

In the wiring block add, after the `removeAllBtn` line:

```js
    document.getElementById('loadLogBtn').addEventListener('click', loadLog);
    document.getElementById('logInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadLog(); });
    document.getElementById('guildInput').addEventListener('change', onRealmChange);
    refreshLogList();
```

- [ ] **Step 7: Static check**

Run: `node --check vetting.js && grep -c "loadReport\|mergeParses\|parsesPending" vetting.js`
Expected: no syntax error; count ≥ 10.

- [ ] **Step 8: Commit**

```bash
git add vetting.html vetting.css vetting.js
git commit -m "feat(vetting): load a whole raid from a log — gear now, parses streaming (logs-first B4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Headless-Chrome smoke of both pages, README, full suite

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/stub-server.js`, `<scratchpad>/logs-first-smoke.mjs`
- Modify: `README.md` (vetting and feedback bullets)

**Interfaces:**
- Consumes: everything above. `server.js` exports `app` and `app.__test.setWclQuery` when required rather than run.

- [ ] **Step 1: A stub server with a slow rankings answer**

Write `<scratchpad>/stub-server.js` (replace `<scratchpad>` with the scratchpad path from your system prompt; `REPO` below is the repo root):

```js
'use strict';
const REPO = '/Users/maxvanzoelen/wowstuff';
const fs = require('fs'), path = require('path'), http = require('http');
const app = require(REPO + '/server.js');
const P = require(REPO + '/vet-profile.js'), F = require(REPO + '/vet-feedback.js'), L = require(REPO + '/wcl-logs.js');
const NOTT = JSON.parse(fs.readFileSync(path.join(REPO, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
const RANK_DELAY_MS = 1500; // long enough for the smoke to observe the pending state
const META = { title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' },
    guild: { name: 'Animal Kingdom', server: { slug: 'spineshatter', region: { slug: 'EU' } } },
    masterData: { actors: [{ id: 19, name: 'Nottomwro', server: 'Spineshatter', subType: 'Shaman' }, { id: 20, name: 'Sspope', server: 'Spineshatter', subType: 'Shaman' }] },
    fights: [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 9, name: 'Archimonde', kill: true }] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.__test.setWclQuery(async (q, vars) => {
    if (q === L.GUILD_REPORTS_QUERY) return { reportData: { reports: { data: [{ code: 'X6mnbPQpGhjJC2TN', title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' } }] } } };
    if (q === L.REPORT_META_QUERY) return { reportData: { report: META } };
    if (q.includes('CombatantInfo')) return { reportData: { report: { f3: { data: [Object.assign({}, NOTT.report.combatant, { sourceID: 20 })] }, f9: { data: [NOTT.report.combatant] } } } };
    if (q === P.RANK_QUERY) { await sleep(RANK_DELAY_MS); return { characterData: { character: { zoneRankings: JSON.parse(JSON.stringify(NOTT.zoneRankings[String(vars.zone)])) } } }; }
    if (q === P.CHAR_QUERY) return { characterData: { character: { id: NOTT.character.id, classID: NOTT.character.classID, recentReports: NOTT.character.recentReports } } };
    if (q === P.REPORT_QUERY) return { reportData: { report: { masterData: { actors: NOTT.report.actors }, events: { data: vars.code === NOTT.report.code ? [NOTT.report.combatant] : [] } } } };
    if (q.includes('encounterRankings(')) {
        const ch = {};
        (q.match(/e\d+:/g) || []).forEach(a => { ch[a.slice(0, -1)] = { ranks: [] }; });
        ch.e50618 = { ranks: [{ rankPercent: 45.5, startTime: 1788700000000, report: { code: 'X6mnbPQpGhjJC2TN', fightID: 3 } }] };
        ch.e100730 = { ranks: [{ rankPercent: 86.9, startTime: 1788600000000, report: { code: 'fDBNk8Wm7Avjq6RJ', fightID: 1 } }] };
        return { characterData: { character: ch } };
    }
    throw new Error('stub: unexpected query ' + q.slice(0, 60));
});
app.__test.setOpenaiChat(async () => { throw new Error('no model'); });
http.createServer(app).listen(3999, '127.0.0.1', () => console.log('stub on http://127.0.0.1:3999'));
```

Run it in the background: `node <scratchpad>/stub-server.js &` and confirm `curl -s 'http://127.0.0.1:3999/api/wcl/logs?guild=Animal%20Kingdom&server=spineshatter&region=eu'` prints one log.

- [ ] **Step 2: The CDP driver**

Write `<scratchpad>/logs-first-smoke.mjs`:

```js
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:3999';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=/tmp/logs-first-smoke-profile', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const waiting = new Map();
async function connect() {
    for (let i = 0; i < 120; i++) {
        try { const list = await (await fetch('http://127.0.0.1:9333/json')).json(); const page = list.find(t => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch (e) { /* not up yet */ }
        await sleep(1000);
    }
    if (!ws) throw new Error('chrome did not come up');
    await new Promise(r => { ws.onopen = r; });
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
}
function send(method, params) { return new Promise(r => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); }); }
async function evaluate(expr) { const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.text + ' ' + JSON.stringify(m.result.exceptionDetails.exception)); return m.result.result.value; }
async function open(url) { await send('Page.navigate', { url }); await sleep(800); for (let i = 0; i < 20; i++) { if (await evaluate('document.readyState') === 'complete') return; await sleep(250); } }
async function until(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evaluate(expr)) return; await sleep(150); } throw new Error('timeout: ' + label); }
const checks = []; const ok = (cond, label) => { checks.push([!!cond, label]); console.log((cond ? 'ok   ' : 'FAIL ') + label); };
try {
    await connect();
    await send('Page.enable'); await send('Runtime.enable');
    // --- Feedback page: bare URL shows the picker and makes NO analysis request.
    await open(BASE + '/feedback.html?name=Nottomwro&server=spineshatter&region=eu&zone=1060');
    await evaluate('performance.clearResourceTimings()');
    await until('document.getElementById("nightSelect").options.length > 1', 15000, 'picker rendered');
    const opts = await evaluate('Array.from(document.getElementById("nightSelect").options).map(o => o.textContent)');
    ok(opts[1] === 'Across all kills', 'picker has Across all kills: ' + JSON.stringify(opts));
    ok(opts.some(t => t.includes('2026-09-06') && t.includes('BT')) && opts.some(t => t.includes('SSC')), 'nights from both tiers listed');
    ok(await evaluate('document.getElementById("statusLine").textContent') === 'Choose a raid night, or analyse across all kills.', 'status asks for a choice');
    ok(!(await evaluate('performance.getEntriesByType("resource").some(e => e.name.includes("/api/vet/feedback"))')), 'no /api/vet/feedback request on the bare URL');
    ok(await evaluate('document.getElementById("cards").children.length') === 0, 'no report cards rendered');
    // --- Vetting page: load from log → rows appear with gear before any parse arrives.
    await open(BASE + '/vetting.html');
    await evaluate('localStorage.clear(); localStorage.setItem("raidAssignmentsState", JSON.stringify({ wcl: { server: "spineshatter", region: "eu", guild: "Animal Kingdom" } })); location.reload(); true');
    await sleep(1200);
    await until('document.getElementById("logSelect").options.length > 1', 10000, 'guild log list filled');
    await evaluate('document.getElementById("logInput").value = "https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN#fight=3"; document.getElementById("loadLogBtn").click(); true');
    await until('document.querySelectorAll("#vetBody tr").length === 2', 10000, 'two rows from the log');
    const gsCells = await evaluate('Array.from(document.querySelectorAll("#vetBody tr")).map(tr => tr.children[3].textContent)');
    ok(gsCells.every(t => t && t !== '?' && t !== '—'), 'GearScore cells filled from the log: ' + JSON.stringify(gsCells));
    const pendingCells = await evaluate('Array.from(document.querySelectorAll("#vetBody tr")).map(tr => tr.children[8].textContent)');
    ok(pendingCells.every(t => t === '…'), 'parse cells pending before rankings arrive: ' + JSON.stringify(pendingCells));
    ok((await evaluate('document.getElementById("summary").textContent')).includes('fetching'), 'summary counts pending rows as fetching');
    await until('Array.from(document.querySelectorAll("#vetBody tr")).every(tr => tr.children[8].textContent !== "…")', 15000, 'parses streamed in');
    const verdicts = await evaluate('Array.from(document.querySelectorAll("#vetBody .verdict")).map(e => e.textContent)');
    ok(verdicts.length === 2 && verdicts.every(v => ['pass', 'warn', 'fail', 'unverified'].includes(v)), 'verdicts resolved after parses (no … left): ' + JSON.stringify(verdicts));
    const href = await evaluate('document.querySelector("#vetBody a.report-link") ? document.querySelector("#vetBody a.report-link").getAttribute("href") : ""');
    ok(href.includes('report=X6mnbPQpGhjJC2TN'), 'Report link carries the night: ' + href);
    ok(await evaluate('document.getElementById("guildInput").value') === 'Animal Kingdom', 'guild persisted');
} catch (e) { console.error('ERROR', e.message); checks.push([false, e.message]); }
const failed = checks.filter(c => !c[0]).length;
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
chrome.kill();
process.exit(failed ? 1 : 0);
```

Run: `node <scratchpad>/logs-first-smoke.mjs` (Chrome cold start can take a while; allow up to three minutes).
Expected: every line `ok`, final `N passed, 0 failed`. A `FAIL` names the exact expectation; fix the page code (not the smoke) and re-run.

- [ ] **Step 3: Stop the stub server**

`kill %1` (or `pkill -f stub-server.js`).

- [ ] **Step 4: README**

In `README.md`, replace the "Player vetting page" bullet's first sentence so it reads:

```
- Player vetting page (`vetting.html`): type a character name, load the roster, or **load a whole
  raid from a Warcraft Logs report** (pick one of your guild's recent nights, or paste a report
  code / URL) — gear, hit, enchants and sockets appear at once from that log's combatant data and
  parses stream in behind them. Each row gets a pass / warn / fail / unverified verdict against
  editable thresholds. Gear is scored primarily with GearScore
```

and in the Feedback report sub-bullet, replace the sentence starting `Optional \`report=<WCL report code>\`` with:

```
    The page opens on a night picker listing every raid night from both tiers (BT / Hyjal and
    SSC / TK); choosing one runs the analysis for that night, "Across all kills" runs it over
    both tiers. `report=<WCL report code>` in the URL (which a Report link from a log-loaded
    vetting row carries) opens straight onto that night.
```

- [ ] **Step 5: Full suite**

Run: `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: every suite `… passed, 0 failed`, no `FAIL` lines.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: vetting from a log and the picker-first feedback report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Plan self-review

**Spec coverage:** A1 → Task 1; A2 → Task 2 + Task 4 headline; A3 → Tasks 2–3; A4 → Task 4; B1 → Tasks 5–6; B2 → Task 7; B3 → Task 8; B4 → Task 9 (guild field, log control, pending overlay, streaming, Refresh all, Report link, `lastSeen`); error handling section → Task 8 (404/429 mapping), Task 9 (`loadReport` 429/404/network, `mergeParses` failure keeps gear), Task 4 (nights with no kills); testing section items 1–5 → Tasks 1–2, 7, 6, 3+8, 10.

**Type consistency:** `killedBosses` rows carry `zone`/`zoneName` (Task 1) and `buildNights` copies them (Tasks 1–2, used by Task 4's `shortTier(n.zoneName)`). `fetchRankings` returns `{ det, metric, rankings, rankingsZone, fallback, otherRankings, otherZone, specRankings }` (Task 7) and Task 8 reads exactly those. `profileFromCombatant` output has `parsesPending: true` (Task 7); Task 8 asserts it, Task 9's `fetchOne`/`rows()` branch on it, `mergeParses` deletes it. `vetIdentity` returns `key` (Task 3) and Task 8 appends `/parses` to it. `player.source.report` is set in Task 9's `loadReport` and read by `feedbackUrl` and Refresh all.
