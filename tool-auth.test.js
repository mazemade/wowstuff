'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { installToolAuth } = require('./tool-auth.js');

let passed = 0, failed = 0;
let chain = Promise.resolve();
async function withApp(options, run) {
  const app = express();
  const auth = installToolAuth(app, options);
  app.get('/', (req, res) => res.type('html').send('tool'));
  app.get('/shared-evaluation.html', (req, res) => res.type('html').send('shared'));
  app.get('/evaluation.css', (req, res) => res.type('css').send('css'));
  app.get('/evaluation.js', (req, res) => res.type('js').send('js'));
  app.get('/api/shared-evaluation/:token', (req, res) => res.json({ shared: true }));
  app.get('/api/private', (req, res) => res.json({ private: true }));
  app.post('/api/private', (req, res) => res.status(201).json({ changed: true }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ base, auth }); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function request(base, path, options = {}) { return fetch(base + path, { redirect: 'manual', ...options }); }
function test(name, fn) {
  chain = chain.then(async () => {
    try { await fn(); passed++; console.log('ok -', name); }
    catch (err) { failed++; console.error('FAIL -', name, '\n   ', err.stack || err.message); }
  });
}

test('unauthenticated pages and source paths redirect while APIs return JSON 401', async () => {
  await withApp({ password: 'correct horse battery staple' }, async ({ base }) => {
    const page = await request(base, '/');
    assert.strictEqual(page.status, 302); assert.strictEqual(page.headers.get('location'), '/login.html');
    const api = await request(base, '/api/private');
    assert.strictEqual(api.status, 401); assert.deepStrictEqual(await api.json(), { error: 'Authentication required' });
    const source = await request(base, '/tool-auth.js');
    assert.strictEqual(source.status, 302); assert.strictEqual(source.headers.get('location'), '/login.html');
  });
});

test('only the explicit shared files and a 48-hex shared API URL are public', async () => {
  await withApp({ password: 'correct horse battery staple' }, async ({ base }) => {
    assert.strictEqual((await request(base, '/shared-evaluation.html')).status, 200);
    assert.strictEqual((await request(base, '/evaluation.css')).status, 200);
    assert.strictEqual((await request(base, '/evaluation.js')).status, 200);
    assert.strictEqual((await request(base, '/api/shared-evaluation/' + 'a'.repeat(48))).status, 200);
    assert.strictEqual((await request(base, '/api/shared-evaluation/not-a-token')).status, 401);
    assert.strictEqual((await request(base, '/assignments.html')).status, 302);
  });
});

test('wrong passwords throttle and a successful password creates an HttpOnly Lax session', async () => {
  await withApp({ password: 'correct horse battery staple', loginAttemptLimit: 2 }, async ({ base }) => {
    for (let i = 0; i < 2; i++) {
      const r = await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'wrong password value' }) });
      assert.strictEqual(r.status, 401);
    }
    const blocked = await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'correct horse battery staple' }) });
    assert.strictEqual(blocked.status, 429);
  });
  await withApp({ password: 'correct horse battery staple' }, async ({ base }) => {
    const login = await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'correct horse battery staple' }) });
    assert.strictEqual(login.status, 204);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    assert.strictEqual((await request(base, '/', { headers: { cookie } })).status, 200);
  });
});

test('sessions expire, mutations require same-origin signals, and logout invalidates the session', async () => {
  let time = 1_000;
  await withApp({ password: 'correct horse battery staple', now: () => time, sessionTtlMs: 1000 }, async ({ base }) => {
    const login = await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'correct horse battery staple' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const cross = await request(base, '/api/private', { method: 'POST', headers: { cookie, origin: 'https://attacker.invalid' } });
    assert.strictEqual(cross.status, 403);
    const crossGet = await request(base, '/api/private', { headers: { cookie, 'sec-fetch-site': 'cross-site' } });
    assert.strictEqual(crossGet.status, 403, 'cross-site navigation cannot spend upstream API quota');
    assert.strictEqual((await request(base, '/api/shared-evaluation/' + 'a'.repeat(48), { headers: { cookie, 'sec-fetch-site': 'cross-site' } })).status, 200);
    const good = await request(base, '/api/private', { method: 'POST', headers: { cookie, origin: base } });
    assert.strictEqual(good.status, 201);
    const logout = await request(base, '/api/tool-auth/logout', { method: 'POST', headers: { cookie, origin: base } });
    assert.strictEqual(logout.status, 204);
    assert.strictEqual((await request(base, '/api/private', { headers: { cookie } })).status, 401);
    const login2 = await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'correct horse battery staple' }) });
    const cookie2 = login2.headers.get('set-cookie').split(';')[0];
    time += 1001;
    assert.strictEqual((await request(base, '/', { headers: { cookie: cookie2 } })).status, 302);
  });
});

test('an unconfigured password fails closed without a default credential', async () => {
  await withApp({ password: '' }, async ({ base }) => {
    assert.strictEqual((await request(base, '/')).status, 503);
    assert.strictEqual((await request(base, '/login.html')).status, 503);
    assert.strictEqual((await request(base, '/api/private')).status, 503);
    assert.strictEqual((await request(base, '/api/tool-auth/login', { method: 'POST', body: new URLSearchParams({ password: 'anything' }) })).status, 503);
  });
});

chain.then(() => {
  if (failed) process.exitCode = 1;
  else console.log(`\n${passed} tool auth tests passed`);
});
