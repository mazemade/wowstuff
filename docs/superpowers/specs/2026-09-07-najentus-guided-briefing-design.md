# Naj’entus guided briefing design

**Status:** Astra planning proposal, ready for user review and a subsequent Terra implementation. This planning pass changes documents only. No implementation, commit, deployment or release is authorized by this document itself.

**Goal:** Add High Warlord Naj’entus to the existing presenter-controlled Tactics page with the same finish as Supremus: understandable animated decisions, real roster support, usable playback and useful exports.

## Product boundary and approach

The existing Supremus briefing is the reference experience. Retain its nine chapters and all current behavior. Add Naj’entus through a small boss picker and seven chapters on the same page. Keep the existing typography, canvas, role artwork, guidance rail, scene spell cards, keyboard navigation and export controls. No trash preparation, boss editor, combat log integration, encounter simulator, inventory interaction game or Positioning-page redesign.

Three approaches were considered:

1. **Shared presenter with a focused Naj’entus adapter — recommended.** Keep mature Supremus simulation intact, add a pure Naj’entus frame model and separate drawing code, and make only the shared labels, routing, map dimensions and exports fight-aware.
2. Duplicate the whole presenter for Naj’entus. Initially straightforward, but duplicates approximately 1,400 lines and gives playback, accessibility and exports two maintenance paths.
3. Rewrite everything as a general encounter engine. More abstraction than two encounters justify, with avoidable regression risk to Supremus.

Terra is appropriate for execution. This repository uses small vanilla JavaScript modules, Node assertions and an existing browser harness. The difficult work is encounter interpretation and deciding boundaries; this design resolves those. Execute sequentially, with the existing Supremus browser suite as the gate after shared presenter changes. An Astra review at that checkpoint is useful, not an extra permission requirement.

## Verified encounter model

Naj’entus has one sustained tanking phase with recurring shield interruptions. The briefing must not show Supremus-style phase changes, threat resets, Hateful soaking, fixate or volcanoes. One main tank holds the boss. Other imported tanks remain visible with their real role but receive no invented tank mechanic.

The teaching chain is **spread → free an impaled ally → retain the looted spine → heal up during shield → one called throw → recover from the raidwide hit**. Needle Spine and Impaling Spine must be clearly distinguished.

