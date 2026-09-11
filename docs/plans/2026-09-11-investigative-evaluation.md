# Investigative player evaluation

## Product contract

The report must explain observed decisions, distinguish supported improvements from encounter constraints, preserve good play, and give a measurable next-raid plan. A damage difference is not an estimate of recoverable damage. No player-name branches, fabricated resource reconstruction, or compulsory mistakes.

## Architecture and ownership

1. **Evidence collection and identity (root):** preserve raw streams and completeness, exclude the same character across report uploads, select one consistent reference, and fetch bounded supplementary evidence only for relevant questions (pre-pull cooldown history and raid-wide mechanic damage).
2. **Encounter investigations (root):** correlate consumable aura bands, cooldown windows, fight end, active attacks, incoming control and damaging ground effects. Emit evidence, explanation, alternatives, action and verification rather than generic review instructions.
3. **Rogue decisions:** reconstruct Slice and Dice coverage at attacks, attributed poison expiry/consumption, Mutilate attempts, Envenom outcomes, Cold Blood retries and Deathmantle use. Preserve incomplete/unknown evidence.
4. **Shared spec decisions:** apply appropriate maintenance/target/control checks across the spec catalog, preserving healer/tank assignment limits. Publish inspected and unresolved decision coverage separately from raw telemetry coverage.
5. **Coaching composition and presentation:** deterministic evidence-grounded fight/night narratives, prioritized improvements, strengths and open questions. Keep estimates secondary and retain old saved-report/shared-link compatibility. This release does not depend on an external language-model service or invent claims through free-form generation. The structured finding contract supports a later constrained reasoning-model investigator.

## Finding contract

Existing `id`, `title`, `owner`, `action`, `evidence`, `confidence`, `category` and `priority` remain. Investigative findings add `why`, `verification`, `alternatives`, and `disposition` (`improve`, `keep`, `review`). Measured seconds/attacks are allowed; untested DPS recovery is not. Every recommendation must contain source evidence and a next-pull behavior. Unknown timing/target/control coverage must prevent absence claims.

## Acceptance cases

- Utopik Sep 10 Hyjal: delayed Archimonde Demonslaying, shortened Azgalor Brooch, FAP interval without raid stomp, poison expiry versus Envenom spend, SnD at actual attacks, CB dodge retry, free finisher use, independent comparison and no false resource/rotation verdict.
- Preserve Culuneta Fury and Varenthil Retribution execution/damage-accounting regressions.
- All class/spec entries publish honest decision coverage. Positive and negative role fixtures cover target switches, healing demand, controlled gaps, partial streams, and unknown assignments.
- Incomplete supplementary queries retain the report and expose unresolved questions; they never become zero events.
- App and shared page render/copy the same action plan; links and untrusted names are escaped, shared recipients retain no navigation or mutation controls.

## Validation and completion

Run focused unit/recorded-raid tests first, then the complete evaluation suite and browser suite, then repository tests and diff checks. Replay real raw captures through the production evidence/composition functions and inspect generated output. Obtain independent review of causal claims and security/presentation integration, fix findings, and rerun affected checks. Report exact implemented coverage and remaining limits; do not label all specs fully audited simply because they can be evaluated. Preserve unrelated workspace changes. No deployment is necessary to validate the implementation locally; any publication must preserve existing session authorization and report actual status.


## Verification result

Implemented the above deterministic pipeline, shared decision coverage, deeper rogue checks, retained Fury/Ret coaching, model guard, and main/shared report composition. All 28 declared specs explicitly retain partial decision coverage; this is not a claim of 28 fully validated expert evaluators. The optional external reasoning-model layer is not implemented in this release.

- `npm test`: passed, including existing Fury/Ret regressions and the new decision/coaching/recorded-raid acceptance suites.
- `npm run test:evaluation-browser`: passed, including the actual generated Utopik evidence report, copied plans, shared recipient view, mobile overflow, malformed input and legacy saved reports.
- Live WCL production build: all five Sep 10 Utopik kills collected and evaluated successfully, including bounded cooldown-history and raid-wide stomp follow-up queries. Final findings were replayed after review fixes against these captured live inputs.
- Independent Sol review: no remaining substantive correctness/product-acceptance findings in reviewed scope. Healing, Cold Blood, stacking DoTs, references, partial results and share/auth boundaries were checked.
- `git diff --check`: passed. Unrelated addon/profile/server workspace changes preserved.

Generated review for inspection: `output/utopik-deep-dive/product-final.md` and `.json`. Raw capture/replay artifacts stay local; projected recorded acceptance fixtures are under `fixtures/evaluation/`. Changes have not been pushed or deployed.
