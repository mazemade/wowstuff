'use strict';
// Node-only. The DPS-gap accounting for the parse feedback report (spec v3): constants, the
// arithmetic that turns gear, buffs and debuffs into expected crit and power, and the helpers the
// accounting in explainGap (Task 3) is built from. Nothing here queries WCL. Constants feed shares
// and asks; a player is never judged against one of them directly.

// Rating conversions at level 70 and crit maths per class/spec.
const C = {
    CRIT_RATING_PER_PCT: 22.08, HIT_RATING_PER_PCT: 12.62, MELEE_HIT_RATING_PER_PCT: 15.77, AGI_PER_CRIT: { ROGUE: 40, HUNTER: 40, DRUID: 25, WARRIOR: 33, PALADIN: 25, SHAMAN: 25 },
    BASE_CRIT: { caster: 1.7, melee: 0, ranged: 0, tank: 0, healer: 1.7 },
    INT_PER_CRIT: { WARLOCK: 81.9, MAGE: 80, PRIEST: 80, DRUID: 80, SHAMAN: 80, PALADIN: 80 },
    // Damage a crit adds relative to a hit: Ruin, Spell Power, Vengeance, Elemental Fury and all
    // physical crits double; plain spell crits add half.
    CRIT_BONUS: { Destruction: 1, Fire: 1, Arcane: 1, Balance: 1, Elemental: 1, Affliction: 0.5, Demonology: 0.5, Frost: 0.5, Shadow: 0.5, Discipline: 0.5, Holy: 0.5, Restoration: 0.5,
                  Combat: 1, Assassination: 1, Subtlety: 1, Fury: 1, Arms: 1, Protection: 1, Retribution: 1, Enhancement: 1, Feral: 1, BeastMastery: 1, Marksmanship: 1, Survival: 1 },
    // Crit percent the spec's talents add to its main damaging spells (spec v3 §3.3).
    SPEC_CRIT: { Destruction: 8, Affliction: 3, Demonology: 3, Fire: 9, Arcane: 3, Frost: 0, Shadow: 0, Balance: 4, Elemental: 5, Retribution: 0, Enhancement: 0,
                 Combat: 5, Assassination: 5, Subtlety: 5, Fury: 5, Arms: 5, Protection: 0, Feral: 0, BeastMastery: 0, Marksmanship: 5, Survival: 5 },
    HIT_CAP: { spell: 16, melee: 9, ranged: 9 },
    // Base damage of the main ability expressed in power points (Shadow Bolt: ~575 average base
    // damage at a 0.857 coefficient ≈ 670 spell power). Damage per cast scales with power + base.
    POWER_BASE: { caster: 670, melee: 1000, ranged: 1000, tank: 1000, healer: 670 },
};

// Buffs at pull with the value they add (spec v3 §7). `scope` says who owns it: a consumable is
// the player's, a party buff is an ask.
const BUFF_VALUES = {
    'Flask of Pure Death': { spellPower: 80, scope: 'consumable' }, 'Flask of Blinding Light': { spellPower: 80, scope: 'consumable' },
    'Flask of Supreme Power': { spellPower: 70, scope: 'consumable' }, 'Flask of Relentless Assault': { attackPower: 120, scope: 'consumable' },
    'Elixir of Major Shadow Power': { spellPower: 55, scope: 'consumable' }, 'Major Shadow Power': { spellPower: 55, scope: 'consumable' },
    'Elixir of Major Firepower': { spellPower: 55, scope: 'consumable' }, 'Major Firepower': { spellPower: 55, scope: 'consumable' },
    'Elixir of Major Frost Power': { spellPower: 55, scope: 'consumable' }, 'Major Frost Power': { spellPower: 55, scope: 'consumable' },
    "Adept's Elixir": { spellPower: 24, critRating: 24, scope: 'consumable' }, 'Greater Arcane Elixir': { spellPower: 35, scope: 'consumable' },
    'Elixir of Major Agility': { agility: 30, critRating: 20, scope: 'consumable' }, 'Elixir of Major Strength': { strength: 35, scope: 'consumable' },
    'Fel Strength Elixir': { attackPower: 90, scope: 'consumable' },
    'Brilliant Wizard Oil': { spellPower: 14, critRating: 14, scope: 'consumable' }, 'Superior Wizard Oil': { spellPower: 42, scope: 'consumable' },
    'Well Fed': { spellPower: 23, attackPower: 40, scope: 'consumable' },
    'Wrath of Air Totem': { spellPower: 101, scope: 'party' }, 'Totem of Wrath': { critPct: 3, hitPct: 3, scope: 'party' },
    'Moonkin Aura': { critPct: 5, scope: 'party' }, 'Chain of the Twilight Owl': { critPct: 2, scope: 'party' },
    'Eye of the Night': { spellPower: 34, scope: 'party' }, 'Prayer of Spirit': { spellPower: 40, scope: 'party' }, 'Divine Spirit': { spellPower: 40, scope: 'party' },
    'Arcane Brilliance': { intellect: 40, scope: 'party' }, 'Arcane Intellect': { intellect: 40, scope: 'party' },
    'Greater Blessing of Kings': { statsPct: 10, scope: 'party' }, 'Blessing of Kings': { statsPct: 10, scope: 'party' },
    'Fel Intelligence': { intellect: 48, scope: 'party' },
    'Battle Shout': { attackPower: 305, scope: 'party' }, 'Trueshot Aura': { attackPower: 125, scope: 'party' },
    'Strength of Earth Totem': { strength: 86, scope: 'party' }, 'Unleashed Rage': { attackPowerPct: 10, scope: 'party' },
    'Grace of Air Totem': { agility: 77, scope: 'party' }, 'Leader of the Pack': { critPct: 5, scope: 'party' }, 'Ferocious Inspiration': { damagePct: 3, scope: 'party' },
};

