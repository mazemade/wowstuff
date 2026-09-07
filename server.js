const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Minimal KEY=VALUE reader for the gitignored .env (OpenAI key, WCL client credentials). No dependency, no
// quoting rules. Real environment variables win so a deployment can override the file.
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch (err) { /* no .env is fine — the AI endpoint answers 503 */ }

// Serve static files from the current directory. index:false is load-bearing — with the
// default, express.static answers "/" with index.html before the route below ever runs.
app.use(express.static(path.join(__dirname), { index: false }));
app.use(express.json({ limit: '1mb' }));

// body-parser throws on malformed/oversized bodies before any route runs. Left to the
// default handler that becomes an HTML stack trace with filesystem paths in the response;
// every client here expects JSON, so translate it instead of letting it through. Express
// recognizes error middleware only by this four-argument signature.
app.use((err, req, res, next) => {
  if (!err || typeof err.type !== 'string' || !err.type.startsWith('entity.')) return next(err);
  res.status(err.status || err.statusCode || 400).json({ error: 'Malformed request body' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'assignments.html'));
});

// Proxy for Raid-Helper event API (their CORS policy blocks direct browser calls)
app.get('/api/raidhelper/:eventId', async (req, res) => {
  const id = req.params.eventId;
  if (!/^\d{5,25}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  try {
    const upstream = await fetch(`https://raid-helper.dev/api/event/${id}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Raid-Helper returned ${upstream.status}` });
    }
    const data = await upstream.json();
    // This endpoint reports a missing or private event as HTTP 200 with a failure envelope,
    // so an ok status alone doesn't mean we got an event.
    if (data && data.status === 'failed') {
      return res.status(404).json({ error: `Raid-Helper: ${data.reason || 'event not found'}` });
    }
    res.json(data);
  } catch (err) {
    console.error('Raid-Helper proxy failed:', err);
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Raid-Helper request timed out' });
    }
    if (err.name === 'SyntaxError') {
      return res.status(502).json({ error: 'Raid-Helper returned an invalid response' });
    }
    res.status(502).json({ error: 'Failed to reach Raid-Helper' });
  }
});

// --- Warcraft Logs proxy (client-credentials OAuth; secrets live in .env) -------------
// The classic host, NOT www: `characterData` is host-scoped and www returns character:null for
// every real Anniversary character. Verified live 2026-08-14 — www answered null for all 14
// characters probed, classic answered all of them. worldData works on either host.
const WCL_API = 'https://classic.warcraftlogs.com/api/v2/client';

let wclToken = null; // { token, expiresAt } — cached until shortly before expiry
async function getWclToken() {
  if (!process.env.WCL_CLIENT_ID || !process.env.WCL_CLIENT_SECRET) {
    const e = new Error('WCL API credentials not configured (WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env)');
    e.code = 'NO_CREDS';
    throw e;
  }
  if (wclToken && Date.now() < wclToken.expiresAt - 60000) return wclToken.token;
  const res = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.WCL_CLIENT_ID + ':' + process.env.WCL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 429) { const e = new Error('WCL rate limit reached — try again later'); e.code = 'RATE_LIMIT'; throw e; }
  if (!res.ok) throw new Error('WCL token request failed: ' + res.status);
  const data = await res.json();
  wclToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return wclToken.token;
}

async function wclQuery(query, variables) {
  const token = await getWclToken();
  const res = await fetch(WCL_API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) { const e = new Error('WCL rate limit reached — try again later'); e.code = 'RATE_LIMIT'; throw e; }
  if (!res.ok) throw new Error('WCL returned ' + res.status);
  const data = await res.json();
  if (data.errors && data.errors.length) throw new Error('WCL GraphQL: ' + data.errors[0].message);
  // WCL reports some failures as a bare `error` string at HTTP 200 with no `errors` array,
  // so a check on status and `errors` alone would read those as success.
  if (typeof data.error === 'string') throw new Error('WCL: ' + data.error);
  return data.data;
}

