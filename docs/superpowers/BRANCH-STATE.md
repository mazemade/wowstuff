# Debuff Coverage Expansion — branch state and resume guide

**Read this file first.** It is the single entry point for the `debuff-coverage` branch. The four
per-plan ledgers under this directory hold the detail; this file holds what a fresh session needs
before touching anything.

Last updated: 2026-08-12, after Plan 4's tasks completed and its final-review fix wave was approved
but not yet applied.

---

## 1. Where things stand

| | |
|---|---|
| Branch | `debuff-coverage`, in worktree `/Users/maxvanzoelen/wowstuff/.claude/worktrees/debuff-coverage` |
| HEAD | `b76c3d8` |
| Working tree | clean |
| Suite | **112 passed, 0 failed** (`node assignments-engine.test.js`) |
| `main` | untouched at `bb838f9`, still deployable (Railway deploys from `main`) |
| Commits on branch | 20, none squashed — one per task, plus fix waves |

| Plan | State |
|---|---|
| 1 — `2026-08-11-catalog-rules-and-warning-split.md` | ✅ complete, 5 tasks + fix wave |
| 2 — `2026-08-11-providers-and-expose-armor.md` | ✅ complete, 4 tasks + fix wave |
| 3 — `2026-08-11-rss2-wire-format.md` | ✅ complete, 2 tasks + fix wave |
| *(owner request)* drop Judgement of Light | ✅ complete, commit `178b122` |
| 4 — `2026-08-11-group-layout-proposer.md` | 4 tasks ✅ reviewed; **final fix wave approved, NOT applied** |
| 5 — `2026-08-11-greater-blessings-grid.md` | not started |
| 6 — `2026-08-11-rotations-and-remaining-debuffs.md` | not started |

**Resume at:** Plan 4's final-review fix wave. Six items, exact code, in
`2026-08-11-group-layout-proposer/progress.md` under `<<< RESUME HERE >>>`. The RED tests for it are
saved at `2026-08-11-group-layout-proposer/pending-fix-wave-tests.patch` — re-apply with
`git apply` from the worktree root. They fail for exactly the two predicted reasons, confirming both
bugs are real. Expected suite after the wave: 115 passed, 0 failed.

Then: Plan 4 fix-wave re-review → Plan 5 → Plan 6 → `superpowers:finishing-a-development-branch`.

---

## 2. Decisions the owner has already made — DO NOT RE-ASK

Re-asking a settled question is the worst failure mode here. All nine were verified empirically
before being put to them.

1. **Plan 1 Task 3** — the plan's `buildDiscord` test asserted `!out.includes('Judgement of the
   Crusader')` over the whole message, which is impossible (`fullRoster()` covers `joc` as a real
   duty). → **Narrow the two assertions to the `⚠ Uncovered:` line.**
2. **Plan 1 Task 5** — the plan said to rename the resto druid to `Aardvark` only temporarily, which
   restores the alphabetical coincidence that makes the test toothless. → **Keep `Aardvark`
   permanently in that one test.**
3. **Plan 1 final review** — the legacy flat-array `uncovered` assertion could not fail. → **Fix it
   the same way (isolate the warning line).**
4. **Plan 1 final review** — the `minClassCount`/`applicableWhen` guards ran before the override
   branch, silently discarding manual overrides on gated entries. → **Move the guards below the
   override branch.** (This contradicts Plan 2 Task 1 Step 4's "keep the guards above this
   untouched" — the moved order wins.)
5. **Plan 1 final review** — a lone Ret paladin spends their judgement on JoC, leaving JoW missing.
   → **Keep the plan's behaviour.** Flagged as a mechanics call to sanity-check on raid night.
6. **Plan 2 final review** — `providersOf` dropped an entry-level `caution` on a *providers* entry
   despite its comment promising otherwise. → **Merge the entry caution into each provider.**
   (Matters for Plan 6, which adds a `caution` to Scorpid Sting.)
7. **Plan 2 final review** — the override path never consulted `groupUsed`, so overrides could put
   two curses on one warlock. → **Enforce group exclusivity on overrides too**, falling through to
   the provider loop so the row still gets covered.
8. **Plan 3 final review** — `group`/`race` reached only one of three roster sources, and editing a
   player destroyed them. → **Fix both**: default `null` in `parseRaidHelper` and the manual form,
   and carry both through `recompute`.
9. **Owner ruling, unprompted** — *"Seal of light is pretty useless... it should mainly be crusader
   and wisdom. Judgement of light can be disregarded."* → **`jol` deleted from the catalog
   entirely.** Only `joc` and `jow` remain, and `joc`-before-`jow` ordering is load-bearing.

**Pending, approved, not yet applied:** Plan 4's six fix-wave items (label groups by dominant
occupant; gate the Windfury note on composition not label; delete the panel caveat; pin purity; CSS
flex fix; two stale comments). Detail in Plan 4's ledger.

