import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof WebSocket === "undefined") throw new Error("tactics-browser.test.mjs requires Node 22 or newer (global WebSocket is required)");
const root = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const allowed = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff", ".woff2"]);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2" };

let server;
let chrome;
let profile;
let socket;
let id = 0;
const pending = new Map();
const browserErrors = [];

function pass(message) { console.log(`PASS ${message}`); }
function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

async function startServer() {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/tactics.html" : url.pathname);
      if (pathname.split("/").some((part) => part.startsWith(".")) || !allowed.has(extname(pathname).toLowerCase())) {
        res.writeHead(404).end("Not found"); return;
      }
      const file = resolve(root, `.${normalize(pathname)}`);
      if (file !== root && !file.startsWith(`${root}/`)) { res.writeHead(404).end("Not found"); return; }
      await stat(file);
      res.writeHead(200, { "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end("Not found"); }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return server.address().port;
}

async function startChrome() {
  profile = await mkdtemp(join(tmpdir(), "supremus-browser-"));
  const candidates = Array.isArray(chromePath()) ? chromePath() : [chromePath()];
  let lastError;
  for (const bin of candidates) {
    try {
      chrome = spawn(bin, ["--headless=new", "--remote-debugging-port=0", "--window-size=1600,1100", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], { stdio: "ignore" });
      await Promise.race([new Promise((_, reject) => chrome.once("error", reject)), sleep(150)]);
      if (chrome.exitCode == null) break;
    } catch (error) { lastError = error; chrome = undefined; }
  }
  if (!chrome) throw new Error(`Could not launch Chrome${lastError ? `: ${lastError.message}` : ""}. Set CHROME_BIN.`);
  const activePort = join(profile, "DevToolsActivePort");
  let contents;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { contents = await readFile(activePort, "utf8"); break; } catch { await sleep(100); }
  }
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

async function key(keyValue, code = keyValue) {
  const windowsVirtualKeyCode = keyValue === "ArrowRight" ? 39 : keyValue.toLowerCase() === "r" ? 82 : keyValue === " " ? 32 : 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: keyValue, code, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, windowsVirtualKeyCode });
}

async function reload(wait = 1000) { await send("Page.reload"); await sleep(wait); assert.equal(await evaluate("typeof __tactics"), "object"); }

async function waitForPresenter() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("typeof __tactics === 'object' && fx.width > 0 && fx.height > 0 && [...document.images].every(img => img.complete)")) return;
    await sleep(100);
  }
  throw new Error("Presenter map did not become ready");
}

