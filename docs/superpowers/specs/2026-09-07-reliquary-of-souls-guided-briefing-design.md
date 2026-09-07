# Reliquary of Souls guided briefing

**Status:** Approved and implemented locally through Astra planning → Terra implementation → Sol review. No commit, push or deployment. The abandoned Reliquary attempt from the other chat was disregarded.

**Approved follow-up:** The [guild-sheet clarity correction](../plans/2026-09-07-reliquary-sheet-clarity.md) supersedes this document where timing or guidance differs, including Anger damage/Bloodlust timing and visible assignments.

## Scope and approach

Add Reliquary immediately after Shade of Akama in the existing boss navigation, skipping Teron. Retain Naj’entus as the default. Use `tactics.html?fight=bt-reliquary` for the new encounter.

Match the finished bosses: the same room canvas, role icons, positioning names, chapter rail, main call, explanation, role jobs, common mistake, spell cards, sources, playback, seeking, keyboard controls and exports. This is a raid-leader teaching tool. Movement, damage, resource bars and encounter pacing are illustrative.

The recommended approach is another focused encounter adapter, following Naj’entus and Akama. Duplicating the presenter would split controls and accessibility across pages; replacing it with a generalized encounter engine would enlarge the regression surface. Neither serves this addition. Keep shared changes limited to registering the boss, loading its modules and supporting any strictly necessary frame fields.

## Sources and room layout

