# Reliquary Health-Based Tank Swaps Implementation Plan

> **For agentic workers:** Use subagent-driven-development with the user's existing Astra/Terra/Sol coding flow. The user approved this design; implement without another approval gate.

**Goal:** Teach that Suffering checks the closest player every five seconds, while tank changes are chosen for health and survival readiness.

**Architecture:** Separate Fixate checks from authored handoff decisions in the deterministic simulation. Demonstrate the same tank holding several checks, visibly losing health, then handing over at a later check. Treat Enrage as a separate prepared-cooldown survival lesson. Preserve manual explanations and the distinct tank positions and labels.

**Tech Stack:** Browser JavaScript/canvas, Node assertions, Chrome regression harness.

## Global Constraints

- Icy Veins describes swaps based on health, shields and cooldowns, with prepared tanks or a Rogue with Evasion handling Enrage: https://www.icy-veins.com/tbc-classic/reliquary-of-souls-reliquary-of-the-lost-guide-strategy-abilities-loot
- Method recommends alternating each Fixate as a strategy; this is not a mandatory mechanic: https://www.method.gg/guides/black-temple/reliquary-of-souls
- Latest user correction supersedes earlier fixed five-second tank rotations in previous plans and tests.
- No universal exact HP threshold. Any illustrated health/timing is an example, not a required numerical trigger.
- Normal lesson: tank holds through multiple five-second checks, HP falls, fresh tank approaches, next Fixate transfers ownership, previous HP remains lost. Keep three distinct tank identities; standby tanks do not constantly move.
- Enrage: show prepared tank with defensive/avoidance cooldowns; optional class reminders remain optional. Remove any claim that exactly three tanks must take five seconds each.
- Preserve names, class eligibility, missing-role behavior, manual controls, previous tank-spacing fixes, other phases and other bosses.
- Update overview, scene guidance, actions, labels, export instructions and tests together; do not leave old required-swap wording in current product surfaces.

## Task 1: Simulation and authored explanations (Terra)

Files: `tactics-reliquary.js`, `tactics-reliquary-steps.js`, `tactics-reliquary-data.js`, `tactics-reliquary-render.js`, `tactics.js` only if needed, `tactics-reliquary.test.js`, `tactics-reliquary-steps.test.js`.

- [x] Replace incorrect tests with failing behavioral checks: same target across 0/5/10-second checks, falling active-tank HP, a later health-motivated handoff, prior damage preserved, no forced target cycling during prepared Enrage, missing tanks/classes remain honest.
- [x] Author independent read-at-your-own-pace steps for holding, low-health decision, approach and completed handoff. Send exact step IDs, source ranges and frame fields to the controller before browser adaptation.
- [x] Implement deterministic simulation with separate selection checks and chosen swap windows. Keep movement and damage continuous at boundaries. Show the health reason and optional next receiver on the canvas; draw movement arrows only when a handoff is actually due.
- [x] Author Enrage preparation and survival explanations, with visible defensive readiness and a prepared tank holding multiple Fixates. Preserve Soul Drain, Priest shields, healer damage, optional Evasion and Deterrence lessons.
- [x] Correct all current text and full-cycle behavior to match; run focused raw/step tests and syntax checks. Parent owns commits/releases.

## Task 2: Acceptance and review (controller and Sol)

Files: `tactics-browser.test.mjs`, `README.md`, this plan.

- [x] Adapt browser tests to the new authored steps and verify same tank across repeated checks, HP-driven cue before movement, held approach before selection and handoff on next arrow. Preserve pixel-spacing/label-collision checks.
- [x] Verify Enrage depicts prepared survival without mandatory five-second swaps; ensure old absolute instructions are absent from overview/current canvas/export prose.
- [x] Capture desktop and phone opening, low-health, handoff and Enrage states with example and imported rosters; inspect actual rendered text and geometry.
- [x] Sol independently reviews correctness, source interpretation and regression scope; resolve material findings.
- [x] Run `npm test`, full tactics browser regression and `git diff --check`. Integrate and push through the previously authorized main update after successful verification.

## Verification results

- Full `npm test` and `npm run test:tactics-browser` passed after the simulation, authored explanations and missing-roster corrections.
- Final desktop layout inspection found a waiting tank partly beneath the teaching panel and a dropped label. Added desktop space and a nearest-free label placement fallback that preserves collision exclusions.
- After that adjustment, focused Reliquary simulation/step tests, syntax checks and the complete Reliquary browser acceptance suite passed. Browser assertions now require all three tank labels, tokens below the teaching panel, non-overlapping labels and contained status text across desktop and phone explanation frames.
- Example-roster captures and named-roster checks cover the held tank, health cue, approach, completed handoff and Enrage preparation/survival. Final screenshots are stored under `/tmp/reliquary-health-layout-final-v2` and `/tmp/reliquary-health-named-final`.
- Sol independently reviewed the final implementation and layout follow-up with no remaining material findings. Review: `/tmp/reliquary-health-sol.md`.
- Main integration uses the exact tested tree via fast-forward; unrelated untracked files are excluded.
