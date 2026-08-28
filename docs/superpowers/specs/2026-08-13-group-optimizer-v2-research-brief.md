# Group optimizer v2 — research brief and plan

**Date:** 2026-08-13
**Status:** validated 2026-08-13 (see §8 for what validation found and Max's resulting rulings);
superseded as a working document by `2026-08-13-group-optimizer-v2-design.md` (the spec).
**Supersedes nothing.** The current implementation is `assignments-engine.js` (`proposeGroups`),
shipped 2026-08-13 in commits `e27ef15..52042ea`, spec at
`docs/superpowers/specs/2026-08-13-group-optimizer-ai-review-design.md`.

---

## 1. The goal

Max’s stated priority, verbatim: *"the highest DPS possible, second comes threat, then healing.
Tank will survive most of the time."*

**Interpretation agreed during discussion:** this is **not** a lexicographic objective. Strict
lexicographic ordering would maximise DPS and only consider threat among exactly-tied layouts —
and once DPS is in continuous units, exact ties never happen, so threat and healing would be dead
code.

The correct reading is **floors plus one objective**:

> **maximise raid DPS, subject to** tank threat, tank survivability and healer sustain each
> meeting a floor.

Constraints outrank the objective by construction (nobody accepts +5% DPS on a layout where the
tank dies). The stated priority order tells us which floor to relax first if they cannot all be
met: healing before threat, nothing before survival.

**Why the floors are load-bearing, not polish:** under a pure-DPS objective, healers and tanks
contribute ~0 to the score. The optimizer will correctly conclude they are the cheapest bodies to
park in low-value seats — scattering healers away from Mana Spring/Mana Tide and using tanks as
filler. Raid DPS rises on paper; the raid stops functioning. The constraints are the only thing
preventing a degenerate answer, so they must be designed alongside the objective, not bolted on.

---

## 2. What the current model actually does

### Inputs it reads (complete list)

| Input | Used for |
|---|---|
| `class` | buff providers + buff value |
| `spec` | buff providers + buff value |
| `race` | only `'Draenei'`, to avoid wasting a duplicate racial |
| `name` | alphabetical tiebreak only — no gameplay meaning |
| headcount | group count and the 5-cap |

Five fields, one of which is a tiebreaker. **No gear, ilvl, logs, damage weight, MT/OT
designation, encounter, or player preference.**

### Derived classifiers

- **`bucketOf(p)`** → `tanks | melee | casters | healers | ranged`. The *social* label; decides the
  seed and the group's printed name. Hunters are deliberately their own bucket, not melee.
- **`buffArchetype(p)`** → `wfMelee | enhShaman | feralCat | bear | protWarrior | protPaladin |
  hunter | caster | healer`. The *value* label. A different partition from `bucketOf` — a Guardian
  druid is `tanks` socially but `bear` for value; a rogue and a Fury warrior are both `wfMelee`.
- **`anchorScore(p)`** → 0 (carries a party-scoped buff) / 1 (paladin) / 2 (filler). Anchors are
  placed first and protected from the draenei swap pass.

### Structural constants

- `GROUP_CAP = 5`, `groupCount = min(5, ceil(n/5))`
- `GROUP_ROLES = ['melee','casters','healers','ranged','tanks']` — **shaman scarcity order**
- `SHAMAN_ROLE = {Enhancement:'melee', Elemental:'casters', Restoration:'healers'}`

### Objective

```
scoreLayout = Σ over groups [ Σ over players playerBuffScore(p, group) + 0.25 × majority-bucket-size ]
```

The `0.25` cohesion term is **not** a performance parameter — it keeps groups readable as "the melee
group". Deliberately set below the smallest buff weight so it can never outvote a real buff.

### Pipeline (7 passes)

1. Seed shamans, one per group, spec-matched; extras to any shaman-less group
2. Fill each group from its own bucket, anchors first, then alphabetical
3. Overflow: leftovers to the *fullest* group with room
4. Draenei de-duplication (swap-only, both sides non-shaman `anchorScore === 2`)
5. Buff-aware hill-climb, gated by `relocatable()`, 500-iteration cap
6. Relabel groups from who actually landed there
7. `NOTE_RULES` — air notes delegate to `groupBuffs` so notes and score can't disagree

### `PARTY_BUFFS`

16 rows, each `{ provided: <boolean predicate over the group>, w: { archetype: weight } }`.
Weights are **ordinal and asserted** — 10 for Windfury, 7 for Wrath of Air. Not commensurable.

Three rules ride on the table: air exclusivity (one of WF/GoA/WoA per group, Elemental shaman
hard-pins Wrath of Air), duplicates count once (`provided` is boolean), and Windfury is absent for
`enhShaman`/`feralCat`/`bear`/`hunter`.

---

## 3. Research findings

### Verified CORRECT — leave alone

| Claim | Evidence |
|---|---|
| **Bloodlust raid-wide on Anniversary**, correctly excluded from grouping | wowsims proto: `bool bloodlust = 7; // TBC ANNI - Lust is now raid wide` — it's in `RaidBuffs`, not `PartyBuffs`. Original TBC and TBC Classic were party-only, which is why most old grouping advice about rotating shamans is obsolete. |
| **Paladin auras are party-scoped in TBC** | Became raid-wide only in Patch 3.0.2 (WotLK). Modern wiki pages say "party and raid members within 40 yards" because they describe the current version. wowsims puts all four auras in `PartyBuffs`. |
| **Windfury at weight 10 for Combat rogues is defensible** | Large gain; Combat rogues run 2.6–2.8 speed main-hands which synergise with the proc. Resolves an uncertainty previously flagged in the code. |
| **Prot paladin belongs in a Wrath of Air group** | Improved Righteous Fury gives +90% threat from Holy damage, so spell damage drives prot paladin threat directly. Multiple sources describe the "caster pile" as Shadow Priest + Arcane mages + a shaman + a Protection Paladin. Standard practice, not inference. |
| **Expose Weakness correctly omitted** | It is a raid-wide *target debuff*, not a party buff. Survival hunters are grouping-neutral. |

### Verified WRONG — must fix

| # | Problem | Detail |
|---|---|---|
| 1 | **Ferocious Inspiration stacks multiplicatively** | `1.03 × 1.03 = 6.09%` for two BM hunters in a party. wowsims proto: `int32 ferocious_inspiration = 1; // Number of BM hunters in party.` The existing note text ("stacks per BM hunter") was **right**; the `provided` boolean is a genuine bug. |
| 2 | **Blood Pact is dead in practice** | Requires the imp out; nobody raids with the imp. The existing note text ("needs the imp out") was the tell. Max ruled: drop it. |
| 3 | **Mana Spring is missing** | Mana Tide is a 5-minute cooldown, not a sustained totem. Mana Spring is the water-slot uptime buff and isn't modelled at all. |
| 4 | **`protPaladin` × Wrath of Air weighted 1** | Should be ~7 given Improved Righteous Fury. Currently rounding error. |
| 5 | **Item-based party buffs missing entirely** | Atiesh (druid/mage/priest/warlock), Braided Eternium Chain, Chain of the Twilight Owl, Eye of the Night, Jade Pendant of Blasting. All party-scoped, all affect grouping. **Validation caveat + ruling:** the model's inputs contain no gear, so these are *underivable* from an RSS2 import — modelling them would need a per-player input channel. Max ruled (2026-08-13): **skip item buffs in v2 entirely.** |
| 6 | **Paladin auras collapsed to one generic row** | wowsims models Sanctity, Devotion, Retribution and Concentration separately. |
| 7 | **Draenei collapsed to one row** | wowsims splits `draenei_racial_melee` and `draenei_racial_caster`. |

### Max's rulings

- **Drums: skip.** Party-scoped +80 haste, one drummer per group (Tinnitus debuff), described by
  sources as the single highest raid DPS consumable. Deliberately out of scope — it would require
  profession as an input.
- **Totem twisting: ADD.** Assume **every Enhancement shaman twists**, so their group runs
  **Windfury AND Grace of Air simultaneously**. Windfury's effect persists ~10s after the totem
  drops. wowsims models this explicitly: `bool totem_twisting = 34;`
- **Tranquil Air: never add.** Never worth an air slot.

**Consequence of the twisting ruling:** it resolves the Guardian druid's dilemma. Previously the
bear's threat buffs (Battle Shout, Unleashed Rage, Strength of Earth) were in the melee group while
its survivability buff (Grace of Air → dodge) was in the hunter group, and choosing between them
required an MT/OT flag. With twisting the melee group supplies both. **Bear goes to the melee
group, no flag needed for that decision.**

---

## 4. Key architectural findings

### The objective is separable

`scoreLayout` is a sum over groups with **zero cross-group terms**. That makes exact optimisation a
textbook **set-partitioning** problem: enumerate all distinct candidate groups, score each once,
then select `groupCount` of them that exactly partition the roster. The full layout space is ~5.2 ×
10¹² unlabelled partitions at 25 players, so brute force over layouts is out, but set partitioning
is very tractable.

**Validation correction:** candidates must be all subsets of size **≤ 5**, not only exact fives —
rosters rarely divide by 5 (the live roster is 22), and correction #3 below argues the optimum
*concentrates* empty seats (5/5/5/5/2), which only variable-size groups can express. At 25 players
that is Σₖ₌₁..₅ C(25,k) = 68,405 candidates instead of C(25,5) = 53,130; same order of magnitude,
same tractability conclusion.

### wowsims is an evaluator, not a solver

Verified by cloning `github.com/wowsims/tbc-new` and reading the source:

- **It has no composition search.** The only optimizer in the codebase is `ReforgeOptimizer` —
  *gear* reforging via a HiGHS LP solver in a WASM web worker. Zero hits for group placement.
- **It does model parties properly:** `Raid { repeated Party parties }`, `Party { players,
  PartyBuffs buffs }`, and `RaidMetrics` returns per-party and per-player DPS/HPS.
- **It has a headless CLI:** `cmd/wowsimcli` — `wowsimcli sim --infile input.json`, takes a
  `RaidSimRequest` in protojson, returns `RaidSimResult`.
- It computes **DPS, TPS and DTPS** — so threat and survivability are measurable, not just guessable.

**Therefore:** a sim run takes seconds. Simming even the 53,130 candidate groups would be 15–150
hours, and the layout space above that is astronomically worse. **The fast surrogate model is
non-negotiable** — that is the part only we can build.

The right architecture:

| Role | Tool |
|---|---|
| **Oracle** — what is a buff worth; is layout A actually better than layout B | wowsims |
| **Solver** — which of ~5×10¹² layouts is best | our model |

### `PartyBuffs` is the buff table — **corrected: it is A buff table, not THE buff table**

`proto/common.proto` in wowsims/tbc-new contains a maintained, Anniversary-tuned enumeration of
party-scoped buffs, and its field *types* (bool / `TristateEffect` / `int32` count) are exactly the
per-buff stacking vocabulary open question 2 asks about.

**Validation finding (2026-08-13):** `PartyBuffs` is wowsims' table of *external* buffs — buffs
supplied by players who are **not in the sim**. Party effects whose provider wowsims models as a
real agent live elsewhere or nowhere: **Unleashed Rage** and shadow-priest mana are in
`IndividualBuffs`, whose own comment reads *"Only used in individual sims, as the class that
provides these would cast them in raid sim"*, and **Vampiric Touch appears nowhere in the proto**.
Both are genuinely party-scoped and both are already in the current engine. A verbatim port would
silently drop them.

**Corrected instruction:** Phase 1 takes the **union** of wowsims' `PartyBuffs` (+ the two
`IndividualBuffs` rows) and the existing hand-written table — never a replacement.

