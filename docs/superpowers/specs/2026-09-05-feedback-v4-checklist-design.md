# Feedback report v4: a checklist, not a note

Date: 2026-09-05. Replaces the report layer of v1 (`2026-09-04-parse-feedback-report-design.md`
§5–6), v2 (`…-fair-reference-and-log-selection-design.md` §7–8) and v3
(`…-feedback-v3-gap-accounting-design.md` §4–6). The measurements (v1 §2–4, v2 §3–6, v3 §3)
stay as they are; this spec changes what is built from them, how it is worded, and where it is
shown. Approved in conversation on 2026-09-05 as "option 1": deterministic report, model removed.

## 1. Problem

The v3 note for Lovestoned (Destruction, 5 live pulls, 8 bad pulls) ran ~700 words, said the
same thing several times, contradicted itself, and its one big item ("tighten your ability
choices") was not advice. Every cause is structural:

1. **Habits are reported per boss.** `ability_unused`, `ability_extra`, `curse_choice` and
   `no_potion` are keyed by boss (`GROUPED_KEYS`, `findingId`), so one habit became four
   Destruction Potion lines, three curse lines and two Shadowburn lines.
2. **The 3% floor is applied per pull, then averaged.** A 4% input on one pull becomes a
   "worth 1%" line over five pulls, and three of those survived.
3. **Positives contradict findings** on the same topic (spell power "matches or beats" next
   to "1006 against 1044"; "active 90%+ on 2 of 5" next to an activity finding).
4. **The completeness guard re-appends** findings the model had already folded into a grouped
   sentence; that is the whole "Also:" tail.
5. **No cap + "do not drop any finding" + 450 words** cannot all hold; the model chose
   completeness.
6. **"Rotation" is a remainder sold as advice.** It is whatever power, hit, debuffs and crit
   did not explain; the prompt then demanded "one concrete fix" and the model invented one.
7. **The prose was the model's.** Every vague sentence in the note was written by the model
   from a facts sheet that had nothing vaguer in it.

Verified live against WCL on 2026-09-05 (memory `feedback-v4-checklist-direction`):
every warlock in Lovestoned's raid lands at 936–1372 DPS on Void Reaver where comparable raids'
warlocks land 1875–2334; her raid has no Shadow Weaving or Misery on any pull; Curse of Doom is
up 84–95% in her raid from another warlock, so her Curse of the Elements is an assignment and the
three curse lines were wrong; she does run Demonic Sacrifice and Fel Armor. What is actually hers:
no Destruction Potion on 4 of 5 pulls, elixirs instead of a flask on every pull, 12–15% fewer
Shadow Bolts a minute while active, and a Shadow Bolt non-crit hit ~20% under comparable players
at equal spell power, of which raid debuffs explain about half and logs cannot show the rest.

Models looked at: tbc-audit.com (verdict naming two things + "pick one to focus on next raid",
then graded categories with ✓/✗ rows: "YOU 20.1/MIN · TOP 100 24/MIN"), WoWAnalyzer (checklist +
suggestions ranked by importance, major/minor), ParseForge (suggestions ranked by impact).

## 2. Principles

- **One habit, one row.** Every check aggregates over the live pulls and appears at most once.
- **Fixed fix text.** Each check id has a fix sentence written in code. No generated prose.
- **Hard shape, hard caps.** The report cannot grow past its sections' limits (§5).
- **Honest about what logs cannot see.** A remainder is called a remainder.
- **The player's raid is context.** Same-class players in the same pull are shown next to the
  reference, because "you are mid-pack in a raid without a shadow priest" is the truth the leader
  needs.
- **No model.** The number guard, the completeness guard, the "Also:" appendix, the 60-second
  wait and the OpenAI cost all existed to police the model. They go.

## 3. Data: what changes in the facts sheet

Everything v1–v3 measure stays (`kills[]` with `me`, `reference`, `fight`, `debuffs`, `gap`,
`hitCap`; `overall.badPulls`, `overall.ceiling`, `overall.gap`, `nights`, `night`, `gear`,
`limited`). Changes:

- `kill.fight.sameClass: [{ name, amount, isMe }]` — every non-pet row of the fight-wide
  DamageDone table whose `type` equals the player's class, `amount` = total / fight seconds,
  rounded, sorted descending. Computed in `fightContext` from data already fetched; no new WCL
  query.
- `POTION_LABEL`, `UTILITY_CAST`, `RACIAL` and `ENCOUNTER_ITEM` move to `vet-gap.js` (re-exported by
  `vet-feedback.js` under the same names) so the checklist module can use them without a
  circular require. `gearFindings` rows gain `value` (the measured number) and `bar` (the
  threshold or effective cap) next to their `text`.
- `kill.findings` (per-pull raw findings from `killFindings`) stays, as the source the checklist
  aggregates from and as the facts-table tooltip. `overall.findings` and `overall.positives` are
  **removed**; `overall.checklist` (§4) replaces them.
- The response of `GET /api/vet/feedback` becomes `{ facts, report, generatedAt }` where
  `report` is the plain text of §5 rendered server-side from `facts.overall.checklist`.
  `reportError` is gone. The `Sec-Fetch-Site` gate, caches, in-flight dedup and thresholds
  handling are unchanged.

## 4. The checklist (`vet-checklist.js`, pure, Node-only)

`buildChecklist(facts, thresholds) → { verdict, rows, fixFirst, also, asks, fine, stand, notOnYou }`
(`thresholds` = the `T` object of `vet-feedback.js`; the module carries its own defaults for the
five it reads: `potionMinSec` 60, `unusedPerMin` 1.5, `unusedPerFightCooldown` 1, `extraPerMin` 1,
`ratioLow` 0.7), then `renderReport(checklist, facts) → string`. `fixFirst`, `also`, `asks` and
`fine` are arrays of row ids in render order; `rows` holds every row.

### 4.1 Row shape

```
{ id, category, owner: 'player' | 'group' | 'raid', verdict: 'fail' | 'warn' | 'pass' | 'info',
  me, reference, unit, pulls: { hit, of }, value, text, fix, measuredOn }
```

`value` is the row's estimated share of the DPS gap in whole percent, or null. `text` is the
measured sentence ("Destruction Potion: 0 used on 4 of 5 pulls; comparable players use 1–2 a
pull"). `fix` is the fixed sentence for the id. `measuredOn` names the pull the numbers come from
(largest-share pull, v2 rule). `pulls.hit` is the number of live pulls on which the check failed,
`pulls.of` the number of live pulls on which it could be measured.

### 4.2 Aggregation rules (apply to every check)

- Inputs are the live pulls (`!fight.badPull`). A check that could be measured on no live pull is
  omitted, not shown as pass.
- Share-based checks (rows that come from `kill.gap` inputs) use the **average share over the
  pulls that have an accounting** (v3 §3.7, unchanged) — a pull where the input is absent counts
  0 — and the floor is applied **once, to the average**: `fail` at ≥ 5%, `warn` at 3–4%, `pass`
  otherwise. This replaces v3 §4's per-pull `minShare`.
- Habit checks (consumables, potions, cooldown timing, unused abilities) fail when they fail on
  **at least half** of the pulls where they could be measured; otherwise `warn` if they failed at
  least once, else `pass`. Their `value` is the nominal from `NOMINAL_VALUE` (§4.4), or the
  accounting share where one exists (consumables → `power_consumables`).
- Numbers shown are from `measuredOn` (largest share, or first failing pull for habit checks).
- A `pass` row is only rendered inside "Fine" (§5), and only for the ids in `FINE_IDS`.
- The v3 dedupe rules that were fighting per-boss keys are gone with the keys; the one that
  matters is kept in the check definitions: a stat is never both an accounting row and a gear
  row (`STAT_COVERED_BY`).

### 4.3 Checks

**Consumables** (owner player; from `me.consumablesKnown` pulls)
- `flask` — fail: no flask on the pull while `reference.flaskShare ≥ 0.5`. `text` names what
  the player had ("Elixir of Draenic Wisdom + Major Shadow Power") and the reference flask.
  `fix`: "Run <reference flask> at every pull." Value: `power_consumables` share, else nominal.
  Subsumes v3 `no_flask_or_elixirs` (fail even without the reference when neither flask nor both
  elixirs) and `wrong_elixir`.
- `food` — fail: no Well Fed at the pull. `fix`: "Eat before every pull."
- `oil` — fail: reference `consumablesAtPull` majority has a wizard/mana oil and the player has
  none. `fix`: "Put <oil> on your weapon."
- `potion` — fail: `me.potionUse` = 0 (or the reference's damage potion never cast by the player
  while the reference uses it ≥ 0.5 a pull, taken from `ref.casts` / `POTION_LABEL`) on a pull
  longer than `T.potionMinSec`. `text`: "Destruction Potion: 0 on 4 of 5 pulls; comparable
  players use 1–2 a pull (up to N in a fight this long)", N = `floor(duration / 120) + 1`.
  `fix`: "Pop one on the pull and again every two minutes." Value:
  `min(6, NOMINAL_VALUE.potion × max(1, round(median reference potions per failing pull)))`. Subsumes `no_potion` and the potion half of `ability_unused`.

**Cooldowns** (owner player)
- `burst_timing` — from v2 §6: a trinket or potion used but never inside Bloodlust on a pull that
  had Bloodlust, where the reference fires it inside. `fix`: "Hold <item> for Bloodlust."
- `bloodlust` — owner group: reference had Bloodlust, player had none. Goes to asks.

**Casting** (owner player; share-based)
- `cast_rate` — `cast_pacing` input: "N damaging casts a minute while active against M."
  `fix`: "Queue the next <main ability> before the current one lands; move only when you must,
  and use <instant> (Shadowburn / Life Tap …, from `MOVEMENT_FILLER[spec]`) while moving."
- `activity` — `own_activity` input (accounting pulls) or v2 `active_low` (pulls without one):
  "Active N% against M% for comparable players (your raid: R%)". `fix`: "Keep casting through
  transitions; if an assignment took you off the boss, tell the raid leader so it is counted as
  not on you."
- `channel` — `channel_time` input. `fix`: "Drain Soul only in the last seconds; never channel
  while the boss is targetable."
- `life_taps` — `info`, never graded (tbc-audit's rule): "Life Tap N a minute; comparable
  players M."

**Spell choice** (owner player unless stated)
- `unused` — one row: abilities in `ref.casts` at ≥ `T.unusedPerMin` or ≥
  `T.unusedPerFightCooldown` per pull that the player never casts, aggregated over pulls
  (an ability counts when unused on at least half the pulls the reference used it on). Excludes
  curses, `RACIAL`, `ENCOUNTER_ITEM`, `UTILITY_CAST`, potions (→ `potion`). `text`: "Never cast:
  Shadowburn (comparable players 0.4–1.3 a minute)". `fix` from `ABILITY_FIX[name]` where known
  (Shadowburn: "Use it while moving and under 25% boss health when you have shards"), else "Use
  it as comparable players do."
- `under_used` — v3 `ability_ratio`, one row, same aggregation. `warn`.
- `extra` — v3 `ability_extra`, one row, `info` (a raid assignment as often as a mistake).
- `curse` — owner **group**, `warn` (so it reaches the asks): when the reference's most-cast curse differs from the
  player's; the reference curse named is the one most of the differing pulls ran, with the
  damage share from the first pull that ran it. `text`: "You run Curse of the Elements
  (assignment); comparable players run Curse of Doom, N% of their damage." No fix for the player; the ask reads "Rotate the Elements
  assignment or give it to the warlock with the lowest DPS." Replaces `curse_choice`; never
  more than one row.

**Nuke damage** (owner player)
- `nuke_hit` — replaces the `rotation` remainder. Main ability = reference's top ability by
  damage share. Compare non-crit `avgHit` (player vs reference): observed = mine / theirs.
  Expected = `((myPower + K) / (refPower + K)) × (myDebuff / refDebuff)` where each side's power
  is the sum of the `me` / `reference` values of the pull's `power_gear`, `power_consumables` and
  `power_buffs` accounting inputs, `K = POWER_BASE[role]`, and the debuff multipliers are the
  `debuffs` input's `me` / `reference` (both 1 when that input has null values). Residual =
  observed / expected, averaged over the accounting pulls where both sides have a non-crit
  average for the main ability; numbers from the pull with the lowest residual. `fail` when the
  average residual < 0.9, `warn` < 0.95, else `pass`. `text`: "Shadow Bolt hits for 3065 non-crit against 3869 at the same
  spell power; raid debuffs explain about 10%, the remaining 15% is talents, spell rank or
  gear that logs cannot show." `fix` from `NUKE_FIX[spec]` (Destruction: "Check Shadow and
  Flame 5/5, Ruin, Shadow Bolt rank 11 and Demonic Sacrifice on a Succubus"; Fire: "Check
  Incinerate/Fireball rank and Fire Power 5/5"; …; default: "Check your talents and the rank of
  <ability>"). Value: the `rotation` share.
- `hit` — from the **current profile** first (`gear_hit` finding: 185 against 202), falling back
  to the pull's `hit_under_cap` input when the profile has no hit. One row only. `fix`: "Reach
  <cap> hit before any other stat." Value: `hit_under_cap` share when positive, else nominal
  1 per percent under the cap.

**Gear** (owner player)
- `stat_<key>` — `statPriorityFindings` rows (stat under 90% of the reference's, in priority
  order, gated by hit as today), `warn`. `fix`: "Prefer <stat> when upgrading."
- `enchants`, `sockets` — from `gear.findings`, `fail`. `fix`: names the slots.

**Group** (owner group; rendered under "Ask your raid leader")
- `debuffs` — accounting `debuffs` input, names the missing debuffs and the class that provides
  each (`RAID_DEBUFFS` source). "No Shadow Weaving or Misery on any of 5 pulls (a shadow
  priest)". Value: share.
- `party_buffs` — `crit_buffs` + `power_buffs` inputs merged into one row naming the missing
  buffs and the classes that bring them. Value: the two shares summed.
- `bloodlust`, `curse` — above.

**Raid** (owner raid; rendered under "Not on you")
- `raid_activity` — accounting input, one row when its average share ≥ 3%.
- Bad pulls — from `overall.badPulls`, collapsed (§5).

**Fine** (`FINE_IDS`): `food`, `flask`, `potion`, `activity`, `deaths` (no death on any live
pull), `power_gear` (spell/attack power at or above the reference on every accounting pull),
`hit` (at cap). Rendered as one sentence listing the passes; never a number.

**In your raid** (`kill.fight.sameClass`): not a check; rendered inside "Where you stand".

### 4.4 Constants (exported, tested for shape)

`NOMINAL_VALUE = { potion: 3, flask: 2, food: 1, oil: 1, burst_timing: 2, unused: 2, hit: 1 }`
(percent of the gap per occurrence; the number is a ranking aid and is printed as "~N%").
`FINE_IDS`, `MOVEMENT_FILLER[spec]`, `ABILITY_FIX[name]`, `NUKE_FIX[spec]`, `FIX_TEXT[id]`,
`ROW_CAPS = { fixFirst: 3, also: 5, asks: 3 }`, `BUFF_SOURCE[name]` (which class brings a party
buff), `STAT_WORD[stat]`.

### 4.5 Verdict

```
verdict = { ratioPercent, onYou, onRaidSetup, onPulls }
```
`ratioPercent` = median over accounting pulls of `100 × me.amount / reference.playersDps`.
`onYou` / `onSetup` = the summed averaged shares of player-owned / group-owned inputs (each
input averaged over the accounting pulls, then summed, clamped at 0); `onRest` = `100 − onYou −
onSetup` (raid activity and luck), clamped at 0. The sentence turns each into a fraction word
(≥ 80 "almost all", ≥ 70 "about three quarters", ≥ 60 "most", ≥ 45 "about half", ≥ 28 "about a
third", ≥ 18 "about a quarter", ≥ 8 "a small part", else omitted). Healers (`limited`) and players with no accounting get
`ratioPercent: null` and the verdict line is skipped.

### 4.6 Ordering and caps

Rows with `verdict: 'fail'` sorted by `value` descending (null last), then category order as
listed in §4.3. The first `ROW_CAPS.fixFirst` go to "Fix first"; the rest of the fails, then
the warns (same ordering), fill "Also" up to `ROW_CAPS.also`. Group rows sorted by value fill
"Ask your raid leader" up to `ROW_CAPS.asks`. Anything past a cap is **dropped from the text**
(it stays in `facts.overall.checklist.rows` and the page shows it under a "more" toggle).
`info` rows are never in the text; the page shows them.

## 5. The text (`renderReport`)

Plain text, second person, under 320 words by construction (the caps bound it). Sections only when non-empty:

```
Lovestoned — Destruction, SSC/TK, median parse 28
You do 59% of what comparable players do (players at your item level among the top 2000
parses). About three quarters of that gap is on you, about a quarter is the raid's setup.

Fix first
1. Shadow Bolt hits for 2934 non-crit against 3858 at the same spell power on Morogrim
   Tidewalker; raid debuffs explain about 9%, the remaining 16% is talents, spell rank or gear
   that logs cannot show. Check Shadow and Flame 5/5, Ruin, Shadow Bolt rank 11 and Demonic
   Sacrifice on a Succubus. (~36%)
2. Casting: 12.6 damaging casts a minute while active against 18 on Lady Vashj. Queue the next
   Shadow Bolt before the current one lands; move only when you must, and use Shadowburn or
   Life Tap while moving. (~31%)
3. Active 64.8% against 67.4% for comparable players (your raid: 76.8%) on Lady Vashj. Keep
   casting through transitions; if an assignment took you off the boss, tell the raid leader
   so it is counted as not on you. (~8%)

Also
- Destruction Potion: 0 on 5 of 5 pulls; comparable players use 1–2 a pull (up to 4 in a
  fight this long). Pop one on the pull and again every two minutes. (~3%)
- Flask: Elixir of Draenic Wisdom + Major Shadow Power at the Lady Vashj pull; comparable
  players run Flask of Pure Death. Run Flask of Pure Death at every pull. (~2%)
- Hit: 185 on your current gear against the 202 cap. Reach 202 hit before any other stat. (~1%)
- Shadowburn 0.6 a minute against 1.3 for comparable players on Lady Vashj. Use it while
  moving and under 25% boss health when you have shards.
- Spell crit rating 297 against 354 for comparable players. Prefer spell crit when upgrading.

Ask your raid leader
- No Misery or Shadow Weaving on 5 of 5 pulls (a shadow priest). (~17%)
- No Moonkin Aura in your group on 4 of 5 pulls (a moonkin). (~7%)
- You run Curse of the Elements (assignment); comparable players run Curse of Doom, 7% of
  their damage. Rotate the assignment or give it to the warlock with the lowest DPS.

Fine
Food at every pull, no deaths.

Where you stand
Lady Vashj: you 577; warlocks in your raid 640 / 512; comparable players 1180; the best at
your item level 1445.
Al'ar: you 1068; warlocks in your raid 1102 / 980; comparable players 1769; the best 2143.

Not on you
8 of 13 pulls were raid-wide bad pulls (Leotheras the Blind ×2, Kael'thas Sunstrider ×2, Lady
Vashj (May), Fathom-Lord Karathress, The Lurker Below ×2) and are left out.

Pick one thing to change next raid.
```

Rules: rows are ordered by value, so the biggest accounting item comes first even when a
cheaper habit (the potion) is easier — the value is the truth, the leader can reorder; a value is
printed as "(~N%)" only when the row has one; numbers come from `measuredOn`
and the boss is named when the sheet has more than one live pull; the "Where you stand" lines are
the v2 ceiling pulls (two worst live pulls) plus the same-class line; bad pulls are grouped by
boss with a count, dated only when the same boss also has a live pull that month; the healer
sheet (`limited`) renders only Consumables, Casting (activity), deaths, Gear and Not on you,
with "What's holding your healing back" as the first heading. The final line is constant.

## 6. Where the report lives

Today the note is a `<pre>` in the third column of a three-column grid inside an expanded
roster row: 70 characters wide, under the parses table, with the facts table folded beneath it.
That is the wrong place for a page-length document the leader reads, compares and pastes.

- **New page `feedback.html?name=&server=&region=[&report=<code>][&thresholds=<json>]`**
  (`feedback.js`, `feedback.css`; the same header and page-tabs row as the other pages with
  "Vetting" highlighted and a "← Back to vetting" link; no new tab is added to the other pages). It fetches `/api/vet/feedback` itself (same-origin, so the gate passes), shows a
  progress line while the pipeline runs, and caches the last response per query in
  `localStorage['raidFeedback:' + key]` so a revisit is instant and a Refresh button re-fetches.
- **Layout, top to bottom, full width:** header (name, spec, tier, median parse, night selector
  from `facts.nights`, Copy text, Refresh, WCL link of the worst pull); the verdict as a
  one-line banner; then cards per section in the order of §5 — Fix first (numbered, the fix in
  bold), Also, Ask your raid leader, Fine, Where you stand (a small table: pull · you · your raid
  · comparable · best), Not on you; a "more" toggle under Also and Ask for rows past the caps
  and `info` rows; the facts table last, full width, open by default on wide screens. Fail rows
  carry a red mark, warn amber, pass green, info grey, like tbc-audit's ✓/✗.
- **Vetting page:** the roster row gets a "Report" link (opens `feedback.html` for that player
  in a new tab, carrying the realm, region and the current thresholds) next to the remove
  button, and the expanded row's parses column shows only that link. `feedbackBox`,
  `requestFeedback`, `fallbackReport`, `factsTable`, `state.feedback`, `feedbackInFlight` and
  `feedbackErrors` leave `vetting.js` (`factsTable` moves to `feedback.js`). Old
  `state.feedback` entries in stored state are dropped on load.
- **Copy text** copies exactly `report` from the response, so the page and the pasted note
  never disagree.

## 7. Server

- `/api/vet/feedback`: no OpenAI call; `report = Checklist.renderReport(...)` computed after
  thresholds are reapplied (gear rows depend on them). Response `{ facts, report, generatedAt }`.
  `X-Vet-Cache` semantics: `hit` when the stored body is served, `miss` otherwise (no longer
  about a model call).
- Removed from `vet-feedback.js`: `buildPrompt`, `checkNumbers`, `completeReply`, `numbersIn`
  (kept only if `mergeFindings`' hit fold-in still needs it — it does not; the checklist reads
  `gear.findings` directly), `collectFactNumbers`, `anchorOf`, `STAT_ANCHOR`, `mergeFindings`,
  `positives`, `GROUPED_KEYS`, `findingId`. Removed from `vet-gap.js`: `FINDING_ANCHOR`.
  `ANNIVERSARY_RULES` and `openaiChat` stay for `/api/ai-review`.
- README: the feedback paragraph rewritten (no OpenAI needed; the report page; the checklist
  fields). `OPENAI_API_KEY` is no longer needed for the report.

## 8. Testing

- Golden: `fixtures/facts-lovestoned-v3.json` (the v3 sheet captured 2026-09-05; it has no
  `fight.sameClass`, so the "warlocks in your raid" clause is absent there). Pinned: the verdict
  (59%), the three "Fix first" ids in order (`nuke_hit` 36%, `cast_rate` 31%, `activity`), that
  `potion` and `flask` are in "Also" with `potion` first, that `debuffs` leads the asks and `curse`
  is a group row, that "Destruction Potion" and "Curse of the Elements" each appear exactly once
  in the text, that the text is under 320 words, and that `rows` has no two rows with the same
  id.
- Rotminster fixture (`wcl-feedback-rotminster.json`) still drives the pipeline test; its
  checklist must render without a model.
- Unit: aggregation (half-of-pulls rule; floor applied to the average, not per pull);
  `nuke_hit` expected/residual arithmetic on synthetic pulls; caps (a sheet with 9 fails renders
  3 + 5 and keeps the rest in rows); `sameClass` from a synthetic fight-wide table (pets
  excluded, sorted, `isMe` set); healer sheet skips the accounting sections; a player above the
  reference gets no verdict line and "Fine" only.
- Route: response shape `{ facts, report, generatedAt }`, no OpenAI call made (stub asserts it
  is never invoked), thresholds still reapplied.
- Page: headless-Chrome smoke (memory `wowstuff-verification-harness`): `feedback.html` renders
  the six cards from a stubbed API response; the vetting row's Report link carries realm,
  region and thresholds.

## 9. Out of scope (v5 candidates)

- Self-buff checks (Fel Armor, Demonic Sacrifice, mage armors): only visible through a
  report-wide Buffs query (`startTime:0,endTime:999999999`), one extra call per report code.
- Same-spec (not just same-class) peers: the fight-wide table has no spec; the fight's
  rankings roles do, but only when present.
- Letter grades. The ratio line is the grade.
- Healer accounting.