The [guild Black Temple spreadsheet](https://docs.google.com/spreadsheets/d/1FyVLgyE6RAgppltXd72VcGEi3OPGBhKn0iEwmD0U4yk/edit), **Boss Reliquary of Souls**, is the strategy authority, just as for Akama. The existing September 7 workbook was inspected at `/tmp/bt-strategy.xlsx`: `xl/worksheets/sheet11.xml`, cells A1–A33; its drawing references `xl/media/image24.png`. The extracted positioning image was visually inspected at `/tmp/reliquary-sheet-image24.png`. These are source materials from the existing boss work, not the rejected implementation.

The image puts the boss in the upper central ring facing three tanks, melee behind on either side, ranged farther back left/right and healers centrally behind. Translate those grouped positions into the actual roster. Keep the central floor readable; the drawing is not a requirement to spread players across the whole room. During Suffering, make the receiving tank visibly closest while other players stay outside that distance. During Anger, keep the front clear of everyone except the active tank.

Use the corresponding unannotated Raidplan room and authentic encounter/spell artwork, consistent with the earlier bosses. Verify the clean room matches this image before adding assets. Do not put moving tokens over baked-in strategy markers or generate replacement room art.

Supplementary sources checked September 7:

- [Wowhead Classic encounter guide](https://www.wowhead.com/tbc/guide/reliquary-of-souls-black-temple-bt-strategy-burning-crusade-classic).
- [Method encounter guide](https://www.method.gg/guides/black-temple/reliquary-of-souls).
- [Icy Veins Classic encounter guide](https://www.icy-veins.com/tbc-classic/reliquary-of-souls-reliquary-of-the-lost-guide-strategy-abilities-loot).
- [Spite spell 41376](https://www.wowhead.com/tbc/spell=41376/spite): Nature school, six-second immunity aura, supporting the sheet’s six-second example despite shorter timings in some guides.
- [Seethe spell 41364](https://www.wowhead.com/tbc/spell=41364/seethe): the boss gains a ten-second, dispellable Enrage with doubled attack speed. This is distinct from the player threat-generation effect.

## Encounter requirements

**Suffering:** Healing and regeneration are disabled; armor and defense are heavily reduced. Tanks share damage by controlling which player is closest at each five-second Fixate. This is positional selection, not a taunt rotation and not a Supremus chase. Show two- or three-tank rotation according to the roster. Damage taken persists across swaps: no healing bars refilling between tanks. Dispel Soul Drain promptly. Healers prioritize dispels and available absorbs, then contribute damage. Priest shields remain useful because absorbs work. Show Enrage as the survival window for avoidance and defensives; the sheet places it at 45 seconds for 15 seconds, but the standalone lesson can open just before it.

Keep the sheet’s Rogue Evasion/Hunter Deterrence suggestion as an optional reminder, with no automatic assignment or new alternate-strategy chapter. Do not assume a tank owns a particular trinket or a specific defensive build.

**Intermissions:** The defeated essence withdraws, souls approach the raid, tanks gather them, and damage kills them near the group. Health and mana recovery follows nearby soul deaths. Show this after both Suffering and Desire. Do not restore the raid merely because a phase label changes or draw soul deaths across the room as equivalent recovery. A small representative wave is sufficient; label it illustrative instead of claiming it is the full spawn count.

**Desire:** Healing is amplified, half of damage dealt is reflected back, and maximum mana progressively shrinks. Show damage and recoil as linked events, with healer recovery, not an environmental hazard to dodge. Use a distinct shrinking maximum-mana indicator so it cannot be mistaken for ordinary spell expenditure.

Spirit Shock requires a reliable assigned interrupt rotation. Rune Shield must first be removed with Spellsteal or an appropriate enemy-magic dispel: interrupts do not succeed while it is active. Show shield removal and then the next assigned interrupt as an explicit chain. Curse of Tongues is a helpful warlock job when that class exists. For Deaden, show the standard interrupt; explain a coordinated warrior Spell Reflection as the optional alternative, without simultaneously depicting both succeeding. Do not copy the sheet’s old PvP-glove remark into a mandatory equipment requirement.

**Anger:** Show the sheet’s controlled opening tank handoff when two tanks exist, then one tank holding the boss away from the raid while damage waits for the threat call. Target changes cause Seethe; show its boss attack-speed cost. Public sources disagree about the precise opening sequence and the recipient of its threat effect. Do not promise that a taunt itself awards the taunting tank a threat buff, or display invented threat percentages. Teach the observable coordination: called pickup/handoff, tank survival, wait for stable threat, then commit. With one tank, show a single-tank pickup and a relevant note instead of inventing an off-tank.

Lust and offensive cooldowns belong in Anger after the opening is settled. Shadow pressure and raid damage increase over time. Soul Scream is frontal, with resource-dependent tank damage; show facing and resource management, without a fabricated damage calculator. Spite marks up to three real targets, grants a brief immunity window, then delivers a large Nature hit. Use the sheet/spell-backed six-second example, with top-up before and healing/healthstone recovery after. Spite is not a ground patch or a spread mechanic. Keep Shadow Protection and available healthstones in preparation reminders.

## Chapters

Each chapter opens independently and animated chapters hold their final frame. Positioning and overview are static. Every chapter has the same authored guidance fields as Akama.

| ID | Chapter | Visible teaching sequence |
|---|---|---|
| `overview` | Three essences | Suffering → souls → Desire → souls → Anger, with one rule per phase. |
| `positioning` | Pull & positions | Sheet formation with imported names; tanks in front, melee behind, ranged and healers within coverage. |
| `fixate` | Suffering · Share the damage | Receiving tank steps closest before the five-second selection; current tank steps back; boss target switches; lost HP stays lost. |
| `suffering` | Suffering · Drain & Enrage | Dispel the marked Soul Drain, show available absorb support and defensive preparation, then rotate through Enrage without healing. |
| `souls` | Intermission · Recover together | Essence withdraws; souls reach the group, are gathered and killed; nearby players recover health/mana. |
| `desire` | Desire · Damage comes back | Damage causes recoil, healers respond, and the maximum-mana ceiling shrinks. |
| `interrupts` | Desire · Shield off, then kick | Assigned Spirit Shock interrupt; Rune Shield appears; remove it; the next interrupter stops the following cast. |
| `deaden` | Desire · Handle Deaden | An assigned interrupt prevents the debuff; a warrior-reflect option is explained separately in the guidance. |
| `anger` | Anger · Secure the boss | Called opening tank handoff, Seethe warning and threat hold; boss faces away; Soul Scream demonstrates the unsafe front. |
| `spite` | Anger · Heal the marks, burn | Threat already established; Lust/offensive cooldowns, growing shadow pressure, marked Spite targets topped before impact and recovered afterward. |
| `cycle` | Put it together | All three essences in order, both soul recoveries, changing jobs and the final kill. Compress dead time, retain meaningful mechanic windows. |

Use short, readable motion with pauses around the decision in each independent lesson. The full cycle may be longer. Terra’s implementation plan will fix the authored millisecond timeline and assertions before coding; do not derive events from animation frame count or random choices.

## Roster, state and rendering contract

Create `tactics-reliquary-data.js`, `tactics-reliquary.js` and `tactics-reliquary-render.js`, using the established UMD pattern. Preserve `prepareScene(fight, scene, assigned)`, deterministic `simulate(fight, scene, timeMs)` and `copyText(fight, scene, frame)` interfaces.

Preparation clones scene data, preserves every imported name and role and respects main-tank order. Select mechanic participants from eligible actual players. No roster means a clearly labelled 25-player example with three tanks; a partial imported roster never receives fillers. Unknown class information must not become an asserted class utility. Missing tanks, healers, damage, interrupt coverage or dispellers produce specific notes. Do not animate a named player performing an ability their known class cannot use. The existing example-roster class policy needs explicit handling before selecting named utility demonstrations.

Frames carry active essence, phase/stage, current target, positions, health/resource illustration, current role jobs, cast/shield status, souls, debuffs and the current call. Encounter overlays derive from that frame. Copy text, copied image, the state label and on-screen instructions must agree with it, especially across soul transitions, Rune Shield removal and the opening Anger handoff.

Retain existing typography, role assets and boss rendering conventions. Distinguish essences with names and phase labels as well as art/color. Use focused overlays: target emphasis for Fixate, an absorb ring distinct from Rune Shield, approaching soul tokens, cast progress, a temporary frontal cone, and Spite badges. Avoid permanent rings and labels obscuring the compact room. Names stay in positioning; mechanics use short role labels as in the earlier bosses.

## Acceptance and review

Terra implements against the approved design and a written plan; Sol reviews the finished diff and any fixes. Verification covers:

- Nearest-player Fixate geometry and retained damage; no healing during Suffering; class-valid dispels/absorbs.
- Recovery caused by nearby soul deaths in both intermissions; phase-specific jobs and resource rules reset correctly.
- Linked Desire recoil; shrinking maximum mana; shield removal before successful interrupts; Deaden handling distinct from Spirit Shock.
- Anger facing, controlled target ownership, Seethe cost, Lust after threat establishment, Spite immunity/impact/recovery, and final completion.
- Direct seeks give the same frames as forward playback, do not mutate inputs, and handle partial/oversized rosters and missing utility honestly.
- Existing three bosses pass unchanged; new deep link and tab order work; all eleven chapters support playback, replay, seeking, speed, keyboard navigation, reduced motion and exports.
- Desktop and phone screenshots are visually inspected, particularly tank distance, soul gathering, casts/shield, frontal geometry and Spite labels.
- `npm test`, `npm run test:tactics-browser` and `git diff --check` pass after the implementation and review fixes.

No backend or assignment-engine changes, new dependencies, trash briefing, Teron work or release actions are included.
