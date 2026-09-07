'use strict';
const assert = require('node:assert');
const T = require('./tactics-data.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const FIGHT = T.FIGHTS['bt-supremus'];
const EFFECT_KINDS = ['trail', 'volcano', 'gaze', 'impact', 'threat', 'ring', 'sweep', 'call'];
const TIERS = [1, 2, 3];

// --- registry ---
test('registry: bt-supremus carries a map, arena and a yard scale', () => {
    assert.ok(FIGHT, 'the Supremus fight is registered');
    assert.strictEqual(FIGHT.map, 'maps/tactics/supremus-map.jpg');
    assert.ok(FIGHT.aspect > 1, 'the map is landscape');
    assert.ok(FIGHT.yard > 0 && FIGHT.yard < 0.05, 'one yard is a small fraction of the map width');
    ['x0', 'x1', 'y0', 'y1'].forEach(k => {
        assert.ok(FIGHT.arena[k] >= 0 && FIGHT.arena[k] <= 1, 'arena.' + k + ' is a map fraction');
    });
    assert.ok(FIGHT.arena.x1 > FIGHT.arena.x0 && FIGHT.arena.y1 > FIGHT.arena.y0);
});

// --- abilities: the rail's content ---
test('abilities: every one carries a spell id, icon, tier, target and a tooltip', () => {
    assert.ok(FIGHT.abilities.length >= 5, 'all five journal abilities are present');
    FIGHT.abilities.forEach(a => {
        assert.ok(a.id && a.name, 'ability has an id and name');
        assert.ok(Number.isInteger(a.spell), a.name + ' carries its spell id');
        assert.ok(/^maps\/tactics\/icon-[\w]+\.png$/.test(a.icon), a.name + ' icon path: ' + a.icon);
        assert.ok(TIERS.includes(a.tier), a.name + ' has a tier of 1, 2 or 3');
        assert.ok(a.who, a.name + ' says who it hits');
        assert.ok([1, 2].includes(a.phase) || a.phase === 0, a.name + ' belongs to a phase');
        assert.ok(a.tooltip && a.tooltip.description, a.name + ' has tooltip text');
        assert.ok(a.tooltip.castTime, a.name + ' has a cast time');
    });
});

test('abilities: ids are unique', () => {
    const ids = FIGHT.abilities.map(a => a.id);
    assert.strictEqual(new Set(ids).size, ids.length);
});

test('abilities: tier 1 carries the instruction that keeps you alive', () => {
    const t1 = FIGHT.abilities.filter(a => a.tier === 1);
    assert.ok(t1.length >= 2 && t1.length <= 3, 'two or three headline hazards, not everything');
    t1.forEach(a => assert.ok(a.doThis && a.doThis.length > 10, a.name + ' tells you what to do'));
});

test('abilities: tooltip numbers are the ones the map draws to', () => {
    const geyser = FIGHT.abilities.find(a => a.id === 'geyser');
    assert.ok(/8 yds/.test(geyser.tooltip.description), 'the geyser tooltip states its radius');
    assert.strictEqual(geyser.radiusYards, 8, 'and the drawn radius matches it');
});

// --- scenes: the walkthrough ---
test('scenes: each has an id, phase, title and one caption', () => {
    assert.ok(FIGHT.scenes.length >= 6, 'the fight is walked through in several steps');
    FIGHT.scenes.forEach(s => {
        assert.ok(s.id && s.title, 'scene has an id and title');
        assert.ok(s.caption && s.caption.length < 200, s.id + ' caption is one or two lines');
        assert.ok([0, 1, 2].includes(s.phase), s.id + ' belongs to a phase');
        assert.ok(s.duration >= 2000, s.id + ' loops over a readable duration');
    });
});

test('scenes: every step frames the whole courtyard', () => {
    FIGHT.scenes.forEach(s => {
        assert.ok(s.view, s.id + ' says where to point the camera');
        if (s.view.fit) {
            assert.strictEqual(s.view.fit, 'arena', s.id + ' fit: ' + s.view.fit);
        } else {
            assert.ok(s.view.cx > 0 && s.view.cx < 1 && s.view.cy > 0 && s.view.cy < 1, s.id + ' centres on the map');
            assert.ok(s.view.spanYards >= 25, s.id + ' span: ' + s.view.spanYards);
        }
    });
    assert.ok(FIGHT.scenes.every(s => s.view.fit === 'arena'),
        'the room is the context: no step crops it away');
});

test('scenes: ids are unique', () => {
    const ids = FIGHT.scenes.map(s => s.id);
    assert.strictEqual(new Set(ids).size, ids.length);
});

test('scenes: every highlighted ability exists', () => {
    const known = new Set(FIGHT.abilities.map(a => a.id));
    FIGHT.scenes.forEach(s => {
        (s.highlight || []).forEach(id => assert.ok(known.has(id), s.id + ' highlights unknown ability ' + id));
    });
});

test('scenes: every actor sits inside the map', () => {
    FIGHT.scenes.forEach(s => {
        (s.actors || []).forEach(a => {
            assert.ok(a.id && a.kind, s.id + ': actor has an id and kind');
            assert.ok(a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1, s.id + '/' + a.id + ' is on the map');
            (a.path || []).forEach(p => {
                assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, s.id + '/' + a.id + ' path stays on the map');
                assert.ok(typeof p.t === 'number', s.id + '/' + a.id + ' waypoint carries a time');
            });
        });
    });
});