// Raid debuffs on the boss and what they multiply (spec v3 §3.2). Armour debuffs are expressed as
// the physical multiplier they are worth against a 6200-armour boss.
const DEBUFF_MULT = {
    'Curse of the Elements': { mult: 1.10, schools: ['arcane', 'fire', 'frost', 'shadow'] },
    'Shadow Weaving': { mult: 1.10, schools: ['shadow'] },
    'Fire Vulnerability': { mult: 1.15, schools: ['fire'] },
    'Sunder Armor': { mult: 1.18, schools: ['physical'] }, 'Expose Armor': { mult: 1.18, schools: ['physical'] },
    'Faerie Fire': { mult: 1.04, schools: ['physical'] }, 'Faerie Fire (Feral)': { mult: 1.04, schools: ['physical'] },
    'Curse of Recklessness': { mult: 1.05, schools: ['physical'] },
    'Blood Frenzy': { mult: 1.04, schools: ['physical'] },
};

// Channelled utility: time inside these auras is time not spent on damage.
const CHANNEL_UTILITY = ['Drain Soul', 'Drain Life', 'Drain Mana', 'Health Funnel', 'Evocation'];

// Gear-stat findings appear in this order, and a stat lower in the list is not reported while a
// higher one is under its bar (spec v3 §4).
const STAT_PRIORITY = {
    Destruction: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Affliction: ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit'], Demonology: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Fire: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Arcane: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Frost: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Shadow: ['spellHit', 'spellDamage', 'spellHaste', 'spellCrit'], Balance: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'], Elemental: ['spellHit', 'spellDamage', 'spellCrit', 'spellHaste'],
    Combat: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Assassination: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Subtlety: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    Fury: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Arms: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Retribution: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    Enhancement: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'], Feral: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    Protection: ['meleeHit', 'expertise', 'attackPower', 'meleeCrit', 'meleeHaste'],
    BeastMastery: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'], Marksmanship: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'], Survival: ['meleeHit', 'rangedAttackPower', 'rangedCrit', 'meleeHaste'],
};

// Why a raid that took much longer than the reference's kill did less damage per second: phases
// the fast kill skipped or shortened. Used in the bad-pull text (spec v3 §3.4).
const PHASE_BOSSES = {
    'The Lurker Below': 'Lurker submerges 90 seconds in and is untargetable for 60 seconds; the reference kills him before that',
    'Lady Vashj': 'phase 2 has no boss to hit while striders and cores are handled',
    'Morogrim Tidewalker': 'Watery Grave and the murloc waves cost casting time',
    "Kael'thas Sunstrider": 'four advisor phases and the weapons come before the boss',
    'Leotheras the Blind': 'demon form and whirlwinds force movement',
    'High Astromancer Solarian': 'the split phases have no boss to hit',
    "Al'ar": 'phase 1 platform swaps and phase 2 dive bombs force movement',
    'Hydross the Unstable': 'the resistance-gear transitions cost casting time',
    'Fathom-Lord Karathress': 'three adds die before the boss takes real damage',
    'Rage Winterchill': 'the trash waves count in the pull time', 'Anetheron': 'the trash waves count in the pull time',
    "Kaz'rogal": 'the trash waves count in the pull time', 'Azgalor': 'the trash waves count in the pull time',
};

