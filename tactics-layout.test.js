'use strict';
const assert = require('node:assert');
const L = require('./tactics-layout.js');
const T = require('./tactics-data.js');

const FIGHT = T.FIGHTS['bt-supremus'];

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const yards = (fight, a, b) => Math.hypot(a.x - b.x, (a.y - b.y) / fight.aspect) / fight.yard;

const ROSTER = {
    tanks: ['Bulwark', 'Ironhide'],
    healers: ['Mendfast', 'Lightwell', 'Renewal', 'Chainheal', 'Rejuv', 'Bandaid'],
    melee: ['Stabby', 'Cleaver', 'Furyx', 'Seal', 'Windfury', 'Mangle', 'Backstab'],
    ranged: ['Frostbolt', 'Volley', 'Shadowb', 'Starfire', 'Arcane', 'Immolate', 'Steady',
        'Pyro', 'Wrath', 'Corrupt']
};

// --- the room is divided once, and the same slots serve both phases -------------

test('slots: one per raider, all inside the arena', () => {
    const s = L.slots(FIGHT);
    assert.strictEqual(s.length, 25);
    s.forEach(p => {
        assert.ok(p.x > FIGHT.arena.x0 && p.x < FIGHT.arena.x1, 'slot x inside arena: ' + p.x);
        assert.ok(p.y > FIGHT.arena.y0 && p.y < FIGHT.arena.y1, 'slot y inside arena: ' + p.y);
    });
});

test('slots: everyone can reach him — the whole point of standing somewhere', () => {
    const s = L.slots(FIGHT);
    const far = s.map(p => yards(FIGHT, p, FIGHT.bossAt)).filter(d => d > 30);
    assert.strictEqual(far.length, 0,
        far.length + ' slots are outside 30 yard spell range, furthest ' + Math.max(0, ...far).toFixed(0));
});

test('slots: spread as far as the room allows without going out of range', () => {
    const s = L.slots(FIGHT);
    let worst = Infinity;
    for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) worst = Math.min(worst, yards(FIGHT, s[i], s[j]));
    }
    // 25 people, all inside 30 yards of a boss parked against a wall, cannot all sit 8 yards
    // apart — the half-annulus is not big enough. 7 is what the fight actually allows.
    assert.ok(worst > 6.8, 'closest pair is ' + worst.toFixed(1) + ' yards apart');
    assert.ok(worst < 12, 'and not so sparse that the room is wasted: ' + worst.toFixed(1));
});

test('slots: ordered by how close they are to him, so tanks take the near ones', () => {
    const s = L.slots(FIGHT);
    const d = s.map(p => yards(FIGHT, p, FIGHT.bossAt));
    for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1] - 1e-9, 'slot ' + i + ' is out of order');
});

// --- who stands where ----------------------------------------------------------

test('assign: every raider gets a slot and a name', () => {
    const a = L.assign(FIGHT, ROSTER);
    assert.strictEqual(a.length, 25);
    assert.deepStrictEqual(a.filter(p => p.kind === 'tank').map(p => p.name), ROSTER.tanks);
    assert.strictEqual(a.filter(p => p.kind === 'melee').length, 7);
    assert.strictEqual(a.filter(p => p.kind === 'healer').length, 6);
    assert.strictEqual(a.filter(p => p.kind === 'ranged').length, 10);
    a.forEach(p => assert.ok(p.name && p.slot, p.kind + ' has a name and a slot'));
});

test('assign: healers are dithered through the back, never all in one corner', () => {
    const back = L.assign(FIGHT, ROSTER)
        .filter(p => p.kind === 'healer' || p.kind === 'ranged')
        .sort((x, y) => x.slotIndex - y.slotIndex)
        .map(p => p.kind === 'healer' ? 'h' : 'r')
        .join('');
    assert.ok(!/hhh/.test(back), 'three healers in a row: ' + back);
    assert.ok(!/rrrrr/.test(back), 'five ranged with no healer: ' + back);
});

test('assign: without a roster everyone still gets a slot, just no names', () => {
    const a = L.assign(FIGHT, null);
    assert.strictEqual(a.length, 25);
    assert.ok(a.every(p => !p.name), 'no invented names');
});

// --- the two phases share one spread; only tanks and melee move ----------------

