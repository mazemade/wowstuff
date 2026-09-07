'use strict';
// Feedback report v4 (spec docs/superpowers/specs/2026-09-05-feedback-v4-checklist-design.md):
// one row per habit, aggregated over the live pulls of a facts sheet, with fixed fix text; the
// verdict, the caps, and the plain-text report. Pure: no I/O, no vet-feedback.js require.
const GAP = require('./vet-gap.js');

const NOMINAL_VALUE = { potion: 3, flask: 2, food: 1, oil: 1, burst_timing: 2, unused: 2, hit: 1 };
const ROW_CAPS = { fixFirst: 3, also: 5, asks: 3 };
// 'hit' only reaches Fine if a passing hit row is ever emitted — today gearFindings only emits
// a gear_hit finding at fail/warn, so the profile branch's pass case (gearRows) is unreachable in
// practice; kept per spec §4.3 rather than synthesised from data the sheet does not carry.
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

const isCurse = n => /^curse of /i.test(n);

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
// ref-above B2: WCL's damage table lists the auto-attack as an ability, and for every physical
// class it is the biggest one. Building advice on it produced "queue the next Melee" and "check
// the rank of Melee" — the ability the player should hear about is the biggest real one.
const AUTO_ATTACK = new Set(['Melee', 'Auto Shot', 'Shoot', 'Melee (Off-Hand)', 'Off-Hand']);
function mainAbility(kill) {
    const list = (kill && kill.reference && Array.isArray(kill.reference.abilities)) ? kill.reference.abilities : [];
    const a = list.find(x => x && x.name && !AUTO_ATTACK.has(x.name));
    return a ? a.name : 'spell';
}
function perMin(count, sec) { return sec ? Math.round(10 * 60 * count / sec) / 10 : null; }

// --- casting (spec §4.3 "Casting")
function castingRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts), spec = facts.player && facts.player.spec;
    const out = [];
    const cr = shareRow(facts, { id: 'cast_rate', key: 'cast_pacing', category: 'casting',
        text: (i, k, label) => 'Casting: ' + pct(i.me) + ' damaging casts a minute while active against ' + pct(i.reference) + ' on ' + label,
        fix: (i, k) => {
            const role = (facts.player && facts.player.role) || 'caster';
            // ref-above C1: a melee or hunter does not queue casts — they press the button more
            // often. Only a caster gets the cast-queue and movement-filler advice.
            if (role === 'melee' || role === 'ranged' || role === 'tank') return 'Press ' + mainAbility(k) + ' more often; the gap is presses, not gear.';
            return 'Queue the next ' + mainAbility(k) + ' before the current one lands; move only when you must, and use ' + (MOVEMENT_FILLER[spec] || MOVEMENT_FILLER.default) + ' while moving.';
        } });
    if (cr) out.push(cr);
    const act = shareRow(facts, { id: 'activity', key: 'own_activity', category: 'casting',
        // Fine (spec §4.3) is one sentence listing the passes, never a number — a passing share
        // still measured a real percentage, but that number belongs in Fix first/Also, not Fine.
        text: (i, k, label, share) => verdictForShare(share) === 'pass' ? 'active throughout' :
            'Active ' + pct(i.me) + '% against ' + pct(i.reference) + '% for players ahead of you' + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : '') + ' on ' + label,
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
                           text: v === 'pass' ? 'active throughout' : 'Active ' + pct(k.me.activePercent) + '% of ' + pullLabel(k, kills) + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : ''),
                           fix: 'Keep casting through transitions; if an assignment took you off the boss, tell the raid leader so it is counted as not on you.' }));
        }
    }
    const ch = shareRow(facts, { id: 'channel', key: 'channel_time', category: 'casting',
        text: (i, k, label) => 'Channelling Drain Soul and other utility ' + pct(i.me) + ' seconds of every minute on ' + label + '; players ahead of you ' + pct(i.reference),
        fix: 'Drain Soul only in the last seconds; never channel while the boss is targetable.' });
    if (ch) out.push(ch);
    // Life taps: shown, never graded (tbc-audit's rule).
    const withRef = kills.filter(k => k.reference && k.fight.durationSec && ((k.me.casts || {})['Life Tap'] || (k.reference.casts || {})['Life Tap']));
    if (withRef.length) {
        const k = withRef[0];
        const mine = perMin((k.me.casts || {})['Life Tap'] || 0, k.fight.durationSec), theirs = perMin((k.reference.casts || {})['Life Tap'] || 0, k.reference.castsDurationSec);
        out.push(row({ id: 'life_taps', category: 'casting', verdict: 'info', me: mine, reference: theirs, unit: 'a minute', measuredOn: pullLabel(k, kills), text: 'Life Tap ' + mine + ' a minute; players ahead of you ' + (theirs === null ? '—' : theirs) }));
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
        text: 'No Bloodlust on ' + pullsText(noLust.length, lustKills.length) + ' while players ahead of you had it' }));
    // Curse: an assignment question, one row, only when the two sides' most-cast curse differ.
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
            text: 'You run ' + mine + ' (assignment); players ahead of you run ' + theirs + (ab && num(ab.share) !== null ? ', ' + Math.round(ab.share) + '% of their damage' : ''),
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

