'use strict';
const assert = require('node:assert/strict');
const Data = require('./tactics-data.js'), L = require('./tactics-layout.js'), I = require('./tactics-illidan.js'), Steps = require('./tactics-illidan-steps.js');
const fight = Data.FIGHTS['bt-illidan'], source = id => fight.scenes.find(s => s.id === id);
const frame = (s,t) => I.simulate(fight,s,t), prepare = (id,raid=L.assign(fight)) => I.prepareScene(fight,source(id),raid);
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const player = (id,name,kind,playerClass,slotIndex) => ({id,name,kind,class:playerClass,slotIndex,slot:L.slots(fight)[slotIndex]});

function fullRaid(){
    const rows=[['t0','Druid first','tank','DRUID'],['t1','Preferred warrior','tank','WARRIOR'],['t2','Paladin','tank','PALADIN'],
        ...Array.from({length:7},(_,i)=>['m'+i,'Melee '+i,'melee',i?'WARRIOR':'ROGUE']),
        ...Array.from({length:6},(_,i)=>['h'+i,'Healer '+i,'healer',i%2?'SHAMAN':'PRIEST']),
        ...Array.from({length:9},(_,i)=>['r'+i,'Ranged '+i,'ranged',i===4?'WARLOCK':i?'MAGE':'HUNTER'])];
    return rows.map((r,i)=>player(...r,i));
}
const raid=fullRaid(), raidById=new Map(raid.map(p=>[p.id,p])), prep=id=>prepare(id,raid);
function inArena(p,label){assert(finite(p),label+' finite');assert(p.x>=fight.arena.x0&&p.x<=fight.arena.x1,label+' x bounded');assert(p.y>=fight.arena.y0&&p.y<=fight.arena.y1,label+' y bounded');}
function allTimes(s){const out=new Set([0,s.duration]);for(let t=0;t<=s.duration;t+=500)out.add(t);for(const x of Steps[s.id]){out.add(x.startMs);out.add(x.holdAtMs);}return [...out].filter(t=>t>=0&&t<=s.duration).sort((a,b)=>a-b);}
function segmentDistance(p,a,b){
    const scale=q=>({x:q.x/fight.yard,y:q.y/(fight.yard*fight.aspect)}),q=scale(p),u=scale(a),v=scale(b),dx=v.x-u.x,dy=v.y-u.y,n=dx*dx+dy*dy;
    const k=n?Math.max(0,Math.min(1,((q.x-u.x)*dx+(q.y-u.y)*dy)/n)):0;
    return Math.hypot(q.x-u.x-dx*k,q.y-u.y-dy*k);
}
function frontDot(f,id){const dx=f.frontal.to.x-f.frontal.from.x,dy=(f.frontal.to.y-f.frontal.from.y)/fight.aspect;return dx*(f.pos[id].x-f.boss.x)+dy*(f.pos[id].y-f.boss.y)/fight.aspect;}

// Seek every half-second and every exact authored boundary. Every result is deterministic,
// finite, bounded, and retains the complete 3T/6H/7M/9R teaching roster.
for(const data of fight.scenes){
    const s=prep(data.id);assert.equal(s.duration,data.duration);
    for(const t of allTimes(data)){
        const f=frame(s,t);assert.deepEqual(frame(s,t),f,data.id+' deterministic @'+t);assert.equal(Object.keys(f.pos).length,25,data.id+' roster @'+t);
        Object.entries(f.pos).forEach(([id,p])=>inArena(p,data.id+':'+id+'@'+t));inArena(f.boss,data.id+':boss@'+t);
        assert(f.phase>=1&&f.phase<=5,data.id+' valid phase');assert.equal(typeof f.stage,'string');assert(Array.isArray(f.hazards));assert(Array.isArray(f.missingCoverage));
    }
}

