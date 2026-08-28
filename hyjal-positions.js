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
                { id: 'winterchill', name: 'Rage Winterchill', icon: 'maps/rage-winterchill-icon.png' },
                // x=0.65 put the station marker's own label right where the ring's second
                // slot (index 1, ~-69deg off boss) always lands — every offtank+station
                // label collided with that ring member's label regardless of roster. Nudged
                // right to a collision-free pocket found the same way as the clump anchor
                // below. Verified in a CDP screenshot (task 6 step 5).
                { id: 'anetheron', name: 'Anetheron', icon: 'maps/anetheron-icon.png',
                  station: { x: 0.69, y: 0.12, label: 'Infernals → Jaina' } },
            ],
            // Digitized from maps/reference-winterchill-annotated.png (same viewport).
            // The melee clump has no anchor: melee stand behind the boss (opposite the
            // tank), so its position is derived by mirroring the mt anchor through the
            // boss in computePositions.
            anchors: {
                boss: { x: 0.56, y: 0.40 },
                mt: { x: 0.60, y: 0.37 },
            },
            ring: { rBase: 0.145, rJitter: 0.018, startDeg: -90 },
        },
        'hyjal-archimonde': {
            id: 'hyjal-archimonde',
            name: 'Hyjal · Archimonde',
            map: 'maps/hyjal-archimonde.png',
            aspect: 1681 / 936,
            // Fights with fears need Tremor coverage per group; fights with curses need a
            // decurser in the raid. Both are per-encounter facts, not stack-layout facts.
            mechanics: { fears: true, curses: true },
            // Parties stand STACKED (Tremor Totem / chain-heal range), spread apart from
            // each other for Doomfire and Air Burst — no ring. Anchors digitized from the
            // user's annotated reference (2026-08-28).
            layout: 'stacks',
            // The portrait is cropped out of the map screenshot itself (the background is
            // patched with neighbouring texture where it used to be baked in).
            bosses: [{ id: 'archimonde', name: 'Archimonde', icon: 'maps/archimonde-icon.png' }],
            anchors: {
                boss: { x: 0.4896, y: 0.4989 },
                mt: { x: 0.4296, y: 0.5329 },
            },
            // Offsets from the boss anchor. Melee-majority groups take the boss-side slots,
            // everyone else spreads; extra groups past the listed slots step down-right.
            stackAnchors: {
                melee: [{ dx: 0.052, dy: -0.024 }, { dx: 0.060, dy: 0.058 }],
                spread: [
                    { dx: -0.110, dy: -0.172 }, { dx: 0.140, dy: -0.222 },
                    { dx: 0.193, dy: 0.128 }, { dx: -0.130, dy: 0.100 },
                ],
            },
        },
        'bt-najentus': {
            id: 'bt-najentus',
            name: 'Black Temple · High Warlord Naj\'entus',
            map: 'maps/bt-najentus.png',
            aspect: 2088 / 1146,
            // Same stacks layout as Archimonde, but LOOSE: each group holds a region
            // (buff/totem range) while members fan out inside it for Impaling Spine —
            // stackSpacing widens the member grid. No fears, no curses on this fight.
            layout: 'stacks',
            stackSpacing: 0.055,
            // The portrait is patched out of the map screenshot (water composited over
            // it); the icon is the portrait circle cropped from the same capture.
            bosses: [{ id: 'najentus', name: 'High Warlord Naj\'entus', icon: 'maps/najentus-icon.png' }],
            // Digitized from the user's annotated reference (2026-08-28): tank between
            // the boss and the temple steps, melee just behind the boss, ranged/healer
            // groups fanned across the room at the three world-marker spots.
            anchors: {
                boss: { x: 0.490, y: 0.288 },
                mt: { x: 0.487, y: 0.190 },
            },
            stackAnchors: {
                // Melee flank the boss below-left/below-right (the reference's sword
                // pair), far enough out that the wide grid clears the boss portrait.
                melee: [{ dx: -0.070, dy: 0.095 }, { dx: 0.070, dy: 0.090 }],
                spread: [
                    { dx: -0.251, dy: 0.307 }, { dx: 0.215, dy: 0.342 },
                    { dx: -0.023, dy: 0.468 }, { dx: -0.165, dy: 0.522 },
                ],
            },
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

    // Every way to seat this wedge's healers inside the wedge. Party contiguity is
    // untouched — only slots WITHIN the wedge are chosen, so healers can reach the wedge
    // edges when the neighbouring wedges are healer-poor (the centered interleave cannot).
    // Enumeration is lexicographic for determinism. A wedge whose combination count blows
    // past `cap` (the leftover "rest" wedge can be arbitrarily large) falls back to the
    // single interleaved arrangement rather than exploding.
    function healerPlacements(players, isHealer, cap) {
        const healers = players.filter(isHealer);
        const others = players.filter(p => !isHealer(p));
        if (!healers.length || !others.length) return [players.slice()];
        const L = players.length, h = healers.length;
        let count = 1;
        for (let i = 0; i < h; i++) count = count * (L - i) / (i + 1);
        if (count > cap) return [interleaveHealers(players, isHealer)];
        const out = [], idx = [];
        (function rec(start) {
            if (idx.length === h) {
                const arr = new Array(L).fill(null);
                idx.forEach((slot, j) => { arr[slot] = healers[j]; });
                let k = 0;
                for (let i = 0; i < L; i++) if (!arr[i]) arr[i] = others[k++];
                out.push(arr);
                return;
            }
            for (let s = start; s <= L - (h - idx.length); s++) { idx.push(s); rec(s + 1); idx.pop(); }
        })(0);
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
        if (enc.layout === 'stacks') return computeStackPositions(roster, groupsResult, opts, enc, bossDef);
        const nudges = opts.nudges || {};
        const anchorNudges = opts.anchorNudges || {};
        const markers = [];
        const warnings = [];

        // The boss nudge is a rigid translation of the whole formation: it shifts the boss
        // AND the mt anchor by the same (clamped) delta, so the ring, the tank, and the
        // mirrored melee clump all follow. Clamping the delta (not each anchor separately)
        // keeps the translation rigid at the map edge instead of squashing the formation.
        const rawBossN = anchorNudges.boss || { dx: 0, dy: 0 };
        const bossPos = { x: clamp01(enc.anchors.boss.x + rawBossN.dx), y: clamp01(enc.anchors.boss.y + rawBossN.dy) };
        const bossDelta = { dx: bossPos.x - enc.anchors.boss.x, dy: bossPos.y - enc.anchors.boss.y };
        const mtAnchor = { x: enc.anchors.mt.x + bossDelta.dx, y: enc.anchors.mt.y + bossDelta.dy };
        const clumpN = anchorNudges.clump || { dx: 0, dy: 0 };
        const stationN = anchorNudges.station || { dx: 0, dy: 0 };

        let { mt, offtank, spare } = pickTanks(roster);
        // The raid leader's per-boss override: who tanks the boss and who takes the other
        // duty (the infernal station on Anetheron, the melee clump on Winterchill).
        if (opts.swapTanks && mt && offtank) { const t = mt; mt = offtank; offtank = t; }
        const tankNames = new Set([mt, offtank].concat(spare).filter(Boolean).map(p => p.name));
        const melee = roster.filter(p => !tankNames.has(p.name) && roleOf(p) === 'melee');
        const ringPeople = roster.filter(p => !tankNames.has(p.name) && (roleOf(p) === 'healer' || roleOf(p) === 'ranged'));

        markers.push({ kind: 'boss', x: bossPos.x, y: bossPos.y, label: bossDef.name, icon: bossDef.icon });
        if (mt) markers.push(person(mt, 'mt', mtAnchor, nudges));

        const clumpNames = melee.map(p => p.name).concat(spare.map(p => p.name));
        if (bossMode === 'anetheron') {
            // The station is a fixed map feature (the infernal spawn point) — it renders
            // regardless of whether a second tank exists to man it. Only the offtank
            // person-marker below is conditional; the "No second tank" warning already covers
            // the missing-offtank case.
            // The station follows only its own nudge, never the boss: it marks a fixed map
            // feature (the infernal spawn point), not part of the boss formation.
            const stationPos = { x: clamp01(bossDef.station.x + stationN.dx), y: clamp01(bossDef.station.y + stationN.dy) };
            markers.push({ kind: 'station', x: stationPos.x, y: stationPos.y, label: bossDef.station.label });
            if (offtank) {
                // Offset the offtank's own marker a small deterministic distance below the
                // station anchor. The tank stands at the station, but rendering the
                // person-marker at the exact same x,y as the static station marker stacks both
                // labels ("Infernals → Jaina" and the tank's name) on one point, garbling into
                // unreadable text (task 6 review finding). The nudge system still applies on
                // top of this offset.
                const otPos = { x: stationPos.x, y: stationPos.y + 0.05 };
                markers.push(person(offtank, 'offtank', otPos, nudges));
            }
        } else if (offtank) {
            clumpNames.push(offtank.name);
        }
        if (clumpNames.length) {
            // Melee stack behind the boss: mirror the mt anchor through the boss in
            // isotropic space, so "behind" is a screen direction, not a skewed fraction.
            const u = mtAnchor.x - bossPos.x;
            const v = (mtAnchor.y - bossPos.y) / enc.aspect;
            const mtDist = Math.hypot(u, v) || 1;
            const CLUMP_DIST = 0.06; // clear of the boss dot, well inside the ring
            markers.push({
                kind: 'clump',
                x: clamp01(bossPos.x - CLUMP_DIST * u / mtDist + clumpN.dx),
                y: clamp01(bossPos.y - CLUMP_DIST * (v / mtDist) * enc.aspect + clumpN.dy),
                names: clumpNames,
            });
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
        // Per-wedge seat candidates, seeded from the interleave so the search can only
        // match or beat the old fixed placement.
        const sig = arr => arr.map(p => isHealer(p) ? 1 : 0).join('');
        const wedgeCands = wedges.map(w => {
            const cands = healerPlacements(w.players, isHealer, 128);
            const seedSig = sig(interleaveHealers(w.players, isHealer));
            const seed = Math.max(0, cands.findIndex(c => sig(c) === seedSig));
            return { party: w.party, cands, seed };
        });
        let best = null, bestScore = -Infinity;
        permutations(wedgeCands).forEach(perm => {
            const choice = perm.map(w => w.seed);
            const flatten = () => perm.flatMap((w, i) => w.cands[choice[i]]);
            const score = () => scoreArrangement(flatten(), isHealer, tankHealerNames, enc.ring.startDeg);
            // Coordinate ascent over the per-wedge seat choices: try each wedge's
            // alternatives one at a time, keep strict improvements, stop at a fixed point.
            // Not exhaustive (the joint space can be huge) but deterministic.
            let cur = score();
            let improved = true, guard = 0;
            while (improved && guard++ < 20) {
                improved = false;
                perm.forEach((w, i) => {
                    for (let c = 0; c < w.cands.length; c++) {
                        if (c === choice[i]) continue;
                        const prev = choice[i];
                        choice[i] = c;
                        const s = score();
                        if (s > cur + 1e-9) { cur = s; improved = true; }
                        else choice[i] = prev;
                    }
                });
            }
            if (cur > bestScore) { bestScore = cur; best = perm.map((w, i) => ({ party: w.party, players: w.cands[choice[i]] })); }
        });
        const ordered = (best || []).flatMap(w => w.players.map(p => ({ p, party: w.party })));
        const n = ordered.length;
        const angles = slotAngles(n, enc.ring.startDeg);
        ordered.forEach((o, i) => {
            const r = enc.ring.rBase + (i % 2 ? enc.ring.rJitter : -enc.ring.rJitter);
            const pos = angleToXY(bossPos, r, angles[i], enc.aspect);
            const m = person(o.p, 'ring', pos, nudges);
            m.party = o.party;
            // angleDeg is where the player stands as rendered — drag-nudges included — not
            // the slot the optimizer chose. The angular warnings below must judge the map
            // the raid actually sees, so a healer dragged to the far side stops warning.
            m.angleDeg = Math.atan2((m.y - bossPos.y) / enc.aspect, m.x - bossPos.x) * 180 / Math.PI;
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

        if (bossMode === 'anetheron' && !offtank) warnings.push('No second tank for the infernal station.');

        return { markers, warnings };
    }

    // Archimonde-style layout: each party stands as one tight stack (Tremor Totem and
    // chain-heal range), stacks spread apart from each other, melee-majority groups next
    // to the boss. The boss nudge is the same rigid whole-scene translation as the ring
    // layout; each stack additionally follows its own 'party-N' anchor nudge, and every
    // member still takes their personal name-keyed nudge on top.
    function computeStackPositions(roster, groupsResult, opts, enc, bossDef) {
        const nudges = opts.nudges || {};
        const anchorNudges = opts.anchorNudges || {};
        const markers = [];
        const warnings = [];

        const rawBossN = anchorNudges.boss || { dx: 0, dy: 0 };
        const bossPos = { x: clamp01(enc.anchors.boss.x + rawBossN.dx), y: clamp01(enc.anchors.boss.y + rawBossN.dy) };
        const bossDelta = { dx: bossPos.x - enc.anchors.boss.x, dy: bossPos.y - enc.anchors.boss.y };
        const mtAnchor = { x: enc.anchors.mt.x + bossDelta.dx, y: enc.anchors.mt.y + bossDelta.dy };

        markers.push({ kind: 'boss', x: bossPos.x, y: bossPos.y, label: bossDef.name, icon: bossDef.icon });
        // Same per-boss swap as the ring layout: the raid leader's override for who tanks
        // the boss. The displaced tank simply rejoins their group's stack below.
        let { mt, offtank } = pickTanks(roster);
        if (opts.swapTanks && mt && offtank) mt = offtank;
        if (mt) markers.push(person(mt, 'mt', mtAnchor, nudges));

        // The MT stands at the boss; everyone else — offtanks included — stays with their
        // group's stack, because that is where their Tremor Totem and heals are.
        const mtName = mt ? mt.name : null;
        const inRoster = new Set(roster.map(p => p.name).filter(n => n !== mtName));
        const groups = (groupsResult && groupsResult.groups) || [];
        const stacks = groups
            .map((g, i) => ({ party: i + 1, players: g.players.filter(p => inRoster.has(p.name)) }))
            .filter(s => s.players.length);
        const grouped = new Set(stacks.flatMap(s => s.players.map(p => p.name)));
        const rest = roster.filter(p => p.name !== mtName && !grouped.has(p.name));
        if (rest.length) stacks.push({ party: groups.length + 1, players: rest });

        const isMeleeStack = s =>
            s.players.filter(p => { const r = roleOf(p); return r === 'melee' || r === 'tank'; }).length * 2 > s.players.length;
        const COLS = 3;
        // Equal on-screen spacing in both axes; wide enough that a member's name label
        // clears the row of dots beneath it (verified in a CDP screenshot). An encounter
        // can widen the grid (Naj'entus: members spread inside their group's region for
        // Impaling Spine); the 0.030 default is Archimonde's tight Tremor/chain-heal stack.
        const S = enc.stackSpacing || 0.030;
        const SX = S, SY = S * enc.aspect;
        const EXTRA = 0.06; // step for groups past the digitized anchor slots
        let meleeIdx = 0, spreadIdx = 0;
        stacks.forEach(s => {
            const list = isMeleeStack(s) ? enc.stackAnchors.melee : enc.stackAnchors.spread;
            const idx = isMeleeStack(s) ? meleeIdx++ : spreadIdx++;
            const off = list[Math.min(idx, list.length - 1)];
            const overflow = Math.max(0, idx - (list.length - 1));
            const pN = anchorNudges['party-' + s.party] || { dx: 0, dy: 0 };
            const ax = bossPos.x + off.dx + overflow * EXTRA + pN.dx;
            const ay = bossPos.y + off.dy + overflow * EXTRA * enc.aspect + pN.dy;
            // The handle hangs a fixed distance above the stack, NOT one grid row: with a
            // loose grid (Naj'entus) a full SY above the melee anchor lands on the boss icon.
            // For the 0.030 default this is exactly the old one-row offset.
            markers.push({ kind: 'stackhandle', party: s.party, x: clamp01(ax), y: clamp01(ay - 0.030 * enc.aspect), label: 'G' + s.party });
            s.players.forEach((p, j) => {
                const col = j % COLS, row = Math.floor(j / COLS);
                const rowLen = Math.min(COLS, s.players.length - row * COLS);
                const pos = { x: ax + (col - (rowLen - 1) / 2) * SX, y: ay + row * SY };
                const m = person(p, 'stack', pos, nudges);
                m.party = s.party;
                if (p.class === 'SHAMAN') m.tags.push('shaman');
                markers.push(m);
            });
            if ((enc.mechanics || {}).fears && s.players.length >= 2 && !s.players.some(p => p.class === 'SHAMAN'))
                warnings.push('Group ' + s.party + ' has no shaman — no Tremor Totem for fears.');
        });

        // Decursing is raid-wide (Remove Curse reaches 40yd across parties), so this is a
        // roster check, not a per-group one.
        if ((enc.mechanics || {}).curses && !roster.some(p => p.class === 'MAGE' || p.class === 'DRUID'))
            warnings.push('No decursers (mage or druid) in the raid for Grip of the Legion.');

        return { markers, warnings };
    }

    function clamp01(v) { return Math.min(0.99, Math.max(0.01, v)); }

    // Sum nudge layers per key: the saved template underneath, live drags on top. Used by
    // the page to feed computePositions one effective offset per marker.
    function combineNudges(saved, live) {
        const out = {};
        [saved || {}, live || {}].forEach(layer => {
            Object.keys(layer).forEach(k => {
                const n = layer[k] || { dx: 0, dy: 0 };
                const cur = out[k] || { dx: 0, dy: 0 };
                out[k] = { dx: cur.dx + n.dx, dy: cur.dy + n.dy };
            });
        });
        return out;
    }

    function person(p, kind, pos, nudges) {
        const nudge = nudges[p.name] || { dx: 0, dy: 0 };
        // A stored nudge is a delta on top of whatever base position this run computes. If the
        // base shifts (roster/group changes) or the nudge itself is out of proportion, the sum
        // can land off the map — clamp the final coordinate, not just the raw nudge, so a
        // persisted offset can never strand a marker outside the image.
        const x = clamp01(pos.x + nudge.dx);
        const y = clamp01(pos.y + nudge.dy);
        return { kind, name: p.name, class: p.class, role: roleOf(p), x, y, tags: [] };
    }

    return { ENCOUNTERS, slotAngles, angleToXY, circGap, computePositions, interleaveHealers, scoreArrangement, combineNudges };
}));
