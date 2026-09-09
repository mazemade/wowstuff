# Raid recruitment recommendations

Add a local, deterministic invite planner to the Assignments page, immediately after
the imported roster. Existing players remain fixed; recommendations never become
fake roster members. A 20-player roster produces five suggested invites for a
25-player raid, updated after imports, edits, removals and main-tank changes.

## Design

- Select General 25-player, Black Temple, Mount Hyjal, SSC, Tempest Keep, Gruul or
  Magtheridon. Use conservative full-clear planning defaults, with editable tank
  and healer targets because gear and strategy change those needs.
- Show current/projected tank, healer and DPS totals, the remaining slots, and an
  ordered list of class/spec/role recommendations with specific reasons.
- Fill role shortages, account for encounter specialist classes, then improve
  missing raid utility and party support with diminishing returns. Re-evaluate
  after each proposed invite so five recommendations form one composition.
  Recheck the completed proposal with bounded substitutions within each role to
  remove overlapping benefits. This is a local heuristic, not a global optimum.
- Treat unknown or ambiguous specs as unresolved, respect declared main tanks,
  and explain that addon Feral needs a bear/cat decision. Show unresolved shortages
  even on full/over-cap rosters; do not recommend removals or silently respec people.
- Label this as composition advice assuming comparable gear/skill and standard
  raid talents, not a simulated DPS optimum. Anniversary Bloodlust is raid-wide;
  extra shamans need party-totem/healing justification.
- Keep recommendations separate from assignment exports; offer their own copy
  text button. Persist raid/target settings in the existing state.

## Implementation and checks

1. Terra implements a separate browser/Node recruitment engine with behavior tests.
2. Parent implements the compact dark/gold UI and browser interaction regression
   tests while checking strategy references and integration.
3. Sol independently reviews the completed feature. Address substantive findings,
   run npm test and the feature browser suite, syntax and whitespace checks.

Do not touch existing unrelated untracked files or publish without a request.

## Model boundaries

Raid targets are editable planning defaults. Profile sources support encounter jobs
and class mechanics, not an exact mathematical optimum or universal tank/healer count.
Class abilities remain available when a spec is unknown; spec buffs require a known
spec or a positive scanned talent. An unknown spec still has no assumed combat role.
Party support assumes players can be regrouped; providers do not count themselves as
extra beneficiaries. The group layout optimizer is a separate step after real invites.