// Fraction of a fight's damage a properly timed burst is worth (spec v3 §3.5).
const BURST_VALUE = { default: 0.02, Destruction: 0.03, Haste: 0.03 };


// Final review item 11: Math.round of a tiny negative log is -0, which JSON.stringify writes as
// 0 but Object.is tells apart and a strict test would catch; `|| 0` normalises -0 (and any NaN a
// degenerate input could produce) to a plain 0.
function share(logValue, G) { return (G > 0 ? Math.round(100 * logValue / G) : 0) || 0; }
function splitLog(remaining, weights) {
    const w = (weights || []).map(x => (typeof x === 'number' && x > 0 ? x : 0));
    const sum = w.reduce((s, x) => s + x, 0);
    if (!w.length) return [];
    if (!sum) return w.map((x, i) => (i === w.length - 1 ? remaining : 0));
    return w.map(x => remaining * x / sum);
}

function auraValue(auras, key) {
    return (auras || []).reduce((s, n) => s + ((BUFF_VALUES[n] || {})[key] || 0), 0);
}
function auraValueByScope(auras, key, scope) {
    return (auras || []).reduce((s, n) => { const b = BUFF_VALUES[n]; return s + (b && b.scope === scope ? (b[key] || 0) : 0); }, 0);
}

// Expected crit chance (percent) from what the player brought and what the group gave them.
function expectedCrit(o) {
    const { stats, auras, classToken, spec, role } = o;
    if (!stats) return null;
    const cls = String(classToken || '').toUpperCase();
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const rating = physical ? (role === 'ranged' ? stats.rangedCrit : stats.meleeCrit) : stats.spellCrit;
    // Intellect and agility buffs (Arcane Brilliance, Kings, Grace of Air) are already inside the
    // stat WCL reports for the player and are unknowable for reference players; neither side counts
    // them again here. Party buffs contribute only their flat crit percent.
    let gear, consumables, buffs;
    if (physical) {
        const perCrit = C.AGI_PER_CRIT[cls] || 40;
        const agi = typeof stats.agility === 'number' ? stats.agility : 0;
        gear = (rating || 0) / C.CRIT_RATING_PER_PCT + agi / perCrit;
        consumables = auraValueByScope(auras, 'critRating', 'consumable') / C.CRIT_RATING_PER_PCT + auraValueByScope(auras, 'agility', 'consumable') / perCrit;
        buffs = auraValueByScope(auras, 'critPct', 'party');
    } else {
        const perCrit = C.INT_PER_CRIT[cls] || 80;
        const int = typeof stats.intellect === 'number' ? stats.intellect : 0;
        gear = (rating || 0) / C.CRIT_RATING_PER_PCT + int / perCrit;
        consumables = auraValueByScope(auras, 'critRating', 'consumable') / C.CRIT_RATING_PER_PCT;
        buffs = auraValueByScope(auras, 'critPct', 'party');
    }
    const base = C.BASE_CRIT[role] || 0, talents = C.SPEC_CRIT[spec] || 0;
    return { gear, consumables, buffs, total: base + talents + gear + consumables + buffs };
}

// Spell power or attack power from gear, consumables and party buffs.
function powerParts(o) {
    const { stats, auras, role } = o;
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const key = physical ? 'attackPower' : 'spellPower';
    const gearKey = physical ? (role === 'ranged' ? 'rangedAttackPower' : 'attackPower') : 'spellDamage';
    const gear = stats && typeof stats[gearKey] === 'number' ? stats[gearKey] : null;
    let consumables = auraValueByScope(auras, key, 'consumable'), buffs = auraValueByScope(auras, key, 'party');
    if (physical) {
        consumables += 2 * auraValueByScope(auras, 'strength', 'consumable') + auraValueByScope(auras, 'agility', 'consumable');
        buffs += 2 * auraValueByScope(auras, 'strength', 'party') + auraValueByScope(auras, 'agility', 'party') + (gear || 0) * auraValue(auras, 'attackPowerPct') / 100;
    }

    return { gear, consumables, buffs };
}

