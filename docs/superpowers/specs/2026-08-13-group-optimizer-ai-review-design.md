# Group-layout optimizer + AI second-opinion review — design

Date: 2026-08-13
Status: awaiting Max's review

## Problem

`proposeGroups` builds good core groups (role buckets, one shaman per group) but its
overflow pass is buff-blind: leftover players go to the fullest group with room
(assignments-engine.js, pass 3). On the live 22-man roster this parked a combat rogue
and a destruction warlock with the healers and left both tanks alone in a 2-man group
with 3 empty seats. The fix is a buff-aware score plus a deterministic optimizer, and
— separately — an advisory AI review button so Max can get a second opinion on the
whole sheet without leaving the tool.

Two deliverables, independent of each other:

1. **Engine:** a buff-value model and a hill-climb optimizer over the seeded layout.
2. **Server + UI:** a `POST /api/ai-review` proxy to OpenAI and a button that renders
   its critique. Advisory only — it never moves a player.

## 1. Buff-value model

New engine-level table `BUFF_WEIGHTS` plus a function `playerBuffScore(p, group)`
returning the summed value of every party-scoped buff `p` would receive in `group`.
Units are arbitrary: 1 = minor, 10 = the largest single delta in the game (Windfury
on a windfury user). All buffs modeled are party-scoped on Anniversary; Bloodlust is
raid-wide there and stays out of the model (existing comment block above
`GROUP_ROLES` is the authority).

### Receiver archetypes

Derived from class/spec (finer than `bucketOf`):

- `wfMelee` — Arms/Fury warrior, any rogue. Benefits fully from Windfury Totem.
- `enhShaman` — provides Unleashed Rage + totems; does NOT benefit from Windfury
  Totem (uses own weapon imbues; totem does not apply over an imbue). ⚠ mechanics
  assumption, flagged below.
- `feralCat` / `bear` — no Windfury (weapon-imbue totems do not affect shapeshifted
  druids ⚠), yes Strength of Earth / Grace of Air / Leader of the Pack / Battle Shout.
- `hunter` — Grace of Air, Leader of the Pack, Trueshot, Ferocious Inspiration.
  Battle Shout is melee AP only ⚠ → 0.
- `caster` — Wrath of Air, Totem of Wrath, Moonkin Aura, Vampiric Touch (mana),
  Ferocious Inspiration.
- `healer` — Mana Tide, Wrath of Air (+heal component), Vampiric Touch.
- `protWarrior` — reduced Windfury (threat), Strength of Earth, shout, LotP.
- `protPaladin` — spell-driven: small Wrath of Air / Totem of Wrath / Mana Tide value.

### Weights

| Buff (provider) | wfMelee | enh | feralCat | bear | hunter | caster | healer | protWarr | protPala |
|---|---|---|---|---|---|---|---|---|---|
| Windfury Totem (any shaman, air) | 10 | 0 ⚠ | 0 ⚠ | 0 ⚠ | 0 | 0 | 0 | 5 | 0 |
| Strength of Earth (any shaman) | 3 | 3 | 3 | 2 | 0 | 0 | 0 | 2 | 1 |
| Grace of Air (any shaman, air) | 2 | 2 | 5 | 5 | 7 | 0 | 0 | 1 | 1 |
| Wrath of Air (any shaman, air) | 0 | 0 | 0 | 0 | 0 | 7 | 3 | 0 | 1 |
| Totem of Wrath (Elemental) | 0 | 0 | 0 | 0 | 0 | 7 | 1 | 0 | 1 |
| Mana Tide (Restoration shaman) | 0 | 1 | 0 | 0 | 1 | 2 | 6 | 0 | 1 |
| Battle Shout (any warrior) | 4 | 4 | 4 | 3 | 0 ⚠ | 0 | 0 | 3 | 0 |
| Unleashed Rage (Enhancement) | 5 | — | 4 | 2 | 0 | 0 | 0 | 2 | 0 |
| Leader of the Pack (Feral/Guardian) | 5 | 4 | 5 | 3 | 5 | 0 | 0 | 2 | 0 |
| Ferocious Inspiration (Beast Mastery) | 3 | 3 | 3 | 1 | 3 | 3 | 0 | 1 | 1 |
| Trueshot Aura (Marksmanship) | 3 | 3 | 3 | 1 | 5 | 0 | 0 | 1 | 0 |
| Moonkin Aura (Balance) | 0 | 0 | 0 | 0 | 0 | 4 | 1 | 0 | 0 |
| Vampiric Touch mana (Shadow) | 0 | 0 | 0 | 0 | 0 | 4 | 3 | 0 | 1 |
| Blood Pact (any warlock ⚠) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 |
| Paladin aura (any paladin) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Draenei presence (Draenei, matching kind) | 2 | 2 | 0 | 0 | 2 | 2 | 0 | 2 | 0 |

