# Deep player evaluation

Open `evaluation.html` from Vetting or directly. Enter a character and realm to evaluate the latest readable report, choose a ranked raid night, or paste a Warcraft Logs report/pull link. A report plus character name works without a realm if the name is unique; a report plus source ID selects the exact report actor. A selected fight may be a wipe. Without a selected fight, the evaluator reads every recorded boss kill; a report containing only wipes uses the latest attempt per boss.

The job runs in the background and can be reopened. Rankings are useful for finding DPS comparison players, but are not a prerequisite for analyzing a player. The player’s class, spec and role come from that pull, so a historical off-spec report is not evaluated using the latest character profile.

## What the report provides

- Preparation checks from actual equipment and buffs, with specific missing items and observed consumables.
- Cast counts, source-attributed effect windows and spec-specific activity. Cast starts/completions identify precise recast windows without pretending that every gap was avoidable.
- Named DPS comparisons with per-ability damage contributions, cast counts and critical outcomes. A descriptive damage difference is not a causal execution loss.
- A reconciled damage ledger includes both players' damage families, faction equivalents, reference-only abilities and offsets where this player did more damage. It shows each pull's outcome rate and mean damage separately, with any actor/ability-table residual left explicit.
- Execution priorities lead the report even when they have no simulated DPS number. Equipment and party-support scenarios follow as separately tested options; they do not explain the entire observed gap.
- Healer composition, healing-target and pre-death context, HoT activity and typed mana-restoration evidence. Low HPS and overheal alone are not failure criteria.
- Tank incoming-damage and defensive timing, death windows and assignment context. DTPS is not a lower-is-better score; TPS models do not grade survival.
- Separately simulated changes and combination packages where the model supports them. Individual gains and overlapping packages must not be added together.
- A per-pull coverage checklist: checked, unknown, or not applicable. Missing evidence does not become a zero, and an unverified opportunity does not become a DPS estimate.

All conclusions link back to the report/pull/player. Effect and cast windows retain timestamps. The observed comparison, changes under player control, raid support and unresolved context remain distinct.

## Class and role coverage

The vocabulary covers all 28 entries in the assignment tool:

| Class | Entries |
| --- | --- |
| Warrior | Arms, Fury, Protection |
| Paladin | Holy, Protection, Retribution |
| Hunter | Beast Mastery, Marksmanship, Survival |
| Rogue | Assassination, Combat, Subtlety |
| Priest | Discipline, Holy, Shadow |
| Shaman | Elemental, Enhancement, Restoration |
| Mage | Arcane, Fire, Frost |
| Warlock | Affliction, Demonology, Destruction |
| Druid | Balance, Feral Cat, Guardian/Bear, Restoration |

Feral Cat and Guardian are distinct role entries even though they share the TBC talent tree. WCL aliases are normalized. An unknown spec remains explicit; it is never silently treated as Fury or a different specialization.

There are WoWSims source templates for the 23 damage/tank entries; actionable simulation routes cover the 20 DPS entries. Tank coaching uses observed incoming damage and defensives, with no TPS or survival estimate until an incoming-damage/resource model is validated. Five routes—Fire/Frost Mage, Marksmanship Hunter, Assassination/Subtlety Rogue—require a detailed valid talent string because the pinned adapter has no validated default build for those specs. The remaining routes disclose any assumed source build. The five healer entries use role evidence rather than a fabricated HPS simulation. Model availability does not mean a given log will pass input validation.

The encounter catalog covers the nine TBC raids: Karazhan, Gruul, Magtheridon, SSC, TK, Hyjal, Black Temple, Zul’Aman and Sunwell. It identifies context that makes a stationary model conditional. It does not prove target availability, mechanic avoidability, assignments or boss armor. Unknown encounters retain shared observations and an explicit coverage limit.

## What an estimated gain means

A completed scenario is a controlled comparison with the same recorded equipment and an explicit build, rotation, race, buffs, consumables, duration and target model. Missing detailed talents and unrecorded configuration remain assumptions. A stationary target model is not an event replay or a reconstruction of the player’s decisions. Starting-stat validation is necessary but does not prove behavioral fidelity.

