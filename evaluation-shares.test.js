'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { EvaluationShares, TOKEN } = require('./evaluation-shares.js');
const { installEvaluationRoutes } = require('./evaluation-jobs.js');

const identity = { name: 'Warrior', server: 'spineshatter', region: 'eu', zone: 1060, report: 'abcdefghijklmnop' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function temporary(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evaluation-shares-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}
async function complete(jobs, id) {
    for (let i = 0; i < 100; i++) {
        const job = await jobs.get(id);
        if (job?.status === 'complete') return job;
        await delay(5);
    }
    throw new Error('evaluation did not complete');
}

test('share snapshots survive restart and preserve the completed result', async t => {
    const directory = await temporary(t);
    const first = new EvaluationShares({ directory });
    const result = { player: { name: 'Warrior' }, fights: [{ name: 'Anetheron', score: 42 }] };
    const token = await first.create(result);
    assert.match(token, TOKEN);
    assert.equal(token.length, 48);
    result.fights[0].score = 999;
    const restarted = new EvaluationShares({ directory });
    assert.deepEqual(await restarted.get(token), { player: { name: 'Warrior' }, fights: [{ name: 'Anetheron', score: 42 }] });
    const stat = await fs.stat(path.join(directory, token + '.json'));
    assert.equal(stat.mode & 0o777, 0o600);
});

test('share API stores only completed server-owned result snapshots', async t => {
    const root = await temporary(t), jobsDirectory = path.join(root, 'jobs'), sharesDirectory = path.join(root, 'shares');
    const app = express(); app.use(express.json());
    let builds = 0;
    const jobs = installEvaluationRoutes(app, {}, { directory: jobsDirectory, shareDirectory: sharesDirectory, build: async () => ({ player: { name: 'Warrior' }, fights: [{ name: 'Anetheron', score: ++builds === 1 ? 42 : 99 }] }) });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const pending = await jobs.start(identity);
    const before = await fetch(base + '/api/vet/evaluation/' + pending.id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: { player: { name: 'Attacker' } } }) });
    assert.equal(before.status, 404);
    await complete(jobs, pending.id);
    const shared = await fetch(base + '/api/vet/evaluation/' + pending.id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ result: { player: { name: 'Attacker' } }, token: 'chosen-by-client' }) });
    assert.equal(shared.status, 201);
    const link = await shared.json();
    assert.match(link.token, TOKEN);
    assert.equal(link.url, '/shared-evaluation.html#' + link.token);
    const read = await fetch(base + '/api/shared-evaluation/' + link.token);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(read.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(read.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(await read.json(), { result: { player: { name: 'Warrior' }, fights: [{ name: 'Anetheron', score: 42 }] } });
    await complete(jobs, (await jobs.start(identity, true)).id);
    assert.equal((await jobs.get(pending.id)).result.fights[0].score, 99);
    assert.deepEqual(await (await fetch(base + '/api/shared-evaluation/' + link.token)).json(), { result: { player: { name: 'Warrior' }, fights: [{ name: 'Anetheron', score: 42 }] } });
});

test('share read rejects malformed and missing tokens without disclosure', async t => {
    const directory = await temporary(t), app = express();
    const shares = new EvaluationShares({ directory });
    const jobs = { get: async () => null };
    const allowed = () => true;
    require('./evaluation-shares.js').installEvaluationShareRoutes(app, jobs, allowed, { shares });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/shared-evaluation/';
    const malformed = await fetch(base + '..%2Fsecret');
    const missing = await fetch(base + 'a'.repeat(48));
    assert.equal(malformed.status, 404); assert.equal(missing.status, 404);
    assert.deepEqual(await malformed.json(), await missing.json());
    assert.equal(await shares.get('a'.repeat(32)), null);
});
