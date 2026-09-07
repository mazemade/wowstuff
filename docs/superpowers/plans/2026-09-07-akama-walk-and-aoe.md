# Shade of Akama Walk and AoE Implementation Plan

> **For agentic workers:** Use the user-selected Astra planning → Terra implementation → Sol review workflow with `subagent-driven-development`. Execute the already-authorized correction without another approval pause. Terra owns encounter data, simulation, overlay and unit tests; root owns shared presenter integration, browser tests and delivery; Sol reviews the combined result. This plan does not authorize a commit or release by the planning agent.

**Goal:** Show the Shade's slow RP walk and tanks bringing controlled adds to it for cleanup, then teach the user's alternative of pulling adds onto Channelers and damaging both together.

**Architecture:** Extend the existing independent encounter chapters and pure `prepareScene` / `simulate` adapter. Add a dedicated walk chapter and an independent, clearly labeled alternative full sequence after the standard cycle. Share declarative timing and current frame state across animation, labels, roster jobs and exports; retain the existing presenter and playback system.

**Tech Stack:** Existing browser JavaScript, canvas overlays, Node assertions and Chrome browser regression harness. No dependencies or application rewrite.

## Global constraints

- Preserve imported players, order and class-aware doorway/support duties. Never fabricate a tank, hunter, healer or damage dealer to complete an animation.
- Keep the guild's hallway strategy as the default. Label the new full chapter “Alternative · AoE at Channelers”; the user supplied this alternative, so do not attribute it to the guild spreadsheet.
- Channelers and Sorcerers have no player-tank assignment. Akama tanks the Shade on engagement; player tanks retain surviving adds.
- The guild strategy image, inspected at `/tmp/akama-sheet-image32.png` from `/tmp/bt-strategy.xlsx`, explicitly says the Shade RP walks to Akama after Channelers die and tanks bring adds close to the Shade for cleanup during that time. It calls Lust when the Shade is active. Do not invent a precise live walk duration or actual damage prediction.
- The new durations below are teaching animation milliseconds. Keep “Illustrative sequence” visible and retain the existing not-a-live-timer qualification.
- The alternate damage team switches focus to Shade after channels are gone and only the illustrated Defender remains. Actual displayed boss health begins falling only when Akama engages; Lust waits for that engagement.
- Preserve other bosses, assets, reduced motion, seeking, replay, final frame hold and text/PNG exports. Do not introduce a global strategy selector.
- Never add co-author, generated-by or tool-attribution commit trailers; preserve configured Git author.

## Files and ownership

| File | Responsibility | Owner |
| --- | --- | --- |
| `tactics-akama-data.js` | Chapter order, authored timings, explanation and state labels | Terra |
| `tactics-akama.js` | Deterministic movement, add cleanup, current target/strategy and roster exports | Terra |
| `tactics-akama-render.js` | Readable walk/collection/AoE cues from current frame | Terra |
| `tactics-akama.test.js` | Causal timing, movement, targeting, seek and partial-roster assertions | Terra |
| `tactics.js` | Current-frame presenter metadata and exports where existing integration needs adjustment | Root |
| `tactics-browser.test.mjs` | Scene-ID lookup, browser behavior and desktop/mobile evidence | Root |
| `README.md` | Existing feature description updated to mention ten chapters and the alternative, if relevant | Root |

## Stable scene and timing interface

The chapter order is exactly:

```js
['overview', 'positioning', 'channelers', 'doorways', 'sorcerers',
 'fire', 'walk', 'burn', 'cycle', 'aoe']
```

Keep `burn` as the independent already-engaged scene with its current timing. Add or update the following scene values, retaining the cycle's original wave, interrupt, fire and Sorcerer events:

```js
// walk: independently shows the final channel breaking, then a 12s teaching walk.
duration: 16000
sequence: {
  initialChannels: 1, kills: [2000], wavesAt: 0,
  approachAt: 2000, gatherAt: 5000, cleanupAt: 7000,
  engageAt: 14000, winAt: 26000
}

// cycle: the existing full default example with a meaningful walk window.
duration: 42000
sequence: {
  kills: [4000, 6000, 8000, 10000, 12000, 14000],
  wavesAt: 3000, traps: true, interruptAt: 7500, fireAt: 9000,
  sorcerer: { spawnAt: 7000, channelAt: 10000, dieAt: 16000 },
  approachAt: 16000, gatherAt: 19000, cleanupAt: 21000,
  engageAt: 28000, winAt: 40000
}

// aoe: independent alternate full example, with simultaneous target groups.
duration: 38500
sequence: {
  strategy: 'channeler-aoe', wavesAt: 1000,
  pullToChannelsAt: 3000, stackAt: 6000, aoeAt: 6500,
  cleanupAt: 8500,
  kills: [7500, 8500, 9500, 10500, 11500, 12500],
  approachAt: 12500, engageAt: 24500, winAt: 36500
}
```

