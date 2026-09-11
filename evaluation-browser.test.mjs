// Recruitment integration in headless Chrome: imports, edits, settings and copying.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const recordedUtopik = require('./fixtures/evaluation/recorded-coaching.cjs').utopikReport();
const recordedFunkell = require('./fixtures/evaluation/funkell-hunter.json');
const { combinedEvidence } = require('./evaluation-service');
const { buildFightCoaching, buildNightCoaching } = require('./evaluation-coaching');

if (typeof WebSocket === "undefined") throw new Error("evaluation-browser.test.mjs requires Node 22 or newer (global WebSocket is required)");
const root = dirname(fileURLToPath(import.meta.url));
const varenthilFixture = await readFile(join(root, 'output/evaluation/varenthil-review.json'), 'utf8').then(JSON.parse).catch(() => null);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const allowed = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };

let sharedSnapshot;
let server, chrome, profile, socket, id = 0;
const pending = new Map();
const browserErrors = [];
function pass(message) { console.log(`PASS ${message}`); }

async function startServer() {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === '/api/vet/nights') {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ nights: [{ code: 'MODEL', date: '2026-09-06', zoneName: 'Test raid', bosses: ['Training Demon', 'Training Giant'] }, { code: 'UNSUPPORTED', date: '2026-09-07', bosses: ['Training Giant'] }] })); return;
      }
      if (url.pathname === '/api/vet/evaluation' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const q = JSON.parse(body); starts.push(q); const jobId = 'job-' + q.report; jobs.set(jobId, q.report);
        res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: jobId, status: 'running', progress: { stage: 'simulate', message: 'Testing fixture scenarios; these are not real player estimates.', completed: 1, total: 3 } })); return;
      }
      if (url.pathname.endsWith('/share') && req.method === 'POST') {
        const jobId = url.pathname.split('/')[4];
        sharedSnapshot = structuredClone(reportFixture(jobs.get(jobId)));
        res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: 'a'.repeat(48) })); return;
      }
      if (url.pathname.startsWith('/api/shared-evaluation/')) {
        const valid = url.pathname.endsWith('a'.repeat(48));
        res.writeHead(valid ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(valid ? { result: sharedSnapshot } : { error: 'Unavailable' })); return;
      }
      if (url.pathname.startsWith('/api/vet/evaluation/')) {
        const jobId = decodeURIComponent(url.pathname.split('/').pop()); const report = jobs.get(jobId);
        if (!report) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Expired fixture' })); return; }
        if (report === 'RETRY' && retryFailures++ === 0) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Temporary fixture outage' })); return; }
        const held = report === 'RESUME' && hold;
        const failed = report === 'PARTIAL';
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: jobId, status: held ? 'running' : failed ? 'failed' : 'complete', progress: { stage: 'simulate', message: 'Waiting for fixture simulation', completed: 1, total: 2 }, ...(held ? {} : { result: reportFixture(report) }), ...(failed ? { error: 'One simulation failed' } : {}) })); return;
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
  profile = await mkdtemp(join(tmpdir(), "evaluation-browser-"));
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

