# Debuff Coverage Expansion — branch state

**Read this file first.** It is the single entry point for the `debuff-coverage` branch.

Last updated: 2026-08-12, after all six plans completed and their final reviews closed.

---

## 1. Where things stand

| | |
|---|---|
| Branch | `debuff-coverage`, in worktree `/Users/maxvanzoelen/wowstuff/.claude/worktrees/debuff-coverage` |
| HEAD | `ce4ab5f` |
| Working tree | clean |
| Suite | **148 passed, 0 failed** (`node assignments-engine.test.js`) |
| `main` | untouched at `bb838f9`, still deployable (Railway deploys from `main`) |
| Commits on branch | 41, none squashed — one per task, plus fix waves |

| Plan | State |
|---|---|
| 1 — `2026-08-11-catalog-rules-and-warning-split.md` | ✅ complete, 5 tasks + fix wave |
| 2 — `2026-08-11-providers-and-expose-armor.md` | ✅ complete, 4 tasks + fix wave |
| 3 — `2026-08-11-rss2-wire-format.md` | ✅ complete, 2 tasks + fix wave |
| *(owner request)* drop Judgement of Light | ✅ complete, commit `178b122` |
| 4 — `2026-08-11-group-layout-proposer.md` | ✅ complete, 4 tasks + fix wave `a322d5a` |
| 5 — `2026-08-11-greater-blessings-grid.md` | ✅ complete, 4 tasks + fix wave `faf10db` |
| 6 — `2026-08-11-rotations-and-remaining-debuffs.md` | ✅ complete, 4 tasks + fix wave `ce4ab5f` |

**All six plans are done and every whole-plan review is closed.** The branch is ready to merge,
subject to section 5 (the one thing that still needs a live WoW client).

## What the branch adds, end to end

- **Debuff catalog rules**: `missing` vs `notApplicable` warning split, TBC judgement rules,
  applicability gates, and an ordered provider list so a duty can be covered by more than one class.
- **Improved Expose Armor** displacing Sunder, and attack-power providers (Demoralizing Roar, Screech).
- **RSS2 wire format**: the addon now exports subgroup and race; RSS1 still parses forever.
- **Group layout proposer**: a five-party TBC layout with per-group buff explanations and a
  draenei-spreading pass.
- **Greater Blessings grid**: a paladin × class matrix, auto-filled by paladin spec, with gap and
  duplicate warnings, editable per cell, in the Discord output.
- **Rotations**: Fear Ward and Tranquilizing Shot as ordered lists rather than single assignments,
  reorderable in the UI and present in every output surface.
- **Four remaining debuffs**: Thunder Clap, Insect Swarm, Scorpid Sting, Hemorrhage.

---

## 2. Decisions the owner has made — DO NOT RE-ASK

Re-asking a settled question is the worst failure mode here. All were verified empirically before
being put to the owner.

1. **Plan 1 Task 3** — the plan's `buildDiscord` test asserted `!out.includes('Judgement of the
   Crusader')` over the whole message, which is impossible. → **Narrow the assertions to the
   `⚠ Uncovered:` line.** *This precedent has since been reused twice; see decision 12.*
2. **Plan 1 Task 5** — renaming the resto druid to `Aardvark` only temporarily restores the
   alphabetical coincidence that makes the test toothless. → **Keep `Aardvark` permanently.**
   *This is the single most-reused ruling on the branch; see decision 13.*
3. **Plan 1 final review** — the legacy flat-array `uncovered` assertion could not fail. → **Fix it
   the same way (isolate the warning line).**
4. **Plan 1 final review** — the `minClassCount`/`applicableWhen` guards ran before the override
   branch, silently discarding manual overrides. → **Move the guards below the override branch.**
   (Contradicts Plan 2 Task 1 Step 4 — the moved order wins.)
5. **Plan 1 final review** — a lone Ret paladin spends their judgement on JoC, leaving JoW missing.
   → **Keep the plan's behaviour.** Sanity-check on raid night.
6. **Plan 2 final review** — `providersOf` dropped an entry-level `caution` on a providers entry.
   → **Merge the entry caution into each provider.**
7. **Plan 2 final review** — the override path never consulted `groupUsed`, so overrides could put
   two curses on one warlock. → **Enforce group exclusivity on overrides too.**
8. **Plan 3 final review** — `group`/`race` reached only one of three roster sources, and editing a
   player destroyed them. → **Fix both**, and carry them through `recompute`.
