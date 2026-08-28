# Healer Split (Tank / Raid buckets) — Design

**Date:** 2026-08-16
**Status:** Approved by owner (two buckets, auto + overrides, MT flag as tank source)

## Problem

Deaths happen because healers tunnel: everyone heals the raid and a tank drops, or
everyone babysits tanks and the raid melts. The sheet needs healer assignments that
split healers into a **tank-healing bucket** and a **raid-healing bucket**, proposed
automatically and delivered through the existing whisper/Discord/addon pipeline.

Owner decisions (settled, do not re-ask):
- **Two buckets**, not per-tank mapping, not per-group raid ranges.
- **Auto-propose with manual overrides**, like every other duty.
- **Tank set comes from the existing MT checkboxes** (`state.playerMeta[name].mt`),
  promoted from optimizer-only use. No MT ordering — two buckets only need the set.

## TBC healer-role research (basis for the heuristic)

TBC 2.5.6 meta, confirmed against Anniversary-era guides (Overgear TBC Anniversary
healer guide; Dot Esports TBC healer tier list) and owner's own read:

| Spec | Role bias | Why |
|---|---|---|
| Paladin Holy | Tank | Premier single-target healer (Holy Light/FoL spam) |
| Druid Restoration | Tank | Lifebloom/HoT rolling on tanks is the TBC druid niche |
| Priest Discipline | Tank | Single-target + Pain Suppression/support |
| Priest Holy | Raid | Deep Holy / Circle of Healing = raid healing |
| Shaman Restoration | Raid | Chain Heal is the defining TBC raid heal |

Spec comes from the existing talent-based inference (`inferSpec`), so Disc vs Holy
priests are already distinguishable from `/specscan` data.

## Ratio research (2026-08-16, after the owner flagged the split as tank-heavy)

The first implementation used `round(1.5 × tankCount)`, which put 3 of 5 healers on
tanks and, at 3 tanks, left raid healing to one person. Sources on TBC practice:

| Source | Assignment | Implied ratio |
|---|---|---|
| General convention (Type H For Heals, via LootXP) | "a healer per tank, usually a Priest or Paladin, a Druid would roll HoTs on the tanks, while the Shaman and spare CoH Priests would be assigned to raid heal" | 1.0 |
| Magtheridon guides | "each tank needs a dedicated healer during Phase 1" | 1.0 |
| Hydross (SSC) | MT 2 healers, OT 3 — but the OT healers are covering add-tanks | ~1.0 effective |
| Gruul | MT 3 (one a HoTer), "OT/**Raid**" 3 (one AE) | 1.5 — the tier's most tank-damage-heavy fight, and the second group doubles as raid healers |

Cross-check from composition: the standard 25-man is 3 tanks + 7 healers mixed 2-3 resto
shamans, 1-2 holy paladins, 1 holy priest, 1 resto druid. Shamans and the Holy priest are
the raid healers — 3-4 of 7. `1.0×` yields exactly 3 tank / 4 raid there; `1.5×` yielded
5 / 2, which would have assigned Chain Heal shamans to tank duty.

Gruul is the one source supporting 1.5, and it is the outlier the ⇄ toggles exist for.
The affinity order (paladin → tank, druid → tank HoTs, shaman + CoH priest → raid) is
independently confirmed by the same sources and was left unchanged.

## Data model

New duty category **`healing`** produced by `autoAssign`, with exactly two rows using
the **rotation shape** (`players: []`, no single `player` — same as Fear Ward):

```js
{ id: 'tankheal', name: 'Tank Healing', category: 'healing', players: [...], targets: [/* tank names */] }
{ id: 'raidheal', name: 'Raid Healing', category: 'healing', players: [...] }
```

