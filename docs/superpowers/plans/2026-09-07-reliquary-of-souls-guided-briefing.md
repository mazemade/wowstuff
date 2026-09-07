# Reliquary of Souls Implementation Plan

> **For agentic workers:** Use executing-plans for the coupled encounter implementation. The user selected Astra planning → Terra implementation → Sol review and approved the design. Continue through verification and review fixes without another approval. Do not commit, push or deploy.

**Goal:** Add the approved eleven-chapter Reliquary briefing after Akama, preserving the three existing bosses.

**Architecture:** Follow the Akama/Naj’entus encounter adapters: authored UMD data, pure deterministic simulation, separate canvas overlays, minimal presenter registration. The controller supplies authentic assets and independent browser acceptance while Terra implements the coupled encounter modules and integration.

**Tech Stack:** Existing vanilla JavaScript, Canvas, Node assertions and Chrome/CDP harness. No dependencies.

## Global constraints

- The approved [design](../specs/2026-09-07-reliquary-of-souls-guided-briefing-design.md) is authoritative for tactics, roster policy, visuals and scope.
- Work in the current `tactics` checkout. Preserve unrelated work and the untracked screenshot. No commits or release actions.
- Keep default routing Naj’entus; boss order Naj’entus, Supremus, Akama, Reliquary. No Teron.
- Source the existing guild sheet and image. Do not consult or reuse the abandoned Reliquary attempt.
- Every frame, call, current roster job and export must agree at a direct seek. Health, mana and timelines are illustrations.

## Task 1: Authentic room and artwork (controller)

**Files:** `maps/tactics/reliquary-map.jpg`, `maps/tactics/boss-reliquary.png`, any additional authentic essence/spell assets in that directory.

- [x] Download the unannotated Raidplan Reliquary room and compare visually to `/tmp/reliquary-sheet-image24.png`.
- [x] Download authentic boss art and appropriate spell icons; record provenance in encounter data. Never generate replacement assets or use the annotated sheet as the animation background.
- [x] Verify image dimensions and local decodability; tell Terra the available paths and sizes.

## Task 2: Encounter and presenter integration (Terra)

**Create:** `tactics-reliquary-data.js`, `tactics-reliquary.js`, `tactics-reliquary-render.js`, `tactics-reliquary.test.js`.
**Modify:** `tactics-data.js`, `tactics-data.test.js`, `tactics.js`, `tactics.html`, `tactics.css` if necessary, `package.json`, `README.md`.
**Do not edit:** `tactics-browser.test.mjs` or map assets; controller owns those.

Interfaces follow existing adapters exactly:

```js
const scene = R.prepareScene(fight, sourceScene, L.assign(fight, roster));
const frame = R.simulate(fight, scene, timeMs);
const rosterText = R.copyText(fight, scene, frame);
// Shared renderer calls:
Render.draw('floor', {ctx, px, yd, width, height}, scene, frame);
Render.draw('foreground', {ctx, px, yd, width, height}, scene, frame);
```

Expose semantic frame fields for browser/behavior verification: `phase`, `stage`, `essence`, `pos`, `boss`, `bossTarget`, `hp`, `roles`, `focus`, `call`, `timeMs`, `bossHp`; mechanic-specific fields include `shield`, `cast`, `souls`, `mana`, `maxMana`, `spite`, `seethe`, `lust`, `scream`, `drains`, `absorbs`. Additional scene metadata can resolve real participants and event times. Do not depend on random numbers, prior frames or browser globals in simulation.

Author these independent scene windows (milliseconds; transitions can be softened around these events without moving the mechanic boundary):

| ID | Duration | Boundaries |
|---|---:|---|
| overview | 6000 | static phase sequence |
| positioning | 6000 | static sheet formation |
| fixate | 17000 | rotations at 5000, 10000, 15000; receivers move closest before the selection |
| suffering | 18000 | drain at 1000, available dispel at 3000; Enrage 3000–18000; tank rotations every 5000 |
| souls | 12000 | souls approach 1000–4000; nearby deaths at 5000, 6500, 8000; recovery follows each death |
| desire | 14000 | damage/recoil pulses 2000, 5000, 8000; healing afterward if available; max mana progressively shrinks |
| interrupts | 16000 | Spirit Shock starts 2000, first kick 2800; Rune Shield at 5000, eligible removal 7000; next Shock 8000, second kick 8800 |
| deaden | 10000 | Deaden cast at 3000, eligible interrupt 3800; warrior reflection is explained as the alternative |
| anger | 18000 | initial pickup; two-tank called handoff at 2000; Seethe lasts ten seconds; stable-threat call after 12000; frontal Scream at 14000 |
| spite | 16000 | established threat at start; Lust from 1000 if available; marks at 3000, impact at 9000, recovery afterward |
| cycle | 100000 | Suffering 0–20000, souls 20000–32000, Desire 32000–60000, souls 60000–72000, Anger 72000–100000; Spite 88000–94000; final kill 99000 if damage exists |

