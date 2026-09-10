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
  throw new Error("Presenter map did not become ready: " + browserErrors.join("\n") + " State: " + JSON.stringify(await evaluate("({presenter:typeof __tactics,canvas:document.getElementById('fx')?.getBoundingClientRect().toJSON()})")));
}
async function waitForHub() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("typeof TacticsHub === 'object' && !tacticsHub.hidden && hubContent.children.length > 0 && [...tacticsHub.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)")) return;
    await sleep(100);
  }
  throw new Error('Raid selection did not become ready');
}

async function checkRaidHubAndHyjal(port) {
  await send('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html`});
  await waitForHub();
  await evaluate('localStorage.clear()');
  assert.equal(await evaluate('document.querySelector(".brief").hidden'), true);
  assert.equal(await evaluate('typeof __tactics'), 'undefined', 'hub does not initialize the fight loop');
  assert.deepEqual(await evaluate('[...hubContent.querySelectorAll("h2")].map(n=>n.textContent)'), ['Black Temple','Mount Hyjal']);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await screenshot('raid-selection-1280');
  await evaluate('hubContent.querySelector(".raid-card--hyjal").click()'); await sleep(200); await waitForHub();
  const hyjalIds = ['hyjal-winterchill','hyjal-anetheron','hyjal-kazrogal','hyjal-azgalor','hyjal-archimonde'];
  assert.deepEqual(await evaluate('[...hubContent.querySelectorAll("a")].map(a=>new URL(a.href).searchParams.get("fight"))'), hyjalIds);
  await screenshot('hyjal-boss-selection-1280');
  await evaluate('hubContent.querySelector("a").click()'); await sleep(200); await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.id'), hyjalIds[0]);
  assert.deepEqual(await evaluate('[...bossNav.children].map(a=>new URL(a.href).searchParams.get("fight"))'), hyjalIds);
  await evaluate('raidBack.click()'); await sleep(200); await waitForHub();
  await evaluate('hubBack.click()'); await sleep(200); await waitForHub();
  await evaluate('hubContent.querySelector(".raid-card--bt").click()'); await sleep(200); await waitForHub();
  assert.equal(await evaluate('hubContent.children.length'), 8);
  assert.equal(await evaluate('[...hubContent.querySelectorAll("a")].every(a=>new URL(a.href).searchParams.get("fight").startsWith("bt-"))'), true);
  pass('Tactics image cards, raid-specific boss selection, and return navigation work at laptop size');

  for (const fight of hyjalIds) {
    await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}`}); await waitForPresenter();
    assert.equal(await evaluate('__tactics.briefing'), true);
    assert.equal(await evaluate('[...document.images].every(img=>img.complete && img.naturalWidth>0)'), true, fight+' assets load');
    assert.equal(await evaluate('TacticsBriefing.forFight(__tactics.fight.id).primaryOrder.includes("waves")'), false);
    for (const [width,height] of [[1280,720],[1440,900]]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}); await sleep(100);
      const failures = await evaluate(`(async()=>{
        const a=__tactics,bad=[],route=a.guided.steps.filter(s=>a.primaryOrder.includes(s.sceneId));
        for (const step of route) {
          a.showExplanation(step.index);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const scene=a.scenes.find(s=>s.id===step.sceneId);
          for(const elapsed of [0,(step.holdAtMs-step.startMs)/2,step.holdAtMs-step.startMs]) {
            const now=performance.now();a.playback.pause(now);a.playback.seek(elapsed,now);a.render(now);
            const f=scene._sim,box=fx.getBoundingClientRect();
            for(const p of [f.boss,...Object.values(f.pos),...(f.adds||[]).map(x=>x.at)]) {
              const q=a.px(p);
              if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<0||q.y<0||q.x>box.width||q.y>box.height)bad.push([scene.id,elapsed,'actor off canvas',p,q,{width:box.width,height:box.height},a.lesson?.layout]);
            }
            if(Object.keys(f.pos).length!==a.assigned.length)bad.push([scene.id,'phantom roster']);
            if(!sceneCall.textContent||/undefined|NaN/.test(sceneCall.textContent+encounterState.textContent))bad.push([scene.id,'invalid guidance']);
          }
          const selected=a.guided.selectedIndex;
          if(!next.disabled){next.click();prev.click();if(a.guided.selectedIndex!==selected)bad.push([scene.id,'navigation mismatch']);}
        }
        if(document.documentElement.scrollWidth>innerWidth)bad.push('horizontal overflow');
        quickRecap.click();if(a.guided.steps[a.guided.selectedIndex].sceneId!=='overview')bad.push('bad recap');
        if(!a.lesson?.model.rows.length)bad.push('missing recap rows');
        return bad;
      })()`);
      assert.deepEqual(failures, [], fight+' guided scenes at '+width);
      await screenshot(fight+'-recap-'+width);
    }
    await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id==='positioning'))`); await sleep(150);
    await screenshot(fight+'-positioning-1440');
    const movementScene={'hyjal-winterchill':['dnd',6500],'hyjal-anetheron':['infernal',6500],'hyjal-kazrogal':['mark',6500],'hyjal-azgalor':['rain',7500],'hyjal-archimonde':['doomfire',6500]}[fight];
    await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id===${JSON.stringify(movementScene[0])}));__seekSource(${movementScene[1]})`); await sleep(150);
    await screenshot(fight+'-movement-1440');
    const feature = {'hyjal-winterchill':['icebolt',2000],'hyjal-anetheron':['infernal',6500],'hyjal-kazrogal':['mark',6500],'hyjal-azgalor':['doom',21500],'hyjal-archimonde':['airburst',4500]}[fight];
    await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id===${JSON.stringify(feature[0])}));__seekSource(${feature[1]})`);
    await screenshot(fight+'-mechanic-1440');
    await evaluate(`(()=>{window.__exports=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>__exports.push(t),write:async items=>window.__image=await items[0].getType('image/png')}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}})()`);
    await evaluate('copyText.click();copyImage.click()'); await sleep(200);
    assert((await evaluate('__exports[0]')).includes(await evaluate('sceneCall.textContent')));
    assert((await evaluate('__image.size'))>1000);
    await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}&view=detail&chapter=${feature[0]}`}); await waitForPresenter();
    assert.equal(await evaluate('__tactics.briefing'), false);
    assert.equal(await evaluate('__tactics.guided.steps[__tactics.guided.selectedIndex].sceneId'), feature[0]);
    assert.equal(await evaluate('[...bossNav.children].every(a=>!new URL(a.href).searchParams.has("chapter"))'), true, 'boss switch clears previous chapter');
    await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] }); await reload();
    assert.equal(await evaluate('__tactics.playback.playing'), false);
    await send('Emulation.setEmulatedMedia', {features:[]});
    pass(fight+' supports every guided scene, recap, detail deep links, text/PNG exports and reduced motion');
  }
  const sparse=JSON.stringify({manual:[{name:'HyjalSoloTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'}],playerMeta:{HyjalSoloTank:{mt:true}}});
  for(const fight of hyjalIds){
    await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(sparse)})`);
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}`}); await waitForPresenter();
    assert.equal(await evaluate('__tactics.assigned.length'),1,'sparse imported roster is preserved');
    await evaluate(`(()=>{for(const scene of __tactics.scenes){__tactics.show(__tactics.scenes.indexOf(scene));__seekSource(scene.duration);}})()`);
    await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id==='finish'));__seekSource(10000)`);
    assert.notEqual(await evaluate(`__tactics.scenes.find(s=>s.id==='finish')._sim.stage`),'complete');
    assert.match(await evaluate('sceneCall.textContent'),/missing/i,'incomplete roster does not claim a completed kill');
  }
  pass('All five Hyjal briefings preserve sparse imported rosters and display missing coverage');
  await evaluate(`(()=>{
    const manual=[['Main','WARRIOR','Protection'],['Other','PALADIN','Protection'],['Sham1','SHAMAN','Enhancement'],['Sham2','SHAMAN','Restoration'],['Sham3','SHAMAN','Elemental'],['Heal','PRIEST','Holy'],['Druid','DRUID','Restoration'],['Rogue','ROGUE','Combat'],['Fury','WARRIOR','Fury'],['Mage','MAGE','Arcane'],['Hunter','HUNTER','Beast Mastery'],['Lock','WARLOCK','Destruction']].map(([name,cls,spec])=>({name,class:cls,spec,flags:[],source:'manual'}));
    localStorage.setItem('raidAssignmentsState',JSON.stringify({manual,playerMeta:{Main:{mt:true}}}));
    localStorage.setItem('raidPositionsState',JSON.stringify({swapTanks:{archimonde:true},encounters:{'hyjal-archimonde':{saved:{nudges:{Mage:{dx:.015,dy:-.01}},anchorNudges:{boss:{dx:.02,dy:.01},'party-1':{dx:.015,dy:0}}},nudges:{Mage:{dx:.005,dy:.012}},anchorNudges:{boss:{dx:.01,dy:0},'party-2':{dx:0,dy:.01}}}}}));
  })()`);
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=hyjal-archimonde`}); await waitForPresenter();
  const parity=await evaluate(`(()=>{
    const E=AssignmentsEngine,HP=HyjalPositions,state=JSON.parse(localStorage.raidAssignmentsState),ps=JSON.parse(localStorage.raidPositionsState),scope=ps.encounters['hyjal-archimonde'];
    const roster=E.deriveRoster(state,{}), expected=HP.computePositions(roster,E.proposeGroups(roster),E.autoAssign(roster,state.overrides||{}).duties,{encounter:'hyjal-archimonde',boss:'archimonde',swapTanks:true,nudges:HP.combineNudges(scope.saved.nudges,scope.nudges),anchorNudges:HP.combineNudges(scope.saved.anchorNudges,scope.anchorNudges)});
    const sc=__tactics.scenes.find(s=>s.id==='positioning');__tactics.show(__tactics.scenes.indexOf(sc));
    return {actual:sc.raid.map(p=>({name:p.name,...sc.baseById[p.id],party:p.group+1})).sort((a,b)=>a.name.localeCompare(b.name)),expected:expected.markers.filter(m=>m.name).map(m=>({name:m.name,x:m.x,y:m.y,party:m.party})).sort((a,b)=>a.name.localeCompare(b.name)),boss:sc._sim.boss,expectedBoss:expected.markers.find(m=>m.kind==='boss'),mt:sc.raid.find(p=>p.id===sc.primaryTank).name,mtRole:sc._sim.roles[sc.primaryTank]};
  })()`);
  // The MT is physically separate but retains its logical party in Tactics.
  parity.expected.forEach(p=>{if(p.name===parity.mt)p.party=parity.actual.find(a=>a.name===p.name).party;});
  assert.deepEqual(parity.actual,parity.expected,'Tactics preserves Positioning party membership and every saved/live marker adjustment');
  assert.deepEqual(parity.boss,{x:parity.expectedBoss.x,y:parity.expectedBoss.y},'simulation retains the saved boss position');
  assert.equal(parity.mt,'Other','Positioning tank swap is honored');
  assert.equal(parity.mtRole,'MT','swapped main tank keeps the main-tank callout');
  pass('Archimonde matches Positioning parties, saved/live player/group/boss adjustments and tank swap in the browser');

  await evaluate('localStorage.clear()');
  assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
}
async function screenshot(name) {
  if (!process.env.TACTICS_SCREENSHOT_DIR) return;
  await mkdir(process.env.TACTICS_SCREENSHOT_DIR, { recursive: true });
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(process.env.TACTICS_SCREENSHOT_DIR, `${name}.png`), Buffer.from(result.data, "base64"));
}

async function showShade(id, time = 0) {
  await evaluate(`(()=>{const a=__tactics,i=a.scenes.findIndex(s=>s.id===${JSON.stringify(id)});if(i<0)throw Error('Missing Shade chapter');a.show(i);window.__shadeScene=a.scenes[i];__seekSource(${time})})()`);
}

// Keep source-frame regression checks separate from local explanation playback.
// Selecting the appropriate explanation avoids silently testing only the first beat.
function installSourceSeeker() {
  window.__seekSource = function (time) {
    const a = window.__tactics;
    const index = [...document.querySelectorAll('#dots button')].findIndex(button => button.getAttribute('aria-current') === 'step');
    const scene = a.scenes[index];
    const target = a.guided?.timelineFor(scene.id, time);
    if (target && a.guided.selectedIndex !== target.index) a.showExplanation(target.index);
    const now = performance.now();
    a.playback.pause(now);
    a.playback.seek(target ? target.elapsedMs : time, now);
    a.render(now);
    // Static plans/positions intentionally have a single frame. All other sampled
    // source frames must still be reached exactly, retaining the old coverage.
    const steps = a.guided?.chapterSteps(scene.id) || [];
    if (!(steps.length === 1 && steps[0].startMs === steps[0].holdAtMs) && scene._t !== time)
      throw new Error(`${scene.id}: requested source ${time}, rendered ${scene._t}`);
  };
}

async function showReliquary(id, time = 0) {
  await evaluate(`(()=>{const a=__tactics,i=a.scenes.findIndex(s=>s.id===${JSON.stringify(id)});if(i<0)throw Error('Missing Reliquary chapter');a.show(i);const target=a.guided?.timelineFor(${JSON.stringify(id)},${time});if(target)a.showExplanation(target.index);window.__reliquaryScene=a.scenes[i];a.playback.pause(performance.now());a.playback.seek(target?target.elapsedMs:${time},performance.now());a.render(performance.now())})()`);
}

async function drawnReliquaryText() {
  return evaluate(`(()=>{const c=fx.getContext('2d'),original=c.fillText,drawn=[];c.fillText=function(value,...args){drawn.push(String(value));return original.call(this,value,...args)};try{__tactics.render(performance.now())}finally{c.fillText=original}return drawn.join('\\n')})()`);
}

async function checkReliquary(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-reliquary`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.id'), 'bt-reliquary');
  assert.deepEqual(await evaluate('__tactics.scenes.map(s=>s.id)'), ['overview','positioning','fixate','suffering','souls','desire','interrupts','deaden','anger','spite','cycle']);
  assert.equal(await evaluate(`bossNav.querySelector('[href*="fight=bt-reliquary"]').getAttribute("aria-current")`), 'page');
  assert.equal(await evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'), true);
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate(`(()=>{const a=__tactics;return a.scenes.every((s,i)=>{a.show(i);a.playback.pause(performance.now());return [...sceneSpells.querySelectorAll('a')].every(link=>link.href.startsWith('https://')&&!link.href.includes('undefined'))})})()`),true,'every spell card links to a real source');
  pass('Reliquary deep link loads eleven chapters, authentic art and the example raid');

  await showReliquary('fixate',0);
  const heldTank=await evaluate('__reliquaryScene._sim.bossTarget');
  const initialTankHp=await evaluate('__reliquaryScene._sim.hp[__reliquaryScene._sim.bossTarget]');
  const initialTankPositions=await evaluate('Object.fromEntries(__reliquaryScene.tanks.map(id=>[id,__reliquaryScene._sim.pos[id]]))');
  for(const time of [5000,10000]) {
    await showReliquary('fixate',time);
    assert.equal(await evaluate('__reliquaryScene._sim.bossTarget'),heldTank,'a healthy tank can receive consecutive Fixates');
    assert.deepEqual(await evaluate('Object.fromEntries(__reliquaryScene.tanks.map(id=>[id,__reliquaryScene._sim.pos[id]]))'),initialTankPositions,'standby tanks remain still while the current tank holds');
    assert.equal(await evaluate('!!__reliquaryScene._sim.nextTankAt'),false,'no movement arrow invites an unnecessary swap');
  }
  assert((await evaluate('__reliquaryScene._sim.hp[__reliquaryScene._sim.bossTarget]'))<initialTankHp,'the holding tank visibly accumulates damage');
  assert.match(await drawnReliquaryText(),/same tank|keep tanking|hold/i,'the canvas explains why the next Fixate does not require a swap');
  await showReliquary('fixate',13000);
  assert.match(await drawnReliquaryText(),/health|low/i,'the health reason is visible before the approach');
  await showReliquary('fixate',14999);
  const outgoingHp=await evaluate('__reliquaryScene._sim.hp[__reliquaryScene.tanks[0]]');
  await showReliquary('fixate',15000);
  assert.notEqual(await evaluate('__reliquaryScene._sim.bossTarget'),heldTank,'the later Fixate completes the chosen health-based swap');
  const swappedHp=await evaluate('__reliquaryScene._sim.hp[__reliquaryScene.tanks[0]]');
  assert(swappedHp<=outgoingHp,'handing over does not heal the previous tank');
  await showReliquary('fixate',16000);
  assert.equal(await evaluate('__reliquaryScene._sim.hp[__reliquaryScene.tanks[0]]'),swappedHp,'the previous tank keeps its lost health while waiting');
  pass('Suffering holds multiple Fixates and only demonstrates a handoff after the tank health drops');

  for (const [width,height] of [[1600,1100],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    await showReliquary('positioning');
    const collisions = await evaluate(`(()=>{
      const a=__tactics,bad=[];
      const check=(s,elapsed)=>{
        const now=performance.now();a.playback.pause(now);a.playback.seek(elapsed,now);
        const ctx=fx.getContext('2d'),roundRect=ctx.roundRect,fillText=ctx.fillText,labels=[];let box,lessonBox;
        ctx.roundRect=function(x,y,w,h,...rest){box={x,y,w,h};if(x===10&&y===10)lessonBox=box;return roundRect.call(this,x,y,w,h,...rest)};
        ctx.fillText=function(value,...args){
          if(/^(Current|Next|Waiting): /.test(String(value)))labels.push({label:String(value),...box});
          if(/^(LOW HEALTH|COOLDOWNS (READY|ACTIVE))$/.test(String(value))&&box&&(args[0]<box.x||args[0]+this.measureText(value).width>box.x+box.w))bad.push({step:s.id,elapsed,statusOverflow:String(value)});
          return fillText.call(this,value,...args);
        };
        try{a.render(now)}finally{ctx.roundRect=roundRect;ctx.fillText=fillText}
        const f=s._sim,b=a.px(f.boss),yard=a.px({x:f.boss.x+a.fight.yard,y:f.boss.y}).x-b.x;
        const minGap=2*Math.max(9,Math.min(21,1.7*yard))+4;
        const tanks=s.tanks.map(id=>({id,...a.px(f.pos[id])}));
        const protectedTokens=[...tanks.map(p=>({...p,r:Math.max(12,2.3*yard)})),{id:'boss',...b,r:20}];
        if(s.id!=='positioning')for(const [index,p] of tanks.entries()){
          if(!labels.some(box=>box.label.includes('Tank '+(index+1))))bad.push({step:f.explanation?.id,elapsed,missingTankLabel:p.id});
          if(lessonBox&&p.y-Math.max(9,Math.min(21,1.7*yard))-12<lessonBox.y+lessonBox.h+4)bad.push({step:f.explanation?.id,elapsed,coveredByLesson:p.id});
        }

        for(const box of labels)for(const p of protectedTokens){
          const x=Math.max(box.x,Math.min(p.x,box.x+box.w)),y=Math.max(box.y,Math.min(p.y,box.y+box.h));
          if(Math.hypot(x-p.x,y-p.y)<p.r+2)bad.push({step:f.explanation?.id,elapsed,label:box.label,covered:p.id});
        }
        for(let i=0;i<tanks.length;i++)for(let j=i+1;j<tanks.length;j++){
          const gap=Math.hypot(tanks[i].x-tanks[j].x,tanks[i].y-tanks[j].y);
          if(gap<minGap)bad.push({step:f.explanation?.id,elapsed,pair:[tanks[i].id,tanks[j].id],gap,minGap});
        }
      };
      check(a.scenes.find(s=>s.id==='positioning'),0);
      a.guided.steps.forEach((step,index)=>{if(!['fixate','suffering'].includes(step.sceneId))return;a.showExplanation(index);const s=a.scenes.find(s=>s.id===step.sceneId);for(const time of [0,500,1000,60000])check(s,time)});
      return bad;
    })()`);
    assert.deepEqual(collisions,[],'opening tank tokens remain separate at '+width);
    await showReliquary('fixate',14999);
    const approachTarget=await evaluate('__reliquaryScene._sim.bossTarget');
    assert.equal(approachTarget,await evaluate('__reliquaryScene.tanks[0]'),'approach holds before Fixate changes the target');
    const approachText=await drawnReliquaryText();
    for(const name of ['Tank 1','Tank 2','Tank 3'])assert(approachText.includes(name),name+' stays identifiable at '+width);
    await key('ArrowRight');
    assert.equal(await evaluate('__reliquaryScene._sim.bossTarget'),await evaluate('__reliquaryScene.tanks[1]'),'next explanation shows the target handoff');
    await screenshot('reliquary-separated-handoff-'+width);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  pass('opening tanks stay separate and identifiable, with Fixate changing on the next explanation');

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
  assert.equal(await evaluate('document.getElementById("scrub")?.getClientRects().length || 0'),0,'teaching uses steps instead of a running timeline');
  assert.equal(await evaluate('document.getElementById("speed")?.getClientRects().length || 0'),0);
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

  const invalid = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];const check=(s,t,source=false)=>{if(source)__seekSource(t);else{a.playback.pause(performance.now());a.playback.seek(t,performance.now());a.render(performance.now());}const f=s._sim;for(const p of [f.boss,...Object.values(f.pos),...(f.souls||[]).filter(s=>!s.dead).map(s=>s.at)]){const q=a.px(p);if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<8||q.y<8||q.x>b.width-8||q.y>b.height-8)bad.push([s.id,t,p]);}if(sceneCall.textContent!==(f.explanation?f.explanation.title:f.call)||(!f.explanation&&!encounterState.textContent.includes(a.fight.stateLabels[f.stage])))bad.push(['state',s.id,t]);};a.guided.steps.forEach((step,index)=>{a.showExplanation(index);const s=a.scenes.find(s=>s.id===step.sceneId);for(const t of [0,500,3000,60000])check(s,t);});const cycle=a.scenes.find(s=>s.id==='cycle');a.show(a.scenes.indexOf(cycle));for(let t=0;t<=cycle.duration;t+=1000)check(cycle,t,true);return bad})()`);
  assert.deepEqual(invalid, [], 'Reliquary raid positions, calls and state stay visible and synchronized');
  pass('all Reliquary chapters remain drawable and synchronized across direct seeks');

  await showReliquary('fixate', 14999);
  const beforeTarget = await evaluate('__reliquaryScene._sim.bossTarget');
  await showReliquary('fixate', 15000);
  assert.notEqual(await evaluate('__reliquaryScene._sim.bossTarget'), beforeTarget);
  assert.equal(await evaluate(`(()=>{const a=__tactics,f=__reliquaryScene._sim,d=TacticsLayout.dist(a.fight,f.pos[f.bossTarget],f.boss);return Object.entries(f.pos).every(([id,p])=>id===f.bossTarget||TacticsLayout.dist(a.fight,p,f.boss)>d)})()`), true);
  pass('Suffering visibly selects the closest receiving tank at Fixate');

  await showReliquary('fixate', 14000);
  const rotationBefore = await drawnReliquaryText();
  assert.match(rotationBefore, /next/i, 'the next receiver is visible in the animation');
  const exampleTanks = await evaluate('[...roleNotes.querySelectorAll("dd")].slice(0,2).map(n=>n.textContent.split(" — ")[0])');
  assert.notEqual(exampleTanks[0], exampleTanks[1], 'example current and next tanks have distinct identities');
  await showReliquary('fixate', 15500);
  assert.notEqual(await drawnReliquaryText(), rotationBefore, 'visible tank instructions follow the handoff');
  const sufferingFrames = [];
  for (const index of await evaluate("__tactics.guided.steps.map((s,index)=>({s,index})).filter(({s})=>s.sceneId==='suffering').map(({index})=>index)")) { await evaluate(`__tactics.showExplanation(${index})`); sufferingFrames.push(await drawnReliquaryText()); }
  const sufferingGuide = sufferingFrames.join('\n');
  assert.match(sufferingGuide, /DPS|damage/i);
  assert.match(sufferingGuide, /45|0:45/);
  assert.match(sufferingGuide, /15|1:00/);
  await showReliquary('suffering',9000);
  assert.match(await drawnReliquaryText(),/prepare|ready/i,'Enrage preparation is a separate visible explanation');
  let enrageTank, standbyHealth;
  for(const time of [12000,14999,17000]) {
    await showReliquary('suffering',time);
    const target=await evaluate('__reliquaryScene._sim.bossTarget');
    const waitingHp=await evaluate('Object.fromEntries(__reliquaryScene.tanks.filter(id=>id!==__reliquaryScene._sim.bossTarget).map(id=>[id,__reliquaryScene._sim.hp[id]]))');
    if(enrageTank===undefined){enrageTank=target;standbyHealth=waitingHp;}
    assert.deepEqual(waitingHp,standbyHealth,"standby tanks are not shown taking the active tank's damage");
    assert.equal(target,enrageTank,'prepared Enrage survival does not require a new tank every five seconds');
    assert.match(await drawnReliquaryText(),/cooldown|defensive|avoidance/i,'the survival action is explained on the canvas');
  }
  await showReliquary('overview');
  assert.doesNotMatch((await drawnReliquaryText())+'\n'+sufferingGuide,/Rotate closest tanks? every (5s|five seconds)|Enrage needs three|Each tank survives five seconds/i,'current visual instructions cannot restore mandatory five-second swapping');
  pass('Suffering separates health-based handoffs from prepared Enrage survival');

  const phaseOrder = [];
  for (const time of [0,21000,33000,61000,73000]) {
    await showReliquary('cycle', time);
    phaseOrder.push(await evaluate('String(__reliquaryScene._sim.essence).toLowerCase()'));
  }
  assert.equal(await evaluate('__tactics.guided.isGuided()'),true,'the final cycle also uses manual explanations');
  assert.equal(await evaluate('document.getElementById("scrub")?.getClientRects().length || 0'),0);
  assert.equal(await evaluate('document.getElementById("speed")?.getClientRects().length || 0'),0);
  assert.equal(await evaluate('manualProgress.getClientRects().length'),1,'the final cycle shows its selected explanation');
  assert.equal(phaseOrder[0], 'suffering'); assert.equal(phaseOrder[2], 'desire'); assert.equal(phaseOrder[4], 'anger');
  assert.notEqual(phaseOrder[1], 'suffering'); assert.notEqual(phaseOrder[3], 'desire');
  let cycleTank;
  for(const time of [0,5000,10000]) {
    await showReliquary('cycle',time);
    const target=await evaluate('__reliquaryScene._sim.bossTarget');
    if(cycleTank===undefined)cycleTank=target;
    assert.equal(target,cycleTank,'continuous playback also holds through repeated Fixates');
  }
  await showReliquary('cycle',17500);
  assert.equal(await evaluate('!!__reliquaryScene._sim.tankDefense?.active'),true,'the full cycle retains prepared Enrage survival after the health handoff');
  assert.match(await drawnReliquaryText(),/Enrage/i);

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
  await evaluate('__seekSource(50000)');
  assert.equal(await evaluate('__reliquaryScene._t'),50000);
  assert.equal(await evaluate('__tactics.playback.playing'),false);
  await showReliquary('cycle',100000); await sleep(100);
  assert.equal(await evaluate('__reliquaryScene._t'),100000);
  assert.equal(await evaluate('__reliquaryScene._sim.stage'),'complete');
  assert.equal(await evaluate('__reliquaryScene._sim.pressure'),0);
  assert.equal(await evaluate('__reliquaryScene._sim.tankResource'),null);
  assert.equal(await evaluate('__reliquaryScene._sim.spite.length+__reliquaryScene._sim.shadowPulses.length'),0);
  assert.equal(await evaluate('roleNotes.children.length'),0,'victory has no stale live assignments');
  const completedIndex=await evaluate('__tactics.guided.selectedIndex');
  await key('r','KeyR'); assert.equal(await evaluate('__tactics.guided.selectedIndex'),completedIndex);
  assert((await evaluate('__reliquaryScene._t-__tactics.guided.active.startMs'))<1500);
  await evaluate('quickRecap.click();dots.children[10].click()');
  await key('ArrowLeft'); assert.match(await evaluate('stepTitle.textContent'),/Spite|marks|burn/i);
  await evaluate('document.activeElement.blur()');
  await key(' ','Space'); assert.equal(await evaluate('__tactics.playback.playing'),false);
  await key(' ','Space'); assert.equal(await evaluate('__tactics.playback.playing'),true);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await reload();
  await evaluate("__tactics.show(__tactics.scenes.findIndex(s=>s.id==='cycle'))");
  assert.equal(await evaluate('__tactics.playback.playing'),false);
  await send('Emulation.setEmulatedMedia',{features:[]});
  pass('Reliquary holds completion, replays the selected explanation and retains keyboard and reduced-motion controls');

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
  for (const [chapter,time] of [['fixate',13000],['suffering',16000],['souls',5500],['interrupts',7500],['spite',9500],['cycle',100000]]) {
    await showReliquary(chapter,time); await evaluate('copyText.click();copyImage.click()'); await sleep(150);
    const output=await evaluate('__reliquaryExports.at(-1)');
    assert(output.includes(await evaluate('sceneCall.textContent')));
    assert.doesNotMatch(output,/Rotate closest tanks? every (5s|five seconds)|Enrage needs three|Each tank survives five seconds/i,'exported guidance follows the corrected swap strategy');
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
  await showReliquary('fixate',13000);
  assert.match(await drawnReliquaryText(),/no fresh tank|no second tank|one tank/i,'a low-health tank without relief gets an honest coverage instruction');
  await showReliquary('fixate',15000);
  assert.match(await drawnReliquaryText(),/no fresh tank|no second tank|one tank/i,'a missing fresh tank never becomes a successful handoff');
  await showReliquary('interrupts',7500);
  assert.equal(await evaluate('!!__reliquaryScene._sim.shield?.active'),true);
  assert.doesNotMatch(await evaluate('roleNotes.innerText'),/completed Spirit Shock|completed kick/i,'missing interrupt coverage never shows a completed kick');
  await showReliquary('anger',3000);
  assert.doesNotMatch(await evaluate('sceneCall.textContent + roleNotes.innerText'),/taunted at|OT pickup\. Damage waits/i,'a lone tank is not shown completing a two-tank taunt');
  pass('Reliquary partial roster cannot fabricate damage kills or Rune Shield removal');

  const noRemover=JSON.stringify({manual:[
    {name:'KickTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'},
    {name:'SecondTank',class:'WARRIOR',spec:'Protection',flags:[],source:'manual'},
    {name:'RogueKick',class:'ROGUE',spec:'Combat',flags:[],source:'manual'}
  ]});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(noRemover)})`); await reload();
  await showReliquary('cycle',47000);
  assert.equal(await evaluate('__reliquaryScene._sim.shield.active'),true);
  assert.match(await evaluate('sceneCall.textContent'),/missing|no.*(?:remov|dispel)|cannot/i,'the cycle removal step acknowledges missing removal');
  await showReliquary('cycle',49000);
  assert.equal(await evaluate('__reliquaryScene._sim.shield.active'),true);
  assert.equal(await evaluate('__reliquaryScene._sim.cast.interrupted'),false);
  assert.match(await evaluate('sceneCall.textContent'),/missing|blocked|cannot|no.*remov/i,'a real kicker cannot complete the cycle interrupt through Shield');
  await evaluate("__tactics.showExplanation(__tactics.guided.steps.findIndex(step=>step.sceneId==='spite' && step.id==='spite-recovery'))");
  assert.match(await evaluate('sceneCall.textContent'),/missing|no healer/i,'the recovery explanation acknowledges missing healing');
  pass('Reliquary cycle explanations distinguish available kicks from missing removal and recovery');
}