`targets` on `tankheal` carries the resolved tank set so renderers and whispers can
name the tanks without re-deriving them. (Note the existing trap: duty shape is not
uniform across categories; `healing` follows rotations' `players[]` convention.)

## Tank set resolution

1. Players whose `playerMeta[name].mt` flag is set → the tank set.
2. If **no** MT flags are set: fall back to `bucketOf(p) === 'tanks'` (Prot warrior,
   Prot paladin, declared Guardian) and show a sheet hint: "No MTs flagged — using
   detected tanks. Flag MTs in the player tuning panel."
3. The group optimizer's existing consumption of `mt` is untouched.

## Auto-assign heuristic (pure, in assignments-engine.js)

1. Healers = roster where `bucketOf(p) === 'healers'`.
2. **Affinity order** (tank-first): `PALADIN:Holy` → `DRUID:Restoration` →
   `PRIEST:Discipline` → `PRIEST:Holy` → `SHAMAN:Restoration`. Ties within a tier
   break by roster order (deterministic output; tests rely on it).
3. **Bucket size:** `tankHealerCount = min(tankCount, floor(healerCount / 2))`,
   with a minimum of 1 when `tankCount > 0` and `healerCount ≥ 2`.

   **One healer per tank** is the TBC convention, not a guess — see the ratio research
   below. The **half-the-healers cap** exists because `tankCount` is usually auto-detected
   rather than curated: with no MTs flagged it counts every prot-specced player on the
   roster, so an uncurated roster inflates it, and uncapped that starves raid healing
   (3 tanks + 4 healers gave 3 tank / 1 raid). The cap also subsumes the older
   "leave at least one raid healer" clamp, since `floor(h/2) ≤ h−1` for all `h ≥ 1`.

   - 0 tanks → everyone raid-heals, `tankheal` row renders empty with the no-tanks hint.
   - 1 healer → they go to `raidheal` (they're healing everything anyway); sheet
     shows a "solo healer covers both" note.
   - 2 tanks, 5 healers → 2 tank / 3 raid.
   - 3 tanks, 7 healers → 3 tank / 4 raid (the standard 25-man).
   - 2 tanks, 3 healers → 1 tank / 2 raid (the cap bites on 10-man; use the ⇄ toggles
     if the fight wants both tanks covered).
4. Take the top `tankHealerCount` by affinity order into `tankheal`; rest → `raidheal`.
5. **Overrides:** a per-healer forced-bucket map (`overrides.healing = { [name]: 'tank'|'raid' }`)
   is applied first; the heuristic fills the remainder toward the target size. Overrides
   persist in sheet state and survive `recompute()` like other duty overrides. Stale
   names (player left roster) are swept like other stale references.

## Surfaces

- **Sheet:** new "Healing" card in assignments.html between Cooldowns and Crowd
  Control. Renders the two rows with per-healer bucket toggles (tank ⇄ raid). Rendering
  lives in assignments.js (cannot be node-tested; keep all logic in the engine).
- **whisperMap:** tank healers get `TANK HEALING — keep <tank names> up`; raid healers
  get `RAID HEALING`. This single choke point propagates to `/raid` lines, whispers,
  and the addon RSW payload automatically.
- **buildDiscord:** extend its hardcoded category list (`[['debuffs'], ['cooldowns']]`)
  to include `healing`.
- **assignments-view.html:** render the healing card (view page currently only shows
  debuffs/passives/cooldowns/CC — add healing; do not fix the pre-existing
  blessings/rotations gap in this feature).
- **No compliance tracking:** `@T` uptime tracking cannot express "healed the tank".
  Ships whisper/display-only, same as blessings.

## Error handling

- No healers in roster → both rows render empty; no whisper lines emitted.
- Tank set names not in roster (stale MT meta) → swept by the existing stale-reference
  pass; never emit a whisper naming a departed tank.
- Overrides referencing departed healers → swept, heuristic refills.

## Testing (assignments-engine.test.js, node)

- Affinity ordering: paladin+druid picked before shaman at equal counts.
- Disc priest → tank bucket; Holy priest → raid bucket (talent-inferred specs).
- Sizing table: (tanks, healers) → expected split, incl. 0 tanks, 1 healer, 1 tank/2
  healers (min-1 rule), large rosters (clamp to healers − 1).
- MT-flag set respected; fallback to detected tanks when no flags.
- Overrides: forced bucket wins over affinity; remainder still fills to target; stale
  override swept.
- Determinism: same roster → identical output.
- whisperMap/buildDiscord include healing lines; tank names appear in tank-healer text.

## Out of scope (YAGNI)

- Per-tank healer mapping, raid-group ranges for raid healers.
- MT ordering (MT1/MT2).
- Compliance tracking for healing.
- Any change to the group optimizer's use of `mt`.
