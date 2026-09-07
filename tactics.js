/* Fight briefing player.
 *
 * Draws a boss fight on top of a top-down capture of the room: the raid as tokens, the
 * mechanics as animated effects on a canvas over the map. Every danger radius is drawn from
 * the yard figure in the ability's own tooltip, so what you see is the size it really is.
 *
 * Scene data lives in tactics-data.js; this file knows nothing about any particular boss.
 */
(function () {
    'use strict';

    const FIGHT = window.TacticsData.FIGHTS['bt-supremus'];
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // Deterministic noise so a looping scene looks identical on every pass.
    function rnd(seed) {
        const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Position of an actor at time t: follows its waypoints, or stands still.
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

    // Value of a keyframed number (health, mostly) at time t.
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

    // ---- canvas ---------------------------------------------------------------

    const cv = document.getElementById('fx');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0;

    // The map is 1600x889 of source pixels. Everything is authored as a fraction of that;
    // the camera turns a requested patch of the room into the box we actually have.
    const MW = 1600, MH = 889;

    // src is the rectangle of the map, in map pixels, currently filling the canvas.
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
        const want = (view.spanYards * FIGHT.yard) * MW;      // requested width, in map pixels
        const box = W / H;
        let w = want, h = want / box;
        const cx = view.cx * MW, cy = view.cy * MH;
        // never ask for more map than exists, and stay inside its edges
        if (w > MW) { w = MW; h = w / box; }
        if (h > MH) { h = MH; w = h * box; }
        src = {
            w: w, h: h,
            x: clamp(cx - w / 2, 0, MW - w),
            y: clamp(cy - h / 2, 0, MH - h)
        };
        scale = W / src.w;
    }

    // map fraction -> canvas pixels, and yards -> canvas pixels, both through the camera
    const px = p => ({ x: (p.x * MW - src.x) * scale, y: (p.y * MH - src.y) * scale });
    const yd = n => n * FIGHT.yard * MW * scale;
    // a yard measured down the map, expressed as a fraction of the map height
    const ydY = n => n * FIGHT.yard * FIGHT.aspect;

    function drawMap() {
        const img = image(FIGHT.map);
        if (!img.complete || !img.naturalWidth) return;
        ctx.save();
        // the capture is murky and green; lift it so the fire is the only warm thing in the room
        ctx.filter = 'brightness(1.42) contrast(1.04) saturate(.62)';
        ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, W, H);
        ctx.restore();
    }

    // ---- effects --------------------------------------------------------------
    // Each takes (effect, scene, t) and paints in canvas pixels. Times are ms into the scene.

    const EMBER = '#ff6a1f';

    function withGlow(fn) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        fn();
        ctx.restore();
    }

    // A distance circle, drawn at true scale, with an optional name on its edge.
    function drawRing(e, sc, t) {
        const a = sc._actors[e.from];
        if (!a) return;
        const c = px(actorAt(a, t));
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

        if (e.label) chip(c.x, c.y + r + 13, e.label);
    }

    // A small dark plate with a word on it — used to name a ring or a spot.
    function chip(x, y, text) {
        ctx.save();
        ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
        const w = ctx.measureText(text).width + 12;
        const h = 19;
        const bx = x - w / 2, by = y - h / 2;
        ctx.fillStyle = 'rgba(11,15,13,.82)';
        ctx.strokeStyle = 'rgba(236,230,216,.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, 2);
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
        const a = sc._actors[e.from];
        if (!a) return;
        const k = clamp((t - e.start) / (e.end - e.start), 0, 1);
        if (k <= 0 || k >= 1) return;
        const c = px(actorAt(a, t));
        const r = yd(e.radiusYards) * easeOut(k);
        const fade = 1 - k;

        withGlow(() => {
            ctx.beginPath();
            for (let i = 0; i <= 46; i++) {
                const ang = (i / 46) * Math.PI * 2;
                const wob = 1 + 0.07 * Math.sin(ang * 5 + 1.3) + 0.04 * Math.sin(ang * 11);
                const x = c.x + Math.cos(ang) * r * wob;
                const y = c.y + Math.sin(ang) * r * wob;
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

    // Molten Flame: a gout of fire that hunts one player, then burns where it stopped.
    function drawTrail(e, sc, t) {
        if (t < e.start) return;
        const src = sc._actors[e.from], tgt = sc._actors[e.follow];
        if (!src || !tgt) return;

        // Re-simulate the head from the start every frame: cheap, and identical every loop.
        const STEP = 34;                      // ms per simulation step
        const SPEED = yd(0.0055);             // yards per ms, tuned to lag a running player
        const chaseEnd = e.start + (e.chaseMs || 4000);
        const head = px(actorAt(src, e.start));
        const pts = [{ x: head.x, y: head.y, t: e.start }];

        for (let s = e.start + STEP; s <= t; s += STEP) {
            const last = pts[pts.length - 1];
            let nx = last.x, ny = last.y;
            if (s <= chaseEnd) {
                const aim = px(actorAt(tgt, s));
                const dx = aim.x - last.x, dy = aim.y - last.y;
                const d = Math.hypot(dx, dy);
                if (d > 1) {
                    const step = Math.min(SPEED * STEP, d);
                    nx = last.x + dx / d * step;
                    ny = last.y + dy / d * step;
                }
            }
            pts.push({ x: nx, y: ny, t: s });
        }
        if (pts.length < 2) return;

        // Drawn as a few whole-path strokes rather than segment by segment: additive
        // overlap on a slow-moving head turns any per-segment pass into a white blob.
        const trace = (from, to, width, colour, additive) => {
            ctx.save();
            if (additive) ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = width;
            ctx.strokeStyle = colour;
            ctx.beginPath();
            ctx.moveTo(pts[from].x, pts[from].y);
            for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
            ctx.restore();
        };
        const last = pts.length - 1;
        const hot = Math.floor(last * 0.45), core = Math.floor(last * 0.78);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = 'rgba(255,120,36,.9)';
        ctx.shadowBlur = 22;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = yd(2.9);
        ctx.strokeStyle = 'rgba(190,54,10,.22)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= last; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.restore();

        trace(0, last, yd(1.75), 'rgba(196,58,12,.92)', false);   // the whole burn, cooling
        trace(hot, last, yd(1.25), 'rgba(255,142,38,.95)', false); // still hot
        trace(core, last, yd(0.55), 'rgba(255,232,176,.95)', false); // the live edge

        withGlow(() => {
            // embers lifting off the fire
            for (let i = 0; i < 26; i++) {
                const at = pts[Math.floor(rnd(i * 3.7) * pts.length)];
                const cyc = (t / 1000 + rnd(i)) % 1;
                const x = at.x + Math.sin((t / 260) + i) * yd(0.9);
                const y = at.y - cyc * yd(5);
                ctx.globalAlpha = (1 - cyc) * 0.65;
                ctx.fillStyle = i % 3 ? '#ffbe63' : '#fff0c8';
                ctx.beginPath();
                ctx.arc(x, y, Math.max(0.7, yd(0.22) * (1 - cyc * 0.5)), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // the burning head
            const h = pts[last];
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

        // 1. the crack
        const crack = clamp(age / 240, 0, 1);
        ctx.save();
        ctx.globalAlpha = Math.min(1, crack) * clamp(1 - (age - 900) / 1400, 0, 1);
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

        // 2. the danger circle, at the radius the tooltip states
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

        // 3. the eruption
        if (age > 200) {
            const burst = clamp((age - 200) / 520, 0, 1);
            withGlow(() => {
                if (burst < 1) {                       // shock ring, once
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, R * (0.2 + 1.5 * easeOut(burst)), 0, Math.PI * 2);
                    ctx.lineWidth = lerp(4, 0.6, burst);
                    ctx.strokeStyle = 'rgba(255,196,120,' + (1 - burst) + ')';
                    ctx.stroke();
                }
                // the throat, flickering
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

                // lava thrown out and falling back inside the circle
                for (let i = 0; i < 11; i++) {
                    const period = 1150 + rnd(seed + i) * 700;
                    const k = ((age - 260 - i * 90) % period) / period;
                    if (k < 0 || (age - 260 - i * 90) < 0) continue;
                    const ang = rnd(seed + i * 5.3) * Math.PI * 2;
                    const reach = R * (0.35 + 0.55 * rnd(seed + i * 7.7));
                    const x = c.x + Math.cos(ang) * reach * k;
                    const y = c.y + Math.sin(ang) * reach * k - Math.sin(k * Math.PI) * yd(6);
                    ctx.globalAlpha = 1 - k * k;
                    ctx.fillStyle = k < .5 ? '#ffe6a6' : '#ff8a2a';
                    ctx.beginPath();
                    ctx.arc(x, y, yd(0.55) * (1 - k * .4), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            });
        }
    }

    // Fixate: he drops threat and walks somebody down.
    function drawGaze(e, sc, t) {
        if (t < e.start || t > e.end) return;
        const src = sc._actors[e.from], tgt = sc._actors[e.target];
        if (!src || !tgt) return;
        const a = px(actorAt(src, t)), b = px(actorAt(tgt, t));
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const nx = -uy, ny = ux;
        const age = t - e.start;

        withGlow(() => {
            // the lane between them: wide at him, narrow at you
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

            // chevrons running down the lane towards you
            ctx.strokeStyle = 'rgba(255,120,90,.75)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
                const k = ((age / 760) + i / 3) % 1;
                const cx = a.x + ux * d * k, cy = a.y + uy * d * k;
                const s = yd(1.5);
                ctx.globalAlpha = Math.sin(k * Math.PI) * .9;
                ctx.beginPath();
                ctx.moveTo(cx - nx * s - ux * s, cy - ny * s - uy * s);
                ctx.lineTo(cx, cy);
                ctx.lineTo(cx + nx * s - ux * s, cy + ny * s - uy * s);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // the moment he switches to you
            const onset = clamp(age / 300, 0, 1);
            if (onset < 1) {
                ctx.beginPath();
                ctx.arc(b.x, b.y, yd(2) + yd(6) * easeOut(onset), 0, Math.PI * 2);
                ctx.lineWidth = lerp(3.5, 0.5, onset);
                ctx.strokeStyle = 'rgba(255,225,200,' + (1 - onset) + ')';
                ctx.stroke();
            }
        });

        // brackets closing on the target
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
        const a = sc._actors[e.target];
        if (!a) return;
        const age = t - e.start;
        if (age < 0 || age > 1100) return;
        const c = px(actorAt(a, t));

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
                    const r0 = yd(2.6) + yd(4) * easeOut(k);
                    const r1 = r0 + yd(1.8) * (1 - k);
                    ctx.beginPath();
                    ctx.moveTo(c.x + Math.cos(ang) * r0, c.y + Math.sin(ang) * r0);
                    ctx.lineTo(c.x + Math.cos(ang) * r1, c.y + Math.sin(ang) * r1);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(255,210,160,' + (1 - k) + ')';
                    ctx.stroke();
                }
            }
        });

        // the number, rising and fading
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

    // The threat table filling up and then being wiped.
    function drawThreat(e, sc, t) {
        const boss = sc._actors[e.from];
        if (!boss) return;
        const c = px(actorAt(boss, t));
        const span = e.end - e.start;
        const wipeAt = span * 0.45;
        const k = clamp((t - e.start) / wipeAt, 0, 1);
        const after = t - e.start - wipeAt;

        const bw = 172, bh = 11, gap = 8;
        const bx = clamp(c.x + yd(7), 46, W - bw - 12);
        const by = clamp(c.y - yd(6), 14, H - 60);
        const rows = [
            { name: 'MT', v: k, tone: '#4d7fbe' },
            { name: 'OT', v: k * 0.72, tone: '#3f6ea6' }
        ];

        ctx.save();
        ctx.font = '600 12px "Barlow Condensed", sans-serif';
        ctx.textBaseline = 'middle';
        rows.forEach((row, i) => {
            const y = by + i * (bh + gap);
            let v = row.v;
            if (after > 0) v = after < 160 ? row.v * (1 - after / 160) : 0;
            // misdirect puts the main tank straight back on top
            if (after > 900 && i === 0) v = clamp((after - 900) / 700, 0, 1) * 0.9;

            ctx.fillStyle = 'rgba(10,14,12,.72)';
            ctx.strokeStyle = 'rgba(236,230,216,.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, y, bw, bh, 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = row.tone;
            if (v > 0.01) {
                ctx.beginPath();
                ctx.roundRect(bx + 1, y + 1, (bw - 2) * v, bh - 2, 1.5);
                ctx.fill();
            }
            ctx.fillStyle = '#9ba89f';
            ctx.textAlign = 'right';
            ctx.fillText(row.name, bx - 6, y + bh / 2);
        });

        if (after > 0 && after < 2100) {
            ctx.globalAlpha = clamp(1 - after / 2100, 0, 1);
            ctx.font = '700 17px "Barlow Condensed", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffb066';
            ctx.fillText('threat wiped', bx, by + 2 * (bh + gap) + 6);
            ctx.globalAlpha = 1;
        }
        if (after > 900) {
            const md = clamp((after - 900) / 500, 0, 1);
            const h = px(actorAt(sc._actors.hunter, t));
            ctx.setLineDash([5, 5]);
            ctx.lineDashOffset = -after / 30;
            ctx.strokeStyle = 'rgba(180,224,150,' + (0.95 * md) + ')';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(lerp(h.x, c.x, md), lerp(h.y, c.y, md));
            ctx.stroke();
        }
        ctx.restore();
    }

    // On a close-up the room all looks alike, so show where the camera is pointed.
    function drawLocator(sc) {
        if (sc.view.spanYards > 88) return;
        const w = 104, h = w * (MH / MW), m = 14;
        const x = W - w - m, y = H - h - m;
        const A = FIGHT.arena;

        ctx.save();
        ctx.fillStyle = 'rgba(9,13,11,.78)';
        ctx.strokeStyle = 'rgba(236,230,216,.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.fill();
        ctx.stroke();
        // the courtyard floor
        ctx.fillStyle = 'rgba(120,148,128,.22)';
        ctx.fillRect(x + A.x0 * w, y + A.y0 * h, (A.x1 - A.x0) * w, (A.y1 - A.y0) * h);
        // and the patch of it on screen
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

    function label(x, y, text, colour) {
        ctx.save();
        ctx.font = '600 12.5px "Barlow Condensed", sans-serif';
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

    function drawBoss(a, t) {
        const c = px(actorAt(a, t));
        const r = clamp(yd(3.6), 15, 34) * (a.scale || 1);
        const img = image(FIGHT.portrait);

        // he is made of lava; the floor under him glows
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

    function drawPlayer(a, t) {
        const c = px(actorAt(a, t));
        const r = clamp(yd(1.7), 9, 21);
        const img = image(ROLE_ICON[a.kind] || ROLE_ICON.ranged);

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

        const hp = valueAt(a.hp, t);
        if (hp !== null) {
            const bw = r * 2.6, bh = 4, y = c.y - r - 8;
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

        if (a.label) label(c.x + (a.labelDx || 0) * r * 1.15, c.y + r + 13, a.label);
    }

    // ---- formations -----------------------------------------------------------
    // Where the raid actually stands, generated rather than hand-placed, so the shape is
    // the shape the fight asks for: stacked for Phase 1, spread for Phase 2.

    function formation(kind, bossAt) {
        const R = FIGHT.roster;
        const out = [{ id: 'boss', kind: 'boss', at: bossAt }];
        const at = (dxY, dyY) => ({ x: bossAt.x + dxY * FIGHT.yard, y: bossAt.y + ydY(dyY) });
        let n = 0;
        const add = (kind_, p, lbl, dx) => out.push({ id: 'f' + (n++), kind: kind_, at: p, label: lbl, labelDx: dx });

        if (kind === 'stack') {
            out.push({ id: 'ft0', kind: 'tank', at: at(-1.6, -6.6), label: 'MT', labelDx: -1 });
            out.push({ id: 'ft1', kind: 'tank', at: at(1.6, -6.3), label: 'OT', labelDx: 1 });
            for (let i = 0; i < R.melee; i++) {                    // an arc behind him
                const ang = lerp(36, 144, R.melee === 1 ? .5 : i / (R.melee - 1)) * Math.PI / 180;
                add('melee', at(Math.cos(ang) * 16.5, Math.sin(ang) * 16.5));
            }
            const camps = [[-27, 25], [-9.5, 35], [9.5, 35], [27, 25]];
            // one healer to roughly every two ranged, so no camp is left without one
            const back = [];
            let hLeft = R.healers, rLeft = R.ranged;
            while (hLeft || rLeft) {
                if (hLeft && (!rLeft || back.length % 3 === 0)) { back.push('healer'); hLeft--; }
                else { back.push('ranged'); rLeft--; }
            }
            back.forEach((role, i) => {
                const camp = camps[i % camps.length];
                const slot = Math.floor(i / camps.length);
                const ox = (slot % 2 ? 3.4 : -3.4) + (slot > 1 ? 1.1 : 0);
                const oy = (slot < 2 ? -3.2 : 3.2);
                add(role, at(camp[0] + ox, camp[1] + oy));
            });
        } else {                                                   // spread: everyone on a ring
            // Dither the roles around the ring so no arc of it is all healers or all melee.
            const deck = [];
            const push = (role, count) => {
                for (let i = 0; i < count; i++) deck.push({ role: role, key: (i + 0.5) / count });
            };
            push('healer', R.healers);
            push('ranged', R.ranged);
            push('melee', R.melee);
            deck.sort((a, b) => a.key - b.key);

            const total = R.tanks + deck.length;
            for (let i = 0; i < total; i++) {
                const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
                const rad = 30 + (i % 2 ? 1.6 : -1.6);
                const tank = i < R.tanks;
                const p = {
                    x: 0.5025 + Math.cos(ang) * rad * FIGHT.yard,
                    y: 0.505 + ydY(Math.sin(ang) * rad)
                };
                add(tank ? 'tank' : deck[i - R.tanks].role, p, tank ? (i ? 'OT' : 'MT') : null, i ? 1 : -1);
            }
        }
        return out;
    }

    // ---- scenes ---------------------------------------------------------------

    const scenes = FIGHT.scenes.map(s => {
        const sc = Object.assign({}, s);
        sc.actors = s.formation ? formation(s.formation, s.bossAt) : (s.actors || []);
        sc._actors = {};
        sc.actors.forEach(a => { sc._actors[a.id] = a; });
        return sc;
    });

    let idx = 0;
    let sceneStart = performance.now();

    function paint(now) {
        if (!W) return;
        const sc = scenes[idx];
        const t = REDUCED ? sc.duration * 0.62 : (now - sceneStart) % sc.duration;

        aim(sc.view);
        ctx.clearRect(0, 0, W, H);
        drawMap();
        (sc.effects || []).filter(e => e.kind !== 'gaze').forEach(e => EFFECTS[e.kind] && EFFECTS[e.kind](e, sc, t));
        sc.actors.forEach(a => { if (a.kind === 'boss') drawBoss(a, t); });
        sc.actors.forEach(a => { if (a.kind !== 'boss') drawPlayer(a, t); });
        // the gaze is drawn last: it is the thing you must notice
        (sc.effects || []).filter(e => e.kind === 'gaze').forEach(e => drawGaze(e, sc, t));
        drawLocator(sc);
    }

    // ---- chrome ---------------------------------------------------------------

    const el = id => document.getElementById(id);
    el('portrait').src = FIGHT.portrait;
    image(FIGHT.map);
    el('bossName').textContent = FIGHT.name;
    el('bossWhere').textContent = FIGHT.where;
    document.title = FIGHT.name + ' — fight briefing';

    // the rail: one card per ability, sized by how much it matters
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
    sheet.innerHTML = '<h3 class="sheet__title">From the raid\'s sheet</h3>' +
        FIGHT.tips.map(t => '<p>' + t + '</p>').join('');
    rail.appendChild(sheet);

    const credit = document.createElement('p');
    credit.className = 'credit';
    credit.textContent = FIGHT.source;
    rail.appendChild(credit);

    // the step dots
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
        el('clockP1').classList.toggle('is-on', sc.phase === 1);
        el('clockP2').classList.toggle('is-on', sc.phase === 2);
        if (REDUCED) paint(performance.now());
    }

    el('next').addEventListener('click', () => show(idx + 1));
    el('prev').addEventListener('click', () => show(idx - 1));
    document.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowRight') show(idx + 1);
        else if (ev.key === 'ArrowLeft') show(idx - 1);
        else if (ev.key === ' ') { ev.preventDefault(); sceneStart = performance.now(); }
        else if (ev.key === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        else if (/^[1-9]$/.test(ev.key)) show(parseInt(ev.key, 10) - 1);
    });

    // the clock keeps running whatever step you are on: he never stops
    const clockHead = el('clockHead');
    function tickClock(now) {
        const cycle = (now / 1000) % (FIGHT.phaseSeconds * 2) / (FIGHT.phaseSeconds * 2);
        clockHead.style.left = (cycle * 100) + '%';
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
    window.__tactics = { show, count: scenes.length, scenes };
}());