// --- consumables (spec §4.3 "Consumables")
const OIL = /wizard oil|mana oil|sharpening stone|weightstone/i;
function habitRow(o) {
    const v = verdictForHabit(o.failing.length, o.measurable.length);
    if (!v) return null;
    const k = o.failing[0] || o.measurable[0];
    return row(Object.assign({ verdict: v, pulls: { hit: o.failing.length, of: o.measurable.length }, measuredOn: pullLabel(k, o.kills) }, o.build(k, v)));
}
function consumableRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts), out = [];
    const known = kills.filter(k => k.me.consumablesKnown);
    const refFlask = k => k.reference && k.reference.flaskShare >= 0.5 && k.reference.flask ? k.reference.flask : null;
    const noFlask = k => !k.me.flask && (refFlask(k) || !(k.me.battleElixir && k.me.guardianElixir));
    const flask = habitRow({ kills, measurable: known, failing: known.filter(noFlask), build: (k, v) => {
        const had = (k.me.consumablesAtPull || []).filter(n => !/^well fed$/i.test(n) && !OIL.test(n));
        const share = averageShare(kills, 'power_consumables');
        return { id: 'flask', category: 'consumables', value: v === 'pass' ? null : Math.max(share || 0, NOMINAL_VALUE.flask),
                 text: v === 'pass' ? 'Flask at every pull' : 'Flask: ' + (had.length ? had.join(' + ') : 'nothing') + ' at the ' + pullLabel(k, kills) + ' pull' + (refFlask(k) ? '; players ahead of you run ' + refFlask(k) : ''),
                 fix: 'Run ' + (refFlask(k) || 'a flask') + ' at every pull.' };
    } });
    if (flask) out.push(flask);
    const food = habitRow({ kills, measurable: known, failing: known.filter(k => !k.me.food), build: (k, v) => ({ id: 'food', category: 'consumables', value: v === 'pass' ? null : NOMINAL_VALUE.food,
        text: v === 'pass' ? 'Food at every pull' : 'No food buff at the ' + pullLabel(k, kills) + ' pull', fix: 'Eat before every pull.' }) });
    if (food) out.push(food);
    const refOil = k => (k.reference && (k.reference.consumablesAtPull || []).find(n => OIL.test(n))) || null;
    const oilable = known.filter(refOil);
    const oil = habitRow({ kills, measurable: oilable, failing: oilable.filter(k => !(k.me.consumablesAtPull || []).some(n => OIL.test(n))), build: (k, v) => ({ id: 'oil', category: 'consumables', value: v === 'pass' ? null : NOMINAL_VALUE.oil,
        text: v === 'pass' ? 'Weapon oil at every pull' : 'No ' + refOil(k) + ' at the ' + pullLabel(k, kills) + ' pull', fix: 'Put ' + refOil(k) + ' on your weapon.' }) });
    if (oil) out.push(oil);
    // Potions: the reference's damage potion (a Casts-table name in POTION_LABEL) and how often.
    const refPotion = k => { const casts = (k.reference && k.reference.casts) || {}; const n = Object.keys(casts).filter(x => GAP.POTION_LABEL[x]).sort((a, b) => casts[b] - casts[a])[0]; return n ? { name: n, count: casts[n] } : null; };
    const potionable = kills.filter(k => num(k.me.potionUse) !== null && k.fight.durationSec > T.potionMinSec);
    const potionFail = k => { const p = refPotion(k); return k.me.potionUse === 0 || (p && p.count >= 0.5 && !(k.me.casts || {})[p.name]); };
    const potion = habitRow({ kills, measurable: potionable, failing: potionable.filter(potionFail), build: (k, v) => {
        const failing = potionable.filter(potionFail);
        const counts = failing.map(refPotion).filter(Boolean).map(p => Math.round(p.count)).sort((a, b) => a - b);
        const p = refPotion(k);
        const median = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
        const possible = Math.floor(k.fight.durationSec / 120) + 1;
        const label = p ? GAP.POTION_LABEL[p.name] : 'Potion';
        const range = counts.length ? (counts[0] === counts[counts.length - 1] ? String(counts[0]) : counts[0] + '–' + counts[counts.length - 1]) : null;
        return { id: 'potion', category: 'consumables', value: v === 'pass' ? null : Math.min(6, NOMINAL_VALUE.potion * Math.max(1, median)),
                 text: v === 'pass' ? 'A potion on every pull' : label + ': 0 on ' + pullsText(failing.length, potionable.length) + (range ? '; players ahead of you use ' + range + ' a pull' : '') + ' (up to ' + possible + ' in a fight this long)',
                 fix: 'Pop one on the pull and again every two minutes.' };
    } });
    if (potion) out.push(potion);
    return out;
}

