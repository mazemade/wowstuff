'use strict';
// Arithmetic description of an observed gap. Nothing here is a recoverable-DPS estimate.
const { chooseReference, family } = require('./evaluation-damage-analysis.js');
const { expectedOutcomes, varianceCheck } = require('./evaluation-mechanics.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const entries = t => Array.isArray(t?.data?.entries) ? t.data.entries : null;
const fightOf = raw => raw?.context?.fights?.find(f => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const f = fightOf(raw); return f && (f.endTime - f.startTime) / 1000; };
const urlOf = raw => 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
const ci = raw => raw?.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId);
const actorDps = (raw, fallback) => { const a = entries(raw.context?.dmgAll)?.find(x => x.id === raw.sourceId); return finite(a?.total) ? a.total / durationOf(raw) : fallback; };
const ZERO = { Miss: 'miss', Dodge: 'dodge', Parry: 'parry', Resist: 'resist', Block: 'block', Immune: 'immune', Absorb: 'absorb' };
const LANDED = { Hit: 'hit', 'Critical Hit': 'crit', 'Glancing Blow': 'glance', 'Blocked Hit': 'blocked', 'Blocked Critical Hit': 'blocked', Tick: 'tick', 'Critical Tick': 'tick', 'Resisted Hit': 'resisted', 'Resisted Critical Hit': 'resisted', 'Resisted Tick': 'resisted', 'Resisted Critical Tick': 'resisted' };

function profile(table, familyId) {
    const rows = (entries(table) || []).filter(r => family(r).id === familyId && finite(r.total));
    if (!rows.length) return null;
    const p = { outcomes: 0, total: 0, zero: { miss: 0, dodge: 0, parry: 0, resist: 0, block: 0, immune: 0, absorb: 0, total: 0 }, landed: { count: 0, total: 0 }, detailed: true };
    for (const key of Object.values(LANDED)) p.landed[key] = { count: 0, total: 0 };
    for (const r of rows) {
        p.total += r.total;
        if (!Array.isArray(r.hitdetails) || !Array.isArray(r.missdetails)) { p.detailed = false; continue; }
        for (const m of r.missdetails) { const k = ZERO[m.type]; if (!k) { p.detailed = false; continue; } p.zero[k] += m.count; p.zero.total += m.count; p.outcomes += m.count; }
        for (const h of r.hitdetails) { const k = LANDED[h.type]; if (!k) { p.detailed = false; continue; } p.landed[k].count += h.count; p.landed[k].total += h.total; p.landed.count += h.count; p.landed.total += h.total; p.outcomes += h.count; }
    }
    return p;
}

function attackKind(raw, fam, own, other) {
    if (fam.id === 'pet-damage') return 'pet';
    const role = raw.player?.role;
    const p = own || other;
    if (p && p.landed.tick.count > 0 && p.landed.hit.count === 0 && p.landed.crit.count === 0) return 'periodic';
    if (fam.id === 'melee') return 'melee-white';
    if (role === 'ranged') return 'ranged';
    if (role === 'caster') return 'spell';
    if (role === 'melee') return 'melee-yellow';
    return 'other';
}

function factorsFor(attack, own, other, duration, otherDuration, ownCi, otherCi, classToken, assumptions) {
    if (!own || !other || !own.detailed || !other.detailed || !own.outcomes || !other.outcomes) return null;
    if (own.outcomes < 20 || other.outcomes < 20) {
        assumptions.push('Too few outcomes to decompose (' + own.outcomes + ' against ' + other.outcomes + ').');
        return null;
    }
    const hitKey = attack === 'spell' ? 'hitSpell' : attack === 'ranged' ? 'hitRanged' : 'hitMelee';
    const expect = (p, c) => expectedOutcomes({ attack, swings: p.outcomes, hitRating: c?.[hitKey] ?? 0, expertiseRating: c?.expertise ?? 0, classToken, inFront: p.zero.parry > 0 });
    const eP = expect(own, ownCi), eR = expect(other, otherCi);
    for (const a of [...eP.assumptions, ...eR.assumptions]) if (!assumptions.includes(a)) assumptions.push(a);
    if (!ownCi || !otherCi) assumptions.push('A combatant snapshot is missing on one side; expected outcome rates use zero hit and expertise rating for it.');
    const variance = {};
    for (const key of ['miss', 'dodge', 'parry']) variance[key] = { player: varianceCheck(own.zero[key], eP.expected[key], own.outcomes), reference: varianceCheck(other.zero[key], eR.expected[key], other.outcomes) };
    const rP = own.outcomes / duration, rR = other.outcomes / otherDuration;
    const zP = own.zero.total / own.outcomes, zR = other.zero.total / other.outcomes;
    const aP = own.landed.count ? own.landed.total / own.landed.count : 0, aR = other.landed.count ? other.landed.total / other.landed.count : 0;
    const cP = own.landed.count ? own.landed.crit.count / own.landed.count : 0, cR = other.landed.count ? other.landed.crit.count / other.landed.count : 0;
    const normal = p => p.landed.hit.count ? p.landed.hit.total / p.landed.hit.count : null, critAvg = p => p.landed.crit.count ? p.landed.crit.total / p.landed.crit.count : null;
    const rate = (rR - rP) * (1 - zP) * aP, zero = rR * ((1 - zR) - (1 - zP)) * aP, yieldDps = rR * (1 - zR) * (aR - aP);
    const critDps = normal(own) !== null && critAvg(own) !== null ? rR * (1 - zR) * (cR - cP) * (critAvg(own) - normal(own)) : 0;
    return {
        zeroDamage: { player: round(100 * zP), reference: round(100 * zR), expected: { player: eP.expected, reference: eR.expected }, rates: { player: eP.rates, reference: eR.rates }, variance, dps: round(zero) },
        rate: { player: round(rP * 60), reference: round(rR * 60), dps: round(rate) },
        yield: { player: round(aP), reference: round(aR), dps: round(yieldDps), crit: { player: round(100 * cP), reference: round(100 * cR), dps: round(critDps) }, perHit: { player: round(normal(own)), reference: round(normal(other)), critAverage: { player: round(critAvg(own)), reference: round(critAvg(other)) }, dps: round(yieldDps - critDps) } },
    };
}