---

## 3. How to work on this — instructions, not background

These are the habits that caught the real defects. They will not emerge from the ledger by itself.

- **Every plan so far has had at least one wrong step.** Four of the nine escalations were the same
  defect class: *a test that cannot fail*. Plans 5 and 6 will very likely have more. When a plan
  hands you a test verbatim, ask what would have to break for it to fail — and if the answer is
  "nothing", prove it by temporarily breaking the code, then restore it.
- **Verify reviewer claims yourself before acting on them.** Several review findings were sharp and
  correct; at least one ("reordering lets a wrong-class override fabricate a duty") turned out to be
  pre-existing behaviour the plan explicitly wanted, and was parked rather than fixed. Run the
  `node -e` snippet. Do not take a subagent at face value in either direction.
- **The owner wants to be asked before deviating from a plan**, and wants genuine TBC-mechanics
  uncertainties flagged rather than silently resolved. Batch questions; give a recommendation and a
  concrete code preview for each option.
- **Never report a task complete without pasting real test output.** If something fails, say so with
  the output rather than working around it.
- **Each task ends with its own commit. Do not squash.**
- Follow `superpowers:subagent-driven-development`: fresh implementer per task, task review between
  tasks, whole-plan review at the end, ledger updated as you go.

---

## 4. Harness notes — hard-won, not in any plan

**Tests:** `node assignments-engine.test.js` from the worktree root. Prints `N passed, M failed`,
exits non-zero on failure. There is no Lua test harness and **no `lua`/`luac` binary on this
machine** — addon changes can only be reviewed by careful reading.

**Browser verification:** there is no browser tool in this harness. A CDP driver for headless Chrome
lives in the session scratchpad at `cdp.js` (usage: `node cdp.js <url> <script-file>`). If the
scratchpad is gone, rewrite it — it launches Chrome with `--remote-debugging-port`, drives it over
the global `WebSocket`, collects console output and page exceptions, evaluates a script file, and
**must call `process.exit()` explicitly** or the spawned Chrome keeps the event loop alive forever.

Gotchas that cost real time:
- **`Clear roster` calls `confirm()`**, which blocks headless Chrome. Stub `window.confirm = () => true`.
- **Never click the `Share link` button** from headless Chrome — it hangs on the clipboard API.
  Build the view URL directly instead:
  `assignments-view.html?data=<encodeURIComponent(base64(JSON({title, sheet, roster})))>`.
- **Top-level `let roster` / `let state` in `assignments.js` are reachable by bare reference** from
  an evaluated expression (global lexical environment) but are *not* on `window`.
- Chrome cold start can exceed two minutes; run browser checks as background tasks.
- Start the app with `npm start` (serves `http://localhost:3000`). `npm install` is needed once per
  worktree; `node_modules` is gitignored.

**Traps in the codebase itself:**
- **`.group` means three different things**: `player.group` (raid subgroup, Number 1–8, from RSS2),
  catalog `entry.group`/`prov.group` (curse/judgement exclusivity key, String), and
  `proposeGroups`' own `{role, players}` objects. Do not let them meet in an `Object.assign`.
- **The test helper `P()` builds players with no `group`/`race` keys**, so most engine tests run on
  the pre-RSS2 shape. Real rosters from all three sources now carry both as `null`.
- **`proposeGroups` returns aliased roster player objects.** Its purity rests entirely on nobody
  writing through those references.
- **The pinned RSS1 fixture** (`RSS1 regression: a full raid export parses to exactly this roster`)
  is the parse guard for the whole branch. When a wire format grows, *add* a fixture — never migrate
  this one.