// --- cooldowns (spec §4.3 "Cooldowns"; v2 §6 burst timing)
function cooldownRows(facts) {
    const kills = liveKills(facts);
    const lustKills = kills.filter(k => k.reference && Array.isArray(k.reference.burst) && k.me.bloodlustPercent > 0);
    const outside = k => (k.me.burst || []).filter(b => { const r = k.reference.burst.find(x => x.name === b.name); return r && r.insideBloodlust >= 1 && b.uses >= 1 && b.insideBloodlust === 0; }).map(b => GAP.POTION_LABEL[b.name] || b.name);
    const failing = lustKills.filter(k => outside(k).length);
    if (!failing.length) return [];
    const names = Array.from(new Set(failing.flatMap(outside)));
    return [row({ id: 'burst_timing', category: 'cooldowns', verdict: verdictForHabit(failing.length, lustKills.length), pulls: { hit: failing.length, of: lustKills.length }, value: NOMINAL_VALUE.burst_timing, measuredOn: pullLabel(failing[0], kills),
                  text: names.join(' and ') + ' used outside Bloodlust on ' + pullsText(failing.length, lustKills.length) + '; players ahead of you line it up with Bloodlust', fix: 'Hold ' + names.join(' and ') + ' for Bloodlust.' })];
}

// --- spell choice (spec §4.3 "Spell choice"; the v3 rotationFindings rules, aggregated)
const offLimits = n => isCurse(n) || GAP.RACIAL.test(n) || GAP.ENCOUNTER_ITEM.test(n) || GAP.UTILITY_CAST.test(n) || !!GAP.POTION_LABEL[n];
function spellRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts).filter(k => k.reference && k.fight.durationSec && k.reference.castsDurationSec);
    const out = [];
    const fmt = x => Math.round(x * 10) / 10;
    // unused: per ability, the pulls the reference used it on vs the pulls the player never cast it.
    const used = {}, unusedOn = {}, rates = {};
    kills.forEach(k => {
        const refMin = k.reference.castsDurationSec / 60;
        Object.keys(k.reference.casts || {}).forEach(n => {
            if (offLimits(n)) return;
            const r = k.reference.casts[n] / refMin;
            if (!(r >= T.unusedPerMin || k.reference.casts[n] >= T.unusedPerFightCooldown)) return;
            used[n] = (used[n] || 0) + 1;
            if (!(k.me.casts || {})[n]) { unusedOn[n] = (unusedOn[n] || 0) + 1; (rates[n] = rates[n] || []).push(fmt(r)); }
        });
    });
    const names = Object.keys(unusedOn).filter(n => unusedOn[n] * 2 >= used[n]).sort((a, b) => unusedOn[b] - unusedOn[a]);
    if (names.length) {
        const failing = kills.filter(k => names.some(n => (k.reference.casts || {})[n] && !(k.me.casts || {})[n]));
        const range = n => { const r = rates[n].slice().sort((a, b) => a - b); return r[0] === r[r.length - 1] ? String(r[0]) : r[0] + '–' + r[r.length - 1]; };
        out.push(row({ id: 'unused', category: 'spells', verdict: verdictForHabit(failing.length, kills.length), pulls: { hit: failing.length, of: kills.length }, value: NOMINAL_VALUE.unused, measuredOn: pullLabel(failing[0], kills),
                       text: 'Never cast: ' + names.map((n, i) => n + ' (' + (i === 0 ? 'players ahead of you ' : '') + range(n) + ' a minute)').join(', '),
                       fix: ABILITY_FIX[names[0]] || 'Use it as players ahead of you do.' }));
    }
    // under_used: a top-3 reference ability the player casts under ratioLow of the reference rate.
    const under = [];
    kills.forEach(k => {
        const top3 = (k.reference.abilities || []).slice(0, 3).map(a => a.name), min = k.fight.durationSec / 60, refMin = k.reference.castsDurationSec / 60;
        top3.forEach(n => { const r = (k.reference.casts || {})[n], p = (k.me.casts || {})[n]; if (r && p && p / min < T.ratioLow * (r / refMin)) under.push({ k, n, p: fmt(p / min), r: fmt(r / refMin) }); });
    });
    if (under.length) {
        const u = under[0];
        out.push(row({ id: 'under_used', category: 'spells', verdict: 'warn', pulls: { hit: new Set(under.map(x => x.k)).size, of: kills.length }, me: u.p, reference: u.r, unit: 'a minute', measuredOn: pullLabel(u.k, kills),
                       text: u.n + ' ' + u.p + ' a minute against ' + u.r + ' for players ahead of you on ' + pullLabel(u.k, kills), fix: ABILITY_FIX[u.n] || 'Use it as often as players ahead of you do.' }));
    }
    // extra: cast at least extraPerMin a minute while the reference never casts it — info only.
    const extra = [];
    kills.forEach(k => { const min = k.fight.durationSec / 60; Object.keys(k.me.casts || {}).forEach(n => { if ((k.reference.casts || {})[n] || offLimits(n)) return; if (k.me.casts[n] / min >= T.extraPerMin) extra.push(n + ' (' + k.me.casts[n] + ' on ' + pullLabel(k, kills) + ')'); }); });
    if (extra.length) out.push(row({ id: 'extra', category: 'spells', verdict: 'info', text: 'Cast while players ahead of you do not: ' + extra.join(', ') }));
    return out;
}