// Imported unknown classes never acquire guessed specialist assignments. A known
// Warrior or Paladin is preferred for main tank even when later in the tank list.
const unknown=prepare('positioning',L.assign(fight,{tanks:['T1','T2','T3'],healers:['H1','H2'],ranged:['R']}));
assert.equal(unknown.mainTank,'p0');assert.deepEqual(unknown.flameTanks,['p1','p2']);assert.equal(unknown.shadowTank,null);assert.deepEqual(unknown.flameHealers,unknown.raid.filter(p=>p.kind==='healer').map(p=>p.id));assert.deepEqual(unknown.shadowHealers,unknown.flameHealers);assert(unknown.raid.every(p=>p.class==null),'unknown imported classes remain unknown');assert.match(frame(unknown,0).missingCoverage.join(' '),/Shear|class|Shadow/i);
const assigned=prep('positioning');assert.equal(assigned.mainTank,'t1');assert.deepEqual(assigned.flameTanks,['t0','t2']);assert.equal(assigned.shadowTank,'r4');assert.equal(assigned.flameHealers.length,2);assert.equal(assigned.shadowHealers.length,2);

// Empty, partial, and 29-player imports never crash or invent/remove actors.
for(const roster of [[],L.assign(fight,{tanks:['T'],healers:['H'],ranged:['R']}),L.assign(fight,{tanks:['T1','T2','T3'],healers:Array.from({length:6},(_,i)=>'H'+i),melee:Array.from({length:7},(_,i)=>'M'+i),ranged:Array.from({length:13},(_,i)=>'R'+i)})]){
    for(const data of fight.scenes){const s=prepare(data.id,roster);for(const t of [0,...Steps[data.id].map(x=>x.startMs),data.duration]){const f=frame(s,t);assert.equal(Object.keys(f.pos).length,roster.length);Object.values(f.pos).forEach(p=>inArena(p,data.id+' partial'));}}
}

const ground=prep('ground');
for(const t of [6500,12000]){const f=frame(ground,t),fire=f.hazards.find(h=>/Flame Crash/i.test(h.kind));assert(fire&&Number.isFinite(fire.radiusYards));assert(L.dist(fight,f.pos[ground.mainTank],fire.at)>=fire.radiusYards);assert(frontDot(f,ground.mainTank)>0,'tank in front');for(const p of raid.filter(x=>x.kind==='melee')){assert(frontDot(f,p.id)<0,p.id+' behind');assert(L.dist(fight,f.pos[p.id],fire.at)>=fire.radiusYards,p.id+' clears old fire');}}
assert.deepEqual(frame(ground,6500).pos,frame(ground,12000).pos,'ground arrival holds');assert.deepEqual(frame(ground,6500).boss,frame(ground,12000).boss);

const parasites=prep('parasites'),spawn=frame(parasites,10000),dead=frame(parasites,13000);assert.equal((frame(parasites,9999).adds||[]).length,0);assert.equal(spawn.adds.length,2);assert(spawn.adds.every(a=>!a.dead));assert(dead.adds.every(a=>a.dead));
const carrier=parasites.parasiteTarget;assert(carrier&&['melee','ranged'].includes(raidById.get(carrier).kind));assert(raid.filter(p=>p.id!==carrier).every(p=>L.dist(fight,spawn.pos[carrier],spawn.pos[p.id])>5),'carrier isolated');assert(parasites.raid.filter(p=>p.kind==='healer').some(p=>L.dist(fight,spawn.pos[carrier],spawn.pos[p.id])<=40),'carrier healable');
const noPH=prepare('parasites',raid.filter(p=>p.kind!=='healer'));assert.match(frame(noPH,10000).missingCoverage.join(' '),/parasite.*heal|heal.*parasite/i);
const noFree=prepare('parasites',[player('d','Only damage','ranged','MAGE',0),player('t','Tank','tank','WARRIOR',1),player('h','Heal','healer','PRIEST',2)]);assert(frame(noFree,13000).adds.every(a=>!a.dead),'carrier/tank/healer are not fake killers');