9. **Owner ruling, unprompted** — *"Seal of light is pretty useless... it should mainly be crusader
   and wisdom. Judgement of light can be disregarded."* → **`jol` deleted from the catalog.**
   Only `joc` and `jow` remain, and `joc`-before-`jow` ordering is load-bearing.
10. **Plan 4 fix wave** — the approved relabel used an alphabetical tie-break, which titled the card
    holding both main tanks "Casters". → **A tie keeps the role the group was created for; only a
    strict majority renames a group.**
11. **Plan 5, four rulings** — panel headings keep their `N ·` ordinals and get renumbered;
    `GREATER_BLESSINGS` is four entries (**Sanctuary and Greater Light dropped**); the third paladin
    **withholds Greater Salvation from any class holding a tank** (Protection, or a Feral druid),
    because a Greater Blessing hits the whole class and cannot be withheld from the tank
    individually; a fourth paladin's row is all-null by default and is skipped in Discord.
12. **Plan 5 fix wave** — `WARRIOR` and `WARLOCK` both truncated to `WAR`, making Discord blessing
    lines ambiguous. → **One shared `CLASS_ABBREV` map exported from the engine**, used by both the
    grid header and the Discord line so they cannot drift. `WARLOCK` → `LOCK`.
13. **Plan 5 Task 3** — the reconcile split the cell key on the FIRST pipe, so a paladin whose name
    contained `|` had every edit deleted by the same render that saved it. → **Split on the LAST
    pipe**; class tokens never contain one. No name validation, key format unchanged.
14. **Plan 6** — **Hemorrhage is gated with `applicableWhen`** so a raid with no Subtlety rogue files
    it as `notApplicable` rather than warning forever. Insect Swarm deliberately still warns;
    Improved Scorch, Winter's Chill and Faerie Fire are untouched.
15. **Plan 6 Task 3** — **Thunder Clap prefers ARMS over Protection.** Improved Thunder Clap is an
    Arms talent a prot warrior may have skipped, and would apply only half the intended −20%.
16. **Plan 6 fix wave** — rotations reached the Discord post and no other surface, so a priest on the
    Fear Ward rotation was told nothing at all. → **Add rotations to whispers, the `/raid` macro and
    the addon export**, each member told their own slot. **A rotation stays shrink-only — no "+ add"
    control.** A stale rotation override is swept; if the sweep empties it, the override is dropped
    so auto-assignment resumes, but newly-joined players are never inserted into a curated order.

---

## 3. How to work on this — instructions, not background

These habits caught every real defect on this branch.

- **Every plan had at least one wrong step.** Ten owner escalations across six plans. The dominant
  defect class, by a wide margin, is **a test that cannot fail** — it passed whether or not the
  behaviour under test existed. When a plan hands you a test verbatim, ask what would have to break
  for it to fail, and **prove it by deleting the code and watching the suite**.
- **Mutation-test, do not reason.** Reasoning about coverage produced false confidence repeatedly;
  deleting a rule and running the suite produced truth every time. Plan 5's whole-plan review found
  the plan's *central owner-ruled mechanic* had zero coverage this way. Plan 6's ran 30 mutants and
  found 7 survivors.
- **Coverage is not a one-time property.** Plan 6 Task 1 proved a fixture falsifiable; Plan 6 Task 3
  silently neutralised it by adding a catalog entry that changed duty counts. Re-run key mutations
  at the end of a plan, not only when the test is written.
- **Verify reviewer claims yourself, in both directions.** Several findings were sharp and correct.
  But one reviewer's *justification for downgrading* a finding ("names are unique system-wide") was
  false and checkable in one command; another's claim that assertions were unfalsifiable was also
  wrong. Run the `node -e` snippet.
- **A parked finding can be wrong.** Plan 6 Task 2 parked a stale-override issue as "harmless at
  render". It was not — it silently deleted an entire rotation row on the weekly re-import workflow.
  The whole-plan review caught it. Re-examine parked items rather than trusting the parking.
- **The owner wants to be asked before deviating from a plan**, and wants genuine TBC-mechanics
  uncertainties flagged rather than silently resolved. Batch questions; give a recommendation and a
  concrete code preview for each option.
- **Never report a task complete without pasting real test output.**
- **Each task ends with its own commit. Do not squash.**
- Follow `superpowers:subagent-driven-development`: fresh implementer per task, task review between
  tasks, whole-plan review at the end, ledger updated as you go.

---

## 4. Harness notes — hard-won, not in any plan

**Tests:** `node assignments-engine.test.js` from the worktree root. Prints `N passed, M failed`,
exits non-zero on failure. There is no Lua test harness and **no `lua`/`luac` binary on this
machine** — addon changes can only be reviewed by careful reading.

