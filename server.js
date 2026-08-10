const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Serve specific pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
    const upstream = await fetch(`https://raid-helper.dev/api/v2/events/${id}`, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Raid-Helper returned ${upstream.status}` });
    }
    res.json(await upstream.json());
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

// Serve index.html for other routes (fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
