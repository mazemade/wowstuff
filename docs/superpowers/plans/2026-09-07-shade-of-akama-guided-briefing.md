# Shade of Akama Implementation Plan

> **For agentic workers:** Continue the user-selected Astra planning → Terra implementation → Sol review workflow. This updates the existing draft; do not restart implementation or pause for another approval.

**Goal:** Order the boss tabs Naj’entus, Supremus, Shade of Akama and give Shade the same complete, presenter-controlled briefing quality as the existing encounters.

**Architecture:** Extend the shared presenter with the existing encounter-adapter pattern for scene preparation, deterministic frames, roster export and canvas overlays. Preserve playback, seeking, keyboard controls and imported roster behavior. Default and invalid URLs select Naj’entus; explicit Supremus links retain their behavior.

**Tech Stack:** Existing browser JavaScript, HTML/CSS and canvas; Node assertions and browser harness. No new dependencies.

## Source and tactical requirements

The primary source is the [guild Black Temple spreadsheet](https://docs.google.com/spreadsheets/d/1FyVLgyE6RAgppltXd72VcGEi3OPGBhKn0iEwmD0U4yk/edit), **Boss Shade of Akama** tab, including its embedded strategy image. Verified from `/tmp/bt-strategy.xlsx`, worksheet `sheet7.xml`, and `/tmp/akama-sheet-image32.png`. Public guides supplement mechanics omitted from the sheet; they do not replace the guild’s strategy.

- Before talking to friendly Akama, prepare tanks and available Frost Traps at both entrances and confirm tank-healing assignments. The image places melee near the Channelers, ranged on the steps, healers centrally, a paladin tank left and two tanks right. The third tank supports the side without a protection paladin; it is not a permanently separate Defender team. Mirror the support side when known roster classes require it, or explicitly label left/right as an example.
- Kill the six non-attacking Channelers quickly. They bind the Shade and require no tank. The sheet explicitly allows fast Channeler damage to avoid spending the first phase killing every add wave; tanks must still pick up and control adds.
- Demonstrate Spiritbinders, Elementalists, Rogues and a Defender. Interrupt Spiritbinder heals, especially near Channelers. Use hallway Frost Traps for kiting and mitigation; do not teach standing still as the only tanking method. Leave fixed Rain of Fire areas while preserving tank-healing coverage.
- Include reinforcing Sorcerers as a supplementary mechanic supported by the public references. A new binding is a damage priority. Keep this distinct from the spreadsheet’s six initial Channelers.
- When bindings end, the Shade walks to Akama. Tanks bring controlled adds closer to the Shade and damage dealers use this travel time to clean them up. This transition must appear in the full-cycle animation and roster jobs, not just a tip.
- When the Shade engages Akama, call Bloodlust / Heroism and offensive cooldowns. Akama fights the Shade; player tanks retain any surviving adds. The sheet gives about one minute before Akama dies. Present that as the tactical burn budget, never a live timer or DPS prediction.
- Retain the optional Seed of Corruption tactic as a tip: an add among the Channelers can carry splash damage. Do not make it mandatory or delay the release to set it up.

Supplementary sources: [Wowhead](https://www.wowhead.com/tbc/guide/shade-of-akama-black-temple-bt-strategy-burning-crusade-classic), [Method](https://www.method.gg/guides/black-temple/shade-of-akama), [Icy Veins](https://www.icy-veins.com/tbc-classic/shade-of-akama-guide-strategy-abilities-loot). Use the unannotated [Raidplan room](https://cdn.raidplan.io/raid/wow.blacktemple/map/03.akama-topdown.jpg) and local boss art.

## Presentation and roster contract

Eight independent chapters: overview, pull/positions, Channelers, hallway adds, reinforcing Sorcerers, Rain of Fire, Lust/burn, complete encounter. Every chapter has a call, explanation, role jobs and common mistake. Violet beams show living bindings, gold marks damage priorities, blue marks Frost Traps/tank control, green distinguishes friendly Akama and orange marks fire.

The default 25-player illustration can retain three tanks, six healers, seven melee and nine ranged. The source image represents grouped positions rather than an exact roster count. Imported rosters retain every player name without fillers. Missing tanks, healers, damage or hunters produce relevant notes; two real tanks cover their respective sides and any Defender pickup without inventing a third tank. Do not assign Frost Traps to a named roster without a hunter.

Keep the room, two entrances, six Channelers and friendly Akama readable on desktop and mobile. Positions, routes, kill order, animation timings and health bars are illustrative. The independent burn chapter begins after the walk/cleanup and shows only surviving controlled adds, rather than replaying the opening doorway wave.

## Task 1: Align the existing encounter draft

**Files:** `tactics-akama-data.js` (copy, scenes, sources), `tactics-akama.js` (roles and simulation), `tactics-akama-render.js` (overlays), local `maps/tactics/` assets. **Tests:** `tactics-akama.test.js`.

**Interfaces:** `prepareScene(fight, scene, assigned)` creates independent scene data; `simulate(fight, scene, timeMs)` returns positions, NPCs, channels, hazards, traps, stage, phase, call and illustrative health without mutation; `copyText(fight, scene, frame)` exports the loaded roster with current jobs.

- [x] Correct any remaining source discrepancies above, especially the non-paladin support side and the independent burn chapter’s already-completed cleanup.
- [x] Add meaningful assertions for prepared hallway traps, real-tank add ownership, bindings disappearing/reappearing, fixed fire with escaping players, add cleanup during the walk, burn beginning with Akama as target, and tank control of survivors.
- [x] Check direct seeks are deterministic and scenes/rosters are not mutated. Cover partial and oversized rosters, two tanks, absent damage and absent hunters without invented players or abilities.
- [x] Run `node tactics-akama.test.js`; all encounter assertions must pass.

## Task 2: Preserve shared presenter behavior and verify delivery

**Files:** `tactics-data.js`, `tactics.js`, `tactics.html`, `tactics-browser.test.mjs`, `package.json`, `README.md` and shared tests where required.

- [x] Verify registry/tab order and all three explicit boss links. Keep encounter adapters, overlays, stage labels, boss facing and exports connected through the shared presenter.
- [x] Exercise all Shade chapters, seeking, playback, keyboard controls, roster edge cases, current-job exports and reduced motion. Ensure existing Naj’entus and Supremus behavior still passes.
- [x] Run `npm test`, `npm run test:tactics-browser` and `git diff --check`. Inspect desktop and mobile screenshots, particularly positioning, fire escape, walking/cleanup and burn; correct overlap or unreadable geometry.
- [x] Have Sol review the final draft against this spreadsheet-backed plan and resolve material findings before reporting completion.

**Validation boundary:** Local changes and checks only. No commit or release is part of this handoff.

## Completion evidence

Astra checked the source-backed plan; Terra refined the encounter implementation; Sol reviewed the result and verified both review fixes. `npm test` passed, including 12 Akama behavior checks. `npm run test:tactics-browser` passed all 45 checks, covering existing bosses, Shade, mobile framing and exports. Desktop and phone screenshots were inspected in `/tmp/akama-screens`. `git diff --check` passed. Changes remain local on the `tactics` branch.
