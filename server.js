const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory. index:false is load-bearing — with the
// default, express.static answers "/" with index.html before the route below ever runs.
app.use(express.static(path.join(__dirname), { index: false }));

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

// Unknown routes land on the tool rather than the old hub
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'assignments.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
