'use strict';
// Node-only. Turns Warcraft Logs fight data into a parse feedback facts sheet for one player, and
// builds the prompt that turns that sheet into a player-facing report. The GraphQL `query`
// function is injected, as in vet-profile.js: the server passes wclQuery, the tests pass a stub.
const V = require('./vet-engine.js');

const KILL_LIMIT = 8;
// Reference selection: same spec, same boss, same region, item level within `band` of the
// player; widened once to `wideBand` when fewer than `min` ranks are found.
const REF = { band: 2, wideBand: 4, target: 8, min: 3, players: 3, maxPages: 5, cacheMs: 24 * 60 * 60 * 1000 };
// Finding thresholds (spec §4). Not user-editable in v1.
const T = {
    activeMajor: 85, activeGap: 8, castsLowRatio: 0.85, diedBefore: 0.9,
    unusedPerMin: 1.5, extraPerMin: 1, ratioLow: 0.7,
    critGap: 10, hitRatio: 0.85, resistGap: 10,
    statPrimaryRatio: 0.9, statSecondaryRatio: 0.85,
    debuffUptime: 70, potionMinSec: 60,
    longFightRatio: 2, raidUnderPercent: 5, raidUnderShare: 0.8, raidSpeedLow: 5,
};

const WCL_CLASS_NAME = { DRUID: 'Druid', HUNTER: 'Hunter', MAGE: 'Mage', PALADIN: 'Paladin', PRIEST: 'Priest', ROGUE: 'Rogue', SHAMAN: 'Shaman', WARLOCK: 'Warlock', WARRIOR: 'Warrior' };
// WCL spells spec names without spaces: 'Beast Mastery' -> 'BeastMastery'.
function wclSpecName(spec) { return String(spec || '').replace(/[^A-Za-z]/g, ''); }

// Damage schools per spec, used to pick the raid debuffs that matter to the player. Specs not
// listed are physical when the role is melee/ranged/tank and have no school otherwise (healers).
const SPEC_SCHOOLS = {
    'PRIEST:Shadow': ['shadow'], 'WARLOCK:Affliction': ['shadow'], 'WARLOCK:Demonology': ['shadow'], 'WARLOCK:Destruction': ['shadow'],
    'MAGE:Arcane': ['arcane'], 'MAGE:Fire': ['fire'], 'MAGE:Frost': ['frost'], 'DRUID:Balance': ['arcane'],
    'SHAMAN:Elemental': ['nature'], 'PALADIN:Retribution': ['physical', 'holy'],
};
function schoolsOf(classToken, spec, role) {
    const s = SPEC_SCHOOLS[String(classToken || '').toUpperCase() + ':' + spec];
    if (s) return s;
    return (role === 'melee' || role === 'ranged' || role === 'tank') ? ['physical'] : [];
}

// The gating tier's killed bosses, lowest median first, capped: the worst parses are where the
// explanation lives, and every boss costs about ten WCL points.
function pickKills(profile) {
    const p = profile && profile.parses;
    if (!p || !Array.isArray(p.bosses)) return [];
    const med = b => (typeof b.medianPercent === 'number' ? b.medianPercent : 101);
    return p.bosses.filter(b => b && b.kills > 0 && b.encounterId)
        .slice().sort((a, b) => med(a) - med(b))
        .slice(0, KILL_LIMIT)
        .map(b => ({ encounterId: b.encounterId, name: b.name, medianPercent: b.medianPercent }));
}

