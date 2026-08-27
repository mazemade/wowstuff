# Hyjal Positioning — Design

Date: 2026-08-27
Status: approved in chat; awaiting clean map screenshot from Max

## Purpose

A positioning page for Mount Hyjal bosses 1–2 (Rage Winterchill and
Anetheron). One shared spread layout serves both fights. The tool
auto-assigns the imported roster to positions on a map of the ballista
area, honoring totem-range party adjacency and healer/ranged spread,
and renders a shareable map raiders read their spot from. Max pastes
the map into Discord as an image.

## Encounter research (drives the constraints)

Both fights share a skeleton: main tank + melee stacked centrally,
everyone else spread in a ring at caster range.

- **Rage Winterchill** — Frost Nova: 2775–3225 frost to everyone
  within 20 yd of the boss, 10 s root, dispellable. Death & Decay:
  ground patch at a random raider, 15% max HP/s for 10 s, danger
  radius ~10 yd (sources conflict 10 vs 20). Icebolt: 1 random target,
  needs an instant heal. Constraint kind: **pairwise spacing** — no
  two spots inside one D&D footprint; ranged/healers naturally stand
  outside the 20 yd Nova ring.
- **Anetheron** — Carrion Swarm: 60 yd cone at a random raider,
  3–6k shadow, −75% healing done for 15 s, every ~15 s. Sleep: 3
  targets, 10 s, undispellable. Inferno: every ~60 s an infernal
  (220k HP, taunt-immune) lands on a random raider; 8 yd fire pulse
  (~3.5k per 2 s); Vampiric Aura forbids tanking it near the boss —
  it is dragged to a station near Jaina/the tower. Constraint kind:
  **angular spread** — no two healers share a cone sector; the two
  tank healers stand on opposite sides of the boss.

A ring layout that satisfies Anetheron's angular constraint at caster
range automatically satisfies Winterchill's pairwise constraint. The
one delta: Anetheron adds the infernal off-tank station (plus 1–2
healers who can reach it).

Sources: Icy Veins TBC, MMO-Champion 1272/1273, warcraft.wiki.gg
tactics pages, onlyfarms.gg / expcarry Anniversary Hyjal guides.

## Architecture

### Pages and navigation

- New top-level page `positions.html` + `positions.js`, sibling of
  `assignments.html`. Both pages get a small nav tab bar at the top:
  `Assignments | Positioning`. Future pages are new tabs.
- `positions.html` reads the same localStorage state the sheet writes
  (roster, group layout, healer split) — no re-import, always in sync.
- The page is driven by an **encounter registry**: each entry is a
  config object (id, name, map image path, anchors, arc geometry,
  fight-specific rules). Ships with one entry —
  `hyjal-b12` (*Hyjal · Rage Winterchill & Anetheron*) — with a
  Winterchill ⇄ Anetheron sub-toggle. Future bosses are new registry
  entries (config + image), no structural change.

### Geometry / assignment module

- New `hyjal-positions.js` engine-style module (plain script exposing
  a namespace, like `assignments-engine.js`), unit-testable in node.
- All coordinates are **image fractions (0–1)** so the map scales with
  its container and the background image can be swapped freely.
- Layout constants per encounter: boss + main-tank anchor, melee clump
  marker, infernal-tank station (near tower), spread ring (center,
  radius, start/end angle).

### Assignment algorithm

Input: roster, party layout (groups), healer split (tank/raid
buckets), designated tanks. Deterministic, constructive — no search:

1. Main tank → boss anchor. Infernal tank → station (Anetheron);
   shown at the melee clump on Winterchill.
2. Melee → one shared clump marker listing their names (they stack;
   individual spots are noise).
3. Healers + ranged → generated ring spots. Spot count always equals
   the number of people to place — the ring is generated to fit, never
   the roster truncated to fit.
4. **Party adjacency:** each party's ranged/healers form a contiguous
   wedge of adjacent spots (shaman totem range, ~20–30 yd).
5. **Healer spread:** within the party-wedge constraint, order the
   wedges and positions inside wedges so healers land angularly even
   around the ring; the two tank healers are forced to (near-)opposite
   sides of the boss.
6. **Anetheron labels:** the 1–2 raid healers nearest the tower
   station are additionally labeled as infernal-station healers.
7. **Warnings** (rendered like the sheet's existing warn boxes):
   healers clustered inside one ~60° sector; no healer within reach of
   the infernal station; a party wedge stretched beyond totem range.

### Manual nudges

Any marker can be dragged. Nudges persist as per-player fractional
offsets in state, survive re-running the auto-assignment (they follow
the player, not the spot), and a Reset button clears them.

### Share & export

- Share payload (existing base64-in-URL mechanism) gains: encounter
  id, boss sub-toggle, computed placements, nudge offsets.
  `assignments-view.html` renders the same map read-only.
- **Copy as image**: renders background + markers + names to a canvas
  and writes a PNG to the clipboard for pasting into Discord.

## Map background

Max provides a clean screenshot of the ballista area (no text
overlay). Anchors and arc geometry are digitized from the annotated
strategy screenshot; fractional coordinates mean the clean image can
drop in later without rework. Image lives in the repo as a static
file.

## Testing

- Node test suite `hyjal-positions.test.js` mirroring the existing
  suites: spot count always matches roster; party wedges contiguous;
  healer angular spacing above threshold; tank healers opposite;
  melee never on the ring; nudge offsets respected and reset works;
  warnings fire on constructed bad rosters.
- UI verified with the headless-Chrome CDP harness (see memory:
  wowstuff-verification-harness).

## Out of scope

- Addon/Lua output of positions (share-view image is the deliverable).
- Whisper/Discord text rendering of positions.
- Position editor UI for authoring new encounters (registry entries
  are code).
