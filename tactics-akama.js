(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsAkama = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = t => Math.max(0, Math.min(1, t));
    const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * clamp(t), y: a.y + (b.y - a.y) * clamp(t) });
    const className = player => String(player.class || '').trim().toUpperCase();
    const isPaladin = player => className(player).includes('PALADIN');
    const tankJob = (sc, id) => sc.tankJobs[id] || 'Add support';
    const tankRoleLabel = (sc, id) => tankJob(sc, id).includes('support') ? 'Support' : tankJob(sc, id);
    const tankAt = (job, index) => {
        if (job === 'Left door') return { x: .285, y: .51 };
        if (job === 'Right door') return { x: .715, y: .49 };
        if (job === 'Left support') return { x: .325, y: .61 };
        if (job.startsWith('Right support')) return { x: .675, y: .61 };
        if (job === 'Door support') return { x: .5, y: .62 };
        return { x: .5 + ((index - 3) % 3) * .055, y: .69 + Math.floor((index - 3) / 3) * .05 };
    };

    function prepareScene(fight, source, assigned) {
        const sc = JSON.parse(JSON.stringify(source));
        sc.cast = {}; sc.baseById = {}; sc.missingRoles = [];
        const groups = Object.fromEntries(['tank', 'melee', 'ranged', 'healer'].map(k => [k, assigned.filter(p => p.kind === k)]));
        const paladin = groups.tank.find(isPaladin);
        let doorTanks = groups.tank.slice(0, 2);
        // Preserve the imported main-tank order when it already includes a paladin. If a
        // paladin arrives later in the list, promote it to the second doorway instead.
        if (paladin && !doorTanks.includes(paladin)) doorTanks = [doorTanks[0], paladin].filter(Boolean);
        const supportTanks = groups.tank.filter(p => !doorTanks.includes(p));
        // Door duties are class-aware, while sc.raid remains in the imported/MT display order.
        sc.tanks = [...doorTanks, ...supportTanks].map(p => p.id);
        const paladinSide = doorTanks.findIndex(isPaladin);
        sc.tankJobs = Object.fromEntries(sc.tanks.map((id, i) => {
            const job = i === 0 ? 'Left door' : i === 1 ? 'Right door'
                : i === 2 ? (paladinSide === 0 ? 'Right support' : paladinSide === 1 ? 'Left support' : 'Right support · example')
                    : 'Add support';
            return [id, job];
        }));
        sc.hasDamage = groups.melee.length + groups.ranged.length > 0;
        sc.hasTraps = assigned.some(p => className(p) === 'HUNTER') || assigned.every(p => !p.name);
        if (sc.tanks.length < 2) sc.missingRoles.push('Both hallway tank jobs need coverage; missing tanks are not filled in.');
        if (!groups.healer.length) sc.missingRoles.push('No healer loaded: assign tank healing before the pull.');
        if (!sc.hasDamage) sc.missingRoles.push('No damage role loaded: channel kills and the burn are not demonstrated.');
        if (sc.sequence.traps && !sc.hasTraps) sc.missingRoles.push('No hunter loaded: Frost Traps are not assigned.');
        sc.raid = assigned.map(p => {
            const pool = groups[p.kind], i = pool.indexOf(p), n = pool.length;
            let at;
            if (p.kind === 'tank') at = tankAt(tankJob(sc, p.id), i);
            else if (p.kind === 'melee') at = { x: .39 + (i % 8) / Math.max(1, Math.min(n, 8) - 1) * .22, y: .24 + Math.floor(i / 8) * .047 };
            else if (p.kind === 'healer') at = { x: .415 + (i % 3) * .085, y: .535 + Math.floor(i / 3) * .065 };
            else at = { x: .32 + (i % 5) / Math.max(1, Math.min(n, 5) - 1) * .36, y: .32 + Math.floor(i / 5) * .052 };
            // Preserve oversized rosters inside the usable central floor.
            at.y = Math.min(at.y, .78);
            sc.baseById[p.id] = at;
            return { id: p.id, kind: p.kind, name: p.name, slotIndex: p.slotIndex,
                label: sc.id === 'positioning' ? (p.name || (p.kind === 'tank' ? tankJob(sc, p.id) : '')) : '' };
        });
        sc.bossActor = { id: 'boss', kind: 'boss', at: { ...fight.bossAt }, scale: .8 };
        const initial = sc.sequence.initialChannels ?? 6;
        sc.channelers = Array.from({ length: initial }, (_, i) => {
            const angle = (-90 + i * 60) * Math.PI / 180;
            return { id: 'channel-' + i, kind: 'channeler', label: String(i + 1), at: {
                x: fight.bossAt.x + Math.cos(angle) * .065,
                y: fight.bossAt.y + Math.sin(angle) * .074
            }, dieAt: sc.hasDamage ? (sc.sequence.kills || [])[i] ?? null : null };
        });
        const fireTarget = groups.ranged[0] || groups.healer[0] || groups.melee[0];
        sc.fireAt = fireTarget ? { ...sc.baseById[fireTarget.id] } : null;
        return sc;
    }

    function simulate(fight, sc, timeMs) {
        const t = Math.max(0, Math.min(sc.duration, Number.isFinite(timeMs) ? timeMs : 0));
        const seq = sc.sequence, pos = Object.fromEntries(Object.entries(sc.baseById).map(([id, p]) => [id, { ...p }]));
        const frame = { pos, boss: { ...fight.bossAt }, trail: null, hp: {}, roles: {}, focus: {},
            npcs: [], channels: [], hazards: [], traps: [], akama: { ...fight.akamaAt },
            akamaHp: 1, bossHp: 1, bossTarget: null, phase: 1, stage: 'bound', call: sc.call, timeMs: t };
        sc.tanks.forEach(id => { if (sc.id !== 'positioning') frame.roles[id] = tankRoleLabel(sc, id); });
        const living = sc.channelers.filter(n => n.dieAt === null || t < n.dieAt);
        living.forEach(n => {
            frame.npcs.push({ id: n.id, kind: n.kind, label: n.label, at: { ...n.at }, hp: n.dieAt === null ? 1 : Math.max(.05, clamp((n.dieAt - t) / 2000)), priority: n === living[0] && !!seq.kills });
            frame.channels.push({ fromId: n.id, from: { ...n.at } });
        });
        const sorc = seq.sorcerer;
        if (sorc && t >= sorc.spawnAt && (!sc.hasDamage || t < sorc.dieAt)) {
            const end = { x: .63, y: .17 }, at = mix(fight.doors[1], end, (t - sorc.spawnAt) / (sorc.channelAt - sorc.spawnAt));
            frame.npcs.push({ id: 'sorcerer', kind: 'sorcerer', label: 'Sorcerer', at, hp: 1, priority: true });
            if (t >= sorc.channelAt) frame.channels.push({ fromId: 'sorcerer', from: { ...at } });
            frame.stage = 'sorcerer'; frame.call = 'New Sorcerer. Kill the reinforcing channel.';
        }
        if (seq.traps && sc.hasTraps) frame.traps = fight.doors.map(p => ({ at: { ...p }, radiusYards: 6 }));
        const approach = sc.hasDamage && !frame.channels.length && seq.approachAt !== undefined && t >= seq.approachAt;
        const burn = approach && t >= seq.engageAt;
        const done = burn && t >= seq.winAt;
        if (approach) {
            frame.boss = mix(fight.bossAt, fight.engageAt, seq.engageAt === seq.approachAt ? 1 : (t - seq.approachAt) / (seq.engageAt - seq.approachAt));
            frame.stage = burn ? 'burn' : 'approach'; frame.phase = burn ? 2 : 1;
            frame.call = burn ? 'Lust now. Burn the Shade. Tanks keep any remaining adds.' : 'Bring adds toward the Shade. Clean up during the walk.';
            frame.bossTarget = burn ? 'akama' : null;
            frame.traps = [];
            const progress = clamp((t - seq.engageAt) / (seq.winAt - seq.engageAt));
            frame.bossHp = burn ? 1 - progress : 1;
            frame.akamaHp = burn ? 1 - progress * .7 : 1;
            sc.raid.forEach(p => {
                let to = sc.baseById[p.id];
                if (p.kind === 'tank') {
                    const job = tankJob(sc, p.id);
                    to = job === 'Left door' || job === 'Left support' ? { x: .39, y: .61 }
                        : job === 'Right door' || job.startsWith('Right support') ? { x: .61, y: .61 }
                            : { x: .5, y: .67 };
                } else if (p.kind === 'melee') {
                    const i = sc.raid.filter(x => x.kind === 'melee').findIndex(x => x.id === p.id);
                    to = { x: .445 + (i % 5) * .0275, y: .58 - Math.floor(i / 5) * .04 };
                } else to = { x: sc.baseById[p.id].x, y: Math.min(.5, sc.baseById[p.id].y + .07) };
                pos[p.id] = mix(sc.baseById[p.id], to, (t - seq.approachAt) / 4000 + (seq.engageAt === 0 ? 1 : 0));
                if (p.kind === 'tank') frame.roles[p.id] = 'Hold adds';
            });
        }
        if (seq.wavesAt !== undefined && t >= seq.wavesAt && !done) {
            if (!approach && !sorc && seq.fireAt === undefined) frame.stage = 'adds';
            const kinds = ['spiritbinder', 'elementalist', 'rogue'];
            fight.doors.forEach((door, side) => kinds.forEach((kind, j) => {
                // The transition demonstrates cleanup; the spare Defender remains tanked.
                const cleanAt = seq.approachAt !== undefined ? seq.approachAt + 2500 + j * 750 : Infinity;
                if (sc.hasDamage && approach && t >= cleanAt) return;
                const targetId = sc.tanks[side] || null;
                const dest = targetId ? { x: pos[targetId].x + (side ? .026 : -.026), y: pos[targetId].y + (j - 1) * .058 } : { x: door.x + (side ? -.045 : .045), y: door.y + (j - 1) * .058 };
                frame.npcs.push({ id: kind + '-' + side, kind, at: mix(door, dest, (t - seq.wavesAt) / 3000), hp: 1, targetId,
                    status: kind === 'spiritbinder' && seq.interruptAt !== undefined && t >= seq.interruptAt - 1000 && t < seq.interruptAt + 1800 ? (t < seq.interruptAt ? 'Healing…' : 'Interrupted') : null });
            }));
            const targetId = sc.tanks[2] || sc.tanks[1] || sc.tanks[0] || null;
            const dest = targetId ? { x: pos[targetId].x + .035, y: pos[targetId].y + .045 } : { x: .76, y: .64 };
            frame.npcs.push({ id: 'defender', kind: 'defender', at: mix(fight.doors[1], dest, (t - seq.wavesAt) / 3000), hp: 1, targetId });
        }
        if (seq.survivingAdds && !done) {
            seq.survivingAdds.forEach((kind, i) => {
                const targetId = sc.tanks[2] || sc.tanks[1] || sc.tanks[0] || null;
                const target = targetId ? pos[targetId] : { x: .61, y: .67 };
                frame.npcs.push({ id: 'surviving-' + kind + '-' + i, kind, at: { x: target.x + .035, y: target.y + .045 }, hp: 1, targetId });
            });
        }
        if (seq.fireAt !== undefined && sc.fireAt && t >= seq.fireAt) {
            const affected = sc.raid.filter(p => L.dist(fight, sc.baseById[p.id], sc.fireAt) < 10);
            if (t < seq.fireAt + 6000) {
                frame.hazards.push({ at: { ...sc.fireAt }, radiusYards: 10, affectedIds: affected.map(p => p.id) });
                frame.stage = 'fire'; frame.call = 'Out of Rain of Fire. Keep your tank in healing range.';
            }
            if (!approach) affected.forEach(p => {
                const safe = L.safePos(fight, sc.baseById[p.id], [{ ...sc.fireAt, yards: 11.5 }]);
                const k = t < seq.fireAt + 6000 ? (t - seq.fireAt) / 2200 : 1 - (t - seq.fireAt - 6000) / 1800;
                pos[p.id] = mix(sc.baseById[p.id], safe, k);
                if (frame.hazards.length) { frame.focus[p.id] = true; frame.roles[p.id] = 'Move out'; }
            });
        }
        if (sc.id === 'channelers') frame.call = living.length ? 'Kill Channeler ' + living[0].label + '. Keep the doorway adds controlled.' : 'Channels cleared. Prepare for the Shade’s walk.';
        if (sc.id === 'sorcerers' && sorc && sc.hasDamage && t >= sorc.dieAt) frame.call = living.length ? 'Sorcerer down. Finish the last Channeler.' : 'Binding cleared. Prepare the burn.';
        if (!sc.hasDamage && (seq.kills || seq.winAt !== undefined)) frame.call = 'No damage role loaded. Assign channeler damage before starting.';
        if (done) { frame.stage = 'complete'; frame.call = 'Shade defeated. Akama survives.'; frame.npcs = []; frame.channels = []; frame.roles = {}; frame.bossHp = 0; }
        frame.channels.forEach(c => { c.to = { ...frame.boss }; });
        return frame;
    }

    function copyText(fight, sc, frame) {
        const lines = [fight.name + ' — example roster jobs'];
        if (!sc.raid.some(p => p.name)) lines.push('No roster loaded. Showing an example raid.');
        sc.raid.filter(p => p.name).forEach(p => {
            const job = frame.stage === 'complete' ? 'No active job; encounter complete.'
                : p.kind === 'tank' ? (frame.phase === 2 ? 'hold surviving adds; Akama tanks the Shade' : tankJob(sc, p.id) + '; control incoming adds')
                    : p.kind === 'healer' ? 'heal assigned add tanks; avoid ground fire'
                        : frame.phase === 2 ? 'Lust and burn the Shade' : frame.stage === 'approach' ? 'clean up adds during the Shade’s walk' : 'kill Channelers and Sorcerers; help control dangerous adds';
            lines.push(p.name + ' — ' + job);
        });
        if (frame.stage === 'complete') lines.push('Shade defeated. No active jobs remain.');
        lines.push(...sc.missingRoles, 'Positions, routes, timing and health are illustrative.');
        return lines.join('\n');
    }
    return { prepareScene, simulate, copyText };
}));