The original Culuneta Fury/Anetheron regression remains covered: 34 versus 35 Heroic Strike attempts and the 904.4-DPS historical comparison do not establish insufficient Heroic Strike presses. Rage telemetry does not prove affordability. Winterchill separately tests the 39-second Battle Shout gap and 12 seconds of Recklessness overlapping melee-event gaps.

Varenthil's Winterchill regression reconciles the full 1,052.6-DPS difference against Aboujudger. Seal of Blood and Seal of the Martyr previously failed to match by spell ID, omitting the largest damage-family difference (399.6 DPS). The ledger now matches these faction equivalents, uses both pull durations, and retains the negative Judgement of Command offset. Its frequency/yield split is a symmetric arithmetic identity using damage outcomes, not a model of recoverable mistakes. Missing count fields stay unknown. Both combatant snapshots, named equipment and gems provide context for differing damage per outcome.

The selected DPS reference now supplies fully paginated outgoing and incoming-debuff events as well as tables. Missing reference timing makes that part of the report partial and retryable. Retribution seal coverage does not generate a generic low-uptime warning: switching seals requires analysis at swing timestamps.

Retribution checks compare known Command-to-Blood/Martyr swaps around white swings, paired seal outcomes, reapplication after Judgement, Crusader Strike cadence, direct-melee gaps and cooldown overlap. Named hostile effects remain context; a mechanic-overlapped delay is not automatically a player mistake. Preparation models additionally test missing chest enchants and physical leg armor. Each equipment scenario must prove that the recorded slot was equipped and unenchanted, the intended enchant was applied, and the stats helper observed the expected direction of change.

No arbitrary percentage of the observed gap is assigned to execution, gear or raid support. Resource snapshots in the current WCL format are malformed; only explicitly typed resource-change amounts are summarized. An unexplained difference remains unexplained.

## Running locally

The existing server WCL credentials in `.env` or the process environment are used. Build the pinned simulator with Go, Git, Make and `protoc` installed:

```sh
npm run build:evaluation
npm start
```

The build installs its pinned Go protobuf generator in a temporary directory, then builds binaries with the embedded item database into ignored `evaluation-sim/vendor/`. Source assets carry the WoWSims MIT license in `evaluation-sim/LICENSE.wowsims`. `evaluation-sim/capabilities.json` and `evaluation-models.js` record the adapter routes and pinned source commit.

`nixpacks.toml` adds the simulator build to Railway/Nixpacks. A clean build was verified locally; Linux deployment still requires release verification. This implementation does not deploy the site.

## Runtime and persistence

- `WCL_SIM_ITERATIONS`: 10,000 by default, bounded from 200 to 10,000. Low iteration counts are for smoke checks; changing them changes the job fingerprint.
- `WCL_SIM_BIN` / `WCL_SIM_STATS_BIN`: optional managed binary paths; the simulator must match the pinned commit.
- `EVALUATION_CACHE_DIR`: private job/query cache, defaulting to the OS temporary directory. Use a persistent volume to retain it across deployments.
- One job runs at a time; four jobs may be running/queued. Individual simulator subprocesses are capped at 45 seconds. Event pagination and job duration are bounded.
- Request identity includes character/report/source/fight and model settings. Source/model changes invalidate completed job lookups. Successful WCL evidence is cached separately; malformed responses and failed requests remain retryable.
- Complete results last 24 hours. Partial/unavailable results have a shorter retry interval, and Rebuild can retry immediately. A restarted process can read completed jobs; interrupted jobs can be retried with cached query evidence.
- Multiple server replicas require a shared queue/locking implementation before scaling beyond one instance.

Completed simulations retain input requests, scenario hashes, seed, iterations and source version for reproduction. API credentials are never included in evaluation results.

## Validation

```sh
npm test
npm run test:evaluation-browser
WCL_SIM_SMOKE=1 node evaluation-sim.test.js
```

