'use strict';

const { chooseReference } = require('./evaluation-damage-analysis.js');

const SPELL = Object.freeze({
    melee: 1,
    judgement: 20271,
    commandCast: 20375,
    commandProc: 20424,
    bloodCast: 31892,
    bloodProc: 31893,
    martyrCast: 348700,
    martyrProc: 348701,
    crusaderStrike: 35395,
    avengingWrath: 31884,
    hastePotion: 28507,
    bloodlust: 2825,
    heroism: 32182,
    lustForBattle: 35166,
});
const COMMAND_CASTS = new Set([20375, 20915, 20918, 20919, 20920, 27170]);
const SEAL_CASTS = new Set([
    ...COMMAND_CASTS, 31892, 348700, 31801,
    21084, 20287, 20288, 20289, 20290, 20291, 20292, 20293, 27155,
    20165, 20347, 20348, 20349, 27160, 20166, 20356, 20357, 27166,
    20164, 31895, 21082, 20162, 20305, 20306, 20307, 20308, 27158,
]);
const ENCOUNTER_DEBUFFS = new Map([[31249, 'Icebolt'], [31250, 'Frost Nova'], [31258, 'Death & Decay'], [31480, 'War Stomp'], [31477, 'Cripple']]);
const DIRECT_MELEE = new Set([SPELL.melee, SPELL.crusaderStrike, SPELL.commandProc, SPELL.bloodProc, SPELL.martyrProc]);
const GCD_CASTS = new Set([
    ...SEAL_CASTS,
    21084, 20164, 20165, 20166, 20154, 27138, 27173, 27180, 24275,
]);
const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const canonical = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const spellId = row => Number(row?.abilityGameID ?? row?.guid ?? row?.ability?.guid);
const tableBody = table => table?.data && !Array.isArray(table.data) ? table.data : table;
const auras = table => Array.isArray(tableBody(table)?.auras) ? tableBody(table).auras : null;
const fightOf = raw => raw?.context?.fights?.find(fight => fight.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const fight = fightOf(raw); return fight && (fight.endTime - fight.startTime) / 1000; };
const urlOf = raw => raw?.reportCode && raw.fightId != null && raw.sourceId != null ?
    'https://classic.warcraftlogs.com/reports/' + encodeURIComponent(raw.reportCode) + '#fight=' + encodeURIComponent(raw.fightId) + '&source=' + encodeURIComponent(raw.sourceId) : undefined;