async function checkSharedGuidedFlow(port) {
  await evaluate('localStorage.clear()');
  for (const fight of ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary', 'bt-bloodboil']) {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/tactics.html?view=detail&fight=${fight}` });
    await waitForPresenter();
    const recap = await evaluate(`(()=>{const a=__tactics;return {scene:a.guided.active.sceneId,time:a.scenes[0]._t,playing:a.playback.playing,title:dots.children[0].textContent,jobs:roleNotes.textContent}})()`);
    assert.equal(recap.scene, 'overview');
    assert.equal(recap.time, 0);
    assert.equal(recap.playing, false, fight + ' recap is still for reading');
    assert.match(recap.title, /The plan/i);
    assert(recap.jobs.length > 100, fight + ' recap contains actionable role or phase reminders');
    await screenshot(fight + '-quick-recap-1600');

    const failures = await evaluate(`(()=>{
      const a=__tactics,bad=[];
      const visible=selector=>[...document.querySelectorAll(selector)].some(node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
      for(const [index,step] of a.guided.steps.entries()) {
        a.showExplanation(index);
        if(!a.guided.isGuided() || visible('.scrubber, #scrub, .speed, .elapsed'))bad.push([step.sceneId,step.id,'video controls visible']);
        const scene=a.scenes.find(s=>s.id===step.sceneId),now=performance.now();
        a.playback.play(now);a.render(now+200000);a.render(now+400000);
        if(a.guided.selectedIndex!==index || scene._t!==step.holdAtMs)bad.push([step.sceneId,step.id,'did not hold',scene._t,step.holdAtMs]);
        if(index===0 && !prev.disabled)bad.push(['first step can go back']);
        if(index===a.guided.steps.length-1 && !next.disabled)bad.push(['last step can go forward']);
        if(index<a.guided.steps.length-1){next.click();if(a.guided.selectedIndex!==index+1)bad.push([index,'next']);prev.click();if(a.guided.selectedIndex!==index)bad.push([index,'previous']);}
      }
      for(const [index,scene] of a.scenes.entries()) {
        dots.children[index].click();
        if(a.guided.active.sceneId!==scene.id || a.guided.active.localIndex!==0)bad.push([scene.id,'chapter entry']);
      }
      return bad;
    })()`);
    assert.deepEqual(failures, [], fight + ' all explanations and chapter boundaries');
    pass(fight + ' every chapter uses bounded explanations with forward/back navigation and no video bar');

    const animated = await evaluate('__tactics.guided.steps.findIndex(s=>s.holdAtMs>s.startMs && s.loop!=="effect")');
    await evaluate(`__tactics.showExplanation(${animated});__tactics.playback.pause(performance.now())`);
    const chosen = await evaluate('__tactics.guided.selectedIndex');
    await evaluate('replay.click()');
    assert.equal(await evaluate('__tactics.guided.selectedIndex'), chosen);
    assert((await evaluate('(()=>{const a=__tactics,s=a.guided.active;return a.scenes.find(c=>c.id===s.sceneId)._t-s.startMs})()')) < 1500);
    await evaluate('document.activeElement.blur()');
    await key('ArrowRight'); assert.equal(await evaluate('__tactics.guided.selectedIndex'), chosen + 1);
    await key('ArrowLeft'); assert.equal(await evaluate('__tactics.guided.selectedIndex'), chosen);
    await evaluate('quickRecap.click()');
    assert.equal(await evaluate('__tactics.guided.active.sceneId'), 'overview');
    assert.equal(await evaluate('__tactics.playback.playing'), false);

    await send('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await sleep(60);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, fight + ' recap fits laptop width');
    await screenshot(fight + '-quick-recap-1280');
    await evaluate(`__tactics.showExplanation(${animated})`);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, fight + ' explanation fits laptop width');
    assert.equal(await evaluate("['quickRecap','prev','next','playPause'].every(id=>document.getElementById(id).getClientRects().length>0)"), true);
    await screenshot(fight + '-guided-1280');
    await send('Emulation.clearDeviceMetricsOverride');

    await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
    await reload();
    await evaluate(`__tactics.showExplanation(${animated})`);
    assert.equal(await evaluate('__tactics.playback.playing'), false);
    await evaluate('next.click()');
    assert.equal(await evaluate('__tactics.playback.playing'), false);
    await send('Emulation.setEmulatedMedia', {features:[]});
    pass(fight + ' recap, replay, keyboard and reduced motion work together');

    const tank={name:'OnlyTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'};
    const healer={name:'OnlyHealer',class:'PRIEST',spec:'Holy',flags:[],source:'manual'};
    const damage={name:'OnlyDamage',class:'ROGUE',spec:'Combat',flags:[],source:'manual'};
    const coverageCases={
      'bt-najentus':[[tank,[['shield','raid-ready']]]],
      'bt-supremus':[[tank,[['p2-together','next-fixate']]],[healer,[['back','pickup']]]],
      'bt-akama':[],
      'bt-bloodboil':[[tank,[['rage-ranged','target']]]],
      'bt-reliquary':[[tank,[['cycle','spite-marks'],['desire','desire-damage']]],[damage,[['cycle','scream']]]]
    };
    for(const [player,steps] of coverageCases[fight]) {
      await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(JSON.stringify({manual:[player]}))})`);
      await reload();
      for(const [sceneId,stepId] of steps) {
        await evaluate(`__tactics.showExplanation(__tactics.guided.steps.findIndex(s=>s.sceneId===${JSON.stringify(sceneId)} && s.id===${JSON.stringify(stepId)}))`);
        assert.equal(await evaluate('__tactics.guided.active.id'),stepId);
        const coverageCall=await evaluate('sceneCall.textContent');
        assert.match(coverageCall,/missing|unavailable|no (?:tank|spine|damage)|cannot|needs .*coverage/i,fight+':'+sceneId+':'+stepId+' reports missing coverage: '+coverageCall);
        assert.equal(await evaluate('manualTitle.textContent'),await evaluate('sceneCall.textContent'));
      }
    }
    await evaluate('localStorage.clear()');
  }
}

async function checkOnScreenGuidance(port) {
  await evaluate('localStorage.clear()');
  for(const fight of ['bt-najentus','bt-supremus','bt-akama','bt-reliquary','bt-bloodboil']) {
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?view=detail&fight=${fight}`});
    await waitForPresenter();
    for(const [width,height] of [[1280,720],[1440,900]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await sleep(80);
      await evaluate('quickRecap.click()');
      await screenshot(fight+'-on-screen-plan-'+width);
      if(fight==='bt-reliquary') {
        await evaluate('quickRecap.click()');
        assert.equal(await evaluate("['sceneCall','sceneWhy','roleNotes'].every(id=>!document.getElementById(id).getClientRects().length)"),true,'Reliquary recap also leaves the rail reference-only');
        await screenshot(fight+'-on-screen-plan-'+width);
        continue;
      }
      await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__lessonExport=text}}})`);
      const failures=await evaluate(`(()=>{
        const a=__tactics,bad=[],normal=value=>String(value||'').replace(/\\s+/g,' ').trim();
        const originalDraw=TacticsLessonRender.draw;
        let texts=[];
        TacticsLessonRender.draw=function(api,lesson,layout){
          const ctx=api.ctx,original=ctx.fillText,originalRect=ctx.roundRect,panels=[];
          ctx.roundRect=function(x,y,w,h,r){panels.push({x,y,w,h});return originalRect.call(this,x,y,w,h,r)};
          ctx.fillText=function(value,x,y,maxWidth){
            const m=this.measureText(String(value)),b=fx.getBoundingClientRect();
            const left=x-m.actualBoundingBoxLeft,right=x+m.actualBoundingBoxRight,top=y-m.actualBoundingBoxAscent,bottom=y+m.actualBoundingBoxDescent;
            if(left < -2 || right>b.width+2 || top < -2 || bottom>b.height+2)bad.push([lesson.title,'clipped lesson text',value,left,right,top,bottom]);
            if(!panels.some(p=>left>=p.x-2 && right<=p.x+p.w+2 && top>=p.y-2 && bottom<=p.y+p.h+2))bad.push([lesson.title,'text outside its panel',value,left,right,top,bottom]);
            texts.push(String(value));return maxWidth===undefined?original.call(this,value,x,y):original.call(this,value,x,y,maxWidth);
          };
          try{return originalDraw.call(this,api,lesson,layout)}finally{ctx.fillText=original;ctx.roundRect=originalRect}
        };
        try {
          for(const [index,step] of a.guided.steps.entries()) {
            a.showExplanation(index);
            const scene=a.scenes.find(s=>s.id===step.sceneId),now=performance.now();
            a.playback.pause(now);a.playback.seek(0,now);a.render(now);
            const initialAction=JSON.stringify(a.lesson.layout.action);
            for(const elapsed of [0,step.holdAtMs-step.startMs]) {
              a.playback.seek(elapsed,now);texts=[];a.render(now);
              const model=a.lesson.model,layout=a.lesson.layout,drawn=normal(texts.join(' ')),box=fx.getBoundingClientRect();
              if(!drawn.includes(normal(model.title)) || !drawn.includes(normal(model.detail)))bad.push([scene.id,step.id,'missing visible explanation']);
              for(const row of model.rows||[])for(const value of row)if(!drawn.includes(normal(value)))bad.push([scene.id,step.id,'missing role instruction',value]);
              if(model.warning && !drawn.includes(normal(model.warning)))bad.push([scene.id,step.id,'missing warning']);
              if(scene._sim.stage!=='complete' && scene.why && !drawn.includes(normal(scene.why)))bad.push([scene.id,step.id,'missing scene reasoning']);
              copyText.click();
              for(const value of [model.title,model.detail,...model.rows.flat(),model.warning].filter(Boolean))if(!normal(window.__lessonExport).includes(normal(value)))bad.push([scene.id,step.id,'export omits visible guidance',value]);
              if(['sceneCall','sceneWhy','roleNotes'].some(id=>document.getElementById(id).getClientRects().length))bad.push([scene.id,'core information still in rail']);
              if(document.querySelector('.mistake').getClientRects().length)bad.push([scene.id,'watch-out still in rail']);
              if(!fx.getAttribute('aria-label').includes(model.title))bad.push([scene.id,'canvas accessibility description']);
              if(scene.id!=='overview') {
                const r=layout.action;
                if(r.w<100 || r.h<160 || r.x<0 || r.y<0 || r.x+r.w>box.width+1 || r.y+r.h>box.height+1)bad.push([scene.id,step.id,'insufficient animation area',r]);
                if(JSON.stringify(r)!==initialAction)bad.push([scene.id,step.id,'camera area moves during explanation']);
                const f=scene._sim,players=a.fight.id==='bt-supremus'?Object.values(scene.cast).map(id=>f.pos[id]).filter(Boolean):Object.values(f.pos),actors=[f.boss,...players,...(f.akama?[f.akama]:[]),...(f.npcs||[]).map(n=>n.at)];
                for(const actor of actors){const p=a.px(actor);if(p.x<r.x+5 || p.x>r.x+r.w-5 || p.y<r.y+5 || p.y>r.y+r.h-5)bad.push([scene.id,step.id,'actor under lesson panel',p,r]);}
              }
            }
          }
        } finally {TacticsLessonRender.draw=originalDraw}
        return bad;
      })()`);
      assert.equal(failures.length,0,fight+' on-screen text and actor layout at '+width+'x'+height+': '+JSON.stringify(failures.slice(0,8)));
      await evaluate('quickRecap.click()');
      await screenshot(fight+'-on-screen-plan-'+width);
      const featured={ 'bt-najentus':['burst','burst-hit'], 'bt-supremus':['back','pickup'], 'bt-akama':['walk','rendezvous'], 'bt-bloodboil':['rage-ranged','ramp'] }[fight];
      await evaluate(`__tactics.showExplanation(__tactics.guided.steps.findIndex(s=>s.sceneId===${JSON.stringify(featured[0])}&&s.id===${JSON.stringify(featured[1])}))`);
      await screenshot(fight+'-on-screen-lesson-'+width);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'laptop page has no horizontal overflow');
    }
    await send('Emulation.clearDeviceMetricsOverride');
    pass(fight+' main display owns explanations and recaps, with a reference-only rail');
  }
}

async function checkStableFightFraming(port) {
  await evaluate('localStorage.clear()');
  const geometry = () => evaluate(`(()=>{const a=__tactics,r=a.fight.arena;return JSON.stringify([a.viewport,a.px({x:r.x0,y:r.y0}),a.px({x:r.x1,y:r.y1})])})()`);
  for (const fight of await evaluate('Object.keys(TacticsData.FIGHTS)')) {
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?view=detail&fight=${fight}`});
    await waitForPresenter();
    let desktopGeometry;
    for (const [width,height] of (fight.startsWith('hyjal-') ? [[1600,1000],[1280,720]] : [[1600,1000],[1280,720],[390,844]])) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await sleep(200);
      if(width===1600) desktopGeometry=await geometry();
      const failures = await evaluate(`(()=>{
        const a=__tactics,bad=[],arena=a.cameraBounds;
        const geometry=()=>JSON.stringify({action:a.viewport,corners:[a.px({x:arena.x0,y:arena.y0}),a.px({x:arena.x1,y:arena.y1})]});
        const steps=a.guided.steps.map((s,i)=>({s,i})).filter(({s})=>s.sceneId!=='overview');
        a.showExplanation(steps[0].i);const baseline=geometry();
        for(const {s,i} of [...steps,...steps.slice().reverse()]) {
          a.showExplanation(i);const now=performance.now();a.playback.pause(now);
          for(const elapsed of [0,(s.holdAtMs-s.startMs)/2,s.holdAtMs-s.startMs]) {
            a.playback.seek(elapsed,now);a.render(now);
            if(geometry()!==baseline)bad.push([s.sceneId,s.id,'map frame changes with explanation or animation']);
            const r=a.viewport;
            if(a.fight.id==='bt-reliquary') {
              const frame=a.scenes.find(scene=>scene.id===s.sceneId)._sim;
              for(const actor of [frame.boss,...Object.values(frame.pos),...(frame.souls||[]).filter(soul=>!soul.dead).map(soul=>soul.at)]) {
                const p=a.px(actor);
                if(p.x<r.x+5||p.x>r.x+r.w-5||p.y<r.y+5||p.y>r.y+r.h-5)bad.push([s.sceneId,s.id,'actor outside the unobscured arena',p]);
              }
            }
            if(r.h<160)bad.push([s.sceneId,s.id,'map squeezed away',r.h]);
            for(const corner of [{x:arena.x0,y:arena.y0},{x:arena.x1,y:arena.y1}]) {
              const p=a.px(corner);if(p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h)bad.push([s.sceneId,s.id,'arena cropped']);
            }
          }
        }
        return bad;
      })()`);
      assert.deepEqual(failures.slice(0,8),[],fight+' keeps one full arena frame at '+width+'x'+height);
      if(fight==='bt-bloodboil') {
        for(const id of ['switch','g2']) {
          await evaluate(`__tactics.showExplanation(__tactics.guided.steps.findIndex(s=>s.sceneId==='rotation'&&s.id===${JSON.stringify(id)}))`);
          await screenshot('bloodboil-stable-'+id+'-'+width);
        }
      }
      if(width===1280) {
        const before=await geometry();
        for(const selector of fight==='bt-bloodboil'?['#bloodboilSoakSetup','.reference']:['.reference']) {
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).open=true`);
          await sleep(250);
          assert.equal(await geometry(),before,'opening '+selector+' does not resize '+fight+' after layout settles');
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).open=false`);
          await sleep(250);
          assert.equal(await geometry(),before,'closing '+selector+' preserves framing');
        }
        await evaluate('__tactics.show(3)');await sleep(250);
        assert.equal(await geometry(),before,'changing spell cards does not resize '+fight+' after layout settles');
      }
      if(fight==='bt-reliquary') {
        for(const chapter of ['positioning','fixate','souls','interrupts','spite']) {
          await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id===${JSON.stringify(chapter)}))`);
          await screenshot('reliquary-stable-'+chapter+'-'+width);
        }
      }
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'stable layout has no horizontal overflow');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await sleep(200);
    assert.equal(await geometry(),desktopGeometry,'returning from a narrow viewport restores the same desktop geometry');
    const replay = await evaluate(`(()=>{
      const a=__tactics,r=a.fight.arena;a.show(2);a.playback.pause(performance.now());
      const snapshot=()=>JSON.stringify([a.viewport,a.px({x:r.x0,y:r.y0}),a.px({x:r.x1,y:r.y1})]);
      const before=snapshot();next.click();prev.click();replay.click();a.playback.pause(performance.now());return before===snapshot();
    })()`);
    assert.equal(replay,true,'returning to desktop, next/previous and replay preserve framing');
    await send('Emulation.clearDeviceMetricsOverride');
    {
      await send('Runtime.evaluate',{expression:'document.documentElement.requestFullscreen()',awaitPromise:true,userGesture:true});
      await sleep(200);
      assert.equal(await evaluate('!!document.fullscreenElement'),true,'fullscreen entered');
      assert.equal(await evaluate(`(()=>{const a=__tactics,r=a.fight.arena,snapshot=()=>JSON.stringify([a.viewport,a.px({x:r.x0,y:r.y0}),a.px({x:r.x1,y:r.y1})]);a.show(2,2);const before=snapshot();next.click();return before===snapshot()})()`),true,'fullscreen explanation changes keep the same map frame');
      await evaluate('document.exitFullscreen()');
      await sleep(200);
    }
    pass(fight+' keeps a fixed full-fight view across explanations, chapter jumps, playback and viewport sizes');
  }
}

async function checkBloodboil(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-bloodboil`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.id'), 'bt-bloodboil');
  assert.equal(await evaluate('__tactics.scenes.length'), 9);
  assert.equal(await evaluate('__tactics.scenes.some(s=>s.id==="bloodboil")'), false, 'duplicate single-application chapter is retired');
  assert.equal(await evaluate('__tactics.scenes.find(s=>s.id==="rotation").chapter'), 'Bloodboil rotation');
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'), true);
  const show = async (scene, time) => evaluate(`(()=>{const a=__tactics;a.show(a.scenes.findIndex(s=>s.id===${JSON.stringify(scene)}));__seekSource(${time});window.__bloodScene=a.scenes.find(s=>s.id===${JSON.stringify(scene)})})()`);
  await show('rotation', 10000);
  assert.deepEqual(await evaluate('__bloodScene._sim.bloodboil[0].targetIds.slice().sort()'), await evaluate('__bloodScene.groupMembers.G1.slice().sort()'));
  const firstFormation = await evaluate('__bloodScene._sim.pos');
  await evaluate(`(()=>{const a=__tactics,step=a.guided.active,now=performance.now();a.playback.pause(now);a.playback.seek(step.holdAtMs-step.startMs,now);a.render(now)})()`);
  assert.equal(await evaluate('__tactics.guided.active.id'), 'g1');
  assert.deepEqual(await evaluate('__bloodScene._sim.pos'), firstFormation, 'first application holds before either group moves');
  await screenshot('bloodboil-first-application-hold');
  const switchStart = await evaluate(`(()=>{next.click();const a=__tactics,now=performance.now();a.playback.pause(now);a.playback.seek(0,now);a.render(now);return {id:a.guided.active.id,pos:__bloodScene._sim.pos}})()`);
  assert.equal(switchStart.id, 'switch');
  assert.deepEqual(switchStart.pos, firstFormation, 'Next starts the exchange from its original formation');
  await evaluate(`(()=>{const a=__tactics,now=performance.now();a.playback.seek(1000,now);a.render(now)})()`);
  assert.equal(await evaluate('__bloodScene._sim.routes.length'), 10, 'both five-player groups move during the switch');
  await screenshot('bloodboil-first-switch-moving');
  await evaluate(`(()=>{const a=__tactics,step=a.guided.active,now=performance.now();a.playback.seek(step.holdAtMs-step.startMs,now);a.render(now)})()`);
  assert.equal(await evaluate('__bloodScene._sim.routes.length'), 0, 'switch holds after everyone arrives');
  assert.equal(await evaluate('__bloodScene._sim.soakGroup'), 'G2');
  assert.deepEqual(await evaluate('__bloodScene._sim.pos'), await evaluate('__tactics.simulate(__bloodScene,13000).pos'));
  await screenshot('bloodboil-first-switch-hold');
  await evaluate('prev.click()');
  assert.equal(await evaluate('__tactics.guided.active.id'), 'g1');
  await evaluate('next.click();replay.click()');
  assert.equal(await evaluate('__tactics.guided.active.id'), 'switch');
  assert((await evaluate('__bloodScene._t-__tactics.guided.active.startMs')) < 1000, 'replay starts before the group exchange');
  pass('Bloodboil teaches the first application and complete exchange once, with working Next, Previous and replay');
  await show('rotation', 40000);
  assert.equal(await evaluate('__bloodScene._sim.bloodboil.filter(w=>w.group==="G1").length'), 1);
  await show('cycle', 55000);
  assert.equal(await evaluate('__bloodScene._sim.rage.active'), true);
  assert.equal(await evaluate('__bloodScene._sim.bloodboil.length'), 2, 'late Bloodboils continue into Fel Rage');
  await show('cycle', 85000);
  assert.equal(await evaluate('__bloodScene._sim.rage.active'), false);
  pass('Bloodboil five-player applications, debuff expiry and phase carryover match the current frame');

  for (const chapter of ['positioning','rotation','tanks','rage-ranged','rage-melee','recovery']) {
    const time = chapter === 'positioning' ? 0 : chapter.startsWith('rage') ? 16000 : chapter === 'rotation' ? 40000 : 6000;
    await show(chapter, time);
    await screenshot('bloodboil-' + chapter + '-1600');
  }
  const bad = await evaluate(`(()=>{
    const a=__tactics,bad=[];
    for(const [index,step] of a.guided.steps.entries()) {
      a.showExplanation(index);const scene=a.scenes.find(s=>s.id===step.sceneId),now=performance.now();
      for(const elapsed of [0,step.holdAtMs-step.startMs]) {
        a.playback.pause(now);a.playback.seek(elapsed,now);a.render(now);
        for(const [id,p] of Object.entries(scene._sim.pos))if(!Number.isFinite(p.x)||!Number.isFinite(p.y))bad.push([step.sceneId,step.id,id]);
        if(scene._sim.rage.active&&scene._sim.rage.targetId) {
          const target=scene._sim.pos[scene._sim.rage.targetId],boss=scene._sim.boss;
          if(Math.hypot(target.x-boss.x,target.y-boss.y)<.001)bad.push([step.sceneId,step.id,'boss overlaps victim']);
        }
      }
    }return bad;
  })()`);
  assert.deepEqual(bad, [], 'Bloodboil authored boundaries remain drawable with a distinct rage target');
  await show('rage-ranged', 16000);
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__bloodText=text},write:async items=>{window.__bloodPNG=await items[0].getType('image/png')}}})`);
  await evaluate('copyText.click();copyImage.click()'); await sleep(200);
  assert.match(await evaluate('__bloodText'), /Gurtogg Bloodboil[\s\S]*Fel Rage/);
  assert((await evaluate('__bloodPNG.size')) > 1000);
  pass('Bloodboil rage positioning, explanation boundaries and PNG/text exports stay synchronized');

  const state = JSON.stringify({manual:[
    {name:'BloodTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'},
    {name:'BloodHealer',class:'PRIEST',spec:'Holy',flags:[],source:'manual'},
    {name:'BloodMage',class:'MAGE',spec:'Arcane',flags:[],source:'manual'}
  ]});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(state)})`); await reload();
  await show('positioning', 0);
  assert.equal(await evaluate('__bloodScene.raid.length'), 3);
  assert.equal(await evaluate('__bloodScene.raid.every(p=>p.label.includes(p.name))'), true);
  await screenshot('bloodboil-named-partial-positioning');
  await evaluate('localStorage.clear()');
  pass('Bloodboil positioning preserves imported names and shows only loaded players');

  const mixedRoster = [
    ...Array.from({length:3},(_,i)=>({name:'SoakTank'+i,class:'WARRIOR',spec:'Protection',mt:i===0})),
    ...Array.from({length:10},(_,i)=>({name:'SoakMelee'+i,class:'ROGUE',spec:'Combat'})),
    ...Array.from({length:6},(_,i)=>({name:'SoakHeal'+i,class:'PRIEST',spec:'Holy'})),
    ...Array.from({length:6},(_,i)=>({name:'SoakRange'+i,class:'MAGE',spec:'Arcane'}))
  ].map(player=>({...player,flags:[],source:'manual'}));
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(JSON.stringify({manual:mixedRoster}))})`); await reload();
  assert.equal(await evaluate('bloodboilSoakSetup.open'),true);
  assert.match(await evaluate('bloodboilSoakStatus.textContent'),/12\/15 assigned/);
  assert.equal(await evaluate('bloodboilMeleeChoices.querySelectorAll("input").length'),10);
  await show('rotation',30000);
  const soakFrame = await evaluate('JSON.stringify([__tactics.lesson.layout.action,__tactics.px({x:.3,y:.3}),__tactics.px({x:.7,y:.7})])');
  for(const name of ['SoakMelee0','SoakMelee4','SoakMelee7'])
    await evaluate(`[...bloodboilMeleeChoices.querySelectorAll('input')].find(input=>input.value===${JSON.stringify('name:'+name)}).click()`);
  await sleep(250);
  assert.match(await evaluate('bloodboilSoakStatus.textContent'),/15\/15 assigned/);
  assert.equal(await evaluate('__tactics.guided.active.id'),'g3','editing groups preserves the selected explanation');
  assert.equal(await evaluate('JSON.stringify([__tactics.lesson.layout.action,__tactics.px({x:.3,y:.3}),__tactics.px({x:.7,y:.7})])'),soakFrame,'filling melee vacancies does not reframe the map');
  assert.equal(await evaluate('bloodboilMeleeChoices.querySelectorAll("input:not(:checked):disabled").length'),7);
  assert.equal(await evaluate('__tactics.scenes.every(s=>Object.values(s.groupMembers).every(ids=>ids.length===5))'),true);
  assert.doesNotMatch(await evaluate('sceneCall.textContent'),/missing/i);
  assert.doesNotMatch(await evaluate('rosterStatus.textContent'),/Soak groups incomplete/);
  const selectedMelee = await evaluate(`__tactics.scenes[0].raid.filter(p=>p.kind==='melee'&&p.group).map(p=>p.name)`);
  assert.deepEqual(selectedMelee,['SoakMelee0','SoakMelee4','SoakMelee7']);
  await show('rotation',30000);
  assert.equal(await evaluate(`__bloodScene._sim.bloodboil.find(w=>w.wave===3).targetIds.filter(id=>__bloodScene.raid.find(p=>p.id===id).kind==='melee').length`),3);
  await show('rotation',34000);
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__selectedSoakText=text}}});copyText.click()`);
  await sleep(80);
  assert.match(await evaluate('__selectedSoakText'),/G3:.*SoakMelee0.*SoakMelee4.*SoakMelee7/);
  assert.match(await evaluate('__selectedSoakText'),/SoakMelee4 — Melee soaker: return behind the boss/);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await show('positioning',0);await screenshot('bloodboil-melee-soak-selection-1280');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await send('Emulation.clearDeviceMetricsOverride');
  await reload();
  assert.equal(await evaluate('bloodboilMeleeChoices.querySelectorAll("input:checked").length'),3);
  assert.equal(await evaluate('__tactics.scenes[0].soakers.length'),15);
  await evaluate(`bloodboilSoakSetup.open=true;[...bloodboilMeleeChoices.querySelectorAll('input')].find(input=>input.value==='name:SoakMelee4').click()`);
  assert.equal(await evaluate('__tactics.scenes[0].soakers.length'),14);
  assert.match(await evaluate('bloodboilSoakStatus.textContent'),/Choose 1 more/);
  await show('rotation',30000);
  assert.match(await evaluate('sceneCall.textContent'),/coverage missing/i);
  await reload();
  assert.equal(await evaluate('bloodboilMeleeChoices.querySelectorAll("input:checked").length'),2);
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-najentus`}); await waitForPresenter();
  assert.equal(await evaluate('document.getElementById("bloodboilSoakSetup")'),null);
  await evaluate('localStorage.clear()');
  pass('Bloodboil melee selection fills groups, updates all chapters and exports, persists, and can be undone');
}

async function checkMother(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=bt-mother`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.name'), 'Mother Shahraz');
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate('__tactics.primaryOrder.includes("cycle")'), false);
  assert.equal(await evaluate('__tactics.primaryOrder.includes("door")'), false);
  const assets = await evaluate(`(async()=>{
    const f=__tactics.fight,paths=[f.map,f.portrait,...f.abilities.map(a=>a.icon),...(f.referenceImages||[]).map(i=>i.path)];
    return Promise.all(paths.map(path=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve([path,img.naturalWidth>0]);img.onerror=()=>resolve([path,false]);img.src=path})));
  })()`);
  assert(assets.every(([,loaded])=>loaded), JSON.stringify(assets));
  pass('Mother deep link loads the shortened briefing, room artwork and spell references');
  const geometry = await evaluate(`(()=>{
    const a=__tactics,bad=[],tankIds=a.assigned.filter(p=>p.kind==='tank').map(p=>p.id);
    for(const scene of a.scenes){
      for(const t of [0,scene.duration*.25,scene.duration*.5,scene.duration*.75,scene.duration]){
        const frame=a.simulate(scene,t),again=a.simulate(scene,t);
        if(JSON.stringify(frame)!==JSON.stringify(again))bad.push([scene.id,t,'nondeterministic']);
        if(Object.keys(frame.pos).length!==a.assigned.length)bad.push([scene.id,t,'roster changed']);
        if(tankIds.some(id=>TacticsLayout.dist(a.fight,frame.pos[tankIds[0]],frame.pos[id])>.01))bad.push([scene.id,t,'tank stack broken']);
        if(Object.values(frame.pos).some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))bad.push([scene.id,t,'invalid position']);
      }
    }
    return bad;
  })()`);
  assert.deepEqual(geometry, []);
  for(const [width,height] of [[1600,1000],[1280,720],[1440,900],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    for(const chapter of ['positioning','attraction','return','door']) {
      await evaluate(`(()=>{const a=__tactics,i=a.scenes.findIndex(s=>s.id===${JSON.stringify(chapter)});a.show(i);__seekSource(${chapter==='positioning'?0:4000});})()`);
      if(chapter==='attraction' && width>=1280) {
        const overlaps=await evaluate(`(()=>{
          const ctx=fx.getContext('2d'),original=ctx.fillText,bad=[];let labels=[];
          ctx.fillText=function(value,x,y,...args){
            if(/^(?:[0-9]+ \\/ 25 yd|Clear|Split now)$/.test(String(value))){
              const m=this.measureText(String(value));labels.push({value:String(value),left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});
            }
            return original.call(this,value,x,y,...args);
          };
          try{for(const time of [2000,3000,4000,4700]){
            __seekSource(time);labels=[];__tactics.render(performance.now());
            if(labels.filter(label=>label.value.includes('/ 25')).length!==3)bad.push([time,'missing pair distance']);
            for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
              const a=labels[i],b=labels[j];
              if((a.value.includes('/ 25')||b.value.includes('/ 25')) && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top)bad.push([time,a.value,b.value]);
            }
          }}finally{ctx.fillText=original;__seekSource(4000)}return bad;
        })()`);
        assert.deepEqual(overlaps, [], 'Mother distance annotations stay clear of each other and runner instructions at '+width);
      }
      await screenshot('mother-'+chapter+'-'+width);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`(()=>{const a=__tactics;a.show(a.scenes.findIndex(s=>s.id==='attraction'));__seekSource(4800)})()`);
  assert.match(await evaluate('sceneCall.textContent'), /effects cleared/i, 'the live call follows actual clearance before the authored endpoint');
  const solo=JSON.stringify({manual:[{name:'MotherTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'}]});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(solo)})`);
  await reload();
  assert.equal(await evaluate('__tactics.assigned.length'),1);
  assert.match(await evaluate('rosterNote.textContent'),/tank|Lash/i);
  for(const chapter of ['attraction','finish']) {
    await evaluate(`(()=>{const a=__tactics,scene=a.scenes.find(s=>s.id===${JSON.stringify(chapter)});a.show(a.scenes.indexOf(scene));__seekSource(scene.duration)})()`);
    assert.match(await evaluate('sceneCall.textContent'),/missing|unavailable|no |not defeated|cannot/i);
  }
  const damageOnly=JSON.stringify({manual:[{name:'MotherMage',class:'MAGE',spec:'Fire',flags:[],source:'manual'}]});
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(damageOnly)})`);
  await reload();
  const noTankFailures = await evaluate(`(()=>{const a=__tactics,bad=[];for(const step of a.guided.steps){try{a.showExplanation(step.index);const now=performance.now();a.playback.pause(now);a.playback.seek(step.holdAtMs-step.startMs,now);a.render(now);}catch(e){bad.push([step.sceneId,e.message]);}}return bad})()`);
  assert.deepEqual(noTankFailures, [], 'missing tanks never crash a scene');
  await evaluate('localStorage.clear()');
  pass('Mother keeps tanks stacked, deterministic frames and explicit missing-roster warnings');
}

