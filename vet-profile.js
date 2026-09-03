'use strict';
// Node-only: turns Warcraft Logs answers into one vetting profile. The GraphQL `query`
// function is injected so the server passes its authenticated wclQuery and the tests pass a stub.
const V = require('./vet-engine.js');

const ZONE_NAMES = { 1060: 'BT / Hyjal', 1056: 'SSC / TK' };
const PREVIOUS_ZONE = { 1060: 1056 };
const RECENT_REPORTS = 3;

const CHAR_QUERY = 'query($name:String!,$server:String!,$region:String!){characterData{character(name:$name,serverSlug:$server,serverRegion:$region){' +
    'id classID recentReports(limit:' + RECENT_REPORTS + '){data{code startTime fights(killType:Encounters){id name}}}}}}';
const REPORT_QUERY = 'query($code:String!,$fights:[Int]!){reportData{report(code:$code){' +
    'masterData{actors(type:"Player"){id name server subType}} events(dataType:CombatantInfo,fightIDs:$fights,limit:100){data}}}}';
const RANK_QUERY = 'query($name:String!,$server:String!,$region:String!,$zone:Int!,$metric:CharacterRankingMetricType!){characterData{' +
    'character(name:$name,serverSlug:$server,serverRegion:$region){zoneRankings(zoneID:$zone,metric:$metric)}}}';

const REPORTED_FIELDS = ['hitMelee', 'hitRanged', 'hitSpell', 'expertise', 'critMelee', 'critRanged', 'critSpell',
    'hasteMelee', 'hasteRanged', 'hasteSpell', 'dodge', 'parry', 'block', 'armor',
    'strength', 'agility', 'stamina', 'intellect', 'spirit'];

function hasKills(zr) {
    return !!(zr && Array.isArray(zr.rankings) && zr.rankings.some(r => r && r.totalKills > 0));
}

function buildParses(rankings, zone, fallback, metric) {
    if (!hasKills(rankings)) return null;
    return {
        zone, zoneName: ZONE_NAMES[zone] || String(zone), fallback: !!fallback, metric,
        medianPercent: typeof rankings.medianPerformanceAverage === 'number' ? rankings.medianPerformanceAverage : null,
        bestPercent: typeof rankings.bestPerformanceAverage === 'number' ? rankings.bestPerformanceAverage : null,
        bosses: rankings.rankings.map(r => ({
            encounterId: r.encounter && r.encounter.id, name: r.encounter && r.encounter.name,
            medianPercent: typeof r.medianPercent === 'number' ? r.medianPercent : null,
            bestPercent: typeof r.rankPercent === 'number' ? r.rankPercent : null,
            kills: r.totalKills || 0, fastestKillMs: r.fastestKill || null,
        })),
    };
}

