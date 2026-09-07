/* Fight briefing player.
 *
 * Draws a boss fight on top of a top-down capture of the room: the real raid as tokens, the
 * mechanics as animated effects on a canvas over it. Every danger radius comes from the yard
 * figure in the ability's own tooltip, so what you see is the size it really is.
 *
 * The raid is not choreographed. Each frame re-runs a short simulation of the step from its
 * beginning: hazards move, and anyone standing in one walks out and stays out until it is
 * gone. That is why a mechanic can be dropped onto the formation and simply work.
 *
 * Fight data lives in tactics-data.js and the standing spots in tactics-layout.js; this file
 * knows nothing about any particular boss.
 */
(function () {
    'use strict';

    const FIGHT = window.TacticsData.FIGHTS['bt-supremus'];
    const L = window.TacticsLayout;
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
        return out;
    }

    const roster = loadRoster();
    const assigned = L.assign(FIGHT, roster);
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
                const k = easeOut(clamp((t - p[i - 1].t) / span, 0, 1));
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

    // ---- canvas ---------------------------------------------------------------

    const cv = document.getElementById('fx');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0;

    const MW = 1600, MH = 889;
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
    function aim(view) {
        const want = (view.spanYards * FIGHT.yard) * MW;
        const box = W / H;
        let w = want, h = want / box;
        if (w > MW) { w = MW; h = w / box; }
        if (h > MH) { h = MH; w = h * box; }
        src = {
            w: w, h: h,
            x: clamp(view.cx * MW - w / 2, 0, MW - w),
            y: clamp(view.cy * MH - h / 2, 0, MH - h)
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
        g.filter = 'brightness(1.42) contrast(1.04) saturate(.62)';
        g.drawImage(img, 0, 0, MW, MH);
        lit = c;
        return lit;
    }

    function drawMap() {
        const m = litMap();
        if (m) ctx.drawImage(m, src.x, src.y, src.w, src.h, 0, 0, W, H);
    }

    // ---- the simulation -------------------------------------------------------

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
    function homeAt(sc, p, t) {
        if (!sc.morph) return PLACED[sc.formation][p.id].at;
        const a = PLACED[sc.morph.from][p.id].at, b = PLACED[sc.morph.to][p.id].at;
        if (a === b) return a;
        // stagger the walkers so the raid drifts out rather than marching in lockstep
        const off = (p.slotIndex % 5) * 220;
        const k = easeInOut(clamp((t - sc.morph.start - off) / (sc.morph.end - sc.morph.start), 0, 1));
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
    }

    // Run the step from its beginning up to t. Cheap enough to redo every frame, which keeps
    // every loop identical and lets a jump to any step land on the same picture.
    function simulate(sc, t) {
        const pos = {};
        const bossActor = sc.bossActor;
        let boss = bossActor.at;
        const trailEff = (sc.effects || []).find(e => e.kind === 'trail');
        const trail = trailEff ? [] : null;

        sc.raid.forEach(p => { pos[p.id] = homeAt(sc, p, 0); });
        if (trail) trail.push({ x: boss.x, y: boss.y, t: trailEff.start });

        for (let s = 0; ; s += STEP) {
            const now = Math.min(s, t);

            // him: a laid-out path, or walking down whoever he has fixated
            const gaze = (sc.effects || []).find(e => e.kind === 'gaze' && now >= e.start && now <= e.end);
            if (bossActor.path) boss = actorAt(bossActor, now);
            else if (gaze) {
                const target = pos[castId(sc, gaze.target)];
                if (target) boss = stepToward(boss, target, (sc.chaseSpeed || 0.004) * STEP);
            }

            // what is dangerous at this instant
            const hz = [];
            (sc.effects || []).forEach(e => {
                if (e.kind === 'volcano' && now - e.start > 150) {
                    hz.push({ x: e.at.x, y: e.at.y, yards: e.avoid || (e.radiusYards + 2) });
                } else if (e.kind === 'gaze' && e === gaze) {
                    hz.push({ x: boss.x, y: boss.y, yards: e.avoid || 10 });
                }
            });
            if (trail && trail.length && now >= trailEff.start) {
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
            sc.raid.forEach(p => {
                const home = homeAt(sc, p, now);
                let want = home;
                if (hz.length) {
                    const mine = apart(home, boss) > 7 ? hz.concat([solid]) : hz;
                    want = L.safePos(FIGHT, home, mine);
                }
                pos[p.id] = stepToward(pos[p.id], want, WALK * STEP);
            });

            // the fire, hunting whoever it picked
            if (trail && now >= trailEff.start && now <= trailEff.start + (trailEff.chaseMs || 4000)) {
                const head = trail[trail.length - 1];
                const target = pos[castId(sc, trailEff.follow)];
                if (target) trail.push(Object.assign(stepToward(head, target, FIRE * STEP), { t: now }));
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
            if (apart(homeAt(sc, p, t), sc._sim.pos[p.id]) > 1.5) set[p.id] = 1;
        });
        return set;
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
        if (!pts || pts.length < 2 || t < e.start) return;
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
        ctx.shadowColor = 'rgba(255,120,36,.9)';
        ctx.shadowBlur = 22;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = yd(2.9);
        ctx.strokeStyle = 'rgba(190,54,10,.22)';
        ctx.beginPath();
        const a0 = px(pts[0]);
        ctx.moveTo(a0.x, a0.y);
        for (let i = 1; i <= last; i++) { const q = px(pts[i]); ctx.lineTo(q.x, q.y); }
        ctx.stroke();
        ctx.restore();

        trace(0, last, yd(1.75), 'rgba(196,58,12,.92)');
        trace(hot, last, yd(1.25), 'rgba(255,142,38,.95)');
        trace(core, last, yd(0.55), 'rgba(255,232,176,.95)');

        withGlow(() => {
            for (let i = 0; i < 26; i++) {
                const p = px(pts[Math.floor(rnd(i * 3.7) * pts.length)]);
                const cyc = (t / 1000 + rnd(i)) % 1;
                ctx.globalAlpha = (1 - cyc) * 0.65;
                ctx.fillStyle = i % 3 ? '#ffbe63' : '#fff0c8';
                ctx.beginPath();
                ctx.arc(p.x + Math.sin((t / 260) + i) * yd(0.9), p.y - cyc * yd(5),
                    Math.max(0.7, yd(0.22) * (1 - cyc * 0.5)), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            const h = px(pts[last]);
            const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, yd(3.2));
            g.addColorStop(0, 'rgba(255,246,214,.9)');
            g.addColorStop(.32, 'rgba(255,150,44,.5)');
            g.addColorStop(1, 'rgba(255,80,10,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(h.x, h.y, yd(3.2), 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Volcanic Geyser: ground cracks, erupts, then keeps firing inside its radius.
    function drawVolcano(e, sc, t) {
        const age = t - e.start;
        if (age < 0) return;
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
        if (t < e.start || t > e.end) return;
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
        label(b.x, b.y - r - 11, 'Fixated', '#ff8f74');
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
        ctx.strokeText('7,384', c.x, ny);
        ctx.fillText('7,384', c.x, ny);
        ctx.restore();
    }

    // The threat table: wiped at the swap into Phase 2, rebuilt on the way back.
    function drawThreat(e, sc, t) {
        const c = px(at(sc, e.from));
        const span = e.end - e.start;
        const wipe = e.mode !== 'rebuild';
        const bw = 172, bh = 11, gap = 8;
        const bx = 62, by = 22;
        const mark = span * (wipe ? 0.45 : 0.5);
        const after = t - e.start - mark;

        const rows = [{ name: 'MT', tone: '#4d7fbe' }, { name: 'OT', tone: '#3f6ea6' }];
        ctx.save();
        // a plate so the readout survives whatever wall it happens to sit on
        ctx.fillStyle = 'rgba(9,13,11,.72)';
        ctx.strokeStyle = 'rgba(236,230,216,.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx - 44, by - 24, bw + 58, 2 * (bh + gap) + 34, 3);
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
            ctx.fillText(wipe ? 'threat wiped' : 'misdirect, then build', bx, by + 2 * (bh + gap) + 8);
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

    // On a close-up the room all looks alike, so say which corner you are looking at.
    function drawLocator(sc) {
        if (sc.view.spanYards > 60) return;
        const w = 104, h = w * (MH / MW), m = 14;
        const x = W - w - m, y = H - h - m, A = FIGHT.arena;
        ctx.save();
        ctx.fillStyle = 'rgba(9,13,11,.78)';
        ctx.strokeStyle = 'rgba(236,230,216,.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,148,128,.22)';
        ctx.fillRect(x + A.x0 * w, y + A.y0 * h, (A.x1 - A.x0) * w, (A.y1 - A.y0) * h);
        ctx.strokeStyle = '#ff8a3d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + (src.x / MW) * w, y + (src.y / MH) * h, (src.w / MW) * w, (src.h / MH) * h);
        ctx.restore();
    }

    const EFFECTS = {
        ring: drawRing, sweep: drawSweep, trail: drawTrail,
        volcano: drawVolcano, gaze: drawGaze, impact: drawImpact, threat: drawThreat
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
        ctx.restore();
    }

    function drawPlayer(p, sc, t) {
        const c = px(sc._sim.pos[p.id]);
        const r = clamp(yd(1.7), 9, 21);
        const img = image(ROLE_ICON[p.kind] || ROLE_ICON.ranged);
        const lit = !sc._dim || sc._focus[p.id];

        ctx.save();
        if (!lit) ctx.globalAlpha = 0.3;
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

        if (!lit) return;

        const hp = valueAt(sc.hp && sc.hp[p.id], t);
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
        if (p.label) {
            // stacked tanks and a tight melee arc would otherwise print their names on top of
            // each other: lift every other one above its token instead of below.
            const above = p.kind === 'tank' ? p.slotIndex % 2 === 1 : p.slotIndex % 2 === 0;
            label(c.x, c.y + (above ? -(r + 6) : r + 12), p.label,
                p.kind === 'tank' ? '#bcd6f2' : '#e2ded2', 12);
        }
        // the word for what this person is doing about it, which is the thing to read first
        if (sc._roles[p.id]) label(c.x, c.y - r - 9, sc._roles[p.id], '#ffb066', 14);
    }

    // ---- steps ----------------------------------------------------------------

    // Health for the Hateful Strike step: the tanks trade the hit while the melee behind him
    // sit low enough that he never looks at them. Keyed by raid slot.
    const HATEFUL_HP = {
        p0: [{ t: 0, v: 0.95 }, { t: 1800, v: 0.62 }, { t: 3200, v: 0.86 }, { t: 4600, v: 0.90 }, { t: 7000, v: 0.95 }],
        p1: [{ t: 0, v: 0.78 }, { t: 1800, v: 0.84 }, { t: 3200, v: 0.94 }, { t: 4600, v: 0.61 }, { t: 7000, v: 0.80 }],
        p2: [{ t: 0, v: 0.58 }], p3: [{ t: 0, v: 0.63 }], p4: [{ t: 0, v: 0.55 }],
        p5: [{ t: 0, v: 0.60 }], p6: [{ t: 0, v: 0.52 }], p7: [{ t: 0, v: 0.66 }], p8: [{ t: 0, v: 0.57 }]
    };

    const tankSlots = assigned.filter(p => p.kind === 'tank').map(p => p.id);
    const scenes = FIGHT.scenes.map(s => {
        const sc = Object.assign({}, s);
        sc.bossActor = (s.actors || []).find(a => a.kind === 'boss')
            || { id: 'boss', kind: 'boss', at: FIGHT.bossAt };
        sc.raid = (s.formation || s.morph) ? assigned.map(p => ({
            id: p.id, kind: p.kind, slotIndex: p.slotIndex,
            label: p.name || (p.kind === 'tank' ? (tankSlots.indexOf(p.id) ? 'OT' : 'MT') : null)
        })) : [];
        if (s.id === 'p1-hateful') sc.hp = HATEFUL_HP;
        return sc;
    });

    let idx = 0;
    let sceneStart = performance.now();

    function paint(now) {
        if (!W) return;
        const sc = scenes[idx];
        const t = REDUCED ? sc.duration * 0.62 : (now - sceneStart) % sc.duration;

        sc._sim = simulate(sc, t);
        sc._dim = (sc.effects || []).some(e => HAZARDS[e.kind]) || !!sc.focus;
        sc._focus = sc._dim ? focusOf(sc, t) : {};
        sc._roles = {};
        Object.keys(sc.roles || {}).forEach(k => { sc._roles[castId(sc, k)] = sc.roles[k]; });
        aim(sc.view);
        ctx.clearRect(0, 0, W, H);
        drawMap();

        (sc.effects || []).filter(e => e.kind !== 'gaze').forEach(e => EFFECTS[e.kind] && EFFECTS[e.kind](e, sc, t));
        drawBoss(sc.bossActor, sc);
        sc.raid.forEach(p => drawPlayer(p, sc, t));
        // the gaze goes last: it is the thing you must notice
        (sc.effects || []).filter(e => e.kind === 'gaze').forEach(e => drawGaze(e, sc, t));
        drawLocator(sc);
    }

    // ---- chrome ---------------------------------------------------------------

    const el = id => document.getElementById(id);
    el('portrait').src = FIGHT.portrait;
    el('bossName').textContent = FIGHT.name;
    el('bossWhere').textContent = FIGHT.where;
    image(FIGHT.map);
    document.title = FIGHT.name + ' — fight briefing';

    const rail = el('rail');
    const cardOf = {};
    const major = FIGHT.abilities.filter(a => a.tier < 3);
    const minor = FIGHT.abilities.filter(a => a.tier === 3);

    major.forEach(a => {
        const c = document.createElement('article');
        c.className = 'card card--t' + a.tier;
        const meta = [a.tooltip.range, a.tooltip.duration ? a.tooltip.duration + ' duration' : null]
            .filter(Boolean).join(' · ');
        const tone = /tank/i.test(a.who) ? ' who--tank' : /every|raid/i.test(a.who) ? ' who--raid' : '';
        c.innerHTML =
            '<img class="card__icon" src="' + a.icon + '" alt="">' +
            '<div>' +
            '<div class="card__head"><h3 class="card__name">' + a.name + '</h3>' +
            '<span class="card__cast">' + a.tooltip.castTime + '</span></div>' +
            (meta ? '<p class="card__meta">' + meta + '</p>' : '') +
            '<p class="card__desc">' + a.tooltip.description + '</p>' +
            '<p class="card__do">' + a.doThis + '</p>' +
            '<span class="who' + tone + '">' + a.who + '</span>' +
            '</div>';
        rail.appendChild(c);
        cardOf[a.id] = c;
    });

    if (minor.length) {
        const strip = document.createElement('div');
        strip.className = 'minor';
        strip.innerHTML = minor.map(a =>
            '<img src="' + a.icon + '" alt="" title="' + a.name + ' — ' + a.tooltip.description + '">'
        ).join('') + '<span>' + minor.map(a => a.name).join(', ') + ' — the tell before the fire</span>';
        rail.appendChild(strip);
        minor.forEach(a => { cardOf[a.id] = strip; });
    }

    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.innerHTML = '<h3 class="sheet__title">From the raid\'s sheet</h3><ol class="sheet__steps">' +
        FIGHT.tips.map(t => '<li>' + t + '</li>').join('') + '</ol>';
    rail.appendChild(sheet);

    const credit = document.createElement('p');
    credit.className = 'credit';
    credit.textContent = FIGHT.source;
    rail.appendChild(credit);

    // Keep the live ability on screen without ever scrolling the page itself.
    function revealCard(node) {
        if (!node || rail.scrollHeight <= rail.clientHeight) return;
        const top = node.offsetTop, bottom = top + node.offsetHeight;
        const behavior = REDUCED ? 'auto' : 'smooth';
        if (top < rail.scrollTop + 8) rail.scrollTo({ top: Math.max(0, top - 12), behavior: behavior });
        else if (bottom > rail.scrollTop + rail.clientHeight - 8) {
            rail.scrollTo({ top: bottom - rail.clientHeight + 12, behavior: behavior });
        }
    }

    const dots = el('dots');
    scenes.forEach((s, i) => {
        const b = document.createElement('button');
        b.className = 'dot';
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label', s.title);
        b.addEventListener('click', () => show(i));
        dots.appendChild(b);
    });

    function show(i) {
        idx = ((i % scenes.length) + scenes.length) % scenes.length;
        const sc = scenes[idx];
        sceneStart = performance.now();
        el('stepTitle').textContent = sc.title;
        el('stepCaption').textContent = sc.caption;
        [...dots.children].forEach((d, k) => {
            d.classList.toggle('is-on', k === idx);
            d.setAttribute('aria-selected', k === idx ? 'true' : 'false');
        });
        Object.keys(cardOf).forEach(id => cardOf[id].classList.remove('is-live'));
        (sc.highlight || []).forEach(id => cardOf[id] && cardOf[id].classList.add('is-live'));
        if (sc.highlight && sc.highlight.length) revealCard(cardOf[sc.highlight[0]]);
        el('clockP1').classList.toggle('is-on', sc.phase === 1);
        el('clockP2').classList.toggle('is-on', sc.phase === 2);
        if (REDUCED) paint(performance.now());
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
        const phase = scenes[idx].phase === 2 ? 2 : 1;
        const text = L.copyText(FIGHT, phase, assigned);
        try {
            await navigator.clipboard.writeText(text);
            flash(btn, 'Copied');
        } catch (e) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = 'supremus-positions-phase-' + phase + '.txt';
            a.click();
            flash(btn, 'Saved');
        }
    }

    function copyImage() {
        const btn = el('copyImage');
        cv.toBlob(async blob => {
            if (!blob) { flash(btn, 'Export failed'); return; }
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                flash(btn, 'Copied');
            } catch (e) {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'supremus-' + scenes[idx].id + '.png';
                a.click();
                flash(btn, 'Saved');
            }
        }, 'image/png');
    }

    el('copyText').addEventListener('click', copyPositions);
    el('copyImage').addEventListener('click', copyImage);
    el('next').addEventListener('click', () => show(idx + 1));
    el('prev').addEventListener('click', () => show(idx - 1));
    document.addEventListener('keydown', ev => {
        if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
        if (ev.key === 'ArrowRight') show(idx + 1);
        else if (ev.key === 'ArrowLeft') show(idx - 1);
        else if (ev.key === ' ') { ev.preventDefault(); sceneStart = performance.now(); }
        else if (ev.key === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        else if (/^[1-9]$/.test(ev.key)) show(parseInt(ev.key, 10) - 1);
    });

    if (!roster) {
        const note = el('rosterNote');
        note.hidden = false;
        note.textContent = 'No roster loaded. Import one on the Assignments page and these become your own names.';
    }

    // the clock keeps running whatever step you are on: he never stops
    const clockHead = el('clockHead');
    function tickClock(now) {
        clockHead.style.left = ((now / 1000) % (FIGHT.phaseSeconds * 2) / (FIGHT.phaseSeconds * 2) * 100) + '%';
    }

    function frame(now) {
        paint(now);
        if (!REDUCED) tickClock(now);
        requestAnimationFrame(frame);
    }

    function start() {
        resize();
        show(0);
        if (REDUCED) paint(performance.now());
        else requestAnimationFrame(frame);
    }

    window.addEventListener('resize', () => { if (resize() && REDUCED) paint(performance.now()); });
    const mapImg = image(FIGHT.map);
    if (mapImg.complete && mapImg.naturalWidth) start();
    else mapImg.addEventListener('load', start);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { resize(); });

    // lets the screenshot harness step scenes without synthesising key events
    window.__tactics = { show, count: scenes.length, scenes, assigned, roster };
}());