function channelSeconds(buffsTable) {
    const d = buffsTable && buffsTable.data;
    const auras = d && Array.isArray(d.auras) ? d.auras : [];
    return auras.filter(a => a && CHANNEL_UTILITY.includes(a.name)).flatMap(a => Array.isArray(a.bands) ? a.bands : [])
        .reduce((s, b) => s + Math.max(0, (b.endTime - b.startTime) / 1000), 0);
}

// Casts, damage, hits and crits over the abilities that actually did damage.
function damagingCastStats(casts, abilities) {
    const out = { casts: 0, damage: 0, hits: 0, crits: 0 };
    (abilities || []).forEach(a => {
        if (!a || !(a.total > 0)) return;
        out.casts += (casts && casts[a.name]) || 0;
        out.damage += a.total;
        out.hits += a.hits || 0;
        out.crits += a.hits && typeof a.critPercent === 'number' ? Math.round(a.hits * a.critPercent / 100) : 0;
    });
    return out;
}

function debuffMultiplier(present, schools) {
    return (present || []).reduce((m, p) => {
        const d = DEBUFF_MULT[p.name];
        if (!d || !d.schools.some(s => (schools || []).includes(s)) || typeof p.uptimePercent !== 'number') return m;
        return m * (1 + (d.mult - 1) * p.uptimePercent / 100);
    }, 1);
}

// --- The accounting (spec v3 §3). Everything is on the log scale so factor shares add up.
const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
const safeLog = r => (r > 0 && isFinite(r) ? Math.log(r) : 0);
function input(key, owner, logValue, G, me, reference, unit) {
    return { key, owner, share: share(logValue, G), me, reference, unit: unit || null };
}
function finish(factor, G) {
    factor.share = share(Math.log(factor.value), G);
    return factor;
}

