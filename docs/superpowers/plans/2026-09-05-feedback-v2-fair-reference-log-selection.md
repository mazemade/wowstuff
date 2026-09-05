# Feedback Report v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feedback report compare against same-gear players from the middle of the leaderboard (with the band's best as a ceiling), analyse two pulls per boss, let the leader pick a raid night, flag burst cooldowns used outside Bloodlust, and stop the model from dropping findings.

**Architecture:** All measurement stays in `vet-feedback.js` (Node-only, injected `query`), the route in `server.js` gains one optional parameter and a wider cache key, and `vetting.js` gains a night selector. Every number the model sees comes from the facts sheet; the prompt only changes what it is told to include. Tests are the hand-rolled `assert` runners already in the repo; WCL is stubbed from the captured fixture plus deep-cloned modifications and small synthetic leaderboards.

**Tech Stack:** Node 18+, Express 4, vanilla browser JS, no new npm dependencies, headless Chrome over CDP for the browser smoke.

**Spec:** `docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md` (v2). It extends `docs/superpowers/specs/2026-09-04-parse-feedback-report-design.md` (v1); read both.

## Global Constraints

- No new npm dependencies. Node 18+ (`fetch`, `AbortSignal.timeout`, `WebSocket` in Node 22 for the smoke).
- `vet-feedback.js` stays Node-only; the GraphQL `query` function is injected (server passes `wclQuery`, tests pass stubs).
- Never regenerate `fixtures/wcl-feedback-rotminster.json`. Tests that need data the fixture lacks (buff `bands`, extra ranks, extra pages) build it on a deep clone (`JSON.parse(JSON.stringify(FX))`) inside the test file.
- Every existing test that reads the untouched fixture keeps its assertions verbatim unless a task below names the assertion and its new value.
- Paste the real `N passed, M failed` line from `node vet-feedback.test.js`, `node server.test.js` or `npm test` at every verification step. Never claim a step passed without it.
- Stage only the files each task names. Never stage `RaidAssign/Scan.lua`, `raid-spec-scan.test.lua`, any `.local.md` plan, or the screenshot in the repo root.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- WCL costs points (3600 per hour per client, measured 2026-09-05: ranking page 2, fight context 9, player tables 5). Tasks 9's live steps spend them; nothing else does.
- Report texts and finding texts are plain text; the number guard `checkNumbers` must keep accepting replies built from the sheet.

---

### Task 1: Leaderboard geometry helpers

**Files:**
- Modify: `vet-feedback.js` (the `REF` constant at line 10; new functions placed immediately before `findRefEntry`, around line 783; `module.exports` at the end)
- Test: `vet-feedback.test.js` (append a new section before the `// --- Task 8: orchestration` comment)

**Interfaces:**
- Consumes: `refPageQuery(encounterId, className, specName, region, page)` (existing, hoisted).
- Produces: `REF.topPages = 3`, `REF.maxSearchPages = 64`, `REF.lengthCacheMs = 7 days`; `globalRank(page, index)`; `middlePageOrder(L, maxPages)`; `pageFetcher(query, encounterId, wclClass, specName, region)` returning `fetchPage(page) → Promise<{ page, hasMorePages, rankings }>` memoised per page; `findLastPage(fetchPage, maxPages) → Promise<number>`.

- [ ] **Step 1: Write the failing tests**

Append to `vet-feedback.test.js`, just above the line `// --- Task 8: orchestration`:

```js
// --- v2 Task 1: leaderboard geometry (spec v2 §3)
// A synthetic leaderboard: `pages` pages of 100 ranks, DPS falling with rank, item level cycling
// through `levels` so every band is spread evenly across the board. `calls` records the page
// numbers asked for, in order. Past the last page WCL answers with no `rankings` key at all.
function leaderboard(pages, levels) {
    const calls = [];
    const query = async q => {
        const page = +/page:(\d+)/.exec(q)[1];
        calls.push(page);
        if (page > pages) return { worldData: { encounter: { characterRankings: { page, hasMorePages: false, count: 0 } } } };
        const rankings = Array.from({ length: 100 }, (_, i) => {
            const rank = (page - 1) * 100 + i + 1;
            return { name: 'P' + rank, class: 'Warlock', spec: 'Destruction', amount: 5000 - rank, duration: 100000,
                     bracketData: levels[rank % levels.length], startTime: 1, report: { code: 'R' + rank, fightID: 1 } };
        });
        return { worldData: { encounter: { characterRankings: { page, hasMorePages: page < pages, count: 100, rankings } } } };
    };
    return { calls, query };
}
test('middlePageOrder: outward from the middle, clipped to the leaderboard and the page budget', () => {
    assert.deepStrictEqual(F.middlePageOrder(20, 5), [10, 11, 9, 12, 8]);
    assert.deepStrictEqual(F.middlePageOrder(3, 5), [2, 3, 1]);
    assert.deepStrictEqual(F.middlePageOrder(2, 5), [1, 2]);
    assert.deepStrictEqual(F.middlePageOrder(1, 5), [1]);
    assert.deepStrictEqual(F.middlePageOrder(20, 2), [10, 11]);
    assert.strictEqual(F.globalRank(1, 0), 1);
    assert.strictEqual(F.globalRank(10, 99), 1000);
});
test('findLastPage: binary search over hasMorePages finds the length in at most 6 page reads; the page memo never re-reads', async () => {
    const lb = leaderboard(20, [124]);
    const fetchPage = F.pageFetcher(lb.query, 1, 'Warlock', 'Destruction', 'eu');
    assert.strictEqual(await F.findLastPage(fetchPage, F.REF.maxSearchPages), 20);
    assert.ok(lb.calls.length <= 6, 'pages read: ' + lb.calls.join(','));
    const before = lb.calls.length;
    await fetchPage(20); await fetchPage(20);
    assert.strictEqual(lb.calls.length, before, 'memoised');
    const one = leaderboard(1, [124]);
    assert.strictEqual(await F.findLastPage(F.pageFetcher(one.query, 1, 'Warlock', 'Destruction', 'eu'), F.REF.maxSearchPages), 1);
    const empty = leaderboard(0, [124]);
    assert.strictEqual(await F.findLastPage(F.pageFetcher(empty.query, 1, 'Warlock', 'Destruction', 'eu'), F.REF.maxSearchPages), 1, 'an empty leaderboard reads as one (empty) page');
    const past = await F.pageFetcher(empty.query, 1, 'Warlock', 'Destruction', 'eu')(5);
    assert.deepStrictEqual(past, { page: 5, hasMorePages: false, rankings: [] }, 'a page past the end (no rankings key) reads as empty and last');
    assert.strictEqual(F.REF.topPages, 3);
    assert.strictEqual(F.REF.lengthCacheMs, 7 * 24 * 60 * 60 * 1000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -8`
Expected: the two new tests print `FAIL -` (`F.middlePageOrder is not a function`), the summary line reads `61 passed, 2 failed`.

- [ ] **Step 3: Implement**

In `vet-feedback.js` replace the `REF` line with:

```js
// Reference selection (spec v2 §3): same spec, same boss, same region, item level within `band`
// of the player (widened once to `wideBand` when fewer than `min` ranks are found), taken from
// the MIDDLE of the leaderboard, whose length is found by a binary search over at most
// `maxSearchPages` pages and cached for `lengthCacheMs`. `topPages` bounds the ceiling read.
const REF = { band: 2, wideBand: 4, target: 8, min: 3, players: 3, maxPages: 5, cacheMs: 24 * 60 * 60 * 1000,
              topPages: 3, maxSearchPages: 64, lengthCacheMs: 7 * 24 * 60 * 60 * 1000 };
```

Immediately before the `// Important 4: scan for an existing cache entry` comment that precedes `findRefEntry`, add:

```js
// --- Leaderboard geometry (spec v2 §3). characterRankings pages hold 100 ranks and carry no
// total, so the leaderboard's length L (its last non-empty page) is found by a binary search over
// hasMorePages; the middle rank is then 50·L.
function globalRank(page, index) { return (page - 1) * 100 + index + 1; }
// Pages to read for the benchmark, nearest the middle first: mid, mid+1, mid-1, mid+2, mid-2, …
function middlePageOrder(L, maxPages) {
    const mid = Math.max(1, Math.round(L / 2));
    const out = [];
    for (let d = 0; d <= L && out.length < maxPages; d++) {
        (d === 0 ? [mid] : [mid + d, mid - d]).forEach(p => { if (p >= 1 && p <= L && !out.includes(p) && out.length < maxPages) out.push(p); });
    }
    return out;
}
// One WCL fetch per page per reference build: the length walk, the benchmark pages and the
// ceiling pages overlap on short leaderboards, and every page costs 2 points. A page past the
// end (WCL answers with no `rankings` key) reads as empty and last.
function pageFetcher(query, encounterId, wclClass, specName, region) {
    const memo = new Map();
    return page => {
        if (!memo.has(page)) {
            memo.set(page, query(refPageQuery(encounterId, wclClass, specName, region, page), {}).then(d => {
                const cr = d && d.worldData && d.worldData.encounter && d.worldData.encounter.characterRankings;
                return cr && Array.isArray(cr.rankings) ? { page, hasMorePages: !!cr.hasMorePages, rankings: cr.rankings } : { page, hasMorePages: false, rankings: [] };
            }));
        }
        return memo.get(page);
    };
}
async function findLastPage(fetchPage, maxPages) {
    let lo = 1, hi = maxPages, last = 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cr = await fetchPage(mid);
        if (cr.rankings.length) { last = mid; if (!cr.hasMorePages) return mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return last;
}
```

Add `globalRank, middlePageOrder, pageFetcher, findLastPage` to `module.exports` (anywhere in the list).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -3`
Expected: `63 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): leaderboard geometry — length by binary search, pages outward from the middle, memoised page reads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Reference from the middle of the leaderboard, ceiling from the top