Self-buffs count for the provider too where they apply (a Feral gets its own LotP
value); a buff provided twice in one group counts once.

### Shaman totem-choice rule

One totem per element, per group — the same rule the air-totem NOTE_RULES already
encode. For scoring, a group's shaman contribution is computed group-wide, not
per-shaman:

- **earth:** Strength of Earth if any shaman is present.
- **air:** whichever of Windfury / Grace of Air / Wrath of Air maximizes the group's
  summed score (argmax over the three).
- **fire:** Totem of Wrath if any Elemental is present.
- **water:** Mana Tide if any Restoration shaman is present.

A second same-spec shaman therefore adds exactly zero, which is what makes the
optimizer spread shamans without a hard constraint.

### Complete inventory — notes must match the score

This table IS the buff inventory: every party-scoped buff the tool considers, in one
place. Two consistency rules follow from that:

1. **Every scored buff gets a group note.** `NOTE_RULES` today covers Windfury,
   Strength of Earth, Grace of Air, Wrath of Air, Totem of Wrath, Mana Tide, Battle
   Shout, Unleashed Rage, Leader of the Pack, Ferocious Inspiration and the paladin
   aura. New note rules are added for the modeled buffs that currently print
   nothing: **Trueshot Aura, Moonkin Aura, Vampiric Touch (mana), Blood Pact** —
   otherwise the optimizer places someone "for" a buff the panel never shows, and
   the layout looks arbitrary. Same pattern as the existing rules (provider in
   group + at least one non-provider beneficiary).
2. **No per-player buff assignments are needed.** Unlike debuffs, party buffs are
   automatic from group membership (every warrior shouts their own group, every
   shaman drops for their own party), so "assigning Battle Shout" IS the group
   layout — the notes make it visible, the score makes it deliberate. The one
   flexible case, which paladin runs which aura, stays abstracted at weight 1 and
   out of scope for assignment.

Deliberately excluded, with reasons: **Commanding Shout** (Battle Shout is the
default; stamina-shout choice is a raid call, not a layout input), **resistance
totems/auras and Tranquil Air** (fight-specific), **priest buffs, Arcane Intellect,
Gift of the Wild** (castable on the whole raid regardless of groups), **paladin
Blessings** (raid-wide by class, already handled by the blessings grid),
**Bloodlust/Heroism** (raid-wide on Anniversary, per the standing rule).

### ⚠ Mechanics assumptions (Max to confirm or correct)

1. Windfury Totem does not benefit enhancement shamans (own imbues take precedence).
2. Windfury Totem does not affect shapeshifted druids.
3. Battle Shout grants melee AP only — worthless to hunters.
4. Blood Pact assumes the warlock's imp is out (destro locks often sacrifice it —
   weight kept at 1-2 so it never drives a placement on its own).
5. All listed buffs remain party-scoped on Anniversary (sourced 2026-08-13,
   wowclassicui.com / wowcarry.com — Bloodlust raid-wide is the only scope change).
6. The numeric weights themselves are raid-calling opinion, not fact. They only need
   to be *ordinally* right (WF ≫ shout for a rogue, GoA > WoA for a hunter group).

## 2. Optimizer

`proposeGroups` keeps its existing passes unchanged as the **seed**: shaman seeding,
role fill, fullest-first overflow, the draenei/anchor swap pass. Then a new final
pass runs before relabeling:

```
scoreLayout(groups) = Σ playerBuffScore(p, group)  over all placed players
                    + 0.25 × Σ (players in each group's majority bucket)   // cohesion
```

Hill-climb: enumerate every cross-group pair swap and every move of a player into an
empty seat, in deterministic order (group index, then player name); compute the score
delta; apply the single best strictly-positive move; repeat until no move improves;
iteration cap 500 as a runaway guard. No randomness anywhere — identical roster in,
byte-identical layout out.

Consequences the design intends (and tests assert):

- The 2-man tank island dissolves on under-25 rosters because the score says so:
  Guardian → hunter group (gains Grace of Air, gives LotP), Prot → a shaman group.
