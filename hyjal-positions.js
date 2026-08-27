(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.HyjalPositions = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    // Every coordinate is a fraction of the map image: x of width, y of height. The map can
    // be swapped for another screenshot of the same viewport without touching code. Distance
    // math converts y through the image aspect so rings stay circular on screen.
    const ENCOUNTERS = {
        'hyjal-b12': {
            id: 'hyjal-b12',
            name: 'Hyjal · Rage Winterchill & Anetheron',
            map: 'maps/hyjal-ballista.png',
            aspect: 1698 / 926,
            bosses: [
                { id: 'winterchill', name: 'Rage Winterchill' },
                { id: 'anetheron', name: 'Anetheron',
                  station: { x: 0.65, y: 0.12, label: 'Infernals → Jaina' } },
            ],
            // Digitized from maps/reference-winterchill-annotated.png (same viewport).
            anchors: {
                boss: { x: 0.56, y: 0.40 },
                mt: { x: 0.60, y: 0.37 },
                clump: { x: 0.53, y: 0.46 },
            },
            ring: { rBase: 0.145, rJitter: 0.018, startDeg: -90 },
        },
    };

    function slotAngles(n, startDeg) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(startDeg + i * 360 / n);
        return out;
    }

    function angleToXY(center, r, deg, aspect) {
        const rad = deg * Math.PI / 180;
        return { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) * aspect };
    }

    function circGap(a, b) {
        let d = Math.abs(a - b) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    function roleOf(p) {
        const b = E.bucketOf(p);
        if (b === 'tanks') return 'tank';
        if (b === 'healers') return 'healer';
        if (b === 'melee') return 'melee';
        return 'ranged'; // casters + hunters both live on the ring
    }

    function interleaveHealers(players, isHealer) {
        const healers = players.filter(isHealer);
        const others = players.filter(p => !isHealer(p));
        if (!healers.length || !others.length) return players.slice();
        const len = players.length;
        const out = new Array(len).fill(null);
        healers.forEach((h, j) => {
            let idx = Math.floor((j + 0.5) * len / healers.length) % len;
            while (out[idx]) idx = (idx + 1) % len;
            out[idx] = h;
        });
        let k = 0;
        for (let i = 0; i < len; i++) if (!out[i]) out[i] = others[k++];
        return out;
    }

    function permutations(arr) {
        if (arr.length <= 1) return [arr.slice()];
        const out = [];
        arr.forEach((x, i) => {
            permutations(arr.slice(0, i).concat(arr.slice(i + 1)))
                .forEach(rest => out.push([x].concat(rest)));
        });
        return out;
    }

    // Angular evenness of healers plus tank-healer opposition. Higher is better.
    function scoreArrangement(ordered, isHealer, tankHealerNames, startDeg) {
        const n = ordered.length;
        const angles = slotAngles(n, startDeg);
        const healerAngles = [], thAngles = [];
        ordered.forEach((p, i) => {
            if (isHealer(p)) healerAngles.push(angles[i]);
            if (tankHealerNames.includes(p.name)) thAngles.push(angles[i]);
        });
        let minGap = 360;
        for (let i = 0; i < healerAngles.length; i++)
            for (let j = i + 1; j < healerAngles.length; j++)
                minGap = Math.min(minGap, circGap(healerAngles[i], healerAngles[j]));
        const thSep = thAngles.length === 2 ? circGap(thAngles[0], thAngles[1]) : 180;
        return 2 * minGap + thSep;
    }

    function pickTanks(roster) {
        // Flagged tanks lead (the raid leader's word beats the spec heuristic), but a partially
        // flagged roster (e.g. only the MT checked, not the OT) must not drop the unflagged
        // bucket tanks — every physical tank needs a marker somewhere.
        const flagged = roster.filter(p => p.mt);
        const bucketTanks = roster.filter(p => E.bucketOf(p) === 'tanks');
        const tanks = flagged.concat(bucketTanks.filter(p => flagged.indexOf(p) === -1));
        return { mt: tanks[0] || null, offtank: tanks[1] || null, spare: tanks.slice(2) };
    }

    function computePositions(roster, groupsResult, duties, opts) {
        opts = opts || {};
        const enc = ENCOUNTERS[opts.encounter || 'hyjal-b12'];
        const bossMode = opts.boss || 'winterchill';
        const bossDef = enc.bosses.find(b => b.id === bossMode) || enc.bosses[0];
        const nudges = opts.nudges || {};
        const markers = [];
        const warnings = [];

        const { mt, offtank, spare } = pickTanks(roster);
        const tankNames = new Set([mt, offtank].concat(spare).filter(Boolean).map(p => p.name));
        const melee = roster.filter(p => !tankNames.has(p.name) && roleOf(p) === 'melee');
        const ringPeople = roster.filter(p => !tankNames.has(p.name) && (roleOf(p) === 'healer' || roleOf(p) === 'ranged'));

        markers.push({ kind: 'boss', x: enc.anchors.boss.x, y: enc.anchors.boss.y, label: bossDef.name });
        if (mt) markers.push(person(mt, 'mt', enc.anchors.mt, null, nudges));

        const clumpNames = melee.map(p => p.name).concat(spare.map(p => p.name));
        if (bossMode === 'anetheron' && offtank) {
            markers.push({ kind: 'station', x: bossDef.station.x, y: bossDef.station.y, label: bossDef.station.label });
            markers.push(person(offtank, 'offtank', bossDef.station, null, nudges));
        } else if (offtank) {
            clumpNames.push(offtank.name);
        }
        if (clumpNames.length) {
            markers.push({ kind: 'clump', x: enc.anchors.clump.x, y: enc.anchors.clump.y, names: clumpNames });
        }

        // Party wedges: each group's ring members stay contiguous (totem range).
        const groups = (groupsResult && groupsResult.groups) || [];
        const onRing = new Set(ringPeople.map(p => p.name));
        const wedges = groups
            .map((g, i) => ({ party: i + 1, players: g.players.filter(p => onRing.has(p.name)) }))
            .filter(w => w.players.length);
        // Anyone not in a proposed group (groups cap at 25) still gets a slot. Real wedges carry
        // their ORIGINAL group index as `party` (per the interface contract), which survives the
        // filter above even when an earlier group had zero ring members — so `groups.length + 1`,
        // not `wedges.length + 1`, is the only party number guaranteed not to collide with one.
        const grouped = new Set(wedges.flatMap(w => w.players.map(p => p.name)));
        const rest = ringPeople.filter(p => !grouped.has(p.name));
        if (rest.length) wedges.push({ party: groups.length + 1, players: rest });

        const isHealer = p => roleOf(p) === 'healer';
        const tankHealRow = (duties || []).find(d => d.id === 'tankheal');
        const tankHealerNames = tankHealRow ? tankHealRow.players : [];
        const interleaved = wedges.map(w => ({ party: w.party, players: interleaveHealers(w.players, isHealer) }));
        let best = null, bestScore = -Infinity;
        permutations(interleaved).forEach(perm => {
            const flat = perm.flatMap(w => w.players);
            const s = scoreArrangement(flat, isHealer, tankHealerNames, enc.ring.startDeg);
            if (s > bestScore) { bestScore = s; best = perm; }
        });
        const ordered = (best || []).flatMap(w => w.players.map(p => ({ p, party: w.party })));
        const n = ordered.length;
        const angles = slotAngles(n, enc.ring.startDeg);
        ordered.forEach((o, i) => {
            const r = enc.ring.rBase + (i % 2 ? enc.ring.rJitter : -enc.ring.rJitter);
            const pos = angleToXY(enc.anchors.boss, r, angles[i], enc.aspect);
            const m = person(o.p, 'ring', pos, angles[i], nudges);
            m.party = o.party;
            markers.push(m);
        });

        const ringMarkers = markers.filter(m => m.kind === 'ring');
        const healerMarks = ringMarkers.filter(m => m.role === 'healer');
        if (healerMarks.length >= 2) {
            let minGap = 360;
            for (let i = 0; i < healerMarks.length; i++)
                for (let j = i + 1; j < healerMarks.length; j++)
                    minGap = Math.min(minGap, circGap(healerMarks[i].angleDeg, healerMarks[j].angleDeg));
            if (minGap < 30) warnings.push('Healers are bunched: two healers stand within 30° of each other.');
        }
        const thMarks = ringMarkers.filter(m => tankHealerNames.includes(m.name));
        if (thMarks.length === 2 && circGap(thMarks[0].angleDeg, thMarks[1].angleDeg) < 90)
            warnings.push('Tank healers are on the same side of the boss — one Carrion Swarm can hit both.');
        const byParty = {};
        ringMarkers.forEach(m => { (byParty[m.party] = byParty[m.party] || []).push(m); });
        Object.keys(byParty).forEach(pi => {
            const span = (byParty[pi].length - 1) * 360 / ringMarkers.length;
            if (span > 90) warnings.push('Party ' + pi + ' stretches over ' + Math.round(span) + '° of the ring — totem range may not cover it.');
        });

        return { markers, warnings };
    }

    function person(p, kind, pos, angleDeg, nudges) {
        const nudge = nudges[p.name] || { dx: 0, dy: 0 };
        const m = { kind, name: p.name, class: p.class, role: roleOf(p), x: pos.x + nudge.dx, y: pos.y + nudge.dy, tags: [] };
        if (angleDeg !== null) m.angleDeg = angleDeg;
        return m;
    }

    return { ENCOUNTERS, slotAngles, angleToXY, circGap, computePositions, interleaveHealers, scoreArrangement };
}));