**Files:**
- Modify: `vet-feedback.js` — `referenceSummary` (line ~294), `getReference` (line ~795 to ~855), the `"Comparable players"` line in `buildPrompt` (line ~686), `module.exports`
- Modify: `vet-feedback.test.js` — `stubQuery` (line ~610), the tests named below, one new test
- Modify: `server.test.js` — `stubQuery` (line ~52)

**Interfaces:**
- Consumes: Task 1's `pageFetcher`, `findLastPage`, `middlePageOrder`, `globalRank`, `REF.*`.
- Produces: `referenceSummary(ranks, players, dbIndex, classToken, role, band, topDps)` — seventh argument optional; the summary gains `benchmark: 'median'` and uses `topDps` when it is a number. `leaderboardLength(fetchPage, o, lenKey)`. `getReference` unchanged signature and return shape `{ summary, note, band }`.

- [ ] **Step 1: Add the mid-leaderboard fixture helper to both test files and switch the stubs to it**

The captured fixture's reference `players` are the three highest-DPS in-band parses (v1's rule). Under v2 the reference players are the in-band parses nearest the middle, so the stub's pages must place those same three captured players at the middle or the stub would be asked for reports it does not hold. In `vet-feedback.test.js`, directly above `function stubQuery(fx)`, add:

```js
// v2 §3: the reference players are the in-band ranks nearest the MIDDLE of the leaderboard. The
// fixture was captured under v1 (top three in band), so rebuild its pages around the three
// captured players: page 1 = 97 out-of-band filler rows + the three players (global ranks
// 98–100, the middle of a two-page board is rank 100), page 2 = 3 filler rows + every other
// captured rank. Filler is item level 60: outside any band the tests use, even widened.
function midFixture() {
    const fx = JSON.parse(JSON.stringify(FX));
    Object.keys(fx.reference).forEach(enc => {
        const ref = fx.reference[enc];
        const rows = ref.pages.flatMap(p => p.rankings);
        const isPlayer = r => ref.players.some(p => p.rank.name === r.name && p.rank.report.code === r.report.code);
        const players = ref.players.map(p => rows.find(r => r.name === p.rank.name && r.report.code === p.rank.report.code));
        const others = rows.filter(r => !isPlayer(r));
        const filler = i => ({ name: 'Filler' + i, class: 'Warlock', spec: 'Destruction', amount: 1, duration: 100000, bracketData: 60, startTime: 1, report: { code: 'FILLER', fightID: i } });
        ref.pages = [
            { page: 1, hasMorePages: true, count: 100, rankings: Array.from({ length: 97 }, (_, i) => filler(i)).concat(players) },
            { page: 2, hasMorePages: false, count: 3 + others.length, rankings: Array.from({ length: 3 }, (_, i) => filler(100 + i)).concat(others) },
        ];
    });
    return fx;
}
const MID = midFixture();
```

Then change the first line of `stubQuery` from `fx = fx || FX;` to `fx = fx || MID;`.

In test `fetchFeedback (task-rep-kill): a boss with several ranks …` change `const fx2 = JSON.parse(JSON.stringify(FX));` to `const fx2 = JSON.parse(JSON.stringify(MID));`.

In `server.test.js`, paste the same `midFixture` function (with its comment) directly above `function stubQuery()`, add `const MID = midFixture();` after it, and inside `stubQuery` replace the three uses of `FX.` (`FX.kills`, `FX.reference` twice, `FX.encounterRankings`) with `MID.`.

- [ ] **Step 2: Update the assertions the new page walk changes, and add the new test**

In `vet-feedback.test.js`:

1. Test `fetchFeedback: two kills analysed, references from page 1, cache reused on the second run`: replace the line `assert.strictEqual(pageCalls.length, 2, 'page 1 already holds 8 in-band ranks for each boss');` with:
```js
    // v2 §3: per boss, the length walk over 64 pages reaches the fixture's 2-page board in 5
    // reads (32, 16, 8, 4, 2 — page 2 is non-empty with hasMorePages:false), the benchmark then
    // reads page 1 (6th), and the ceiling re-reads page 1 from the memo. Two bosses → 12.
    assert.strictEqual(pageCalls.length, 12, 'pages asked: ' + pageCalls.map(c => /page:(\d+)/.exec(c.q)[1]).join(','));
    assert.strictEqual(facts.kills[1].reference.benchmark, 'median');
    assert.strictEqual(facts.kills[1].reference.topDps, Math.round(Math.max(...MID.reference['50619'].players.map(p => p.rank.amount))), 'the ceiling is the best in-band DPS on the top pages: the three players are the only in-band rows on page 1');
```
   and rename the test to `fetchFeedback: two kills analysed, references built around the middle of the board, cache reused on the second run`.
2. Test `getReference: widens once when the band is thin, gives a note when still too few, shares in-flight work`: replace `assert.strictEqual(pageCalls, 2, 'one page fetch for the first call, one shared fetch for the pair');` with:
```js
    // This stub answers every page number with the same page and hasMorePages:false. If that
    // page is non-empty the length walk stops at its first probe (32) and the benchmark reads 5
    // pages outward from 16; if it is empty the walk probes 32,16,8,4,2,1 and the benchmark reads
    // page 1 from the memo. Six page fetches per reference build either way; the widened pass
    // and the ceiling always hit the memo. 6 for `none`, 6 shared by the pair.
    assert.strictEqual(pageCalls, 12, 'six page fetches for the first call, six shared by the pair');
```
3. Add, after the widen test:
```js
test('getReference (v2 §3): reference players are the in-band ranks nearest the middle, not the top; dps is their median; the ceiling is the band\'s best', async () => {
    // Item levels cycle 120/124/128 by rank, so for a 124 player only ranks ≡ 1 (mod 3) are in
    // band. On a 20-page board the middle is rank 1000: nearest in-band are 1000, 997, 1003, …
    const lb = leaderboard(20, [120, 124, 128]);
    const fights = [];
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) { fights.push(vars.c); return { reportData: { report: { masterData: { actors: [{ id: 7, name: 'P' + vars.c.slice(1), subType: 'Warlock' }] }, fights: [{ id: 1, startTime: 0, endTime: 100000, kill: true }] } } }; }
        if (q === F.PLAYER_QUERY) return { reportData: { report: { dmg: null, casts: null, buffs: null, ci: null } } };
        return lb.query(q, vars);
    };
    const ref = await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now() });
    assert.deepStrictEqual(fights, ['R1000', 'R997', 'R1003'], 'nearest the middle first, ties toward the higher rank');
    assert.strictEqual(ref.summary.playersCompared, 3);
    assert.strictEqual(ref.summary.sampleSize, 8);
    assert.strictEqual(ref.summary.dps, 4002, 'median of amounts 4012,4009,4006,4003,4000,3997,3994,3991');
    assert.strictEqual(ref.summary.topDps, 4999, 'rank 1 is in band: the ceiling comes from page 1, not from the benchmark ranks');
    assert.strictEqual(ref.summary.benchmark, 'median');
    assert.deepStrictEqual(ref.summary.itemLevelBand, [122, 126]);
    assert.deepStrictEqual(lb.calls, [32, 16, 24, 20, 10, 1], 'length walk, one benchmark page (page 10 holds 33 in-band ranks), one ceiling page');
});
test('getReference (v2 §3): the leaderboard length is cached for a week and shared across bands', async () => {
    const lb = leaderboard(20, [120, 124, 128]);
    const query = async (q, vars) => {
        if (q === F.FIGHT_QUERY) return { reportData: { report: null } };
        return lb.query(q, vars);
    };
    const refCache = new Map(), now = Date.now();
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache, now });
    const before = lb.calls.length;
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 128, dbIndex: db, refCache, now: now + 1000 });
    assert.deepStrictEqual(lb.calls.slice(before), [10, 1], 'a different band re-reads only the benchmark and ceiling pages, never the length walk');
    assert.strictEqual(refCache.get('len:1/WARLOCK/Destruction/eu/').value, 20);
    await F.getReference(query, { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 100, dbIndex: db, refCache, now: now + F.REF.lengthCacheMs + 1 });
    assert.ok(lb.calls.slice(before + 2).includes(32), 'after a week the length is walked again');
});
test('buildPrompt (v2 §3): "comparable players" are defined as the middle of the leaderboard at the player\'s item level', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/middle of the leaderboard/.test(p.system) && /reference\.topDps/.test(p.system), p.system);
});
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c "^FAIL"; node vet-feedback.test.js 2>&1 | tail -1`
Expected: the three new tests and the two changed ones fail (`5` FAIL lines, e.g. `benchmark` undefined, `pageCalls` 2 not 12); summary `61 passed, 5 failed`. `node server.test.js` still `10 passed, 0 failed` (the mid fixture holds the same players).

- [ ] **Step 4: Implement**

In `referenceSummary`, change the signature to `function referenceSummary(ranks, players, dbIndex, classToken, role, band, topDps) {` and in its returned object replace the `dps: …, topDps: …,` line with:

```js
        dps: Math.round(median(amounts)),
        // v2 §3: the ceiling comes from the top pages (getReference) when given; the median over
        // the benchmark ranks is what "comparable players" do.
        topDps: typeof topDps === 'number' ? topDps : (amounts.length ? Math.round(Math.max.apply(null, amounts)) : null),
        benchmark: 'median',
```

Immediately before `async function getReference(query, o) {` add:

```js
// v2 §3: the leaderboard length is independent of item level, so it is cached per (boss, class,
// spec, region) for a week under a key shape ('len:' + prefix) that findRefEntry's band scan
// never matches. A pending walk is stored as-is so concurrent bands share it.
async function leaderboardLength(fetchPage, o, lenKey) {
    const hit = o.refCache.get(lenKey);
    if (hit && o.now - hit.at < REF.lengthCacheMs) return hit.value;
    const pending = findLastPage(fetchPage, REF.maxSearchPages);
    o.refCache.set(lenKey, { at: o.now, value: pending });
    try { const L = await pending; o.refCache.set(lenKey, { at: o.now, value: L }); return L; }
    catch (e) { o.refCache.delete(lenKey); throw e; }
}
```

Replace the body of the `pending = (async () => { … })();` IIFE inside `getReference` (from `const pages = [];` through the `return { summary: referenceSummary(…), note: null, band };` line) with:

```js
        const fetchPage = pageFetcher(query, o.encounterId, wclClass, wclSpecName(o.spec), o.region);
        const L = await leaderboardLength(fetchPage, o, 'len:' + prefix);
        const middle = 50 * L;
        // Benchmark: in-band ranks read outward from the middle page, ordered by distance from
        // the middle rank (ties toward the higher-ranked, i.e. lower globalRank).
        const collect = async band => {
            let found = [];
            for (const p of middlePageOrder(L, REF.maxPages)) {
                const cr = await fetchPage(p);
                found = found.concat(bandRanks(cr.rankings, o.itemLevel, band).map(r => Object.assign({ globalRank: globalRank(p, cr.rankings.indexOf(r)) }, r)));
                if (found.length >= REF.target) break;
            }
            return found.sort((a, b) => (Math.abs(a.globalRank - middle) - Math.abs(b.globalRank - middle)) || (a.globalRank - b.globalRank));
        };
        let band = REF.band;
        let ranks = await collect(band);
        if (ranks.length < REF.min) { band = REF.wideBand; ranks = await collect(band); }
        if (ranks.length < REF.min) return { summary: null, note: 'too few same-item-level parses to compare against', band };
        ranks = ranks.slice(0, REF.target);
        // Ceiling: the band's best DPS from the top pages, at most REF.topPages of them.
        let topDps = null;
        for (let p = 1; p <= Math.min(REF.topPages, L) && topDps === null; p++) {
            const ib = bandRanks((await fetchPage(p)).rankings, o.itemLevel, band);
            if (ib.length) topDps = Math.round(Math.max.apply(null, ib.map(r => r.amount)));
        }
        const players = [];
        for (const r of ranks.slice(0, REF.players)) {
            // Important 5: a reference player's report can come back as a GraphQL error (deleted
            // or restricted report) rather than the handled `report: null`. Skip that player
            // instead of failing the whole reference — and the whole request behind it — but a
            // 429 still aborts everything (spec §3.2).
            try {
                const got = await fightAndTables(query, r.report.code, r.report.fightID, r.name);
                if (got) players.push({ rank: r, sourceID: got.sourceId, context: got.ctx, tables: got.tables });
            } catch (e) {
                if (e && e.code === 'RATE_LIMIT') throw e;
            }
        }
        return { summary: referenceSummary(ranks, players, o.dbIndex, o.classToken, o.role, [o.itemLevel - band, o.itemLevel + band], topDps), note: null, band };
```

Also update the comment above `getReference` (the two lines starting `// Reference per (boss, class, spec, region, band).`) to: `// Reference per (boss, class, spec, region, band), built around the MIDDLE of the leaderboard (spec v2 §3). Shared across every player of that spec, so it is cached for a day and an in-flight fetch is handed to concurrent callers.`

In `buildPrompt`, replace the line

```js
        '"Comparable players" means players of the same spec on the same boss within the item-level band in each kill\'s reference.itemLevelBand.',
```
with
```js
        '"Comparable players" means players of the same spec on the same boss, at the player\'s item level (each kill\'s reference.itemLevelBand), who parse around the middle of the leaderboard (reference.benchmark is "median"). reference.topDps is what the best players at that item level reach on that boss.',
```

Add `leaderboardLength` to `module.exports`.

- [ ] **Step 5: Run both suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `66 passed, 0 failed` and `10 passed, 0 failed`. If `referenceSummary on Anetheron` fails on `topDps`, you changed the fallback: it must still be the max over `ranks` when the seventh argument is absent.

- [ ] **Step 6: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js server.test.js
git commit -m "feat(feedback): compare against same-gear players from the middle of the leaderboard; band's best as the ceiling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Two pulls per boss

**Files:**
- Modify: `vet-feedback.js` — new `KILLS_PER_BOSS` and `pickRanks` after `pickRank` (line ~100), the per-target body of `fetchFeedback` (line ~870–895), `mergeFindings` (line ~535), `positives` (line ~574), `buildFacts` `badPulls` (line ~625), `module.exports`
- Modify: `docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md` §4 (one bullet)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `pickRank(ranks, medianPercent)` (existing).
- Produces: `KILLS_PER_BOSS = 2`; `pickRanks(ranks, medianPercent) → rank[]` (representative first, then the most recent when different); `facts.kills` may hold several entries per boss; `overall.badPulls[i].date`; the "pulls" wording rule below.

- [ ] **Step 1: Write the failing tests**

Add after the `pickRank:` tests (around line 95):

```js
test('pickRanks (v2 §4): the representative rank plus the most recent one, deduplicated, at most KILLS_PER_BOSS', () => {
    const oldest = { rankPercent: 5, duration: 100000, startTime: 100, report: { code: 'A', fightID: 1 } };
    const rep = { rankPercent: 30, duration: 100000, startTime: 200, report: { code: 'B', fightID: 1 } };
    const newest = { rankPercent: 90, duration: 100000, startTime: 300, report: { code: 'C', fightID: 1 } };
    assert.strictEqual(F.KILLS_PER_BOSS, 2);
    assert.deepStrictEqual(F.pickRanks([oldest, rep, newest], 31).map(r => r.report.code), ['B', 'C'], 'representative first, then the most recent');
    assert.deepStrictEqual(F.pickRanks([oldest, rep], 31).map(r => r.report.code), ['B'], 'the most recent rank here is the representative itself, so one pull');
    assert.deepStrictEqual(F.pickRanks([oldest, newest], 89).map(r => r.report.code), ['C']);
    assert.deepStrictEqual(F.pickRanks([rep], 31).map(r => r.report.code), ['B']);
    assert.deepStrictEqual(F.pickRanks([], 31), []);
});
```

Add after the `mergeFindings: the same finding on two bosses …` test:

```js
test('mergeFindings / positives (v2 §4): two pulls of one boss count as pulls and name the date; one pull per boss keeps the v1 wording', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { date: '2026-09-01' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.count, 2);
    assert.strictEqual(crit.measuredOn, 'Anetheron (' + a.date + ')');
    assert.ok(crit.text.endsWith(' (numbers measured on Anetheron (' + a.date + '); seen on 2 of 2 pulls)'), crit.text);
    const pos = F.positives([a, b], 'caster');
    assert.ok(pos.includes('Active 90%+ on every pull'), pos.join(' | '));
    assert.ok(pos.includes('No deaths on any of the 2 pulls'), pos.join(' | '));
    const one = F.positives([a, Object.assign({}, a, { name: 'Archimonde' })], 'caster');
    assert.ok(one.includes('Active 90%+ on every boss'), 'one pull per boss: v1 wording untouched');
});
```

Add after the `fetchFeedback (task-rep-kill) …` test:

```js
test('fetchFeedback (v2 §4): a boss with several ranks analyses the representative AND the most recent pull; one-rank bosses are unchanged', async () => {
    const fx2 = JSON.parse(JSON.stringify(MID));
    const az = FX.kills['50620'];
    const original = fx2.encounterRankings['50619'].ranks[0];
    // The most recent decoy resolves to Kaz'rogal's real report so it fetches like a genuine kill.
    fx2.encounterRankings['50619'].ranks.push(
        { rankPercent: 90, duration: 90000, amount: 4000, bracketData: 124, spec: 'Destruction', startTime: original.startTime + 100000, report: { code: az.code, fightID: az.fightID } },
        { rankPercent: 5, duration: 95000, amount: 500, bracketData: 118, spec: 'Destruction', startTime: original.startTime - 100000, report: { code: 'FAKE_OLDEST_NEVER_FETCHED', fightID: 999 } },
    );
    const s = stubQuery(fx2);
    const facts = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.deepStrictEqual(facts.kills.map(k => [k.name, k.killIndex, k.killsOnBoss]), [["Kaz'rogal", 1, 1], ['Anetheron', 2, 3], ['Anetheron', 3, 3]], 'worst parse first; the representative (2nd oldest) and the most recent (3rd) Anetheron pulls');
    assert.strictEqual(s.calls.filter(c => c.q === F.FIGHT_QUERY && c.vars.c === 'FAKE_OLDEST_NEVER_FETCHED').length, 0, 'the oldest decoy is neither representative nor most recent');
    const bad = facts.overall.badPulls.find(b => b.name === 'Anetheron');
    assert.ok(bad && bad.date === new Date(original.startTime + 100000).toISOString().slice(0, 10), 'the decoy pull is Kaz\'rogal\'s 1131 s fight, a bad pull, listed with its date');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -1`
Expected: `66 passed, 3 failed`.

- [ ] **Step 3: Implement**

After `pickRank` add:

```js
// v2 §4: analyse up to KILLS_PER_BOSS pulls per boss — the representative rank (pickRank) and
// the most recent one, deduplicated — so a habit can be told from a one-off.
const KILLS_PER_BOSS = 2;
function pickRanks(ranks, medianPercent) {
    const rep = pickRank(ranks, medianPercent);
    if (!rep) return [];
    const recent = ranks.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
    return (recent && recent !== rep ? [rep, recent] : [rep]).slice(0, KILLS_PER_BOSS);
}
```

