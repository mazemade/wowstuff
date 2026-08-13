# Debuff Coverage Expansion — branch state

**Read this file first.** It is the single entry point for the `debuff-coverage` branch.

Last updated: 2026-08-13, after the eighth plan (talent catalog expansion) completed — six tasks,
each task-reviewed, with one fix round on task 3.

---

## 1. Where things stand

| | |
|---|---|
| Branch | `debuff-coverage`, in worktree `/Users/maxvanzoelen/wowstuff/.claude/worktrees/debuff-coverage` |
| HEAD | `d397f87` (last code commit; the docs commit that wrote this line sits on top of it) |
| Working tree | clean (`TalentProbe/` is an untracked throwaway diagnostic addon — leave it alone) |
| Suite | **200 passed, 0 failed** (`node assignments-engine.test.js`) |
| `main` | untouched at `bb838f9`, still deployable (Railway deploys from `main`) |
| Commits on branch | 65, none squashed — one per task, plus fix waves |

| Plan | State |
|---|---|
| 1 — `2026-08-11-catalog-rules-and-warning-split.md` | ✅ complete, 5 tasks + fix wave |
| 2 — `2026-08-11-providers-and-expose-armor.md` | ✅ complete, 4 tasks + fix wave |
| 3 — `2026-08-11-rss2-wire-format.md` | ✅ complete, 2 tasks + fix wave |
| *(owner request)* drop Judgement of Light | ✅ complete, commit `178b122` |
| 4 — `2026-08-11-group-layout-proposer.md` | ✅ complete, 4 tasks + fix wave `a322d5a` |
| 5 — `2026-08-11-greater-blessings-grid.md` | ✅ complete, 4 tasks + fix wave `faf10db` |
| 6 — `2026-08-11-rotations-and-remaining-debuffs.md` | ✅ complete, 4 tasks + fix wave `ce4ab5f` |
| 7 — `2026-08-12-talent-aware-assignments.md` | ✅ complete, 6 tasks + 2 task-review fixes + fix wave `bb14fff` |
| 8 — `2026-08-13-talent-catalog-expansion.md` | ✅ all 6 tasks complete and task-reviewed, + fix round `723165d` on task 3; final code commit `d397f87`. **Whole-plan review not yet run.** |

