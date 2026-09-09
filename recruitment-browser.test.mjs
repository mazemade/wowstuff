// Recruitment integration in headless Chrome: imports, edits, settings and copying.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof WebSocket === "undefined") throw new Error("recruitment-browser.test.mjs requires Node 22 or newer (global WebSocket is required)");
const root = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const allowed = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

let server, chrome, profile, socket, id = 0;
const pending = new Map();
const browserErrors = [];
function pass(message) { console.log(`PASS ${message}`); }

async function startServer() {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/raidhelper/123456") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ title: 'Recruitment test', signUps: fixture.map((p, i) => ({ name: p.name, className: p.class, specName: p.spec, userId: String(i + 100), status: 'primary' })) })); return;
      }
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
  profile = await mkdtemp(join(tmpdir(), "recruitment-browser-"));
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

const fixture = [
  ['WARRIOR', 'Protection'], ['PALADIN', 'Protection'],
  ['PRIEST', 'Holy'], ['DRUID', 'Restoration'], ['SHAMAN', 'Restoration'], ['SHAMAN', 'Restoration'],
  ['WARRIOR', 'Arms'], ['WARRIOR', 'Fury'], ['ROGUE', 'Combat'], ['SHAMAN', 'Enhancement'],
  ['HUNTER', 'Beast Mastery'], ['HUNTER', 'Beast Mastery'], ['HUNTER', 'Survival'],
  ['MAGE', 'Arcane'], ['MAGE', 'Fire'], ['WARLOCK', 'Destruction'], ['WARLOCK', 'Affliction'],
  ['PRIEST', 'Shadow'], ['DRUID', 'Balance'], ['SHAMAN', 'Elemental'],
].map(([cls, spec], i) => ({ name: 'Raider' + i, class: cls, spec }));
const count = "document.querySelectorAll('#recruitmentList > li').length";
const change = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('change')); })()`);
async function loadRoster(players, settings = { raidId: 'general' }) {
  await evaluate(`localStorage.setItem('raidAssignmentsState', JSON.stringify({ manual: ${JSON.stringify(players)}, recruitment: ${JSON.stringify(settings)} }));`);
  await send('Page.reload');
  await waitFor(`document.getElementById('rosterCount')?.textContent === '${players.length}' && document.getElementById('recruitmentRaid')?.options.length > 0`, 'saved roster');
}
async function run() {
  const port = await startServer();
  const base = `http://127.0.0.1:${port}`;
  await startChrome();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(`${base}/assignments.html`, "document.getElementById('recruitmentRaid')?.options.length > 0", 'assignments page');
  assert.equal(await evaluate(count), 0);
  assert.match(await evaluate("document.getElementById('recruitmentSummary').textContent"), /Import a roster/);
  assert.equal(await evaluate("document.getElementById('recruitmentCopy').disabled"), true);
  pass('empty state invites a roster import');

  // Exercise the real Raid-Helper import handler against a deterministic response.
  await evaluate("document.getElementById('rhInput').value = '123456'; document.getElementById('rhImportBtn').click()");
  await waitFor("document.getElementById('rosterCount').textContent === '20'", 'Raid-Helper import');
  assert.equal(await evaluate(count), 5);
  assert.match(await evaluate("document.getElementById('recruitmentRoles').textContent"), /2 → 3/);
  assert.match(await evaluate("document.getElementById('recruitmentRoles').textContent"), /4 → 6/);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('raidAssignmentsState')).manual.length"), 0);
  pass('20-player Raid-Helper import produces five invites with role shortages filled');

  await change('recruitmentRaid', 'gruul');
  assert.equal(await evaluate("document.getElementById('recruitmentTanks').value"), '2');
  assert.equal(await evaluate("document.getElementById('recruitmentHealers').value"), '5');
  await change('recruitmentHealers', '4');
  assert.equal(await evaluate("document.querySelectorAll('#recruitmentList .recruitment-role-label').length"), 5);
  assert.equal(await evaluate("[...document.querySelectorAll('#recruitmentList .recruitment-role-label')].some(e => e.textContent === 'Healer')"), false);
  await send('Page.reload');
  await waitFor("document.getElementById('recruitmentHealers')?.value === '4'", 'persisted targets');
  assert.equal(await evaluate("document.getElementById('recruitmentRaid').value"), 'gruul');
  await evaluate("document.getElementById('recruitmentReset').click()");
  assert.equal(await evaluate("document.getElementById('recruitmentHealers').value"), '5');
  pass('raid selection, custom targets, reload and raid-default reset work');

  // Suggestions never enter the live roster or existing assignment outputs.
  const rosterBefore = await evaluate("JSON.stringify(roster)");
  await evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedRecruitment = text; } } }); document.getElementById('recruitmentCopy').click()");
  await waitFor("document.getElementById('recruitmentCopyStatus').textContent === 'Invite list copied.'", 'copy result');
  assert.match(await evaluate('window.copiedRecruitment'), /20\/25/);
  assert.match(await evaluate('window.copiedRecruitment'), /1\. /);
  assert.equal(await evaluate('JSON.stringify(roster)'), rosterBefore);
  await evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } }); document.getElementById('recruitmentCopy').click()");
  await waitFor("!document.getElementById('recruitmentCopyText').classList.contains('hidden')", 'manual copy fallback');
  assert.match(await evaluate("document.getElementById('recruitmentCopyText').textContent"), /20\/25/);
  pass('copy exports a separate invite list, with a usable clipboard failure fallback');

  await evaluate("document.querySelector('#rosterPills .pill button[data-act=del]').click()");
  assert.equal(await evaluate(count), 6);
  assert.equal(await evaluate("document.getElementById('recruitmentCopyText').classList.contains('hidden')"), true);
  pass('removal immediately adds an open slot and clears stale copy text');

  await evaluate("document.getElementById('addPlayerBtn').click(); document.getElementById('manualName').value = 'NewTank'; document.getElementById('manualClass').value = 'DRUID'; document.getElementById('manualClass').dispatchEvent(new Event('change')); document.getElementById('manualSpec').value = 'Guardian'; document.getElementById('manualSaveBtn').click()");
  assert.equal(await evaluate(count), 5);
  assert.equal(await evaluate("document.getElementById('rosterCount').textContent"), '20');
  pass('adding a real player removes one suggested invite');

  // Unknown scan, bear/cat resolution, then a declared main tank.
  await loadRoster([]);
  await evaluate("document.getElementById('addonInput').value = 'RSS1;Bear:DRUID:0/41/20;Unknown:PRIEST:?'; document.getElementById('addonImportBtn').click()");
  assert.equal(await evaluate(count), 23);
  assert.match(await evaluate("document.getElementById('recruitmentWarnings').textContent"), /Bear/);
  await evaluate("document.querySelector('#rosterPills .pill button[data-act=edit]').click(); document.getElementById('manualSpec').value = 'Guardian'; document.getElementById('manualSaveBtn').click()");
  assert.match(await evaluate("document.getElementById('recruitmentRoles').textContent"), /1 → 3/);
  await evaluate("document.querySelector('#rosterPills .pill:last-child button[data-act=edit]').click(); document.getElementById('manualSpec').value = 'Feral'; document.getElementById('manualSaveBtn').click()");
  await evaluate("const row = [...document.querySelectorAll('.tuning-row')].find(r => r.querySelector('span')?.textContent === 'Bear'); row.querySelector('input[type=checkbox]').click()");
  assert.match(await evaluate("document.getElementById('recruitmentRoles').textContent"), /1 → 3/);
  pass('addon unknown specs stay visible; editing Guardian and declaring a Feral main tank update roles');

  const oddName = '<img src=x onerror="window.recruitmentInjected=true">';
  await loadRoster([{ name: oddName, class: 'PRIEST', spec: null, flags: ['spec-unknown'] }]);
  assert.equal(await evaluate("document.querySelectorAll('#recruitmentWarnings img').length"), 0);
  assert.equal(await evaluate('window.recruitmentInjected'), undefined);
  assert.match(await evaluate("document.getElementById('recruitmentWarnings').textContent"), /unresolved/i);
  await change('recruitmentTanks', '25');
  await change('recruitmentHealers', '');
  assert.equal(await evaluate("Number(document.getElementById('recruitmentTanks').value) + Number(document.getElementById('recruitmentHealers').value) <= 25"), true);
  pass('untrusted roster names render as text and target controls stay within raid capacity');

  await loadRoster(Array.from({ length: 25 }, (_, i) => ({ name: 'Mage' + i, class: 'MAGE', spec: 'Arcane' })));
  assert.equal(await evaluate(count), 0);
  assert.match(await evaluate("document.getElementById('recruitmentSummary').textContent"), /No open slots/);
  assert.equal(await evaluate("document.getElementById('recruitmentCopy').disabled"), true);
  assert.equal(await evaluate("document.getElementById('recruitmentWarnings').classList.contains('hidden')"), false);
  await loadRoster(Array.from({ length: 26 }, (_, i) => ({ name: 'Mage' + i, class: 'MAGE', spec: 'Arcane' })));
  assert.equal(await evaluate(count), 0);
  assert.match(await evaluate("document.getElementById('recruitmentSummary').textContent"), /Over capacity/);
  assert.equal(await evaluate("document.getElementById('recruitmentCopy').disabled"), true);
  pass('full and over-cap rosters have no invites and retain shortage warnings');

  await loadRoster(fixture, { raidId: 'bt' });
  for (const width of [1280, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, `no page overflow at ${width}`);
    assert.equal(await evaluate("[...document.querySelectorAll('.recruitment-invite')].every(e => e.scrollWidth <= e.clientWidth)"), true, `invite rows fit at ${width}`);
  }
  // Optional screenshot artifact for visual inspection, using the actual browser rendering.
  if (process.env.RECRUITMENT_SCREENSHOT) {
    await evaluate("document.getElementById('recruitmentRaid').closest('section').scrollIntoView()");
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.RECRUITMENT_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  pass('invite panel fits 1280px and 1440px laptop viewports');
  await evaluate("window.confirm = () => true; document.getElementById('clearRosterBtn').click()");
  assert.equal(await evaluate(count), 0);
  assert.equal(await evaluate("document.getElementById('recruitmentRaid').value"), 'bt');
  assert.equal(await evaluate("document.getElementById('recruitmentCopy').disabled"), true);
  pass('clearing the roster keeps raid preferences and restores the empty state');
  assert.deepEqual(browserErrors, [], 'no uncaught browser errors');
  pass('no uncaught browser errors');
}
run().then(() => { console.log('recruitment-browser: all passed'); return cleanup(0); }, async error => { console.error(error); await cleanup(1); });
async function cleanup(code) {
  try { socket?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  await new Promise(done => server ? server.close(done) : done());
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