// A zone's encounter list is static, so resolve it once per process. worldData.zones is stale
// and omits the Anniversary tier entirely, so the zone is addressed by id and never looked up
// in the list.
const wclZoneEncounters = new Map();
async function getZoneEncounters(zone) {
  if (wclZoneEncounters.has(zone)) return wclZoneEncounters.get(zone);
  const zd = await wclQuery('query($zone:Int!){worldData{zone(id:$zone){name encounters{id name}}}}', { zone });
  const z = zd.worldData && zd.worldData.zone;
  if (!z || !Array.isArray(z.encounters) || !z.encounters.length) return null;
  wclZoneEncounters.set(zone, z.encounters);
  return z.encounters;
}

function wclErrorResponse(res, err, what) {
  console.error(what + ' failed:', err);
  if (err.code === 'NO_CREDS') return res.status(503).json({ error: err.message });
  if (err.code === 'RATE_LIMIT') return res.status(429).json({ error: err.message });
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    return res.status(504).json({ error: what + ' timed out' });
  }
  res.status(502).json({ error: what + ' failed' });
}

app.get('/api/wcl/player', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10);
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  if (!Number.isInteger(zone) || zone <= 0) return res.status(400).json({ error: 'Invalid zone id' });
  try {
    const encounters = await getZoneEncounters(zone);
    if (!encounters) return res.status(404).json({ error: 'Unknown WCL zone ' + zone });
    // One query, one alias per encounter. encounterRankings is a JSON scalar in WCL's schema,
    // so per-field selection is neither possible nor needed.
    const aliases = encounters
      .map(e => 'e' + e.id + ': encounterRankings(encounterID:' + e.id + ',metric:dps)')
      .join(' ');
    const q = 'query($name:String!,$server:String!,$region:String!){characterData{' +
      'character(name:$name,serverSlug:$server,serverRegion:$region){' + aliases + '}}}';
    const data = await wclQuery(q, { name, server, region });
    const ch = data.characterData && data.characterData.character;
    if (!ch) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    const ranksByEncounter = {};
    encounters.forEach(e => {
      const blob = ch['e' + e.id];
      ranksByEncounter[e.id] = (blob && Array.isArray(blob.ranks)) ? blob.ranks : [];
    });
    res.json({ name, ranksByEncounter });
  } catch (err) { wclErrorResponse(res, err, 'WCL player lookup'); }
});

// --- Player vetting: one profile per character from Warcraft Logs plus the committed item table.
const VetEngine = require('./vet-engine.js');
const VetProfile = require('./vet-profile.js');
const WclLogs = require('./wcl-logs.js');

const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'tbc-item-db.json');
let vetDbPath = DEFAULT_DB_PATH; // overridable only by server.test.js, via app.__test.setDbPath
let vetDbIndex = null;
function getVetDbIndex() {
  if (vetDbIndex) return vetDbIndex;
  const raw = JSON.parse(fs.readFileSync(vetDbPath, 'utf8'));
  vetDbIndex = VetEngine.indexDb(raw);
  return vetDbIndex;
}

const VET_CACHE_MS = 15 * 60 * 1000;
const vetCache = new Map(); // key -> { at, profile }

// One profile per character, cached for VET_CACHE_MS. Shared by the vetting and feedback routes.
async function loadProfile(name, server, region, zone) {
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone;
  const hit = vetCache.get(key);
  if (hit && Date.now() - hit.at < VET_CACHE_MS) return { profile: hit.profile, cached: true };
  let db;
  try { db = getVetDbIndex(); }
  catch (err) { console.error('item table load failed:', err); const e = new Error('Item table data/tbc-item-db.json is missing or unreadable'); e.code = 'NO_DB'; throw e; }
  const profile = await VetProfile.fetchProfile(wclQuery, { name, server, region, zone }, db);
  if (!profile) return { profile: null, cached: false };
  // Reclaim memory from entries the read path above already treats as misses (past VET_CACHE_MS) —
  // this is a sweep, not an eviction policy: nothing here changes what a lookup returns.
  for (const [k, v] of vetCache) if (Date.now() - v.at >= VET_CACHE_MS) vetCache.delete(k);
  vetCache.set(key, { at: Date.now(), profile });
  return { profile, cached: false };
}

