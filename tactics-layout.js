(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsLayout = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Where the raid stands, and where it goes when the floor catches fire.
    //
    // The room is cut into one set of slots that serves the whole fight. Healers and ranged
    // take a slot at the pull and never leave it; only the tanks and the melee move, off him
    // for Phase 2 and back onto him for Phase 1. That is the raid sheet's own instruction
    // ("as the 1 minute marker approaches, melee DPS should start moving") and it means the
    // transition scene has exactly nine things moving, which is what makes it readable.
    //
    // Everything here is pure: fractions of the map in, fractions of the map out.

    const RAID = 25;
    const COLS = 5, ROWS = 5;

    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

    // Deterministic jitter: the same room every time it is drawn.
    function rnd(seed) {
        const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Distance in yards between two points on the map.
    function dist(fight, a, b) {
        return Math.hypot(a.x - b.x, (a.y - b.y) / fight.aspect) / fight.yard;
    }

    // A yard measured down the map, as a fraction of its height.
    const ydY = (fight, n) => n * fight.yard * fight.aspect;

    // ---- the slots ------------------------------------------------------------

    // A jittered grid over the part of the room behind him, ordered by how close each spot
    // is to the boss. Order is what makes the assignment work: the tanks want the nearest
    // slots for the Phase 1 run-in, the back wants the far ones.
    function slots(fight) {
        const g = fight.grid;
        const out = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const seed = r * 31 + c * 7 + 1;
                out.push({
                    x: lerp(g.x0, g.x1, COLS === 1 ? .5 : c / (COLS - 1)) + (rnd(seed) - .5) * g.jitterX,
                    y: lerp(g.y0, g.y1, ROWS === 1 ? .5 : r / (ROWS - 1)) + (rnd(seed * 2.7) - .5) * g.jitterY
                });
            }
        }
        return out.sort((a, b) => dist(fight, a, fight.bossAt) - dist(fight, b, fight.bossAt));
    }

    // ---- who takes which ------------------------------------------------------

    // Spread the healers evenly through the ranged rather than letting them clump: sort both
    // by their position within their own group, so a run of ranged always has a healer near.
    function ditherBack(healers, ranged) {
        const deck = [];
        healers.forEach((n, i) => deck.push({ kind: 'healer', name: n, key: (i + 0.5) / healers.length }));
        ranged.forEach((n, i) => deck.push({ kind: 'ranged', name: n, key: (i + 0.5) / ranged.length + 1e-6 }));
        return deck.sort((a, b) => a.key - b.key);
    }

    // Pad or trim a roster group to the shape the room is drawn for.
    function fit(names, n) {
        const out = (names || []).slice(0, n);
        while (out.length < n) out.push(null);
        return out;
    }

    function assign(fight, roster) {
        const r = fight.roster;
        const s = slots(fight);
        const has = roster && (roster.tanks || roster.healers || roster.melee || roster.ranged);
        const tanks = fit(has ? roster.tanks : [], r.tanks);
        const melee = fit(has ? roster.melee : [], r.melee);
        const back = ditherBack(fit(has ? roster.healers : [], r.healers),
            fit(has ? roster.ranged : [], r.ranged));

        const out = [];
        let i = 0;
        const take = (kind, name) => {
            out.push({
                id: 'p' + i, kind: kind, name: name || null,
                slot: s[i], slotIndex: i
            });
            i++;
        };
        tanks.forEach(n => take('tank', n));      // the two nearest slots
        melee.forEach(n => take('melee', n));     // then the next seven
        back.forEach(p => take(p.kind, p.name));  // the rest of the room
        return out;
    }

    // ---- where they stand in each phase ---------------------------------------

    function formation(fight, phase, assigned) {
        const boss = fight.bossAt;
        const tanks = assigned.filter(p => p.kind === 'tank');
        const melee = assigned.filter(p => p.kind === 'melee');

        return assigned.map(p => {
            let at = p.slot;
            if (phase === 1 && p.kind === 'tank') {
                // stacked on him, close enough that one healer covers both
                const k = tanks.indexOf(p);
                at = {
                    x: boss.x + (k === 0 ? -1 : 1) * fight.stack.tankApart * fight.yard,
                    y: boss.y - ydY(fight, fight.stack.tankBack) + (k === 0 ? 0 : ydY(fight, 0.3))
                };
            } else if (phase === 1 && p.kind === 'melee') {
                // an arc behind him: out of the cleave, inside his melee range
                const k = melee.indexOf(p);
                const a = lerp(fight.stack.arcFrom, fight.stack.arcTo,
                    melee.length === 1 ? .5 : k / (melee.length - 1)) * Math.PI / 180;
                at = {
                    x: boss.x + Math.cos(a) * fight.stack.arcRadius * fight.yard,
                    y: boss.y + ydY(fight, Math.sin(a) * fight.stack.arcRadius)
                };
            }
            return { id: p.id, kind: p.kind, name: p.name, at: at, slot: p.slot, slotIndex: p.slotIndex };
        });
    }

    // ---- getting out of the way ------------------------------------------------

    // Push a point out of every hazard it is standing in, then keep it on the mat. Hazards
    // are {x, y, yards}; overlapping ones are resolved by pushing out of each in turn.
    function safePos(fight, home, hazards) {
        if (!hazards || !hazards.length) return home;
        let p = home, moved = false;

        for (let pass = 0; pass < 3; pass++) {
            let clear = true;
            for (let i = 0; i < hazards.length; i++) {
                const h = hazards[i];
                const d = dist(fight, p, h);
                if (d >= h.yards) continue;
                clear = false;
                moved = true;
                // straight out from the middle of it; if you are dead centre, go down the map
                let dx = p.x - h.x, dy = (p.y - h.y) / fight.aspect;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) { dx = 0; dy = 1; }
                else { dx /= len; dy /= len; }
                p = {
                    x: h.x + dx * h.yards * fight.yard,
                    y: h.y + dy * h.yards * fight.yard * fight.aspect
                };
            }
            if (clear) break;
        }
        if (!moved) return home;

        const a = fight.arena;
        return { x: clamp(p.x, a.x0, a.x1), y: clamp(p.y, a.y0, a.y1) };
    }

    // ---- the paste ------------------------------------------------------------

    // Name the part of the room a slot sits in, so a pasted list still means something to
    // somebody reading it in Discord with no picture in front of them.
    function spotName(fight, p) {
        const a = fight.arena;
        const fx = (p.x - a.x0) / (a.x1 - a.x0);
        const fy = (p.y - a.y0) / (a.y1 - a.y0);
        const across = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : 'centre';
        const down = fy < 0.36 ? 'front' : fy > 0.68 ? 'back' : 'middle';
        return across === 'centre' ? down : down + ' ' + across;
    }

    function copyText(fight, phase, assigned) {
        const placed = formation(fight, phase, assigned);
        const named = placed.filter(p => p.name);
        const lines = [fight.name + ' — where you stand, Phase ' + phase];

        if (!named.length) {
            lines.push('');
            lines.push('No roster loaded. Import one on the Assignments page and open this again.');
            return lines.join('\n');
        }

        const GROUPS = [
            ['Tanks', 'tank'], ['Melee', 'melee'], ['Healers', 'healer'], ['Ranged', 'ranged']
        ];
        GROUPS.forEach(g => {
            const rows = placed.filter(p => p.kind === g[1] && p.name);
            if (!rows.length) return;
            lines.push('');
            lines.push(g[0]);
            rows.forEach(p => {
                const where = (phase === 1 && p.kind === 'tank') ? 'stacked on him'
                    : (phase === 1 && p.kind === 'melee') ? 'behind him'
                        : spotName(fight, p.at);
                lines.push('  ' + p.name + ' — ' + where);
            });
        });

        if (phase === 1) {
            lines.push('');
            lines.push('Spread stays put all fight. Only tanks and melee move for Phase 2.');
        } else {
            lines.push('');
            lines.push('Melee and tanks are out on their own spots. Everyone else has not moved.');
        }
        return lines.join('\n');
    }

    return { slots, assign, formation, safePos, copyText, spotName, dist, RAID };
}));