`gatherAt` means tanks and controlled adds have reached positions near the moving Shade; it is not the first cleanup kill. `stackAt` means alternate tanks have arrived beside the Channelers before AoE begins. First regular wave kills occur at `cleanupAt`; the existing three kind groups can disappear at `cleanupAt + j * 750`. In the default walk/cycle, the Defender dies at `cleanupAt + 2250`, clearing the entire controlled pack before engagement. The alternate retains its Defender until completion. All listed timestamps are local to their scene.

Preserve the returned frame's existing fields and add this small strategy/target interface:

```js
frame.strategy = seq.strategy || 'standard';
// Exactly one of: 'channels', 'adds', 'channels-and-adds', 'shade', null.
frame.damageTarget = 'channels';
```

Use stages `gather` and `aoe` for the alternative's collection and simultaneous damage, and add matching entries to `fight.stateLabels`. Keep `approach`, `burn`, `complete` for the release, engagement and victory. Suggested exact new labels and revised walk label:

```js
gather: 'Phase 1 · Bring adds to Channelers',
aoe: 'Phase 1 · AoE Channelers and adds',
approach: 'Transition · Shade RP walk'
```

Before alternate release, `damageTarget` becomes `channels-and-adds` at `aoeAt`. During the standard walk it is `adds`; during the alternate walk it is `shade`. During either burn it is `shade`; on completion or without a damage role it is `null`. This is a focus/instruction field, not a claim that damage occurs before engagement. Use `frame.phase` for current phase rather than the scene's static opening phase.

## Task 1: Make the walk and alternate movement causally correct

**Files:** `tactics-akama-data.js`, `tactics-akama.js`, `tactics-akama.test.js`.

**Consumes:** Existing `L.assign(fight, roster)`, `prepareScene(fight, source, assigned)`, and `simulate(fight, preparedScene, timeMs)`.

**Produces:** The ten-scene ordering and timing/frame contract above; existing consumers continue to receive the same actor, channel, health, role and position fields.

- [x] Add unit cases using scene IDs and `sequence` timestamps, then run `node tactics-akama.test.js` to confirm the current implementation fails for missing walk/AoE scenes and early cleanup.

```js
test('default cleanup waits until tanks reach the moving Shade', () => {
  for (const id of ['walk', 'cycle']) {
    const sc = prepare(id), seq = sc.sequence;
    const at = t => A.simulate(fight, sc, t);
    const gathered = at(seq.gatherAt), cleanup = at(seq.cleanupAt - 1);
    assert.equal(gathered.stage, 'approach');
    assert.equal(gathered.channels.length, 0);
    assert.equal(gathered.damageTarget, 'adds');
    assert.equal(gathered.npcs.length, 7);
    assert.equal(cleanup.npcs.length, 7);
    assert.ok(at(seq.cleanupAt + 1600).npcs.every(n => n.kind === 'defender'));
    assert.ok(at(seq.approachAt + 1000).boss.y < gathered.boss.y);
    assert.ok(gathered.boss.y < at(seq.engageAt - 1).boss.y);
    for (const tank of sc.tanks) {
      const p = gathered.pos[tank];
      assert.ok(L.dist(fight, p, gathered.boss) <= 10);
    }
    gathered.npcs.filter(n => n.kind !== 'defender').forEach(n =>
      assert.ok(L.dist(fight, n.at, gathered.boss) <= 16));
    assert.equal(at(seq.engageAt - 1).bossTarget, null);
    assert.equal(at(seq.engageAt).bossTarget, 'akama');
  }
});

test('alternate packs meet living Channelers before simultaneous damage', () => {
  const sc = prepare('aoe'), seq = sc.sequence;
  const at = t => A.simulate(fight, sc, t);
  const stacked = at(seq.stackAt), aoe = at(seq.aoeAt);
  assert.equal(stacked.channels.length, 6);
  assert.equal(aoe.stage, 'aoe');
  assert.equal(aoe.damageTarget, 'channels-and-adds');
  assert.ok(aoe.npcs.some(n => n.kind === 'channeler'));
  assert.ok(aoe.npcs.some(n => n.kind === 'spiritbinder' && n.targetId));
  sc.tanks.forEach(id => assert.ok(stacked.pos[id].y < .27));
  const released = at(seq.approachAt);
  assert.equal(released.channels.length, 0);
  assert.equal(released.damageTarget, 'shade');
  assert.equal(released.bossHp, 1);
  assert.equal(released.bossTarget, null);
  assert.ok(released.npcs.length > 0);
  assert.ok(released.npcs.every(n => n.kind === 'defender' && n.targetId));
  assert.equal(at(seq.engageAt).bossTarget, 'akama');
});
```

