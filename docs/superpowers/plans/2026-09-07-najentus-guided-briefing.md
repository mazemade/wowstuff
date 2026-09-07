# Naj’entus Guided Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task, sequentially with Terra as requested by the user. Steps use checkbox syntax. Do not begin implementation during the Astra planning turn.

**Goal:** Add a complete seven-chapter Naj’entus briefing to the existing Tactics page while preserving the completed Supremus experience.

**Architecture:** Share the presenter, roster import, playback and exports. Give Naj’entus its own encounter data, pure frame model and canvas overlay module; leave Supremus’s movement simulation and continuity behavior intact. Use real boss navigation links with a `fight` query parameter.

**Tech Stack:** Vanilla JavaScript UMD modules, canvas, CSS, Node assertion tests, existing Chrome/CDP browser harness; no new dependencies.

**Design:** Read [the Astra design](../specs/2026-09-07-najentus-guided-briefing-design.md) first. It is authoritative for the seven scene narratives, exact illustrative timing, source evidence, roster policy and visual acceptance criteria. The original planning checklist is retained below; completed implementation and validation are recorded in the Terra execution record at the end.

## Global constraints

- Planning changes documents only; implementation begins in the later Terra execution requested by the user.
- Preserve Supremus’s nine scenes, names, mechanics, playback, reduced motion, exports and tests.
- No trash preparation, backend changes, positioning algorithm rewrite, framework or dependency additions.
- Use `maps/bt-najentus.png` at 2088×1146 and `maps/najentus-icon.png`; do not generate replacement artwork.
- Treat geometry and HP bars as illustrative. Needle splash is 6 yards; Hurl Spine range is 25 yards; Tidal Burst is 8,500 Frost damage to everyone at one instant.
- One main tank; no Naj’entus Hateful soak, phase reset, fixate or volcano behavior. Preserve all imported names and roles; no invented named-roster fillers.
- Do not commit, deploy or push during planning. During execution preserve the configured Git author and never add attribution trailers. Leave the user’s untracked screenshot untouched.
- The existing working branch is `tactics`; inspect current status at execution and use `using-git-worktrees` if isolation is needed. Do not discard or silently relocate uncommitted work.

## File map and dependency order

| File | Responsibility/change |
|---|---|
| Create `tactics-najentus-data.js` | Metadata, seven scenes, ability information and source URLs |
| Create `tactics-najentus.js` | Pure prepared scenes, cast selection, position/health/inventory/stage snapshots |
| Create `tactics-najentus-render.js` | Draw frame-derived floor and foreground effects |
| Create `tactics-najentus.test.js` | New encounter’s behavioral unit coverage |
| Modify `tactics-data.js` | Register Naj’entus; add explicit Supremus presentation metadata without changing its authored scenes |
| Modify `tactics-layout.js`, `tactics-layout.test.js` | Naj’entus formation and copy; preserve common assignment and Supremus behavior |
| Modify `tactics.js`, `tactics.html`, `tactics.css` | Boss routing, metadata, frame dispatch and rendering, state display, current calls and export integration |
| Modify `tactics-data.test.js` | Registry/shared metadata checks; keep Supremus-specific assertions scoped to Supremus |
| Modify `tactics-browser.test.mjs` | Add Naj’entus, routing, export and viewport regressions to current isolated harness |
| Modify `package.json`, `README.md` | Include new test; document both briefing URLs and existing test prerequisites |
| Create four `maps/tactics/icon-*.jpg` assets | Local verified spell artwork |

Tasks 1–3 establish data and testable behavior. Task 4 wires the canvas without rewriting Supremus. Task 5 completes the user-visible shared presenter. Task 6 validates both bosses and records the handoff. Keep each task reviewable as a diff; commits, if used during execution, should match these deliverables.

### Task 1: Register encounter data and local artwork

**Files:** `tactics-najentus-data.js`, `tactics-data.js`, `tactics-data.test.js`, four `maps/tactics/icon-*.jpg` files.

