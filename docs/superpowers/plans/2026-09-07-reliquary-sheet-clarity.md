# Reliquary guild-sheet clarity correction

> Use subagent-driven-development for the approved Astra planning → Terra implementation → Sol review flow. The user approved the preceding review's correction direction and explicitly requested Curse of Tongues and alignment with the guild sheet. Continue without another approval. Keep changes local and uncommitted.

**Goal:** A viewer can identify who acts, what they do, and when, using the existing eleven-chapter briefing.

**Architecture:** Revise encounter data, deterministic frames and canvas cues. Add an optional live instruction list to the existing presenter for Reliquary only. Preserve existing bosses, controls, imported roster honesty and exports.

**Tech stack:** Existing JavaScript/Canvas/Node/Chrome harness; no dependencies or replacement artwork.

## Authoritative source and constraints

The current guild workbook is `/tmp/reliquary-sheet-review-current.xlsx`, worksheet `xl/worksheets/sheet11.xml`, A1–A33. Its current drawing relationships resolve to `xl/media/image29.png`, extracted as `/tmp/reliquary-sheet-review-linked-image29.png`. Do not assume image numbers remain stable between exports. This plan supersedes conflicting wording and the twelve-second damage wait in the original approved design.

- Preserve the existing checkout and all unrelated files, including `.claude/` and the untracked screenshot. No commits, pushes or deployment.
- Keep eleven scene IDs and original durations; retain cycle boundaries except Anger damage/Lust now starts four seconds after MT taunt (local 6000). Keep Seethe from 2000 through 11999 independently of damage starting.
- Standalone Suffering lesson opens just before Enrage: label real fight timing clearly (Enrage at 0:45, lasts 15s) without presenting the compressed full-cycle timer as a real encounter timer.
- Keep sheets' exact actionable tactics; do not invent named class abilities or pretend missing coverage succeeds. Unknown classes still receive general role instructions.
- Use short raid instructions in the main UI. A single unobtrusive illustrative-time note suffices; remove implementation wording such as "linked recoil", "representative souls", "invented threat percentages", "not a calculator".

## Task 1: Terra encounter and visible teaching correction

**Own:** `tactics-reliquary-data.js`, `tactics-reliquary.js`, `tactics-reliquary-render.js`, `tactics-reliquary.test.js`, encounter CSS in `tactics.css`, minimal optional presenter code in `tactics.js`. Do not edit browser tests, assets, or this plan.

- [x] Read the source worksheet and current modules, then add meaningful failing behavior assertions for current/next tank, visible assignment rows, Mage-first shield removal, Tongues coverage, and the taunt-to-damage timing. Run the focused suite to establish RED.
- [x] Rewrite all chapter calls, explanations, jobs, ability cards and reminders around the following sheet requirements:
  - Suffering: no healing or mana regeneration; armor removed and defense reduced. Healers DPS, magic dispels take priority, priests shield the current tank. Rotate three tanks every five seconds (two if roster requires); Enrage at 45s lasts 15s, all three take a five-second turn with avoidance/cooldowns ready. Optional Rogue Evasion/Hunter Deterrence reminder.
  - Souls: kill incoming ghosts near the raid to recover health and mana, both intermissions. Clear gathering destination.
  - Desire: 50% damage reflection, doubled healing, shrinking maximum mana and no mana by 2:40. Kicks and shield removal are priorities, not an instruction to stop DPS throughout. Spirit Shock is a fast cast every five seconds; a missed cast incapacitates the tank and switches the boss to the next threat target. Warlocks keep Curse of Tongues up because it lengthens casts and gives interrupters reaction time. Show an actual ordered kick assignment, current kicker and next kicker. Prefer a known Mage to Spellsteal Rune Shield; eligible purge/dispel is fallback. Never kick into the shield. Explain Deaden's doubled damage taken and the optional protection-warrior reflection benefit (boss takes doubled damage). Keep the PvP rogue glove tip as optional source guidance, not a gear requirement.
  - Anger: label OT pickup and MT TAUNT explicitly. At local 2000 MT taunts; four seconds later (local 6000, inside sheet 3–5s range) raid damage and available Bloodlust start. Explain threat setup directly without asserting a disputed threat-buff percentage. Seethe's ten-second attack speed increase is a separate survival cue, not a prerequisite for starting damage. Increasing raid damage AND incoming Shadow damage make this a burn. Shadow Protection before the phase; healthstones after Spite. Three Spite targets immune six seconds then about 7500 Nature damage; heal them beforehand, recover afterward. Keep frontal/resource guidance understandable and secondary.
