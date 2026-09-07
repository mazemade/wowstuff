import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
async function screenshot(name) {
  if (!process.env.TACTICS_SCREENSHOT_DIR) return;
  await mkdir(process.env.TACTICS_SCREENSHOT_DIR, { recursive: true });
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(process.env.TACTICS_SCREENSHOT_DIR, `${name}.png`), Buffer.from(result.data, "base64"));
}

async function showShade(id, time = 0) {
  await evaluate(`(()=>{const a=__tactics,i=a.scenes.findIndex(s=>s.id===${JSON.stringify(id)});if(i<0)throw Error('Missing Shade chapter');a.show(i);window.__shadeScene=a.scenes[i];a.playback.pause(performance.now());a.playback.seek(${time},performance.now());a.render(performance.now())})()`);
}

async function showReliquary(id, time = 0) {
  await evaluate(`(()=>{const a=__tactics,i=a.scenes.findIndex(s=>s.id===${JSON.stringify(id)});if(i<0)throw Error('Missing Reliquary chapter');a.show(i);const target=a.guided?.timelineFor(${JSON.stringify(id)},${time});if(target)a.showExplanation(target.index);window.__reliquaryScene=a.scenes[i];a.playback.pause(performance.now());a.playback.seek(target?target.elapsedMs:${time},performance.now());a.render(performance.now())})()`);
}

async function drawnReliquaryText() {
  return evaluate(`(()=>{const c=fx.getContext('2d'),original=c.fillText,drawn=[];c.fillText=function(value,...args){drawn.push(String(value));return original.call(this,value,...args)};try{__tactics.render(performance.now())}finally{c.fillText=original}return drawn.join('\\n')})()`);
}

