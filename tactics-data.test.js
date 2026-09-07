'use strict';
const assert = require('node:assert');
const T = require('./tactics-data.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const FIGHT = T.FIGHTS['bt-supremus'];
const EFFECT_KINDS = ['trail', 'volcano', 'gaze', 'impact', 'threat', 'ring', 'sweep'];
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

test('scenes: each frames its own patch of the room', () => {
    FIGHT.scenes.forEach(s => {
        assert.ok(s.view, s.id + ' says where to point the camera');
        assert.ok(s.view.cx > 0 && s.view.cx < 1 && s.view.cy > 0 && s.view.cy < 1, s.id + ' centres on the map');
        assert.ok(s.view.spanYards >= 30 && s.view.spanYards <= 160, s.id + ' span: ' + s.view.spanYards);
    });
    const spans = FIGHT.scenes.map(s => s.view.spanYards);
    assert.ok(Math.min(...spans) < 70, 'mechanics are shown close up');
    assert.ok(Math.max(...spans) > 95, 'formations are shown wide');
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

test('scenes: every effect is a known kind and points at an actor that exists', () => {
    FIGHT.scenes.forEach(s => {
        const actors = new Set((s.actors || []).map(a => a.id));
        (s.effects || []).forEach(e => {
            assert.ok(EFFECT_KINDS.includes(e.kind), s.id + ': unknown effect kind ' + e.kind);
            ['follow', 'from', 'target'].forEach(ref => {
                if (typeof e[ref] === 'string') {
                    assert.ok(actors.has(e[ref]), s.id + ': effect ' + ref + ' names missing actor ' + e[ref]);
                }
            });
        });
    });
});

test('scenes: the roster scenes ask for a generated formation, not hand-placed dots', () => {
    const layouts = FIGHT.scenes.filter(s => s.formation);
    assert.ok(layouts.length >= 2, 'both phases show where the raid stands');
    layouts.forEach(s => assert.ok(['stack', 'spread'].includes(s.formation), s.id + ' formation: ' + s.formation));
});

// --- the cheat sheet's own words ---
test('tips: the raid sheet lines are carried verbatim with their source', () => {
    assert.ok(FIGHT.tips.length >= 3);
    FIGHT.tips.forEach(t => assert.ok(typeof t === 'string' && t.length > 15));
    assert.ok(/cheat sheet/i.test(FIGHT.source), 'the fight credits where the tips came from');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
