# Debuff Coverage Expansion — Design Spec

**Date:** 2026-08-11
**Status:** Draft, awaiting review
**Supersedes parts of:** `2026-08-10-raid-assignments-design.md` (debuff catalog section)

## Why

Research into TBC Classic 2.5.x mechanics found that several provider rules in
the current debuff catalog are wrong for TBC specifically (they encode vanilla
or WotLK behaviour), and that the tool is missing most of what a TBC raid
actually assigns — blessings, party-scoped buffs, and rotations.

This spec covers six workstreams. Each ships independently. Workstream 1 is
ready to plan now; the rest depend on decisions recorded here.

## Global constraints

These apply to every workstream. Every task's requirements implicitly include
this section.

- **The existing flow must keep working end to end.** Paste addon export →
  auto-assign → Discord output is what the raid uses on raid night. Precisely:
  an `RSS1` export must keep parsing to an identical roster, and every step of
  the flow must keep functioning, for the whole of this work.
  Workstream 1 deliberately *does* change some assignment results — that is its
  point — so the invariant is the parse and the pipeline, not the output.
  Enforced by a pinned RSS1 parse fixture, written *first*, before any other change.
- **All work happens on a `debuff-coverage` branch in a worktree.** Railway deploys
  from `main`; `main` stays untouched and deployable throughout.
- **Addon back-compat is mandatory.** No second live addon. One `RaidSpecScan`,
  bumped to emit `RSS2`, with the web parser accepting both `RSS1` and `RSS2`.
  A raider who never updates keeps working exactly as today.
- **New surfaces are opt-in.** Group layout, blessings and rotations get their own
  UI sections. They must not sit in the path between import and Discord output.
- **No build step.** Plain ES5-compatible JS in the UMD wrapper, `node:assert`-based
  tests in the existing hand-rolled harness (`assignments-engine.test.js`), run with
  `node assignments-engine.test.js`.
- **Spec is a proxy, never proof.** The addon reports talent *tab totals* only
  (`41/20/0`), never individual picks. Every talent-conditional rule below is a
  spec-level guess plus a manual override. The UI must not imply certainty.

---

## Workstream 1 — Catalog rule corrections + warning split

Ready to plan. No dependencies. Touches `assignments-engine.js` only.

### Rule corrections