**Interfaces:** `require('./tactics-najentus-data')` and browser `TacticsNajentusData` are the Naj’entus fight object. `TacticsData.FIGHTS['bt-najentus']` returns the same definition. Each fight gains `slug`, `mapSize`, `mapFilter`, `clockMode`, `positioningSceneId`, `referenceTitle` and `legend` metadata.

- [ ] Add a failing registry/metadata test; run `node tactics-data.test.js` and confirm failure because Naj’entus is absent:

```js
const fs = require('node:fs');
const naj = T.FIGHTS['bt-najentus'];
assert.ok(naj);
assert.deepStrictEqual(naj.mapSize, { width: 2088, height: 1146 });
assert.deepStrictEqual(naj.scenes.map(s => s.id),
  ['overview', 'positioning', 'needle', 'impale', 'shield', 'burst', 'cycle']);
for (const scene of naj.scenes) {
  assert.ok(scene.call && scene.why && scene.mistake && scene.jobs.length);
  assert.ok(scene.caption.length < 200);
  assert.equal(scene.formation, 1);
  assert.ok(!scene.morph && !scene.countdown && !scene.continueFrom);
}
for (const path of [naj.map, naj.portrait, ...naj.abilities.map(a => a.icon)]) {
  assert.ok(fs.existsSync(path), path);
}
```

- [ ] Create the encounter UMD module. Use the design’s map configuration and chapter table. Add these presentation fields:

```js
slug: 'najentus',
clockMode: 'state',
positioningSceneId: 'positioning',
referenceTitle: 'Briefing reminders',
mapFilter: 'brightness(1.20) contrast(1.04) saturate(.75)',
legend: [
  { kind: 'needle', label: 'Needle splash', exportLabel: 'Cyan: Needle splash' },
  { kind: 'spine', label: 'Impaled / collected spine', exportLabel: 'Gold: spine' },
  { kind: 'shield', label: 'Tidal Shield', exportLabel: 'Blue: shield' },
  { kind: 'move', label: 'Example route', exportLabel: 'Pale: example route' }
]
```

Every scene has existing guidance fields, `phase: 1`, `formation: 1`, `view: { fit: 'arena' }`, `actors: []`, `effects: []`, and `animated: true` only for the five animated scenes. The new `sequence` structure is defined in Task 3. Use fresh concise paraphrases, not copied guide paragraphs. Positioning/preparation must mention enough buffed maximum health to survive 8,500 Frost damage, with stamina gear/buffs if needed; “full health” alone is not sufficient for an undersized health pool. Do not derive max HP from the roster or invent a readiness score. Recovery may mention using a healthstone after the burst.

Ability IDs are `needle`, `impale`, `shield`, `hurl`, `burst`. Spell IDs respectively 39835, 39837, 39872, 39948, 39878. Use `stageLabel` (“Normal combat”, “Shield window” or “Shield break”) rather than inventing multiple phases. Include explicit `url` per ability, `tooltip.description`, `tooltip.castTime`, optional `tooltip.range`, and `doThis`. Hurl is “25 yd range”; give it a separate `itemUrl` for item 32408. Impale and shield/burst are primary instructional hazards; do not expose unsupported ability names or exact shield regeneration timing.

- [ ] Fetch the verified existing artwork and save with its actual JPEG extension:

```sh
curl --fail --location https://wow.zamimg.com/images/wow/icons/large/spell_frost_icestorm.jpg --output maps/tactics/icon-spell_frost_icestorm.jpg
curl --fail --location https://wow.zamimg.com/images/wow/icons/large/spell_frost_iceshard.jpg --output maps/tactics/icon-spell_frost_iceshard.jpg
curl --fail --location https://wow.zamimg.com/images/wow/icons/large/spell_nature_crystalball.jpg --output maps/tactics/icon-spell_nature_crystalball.jpg
curl --fail --location https://wow.zamimg.com/images/wow/icons/large/spell_frost_summonwaterelemental.jpg --output maps/tactics/icon-spell_frost_summonwaterelemental.jpg
file maps/tactics/icon-*.jpg
```

