'use strict';
// Feedback report v4 (spec docs/superpowers/specs/2026-09-05-feedback-v4-checklist-design.md):
// one row per habit, aggregated over the live pulls of a facts sheet, with fixed fix text; the
// verdict, the caps, and the plain-text report. Pure: no I/O, no vet-feedback.js require.
const GAP = require('./vet-gap.js');

const NOMINAL_VALUE = { potion: 3, flask: 2, food: 1, oil: 1, burst_timing: 2, unused: 2, hit: 1 };
const ROW_CAPS = { fixFirst: 3, also: 5, asks: 3 };
const FINE_IDS = ['food', 'flask', 'potion', 'activity', 'deaths', 'power_gear', 'hit'];
const CATEGORY_ORDER = ['consumables', 'cooldowns', 'casting', 'spells', 'nuke', 'gear', 'group', 'raid'];
// The five thresholds this module reads; vet-feedback.js's T carries the same values and is
// passed in by buildFacts so the two never drift.
const DEFAULT_T = { potionMinSec: 60, unusedPerMin: 1.5, unusedPerFightCooldown: 1, extraPerMin: 1, ratioLow: 0.7 };
const MOVEMENT_FILLER = { Destruction: 'Shadowburn or Life Tap', Affliction: 'Curse of Agony or Life Tap', Demonology: 'Shadowburn or Life Tap', Fire: 'Fire Blast or Scorch', Arcane: 'Fire Blast or Arcane Explosion', Frost: 'Fire Blast or Ice Lance',
                          Shadow: 'Shadow Word: Death or Devouring Plague', Balance: 'Moonfire or Insect Swarm', Elemental: 'Flame Shock or Earth Shock', default: 'an instant' };
const ABILITY_FIX = { Shadowburn: 'Use it while moving and under 25% boss health when you have shards.', 'Curse of Doom': 'Put it up on the pull and refresh it the moment it expires.', 'Curse of Agony': 'Keep it up on the boss.',
                      'Fire Blast': 'Use it while moving.', Scorch: 'Keep five stacks of Fire Vulnerability up when you are the assigned mage.', 'Shadow Word: Death': 'Use it on every cooldown when the healers can cover it.',
                      Conflagrate: 'Use it whenever Immolate is up and about to expire.', 'Arcane Blast': 'Open with three Arcane Blasts before your filler.', Starfire: 'Cast it whenever the boss is not moving.' };
const NUKE_FIX = { Destruction: 'Check Shadow and Flame 5/5, Ruin, Shadow Bolt rank 11 and Demonic Sacrifice on a Succubus.', Affliction: 'Check Shadow Mastery 5/5, Contagion and the rank of every DoT.', Demonology: 'Check Demonic Tactics, Master Demonologist and Shadow Bolt rank 11.',
                   Fire: 'Check Fire Power 5/5, Ignite and Fireball or Scorch rank.', Arcane: 'Check Spell Power 2/2, Arcane Power and Arcane Blast rank.', Frost: 'Check Ice Shards 5/5, Piercing Ice and Frostbolt rank.',
                   Shadow: 'Check Darkness 5/5, Shadowform and Mind Blast rank.', Balance: 'Check Moonfury 5/5, Wrath of Cenarius and Starfire rank.', Elemental: 'Check Concussion 5/5, Call of Thunder and Lightning Bolt rank.' };
const BUFF_SOURCE = { 'Moonkin Aura': 'a moonkin', 'Totem of Wrath': 'an elemental shaman', 'Wrath of Air Totem': 'a shaman', 'Prayer of Spirit': 'a priest', 'Eye of the Night': 'any caster with the trinket', 'Chain of the Twilight Owl': 'any caster with the trinket',
                      'Fel Intelligence': 'a demonology warlock', 'Blood Pact': 'an imp', 'Arcane Brilliance': 'a mage', 'Greater Blessing of Kings': 'a paladin', 'Greater Blessing of Wisdom': 'a paladin', 'Mana Spring Totem': 'a shaman',
                      'Battle Shout': 'a warrior', 'Leader of the Pack': 'a feral druid', 'Trueshot Aura': 'a hunter', 'Ferocious Inspiration': 'a beast mastery hunter', 'Strength of Earth Totem': 'a shaman', 'Grace of Air Totem': 'a shaman',
                      'Unleashed Rage': 'an enhancement shaman', 'Greater Blessing of Might': 'a paladin', 'Windfury Totem': 'a shaman' };
