# A reference above the player — feedback that says what to improve

Date: 2026-09-07. Status: approved in chat, awaiting implementation plan.
Builds on `logs-first-vetting-feedback` (14 commits, unmerged by request).

## Problem

Five real reports were run against the live WCL API on 2026-09-07 for the guild's 2026-09-06
Hyjal night (report `X6mnbPQpGhjJC2TN`). One of them — Lovestoned, Destruction warlock — is
genuinely good. The other four each carry lines the raid leader would have to apologise for.

### 1. The reference is below good players, so they get nothing

Utopik (Assassination rogue) on Rage Winterchill: **he does 1229, the reference does 898** — he
is 37% ahead. On Kaz'rogal, 1500 against 1082. He has **no `gap` object on any of his four
kills**, because the accounting only measures a deficit.

His median parse that night was **77**, so roughly a quarter of logged rogues beat him. On the
Rage Winterchill kill itself his `rankPercent` is **54.3** — he sits mid-field among all rogues
and still beats the in-band reference by 37%, which is the measure of how weak that bar is. The
headroom is real; the bar is simply set too low to see it. The engine has one idea — *you differ
from the reference, so close the difference* — and that idea carries no meaning when you are
ahead.

The reference is the **middle** of the leaderboard for that encounter, class, spec and region,
within item level ±2 (`REF.band`), chosen by distance from the middle rank
(`getReference` → `collect` → sort by `|globalRank - middle|`).

Note: the pool **is** already spec-filtered — `refPageQuery` sends `specName`. Utopik's advice
comes from three real Assassination rogues at his item level. The lines are technically true and
still useless.

### 2. Nothing gates a finding on whether it is worth anything

Utopik is told *"Never cast: Eviscerate (comparable players 0.3–0.4 a minute), Ambush (0.3 a
minute), Sinister Strike (0.4 a minute)"*. Funkell (BM hunter) is told to cast **Aspect of the
Viper** — a deliberate damage reduction — and **Misdirection**, a threat tool. Tipsi is told to
cast **Hamstring**, a snare.

`rotationFindings` reports any ability the reference casts above `T.unusedPerMin` that the player
never casts. Damage share decides *severity* (`top3` → major) but never *whether to report at
all*, so an ability worth nothing is reported the same as a core one.

### 3. Auto-attacks become "the main ability"

`mainAbility(kill)` returns `kill.reference.abilities[0].name` — the reference's top ability by
damage. For every physical class that is the auto-attack: `Melee` is **40.3%** of the reference
warrior's damage on Tipsi's Anetheron pull, `Auto Shot` likewise for Funkell. So:

- Sáiden (Retribution) and Tipsi (Arms): *"Queue the next **Melee** before the current one lands"*
- Funkell: *"Queue the next **Auto Shot**"*
- Sáiden: *"Check your talents and the rank of **Melee**"*
- Sáiden: *"**Melee** hits for 1418 non-crit against 1647"*

The underlying measurement is sound. Auto-attacks are **not** counted in the cast rate — `Melee`
is absent from both `me.casts` and `reference.casts` — so Tipsi's 14.5 against 36.3 damaging
casts a minute is a true comparison: the reference presses Heroic Strike 16.9 times a minute
against his 1.9. Only the ability the wording is built on is wrong.

### 4. Shares are shown outside 0–100%

Tipsi's Anetheron accounting: `cast_pacing` **169%**, `rotation` **−62%**. They offset — he casts
far less but hits harder per cast (4321 against 2922 damage per cast) — so the arithmetic is
coherent, but the report prints "(~169%)" and "(~128%)" to a reader for whom a share above 100%
is meaningless.

### 5. Two label bugs

- `vet-checklist.js:312` hardcodes "spell power": Sáiden, a Retribution paladin, reads *"you had
  673 spell power, they had 835"*. The number is attack power. Lines 284–286 hardcode "spell
  rank" the same way. A role-aware rewrite exists at `vet-gap.js:358` but only for `gapFindings`,
  which `nukeRows` bypasses.
- `vet-checklist.js:419` takes the title's tier from the **gating** tier, so Utopik and Tipsi both
  read *"SSC / TK, raid night of 2026-09-06"* for a BT / Hyjal night. The logs-first branch made
  cross-tier nights reachable, which turned this into a visibly wrong statement.

## Goals

- A player who beats the middle of the leaderboard still gets a reference — one that is above
  them, at their own item level, so the difference is execution and not gear.
- The bar rises on its own as the player improves; no per-player tuning.
- No finding is reported unless acting on it would plausibly raise damage.
- Every line reads correctly for a melee, a hunter and a tank, not only for a caster.