function headlineFor(gap, playerDps, ownCi, otherCi, referenceName, role) {
    if (!ownCi || !otherCi || !finite(playerDps) || !finite(gap)) return null;
    const primary = role === 'caster' ? [['intellect', 'intellect'], ['spellPower', 'spell power']] : role === 'ranged' ? [['agility', 'agility'], ['intellect', 'intellect']] : [['strength', 'strength'], ['agility', 'agility']];
    const more = primary.filter(([k]) => finite(ownCi[k]) && finite(otherCi[k]) && ownCi[k] > otherCi[k] * 1.1);
    if (Math.abs(gap) <= 0.02 * playerDps && more.length) return 'You matched ' + referenceName + "'s DPS with more stats (" + more.map(([, l]) => l).join(', ') + '); the difference is in execution.';
    return null;
}

function analyzeBudget(raw) {
    if (['healer', 'tank'].includes(raw.player?.role) || !raw.player?.spec) return { status: 'unavailable', reason: 'Damage budgets apply to DPS roles.', buckets: [], limitations: [] };
    const reference = chooseReference(raw), duration = durationOf(raw), otherDuration = durationOf(reference);
    if (!reference || !(duration > 0) || !entries(raw.tables?.dmg)) return { status: 'unavailable', reason: 'An independent same-spec reference with a damage table is required.', buckets: [], limitations: [] };
    if (!(otherDuration > 0)) return { status: 'unavailable', reason: 'The reference pull has no timing.', buckets: [], limitations: [] };
    const limitations = [];
    const own = entries(raw.tables.dmg), other = entries(reference.tables.dmg);
    const ids = [...new Set([...own, ...other].filter(r => finite(r.total)).map(r => family(r).id))];
    const ownCi = ci(raw), otherCi = ci(reference), classToken = String(raw.player.classToken || '').toUpperCase();
    let anyUndetailed = false;
    const buckets = ids.map(id => {
        const fam = family([...own, ...other].find(r => family(r).id === id));
        const p = profile(raw.tables.dmg, id), r = profile(reference.tables.dmg, id);
        const playerDps = (p?.total || 0) / duration, referenceDps = (r?.total || 0) / otherDuration;
        const attack = attackKind(raw, fam, p, r);
        const assumptions = [];
        if (attack === 'pet') assumptions.push('Pet damage is not decomposed into outcomes.');
        if (attack === 'periodic') assumptions.push('Periodic damage is not decomposed into outcomes.');
        if (!p || !r) assumptions.push('Only one player recorded this damage family.');
        const decomposable = ['melee-white', 'melee-yellow', 'ranged', 'spell'].includes(attack);
        const factors = decomposable ? factorsFor(attack, p, r, duration, otherDuration, ownCi, otherCi, classToken, assumptions) : null;
        if (decomposable && !factors && (p && !p.detailed || r && !r.detailed)) anyUndetailed = true;
        const differenceDps = round(referenceDps - playerDps);
        if (factors) factors.residualDps = round(differenceDps - (factors.rate.dps + factors.zeroDamage.dps + factors.yield.dps));
        return { id, name: fam.name, attack, playerDps: round(playerDps), referenceDps: round(referenceDps), differenceDps, outcomes: { player: p, reference: r }, factors, assumptions };
    }).sort((a, b) => b.differenceDps - a.differenceDps);
    if (anyUndetailed) limitations.push('Some damage rows have no hit details; those buckets show totals only.');
    const ownTotal = buckets.reduce((s, b) => s + b.playerDps, 0), otherTotal = buckets.reduce((s, b) => s + b.referenceDps, 0);
    const playerDps = actorDps(raw, ownTotal), referenceDps = actorDps(reference, otherTotal);
    const gap = referenceDps - playerDps, accounted = buckets.reduce((s, b) => s + b.differenceDps, 0);
    if (Math.abs(gap - accounted) > 1) limitations.push(round(gap - accounted) + ' DPS of the gap lies outside the compared ability rows.');
    limitations.push('These values overlap and do not add up to the gap.');
    limitations.push('Target armor, weapon damage ranges and positioning are not compared.');
    return { status: 'decomposed', player: { name: raw.player.name, url: urlOf(raw), dps: round(playerDps), durationSec: round(duration) }, reference: { name: reference.player.name, url: urlOf(reference), dps: round(referenceDps), durationSec: round(otherDuration) },
        gapDps: round(gap), headline: headlineFor(gap, playerDps, ownCi, otherCi, reference.player.name, raw.player.role), buckets, residualDps: round(gap - accounted), limitations };
}
module.exports = { analyzeBudget, profile, attackKind };
