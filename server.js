const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Minimal KEY=VALUE reader for the gitignored .env (OpenAI key). No dependency, no
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