async function checkCouncil(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=bt-council`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.name'), 'Illidari Council');
  assert.equal(await evaluate('__tactics.lesson.model.recap'), true);
  assert.equal(await evaluate('__tactics.lesson.model.rows.length'), 3, 'Council recap includes tank, interrupt and raid jobs');
  await screenshot('council-recap');
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate('__tactics.guided.steps.filter(s=>__tactics.primaryOrder.includes(s.sceneId)).length'), 10);
  assert.deepEqual(await evaluate('TacticsBriefing.forFight("bt-council").optionalScenes'), ['kite', 'cycle']);
  const assets = await evaluate(`(async()=>{const f=__tactics.fight;return Promise.all([f.map,f.portrait,...f.abilities.map(a=>a.icon),...f.referenceImages.map(i=>i.path)].map(path=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([path,i.naturalWidth>0]);i.onerror=()=>resolve([path,false]);i.src=path})))})()`);
  assert(assets.every(([,loaded])=>loaded), JSON.stringify(assets));
  pass('Council loads ten briefing stops, optional kite and cycle, and local source art');
  for (const [width,height] of [[1280,720],[1440,900],[1600,1000]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const bad = await evaluate(`(()=>{
      const a=__tactics,bad=[];
      for(const scene of a.scenes){
        a.show(a.scenes.indexOf(scene));
        for(const t of [0,scene.duration*.25,scene.duration*.5,scene.duration]){
          __seekSource(t);
          const f=a.simulate(scene,t),again=a.simulate(scene,t);
          if(JSON.stringify(f)!==JSON.stringify(again))bad.push([scene.id,t,'nondeterministic']);
          if(Object.keys(f.pos).length!==a.assigned.length)bad.push([scene.id,t,'roster changed']);
          if(f.bosses.length!==4)bad.push([scene.id,t,'missing boss']);
          const r=a.viewport;
          for(const actor of [...Object.values(f.pos),...f.bosses.filter(b=>!b.hidden).map(b=>b.at)]){
            const p=a.px(actor);
            if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<r.x+5||p.x>r.x+r.w-5||p.y<r.y+5||p.y>r.y+r.h-5)bad.push([scene.id,t,'actor outside arena',p]);
          }
        }
      }
      if(document.documentElement.scrollWidth>innerWidth)bad.push('horizontal overflow');
      return bad;
    })()`);
    assert.deepEqual(bad, [], 'Council scenes keep deterministic visible actors at '+width);
    for (const [chapter,time] of [['positioning',0],['rotation',7000],['interrupts',6000],['poison',5500],['kite',10000]]) {
      await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id==='${chapter}'));__seekSource(${time})`);
      await screenshot('council-'+chapter+'-'+width);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Council keeps all four actors and roster positions inside the laptop arena');
  await evaluate(`__tactics.show(1);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__councilText=text},write:async items=>{window.__councilPNG=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}};copyText.click();copyImage.click()`);
  await sleep(200);
  assert.match(await evaluate('__councilText'), /Gathios tank[\s\S]*Veras tank[\s\S]*Malande tank[\s\S]*Zerevor Mage tank[\s\S]*Physical kick[\s\S]*Magical kick/);
  assert((await evaluate('__councilPNG.size'))>1000);
  const roster = {manual:[
    {name:'CouncilTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'},
    {name:'CouncilHealer',class:'PRIEST',spec:'Holy',flags:[],source:'manual'},
    {name:'CouncilCaster',class:'WARLOCK',spec:'Destruction',flags:[],source:'manual'}
  ]};
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(JSON.stringify(roster))})`);
  await reload();
  assert.equal(await evaluate('__tactics.assigned.length'), 3);
  assert.match(await evaluate('rosterNote.textContent'), /Mage|tank|coverage/i);
  for (const chapter of ['pull','interrupts','mage','kite']) {
    await evaluate(`(()=>{const a=__tactics,s=a.scenes.find(s=>s.id==='${chapter}');a.show(a.scenes.indexOf(s));__seekSource(s.duration)})()`);
    assert.match(await evaluate('sceneCall.textContent'),/missing|no |unavailable|incomplete/i,chapter+' displays missing imported coverage');
  }
  await evaluate('localStorage.clear()');
  pass('Council text and PNG exports work; imported incomplete rosters cannot fabricate key jobs');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=bt-council&view=detail&chapter=interrupts`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.briefing'),false);
  assert.equal(await evaluate('__tactics.guided.chapterSteps("interrupts").length'),6);
  pass('Council detail deep link retains each authored interrupt beat');
}

