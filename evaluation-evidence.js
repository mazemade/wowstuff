'use strict';
const { selectReferences } = require('./evaluation-reference.js');
/**
 * Evidence-only player coaching. analyzeFight accepts WCL fightAndTables context/tables,
 * report/fight/source identifiers, player {classToken,spec}, and optional references.
 * events/incoming are fully paginated {data: [...], complete: boolean} streams; timestamps
 * are WCL report milliseconds. Absence-of-event findings require complete === true.
 * Buff-table bands are report milliseconds, CI gear uses WCL slots (boots = 7).
 * Findings never assign a causal DPS gain. A separately validated simulator may attach it.
 */
const SPELL = Object.freeze({ heroic: 29707, melee: 1, bt: 30335, ww: 1680,
    shout: 2048, reck: 1719, deathWish: 12292, potion: 28507, agility: 28497,
    demonslaying: 11406, lotp: 24932, ur: 30807 });
const NAMES = { 1: 'Melee', 29707: 'Heroic Strike', 30335: 'Bloodthirst', 1680: 'Whirlwind',
    44949: 'Whirlwind Off-Hand', 20647: 'Execute', 12292: 'Death Wish', 1719: 'Recklessness',
    2825: 'Bloodlust', 32182: 'Heroism', 20572: 'Blood Fury', 35166: 'Bloodlust Brooch',
    28507: 'Haste Potion', 2048: 'Battle Shout', 24932: 'Leader of the Pack', 30807: 'Unleashed Rage' };
