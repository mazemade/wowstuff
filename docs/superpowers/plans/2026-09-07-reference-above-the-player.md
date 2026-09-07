# Reference Above The Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The feedback report compares a player against people *above* them at their own item level, reports only findings worth acting on, and reads correctly for melee, hunters and tanks — not only for casters.

**Architecture:** Part A (Tasks 1–2) moves the reference from the leaderboard middle to `player + half the distance to the best at their item level`, keeping the page budget by starting the outward page walk halfway toward page 1. Part B (Tasks 3–4) stops reporting findings that are not worth acting on: a damage-share gate on abilities, and auto-attacks excluded from "the main ability". Part C (Tasks 5–7) repairs the wording — role-aware power words, the night's tier in the title, shares never printed outside 0–100%, and "comparable players" renamed now that the reference is ahead of the reader. Task 8 re-runs the five real players and confirms the reports read correctly.

**Tech Stack:** Node (no dependencies beyond express, already present), vanilla browser JS, the repo's hand-rolled `test(name, fn)` suites run by `npm test`, live WCL via `.env` for the final check.

**Spec:** `docs/superpowers/specs/2026-09-07-reference-above-the-player-design.md`

## Global Constraints

- **Work in `/Users/maxvanzoelen/wowstuff-logsfirst`** — an isolated git worktree on branch `logs-first-vetting-feedback`. NEVER touch `/Users/maxvanzoelen/wowstuff`; another workstream owns it. `node_modules` and `.env` there are symlinks; leave them alone and never stage them.
- Commits carry **NO `Co-Authored-By` trailer** and no AI attribution of any kind.
- `git add` only the files a task names. NEVER `git add -A` or `git add .`.
- No new npm dependencies; tests use `node:assert` only.
- Every suite prints `N passed, M failed` and sets `process.exitCode = failed ? 1 : 0`.
- `selectGating` in `vet-profile.js` must not change; the vetting verdict must not change.
- Zone ids: 1060 = "BT / Hyjal", 1056 = "SSC / TK".
- Comment style: short "why" comments with spec references like `(ref-above A)`.
- The full suite (`npm test`, 11 suites) must be green at the end of every task.
- The replacement wording for "comparable players" is **"players ahead of you at your item level"**, shortened to **"players ahead of you"** where item level is already named in the sentence.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `vet-feedback.js` | `pageOrderFrom` (replaces `middlePageOrder`), `getReference` targets above the player, `rotationFindings` gains the materiality gate, `AUTO_ATTACK`, `T.abilityMinShare` |
| `vet-gap.js` | `REF_LABEL` renamed wording; negative-share findings dropped |
| `vet-checklist.js` | `mainAbility` skips auto-attacks, `nukeRows` role-aware and auto-attack-safe, title takes the night's tier, `renderReport` share display, wording |
| `vet-feedback.test.js`, `vet-checklist.test.js`, `vet-gap.test.js` | tests |
| `README.md` | the feedback bullet, if it describes the reference |

---

### Task 1: `pageOrderFrom` — walk outward from any page

**Files:**
- Modify: `vet-feedback.js` (`middlePageOrder` ~line 900, export list ~line 1121)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `F.pageOrderFrom(start, L, maxPages) -> number[]` — pages ordered by distance from `start`, ties toward the lower (better) page, clamped to `[1, L]`, at most `maxPages` entries. `F.middlePageOrder(L, maxPages)` is kept as a thin wrapper (`pageOrderFrom(Math.max(1, Math.round(L / 2)), L, maxPages)`) so existing callers and tests are untouched.

- [ ] **Step 1: Write the failing tests**

Append to `vet-feedback.test.js`, immediately before the final `Promise.all(pending)` block:

```js
// --- ref-above A1: the reference walk can start from any page, not only the middle
test('pageOrderFrom (ref-above A1): pages ordered outward from the start, better page first on a tie', () => {
    assert.deepStrictEqual(F.pageOrderFrom(8, 20, 5), [8, 7, 9, 6, 10]);
    assert.deepStrictEqual(F.pageOrderFrom(1, 20, 4), [1, 2, 3, 4], 'a start at the top only walks down');
    assert.deepStrictEqual(F.pageOrderFrom(20, 20, 3), [20, 19, 18], 'a start at the bottom only walks up');
    assert.deepStrictEqual(F.pageOrderFrom(0, 5, 3), [1, 2, 3], 'a start below 1 clamps to 1');
    assert.deepStrictEqual(F.pageOrderFrom(99, 5, 2), [5, 4], 'a start past the end clamps to L');
    assert.deepStrictEqual(F.pageOrderFrom(3, 3, 9), [3, 2, 1], 'never more pages than exist');
});
test('middlePageOrder (ref-above A1): unchanged behaviour, now a wrapper', () => {
    assert.deepStrictEqual(F.middlePageOrder(20, 5), F.pageOrderFrom(10, 20, 5));
    assert.deepStrictEqual(F.middlePageOrder(1, 3), [1]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 1 FAIL — `F.pageOrderFrom is not a function`. (The `middlePageOrder` test fails on the same message.)

- [ ] **Step 3: Implement**

In `vet-feedback.js`, replace the whole `middlePageOrder` function with:

```js
// ref-above A1: pages of the leaderboard ordered by distance from a starting page, better
// (lower) page first on a tie. The reference used to always start at the middle; it now starts
// wherever the target parse is estimated to be.
function pageOrderFrom(start, L, maxPages) {
    const s = Math.min(Math.max(1, Math.round(start) || 1), Math.max(1, L));
    const out = [];
    for (let d = 0; d <= L && out.length < maxPages; d++) {
        (d === 0 ? [s] : [s - d, s + d]).forEach(p => { if (p >= 1 && p <= L && !out.includes(p) && out.length < maxPages) out.push(p); });
    }
    return out;
}
function middlePageOrder(L, maxPages) { return pageOrderFrom(Math.max(1, Math.round(L / 2)), L, maxPages); }
```

Add `pageOrderFrom` to `module.exports` next to `middlePageOrder`.

Note the tie order flips from the old function (`mid + d` before `mid - d`) to better-page-first (`s - d` before `s + d`). That is deliberate: when two pages are equally far from the target, the better parse is the more useful reference. The `middlePageOrder` test above pins that both callers now agree.

- [ ] **Step 4: Run the suite**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `0 failed`. If an existing `getReference` test moved because of the tie-order flip, that is a real behaviour change to report in your report — do NOT edit the expectation without saying so.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "refactor(feedback): pageOrderFrom — the reference walk can start anywhere (ref-above A1)"
```

