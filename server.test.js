'use strict';
// Route-level tests for server.js (whole-branch review, fix wave B, Important 6). Facts
// derivation itself is exhaustively covered by vet-feedback.test.js; this suite is only about
// what the ROUTE does: response shape, its own cache (and expiry), the model-failure fallback,
// 429 propagation, the number guard, the cross-origin block and in-flight dedup added for
// Critical 1, and the item-table guard added for Minor 17.
//
// server.js is required directly (no port bound — see the require.main guard at the bottom of
// the file) and driven over a real ephemeral-port HTTP server with the global `fetch`, per the
// repo's "no new dependency" rule. WCL and OpenAI are stubbed via app.__test; nothing here
// touches the network or needs credentials.
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./vet-profile.js');
const F = require('./vet-feedback.js');
const V = require('./vet-engine.js');
const app = require('./server.js');

let passed = 0, failed = 0;
// Tests share one running server and its module-level caches, so — unlike the other suites in
// this repo, whose tests are independent of each other — these must run strictly in sequence:
// chaining onto one promise instead of firing test bodies concurrently.
let chain;
function test(name, fn) {
    chain = chain.then(async () => {
        try { await fn(); passed++; console.log('ok -', name); }
        catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
    });
}

const srv = http.createServer(app);
let base = '';
chain = new Promise((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; resolve(); });
    srv.on('error', reject);
});

// --- Fixture + stub, deliberately independent of vet-feedback.test.js's copy of the same shape
// (that suite verifies facts derivation from it; this one only needs it to drive the route).
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-feedback-rotminster.json'), 'utf8'));
const db = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));
const IDENTITY_KEY = 'eu/spineshatter/rotminster/1060'; // must match loadProfile's key derivation
const QS = 'name=Rotminster&server=spineshatter&region=eu&zone=1060';

function rotProfile() {
    const rankings = { medianPerformanceAverage: 14.0, bestPerformanceAverage: 14.0, rankings: [
        { encounter: { id: 50619, name: 'Anetheron' }, medianPercent: 31.9, rankPercent: 31.9, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50620, name: "Kaz'rogal" }, medianPercent: 0.3, rankPercent: 0.3, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50603, name: 'Shade of Akama' }, medianPercent: null, rankPercent: null, totalKills: 0, spec: 'Destruction', bestSpec: 'Destruction' },
    ] };
    return P.buildProfile({ name: 'Rotminster', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'WARLOCK', combatant: null, report: null,
                            rankings, rankingsZone: 1060, fallback: false, metric: 'dps', otherRankings: null, otherZone: 1056, specRankings: rankings, dbIndex: db });
}

// Answers WCL queries from the fixture by query kind, mirroring vet-feedback.test.js's stub.
// Does NOT answer vet-profile.js's CHAR_QUERY/REPORT_QUERY/RANK_QUERY — tests seed vetCache
// directly instead (loadProfile then never needs to fetch), which keeps this suite about the
// route's own logic rather than re-proving profile fetching, already covered elsewhere.
function stubQuery() {
    const calls = [];
    const byFight = new Map();
    Object.keys(FX.kills).forEach(e => { const k = FX.kills[e]; byFight.set(k.code + '/' + k.fightID, { context: k.context, tables: { [k.sourceID]: k.tables } }); });
    Object.keys(FX.reference).forEach(e => FX.reference[e].players.forEach(p => {
        const key = p.rank.report.code + '/' + p.rank.report.fightID;
        const cur = byFight.get(key) || { context: p.context, tables: {} };
        cur.tables[p.sourceID] = p.tables;
        byFight.set(key, cur);
    }));
    const query = async (q, vars) => {
        calls.push({ q, vars });
        if (q.includes('encounterRankings(')) {
            const ch = { id: 1, classID: 10 };
            Object.keys(FX.encounterRankings).forEach(e => { ch['e' + e] = FX.encounterRankings[e]; });
            return { characterData: { character: ch } };
        }
        if (q === F.FIGHT_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.context : null } }; }
        if (q === F.PLAYER_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.tables[vars.s] || null : null } }; }
        if (q.includes('characterRankings(')) {
            const enc = /encounter\(id:(\d+)\)/.exec(q)[1], page = +/page:(\d+)/.exec(q)[1];
            const pg = FX.reference[enc].pages[page - 1];
            return { worldData: { encounter: { characterRankings: pg || { page, hasMorePages: false, count: 0, rankings: [] } } } };
        }
        throw new Error('unexpected query: ' + q.slice(0, 60));
    };
    return { calls, query };
}

// Resets all server-side caches, installs a fresh WCL stub and OpenAI stub, and seeds a profile
// cache hit for Rotminster so loadProfile never needs the WCL calls stubQuery() doesn't answer.
function setupPipeline(openaiReply) {
    app.__test.resetCaches();
    const s = stubQuery();
    app.__test.setWclQuery(s.query);
    app.__test.setOpenaiChat(openaiReply || (async () => 'Solid work out there. Keep it up and ask your leader about buffs.'));
    app.__test.caches.vetCache.set(IDENTITY_KEY, { at: Date.now(), profile: rotProfile() });
    return s;
}