Non-goals: changing the gap accounting's maths, the checklist's structure, the thresholds, the
vetting verdict, or anything on the Assignments page. No change to WCL request budget.

## Design

### A. The reference sits above the player

`getReference` currently computes the band ceiling (`topDps`) *after* selecting players. Reorder
so the ceiling is known first — it already reads the top pages — and select against a target:

```
target = playerAmount + (topDps - playerAmount) / 2
```

Candidates are still `bandRanks(...)` (item level ±`REF.band`, widening to `REF.wideBand`), but
ranked by `|amount - target|` instead of `|globalRank - middle|`, ties toward the better parse.
`REF.target` (8) candidates, `REF.players` (3) fetched — unchanged, so the request budget is
unchanged.

For Utopik on Rage Winterchill: `1229 + (2008 - 1229) / 2 = 1618`, a reachable +32% instead of a
comparison he already wins. For Tipsi (595, ceiling 2648) the target is 1621, close to today's
1710 — weak players see almost no change, which is the intended degradation.

`getReference` gains `playerAmount` and `playerRankPercent`, read at the call site
(`vet-feedback.js:1105`) from `rank.amount` and `rank.rankPercent` — both are present on the
`encounterRankings` rank. They must come from `rank`, not from `me.amount`: `getReference` runs
before `killFacts`, so the fight-derived `me.amount` does not exist yet.

**Page walk.** Better parses sit on earlier pages. `middlePageOrder(L, maxPages)` generalises to
`pageOrderFrom(startPage, L, maxPages)`; the start page is estimated from the player's own
percentile (`ceil((1 - rankPercent/100) * L)`, clamped to `[1, L]`) and the walk moves toward
page 1, taking `REF.maxPages` at most. `middlePageOrder`'s current behaviour is
`pageOrderFrom(round(L/2), …)` and stays available for any caller that wants the middle.

**Cache key.** `getReference` caches on `encounterId/class/spec/region` + item-level band and is
deliberately shared between two players of the same spec at similar item level. The target now
depends on the player's own amount, so the key gains the target rounded to the nearest **100 DPS**
— sharing is preserved between players who are genuinely close, and two players far apart no
longer receive each other's reference. This is the one place where the change can *increase*
request count; 100 is the starting bucket width and the implementation must report the measured
request count for a full raid before and after, so the width can be revisited with evidence.

### B. When nobody is above them

If `playerAmount >= topDps` — the player is the best at their item level on that pull — there is
no reference above and none is invented. `getReference` returns `{ summary: null, note: 'nothing
at your item level beat you on this pull' }`, which flows through the existing `referenceNote`
path and the existing `no_reference` finding.

That pull then produces only **rule-based** findings — the ones true regardless of any cohort:
missing flask, food, potion, deaths, hit under cap, missing enchants and sockets, missing raid
buffs, and the activity fallback that already exists for reference-less pulls
(`vet-checklist.js` `castingRows`, the `else` branch). This is the honest version of "you are
ahead", and it is now rare rather than routine.

### C. A materiality gate on ability findings

In `rotationFindings`, an ability is only reported as unused or under-used when it carries real
damage for the reference:

```
referenceShareOf(name) >= T.abilityMinShare      // proposed 2 (percent of the reference's damage)
   OR  it is a burst cooldown (the existing isBurst test)
```

`abilityStats` already computes `share` per ability, so the number is in hand. The burst
exemption keeps Recklessness, Blood Fury, Drums and potions — large, cheap gains that carry
little direct damage share.

This alone removes Aspect of the Viper, Misdirection, Hamstring and Utopik's 0.3/min Ambush,
with no per-ability blocklist to maintain. `Elixir of Demonslaying` reaches the ability list
because consuming it is a cast; it is a consumable and belongs in the consumables row, so
`rotationFindings` also excludes names already known to `CONSUMABLE`.

### D. Auto-attacks are never "the main ability"

`mainAbility(kill)` skips auto-attacks — `Melee`, `Auto Shot`, `Shoot`, and any off-hand variant
WCL reports — and returns the first real ability, falling back to today's `'spell'` when there is
none. The list lives as one exported constant so `rotationFindings` and `nukeRows` share it. Tipsi's advice then names Heroic Strike — which is exactly what he is missing — and
Sáiden's nuke row stops asking about the rank of an auto-attack.

`nukeRows` skips the row entirely when the resulting main ability is still an auto-attack or
absent, rather than printing a comparison of average white hits.