Expected: four valid JPEGs. Needle uses icestorm; Impale and Hurl use iceshard; Shield uses crystalball; Burst uses summonwaterelemental. If fetch fails, resolve asset acquisition before claiming completion; do not hotlink remote artwork at runtime.

- [ ] Update the existing `tactics-data.js` UMD factory to receive Naj’entus data explicitly:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tactics-najentus-data.js'));
  } else root.TacticsData = factory(root.TacticsNajentusData);
}(typeof self !== 'undefined' ? self : this, function (NAJENTUS) {
  'use strict';
  // Existing SUPREMUS definition stays here.
  // Return: { FIGHTS: { 'bt-supremus': SUPREMUS, 'bt-najentus': NAJENTUS } }.
}));
```

This snippet defines wrapper changes, not replacement of the existing Supremus data. Give Supremus `slug: 'supremus'`, `mapSize: {width:1600,height:889}`, its current filter, `clockMode: 'phases'`, `positioningSceneId: 'p1-stand'`, its current guild-image reference heading, and the four current legend entries. Preserve authored scenes and all spell data.

- [ ] Run `node tactics-data.test.js`; expect old and new assertions to pass. Inspect source URLs and icon paths directly. Keep existing Supremus-only effect/phase tests scoped to that definition instead of weakening them to accommodate Naj’entus.

### Task 2: Add the single-tank formation and accurate copied positions

**Files:** `tactics-layout.js`, `tactics-layout.test.js`.

**Interfaces:** Preserve `assign(fight, roster)`, `formation(fight, phase, assigned)` and `copyText(fight, phase, assigned)`. The Naj’entus branch always uses its one formation; common assignment remains unchanged.

- [ ] Add failing tests for default spacing, one MT, extra imported tanks and copied advice:

```js
const naj = T.FIGHTS['bt-najentus'];
const a = L.assign(naj, { tanks: ['MT', 'Extra'], healers: ['Heal'],
  melee: ['Melee'], ranged: ['Range'] });
