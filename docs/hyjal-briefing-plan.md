# Hyjal briefings and raid selection

## Scope

Add all five Hyjal bosses to the shared guided Tactics presenter. The primary
source is the supplied Hyjal workbook and its embedded formation images. Keep
the existing Black Temple interactions and direct boss/chapter links working.

## Design

- `tactics.html` opens an image card for Black Temple and Mount Hyjal. A raid
  card opens that raid's boss list; a boss opens its briefing. Each briefing has
  a link back to its raid and tabs restricted to that raid.
- Use the shared Previous/Next, direct chapter selection, Replay, short/detail
  modes, Quick recap, imported roster and text/PNG export controls.
- Hyjal data and detailed steps register alongside existing encounters. A
  scene may author its own short briefing groups and mark reference chapters
  optional, preserving detailed source-step lookup during merged animations.
- Share simple Hyjal drawing helpers while giving each boss its own mechanics,
  formations, hazards and timed actions. Animation time is illustrative; Doom's
  lethal twenty-second deadline is explicitly represented.
- Retain the four eight-wave lists as optional reference. Archimonde has no
  preceding eight-wave event. Preserve original source images in references.

## Encounter checks

- Winterchill: frozen target stays put, immediate healing, Death and Decay exit,
  Frost Nova removal before movement, Frost Armor preparation.
- Anetheron: random-target cone and healing-output penalty, spread healer
  coverage, isolated Infernal spawn and threat pickup, Sleep and Vampiric Aura.
- Kaz'rogal: guild three-tank cleave stack throughout; mana users manage Mark,
  and an endangered player exits before detonation; backline avoids War Stomp.
- Azgalor: Doom death and remote Doomguard pickup; Rain within casting range,
  persistent burn after exit, five-second silence and tank survival coverage.
- Archimonde: Tears preparation and use on descent, loose groups, variable
  Doomfire trail, fear support, priority decurses, Soul Charge recovery, and the
  protected ending beginning at ten percent. PTR-only notes stay out of the
  default strategy.

## Validation

Run deterministic mechanic tests, shared registry tests, the repository suite,
and browser regression checks. Inspect raid cards and each boss on laptop
viewports, including source-frame boundaries, sparse imports, copied text/PNG,
deep links, reduced motion and completed states. Independently review mechanics
and integration. Preserve unrelated workspace artifacts; publication is outside
this implementation task.