const SAME_ORIGIN = { headers: { 'Sec-Fetch-Site': 'same-origin' } };

test('GET /api/vet/feedback: response shape, and X-Vet-Cache is a true hit on a repeat call', async () => {
    const s = setupPipeline();
    const r1 = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.headers.get('x-vet-cache'), 'miss');
    const body1 = await r1.json();
    assert.ok(body1.facts && typeof body1.facts === 'object', 'facts sheet present');
    assert.ok('report' in body1 && 'reportError' in body1 && typeof body1.generatedAt === 'string', 'response shape');
    const callsAfterFirst = s.calls.length;
    assert.ok(callsAfterFirst > 0, 'the pipeline actually queried WCL');

    const r2 = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.headers.get('x-vet-cache'), 'hit');
    const body2 = await r2.json();
    assert.deepStrictEqual(body2, body1, 'a cache hit returns the exact same body, including the model report');
    assert.strictEqual(s.calls.length, callsAfterFirst, 'no additional WCL calls on a cache hit');
});

test('GET /api/vet/feedback: the 15-minute cache expires and the pipeline re-runs', async () => {
    const s = setupPipeline();
    const r1 = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r1.headers.get('x-vet-cache'), 'miss');
    const callsAfterFirst = s.calls.length;

    // Force the entry to look 15+ minutes old without waiting on real time.
    const entry = app.__test.caches.feedbackCache.get(IDENTITY_KEY);
    assert.ok(entry, 'an entry was cached after the first call');
    entry.at = 0;

    const r2 = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.headers.get('x-vet-cache'), 'miss', 'an expired entry is a miss, not a hit');
    assert.ok(s.calls.length > callsAfterFirst, 'the pipeline actually re-ran rather than serving stale data');
});

test('GET /api/vet/feedback: a model failure is HTTP 200 with report:null, reportError set, facts intact', async () => {
    setupPipeline(async () => { const e = new Error('No OPENAI_API_KEY configured'); e.code = 'NO_KEY'; throw e; });
    const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.report, null);
    assert.strictEqual(body.reportError, 'No OPENAI_API_KEY configured; showing the facts only');
    assert.ok(body.facts && Array.isArray(body.facts.kills) && body.facts.kills.length > 0, 'facts sheet is still the full product');
});

test('GET /api/vet/feedback: a 429 from WCL anywhere in the pipeline aborts the whole request with 429', async () => {
    app.__test.resetCaches();
    const s = stubQuery();
    const raging = async (q, vars) => {
        if (q === F.FIGHT_QUERY) { const e = new Error('WCL rate limit reached'); e.code = 'RATE_LIMIT'; throw e; }
        return s.query(q, vars);
    };
    app.__test.setWclQuery(raging);
    app.__test.setOpenaiChat(async () => 'unused');
    app.__test.caches.vetCache.set(IDENTITY_KEY, { at: Date.now(), profile: rotProfile() });
    const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r.status, 429);
});

test('GET /api/vet/feedback: a kill whose report errors is dropped with a reason, not the whole request (Important 5)', async () => {
    app.__test.resetCaches();
    const s = stubQuery();
    const kazCode = FX.kills['50620'].code, kazFight = FX.kills['50620'].fightID;
    app.__test.setWclQuery(async (q, vars) => {
        if (q === F.FIGHT_QUERY && vars.c === kazCode && vars.f[0] === kazFight) throw new Error('GraphQL error: report is private');
        return s.query(q, vars);
    });
    app.__test.setOpenaiChat(async () => 'Solid work. Keep it up.');
    app.__test.caches.vetCache.set(IDENTITY_KEY, { at: Date.now(), profile: rotProfile() });
    const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r.status, 200, 'one dropped kill must not fail the whole request');
    const body = await r.json();
    assert.strictEqual(body.facts.kills.length, 1, 'the erroring kill is dropped, the other still analysed');
    assert.strictEqual(body.facts.kills[0].name, 'Anetheron');
    assert.deepStrictEqual(body.facts.overall.droppedKills, [{ name: "Kaz'rogal", reason: 'GraphQL error: report is private' }],
        'the route surfaces wave A\'s droppedKills rather than a silently thinner sheet');
});

test('GET /api/vet/feedback: a reply with a figure not in the facts is rejected by the number guard', async () => {
    setupPipeline(async () => 'You did an incredible 9999 damage out there, more than anyone else in the raid.');
    const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.report, null);
    assert.ok(/figures not in the facts/.test(body.reportError) && /9999/.test(body.reportError), body.reportError);
});

