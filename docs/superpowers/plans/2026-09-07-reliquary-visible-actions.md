# Reliquary: make the tactic visible

User feedback after the sheet-alignment correction: the tool still does not explain the tactic when viewed. Continue the authorized Astra → Terra → Sol flow, preserve existing boss format, and correct the missing visual explanation. No commits, pushes or deployment. This is a continuation of the approved clarity work, not permission for a new visual style.

## Finding

The successful Naj'entus and Akama scenes show who performs an action and what changes because of it: rescuers move to victims, a spine is collected and thrown, tanks bring packs to a destination. Reliquary primarily flips generic status chips. Several indistinguishable lit tokens are not a substitute for showing a Warlock applying Tongues, a Mage stealing a shield or a player kicking a cast. Resource bars are small and detached from their owners. The raid occupies a small part of the room while decorative floor art dominates.

## Implementation contract

**Explicit user clarification:** The explanation on the right is not good; everything that must be done, including mechanics and tips, should be explained in the animation. The right side is only for spell names and additional reference explanation. This is the governing acceptance criterion. Move instructional narration, priorities, role assignments, reaction windows, preparation and optional tips into the visual sequence. Do not simply duplicate a long role list over the map. Remove the Reliquary right-side main call/why, live role list and watch-out teaching blocks from the visible rail; retain relevant spell cards and expandable reference/sources. Preserve equivalent information in exports and accessibility text. Other bosses are unchanged.

Keep all eleven scene IDs, existing module structure, sources, roster handling and source tactics from the previous clarity plan. Avoid another copy-only pass. Existing exact phase/event boundaries may stay: animate the approach to an event and hold the visible result afterward. Preserve deterministic direct seeking and the no-coverage branches. Treat choreography as a teaching illustration, without adding invented raid mechanics.

Terra owns `tactics-reliquary.js`, `tactics-reliquary-render.js`, `tactics-reliquary-data.js`, `tactics-reliquary.test.js`, scoped CSS and necessary minimal presenter integration. Controller owns browser tests and visual acceptance. Do not modify unrelated files or prior bosses.

### Visual story requirements

- Use the existing map, role tokens, typography and chapter layout. Frame the active fight area more tightly using existing view support, with enough space for roster and teaching labels on desktop/phone. The boss and relevant actors must be large enough to read. Preserve the positioning overview of the whole group.
- Show a persistent, readable current phase and its main rule: `1 Suffering · no healing`, `2 Desire · interrupts first`, `3 Anger · threat, then burn`, and distinct soul intermissions. A compact sequence indicator should connect Suffering → Souls → Desire → Souls → Anger. Reuse existing UI positions; remove redundant tiny status chips rather than layering more text over them.
- Every active mechanic needs an identifiable actor, a visible action, and a visible result. Use named actors or explicit default example labels near the actual tokens, with leader lines when needed. Limit labels to the active roles so they do not overlap; avoid dumping all assignments onto the map.
- Include the source tips at the relevant visual moment: Priest shields and healer DPS/priority magic dispels, optional Rogue Evasion/Hunter Deterrence during Enrage, Tongues' benefit, optional Warrior Deaden reflection, optional glove/Deadly Throw backup, Shadow Protection before Anger, and healthstones after Spite. Optional actions should be marked optional rather than silently changing the main strategy or assigning nonexistent roster abilities.
- Suffering: readable three-tank rotation and clear incoming/outgoing routes. Show current tank taking damage while its health cannot be healed; show a Priest shielding that tank, the dispeller removing Drain, and healers contributing damage. Those actions must have visible from/to relationships, not just a green ring or a changed sentence. Keep the 45–60s Enrage survival lesson and its three five-second turns.
- Souls: visibly gather ghosts at a marked raid destination, kill them there, then show health/mana recovery reaching the raid. Withdraw the boss. Avoid full restoration merely from a label changing.
- Desire damage lesson: visibly connect an actual damage actor's hit on the boss to damage returning to that same actor and healer recovery. Make the mana loss legible and associated with casters, not a tiny unexplained counter in a corner. Show the 50% reflection and doubled healing rules simply; resources remain illustrative.
- Desire interrupt lesson is the principal acceptance scene. Identify the Warlock, Mage and current/next interrupter on the map. Show Tongues travelling from Warlock to boss and remaining as a labelled debuff; demonstrate that it gives extra reaction time on the cast display. Show the current interrupter acting on Spirit Shock and the cast visibly stopping. When Rune Shield appears, clearly indicate interrupts are blocked. Show Mage Spellsteal travelling from boss to Mage, the boss shield disappearing and the Mage receiving it; fallback dispels remove it without claiming a stolen buff. Then show the next actor kicking the next cast. Hold each result long enough to see it. The role panel and map must agree throughout.
- Deaden: visibly connect assigned interrupter to the cast and stop it. Clearly explain doubled incoming damage and optional Protection Warrior reflection benefit, without depicting reflection if the normal kick was selected.
- Anger: label OT and MT in place, show OT ownership first, a visible MT taunt action and target transfer, then show the raid begin attacking and available Bloodlust after the established four-second wait. Separate that from Seethe tank damage. Increasing raid damage/Shadow pressure should be visible, not just an expanding decorative circle. Keep Scream facing and tank-resource guidance secondary and readable.
- Spite: three identifiable marked targets, a readable six-second countdown, healer actions reaching them before impact, the hit, then recovery/healthstone reminder. Marks remain in position because this is not a spread mechanic.
- Full cycle carries the same visible actions and phase cues through both soul windows. Overview teaches the phase sequence at rest; it must not require pressing Play just to learn the plan.