test('formation: in phase 1 tanks and melee are on him, everyone else is on their slot', () => {
    const a = L.assign(FIGHT, ROSTER);
    const p1 = L.formation(FIGHT, 1, a);
    p1.filter(p => p.kind === 'tank').forEach(t => {
        assert.ok(yards(FIGHT, t.at, FIGHT.bossAt) < 8, 'a tank is in melee range');
    });
    p1.filter(p => p.kind === 'melee').forEach(m => {
        const d = yards(FIGHT, m.at, FIGHT.bossAt);
        assert.ok(d > 6 && d < 16, 'melee are behind him, not on top of him: ' + d.toFixed(1));
    });
    p1.filter(p => p.kind === 'healer' || p.kind === 'ranged').forEach(p => {
        const d = yards(FIGHT, p.at, FIGHT.bossAt);
        assert.ok(d > 14, 'the back is clear of the melee pile: ' + d.toFixed(1));
        assert.ok(d <= 30, 'and still able to cast at him: ' + d.toFixed(1));
    });
});

test('formation: phase 2 puts melee and tanks out on their own slots, still in range', () => {
    const a = L.assign(FIGHT, ROSTER);
    const p2 = L.formation(FIGHT, 2, a);
    p2.forEach(p => {
        assert.deepStrictEqual(p.at, p.slot, p.kind + ' stands on its slot in phase 2');
        assert.ok(yards(FIGHT, p.at, FIGHT.bossAt) <= 30, p.kind + ' can still reach him');
    });
});

test('formation: the back does not move between phases — only tanks and melee do', () => {
    const a = L.assign(FIGHT, ROSTER);
    const p1 = L.formation(FIGHT, 1, a), p2 = L.formation(FIGHT, 2, a);
    const by = f => Object.fromEntries(f.map(p => [p.id, p.at]));
    const one = by(p1), two = by(p2);
    const moved = Object.keys(one).filter(id => one[id].x !== two[id].x || one[id].y !== two[id].y);
    const movers = p1.filter(p => moved.includes(p.id));
    assert.strictEqual(movers.length, 9, 'two tanks and seven melee move, nobody else');
    assert.ok(movers.every(p => p.kind === 'tank' || p.kind === 'melee'));
});

// --- getting out of the fire ---------------------------------------------------

test('safePos: someone standing in a geyser is pushed clear of it', () => {
    const home = { x: 0.50, y: 0.60 };
    const hz = [{ x: 0.50, y: 0.60, yards: 8 }];
    const out = L.safePos(FIGHT, home, hz);
    assert.ok(yards(FIGHT, out, hz[0]) >= 8, 'they end up outside the circle');
});

test('safePos: someone standing clear of it does not move', () => {
    const home = { x: 0.36, y: 0.80 };
    const out = L.safePos(FIGHT, home, [{ x: 0.60, y: 0.40, yards: 8 }]);
    assert.deepStrictEqual(out, home);
});

test('safePos: two overlapping hazards leave you outside both', () => {
    const hz = [{ x: 0.50, y: 0.60, yards: 8 }, { x: 0.53, y: 0.62, yards: 8 }];
    const out = L.safePos(FIGHT, { x: 0.51, y: 0.61 }, hz);
    hz.forEach((h, i) => assert.ok(yards(FIGHT, out, h) >= 7.9, 'clear of hazard ' + i));
});

test('safePos: you are pushed out, never off the mat', () => {
    const out = L.safePos(FIGHT, { x: 0.30, y: 0.92 }, [{ x: 0.30, y: 0.92, yards: 12 }]);
    assert.ok(out.x >= FIGHT.arena.x0 && out.x <= FIGHT.arena.x1, 'stays on the mat in x');
    assert.ok(out.y >= FIGHT.arena.y0 && out.y <= FIGHT.arena.y1, 'stays on the mat in y');
});

// --- what the raid leader pastes into Discord ----------------------------------

test('copyText: names, grouped, with the phase and the fight on it', () => {
    const a = L.assign(FIGHT, ROSTER);
    const txt = L.copyText(FIGHT, 1, a);
    assert.ok(/Supremus/.test(txt));
    assert.ok(/Phase 1/.test(txt));
    ROSTER.tanks.concat(ROSTER.melee, ROSTER.healers, ROSTER.ranged)
        .forEach(n => assert.ok(txt.includes(n), n + ' is in the paste'));
    assert.ok(/back.?left|back.?right|front|centre|center|left|right/i.test(txt), 'spots are described');
});

test('copyText: says so plainly when there is no roster loaded', () => {
    const txt = L.copyText(FIGHT, 2, L.assign(FIGHT, null));
    assert.ok(/import|roster/i.test(txt), 'points at what to do: ' + txt.slice(0, 80));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