async function run() {
  const port = await startServer();
  await startChrome();
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html` });
  await waitForPresenter();
  assert.equal(await evaluate("typeof __tactics"), "object", "presenter loaded"); pass("presenter loaded");

  const spread = await evaluate(`(()=>{const a=__tactics,s=a.scenes.find(s=>s.id==='swap'),start=a.simulate(s,0).pos,before=a.simulate(s,4950).pos,after=a.simulate(s,7500).pos;return s.raid.map(p=>({kind:p.kind,before:TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],start[p.id],before[p.id]),after:TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],start[p.id],after[p.id])}))})()`);
  assert(spread.filter(p => p.kind === 'tank').every(p => p.before < 0.01 && p.after > 1), 'tanks hold until fixate, then move');
  assert(spread.filter(p => p.kind === 'melee').every(p => p.before > 1), 'melee spreads before fixate'); pass('melee spreads early while tanks hold until fixate');
  await evaluate('__tactics.show(2)');
  assert.equal(await evaluate('sceneSpells.hidden'), false);
  assert.match(await evaluate('sceneSpells.textContent'), /Hateful Strike.*Melee Range.*27,750/s); pass('active spell details visible without opening reference');
  await evaluate('__tactics.show(3)');
  assert.match(await evaluate('sceneSpells.textContent'), /Molten Flame/);
  assert.equal(await evaluate('sceneSpells.textContent.includes("Hateful Strike")'), false); pass('spell cards follow the active scene');

  const geometry = await evaluate(`(()=>{const a=__tactics,out={bounds:[],gaps:{},volcanoHits:[],pickup:[]};a.scenes.forEach((s,i)=>{a.show(i);a.playback.pause(performance.now());let min=999;for(let t=0;t<=s.duration;t+=250){a.playback.seek(t,performance.now());a.render(performance.now());for(const actorId of ['boss',...Object.values(s.cast)]){const p=actorId==='boss'?s._sim.boss:s._sim.pos[actorId];if(!p)continue;const q=a.px(p),r=fx.getBoundingClientRect();if(q.x<20||q.y<20||q.x>r.width-20||q.y>r.height-20)out.bounds.push({scene:s.id,t,id:actorId});}const dist=(x,y)=>TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],x,y);const gaze=s.effects.find(e=>e.kind==='gaze'&&t>=e.start&&t<e.end);if(gaze){const p=s._sim.pos[s.cast[gaze.target]];if(p){min=Math.min(min,dist(p,s._sim.boss));s.effects.filter(e=>e.kind==='volcano'&&t>=e.start&&t<=e.end).forEach(e=>{if(dist(p,e.at)<e.radiusYards)out.volcanoHits.push({scene:s.id,t});});}}}if(min!==999)out.gaps[s.id]=min;});const s=a.scenes.find(x=>x.id==='back');for(const t of [5000,7500,8500]){const sim=a.simulate(s,t),dist=(x,y)=>TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],x,y);out.pickup.push({t,tanks:s.raid.filter(p=>p.kind==='tank').map(p=>dist(sim.pos[p.id],sim.boss)),melee:s.raid.filter(p=>p.kind==='melee').map(p=>dist(sim.pos[p.id],sim.boss))});}return out})()`);
  assert.equal(geometry.bounds.length, 0, "sample-scene actors remain visible"); pass("sample-scene actors remain visible");
  assert.equal(geometry.volcanoHits.length, 0, "fixate routes avoid active volcanoes"); pass("fixate routes avoid active volcanoes");
  assert(Object.values(geometry.gaps).every((yards) => yards > 8), "fixate targets remain over 8 yards from boss"); pass("fixate targets remain over 8 yards from boss");
  const pickup = geometry.pickup.find((sample) => sample.t === 7500);
  assert(Math.min(...pickup.tanks) < Math.min(...pickup.melee), "tank pickup precedes melee return"); pass("tank pickup precedes melee return");

  await evaluate("__tactics.show(5);playPause.click()");
  const frozen = await evaluate("__tactics.scenes[5]._t"); await sleep(350);
  assert.equal(await evaluate("__tactics.scenes[5]._t"), frozen); pass("pause freezes scene time");
  await evaluate('scrub.value=50;scrub.dispatchEvent(new Event("input"))');
  assert.equal(await evaluate("__tactics.scenes[5]._t"), 10000); pass("seek lands on exact encounter time");
  assert.equal(await evaluate('clockP2.textContent.includes("50s")'), true); pass("scene clock follows seek");
  await evaluate("playPause.click()"); await sleep(1000);
  assert((await evaluate("__tactics.scenes[5]._t")) > 10000); pass("play resumes after seek");
  await evaluate("playPause.click();__tactics.playback.seek(20000,performance.now());__tactics.render(performance.now())"); await sleep(250);
  assert.equal(await evaluate("__tactics.scenes[5]._t"), 20000); pass("end frame holds");
  await evaluate('document.querySelectorAll("#dots button")[5].focus()'); await key("ArrowRight");
  assert.equal(await evaluate("stepTitle.textContent"), "Move everyone near the eruption"); pass("scene arrows work after chapter focus");
  await evaluate('scrub.value=50;scrub.dispatchEvent(new Event("input"));replay.focus()'); await key("r", "KeyR");
  assert((await evaluate("__tactics.scenes[6]._t")) < 1000); pass("replay shortcut works after button focus");

  const roster = [
    { name: "TankA", class: "WARRIOR", spec: "Protection" }, { name: "TankB", class: "PALADIN", spec: "Protection" },
    { name: "TankC", class: "DRUID", spec: "Guardian", mt: true }, { name: "Healer", class: "PRIEST", spec: "Holy" },
    { name: "Mage", class: "MAGE", spec: "Arcane" }
  ].map((player) => ({ ...player, flags: [], source: "manual" }));
  const state = JSON.stringify({ manual: roster, playerMeta: { TankC: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(state)})`); await reload();
  assert.equal(await evaluate("__tactics.assigned.length"), 5); assert.equal(await evaluate('__tactics.assigned.filter(p=>p.kind==="tank").length'), 3); assert.equal(await evaluate("__tactics.assigned[0].name"), "TankC"); pass("three-tank partial roster keeps flagged MT first without fillers");
  assert.equal(await evaluate(`(()=>{const a=__tactics;return a.scenes.every(s=>s.raid.every(p=>{const name=a.assigned.find(x=>x.id===p.id).name;return s.id==='p1-stand' ? p.label.includes(name) : !(p.label||'').includes(name)}))})()`), true); pass('names appear only on the positioning scene');
  await evaluate("__tactics.show(8)");
  assert.equal(await evaluate("__tactics.scenes[8].cast.md"), undefined); assert.equal(await evaluate('__tactics.scenes[8].effects.some(e=>e.kind==="threat")'), true); pass("no hunter means no Misdirect assignment");
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t},write:async items=>{window.__imageBlob=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}`);
  await evaluate("copyText.click()"); await sleep(100); assert((await evaluate("__copied")).includes("TankC"));
  await evaluate("__tactics.show(4);__tactics.playback.pause(performance.now());__tactics.playback.seek(6000,performance.now());__tactics.render(performance.now());copyText.click()");
  await sleep(100);
  assert((await evaluate("__copied")).includes("Phase 2")); pass("transition export follows the current encounter phase");
  await evaluate("copyImage.click()"); await sleep(1000); assert((await evaluate("__imageBlob.size")) > 1000); pass("text and PNG exports reach clipboard");

  roster.push({ name: "Hunter", class: "HUNTER", spec: "Beast Mastery", flags: [], source: "manual" });
  const hunterState = JSON.stringify({ manual: roster, playerMeta: { TankC: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(hunterState)})`); await reload();
  assert.equal(await evaluate("(()=>{const a=__tactics;return a.assigned.find(p=>p.id===a.scenes[8].cast.md).name})()"), "Hunter"); pass("actual hunter receives Misdirect");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await reload(); await evaluate("__tactics.show(5)");
  assert.equal(await evaluate("__tactics.playback.playing"), false); pass("reduced motion starts paused");
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
}

try {
  await run();
  console.log("Supremus browser regression passed");
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (chrome && chrome.exitCode == null) { chrome.kill("SIGTERM"); await Promise.race([new Promise((done) => chrome.once("exit", done)), sleep(2000)]); if (chrome.exitCode == null) { chrome.kill("SIGKILL"); await new Promise((done) => chrome.once("exit", done)); } }
  if (server) await new Promise((done) => server.close(done));
  if (profile) await rm(profile, { recursive: true, force: true });
}