// Shared by the routes added for logs-first (nights, parses, logs, roster): the same name /
// server / region / zone validation /api/vet/player and /api/vet/feedback do inline, and the
// same Sec-Fetch-Site rule /api/vet/feedback explains — page script cannot fake that header, so
// a cross-origin page cannot spend the user's WCL points through these endpoints.
function vetIdentity(req) {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return { status: 403, error: 'Cross-origin requests are not allowed' };
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return { status: 400, error: 'Invalid character name' };
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return { status: 400, error: 'Invalid server slug' };
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return { status: 400, error: 'Invalid region' };
  return { name, server, region, zone, key: region + '/' + server + '/' + name.toLowerCase() + '/' + zone };
}

app.get('/api/vet/player', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  try {
    const { profile, cached } = await loadProfile(name, server, region, zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    res.set('X-Vet-Cache', cached ? 'hit' : 'miss');
    res.json(profile);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL vetting lookup');
  }
});

// Parse feedback report: measured facts from WCL plus a deterministic checklist report rendered
// straight from those facts (vet-checklist.js) — no model call, so no failure mode to report.
const VetFeedback = require('./vet-feedback.js');
const FEEDBACK_CACHE_MS = 15 * 60 * 1000;
const feedbackCache = new Map();     // key(identity only, see Critical 1 below) -> { at, facts, thresholdsKey, body }
const feedbackInFlight = new Map();  // key(identity only) -> pending Promise<facts>, so concurrent requests share one pipeline run
const feedbackRefCache = new Map();  // shared reference cache, see getReference in vet-feedback.js