function median(values) {
    const v = (values || []).filter(x => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function round1(x) { return typeof x === 'number' ? Math.round(x * 10) / 10 : null; }
function lower(s) { return String(s || '').toLowerCase(); }

const ROLE_GROUP = { healer: 'healers', tank: 'tanks' };
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// Everything the fight-wide tables say about one pull: its length, how the raid itself ranked,
// where the player sat among their role, active time, death and potions, and whether the pull
// was so bad raid-wide that it says nothing about the player.
function fightContext(ctx, playerName, role, refDurationSec) {
    ctx = ctx || {};
    const fight = Array.isArray(ctx.fights) ? ctx.fights[0] : null;
    const durationSec = fight ? round1((fight.endTime - fight.startTime) / 1000) : null;
    const rank = ctx.rankings && ctx.rankings.data && ctx.rankings.data[0];
    const roles = (rank && rank.roles) || {};
    const me = lower(playerName);
    const groupOf = k => (roles[k] && Array.isArray(roles[k].characters)) ? roles[k].characters : [];
    let groupKey = ROLE_GROUP[role] || 'dps';
    let group = groupOf(groupKey);
    if (!group.some(c => lower(c.name) === me)) {
        const found = ['dps', 'healers', 'tanks'].find(k => groupOf(k).some(c => lower(c.name) === me));
        if (found) { groupKey = found; group = groupOf(found); }
    }
    const sorted = group.slice().sort((a, b) => b.amount - a.amount);
    const idx = sorted.findIndex(c => lower(c.name) === me);
    const under = group.filter(c => c.rankPercent < T.raidUnderPercent).length;

    const dmg = ctx.dmgAll && ctx.dmgAll.data;
    const totalTime = dmg ? dmg.totalTime : null;
    const rows = dmg && Array.isArray(dmg.entries) ? dmg.entries : [];
    const activeOf = row => (totalTime && row && typeof row.activeTime === 'number') ? round1(100 * row.activeTime / totalTime) : null;
    const meRow = rows.find(r => lower(r.name) === me) || null;
    const groupNames = new Set(group.map(c => lower(c.name)));
    const raidActivePercent = round1(median(rows.filter(r => r.type !== 'Pet' && groupNames.has(lower(r.name))).map(activeOf)));

    const deaths = (ctx.deaths && ctx.deaths.data && Array.isArray(ctx.deaths.data.entries)) ? ctx.deaths.data.entries : [];
    const myDeath = deaths.find(d => lower(d.name) === me);
    const pd = (ctx.summary && ctx.summary.data && ctx.summary.data.playerDetails) || {};
    const detail = ['dps', 'healers', 'tanks'].flatMap(k => Array.isArray(pd[k]) ? pd[k] : []).find(p => lower(p.name) === me) || null;
    const speed = rank && rank.speed && typeof rank.speed.rankPercent === 'number' ? rank.speed.rankPercent : null;

    const reasons = [];
    if (refDurationSec && durationSec > T.longFightRatio * refDurationSec) reasons.push('the pull took ' + Math.round(durationSec) + 's against a typical ' + Math.round(refDurationSec) + 's');
    if (group.length && under >= T.raidUnderShare * group.length) reasons.push(under + ' of ' + group.length + ' ' + groupKey + ' in the raid parsed under ' + T.raidUnderPercent);
    if (speed != null && speed < T.raidSpeedLow && idx >= 0 && idx < group.length / 2) reasons.push('the raid\'s kill speed ranked ' + speed + ' while you were ' + ordinal(idx + 1) + ' of ' + group.length + ' ' + groupKey);

    return {
        fight: {
            durationSec, referenceDurationSec: typeof refDurationSec === 'number' ? refDurationSec : null, raidDeaths: deaths.length,
            raidSpeedPercent: speed, raidExecutionPercent: rank && rank.execution && typeof rank.execution.rankPercent === 'number' ? rank.execution.rankPercent : null,
            raidGroup: groupKey, raidGroupCount: group.length, raidGroupRank: idx >= 0 ? idx + 1 : null,
            raidGroupMedianPercent: round1(median(group.map(c => c.rankPercent))), raidActivePercent,
            badPull: reasons.length > 0, badPullReason: reasons.length ? reasons.join('; ') : null,
        },
        me: {
            dps: idx >= 0 ? round1(sorted[idx].amount) : null, activePercent: activeOf(meRow),
            died: myDeath && fight ? { atSec: Math.round((myDeath.timestamp - fight.startTime) / 1000), by: myDeath.killingBlow ? myDeath.killingBlow.name : null } : null,
            potionUse: detail && typeof detail.potionUse === 'number' ? detail.potionUse : null,
            healthstoneUse: detail && typeof detail.healthstoneUse === 'number' ? detail.healthstoneUse : null,
        },
        meRow,
    };
}

// Per-ability damage facts from a sourceID-scoped DamageDone table. `hitdetails` splits hits into
// Hit / Critical Hit / Resisted Hit / Resisted Critical Hit (partial resists), which is where the
// average non-crit hit and the resist share come from.
function abilityStats(dmgTable) {
    const entries = (dmgTable && dmgTable.data && Array.isArray(dmgTable.data.entries)) ? dmgTable.data.entries : [];
    const total = entries.reduce((s, a) => s + (a.total || 0), 0);
    return entries.map(a => {
        const det = Array.isArray(a.hitdetails) ? a.hitdetails : [];
        const nonCrit = det.find(h => h.type === 'Hit');
        const crit = det.find(h => h.type === 'Critical Hit');
        const resisted = det.filter(h => /Resisted/.test(h.type)).reduce((s, h) => s + (h.count || 0), 0);
        const hits = a.hitCount || 0;
        return {
            name: a.name, total: a.total || 0, share: total ? round1(100 * a.total / total) : 0, hits,
            avgHit: nonCrit && nonCrit.count ? Math.round(nonCrit.total / nonCrit.count) : null,
            avgCrit: crit && crit.count ? Math.round(crit.total / crit.count) : null,
            critPercent: hits ? round1(100 * (a.critHitCount || 0) / hits) : null,
            resistPercent: hits ? round1(100 * resisted / hits) : null,
        };
    }).sort((a, b) => b.total - a.total);
}
function castCounts(castsTable) {
    const out = {};
    const entries = (castsTable && castsTable.data && Array.isArray(castsTable.data.entries)) ? castsTable.data.entries : [];
    entries.forEach(e => { if (e.name) out[e.name] = (out[e.name] || 0) + (e.total || 0); });
    return out;
}
function castsPerMinute(casts, durationSec) {
    if (!durationSec) return null;
    const n = Object.keys(casts || {}).reduce((s, k) => s + casts[k], 0);
    return round1(n / (durationSec / 60));
}
function buffUptime(buffsTable, name) {
    const d = buffsTable && buffsTable.data;
    if (!d || !d.totalTime) return null;
    const a = (Array.isArray(d.auras) ? d.auras : []).find(x => x.name === name);
    return a ? Math.round(100 * a.totalUptime / d.totalTime) : 0;
}

// Consumables as WCL names them in CombatantInfo auras. WCL drops "Elixir of" from some elixirs
// ("Major Shadow Power") and Shattrath flasks read "<flask> of Shattrath", so these are patterns.
const CONSUMABLE = {
    flask: [/^flask of /i, /^unstable flask/i, / of shattrath$/i],
    battle: [/^(elixir of )?major (fire|frost|shadow) ?power/i, /adept'?s elixir/i, /^(elixir of )?major agility/i, /mongoose/i,
             /^(elixir of )?major strength/i, /fel strength/i, /elixir of mastery/i, /healing power/i, /greater arcane elixir/i, /^(elixir of )?the sages/i],
    guardian: [/draenic wisdom/i, /mageblood/i, /^(elixir of )?major fortitude/i, /^(elixir of )?major defense/i, /ironshield/i, /earthen elixir/i, /^(elixir of )?major armor/i],
    food: [/^well fed$/i],
    oil: [/wizard oil/i, /mana oil/i, /sharpening stone/i, /weightstone/i],
};
// Guardian elixirs that give mana or utility rather than damage; a flask does more for a dps.
const UTILITY_GUARDIAN = [/draenic wisdom/i, /mageblood/i];
function isUtilityGuardian(name) { return UTILITY_GUARDIAN.some(re => re.test(String(name || ''))); }
function classifyAuras(names) {
    const has = (list, n) => list.some(re => re.test(n));
    const out = { flask: null, battleElixir: null, guardianElixir: null, food: null, oil: null, consumables: [], buffs: [] };
    (names || []).forEach(n => {
        if (has(CONSUMABLE.flask, n)) { out.flask = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.battle, n)) { out.battleElixir = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.guardian, n)) { out.guardianElixir = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.food, n)) { out.food = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.oil, n)) { out.oil = n; out.consumables.push(n); }
        else out.buffs.push(n);
    });
    return out;
}