function explainGap(kill, player) {
    const me = kill && kill.me, ref = kill && kill.reference, fight = kill && kill.fight;
    if (!me || !ref || !fight) return null;
    const need = ['damagingCastsPerMinute', 'damagePerDamagingCast', 'critRate'];
    // A literal 0 on any of these would divide to Infinity below, so they must be positive, not
    // merely non-null.
    if (need.some(k => num(me[k]) === null || !(me[k] > 0) || num(ref[k]) === null) || num(me.amount) === null || !(me.amount > 0)) return null;
    // Controller ruling (cross-task): the ratio is measured against the same players the factors
    // below (casts, damage per cast, crit) are measured on — the three fetched reference players —
    // not `reference.dps`, the median of the wider (typically eight) collected ranks. Mixing the
    // two over-explained the gap (the fixture's residual sat at -49%: the factors, measured on the
    // three, multiplied out past a ratio measured on the eight). `reference.dps` stays in the facts
    // sheet as the displayed "typical" number; `playersDps` falls back to it only when a caller
    // (a hand-built pull, or a legacy referenceSummary call) never computed it.
    const refDps = num(ref.playersDps) !== null ? ref.playersDps : num(ref.dps);
    if (refDps === null || !(refDps > 0)) return null;
    const rawRatio = refDps / me.amount;
    // Round once, here, and use the rounded ratio for every downstream computation (the >1 gate,
    // G, and the residual factor below). Gating on the unrounded ratio while reporting the rounded
    // one let a ratio that rounds down to exactly 1 (e.g. 2200/2199.9) through as an all-zero
    // accounting instead of null; rounding before the gate closes that. And rounding here (rather
    // than only at the return) keeps residual.value * casts.value * dmg.value * crit.value equal
    // to the ratio that is actually returned, not the raw one.
    const ratio = Math.round(rawRatio * 1000) / 1000;
    if (!(ratio > 1)) return null;
    const G = Math.log(ratio);
    const role = player.role, spec = player.spec, schools = player.schools || [];
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';

    // Casts factor: raid activity, own activity, channel time, pacing (remainder).
    const casts = { value: ref.damagingCastsPerMinute / me.damagingCastsPerMinute, inputs: [] };
    const myRaid = num(fight.raidActivePercent), refRaid = num(ref.raidActivePercent), myAct = num(me.activePercent), refAct = num(ref.activePercent);
    const raidLog = myRaid && refRaid ? safeLog(refRaid / myRaid) : 0;
    const ownLog = myRaid && refRaid && myAct && refAct ? safeLog((refAct / refRaid) / (myAct / myRaid)) : 0;
    const myCh = num(me.channelSecPerMin) || 0, refCh = num(ref.channelSecPerMin) || 0;
    const chLog = safeLog((60 - refCh) / (60 - myCh));
    const paceLog = Math.log(casts.value) - raidLog - ownLog - chLog;
    casts.inputs.push(input('raid_activity', 'raid', raidLog, G, myRaid, refRaid, 'raid median active %'));
    casts.inputs.push(input('own_activity', 'player', ownLog, G, myAct, refAct, 'active %'));
    casts.inputs.push(input('channel_time', 'player', chLog, G, myCh, refCh, 'seconds a minute channelling'));
    casts.inputs.push(input('cast_pacing', 'player', paceLog, G, me.damagingCastsPerMinute, ref.damagingCastsPerMinute, 'damaging casts a minute'));

    // Crit bonus (Ruin, Spell Power, Vengeance, Elemental Fury and every physical crit double;
    // a plain spell crit adds half) is needed here already: damagePerDamagingCast is total damage
    // over casts, so it already has crit damage baked in, and the crit factor below would otherwise
    // double-count it.
    const B = typeof C.CRIT_BONUS[spec] === 'number' ? C.CRIT_BONUS[spec] : 0.5;
    // Damage-per-cast factor: hit, debuffs, power split (gear / consumables / buffs), rotation.
    // Both sides' damage per cast is measured with crits included; dividing each by its own crit
    // multiplier (1 + critRate * B) leaves the non-crit-equivalent damage per cast, so the ratio
    // below is no longer inflated by the same crit gap the crit factor accounts for separately.
    const norm = (dpc, critRate) => dpc / (1 + critRate / 100 * B);
    const dmg = { value: norm(ref.damagePerDamagingCast, ref.critRate) / norm(me.damagePerDamagingCast, me.critRate), inputs: [] };
    const hitKey = physical ? 'meleeHit' : 'spellHit', perPct = physical ? C.MELEE_HIT_RATING_PER_PCT : C.HIT_RATING_PER_PCT, cap = physical ? C.HIT_CAP[role === 'ranged' ? 'ranged' : 'melee'] : C.HIT_CAP.spell;
    const myHit = me.stats && num(me.stats[hitKey]), refHit = ref.stats && num(ref.stats[hitKey]);
    const miss = h => Math.max(0, cap - h / perPct) / 100;
    const hitLog = myHit !== null && refHit !== null ? safeLog((1 - miss(refHit)) / (1 - miss(myHit))) : 0;
    // Both sides' debuff tables have to actually be known: an absent table reads as "no debuffs"
    // (debuffMultiplier([]) === 1), which would fabricate a group-owned share against a reference
    // that does carry a real multiplier (or the mirror case: an unknown reference).
    const debuffsKnown = !!(kill.debuffs && kill.debuffs.known && Array.isArray(ref.debuffs));
    const myDeb = debuffMultiplier(kill.debuffs && kill.debuffs.present, schools), refDeb = debuffMultiplier(ref.debuffs, schools);
    const debLog = debuffsKnown ? safeLog(refDeb / myDeb) : 0;
    const myP = powerParts({ stats: me.stats, auras: (me.consumablesAtPull || []).concat(me.buffsAtPull || []), role });
    const refP = powerParts({ stats: ref.stats, auras: (ref.consumablesAtPull || []).concat(ref.buffsAtPull || []), role });
    const remaining = Math.log(dmg.value) - hitLog - debLog;
    // Damage per cast scales with total power plus the ability's base (POWER_BASE): the log factor
    // that difference explains is split over the three power sources in proportion to their
    // positive gaps, clipped to what is left after hit and debuffs. What power cannot claim is
    // ability choice and misses: rotation. Without gear power on both sides nothing is claimed.
    const K = C.POWER_BASE[role] || C.POWER_BASE.caster;
    let powerLogs = [0, 0, 0];
    if (myP.gear !== null && refP.gear !== null && remaining > 0) {
        const myTot = myP.gear + myP.consumables + myP.buffs, refTot = refP.gear + refP.consumables + refP.buffs;
        const total = Math.min(remaining, Math.max(0, safeLog((refTot + K) / (myTot + K))));
        powerLogs = splitLog(total, [refP.gear - myP.gear, refP.consumables - myP.consumables, refP.buffs - myP.buffs]);
    }
    const rotLog = remaining - powerLogs.reduce((s, x) => s + x, 0);
    dmg.inputs.push(input('hit_under_cap', 'player', hitLog, G, myHit, refHit, 'hit rating'));
    dmg.inputs.push(input('debuffs', 'group', debLog, G, debuffsKnown ? Math.round(100 * myDeb) / 100 : null, debuffsKnown ? Math.round(100 * refDeb) / 100 : null, 'debuff multiplier'));
    dmg.inputs.push(input('power_gear', 'player', powerLogs[0], G, myP.gear, refP.gear, physical ? 'attack power from gear' : 'spell power from gear'));
    dmg.inputs.push(input('power_consumables', 'player', powerLogs[1], G, myP.consumables, refP.consumables, physical ? 'attack power from consumables' : 'spell power from consumables'));
    dmg.inputs.push(input('power_buffs', 'group', powerLogs[2], G, myP.buffs, refP.buffs, physical ? 'attack power from party buffs' : 'spell power from party buffs'));
    // rotation's displayed me/reference stay the raw (crit-included) damage per cast — the number
    // the raid leader recognises — even though the factor's own value above is crit-normalised.
    dmg.inputs.push(input('rotation', 'player', rotLog, G, me.damagePerDamagingCast, ref.damagePerDamagingCast, 'damage per cast (crits included)'));

    // Crit factor: expected from gear / consumables / buffs, the rest is luck.
    const crit = { value: (1 + ref.critRate / 100 * B) / (1 + me.critRate / 100 * B), inputs: [] };
    const myE = expectedCrit({ stats: me.stats, auras: (me.consumablesAtPull || []).concat(me.buffsAtPull || []), classToken: player.classToken, spec, role });
    const refE = expectedCrit({ stats: ref.stats, auras: (ref.consumablesAtPull || []).concat(ref.buffsAtPull || []), classToken: player.classToken, spec, role });
    const critLogOf = (a, b) => safeLog((1 + b / 100 * B) / (1 + a / 100 * B));
    let gearLog = 0, buffLog = 0;
    if (myE && refE) {
        // Walk the expected chance up one input at a time, so each input's log is its own step.
        // Consumable crit rating is not an input: the player's reported rating already holds it, a
        // reference player's gear-derived rating does not, so it stays with luck (Task 1 ruling).
        const noCons = e => e.total - e.consumables;
        const afterGear = noCons(myE) + (refE.gear - myE.gear);
        gearLog = critLogOf(noCons(myE), afterGear);
        buffLog = critLogOf(afterGear, noCons(refE));
    }
    const luckLog = Math.log(crit.value) - gearLog - buffLog;
    crit.inputs.push(input('crit_gear', 'player', gearLog, G, myE ? Math.round(myE.gear * 10) / 10 : null, refE ? Math.round(refE.gear * 10) / 10 : null, 'crit % from gear'));
    crit.inputs.push(input('crit_buffs', 'group', buffLog, G, myE ? Math.round(myE.buffs * 10) / 10 : null, refE ? Math.round(refE.buffs * 10) / 10 : null, 'crit % from party buffs'));
    crit.inputs.push(input('crit_luck', 'noise', luckLog, G, me.critRate, ref.critRate, 'measured crit %'));

    const residual = { value: ratio / (casts.value * dmg.value * crit.value), inputs: [] };
    const factors = { casts: finish(casts, G), dmg: finish(dmg, G), crit: finish(crit, G), residual: finish(residual, G) };
    return { ratio, factors, residualShare: factors.residual.share };
}