const CONTACT = new Set([1, 29707, 30335, 1680, 44949, 20647, 25231, 78, 845]);
const CONTROL = { 31480: 'War Stomp', 31249: 'Icebolt', 31477: 'Cripple' };
const DEMONS = new Set(['anetheron', "kaz'rogal", 'azgalor', 'archimonde']);
const round = x => Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const id = x => Number(x && (x.abilityGameID ?? x.guid ?? x.ability?.guid ?? x.ability));
const body = t => t && t.data && !Array.isArray(t.data) ? t.data : t;
const entries = t => Array.isArray(body(t)?.entries) ? body(t).entries : [];
const auras = t => Array.isArray(body(t)?.auras) ? body(t).auras : [];
const knownBuffs = t => Array.isArray(body(t)?.auras);
const canonical = x => String(x || '').replace(/[^a-z]/gi, '').toLowerCase();
function merge(intervals) {
    const out = [];
    for (const x of intervals.filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0])) {
        const last = out[out.length - 1];
        if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
        else out.push(x.slice());
    }
    return out;
}
const length = xs => merge(xs).reduce((sum, x) => sum + x[1] - x[0], 0);
function intersect(a, b) {
    return merge(a.flatMap(x => b.map(y => [Math.max(x[0], y[0]), Math.min(x[1], y[1])])));
}
function complement(intervals, duration) {
    const out = []; let at = 0;
    for (const [start, end] of merge(intervals)) { if (start > at) out.push([at, start]); at = Math.max(at, end); }
    if (at < duration) out.push([at, duration]);
    return out;
}
function fightOf(raw) {
    return (raw.context?.fights || []).find(f => f.id === raw.fightId) || raw.context?.fights?.[0] || {};
}
function actorRow(raw) {
    return entries(raw.context?.dmgAll).find(x => x.id === raw.sourceId || (!raw.sourceId && x.name === (raw.name || raw.player?.name)));
}
function describe(raw) {
    const fight = fightOf(raw), duration = (fight.endTime - fight.startTime) / 1000;
    const row = actorRow(raw), total = num(row?.total) ?? (Array.isArray(body(raw.tables?.dmg)?.entries)
        ? entries(raw.tables.dmg).reduce((sum, e) => sum + (num(e.total) || 0), 0) : null);
    const icon = String(row?.icon || '').split('-');
    return { raw, fight, duration: duration > 0 ? duration : null,
        dps: duration > 0 && total !== null ? total / duration : null,
        spec: canonical(raw.player?.spec || icon[1]), classToken: canonical(raw.player?.classToken || icon[0]),
        name: raw.player?.name || row?.name || raw.name || 'Reference',
        url: raw.reportCode ? 'https://classic.warcraftlogs.com/reports/' + encodeURIComponent(raw.reportCode) + '#fight=' + encodeURIComponent(raw.fightId) + '&source=' + encodeURIComponent(raw.sourceId) : undefined };
}
function bands(table, ids, info) {
    if (!info.duration) return [];
    return merge(auras(table).filter(x => ids.includes(id(x))).flatMap(x => (x.bands || []).map(b => [
        Math.max(0, (b.startTime - info.fight.startTime) / 1000),
        Math.min(info.duration, (b.endTime - info.fight.startTime) / 1000) ])));
}
function uptime(table, ids, info) {
    if (!knownBuffs(table) || !info.duration) return null;
    const rows = auras(table).filter(x => ids.includes(id(x)));
    if (!rows.length) return 0;
    if (rows.every(x => Array.isArray(x.bands))) return 100 * length(bands(table, ids, info)) / info.duration;
    // A single aura's reported total is usable; multiple overlapping sources cannot be added.
    if (rows.length === 1 && num(rows[0].totalUptime) !== null) return Math.min(100, 100 * rows[0].totalUptime / (info.duration * 1000));
    return null;
}
function ability(table, spell) {
    const rows = entries(table).filter(x => id(x) === spell);
    if (!rows.length) return null;
    const sum = key => rows.reduce((n, x) => n + (num(x[key]) || 0), 0);
    return { attempts: sum('hitCount') + sum('missCount'), crits: sum('critHitCount'),
        dodges: rows.reduce((n, x) => n + (x.missdetails || []).filter(d => d.type === 'Dodge').reduce((s, d) => s + (num(d.count) || 0), 0), 0), total: sum('total') };
}
function controlBands(raw, info) {
    const stream = raw.incoming;
    if (!stream?.complete || !info.duration) return [];
    const opened = new Map(), result = [];
    const events = (stream.data || []).filter(e => e.targetID === raw.sourceId && CONTROL[id(e)])
        .sort((a, b) => a.timestamp - b.timestamp);
    for (const e of events) {
        const spell = id(e), key = spell + ':' + (e.sourceID ?? ''), sec = Math.max(0, Math.min(info.duration, (e.timestamp - info.fight.startTime) / 1000));
        if (e.type === 'applydebuff') { if (!opened.has(key)) opened.set(key, sec); }
        else if (e.type === 'removedebuff') {
            // Without an apply event the initial state is unknown; do not invent time at pull.
            if (opened.has(key)) result.push({ spell, label: CONTROL[spell], interval: [opened.get(key), sec] });
            opened.delete(key);
        }
    }
    for (const [key, start] of opened) { const spell = Number(key.split(':')[0]); result.push({ spell, label: CONTROL[spell], interval: [start, info.duration] }); }
    return result;
}
function analyzeFight(raw = {}) {
    const info = describe(raw), tables = raw.tables || {}, comparison = [], findings = [], timeline = [], limitations = [];
    const sourceEvidence = (text, interval) => ({ text, ...(interval ? { startSec: round(interval[0]), endSec: round(interval[1]) } : {}), ...(info.url ? { url: info.url } : {}) });
    const add = (id, title, owner, action, evidence, confidence = 'observed') => findings.push({ id, title, owner, action, evidence, confidence, gainDps: null,
        ...(['battle-shout-gap', 'recklessness-contact'].includes(id) ? { category: 'execution', priority: 'high',
            disposition: id === 'battle-shout-gap' ? 'improve' : 'review',
            why: id === 'battle-shout-gap' ? 'The recorded Shout bands leave part of the pull outside its attack-power buff. Confirm who owns the refresh so the next damage window starts with it active.' : 'The temporary critical-strike buff overlapped gaps between direct attacks. Mechanics or target access may explain those gaps; the entire overlap is not automatically avoidable.',
            verification: id === 'battle-shout-gap' ? 'On the next comparable pull, check Shout coverage before each burst and avoid the same recorded refresh gap.' : 'Compare the next activation with safe melee contact and the encounter assignment.',
            alternatives: id === 'battle-shout-gap' ? ['Another warrior may own the stronger Shout; coordinate the refresh rather than overwriting blindly.'] : ['A required hold, movement or control effect can explain this overlap.'] } : {}) });
    const refs = selectReferences(raw).accepted.map(describe).filter(r => r.duration && r.dps !== null &&
        (!info.fight.name || r.fight.name === info.fight.name) &&
        (!info.spec || r.spec === info.spec) && (!info.classToken || r.classToken === info.classToken))
        .sort((a, b) => Number(b.raw.kind === 'benchmark') - Number(a.raw.kind === 'benchmark') || Math.abs(a.duration - info.duration) - Math.abs(b.duration - info.duration));
    const ref = refs[0];
    const compare = (name, player, reference, unit, note = '') => comparison.push({ name, player: round(player), reference: round(reference), unit,
        note: [ref ? 'Compared with ' + ref.name + '.' : 'No compatible named reference.', note].filter(Boolean).join(' ') });
    compare('Damage per second', info.dps, ref?.dps, 'DPS');
    compare('Fight duration', info.duration, ref?.duration, 'seconds', 'Different durations change cooldown and execute-phase proportions.');
    if (!info.duration) limitations.push('Fight timestamps are missing or invalid; duration, DPS and timeline analysis are unavailable.');
    if (!ref) limitations.push('No compatible named reference with a valid duration was available; no comparative deficit is inferred.');
    else {
        add('reference-context', 'Comparison uses a real player pull', 'context', 'Use the named pull to inspect gear, support and outcomes before treating the DPS gap as recoverable.', [
            sourceEvidence(info.name + ': ' + round(info.dps) + ' DPS over ' + round(info.duration) + ' seconds.'),
            { text: ref.name + ': ' + round(ref.dps) + ' DPS over ' + round(ref.duration) + ' seconds.', ...(ref.url ? { url: ref.url } : {}) } ]);
    }
    const fury = info.classToken === 'warrior' && info.spec === 'fury';
    const ci = tables.ci?.data?.find(x => x.sourceID === raw.sourceId) || tables.ci?.data?.find(x => x.sourceID == null);
    const gear = ci?.gear || actorRow(raw)?.gear;
    const boots = Array.isArray(gear) ? (gear.find(x => x.slot === 7) || (gear.length >= 18 ? gear[7] : null)) : null;
    if (boots?.id > 0 && !boots.permanentEnchant) add('boots-enchant', 'Boots have no recorded permanent enchant', 'player',
        fury ? 'Enchant the boots; compare +12 Agility with a movement-speed option for your encounters.' : 'Apply an appropriate permanent boot enchant for your role.',
        [sourceEvidence('Combatant gear records boot item ' + boots.id + ' without a permanent enchant.')]);
    if (!ci) limitations.push('Combatant information is unavailable; pull consumables and exact equipment preparation may be incomplete.');
    if (!knownBuffs(tables.buffs)) limitations.push('Buff coverage is unavailable; missing buffs or potions cannot be established from this response.');
    if (!raw.events?.complete) limitations.push('Outgoing events are incomplete or unavailable; melee contact gaps and event absence are not evaluated.');
    if (!raw.incoming?.complete) limitations.push('Incoming events are incomplete or unavailable; the cause of contact gaps cannot be reliably classified.');
    if (!fury) limitations.push('Detailed resource and rotation coaching is currently implemented for TBC Fury Warriors only; no Fury-specific advice is applied to this spec.');
    if (fury) {
        limitations.push('Rage telemetry is not trusted by this analysis. It cannot establish rage capping, starvation, or whether another Heroic Strike was affordable.');
        limitations.push('Ability counts and critical outcomes are observations, not causal DPS losses. Gear, buffs, contact, cooldowns and random outcomes interact.');
        limitations.push('Talent-tree totals do not establish individual talent ranks. No downranking or incorrect-build claim is inferred from damage per hit.');
        for (const spell of [1, 29707, 30335, 1680, 44949, 20647]) {
            const own = ability(tables.dmg, spell), other = ref && ability(ref.raw.tables?.dmg, spell);
            if (!own && !other) continue;
            const name = NAMES[spell];
            compare(name + ' attempts', own?.attempts, other?.attempts, 'attempts', 'Landed hits plus misses; off-hand and multi-target hits are not extra button presses.');
            compare(name + ' critical hits', own?.crits, other?.crits, 'crits');
            compare(name + ' dodges', own?.dodges, other?.dodges, 'dodges');
            compare(name + ' damage', own && info.duration ? own.total / info.duration : null,
                other && ref?.duration ? other.total / ref.duration : null, 'DPS', 'Descriptive damage difference; not the gain from pressing this ability more.');
        }
        for (const [spell, title, action] of [[SPELL.lotp, 'Leader of the Pack', 'Arrange feral support with the raid leader and check that the aura reaches you while attacking.'],
            [SPELL.ur, 'Unleashed Rage', 'Arrange enhancement support with the raid leader and check uptime while attacking.']]) {
            const own = uptime(tables.buffs, [spell], info), other = ref ? uptime(ref.raw.tables?.buffs, [spell], ref) : null;
            compare(title + ' coverage', own, other, '%');
            if (own !== null && own < 1 && (other === null || other > 80)) add('support-' + spell, title + ' was absent', 'raid', action,
                [sourceEvidence('Recorded coverage: ' + round(own) + '%.'), ...(other !== null ? [{ text: ref.name + ' had ' + round(other) + '% coverage.', ...(ref.url ? { url: ref.url } : {}) }] : [])]);
        }
        const potion = uptime(tables.buffs, [SPELL.potion], info), potCasts = entries(tables.casts).filter(x => id(x) === SPELL.potion).reduce((sum, x) => sum + (x.total || 0), 0);
        const lust = bands(tables.buffs, [2825, 32182], info);
        if (potion === 0 && !potCasts) add('haste-potion', 'No Haste Potion was recorded', 'player',
            'Use a Haste Potion during a sustained melee burst window' + (lust.length ? ' near ' + round(lust[0][0]) + ' seconds, with Bloodlust or Heroism' : ', coordinated with Bloodlust or Heroism') + '. Preserve any encounter-required potion use.',
            [sourceEvidence('No aura 28507 was present. Dragonstrike haste (21165) is a weapon proc and does not count as a potion.')]);
        const agility = uptime(tables.buffs, [SPELL.agility], info);
        if (agility !== null && agility > 0) {
            compare('Major Agility coverage', agility, ref ? uptime(ref.raw.tables?.buffs, [SPELL.agility], ref) : null, '%', 'Aura 28497 is logged as Mighty Agility; it is an offensive battle elixir.');
            if (DEMONS.has(String(info.fight.name || '').toLowerCase()) && (uptime(tables.buffs, [SPELL.demonslaying], info) || 0) < 1)
                add('demonslaying-elixir', 'Evaluate a demon-specific battle elixir', 'player', 'Use Elixir of Demonslaying immediately before this demon boss if the controlled equipment model confirms the gain. It replaces Major Agility; do not assume they stack.',
                    [sourceEvidence('Major Agility was active for ' + round(agility) + '% of this demon encounter.')], 'inferred');
        }
        const shoutRows = auras(tables.buffs).filter(x => id(x) === SPELL.shout);
        const shout = bands(tables.buffs, [SPELL.shout], info);
        if (info.duration && knownBuffs(tables.buffs) && shoutRows.length && shoutRows.every(x => Array.isArray(x.bands))) {
            const missing = complement(shout, info.duration).filter(x => x[1] - x[0] >= 3);
            compare('Battle Shout coverage', uptime(tables.buffs, [SPELL.shout], info), ref ? uptime(ref.raw.tables?.buffs, [SPELL.shout], ref) : null, '%');
            if (missing.length) {
                add('battle-shout-gap', 'Battle Shout was missing for ' + round(length(missing)) + ' seconds', 'player',
                    'Coordinate Battle Shout ownership and refresh before it expires, particularly before the next burst window.', missing.map(x => sourceEvidence('Battle Shout absent from ' + round(x[0]) + ' to ' + round(x[1]) + ' seconds.', x)));
                timeline.push(...missing.map(x => ({ label: 'Battle Shout absent', startSec: round(x[0]), endSec: round(x[1]), kind: 'buff-gap' })));
            }
        }
        for (const spell of [2825, 32182, 12292, 1719, 20572, 35166, 28507]) timeline.push(...bands(tables.buffs, [spell], info).map(x => ({ label: NAMES[spell], startSec: round(x[0]), endSec: round(x[1]), kind: 'cooldown' })));
        if (raw.events?.complete && info.duration) {
            const contacts = [...new Set((raw.events.data || []).filter(e => e.sourceID === raw.sourceId && (e.type === 'damage' || e.type === 'miss') && CONTACT.has(id(e)))
                .map(e => (e.timestamp - info.fight.startTime) / 1000).filter(x => x >= 0 && x <= info.duration))].sort((a, b) => a - b);
            const gaps = [];
            // Bound observed gaps by two direct-melee events. An opener or final tail alone
            // cannot prove the boss was available, so it is a neutral timing fact below.
            for (let i = 1; i < contacts.length; i++) if (contacts[i] - contacts[i - 1] > 5) gaps.push([contacts[i - 1], contacts[i]]);
            if (!contacts.length) limitations.push('No direct melee events were found in the complete outgoing stream; melee contact cannot be reconstructed.');
            if (contacts.length) compare('First direct melee event', contacts[0], null, 'seconds', 'Availability and approach time are not inferred from the opener.');
            const controls = controlBands(raw, info);
            const union = merge(controls.map(x => x.interval));
            timeline.push(...controls.map(x => ({ label: x.label, startSec: round(x.interval[0]), endSec: round(x.interval[1]), kind: 'mechanic' })));
            if (union.length) add('control-exposure', 'Recorded control effects covered ' + round(length(union)) + ' seconds', 'context',
                'Review these mechanic windows before treating low ability counts or melee gaps as execution mistakes. Overlapping effects are counted once.',
                controls.map(x => sourceEvidence(x.label + ': ' + round(x.interval[0]) + '–' + round(x.interval[1]) + ' seconds.', x.interval)));
            if (gaps.length) {
                const overlap = length(intersect(gaps, union));
                add('melee-contact-gaps', 'There were ' + gaps.length + ' gaps longer than 5 seconds between melee events', 'context',
                    'Review the marked windows for movement, crowd control and target availability. Resume melee promptly when mechanics permit; the log alone does not prove these gaps were avoidable.',
                    [...gaps.map(x => sourceEvidence('No direct melee event between ' + round(x[0]) + ' and ' + round(x[1]) + ' seconds.', x)),
                        sourceEvidence('Gap lengths include normal swing spacing at their edges. Recorded control effects overlap ' + round(overlap) + ' seconds; this is not an estimate of avoidable downtime.')]);
                timeline.push(...gaps.map(x => ({ label: 'Gap between melee events', startSec: round(x[0]), endSec: round(x[1]), kind: 'contact-gap' })));
                const wasted = intersect(gaps, bands(tables.buffs, [SPELL.reck], info));
                if (length(wasted) >= 3) add('recklessness-contact', 'Recklessness overlapped melee-event gaps for ' + round(length(wasted)) + ' seconds', 'player',
                    'Plan Recklessness for a window with sustained melee contact. If mechanics interrupt that window, adjust its timing on the next pull.',
                    wasted.map(x => sourceEvidence('Recklessness active with no direct melee event inside this interval.', x)));
            }
        }
    }
    limitations.push('No causal DPS gains are calculated from these observations. A controlled simulation and its assumptions are required before attaching estimated gains.');
    return { observed: { dps: round(info.dps), referenceDps: round(ref?.dps), gapDps: ref && info.dps !== null ? round(ref.dps - info.dps) : null },
        comparison, findings, timeline: timeline.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec), limitations };
}
module.exports = { analyzeFight };