app.get('/api/vet/feedback', async (req, res) => {
  // Critical (whole-branch review): unlike /api/ai-review below, this is a plain GET — it needs
  // no preflight and no CORS-triggering header, so any page the user has open (or a bare
  // `<img src>`) could fire it at will. The reply is unreadable to the caller, but each cold hit
  // still burns up to ~360 WCL rate-limit points, and the URL is discoverable straight from the
  // public vetting.js. A GET can't be
  // gated on Content-Type the way /api/ai-review is, so gate on Sec-Fetch-Site instead: the
  // browser sets this itself and page script cannot override it. 'same-origin' is what the
  // app's own page sends when it fetches this endpoint back on itself; a third-party origin (or
  // an <img> it embeds) sends 'cross-site' (or 'same-site' for a related-but-different origin).
  // Non-browser clients — curl, server-to-server calls — send no Sec-Fetch-Site at all and pass
  // through untouched.
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return res.status(403).json({ error: 'Cross-origin requests are not allowed' });

  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  // v2 §5.2: an optional raid night. WCL report codes are 16 alphanumerics.
  const report = req.query.report ? String(req.query.report) : null;
  if (report && !/^[A-Za-z0-9]{16}$/.test(report)) return res.status(400).json({ error: 'Invalid report code' });
  let thresholds = {};
  if (req.query.thresholds) {
    try { thresholds = JSON.parse(String(req.query.thresholds)); } catch (e) { return res.status(400).json({ error: 'Invalid thresholds' }); }
  }
  thresholds = VetEngine.parseThresholds(thresholds);
  const thresholdsKey = JSON.stringify(thresholds);
  // Critical (whole-branch review): `thresholds` only ever changes gearFindings below, never the
  // WCL fetch — but parseThresholds whitelists keys, not values, so `?thresholds={"gs":1}`,
  // `{"gs":2}`, ... used to mint unlimited distinct cache keys, each a guaranteed cold ~180-point
  // pipeline run swept only by age. The cache and the in-flight map below are keyed on identity
  // alone; thresholds are reapplied to the (possibly cached or shared) facts after the expensive
  // WCL part is already done, so no choice of thresholds can force a repeat fetch. The night
  // (report code) is part of the identity: a night's sheet and the across-kills sheet are
  // different pipeline runs.
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone + '/' + (report ? 'night/' + report : 'all');
  try {
    const { profile } = await loadProfile(name, server, region, zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    if (!profile.parses) return res.status(404).json({ error: 'No parses to analyse' });

    const hit = feedbackCache.get(key);
    const fresh = !!hit && Date.now() - hit.at < FEEDBACK_CACHE_MS;
    if (fresh && hit.thresholdsKey === thresholdsKey) { res.set('X-Vet-Cache', 'hit'); return res.json(hit.body); }

    let facts;
    if (fresh) {
      facts = hit.facts; // same identity, different thresholds — the WCL pipeline is reused as-is
    } else {
      // Critical (whole-branch review): in-flight dedup. Without this, N concurrent requests for
      // the same player each ran their own full pipeline, since feedbackCache was only written
      // after one completed. Keyed the same as feedbackCache (identity only, see above); the
      // entry is removed on both success and failure so a rejected pipeline can't poison the key
      // for the next request — the same shape as getReference's pending map in vet-feedback.js.
      let pending = feedbackInFlight.get(key);
      if (!pending) {
        // Minor 17 (whole-branch review): on a profile *cache hit* above, loadProfile returns
        // before ever touching the item db, so a missing/unreadable table would otherwise
        // surface for the first time here as the generic 502 wclErrorResponse gives everything
        // else, instead of the specific 500 + message /api/vet/player gives it. Map it the same
        // way loadProfile does.
        let dbIndex;
        try { dbIndex = getVetDbIndex(); }
        catch (err) { console.error('item table load failed:', err); const e = new Error('Item table data/tbc-item-db.json is missing or unreadable'); e.code = 'NO_DB'; throw e; }
        pending = VetFeedback.fetchFeedback(wclQuery, { profile, dbIndex, refCache: feedbackRefCache, thresholds: {}, now: Date.now(), report });
        feedbackInFlight.set(key, pending);
        // `.finally()` returns its own promise that also rejects when `pending` does; nobody
        // else holds a reference to it, so an uncaught rejection there would crash the process
        // even though `pending` itself (awaited below, by every caller) is handled correctly.
        pending.finally(() => feedbackInFlight.delete(key)).catch(() => {});
      }
      facts = await pending;
      if (!facts) return res.status(404).json({ error: 'No kills to analyse' });
      if (facts.noKills) return res.status(404).json({ error: 'No kills in that report' });
    }

    // Reapply this request's own thresholds to the (possibly reused/shared) facts: gearFindings
    // and its effect on the checklist are the only things thresholds ever change (see the
    // cache-key comment above) — everything else in `facts` is thresholds-independent.
    // v4: gear rows depend on the request's thresholds, so the checklist and the text are rebuilt
    // here on the (possibly cached) sheet. No model: the text is rendered from the checklist.
    const gear = VetFeedback.gearFindings(profile, thresholds, Date.now());
    facts = Object.assign({}, facts, { tier: Object.assign({}, facts.tier, { threshold: thresholds.parse }), gear: Object.assign({}, facts.gear, { findings: gear }) });
    facts.overall = Object.assign({}, facts.overall, { checklist: VetFeedback.Checklist.buildChecklist(facts, VetFeedback.T) });
    const body = { facts, report: VetFeedback.Checklist.renderReport(facts.overall.checklist, facts), generatedAt: new Date().toISOString() };
    for (const [k, v] of feedbackCache) if (Date.now() - v.at >= FEEDBACK_CACHE_MS) feedbackCache.delete(k);
    feedbackCache.set(key, { at: Date.now(), facts, thresholdsKey, body });
    // X-Vet-Cache: 'hit' is the early return above, serving a stored body unchanged. 'miss' means
    // the sheet was (re)built here — either a cold WCL pipeline run, or (same identity, different
    // thresholds — see Critical 1 above) a reused WCL sheet whose checklist/report were rebuilt
    // for this request's own thresholds.
    res.set('X-Vet-Cache', 'miss');
    res.json(body);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL feedback lookup');
  }
});

// logs-first A3: the night picker on its own. Profile (cached) + one encounterRankings request.
const nightsCache = new Map(); // identity key + '/nights' -> { at, body }
app.get('/api/vet/nights', async (req, res) => {
  const id = vetIdentity(req);
  if (id.error) return res.status(id.status).json({ error: id.error });
  const key = id.key + '/nights';
  try {
    const hit = nightsCache.get(key);
    if (hit && Date.now() - hit.at < FEEDBACK_CACHE_MS) { res.set('X-Vet-Cache', 'hit'); return res.json(hit.body); }
    const { profile } = await loadProfile(id.name, id.server, id.region, id.zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    const body = await VetFeedback.fetchNights(wclQuery, { profile });
    for (const [k, v] of nightsCache) if (Date.now() - v.at >= FEEDBACK_CACHE_MS) nightsCache.delete(k);
    nightsCache.set(key, { at: Date.now(), body });
    res.set('X-Vet-Cache', 'miss');
    res.json(body);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL nights lookup');
  }
});

// --- logs-first B3: vet a whole raid from the log it was in.
const LOGS_CACHE_MS = 5 * 60 * 1000;
const logsCache = new Map();   // region/server/guild -> { at, body }
const rosterCache = new Map(); // code/zone/fallbackServer/fallbackRegion -> { at, body }
const parsesCache = new Map(); // identity key + '/parses/' + class + '/' + talents -> { at, body }
function cachedJson(cache, key, ttl, res) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= ttl) return false;
  res.set('X-Vet-Cache', 'hit'); res.json(hit.body);
  return true;
}
function storeJson(cache, key, ttl, res, body) {
  for (const [k, v] of cache) if (Date.now() - v.at >= ttl) cache.delete(k);
  cache.set(key, { at: Date.now(), body });
  res.set('X-Vet-Cache', 'miss'); res.json(body);
}

