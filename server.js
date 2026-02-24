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

// Serve index.html for other routes (fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