const STAT_WORD = { spellCrit: 'spell crit', spellHaste: 'spell haste', spellDamage: 'spell power', meleeCrit: 'crit', meleeHaste: 'haste', attackPower: 'attack power', rangedAttackPower: 'ranged attack power', expertise: 'expertise', spellHit: 'spell hit', meleeHit: 'hit', rangedCrit: 'crit' };

// --- helpers (spec §4.2)
const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
const pct = x => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);
function liveKills(facts) { return ((facts && facts.kills) || []).filter(k => k && k.fight && !k.fight.badPull); }
function inputOf(kill, key) {
    if (!kill || !kill.gap) return null;
    for (const f of ['casts', 'dmg', 'crit']) { const i = kill.gap.factors[f].inputs.find(x => x.key === key); if (i) return i; }
    return null;
}
function averageShare(kills, key) {
    const acc = kills.filter(k => k.gap);
    if (!acc.length) return null;
    return Math.round(acc.reduce((s, k) => { const i = inputOf(k, key); return s + (i ? i.share : 0); }, 0) / acc.length);
}
function largestPull(kills, key) {
    let best = null;
    kills.forEach(k => { const i = inputOf(k, key); if (i && (!best || i.share > best.input.share)) best = { kill: k, input: i }; });
    return best;
}
function verdictForShare(share) { return share >= 5 ? 'fail' : share >= 3 ? 'warn' : 'pass'; }
function verdictForHabit(hit, of) { if (!of) return null; return hit * 2 >= of ? 'fail' : hit > 0 ? 'warn' : 'pass'; }
// The boss name, dated when the sheet has more than one live pull of that boss (v2 rule).
function pullLabel(kill, kills) {
    const twice = kills.filter(k => k.name === kill.name).length > 1;
    return twice && kill.date ? kill.name + ' (' + kill.date + ')' : kill.name;
}
function row(o) { return Object.assign({ owner: 'player', me: null, reference: null, unit: null, pulls: null, value: null, text: '', fix: '', measuredOn: null }, o); }
function pullsText(hit, of) { return hit + ' of ' + of + ' pulls'; }
function shareRow(facts, o) {
    const kills = liveKills(facts);
    const share = averageShare(kills, o.key);
    const best = largestPull(kills, o.key);
    if (share === null || !best) return null;
    const label = pullLabel(best.kill, kills);
    return row({ id: o.id, category: o.category, owner: o.owner || 'player', verdict: verdictForShare(share), me: best.input.me, reference: best.input.reference, unit: best.input.unit,
                 value: share > 0 ? share : null, measuredOn: label, text: o.text(best.input, best.kill, label, share), fix: typeof o.fix === 'function' ? o.fix(best.input, best.kill) : (o.fix || '') });
}
function mainAbility(kill) { const a = kill && kill.reference && Array.isArray(kill.reference.abilities) && kill.reference.abilities[0]; return a ? a.name : 'spell'; }
function perMin(count, sec) { return sec ? Math.round(10 * 60 * count / sec) / 10 : null; }