- [x] Add the scene metadata and frame fields above, keeping chapter guidance specific: the walk teaches RP movement, gathering and cleanup; AoE teaches tank pickup, movement up to Channelers, concurrent AoE, interrupts, then switching focus to Shade. The AoE mistake warns against leaving a Spiritbinder free to heal the Channelers or sending player tanks onto Shade.
- [x] Replace fixed end-of-room tank destinations during the walk with boss-relative destinations evaluated at the current timestamp. For standard scenes interpolate from starting doorway positions until `gatherAt`, then track the moving Shade. For the default roster, use tank distances of at most 10 illustrative yards and regular-add distances of at most 16 illustrative yards from the Shade after gathering. These are display acceptance tolerances, not claims about required in-game ability ranges. Spread real tanks/controlled adds sufficiently for their markers to remain legible.
- [x] Make wave NPCs follow their real tank's current position. Keep all six regular adds visible until after rendezvous; remove the previous hard-coded `approachAt + 2500` cleanup schedule. Demonstrate declining add health or an explicit damage cue before removal so cleanup is visible.
- [x] For AoE, interpolate doorway tanks toward Channeler-adjacent positions from `pullToChannelsAt` to `stackAt`, before any channel dies. Have incoming adds follow those tanks and remain near live Channelers through the beginning of `aoeAt`. After release, interpolate smoothly into boss-relative survivor control without jumping back to the doors.
- [x] Preserve the binding gate: movement and burn cannot start while any active channel remains. Keep boss/ally health finite, including the walk scene ending after engagement but before its authored `winAt`.
- [x] Run `node tactics-akama.test.js`; all old and new assertions pass. Do not update old expectations merely to match new coordinates if that discards the tank-rendezvous requirement.

## Task 2: Keep visuals, jobs and incomplete rosters consistent

**Files:** `tactics-akama.js`, `tactics-akama-render.js`, `tactics-akama.test.js`.

**Consumes:** `frame.strategy`, `frame.damageTarget`, `frame.stage`, current positions/NPC ownership, and the timing interface from Task 1.

**Produces:** Current-state instructions and clear overlay cues, including independent direct seeks with partial rosters.

- [x] In the overlay, label the released movement “Shade · RP walk to Akama” and retain a directional route toward Akama. Show “Bring adds to Shade” during the standard walk and a concise, unmistakable AoE cue encompassing Channelers plus tanked adds in the alternate AoE stage. Render these from the frame, not canvas history. Keep artwork visible beneath any translucent cue.
- [x] Make `copyText` and current calls use strategy/stage/target. Standard walk tank jobs say to bring controlled adds to the moving Shade, not remain at the doors. Alternative gathering jobs say to bring adds up to Channelers; alternate AoE damage jobs name both target groups. After alternate release say “Channels down. Switch to Shade; burn when active. Tanks hold survivors.” On engagement call Lust and identify Akama as the Shade's tank.
- [x] Add export assertions at `walk.sequence.gatherAt`, `aoe.sequence.stackAt`, `aoe.sequence.aoeAt`, `aoe.sequence.approachAt` and `aoe.sequence.engageAt + 1000` using a named roster. Assert names remain present and each stage's tank/damage job matches the call; complete exports contain no stale active job.
- [x] For both new independent scenes and the standard cycle, run this roster/time matrix and assert finite positions/health, preserved names and deterministic direct seeks:

```js
const rosters = [
  { tanks: ['Solo tank'] },
  { healers: ['Solo healer'] },
  { ranged: ['Solo damage'] },
  { tanks: ['Tank'], healers: ['Healer'], ranged: ['Damage'] },
  { tanks: ['Left', 'Right'], healers: ['Healer'], melee: ['Damage'] },
  { tanks: ['L', 'R', 'S', 'Extra'], ranged: Array.from({length:29}, (_, i) => 'R' + i) }
];
const ids = ['walk', 'cycle', 'aoe'];
// For each (id, roster), prepare independently and sample 0, every defined
// sequence timestamp, timestamp - 1, timestamp + 1 and scene.duration.
// Save a middle frame, seek end then start, and deepEqual a direct middle seek.
```

