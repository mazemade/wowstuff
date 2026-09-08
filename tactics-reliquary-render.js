(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsReliquaryRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
    const ink = '#edf1e9', gold = '#ffcf87', mint = '#9ef1cd', purple = '#d4b2ff';
    function font(ctx, size) { ctx.font = '600 ' + size + 'px "Barlow Condensed", sans-serif'; ctx.textBaseline = 'top'; }
    function text(ctx, value, x, y, size = 16, colour = ink) { font(ctx, size); ctx.textAlign = 'left'; ctx.fillStyle = colour; ctx.fillText(value, x, y); }
    function lines(ctx, value, width, size) {
        font(ctx, size); const result = []; let row = '';
        for (const word of String(value || '').split(/\s+/)) { const next = row ? row + ' ' + word : word; if (row && ctx.measureText(next).width > width) { result.push(row); row = word; } else row = next; }
        if (row) result.push(row); return result;
    }
    function paragraph(ctx, value, x, y, width, size = 16, colour = ink) { const rows = lines(ctx, value, width, size); rows.forEach((row, i) => text(ctx, row, x, y + i * (size + 3), size, colour)); return rows.length * (size + 3); }
    function panel(ctx, x, y, w, h, colour = '#5a7065') { ctx.fillStyle = 'rgba(7,14,13,.95)'; ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke(); }
    function ring(ctx, p, r, colour, fill = 'rgba(12,22,20,.3)') { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke(); }
    function path(ctx, a, b, colour, dashed = false) { ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.setLineDash(dashed ? [6, 5] : []); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); const angle = Math.atan2(b.y-a.y,b.x-a.x); ctx.beginPath(); ctx.moveTo(b.x-9*Math.cos(angle-.45),b.y-9*Math.sin(angle-.45)); ctx.lineTo(b.x,b.y); ctx.lineTo(b.x-9*Math.cos(angle+.45),b.y-9*Math.sin(angle+.45)); ctx.stroke(); }
    function point(frame, id) { return id === 'essence' ? frame.boss : id === 'raid' ? {x:.5,y:.52} : frame.pos[id] || (frame.souls || []).find(s=>s.id===id)?.at; }
    function playerName(scene, id) { if (id === 'essence') return 'Essence'; if (id === 'raid') return 'Raid'; const p = (scene.raid || []).find(p=>p.id===id); if (!p) return /^soul/.test(id || '') ? 'Soul' : ''; if (p.name) return p.name; if (p.kind === 'tank') return 'Tank ' + ((scene.tanks || []).indexOf(id)+1); const group = scene.raid.filter(q=>q.class===p.class); const c = p.class ? p.class[0]+p.class.slice(1).toLowerCase() : p.kind; return c+' '+(group.indexOf(p)+1); }
    function colour(kind) { return /heal|recover|dispel|steal|purge/.test(kind) ? mint : /tongues|spite|shield/.test(kind) ? purple : gold; }
    function bar(ctx, x, y, w, value, tone) { ctx.fillStyle='#142621'; ctx.fillRect(x,y,w,8); ctx.fillStyle=tone; ctx.fillRect(x,y,w*clamp(value),8); }
    function layout(api) { return { w:api.width, h:api.height || api.width*.5625, compact:api.width<520 }; }
    function teachingLayout(api, scene, frame) {
        const {ctx}=api, {w,h,compact}=layout(api), size=compact?19:24, body=compact?15:18;
        const primary=(frame.actions||[]).at(-1);
        const lesson=frame.teaching?.title ? frame.teaching : {title:primary?.label || frame.call || scene.title, detail:primary?.result || scene.caption};
        const th=43+lines(ctx,lesson.title,w-44,size).length*(size+3)+lines(ctx,lesson.detail,w-44,body).length*(body+3)+12;
        const current=(frame.instructionRows||[]).find(row=>/Next kick|Next tank/.test(row[0]));
        const tipResults={evasion:'Optional avoidance turn: dodge incoming hits during Enrage.',deterrence:'Optional avoidance turn: parry incoming hits during Enrage.','spell-reflection':'If coordinated: return Deaden so the boss takes double damage.','glove-backup':'With PvP gloves equipped: Deadly Throw interrupts the cast.','shadow-protection':'Prepare before Anger; Shadow damage grows during the burn.',healthstone:'Use after the Nature hit, then heal back up.'};
        const footer=tipResults[frame.tipVisual?.kind] || lesson.tip || [current ? current[0]+': '+current[1] : '',lesson.missedConsequence || ''].filter(Boolean).join(' ') || 'Suffering → Souls → Desire → Souls → Anger';
        const rows=lines(ctx,footer,w-48,body), fh=Math.max(52,rows.length*(body+3)+24), header={x:10,y:10,w:w-20,h:Math.max(90,th)}, footerBox={x:10,y:h-fh-12,w:w-20,h:fh}, horizontalInset=18, verticalInset=38, clip={x:0,y:header.y+header.h+8,w,h:Math.max(0,footerBox.y-(header.y+header.h+8)-8)};
        return {header,footer:footerBox,clip,action:{x:horizontalInset,y:clip.y+verticalInset,w:Math.max(0,w-horizontalInset*2),h:Math.max(0,clip.h-verticalInset*2)}};
    }
    // Reliquary's custom panels share the lesson renderer's fixed geometry contract.
    function reserve(layouts, width, height) {
        const first=layouts[0]; if(!first)return null;
        const header={...first.header,h:Math.max(...layouts.map(item=>item.header.h))};
        const footerHeight=Math.max(...layouts.map(item=>item.footer.h)), footer={...first.footer,y:height-footerHeight-12,h:footerHeight};
        const horizontalInset=18, verticalInset=38, clip={x:0,y:header.y+header.h+8,w:width,h:Math.max(0,footer.y-(header.y+header.h+8)-8)};
        return {header,footer,clip,action:{x:horizontalInset,y:clip.y+verticalInset,w:Math.max(0,width-horizontalInset*2),h:Math.max(0,clip.h-verticalInset*2)}};
    }
    function teaching(api, scene, frame, box) {
        const {ctx}=api, {w,compact}=layout(api), size=compact?19:24, body=compact?15:18;
        const primary=(frame.actions||[]).at(-1), lesson=frame.teaching?.title ? frame.teaching : {title:primary?.label || frame.call || scene.title, detail:primary?.result || scene.caption};
        const phase=frame.stage==='complete' ? 'Encounter complete' : frame.essence==='Souls' ? 'Soul intermission · recover together' : frame.essence==='Suffering' ? '1 · Suffering — no healing' : frame.essence==='Desire' ? '2 · Desire — interrupts first' : '3 · Anger — threat, then burn';
        panel(ctx,box.header.x,box.header.y,box.header.w,box.header.h); text(ctx,phase,22,19,compact?15:17,gold);
        let y=43; y+=paragraph(ctx,lesson.title,22,y,w-44,size); if(lesson.detail) paragraph(ctx,lesson.detail,22,y+3,w-44,body);
        const current=(frame.instructionRows||[]).find(row=>/Next kick|Next tank/.test(row[0]));
        const tipResults={evasion:'Optional avoidance turn: dodge incoming hits during Enrage.',deterrence:'Optional avoidance turn: parry incoming hits during Enrage.','spell-reflection':'If coordinated: return Deaden so the boss takes double damage.','glove-backup':'With PvP gloves equipped: Deadly Throw interrupts the cast.','shadow-protection':'Prepare before Anger; Shadow damage grows during the burn.',healthstone:'Use after the Nature hit, then heal back up.'};
        const footer=tipResults[frame.tipVisual?.kind] || lesson.tip || [current ? current[0]+': '+current[1] : '',lesson.missedConsequence || ''].filter(Boolean).join(' ') || 'Suffering → Souls → Desire → Souls → Anger';
        panel(ctx,box.footer.x,box.footer.y,box.footer.w,box.footer.h); paragraph(ctx,footer,22,box.footer.y+12,w-44,body,'#ceddd3');
    }
    function actorLabels(api, scene, frame, area) {
        const {ctx}=api,{w,compact}=layout(api), entries=[], occupied=[], reserved=[];
        const reserve = (p, radius) => reserved.push({ x:p.x-radius, y:p.y-radius, w:radius*2, h:radius*2 });
        const tokenRadius = Math.max(18, api.yd(3.2)) + 7;
        if(frame.tankLanes) Object.keys(frame.tankLanes).forEach(id=>{ if(point(frame,id)) reserve(api.px(point(frame,id)), tokenRadius); });
        if(frame.boss) reserve(api.px(frame.boss), Math.max(31, api.yd(4.2)) + 8);
        for(const a of frame.actions||[]) for(const id of [a.visualFromId || a.sourceId,...(a.targetIds || [a.visualToId || a.targetId])]) { if(id && id!=='essence' && point(frame,id) && !entries.includes(id)) entries.push(id); }
        for(const mark of frame.spite || []) if(!entries.includes(mark.targetId)) entries.push(mark.targetId);
        if(frame.bossTarget && ['fixate','suffering','anger'].includes(frame.stage) && !entries.includes(frame.bossTarget)) entries.unshift(frame.bossTarget);
        if(frame.nextTank && frame.essence==='Suffering' && !entries.includes(frame.nextTank)) entries.push(frame.nextTank);
        if(frame.tankLanes && frame.essence==='Suffering') Object.keys(frame.tankLanes).forEach(id=>{ if(!entries.includes(id)) entries.push(id); });
        if(frame.teaching?.nextKickerId && !entries.includes(frame.teaching.nextKickerId)) entries.push(frame.teaching.nextKickerId);
        for(const id of [frame.teaching?.removerId,frame.teaching?.tonguesId,frame.teaching?.currentKickerId,frame.tipVisual?.sourceId]) if(id && point(frame,id) && !entries.includes(id)) entries.push(id);
        const tankIds=frame.tankLanes ? Object.keys(frame.tankLanes) : scene.tanks || [];
        entries.slice(0,5).forEach(id=>{
            const p=api.px(point(frame,id)), prefix=frame.essence==='Suffering' && tankIds.includes(id) ? id===frame.bossTarget?'Current: ':id===frame.nextTank?'Next: ':'Waiting: ' : '', label=prefix+playerName(scene,id), status=frame.lowHealth && id===frame.bossTarget?'LOW HEALTH':frame.tankDefense?.targetId===id?(frame.tankDefense.active?'COOLDOWNS ACTIVE':'COOLDOWNS READY'):'', size=compact?13:16;
            font(ctx,size); const labelWidth=ctx.measureText(label).width;
            font(ctx,Math.max(11,size-2));
            const bw=Math.min(w-30,Math.max(labelWidth,status?ctx.measureText(status).width:0)+18), bh=status?42:25;
            const candidates=[{x:p.x-bw/2,y:p.y+tokenRadius+9},{x:p.x-bw-tokenRadius-9,y:p.y+12},{x:p.x+tokenRadius+9,y:p.y+12},{x:p.x-bw/2,y:p.y-tokenRadius-bh-9}];
            const blocked=[...occupied,...reserved];
            const fits=b=>!blocked.some(o=>b.x<o.x+o.w+4 && b.x+b.w+4>o.x && b.y<o.y+o.h+4 && b.y+b.h+4>o.y);
            let box;
            const minX=area.left+5, maxX=Math.max(minX,area.right-bw-5);
            for(let tries=0;tries<16;tries++) { const c=candidates[tries%4]; const b={x:clamp(c.x,minX,maxX),y:clamp(c.y+Math.floor(tries/4)*29,area.top,area.bottom-bh),w:bw,h:bh}; if(fits(b)){box=b;break;} }
            // When nearby slots are occupied, keep the name visible in the nearest clear slot.
            if(!box) {
                let distance=Infinity;
                for(let y=area.top;y<=area.bottom-bh;y+=16) for(let x=minX;x<=maxX;x+=24) {
                    const candidate={x,y,w:bw,h:bh}; if(!fits(candidate))continue;
                    const d=(p.x-clamp(p.x,x,x+bw))**2+(p.y-clamp(p.y,y,y+bh))**2;
                    if(d<distance){distance=d;box=candidate;}
                }
            }
            if(!box) return; occupied.push(box);
            ring(ctx,p,Math.max(12,api.yd(2.3)),id===frame.bossTarget?gold:mint);
            ctx.strokeStyle='#b4cabe';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(clamp(p.x,box.x,box.x+box.w),box.y+box.h/2);ctx.stroke();
            panel(ctx,box.x,box.y,box.w,box.h);text(ctx,label,box.x+9,box.y+4,size);
            if(status) text(ctx,status,box.x+9,box.y+20,Math.max(11,size-2),frame.lowHealth&&id===frame.bossTarget?'#ff95bc':frame.tankDefense?.active?gold:mint);
            if(frame.hp?.[id]!=null) bar(ctx,box.x+3,box.y+box.h-2,box.w-6,frame.hp[id],frame.lowHealth && id===frame.bossTarget?'#ff95bc':mint);
        });
    }
    function actions(api,frame) {
        const {ctx}=api;
        (frame.actions||[]).flatMap(a => a.targetIds?.length ? a.targetIds.map(id => ({...a,targetId:id,visualToId:id})) : [a]).forEach(a=>{
            if(a.optional || /^optional/.test(a.kind)) return;
            const from=point(frame,a.visualFromId || a.sourceId),to=point(frame,a.visualToId || a.targetId);if(!from||!to)return;
            const p=api.px(from),q=api.px(to),tone=colour(a.kind);
            path(ctx,p,q,tone,/gather|move|rotation/.test(a.kind));
            const progress=Number.isFinite(a.progress)?clamp(a.progress):((frame.phaseTimeMs??frame.timeMs)%1400)/1400;
            const moving={x:p.x+(q.x-p.x)*progress,y:p.y+(q.y-p.y)*progress};
            ring(ctx,moving,/steal/.test(a.kind)?9:5,tone,tone);
            if(/steal/.test(a.kind)) ring(ctx,q,Math.max(18,api.yd(3.2)),purple);
        });
    }
    function mechanics(api,scene,frame,area) {
        const {ctx}=api,{w,compact}=layout(api),boss=api.px(frame.boss);
        if(frame.bossTarget && frame.pos[frame.bossTarget] && frame.essence!=='Souls') path(ctx,boss,api.px(frame.pos[frame.bossTarget]),'rgba(255,207,135,.65)',true);
        if(frame.lowHealth && frame.bossTarget && frame.pos[frame.bossTarget]) {
            const p=api.px(frame.pos[frame.bossTarget]);
            ring(ctx,p,Math.max(23,api.yd(3.8)),'#ff95bc','rgba(255,80,120,.16)');
        }
        if(frame.nextTank && frame.nextTankAt && frame.pos[frame.nextTank] && frame.nextTank!==frame.bossTarget) path(ctx,api.px(frame.pos[frame.nextTank]),api.px(frame.nextTankAt),mint,true);
        (frame.absorbs||[]).forEach(a=>{if(frame.pos[a.targetId])ring(ctx,api.px(frame.pos[a.targetId]),Math.max(19,api.yd(3)),mint);});
        (frame.drains||[]).filter(d=>!d.dispelled).forEach(d=>{if(frame.pos[d.targetId])ring(ctx,api.px(frame.pos[d.targetId]),Math.max(17,api.yd(2.8)),'#ff9db4');});
        (frame.souls||[]).forEach((s,i)=>{const p=api.px(s.at);ring(ctx,p,s.dead?7:11,s.dead?mint:purple);if(!s.dead)text(ctx,String(i+1),p.x-3,p.y-7,13);});
        if(frame.tankDefense?.prepared && frame.pos[frame.tankDefense.targetId]) {
            const p=api.px(frame.pos[frame.tankDefense.targetId]), tone=frame.tankDefense.active?gold:mint;
            ring(ctx,p,Math.max(24,api.yd(4)),tone,'rgba(158,241,205,.12)');
        }
        if(frame.shield?.active) ring(ctx,boss,Math.max(27,api.yd(5)),purple,'rgba(160,120,250,.2)');
        if(frame.shield?.stolenBy && frame.pos[frame.shield.stolenBy]) ring(ctx,api.px(frame.pos[frame.shield.stolenBy]),Math.max(19,api.yd(3.2)),purple);
        if(frame.cast?.active || frame.cast?.interrupted && !frame.shield?.active && (frame.actions||[]).some(a=>a.kind==='kick')) {
            const bw=compact?162:220,x=clamp(boss.x-bw/2,15,w-bw-15),y=clamp(boss.y-62,area.top,area.bottom-45);
            panel(ctx,x,y,bw,44,frame.cast.interrupted?mint:gold);
            text(ctx,frame.cast.kind+(frame.cast.interrupted?' · STOPPED':''),x+9,y+6,compact?15:17,frame.cast.interrupted?mint:gold);
            bar(ctx,x+9,y+30,bw-18,frame.cast.interrupted?0:frame.cast.progress,gold);
        }
        if(frame.debuffs?.tongues?.active || (frame.actions||[]).some(a=>a.kind==='tongues')) {
            const tw=compact?125:153,tx=clamp(boss.x+32,12,w-tw-12),ty=clamp(boss.y-21,area.top,area.bottom-28);
            panel(ctx,tx,ty,tw,25,'#8d74aa');text(ctx,'Tongues · slower cast',tx+7,ty+5,compact?13:15,purple);
            if(frame.effectLoopProgress != null) ring(ctx,boss,Math.max(24,api.yd(4))+frame.effectLoopProgress*12,purple,'rgba(180,130,255,'+(.18*(1-frame.effectLoopProgress))+')');
        }
        (frame.spite||[]).forEach((m,i)=>{const p=api.px(frame.pos[m.targetId]);ring(ctx,p,Math.max(17,api.yd(3)),m.impacted?'#ff95bc':purple);text(ctx,String(i+1),p.x-4,p.y-7,15);});
        if(frame.scream?.active){ctx.fillStyle='rgba(255,111,88,.2)';ctx.beginPath();ctx.moveTo(boss.x,boss.y);ctx.arc(boss.x,boss.y,api.yd(19),-2.55,-.6);ctx.closePath();ctx.fill();}
        const pulse=(frame.shadowPulses||[]).at(-1);if(pulse && pulse.progress<1)(pulse.targetIds||[]).forEach(id=>{if(frame.pos[id])ring(ctx,api.px(frame.pos[id]),11+pulse.progress*18,'rgba(211,167,255,'+(1-pulse.progress)+')');});
        if(frame.stage==='desire') {
            const caster=(scene.raid||[]).find(p=>p.kind==='healer') || (scene.raid||[]).find(p=>p.kind==='ranged');
            const bw=compact?196:250,x=(w-bw)/2,y=area.bottom-46;
            const elapsed=frame.manaState?.elapsedMs,clock=Number.isFinite(elapsed)?' · '+Math.floor(elapsed/60000)+':'+String(Math.floor(elapsed/1000)%60).padStart(2,'0'):'';
            panel(ctx,x,y,bw,44,'#9180b8');text(ctx,'Max mana '+Math.round(frame.maxMana)+'%'+clock,x+10,y+6,compact?15:17,purple);bar(ctx,x+10,y+30,bw-20,frame.maxMana/100,purple);
            if(caster && frame.pos[caster.id]) { const p=api.px(frame.pos[caster.id]);ctx.strokeStyle='#a995d3';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x+bw/2,y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]); }
        }
        if(frame.essence==='Anger' && frame.stage!=='complete' && frame.tankResource) {
            const resource=frame.tankResource,bw=compact?230:280,x=(w-bw)/2,y=area.bottom-46;
            panel(ctx,x,y,bw,44);text(ctx,resource.kind+' '+Math.round(resource.value)+(frame.scream?.active?' · Soul Scream':' · spend before Scream'),x+10,y+6,compact?15:17,gold);bar(ctx,x+10,y+30,bw-20,resource.value/100,gold);
        }
        if(frame.essence==='Anger' && frame.stage!=='complete') {
            bar(ctx,boss.x-30,boss.y+32,60,frame.bossHp,gold);
            if(frame.phaseTimeMs>=8200) (scene.raid||[]).filter(p=>p.kind==='melee'||p.kind==='ranged').slice(0,3).forEach((p,i)=>{
                const from=api.px(frame.pos[p.id]),k=((frame.phaseTimeMs+i*400)%1200)/1200;
                ring(ctx,{x:from.x+(boss.x-from.x)*k,y:from.y+(boss.y-from.y)*k},3+frame.pressure*3,gold,gold);
            });
        }
        if(Number.isInteger(frame.explanationCountdown)) {
            const label=frame.explanationCountdown ? 'Spite impact in '+frame.explanationCountdown+'s' : 'Spite impact now';
            const bw=compact?156:196,x=(w-bw)/2,y=area.bottom-96;
            panel(ctx,x,y,bw,31,frame.explanationCountdown ? purple : '#ff95bc');
            text(ctx,label,x+10,y+7,compact?15:17,frame.explanationCountdown ? purple : '#ff95bc');
        }
    }
    function overview(api) {
        const {ctx}=api,{w,h,compact}=layout(api), rows=[['1 · Suffering','Fixate checks closest every 5s.','Hold while safe; hand off by health, shields and cooldowns.'],['Souls · recover','Gather and kill beside the raid.','Soul deaths restore health and mana.'],['2 · Desire','Tongues → remove shield → ordered kicks.','50% recoil; doubled healing; mana shrinks.'],['Souls · recover again','Regroup and refill for the final phase.','Prepare Shadow Protection.'],['3 · Anger','OT → MT taunt → wait 3–5s → burn + Lust.','Top Spite targets before and after the hit.']];
        const step=Math.min(compact?101:110,(h-36)/5),x=compact?14:Math.max(24,(w-650)/2),pw=compact?w-28:Math.min(650,w-48);
        rows.forEach((r,i)=>{const y=16+i*step;panel(ctx,x,y,pw,step-8);text(ctx,r[0],x+14,y+9,compact?19:23,gold);let end=y+34;end+=paragraph(ctx,r[1],x+14,end,pw-28,compact?15:18);paragraph(ctx,r[2],x+14,end+3,pw-28,compact?14:16,'#bacec0');});
    }
    function tipVisual(api,scene,frame) {
        const tip=frame.tipVisual;if(!tip)return;
        const from=point(frame,tip.sourceId),to=point(frame,tip.targetId);if(!from || !to)return;
        const {ctx}=api,{w,h,compact}=layout(api),p=api.px(from),q=api.px(to),progress=clamp(frame.effectLoopProgress ?? tip.progress ?? 0),tone=tip.optional?purple:mint;
        if(/evasion|deterrence|avoidance/i.test(tip.kind)) {
            ring(ctx,p,21+Math.sin(progress*Math.PI)*6,tone);
            const boss=api.px(frame.boss),miss={x:p.x+25,y:p.y-12};path(ctx,boss,miss,'#ffb589',true);text(ctx,'DODGE',miss.x-18,miss.y-23,13,tone);
        } else if(/reflect/i.test(tip.kind)) {
            path(ctx,q,p,tone,true);path(ctx,{x:p.x+8,y:p.y}, {x:q.x+8,y:q.y},tone);
            const k=progress<.5?progress*2:(1-progress)*2;ring(ctx,{x:q.x+(p.x-q.x)*k,y:q.y+(p.y-q.y)*k},6,tone,tone);
            if(progress>.5){ring(ctx,q,28,tone);text(ctx,'2× damage taken',q.x+30,q.y+17,compact?13:16,tone);}
        } else if(/healthstone/i.test(tip.kind)) {
            ring(ctx,p,17+progress*13,mint);text(ctx,'+',p.x-6,p.y-10-progress*20,24,mint);
        } else {
            const destinations=/protection/i.test(tip.kind)?(scene.raid||[]).map(player=>frame.pos[player.id]).filter(Boolean):[to];
            destinations.forEach(dest=>{const end=api.px(dest);path(ctx,p,end,tone,true);ring(ctx,{x:p.x+(end.x-p.x)*progress,y:p.y+(end.y-p.y)*progress},4,tone,tone);if(progress>.7)ring(ctx,end,15,tone);});
            if(tip.kind==='glove-backup' && progress>.6) text(ctx,'Backup interrupt',clamp(q.x-45,12,w-112),q.y+35,compact?14:17,tone);
        }
        const title=(tip.optional?'Optional · ':'')+(tip.label || tip.kind).replace(/^Optional\s*·\s*/i,''),size=compact?15:18,bw=Math.min(w-28,compact?330:510),rows=lines(ctx,title,bw-20,size),ph=rows.length*(size+3)+18,py=h-124-ph;
        panel(ctx,(w-bw)/2,py,bw,ph,tone);paragraph(ctx,title,(w-bw)/2+10,py+9,bw-20,size,tone);
    }
    function positioning(api,scene,frame) {
        const {ctx}=api,{w,h,compact}=layout(api);
        panel(ctx,12,12,w-24,compact?82:72);text(ctx,'Face the boss away from the raid',24,24,compact?20:25,gold);paragraph(ctx,'Tanks in front. Melee behind; ranged and healers farther back.',24,compact?50:53,w-48,compact?15:17);
        const groups=[['tank','Tanks · front'],['melee','Melee · behind'],['healer','Healers'],['ranged','Ranged']];
        groups.forEach(([kind,label],i)=>{const members=(scene.raid||[]).filter(p=>p.kind===kind);if(!members.length)return;const points=members.map(p=>api.px(frame.pos[p.id])),p={x:points.reduce((v,p)=>v+p.x,0)/points.length,y:points.reduce((v,p)=>v+p.y,0)/points.length};font(ctx,compact?14:18);const bw=ctx.measureText(label).width+20,x=i%2? w-bw-20:20,y=clamp(p.y+(i>1?45:-35),105,h-65);path(ctx,{x:x+bw/2,y:y+14},p,'#aec7b9',true);panel(ctx,x,y,bw,30);text(ctx,label,x+10,y+6,compact?14:18);});
    }
    function draw(layer,api,scene,frame) {
        const {ctx}=api;ctx.save();
        if(layer==='floor') { ctx.fillStyle='rgba(3,10,10,.25)';ctx.fillRect(0,0,api.width,api.height||api.width*.5625);ctx.restore();return; }
        if(frame.stage==='overview'){overview(api);ctx.restore();return;}
        if(frame.stage==='positioning'){positioning(api,scene,frame);ctx.restore();return;}
        const box=api.lessonLayout || teachingLayout(api,scene,frame), area={left:box.action.x,right:box.action.x+box.action.w,top:box.action.y,bottom:box.action.y+box.action.h};
        mechanics(api,scene,frame,area);actions(api,frame);tipVisual(api,scene,frame);actorLabels(api,scene,frame,area);teaching(api,scene,frame,box);
        ctx.restore();
    }
    return {draw, layout:teachingLayout, reserve};
}));