The suites cover all catalog entries, role semantics, unknown/partial evidence, cast-vs-hit counts, aura ownership, report actor selection, unranked/direct reports, wipes, more than eight boss kills, background-job deduplication, persistence, cache identity and browser rendering/copy/resumption. Real report captures are used for the Culuneta regression and cross-role validation. Native binary smoke tests establish that adapter inputs execute; they are not proof of live performance accuracy.

Mechanic evidence and limitations are documented in [evaluation-mechanics-sources.md](evaluation-mechanics-sources.md). Future rules should add source-checked mechanics and a regression showing both a legitimate observation and a nearby case where the rule must stay unknown.

## Sharing with a player and administrator access

Build an evaluation, then choose **Share with player**. The copied URL opens a separate,
read-only page containing a snapshot of that player's evaluated raid night, including boss
tabs, source evidence and copy controls. It contains no roster, site navigation, player
selector or rebuild controls. Anyone holding the unguessable link can read that snapshot;
changing query parameters cannot select another player. Later rebuilds do not alter it.

The main tool, its private APIs and other files require the administrator password configured
in `TOOL_ADMIN_PASSWORD` (minimum 12 characters). Set it as a deployment secret, never in
Git. Missing configuration closes administrator access. Sessions expire after 12 hours and
are invalidated by server restart; **Log out** ends the current session. Shared links remain
public without granting an administrator session. Login attempts are throttled.

Shared snapshots are independent of the evaluation job cache, engine version and its daily
expiry. Configure `EVALUATION_SHARE_DIR` on persistent storage, or mount a Railway volume:
`RAILWAY_VOLUME_MOUNT_PATH` automatically stores them under `evaluation-shares` on that
volume. Without either setting, local development uses the host temporary directory;
ephemeral deployments would lose their links. Keep deployment replicas at one while
administrator sessions and login throttles are process-local. Back up the share volume if
long-term retention is required. Removing a snapshot file revokes that link.


## Investigative coaching (engine 3)

The report now starts with a night action plan and encounter coaching. Each established change carries the observed event, explanation, next-pull behavior, verification target, alternatives, and source evidence. Good decisions and unresolved observations are separate. Modeled options remain separately labelled; their linked facts are not simultaneously shown as unresolved coaching questions. Old saved reports still render, and shared snapshots remain immutable.

The production pipeline selects independent characters across uploads, collects complete player streams, and requests supplementary evidence when relevant. On-use trinket checks query a bounded pre-pull history; Kaz'rogal potion checks use raid-wide War Stomp damage; healer response checks request raid damage separately from player debuffs. Each supplemental query permits at most three pages. Failure preserves the report and marks dependent coverage unknown. Rogue cadence comparisons use up to three independent event-backed examples; other roles collect only their primary comparison's timing.

### Actual decision coverage

| Area | Implemented review | Limits |
| --- | --- | --- |
| Every supported spec | Observed mechanic families, safe target/control-aware activity review, utility, preparation, independent comparison | Spell observation is telemetry, not full decision coverage; exact resources, talents and assignments remain unresolved |
| Selected fixed-duration DoTs | Source/target refresh timing and natural expiry followed by concurrent direct activity | Stacking/consumed effects are excluded; Moonfire is excluded because set bonuses change its duration; Rip is fixed at 12 seconds in the pinned source |
| Rogues | White outcomes in SnD bands, mid-fight refresh opportunities, own poison stack expiry and recovery, Mutilate parent attempts, Envenom damage outcomes, Cold Blood consumption clusters, Deathmantle finisher use, named reference cadence and finisher offsets | No exact combo-point/energy reconstruction or universal finisher prescription; immediate poison reapplication is review context rather than a top-priority mistake |
| Fury | Existing recorded Shout/contact/cooldown evidence and validated equipment scenarios retained in coaching | No instruction to spend rage that the log cannot establish was available |
| Retribution | Existing seal-at-swing, post-Judgement resealing and twist evidence retained as coaching | Mana, target access and intended twisting still constrain advice |
| Healers | Scoped raid damage, positive effective-heal response, health-deficit timing where fields exist | No HPS ranking or blame for targets without an established assignment; WCL `amount` already excludes overheal |
| Tanks | Repeated incoming auto outcomes against observed defensive aura bands | No inferred charges, cooldown availability, mitigation requirement or DTPS ranking |
| Relevant Hyjal encounters | Late observed Demonslaying application, on-use truncation, FAP/stomp overlap, repeated direct Rain of Fire, recognized control overlaps | Unknown positioning and assignments remain open questions; no automatic DPS attribution |