const f = L.formation(naj, 1, a);
assert.equal(a.length, 5);
assert.equal(f.find(p => p.name === 'MT').kind, 'tank');
assert.ok(f.find(p => p.name === 'MT').at.y < naj.bossAt.y);
assert.ok(f.find(p => p.name === 'Extra').at.y > naj.bossAt.y);
const copy = L.copyText(naj, 1, a);
for (const name of ['MT', 'Extra', 'Heal', 'Melee', 'Range']) assert.ok(copy.includes(name));
assert.doesNotMatch(copy, /Hateful|SOAK|fixate|volcano|Misdirect|Phase 2/i);
```

Also assert the default 17 backline players have pairwise distance >6 yards, the default total is 25, all positions are within authored arena bounds, partial and >25-player imports preserve names and IDs, and extra tank positions are distinct. Do not add a universal melee spacing assertion.

- [ ] Run `node tactics-layout.test.js`; confirm Naj’entus failures.
- [ ] Add `if (fight.id === 'bt-najentus')` formation dispatch before the existing phase logic. Put `assigned.filter(p => p.kind === 'melee' || (p.kind === 'tank' && p !== tanks[0]))` on the rear arc; only `tanks[0]` uses the front location. Use the existing `ydY`, `lerp` and return shape. Non-melee/non-tanks remain on their assigned slots.
- [ ] Add the corresponding copy branch. Start “High Warlord Naj’entus — example positions”; retain existing name grouping/no-roster notice. MT line says “hold boss in front”; extra tanks say “no second tank mechanic assigned; use the rear area”; melee “behind boss; use available spacing”; backline uses `spotName`. Finish with “Spread for Needle splash. Free impaled allies. Keep collected spines and use one on the call after the raid is healed.” No copied Supremus phase advice.
- [ ] Run `node tactics-layout.test.js` and `node tactics-data.test.js`; expect all pass. Assess the default positions against the map image before proceeding; if calibration changes, update metadata and geometry expectations together.

### Task 3: Implement pure Naj’entus scene preparation and snapshots

**Files:** create `tactics-najentus.js`, create `tactics-najentus.test.js`, modify `tactics-najentus-data.js`, `package.json`.

**Interfaces:** Browser `TacticsNajentus`; CommonJS requires `./tactics-layout.js`. Exports `prepareScene(fight, sourceScene, assigned)` and `simulate(fight, preparedScene, timeMs)`. The exact returned frame is in the design. `preparedScene` preserves guidance fields and adds `raid`, `cast`, `baseById`, `bossActor`, `resolved`, and `missingRoles`. The prepared scene is read-only input to simulation.

- [ ] Author `sequence` data using this concrete schema. Empty arrays/objects are valid; omitted shield means none. Times are local scene milliseconds:

```js
sequence: {
  needles: [{ at: 8000 }, { at: 32000 }],
  impales: [
    { id: 'first', at: 20000, approachAt: 21000, extractAt: 24000, homeAt: 28000 },
    { id: 'second', at: 40000, approachAt: 41000, extractAt: 44000, homeAt: 48000 }
  ],
  initialSpines: 0,
  shield: { at: 60000, readyAt: 65000, throwAt: 67000,
    hitAt: 67700, recoverAt: 75000 }
}
```

Each impale resolves its own `victim`/`rescuer` pair once in `prepareScene`; the first rescuer is the throw holder, the second is the reserve. With `initialSpines: 1`, resolve an eligible distinct victim/helper pair by the same rules, even without an animated impale; give its helper the explicitly pre-collected item for the standalone shield/burst scenes. If no valid pair exists, initial inventory stays empty and the shield cannot be broken. Missing `throwAt`/`hitAt` on the shield-only chapter means the shield remains. Static scenes have no sequence events. Use the exact other chapter times from the design. `needle` alone sets `clusteredNeedle: true`: its first target and one distinct neighbor start 4 yards apart to show splash; neighbor returns to home from 3.5–6s. This is an authored teaching example, not a claimed safe formation.

- [ ] Add real behavior tests, run `node tactics-najentus.test.js`, and confirm missing module/function failures. Core reference test:

```js
const assert = require('node:assert/strict');
const D = require('./tactics-data.js');
const L = require('./tactics-layout.js');
const N = require('./tactics-najentus.js');
const fight = D.FIGHTS['bt-najentus'];
const assigned = L.assign(fight, null);
const scene = N.prepareScene(fight, fight.scenes.find(s => s.id === 'cycle'), assigned);
const initial = JSON.stringify({ scene, assigned, fight });
const at = t => N.simulate(fight, scene, t);
const holder = scene.resolved.impales[0].rescuer;
const victim = scene.resolved.impales[0].victim;
assert.ok(at(23999).impaled.includes(victim));
assert.ok(!at(24000).impaled.includes(victim));
assert.equal(at(24000).holders[holder], 1);
assert.equal(at(60000).shield, true);
assert.equal(at(64999).ready, false);
assert.equal(at(65000).ready, true);
assert.equal(at(66999).holders[holder], 1);
assert.equal(at(67000).holders[holder] || 0, 0);
assert.equal(at(67699).shield, true);
assert.equal(at(67700).shield, false);
assert.equal(at(67700).burst.damage, 8500);
const expectedExtractionFrame = at(24000);
at(76000); at(0); at(67700);
assert.deepEqual(at(24000), expectedExtractionFrame);
assert.equal(JSON.stringify({ scene, assigned, fight }), initial);
```

Additional required tests: victim cannot move while pinned; item belongs to helper rather than victim; helper is nearest eligible non-MT with deterministic tie breaking; spare holder retains item after throw; all raid HP drops occur at `hitAt` together; selected holder is ≤25 yards from boss at `throwAt`; throw does not exist before ready or without item; isolated chapters work first; one-player/MT-only/two-player/missing-tank/three-tank/oversized rosters are finite and safe; direct seek matches increasing and decreasing seek sequences at event boundaries; changing speed affects playback only, not frame calculations; no mutation of definitions/roster.

- [ ] Implement preparation: derive base positions with `L.formation(fight,1,assigned)`, label real names only in `positioning`, label the first tank `MT` and subsequent tanks `TANK`. Resolve valid pairs from existing IDs; prefer unused ranged for victims, choose nearest unused eligible helper by `L.dist`, and never invent a fallback actor. Keep casts distinct across the full-cycle two pairs so the spare holder is real. Suppress an unavailable second pair independently, and replace all spare-item calls with “Spread again. Prepare for the next shield.” if no spare exists. Record concise missing-role notes.
- [ ] Implement analytic frame construction. Clone base positions each call. Interpolate helper approach to 1.5 yards from victim, keep victim fixed until extraction, and interpolate helper return. Move a holder outside 25 yards to a point 23 yards from boss before throw. Exact event boundaries are inclusive (`t >= eventTime`); zero-length intervals return the destination. The reusable math is:

```js
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const progress = (t, start, end) => end <= start ? Number(t >= end)
  : clamp((t - start) / (end - start), 0, 1);