// Party-scoped buffs that move the metric, by role. Single-target and greater versions are one
// buff for comparison purposes (BUFF_ALIAS folds them to the canonical name).
const BUFF_ALIAS = {
    'Divine Spirit': 'Prayer of Spirit', 'Arcane Intellect': 'Arcane Brilliance',
    'Blessing of Kings': 'Greater Blessing of Kings', 'Blessing of Wisdom': 'Greater Blessing of Wisdom', 'Blessing of Might': 'Greater Blessing of Might',
};
const PARTY_BUFFS = {
    caster: ['Moonkin Aura', 'Prayer of Spirit', 'Blood Pact', 'Eye of the Night', 'Chain of the Twilight Owl', 'Totem of Wrath', 'Wrath of Air Totem',
             'Arcane Brilliance', 'Greater Blessing of Kings', 'Greater Blessing of Wisdom', 'Fel Intelligence', 'Mana Spring Totem'],
    melee: ['Battle Shout', 'Leader of the Pack', 'Trueshot Aura', 'Ferocious Inspiration', 'Strength of Earth Totem', 'Grace of Air Totem', 'Unleashed Rage',
            'Greater Blessing of Might', 'Greater Blessing of Kings', 'Windfury Totem', 'Blood Pact'],
};
PARTY_BUFFS.healer = PARTY_BUFFS.caster; PARTY_BUFFS.ranged = PARTY_BUFFS.melee; PARTY_BUFFS.tank = PARTY_BUFFS.melee;
function canonBuffs(names, role) {
    const table = PARTY_BUFFS[role] || [];
    const canon = new Set((names || []).map(n => BUFF_ALIAS[n] || n));
    return table.filter(b => canon.has(b));
}

// Gear-derived stats, the same way the vetting profile computes them: WCL-reported ratings win
// where the CombatantInfo row carries them, gear fills the rest. The fight-wide DamageDone row
// carries gear too, which is what reference players (no CombatantInfo query) use.
const STAT_KEYS = ['spellDamage', 'healing', 'attackPower', 'rangedAttackPower', 'spellCrit', 'meleeCrit', 'rangedCrit', 'spellHit', 'meleeHit', 'spellHaste', 'meleeHaste', 'mp5'];
function playerStats(ci, row, dbIndex, classToken) {
    const gear = ci && Array.isArray(ci.gear) ? ci.gear : (row && Array.isArray(row.gear) ? row.gear : null);
    if (!gear || !gear.length || !dbIndex) return null;
    const s = V.summarizeGear(gear, dbIndex, classToken);
    const d = V.derivedStats(s.stats, ci || null);
    const out = {};
    STAT_KEYS.forEach(k => { out[k] = k === 'rangedCrit' ? (ci && typeof ci.critRanged === 'number' ? ci.critRanged : d.meleeCrit) : d[k]; });
    out.avgItemLevel = s.avgItemLevel;
    out.gearScore = s.gearScore;
    return out;
}

function bandRanks(rankings, itemLevel, band) {
    return (Array.isArray(rankings) ? rankings : []).filter(r => r && typeof r.bracketData === 'number' &&
        Math.abs(r.bracketData - itemLevel) <= band && r.report && r.report.code);
}
function countNames(lists) {
    const c = {};
    lists.forEach(l => new Set(l).forEach(n => { c[n] = (c[n] || 0) + 1; }));
    return c;
}
function mostCommon(names) {
    const c = countNames(names.map(n => [n]));
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
}

