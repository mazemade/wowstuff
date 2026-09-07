# Reliquary Manual Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. User approved the design and implementation; continue without another approval gate.

**Goal:** Let the user read and explain each Reliquary mechanic at their own pace while its demonstration remains visible.

**Architecture:** Author explicit explanations inside existing Reliquary chapters. Separate the selected explanation and stable teaching text from its animation clock. Use the existing simulation for bounded demonstrations; preserve completed state when repeating decorative effects. Keep continuous playback for the final cycle.

**Tech Stack:** Existing browser JavaScript, canvas renderer, Node assertions and Chrome browser harness.

## Global Constraints

- User approved manual explanations within chapters; left/right arrows and Previous/Next buttons traverse explanations, then chapters at boundaries.
- Existing chapter tabs jump directly to a chapter's first explanation. Show `Explanation N of M` with its title.
- Explanatory text, player names and tips never advance automatically. A timed countdown may animate separately from stable explanatory prose.
- Animations repeat only where repetition does not undo completed encounter state. State transitions and countdowns run once and hold their result. Replay repeats the current demonstration only.
- Hide the running timeline, elapsed clock and speed selector in teaching chapters. Keep animation pause/replay controls. `Put it together` retains continuous playback and existing timeline controls.
- Right rail stays spell/reference-only. Maintain accessible current explanation, keyboard input guards, phone controls and current exports.
- Scope changes to Reliquary. Existing Naj'entus, Supremus and Akama navigation/playback are unchanged.
- Preserve source tactics, real roster/class eligibility and all useful tips already present. No new mechanics research or content redesign is needed.
- Continue local, uncommitted work in the current checkout. No push/deploy; preserve unrelated files.

## Task 1: Manual explanations and presenter integration

Owner: Terra. Own all implementation files and unit tests; controller owns `tactics-browser.test.mjs`.

Files: create `tactics-reliquary-steps.js` and its focused Node test; modify `tactics-reliquary-data.js`, `tactics-reliquary-render.js`, `tactics.js`, `tactics.html`, `tactics.css`, `package.json` only as needed. Preserve the raw simulation API and its regression tests.

- [x] Write failing behavior assertions: selecting a beat and waiting cannot change its index/text; finite transitions hold; replay stays in the beat; effect loops retain shield/tank/resource state; previous/next chapter boundaries; cycle remains continuous.
- [x] Author complete steps for every teaching chapter, including overview/positioning, three tank handoffs, dispel/shield/healer DPS/Enrage/optional avoidance, soul gather/kill/recovery, damage/recoil/heal/mana depletion, Tongues/first interrupt/Shield/Spellsteal/next interrupt, Deaden/normal kick/optional reflection/Deadly Throw, Anger preparation/pickup/taunt/wait/burn/Scream, and Spite marks/countdown/impact/recovery/healthstone.
- [x] Implement a dedicated module exposing authored explanations and bounded simulation/animation behavior. Each explanation needs stable identity, stable teaching title/detail/tip, semantic sample/range and explicit once/hold/effect-loop behavior. Do not derive steps from incidental renderer text changes.
- [x] Integrate the current explanation into presenter navigation and controls. Preserve `__tactics.simulate` raw semantics; expose `__tactics.showExplanation(index)` and active explanation metadata for inspection. Send controller exact interface and timeline mapping early.
- [x] Add dynamic countdown drawing where stable text previously supplied a changing number. Keep rendered words and exports synchronized with the selected explanation, not a later loop frame.
- [x] Run focused unit checks and inspect a desktop and phone principal P2 sequence. Report changes and evidence in `/tmp/reliquary-manual-terra.md`.

## Task 2: Browser acceptance and independent review

Owner: controller for browser verification; Sol for independent review.

- [x] Adapt direct-seek browser helpers to select the corresponding explanation; retain prior simulation/source coverage without bypassing the actual new user interface.
- [x] Add acceptance for ArrowRight/Left and buttons inside chapters, boundary navigation, chapter-tab resets, stable text after long waits, replay without advancement, continuous final cycle, phone layout, input guards and accessible progress.
- [x] Capture desktop/phone P2 and Spite explanations and verify text stays readable while effects animate. Ensure optional tips are individual readable explanations.
- [x] Sol reviews spec compliance and code quality against this plan, source preservation and captured UI. Resolve material findings.
- [x] Run full `npm test`, full browser regression and `git diff --check`. Verify port 3000 serves the changed files. Leave everything local/uncommitted.

## Completion evidence

Implemented and reviewed locally on 2026-09-07. Terra implementation and fixes are complete; Sol's final review reports no remaining material findings.

- Full `npm test` passed (exit 0): `/tmp/reliquary-manual-final-unit.log`.
- Full `npm run test:tactics-browser` passed (exit 0), including earlier bosses: `/tmp/reliquary-manual-final-browser.log`.
- Desktop and phone P2/Spite start and held-state captures: `/tmp/reliquary-manual-final-screens`. Final phone controls and completed Spite impact were visually checked.
- Independent review: `/tmp/reliquary-manual-sol.md`; implementation report: `/tmp/reliquary-manual-terra.md`.
- The running preview at port 3000 serves the new step module byte-for-byte and includes it in `tactics.html`.
- `git diff --check` passed. Work remains local and uncommitted; unrelated files were preserved.

## Release follow-up

The user subsequently authorized updating the Soul Scream wording and merging/pushing the complete Reliquary feature to `main`. The explanation now names rage and mana, explains the damage penalty, and starts before resource spending so the selected demonstration shows spending followed by impact. Preserve the newer browser-storage fix already on `main` during integration.