In `fetchFeedback`, replace everything inside the `mapLimit(targets, 3, async t => { … })` callback with:

```js
        const blob = ch['e' + t.encounterId];
        const ranks = blob && Array.isArray(blob.ranks) ? blob.ranks.filter(r => r && r.report && r.report.code) : [];
        const chosen = pickRanks(ranks, t.medianPercent);
        const byTime = ranks.slice().sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        const out = [];
        for (const rank of chosen) {
            // Which pull (oldest first) this rank is, so the facts table can say "kill 3 of 7".
            const killIndex = byTime.indexOf(rank) + 1;
            // Important 5: a report that errors (a GraphQL error on a deleted/restricted report, not
            // the already-handled `report: null`) drops this one pull instead of 502ing the whole
            // request. A 429 anywhere still aborts everything (spec §3.2).
            try {
                const got = await fightAndTables(query, rank.report.code, rank.report.fightID, profile.name);
                if (!got) continue;
                const ref = (limited || !id.class || !id.spec || typeof rank.bracketData !== 'number') ? { summary: null, note: null }
                    : await getReference(query, { encounterId: t.encounterId, classToken: id.class, spec: id.spec, role, region: profile.region, itemLevel: rank.bracketData, dbIndex, refCache, now });
                out.push(killFacts({ encounterId: t.encounterId, name: t.name, rank, killsOnBoss: ranks.length, killIndex, context: got.ctx, tables: got.tables, sourceId: got.sourceId, player, reference: ref.summary, referenceNote: ref.note, dbIndex }));
            } catch (err) {
                if (err && err.code === 'RATE_LIMIT') throw err;
                out.push({ dropped: true, name: t.name, reason: (err && err.message) ? err.message : 'WCL error fetching this kill' });
            }
        }
        return out;
```

and change the two lines after the `mapLimit` call to read from the flattened list:

```js
    const flat = results.flat();
    const kills = flat.filter(k => k && !k.dropped);
    const droppedKills = flat.filter(k => k && k.dropped).map(k => ({ name: k.name, reason: k.reason }));
```

In `mergeFindings`, after `const live = kills.filter(k => !k.fight.badPull);` add:

```js
    // v2 §4: with more than one pull of a boss in the sheet, counts are over pulls and the
    // measured-on label carries the pull's date; with one pull per boss the v1 wording stands.
    const multi = new Set(live.map(k => k.name)).size < live.length;
    const unit = multi ? 'pulls' : 'bosses';
    const label = k => (multi && live.filter(x => x.name === k.name).length > 1) ? k.name + ' (' + k.date + ')' : k.name;
```

change `else byId.set(id, Object.assign({}, fd, { count: 1, bosses: [k.name], measuredOn: k.name }));` to use `measuredOn: label(k)`, and change the suffix line to:

```js
    merged.forEach(f => { if (f.count > 1) f.text += ' (numbers measured on ' + f.measuredOn + '; seen on ' + f.count + ' of ' + live.length + ' ' + unit + ')'; });
```

In `positives`, after `const n = live.length;` add `const multi = new Set(live.map(k => k.name)).size < n; const unit = multi ? 'pulls' : 'bosses', one = multi ? 'pull' : 'boss';` and replace the wording:

- `'Active 90%+ on every boss'` → `'Active 90%+ on every ' + one`
- `'Active 90%+ on ' + activeKills.length + ' of ' + n + ' bosses'` → `… + ' ' + unit`
- `'No deaths on any of the ' + n + ' bosses'` → `… + ' ' + unit`
- `'No deaths on ' + noDeathKills.length + ' of ' + n + ' bosses'` → `… + ' ' + unit`
- the two stat lines ending `' on every boss'` / `' of ' + n + ' bosses'` → `' on every ' + one` / `' of ' + n + ' ' + unit`

(The flask lines already say "pulls"; leave them.)

In `buildFacts`, change the `badPulls` map to `({ name: k.name, date: k.date, rankPercent: k.rankPercent, reason: k.fight.badPullReason })`.

Add `KILLS_PER_BOSS, pickRanks` to `module.exports`.

In the spec §4, change the bullet beginning "`mergeFindings` counts across **pulls**" to: "`mergeFindings` counts across **pulls** whenever the sheet holds more than one pull of any boss: the suffix reads "seen on N of M pulls" and `measuredOn` becomes "`<boss>` (`<date>`)" for a boss with several pulls. With one pull per boss the v1 wording ("bosses", boss name only) is kept verbatim."

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `69 passed, 0 failed`; `10 passed, 0 failed`. The existing `buildFacts: the sheet the model reads` assertion `badPulls.map(b => b.name)` still holds (it maps names only).

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md
git commit -m "feat(feedback): analyse the representative and the most recent pull of each boss; counts and positives over pulls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Raid nights list and report mode in the pipeline

**Files:**
- Modify: `vet-feedback.js` — new `NIGHT_LIMIT` + `buildNights` before `fetchFeedback`; `fetchFeedback` targets and result; `buildFacts` (`nights`, `night`); `buildPrompt` header rule; `module.exports`
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: Task 3's per-target loop (`chosen`), `round1`, `median`.
- Produces: `buildNights(rankBlobs, bosses) → night[]` with `{ code, date, bosses: [{ encounterId, name, rankPercent }], medianPercent }`; `fetchFeedback(query, o)` accepts `o.report` (16-char code or null) and returns `{ noKills: true }` when the code matches no rank; `facts.nights`, `facts.night` (`{ code, date, medianPercent } | null`).

- [ ] **Step 1: Write the failing tests**

Add after the Task 3 `fetchFeedback (v2 §4)` test:

```js
// v2 §5: a fixture clone where Anetheron has a second kill inside Kaz'rogal's report, so the two
// captured reports form two raid nights, Kaz'rogal's being the newer.
function twoNights() {
    const fx2 = JSON.parse(JSON.stringify(MID));
    const az = FX.kills['50620'];
    const anet = fx2.encounterRankings['50619'].ranks[0];
    const later = anet.startTime + 100000;
    fx2.encounterRankings['50620'].ranks[0].startTime = later;
    fx2.encounterRankings['50619'].ranks.push({ rankPercent: 90, duration: 90000, amount: 4000, bracketData: 124, spec: 'Destruction', startTime: later + 5000, report: { code: az.code, fightID: az.fightID } });
    return fx2;
}
test('buildNights (v2 §5.1): kills grouped by report code, newest first, bosses worst first, with the night\'s median', () => {
    const fx2 = twoNights();
    const ch = { e50619: fx2.encounterRankings['50619'], e50620: fx2.encounterRankings['50620'] };
    const nights = F.buildNights(ch, [{ encounterId: 50619, name: 'Anetheron' }, { encounterId: 50620, name: "Kaz'rogal" }]);
    const kazCode = FX.kills['50620'].code, anetCode = FX.kills['50619'].code;
    const kazPct = F.round1(FX.encounterRankings['50620'].ranks[0].rankPercent);
    assert.deepStrictEqual(nights.map(n => n.code), [kazCode, anetCode]);
    assert.strictEqual(nights[0].date, new Date(fx2.encounterRankings['50620'].ranks[0].startTime).toISOString().slice(0, 10), 'the earliest kill of the night dates it');
    assert.deepStrictEqual(nights[0].bosses.map(b => b.name), ["Kaz'rogal", 'Anetheron']);
    assert.strictEqual(nights[0].medianPercent, F.round1((kazPct + 90) / 2));
    assert.deepStrictEqual(nights[1].bosses.map(b => [b.name, b.rankPercent]), [['Anetheron', F.round1(FX.encounterRankings['50619'].ranks[0].rankPercent)]]);
    assert.strictEqual(F.NIGHT_LIMIT, 10);
    assert.deepStrictEqual(F.buildNights({}, [{ encounterId: 1, name: 'X' }]), []);
});
test('fetchFeedback (v2 §5): the default sheet lists the nights; report=<code> analyses only that night; an unknown code gives noKills', async () => {
    const fx2 = twoNights();
    const kazCode = FX.kills['50620'].code;
    const s = stubQuery(fx2);
    const all = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(all.night, null);
    assert.deepStrictEqual(all.nights.map(n => n.code), [kazCode, FX.kills['50619'].code]);
    const night = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now(), report: kazCode });
    assert.deepStrictEqual(night.kills.map(k => [k.name, k.reportCode, k.killIndex, k.killsOnBoss]), [["Kaz'rogal", kazCode, 1, 1], ['Anetheron', kazCode, 2, 2]], 'only that report\'s ranks, worst first');
    assert.deepStrictEqual(night.night, { code: kazCode, date: all.nights[0].date, medianPercent: all.nights[0].medianPercent });
    assert.deepStrictEqual(night.nights.map(n => n.code), all.nights.map(n => n.code), 'the list rides along in night mode too');
    assert.deepStrictEqual(await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now(), report: 'ZZZZZZZZZZZZZZZZ' }), { noKills: true });
});
test('fetchFeedback (v2 §5.1): encounterRankings is asked for every killed boss of the zone, not only the picked ones', async () => {
    const rankings = { medianPerformanceAverage: 20, bestPerformanceAverage: 20, rankings: Array.from({ length: 10 }, (_, i) => (
        { encounter: { id: 50600 + i, name: 'B' + i }, medianPercent: 10 + i, rankPercent: 10 + i, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' })) };
    const profile = P.buildProfile({ name: 'Rotminster', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'WARLOCK', combatant: null, report: null,
                                     rankings, rankingsZone: 1060, fallback: false, metric: 'dps', otherRankings: null, otherZone: 1056, specRankings: rankings, dbIndex: db });
    const s = stubQuery();
    await F.fetchFeedback(s.query, { profile, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    const q = s.calls.find(c => c.q.includes('encounterRankings(')).q;
    assert.strictEqual((q.match(/encounterRankings\(/g) || []).length, 10, 'ten killed bosses, ten aliases, although only KILL_LIMIT are analysed');
});
test('buildPrompt (v2 §5.2): the header rule covers the raid-night case', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false, night: { code: 'X', date: '2026-09-01', medianPercent: 20 }, nights: [] });
    assert.deepStrictEqual(facts.night, { code: 'X', date: '2026-09-01', medianPercent: 20 });
    assert.deepStrictEqual(facts.nights, []);
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/raid night of/.test(p.system) && /median parse that night/.test(p.system), p.system);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -1`
Expected: `69 passed, 4 failed`.