The full cycle composes the same mechanics and boundaries using local stage time, carrying illustrative HP across Suffering rotations and into its first intermission, and carrying Desire’s reduced resources into the second. Avoid falsely completing missing utilities: shields remain if no remover, interrupts fail without an eligible player, and source notes explain missing coverage. No damage roster means no fabricated kills. Empty/unknown class data never assigns class-specific abilities to named players. Default example actors may have explicitly declared example classes; keep their count at 25. `L.assign` currently drops some source metadata: inspect its contract and preserve needed class data locally without changing other bosses’ assignment behavior.

- [x] Read the approved design and the existing Akama adapter/render tests. Write meaningful failing behavior tests first; record the RED command and expected missing-module/behavior failure.
- [x] Build scene data including all guidance, spell cards, sources, legend and state labels. Follow existing markup and asset styles.
- [x] Implement formation and eligible participant selection. Cover two/three tanks, one/no tank, no damage/healer, named rosters with missing/unknown utility, oversized rosters and main-tank order.
- [x] Implement deterministic scene frames and current roster exports. Check exact event boundaries and no input mutation.
- [x] Render the mechanics visibly: tank movement/target line, health loss, drain/absorb badges, gathering and dying souls, mana ceiling, cast/shield removal, frontal cone, Spite/immunity/impact. Avoid relying solely on changing text. Draw focused labels and preserve the compact floor.
- [x] Wire registry/scripts/adapters. If shared `drawBoss` needs essence labels/art/facing, use optional frame fields while preserving old bosses. Update package test command and README.
- [x] Run `node tactics-reliquary.test.js`, relevant shared unit suites, then `npm test`. Report results and self-review findings to `/tmp/reliquary-terra-report.md`.

Meaningful initial test shape:

```js
const source = fight.scenes.find(s => s.id === 'fixate');
const scene = R.prepareScene(fight, source, L.assign(fight, null));
const before = R.simulate(fight, scene, 4999);
const after = R.simulate(fight, scene, 5000);
assert.notEqual(after.bossTarget, before.bossTarget);
const chosen = after.pos[after.bossTarget];
for (const [id, p] of Object.entries(after.pos)) {
  if (id !== after.bossTarget) assert(L.dist(fight, chosen, after.boss) < L.dist(fight, p, after.boss));
}
const snapshot = JSON.stringify(scene);
const direct = R.simulate(fight, scene, 10000);
R.simulate(fight, scene, 0);
assert.deepEqual(R.simulate(fight, scene, 10000), direct);
assert.equal(JSON.stringify(scene), snapshot);
```

## Task 3: Browser acceptance, review and delivery (controller + Sol)

**Files:** `tactics-browser.test.mjs`, this plan’s completion ledger; fixes in Task 2 files via Terra.

- [x] Extend existing nav expectation to four bosses and navigate the Reliquary deep link.
- [x] Exercise all eleven chapters, seeking, final hold, replay, speed, reduced motion, named-roster jobs and both exports; assert semantic frames agree with displayed labels.
- [x] Capture desktop and phone frames for positioning, Fixate, souls, shield/cast, Anger front and Spite. Inspect images and fix overlapping or unreadable geometry.
- [x] Run `npm run test:tactics-browser` and `git diff --check`; retain logs and screenshots under `/tmp/reliquary-*`.
- [x] Give Sol the approved spec, implementation plan and complete working diff including new files. Resolve material findings through Terra and verify amended behavior.
- [x] Record final verification evidence here and report the local preview link to the user. Keep changes local and uncommitted.

## Completion ledger

Design approved by user. Baseline `npm test` passed. Fresh room downloaded from `https://cdn.raidplan.io/raid/wow.blacktemple/map/06.souls-main.jpg` (1600×889), visually matched to the sheet. Boss PNG (330×210) and spell JPGs downloaded from Method’s public artwork. Terra implemented the encounter and visual modules; the controller added independent browser acceptance. Initial RED evidence: the new behavior test failed with the expected missing `tactics-reliquary.js` module before implementation.

Sol reviewed the completed implementation and reported no remaining material findings. Review fixes cover exact intermission resource continuity, class-eligible utility and exported jobs, missing tank/healer coverage, Anger pulse damage and per-event Spite immunity, resource-dependent Soul Scream damage, and inert victory frames. The focused Reliquary suite contains 15 passing behavior groups.

Final verification: `npm test` and all 60 `npm run test:tactics-browser` checks passed; `git diff --check` passed. Logs: `/tmp/reliquary-approved-final-unit.log` and `/tmp/reliquary-approved-final-browser.log`. Desktop and phone captures are in `/tmp/reliquary-approved-final-screens`; the dedicated visual pass is in `/tmp/reliquary-approved-visual-final-run5`. Both were visually inspected. Sol's review is recorded at `/tmp/reliquary-approved-sol-review.md`.

The existing local server serves the briefing at `http://localhost:3000/tactics.html?fight=bt-reliquary`. All work remains local and uncommitted. Unrelated workspace files were preserved.