// The guild's recent raid nights — the log picker. One WCL request.
app.get('/api/wcl/logs', async (req, res) => {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  const guild = String(req.query.guild || '').trim();
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  if (!/^[^\/\\"]{2,48}$/.test(guild)) return res.status(400).json({ error: 'Invalid guild name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  const key = region + '/' + server + '/' + guild.toLowerCase();
  try {
    if (cachedJson(logsCache, key, LOGS_CACHE_MS, res)) return;
    const logs = await WclLogs.fetchGuildReports(wclQuery, { guild, server, region, limit: 15 });
    storeJson(logsCache, key, LOGS_CACHE_MS, res, { logs });
  } catch (err) { wclErrorResponse(res, err, 'WCL guild logs lookup'); }
});

// Everyone in one report, each as a profile with scored gear and parses pending. Two WCL requests
// for a whole raid — versus four per player through /api/vet/player.
app.get('/api/wcl/log/:code/roster', async (req, res) => {
  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  const code = String(req.params.code || '');
  if (!/^[A-Za-z0-9]{16}$/.test(code)) return res.status(400).json({ error: 'Invalid report code' });
  const zone = parseInt(req.query.zone, 10) || 1060;
  const fallbackServer = String(req.query.server || '').toLowerCase();
  const fallbackRegion = String(req.query.region || 'eu').toLowerCase();
  if (fallbackServer && !/^[a-z0-9-]{2,40}$/.test(fallbackServer)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(fallbackRegion)) return res.status(400).json({ error: 'Invalid region' });
  // Fix round 1 (Important finding on 4ffc815): fallbackServer/fallbackRegion are baked into the
  // cached body (server/region below fall back to them for a guild-less report), so they must be
  // part of the key too — else the first caller's realm sticks to every later, differently-scoped one.
  const key = code + '/' + zone + '/' + fallbackServer + '/' + fallbackRegion;
  try {
    if (cachedJson(rosterCache, key, FEEDBACK_CACHE_MS, res)) return;
    let db;
    try { db = getVetDbIndex(); }
    catch (err) { console.error('item table load failed:', err); return res.status(500).json({ error: 'Item table data/tbc-item-db.json is missing or unreadable' }); }
    const roster = await WclLogs.fetchReportRoster(wclQuery, { code });
    if (!roster) return res.status(404).json({ error: 'Warcraft Logs could not open report ' + code });
    const region = (roster.guild && roster.guild.region) || fallbackRegion;
    const players = roster.players.map(p => VetProfile.profileFromCombatant({
      name: p.name, server: p.server || fallbackServer, region, zone, classToken: p.classToken, combatant: p.combatant,
      report: { code, startTime: roster.startTime, fightName: p.fightName }, dbIndex: db }));
    storeJson(rosterCache, key, FEEDBACK_CACHE_MS, res, {
      report: { code, title: roster.title, date: roster.date, zone: roster.zone, guild: roster.guild, fights: roster.fights }, players });
  } catch (err) { wclErrorResponse(res, err, 'WCL report roster lookup'); }
});

// The parses half of a profile for a player the page already has gear for. Optional class and
// talents (from the report's CombatantInfo) let spec detection skip the WCL-label fallback.
app.get('/api/vet/parses', async (req, res) => {
  const id = vetIdentity(req);
  if (id.error) return res.status(id.status).json({ error: id.error });
  const classToken = req.query.class ? String(req.query.class).toUpperCase() : null;
  if (classToken && !/^[A-Z]{4,8}$/.test(classToken)) return res.status(400).json({ error: 'Invalid class' });
  let talentSplit = null;
  if (req.query.talents) {
    talentSplit = String(req.query.talents).split(',').map(n => parseInt(n, 10));
    if (talentSplit.length !== 3 || talentSplit.some(n => !Number.isInteger(n) || n < 0 || n > 61)) return res.status(400).json({ error: 'Invalid talents' });
  }
  // Fix round 2 (Important): class and talents change the RESPONSE — fetchRankings picks dps vs
  // hps from them and identity echoes talentSplit — so they must be part of the key. Without them
  // a respec inside the 15-minute TTL serves the previous spec's metric under the new spec's row.
  const key = id.key + '/parses/' + (classToken || '') + '/' + (talentSplit ? talentSplit.join(',') : '');
  try {
    if (cachedJson(parsesCache, key, FEEDBACK_CACHE_MS, res)) return;
    const rk = await VetProfile.fetchRankings(wclQuery, { name: id.name, server: id.server, region: id.region, zone: id.zone, classToken, talentSplit });
    const parses = VetProfile.buildParses(rk.rankings, rk.rankingsZone, rk.fallback, rk.metric, rk.otherRankings, rk.otherZone);
    const identity = { class: classToken, spec: rk.det.spec, role: rk.det.role, talentSplit, detectedFrom: rk.det.detectedFrom };
    storeJson(parsesCache, key, FEEDBACK_CACHE_MS, res, { parses, identity });
  } catch (err) { wclErrorResponse(res, err, 'WCL parses lookup'); }
});

// Advisory AI second opinion on the whole assignment sheet. The client sends its live
// state; we wrap it in a system prompt that states the Anniversary rules so the model
// cannot repeat the rule-ignorant critiques a bare ChatGPT produces. Display-only:
// nothing here ever mutates an assignment.
// The Anniversary-realm rules the model prompt below must state, so it does not repeat the
// rule-ignorant critiques a bare ChatGPT produces.
const ANNIVERSARY_RULES = [
  '- Bloodlust/Heroism is RAID-wide (10-minute Sated-style debuff). It is never a reason to group anyone.',
  '- Everything else is party-scoped: all shaman totems, paladin auras, Battle Shout, Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration, Vampiric Touch, Mana Tide, Blood Pact, and draenei presences.',
  '- A shaman runs only ONE air totem at a time: Windfury, Grace of Air and Wrath of Air are all air totems.',
  '- Windfury Totem does not affect shapeshifted druids or hunters, and enhancement shamans use their own weapon imbues instead.',
];
const AI_SYSTEM_PROMPT = [
  'You are reviewing a World of Warcraft TBC Anniversary-realm raid assignment sheet.',
  'Anniversary rules you must respect (they differ from original TBC):',
].concat(ANNIVERSARY_RULES, [
  '- Party mana buffs (Vampiric Touch, Mana Spring, Mana Tide) scale strongly with fight length. The payload includes fightLengthSec, and the layout weights already assume it — do not suggest mana-motivated regrouping beyond what the sheet shows unless the actual fight is much longer than fightLengthSec.',
  '- A non-enhancement shaman grouped with melee is expected to drop Windfury as baseline; the group notes say which totem each group gets.',
  'Critique the group layout, debuff assignments, blessings and uncovered list as an advisory second opinion.',
  'Suggest concrete swaps where they genuinely help; say so if the sheet is already sound.',
  'Under 400 words. Plain text, no markdown headings.',
]).join('\n');

// One chat completion. Errors carry a code so routes can map them to a status without
// re-deriving it from the message.
async function openaiChat(system, user, timeoutMs) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('No OPENAI_API_KEY configured — put it in .env next to server.js'); e.code = 'NO_KEY'; throw e; }
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    const msg = (data && data.error && data.error.message) || `OpenAI returned ${upstream.status}`;
    console.error('OpenAI upstream error:', upstream.status, msg);
    const e = new Error(`OpenAI returned ${upstream.status}`); e.code = 'UPSTREAM'; throw e;
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) { const e = new Error('OpenAI returned an empty response'); e.code = 'UPSTREAM'; throw e; }
  return text;
}