const REF_LABEL = 'players ahead of you at your item level';
function pct(x) { return typeof x === 'number' ? Math.round(x * 10) / 10 : x; }
// Final review item 9: a group ask has to name what to ask for. The accounting knows both sides,
// so the debuff and party-buff lines say which debuffs were missing on the boss and which buffs
// the pull lacked, and the standalone "buffs_missing"/"debuff_missing" lists are dropped
// (vet-feedback.js killFindings) rather than repeating the same ask in weaker words.
function missingDebuffs(kill) {
    const m = kill && kill.debuffs && Array.isArray(kill.debuffs.missing) ? kill.debuffs.missing : [];
    return m.map(x => x && x.name).filter(Boolean);
}
function missingPartyBuffs(kill) {
    const have = (kill && kill.me && Array.isArray(kill.me.partyBuffs)) ? kill.me.partyBuffs : [];
    const theirs = (kill && kill.reference && Array.isArray(kill.reference.buffsAtPull)) ? kill.reference.buffsAtPull : [];
    return theirs.filter(b => !have.includes(b));
}
function gapText(i, boss, kill) {
    const w = ' Worth ' + i.share + '% of the gap';
    const missDeb = missingDebuffs(kill), missBuffs = missingPartyBuffs(kill);
    const debTail = missDeb.length ? '; missing: ' + missDeb.join(', ') : '';
    const buffTail = missBuffs.length ? '; missing at your pull: ' + missBuffs.join(', ') : '';
    switch (i.key) {
        case 'raid_activity': return 'Your raid was active ' + pct(i.me) + '% of ' + boss + ' against ' + pct(i.reference) + '% for the reference raid; phases and downtime, not you.' + w;
        case 'own_activity': return 'Active ' + pct(i.me) + '% of ' + boss + ' against ' + pct(i.reference) + '% for ' + REF_LABEL + '.' + w;
        case 'channel_time': return 'Channelling Drain Soul and other utility ' + pct(i.me) + ' seconds of every minute on ' + boss + '; players ahead of you ' + pct(i.reference) + '.' + w;
        case 'cast_pacing': return pct(i.me) + ' damaging casts a minute on ' + boss + ' while active, against ' + pct(i.reference) + '; the time between casts.' + w;
        case 'hit_under_cap': return 'Hit rating ' + i.me + ' against ' + i.reference + ' for ' + REF_LABEL + '; misses are wasted casts.' + w;
        case 'debuffs': return 'Raid debuffs on ' + boss + ' multiplied damage by ' + i.me + ' against ' + i.reference + ' for the reference raid' + debTail + '.' + w;
        case 'power_gear': return 'Spell power from gear ' + i.me + ' against ' + i.reference + ' for ' + REF_LABEL + '.' + w;
        case 'power_consumables': return i.reference + ' spell power from flask, elixirs, oil and food for ' + REF_LABEL + '; you had ' + i.me + '.' + w;
        case 'power_buffs': return i.reference + ' spell power from party buffs for ' + REF_LABEL + '; you had ' + i.me + buffTail + '.' + w;
        // Final review item 11: "after gear, buffs and debuffs are accounted for: ability choice and
        // misses" read as a claim that the rest IS ability choice. It is the unexplained remainder.
        case 'rotation': return 'Damage per cast ' + i.me + ' against ' + i.reference + ': what gear, buffs, debuffs and crit do not explain — ability choice, misses and anything unmeasured.' + w;
        case 'crit_gear': return 'Crit from gear (rating and intellect) ' + pct(i.me) + '% against ' + pct(i.reference) + '% for ' + REF_LABEL + '.' + w;
        case 'crit_buffs': return 'Crit from party buffs ' + pct(i.me) + '% against ' + pct(i.reference) + '% for ' + REF_LABEL + buffTail + '.' + w;
        default: return i.key + ' ' + i.me + ' against ' + i.reference + '.' + w;
    }
}
// spec v3 §4: every input at or above minShare becomes one finding; luck never does.
function gapFindings(kill, player, thresholds) {
    const g = kill && kill.gap;
    if (!g) return [];
    const min = thresholds && typeof thresholds.minShare === 'number' ? thresholds.minShare : 3;
    const out = [];
    ['casts', 'dmg', 'crit'].forEach(fk => g.factors[fk].inputs.forEach(i => {
        // ref-above C2: a negative share means the player is AHEAD of the reference on this input.
        // True, and not a fix — reporting it as one is how "damage per cast -62%" became advice.
        if (i.owner === 'noise' || i.share < min || i.share < 0) return;
        const physical = player.role === 'melee' || player.role === 'ranged' || player.role === 'tank';
        let text = gapText(i, kill.name, kill);
        if (physical) text = text.replace(/Spell power|spell power/g, m => (m[0] === 'S' ? 'Attack power' : 'attack power'));
        out.push({ key: i.key, owner: i.owner, severity: i.share >= 15 ? 'major' : 'minor', scope: i.owner === 'raid' ? 'raid' : i.owner, share: i.share, factor: fk, text, me: i.me, reference: i.reference, unit: i.unit });
    }));
    return out.sort((a, b) => b.share - a.share);
}
const STAT_TEXT = { spellHit: 'Hit rating', meleeHit: 'Hit rating', expertise: 'Expertise rating', spellDamage: 'Spell power from gear', attackPower: 'Attack power from gear', rangedAttackPower: 'Ranged attack power from gear',
                    spellCrit: 'Spell crit rating', meleeCrit: 'Crit rating', rangedCrit: 'Crit rating', spellHaste: 'Spell haste rating', meleeHaste: 'Haste rating' };