const between = (a, b, k) => ({ x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k });
// Inventory is reconstructed, never decremented in stored state:
const holders = {};
for (const [id, count] of Object.entries(scene.resolved.initialHolders)) holders[id] = count;
for (const e of scene.resolved.impales) {
  if (t >= e.extractAt) holders[e.rescuer] = (holders[e.rescuer] || 0) + 1;
}
```

Only consume at throw if a valid ready shield, resolved holder and collected inventory exist. Pin state derives from `[at,extractAt)`. Shield derives from `[at,hitAt)` only when a valid throw exists, otherwise remains active after `at`. Derive projectile solely during `[throwAt,hitAt)`. Needles highlight up to three existing example targets and all actual neighbors ≤6 yards at hit time; no avoidance force is added. Compute health from authored example fractions, raising raid bars during shield readiness, then setting every player’s post-burst fraction at the same `hitAt` before recovery. Never accumulate damage per render call.

Stage and current call are derived here too: `normal`, `shield`, `ready`, `throw`, `burst`, `recover`. The burst presentation lasts 1,000ms after hit; recovery then lasts until `recoverAt`, at which point stage returns to `normal`. For shield hold use “Shield up. Top the raid. Hold your spine.”; ready is “Raid ready. Wait for the call.”; throw is “One holder throws. Save the spare.”; impact is “Raidwide hit. Heal everyone.”; recovery ends “Spread again. Keep the spare spine.” Missing a usable holder leaves shield intact with “No spine holder in this roster. Keep healing.”

- [ ] Append `node tactics-najentus.test.js` to the existing npm test chain beside other tactics tests. Run `node tactics-najentus.test.js`, `node tactics-layout.test.js` and `node tactics-data.test.js`; expect all pass.

### Task 4: Draw Naj’entus and wire the frame into the existing canvas

**Files:** create `tactics-najentus-render.js`; modify `tactics.js`, `tactics.html`, `tactics.css`.

**Interfaces:** `TacticsNajentusRender.draw(layer, api, scene, frame)` with `layer` equal to `floor` or `foreground`; `api = { ctx, px, yd, width: W, height: H }`. Draw code consumes existing frame positions, creates no simulation state and balances every `ctx.save()`/`restore()`.

- [ ] Wire script order: `assignments-engine.js`, `tactics-najentus-data.js`, `tactics-data.js`, `tactics-layout.js`, `tactics-playback.js`, `tactics-najentus.js`, `tactics-najentus-render.js`, `tactics.js`.
- [ ] At existing scene preparation (~line 1004), keep the Supremus callback as `prepareSupremusScene`; map Naj’entus through the pure module. At the start of existing `simulate(sc,t)` add only this dispatch:

```js
if (FIGHT.id === 'bt-najentus') return window.TacticsNajentus.simulate(FIGHT, sc, t);
```

Keep Supremus’s `continueFrom` preparation loop unchanged; Naj’entus scenes have no such references. Preserve `window.__tactics.simulate` and add `fight: FIGHT` to the test seam.

- [ ] In `paint`, use Naj’entus `frame.focus` and `frame.roles` directly; do not send its scene through `focusOf`/`homeAt` or infer animation from old hazard kinds. Draw new `floor`, then existing boss/player tokens, then new `foreground`. In `drawPlayer`, use frame HP for Naj’entus and current `valueAt(sc.hp[id],t)` for Supremus. The explicit branch is:

```js
const hp = FIGHT.id === 'bt-najentus'
  ? (sc._sim.hp[p.id] ?? null)
  : valueAt(sc.hp && sc.hp[p.id], t);
