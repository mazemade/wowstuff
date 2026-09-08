(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsBloodboilRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const colours = { G1: '#ffcf65', G2: '#7bc7ff', G3: '#dc9dff' };
    function label(ctx, x, y, value, colour = '#eee7d7') {
        ctx.save(); ctx.font = '600 16px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const width = ctx.measureText(value).width + 14;
        ctx.fillStyle = 'rgba(6,12,9,.94)'; ctx.strokeStyle = colour;
        ctx.beginPath(); ctx.roundRect(x - width / 2, y - 13, width, 26, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = colour; ctx.fillText(value, x, y); ctx.restore();
    }
    function line(ctx, from, to, colour, arrow) {
        if (Math.hypot(to.x - from.x, to.y - from.y) < 2) return;
        ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
        if (arrow) {
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            ctx.beginPath(); ctx.moveTo(to.x - 10 * Math.cos(angle - .5), to.y - 10 * Math.sin(angle - .5));
            ctx.lineTo(to.x, to.y); ctx.lineTo(to.x - 10 * Math.cos(angle + .5), to.y - 10 * Math.sin(angle + .5)); ctx.stroke();
        }
        ctx.restore();
    }
    function draw(layer, api, scene, frame) {
        const { ctx, px, yd } = api;
        if (layer === 'floor') {
            if (frame.phase === 1 && ['positioning', 'rotation', 'cycle'].includes(scene.id)) {
                const a = px({ x: .285, y: .31 }), b = px({ x: .405, y: .70 });
                ctx.save(); ctx.fillStyle = 'rgba(187,50,44,.13)'; ctx.strokeStyle = 'rgba(255,167,125,.65)'; ctx.lineWidth = 1;
                ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 8); ctx.fill(); ctx.stroke(); ctx.restore();
            }
            if (frame.frontal) {
                const a = px(frame.frontal.from), b = px(frame.frontal.to), angle = Math.atan2(b.y - a.y, b.x - a.x);
                ctx.save(); ctx.fillStyle = 'rgba(242,108,51,.22)'; ctx.strokeStyle = 'rgba(255,158,97,.8)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, yd(frame.frontal.yards || 12), angle - .48, angle + .48); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
            }
            if (frame.geyser) {
                const p = px(frame.geyser.at);
                ctx.save(); ctx.strokeStyle = '#8fd889'; ctx.fillStyle = 'rgba(117,223,132,.2)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, yd(frame.geyser.radiusYards), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
            }
            for (const route of frame.routes || []) line(ctx, px(route.from), px(route.to), '#d9e8de', true);
            for (const heal of frame.healLinks || []) {
                if (frame.pos[heal.fromId] && frame.pos[heal.toId] && heal.fromId !== heal.toId)
                    line(ctx, px(frame.pos[heal.fromId]), px(frame.pos[heal.toId]), 'rgba(98,229,170,.65)', false);
            }
            return;
        }
        if (frame.phase === 1 && ['positioning', 'rotation', 'cycle'].includes(scene.id)) {
            const a = px({ x: .345, y: .26 }); label(ctx, a.x, a.y, 'Farthest five', '#ffbf8f');
            for (const player of scene.raid) {
                if (!player.group || !frame.pos[player.id]) continue;
                const p = px(frame.pos[player.id]);
                ctx.save(); ctx.strokeStyle = colours[player.group] || '#a5dac3'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(11, Math.min(23, yd(1.7) + 3)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            const group = frame.soakGroup, members = frame.groupMembers[group] || [];
            if (group) {
                const p = px({ x: .52, y: .26 });
                label(ctx, p.x, p.y, group + ' out · ' + members.length + '/5', colours[group] || '#a5dac3');
            }
            const waves = scene.sequence.waves || [];
            if (waves.length > 1) {
                const p = px({ x: .53, y: .75 }), step = Math.max(30, Math.min(44, yd(6)));
                waves.forEach((time, index) => {
                    const group = 'G' + (index % 3 + 1), hit = frame.timeMs >= time;
                    label(ctx, p.x + (index - 2) * step, p.y, (hit ? '✓ ' : '') + group, hit ? colours[group] : '#8c9c94');
                });
            }
        }
        const stacks = {};
        for (const application of frame.bloodboil || []) for (const id of application.targetIds) stacks[id] = (stacks[id] || 0) + 1;
        for (const [id, count] of Object.entries(stacks)) {
            const p = px(frame.pos[id]);
            ctx.save(); ctx.fillStyle = '#bf4543'; ctx.strokeStyle = '#ffc9b0'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(p.x + yd(1.7), p.y + yd(1.7), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fff0dd'; ctx.font = '600 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(count), p.x + yd(1.7), p.y + yd(1.7)); ctx.restore();
        }
        for (const [id, wound] of Object.entries(frame.tankDebuffs || {})) {
            if (!frame.pos[id]) continue;
            const p = px(frame.pos[id]);
            label(ctx, p.x, p.y + Math.max(17, yd(3.3)), String(wound.stacks), '#b6d67c');
        }
        if (frame.rage.active && frame.rage.targetId && frame.pos[frame.rage.targetId]) {
            const p = px(frame.pos[frame.rage.targetId]);
            ctx.save(); ctx.strokeStyle = '#ffa4b2'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(17, yd(2.8)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            const clock = px({ x: .53, y: .24 });
            label(ctx, clock.x, clock.y, 'Fel Rage · ' + frame.rage.remainingSeconds + 's', '#ffa4b2');
        }
        if (scene.id === 'tanks') {
            const p = px({ x: .53, y: .26 }); label(ctx, p.x, p.y, 'Threat handoff · taunt immune', '#ffcf8a');
        }
    }
    return { draw };
}));
