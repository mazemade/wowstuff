'use strict';
const assert = require('node:assert/strict');
const Briefing = require('./tactics-briefing.js');
const Steps = require('./tactics-steps.js');
const Data = require('./tactics-data.js');

const expectedPrimaryCounts = { 'bt-najentus': 6, 'bt-supremus': 13, 'bt-akama': 11, 'bt-bloodboil': 16, 'bt-reliquary': 20, 'bt-mother': 7 };
for (const [fightId, expectedCount] of Object.entries(expectedPrimaryCounts)) {
    const briefing = Briefing.forFight(fightId);
    assert.deepEqual(briefing.order, Steps.forFight(fightId).order, fightId + ' keeps every scene addressable');
    assert.equal(briefing.primaryOrder.reduce((count, sceneId) => count + briefing.forScene(sceneId).length, 0), expectedCount, fightId + ' has a concise default briefing');
    assert.deepEqual(briefing.optionalScenes, fightId === 'bt-akama' ? ['cycle', 'aoe'] : fightId === 'bt-mother' ? ['cycle', 'door'] : ['cycle'].filter(sceneId => briefing.order.includes(sceneId)), fightId + ' exposes available optional scenes only');
    assert.ok(briefing.primaryOrder.every(sceneId => !briefing.optionalScenes.includes(sceneId)), fightId + ' hides optional scenes from the default route');
    for (const sceneId of briefing.order) {
        const source = Steps.forFight(fightId).forScene(sceneId);
        const merged = briefing.forScene(sceneId);
        assert.ok(merged.length, fightId + ':' + sceneId + ' has a briefing step');
        const staticPlan = source.length === 1 && source[0].startMs === 0 && source[0].holdAtMs === 0;
        assert.equal(merged[0].startMs, Math.min(...source.map(item => item.startMs)), fightId + ':' + sceneId + ' begins at the source start');
        assert.equal(merged.at(-1).holdAtMs, staticPlan ? 0 : Math.max(Math.max(...source.map(item => item.holdAtMs)), Data.FIGHTS[fightId].scenes.find(scene => scene.id === sceneId).duration), fightId + ':' + sceneId + ' covers the declared scene duration');
        merged.forEach((item, index) => {
            assert.ok(source.some(raw => raw.id === item.id), fightId + ':' + sceneId + ' keeps a source id');
            assert.deepEqual(item.range, [item.startMs, item.holdAtMs]);
            assert.ok(item.holdAtMs >= item.startMs, fightId + ':' + sceneId + ' has valid bounds');
            assert.equal(item.loop, 'hold', fightId + ':' + sceneId + ' does not inherit an effect loop');
            assert.equal(item.countdownSeconds, sceneId === 'spite' && item.id === 'spite-countdown' ? 6 : 0, fightId + ':' + sceneId + ' keeps only the Spite countdown');
            if (index) assert.equal(merged[index - 1].holdAtMs + 1, item.startMs, fightId + ':' + sceneId + ' has contiguous coverage');
            assert.equal(briefing.all()[briefing.indexFor(sceneId, item.startMs)], item);
        });
    }
    assert.equal(briefing.chapterBoundary(briefing.order[1], -1).sceneId, briefing.order[0]);
    assert.equal(briefing.timelineFor(briefing.order[0], 0).step.sceneId, briefing.order[0]);
    assert.ok(Data.FIGHTS[fightId]);
}

for (const fightId of ['bt-najentus', 'bt-akama', 'bt-bloodboil', 'bt-reliquary', 'bt-mother']) {
    const cycle = Briefing.forFight(fightId).forScene('cycle');
    assert.equal(cycle.length, 1, fightId + ' full cycle is uninterrupted');
}
assert.equal(Briefing.forFight('bt-akama').forScene('aoe').length, 1, 'optional Akama AoE route is uninterrupted');
assert.match(Briefing.forFight('bt-najentus').get('shield', 'shield-up').detail, /8,500/);
assert.equal(Briefing.forFight('bt-najentus').forScene('needle').length, 1, 'Needle stays one decision stop');
assert.equal(Briefing.forFight('bt-najentus').forScene('burst').length, 1, 'burst stays one decision stop');
assert.match(Briefing.forFight('bt-najentus').get('burst', 'shield-window').detail, /25 yards/);
assert.match(Briefing.forFight('bt-reliquary').get('fixate', 'hold-fixates').detail, /health/);
assert.equal(Briefing.forFight('bt-reliquary').forScene('deaden').length, 1, 'optional Deaden backups do not add default stops');
assert.match(Briefing.forFight('bt-reliquary').get('anger', 'anger-taunt').detail, /four more seconds/);
assert.equal(Briefing.forFight('bt-reliquary').sourceStep('spite', 9000).id, 'spite-impact', 'raw timing remains available inside a merged step');
assert.equal(Briefing.forFight('bt-najentus').sourceStep('cycle', 67700).id, 'burst', 'cycle narration can resolve its raw live beat');
assert.equal(Briefing.forFight('bt-bloodboil').sourceStep('rotation', 11000).id, 'switch', 'rotation copy covers the next-group change');
assert.equal(Briefing.forFight('bt-supremus').sourceStep('p2-geyser', 6000).id, 'third-geyser', 'geyser copy covers the final eruption');
assert.equal(Briefing.forFight('bt-akama').sourceStep('fire', 3700).id, 'move-clear', 'Rain of Fire copy covers movement from the hazard');
assert.equal(Briefing.forFight('bt-reliquary').sourceStep('anger', 6000).id, 'anger-burn', 'Anger taunt copy reaches the raid-damage timing');
assert.equal(Briefing.forFight('bt-reliquary').sourceStep('deaden', 5000).id, 'spell-reflection', 'optional Deaden backup remains in raw timing without a stop');
assert.equal(Briefing.forFight('bt-najentus').sourceStep('burst', 5700), Steps.forFight('bt-najentus').get('burst', 'burst-hit'), 'sourceStep returns the detailed registry item');
assert.notEqual(Briefing.forFight('bt-najentus').get('shield', 'shield-up'), Steps.forFight('bt-najentus').get('shield', 'shield-up'), 'briefing steps are derived copies');
assert.equal(Briefing.forFight('toString').order.length, 0, 'prototype-named fights resolve safely as unknown');

console.log('Condensed briefing registry checks passed');
