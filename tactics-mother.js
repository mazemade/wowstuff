(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsMother = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const copy = p => ({ x: p.x, y: p.y });
    const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * clamp(t) , y: a.y + (b.y - a.y) * clamp(t) });
    const inside = (f, p) => ({ x: clamp(p.x, f.arena.x0, f.arena.x1), y: clamp(p.y, f.arena.y0, f.arena.y1) });
    const distance = (f, a, b) => L.dist(f, a, b);
    function prepareScene(fight, source, assigned) {
        const sc = JSON.parse(JSON.stringify(source)), groups = { tank: [], melee: [], healer: [], ranged: [] };
        assigned.forEach(p => groups[p.kind].push(p)); const backline = groups.healer.concat(groups.ranged); sc.tanks = groups.tank.map(p => p.id); sc.baseById = {}; sc.missingRoles = [];
        if (sc.tanks.length < 3) sc.missingRoles.push('Tank stack incomplete: ' + sc.tanks.length + '/3 tanks loaded for Saber Lash.');
        if (!groups.healer.length) sc.missingRoles.push('No healer loaded: recovery is not demonstrated.');
        sc.raid = assigned.map(p => {
            const i = groups[p.kind].indexOf(p); let at;
            if (p.kind === 'tank') at = { x: .29, y: .65 };
            else if (p.kind === 'melee') at = { x: .365 + (i % 3) * .013, y: .635 + Math.floor(i / 3) * .026 };
            else { const backIndex = backline.indexOf(p), upper = backIndex % 2 === 0, slot = Math.floor(backIndex / 2); at = { x: .435 + (slot % 3) * .014, y: (upper ? .37 : .64) + Math.floor(slot / 3) * .027 }; }
            if (sc.id === 'door') at = p.kind === 'tank' ? { x: .44, y: .77 } : p.kind === 'melee' ? { x: .51 + (i % 3) * .012, y: .77 + Math.floor(i / 3) * .022 } : { x: .64 + (backline.indexOf(p) % 5) * .012, y: .89 + Math.floor(backline.indexOf(p) / 5) * .025 };
            at = inside(fight, at); sc.baseById[p.id] = at;
            return { ...p, at: copy(at), label: sc.id === 'positioning' || sc.id === 'door' ? (p.kind === 'tank' ? 'T' + (i + 1) + (p.name ? ' · ' + p.name : '') : p.name || '') : '' };
        });
        sc.bossAt = sc.id === 'door' ? { x: .48, y: .77 } : copy(fight.bossAt); sc.bossActor = { id: 'boss', at: copy(sc.bossAt), scale: .85 };
        // Pick a reproducible example across roles, retaining only real roster members.
        const selected = ['melee', 'ranged', 'healer'].map(kind => sc.raid.find(p => p.kind === kind)).filter(Boolean);
        sc.raid.filter(p => p.kind !== 'tank').forEach(p => { if (selected.length < 3 && !selected.includes(p)) selected.push(p); });
        sc.fatalTargets = selected.map(p => p.id);
        sc.hasHealer = groups.healer.length > 0;
        sc.hasDamage = groups.melee.length + groups.ranged.length > 0;
        return sc;
    }
    function fatalFormation(fight, sc, t, startSeparated = false) {
        const pos = Object.fromEntries(Object.entries(sc.baseById).map(([id, p]) => [id, copy(p)]));
        const ids = sc.fatalTargets, origin = { x: .245, y: .485 }, ends = [{ x: .135, y: .485 }, { x: .34, y: .39 }, { x: .34, y: .56 }];
        if (!ids.length) return { pos, ids, separated: false, distances: [] };
        const out = startSeparated ? 1 : clamp((t - 1200) / 4500), back = startSeparated ? clamp((t - 1200) / 2500) : 0;
        const returnTo = {};
        ids.forEach((id, i) => {
            const there = mix(origin, ends[i], out), home = sc.baseById[id];
            // The west runner crosses the empty corridor before approaching from behind.
            // A direct line home would cut through Mother's frontal tank area.
            if (startSeparated && i === 0) {
                const corner = { x: .415, y: .485 };
                pos[id] = back < .6 ? mix(there, corner, back / .6) : mix(corner, home, (back - .6) / .4);
                returnTo[id] = back < .6 ? corner : home;
            } else { pos[id] = back ? mix(there, home, back) : there; returnTo[id] = home; }
        });
        const distances = ids.flatMap((id, i) => ids.slice(i + 1).map(other => ({ ids: [id, other], yards: distance(fight, pos[id], pos[other]) })));
        const clearAtExit = ids.length === 3 && ids.flatMap((id, i) => ids.slice(i + 1).map(other => distance(fight, ends[i], ends[ids.indexOf(other)]))).every(yards => yards >= 25);
        const clearNow = distances.length === 3 && distances.every(d => d.yards >= 25);
        const targetClear = Object.fromEntries(ids.map(id => [id, startSeparated ? clearAtExit : ids.length === 3 && distances.filter(d => d.ids.includes(id)).every(d => d.yards >= 25)]));
        return { pos, ids, separated: startSeparated ? clearAtExit : clearNow, targetClear, returning: back > 0, returnTo, distances };
    }
    function simulate(fight, sc, timeMs) {
        const t = clamp(Number(timeMs) || 0, 0, sc.duration), bossAt = sc.bossAt || fight.bossAt, cycleFatalTime = t >= 8000 && t < 13700 ? t - 8000 : null, cycleReturnTime = t >= 13700 && t < 17400 ? t - 13700 : null, fatal = sc.id === 'attraction' ? fatalFormation(fight, sc, t) : sc.id === 'return' ? fatalFormation(fight, sc, t, true) : cycleFatalTime != null ? fatalFormation(fight, sc, cycleFatalTime) : cycleReturnTime != null ? fatalFormation(fight, sc, cycleReturnTime, true) : null;
        const pos = fatal ? fatal.pos : Object.fromEntries(Object.entries(sc.baseById).map(([id, p]) => [id, copy(p)]));
        const frame = { pos, boss: copy(bossAt), bossTarget: sc.tanks[0] || null, hp: {}, roles: {}, focus: {}, timeMs: t, phase: 1, stage: sc.id === 'cycle' ? 'cycle' : sc.id === 'return' ? (fatal?.separated ? 'return' : 'attraction') : sc.id === 'attraction' ? 'attraction' : sc.id === 'saber' ? 'saber' : sc.id === 'beams' ? 'beams' : sc.id === 'finish' ? 'finish' : sc.id === 'positioning' || sc.id === 'door' ? 'positioning' : 'ready', call: sc.call, routes: [], fatal: null, saber: null, shriek: null, beam: null, instructionRows: sc.jobs };
        sc.raid.forEach(p => { frame.hp[p.id] = 1; });
        sc.tanks.forEach(id => { frame.roles[id] = 'Saber stack'; if (!['overview', 'positioning', 'door'].includes(sc.id)) frame.focus[id] = true; });
        if (sc.id === 'saber' || sc.id === 'cycle') {
            const lashTime = t % 5000;
            frame.saber = { active: lashTime >= 1000 && lashTime < 2200, targetIds: sc.tanks.slice(0, 3) };
            if (lashTime >= 1000) sc.tanks.slice(0, 3).forEach(id => { frame.hp[id] = sc.hasHealer ? .65 + .35 * clamp((lashTime - 1200) / 2500) : .65; });
        }
        if (fatal) {
            const returning = (sc.id === 'return' || cycleReturnTime != null) && fatal.separated;
            frame.fatal = { targetIds: fatal.ids, active: !fatal.separated, separated: fatal.separated, targetClear: fatal.targetClear, distances: fatal.distances, teleportAt: { x: .245, y: .485 } };
            fatal.ids.forEach(id => { frame.focus[id] = true; frame.roles[id] = returning ? '' : fatal.targetClear?.[id] ? 'Clear' : 'Split now'; frame.hp[id] = sc.hasHealer && returning ? .72 + .28 * clamp((sc.id === 'return' ? t : cycleReturnTime) / 3700) : .72; });
            if (sc.id !== 'return' && !returning && (cycleFatalTime ?? t) < 5700) fatal.ids.forEach((id, i) => frame.routes.push({ from: { x: .245, y: .485 }, to: [{ x: .135, y: .485 }, { x: .34, y: .39 }, { x: .34, y: .56 }][i], targetId: id }));
            if (returning && (sc.id === 'return' ? t : cycleReturnTime) < 3700) fatal.ids.forEach(id => frame.routes.push({ from: pos[id], to: fatal.returnTo[id], targetId: id }));
            frame.call = returning ? 'All three pairs clear: return safely.' : fatal.separated ? (sc.id === 'attraction' ? 'All three pairs are clear. Hold this split for the return decision.' : 'All three pairs clear: return safely.') : 'Split until every pair is 25 yards apart.';
        }
        if (sc.id === 'beams' || (sc.id === 'cycle' && t >= 19000 && t < 29000)) { const target = sc.raid.find(p => p.kind === 'ranged') || sc.raid.find(p => p.kind === 'healer'); const beat = t % 2500; frame.beam = target ? { targetId: target.id, kind: ['Sinful · direct', 'Sinister · knockup', 'Vile · DoT', 'Wicked · mana'][Math.floor((sc.id === 'cycle' ? t - 19000 : t) / 2500) % 4] } : null; if (target) { frame.focus[target.id] = true; frame.hp[target.id] = sc.hasHealer ? .68 + .32 * clamp(beat / 2200) : .68; } }
        if (sc.id === 'beams' || sc.id === 'positioning' || sc.id === 'cycle' || sc.id === 'door') frame.shriek = { radiusYards: 18, at: copy(bossAt), affectedIds: sc.raid.filter(p => p.kind !== 'tank' && distance(fight, pos[p.id], bossAt) < 18).map(p => p.id) };
        if (sc.id === 'finish' || (sc.id === 'cycle' && t >= 31000)) { frame.stage = 'finish'; frame.bossHp = .1 * clamp(1 - Math.max(0, t - (sc.id === 'cycle' ? 31000 : 0)) / 9000); frame.call = '10% enrage: burn while tanks stay stacked and the backline stays out.'; }
        if (sc.id === 'cycle' && t >= 39000 && sc.hasDamage && sc.tanks.length >= 3 && sc.hasHealer) { frame.stage = 'complete'; frame.call = 'Mother Shahraz defeated.'; frame.bossHp = 0; frame.bossVisible = false; frame.instructionRows = []; frame.roles = {}; frame.focus = {}; frame.saber = null; frame.shriek = null; frame.beam = null; frame.fatal = null; frame.routes = []; }
        if (frame.stage === 'finish' && (!sc.hasDamage || sc.tanks.length < 3 || !sc.hasHealer)) frame.bossHp = Math.max(.01, frame.bossHp);
        return frame;
    }
    function copyText(fight, sc, frame) { return [fight.name + ' — illustrative assignments', ...sc.raid.filter(p => p.name).map(p => p.name + ' — ' + (frame.roles[p.id] || p.kind)), ...sc.missingRoles, 'Teleport location and timing are illustrative; Fatal Attraction clears only at actual 25-yard separation.'].join('\n'); }
    function resolveExplanation(explanation, sc) {
        if (!explanation) return explanation;
        const missing = (title, detail) => ({ ...explanation, title, detail });
        const cycle = sc.id === 'cycle', id = explanation.id;
        const fatalBeat = ['attraction', 'return'].includes(sc.id) || cycle && ['teleport', 'clear'].includes(id);
        if (fatalBeat && sc.fatalTargets.length < 3)
            return missing('Fatal Attraction targets missing.', 'This example needs three non-tanks; import the rest of the raid to show the split.');
        if (['saber', 'positioning', 'door'].includes(sc.id) || cycle && id === 'positions') {
            if (sc.tanks.length < 3) return missing('Saber Lash tank coverage is missing.', sc.tanks.length + '/3 tanks loaded. Assign the missing tanks before the pull.');
        }
        if ((sc.id === 'finish' || cycle && ['enrage', 'complete'].includes(id)) && !sc.hasDamage)
            return missing('Damage coverage is missing.', 'No melee or ranged player is loaded, so the finish is not demonstrated.');
        if (cycle && id === 'complete' && (sc.tanks.length < 3 || !sc.hasHealer))
            return missing('Mother Shahraz is not defeated.', 'Tank or healing coverage is missing. Complete the raid assignments first.');
        if ((['return', 'beams', 'saber'].includes(sc.id) || cycle && id === 'beam') && !sc.hasHealer)
            return missing('Healing coverage is missing.', 'No healer is loaded. Recovery cannot be demonstrated for this roster.');
        return explanation;
    }
    return { prepareScene, simulate, copyText, resolveExplanation };
}));
