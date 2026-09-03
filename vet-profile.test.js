'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vet-engine.js');
const P = require('./vet-profile.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}
const pending = [];

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
const db = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));
const PARAMS = { name: 'Nottomwro', server: 'spineshatter', region: 'eu', zone: 1060 };
const NOW = Date.parse('2026-09-03T12:00:00Z');

// A stub WCL: answers by query kind and records what was asked.
function stubQuery(opts) {
    const o = Object.assign({ character: true, combatant: true, kills1060: true, kills1056: true }, opts);
    const calls = [];
    return { calls, query: async (q, vars) => {
        calls.push({ q, vars });
        if (q === P.CHAR_QUERY) return { characterData: { character: o.character ? { id: FX.character.id, classID: FX.character.classID, recentReports: FX.character.recentReports } : null } };
        if (q === P.REPORT_QUERY) {
            const combatant = o.combatant && vars.code === FX.report.code ? [FX.report.combatant] : [];
            return { reportData: { report: { masterData: { actors: FX.report.actors }, events: { data: combatant } } } };
        }
        if (q === P.RANK_QUERY) {
            const zr = JSON.parse(JSON.stringify(FX.zoneRankings[String(vars.zone)]));
            if ((vars.zone === 1060 && !o.kills1060) || (vars.zone === 1056 && !o.kills1056)) zr.rankings.forEach(r => { r.totalKills = 0; r.medianPercent = null; });
            if (vars.metric === 'hps') { zr.medianPerformanceAverage = 47.5; zr.rankings.forEach(r => { r.medianPercent = 47.5; }); }
            return { characterData: { character: { zoneRankings: zr } } };
        }
        throw new Error('unexpected query');
    } };
}

test('fetchProfile: happy path joins gear, reported stats, spec and current-tier parses', async () => {
    const s = stubQuery();
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.name, 'Nottomwro');
    assert.deepStrictEqual(p.identity, { class: 'SHAMAN', spec: 'Enhancement', role: 'melee', talentSplit: [2, 45, 14], detectedFrom: 'talents' });
    assert.strictEqual(p.gear.length, 17);
    assert.strictEqual(p.gearSummary.avgItemLevel, 131.82);
    assert.strictEqual(p.reported.hitMelee, 171);
    assert.strictEqual(p.computed.meleeHit, 171);
    assert.strictEqual(p.computed.attackPower, 870);
    assert.deepStrictEqual(p.gearOnly, { meleeHit: 171, spellHit: 0 });
    assert.strictEqual(p.parses.zone, 1060);
    assert.strictEqual(p.parses.zoneName, 'BT / Hyjal');
    assert.strictEqual(p.parses.fallback, false);
    assert.strictEqual(p.parses.metric, 'dps');
    assert.strictEqual(Math.round(p.parses.medianPercent), 83);
    assert.strictEqual(p.parses.bosses.length, 14);
    assert.strictEqual(p.parses.bosses[0].name, "High Warlord Naj'entus");
    assert.strictEqual(p.parses.bosses[0].kills, 2);
    assert.strictEqual(p.lastSeen.reportCode, FX.report.code);
    assert.strictEqual(p.lastSeen.timestamp, FX.report.startTime);
    assert.deepStrictEqual(s.calls.find(c => c.q === P.REPORT_QUERY).vars.fights, [11], 'asks for the last fight of the report');
    assert.strictEqual(p.lastSeen.fightName, 'The Lurker Below');
    assert.deepStrictEqual(p.missing, []);
    // One report query only: the first report had the row.
    assert.strictEqual(s.calls.filter(c => c.q === P.REPORT_QUERY).length, 1);
    assert.strictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).length, 2, 'both tiers are always queried now');
    assert.strictEqual(p.parses.other.zone, 1056);
    assert.strictEqual(Math.round(p.parses.other.medianPercent), 52);
});

test('fetchProfile: unknown character returns null', async () => {
    const s = stubQuery({ character: false });
    assert.strictEqual(await P.fetchProfile(s.query, PARAMS, db, NOW), null);
});

test('fetchProfile: no combatant row in three reports → gear null, missing says so, parses still present', async () => {
    const s = stubQuery({ combatant: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.gear, null);
    assert.strictEqual(p.computed, null);
    assert.strictEqual(p.reported, null);
    assert.strictEqual(p.lastSeen, null);
    assert.deepStrictEqual(p.missing, ['no combatant data in last 3 reports']);
    assert.strictEqual(s.calls.filter(c => c.q === P.REPORT_QUERY).length, 3);
    // Spec falls back to WCL's label from the rankings.
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.identity.detectedFrom, 'wcl');
    assert.strictEqual(p.parses.zone, 1060);
});

test('fetchProfile: no kills in the current tier falls back to SSC/TK and says so', async () => {
    const s = stubQuery({ kills1060: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.parses.zone, 1056);
    assert.strictEqual(p.parses.zoneName, 'SSC / TK');
    assert.strictEqual(p.parses.fallback, true);
    assert.strictEqual(Math.round(p.parses.medianPercent), 52);
    assert.strictEqual(p.parses.bosses.length, 10);
    assert.strictEqual(p.parses.other, null, 'the requested tier had zero kills, so there is nothing to show as other');
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.zone), [1060, 1056]);
});