// --- casting (spec §4.3 "Casting")
function castingRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts), spec = facts.player && facts.player.spec;
    const out = [];
    const cr = shareRow(facts, { id: 'cast_rate', key: 'cast_pacing', category: 'casting',
        text: (i, k, label) => pct(i.me) + ' damaging casts a minute while active against ' + pct(i.reference) + ' on ' + label,
        fix: (i, k) => 'Queue the next ' + mainAbility(k) + ' before the current one lands; move only when you must, and use ' + (MOVEMENT_FILLER[spec] || MOVEMENT_FILLER.default) + ' while moving.' });
    if (cr) out.push(cr);
    const act = shareRow(facts, { id: 'activity', key: 'own_activity', category: 'casting',
        text: (i, k, label) => 'Active ' + pct(i.me) + '% against ' + pct(i.reference) + '% for comparable players' + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : '') + ' on ' + label,
        fix: 'Keep casting through transitions; if an assignment took you off the boss, tell the raid leader so it is counted as not on you.' });
    if (act) out.push(act);
    else {
        // v2 active_low, for sheets without an accounting (healers, no reference, player ahead).
        const measurable = kills.filter(k => num(k.me.activePercent) !== null);
        const failing = measurable.filter(k => k.me.activePercent < 85 || (num(k.fight.raidActivePercent) !== null && k.me.activePercent < 92 && k.fight.raidActivePercent - k.me.activePercent >= 8));
        const v = verdictForHabit(failing.length, measurable.length);
        if (v) {
            const k = failing[0] || measurable[0];
            out.push(row({ id: 'activity', category: 'casting', verdict: v, me: k.me.activePercent, reference: num(k.fight.raidActivePercent), unit: 'active %', pulls: { hit: failing.length, of: measurable.length }, measuredOn: pullLabel(k, kills),
                           text: 'Active ' + pct(k.me.activePercent) + '% of ' + pullLabel(k, kills) + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : ''),
                           fix: 'Keep casting through transitions; if an assignment took you off the boss, tell the raid leader so it is counted as not on you.' }));
        }
    }
    const ch = shareRow(facts, { id: 'channel', key: 'channel_time', category: 'casting',
        text: (i, k, label) => 'Channelling Drain Soul and other utility ' + pct(i.me) + ' seconds of every minute on ' + label + '; comparable players ' + pct(i.reference),
        fix: 'Drain Soul only in the last seconds; never channel while the boss is targetable.' });
    if (ch) out.push(ch);
    // Life taps: shown, never graded (tbc-audit's rule).
    const withRef = kills.filter(k => k.reference && k.fight.durationSec && ((k.me.casts || {})['Life Tap'] || (k.reference.casts || {})['Life Tap']));
    if (withRef.length) {
        const k = withRef[0];
        const mine = perMin((k.me.casts || {})['Life Tap'] || 0, k.fight.durationSec), theirs = perMin((k.reference.casts || {})['Life Tap'] || 0, k.reference.castsDurationSec);
        out.push(row({ id: 'life_taps', category: 'casting', verdict: 'info', me: mine, reference: theirs, unit: 'a minute', measuredOn: pullLabel(k, kills), text: 'Life Tap ' + mine + ' a minute; comparable players ' + (theirs === null ? '—' : theirs) }));
    }
    return out;
}

