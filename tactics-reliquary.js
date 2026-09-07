(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-layout.js'));
    else root.TacticsReliquary = factory(root.TacticsLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
    'use strict';
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const cls = p => String(p.class || '').trim().toUpperCase();
    const point = (fight, deg, yards) => { const a = deg * Math.PI / 180; return { x: fight.bossAt.x + Math.cos(a) * yards * fight.yard, y: fight.bossAt.y + Math.sin(a) * yards * fight.yard * fight.aspect }; };
    const tankLane = (fight, index, count = 3) => {
        const total = Math.max(1, count);
        const angle = total === 1 ? 270 : total === 3 ? [225, 270, 315][index] : 210 + index * 120 / (total - 1);
        return { near: point(fight, angle, 6.2), far: point(fight, angle, 12.5) };
    };
    const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * clamp(t) , y: a.y + (b.y - a.y) * clamp(t) });
    function capable(p, task) {
        const c = cls(p); if (!c) return false;
        if (task === 'dispel') return /PRIEST|PALADIN/.test(c);
        if (task === 'absorb') return c === 'PRIEST';
        if (task === 'remove') return c === 'MAGE' || c === 'PRIEST' || c === 'SHAMAN';
        if (task === 'kick') return /ROGUE|WARRIOR|SHAMAN|MAGE/.test(c);
        if (task === 'lust') return c === 'SHAMAN';
        return false;
    }
    function prepareScene(fight, source, assigned) {
        const sc = JSON.parse(JSON.stringify(source));
        sc.bossActor = { id: 'essence', at: { ...fight.bossAt }, scale: .92 };
        sc.cast = {};
        const exampleClass = (p, index) => ({ tank: ['WARRIOR', 'PALADIN', 'DRUID'][index % 3], healer: ['PRIEST', 'SHAMAN', 'PALADIN', 'DRUID'][index % 4], melee: ['ROGUE', 'WARRIOR', 'SHAMAN'][index % 3], ranged: ['MAGE', 'WARLOCK', 'HUNTER', 'PRIEST'][index % 4] }[p.kind] || null);
        const indices = { tank: 0, melee: 0, ranged: 0, healer: 0 };
        sc.raid = assigned.map(p => { const index = indices[p.kind]++; const example = !p.name && assigned.length === 25; return { id: p.id, kind: p.kind, name: p.name, slotIndex: p.slotIndex, class: p.class || (example ? exampleClass(p, index) : null), label: sc.id === 'positioning' ? p.name || null : null }; });
        sc.baseById = {}; sc.tanks = sc.raid.filter(p => p.kind === 'tank').map(p => p.id);
        const groups = { tank: sc.raid.filter(p => p.kind === 'tank'), melee: sc.raid.filter(p => p.kind === 'melee'), ranged: sc.raid.filter(p => p.kind === 'ranged'), healer: sc.raid.filter(p => p.kind === 'healer') };
        sc.raid.forEach(p => {
            const i = groups[p.kind].indexOf(p), n = groups[p.kind].length;
            let at;
            if (p.kind === 'tank') at = tankLane(fight, i, n).far;
            else if (p.kind === 'melee') at = point(fight, 55 + i * (n === 1 ? 0 : 70 / (n - 1)), 13);
            else if (p.kind === 'healer') at = point(fight, 68 + i * (n === 1 ? 0 : 44 / (n - 1)), 20);
            else at = point(fight, 30 + i * (n === 1 ? 0 : 120 / (n - 1)), 25 + Math.floor(i / 8) * 3);
            sc.baseById[p.id] = at;
        });
        sc.hasDamage = groups.melee.length + groups.ranged.length > 0;
        sc.missingRoles = [];
        if (!sc.tanks.length) sc.missingRoles.push('No tank loaded: a tank pickup is not demonstrated.');
        else if (sc.tanks.length < 2) sc.missingRoles.push('One tank loaded: no off-tank handoff is invented.');
        if (!groups.healer.length) sc.missingRoles.push('No healer loaded: recovery coverage is missing.');
        if (!sc.hasDamage) sc.missingRoles.push('No damage role loaded: soul deaths and the final kill are not demonstrated.');
        sc.dispeller = sc.raid.find(p => capable(p, 'dispel'))?.id || null;
        sc.absorber = sc.raid.find(p => capable(p, 'absorb'))?.id || null;
        sc.remover = sc.raid.find(p => cls(p) === 'MAGE')?.id || sc.raid.find(p => capable(p, 'remove'))?.id || null;
        sc.kickers = sc.raid.filter(p => capable(p, 'kick')).sort((a, b) => Number(a.kind === 'tank') - Number(b.kind === 'tank')).map(p => p.id);
        sc.luster = sc.raid.find(p => capable(p, 'lust'))?.id || null;
        sc.tongues = sc.raid.find(p => cls(p) === 'WARLOCK')?.id || null;
        if (!sc.dispeller) sc.missingRoles.push('No known Soul Drain dispel coverage.');
        if (!sc.remover) sc.missingRoles.push('No known Rune Shield removal coverage.');
        if (!sc.kickers.length) sc.missingRoles.push('No known interrupt coverage.');
        return sc;
    }
    function baseFrame(fight, sc, time) {
        const t = Number.isFinite(time) ? clamp(time, 0, sc.duration) : 0;
        const pos = Object.fromEntries(sc.raid.map(p => [p.id, { ...sc.baseById[p.id] }]));
        const hp = Object.fromEntries(sc.raid.map(p => [p.id, 1]));
        return { timeMs: t, phaseTimeMs: t, phase: 1, stage: sc.id, essence: sc.id === 'desire' || sc.id === 'interrupts' || sc.id === 'deaden' ? 'Desire' : sc.id === 'anger' || sc.id === 'spite' ? 'Anger' : sc.id === 'souls' ? 'Souls' : 'Suffering', pos, boss: { ...fight.bossAt }, bossTarget: sc.tanks[0] || null, bossHp: 1, bossVisible: true, bossOpacity: 1, pressure: 0, shadowPulses: [], tankResource: null, hp, roles: {}, jobs: {}, focus: {}, call: sc.call, instructionRows: [], actions: [], teaching: { title: '', detail: '', step: '' }, tipVisual: null, debuffs: {}, shield: { active: false }, cast: { active: false, interrupted: false, kind: null }, souls: [], mana: 100, maxMana: 100, spite: [], seethe: { active: false }, lust: { active: false }, scream: { active: false }, drains: [], absorbs: [], recoil: [] };
    }
    const nameOf = (sc, id, fallback) => {
        const player = sc.raid.find(p => p.id === id);
        if (!player) return fallback;
        const sameName = player.name && sc.raid.filter(p => p.name === player.name).length === 1;
        if (sameName) return player.name;
        if (player.kind === 'tank') return 'Tank ' + (sc.tanks.indexOf(id) + 1);
        const className = cls(player);
        if (className) return className[0] + className.slice(1).toLowerCase() + ' ' + (sc.raid.filter(p => cls(p) === className).indexOf(player) + 1);
        return fallback;
    };
    function suffering(fight, sc, f, t) {
        const tanks = sc.tanks.length ? sc.tanks : [], enrageLesson = sc.id === 'suffering', cycleLesson = sc.id === 'cycle';
        const checks = [0, 5000, 10000, 15000].filter(at => t >= at);
        const primary = tanks[0] || null, fresh = tanks[1] || null;
        const handoffDue = !enrageLesson && !!fresh && t >= 14000 && t < 15000;
        const current = enrageLesson ? primary : (fresh && t >= 15000 ? fresh : primary);
        f.essence = 'Suffering'; f.stage = sc.id === 'fixate' ? 'fixate' : 'suffering'; f.bossTarget = current;
        f.fixateChecks = checks.map(at => ({ at, targetId: enrageLesson || at < 15000 ? primary : fresh || primary }));
        f.lowHealth = !enrageLesson && !!primary && t >= 11000 && t < 15000;
        f.handoffDue = handoffDue;
        f.tankLanes = Object.fromEntries(tanks.map((id, i) => [id, tankLane(fight, i, tanks.length)]));
        f.nextTank = handoffDue ? fresh : null;
        f.nextTankAt = f.nextTank ? f.tankLanes[f.nextTank].near : null;
        tanks.forEach(id => {
            const lane = f.tankLanes[id], isPrimary = id === primary, isIncoming = id === fresh && handoffDue;
            const approach = handoffDue ? clamp((t - 14000) / 1000) : 0;
            f.pos[id] = isPrimary && handoffDue ? interpolate(lane.near, lane.far, approach) : id === current ? lane.near : isIncoming ? interpolate(lane.far, lane.near, approach) : lane.far;
            if (id === primary) f.hp[id] = enrageLesson ? clamp(.92 - t / 18000 * .30) : clamp(.94 - (fresh ? Math.min(t, 15000) : t) / 15000 * .54);
            else if (!enrageLesson && id === fresh && t >= 15000) f.hp[id] = clamp(.94 - (t - 15000) / 2000 * .12);
        });
        const drainLesson = sc.id !== 'fixate';
        if (drainLesson && t >= 1000) f.drains = [{ targetId: current, dispelled: !!sc.dispeller && t >= 3000 }];
        if (drainLesson && sc.absorber && t >= 3000) f.absorbs = [{ targetId: current, sourceId: sc.absorber }];
        const enragePrepared = enrageLesson ? t >= 9000 : cycleLesson && t >= 16000;
        const enrageActive = enrageLesson ? t >= 12000 : cycleLesson && t >= 17000;
        f.tankDefense = enragePrepared && current ? { targetId: current, prepared: true, active: enrageActive, label: enrageActive ? 'Prepared cooldown survival' : 'Prepare defensive cooldowns' } : null;
        if (drainLesson && t >= 3000) f.call = f.drains[0]?.dispelled ? 'Soul Drain removed. Hold the current tank while health and cooldowns are ready.' : 'Soul Drain needs an eligible dispel.';
        if (current) f.focus[current] = true; if (handoffDue) f.focus[fresh] = true;
        tanks.forEach(id => { f.jobs[id] = id === current ? 'Hold closest position for Suffering' : id === fresh && handoffDue ? 'Move closest for the health-based handoff' : 'Wait outside closest range'; });
        if (drainLesson && sc.dispeller) f.jobs[sc.dispeller] = 'Dispel Soul Drain';
        if (drainLesson && sc.absorber) f.jobs[sc.absorber] = (f.jobs[sc.absorber] ? f.jobs[sc.absorber] + '; shield receiving tank' : 'Shield receiving tank');
        if (drainLesson && sc.dispeller) f.focus[sc.dispeller] = true;
        if (drainLesson && sc.absorber) f.focus[sc.absorber] = true;
        const latestCheck = f.fixateChecks.at(-1);
        if (latestCheck && t - latestCheck.at < 900) f.actions.push({ kind: 'fixate-check', sourceId: 'essence', targetId: latestCheck.targetId, label: 'Fixate selects the closest tank', result: latestCheck.targetId === primary ? 'Current tank continues while health is safe' : 'Fresh tank receives the chosen handoff' });
        if (drainLesson && t >= 1000 && t < 3000) f.actions.push({ kind: 'drain', sourceId: 'essence', targetId: current, label: 'Soul Drain · health + mana', result: 'Magic dispel is first priority' });
        if (drainLesson && sc.dispeller && f.drains[0] && t >= 3000 && t < 5000) f.actions.push({ kind: 'dispel', sourceId: sc.dispeller, targetId: current, label: nameOf(sc, sc.dispeller, 'Dispeller') + ' · dispel Soul Drain', result: f.drains[0].dispelled ? 'Drain removed first' : 'Drain still active' });
        if (drainLesson && sc.absorber && t >= 5000 && t < 7000) f.actions.push({ kind: 'shield', sourceId: sc.absorber, targetId: current, label: nameOf(sc, sc.absorber, 'Priest') + ' · shield tank', result: 'Absorb works; heals do not' });
        const healer = sc.raid.find(p => p.kind === 'healer');
        if (drainLesson && healer && t >= 7000 && t < 9000) f.actions.push({ kind: 'heal-dps', sourceId: healer.id, targetId: 'essence', label: 'Healers · DPS during Suffering', result: 'No healing or mana regen' });
        if (enragePrepared && !enrageActive && current) f.actions.push({ kind: 'defensive-prep', sourceId: current, targetId: current, label: nameOf(sc, current, 'Prepared tank') + ' · defensive cooldown ready', result: 'Prepared tank holds Enrage checks' });
        if (enrageActive && current) f.actions.push({ kind: 'enrage-survival', sourceId: 'essence', targetId: current, label: 'Enrage · prepared tank survives', result: 'Cooldowns and avoidance are prepared; no forced swap' });
        const rogue = sc.raid.find(p => cls(p) === 'ROGUE'), hunter = sc.raid.find(p => cls(p) === 'HUNTER');
        f.teaching = !drainLesson ? !primary ? { step: 'Fixate', title: 'No tank is loaded', detail: 'No closest-tank example can be shown.' } : f.lowHealth && !fresh ? { step: 'Health', title: 'Tank health is getting low.', detail: 'Health is low; no fresh tank is loaded for the next Fixate.' } : handoffDue ? { step: 'Handoff', title: 'Next tank in; current tank out.', detail: 'The fresh tank becomes closest for the next check.' } : fresh && t >= 15000 ? { step: 'Handoff', title: nameOf(sc, current, 'Fresh tank') + ' has Fixate', detail: 'The previous tank keeps its lost health while the fresh tank holds closest.' } : f.lowHealth ? { step: 'Health', title: 'Tank health is getting low.', detail: 'Prepare a fresh tank before it is unsafe, then hand off at the next Fixate.' } : { step: 'Hold', title: 'Keep the same tank while healthy.', detail: 'Fixate checks who is closest every five seconds. Swap when health, shields or cooldowns call for it.' } : t < 1000 ? { step: 'Suffering', title: 'No healing or mana regeneration', detail: 'Armor is reduced by 100% and defense by 500. The prepared tank holds while support is ready.' } : t < 3000 ? { step: '1', title: 'Soul Drain arrives', detail: 'It drains health and mana. Magic dispel takes priority.' } : t < 5000 ? { step: '2', title: 'Dispel Soul Drain', detail: 'Remove the magic debuff before other dispels.' } : t < 7000 ? { step: '3', title: 'Priest shield still works', detail: 'Absorbs protect the prepared tank even though healing cannot.' } : t < 9000 ? { step: '4', title: 'Healers DPS in Suffering', detail: 'Healing and mana regeneration remain disabled.' } : t < 12000 ? { step: 'Enrage', title: 'Prepare cooldowns for Enrage.', detail: 'Around 0:45, Enrage lasts 15 seconds. Prepare a tank with cooldowns and avoidance.' } : { step: 'Enrage', title: 'Use cooldowns to survive Enrage.', detail: 'Use cooldowns and avoidance; hold the prepared tank while safe.' };
        const avoidanceStart = enrageLesson ? 12000 : cycleLesson ? 17000 : Infinity;
        if (drainLesson && rogue && t >= avoidanceStart && t < avoidanceStart + 3000) f.tipVisual = { kind: 'evasion', sourceId: rogue.id, targetId: current, progress: clamp((t - avoidanceStart) / 3000), label: 'Optional · Rogue Evasion for Enrage survival', optional: true };
        if (drainLesson && hunter && t >= avoidanceStart + 3000) f.tipVisual = { kind: 'deterrence', sourceId: hunter.id, targetId: current, progress: clamp((t - (avoidanceStart + 3000)) / 3000), label: 'Optional · Hunter Deterrence for Enrage survival', optional: true };
        const nextAt = Math.ceil((t + 1) / 5000) * 5000;
        f.fixateAtMs = nextAt;
        const nextLabel = Math.floor(nextAt / 60000) + ':' + String(Math.floor(nextAt / 1000) % 60).padStart(2, '0');
        f.nextFixateLabel = nextLabel;
        f.instructionRows = [
            ['Current tank', (current ? nameOf(sc, current, 'Tank') : 'No tank') + ' — closest through the next Fixate check'],
            ['Swap decision', handoffDue ? nameOf(sc, fresh, 'Fresh tank') + ' — move closest for the health-based handoff.' : f.lowHealth && !fresh ? 'Health is low; no fresh tank is loaded.' : f.lowHealth ? 'Health is low in this example: prepare a fresh tank for the next check.' : 'Hold the current tank while health, shields and cooldowns are enough.'],
            ['Raid priority', drainLesson ? 'No healing or mana regeneration. Healers DPS; dispel magic first.' : 'Fixate checks closest every five seconds; do not swap automatically.']
        ];
        if (drainLesson) f.instructionRows.push(['Tank survival', enrageLesson ? 'Prepared tank uses available cooldowns and avoidance for Enrage; no fixed rotation is required.' : (sc.absorber ? nameOf(sc, sc.absorber, 'Priest') + ' shields the current tank.' : 'Use available absorbs and cooldowns as needed.')]);
    }
    function souls(fight, sc, f, t, carryState = null) {
        f.phase = 1; f.essence = 'Souls'; f.stage = 'souls'; f.bossTarget = null; f.call = sc.hasDamage ? 'Gather souls at the group. Kill them here to recover.' : 'No damage role loaded: souls are gathered but not fabricated as dead.';
        const group = point(fight, 90, 19), spawns = [1000, 1800, 2600], froms = [{ x: .34, y: .72 }, { x: .5, y: .78 }, { x: .66, y: .72 }];
        f.souls = spawns.map((start, i) => { const k = clamp((t - start) / 3000); const deadAt = [5000, 6500, 8000][i]; return { id: 'soul' + i, at: interpolate(froms[i], group, k), dead: sc.hasDamage && t >= deadAt, gathered: t >= 4000 }; });
        f.soulById = Object.fromEntries(f.souls.map(soul => [soul.id, soul]));
        const recovered = f.souls.filter(s => s.dead).length, baseHp = carryState?.hp || Object.fromEntries(sc.raid.map(p => [p.id, .55])), baseMana = carryState?.mana ?? 55;
        Object.keys(f.hp).forEach(id => { f.hp[id] = clamp((baseHp[id] ?? 1) + recovered * .13); });
        f.maxMana = 100; f.mana = clamp(baseMana + recovered * 13, 0, f.maxMana);
        sc.raid.forEach(p => { f.jobs[p.id] = p.kind === 'tank' ? 'Gather souls at the group' : p.kind === 'healer' ? 'Stabilize the recovery window' : 'Kill gathered souls at the group'; });
        f.instructionRows = [['Gather', 'Bring incoming ghosts to the raid.' ], ['Kill', 'Kill them near the raid to restore health and mana.']];
        sc.tanks.forEach(id => { f.pos[id] = { ...group }; });
        const killer = sc.raid.find(p => p.kind === 'melee' || p.kind === 'ranged');
        const dead = f.souls.filter(s => s.dead).at(-1);
        if (f.souls.find(s => !s.gathered)) { f.actions = [{ kind: 'gather', sourceId: sc.tanks[0] || null, targetId: 'raid', label: 'Tanks · gather souls here', result: 'Bring ghosts to raid', at: 1000, duration: 3000, progress: clamp((t - 1000) / 3000) }]; f.teaching = { step: 'Souls', title: 'Gather ghosts at the raid', detail: 'Do not kill them across the room.' }; }
        else if (dead && killer) { const diedAt = [5000, 6500, 8000][Number(dead.id.slice(-1))], elapsed = t - diedAt; const action = elapsed < 500 ? { kind: 'soul-kill', sourceId: killer.id, targetId: dead.id, visualToId: dead.id, label: nameOf(sc, killer.id, 'Damage') + ' kills gathered soul', result: 'Recovery triggers at its death', at: diedAt, duration: 500 } : { kind: 'soul-recovery', sourceId: dead.id, targetId: 'raid', visualFromId: dead.id, visualToId: 'raid', label: 'Soul death reaches raid', result: 'Health + mana return together', at: diedAt + 500, duration: 1000 }; action.progress = clamp((t - action.at) / action.duration); f.actions = [action]; f.teaching = { step: 'Souls', title: action.kind === 'soul-kill' ? 'Kill the gathered soul' : 'Soul recovery reaches the raid', detail: 'Only souls killed at the raid restore health and mana.' }; }
        f.bossVisible = false; f.bossOpacity = 0;
    }
    function desire(fight, sc, f, t, carry = 0) {
        f.phase = 2; f.phaseTimeMs = t; f.essence = 'Desire'; f.stage = 'desire'; const displayDuration = sc.id === 'cycle' ? 28000 : 14000, elapsedMs = t >= displayDuration - 1 ? 160000 : clamp(t / displayDuration * 160000, 0, 160000); f.maxMana = clamp(100 * (1 - elapsedMs / 160000), 0, 100); f.mana = Math.min(f.maxMana, Math.max(0, 72 - elapsedMs / 4000 + carry));
        const damage = sc.raid.filter(p => p.kind === 'melee' || p.kind === 'ranged');
        const pulses = [2000, 5000, 8000].filter(x => t >= x); f.recoil = pulses.map((at, i) => ({ at, targetId: damage[i % Math.max(1, damage.length)]?.id || null, progress: clamp((t - at) / 900) }));
        pulses.forEach((_, i) => { const p = damage[i % Math.max(1, damage.length)]; if (p) f.hp[p.id] = .67; });
        if (pulses.some(at => t >= at + 1800) && sc.raid.some(p => p.kind === 'healer')) Object.keys(f.hp).forEach(id => { f.hp[id] = Math.max(f.hp[id], .83); });
        const recoil = f.recoil.at(-1), healer = sc.raid.find(p => p.kind === 'healer');
        f.manaState = { maxMana: f.maxMana, elapsedMs, fightDurationMs: 160000, accelerated: true, detail: 'Accelerated fight time: maximum mana reaches zero at 2:40.' };
        if (recoil?.targetId) { const elapsed = t - recoil.at; const action = elapsed < 300 ? { kind: 'damage', sourceId: recoil.targetId, targetId: 'essence', label: nameOf(sc, recoil.targetId, 'Damage') + ' · hit Desire', result: '50% returns to attacker', at: recoil.at, duration: 300 } : elapsed < 900 ? { kind: 'reflection', sourceId: 'essence', targetId: recoil.targetId, label: '50% recoil returns', result: 'Same player takes the return damage', at: recoil.at + 300, duration: 600 } : healer ? { kind: 'heal', sourceId: healer.id, targetId: recoil.targetId, label: nameOf(sc, healer.id, 'Healer') + ' · recover recoil', result: 'Healing is doubled', at: recoil.at + 900, duration: 900 } : null; if (action) { action.progress = clamp((t - action.at) / action.duration); f.actions = [action]; } f.teaching = { step: 'Desire', title: action?.label || 'Damage reflects to its attacker', detail: '50% returns to that player; healing is doubled. Maximum mana keeps shrinking toward zero at 2:40.' }; }
        sc.raid.forEach(p => { f.jobs[p.id] = p.kind === 'healer' ? 'Heal reflected recoil' : p.kind === 'tank' ? 'Hold Desire in position' : 'Damage carefully through recoil'; });
        f.instructionRows = [['Damage and healing', '50% damage reflects; healing is doubled.'], ['Mana', 'Maximum mana shrinks to zero by 2:40.']];
        f.call = pulses.length ? 'Damage recoils. Healers recover under a shrinking maximum-mana ceiling.' : 'Damage starts recoil; preserve mana for the later pulses.';
    }
    function interrupts(sc, f, t, deaden) {
        f.phase = 2; f.essence = 'Desire'; f.stage = deaden ? 'deaden' : 'interrupts';
        const second = !deaden && t >= 8000, start = deaden ? 3000 : (second ? 8000 : 2000), castDuration = deaden ? 1000 : (sc.tongues ? 1600 : 1000), eligible = start + castDuration, kickIndex = deaden ? 2 : (second ? 1 : 0), kicker = sc.kickers[kickIndex % Math.max(1, sc.kickers.length)] || null;
        f.cast = { active: t >= start && t < eligible, interrupted: !!kicker && t >= eligible, kind: deaden ? 'Deaden' : 'Spirit Shock', sourceId: kicker, startMs: start, durationMs: castDuration, normalDurationMs: 1000, progress: clamp((t - start) / castDuration), status: t < start ? 'pending' : t < eligible ? 'casting' : kicker ? 'interrupted' : 'missed' };
        if (!deaden && t >= 5000) f.shield = { active: !(sc.remover && t >= 7000), removedBy: sc.remover || null, removed: !!sc.remover && t >= 7000 };
        if (!deaden && t >= 8000) f.cast.interrupted = !!sc.kickers.length && !f.shield.active && t >= eligible;
        sc.raid.forEach(p => { f.jobs[p.id] = p.kind === 'healer' ? 'Cover cast damage' : 'Hold for the interrupt call'; });
        if (sc.remover && f.shield.active) f.jobs[sc.remover] = (cls(sc.raid.find(p => p.id === sc.remover) || {}) === 'MAGE' ? 'Spellsteal Rune Shield' : 'Purge/dispel Rune Shield');
        if (kicker) f.jobs[kicker] = f.cast.interrupted ? 'Interrupted ' + f.cast.kind : 'Next ' + f.cast.kind + ' kick';
        if (sc.tongues) f.jobs[sc.tongues] = 'Curse of Tongues';
        const nextKicker = sc.kickers[(kickIndex + 1) % Math.max(1, sc.kickers.length)] || null;
        [kicker, nextKicker].filter(Boolean).forEach(id => { f.focus[id] = true; });
        if (!deaden && sc.tongues) f.debuffs.tongues = { sourceId: sc.tongues, targetId: 'essence', label: 'Curse of Tongues', durationMs: castDuration, active: true };
        const add = action => { action.at = action.at == null ? start : action.at; action.duration = Math.max(1, action.duration || 1200); action.progress = clamp((t - action.at) / action.duration); f.actions = [action]; };
        if (!deaden && sc.tongues && t < 1200) { add({ kind: 'tongues', sourceId: sc.tongues, targetId: 'essence', label: nameOf(sc, sc.tongues, 'Warlock') + ' · Curse of Tongues', result: '1.0s cast becomes 1.6s', at: 0 }); f.teaching = { step: '1', title: 'Curse of Tongues stays up', detail: 'The Warlock increases Spirit Shock cast time by 60% for a bigger kick window.' }; }
        else if (!deaden && f.shield.active) { add({ kind: 'shield-block', sourceId: 'essence', targetId: second ? kicker : nextKicker, label: 'Rune Shield blocks kick', result: 'Do not interrupt yet', at: 5000, duration: 2000 }); f.teaching = { step: '3', title: 'Rune Shield blocks interrupts', detail: 'Mage Spellsteal first. Kicking now fails.', currentKickerId: kicker, nextKickerId: second ? kicker : nextKicker, missedConsequence: 'Spirit Shock incapacitates the tank and swaps threat.' }; }
        else if (!deaden && f.shield.removed && t < 8000 && sc.remover) { const mage = cls(sc.raid.find(p => p.id === sc.remover) || {}) === 'MAGE'; if (mage) f.shield.stolenBy = sc.remover; add({ kind: mage ? 'spellsteal' : 'purge', sourceId: sc.remover, targetId: 'essence', visualFromId: 'essence', visualToId: sc.remover, label: nameOf(sc, sc.remover, mage ? 'Mage' : 'Dispeller') + ' · ' + (mage ? 'Spellsteal Rune Shield' : 'purge Rune Shield'), result: mage ? 'Mage gains Rune Shield' : 'Shield removed', at: 7000, duration: 1000 }); f.teaching = { step: '4', title: mage ? 'Mage steals Rune Shield' : 'Fallback dispel removes Shield', detail: 'The next interrupt can now land.', nextKickerId: nextKicker, missedConsequence: 'A missed Spirit Shock incapacitates the tank and swaps threat.' }; }
        else if (f.cast.interrupted && kicker && !deaden) { add({ kind: 'kick', sourceId: kicker, targetId: 'essence', label: nameOf(sc, kicker, 'Interrupter') + ' · kick ' + f.cast.kind, result: f.cast.kind + ' stopped', at: eligible, duration: 2200 }); f.teaching = { step: '5', title: f.cast.kind + ' stopped', detail: 'Next: ' + (nextKicker ? nameOf(sc, nextKicker, 'assigned kicker') + ' takes the next Spirit Shock.' : 'assign the next kick.') , nextKickerId: nextKicker, missedConsequence: 'A missed Spirit Shock incapacitates the tank and swaps threat.' }; }
        else if (deaden && f.cast.active) { add({ kind: 'deaden-warning', sourceId: 'essence', targetId: kicker, label: 'Deaden · 2× incoming damage', result: 'Kick it now', at: start, duration: castDuration }); f.teaching = { step: '1', title: 'Deaden doubles incoming damage', detail: 'Assigned kick stops it.', tip: 'Optional: coordinated Protection Warrior Spell Reflection returns the doubled-damage effect.' }; }
        else if (deaden && f.cast.interrupted) { if (t < 5000) add({ kind: 'kick', sourceId: kicker, targetId: 'essence', label: nameOf(sc, kicker, 'Interrupter') + ' interrupts Deaden', result: 'Deaden stopped', at: eligible, duration: 1000 }); const rogue = sc.raid.find(p => cls(p) === 'ROGUE'), prot = sc.raid.find(p => p.kind === 'tank' && cls(p) === 'WARRIOR'); f.teaching = { step: '2', title: 'Deaden interrupted', detail: 'Normal assigned kick is the plan.', tip: prot ? 'Optional Protection Warrior Spell Reflection is a coordinated alternative.' : rogue ? 'Optional Rogue arena gloves can provide a Deadly Throw backup interrupt.' : undefined }; if (prot && t >= 5000 && t < 7500) f.tipVisual = { kind: 'spell-reflection', sourceId: prot.id, targetId: 'essence', progress: clamp((t - 5000) / 2500), label: 'Protection Warrior Spell Reflection', optional: true }; else if (rogue && t >= 7500) f.tipVisual = { kind: 'glove-backup', sourceId: rogue.id, targetId: 'essence', progress: clamp((t - 7500) / 2500), label: 'Rogue arena gloves · Deadly Throw backup interrupt', optional: true }; }
        else { if (f.cast.active) add({ kind: 'cast', sourceId: 'essence', targetId: kicker, label: f.cast.kind + ' · ' + (sc.tongues ? '1.6s slowed cast' : '1.0s cast'), result: kicker ? nameOf(sc, kicker, 'Assigned kicker') + ' is ready' : 'No kick assigned', at: start, duration: castDuration }); f.teaching = { step: '2', title: f.cast.kind + (f.cast.active ? ' is casting' : f.cast.status === 'missed' ? ' was missed' : ' · assigned kicker ready'), detail: !deaden && sc.tongues ? 'Tongues makes the one-second cast 1.6 seconds. ' : 'Without Tongues this is a one-second cast. ' + (kicker ? nameOf(sc, kicker, 'Assigned player') + ' kicks it.' : 'No kick is assigned.'), nextKickerId: kicker, missedConsequence: 'A missed Spirit Shock incapacitates the tank and swaps threat.' }; }
        if (!deaden) { f.teaching.tonguesId = sc.tongues || null; if (f.shield.active) f.teaching.removerId = sc.remover || null; }
        const firstEligible = 2000 + (sc.tongues ? 1600 : 1000), firstCompleted = !deaden && t >= firstEligible && t < 8000 && !!sc.kickers[0] && f.cast.interrupted;
        const completedKicker = firstCompleted ? sc.kickers[0] : !deaden && t >= 8000 + (sc.tongues ? 1600 : 1000) && !!sc.kickers.length && f.cast.interrupted ? sc.kickers[1 % sc.kickers.length] : null;
        const upcoming = firstCompleted ? sc.kickers[1 % Math.max(1, sc.kickers.length)] : nextKicker;
        const kickRows = firstCompleted
            ? [['Completed kick', nameOf(sc, completedKicker, 'Kick 1') + (sc.tongues ? ' — completed slowed Spirit Shock at 0:03.6.' : ' — completed Spirit Shock at 0:03.')], ['Next kick', upcoming ? nameOf(sc, upcoming, 'Kick 2') + ' — next Spirit Shock at 0:08.' : 'No next kicker available.']]
            : completedKicker
                ? [['Completed kick', nameOf(sc, completedKicker, 'Kick 2') + ' — completed Spirit Shock.'], ['Next kick', upcoming ? nameOf(sc, upcoming, 'Kick 1') + ' — first in the repeating order.' : 'No next kicker available.']]
                : [['Current kick', kicker ? nameOf(sc, kicker, 'Kick ' + (kickIndex + 1)) + ' — ' + f.cast.kind + (f.cast.active ? ' now' : ' at 0:02') : 'No known interrupt available.'], ['Next kick', nextKicker ? nameOf(sc, nextKicker, 'Kick ' + ((kickIndex + 1) % Math.max(1, sc.kickers.length) + 1)) + ' — next Spirit Shock.' : 'No next kicker available.']];
        f.instructionRows = [
            ...kickRows,
            ['Curse of Tongues', sc.tongues ? nameOf(sc, sc.tongues, 'Warlock') + ' — keep it up for longer casts and reaction time.' : 'No known Warlock: casts stay at their normal speed.']
        ];
        if (!deaden) f.instructionRows.push(['Shield remover', sc.remover ? nameOf(sc, sc.remover, 'Mage') + (cls(sc.raid.find(p => p.id === sc.remover) || {}) === 'MAGE' ? ' — Spellsteal Rune Shield first.' : ' — purge/dispel Rune Shield; Mage Spellsteal preferred when available.') : 'No known shield removal: never kick into Rune Shield.']);
        else f.instructionRows.push(['Deaden', 'Kick it; Protection Warrior Spell Reflection is an optional coordinated alternative.']);
        f.call = f.shield.active ? 'Rune Shield active: remove it before the next kick.' : f.cast.active ? f.cast.kind + ' casting — assigned kick ready.' : f.cast.interrupted ? f.cast.kind + ' interrupted on the assigned call.' : kicker ? 'Next ' + f.cast.kind + ' kick assigned.' : 'No assigned interrupt is available.';
    }
    function anger(fight, sc, f, t, spite) {
        f.phase = 3; f.phaseTimeMs = t; f.essence = 'Anger'; f.stage = spite ? 'spite' : 'anger';
        const first = sc.tanks[0] || null, second = sc.tanks[1] || null; f.bossTarget = spite ? first : (second && t < 2000 ? second : first);
        sc.tanks.filter(id => id !== f.bossTarget).forEach((id, i) => { f.pos[id] = point(fight, 78 + i * 24, 15); });
        if (f.bossTarget) { f.pos[f.bossTarget] = point(fight, 270, 8); f.focus[f.bossTarget] = true; }
        const cycleSpite = spite && sc.id === 'cycle', spiteTime = spite ? (cycleSpite ? Math.max(0, t - 13000) : t) : t, markAt = 3000, impactAt = 9000;
        if (spite && spiteTime >= markAt) { const targets = sc.raid.filter(p => p.id !== first).slice(0, 3), hasHealer = sc.raid.some(p => p.kind === 'healer'); f.spite = targets.map(p => ({ targetId: p.id, immune: spiteTime < impactAt, impacted: spiteTime >= impactAt })); f.spite.forEach(s => { f.hp[s.targetId] = s.impacted ? (hasHealer && spiteTime >= impactAt + 2500 ? .82 : .48) : .95; f.focus[s.targetId] = true; }); }
        const tank = sc.raid.find(p => p.id === f.bossTarget), tankClass = cls(tank || {}), resourceKind = /WARRIOR|DRUID/.test(tankClass) ? 'Rage' : tankClass === 'PALADIN' ? 'Mana' : null;
        const startResource = resourceKind === 'Mana' ? 88 : 78, spent = t >= 12000 ? 30 : 0, resourceValue = resourceKind ? clamp(startResource - Math.floor(t / 3000) * 4 - spent, 12, 100) : null;
        const screamValue = resourceKind ? clamp(startResource - Math.floor(14000 / 3000) * 4 - 30, 12, 100) : null, unspentValue = resourceKind ? clamp(startResource - Math.floor(14000 / 3000) * 4, 12, 100) : null;
        const hitFor = value => value === null ? .25 : clamp(.12 + value / 100 * .16, .14, .32);
        const tankHit = !spite && t >= 14000 ? hitFor(screamValue) : 0;
        f.seethe = { active: !spite && !!second && t >= 2000 && t < 12000, label: 'Seethe · 10 sec' }; f.scream = { active: !spite && t >= 14000, facing: 'front', tankHit, resourceKind, resourceValue: screamValue, unspentHit: hitFor(unspentValue) };
        f.lust = { active: !!first && !!sc.luster && (spite ? t >= 1000 : t >= 6000), sourceId: first ? sc.luster || null : null };
        f.pressure = clamp(t / 18000); if (sc.hasDamage && t >= 6000) f.bossHp = clamp(1 - (t - 6000) / 26000);
        f.tankResource = resourceKind ? { kind: resourceKind, value: resourceValue, spent, spendCue: !spite && t >= 6000 && t < 14000 } : null;
        const pulseTimes = [];
        for (let at = 3000; at <= t; at += 3000) pulseTimes.push(at);
        f.raidCount = sc.raid.length;
        f.shadowPulses = pulseTimes.map((at, i) => {
            const atSpiteTime = cycleSpite ? at - 13000 : at, immuneAt = spite && atSpiteTime >= markAt && atSpiteTime < impactAt;
            const markedAt = spite && atSpiteTime >= markAt ? new Set(sc.raid.filter(p => p.id !== first).slice(0, 3).map(p => p.id)) : new Set();
            return { at, phaseTimeMs: at, targetIds: sc.raid.map(p => p.id).filter(id => !(immuneAt && markedAt.has(id))), loss: .05 + i * .015, progress: clamp((t - at) / 1000) };
        });
        sc.raid.forEach(p => {
            let loss = 0, recovery = 0;
            f.shadowPulses.filter(pulse => pulse.targetIds.includes(p.id)).forEach(pulse => { loss += pulse.loss; if (sc.raid.some(q => q.kind === 'healer') && t >= pulse.at + 1200) recovery += pulse.loss * .42; });
            f.hp[p.id] = clamp(1 - loss + recovery);
        });
        if (f.bossTarget && tankHit) f.hp[f.bossTarget] = clamp(f.hp[f.bossTarget] - tankHit);
        if (spite && spiteTime >= markAt) { const hasHealer = sc.raid.some(p => p.kind === 'healer'); f.spite.forEach(s => { if (s.immune) f.hp[s.targetId] = .95; else { let laterLoss = 0, laterRecovery = 0; f.shadowPulses.filter(p => p.targetIds.includes(s.targetId) && (cycleSpite ? p.at - 13000 : p.at) >= impactAt).forEach(p => { laterLoss += p.loss; if (hasHealer && t >= p.at + 1200) laterRecovery += p.loss * .42; }); f.hp[s.targetId] = clamp((hasHealer && spiteTime >= impactAt + 2500 ? .82 : .48) - laterLoss + laterRecovery); } }); }
        sc.raid.forEach(p => { f.jobs[p.id] = !first ? 'Hold damage: Anger pickup unassigned' : p.id === f.bossTarget ? 'Hold Anger facing away' : p.kind === 'tank' ? 'Wait behind the boss' : p.kind === 'healer' ? 'Heal tank and marked players' : t < 6000 && !spite ? 'Wait for MT taunt' : 'Burn Anger from behind'; });
        const angerHasHealer = sc.raid.some(p => p.kind === 'healer');
        if (spite && spiteTime >= markAt) f.spite.forEach(s => { f.focus[s.targetId] = true; f.jobs[s.targetId] = s.impacted ? (angerHasHealer ? 'Recover after Spite' : 'Recovery uncovered') : 'Spite mark · prepare'; });
        f.call = !first ? 'No tank loaded: assign Anger pickup before damage.' : spite ? (spiteTime < impactAt ? 'Spite marks immune for six seconds. Top them before impact.' : angerHasHealer ? 'Spite impacts. Heal marked players while damage burns.' : 'Spite hit: healing coverage missing.') : !second ? (t < 6000 ? 'Single-tank pickup. Hold damage until control; no two-tank handoff is shown.' : 'Single tank secure. Damage and available Bloodlust start at 0:06.') : (t < 2000 ? 'OT pickup. Damage waits for MT taunt.' : t < 6000 ? 'MT taunt at 0:02. Seethe is active; hold damage for four seconds.' : t < 14000 ? 'Damage and available Bloodlust start at 0:06. Keep the front clear.' : 'Soul Scream front clear.');
        const healer = sc.raid.find(p => p.kind === 'healer');
        if (!spite && second && t < 2000) f.actions.push({ kind: 'pickup', sourceId: second, targetId: 'essence', label: nameOf(sc, second, 'OT') + ' · pick up Anger', result: 'Raid waits' });
        if (!spite && second && t >= 2000 && t < 6000) f.actions = [{ kind: 'taunt', sourceId: first, targetId: 'essence', label: nameOf(sc, first, 'MT') + ' · taunt at 0:02', result: 'Wait ' + Math.max(0, 6 - Math.ceil(t / 1000)) + 's before raid damage', at: 2000, duration: 4000, progress: clamp((t - 2000) / 4000) }];
        if (!spite && !second && t < 2000) f.actions = [{ kind: 'shadow-protection', sourceId: 'raid', targetId: 'essence', label: 'Before Anger · Shadow Protection', result: 'Healthstones after Spite', at: 0, duration: 1800, progress: clamp(t / 1800) }];
        if (!spite && t >= 6000 && sc.hasDamage && first) f.actions = [{ kind: 'burn', sourceId: 'raid', targetId: 'essence', visualFromId: sc.luster || 'raid', label: 'Raid · start damage', result: f.lust.active ? nameOf(sc, sc.luster, 'Shaman') + ' · Bloodlust now' : 'Threat set first', at: 6000, duration: 2200, progress: clamp((t - 6000) / 2200) }];
        if (!spite) f.teaching = !first ? { step: 'Anger', title: 'No tank pickup assigned', detail: 'Do not burn Anger until a tank has control.' } : !second ? { step: 'Anger', title: 'Single tank establishes Anger', detail: t < 6000 ? 'Raid waits until 0:06; no two-tank taunt is illustrated.' : 'Threat is set. Raid damage and available Bloodlust begin.' } : t < 2000 ? { step: '1', title: 'OT picks up Anger', detail: 'Shadow Protection before the phase; raid waits.' } : t < 6000 ? { step: '2', title: 'MT taunts at 0:02', detail: 'Wait ' + Math.max(0, 6 - Math.ceil(t / 1000)) + 's before raid damage. Seethe is tank survival.' } : { step: '3', title: 'Threat set: raid burns', detail: 'Use available Bloodlust now. Shadow pressure rises; keep Soul Scream frontal clear.' };
        if (!spite && t < 2000) { const priest = sc.raid.find(p => cls(p) === 'PRIEST'); if (priest) f.tipVisual = { kind: 'shadow-protection', sourceId: priest.id, targetId: 'raid', progress: clamp(t / 2000), label: 'Shadow Protection before Anger', optional: false }; }
        if (spite && f.spite.length) { const marked = f.spite[0], targetIds = f.spite.map(mark => mark.targetId), seconds = Math.max(0, Math.ceil((impactAt - spiteTime) / 1000)); let action; if (!marked.impacted && spiteTime < 7200) action = { kind: 'spite-countdown', sourceId: 'essence', targetId: marked.targetId, targetIds, label: 'Spite ×3 · ' + seconds + 's immunity', result: 'Marks stay in place; heal before impact', at: markAt, duration: 4200 }; else if (!marked.impacted && healer) action = { kind: 'pre-spite-heal', sourceId: healer.id, targetId: marked.targetId, targetIds, label: nameOf(sc, healer.id, 'Healer') + ' · top Spite marks', result: seconds + 's to ~7500 Nature impact', at: 7200, duration: 1800 }; else if (marked.impacted && spiteTime < 10800) action = { kind: 'spite-impact', sourceId: 'essence', targetId: marked.targetId, targetIds, label: 'Spite ×3 · ~7500 Nature', result: healer ? 'Healthstone, then healer recovery' : 'Recovery uncovered', at: impactAt, duration: 1800 }; else if (healer) action = { kind: 'heal', sourceId: healer.id, targetId: marked.targetId, targetIds, label: nameOf(sc, healer.id, 'Healer') + ' · recover Spite', result: 'Healthstone reminder', at: 10800, duration: 2200 }; if (action) { action.progress = clamp((spiteTime - action.at) / action.duration); f.actions = [action]; } f.teaching = { step: 'Spite', title: action?.label || 'Spite', detail: !marked.impacted ? 'Three marked players have ' + seconds + ' seconds of immunity; heal them before impact.' : 'Impact landed. Recover marked players and use healthstones.' }; if (marked.impacted) f.tipVisual = { kind: 'healthstone', sourceId: marked.targetId, targetId: marked.targetId, progress: clamp((spiteTime - impactAt) / 2200), label: 'healthstone after Spite impact', optional: true }; }
        if (!spite) f.instructionRows = !first ? [
            ['Tank pickup', 'No tank loaded: assign Anger pickup before damage.'],
            ['Raid damage + Bloodlust', 'Hold damage: no tank pickup is assigned.'],
            ['Anger survival', 'Shadow Protection before phase; healthstones after Spite. Keep Soul Scream frontal clear.']
        ] : !second ? [
            ['Tank pickup', nameOf(sc, first, 'Tank') + ' — pick up Anger at pull and face it away. No two-tank handoff is shown.'],
            ['Raid damage + Bloodlust', t < 6000 ? 'Hold damage until the tank has control; start no earlier than 0:06.' : 'start now at 0:06; use available Bloodlust and burn from behind.'],
            ['Anger survival', 'Shadow Protection before phase; healthstones after Spite. Keep Soul Scream frontal clear.']
        ] : [
            ['OT pickup', nameOf(sc, second, 'OT') + ' — pick up Anger at pull.'],
            ['MT taunt', nameOf(sc, first, 'MT') + (t < 2000 ? ' — taunt at 0:02.' : ' — taunted at 0:02; hold Anger facing away.')],
            ['Raid damage + Bloodlust', t < 6000 ? 'Wait. Start at 0:06, four seconds after MT taunt.' : 'start now at 0:06; use available Bloodlust and burn from behind.'],
            ['Seethe', t >= 2000 && t < 12000 ? 'Active for 10 seconds after the taunt: tank survival cue.' : 'Separate target-swap survival cue; it does not delay damage after 0:06.'],
            ['Anger survival', 'Shadow Protection before phase; healthstones after Spite. Keep Soul Scream frontal clear.']
        ];
        else if (spiteTime >= markAt) f.instructionRows = [['Spite marks', 'Three players are immune for six seconds; top them before about 7500 Nature damage.'], ['After impact', angerHasHealer ? 'Heal marked players; they use healthstones after Spite.' : 'Healing coverage missing after Spite.'], ['Burn', 'Keep damage running; Anger raid and Shadow damage rise over time.']];
    }
    function simulate(fight, sc, time) {
        const f = baseFrame(fight, sc, time), t = f.timeMs;
        if (sc.id === 'fixate' || sc.id === 'suffering') suffering(fight, sc, f, t);
        else if (sc.id === 'souls') souls(fight, sc, f, t);
        else if (sc.id === 'desire') desire(fight, sc, f, t);
        else if (sc.id === 'interrupts') interrupts(sc, f, t, false);
        else if (sc.id === 'deaden') interrupts(sc, f, t, true);
        else if (sc.id === 'anger') anger(fight, sc, f, t, false);
        else if (sc.id === 'spite') anger(fight, sc, f, t, true);
        else if (sc.id === 'cycle') {
            if (t < 20000) suffering(fight, sc, f, t);
            else if (t < 32000) { const prior = baseFrame(fight, sc, 0); suffering(fight, sc, prior, 19999); souls(fight, sc, f, t - 20000, { hp: prior.hp, mana: prior.mana }); }
            else if (t < 60000) { desire(fight, sc, f, t - 32000, 20); if (t >= 40000 && t < 50000) interrupts(sc, f, t - 40000, false); else if (t >= 50000) interrupts(sc, f, t - 50000, true); }
            else if (t < 72000) { const prior = baseFrame(fight, sc, 0); desire(fight, sc, prior, 27999, 20); souls(fight, sc, f, t - 60000, { hp: prior.hp, mana: prior.mana }); }
            else { anger(fight, sc, f, t - 72000, t >= 88000); if (t >= 99000 && sc.hasDamage) { f.stage = 'complete'; f.bossHp = 0; f.bossTarget = null; f.pressure = 0; f.tankResource = null; f.call = 'Reliquary defeated. No active jobs remain.'; f.roles = {}; f.jobs = {}; f.focus = {}; f.instructionRows = []; f.actions = []; f.teaching = { title: '', detail: '', step: '' }; f.debuffs = {}; f.lust = { active: false, sourceId: null }; f.scream = { active: false, facing: null, tankHit: 0, resourceKind: null }; f.spite = []; f.seethe = { active: false }; f.shadowPulses = []; f.drains = []; f.absorbs = []; f.recoil = []; f.cast = { active: false, interrupted: false, kind: null }; f.shield = { active: false }; } }
        } else if (sc.id === 'overview') { f.essence = t < 1500 ? 'Suffering' : t < 2800 ? 'Souls' : t < 4200 ? 'Desire' : t < 5200 ? 'Souls' : 'Anger'; f.call = 'Suffering → souls → Desire → souls → Anger.'; f.phasePlan = [{ phase: '1 Suffering', rule: 'No healing: hold while safe; hand off by health, shields and cooldowns; dispel, shield, DPS.' }, { phase: 'Souls', rule: 'Gather and kill at raid for recovery.' }, { phase: '2 Desire', rule: 'Tongues, remove Shield, assigned kicks.' }, { phase: 'Souls', rule: 'Recover again after shrinking mana.' }, { phase: '3 Anger', rule: 'OT, MT taunt, then burn and Bloodlust.' }]; f.teaching = { step: 'Plan', title: 'Three essences, one sequence', detail: 'Suffering → souls → Desire → souls → Anger. Each phase changes the raid job.' }; }
        else { f.essence = 'Suffering'; f.stage = 'positioning'; f.call = sc.call; }
        if (!f.teaching.title && f.stage !== 'complete') f.teaching = { step: f.stage, title: sc.title, detail: f.call || sc.call };
        const active = f.actions[0];
        if (active) [active.sourceId, active.targetId, active.visualFromId, active.visualToId, ...(active.targetIds || [])].filter(id => id && id !== 'essence' && id !== 'raid' && !String(id).startsWith('soul')).forEach(id => { f.focus[id] = true; });
        if (f.teaching.nextKickerId) f.focus[f.teaching.nextKickerId] = true;
        if (!f.instructionRows.length && f.stage !== 'complete') f.instructionRows = sc.jobs.map(([role, job]) => [role, job]);
        return f;
    }
    function copyText(fight, sc, frame) {
        const lines = [fight.name + ' — ' + frame.essence + ' · ' + frame.stage, '', frame.call];
        if (frame.instructionRows?.length) lines.push('', 'Live instructions', ...frame.instructionRows.map(([label, action]) => '  ' + label + ' — ' + action));
        if (sc.missingRoles.length) lines.push('', 'Coverage notes', ...sc.missingRoles.map(x => '  ' + x));
        const job = p => {
            if (frame.stage === 'complete') return 'no active combat job';
            if (frame.jobs[p.id]) return frame.jobs[p.id];
            if (frame.roles[p.id]) return frame.roles[p.id];
            if (frame.essence === 'Suffering') return p.kind === 'tank' ? 'hold your assigned distance' : p.kind === 'healer' ? 'support the assigned tank' : 'damage safely';
            if (frame.essence === 'Souls') return p.kind === 'tank' ? 'gather souls at the group' : p.kind === 'healer' ? 'stabilize recovery' : 'kill gathered souls';
            if (frame.essence === 'Desire') return p.kind === 'healer' ? 'heal recoil and manage mana' : p.kind === 'tank' ? 'hold Desire in position' : 'follow the interrupt / damage call';
            return p.kind === 'tank' ? 'hold Anger facing away' : p.kind === 'healer' ? 'cover tank and Spite marks' : 'wait for threat, then burn';
        };
        const named = sc.raid.filter(p => p.name); if (named.length) { lines.push('', 'Current roster'); named.forEach(p => lines.push('  ' + p.name + ' — ' + job(p))); }
        return lines.join('\n');
    }
    return { prepareScene, simulate, copyText };
}));