---

## 5. Corrections made during the discussion

Listed explicitly because a validator should re-check them.

1. **"Ferocious Inspiration probably doesn't stack"** — wrong. It stacks multiplicatively. The
   repo's note text was right and the doubt was wrong.
2. **"Paladin auras might be raid-wide"** — investigated; they are party-scoped in TBC. The model
   is correct. False alarm.
3. **"DPS weighting gives 5/5/4/4/4 instead of 5/5/5/5/2"** — wrong. Party buffs do **not** dilute
   with group size, so buffed groups should be as **full** as possible and empty seats
   **concentrated**. With 4 shamans and 5 groups one group runs dry regardless; make it as small as
   possible. The current layout's *shape* is right; only the selection of who sits in the dry group
   is unverifiable.
4. **Blood Pact and Tranquil Air proposed as threat/survivability proxy constraints** — both are
   dead in practice. Corrected by Max.
5. **"Per-player DPS baseline is essential, worth more than everything else combined"** — overstated,
   then progressively walked back, then dropped. See §7.
6. **"Build per-spec stat-weight tables"** — superseded. Measure buff values directly with the sim
   instead; it captures non-linearities (Windfury procs, haste breakpoints, hit caps) that stat
   weights erase.

---

## 6. The plan

### Phase 1 — Union with `PartyBuffs`, don't port it verbatim *(corrected by validation)*

