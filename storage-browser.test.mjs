// Browser storage on the vetting and feedback pages, driven through headless Chrome over CDP.
//
// The two pages share one 5 MB localStorage budget per origin. The feedback page used to cache a
// ~40 KB report per player per raid night there, forever, so the budget eventually ran out and the
// vetting page's own save() then threw for every newly added player — a fetched profile turned into
// an "error" row (2026-09-07, Bejoux and Smellmystaff). Reports now live in IndexedDB
// (feedback-cache.js), old localStorage entries are migrated out on page load, and a failed save on
// the vetting page is a page notice rather than a row state.
//
// Run: npm run test:storage-browser (needs Chrome; not part of `npm test`, like tactics-browser).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof WebSocket === "undefined") throw new Error("storage-browser.test.mjs requires Node 22 or newer (global WebSocket is required)");
const root = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const allowed = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

let server, chrome, profile, socket, id = 0;
const pending = new Map();
const browserErrors = [];
const hits = { player: 0, feedback: 0 };
function pass(message) { console.log(`PASS ${message}`); }

async function startServer() {
  const profileBody = await readFile(join(root, "fixtures", "vet-profile-bejoux.json"));
  const feedbackBody = await readFile(join(root, "fixtures", "feedback-body-bejoux.json"));
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/vet/player") { hits.player++; res.writeHead(200, { "content-type": "application/json" }); res.end(profileBody); return; }
      if (url.pathname === "/api/vet/feedback") { hits.feedback++; res.writeHead(200, { "content-type": "application/json" }); res.end(feedbackBody); return; }
      if (url.pathname === "/api/vet/nights") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"nights":[]}'); return; }
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.split("/").some((part) => part.startsWith(".")) || !allowed.has(extname(pathname).toLowerCase())) { res.writeHead(404).end("Not found"); return; }
      const file = resolve(root, `.${normalize(pathname)}`);
      if (!file.startsWith(`${root}/`)) { res.writeHead(404).end("Not found"); return; }
      await stat(file);
      res.writeHead(200, { "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end("Not found"); }
  });
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  return server.address().port;
}

