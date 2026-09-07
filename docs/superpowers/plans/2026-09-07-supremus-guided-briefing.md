# Supremus guided briefing implementation plan

**Goal:** Make the existing Tactics page a clear, presenter-controlled guild briefing. The user approved the review recommendations and explicitly excluded trash preparation.

**Architecture:** Keep the existing map, role artwork, vanilla JavaScript and canvas renderer. Fight data owns scene guidance and example timelines; the layout module owns roster placement; the player owns presentation, animation and export. Keep the existing tactics branch and local preview.

## Constraints

- No trash preparation scene. No new dependencies or external writes.
- Preserve real roster names, including an optional third tank. Label generic formations as examples.
- Separate approximate diagram distances from verified encounter rules. Remove scaled journal damage values from the briefing.
- Keep source links and detailed mechanics available in a collapsed reference section.
- One main call per scene; named navigation, pause/play, replay, scrub, speed and fullscreen controls.
- Animations end on a held frame. No automatic slide advancement. Reduced motion starts paused.

## Tasks

- [x] Correct mechanics and roster behavior in `tactics-data.js` and `tactics-layout.js`. Add regression tests for a three-tank roster, no phantom named-roster players, tanks spreading in Phase 2, phase-transition sequencing, and meaningful scene callouts. Run `node tactics-data.test.js` and `node tactics-layout.test.js`.
- [x] Build a responsive presenter shell in `tactics.html` and `tactics.css`: map with legend; named chapter navigation; transport controls; focused guidance rail with role instructions, a common mistake and expandable source reference. Preserve existing fonts and courtyard palette, with blue flames, orange volcanoes and a clear target marker.
- [x] Update `tactics.js`: hold/pause/seek playback, scene-driven clock, faint context tokens, complete movement framing, movement arrows, separated MT/Hateful hits, clear safety margins, combined fixate/volcano demonstration and a tank pickup before repositioning. Use real encounter seconds at selectable playback speeds. Export the current briefing context with its image.
- [x] Verify in headless Chrome at desktop and mobile widths; verify keyboard, pause/resume, seeking, scene endpoints, source disclosure and roster variants. Run the full existing test suite. Review the final diff and leave the improved page ready locally.

## Verification details

- Pausing holds both canvas time and phase time; replay returns to zero; seeking paints immediately while paused; navigating to another scene starts at its first frame.
- Fixate examples switch after 10 encounter seconds. Phase reset and threat display use the same scene timestamp.
- The runner and its demonstrated escape route remain in frame throughout the fire scene.
- Combined Phase 2 avoids active volcanoes as well as the boss. Back-to-Phase-1 starts from the demonstrated end of Phase 2; DPS does not enter before pickup.
- The generic example has 25 slots; imported rosters retain their actual composition and names. Role references resolve by role rather than relying on default slot numbers.
- `git diff --check`, `node --check tactics.js`, `npm test`, plus browser assertions and screenshots at 1600x1000, 1280x800 and 390x844.

## Completed verification

- Targeted tests: 21 tactics-data checks, 19 tactics-layout checks and the playback state regression pass.
- Full `npm test` passes, including the existing assignment, vetting and server suites.
- `npm run test:tactics-browser` passes 18 checks in an isolated Chrome profile. Covers scene bounds and route safety, pickup order, playback, keyboard controls, roster roles, exports and reduced motion.
- Visual inspection at desktop, 1280×800 and 390×844 confirmed the map, controls, sidebar and mobile callout. Laptop and mobile pages have no horizontal overflow.
- Independent review findings on hunterless Misdirect assignment, keyboard focus and elapsed-time announcements were fixed and re-reviewed.
- No dependencies added. Changes remain on the existing local tactics branch.

## Raider feedback refinements

- Active scenes show local WoW-style spell details, including icons, cast/range information and descriptions. Hateful Strike and Molten Flame damage text is checked against the Classic spell tooltips; unresolved scripted volcano damage is not presented as zero.
- During the pre-Phase-2 spread, melee moves early while tanks hold their tanking positions until fixate begins. Callouts, role guidance and text exports agree with the animation.
- Imported names appear on the positioning scene. Mechanics use role icons with short tank and mechanic labels; copied rosters retain names.
- Browser regressions cover tank timing, visible scene-specific spell cards and name visibility. Desktop and mobile screenshots confirm readable cards and no horizontal overflow.
