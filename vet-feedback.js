'use strict';
// Node-only. Turns Warcraft Logs fight data into a parse feedback facts sheet for one player, and
// builds the prompt that turns that sheet into a player-facing report. The GraphQL `query`
// function is injected, as in vet-profile.js: the server passes wclQuery, the tests pass a stub.
const V = require('./vet-engine.js');
const GAP = require('./vet-gap.js');

const KILL_LIMIT = 8;
// Reference selection (spec v2 §3): same spec, same boss, same region, item level within `band`
// of the player (widened once to `wideBand` when fewer than `min` ranks are found), taken from
// the MIDDLE of the leaderboard, whose length is found by a binary search over at most
// `maxSearchPages` pages and cached for `lengthCacheMs`. `topPages` bounds the ceiling read.
// Minor 5 (whole-branch review): findLastPage's binary search needs ceil(log2(n+1)) probes for a
// range of n pages — 7 for 64, 6 for 63 — but spec §3 and §9 both promise "6 queries". 63 is the
// largest bound that actually holds that promise.
const REF = { band: 2, wideBand: 4, target: 8, min: 3, players: 3, maxPages: 5, cacheMs: 24 * 60 * 60 * 1000,
              topPages: 3, maxSearchPages: 63, lengthCacheMs: 7 * 24 * 60 * 60 * 1000 };
