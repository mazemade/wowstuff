(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsMotherRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const violet = '#d6a5ff', teal = '#8fe4c0';
    function line(ctx, a, b, tone, arrow) {
        ctx.save(); ctx.strokeStyle = tone; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        if (arrow && Math.hypot(b.x - a.x, b.y - a.y) > 5) {
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            ctx.beginPath(); ctx.moveTo(b.x - 8 * Math.cos(angle - .48), b.y - 8 * Math.sin(angle - .48));
            ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - 8 * Math.cos(angle + .48), b.y - 8 * Math.sin(angle + .48)); ctx.stroke();
        }
        ctx.restore();
    }
    function ring(ctx, p, r, tone, fill) {
        ctx.save(); ctx.strokeStyle = tone; ctx.lineWidth = 2; ctx.fillStyle = fill || 'transparent';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    function label(api, p, value, tone) {
        const { ctx, action, width, height } = api;
        ctx.save(); ctx.font = '600 13px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        const half = ctx.measureText(value).width / 2 + 5, bounds = action || { x: 0, y: 0, w: width, h: height };
        const x = Math.max(bounds.x + half, Math.min(bounds.x + bounds.w - half, p.x));
        const y = Math.max(bounds.y + 17, Math.min(bounds.y + bounds.h - 5, p.y));
        ctx.fillStyle = 'rgba(7,13,10,.9)'; ctx.fillRect(x - half, y - 14, half * 2, 19);
        ctx.fillStyle = tone; ctx.fillText(value, x, y); ctx.restore();
    }
    function draw(layer, api, scene, frame) {
        const { ctx, px, yd } = api;
        if (frame.stage === 'complete') return;
        if (layer === 'floor') {
            if (frame.shriek) ring(ctx, px(frame.shriek.at), yd(18), 'rgba(255,172,112,.7)', 'rgba(255,128,75,.07)');
            if (frame.saber?.active) frame.saber.targetIds.forEach(id => ring(ctx, px(frame.pos[id]), Math.max(13, yd(2.3)), '#ffd27d', 'rgba(255,198,108,.2)'));
            (frame.routes || []).forEach(route => line(ctx, px(route.from), px(route.to), '#d8e9e1', true));
            if (frame.fatal?.active) frame.fatal.distances.forEach(pair => {
                line(ctx, px(frame.pos[pair.ids[0]]), px(frame.pos[pair.ids[1]]), pair.yards >= 25 ? teal : violet, false);
            });
            if (frame.beam) line(ctx, px(frame.boss), px(frame.pos[frame.beam.targetId]), violet, false);
            return;
        }
        if (frame.shriek) {
            const p = px(frame.shriek.at);
            label(api, { x: p.x, y: p.y - yd(18) - 7 }, '18 yd · silence', '#ffd3a7');
        }
        if (['positioning', 'door'].includes(scene.id)) {
            const points = scene.id === 'door' ? [[.665, .89, 'Door corner']] : [[.45, .35, 'Upper statue'], [.45, .73, 'Lower statue']];
            points.forEach(([x, y, text]) => label(api, px({ x, y }), text, teal));
        }
        if (scene.tanks.length && (frame.saber || ['positioning', 'door'].includes(scene.id))) {
            const p = px(frame.pos[scene.tanks[0]]);
            label(api, { x: p.x, y: p.y + 32 }, scene.tanks.length + ' tanks · stack', '#ffd27d');
        }
        if (frame.fatal) {
            frame.fatal.targetIds.forEach(id => ring(ctx, px(frame.pos[id]), Math.max(13, yd(2.8)), frame.fatal.targetClear?.[id] ? teal : violet));
            if (frame.fatal.active && api.width < 700 && frame.fatal.distances.length) {
                const closest = Math.min(...frame.fatal.distances.map(pair => pair.yards));
                const bounds = api.action || { x: 0, y: 0, w: api.width };
                const p = { x: bounds.x + bounds.w - 53, y: bounds.y + 24 };
                label(api, p, 'Closest pair', violet);
                label(api, { x: p.x, y: p.y + 22 }, Math.floor(closest) + ' / 25 yd', violet);
            } else if (frame.fatal.active) frame.fatal.distances.forEach(pair => {
                const a = px(frame.pos[pair.ids[0]]), b = px(frame.pos[pair.ids[1]]);
                label(api, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 7 }, Math.floor(pair.yards) + ' / 25 yd', pair.yards >= 25 ? teal : violet);
            });
            else {
                const p = px(frame.fatal.teleportAt);
                label(api, { x: p.x, y: p.y + 26 }, 'All effects cleared', teal);
            }
        }
        if (frame.beam) {
            const p = px(frame.pos[frame.beam.targetId]);
            ring(ctx, p, Math.max(12, yd(3)), violet);
            label(api, { x: p.x, y: p.y - 22 }, frame.beam.kind, violet);
        }
    }
    return { draw };
}));