async function checkReliquary(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=bt-reliquary`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.id'), 'bt-reliquary');
  assert.deepEqual(await evaluate('__tactics.scenes.map(s=>s.id)'), ['overview','positioning','fixate','suffering','souls','desire','interrupts','deaden','anger','spite','cycle']);
  assert.equal(await evaluate('bossNav.children[3].getAttribute("aria-current")'), 'page');
  assert.equal(await evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'), true);
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate(`(()=>{const a=__tactics;return a.scenes.every((s,i)=>{a.show(i);a.playback.pause(performance.now());return [...sceneSpells.querySelectorAll('a')].every(link=>link.href.startsWith('https://')&&!link.href.includes('undefined'))})})()`),true,'every spell card links to a real source');
  pass('Reliquary deep link loads eleven chapters, authentic art and the example raid');

  await showReliquary('interrupts');
  const interruptChapterTitle=await evaluate('stepTitle.textContent');
  await key('ArrowRight');
  assert.equal(await evaluate('stepTitle.textContent'),interruptChapterTitle,'Right advances one explanation inside the chapter');
  await key('ArrowLeft');
  assert.equal(await evaluate('stepTitle.textContent'),interruptChapterTitle,'Left returns to the previous explanation');
  pass('Reliquary arrow keys traverse explanations before changing chapters');

  const interruptSteps=await evaluate("__tactics.guided.steps.map((s,index)=>({...s,index})).filter(s=>s.sceneId==='interrupts')");
  assert.ok(interruptSteps.length>=5,'the interrupt sequence has separate readable explanations');
  const shieldStep=interruptSteps.find(s=>s.id==='rune-shield');
  assert.ok(shieldStep);
  await evaluate(`__tactics.showExplanation(${shieldStep.index})`);
  const stableLesson=await evaluate('JSON.stringify(__tactics.scenes.find(s=>s.id==="interrupts")._sim.teaching)');
  const stableExplanation=await evaluate('__tactics.guided.selectedIndex');
  await evaluate('(()=>{const a=__tactics,now=performance.now();a.render(now+60000);a.render(now+120000)})()');
  assert.equal(await evaluate('__tactics.guided.selectedIndex'),stableExplanation,'elapsed time cannot advance the selected explanation');
  assert.equal(await evaluate('JSON.stringify(__tactics.scenes.find(s=>s.id==="interrupts")._sim.teaching)'),stableLesson,'reading text stays fixed after a long wait');
  assert.equal(await evaluate('scrub.getClientRects().length'),0,'teaching uses steps instead of a running timeline');
  assert.equal(await evaluate('speed.getClientRects().length'),0);
  assert.match(await evaluate('document.querySelector(".transport").innerText'),/Explanation\s+\d+\s+of\s+\d+/i);
  await evaluate('replay.click()');
  assert.equal(await evaluate('__tactics.guided.selectedIndex'),stableExplanation,'Replay repeats only the current demonstration');
  assert.equal(await evaluate('JSON.stringify(__tactics.scenes.find(s=>s.id==="interrupts")._sim.teaching)'),stableLesson);
  pass('Reliquary explanations stay selected and readable until the user advances');

  const tonguesStep=interruptSteps.find(s=>s.id==='tongues');
  await evaluate(`__tactics.showExplanation(${tonguesStep.index})`);
  const loopFrames=await evaluate('(()=>{const a=__tactics,n=performance.now(),s=a.scenes.find(s=>s.id==="interrupts");a.playback.play(n);a.render(n+10000);const first=JSON.parse(JSON.stringify(s._sim));a.render(n+10450);const second=JSON.parse(JSON.stringify(s._sim));a.playback.pause(n+10450);return [first,second]})()');
  assert.notEqual(loopFrames[0].effectLoopProgress,loopFrames[1].effectLoopProgress,'the held demonstration still animates its harmless effect');
  assert.deepEqual(loopFrames[0].pos,loopFrames[1].pos,'effect repetition cannot reset completed positions');
  assert.deepEqual(loopFrames[0].hp,loopFrames[1].hp);
  assert.deepEqual(loopFrames[0].teaching,loopFrames[1].teaching);
  const countdownStep=await evaluate("__tactics.guided.steps.map((s,index)=>({...s,index})).find(s=>s.id==='spite-countdown')");
  await evaluate(`__tactics.showExplanation(${countdownStep.index})`);
  const countdownLesson=await evaluate('JSON.stringify(__tactics.scenes.find(s=>s.id==="spite")._sim.teaching)');
  await evaluate('(()=>{const a=__tactics,n=performance.now();a.playback.pause(n);a.playback.seek(60000,n);a.render(n)})()');
  assert.equal(await evaluate('__tactics.scenes.find(s=>s.id==="spite")._sim.spite.every(m=>m.impacted)'),true,'the six-second demonstration finishes at the impact');
  assert.equal(await evaluate('JSON.stringify(__tactics.scenes.find(s=>s.id==="spite")._sim.teaching)'),countdownLesson);
  assert.match(await drawnReliquaryText(),/impact.*resolved|impact.*0s|impact.*landed|impact now/i,'countdown resolution remains visible on the map');
  assert.equal(await evaluate('__tactics.playback.playing'),false,'timed demonstrations hold rather than restarting themselves');
  pass('harmless effects repeat without undoing state, while the Spite countdown completes once');

  await evaluate(`__tactics.showExplanation(${interruptSteps.at(-1).index})`);
  await evaluate('next.click()');
  assert.equal(await evaluate('__tactics.guided.steps[__tactics.guided.selectedIndex].sceneId'),'deaden');
  await evaluate('prev.click()');
  assert.equal(await evaluate('__tactics.guided.selectedIndex'),interruptSteps.at(-1).index,'Previous crosses back to the previous chapter final explanation');
  await evaluate('dots.children[6].click()');
  assert.equal(await evaluate('__tactics.guided.selectedIndex'),interruptSteps[0].index,'chapter tabs start at the first explanation');
  const beforeInput=await evaluate('__tactics.guided.selectedIndex');
  await evaluate("(()=>{const input=document.createElement('input');input.id='guidedInputGuard';document.body.append(input);input.focus()})()");
  await key('ArrowRight');
  assert.equal(await evaluate('__tactics.guided.selectedIndex'),beforeInput,'arrows in editable controls keep their editing behavior');
  await evaluate('guidedInputGuard.remove()');
  pass('Reliquary chapter boundaries, direct chapter selection and keyboard guards remain predictable');

  assert.equal(await evaluate('roleNotes.getClientRects().length'),0,'Reliquary uses the rail for reference, not required instructions');
  const visualSequence = [];
  for (const time of [0,1000,2500,3000,6000,7000,8500,10000]) {
    await showReliquary('interrupts',time);
    visualSequence.push(await drawnReliquaryText());
  }
  const visualLesson = visualSequence.join('\n');
  assert.match(visualLesson,/Warlock/i,'the Warlock is identified in the animation');
  assert.match(visualLesson,/Tongues/i);
  assert.match(visualLesson,/slow|reaction|longer/i,'the animation explains why Tongues helps');
  assert.match(visualLesson,/Mage/i);
  assert.match(visualLesson,/Spellsteal|spell steal/i,'the animation explains the Mage action');
  assert.match(visualLesson,/kick|interrupt/i);
  await showReliquary('interrupts',6000);
  assert.match(await drawnReliquaryText(),/blocks interrupts/i);
  assert.doesNotMatch(await drawnReliquaryText(),/STOPPED|completed Spirit Shock/i,'old kick result cannot cover the shield warning');
  await showReliquary('interrupts',7500);
  assert.match(await drawnReliquaryText(),/Rune Shield/i);
  assert.match(await drawnReliquaryText(),/Spellsteal/i);
  await showReliquary('interrupts',10000);
  assert.match(await drawnReliquaryText(),/stopped/i);
  pass('Reliquary teaches Tongues, Spellsteal and interrupts in the animation with a reference-only rail');

  const invalid = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];const check=(s,t)=>{a.playback.pause(performance.now());a.playback.seek(t,performance.now());a.render(performance.now());const f=s._sim;for(const p of [f.boss,...Object.values(f.pos),...(f.souls||[]).filter(s=>!s.dead).map(s=>s.at)]){const q=a.px(p);if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<8||q.y<8||q.x>b.width-8||q.y>b.height-8)bad.push([s.id,t,p]);}if(sceneCall.textContent!==(f.explanation?f.explanation.title:f.call)||(!f.explanation&&!encounterState.textContent.includes(a.fight.stateLabels[f.stage])))bad.push(['state',s.id,t]);};a.guided.steps.forEach((step,index)=>{a.showExplanation(index);const s=a.scenes.find(s=>s.id===step.sceneId);for(const t of [0,500,3000,60000])check(s,t);});const cycle=a.scenes.find(s=>s.id==='cycle');a.show(a.scenes.indexOf(cycle));for(let t=0;t<=cycle.duration;t+=1000)check(cycle,t);return bad})()`);
  assert.deepEqual(invalid, [], 'Reliquary raid positions, calls and state stay visible and synchronized');
  pass('all Reliquary chapters remain drawable and synchronized across direct seeks');

  await showReliquary('fixate', 4999);
  const beforeTarget = await evaluate('__reliquaryScene._sim.bossTarget');
  await showReliquary('fixate', 5000);
  assert.notEqual(await evaluate('__reliquaryScene._sim.bossTarget'), beforeTarget);
  assert.equal(await evaluate(`(()=>{const a=__tactics,f=__reliquaryScene._sim,d=TacticsLayout.dist(a.fight,f.pos[f.bossTarget],f.boss);return Object.entries(f.pos).every(([id,p])=>id===f.bossTarget||TacticsLayout.dist(a.fight,p,f.boss)>d)})()`), true);
  pass('Suffering visibly selects the closest receiving tank at Fixate');

  await showReliquary('fixate', 4000);
  const rotationBefore = await drawnReliquaryText();
  assert.match(rotationBefore, /next/i, 'the next receiver is visible in the animation');
  const exampleTanks = await evaluate('[...roleNotes.querySelectorAll("dd")].slice(0,2).map(n=>n.textContent.split(" — ")[0])');
  assert.notEqual(exampleTanks[0], exampleTanks[1], 'example current and next tanks have distinct identities');
  await showReliquary('fixate', 5500);
  assert.notEqual(await drawnReliquaryText(), rotationBefore, 'visible tank instructions follow the handoff');
  const sufferingFrames = [];
  for (const index of await evaluate("__tactics.guided.steps.map((s,index)=>({s,index})).filter(({s})=>s.sceneId==='suffering').map(({index})=>index)")) { await evaluate(`__tactics.showExplanation(${index})`); sufferingFrames.push(await drawnReliquaryText()); }
  const sufferingGuide = sufferingFrames.join('\n');
  assert.match(sufferingGuide, /DPS|damage/i);
  assert.match(sufferingGuide, /45|0:45/);
  assert.match(sufferingGuide, /15|1:00/);
  pass('Suffering shows the live tank rotation and the guild Enrage and healer priorities');

  const phaseOrder = [];
  for (const time of [0,21000,33000,61000,73000]) {
    await showReliquary('cycle', time);
    phaseOrder.push(await evaluate('String(__reliquaryScene._sim.essence).toLowerCase()'));
  }
  assert.equal(await evaluate('__tactics.guided.isGuided()'),false,'the final cycle remains continuous');
  assert.equal(await evaluate('scrub.getClientRects().length'),1);
  assert.equal(await evaluate('speed.getClientRects().length'),1);
  assert.equal(await evaluate('manualProgress.getClientRects().length'),0,'continuous playback cannot show stale explanation progress');
  assert.equal(phaseOrder[0], 'suffering'); assert.equal(phaseOrder[2], 'desire'); assert.equal(phaseOrder[4], 'anger');
  assert.notEqual(phaseOrder[1], 'suffering'); assert.notEqual(phaseOrder[3], 'desire');
  await showReliquary('interrupts', 6000);
  assert(await evaluate('!!__reliquaryScene._sim.shield?.active'));
  const exampleKicks = await evaluate('[...roleNotes.querySelectorAll("dd")].slice(0,2).map(n=>n.textContent.split(" — ")[0])');
  assert.notEqual(exampleKicks[0], exampleKicks[1], 'example kickers have distinct identities');
  await showReliquary('interrupts', 7500);
  assert.equal(await evaluate('!!__reliquaryScene._sim.shield?.active'), false);
  await showReliquary('anger', 4000);
  assert(await evaluate('!!__reliquaryScene._sim.seethe?.active'));
  await showReliquary('anger', 14000);
  assert(await evaluate('!!__reliquaryScene._sim.scream?.active'));
  pass('full cycle includes both soul intermissions, shield removal and Anger mechanics');

  await showReliquary('anger', 1999);
  assert.match(await drawnReliquaryText(), /off.tank|\bOT\b/i);
  await showReliquary('anger', 2000);
  assert.match(await drawnReliquaryText(), /taunt/i);
  await showReliquary('anger', 5999);
  assert.equal(await evaluate('__reliquaryScene._sim.lust.active'), false);
  await showReliquary('anger', 6000);
  assert.equal(await evaluate('__reliquaryScene._sim.lust.active'), true);
  assert.equal(await evaluate('__reliquaryScene._sim.seethe.active'), true, 'the raid starts before the ten-second Seethe expires');
  assert.match(await drawnReliquaryText(), /Bloodlust|Lust/);
  pass('Anger visibly teaches OT pickup, MT taunt and the guild damage and Bloodlust timing');

  const tips = [];
  for (const index of await evaluate("__tactics.guided.steps.map((s,index)=>({...s,index})).filter(s=>['spell-reflection','deadly-throw','anger-preparation','soul-scream','spite-healthstone','desire-damage','desire-heal','mana-depletion'].includes(s.id)).map(s=>s.index)")) {
    await evaluate(`__tactics.showExplanation(${index})`); tips.push(await drawnReliquaryText());
  }
  const visualTips=tips.join('\n');
  for(const concept of [/Reflection/i,/Deadly Throw/i,/Shadow Protection/i,/healthstone/i,/2:40/,/50%|fifty percent/i,/doubled/i]) assert.match(visualTips,concept,'guild tips belong inside the visual lesson: '+concept);
  pass('the animation includes the guild utility, survival and resource tips');

  for (const [width,height] of [[1600,1100],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    await showReliquary('interrupts',6000);
    await evaluate('scrollTo(0,0)');
    if(width<500) {
      assert.equal(await evaluate('(()=>{const b=next.getBoundingClientRect();return b.width>0&&b.top>=0&&b.bottom<=innerHeight})()'),true,'phone Next remains reachable while viewing the animation');
      assert.equal(await evaluate('(()=>{const b=playPause.getBoundingClientRect();return b.width>0&&b.top>=0&&b.bottom<=innerHeight})()'),true,'phone users can pause and resume the current demonstration');
      await screenshot('reliquary-manual-phone-controls');
    }
    for (const [chapter,time] of [['positioning',0],['fixate',5000],['souls',5500],['interrupts',6000],['anger',14000],['spite',8500],['spite',9500]]) {
      await showReliquary(chapter,time); await sleep(60);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,chapter+' has no overflow at '+width);
      await screenshot('reliquary-'+chapter+'-'+time+'-'+width);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Reliquary positioning and mechanics support desktop and phone layouts');

  await showReliquary('cycle');
  await evaluate("scrub.value='50';scrub.dispatchEvent(new Event('input'))");
  assert.equal(await evaluate('__reliquaryScene._t'),50000);
  assert.equal(await evaluate('__tactics.playback.playing'),false);
  assert.equal(await evaluate(`(()=>{speed.value='2';speed.dispatchEvent(new Event('change'));const a=__tactics.playback,now=performance.now();a.play(now);const delta=a.time(now+100)-a.time(now);a.pause(now);return delta})()`),200);
  await showReliquary('cycle',100000); await sleep(100);
  assert.equal(await evaluate('__reliquaryScene._t'),100000);
  assert.equal(await evaluate('__reliquaryScene._sim.stage'),'complete');
  assert.equal(await evaluate('__reliquaryScene._sim.pressure'),0);
  assert.equal(await evaluate('__reliquaryScene._sim.tankResource'),null);
  assert.equal(await evaluate('__reliquaryScene._sim.spite.length+__reliquaryScene._sim.shadowPulses.length'),0);
  assert.equal(await evaluate('roleNotes.children.length'),0,'victory has no stale live assignments');
  await key('r','KeyR'); assert((await evaluate('__reliquaryScene._t'))<1500);
  await key('ArrowLeft'); assert.match(await evaluate('stepTitle.textContent'),/Spite|marks|burn/i);
  await evaluate("speed.value='2';speed.dispatchEvent(new Event('change'))");
  await evaluate('document.activeElement.blur()');
  await key(' ','Space'); assert.equal(await evaluate('__tactics.playback.playing'),false);
  await key(' ','Space'); assert.equal(await evaluate('__tactics.playback.playing'),true);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await reload();
  await evaluate("__tactics.show(__tactics.scenes.findIndex(s=>s.id==='cycle'))");
  assert.equal(await evaluate('__tactics.playback.playing'),false);
  await send('Emulation.setEmulatedMedia',{features:[]});
  pass('Reliquary holds completion, replays and retains keyboard, speed and reduced-motion controls');

  const roster = JSON.stringify({manual:[
    {name:'ReliquaryMT',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'},
    {name:'ReliquaryOT',class:'DRUID',spec:'Guardian',flags:[],source:'manual'},
    {name:'ReliquaryHealer',class:'PRIEST',spec:'Holy',flags:[],source:'manual'},
    {name:'ReliquaryKick',class:'ROGUE',spec:'Combat',flags:[],source:'manual'},
    {name:'ReliquaryMage',class:'MAGE',spec:'Arcane',flags:[],source:'manual'},
    {name:'ReliquaryLust',class:'SHAMAN',spec:'Elemental',flags:[],source:'manual'},
    {name:'ReliquaryTongues',class:'WARLOCK',spec:'Destruction',flags:[],source:'manual'}
  ],playerMeta:{ReliquaryMT:{mt:true}}});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(roster)})`); await reload();
  await showReliquary('positioning');
  assert.equal(await evaluate('__tactics.assigned.length'),7);
  assert.equal(await evaluate('__reliquaryScene.raid.every(p=>p.label.includes(p.name))'),true);
  await screenshot('reliquary-named-positioning-1600');
  await showReliquary('interrupts', 0);
  const assignedInterrupts = await evaluate('roleNotes.innerText');
  assert.match(await drawnReliquaryText(),/ReliquaryTongues/);
  assert.match(assignedInterrupts, /ReliquaryTongues/);
  assert.match(assignedInterrupts, /Curse of Tongues/i);
  assert.match(await drawnReliquaryText(), /reaction|lengthen|longer|slow/i);
  assert.match(assignedInterrupts, /ReliquaryKick/);
  assert.match(assignedInterrupts, /next|order/i);
  await showReliquary('interrupts', 6000);
  const shieldInstructions = await evaluate('roleNotes.innerText');
  assert.match(shieldInstructions, /ReliquaryMage/);
  assert.match(shieldInstructions, /Spellsteal|spell steal/i);
  assert.equal(await evaluate('__reliquaryScene.raid.find(p=>p.id===__reliquaryScene.remover).name'),'ReliquaryMage');
  await showReliquary('interrupts',7500);
  assert.match(await drawnReliquaryText(),/ReliquaryMage/);
  await screenshot('reliquary-named-shield-1600');
  await showReliquary('interrupts', 8000);
  assert.notEqual(await evaluate('roleNotes.innerText'), assignedInterrupts);
  pass('named kick order, Mage Spellsteal and useful Curse of Tongues are visible without exporting');
  await evaluate(`(()=>{window.__reliquaryExports=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>__reliquaryExports.push(t),write:async items=>window.__reliquaryImage=await items[0].getType('image/png')}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}})()`);
  for (const [chapter,time] of [['souls',5500],['interrupts',7500],['spite',9500],['cycle',100000]]) {
    await showReliquary(chapter,time); await evaluate('copyText.click();copyImage.click()'); await sleep(150);
    const output=await evaluate('__reliquaryExports.at(-1)');
    assert(output.includes(await evaluate('sceneCall.textContent')));
    for(const name of ['ReliquaryMT','ReliquaryOT','ReliquaryHealer','ReliquaryKick','ReliquaryMage','ReliquaryLust','ReliquaryTongues']) assert(output.includes(name));
    assert((await evaluate('__reliquaryImage.size'))>1000);
    if(chapter==='cycle') assert.doesNotMatch(output,/Use Bloodlust|Kick next|Dispel Soul Drain|Hold threat|Burn Anger|Hold Anger|Wait behind the boss/i);
    if(chapter==='spite') assert.match(output,/ReliquaryHealer — [^\n]*(heal|cover|recover)/i,'the healer keeps a healing job during the burn');
  }
  pass('Reliquary preserves named roster and exports current jobs, calls and map through completion');

  await showReliquary('spite',9500);
  await evaluate(`(()=>{window.__reliquaryDownloads=[];window.__reliquaryBlobs=[];URL.createObjectURL=b=>{__reliquaryBlobs.push(b);return 'blob:reliquary-'+__reliquaryBlobs.length};HTMLAnchorElement.prototype.click=function(){__reliquaryDownloads.push(this.download)};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')},write:async()=>{throw Error('blocked')}}})})()`);
  await evaluate('copyText.click();copyImage.click()'); await sleep(200);
  assert.deepEqual(await evaluate('__reliquaryDownloads.sort()'),['reliquary-briefing-spite.txt','reliquary-spite.png']);
  assert.match(await evaluate('__reliquaryBlobs[0].text()'),/ReliquaryMT[\s\S]*ReliquaryMage/);
  pass('Reliquary clipboard fallback saves the current briefing and PNG');

  const onlyTank=JSON.stringify({manual:[{name:'OnlyReliquaryTank',class:'DRUID',spec:'Guardian',mt:true,flags:[],source:'manual'}],playerMeta:{OnlyReliquaryTank:{mt:true}}});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(onlyTank)})`); await reload();
  await showReliquary('cycle',100000);
  assert.equal(await evaluate('__tactics.assigned.length'),1);
  assert.notEqual(await evaluate('__reliquaryScene._sim.stage'),'complete');
  assert.match(await evaluate('rosterNote.textContent'),/damage/i);
  await showReliquary('interrupts',7500);
  assert.equal(await evaluate('!!__reliquaryScene._sim.shield?.active'),true);
  assert.doesNotMatch(await evaluate('roleNotes.innerText'),/completed Spirit Shock|completed kick/i,'missing interrupt coverage never shows a completed kick');
  await showReliquary('anger',3000);
  assert.doesNotMatch(await evaluate('sceneCall.textContent + roleNotes.innerText'),/taunted at|OT pickup\. Damage waits/i,'a lone tank is not shown completing a two-tank taunt');
  pass('Reliquary partial roster cannot fabricate damage kills or Rune Shield removal');
}

async function run() {
  const port = await startServer();
  await startChrome();
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?fight=bt-supremus` });
  await waitForPresenter();
  assert.equal(await evaluate("typeof __tactics"), "object", "presenter loaded"); pass("presenter loaded");
  assert.match(await evaluate("referenceContent.textContent"), /Hateful Strike[\s\S]*Phase 1/);
  assert.match(await evaluate("referenceContent.textContent"), /From the guild’s strategy image/); pass("Supremus reference retains ability names, phase, and source heading");

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

  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?fight=bt-najentus` }); await waitForPresenter();
  await evaluate("__tactics.render(performance.now())");
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  assert.equal(await evaluate("document.querySelectorAll('#dots button').length"), 7);
  assert.match(await evaluate("document.title"), /Naj.entus/);
  assert.equal(await evaluate("clock.hidden"), true);
  assert.match(await evaluate("encounterState.textContent"), /Normal combat/); pass("Najentus routing selects its seven-state presenter");
  assert.match(await evaluate("referenceContent.textContent"), /Needle Spine[\s\S]*Normal combat/);
  assert.match(await evaluate("referenceContent.textContent"), /Hurl Spine[\s\S]*Shield break/); pass("Najentus reference uses ability stages and real spell names");
  assert.equal(await evaluate("[...document.images].every(i => i.complete && i.naturalWidth > 0)"), true, "Najentus local portrait and spell art load");
  await evaluate("document.querySelector('.boss-tab[href*=\"bt-supremus\"]').click()"); await sleep(250); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-supremus"); await evaluate("history.back()"); await sleep(250); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus"); pass("boss anchors navigate and browser back restores Najentus");
  await evaluate("__tactics.show(1);__tactics.playback.pause(performance.now());__tactics.render(performance.now())"); await screenshot("najentus-positioning-1600");
  await evaluate("__tactics.show(3);__tactics.playback.pause(performance.now());__tactics.playback.seek(4000,performance.now());__tactics.render(performance.now())"); await screenshot("najentus-extraction-1600");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.playback.seek(60000,performance.now());__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Shield: heal up/);
  assert.equal(await evaluate("__tactics.scenes[6]._sim.shield"), true);
  assert.equal(await evaluate("Object.keys(__tactics.scenes[6]._sim.focus).length"), await evaluate("__tactics.scenes[6].raid.length"));
  await screenshot("najentus-shield-1600");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate("__tactics.render(performance.now())"); await screenshot("najentus-shield-1280");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "laptop view has no horizontal overflow");
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate("__tactics.playback.seek(65000,performance.now());__tactics.render(performance.now())");
  assert.match(await evaluate("sceneCall.textContent"), /Raid ready/);
  await evaluate("__tactics.playback.seek(67000,performance.now());__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Spine in flight/);
  await evaluate("__tactics.playback.seek(67700,performance.now());__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Raidwide burst/);
  assert.equal(await evaluate("__tactics.scenes[6]._sim.burst.damage"), 8500); pass("Najentus seek keeps state, call and burst on the same frame");
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__najText=t},write:async items=>{window.__najBlob=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}");
  await evaluate("copyText.click();copyImage.click()"); await sleep(1000);
  assert.match(await evaluate("__najText"), /Raidwide hit\. Heal everyone\.[\s\S]*State: burst/); assert((await evaluate("__najBlob.size")) > 1000); pass("Najentus text and PNG exports carry the current call and stage");
  await screenshot("najentus-burst-1600");
  await evaluate("__tactics.show(5);__tactics.playback.pause(performance.now());__tactics.render(performance.now());__tactics.show(0);__tactics.show(5);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("sceneCall.textContent"), await evaluate("__tactics.scenes[5]._sim.call"));
  assert.equal(await evaluate("mapCall.textContent"), await evaluate("__tactics.scenes[5]._sim.call")); pass("Najentus current call refreshes when revisiting a scene");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.playback.seek(67700,performance.now());__tactics.render(performance.now())");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("__tactics.render(performance.now())"); await screenshot("najentus-burst-390");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "phone view has no horizontal overflow");
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate("localStorage.removeItem('raidAssignmentsState')"); await reload();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  assert.equal(await evaluate("__tactics.assigned.length"), 25); await evaluate("__tactics.show(0);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  await screenshot("najentus-overview-default25-1600"); pass("Najentus default 25-player illustration remains available");
  const bounds = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];a.scenes.forEach((s,i)=>{a.show(i);a.playback.pause(performance.now());const q=[0,s.duration,...(s.sequence.needles||[]).map(x=>x.at),...(s.sequence.impales||[]).flatMap(x=>[x.at,x.extractAt,x.homeAt]),...(s.sequence.shield?[s.sequence.shield.at,s.sequence.shield.readyAt,s.sequence.shield.throwAt,s.sequence.shield.hitAt,s.sequence.shield.recoverAt]:[])].filter(Number.isFinite);q.forEach(t=>{a.playback.seek(t,performance.now());a.render(performance.now());['boss',...s.raid.map(p=>p.id)].forEach(id=>{const p=id==='boss'?s._sim.boss:s._sim.pos[id],v=a.px(p);if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.y<0||v.x>b.width||v.y>b.height)bad.push([s.id,t,id]);});});});return bad})()`);
  assert.equal(bounds.length, 0, "default raid actors remain framed at every authored event boundary"); pass("Najentus boundary frames remain finite and visible");
  const najRoster = JSON.stringify({ manual: [
    { name: "NamedMT", class: "WARRIOR", spec: "Protection", mt: true, flags: [], source: "manual" },
    { name: "NamedHeal", class: "PRIEST", spec: "Holy", flags: [], source: "manual" },
    { name: "NamedRange", class: "MAGE", spec: "Arcane", flags: [], source: "manual" }
  ], playerMeta: { NamedMT: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(najRoster)})`); await reload();
  await evaluate("__tactics.show(1);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("sceneCall.textContent.includes('One tank')"), true);
  assert.equal(await evaluate("__tactics.scenes[1].raid.every(p => !p.name || p.label.includes(p.name)) && !__tactics.scenes[1]._dim"), true); await screenshot("najentus-positioning-namedpartial-1600"); pass("Najentus positioning labels the actual partial roster");
  await evaluate(`(()=>{window.__downloads=[];window.__downloadBlobs=[];URL.createObjectURL=b=>{window.__downloadBlobs.push(b);return 'blob:najentus-'+window.__downloadBlobs.length};HTMLAnchorElement.prototype.click=function(){window.__downloads.push({name:this.download,href:this.href})};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')},write:async()=>{throw Error('blocked')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}})()`);
  await evaluate("copyText.click();copyImage.click()"); await sleep(1000);
  assert.deepEqual(await evaluate("__downloads.map(x=>x.name).sort()"), ["najentus-briefing-positioning.txt", "najentus-positioning.png"]);
  assert.match(await evaluate("__downloadBlobs[0].text()"), /One tank\. Use your space\.[\s\S]*NamedMT/);
  assert((await evaluate("__downloadBlobs[1].size")) > 1000); pass("Najentus rejected clipboard fallbacks use slugs and preserve briefing data");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.render(performance.now());window.__pauseQ=__tactics.scenes[6]._t"); await sleep(250);
  assert.equal(await evaluate("__tactics.scenes[6]._t"), await evaluate("__pauseQ"));
  await evaluate("__tactics.playback.seek(76000,performance.now());__tactics.render(performance.now())"); await sleep(200);
  assert.equal(await evaluate("__tactics.scenes[6]._t"), 76000); pass("Najentus pause and end frame hold exactly");
  const minimal = JSON.stringify({ manual: [{ name: "OnlyMT", class: "WARRIOR", spec: "Protection", mt: true, flags: [], source: "manual" }], playerMeta: { OnlyMT: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(minimal)})`); await reload(); await evaluate("__tactics.show(5);__tactics.playback.pause(performance.now());__tactics.playback.seek(5700,performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("__tactics.assigned.length"), 1); assert.equal(await evaluate("__tactics.scenes[5]._sim.burst"), null); assert.equal(await evaluate("__tactics.scenes[5]._sim.shield"), true);
  const oversized = JSON.stringify({ manual: Array.from({length: 29},(_,i)=>({name:'P'+i,class:i===0?'WARRIOR':'MAGE',spec:i===0?'Protection':'Arcane',mt:i===0,flags:[],source:'manual'})), playerMeta:{P0:{mt:true}} });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(oversized)})`); await reload(); await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("__tactics.assigned.length"), 29); assert.equal(await evaluate("Object.values(__tactics.scenes[6]._sim.pos).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))"), true); pass("Najentus MT-only and oversized browser rosters avoid phantom effects and remain drawable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await reload(); await evaluate("__tactics.show(6)");
  assert.equal(await evaluate("__tactics.playback.playing"), false); await send("Emulation.setEmulatedMedia", { features: [] }); pass("Najentus reduced motion opens paused");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?fight=constructor` }); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?fight=__proto__` }); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus"); pass("unknown and prototype fight ids fall back safely");
  await evaluate("localStorage.clear()");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html` }); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  assert.deepEqual(await evaluate("[...bossNav.children].map(a=>new URL(a.href).searchParams.get('fight'))"), ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary']);
  await evaluate("bossNav.children[2].click()"); await sleep(250); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-akama");
  assert.equal(await evaluate("__tactics.count"), 10);
  assert.deepEqual(await evaluate('__tactics.scenes.map(s=>s.id)'), ['overview','positioning','channelers','doorways','sorcerers','fire','walk','burn','cycle','aoe']);
  const shadeMeta = await evaluate('Object.fromEntries(__tactics.scenes.map(s=>[s.id,{duration:s.duration,...s.sequence}]))');
  assert.equal(await evaluate("bossNav.children[2].getAttribute('aria-current')"), 'page');
  assert.match(await evaluate("referenceContent.textContent"), /guild’s spreadsheet[\s\S]*Seed of Corruption/);
  assert.equal(await evaluate("[...document.images].every(i=>i.complete && i.naturalWidth>0)"), true);
  pass('boss order and default follow the raid; Shade has ten chapters, loaded art and spreadsheet source');

  const shadeBounds = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];a.scenes.forEach((s,i)=>{a.show(i);a.playback.pause(performance.now());for(let t=0;t<=s.duration;t+=500){a.playback.seek(t,performance.now());a.render(performance.now());const f=s._sim;[f.boss,f.akama,...Object.values(f.pos),...f.npcs.map(n=>n.at)].forEach(p=>{const v=a.px(p);if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<8||v.y<8||v.x>b.width-8||v.y>b.height-8)bad.push([s.id,t,p]);});if(sceneCall.textContent!==(f.explanation?f.explanation.title:f.call)||(!f.explanation&&!encounterState.textContent.includes(a.fight.stateLabels[f.stage])))bad.push(['state',s.id,t]);}});return bad})()`);
  assert.deepEqual(shadeBounds, [], 'Shade actors and state stay visible and synchronized through all scenes');
  pass('Shade scene boundary sampling keeps raid, NPCs and live guidance synchronized');
  await showShade('walk', shadeMeta.walk.gatherAt);
  const walkGather = await evaluate(`(()=>{const a=__tactics,s=__shadeScene,f=s._sim,adds=f.npcs.filter(n=>!['channeler','sorcerer'].includes(n.kind));return {stage:f.stage,target:f.damageTarget,channels:f.channels.length,boss:f.boss,bossHp:f.bossHp,akamaHp:f.akamaHp,addIds:adds.map(n=>n.id),tankGaps:s.tanks.map(id=>TacticsLayout.dist(a.fight,f.pos[id],f.boss)),addGaps:adds.map(n=>TacticsLayout.dist(a.fight,n.at,f.boss))}})()`);
  assert.equal(walkGather.channels, 0); assert.equal(walkGather.addIds.length, 7);
  assert.equal(walkGather.target, 'adds');
  assert.equal(walkGather.bossHp, 1); assert.equal(walkGather.akamaHp, 1);
  assert(walkGather.boss.y > .1 && walkGather.boss.y < .65);
  assert(walkGather.tankGaps.every(d=>d<=10) && walkGather.addGaps.every(d=>d<=16), 'tank-owned packs actually meet the moving Shade');
  await showShade('walk', shadeMeta.walk.cleanupAt-1);
  assert.deepEqual(await evaluate("__shadeScene._sim.npcs.filter(n=>!['channeler','sorcerer'].includes(n.kind)).map(n=>n.id)"), walkGather.addIds);
  pass('RP walk visibly gathers the same living add packs around the moving Shade before cleanup');

  await showShade('aoe', shadeMeta.aoe.stackAt);
  assert.equal(await evaluate('__shadeScene._sim.stage'), 'gather');
  assert.match(await evaluate('encounterState.textContent'), /Bring adds to Channelers/);
  assert.equal(await evaluate('__shadeScene._sim.npcs.filter(n=>n.kind!=="channeler").every(n=>n.hp===1)'), true);
  await showShade('aoe', shadeMeta.aoe.aoeAt+500);
  assert.equal(await evaluate('__shadeScene._sim.strategy'), 'channeler-aoe');
  assert.equal(await evaluate('__shadeScene._sim.damageTarget'), 'channels-and-adds');
  assert.equal(await evaluate('__shadeScene._sim.channels.length > 0 && !!__shadeScene._sim.aoe'), true);
  assert.equal(await evaluate('__shadeScene.tanks.every(id=>__shadeScene._sim.pos[id].y<.27)'), true);
  await showShade('aoe', shadeMeta.aoe.approachAt+1000);
  assert.equal(await evaluate('__shadeScene._sim.damageTarget'), 'shade');
  assert.equal(await evaluate('__shadeScene._sim.channels.length'), 0);
  assert.equal(await evaluate('__shadeScene._sim.npcs.length > 0 && __shadeScene._sim.npcs.length <= 2'), true);
  assert.equal(await evaluate('__shadeScene._sim.bossTarget'), null, 'Akama has not engaged during the RP walk');
  assert.equal(await evaluate(`(()=>{const a=__tactics,s=__shadeScene,t=s.sequence.approachAt,before=a.simulate(s,t-1),after=a.simulate(s,t+1);return s.tanks.every(id=>TacticsLayout.dist(a.fight,before.pos[id],after.pos[id])<.1)})()`), true, 'tanks carry their existing pack forward at release without snapping to the doors');
  pass('alternative gathers adds at live Channelers, shows AoE and switches focus to Shade while retaining survivors');
  for (const [chapter, time, name] of [['positioning',0,'positioning'],['channelers',4000,'channelers'],['doorways',6000,'doorways'],['sorcerers',5000,'sorcerer'],['fire',4000,'fire'],['walk',shadeMeta.walk.gatherAt,'walk-gather'],['walk',shadeMeta.walk.cleanupAt+500,'walk-cleanup'],['cycle',shadeMeta.cycle.gatherAt,'approach'],['burn',5000,'burn'],['aoe',shadeMeta.aoe.stackAt,'aoe-stack'],['aoe',shadeMeta.aoe.aoeAt+500,'aoe-cleave'],['aoe',shadeMeta.aoe.approachAt+1000,'aoe-release']]) {
    await showShade(chapter, time);
    await screenshot('akama-' + name + '-1600');
  }
  await showShade('cycle', shadeMeta.cycle.duration);
  await sleep(200);
  assert.equal(await evaluate('__shadeScene._t'), shadeMeta.cycle.duration);
  assert.match(await evaluate("sceneLabel.textContent"), /SHADE DEFEATED/);
  await key('r', 'KeyR');
  assert((await evaluate('__shadeScene._t')) < 1000);
  pass('Shade holds the final victory frame and replay restores the encounter');
  await key('ArrowRight');
  assert.match(await evaluate('stepTitle.textContent'), /Channelers.*cleave|AoE/i);
  assert.match(await evaluate("document.querySelector('#dots button[aria-current=step]').textContent"), /Alternative/i);
  await key('ArrowLeft');
  pass('keyboard navigation reaches the alternative after the standard full sequence');

  for (const [width,height] of [[1280,800],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<500});
    await showShade('doorways', 6000);
    await sleep(150); await screenshot('akama-doorways-' + width);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow at ' + width);
    assert.equal(await evaluate(`(()=>{const a=__tactics,s=__shadeScene,b=fx.getBoundingClientRect();return [s._sim.boss,s._sim.akama,...Object.values(s._sim.pos),...s._sim.npcs.map(n=>n.at)].every(p=>{const q=a.px(p);return q.x>=8&&q.y>=8&&q.x<=b.width-8&&q.y<=b.height-8})})()`), true, 'both doorways and all actors fit at ' + width);
    assert.match(await evaluate('sceneLabel.textContent'), /CONTROL THE HALLWAYS/);
    for (const [chapter,time] of [['walk',shadeMeta.walk.gatherAt],['aoe',shadeMeta.aoe.aoeAt+500]]) {
      await showShade(chapter,time); await screenshot('akama-'+chapter+'-'+width);
      assert.equal(await evaluate(`(()=>{const a=__tactics,f=__shadeScene._sim,b=fx.getBoundingClientRect();return [f.boss,f.akama,...Object.values(f.pos),...f.npcs.map(n=>n.at)].every(p=>{const q=a.px(p);return q.x>=8&&q.y>=8&&q.x<=b.width-8&&q.y<=b.height-8})})()`), true, chapter+' actors fit at '+width);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] }); await reload();
  await evaluate("__tactics.show(__tactics.scenes.findIndex(s=>s.id==='walk'))"); assert.equal(await evaluate('__tactics.playback.playing'), false);
  await evaluate("__tactics.show(__tactics.scenes.findIndex(s=>s.id==='aoe'))"); assert.equal(await evaluate('__tactics.playback.playing'), false);
  await send('Emulation.setEmulatedMedia', {features:[]});
  pass('Shade supports phone layout and reduced motion');

  const shadeRoster = JSON.stringify({ manual: [
    {name:'PaladinLeft',class:'PALADIN',spec:'Protection',mt:true,flags:[],source:'manual'},
    {name:'WarriorRight',class:'WARRIOR',spec:'Protection',flags:[],source:'manual'},
    {name:'DruidSupport',class:'DRUID',spec:'Guardian',flags:[],source:'manual'},
    {name:'AssignedHealer',class:'PRIEST',spec:'Holy',flags:[],source:'manual'},
    {name:'TrapHunter',class:'HUNTER',spec:'Beast Mastery',flags:[],source:'manual'}
  ],playerMeta:{PaladinLeft:{mt:true}}});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(shadeRoster)})`); await reload();
  await showShade('positioning');
  assert.equal(await evaluate('__tactics.assigned.length'), 5);
  assert.equal(await evaluate('__shadeScene.raid.every(p=>p.label.includes(p.name))'), true);
  assert.equal(await evaluate('__shadeScene._sim.traps.length'), 2);
  assert.equal(await evaluate('__shadeScene.tanks.length'), 3);
  assert.equal(await evaluate("__shadeScene.tankJobs[__tactics.assigned.find(p=>p.name==='DruidSupport').id]"), 'Right support');
  await screenshot('akama-positioning-namedpartial-1600');
  await evaluate(`(()=>{window.__exports=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>window.__exports.push(t),write:async items=>window.__image=await items[0].getType('image/png')}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}})()`);
  await showShade('cycle', shadeMeta.cycle.engageAt+4000);
  await evaluate('copyText.click();copyImage.click()');
  await sleep(300);
  const shadeExport = await evaluate('__exports[0]');
  assert.match(shadeExport, /Lust now[\s\S]*PaladinLeft[\s\S]*TrapHunter/);
  assert.doesNotMatch(shadeExport, /Hateful|Misdirect|spine|volcano/i);
  assert((await evaluate('__image.size')) > 1000);
  pass('Shade preserves named roster and exports the current burn call and image');
  await evaluate(`__tactics.playback.seek(${shadeMeta.cycle.duration},performance.now());copyText.click()`);
  await sleep(50);
  const completedExport = await evaluate('__exports[1]');
  assert.match(completedExport, /Shade defeated\. Akama survives\./);
  assert.doesNotMatch(completedExport, /\bLust\b|burn the Shade|hold surviving adds|heal assigned add tanks|clean up adds/i);
  pass('Shade victory exports completed roster jobs without stale combat instructions');
  for (const [chapter,time,target] of [['walk',shadeMeta.walk.gatherAt,'adds'],['aoe',shadeMeta.aoe.stackAt,'channels'],['aoe',shadeMeta.aoe.aoeAt+500,'channels-and-adds'],['aoe',shadeMeta.aoe.approachAt+1000,'shade']]) {
    await showShade(chapter,time);
    await evaluate('copyText.click();copyImage.click()'); await sleep(100);
    const current = await evaluate('__exports.at(-1)');
    assert(current.includes(await evaluate('sceneCall.textContent')));
    assert.equal(await evaluate('__shadeScene._sim.damageTarget'), target);
    assert.match(current, /PaladinLeft[\s\S]*TrapHunter/);
    if(chapter==='aoe') assert.match(current, /alternative|AoE/i);
    if(chapter==='aoe' && time===shadeMeta.aoe.stackAt) assert.match(current, /PaladinLeft — [^\n]*Channelers/);
    assert((await evaluate('__image.size'))>1000);
  }
  pass('walk and alternate-strategy exports follow the currently demonstrated jobs');
  await showShade('cycle', shadeMeta.cycle.engageAt+4000);
  await evaluate(`__tactics.playback.seek(${shadeMeta.cycle.engageAt+4000},performance.now());__tactics.render(performance.now())`);
  await evaluate(`(()=>{window.__downloads=[];window.__blobs=[];URL.createObjectURL=b=>{__blobs.push(b);return 'blob:akama-'+__blobs.length};HTMLAnchorElement.prototype.click=function(){__downloads.push(this.download)};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')},write:async()=>{throw Error('blocked')}}})})()`);
  await evaluate('copyText.click();copyImage.click()'); await sleep(250);
  assert.deepEqual(await evaluate('__downloads.sort()'), ['akama-briefing-cycle.txt','akama-cycle.png']);
  assert.match(await evaluate('__blobs[0].text()'), /Lust now[\s\S]*TrapHunter/);
  pass('Shade clipboard fallback saves its current briefing and PNG');
  await showShade('aoe',shadeMeta.aoe.aoeAt+500);
  await evaluate('__downloads=[];__blobs=[];copyText.click();copyImage.click()'); await sleep(250);
  assert.deepEqual(await evaluate('__downloads.sort()'), ['akama-aoe.png','akama-briefing-aoe.txt']);
  assert.match(await evaluate('__blobs[0].text()'), /AoE[\s\S]*TrapHunter/);
  pass('alternative chapter exports use their own filenames');
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(minimal)})`); await reload();
  await showShade('cycle', shadeMeta.cycle.duration);
  assert.equal(await evaluate('__tactics.assigned.length'), 1);
  assert.match(await evaluate('rosterNote.textContent'), /No damage role/);
  assert.equal(await evaluate('__shadeScene._sim.phase'), 1);
  pass('Shade partial roster does not fabricate a damage team or successful burn');
  await showShade('aoe',shadeMeta.aoe.duration);
  assert.equal(await evaluate('__shadeScene._sim.channels.length'), 6);
  assert.equal(await evaluate('__shadeScene._sim.phase'), 1);
  assert.equal(await evaluate('__shadeScene._sim.npcs.every(n=>!n.targetId||__shadeScene.tanks.includes(n.targetId))'), true);
  assert.equal(await evaluate('__shadeScene._sim.damageTarget'), null);
  assert.equal(await evaluate('__shadeScene._sim.aoe'), null);
  assert.equal(await evaluate('__shadeScene._sim.stage'), 'gather');
  assert.doesNotMatch(await evaluate('encounterState.textContent'), /AoE Channelers and adds/);
  assert.equal(await evaluate('__shadeScene._sim.npcs.every(n=>n.hp===1)'), true);
  pass('alternate strategy with a partial roster preserves real tank ownership and cannot fabricate a kill');
  await checkReliquary(port);
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
}

try {
  await run();
  console.log("Tactics browser regression passed");
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (chrome && chrome.exitCode == null) { chrome.kill("SIGTERM"); await Promise.race([new Promise((done) => chrome.once("exit", done)), sleep(2000)]); if (chrome.exitCode == null) { chrome.kill("SIGKILL"); await new Promise((done) => chrome.once("exit", done)); } }
  if (server) await new Promise((done) => server.close(done));
  if (profile) await rm(profile, { recursive: true, force: true });
}