function chromePath() {
  if (process.env.CHROME_BIN) return [process.env.CHROME_BIN];
  if (process.platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}
async function startChrome() {
  profile = await mkdtemp(join(tmpdir(), "storage-browser-"));
  let lastError;
  for (const bin of chromePath()) {
    try {
      chrome = spawn(bin, ["--headless=new", "--remote-debugging-port=0", "--window-size=1400,1000", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
      await Promise.race([new Promise((_, reject) => chrome.once("error", reject)), sleep(150)]);
      if (chrome.exitCode == null) break;
    } catch (error) { lastError = error; chrome = undefined; }
  }
  if (!chrome) throw new Error(`Could not launch Chrome${lastError ? `: ${lastError.message}` : ""}. Set CHROME_BIN.`);
  const activePort = join(profile, "DevToolsActivePort");
  let contents;
  for (let attempt = 0; attempt < 600; attempt++) { try { contents = await readFile(activePort, "utf8"); break; } catch { await sleep(100); } }
  assert(contents, "Chrome exposed a DevTools port");
  const port = Number(contents.split(/\r?\n/)[0]);
  let targets;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((target) => target.type === "page")) break; } catch {}
    await sleep(100);
  }
  const page = targets?.find((target) => target.type === "page");
  assert(page, "Chrome exposed a page target");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
  };
}
function send(method, params = {}) {
  return new Promise((resolveSend, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(requestId, (message) => { clearTimeout(timer); if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolveSend(message.result); });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, what, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out waiting for ${what}`);
}
async function navigate(url, readyExpr, what) { await send("Page.navigate", { url }); await waitFor(readyExpr, what); }

// Fill localStorage to within 128 bytes of the origin quota, under keys that look like the old
// feedback cache so the migration has nothing to say about them (they carry no JSON).
const FILL = `(() => { let total = 0; const put = (k, n) => { try { localStorage.setItem(k, 'x'.repeat(n)); total += n; return true; } catch (e) { return false; } };
  let i = 0; for (const size of [256 * 1024, 16 * 1024, 1024, 128]) { while (put('filler' + (i++), size)) {} } return total; })()`;

async function run() {
  const port = await startServer();
  const base = `http://127.0.0.1:${port}`;
  await startChrome();
  await send("Page.enable"); await send("Runtime.enable");

  // 1. Vetting page with a full localStorage: the fetched profile is shown, the failed save is a notice.
  await navigate(`${base}/vetting.html`, "typeof window.vetAdd === 'function'", "vetting page");
  await evaluate("localStorage.clear(); const i = document.getElementById('realmInput'); i.value = 'spineshatter'; i.dispatchEvent(new Event('change'))");
  const filled = await evaluate(FILL);
  assert(filled > 4 * 1024 * 1024, `filled localStorage close to the quota (${filled} bytes)`);
  assert.equal(await evaluate("window.vetAdd('Bejoux')"), true);
  await waitFor("!!vetState().profiles['bejoux'] || !!vetState().errors['bejoux']", "Bejoux to load");
  assert.equal(hits.player, 1, "one profile request went out");
  assert.equal(await evaluate("vetState().errors['bejoux']"), undefined, "a failed save is not a row error");
  const row = await evaluate("(() => { const tr = document.querySelector('tr[data-name=\"Bejoux\"]'); return tr ? tr.textContent : null; })()");
  assert(row && /Arcane/.test(row) && !/^error/.test(row), `row shows the loaded profile, got: ${row}`);
  pass("vetting: a profile fetched while localStorage is full is shown, not turned into an error row");
  const notice = await evaluate("(() => { const el = document.getElementById('saveWarning'); return el && !el.classList.contains('hidden') ? el.textContent : null; })()");
  assert(notice && /storage/i.test(notice), `a visible notice explains the failed save, got: ${notice}`);
  pass("vetting: the failed save is a visible page notice");
  await evaluate("localStorage.clear()");

  // 2. Feedback page: the report is cached in IndexedDB, not localStorage, and a reload serves it from there.
  const reportUrl = `${base}/feedback.html?name=Bejoux&server=spineshatter&region=eu&zone=1060&report=X6mnbPQpGhjJC2TN`;
  await navigate(reportUrl, "document.querySelectorAll('#cards .report-row').length > 0", "feedback report");
  assert.equal(hits.feedback, 1, "first open fetches the report");
  assert.equal(await evaluate("Object.keys(localStorage).filter(k => k.startsWith('raidFeedback:')).length"), 0, "no report in localStorage");
  assert.equal(await evaluate("typeof FeedbackCache === 'object' && typeof FeedbackCache.get === 'function'"), true, "FeedbackCache is loaded");
  const stored = await evaluate("FeedbackCache.get('raidFeedback:eu/spineshatter/bejoux/1060/X6mnbPQpGhjJC2TN').then(v => v && v.facts && v.facts.player.name)");
  assert.equal(stored, "Bejoux", "the report is in IndexedDB under the same key");
  await send("Page.reload"); await waitFor("document.querySelectorAll('#cards .report-row').length > 0", "feedback report after reload");
  assert.equal(hits.feedback, 1, "a reload is served from IndexedDB");
  pass("feedback: reports are cached in IndexedDB and survive a reload without a second request");

  // 3. Migration: an old localStorage report entry is moved into IndexedDB and still served, on either page.
  const oldBody = JSON.parse(await readFile(join(root, "fixtures", "feedback-body-bejoux.json"), "utf8"));
  const oldKey = "raidFeedback:eu/spineshatter/bejoux/1060/OLDREPORTCODE00";
  await evaluate(`localStorage.setItem(${JSON.stringify(oldKey)}, ${JSON.stringify(JSON.stringify({ ...oldBody, fetchedAt: 1 }))})`);
  await navigate(`${base}/feedback.html?name=Bejoux&server=spineshatter&region=eu&zone=1060&report=OLDREPORTCODE00`, "document.querySelectorAll('#cards .report-row').length > 0", "migrated feedback report");
  assert.equal(hits.feedback, 1, "a migrated report is served without a request");
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldKey)})`), null, "the old localStorage entry is gone");
  pass("feedback: an old localStorage report is migrated to IndexedDB and still served");
  const oldKey2 = "raidFeedback:eu/spineshatter/bejoux/1060/OLDREPORTCODE01";
  await evaluate(`localStorage.setItem(${JSON.stringify(oldKey2)}, ${JSON.stringify(JSON.stringify({ ...oldBody, fetchedAt: 1 }))})`);
  await navigate(`${base}/vetting.html`, "typeof window.vetAdd === 'function'", "vetting page");
  await waitFor(`localStorage.getItem(${JSON.stringify(oldKey2)}) === null`, "the vetting page to migrate old feedback entries");
  assert.equal(await evaluate(`FeedbackCache.get(${JSON.stringify(oldKey2)}).then(v => v && v.facts.player.name)`), "Bejoux");
  pass("vetting: opening the vetting page also moves old feedback entries out of localStorage");

  // Upstream failures must explain themselves in the row without requiring a hover.
  await evaluate(`(() => {
    const s = vetState();
    s.players = [{ name: 'Slowplayer' }]; s.profiles = {}; s.errors = { slowplayer: 'WCL vetting lookup timed out' };
    renderTable();
  })()`);
  assert.match(await evaluate("document.querySelector('#vetBody tr').textContent"), /WCL vetting lookup timed out/);
  const partial = JSON.parse(await readFile(join(root, "fixtures", "vet-profile-bejoux.json"), "utf8"));
  Object.assign(partial, { gear: null, gearSummary: null, gearOnly: null, computed: null, computedFromGear: null,
    reported: null, lastSeen: null, partial: true, fetchWarning: 'Warcraft Logs gear lookup timed out — use Refresh all to retry.' });
  await evaluate(`(() => {
    const s = vetState(); s.players = [{ name: 'Bejoux' }]; s.errors = {}; s.profiles = { bejoux: ${JSON.stringify(partial)} };
    renderTable();
  })()`);
  assert.match(await evaluate("document.querySelector('#vetBody tr').textContent"), /gear lookup timed out/);
  assert.notEqual(await evaluate("document.querySelector('#vetBody .verdict').textContent"), 'pass');
  pass("vetting: timeout errors and partial gear warnings are visible in the table");

  assert.deepEqual(browserErrors, [], "no uncaught browser errors");
  pass("no uncaught browser errors");
}

run().then(() => { console.log("storage-browser: all passed"); return cleanup(0); }, async (error) => { console.error(error); await cleanup(1); });
async function cleanup(code) {
  try { socket?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  await new Promise((done) => server ? server.close(done) : done());
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