### Readability and scope

Avoid fixed 10–11px chip walls, long all-caps labels, status badges detached from the relevant actor, unexplained generic rings, and tiny movements hidden among touching tokens. Prefer the concise local action labels and visible routes used in Naj'entus/Akama. Focus one action at a time. Background/unused tokens can be subdued, but active helpers must remain legible. Avoid moving all 25 players just to manufacture activity.

Use meaningful behavior assertions for from/to actor eligibility, action/result timing and direct seeks. A renderer test should verify the labelled actions are actually drawn, not only fields present in the simulation. Keep existing regression intent; amend implementation-specific checks only where the improved presentation requires it. Do not advertise test counts as proof of clarity.

## Progress

- [x] Astra compared successful bosses and identified the missing action/result relationships.
- [x] Terra implements timed actions, teaching state, utility illustrations and resource timing; controller integrates readable canvas choreography and framing. Report `/tmp/reliquary-visible-actions-terra.md`.
- [x] Controller inspects fresh desktop/phone frames and full phase-two sequence, checking whether the tactic can be understood from the picture. Final captures: `/tmp/reliquary-visible-review-final`.
- [x] Sol independently reviews sheet alignment and visual explanation, and material findings are resolved. Final verdict: ready, no remaining material findings; `/tmp/reliquary-visible-actions-sol.md`.
- [x] Verify complete unit/browser regression and leave local preview ready.

## Verification and review corrections

The animation now carries the lesson through one current action and explicit actor connections, cast/health/resource results, and optional utility illustrations. The right rail retains active spell details and expandable reference. Screen-reader canvas text and exports retain the guidance. Phone framing reserves space for readable narration and labels.

Independent review corrections include the zero-mana endpoint at accelerated phase time 2:40, Mage/Warlock and current/next interrupt labels during Rune Shield, visual optional ability demonstrations, and in-map positioning callouts. Optional diagrams describe alternatives without fabricating a different selected strategy. Tongues uses the sourced 60% cast-time increase (1.0s to 1.6s). The normal Deaden interrupt is shown before its optional alternatives.

- Complete `npm test`: passed; `/tmp/reliquary-visible-final-unit.log`.
- Complete browser regression: 65 passing checks; `/tmp/reliquary-visible-final-browser.log`.
- Final Reliquary-only label correction: 26 unit checks and focused browser regression passed; `/tmp/reliquary-visible-last-unit.log`, `/tmp/reliquary-visible-final-focused.log`.
- `git diff --check`: passed. Local port 3000 serves the current renderer. All work remains local and uncommitted.