test('fetchProfile: both tiers have kills and the previous tier medians higher → it gates', async () => {
    // Same shape as stubQuery, but the 1056 blob's medianPerformanceAverage is raised above the
    // 1060 fixture median (82.888), so the previous tier is now the better one for this player.
    const s = stubQuery();
    const orig = s.query;
    s.query = async (q, vars) => {
        const d = await orig(q, vars);
        if (q === P.RANK_QUERY && vars.zone === 1056) {
            d.characterData.character.zoneRankings.medianPerformanceAverage = 90;
        }
        return d;
    };
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.parses.zone, 1056);
    assert.strictEqual(p.parses.fallback, true);
    assert.strictEqual(p.parses.other.zone, 1060);
    assert.strictEqual(Math.round(p.parses.other.medianPercent), 83);
});

test('fetchProfile: no kills anywhere → parses null and a missing entry', async () => {
    const s = stubQuery({ kills1060: false, kills1056: false });
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.parses, null);
    assert.ok(p.missing.indexOf('no parses in BT / Hyjal or SSC / TK') !== -1, p.missing.join(','));
});

test('fetchProfile: a healer is ranked by hps', async () => {
    // Force a healer: same fixture, but talents say Restoration (tree 3 of shaman).
    const s = stubQuery();
    const orig = s.query;
    s.query = async (q, vars) => {
        const d = await orig(q, vars);
        if (q === P.REPORT_QUERY && d.reportData.report.events.data.length) {
            const row = JSON.parse(JSON.stringify(d.reportData.report.events.data[0]));
            row.talents = [{ id: 0 }, { id: 8 }, { id: 53 }];
            d.reportData.report.events.data = [row];
        }
        return d;
    };
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.identity.role, 'healer');
    assert.strictEqual(p.parses.metric, 'hps');
    assert.strictEqual(p.parses.medianPercent, 47.5);
    // Both tiers median to 47.5 (the stub forces every hps median there) — a tie, so the
    // requested zone gates.
    assert.strictEqual(p.parses.zone, 1060);
    assert.strictEqual(p.parses.fallback, false);
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.metric), ['hps', 'hps']);
});

test('fetchProfile: no combatant row, and a healer bestSpec from rankings re-queries dps then hps', async () => {
    // No combatant means talentSplit is null, so spec detection can only come from WCL's
    // bestSpec on the zoneRankings row. Force that label to a healer spec and confirm the
    // dps -> hps re-query branch actually runs (it is unreachable from the talent-based
    // healer test, since that one already has metric 'hps' on the first call).
    const s = stubQuery({ combatant: false });
    const orig = s.query;
    s.query = async (q, vars) => {
        const d = await orig(q, vars);
        if (q === P.RANK_QUERY) {
            const zr = d.characterData.character.zoneRankings;
            if (zr && Array.isArray(zr.rankings)) {
                zr.rankings.forEach(r => { if (r.totalKills > 0) { r.bestSpec = 'Restoration'; r.spec = 'Restoration'; } });
            }
        }
        return d;
    };
    const p = await P.fetchProfile(s.query, PARAMS, db, NOW);
    assert.strictEqual(p.identity.spec, 'Restoration');
    assert.strictEqual(p.identity.role, 'healer');
    assert.strictEqual(p.identity.detectedFrom, 'wcl');
    assert.strictEqual(p.parses.metric, 'hps');
    assert.deepStrictEqual(s.calls.filter(c => c.q === P.RANK_QUERY).map(c => c.vars.metric), ['dps', 'dps', 'hps', 'hps']);
});

test('buildProfile: is pure and does not need the network', () => {
    const p = P.buildProfile({ name: 'X', server: 's', region: 'eu', zone: 1060, classToken: 'SHAMAN',
        combatant: FX.report.combatant, report: { code: FX.report.code, startTime: FX.report.startTime, fightName: FX.report.fight.name },
        rankings: FX.zoneRankings['1060'], rankingsZone: 1060, fallback: false, metric: 'dps', dbIndex: db });
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.gearSummary.missingEnchants, 0);
    assert.strictEqual(p.lastSeen.fightName, 'Hydross the Unstable');
});

test('buildProfile: the WCL spec fallback reads the first ranking row that has a kill, not row zero', () => {
    const rankings = JSON.parse(JSON.stringify(FX.zoneRankings['1060']));
    rankings.rankings[0].totalKills = 0;
    rankings.rankings[0].spec = null;
    rankings.rankings[0].bestSpec = null;
    const p = P.buildProfile({ name: 'X', server: 's', region: 'eu', zone: 1060, classToken: 'SHAMAN',
        combatant: null, report: null, rankings, rankingsZone: 1060, fallback: false, metric: 'dps', dbIndex: db });
    assert.strictEqual(p.identity.spec, 'Enhancement');
    assert.strictEqual(p.identity.detectedFrom, 'wcl');
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
