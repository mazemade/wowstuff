'use strict';

// Small, bounded investigations, with arithmetic separated from recommendation text.
// Every absence claim requires complete evidence. No reconstruction of opaque CP/energy.
const { fightOf, selectReferences } = require('./evaluation-reference.js');
const TRINKETS = require('./data/evaluation-on-use.json').items;
const id = (e) => Number(e?.abilityGameID ?? e?.guid ?? e?.ability?.guid);
const round = (x) => Math.round(x * 10) / 10;
const CONTROL = new Map([
    [31480, 'War Stomp'],
    [31970, 'Fear'],
    [32014, 'Air Burst'],
    [31249, 'Icebolt'],
]);
const BURST = new Set([2825, 32182, 28507, 12042, 12472, 31884, 19574, 13750, 12292]);
const COOLDOWN_IDS = [...new Set([...TRINKETS.map((x) => x.spellId), ...BURST, 6615, 14177, 28714, 9512, 31224])];
function bands(raw, spell) {
    const f = fightOf(raw);
    return (raw.tables?.buffs?.data?.auras || [])
        .filter((b) => id(b) === spell)
        .flatMap((b) => b.bands || [])
        .filter((b) => Number.isFinite(b.startTime) && Number.isFinite(b.endTime) && b.endTime > b.startTime)
        .map((b) => [Math.max(f.startTime, b.startTime), Math.min(f.endTime, b.endTime)])
        .filter((b) => b[1] > b[0]);
}
function controlBands(raw) {
    const f = fightOf(raw),
        active = new Map(),
        result = [];
    for (const e of [...(raw.incoming?.data || [])].sort((a, b) => a.timestamp - b.timestamp)) {
        if (e.targetID !== raw.sourceId || !CONTROL.has(id(e))) continue;
        if (e.type === 'applydebuff') active.set(id(e), e.timestamp);
        if (e.type === 'removedebuff' && active.has(id(e))) {
            result.push({ start: active.get(id(e)), end: e.timestamp, name: CONTROL.get(id(e)) });
            active.delete(id(e));
        }
    }
    for (const [spell, start] of active) result.push({ start, end: f.endTime, name: CONTROL.get(spell) });
    return result;
}
function requestsFor(raw) {
    const f = fightOf(raw),
        own = raw.events?.complete ? raw.events.data : [];
    const equipped = new Set(
        (raw.tables?.ci?.data?.find((e) => e.sourceID === raw.sourceId)?.gear || []).map((x) => x.id),
    );
    const used = TRINKETS.filter(
        (t) =>
            equipped.has(t.itemId) &&
            own.some((e) => e.sourceID === raw.sourceId && e.type === 'cast' && id(e) === t.spellId),
    );
    const requests = [];
    if (used.length)
        requests.push({
            key: 'cooldownHistory',
            startTime: Math.max(0, f.startTime - Math.max(...used.map((t) => t.cooldownSec)) * 1000 - 1000),
            endTime: f.endTime,
            sourceId: raw.sourceId,
            ids: COOLDOWN_IDS,
            dataType: 'Casts',
        });
    if (f.name === "Kaz'rogal" && bands(raw, 6615).length)
        requests.push({ key: 'raidMechanics', ids: [31480], dataType: 'DamageTaken' });
    if (raw.player?.role === 'healer')
        requests.push({ key: 'raidDamage', filter: 'type = "damage"', dataType: 'DamageTaken' });
    return requests;
}
function analyzeInvestigation(raw) {
    const out = { findings: [], checks: [], comparison: [], timeline: [], limitations: [] },
        f = fightOf(raw);
    if (!f || !(f.endTime > f.startTime)) return out;
    const sec = (at) => round((at - f.startTime) / 1000),
        duration = (f.endTime - f.startTime) / 1000;
    const url =
        'https://classic.warcraftlogs.com/reports/' +
        raw.reportCode +
        '#fight=' +
        raw.fightId +
        '&source=' +
        raw.sourceId;
    const ev = (text, start, end) => ({
        text,
        url,
        ...(Number.isFinite(start) ? { startSec: sec(start) } : {}),
        ...(Number.isFinite(end) ? { endSec: sec(end) } : {}),
    });
    const add = (
        key,
        title,
        disposition,
        priority,
        why,
        action,
        verification,
        evidence,
        alternatives = [],
        confidence = 'observed',
    ) =>
        out.findings.push({
            id: key,
            title,
            disposition,
            priority,
            category: 'execution',
            owner: disposition === 'review' ? 'context' : 'player',
            confidence,
            why,
            action,
            verification,
            evidence,
            alternatives,
            gainDps: null,
        });
    const check = (key, label, status, reason) => out.checks.push({ id: key, label, status, reason });
    const own = (raw.events?.data || []).filter(
        (e) => e.sourceID === raw.sourceId && e.timestamp >= f.startTime && e.timestamp <= f.endTime,
    );
    const attacks = own.filter(
        (e) =>
            e.type === 'damage' &&
            e.targetID !== raw.sourceId &&
            e.targetID != null &&
            !e.tick &&
            !e.isTick &&
            (e.amount > 0 || [1, 75].includes(id(e))),
    );
    const controls = controlBands(raw);
    const ci = raw.tables?.ci?.data?.find((e) => e.sourceID === raw.sourceId);
    const deaths = raw.context?.deaths?.data?.entries;
    if (Array.isArray(deaths) && f.kill === true && !deaths.some((e) => e.id === raw.sourceId))
        add(
            'survived-kill',
            'Survived the successful pull',
            'keep',
            'low',
            'Survival preserves your contribution through the kill.',
            'Keep prioritizing required mechanics while maintaining useful activity.',
            'Continue completing kills without a player death.',
            [ev('No death for this player is present in the returned death table.')],
        );

    const refSet = selectReferences(raw);
    const exclusions = [...(raw.referenceExclusions || []), ...refSet.excluded];
    if (exclusions.length)
        add(
            'reference-independence',
            'Excluded unsuitable comparison records',
            'review',
            'low',
            'A duplicate upload of your own play cannot show how another player performed.',
            'Use the independent comparison retained in this report; do not interpret excluded records as a benchmark.',
            'Every displayed comparison should identify an independent character and matching encounter.',
            exclusions.map((x) => ev((x.name || 'Comparison') + ': ' + x.reason)),
        );

    if (!raw.events?.complete) {
        check(
            'investigation-events',
            'Decision event stream',
            'unknown',
            'Incomplete outgoing events prevent timing and absence conclusions.',
        );
        return out;
    }
    // Only a known, later-applied buff supports a missed initial interval. A missing row
    // alone is not absence; long-lived Classic auras can be omitted by the log.
    const demon = bands(raw, 11406);
    if (
        raw.encounter?.mobType === 'Demon' &&
        ['melee', 'ranged'].includes(raw.player?.role) &&
        demon.length &&
        attacks.length
    ) {
        const first = Math.min(...demon.map((b) => b[0])),
            firstAttack = Math.min(...attacks.map((e) => e.timestamp));
        const early = attacks.filter((e) => e.timestamp < first);
        const cast = own.some((e) => id(e) === 11406 && e.type === 'cast' && Math.abs(e.timestamp - first) < 1000);
        const alternative = [28497, 28503, 28520].some((spell) =>
            bands(raw, spell).some((b) => b[0] <= firstAttack && b[1] > firstAttack),
        );
        if (cast && first - firstAttack > 15000 && early.length >= 3)
            add(
                'late-demonslaying',
                'Elixir of Demonslaying began ' + sec(first) + ' seconds into the pull',
                alternative ? 'review' : 'improve',
                'high',
                'The demon-damage attack-power buff was not recorded during ' +
                    early.length +
                    ' earlier direct damage events. Applying it late misses part of the pull and may miss opening cooldowns.',
                alternative
                    ? 'Check whether changing from the earlier battle elixir was intentional; choose the appropriate battle elixir before pulling.'
                    : 'Apply the appropriate battle elixir before the pull, and recheck it after every wipe.',
                'On the next demon pull, confirm Demonslaying is active before the first attack.',
                [
                    ev(
                        'First Demonslaying band begins at ' +
                            sec(first) +
                            ' seconds and is corroborated by its application cast.',
                        first,
                    ),
                    ev('The first direct damage event occurred at ' + sec(firstAttack) + ' seconds.', firstAttack),
                ],
                [
                    'A different battle elixir is an alternative, not an effect to stack with Demonslaying.',
                    'This interval is not a quantified DPS recovery.',
                ],
            );
        check(
            'battle-elixir-timing',
            'Observed battle-elixir application',
            'checked',
            'Compared the first observed application with actual outgoing activity.',
        );
    } else
        check(
            'battle-elixir-timing',
            'Battle-elixir timing',
            'unknown',
            'A missing buff row does not establish absence; timing advice requires a later recorded application on a relevant encounter.',
        );

    const equipped = new Set((ci?.gear || []).map((g) => g.id));
    for (const trinket of TRINKETS.filter((t) => equipped.has(t.itemId))) {
        const uses = own
            .filter((e) => e.type === 'cast' && id(e) === trinket.spellId)
            .sort((a, b) => a.timestamp - b.timestamp);
        if (uses.length < 2 || f.kill !== true || ['healer', 'tank'].includes(raw.player?.role)) continue;
        const last = uses.at(-1),
            observedBand = bands(raw, trinket.spellId).find((b) => Math.abs(b[0] - last.timestamp) < 1000);
        if (!observedBand || observedBand[1] < f.endTime - 1000) continue;
        const clipped = trinket.durationSec - (f.endTime - last.timestamp) / 1000;
        if (clipped < 3) continue;
        const history = raw.investigation?.cooldownHistory;
        if (!history?.complete) {
            check(
                'trinket-readiness-' + trinket.itemId,
                trinket.name + ' earlier readiness',
                'unknown',
                'Complete pre-pull cooldown history is required to recommend an earlier activation.',
            );
            continue;
        }
        const first = uses[0].timestamp;
        const burstStarts = (raw.tables?.buffs?.data?.auras || [])
            .filter((b) => BURST.has(id(b)))
            .flatMap((b) => (b.bands || []).map((x) => x.startTime));
        const candidates = burstStarts
            .filter(
                (t) =>
                    t >= f.startTime &&
                    first - t >= 3000 &&
                    attacks.some((e) => e.timestamp >= t && e.timestamp <= t + 3000),
            )
            .sort((a, b) => a - b);
        const target = candidates.find((t) => {
            const previous = history.data
                .filter(
                    (e) =>
                        e.sourceID === raw.sourceId &&
                        e.type === 'cast' &&
                        id(e) === trinket.spellId &&
                        e.timestamp < t,
                )
                .at(-1);
            const ready = previous
                ? t - previous.timestamp >= trinket.cooldownSec * 1000
                : t - history.startTime >= trinket.cooldownSec * 1000;
            const sameCategory = TRINKETS.filter(
                (x) => equipped.has(x.itemId) && x.itemId !== trinket.itemId && x.categoryId === trinket.categoryId,
            );
            const planned = uses.map((_, i) => t + i * trinket.cooldownSec * 1000);
            // Preserve the other observed trinket schedule: both a prior category lock
            // and a new lock that would invalidate a following observed use matter.
            const sharedBlocked = planned.some((at) =>
                history.data.some(
                    (e) =>
                        e.sourceID === raw.sourceId &&
                        e.type === 'cast' &&
                        sameCategory.some(
                            (other) =>
                                id(e) === other.spellId &&
                                (e.timestamp <= at
                                    ? at - e.timestamp < other.categoryCooldownSec * 1000
                                    : e.timestamp - at < trinket.categoryCooldownSec * 1000),
                        ),
                ),
            );
            return (
                ready &&
                !sharedBlocked &&
                t + (uses.length - 1) * trinket.cooldownSec * 1000 + trinket.durationSec * 1000 <= f.endTime
            );
        });
        if (target == null) continue;
        const proposedLast = target + (uses.length - 1) * trinket.cooldownSec * 1000;
        add(
            'trinket-window-' + trinket.itemId,
            trinket.name + ': the final use had only ' + round(trinket.durationSec - clipped) + ' seconds',
            'improve',
            'high',
            'The first activation was late enough to push the final activation into boss death. An earlier recorded burst window had damage activity and the trinket was available.',
            'On a similar pull, use ' +
                trinket.name +
                ' around ' +
                sec(target) +
                ' seconds with the earlier burst, then plan the final use around ' +
                sec(proposedLast) +
                ' seconds if the target remains available.',
            'Aim for both full-duration activations; this timing allows about ' +
                round(clipped) +
                ' additional buff seconds on this recorded kill.',
            [
                ev('First activation at ' + sec(first) + ' seconds.', first),
                ev(
                    'Final buff lasted ' +
                        round(trinket.durationSec - clipped) +
                        ' of ' +
                        trinket.durationSec +
                        ' seconds before boss death.',
                    last.timestamp,
                    f.endTime,
                ),
                ev(
                    'Earlier burst and outgoing activity at ' +
                        sec(target) +
                        ' seconds; complete cooldown history confirms earlier readiness.',
                    target,
                ),
            ],
            [
                'An assigned cooldown hold or different future kill time can change this plan.',
                'Additional buff seconds are an opportunity, not a guaranteed DPS gain.',
            ],
            'inferred',
        );
    }

    const fap = bands(raw, 6615),
        raid = raw.investigation?.raidMechanics;
    if (f.name === "Kaz'rogal" && fap.length) {
        if (!raid?.complete || raid.scope !== 'raid')
            check(
                'stomp-potion',
                'Potion versus raid War Stomp',
                'unknown',
                'Raid-wide damage events are required; immunity can hide a player-only stomp event.',
            );
        else
            for (const [start, end] of fap) {
                const stomps = raid.data.filter(
                    (e) => id(e) === 31480 && e.timestamp >= f.startTime && e.timestamp <= f.endTime,
                );
                const next = stomps.filter((e) => e.timestamp >= end).sort((a, b) => a.timestamp - b.timestamp)[0];
                if (
                    !stomps.some((e) => e.timestamp >= start && e.timestamp < end) &&
                    next &&
                    next.timestamp - end < 15000
                )
                    add(
                        'stomp-potion-timing',
                        'Free Action Potion expired before the next War Stomp',
                        'improve',
                        'high',
                        'No raid War Stomp damage was recorded during the potion window. The next stomp came ' +
                            round((next.timestamp - end) / 1000) +
                            ' seconds after the buff ended.',
                        'Use Free Action Potion shortly before the expected stomp, using the encounter timer. If handling the stun another way, consider the damage-potion alternative instead.',
                        'Check that the next potion overlaps the intended stomp; do not infer immunity from missing player-only damage.',
                        [
                            ev('Free Action coverage: ' + sec(start) + '–' + sec(end) + ' seconds.', start, end),
                            ev('Next raid War Stomp at ' + sec(next.timestamp) + ' seconds.', next.timestamp),
                        ],
                        [
                            'Free Action Potion and Haste Potion compete for the potion cooldown.',
                            'Future stomp timing and assignments may differ.',
                        ],
                    );
                check(
                    'stomp-potion',
                    'Potion versus raid War Stomp',
                    'checked',
                    'Compared potion bands with the complete raid-wide mechanic stream.',
                );
            }
    }

    if (f.name === 'Azgalor' && raw.damageTakenEvents?.complete) {
        const rain = raw.damageTakenEvents.data
            .filter((e) => e.targetID === raw.sourceId && e.type === 'damage' && id(e) === 31340 && e.amount > 0)
            .sort((a, b) => a.timestamp - b.timestamp);
        const clusters = [];
        for (const e of rain) {
            const last = clusters.at(-1);
            if (!last || e.timestamp - last.at(-1).timestamp > 4000) clusters.push([e]);
            else last.push(e);
        }
        const repeated = clusters.filter((c) => c.length >= 2);
        if (repeated.length)
            add(
                'rain-of-fire-exposure',
                'Repeated direct Rain of Fire hits in ' + repeated.length + ' windows',
                'improve',
                'high',
                'Repeated direct ground-effect hits increase incoming damage and healer demand, even when melee uptime remains high.',
                'Move promptly out of Rain of Fire along the shortest safe path. Use Cloak deliberately if available; do not wait in the ground effect for a defensive cooldown.',
                'Reduce repeated direct Rain of Fire hits. Lingering Unquenchable Flames ticks can continue after leaving and are not counted as continued standing in fire.',
                repeated.map((c) =>
                    ev(
                        c.length + ' direct hits, ' + c.reduce((s, e) => s + e.amount, 0) + ' effective damage.',
                        c[0].timestamp,
                        c.at(-1).timestamp,
                    ),
                ),
                [
                    'Boss placement, movement restrictions and assignments can affect the escape route.',
                    'This is a survival improvement; no DPS recovery is assigned.',
                ],
            );
    }

    // Explain gaps with observed control; unexplained contact is a question, never a verdict.
    if (['melee', 'ranged'].includes(raw.player?.role)) {
        const whites = attacks.filter((e) => [1, 75].includes(id(e))).sort((a, b) => a.timestamp - b.timestamp);
        const gaps = whites
            .slice(1)
            .map((e, i) => ({
                start: whites[i].timestamp,
                end: e.timestamp,
                target: e.targetID,
                previousTarget: whites[i].targetID,
            }))
            .filter((g) => g.end - g.start >= 4000 && g.target === g.previousTarget);
        const explained = gaps
            .map((g) => ({ ...g, control: controls.filter((c) => c.start < g.end && c.end > g.start) }))
            .filter((g) => g.control.length);
        if (explained.length)
            add(
                'contact-explained',
                'Control effects overlap ' + explained.length + ' attack interruptions',
                'keep',
                'medium',
                'These gaps coincide with recorded crowd control. They cannot be assigned wholesale to rotation hesitation.',
                'Keep prioritizing the mechanic and resume safe attacks promptly when control ends.',
                'Compare future attack interruptions with control windows before judging uptime.',
                explained.map((g) =>
                    ev(
                        g.control.map((c) => c.name).join(', ') +
                            ' overlaps the ' +
                            round((g.end - g.start) / 1000) +
                            '-second attack gap.',
                        g.start,
                        g.end,
                    ),
                ),
                ['An overlap explains a constraint, not necessarily every second of the gap.'],
            );
        if (raw.incoming?.complete) {
            const unexplained = gaps
                .filter((g) => !controls.some((c) => c.start < g.end && c.end > g.start))
                .sort((a, b) => b.end - b.start - (a.end - a.start))
                .slice(0, 3);
            if (unexplained.length)
                add(
                    'contact-unresolved',
                    'Some attack interruptions need positioning or assignment context',
                    'review',
                    'low',
                    'No recognized control effect accounts for these same-target attack gaps. Movement, range, target phases or an assignment may still explain them.',
                    'Review a recording or your assignment for the linked windows. Resume attacks sooner only if safe target access was available.',
                    'Establish the reason for each gap before treating it as an improvement target.',
                    unexplained.map((g) =>
                        ev(
                            round((g.end - g.start) / 1000) + ' seconds between recorded attacks on the same target.',
                            g.start,
                            g.end,
                        ),
                    ),
                    ['The log does not establish position, facing or target availability.'],
                );
        }
    }
    check(
        'investigation-events',
        'Decision event stream',
        'checked',
        'Observed event timing is available; resource affordability and unrecorded assignments remain unknown.',
    );
    return out;
}
module.exports = { analyzeInvestigation, requestsFor, COOLDOWN_IDS, bands, controlBands };