test('scenes: every effect is a known kind and points at something that exists', () => {
    FIGHT.scenes.forEach(s => {
        const known = new Set((s.actors || []).map(a => a.id));
        Object.keys(s.cast || {}).forEach(k => known.add(k));
        if (s.formation || s.morph) known.add('boss');
        (s.effects || []).forEach(e => {
            assert.ok(EFFECT_KINDS.includes(e.kind), s.id + ': unknown effect kind ' + e.kind);
            ['follow', 'from', 'target', 'md'].forEach(ref => {
                if (typeof e[ref] !== 'string') return;
                const ok = known.has(e[ref]) || /^p\d+$/.test(e[ref]);
                assert.ok(ok, s.id + ': effect ' + ref + ' names missing actor ' + e[ref]);
            });
        });
    });
});

test('scenes: the mechanics play on the whole raid, not a handful of demo dots', () => {
    const played = FIGHT.scenes.filter(s => s.formation || s.morph);
    assert.ok(played.length >= 6, 'all but the title card put the raid on the floor');
    played.forEach(s => {
        assert.ok(!(s.formation && s.morph), s.id + ' is either a still or a move, not both');
        if (s.formation) assert.ok([1, 2].includes(s.formation), s.id + ' formation: ' + s.formation);
        if (s.morph) {
            assert.ok([1, 2].includes(s.morph.from) && [1, 2].includes(s.morph.to), s.id + ' morphs between phases');
            assert.notStrictEqual(s.morph.from, s.morph.to, s.id + ' morphs somewhere else');
            assert.ok(s.morph.end > s.morph.start, s.id + ' morph runs forwards');
            assert.ok(s.morph.end < s.duration, s.id + ' morph settles before the loop restarts');
        }
    });
    assert.ok(FIGHT.scenes.some(s => s.morph && s.morph.from === 1 && s.morph.to === 2),
        'the raid is shown moving out before Phase 2');
    assert.ok(FIGHT.scenes.some(s => s.morph && s.morph.from === 2 && s.morph.to === 1),
        'and moving back in for Phase 1');
});