// What "players like you" do on this boss: DPS and fight length are medians over every in-band
// rank collected; everything that needs a fight's tables (casts, per-ability numbers, buffs,
// consumables, stats) is a median over the fetched reference players. An ability or buff counts
// only when a majority of those players show it, so one player's one-off cast is not "unused".
function referenceSummary(ranks, players, dbIndex, classToken, role, band) {
    const per = (players || []).map(p => {
        const fight = Array.isArray(p.context.fights) ? p.context.fights[0] : null;
        const dur = fight ? (fight.endTime - fight.startTime) / 1000 : null;
        const dmg = p.context.dmgAll && p.context.dmgAll.data;
        const row = dmg && Array.isArray(dmg.entries) ? dmg.entries.find(e => lower(e.name) === lower(p.rank.name)) : null;
        const casts = castCounts(p.tables.casts);
        const ci = p.tables.ci && p.tables.ci.data && p.tables.ci.data[0];
        const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
        return {
            dur, activePercent: row && dmg.totalTime && typeof row.activeTime === 'number' ? round1(100 * row.activeTime / dmg.totalTime) : null,
            casts, castsPerMinute: castsPerMinute(casts, dur), abilities: abilityStats(p.tables.dmg), aur,
            buffs: aur ? canonBuffs(aur.buffs, role) : [], bloodlust: buffUptime(p.tables.buffs, 'Bloodlust'),
            stats: playerStats(ci, row, dbIndex, classToken),
        };
    });
    const n = per.length, majority = Math.floor(n / 2) + 1;
    const medOf = arr => round1(median(arr));
    const castNames = countNames(per.map(p => Object.keys(p.casts)));
    const casts = {};
    Object.keys(castNames).filter(nm => castNames[nm] >= majority).forEach(nm => { casts[nm] = medOf(per.map(p => p.casts[nm] || 0)); });
    const abilityNames = countNames(per.map(p => p.abilities.map(a => a.name)));
    const abilities = Object.keys(abilityNames).filter(nm => abilityNames[nm] >= majority).map(nm => {
        const rows = per.map(p => p.abilities.find(a => a.name === nm)).filter(Boolean);
        return { name: nm, share: medOf(rows.map(r => r.share)), avgHit: medOf(rows.map(r => r.avgHit)), avgCrit: medOf(rows.map(r => r.avgCrit)),
                 critPercent: medOf(rows.map(r => r.critPercent)), resistPercent: medOf(rows.map(r => r.resistPercent)) };
    }).sort((a, b) => (b.share || 0) - (a.share || 0));
    const buffCounts = countNames(per.map(p => p.buffs));
    const withCi = per.filter(p => p.aur).length;
    const flasks = per.filter(p => p.aur && p.aur.flask).map(p => p.aur.flask);
    const stats = {};
    STAT_KEYS.forEach(k => { stats[k] = medOf(per.map(p => p.stats && p.stats[k])); });
    const amounts = ranks.map(r => r.amount);
    return {
        itemLevelBand: band, sampleSize: ranks.length, playersCompared: n,
        dps: Math.round(median(amounts)), topDps: amounts.length ? Math.round(Math.max.apply(null, amounts)) : null,
        durationSec: round1(median(ranks.map(r => r.duration / 1000))), castsDurationSec: medOf(per.map(p => p.dur)),
        activePercent: medOf(per.map(p => p.activePercent)), castsPerMinute: medOf(per.map(p => p.castsPerMinute)),
        casts, abilities, buffsAtPull: Object.keys(buffCounts).filter(b => buffCounts[b] >= majority),
        flaskShare: withCi ? round1(flasks.length / withCi) : 0, flask: mostCommon(flasks),
        bloodlustPercent: medOf(per.map(p => p.bloodlust)), stats,
    };
}

function finding(key, severity, scope, text, extra) { return Object.assign({ key, severity, scope, text }, extra || {}); }

// Raid-provided debuffs on the boss that move the metric, with the schools they help. Missing
// ones are a raid-composition finding, never the player's failing, unless their own class
// provides it (OWN_DEBUFF) and it was up too little.
const RAID_DEBUFFS = [
    { name: 'Curse of the Elements', schools: ['arcane', 'fire', 'frost', 'shadow'], value: '10% more arcane, fire, frost and shadow damage', source: 'a warlock' },
    { name: 'Misery', schools: ['arcane', 'fire', 'frost', 'shadow', 'nature', 'holy'], value: '5% spell hit', source: 'a shadow priest' },
    { name: 'Shadow Weaving', schools: ['shadow'], value: '10% more shadow damage', source: 'a shadow priest' },
    { name: 'Fire Vulnerability', schools: ['fire'], value: '15% more fire damage', source: 'a fire mage with Improved Scorch' },
    { name: "Winter's Chill", schools: ['frost'], value: '10% frost crit', source: 'a frost mage' },
    { name: 'Sunder Armor', alt: ['Expose Armor'], schools: ['physical'], value: '2600 armor off the boss', source: 'a warrior or rogue' },
    { name: 'Faerie Fire', alt: ['Faerie Fire (Feral)'], schools: ['physical'], value: '610 armor off the boss', source: 'a druid' },
    { name: 'Blood Frenzy', alt: ['Expose Weakness'], schools: ['physical'], value: '4% more physical damage, or attack power from Expose Weakness', source: 'an arms warrior or a survival hunter' },
    { name: 'Curse of Recklessness', schools: ['physical'], value: '800 armor off the boss', source: 'a warlock' },
    { name: 'Judgement of the Crusader', schools: ['holy'], value: '219 more holy damage per hit', source: 'a paladin' },
];
const OWN_DEBUFF = {
    WARLOCK: ['Curse of the Elements', 'Curse of Recklessness'], PRIEST: ['Misery', 'Shadow Weaving'], MAGE: ['Fire Vulnerability', "Winter's Chill"],
    WARRIOR: ['Sunder Armor', 'Blood Frenzy'], ROGUE: ['Sunder Armor'], DRUID: ['Faerie Fire'], HUNTER: ['Blood Frenzy'], PALADIN: ['Judgement of the Crusader'],
};
function debuffFacts(debuffTable, schools) {
    const d = debuffTable && debuffTable.data;
    const auras = d && Array.isArray(d.auras) ? d.auras : [];
    const total = d ? d.totalTime : 0;
    const present = [], missing = [];
    RAID_DEBUFFS.filter(x => x.schools.some(s => (schools || []).includes(s))).forEach(x => {
        const names = [x.name].concat(x.alt || []);
        const rows = auras.filter(a => names.includes(a.name));
        if (!rows.length) missing.push({ name: x.name, value: x.value, source: x.source });
        else present.push({ name: x.name, uptimePercent: total ? Math.round(100 * Math.max.apply(null, rows.map(r => r.totalUptime)) / total) : null, value: x.value, source: x.source });
    });
    return { known: !!d, present, missing };
}