| Entry | Now | Change to | Why (TBC-specific) |
|---|---|---|---|
| `jow` | `preferSpecs: ['Retribution']` | `preferSpecs: ['Holy', 'Protection']` | Ret keeps Seal of Blood/Command for damage. Support paladins judge at pull; any Ret's Crusader Strike then refreshes *all* paladins' judgements. |
| `joc` | `minClassCount: 3` | `requireSpec: 'Retribution'`, drop `minClassCount` | The value is Improved Seal of the Crusader (Ret tier 2): +3% crit to **all** attacks on the target. Untalented JoC is worthless. Worth it with *one* Ret, not a third body. |
| `ff` | `preferSpecs: ['Balance']` | `preferSpecs: ['Balance', 'Feral']` | Improved Faerie Fire (+3% melee/ranged hit) is Balance-only. Without a Balance druid the 610 armor still applies, so keep the duty — but a Feral outranks a Resto, who would spend a GCD and mana they'd rather heal with. |
| `scorch` | position 7 | move below `ff`/`hm` | Fire Vulnerability is +3% **fire** damage taken per stack, not spell crit (that's WotLK). Self-maintained by the fire mage's own rotation, and near-worthless without a fire-heavy caster core. |

Judgement exclusivity stays keyed per-player. Confirmed: TBC allows one judgement
per **paladin**, not per target — JoW + JoL + JoC can all be up at once. The
"only one Judgement active at any time" wording people remember is 3.x.

### Warning split

`uncovered` currently conflates two different situations and cries wolf:

- **missing** — a debuff the raid genuinely wants but nobody can provide.
  No warlock → no Curse of Elements. The raid lead should see this.
- **notApplicable** — the duty does not apply to this comp. No Ret paladin → no
  Judgement of the Crusader; no rogue → no Expose Armor (Sunder covers it).
  Should not render as a warning at all.

Return shape becomes:

```js
{ duties, uncovered: { missing: [...], notApplicable: [...] }, passives }
```

Both arrays hold `{ id, name }` as today. An explicitly-cleared row (the user
deliberately unassigned it) counts as **missing** — the user removed coverage
they could have had.

Catalog entries gain an optional `applicableWhen(roster)` predicate. When it
returns false the entry is skipped and recorded as `notApplicable`. `joc` uses
it (`roster has a Retribution paladin`), replacing `minClassCount` entirely.

**Breaking change for callers:** `assignments.js` and `assignments-view.html`
read `uncovered` as a flat array. Both need updating in the same task.

### Also in scope

Move `Winter's Chill` out of `PASSIVES` into the assignable catalog
(`class: MAGE, requireSpec: 'Frost'`). It is a maintained 5-stack debuff, not
passive coverage. It does **not** conflict with Improved Scorch — +2% frost crit
vs +3% fire damage taken, different schools entirely.

---

## Workstream 2 — Target exclusivity + Improved Expose Armor

Depends on: Workstream 1 (warning split).

The engine models one kind of exclusivity: `group` keyed as `group:player`,
meaning "one curse per warlock". TBC also has debuffs that conflict **on the
target across different players**, which the current model cannot express.

**Design note (revised while planning).** The first draft added a `targetGroup`
field that post-filtered conflicting duties. That turned out to be the same idea
as the existing `fallback` field, which is already a two-element provider list
(Demo Shout, else Curse of Weakness). Rather than run two mechanisms side by
side, generalize `fallback` into an ordered `providers` array. One effect, many
possible providers, best available wins — which is also how a raid lead actually
thinks about it ("who's doing armor — sunder or expose?").

A conflicting set becomes **one duty row with a provider dropdown**, not several
rows that cancel each other out.

| Duty | Providers, best first | Notes |
|---|---|---|
| Major armor reduction | Improved Expose Armor, Rogue (3075) → Sunder Armor, Warrior (2600 at 5 stacks) | Expose blocks Sunder outright — "A more powerful spell is already active." With a rogue on Expose the warriors stop sundering, so this really is one row. |
| Attack power reduction | Demo Shout, Warrior (−300, −420 improved) → Curse of Weakness, Warlock (−350, −420 improved) → Demo Roar, Feral Druid (−240) → Screech, Hunter pet (−209) | Strongest applies. Talented, Demo Shout and CoW tie at −420; **untalented, CoW beats Demo Shout**. Talent picks are invisible to the addon, so rank by spec and let the override settle it. |

This subsumes the existing `fallback` field, which is deleted.

Faerie Fire (610) and Curse of Recklessness (800) stack with major armor
reduction — they stay separate rows, **not** providers of it. Max stack is 4485.

**Do not add a `chance_to_miss` group.** Scorpid Sting (−5%) and Insect Swarm
(−2%) *stacked* in 2.4.3; the exclusivity is a 3.0.2 change. Caveat: one report
suggests TBC Classic 2.5.x may have shipped the WotLK behaviour. Test in-game
before relying on the stacking.

The `sunder` entry becomes `armor`, with Improved Expose Armor (Rogue,
`preferSpecs: ['Subtlety', 'Combat']`) as its first provider and Sunder Armor
(Warrior, `preferSpecs: ['Protection']`) as its second. The row's display name
follows whichever provider is chosen.

Curse of Recklessness gains a per-boss opt-out: −800 armor but **+136 melee AP**
on the boss. Improved Demo Shout's −420 more than covers it, so this is an
enrage/AP-scaling-fight concern, not a general caution.

---

## Workstream 3 — RSS2 wire format

Depends on: nothing. Blocks Workstream 4.

The addon currently sends `name:CLASS:41/20/0`. Three fields are needed and none
exists today:

- **subgroup** — required for any party-scoped assignment (totems, auras).
- **race** — required for draenei placement (Heroic Presence / Inspiring
  Presence are party-scoped +1% hit, and a second draenei in the same group is
  wasted), and for Fear Ward, which in TBC only Dwarf and Draenei priests have.
- **per-talent ranks** — the tool's single largest source of wrong guesses.

One bump covers all three. `GetRaidRosterInfo(i)` returns subgroup;
`UnitRace(unit)` returns the race token; `GetTalentInfo(tab, index, isInspect)`
returns each talent's rank.

### Why talents, and why now

The addon has held full inspect data all along — `GetTalentTabInfo` is only the
summary view of what `GetTalentInfo` exposes per talent. Reading tab totals and
discarding the rest is why this spec is littered with "spec is a proxy, never
proof" caveats. It does not have to be.

With ranks in hand, these stop being guesses:

| Rule | Guessed from spec | Known from talents |
|---|---|---|
| Judgement of the Crusader is worth assigning | "is a Ret paladin" | Improved Seal of the Crusader ≥ 1 |
| Demo Shout vs Curse of Weakness ranking | spec order, a coin flip when both are talented | Improved Demoralizing Shout and Improved Curse of Weakness ranks compared directly |
| Improved Expose Armor beats a Sunder stack | "is a Subtlety rogue" | Improved Expose Armor = 2 |
| Faerie Fire gives +3% hit | "is a Balance druid" | Improved Faerie Fire rank |
| Curse of Elements is 13% not 10% | "is Affliction" | Malediction rank |
| Thunder Clap is −20% | "is Prot or Arms" | Improved Thunder Clap = 3 |
| A Feral can cast Faerie Fire in form | **unresolved open question** | Faerie Fire (Feral) rank — answers it outright |

That last row is worth noting: an open question flagged across three plans
becomes a lookup rather than a debate.

```
RSS1  (today)  header "RSS1"   name:CLASS:41/20/0
RSS2  (new)    header "RSS2"   name:CLASS:41/20/0:3:Draenei:2500302012521251-0500321-0
```

The talent field is the standard WoW build-string shape: one digit per talent in
tree order, trees separated by `-`. Max rank is 5, so one digit per talent always
suffices. Tab totals stay in the format even though they are now derivable —
they cost nine bytes and act as a checksum against a mis-parsed talent string.

Parser accepts both formats, and each trailing field is independently optional
so a partial line still parses. `player.group`, `player.race` and
`player.talents` are `null` on RSS1 input. `.toc` Version goes 1.0 → 2.0.

Reading a talent by position needs a `(class, tab, index) → talent` map, which
is bounded data-entry work for the ~15 talents the tool cares about, and must be
verified against a live 2.5.6 client. That map and the rule rewrites it enables
are Workstream 7, not this one — this workstream only has to carry the data.

Every existing test must pass unchanged except the two fixtures that
`deepStrictEqual` a whole player object — that is the back-compat proof.

---

## Workstream 4 — Group layout proposer

Depends on: Workstream 3.

New opt-in surface. Given the roster, propose a 5-party layout and show why.

### What makes this a real feature in TBC

Almost everything is **party-scoped** in TBC and became raid-wide only in WotLK:
all shaman totems (20 yd), all paladin auras (30 yd), Battle/Commanding Shout,
Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration,
Unleashed Rage, Draenei racials. Raid-wide is a short list: Arcane Brilliance,
PW:Fortitude, Divine Spirit, Shadow Protection, Gift of the Wild, Thorns —
plus Greater Blessings, which are raid-wide **by class**.

Structural rule to encode: **one totem per element per shaman.** Windfury,
Wrath of Air, Grace of Air and Tranquil Air are all Air slot, so an enhance
shaman in the melee group gives Windfury + Strength of Earth but *not* Grace of Air.

### Algorithm

Rule-based greedy, not search — there are ~4 archetype buckets and ~5 anchor
classes, and the buff graph is near-bipartite with dominant weights.

1. Bucket every player: `tank | melee-dps | ranged-phys | caster-dps | healer`.
2. Seed groups by **shamans first** — Enh → melee, Ele → casters, Resto → healers/tanks.
3. Second-tier anchors: warrior → melee (Battle Shout), feral → melee and boomkin
   → casters (crit auras follow their consumers), BM hunters together (Ferocious
   Inspiration stacks multiplicatively), shadow priest → casters (Vampiric Touch).
4. Fill remaining slots from each bucket into its matching group.
5. **Draenei pass** — swap-only, one per group, never breaking steps 2–3.
   Melee-flavoured draenei to physical groups, caster draenei to caster/healer.
6. Overflow: leftovers to the group with the most compatible remaining buffs.
7. Optional polish: pairwise hill-climb scored by a buff-value table.
   25 players ≈ 300 swaps, cheap. This is where scoring earns its keep — not the
   initial build.

**Hunters are not melee for grouping.** Windfury is a main-hand enchant and
ranged attacks do not proc it. They are their own bucket wanting Grace of Air,
Trueshot, Ferocious Inspiration, LotP and Battle Shout.

### Scarcity fallback

Shaman priority with fewer than five: **melee** (Windfury/SoE, largest DPS
delta) → **casters** (Totem of Wrath, near-mandatory for spell hit cap) →
**healers** (Mana Tide) → **hunters** (Grace of Air) → **tanks** (least valuable).

Other gaps: no ele shaman → casters need alternate spell hit; no feral/boomkin →
put the one druid with the higher-value crit consumers; no paladin for a group →
that group loses its aura, prioritise Devotion on tanks.

### Sizing

Group count is `ceil(roster.length / 5)`, capped at 5. Must degrade sanely for
10-man Karazhan (2 groups) — the anchor rules collapse rather than error.

### Output

Proposed layout, plus a per-group explanation of which buffs that grouping
buys. Never auto-applies: the raid lead reads it and moves people in-game.

---

## Workstream 5 — Greater Blessings grid

Depends on: Workstream 1.

PallyPower-style matrix. Rows are paladins, columns are the nine classes, each
cell is a blessing. Auto-filled by paladin spec, every cell editable.

Greater Blessings are per-**class** — one cast covers every raid member of that
class for 30 minutes. This is why the grid is paladin × class and not
paladin × player.

Default fill: Ret → Greater Kings raid-wide; Holy → Greater Might to physical,
Greater Wisdom to casters; Prot → Sanctuary to tanks, Greater Salvation to
everyone else; 4th paladin → Blessing of Light, or takes Salvation.

Grid must show coverage gaps (a class column with no blessing) and overlaps
(two paladins casting the same blessing on the same class — wasted).

---

## Workstream 6 — Rotations + remaining debuffs

Depends on: Workstream 1.

**Rotations** — an ordered list of players per duty, a new duty shape alongside
the existing single-player rows:

- **Fear Ward** (Priest, 30s CD / 3min duration) — TBC-only, mandatory on
  Magtheridon, Gurtogg Bloodboil, Azgalor.
- **Tranquilizing Shot** (Hunter, 20s CD) — Gruul, Magtheridon.

Auto-ordered by class/spec, manually reorderable.

**Remaining catalog entries** — straightforward additions once Workstream 2's
`targetGroup` exists:

- Improved Thunder Clap (Warrior, −20% attack speed at 3/3) — own targetGroup
  with Chilled and Thunderfury.
- Insect Swarm (Balance Druid, −2% hit), Scorpid Sting (Hunter, −5% hit).
- Hemorrhage (Subtlety Rogue), Curse of Tongues (spare warlock — niche;
  3rd/4th warlocks prefer Curse of Doom if the target lives 60s, else Agony).

---

## Confidence flags

Carry these into the plans; do not present them as settled.

- **Faerie Fire (Feral) as a TBC Feral talent** — the basis for ranking Feral
  above Resto on `ff`. Not verified by research; confirm before relying on it.
- **Scorpid Sting / Insect Swarm stacking in 2.5.x** — stacked in 2.4.3 per the
  3.0.2 patch note wording, but a Blizzard EU report says TBC Classic may differ.
- **Improved Demo Shout vs untalented Curse of Weakness** — the −420/−350 numbers
  are verified, but which a given player actually has is invisible to the addon.
- **Totem of Wrath's exact effect** (+3% spell hit and crit) — reported by
  research, worth a second check before it drives group scoring.

## Not in scope

- Per-boss assignment profiles (the CoR opt-out is a flag, not a profile system).
- Tank assignments per boss, interrupt rotations, Misdirection targets,
  Bloodlust timing, decurse/dispel duty. All real, all deferred.
- Any change to the Discord output format beyond rendering the new duty types.
