(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsIllidanRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const GOLD = '#ffd27d', MINT = '#8fe4c0', VIOLET = '#d6a5ff', FIRE = '#ff9875', BLUE = '#70caff';
    function line(ctx, a, b, tone, arrow = false, width = 1.5) {
        ctx.save(); ctx.strokeStyle = tone; ctx.lineWidth = width; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        if (arrow) {
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            ctx.beginPath(); ctx.moveTo(b.x - 9 * Math.cos(angle - .45), b.y - 9 * Math.sin(angle - .45));
            ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - 9 * Math.cos(angle + .45), b.y - 9 * Math.sin(angle + .45)); ctx.stroke();
        }
        ctx.restore();
    }
    function ring(ctx, p, r, tone, fill = 'transparent') {
        ctx.save(); ctx.strokeStyle = tone; ctx.fillStyle = fill; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    function label(api, p, value, tone = GOLD, size = 15) {
        const { ctx, action, width, height } = api, bounds = action || { x: 0, y: 0, w: width, h: height };
        ctx.save(); ctx.font = '600 ' + size + 'px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        const half = ctx.measureText(value).width / 2 + 7;
        const x = Math.max(bounds.x + half, Math.min(bounds.x + bounds.w - half, p.x));
        const y = Math.max(bounds.y + 19, Math.min(bounds.y + bounds.h - 8, p.y));
        ctx.fillStyle = 'rgba(5,12,10,.94)'; ctx.fillRect(x - half, y - 16, half * 2, 23);
        ctx.fillStyle = tone; ctx.fillText(value, x, y); ctx.restore();
    }
    function cone(api, from, to, yards, tone = FIRE) {
        const { ctx, px, yd } = api, a = px(from), b = px(to), angle = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save(); ctx.fillStyle = tone + '25'; ctx.strokeStyle = tone + '88';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, yd(yards), angle - .5, angle + .5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    function trail(api, from, to, radius, tone) {
        const { ctx, px, yd } = api, a = px(from), b = px(to);
        ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = yd(radius) * 2; ctx.strokeStyle = tone + '55';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = tone; ctx.stroke(); ctx.restore();
    }
    function npc(api, at, glyph, tone, dead = false) {
        const { ctx, px } = api, p = px(at);
        ring(ctx, p, 12, dead ? MINT : tone, '#111915');
        ctx.save(); ctx.font = '700 15px "Barlow Condensed", sans-serif'; ctx.fillStyle = dead ? MINT : tone; ctx.textAlign = 'center';
        ctx.fillText(dead ? '✓' : glyph, p.x, p.y + 5); ctx.restore();
    }
    function draw(layer, api, scene, f) {
        const { ctx, px, yd, action } = api;
        if (layer === 'floor') {
            f.hazards.forEach(h => {
                if (h.from && h.to) trail(api, h.from, h.to, h.radiusYards, BLUE);
                else ring(ctx, px(h.at), yd(h.radiusYards), FIRE, '#ff95642c');
            });
            f.routes.forEach(r => line(ctx, px(r.from), px(r.to), '#dbefe4', true));
            if (f.frontal) cone(api, f.frontal.from, f.frontal.to, f.frontal.yards);
            (f.flames || []).filter(flame => !flame.dead).forEach(flame => {
                const glaive = f.glaives.find(g => g.id === flame.glaiveId);
                line(ctx, px(flame.at), px(glaive.at), GOLD + 'aa');
                if (flame.tankId) cone(api, flame.at, f.pos[flame.tankId], 15);
            });
            if (f.eyeBeam) {
                line(ctx, px(f.eyeBeam.from), px(f.eyeBeam.to), BLUE, false, 2);
                if (f.eyeBeam.active && f.eyeBeam.progress < 1) {
                    const a = f.eyeBeam.from, b = f.eyeBeam.to, k = f.eyeBeam.progress;
                    ring(ctx, px({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }), yd(2.5), '#e4f9ff', '#8fe9ff88');
                }
            }
            (f.groups || []).forEach((g, i) => ring(ctx, px(g.at), yd(3.5), [GOLD, BLUE, MINT][i] + '88'));
            if (f.fireball?.active) ring(ctx, px(f.fireball.at), yd(f.fireball.radiusYards), GOLD, '#ffbf4933');
            if (f.barrage?.active) ring(ctx, px(f.pos[f.barrage.targetId]), yd(3), VIOLET, '#aa55dd33');
            if (f.separation) {
                ring(ctx, px(f.boss), yd(f.separation.bossYards), VIOLET, '#8d44a520');
                if (scene.shadowTank) ring(ctx, px(f.pos[scene.shadowTank]), yd(f.separation.shadowYards), '#e4a0ff', '#a058c818');
            }
            (f.demons || []).filter(d => !d.dead).forEach(d => line(ctx, px(d.at), px(f.pos[d.targetId]), VIOLET, true));
            if (f.trap) ring(ctx, px(f.trap.at), yd(4), f.trap.caged ? MINT : GOLD, '#ffd27d22');
            return;
        }
        const top = { x: action.x + action.w - 112, y: action.y + 25 };
        const phase = ['','Ground','Flames of Azzinoth','Landing / ground','Demon Form','Maiev & Enrage'][f.phase];
        label(api, top, 'P' + f.phase + ' · ' + phase, GOLD, 17);
        if (f.damageHeld) label(api, { x: top.x, y: top.y + 29 }, f.prison ? 'RP stun · prepare pickup' : 'HOLD DAMAGE · tank first', FIRE);
        else if (f.lust) label(api, { x: top.x, y: top.y + 29 }, 'LUST · push toward 30%', MINT);
        else if (f.enrage) label(api, { x: top.x, y: top.y + 29 }, 'ENRAGE · tank cooldowns', FIRE);
        if (['overview', 'positioning'].includes(scene.id)) label(api, { x: action.x + 140, y: action.y + action.h - 20 }, 'Ground · keep the front clear', MINT);
        (f.glaives || []).forEach(g => {
            const p = px(g.at); npc(api, g.at, '†', GOLD);
            label(api, { x: p.x, y: p.y + yd(15) + 20 }, g.id === 'left' ? 'Left glaive' : 'Right glaive', GOLD, 14);
        });
        (f.flames || []).forEach((flame, i) => {
            npc(api, flame.at, 'F', FIRE, flame.dead);
            const p = px(flame.at);
            label(api, { x: p.x + (i ? 55 : -55), y: p.y - 40 }, (i ? 'Right' : 'Left') + (flame.dead ? ' down' : ' Flame'), flame.dead ? MINT : FIRE);
        });
        (f.groups || []).forEach((g, i) => {
            const p = px(g.at); label(api, { x: p.x, y: p.y + yd(6.5) + 10 }, g.label, [GOLD, BLUE, MINT][i]);
        });
        (f.adds || []).forEach((a, i) => { npc(api, a.at, 'P', VIOLET, a.dead); if (!i) label(api, { x: px(a.at).x, y: px(a.at).y + 37 }, a.dead ? 'Both parasites cleared' : 'Two parasites · kill', a.dead ? MINT : VIOLET); });
        (f.demons || []).forEach((d, i) => {
            npc(api, d.at, 'D', VIOLET, d.dead);
            if (!i) label(api, { x: px(f.boss).x, y: px(f.boss).y + yd(18) }, d.dead ? 'Rescued · remain spread' : 'Paralyzed targets need allies', d.dead ? MINT : VIOLET);
        });
        if (f.separation && !f.demons) label(api, { x: px(f.boss).x, y: px(f.boss).y + yd(18) }, '15 yd aura · 20 yd tank splash', VIOLET);
        if (f.trap) {
            const p = px(f.trap.at);
            label(api, { x: p.x + 65, y: p.y + 28 }, f.trap.caged ? 'CAGED · increased damage' : f.trap.armed ? 'ARMED TRAP' : f.trap.activatorId ? 'CLICK TO ARM' : 'NO ACTIVATOR · cooldowns', f.trap.caged ? MINT : GOLD);
        }
        if (f.eyeBeam) label(api, { x: px(f.eyeBeam.from).x, y: px(f.eyeBeam.from).y - 20 }, 'Example beam · path varies', BLUE);
    }
    return { draw };
}));