function airGeometry(f,s){
    assert.equal(f.flames.length,2,s.id+' two Flames');assert.equal(f.glaives.length,2,s.id+' two glaives');
    for(let i=0;i<2;i++){const flame=f.flames[i],glaive=f.glaives.find(g=>g.id===flame.glaiveId);assert(glaive,flame.id+' own glaive');assert(L.dist(fight,flame.at,glaive.at)<=25,flame.id+' tether');if(flame.tankId)assert(i?f.pos[flame.tankId].x>flame.at.x:f.pos[flame.tankId].x<flame.at.x,flame.id+' outward tank');}
    const ft=new Set(f.flames.map(x=>x.tankId).filter(Boolean));for(const p of s.raid.filter(x=>x.kind==='tank'&&!ft.has(x.id)))for(const glaive of f.glaives)assert(L.dist(fight,f.pos[p.id],glaive.at)<=25,p.id+' remains in the central safe area');
}
const flames=prep('flames');for(const t of [0,1500,7000,11000,14000])airGeometry(frame(flames,t),flames);
assert.deepEqual(frame(flames,6999).flames.map(x=>x.dead),[false,false]);assert.deepEqual(frame(flames,7000).flames.map(x=>x.dead),[true,false]);assert.deepEqual(frame(flames,10999).flames.map(x=>x.dead),[true,false]);assert.deepEqual(frame(flames,11000).flames.map(x=>x.dead),[true,true]);
const earlyBlaze=frame(flames,1500).hazards.filter(h=>/Blaze/i.test(h.kind)),lateBlaze=frame(flames,14000).hazards.filter(h=>/Blaze/i.test(h.kind));assert(earlyBlaze.length>=2&&lateBlaze.length>=earlyBlaze.length);for(const h of earlyBlaze)assert(lateBlaze.some(x=>L.dist(fight,x.at,h.at)<.01),'Blaze persists');
const noFlame=prepare('flames',[player('d','Damage','ranged','MAGE',0)]);assert.equal(frame(noFlame,11000).flames.length,2);assert(frame(noFlame,11000).flames.every(x=>!x.dead));
const grouped=frame(flames,0);assert.equal(grouped.groups.length,3);for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(const left of grouped.groups[a].ids)for(const right of grouped.groups[b].ids)assert(L.dist(fight,grouped.pos[left],grouped.pos[right])>10,left+'/'+right+' group separation');

const eye=prep('eye');for(const t of [3000,3500,5000,7000,12000]){const f=frame(eye,t);airGeometry(f,eye);const beam=f.eyeBeam;assert(beam&&finite(beam.from)&&finite(beam.to)&&Number.isFinite(beam.radiusYards),'beam geometry');if(t>3000){const flame=f.flames.find(x=>x.tankId===eye.flameTanks[0]);assert(segmentDistance(f.pos[flame.tankId],beam.from,beam.to)>=beam.radiusYards,'tank clears beam @'+t);assert(segmentDistance(flame.at,beam.from,beam.to)>=beam.radiusYards,'Flame clears beam @'+t);}}
assert(frame(eye,3000).hazards.some(h=>/Eye Blast/i.test(h.kind)),'damage trail begins @3000');assert(frame(eye,12000).hazards.some(h=>/Eye Blast/i.test(h.kind)),'trail persists');

const demon=prep('demon'),ds=frame(demon,6000),dh=frame(demon,10999),dd=frame(demon,11000);assert.equal(ds.demons.length,4);assert.equal(new Set(ds.demons.map(x=>x.targetId)).size,4);for(const x of ds.demons)assert.deepEqual(ds.pos[x.targetId],dh.pos[x.targetId],x.targetId+' fixed');assert(ds.demons.every(x=>!x.dead));assert(dd.demons.every(x=>x.dead));
const targets=new Set(ds.demons.map(x=>x.targetId));assert(demon.raid.some(p=>['melee','ranged'].includes(p.kind)&&p.id!==demon.shadowTank&&!targets.has(p.id)),'free eligible killer exists');
for(const p of demon.raid){assert(L.dist(fight,ds.pos[p.id],ds.boss)>15,p.id+' outside aura');if(p.id!==demon.shadowTank)assert(L.dist(fight,ds.pos[p.id],ds.pos[demon.shadowTank])>20,p.id+' outside Shadow splash');}
for(let a=0;a<demon.raid.length;a++)for(let b=a+1;b<demon.raid.length;b++)assert(L.dist(fight,ds.pos[demon.raid[a].id],ds.pos[demon.raid[b].id])>5,'Demon spread');for(const id of demon.shadowHealers)assert(L.dist(fight,ds.pos[id],ds.pos[demon.shadowTank])<=40,id+' healer range');
const noDD=prepare('demon',[player('t','Tank','tank','WARRIOR',0),player('s','Shadow','ranged','WARLOCK',1),player('h1','Heal1','healer','PRIEST',2),player('h2','Heal2','healer','SHAMAN',3)]);assert(frame(noDD,11000).demons.every(x=>!x.dead),'no fake Demon kills');