- [x] Make mechanics visually attributable. Give tanks persistent compact numbers/MT-OT identifiers in relevant scenes, distinct waiting spots and movement arrows; show current tank, next tank and time to Fixate. Avoid token overlap at the handoff, with continuous paths and current target closest at the selection boundary. Keep all actors in bounds and focus on relevant actors without fading helpers who are acting.
- [x] Provide optional frame `instructionRows: Array<[string,string]>` with concrete current actions and names or explicit example labels. Render those rows in the existing role panel and update on seeks/playback only when their contents change. Existing bosses retain `sc.jobs`. At completion clear live rows and avoid stale combat instructions. Include the same tactical information in text/image exports. Show current+next kick and the shield remover in the visible panel; selected actors get short map cues, not every job as an overlapping map label. Spite marks should be identifiable. Keep static explanatory roles available through the frame rows as needed.
- [x] Keep the ordered kick cycle readable at rest and during casts, emphasize Mage Spellsteal and Warlock Tongues. Remove stale interrupted-cast chips when a new action becomes the focus. Text must explain failures honestly when utilities are absent.
- [x] Verify tests for direct seeks, no mutation, partial rosters, precise transitions, retained intermission resources and Spite immunity still pass. Update assertions only for intentionally revised behavior. Run relevant shared tests and self-review. Report code changes, RED/GREEN evidence and exact screenshot scene/times worth checking in `/tmp/reliquary-clarity-terra-report.md`.

## Task 2: Controller browser acceptance and Sol review

**Own:** `tactics-browser.test.mjs`, this plan, browser capture scripts in `/tmp`.

- [x] Add browser assertions for visible live instructions, named/current/next interrupters, Tongues and shield coverage, tank sequence, Anger taunt and four-second wait, and completion cleanup. Preserve old boss regression checks.
- [x] Capture current desktop and phone scenes for Fixate before/after handoff, Enrage, Tongues/kick/shield, Deaden, Anger pickup/taunt/damage, and Spite. Inspect readability and whether the next action can be identified without reading code or an export. Send bounded findings to Terra.
- [x] Sol independently compares the current sheet, live UI evidence and full amended modules against this plan. Resolve material findings and obtain a final verdict.
- [x] Run focused tests, `npm test`, `npm run test:tactics-browser`, and `git diff --check`. Record final evidence and local preview. No release action.

## Progress

- Astra: reviewed the current sheet and visible tool; user approved correction and explicitly highlighted Curse of Tongues.
- Terra: implementation complete; 21 focused behavior groups pass. Controller browser RED demonstrated unchanged visible tank instructions before the fix. Reports: `/tmp/reliquary-clarity-terra-report.md` and `/tmp/reliquary-clarity-browser-red.log`.
- Source correction: the optional Rogue glove note uses the actual [Gladiator's Leather Gloves tooltip](https://www.wowhead.com/tbc/item=25834/gladiators-leather-gloves): Deadly Throw gains an interrupt. The sheet's off-GCD Kick wording was not repeated.
- Suffering lesson timing is continuous: local time plus 42 seconds gives source time, and rotation swaps at local 3/8/13 seconds correspond to 0:45/0:50/0:55. The separate Fixate lesson and compressed cycle retain their boundaries.
- Sol's first review found overlapping tank tags, stale current/next kick labels, a fictional one-tank taunt, and unintended legacy PNG changes. Terra corrected them. Sol also caught false completed-kick text for missing interrupters and an obsolete interrupted badge during Shield; both received targeted regression coverage. Final Sol verdict: ready, no material findings remaining (`/tmp/reliquary-clarity-sol-review.md`).
- Controller inspected `/tmp/reliquary-clarity-v4` desktop and phone map/guide captures. Tank badges, live assignments, Tongues, Spellsteal and opening instructions are readable. The final source-clock captures in `/tmp/reliquary-clarity-source-clock-final` were also inspected. Final `npm test` passed and all 63 browser regression checks passed, with logs `/tmp/reliquary-clarity-final-unit.log` and `/tmp/reliquary-clarity-final-browser.log`. `git diff --check` passed. The existing server serves the exact updated module at `http://localhost:3000/tactics.html?fight=bt-reliquary`. Changes remain local and uncommitted.