This is a deterministic investigative release. It makes bounded follow-up queries and composes verified findings; it does not call an external language model. Every spec reports partial decision coverage rather than claiming that recognizing its spells is a complete expert review. A future reasoning-model layer can request validated investigations through the same evidence contract, but is not required to produce the current action plans.

Assassination simulated gains are withheld even with detailed talent input: the current APL does not validate poison/Rupture/Envenom decisions. Event-backed coaching remains fully available. Other existing simulation routes retain their model/input limitations.

### Acceptance and maintenance

`evaluation-acceptance.test.js` replays projected real Utopik raid evidence through production evidence/composition functions and protects the Culuneta and Varenthil coaching regressions. `evaluation-browser.test.mjs` renders the same recorded Utopik report and checks action-plan copying and the recipient page. The captured fixture is a field projection, not generated gameplay; its report/date provenance is retained. Tests do not require ignored `output/` captures.

Run `npm run test:evaluation`, `npm run test:evaluation-browser`, and `npm test`. Never promote a new rule on counts alone: add a nearby counterexample for partial data, legitimate consumption, control, assignment or target access. Regenerate saved evaluations to use a new engine; existing shared snapshots intentionally retain the assessment originally shared.

## Action-first coaching (engine 4)

The default encounter view presents the action, the recorded pattern behind it, why it matters, how to execute it, and what to check next pull. Damage accounting, legacy observations, comparison tables, timelines, coverage and model diagnostics are optional background details. The same presentation and copy plan are used by the administrator and saved recipient views. An encounter with actionable coaching is preferred over one selected only because a simulation completed.

Findings can supply an imperative `actionTitle`, with the original `title` retained as `coaching.observed`. `basis: practice` distinguishes a conditional training plan from a confirmed correction. Practice is not a mechanism for converting every review observation into a mistake: it requires an explicit bounded rule, source evidence and conditions in the advice. The composition layer still refuses to manufacture actions, resource values or DPS gains. Night aggregation retains per-boss advice and uses the strongest priority example for recurring themes.

Hunter analysis now inspects combat-pet deaths, incoming damage before death, return to positive pet damage, shared player/pet opening deaths, Bestial Wrath cut short by pet death, same-target Auto/Steady recovery windows and Kill Command opportunities. Kill Command critical strikes refresh one opportunity; casts consume it and start its cooldown. Only expired, cooldown-ready intervals with active combat-pet damage survive the evidence filters. Pet death and cooldown consequences are one coaching theme, not additive DPS losses. Combat-pet identity comes from the source-scoped Call Pet composite, checked against available ownership, so traps cannot stand in for the pet.

Funkell's recorded Sept 10 Hyjal fixture protects specific actions: Azgalor/Archimonde pet survival and recovery, Winterchill opening survival, five Kaz'rogal Auto/Steady recovery windows, and two Kaz'rogal Kill Command expiry intervals (51.8–55.7 and 79.1–86.1 seconds). Malformed Classic resource records do not establish mana, affordability or lost casts; shot/command advice remains conditional practice. Feign Death, foreign pets, owned traps, control, incomplete streams, valid low-mana counterexamples and proc refresh/consumption have regressions. No player-name branch selects these rules.

Pet damage comparison groups differently named pets into one family without summing composite children twice. All classes also receive actionable preparation findings for known unenchanted equipment and empty gem sockets, without assuming a universally optimal enhancement.

This adds dedicated hunter decision coverage to the existing rogue, Fury and Retribution analysis. The common layout applies to every class; recognizing a specialization's spells still does not mean complete specialization expertise. There is no claim that every DPS difference is recoverable or that every class has equal decision depth. Add real positive and legitimate-exception fixtures when expanding a specialization, and evaluate the player-facing action plan, not merely the number of checks.
