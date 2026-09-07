'use strict';
const assert = require('node:assert');
const L = require('./wcl-logs.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// Shapes verified live 2026-09-07 against report X6mnbPQpGhjJC2TN (Animal Kingdom, Spineshatter EU).
const META = { title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' },
    guild: { name: 'Animal Kingdom', server: { slug: 'spineshatter', region: { slug: 'EU' } } },
    masterData: { actors: [{ id: 1, name: 'Utopik', server: 'Spineshatter', subType: 'Rogue' }, { id: 2, name: 'Sspope', server: 'Spineshatter', subType: 'Priest' }, { id: 3, name: 'Latecomer', server: 'Pyrewood Village', subType: 'Mage' }] },
    fights: [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 5, name: 'Anetheron', kill: false }, { id: 9, name: 'Archimonde', kill: true }] };
const row = (sourceID, mark) => ({ sourceID, gear: [{ id: mark }], talents: [{ id: 0 }, { id: 41 }, { id: 20 }] });
function stub(o) {
    o = Object.assign({ meta: META, combatants: { f3: [row(1, 'early'), row(2, 'early')], f5: [row(1, 'mid')], f9: [row(1, 'late'), row(3, 'late'), row(99, 'unknown-actor')] } }, o);
    const calls = [];
    return { calls, query: async (q, vars) => {
        calls.push({ q, vars });
        if (q === L.GUILD_REPORTS_QUERY) return { reportData: { reports: { data: o.reports || [] } } };
        if (q === L.REPORT_META_QUERY) return { reportData: { report: o.meta } };
        if (q.includes('CombatantInfo')) { const rep = {}; Object.keys(o.combatants).forEach(k => { rep[k] = { data: o.combatants[k] }; }); return { reportData: { report: rep } }; }
        throw new Error('unexpected query: ' + q.slice(0, 50));
    } };
}

test('combatantQuery: one CombatantInfo alias per fight in a single request', () => {
    const q = L.combatantQuery([3, 9]);
    assert.ok(q.includes('f3:events(dataType:CombatantInfo,fightIDs:[3],limit:100){data}'));
    assert.ok(q.includes('f9:events(dataType:CombatantInfo,fightIDs:[9],limit:100){data}'));
});
test('fetchGuildReports: newest first, dated, zone carried; empty answer is an empty list', async () => {
    const s = stub({ reports: [
        { code: 'fDBNk8Wm7Avjq6RJ', title: 'SSC / TK', startTime: 1788600000000, zone: { id: 1056, name: 'SSC / TK' } },
        { code: 'X6mnbPQpGhjJC2TN', title: 'BT / Hyjal', startTime: 1788700000000, zone: { id: 1060, name: 'BT / Hyjal' } },
        { code: null } ] });
    const logs = await L.fetchGuildReports(s.query, { guild: 'Animal Kingdom', server: 'spineshatter', region: 'eu' });
    assert.deepStrictEqual(logs.map(l => [l.code, l.date, l.zone.id]), [['X6mnbPQpGhjJC2TN', '2026-09-06', 1060], ['fDBNk8Wm7Avjq6RJ', '2026-09-05', 1056]]);
    assert.deepStrictEqual(s.calls[0].vars, { guild: 'Animal Kingdom', server: 'spineshatter', region: 'eu', limit: 15 });
    assert.deepStrictEqual(await L.fetchGuildReports(stub({ reports: null }).query, { guild: 'x', server: 's', region: 'eu', limit: 3 }), []);
});
test('fetchReportRoster: two requests; every encounter fight (wipes included); the latest fight\'s row wins per player', async () => {
    const s = stub();
    const r = await L.fetchReportRoster(s.query, { code: 'X6mnbPQpGhjJC2TN' });
    assert.strictEqual(s.calls.length, 2);
    assert.deepStrictEqual(s.calls[1].vars, { code: 'X6mnbPQpGhjJC2TN' });
    assert.deepStrictEqual(r.guild, { name: 'Animal Kingdom', server: 'spineshatter', region: 'eu' });
    assert.strictEqual(r.date, '2026-09-06');
    assert.deepStrictEqual(r.fights, [{ id: 3, name: 'Rage Winterchill', kill: true }, { id: 5, name: 'Anetheron', kill: false }, { id: 9, name: 'Archimonde', kill: true }]);
    assert.deepStrictEqual(r.players.map(p => [p.name, p.server, p.classToken, p.fightId, p.fightName, p.combatant.gear[0].id]), [
        ['Latecomer', 'pyrewood-village', 'MAGE', 9, 'Archimonde', 'late'],
        ['Sspope', 'spineshatter', 'PRIEST', 3, 'Rage Winterchill', 'early'],
        ['Utopik', 'spineshatter', 'ROGUE', 9, 'Archimonde', 'late']]);
});
test('fetchReportRoster: no encounter fights → one request and no players; unknown report → null', async () => {
    const s = stub({ meta: Object.assign({}, META, { fights: [] }) });
    const r = await L.fetchReportRoster(s.query, { code: 'X6mnbPQpGhjJC2TN' });
    assert.strictEqual(s.calls.length, 1);
    assert.deepStrictEqual(r.players, []);
    assert.strictEqual(await L.fetchReportRoster(stub({ meta: null }).query, { code: 'X6mnbPQpGhjJC2TN' }), null);
});
test('fetchReportRoster: a report with no guild carries guild: null', async () => {
    const r = await L.fetchReportRoster(stub({ meta: Object.assign({}, META, { guild: null }) }).query, { code: 'ktjzamNDCK2Af6TH' });
    assert.strictEqual(r.guild, null);
    assert.strictEqual(r.code, 'ktjzamNDCK2Af6TH');
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