// Casts that are upkeep rather than rotation: never "unused" or "extra".
const UTILITY_CAST = /life tap|healthstone|bandage|first aid|cannibalize|soulstone|rune$|potion|drain soul|^create |^summon |armor$|resurrection|^restore mana$/i;

function uptimeFindings(kill) {
    const f = [], me = kill.me, fight = kill.fight, ref = kill.reference;
    if (typeof me.activePercent === 'number') {
        const raidTail = typeof fight.raidActivePercent === 'number' ? ' (raid median ' + fight.raidActivePercent + '%)' : '';
        if (me.activePercent < T.activeMajor) f.push(finding('active_low', 'major', 'player', 'Active ' + me.activePercent + '% of the ' + kill.name + ' fight' + raidTail));
        else if (typeof fight.raidActivePercent === 'number' && me.activePercent < 92 && fight.raidActivePercent - me.activePercent >= T.activeGap)
            f.push(finding('active_low', 'minor', 'player', 'Active ' + me.activePercent + '% of the ' + kill.name + ' fight' + raidTail));
    }
    if (me.died && fight.durationSec && me.died.atSec < T.diedBefore * fight.durationSec)
        f.push(finding('died', 'major', 'player', 'Died at ' + me.died.atSec + 's of ' + Math.round(fight.durationSec) + 's on ' + kill.name + (me.died.by ? ' to ' + me.died.by : '')));
    if (!f.some(x => x.key === 'active_low') && ref && ref.castsPerMinute && typeof me.castsPerMinute === 'number' && me.castsPerMinute < T.castsLowRatio * ref.castsPerMinute)
        f.push(finding('casts_low', 'minor', 'player', me.castsPerMinute + ' casts per minute on ' + kill.name + '; comparable players manage ' + ref.castsPerMinute));
    return f;
}

function rotationFindings(kill) {
    const f = [], ref = kill.reference;
    if (!ref || !kill.fight.durationSec || !ref.castsDurationSec) return f;
    const min = kill.fight.durationSec / 60, refMin = ref.castsDurationSec / 60;
    const top3 = ref.abilities.slice(0, 3).map(a => a.name);
    const fmt = x => Math.round(x * 10) / 10;
    Object.keys(ref.casts).forEach(name => {
        if (UTILITY_CAST.test(name)) return;
        const r = ref.casts[name] / refMin, p = (kill.me.casts[name] || 0) / min;
        if (!kill.me.casts[name]) {
            if (r >= T.unusedPerMin || top3.includes(name))
                f.push(finding('ability_unused', top3.includes(name) ? 'major' : 'minor', 'player', 'Never cast ' + name + ' on ' + kill.name + '; comparable players cast it ' + fmt(r) + ' times a minute', { ability: name }));
        } else if (top3.includes(name) && p < T.ratioLow * r) {
            f.push(finding('ability_ratio', 'minor', 'player', name + ' ' + fmt(p) + ' times a minute on ' + kill.name + ' against ' + fmt(r) + ' for comparable players', { ability: name }));
        }
    });
    Object.keys(kill.me.casts).forEach(name => {
        if (UTILITY_CAST.test(name) || ref.casts[name]) return;
        if (kill.me.casts[name] / min >= T.extraPerMin)
            f.push(finding('ability_extra', 'minor', 'player', 'Cast ' + name + ' ' + kill.me.casts[name] + ' times on ' + kill.name + '; comparable players do not use it', { ability: name }));
    });
    return f;
}

function damageFindings(kill) {
    const f = [], ref = kill.reference;
    if (!ref) return f;
    ref.abilities.slice(0, 3).forEach(ra => {
        const pa = kill.me.abilities.find(a => a.name === ra.name);
        if (!pa) return;
        const x = { ability: ra.name, share: pa.share };
        if (typeof pa.critPercent === 'number' && typeof ra.critPercent === 'number' && ra.critPercent - pa.critPercent >= T.critGap)
            f.push(finding('crit_low', 'major', 'player', ra.name + ' crit ' + pa.critPercent + '% of the time on ' + kill.name + '; comparable players crit ' + ra.critPercent + '%', x));
        if (typeof pa.avgHit === 'number' && typeof ra.avgHit === 'number' && pa.avgHit < T.hitRatio * ra.avgHit)
            f.push(finding('hit_low', 'major', 'player', ra.name + ' hit for ' + pa.avgHit + ' on ' + kill.name + ' against ' + ra.avgHit + ' for comparable players', x));
        if (typeof pa.resistPercent === 'number' && typeof ra.resistPercent === 'number' && pa.resistPercent - ra.resistPercent >= T.resistGap)
            f.push(finding('resist_high', 'minor', 'player', pa.resistPercent + '% of ' + ra.name + ' casts were resisted or partially resisted on ' + kill.name + ' against ' + ra.resistPercent + '% for comparable players; check spell hit and Curse of the Elements', x));
    });
    return f;
}

