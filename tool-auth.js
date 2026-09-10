'use strict';

// Small, process-local password gate for the single-operator raid tool.  It deliberately
// does not depend on an external session store: a restart invalidates every session.
const crypto = require('node:crypto');
const express = require('express');

const COOKIE = 'tool_session';
const MAX_ATTEMPT_BUCKETS = 10000;
const MAX_SESSIONS = 2000;
const PUBLIC_FILES = new Set([
  '/shared-evaluation.html', '/evaluation.css', '/evaluation.js',
  '/login.html', '/login.css', '/login.js',
]);
const SHARED_API = /^\/api\/shared-evaluation\/[a-f0-9]{48}$/;

function parseCookies(header) {
  const cookies = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

function isHttps(req) {
  return req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
}

function cookie(value, req, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (isHttps(req) ? '; Secure' : '');
}

function sameOrigin(req) {
  const origin = req.get('origin');
  if (origin) {
    const scheme = isHttps(req) ? 'https' : 'http';
    if (origin !== `${scheme}://${req.get('host')}`) return false;
  }
  const fetchSite = req.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin';
}

function htmlUnavailable(res) {
  res.status(503).type('html').send('<!doctype html><title>Tool unavailable</title><h1>Tool unavailable</h1><p>Administrator setup is incomplete.</p>');
}

function installToolAuth(app, options = {}) {
  if (!app || typeof app.use !== 'function') throw new TypeError('An Express app is required');
  if (options.testBypass === true) {
    if (process.env.NODE_ENV !== 'test') throw new Error('testBypass is only permitted when NODE_ENV=test');
    return { enabled: false, sessions: new Map() };
  }

  const password = options.password === undefined ? process.env.TOOL_ADMIN_PASSWORD : options.password;
  const configured = typeof password === 'string' && password.length >= 12;
  const now = options.now || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const ttlMs = options.sessionTtlMs || 12 * 60 * 60 * 1000;
  const limit = options.loginAttemptLimit || 5;
  const windowMs = options.loginAttemptWindowMs || 15 * 60 * 1000;
  const sessions = new Map();
  const attempts = new Map();
  // Fixed public salt is appropriate here: the configured secret is never persisted as a hash
  // and scrypt makes every online guess expensive before its constant-time comparison.
  const expected = configured ? crypto.scryptSync(password, 'wowstuff-tool-auth-v1', 32) : null;

  function removeExpired() {
    const time = now();
    for (const [id, entry] of sessions) if (entry.expiresAt <= time) sessions.delete(id);
    for (const [ip, entry] of attempts) if (entry.resetAt <= time) attempts.delete(ip);
  }
  function session(req) {
    removeExpired();
    const id = parseCookies(req.get('cookie'))[COOKIE];
    return id && sessions.get(id);
  }
  function api(req) { return req.path.startsWith('/api/'); }
  function unavailable(req, res) {
    if (api(req)) return res.status(503).json({ error: 'Tool unavailable' });
    return htmlUnavailable(res);
  }
  function publicRequest(req) {
    return req.method === 'GET' && (PUBLIC_FILES.has(req.path) || SHARED_API.test(req.path));
  }

  app.post('/api/tool-auth/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!configured) return unavailable(req, res);
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    if (!req.is('application/x-www-form-urlencoded')) return res.status(415).json({ error: 'Use form-encoded password data' });
    removeExpired();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const attempt = attempts.get(ip);
    if (attempt && attempt.count >= limit) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
    const actual = crypto.scryptSync(candidate, 'wowstuff-tool-auth-v1', 32);
    if (!crypto.timingSafeEqual(actual, expected)) {
      if (!attempt && attempts.size >= MAX_ATTEMPT_BUCKETS) attempts.delete(attempts.keys().next().value);
      attempts.set(ip, { count: (attempt ? attempt.count : 0) + 1, resetAt: now() + windowMs });
      return res.status(401).json({ error: 'Invalid password' });
    }
    attempts.delete(ip);
    const id = randomBytes(32).toString('base64url');
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    sessions.set(id, { expiresAt: now() + ttlMs });
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', cookie(id, req, Math.floor(ttlMs / 1000)));
    res.status(204).end();
  });

  app.post('/api/tool-auth/logout', (req, res) => {
    if (!configured) return unavailable(req, res);
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    const id = parseCookies(req.get('cookie'))[COOKIE];
    if (id) sessions.delete(id);
    res.set('Cache-Control', 'no-store');
    res.set('Set-Cookie', cookie('', req, 0));
    res.status(204).end();
  });

  app.get('/login.html', (req, res) => {
    if (!configured) return htmlUnavailable(res);
    if (session(req)) return res.redirect('/');
    res.sendFile(options.loginFile || require('node:path').join(__dirname, 'login.html'));
  });

  app.use((req, res, next) => {
    if (publicRequest(req)) return next();
    if (!configured) return unavailable(req, res);
    if (!session(req)) {
      if (api(req)) return res.status(401).json({ error: 'Authentication required' });
      return res.redirect('/login.html');
    }
    if ((api(req) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
    if (!api(req)) res.set('Cache-Control', 'no-store');
    next();
  });

  return { enabled: true, sessions, attempts, configured, now };
}

module.exports = { installToolAuth };