- Overflow DPS land where they gain buffs (destro lock → Wrath of Air group).
- Same-spec shamans never stack (second totem set is worth zero).
- Groups stay recognizable archetypes (cohesion term breaks near-ties toward
  role clustering, never overrides a real buff gain — 0.25 < the smallest weight 1).

Relabeling and `NOTE_RULES` (extended with the four new rules from section 1, but
otherwise unchanged) run on the optimizer's output, so the printed notes always
describe the final layout. `scoreLayout` and `playerBuffScore` are added to the
engine's exports for tests.

## 3. AI second-opinion review

### Server (server.js)

New endpoint following the `/api/raidhelper/:eventId` proxy pattern:

- `POST /api/ai-review` — body: `{ roster, groups, debuffs, blessings, uncovered,
  passives }` (whatever the client assembles from live state; server treats it as
  opaque JSON to embed in the prompt).
- Calls `https://api.openai.com/v1/chat/completions` with model
  `process.env.OPENAI_MODEL || 'gpt-5-mini'`, 60 s timeout, temperature default.
- System prompt states the Anniversary rules verbatim (Bloodlust raid-wide and
  excluded; totems/auras/shouts/LotP/Trueshot/Ferocious/VT/Mana Tide party-scoped;
  one totem per element; a resto shaman near melee drops Windfury as baseline;
  Windfury does not affect shapeshifted druids or hunters) so the model cannot repeat
  ChatGPT's ignorant-of-the-rules mistakes. Instructions: advisory critique of the
  whole sheet, concrete swap suggestions welcome, ≤ 400 words, plain text.
- Response: `{ review: "<text>" }`; failures: `{ error: "<message>" }` with a
  non-200 status (503 if no key configured).

### Key handling

- Key read from `process.env.OPENAI_API_KEY`, falling back to a `.env` file at the
  repo root parsed with a ~5-line `KEY=VALUE` reader (no new dependency).
- `.env` is added to `.gitignore` in the same commit that adds the reader. The key
  never appears in the repo, the spec, the plan, any test, or any client-side code.
  The browser only ever talks to `/api/ai-review`.

### UI (assignments.html + assignments.js)

- One button, `AI second opinion`, in the Group layout panel header next to the
  existing controls.
- Click → button disables with a "Asking…" label → POST current state → render the
  returned text in a collapsible box under the groups panel (`aiReviewBox`,
  `white-space: pre-wrap`; hidden until first use).
- Errors render in the same box as a single status line ("AI review failed: …").
- The response is display-only. No handler mutates roster, sheet, or groups.

## 4. Testing

All engine tests append to `assignments-engine.test.js` (`node
assignments-engine.test.js`, currently 225 passing; no network calls in the suite):

- **Weights:** spot checks per archetype (rogue values WF at 10 and WoA at 0; hunter
  values GoA over WF; enh shaman gains 0 from Windfury Totem).
- **New note rules:** an MM hunter with melee prints the Trueshot note; a Balance
  druid with casters prints Moonkin Aura; a Shadow priest with casters prints
  Vampiric Touch; a warlock group prints Blood Pact; none print without a
  beneficiary present.
- **Totem choice:** a group of casters + shaman scores air as Wrath of Air; the same
  shaman with melee scores it as Windfury; adding a second same-spec shaman changes
  no group's score.
- **Optimizer invariants:** every roster member placed exactly once; no group over
  `GROUP_CAP`; score is monotonically non-decreasing across iterations; running
  `proposeGroups` twice on the same roster yields deep-equal output.
- **Regression fixture** shaped like the live 22-man roster: asserts the destro lock
  lands in a Wrath of Air/Totem of Wrath group, no 2-man tank island remains, the
  Guardian shares a group with hunters or a shaman, and same-spec shamans are spread.
- **Already-optimal seed:** a roster the seed passes handle perfectly is returned
  unchanged (zero optimizer moves).
- **Server endpoint:** exercised manually plus with a stubbed `fetch`; the automated
  suite never hits OpenAI.

Final verification through the headless-Chrome CDP harness against Raid-Helper event
`1536119496337653871`: import → auto-assign → assert the new layout properties →
one live click of the AI button (the only live OpenAI call in verification).

## Out of scope

- The LLM proposing or applying layouts (advisory text only).
- Persisting/caching AI reviews, auth or rate limiting on the endpoint (localhost
  tool), streaming responses.
- Any change to debuff/blessing/passive assignment logic — the optimizer touches
  group layout only.