// Deterministic UI fixtures only. These values are not real player estimates.
const starts = [], jobs = new Map();
let hold = true, retryFailures = 0;
function funkellReport() {
  const result = { schemaVersion: 2, player: recordedFunkell.fights[0].player, night: { code: recordedFunkell.provenance.report, date: recordedFunkell.provenance.date }, generatedAt: '2026-09-11T12:00:00.000Z', limitations: [] };
  result.fights = recordedFunkell.fights.map(raw => {
    const fightWindow = raw.context.fights[0];
    const fight = { id: raw.reportCode + '/' + raw.fightId, name: raw.name, player: raw.player, durationSec: (fightWindow.endTime - fightWindow.startTime) / 1000,
      encounter: raw.encounter, wclUrl: 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId,
      ...combinedEvidence(structuredClone(raw)), simulation: { status: 'unsupported', actions: [], packages: [], reason: 'Recorded evidence replay; no modeled gains are assigned.' } };
    fight.coaching = buildFightCoaching(fight);
    return fight;
  });
  result.coaching = buildNightCoaching(result);
  return result;
}
function reportFixture(code) {
  if (code === 'NvByqL74tMA3X9Vc') return recordedUtopik;
  if (code === 'FUNKELLHUNTER001') return funkellReport();
  if (code === 'VARENTHELUI0001' && varenthilFixture) return varenthilFixture;
  if (['HEALERFIXTURE001', 'TANKERFIXTURE001', 'CONDITIONALMODEL'].includes(code)) return roleReportFixture(code);
  const model = { status: 'complete', baselineDps: 1500, version: 'fixture-only-v1', actions: [
    { id: 'haste', title: 'Use the test potion', owner: 'player', change: 'Use the potion in the burst window.', when: '0:18 alongside cooldowns', gainDps: 80, evidence: ['Fixture evidence: no potion used.'], caveats: ['Synthetic UI estimate; not a real simulation.'] },
    { id: 'support', title: 'Arrange test support', owner: 'raid', change: 'Confirm buff coverage.', gainDps: 120, evidence: ['Fixture support absent.'], caveats: [] }
  ], packages: [{ id: 'personal', title: 'Personal changes', actionIds: ['haste'], gainDps: 80 }, { id: 'combined', title: 'Personal + raid support', actionIds: ['haste', 'support'], gainDps: 215 }], assumptions: ['Fixture only: full support coverage.'], validation: { fixture: true } };
  model.actions.push({ id: 'negative', title: 'Never recommend a regression', gainDps: -10 }, { id: 'zero', title: 'Never recommend zero gain', impact: { value: 0, unit: 'DPS', kind: 'modeled' } });
  model.packages.push({ id: 'negative', title: 'Never recommend losing package', gainDps: -5 });
  model.actions.unshift({ id: 'boots', title: 'Enchant fixture boots', owner: 'player', change: 'Add the missing enchant.', gainDps: 7, evidence: [], caveats: [] });
  model.actions.unshift({ id: 'optional-gear', title: 'Optional fixture item', owner: 'gear', change: 'Consider only when available.', gainDps: 500, evidence: [], caveats: [] });
  const missing = { status: 'unsupported', reason: 'No validated model for this fixture specialization.', actions: [{ id: 'poison', title: 'Never show fabricated estimate', gainDps: 9999 }], packages: [{ title: 'Invalid stale package', gainDps: 9999 }], assumptions: [] };
  const fight = { id: 1, name: 'Training Demon', durationSec: 116, wclUrl: 'https://classic.warcraftlogs.com/reports/fixture#fight=1', observed: { dps: 1500, referenceDps: 2400, gapDps: 900 }, comparison: [{ name: 'Heroic Strike uses', player: 34, reference: 35, unit: 'casts', note: 'Nearly equal uses; outcomes differ.' }], findings: [{ id: 'rage', title: 'Investigate rage supply', owner: 'player', action: 'Preserve main abilities before spending surplus rage.', confidence: 'inferred', gainDps: null, evidence: [{ text: 'No valid rage samples.', startSec: 18, endSec: 33, url: 'https://classic.warcraftlogs.com/reports/fixture#fight=1' }] }], timeline: [{ label: 'Burst window', startSec: 18, endSec: 33, kind: 'cooldown' }], limitations: ['No exact action replay.'], simulation: code === 'UNSUPPORTED' || code === 'PARTIAL' ? missing : model };
  if (code === 'DIAGNOSIS') {
    fight.observed = { dps: 835, referenceDps: 1887, gapDps: 1052 };
    fight.damageAnalysis = { reference: { name: 'ReferenceRet', url: 'https://classic.warcraftlogs.com/reports/reference#fight=1&source=8', durationSec: 118 }, player: { name: 'FixtureWarrior', url: 'https://classic.warcraftlogs.com/reports/fixture#fight=1&source=4', durationSec: 116 }, gapDps: 1052, accountedDps: 792, residualDps: 260, rows: [
      { id: 'crusader-strike', name: 'Crusader Strike', playerDps: 66, referenceDps: 238, differenceDps: 172, playerCount: 7, referenceCount: 20, playerPerMinute: 3.6, referencePerMinute: 10.2, playerAverage: 1090, referenceAverage: 1404, frequencyDps: 128, yieldDps: 44, countLabel: 'casts' },
      { id: 'seal', name: 'Seal damage', playerDps: 155, referenceDps: 366, differenceDps: 211, playerCount: 19, referenceCount: 42, playerPerMinute: 9.8, referencePerMinute: 21.4, playerAverage: 940, referenceAverage: 1026, frequencyDps: 180, yieldDps: 31, countLabel: 'hits' },
      { id: 'melee', name: 'Melee', playerDps: 330, referenceDps: 420, differenceDps: 90, playerCount: 92, referenceCount: 106, playerPerMinute: 47.6, referencePerMinute: 53.9, playerAverage: 416, referenceAverage: 467, frequencyDps: 36, yieldDps: 54, countLabel: 'swings' },
      { id: 'consecration', name: 'Consecration', playerDps: 0, referenceDps: 184, differenceDps: 184, playerCount: 0, referenceCount: 40, playerPerMinute: 0, referencePerMinute: 20.3, playerAverage: null, referenceAverage: 538, frequencyDps: null, yieldDps: null, countLabel: 'reference only' },
      { id: 'judgement', name: 'Judgement', playerDps: 102, referenceDps: 189, differenceDps: 87, playerCount: 12, referenceCount: 18, playerPerMinute: 6.2, referencePerMinute: 9.2, playerAverage: 986, referenceAverage: 1239, frequencyDps: 50, yieldDps: 37, countLabel: 'casts' },
      { id: 'residual', name: 'Other recorded sources', playerDps: 182, referenceDps: 230, differenceDps: 48, playerCount: null, referenceCount: null, playerPerMinute: null, referencePerMinute: null, playerAverage: null, referenceAverage: null, frequencyDps: null, yieldDps: null, countLabel: 'residual' }
    ], limitations: ['The comparison does not reconstruct movement or target availability.'] };
    fight.findings.push({ id: 'crusader-strike', title: 'Keep Crusader Strike on cooldown', owner: 'player', category: 'execution', priority: 'high', action: 'Use Crusader Strike whenever it is ready during boss contact.', confidence: 'observed', gainDps: null, evidence: [{ text: 'Seven casts in this pull versus 20 for the reference.', url: 'https://classic.warcraftlogs.com/reports/fixture#fight=1&source=4' }] });
    fight.findings.push({ id: 'seal-twist', title: 'Practice the seal twist window', owner: 'player', category: 'execution', priority: 'medium', action: 'Twist the seal in the judged window while staying on the target.', confidence: 'observed', gainDps: null, evidence: [{ text: 'Seal damage and hit rate trailed the reference.' }] });
    fight.coaching = { assessment: 'Start with Crusader Strike timing, then review movement before treating observations as mistakes.', improvements: [{ id: 'crusader-strike', what: 'Keep Crusader Strike on cooldown', priority: 'high', why: 'Seven casts were recorded here versus 20 for the reference; target availability remains a possible alternative.', change: 'Use Crusader Strike whenever it is ready during boss contact.', verification: 'On the next comparable pull, compare casts during confirmed boss contact.', alternatives: ['Movement or target swaps may have limited casts.'], evidence: [{ text: 'Seven casts in this pull versus 20 for the reference.', startSec: 18, url: 'https://classic.warcraftlogs.com/reports/fixture#fight=1&source=4' }] }], keeps: [{ id: 'interrupt-keep', what: 'Interrupt landed', priority: 'low', why: 'The completion is recorded.', verification: 'Keep checking the completed cast.', evidence: [{ text: 'Kick completed at 0:44.' }] }], reviews: [{ id: 'movement-review', what: 'Review movement route', priority: 'medium', why: 'The log has no movement assignment.', verification: 'Record the route before the next pull.', evidence: [{ text: 'No assignment marker.' }] }], depth: { status: 'partial', reviewed: ['cast timing', 'damage rows'], unresolved: ['movement assignment'] } };
  }
  if (code === 'UNSUPPORTED') fight.findings.push({ id: 'cooldown-review', title: 'Review cooldown timing', owner: 'player', category: 'execution', priority: 'high', action: 'Use the recorded cooldown window as the next-pull review point.', confidence: 'observed', gainDps: null, evidence: [{ text: 'The log contains a cooldown window but no validated damage model.' }] });
  if (code === 'MALFORMED') fight.coaching = { assessment: 9, improvements: [null, 'bad'], keeps: 'bad', reviews: [{}], depth: 'bad' };
  const second = structuredClone(fight); second.id = 2; second.name = 'Training Giant'; second.simulation = missing; second.wclUrl = 'javascript:window.BAD_LINK=true'; second.findings[0].title = '<img src=x onerror="window.BAD_HTML=true">'; second.findings[0].evidence[0].url = 'javascript:window.BAD_LINK=true';
  fight.findings.push({ id: 'haste-potion', title: 'Potion was absent', owner: 'player', action: 'Use the potion in the burst window.', confidence: 'observed', gainDps: null, evidence: [{ text: 'Fixture observed potion count: zero.', startSec: 18, url: 'https://classic.warcraftlogs.com/reports/fixture#fight=1' }] });
  const fights = code === 'LATE_MODEL' ? [second, fight] : [fight, second];
  return { schemaVersion: code === 'NEWSCHEMA' ? 3 : 1, player: { name: 'FixtureWarrior', spec: 'Fury', classToken: 'WARRIOR' }, night: { code, date: '2026-09-06' }, generatedAt: '2026-09-10T12:00:00Z', fights, coaching: code === 'DIAGNOSIS' ? { assessment: 'Across the night, start with Crusader Strike timing on Training Demon.', topChanges: [{ what: 'Keep Crusader Strike on cooldown', priority: 'high', bosses: ['Training Demon'] }], openQuestions: ['movement assignment'] } : undefined, limitations: ['All values in this browser test are synthetic fixtures.'] };
}
function roleReportFixture(code) {
  const healer = code !== 'TANKERFIXTURE001';
  const conditional = code === 'CONDITIONALMODEL';
  const metric = healer ? 'hps' : 'dtps';
  const player = conditional ? { name: 'FixtureDruid', classToken: 'DRUID', spec: 'Restoration', role: 'healer' } : healer ? { name: 'FixturePriest', classToken: 'PRIEST', spec: 'Holy', role: 'healer' } : { name: 'FixtureTank', classToken: 'WARRIOR', spec: 'Protection', role: 'tank' };
  const action = healer ? { id: 'renew', title: 'Refresh assigned Renew coverage', owner: 'player', change: 'Keep the assigned tank covered through the damage window.', impact: { value: 180, unit: 'effective HPS', label: 'measured in this pull', kind: 'measured' }, evidence: ['Renew dropped during the assigned damage window.'] } : { id: 'mitigation', title: 'Plan a mitigation cooldown', owner: 'player', change: 'Use the assigned cooldown before the next spike.', impact: { value: 1, unit: 'cooldown window', label: 'capacity for next pull', kind: 'capacity' }, evidence: ['A mitigation cooldown was available at the spike.'] };
  const simulation = conditional ? { status: 'complete', coverage: { kind: 'conditional', spec: 'Restoration', reason: 'Exact talent settings were supplied for this model.' }, actions: [action], packages: [], assumptions: [] } : { status: healer ? 'unavailable' : 'not-applicable', coverage: { kind: healer ? 'conditional' : 'not-applicable', spec: player.spec, reason: healer ? 'No native reconstruction is available; this observed improvement remains useful.' : 'Tank mitigation is reviewed from encounter evidence.' }, actions: [action], packages: [], assumptions: [] };
  const fight = { id: 7, name: healer ? 'Healing Drill' : 'Tank Drill', durationSec: 140, wclUrl: 'https://classic.warcraftlogs.com/reports/fixture#fight=7&source=19', observed: { metric, playerValue: healer ? 1120 : 2630, referenceValue: healer ? 1180 : 2450, gapValue: healer ? 60 : -180 }, coverage: { spec: player.spec, role: player.role, checks: [{ id: 'events', label: healer ? 'Effective healing events' : 'Incoming damage events', status: 'checked' }, { id: 'assignment', label: 'Assignment context', status: 'unknown', reason: 'Record the assignment before the next pull.' }, { id: 'threat', label: 'Threat rotation', status: 'not-applicable', reason: healer ? 'Not part of this healing review.' : 'Not part of this mitigation review.' }] }, findings: [{ id: 'assignment', title: healer ? 'Confirm the healing assignment' : 'Confirm the tank assignment', owner: 'raid', action: 'Record the assignment in the next pull.', confidence: 'observed', evidence: ['The report has no assignment marker.'] }], comparison: [{ name: healer ? 'Assigned healing casts' : 'Mitigation uses', player: healer ? 8 : 2, reference: healer ? 9 : 3, unit: 'casts', note: 'Use this with the assignment context.' }], timeline: [{ label: healer ? 'Raid damage window' : 'Melee spike', startSec: 44, endSec: 57 }], limitations: ['Synthetic role fixture.'], simulation };
  return { schemaVersion: 1, player, night: { code, date: '2026-09-09' }, generatedAt: '2026-09-10T12:00:00Z', fights: [fight], limitations: ['Role-specific synthetic browser fixture.'] };
}