---

### Task 2: the reference sits above the player

**Files:**
- Modify: `vet-feedback.js` (`REF` ~line 18, `getReference` ~line 925, call site ~line 1105)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `F.pageOrderFrom` (Task 1).
- Produces: `getReference(query, o)` accepts two new fields on `o`: `playerAmount` (number|null) and `playerRankPercent` (number|null). Its returned `summary` gains nothing; its `note` is set to `'nothing at your item level beat you on this pull'` when the player is the band ceiling, and to `'compared against the middle of the leaderboard'` when the target could not be used. `REF` gains `targetBucket: 100`.

- [ ] **Step 1: Write the failing tests**

Append to `vet-feedback.test.js` before the final `Promise.all(pending)` block. The `leaderboard(pages, levels)` helper already exists in this file: it builds `pages` pages of 100 ranks each, rank *n* having `amount = 5000 - n`, so `leaderboard(20, [124])` is 2000 ranks from 4999 down to 3000, all at item level 124.

```js
// --- ref-above A2: the reference is picked above the player, not at the leaderboard middle
function refFor(over) {
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => (q === F.FIGHT_QUERY ? { reportData: { report: null } } : lb.query(q, vars));
    return { lb, run: () => F.getReference(query, Object.assign({
        encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu',
        itemLevel: 124, dbIndex: db, refCache: new Map(), now: Date.now(),
    }, over)) };
}
test('getReference (ref-above A2): the reference is halfway between the player and the best at their item level', async () => {
    // Player at amount 3500 (rank 1500 of 2000, so rankPercent 25). Ceiling is rank 1 at 4999.
    // Target = 3500 + (4999 - 3500) / 2 = 4249.5, which is rank 750 — NOT the middle (rank 1000, 4000).
    const r = await refFor({ playerAmount: 3500, playerRankPercent: 25 }).run();
    assert.strictEqual(r.summary.topDps, 4999, 'the ceiling is still the best in band');
    assert.ok(Math.abs(r.summary.dps - 4250) <= 50, 'reference dps sits at the halfway target, got ' + r.summary.dps);
    assert.ok(r.summary.dps > 4000, 'and is above the leaderboard middle (4000), which is what it used to pick');
    assert.strictEqual(r.note, null);
});
test('getReference (ref-above A2): without a player amount it still picks the middle, as before', async () => {
    const r = await refFor({}).run();
    assert.ok(Math.abs(r.summary.dps - 4000) <= 60, 'unchanged middle-rank selection, got ' + r.summary.dps);
});
test('getReference (ref-above A2): a player at the ceiling gets no reference and an honest note', async () => {
    const r = await refFor({ playerAmount: 5200, playerRankPercent: 99 }).run();
    assert.strictEqual(r.summary, null);
    assert.strictEqual(r.note, 'nothing at your item level beat you on this pull');
});
test('getReference (ref-above A2): the page budget does not grow', async () => {
    const above = refFor({ playerAmount: 3500, playerRankPercent: 25 });
    await above.run();
    const middle = refFor({});
    await middle.run();
    assert.ok(above.lb.calls.length <= middle.lb.calls.length,
        'targeting above the player must not cost more pages: ' + above.lb.calls.length + ' vs ' + middle.lb.calls.length);
});
test('getReference (ref-above A2): two players far apart do not share one cached reference', async () => {
    const refCache = new Map();
    const lb = leaderboard(20, [124]);
    const query = async (q, vars) => (q === F.FIGHT_QUERY ? { reportData: { report: null } } : lb.query(q, vars));
    const base = { encounterId: 1, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', itemLevel: 124, dbIndex: db, refCache, now: Date.now() };
    const weak = await F.getReference(query, Object.assign({}, base, { playerAmount: 3100, playerRankPercent: 5 }));
    const strong = await F.getReference(query, Object.assign({}, base, { playerAmount: 4600, playerRankPercent: 90 }));
    assert.notStrictEqual(weak.summary.dps, strong.summary.dps, 'a weak and a strong player must not get the same reference');
    assert.ok(strong.summary.dps > weak.summary.dps, 'the stronger player is measured against a stronger reference');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 4 FAILs. The "picks the middle, as before" test passes already (that is today's behaviour and it must keep passing).

- [ ] **Step 3: Implement**

In `vet-feedback.js`, add `targetBucket: 100` to the `REF` object.

Inside `getReference`, the current body computes `const middle = 50 * L;`, then `collect`, then `topDps`. Restructure so the ceiling is known first and the target drives selection. Replace from `const middle = 50 * L;` down to and including the `let band = REF.band; let ranks = await collect(band);` / widening block with:

```js
        const middle = 50 * L;
        // ref-above A2: the ceiling first — the target is measured from it. Reading the top pages
        // here is the same fetch the ceiling always needed; pageFetcher memoises it.
        let topDps = null, topDuration = null;
        const ceilingBand = b => {
            for (let p = 1; p <= Math.min(REF.topPages, L); p++) {
                const ib = bandRanks((pageFetcher_cache[p] || {}).rankings || [], o.itemLevel, b);
                if (ib.length) return ib;
            }
            return [];
        };
        const readCeiling = async b => {
            for (let p = 1; p <= Math.min(REF.topPages, L) && topDps === null; p++) {
                const ib = bandRanks((await fetchPage(p)).rankings, o.itemLevel, b);
                if (ib.length) {
                    topDps = Math.round(Math.max.apply(null, ib.map(r => r.amount)));
                    const durs = ib.map(r => r.duration).filter(d => typeof d === 'number' && isFinite(d));
                    topDuration = durs.length ? Math.round(median(durs) / 1000) : null;
                }
            }
        };
        await readCeiling(REF.band);

        const myAmount = typeof o.playerAmount === 'number' && isFinite(o.playerAmount) ? o.playerAmount : null;
        // A player who is already the best at their item level has nobody above them. Say so
        // rather than inventing a reference below them (spec §B).
        if (myAmount !== null && topDps !== null && myAmount >= topDps) {
            return { summary: null, note: 'nothing at your item level beat you on this pull', band: REF.band };
        }
        // Halfway between the player and the ceiling: far enough to be worth learning from, close
        // enough to be reachable. Without a player amount this is null and the middle is used, which
        // is exactly the old behaviour.
        const target = myAmount !== null && topDps !== null ? myAmount + (topDps - myAmount) / 2 : null;
        // Better parses sit on earlier pages, so a target halfway up in DPS is roughly halfway up
        // in pages. The sort below is by actual amount, so an imprecise start still lands correctly
        // as long as the target is inside the pages we read.
        const myPage = typeof o.playerRankPercent === 'number' && isFinite(o.playerRankPercent)
            ? Math.min(Math.max(1, Math.ceil((1 - o.playerRankPercent / 100) * L)), L) : Math.max(1, Math.round(L / 2));
        const startPage = target === null ? Math.max(1, Math.round(L / 2)) : Math.max(1, Math.round(myPage / 2));
        const near = target === null
            ? (a, b) => (Math.abs(a.globalRank - middle) - Math.abs(b.globalRank - middle)) || (a.globalRank - b.globalRank)
            : (a, b) => (Math.abs(a.amount - target) - Math.abs(b.amount - target)) || (a.globalRank - b.globalRank);
        const collect = async band => {
            let found = [];
            for (const p of pageOrderFrom(startPage, L, REF.maxPages)) {
                const cr = await fetchPage(p);
                found = found.concat(bandRanks(cr.rankings, o.itemLevel, band).map(r => Object.assign({ globalRank: globalRank(p, cr.rankings.indexOf(r)) }, r)));
                if (found.length >= REF.target) break;
            }
            return found.sort(near);
        };
        let band = REF.band;
        let ranks = await collect(band);
        if (ranks.length < REF.min) { band = REF.wideBand; await readCeiling(band); ranks = await collect(band); }
        if (ranks.length < REF.min) return { summary: null, note: 'too few same-item-level parses to compare against', band };
        ranks = ranks.slice(0, REF.target);
