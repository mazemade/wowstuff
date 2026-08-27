'use strict';
const assert = require('node:assert');
const HP = require('./hyjal-positions.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- registry ---
test('registry: hyjal-b12 exists with map, anchors, two bosses', () => {
    const enc = HP.ENCOUNTERS['hyjal-b12'];
    assert.ok(enc);
    assert.strictEqual(enc.map, 'maps/hyjal-ballista.png');
    assert.deepStrictEqual(enc.bosses.map(b => b.id), ['winterchill', 'anetheron']);
    assert.ok(enc.anchors.boss.x > 0 && enc.anchors.boss.x < 1);
    assert.ok(enc.bosses[1].station, 'anetheron carries the infernal station anchor');
});

// --- geometry ---
test('slotAngles: even spacing from the start angle', () => {
    assert.deepStrictEqual(HP.slotAngles(4, -90), [-90, 0, 90, 180]);
});
test('angleToXY: 0 degrees is straight right, aspect-corrected', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, 0, 2.0);
    assert.ok(Math.abs(p.x - 0.6) < 1e-9);
    assert.ok(Math.abs(p.y - 0.5) < 1e-9);
});
test('angleToXY: -90 degrees is straight up, y shrinks by r*aspect', () => {
    const p = HP.angleToXY({ x: 0.5, y: 0.5 }, 0.1, -90, 2.0);
    assert.ok(Math.abs(p.x - 0.5) < 1e-9);
    assert.ok(Math.abs(p.y - 0.3) < 1e-9);   // 0.5 - 0.1*2.0
});
test('circGap: wraps around', () => {
    assert.strictEqual(HP.circGap(-170, 170), 20);
    assert.strictEqual(HP.circGap(0, 180), 180);
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