- [ ] **Step 3: Implement**

Before `fetchFeedback` (after `mapLimit`/`fightAndTables`) add:

```js
// v2 §5.1: the player's raid nights — every kill of the zone grouped by report code — read off
// the same encounterRankings answer the pipeline already needs. Newest first, capped.
const NIGHT_LIMIT = 10;
function buildNights(rankBlobs, bosses) {
    const byCode = new Map();
    (bosses || []).forEach(b => {
        const blob = rankBlobs && rankBlobs['e' + b.encounterId];
        (blob && Array.isArray(blob.ranks) ? blob.ranks : []).forEach(r => {
            if (!r || !r.report || !r.report.code) return;
            const n = byCode.get(r.report.code) || { code: r.report.code, startTime: Infinity, bosses: [] };
            n.startTime = Math.min(n.startTime, typeof r.startTime === 'number' ? r.startTime : Infinity);
            n.bosses.push({ encounterId: b.encounterId, name: b.name, rankPercent: round1(r.rankPercent) });
            byCode.set(r.report.code, n);
        });
    });
    const pct = b => (b.rankPercent == null ? 101 : b.rankPercent);
    return Array.from(byCode.values()).sort((a, b) => b.startTime - a.startTime).slice(0, NIGHT_LIMIT).map(n => ({
        code: n.code, date: isFinite(n.startTime) ? new Date(n.startTime).toISOString().slice(0, 10) : null,
        bosses: n.bosses.slice().sort((a, b) => pct(a) - pct(b)),
        medianPercent: round1(median(n.bosses.map(b => b.rankPercent))),
    }));
}
```

In `fetchFeedback`:

1. Replace `const targets = pickKills(profile); if (!targets.length) return null;` with:
```js
    // v2 §5.1: rankings for every killed boss of the zone (the nights list needs them all), not
    // only the KILL_LIMIT picked for analysis.
    const killed = profile.parses.bosses.filter(b => b && b.kills > 0 && b.encounterId).map(b => ({ encounterId: b.encounterId, name: b.name, medianPercent: b.medianPercent }));
    if (!killed.length) return null;
```
2. Replace `const er = await query(encounterRankQuery(targets.map(t => t.encounterId), …` with `const er = await query(encounterRankQuery(killed.map(t => t.encounterId), profile.parses.metric), { … same variables … });`
3. After `if (!ch) return null;` add:
```js
    const nights = buildNights(ch, killed);
    const ranksOf = t => { const blob = ch['e' + t.encounterId]; return blob && Array.isArray(blob.ranks) ? blob.ranks.filter(r => r && r.report && r.report.code) : []; };
    let targets, night = null;
    if (o.report) {
        // v2 §5.2: one raid night — every boss with a kill in that report, worst first.
        targets = killed.map(t => Object.assign({ rank: ranksOf(t).find(r => r.report.code === o.report) }, t)).filter(t => t.rank)
            .sort((a, b) => (a.rank.rankPercent == null ? 101 : a.rank.rankPercent) - (b.rank.rankPercent == null ? 101 : b.rank.rankPercent)).slice(0, KILL_LIMIT);
        if (!targets.length) return { noKills: true };
        const n = nights.find(x => x.code === o.report);
        night = { code: o.report, date: n ? n.date : null, medianPercent: n ? n.medianPercent : null };
    } else {
        targets = pickKills(profile);
    }
    if (!targets.length) return null;
```
4. In the per-target loop, replace `const ranks = blob && …` and `const chosen = pickRanks(ranks, t.medianPercent);` with:
```js
        const ranks = ranksOf(t);
        const chosen = t.rank ? [t.rank] : pickRanks(ranks, t.medianPercent);
```
   (remove the now-unused `const blob = …` line).
5. Change the final `return buildFacts({ profile, player, kills, thresholds, now, limited, droppedKills });` to `return buildFacts({ profile, player, kills, thresholds, now, limited, droppedKills, nights, night });`.

In `buildFacts`, destructure `nights, night` too and add to the returned object, after `limited: !!limited,`:

```js
        nights: Array.isArray(o.nights) ? o.nights : [],
        night: o.night || null,
```

In `buildPrompt`, replace `'1. One header line: name, spec, tier, median parse percentile.',` with:

```js
        '1. One header line: name, spec, tier, then "median parse P" using tier.medianPercent — or, when night is not null, "raid night of <night.date>, median parse that night P" using night.medianPercent.',
```