**Browser verification:** there is no browser tool in this harness. A CDP driver lives in the
session scratchpad as `cdp.js` (usage: `node cdp.js <url> <script-file>`); adapted per-feature
drivers sit beside it (`verify-blessings.js`, `verify-rotations.js`) and are the better starting
point. If the scratchpad is gone, rewrite it — it launches Chrome with `--remote-debugging-port`,
drives it over the global `WebSocket`, collects console output and page exceptions, evaluates a
script file, and **must call `process.exit()` explicitly** or the spawned Chrome keeps the event
loop alive forever.

Gotchas that cost real time:
- **`cdp.js` gets a fresh Chrome profile per invocation**, so two separate invocations CANNOT test
  `localStorage` persistence. Use one Chrome session with two `Page.navigate` calls —
  `verify-blessings.js` does exactly that.
- **`Clear roster` calls `confirm()`**, which blocks headless Chrome. Stub `window.confirm = () => true`.
- **Never click the `Share link` button** — it hangs on the clipboard API. Build the view URL directly:
  `assignments-view.html?data=<encodeURIComponent(base64(JSON({title, sheet, roster})))>`.
- **Top-level `let roster` / `let state` in `assignments.js` are reachable by bare reference** from
  an evaluated expression (global lexical environment) but are *not* on `window`.
- Chrome cold start can exceed two minutes; run browser checks as background tasks.
- Start the app with `npm start` (serves `http://localhost:3000`). `npm install` is needed once per
  worktree; `node_modules` is gitignored.

**Traps in the codebase itself:**
- **`.group` means three different things**: `player.group` (raid subgroup, Number 1–8),
  catalog `entry.group`/`prov.group` (curse/judgement exclusivity key, String), and
  `proposeGroups`' own `{role, players}` objects. Do not let them meet in an `Object.assign`.
- **Duty shape is not uniform.** Every duty carries `player: String` **except** `category: 'rotations'`
  duties, which carry `players: [String]` and no `player` at all. Existing consumers stay safe by
  filtering on truthy `d.player`; that containment is now pinned by a test.
- **`rankPool` sorts by `specRank` first, then duty count, then `a.name.localeCompare(b.name)`.**
  That name tiebreak is why a fixture in alphabetical order proves nothing about `preferSpecs` —
  see decision 2. Several test fixtures are deliberately named anti-alphabetically (`Zdiscy`,
  `Ashadow`, `Zbeastly`, `Zarms`, `Zsurv`, `Aegis`, `Aimer`).
- **The test helper `P()` builds players with no `group`/`race` keys**, so most engine tests run on
  the pre-RSS2 shape. Real rosters from all three sources carry both as `null`.
- **`proposeGroups` returns aliased roster player objects.** Its purity rests on nobody writing
  through those references, and is pinned by a test.
- **The pinned RSS1 fixture** is the parse guard for the whole branch. When a wire format grows,
  *add* a fixture — never migrate this one.
- **`buildAddonWhispers`' 255-char budget is counted in UTF-16 units while WoW enforces UTF-8 bytes.**
  They agree only because all duty text is ASCII. Never emit non-ASCII on the whisper or `/raid`
  paths.

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

## 6. Deferred minors — triaged, none block merge

Every whole-plan review triaged these explicitly.

**Correctness nits, low reach**
- `minClassCount` is dead code and a trap: it reads `entry.class`, which is `undefined` on a
  providers entry, so `minClassCount: 2` there would gate the row `notApplicable` forever. Nothing
  uses it. Delete it when convenient.
- `providersOf` aliasing is asymmetric — provider entries return the catalog's own array by
  reference; single-class entries return fresh objects.
- Clearing a row flips its label (cleared `armor` reads "Major armor reduction", assigned reads
  "Improved Expose Armor").
- `Demoralizing Roar` uses `preferSpecs`, so a Balance/Resto druid can be auto-assigned a Bear Form
  ability.
- `|| provs[0]` in the override branch has no test.
- The draenei tie-break can abandon a legal swap when a group holds a draenei filler before a
  draenei shaman.
- A malformed subgroup drops the *player*, not the group. Unreachable today.
- An empty roster puts `joc` in `notApplicable`, and suppresses the no-paladin blessing warning.
- Stale localStorage override keys (`sunder`, `demo`) are never pruned; dead `state.blessings` keys
  survive for a player who stays on the roster but stops being a paladin.
- The blessings duplicate warning fires once per (class, blessing) and stays silent for a third
  paladin casting the same blessing on the same class.