| Mechanic | Teach | Evidence |
|---|---|---|
| Needle Spine | Several players are hit; its explosion affects nearby allies within 6 yards. Space out where possible; melee use available room and healing coverage. This is not a projectile-dodging lesson. | [Needle Spine](https://www.wowhead.com/tbc/spell=39835/needle-spine), [Needle Spine Explosion](https://www.wowhead.com/tbc/spell=39968/needle-spine-explosion) |
| Impaling Spine | A non-MT victim is incapacitated. Another raider clicks the spine on the victim; extraction frees them and gives the rescuer the item. The victim does not loot their own spine. | [Impaling Spine](https://www.wowhead.com/tbc/spell=39837/impaling-spine), [Classic strategy](https://www.wowhead.com/tbc/guide/high-warlord-najentus-black-temple-bt-strategy-burning-crusade-classic) |
| Tidal Shield | The boss is immune and heals while shielded. Keep the shield pause brief, but top the raid before breaking it. | [Tidal Shield](https://www.wowhead.com/tbc/spell=39872/tidal-shield) |
| Hurl Spine | A designated holder targets Naj’entus and uses the collected item from within 25 yards on the call. Save spare spines. | [Hurl Spine](https://www.wowhead.com/tbc/spell=39948/hurl-spine), [Naj’entus Spine item](https://www.wowhead.com/tbc/item=32408/najentus-spine) |
| Tidal Burst | Shield break causes a simultaneous 8,500 Frost damage hit to the raid. Spreading or running away is not its solution. Heal before and after. | [Tidal Burst](https://www.wowhead.com/tbc/spell=39878/tidal-burst) |

An example first cycle places impales around 20 and 40 seconds and a shield around 60 seconds, consistent with [Method’s encounter guide](https://www.method.gg/guides/black-temple/high-warlord-najentus). These are teaching timestamps, not a live boss-mod timer or a claim that a delayed break determines the next exact cast time. Omit an exact shield healing rate and uncorroborated named cleave abilities. Health bars are illustrative fractions, not simulated health pools or a gearing calculator. The preparation reminder says to have enough buffed maximum health to survive the 8,500 Frost burst; being at full health does not make a lower maximum-health pool safe. Mention stamina gear/buffs if needed without inventing a numeric roster-readiness score. A healthstone after the hit can aid recovery.

The existing `hyjal-positions.js` comment/test description attributes spread to Impaling Spine. Do not reproduce that error. Correcting that separate module is outside this feature’s scope. Naj’entus tips use an accurate “Briefing reminders” heading; do not claim they were transcribed from Supremus’s guild image.

## Seven chapters and authored teaching beats

Every scene has its own title, caption, one main call, reason, role instructions and common mistake. Each opens independently. Animated scenes stop at the final frame; they do not automatically advance. Reduced motion opens paused, retaining a useful diagram, caption and role instructions.

| ID / chapter | Duration | Main call and animation |
|---|---:|---|
| `overview` / The loop | 6s, static | **“Spread. Free the impaled. Heal up. One called throw.”** Show the raid and numbered loop summary; describe one fight with shield interruptions. |
| `positioning` / Pull & positions | 6s, static | **“One tank. Use your space. Keep healers in reach.”** Show all real names only here. MT in front, melee behind, healers distributed through ranged. Explain 6-yard Needle splash without promising universal 6-yard melee spacing. |
| `needle` / Needle Spine | 9s | **“Give Needle targets room. Heal the hit.”** At 1s, highlight up to three illustrative recipients, not a fixed assignment. Show 6-yard target-centered splash circles and a brief direct hit. Show a marked nearby ally inside one circle to demonstrate collateral damage; restore their example starting place after the effect. No reflex dodge animation or persistent ground hazard. |
| `impale` / Free an ally | 10s | **“Nearest free player: click the spine, then keep it.”** Impale at 1s; victim remains stationary. Rescuer approaches from 2s, extracts at 4.5s, and returns by 7.5s. At extraction the victim’s pin disappears and a spine badge appears on the rescuer. Label the interaction “Click spine”; keep the MT holding the boss. |
| `shield` / Heal before the break | 9s | **“Shield up. Top the raid. Hold your spine.”** Start with a shield and one previously collected spine. Illustrative raid bars rise to full by 4.5s; holder retains item throughout. End with “Raid ready. Wait for the call.” No automatic break. Caption explicitly says this example begins after a spine was collected. |
| `burst` / One called throw | 11s | **“Raid ready. One holder throws; heal the burst.”** Start shielded with one collected spine. Bars reach full at 3.5s. Holder gets within 25 yards by 4.5s, throws at 5s; impact at 5.7s removes shield and hits all raid tokens simultaneously. Item disappears at throw, flight is visible until impact; heal recovery ends at 10s. |
| `cycle` / Put it together | 76s | **“Keep the rhythm: rescue, prepare, call, recover.”** Needle examples at 8s and 32s; impales at 20/40s, extraction at 24/44s, rescuer returns by 28/48s. Shield at 60s, raid ready at 65s, one throw at 67s, impact at 67.7s, recovery by 75s. Show a second holder retaining a spare item after the break. Final call: “Spread again. Keep the spare spine.” |

Scene guidance:

- **Overview:** tank maintains control; raid handles spread and rescue; healers/holder coordinate the break. Mistake: throwing as soon as the shield appears.
- **Positioning:** tank faces boss away; melee spread within practical reach; ranged/healers leave space and maintain coverage. Mistake: tightly stacking an entire group because a diagram gives it one region.
- **Needle:** recipients need healing; neighbors reduce splash exposure with starting spacing; healers cover unavoidable melee splash. Mistake: confusing the splash with the clickable Impaling Spine.
- **Impale:** victim calls their location; nearby available raider extracts; healers support victim and tank; rescuer keeps the item. Mistake: the whole raid converging or expecting the stunned victim to free themselves.
- **Shield:** damage players pause attacks into immunity; healers top everyone; holders wait for the caller. Mistake: a full tank health bar being treated as “raid ready.”
- **Burst:** caller checks raid recovery; one holder uses the item on boss in range; other holders save theirs; healers recover the simultaneous hit. Mistake: trying to outrun the burst or spending every spine.
- **Cycle:** repeat the same jobs while watching teammates and raid health. Mistake: finishing one mechanic and forgetting the collected spine or next shield.

The highlighted “nearest” helper is an example selection, not a persisted guild assignment. Directly opening `shield` or `burst` resolves the same eligible victim/helper pair and gives its helper declared illustrative starting inventory; no previous chapter must have been played. If that pair cannot be resolved, neither the starting item nor a throw is drawn. The cycle requires a distinct second victim/helper pair for the spare-spine example. If that pair is unavailable, omit its rescue and replace spare-item calls with “Spread again. Prepare for the next shield.” Do not reuse a lone player or claim a spare that does not exist.

## Map and roster behavior

Reuse `maps/bt-najentus.png` (2088 × 1146) and `maps/najentus-icon.png` (256 × 256). Do not generate replacement artwork. Preserve the boss anchor `{ x: 0.490, y: 0.288 }`. Start layout calibration with:

```js
mapSize: { width: 2088, height: 1146 },
aspect: 2088 / 1146,
arena: { x0: 0.315, x1: 0.665, y0: 0.16, y1: 0.79 },
yard: 0.0055,
bossAt: { x: 0.490, y: 0.288 },
roster: { tanks: 1, healers: 6, melee: 7, ranged: 11 },
arcs: [
  { count: 7, radius: 16, from: 25, to: 155 },
  { count: 9, radius: 23, from: 25, to: 155 },
  { count: 9, radius: 30, from: 25, to: 155 }
],
stack: { tankApart: 0, tankBack: 5.5, arcRadius: 8, arcFrom: 25, arcTo: 155 }
```

These are initial schematic parameters that must pass a visual check against usable floor. Yard scale is approximate. Keep a margin from the corridor’s columns; adjust the arena/camera if portrait or labels touch the viewport edge. The map’s actual dimensions drive canvas math and aspect ratio; do not stretch it into Supremus’s 1600 × 889 dimensions. Use an optional per-fight map filter: preserve Supremus’s current filter; start Naj’entus at `brightness(1.20) contrast(1.04) saturate(.75)` and assess readability.

Use existing `TacticsLayout.assign` for name preservation and healer/ranged interleaving. Its slots provide the backline. Naj’entus formation places only the first imported tank in front and treats extra tanks as off-tank players positioned on the rear melee arc, while preserving `kind: 'tank'`. Do not label them `SOAK`, automatically change their specs, or hide them. MT ordering still comes from the existing imported `mt` flag.

For the default raid, the 17 backline slots must have more than 6 yards between neighbors. A planning-time calculation using the existing assignment helper confirmed a 6.501-yard minimum for these constants; implementation and visual verification remain required. Do not enforce this impossible guarantee on all melee or every oversized imported roster. Preserve every imported name, including >25 players; report actual count and retain the “illustrative positions” caveat. Never invent fillers for a partial named roster. Without an imported roster use 25 unnamed role tokens.

Resolve impaled targets from non-MT players, preferring ranged for a clear demonstration. Resolve the nearest available non-MT helper by yard distance with stable roster-order tie breaking. A helper cannot be the victim; both remain distinct from other simultaneously active casts. If the roster cannot supply a valid pair, omit that rescue and any throw depending on its item; show a clear note that this roster cannot demonstrate every role. Never draw a missing actor’s effect at the boss. A one-person or MT-only roster still renders, scrubs and exports correctly.

## Shared presenter changes

- Add real anchor links for Naj’entus and Supremus, with accessible current selection, to the header. `tactics.html?fight=bt-najentus` opens Naj’entus. Plain `tactics.html` and an unknown ID safely select Supremus. Preserve unrelated query parameters when changing fight; remove scene-specific fragments. A full navigation deliberately resets presentation state and uses normal browser history.
- Make selected fight name, map dimensions/filter, legend, ability stage label, reference heading, unnamed roster note and export slug data-driven.
- Preserve Supremus’s dual 60s clock. Naj’entus gets a compact state display with six labels: `normal` → “Normal combat”, `shield` → “Shield: heal up”, `ready` → “Ready: await call”, `throw` → “Spine in flight”, `burst` → “Raidwide burst”, and `recover` → “Recover: heal everyone”, plus “Example” elapsed time. After the authored recovery ends the state returns to `normal`. Do not show a fabricated Phase 2 countdown. Stage transitions follow the same frame time as the canvas.
- Change the reference spell-link builder to support `ability.url` before falling back to the existing spell URL. The Hurl Spine card links to spell 39948, and its `itemUrl` field renders a separate “Naj’entus Spine item” body link to item 32408; item IDs must never become `/spell=32408` URLs.
- Use dynamic calls consistently in the guidance rail, mobile call, map caption and exported text/image. The frame is authoritative; the base scene call remains contextual guidance. After paint, `syncCurrentGuidance(sc)` sets `sc.currentCall` from the frame and updates text only if it changed. Both export handlers call `render(performance.now())` before reading the frame/current call so an immediate export after a seek cannot lag behind. Static jobs and mistake text stay scene-owned.
- Export names start `najentus-` or `supremus-` as appropriate. Naj’entus text contains names, current stage and actual encounter jobs, with no Phase 2, Hateful or Misdirect leftovers. PNG footer uses that fight’s legend and current call.

## Module boundaries and deterministic frame contract

New files:

- `tactics-najentus-data.js`: UMD encounter data, source links, metadata and seven authored scenes. CommonJS export is the fight object; browser export is `TacticsNajentusData`.
- `tactics-najentus.js`: UMD pure scene preparation and frame calculation. Depends on `TacticsLayout` only. Exports `prepareScene(fight, scene, assigned)` and `simulate(fight, preparedScene, timeMs)`.
- `tactics-najentus-render.js`: UMD canvas drawing of the new frame overlays. Exports `draw(layer, api, scene, frame)`; no time accumulation or mutation.
- `tactics-najentus.test.js`: data, cast, frame sequencing, inventory and scrub-order regressions.

Existing changes stay in `tactics-data.js`, `tactics-layout.js`, `tactics.js`, `tactics.html`, `tactics.css`, appropriate tests, `package.json` and `README.md`. Do not extract or redesign the existing Supremus simulator.

The Naj’entus frame contains:

```js
{
  pos: { /* playerId: { x, y } */ }, boss: { x, y }, trail: null,
  hp: { /* playerId: fraction 0..1 */ },
  roles: { /* playerId: short current action */ }, focus: { /* playerId: true */ },
  impaled: [/* player IDs */], holders: { /* playerId: integer count */ },
  needles: [/* { targetId, at: {x,y}, radiusYards: 6, hitIds: [...] } */],
  shield: false, ready: false,
  projectile: null, // or { from: {x,y}, to: {x,y}, progress: 0..1 }
  burst: null,      // or { hitAt: number, progress: 0..1, damage: 8500 }
  call: 'Current instruction', stage: 'normal', // normal|shield|ready|throw|burst|recover
  timeMs: 0
}
```

`prepareScene` returns fresh cast/raid/base-position/sequence structures without modifying source data or assigned players. `simulate` clamps time and derives the entire frame from those structures and requested time. No `Math.random`, `Date.now`, accumulating inventory, frame-to-frame HP damage, DOM reads or scheduled callbacks. Seeking backwards restores the pin/item/shield/HP/call appropriate to that exact instant. Finishing then replaying does not double-spend a spine.

`paint` keeps the existing `simulate(sc,t)` browser test seam and dispatches Naj’entus to its module. Feed `frame.hp`, `frame.roles` and `frame.focus` into existing player rendering for Naj’entus; retain Supremus’s existing hp keyframes. Draw Naj’entus floor effects before actors, pins/item badges/projectile after actors and the current call last. The burst uses a room-wide flash and simultaneous HP change; any decorative ripple must never imply distance-based damage timing.

## Validation and completion

Root verified the pre-change baseline at commit `c10e131`: `npm test` passes and `npm run test:tactics-browser` passes 22 checks. This is evidence for existing Supremus, not evidence for the unimplemented feature.

Required behavior checks: both boss URLs and invalid fallback; roster preservation and MT ordering; no fake soak roles; deterministic forward/backward/direct seeks; correct spine ownership and exactly one consumption; shield hold before ready/call; 25-yard throw position; simultaneous raidwide burst; missing-role omission; stage/call/clock/export synchronization; end-frame hold; reduced motion; keyboard and boss-link navigation; local assets load; no browser exceptions.

Run all existing tests and an extended browser harness. Visually inspect positioning, rescue, shield and burst on both desktop and phone sizes (1600×1000, 1280×800, 390×844); record screenshots outside tracked source. Inspect actual images, not only geometry assertions. Verify the map, target/spine distinction, readable badges and no horizontal page overflow. Finish with a concise changed-files and verification report; do not claim code exists while handing off this plan.