```

- [ ] Implement canvas visuals from frame fields: cyan target-centered Needle circles, gold pin on victim, gold collected-spine badge on helper, blue boss shield, pale helper route, short thrown spine trajectory, and a room-wide burst flash. Add short text labels (“Click spine”, “Spine ready”, “Immune”, “8,500 Frost · raidwide”). A spine badge moves with its actual holder and the thrown item uses the resolved throw position. Burst damage and health changes must be simultaneous, with no running-away route.
- [ ] Replace hard-coded `MW`/`MH` with selected `mapSize`; use per-fight filter in `litMap`. Preserve Supremus values byte-for-byte through metadata. Use arena framing first for Naj’entus; only tighten a scene if all participant paths and badges remain visible throughout. Do not change Supremus’s existing camera rules.
- [ ] Run `node --check tactics.js`, `node --check tactics-najentus-render.js`, the new unit test and `npm run test:tactics-browser`. Existing Supremus checks must still pass before continuing. The Naj’entus route becomes user-accessible in Task 5.

### Task 5: Finish boss navigation, guidance, state display and exports

**Files:** `tactics.js`, `tactics.html`, `tactics.css`, `README.md`.

**Interfaces:** URL parameter `fight`; `FIGHT.clockMode`; metadata defined in Task 1; `frame.call`, `frame.stage`, `frame.timeMs` from Task 3. `__tactics` still exposes the same controls and selected `fight`.

- [ ] Resolve the fight at startup; never interpolate a query value into HTML:

```js
const requestedFight = new URL(location.href).searchParams.get('fight');
const fights = window.TacticsData.FIGHTS;
const FIGHT = Object.hasOwn(fights, requestedFight)
  ? fights[requestedFight] : fights['bt-supremus'];