Merge wowsims' `PartyBuffs` proto (plus `IndividualBuffs`' Unleashed Rage and shadow-priest rows —
see §4) into the hand-written `PARTY_BUFFS` list. Carries the fixes in §3 (FI as a count, Mana
Spring, split auras and draenei rows) while keeping Unleashed Rage and Vampiric Touch, which a
verbatim port would silently drop. Item buffs are **out** by ruling (§3, fix #5).

⚠️ **This breaks a design assumption.** `provided` being a boolean encodes "duplicate providers are
wasted," which is true for every buff **except** Ferocious Inspiration. It needs a per-buff stacking
rule, not a patch. Scope this properly.

Also apply the twisting ruling: if a group contains an Enhancement shaman, admit **both** the
Windfury and Grace of Air rows instead of running the air argmax. Everyone else keeps one air totem.
Wrath of Air stays excluded — twist two, not three.

### Phase 2 — Calibrate with `wowsimcli` (the keystone)

Offline harness. For each spec, generate a `RaidSimRequest` JSON and:

```
baseline = sim(all buffs ON)
for each party buff:
    without = sim(all buffs ON, this one OFF)
    value[spec][buff] = baseline/without - 1        → a percentage
```

**Toggle buffs OFF from a fully-buffed baseline, not ON from a bare one.** Measuring in isolation
gives value in a vacuum; Battle Shout and Unleashed Rage are both attack power and have diminishing
joint value. We want *marginal* value in realistic context — that's the decision the optimizer
actually makes.

Run three times, for **DPS**, **TPS** and **DTPS**. Output one committed JSON; `PARTY_BUFFS.w`
becomes a lookup into it. No runtime sim dependency, no build-step change.

**Why this is the keystone:** it converts ordinal invented weights into % throughput, which
(a) makes every number traceable to a reproducible sim run, (b) makes weights commensurable across
archetypes, and (c) **fixes the zeroed-tail problem for free** — once the objective is real DPS, a
plain sum is *correct*, and two players at zero stops being acceptable on its own without needing a
concave or floored per-player term.

**Method note (validation):** the toggle mechanism is *single-player* `RaidSimRequest`s — one real
simmed player per request, with the buff under test supplied via the `PartyBuffs` /
`IndividualBuffs` proto flags. That is exactly what those proto fields exist for, and it avoids the
trap of "toggling off" a buff by removing its provider from a full raid (which perturbs more than
the one buff). Also: DPS, TPS and DTPS all come out of a **single** run's `UnitMetrics` — three
separate runs are not needed.

**Known caveats:**
- wowsims targets TBC Classic 2.5.x; diff Anniversary's other changes against its assumptions
  before trusting the numbers wholesale.
- BiS profiles aren't real raiders. The one stat where this matters is **spell hit** — Totem of
  Wrath's +3% hit is large uncapped and zero capped (though the +3% crit survives either way).
  Consider running capped and uncapped profiles for caster specs.
- Toggling one buff at a time still can't capture that Windfury and Grace of Air interact.
  Acceptable error, but it is an error.

### Phase 3 — Two free fields, no pipeline

**Dropped:** the Warcraft Logs integration. Reasoning:

- Everything structural is decided by class and spec, which we already have.
- Within-spec differences are **permutations**, not structural changes. The model puts one Combat
  rogue in the melee group and one in the dry group; which specific rogue is a five-second judgement
  a raid lead makes by eye.
- The hit-cap argument is weaker than it first appeared — Totem of Wrath's crit component survives
  capping, so the buff degrades from large to solid rather than vanishing. Changes the number, not
  the placement.

**Keep instead:**
- **MT/OT flag** — a checkbox. Needed for the survivability floor.
- **Manual multiplier per player**, default 1.0. Covers the one case gear genuinely changes
  structure: a roster lopsided *across* specs (e.g. hunters far better geared than melee, which
  flips the "super group" answer). Costs nothing.

**Revisit trigger:** if Phase 5's validation shows the sim's ranking *disagrees* with the model's,
per-player gear becomes a candidate explanation and is worth building then. Not before.

*(Reference if ever needed: wowsims' `RaidWCLImporter` pulls full per-player gear from a Warcraft
Logs report via `events(dataType: CombatantInfo)`, plus race and profession from cast-event filters.
~700 lines of MIT TypeScript. Note their WCL client ID/secret is hardcoded in public source — do not
copy that practice.)*

### Phase 4 — Floors, not score terms

Maximise DPS subject to hard constraints, using Phase 2's measured TPS/DTPS rather than proxies:

- Prot paladin's group must run Wrath of Air
- Healer groups must have a water totem source
- Bear's threat floor is already satisfied by the twisting ruling

Express as required-buff constraints so they stay readable: *"Sylvanor is here because the tank
needs Wrath of Air"* beats *"because the EHP model computed 43,102."* Same mechanism handles manual
pins from the raid lead.

### Phase 5 — Search with the surrogate, verify with the sim

Model proposes the top N layouts; `wowsimcli` sims those N and picks the winner. Fast model for
search, real sim for the decision — and it continuously measures how good the surrogate is.

**This phase decides whether exact search is worth building.** Brute-force a small roster (10
players, 2 groups), compare the exact optimum against the current hill-climb. If the gap is ~1%,
skip exact search entirely. If it's built: set partitioning over 53,130 candidates, branch and bound
with lowest-index anchoring to kill group-permutation symmetry, pure JS, no dependency. (HiGHS
compiled to WASM in a web worker is a working precedent in the wowsims repo if a MIP is preferred.)

### Phase 6 — Output

Emit the **top 3 layouts with deltas** plus each seat's marginal value ("moving utopik out of group
1 costs 4.2% raid DPS"). Keeps the tool an argument rather than an oracle, which is what the
"advisory" label already promises — and mitigates the explainability loss that comes with exact
optimisation.

**Also preserve:** determinism (exact optima come with many exact ties; needs an explicit
lexicographic tiebreak, same discipline as the current hill-climb).

---

## 7. Worked example — the live 22-man roster

Roster: 4 shamans (1 Enh, 1 Ele, 2 Resto), 3 warriors (2 Fury, 1 Arms), 2 Combat rogues, 3 druids
(Feral cat, Guardian, Resto), 3 Arcane mages, 2 Destro warlocks, 3 hunters (2 BM, 1 Survival),
1 Holy priest, 1 Prot paladin. **No Shadow Priest, no Moonkin, no MM hunter, no Prot warrior.**

**Provider inventory** (this is most of the optimisation): 2 LotP sources (cat + bear → different
groups), 2 BM hunters, 3 warriors but Battle Shout only helps physical groups, 4 shamans across
5 groups → **one group runs dry regardless**.

Hand-derived layout under the priorities above — **not computed, illustrative only**:

| Group | Members | Buys |
|---|---|---|
| **1 — Melee** | Hakü (Enh), Culuneta (Fury), RedNeko (Fury), Davina (Arms), **Mr.SmellmyWand (Bear)** | Windfury + Grace of Air (twisting), Strength of Earth, Unleashed Rage, Battle Shout, LotP from the bear. Bear gets threat **and** dodge. |
| **2 — Casters** | Slyvester (Ele), bejoux, Craqu, Cartis, **Funkell (BM)** | Totem of Wrath, Wrath of Air, Ferocious Inspiration on strong casters |
| **3 — Hunters** | woptenwodei (Resto), Connylloyd (BM), produdu (Surv), **Wårzillå (Cat)**, utopik (Rogue) | Grace of Air, LotP from the cat, FI, Mana Spring |
| **4 — Healers** | Gouken (Resto), Frawa, sspope, **Sylvanor (Prot pally)**, JohnNooze (Mage) | Wrath of Air (healers *and* paladin threat), Mana Tide, Concentration Aura |
| **5 — Dry** | xavamros (Rogue), Lovestoned (Lock) | Nothing — the unavoidable dry group |

**Changes vs. what ships today:** bear and cat trade groups (both provide LotP, so the melee group
keeps its crit either way, but only this direction gives the bear its AP buffs); BM hunters split;
groups fill to 5 with the dry group shrunk to 2; Sylvanor stays with the healers, now for a stated
reason.

**BM hunter split rule** (derived from multiplicative stacking, `1.03 × 1.03 = 1.0609`, i.e.
+6.09%): with group damage totals `a` and `b`,

> both in A: gain `0.0609a` — split: `0.03a + 0.03b` — **split wins iff `b > 1.03a`**

Splitting is right here because group **3**'s damage total is diluted by its Resto shaman and the
cat's modest DPS, while group 2 is four full-value casters — so the second FI earns more there.
*(Validation fixed this sentence: it previously said "group 4 … a Resto shaman and a bear", a
leftover from a pre-twisting draft in which the bear sat with the hunters.)*

**Known unresolvable from class/spec alone:** which two players sit in the dry group; utopik vs
Davina for the third Windfury seat. Both are within-spec permutations a raid lead fixes by eye.

**Composition gap worth knowing:** three Arcane mages with **no Shadow Priest** means no Vampiric
Touch. Sources describe the Shadow Priest as "the engine of the caster pile, specifically enabling
Arcane Mages." No grouping fixes this — group 2 runs at a structural disadvantage regardless.

**Roster provenance caveat (validation):** this 22-man roster (3 Arcane mages, includes "bejoux")
does not match the repo's pinned regression roster in `assignments-engine.test.js` (21 players,
2 mages, no bejoux). Presumably newer live data, but it is not verifiable from the repo — treat
the member list as illustrative, like the layout itself.

