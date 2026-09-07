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
            akamaHp: 1, bossHp: 1, bossTarget: null, phase: 1, stage: 'bound', call: sc.call, timeMs: t,
            strategy: seq.strategy || 'standard', damageTarget: sc.hasDamage ? 'channels' : null, aoe: null };
        sc.tanks.forEach(id => { if (sc.id !== 'positioning') frame.roles[id] = tankRoleLabel(sc, id); });
        const clearTankLabels = () => sc.tanks.forEach(id => { delete frame.roles[id]; });
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
        const aoeStrategy = seq.strategy === 'channeler-aoe';
        const released = sc.hasDamage && !frame.channels.length;
        const approach = released && seq.approachAt !== undefined && t >= seq.approachAt;
        const burn = approach && t >= seq.engageAt;
        const done = burn && t >= seq.winAt;
        const stackPoint = (id, i) => {
            const job = tankJob(sc, id);
            return job === 'Left door' || job === 'Left support' ? { x: .43, y: .21 }
                : job === 'Right door' || job.startsWith('Right support') ? { x: .57, y: .21 }
                    : { x: .5 + ((i % 3) - 1) * .045, y: .27 };
        };
        const nearBoss = (id, i) => {
            const job = tankJob(sc, id);
            if (i >= 2) return { x: frame.boss.x + ((i - 2) % 3 - 1) * .026, y: frame.boss.y + .065 + Math.floor((i - 2) / 3) * .025 };
            if (job === 'Left door' || job === 'Left support') return { x: frame.boss.x - .035, y: frame.boss.y + .032 };
            if (job === 'Right door' || job.startsWith('Right support')) return { x: frame.boss.x + .035, y: frame.boss.y + .032 };
            return { x: frame.boss.x, y: frame.boss.y + .065 };
        };
        const moveTanks = (from, until, label, destination, starts, instant) => {
            sc.tanks.forEach((id, i) => {
                const start = starts?.[id] || sc.baseById[id];
                if (!start) return;
                pos[id] = mix(start, destination(id, i), instant ? 1 : (t - from) / Math.max(1, until - from));
                frame.roles[id] = label;
            });
        };
        if (aoeStrategy && t >= seq.pullToChannelsAt) {
            moveTanks(seq.pullToChannelsAt, seq.stackAt, t < seq.stackAt ? 'Pull adds to Channelers' : 'Hold stacked adds', stackPoint);
            if (t < seq.stackAt) {
                frame.stage = 'adds';
                frame.call = 'Tanks bring the wave straight to the Channelers. Damage stays on Channelers.';
            } else if (!released) {
                frame.stage = sc.hasDamage && t >= seq.aoeAt ? 'aoe' : 'gather';
                frame.damageTarget = sc.hasDamage ? (t >= seq.aoeAt ? 'channels-and-adds' : 'channels') : null;
                frame.call = t >= seq.aoeAt ? 'AoE channels and stacked adds together. Tanks retain control.' : 'Finish stacking before the AoE call.';
            }
            clearTankLabels();
        }
        if (approach) {
            frame.boss = mix(fight.bossAt, fight.engageAt, seq.engageAt === seq.approachAt ? 1 : (t - seq.approachAt) / (seq.engageAt - seq.approachAt));
            const gathered = seq.gatherAt !== undefined && t >= seq.gatherAt;
            const cleaning = seq.cleanupAt !== undefined && t >= seq.cleanupAt;
            frame.stage = burn ? 'burn' : 'approach'; frame.phase = burn ? 2 : 1;
            frame.damageTarget = burn ? 'shade' : aoeStrategy ? 'shade' : cleaning ? 'adds' : 'adds';
            frame.call = burn ? 'Lust now. Burn the Shade. Tanks keep any remaining adds.'
                : aoeStrategy ? 'Channels down. Switch to Shade; burn when active. Tanks hold survivors.'
                    : !gathered ? 'Tanks bring every add to the moving Shade.'
                        : !cleaning ? 'Packs have met the moving Shade. Hold them for cleanup.'
                            : 'Clean up adds beside the moving Shade. Save Lust for engagement.';
            frame.bossTarget = burn ? 'akama' : null;
            frame.traps = [];
            const progress = clamp((t - seq.engageAt) / (seq.winAt - seq.engageAt));
            frame.bossHp = burn ? 1 - progress : 1;
            frame.akamaHp = burn ? 1 - progress * .7 : 1;
            const gatherAt = seq.gatherAt ?? (seq.approachAt + 4000);
            const starts = aoeStrategy ? Object.fromEntries(sc.tanks.map((id, i) => [id, stackPoint(id, i)])) : null;
            moveTanks(seq.approachAt, gatherAt, burn ? 'Hold surviving adds' : gathered ? (cleaning ? 'Hold adds for cleanup' : 'Hold adds at Shade') : 'Bring adds to Shade', nearBoss, starts, seq.engageAt === seq.approachAt);
            if (!burn) clearTankLabels();
            sc.raid.filter(p => p.kind !== 'tank').forEach(p => {
                let to = sc.baseById[p.id];
                if (p.kind === 'melee') {
                    const i = sc.raid.filter(x => x.kind === 'melee').findIndex(x => x.id === p.id);
                    to = { x: frame.boss.x - .055 + (i % 5) * .0275, y: frame.boss.y + .15 - Math.floor(i / 5) * .04 };
                } else to = { x: sc.baseById[p.id].x, y: Math.min(.5, sc.baseById[p.id].y + .07) };
                pos[p.id] = mix(sc.baseById[p.id], to, (t - seq.approachAt) / Math.max(1, gatherAt - seq.approachAt) + (seq.engageAt === 0 ? 1 : 0));
            });
        }
        if (seq.wavesAt !== undefined && t >= seq.wavesAt && !done) {
            if (!approach && !sorc && seq.fireAt === undefined && !['aoe', 'gather'].includes(frame.stage)) frame.stage = 'adds';
            const kinds = ['spiritbinder', 'elementalist', 'rogue'];
            fight.doors.forEach((door, side) => kinds.forEach((kind, j) => {
                const index = side * kinds.length + j;
                const damageAt = aoeStrategy ? seq.aoeAt : seq.cleanupAt;
                const cleanupAt = seq.cleanupAt ?? damageAt;
                const dieAt = cleanupAt === undefined ? Infinity : cleanupAt + j * 750;
                const targetId = sc.tanks[side] || null;
                if (sc.hasDamage && targetId && t >= dieAt) return;
                const dest = targetId ? { x: pos[targetId].x + (side ? .026 : -.026), y: pos[targetId].y + (j - 1) * .058 } : { x: door.x + (side ? -.045 : .045), y: door.y + (j - 1) * .058 };
                const hpStart = damageAt === undefined ? Infinity : aoeStrategy ? damageAt : damageAt - 900;
                const hp = sc.hasDamage && targetId && t >= hpStart ? Math.max(.05, clamp((dieAt - t) / Math.max(1, dieAt - hpStart))) : 1;
                frame.npcs.push({ id: kind + '-' + side, kind, at: mix(door, dest, (t - seq.wavesAt) / 3000), hp, targetId,
                    status: kind === 'spiritbinder' && seq.interruptAt !== undefined && t >= seq.interruptAt - 1000 && t < seq.interruptAt + 1800 ? (t < seq.interruptAt ? 'Healing…' : 'Interrupted') : null });
            }));
            const targetId = sc.tanks[2] || sc.tanks[1] || sc.tanks[0] || null;
            const defenderDieAt = !aoeStrategy && seq.cleanupAt !== undefined ? seq.cleanupAt + 2250 : Infinity;
            if (!(sc.hasDamage && targetId && t >= defenderDieAt)) {
                const dest = targetId ? { x: pos[targetId].x + .035, y: pos[targetId].y + .045 } : { x: .76, y: .64 };
                const hpStart = seq.cleanupAt === undefined ? Infinity : seq.cleanupAt - 900;
                const hp = sc.hasDamage && !aoeStrategy && targetId && t >= hpStart ? Math.max(.05, clamp((defenderDieAt - t) / Math.max(1, defenderDieAt - hpStart))) : 1;
                frame.npcs.push({ id: 'defender', kind: 'defender', at: mix(fight.doors[1], dest, (t - seq.wavesAt) / 3000), hp, targetId });
            }
        }
        if (aoeStrategy && sc.hasDamage && t >= seq.aoeAt && !released) {
            frame.aoe = { at: { ...fight.bossAt }, radiusYards: 28, affectedIds: frame.npcs.filter(n => n.kind !== 'channeler').map(n => n.id) };
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
        if (done) { frame.stage = 'complete'; frame.call = 'Shade defeated. Akama survives.'; frame.npcs = []; frame.channels = []; frame.roles = {}; frame.damageTarget = null; frame.bossHp = 0; }
        frame.channels.forEach(c => { c.to = { ...frame.boss }; });
        return frame;
    }

    function copyText(fight, sc, frame) {
        const lines = [fight.name + ' — example roster jobs'];
        if (!sc.raid.some(p => p.name)) lines.push('No roster loaded. Showing an example raid.');
        sc.raid.filter(p => p.name).forEach(p => {
            const job = frame.stage === 'complete' ? 'No active job; encounter complete.'
                : p.kind === 'tank' ? (frame.phase === 2 ? 'hold surviving adds; Akama tanks the Shade'
                    : frame.stage === 'gather' ? (frame.strategy === 'channeler-aoe' ? 'hold stacked adds at the Channelers' : 'hold adds beside the moving Shade')
                        : frame.stage === 'approach' ? (frame.strategy === 'channeler-aoe' ? 'hold surviving adds while damage switches to the Shade' : 'hold adds for cleanup beside the moving Shade')
                            : frame.stage === 'aoe' ? 'hold stacked adds at the Channelers'
                                : frame.stage === 'adds' && frame.strategy === 'channeler-aoe' ? 'bring adds to the Channelers'
                                    : tankJob(sc, p.id) + '; control incoming adds')
                    : p.kind === 'healer' ? 'heal assigned add tanks; avoid ground fire'
                        : frame.phase === 2 ? 'Lust and burn the Shade'
                            : frame.strategy === 'channeler-aoe' && frame.damageTarget === 'channels-and-adds' ? 'cleave Channelers and stacked adds'
                                : frame.strategy === 'channeler-aoe' && frame.damageTarget === 'shade' ? 'switch to the Shade; burn when active'
                                    : frame.stage === 'approach' ? 'clean up adds during the Shade’s walk'
                                        : 'kill Channelers and Sorcerers; help control dangerous adds';
            lines.push(p.name + ' — ' + job);
        });
        if (frame.stage === 'complete') lines.push('Shade defeated. No active jobs remain.');
        lines.push(...sc.missingRoles, 'Positions, routes, timing and health are illustrative.');
        return lines.join('\n');
    }
    return { prepareScene, simulate, copyText };
}));
