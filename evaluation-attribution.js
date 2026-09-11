'use strict';
// Resolves each factor difference from analyzeBudget into a named cause: gear stat deltas
// explained through gearAudit slots, auras/consumables missing at pull, buff-uptime gaps
// (including item procs), and target debuffs recorded on the reference only. Never invents a
// source: an id absent from evaluation-catalogue.js produces no cause, and a missing table
// degrades to a limitation instead of a guess.
const { chooseReference } = require('./evaluation-damage-analysis.js');
const { lookupAura, lookupUptime, lookupDebuff, DEBUFFS } = require('./evaluation-catalogue.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const list = v => Array.isArray(v) ? v : [];
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const fightOf = raw => raw?.context?.fights?.find(f => f.id === raw.fightId) || raw?.context?.fights?.[0];
const durationOf = raw => { const f = fightOf(raw); return f && (f.endTime - f.startTime) / 1000; };
const urlOf = raw => 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
const ci = raw => raw?.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId);
// Gear-audit slot keys (vet-engine.js SLOTS) → WoWSims equipment index (evaluation-sim.js normalizeGear order)
const SLOT_TO_SIM = { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, finger1: 10, finger2: 11, trinket1: 12, trinket2: 13, mainHand: 14, offHand: 15, ranged: 16 };
const UPTIME_ALIAS = new Map([[32182, 2825]]); // Heroism and Bloodlust are one family
const DAMAGE_STAT_KEYS = new Set(['0', '1', '3', '5', '12', '13', '14', '17', '18', '20', '21', '22', '24']);
// Stat rows: [snapshot key, item-db index, label, factor, threshold, roles]
const STATS = [
    ['expertise', 24, 'expertise', 'zeroDamage', 4, ['melee']], ['hitMelee', 20, 'melee hit rating', 'zeroDamage', 8, ['melee']], ['hitRanged', 20, 'ranged hit rating', 'zeroDamage', 8, ['ranged']], ['hitSpell', 12, 'spell hit rating', 'zeroDamage', 8, ['caster']],
    ['critMelee', 21, 'melee crit rating', 'crit', 11, ['melee']], ['critRanged', 21, 'ranged crit rating', 'crit', 11, ['ranged']], ['critSpell', 13, 'spell crit rating', 'crit', 11, ['caster']],
    ['hasteMelee', 22, 'melee haste rating', 'rate', 8, ['melee']], ['hasteRanged', 22, 'ranged haste rating', 'rate', 8, ['ranged']], ['hasteSpell', 14, 'spell haste rating', 'rate', 8, ['caster']],
    ['strength', 0, 'strength', 'perHit', 20, ['melee']], ['agility', 1, 'agility', 'perHit', 20, ['melee', 'ranged']], ['intellect', 3, 'intellect', 'perHit', 20, ['caster', 'ranged']],
];

function slotStat(slot, index) { return Number(slot?.stats?.[index]) || 0; }
function describeSlot(slot, index) { return slot.label + ': ' + slot.name + (slot.enchant ? ' (' + slot.enchant.name + ')' : '') + (slot.gems?.length ? ' [' + slot.gems.map(g => g.name).join(', ') + ']' : '') + ' supplies ' + slotStat(slot, index); }