// The nuke_hit remainder clause: honest about what logs cannot see (spec §2) — a debuff
// comparison that was never measured cannot be blamed for the shortfall, and one that measured
// in the player's favour cannot be credited with explaining it either; either way the remainder
// stays a remainder, not pinned on the player.
function nukeRemainder(p, restPct) {
    if (!p.debMeasured) return '; raid debuffs could not be compared on this pull, so the remaining ' + restPct + '% is raid debuffs, talents, ability rank or gear that logs cannot show';
    if (p.debPct <= 0) return '; the remaining ' + restPct + '% is talents, ability rank or gear that logs cannot show';
    return '; raid debuffs explain about ' + p.debPct + '%, the remaining ' + restPct + '% is talents, ability rank or gear that logs cannot show';
}

// --- nuke damage (spec §4.3 "Nuke damage"): the rotation remainder, explained as far as logs allow.
function nukeRows(facts) {
    const kills = liveKills(facts).filter(k => k.gap && k.reference);
    const role = (facts.player && facts.player.role) || 'caster', K = GAP.C.POWER_BASE[role] || GAP.C.POWER_BASE.caster;
    // ref-above C1: the same role test passRows uses for its power word.
    const powerWord = (role === 'melee' || role === 'ranged' || role === 'tank') ? 'attack power' : 'spell power';
    const per = [];
    kills.forEach(k => {
        const main = mainAbility(k);
        if (main === 'spell' || AUTO_ATTACK.has(main)) return; // ref-above B2: no white-hit comparisons
        const mine = (k.me.abilities || []).find(a => a.name === main), theirs = (k.reference.abilities || []).find(a => a.name === main);
        if (!mine || !theirs || !num(mine.avgHit) || !num(theirs.avgHit)) return;
        const sum = side => ['power_gear', 'power_consumables', 'power_buffs'].reduce((s, key) => { const i = inputOf(k, key); return s + (i && num(i[side]) !== null ? i[side] : 0); }, 0);
        const deb = inputOf(k, 'debuffs'), debMeasured = !!(deb && num(deb.me) !== null && num(deb.reference) !== null), myDeb = debMeasured ? deb.me : 1, refDeb = debMeasured ? deb.reference : 1;
        const myPower = sum('me'), refPower = sum('reference');
        const observed = mine.avgHit / theirs.avgHit, expected = ((myPower + K) / (refPower + K)) * (myDeb / refDeb);
        per.push({ k, main, mine, theirs, residual: observed / expected, debMeasured, debPct: Math.round(100 * (1 - myDeb / refDeb)), samePower: Math.abs(myPower - refPower) / Math.max(refPower, 1) < 0.05, myPower, refPower });
    });
    if (!per.length) return [];
    const avg = per.reduce((s, p) => s + p.residual, 0) / per.length;
    const worst = per.slice().sort((a, b) => a.residual - b.residual)[0];
    const verdict = avg < 0.9 ? 'fail' : avg < 0.95 ? 'warn' : 'pass';
    const share = averageShare(kills, 'rotation');
    const restPct = Math.max(0, Math.round(100 * (1 - worst.residual)));
    const label = pullLabel(worst.k, liveKills(facts));
    return [row({ id: 'nuke_hit', category: 'nuke', verdict, me: worst.mine.avgHit, reference: worst.theirs.avgHit, unit: 'non-crit hit', value: verdict === 'pass' ? null : (share > 0 ? share : null), measuredOn: label,
                  text: worst.main + ' hits for ' + worst.mine.avgHit + ' non-crit against ' + worst.theirs.avgHit + (worst.samePower ? ' at the same ' + powerWord : ' (you had ' + worst.myPower + ' ' + powerWord + ', they had ' + worst.refPower + ')') + ' on ' + label +
                        (verdict === 'pass' ? '' : nukeRemainder(worst, restPct)),
                  fix: verdict === 'pass' ? '' : (NUKE_FIX[facts.player && facts.player.spec] || 'Check your talents and the rank of ' + worst.main + '.') })];
}

