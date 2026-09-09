(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsCouncilRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const tones = { Gathios: '#e6bd75', Veras: '#90dc86', Malande: '#d6a5ff', Zerevor: '#80caff' };
    function label(api, at, value, tone, size = 15) {
        const { ctx, action } = api;
        ctx.save(); ctx.font = '600 ' + size + 'px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        const half = ctx.measureText(value).width / 2 + 7;
        const bounds = action || { x: 0, y: 0, w: api.width, h: api.height };
        const x = Math.max(bounds.x + half, Math.min(bounds.x + bounds.w - half, at.x));
        const y = Math.max(bounds.y + 20, Math.min(bounds.y + bounds.h - 8, at.y));
        ctx.fillStyle = 'rgba(5,12,10,.94)'; ctx.fillRect(x-half,y-16,half*2,23);
        ctx.fillStyle=tone; ctx.fillText(value,x,y); ctx.restore();
    }
    function line(ctx,a,b,tone,arrow=false) {
        ctx.save(); ctx.strokeStyle=tone; ctx.lineWidth=1.5; ctx.setLineDash([5,5]);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();ctx.setLineDash([]);
        if(arrow){const angle=Math.atan2(b.y-a.y,b.x-a.x);ctx.beginPath();ctx.moveTo(b.x-8*Math.cos(angle-.5),b.y-8*Math.sin(angle-.5));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-8*Math.cos(angle+.5),b.y-8*Math.sin(angle+.5));ctx.stroke();}
        ctx.restore();
    }
    function ring(ctx,p,r,stroke,fill='transparent') {
        ctx.save();ctx.strokeStyle=stroke;ctx.fillStyle=fill;ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }
    function draw(layer,api,scene,frame) {
        const {ctx,px,yd,action}=api;
        if(layer==='floor'){
            (frame.hazards||[]).forEach(h=>{
                const tone=h.kind==='Blizzard'?'#8ecbff':h.kind==='Flamestrike'?'#ff9564':'#efc16d';
                ring(ctx,px(h.at),yd(h.radiusYards),tone,tone+'30');
            });
            (frame.routes||[]).forEach(r=>line(ctx,px(r.from),px(r.to),r.optional?'#7cbaff':'#d8eee2',true));
            frame.bosses.filter(b=>!b.hidden&&b.targetId).forEach(b=>line(ctx,px(b.at),px(frame.pos[b.targetId]),tones[b.id]+'99'));
            if(['positioning','mage','kite'].includes(scene.id))ring(ctx,px(frame.bosses.find(b=>b.id==='Zerevor').at),yd(10),'#80caff77');
            if(frame.pullProtection)ring(ctx,px(frame.pos[frame.pullProtection]),yd(3.5),'#ffd889','#ffd88922');
            if(frame.poison?.active||frame.poison?.impact)frame.poison.targetIds.forEach(id=>ring(ctx,px(frame.pos[id]),yd(3.2),'#cba1ff','#cba1ff22'));
            return;
        }
        if(frame.rotationPoints)frame.rotationPoints.forEach((at,i)=>{
            const p=px(at);label(api,{x:p.x,y:p.y+yd(10)},String(i+1),'#ffd9a0',19);
        });
        frame.bosses.filter(b=>!b.hidden).forEach(b=>{
            const p=px(b.at),r=12;
            ring(ctx,p,r,tones[b.id],'#101816');
            ctx.save();ctx.font='700 15px "Barlow Condensed", sans-serif';ctx.textAlign='center';ctx.fillStyle=tones[b.id];ctx.fillText(b.id[0],p.x,p.y+5);ctx.restore();
            const at=b.id==='Gathios'?{x:p.x+55,y:p.y-16}:b.id==='Veras'?{x:p.x-54,y:p.y-13}:b.id==='Malande'?{x:p.x-60,y:p.y-26}:{x:p.x,y:p.y-23};
            line(ctx,p,at,tones[b.id]+'88');label(api,at,b.id,tones[b.id]);
        });
        if(frame.shield?.active)ring(ctx,px(frame.bosses.find(b=>b.id==='Malande').at),19,frame.shield.kind.startsWith('Protection')?'#ffd889':'#b9a3ff');
        const corner={x:action.x+action.w-140,y:action.y+27};
        if(frame.casts.some(c=>c.bossId==='Malande')||scene.id==='interrupts'){
            label(api,corner,frame.shield.active?frame.shield.kind:'No immunity · physical kick','#e8d3ff',17);
            const cast=frame.casts.find(c=>c.bossId==='Malande');
            label(api,{x:corner.x,y:corner.y+29},cast?.interrupted?'Circle of Healing stopped':cast?.label||'Watch Malande’s next cast',cast?.interrupted?'#91e2bf':'#ffd17c');
        }
        if(['mage','pull','kite'].includes(scene.id)){
            const cast=frame.casts.find(c=>c.bossId==='Zerevor');
            label(api,corner,cast?.label||(!scene.mageTank?'Mage assignment missing':frame.mageProtection?'Stolen Dampen active':'Prepare mage Spellsteal'),'#9bd5ff');
            if(scene.id==='kite')label(api,{x:corner.x,y:corner.y+29},'Ramp example · see guild route','#bfd7ec');
        }
        if(frame.hazards?.length){
            const names=[...new Set(frame.hazards.map(h=>h.kind))].join(' + ');
            label(api,{x:action.x+125,y:action.y+27},names+' · keep clear','#f6d79d');
        }
    }
    return {draw};
}));