// spec v3 §4: gear stats in priority order; a stat lower in the list is not reported while a
// higher one is under its bar. Hit's bar is the raid's cap; the rest use the reference's gear.
function statPriorityFindings(o) {
    const { me, reference, spec, role, hitCap, boss } = o;
    if (!me || !reference) return [];
    const order = STAT_PRIORITY[spec] || STAT_PRIORITY[role === 'caster' ? 'Destruction' : 'Combat'];
    // Final review item 11: without a caller-supplied cap the hit bar used to fall back to the
    // REFERENCE's own hit rating, which is a middle-of-the-board player's gear, not a cap — the
    // live note showed "spell hit 69 vs 202" on one line and a reference-derived bar on another.
    // The raid's cap in rating is the only correct bar: 16% for spells, 9% for melee/ranged.
    const capBar = (role === 'caster' || role === 'healer')
        ? Math.round(C.HIT_CAP.spell * C.HIT_RATING_PER_PCT)
        : Math.round(C.HIT_CAP.melee * C.MELEE_HIT_RATING_PER_PCT);
    const out = [];
    for (const stat of order) {
        const isHitStat = stat === 'spellHit' || stat === 'meleeHit';
        const mine = me[stat], bar = isHitStat ? (typeof hitCap === 'number' ? hitCap : capBar) : reference[stat];
        if (typeof mine !== 'number' || typeof bar !== 'number' || !bar) continue;
        const under = (stat === 'spellHit' || stat === 'meleeHit') ? mine < bar : mine < 0.9 * bar;
        if (!under) continue;
        const isHit = stat === 'spellHit' || stat === 'meleeHit';
        const text = isHit ? STAT_TEXT[stat] + ' ' + mine + ' against the ' + bar + ' the raid asks for; get hit to the cap before any other stat'
                           : STAT_TEXT[stat] + ' ' + mine + ' against ' + bar + ' for ' + REF_LABEL;
        // Final review item 2: a stat line is not part of the accounting, so it carries no share at
        // all. A literal 0 here read as "0% of the gap" in the live note.
        out.push({ key: 'gear_stat', owner: 'player', severity: isHit ? 'major' : 'minor', scope: 'player', share: null, stat, text, me: mine, reference: bar, boss });
        if (isHit) break;
    }
    return out;
}