// Finding thresholds (spec §4). Not user-editable in v1. The outcome-based thresholds (active %,
// crit/hit/resist gaps, primary/secondary stat ratios) were retired in v3 along with the findings
// they gated (Task 4): the gap accounting (vet-gap.js) and its `minShare` now decide what is worth
// reporting instead.
const T = {
    diedBefore: 0.9,
    unusedPerMin: 1.5, unusedPerFightCooldown: 1, extraPerMin: 1, ratioLow: 0.7,
    debuffUptime: 70, potionMinSec: 60, minShare: 3,
    longFightRatio: 2, raidUnderPercent: 5, raidUnderShare: 0.8, raidSpeedLow: 5,
    // Minor 10 (whole-branch review): spec 4.1 has no deaths-based bad-pull rule. Rule 2 (80% of
    // the raid's DPS parsed under 5) needs enough DPS to have actually parsed, and rule 1 needs a
    // reference duration healers never have, so a raid-wide near-wipe with few surviving DPS could
    // slip past both. This fills that gap: a large share of the whole raid dying is bad-pull
    // evidence on its own, independent of role or duration.
    raidDeathsShare: 0.3,
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

// task-rep-kill: the boss was selected by its median percentile across every kill of that boss;
// the report should analyse the kill that explains that number, not whichever happened last (the
// two diverge once a player has more than one kill on a boss). `ranks` are already filtered to
// those with a report.code by the caller. Rules, in order:
//  1. Demote likely raid-wide bad pulls: a rank whose duration is more than T.longFightRatio times
//     the shortest duration among this boss's ranks is a probable bad pull and is only chosen if
//     nothing else is available (the shortest rank itself can never be demoted by this rule, so a
//     single rank is always "taken" regardless of its own duration).
//  2. Among the surviving candidates, pick the rankPercent closest to medianPercent — the number
//     that caused the boss to be selected in the first place. Falls back to the most recent when
//     medianPercent is null or no candidate has a rankPercent.
//  3. Ties on distance-to-median break toward the more recent kill (larger startTime).
function pickRank(ranks, medianPercent) {
    if (!ranks || !ranks.length) return null;
    if (ranks.length === 1) return ranks[0];

    const durations = ranks.map(r => r.duration).filter(d => typeof d === 'number');
    const shortest = durations.length ? Math.min(...durations) : null;
    const isLikelyBadPull = r => shortest != null && typeof r.duration === 'number' && r.duration > shortest * T.longFightRatio;
    let candidates = ranks.filter(r => !isLikelyBadPull(r));
    // Defensive, not reachable today: the rank with the shortest duration is compared to itself
    // (ratio 1, never > T.longFightRatio), so it can never be filtered out and `candidates` can
    // never be empty under this proxy. Kept because the rule is described as a fallback ("only
    // chosen if nothing else is available... degrade to take it") that a future, less trivially
    // self-safe proxy could actually reach; not exercised by a test for that reason.
    if (!candidates.length) candidates = ranks;

    const byRecency = (a, b) => (b.startTime || 0) - (a.startTime || 0);
    if (typeof medianPercent !== 'number' || !candidates.some(r => typeof r.rankPercent === 'number')) {
        return candidates.slice().sort(byRecency)[0];
    }
    let best = null, bestDist = Infinity;
    for (const r of candidates) {
        if (typeof r.rankPercent !== 'number') continue;
        const dist = Math.abs(r.rankPercent - medianPercent);
        if (!best || dist < bestDist || (dist === bestDist && (r.startTime || 0) > (best.startTime || 0))) { best = r; bestDist = dist; }
    }
    return best;
}

// v2 §4: analyse up to KILLS_PER_BOSS pulls per boss — the representative rank (pickRank) and
// the most recent one, deduplicated — so a habit can be told from a one-off.
const KILLS_PER_BOSS = 2;
function pickRanks(ranks, medianPercent) {
    const rep = pickRank(ranks, medianPercent);
    if (!rep) return [];
    const recent = ranks.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
    return (recent && recent !== rep ? [rep, recent] : [rep]).slice(0, KILLS_PER_BOSS);
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
function fightContext(ctx, playerName, role, refDurationSec, metric, name) {
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
    // Minor 10: rule 2 (spec 4.1, "80% of the group parsed under 5") is always evaluated over the
    // raid's DPS, never the player's own role group — for a healer, "the group" the spec means is
    // the raid's damage dealers, not other healers' HPS ranks.
    const dpsGroup = groupOf('dps');
    const dpsUnder = dpsGroup.filter(c => c.rankPercent < T.raidUnderPercent).length;

    const dmg = ctx.dmgAll && ctx.dmgAll.data;
    const totalTime = dmg ? dmg.totalTime : null;
    const rows = dmg && Array.isArray(dmg.entries) ? dmg.entries : [];
    const activeOf = row => (totalTime && row && typeof row.activeTime === 'number') ? round1(100 * row.activeTime / totalTime) : null;
    const meRow = rows.find(r => lower(r.name) === me) || null;
    const groupNames = new Set(group.map(c => lower(c.name)));
    const groupRows = rows.filter(r => r.type !== 'Pet' && groupNames.has(lower(r.name)));
    // v3: a fight whose rankings carry no role groups (reference players' contexts in the
    // captured fixture; any report WCL has not ranked) still has a raid: use every player row.
    const activeRows = groupRows.length ? groupRows : rows.filter(r => r.type !== 'Pet');
    const raidActivePercent = round1(median(activeRows.map(activeOf)));

    const deaths = (ctx.deaths && ctx.deaths.data && Array.isArray(ctx.deaths.data.entries)) ? ctx.deaths.data.entries : [];
    const myDeath = deaths.find(d => lower(d.name) === me);
    const pd = (ctx.summary && ctx.summary.data && ctx.summary.data.playerDetails) || {};
    const detail = ['dps', 'healers', 'tanks'].flatMap(k => Array.isArray(pd[k]) ? pd[k] : []).find(p => lower(p.name) === me) || null;
    const speed = rank && rank.speed && typeof rank.speed.rankPercent === 'number' ? rank.speed.rankPercent : null;
    // Minor 10 gap-fill: raid roster size across every role, used only for the deaths rule below.
    const raidSize = dpsGroup.length + groupOf('healers').length + groupOf('tanks').length;

    const reasons = [];
    if (refDurationSec && durationSec > T.longFightRatio * refDurationSec)
        reasons.push('the pull took ' + Math.round(durationSec) + 's against the fastest reference kills at ' + Math.round(refDurationSec) + 's' + (GAP.PHASE_BOSSES[name] ? ' (' + GAP.PHASE_BOSSES[name] + ')' : ''));
    if (dpsGroup.length && dpsUnder >= T.raidUnderShare * dpsGroup.length) reasons.push(dpsUnder + ' of ' + dpsGroup.length + ' dps in the raid parsed under ' + T.raidUnderPercent);
    if (speed != null && speed < T.raidSpeedLow && idx >= 0 && idx < group.length / 2) reasons.push('the raid\'s kill speed ranked ' + speed + ' while you were ' + ordinal(idx + 1) + ' of ' + group.length + ' ' + groupKey);
    if (raidSize && deaths.length >= T.raidDeathsShare * raidSize) reasons.push(deaths.length + ' of ' + raidSize + ' in the raid died');

    return {
        fight: {
            durationSec, referenceDurationSec: typeof refDurationSec === 'number' ? refDurationSec : null, raidDeaths: deaths.length,
            raidSpeedPercent: speed, raidExecutionPercent: rank && rank.execution && typeof rank.execution.rankPercent === 'number' ? rank.execution.rankPercent : null,
            raidGroup: groupKey, raidGroupCount: group.length, raidGroupRank: idx >= 0 ? idx + 1 : null,
            raidGroupMedianPercent: round1(median(group.map(c => c.rankPercent))), raidActivePercent,
            badPull: reasons.length > 0, badPullReason: reasons.length ? reasons.join('; ') : null,
        },
        me: {
            // Minor 11: named `amount` with a sibling `metric` rather than `dps`, so the number is
            // not mislabelled "DPS" for a healer whose kill facts carry HPS.
            amount: idx >= 0 ? round1(sorted[idx].amount) : null, metric: metric || 'dps', activePercent: activeOf(meRow),
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
function lustPercent(buffsTable) { const a = buffUptime(buffsTable, 'Bloodlust'), b = buffUptime(buffsTable, 'Heroism'); if (a === null && b === null) return null; return Math.max(a || 0, b || 0); }

// --- Burst timing (spec v2 §6). A burst is a short self-buff the player triggers — an on-use
// item or a potion. Both show as a cast of the same name (WCL names a potion cast after its
// effect: the fixture's Casts table has "Destruction: 1" for a Destruction Potion) and as an aura
// with one band per use. Procs have no cast; long buffs (armors) fail the length cap.
const BURST_MAX_SEC = 30;
// Important 1 (whole-branch review): a short self-buff with a same-named cast is not automatically
// a burst. Any class self-buff at or under BURST_MAX_SEC also qualifies by the (a)/(b) rule above —
// Drain Soul (a DoT that also shows as a short "buff" band per tick), Cannibalize, First Aid, Fel
// Domination, Bloodrage, Power Word: Shield, Fade, Barkskin, Sprint, Shield Wall, Ice Block and the
// rest below all cleared it live and produced nonsense findings ("Never used Death Wish (on-use
// item)" for a class spell; burst_outside_bloodlust firing on a warrior's Bloodrage). Named by
// aura, case-insensitive.
const BURST_EXCLUDE = /bloodrage|power word: shield|fade|barkskin|sprint|shield wall|ice block|fel domination|shadowmeld|stealth|vanish|evasion|feign death|deterrence|last stand|frenzied regeneration|nature's grasp|inner focus|spirit tap|berserker rage|bladestorm|cloak of shadows|dispersion/i;
const LUST = ['Bloodlust', 'Heroism'];
const POTION_LABEL = { Destruction: 'Destruction Potion', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' };
function auraBands(buffsTable, names) {
    const d = buffsTable && buffsTable.data;
    return (d && Array.isArray(d.auras) ? d.auras : []).filter(a => a && names.includes(a.name)).flatMap(a => Array.isArray(a.bands) ? a.bands : []);
}
function burstStats(buffsTable, castsTable) {
    const d = buffsTable && buffsTable.data;
    if (!d || !Array.isArray(d.auras)) return [];
    const casts = castCounts(castsTable);
    const lust = auraBands(buffsTable, LUST);
    const inside = b => lust.some(l => b.startTime < l.endTime && b.endTime > l.startTime);
    return d.auras
        .filter(a => a && Array.isArray(a.bands) && a.bands.length && casts[a.name] && !LUST.includes(a.name) && a.bands.every(b => (b.endTime - b.startTime) / 1000 <= BURST_MAX_SEC)
            && !UTILITY_CAST.test(a.name) && !BURST_EXCLUDE.test(a.name))
        .map(a => ({ name: a.name, uses: a.bands.length, insideBloodlust: a.bands.filter(inside).length }));
}
function burstLabel(name) { return POTION_LABEL[name] || name; }

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
const STAT_KEYS = ['spellDamage', 'healing', 'attackPower', 'rangedAttackPower', 'spellCrit', 'meleeCrit', 'rangedCrit', 'spellHit', 'meleeHit', 'spellHaste', 'meleeHaste', 'mp5', 'intellect', 'strength', 'agility'];
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
function referenceSummary(ranks, players, dbIndex, classToken, role, band, topDps, o) {
    o = o || {};
    const per = (players || []).map(p => {
        const fight = Array.isArray(p.context.fights) ? p.context.fights[0] : null;
        const dur = fight ? (fight.endTime - fight.startTime) / 1000 : null;
        const dmg = p.context.dmgAll && p.context.dmgAll.data;
        const row = dmg && Array.isArray(dmg.entries) ? dmg.entries.find(e => lower(e.name) === lower(p.rank.name)) : null;
        const casts = castCounts(p.tables.casts);
        const ci = p.tables.ci && p.tables.ci.data && p.tables.ci.data[0];
        const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
        const df = debuffFacts(p.context.debuffs, schoolsOf(classToken, p.rank.spec, role));
        // Controller ruling (cross-task): the accounting's ratio must be measured against the same
        // players the other factors (casts, damage per cast, crit) are measured on, not the wider
        // rank list's median DPS — reuse this player's own fightContext call for both raidActive
        // and their own amount, rather than computing it twice. fightContext's `me.amount` needs
        // the fight's own rankings to carry role groups the player's name resolves in; a reference
        // player's captured fight context does not always have that (verified on this fixture: all
        // three Anetheron reference players come back with `raidGroupCount: 0`, no role groups at
        // all), so `me.amount` is null there — fall back to the leaderboard rank's own `amount`,
        // the same field the wider `dps` median already reads off `ranks`.
        const fc = fightContext(p.context, p.rank.name, role, null, 'dps');
        return {
            dur, activePercent: row && dmg.totalTime && typeof row.activeTime === 'number' ? round1(100 * row.activeTime / dmg.totalTime) : null,
            casts, castsPerMinute: castsPerMinute(casts, dur), abilities: abilityStats(p.tables.dmg), aur,
            buffs: aur ? canonBuffs(aur.buffs, role) : [], bloodlust: lustPercent(p.tables.buffs),
            burst: burstStats(p.tables.buffs, p.tables.casts),
            stats: playerStats(ci, row, dbIndex, classToken),
            dcs: GAP.damagingCastStats(casts, abilityStats(p.tables.dmg)),
            channelSec: GAP.channelSeconds(p.tables.buffs),
            consumables: aur ? aur.consumables : [],
            raidActive: fc.fight.raidActivePercent, amount: typeof fc.me.amount === 'number' ? fc.me.amount : p.rank.amount,
            debuffs: df.present, debuffsKnown: df.known,
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
        // Important 3: carry the reference's sample size (median hits across the reference players)
        // through as a per-ability fact, even though no finding function compares crit/hit/resist
        // on it any more (v3 Task 4 retired damageFindings in favour of the gap accounting).
        return { name: nm, share: medOf(rows.map(r => r.share)), avgHit: medOf(rows.map(r => r.avgHit)), avgCrit: medOf(rows.map(r => r.avgCrit)),
                 critPercent: medOf(rows.map(r => r.critPercent)), resistPercent: medOf(rows.map(r => r.resistPercent)), hits: medOf(rows.map(r => r.hits)) };
    }).sort((a, b) => (b.share || 0) - (a.share || 0));
    const buffCounts = countNames(per.map(p => p.buffs));
    const withCi = per.filter(p => p.aur).length;
    const flasks = per.filter(p => p.aur && p.aur.flask).map(p => p.aur.flask);
    const stats = {};
    STAT_KEYS.forEach(k => { stats[k] = medOf(per.map(p => p.stats && p.stats[k])); });
    const burstNames = countNames(per.map(p => p.burst.map(b => b.name)));
    const burst = Object.keys(burstNames).filter(nm => burstNames[nm] >= majority).map(nm => {
        const rows = per.map(p => p.burst.find(b => b.name === nm)).filter(Boolean);
        return { name: nm, uses: medOf(rows.map(r => r.uses)), insideBloodlust: medOf(rows.map(r => r.insideBloodlust)) };
    });
    const amounts = ranks.map(r => r.amount);
    // v3 fix: median([]) / median([null,...]) is null, and Math.round(null) === 0 — without this
    // guard a reference with no damaging casts on any player would silently report 0 rather than
    // null for damagePerDamagingCast.
    const dpc = median(per.map(p => p.dcs.casts ? p.dcs.damage / p.dcs.casts : null));
    // Controller ruling (cross-task): median amount over the same fetched players the casts/damage
    // per cast/crit factors are measured on, not the wider `ranks` list's own dps (which explainGap
    // uses only as the displayed "typical" number) — same null-guard pattern as damagePerDamagingCast.
    const playersDpsMed = median(per.map(p => p.amount));
    return {
        itemLevelBand: band, sampleSize: ranks.length, playersCompared: n,
        dps: Math.round(median(amounts)),
        // v2 §3: the ceiling comes from the top pages (getReference) when given; the median over
        // the benchmark ranks is what "comparable players" do. Important 2 (whole-branch review):
        // `getReference` passes an explicit `null` when the band never appeared on the top pages
        // (spec §3 step 4) — that must stay null, not fall back to the benchmark's own max, which
        // is exactly the middle-of-the-leaderboard number the ceiling line exists to NOT show.
        // `undefined` (no 7th argument at all — the legacy shape every test that isn't exercising
        // the ceiling still calls with) is the only case that keeps the old fallback.
        topDps: topDps === undefined ? (amounts.length ? Math.round(Math.max.apply(null, amounts)) : null) : topDps,
        benchmark: 'median',
        durationSec: round1(median(ranks.map(r => r.duration / 1000))), castsDurationSec: medOf(per.map(p => p.dur)),
        activePercent: medOf(per.map(p => p.activePercent)), castsPerMinute: medOf(per.map(p => p.castsPerMinute)),
        casts, abilities, buffsAtPull: Object.keys(buffCounts).filter(b => buffCounts[b] >= majority),
        flaskShare: withCi ? round1(flasks.length / withCi) : 0, flask: mostCommon(flasks),
        bloodlustPercent: medOf(per.map(p => p.bloodlust)), burst,
        damagingCastsPerMinute: medOf(per.map(p => p.dur ? round1(60 * p.dcs.casts / p.dur) : null)),
        damagePerDamagingCast: typeof dpc === 'number' ? Math.round(dpc) : null,
        critRate: medOf(per.map(p => p.dcs.hits ? 100 * p.dcs.crits / p.dcs.hits : null)),
        channelSecPerMin: medOf(per.map(p => p.dur ? 60 * p.channelSec / p.dur : null)),
        raidActivePercent: medOf(per.map(p => p.raidActive)),
        consumablesAtPull: Object.keys(countNames(per.map(p => p.consumables))).filter(n => countNames(per.map(p => p.consumables))[n] >= majority),
        // Important 1: a reference where no player's debuff table came back known must report
        // `debuffs: null`, not an empty array — an empty array reads as "known and there are none",
        // which would tell explainGap's debuffs input the reference genuinely lacks the raid
        // debuff, fabricating a group-owned share against the player's own (also unknown) table.
        debuffs: per.some(p => p.debuffsKnown)
            ? Object.keys(countNames(per.map(p => p.debuffs.map(d => d.name)))).filter(n => countNames(per.map(p => p.debuffs.map(d => d.name)))[n] >= majority)
                .map(n => ({ name: n, uptimePercent: medOf(per.map(p => { const d = p.debuffs.find(x => x.name === n); return d ? d.uptimePercent : null; })) }))
            : null,
        fastestDurationSec: typeof o.fastestDurationSec === 'number' ? o.fastestDurationSec : null,
        playersDps: typeof playersDpsMed === 'number' ? Math.round(playersDpsMed) : null,
        stats,
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
        // Minor 13: `hostilityType:Enemies` sums totalUptime across every enemy, so a debuff kept
        // up on several adds (Hyjal wave pulls) can report over 100%. Clamp for display; the
        // underlying number is still a real WCL figure, just not a percentage of one target.
        else present.push({ name: x.name, uptimePercent: total ? Math.min(100, Math.round(100 * Math.max.apply(null, rows.map(r => r.totalUptime)) / total)) : null, value: x.value, source: x.source });
    });
    return { known: !!d, present, missing };
}

// Casts that are upkeep rather than rotation: never "unused" or "extra".
const UTILITY_CAST = /life tap|healthstone|bandage|first aid|cannibalize|soulstone|rune$|potion|drain soul|^create |^summon |armor$|resurrection|^restore mana$/i;

// Minor 7 (whole-branch review): "at the " + name + " pull" reads as "at the The Lurker Below
// pull" for a boss whose own name already starts with "The". Only prefix the article when the
// name does not already carry one.
function theName(name) { return /^the /i.test(String(name || '')) ? name : 'the ' + name; }

function uptimeFindings(kill) {
    const f = [], me = kill.me, fight = kill.fight;
    if (me.died && fight.durationSec && me.died.atSec < T.diedBefore * fight.durationSec)
        f.push(finding('died', 'major', 'player', 'Died at ' + me.died.atSec + 's of ' + Math.round(fight.durationSec) + 's on ' + kill.name + (me.died.by ? ' to ' + me.died.by : '')));
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
            // Minor 20 (spec 4.3): unused when the reference casts it >= 1.5/min OR at least once
            // per fight — the second clause is what catches a once-per-fight cooldown like Curse of
            // Doom even when it is not one of the reference's top-3 abilities by damage share.
            if (r >= T.unusedPerMin || ref.casts[name] >= T.unusedPerFightCooldown) {
                // v2 §6, revised by Important 1 (whole-branch review): on-use items and potions stay
                // in the comparison (they are a large, cheap DPS gain) but are named for what they
                // are via burstLabel — no "(on-use item)" suffix, since with BURST_EXCLUDE removing
                // the class self-buffs that used to slip into `ref.burst`, everything left in it is
                // already an on-use item or a potion and the label alone (a potion's already says
                // "Potion") is enough not to call it a spell.
                const isBurst = Array.isArray(ref.burst) && ref.burst.some(b => b.name === name);
                const text = isBurst
                    ? 'Never used ' + burstLabel(name) + ' on ' + kill.name + '; comparable players use it ' + fmt(r) + ' times a minute'
                    : 'Never cast ' + name + ' on ' + kill.name + '; comparable players cast it ' + fmt(r) + ' times a minute';
                f.push(finding('ability_unused', top3.includes(name) ? 'major' : 'minor', 'player', text, { ability: name }));
            }
        } else if (top3.includes(name) && p < T.ratioLow * r) {
            f.push(finding('ability_ratio', 'minor', 'player', name + ' ' + fmt(p) + ' times a minute on ' + kill.name + ' against ' + fmt(r) + ' for comparable players', { ability: name }));
        }
    });
    Object.keys(kill.me.casts).forEach(name => {
        if (ref.casts[name]) return;
        if (kill.me.casts[name] / min >= T.extraPerMin)
            f.push(finding('ability_extra', 'minor', 'player', 'Cast ' + name + ' ' + kill.me.casts[name] + ' times on ' + kill.name + '; comparable players do not use it', { ability: name }));
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
function consumableFindings(kill) {
    const f = [], me = kill.me, ref = kill.reference;
    if (me.consumablesKnown) {
        if (!me.flask && !(me.battleElixir && me.guardianElixir))
            f.push(finding('no_flask_or_elixirs', 'major', 'player', 'No flask and no battle plus guardian elixir at ' + theName(kill.name) + ' pull' + (me.consumablesAtPull.length ? ' (had ' + me.consumablesAtPull.join(', ') + ')' : '')));
        else if (!me.flask && me.guardianElixir && isUtilityGuardian(me.guardianElixir) && ref && ref.flaskShare >= 0.5 && ref.flask)
            f.push(finding('wrong_elixir', 'minor', 'player', me.guardianElixir + ' at ' + theName(kill.name) + ' pull, while comparable players ran ' + ref.flask + '; a flask does more for your damage'));
        if (!me.food) f.push(finding('no_food', 'minor', 'player', 'No food buff at ' + theName(kill.name) + ' pull'));
        if (ref && ref.buffsAtPull.length) {
            const missing = ref.buffsAtPull.filter(b => !me.partyBuffs.includes(b));
            if (missing.length) f.push(finding('buffs_missing', 'minor', 'group', 'Group buffs comparable players had at the pull that you did not on ' + kill.name + ': ' + missing.join(', ') + '. Worth asking to be grouped with them', { buffs: missing }));
        }
    }
    if (me.potionUse === 0 && kill.fight.durationSec > T.potionMinSec)
        f.push(finding('no_potion', 'minor', 'player', 'No potion used on ' + kill.name + ' (' + Math.round(kill.fight.durationSec) + 's)'));
    if (ref && ref.bloodlustPercent > 0 && me.bloodlustPercent === 0)
        f.push(finding('bloodlust_uptime', 'minor', 'group', 'No Bloodlust on ' + kill.name + ' while comparable players had it'));
    // v2 §6: a burst the player fires only outside Bloodlust, on a fight that had it, where
    // comparable players fire it inside.
    if (ref && Array.isArray(ref.burst) && me.bloodlustPercent > 0) {
        (me.burst || []).forEach(b => {
            const r = ref.burst.find(x => x.name === b.name);
            if (r && r.insideBloodlust >= 1 && b.uses >= 1 && b.insideBloodlust === 0)
                f.push(finding('burst_outside_bloodlust', 'minor', 'player', 'Used ' + burstLabel(b.name) + ' ' + (b.uses === 1 ? 'once' : b.uses + ' times') + ' on ' + kill.name + ', never inside Bloodlust; comparable players line it up with Bloodlust', { ability: b.name }));
        });
    }
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
    // v2 §4: with more than one pull of a boss in the sheet, counts are over pulls and the
    // measured-on label carries the pull's date; with one pull per boss the v1 wording stands.
    const multi = new Set(live.map(k => k.name)).size < live.length;
    const unit = multi ? 'pulls' : 'bosses';
    // Minor 6 (whole-branch review): a rank with no startTime has k.date === null; without the
    // guard this printed the literal string "Boss (null)".
    const label = k => (multi && live.filter(x => x.name === k.name).length > 1) ? (k.date ? k.name + ' (' + k.date + ')' : k.name) : k.name;
    const byId = new Map();
    live.forEach(k => k.findings.forEach(fd => {
        const id = fd.key + '|' + (fd.ability || fd.stat || fd.debuff || '');
        const cur = byId.get(id);
        if (cur) {
            cur.count++; cur.bosses.push(k.name);
            // v3: several pulls can carry the same finding with different shares (the accounting
            // is per-pull); the pull whose share is largest is the one worth reporting the numbers
            // from, so its text/numbers/measuredOn replace whatever was kept before, and the larger
            // share itself is what survives the merge.
            if ((fd.share || 0) > (cur.share || 0)) { Object.assign(cur, fd); cur.measuredOn = label(k); }
        }
        // Important 2: the merged record keeps the first-seen finding's text and numbers verbatim
        // (they are one boss's real measurement), while `bosses` can list several. `measuredOn`
        // records which boss the kept numbers actually came from — a live report once attributed
        // one boss's crit numbers to another because the merged record named several bosses with
        // only one boss's figures attached, and the number guard cannot catch that (both figures
        // are genuine facts, just misattributed).
        else byId.set(id, Object.assign({}, fd, { count: 1, bosses: [k.name], measuredOn: label(k) }));
    }));
    let merged = Array.from(byId.values());
    // Minor 12: append the "seen on N of M bosses" count — naming the boss the numbers were
    // measured on, per Important 2 — as its own clause.
    merged.forEach(f => { if (f.count > 1) f.text += ' (numbers measured on ' + f.measuredOn + '; seen on ' + f.count + ' of ' + live.length + ' ' + unit + ')'; });
    merged = merged.concat((gear || []).map(g => Object.assign({ count: live.length || 1, bosses: [], measuredOn: null }, g)));
    // v3: every finding is kept (no cap), ordered by the accounting's own share first — the
    // number that says how much of the gap it actually explains — then severity, then count.
    merged.sort((a, b) => ((b.share || 0) - (a.share || 0)) || (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (b.count - a.count));
    return merged;
}

// Minor 8: with a full roster of kills, listing the same three lines per kill in order and
// slicing at 6 only ever surfaced the two worst bosses (the earliest in kill order) and repeated
// itself. Spec 5.1 wants one or two lines for "What's fine", so this dedupes by kind and
// aggregates a count across the live (non-bad-pull) kills; a single-kill sheet keeps the old
// per-boss phrasing since there is nothing to aggregate. Also reads ROLE_STATS[role].primary
// instead of hardcoding spellDamage, so melee and hunters can earn the primary-stat line too.
function positives(kills, role) {
    const live = kills.filter(k => !k.fight.badPull);
    if (!live.length) return [];
    const n = live.length;
    // v2 §4: with more than one pull of a boss in the sheet, the wording counts pulls, not bosses.
    const multi = new Set(live.map(k => k.name)).size < n;
    const unit = multi ? 'pulls' : 'bosses', one = multi ? 'pull' : 'boss';
    const out = [];

    const activeKills = live.filter(k => typeof k.me.activePercent === 'number' && k.me.activePercent >= 90);
    if (activeKills.length === n) out.push(n === 1 ? 'Active ' + activeKills[0].me.activePercent + '% on ' + activeKills[0].name : 'Active 90%+ on every ' + one);
    else if (activeKills.length) out.push('Active 90%+ on ' + activeKills.length + ' of ' + n + ' ' + unit);

    const noDeathKills = live.filter(k => !k.me.died);
    if (noDeathKills.length === n) out.push(n === 1 ? 'No death on ' + noDeathKills[0].name : 'No deaths on any of the ' + n + ' ' + unit);
    else if (noDeathKills.length) out.push('No deaths on ' + noDeathKills.length + ' of ' + n + ' ' + unit);

    const consumableKills = live.filter(k => k.me.consumablesKnown && (k.me.flask || (k.me.battleElixir && k.me.guardianElixir)) && k.me.food);
    if (consumableKills.length === n) out.push(n === 1 ? 'Flask or elixirs and food at the ' + consumableKills[0].name + ' pull' : 'Flask and food at every pull');
    else if (consumableKills.length) out.push('Flask and food at ' + consumableKills.length + ' of ' + n + ' pulls');

    const spec = ROLE_STATS[role];
    if (spec) {
        const label = STAT_LABEL[spec.primary];
        const statKills = live.filter(k => k.reference && k.reference.stats && k.me.stats &&
            typeof k.me.stats[spec.primary] === 'number' && typeof k.reference.stats[spec.primary] === 'number' &&
            k.me.stats[spec.primary] >= k.reference.stats[spec.primary]);
        if (statKills.length === n) out.push(n === 1
            ? label.charAt(0).toUpperCase() + label.slice(1) + ' ' + statKills[0].me.stats[spec.primary] + ' matches comparable players on ' + statKills[0].name
            : (label.charAt(0).toUpperCase() + label.slice(1)) + ' matches or beats comparable players on every ' + one);
        else if (statKills.length) out.push((label.charAt(0).toUpperCase() + label.slice(1)) + ' matches or beats comparable players on ' + statKills.length + ' of ' + n + ' ' + unit);
    }

    // v3: a gap input where the player is consistently ahead of the reference (a negative share:
    // the accounting is signed so the player's side of a comparison can come out on top too) is a
    // positive worth calling out, not just silence where a finding would otherwise be.
    const AHEAD_LABEL = { own_activity: 'activity', cast_pacing: 'cast pacing', power_gear: 'spell power from gear', crit_gear: 'crit from gear', power_consumables: 'consumables' };
    // A physical role's "power" is attack power, not spell power: the same substitution
    // gapFindings applies to its own text (vet-gap.js), built here at use time instead of a
    // second hardcoded table.
    const physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const aheadLabel = key => (physical ? AHEAD_LABEL[key].replace(/spell power/, 'attack power') : AHEAD_LABEL[key]);
    const gapKills = live.filter(k => k.gap);
    if (gapKills.length) {
        Object.keys(AHEAD_LABEL).forEach(key => {
            const shares = gapKills.map(k => {
                const inp = ['casts', 'dmg', 'crit'].reduce((found, fk) => found || (k.gap.factors[fk] && k.gap.factors[fk].inputs.find(i => i.key === key)), null);
                return inp ? inp.share : null;
            });
            if (shares.every(s => typeof s === 'number' && s <= -3)) out.push('You are ahead of comparable players on ' + aheadLabel(key));
        });
    }

    return out.slice(0, 4);
}

function buildFacts(o) {
    const { profile, player, kills, thresholds, now, limited, droppedKills, nights, night } = o;
    const th = V.parseThresholds(thresholds || {});
    const gear = gearFindings(profile, th, now);
    const gs = profile.gearSummary || {};
    // Minor 19: `meRow` was never on `kill` or `kill.me` in the first place — killFacts only ever
    // copies `fc.fight` and `fc.me` onto the kill, and `fc.meRow` is a sibling of `fc.me`, not
    // nested inside it — so the deletes here were no-ops and the paired test assertion passed
    // vacuously. Removed both; `slim` is still a shallow copy so callers cannot mutate `kills`.
    const slim = kills.map(k => Object.assign({}, k, { me: Object.assign({}, k.me) }));

    // v2 §7: where the player stands on their two worst live pulls — their number, the
    // benchmark, and the band's best — so the ceiling is a fact, not the model's discretion.
    const pct = k => (k.rankPercent == null ? 101 : k.rankPercent);
    const ceiling = slim.filter(k => !k.fight.badPull && k.reference && typeof k.reference.topDps === 'number')
        .sort((a, b) => pct(a) - pct(b)).slice(0, 2)
        .map(k => ({ name: k.name, date: k.date, me: k.me.amount, dps: k.reference.dps, topDps: k.reference.topDps }));

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
            badPulls: slim.filter(k => k.fight.badPull).map(k => ({ name: k.name, date: k.date, rankPercent: k.rankPercent, reason: k.fight.badPullReason })),
            // Important 5: kills dropped by a caught per-kill WCL error (a report that comes back
            // as a GraphQL error rather than `report: null`), so the page can say why a boss the
            // player killed is missing from the sheet rather than silently having fewer kills.
            droppedKills: droppedKills || [],
            findings: mergeFindings(slim, gear), positives: positives(slim, player.role), ceiling,
            gap: GAP.averageGap(slim.filter(k => !k.fight.badPull)),
        },
        limited: !!limited,
        nights: Array.isArray(o.nights) ? o.nights : [],
        night: o.night || null,
    };
}

function killFindings(kill, player) {
    const hitCap = kill.hitCap;
    let f = uptimeFindings(kill).concat(
        GAP.gapFindings(kill, player, T),
        GAP.statPriorityFindings({ me: kill.me.stats, reference: kill.reference && kill.reference.stats, spec: player.spec, role: player.role, hitCap, boss: kill.name }),
        rotationFindings(kill), consumableFindings(kill), debuffFindings(kill, player));
    if (!kill.reference && kill.referenceNote) f.push(finding('no_reference', 'info', 'player', kill.referenceNote + ' on ' + kill.name));
    return f.map(x => Object.assign({ owner: x.owner || (x.scope === 'group' ? 'group' : 'player'), share: typeof x.share === 'number' ? x.share : 0 }, x));
}

function killFacts(input) {
    const { encounterId, name, rank, context, tables, sourceId, player, reference, referenceNote, dbIndex } = input;
    // task-rep-kill: how many ranks this boss had, and which one (oldest-first) is being shown, so
    // the facts sheet (and the page) can say which pull is being analysed. Both default to 1 for
    // the pre-existing single-rank call shape.
    const killsOnBoss = typeof input.killsOnBoss === 'number' ? input.killsOnBoss : 1;
    const killIndex = typeof input.killIndex === 'number' ? input.killIndex : 1;
    const fc = fightContext(context, player.name, player.role, reference ? (reference.fastestDurationSec || reference.durationSec) : null, player.metric, name);
    const casts = castCounts(tables.casts);
    const ci = tables.ci && tables.ci.data && tables.ci.data[0];
    const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
    const dcs = GAP.damagingCastStats(casts, abilityStats(tables.dmg));
    const me = Object.assign(fc.me, {
        consumablesKnown: !!ci, consumablesAtPull: aur ? aur.consumables : [], buffsAtPull: aur ? aur.buffs : [],
        partyBuffs: aur ? canonBuffs(aur.buffs, player.role) : [],
        flask: aur ? aur.flask : null, battleElixir: aur ? aur.battleElixir : null, guardianElixir: aur ? aur.guardianElixir : null, food: aur ? aur.food : null,
        castsPerMinute: castsPerMinute(casts, fc.fight.durationSec), casts, abilities: abilityStats(tables.dmg),
        bloodlustPercent: lustPercent(tables.buffs), burst: burstStats(tables.buffs, tables.casts),
        stats: playerStats(ci, fc.meRow, dbIndex, player.classToken),
        damagingCastsPerMinute: fc.fight.durationSec ? round1(60 * dcs.casts / fc.fight.durationSec) : null,
        damagePerDamagingCast: dcs.casts ? Math.round(dcs.damage / dcs.casts) : null,
        critRate: dcs.hits ? round1(100 * dcs.crits / dcs.hits) : null,
        channelSecPerMin: fc.fight.durationSec ? round1(60 * GAP.channelSeconds(tables.buffs) / fc.fight.durationSec) : null,
    });
    const kill = {
        encounterId, name, killsOnBoss, killIndex, rankPercent: round1(rank.rankPercent),
        date: rank.startTime ? new Date(rank.startTime).toISOString().slice(0, 10) : null,
        reportCode: rank.report.code, fightId: rank.report.fightID,
        wclUrl: 'https://classic.warcraftlogs.com/reports/' + rank.report.code + '#fight=' + rank.report.fightID + '&source=' + sourceId,
        fight: fc.fight, debuffs: debuffFacts(context.debuffs, player.schools), me,
        reference: reference || null, referenceNote: referenceNote || null, findings: [], gap: null,
        hitCap: typeof input.hitCap === 'number' ? input.hitCap : null,
    };
    kill.gap = kill.fight.badPull ? null : GAP.explainGap(kill, player);
    kill.findings = killFindings(kill, player);
    return kill;
}

// The model writes, the sheet decides. Every claim it may make is in `facts`; the system prompt
// forbids anything else, and checkNumbers() enforces the part that matters most.
function buildPrompt(facts, rulesLines) {
    // Minor 9: healers get told what is holding their HEALING back, not their damage — the
    // `limited` note two lines below already tells the model this is a healer, so the plumbing to
    // branch on the metric was already there.
    const holdingBack = facts && facts.player && facts.player.metric === 'hps' ? "What's holding your healing back" : "What's holding your damage back";
    const system = [
        'You are writing a short note to a World of Warcraft TBC Anniversary raider on behalf of their raid leader, about why their parses are low and what to do about it.',
        'Second person, friendly, direct, no fluff. Plain text: no markdown, no # headings, no ** bold.',
        'Use ONLY the facts in the JSON sheet. Never invent a number, an ability, a buff, an item or a percentage. If the sheet does not support a claim, leave it out.',
        'Findings with scope "group" are about raid composition (party buffs, raid debuffs, Bloodlust): phrase them as things to ask the raid leader for, never as the player\'s failing.',
        '"Comparable players" means players of the same spec on the same boss, at the player\'s item level (each kill\'s reference.itemLevelBand), who parse around the middle of the leaderboard (reference.benchmark is "median"). reference.topDps is what the best players at that item level reach on that boss.',
        // Important 2: a merged finding can name several bosses in `bosses` while its text and
        // numbers belong to only one of them (kept verbatim from where they were first measured).
        // A live report once attributed one boss's crit numbers to another for exactly this reason.
        'A finding\'s numbers were measured on the boss named in its measuredOn field. Never attach them to another boss, even one also listed in that finding\'s bosses array.',
        'Anniversary rules that differ from original TBC:',
    ].concat(rulesLines || [], [
        'Structure, in this order:',
        '1. One header line: name, spec, tier, then "median parse P" using tier.medianPercent — or, when night is not null, "raid night of <night.date>, median parse that night P" using night.medianPercent.',
        // Minor 14: a bad-pull-only player has empty overall.findings and overall.positives, yet
        // the old wording ordered these sections unconditionally, producing a heading with nothing
        // under it. Each section now says explicitly to skip itself when its source array is empty.
        '2. If overall.findings is not empty, a line "' + holdingBack + '", then every entry of overall.findings, in that order (it holds at most 6; do not drop any), each as one short paragraph: what it is, your measured number next to the comparable-player number, one concrete fix. If overall.findings is empty, skip this section entirely.',
        '3. If overall.positives is not empty, a line "What\'s fine", then one or two sentences built from overall.positives. If overall.positives is empty, skip this section entirely.',
        '3b. If overall.ceiling is not empty, a line "Where you stand", then one line per entry: your number (me), what players at your item level around the middle do (dps), and what the best at your item level reach (topDps) on that boss. If overall.ceiling is empty, skip this section entirely.',
        '4. If overall.badPulls is not empty, a line "Not on you", then one line per bad pull with its reason.',
        'Under 350 words.',
        facts && facts.limited ? 'This player is a healer: the sheet has no per-cast comparison, so write only about uptime, deaths, consumables, buffs and gear.' : '',
    ]).filter(Boolean).join('\n');
    return { system, user: 'Facts sheet:\n' + JSON.stringify(facts) };
}

function numbersIn(s) {
    return (String(s).replace(/(\d),(\d{3})\b/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}
// Important 7 (widening 2): walk the facts sheet's actual VALUES rather than its serialised JSON
// text. `JSON.stringify(facts)` mixes numeric facts with digits that live inside strings — report
// codes ("BcZWRDk2..." -> 2), `wclUrl` ("#fight=57&source=12" -> 57, 12), dates ("2026-08-30" ->
// 2026, 8, 30) — and all of those entered the allowed set. Only real numbers count as facts.
// Important 7: facts are read from real numbers, never harvested out of arbitrary JSON strings
// (a wclUrl's fight/source ids must not become numbers the model may quote). Two string shapes
// are facts nonetheless (v2 Task 9): the numbers inside a finding's own `text` (a threshold such
// as "the 202 the raid asks for" lives only there), and the year/month/day of an ISO date — but
// only at the five places the v2 sheet actually carries a date (night.date, kills[].date,
// overall.ceiling[].date, overall.badPulls[].date, nights[].date), tracked here by key-path with
// array indices collapsed. A bare `date` field anywhere else (or in a hand-built object a caller
// assembles for its own purposes) stays a plain string: matching by value shape alone (any string
// that merely looks like YYYY-MM-DD) would also swallow a bare top-level `date` nobody meant as
// one of the sheet's five fact-bearing dates, silently widening what a reply may invent.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PATHS = new Set(['night.date', 'kills.date', 'overall.ceiling.date', 'overall.badPulls.date', 'nights.date']);
function collectFactNumbers(value, out, path) {
    if (typeof value === 'number') { if (isFinite(value)) out.push(value); return; }
    if (typeof value === 'string') {
        const lastKey = path ? path.split('.').pop() : '';
        if (lastKey === 'text') numbersIn(value).forEach(n => out.push(n));
        else if (DATE_PATHS.has(path) && ISO_DATE.test(value)) value.split('-').forEach(p => out.push(Number(p)));
        return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(v => collectFactNumbers(v, out, path)); return; }
    Object.keys(value).forEach(k => collectFactNumbers(value[k], out, path ? path + '.' + k : k));
}
// Every figure over 10 in the reply must appear in the sheet, give or take 1 for rounding (spec
// 5.2). Small numbers are list numerals and counts like "3 of 4 bosses", which the sheet also
// holds in one form or another, so they are not worth a false alarm.
function checkNumbers(text, facts) {
    const facNums = [];
    collectFactNumbers(facts, facNums);
    // Important 7 (widening 1): comparing rounded forms of both sides ({round,floor,ceil} of each
    // fact against {r-1,r,r+1} of the reply number) composes to roughly +/-2. Compare the reply
    // number directly against each raw fact instead, so only a true +/-1 passes (round1(91.6) vs
    // a reply of 93 is a 1.4 gap and must fail, where the old composed tolerance let it through).
    const foreign = numbersIn(text).filter(n => {
        if (n <= 10) return false;
        return !facNums.some(f => Math.abs(n - f) <= 1);
    });
    return { ok: foreign.length === 0, foreign: Array.from(new Set(foreign)) };
}

// --- WCL queries (verified live 2026-09-04, spec §9). The metric, class, spec, region and
// encounter id are inlined after validation, matching the probe text exactly: WCL's classic
// schema types some of these arguments in ways that reject plain String variables.
function encounterRankQuery(encounterIds, metric) {
    const m = metric === 'hps' ? 'hps' : 'dps';
    return 'query($name:String!,$server:String!,$region:String!){characterData{character(name:$name,serverSlug:$server,serverRegion:$region){id classID ' +
        encounterIds.map(id => 'e' + id + ':encounterRankings(encounterID:' + id + ',metric:' + m + ')').join(' ') + '}}}';
}
const FIGHT_QUERY = 'query($c:String!,$f:[Int]!){reportData{report(code:$c){' +
    'masterData{actors(type:"Player"){id name subType}} fights(fightIDs:$f){id name startTime endTime kill} rankings(fightIDs:$f) ' +
    'dmgAll:table(dataType:DamageDone,fightIDs:$f) deaths:table(dataType:Deaths,fightIDs:$f) summary:table(dataType:Summary,fightIDs:$f) ' +
    'debuffs:table(dataType:Debuffs,fightIDs:$f,hostilityType:Enemies)}}}';
const PLAYER_QUERY = 'query($c:String!,$f:[Int]!,$s:Int!){reportData{report(code:$c){' +
    'dmg:table(dataType:DamageDone,fightIDs:$f,sourceID:$s) casts:table(dataType:Casts,fightIDs:$f,sourceID:$s) ' +
    'buffs:table(dataType:Buffs,fightIDs:$f,sourceID:$s) ci:events(dataType:CombatantInfo,fightIDs:$f,sourceID:$s,limit:5){data}}}}';
function refPageQuery(encounterId, className, specName, region, page) {
    const safe = s => String(s).replace(/[^A-Za-z]/g, '');
    return '{worldData{encounter(id:' + (parseInt(encounterId, 10) || 0) + '){characterRankings(metric:dps,className:"' + safe(className) +
        '",specName:"' + safe(specName) + '",serverRegion:"' + safe(region).toLowerCase() + '",page:' + (parseInt(page, 10) || 1) + ')}}}';
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

async function fightAndTables(query, code, fightID, playerName) {
    const ctxD = await query(FIGHT_QUERY, { c: code, f: [fightID] });
    const ctx = ctxD && ctxD.reportData && ctxD.reportData.report;
    if (!ctx || !ctx.masterData) return null;
    const actor = (ctx.masterData.actors || []).find(a => a.name && lower(a.name) === lower(playerName));
    if (!actor) return null;
    const tD = await query(PLAYER_QUERY, { c: code, f: [fightID], s: actor.id });
    const tables = tD && tD.reportData && tD.reportData.report;
    if (!tables) return null;
    return { ctx, tables, sourceId: actor.id };
}

// --- Leaderboard geometry (spec v2 §3). characterRankings pages hold 100 ranks and carry no
// total, so the leaderboard's length L (its last non-empty page) is found by a binary search over
// hasMorePages; the middle rank is then 50·L.
function globalRank(page, index) { return (page - 1) * 100 + index + 1; }
// Pages to read for the benchmark, nearest the middle first: mid, mid+1, mid-1, mid+2, mid-2, …
function middlePageOrder(L, maxPages) {
    const mid = Math.max(1, Math.round(L / 2));
    const out = [];
    for (let d = 0; d <= L && out.length < maxPages; d++) {
        (d === 0 ? [mid] : [mid + d, mid - d]).forEach(p => { if (p >= 1 && p <= L && !out.includes(p) && out.length < maxPages) out.push(p); });
    }
    return out;
}
// One WCL fetch per page per reference build: the length walk, the benchmark pages and the
// ceiling pages overlap on short leaderboards, and every page costs 2 points. A page past the
// end (WCL answers with no `rankings` key) reads as empty and last.
function pageFetcher(query, encounterId, wclClass, specName, region) {
    const memo = new Map();
    return page => {
        if (!memo.has(page)) {
            memo.set(page, query(refPageQuery(encounterId, wclClass, specName, region, page), {}).then(d => {
                const cr = d && d.worldData && d.worldData.encounter && d.worldData.encounter.characterRankings;
                return cr && Array.isArray(cr.rankings) ? { page, hasMorePages: !!cr.hasMorePages, rankings: cr.rankings } : { page, hasMorePages: false, rankings: [] };
            }));
        }
        return memo.get(page);
    };
}
async function findLastPage(fetchPage, maxPages) {
    let lo = 1, hi = maxPages, last = 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cr = await fetchPage(mid);
        if (cr.rankings.length) { last = mid; if (!cr.hasMorePages) return mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return last;
}

// Important 4: scan for an existing cache entry belonging to this (encounterId, class, spec,
// region) group whose stored item-level band already covers `itemLevel`, so two players a level
// apart (124 and 125, both within REF.band of each other) share one fetch instead of two.
function findRefEntry(refCache, prefix, itemLevel) {
    for (const [k, v] of refCache) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length).split('/');
        const lo = Number(rest[0]), hi = Number(rest[1]);
        if (itemLevel >= lo && itemLevel <= hi) return v;
    }
    return null;
}

// v2 §3: the leaderboard length is independent of item level, so it is cached per (boss, class,
// spec, region) for a week under a key shape ('len:' + prefix) that findRefEntry's band scan
// never matches. A pending walk is stored as-is so concurrent bands share it.
async function leaderboardLength(fetchPage, o, lenKey) {
    const hit = o.refCache.get(lenKey);
    if (hit && o.now - hit.at < REF.lengthCacheMs) return hit.value;
    const pending = findLastPage(fetchPage, REF.maxSearchPages);
    o.refCache.set(lenKey, { at: o.now, value: pending });
    try { const L = await pending; o.refCache.set(lenKey, { at: o.now, value: L }); return L; }
    catch (e) { o.refCache.delete(lenKey); throw e; }
}

// Reference per (boss, class, spec, region, band), built around the MIDDLE of the leaderboard
// (spec v2 §3). Shared across every player of that spec, so it is cached for a day and an
// in-flight fetch is handed to concurrent callers.
async function getReference(query, o) {
    // Important 4: keying strictly on `itemLevel ± REF.band` defeated the cost model spec §3.4
    // budgets on ("every player of a spec shares the same reference per boss") — two Destruction
    // warlocks at 124 and 125 missed each other and each paid the full ~35-point fetch. Scanning
    // for a covering entry first fixes that without touching the in-flight sharing or expiry below.
    const prefix = [o.encounterId, o.classToken, o.spec, o.region].join('/') + '/';
    const cached = findRefEntry(o.refCache, prefix, o.itemLevel);
    if (cached && cached.value && o.now - cached.at < REF.cacheMs) return cached.value;
    if (cached && cached.pending) return cached.pending;

    // Minor 16: an unrecognised class token would otherwise be sent to WCL as `className:"undefined"`,
    // which comes back as a GraphQL error. Refuse before spending the query.
    const wclClass = WCL_CLASS_NAME[String(o.classToken).toUpperCase()];
    if (!wclClass) return { summary: null, note: 'unrecognised class for a WCL reference lookup: ' + o.classToken };

    const key = prefix + (o.itemLevel - REF.band) + '/' + (o.itemLevel + REF.band);
    const pending = (async () => {
        const fetchPage = pageFetcher(query, o.encounterId, wclClass, wclSpecName(o.spec), o.region);
        const L = await leaderboardLength(fetchPage, o, 'len:' + prefix);
        const middle = 50 * L;
        // Benchmark: in-band ranks read outward from the middle page, ordered by distance from
        // the middle rank (ties toward the higher-ranked, i.e. lower globalRank).
        const collect = async band => {
            let found = [];
            for (const p of middlePageOrder(L, REF.maxPages)) {
                const cr = await fetchPage(p);
                found = found.concat(bandRanks(cr.rankings, o.itemLevel, band).map(r => Object.assign({ globalRank: globalRank(p, cr.rankings.indexOf(r)) }, r)));
                if (found.length >= REF.target) break;
            }
            return found.sort((a, b) => (Math.abs(a.globalRank - middle) - Math.abs(b.globalRank - middle)) || (a.globalRank - b.globalRank));
        };
        let band = REF.band;
        let ranks = await collect(band);
        if (ranks.length < REF.min) { band = REF.wideBand; ranks = await collect(band); }
        if (ranks.length < REF.min) return { summary: null, note: 'too few same-item-level parses to compare against', band };
        ranks = ranks.slice(0, REF.target);
        // Ceiling: the band's best DPS from the top pages, at most REF.topPages of them.
        let topDps = null;
        let fastest = null;
        for (let p = 1; p <= Math.min(REF.topPages, L) && topDps === null; p++) {
            const ib = bandRanks((await fetchPage(p)).rankings, o.itemLevel, band);
            if (ib.length) {
                topDps = Math.round(Math.max.apply(null, ib.map(r => r.amount)));
                // v3 fix: a rank missing `duration` would otherwise poison Math.min into NaN,
                // and `typeof NaN === 'number'` slips past the null guard below.
                const durs = ib.map(r => r.duration).filter(d => typeof d === 'number' && isFinite(d));
                fastest = durs.length ? Math.round(Math.min.apply(null, durs) / 1000) : null;
            }
        }
        const players = [];
        for (const r of ranks.slice(0, REF.players)) {
            // Important 5: a reference player's report can come back as a GraphQL error (deleted
            // or restricted report) rather than the handled `report: null`. Skip that player
            // instead of failing the whole reference — and the whole request behind it — but a
            // 429 still aborts everything (spec §3.2).
            try {
                const got = await fightAndTables(query, r.report.code, r.report.fightID, r.name);
                if (got) players.push({ rank: r, sourceID: got.sourceId, context: got.ctx, tables: got.tables });
            } catch (e) {
                if (e && e.code === 'RATE_LIMIT') throw e;
            }
        }
        return { summary: referenceSummary(ranks, players, o.dbIndex, o.classToken, o.role, [o.itemLevel - band, o.itemLevel + band], topDps, { fastestDurationSec: fastest }), note: null, band };
    })();
    o.refCache.set(key, { at: o.now, pending });
    try {
        const value = await pending;
        // The band may have widened during the fetch; re-key to the band actually used so a scan
        // for a nearby item level that only the widened band covers finds this entry too.
        const finalBand = typeof value.band === 'number' ? value.band : REF.band;
        const finalKey = prefix + (o.itemLevel - finalBand) + '/' + (o.itemLevel + finalBand);
        if (finalKey !== key) o.refCache.delete(key);
        o.refCache.set(finalKey, { at: o.now, value });
        return value;
    } catch (e) { o.refCache.delete(key); throw e; }
}

// v2 §5.1: the player's raid nights — every kill of the zone grouped by report code — read off
// the same encounterRankings answer the pipeline already needs. Newest first, capped.
const NIGHT_LIMIT = 10;
function buildNights(rankBlobs, bosses) {
    const byCode = new Map();
    (bosses || []).forEach(b => {
        const blob = rankBlobs && rankBlobs['e' + b.encounterId];
        (blob && Array.isArray(blob.ranks) ? blob.ranks : []).forEach(r => {
            if (!r || !r.report || !r.report.code) return;
            const n = byCode.get(r.report.code) || { code: r.report.code, startTime: Infinity, bosses: [] };
            n.startTime = Math.min(n.startTime, typeof r.startTime === 'number' ? r.startTime : Infinity);
            n.bosses.push({ encounterId: b.encounterId, name: b.name, rankPercent: round1(r.rankPercent) });
            byCode.set(r.report.code, n);
        });
    });
    const pct = b => (b.rankPercent == null ? 101 : b.rankPercent);
    return Array.from(byCode.values()).sort((a, b) => b.startTime - a.startTime).slice(0, NIGHT_LIMIT).map(n => ({
        code: n.code, date: isFinite(n.startTime) ? new Date(n.startTime).toISOString().slice(0, 10) : null,
        bosses: n.bosses.slice().sort((a, b) => pct(a) - pct(b)),
        medianPercent: round1(median(n.bosses.map(b => b.rankPercent))),
    }));
}

// The whole pipeline for one player (spec §3.1 steps 2–5). Returns null when there is nothing
// to analyse; WCL errors (including rate limits) propagate to the route.
async function fetchFeedback(query, o) {
    const { profile, dbIndex, refCache, thresholds, now } = o;
    if (!profile || !profile.parses) return null;
    // v2 §5.1: rankings for every killed boss of the zone (the nights list needs them all), not
    // only the KILL_LIMIT picked for analysis.
    const killed = profile.parses.bosses.filter(b => b && b.kills > 0 && b.encounterId).map(b => ({ encounterId: b.encounterId, name: b.name, medianPercent: b.medianPercent }));
    if (!killed.length) return null;
    const id = profile.identity || {};
    const role = id.role || 'caster';
    const limited = profile.parses.metric === 'hps';
    // Minor 11: `metric` rides along on `player` so fightContext (via killFacts) can label its
    // `me.amount` field correctly instead of always calling it "dps".
    const player = { name: profile.name, classToken: id.class, spec: id.spec, role, schools: schoolsOf(id.class, id.spec, role), metric: profile.parses.metric };
    const th = V.parseThresholds(thresholds || {});
    const hitCap = (role === 'caster' || role === 'healer') ? th.spellHit : th.meleeHit;
    const er = await query(encounterRankQuery(killed.map(t => t.encounterId), profile.parses.metric), { name: profile.name, server: profile.server, region: profile.region });
    const ch = er && er.characterData && er.characterData.character;
    if (!ch) return null;
    const nights = buildNights(ch, killed);
    const ranksOf = t => { const blob = ch['e' + t.encounterId]; return blob && Array.isArray(blob.ranks) ? blob.ranks.filter(r => r && r.report && r.report.code) : []; };
    let targets, night = null;
    if (o.report) {
        // v2 §5.2: one raid night — every boss with a kill in that report, worst first.
        targets = killed.map(t => Object.assign({ rank: ranksOf(t).find(r => r.report.code === o.report) }, t)).filter(t => t.rank)
            .sort((a, b) => (a.rank.rankPercent == null ? 101 : a.rank.rankPercent) - (b.rank.rankPercent == null ? 101 : b.rank.rankPercent)).slice(0, KILL_LIMIT);
        if (!targets.length) return { noKills: true };
        const n = nights.find(x => x.code === o.report);
        // Minor 4 (whole-branch review): `nights` is capped at NIGHT_LIMIT, so a night older than
        // the ten listed still resolves via ranksOf/targets above but misses here. Rather than fall
        // back to null (and render "raid night of null"), derive date and medianPercent straight
        // from the ranks that were actually selected for this report.
        if (n) {
            night = { code: o.report, date: n.date, medianPercent: n.medianPercent };
        } else {
            const rk = targets.map(t => t.rank);
            const earliest = rk.reduce((min, r) => (typeof r.startTime === 'number' && (min == null || r.startTime < min) ? r.startTime : min), null);
            night = { code: o.report, date: earliest != null ? new Date(earliest).toISOString().slice(0, 10) : null,
                      medianPercent: round1(median(rk.map(r => round1(r.rankPercent)))) };
        }
    } else {
        targets = pickKills(profile);
    }
    if (!targets.length) return null;
    const results = await mapLimit(targets, 3, async t => {
        const ranks = ranksOf(t);
        // v2 §4: analyse up to KILLS_PER_BOSS pulls per boss — the representative rank (task-rep-kill;
        // see pickRank's own comment for the selection rules) plus the most recent one.
        const chosen = t.rank ? [t.rank] : pickRanks(ranks, t.medianPercent);
        const byTime = ranks.slice().sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        const out = [];
        for (const rank of chosen) {
            // Which pull (oldest first) this rank is, so the facts table can say "kill 3 of 7".
            const killIndex = byTime.indexOf(rank) + 1;
            // Important 5: a report that errors (a GraphQL error on a deleted/restricted report, not
            // the already-handled `report: null`) drops this one pull instead of 502ing the whole
            // request. A 429 anywhere still aborts everything (spec §3.2).
            try {
                const got = await fightAndTables(query, rank.report.code, rank.report.fightID, profile.name);
                if (!got) continue;
                const ref = (limited || !id.class || !id.spec || typeof rank.bracketData !== 'number') ? { summary: null, note: null }
                    : await getReference(query, { encounterId: t.encounterId, classToken: id.class, spec: id.spec, role, region: profile.region, itemLevel: rank.bracketData, dbIndex, refCache, now });
                out.push(killFacts({ encounterId: t.encounterId, name: t.name, rank, killsOnBoss: ranks.length, killIndex, context: got.ctx, tables: got.tables, sourceId: got.sourceId, player, reference: ref.summary, referenceNote: ref.note, dbIndex, hitCap }));
            } catch (err) {
                if (err && err.code === 'RATE_LIMIT') throw err;
                out.push({ dropped: true, name: t.name, reason: (err && err.message) ? err.message : 'WCL error fetching this kill' });
            }
        }
        return out;
    });
    const flat = results.flat();
    const kills = flat.filter(k => k && !k.dropped);
    const droppedKills = flat.filter(k => k && k.dropped).map(k => ({ name: k.name, reason: k.reason }));
    kills.sort((a, b) => (a.rankPercent == null ? 101 : a.rankPercent) - (b.rankPercent == null ? 101 : b.rankPercent));
    return buildFacts({ profile, player, kills, thresholds, now, limited, droppedKills, nights, night });
}

module.exports = { KILL_LIMIT, REF, T, WCL_CLASS_NAME, SPEC_SCHOOLS, wclSpecName, schoolsOf, pickKills, pickRank, KILLS_PER_BOSS, pickRanks, median, round1, lower, fightContext, abilityStats, castCounts, castsPerMinute, buffUptime, lustPercent, BURST_MAX_SEC, POTION_LABEL, auraBands, burstStats, burstLabel, CONSUMABLE, isUtilityGuardian, classifyAuras, BUFF_ALIAS, PARTY_BUFFS, canonBuffs, STAT_KEYS, playerStats, bandRanks, countNames, mostCommon, referenceSummary, finding, RAID_DEBUFFS, OWN_DEBUFF, debuffFacts, UTILITY_CAST, uptimeFindings, rotationFindings, ROLE_STATS, STAT_LABEL, killFindings, killFacts, consumableFindings, debuffFindings, gearFindings, mergeFindings, positives, buildFacts, buildPrompt, checkNumbers, encounterRankQuery, FIGHT_QUERY, PLAYER_QUERY, refPageQuery, globalRank, middlePageOrder, pageFetcher, findLastPage, leaderboardLength, mapLimit, getReference, NIGHT_LIMIT, buildNights, fetchFeedback };