```

Delete the old `topDps` / `topDuration` loop that followed the widening block — the ceiling is now read above. Keep everything from `const players = [];` onward unchanged.

`pageFetcher_cache` in the sketch above is not real: `readCeiling` must simply `await fetchPage(p)` as written in its own loop. Remove the unused `ceilingBand` helper — it is shown only to make the ordering explicit and has no callers. Do not add it.

Update the cache key so two distant players do not share one reference. Replace:

```js
    const key = prefix + (o.itemLevel - REF.band) + '/' + (o.itemLevel + REF.band);
```

with:

```js
    // ref-above A2: the reference now depends on the player's own amount, so the key carries a
    // coarse bucket of it. Two players within a bucket still share one reference (and one fetch).
    const bucket = typeof o.playerAmount === 'number' && isFinite(o.playerAmount)
        ? Math.round(o.playerAmount / REF.targetBucket) : 'mid';
    const key = prefix + (o.itemLevel - REF.band) + '/' + (o.itemLevel + REF.band) + '/' + bucket;
```

`findRefEntry(o.refCache, prefix, o.itemLevel)` scans by prefix for a covering item level; it must also match the bucket now. Give it the bucket as a further argument and require both to match, so a cached entry for a different bucket is not reused. The `finalKey` re-keying at the end of the function must include the same bucket.

At the call site (`vet-feedback.js` ~line 1105), pass the two new fields:

```js
                    : await getReference(query, { encounterId: t.encounterId, classToken: id.class, spec: id.spec, role, region: profile.region, itemLevel: rank.bracketData,
                                                  playerAmount: typeof rank.amount === 'number' ? rank.amount : null,
                                                  playerRankPercent: typeof rank.rankPercent === 'number' ? rank.rankPercent : null,
                                                  dbIndex, refCache, now });
```

- [ ] **Step 4: Run the suite, then every suite**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `0 failed`.

Then run the whole suite: `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: 11 suites, all `0 failed`.