---

## 8. Open questions — validation outcomes (2026-08-13)

Every §2/§4 claim and proto citation was re-checked against `assignments-engine.js`, the 245-test
suite (all passing), and the actual wowsims/tbc-new source. Nothing in §3's verified-correct /
verified-wrong tables failed re-checking; all six §5 corrections held up. Question statuses:

1. **Floors-plus-one-objective — confirmed by Max.** He also confirmed the residual "who sits in
   the dry group" permutation is his to assign by hand; the model need not solve it.
2. **Refactor size — answered: it is a schema change, not an FI patch.** wowsims' own field types
   (bool / `TristateEffect` / `int32` count) are the stacking vocabulary; the table needs a
   per-buff `count` + stacking mode, and the score needs multiplicative composition.
3. **Cohesion term — answered: it does not survive.** Once weights are % DPS, 0.25 is an arbitrary
   unit collision. v2 drops it from the score; readability comes from relabelling and the
   deterministic enumeration order, not a score term.
4. **`relocatable()` guard — answered: it demonstrably blocks the brief's own answer.** The worked
   example's bear↔cat trade is a swap between two *full* groups; the hill-climb's under-full-
   endpoint requirement forbids every such swap, so the current climb cannot reach §7's layout
   even under a perfect objective. v2 removes the guard.
