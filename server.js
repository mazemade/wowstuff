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

// The site is the raid assignments tool. The older fight pages still exist and still work
// at their own URLs (/gruul.html, /magtheridon.html, /ssc.html, /index.html); they are just
// no longer what you land on.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'assignments.html'));
});

app.get('/gruul.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'gruul.html'));
});

app.get('/magtheridon.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'magtheridon.html'));
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

// Advisory AI second opinion on the whole assignment sheet. The client sends its live
// state; we wrap it in a system prompt that states the Anniversary rules so the model
// cannot repeat the rule-ignorant critiques a bare ChatGPT produces. Display-only:
// nothing here ever mutates an assignment.
const AI_SYSTEM_PROMPT = [
  'You are reviewing a World of Warcraft TBC Anniversary-realm raid assignment sheet.',
  'Anniversary rules you must respect (they differ from original TBC):',
  '- Bloodlust/Heroism is RAID-wide (10-minute Sated-style debuff). It is never a reason to group anyone.',
  '- Everything else is party-scoped: all shaman totems, paladin auras, Battle Shout, Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration, Vampiric Touch, Mana Tide, Blood Pact, and draenei presences.',
  '- A shaman runs only ONE air totem at a time: Windfury, Grace of Air and Wrath of Air are all air totems.',
  '- Windfury Totem does not affect shapeshifted druids or hunters, and enhancement shamans use their own weapon imbues instead.',
  '- A non-enhancement shaman grouped with melee is expected to drop Windfury as baseline; the group notes say which totem each group gets.',
  'Critique the group layout, debuff assignments, blessings and uncovered list as an advisory second opinion.',
  'Suggest concrete swaps where they genuinely help; say so if the sheet is already sound.',
  'Under 400 words. Plain text, no markdown headings.',
].join('\n');

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
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'No OPENAI_API_KEY configured — put it in .env next to server.js' });
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Review this sheet:\n${JSON.stringify(req.body)}` },
        ],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `OpenAI returned ${upstream.status}`;
      console.error('AI review upstream error:', upstream.status, msg);
      return res.status(502).json({ error: `OpenAI returned ${upstream.status}` });
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return res.status(502).json({ error: 'OpenAI returned an empty response' });
    res.json({ review: text });
  } catch (err) {
    console.error('AI review failed:', err);
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'OpenAI request timed out' });
    }
    res.status(502).json({ error: 'Failed to reach OpenAI' });
  }
});

// Unknown routes land on the tool rather than the old hub
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'assignments.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