// --- gear (spec §4.3 "Nuke damage" hit, "Gear")
function gearRows(facts) {
    const kills = liveKills(facts), out = [];
    const role = (facts.player && facts.player.role) || 'caster', physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const perPct = physical ? GAP.C.MELEE_HIT_RATING_PER_PCT : GAP.C.HIT_RATING_PER_PCT;
    const gear = (facts.gear && facts.gear.findings) || [];
    const gearHit = gear.find(g => g.key === 'gear_hit' && num(g.value) !== null && num(g.bar) !== null);
    const hitShare = averageShare(kills, 'hit_under_cap'), hitBest = largestPull(kills, 'hit_under_cap');
    if (gearHit) {
        const under = gearHit.value < gearHit.bar;
        // This number is the raid's requirement (the request's threshold minus a talent
        // allowance), not the true hit cap — say so, or "the N cap" tells the player something
        // the data does not.
        out.push(row({ id: 'hit', category: 'gear', verdict: under ? 'fail' : 'pass', me: gearHit.value, reference: gearHit.bar, unit: 'hit rating',
                       value: under ? Math.max(hitShare > 0 ? hitShare : 0, Math.max(1, Math.round((gearHit.bar - gearHit.value) / perPct)) * NOMINAL_VALUE.hit) : null,
                       text: under ? 'Hit: ' + gearHit.value + ' on your current gear against the ' + gearHit.bar + ' your raid asks for' : 'Hit at what your raid asks for',
                       fix: under ? 'Reach ' + gearHit.bar + ' hit before any other stat.' : '' }));
    } else if (hitShare !== null && hitShare >= 3 && hitBest) {
        const cap = Math.round((physical ? GAP.C.HIT_CAP.melee * GAP.C.MELEE_HIT_RATING_PER_PCT : GAP.C.HIT_CAP.spell * GAP.C.HIT_RATING_PER_PCT));
        out.push(row({ id: 'hit', category: 'gear', verdict: verdictForShare(hitShare), me: hitBest.input.me, reference: cap, unit: 'hit rating', value: hitShare, measuredOn: pullLabel(hitBest.kill, kills),
                       text: 'Hit: ' + hitBest.input.me + ' at the ' + pullLabel(hitBest.kill, kills) + ' pull against the ' + cap + ' cap', fix: 'Reach ' + cap + ' hit before any other stat.' }));
    }
    // Stat priority rows come per pull from statPriorityFindings (kill.findings, key gear_stat).
    const byStat = {};
    kills.forEach(k => (k.findings || []).filter(f => f.key === 'gear_stat' && f.stat && f.stat !== 'spellHit' && f.stat !== 'meleeHit').forEach(f => { (byStat[f.stat] = byStat[f.stat] || []).push({ k, f }); }));
    Object.keys(byStat).forEach(stat => {
        const first = byStat[stat][0];
        out.push(row({ id: 'stat_' + stat, category: 'gear', verdict: 'warn', me: first.f.me, reference: first.f.reference, pulls: { hit: byStat[stat].length, of: kills.length }, measuredOn: pullLabel(first.k, kills),
                       text: first.f.text.replace(' for ' + GAP.REF_LABEL, ' for players ahead of you'), fix: 'Prefer ' + (STAT_WORD[stat] || stat) + ' when upgrading.' }));
    });
    gear.filter(g => g.key === 'gear_enchants' || g.key === 'gear_sockets').forEach(g => {
        const slots = /\(([^)]+)\)/.exec(g.text);
        out.push(row({ id: g.key.replace('gear_', ''), category: 'gear', verdict: g.severity === 'major' ? 'fail' : 'warn', me: num(g.value), text: g.text,
                       fix: g.key === 'gear_enchants' ? 'Enchant ' + (slots ? slots[1] : 'the missing slots') + '.' : 'Fill every socket.' }));
    });
    return out;
}