const ROLE_STATS = {
    caster: { primary: 'spellDamage', secondary: ['spellCrit', 'spellHaste'] },
    healer: { primary: 'healing', secondary: ['spellCrit', 'mp5'] },
    melee: { primary: 'attackPower', secondary: ['meleeCrit', 'meleeHaste'] },
    ranged: { primary: 'rangedAttackPower', secondary: ['rangedCrit', 'meleeHaste'] },
    tank: { primary: 'attackPower', secondary: ['meleeCrit'] },
};
const STAT_LABEL = {
    spellDamage: 'spell power', healing: 'healing power', attackPower: 'attack power', rangedAttackPower: 'ranged attack power',
    spellCrit: 'spell crit rating', meleeCrit: 'melee crit rating', rangedCrit: 'ranged crit rating', spellHaste: 'spell haste rating',
    meleeHaste: 'haste rating', spellHit: 'spell hit rating', meleeHit: 'hit rating', mp5: 'mana per five',
};
function statFindings(kill, role) {
    const f = [], ref = kill.reference, me = kill.me.stats;
    const spec = ROLE_STATS[role];
    if (!ref || !ref.stats || !me || !spec) return f;
    const cmp = (key, ratio, sev) => {
        const p = me[key], r = ref.stats[key];
        if (typeof p !== 'number' || typeof r !== 'number' || !r) return;
        const label = STAT_LABEL[key];
        if (p < ratio * r) f.push(finding('stat_low', sev, 'player', label.charAt(0).toUpperCase() + label.slice(1) + ' ' + p + ' against ' + r + ' for comparable players', { stat: key, value: p, reference: r }));
    };
    cmp(spec.primary, T.statPrimaryRatio, 'major');
    spec.secondary.forEach(k => cmp(k, T.statSecondaryRatio, 'minor'));
    return f;
}

function consumableFindings(kill) {
    const f = [], me = kill.me, ref = kill.reference;
    if (me.consumablesKnown) {
        if (!me.flask && !(me.battleElixir && me.guardianElixir))
            f.push(finding('no_flask_or_elixirs', 'major', 'player', 'No flask and no battle plus guardian elixir at the ' + kill.name + ' pull' + (me.consumablesAtPull.length ? ' (had ' + me.consumablesAtPull.join(', ') + ')' : '')));
        else if (!me.flask && me.guardianElixir && isUtilityGuardian(me.guardianElixir) && ref && ref.flaskShare >= 0.5 && ref.flask)
            f.push(finding('wrong_elixir', 'minor', 'player', me.guardianElixir + ' at the ' + kill.name + ' pull, while comparable players ran ' + ref.flask + '; a flask does more for your damage'));
        if (!me.food) f.push(finding('no_food', 'minor', 'player', 'No food buff at the ' + kill.name + ' pull'));
        if (ref && ref.buffsAtPull.length) {
            const missing = ref.buffsAtPull.filter(b => !me.partyBuffs.includes(b));
            if (missing.length) f.push(finding('buffs_missing', 'minor', 'group', 'Group buffs comparable players had at the pull that you did not on ' + kill.name + ': ' + missing.join(', ') + '. Worth asking to be grouped with them', { buffs: missing }));
        }
    }
    if (me.potionUse === 0 && kill.fight.durationSec > T.potionMinSec)
        f.push(finding('no_potion', 'minor', 'player', 'No potion used on ' + kill.name + ' (' + Math.round(kill.fight.durationSec) + 's)'));
    if (ref && ref.bloodlustPercent > 0 && me.bloodlustPercent === 0)
        f.push(finding('bloodlust_uptime', 'minor', 'group', 'No Bloodlust on ' + kill.name + ' while comparable players had it'));
    return f;
}

function debuffFindings(kill, player) {
    const f = [], d = kill.debuffs;
    if (!d || !d.known) return f;
    if (d.missing.length)
        f.push(finding('debuff_missing', 'minor', 'group', 'Raid debuffs missing on ' + kill.name + ': ' + d.missing.map(m => m.name + ' (' + m.value + ', needs ' + m.source + ')').join('; ') + '. Raid composition, not your doing', { debuffs: d.missing.map(m => m.name) }));
    const own = OWN_DEBUFF[String(player.classToken || '').toUpperCase()] || [];
    d.present.filter(p => typeof p.uptimePercent === 'number' && p.uptimePercent < T.debuffUptime).forEach(p => {
        const mine = own.includes(p.name);
        f.push(finding('debuff_uptime_low', 'minor', mine ? 'player' : 'group', p.name + ' was up ' + p.uptimePercent + '% of ' + kill.name + (mine ? '; keep it up' : ''), { debuff: p.name }));
    });
    return f;
}