Add `NIGHT_LIMIT, buildNights` to `module.exports`.

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `73 passed, 0 failed`; `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): raid-night list from the rankings, and report=<code> analyses one night

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Route: `report` parameter, separate cache keys, 404 for an unknown night

**Files:**
- Modify: `server.js` — `/api/vet/feedback` handler (line ~232–345)
- Test: `server.test.js`

**Interfaces:**
- Consumes: Task 4's `fetchFeedback(…, { report })` and `{ noKills: true }`.
- Produces: `GET /api/vet/feedback?…&report=<16 alphanumerics>`; 400 `Invalid report code`; 404 `No kills in that report`; cache and in-flight keys `region/server/name/zone/all` and `…/night/<code>`.

- [ ] **Step 1: Write the failing tests**

In `server.test.js`, make `stubQuery` accept a fixture: change `function stubQuery() {` to `function stubQuery(fx) { fx = fx || MID;` and inside it replace the four `MID.` uses with `fx.`; make `setupPipeline(openaiReply, fx)` pass `fx` through: `const s = stubQuery(fx);`. Add, before the final `Promise`/exit block, a `twoNights()` helper identical to the one in `vet-feedback.test.js` Task 4 (copy it, including its comment) and these tests:

```js
test('GET /api/vet/feedback (v2 §5.2): report= must be 16 alphanumerics', async () => {
    setupPipeline();
    const r = await fetch(`${base}/api/vet/feedback?${QS}&report=abc`, SAME_ORIGIN);
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(await r.json(), { error: 'Invalid report code' });
});
test('GET /api/vet/feedback (v2 §5.2): a night is analysed and cached apart from the default report', async () => {
    const s = setupPipeline(null, twoNights());
    const kazCode = FX.kills['50620'].code;
    const all = await (await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN)).json();
    assert.strictEqual(all.facts.night, null);
    assert.strictEqual(all.facts.nights.length, 2, 'the default response lists the nights');
    const r1 = await fetch(`${base}/api/vet/feedback?${QS}&report=${kazCode}`, SAME_ORIGIN);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.headers.get('x-vet-cache'), 'miss', 'a night is its own pipeline run');
    const night = await r1.json();
    assert.strictEqual(night.facts.night.code, kazCode);
    assert.ok(night.facts.kills.length === 2 && night.facts.kills.every(k => k.reportCode === kazCode));
    const calls = s.calls.length;
    const r2 = await fetch(`${base}/api/vet/feedback?${QS}&report=${kazCode}`, SAME_ORIGIN);
    assert.strictEqual(r2.headers.get('x-vet-cache'), 'hit');
    const r3 = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r3.headers.get('x-vet-cache'), 'hit', 'the default report is still cached too');
    assert.strictEqual(s.calls.length, calls, 'no WCL traffic for either cache hit');
});
test('GET /api/vet/feedback (v2 §5.2): an unknown report code is 404', async () => {
    setupPipeline();
    const r = await fetch(`${base}/api/vet/feedback?${QS}&report=ZZZZZZZZZZZZZZZZ`, SAME_ORIGIN);
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(await r.json(), { error: 'No kills in that report' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node server.test.js 2>&1 | tail -1`
Expected: `10 passed, 3 failed`.

- [ ] **Step 3: Implement**

In the handler, after the `region` validation add:

```js
  // v2 §5.2: an optional raid night. WCL report codes are 16 alphanumerics.
  const report = req.query.report ? String(req.query.report) : null;
  if (report && !/^[A-Za-z0-9]{16}$/.test(report)) return res.status(400).json({ error: 'Invalid report code' });
```

Change the key line to:

```js
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone + '/' + (report ? 'night/' + report : 'all');
```

and extend the comment above it with one sentence: `The night (report code) is part of the identity: a night's sheet and the across-kills sheet are different pipeline runs.`

Pass `report` into the pipeline: `pending = VetFeedback.fetchFeedback(wclQuery, { profile, dbIndex, refCache: feedbackRefCache, thresholds: {}, now: Date.now(), report });`

After `if (!facts) return res.status(404).json({ error: 'No kills to analyse' });` add:

```js
      if (facts.noKills) return res.status(404).json({ error: 'No kills in that report' });
```

- [ ] **Step 4: Run the suite**

Run: `node server.test.js 2>&1 | tail -1`
Expected: `13 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(feedback): report=<code> selects a raid night; cached and de-duplicated apart from the default sheet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Burst cooldowns against the Bloodlust window

**Files:**
- Modify: `vet-feedback.js` — new `BURST_MAX_SEC`, `POTION_LABEL`, `auraBands`, `burstStats` after `buffUptime` (line ~213); `referenceSummary` (per-player `burst` and the summary's `burst`); `killFacts` (`me.burst`); `consumableFindings`; `rotationFindings` wording; `module.exports`
- Modify: spec v2 §6 bullet (b)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `castCounts`, `buffUptime`, `finding`, `T`.
- Produces: `burstStats(buffsTable, castsTable) → [{ name, uses, insideBloodlust }]`; `me.burst`; `reference.burst` (majority, medians); finding key `burst_outside_bloodlust`; `ability_unused` wording for on-use items.

- [ ] **Step 1: Write the failing tests**

Add after the `buffUptime:` test:

```js
test('burstStats (v2 §6): on-use items and potions are short self-buffs that also appear as casts; procs and long buffs are not bursts', () => {
    const s = x => x * 1000;
    const buffs = { data: { totalTime: s(180), auras: [
        { name: 'Bloodlust', totalUptime: s(40), totalUses: 1, bands: [{ startTime: s(100), endTime: s(140) }] },
        { name: 'Destruction', totalUptime: s(15), totalUses: 1, bands: [{ startTime: s(110), endTime: s(125) }] },
        { name: 'Blessing of the Silver Crescent', totalUptime: s(40), totalUses: 2, bands: [{ startTime: s(10), endTime: s(30) }, { startTime: s(150), endTime: s(170) }] },
        { name: 'Fel Armor', totalUptime: s(180), totalUses: 1, bands: [{ startTime: 0, endTime: s(180) }] },
        { name: 'Spell Haste', totalUptime: s(6), totalUses: 1, bands: [{ startTime: s(112), endTime: s(118) }] },
    ] } };
    const casts = { data: { entries: [{ name: 'Destruction', total: 1 }, { name: 'Blessing of the Silver Crescent', total: 2 }, { name: 'Fel Armor', total: 1 }, { name: 'Shadow Bolt', total: 40 }] } };
    assert.deepStrictEqual(F.burstStats(buffs, casts), [
        { name: 'Destruction', uses: 1, insideBloodlust: 1 },
        { name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 0 },
    ]);
    assert.deepStrictEqual(F.burstStats(null, casts), []);
    assert.deepStrictEqual(F.burstStats({ data: { totalTime: 1, auras: [] } }, casts), []);
    assert.strictEqual(F.POTION_LABEL.Destruction, 'Destruction Potion');
});
```

Add after the `consumableFindings: no flask or elixirs …` test:

```js
// v2 §6: the captured fixture's auras carry no `bands` (slimmed at capture). Build them on a
// clone: Rotminster's real Bloodlust window on Anetheron ran 14.7 s to 54.7 s into the fight.
function withBands(rotBlessingInside) {
    const fx2 = JSON.parse(JSON.stringify(FX));
    const k = fx2.kills['50619'];
    const t0 = k.context.fights[0].startTime;
    const band = (a, b) => ({ startTime: t0 + a * 1000, endTime: t0 + b * 1000 });
    const set = (auras, name, bands) => { const a = auras.find(x => x.name === name); if (a) a.bands = bands; };
    set(k.tables.buffs.data.auras, 'Bloodlust', [band(14.7, 54.7)]);
    set(k.tables.buffs.data.auras, 'Destruction', [band(16, 31)]);
    set(k.tables.buffs.data.auras, 'Blessing of the Silver Crescent', [rotBlessingInside ? band(20, 40) : band(70, 90)]);
    fx2.reference['50619'].players.forEach(p => {
        const f0 = p.context.fights[0].startTime;
        const pb = (a, b) => ({ startTime: f0 + a * 1000, endTime: f0 + b * 1000 });
        const auras = p.tables.buffs.data.auras;
        const ensure = (name, bands) => { let a = auras.find(x => x.name === name); if (!a) { a = { name, totalUptime: 1, totalUses: 1 }; auras.push(a); } a.bands = bands; };
        ensure('Bloodlust', [pb(10, 50)]);
        ensure('Destruction', [pb(12, 27)]);
        ensure('Blessing of the Silver Crescent', [pb(15, 35)]);
        const casts = p.tables.casts.data.entries;
        ['Destruction', 'Blessing of the Silver Crescent'].forEach(n => { if (!casts.some(c => c.name === n)) casts.push({ name: n, total: 1 }); });
    });
    return fx2;
}
function killWithBands(fx2) {
    const K = fx2.kills['50619'], R = fx2.reference['50619'];
    const ranks = R.pages.flatMap(p => p.rankings);
    const reference = F.referenceSummary(F.bandRanks(ranks, 124, 2).slice(0, 8), R.players, db, 'WARLOCK', 'caster', [122, 126]);
    return F.killFacts({ encounterId: 50619, name: 'Anetheron', rank: fx2.encounterRankings['50619'].ranks[0], context: K.context, tables: K.tables, sourceId: K.sourceID, player: PLAYER, reference, referenceNote: null, dbIndex: db });
}
test('burst timing (v2 §6): a burst used only outside Bloodlust, where comparable players use it inside, is a minor player finding', () => {
    const kill = killWithBands(withBands(false));
    const byName = (a, b) => a.name.localeCompare(b.name);   // aura order in the tables is not part of the contract
    assert.deepStrictEqual(kill.me.burst.slice().sort(byName), [{ name: 'Blessing of the Silver Crescent', uses: 1, insideBloodlust: 0 }, { name: 'Destruction', uses: 1, insideBloodlust: 1 }]);
    assert.deepStrictEqual(kill.reference.burst.slice().sort(byName), [{ name: 'Blessing of the Silver Crescent', uses: 1, insideBloodlust: 1 }, { name: 'Destruction', uses: 1, insideBloodlust: 1 }]);
    const f = kill.findings.filter(x => x.key === 'burst_outside_bloodlust');
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].text, 'Used Blessing of the Silver Crescent once on Anetheron, never inside Bloodlust; comparable players line it up with Bloodlust');
    assert.deepStrictEqual([f[0].severity, f[0].scope, f[0].ability], ['minor', 'player', 'Blessing of the Silver Crescent']);
});
test('burst timing (v2 §6): inside the window, or a fight with no Bloodlust, gives no finding', () => {
    assert.deepStrictEqual(killWithBands(withBands(true)).findings.filter(x => x.key === 'burst_outside_bloodlust'), []);
    const fx2 = withBands(false);
    const lust = fx2.kills['50619'].tables.buffs.data.auras.find(a => a.name === 'Bloodlust');
    lust.totalUptime = 0; lust.bands = [];
    const kill = killWithBands(fx2);
    assert.strictEqual(kill.me.bloodlustPercent, 0);
    assert.deepStrictEqual(kill.findings.filter(x => x.key === 'burst_outside_bloodlust'), []);
});
test('rotationFindings (v2 §6): an on-use item the reference uses and the player never did reads "Never used … (on-use item)", a potion by its potion name', () => {
    const kill = killWithBands(withBands(true));
    const casts = Object.assign({}, kill.me.casts);
    delete casts['Blessing of the Silver Crescent'];
    delete casts.Destruction;
    const f = F.rotationFindings(Object.assign({}, kill, { me: Object.assign({}, kill.me, { casts }) }));
    const item = f.find(x => x.key === 'ability_unused' && x.ability === 'Blessing of the Silver Crescent');
    assert.ok(item && /^Never used Blessing of the Silver Crescent \(on-use item\) on Anetheron; comparable players use it [\d.]+ times a minute$/.test(item.text), item && item.text);
    const potion = f.find(x => x.key === 'ability_unused' && x.ability === 'Destruction');
    assert.ok(potion && /^Never used Destruction Potion on Anetheron; comparable players use it [\d.]+ times a minute$/.test(potion.text), potion && potion.text);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | tail -1`
Expected: `73 passed, 4 failed`.

- [ ] **Step 3: Implement**

After `buffUptime` add:

```js
// --- Burst timing (spec v2 §6). A burst is a short self-buff the player triggers — an on-use
// item or a potion. Both show as a cast of the same name (WCL names a potion cast after its
// effect: the fixture's Casts table has "Destruction: 1" for a Destruction Potion) and as an aura
// with one band per use. Procs have no cast; long buffs (armors) fail the length cap.
const BURST_MAX_SEC = 30;
const LUST = ['Bloodlust', 'Heroism'];
const POTION_LABEL = { Destruction: 'Destruction Potion', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' };
function auraBands(buffsTable, names) {
    const d = buffsTable && buffsTable.data;
    return (d && Array.isArray(d.auras) ? d.auras : []).filter(a => a && names.includes(a.name)).flatMap(a => Array.isArray(a.bands) ? a.bands : []);
}
function burstStats(buffsTable, castsTable) {
    const d = buffsTable && buffsTable.data;
    if (!d || !Array.isArray(d.auras)) return [];
    const casts = castCounts(castsTable);
    const lust = auraBands(buffsTable, LUST);
    const inside = b => lust.some(l => b.startTime < l.endTime && b.endTime > l.startTime);
    return d.auras
        .filter(a => a && Array.isArray(a.bands) && a.bands.length && casts[a.name] && !LUST.includes(a.name) && a.bands.every(b => (b.endTime - b.startTime) / 1000 <= BURST_MAX_SEC))
        .map(a => ({ name: a.name, uses: a.bands.length, insideBloodlust: a.bands.filter(inside).length }));
}
function burstLabel(name) { return POTION_LABEL[name] || name; }
```

In `referenceSummary`'s `per` map add `burst: burstStats(p.tables.buffs, p.tables.casts),` next to `bloodlust:`; after the `stats` block add:

```js
    const burstNames = countNames(per.map(p => p.burst.map(b => b.name)));
    const burst = Object.keys(burstNames).filter(nm => burstNames[nm] >= majority).map(nm => {
        const rows = per.map(p => p.burst.find(b => b.name === nm)).filter(Boolean);
        return { name: nm, uses: medOf(rows.map(r => r.uses)), insideBloodlust: medOf(rows.map(r => r.insideBloodlust)) };
    });
```

and add `burst,` to the returned object (after `bloodlustPercent`).

In `killFacts`, add `burst: burstStats(tables.buffs, tables.casts),` to the `me` object after `bloodlustPercent`.

In `consumableFindings`, before the final `return f;` add:

```js
    // v2 §6: a burst the player fires only outside Bloodlust, on a fight that had it, where
    // comparable players fire it inside.
    if (ref && Array.isArray(ref.burst) && me.bloodlustPercent > 0) {
        (me.burst || []).forEach(b => {
            const r = ref.burst.find(x => x.name === b.name);
            if (r && r.insideBloodlust >= 1 && b.uses >= 1 && b.insideBloodlust === 0)
                f.push(finding('burst_outside_bloodlust', 'minor', 'player', 'Used ' + burstLabel(b.name) + ' ' + (b.uses === 1 ? 'once' : b.uses + ' times') + ' on ' + kill.name + ', never inside Bloodlust; comparable players line it up with Bloodlust', { ability: b.name }));
        });
    }
```

In `rotationFindings`, replace the `f.push(finding('ability_unused', …))` call with:

```js
            if (r >= T.unusedPerMin || ref.casts[name] >= T.unusedPerFightCooldown) {
                // v2 §6: on-use items and potions stay in the comparison (they are a large, cheap
                // DPS gain) but are named for what they are, so the model does not call them spells.
                const isBurst = Array.isArray(ref.burst) && ref.burst.some(b => b.name === name);
                const text = isBurst
                    ? 'Never used ' + burstLabel(name) + (POTION_LABEL[name] ? '' : ' (on-use item)') + ' on ' + kill.name + '; comparable players use it ' + fmt(r) + ' times a minute'
                    : 'Never cast ' + name + ' on ' + kill.name + '; comparable players cast it ' + fmt(r) + ' times a minute';
                f.push(finding('ability_unused', top3.includes(name) ? 'major' : 'minor', 'player', text, { ability: name }));
            }
```

Add `BURST_MAX_SEC, POTION_LABEL, auraBands, burstStats, burstLabel` to `module.exports`.

In the spec §6, replace bullet (b) with: "(b) whose name also appears in the player's Casts table — true for on-use items and for potions alike, because WCL names a potion cast after its effect (the fixture's Casts table holds `Destruction: 1` for a Destruction Potion); `POTION_LABEL` maps those effect names back to the potion for the report text — and". Remove the sentence about verifying melee entries live and the `source` field from the per-burst shape.

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `77 passed, 0 failed`; `13 passed, 0 failed`. If `referenceSummary on Anetheron` or `killFacts on Anetheron` now fail, `burst` leaked a non-empty array from the bandless fixture: `burstStats` must return `[]` when no aura has bands.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js docs/superpowers/specs/2026-09-05-feedback-fair-reference-and-log-selection-design.md
git commit -m "feat(feedback): burst cooldowns and potions measured against the Bloodlust window; on-use items named as such

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Ceiling in the sheet, prompt completeness

**Files:**
- Modify: `vet-feedback.js` — `buildFacts` (`overall.ceiling`), `buildPrompt` (rules 2 and the new 3b)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `reference.topDps`, `reference.dps`, `me.amount`, `kill.date`.
- Produces: `facts.overall.ceiling: [{ name, date, me, dps, topDps }]` (≤ 2 entries).

- [ ] **Step 1: Write the failing tests**

Add after `buildFacts: the sheet the model reads`:

```js
test('buildFacts / buildPrompt (v2 §7): the two worst live pulls with a ceiling reach the sheet; the prompt asks for every finding and a "Where you stand" line', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const ref = refFor(50619);
    assert.deepStrictEqual(facts.overall.ceiling, [{ name: 'Anetheron', date: killFor(50619).date, me: 1300.7, dps: ref.dps, topDps: ref.topDps }], 'Kaz\'rogal is a bad pull and stays out');
    const three = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619), Object.assign({}, killFor(50619), { name: 'B', rankPercent: 10 }), Object.assign({}, killFor(50619), { name: 'C', rankPercent: 50 })], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(three.overall.ceiling.map(c => c.name), ['B', 'Anetheron'], 'lowest rankPercent first, capped at two');
    const none = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [Object.assign({}, killFor(50619), { reference: null })], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual(none.overall.ceiling, []);
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/every entry of overall\.findings/.test(p.system) && /do not drop any/.test(p.system), p.system);
    assert.ok(/3b\. If overall\.ceiling is not empty/.test(p.system) && /Where you stand/.test(p.system), p.system);
    assert.ok(!/at most 5/.test(p.system));
    assert.strictEqual(F.checkNumbers('Where you stand: on Anetheron you did ' + Math.round(facts.overall.ceiling[0].me) + ' against ' + ref.dps + ' typical and ' + ref.topDps + ' at best.', facts).ok, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node vet-feedback.test.js 2>&1 | tail -1`
Expected: `77 passed, 1 failed`.

- [ ] **Step 3: Implement**

In `buildFacts`, before `return {` add:

```js
    // v2 §7: where the player stands on their two worst live pulls — their number, the
    // benchmark, and the band's best — so the ceiling is a fact, not the model's discretion.
    const pct = k => (k.rankPercent == null ? 101 : k.rankPercent);
    const ceiling = slim.filter(k => !k.fight.badPull && k.reference && typeof k.reference.topDps === 'number')
        .sort((a, b) => pct(a) - pct(b)).slice(0, 2)
        .map(k => ({ name: k.name, date: k.date, me: k.me.amount, dps: k.reference.dps, topDps: k.reference.topDps }));
```

and add `ceiling,` to the `overall` object (after `positives`).

In `buildPrompt`, replace `then overall.findings biggest first, at most 5, each as one short paragraph` with `then every entry of overall.findings, in that order (it holds at most 6; do not drop any), each as one short paragraph` — the rule keeps its other text. After the `'3. If overall.positives …'` line add:

```js
        '3b. If overall.ceiling is not empty, a line "Where you stand", then one line per entry: your number (me), what players at your item level around the middle do (dps), and what the best at your item level reach (topDps) on that boss. If overall.ceiling is empty, skip this section entirely.',
```

- [ ] **Step 4: Run the suites**

Run: `node vet-feedback.test.js 2>&1 | tail -1; node server.test.js 2>&1 | tail -1`
Expected: `78 passed, 0 failed`; `13 passed, 0 failed`. If `buildPrompt: sections tell the model to skip themselves (Minor 14)` fails, read its regexes: they match the wording of rules 2–4, which this task must leave intact apart from the "at most 5" clause.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): ceiling line in the facts sheet; the prompt must keep every finding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Client: night selector, per-pull dates, "Where you stand", fallback text

**Files:**
- Modify: `vetting.js` — `requestFeedback` (line ~187), `fallbackReport` (line ~222), `factsTable` (line ~439), `feedbackBox` (line ~473)
- Modify: `vetting.css` (after line 39)

**Interfaces:**
- Consumes: `facts.nights`, `facts.night`, `facts.overall.ceiling`, `badPulls[i].date`, `kills[i].date`, the route's `report=` parameter.
- Produces: `window.vetFeedback(key, reportCode)`; stored shape `state.feedback[key] = { report, reportError, generatedAt, facts, night?: { code, report, reportError, generatedAt, facts }, selected?: 'all' | code }`; DOM: `select.feedback-night`, `.feedback-ceiling`.

- [ ] **Step 1: Implement `requestFeedback`**

Change the signature to `async function requestFeedback(key, reportCode) {` and:

- build the URL with `+ (reportCode ? '&report=' + encodeURIComponent(reportCode) : '')` appended after the thresholds parameter;
- replace the `state.feedback[key] = { … }` assignment with:

```js
        const got = { report: body.report || null, reportError: body.reportError || null, generatedAt: body.generatedAt, facts: body.facts };
        const prev = state.feedback[key] || {};
        // v2 §8: the across-kills report and the last fetched night live side by side; `selected`
        // remembers which one the box shows.
        state.feedback[key] = reportCode
            ? Object.assign({}, prev, { night: Object.assign({ code: reportCode }, got), selected: reportCode })
            : Object.assign({}, prev, got, { selected: 'all' });
```

- [ ] **Step 2: Implement `fallbackReport`**

Replace the first `lines` line with:

```js
    const head = facts.night
        ? 'raid night of ' + facts.night.date + ', median parse that night ' + Math.round(facts.night.medianPercent)
        : 'median parse ' + Math.round(facts.tier.medianPercent);
    const lines = [facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + facts.tier.zoneName + ', ' + head];
```

After the `What's fine` block and before the `Nothing to flag` block add:

```js
    if (facts.overall.ceiling && facts.overall.ceiling.length) {
        lines.push('', 'Where you stand');
        facts.overall.ceiling.forEach(c => lines.push(c.name + ': you ' + c.me + ', players at your item level ' + c.dps + ', the best at your item level ' + c.topDps));
    }
```

Change the bad-pull line to `lines.push(b.name + (b.date ? ' ' + b.date : '') + ' (' + b.rankPercent + '): ' + b.reason)`.

- [ ] **Step 3: Implement `factsTable` and `feedbackBox`**

In `factsTable`, before `facts.kills.forEach` add `const multi = new Set(facts.kills.map(k => k.name)).size < facts.kills.length;` and append to the Boss cell expression, after the bad-pull span: `+ (multi && k.date ? ' <span class="cell-unknown">' + escapeHtml(k.date) + '</span>' : '')`.

Replace `feedbackBox` with:

```js
function feedbackBox(r) {
    const box = document.createElement('div');
    box.className = 'feedback-box';
    const fb = state.feedback[r.key];
    const busy = feedbackInFlight.has(r.key);
    // v2 §8: the default (across-kills) sheet lists the player's raid nights; the select picks
    // which report the box shows and which one the button fetches.
    const nights = fb && fb.facts && Array.isArray(fb.facts.nights) ? fb.facts.nights : [];
    const selected = fb && fb.selected && fb.selected !== 'all' && nights.some(n => n.code === fb.selected) ? fb.selected : 'all';
    const shown = selected === 'all' ? fb : (fb.night && fb.night.code === selected ? fb.night : null);
    if (nights.length) {
        const sel = document.createElement('select');
        sel.className = 'feedback-night';
        sel.innerHTML = '<option value="all">Across kills</option>' + nights.map(n =>
            '<option value="' + escapeHtml(n.code) + '">' + escapeHtml(n.date + ' · ' + n.bosses.length + (n.bosses.length === 1 ? ' boss' : ' bosses') + ' · median ' + Math.round(n.medianPercent)) + '</option>').join('');
        sel.value = selected;
        sel.addEventListener('click', e => e.stopPropagation());
        sel.addEventListener('change', e => { e.stopPropagation(); fb.selected = sel.value; try { save(); } catch (err) { feedbackErrors[r.key] = 'Could not save locally: ' + err.message; } renderTable(); });
        box.appendChild(sel);
    }
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = busy ? 'Analysing…' : (shown ? 'Refresh report' : 'Feedback report');
    btn.disabled = busy || !r.profile.parses;
    if (!r.profile.parses) btn.title = 'No parses to analyse';
    btn.addEventListener('click', e => { e.stopPropagation(); requestFeedback(r.key, selected === 'all' ? null : selected); });
    box.appendChild(btn);
    if (feedbackErrors[r.key]) box.insertAdjacentHTML('beforeend', '<div class="status error feedback-status">' + escapeHtml(feedbackErrors[r.key]) + '</div>');
    if (!shown) return box;
    const text = shown.report || (shown.facts ? fallbackReport(shown.facts) : '');
    if (shown.reportError) box.insertAdjacentHTML('beforeend', '<div class="status feedback-status">' + escapeHtml(shown.reportError) + '</div>');
    const pre = document.createElement('pre');
    pre.className = 'feedback-report';
    pre.textContent = text;
    box.appendChild(pre);
    const actions = document.createElement('div');
    actions.className = 'feedback-actions';
    const copy = document.createElement('button');
    copy.className = 'btn btn-primary'; copy.textContent = 'Copy';
    copy.addEventListener('click', e => { e.stopPropagation(); copyText(text, copy); });
    actions.appendChild(copy);
    if (shown.generatedAt) actions.insertAdjacentHTML('beforeend', '<span class="status">' + escapeHtml(new Date(shown.generatedAt).toLocaleString()) + '</span>');
    box.appendChild(actions);
    if (shown.facts) {
        const det = document.createElement('details');
        det.innerHTML = '<summary>Facts</summary>';
        const ceiling = shown.facts.overall && Array.isArray(shown.facts.overall.ceiling) ? shown.facts.overall.ceiling : [];
        if (ceiling.length) det.insertAdjacentHTML('beforeend', '<div class="status feedback-ceiling">Where you stand: ' + ceiling.map(c =>
            escapeHtml(c.name) + ' ' + escapeHtml(String(c.me)) + ' vs ' + escapeHtml(String(c.dps)) + ' typical, ' + escapeHtml(String(c.topDps)) + ' best at your item level').join(' · ') + '</div>');
        det.appendChild(factsTable(shown.facts));
        box.appendChild(det);
    }
    return box;
}
```

Append to `vetting.css` after line 39: `.feedback-night { margin-right: 8px; max-width: 30ch; }` and `.feedback-ceiling { margin: 4px 0; }`.

- [ ] **Step 4: Syntax and existing-behaviour check**

Run: `node --check vetting.js && npm test 2>&1 | tail -3`
Expected: no syntax error; the `npm test` summary lines show every suite passing (vetting.js has no unit suite; the browser smoke is Task 9).

- [ ] **Step 5: Commit**

```bash
git add vetting.js vetting.css
git commit -m "feat(vetting): raid-night selector on the feedback box; per-pull dates; where-you-stand line and fallback text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs, full run, browser smoke, live calibration

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-parse-feedback-report-design.md` §2.5 (one line)
- Modify: `README.md` only if it documents `/api/vet/feedback` (check with `grep -n "vet/feedback" README.md`)
- Create (scratch, not committed): `<scratchpad>/v2-smoke.mjs`

- [ ] **Step 1: Docs**

Under v1 §2.5's table add the line: `Superseded 2026-09-05: measured costs are higher (ranking page 2, fight context 9, player tables 5) and the reference is now built around the leaderboard's middle — see the v2 spec §9 for the current table.` If `README.md` documents the endpoint, add one sentence: `Optional report=<WCL report code> analyses one raid night; the default response's facts.nights lists the codes.`

- [ ] **Step 2: Full test run**

Run: `npm test 2>&1 | grep -E "passed, .* failed"`
Expected: every suite's `N passed, 0 failed` line; `vet-feedback.test.js` 78, `server.test.js` 13. Paste all lines.

- [ ] **Step 3: Start the server and smoke the page over CDP**

Start `npm start` in the background (WCL and OpenAI credentials from `.env`; the model is `OPENAI_MODEL` there). Write `<scratchpad>/v2-smoke.mjs`:

```js
// Throwaway: drives headless Chrome over CDP through the v2 feedback flow on the local page.
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=/tmp/vet-feedback-v2-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
    for (let i = 0; i < 180; i++) {
        try { const list = await (await fetch('http://127.0.0.1:9333/json')).json(); const t = list.find(x => x.type === 'page'); if (t) return t; } catch (e) { /* not up yet */ }
        await sleep(1000);
    }
    throw new Error('no chrome page target');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const waiting = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
async function until(expr, label, seconds) { for (let i = 0; i < seconds; i++) { const v = await evaluate(expr); if (v) return v; await sleep(1000); } throw new Error('timeout waiting for ' + label); }
async function load() { await send('Page.navigate', { url: 'http://localhost:3000/vetting.html' }); await until('typeof window.vetAdd === "function"', 'page', 60); }
await send('Page.enable', {});
await load();
await evaluate('localStorage.clear(); true');
await load();
await evaluate('(() => { const r = document.getElementById("realmInput"); r.value = "spineshatter"; r.dispatchEvent(new Event("change")); return window.vetAdd("Dotwin"); })()');
await until('!!window.vetState().profiles.dotwin', 'profile', 120);
await evaluate('document.querySelector(\'tr[data-name="Dotwin"]\').click(); true');
await until('!!document.querySelector(".feedback-box button")', 'button', 10);
await evaluate('document.querySelector(".feedback-box button").click(); true');
const all = await until('(document.querySelector(".feedback-report") || document.querySelector(".feedback-status.error") || {}).textContent || ""', 'report', 400);
console.log('--- across kills ---\n' + all + '\n---');
console.log('night options:', await evaluate('Array.from(document.querySelectorAll(".feedback-night option")).map(o => o.textContent)'));
console.log('facts rows:', await evaluate('document.querySelectorAll(".facts-table tr").length'), '| ceiling line:', await evaluate('(document.querySelector(".feedback-ceiling") || {}).textContent || "(none)"'));
await evaluate('(() => { const s = document.querySelector(".feedback-night"); s.value = s.options[1].value; s.dispatchEvent(new Event("change")); return true; })()');
await until('document.querySelector(".feedback-box button").textContent === "Feedback report"', 'night not yet fetched', 5);
await evaluate('document.querySelector(".feedback-box button").click(); true');
const night = await until('(document.querySelector(".feedback-report") || document.querySelector(".feedback-status.error") || {}).textContent || ""', 'night report', 400);
console.log('--- night ---\n' + night + '\n---');
await load();
await evaluate('document.querySelector(\'tr[data-name="Dotwin"]\').click(); true');
console.log('selected after reload:', await evaluate('document.querySelector(".feedback-night").selectedIndex'), '| report shown:', await evaluate('!!document.querySelector(".feedback-report")'));
chrome.kill();
process.exit(0);
```

Run it in the background and poll its output (cold start can take over two minutes). Expected: two reports print, `night options` lists "Across kills" plus at least one dated night, the night report's header contains "raid night of", `selected after reload` is 1 and `report shown` is true. Paste the output.

- [ ] **Step 4: Calibration**

With the server still running, fetch both players' default sheets and print the crit comparison and the model text:

```bash
for q in "name=Dotwin&server=spineshatter&region=eu&zone=1056" "name=Rotminster&server=spineshatter&region=eu&zone=1060"; do
  curl -s "http://localhost:3000/api/vet/feedback?$q" > /tmp/fb.json
  node -e 'const b=require("/tmp/fb.json"); b.facts.kills.forEach(k=>{const a=k.me.abilities[0], r=k.reference&&k.reference.abilities.find(x=>x.name===a.name); console.log(k.name, k.date, "| parse", Math.round(k.rankPercent), "| me", k.me.amount, "vs", k.reference&&k.reference.dps, "top", k.reference&&k.reference.topDps, "|", a.name, "crit", a.critPercent, "vs", r&&r.critPercent, "| burst", JSON.stringify(k.me.burst))}); console.log(b.report || ("FALLBACK: "+b.reportError))'
done
```

Paste the output. The report for Dotwin must no longer lead with crit; its findings must mention the on-use trinket or potion timing only if `me.burst` shows a use outside Bloodlust.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/superpowers/specs/2026-09-04-parse-feedback-report-design.md README.md
git commit -m "docs: point the v1 cost table at the v2 spec; document report=<code>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(Drop `README.md` from `git add` if it was not changed.)

Do not push: pushing to `main` is a shared-branch side effect the coordinator asks the user about.
