(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsBloodboil = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const GROUPS = ['G1', 'G2', 'G3'];
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const copy = p => ({ x: p.x, y: p.y });
    const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * clamp(k, 0, 1), y: a.y + (b.y - a.y) * clamp(k, 0, 1) });
    const inside = (fight, p) => ({ x: clamp(p.x, fight.arena.x0 + .02, fight.arena.x1 - .02), y: clamp(p.y, fight.arena.y0 + .04, fight.arena.y1 - .04) });
    const basePositions = sc => Object.fromEntries(Object.entries(sc.baseById).map(([id, p]) => [id, copy(p)]));
    const groupForWave = index => GROUPS[index % 3];
    const soakKey = player => player.name ? 'name:' + player.name : 'example:' + player.id;
    function soakAssignment(assigned, selectedKeys = []) {
        const back = assigned.filter(p => p.kind === 'healer' || p.kind === 'ranged');
        const wanted = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
        const melee = assigned.filter(p => p.kind === 'melee' && wanted.has(soakKey(p))).slice(0, Math.max(0, 15 - back.length));
        return { players: back.slice(0, 15).concat(melee), melee, selectedKeys: melee.map(soakKey), vacancies: Math.max(0, 15 - back.length - melee.length) };
    }

    function prepareScene(fight, source, assigned, options = {}) {
        const sc = JSON.parse(JSON.stringify(source));
        const tanks = assigned.filter(p => p.kind === 'tank'), melee = assigned.filter(p => p.kind === 'melee');
        const back = assigned.filter(p => p.kind === 'healer' || p.kind === 'ranged');
        const soakers = soakAssignment(assigned, options.meleeSoakers).players;
        sc.baseById = {}; sc.missingRoles = []; sc.groups = GROUPS.slice();
        sc.groupMembers = Object.fromEntries(GROUPS.map((g, i) => [g, soakers.slice(i * 5, i * 5 + 5).map(p => p.id)]));
        sc.tanks = tanks.map(p => p.id); sc.melee = melee.map(p => p.id); sc.back = back.map(p => p.id);
        sc.soakers = soakers.map(p => p.id);
        if (soakers.length < 15) sc.missingRoles.push('Soak groups incomplete: ' + soakers.length + '/15 soakers assigned. Select melee players in Bloodboil soak groups to fill available places.');
        if (!assigned.some(p => p.kind === 'healer')) sc.missingRoles.push('No healer loaded: recovery is not demonstrated.');
        if (tanks.length < 3) sc.missingRoles.push('Tank team incomplete: ' + tanks.length + '/3 tanks loaded.');
        sc.raid = assigned.map(p => {
            const pool = p.kind === 'tank' ? tanks : p.kind === 'melee' ? melee : back, i = pool.indexOf(p);
            let at;
            if (p.kind === 'tank') at = { x: .73 + Math.floor(i / 3) * .035, y: .38 + (i % 3) * .115 };
            else if (p.kind === 'melee') {
                const angle = (105 + (melee.length === 1 ? .5 : i / (melee.length - 1)) * 150) * Math.PI / 180;
                at = { x: fight.bossAt.x + Math.cos(angle) * .070, y: fight.bossAt.y + Math.sin(angle) * .070 * fight.aspect };
            } else at = { x: .43 + (i % 5) * .034, y: [.30, .415, .67, .755][Math.min(3, Math.floor(i / 5))] };
            at = inside(fight, at); sc.baseById[p.id] = at;
            const group = GROUPS.find(g => sc.groupMembers[g].includes(p.id)) || null;
            return { ...p, group, label: sc.id === 'positioning' ?
                (p.kind === 'tank' ? 'T' + (i + 1) + (p.name ? ' · ' + p.name : '') : p.name ? (group ? group + ' · ' : '') + p.name : group || '') : '' };
        });
        sc.bossActor = { id: 'boss', kind: 'boss', at: copy(fight.bossAt), scale: .82 };
        if (soakers.some(p => p.kind === 'melee')) {
            sc.jobs = sc.jobs.map(([role, job]) => [role, sc.id === 'positioning' && role === 'Melee'
                ? 'Selected soakers move out for their group’s turn, then return behind the boss.' : job]);
        }
        return sc;
    }
    function setSoakPositions(fight, sc, pos, group) {
        (sc.groupMembers[group] || []).forEach((id, i) => { pos[id] = inside(fight, { x: .295 + (i % 3) * .034, y: .405 + Math.floor(i / 3) * .105 }); });
    }
    function farthest(fight, sc, pos, count = 5) {
        return sc.raid.slice().sort((a, b) => L.dist(fight, pos[b.id], fight.bossAt) - L.dist(fight, pos[a.id], fight.bossAt) || a.slotIndex - b.slotIndex).slice(0, count).map(p => p.id);
    }
    // The source timeline and the event-recipient calculation use the same positions.
    // A hit holds for one second, followed by a two-second group exchange.
    function soakFormation(fight, sc, t) {
        const pos = basePositions(sc), waves = sc.sequence.waves || [], routes = [];
        if (!waves.length) {
            if (sc.id === 'positioning') setSoakPositions(fight, sc, pos, 'G1');
            return { pos, group: sc.id === 'positioning' ? 'G1' : null, routes };
        }
        let index = waves.findIndex(at => t < at + 1000);
        if (index < 0) index = waves.length;
        const group = index < waves.length || waves.length === 1 ? groupForWave(index) : null;
        const previousIndex = index - 1, start = previousIndex >= 0 ? waves[previousIndex] + 1000 : -Infinity;
        const destination = basePositions(sc); setSoakPositions(fight, sc, destination, group);
        if (previousIndex >= 0 && t < start + 2000) {
            const origin = basePositions(sc); setSoakPositions(fight, sc, origin, groupForWave(previousIndex));
            sc.raid.forEach(p => {
                pos[p.id] = mix(origin[p.id], destination[p.id], (t - start) / 2000);
                if (L.dist(fight, origin[p.id], destination[p.id]) > 1) routes.push({ fromId: p.id, from: copy(pos[p.id]), to: destination[p.id] });
            });
        } else Object.assign(pos, destination);
        return { pos, group, routes };
    }
    function rageFormation(fight, sc, kind, elapsed, startPos) {
        const target = sc.raid.find(p => p.kind === kind) || (kind === 'ranged' ? sc.raid.find(p => p.kind === 'healer') : null);
        const pos = Object.fromEntries(Object.entries(startPos).map(([id, p]) => [id, copy(p)])), routes = [];
        if (!target) return { pos, boss: copy(fight.bossAt), target: null, routes };
        const travel = clamp(elapsed / 4000, 0, 1), targetAt = kind === 'melee' ? { x: .73, y: .49 } : { x: .43, y: .49 };
        if (kind === 'melee') {
            // Cross around the boss's top edge instead of walking through his model.
            const corner = { x: .72, y: .27 };
            pos[target.id] = travel < .5 ? mix(startPos[target.id], corner, travel * 2) : mix(corner, targetAt, (travel - .5) * 2);
        } else pos[target.id] = mix(startPos[target.id], targetAt, travel);
        const bossEnd = { x: targetAt.x + (kind === 'melee' ? -1 : 1) * .04, y: targetAt.y };
        const boss = mix(fight.bossAt, bossEnd, kind === 'melee' ? clamp((travel - .5) * 2, 0, 1) : travel);
        routes.push({ fromId: target.id, from: copy(pos[target.id]), to: kind === 'melee' && travel < .5 ? { x: .72, y: .27 } : targetAt });
        const frontTeam = sc.raid.filter(p => p.id !== target.id && ['tank', 'melee'].includes(p.kind));
        const backTeam = sc.raid.filter(p => p.id !== target.id && !frontTeam.includes(p));
        [...frontTeam, ...backTeam].forEach(p => {
            const near = frontTeam.includes(p), index = (near ? frontTeam : backTeam).indexOf(p);
            let end;
            if (near) end = { x: (kind === 'ranged' ? .55 : .56) + (index % 3) * .042, y: .365 + Math.floor(index / 3) * .082 };
            else { const columns = Math.ceil(backTeam.length / 2); end = { x: .41 + (index % columns) * (.29 / Math.max(1, columns - 1)), y: index < columns ? .285 : .735 }; }
            end = inside(fight, end); pos[p.id] = mix(startPos[p.id], end, travel);
            if (travel < 1) routes.push({ fromId: p.id, from: copy(pos[p.id]), to: end });
        });
        return { pos, boss, target, routes };
    }
    function simulate(fight, sc, timeMs) {
        const t = clamp(Number(timeMs) || 0, 0, sc.duration), seq = sc.sequence || {}, waves = seq.waves || [];
        const formation = soakFormation(fight, sc, t), hasHealer = sc.raid.some(p => p.kind === 'healer');
        const rageAt = seq.rageAt ?? (seq.rageKind ? 0 : Infinity), recoveryAt = seq.recoveryAt ?? Infinity;
        const rageActive = t >= rageAt && t < rageAt + 30000, rageKind = seq.rageKind || 'ranged';
        const frame = { pos: formation.pos, boss: copy(fight.bossAt), bossTarget: sc.tanks[0] || null,
            hp: {}, roles: {}, focus: {}, stage: waves.length ? 'rotation' : 'ready', timeMs: t, call: sc.call, phase: 1,
            groupMembers: sc.groupMembers, groupState: {}, soakGroup: formation.group, appliedWave: null, bloodboil: [],
            rage: { targetId: null, active: false, kind: null, remainingSeconds: 0 }, tankDebuffs: {}, frontal: null, routes: formation.routes, healLinks: [], geyser: null };
        sc.raid.forEach(p => { frame.hp[p.id] = 1; });
        GROUPS.forEach(g => { frame.groupState[g] = g === frame.soakGroup ? 'soak' : 'wait'; });
        waves.forEach((at, index) => {
            if (t < at) return;
            const ids = farthest(fight, sc, soakFormation(fight, sc, at).pos);
            if (!ids.length) return;
            if (!hasHealer) ids.forEach(id => { frame.hp[id] = Math.min(frame.hp[id], clamp(.9 - Math.min(t - at, 24000) / 45000, .2, .9)); });
            if (t >= at + 24000) return;
            frame.bloodboil.push({ wave: index + 1, at, group: groupForWave(index), targetIds: ids, expiresAt: at + 24000, damagePerSecond: 600 });
            ids.forEach(id => { if (hasHealer) frame.hp[id] = .84; frame.focus[id] = true; });
        });
        frame.appliedWave = waves.filter(at => at <= t).length || null;
        // Wound examples record actual holders. No stacks are added during Fel Rage.
        const tankAt = at => sc.tanks[at < 25000 ? 0 : at < 40000 ? 1 : 2] || sc.tanks[0];
        const addWound = (id, at, stacks = 1) => {
            if (!id) return;
            const previous = frame.tankDebuffs[id];
            frame.tankDebuffs[id] = { acidicWound: true, stacks: (previous?.stacks || 0) + stacks, lastApplied: at };
        };
        if (sc.id === 'cycle') {
            for (let at = 4000; at <= Math.min(t, 54000); at += 4000) addWound(tankAt(at), at);
            frame.bossTarget = t < 55000 ? tankAt(t) || null : sc.tanks[0] || null;
        } else if (sc.id === 'tanks') {
            addWound(sc.tanks[0], 0, 8);
            for (let at = 4000; at <= t; at += 4000) addWound(sc.tanks[at < 9000 ? 0 : at < 11000 ? 1 : at < 19000 ? 2 : at < 22000 ? 1 : 2] || sc.tanks[0], at);
        } else if (sc.id.startsWith('rage') || sc.id === 'recovery') sc.tanks.slice(0, 3).forEach((id, i) => addWound(id, 0, [6, 9, 4][i]));
        Object.keys(frame.tankDebuffs).forEach(id => {
            const elapsed = Math.min(t, frame.tankDebuffs[id].lastApplied + 60000), expired = t - frame.tankDebuffs[id].lastApplied >= 60000;
            if (!hasHealer || !expired) frame.hp[id] = Math.min(frame.hp[id], hasHealer ? .83 : clamp(.8 - elapsed / 80000, .15, .8));
            if (expired) delete frame.tankDebuffs[id]; else frame.focus[id] = true;
        });
        if (rageActive) {
            const startPos = Number.isFinite(rageAt) && waves.length ? soakFormation(fight, sc, rageAt).pos : basePositions(sc);
            const rage = rageFormation(fight, sc, rageKind, t - rageAt, startPos);
            frame.pos = rage.pos; frame.boss = rage.boss; frame.bossTarget = rage.target?.id || null; frame.routes = rage.routes;
            frame.phase = 2; frame.stage = 'rage'; frame.soakGroup = null;
            frame.rage = { targetId: rage.target?.id || null, active: true, kind: rageKind, remainingSeconds: Math.ceil((rageAt + 30000 - t) / 1000) };
            if (rage.target) {
                const id = rage.target.id;
                frame.focus[id] = true; frame.roles[id] = 'Fel Rage';
                frame.hp[id] = hasHealer ? .76 + .08 * Math.sin((t - rageAt) / 650) : clamp(.8 - (t - rageAt) / 38000, .12, .8);
                frame.frontal = { from: copy(frame.boss), to: copy(frame.pos[id]), yards: 12 };
                if (t - rageAt < 1500) frame.geyser = { at: copy(startPos[id]), radiusYards: 5 };
                const healers = sc.raid.filter(p => p.kind === 'healer');
                healers.forEach((healer, index) => {
                    if (index === 0 && healers.length > 1 && Object.keys(frame.tankDebuffs).length) {
                        Object.keys(frame.tankDebuffs).forEach(tank => frame.healLinks.push({ fromId: healer.id, toId: tank }));
                        frame.roles[healer.id] = 'Tank coverage'; frame.focus[healer.id] = true;
                    } else frame.healLinks.push({ fromId: healer.id, toId: id });
                });
            }
        } else if (t >= recoveryAt || (Number.isFinite(rageAt) && t >= rageAt + 30000)) {
            const start = Number.isFinite(recoveryAt) ? recoveryAt : rageAt + 30000;
            const rage = rageFormation(fight, sc, rageKind, 30000, basePositions(sc));
            if (!hasHealer && rage.target) frame.hp[rage.target.id] = Math.min(frame.hp[rage.target.id], .12);
            const restore = clamp((t - start - 5000) / 4000, 0, 1), finalPos = basePositions(sc);
            if (t >= start + 9000) setSoakPositions(fight, sc, finalPos, 'G1');
            frame.pos = Object.fromEntries(sc.raid.map(p => [p.id, mix(rage.pos[p.id], finalPos[p.id], restore)]));
            frame.boss = mix(rage.boss, fight.bossAt, restore); frame.bossTarget = sc.tanks[0] || null;
            frame.stage = 'recovery'; frame.soakGroup = t >= start + 9000 ? 'G1' : null;
            sc.tanks.forEach((id, i) => { frame.roles[id] = i === 0 ? 'Take control' : 'Threat backup'; frame.focus[id] = true; });
            frame.call = t < start + 9000 ? 'Rage ends. Tanks take control; raid waits.' : 'Tank control. G1 out; resume the rotation.';
        }
        if (sc.id === 'tanks') {
            frame.stage = 'tanks';
            const holderIndex = t < 9000 ? 0 : t < 11000 ? 1 : t < 19000 ? 2 : t < 22000 ? 1 : 2;
            frame.bossTarget = sc.tanks[holderIndex] || sc.tanks[0] || null;
            sc.tanks.forEach((id, i) => {
                frame.focus[id] = true;
                frame.roles[id] = id === frame.bossTarget ? 'Current tank' : t >= 11000 && t < 19000 && i === 1 ? 'Bewildered' : t >= 22000 && i === 1 ? 'Ejected' : i === 0 ? 'Ease off' : 'Build threat';
            });
            if (t >= 22000 && sc.tanks[1]) frame.pos[sc.tanks[1]] = mix(sc.baseById[sc.tanks[1]], { x: .79, y: .70 }, clamp((t - 22000) / 1000, 0, 1));
        }
        if (sc.id === 'breath') {
            frame.stage = 'breath';
            const victim = sc.raid.find(p => p.kind === 'melee');
            if (victim && t >= 2500 && t < 5000) {
                frame.bossTarget = victim.id;
                frame.focus[victim.id] = true; frame.roles[victim.id] = 'Breath target'; frame.hp[victim.id] = .75;
                const target = frame.pos[victim.id], direction = Math.atan2((target.y - frame.boss.y) / fight.aspect, target.x - frame.boss.x);
                sc.raid.filter(p => p.id !== victim.id).forEach(p => {
                    const from = sc.baseById[p.id], angle = Math.atan2((from.y - frame.boss.y) / fight.aspect, from.x - frame.boss.x);
                    const difference = Math.abs(Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction)));
                    if (difference >= .48 || L.dist(fight, from, frame.boss) > 16) return;
                    const to = { x: from.x - .035, y: from.y + .10 };
                    frame.pos[p.id] = mix(from, to, (t - 2500) / 1000);
                    frame.focus[p.id] = true; frame.roles[p.id] = 'Clear breath';
                    if (t < 3500) frame.routes.push({ fromId: p.id, from: copy(frame.pos[p.id]), to });
                });
            }
            const to = frame.pos[frame.bossTarget] || { x: .8, y: .49 };
            frame.frontal = { from: copy(frame.boss), to: copy(to), yards: 16 };
        }
        if (sc.id === 'cycle') frame.instructionRows = frame.rage.active ?
            [['Rage target', 'Hold position after moving clear; use defenses.'], ['Healers', 'Focus the target and keep wounded tanks covered.'], ['Raid', 'Damage from behind. Clear the target’s route.']] : frame.stage === 'recovery' ?
            [['Tanks', 'Take control, then return the boss to position.'], ['Healers', 'Keep remaining Acidic Wound damage covered.'], ['Raid', 'Resume only on the control call; G1 prepares next.']] : sc.jobs;
        GROUPS.forEach(g => { frame.groupState[g] = g === frame.soakGroup ? 'soak' : 'wait'; });
        return frame;
    }
    function copyText(fight, sc, frame) {
        const lines = [fight.name + ' — illustrative assignments'];
        GROUPS.forEach(g => lines.push(g + ': ' + (sc.groupMembers[g].map(id => sc.raid.find(p => p.id === id).name || id).join(', ') || 'missing') + ' (' + sc.groupMembers[g].length + '/5)'));
        sc.raid.filter(p => p.name).forEach(p => lines.push(p.name + ' — ' + (frame.rage.active ?
            (p.id === frame.rage.targetId ? 'Fel Rage target: survive and use defenses' : p.kind === 'healer' ? 'Heal rage and retain wounded-tank coverage' : 'Clear the frontal and target route') :
            frame.stage === 'recovery' ? (p.kind === 'tank' ? 'Establish threat control' : 'Resume on the tank-control call') : p.group ? (p.group === frame.soakGroup ? 'Current soak group' : p.kind === 'melee' ? 'Melee soaker: return behind the boss between turns' : 'Wait closer to the boss') : p.kind === 'tank' ? 'Tank threat team' : p.kind === 'melee' ? 'Melee behind the boss' : 'Support: stay closer than the soak group')));
        lines.push(...sc.missingRoles, 'Group assignments, positions, health and movement timing are examples.');
        return lines.join('\n');
    }
    function resolveExplanation(explanation, sc) {
        if (!explanation) return explanation;
        const absent = (title, detail) => ({ ...explanation, title, detail });
        const rageStep = sc.id.startsWith('rage') || (sc.id === 'cycle' && explanation.startMs >= 55000 && explanation.startMs < 85000);
        const kind = sc.sequence.rageKind || 'ranged';
        if (rageStep && !sc.raid.some(p => p.kind === kind || (kind === 'ranged' && p.kind === 'healer')))
            return absent('Fel Rage target missing.', 'No ' + (kind === 'melee' ? 'melee' : 'ranged or healer') + ' target is loaded for this positioning example.');
        if (rageStep && !sc.raid.some(p => p.kind === 'healer')) return absent('Healing coverage missing.', 'The loaded target can be shown, but no healer is available to demonstrate Fel Rage recovery.');
        if ((sc.id === 'tanks' || sc.id === 'recovery' || (sc.id === 'cycle' && explanation.startMs >= 85000)) && !sc.tanks.length)
            return absent('Tank control cannot be demonstrated.', 'No tank is loaded. Add the tank team before using the pickup example.');
        if (sc.id === 'tanks' && sc.tanks.length < 3 && explanation.startMs >= 5000)
            return absent('Tank handoff coverage missing.', 'This example needs three tanks for the threat handoff, Bewildering Strike and Eject backup.');
        if (sc.id === 'rotation' || (sc.id === 'cycle' && explanation.startMs < 55000)) {
            if (sc.soakers.length < 15) return absent('Soak group coverage missing.', 'Only ' + sc.soakers.length + '/15 soakers are assigned. Select melee players in Bloodboil soak groups to fill the gaps. Bloodboil still picks the farthest five available raiders.');
        }
        return explanation;
    }
    return { prepareScene, simulate, copyText, farthest, resolveExplanation, soakKey, soakAssignment };
}));