// --- pass-only rows for "Fine" (spec §4.3 "Fine")
function passRows(facts) {
    const kills = liveKills(facts), out = [];
    if (kills.length && kills.every(k => !k.me.died)) out.push(row({ id: 'deaths', category: 'casting', verdict: 'pass', text: 'no deaths' }));
    const acc = kills.filter(k => inputOf(k, 'power_gear'));
    if (acc.length && acc.every(k => { const i = inputOf(k, 'power_gear'); return num(i.me) !== null && num(i.reference) !== null && i.me >= i.reference; }))
        out.push(row({ id: 'power_gear', category: 'gear', verdict: 'pass', text: (facts.player && (facts.player.role === 'melee' || facts.player.role === 'ranged' || facts.player.role === 'tank') ? 'attack power' : 'spell power') + ' on par with players ahead of you' }));
    return out;
}

// --- verdict (spec §4.5)
function fractionWord(p) { return p >= 80 ? 'almost all' : p >= 70 ? 'about three quarters' : p >= 60 ? 'most' : p >= 45 ? 'about half' : p >= 28 ? 'about a third' : p >= 18 ? 'about a quarter' : p >= 8 ? 'a small part' : null; }
function medianOf(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
function verdictOf(facts) {
    const acc = liveKills(facts).filter(k => k.gap && k.reference && num(k.me.amount) && num(k.reference.playersDps || k.reference.dps));
    if (!acc.length) return null;
    const ratioPercent = Math.round(medianOf(acc.map(k => 100 * k.me.amount / (k.reference.playersDps || k.reference.dps))));
    const keys = {};
    acc.forEach(k => ['casts', 'dmg', 'crit'].forEach(f => k.gap.factors[f].inputs.forEach(i => { keys[i.key] = i.owner; })));
    const sumOwner = owner => Math.max(0, Object.keys(keys).filter(k => keys[k] === owner).reduce((s, k) => s + (averageShare(acc, k) || 0), 0));
    const onYou = sumOwner('player'), onSetup = sumOwner('group');
    return { ratioPercent, onYou, onSetup, onRest: Math.max(0, 100 - onYou - onSetup) };
}

// --- assembly (spec §4.6)
function buildChecklist(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const limited = !!(facts && facts.limited);
    // Spec §5: the healer sheet renders only Consumables, Casting (activity), deaths, Gear and
    // Not on you — group asks ("Ask your raid leader") are not on that list, so limited sheets
    // skip groupRows too; raidRows ("Not on you") stays.
    let rows = [].concat(consumableRows(facts, T), limited ? [] : cooldownRows(facts), castingRows(facts, T), limited ? [] : spellRows(facts, T), limited ? [] : nukeRows(facts), gearRows(facts), passRows(facts), limited ? [] : groupRows(facts), raidRows(facts));
    const seen = new Set(); rows = rows.filter(r => r && !seen.has(r.id) && seen.add(r.id));
    const cat = r => CATEGORY_ORDER.indexOf(r.category);
    const byValue = (a, b) => ((b.value ?? -1) - (a.value ?? -1)) || (cat(a) - cat(b));
    const player = rows.filter(r => r.owner === 'player');
    const fails = player.filter(r => r.verdict === 'fail').sort(byValue), warns = player.filter(r => r.verdict === 'warn').sort(byValue);
    const fixFirst = fails.slice(0, ROW_CAPS.fixFirst).map(r => r.id);
    const also = fails.slice(ROW_CAPS.fixFirst).concat(warns).slice(0, ROW_CAPS.also).map(r => r.id);
    const asks = rows.filter(r => r.owner === 'group' && (r.verdict === 'fail' || r.verdict === 'warn')).sort(byValue).slice(0, ROW_CAPS.asks).map(r => r.id);
    const fine = FINE_IDS.filter(id => rows.some(r => r.id === id && r.verdict === 'pass'));
    const live = liveKills(facts);
    const stand = ((facts.overall && facts.overall.ceiling) || []).map(c => {
        const k = live.find(x => x.name === c.name && (!c.date || x.date === c.date));
        return { name: c.name, date: c.date, me: Math.round(c.me), sameClass: k && Array.isArray(k.fight.sameClass) ? k.fight.sameClass.filter(p => !p.isMe).map(p => p.amount) : [], dps: c.dps, topDps: c.topDps };
    });
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const bad = (facts.overall && facts.overall.badPulls) || [];
    const groups = [];
    bad.forEach(b => {
        let g = groups.find(x => x.name === b.name); if (!g) { g = { name: b.name, count: 0, months: [] }; groups.push(g); }
        g.count++;
        if (b.date && live.some(k => k.name === b.name)) { const m = MONTHS[parseInt(b.date.slice(5, 7), 10) - 1]; if (!g.months.includes(m)) g.months.push(m); }
    });
    return { verdict: limited ? null : verdictOf(facts), rows, fixFirst, also, asks, fine, stand,
             notOnYou: { badPulls: { total: ((facts.kills) || []).length, live: live.length, groups }, rows: rows.filter(r => r.owner === 'raid') } };
}

// --- the text (spec §5)
function renderReport(cl, facts) {
    const p = facts.player || {}, tier = facts.tier || {}, byId = id => cl.rows.find(r => r.id === id);
    // ref-above C2: shares above 100% happen when two inputs offset (Tipsi: cast pacing +169%
    // against damage per cast -62%). The arithmetic is sound but "169% of the gap" means nothing
    // to a reader, and clamping to 100% would assert something the accounting did not measure —
    // so the finding stands on its text alone. Fix round 1, Finding 3: the guard is two-sided, so
    // it matches "never outside 0-100%" -- a negative share would otherwise print as "(~-62%)".
    const val = r => (r.value !== null && r.value !== undefined && r.value >= 0 && r.value <= 100 ? ' (~' + r.value + '%)' : '');
    const line = r => r.text + '.' + (r.fix ? ' ' + r.fix : '') + val(r);
    const head = facts.night ? 'raid night of ' + facts.night.date + ', median parse that night ' + Math.round(facts.night.medianPercent) : 'median parse ' + Math.round(tier.medianPercent);
    // ref-above C1: a single night's report names that night's tier. The gating tier is only
    // right for an across-all-kills report, and since nights now span both tiers it was wrong
    // whenever the chosen night came from the non-gating one.
    const zoneName = (facts.night && facts.night.zoneName) || tier.zoneName || '';
    const out = [p.name + ' — ' + (p.spec || '?') + ', ' + zoneName + ', ' + head];
    if (cl.verdict) {
        const v = cl.verdict, parts = [];
        if (fractionWord(v.onYou)) parts.push(fractionWord(v.onYou) + ' of that gap is on you');
        if (fractionWord(v.onSetup)) parts.push(fractionWord(v.onSetup) + ' is the raid\'s setup');
        if (fractionWord(v.onRest)) parts.push('the rest is the raid\'s pulls and luck');
        out.push('You do ' + v.ratioPercent + '% of what ' + GAP.REF_LABEL + ' do.' + (parts.length ? ' ' + parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : ''));
    }
    const section = (title, ids, numbered) => { if (!ids.length) return; out.push('', title); ids.forEach((id, i) => out.push((numbered ? (i + 1) + '. ' : '- ') + line(byId(id)))); };
    section(facts.limited ? 'What\'s holding your healing back' : 'Fix first', cl.fixFirst, true);
    section('Also', cl.also, false);
    if (cl.asks.length) { out.push('', 'Ask your raid leader'); cl.asks.forEach(id => { const r = byId(id); out.push('- ' + r.text + '.' + (r.fix ? ' ' + r.fix : '') + val(r)); }); }
    if (cl.fine.length) out.push('', 'Fine', cl.fine.map(id => byId(id).text).join(', ').replace(/^./, c => c.toUpperCase()) + '.');
    if (cl.stand.length) {
        const cls = String(p.class || 'player').toLowerCase();
        out.push('', 'Where you stand');
        cl.stand.forEach(s => out.push(s.name + ': you ' + s.me + (s.sameClass.length ? '; ' + cls + 's in your raid ' + s.sameClass.join(' / ') : '') + '; players ahead of you ' + s.dps + '; the best at your item level ' + s.topDps));
    }
    const bp = cl.notOnYou.badPulls;
    if (bp.groups.length || cl.notOnYou.rows.length) {
        out.push('', 'Not on you');
        if (bp.groups.length) out.push((bp.total - bp.live) + ' of ' + bp.total + ' pulls were raid-wide bad pulls (' + bp.groups.map(g => g.name + (g.count > 1 ? ' ×' + g.count : '') + (g.months.length ? ' (' + g.months.join(', ') + ')' : '')).join(', ') + ') and are left out.');
        cl.notOnYou.rows.forEach(r => out.push(r.text + '.'));
    }
    out.push('', 'Pick one thing to change next raid.');
    return out.join('\n');
}

module.exports = { NOMINAL_VALUE, ROW_CAPS, FINE_IDS, CATEGORY_ORDER, DEFAULT_T, MOVEMENT_FILLER, ABILITY_FIX, NUKE_FIX, BUFF_SOURCE, STAT_WORD, AUTO_ATTACK,
                   liveKills, inputOf, averageShare, largestPull, verdictForShare, verdictForHabit, pullLabel, row, shareRow, mainAbility, perMin, halfRule, castingRows, groupRows, raidRows,
                   consumableRows, cooldownRows, spellRows, nukeRows, gearRows, passRows, buildChecklist, renderReport, fractionWord, verdictOf };