function averageGap(kills) {
    const gaps = (kills || []).map(k => k && k.gap).filter(Boolean);
    if (!gaps.length) return null;
    const avg = key => Math.round(gaps.reduce((s, g) => s + g.factors[key].share, 0) / gaps.length);
    return { casts: avg('casts'), dmg: avg('dmg'), crit: avg('crit'), residual: avg('residual') };
}

// v4: cast-name tables shared by the findings (vet-feedback.js) and the checklist (vet-checklist.js).
const POTION_LABEL = { Destruction: 'Destruction Potion', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' };
const UTILITY_CAST = /life tap|healthstone|bandage|first aid|cannibalize|soulstone|soulshatter|rune$|potion|drain soul|^create |^summon |armor$|resurrection|^restore mana$/i;
const RACIAL = /blood fury|berserking|arcane torrent|stoneform|will of the forsaken|war stomp|escape artist|perception|shadowmeld|gift of the naaru/i;
const ENCOUNTER_ITEM = /mental protection field|staff of disintegration|phaseshift bulwark|netherstrand longbow|infinity blade|warp slicer|cosmic infuser/i;

module.exports = { C, BUFF_VALUES, DEBUFF_MULT, CHANNEL_UTILITY, STAT_PRIORITY, PHASE_BOSSES, BURST_VALUE, POTION_LABEL, UTILITY_CAST, RACIAL, ENCOUNTER_ITEM, share, splitLog, expectedCrit, powerParts, channelSeconds, damagingCastStats, debuffMultiplier, explainGap, averageGap, REF_LABEL, gapFindings, statPriorityFindings };