5. **Anniversary vs 2.5.x divergences — still open.** Carried into the spec as a calibration
   caveat and a standing review item.
6. **Test-suite escalation — answered: yes, and ruled.** Three tests pin superseded v1 behavior:
   the `2026-08-13 SSC roster` regression test (Guardian-with-hunters — contradicts the twisting
   ruling), `NOTE_RULES: Blood Pact printed for any warlock group` (pins a dropped buff), and the
   two `A paladin aura` note assertions (collide with split auras). **Max's ruling: scoped updates
   allowed** — the spec names the exact tests that may change, each change carries a
   commit-message justification, and every other test stays under the never-modify rule.
7. **Exact search — ruled: gated on measurement.** v2 ships the unrestricted deterministic
   hill-climb plus a brute-force gap measurement on small rosters; exact set-partitioning search
   becomes a follow-up plan only if the measured gap exceeds ~1%.

**Additional rulings recorded during validation:** item party buffs are skipped entirely in v2
(§3 fix #5 — no gear input channel exists); Unleashed Rage's missing `hunter` weight (ranged
attacks scale with AP, so UR helps hunters too) is folded into the v2 table.

---

## 9. Sources

- [wowsims/tbc-new](https://github.com/wowsims/tbc-new) — `proto/common.proto` (`PartyBuffs`),
  `cmd/wowsimcli`, `ui/raid/components/importers/raid_wcl_importer.tsx`
- [wowsims/tbc architecture — DeepWiki](https://deepwiki.com/wowsims/tbc)
- [Raid Composition Guide — Icy Veins](https://www.icy-veins.com/tbc-classic/raid-composition-guide)
- [Ferocious Inspiration — Wowhead TBC](https://www.wowhead.com/tbc/spell=34460/ferocious-inspiration)
- [Patch 3.0.2 (paladin auras → raid-wide) — WoWWiki](https://wowwiki-archive.fandom.com/wiki/Patch_3.0.2)
- [Protection Paladin Spell Summary — Icy Veins](https://www.icy-veins.com/tbc-classic/protection-paladin-tank-pve-spell-summary)
- [TBC Anniversary changes — Conquest Capped](https://conquestcapped.com/guides/tbc-anniversary-classic/tbc-anniversary-overview/)
- [Heroism/Bloodlust reset on Anniversary — Warcraft Tavern](https://www.warcrafttavern.com/tbc/news/heroism-bloodlust-will-reset-for-bosses-in-tbc-classic-anniversary-edition/)
- [Shadow Priest raid buffs — Wowhead TBC](https://www.wowhead.com/tbc/guide/classes/priest/shadow/dps-consumables-raid-buffs-pve)
- [Survival Hunter overview (Expose Weakness) — Boosting Ground](https://boosting-ground.com/wow-classic/guides/the-burning-crusade-guides/tbc-survival-hunter-overview)