// --- group asks (spec §4.3 "Group")
function halfRule(counts, of) { return Object.keys(counts).filter(n => counts[n] * 2 >= of); }
function groupRows(facts) {
    const kills = liveKills(facts), out = [];
    const d = shareRow(facts, { id: 'debuffs', key: 'debuffs', category: 'group', owner: 'group', text: () => '' });
    if (d) {
        const known = kills.filter(k => k.debuffs && k.debuffs.known);
        const counts = {}, sources = new Set();
        known.forEach(k => (k.debuffs.missing || []).forEach(m => { counts[m.name] = (counts[m.name] || 0) + 1; }));
        const names = halfRule(counts, known.length);
        known.forEach(k => (k.debuffs.missing || []).forEach(m => { if (names.includes(m.name)) sources.add(m.source); }));
        const hit = known.filter(k => (k.debuffs.missing || []).some(m => names.includes(m.name))).length;
        d.pulls = { hit, of: known.length };
        d.text = names.length ? 'No ' + names.join(' or ') + ' on ' + pullsText(hit, known.length) + ' (' + Array.from(sources).join(', ') + ')'
                              : 'Raid debuffs on ' + d.measuredOn + ' multiplied damage by ' + d.me + ' against ' + d.reference + ' for the reference raid';
        out.push(d);
    }
    const critShare = averageShare(kills, 'crit_buffs'), powerShare = averageShare(kills, 'power_buffs');
    if (critShare !== null || powerShare !== null) {
        const total = (critShare || 0) + (powerShare || 0);
        const withRef = kills.filter(k => k.reference && Array.isArray(k.reference.buffsAtPull) && k.me.consumablesKnown);
        const counts = {};
        withRef.forEach(k => k.reference.buffsAtPull.filter(b => !(k.me.partyBuffs || []).includes(b)).forEach(b => { counts[b] = (counts[b] || 0) + 1; }));
        const names = halfRule(counts, withRef.length);
        const hit = withRef.filter(k => k.reference.buffsAtPull.some(b => names.includes(b) && !(k.me.partyBuffs || []).includes(b))).length;
        const best = largestPull(kills, 'crit_buffs') || largestPull(kills, 'power_buffs');
        if (names.length) out.push(row({ id: 'party_buffs', category: 'group', owner: 'group', verdict: verdictForShare(total), value: total > 0 ? total : null, pulls: { hit, of: withRef.length }, measuredOn: best ? pullLabel(best.kill, kills) : null,
            text: 'No ' + names.join(' or ') + ' in your group on ' + pullsText(hit, withRef.length) + ' (' + Array.from(new Set(names.map(n => BUFF_SOURCE[n] || 'another class'))).join(', ') + ')' }));
    }
    const lustKills = kills.filter(k => k.reference && num(k.reference.bloodlustPercent) !== null && num(k.me.bloodlustPercent) !== null);
    const noLust = lustKills.filter(k => k.reference.bloodlustPercent > 0 && k.me.bloodlustPercent === 0);
    if (noLust.length) out.push(row({ id: 'bloodlust', category: 'group', owner: 'group', verdict: verdictForHabit(noLust.length, lustKills.length), pulls: { hit: noLust.length, of: lustKills.length }, measuredOn: pullLabel(noLust[0], kills),
        text: 'No Bloodlust on ' + pullsText(noLust.length, lustKills.length) + ' while comparable players had it' }));
    // Curse: an assignment question, one row, only when the two sides' most-cast curse differ.
    const isCurse = n => /^curse of /i.test(n);
    const most = casts => Object.keys(casts || {}).filter(isCurse).filter(n => casts[n] > 0).sort((a, b) => casts[b] - casts[a])[0] || null;
    const differ = kills.filter(k => k.reference && most(k.me.casts) && most(k.reference.casts) && most(k.me.casts) !== most(k.reference.casts) && !(k.me.casts || {})[most(k.reference.casts)]);
    if (differ.length) {
        // The reference curse named is the one most of the differing pulls ran (Doom on four
        // pulls beats Agony on one); the numbers come from the first pull that ran it.
        const tally = {}; differ.forEach(k => { const t = most(k.reference.casts); tally[t] = (tally[t] || 0) + 1; });
        const theirs = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
        const k = differ.find(x => most(x.reference.casts) === theirs), mine = most(k.me.casts);
        const ab = (k.reference.abilities || []).find(a => a.name === theirs);
        out.push(row({ id: 'curse', category: 'group', owner: 'group', verdict: 'warn', pulls: { hit: differ.length, of: kills.filter(x => x.reference).length }, measuredOn: pullLabel(k, kills),
            text: 'You run ' + mine + ' (assignment); comparable players run ' + theirs + (ab && num(ab.share) !== null ? ', ' + Math.round(ab.share) + '% of their damage' : ''),
            fix: 'Rotate the assignment or give it to the warlock with the lowest DPS.' }));
    }
    return out;
}

// --- raid (spec §4.3 "Raid")
function raidRows(facts) {
    const r = shareRow(facts, { id: 'raid_activity', key: 'raid_activity', category: 'raid', owner: 'raid',
        text: (i, k, label) => 'Your raid was active ' + pct(i.me) + '% of ' + label + ' against ' + pct(i.reference) + '% for the reference raid; phases and downtime, not you' });
    return r && r.value !== null && r.value >= 3 ? [r] : [];
}

module.exports = { NOMINAL_VALUE, ROW_CAPS, FINE_IDS, CATEGORY_ORDER, DEFAULT_T, MOVEMENT_FILLER, ABILITY_FIX, NUKE_FIX, BUFF_SOURCE, STAT_WORD,
                   liveKills, inputOf, averageShare, largestPull, verdictForShare, verdictForHabit, pullLabel, row, shareRow, mainAbility, perMin, halfRule, castingRows, groupRows, raidRows };