The cast-pacing fix text becomes role-aware: casters keep "queue the next X before the current
one lands" with their `MOVEMENT_FILLER` filler; melee, ranged and tanks get wording about
pressing the ability more often, with no cast-queue or movement-filler clause.

### E. Shares are presented as shares

The maths is load-bearing and does not change: shares are still computed as they are today, and
**ordering still uses the raw value**, so the biggest contributor stays first in "Fix first".
Only the presentation changes, by two explicit rules:

1. A finding whose share is **negative** is not reported. It says the player is *better* than the
   reference on that input, which is not a fix. (`gapFindings` already drops `owner === 'noise'`;
   this is the same idea applied to negative shares.) This is what suppresses Tipsi's
   `rotation` −62%.
2. A finding whose share exceeds **100%** is reported **without a percentage** — the text stands
   on its own and the "(~N%)" tail is omitted. Printing "169%" is meaningless to the reader, and
   clamping it to "100%" would assert something the accounting did not measure.

### F. The two label bugs

- `nukeRows` takes the power word from the player's role, as `passRows` at `vet-checklist.js:361`
  already does: attack power for melee, ranged and tank; spell power otherwise. The same applies
  to "spell rank" in the `restText` helper (lines 284–286) — "ability rank" reads correctly for
  both.
- `vet-checklist.js:419` prefers `facts.night.zoneName` over the gating tier's name when the
  report is for a single night, matching what `feedback.js` already renders in the page title.

### G. Wording

"comparable players" is no longer accurate — the reference is now better players at the same gear
level. The replacement phrase is **"players ahead of you at your item level"**, shortened to
**"players ahead of you"** where the item level is already named in the same sentence. It is used
consistently in `vet-checklist.js`, `vet-gap.js` and the report prose; `GAP.REF_LABEL` is the
constant most of this flows through, and the rest are literal strings that must be changed with
it. The header line *"players at your item level among the top 2000 parses"* becomes the same
thing said of players ahead of the reader.

## Error handling

- Fewer than `REF.min` in-band candidates above the player: widen to `REF.wideBand` as today,
  then fall back to today's middle-rank selection rather than returning no reference, and record
  it in the note so the report can say the comparison is against the middle.
- `playerAmount` or `topDps` missing or non-numeric: fall back to today's middle-rank selection.
- 429 anywhere: unchanged — it aborts the request as it does now.

## Testing

TDD throughout, against the existing fixtures.

1. `vet-feedback.test.js`: `pageOrderFrom` ordering from a start page; `getReference` selects the
   candidate nearest the halfway target rather than the middle, on a stubbed leaderboard; the
   player-is-the-ceiling case returns a null summary with the note; the too-few-candidates case
   falls back to the middle.
2. `vet-feedback.test.js`: `rotationFindings` drops an ability under `T.abilityMinShare`, keeps a
   burst cooldown under it, and keeps a core ability above it — using Funkell's real shape (an
   Aspect of the Viper at 0 share must not be reported).
3. `vet-checklist.test.js`: `mainAbility` skips `Melee` and `Auto Shot`; `nukeRows` omits the row
   when only an auto-attack remains; the power word follows the role; the title takes the night's
   tier.
4. `vet-gap.test.js` / `vet-checklist.test.js`: using Tipsi's real 169% / −62% pair as the
   fixture, the negative input produces no finding at all, the 169% input produces a finding with
   no percentage in its text, and the ordering of the remaining findings is unchanged from the
   raw shares.

**Fixture churn is the main cost.** The reference selection change moves every "comparable
players" number in the existing fixtures. The implementation must regenerate them from the same
stubbed leaderboards rather than hand-editing expected values, and must state how many
assertions moved.

## Files

`vet-feedback.js` (`getReference`, `pageOrderFrom`, `rotationFindings`, `REF`, `T`),
`vet-gap.js` (`REF_LABEL`, share presentation), `vet-checklist.js` (`mainAbility`, `nukeRows`,
`castingRows`, title line, wording), the four test suites above, and `README.md` if the feedback
bullet describes the reference.

## Out of scope, noted for later

- The reference remains three players; a larger sample would cost more requests.
- Comparing a player against their own best pull (execution variance) is a different report and
  is not attempted here.
- Sáiden's "paladins in your raid 1345 / 44" compares a Retribution paladin against a Protection
  tank's DPS. Real, but a separate fix in the "Where you stand" block.
- "Lust for Battle" appears for both a paladin and a warrior at the same rate, so it is likely an
  item proc rather than a class ability; the materiality gate should remove it, and if it does
  not, it wants its own investigation.
