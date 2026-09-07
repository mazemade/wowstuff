(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./tactics-layout.js')); }
    else { root.TacticsNajentus = factory(root.TacticsLayout); }
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const progress = (t, start, end) => end <= start ? Number(t >= end) : clamp((t - start) / (end - start), 0, 1);
    const between = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    const clone = value => JSON.parse(JSON.stringify(value));
    const near = (fight, from, to, yards) => {
        const distance = L.dist(fight, from, to);
        if (!distance || distance <= yards) return { x: from.x, y: from.y };
        return between(from, to, (distance - yards) / distance);
    };
    const inRange = (fight, point, boss, yards) => near(fight, point, boss, yards);

    function resolvePairs(fight, raid, baseById, count) {
        const mt = raid.find(p => p.kind === 'tank');
        const used = new Set();
        const pairs = [];
        for (let i = 0; i < count; i++) {
            const pool = raid.filter(p => p.id !== mt?.id && !used.has(p.id));
            const victim = pool.find(p => p.kind === 'ranged') || pool[0];
            if (!victim) break;
            const helpers = pool.filter(p => p.id !== victim.id);
            helpers.sort((a, b) => L.dist(fight, baseById[a.id], baseById[victim.id]) - L.dist(fight, baseById[b.id], baseById[victim.id]) || a.slotIndex - b.slotIndex);
            const rescuer = helpers[0];
            if (!rescuer) break;
            used.add(victim.id); used.add(rescuer.id);
            pairs.push({ victim: victim.id, rescuer: rescuer.id });
        }
        return { mt: mt?.id || null, pairs };
    }

    function prepareScene(fight, sourceScene, assigned) {
        const sequence = clone(sourceScene.sequence || {});
        const raid = L.formation(fight, 1, assigned).map(p => ({
            id: p.id, kind: p.kind, name: p.name, slotIndex: p.slotIndex, at: p.at,
            label: sourceScene.id === fight.positioningSceneId
                ? (p.kind === 'tank'
                    ? (p.id === assigned.find(x => x.kind === 'tank')?.id ? 'MT' : 'TANK') + (p.name ? ' · ' + p.name : '')
                    : p.name || '') : ''
        }));
        const baseById = Object.fromEntries(raid.map(p => [p.id, clone(p.at)]));
        const requiredPairs = Math.max((sequence.impales || []).length, sequence.initialSpines ? 1 : 0);
        const resolvedPairs = resolvePairs(fight, raid, baseById, requiredPairs);
        const missingRoles = [];
        if (!resolvedPairs.mt) missingRoles.push('No main tank is loaded.');
        if (requiredPairs && resolvedPairs.pairs.length < requiredPairs) missingRoles.push('This roster cannot demonstrate every rescue role.');
        const impales = (sequence.impales || []).map((event, i) => {
            const pair = resolvedPairs.pairs[i];
            return pair ? Object.assign({}, clone(event), pair) : null;
        }).filter(Boolean);
        const initialHolders = {};
        const initialPair = resolvedPairs.pairs[0];
        if (sequence.initialSpines && initialPair) initialHolders[initialPair.rescuer] = sequence.initialSpines;
        const throwHolder = (impales[0] && impales[0].rescuer) || (initialPair && initialPair.rescuer) || null;
        const needleTargets = raid.filter(p => p.id !== resolvedPairs.mt).slice(0, 3).map(p => p.id);
        let clustered = null;
        if (sequence.clusteredNeedle && needleTargets.length > 1) {
            const targetId = needleTargets[0], neighborId = needleTargets[1];
            const original = clone(baseById[neighborId]);
            const target = baseById[targetId];
            const shifted = { x: target.x + 4 * fight.yard, y: target.y + 4 * fight.yard * fight.aspect };
            baseById[neighborId] = shifted;
            clustered = { targetId, neighborId, original };
        }
        const prepared = Object.assign({}, sourceScene, {
            sequence, raid, cast: {}, baseById, bossActor: { id: 'boss', kind: 'boss', at: clone(fight.bossAt) },
            resolved: { mt: resolvedPairs.mt, impales, initialHolders, throwHolder, needleTargets, clustered }, missingRoles
        });
        if (sourceScene.id === 'cycle' && impales.length < 2) {
            prepared.caption = 'One rescue prepares a holder for this shield; prepare for the next shield after that item is spent.';
            prepared.jobs = sourceScene.jobs.map(([role, job]) => role === 'Holders'
                ? [role, 'Keep the collected spine for the call, then prepare for the next shield.'] : [role, job]);
        }
        return prepared;
    }

    function simulate(fight, scene, timeMs) {
        const t = clamp(Number(timeMs) || 0, 0, scene.duration);
        const pos = Object.fromEntries(Object.entries(scene.baseById).map(([id, p]) => [id, clone(p)]));
        const focus = {}, roles = {}, impaled = [], holders = {};
        Object.entries(scene.resolved.initialHolders).forEach(([id, count]) => { holders[id] = count; });
        const boss = clone(fight.bossAt);

        const clustered = scene.resolved.clustered;
        if (clustered && t >= 3500) pos[clustered.neighborId] = between(scene.baseById[clustered.neighborId], clustered.original, progress(t, 3500, 6000));

        scene.resolved.impales.forEach(e => {
            const victimHome = scene.baseById[e.victim], helperHome = scene.baseById[e.rescuer];
            if (t >= e.at && t < e.extractAt) { impaled.push(e.victim); focus[e.victim] = true; }
            if (t >= e.approachAt && t < e.homeAt) {
                const beside = near(fight, helperHome, victimHome, 1.5);
                const toVictim = progress(t, e.approachAt, e.extractAt);
                const home = progress(t, e.extractAt, e.homeAt);
                pos[e.rescuer] = t < e.extractAt ? between(helperHome, beside, toVictim) : between(beside, helperHome, home);
                focus[e.rescuer] = true;
                if (t >= e.extractAt) roles[e.rescuer] = 'Spine ready';
            }
            if (t >= e.extractAt) holders[e.rescuer] = (holders[e.rescuer] || 0) + 1;
        });

        const needles = [];
        (scene.sequence.needles || []).forEach(event => {
            if (t < event.at || t >= event.at + 1600) return;
            scene.resolved.needleTargets.forEach(targetId => {
                if (!pos[targetId]) return;
                const hitIds = scene.raid.filter(p => L.dist(fight, pos[p.id], pos[targetId]) <= 6).map(p => p.id);
                needles.push({ targetId, at: clone(pos[targetId]), radiusYards: 6, hitIds });
                hitIds.forEach(id => { focus[id] = true; roles[id] = roles[id] || (id === targetId ? 'Needle hit' : 'Splash'); });
            });
        });

        const shieldEvent = scene.sequence.shield;
        let shield = false, ready = false, projectile = null, burst = null, stage = 'normal', call = scene.call;
        const hp = Object.fromEntries(scene.raid.map(p => [p.id, 1]));
        if (shieldEvent && t >= shieldEvent.at) {
            const holder = scene.resolved.throwHolder;
            const acquiredByThrow = holder && ((scene.resolved.initialHolders[holder] || 0) > 0 || scene.resolved.impales.some(e => e.rescuer === holder && e.extractAt <= shieldEvent.throwAt));
            const hasUsableHolder = Boolean(holder && (scene.resolved.initialHolders[holder] || 0 || scene.resolved.impales.some(e => e.rescuer === holder && e.extractAt <= (shieldEvent.throwAt ?? Infinity))));
            const canBreak = Boolean(hasUsableHolder && shieldEvent.throwAt !== undefined && shieldEvent.hitAt !== undefined);
            ready = shieldEvent.readyAt !== undefined && t >= shieldEvent.readyAt && (!canBreak || t < shieldEvent.throwAt);
            shield = !canBreak || t < shieldEvent.hitAt;
            const healEnd = shieldEvent.readyAt === undefined ? shieldEvent.at : shieldEvent.readyAt;
            const starting = 0.68 + .32 * progress(t, shieldEvent.at, healEnd);
            scene.raid.forEach(p => { hp[p.id] = shield ? starting : 1; });
            if (holder && pos[holder] && shieldEvent.throwAt !== undefined && t >= shieldEvent.readyAt) {
                const close = inRange(fight, scene.baseById[holder], boss, 23);
                pos[holder] = between(scene.baseById[holder], close, progress(t, shieldEvent.readyAt, shieldEvent.throwAt));
                focus[holder] = true;
                if (t < shieldEvent.throwAt) roles[holder] = 'Move in';
                else if (t < shieldEvent.hitAt) roles[holder] = 'Throw spine';
            }
            if (canBreak && t >= shieldEvent.throwAt) delete holders[holder];
            if (canBreak && t >= shieldEvent.throwAt && t < shieldEvent.hitAt) projectile = { from: clone(pos[holder]), to: clone(boss), progress: progress(t, shieldEvent.throwAt, shieldEvent.hitAt) };
            if (canBreak && t >= shieldEvent.hitAt) {
                const recovery = progress(t, shieldEvent.hitAt, shieldEvent.recoverAt || shieldEvent.hitAt + 1000);
                scene.raid.forEach(p => { hp[p.id] = .55 + .45 * recovery; });
                burst = { hitAt: shieldEvent.hitAt, progress: clamp((t - shieldEvent.hitAt) / 1000, 0, 1), damage: 8500 };
            }
            const hasSpare = scene.resolved.impales.length > 1;
            const nextShield = hasSpare ? 'Keep the spare spine.' : 'Prepare for the next shield.';
            if (canBreak && shieldEvent.recoverAt !== undefined && t >= shieldEvent.recoverAt) {
                stage = 'normal'; ready = false; call = 'Spread again. ' + nextShield;
            } else if (!hasUsableHolder && t >= (shieldEvent.readyAt || shieldEvent.at)) {
                stage = 'shield'; call = 'No spine holder in this roster. Keep healing.';
            } else if (canBreak && t >= shieldEvent.hitAt && t < shieldEvent.hitAt + 1000) {
                stage = 'burst'; call = 'Raidwide hit. Heal everyone.';
            } else if (canBreak && t >= shieldEvent.hitAt && t < (shieldEvent.recoverAt || shieldEvent.hitAt + 1000)) {
                stage = 'recover'; call = 'Spread again. ' + nextShield;
            } else if (canBreak && t >= shieldEvent.throwAt && t < shieldEvent.hitAt) {
                stage = 'throw'; call = 'One holder throws. ' + (hasSpare ? 'Save the spare.' : 'Prepare for the next shield.');
            } else if (ready) {
                stage = 'ready'; call = 'Raid ready. Wait for the call.';
            } else if (shield) {
                stage = 'shield'; call = 'Shield up. Top the raid. Hold your spine.';
            }
        }
        Object.keys(holders).forEach(id => { if (holders[id] > 0) { focus[id] = true; roles[id] = roles[id] || 'Spine ready'; } });
        if (['shield', 'ready', 'burst', 'recover'].includes(stage)) scene.raid.forEach(p => { focus[p.id] = true; });
        return { pos, boss, trail: null, hp, roles, focus, impaled, holders, needles, shield, ready, projectile, burst, call, stage, timeMs: t };
    }
    return { prepareScene, simulate };
}));