app.post('/api/ai-review', async (req, res) => {
  // A text/plain or form-urlencoded POST is a CORS simple request: no preflight, so any
  // page the user has open could fire one at this endpoint and burn the paid API key even
  // though it can't read the reply. express.json() silently skips non-JSON bodies and
  // leaves req.body as {}, so without this check the key check below would still run.
  // Requiring application/json forces a preflight, which fails here since we send no CORS
  // headers — that closes the hole.
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Expected application/json' });
  }
  try {
    const text = await openaiChat(AI_SYSTEM_PROMPT, `Review this sheet:\n${JSON.stringify(req.body)}`, 180000);
    res.json({ review: text });
  } catch (err) {
    if (err.code === 'NO_KEY') return res.status(503).json({ error: err.message });
    if (err.code === 'UPSTREAM') return res.status(502).json({ error: err.message });
    console.error('AI review failed:', err);
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return res.status(504).json({ error: 'OpenAI request timed out' });
    res.status(502).json({ error: 'Failed to reach OpenAI' });
  }
});

// Unknown routes land on the tool rather than the old hub
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'assignments.html'));
});

// Only bind a real port when this file is run directly (`npm start` / `node server.js`).
// server.test.js requires this module to get `app` and drives it with Node's own `http`
// against an ephemeral port instead, so requiring it must never also start listening.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Test-only seams (server.test.js). wclQuery/openaiChat are plain function declarations, so
// every route above resolves them as free variables at call time — reassigning the bindings
// here is enough to stub both without touching any call site or adding a dependency. Nothing
// outside server.test.js calls app.__test; production never mutates any of this.
app.__test = {
  setWclQuery(fn) { wclQuery = fn; },
  setOpenaiChat(fn) { openaiChat = fn; },
  setDbPath(p) { vetDbPath = p || DEFAULT_DB_PATH; vetDbIndex = null; },
  resetCaches() { vetCache.clear(); feedbackCache.clear(); feedbackInFlight.clear(); feedbackRefCache.clear(); nightsCache.clear(); logsCache.clear(); rosterCache.clear(); parsesCache.clear(); },
  caches: { vetCache, feedbackCache, feedbackInFlight, feedbackRefCache, nightsCache, logsCache, rosterCache, parsesCache },
};

module.exports = app;
