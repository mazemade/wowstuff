(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsIllidan = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const copy = p => ({ x: p.x, y: p.y });
    const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * clamp(k), y: a.y + (b.y - a.y) * clamp(k) });
    const cls = p => String(p.class || '').trim().toUpperCase();
    const GROUND = { x: .5, y: .53 };
    const DEMON = { x: .5, y: .64 };
    const SHADOW = { x: .34, y: .49 };
    const DROP = { x: .30, y: .25 };
    const GLAIVES = [{ id: 'left', at: { x: .405, y: .36 } }, { id: 'right', at: { x: .595, y: .36 } }];
    const GROUPS = [{ x: .50, y: .20 }, { x: .46, y: .37 }, { x: .56, y: .37 }];
    const CYCLE = [[0, 'ground'], [8000, 'flames'], [20000, 'landing'], [28000, 'demon'], [40000, 'maiev']];
    const inside = (fight, p) => ({ x: clamp(p.x, fight.arena.x0 + .015, fight.arena.x1 - .015), y: clamp(p.y, fight.arena.y0 + .015, fight.arena.y1 - .015) });
    const tankAt = boss => ({ x: boss.x, y: boss.y + .054 });
    const role = (f, id, label) => { if (id) { f.roles[id] = label; f.focus[id] = true; } };
    const hasDamage = sc => sc.damage.length > 0;
    function name(sc, id) {
        const p = sc.raid.find(p => p.id === id);
        return p ? p.name || ({ tank: 'Tank', healer: 'Healer', melee: 'Melee', ranged: 'Ranged' }[p.kind] + ' ' + (sc.raid.filter(q => q.kind === p.kind).indexOf(p) + 1)) : 'Missing';
    }
    function cycleAt(time) {
        const row = CYCLE.filter(([start]) => start <= time).at(-1);
        return { id: row[1], local: time - row[0] };
    }
    function groundPositions(fight, sc, boss = GROUND) {
        const pos = {}, melee = sc.raid.filter(p => p.kind === 'melee');
        if (sc.mainTank) pos[sc.mainTank] = tankAt(boss);
        // Seven melee slots on a rear arc retain five-yard spacing in later ground phases.
        melee.forEach((p, i) => {
            const angle = (195 + (i % 7) * 25) * Math.PI / 180, radius = 13 + Math.floor(i / 7) * 6;
            pos[p.id] = { x: boss.x + Math.cos(angle) * radius * fight.yard, y: boss.y + Math.sin(angle) * radius * fight.yard * fight.aspect };
        });
        const rest = sc.raid.filter(p => p.id !== sc.mainTank && p.kind !== 'melee');
        // A regular spread also keeps the ordinary P3 and P5 formation honest.
        rest.forEach((p, i) => { pos[p.id] = { x: .37 + (i % 5) * .065, y: .16 + Math.floor(i / 5) * .065 }; });
        return Object.fromEntries(Object.entries(pos).map(([id, p]) => [id, inside(fight, p)]));
    }
    function demonPositions(fight, sc) {
        const pos = {}, candidates = [];
        if (sc.shadowTank) pos[sc.shadowTank] = copy(SHADOW);
        for (let row = 0; row < 9; row++) for (let col = 0; col < 14; col++) {
            const p = { x: .20 + col * .047, y: .16 + row * .070 };
            if (p.x < fight.arena.x1 - .02 && L.dist(fight, p, DEMON) > 16 && L.dist(fight, p, SHADOW) > 21) candidates.push(p);
        }
        // Healers take the closest legal slots first: outside splash, within cast reach.
        const order = [...sc.shadowHealers, ...sc.raid.map(p => p.id).filter(id => id !== sc.shadowTank && !sc.shadowHealers.includes(id))];
        order.forEach(id => {
            const healer = sc.shadowHealers.includes(id);
            candidates.sort((a, b) => healer ? L.dist(fight, a, SHADOW) - L.dist(fight, b, SHADOW) : L.dist(fight, a, { x: .55, y: .25 }) - L.dist(fight, b, { x: .55, y: .25 }));
            const p = candidates.shift();
            // An oversized roster still draws without manufacturing extra players.
            pos[id] = p || inside(fight, { x: .82, y: .80 });
        });
        return pos;
    }
    function prepareScene(fight, source, assigned) {
        const sc = JSON.parse(JSON.stringify(source));
        const demo = assigned.length === 25 && assigned.every(p => !p.name);
        const classes = { tank: ['WARRIOR', 'PALADIN', 'DRUID'], healer: ['PRIEST', 'SHAMAN', 'PALADIN', 'DRUID'], melee: ['ROGUE', 'WARRIOR', 'SHAMAN'], ranged: ['MAGE', 'WARLOCK', 'HUNTER', 'PRIEST'] };
        const groups = { tank: [], healer: [], melee: [], ranged: [] };
        sc.raid = assigned.map(p => {
            const q = { ...p, class: p.class || (demo ? classes[p.kind][groups[p.kind].length % classes[p.kind].length] : null) };
            groups[p.kind].push(q); return q;
        });
        sc.mainTank = (groups.tank.find(p => ['WARRIOR', 'PALADIN'].includes(cls(p))) || groups.tank[0])?.id || null;
        sc.flameTanks = groups.tank.filter(p => p.id !== sc.mainTank).slice(0, 2).map(p => p.id);
        sc.shadowTank = groups.ranged.find(p => cls(p) === 'WARLOCK')?.id || null;
        sc.healers = groups.healer.map(p => p.id);
        sc.flameHealers = sc.healers.slice(0, 2);
        sc.shadowHealers = sc.healers.slice(0, 2); // Different phase: reassign the same dedicated healers.
        sc.raidHealer = sc.healers[2] || null;
        sc.damage = groups.melee.concat(groups.ranged).filter(p => p.id !== sc.shadowTank).map(p => p.id);
        sc.parasiteTarget = groups.ranged.find(p => p.id !== sc.shadowTank)?.id || sc.damage[0] || null;
        sc.parasiteKillers = sc.damage.filter(id => id !== sc.parasiteTarget);
        sc.barrageTarget = sc.damage[0] || null;
        sc.demonTargets = sc.raid.filter(p => p.id !== sc.shadowTank && !sc.shadowHealers.includes(p.id)).slice(0, 4).map(p => p.id);
        sc.demonKillers = sc.damage.filter(id => !sc.demonTargets.includes(id));
        sc.trapActivator = sc.damage[0] || null;
        sc.missingRoles = [];
        if (!sc.mainTank) sc.missingRoles.push('Main tank missing.');
        if (sc.flameTanks.length < 2) sc.missingRoles.push('Two dedicated Flame tanks missing; agree any geared overlapping assignment before pulling.');
        if (!sc.shadowTank) sc.missingRoles.push('Shadow tank missing: no known ranged Warlock.');
        if (sc.flameHealers.length < 2) sc.missingRoles.push('Dedicated tank healing incomplete: assign both Flame tanks and two Shadow-tank healers.');
        if (!sc.raidHealer) sc.missingRoles.push('Separate raid healer missing for Barrage and parasite recovery.');
        if (!hasDamage(sc)) sc.missingRoles.push('Damage team missing.');
        sc.baseById = groundPositions(fight, sc);
        sc.mainHealer = sc.healers.slice().sort((a, b) => L.dist(fight, sc.baseById[a], tankAt({ x: .61, y: GROUND.y })) - L.dist(fight, sc.baseById[b], tankAt({ x: .61, y: GROUND.y })))[0] || null;
        sc.parasiteHealer = sc.healers.filter(id => id !== sc.mainHealer).sort((a, b) => L.dist(fight, sc.baseById[a], DROP) - L.dist(fight, sc.baseById[b], DROP))[0] || null;
        sc.trapActivator = sc.damage.slice().sort((a, b) => L.dist(fight, sc.baseById[a], { x: .63, y: .53 }) - L.dist(fight, sc.baseById[b], { x: .63, y: .53 }))[0] || null;
        sc.demonById = demonPositions(fight, sc);
        sc.bossActor = { id: 'illidan', at: copy(GROUND), scale: .9 };
        return sc;
    }
    function frame(sc, t) {
        return { timeMs: t, stage: sc.id, phase: 1, pos: Object.fromEntries(sc.raid.map(p => [p.id, copy(sc.baseById[p.id])])), hp: Object.fromEntries(sc.raid.map(p => [p.id, 1])), roles: {}, focus: {}, boss: copy(GROUND), bossTarget: sc.mainTank, bossVisible: true, bossFacing: 'DOWN', routes: [], hazards: [], casts: [], instructionRows: sc.jobs.slice(), call: sc.call, damageHeld: false, missingCoverage: [] };
    }
    function groundFacing(f, sc) {
        if (sc.mainTank) { f.pos[sc.mainTank] = tankAt(f.boss); role(f, sc.mainTank, 'MT'); }
        f.frontal = { from: copy(f.boss), to: tankAt(f.boss), yards: 12 };
    }
    function ground(fight, sc, f, t) {
        f.phase = 1;
        if (t >= 2000) {
            const k = clamp((t - 2000) / 4500), destination = { x: .61, y: GROUND.y };
            f.boss = mix(GROUND, destination, k);
            sc.raid.filter(p => p.kind === 'melee').forEach(p => { f.pos[p.id].x += .11 * k; });
            f.hazards.push({ kind: 'Flame Crash', at: tankAt(GROUND), radiusYards: 10, persistent: true });
            if (k < 1) f.routes.push({ from: copy(GROUND), to: destination });
        }
        groundFacing(f, sc);
        f.shear = { tankId: sc.mainTank, prepared: false, assigned: !!sc.mainTank, gearVerified: false };
        f.call = t < 2000 ? 'Verify Shear protection; keep the blocking ability ready. Only the tank stands in front.' : t < 6500 ? 'Flame Crash: move the tank, boss, melee and pets onto clear ground.' : 'Keep the new position; the old fire still burns.';
    }
    function parasites(fight, sc, f, t) {
        groundFacing(f, sc);
        const id = sc.parasiteTarget;
        f.parasites = { targetId: id, healerId: sc.parasiteHealer, debuff: t < 10000, killers: sc.parasiteKillers };
        role(f, sc.parasiteHealer, 'Carrier heal');
        if (id) {
            role(f, id, t < 10000 ? 'Parasites' : 'Carrier');
            if (t >= 1000) f.pos[id] = mix(sc.baseById[id], DROP, (t - 1000) / 3000);
            if (t >= 1000 && t < 4000) f.routes.push({ from: sc.baseById[id], to: DROP, targetId: id });
            if (t >= 1000) f.hp[id] = sc.parasiteHealer ? .85 : .4;
        }
        if (t >= 10000 && id) {
            const dead = t >= 13000 && sc.parasiteKillers.length > 0;
            // Carrier steps away from the spawn while nearby ranged allies switch.
            f.pos[id] = mix(DROP, { x: .30, y: .15 }, (t - 10000) / 1600);
            f.adds = [{ id: 'parasite-1', at: copy(DROP), dead }, { id: 'parasite-2', at: { x: DROP.x + .024, y: DROP.y }, dead }];
            sc.parasiteKillers.forEach(killer => { f.focus[killer] = true; });
            if (dead && sc.parasiteHealer) f.hp[id] = 1;
        }
        f.call = t < 10000 ? 'Isolate the marked player before the ten-second expiry; keep healing them.' : t < 13000 ? 'Two parasites spawn: free damage switches before they spread another infection.' : sc.parasiteKillers.length ? 'Both parasites cleared; return when the route is safe.' : 'Free damage missing: parasites remain alive.';
    }
    function airPositions(fight, sc, f) {
        f.phase = 2; f.bossVisible = false; f.bossTarget = null;
        f.glaives = GLAIVES.map(g => ({ id: g.id, at: copy(g.at) }));
        f.groups = GROUPS.map((at, i) => ({ at: copy(at), label: 'G' + (i + 1), ids: [] }));
        const raid = sc.raid.filter(p => !sc.flameTanks.includes(p.id));
        raid.forEach((p, i) => {
            const group = f.groups[i % 3], n = group.ids.length;
            // Small offsets make stacked players visible while keeping group edges >10 yd apart.
            f.pos[p.id] = { x: group.at.x + ((n % 3) - 1) * .011, y: group.at.y + (Math.floor(n / 3) - 1) * .017 };
            group.ids.push(p.id);
        });
        f.flames = GLAIVES.map((g, i) => ({ id: i ? 'right-flame' : 'left-flame', glaiveId: g.id, at: { x: i ? .62 : .38, y: .30 }, tankId: sc.flameTanks[i] || null, dead: false }));
        f.flames.forEach((flame, i) => {
            if (flame.tankId) { f.pos[flame.tankId] = { x: flame.at.x + (i ? .032 : -.032), y: flame.at.y }; role(f, flame.tankId, i ? 'T2' : 'T1'); }
        });
        sc.flameHealers.forEach((id, i) => role(f, id, 'Heal T' + (i + 1)));
    }
    function moveFlame(f, index, from, to, k) {
        const flame = f.flames[index];
        if (!flame.tankId) return;
        flame.at = mix(from, to, k);
        f.pos[flame.tankId] = { x: flame.at.x + (index ? .032 : -.032), y: flame.at.y };
        if (k < 1) f.routes.push({ from, to, targetId: flame.tankId });
    }
    function flames(fight, sc, f, t) {
        airPositions(fight, sc, f);
        if (t >= 1500) {
            const k = clamp((t - 1500) / 4000);
            moveFlame(f, 0, { x: .38, y: .30 }, { x: .38, y: .17 }, k);
            moveFlame(f, 1, { x: .62, y: .30 }, { x: .62, y: .17 }, k);
            f.hazards.push({ kind: 'Blaze', at: { x: .348, y: .30 }, radiusYards: 5, persistent: true }, { kind: 'Blaze', at: { x: .652, y: .30 }, radiusYards: 5, persistent: true });
        }
        const controlled = sc.flameTanks.length === 2 && sc.flameHealers.length === 2 && hasDamage(sc);
        f.flames[0].dead = t >= 7000 && controlled;
        f.flames[1].dead = t >= 11000 && controlled;
        f.landingReady = f.flames.every(flame => flame.dead);
        f.call = t < 1500 ? 'Pick up both Flames; face Flame Blast outward. Stay in central groups.' : t < 7000 ? 'Small moves out of Blaze; keep each Flame near its glaive.' : t < 11000 ? 'First Flame down: focus the survivor and keep its tank healed.' : 'Both Flames down: prepare the landing pickup.';
    }
    function eye(fight, sc, f, t) {
        airPositions(fight, sc, f);
        // The tell threatens an upward route. Tanks remain below this example beam;
        // neither their adjustment nor their Flames cross the future blue trail.
        f.eyeBeam = t >= 1500 ? { from: { x: .27, y: .18 }, to: { x: .425, y: .24 }, radiusYards: 2, active: t >= 3000, variable: true, progress: clamp((t - 3000) / 3500) } : null;
        if (t >= 3000) {
            moveFlame(f, 0, { x: .38, y: .30 }, { x: .365, y: .43 }, clamp((t - 3000) / 3500));
            f.hazards.push({ kind: 'Eye Blast trail', from: copy(f.eyeBeam.from), to: mix(f.eyeBeam.from, f.eyeBeam.to, f.eyeBeam.progress), at: copy(f.eyeBeam.from), radiusYards: 2, persistent: true });
        }
        f.hazards.push({ kind: 'Old Blaze', at: { x: .35, y: .14 }, radiusYards: 5, persistent: true });
        f.call = t < 1500 ? 'Read the actual beam path; the next one may be elsewhere.' : t < 3000 ? 'Eye Blast cuts the upward route. Adjust before moving into it.' : t < 7000 ? 'Move on the safe side with the Flame facing out and tether intact.' : 'The blue trail remains: keep the revised safe position.';
    }
    function barrage(fight, sc, f, t) {
        airPositions(fight, sc, f);
        const heal = !!sc.raidHealer;
        if (t >= 1000) {
            f.fireball = { at: copy(f.groups[0].at), targetIds: f.groups[0].ids, radiusYards: 10, active: t < 3500 };
            f.groups[0].ids.forEach(id => { f.hp[id] = heal ? .65 + .35 * clamp((t - 1000) / 2500) : .6; });
        }
        if (t >= 4000 && sc.barrageTarget) {
            const id = sc.barrageTarget;
            f.barrage = { targetId: id, active: t < 8000, healerId: sc.raidHealer };
            role(f, id, 'Barrage'); role(f, sc.raidHealer, 'Raid heal');
            f.hp[id] = heal ? .55 + .45 * clamp((t - 6000) / 3000) : .2;
        }
        f.call = t < 1000 ? 'Three marked groups keep their gaps and tank-healing assignments.' : t < 4000 ? 'Fireball splashes one group: recover it without leaving central positions.' : t < 8000 ? 'Dark Barrage: focused healing and personal survival on its target.' : 'Finish recovery; both Flame tanks still need their healers.';
    }
    function landing(fight, sc, f, t) {
        f.phase = 3; groundFacing(f, sc);
        f.damageHeld = t < 3000 || !sc.mainTank;
        f.pickup = { tankId: sc.mainTank, controlled: t >= 3000 && !!sc.mainTank };
        f.agonizing = t >= 3000;
        f.lust = t >= 4500 && !!sc.mainTank && hasDamage(sc);
        f.call = t < 3000 ? 'Illidan lands: hold damage for the tank and prepare immediate healing.' : t < 4500 ? 'Tank pickup secure. Keep five-yard spacing for Agonizing Flames.' : t < 9000 ? 'Use Lust and saved damage tools; push toward 30% while doing ground mechanics.' : 'If he transforms, use the full Demon assignment; a skip is never assumed.';
    }
    function demon(fight, sc, f, t) {
        f.phase = 4; f.boss = copy(DEMON); f.bossTarget = sc.shadowTank;
        f.pos = Object.fromEntries(sc.raid.map(p => [p.id, copy(sc.demonById[p.id])]));
        f.damageHeld = t < 3000 || !sc.shadowTank;
        f.separation = { bossYards: 15, shadowYards: 20, raidYards: 5 };
        role(f, sc.shadowTank, 'Shadow T');
        sc.shadowHealers.forEach(id => role(f, id, 'Shadow heal'));
        if (t >= 3000 && sc.shadowTank) f.shadowBlast = { at: copy(SHADOW), radiusYards: 20, targetId: sc.shadowTank };
        if (t >= 6000) {
            const killed = t >= 11000 && sc.demonKillers.length > 0 && !!sc.shadowTank && sc.shadowHealers.length === 2;
            f.demons = sc.demonTargets.map((targetId, i) => {
                const at = { x: DEMON.x + (i - 1.5) * .02, y: DEMON.y - .03 };
                // Stop well before contact for a successful rescue; unrescued examples
                // continue approaching without giving paralyzed victims a movement route.
                return { id: 'shadow-' + i, targetId, at: mix(at, f.pos[targetId], clamp((t - 6000) / 12000, 0, .7)), dead: killed, paralyzed: !killed };
            });
            sc.demonTargets.forEach(id => role(f, id, killed ? 'Safe' : 'Stun'));
            sc.demonKillers.forEach(id => { f.focus[id] = true; });
        }
        f.call = t < 3000 ? 'Ranged Shadow tank takes control. Leave the boss aura and tank splash.' : t < 6000 ? 'Heal the isolated Shadow tank; everyone keeps five-yard spacing.' : t < 11000 ? 'Four demons paralyze their targets. Free damage must rescue them.' : 'All four rescues complete; maintain Demon formation until the return.';
    }
    function returning(fight, sc, f, t) {
        f.phase = 3; groundFacing(f, sc);
        f.damageHeld = t < 6000 || !sc.mainTank;
        f.pickup = { tankId: sc.mainTank, controlled: t >= 3000 && !!sc.mainTank };
        f.agonizing = true;
        f.call = t < 3000 ? 'Transforming back: hold damage and prepare the main tank.' : t < 6000 ? 'Main tank pickup and healing first; restore Shear protection.' : 'Control confirmed: resume ground mechanics and five-yard spacing.';
    }
    function maiev(fight, sc, f, t) {
        f.phase = 5; groundFacing(f, sc); f.agonizing = true;
        f.hazards.push({ kind: 'Old Flame Crash', at: { x: .42, y: .65 }, radiusYards: 10, persistent: true });
        f.prison = t < 3000; f.damageHeld = t < 3000 || !sc.mainTank;
        const trap = { x: .63, y: .53 }, end = { x: .63, y: .53 }, activator = sc.trapActivator;
        const can = !!activator && !!sc.mainTank;
        if (t >= 5500) {
            f.enrage = true;
            f.trap = { at: trap, radiusYards: 4, activatorId: activator, armed: t >= 7000 && can, caged: false };
            if (activator) {
                const clickAt = { x: .64, y: .49 };
                // Travel starts with the pickup so the activation approach uses normal movement.
                f.pos[activator] = mix(sc.baseById[activator], clickAt, (t - 3000) / 4000);
                role(f, activator, t < 7000 ? 'Activate' : 'Trap armed');
            }
        } else if (t >= 3000 && activator) {
            f.pos[activator] = mix(sc.baseById[activator], { x: .64, y: .49 }, (t - 3000) / 4000);
        }
        if (t >= 7000 && can) {
            const k = clamp((t - 7000) / 4000);
            f.boss = mix(GROUND, end, k); groundFacing(f, sc);
            sc.raid.filter(p => p.kind === 'melee' && p.id !== activator).forEach(p => { f.pos[p.id].x += (end.x - GROUND.x) * k; });
            f.routes.push({ from: copy(GROUND), to: end });
            f.trap.caged = f.boss.x >= trap.x;
            f.enrage = !f.trap.caged;
            // After clicking, the activator stays behind the moving boss, out of its front.
            f.pos[activator] = mix({ x: .64, y: .49 }, { x: .75, y: .23 }, k);
        }
        f.call = t < 3000 ? '30%: raid stunned for Maiev’s arrival. Prepare immediate tank healing.' : t < 5500 ? 'Secure Illidan after RP; prepare Enrage cooldowns and an accessible trap.' : t < 7000 ? 'Cover Enrage while the nearby activator clicks the trap.' : t < 11000 ? 'Lead Illidan across the armed trap with his front away from the raid.' : 'Burn while caged; continue ground jobs and prepare Demon Form again if needed.';
    }
    function coverage(sc, id, beat) {
        const missing = [];
        if (['positioning', 'ground', 'parasites', 'landing', 'return', 'maiev'].includes(id) && !sc.mainTank) missing.push('Main tank coverage missing.');
        if (['ground', 'landing', 'return', 'maiev'].includes(id) && !sc.healers.length) missing.push('Tank healing missing.');
        if (id === 'parasites') {
            if (!sc.parasiteTarget) missing.push('Parasite target unavailable.');
            if (!sc.parasiteKillers.length) missing.push('Free parasite damage missing.');
            if (!sc.parasiteHealer) missing.push('Parasite healing missing.');
        }
        if (['flames', 'eye', 'barrage'].includes(id)) {
            if (sc.flameTanks.length !== 2) missing.push('Two Flame tanks missing.');
            if (sc.flameHealers.length !== 2) missing.push('Flame tank healing missing.');
            if (!hasDamage(sc)) missing.push('Flame damage missing.');
            if (id === 'barrage' && !sc.raidHealer) missing.push('Barrage raid healing missing.');
        }
        if (id === 'demon') {
            if (!sc.shadowTank) missing.push('Shadow tank missing: no known ranged Warlock.');
            if (sc.shadowHealers.length !== 2) missing.push('Shadow tank healing missing.');
            if (!sc.demonKillers.length) missing.push('Free Shadow Demon damage missing.');
        }
        if (id === 'maiev' && !sc.trapActivator) missing.push('Trap activator missing; use the planned cooldown fallback.');
        if (id === 'positioning') return sc.missingRoles.slice();
        return missing;
    }
    function simulate(fight, sc, timeMs) {
        const t = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, sc.duration), f = frame(sc, t);
        const segment = sc.id === 'cycle' ? cycleAt(t) : { id: sc.id, local: t };
        f.segment = segment.id;
        const handlers = { ground, parasites, flames, eye, barrage, landing, demon, return: returning, maiev };
        if (handlers[segment.id]) handlers[segment.id](fight, sc, f, segment.local);
        else groundFacing(f, sc);
        f.missingCoverage = coverage(sc, segment.id);
        if (f.missingCoverage.length) f.call = f.missingCoverage.join(' ');
        if (sc.id === 'positioning') f.instructionRows = [
            ['Tank jobs', 'Main: ' + name(sc, sc.mainTank) + '. Flames: ' + [0, 1].map(i => name(sc, sc.flameTanks[i])).join(' / ') + '. Shadow: ' + name(sc, sc.shadowTank)],
            ['Healing', 'Flames: ' + [0, 1].map(i => name(sc, sc.flameHealers[i])).join(' / ') + '. Shadow: ' + sc.shadowHealers.map(id => name(sc, id)).join(' + ') + '. Raid: ' + name(sc, sc.raidHealer)],
            ['Verify before pull', 'Shear protection, Fire Resistance + crit immunity, Shadow Resistance and actual healing reach.']
        ];
        f.instructionRows.push(...f.missingCoverage.map(note => ['Missing coverage', note]));
        return f;
    }
    function resolveExplanation(explanation, sc) {
        if (!explanation) return explanation;
        const cycleIds = { ground: 'ground', air: 'flames', landing: 'landing', demon: 'demon', maiev: 'maiev' };
        const id = sc.id === 'cycle' ? cycleIds[explanation.id] || cycleAt(explanation.startMs || 0).id : sc.id;
        const missing = coverage(sc, id, explanation.id);
        return missing.length ? { ...explanation, title: missing[0], detail: missing.join(' ') + ' Confirm assignments before using this example.' } : explanation;
    }
    function copyText(fight, sc) {
        return [fight.name + ' — illustrative Illidan assignments', 'Main tank — ' + name(sc, sc.mainTank), 'Flame tanks — ' + [0, 1].map(i => name(sc, sc.flameTanks[i])).join(' / '), 'Shadow Warlock — ' + name(sc, sc.shadowTank), 'Flame healers — ' + [0, 1].map(i => name(sc, sc.flameHealers[i])).join(' / '), 'Shadow healers — ' + sc.shadowHealers.map(id => name(sc, id)).join(' + '), 'Main tank healer — ' + name(sc, sc.mainHealer), 'Parasite healer — ' + name(sc, sc.parasiteHealer), 'Raid healer — ' + name(sc, sc.raidHealer), 'Trap activator — ' + name(sc, sc.trapActivator), ...sc.missingRoles, 'Positions and timing are illustrative. Confirm Shear protection, resistance sets, crit immunity and healing coverage before pulling.'].join('\n');
    }
    return { prepareScene, simulate, copyText, resolveExplanation };
}));