**If assertions in other suites move**, that is the expected fixture churn. Repair them by regenerating the expected values from the same stubs, never by loosening an assertion into something that would pass either way. In your report, list every assertion whose expected value changed, with the old and new number, so a reviewer can see the reference moved and nothing else did.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): the reference sits above the player, not at the leaderboard middle (ref-above A2)"
```

---

### Task 3: only report abilities worth casting

**Files:**
- Modify: `vet-feedback.js` (`T` ~line 24, `rotationFindings` ~line 555)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `T.abilityMinShare = 2`. `rotationFindings` reports an unused or under-used ability only when the reference's damage share for it is at least `T.abilityMinShare`, or it is a burst cooldown (the existing `isBurst` test), and never when the name is a known consumable.

- [ ] **Step 1: Write the failing tests**

Append before the final `Promise.all(pending)` block. `rotKill(over)` already exists in this file.

```js
// --- ref-above B1: an ability nobody gains damage from is not a finding
test('rotationFindings (ref-above B1): an ability with no damage share is not reported, however often the reference casts it', () => {
    // Aspect of the Viper is a damage REDUCTION; Misdirection is threat. Funkell was told to cast
    // both because the reference players did, at rates well over T.unusedPerMin.
    const k = rotKill({ reference: {
        casts: { 'Shadow Bolt': 60, 'Aspect of the Viper': 4, Misdirection: 4 },
        abilities: [{ name: 'Shadow Bolt', share: 100 }, { name: 'Aspect of the Viper', share: 0 }, { name: 'Misdirection', share: 0 }],
    } });
    const f = F.rotationFindings(k).filter(x => x.key === 'ability_unused');
    assert.deepStrictEqual(f, [], 'nothing to report: ' + JSON.stringify(f.map(x => x.text)));
});
test('rotationFindings (ref-above B1): an ability that does carry damage is still reported', () => {
    const k = rotKill({ me: { casts: { 'Shadow Bolt': 60 } }, reference: {
        casts: { 'Shadow Bolt': 60, Immolate: 6 },
        abilities: [{ name: 'Shadow Bolt', share: 80 }, { name: 'Immolate', share: 20 }],
    } });
    const f = F.rotationFindings(k).filter(x => x.key === 'ability_unused');
    assert.strictEqual(f.length, 1);
    assert.ok(/Immolate/.test(f[0].text), f[0].text);
});
test('rotationFindings (ref-above B1): a burst cooldown is kept even with no damage share of its own', () => {
    const k = rotKill({ reference: {
        casts: { 'Shadow Bolt': 60, Recklessness: 1 },
        abilities: [{ name: 'Shadow Bolt', share: 100 }],
        burst: [{ name: 'Recklessness' }],
    } });
    const f = F.rotationFindings(k).filter(x => x.key === 'ability_unused');
    assert.strictEqual(f.length, 1, 'burst survives the share gate');
    assert.ok(/Recklessness/.test(f[0].text), f[0].text);
});
test('rotationFindings (ref-above B1): drinking an elixir is not an ability to cast', () => {
    // Tipsi was told to "cast" Elixir of Demonslaying. Consuming an elixir deals no damage, so it
    // carries no share and the same gate removes it — no consumable list needed.
    const k = rotKill({ reference: {
        casts: { 'Shadow Bolt': 60, 'Elixir of Demonslaying': 2 },
        abilities: [{ name: 'Shadow Bolt', share: 100 }],
    } });
    const f = F.rotationFindings(k).filter(x => x.key === 'ability_unused');
    assert.deepStrictEqual(f, [], 'consumables are not rotation advice: ' + JSON.stringify(f.map(x => x.text)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 2 FAILs — the "no damage share" and "consumable" tests. The other two describe behaviour that already holds and must keep holding.

- [ ] **Step 3: Implement**

Add to the `T` object in `vet-feedback.js`:

```js
    // ref-above B1: an ability is only worth naming if the reference actually got damage out of
    // it. Below this share of their damage it is a utility press (Misdirection), a deliberate
    // damage loss (Aspect of the Viper) or a snare (Hamstring) — never a fix.
    abilityMinShare: 2,
```

In `rotationFindings`, immediately after `const top3 = ref.abilities.slice(0, 3).map(a => a.name);` add:

```js
    const refShare = name => { const a = (ref.abilities || []).find(x => x && x.name === name); return a && typeof a.share === 'number' ? a.share : 0; };
```

Leave the first guard line (`if (UTILITY_CAST.test(name) || offLimits(name)) return;`) exactly as
it is. No consumable guard is needed and none should be added: `CONSUMABLE` is keyed by category
(`flask`, `battle`, `guardian`, `food`, `oil`), each holding an array of regexes, so `CONSUMABLE[name]`
would never match anything; and consuming an elixir deals no damage, so the share gate below
removes it anyway. A consumable that is a genuine burst (a Destruction Potion) keeps its
`isBurst` exemption, which is the behaviour v2 deliberately chose.

Inside the `if (!myCasts[name]) {` branch, replace the reporting condition:

```js
            if (r >= T.unusedPerMin || ref.casts[name] >= T.unusedPerFightCooldown) {
```

with:

```js
                const isBurst = (Array.isArray(ref.burst) && ref.burst.some(b => b.name === name)) || !!POTION_LABEL[name];
                // ref-above B1: rate alone is not a reason — the reference has to have got damage
                // out of it, unless it is a burst cooldown, whose value is what it multiplies.
                if (!isBurst && refShare(name) < T.abilityMinShare) return;
                if (r >= T.unusedPerMin || ref.casts[name] >= T.unusedPerFightCooldown) {
```

and delete the now-duplicated `const isBurst = …` line that sits inside that `if` block, keeping the `unused.push({ name, rate: fmt(r), isBurst, top3: top3.includes(name) });` line as it is.

Apply the same gate to the under-used branch. Replace:

```js
        } else if (top3.includes(name) && p < T.ratioLow * r) {
```

with:

```js
        } else if (top3.includes(name) && refShare(name) >= T.abilityMinShare && p < T.ratioLow * r) {
```

- [ ] **Step 4: Run the suite, then every suite**

Run: `node vet-feedback.test.js 2>&1 | tail -2` then `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: `0 failed` everywhere. Existing rotation tests (Minor 20's once-per-fight cooldown, the curse family, the on-use item) must all still pass — if one now fails because its fixture ability has no `share`, give that fixture ability a realistic share rather than weakening the gate, and say so in your report.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "fix(feedback): only report an ability the reference got damage from (ref-above B1)"
```

---

### Task 4: auto-attacks are never "the main ability"

**Files:**
- Modify: `vet-checklist.js` (`mainAbility` ~line 306 area, `nukeRows` ~line 289, `castingRows` ~line 80, export list ~line 447)
- Test: `vet-checklist.test.js`

**Interfaces:**
- Produces: `C.AUTO_ATTACK` — a `Set` of `'Melee'`, `'Auto Shot'`, `'Shoot'`, `'Melee (Off-Hand)'`, `'Off-Hand'`. `mainAbility(kill)` returns the reference's highest-damage ability that is not in it, falling back to `'spell'`.

- [ ] **Step 1: Write the failing tests**

Append to `vet-checklist.test.js` before its final summary block:

```js
// --- ref-above B2: an auto-attack is never the ability the advice is built on
test('mainAbility (ref-above B2): auto-attacks are skipped so a melee gets a real ability', () => {
    // Tipsi's real Anetheron reference: Melee 40.3%, Heroic Strike 32.6%, Mortal Strike 10.8%.
    const warrior = { reference: { abilities: [{ name: 'Melee', share: 40.3 }, { name: 'Heroic Strike', share: 32.6 }, { name: 'Mortal Strike', share: 10.8 }] } };
    assert.strictEqual(C.mainAbility(warrior), 'Heroic Strike');
    const hunter = { reference: { abilities: [{ name: 'Auto Shot', share: 45 }, { name: 'Steady Shot', share: 30 }] } };
    assert.strictEqual(C.mainAbility(hunter), 'Steady Shot');
    const caster = { reference: { abilities: [{ name: 'Shadow Bolt', share: 90 }] } };
    assert.strictEqual(C.mainAbility(caster), 'Shadow Bolt', 'a caster is unaffected');
    assert.strictEqual(C.mainAbility({ reference: { abilities: [{ name: 'Melee', share: 100 }] } }), 'spell', 'nothing but auto-attacks falls back');
    assert.strictEqual(C.mainAbility({}), 'spell');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node vet-checklist.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 1 FAIL — either `C.mainAbility is not a function` (if it is not exported yet) or `'Melee' !== 'Heroic Strike'`.

- [ ] **Step 3: Implement**

In `vet-checklist.js`, above `mainAbility`, add:

```js
// ref-above B2: WCL's damage table lists the auto-attack as an ability, and for every physical
// class it is the biggest one. Building advice on it produced "queue the next Melee" and "check
// the rank of Melee" — the ability the player should hear about is the biggest real one.
const AUTO_ATTACK = new Set(['Melee', 'Auto Shot', 'Shoot', 'Melee (Off-Hand)', 'Off-Hand']);
```

Replace `mainAbility` with:

```js
function mainAbility(kill) {
    const list = (kill && kill.reference && Array.isArray(kill.reference.abilities)) ? kill.reference.abilities : [];
    const a = list.find(x => x && x.name && !AUTO_ATTACK.has(x.name));
    return a ? a.name : 'spell';
}
```

`abilityStats` already returns abilities sorted by total damage descending, so `find` takes the biggest real one.

In `nukeRows`, the row compares the player's and the reference's average non-crit hit for `mainAbility`. Now that auto-attacks are excluded, `main` can be `'spell'` when the reference has nothing else; skip that pull rather than comparing a placeholder. Change:

```js
        const main = mainAbility(k);
        const mine = (k.me.abilities || []).find(a => a.name === main), theirs = (k.reference.abilities || []).find(a => a.name === main);
        if (!mine || !theirs || !num(mine.avgHit) || !num(theirs.avgHit)) return;
```

to:

```js
        const main = mainAbility(k);
        if (main === 'spell' || AUTO_ATTACK.has(main)) return; // ref-above B2: no white-hit comparisons
        const mine = (k.me.abilities || []).find(a => a.name === main), theirs = (k.reference.abilities || []).find(a => a.name === main);
        if (!mine || !theirs || !num(mine.avgHit) || !num(theirs.avgHit)) return;
```

Add `AUTO_ATTACK` to `module.exports`. `mainAbility` is already exported there — do not add it twice.

- [ ] **Step 4: Run the suite, then every suite**

Run: `node vet-checklist.test.js 2>&1 | tail -2` then `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: `0 failed` everywhere.

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js
git commit -m "fix(checklist): an auto-attack is never the ability the advice names (ref-above B2)"
```

---

### Task 5: role-aware wording and the night's tier

**Files:**
- Modify: `vet-checklist.js` (`nukeRemainder` ~line 282, `nukeRows` text ~line 312, `castingRows` fix ~line 80, `renderReport` title ~line 419)
- Test: `vet-checklist.test.js`

**Interfaces:**
- Produces: nothing new exported. `nukeRows`' text says "attack power" for melee/ranged/tank and "spell power" otherwise; `nukeRemainder` says "ability rank" for both; the cast-pacing fix drops the cast-queue clause for physical roles; `renderReport`'s title uses `facts.night.zoneName` when present.

- [ ] **Step 1: Write the failing tests**

Append to `vet-checklist.test.js`. Reuse the file's existing `gapKill` helper and whatever `facts`-shaped builder the neighbouring `nukeRows` tests use — read them first and follow the same construction.

```js
// --- ref-above C1: a melee report never says "spell power", and the title names the right tier
test('nukeRows (ref-above C1): the power word follows the role', () => {
    // Sáiden, a Retribution paladin, read "you had 673 spell power, they had 835".
    const melee = nukeFacts({ role: 'melee', myPower: 673, refPower: 835 });
    const text = C.nukeRows(melee).map(r => r.text).join(' ');
    assert.ok(/attack power/.test(text), 'melee reads attack power: ' + text);
    assert.ok(!/spell power/.test(text), 'and never spell power: ' + text);
    const caster = nukeFacts({ role: 'caster', myPower: 1099, refPower: 1016 });
    assert.ok(/spell power/.test(C.nukeRows(caster).map(r => r.text).join(' ')), 'a caster is unchanged');
});
test('nukeRemainder (ref-above C1): the remainder clause says ability rank, not spell rank', () => {
    const text = C.nukeRows(nukeFacts({ role: 'melee', myPower: 673, refPower: 835 })).map(r => r.text).join(' ');
    assert.ok(!/spell rank/.test(text), 'no spell rank for a melee: ' + text);
});
test('renderReport (ref-above C1): the title names the night\'s tier, not the gating tier', () => {
    // Utopik's night was BT / Hyjal; his profile gates on SSC / TK, and the title said SSC / TK.
    const facts = reportFacts({ tierZone: 'SSC / TK', nightZone: 'BT / Hyjal', nightDate: '2026-09-06' });
    const out = C.renderReport(C.buildChecklist(facts), facts);
    assert.ok(/BT \/ Hyjal/.test(out.split('\n')[0]), 'title: ' + out.split('\n')[0]);
    assert.ok(!/SSC \/ TK/.test(out.split('\n')[0]), 'title: ' + out.split('\n')[0]);
    const noNight = reportFacts({ tierZone: 'SSC / TK', nightZone: null, nightDate: null });
    assert.ok(/SSC \/ TK/.test(C.renderReport(C.buildChecklist(noNight), noNight).split('\n')[0]), 'an all-kills report still names the gating tier');
});
```

Write the two helpers `nukeFacts({ role, myPower, refPower })` and `reportFacts({ tierZone, nightZone, nightDate })` next to the tests, building the minimal `facts` shape those functions read — `nukeRows` needs `player.role`, kills with `gap`, `reference.abilities`, `me.abilities` with `avgHit`, and the `power_gear`/`power_consumables`/`power_buffs`/`debuffs` inputs; `renderReport` needs `player`, `tier`, and optionally `night`. Model them on the helpers already in this file. Use a non-auto-attack main ability so Task 4's skip does not fire. The checklist builder is `buildChecklist` and it is already exported.

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-checklist.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 3 FAILs — "spell power" present for a melee, "spell rank" present, and the title carrying the gating tier.

- [ ] **Step 3: Implement**

In `nukeRemainder`, change all three `'spell rank'` occurrences to `'ability rank'`.

In `nukeRows`, the function already computes `const role = (facts.player && facts.player.role) || 'caster'`. Add below it:

```js
    // ref-above C1: the same role test passRows uses for its power word.
    const powerWord = (role === 'melee' || role === 'ranged' || role === 'tank') ? 'attack power' : 'spell power';
```

and in the returned row's `text`, replace the two hardcoded phrases:

- `' at the same spell power'` becomes `' at the same ' + powerWord`
- `' (you had ' + worst.myPower + ' spell power, they had '` becomes `' (you had ' + worst.myPower + ' ' + powerWord + ', they had '`

In `castingRows`, make the cast-pacing fix role-aware. Replace the `fix:` line of the `cast_rate` row with:

```js
        fix: (i, k) => {
            const role = (facts.player && facts.player.role) || 'caster';
            // ref-above C1: a melee or hunter does not queue casts — they press the button more
            // often. Only a caster gets the cast-queue and movement-filler advice.
            if (role === 'melee' || role === 'ranged' || role === 'tank') return 'Press ' + mainAbility(k) + ' more often; the gap is presses, not gear.';
            return 'Queue the next ' + mainAbility(k) + ' before the current one lands; move only when you must, and use ' + (MOVEMENT_FILLER[spec] || MOVEMENT_FILLER.default) + ' while moving.';
        } });
```

In `renderReport`, replace the title line:

```js
    const out = [p.name + ' — ' + (p.spec || '?') + ', ' + (tier.zoneName || '') + ', ' + head];
```

with:

```js
    // ref-above C1: a single night's report names that night's tier. The gating tier is only
    // right for an across-all-kills report, and since nights now span both tiers it was wrong
    // whenever the chosen night came from the non-gating one.
    const zoneName = (facts.night && facts.night.zoneName) || tier.zoneName || '';
    const out = [p.name + ' — ' + (p.spec || '?') + ', ' + zoneName + ', ' + head];
```

- [ ] **Step 4: Run the suite, then every suite**

Run: `node vet-checklist.test.js 2>&1 | tail -2` then `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: `0 failed` everywhere.

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js
git commit -m "fix(checklist): attack power for melee, ability rank, and the night's own tier (ref-above C1)"
```

---

### Task 6: shares are presented as shares

**Files:**
- Modify: `vet-gap.js` (`gapFindings` ~line 352), `vet-checklist.js` (`renderReport` `val` ~line 416)
- Test: `vet-gap.test.js`, `vet-checklist.test.js`

**Interfaces:**
- Produces: `gapFindings` skips inputs whose `share` is negative (in addition to today's `share < min` and `owner === 'noise'`); `renderReport`'s `val(r)` prints nothing when `r.value` is above 100.

- [ ] **Step 1: Write the failing tests**

Append to `vet-gap.test.js` (follow the file's existing helpers for building a kill with gap inputs):

```js
// --- ref-above C2: a share is never shown outside 0-100%
test('gapFindings (ref-above C2): an input the player is BETTER on is not a finding', () => {
    // Tipsi's real Anetheron pull: cast_pacing +169%, rotation -62%. The negative one says he hits
    // harder per cast than the reference, which is not a fix.
    const kill = gapKillWithInputs({ cast_pacing: 169, rotation: -62 });
    const keys = G.gapFindings(kill, { role: 'melee' }, {}).map(f => f.key);
    assert.ok(keys.includes('cast_pacing'), 'the positive share is still reported: ' + keys.join(','));
    assert.ok(!keys.includes('rotation'), 'the negative share is not: ' + keys.join(','));
});
```

Append to `vet-checklist.test.js`:

```js
test('renderReport (ref-above C2): a share above 100% is printed without a percentage, not as "169%"', () => {
    const facts = reportFacts({ tierZone: 'BT / Hyjal', nightZone: 'BT / Hyjal', nightDate: '2026-09-06' });
    const cl = C.buildChecklist(facts);
    const row = cl.rows.find(r => r.id === 'cast_rate') || cl.rows[0];
    row.value = 169;
    const out = C.renderReport(cl, facts);
    assert.ok(!/169%/.test(out), 'no 169% anywhere: ' + out);
    assert.ok(!/~1\d\d%/.test(out), 'no three-digit share at all: ' + out);
    row.value = 54;
    assert.ok(/\(~54%\)/.test(C.renderReport(cl, facts)), 'an ordinary share still prints');
});
```

Reuse `reportFacts` from Task 5; if the row ids differ in your build output, adapt the lookup but keep the assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-gap.test.js 2>&1 | grep -E "FAIL|passed"` and `node vet-checklist.test.js 2>&1 | grep -E "FAIL|passed"`
Expected: 1 FAIL in each — the negative input is currently reported, and `169%` is currently printed.

- [ ] **Step 3: Implement**

In `vet-gap.js`, in `gapFindings`, change the skip condition from:

```js
        if (i.owner === 'noise' || i.share < min) return;
```

to:

```js
        // ref-above C2: a negative share means the player is AHEAD of the reference on this input.
        // True, and not a fix — reporting it as one is how "damage per cast -62%" became advice.
        if (i.owner === 'noise' || i.share < min || i.share < 0) return;
```

(The `i.share < min` test already excludes negatives when `min` is positive; the explicit clause states the intent and holds if `minShare` is ever set to 0.)

In `vet-checklist.js`, change `renderReport`'s `val`:

```js
    // ref-above C2: shares above 100% happen when two inputs offset (Tipsi: cast pacing +169%
    // against damage per cast -62%). The arithmetic is sound but "169% of the gap" means nothing
    // to a reader, and clamping to 100% would assert something the accounting did not measure —
    // so the finding stands on its text alone.
    const val = r => (r.value !== null && r.value !== undefined && r.value <= 100 ? ' (~' + r.value + '%)' : '');
```

- [ ] **Step 4: Run every suite**

Run: `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: 11 suites, all `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-checklist.js vet-gap.test.js vet-checklist.test.js
git commit -m "fix(feedback): never show a share outside 0-100%, and never report one the player wins (ref-above C2)"
```

---

### Task 7: the reference is no longer "comparable"

**Files:**
- Modify: `vet-gap.js` (`REF_LABEL` line 311), `vet-checklist.js` (16 occurrences), `vet-feedback.js` (11 occurrences)
- Test: the three suites above (expectation updates only)

**Interfaces:**
- Produces: no new interface. `GAP.REF_LABEL` becomes `'players ahead of you at your item level'`.

- [ ] **Step 1: Find every occurrence**

Run: `grep -rn "comparable players" vet-checklist.js vet-gap.js vet-feedback.js | wc -l`
Expected: 28. Read each one before changing it — some are in comments explaining history and must stay as they are; only user-visible strings change.

- [ ] **Step 2: Change the label and the strings**

In `vet-gap.js`:

```js
const REF_LABEL = 'players ahead of you at your item level';
```

In every user-visible string across the three files, `comparable players` becomes `players ahead of you`. Two lines need more than a substitution — in `renderReport`:

```js
        out.push('You do ' + v.ratioPercent + '% of what ' + GAP.REF_LABEL + ' do.' + (parts.length ? ' ' + parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : ''));
```

(the parenthetical `(' + GAP.REF_LABEL + ')` is dropped because the label is now the subject of the sentence), and in the "Where you stand" line:

```js
        cl.stand.forEach(s => out.push(s.name + ': you ' + s.me + (s.sameClass.length ? '; ' + cls + 's in your raid ' + s.sameClass.join(' / ') : '') + '; players ahead of you ' + s.dps + '; the best at your item level ' + s.topDps));
```

Leave comments alone: a comment that explains why v2 chose the leaderboard middle is history and stays accurate as history.

- [ ] **Step 3: Update the test expectations**

Run each suite and update every assertion that pins the old wording. These are wording assertions, not behaviour: changing them is correct here. Do NOT change any assertion that is checking a number.

- [ ] **Step 4: Run every suite**

Run: `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: 11 suites, all `0 failed`.

Then confirm nothing user-visible was missed:
Run: `grep -rn "comparable players" vet-checklist.js vet-gap.js vet-feedback.js | grep -v "^\S*: *//" | grep -v "\* "`
Expected: no user-visible strings remain; anything printed is a comment.

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-checklist.js vet-feedback.js vet-gap.test.js vet-checklist.test.js vet-feedback.test.js
git commit -m "docs(feedback): the reference is players ahead of you, and says so (ref-above C3)"
```

---

### Task 8: the five real players again

**Files:**
- Create (scratchpad, not committed): a re-run script in your scratchpad directory
- Modify: `README.md` only if its feedback bullet describes the reference as the middle of the leaderboard

**Interfaces:**
- Consumes: everything above.

This task proves the change on live data. The same five players were run before the change; their reports are the baseline this is judged against.

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | grep -E "passed|FAIL"`
Expected: 11 suites, all `0 failed`.

- [ ] **Step 2: Start the server against the real API**

From the worktree: `PORT=3777 node server.js` in the background (`.env` holds the credentials; it is a symlink and works). Confirm with `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3777/vetting.html` → `200`.

- [ ] **Step 3: Re-run the five players**

For each of `Sáiden` (URL-encode the accent), `Utopik`, `Tipsi`, `Funkell`, `Lovestoned`:

```bash
curl -s -H 'Sec-Fetch-Site: same-origin' \
  "http://127.0.0.1:3777/api/vet/feedback?name=<NAME>&server=spineshatter&region=eu&zone=1060&report=X6mnbPQpGhjJC2TN" \
  -o <scratchpad>/<name>-after.json
```

Print each report's `.report` text in full and paste all five verbatim into your report.

- [ ] **Step 4: Check each fixed symptom by name**

Confirm, quoting the line that proves each:

1. Sáiden's nuke row says **attack power**, not spell power.
2. No report contains "Queue the next Melee" or "Queue the next Auto Shot"; the physical ones name a real ability.
3. No report contains "the rank of Melee".
4. Funkell is not told to cast **Aspect of the Viper** or **Misdirection**; Tipsi is not told to cast **Hamstring**; Utopik is not told to cast **Ambush**.
5. Utopik's title says **BT / Hyjal**, and he now has an accounting — a gap against a reference above him — rather than only a flask line.
6. No report prints a share above 100% (Tipsi's was 169%).
7. Lovestoned's report is still good: the Shadow Bolt nuke row, the Curse of Doom assignment line and the missing Prayer of Spirit are all still there. **This is the regression check** — the caster case was already correct and must stay correct.

If any check fails, that is a real defect: fix it, re-run, and report both runs.

- [ ] **Step 5: Measure the request cost**

The reference cache key now includes the player's amount bucket, which can reduce sharing between players. Count WCL requests for one player before and after by logging them, or report the wall-clock time of each of the five runs against the pre-change timings (Sáiden's pre-change run took 13 s). State plainly whether cost went up, and by how much.

- [ ] **Step 6: Stop the server**

`pkill -f "wowstuff-logsfirst/server.js"` and confirm with `pgrep -fl "wowstuff-logsfirst/server.js"` that nothing remains.

- [ ] **Step 7: README and commit**

If `README.md`'s feedback bullet describes the reference, update it to say the comparison is against players ahead of the reader at their item level. Commit only if it changed:

```bash
git add README.md
git commit -m "docs: the feedback report compares against players ahead of you"
```

---

## Plan self-review

**Spec coverage:** §A (reference above the player) → Tasks 1–2; §B (nobody above them) → Task 2's ceiling test; §C (materiality gate) → Task 3; §D (auto-attacks) → Task 4; §E (share presentation) → Task 6; §F (label bugs) → Task 5; §G (wording) → Task 7; Error handling (too few candidates, missing amounts, 429) → Task 2's fallbacks; Testing items 1–4 → Tasks 2, 3, 4/5, 6; the live re-run → Task 8.

**Type consistency:** `pageOrderFrom(start, L, maxPages)` is defined in Task 1 and consumed by Task 2's `collect`. `getReference`'s new inputs `playerAmount` / `playerRankPercent` are set at the call site in Task 2 and read there only. `T.abilityMinShare` is added and read in Task 3. `AUTO_ATTACK` and `mainAbility` are defined in Task 4 and consumed by Task 5's cast-pacing fix. `GAP.REF_LABEL` changes value in Task 7 and is read in `vet-checklist.js` as it already is.

**Known risk carried into execution:** Task 2's cache-key change is the only place request cost can rise; Task 8 Step 5 measures it. Task 2 Step 4 is also where fixture churn lands — the size is not known until it runs, and the instruction there is to regenerate expected values rather than loosen assertions.