function buildProfile(a) {
    const missing = [];
    const talentSplit = a.combatant && Array.isArray(a.combatant.talents) ? a.combatant.talents.map(t => t.id) : null;
    const wclSpec = a.rankings && a.rankings.rankings && a.rankings.rankings[0] ? (a.rankings.rankings[0].bestSpec || a.rankings.rankings[0].spec) : null;
    const det = V.detectSpec(a.classToken, talentSplit, wclSpec);
    let gear = null, gearSummary = null, gearOnly = null, reported = null, computed = null, lastSeen = null;
    if (a.combatant) {
        const s = V.summarizeGear(a.combatant.gear, a.dbIndex, a.classToken);
        gear = s.slots;
        gearSummary = { avgItemLevel: s.avgItemLevel, missingEnchants: s.missingEnchants, emptySockets: s.emptySockets,
                        unknownItems: s.unknownItems, socketBonusesApplied: s.socketBonusesApplied, setBonusesApplied: s.setBonusesApplied };
        gearOnly = { meleeHit: s.stats[V.STAT.MELEE_HIT] || 0, spellHit: s.stats[V.STAT.SPELL_HIT] || 0 };
        reported = {};
        REPORTED_FIELDS.forEach(k => { reported[k] = typeof a.combatant[k] === 'number' ? a.combatant[k] : null; });
        computed = Object.assign(V.derivedStats(s.stats, reported), { avgItemLevel: s.avgItemLevel });
        if (s.unknownItems.length) missing.push('items not in the table: ' + s.unknownItems.join(', '));
        lastSeen = { reportCode: a.report.code, fightName: a.report.fightName, timestamp: a.report.startTime };
    } else {
        missing.push('no combatant data in last ' + RECENT_REPORTS + ' reports');
    }
    const parses = buildParses(a.rankings, a.rankingsZone, a.fallback, a.metric);
    if (!parses) missing.push('no parses in ' + ZONE_NAMES[a.zone] + (PREVIOUS_ZONE[a.zone] ? ' or ' + ZONE_NAMES[PREVIOUS_ZONE[a.zone]] : ''));
    if (!det.spec) missing.push('spec could not be determined');
    return {
        name: a.name, server: a.server, region: a.region, zone: a.zone,
        identity: { class: a.classToken || null, spec: det.spec, role: det.role, talentSplit, detectedFrom: det.detectedFrom },
        lastSeen, gear, gearSummary, gearOnly, reported, computed, parses, missing,
    };
}

async function fetchProfile(query, params, dbIndex) {
    const { name, server, region, zone } = params;
    const cd = await query(CHAR_QUERY, { name, server, region });
    const ch = cd && cd.characterData && cd.characterData.character;
    if (!ch) return null;
    const classToken = V.WCL_CLASS_IDS[ch.classID] || null;

    let combatant = null, report = null;
    const reports = (ch.recentReports && ch.recentReports.data) || [];
    for (const rep of reports) {
        if (!rep.fights || !rep.fights.length) continue;
        const fight = rep.fights[rep.fights.length - 1];
        const rd = await query(REPORT_QUERY, { code: rep.code, fights: [fight.id] });
        const r = rd && rd.reportData && rd.reportData.report;
        if (!r) continue;
        const actor = (r.masterData.actors || []).find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
        const row = actor ? (r.events.data || []).find(e => e.sourceID === actor.id) : null;
        if (row) { combatant = row; report = { code: rep.code, startTime: rep.startTime, fightName: fight.name }; break; }
    }

    const talentSplit = combatant && Array.isArray(combatant.talents) ? combatant.talents.map(t => t.id) : null;
    let det = V.detectSpec(classToken, talentSplit, null);
    let metric = det.role === 'healer' ? 'hps' : 'dps';

    async function rank(z, m) {
        const d = await query(RANK_QUERY, { name, server, region, zone: z, metric: m });
        return d && d.characterData && d.characterData.character ? d.characterData.character.zoneRankings : null;
    }
    let rankingsZone = zone, fallback = false;
    let rankings = await rank(zone, metric);
    if (!hasKills(rankings) && PREVIOUS_ZONE[zone]) {
        const prev = await rank(PREVIOUS_ZONE[zone], metric);
        if (hasKills(prev)) { rankings = prev; rankingsZone = PREVIOUS_ZONE[zone]; fallback = true; }
    }
    if (!det.spec && hasKills(rankings)) {
        const first = rankings.rankings.find(r => r.totalKills > 0);
        det = V.detectSpec(classToken, talentSplit, first.bestSpec || first.spec);
        if (det.role === 'healer' && metric === 'dps') { metric = 'hps'; rankings = await rank(rankingsZone, metric); }
    }
    return buildProfile({ name, server, region, zone, classToken, combatant, report, rankings, rankingsZone, fallback, metric, dbIndex });
}

module.exports = { ZONE_NAMES, PREVIOUS_ZONE, CHAR_QUERY, REPORT_QUERY, RANK_QUERY, buildProfile, fetchProfile };
