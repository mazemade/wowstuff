(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsCouncil = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const copy = p => ({ x: p.x, y: p.y });
    const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * clamp(k), y: a.y + (b.y - a.y) * clamp(k) });
    const cls = p => String(p.class || '').trim().toUpperCase();
    const BOSSES = { Gathios: { x: .60, y: .53 }, Veras: { x: .58, y: .43 }, Malande: { x: .54, y: .23 }, Zerevor: { x: .36, y: .17 } };
    const POINTS = [{ x: .60, y: .53 }, { x: .735, y: .36 }, { x: .835, y: .65 }, { x: .68, y: .82 }];
    const inside = (f, p) => ({ x: clamp(p.x, f.arena.x0 + .015, f.arena.x1 - .015), y: clamp(p.y, f.arena.y0 + .02, f.arena.y1 - .02) });
    function nameOf(sc, id, fallback = 'Missing') {
        const p = sc.raid.find(x => x.id === id);
        if (!p) return fallback;
        if (p.name) return p.name;
        const peers = sc.raid.filter(x => x.kind === p.kind);
        return ({ tank: 'Tank', healer: 'Healer', melee: 'Melee', ranged: 'Ranged' }[p.kind]) + ' ' + (peers.indexOf(p) + 1);
    }
    function prepareScene(fight, source, assigned) {
        const sc = JSON.parse(JSON.stringify(source));
        const demo = assigned.length === 25 && assigned.every(p => !p.name);
        const classes = { tank: ['WARRIOR', 'DRUID', 'PALADIN'], healer: ['PRIEST', 'SHAMAN', 'PALADIN', 'DRUID'], melee: ['ROGUE', 'WARRIOR', 'SHAMAN'], ranged: ['MAGE', 'WARLOCK', 'HUNTER', 'PRIEST'] };
        const groups = { tank: [], melee: [], healer: [], ranged: [] };
        sc.raid = assigned.map(p => {
            const group = groups[p.kind], options = classes[p.kind];
            const player = { ...p, class: p.class || (demo ? options[group.length % options.length] : null) };
            group.push(player); return player;
        });
        sc.tanks = groups.tank.slice(0, 3).map(p => p.id);
        sc.mageTank = groups.ranged.find(p => cls(p) === 'MAGE')?.id || null;
        sc.assignments = { Gathios: sc.tanks[0] || null, Veras: sc.tanks[1] || null, Malande: sc.tanks[2] || null, Zerevor: sc.mageTank };
        // Prefer dedicated damage players; Malande's own warrior tank is a fallback.
        sc.physicalKicker = groups.melee.find(p => ['ROGUE', 'WARRIOR'].includes(cls(p)))?.id
            || sc.raid.find(p => p.id === sc.assignments.Malande && cls(p) === 'WARRIOR')?.id || null;
        sc.magicKicker = groups.ranged.concat(groups.melee, groups.healer).find(p => p.id !== sc.mageTank && ['SHAMAN', 'MAGE'].includes(cls(p)))?.id || null;
        sc.paladin = sc.raid.find(p => cls(p) === 'PALADIN')?.id || null;
        sc.poisonHealer = groups.healer.find(p => p.id !== sc.magicKicker)?.id || null;
        sc.tankHealers = groups.healer.filter(p => p.id !== sc.poisonHealer).map(p => p.id);
        sc.healerAssignments = Object.fromEntries(Object.keys(BOSSES).map((boss, i) => [boss, sc.tankHealers[i] || null]));
        sc.poisonTargets = groups.ranged.filter(p => p.id !== sc.mageTank && p.id !== sc.magicKicker)
            .concat(groups.melee.filter(p => p.id !== sc.physicalKicker && p.id !== sc.magicKicker), groups.healer).slice(0, 3).map(p => p.id);
        sc.missingRoles = [];
        if (sc.tanks.length < 3) sc.missingRoles.push('Tank assignments incomplete: ' + sc.tanks.length + '/3 conventional tanks loaded.');
        if (!sc.mageTank) sc.missingRoles.push('Mage tank missing: no known ranged Mage for Zerevor and Spellsteal.');
        if (!sc.physicalKicker) sc.missingRoles.push('Physical interrupt missing for Malande.');
        if (!sc.magicKicker) sc.missingRoles.push('Magical interrupt missing outside the Zerevor mage tank job.');
        if (!sc.poisonHealer) sc.missingRoles.push('Dedicated poison healer missing.');
        const uncovered = Object.keys(sc.healerAssignments).filter(b => !sc.healerAssignments[b]);
        if (uncovered.length) sc.missingRoles.push('Dedicated tank healing missing for ' + uncovered.join(', ') + '. Agree coverage before pulling.');
        if (!sc.paladin) sc.missingRoles.push('No known Paladin for the guild’s friendly BoP pull.');
        sc.baseById = {};
        sc.raid.forEach(p => {
            const i = groups[p.kind].indexOf(p); let at;
            if (p.kind === 'tank') at = [{ x: .627, y: .548 }, { x: .607, y: .448 }, { x: .56, y: .195 }][i] || { x: .70, y: .72 };
            else if (p.id === sc.mageTank) at = { x: .27, y: .20 };
            else if (p.kind === 'melee') at = { x: .565 - (i % 3) * .017, y: .555 + Math.floor(i / 3) * .026 };
            else if (p.kind === 'healer') at = [{ x: .44, y: .73 }, { x: .70, y: .57 }, { x: .83, y: .49 }, { x: .46, y: .38 }, { x: .29, y: .45 }, { x: .88, y: .72 }][i % 6];
            else at = i % 2 ? { x: .35 + (Math.floor(i / 2) % 3) * .075, y: .68 + Math.floor(i / 6) * .14 } : { x: .84 + (Math.floor(i / 2) % 2) * .055, y: .32 + Math.floor(i / 4) * .24 };
            sc.baseById[p.id] = inside(fight, at);
        });
        if (sc.physicalKicker && sc.physicalKicker !== sc.assignments.Malande) sc.baseById[sc.physicalKicker] = { x: .518, y: .258 };
        if (sc.magicKicker) sc.baseById[sc.magicKicker] = { x: .64, y: .27 };
        if (sc.id === 'kite' && sc.mageTank) sc.baseById[sc.mageTank] = { x: .27, y: .30 };
        sc.bossActor = { id: 'gathios', at: copy(BOSSES.Gathios), scale: .8 };
        return sc;
    }
    function baseFrame(sc, t) {
        return { timeMs: t, phase: 1, stage: sc.id,
            pos: Object.fromEntries(sc.raid.map(p => [p.id, copy(sc.baseById[p.id])])),
            hp: Object.fromEntries(sc.raid.map(p => [p.id, 1])), roles: {}, focus: {},
            boss: copy(BOSSES.Gathios), bossTarget: sc.assignments.Gathios, bossVisible: false,
            bosses: Object.entries(BOSSES).map(([id, at]) => ({ id, at: copy(at), targetId: sc.assignments[id] })),
            routes: [], hazards: [], casts: [], shield: { active: false }, call: sc.call, instructionRows: sc.jobs.slice(), mageProtection: !!sc.mageTank };
    }
    function assignments(sc, f) {
        Object.entries(sc.assignments).forEach(([boss, id], i) => { if (id) f.roles[id] = boss === 'Zerevor' ? 'Mage' : 'T' + (i + 1); });
        if (sc.physicalKicker !== sc.assignments.Malande && sc.physicalKicker) f.roles[sc.physicalKicker] = 'Kick';
        if (sc.magicKicker) f.roles[sc.magicKicker] = 'Magic kick';
        if (sc.id === 'positioning') f.instructionRows = [
            ['Boss tanks', Object.entries(sc.assignments).map(([b, id]) => b + ': ' + nameOf(sc, id)).join(' · ')],
            ['Malande interrupts', 'Physical: ' + nameOf(sc, sc.physicalKicker) + ' · Magic: ' + nameOf(sc, sc.magicKicker)],
            ['Healing', 'Poison: ' + nameOf(sc, sc.poisonHealer) + '. Tank coverage: ' + Object.entries(sc.healerAssignments).map(([b,id]) => b + ': ' + nameOf(sc,id)).join(' · ')]
        ];
    }
    function pull(sc, f, t) {
        const controlled = Object.values(sc.assignments).every(Boolean);
        f.mageProtection = !!sc.mageTank && t >= 1500;
        f.pullProtection = sc.paladin && sc.mageTank && t < 4500 ? sc.mageTank : null;
        if (sc.mageTank) f.focus[sc.mageTank] = true;
        if (sc.paladin && t < 1500) { f.focus[sc.paladin] = true; f.roles[sc.paladin] = 'BoP mage'; }
        if (sc.mageTank && t >= 1500) f.casts.push({ bossId: 'Zerevor', label: 'Dampen stolen', interrupted: false, active: false });
        f.call = !controlled ? 'Tank control missing: complete all four boss assignments.' : !sc.paladin ? 'BoP pull support missing: agree the opening before pulling.' : t < 1500 ? 'BoP the mage; prepare every pickup.' : t < 4500 ? 'Mage steals Dampen. Other tanks secure their bosses.' : 'All four bosses controlled: damage may start.';
    }
    function rotation(fight, sc, f, t) {
        const starts = [1200, 4500, 8500], ends = [3500, 7000, 11000];
        [1000,4500,8500].forEach((at, i) => { if (t >= at && t < at + 20000) f.hazards.push({ kind: 'Consecration', at: copy(POINTS[i]), radiusYards: 8, expiresAt: at + 20000 }); });
        let leg = -1; starts.forEach((at, i) => { if (t >= at) leg = i; });
        const from = POINTS[Math.max(0,leg)], to = POINTS[leg < 0 ? 0 : leg + 1];
        const progress = leg < 0 ? 0 : clamp((t-starts[leg])/(ends[leg]-starts[leg]));
        const pack = mix(from,to,progress), dx = pack.x-BOSSES.Gathios.x, dy = pack.y-BOSSES.Gathios.y;
        ['Gathios','Veras'].forEach(boss => {
            const b = f.bosses.find(b=>b.id===boss); b.at = { x: BOSSES[boss].x+dx, y: BOSSES[boss].y+dy };
        });
        const movers = sc.raid.filter(p => [sc.assignments.Gathios,sc.assignments.Veras].includes(p.id) || p.kind==='melee' && ![sc.physicalKicker,sc.magicKicker].includes(p.id));
        movers.forEach(p=>{ f.pos[p.id]=inside(fight,{x:sc.baseById[p.id].x+dx,y:sc.baseById[p.id].y+dy}); f.focus[p.id]=true; });
        f.boss=copy(pack); f.rotationPoints=POINTS.map(copy);
        if (leg>=0 && progress<1) f.routes.push({from:pack,to:copy(to)});
        f.call = t<1000 ? 'Hold the pack at point 1; move as soon as ground appears.' : 'Move Gathios, Veras and melee to clear ground. Keep Malande and Zerevor controlled.';
    }
    function interrupts(sc,f,t) {
        const round=Math.min(2,Math.floor(t/5000)), local=t-round*5000;
        const kicker=round===1?sc.magicKicker:sc.physicalKicker;
        const kind=['None','Protection · magic kick','Spell Warding · physical kick'][round];
        f.shield={active:round>0,bossId:'Malande',kind};
        f.focus={}; [sc.physicalKicker,sc.magicKicker,sc.assignments.Malande].filter(Boolean).forEach(id=>f.focus[id]=true);
        if(local>=500)f.casts.push({bossId:'Malande',label:!kicker&&local>=3000?'Heal not stopped':'Circle of Healing',active:local<1500||!kicker&&local<3000,interrupted:!!kicker&&local>=1500,kickerId:kicker});
        f.call=!kicker?'Interrupt coverage missing for '+kind+'.':local<500?'Read Malande’s blessing and prepare the kick.':local<1500?'Circle of Healing: assigned interrupt now.':'Heal stopped; maintain the interrupt assignment.';
        f.instructionRows=[['Malande blessing',kind],['Physical interrupt',nameOf(sc,sc.physicalKicker)],['Magical interrupt',nameOf(sc,sc.magicKicker)],['Also cover','Divine Wrath. Reflective Shield does not itself block interrupts.']];
    }
    function hazards(fight,sc,f,t) {
        const targets=sc.raid.filter(p=>p.kind==='ranged'&&![sc.mageTank,sc.magicKicker].includes(p.id)).slice(0,2);
        if(t<1000)return;
        f.hazards.push(...targets.map((p,i)=>({kind:i?'Flamestrike':'Blizzard',at:copy(f.pos[p.id]),radiusYards:10,expiresAt:13000})));
        // Every player inside a patch moves, not just its original target.
        sc.raid.forEach(p=>{
            const home=f.pos[p.id], danger=f.hazards.some(h=>L.dist(fight,home,h.at)<h.radiusYards+2);
            if(!danger)return;
            const safe=L.safePos(fight,home,f.hazards.map(h=>({...h.at,yards:h.radiusYards+3})));
            f.pos[p.id]=mix(home,safe,(t-1000)/2500); f.focus[p.id]=true;
            if(t<3500)f.routes.push({from:copy(home),to:safe,targetId:p.id});
        });
        f.call=targets.length?'Leave the ground immediately; resume your job outside both patches.':'No eligible backline targets loaded for this example.';
    }
    function poison(sc,f,t) {
        const healer=sc.poisonHealer, tank=sc.assignments.Veras;
        f.poison={targetIds:sc.poisonTargets,active:t>=1000&&t<5000,impact:t>=5000&&t<8000};
        sc.poisonTargets.forEach(id=>{
            if(t<1000)return;
            f.hp[id]=t<5000?(healer ? .85 : .65):healer ? .55+.45*clamp((t-5000)/3500) : .35;
            f.focus[id]=true; f.roles[id]=t<5000?'Poison':t<8000?'Envenom':healer?'Recovered':'Needs healing';
        });
        if(tank){f.focus[tank]=true;f.roles[tank]=t<9000?'Pickup ready':'T2';}
        if(healer){f.focus[healer]=true;f.roles[healer]='Poison healer';}
        f.bosses.find(b=>b.id==='Veras').hidden=t<9000;
        f.call=!healer?'Poison healing coverage missing.':t<1000?'Veras vanishes. Prepare poison healing and his pickup.':t<5000?'Heal poisoned players through the coming burst.':t<8000?'Envenom lands: continue recovery.':t<9000?'Recover targets and prepare Veras’s return.':tank?'Veras returns: his tank reacquires him.':'Veras returns; tank pickup coverage is missing.';
    }
    function mage(fight,sc,f,t,kite) {
        const id=sc.mageTank;
        if(!id){f.call='Mage coverage missing for Zerevor and Spellsteal.';return;}
        f.focus[id]=true;
        if(kite){
            // A closed upper-left ramp example uses distance along the route for
            // both actors, so the boss follows behind through each turn.
            const home=sc.baseById[id];
            const path=[home,{x:.13,y:.30},{x:.13,y:.10},{x:.40,y:.10},{x:.40,y:.30},home];
            const lengths=path.slice(1).map((p,i)=>L.dist(fight,path[i],p));
            const total=lengths.reduce((a,b)=>a+b,0);
            const along=distance=>{
                let remaining=((distance%total)+total)%total;
                for(let i=0;i<lengths.length;i++){
                    if(remaining<=lengths[i])return mix(path[i],path[i+1],remaining/lengths[i]);
                    remaining-=lengths[i];
                }
                return copy(home);
            };
            const distance=total*clamp((t-2500)/22000);
            f.pos[id]=along(distance);
            f.bosses.find(b=>b.id==='Zerevor').at=along(distance-17);
            path.slice(1).forEach((p,i)=>f.routes.push({from:path[i],to:p,optional:true}));
            f.kiteSegment=true;
            f.call=t<2500?'Secure threat before starting the optional ramp kite.':t<24500?'Example ramp circuit: keep distance and stolen protection.':'Return within healing reach; renew protection when the boss reapplies it.';
        }else{
            const renewing=t>=6000&&t<7500;
            f.mageProtection=true; // Keep old protection until the immediate re-steal.
            f.casts.push({bossId:'Zerevor',label:renewing?'Dampen reapplied':t>=7500?'Fresh Dampen stolen':'Dampen stolen',active:renewing});
            f.call=renewing?'Boss reapplies Dampen: cancel old protection only immediately before the fresh steal.':t>=7500?'Fresh Dampen secured. Maintain threat, range and healing.':'Maintain stolen Dampen and more than 10 yards from Zerevor.';
        }
    }
    function simulate(fight,sc,timeMs) {
        const t=clamp(Number.isFinite(timeMs)?timeMs:0,0,sc.duration),f=baseFrame(sc,t); assignments(sc,f);
        if(sc.id==='pull')pull(sc,f,t);
        if(sc.id==='rotation')rotation(fight,sc,f,t);
        if(sc.id==='interrupts')interrupts(sc,f,t);
        if(sc.id==='hazards')hazards(fight,sc,f,t);
        if(sc.id==='poison')poison(sc,f,t);
        if(sc.id==='mage'||sc.id==='kite')mage(fight,sc,f,t,sc.id==='kite');
        if(sc.id==='cycle'){
            if(t<8000)pull(sc,f,t);
            else {
                rotation(fight,sc,f,t-8000);
                if(t>=22000&&t<30000)interrupts(sc,f,t-22000);
                if(t>=30000)poison(sc,f,t-30000);
            }
        }
        if(sc.missingRoles.length)f.instructionRows.push(...sc.missingRoles.map(note=>['Missing coverage',note]));
        return f;
    }
    function copyText(fight,sc) {
        return [fight.name+' — illustrative Council assignments',...Object.entries(sc.assignments).map(([b,id])=>b+(b==='Zerevor'?' Mage tank':' tank')+' — '+nameOf(sc,id)),
            'Physical kick — '+nameOf(sc,sc.physicalKicker),'Magical kick — '+nameOf(sc,sc.magicKicker),'Poison healer — '+nameOf(sc,sc.poisonHealer),
            ...Object.entries(sc.healerAssignments).map(([b,id])=>b+' healer — '+nameOf(sc,id)),...sc.missingRoles,
            'Positions, targets and timing are illustrative. Confirm assignments and clear ground before the pull.'].join('\n');
    }
    function resolveExplanation(explanation,sc) {
        if(!explanation)return explanation;
        const id=explanation.id, missing=(title,detail)=>({...explanation,title,detail});
        const cycle=sc.id==='cycle';
        if(sc.id==='pull'||sc.id==='positioning'||cycle&&id==='opening'){
            if(Object.values(sc.assignments).some(id=>!id))return missing('Boss tank coverage missing.','Assign Gathios, Veras and Malande tanks plus a known ranged Mage for Zerevor.');
            if((sc.id==='pull'||cycle)&&!sc.paladin)return missing('Friendly BoP pull support missing.','No known Paladin is loaded for the guild’s mage opening. Agree the pull before proceeding.');
        }
        if((sc.id==='mage'||sc.id==='kite')&&!sc.mageTank)return missing('Mage coverage missing.','Load a known ranged Mage to demonstrate Zerevor tanking and Spellsteal.');
        if(sc.id==='rotation'&&(!sc.assignments.Gathios||!sc.assignments.Veras))return missing('Moving tank coverage missing.','Assign both Gathios and Veras tanks for this route.');
        if(sc.id==='interrupts'||cycle&&id==='shield-check'){
            const magic=['protection','magic-result'].includes(id);
            if(!sc.assignments.Malande)return missing('Malande tank coverage missing.','Her tank must control her while the assigned team interrupts.');
            if(magic?!sc.magicKicker:!sc.physicalKicker)return missing('Interrupt coverage missing.',magic?'No magical interrupt is available during Protection.':'No physical interrupt is available for this example.');
        }
        if(sc.id==='poison'||cycle&&['poison-watch','repeat'].includes(id)){
            if(!sc.poisonHealer)return missing('Poison healing coverage missing.','No dedicated healer is available for poison and Envenom recovery.');
            if(id==='pickup'||id==='repeat'){if(!sc.assignments.Veras)return missing('Veras tank pickup missing.','Assign his returning pickup before damage resumes on him.');}
            if(!sc.poisonTargets.length)return missing('Poison targets unavailable.','Load raid members to demonstrate poison recovery.');
        }
        if(sc.id==='hazards'&&!sc.raid.some(p=>p.kind==='ranged'&&![sc.mageTank,sc.magicKicker].includes(p.id)))return missing('Ground-effect targets unavailable.','No eligible backline player is loaded for this example.');
        return explanation;
    }
    return {prepareScene,simulate,copyText,resolveExplanation};
}));