function empty() { return { findings: [], comparison: [], timeline: [], checks: [], limitations: [] }; }
function merge(intervals) {
    const result = [];
    for (const interval of intervals.filter(value => value[1] > value[0]).sort((a, b) => a[0] - b[0])) {
        const last = result[result.length - 1];
        if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
        else result.push(interval.slice());
    }
    return result;
}
const length = intervals => merge(intervals).reduce((total, interval) => total + interval[1] - interval[0], 0);
function intersect(left, right) {
    return merge(left.flatMap(a => right.map(b => [Math.max(a[0], b[0]), Math.min(a[1], b[1])])));
}
function relativeTime(raw, event) {
    const fight = fightOf(raw);
    return fight && Number.isFinite(event?.timestamp) ? (event.timestamp - fight.startTime) / 1000 : null;
}
function eventTimes(raw, wanted, types) {
    const ids = new Set(Array.isArray(wanted) ? wanted : [wanted]);
    const allowed = new Set(Array.isArray(types) ? types : [types]);
    if (!raw?.events?.complete || !Array.isArray(raw.events.data)) return null;
    const duration = durationOf(raw);
    return raw.events.data.filter(event => event.sourceID === raw.sourceId && ids.has(spellId(event)) && allowed.has(event.type))
        .map(event => relativeTime(raw, event)).filter(time => Number.isFinite(time) && time >= 0 && time <= duration).sort((a, b) => a - b);
}
function uniqueTimes(times) {
    return [...new Set(times.map(time => Math.round(time * 1000)))].map(time => time / 1000).sort((a, b) => a - b);
}
function auraBands(raw, wanted) {
    const rows = auras(raw?.tables?.buffs);
    const duration = durationOf(raw), fight = fightOf(raw), ids = new Set(Array.isArray(wanted) ? wanted : [wanted]);
    if (!rows || !(duration > 0)) return null;
    const matched = rows.filter(row => ids.has(spellId(row)));
    if (!matched.length) return [];
    if (matched.some(row => !Array.isArray(row.bands))) return null;
    return merge(matched.flatMap(row => row.bands.map(band => [
        Math.max(0, (band.startTime - fight.startTime) / 1000),
        Math.min(duration, (band.endTime - fight.startTime) / 1000),
    ])));
}
function hostileDebuffDetails(raw) {
    if (!raw?.incoming?.complete || !Array.isArray(raw.incoming.data)) return null;
    const open = new Map(), result = [], duration = durationOf(raw);
    const actors = raw.context?.masterData?.actors || raw.context?.masterData?.data?.actors || [];
    const actorById = new Map(actors.map(actor => [actor.id, actor]));
    const hostileSource = event => {
        const actor = actorById.get(event.sourceID), type = canonical(actor?.type), subType = canonical(actor?.subType);
        return ['npc', 'enemy'].includes(type) || subType === 'boss' || (!actor && ENCOUNTER_DEBUFFS.has(spellId(event)));
    };
    const events = raw.incoming.data.filter(event => event.targetID === raw.sourceId && event.sourceID !== raw.sourceId && hostileSource(event) &&
        ['applydebuff', 'refreshdebuff', 'removedebuff'].includes(event.type)).sort((a, b) => a.timestamp - b.timestamp);
    for (const event of events) {
        const time = relativeTime(raw, event), key = spellId(event) + ':' + (event.sourceID ?? '');
        if (!Number.isFinite(time)) continue;
        if (event.type === 'applydebuff' || event.type === 'refreshdebuff') {
            if (!open.has(key)) open.set(key, time);
        } else if (open.has(key)) {
            const opened = open.get(key);
            result.push({ id: spellId(event), label: ENCOUNTER_DEBUFFS.get(spellId(event)) || ('Hostile debuff ' + spellId(event)), interval: [opened, time] }); open.delete(key);
        }
    }
    if (duration > 0) for (const [key, start] of open) {
        const id = Number(key.split(':')[0]);
        result.push({ id, label: ENCOUNTER_DEBUFFS.get(id) || ('Hostile debuff ' + id), interval: [start, duration] });
    }
    return result;
}
const hostileDebuffBands = raw => { const details = hostileDebuffDetails(raw); return details && merge(details.map(item => item.interval)); };
function nextSwingOffsets(applications, swings) {
    return applications.map(time => {
        const next = swings.find(swing => swing >= time);
        return { time, next, offset: Number.isFinite(next) ? next - time : null };
    });
}
function sealsAtWhiteOutcomes(raw) {
    const seals = auras(raw?.tables?.buffs)?.filter(row => /^Seal of /i.test(row.name || ''));
    if (!seals?.length || !seals.some(row => [SPELL.bloodCast, SPELL.martyrCast].includes(spellId(row))) ||
        seals.some(row => !Array.isArray(row.bands) || (row.totalUptime > 0 && !row.bands.length) || row.bands.some(band =>
            !Number.isFinite(band.startTime) || !Number.isFinite(band.endTime) || band.endTime <= band.startTime))) return null;
    const times = eventTimes(raw, SPELL.melee, ['damage', 'miss']);
    if (!times) return null;
    const start = fightOf(raw).startTime;
    const result = { total: times.length, blood: [], command: [], other: [], none: [] };
    for (const time of times) {
        const at = start + time * 1000;
        const active = seals.filter(row => row.bands.some(band => at >= band.startTime && at < band.endTime));
        const kind = active.some(row => [SPELL.bloodCast, SPELL.martyrCast].includes(spellId(row))) ? 'blood' :
            active.some(row => COMMAND_CASTS.has(spellId(row))) ? 'command' : active.length ? 'other' : 'none';
        result[kind].push(time);
    }
    return result;
}
function pairedCommandProcs(command, blood, swings) {
    return command.filter(time => blood.some(proc => Math.abs(proc - time) <= 0.08) && swings.some(swing => Math.abs(swing - time) <= 0.08)).length;
}
function twistApplications(raw) {
    let commandActive = false, commandKnown = false;
    const result = [];
    for (const event of raw.events.data.filter(event => event.sourceID === raw.sourceId).sort((a, b) => a.timestamp - b.timestamp)) {
        const id = spellId(event), time = relativeTime(raw, event);
        if (!Number.isFinite(time) || time < 0 || time > durationOf(raw)) continue;
        if (COMMAND_CASTS.has(id) && ['applybuff', 'refreshbuff'].includes(event.type)) { commandActive = true; commandKnown = true; }
        if (COMMAND_CASTS.has(id) && event.type === 'removebuff') { commandActive = false; commandKnown = true; }
        if ([SPELL.bloodCast, SPELL.martyrCast].includes(id) && event.type === 'cast' && commandKnown && commandActive) result.push(time);
    }
    return result;
}
function postJudgementSealGaps(raw, judgements, whiteSwings) {
    const duration = durationOf(raw);
    const auraEvents = raw.events.data.filter(event => event.sourceID === raw.sourceId && SEAL_CASTS.has(spellId(event)) &&
        ['applybuff', 'refreshbuff', 'removebuff'].includes(event.type) && relativeTime(raw, event) >= 0 && relativeTime(raw, event) <= duration).sort((a, b) => a.timestamp - b.timestamp);
    if (!auraEvents.some(event => event.type === 'applybuff' || event.type === 'refreshbuff')) return [];
    return judgements.map(judgement => {
        const active = new Set();
        let stateKnown = false;
        // Include same-batch removals immediately around Judgement. This asks whether the
        // event stream shows a seal remaining, without assuming every Judgement consumes it.
        for (const event of auraEvents) {
            const time = relativeTime(raw, event);
            if (time > judgement + 0.05) break;
            if (event.type === 'removebuff') active.delete(spellId(event));
            else { active.add(spellId(event)); stateKnown = true; }
        }
        if (!stateKnown || active.size) return null;
        const nextSeal = auraEvents.map(event => ({ event, time: relativeTime(raw, event) })).find(item =>
            item.time > judgement + 0.05 && (item.event.type === 'applybuff' || item.event.type === 'refreshbuff'))?.time;
        if (!Number.isFinite(nextSeal)) return null;
        const swings = whiteSwings.filter(time => time > judgement && time < nextSeal);
        return swings.length ? { judgement, nextSeal, swings } : null;
    }).filter(Boolean);
}
function directMelee(raw) {
    if (!raw?.events?.complete) return null;
    return uniqueTimes(eventTimes(raw, [...DIRECT_MELEE], ['damage', 'miss']) || []);
}
function internalGaps(times, threshold = 5) {
    const result = [];
    for (let index = 1; index < times.length; index++) if (times[index] - times[index - 1] > threshold) result.push([times[index - 1], times[index]]);
    return result;
}
function gcdAdjustedCrusaderDelays(raw, crusaderTimes, whiteSwings, hostileBands) {
    const casts = raw.events.data.filter(event => event.sourceID === raw.sourceId && event.type === 'cast')
        .map(event => ({ id: spellId(event), time: relativeTime(raw, event) })).filter(event => Number.isFinite(event.time));
    const result = [];
    for (let index = 1; index < crusaderTimes.length; index++) {
        const prior = crusaderTimes[index - 1], next = crusaderTimes[index];
        let available = prior + 6;
        // The simulator gives Crusader Strike a six-second cooldown. A conservative full
        // 1.5-second seal/spell GCD avoids blaming a cadence gap that the log itself explains.
        for (const cast of casts.filter(cast => GCD_CASTS.has(cast.id) && cast.time >= available - 1.5 && cast.time < next)) {
            if (cast.time <= available + 0.001) available = Math.max(available, cast.time + 1.5);
            else available = cast.time + 1.5;
        }
        const firstSwing = whiteSwings.find(time => time >= available && time < next);
        if (!Number.isFinite(firstSwing) || next - firstSwing < 0.75) continue;
        const justResumed = hostileBands?.some(band => band[1] <= firstSwing && firstSwing - band[1] < 1.5 && band[0] < available);
        if (!justResumed) result.push({ prior, ready: available, firstSwing, next, delay: next - available });
    }
    return result;
}
function execution(raw) {
    const white = uniqueTimes(eventTimes(raw, SPELL.melee, ['damage', 'miss']) || []);
    const bloodCasts = eventTimes(raw, [SPELL.bloodCast, SPELL.martyrCast], 'cast') || [];
    const twistCasts = twistApplications(raw);
    const commandProcs = eventTimes(raw, SPELL.commandProc, 'damage') || [];
    const bloodProcs = eventTimes(raw, [SPELL.bloodProc, SPELL.martyrProc], 'damage') || [];
    const swaps = nextSwingOffsets(twistCasts, white), near = swaps.filter(item => item.offset !== null && item.offset >= 0 && item.offset <= 0.4);
    const crusader = eventTimes(raw, SPELL.crusaderStrike, 'cast') || [];
    const judgements = eventTimes(raw, SPELL.judgement, 'cast') || [];
    const hostile = hostileDebuffBands(raw);
    const contact = directMelee(raw) || [], gaps = internalGaps(contact);
    return {
        white, bloodCasts, twistCasts, commandProcs, bloodProcs, swaps, near,
        paired: pairedCommandProcs(commandProcs, bloodProcs, white),
        crusader, judgements, hostile, hostileDetails: hostileDebuffDetails(raw), contact, gaps,
        postJudgementGaps: postJudgementSealGaps(raw, judgements, white),
        crusaderDelays: gcdAdjustedCrusaderDelays(raw, crusader, white, hostile),
    };
}

