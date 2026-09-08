(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsAkamaRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const colours = { channeler: '#c58bec', sorcerer: '#edb55f', spiritbinder: '#8bcba7', elementalist: '#f19565', rogue: '#d7bfa0', defender: '#8fbbdf' };
    const letters = { channeler: 'C', sorcerer: 'S', spiritbinder: '+', elementalist: 'E', rogue: 'R', defender: 'D' };
    function label(ctx, x, y, text, colour, size = 13, maxWidth) {
        ctx.save(); ctx.font = '600 ' + size + 'px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,8,12,.95)'; ctx.fillStyle = colour;
        ctx.strokeText(text, x, y, maxWidth); ctx.fillText(text, x, y, maxWidth); ctx.restore();
    }
    function line(ctx, a, b, colour, dashed) {
        ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; if (dashed) ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }
    function ring(ctx, p, r, fill, stroke) {
        ctx.save(); ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    function bar(ctx, p, width, value, colour) {
        ctx.save(); ctx.fillStyle = '#080c11'; ctx.fillRect(p.x - width / 2, p.y, width, 5);
        ctx.fillStyle = colour; ctx.fillRect(p.x - width / 2 + 1, p.y + 1, (width - 2) * value, 3); ctx.restore();
    }
    function draw(layer, api, scene, frame) {
        const { ctx, px, yd, width, height } = api;
        if (layer === 'floor') {
            frame.traps.forEach(h => {
                const p = px(h.at), r = yd(h.radiusYards);
                ring(ctx, p, r, 'rgba(105,181,244,.12)', 'rgba(143,207,255,.68)');
                for (let i = 0; i < 6; i++) {
                    const a = i * Math.PI / 3;
                    line(ctx, { x: p.x + Math.cos(a) * r * .25, y: p.y + Math.sin(a) * r * .25 }, { x: p.x + Math.cos(a) * r * .8, y: p.y + Math.sin(a) * r * .8 }, 'rgba(163,219,255,.5)');
                }
            });
            frame.channels.forEach(c => {
                const a = px(c.from), b = px(c.to);
                ctx.save(); ctx.shadowColor = '#af6bee'; ctx.shadowBlur = 9;
                line(ctx, a, b, 'rgba(199,136,244,.72)'); ctx.restore();
            });
            frame.npcs.filter(n => n.targetId && frame.pos[n.targetId]).forEach(n => {
                line(ctx, px(n.at), px(frame.pos[n.targetId]), 'rgba(140,191,232,.55)', true);
            });
            frame.hazards.forEach(h => {
                const p = px(h.at), r = yd(h.radiusYards);
                ring(ctx, p, r, 'rgba(235,101,34,.28)', '#ffac68');
                ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();
                for (let x = -r * 2; x <= r * 2; x += 12) line(ctx, { x: p.x + x, y: p.y - r }, { x: p.x + x + r, y: p.y + r }, 'rgba(255,179,86,.28)');
                ctx.restore(); label(ctx, p.x, p.y + r + 16, 'Rain of Fire', '#ffce9d');
            });
            if (frame.aoe) {
                const p = px(frame.aoe.at), r = yd(frame.aoe.radiusYards);
                ring(ctx, p, r, 'rgba(77,211,191,.16)', 'rgba(126,245,220,.84)');
                ctx.save(); ctx.strokeStyle = 'rgba(160,255,232,.45)'; ctx.lineWidth = 2;
                for (let i = 0; i < 8; i++) {
                    const a = i * Math.PI / 4;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * r * .82, p.y + Math.sin(a) * r * .82); ctx.stroke();
                }
                ctx.restore(); label(ctx, p.x, p.y + r + 16, 'AoE damage', '#b8ffeb');
            }
            if (frame.stage === 'approach') line(ctx, px(frame.boss), px({ x: frame.akama.x, y: frame.akama.y - .09 }), '#c5f4e9', true);
            if (frame.phase === 2 && frame.stage !== 'complete') line(ctx, px(frame.boss), px(frame.akama), '#e9b86a');
            return;
        }
        frame.npcs.forEach(n => {
            const p = px(n.at), r = Math.max(8, Math.min(15, yd(1.9))), colour = colours[n.kind];
            if (n.priority) ring(ctx, p, r + 5, 'rgba(243,195,99,.10)', '#f0c46b');
            ring(ctx, p, r, '#171521', colour);
            label(ctx, p.x, p.y + 4, n.kind === 'channeler' ? n.label : letters[n.kind], colour, 12);
            if (n.hp < 1) bar(ctx, { x: p.x, y: p.y - r - 8 }, r * 2, n.hp, colour);
            if (n.kind === 'sorcerer') label(ctx, p.x, p.y + r + 16, 'Sorcerer', '#ffd08c');
            if (n.status) label(ctx, p.x, p.y - r - 8, n.status, n.status === 'Interrupted' ? '#ffdb9a' : '#a5edbd');
        });
        const akama = px(frame.akama), ar = Math.max(11, Math.min(20, yd(2.5)));
        ring(ctx, akama, ar, '#11362f', '#9dd5b9');
        label(ctx, akama.x, akama.y + 5, 'A', '#d3ffe3', 16);
        label(ctx, akama.x, akama.y + ar + 18, 'Akama · ally', '#b7edce', 14);
        if (frame.phase === 2) {
            bar(ctx, { x: akama.x, y: akama.y - ar - 10 }, ar * 3, frame.akamaHp, '#8ed4af');
            const boss = px(frame.boss);
            bar(ctx, { x: boss.x, y: boss.y - yd(4) - 9 }, Math.max(45, yd(8)), frame.bossHp, '#cb94ed');
        }
        const boss = px(frame.boss);
        if (frame.phase === 2) label(ctx, boss.x, boss.y + yd(4) + 17, 'Shade · Akama engaged', '#f2d3a4', 13);
        else if (frame.channels.length) {
            const stateX = width < 620 ? width * .77 : boss.x + yd(12);
            label(ctx, stateX, width < 620 ? 26 : boss.y, frame.channels.length + ' binding' + (frame.channels.length === 1 ? '' : 's') + ' · Shade immune', '#ddbcf6', width < 620 ? 11 : 13, width < 620 ? width * .42 : undefined);
        } else label(ctx, boss.x, boss.y + yd(4) + 17, 'Shade · released', '#c9eadc', 13);
        // The NPC key and illustrative-timing note live in the external legend strip.
    }
    return { draw };
}));