const maiev=prep('maiev'),armed=frame(maiev,7000),caged=frame(maiev,11000);assert(armed.trap.armed);assert(L.dist(fight,armed.pos[maiev.trapActivator],armed.trap.at)<=5,'real activator in range');assert(caged.trap.caged);assert(segmentDistance(armed.trap.at,armed.boss,caged.boss)<.01,'boss path traverses trap');for(const t of [7000,9000,11000,14000])assert(frontDot(frame(maiev,t),maiev.mainTank)>0,'tank in front @'+t);assert(frame(maiev,11000).hazards.some(h=>/Flame Crash/i.test(h.kind)),'phase 5 keeps ground hazards');
const noAct=prepare('maiev',raid.filter(p=>p.kind==='tank'||p.kind==='healer'));assert.equal(frame(noAct,11000).trap.armed,false);assert.equal(frame(noAct,11000).trap.caged,false);

// The combined demo delegates to the same local simulations at each selected segment.
const cycle=prep('cycle'),segments=[[0,'ground',0],[6500,'ground',6500],[8000,'flames',0],[15000,'flames',7000],[20000,'landing',0],[24500,'landing',4500],[28000,'demon',0],[34000,'demon',6000],[40000,'maiev',0],[47000,'maiev',7000]];
for(const [ct,id,lt] of segments){const a=frame(cycle,ct),b=frame(prep(id),lt);assert.equal(a.phase,b.phase,'cycle phase '+id);assert.equal(a.stage,'cycle','combined demo retains its authored stage');for(const key of ['pos','boss','bossTarget','frontal','hazards','flames','glaives','groups','demons','adds','trap','damageHeld'])assert.deepEqual(a[key],b[key],'cycle '+key+' '+id+'@'+lt);}

// Internal detailed-step IDs never produce success copy when their required roles are absent.
for(const id of ['flames','eye','barrage','demon','maiev']){const s=prepare(id,[]);for(const step of Steps[id]){const e=I.resolveExplanation(step,s);assert.match((e.title||'')+' '+(e.detail||''),/missing|unavailable|required/i,id+':'+step.id);}}
// Demo assignment order differs from explicit named fixtures: the actual assigned
// carrier healer must remain in range throughout the drop and spawn movement.
const demoParasites = prepare('parasites');
for (let t = 0; t <= demoParasites.duration; t += 250) {
    const f = frame(demoParasites, t);
    assert(L.dist(fight, f.pos[demoParasites.parasiteHealer], f.pos[demoParasites.parasiteTarget]) <= 40, 'default carrier healer reaches target @' + t);
    assert.notEqual(demoParasites.parasiteHealer, demoParasites.mainHealer, 'main-tank healing remains assigned separately');
}
const unverifiedTank = prepare('ground', L.assign(fight, { tanks: ['Unknown tank'], healers: ['Healer'] }));
assert.equal(frame(unverifiedTank, 0).shear.prepared, false, 'a role import does not prove Shear preparation');
assert.equal(frame(unverifiedTank, 0).shear.gearVerified, false);
assert.match(frame(unverifiedTank, 0).call, /verify/i);
console.log('Illidan deterministic behavior, geometry, roster, and transition contracts passed');
