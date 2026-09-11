'use strict';

// Reconcile the observed gap before offering counterfactual changes. Frequency and
// yield are an arithmetic description of outcomes, never a causal loss estimate.
const { selectReferences } = require('./evaluation-reference.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const entries = table => Array.isArray(table?.data?.entries) ? table.data.entries : null;
const spellId = row => Number(row?.guid ?? row?.abilityGameID ?? row?.ability?.guid);
const fightOf = raw => raw?.context?.fights?.find(f => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const f = fightOf(raw); return f && (f.endTime - f.startTime) / 1000; };
const urlOf = raw => 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
const canonical = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function chooseReference(raw) {
    const duration = durationOf(raw), fight = fightOf(raw);
    return selectReferences(raw).accepted.filter(r => raw.player?.classToken && raw.player?.spec && r.player?.classToken && r.player?.spec && canonical(r.player?.classToken) === canonical(raw.player?.classToken) &&
        canonical(r.player?.spec) === canonical(raw.player?.spec) && fightOf(r)?.name === fight?.name && durationOf(r) > 0 && entries(r.tables?.dmg))
        .sort((a, b) => Number(b.kind === 'benchmark') - Number(a.kind === 'benchmark') || Math.abs(durationOf(a) - duration) - Math.abs(durationOf(b) - duration))[0];
}
function family(row) {
    // WCL names composite pet rows after the pet. Different pet names must not
    // become a missing ability on one side and an unrelated loss on the other.
    if (row.composite && ((row.sources?.length && row.sources.every(s => s.type === 'Pet')) ||
        (row.subentries?.length && row.subentries.every(s => s.actorType === 'Pet'))))
        return { id: 'pet-damage', name: 'Pet damage' };
    // TBC Classic faction equivalents. Aura/cast IDs deliberately excluded:
    // these are damage records, not seal applications or Judgement button presses.
    const id = spellId(row);
    if ([31893, 348701].includes(id)) return { id: 'blood-martyr', name: 'Seal of Blood / the Martyr' };
    if ([31898, 348702].includes(id)) return { id: 'judgement-blood-martyr', name: 'Judgement of Blood / the Martyr' };
    const name = row.name?.replace(/\s*\(Rank \d+\)\s*$/i, '').trim();
    return { id: name ? name.toLowerCase().replace(/\s+/g, ' ') : String(id), name: name || 'Ability ' + id };
}
function outcomes(row) {
    if (!finite(row.hitCount)) return null;
    const keys = ['hitCount', 'tickCount', 'missCount', 'tickMissCount'];
    if (keys.some(key => !finite(row[key]) || row[key] < 0)) return null;
    return keys.reduce((sum, key) => sum + (row[key] || 0), 0);
}
function group(table) {
    const result = new Map();
    for (const row of entries(table) || []) {
        if (!finite(row.total)) continue;
        const f = family(row), count = outcomes(row);
        const item = result.get(f.id) || { ...f, total: 0, count: 0, countKnown: true, critKnown: true, crits: 0, hits: 0, normalTotal: 0, normalCount: 0, ids: [] };
        item.total += row.total; item.ids.push(spellId(row));
        item.countKnown &&= count !== null; item.count += count || 0;
        item.critKnown &&= finite(row.hitCount) && finite(row.tickCount) &&
            (!row.hitCount || (finite(row.critHitCount) && row.critHitCount >= 0 && row.critHitCount <= row.hitCount)) &&
            (!row.tickCount || (finite(row.critTickCount) && row.critTickCount >= 0 && row.critTickCount <= row.tickCount));
        item.crits += (row.critHitCount || 0) + (row.critTickCount || 0);
        item.hits += (row.hitCount || 0) + (row.tickCount || 0);
        // Only plain direct hits, so blocked/resisted/glancing outcomes are not
        // silently normalized into a purported gear-only comparison.
        for (const hit of row.hitdetails || []) if (hit.type === 'Hit' && finite(hit.total) && finite(hit.count)) {
            item.normalTotal += hit.total; item.normalCount += hit.count;
        }
        result.set(f.id, item);
    }
    return result;
}
function actorDps(raw, fallback) {
    const actor = entries(raw.context?.dmgAll)?.find(a => a.id === raw.sourceId);
    return finite(actor?.total) ? actor.total / durationOf(raw) : fallback;
}
function analyzeDamage(raw) {
    const empty = { findings: [], comparison: [], timeline: [], checks: [], limitations: [] };
    if (['healer', 'tank'].includes(raw.player?.role) || !raw.player?.spec) return empty;
    const reference = chooseReference(raw), duration = durationOf(raw), otherDuration = durationOf(reference);
    if (!reference || !(duration > 0) || !entries(raw.tables?.dmg)) return empty;
    const own = group(raw.tables.dmg), other = group(reference.tables.dmg);
    const rows = [...new Set([...own.keys(), ...other.keys()])].map(key => {
        const a = own.get(key), b = other.get(key), playerDps = (a?.total || 0) / duration, referenceDps = (b?.total || 0) / otherDuration;
        const playerCount = a ? a.countKnown ? a.count : null : 0, referenceCount = b ? b.countKnown ? b.count : null : 0;
        const ar = playerCount === null ? null : playerCount / duration, br = referenceCount === null ? null : referenceCount / otherDuration;
        const av = playerCount > 0 ? a.total / playerCount : null, bv = referenceCount > 0 ? b.total / referenceCount : null;
        // Symmetric two-factor identity: bRate*bYield - aRate*aYield.
        // Missing-side yields are unknown: do not invent them to force a split.
        const split = av !== null && bv !== null;
        return { id: key, name: (a || b).name, playerDps: round(playerDps), referenceDps: round(referenceDps), differenceDps: round(referenceDps - playerDps),
            playerCount, referenceCount, playerPerMinute: round(ar === null ? null : ar * 60), referencePerMinute: round(br === null ? null : br * 60),
            playerAverage: round(av), referenceAverage: round(bv), frequencyDps: split ? round((br - ar) * (bv + av) / 2) : null,
            yieldDps: split ? round((bv - av) * (br + ar) / 2) : null, countLabel: 'damage outcomes (hits, ticks and misses)',
            playerCritPercent: a?.critKnown && a.hits ? round(100 * a.crits / a.hits) : null, referenceCritPercent: b?.critKnown && b.hits ? round(100 * b.crits / b.hits) : null,
            playerNormalAverage: a?.normalCount ? round(a.normalTotal / a.normalCount) : null, referenceNormalAverage: b?.normalCount ? round(b.normalTotal / b.normalCount) : null,
            _exactDifference: referenceDps - playerDps };
    }).sort((a, b) => b.differenceDps - a.differenceDps);
    const ownTotal = [...own.values()].reduce((s, r) => s + r.total, 0) / duration;
    const otherTotal = [...other.values()].reduce((s, r) => s + r.total, 0) / otherDuration;
    const gap = actorDps(reference, otherTotal) - actorDps(raw, ownTotal);
    const accounted = rows.reduce((s, r) => s + r._exactDifference, 0), residual = gap - accounted;
    rows.forEach(r => { delete r._exactDifference; });
    const analysis = { player: { name: raw.player.name, url: urlOf(raw), durationSec: round(duration) },
        reference: { name: reference.player.name, url: urlOf(reference), durationSec: round(otherDuration) },
        gapDps: round(gap), accountedDps: round(accounted), residualDps: round(residual), rows,
        limitations: ['Ability differences include execution, equipment, support and random outcomes. They are not recoverable DPS estimates.',
            'Frequency counts damage outcomes, including extra attacks, procs and periodic ticks; it is not a count of button presses. Average outcome includes misses and critical hits.',
            'Blood and Martyr damage are compared as faction equivalents. Same-named spell ranks are grouped; different ranks can still change damage per outcome.'] };
    if (Math.abs(residual) > 1) analysis.limitations.push('The remaining ' + round(residual) + ' DPS is outside the returned ability rows (for example pet attribution or table coverage); it remains unallocated.');
    const findings = [], comparison = [], checks = [];
    const ev = (text, r = raw) => ({ text, url: urlOf(r) });
    const add = (id, title, category, priority, action, evidence) => findings.push({ id, title, category, priority, owner: category === 'equipment' ? 'player' : 'context', action, evidence, confidence: 'observed', gainDps: null });
    for (const row of rows.filter(r => r.differenceDps > 50).slice(0, 4)) {
        const records = [ev(raw.player.name + ': ' + row.playerDps + ' DPS; ' + (row.playerCount === null ? 'outcome count unavailable' : row.playerCount + ' damage outcomes (' + row.playerPerMinute + '/min)') + '.'),
            ev(reference.player.name + ': ' + row.referenceDps + ' DPS; ' + (row.referenceCount === null ? 'outcome count unavailable' : row.referenceCount + ' damage outcomes (' + row.referencePerMinute + '/min)') + '.', reference)];
        if (row.playerAverage !== null && row.referenceAverage !== null) records.push(ev('Mean damage per outcome: ' + row.playerAverage + ' versus ' + row.referenceAverage + '. Critical rate among landed outcomes: ' + (row.playerCritPercent ?? 'unknown') + '% versus ' + (row.referenceCritPercent ?? 'unknown') + '%.'));
        if (row.playerNormalAverage !== null && row.referenceNormalAverage !== null) records.push(ev('Plain non-critical direct hits averaged ' + row.playerNormalAverage + ' versus ' + row.referenceNormalAverage + '. Buffs, target mitigation and ability rank still affect this comparison.'));
        add('damage-driver-' + row.id, row.name + ': ' + row.differenceDps + ' DPS of the observed difference', 'context', 'medium',
            row.playerCount === 0 ? 'The reference recorded this damage family and your returned table did not. Check whether it belongs in this build and encounter, then inspect its trigger or casting requirement.' :
            'Compare both outcome frequency and damage per outcome below. More procs or swings can come from haste and support as well as target contact; use the execution findings to decide what to practice.', records);
        comparison.push({ name: row.name + ' damage outcomes / minute', player: row.playerPerMinute, reference: row.referencePerMinute, unit: '/min', note: row.countLabel + '; not button presses.' });
        comparison.push({ name: row.name + ' average damage / outcome', player: row.playerAverage, reference: row.referenceAverage, unit: 'damage', note: 'Includes misses, crits, mitigation and buffs.' });
    }
    const ci = r => r.tables?.ci?.data?.find(e => e.sourceID === r.sourceId);
    const a = ci(raw), b = ci(reference);
    if (a && b) {
        const physical = ['melee', 'ranged'].includes(raw.player.role);
        const stats = raw.player.role === 'ranged' ? [['agility', 'Agility'], ['intellect', 'Intellect'], ['hitRanged', 'Ranged hit rating'], ['critRanged', 'Ranged crit rating'], ['hasteRanged', 'Ranged haste rating']] : physical ? [['strength', 'Strength'], ['agility', 'Agility'], ['hitMelee', 'Melee hit rating'], ['critMelee', 'Melee crit rating'], ['hasteMelee', 'Melee haste rating'], ['expertise', 'Expertise rating']] : [['intellect', 'Intellect'], ['spirit', 'Spirit'], ['hitSpell', 'Spell hit rating'], ['critSpell', 'Spell crit rating'], ['hasteSpell', 'Spell haste rating']];
        const differences = stats.filter(([key]) => finite(a[key]) && finite(b[key]) && a[key] !== b[key]);
        const records = differences.map(([key, label]) => ev(label + ': ' + a[key] + ' versus ' + b[key] + ' in the pull snapshots.'));
        if (records.length) records.push(ev('Comparison snapshot — ' + reference.player.name + ': ' + differences.map(([key, label]) => label + ' ' + b[key]).join(', ') + '.', reference));
        for (const [key, label] of differences) comparison.push({ name: label + ' at pull', player: a[key], reference: b[key], unit: '', note: 'Snapshot includes build and active buffs; not an isolated equipment comparison.' });
        if (a.gear?.[15]?.id && b.gear?.[15]?.id) records.unshift(ev(a.gear[15].id === b.gear[15].id ? 'Both snapshots equip the same main-hand item (' + a.gear[15].id + '). Other equipment, buffs and procs still differ.' : 'Main-hand items differ: ' + a.gear[15].id + ' versus ' + b.gear[15].id + '.'));
        if (differences.some(([key]) => Math.abs(b[key] - a[key]) > Math.max(50, Math.abs(a[key]) * 0.2))) add('throughput-stat-context', 'The comparison has materially different combat stats', 'equipment', 'medium',
            'Review your gear, enchants and buff setup alongside these values. A similar item level does not mean similar damage stats. Check the exact build before choosing upgrades; these snapshot differences are not isolated gear gains.', records);
        checks.push({ id: 'throughput-stats', label: 'Comparison combat stats', status: 'checked', reason: differences.length + ' differing relevant snapshot stats compared with ' + reference.player.name + '.' });
    } else checks.push({ id: 'throughput-stats', label: 'Comparison combat stats', status: 'unknown', reason: 'Both combatant snapshots are required.' });
    if (raw.gearAudit?.slots && reference.gearAudit?.slots) {
        const changes = raw.gearAudit.slots.map(a => ({ a, b: reference.gearAudit.slots.find(b => b.key === a.key) }))
            .filter(({ a, b }) => b && a.id > 0 && b.id > 0 && (a.id !== b.id || a.enchant?.id !== b.enchant?.id || JSON.stringify(a.gems) !== JSON.stringify(b.gems)));
        const describe = item => item.name + (item.enchantable ? '; enchant: ' + (item.enchant?.name || 'none recorded') : '') + (item.gems?.length ? '; gems: ' + item.gems.map(g => g.name).join(', ') : '');
        if (changes.length) add('comparison-equipment', 'Compare the actual equipment and gems behind the stat difference', 'equipment', 'medium',
            'Use these named items and gems to review your build, especially the meta gem and unenchanted slots. The comparison player’s equipment is an example, not a shopping list or proof that every swap is better.',
            changes.flatMap(({ a, b }) => [ev(a.label + ' — ' + raw.player.name + ': ' + describe(a) + '.'), ev(b.label + ' — ' + reference.player.name + ': ' + describe(b) + '.', reference)]));
    }
    // Compare maintenance only when both tables actually record the aura. Some
    // long-duration Classic buffs are omitted; a missing row must not become 0%.
    const maintenance = ['Battle Shout', 'Leader of the Pack', 'Unleashed Rage', 'Ferocious Inspiration', 'Trueshot Aura', 'Vengeance', 'Slice and Dice', 'Moonkin Aura', 'Wrath of Air Totem', 'Totem of Wrath'];
    const ownAuras = raw.tables?.buffs?.data?.auras, refAuras = reference.tables?.buffs?.data?.auras;
    if (Array.isArray(ownAuras) && Array.isArray(refAuras)) {
        const differences = [];
        for (const name of maintenance) {
            const a = ownAuras.filter(a => a.name === name), b = refAuras.filter(a => a.name === name);
            if (a.length !== 1 || b.length !== 1 || !finite(a[0].totalUptime) || !finite(b[0].totalUptime)) continue;
            const ap = Math.min(100, 100 * a[0].totalUptime / (duration * 1000)), bp = Math.min(100, 100 * b[0].totalUptime / (otherDuration * 1000));
            comparison.push({ name: name + ' recorded uptime', player: round(ap), reference: round(bp), unit: '%', note: 'Both logs record this aura. Uptime does not establish buff strength or assign responsibility.' });
            if (bp - ap >= 10) differences.push({ name, own: round(ap), ref: round(bp), seconds: round(duration - a[0].totalUptime / 1000) });
        }
        if (differences.length) add('buff-maintenance-comparison', 'Recorded buff maintenance also differs', 'context', 'medium',
            'Check the listed buff windows alongside movement and deaths. For buffs supplied by another player, review refresh timing and range together; for your own buffs, check the class-specific maintenance rules.',
            differences.flatMap(d => [ev(d.name + ': ' + d.own + '% recorded on ' + raw.player.name + ', leaving ' + d.seconds + ' seconds outside the aura.'), ev(d.name + ': ' + d.ref + '% recorded on ' + reference.player.name + '.', reference)]));
    }
    checks.push({ id: 'damage-accounting', label: 'Complete ability comparison', status: 'checked', reason: rows.length + ' damage families compared, including abilities present on only one side. ' + round(residual) + ' DPS remains outside the ability rows.' });
    return { damageAnalysis: analysis, findings, comparison, checks, timeline: [], limitations: [] };
}
module.exports = { analyzeDamage, chooseReference, family, group };
