'use strict';
// Every value below is read from the pinned wowsims/tbc-new checkout. Do not change a
// number without changing the file:line reference beside it.
const SOURCE_COMMIT = '72e0c8a8feaf62da67add31090666773d6040f69';

const RATING = { // sim/core/base_stats_auto_gen.go:12-22
    expertisePerQuarterPercent: 3.942308,
    physicalHitPerPercent: 15.769233, spellHitPerPercent: 12.615385,
    physicalCritPerPercent: 22.076923, spellCritPerPercent: 22.076923,
    physicalHastePerPercent: 15.769233, spellHastePerPercent: 15.76923,
};
const BOSS = { // sim/core/target.go:393-403 (fifth column = level 73); dual-wield: sim/core/spell_outcome.go:573-574
    level: 73, spellMiss: 0.17, meleeMiss: 0.08, dualWieldPenalty: 0.19, block: 0.05, dodge: 0.065, parry: 0.14,
    glance: 0.24, glanceMultiplier: 0.75, hitSuppression: 0.01, meleeCritSuppression: 0.048, spellCritSuppression: 0.021,
};
const CRIT_PERCENT_PER_AGILITY = { WARRIOR: 0.0303, PALADIN: 0.04, HUNTER: 0.025, ROGUE: 0.025, PRIEST: 0.04, SHAMAN: 0.04, MAGE: 0.04, WARLOCK: 0.0405, DRUID: 0.04 }; // sim/core/base_stats_auto_gen.go:24-35
const ATTACK_POWER_PER_STRENGTH = { WARRIOR: 2, PALADIN: 2, SHAMAN: 2, HUNTER: 1, ROGUE: 1, DRUID: 1, WARLOCK: 1 }; // sim/warrior/warrior.go:235, sim/paladin/paladin.go:128, sim/shaman/shaman.go:36, sim/hunter/hunter.go:277, sim/rogue/rogue.go:210, sim/druid/druid.go:301, sim/warlock/warlock.go:168
const ATTACK_POWER_PER_AGILITY = { HUNTER: 1, ROGUE: 1 }; // sim/hunter/hunter.go:278, sim/rogue/rogue.go:211 (hunter ranged AP also 1 per agility, hunter.go:279)
// WCL combatant data does not expose talent ranks. These only widen the expected range and are named in the assumption text.
const HIT_TALENTS = {
    ROGUE: { name: 'Precision', percent: 5, kind: 'physical' },      // sim/rogue/talents_combat.go:90
    HUNTER: { name: 'Surefooted', percent: 3, kind: 'physical' },    // sim/hunter/talents.go:526
};
const SPELL_TALENT_RANGE = 10; // sim/priest/talents.go:323-328 (Shadow Focus 2% × 5 ranks), sim/warlock/talents.go:74-81 (Suppression 2% × 5 ranks); used when no verified entry exists

const clamp = (value) => Math.max(0, value);
const range = (min, max) => ({ min: Math.min(min, max), max: Math.max(min, max) });
const scale = (r, n) => ({ min: r.min * n, max: r.max * n });

function hitPercentRange({ rating = 0, kind = 'physical', classToken = '' }) {
    const per = kind === 'spell' ? RATING.spellHitPerPercent : RATING.physicalHitPerPercent;
    const base = (Number(rating) || 0) / per;
    const talent = HIT_TALENTS[String(classToken).toUpperCase()];
    const extra = talent && talent.kind === kind ? talent.percent : kind === 'spell' ? SPELL_TALENT_RANGE : 0;
    const assumption = extra
        ? (talent && talent.kind === kind ? talent.name + ' is not recorded by Warcraft Logs; the expected range spans 0/' + talent.percent + ' to ' + talent.percent + '/' + talent.percent + '.'
            : 'Spell-hit talents are not verified for this class; the expected range spans 0 to ' + SPELL_TALENT_RANGE + '% talent hit.')
        : null;
    return { ...range(base, base + extra), assumption };
}

function expectedOutcomes({ attack, swings = 0, hitRating = 0, expertiseRating = 0, classToken = '', inFront = false }) {
    const assumptions = [];
    const zero = { min: 0, max: 0 };
    const kind = attack === 'spell' ? 'spell' : 'physical';
    const hit = hitPercentRange({ rating: hitRating, kind, classToken });
    if (hit.assumption) assumptions.push(hit.assumption);
    let miss;
    if (attack === 'spell') miss = range(Math.max(0.01, BOSS.spellMiss - hit.max / 100), Math.max(0.01, BOSS.spellMiss - hit.min / 100)); // sim/core/spell_result.go:261 floors at 1%
    else {
        const penalty = attack === 'melee-white' ? BOSS.dualWieldPenalty : 0; // sim/core/spell_outcome.go:573; ranged and yellow use the no-penalty path (:591, :467)
        miss = range(clamp(BOSS.meleeMiss + penalty - clamp(hit.max / 100 - BOSS.hitSuppression)), clamp(BOSS.meleeMiss + penalty - clamp(hit.min / 100 - BOSS.hitSuppression)));
        if (attack === 'melee-white') assumptions.push('Dual-wield white swings carry the 19% miss penalty; if this player used a single weapon the expected misses are lower.');
    }
    const suppression = Math.floor((Number(expertiseRating) || 0) / RATING.expertisePerQuarterPercent) / 400; // sim/core/spell_result.go:174-177
    const physicalMelee = attack === 'melee-white' || attack === 'melee-yellow';
    const dodge = physicalMelee ? range(clamp(BOSS.dodge - suppression), clamp(BOSS.dodge - suppression)) : zero;
    const parry = physicalMelee && inFront ? range(clamp(BOSS.parry - suppression), clamp(BOSS.parry - suppression)) : zero;
    if (physicalMelee && !inFront) assumptions.push('Parries are expected to be zero from behind the target; recorded parries mean time spent in front.');
    const glance = attack === 'melee-white' ? range(BOSS.glance, BOSS.glance) : zero; // sim/core/spell_outcome.go:232-240 (white only)
    const block = attack === 'ranged' ? range(BOSS.block, BOSS.block) : zero;
    const rates = { miss, dodge, parry, glance, block };
    return { rates, expected: Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, scale(r, swings)])), assumptions };
}

function varianceCheck(observed, expectedRange, swings) {
    const n = Math.max(1, Number(swings) || 0);
    const p = Math.min(0.5, Math.max(expectedRange.min, expectedRange.max) / n);
    const sd = Math.sqrt(n * p * (1 - p));
    const low = expectedRange.min - 2 * sd, high = expectedRange.max + 2 * sd;
    return { within: observed >= low && observed <= high, low, high, sd };
}

module.exports = { SOURCE_COMMIT, RATING, BOSS, CRIT_PERCENT_PER_AGILITY, ATTACK_POWER_PER_STRENGTH, ATTACK_POWER_PER_AGILITY, HIT_TALENTS, hitPercentRange, expectedOutcomes, varianceCheck };