---

## 5. Unverified — needs the owner, before release

**Plan 3 Task 2 Step 6 requires a live WoW client.** Reported unverified, not done. Run before
release:
1. the export begins `RSS2;`
2. lines carry a subgroup matching the actual raid frames
3. race tokens are English even on a non-English client
4. `/specscan` outside a raid still prints "You must be in a raid." and nothing else
5. pasting the export into the web tool produces the same roster it would have before

---

## 6. Deferred minors, triaged

None block merge. Grouped by whether they are worth doing before the branch lands.

### Worth fixing before merge — they are traps for plans 5 and 6

- **`minClassCount` is dead code AND now a trap.** `joc` was its only user and no longer uses it.
  It reads `entry.class`, which is `undefined` on a providers entry, so `minClassCount: 2` on a
  provider row would evaluate `roster.filter(p => p.class === undefined).length` = 0 and gate the
  row `notApplicable` forever. Plan 2 said keep it; nothing uses it. Delete it.
- **`missing` vs `notApplicable` has one hand-written exception, not a rule.** `scorch` and `wc`
  (`requireSpec` on a class) report as *missing*, while `joc` (also `requireSpec`) reports as
  *notApplicable*. Plan 6 adds several more entries against this boundary. Settle it first —
  suggested rule: class absent ⇒ missing; spec absent within a present class ⇒ notApplicable.
- **`providersOf` aliasing is asymmetric** — provider entries return the catalog's own array by
  reference; single-class entries return fresh objects. A future consumer that sorts or mutates the
  result corrupts the catalog for provider rows only.
- **Panel heading ordinals will collide.** Plans 5 and 6 each append a panel before Output, so
  `4 · Output` → `5 · Output` → `6 · Output` rewrites the same two lines in `assignments.html`
  three times. Generate them or drop the ordinals.
- **`bucketOf`'s `default: return 'casters'`** silently absorbs unknown classes. Fine for a
  five-bucket layout, actively wrong for Plan 5's class-keyed blessings matrix. Do not reuse it
  there.

### Correctness nits, low reach

- Clearing a row flips its label (cleared `armor` reads "Major armor reduction", assigned reads
  "Improved Expose Armor") — the cleared path passes the raw entry.
- `Demoralizing Roar` uses `preferSpecs`, so a Balance/Resto druid can be auto-assigned a Bear Form
  ability. Same one-line fix the plan proposes for Screech.
- `|| provs[0]` in the override branch has no test; reachable by overriding a row then changing that
  player's class in the manual form.
- The draenei tie-break can abandon a legal swap when a group holds a draenei filler before a
  draenei shaman.
- A malformed subgroup drops the *player*, not the group — a raider could go quietly missing.
  Unreachable today (`GetRaidRosterInfo` only returns 1–8).
- An out-of-range subgroup masks an unknown-class error on the same line.
- An empty roster puts `joc` in `notApplicable` — predicate-false, not comp-excludes.
- The same player *object* appearing twice in a roster is placed once and never reported unplaced.
  Not reachable today (`recompute` builds fresh objects each render).
- Stale pre-fix localStorage manual entries read `undefined` until re-saved. Self-healing.
- Stale localStorage override keys (`sunder`, `demo`) are never pruned.

### Output and UX

- **The greedy layout is arguably visibly poor on a real 25-man**: rogues end up with the hunters
  and a rogue plus two mages with the tanks. The plan defers the hill-climb polish pass until "real
  rosters produce visibly poor layouts" — this one plausibly qualifies. Owner's call.
- Note-rule false negatives: Windfury/Strength of Earth/Wrath of Air are available to *every* shaman
  in TBC, not only Enhancement/Elemental; Battle Shout's `spec !== 'Protection'` means a tank group
  never claims it; there is no Trueshot Aura rule despite hunters being bucketed separately to get it.
- Every group note is a deep-talent claim rendered with a `✓` and no hedge, against the spec's
  "spec is a proxy, never proof".
- The share view drops `caution` but still serializes it into every share URL (~110 dead bytes).
- `notApplicable` is write-only in production and rides along in every share URL.
- The ⓘ caution affordance is a non-focusable `<span>` with only a `title` — not keyboard or
  screen-reader accessible, unlike the codebase's other icon affordances.