- [x] Every NPC target is either a real loaded tank ID or `null`. With no damage roles, channels do not die, health does not decline and the encounter does not reach burn/completion. Missing tanks cannot cause invented ownership or claimed fully controlled pickup; retain missing-role notes. Classless/named rosters must not gain fabricated Frost Traps. Additional tanks stay in bounds.
- [x] Run `node tactics-akama.test.js` and `git diff --check`; resolve any failures before handing source changes back to root.

## Task 3: Integrate and verify the reviewable result

**Files:** `tactics.js`, `tactics-browser.test.mjs`, `README.md` where relevant. Root owns this task.

**Consumes:** All ten scenes and deterministic frame contract above.

**Produces:** Consistent presenter metadata, interactive/export evidence and regression verification ready for Sol review.

- [x] Replace Akama test references to numeric scene indexes with `scenes.find(s => s.id === id)` or `findIndex`; derive sampling times from `sequence`. Expect ten chapters and ensure the tenth is accessible through normal chapter navigation and next/previous controls.
- [x] Check the current frame drives chapter state label, encounter state, map call, side-panel call, current roster jobs and text/PNG exports. Correct any presenter fallback that incorrectly advertises a static scene opening phase after a seek. Scope changes to the existing state-mode integration.
- [x] In the browser, directly seek `walk` and `cycle` just before release, midway through gathering, at `gatherAt`, after `cleanupAt`, and at engagement. Verify a real interval of moving Shade plus nearby tank-owned adds exists before cleanup. Seek `aoe` at `stackAt`, `aoeAt`, release, engagement and completion; verify pack/channeler co-location and the change of damage instruction.
- [x] Capture and inspect both new chapters at desktop and 390px phone width, including walk rendezvous and alternate AoE. Check marker/label separation, all actors in frame, no horizontal overflow, readable title and alternative label. Sample all chapters for finite on-canvas actor positions.
- [x] Verify paused exports reproduce the current stage, alternate chapter filename, named roster and image. Verify reverse seeks, replay, final-frame hold, reduced motion and the independent partial roster cases; retain existing other-boss regressions.
- [x] Run `npm test`, `npm run test:tactics-browser`, and `git diff --check`. All must pass. Re-run only checks affected by any subsequent fix.
- [x] Request Sol review against the tactical/timing contracts above. Resolve material findings and verify the affected paths. Report actual validation evidence and remaining limitations; do not label an unverified release as published.

## Acceptance boundary

A viewer can distinguish the default hallway → channels gone → slow walk with tanks delivering adds → cleanup → Akama engagement/Lust sequence from the independent alternate hallway pickup → tanks bring packs to living Channelers → AoE both → channels gone/few survivors → switch to Shade → Akama engagement/Lust sequence. Both can be opened, paused, sought and exported at any point without stale state or invented roster roles. Timings remain visibly illustrative.


## Implementation and verification notes

- Astra planned, Terra implemented, and Sol reviewed the combined change. The guild spreadsheet strategy image was inspected for the RP walk and tank-delivered cleanup; the alternative follows the user's requested tactic.
- Both chapters retain the same presenter, playback controls, named roster exports and illustrative timing. Repeated tank labels during the stack and walk are omitted so mobile markers remain readable; shared calls and role exports carry those instructions.
- Focused simulator checks cover rendezvous before cleanup, continuous tank movement at release, alternate AoE timing, stage-specific exports and incomplete rosters. Browser coverage uses scene IDs, tests all ten chapters and checks the new state transitions and exports.
- Desktop and 390px screenshots were inspected in `/tmp/akama-walk-final-screens`. The full suite passed before integration; the browser harness passed all 51 checks. Final integration verification is recorded below.

- Final verification after rebasing onto `origin/main` (`9123d7c`): `npm test` passed; `npm run test:tactics-browser` passed all 51 checks, including the final no-DPS stage assertion; `git diff origin/main --check` passed.
- Sol's focused re-review cleared all findings. No-DPS frames retain the gather state, full health and channels, with no damage target or AoE effect. The shared transition heading identifies the RP walk while the boss marker remains compact.