- `proposeBlessings` is computed twice per render (once for `sheet.blessings`, once for the grid).
  The argument for fixing it is divergence, not cost.
- An all-empty blessings grid prints a bare `**Blessings**` heading with no bullets. Reachable only
  by deliberately nulling every cell of the first paladin.

**Output and UX**
- **The greedy group layout is arguably visibly poor on a real 25-man**: rogues end up with the
  hunters, and a rogue plus two mages with the tanks. The plan defers the hill-climb polish pass
  until "real rosters produce visibly poor layouts" — this one plausibly qualifies. Owner's call.
- Note-rule false negatives: Strength of Earth/Wrath of Air are available to *every* shaman in TBC,
  not only Enhancement/Elemental; Battle Shout's `spec !== 'Protection'` means a tank group never
  claims it; there is no Trueshot Aura rule despite hunters being bucketed separately to get it.
- Every group note is a deep-talent claim rendered with a `✓` and no hedge, against the spec's
  "spec is a proxy, never proof".
- **A rotation can only shrink.** `✕` is one-way until `Auto-assign` clears every override; there is
  no add-back control. Owner ruled this acceptable. `ROTATIONS` is exported and consumed by nothing,
  which is exactly the hook a future "+ add" control would use.
- **The share-link view page shows neither blessings nor rotations.** Known and accepted, flagged by
  both plans. `sheet.blessings` is serialized into every share URL regardless.
- The ⓘ caution affordance is a non-focusable `<span>` with only a `title` — not keyboard or
  screen-reader accessible. The blessing-grid selects likewise have no accessible name, and the
  grid `<th>`s no `scope`; the pre-existing duty selects share both gaps.
- The page shows Rotations *after* Crowd Control while Discord shows it *before*. Both are as the
  plans prescribed.
- `renderGroups()` runs before `renderOutput()` in `renderAll`, so a future throw there would kill
  the Discord output. Structural, not currently reachable.

**Documentation and hygiene**
- `SubgroupOf`'s name-scan fallback is unreachable and its comment claims otherwise.
- Nothing tells a raider to update the addon. RSS1 works forever by design, so the rollout is silent
  and indefinite. The README documents `GruulPositions` but never `RaidSpecScan`.
- Commits `cba7f75` and `e7982c3` have empty bodies.
- Stale test names remain in a few places; the empty-roster assertion `missing.length >= 8` is loose
  (the actual value is 10); the RSS2 parser tests sit after the `autoAssign` tests.
- The rewritten whispers test still ends with one hard-coded name (`!names.includes('Bubbles')`),
  which goes stale if a future catalog entry ever gives a Protection paladin a duty.
- Two near-vacuous `proposeGroups` tests remain: "scarce shamans go to melee first, then casters"
  never asserts the casters half, and "a roster with no race data is unaffected" compares
  `race: null` against a fixture with no `race` field.

---

## 7. Open questions — real TBC mechanics uncertainties, deliberately unresolved

- **Faerie Fire (Feral) as a TBC Feral talent** — the sole reason Feral outranks Resto on `ff`. If a
  Feral cannot cast it in form in 2.5.x, collapse `preferSpecs` back to `['Balance']`.
- **Scorpid Sting / Insect Swarm stacking in 2.5.x** — stacked in 2.4.3 per the 3.0.2 patch note
  wording, but a Blizzard EU report suggests TBC Classic may have shipped the WotLK exclusivity.
  The `caution` on `sting` is deliberately hedged. **Test in-game before relying on both at once**;
  if they do not stack, the two entries should become one row with two providers.
- **Improved Demo Shout vs untalented Curse of Weakness** — the −420/−350 numbers are verified, but
  which a given player has is invisible to the addon.
- **Totem of Wrath's exact effect** (+3% spell hit and crit) — worth a second check.
- **Improved Expose Armor is a 2-point Subtlety talent** most Combat rogues skip. A Combat rogue on
  that row may be applying unimproved Expose (2050), which is *worse* than a maxed Sunder stack.
  Fix if seen: make the rogue provider `requireSpec: 'Subtlety'`.
- **Improved Thunder Clap is an Arms talent.** The entry now prefers Arms for exactly this reason,
  but a raid whose only warrior is Protection may still be applying −10% rather than −20%.
- **Screech is a pet ability** and only a BM hunter reliably has a screeching pet family up.
- **Feral druids bucket as melee, always** — a feral tank belongs in the tank group, but bear and cat
  are indistinguishable from tab totals. The blessings grid treats Feral as a tank for the Salvation
  rule, deliberately erring toward not giving a bear Salvation.