test('scenes: every step that runs a mechanic says who it is happening to', () => {
    const HAZARD = { trail: 1, volcano: 1, gaze: 1, impact: 1 };
    // A step that dims the raid has to be able to light somebody back up: either it names
    // them, or it carries a hazard with a keep-out radius, which walks people off their spot
    // and the renderer picks those out on its own.
    FIGHT.scenes.filter(s => (s.effects || []).some(e => HAZARD[e.kind])).forEach(s => {
        const named = Object.keys(s.cast || {}).length || (s.focus || []).length
            || (s.effects || []).some(e => e.kind === 'impact' || e.avoid > 0);
        assert.ok(named, s.id + ' dims the raid but nothing can pick anyone out of it');
    });
    FIGHT.scenes.forEach(s => {
        Object.keys(s.roles || {}).forEach(k => {
            assert.ok((s.cast || {})[k], s.id + ' labels ' + k + ', which is not in its cast');
            assert.ok(s.roles[k].length < 12, s.id + '/' + k + ' label is a word, not a sentence');
        });
    });
});

test('scenes: a step that spans a swap counts down to it and calls it', () => {
    const swaps = FIGHT.scenes.filter(s => s.morph);
    assert.ok(swaps.length >= 2, 'both transitions are shown');
    swaps.forEach(s => {
        const cd = s.countdown;
        assert.ok(cd, s.id + ' spans a swap but never says when it lands');
        assert.strictEqual(cd.phase, s.morph.to, s.id + ' counts down to the phase it moves into');
        assert.ok(cd.at >= s.morph.end, s.id + ' the raid is in place before the swap lands');
        assert.ok(cd.at < s.duration, s.id + ' the swap lands inside the step');
        const calls = (s.effects || []).filter(e => e.kind === 'call');
        assert.ok(calls.some(c => c.start >= cd.at), s.id + ' says nothing once the phase flips');
        assert.ok(calls.some(c => c.start < cd.at), s.id + ' says nothing on the way in');
    });
});

test('scenes: every call is a short line with a time on the map', () => {
    FIGHT.scenes.forEach(s => {
        (s.effects || []).filter(e => e.kind === 'call').forEach(c => {
            assert.ok(c.text && c.text.length <= 46, s.id + ' call is a shout, not a paragraph: ' + c.text);
            assert.ok(c.end > c.start, s.id + ' call runs forwards');
            assert.ok(c.end <= s.duration, s.id + ' call ends inside the step');
        });
    });
});

test('scenes: cast members name real raid slots', () => {
    const total = FIGHT.roster.tanks + FIGHT.roster.healers + FIGHT.roster.melee + FIGHT.roster.ranged;
    FIGHT.scenes.forEach(s => {
        Object.keys(s.cast || {}).forEach(k => {
            const id = s.cast[k];
            assert.ok(/^p\d+$/.test(id), s.id + '/' + k + ' is a raid slot: ' + id);
            assert.ok(parseInt(id.slice(1), 10) < total, s.id + '/' + k + ' is inside the raid: ' + id);
        });
    });
});

test('the room is laid out for exactly one raid, all of it inside spell range', () => {
    const r = FIGHT.roster;
    const raid = r.tanks + r.healers + r.melee + r.ranged;
    assert.strictEqual(raid, 25);
    assert.strictEqual(FIGHT.arcs.reduce((n, a) => n + a.count, 0), raid, 'one standing spot each');
    FIGHT.arcs.forEach((a, i) => {
        assert.ok(a.radius <= 30, 'arc ' + i + ' is inside spell range: ' + a.radius);
        assert.ok(a.to > a.from, 'arc ' + i + ' runs round behind him');
        if (i) assert.ok(a.radius > FIGHT.arcs[i - 1].radius, 'arcs step outwards');
    });
    assert.ok(FIGHT.arcs[0].radius > FIGHT.stack.arcRadius, 'the back stands clear of the melee arc');
    assert.ok(FIGHT.stack.arcRadius > FIGHT.stack.tankBack, 'melee stand behind the tank stack');
});

test('tips: the raid sheet lines are carried verbatim with their source', () => {
    assert.ok(FIGHT.tips.length >= 7, 'all seven of the sheet steps');
    FIGHT.tips.forEach(t => assert.ok(typeof t === 'string' && t.length > 8));
    assert.ok(/cheat sheet/i.test(FIGHT.source), 'the fight credits where the tips came from');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