async function checkIllidan(port) {
  await evaluate('localStorage.clear()');
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=bt-illidan`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.fight.name'), 'Illidan Stormrage');
  assert.equal(await evaluate('__tactics.lesson.model.recap'), true);
  assert.equal(await evaluate('__tactics.lesson.model.rows.length'), 5);
  assert.equal(await evaluate('__tactics.assigned.length'), 25);
  assert.equal(await evaluate('__tactics.guided.steps.filter(s=>__tactics.primaryOrder.includes(s.sceneId)).length'), 15);
  assert.deepEqual(await evaluate('TacticsBriefing.forFight("bt-illidan").optionalScenes'), ['cycle']);
  const assets = await evaluate(`(async()=>{const f=__tactics.fight;return Promise.all([f.map,f.portrait,...f.abilities.map(a=>a.icon),...f.referenceImages.map(i=>i.path)].map(path=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([path,i.naturalWidth>0]);i.onerror=()=>resolve([path,false]);i.src=path})))})()`);
  assert(assets.every(([,loaded])=>loaded), JSON.stringify(assets));
  await screenshot('illidan-recap');
  pass('Illidan loads fifteen guided stops, five-phase recap, optional cycle and all three guild images');
  for (const [width,height] of [[1280,720],[1440,900],[1600,1000]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const bad = await evaluate(`(()=>{
      const a=__tactics,bad=[];
      for(const scene of a.scenes){
        a.show(a.scenes.indexOf(scene));
        for(const t of [0,scene.duration*.25,scene.duration*.5,scene.duration]){
          __seekSource(t);
          const f=a.simulate(scene,t),again=a.simulate(scene,t);
          if(JSON.stringify(f)!==JSON.stringify(again))bad.push([scene.id,t,'nondeterministic']);
          if(Object.keys(f.pos).length!==a.assigned.length)bad.push([scene.id,t,'roster changed']);
          const r=a.viewport;
          const actors=[...Object.values(f.pos),...(f.bossVisible?[f.boss]:[]),...(f.flames||[]).filter(b=>!b.dead).map(b=>b.at),...(f.demons||[]).filter(b=>!b.dead).map(b=>b.at)];
          for(const actor of actors){
            const p=a.px(actor);
            if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<r.x+5||p.x>r.x+r.w-5||p.y<r.y+5||p.y>r.y+r.h-5)bad.push([scene.id,t,'actor outside arena',p]);
          }
        }
      }
      if(document.documentElement.scrollWidth>innerWidth)bad.push('horizontal overflow');
      return bad;
    })()`);
    assert.deepEqual(bad, [], 'Illidan scenes stay deterministic and visible at '+width);
    for (const [chapter,time] of [['positioning',0],['ground',6500],['parasites',11000],['flames',4000],['eye',7000],['barrage',5000],['landing',7000],['demon',8000],['maiev',11000]]) {
      await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id==='${chapter}'));__seekSource(${time})`);
      await screenshot('illidan-'+chapter+'-'+width);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Illidan phase formations and moving actors remain inside the laptop arena');
  await evaluate(`__tactics.show(1);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__illidanText=text},write:async items=>{window.__illidanPNG=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}};copyText.click();copyImage.click()`);
  await sleep(200);
  assert.match(await evaluate('__illidanText'), /Main tank[\s\S]*Flame tanks[\s\S]*Shadow[\s\S]*healer/i);
  assert((await evaluate('__illidanPNG.size'))>1000);
  const roster={manual:[{name:'OnlyTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'}]};
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(JSON.stringify(roster))})`);
  await reload();
  assert.equal(await evaluate('__tactics.assigned.length'),1);
  for(const [chapter,time] of [['parasites',13000],['flames',11000],['barrage',8000],['demon',11000],['cycle',34000]]) {
    await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id==='${chapter}'));__seekSource(${time})`);
    assert.match(await evaluate('sceneCall.textContent'),/missing|no |unavailable|incomplete/i,chapter+' exposes missing coverage at the live source beat');
  }
  await evaluate('localStorage.clear()');
  pass('Illidan text and PNG exports work; incomplete imported rosters cannot claim successful specialist mechanics');
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=bt-illidan&view=detail&chapter=demon`});
  await waitForPresenter();
  assert.equal(await evaluate('__tactics.briefing'),false);
  assert.equal(await evaluate('__tactics.guided.chapterSteps("demon").length'),4);
  await evaluate('__seekSource(6000)');
  assert.match(await evaluate('sceneCall.textContent'),/paralyze/i);
  pass('Illidan detail deep links preserve Demon Form beats and rescue guidance');
}

async function checkShortBriefings(port) {
  await evaluate('localStorage.clear()');
  for (const fight of ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary', 'bt-bloodboil', 'bt-mother', 'bt-council', 'bt-illidan']) {
    await send('Page.navigate', {url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}`});
    await waitForPresenter();
    assert.equal(await evaluate('__tactics.briefing'), true);
    assert.equal(await evaluate('sceneDetails.open'), false, 'supporting details start collapsed');
    const failures = await evaluate(`(()=>{
      const a=__tactics,bad=[],route=a.guided.steps.filter(step=>a.primaryOrder.includes(step.sceneId));
      if(route.length>window.TacticsSteps.forFight(a.fight.id).all().length/2)bad.push('briefing is not substantially shorter');
      for(const [index,step] of route.entries()) {
        a.showExplanation(step.index);
        if(manualProgress.textContent!=='Step '+(index+1)+' of '+route.length)bad.push(['progress',step.id]);
        if(index===0&&!prev.disabled)bad.push('can go before start');
        if(index===route.length-1&&!next.disabled)bad.push('optional example in default next route');
        if(index<route.length-1){next.click();if(a.guided.selectedIndex!==route[index+1].index)bad.push(['next',step.id]);prev.click();if(a.guided.selectedIndex!==step.index)bad.push(['previous',step.id]);}
        const now=performance.now();a.playback.seek(0,now);a.playback.play(now);a.render(now+200000);
        const sc=a.scenes.find(scene=>scene.id===step.sceneId);
        if(step.loop==='repeat') {
          if(!a.playback.playing||sc._t!==TacticsBriefing.forFight(a.fight.id).frameAt(step,200000)||a.guided.selectedIndex!==step.index)bad.push(['repeat',step.id,sc._t]);
        } else if(a.playback.playing||sc._t!==step.holdAtMs||a.guided.selectedIndex!==step.index)bad.push(['hold',step.id,sc._t]);
        if(a.lesson&&step.sceneId!=='overview'&&!['positioning','p1-stand'].includes(step.sceneId)&&(a.lesson.model.rows.length||a.lesson.model.warning))bad.push(['supporting copy on map',step.id]);
      }
      if([...dots.children].filter(button=>!button.hidden).length!==a.primaryOrder.length)bad.push('optional chapter tab visible');
      return bad;
    })()`);
    assert.deepEqual(failures, [], fight + ' condensed flow');
    if(fight==='bt-bloodboil') {
      const loopChecks=await evaluate(`(()=>{
        const a=__tactics,bad=[];a.show(a.scenes.findIndex(scene=>scene.id==='rotation'));
        const step=a.guided.steps.find(item=>item.sceneId==='rotation'),scene=a.scenes.find(scene=>scene.id==='rotation'),duration=step.playbackTimeline.at(-1)[0];
        if(a.guided.chapterSteps('rotation').length!==1||!a.playback.playing)bad.push('rotation does not start as one continuous animation');
        const now=performance.now();
        for(const lap of [0,1,2])for(const time of [0,10000,12000,20000,30000,40000,50000,54999]){
          a.playback.seek(lap*duration+a.guided.timelineFor('rotation',time).elapsedMs,now);a.render(now);
          const expected=a.simulate(scene,time);
          if(Math.abs(scene._t-time)>.001||JSON.stringify(scene._sim.pos)!==JSON.stringify(expected.pos)||JSON.stringify(scene._sim.bloodboil)!==JSON.stringify(expected.bloodboil))bad.push([lap,time,'rotation changed']);
          if(!a.playback.playing||a.guided.selectedIndex!==step.index)bad.push([lap,time,'loop stopped or left chapter']);
          if(time===12000&&!/G1 returns; G2 goes far/.test(sceneCall.textContent))bad.push([lap,time,'handoff narration did not repeat']);
        }
        a.playback.seek(duration+a.guided.timelineFor('rotation',12000).elapsedMs,now);a.playback.pause(now);a.render(now+10000);
        if(scene._t!==12000||a.playback.playing)bad.push('pause does not hold the repeated frame');
        a.playback.play(now+10000);a.render(now+11000);
        if(scene._t!==13000)bad.push('walking does not continue at normal speed');
        a.playback.seek(0,now);a.render(now+15500);
        if(scene._t!==0||!a.playback.playing)bad.push('full rotation does not repeat after 15.5 seconds');
        replay.click();a.playback.pause(performance.now());a.render(performance.now());
        if(a.playback.time(performance.now())>1000||a.guided.selectedIndex!==step.index)bad.push('replay does not restart the rotation');
        next.click();if(a.guided.active.sceneId!=='tanks')bad.push('next does not leave the loop');
        const normalNow=performance.now();a.playback.seek(0,normalNow);a.render(normalNow+1000);
        if(a.scenes.find(scene=>scene.id==='tanks')._t!==a.guided.active.startMs+1000)bad.push('rotation speed leaked into the next chapter');
        prev.click();if(a.guided.active.sceneId!=='rotation'||!a.playback.playing)bad.push('previous does not restart the loop');
        return bad;
      })()`);
      assert.deepEqual(loopChecks, [], 'Bloodboil rotation repeats unchanged with live handoff instructions and working controls');
      pass('Bloodboil chapter three loops the complete rotation; pause, resume, replay and chapter navigation work');
    }
    await evaluate('__tactics.show(0);document.activeElement.blur()');
    await key('ArrowRight');
    assert.equal(await evaluate('__tactics.guided.active.sceneId'), await evaluate('__tactics.primaryOrder[1]'));
    await key('ArrowLeft');
    assert.equal(await evaluate('__tactics.guided.active.sceneId'), 'overview');
    for (let digit=1; digit<=9; digit++) {
      await key(String(digit));
      assert.equal(await evaluate('__tactics.primaryOrder.includes(__tactics.guided.active.sceneId)'), true, 'numeric shortcut stays on the primary route');
    }
    await evaluate('__tactics.show(2);__tactics.playback.pause(performance.now())');
    const before = await evaluate('__tactics.guided.selectedIndex');
    if (await evaluate('!watchFight.hidden')) {
      await evaluate('watchFight.click();__tactics.playback.pause(performance.now())');
      assert.equal(await evaluate('__tactics.guided.active.sceneId'), 'cycle');
      assert.equal(await evaluate('__tactics.guided.chapterSteps("cycle").length'), 1);
      const narration = await evaluate(`(()=>{const a=__tactics,sc=a.scenes.find(s=>s.id==='cycle'),chosen=a.guided.selectedIndex,calls=[];for(const time of [0,sc.duration/2,sc.duration]){__seekSource(time);calls.push(sceneCall.textContent);if(a.guided.selectedIndex!==chosen)throw Error('Cycle requires another stop');}return calls;})()`);
      assert(new Set(narration).size > 1, 'whole-fight narration follows the animation');
      assert.equal(await evaluate('prev.disabled && next.disabled && !returnBriefing.hidden'), true);
      await evaluate('returnBriefing.click()');
      assert.equal(await evaluate('__tactics.guided.selectedIndex'), before, 'returns to the originating step');
    }
    if (fight === 'bt-akama') {
      await evaluate('alternateExamples.open=true;alternateChoices.querySelector("button").click()');
      assert.equal(await evaluate('__tactics.guided.active.sceneId'), 'aoe');
      await evaluate('returnBriefing.click()');
      assert.equal(await evaluate('__tactics.guided.selectedIndex'), before);
    }
    for (const [width,height] of [[1280,900],[390,844]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
      await sleep(80);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, fight+' short briefing fits width');
      await evaluate('sceneDetails.open=true');
      assert.equal(await evaluate('roleNotes.getClientRects().length>0 && sceneWhy.getClientRects().length>0'), true);
      await evaluate('sceneDetails.open=false');
      await screenshot(fight+'-short-'+width);
      const geometry = await evaluate(`(()=>{
        const a=__tactics,bad=[];
        for(const step of a.guided.steps){
          a.showExplanation(step.index);
          const scene=a.scenes.find(s=>s.id===step.sceneId);
          for(const time of [0,(step.holdAtMs-step.startMs)/2,step.holdAtMs-step.startMs]){
            const now=performance.now();a.playback.pause(now);a.playback.seek(time,now);a.render(now);
            const box=fx.getBoundingClientRect();
            for(const point of [scene._sim.boss,...Object.values(scene._sim.pos)]){
              const p=a.px(point);if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>box.width||p.y>box.height)bad.push([step.sceneId,step.id,time,'actor outside map']);
            }
            if(a.lesson){const model=a.lesson.model,bounds=a.lesson.layout,current=TacticsLessonRender.layout(fx.getContext('2d'),box.width,box.height,model);if(current.header.h>bounds.header.h||current.footer.h>bounds.footer.h)bad.push([step.sceneId,step.id,time,'copy exceeds reserved space']);}
          }
        }
        a.show(2);a.playback.pause(performance.now());
        return bad;
      })()`);
      assert.deepEqual(geometry, [], fight+' short frames keep actors and guidance within the map at '+width);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    const detailUrl = await evaluate('walkthroughLink.href');
    const chapter = await evaluate('__tactics.guided.active.sceneId');
    await send('Page.navigate', {url:detailUrl}); await waitForPresenter();
    assert.equal(await evaluate('__tactics.briefing'), false);
    assert.equal(await evaluate('__tactics.guided.active.sceneId'), chapter, 'mode link retains chapter');
    const shortUrl = await evaluate('walkthroughLink.href');
    await send('Page.navigate', {url:shortUrl}); await waitForPresenter();
    assert.equal(await evaluate('__tactics.briefing'), true);
    assert.equal(await evaluate('__tactics.guided.active.sceneId'), chapter);
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__shortText=text},write:async items=>{window.__shortPNG=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}};__tactics.playback.pause(performance.now());copyText.click();copyImage.click()`);
    await sleep(300);
    assert((await evaluate('__shortText')).includes(await evaluate('sceneCall.textContent')), 'export contains current condensed call');
    assert((await evaluate('__shortPNG.size'))>1000, 'condensed image exports');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await reload();
    assert.equal(await evaluate('__tactics.playback.playing'), false);
    await send('Emulation.setEmulatedMedia',{features:[]});
    pass(fight+' short briefing skips optional examples, holds merged animations, preserves details, exports and reduced motion');
  }
  const tank={name:'OnlyTank',class:'WARRIOR',spec:'Protection',mt:true,flags:[],source:'manual'};
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(JSON.stringify({manual:[tank]}))})`);
  for (const [fight,chapter,time,pattern] of [
    ['bt-najentus','shield',4500,'holder'],
    ['bt-supremus','p1-hateful',3200,'soak'],
    ['bt-reliquary','interrupts',8000,'removal is missing'],
    ['bt-reliquary','fixate',15000,'fresh tank']
  ]) {
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}&chapter=${chapter}`});await waitForPresenter();
    await evaluate(`__seekSource(${time})`);
    const call = await evaluate('sceneCall.textContent');
    assert.match(call,new RegExp(pattern,'i'), fight+':'+chapter+' live missing role overrides merged instruction: '+call);
  }
  await evaluate('localStorage.clear()');
  pass('condensed animations preserve missing-role warnings at internal source beats');
}


async function checkPresentation(port) {
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=bt-najentus&chapter=positioning`});await waitForPresenter();
  await evaluate(`localStorage.clear();localStorage.setItem('raidAssignmentsState',JSON.stringify({manual:[['WARRIOR','Protection'],...Array(6).fill(['SHAMAN','Restoration']),...Array(7).fill(['ROGUE','Combat']),...Array(11).fill(['MAGE','Arcane'])].map(([cls,spec],i)=>({name:'Longplayer'+String(i+1).padStart(2,'0'),class:cls,spec,flags:[],source:'manual'})),playerMeta:{Longplayer01:{mt:true}}}))`);
  const geometry=()=>evaluate(`(()=>{const a=__tactics,r=a.fight.arena;return {viewport:a.viewport,corners:[a.px({x:r.x0,y:r.y0}),a.px({x:r.x1,y:r.y1})]}})()`);
  const drawnNames=()=>evaluate(`(()=>{const c=fx.getContext('2d'),f=c.fillText,n=[];c.fillText=function(t,x,y,...args){const a=__tactics.viewport;if(String(t).includes('Longplayer')&&x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h)n.push(t);return f.call(this,t,x,y,...args)};try{__tactics.render(performance.now())}finally{c.fillText=f}return n})()`);
  const drawnText=()=>evaluate(`(()=>{const c=fx.getContext('2d'),f=c.fillText,n=[];c.fillText=function(text,x,y,...args){n.push({text:String(text),x,y,font:this.font,align:this.textAlign});return f.call(this,text,x,y,...args)};try{__tactics.render(performance.now())}finally{c.fillText=f}return n})()`);
  const simulations=()=>evaluate(`JSON.stringify(__tactics.scenes.map(s=>[s.id,...[0,s.duration/2,s.duration].map(t=>__tactics.simulate(s,t))]))`);
  const fights=await evaluate('Object.values(TacticsData.FIGHTS).map(f=>({id:f.id,positioning:f.positioningSceneId}))');
  for(const {id:fight,positioning} of fights) {
    for(const [width,height,dpr] of [[1280,720,1],[1440,900,2]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
      await send('Page.navigate',{url:`http://127.0.0.1:${port}/tactics.html?fight=${fight}&chapter=${positioning}`});await waitForPresenter();await evaluate('document.fonts.ready');await sleep(300);
      const normal=await geometry(), original=await simulations(), originalNames=await drawnNames(), originalDrawing=await drawnText();
      const originalScroll=await evaluate("window.scrollTo(0,90);window.scrollY");
      await evaluate(`window.__normalArena=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{window.__normalArena=await items[0].getType('image/png')}}});copyImage.click()`);
      for(let n=0;n<40 && !(await evaluate('!!window.__normalArena'));n++)await sleep(50);
      const normalPng=await evaluate(`(async()=>{const b=await createImageBitmap(__normalArena),r=fx.getBoundingClientRect(),a=__tactics.viewport;return{w:b.width,h:b.height,expectedW:Math.round(a.w*fx.width/r.width),expectedH:Math.round(a.h*fx.height/r.height)}})()`);
      assert.equal(normalPng.w,normalPng.expectedW);assert.equal(normalPng.h,normalPng.expectedH,'normal positioning export excludes lesson panels');

      await send('Runtime.evaluate',{expression:'document.getElementById("fullscreen").click()',userGesture:true});await sleep(400);
      assert.equal(await evaluate('__tactics.presenting'),true);
      const full=await geometry();
      assert(full.viewport.h>normal.viewport.h,`${fight} arena gains substantial height`);
      assert(full.viewport.w>normal.viewport.w,`${fight} arena gains width`);
      assert.equal(await evaluate("document.querySelector('.rail').getClientRects().length"),0);
      assert.equal(await evaluate("document.querySelector('.stage__head').getClientRects().length"),0);
      assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight+1'),true,'fullscreen fits without page scrolling');
      assert.equal(await simulations(),original,'fullscreen preserves every sampled simulation frame');
      assert.deepEqual(full.viewport,{x:0,y:0,w:width,h:height-(height>=850?156:148)-48});
      const names=await evaluate(`(()=>{const c=fx.getContext('2d'),f=c.fillText,n=[];c.fillText=function(t,...args){n.push(t);return f.call(this,t,...args)};try{__tactics.render(performance.now())}finally{c.fillText=f}return n})()`);
      assert.deepEqual(await drawnNames(),originalNames,'fullscreen preserves the original player labels');
      assert(!names.includes(await evaluate('presentationTitle.textContent')),fight+' heading is outside the arena canvas');
      if(fight==='hyjal-archimonde') {
        const collisions=await evaluate(`(()=>{
          const ctx=fx.getContext('2d'),original=ctx.fillText,names=[],groups=[];
          ctx.fillText=function(text,x,y,...args){
            if(String(text).includes('Longplayer'))names.push({text,x:x-this.measureText(text).width/2,y:y-14,w:this.measureText(text).width,h:17});
            if(/^G\\d+$/.test(text))groups.push(text);
            return original.call(this,text,x,y,...args);
          };
          try{__tactics.render(performance.now())}finally{ctx.fillText=original}
          const bad=[];
          names.forEach((a,i)=>names.slice(i+1).forEach(b=>{if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)bad.push([a.text,b.text])}));
          const sc=__tactics.scenes.find(s=>s.id==='positioning');
          if(groups.length!==sc.groups.length)bad.push(['missing short group headings']);
          return bad;
        })()`);
        assert.deepEqual(collisions,[],'Archimonde positioning names remain readable at '+width);
      }
      await screenshot(fight+'-presentation-positioning-'+width);
      // Copy must match just the arena canvas, including DPR, without the heading or controls.
      await evaluate(`window.__presentationBlob=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{window.__presentationBlob=await items[0].getType('image/png')}}});copyImage.click()`);
      for(let n=0;n<40 && !(await evaluate('!!window.__presentationBlob'));n++)await sleep(50);
      const png=await evaluate(`(async()=>{const b=await createImageBitmap(__presentationBlob);return {w:b.width,h:b.height,cw:fx.width,ch:fx.height,url:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(__presentationBlob)})}})()`);
      assert.equal(png.w,png.cw);assert.equal(png.h,png.ch);
      if(process.env.TACTICS_SCREENSHOT_DIR)await writeFile(join(process.env.TACTICS_SCREENSHOT_DIR,fight+'-presentation-export-'+width+'.png'),Buffer.from(png.url.split(',')[1],'base64'));
      // Keep one framing across every explanation, including differently sized spell descriptions.
      const failures=await evaluate(`(()=>{
        const a=__tactics,bad=[],baseline=JSON.stringify(a.viewport);
        for(const step of a.guided.steps){
          a.showExplanation(step.index);const now=performance.now();a.playback.pause(now);
          for(const elapsed of [0,(step.holdAtMs-step.startMs)/2,step.holdAtMs-step.startMs]){
            a.playback.seek(elapsed,now);a.render(now);const head=presentationHead,r=a.cameraBounds,sc=a.scenes.find(s=>s.id===step.sceneId);
            if(JSON.stringify(a.viewport)!==baseline)bad.push([step.id,'camera resized']);
            if(head.scrollHeight>head.clientHeight+1)bad.push([step.sceneId,step.id,'heading overflows',head.scrollHeight,head.clientHeight]);
            const spellIds=TacticsPresentation.abilityIds(a.fight,sc,sc._sim);
            if(presentationSpells.dataset.spells!==spellIds.join('|'))bad.push([step.id,'stale spells']);
            if(spellIds.length>2)bad.push([step.id,'too many spells for compact heading']);
            for(const corner of [{x:r.x0,y:r.y0},{x:r.x1,y:r.y1}]){const p=a.px(corner);if(p.x<-.01||p.y<-.01||p.x>a.viewport.w+.01||p.y>a.viewport.h+.01)bad.push([step.id,'arena clipped']);}
          }
        }
        return bad;
      })()`);
      assert.deepEqual(failures,[],fight+' fullscreen presentation at '+width);
      const expected=fight==='bt-najentus'?[['burst',0,'shield'],['burst',3500,'hurl'],['burst',5700,'burst']]:fight==='hyjal-winterchill'?[['icebolt',1800,'icebolt'],['dnd',1800,'dnd'],['nova',2500,'nova']]:await evaluate(`__tactics.scenes.filter(s=>s.id!==__tactics.fight.positioningSceneId && s.id!=='overview' && s.highlight?.length).slice(0,2).map(s=>{const time=s.duration/2;return [s.id,time,TacticsPresentation.abilityIds(__tactics.fight,s,__tactics.simulate(s,time)).join('|')]})`);
      for(const [scene,time,spell] of expected){await evaluate(`__tactics.show(__tactics.scenes.findIndex(s=>s.id===${JSON.stringify(scene)}));__seekSource(${time})`);assert.equal(await evaluate('presentationSpells.dataset.spells'),spell);await screenshot(fight+'-presentation-'+spell+'-'+width);}

      const expectedDownload=await evaluate("__tactics.fight.slug+'-'+__tactics.guided.active.sceneId+'.png'");
      await evaluate(`window.__download=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{throw Error('Clipboard denied')}}});HTMLAnchorElement.prototype.click=function(){window.__download=this.download};copyImage.click();quickRecap.click()`);
      for(let n=0;n<40 && !(await evaluate('!!window.__download'));n++)await sleep(50);
      assert.equal(await evaluate('__download'),expectedDownload,'download fallback keeps the clicked mechanic after navigation');
      // Controls wake on input and do not change arena size; previous/next and exit restore normal view.
      await evaluate("document.activeElement.blur();document.dispatchEvent(new PointerEvent('pointermove'))");await sleep(2700);
      assert.equal(await evaluate("document.body.classList.contains('presentation-idle')"),true);
      await key('ArrowRight');assert.equal(await evaluate("document.body.classList.contains('presentation-idle')"),false);
      await evaluate("__tactics.show(__tactics.scenes.findIndex(s=>s.id===__tactics.fight.positioningSceneId))");await key('f','KeyF');await sleep(500);
      assert.equal(await evaluate('__tactics.presenting'),false);
      assert.deepEqual(await geometry(),normal,'leaving fullscreen restores the original layout');
      assert.deepEqual(await drawnText(),originalDrawing,fight+' all normal canvas text, coordinates and fonts are identical after fullscreen exit');
      assert.equal(await evaluate('window.scrollY'),originalScroll,'fullscreen exit restores scroll position');
      assert.equal(await simulations(),original);
      pass(`${fight} presentation at ${width}×${height}, DPR ${dpr}: larger fixed arena, original names/frames, live spells, arena export and clean exit`);
    }
  }

  await evaluate('localStorage.clear()');
  assert.equal(browserErrors.length,0,browserErrors.join('\n'));
}