// Auras present on the reference's pull-time snapshot and absent from the player's (slot-based
// consumables covered by whatever fills that slot on the player's side, plus general blessings/
// party/raid auras, with the Kings-over-Salvation special case) — shared between the "auras at
// pull" causes below and the stat-gap wording, which names these instead of a vague "buffs,
// scrolls or consumables at pull".
function resolveAuraGaps(ownAuras, otherAuras) {
    if (!Array.isArray(ownAuras) || !Array.isArray(otherAuras)) return [];
    const ownIds = new Set(ownAuras.map(a => Number(a.ability))), otherIds = new Set(otherAuras.map(a => Number(a.ability)));
    const bySlot = (ids) => { const m = new Map(); for (const id of ids) { const e = lookupAura(id); if (e?.slot) m.set(e.slot, e); } return m; };
    const ownSlots = bySlot(ownIds), otherSlots = bySlot(otherIds);
    const covering = (slots, slot) => slots.get(slot) || (slot === 'battle' || slot === 'guardian' ? slots.get('flask') : null) || (slot === 'flask' ? slots.get('battle') || slots.get('guardian') : null);
    const gaps = [];
    for (const slot of ['flask', 'battle', 'guardian', 'food']) {
        const theirs = otherSlots.get(slot); if (!theirs) continue;
        const mine = covering(ownSlots, slot);
        if (mine && (mine.id === theirs.id || (mine.slot === 'flask' && slot !== 'flask'))) continue;
        gaps.push({ kind: 'slot', slot, mine, theirs });
    }
    for (const id of otherIds) {
        const e = lookupAura(id); if (!e || e.slot || ownIds.has(id)) continue;
        gaps.push({ kind: 'general', entry: e, isKings: e.kind === 'blessing' && e.id === 25898 && ownIds.has(25895) });
    }
    return gaps;
}
function auraGapNames(gaps) { return gaps.map(g => g.kind === 'slot' ? g.theirs.name : (g.isKings ? 'Greater Blessing of Kings' : g.entry.name)); }

// Every melee-role stat (expertise, hit, crit, haste, strength/agility) targets the primary
// 'melee' bucket with every other decomposed melee-yellow bucket carried in alsoBuckets, so a
// gear cause on 'melee' also covers e.g. Mutilate instead of leaving it as an unexplained luck line.
function targetBucket(budget, role) {
    const kinds = role === 'caster' ? ['spell'] : role === 'ranged' ? ['ranged'] : ['melee-white', 'melee-yellow'];
    const candidates = budget.buckets.filter(b => kinds.includes(b.attack) && b.factors);
    if (!candidates.length) return null;
    const primary = candidates.find(b => b.id === 'melee') || candidates[0];
    return { bucket: primary.id, alsoBuckets: candidates.filter(b => b !== primary).map(b => b.id) };
}

