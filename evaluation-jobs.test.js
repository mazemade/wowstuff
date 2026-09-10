'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { EvaluationJobs, validateIdentity, installEvaluationRoutes } = require('./evaluation-jobs.js');
const identity = { name: 'Warrior', server: 'spineshatter', region: 'eu', zone: 1060, report: 'abcdefghijklmnop' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function done(jobs, id) {
    for (let i = 0; i < 200; i++) { const j = await jobs.get(id); if (['complete', 'failed'].includes(j.status)) return j; await delay(5); }
    throw new Error('job did not finish');
}
async function temp(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evaluation-jobs-test-'));
    t.after(async () => { await delay(20); await fs.rm(directory, { recursive: true, force: true }); });
    return directory;
}

test('identity validation rejects invalid report paths and arbitrary input objects', () => {
    assert.throws(() => validateIdentity({ ...identity, report: '../secret' }));
    assert.throws(() => validateIdentity({ ...identity, name: { text: 'Warrior' } }));
    assert.throws(() => validateIdentity({ ...identity, zone: 'NaN' }));
    assert.equal(validateIdentity(identity).name, 'Warrior');
});

test('concurrent identical requests share one job and completed results survive restart', async t => {
    const directory = await temp(t); let builds = 0;
    const jobs = new EvaluationJobs({}, { directory, build: async () => { builds++; await delay(20); return { fights: [] }; } });
    const [a, b] = await Promise.all([jobs.start(identity), jobs.start(identity)]);
    assert.equal(a.id, b.id);
    assert.equal((await done(jobs, a.id)).status, 'complete'); assert.equal(builds, 1);
    const restarted = new EvaluationJobs({}, { directory, build: async () => { throw new Error('must not rerun'); } });
    assert.equal((await restarted.start(identity)).status, 'complete');
    assert.equal(await restarted.get('../../private'), null);
});

test('queue bounds concurrent distinct requests and serializes jobs', async t => {
    const directory = await temp(t); let release;
    const gate = new Promise(resolve => { release = resolve; });
    const jobs = new EvaluationJobs({}, { directory, maxPending: 1, build: async () => { await gate; return { fights: [] }; } });
    const pending = await Promise.allSettled([jobs.start(identity), jobs.start({ ...identity, name: 'Other' })]);
    assert.equal(pending.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(pending.find(x => x.status === 'rejected').reason.status, 429);
    release(); await done(jobs, pending.find(x => x.status === 'fulfilled').value.id);
});

test('failed jobs can retry and never return upstream secret payloads', async t => {
    const directory = await temp(t); let builds = 0;
    const jobs = new EvaluationJobs({}, { directory, build: async () => { if (!builds++) throw new Error('token=secret'); return { fights: [] }; } });
    const a = await jobs.start(identity), failed = await done(jobs, a.id);
    assert.equal(failed.status, 'failed'); assert.doesNotMatch(failed.error, /secret/);
    const retry = await jobs.start(identity); assert.equal((await done(jobs, retry.id)).status, 'complete');
});

test('query errors are not cached; successful evidence is reused', async t => {
    const directory = await temp(t); let calls = 0;
    const jobs = new EvaluationJobs({ query: async () => { if (!calls++) throw new Error('timeout'); return { reportData: { report: { fights: [] } } }; } }, { directory });
    await assert.rejects(jobs.cachedQuery('query', {}));
    await jobs.cachedQuery('query', {}); await jobs.cachedQuery('query', {});
    assert.equal(calls, 2);
});

test('malformed event pages do not poison retries for incomplete evidence', async t => {
    const directory = await temp(t); let calls = 0;
    const jobs = new EvaluationJobs({ query: async () => ({ reportData: { report: { events: calls++ ? { data: [], nextPageTimestamp: null } : null } } }) }, { directory });
    assert.equal((await jobs.cachedQuery('events', {})).reportData.report.events, null);
    assert.deepEqual((await jobs.cachedQuery('events', {})).reportData.report.events.data, []);
    assert.equal(calls, 2);
});

test('API rejects cross-origin/form writes and returns a pollable background job', async t => {
    const directory = await temp(t), app = express(); app.use(express.json());
    installEvaluationRoutes(app, {}, { directory, build: async () => ({ fights: [] }) });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/api/vet/evaluation';
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify(identity) })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', body: 'name=Warrior' })).status, 415);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
    assert.equal(response.status, 202);
    const job = await response.json(); assert.match(job.id, /^[a-f0-9]{32}$/);
    const poll = await fetch(url + '/' + job.id); assert.equal(poll.status, 200);
    assert.equal((await fetch(url + '/missing')).status, 404);
    await delay(30);
});

test('direct report identity accepts source or name without rankings and validates model inputs', () => {
    assert.equal(validateIdentity({ report: identity.report, sourceId: 4, fightId: 38 }).sourceId, 4);
    assert.equal(validateIdentity({ report: identity.report, name: 'Culuneta' }).name, 'Culuneta');
    assert.throws(() => validateIdentity({ report: identity.report }), /player name or source/);
    assert.throws(() => validateIdentity({ ...identity, fightId: -1 }), /fightId/);
    assert.throws(() => validateIdentity({ ...identity, sourceId: {} }), /sourceId/);
    assert.throws(() => validateIdentity({ ...identity, modelOverrides: { execute: 'bad' } }), /Unknown model/);
    assert.throws(() => validateIdentity({ ...identity, modelOverrides: { talentsString: 'arbitrary code' } }), /talent string/);
    assert.deepEqual(validateIdentity({ ...identity, modelOverrides: { race: 'Orc', talentsString: '3400502130201-05050005505012050115-' } }).modelOverrides, { race: 'Orc', talentsString: '3400502130201-05050005505012050115-' });
});
test('fight, source and exact model settings distinguish cached jobs', async t => {
    const jobs = new EvaluationJobs({}, { directory: await temp(t), maxPending: 6, build: async () => ({ fights: [] }) });
    const inputs = [{ ...identity, fightId: 38, sourceId: 4 }, { ...identity, fightId: 52, sourceId: 4 }, { ...identity, fightId: 38, sourceId: 7 }, { ...identity, fightId: 38, sourceId: 4, modelOverrides: { race: 'Troll' } }];
    const results = await Promise.all(inputs.map(i => jobs.start(i)));
    assert.equal(new Set(results.map(r => r.id)).size, 4);
    for (const result of results) await done(jobs, result.id);
});

test('a partially fulfilled role query is not cached as complete evidence', async t => {
    const { ROLE_PLAYER_QUERY } = require('./evaluation-service'); let calls = 0;
    const jobs = new EvaluationJobs({ query: async () => ({ reportData: { report: calls++ ? { healing: { data: { entries: [] } }, damageTaken: { data: { entries: [] } } } : { healing: { data: { entries: [] } } } } }) }, { directory: await temp(t) });
    await jobs.cachedQuery(ROLE_PLAYER_QUERY, {}); await jobs.cachedQuery(ROLE_PLAYER_QUERY, {}); await jobs.cachedQuery(ROLE_PLAYER_QUERY, {});
    assert.equal(calls, 2);
});
test('explicit zero raid zones are rejected instead of becoming the default', () => {
    assert.throws(() => validateIdentity({ ...identity, zone: 0 }), /raid zone/);
    assert.throws(() => validateIdentity({ ...identity, zone: '0' }), /raid zone/);
});
