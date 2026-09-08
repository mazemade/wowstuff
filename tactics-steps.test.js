'use strict';
const assert = require('node:assert/strict');
const Steps = require('./tactics-steps.js');
const Data = require('./tactics-data.js');
const Layout = require('./tactics-layout.js');
const Reliquary = require('./tactics-reliquary.js');
const Najentus = require('./tactics-najentus.js');
const Akama = require('./tactics-akama.js');

for (const [fightId, fight] of Object.entries(Data.FIGHTS)) {
    const registry = Steps.forFight(fightId);
    assert.deepEqual(registry.order, fight.scenes.map(scene => scene.id), fightId + ' keeps chapter order');
    fight.scenes.forEach(scene => {
        const chapter = registry.forScene(scene.id);
        assert.ok(chapter.length, fightId + ':' + scene.id + ' has guidance');
        chapter.forEach((item, localIndex) => {
            ['id', 'title', 'detail', 'startMs', 'holdAtMs', 'sampleMs', 'localIndex', 'count', 'index', 'range'].forEach(key => assert.ok(Object.hasOwn(item, key), fightId + ':' + scene.id + ':' + key));
            assert.equal(item.localIndex, localIndex);
            assert.equal(item.count, chapter.length);
            assert.deepEqual(item.range, [item.startMs, item.holdAtMs]);
            assert.equal(registry.frameAt(item, 200000), item.holdAtMs);
            const timeline = registry.timelineFor(scene.id, item.startMs);
            assert.ok(timeline && timeline.step.startMs <= item.startMs && timeline.step.holdAtMs >= item.startMs);
        });
    });
}

for (const fightId of ['bt-supremus', 'bt-najentus', 'bt-akama']) {
    const registry = Steps.forFight(fightId), fight = Data.FIGHTS[fightId];
    fight.scenes.forEach(scene => {
        const chapter = registry.forScene(scene.id);
        if (chapter.length === 1 && chapter[0].startMs === 0 && chapter[0].holdAtMs === 0) return;
        assert.equal(chapter[0].startMs, 0, fightId + ':' + scene.id + ' starts at source zero');
        assert.equal(chapter.at(-1).holdAtMs, scene.duration, fightId + ':' + scene.id + ' reaches source end');
        chapter.slice(1).forEach((item, index) => assert.equal(chapter[index].holdAtMs + 1, item.startMs, fightId + ':' + scene.id + ' has contiguous source coverage'));
    });
}

const reliquaryFight = Data.FIGHTS['bt-reliquary'];
const reliquaryCycle = Reliquary.prepareScene(reliquaryFight, reliquaryFight.scenes.find(scene => scene.id === 'cycle'), Layout.assign(reliquaryFight));
const reliquarySteps = Steps.forFight('bt-reliquary');
const shield = reliquarySteps.get('cycle', 'rune-shield');
const removeShield = reliquarySteps.get('cycle', 'remove-shield');
const nextShock = reliquarySteps.get('cycle', 'next-shock');
const nextKick = reliquarySteps.get('cycle', 'next-kick');
const incomingTank = reliquarySteps.get('cycle', 'incoming-tank');
const firstHandoff = reliquarySteps.get('cycle', 'first-handoff');
const enragePrep = reliquarySteps.get('cycle', 'enrage-prep');
const enrageSurvival = reliquarySteps.get('cycle', 'enrage-survival');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, incomingTank.startMs).handoffDue, true, 'cycle shows incoming-tank movement before the handoff');
assert.notEqual(Reliquary.simulate(reliquaryFight, reliquaryCycle, firstHandoff.startMs).bossTarget, Reliquary.simulate(reliquaryFight, reliquaryCycle, incomingTank.startMs).bossTarget, 'cycle handoff changes the Fixate target at 15 seconds');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, enragePrep.startMs).tankDefense.active, false, 'cycle prepares Enrage before it is active');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, enrageSurvival.startMs).tankDefense.active, true, 'cycle enters Enrage survival at 17 seconds');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, shield.startMs).shield.active, true, 'cycle labels Rune Shield while it blocks the kick');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, removeShield.startMs).shield.active, false, 'cycle labels shield removal after the remover acts');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, nextShock.startMs).cast.active, true, 'cycle labels the second Spirit Shock while it is casting');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, nextKick.startMs).cast.interrupted, true, 'cycle labels the second kick after the shield is gone');
assert.equal(Reliquary.simulate(reliquaryFight, reliquaryCycle, 99000).stage, 'complete', 'a covered Reliquary cycle reaches its final state');
const noReliquaryDamage = Reliquary.prepareScene(reliquaryFight, reliquaryFight.scenes.find(scene => scene.id === 'cycle'), Layout.assign(reliquaryFight, { tanks: ['Tank'] }));
assert.notEqual(Reliquary.simulate(reliquaryFight, noReliquaryDamage, 99000).stage, 'complete', 'Reliquary does not fabricate a kill without damage');

const najFight = Data.FIGHTS['bt-najentus'];
const noNajHolder = Najentus.prepareScene(najFight, najFight.scenes.find(scene => scene.id === 'burst'), Layout.assign(najFight, { tanks: ['Tank'] }));
assert.match(Najentus.simulate(najFight, noNajHolder, 5700).call, /No spine holder/, 'Najentus keeps the missing holder visible');

const akamaFight = Data.FIGHTS['bt-akama'];
const noAkamaDamage = Akama.prepareScene(akamaFight, akamaFight.scenes.find(scene => scene.id === 'cycle'), Layout.assign(akamaFight, { tanks: ['Tank'], healers: ['Healer'] }));
assert.notEqual(Akama.simulate(akamaFight, noAkamaDamage, 40000).stage, 'complete', 'Akama does not fabricate a kill without damage');
['bt-supremus', 'bt-najentus', 'bt-akama', 'bt-reliquary'].forEach(fightId => {
    const plan = Steps.forFight(fightId).forScene('overview')[0];
    assert.equal(plan.holdAtMs - plan.startMs, 0, fightId + ' overview is a static recap');
});

console.log('Shared guided-step registry checks passed');