```

Create a labeled boss navigation region with real anchors for Naj’entus and Supremus. Derive each href with `new URL(location.href)`, `searchParams.set('fight', id)`, and empty `hash`; set current link `aria-current="page"`. No click-intercept SPA or second requestAnimationFrame loop. Preserve the existing `document.title = FIGHT.name + ' — fight briefing'` assignment so the selected boss also appears in the browser tab.

- [ ] Build legend text/marks from `FIGHT.legend`; use metadata for reference heading and unnamed roster counts. Ability cards use `stageLabel` or old phase fallback; spell links use `a.url || 'https://www.wowhead.com/tbc/spell=' + a.spell`, and when `a.itemUrl` exists append a body anchor using that exact URL, text “Naj’entus Spine item”, `target="_blank"` and `rel="noopener noreferrer"`. All imported roster names continue through safe text rendering.
- [ ] In `show`, make autoplay use `sc.animated || sc.effects.length` while retaining reduced-motion pause. Do not force all animated chapters to start at a later frame for reduced motion. A static positioning picture plus contextual text is the readable initial state.
- [ ] Preserve the existing clock DOM for Supremus and add a separate hidden `encounterState` node for Naj’entus. Branch before the Supremus clock work in `tickClock`:

```js
if (FIGHT.clockMode === 'state') {
  el('clock').hidden = true;
  el('encounterState').hidden = false;
  const f = scenes[idx]._sim;
  el('encounterState').textContent = stateLabels[f.stage] +
    ' · Example ' + (f.timeMs / 1000).toFixed(1) + 's';
  return;
}
```

Define `stateLabels = { normal: "Normal combat", shield: "Shield: heal up", ready: "Ready: await call", throw: "Spine in flight", burst: "Raidwide burst", recover: "Recover: heal everyone" }`. Style `[hidden]` so existing clock flex rules cannot override hiding. Do not replace the old clock children and then dereference missing spans.

- [ ] Add `syncCurrentGuidance(sc)` called after `paint` from `render`. Compute `sc.currentCall = sc._sim.call || sc.call`; update `sceneCall`/`mapCall` only if text changed to avoid live-region repetition every frame. Draw the same current call on the map. Preserve scene title, jobs and mistake throughout playback. Explain missing roster examples through `rosterNote` without substituting a fake player.
- [ ] At the beginning of both copy handlers call `render(performance.now())`, then read the current frame and use `sc.currentCall || sc.call`. Preserve Supremus’s current transition-phase export logic; Naj’entus uses `L.copyText(FIGHT,1,assigned)` plus stage text. Text download is `${FIGHT.slug}-briefing-${sc.id}.txt`; image is `${FIGHT.slug}-${sc.id}.png`. PNG footer comes from `FIGHT.legend.map(x=>x.exportLabel).join(' / ')` with the existing illustrative-scale caveat. Verify clipboard fallback downloads and revoke generated object URLs as before.
- [ ] Add README entries for `tactics.html?fight=bt-najentus` and `tactics.html?fight=bt-supremus`, the seven Naj’entus decisions and retained Node 22+/Chrome browser prerequisites. Do not change global navigation on every other page: the boss links make both briefings discoverable from the existing Tactics tab.
- [ ] Open both URLs locally and check current calls during shield, readiness, throw, hit and recovery; copy text/image at each relevant stage. Run `npm test` and the unchanged existing browser assertions; expect all pass before extending coverage.

### Task 6: Validate both encounters and review the actual pictures

**Files:** `tactics-browser.test.mjs`, any feature files needing corrections; update this plan’s execution record only after running checks.

**Interfaces:** Retain existing static allowlisted test server and isolated Chrome profile; reuse `send`, `evaluate`, `waitForPresenter`, clipboard stubs and imported-roster fixtures. Browser harness requires Node 22+ and Chrome (`CHROME_BIN` supported); application runtime floor remains Node 18.

- [ ] Keep all 22 existing Supremus checks. Extend the harness with navigation to `?fight=bt-najentus`; wait for `__tactics.fight.id === 'bt-najentus'` as well as presenter readiness so an old page cannot satisfy the check. Assert seven chapter links, correct title/map, successful local assets, no Supremus legend/clock/copy leftovers and no runtime exceptions.
- [ ] Add interaction assertions: selecting both boss anchors, browser back, no-query and invalid-query fallback, including `constructor` and `__proto__`; keyboard chapter/play/replay controls; paused time and state display stay frozen; seeking to 60/65/67/67.7s in cycle changes state/call/item/shield consistently; reaching 76s holds; reduced motion opens paused. Sample exact boundaries by calling `playback.seek` rather than waiting wall-clock minutes.
- [ ] For every Naj’entus scene, test snapshots at 0, each event boundary ±1ms and duration; assert finite coordinates and named actors/boss within the camera. Revisit the same time in different orders and compare serialized frames. Sample active holder trajectory to show throw position ≤25 yards. Confirm tank stays at home, impaled victim stays fixed, and all raid bars change at the same burst instant.
- [ ] Exercise empty example roster, flagged three-tank partial roster, two-player roster, MT-only roster and >25 players. Verify all actual names preserved, only one MT, no SOAK, no fake helper, no item without extraction/declared initial inventory, no burst when the needed holder is absent, and useful exports even if the example is incomplete.
- [ ] Extend clipboard tests to check the Naj’entus current call, raid stage and real names. Force text/image clipboard rejection and intercept `HTMLAnchorElement.prototype.click` to record download names before restoring it; expect the `najentus-` prefix and valid PNG blob. Keep Supremus export regression checks.
- [ ] Use `Emulation.setDeviceMetricsOverride` for 1600×1000, 1280×800 and 390×844. Check `scrollWidth <= innerWidth`, visible transport/boss links, readable guidance by scrolling, and framed actors. Add an optional `TACTICS_SCREENSHOT_DIR` output setting to the harness, writing `Page.captureScreenshot` PNGs for positioning, extraction, shield hold and burst at the explicit viewport/time. Inspect the screenshots with `view_image`; geometry checks alone do not prove legibility. Keep screenshots in a temporary review directory, not tracked source.
- [ ] Final commands, once fixes stop changing behavior:

```sh
node --check tactics-data.js
node --check tactics-najentus-data.js
node --check tactics-najentus.js
node --check tactics-najentus-render.js
node --check tactics-layout.js
node --check tactics.js
npm test
npm run test:tactics-browser
git diff --check
git status --short
```

Expected: every command exits zero, both encounters’ browser checks pass, screenshots are reviewed, and changes are limited to the planned feature plus user-approved execution housekeeping. Address failing checks; do not relabel a blocked browser run as successful verification.

- [ ] Report the Naj’entus URL, completed chapters, preservation of Supremus, exact tests run and any material limitation. Mention no deployment unless one was actually authorized and performed. An Astra review of the shared presenter diff is recommended before integration, but ordinary fixes and verification do not require a new permission round.

## Planning verification and execution record

- Astra inspected current data, layout, player, HTML, browser harness, existing unit tests and map artwork. Root also checked the proposed layout with the existing assignment helper: 25 tokens, 17 backline players, minimum backline spacing 6.501 yards; these are planning calculations, not completed feature checks.
- Root verified the baseline at `c10e131`: `npm test` and all 22 current Supremus browser checks pass.
- Encounter sources and spell/item metadata were verified during this planning pass; evidence links are in the design.
- At the planning handoff, implementation and its checks had not run. The original checkboxes remain as a planning record; see the execution evidence below for completed work.

### Terra execution record — 2026-09-07

- Implemented the seven Naj’entus chapters, local JPEG spell artwork, single-main-tank formation, pure scene/frame model, canvas overlays, data-driven boss routing, state display, guidance, exports and documentation. Supremus remains registered with its original authored scenes and phase clock.
- Added data/layout/Naj’entus unit coverage and extended the isolated Chrome harness with 13 Naj’entus/shared-presenter checks while retaining the original 22 Supremus checks. It covers state seeking, local art, real boss navigation/history fallback, clipboard success and download fallback, revisit guidance, default/partial/MT-only/oversized rosters, reduced motion and mobile/laptop overflow.
- Fresh execution evidence: `node tactics-najentus.test.js` (9 passed), `node tactics-layout.test.js` (21 passed), `node tactics-data.test.js` (22 passed), `npm test` (exit 0), and `npm run test:tactics-browser` (37 PASS lines, exit 0). `git diff --check` exits 0.
- Reviewed screenshots written outside the repository at `/tmp/wowstuff-najentus-screens-final3/`: default 25-player overview, named partial positioning, extraction, shield at desktop and 1280×800, burst at desktop and 390×844. The images show the calibrated in-floor layout, distinct click pin/holder badge, full-raid shield/burst emphasis, readable names and no mobile horizontal overflow.