try {
  const port = await startServer(); await startChrome(); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });" });
  const base = `http://127.0.0.1:${port}/evaluation.html?name=FixtureWarrior&server=test-realm&region=eu`;
  await navigate(base, "document.querySelector('#nightSelect')?.options.length === 3", 'night picker');
  assert.equal(starts.length, 1); assert.equal(starts[0].report, undefined); pass('A named character starts a most-recent evaluation while the raid-night picker remains available');
  await evaluate("const select = document.querySelector('#nightSelect'); select.value = 'MODEL'; select.dispatchEvent(new Event('change')); ");
  await waitFor("document.querySelector('#jobStatus') && !document.querySelector('#jobStatus').hidden", 'job progress');
  await waitFor("document.querySelectorAll('.action').length === 4", 'completed model');
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /\+215/);
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Do not add overlapping/);
  assert.equal(await evaluate("document.querySelectorAll('.package').length"), 2);
  assert.equal(await evaluate("document.querySelector('#jobStatus').hidden"), true);
  pass('Modeled actions and separately tested packages are distinguished from observed DPS');
  if (process.env.EVALUATION_SCREENSHOT) { const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(process.env.EVALUATION_SCREENSHOT, Buffer.from(capture.data, 'base64')); }
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.action h3')].map(el => el.textContent)"), ['Use the test potion', 'Enchant fixture boots', 'Arrange test support', 'Optional fixture item']);
  pass('Action plan orders personal improvements by gain, then raid support, then optional gear');
  assert.equal(await evaluate("document.querySelectorAll('.finding').length"), 1);
  assert.match(await evaluate("document.querySelector('.action details').textContent"), /Fixture observed potion count: zero/);
  assert.match(await evaluate("document.querySelector('.finding').textContent"), /Investigate rage supply/);
  pass('Modeled recommendations absorb matching observed proof; independent context remains visible');
  await evaluate("document.querySelector('#copyPlanBtn').click()");
  await waitFor('Boolean(window.__copied)', 'action plan clipboard');
  const copied = await evaluate('window.__copied'); assert.match(copied, /0:18 alongside cooldowns/); assert.match(copied, /\+215 DPS modeled/); assert.doesNotMatch(copied, /not assigned to player fault/); assert.doesNotMatch(copied, /Training Giant/); assert.equal(copied.split('Use the potion in the burst window.').length - 1, 1);
  await evaluate("document.querySelector('#copyReportBtn').click()"); await waitFor("window.__copied.includes('Training Giant')", 'full report clipboard');
  assert.match(await evaluate('window.__copied'), /Synthetic UI estimate/); pass('Copy plan includes timing and modeling caveats; full report includes every encounter');
  await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate("document.activeElement.id"), 'fight-tab-1');
  assert.equal(await evaluate("document.querySelectorAll('.action-gain,.package').length"), 0);
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /DPS gains are not quantified/);
  assert.doesNotMatch(await evaluate("document.querySelector('#fightReport').innerText"), /9999|9,999|Never show fabricated/);
  assert.equal(await evaluate("Boolean(window.BAD_HTML || window.BAD_LINK || document.querySelector('#fightReport img') || document.querySelector('#fightReport a[href^=\"javascript:\"]'))"), false);
  assert.equal(await evaluate("document.querySelector('#sourceLink').hidden"), true);
  pass('Keyboard boss switching works; unsupported models expose facts without stale gains; HTML and URLs are safe');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate("document.querySelector('#fight-tab-0').click()");
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  pass('Report and action plan fit a 390px mobile viewport without page overflow');
  await send('Emulation.clearDeviceMetricsOverride');
  assert.equal(starts[0].force, undefined);
  await evaluate("document.querySelector('#refreshBtn').click()");
  await waitFor("document.querySelector('#jobStatus') && !document.querySelector('#jobStatus').hidden", 'forced rebuild');
  assert.equal(starts.at(-1).force, true);
  await waitFor("document.querySelector('#jobStatus').hidden", 'forced rebuild completion');
  pass('Only an explicit rebuild requests a fresh job');
  const beforeResume = starts.length;
  await navigate(base + '&report=RESUME', "document.querySelector('#statusText')?.textContent.includes('fixture simulation')", 'held job');
  await send('Page.reload'); await waitFor("document.querySelector('#statusText')?.textContent.includes('fixture simulation')", 'resumed job');
  assert.equal(starts.length, beforeResume + 1); hold = false;
  await waitFor("document.querySelectorAll('.action').length === 4", 'resumed completion');
  pass('Reload resumes the saved job without starting another analysis');
  await navigate(base + '&report=PARTIAL', "document.querySelector('#errorBox')?.textContent.includes('One simulation failed')", 'partial failure');
  assert.equal(await evaluate("document.querySelector('#report').hidden"), false);
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  await evaluate("document.querySelector('.report-background').open = true");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Investigate rage supply/);
  assert.equal(await evaluate("document.querySelectorAll('.action-gain,.package').length"), 0);
  pass('Partial failure preserves observed findings and exposes the error');
  await navigate(base + '&report=RETRY', "document.querySelector('#errorBox')?.textContent.includes('reconnect automatically')", 'network retry');
  await waitFor("document.querySelectorAll('.action').length === 4", 'reconnected report');
  assert.equal(await evaluate("document.querySelector('#errorBox').hidden"), true);
  pass('Transient polling failures reconnect and render the completed report');
  const beforeStaleCache = starts.length;
  await evaluate("localStorage.setItem('raidEvaluation:v1:eu/test-realm/fixturewarrior/1060/STALE', JSON.stringify({version:1,id:'old-engine-job'}))");
  await navigate(base + '&report=STALE', "document.querySelectorAll('.action').length === 4", 'stale cache rebuild');
  assert.equal(starts.length, beforeStaleCache + 1, 'an old cache version starts a current evaluation instead of polling an expired job');
  await evaluate("localStorage.setItem('raidEvaluation:v2:eu/test-realm/fixturewarrior/1060/EXPIRED', JSON.stringify({version:2,id:'missing-job'}))");
  await navigate(base + '&report=EXPIRED', "document.querySelector('#errorBox')?.textContent.includes('expired')", 'expired job');
  assert.equal(await evaluate("document.querySelector('#refreshBtn').disabled"), false);
  await navigate(base + '&report=LATE_MODEL', "document.querySelectorAll('.action').length === 4", 'preferred modeled encounter');
  assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').textContent"), 'Training Demon');
  assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').id"), 'fight-tab-1');
  await evaluate("document.querySelector('#fight-tab-0').click(); document.querySelector('#refreshBtn').click()");
  await waitFor("document.querySelector('#jobStatus') && !document.querySelector('#jobStatus').hidden", 'selected encounter rebuild');
  await waitFor("document.querySelector('#jobStatus').hidden", 'selected encounter rebuild completion');
  assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').id"), 'fight-tab-0');
  assert.equal(await evaluate("document.querySelectorAll('.action').length"), 0);
  pass('Default view prefers a modeled encounter; user boss selection survives later updates');
  await navigate(base + '&report=DIAGNOSIS', "document.querySelector('#fightReport .coaching-section')", 'action-first diagnosis');
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  assert.equal(await evaluate("document.querySelector('.coaching-background').open"), false);
  const defaultDiagnosisText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(defaultDiagnosisText, /Make these changes/);
  assert.match(defaultDiagnosisText, /Keep Crusader Strike on cooldown/);
  assert.doesNotMatch(defaultDiagnosisText, /What the logs show|ReferenceRet|Consecration|Inspection coverage/);
  await evaluate("document.querySelector('.report-background').open = true; document.querySelector('.coaching-background').open = true; document.querySelector('.coaching-depth').open = true");
  const diagnosisText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(diagnosisText, /ReferenceRet/);
  assert.match(diagnosisText, /1,052 DPS/);
  assert.match(diagnosisText, /Consecration/i);
  assert.match(diagnosisText, /Frequency \+128/i);
  assert.match(diagnosisText, /Keep Crusader Strike on cooldown/);
  assert.match(diagnosisText, /Make these changes/);
  assert.match(diagnosisText, /Why it matters: Seven casts were recorded/);
  assert.match(diagnosisText, /Keep doing \(1\)/);
  assert.match(diagnosisText, /Open review \(1\)/);
  assert.match(diagnosisText, /Inspection coverage.*Reviewed: cast timing, damage rows.*Unresolved: movement assignment/s);
  assert.ok(diagnosisText.indexOf('Make these changes') < diagnosisText.indexOf('USEFUL MODELED ACTIONS'));
  assert.match(diagnosisText, /\+80 DPS\s*modeled/);
  assert.doesNotMatch(diagnosisText, /recoverable gain/);
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied.includes('Coaching change')", 'diagnosis action-plan copy');
  assert.match(await evaluate('window.__copied'), /Coaching change \(High priority\): Keep Crusader Strike on cooldown/);
  assert.doesNotMatch(await evaluate('window.__copied'), /Review movement route/);
  assert.doesNotMatch(await evaluate('window.__copied'), /Damage diagnosis:|Consecration|check the coverage/);
  await evaluate("document.querySelector('#copyReportBtn').click()"); await waitFor("window.__copied.includes('ReferenceRet')", 'diagnosis full-report copy');
  assert.match(await evaluate('window.__copied'), /Consecration/);
  assert.match(await evaluate('window.__copied'), /Coaching assessment/);
  pass('Action-first coaching and useful modeled actions stay visible; diagnosis and review evidence are optional background');
  await navigate(base + '&report=MALFORMED', "document.querySelector('#fightReport')?.innerText.includes('Training Demon')", 'malformed coaching report');
  await evaluate("document.querySelector('.report-background').open = true");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Investigate rage supply/);
  pass('Malformed coaching payloads remain safe and preserve legacy findings');
  await navigate(base + '&report=UNSUPPORTED', "document.querySelector('#fightReport')?.innerText.includes('Review cooldown timing')", 'unmodeled priority execution');
  const unmodeledText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(unmodeledText, /Change these first on the next pull/);
  assert.doesNotMatch(unmodeledText, /Damage diagnosis/);
  assert.equal(unmodeledText.split('Review cooldown timing').length - 1, 1);
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied.includes('Review cooldown timing')", 'unmodeled priority action-plan copy');
  const unmodeledCopy = await evaluate('window.__copied');
  assert.equal(unmodeledCopy.split('Review cooldown timing').length - 1, 1);
  assert.match(unmodeledCopy, /Priority execution \(High priority\)/);
  pass('DPS execution priorities lead even without a reference ledger or modeled gain');
  if (varenthilFixture) {
    await navigate(`http://127.0.0.1:${port}/evaluation.html?report=VARENTHELUI0001&fightId=9&sourceId=1`, "document.querySelector('#playerTitle')?.textContent === 'Varenthil'", 'saved Varenthil review');
    assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
    await evaluate("document.querySelector('.report-background').open = true");
    const varenthilText = await evaluate("document.querySelector('#fightReport').innerText");
    assert.match(varenthilText, /Aboujudger/);
    assert.match(varenthilText, /Observed account/i);
    assert.match(varenthilText, /Options supported by this pull/);
    assert.doesNotMatch(varenthilText, /Modeled baseline|iterations per scenario/i);
    await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied.includes('next raid action plan')", 'saved Varenthil action-plan copy');
    assert.doesNotMatch(await evaluate('window.__copied'), /Damage diagnosis/);
    pass('Saved Varenthil ledger stays optional and does not import model assumptions');
  }
  await navigate(base + '&report=NEWSCHEMA', "document.querySelector('#errorBox')?.textContent.includes('report format')", 'schema mismatch');
  assert.equal(await evaluate("document.querySelector('#refreshBtn').disabled"), false);
  assert.equal(await evaluate("document.querySelector('#jobStatus').hidden"), true);
  pass('Unsupported report schemas stop polling and allow a rebuild');
  await navigate(`http://127.0.0.1:${port}/evaluation.html?report=HEALERFIXTURE001&fightId=7&sourceId=19`, "document.querySelector('#playerTitle')?.textContent === 'FixturePriest'", 'direct healer report');
  assert.deepEqual(starts.at(-1), { region: 'eu', zone: '1060', report: 'HEALERFIXTURE001', fightId: '7', sourceId: '19' });
  const healerText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(healerText, /Effective healing \/ HPS observed/);
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  await evaluate("document.querySelector('.report-background').open = true");
  const healerBackground = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(healerBackground, /Effective healing is context, not a target to maximize/);
  assert.match(healerBackground, /What was checked for Holy healer/);
  assert.match(healerBackground, /Unknown.*Record the assignment before the next pull/);
  assert.doesNotMatch(healerBackground, /DPS gains|recoverable|player fault/);
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied.includes('Effective healing / HPS')", 'healer action-plan copy');
  assert.doesNotMatch(await evaluate('window.__copied'), /DPS/);
  pass('Direct healer reports work without ranked-night identity and keep healing evidence role-specific');
  await navigate(`http://127.0.0.1:${port}/evaluation.html?report=TANKERFIXTURE001&fightId=7&sourceId=19`, "document.querySelector('#playerTitle')?.textContent === 'FixtureTank'", 'direct tank report');
  const tankText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(tankText, /Incoming damage \/ DTPS observed/);
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  await evaluate("document.querySelector('.report-background').open = true");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Lower DTPS is not automatically better/);
  assert.match(tankText, /\+1 cooldown window/);
  assert.doesNotMatch(tankText, /DPS gains|recoverable/);
  pass('Tank reports present incoming damage as context and retain capacity improvements without a DPS model');
  await navigate(base, "document.querySelector('#nightSelect')?.options.length === 3", 'conditional report input');
  await evaluate("document.querySelector('#nameInput').value = ''; document.querySelector('#serverInput').value = ''; document.querySelector('#reportInput').value = 'https://classic.warcraftlogs.com/reports/CONDITIONALMODEL#fight=7&source=19'; document.querySelector('#raceInput').value = 'Tauren'; document.querySelector('#talentsInput').value = '12345'; document.querySelector('#identityForm').requestSubmit()");
  await waitFor("document.querySelector('#playerTitle')?.textContent === 'FixtureDruid'", 'conditional direct report');
  assert.equal(starts.at(-1).report, 'CONDITIONALMODEL'); assert.equal(starts.at(-1).fightId, '7'); assert.equal(starts.at(-1).sourceId, '19');
  assert.deepEqual(starts.at(-1).modelOverrides, { race: 'Tauren', talentsString: '12345' });
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Conditional model/);
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Exact talent settings were supplied/);
  pass('Pasted Warcraft Logs pulls parse fight and source IDs; optional settings reach conditional models');
  await navigate(`http://127.0.0.1:${port}/evaluation.html?report=NvByqL74tMA3X9Vc&sourceId=5`, "document.querySelector('#playerTitle')?.textContent === 'Utopik'", 'recorded Utopik coaching');
  await evaluate("document.querySelector('#fight-tab-0').click()");
  const winterchillText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(winterchillText, /Where the gap is and what it is worth[\s\S]*1,546[\s\S]*Jofrey[\s\S]*1,815[\s\S]*Gap[\s\S]*269[\s\S]*Whole pull/, 'budget strip leads');
  assert.match(winterchillText, /Fang of Vashj/); assert.match(winterchillText, /Flask of Relentless Assault/); assert.match(winterchillText, /Medallion of the Horde/);
  assert.match(winterchillText, /up to about \d+ DPS on this pull/);
  assert.match(winterchillText, /not sized/, 'unpriced causes say so instead of inventing a number');
  assert.match(winterchillText, /These values overlap and do not add up to the gap/);
  assert.match(winterchillText, /Whole pull[\s\S]*Keep, review & coverage/i, 'buckets come before the collapsed legacy sections');
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied?.includes('Budget: you 1546 DPS, Jofrey 1815 DPS, gap 269.')", 'budget plan');
  assert.match(await evaluate('window.__copied'), /\[you\] Close the expertise gap/);
  const nightText = await evaluate("document.querySelector('#nightOverview').innerText");
  assert.match(nightText, /Slice and Dice was absent[\s\S]*up to about 7 DPS[\s\S]*Rage Winterchill/, 'the night lists the sized levers');
  assert.match(nightText, /Archimonde: you 1,445 vs 1,567, gap 122, largest bucket Melee/, 'the night lists a budget line per boss');
  await evaluate("document.querySelector('#fight-tab-3').click()");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Bloodlust Brooch: the final use had only 8 seconds/);
  assert.equal(await evaluate("[...document.querySelectorAll('#fightReport h3, #fightReport h4')].filter(e=>e.textContent.includes('Bloodlust Brooch: the final use')).length"), 1, 'coaching is not duplicated in legacy cards');
  await evaluate("document.querySelector('#fight-tab-4').click(); document.querySelector('#copyPlanBtn').click()");
  await waitFor("window.__copied?.includes('103.6 seconds')", 'recorded Archimonde action plan');
  assert.match(await evaluate('window.__copied'), /before the pull/);
  assert.doesNotMatch(await evaluate('window.__copied'), /Damage source:|Open question:/);
  await evaluate("document.querySelector('#shareBtn').click()");
  await waitFor("document.querySelector('#shareLinkBox')?.hidden === false", 'recorded player link');
  await navigate(await evaluate("document.querySelector('#shareLinkInput').value"), "document.querySelector('#playerTitle')?.textContent === 'Utopik'", 'recorded recipient report');
  await evaluate("document.querySelector('#fight-tab-4').click()");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Monitor five-stack Deadly Poison expiry/);
  assert.equal(await evaluate("!!document.querySelector('nav, #identityForm, #refreshBtn')"), false);
  await evaluate("document.querySelector('#fight-tab-0').click()");
  const sharedWinterchill = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(sharedWinterchill, /Where the gap is and what it is worth[\s\S]*1,546[\s\S]*1,815[\s\S]*269[\s\S]*Whole pull/, 'the shared page leads with the same budget strip');
  assert.match(sharedWinterchill, /Fang of Vashj/, 'the shared page names the reference item behind the stat gap');
  await evaluate("document.querySelector('.budget-section').scrollIntoView()");
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'utopik-coaching-browser.png'), Buffer.from(shot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'the budget report fits a 400px screen');
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Recorded Utopik evidence produces concrete encounter plans and identical protected recipient coaching');
  await navigate(`http://127.0.0.1:${port}/evaluation.html?report=FUNKELLHUNTER001&sourceId=20`, "document.querySelector('#playerTitle')?.textContent === 'Funkell'", 'recorded Funkell hunter coaching');
  assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').textContent"), 'Archimonde');
  await evaluate("document.querySelector('#fight-tab-3').click()");
  const azgalorText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(azgalorText, /Move your pet out of damaging ground effects early/);
  assert.match(azgalorText, /Observed at: 1:24–1:42/);
  assert.doesNotMatch(azgalorText, /What the logs show|Observed account/);
  await evaluate("document.querySelector('#fight-tab-4').click()");
  const archimondeText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(archimondeText, /Move your pet out of damaging ground effects early/);
  assert.match(archimondeText, /Observed at: 1:14–1:52/);
  await evaluate("document.querySelector('#fight-tab-2').click()");
  const kazText = await evaluate("document.querySelector('#fightReport').innerText");
  assert.match(kazText, /Practice next pull/i);
  assert.match(kazText, /Resume Steady Shot promptly when you can stand still/);
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  if (process.env.FUNKELL_SCREENSHOT) { const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(process.env.FUNKELL_SCREENSHOT, Buffer.from(capture.data, 'base64')); }
  await evaluate("document.querySelector('#copyPlanBtn').click()"); await waitFor("window.__copied?.includes('Resume Steady Shot promptly')", 'Funkell action plan');
  const funkellPlan = await evaluate('window.__copied');
  assert.match(funkellPlan, /Budget: you \d+ DPS, \w+ \d+ DPS, gap \d+\./);
  assert.match(funkellPlan, /5 long Steady Shot gaps/);
  assert.doesNotMatch(funkellPlan, /Damage diagnosis:|check the coverage/);
  await evaluate("document.querySelector('#shareBtn').click()"); await waitFor("document.querySelector('#shareLinkBox')?.hidden === false", 'Funkell player link');
  await navigate(await evaluate("document.querySelector('#shareLinkInput').value"), "document.querySelector('#playerTitle')?.textContent === 'Funkell'", 'shared Funkell coaching');
  await evaluate("document.querySelector('#fight-tab-2').click()");
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Practice next pull/i);
  assert.equal(await evaluate("document.querySelector('.report-background').open"), false);
  pass('Recorded Funkell hunter coaching keeps pet recovery and conditional practice concrete in player and shared views');
  await navigate(base + '&report=DIAGNOSIS', "document.querySelector('#shareBtn')?.disabled === false", 'shareable report');
  await evaluate("document.querySelector('#shareBtn').click()");
  await waitFor("document.querySelector('#shareLinkBox')?.hidden === false", 'share link');
  const sharedUrl = await evaluate("document.querySelector('#shareLinkInput').value");
  assert.match(sharedUrl, /shared-evaluation\.html#[a-f0-9]{48}$/);
  assert.equal(await evaluate('window.__copied'), sharedUrl);
  const beforeShareStarts = starts.length;
  await navigate(sharedUrl.replace('#', '?name=DifferentPlayer&sourceId=99#'), "document.querySelector('#report')?.hidden === false", 'recipient report');
  assert.equal(await evaluate("document.querySelector('#playerTitle').textContent"), 'FixtureWarrior');
  assert.equal(await evaluate("!!document.querySelector('nav, .back-link, #identityForm, #refreshBtn, #nightSelect, #shareBtn')"), false);
  assert.match(await evaluate("document.querySelector('#fightReport').innerText"), /Make these changes/);
  assert.match(await evaluate("document.querySelector('#nightOverview').innerText"), /Night overview/i);
  assert.equal(starts.length, beforeShareStarts, 'recipient does not build or select another report');
  assert.equal(await evaluate("[...document.querySelectorAll('a[href]')].some(a => a.origin === location.origin)"), false);
  await evaluate("document.querySelector('#copyPlanBtn').click()");
  await waitFor("window.__copied?.includes('Coaching change')", 'recipient plan copy');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await navigate(`http://127.0.0.1:${port}/shared-evaluation.html#bad`, "document.querySelector('#errorBox')?.hidden === false", 'invalid shared link');
  assert.equal(await evaluate("!!document.querySelector('nav, #identityForm')"), false);
  pass('Player links show only the saved report, ignore identity changes, support copying/mobile and fail closed');
  assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
  pass('Expired jobs can be rebuilt; no browser runtime errors');
} finally {
  if (socket) socket.close();
  if (chrome) { chrome.kill('SIGTERM'); await Promise.race([new Promise(resolveExit => chrome.once('exit', resolveExit)), sleep(3000)]); }
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