function analyzePaladin(raw = {}) {
    const result = empty();
    if (canonical(raw.player?.classToken || raw.player?.class) !== 'paladin' || canonical(raw.player?.spec) !== 'retribution') return result;
    const duration = durationOf(raw), reference = chooseReference(raw), url = urlOf(raw);
    const evidence = (text, startSec, endSec, source = raw) => ({ text,
        ...(Number.isFinite(startSec) ? { startSec: round(startSec) } : {}),
        ...(Number.isFinite(endSec) ? { endSec: round(endSec) } : {}),
        ...(urlOf(source) ? { url: urlOf(source) } : {}) });
    const add = (id, title, category, priority, action, records, confidence = 'observed') => result.findings.push({
        id, title, category, priority, owner: category === 'support' ? 'raid' : category === 'context' ? 'context' : 'player',
        action, evidence: records, confidence, gainDps: null,
    });
    const compare = (name, player, other, unit, note) => result.comparison.push({ name, player: round(player), reference: round(other), unit, ...(note ? { note } : {}) });
    const check = (id, label, status, reason) => result.checks.push({ id, label, status, reason });

    if (!(duration > 0)) {
        check('ret-execution-events', 'Retribution execution timeline', 'unknown', 'Fight timestamps are unavailable.');
        result.limitations.push('Fight timestamps are unavailable, so Retribution cadence cannot be calculated.');
        return result;
    }
    if (!raw.events?.complete || !Array.isArray(raw.events.data)) {
        check('ret-execution-events', 'Retribution execution timeline', 'unknown', 'A complete outgoing event stream is required for counts and absence claims.');
        for (const [id, label] of [['ret-seal-twist', 'Command to Blood/Martyr timing'], ['ret-crusader-strike', 'Crusader Strike cadence'], ['ret-judgement', 'Judgement cadence'], ['ret-melee-contact', 'Direct melee contact']])
            check(id, label, 'unknown', 'The outgoing event stream is incomplete.');
        result.limitations.push('Outgoing events are incomplete, so seal timing, ability cadence and melee gaps remain unknown.');
        return result;
    }

    const own = execution(raw);
    const other = reference?.events?.complete ? execution(reference) : null;
    check('ret-execution-events', 'Retribution execution timeline', 'checked', raw.events.data.length + ' complete outgoing events were available.');

    const ownNear = own.twistCasts.length ? 100 * own.near.length / own.twistCasts.length : null;
    const otherNear = other?.twistCasts.length ? 100 * other.near.length / other.twistCasts.length : null;
    const ownPair = own.commandProcs.length ? 100 * own.paired / own.commandProcs.length : null;
    const otherPair = other?.commandProcs.length ? 100 * other.paired / other.commandProcs.length : null;
    compare('Command to Blood/Martyr applications within 0.4s before a white swing', ownNear, otherNear, '%', 'Only Blood/Martyr casts with a previously observed active Command aura are classified as twist applications. The 0.4-second window comes from the simulator seal-overlap implementation; this is timing evidence, not aura-uptime grading.');
    compare('Command procs paired with Blood/Martyr damage on the same swing', ownPair, otherPair, '%', 'A paired proc requires Command, Blood/Martyr and a white swing within 80ms in the complete event stream.');
    if (!own.twistCasts.length) check('ret-seal-twist', 'Command to Blood/Martyr timing', 'unknown', own.bloodCasts.length ? 'Blood/Martyr casts were recorded, but none had a previously observed active Command aura; twist intent is not inferred.' : 'No Blood or Martyr application was recorded; faction, build and seal availability are not inferred.');
    else {
        check('ret-seal-twist', 'Command to Blood/Martyr timing', 'checked', own.near.length + ' of ' + own.twistCasts.length + ' observed Command-to-Blood/Martyr applications landed within 0.4 seconds before the next recorded white swing; ' + own.paired + ' of ' + own.commandProcs.length + ' Command damage procs had paired Blood/Martyr damage.');
        const materiallyBehind = other && ((ownNear !== null && otherNear !== null && ownNear + 5 < otherNear) || (ownPair !== null && otherPair !== null && ownPair + 10 < otherPair));
        if (materiallyBehind) {
            const misses = own.swaps.filter(item => item.offset === null || item.offset > 0.4).slice(0, 3);
            const records = [
                evidence(own.near.length + ' of ' + own.twistCasts.length + ' observed Command-to-Blood/Martyr applications were within 0.4 seconds before the next white swing.'),
                evidence(own.paired + ' of ' + own.commandProcs.length + ' Command damage procs were paired with Blood/Martyr damage on the same recorded swing.'),
                evidence(reference.player?.name + ': ' + other.near.length + ' of ' + other.twistCasts.length + ' observed Command-to-Blood/Martyr applications in-window and ' + other.paired + ' of ' + other.commandProcs.length + ' Command procs paired.', undefined, undefined, reference),
                ...misses.map(item => {
                    const effects = (own.hostileDetails || []).filter(effect => item.time >= effect.interval[0] && item.time <= effect.interval[1]).map(effect => effect.label);
                    return evidence('Blood/Martyr applied at ' + round(item.time) + 's; ' + (item.offset === null ? 'no later white swing was recorded.' : 'the next white swing was ' + round(item.offset) + 's later at ' + round(item.next) + 's.') + (effects.length ? ' The application occurred during ' + effects.join(' and ') + '.' : ''), item.time, item.next);
                }),
            ];
            add('ret-seal-twist-execution', 'Command-to-Blood twist completion trails the reference', 'execution', 'high',
                'Use a swing timer and apply Blood/Martyr inside the final 0.4 seconds before the white swing. Judge aura coverage by the alternating seal sequence; do not chase 100% Blood uptime.', records);
            for (const time of own.commandProcs.filter(command => !own.bloodProcs.some(proc => Math.abs(proc - command) <= 0.08)))
                result.timeline.push({ label: 'Command proc without paired Blood/Martyr damage', startSec: round(time), endSec: round(time + 0.1), kind: 'execution' });
        }
    }

    const rate = (times, fightDuration) => fightDuration > 0 ? times.length * 60 / fightDuration : null;
    compare('Crusader Strike casts', own.crusader.length, other?.crusader.length, 'casts', 'Button presses from complete cast events. The simulator implements a six-second cooldown.');
    compare('Crusader Strike casts per minute', rate(own.crusader, duration), other ? rate(other.crusader, durationOf(reference)) : null, '/min');
    check('ret-crusader-strike', 'Crusader Strike cadence', 'checked', own.crusader.length + ' casts; ' + own.crusaderDelays.length + ' cooldown-ready interval(s) retained melee evidence after conservative logged GCD allowance. Mechanic overlap means these are review windows, not confirmed missed casts.');
    if (own.crusaderDelays.length) {
        add('ret-crusader-strike-cadence', own.crusaderDelays.length + ' Crusader Strike cadence window' + (own.crusaderDelays.length === 1 ? '' : 's') + ' need' + (own.crusaderDelays.length === 1 ? 's' : '') + ' replay review', 'context', 'medium',
            'Replay the cooldown-ready tail, including any recorded mechanic overlap. If the boss is safely reachable and mana is available, keep Crusader Strike ready as the six-second cooldown ends.',
            [evidence(own.crusader.length + ' Crusader Strike casts (' + round(rate(own.crusader, duration)) + '/min) versus ' + (other ? other.crusader.length + ' (' + round(rate(other.crusader, durationOf(reference))) + '/min)' : 'no complete reference timeline') + '.'),
                ...own.crusaderDelays.map(item => {
                    const overlaps = (own.hostileDetails || []).filter(effect => length(intersect([[item.ready, item.next]], [effect.interval])) > 0)
                        .map(effect => effect.label + ' ' + round(Math.max(item.ready, effect.interval[0])) + '–' + round(Math.min(item.next, effect.interval[1])) + 's');
                    return evidence('Crusader Strike used at ' + round(item.prior) + 's was ready after logged GCD allowance by ' + round(item.ready) + 's; a white swing landed at ' + round(item.firstSwing) + 's before the next Crusader Strike at ' + round(item.next) + 's.' + (overlaps.length ? ' Recorded mechanic overlap: ' + overlaps.join(', ') + '.' : ''), item.ready, item.next);
                })]);
        result.timeline.push(...own.crusaderDelays.map(item => ({ label: 'Crusader Strike cadence review', startSec: round(item.ready), endSec: round(item.next), kind: 'context' })));
    }

    const intervals = times => times.slice(1).map((time, index) => time - times[index]);
    const minimum = times => { const values = intervals(times); return values.length ? Math.min(...values) : null; };
    compare('Judgement casts', own.judgements.length, other?.judgements.length, 'casts', 'Judgement button presses; Blood/Martyr and Command damage rows are outcomes, not extra Judgement casts.');
    compare('Shortest observed Judgement interval', minimum(own.judgements), other ? minimum(other.judgements) : null, 'seconds', 'The simulator uses a ten-second base cooldown reduced by one second per Improved Judgement rank. The shortest observed interval does not expose the talent rank directly.');
    check('ret-judgement', 'Judgement cadence', 'checked', own.judgements.length + ' casts; shortest observed interval ' + (minimum(own.judgements) === null ? 'unavailable' : round(minimum(own.judgements)) + ' seconds') + '.');
    if (own.postJudgementGaps.length) {
        const unsealedSwings = own.postJudgementGaps.reduce((total, gap) => total + gap.swings.length, 0);
        const otherUnsealed = other ? other.postJudgementGaps.reduce((total, gap) => total + gap.swings.length, 0) : null;
        const cleanGap = raw.incoming?.complete ? own.postJudgementGaps.filter(gap => gap.nextSeal - gap.judgement >= 1.5 &&
            !(own.hostileDetails || []).some(effect => length(intersect([[gap.judgement, gap.nextSeal]], [effect.interval])) > 0))
            .sort((a, b) => (b.nextSeal - b.judgement) - (a.nextSeal - a.judgement))[0]
            : null;
        compare('White-swing outcomes before resealing after Judgement', unsealedSwings, otherUnsealed, 'outcomes', 'Only windows where the aura-event state showed no seal remaining are counted. Windfury can create more than one white outcome at a timestamp.');
        add('ret-post-judgement-seal', 'White swings occurred before resealing after Judgement', cleanGap ? 'execution' : 'context', cleanGap ? 'high' : 'medium',
            (cleanGap ? 'Practice the clean ' + round(cleanGap.judgement) + '–' + round(cleanGap.nextSeal) + 's reseal window first: ' : 'Practice a mechanic-free reseal window first: ') + 'queue the next seal immediately after a Judgement that consumes the active seal. Treat mechanic-overlapped and sub-second examples as timing context.',
            own.postJudgementGaps.map(gap => {
                const effects = (own.hostileDetails || []).filter(effect => length(intersect([[gap.judgement, gap.nextSeal]], [effect.interval])) > 0).map(effect => effect.label);
                return evidence('Judgement at ' + round(gap.judgement) + 's left no recorded seal aura; ' + gap.swings.length + ' white-swing outcome' + (gap.swings.length === 1 ? '' : 's') + ' at ' + gap.swings.map(round).join(', ') + 's preceded the next seal at ' + round(gap.nextSeal) + 's.' + (effects.length ? ' This window overlapped ' + effects.join(' and ') + '.' : ''), gap.judgement, gap.nextSeal);
            }));
        result.timeline.push(...own.postJudgementGaps.map(gap => ({ label: 'No seal after Judgement (' + gap.swings.length + ' white outcome' + (gap.swings.length === 1 ? '' : 's') + ')', startSec: round(gap.judgement), endSec: round(gap.nextSeal), kind: cleanGap ? 'execution' : 'context' })));
    }
    const swingSeals = sealsAtWhiteOutcomes(raw), referenceSeals = reference && sealsAtWhiteOutcomes(reference);
    if (!swingSeals) check('ret-seal-at-swing', 'Seal active at white-swing outcomes', 'unknown', 'Complete white-attack events and recorded Blood/Martyr seal bands are required.');
    else {
        check('ret-seal-at-swing', 'Seal active at white-swing outcomes', 'checked', swingSeals.blood.length + ' of ' + swingSeals.total + ' white outcomes had Blood/Martyr active; ' + swingSeals.command.length + ' had Command alone; ' + swingSeals.none.length + ' had no recorded seal.');
        for (const [kind, label] of [['blood', 'Blood/Martyr active'], ['command', 'Command only'], ['none', 'no recorded seal']]) compare('White outcomes with ' + label, swingSeals[kind].length, referenceSeals ? referenceSeals[kind].length : null, 'outcomes', 'Aura state at each recorded white outcome, including extra attacks; not a count of swing-timer cycles or guaranteed seal procs.');
        if (swingSeals.command.length) {
            const clean = raw.incoming?.complete ? swingSeals.command.filter(time => !(own.hostileDetails || []).some(effect => time >= effect.interval[0] && time <= effect.interval[1])) : [];
            const commands = eventTimes(raw, [...COMMAND_CASTS], 'cast') || [];
            const separateOutcomes = times => uniqueTimes(times).filter((time, index, all) => !index || time - all[index - 1] > 0.08);
            const samples = separateOutcomes(clean.length ? clean : swingSeals.command).slice(0, 3);
            // A coaching threshold, not a simulated DPS threshold. Extra attacks can
            // duplicate outcomes, so require at least three separate clean timestamps.
            const ownShare = swingSeals.command.length / swingSeals.total;
            const referenceShare = referenceSeals?.total ? referenceSeals.command.length / referenceSeals.total : null;
            const repeated = separateOutcomes(clean).length >= 3 && ownShare >= 0.1 &&
                (referenceShare === null || ownShare - referenceShare >= 0.05);
            add('ret-seal-at-swing', 'Keep Blood/Martyr active on ordinary white swings', repeated ? 'execution' : 'context', repeated ? 'high' : 'medium',
                'Keep Blood/Martyr for swings you cannot twist. Start the Command switch only when the GCD and swing timer allow Blood/Martyr to be reapplied before the next white swing. Check mana and mechanics in the marked examples.',
                [evidence(swingSeals.blood.length + '/' + swingSeals.total + ' white outcomes had Blood/Martyr active, ' + swingSeals.command.length + ' had Command alone and ' + swingSeals.none.length + ' had no recorded seal.'),
                    ...(referenceSeals ? [evidence(reference.player.name + ': ' + referenceSeals.blood.length + '/' + referenceSeals.total + ' with Blood/Martyr, ' + referenceSeals.command.length + ' Command-only and ' + referenceSeals.none.length + ' without a recorded seal.', undefined, undefined, reference)] : []),
                    ...samples.map(time => { const prior = commands.filter(cast => cast <= time).at(-1), next = own.bloodCasts.find(cast => cast > time); return evidence('White outcome at ' + round(time) + 's had Command alone.' + (Number.isFinite(prior) ? ' Command was cast at ' + round(prior) + 's.' : '') + (Number.isFinite(next) ? ' Blood/Martyr returned at ' + round(next) + 's.' : ''), Number.isFinite(prior) ? prior : time, Number.isFinite(next) ? next : time); })]);
        }
    }
    for (const time of own.judgements) result.timeline.push({ label: 'Judgement cast', startSec: round(time), endSec: round(time + 0.1), kind: 'ability' });

    const ownGaps = own.gaps, otherGaps = other?.gaps || [], ownGapTotal = length(ownGaps), otherGapTotal = length(otherGaps);
    const hostileOverlap = own.hostile ? length(intersect(ownGaps, own.hostile)) : null;
    compare('Time spanned by internal direct-melee gaps over 5s', ownGapTotal, other ? otherGapTotal : null, 'seconds', 'Each span is bounded by observed direct melee events; normal swing spacing remains at both edges.');
    check('ret-melee-contact', 'Direct melee contact', 'checked', own.contact.length + ' direct melee timestamps; ' + ownGaps.length + ' internal gap(s) over five seconds' + (hostileOverlap === null ? '; hostile-debuff overlap unknown.' : '; ' + round(hostileOverlap) + ' seconds overlapped recorded hostile debuffs.'));
    if (ownGaps.length && (!other || ownGapTotal > otherGapTotal + 5)) {
        const records = ownGaps.map(gap => {
            const overlap = own.hostile ? length(intersect([gap], own.hostile)) : null;
            const effects = (own.hostileDetails || []).filter(effect => length(intersect([gap], [effect.interval])) > 0).map(effect => effect.label);
            return evidence('No direct melee damage from ' + round(gap[0]) + 's to ' + round(gap[1]) + 's (' + round(gap[1] - gap[0]) + 's span)' + (overlap === null ? '; hostile-debuff coverage is unknown.' : '; ' + round(overlap) + 's overlapped ' + (effects.length ? [...new Set(effects)].join(' and ') : 'recorded hostile debuffs') + '.'), gap[0], gap[1]);
        });
        if (other) records.push(evidence(reference.player?.name + ' had ' + round(otherGapTotal) + ' seconds across ' + otherGaps.length + ' internal gap(s) over five seconds.', undefined, undefined, reference));
        add('ret-melee-contact-gaps', ownGaps.length + ' long spans between direct melee events need replay review', 'execution', 'high',
            'Review these timestamps for hostile effects, target access and movement. Re-enter melee as soon as the boss is safely reachable; shorten only the portion the replay confirms was avoidable.', records);
        result.timeline.push(...ownGaps.map(gap => ({ label: 'Gap between direct melee events', startSec: round(gap[0]), endSec: round(gap[1]), kind: 'contact-gap' })));
    }

    const cooldowns = [
        [SPELL.avengingWrath, 'Avenging Wrath'], [SPELL.bloodlust, 'Bloodlust'], [SPELL.heroism, 'Heroism'],
        [SPELL.hastePotion, 'Haste Potion'], [SPELL.lustForBattle, 'Lust for Battle'],
    ];
    const ownAw = auraBands(raw, SPELL.avengingWrath), ownLust = auraBands(raw, [SPELL.bloodlust, SPELL.heroism]), ownPotion = auraBands(raw, SPELL.hastePotion);
    const otherAw = reference ? auraBands(reference, SPELL.avengingWrath) : null, otherLust = reference ? auraBands(reference, [SPELL.bloodlust, SPELL.heroism]) : null;
    const overlapShare = (left, right) => left?.length && right?.length ? 100 * length(intersect(left, right)) / length(left) : null;
    compare('Avenging Wrath overlap with Bloodlust/Heroism', overlapShare(ownAw, ownLust), overlapShare(otherAw, otherLust), '%', 'Share of recorded Avenging Wrath aura time.');
    compare('Haste Potion overlap with Avenging Wrath', overlapShare(ownPotion, ownAw), reference ? overlapShare(auraBands(reference, SPELL.hastePotion), otherAw) : null, '%', 'Share of recorded potion aura time.');
    if (!auras(raw.tables?.buffs)) check('ret-cooldown-window', 'Retribution cooldown windows', 'unknown', 'Buff aura bands are unavailable.');
    else {
        const awUses = eventTimes(raw, SPELL.avengingWrath, 'cast')?.length || 0;
        check('ret-cooldown-window', 'Retribution cooldown windows', 'checked', awUses + ' Avenging Wrath cast(s); ' + (overlapShare(ownAw, ownLust) === null ? 'Bloodlust/Heroism overlap unavailable.' : round(overlapShare(ownAw, ownLust)) + '% of Avenging Wrath overlapped Bloodlust/Heroism.'));
        for (const [id, label] of cooldowns) for (const band of auraBands(raw, id) || []) result.timeline.push({ label, startSec: round(band[0]), endSec: round(band[1]), kind: 'cooldown' });
    }

    if (!reference) result.limitations.push('No same-spec, same-encounter reference with a damage table was supplied. Player timing remains available without comparative values.');
    else if (!reference.events?.complete) result.limitations.push('The reference outgoing stream is incomplete, so reference cadence and twist timing are unknown.');
    if (!raw.incoming?.complete) result.limitations.push('The hostile-debuff stream is incomplete, so melee-gap overlap with control or movement effects is unknown.');
    result.limitations.push('Seal timing is inferred from WCL event proximity. The simulator retains a twistable previous seal for 399ms; WCL timestamps and batching do not prove player intent.');
    result.limitations.push('Crusader Strike and Judgement timing does not establish mana availability, latency, target availability or causal DPS gained. No DPS gain is assigned to these observations.');
    result.timeline.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec || a.label.localeCompare(b.label));
    return result;
}

module.exports = { analyzePaladin };
