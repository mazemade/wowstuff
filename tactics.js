/* Guided raid briefings. Scenes are illustrative teaching examples, with encounter
 * seconds controlled by the presenter. Map scale and hazard radii are approximate.
 */
(function () {
    'use strict';

    const requestedFight = new URL(location.href).searchParams.get('fight');
    const fights = window.TacticsData.FIGHTS;
    const FIGHT = Object.hasOwn(fights, requestedFight) ? fights[requestedFight] : fights['bt-najentus'];
    const L = window.TacticsLayout;
    const ADAPTER = FIGHT.id === 'bt-najentus' ? window.TacticsNajentus : FIGHT.id === 'bt-akama' ? window.TacticsAkama : FIGHT.id === 'bt-reliquary' ? window.TacticsReliquary : null;
    const OVERLAY = FIGHT.id === 'bt-najentus' ? window.TacticsNajentusRender : FIGHT.id === 'bt-akama' ? window.TacticsAkamaRender : FIGHT.id === 'bt-reliquary' ? window.TacticsReliquaryRender : null;
    const RELIQUARY_STEPS = FIGHT.id === 'bt-reliquary' ? window.TacticsReliquarySteps : null;
    const E = window.AssignmentsEngine;
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const STORAGE_KEY = 'raidAssignmentsState';
    const LINK_KEY = 'raidAssignmentsLinkMap';

    // ---- the roster -----------------------------------------------------------

    // The same roster the assignments and positioning pages use. Without one the room is
    // still drawn, just with unnamed tokens.
    function loadRoster() {
        if (!E || !E.deriveRoster || !E.bucketOf) return null;
        let state = {}, links = {};
        try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* fresh */ }
        try { links = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { /* fresh */ }
        let players = [];
        try { players = E.deriveRoster(state, links) || []; } catch (e) { return null; }
        if (!players.length) return null;

        const out = { tanks: [], healers: [], melee: [], ranged: [], classOf: {} };
        players.forEach(p => {
            const b = E.bucketOf(p);
            const group = b === 'tanks' ? 'tanks' : b === 'healers' ? 'healers'
                : b === 'melee' ? 'melee' : 'ranged';
            out[group].push(p.name);
            out.classOf[p.name] = p.class;
        });
        const mainTanks = new Set(players.filter(p => p.mt).map(p => p.name));
        out.tanks.sort((a, b) => Number(mainTanks.has(b)) - Number(mainTanks.has(a)));
        return out;
    }

    const roster = loadRoster();
    const assigned = L.assign(FIGHT, roster);
    assigned.forEach(p => { p.class = roster?.classOf[p.name] || null; });
    const PLACED = {};
    [1, 2].forEach(phase => {
        PLACED[phase] = {};
        L.formation(FIGHT, phase, assigned).forEach(p => { PLACED[phase][p.id] = p; });
    });

    // ---- assets ---------------------------------------------------------------

    const IMG = {};
    function image(src) {
        if (!IMG[src]) { const i = new Image(); i.src = src; IMG[src] = i; }
        return IMG[src];
    }
    const ROLE_ICON = {
        tank: 'maps/tactics/role-tank.svg',
        healer: 'maps/tactics/role-healer.svg',
        melee: 'maps/tactics/role-mdps.svg',
        ranged: 'maps/tactics/role-rdps.svg'
    };
    Object.keys(ROLE_ICON).forEach(k => image(ROLE_ICON[k]));
    image(FIGHT.portrait);
    FIGHT.abilities.forEach(a => image(a.icon));

    // ---- small maths ----------------------------------------------------------

    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const easeInOut = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    // Deterministic noise so a looping step looks identical on every pass.
    function rnd(seed) {
        const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Position of a hand-placed actor at time t: follows its waypoints, or stands still.
    function actorAt(actor, t) {
        const p = actor.path;
        if (!p || !p.length) return actor.at;
        if (t <= p[0].t) return p[0];
        for (let i = 1; i < p.length; i++) {
            if (t <= p[i].t) {
                const span = p[i].t - p[i - 1].t || 1;
                const k = clamp((t - p[i - 1].t) / span, 0, 1);
                return { x: lerp(p[i - 1].x, p[i].x, k), y: lerp(p[i - 1].y, p[i].y, k) };
            }
        }
        return p[p.length - 1];
    }

    function valueAt(frames, t) {
        if (!frames || !frames.length) return null;
        if (t <= frames[0].t) return frames[0].v;
        for (let i = 1; i < frames.length; i++) {
            if (t <= frames[i].t) {
                const span = frames[i].t - frames[i - 1].t || 1;
                return lerp(frames[i - 1].v, frames[i].v, (t - frames[i - 1].t) / span);
            }
        }
        return frames[frames.length - 1].v;
    }

    const apart = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) / FIGHT.aspect) / FIGHT.yard;

    // Walk a point some number of yards towards another, in map fractions.
    function stepToward(from, to, yards) {
        const dx = to.x - from.x, dy = (to.y - from.y) / FIGHT.aspect;
        const d = Math.hypot(dx, dy) / FIGHT.yard;
        if (d <= yards || d < 1e-9) return to;
        const k = yards / d;
        return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    }

    function walkSafely(from, to, yards, hazards) {
        const direct = stepToward(from, to, yards);
        const blocked = q => hazards.some(h => apart(q, h) < h.yards - 0.02 && apart(q, h) < apart(from, h) - 0.001);
        if (!blocked(direct)) return direct;
        const angle = Math.atan2((to.y - from.y) / FIGHT.aspect, to.x - from.x);
        const choices = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * .75, -Math.PI * .75, Math.PI];
        const A = FIGHT.arena;
        const points = choices.map(turn => ({
            x: clamp(from.x + Math.cos(angle + turn) * yards * FIGHT.yard, A.x0, A.x1),
            y: clamp(from.y + Math.sin(angle + turn) * yards * FIGHT.yard * FIGHT.aspect, A.y0, A.y1)
        })).filter(q => !blocked(q));
        points.sort((a, b) => apart(a, to) - apart(b, to));
        return points[0] || from;
    }

    // ---- canvas ---------------------------------------------------------------

    const cv = document.getElementById('fx');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0;

    const MW = FIGHT.mapSize.width, MH = FIGHT.mapSize.height;
    let src = { x: 0, y: 0, w: MW, h: MH }, scale = 1;

    function resize() {
        const r = cv.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = r.width; H = r.height;
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
    }

    // Point the camera at a patch of the room: centre it, ask for a width in yards, and let
    // it widen to whatever shape the stage is so nothing is ever squashed or letterboxed.
    // The rectangle of the map a step is about, in map fractions. 'arena' is the room;
    // 'raid' is everyone's standing spot plus him; 'front' is him, the tanks and the melee.
    // Worked out from the positions in play, so a different roster or layout reframes itself.
    function frameOf(view, sc) {
        const A = FIGHT.arena;
        if (view.bounds) return view.bounds;
        if (view.fit === 'arena' || (view.fit === 'raid' && sc.paths) || !view.fit) return { x0: A.x0, y0: A.y0, x1: A.x1, y1: A.y1, pad: 2 };
        if (view.fit === 'action') {
            // the few things this step is about, taken from the scene rather than the frame,
            // so the camera holds still instead of chasing the animation around
            const a = [FIGHT.bossAt];
            Object.keys(sc.cast || {}).forEach(k => {
                const p = PLACED[sc.formation || 1][sc.cast[k]];
                if (p) a.push(p.at);
            });
            (sc.effects || []).forEach(e => { if (e.at) a.push(e.at); });
            Object.values(sc.paths || {}).forEach(path => path.forEach(p => a.push(p)));
            Object.values(sc.starts || {}).forEach(p => a.push(p));
            return {
                x0: Math.min(...a.map(p => p.x)), x1: Math.max(...a.map(p => p.x)),
                y0: Math.min(...a.map(p => p.y)), y1: Math.max(...a.map(p => p.y)), pad: 13
            };
        }
        const pts = [FIGHT.bossAt];
        const phases = sc.morph ? [sc.morph.from, sc.morph.to] : [sc.formation || 1];
        phases.forEach(ph => {
            Object.keys(PLACED[ph]).forEach(id => {
                const p = PLACED[ph][id];
                if (view.fit === 'front' && p.kind !== 'tank' && p.kind !== 'melee') return;
                pts.push(p.at);
            });
        });
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return {
            x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
            pad: view.fit === 'front' ? 9 : 11
        };
    }

    function aim(view, sc) {
        const box = W / H;
        const f = frameOf(view, sc);
        if (FIGHT.id === 'bt-reliquary' && (view.fit === 'action' || sc.id === 'positioning')) {
            // Reserve readable space for the visual lesson above and below the actors.
            const top = W < 520 ? 150 : ['fixate', 'suffering', 'cycle'].includes(sc.id) ? 160 : 120, bottom = 118;
            scale = Math.min((W - 46) / ((f.x1 - f.x0) * MW), (H - top - bottom) / ((f.y1 - f.y0) * MH));
            src = { w: W / scale, h: H / scale,
                x: (f.x0 + f.x1) / 2 * MW - W / scale / 2,
                y: (f.y0 + f.y1) / 2 * MH - (top + (H - top - bottom) / 2) / scale };
            return;
        }
        const padX = f.pad * FIGHT.yard, padY = f.pad * FIGHT.yard * FIGHT.aspect;
        const wantW = (f.x1 - f.x0 + 2 * padX) * MW;
        const wantH = (f.y1 - f.y0 + 2 * padY) * MH;
        // whichever of width or height is the tight fit sets the crop; the other gets air
        let w = Math.max(wantW, wantH * box), h = w / box;
        if (FIGHT.id === 'bt-akama') {
            // Both hallways are part of the lesson. On a portrait viewport, retain the
            // whole authored arena with vertical padding instead of cropping its sides.
            src = { w, h, x: (f.x0 + f.x1) / 2 * MW - w / 2, y: (f.y0 + f.y1) / 2 * MH - h / 2 };
            scale = W / src.w;
            return;
        }
        if (w > MW) { w = MW; h = w / box; }
        if (h > MH) { h = MH; w = h * box; }
        src = {
            w: w, h: h,
            x: clamp((f.x0 + f.x1) / 2 * MW - w / 2, 0, MW - w),
            y: clamp((f.y0 + f.y1) / 2 * MH - h / 2, 0, MH - h)
        };
        scale = W / src.w;
    }

    const px = p => ({ x: (p.x * MW - src.x) * scale, y: (p.y * MH - src.y) * scale });
    const yd = n => n * FIGHT.yard * MW * scale;

    // The capture is murky and green, and lifting it costs a full-frame filter. Do it once
    // into an offscreen copy and blit from that instead.
    let lit = null;
    function litMap() {
        if (lit) return lit;
        const img = image(FIGHT.map);
        if (!img.complete || !img.naturalWidth) return null;
        const c = document.createElement('canvas');
        c.width = MW; c.height = MH;
        const g = c.getContext('2d');
        g.filter = FIGHT.mapFilter;
        g.drawImage(img, 0, 0, MW, MH);
        lit = c;
        return lit;
    }

    function drawMap() {
        const m = litMap();
        if (m) ctx.drawImage(m, src.x, src.y, src.w, src.h, 0, 0, W, H);
    }

    // ---- the simulation -------------------------------------------------------

    const KITE = 0.75;        // radians off the line of whatever is chasing you, ~43 degrees
    const WALK = 0.0072;      // yards per ms — a player getting out of something
    const FIRE = 0.0064;      // the gout of flame, slower than you on purpose
    const STEP = 50;

    // Misdirect is a hunter's job, so point at one if the raid has one rather than at
    // whichever slot the fight data happened to name.
    const HUNTER = (function () {
        if (!roster || !roster.classOf) return null;
        const found = assigned.find(p => p.name && roster.classOf[p.name] === 'HUNTER');
        return found ? found.id : null;
    }());

    function castId(sc, ref) {
        if (ref === 'md' && HUNTER) return HUNTER;
        return (sc.cast && sc.cast[ref]) || ref;
    }

    // Where a raider stands if nothing is chasing them: their spot for this step, or part way
    // between two phases while the raid repositions.
    function homeAt(sc, p, t, boss) {
        const base = PLACED[sc.morph ? sc.morph.to : sc.formation][p.id].at;
        if (sc.initial) {
            const start = sc.initial.pos[p.id];
            if (p.kind === 'tank' && t < sc.countdown.at) {
                const distance = apart(start, boss);
                const dest = stepToward(start, boss, Math.max(0, distance - 16));
                const k = clamp(t / sc.countdown.at, 0, 1);
                return { x: lerp(start.x, dest.x, k), y: lerp(start.y, dest.y, k) };
            }
            if (p.kind === 'tank' && t >= sc.countdown.at) {
                const dest = { x: base.x + boss.x - FIGHT.bossAt.x, y: base.y + boss.y - FIGHT.bossAt.y };
                return dest;
            }
            const k = easeInOut(clamp((t - sc.morph.start) / (sc.morph.end - sc.morph.start), 0, 1));
            return { x: lerp(start.x, base.x, k), y: lerp(start.y, base.y, k) };
        }
        if (!sc.morph) return sc.startsById[p.id] || base;
        const a = PLACED[sc.morph.from][p.id].at;
        if (p.kind === 'tank' && sc.countdown?.phase === 2) {
            const k = easeInOut(clamp((t - sc.countdown.at) / (sc.duration - sc.countdown.at), 0, 1));
            return { x: lerp(a.x, base.x, k), y: lerp(a.y, base.y, k) };
        }
        const off = (p.slotIndex % 5) * 120;
        const k = easeInOut(clamp((t - sc.morph.start - off) / (sc.morph.end - sc.morph.start), 0, 1));
        return { x: lerp(a.x, base.x, k), y: lerp(a.y, base.y, k) };
    }

    // Run the step from its beginning up to t. Cheap enough to redo every frame, which keeps
    // every loop identical and lets a jump to any step land on the same picture.
    function simulate(sc, t) {
        if (ADAPTER) return ADAPTER.simulate(FIGHT, sc, t);
        const pos = {};
        const bossActor = sc.bossActor;
        let boss = sc.initial ? sc.initial.boss : bossActor.at;
        const trailEff = (sc.effects || []).find(e => e.kind === 'trail');
        const trail = trailEff ? [] : null;

        sc.raid.forEach(p => { pos[p.id] = homeAt(sc, p, 0, boss); });
        if (trail) trail.push({ x: boss.x, y: boss.y, t: trailEff.start });
        const kite = { side: 0, of: null };

        for (let s = 0; ; s += STEP) {
            const now = Math.min(s, t);

            // him: a laid-out path, or walking down whoever he has fixated
            const gaze = (sc.effects || []).find(e => e.kind === 'gaze' && now >= e.start && now < e.end);
            if (sc.initial && now >= sc.morph.start) {
                const k = easeInOut(clamp((now - sc.morph.start) / (sc.morph.end - sc.morph.start), 0, 1));
                boss = { x: lerp(sc.pickup.x, FIGHT.bossAt.x, k), y: lerp(sc.pickup.y, FIGHT.bossAt.y, k) };
            } else if (bossActor.path) boss = actorAt(bossActor, now);
            else if (gaze) {
                const target = pos[castId(sc, gaze.target)];
                if (target) boss = stepToward(boss, target, (sc.chaseSpeed || 0.004) * STEP);
            }

            // what is dangerous at this instant
            const hz = [];
            (sc.effects || []).forEach(e => {
                if (e.kind === 'volcano' && now - e.start > 150 && now <= e.end) {
                    hz.push({ x: e.at.x, y: e.at.y, yards: e.avoid || (e.radiusYards + 2) });
                } else if (e.kind === 'gaze' && e === gaze) {
                    hz.push({ x: boss.x, y: boss.y, yards: e.avoid || 10 });
                }
            });
            if (trail && trail.length && now >= trailEff.start && now <= trailEff.end) {
                const reach = trailEff.avoid || 4;
                let last = null;
                for (let i = trail.length - 1; i >= 0; i--) {
                    const q = trail[i];
                    if (last && apart(q, last) < reach * 0.9) continue;
                    hz.push({ x: q.x, y: q.y, yards: reach });
                    last = q;
                }
            }

            // the raid: stand on your spot unless something is on it
            const solid = { x: boss.x, y: boss.y, yards: 6 };
            // whoever is being chased right now, and the thing chasing them
            let chase = null;
            if (trail && now >= trailEff.start && now <= trailEff.start + (trailEff.chaseMs || 4000)) {
                chase = { id: castId(sc, trailEff.follow), at: trail[trail.length - 1], reach: trailEff.avoid || 4 };
            } else if (gaze) {
                chase = { id: castId(sc, gaze.target), at: boss, reach: gaze.avoid || 10 };
            }
            if (chase && kite.of !== chase.id) { kite.of = chase.id; kite.side = 0; }

            sc.raid.forEach(p => {
                if (sc.pathsById[p.id] && now <= sc.pathsById[p.id].at(-1).t) {
                    pos[p.id] = actorAt({ path: sc.pathsById[p.id] }, now);
                    return;
                }
                if (chase && p.id === chase.id) {
                    pos[p.id] = kiteStep(sc, p, pos, chase.at, chase.reach, kite);
                    return;
                }
                const home = homeAt(sc, p, now, boss);
                let want = home;
                if (hz.length) {
                    const mine = apart(home, boss) > 7 ? hz.concat([solid]) : hz;
                    want = L.safePos(FIGHT, home, mine);
                }
                pos[p.id] = walkSafely(pos[p.id], want, WALK * STEP, hz);
            });

            // the fire, hunting whoever it picked. It turns rather than snaps, so a sidestep
            // makes it overshoot and curve — which is the reason sidestepping works.
            if (trail && now >= trailEff.start && now <= trailEff.start + (trailEff.chaseMs || 4000)) {
                const head = trail[trail.length - 1];
                const target = pos[castId(sc, trailEff.follow)];
                if (target) {
                    const ax = (target.x - head.x) / FIGHT.yard, ay = (target.y - head.y) / (FIGHT.yard * FIGHT.aspect);
                    const al = Math.hypot(ax, ay) || 1;
                    let dx = ax / al, dy = ay / al;
                    if (head.dx !== undefined) {
                        dx = head.dx * 0.9 + dx * 0.1;
                        dy = head.dy * 0.9 + dy * 0.1;
                        const l = Math.hypot(dx, dy) || 1;
                        dx /= l; dy /= l;
                    }
                    const step = Math.min(FIRE * STEP, al);
                    trail.push({
                        x: head.x + dx * step * FIGHT.yard,
                        y: head.y + dy * step * FIGHT.yard * FIGHT.aspect,
                        dx: dx, dy: dy, t: now
                    });
                }
            }
            if (s >= t) break;
        }
        return { pos: pos, boss: boss, trail: trail };
    }

    const HAZARDS = { trail: 1, volcano: 1, gaze: 1, impact: 1 };

    // Who this step is about. Named cast, anyone an effect is landing on, any role the step
    // calls out, and — the useful one — anybody the mechanic has actually pushed off their
    // spot. Everyone else stays on the floor but fades back into it.
    function focusOf(sc, t) {
        const set = {};
        Object.keys(sc.cast || {}).forEach(k => { set[sc.cast[k]] = 1; });
        (sc.effects || []).forEach(e => {
            if (e.kind === 'impact' && e.target) set[castId(sc, e.target)] = 1;
        });
        (sc.focus || []).forEach(f => {
            if (/^p\d+$/.test(f)) set[f] = 1;
            else sc.raid.forEach(p => { if (p.kind === f) set[p.id] = 1; });
        });
        sc.raid.forEach(p => {
            if (apart(homeAt(sc, p, t, sc._sim.boss), sc._sim.pos[p.id]) > 1.5) set[p.id] = 1;
        });
        return set;
    }

    // What the hunted player does once the fire is closing: walk, continuously, at an angle
    // across its approach rather than straight away from it. Running straight away just drags
    // it after you in a line; walking across it makes it overshoot and trail behind in a curve,
    // which is the whole reason the sidestep works. `kite` remembers which way they turned so
    // the arc keeps bending the same way instead of wobbling.
    function kiteStep(sc, p, pos, head, reach, kite) {
        const cur = pos[p.id];
        const d = apart(cur, head);
        if (d > reach + 10) return cur;                 // it is not near you yet; hold your spot

        const ax = (cur.x - head.x) / FIGHT.yard, ay = (cur.y - head.y) / (FIGHT.yard * FIGHT.aspect);
        const al = Math.hypot(ax, ay) || 1;
        const bearing = Math.atan2(ay / al, ax / al);   // from the fire towards you

        if (kite.side === 0) {
            // turn towards open floor: the side further from him and from everybody else
            kite.side = [1, -1].map(sgn => {
                const a = bearing + sgn * KITE;
                const q = {
                    x: cur.x + Math.cos(a) * 10 * FIGHT.yard,
                    y: cur.y + Math.sin(a) * 10 * FIGHT.yard * FIGHT.aspect
                };
                const A = FIGHT.arena;
                if (q.x < A.x0 || q.x > A.x1 || q.y < A.y0 || q.y > A.y1) return { sgn: sgn, room: -1 };
                let room = apart(q, FIGHT.bossAt);
                sc.raid.forEach(o => { if (o.id !== p.id) room = Math.min(room, apart(q, pos[o.id])); });
                return { sgn: sgn, room: room };
            }).sort((a, b) => b.room - a.room)[0].sgn;
        }

        const a = bearing + kite.side * KITE;            // across its approach, but gaining ground
        const target = {
            x: cur.x + Math.cos(a) * 10 * FIGHT.yard,
            y: cur.y + Math.sin(a) * 10 * FIGHT.yard * FIGHT.aspect
        };
        const A = FIGHT.arena;
        target.x = clamp(target.x, A.x0, A.x1);
        target.y = clamp(target.y, A.y0, A.y1);
        // and do not run into somebody else while you are doing it
        const others = [];
        sc.raid.forEach(o => { if (o.id !== p.id) others.push({ x: pos[o.id].x, y: pos[o.id].y, yards: 5 }); });
        return stepToward(cur, L.safePos(FIGHT, target, others), WALK * STEP);
    }

    // Read a position out of the current frame: a raid slot, a cast name, or him.
    function at(sc, ref) {
        if (ref === 'boss') return sc._sim.boss;
        return sc._sim.pos[castId(sc, ref)] || sc._sim.boss;
    }

    // ---- effects --------------------------------------------------------------

    const EMBER = '#ff6a1f';

    function withGlow(fn) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        fn();
        ctx.restore();
    }

    function drawRing(e, sc, t) {
        const c = px(at(sc, e.from));
        const breathe = e.pulse ? 1 + 0.035 * Math.sin(t / 620) : 1;
        const r = yd(e.radiusYards) * breathe;
        ctx.save();
        ctx.setLineDash([6, 7]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(236,230,216,.30)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // on the left edge: the bottom of a ring is where people are standing
        if (e.label) chip(c.x - r, c.y, e.label);
    }

    function chip(x, y, text) {
        ctx.save();
        ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
        const w = ctx.measureText(text).width + 12, h = 19;
        ctx.fillStyle = 'rgba(11,15,13,.82)';
        ctx.strokeStyle = 'rgba(236,230,216,.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#c8d0c9';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + 0.5);
        ctx.restore();
    }

    // Molten Punch: the ground cracks outward from him.
    function drawSweep(e, sc, t) {
        const k = clamp((t - e.start) / (e.end - e.start), 0, 1);
        if (k <= 0 || k >= 1) return;
        const c = px(at(sc, e.from));
        const r = yd(e.radiusYards) * easeOut(k);
        const fade = 1 - k;
        withGlow(() => {
            ctx.beginPath();
            for (let i = 0; i <= 46; i++) {
                const ang = (i / 46) * Math.PI * 2;
                const wob = 1 + 0.07 * Math.sin(ang * 5 + 1.3) + 0.04 * Math.sin(ang * 11);
                const x = c.x + Math.cos(ang) * r * wob, y = c.y + Math.sin(ang) * r * wob;
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.closePath();
            ctx.lineWidth = lerp(5, 1, k);
            ctx.strokeStyle = 'rgba(255,120,40,' + (0.85 * fade) + ')';
            ctx.shadowColor = EMBER;
            ctx.shadowBlur = 18;
            ctx.stroke();
        });
    }

    // Molten Flame. Drawn as a few whole-path strokes rather than segment by segment:
    // additive overlap on a slow head turns any per-segment pass into a white blob.
    function drawTrail(e, sc, t) {
        const pts = sc._sim.trail;
        if (!pts || pts.length < 2 || t < e.start || t > e.end) return;
        const last = pts.length - 1;
        const hot = Math.floor(last * 0.45), core = Math.floor(last * 0.78);

        const trace = (from, to, width, colour) => {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = width;
            ctx.strokeStyle = colour;
            ctx.beginPath();
            const a = px(pts[from]);
            ctx.moveTo(a.x, a.y);
            for (let i = from + 1; i <= to; i++) { const q = px(pts[i]); ctx.lineTo(q.x, q.y); }
            ctx.stroke();
            ctx.restore();
        };

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = 'rgba(55,174,255,.9)';
        ctx.shadowBlur = 22;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = yd(2.9);
        ctx.strokeStyle = 'rgba(20,85,175,.22)';
        ctx.beginPath();
        const a0 = px(pts[0]);
        ctx.moveTo(a0.x, a0.y);
        for (let i = 1; i <= last; i++) { const q = px(pts[i]); ctx.lineTo(q.x, q.y); }
        ctx.stroke();
        ctx.restore();

        trace(0, last, yd(1.75), 'rgba(28,118,201,.92)');
        trace(hot, last, yd(1.25), 'rgba(64,191,255,.95)');
        trace(core, last, yd(0.55), 'rgba(190,243,255,.95)');

        withGlow(() => {
            for (let i = 0; i < 26; i++) {
                const p = px(pts[Math.floor(rnd(i * 3.7) * pts.length)]);
                const cyc = (t / 1000 + rnd(i)) % 1;
                ctx.globalAlpha = (1 - cyc) * 0.65;
                ctx.fillStyle = i % 3 ? '#70d9ff' : '#defaff';
                ctx.beginPath();
                ctx.arc(p.x + Math.sin((t / 260) + i) * yd(0.9), p.y - cyc * yd(5),
                    Math.max(0.7, yd(0.22) * (1 - cyc * 0.5)), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            const h = px(pts[last]);
            const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, yd(3.2));
            g.addColorStop(0, 'rgba(218,252,255,.9)');
            g.addColorStop(.32, 'rgba(67,184,255,.5)');
            g.addColorStop(1, 'rgba(25,110,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(h.x, h.y, yd(3.2), 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Volcanic Geyser: ground cracks, erupts, then keeps firing inside its radius.
    function drawVolcano(e, sc, t) {
        const age = t - e.start;
        if (age < 0 || t > e.end) return;
        const c = px(e.at);
        const R = yd(e.radiusYards);
        const seed = e.at.x * 977 + e.at.y * 331;

        const crack = clamp(age / 240, 0, 1);
        ctx.save();
        ctx.globalAlpha = crack * clamp(1 - (age - 900) / 1400, 0, 1);
        ctx.strokeStyle = 'rgba(60,20,6,.9)';
        ctx.lineWidth = 2.4;
        for (let i = 0; i < 6; i++) {
            const ang = rnd(seed + i) * Math.PI * 2;
            const len = R * (0.35 + 0.4 * rnd(seed + i * 2.1)) * crack;
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(c.x + Math.cos(ang) * len * .6, c.y + Math.sin(ang) * len * .6);
            ctx.lineTo(c.x + Math.cos(ang + .3) * len, c.y + Math.sin(ang + .3) * len);
            ctx.stroke();
        }
        ctx.restore();

        if (age > 180) {
            const pulse = 0.5 + 0.5 * Math.sin(age / 300);
            ctx.save();
            const g = ctx.createRadialGradient(c.x, c.y, R * .12, c.x, c.y, R);
            g.addColorStop(0, 'rgba(255,120,30,' + (0.26 + 0.08 * pulse) + ')');
            g.addColorStop(.7, 'rgba(230,70,12,.10)');
            g.addColorStop(1, 'rgba(200,50,8,.02)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
            ctx.fill();
            ctx.setLineDash([5, 6]);
            ctx.lineDashOffset = -age / 40;
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = 'rgba(255,140,60,' + (0.45 + 0.25 * pulse) + ')';
            ctx.stroke();
            ctx.restore();
        }

        if (age > 200) {
            const burst = clamp((age - 200) / 520, 0, 1);
            withGlow(() => {
                if (burst < 1) {
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, R * (0.2 + 1.5 * easeOut(burst)), 0, Math.PI * 2);
                    ctx.lineWidth = lerp(4, 0.6, burst);
                    ctx.strokeStyle = 'rgba(255,196,120,' + (1 - burst) + ')';
                    ctx.stroke();
                }
                const flick = 0.82 + 0.18 * Math.sin(age / 90) * Math.sin(age / 37);
                const cr = yd(2.1) * flick * (0.5 + 0.5 * Math.min(1, burst * 2));
                const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, cr * 2.6);
                g.addColorStop(0, 'rgba(255,250,228,.98)');
                g.addColorStop(.28, 'rgba(255,176,70,.8)');
                g.addColorStop(1, 'rgba(255,80,10,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(c.x, c.y, cr * 2.6, 0, Math.PI * 2);
                ctx.fill();

                for (let i = 0; i < 11; i++) {
                    const period = 1150 + rnd(seed + i) * 700;
                    if ((age - 260 - i * 90) < 0) continue;
                    const k = ((age - 260 - i * 90) % period) / period;
                    const ang = rnd(seed + i * 5.3) * Math.PI * 2;
                    const reach = R * (0.35 + 0.55 * rnd(seed + i * 7.7));
                    ctx.globalAlpha = 1 - k * k;
                    ctx.fillStyle = k < .5 ? '#ffe6a6' : '#ff8a2a';
                    ctx.beginPath();
                    ctx.arc(c.x + Math.cos(ang) * reach * k,
                        c.y + Math.sin(ang) * reach * k - Math.sin(k * Math.PI) * yd(6),
                        yd(0.55) * (1 - k * .4), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            });
        }
    }

    // Fixate: he drops threat and walks somebody down.
    function drawGaze(e, sc, t) {
        if (t < e.start || t >= e.end) return;
        const a = px(at(sc, e.from)), b = px(at(sc, e.target));
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
        const age = t - e.start;

        withGlow(() => {
            const w0 = yd(2.6), w1 = yd(1.0);
            const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            g.addColorStop(0, 'rgba(255,58,32,.05)');
            g.addColorStop(1, 'rgba(255,72,40,.30)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(a.x + nx * w0, a.y + ny * w0);
            ctx.lineTo(b.x + nx * w1, b.y + ny * w1);
            ctx.lineTo(b.x - nx * w1, b.y - ny * w1);
            ctx.lineTo(a.x - nx * w0, a.y - ny * w0);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = 'rgba(255,120,90,.75)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
                const k = ((age / 760) + i / 3) % 1;
                const cx = a.x + ux * d * k, cy = a.y + uy * d * k, s = yd(1.5);
                ctx.globalAlpha = Math.sin(k * Math.PI) * .9;
                ctx.beginPath();
                ctx.moveTo(cx - nx * s - ux * s, cy - ny * s - uy * s);
                ctx.lineTo(cx, cy);
                ctx.lineTo(cx + nx * s - ux * s, cy + ny * s - uy * s);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            const onset = clamp(age / 300, 0, 1);
            if (onset < 1) {
                ctx.beginPath();
                ctx.arc(b.x, b.y, yd(2) + yd(6) * easeOut(onset), 0, Math.PI * 2);
                ctx.lineWidth = lerp(3.5, 0.5, onset);
                ctx.strokeStyle = 'rgba(255,225,200,' + (1 - onset) + ')';
                ctx.stroke();
            }
        });

        const r = yd(2.4) + Math.sin(age / 280) * yd(0.22);
        ctx.save();
        ctx.strokeStyle = '#ff5638';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let q = 0; q < 4; q++) {
            const base = q * Math.PI / 2 + Math.PI / 4 + age / 2600;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r, base - 0.32, base + 0.32);
            ctx.stroke();
        }
        ctx.restore();
        label(b.x, b.y - r - 11, 'FIXATE · ' + Math.ceil((e.end - t) / 1000) + 's', '#ff9c88', 15);
    }

    // Hateful Strike landing on a tank.
    function drawImpact(e, sc, t) {
        const age = t - e.start;
        if (age < 0 || age > 1100) return;
        const c = px(at(sc, e.target));

        withGlow(() => {
            const flash = clamp(age / 150, 0, 1);
            if (flash < 1) {
                ctx.globalAlpha = 1 - flash;
                ctx.fillStyle = '#fff6e2';
                ctx.beginPath();
                ctx.arc(c.x, c.y, yd(3) + yd(2.4) * flash, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            const k = clamp(age / 430, 0, 1);
            if (k < 1) {
                ctx.beginPath();
                ctx.arc(c.x, c.y, yd(2) + yd(6) * easeOut(k), 0, Math.PI * 2);
                ctx.lineWidth = lerp(3.5, 0.6, k);
                ctx.strokeStyle = 'rgba(255,200,150,' + (1 - k) + ')';
                ctx.stroke();
                for (let i = 0; i < 9; i++) {
                    const ang = i * Math.PI * 2 / 9 + 0.2;
                    const r0 = yd(2.6) + yd(4) * easeOut(k), r1 = r0 + yd(1.8) * (1 - k);
                    ctx.beginPath();
                    ctx.moveTo(c.x + Math.cos(ang) * r0, c.y + Math.sin(ang) * r0);
                    ctx.lineTo(c.x + Math.cos(ang) * r1, c.y + Math.sin(ang) * r1);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(255,210,160,' + (1 - k) + ')';
                    ctx.stroke();
                }
            }
        });

        const nk = clamp(age / 1000, 0, 1);
        ctx.save();
        ctx.globalAlpha = 1 - Math.pow(nk, 2.2);
        ctx.font = '700 21px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,10,9,.9)';
        ctx.fillStyle = '#ffdca8';
        const ny = c.y - yd(4) - 26 * nk;
        ctx.strokeText(e.label || 'Hateful', c.x, ny);
        ctx.fillText(e.label || 'Hateful', c.x, ny);
        ctx.restore();
    }

    // The threat table: wiped at the swap into Phase 2, rebuilt on the way back.
    function drawThreat(e, sc, t) {
        const tankId = assigned.find(p => p.kind === 'tank')?.id;
        const c = px(at(sc, tankId || e.from));
        const span = e.end - e.start;
        const wipe = e.mode !== 'rebuild';
        const bw = 172, bh = 11, gap = 8;
        const bx = 62, by = W < 500 ? H - 132 : 22;
        const mark = sc.countdown ? sc.countdown.at - e.start : span * 0.5;
        const after = t - e.start - mark;

        const rows = assigned.filter(p => p.kind === 'tank').map((p, i) => ({ name: i ? 'SOAK' + (i > 1 ? ' ' + i : '') : 'MT', tone: i ? '#3f6ea6' : '#4d7fbe' }));
        ctx.save();
        // a plate so the readout survives whatever wall it happens to sit on
        ctx.fillStyle = 'rgba(9,13,11,.72)';
        ctx.strokeStyle = 'rgba(236,230,216,.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx - 44, by - 24, bw + 58, rows.length * (bh + gap) + 34, 3);
        ctx.fill();
        ctx.stroke();
        ctx.font = '600 12px "Barlow Condensed", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#6d7a72';
        ctx.font = '600 13px "Barlow Condensed", sans-serif';
        ctx.fillText('threat', bx, by - 9);
        ctx.font = '600 12px "Barlow Condensed", sans-serif';
        rows.forEach((row, i) => {
            const y = by + i * (bh + gap);
            const build = clamp((t - e.start) / mark, 0, 1) * (i ? 0.72 : 1);
            let v;
            if (wipe) v = after <= 0 ? build : after < 160 ? build * (1 - after / 160) : 0;
            else v = after <= 0 ? 0 : clamp(after / (span - mark), 0, 1) * (i ? 0.62 : 0.95);

            ctx.fillStyle = 'rgba(10,14,12,.72)';
            ctx.strokeStyle = 'rgba(236,230,216,.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, y, bw, bh, 2);
            ctx.fill();
            ctx.stroke();
            if (v > 0.01) {
                ctx.fillStyle = row.tone;
                ctx.beginPath();
                ctx.roundRect(bx + 1, y + 1, (bw - 2) * v, bh - 2, 1.5);
                ctx.fill();
            }
            ctx.fillStyle = '#9ba89f';
            ctx.textAlign = 'right';
            ctx.fillText(row.name, bx - 6, y + bh / 2);
        });

        if (after > 0 && after < 2400) {
            ctx.globalAlpha = clamp(1 - after / 2400, 0, 1);
            ctx.font = '700 17px "Barlow Condensed", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffb066';
            ctx.fillText(wipe ? 'threat wiped' : 'misdirect, then build', bx, by + rows.length * (bh + gap) + 8);
            ctx.globalAlpha = 1;
        }
        ctx.restore();

        if (!wipe && e.md && after > 0) {
            const md = clamp(after / 700, 0, 1);
            const h = px(at(sc, e.md));
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.lineDashOffset = -after / 30;
            ctx.strokeStyle = 'rgba(180,224,150,' + (0.95 * md) + ')';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(lerp(h.x, c.x, md), lerp(h.y, c.y, md));
            ctx.stroke();
            ctx.restore();
        }
    }

    // What the raid leader would be saying out loud right now.
    function drawCall(e, sc, t) {
        if (t < e.start || t > e.end) return;
        const fade = Math.min(1, (t - e.start) / 260, (e.end - t) / 400);
        ctx.save();
        ctx.globalAlpha = clamp(fade, 0, 1);
        ctx.font = '600 ' + (W < 500 ? 16 : 22) + 'px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(e.text).width + 30;
        const x = W / 2, y = 38;
        ctx.fillStyle = 'rgba(9,13,11,.84)';
        ctx.strokeStyle = 'rgba(255,106,31,.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 17, w, 34, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd9a8';
        ctx.fillText(e.text, x, y + 1);
        ctx.restore();
    }

    const EFFECTS = {
        ring: drawRing, sweep: drawSweep, trail: drawTrail,
        volcano: drawVolcano, gaze: drawGaze, impact: drawImpact, threat: drawThreat,
        call: drawCall
    };

    // ---- tokens ---------------------------------------------------------------

    function label(x, y, text, colour, size) {
        ctx.save();
        ctx.font = '600 ' + (size || 12.5) + 'px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 3.2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(6,9,8,.92)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = colour || '#e2ded2';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    function drawBoss(a, sc) {
        const c = px(sc._sim.boss);
        const r = clamp(yd(3.6), 15, 34) * (a.scale || 1);
        const img = image(FIGHT.portrait);
        withGlow(() => {
            const g = ctx.createRadialGradient(c.x, c.y, r * .6, c.x, c.y, r * 2.9);
            g.addColorStop(0, 'rgba(255,110,30,.30)');
            g.addColorStop(1, 'rgba(255,80,10,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(c.x, c.y, r * 2.9, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.75)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = '#1b1512';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.save();
        ctx.clip();
        if (img.complete && img.naturalWidth) ctx.drawImage(img, c.x - r, c.y - r, r * 2, r * 2);
        ctx.restore();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#d0793c';
        ctx.stroke();
        const gaze = sc.effects.find(e => e.kind === 'gaze' && sc._t >= e.start && sc._t < e.end);
        const mt = sc.raid.find(p => p.kind === 'tank');
        const currentTarget = sc._sim.bossTarget && sc._sim.pos[sc._sim.bossTarget] ? px(sc._sim.pos[sc._sim.bossTarget]) : null;
        const toward = FIGHT.id === 'bt-akama' ? px(sc._sim.akama) : currentTarget || (gaze ? px(at(sc, gaze.target)) : mt ? px(sc._sim.pos[mt.id]) : { x: c.x, y: c.y - 1 });
        const angle = Math.atan2(toward.y - c.y, toward.x - c.x);
        ctx.translate(c.x, c.y); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(r + 8, 0); ctx.lineTo(r - 2, -5); ctx.lineTo(r - 2, 5); ctx.closePath();
        ctx.fillStyle = '#f4c28f'; ctx.fill();
        ctx.restore();
    }

    function drawPlayer(p, sc, t) {
        const c = px(sc._sim.pos[p.id]);
        const r = clamp(yd(1.7), 9, 21);
        const img = image(ROLE_ICON[p.kind] || ROLE_ICON.ranged);
        const faint = sc._dim && !sc._focus[p.id];
        ctx.save();
        if (faint) ctx.globalAlpha = 0.24;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.8)';
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0d1210';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.save();
        ctx.clip();
        if (img.complete && img.naturalWidth) ctx.drawImage(img, c.x - r, c.y - r, r * 2, r * 2);
        ctx.restore();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(236,230,216,.8)';
        ctx.stroke();
        ctx.restore();

        const hp = ADAPTER
            ? (sc._sim.hp[p.id] ?? null)
            : valueAt(sc.hp && sc.hp[p.id], t);
        if (hp !== null) {
            const bw = r * 2.4, bh = 4, y = c.y - r - 7;
            ctx.save();
            ctx.fillStyle = 'rgba(10,14,12,.85)';
            ctx.fillRect(c.x - bw / 2, y, bw, bh);
            ctx.fillStyle = hp > 0.75 ? '#5fbe7d' : hp > 0.45 ? '#d9a441' : '#c8503f';
            ctx.fillRect(c.x - bw / 2 + .5, y + .5, (bw - 1) * hp, bh - 1);
            ctx.strokeStyle = 'rgba(0,0,0,.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(c.x - bw / 2, y, bw, bh);
            ctx.restore();
        }
        if (p.label && !faint) {
            // stacked tanks and a tight melee arc would otherwise print their names on top of
            // each other: lift every other one above its token instead of below.
            const above = p.kind === 'tank' ? p.slotIndex % 2 === 1 : p.slotIndex % 2 === 0;
            label(c.x, c.y + (above ? -(r + 6) : r + 12), p.label,
                p.kind === 'tank' ? '#bcd6f2' : '#e2ded2', 12);
        }
        // the word for what this person is doing about it, which is the thing to read first
        if (sc._roles[p.id]) label(c.x, c.y - r - 9, sc._roles[p.id], '#c5f4e9', 14);
        ctx.restore();
    }

    // ---- steps ----------------------------------------------------------------

    const tankSlots = assigned.filter(p => p.kind === 'tank').map(p => p.id);
    const prepareSupremusScene = s => {
        const sc = Object.assign({}, s);
        sc.cast = {};
        Object.keys(s.cast || {}).forEach(ref => {
            if (ref === 'md') {
                if (HUNTER) { sc.cast[ref] = HUNTER; return; }
                if (roster) return;
            }
            const role = s.castRoles && s.castRoles[ref];
            const pool = role ? assigned.filter(p => p.kind === role[0]) : assigned;
            const used = new Set(Object.values(sc.cast));
            const chosen = (pool[role ? role[1] : 0] && !used.has(pool[role ? role[1] : 0].id))
                ? pool[role ? role[1] : 0] : pool.find(p => !used.has(p.id));
            if (chosen) sc.cast[ref] = chosen.id;
        });
        sc.bossActor = (s.actors || []).find(a => a.kind === 'boss')
            || { id: 'boss', kind: 'boss', at: FIGHT.bossAt };
        sc.raid = (s.formation || s.morph) ? assigned.map(p => ({
            id: p.id, kind: p.kind, slotIndex: p.slotIndex,
            label: p.kind === 'tank'
                ? (tankSlots.indexOf(p.id) ? 'SOAK' : 'MT') + (s.id === 'p1-stand' && p.name ? ' · ' + p.name : '')
                : s.id === 'p1-stand' ? p.name : ''
        })) : [];
        sc.startsById = {};
        sc.pathsById = {};
        Object.entries(s.starts || {}).forEach(([ref, point]) => { if (sc.cast[ref]) sc.startsById[sc.cast[ref]] = point; });
        Object.entries(s.paths || {}).forEach(([ref, path]) => { if (sc.cast[ref]) sc.pathsById[sc.cast[ref]] = path; });
        // A partial roster can lack a demonstrated role. Do not draw an effect at the boss
        // as a fallback for a missing player.
        sc.effects = (s.effects || []).filter(e => ['follow', 'target'].every(k =>
            !e[k] || e[k] === 'boss' || sc.cast[e[k]] || assigned.some(p => p.id === e[k])))
            .map(e => { const copy = { ...e }; if (e.md && !sc.cast[e.md]) delete copy.md; return copy; });
        if (roster && !HUNTER && s.id === 'back') {
            sc.call = 'Ease off. Tanks pick up. Wait for control.';
            sc.caption = 'Start where the chase ended. At the reset, tanks take control. Only then does melee return and the boss move back.';
            sc.jobs = s.jobs.map(([role, job]) => [role, role === 'Hunters'
                ? 'No hunter is loaded. Give the pickup tank extra time to establish threat.' : job]);
            sc.effects.forEach(e => { if (e.kind === 'call') e.text = e.text.replace(', MD now', ''); });
        }
        if (s.id === 'p1-hateful') {
            sc.hp = {};
            if (sc.cast.mt) sc.hp[sc.cast.mt] = [{ t: 0, v: 1 }, { t: 1200, v: 1 }, { t: 1400, v: .72 }, { t: 2600, v: 1 }];
            if (sc.cast.soak) sc.hp[sc.cast.soak] = [{ t: 0, v: 1 }, { t: 3200, v: 1 }, { t: 3400, v: .40 }, { t: 5200, v: 1 }, { t: 6200, v: 1 }, { t: 6400, v: .42 }, { t: 8000, v: 1 }];
        }
        return sc;
    };
    const scenes = ADAPTER
        ? FIGHT.scenes.map(s => ADAPTER.prepareScene(FIGHT, s, assigned))
        : FIGHT.scenes.map(prepareSupremusScene);
    if (!ADAPTER) scenes.forEach(sc => {
        if (!sc.continueFrom) return;
        const previous = scenes.find(s => s.id === sc.continueFrom);
        sc.initial = simulate(previous, previous.duration);
        sc.pickup = sc.initial.boss;
        // An eruption already on the floor remains while the raid prepares the pickup.
        previous.effects.filter(e => e.kind === 'volcano' && e.end > previous.duration).forEach(e => {
            sc.effects.unshift(Object.assign({}, e, { start: e.start - previous.duration, end: e.end - previous.duration }));
        });
    });

    let idx = 0;
    const playback = window.TacticsPlayback.create(scenes[0].duration);
    let lastInstructionRows = null;
    let explanationIndex = 0;

    function isGuidedScene(sc = scenes[idx]) { return !!(RELIQUARY_STEPS && sc && sc.id !== 'cycle' && RELIQUARY_STEPS.forScene(sc.id).length); }
    function currentExplanation() { return RELIQUARY_STEPS?.all()[explanationIndex] || null; }
    function chapterExplanationIndex(sceneId, localIndex = 0) {
        const found = RELIQUARY_STEPS?.all().findIndex(item => item.sceneId === sceneId && item.localIndex === localIndex);
        return found == null || found < 0 ? 0 : found;
    }
    function resetExplanationDemo(now) {
        const explanation = isGuidedScene() ? currentExplanation() : null;
        const duration = explanation ? (explanation.loop === 'effect' ? Number.MAX_SAFE_INTEGER : Math.max(1, explanation.holdAtMs - explanation.startMs)) : scenes[idx].duration;
        playback.reset(duration, now);
        if (!REDUCED && (scenes[idx].animated || scenes[idx].effects.length)) playback.play(now);
    }
    function resolvedExplanation(explanation, sc) {
        if (!explanation) return null;
        const hasClass = value => sc.raid.some(player => String(player.class || '').toUpperCase() === value);
        const absent = (title, detail) => ({ ...explanation, title, detail });
        const tankCount = sc.tanks.length;
        if (['hold-fixates', 'low-health', 'incoming-tank', 'first-handoff', 'enrage-prep', 'enrage-survival'].includes(explanation.id) && !tankCount)
            return absent('No tank is loaded.', 'No Suffering tank example can be shown for this roster.');
        if (explanation.id === 'low-health' && tankCount === 1)
            return absent('Tank health is getting low.', 'No fresh tank is loaded. Prepare survival cooldowns; a handoff cannot be shown.');
        if (['incoming-tank', 'first-handoff'].includes(explanation.id) && tankCount < 2)
            return absent('No fresh tank is loaded.', 'One tank is loaded, so this health-based handoff is not demonstrated.');
        if (['anger-pickup', 'anger-taunt'].includes(explanation.id) && !sc.tanks.length)
            return absent('No tank pickup is assigned.', 'No tank is loaded, so Anger pickup and the two-tank taunt are not demonstrated.');
        if (['anger-pickup', 'anger-taunt'].includes(explanation.id) && sc.tanks.length < 2)
            return absent('Secure Anger with the loaded tank.', 'One tank is loaded, so no off-tank pickup or main-tank taunt is shown.');
        if (explanation.id === 'anger-burn' && !sc.tanks.length)
            return absent('Hold damage until Anger has a tank.', 'No tank pickup is assigned, so damage and Bloodlust are not demonstrated.');
        if (explanation.id === 'anger-burn' && !sc.hasDamage)
            return absent('Damage coverage is missing.', 'No damage role is loaded, so the burn is not fabricated.');
        if (['gather-souls', 'kill-soul', 'soul-recovery'].includes(explanation.id) && !sc.hasDamage && explanation.id !== 'gather-souls')
            return absent('Soul recovery needs damage coverage.', 'No damage role is loaded, so nearby soul deaths and recovery are not demonstrated.');
        if (explanation.id === 'dispel-drain' && !sc.dispeller)
            return absent('Soul Drain dispel coverage is missing.', 'No known eligible magic dispeller is loaded, so the drain remains active.');
        if (explanation.id === 'priest-shield' && !sc.absorber)
            return absent('Absorb coverage is missing.', 'No known Priest is loaded, so a shield is not fabricated.');
        if (explanation.id === 'healer-dps' && !sc.raid.some(player => player.kind === 'healer'))
            return absent('Healer coverage is missing.', 'No healer is loaded; the demonstration does not invent healer damage coverage.');
        if (explanation.id === 'rogue-evasion' && !hasClass('ROGUE'))
            return absent('Optional Rogue Evasion is unavailable.', 'No known Rogue is loaded for this optional Enrage reminder.');
        if (explanation.id === 'hunter-deterrence' && !hasClass('HUNTER'))
            return absent('Optional Hunter Deterrence is unavailable.', 'No known Hunter is loaded for this optional Enrage reminder.');
        const missing = sc.missingRoles || [];
        if (['tongues', 'first-spirit-shock', 'next-spirit-shock', 'deaden-cast', 'deaden-kick'].includes(explanation.id) && missing.some(note => /interrupt coverage/i.test(note)))
            return { ...explanation, title: 'Interrupt coverage is missing.', detail: 'No known eligible interrupter is loaded. The demonstration keeps that coverage gap explicit.' };
        if (['rune-shield', 'spellsteal'].includes(explanation.id) && missing.some(note => /Rune Shield removal/i.test(note)))
            return { ...explanation, title: 'Rune Shield removal is missing.', detail: 'No known eligible removal is loaded. Do not pretend an interrupt can pass through Rune Shield.' };
        if (explanation.id === 'tongues' && !sc.tongues)
            return { ...explanation, title: 'Curse of Tongues coverage is missing.', detail: 'No known Warlock is loaded, so Spirit Shock stays at its normal cast speed.' };
        return explanation;
    }
    const explanationTipKinds = { 'anger-preparation': 'shadow-protection', 'rogue-evasion': 'evasion', 'hunter-deterrence': 'deterrence', 'spell-reflection': 'spell-reflection', 'deadly-throw': 'glove-backup', 'spite-healthstone': 'healthstone' };

    function showInstructionRows(rows) {
        const key = JSON.stringify(rows || []);
        if (key === lastInstructionRows) return;
        lastInstructionRows = key;
        const notes = el('roleNotes');
        notes.replaceChildren();
        (rows || []).forEach(([role, job]) => {
            const dt = document.createElement('dt'), dd = document.createElement('dd');
            dt.textContent = role; dd.textContent = job;
            notes.append(dt, dd);
        });
    }

    function drawRoutes(sc, t) {
        Object.entries(sc.pathsById || {}).forEach(([id, path]) => {
            const gaze = sc.effects.find(e => e.kind === 'gaze' && castId(sc, e.target) === id && t >= e.start && t < e.end);
            const trail = sc.effects.find(e => e.kind === 'trail' && castId(sc, e.follow) === id && t <= e.start + e.chaseMs);
            if (!gaze && !trail) return;
            const ahead = path.filter(p => p.t > t);
            if (!ahead.length) return;
            const from = px(sc._sim.pos[id]);
            ctx.save();
            ctx.strokeStyle = '#c5f4e9';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 7]);
            ctx.beginPath(); ctx.moveTo(from.x, from.y);
            ahead.forEach(p => { const q = px(p); ctx.lineTo(q.x, q.y); });
            ctx.stroke(); ctx.setLineDash([]);
            const end = px(ahead[ahead.length - 1]);
            const prev = ahead.length > 1 ? px(ahead[ahead.length - 2]) : from;
            const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
            ctx.beginPath();
            ctx.moveTo(end.x - Math.cos(angle - .5) * 12, end.y - Math.sin(angle - .5) * 12);
            ctx.lineTo(end.x, end.y);
            ctx.lineTo(end.x - Math.cos(angle + .5) * 12, end.y - Math.sin(angle + .5) * 12);
            ctx.stroke(); ctx.restore();
        });
    }

    function paint(now) {
        if (!W) return;
        const sc = scenes[idx];
        const elapsed = playback.time(now);
        const explanation = isGuidedScene(sc) ? resolvedExplanation(currentExplanation(), sc) : null;
        const t = explanation ? RELIQUARY_STEPS.frameAt(explanation, elapsed) : elapsed;

        sc._sim = simulate(sc, t);
        if (explanation) {
            const teaching = resolvedExplanation(explanation, sc);
            const guidance = sc._guidance || sc._sim;
            sc._sim.call = teaching.title + ' ' + teaching.detail;
            sc._sim.instructionRows = guidance.instructionRows || [];
            sc._sim.teaching = { ...guidance.teaching, title: teaching.title, detail: teaching.detail, tip: teaching.tip };
            if (sc._sim.tipVisual && sc._sim.tipVisual.kind !== explanationTipKinds[explanation.id]) sc._sim.tipVisual = null;
            sc._sim.explanation = teaching;
            sc._sim.explanationElapsedMs = elapsed;
            sc._sim.effectLoopProgress = explanation.loop === 'effect' && elapsed >= explanation.holdAtMs - explanation.startMs
                ? ((elapsed - (explanation.holdAtMs - explanation.startMs)) % 1200) / 1200 : null;
            sc._sim.explanationCountdown = teaching.countdownSeconds ? RELIQUARY_STEPS.countdownAt(teaching, elapsed) : null;
        }
        if (FIGHT.id === 'bt-reliquary') {
            const lesson = sc._sim.teaching || {};
            const description = [sc._sim.essence, lesson.title || sc._sim.call, lesson.detail, lesson.tip,
                ...(sc._sim.instructionRows || []).map(row => row.join(': '))].filter(Boolean).join('. ');
            if (cv.getAttribute('aria-label') !== description) cv.setAttribute('aria-label', description);
        }
        sc._dim = ADAPTER
            ? Object.keys(sc._sim.focus || {}).length > 0
            : (sc.effects || []).some(e => HAZARDS[e.kind]) || !!sc.focus;
        sc._t = t;
        sc._focus = ADAPTER ? sc._sim.focus : (sc._dim ? focusOf(sc, t) : {});
        sc._roles = ADAPTER ? sc._sim.roles : {};
        if (!ADAPTER) Object.keys(sc.roles || {}).forEach(k => { sc._roles[castId(sc, k)] = sc.roles[k]; });
        if (ADAPTER && Array.isArray(sc._sim.instructionRows)) showInstructionRows(sc._sim.instructionRows);
        aim(sc.view, sc);
        ctx.clearRect(0, 0, W, H);
        drawMap();

        if (OVERLAY) OVERLAY.draw('floor', { ctx, px, yd, width: W, height: H }, sc, sc._sim);
        (sc.effects || []).filter(e => e.kind !== 'gaze' && e.kind !== 'call')
            .forEach(e => EFFECTS[e.kind] && EFFECTS[e.kind](e, sc, t));
        drawRoutes(sc, t);
        if (sc._sim.bossVisible !== false) drawBoss(sc.bossActor, sc);
        sc.raid.forEach(p => drawPlayer(p, sc, t));
        // the gaze goes last: it is the thing you must notice
        (sc.effects || []).filter(e => e.kind === 'gaze').forEach(e => drawGaze(e, sc, t));
        (sc.effects || []).filter(e => e.kind === 'call').forEach(e => drawCall(e, sc, t));
        if (OVERLAY) OVERLAY.draw('foreground', { ctx, px, yd, width: W, height: H }, sc, sc._sim);
    }

    // ---- chrome ---------------------------------------------------------------

    const el = id => document.getElementById(id);
    document.body.dataset.fight = FIGHT.id;
    el('portrait').src = FIGHT.portrait;
    el('bossName').textContent = FIGHT.name;
    el('bossWhere').textContent = FIGHT.where;
    image(FIGHT.map);
    document.title = FIGHT.name + ' — fight briefing';
    const bossNav = el('bossNav');
    Object.entries(fights).forEach(([id, fight]) => {
        const link = document.createElement('a'), url = new URL(location.href);
        url.searchParams.set('fight', id); url.hash = '';
        link.href = url.href; link.className = 'boss-tab'; link.textContent = fight.name;
        if (id === FIGHT.id) link.setAttribute('aria-current', 'page');
        bossNav.appendChild(link);
    });
    const legend = el('legend');
    legend.replaceChildren();
    FIGHT.legend.forEach(item => {
        const row = document.createElement('span'), mark = document.createElement('i');
        row.className = 'legend__item'; mark.className = 'legend__mark legend__mark--' + item.kind;
        row.append(mark, document.createTextNode(item.label)); legend.appendChild(row);
    });

    const rail = el('rail');
    const reliquaryReferenceOnly = FIGHT.id === 'bt-reliquary';
    rail.innerHTML = '<section class="guide"><p class="eyebrow" id="sceneLabel"' + (reliquaryReferenceOnly ? ' hidden' : '') + '></p>' +
        '<h2 class="guide__call" id="sceneCall"' + (reliquaryReferenceOnly ? ' hidden' : '') + '></h2><p class="guide__why" id="sceneWhy"' + (reliquaryReferenceOnly ? ' hidden' : '') + '></p>' +
        '<div class="scene-spells" id="sceneSpells" aria-label="Active spell details"></div>' +
        '<dl class="role-notes" id="roleNotes"' + (reliquaryReferenceOnly ? ' hidden' : '') + '></dl><div class="mistake"' + (reliquaryReferenceOnly ? ' hidden' : '') + '><span>Watch out</span>' +
        '<p id="sceneMistake"></p></div></section>' +
        '<details class="reference"><summary>' + FIGHT.referenceTitle + '</summary><div id="referenceContent"></div></details>';
    const reference = el('referenceContent');
    FIGHT.abilities.forEach(a => {
        const card = document.createElement('article');
        card.className = 'card card--t' + a.tier;
        card.innerHTML = '<img class="card__icon" src="' + a.icon + '" alt="">' +
            '<div><h3 class="card__name">' + a.name + '</h3><p class="card__meta">' + (a.stageLabel || ('Phase ' + a.phase)) + '</p>' +
                '<p class="card__desc">' + a.tooltip.description + '</p>' +
                (reliquaryReferenceOnly ? '' : '<p class="card__do">' + a.doThis + '</p>') + '</div>';
        reference.appendChild(card);
    });
    if (!reliquaryReferenceOnly) {
        const sheet = document.createElement('section');
        sheet.className = 'sheet';
        sheet.innerHTML = '<h3 class="sheet__title">' + (FIGHT.remindersTitle || FIGHT.referenceTitle) + '</h3><ol class="sheet__steps">' +
            FIGHT.tips.map(t => '<li>' + t + '</li>').join('') + '</ol>';
        reference.appendChild(sheet);
    }
    const credit = document.createElement('div');
    credit.className = 'credit';
    credit.innerHTML = '<p>Illustrative paths and positions. Map scale and danger rings are approximate; leave a margin in game.</p>';
    FIGHT.sources.forEach(source => {
        const link = document.createElement('a');
        link.href = source.url; link.textContent = source.name; link.target = '_blank'; link.rel = 'noopener noreferrer';
        credit.appendChild(link);
    });
    reference.appendChild(credit);

    function showSpellDetails(sc) {
        const container = el('sceneSpells');
        container.replaceChildren();
        const abilities = (sc.highlight || []).map(id => FIGHT.abilities.find(a => a.id === id)).filter(Boolean);
        container.hidden = !abilities.length;
        abilities.forEach(a => {
            const card = document.createElement('article');
            card.className = 'spell-tooltip';
            const head = document.createElement('div');
            head.className = 'spell-tooltip__head';
            const icon = document.createElement('img');
            icon.src = a.icon; icon.alt = ''; icon.width = 32; icon.height = 32;
            const title = document.createElement('h3');
            const link = document.createElement('a');
            link.href = a.url || ('https://www.wowhead.com/tbc/spell=' + a.spell);
            link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = a.name;
            title.appendChild(link); head.append(icon, title); card.appendChild(head);
            const meta = document.createElement('p');
            meta.className = 'spell-tooltip__meta';
            meta.textContent = [a.tooltip.range, a.tooltip.castTime, a.tooltip.cooldown].filter(Boolean).join(' · ');
            const description = document.createElement('p');
            description.className = 'spell-tooltip__description';
            description.textContent = a.tooltip.spellText || a.tooltip.description;
            card.append(meta, description);
            if (a.itemUrl) {
                const item = document.createElement('a');
                item.href = a.itemUrl; item.target = '_blank'; item.rel = 'noopener noreferrer';
                item.textContent = 'Naj’entus Spine item'; card.appendChild(item);
            }
            if (a.tooltip.duration || a.tooltip.aura) {
                const note = document.createElement('p');
                note.className = 'spell-tooltip__note';
                note.textContent = [a.tooltip.duration && 'Effect: ' + a.tooltip.duration, a.tooltip.aura].filter(Boolean).join(' · ');
                card.appendChild(note);
            }
            container.appendChild(card);
        });
    }

    const dots = el('dots');
    scenes.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'dot'; b.type = 'button';
        b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + s.chapter);
        b.innerHTML = '<span class="chapter__number">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="chapter__title">' + s.chapter + '</span>';
        b.addEventListener('click', () => show(i, 0)); dots.appendChild(b);
    });

    function revealChapter() {
        const active = dots.children[idx];
        if (!active) return;
        const left = active.getBoundingClientRect().left - dots.getBoundingClientRect().left + dots.scrollLeft;
        if (left < dots.scrollLeft || left + active.offsetWidth > dots.scrollLeft + dots.clientWidth)
            dots.scrollLeft = Math.max(0, left - dots.clientWidth / 2 + active.offsetWidth / 2);
    }

    function show(i, localExplanation = 0) {
        idx = clamp(i, 0, scenes.length - 1);
        const sc = scenes[idx];
        sc.currentCall = null;
        lastInstructionRows = null;
        const now = performance.now();
        if (isGuidedScene(sc)) explanationIndex = chapterExplanationIndex(sc.id, localExplanation);
        resetExplanationDemo(now);
        const explanation = isGuidedScene(sc) ? resolvedExplanation(currentExplanation(), sc) : null;
        sc._guidance = explanation ? simulate(sc, currentExplanation().startMs) : null;
        document.body.classList.toggle('has-guided-explanation', !!explanation);
        el('stepTitle').textContent = sc.title;
        el('stepCaption').textContent = sc.caption;
        el('manualExplanation').hidden = !explanation;
        el('manualProgress').hidden = !explanation;
        if (explanation) {
            el('manualProgress').textContent = 'Explanation ' + (explanation.localIndex + 1) + ' of ' + explanation.count + (explanation.optional ? ' · Optional' : '');
            el('manualTitle').textContent = explanation.title;
            el('manualDetail').textContent = explanation.detail;
            el('manualCountdown').hidden = !explanation.countdownSeconds;
            el('manualCountdown').textContent = explanation.countdownSeconds ? 'Impact in ' + explanation.countdownSeconds + 's' : '';
        } else {
            el('manualProgress').textContent = '';
            el('manualCountdown').hidden = true;
            el('manualCountdown').textContent = '';
        }
        el('sceneLabel').textContent = 'STEP ' + String(idx + 1).padStart(2, '0') + ' / ' + String(scenes.length).padStart(2, '0') +
            ' · ' + (FIGHT.stateLabels ? (FIGHT.stateLabels[sc.id === 'burn' ? 'burn' : sc.id] || FIGHT.stateLabels.bound || 'NORMAL COMBAT').toUpperCase() : FIGHT.clockMode === 'state' ? 'NORMAL COMBAT' : (sc.countdown ? 'TRANSITION' : sc.phase ? 'PHASE ' + sc.phase : 'THE FIGHT'));
        el('sceneCall').textContent = explanation ? explanation.title : sc.call;
        if (el('mapCall')) el('mapCall').textContent = explanation ? explanation.title : sc.call;
        el('sceneWhy').textContent = sc.why;
        showSpellDetails(sc);
        el('sceneMistake').textContent = sc.mistake;
        if (roster) {
            el('rosterNote').hidden = false;
            const missing = Object.keys(sc.castRoles || {}).filter(ref => !sc.cast[ref]);
            el('rosterNote').textContent = assigned.length + ' players loaded · positions are examples.' +
                ((sc.missingRoles || []).length ? ' ' + sc.missingRoles.join(' ') : missing.includes('md') ? ' No hunter loaded: Misdirect is not assigned.' :
                 missing.length ? ' This roster lacks a role used in the example.' : '');
        }
        showInstructionRows(sc.jobs);
        [...dots.children].forEach((d, k) => {
            d.classList.toggle('is-on', k === idx);
            if (k === idx) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
        });
        revealChapter();
        const chapterSteps = explanation ? RELIQUARY_STEPS.forScene(sc.id) : [];
        el('prev').disabled = explanation ? idx === 0 && explanation.localIndex === 0 : idx === 0;
        el('next').disabled = explanation ? idx === scenes.length - 1 && explanation.localIndex === chapterSteps.length - 1 : idx === scenes.length - 1;
        el('prev').setAttribute('aria-label', explanation ? 'Previous explanation' : 'Previous scene');
        el('next').setAttribute('aria-label', explanation ? 'Next explanation' : 'Next scene');
        render(now);
    }

    function showExplanation(index) {
        const explanation = RELIQUARY_STEPS?.all()[index];
        if (!explanation) return;
        const sceneIndex = scenes.findIndex(sc => sc.id === explanation.sceneId);
        if (sceneIndex >= 0) show(sceneIndex, explanation.localIndex);
    }
    function moveExplanation(delta) {
        if (!isGuidedScene()) {
            if (RELIQUARY_STEPS && scenes[idx].id === 'cycle' && delta < 0) {
                const lastScene = RELIQUARY_STEPS.order[RELIQUARY_STEPS.order.indexOf('cycle') - 1];
                show(scenes.findIndex(sc => sc.id === lastScene), RELIQUARY_STEPS.forScene(lastScene).length - 1);
            } else show(idx + delta);
            return;
        }
        const explanation = currentExplanation(), local = explanation.localIndex + delta;
        const steps = RELIQUARY_STEPS.forScene(explanation.sceneId);
        if (local >= 0 && local < steps.length) { show(idx, local); return; }
        const boundary = RELIQUARY_STEPS.chapterBoundary(explanation.sceneId, local);
        if (boundary) show(scenes.findIndex(sc => sc.id === boundary.sceneId), boundary.localIndex);
    }

    // ---- taking it away -------------------------------------------------------

    function flash(btn, msg) {
        const was = btn.dataset.label || btn.textContent;
        btn.dataset.label = was;
        btn.textContent = msg;
        setTimeout(() => { btn.textContent = was; }, 1600);
    }

    async function copyPositions() {
        const btn = el('copyText');
        render(performance.now());
        const sc = scenes[idx];
        const phase = sc.countdown
            ? ((sc._t || 0) >= sc.countdown.at ? sc.countdown.phase : 3 - sc.countdown.phase)
            : sc.phase || 1;
        const current = sc.currentCall || sc.call;
        const stage = FIGHT.clockMode === 'state' ? '\nState: ' + (sc._sim?.stage || 'normal') : '';
        const complete = sc._sim?.stage === 'complete';
        const guidance = complete ? [] : [...sc.jobs.map(([role, job]) => role + ': ' + job), '', 'Watch out: ' + sc.mistake];
        const text = [FIGHT.name + ' — ' + (complete ? 'encounter complete' : sc.title), current + stage, '', ...guidance, '', (ADAPTER?.copyText ? ADAPTER.copyText(FIGHT, sc, sc._sim) : L.copyText(FIGHT, FIGHT.clockMode === 'state' ? 1 : phase, assigned))].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            flash(btn, 'Copied');
        } catch (e) {
            const a = document.createElement('a');
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.href = url;
            a.download = FIGHT.slug + '-briefing-' + sc.id + '.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            flash(btn, 'Saved');
        }
    }

    function copyImage() {
        render(performance.now());
        const btn = el('copyImage'), sc = scenes[idx];
        const exportRows = FIGHT.id === 'bt-reliquary' ? sc._sim?.instructionRows || [] : null;
        const rowsHeight = Math.min(exportRows?.length || 0, 5) * 25;
        const out = document.createElement('canvas');
        out.width = cv.width; out.height = cv.height + 180 + rowsHeight;
        const g = out.getContext('2d');
        g.fillStyle = '#0b0f0d'; g.fillRect(0, 0, out.width, out.height);
        g.fillStyle = '#ece6d8'; g.font = '600 30px "Barlow Condensed", sans-serif';
        g.fillText(FIGHT.name + ' · ' + sc.chapter, 24, 42, out.width - 48);
        g.fillStyle = '#c5f4e9'; g.font = '500 23px "IBM Plex Sans", sans-serif';
        g.fillText(sc.currentCall || sc.call, 24, 82, out.width - 48);
        if (exportRows) { g.fillStyle = '#d9dfd9'; g.font = '16px "IBM Plex Sans", sans-serif'; exportRows.slice(0, 5).forEach(([role, job], index) => g.fillText(role + ': ' + job, 24, 108 + index * 25, out.width - 48)); }
        g.drawImage(cv, 0, 106 + rowsHeight);
        g.fillStyle = '#9ba89f'; g.font = '18px "IBM Plex Sans", sans-serif';
        g.fillText('Example positions and routes · Approximate scale · ' + FIGHT.legend.map(x => x.exportLabel).join(' / '), 24, out.height - 27, out.width - 48);
        out.toBlob(async blob => {
            if (!blob) { flash(btn, 'Export failed'); return; }
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                flash(btn, 'Copied');
            } catch (e) {
                const a = document.createElement('a'), url = URL.createObjectURL(blob);
                a.href = url; a.download = FIGHT.slug + '-' + sc.id + '.png'; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000); flash(btn, 'Saved');
            }
        }, 'image/png');
    }

    el('copyText').addEventListener('click', copyPositions);
    el('copyImage').addEventListener('click', copyImage);
    el('next').addEventListener('click', () => moveExplanation(1));
    el('prev').addEventListener('click', () => moveExplanation(-1));
    function togglePlay() {
        const now = performance.now();
        if (playback.playing) playback.pause(now); else playback.play(now);
        render(now);
    }
    function replay() {
        const now = performance.now();
        playback.seek(0, now);
        if (!REDUCED) playback.play(now);
        render(now);
    }
    async function fullscreen() {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        } catch (e) { flash(el('fullscreen'), 'Unavailable'); }
    }
    el('playPause').addEventListener('click', togglePlay);
    el('replay').addEventListener('click', replay);
    el('fullscreen').addEventListener('click', fullscreen);
    el('scrub').addEventListener('input', ev => {
        const now = performance.now(); playback.pause(now);
        playback.seek(Number(ev.target.value) / 100 * scenes[idx].duration, now); render(now);
    });
    el('speed').addEventListener('change', ev => {
        const now = performance.now(); playback.setSpeed(Number(ev.target.value), now); render(now);
    });
    document.addEventListener('keydown', ev => {
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
        if (ev.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable)) return;
        if (ev.key === ' ' && ev.target && /^(BUTTON|SUMMARY|A)$/.test(ev.target.tagName)) return;
        if (ev.key === 'ArrowRight') { ev.preventDefault(); moveExplanation(1); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); moveExplanation(-1); }
        else if (ev.key === ' ') { ev.preventDefault(); togglePlay(); }
        else if (ev.key.toLowerCase() === 'r') replay();
        else if (ev.key.toLowerCase() === 'f') fullscreen();
        else if (/^[1-9]$/.test(ev.key)) show(parseInt(ev.key, 10) - 1);
    });

    if (!roster) {
        const note = el('rosterNote');
        note.hidden = false;
        note.textContent = 'Example raid · ' + [FIGHT.roster.tanks + ' tanks', FIGHT.roster.healers + ' healers', FIGHT.roster.melee + ' melee', FIGHT.roster.ranged + ' ranged'].join(', ') + '. Import your roster on Assignments for named positioning.';
    }

    // Encounter seconds follow the example scene. The playhead never runs independently
    // of the map, and both freeze when the presenter pauses.
    const clockHead = el('clockHead');
    const half = { 1: el('clockP1'), 2: el('clockP2') };
    const secs = { 1: half[1].querySelector('span'), 2: half[2].querySelector('span') };

    function tickClock() {
        const sc = scenes[idx], t = sc._t || 0;
        if (isGuidedScene(sc)) {
            el('clock').hidden = true; el('encounterState').hidden = true;
            return;
        }
        if (FIGHT.clockMode === 'state') {
            const stateLabels = FIGHT.stateLabels || { normal: 'Normal combat', shield: 'Shield: heal up', ready: 'Ready: await call', throw: 'Spine in flight', burst: 'Raidwide burst', recover: 'Recover: heal everyone' };
            el('clock').hidden = true; el('encounterState').hidden = false;
            const frame = sc._sim || { stage: 'normal', timeMs: 0 };
            el('encounterState').textContent = (stateLabels[frame.stage] || frame.stage) + ' · Example ' + (frame.timeMs / 1000).toFixed(1) + 's';
            return;
        }
        el('clock').hidden = false; el('encounterState').hidden = true;
        const seconds = (sc.fightStart || 0) + t / 1000;
        const cycle = seconds % 120;
        const phase = cycle < 60 ? 1 : 2;
        clockHead.style.visibility = sc.id === 'overview' ? 'hidden' : 'visible';
        clockHead.style.left = (cycle / 120 * 100) + '%';
        [1, 2].forEach(p => {
            half[p].classList.toggle('is-on', sc.id !== 'overview' && phase === p);
            const remaining = p === phase && sc.id !== 'overview' ? 60 - cycle % 60 : 60;
            secs[p].textContent = Math.ceil(remaining) + 's';
            secs[p].classList.toggle('is-soon', remaining <= 5);
        });
    }
    function render(now) {
        if (!scenes[idx]) return;
        paint(now); syncCurrentGuidance(scenes[idx]); tickClock();
        const selected = scenes[idx]._sim?.explanation;
        const t = selected ? scenes[idx]._sim.explanationElapsedMs : scenes[idx]._t || 0;
        const duration = selected ? selected.holdAtMs - selected.startMs : scenes[idx].duration;
        el('playPause').textContent = playback.playing ? 'Pause' : t >= duration ? 'Play again' : 'Play';
        el('playPause').setAttribute('aria-label', playback.playing ? 'Pause animation' : 'Play animation');
        el('scrub').value = t / duration * 100;
        el('scrub').setAttribute('aria-valuetext', (t / 1000).toFixed(1) + ' of ' + (duration / 1000) + ' seconds');
        el('elapsed').textContent = (t / 1000).toFixed(1) + ' / ' + (duration / 1000) + 's';
        const explanation = selected;
        if (explanation?.countdownSeconds) {
            const seconds = RELIQUARY_STEPS.countdownAt(explanation, scenes[idx]._sim.explanationElapsedMs || 0);
            el('manualCountdown').textContent = seconds ? 'Impact in ' + seconds + 's' : 'Impact resolved';
        }
    }
    function syncCurrentGuidance(sc) {
        if (sc._sim?.explanation) {
            const stableCall = sc._sim.explanation.title;
            sc.currentCall = stableCall;
            el('sceneCall').textContent = stableCall;
            if (el('mapCall')) el('mapCall').textContent = stableCall;
            return;
        }
        const current = (sc._sim && sc._sim.call) || sc.call;
        if (FIGHT.stateLabels && sc._sim) {
            const stageLabel = 'STEP ' + String(idx + 1).padStart(2, '0') + ' / ' + String(scenes.length).padStart(2, '0') + ' · ' + FIGHT.stateLabels[sc._sim.stage].toUpperCase();
            if (el('sceneLabel').textContent !== stageLabel) el('sceneLabel').textContent = stageLabel;
        }
        if (sc.currentCall === current) return;
        sc.currentCall = current;
        el('sceneCall').textContent = current;
        if (el('mapCall')) el('mapCall').textContent = current;
    }
    function frame(now) {
        if (playback.playing) render(now);
        requestAnimationFrame(frame);
    }

    function start() {
        resize();
        show(0);
        requestAnimationFrame(frame);
    }

    window.addEventListener('resize', () => { if (resize()) render(performance.now()); });
    const mapImg = image(FIGHT.map);
    if (mapImg.complete && mapImg.naturalWidth) start();
    else mapImg.addEventListener('load', start);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (resize()) render(performance.now()); });
    new ResizeObserver(() => { if (resize()) { render(performance.now()); revealChapter(); } }).observe(cv);
    Object.values(IMG).forEach(img => img.addEventListener('load', () => render(performance.now())));

    // lets the screenshot harness step scenes without synthesising key events
    window.__tactics = { show, showExplanation, count: scenes.length, scenes, assigned, roster, playback, render, frameOf, px, simulate, fight: FIGHT,
        guided: RELIQUARY_STEPS ? { get active() { return scenes[idx]._sim?.explanation || resolvedExplanation(currentExplanation(), scenes[idx]); }, steps: RELIQUARY_STEPS.all(), chapterSteps: RELIQUARY_STEPS.forScene, get selectedIndex() { return explanationIndex; }, timelineFor: RELIQUARY_STEPS.timelineFor, isGuided: isGuidedScene } : null };
}());
