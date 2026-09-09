'use strict';
const assert = require('node:assert/strict');
const L = require('./tactics-layout.js');
const Council = require('./tactics-council.js');
const fight = require('./tactics-data.js').FIGHTS['bt-council'];
const Steps = require('./tactics-steps.js').forFight(fight.id);
const source = id => fight.scenes.find(s => s.id === id);
const assigned = [
    ['T1','tank','WARRIOR'],['T2','tank','DRUID'],['T3','tank','PALADIN'],['Kick','melee','ROGUE'],
    ['PoisonHeal','healer','PRIEST'],['TankHeal','healer','SHAMAN'],['Mage','ranged','MAGE'],['Caster','ranged','WARLOCK'],['Shock','ranged','SHAMAN']
].map(([name,kind,playerClass],i)=>({id:'p'+i,name,kind,class:playerClass,slotIndex:i}));
const prep = (id,raid=assigned)=>Council.prepareScene(fight,source(id),raid);
const frame = (sc,t)=>Council.simulate(fight,sc,t);
const demo = id=>prep(id,L.assign(fight));
const boss = (f,id)=>f.bosses.find(b=>b.id===id).at;
const named=prep('positioning');
assert.deepEqual(named.assignments,{Gathios:'p0',Veras:'p1',Malande:'p2',Zerevor:'p6'});
assert.equal(named.physicalKicker,'p3');
assert.equal(named.magicKicker,'p8','dedicated ranged shaman preferred over tank healer');
assert(L.dist(fight,named.baseById[named.physicalKicker],boss(frame(named,0),'Malande'))<=5,'physical kick is in melee range');
assert(L.dist(fight,named.baseById[named.magicKicker],boss(frame(named,0),'Malande'))<=20,'Earth Shock backup is in range');
assert.notEqual(named.poisonHealer,named.magicKicker);
assert.match(named.missingRoles.join(' '),/tank healing missing/,'partial healing coverage is explicit');
assert.equal(new Set(Object.values(demo('positioning').healerAssignments)).size,4,'demo has four dedicated tank healers');

for(const sc of fight.scenes.map(s=>demo(s.id))){
    for(let t=0;t<=sc.duration;t+=500){
        const f=frame(sc,t); frame(sc,sc.duration); frame(sc,0);
        assert.deepEqual(frame(sc,t),f,sc.id+' deterministic seeks');
        assert.equal(Object.keys(f.pos).length,25);
        assert.equal(f.bosses.length,4);
        for(const p of [...Object.values(f.pos),...f.bosses.map(b=>b.at)]){
            assert(Number.isFinite(p.x)&&Number.isFinite(p.y));
            assert(p.x>=fight.arena.x0&&p.x<=fight.arena.x1&&p.y>=fight.arena.y0&&p.y<=fight.arena.y1,sc.id+' bounded at '+t);
        }
        for (const [bossName, healerId] of Object.entries(sc.healerAssignments)) {
            if (sc.id === 'kite' && bossName === 'Zerevor') continue; // Heal at the bottom of the optional kite.
            assert(L.dist(fight, f.pos[healerId], f.pos[sc.assignments[bossName]]) <= 40, sc.id + ' healer covers ' + bossName + ' player tank at ' + t);
        }
        const z= boss(f,'Zerevor');
        assert(Object.values(f.pos).every(p=>L.dist(fight,p,z)>10),sc.id+' keeps raid outside Zerevor at '+t);
    }
}
const rotation=demo('rotation'), start=frame(rotation,0), moving=frame(rotation,2500), end=frame(rotation,14000);
for(const id of ['Gathios','Veras'])assert.notDeepEqual(boss(moving,id),boss(start,id));
for(const id of ['Malande','Zerevor'])assert.deepEqual(boss(moving,id),boss(start,id));
for(const id of [rotation.assignments.Malande,rotation.mageTank,rotation.physicalKicker,rotation.magicKicker])assert.deepEqual(moving.pos[id],start.pos[id]);
for(const p of rotation.raid.filter(p=>p.kind==='melee'&&![rotation.physicalKicker,rotation.magicKicker].includes(p.id)))assert.notDeepEqual(moving.pos[p.id],start.pos[p.id]);
assert.equal(end.hazards.length,3,'all old patches persist');
assert(end.hazards.every(h=>h.expiresAt>14000));
for(const t of [3500,7000,11000,14000]){
    const f=frame(rotation,t);
    for(const p of rotation.raid)assert(f.hazards.every(h=>L.dist(fight,f.pos[p.id],h.at)>=h.radiusYards),p.id+' is outside old patches at '+t);
}
const ground=demo('hazards'), escaped=frame(ground,3500);
assert.equal(escaped.hazards.length,2);
assert(ground.raid.every(p=>escaped.hazards.every(h=>L.dist(fight,escaped.pos[p.id],h.at)>=h.radiusYards)),'everyone leaves every backline patch');
assert.equal(frame(ground,9000).hazards.length,2,'ground remains after recovery');