const GEAR_LABEL = { gs: 'GearScore', ilvl: 'Average item level', hit: 'Hit rating', expertise: 'Expertise', defense: 'Defense', enchants: 'Missing enchants', sockets: 'Empty sockets' };
function gearFindings(profile, thresholds, now) {
    const ev = V.evaluate(profile, V.parseThresholds(thresholds || {}), now);
    const f = [];
    (ev.rules || []).forEach(r => {
        if (!r.applies || !GEAR_LABEL[r.key]) return;
        const sev = r.status === 'fail' ? 'major' : r.status === 'warn' ? 'minor' : null;
        if (!sev) return;
        let text;
        if (r.key === 'enchants') {
            const slots = Array.isArray(profile.gear) ? profile.gear.filter(s => s.enchantable && !s.enchant && !s.empty).map(s => s.label) : [];
            text = GEAR_LABEL[r.key] + ': ' + r.value + (slots.length ? ' (' + slots.join(', ') + ')' : '');
        } else if (r.key === 'sockets') {
            text = GEAR_LABEL[r.key] + ': ' + r.value;
        } else {
            text = GEAR_LABEL[r.key] + ' ' + r.value + ' against the ' + (r.key === 'hit' ? r.effective : r.threshold) + ' the raid asks for';
        }
        f.push(finding('gear_' + r.key, sev, 'player', text));
    });
    return f;
}

// One list for the whole report: bad pulls contribute nothing, the same finding on several
// bosses is one line, stat shortfalls attach to the weak-hit line they explain, majors first.
const SEVERITY_ORDER = { major: 0, minor: 1, info: 2 };
function mergeFindings(kills, gear) {
    const live = kills.filter(k => !k.fight.badPull);
    const byId = new Map();
    live.forEach(k => k.findings.forEach(fd => {
        const id = fd.key + '|' + (fd.ability || fd.stat || fd.debuff || '');
        const cur = byId.get(id);
        if (cur) { cur.count++; cur.bosses.push(k.name); }
        else byId.set(id, Object.assign({}, fd, { count: 1, bosses: [k.name] }));
    }));
    let merged = Array.from(byId.values());
    const hitLow = merged.find(f => f.key === 'hit_low');
    const statLow = merged.filter(f => f.key === 'stat_low');
    if (hitLow && statLow.length) {
        hitLow.text += '. ' + statLow.map(s => s.text).join('; ');
        hitLow.stats = statLow.map(s => ({ stat: s.stat, value: s.value, reference: s.reference }));
        merged = merged.filter(f => f.key !== 'stat_low');
    }
    merged.forEach(f => { if (f.count > 1) f.text += ' (on ' + f.count + ' of ' + live.length + ' bosses)'; });
    merged = merged.concat((gear || []).map(g => Object.assign({ count: live.length || 1, bosses: [] }, g)));
    merged.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (b.count - a.count) || ((b.share || 0) - (a.share || 0)));
    return merged.slice(0, 6);
}

function positives(kills) {
    const out = [];
    kills.filter(k => !k.fight.badPull).forEach(k => {
        if (typeof k.me.activePercent === 'number' && k.me.activePercent >= 90) out.push('Active ' + k.me.activePercent + '% on ' + k.name);
        if (!k.me.died) out.push('No death on ' + k.name);
        if (k.me.consumablesKnown && (k.me.flask || (k.me.battleElixir && k.me.guardianElixir)) && k.me.food) out.push('Flask or elixirs and food at the ' + k.name + ' pull');
        if (k.reference && k.me.stats && typeof k.me.stats.gearScore === 'number' && typeof k.reference.stats.spellDamage === 'number' && k.me.stats.spellDamage >= k.reference.stats.spellDamage) out.push('Spell power ' + k.me.stats.spellDamage + ' matches comparable players on ' + k.name);
    });
    return out.slice(0, 6);
}

function buildFacts(o) {
    const { profile, player, kills, thresholds, now, limited } = o;
    const th = V.parseThresholds(thresholds || {});
    const gear = gearFindings(profile, th, now);
    const gs = profile.gearSummary || {};
    const slim = kills.map(k => Object.assign({}, k, { me: Object.assign({}, k.me) }));
    slim.forEach(k => { delete k.meRow; delete k.me.meRow; });
    return {
        player: { name: profile.name, class: player.classToken, spec: player.spec, role: player.role, metric: profile.parses.metric,
                  itemLevel: typeof gs.avgItemLevel === 'number' ? gs.avgItemLevel : null, gearScore: typeof gs.gearScore === 'number' ? gs.gearScore : null,
                  talentSplit: profile.identity ? profile.identity.talentSplit : null },
        tier: { zone: profile.parses.zone, zoneName: profile.parses.zoneName, medianPercent: round1(profile.parses.medianPercent), threshold: th.parse },
        gear: { gearScore: typeof gs.gearScore === 'number' ? gs.gearScore : null, avgItemLevel: typeof gs.avgItemLevel === 'number' ? gs.avgItemLevel : null,
                missingEnchants: Array.isArray(profile.gear) ? profile.gear.filter(s => s.enchantable && !s.enchant && !s.empty).map(s => s.label) : [],
                emptySockets: typeof gs.emptySockets === 'number' ? gs.emptySockets : null, findings: gear },
        kills: slim,
        overall: {
            badPulls: slim.filter(k => k.fight.badPull).map(k => ({ name: k.name, rankPercent: k.rankPercent, reason: k.fight.badPullReason })),
            findings: mergeFindings(slim, gear), positives: positives(slim),
        },
        limited: !!limited,
    };
}