function attributeCauses(raw, budget) {
    const out = { causes: [], checks: [], limitations: [] };
    if (!budget || budget.status !== 'decomposed') return out;
    const reference = chooseReference(raw);
    const own = ci(raw), other = ci(reference), role = raw.player?.role;
    const ev = (text, r = raw) => ({ text, url: urlOf(r) });
    const push = c => out.causes.push({ priority: 'medium', verification: 'Compare the same snapshot and outcome counts on the next comparable pull.', evidence: [], statDelta: null, sim: null, ...c });
    // Parries are not modelled against an expected rate (see evaluation-budget.js: inFront is
    // always false, so expected parry is always 0); for 'parry' this returns only the observed
    // counts. Not currently reached with key 'parry' from within this module — kept correct for
    // any future caller.
    const zeroNote = (bucket, key) => {
        const f = bucket?.factors?.zeroDamage; if (!f) return '';
        const p = bucket.outcomes.player.zero[key], r = bucket.outcomes.reference.zero[key];
        const label = key === 'miss' ? 'misses' : key === 'dodge' ? 'dodges' : 'parries';
        if (key === 'parry') return p + ' ' + label + ' against ' + r + '.';
        const eP = f.expected.player[key], eR = f.expected.reference[key];
        const fmt = e => Math.abs(e.max - e.min) < 0.05 ? round(e.min) : round(e.min) + ' to ' + round(e.max);
        const luckP = f.variance[key].player.within ? '' : ' (outside normal variance)', luckR = f.variance[key].reference.within ? (r < eR.min ? ' below expectation, so part of this line is luck' : '') : ' (outside normal variance)';
        return p + ' ' + label + ' against ' + r + '. Expected from the recorded ratings: ' + fmt(eP) + ' for you' + luckP + ', ' + fmt(eR) + ' for ' + reference.player.name + luckR + '.';
    };
    // 1. Stat snapshot differences resolved through equipment
    if (own && other) {
        const slots = raw.gearAudit?.slots, otherSlots = reference.gearAudit?.slots;
        const auraGaps = auraGapNames(resolveAuraGaps(own.auras, other.auras));
        for (const [key, index, label, factor, threshold, roles] of STATS) {
            if (!roles.includes(role) || !finite(own[key]) || !finite(other[key])) continue;
            const diff = other[key] - own[key];
            if (Math.abs(diff) < threshold) continue;
            const target = targetBucket(budget, role); if (!target) continue;
            const bucket = budget.buckets.find(b => b.id === target.bucket);
            const evidence = [];
            let gearDiff = null;
            const contributors = [];
            if (slots && otherSlots) {
                // Compared slots (matched by key on both sides): a genuinely empty slot (no item
                // equipped, vet-engine's summarizeGear returns it without a stats field at all —
                // e.g. an off-hand slot behind a two-hander) legitimately supplies 0 and is not a
                // data gap. But a populated slot (has an item id) missing its stats object means
                // the gear audit was captured without per-slot stats — slotStat's 0 fallback would
                // otherwise silently read "supplies 0" for e.g. Fang of Vashj's 21 expertise. Treat
                // the whole comparison as unavailable in that case rather than misattribute it to buffs.
                const populatedNoStats = s => !!s.id && (!s.stats || typeof s.stats !== 'object');
                const pairs = slots.map(s => [s, otherSlots.find(x => x.key === s.key)]).filter(([, o]) => o);
                const statsUnavailable = pairs.some(([s, o]) => populatedNoStats(s) || populatedNoStats(o));
                if (!statsUnavailable) {
                    gearDiff = 0;
                    for (const [s, o] of pairs) { const d = slotStat(o, index) - slotStat(s, index); if (d) { gearDiff += d; if (d > 0) contributors.push({ name: o.name, label: o.label, d }); evidence.push(ev('Your ' + describeSlot(s, index) + ' ' + label + '.')); evidence.push(ev(reference.player.name + "'s " + describeSlot(o, index) + ' ' + label + '.', reference)); } }
                }
            }
            // The report collapses evidence into a details element, so the named items have to
            // survive in the visible observation: name the two biggest reference contributions.
            const top = contributors.sort((a, b) => b.d - a.d).slice(0, 2).map(c => c.name + ' (' + c.label + ')');
            const sources = top.length ? ' ' + reference.player.name + "'s " + other[key] + ' ' + label + ' comes from ' + top.join(' and ') + '.' : '';
            if (!evidence.length) evidence.push(ev('Combatant snapshot: you have ' + own[key] + ' ' + label + '; ' + reference.player.name + ' has ' + other[key] + '.'));
            const unexplained = gearDiff === null ? null : diff - gearDiff;
            const remaining = gearDiff === null ? '' : Math.abs(unexplained) <= Math.max(5, Math.abs(diff) * 0.15) ? ' The difference comes from equipment.' : ' Equipment explains ' + round(gearDiff) + ' of it; the remaining ' + round(unexplained) + (auraGaps.length ? ' matches auras the reference had at pull: ' + auraGaps.join(', ') + '.' : ' is not explained by equipment or auras at pull.');
            const observation = (key === 'expertise' ? zeroNote(bucket, 'dodge') + ' ' : key.startsWith('hit') ? zeroNote(bucket, 'miss') + ' ' : '') + 'You have ' + own[key] + ' ' + label + '; ' + reference.player.name + ' has ' + other[key] + '.' + (gearDiff === null ? ' Equipment stats are unavailable for one side.' : remaining) + sources;
            // Only a stat the reference has more of becomes a cause; the luck lines below carry the counts either way.
            if (diff > 0) push({ id: 'stat-' + key.replace(/Melee|Ranged|Spell/, ''), bucket: target.bucket, alsoBuckets: target.alsoBuckets, factor, kind: 'gear', owner: 'you', title: 'Close the ' + label + ' gap', observation, action: gearDiff === null ? "Equipment stats are unavailable for one side; compare your items with the reference's." : gearDiff > 0 ? 'Compare the named slots above; the reference item, gem or enchant supplies the stat you lack.' : 'The stat gap is not from equipment; check the aura causes below.', evidence, statDelta: { [index]: round(diff) }, sim: { bonusStats: { [index]: round(diff) } }, priority: factor === 'zeroDamage' ? 'high' : 'medium' });
        }
        // Luck lines for miss/dodge not covered by a stat cause
        for (const bucket of budget.buckets.filter(b => b.factors)) for (const key of ['miss', 'dodge']) {
            const covered = out.causes.some(c => c.id.startsWith('stat-') && (c.bucket === bucket.id || list(c.alsoBuckets).includes(bucket.id)) && c.factor === 'zeroDamage' && ((key === 'dodge' && c.id === 'stat-expertise') || (key === 'miss' && c.id === 'stat-hit')));
            const p = bucket.outcomes.player.zero[key], r = bucket.outcomes.reference.zero[key];
            if (covered || p === r || (!p && !r)) continue;
            push({ id: 'luck-' + bucket.id + '-' + key, bucket: bucket.id, factor: 'zeroDamage', kind: 'luck', owner: 'luck', title: (key === 'miss' ? 'Misses' : 'Dodges') + ' on ' + bucket.name + ' differ without a stat difference', observation: zeroNote(bucket, key), action: 'No change; this is variance on a short pull.', evidence: [ev('Outcome counts come from the recorded damage table.')], priority: 'low' });
        }
        // Parries are not modelled against an expected rate (inFront is always false in
        // evaluation-budget.js), so they are never "luck against a stat"; only flag them as a
        // positioning note when the player is parried more than the reference.
        for (const bucket of budget.buckets.filter(b => b.factors)) {
            const p = bucket.outcomes.player.zero.parry, r = bucket.outcomes.reference.zero.parry;
            if (!(p > r)) continue;
            push({ id: 'positioning-' + bucket.id + '-parry', bucket: bucket.id, factor: 'zeroDamage', kind: 'positioning', owner: 'you', title: 'Parried attacks on ' + bucket.name, observation: p + ' of your attacks were parried against ' + r + '; parries only happen from the front.', action: 'Stay behind the target; check your position after each movement.', evidence: [ev('Outcome counts come from the recorded damage table.')], priority: 'medium' });
        }
    } else out.limitations.push('A combatant snapshot is missing on one side; stat causes are not compared.');
    // 2. Auras at pull
    if (own?.auras && other?.auras) {
        const ownIds = new Set(own.auras.map(a => Number(a.ability))), otherIds = new Set(other.auras.map(a => Number(a.ability)));
        const bySlot = (ids) => { const m = new Map(); for (const id of ids) { const e = lookupAura(id); if (e?.slot) m.set(e.slot, e); } return m; };
        const ownSlots = bySlot(ownIds), otherSlots = bySlot(otherIds);
        // A flask occupies both elixir slots. Compare what the reference has in each slot with
        // whatever the player has covering that slot.
        const covering = (slots, slot) => slots.get(slot) || (slot === 'battle' || slot === 'guardian' ? slots.get('flask') : null) || (slot === 'flask' ? slots.get('battle') || slots.get('guardian') : null);
        for (const slot of ['flask', 'battle', 'guardian', 'food']) {
            const theirs = otherSlots.get(slot); if (!theirs) continue;
            const mine = covering(ownSlots, slot);
            if (mine && (mine.id === theirs.id || (mine.slot === 'flask' && slot !== 'flask'))) continue;
            const label = slot === 'food' ? 'food buff' : slot === 'flask' ? 'flask' : slot + ' elixir';
            push({ id: 'aura-' + slot, bucket: 'all', factor: 'perHit', kind: 'consumable', owner: 'you', title: theirs.name + ' at pull', observation: 'At pull you had ' + (mine ? mine.name : 'no ' + label) + '; ' + reference.player.name + ' had ' + theirs.name + '.', action: 'Use ' + theirs.name + ' or an equivalent before the pull and recheck after every wipe.', evidence: [ev('Your auras at pull: ' + own.auras.map(a => a.name).join(', ') + '.'), ev(reference.player.name + "'s auras at pull: " + other.auras.map(a => a.name).join(', ') + '.', reference)], sim: theirs.sim, priority: 'high' });
        }
        for (const id of otherIds) {
            const e = lookupAura(id); if (!e || e.slot || ownIds.has(id)) continue;
            if (e.kind === 'blessing' && e.id === 25898 && ownIds.has(25895)) push({ id: 'aura-25898', bucket: 'all', factor: 'perHit', kind: 'blessing', owner: 'raid', title: 'Greater Blessing of Kings instead of Salvation', observation: 'You had Salvation; ' + reference.player.name + ' had Kings (+10% to all stats).', action: 'Ask for Kings if your threat allows it; otherwise keep Salvation.', evidence: [ev('Auras at pull are recorded in the combatant snapshot.')], sim: { set: [...e.sim.set, [['raid', 'parties', 0, 'players', 0, 'buffs', 'blessingOfSalvation'], false]] }, priority: 'medium' });
            else push({ id: 'aura-' + id, bucket: 'all', factor: 'perHit', kind: e.kind, owner: e.owner, title: e.name + ' was on ' + reference.player.name + ' and not on you', observation: e.name + ' is recorded on the reference at pull and absent from your snapshot.', action: e.owner === 'raid' ? 'Ask your raid leader whether ' + e.name + ' can reach your group.' : 'Apply ' + e.name + ' before the pull.', evidence: [ev('Auras at pull are recorded in the combatant snapshot.')], sim: e.sim, statDelta: e.stats || null, priority: 'medium' });
        }
    } else out.limitations.push('Auras at pull are missing on one side; consumable and blessing causes are not compared.');
    // 3. Buff uptime differences
    const ownBands = raw.tables?.buffs?.data?.auras, otherBands = reference.tables?.buffs?.data?.auras;
    if (Array.isArray(ownBands) && Array.isArray(otherBands)) {
        const d = durationOf(raw), dR = durationOf(reference);
        if (!(finite(d) && d > 0 && finite(dR) && dR > 0)) {
            out.limitations.push('Fight timing is missing on one side; uptime causes are not compared.');
        } else {
            const canonicalId = id => UPTIME_ALIAS.get(id) || id;
            const pct = (rows, id, dur) => { const total = rows.filter(a => canonicalId(Number(a.guid)) === id).reduce((s, r) => s + (finite(r.totalUptime) ? r.totalUptime : 0), 0); return Math.min(100, 100 * total / (dur * 1000)); };
            const ids = new Set([...ownBands, ...otherBands].map(a => canonicalId(Number(a.guid))).filter(id => lookupUptime(id)));
            const gearAuditMissing = !raw.gearAudit?.slots;
            let gearAuditNoted = false;
            for (const id of ids) {
                const e = lookupUptime(id), mine = pct(ownBands, id, d), theirs = pct(otherBands, id, dR);
                if (theirs - mine < 10) continue;
                const affects = e.affects === 'all' ? 'perHit' : e.affects;
                if (e.kind === 'proc') {
                    if (gearAuditMissing) { if (!gearAuditNoted) { out.limitations.push('Your equipment audit is unavailable; proc items are not compared.'); gearAuditNoted = true; } continue; }
                    const item = e.itemId, wearer = reference.gearAudit?.slots?.find(s => s.id === item), mineToo = raw.gearAudit.slots.find(s => s.id === item);
                    const trinkets = raw.gearAudit.slots.filter(s => /^trinket/.test(s.key) && s.id);
                    const weakest = trinkets.find(s => !Object.keys(s.stats || {}).some(k => DAMAGE_STAT_KEYS.has(k))) || null;
                    // Both wearing it, nobody recorded wearing it, or the player has no trinket
                    // without damage stats to justify a swap: none of these support a concrete
                    // "wear this item" recommendation, so the cause stays luck.
                    if (mineToo || !wearer || !weakest) { push({ id: 'proc-aura-' + id, bucket: 'all', factor: affects, kind: 'proc', owner: 'luck', title: e.name + ' proc uptime', observation: e.name + ' was active ' + round(mine) + '% of your pull and ' + round(theirs) + '% of ' + reference.player.name + "'s.", action: 'No change; proc uptime is variance.', evidence: [ev('Buff bands from both logs.')], priority: 'low' }); continue; }
                    push({ id: 'proc-' + item, bucket: 'all', factor: affects, kind: 'gear', owner: 'you', title: wearer.name + ' proc uptime', observation: reference.player.name + ' had ' + e.name + ' from ' + wearer.name + ' active ' + round(theirs) + '% of the pull. You do not wear it; you wore ' + weakest.name + ', which has no damage stats.', action: 'Never raid with ' + weakest.name + ' equipped; any damage trinket beats it.', evidence: [ev(reference.player.name + ' equipped ' + wearer.name + '.', reference), ev('Your ' + weakest.label + ': ' + weakest.name + '.')], sim: { equip: { slot: SLOT_TO_SIM[weakest.key], id: item, replaces: weakest.id } }, priority: 'high' });
                    continue;
                }
                // A buff at pull (Kings, a flask, etc.) and its own uptime aura share the same
                // catalogue id (e.g. Battle Shout 2048): once the "at pull" pass above already
                // named it as aura-<id>, the uptime pass must not price the same buff twice.
                if (out.causes.some(c => c.id === 'aura-' + id)) continue;
                push({ id: 'uptime-' + id, bucket: 'all', factor: affects, kind: e.kind, owner: e.owner, title: e.name + ' uptime', observation: e.name + ' was active ' + round(mine) + '% of your pull and ' + round(theirs) + '% of ' + reference.player.name + "'s.", action: e.owner === 'raid' ? 'Ask your raid leader whether ' + e.name + ' can be provided to your group.' : 'Keep ' + e.name + ' running; compare the bands on the next pull.', evidence: [ev('Buff bands from both logs.')], sim: e.sim, priority: e.owner === 'you' ? 'high' : 'medium' });
            }
        }
    } else out.limitations.push('Buff bands are missing on one side; uptime causes are not compared.');
    // 4. Target debuffs — collapse by catalogue name, not id, so two spell ids for the same
    // named debuff (e.g. Faerie Fire 26993/25602) are not treated as different debuffs.
    const ownDebuffs = raw.context?.debuffs?.data?.auras, otherDebuffs = reference.context?.debuffs?.data?.auras;
    if (Array.isArray(ownDebuffs) && Array.isArray(otherDebuffs)) {
        const namesOf = rows => new Set(rows.map(a => lookupDebuff(a.guid)?.name).filter(Boolean));
        const ownNames = namesOf(ownDebuffs), otherNames = namesOf(otherDebuffs);
        const firstIdForName = name => [...DEBUFFS.values()].find(entry => entry.name === name)?.id;
        for (const name of otherNames) {
            if (ownNames.has(name)) continue;
            const id = firstIdForName(name), e = lookupDebuff(id); if (!e) continue;
            push({ id: 'debuff-' + id, bucket: 'all', factor: e.affects, kind: 'debuff', owner: 'raid', title: e.name + ' was on the reference target only', observation: e.name + ' is recorded on ' + reference.player.name + "'s target and not on yours.", action: 'Ask your raid leader who is assigned to keep ' + e.name + ' on the boss.', evidence: [ev('Debuff tables from both reports.')], sim: e.sim, priority: 'medium' });
        }
    } else out.limitations.push('Target debuff tables are not available for both pulls; debuff causes are not compared.');
    out.checks.push({ id: 'attribution', label: 'Named sources behind the gap', status: 'checked', reason: out.causes.length + ' causes resolved.' });
    return out;
}
module.exports = { attributeCauses };
