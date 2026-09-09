'use strict';
const assert = require('node:assert/strict');
const Raids = require('./tactics-raids.js');
const { FIGHTS } = require('./tactics-data.js');
const Briefing = require('./tactics-briefing.js');
const Steps = require('./tactics-steps.js');
const registered = Object.values(Raids.raids).flatMap(raid => raid.fights);
assert.equal(new Set(registered).size, registered.length, 'every briefing belongs to exactly one raid');
assert.deepEqual([...registered].sort(), Object.keys(FIGHTS).sort(), 'every available briefing is reachable from its raid');
assert.equal(Raids.route('', FIGHTS).fight, null, 'Tactics opens the raid selection');
assert.equal(Raids.route('?raid=hyjal', FIGHTS).raid.id, 'hyjal');
assert.equal(Raids.route('?raid=bt&fight=hyjal-archimonde&chapter=airburst', FIGHTS).raid.id, 'hyjal', 'direct fight determines the correct raid');
assert.equal(Raids.route('?fight=bt-illidan', FIGHTS).fight.id, 'bt-illidan', 'existing links remain supported');
for (const key of ['constructor', '__proto__', 'toString', '<script>']) {
    assert.equal(Raids.route('?fight=' + key, FIGHTS).fight, null);
    assert.equal(Raids.route('?raid=' + key, FIGHTS).raid, null);
    assert.equal(Raids.route('?fight=' + key, FIGHTS).invalid, true);
}
for (const id of Raids.raids.hyjal.fights) {
    const fight = FIGHTS[id], short = Briefing.forFight(id), detail = Steps.forFight(id);
    assert(short.primaryOrder.length >= 6 && short.primaryOrder.length <= 10, id + ' keeps the main briefing concise');
    assert(!short.primaryOrder.includes('waves'), id + ' keeps wave preparation out of the main walkthrough');
    assert.deepEqual(short.order, detail.order, id + ' retains detailed source scenes');
    for (const scene of fight.scenes) {
        const condensed = short.forScene(scene.id), authored = detail.forScene(scene.id);
        assert(condensed.length, id + ':' + scene.id + ' is addressable');
        assert.equal(condensed[0].startMs, 0);
        assert.equal(condensed.at(-1).holdAtMs, authored.length === 1 && authored[0].holdAtMs === 0 ? 0 : scene.duration);
        for (const step of authored) assert.equal(short.sourceStep(scene.id, step.startMs).id, step.id, id + ':' + scene.id + ' retains live narration after merging');
    }
    assert(fight.recapRows.length >= 4, id + ' recap covers the major mechanics');
    assert(fight.recapRows.every(row => Array.isArray(row) && row.length === 2 && row.every(value => typeof value === 'string' && value.length)), id + ' recap obeys the shared canvas contract');
}
console.log('Raid selection and direct-link checks passed');
