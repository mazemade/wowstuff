'use strict';

// Event-backed decisions shared by every declared spec.  This deliberately does not turn
// spell counts, resource pools, HPS, or DTPS into a universal rotation target.
const { resolveSpec } = require('./evaluation-specs.js');
const { controlBands } = require('./evaluation-investigation.js');
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const spellId = (event) => Number(event?.abilityGameID ?? event?.ability?.guid ?? event?.guid);
const body = (table) => table?.data || table || {};
const rows = (table) => (Array.isArray(body(table).entries) ? body(table).entries : []);
const round = (value) => (finite(value) ? Math.round(value * 10) / 10 : null);
const fightOf = (raw) => raw.context?.fights?.find((fight) => fight.id === raw.fightId) || raw.context?.fights?.[0];
const urlOf = (raw) =>
    raw.reportCode && raw.fightId != null && raw.sourceId != null
        ? 'https://classic.warcraftlogs.com/reports/' +
          encodeURIComponent(raw.reportCode) +
          '#fight=' +
          encodeURIComponent(raw.fightId) +
          '&source=' +
          encodeURIComponent(raw.sourceId)
        : undefined;

function analyzeDecisions(raw = {}) {
    const spec = resolveSpec(raw.player);
    const fight = fightOf(raw);
    const start = fight?.startTime,
        end = fight?.endTime;
    const duration = finite(start) && finite(end) && end > start ? (end - start) / 1000 : null;
    const ownComplete = raw.events?.complete && Array.isArray(raw.events.data);
    const own = ownComplete
        ? raw.events.data
              .filter((event) => event.sourceID === raw.sourceId && event.timestamp >= start && event.timestamp <= end)
              .sort((a, b) => a.timestamp - b.timestamp)
        : null;
    const findings = [],
        checks = [],
        comparison = [],
        timeline = [],
        limitations = [];
    const reviewed = [],
        unresolved = [],
        telemetryObserved = [];
    const evidence = (text, from, to) => ({
        text,
        ...(finite(from) ? { startSec: round(from) } : {}),
        ...(finite(to) ? { endSec: round(to) } : {}),
        ...(urlOf(raw) ? { url: urlOf(raw) } : {}),
    });
    const add = (
        id,
        title,
        owner,
        confidence,
        action,
        records,
        why,
        verification,
        alternatives,
        disposition = 'review',
        priority = 'medium',
    ) => {
        findings.push({
            id,
            title,
            category: 'execution',
            priority,
            owner,
            confidence,
            action,
            evidence: records,
            why,
            verification,
            alternatives,
            disposition,
        });
    };
    const check = (id, label, status, reason) => checks.push({ id, label, status, reason });
    const at = (event) => (event.timestamp - start) / 1000;

    if (!spec) {
        limitations.push('No supported declared TBC spec was available, so spec decision coverage cannot be selected.');
        return {
            findings,
            checks,
            comparison,
            timeline,
            limitations,
            depth: {
                status: 'unresolved',
                reviewed,
                unresolved: ['Declare a supported class and spec to select observable decisions.'],
            },
        };
    }

    // Every catalog mechanic gets an explicit disposition. A logged cast/row proves observation,
    // not that its talent was selected or that it should have been used more often.
    for (const mechanic of spec.mechanics) {
        const ids = new Set([...(mechanic.spellIds || [mechanic.spell]), ...(mechanic.auraIds || [])]);
        const table = mechanic.kind === 'cast' || mechanic.kind === 'cooldown' ? raw.tables?.casts : raw.tables?.dmg;
        const tableSeen = rows(table).some((row) => ids.has(spellId(row)) && finite(row.total) && row.total > 0);
        const eventSeen =
            own &&
            own.some(
                (event) =>
                    ids.has(spellId(event)) &&
                    ['cast', 'damage', 'miss', 'applybuff', 'refreshbuff', 'applydebuff', 'refreshdebuff'].includes(
                        event.type,
                    ),
            );
        if (tableSeen || eventSeen) {
            telemetryObserved.push(mechanic.id);
            check(
                'decision-' + mechanic.id,
                mechanic.label + ' observed',
                'checked',
                'Recorded on this pull. Its count is context for replay, not a target or talent inference.',
            );
        } else if (ownComplete) {
            unresolved.push(
                mechanic.label +
                    ' was not observed; the event stream cannot distinguish an unselected talent, assignment choice, target immunity, or omitted table family.',
            );
            check(
                'decision-' + mechanic.id,
                mechanic.label + ' decision evidence',
                'unknown',
                'Not observed in complete outgoing events; no missing-use conclusion is made.',
            );
        } else {
            unresolved.push(mechanic.label + ' needs complete outgoing events for decision analysis.');
            check(
                'decision-' + mechanic.id,
                mechanic.label + ' decision evidence',
                'unknown',
                'Outgoing event collection is incomplete.',
            );
        }
    }

    // Aura bands are displayed as observed timing context only. They are never converted into an
    // uptime target, because target switching, assignments, and cooldown availability differ.
    const auraRows = body(raw.tables?.buffs).auras;
    if (Array.isArray(auraRows) && finite(start) && finite(duration)) {
        const known = new Map(
            spec.mechanics.flatMap((mechanic) =>
                [...(mechanic.spellIds || [mechanic.spell]), ...(mechanic.auraIds || [])].map((id) => [
                    Number(id),
                    mechanic.label,
                ]),
            ),
        );
        for (const row of auraRows) {
            const label = known.get(spellId(row));
            if (!label || !Array.isArray(row.bands)) continue;
            for (const band of row.bands) {
                if (!finite(band.startTime) || !finite(band.endTime) || band.endTime <= band.startTime) continue;
                timeline.push({
                    label,
                    startSec: round(Math.max(0, (band.startTime - start) / 1000)),
                    endSec: round(Math.min(duration, (band.endTime - start) / 1000)),
                    kind: 'observed-aura',
                });
            }
        }
    }

    if (!ownComplete || !duration) {
        limitations.push(
            'Complete outgoing events and valid fight bounds are required for target, refresh, and cast decisions.',
        );
    } else {
        const controls = raw.incoming?.complete ? controlBands(raw) : null;
        const overlapsControl = (from, to) =>
            controls && controls.some((control) => control.start < to && control.end > from);

        // A refresh is called out only when the preceding application for that exact source/spell/target
        // has a fixed duration in the catalog and the stream does not record its removal.
        for (const mechanic of spec.mechanics.filter((item) => item.kind === 'dot' && finite(item.duration))) {
            const ids = new Set(mechanic.auraIds || mechanic.spellIds || [mechanic.aura]);
            const active = new Map(),
                clips = [],
                naturalRemovals = [];
            for (const event of own.filter(
                (event) =>
                    ids.has(spellId(event)) && ['applydebuff', 'refreshdebuff', 'removedebuff'].includes(event.type),
            )) {
                const key = String(event.targetID ?? 'unknown');
                if (event.type === 'removedebuff') {
                    const previous = active.get(key),
                        elapsed = previous && (event.timestamp - previous.timestamp) / 1000;
                    if (previous && Math.abs(elapsed - mechanic.duration) <= 1)
                        naturalRemovals.push({ previous, removed: event });
                    active.delete(key);
                    continue;
                }
                const previous = active.get(key);
                if (previous && event.type === 'refreshdebuff') {
                    const elapsed = (event.timestamp - previous.timestamp) / 1000;
                    const remaining = mechanic.duration - elapsed;
                    if (remaining >= 3) clips.push({ previous, event, remaining });
                }
                active.set(key, event);
            }
            reviewed.push(mechanic.id + ' refresh timing');
            check(
                'dot-refresh-' + mechanic.id,
                mechanic.label + ' refresh timing',
                'checked',
                clips.length
                    ? clips.length +
                          ' refresh' +
                          (clips.length === 1 ? '' : 'es') +
                          ' had at least 3 seconds of the recorded fixed duration remaining.'
                    : 'No unambiguous early refresh was found for the recorded fixed duration.',
            );
            if (clips.length)
                add(
                    'dot-refresh-' + mechanic.id,
                    mechanic.label + ' refreshed with recorded time remaining',
                    'player',
                    'observed',
                    'If the target will live, let this application finish; keep the overwrite only for a recorded assignment, target loss, or effect that must be refreshed.',
                    clips
                        .slice(0, 4)
                        .map((item) =>
                            evidence(
                                mechanic.label +
                                    ' refreshed with ' +
                                    round(item.remaining) +
                                    ' seconds remaining on target ' +
                                    item.event.targetID +
                                    '.',
                                at(item.previous),
                                at(item.event),
                            ),
                        ),
                    'The same player refreshed the same recorded debuff before its fixed base duration could expire, replacing remaining periodic ticks unless a legitimate overwrite applied.',
                    'Confirm the target stayed valid and that no mechanic, stack rule, or planned overwrite justified the refresh.',
                    [
                        'Keep the refresh if the target was about to become unavailable.',
                        'Improve the timing if replay shows no target or assignment reason.',
                    ],
                    'review',
                );
            const applications = own
                .filter((event) => ids.has(spellId(event)) && ['applydebuff', 'refreshdebuff'].includes(event.type))
                .sort((a, b) => a.timestamp - b.timestamp);
            const lapses =
                controls &&
                naturalRemovals
                    .map((item) => ({
                        ...item,
                        next: applications.find(
                            (event) =>
                                event.targetID === item.removed.targetID && event.timestamp > item.removed.timestamp,
                        ),
                    }))
                    .filter(
                        (gap) =>
                            gap.next &&
                            gap.next.timestamp - gap.removed.timestamp >= 3000 &&
                            !overlapsControl(gap.removed.timestamp, gap.next.timestamp),
                    )
                    .filter((gap) =>
                        own.some(
                            (event) =>
                                event.targetID === gap.next.targetID &&
                                event.timestamp > gap.removed.timestamp &&
                                event.timestamp < gap.next.timestamp &&
                                !event.tick &&
                                !event.isTick &&
                                ['cast', 'damage', 'miss'].includes(event.type),
                        ),
                    );
            if (lapses?.length)
                add(
                    'dot-gap-' + mechanic.id,
                    mechanic.label + ' lapsed during recorded same-target activity',
                    'player',
                    'observed',
                    'Keep ' +
                        mechanic.label +
                        ' active when that target will live and the assignment permits it; first verify the target was not immune or reserved for another debuff.',
                    lapses
                        .slice(0, 4)
                        .map((gap) =>
                            evidence(
                                mechanic.label +
                                    ' was removed at its recorded base duration, then remained absent for ' +
                                    round((gap.next.timestamp - gap.removed.timestamp) / 1000) +
                                    ' seconds while activity continued on target ' +
                                    gap.next.targetID +
                                    '.',
                                at(gap.removed),
                                at(gap.next),
                            ),
                        ),
                    'The effect has a recorded removal at its fixed duration, same-target activity continued afterward, and complete recognized-control bands do not overlap the interval.',
                    'Verify target lifetime, immunity, debuff assignment, and encounter holds before changing the sequence.',
                    [
                        'Keep the gap if the target was about to die or debuff ownership required it.',
                        'Improve maintenance if replay confirms the target remained valid.',
                    ],
                    'improve',
                );
        }

        const activity = own.filter(
            (event) =>
                event.targetID != null &&
                ['cast', 'damage', 'miss'].includes(event.type) &&
                event.targetID !== raw.sourceId,
        );
        const gaps = [];
        for (let index = 1; index < activity.length; index++) {
            const before = activity[index - 1],
                after = activity[index];
            const seconds = (after.timestamp - before.timestamp) / 1000;
            if (seconds >= 6 && before.targetID === after.targetID) gaps.push({ before, after, seconds });
        }
        const clean = controls ? gaps.filter((gap) => !overlapsControl(gap.before.timestamp, gap.after.timestamp)) : [];
        if (controls) reviewed.push('same-target activity windows');
        check(
            'same-target-activity',
            'Same-target activity windows',
            controls ? 'checked' : 'unknown',
            !controls
                ? 'Complete recognized-control bands are required before an activity gap can be called unexplained.'
                : clean.length
                  ? clean.length +
                    ' same-target gap' +
                    (clean.length === 1 ? '' : 's') +
                    ' had no recorded control application.'
                  : 'No same-target activity gap met the conservative review threshold without recorded control.',
        );
        if (clean.length)
            add(
                'same-target-activity',
                'Review sustained same-target activity gaps',
                'context',
                'observed',
                'Check target availability, movement, range and assignment in these windows. The log does not identify avoidable downtime.',
                clean
                    .slice(0, 4)
                    .map((gap) =>
                        evidence(
                            round(gap.seconds) +
                                ' seconds between recorded activity on target ' +
                                gap.before.targetID +
                                '.',
                            at(gap.before),
                            at(gap.after),
                        ),
                    ),
                'The player resumed recorded cast, damage, or miss activity on the same target after a long gap, with no recorded control application in the interval.',
                'Verify the replay for target immunity, movement, dead time, range, and encounter holds.',
                [
                    'Keep the hold if encounter timing required it.',
                    'Improve re-engagement if the target was available throughout.',
                ],
                'review',
            );

        let begun = null;
        const pairs = [];
        for (const event of own) {
            const id = spellId(event);
            if (event.type === 'begincast') begun = event;
            else if (
                event.type === 'cast' &&
                begun &&
                id === spellId(begun) &&
                event.targetID === begun.targetID &&
                event.targetID != null
            ) {
                if (event.timestamp > begun.timestamp) pairs.push({ begin: begun, end: event, id });
                begun = null;
            } else if (
                event.type === 'cast' ||
                /^(interrupt|interruptcast|cancelcast|castcancel|castfailed)$/.test(event.type || '')
            )
                begun = null;
        }
        if (pairs.length >= 2 && controls) {
            const chainGaps = [];
            for (let index = 1; index < pairs.length; index++) {
                const previous = pairs[index - 1],
                    next = pairs[index],
                    seconds = (next.begin.timestamp - previous.end.timestamp) / 1000;
                if (
                    previous.id === next.id &&
                    previous.end.targetID === next.begin.targetID &&
                    seconds > 0.25 &&
                    seconds < 8 &&
                    !overlapsControl(previous.end.timestamp, next.begin.timestamp)
                )
                    chainGaps.push({ previous, next, seconds });
            }
            reviewed.push('cast-chain windows');
            check(
                'cast-chain-decision',
                'Cast-chain windows',
                'checked',
                chainGaps.length
                    ? chainGaps.length + ' same-spell cast-chain review windows without recorded control.'
                    : 'No same-spell cast-chain delay required review.',
            );
            if (chainGaps.length)
                add(
                    'cast-chain-decision',
                    'Review same-spell cast chaining',
                    'context',
                    'observed',
                    'Check movement, target access and the chosen spell sequence before tightening these starts. This does not assume a universal energy, mana, or GCD rule.',
                    chainGaps
                        .slice(0, 4)
                        .map((gap) =>
                            evidence(
                                round(gap.seconds) + ' seconds from completion to the next same-spell cast start.',
                                at(gap.previous.end),
                                at(gap.next.begin),
                            ),
                        ),
                    'Matched begin-cast and completion events show a delay before the next cast of that spell, without a recorded control application.',
                    'Verify cast time, latency, movement, target state, and any planned sequence change in replay.',
                    [
                        'Keep the delay if the next cast was intentionally held.',
                        'Improve queueing only if the replay shows an available target and intended cast.',
                    ],
                    'review',
                );
        } else
            check(
                'cast-chain-decision',
                'Cast-chain windows',
                'unknown',
                !controls
                    ? 'Complete recognized-control bands are required before cast-chain delays can be interpreted.'
                    : 'Fewer than two matched same-target begin-cast/completion pairs were recorded.',
            );
    }

    if (spec.role === 'healer') {
        const raidDamage = raw.investigation?.raidDamage;
        if (!raidDamage?.complete || raidDamage.scope !== 'raid' || !Array.isArray(raidDamage.data) || !ownComplete) {
            unresolved.push(
                'Healing response needs dedicated complete raid-damage investigation data and complete outgoing healing events; HPS is not used as a substitute.',
            );
            check(
                'healing-demand-coverage',
                'Healing demand coverage',
                'unknown',
                'Dedicated complete raid-damage investigation data and outgoing healing events are required.',
            );
        } else {
            const damage = raidDamage.data.filter(
                (event) => event.type === 'damage' && event.targetID != null && finite(event.amount),
            );
            // WCL HealingEvent.amount already excludes overheal. Subtracting it again
            // would discard effective responses when an overheal is larger than the heal.
            const effective = (event) => (finite(event.effectiveHealing) ? event.effectiveHealing : event.amount);
            const heals = own.filter(
                (event) =>
                    ['heal', 'absorbed'].includes(event.type) &&
                    event.targetID != null &&
                    finite(effective(event)) &&
                    effective(event) > 0,
            );
            const covered = damage.filter((hit) =>
                heals.some(
                    (heal) =>
                        heal.targetID === hit.targetID &&
                        heal.timestamp >= hit.timestamp &&
                        heal.timestamp <= hit.timestamp + 5000,
                ),
            );
            check(
                'healing-demand-coverage',
                'Recorded healing response to damage',
                'checked',
                damage.length +
                    ' raid health-damage events; ' +
                    covered.length +
                    ' had this player’s heal/absorb within five seconds.',
            );
            comparison.push({
                name: 'Recorded damage events followed by this healer',
                player: covered.length,
                reference: damage.length,
                unit: 'events',
                note: 'Assignment, other healers, range and overheal are not inferred.',
            });
            if (damage.length && covered.length)
                add(
                    'healing-demand-coverage',
                    'Recorded healing covered active damage windows',
                    'player',
                    'observed',
                    'Keep reviewing these assignment windows with the other healers; this is response evidence, not an HPS ranking.',
                    covered
                        .slice(0, 3)
                        .map((hit) =>
                            evidence(
                                'A heal or absorb followed recorded damage to target ' +
                                    hit.targetID +
                                    ' within five seconds.',
                                at(hit),
                                at(hit) + 5,
                            ),
                        ),
                    'A dedicated complete raid-damage stream shows damage followed by this player’s positive heal or absorb on the same target.',
                    'Review assignments and other-healer coverage before drawing conclusions from uncovered events.',
                    [
                        'Keep this response pattern when it matched assignment.',
                        'Review uncovered windows with the healing team.',
                    ],
                    'keep',
                    'low',
                );
            const deficitResponses = damage
                .map((hit) => {
                    const deficit =
                        finite(hit.maxHitPoints) && finite(hit.hitPoints) ? hit.maxHitPoints - hit.hitPoints : null;
                    const response = heals.find(
                        (heal) =>
                            heal.targetID === hit.targetID &&
                            heal.timestamp >= hit.timestamp &&
                            heal.timestamp <= hit.timestamp + 5000,
                    );
                    return { hit, deficit, response };
                })
                .filter((item) => item.response && item.deficit > 0);
            if (deficitResponses.length) {
                const latency = deficitResponses.map((item) => (item.response.timestamp - item.hit.timestamp) / 1000);
                const average = latency.reduce((sum, value) => sum + value, 0) / latency.length;
                reviewed.push('healer effective response timing');
                check(
                    'healer-effective-response',
                    'Effective healing response timing',
                    'checked',
                    deficitResponses.length +
                        ' recorded health-deficit events had this healer’s positive effective response; mean latency ' +
                        round(average) +
                        ' seconds.',
                );
                comparison.push({
                    name: 'Mean effective-heal response after recorded deficit',
                    player: round(average),
                    reference: null,
                    unit: 'seconds',
                    note: 'Only events with recorded target health deficit and positive effective healing are included.',
                });
                add(
                    'healer-effective-response',
                    'Positive effective heals followed recorded health deficits',
                    'player',
                    'observed',
                    'Keep this response timing aligned with assignment and triage; it measures only recorded deficits and effective heals, never an HPS grade.',
                    deficitResponses
                        .slice(0, 4)
                        .map((item) =>
                            evidence(
                                round((item.response.timestamp - item.hit.timestamp) / 1000) +
                                    ' seconds after target ' +
                                    item.hit.targetID +
                                    ' had a recorded ' +
                                    item.deficit +
                                    ' health deficit, this healer supplied ' +
                                    round(effective(item.response)) +
                                    ' effective healing.',
                                at(item.hit),
                                at(item.response),
                            ),
                        ),
                    'Dedicated raid damage records a target health deficit and this player later supplies a positive effective heal on that target.',
                    'Check assignment, range, other heals, and whether the health fields are complete before comparing response timing.',
                    [
                        'Keep the response if it matched triage.',
                        'Review only with complete target-health and assignment context.',
                    ],
                    'keep',
                    'low',
                );
            } else
                check(
                    'healer-effective-response',
                    'Effective healing response timing',
                    'unknown',
                    'Recorded target health deficits and positive effective heals are both required; missing responses are not judged.',
                );
        }
    }

    if (spec.role === 'tank') {
        const taken =
            raw.damageTakenEvents?.complete && Array.isArray(raw.damageTakenEvents.data)
                ? raw.damageTakenEvents.data.filter(
                      (event) => event.targetID === raw.sourceId && event.type === 'damage' && finite(event.amount),
                  )
                : null;
        if (!taken) {
            unresolved.push(
                'Tank decision coverage needs complete health-damage events; DTPS is not used as a ranking.',
            );
            check(
                'tank-demand-windows',
                'Tank damage windows',
                'unknown',
                'Complete incoming health-damage events are required.',
            );
        } else {
            const bursts = taken.filter(
                (event, index) => index > 0 && event.timestamp - taken[index - 1].timestamp <= 3000,
            );
            check(
                'tank-demand-windows',
                'Tank damage windows',
                'checked',
                taken.length +
                    ' health-damage events, including ' +
                    bursts.length +
                    ' events within three seconds of a prior hit.',
            );
            if (bursts.length)
                add(
                    'tank-demand-windows',
                    'Recorded incoming damage formed active tank windows',
                    'context',
                    'observed',
                    'Review mitigation, healer coverage and encounter timing together. This observation does not assign fault or rank DTPS.',
                    bursts
                        .slice(0, 3)
                        .map((event) =>
                            evidence(
                                'Recorded health damage of ' +
                                    event.amount +
                                    ' followed another hit within three seconds.',
                                at(event) - 3,
                                at(event),
                            ),
                        ),
                    'Complete incoming events show clustered health damage on the tank.',
                    'Verify mitigation auras, healer assignment, boss mechanics and absorbs in replay.',
                    [
                        'Keep the plan if coverage matched the burst.',
                        'Review defensive timing with the tank and healers.',
                    ],
                    'review',
                    'low',
                );
        }
        const defensive = spec.mechanics.filter((mechanic) =>
            ['shield-block', 'holy-shield', 'barkskin'].includes(mechanic.id),
        );
        const auraRows = body(raw.tables?.buffs).auras;
        if (!taken || !Array.isArray(auraRows))
            check(
                'tank-defensive-timing',
                'Observed defensive coverage',
                'unknown',
                'Incoming health-damage events and defensive aura bands are required.',
            );
        else {
            const autos = taken.filter((event) => [1, 6603].includes(spellId(event)) && event.sourceID != null);
            const attacksByBoss = new Map();
            for (const hit of autos) attacksByBoss.set(hit.sourceID, (attacksByBoss.get(hit.sourceID) || 0) + 1);
            const boss = [...attacksByBoss].sort((left, right) => right[1] - left[1])[0]?.[0];
            const bossAutos = autos.filter((event) => event.sourceID === boss);
            const bands = defensive.flatMap((mechanic) =>
                auraRows
                    .filter(
                        (row) =>
                            (mechanic.auraIds || mechanic.spellIds || []).includes(spellId(row)) &&
                            Array.isArray(row.bands),
                    )
                    .flatMap((row) =>
                        row.bands
                            .filter(
                                (band) =>
                                    finite(band.startTime) && finite(band.endTime) && band.endTime > band.startTime,
                            )
                            .map((band) => ({ mechanic, start: band.startTime, end: band.endTime })),
                    ),
            );
            if (bossAutos.length < 2 || !bands.length)
                check(
                    'tank-defensive-timing',
                    'Observed defensive coverage',
                    'unknown',
                    bossAutos.length < 2
                        ? 'Fewer than two incoming auto outcomes from the same identifiable boss source were recorded.'
                        : 'No supported defensive aura bands were recorded.',
                );
            else {
                const covered = bossAutos.filter((hit) =>
                    bands.some((band) => hit.timestamp >= band.start && hit.timestamp < band.end),
                );
                reviewed.push('tank defensive aura timing');
                check(
                    'tank-defensive-timing',
                    'Observed defensive coverage',
                    'checked',
                    covered.length +
                        ' of ' +
                        bossAutos.length +
                        ' recorded auto outcomes from source ' +
                        boss +
                        ' occurred during a supported defensive aura band.',
                );
                comparison.push({
                    name: 'Boss auto outcomes during supported defensive aura',
                    player: covered.length,
                    reference: bossAutos.length,
                    unit: 'outcomes',
                    note: 'Observed Shield Block, Holy Shield, or Barkskin aura timing; charges and availability are not inferred.',
                });
                if (covered.length)
                    add(
                        'tank-defensive-coverage',
                        'Supported defensive aura covered active boss auto damage',
                        'player',
                        'observed',
                        'Keep lining up this defensive coverage with active boss contact; do not infer an extra cast or charge from uncovered outcomes.',
                        covered.slice(0, 4).map((hit) => {
                            const band = bands.find((item) => hit.timestamp >= item.start && hit.timestamp < item.end);
                            return evidence(
                                band.mechanic.label +
                                    ' covered an auto outcome of ' +
                                    hit.amount +
                                    ' from source ' +
                                    boss +
                                    '.',
                                at(hit),
                                at(hit),
                            );
                        }),
                        'A supported defensive aura band overlaps actual health-damage auto outcomes from the repeatedly attacking source.',
                        'Check boss swings, charges, cooldown state, and encounter assignment in replay.',
                        [
                            'Keep the timing if it matched the planned tank window.',
                            'Review uncovered windows only when the defensive was known available.',
                        ],
                        'keep',
                        'low',
                    );
                const uncovered = bossAutos.filter(
                    (hit) => !bands.some((band) => hit.timestamp >= band.start && hit.timestamp < band.end),
                );
                if (uncovered.length)
                    add(
                        'tank-defensive-uncovered',
                        'Boss auto damage occurred outside supported defensive aura bands',
                        'context',
                        'observed',
                        'If the relevant defensive was available and the boss was expected to remain active, plan its aura band across this window; do not assume another cast or charge was possible.',
                        uncovered
                            .slice(0, 4)
                            .map((hit) =>
                                evidence(
                                    'Auto outcome of ' +
                                        hit.amount +
                                        ' from source ' +
                                        boss +
                                        ' landed outside the recorded defensive bands.',
                                    at(hit),
                                    at(hit),
                                ),
                            ),
                        'Actual boss auto outcomes did not overlap a recorded Shield Block, Holy Shield, or Barkskin aura band.',
                        'Verify cooldown availability, charges, boss target, and mechanics before changing the plan.',
                        [
                            'Keep the uncovered interval if the defensive was unavailable or reserved.',
                            'Improve timing only if availability and active boss contact are confirmed.',
                        ],
                        'review',
                        'low',
                    );
            }
        }
    }

    if (ownComplete) {
        const interrupts = own.filter((event) => /^interrupt/.test(event.type || ''));
        const dispels = own.filter((event) => event.type === 'dispel');
        check(
            'utility-events',
            'Recorded utility events',
            'checked',
            interrupts.length + ' interrupt and ' + dispels.length + ' dispel events attributed to the player.',
        );
        if (interrupts.length)
            add(
                'recorded-interrupts',
                'Recorded interrupt contribution',
                'player',
                'observed',
                'Keep this timing aligned with the assigned rotation; this records use, not whether an interrupt was required or successful.',
                interrupts
                    .slice(0, 3)
                    .map((event) =>
                        evidence('Interrupt event recorded for spell ' + spellId(event) + '.', at(event), at(event)),
                    ),
                'The outgoing stream attributes interrupt events to this player.',
                'Confirm assignment and target cast in replay.',
                ['Keep the rotation assignment.', 'Review timing if another player was assigned.'],
                'keep',
                'low',
            );
    }

    limitations.push(
        'These are event-backed review decisions. They do not infer talents, resource affordability, avoidable DPS, HPS quality, DTPS quality, or responsibility for another player’s assignment.',
    );
    unresolved.push('Resource affordability and regeneration cannot be reconstructed from a cast timeline.');
    unresolved.push('The declared build does not establish individual talents, ranks, or intended rotation.');
    unresolved.push(
        'Target, cooldown, healing, and interrupt assignments require raid context outside this player stream.',
    );
    return {
        findings,
        checks,
        comparison,
        timeline: timeline.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec),
        limitations,
        telemetryObserved,
        depth: { status: 'partial', reviewed, unresolved },
    };
}

module.exports = { analyzeDecisions };