- `renderGroups()` runs before `renderOutput()` in `renderAll`, so a future throw there would kill
  the Discord output. Structural, not currently reachable.

### Documentation and hygiene

- `SubgroupOf`'s name-scan fallback is unreachable (`AddResult` is only ever called with `raidN`)
  and its comment claims otherwise.
- Nothing tells a raider to update the addon. RSS1 works forever by design, so the rollout is silent
  and indefinite. The README documents `GruulPositions` but never `RaidSpecScan`.
- Commits `cba7f75` and `e7982c3` have empty bodies; the latter was required to record Step 6's
  unverified status, which currently exists nowhere in the repo.
- Stale test names: "no warriors falls back **demo shout**", "overriding **demo** to a warlock",
  "requires a ret paladin, **not three paladins**" (builds two), and a comment claiming "No shipped
  entry uses `applicableWhen` until Task 4" when `joc` does.
- The empty-roster assertion `missing.length >= 8` is loose; the actual value is 10.
- The five RSS2 parser tests sit after the `autoAssign` tests rather than in the parser section.
- Two near-vacuous `proposeGroups` tests: "scarce shamans go to melee first, then casters" never
  asserts the casters half, and "a roster with no race data is unaffected" compares `race: null`
  against a fixture with no `race` field, so neither can distinguish a working pass from a deleted one.
- `buildAddonWhispers`' 255-char ASCII invariant: the caution string introduced U+2212 into catalog
  data for the first time. Safe today; the comment's assumption breaks silently if cautions ever
  reach whisper text.

---

## 7. Open questions the plans asked to have flagged

Real TBC-mechanics uncertainties, deliberately not resolved:

- **Faerie Fire (Feral) as a TBC Feral talent** — the sole reason Feral outranks Resto on `ff`. If a
  Feral cannot cast it in form in 2.5.x, collapse `preferSpecs` back to `['Balance']`.
- **Scorpid Sting / Insect Swarm stacking in 2.5.x** — stacked in 2.4.3 per the 3.0.2 patch note
  wording, but a Blizzard EU report suggests TBC Classic may have shipped the WotLK exclusivity.
  Plan 6 depends on this. Test in-game before relying on the stacking.
- **Improved Demo Shout vs untalented Curse of Weakness** — the −420/−350 numbers are verified, but
  which a given player has is invisible to the addon.
- **Totem of Wrath's exact effect** (+3% spell hit and crit) — worth a second check, it drives group
  scoring copy.
- **Improved Expose Armor is a 2-point Subtlety talent** most Combat rogues skip. A Combat rogue on
  that row may be applying unimproved Expose (2050), which is *worse* than a maxed Sunder stack.
  Fix if seen: make the rogue provider `requireSpec: 'Subtlety'`.
- **Screech is a pet ability** and only a BM hunter reliably has a screeching pet family up.
- **Feral druids bucket as melee, always** — a feral tank belongs in the tank group, but bear and cat
  are indistinguishable from tab totals.

**Known and accepted, not bugs:** the share-link view page shows neither blessings nor rotations
(Plans 5 and 6 both note this).

---

## 8. Starting a fresh session

Suggested opening prompt:

> Continue the debuff-coverage branch. Work in the existing worktree at
> `.claude/worktrees/debuff-coverage` — do not touch `main`. Read
> `.superpowers/sdd/README.md` first, then
> `.superpowers/sdd/2026-08-11-group-layout-proposer/progress.md`. Resume at Plan 4's final-review
> fix wave, then finish plans 5 and 6 using `superpowers:subagent-driven-development`.

Per-plan detail lives in:
- `2026-08-11-catalog-rules-and-warning-split/progress.md`
- `2026-08-11-providers-and-expose-armor/progress.md`
- `2026-08-11-rss2-wire-format/progress.md`
- `2026-08-11-group-layout-proposer/progress.md`

Note this whole directory is **git-ignored**. It survives a normal session but not `git clean -fdx`.
If it is ever lost, `git log` is the record — every task committed separately with a descriptive
message, and the plans themselves are committed at `19ed0b0`.
