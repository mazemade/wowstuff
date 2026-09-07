'use strict';
// Node-only: the "logs" side of Warcraft Logs — a guild's recent raid nights, and everything one
// report says about the players in it. The GraphQL `query` function is injected, as in
// vet-profile.js: the server passes wclQuery, the tests pass a stub. Shapes verified live
// 2026-09-07 (report X6mnbPQpGhjJC2TN: 25 players with full gear in two requests).

const GUILD_REPORTS_QUERY = 'query($guild:String!,$server:String!,$region:String!,$limit:Int!){reportData{' +
    'reports(guildName:$guild,guildServerSlug:$server,guildServerRegion:$region,limit:$limit){data{code title startTime zone{id name}}}}}';
const REPORT_META_QUERY = 'query($code:String!){reportData{report(code:$code){title startTime zone{id name} ' +
    'guild{name server{slug region{slug}}} masterData{actors(type:"Player"){id name server subType}} fights(killType:Encounters){id name kill}}}}';
// One CombatantInfo alias per fight in a single request — the same aliasing trick as
// encounterRankQuery in vet-feedback.js. limit is per alias; a 25-man raid is 25 rows.
function combatantQuery(fightIds) {
    return 'query($code:String!){reportData{report(code:$code){' +
        fightIds.map(id => 'f' + id + ':events(dataType:CombatantInfo,fightIDs:[' + id + '],limit:100){data}').join(' ') + '}}}';
}

const isoDate = ms => (typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : null);
// WCL's actor `server` is a display name ("Pyrewood Village"); the API wants the slug.
const slugOf = s => (s ? String(s).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : null);

async function fetchGuildReports(query, o) {
    const limit = o.limit || 15;
    const d = await query(GUILD_REPORTS_QUERY, { guild: o.guild, server: o.server, region: o.region, limit });
    const rows = d && d.reportData && d.reportData.reports && Array.isArray(d.reportData.reports.data) ? d.reportData.reports.data : [];
    return rows.filter(r => r && r.code)
        .map(r => ({ code: r.code, title: r.title || '', date: isoDate(r.startTime), startTime: r.startTime, zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null }))
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

// Everyone who was in an encounter fight of the report, with the CombatantInfo row (gear,
// talents, stats at pull) from the LATEST fight they appear in — people swap pieces and specs
// between bosses, and the night's final state is what gets vetted. Wipes count: gear worn on a
// wipe is still the gear. null when WCL does not know the report (or it is private).
async function fetchReportRoster(query, o) {
    const md = await query(REPORT_META_QUERY, { code: o.code });
    const r = md && md.reportData && md.reportData.report;
    if (!r) return null;
    const fights = (Array.isArray(r.fights) ? r.fights : []).filter(f => f && Number.isInteger(f.id)).map(f => ({ id: f.id, name: f.name, kill: !!f.kill }));
    const guild = r.guild && r.guild.name
        ? { name: r.guild.name, server: r.guild.server ? slugOf(r.guild.server.slug) : null,
            region: r.guild.server && r.guild.server.region && r.guild.server.region.slug ? String(r.guild.server.region.slug).toLowerCase() : null }
        : null;
    const out = { code: o.code, title: r.title || '', date: isoDate(r.startTime), startTime: r.startTime,
                  zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null, guild, fights, players: [] };
    if (!fights.length) return out;
    const cd = await query(combatantQuery(fights.map(f => f.id)), { code: o.code });
    const rep = cd && cd.reportData && cd.reportData.report;
    const actors = new Map(((r.masterData && r.masterData.actors) || []).map(a => [a.id, a]));
    const byActor = new Map();
    fights.forEach(f => {
        const alias = rep && rep['f' + f.id];
        (alias && Array.isArray(alias.data) ? alias.data : []).forEach(row => {
            const a = row && actors.get(row.sourceID);
            if (!a || !a.name) return;
            byActor.set(row.sourceID, { name: a.name, server: slugOf(a.server), classToken: a.subType ? String(a.subType).toUpperCase() : null,
                                        combatant: row, fightId: f.id, fightName: f.name });
        });
    });
    out.players = Array.from(byActor.values()).sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

module.exports = { GUILD_REPORTS_QUERY, REPORT_META_QUERY, combatantQuery, fetchGuildReports, fetchReportRoster };
