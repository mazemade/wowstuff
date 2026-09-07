(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsNajentusRender = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    function text(ctx, x, y, value, colour) {
        ctx.save(); ctx.font = '600 15px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,9,10,.92)'; ctx.strokeText(value, x, y);
        ctx.fillStyle = colour; ctx.fillText(value, x, y); ctx.restore();
    }
    function draw(layer, api, scene, frame) {
        const { ctx, px, yd, width, height } = api;
        if (layer === 'floor') {
            if (scene.id === 'overview') {
                const labels = ['1 Spread', '2 Free spine', '3 Heal up', '4 Called throw'];
                labels.forEach((value, i) => text(ctx, width * (.21 + i * .19), height * .78, value, '#c5f4e9'));
            }
            const impale = scene.resolved.impales.find(e => frame.impaled.includes(e.victim));
            if (impale) {
                const from = px(frame.pos[impale.rescuer]), to = px(frame.pos[impale.victim]);
                ctx.save(); ctx.strokeStyle = 'rgba(218,244,232,.72)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
                ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.restore();
            }
            frame.needles.forEach(n => {
                const p = px(n.at), r = yd(n.radiusYards);
                ctx.save(); ctx.fillStyle = 'rgba(77,221,238,.12)'; ctx.strokeStyle = 'rgba(97,239,255,.84)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
            });
            if (frame.shield) {
                const p = px(frame.boss), r = yd(6.8);
                ctx.save(); ctx.fillStyle = 'rgba(72,151,255,.15)'; ctx.strokeStyle = 'rgba(117,186,255,.88)'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
            }
            if (frame.burst && frame.burst.progress < 1) {
                ctx.save(); ctx.fillStyle = 'rgba(181,232,255,' + (0.26 * (1 - frame.burst.progress)) + ')'; ctx.fillRect(0, 0, width, height); ctx.restore();
            }
            return;
        }
        frame.impaled.forEach(id => {
            const p = px(frame.pos[id]);
            ctx.save(); ctx.fillStyle = '#efbd4b'; ctx.strokeStyle = '#5d3c0a'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y - yd(2.7)); ctx.lineTo(p.x - yd(.55), p.y - yd(.65)); ctx.lineTo(p.x + yd(.55), p.y - yd(.65)); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
            text(ctx, p.x, p.y - yd(3.6), 'Click spine', '#ffd36f');
        });
        Object.entries(frame.holders).forEach(([id, count]) => {
            if (!count || !frame.pos[id]) return;
            const p = px(frame.pos[id]); ctx.save(); ctx.fillStyle = '#f1bc4c'; ctx.strokeStyle = '#624510'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(p.x + yd(1.4), p.y - yd(1.4), yd(.75), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        });
        if (frame.shield) { const p = px(frame.boss); text(ctx, p.x, p.y - yd(8), frame.ready ? 'Raid ready' : 'Immune', '#9fd0ff'); }
        if (frame.projectile) {
            const a = px(frame.projectile.from), b = px(frame.projectile.to), k = frame.projectile.progress;
            const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
            ctx.save(); ctx.strokeStyle = '#f6d36e'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#f2bd45'; ctx.beginPath(); ctx.arc(x, y, yd(.75), 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        if (frame.burst && frame.burst.progress < 1) text(ctx, width / 2, 48, '8,500 Frost · raidwide', '#d6f1ff');
        text(ctx, width / 2, 34, frame.call, '#ffd9a8');
    }
    return { draw };
}));