**All eight plans are done.** Whole-plan reviews are closed for plans 1–7; **plan 8's is still
outstanding** — its six tasks were each reviewed, but nothing has yet looked at the plan end to end.
**Two things gate the merge, not one:** that outstanding whole-plan review, and section 5 (the one
thing that still needs a live WoW client).

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
- **Three remaining debuffs**: Thunder Clap, Insect Swarm, Hemorrhage. (Scorpid Sting was added, then
  removed by owner ruling in plan 7 — it is not worth a hunter's sting slot.)
- **Talent-aware assignments**: `RaidSpecScan` 3.0 resolves four tracked talents *by English name* at
  scan time and exports them as `key=rank` pairs in a new **RSS3** wire format with fixed,
  independently-optional fields. The engine holds the same keys with a max rank and display name — no
  coordinates anywhere. `rankPool` gained a leading tier, **talented → unknown → known-untalented**,
  ahead of the existing spec preference, on the four rows where spec-guessing is measurably wrong
  (`armor`, `ap`, `tclap`, `joc`). Each such row renders a `qualifier` explaining its pick
  (`Improved Expose Armor 2/2`, `no Improved Expose Armor`, `talent unknown`) in the Assignments
  panel and the Discord output only — never on the length-bound whisper or `/raid` paths.
- **Talent catalog expansion**: `RaidSpecScan` **3.1** tracks **15** talents rather than 4 (the 11
  new ones are `kings`, `impMight`, `impWisdom`, `malediction`, `impFaerieFire`, `feralAggression`,
  `insectSwarm`, `impScorch`, `wintersChill`, `impHuntersMark`, `hemorrhage`), and the same 15 keys
  are held engine-side under the parity test. Three things follow from the bigger table:
  **(a) four more `improvedBy` rankers** — `coe` (Malediction), `ff`, `hm`, and the Demoralizing
  Roar provider on `ap`; **(b) `requireTalent` gates** on the four rows where the talent *is* the
  spell rather than an improvement — `scorch`, `wc`, `swarm`, `hemo` — replacing the tree-total spec
  proxy with the real rank via one `gateAllows(p, key, fallbackSpec)`, so a talented off-spec player
  gets the row and a known-untalented on-spec one does not, while unknown data degrades to exactly
  today's behaviour; **(c) the provider loop is two-pass**, so a provider whose best candidate is
  *known* untalented yields its row to the next provider (pass 2 accepts anyone, so a known-
  untalented candidate still beats an empty row). The Greater Blessings grid became talent-aware
  too: plan→paladin matching uses the same three-tier ordering, Greater Kings is gated on the
  `kings` talent, and two warnings were added (nobody can cast Kings; a manual Kings cell on a
  paladin known to lack it).

## What is planned next, not yet started

**Nothing is in flight.** Plan 8 closed the cross-provider selection gap that this section described
as the largest remaining product gap: `autoAssign`'s provider loop now demotes a provider whose best
candidate is known-untalented, so a rogue with no Improved Expose Armor loses `armor` to the Sunder
warrior and an untalented Demoralizing Shout loses `ap` to Curse of Weakness. The engine work this
branch set out to do is done.

**The gate is section 5, not more code.** Every remaining item needs a live WoW client or an owner
ruling, not another plan:

1. **Re-install `RaidSpecScan` (3.0 → 3.1) and run section 5.** The installed copy is still 3.0 and
   now differs from the worktree — none of the 15-talent export exists in-game yet, so no section 5
   check can pass until it is copied over. This is the only thing standing between the branch and a
   merge decision.
2. **Improved Curse of Weakness**, if it exists in 2.5.x, is a one-line `improvedBy` on the Curse of
   Weakness provider — deliberately left out of plan 8 because nobody could confirm the talent
   exists. See section 5 and section 7.
3. **The group layout's quality is an open owner's call** (section 6) — the greedy pass produces
   arguably poor 25-man layouts, and the hill-climb polish was deferred until real rosters showed
   it. They plausibly have.
4. **The share-link view page still shows neither blessings nor rotations** (section 6), which is the
   largest remaining *output* gap now that the selection gaps are closed.

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
  at the end of a plan, not only when the test is written. Plan 8 ended with an 11-mutant sweep
  against the final tree — 0 survivors, every mutant killed by at least the tests predicted for it,
  several by more. **Run the sweep on scratch copies that include `RaidSpecScan/`**: the parity test
  reads the Lua via `path.join(__dirname, ...)` and fails spuriously without it, which reads as a
  killed mutant when it is really a broken harness. Make an unmatched search string a hard error in
  the runner, too — a stale search string that silently matches nothing looks exactly like a
  survivor.
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
exits non-zero on failure.

**Lua:** there is no Lua *test* harness, but **`luajit` IS available** at
`/opt/homebrew/bin/luajit` (LuaJIT 2.1, Lua 5.1 syntax — the same dialect WoW uses). Syntax-check
any addon change with:

```
luajit -b RaidSpecScan/RaidSpecScan.lua /dev/null
```

All four addons (`RaidSpecScan`, `RaidAssign`, `GruulPositions`, and the throwaway `TalentProbe`)
compile clean as of 2026-08-12. This does not execute anything or resolve WoW globals, so it
catches syntax and nothing else — behaviour still needs a live client. *(Earlier revisions of this
file claimed no Lua binary existed and that addon changes could only be reviewed by reading. That
was wrong.)*

**Shell working directory:** commands run from this worktree can silently reset to the primary
checkout at `/Users/maxvanzoelen/wowstuff`. It happened three times in one session, and one
verification pass reported `69 passed` and addon v1.0 — `main`'s files, not the branch's. **Use
absolute paths, or `cd` to the worktree at the start of every command.** A test count that looks
wrong by a lot is the tell.

**Browser verification:** there is no browser tool in this harness. The CDP driver lives in the
worktree at **`.superpowers/tools/cdp.js`** (usage: `node cdp.js <url> <script-file>`); adapted
per-feature drivers sit beside it (`verify-blessings.js`, `verify-rotations.js`) and are the better
starting point. *(Earlier revisions of this file said these live in the session scratchpad. Stale.)*
It launches Chrome with `--remote-debugging-port`,
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
  *add* a fixture — never migrate this one. **What "never migrate" protects is the RSS1 input string
  and the roster identity it pins, not the field count of the parsed player object.** Twice now a
  wire format has added a field to every player (`98c88ce` added `group`/`race`, plan 7 added
  `talents`), and both times the right move was to add the new key to the expected objects while
  leaving the input string byte-identical and `deepStrictEqual` unrelaxed.
- **`assignments.js` cannot be `require`d by the test suite** — it touches `document` and
  `localStorage`. The repo's workaround is to *mirror* its logic into the test file (the `I1:` tests).
  That is fine for an algorithm and useless for a one-line field re-attach, where the mirror passes
  whether or not the browser file contains the line. Verify those over CDP instead.
- **The addon and the engine share talent keys across a string.** A test now reads
  `RaidSpecScan.lua`, parses `TRACKED_TALENTS`, and asserts key/name/class parity with the engine's
  `TALENTS`. Before it existed, an addon-side rename was invisible to every test.
- **`buildAddonWhispers`' 255-char budget is counted in UTF-16 units while WoW enforces UTF-8 bytes.**
  They agree only because all duty text is ASCII. Never emit non-ASCII on the whisper or `/raid`
  paths.

---

## 5. Unverified — needs the owner, before release

**⚠ The installed addon is STALE. Re-install before running anything below.** Plan 8 bumped
`RaidSpecScan` to **3.1** (15 tracked talents); the copy in `/Applications/World of Warcraft/
_anniversary_/Interface/AddOns/RaidSpecScan/` is still **3.0** and now differs from the worktree —
checked 2026-08-13. Until it is copied over, every talent added by plan 8 is simply absent from the
export, and the new rows read `talent unknown` in-game no matter how correct the engine is. The
worktree copy is syntax-clean under `luajit`. Nothing below has been run — no live client has been
available to any session that has worked on this file.

Plan 3's RSS2 checks are superseded by RSS3, so run this consolidated list once, in a real raid:

1. The export begins **`RSS3;`** (not `RSS2;` — if it says RSS2 the game loaded a stale copy).
2. Lines carry a subgroup matching the actual raid frames.
3. Race tokens are English even on a non-English client.
4. `/specscan` outside a raid still prints "You must be in a raid." and nothing else.
5. Pasting the export into the web tool produces the same roster it would have before, plus
   talent-driven picks on the four wired rows.
6. For **at least two players of different classes**, the `key=rank` digits match their actual talent
   panes — spot-check two talents each.
7. **A player who has NOT taken a tracked talent must read `=0`, not be missing from the field.** This
   is the whole three-state model: "we know they lack it" must stay distinguishable from "we have no
   data". If it is missing instead, the talent name in the addon's `TRACKED_TALENTS` does not match
   the client's — check the spelling with `/tprobe target <partial name>` before suspecting the
   ranking logic.
8. A player who cannot be inspected still appears, with `?` for points and an empty talent field.
9. On a real rogue known to lack Improved Expose Armor: the armor row says so rather than claiming it.
10. **Scan a player whose class differs from yours** and confirm their talent field is right. The
    addon sizes its loop with `GetNumTalentTabs()`/`GetNumTalents(tab)` without an `isInspect`
    argument, so the bounds come from the *scanner's* trees. Analysis says this cannot bite today —
    all four tracked talents sit at tier 2-3 (index ≲12) while the smallest TBC tree has ~17-19
    talents, and over-iteration is absorbed harmlessly — but it becomes live the moment anyone tracks
    a deep talent. Worth confirming once.
11. **`/tprobe`-verify all 11 talent names and `maxRank`s added by plan 8**, one player per affected
    class (paladin, warlock, druid, mage, hunter, rogue): `kings`, `impMight`, `impWisdom`,
    `malediction`, `impFaerieFire`, `feralAggression`, `insectSwarm`, `impScorch`, `wintersChill`,
    `impHuntersMark`, `hemorrhage`. **These are English strings typed from a design doc, never
    captured from the client**, and a mismatch is silent: a wrong *name* omits the key, which reads
    as a permanently `talent unknown` row rather than an error, and a too-low *`maxRank`* makes a
    legitimate rank read as unknown (that one at least shows up in `talentDrift`). `wintersChill`
    (5) and `impWisdom` (2) are the least certain max ranks. Check the spelling with
    `/tprobe target <partial name>` before suspecting the ranking logic.
12. **Confirm whether `Improved Curse of Weakness` exists in 2.5.x at all**, and if it does, report
    its exact name, ranks and effect. It would become a one-line `improvedBy` on the Curse of
    Weakness provider in `ap` — deliberately *not* part of plan 8, because the talent could not be
    confirmed to exist. Until then that provider is ranked by `preferSpecs` alone.
13. **A paladin without the Kings talent**: the grid must refuse to auto-assign them Greater Kings,
    and when *no* paladin has it the warning must read
    `Nobody can cast Blessing of Kings — it is a Protection talent.` Both were verified in a headless
    browser against a synthetic roster; what is unverified is that a real scan reports `kings=0`
    rather than omitting the key.

---

## 6. Deferred minors — triaged, none block merge

Every whole-plan review triaged these explicitly. The plan 8 block below is the exception — those
items were raised by task reviews and are still awaiting that plan's whole-plan review.

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

**From plan 7 (talent-aware assignments)**
- `talentDrift` is exported and rendered by nothing. Deliberate — it exists so addon/engine key drift
  is diagnosable from a test or a console call. Wiring it into the UI is a follow-up.
- `talentDrift` lacks the `typeof`/`isNaN` guard `talentRank` has, so a numeric string `"9"` would be
  unknown to one and drift to the other. Unreachable from the wire — the parser validates against
  `^\w+=\d+(,\w+=\d+)*$` and stores `Number()`. Left visible rather than papered over.
- Neither talent function rejects a negative or fractional rank. `\d+` cannot produce either.
- `rankPool`'s rank sub-sort overlaps `talentTier` in effect rather than being orthogonal, which is
  why the plan's own prescribed mutation had a blast radius of one test. Harmless; now commented.
- **`talentTier`'s `if (!entry.improvedBy) return 0;` short-circuit is an equivalent mutant** —
  deleting it leaves the suite green, because `talentRank(p, undefined)` returns `null` for every
  candidate and the tier stays uniform. It is redundancy in the code, not a hole in the tests.
  Recorded so no future reviewer files it as a finding.
- **The `recompute()` talents re-attach has no node-suite regression guard.** `assignments.js` is
  browser-only and cannot be `require`d by the test file; a mirrored test would pass with the line
  deleted, which is this branch's worst defect class. It was proven both ways over CDP instead. The
  invariant is now named in a comment at the field list — that list has been missed twice.
- An override to an off-class player inherits the first provider's `improvedBy`, so overriding
  `armor` to a mage renders `Improved Expose Armor — Bob (talent unknown)`. Consistent with the
  pre-existing label fallback; the qualifier just makes it more visible.
- Error-message priority drifted for a line with two simultaneous violations (class and duplicate
  name are now checked before the subgroup range). No accepted input changes.

**From plan 8 (talent catalog expansion)**
- **The four `requireTalent` rows now render `(talent unknown)` on a roster with no talent data,
  where they previously rendered nothing.** `scorch`, `wc`, `swarm` and `hemo` gained a
  `requireTalent`, and the qualifier follows from `entry.improvedBy || entry.requireTalent`. This is
  plan-mandated and consistent with the `improvedBy` rows shipped by plan 7, but it is a **visible
  output change for Raid-Helper-only rosters**, which never carry talents — those four rows will
  read `talent unknown` for every such raid. Task 3 flagged it for the owner to sign off; no
  response is recorded. If the answer is no, the fix is at the qualifier, not the gate — the
  *selection* behaviour on unknown data is unchanged from before the plan.
- **`proposeBlessings`' `planOf` is keyed by paladin name**, which extends the branch's pre-existing
  name-uniqueness assumption into the plan-matching path. Two paladins with the same name would now
  share a plan slot as well as colliding elsewhere. The parser already rejects duplicate names, so
  this is not reachable from the wire.
- **The provider loop now ranks every provider on every call** instead of short-circuiting at the
  first non-empty pool — that is what lets pass 1 look at each provider's best candidate. Verified
  side-effect-free (`rankPool` sorts a copy and `eligible` is a predicate) and measured harmless at
  raid scale, since the extra work is bounded by the number of providers on an entry, which is at
  most three.
- **One pre-existing test was repointed, the only one this plan changed:** `autoAssign: a row
  without improvedBy carries no qualifier` used `hemo` as its no-qualifier example. `hemo` gained a
  `requireTalent` and therefore a qualifier, so the test now uses the `armor` row's Sunder provider,
  which has neither field. It additionally pins that a provider without `improvedBy` does not
  inherit one. The invariant is unchanged; only the row exercising it moved.

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

- ~~**Faerie Fire (Feral) as a TBC Feral talent**~~ — **RESOLVED 2026-08-12, no code change.** The
  owner confirmed a Feral can cast it in form, and that the wanted order is Balance > Feral > Resto.
  `preferSpecs: ['Balance', 'Feral']` already produces exactly that: Balance rank 0, Feral rank 1,
  everyone else 99.
- ~~**Scorpid Sting / Insect Swarm stacking in 2.5.x**~~ — **RESOLVED 2026-08-12 by removing the
  entry.** The owner ruled Scorpid Sting not worth a hunter's sting slot, so the stacking question
  is moot. Removal is **Task 1 of `docs/superpowers/plans/2026-08-12-talent-aware-assignments.md`**
  and has not landed yet — the `sting` entry and its hedged `caution` are still in the catalog until
  that task runs.
- ~~**Improved Demo Shout vs untalented Curse of Weakness**~~ — **RESOLVED, plan 7 then plan 8.**
  Plan 7 made the rank visible (`improvedBy: 'impDemoShout'` picks the best-talented warrior for the
  row); plan 8's two-pass provider loop closed the cross-provider half, so a warrior *known* to lack
  Improved Demoralizing Shout now loses `ap` to Curse of Weakness rather than outranking it at −300
  vs −350. Unknown talent data still keeps the warrior, which is the intended degrade-to-today rule.
  The one piece left is not this question: **whether `Improved Curse of Weakness` exists in 2.5.x**
  and should rank the warlock in turn — see section 5 check 12.
- **Totem of Wrath's exact effect** (+3% spell hit and crit) — worth a second check.
- ~~**Improved Expose Armor is a 2-point Subtlety talent**~~ — **RESOLVED, plan 7 then plan 8.** Plan
  7 fixed it within the rogue pool: the row picks the rogue who actually has it, regardless of spec,
  and says so. The `requireSpec: 'Subtlety'` fix contemplated here is still the wrong move — it
  would exclude a Combat rogue who *did* take the talent. Plan 8 closed the cross-provider case that
  survived: if the best rogue is *known* to lack it, `armor` now goes to the Sunder warrior instead.
  A rogue whose talents are unknown still takes the row, as before.
- ~~**Improved Thunder Clap is an Arms talent**~~ — **RESOLVED by plan 7.** `improvedBy:
  'impThunderClap'` reads the real rank, so a Protection warrior who took it now wins the row over an
  Arms warrior who did not, and the row states the rank it found.
- **Screech is a pet ability** and only a BM hunter reliably has a screeching pet family up.
- **Feral druids bucket as melee, always** — a feral tank belongs in the tank group, but bear and cat
  are indistinguishable from tab totals. The blessings grid treats Feral as a tank for the Salvation
  rule, deliberately erring toward not giving a bear Salvation.
