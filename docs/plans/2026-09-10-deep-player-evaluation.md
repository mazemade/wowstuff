# Deep player evaluation

The report must answer what the player should change, when to change it, what evidence supports it, and the estimated improvement in their own setup. Culuneta's quantified Anetheron report is the initial acceptance case. The user explicitly permits replacing the current UX and constraints.

## Why the current report cannot do this

`vet-feedback.js` fetches damage/cast/buff tables and CombatantInfo. `vet-gap.js` decomposes aggregate differences and assigns remaining cast pacing and damage-per-cast differences to the player. `vet-checklist.js` converts those into fixed advice, including pressing the largest damaging ability more and checking talent/rank from unexplained hit damage. Its nominal consumable values are fixed percentages. Those are not controlled estimates of achievable DPS.

## New flow

1. Select a player and raid night. Start a background evaluation, return its job ID immediately, show progress, and support reopening the job.
2. Reuse the existing profile and reference discovery, retaining each actual reference's raw fight tables. Fetch paginated player events and incoming events. Incomplete evidence remains explicitly incomplete.
3. Analyze actual attack outcomes, contact gaps, control effects, buff coverage and cooldown windows. Use a named comparable reference and keep each boss separate. Never equate a difference in casts with an affordable missed cast.
4. For supported specs/encounters, construct a versioned simulation from recorded equipment and observed setup. Surface inferred talents, buff ranks and encounter assumptions. Compare input stats and verify that intended scenario actions really execute.
5. Run individual changes and combined packages. Report modeled DPS deltas, without summing overlapping packages or treating observed gap minus modeled gain as proven execution loss.
6. Present the next-raid action plan, personal versus raid support changes, gear options, observed comparison, event evidence and model limitations. Preserve useful findings if a simulation fails.

## Implementation boundaries

- `evaluation-evidence.js`: pure fight analysis; initial detailed Fury rules, safe shared facts elsewhere.
- `evaluation-sim.js` and `evaluation-sim/`: pinned WoWSims adapter, supported-model gate, controlled scenarios, bounded subprocess execution and reproducible build instructions.
- `evaluation-service.js`: evidence collection, reference retention and assembly; raw query caching with explicit completion semantics.
- `evaluation-jobs.js`: bounded background queue, coalescing, persisted results and same-origin API routes.
- `evaluation.html`, `.css`, `.js`: primary report experience; existing vetting links open this page. Legacy reports remain reachable for historical inspection.

This first implementation establishes detailed Fury evaluation. Other specs receive evidence-supported observations and an explicit simulation coverage message until their mechanics and models are validated. No surrogate-spec DPS estimates.

## Required correctness checks

- Recognize Heroic Strike 29707 as valid, Mighty Agility 28497 as a consumable, and Dragonstrike 21165 as a proc rather than a potion.
- Never infer rank, exact talent allocation, resource starvation/capping or avoidable movement from insufficient data.
- Culuneta's Anetheron has full Shout coverage and near-equal HS counts against Dakkone; Winterchill's Shout outage cannot explain Anetheron's gap.
- Merge overlapping control/contact intervals; do not count them twice.
- Missing data cannot become zero uses or absent buffs.
- Hold all unrelated simulation inputs constant; verify potion use and package membership, and show model/input disagreement.
- Preserve individual and party consequences of gear changes, especially Solarian's Sapphire.
- Retain an unexplained remainder without asserting it is luck or player error.
- Bound job concurrency and event pagination; deduplicate requests; allow failed jobs to retry without poisoning completed evidence.
- Validate pure analysis, simulation scenarios, job/API behavior and the report in a browser. Live WCL and simulator checks are separate from deterministic tests.

## Further coverage

Expand one spec at a time with reviewed mechanics and recorded regression cases. Add encounter-specific replay only where target availability and resource evidence support it. Optional prose generation may explain structured findings; it must never invent findings or DPS estimates. Learn from subsequent comparable pulls using the same evidence and model versions.