function killFindings(kill, player) {
    let f = uptimeFindings(kill).concat(rotationFindings(kill), damageFindings(kill), statFindings(kill, player.role), consumableFindings(kill), debuffFindings(kill, player));
    if (!kill.reference && kill.referenceNote) f.push(finding('no_reference', 'info', 'player', kill.referenceNote + ' on ' + kill.name));
    return f;
}

function killFacts(input) {
    const { encounterId, name, rank, context, tables, sourceId, player, reference, referenceNote, dbIndex } = input;
    const fc = fightContext(context, player.name, player.role, reference ? reference.durationSec : null);
    const casts = castCounts(tables.casts);
    const ci = tables.ci && tables.ci.data && tables.ci.data[0];
    const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
    const me = Object.assign(fc.me, {
        consumablesKnown: !!ci, consumablesAtPull: aur ? aur.consumables : [], buffsAtPull: aur ? aur.buffs : [],
        partyBuffs: aur ? canonBuffs(aur.buffs, player.role) : [],
        flask: aur ? aur.flask : null, battleElixir: aur ? aur.battleElixir : null, guardianElixir: aur ? aur.guardianElixir : null, food: aur ? aur.food : null,
        castsPerMinute: castsPerMinute(casts, fc.fight.durationSec), casts, abilities: abilityStats(tables.dmg),
        bloodlustPercent: buffUptime(tables.buffs, 'Bloodlust'), stats: playerStats(ci, fc.meRow, dbIndex, player.classToken),
    });
    const kill = {
        encounterId, name, rankPercent: round1(rank.rankPercent),
        date: rank.startTime ? new Date(rank.startTime).toISOString().slice(0, 10) : null,
        reportCode: rank.report.code, fightId: rank.report.fightID,
        wclUrl: 'https://classic.warcraftlogs.com/reports/' + rank.report.code + '#fight=' + rank.report.fightID + '&source=' + sourceId,
        fight: fc.fight, debuffs: debuffFacts(context.debuffs, player.schools), me,
        reference: reference || null, referenceNote: referenceNote || null, findings: [],
    };
    kill.findings = killFindings(kill, player);
    return kill;
}

// The model writes, the sheet decides. Every claim it may make is in `facts`; the system prompt
// forbids anything else, and checkNumbers() enforces the part that matters most.
function buildPrompt(facts, rulesLines) {
    const system = [
        'You are writing a short note to a World of Warcraft TBC Anniversary raider on behalf of their raid leader, about why their parses are low and what to do about it.',
        'Second person, friendly, direct, no fluff. Plain text: no markdown, no # headings, no ** bold.',
        'Use ONLY the facts in the JSON sheet. Never invent a number, an ability, a buff, an item or a percentage. If the sheet does not support a claim, leave it out.',
        'Findings with scope "group" are about raid composition (party buffs, raid debuffs, Bloodlust): phrase them as things to ask the raid leader for, never as the player\'s failing.',
        '"Comparable players" means players of the same spec on the same boss within the item-level band in each kill\'s reference.itemLevelBand.',
        'Anniversary rules that differ from original TBC:',
    ].concat(rulesLines || [], [
        'Structure, in this order:',
        '1. One header line: name, spec, tier, median parse percentile.',
        '2. A line "What\'s holding your damage back", then overall.findings biggest first, at most 5, each as one short paragraph: what it is, your measured number next to the comparable-player number, one concrete fix.',
        '3. A line "What\'s fine", then one or two sentences built from overall.positives.',
        '4. If overall.badPulls is not empty, a line "Not on you", then one line per bad pull with its reason.',
        'Under 350 words.',
        facts && facts.limited ? 'This player is a healer: the sheet has no per-cast comparison, so write only about uptime, deaths, consumables, buffs and gear.' : '',
    ]).filter(Boolean).join('\n');
    return { system, user: 'Facts sheet:\n' + JSON.stringify(facts) };
}

function numbersIn(s) {
    return (String(s).replace(/(\d),(\d{3})\b/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}
// Every figure over 10 in the reply must appear in the sheet, give or take one for rounding.
// Small numbers are list numerals and counts like "3 of 4 bosses", which the sheet also holds
// in one form or another, so they are not worth a false alarm.
function checkNumbers(text, facts) {
    const allowed = new Set();
    numbersIn(JSON.stringify(facts)).forEach(n => { allowed.add(Math.round(n)); allowed.add(Math.floor(n)); allowed.add(Math.ceil(n)); });
    const foreign = numbersIn(text).filter(n => {
        if (n <= 10) return false;
        const r = Math.round(n);
        return ![r - 1, r, r + 1].some(x => allowed.has(x));
    });
    return { ok: foreign.length === 0, foreign: Array.from(new Set(foreign)) };
}

module.exports = { KILL_LIMIT, REF, T, WCL_CLASS_NAME, SPEC_SCHOOLS, wclSpecName, schoolsOf, pickKills, median, round1, lower, fightContext, abilityStats, castCounts, castsPerMinute, buffUptime, CONSUMABLE, isUtilityGuardian, classifyAuras, BUFF_ALIAS, PARTY_BUFFS, canonBuffs, STAT_KEYS, playerStats, bandRanks, countNames, mostCommon, referenceSummary, finding, RAID_DEBUFFS, OWN_DEBUFF, debuffFacts, UTILITY_CAST, uptimeFindings, rotationFindings, damageFindings, ROLE_STATS, STAT_LABEL, statFindings, killFindings, killFacts, consumableFindings, debuffFindings, gearFindings, mergeFindings, positives, buildFacts, buildPrompt, checkNumbers };