test('GET /api/vet/feedback: a cross-origin browser request is rejected; curl and the app itself are not (Critical 1)', async () => {
    setupPipeline();
    const crossSite = await fetch(`${base}/api/vet/feedback?${QS}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.strictEqual(crossSite.status, 403);
    const sameSite = await fetch(`${base}/api/vet/feedback?${QS}`, { headers: { 'Sec-Fetch-Site': 'same-site' } });
    assert.strictEqual(sameSite.status, 403, 'a related-but-different origin is still cross-origin');

    const same = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
    assert.strictEqual(same.status, 200, 'the app\'s own fetch back to itself sends Sec-Fetch-Site: same-origin');

    const curlLike = await fetch(`${base}/api/vet/feedback?${QS}`); // no Sec-Fetch-Site header at all
    assert.strictEqual(curlLike.status, 200, 'a non-browser client sends no Sec-Fetch-Site and is unaffected');
});

test('GET /api/vet/feedback: concurrent identical requests share one pipeline run (Critical 1 dedup)', async () => {
    app.__test.resetCaches();
    const s = stubQuery();
    let fightQueryCalls = 0;
    // The 15ms delay is load-bearing: without it, the first request's pipeline can finish (and
    // write the full-response cache) before the second one even starts, which would make this
    // assertion pass on nothing more than the ordinary post-completion cache — vacuously, since
    // that path exists regardless of in-flight dedup. The delay guarantees the second request's
    // cache/in-flight check runs while the first is still genuinely in flight.
    app.__test.setWclQuery(async (q, vars) => { if (q === F.FIGHT_QUERY) { fightQueryCalls++; await new Promise(r => setTimeout(r, 15)); } return s.query(q, vars); });
    app.__test.setOpenaiChat(async () => 'Solid work. Keep it up.');
    app.__test.caches.vetCache.set(IDENTITY_KEY, { at: Date.now(), profile: rotProfile() });

    const [r1, r2] = await Promise.all([
        fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN),
        fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN),
    ]);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    // One full pipeline run over this fixture analyses 2 kills plus 3 reference players on each
    // of 2 bosses = 8 fightAndTables calls (vet-feedback.test.js's own "two kills analysed" test
    // asserts the same count for PLAYER_QUERY). Without route-level dedup, the 2 own-kill calls
    // are duplicated across both requests (the 6 reference calls are still shared by
    // vet-feedback.js's own existing reference-level dedup either way) — 10, not 8. Verified by
    // temporarily disabling the in-flight map in server.js: this assertion then fails 10 !== 8.
    assert.strictEqual(fightQueryCalls, 8, 'the two concurrent requests did not each run their own pipeline');
});

test('GET /api/vet/feedback: different thresholds reuse the cached pipeline and still reflect the request (Critical 1)', async () => {
    const s = setupPipeline();
    const r1 = await fetch(`${base}/api/vet/feedback?${QS}&thresholds=${encodeURIComponent(JSON.stringify({ parse: 10 }))}`, SAME_ORIGIN);
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.headers.get('x-vet-cache'), 'miss');
    const body1 = await r1.json();
    assert.strictEqual(body1.facts.tier.threshold, 10);
    const callsAfterFirst = s.calls.length;
    assert.ok(callsAfterFirst > 0);

    const r2 = await fetch(`${base}/api/vet/feedback?${QS}&thresholds=${encodeURIComponent(JSON.stringify({ parse: 77 }))}`, SAME_ORIGIN);
    assert.strictEqual(r2.status, 200);
    const body2 = await r2.json();
    assert.strictEqual(body2.facts.tier.threshold, 77, 'the response does reflect the requested threshold');
    assert.strictEqual(s.calls.length, callsAfterFirst, 'a different thresholds value must not trigger a second WCL pipeline run');
    // fix-d: the WCL facts were reused (no new WCL calls, asserted above) but this response still
    // required its own fresh OpenAI call to reflect thresholds=77's gear findings — a paid call
    // that a bare "did the cache help" header would hide. X-Vet-Cache must report 'miss' here too,
    // not 'hit', because it is scoped to whether THIS response's model call was fresh, not to
    // whether the (unrelated) WCL pipeline was reused.
    assert.strictEqual(r2.headers.get('x-vet-cache'), 'miss',
        'a fresh model call for this request\'s own thresholds must not be reported as a cache hit, even though the WCL pipeline was reused');
});

test('GET /api/vet/feedback: a missing item table on a profile cache hit is 500 with the specific message (Minor 17)', async () => {
    app.__test.resetCaches();
    const s = stubQuery();
    app.__test.setWclQuery(s.query);
    app.__test.setOpenaiChat(async () => 'unused');
    app.__test.caches.vetCache.set(IDENTITY_KEY, { at: Date.now(), profile: rotProfile() });
    app.__test.setDbPath(path.join(__dirname, 'fixtures', 'does-not-exist.json'));
    try {
        const r = await fetch(`${base}/api/vet/feedback?${QS}`, SAME_ORIGIN);
        assert.strictEqual(r.status, 500);
        const body = await r.json();
        assert.ok(/Item table .*tbc-item-db\.json.* is missing or unreadable/.test(body.error), body.error);
    } finally {
        app.__test.setDbPath(null); // restore the real table for any test that runs after this one
    }
});

chain.then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
    srv.close();
});
