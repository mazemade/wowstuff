'use strict';
const { chooseReference } = require('./evaluation-damage-analysis.js');
const { selectReferences } = require('./evaluation-reference.js');

// Event-level Rogue evidence.  IDs and the deliberately unusual WCL capture shape are
// documented in docs/evaluation-mechanics-sources.md.
const ID = Object.freeze({
    mutilate: 34413,
    mutilateMh: 34418,
    mutilateOh: 34419,
    envenom: 32684,
    deadly: 27187,
    coldBlood: 14177,
    deathmantle: 37171,
    snd: 6774,
    rupture: 26867,
    sndCast: 5171,
});
const round = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const canonical = (value) =>
    String(value || '')
        .replace(/[^a-z]/gi, '')
        .toLowerCase();
const spell = (row) => Number(row?.abilityGameID ?? row?.guid ?? row?.ability?.guid);
const table = (value) => (value?.data && !Array.isArray(value.data) ? value.data : value);
const fightOf = (raw) => raw?.context?.fights?.find((f) => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = (raw) => {
    const f = fightOf(raw);
    const value = f && (f.endTime - f.startTime) / 1000;
    return value > 0 ? value : null;
};
const sec = (raw, event) => {
    const f = fightOf(raw);
    return f && Number.isFinite(event?.timestamp) ? (event.timestamp - f.startTime) / 1000 : null;
};
const urlOf = (raw) =>
    raw?.reportCode && raw.fightId != null && raw.sourceId != null
        ? 'https://classic.warcraftlogs.com/reports/' +
          encodeURIComponent(raw.reportCode) +
          '#fight=' +
          raw.fightId +
          '&source=' +
          raw.sourceId
        : undefined;
const merge = (input) =>
    input
        .filter((x) => x[1] > x[0])
        .sort((a, b) => a[0] - b[0])
        .reduce((out, x) => {
            const last = out[out.length - 1];
            if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
            else out.push(x.slice());
            return out;
        }, []);
const length = (bands) => merge(bands).reduce((n, x) => n + x[1] - x[0], 0);
const overlap = (bands, start, end) => length(bands.map((x) => [Math.max(start, x[0]), Math.min(end, x[1])]));
function hostileControlBands(raw) {
    const stream = raw?.incoming?.complete && Array.isArray(raw.incoming.data) ? raw.incoming.data : null;
    if (!stream) return null;
    const f = fightOf(raw),
        d = durationOf(raw),
        ids = new Set([31249, 31480, 31970, 32014]),
        open = new Map(),
        out = [];
    for (const e of stream
        .filter((e) => e.targetID === raw.sourceId && ids.has(spell(e)))
        .sort((a, b) => a.timestamp - b.timestamp)) {
        const time = sec(raw, e),
            key = spell(e) + ':' + e.sourceID;
        if (!Number.isFinite(time)) continue;
        if (e.type === 'applydebuff' || e.type === 'refreshdebuff') {
            if (!open.has(key)) open.set(key, time);
        } else if (e.type === 'removedebuff' && open.has(key)) {
            out.push([open.get(key), time]);
            open.delete(key);
        }
    }
    for (const start of open.values()) out.push([start, d]);
    return merge(out);
}
function bands(raw, predicate) {
    const f = fightOf(raw),
        d = durationOf(raw),
        rows = table(raw?.tables?.buffs)?.auras;
    if (!f || !d || !Array.isArray(rows)) return null;
    const matched = rows.filter(predicate);
    if (!matched.length) return null;
    if (matched.some((r) => !Array.isArray(r.bands))) return null;
    return merge(
        matched.flatMap((r) =>
            r.bands.map((b) => [
                Math.max(0, (b.startTime - f.startTime) / 1000),
                Math.min(d, (b.endTime - f.startTime) / 1000),
            ]),
        ),
    );
}
function analyzeRogue(raw = {}) {
    const result = { findings: [], checks: [], comparison: [], timeline: [], limitations: [] };
    if (canonical(raw.player?.classToken || raw.player?.class) !== 'rogue') return result;
    const d = durationOf(raw),
        events =
            raw.events?.complete && Array.isArray(raw.events.data)
                ? raw.events.data
                      .filter(
                          (e) =>
                              e.sourceID === raw.sourceId &&
                              e.timestamp >= fightOf(raw).startTime &&
                              e.timestamp <= fightOf(raw).endTime,
                      )
                      .sort((a, b) => a.timestamp - b.timestamp)
                : null;
    const evidence = (text, startSec, endSec) => ({
        text,
        ...(Number.isFinite(startSec) ? { startSec: round(startSec) } : {}),
        ...(Number.isFinite(endSec) ? { endSec: round(endSec) } : {}),
        ...(urlOf(raw) ? { url: urlOf(raw) } : {}),
    });
    const sourceEvidence = (source, text) => ({ text, ...(urlOf(source) ? { url: urlOf(source) } : {}) });
    const check = (id, label, status, reason) => result.checks.push({ id, label, status, reason });
    const add = (
        id,
        title,
        priority,
        owner,
        action,
        records,
        why,
        verification,
        alternatives,
        disposition = 'improve',
        impact,
        bucket,
        measure,
    ) =>
        result.findings.push({
            id,
            title,
            category: 'execution',
            priority,
            owner,
            confidence: 'observed',
            action,
            evidence: records,
            why,
            verification,
            alternatives,
            disposition,
            ...(impact ? { impact } : {}),
            ...(bucket ? { bucket } : {}),
            ...(measure ? { measure } : {}),
        });
    if (!d || !events) {
        check(
            'rogue-events',
            'Rogue execution timeline',
            'unknown',
            'Complete outgoing events and fight timestamps are required.',
        );
        result.limitations.push(
            'Outgoing events or fight timestamps are incomplete, so absence and timing claims are withheld.',
        );
        return result;
    }
    check(
        'rogue-events',
        'Rogue execution timeline',
        'checked',
        events.length + ' complete outgoing events were available.',
    );
    const at = (id, types) =>
        events
            .filter((e) => spell(e) === id && (!types || types.includes(e.type)))
            .map((e) => ({ ...e, time: sec(raw, e) }))
            .filter((e) => Number.isFinite(e.time));
    const mutilates = at(ID.mutilate, ['cast']),
        mutilateDodges = at(ID.mutilate, ['damage']).filter((e) => e.hitType === 7),
        hands = events.filter((e) => [ID.mutilateMh, ID.mutilateOh].includes(spell(e)) && e.type === 'damage');
    check(
        'rogue-mutilate-attempts',
        'Mutilate attempts',
        'checked',
        mutilates.length + ' parent casts; ' + mutilateDodges.length + ' zero-damage dodge outcome(s).',
    );
    result.comparison.push({
        name: 'Mutilate attempts',
        player: mutilates.length,
        reference: null,
        unit: 'casts',
        note: 'Parent 34413 casts; hand hits are not counted as attempts.',
    });
    if (mutilates.length && hands.length)
        result.comparison.push({
            name: 'Mutilate hand damage records',
            player: hands.length,
            reference: null,
            unit: 'records',
            note: '34418/34419 are outcomes, not button presses.',
        });
    if (mutilateDodges.length)
        add(
            'rogue-mutilate-dodges',
            'Mutilate recorded dodge outcomes',
            'medium',
            'player',
            'Use these timestamped dodges when evaluating expertise; do not treat missing hand hits as missing casts.',
            mutilateDodges.map((e) => evidence('Mutilate parent recorded a zero-damage dodge.', e.time, e.time)),
            'The parent attempt landed no damage, while Mutilate hand hits are separately logged.',
            'Check expertise and target-facing evidence before selecting a gear change.',
            ['A dodge can occur at the target’s base dodge chance; this does not prove front-facing.'],
            'review',
        );
    const reference = chooseReference(raw),
        refDuration = durationOf(reference),
        refEvents =
            reference?.events?.complete && Array.isArray(reference.events.data)
                ? reference.events.data.filter((e) => e.sourceID === reference.sourceId)
                : null;
    const compatible = selectReferences(raw)
        .accepted.filter(
            (candidate) =>
                candidate !== reference &&
                canonical(candidate.player?.classToken || candidate.player?.class) ===
                    canonical(raw.player?.classToken || raw.player?.class) &&
                canonical(candidate.player?.spec) === canonical(raw.player?.spec) &&
                candidate.player?.name !== raw.player?.name &&
                durationOf(candidate) > 0 &&
                candidate.events?.complete &&
                Array.isArray(candidate.events.data),
        )
        .slice(0, 3);
    for (const candidate of compatible) {
        const attempts = candidate.events.data.filter(
                (e) => e.sourceID === candidate.sourceId && spell(e) === ID.mutilate && e.type === 'cast',
            ).length,
            rate = (attempts * 60) / durationOf(candidate),
            ownRate = (mutilates.length * 60) / d;
        if (mutilates.length > 0 && attempts > 0 && ownRate >= rate)
            add(
                'rogue-mutilate-frequency-not-lower-' + canonical(candidate.player?.name),
                'Mutilate frequency is not lower than ' + candidate.player?.name,
                'low',
                'context',
                'Compare landed Mutilate outcomes, poison state, buffs and crits before recommending more button presses.',
                [
                    sourceEvidence(
                        raw,
                        raw.player?.name +
                            ': ' +
                            mutilates.length +
                            ' parent casts over ' +
                            round(d) +
                            ' seconds (' +
                            round(ownRate) +
                            '/min).',
                    ),
                    sourceEvidence(
                        candidate,
                        candidate.player?.name +
                            ': ' +
                            attempts +
                            ' parent casts over ' +
                            round(durationOf(candidate)) +
                            ' seconds (' +
                            round(rate) +
                            '/min).',
                    ),
                ],
                'The player already pressed Mutilate at least as often in these observed pulls.',
                'Compare landed outcomes, buffs, poison state and crit composition before changing cadence.',
                ['Pull length, support, target access, gear, crits and poison state differ.'],
                'keep',
            );
    }
    if (reference && refDuration > 0 && refEvents) {
        const refAttempts = refEvents.filter((e) => spell(e) === ID.mutilate && e.type === 'cast').length,
            ownRate = (mutilates.length * 60) / d,
            refRate = (refAttempts * 60) / refDuration;
        const handDps = (source) => {
            const rows = table(source.tables?.dmg)?.entries || [];
            return (
                rows
                    .filter((row) => [ID.mutilateMh, ID.mutilateOh].includes(spell(row)))
                    .reduce((sum, row) => sum + (Number(row.total) || 0), 0) / durationOf(source)
            );
        };
        const ownHand = handDps(raw),
            refHand = handDps(reference);
        result.comparison.push({
            name: 'Mutilate parent attempts per minute',
            player: round(ownRate),
            reference: round(refRate),
            unit: 'casts/min',
            note: 'Parent 34413 cast events.',
        });
        if (mutilates.length > 0 && refAttempts > 0 && ownRate >= refRate)
            add(
                'rogue-mutilate-frequency-not-lower',
                'Mutilate frequency is not lower than the selected reference',
                'low',
                'context',
                'Compare landed Mutilate outcomes, poison state, buffs and crits before recommending more button presses.',
                [
                    sourceEvidence(
                        raw,
                        raw.player?.name +
                            ': ' +
                            mutilates.length +
                            ' parent casts over ' +
                            round(d) +
                            ' seconds (' +
                            round(ownRate) +
                            '/min); Mutilate hand damage ' +
                            round(ownHand) +
                            ' DPS.',
                    ),
                    sourceEvidence(
                        reference,
                        reference.player?.name +
                            ': ' +
                            refAttempts +
                            ' parent casts over ' +
                            round(refDuration) +
                            ' seconds (' +
                            round(refRate) +
                            '/min); Mutilate hand damage ' +
                            round(refHand) +
                            ' DPS.',
                    ),
                ],
                'The player already pressed Mutilate at least as often in these two observed pulls; any hand-damage difference is an outcome difference.',
                'Compare landed outcomes, buffs, poison state and crit composition before changing cadence.',
                ['Pull length, support, target access, gear, crits and poison state differ.'],
                'keep',
            );
        const totals = (source) => {
            const rows = table(source.tables?.dmg)?.entries || [];
            return [[ID.deadly], [ID.rupture], [32645, ID.envenom], [2098, 26865]].map((ids) => ({
                id: ids[0],
                total: rows
                    .filter((row) => ids.includes(spell(row)))
                    .reduce((sum, row) => sum + (Number(row.total) || 0), 0),
            }));
        };
        const ownMix = totals(raw),
            refMix = totals(reference),
            ownTotal = ownMix.reduce((sum, x) => sum + x.total, 0),
            refTotal = refMix.reduce((sum, x) => sum + x.total, 0);
        const exposeRows = table(reference.tables?.casts)?.entries || [];
        const expose = exposeRows
            .filter((row) => [8647, 26866].includes(spell(row)))
            .reduce((sum, row) => sum + (Number(row.total) || 0), 0);
        result.comparison.push({
            name: 'Poison/Rupture/Envenom finishing damage',
            player: round(ownTotal / d),
            reference: round(refTotal / refDuration),
            unit: 'DPS',
            note: 'Reference also includes Eviscerate where recorded.',
        });
        add(
            'rogue-finisher-mix-context',
            'Reference finisher mix is assignment and outcome context',
            'low',
            'context',
            'Do not copy the reference finisher mix blindly; compare poison, Rupture, Envenom and Eviscerate totals with the Expose Armor assignment.',
            [
                sourceEvidence(raw, 'Player Poison/Rupture/Envenom/Eviscerate: ' + round(ownTotal / d) + ' DPS.'),
                sourceEvidence(
                    reference,
                    'Reference Poison/Rupture/Envenom/Eviscerate: ' +
                        round(refTotal / refDuration) +
                        ' DPS; ' +
                        expose +
                        ' recorded Expose Armor cast(s).',
                ),
            ],
            'Different finishing damage can reflect poison state and a raid-debuff assignment, not a universal rotation error.',
            'Verify the raid Expose assignment and event-level poison/finisher outcomes.',
            ['Another rogue may own Expose Armor, making a different finisher mix appropriate.'],
            'review',
        );
    }
    const envenoms = at(ID.envenom, ['damage']),
        envenomFails = envenoms.filter((e) => e.hitType === 7 || e.amount === 0),
        envenomLanded = envenoms.filter((e) => !envenomFails.includes(e));
    check(
        'rogue-envenom-outcomes',
        'Envenom outcomes',
        'checked',
        envenoms.length +
            ' 32684 damage attempts (' +
            envenomLanded.length +
            ' landed, ' +
            envenomFails.length +
            ' failed).',
    );
    result.comparison.push({
        name: 'Envenom attempts',
        player: envenoms.length,
        reference: null,
        unit: 'attempts',
        note: '32684 damage outcomes; this capture has no Envenom cast event.',
    });
    const poisonEvents = at(ID.deadly, [
        'applydebuff',
        'applydebuffstack',
        'refreshdebuff',
        'removedebuff',
        'removedebuffstack',
    ]);
    const poisonState = new Map(),
        natural = [];
    for (const event of poisonEvents) {
        const target = event.targetID,
            reported = Number(event.stack ?? event.stackAmount);
        if (event.type === 'applydebuff')
            poisonState.set(target, { stacks: Number.isFinite(reported) ? reported : 1, last: event.time });
        else if (event.type === 'applydebuffstack') {
            const state = poisonState.get(target) || { stacks: 0, last: event.time };
            state.stacks = Number.isFinite(reported) ? reported : Math.min(5, state.stacks + 1);
            state.last = event.time;
            poisonState.set(target, state);
        } else if (event.type === 'refreshdebuff') {
            const state = poisonState.get(target);
            if (state) {
                if (Number.isFinite(reported)) state.stacks = reported;
                state.last = event.time;
            }
        } else if (event.type === 'removedebuffstack') {
            const state = poisonState.get(target);
            if (state) state.stacks = Number.isFinite(reported) ? reported : Math.max(0, state.stacks - 1);
        } else if (event.type === 'removedebuff') {
            const state = poisonState.get(target) || { stacks: null, last: null };
            if (!envenomLanded.some((e) => e.targetID === target && Math.abs(e.time - event.time) < 0.08))
                natural.push({ ...event, stacks: state.stacks, lastRefresh: state.last });
            poisonState.delete(target);
        }
    }
    const poisonRemoves = poisonEvents.filter((e) => e.type === 'removedebuff' || e.type === 'removedebuffstack');
    check(
        'rogue-deadly-consumption',
        'Deadly Poison removal attribution',
        'checked',
        poisonRemoves.length + ' removal event(s); ' + natural.length + ' not simultaneous with a landed Envenom.',
    );
    const fiveExpiry = natural.filter(
        (e) => e.stacks === 5 && e.time - e.lastRefresh >= 11.5 && e.time - e.lastRefresh <= 12.5,
    );
    if (fiveExpiry.length) {
        const windows = fiveExpiry.map((expiry) => {
            const next = poisonEvents.find(
                (e) => e.targetID === expiry.targetID && e.type === 'applydebuff' && e.time > expiry.time,
            );
            const whites = events.filter(
                (e) =>
                    e.type === 'damage' &&
                    spell(e) === 1 &&
                    e.targetID === expiry.targetID &&
                    e.timestamp > expiry.timestamp &&
                    (!next || e.timestamp < next.timestamp),
            );
            return { expiry, next, whites };
        });
        const delayedRecovery = windows.some((w) => w.whites.length >= 3);
        add(
            'rogue-deadly-five-stack-expiry',
            'Monitor five-stack Deadly Poison expiry and recovery',
            'medium',
            'player',
            delayedRecovery
                ? 'Display your own poison stacks and remaining duration. After movement, check that poison returns; consider Shiv when preserving or restoring poison justifies its energy cost.'
                : 'Keep a poison-expiry warning visible, but review the stack rebuild before spending extra energy on Shiv; reapplication here did not leave a long run of unpoisoned white attacks.',
            windows.map(({ expiry, next, whites }) =>
                evidence(
                    'Five-stack poison expired after ' +
                        round(expiry.time - expiry.lastRefresh) +
                        ' seconds since refresh; ' +
                        whites.length +
                        ' white outcomes occurred before ' +
                        (next ? 'reapplication.' : 'fight end.') +
                        (next
                            ? ' Reapplied at ' + round(next.time) + ' seconds.'
                            : ' No later application was recorded.'),
                    expiry.time,
                    next?.time,
                ),
            ),
            'The recorded five-stack removal followed the poison duration without a simultaneous landed Envenom. Lost stacks and delayed reapplication are separate questions; forced movement can explain the initial expiry.',
            'Check stack count and expiry at the boss, then verify recovery after movement. Use Shiv selectively rather than adding it to every cycle.',
            [
                'Shiv spends energy and a global cooldown that could support the normal builder/finisher cycle.',
                'Immediate reapplication can still reset the stack; the best tradeoff is not established by a removal alone.',
                'A forced movement window is not automatically an execution mistake.',
            ],
            delayedRecovery ? 'improve' : 'review',
        );
    }

    const cbApply = at(ID.coldBlood, ['applybuff', 'refreshbuff']),
        cbRemove = at(ID.coldBlood, ['removebuff']);
    check(
        'rogue-cold-blood',
        'Cold Blood consumption',
        'checked',
        cbApply.length + ' application(s), ' + cbRemove.length + ' removal(s).',
    );
    for (const apply of cbApply) {
        const failed = envenomFails.find((e) => e.time >= apply.time && e.time < apply.time + 15);
        const retry =
            failed &&
            envenomLanded.find(
                (e) =>
                    e.targetID === failed.targetID &&
                    e.hitType === 2 &&
                    e.time > failed.time &&
                    e.time < failed.time + 3,
            );
        const removed = cbRemove.find((e) => e.time >= apply.time && e.time < apply.time + 15);
        if (failed && retry && removed && Math.abs(removed.time - retry.time) < 0.08)
            add(
                'rogue-cold-blood-retry-' + round(apply.time),
                'Cold Blood survived a failed Envenom and empowered the retry',
                'low',
                'player',
                'Keep the immediate retry behavior; the aura remained through the failed outcome and was removed after the landed follow-up.',
                [
                    evidence('Cold Blood applied.', apply.time, apply.time),
                    evidence('Envenom failed while Cold Blood remained.', failed.time, failed.time),
                    evidence('Landed Envenom preceded Cold Blood removal.', retry.time, removed.time),
                ],
                'The live aura ordering shows the failed Envenom did not consume Cold Blood.',
                'Confirm the same event ordering; do not use the simulator callback alone for failed-attack behavior.',
                ['A different landed rogue ability may be the intended consumer.'],
                'keep',
            );
        const parent = removed && mutilates.find((e) => e.time >= apply.time && Math.abs(e.time - removed.time) < 0.1);
        const mutilateHands = parent
            ? hands.filter(
                  (e) =>
                      e.targetID === parent.targetID &&
                      Math.abs(e.timestamp - parent.timestamp) < 100 &&
                      e.hitType === 2,
              )
            : [];
        if (mutilateHands.length === 2 && new Set(mutilateHands.map(spell)).size === 2) {
            add(
                'rogue-cold-blood-mutilate-' + round(apply.time),
                'Cold Blood produced two Mutilate hand crits',
                'low',
                'player',
                'Keep this observed Cold Blood-to-Mutilate conversion when the same resource and target context applies.',
                mutilateHands.map((e) =>
                    evidence(
                        'Mutilate hand crit matched the parent attempt and Cold Blood consumption cluster.',
                        sec(raw, e),
                        sec(raw, e),
                    ),
                ),
                'Both hand crits match the same target and parent Mutilate attempt at the recorded Cold Blood consumption.',
                'Check the parent attempt, both hand outcomes and the aura consumption together.',
                ['Envenom may be the preferred consumer in another poison, resource or fight-time window.'],
                'keep',
            );
        }
    }

    const dmApply = at(ID.deathmantle, ['applybuff', 'refreshbuff']),
        dmRemove = at(ID.deathmantle, ['removebuff']);
    check(
        'rogue-deathmantle',
        'Coup de Grace finisher consumption',
        'checked',
        dmApply.length + ' proc application/refresh event(s), ' + dmRemove.length + ' removal(s).',
    );
    const finishers = events
        .filter(
            (e) =>
                (e.type === 'cast' && [ID.rupture, ID.sndCast].includes(spell(e))) ||
                (e.type === 'damage' && spell(e) === ID.envenom),
        )
        .map((e) => ({ ...e, time: sec(raw, e) }));
    const dmConsumed = dmRemove.filter((remove) =>
        finishers.some((finisher) => Math.abs(finisher.time - remove.time) < 0.08),
    );
    result.comparison.push({
        name: 'Coup de Grace removals matched to finisher attempts',
        player: dmConsumed.length,
        reference: dmRemove.length,
        unit: 'removals',
        note: 'Includes SnD/Rupture casts and landed or failed Envenom 32684 attempts.',
    });
    if (dmRemove.length && dmConsumed.length === dmRemove.length)
        add(
            'rogue-deathmantle-consumption',
            'Coup de Grace removals matched finisher attempts',
            'low',
            'player',
            'Keep converting observed Coup de Grace removals into finishers; no unmatched removal suggests an expired-proc pattern in this pull.',
            dmRemove.map((e) => evidence('Coup de Grace removal matched a finisher attempt.', e.time, e.time)),
            'The next finisher consumes the proc, including a failed Envenom outcome.',
            'Confirm each removal against the event-level finisher sequence.',
            ['A fight-ending active proc has no later opportunity.'],
            'keep',
        );
    const snd = bands(raw, (row) => canonical(row.name) === 'sliceanddice' || spell(row) === ID.snd);
    if (snd === null) {
        check(
            'rogue-snd-attack-coverage',
            'Slice and Dice while attacking',
            'unknown',
            'The buff table has no usable Slice and Dice bands.',
        );
        result.limitations.push('Slice and Dice coverage cannot be calculated without usable buff bands.');
    } else {
        const whites = events
            .filter((e) => e.type === 'damage' && spell(e) === 1)
            .map((e) => ({ ...e, time: sec(raw, e) }));
        const inside = whites.filter((e) => snd.some((x) => e.time >= x[0] && e.time < x[1]));
        const pct = whites.length ? (100 * inside.length) / whites.length : null;
        check(
            'rogue-snd-attack-coverage',
            'Slice and Dice white-outcome coverage',
            'checked',
            inside.length + '/' + whites.length + ' recorded white outcomes occurred in SnD bands.',
        );
        result.comparison.push({
            name: 'Slice and Dice white-outcome coverage',
            player: round(pct),
            reference: null,
            unit: '%',
            note: 'Observed white outcomes in buff bands; pre-pull setup and fight-end gaps are conditional context.',
        });
        const between = snd
            .slice(0, -1)
            .map((band, index) => ({ start: band[1], end: snd[index + 1][0] }))
            .map((gap) => ({ ...gap, whites: whites.filter((e) => e.time >= gap.start && e.time < gap.end) }))
            .find((gap) => gap.whites.length >= 5);
        if (between)
            add(
                'rogue-snd-midfight-gap',
                'Slice and Dice was absent for ' + between.whites.length + ' white outcomes',
                'medium',
                'player',
                'Watch the SnD timer and plan the refresh before expiry when the target remains available; opener setup and an end-of-fight gap are conditional context.',
                [
                    evidence(
                        between.whites.length +
                            ' recorded white outcomes fell outside SnD between two observed SnD bands.',
                        between.start,
                        between.end,
                    ),
                ],
                'These outcomes occurred after one SnD band ended and before the next began.',
                'Check target access and movement before changing the timing.',
                ['An intentional resource or finisher choice.'],
                'improve',
                undefined,
                'melee',
                {
                    lostSeconds: round(between.end - between.start),
                    activeRateDps: round(
                        (0.3 * events.filter((e) => spell(e) === 1 && e.type === 'damage').reduce((s, e) => s + e.amount, 0)) / d,
                    ),
                    note: 'Slice and Dice is 30% attack speed with 3/3 Improved Slice and Dice and 20% without; the talent is not recorded.',
                },
            );
        if (pct !== null)
            result.timeline.push(
                ...snd.map((x) => ({
                    label: 'Slice and Dice',
                    startSec: round(x[0]),
                    endSec: round(x[1]),
                    kind: 'buff',
                })),
            );
    }
    result.limitations.push(
        'This evaluator does not reconstruct combo points, energy, approach, target availability, deaths, or an optimal finisher rotation. Hard-control bands are used only for bounded gap context when the incoming stream is complete.',
    );
    result.limitations.push(
        'Deadly Poison stack counts are not inferred from removal events; Envenom spend is attributed only to simultaneous landed 32684 outcomes.',
    );
    return result;
}
module.exports = { analyzeRogue };