const kicks=prep('interrupts');
assert.equal(frame(kicks,1000).shield.active,false,'no immunity means no shield');
assert.equal(frame(kicks,6000).shield.bossId,'Malande');
assert.equal(frame(kicks,6500).casts[0].kickerId,kicks.magicKicker);
assert.equal(frame(kicks,11500).casts[0].kickerId,kicks.physicalKicker);
const noPaladin=prep('interrupts',assigned.map(p=>({...p,class:p.class==='PALADIN'?'DRUID':p.class})));
assert.equal(frame(noPaladin,6500).casts[0].interrupted,true,'boss blessing does not require a friendly paladin');
const noKicks=prep('interrupts',assigned.filter(p=>!['p3','p5','p8'].includes(p.id)));
assert.equal(frame(noKicks,1500).casts[0].interrupted,false);
assert.match(frame(noKicks,1500).call,/missing/i);
assert.match(Council.resolveExplanation(Steps.forScene('interrupts')[0],noKicks).title,/missing/i);
const unknown=prep('mage',assigned.map(p=>({...p,class:null})));
assert.equal(unknown.mageTank,null,'imported unknown classes are never inferred');
assert.match(Council.resolveExplanation(Steps.forScene('mage')[0],unknown).title,/missing/i);
for(const sceneId of ['pull','cycle']){
    const sc=prep(sceneId,assigned.filter(p=>p.id!=='p6'));
    assert.match(frame(sc,5000).call,/missing/i);
    assert.match(Council.resolveExplanation(Steps.forScene(sceneId)[0],sc).title,/missing/i);
}
const mage=demo('mage');
assert.match(frame(mage,6500).casts[0].label,/reapplied/);
assert.match(frame(mage,8000).casts[0].label,/Fresh Dampen stolen/);
assert.equal(frame(mage,8000).casts[0].active,false);
assert.equal(frame(mage,8000).mageProtection,true);
const poison=demo('poison');
assert.equal(poison.poisonTargets.length,3);
assert(poison.poisonTargets.every(id=>!poison.tanks.includes(id)));
assert(frame(poison,2000).bosses.find(b=>b.id==='Veras').hidden);
assert.equal(frame(poison,9500).bosses.find(b=>b.id==='Veras').hidden,false);
for(const id of poison.poisonTargets){assert(frame(poison,5000).hp[id]<frame(poison,4000).hp[id]);assert.equal(frame(poison,8500).hp[id],1);}
const noHeal=prep('poison',L.assign(fight,{ranged:['Unknown'],tanks:['Tank']}));
assert.match(frame(noHeal,8500).call,/missing/);
assert.equal(frame(noHeal,8500).hp[noHeal.poisonTargets[0]],.35,'no fabricated healing');
const kite=demo('kite');
assert.deepEqual(frame(kite,kite.duration).pos[kite.mageTank],kite.baseById[kite.mageTank]);
assert.match(Council.copyText(fight,named),/Gathios tank — T1[\s\S]*Zerevor Mage tank — Mage[\s\S]*Physical kick — Kick[\s\S]*Magical kick — Shock/);
console.log('Illidari Council simulation, geometry, immunity and roster checks passed');