async function run() {
  const port = await startServer();
  await startChrome();
  await send("Page.enable"); await send("Runtime.enable");
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installSourceSeeker.toString()})()` });
  if (process.env.TACTICS_PRESENTATION_ONLY) { await checkPresentation(port); return; }
  if (process.env.TACTICS_HYJAL_ONLY) {
    await checkRaidHubAndHyjal(port);
    return;
  }
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-supremus` });
  await waitForPresenter();
  assert.equal(await evaluate("typeof __tactics"), "object", "presenter loaded"); pass("presenter loaded");
  if (process.env.TACTICS_ILLIDAN_ONLY) {
    await checkIllidan(port);
    assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
    return;
  }
  if (process.env.TACTICS_COUNCIL_ONLY) {
    await checkCouncil(port);
    assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
    return;
  }
  if (process.env.TACTICS_MOTHER_ONLY) {
    await checkMother(port);
    assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
    return;
  }
  if (process.env.TACTICS_SHORT_ONLY) {
    await checkShortBriefings(port);
  await checkPresentation(port);
    assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
    return;
  }
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

  const geometry = await evaluate(`(()=>{const a=__tactics,out={bounds:[],gaps:{},volcanoHits:[],pickup:[]};a.scenes.forEach((s,i)=>{if(s.id==='overview')return;a.show(i);a.playback.pause(performance.now());let min=999;for(let t=0;t<=s.duration;t+=250){__seekSource(t);a.render(performance.now());for(const actorId of ['boss',...Object.values(s.cast)]){const p=actorId==='boss'?s._sim.boss:s._sim.pos[actorId];if(!p)continue;const q=a.px(p),r=fx.getBoundingClientRect();if(q.x<20||q.y<20||q.x>r.width-20||q.y>r.height-20)out.bounds.push({scene:s.id,t,id:actorId});}const dist=(x,y)=>TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],x,y);const gaze=s.effects.find(e=>e.kind==='gaze'&&t>=e.start&&t<e.end);if(gaze){const p=s._sim.pos[s.cast[gaze.target]];if(p){min=Math.min(min,dist(p,s._sim.boss));s.effects.filter(e=>e.kind==='volcano'&&t>=e.start&&t<=e.end).forEach(e=>{if(dist(p,e.at)<e.radiusYards)out.volcanoHits.push({scene:s.id,t});});}}}if(min!==999)out.gaps[s.id]=min;});const s=a.scenes.find(x=>x.id==='back');for(const t of [5000,7500,8500]){const sim=a.simulate(s,t),dist=(x,y)=>TacticsLayout.dist(TacticsData.FIGHTS['bt-supremus'],x,y);out.pickup.push({t,tanks:s.raid.filter(p=>p.kind==='tank').map(p=>dist(sim.pos[p.id],sim.boss)),melee:s.raid.filter(p=>p.kind==='melee').map(p=>dist(sim.pos[p.id],sim.boss))});}return out})()`);
  assert.equal(geometry.bounds.length, 0, "sample-scene actors remain visible"); pass("sample-scene actors remain visible");
  assert.equal(geometry.volcanoHits.length, 0, "fixate routes avoid active volcanoes"); pass("fixate routes avoid active volcanoes");
  assert(Object.values(geometry.gaps).every((yards) => yards > 8), "fixate targets remain over 8 yards from boss"); pass("fixate targets remain over 8 yards from boss");
  const pickup = geometry.pickup.find((sample) => sample.t === 7500);
  assert(Math.min(...pickup.tanks) < Math.min(...pickup.melee), "tank pickup precedes melee return"); pass("tank pickup precedes melee return");

  await evaluate("__tactics.show(5);playPause.click()");
  const frozen = await evaluate("__tactics.scenes[5]._t"); await sleep(350);
  assert.equal(await evaluate("__tactics.scenes[5]._t"), frozen); pass("pause freezes scene time");
  await evaluate('__seekSource(10000)');
  assert.equal(await evaluate("__tactics.scenes[5]._t"), 10000); pass("direct explanation selection lands on exact encounter time");
  assert.equal(await evaluate('clockP2.textContent.includes("50s")'), true); pass("scene clock follows seek");
  await evaluate("playPause.click()"); await sleep(1000);
  assert((await evaluate("__tactics.scenes[5]._t")) > 10000); pass("play resumes after seek");
  await evaluate("playPause.click();__seekSource(20000);__tactics.render(performance.now())"); await sleep(250);
  assert.equal(await evaluate("__tactics.scenes[5]._t"), 20000); pass("end frame holds");
  await evaluate('document.querySelectorAll("#dots button")[5].focus()'); await key("ArrowRight");
  assert.equal(await evaluate("stepTitle.textContent"), "Move everyone near the eruption"); pass("scene arrows work after chapter focus");
  await evaluate('__seekSource(6000);replay.focus()'); await key("r", "KeyR");
  assert((await evaluate("__tactics.scenes[6]._t - __tactics.guided.active.startMs")) < 1000); pass("replay shortcut repeats the selected explanation after button focus");

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
  await evaluate("__tactics.show(4);__tactics.playback.pause(performance.now());__seekSource(6000);__tactics.render(performance.now());copyText.click()");
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
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-najentus` }); await waitForPresenter();
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
  await evaluate("__tactics.show(3);__tactics.playback.pause(performance.now());__seekSource(4000);__tactics.render(performance.now())"); await screenshot("najentus-extraction-1600");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__seekSource(60000);__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Shield: heal up/);
  assert.equal(await evaluate("__tactics.scenes[6]._sim.shield"), true);
  assert.equal(await evaluate("Object.keys(__tactics.scenes[6]._sim.focus).length"), await evaluate("__tactics.scenes[6].raid.length"));
  await screenshot("najentus-shield-1600");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evaluate("__tactics.render(performance.now())"); await screenshot("najentus-shield-1280");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "laptop view has no horizontal overflow");
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate("__seekSource(65000);__tactics.render(performance.now())");
  assert.match(await evaluate("sceneCall.textContent"), /raid (?:is )?ready/i);
  await evaluate("__seekSource(67000);__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Spine in flight/);
  await evaluate("__seekSource(67700);__tactics.render(performance.now())");
  assert.match(await evaluate("encounterState.textContent"), /Raidwide burst/);
  assert.equal(await evaluate("__tactics.scenes[6]._sim.burst.damage"), 8500); pass("Najentus seek keeps state, call and burst on the same frame");
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__najText=t},write:async items=>{window.__najBlob=await items[0].getType('image/png')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}");
  await evaluate("copyText.click();copyImage.click()"); await sleep(1000);
  assert((await evaluate("__najText")).includes(await evaluate("sceneCall.textContent"))); assert.match(await evaluate("__najText"), /State: burst/); assert((await evaluate("__najBlob.size")) > 1000); pass("Najentus text and PNG exports carry the current call and stage");
  await screenshot("najentus-burst-1600");
  await evaluate("__tactics.show(5);__tactics.playback.pause(performance.now());__tactics.render(performance.now());__tactics.show(0);__tactics.show(5);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("sceneCall.textContent"), await evaluate("__tactics.scenes[5]._sim.explanation.title"));
  assert.equal(await evaluate("mapCall.textContent"), await evaluate("__tactics.scenes[5]._sim.explanation.title")); pass("Najentus current call refreshes when revisiting a scene");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__seekSource(67700);__tactics.render(performance.now())");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("__tactics.render(performance.now())"); await screenshot("najentus-burst-390");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "phone view has no horizontal overflow");
  await send("Emulation.clearDeviceMetricsOverride");
  await evaluate("localStorage.removeItem('raidAssignmentsState')"); await reload();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  assert.equal(await evaluate("__tactics.assigned.length"), 25); await evaluate("__tactics.show(0);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  await screenshot("najentus-overview-default25-1600"); pass("Najentus default 25-player illustration remains available");
  const bounds = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];a.scenes.forEach((s,i)=>{if(s.id==='overview')return;a.show(i);a.playback.pause(performance.now());const q=[0,s.duration,...(s.sequence.needles||[]).map(x=>x.at),...(s.sequence.impales||[]).flatMap(x=>[x.at,x.extractAt,x.homeAt]),...(s.sequence.shield?[s.sequence.shield.at,s.sequence.shield.readyAt,s.sequence.shield.throwAt,s.sequence.shield.hitAt,s.sequence.shield.recoverAt]:[])].filter(Number.isFinite);q.forEach(t=>{__seekSource(t);a.render(performance.now());['boss',...s.raid.map(p=>p.id)].forEach(id=>{const p=id==='boss'?s._sim.boss:s._sim.pos[id],v=a.px(p);if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<0||v.y<0||v.x>b.width||v.y>b.height)bad.push([s.id,t,id]);});});});return bad})()`);
  assert.equal(bounds.length, 0, "default raid actors remain framed at every authored event boundary"); pass("Najentus boundary frames remain finite and visible");
  const najRoster = JSON.stringify({ manual: [
    { name: "NamedMT", class: "WARRIOR", spec: "Protection", mt: true, flags: [], source: "manual" },
    { name: "NamedHeal", class: "PRIEST", spec: "Holy", flags: [], source: "manual" },
    { name: "NamedRange", class: "MAGE", spec: "Arcane", flags: [], source: "manual" }
  ], playerMeta: { NamedMT: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(najRoster)})`); await reload();
  await evaluate("__tactics.show(6);__seekSource(24000)");
  assert.equal(await evaluate('__tactics.scenes[6].resolved.impales.length'), 1);
  assert.match(await evaluate('sceneCall.textContent'), /first spine|collected/i, 'an unavailable second rescue cannot hide the successful first rescue');
  await evaluate('__seekSource(40000)');
  assert.match(await evaluate('sceneCall.textContent'), /missing|cannot|not.*(?:loaded|available)|no.*(?:pair|rescue|spine)/i, 'a missing second rescue cannot claim a spare spine');
  await evaluate('__seekSource(65000)');
  assert.match(await evaluate('sceneCall.textContent'), /ready/i, 'one real holder still demonstrates the primary throw');
  pass('Najentus partial-roster warnings apply to the selected action');
  await evaluate("__tactics.show(1);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("sceneCall.textContent.includes('One tank')"), true);
  assert.equal(await evaluate("__tactics.scenes[1].raid.every(p => !p.name || p.label.includes(p.name)) && !__tactics.scenes[1]._dim"), true); await screenshot("najentus-positioning-namedpartial-1600"); pass("Najentus positioning labels the actual partial roster");
  await evaluate(`(()=>{window.__downloads=[];window.__downloadBlobs=[];URL.createObjectURL=b=>{window.__downloadBlobs.push(b);return 'blob:najentus-'+window.__downloadBlobs.length};HTMLAnchorElement.prototype.click=function(){window.__downloads.push({name:this.download,href:this.href})};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')},write:async()=>{throw Error('blocked')}}});window.ClipboardItem=class{constructor(items){this.items=items}getType(type){return this.items[type]}}})()`);
  await evaluate("copyText.click();copyImage.click()"); await sleep(1000);
  assert.deepEqual(await evaluate("__downloads.map(x=>x.name).sort()"), ["najentus-briefing-positioning.txt", "najentus-positioning.png"]);
  assert.match(await evaluate("__downloadBlobs[0].text()"), /One tank[\s\S]*NamedMT/);
  assert((await evaluate("__downloadBlobs[1].size")) > 1000); pass("Najentus rejected clipboard fallbacks use slugs and preserve briefing data");
  await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.render(performance.now());window.__pauseQ=__tactics.scenes[6]._t"); await sleep(250);
  assert.equal(await evaluate("__tactics.scenes[6]._t"), await evaluate("__pauseQ"));
  await evaluate("__seekSource(76000);__tactics.render(performance.now())"); await sleep(200);
  assert.equal(await evaluate("__tactics.scenes[6]._t"), 76000); pass("Najentus pause and end frame hold exactly");
  const minimal = JSON.stringify({ manual: [{ name: "OnlyMT", class: "WARRIOR", spec: "Protection", mt: true, flags: [], source: "manual" }], playerMeta: { OnlyMT: { mt: true } } });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(minimal)})`); await reload(); await evaluate("__tactics.show(5);__tactics.playback.pause(performance.now());__seekSource(5700);__tactics.render(performance.now())");
  assert.equal(await evaluate("__tactics.assigned.length"), 1); assert.equal(await evaluate("__tactics.scenes[5]._sim.burst"), null); assert.equal(await evaluate("__tactics.scenes[5]._sim.shield"), true);
  assert.match(await evaluate('sceneCall.textContent'), /no spine holder|missing|cannot/i, 'the visible burst explanation reports the unavailable holder');
  const oversized = JSON.stringify({ manual: Array.from({length: 29},(_,i)=>({name:'P'+i,class:i===0?'WARRIOR':'MAGE',spec:i===0?'Protection':'Arcane',mt:i===0,flags:[],source:'manual'})), playerMeta:{P0:{mt:true}} });
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(oversized)})`); await reload(); await evaluate("__tactics.show(6);__tactics.playback.pause(performance.now());__tactics.render(performance.now())");
  assert.equal(await evaluate("__tactics.assigned.length"), 29); assert.equal(await evaluate("Object.values(__tactics.scenes[6]._sim.pos).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))"), true); pass("Najentus MT-only and oversized browser rosters avoid phantom effects and remain drawable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await reload(); await evaluate("__tactics.show(6)");
  assert.equal(await evaluate("__tactics.playback.playing"), false); await send("Emulation.setEmulatedMedia", { features: [] }); pass("Najentus reduced motion opens paused");
  for (const invalid of ['constructor', '__proto__']) {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?fight=${invalid}` }); await waitForHub();
    assert.equal(await evaluate("typeof __tactics"), "undefined");
    assert.equal(await evaluate("hubNotice.hidden"), false);
  }
  pass("unknown and prototype fight ids return safely to raid selection");
  await evaluate("localStorage.clear()");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/tactics.html?view=detail&fight=bt-najentus` }); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-najentus");
  assert.deepEqual(await evaluate("[...bossNav.children].map(a=>new URL(a.href).searchParams.get('fight'))"), ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-bloodboil', 'bt-reliquary', 'bt-mother', 'bt-council', 'bt-illidan']);
  await evaluate("bossNav.children[2].click()"); await sleep(250); await waitForPresenter();
  assert.equal(await evaluate("__tactics.fight.id"), "bt-akama");
  assert.equal(await evaluate("__tactics.count"), 10);
  assert.deepEqual(await evaluate('__tactics.scenes.map(s=>s.id)'), ['overview','positioning','channelers','doorways','sorcerers','fire','walk','burn','cycle','aoe']);
  const shadeMeta = await evaluate('Object.fromEntries(__tactics.scenes.map(s=>[s.id,{duration:s.duration,...s.sequence}]))');
  assert.equal(await evaluate("bossNav.children[2].getAttribute('aria-current')"), 'page');
  assert.match(await evaluate("referenceContent.textContent"), /guild’s spreadsheet[\s\S]*Seed of Corruption/);
  assert.equal(await evaluate("[...document.images].every(i=>i.complete && i.naturalWidth>0)"), true);
  pass('boss order and default follow the raid; Shade has ten chapters, loaded art and spreadsheet source');

  const shadeBounds = await evaluate(`(()=>{const a=__tactics,b=fx.getBoundingClientRect(),bad=[];a.scenes.forEach((s,i)=>{if(s.id==='overview')return;a.show(i);a.playback.pause(performance.now());for(let t=0;t<=s.duration;t+=500){__seekSource(t);a.render(performance.now());const f=s._sim;[f.boss,f.akama,...Object.values(f.pos),...f.npcs.map(n=>n.at)].forEach(p=>{const v=a.px(p);if(!Number.isFinite(v.x)||!Number.isFinite(v.y)||v.x<8||v.y<8||v.x>b.width-8||v.y>b.height-8)bad.push([s.id,t,p]);});if(sceneCall.textContent!==(f.explanation?f.explanation.title:f.call)||(!f.explanation&&!encounterState.textContent.includes(a.fight.stateLabels[f.stage])))bad.push(['state',s.id,t]);}});return bad})()`);
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
  assert((await evaluate('__shadeScene._t - __tactics.guided.active.startMs')) < 1000);
  pass('Shade holds the final victory frame and replay repeats the selected explanation');
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
  assert(shadeExport.includes(await evaluate("sceneCall.textContent")));
  assert.match(shadeExport, /PaladinLeft[\s\S]*TrapHunter/);
  assert.doesNotMatch(shadeExport, /Hateful|Misdirect|spine|volcano/i);
  assert((await evaluate('__image.size')) > 1000);
  pass('Shade preserves named roster and exports the current burn call and image');
  await evaluate(`__seekSource(${shadeMeta.cycle.duration});copyText.click()`);
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
  await evaluate(`__seekSource(${shadeMeta.cycle.engageAt+4000});__tactics.render(performance.now())`);
  await evaluate(`(()=>{window.__downloads=[];window.__blobs=[];URL.createObjectURL=b=>{__blobs.push(b);return 'blob:akama-'+__blobs.length};HTMLAnchorElement.prototype.click=function(){__downloads.push(this.download)};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked')},write:async()=>{throw Error('blocked')}}})})()`);
  await evaluate('copyText.click();copyImage.click()'); await sleep(250);
  assert.deepEqual(await evaluate('__downloads.sort()'), ['akama-briefing-cycle.txt','akama-cycle.png']);
  assert((await evaluate('__blobs[0].text()')).includes(await evaluate('sceneCall.textContent')));
  assert.match(await evaluate('__blobs[0].text()'), /TrapHunter/);
  pass('Shade clipboard fallback saves its current briefing and PNG');
  await showShade('aoe',shadeMeta.aoe.aoeAt+500);
  await evaluate('__downloads=[];__blobs=[];copyText.click();copyImage.click()'); await sleep(250);
  assert.deepEqual(await evaluate('__downloads.sort()'), ['akama-aoe.png','akama-briefing-aoe.txt']);
  assert.match(await evaluate('__blobs[0].text()'), /AoE[\s\S]*TrapHunter/);
  pass('alternative chapter exports use their own filenames');
  await evaluate(`localStorage.setItem('raidAssignmentsState',${JSON.stringify(minimal)})`); await reload();
  await showShade('cycle', shadeMeta.cycle.duration);
  assert.equal(await evaluate('__tactics.assigned.length'), 1);
  assert.match(await evaluate('sceneCall.textContent'), /no damage|not defeated|missing/i, 'the visible final step cannot claim a kill without damage');
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
  await checkRaidHubAndHyjal(port);
  await checkReliquary(port);
  await checkBloodboil(port);
  await checkMother(port);
  await checkCouncil(port);
  await checkIllidan(port);
  await checkSharedGuidedFlow(port);
  await checkOnScreenGuidance(port);
  await checkStableFightFraming(port);
  await checkShortBriefings(port);
  await checkPresentation(port);
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
