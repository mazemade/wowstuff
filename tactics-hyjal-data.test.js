'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Hyjal = require('./tactics-hyjal-data.js');
const Steps = require('./tactics-hyjal-steps.js');
const required = {
    'hyjal-winterchill': ['overview', 'positioning', 'icebolt', 'dnd', 'nova', 'finish', 'waves'],
    'hyjal-anetheron': ['overview', 'positioning', 'swarm', 'infernal', 'sleep', 'finish', 'waves'],
    'hyjal-kazrogal': ['overview', 'positioning', 'cleave', 'mark', 'stomp', 'finish', 'waves'],
    'hyjal-azgalor': ['overview', 'positioning', 'doom', 'rain', 'howl', 'finish', 'waves'],
    'hyjal-archimonde': ['overview', 'tears', 'positioning', 'airburst', 'doomfire', 'fear', 'curse', 'soulcharge', 'finish', 'waves']
};
assert.deepEqual(Object.keys(Hyjal.FIGHTS), Object.keys(required));
for (const [id, sceneIds] of Object.entries(required)) {
    const fight = Hyjal.FIGHTS[id];
    assert.deepEqual(fight.scenes.map(scene => scene.id), sceneIds, id + ' scene order');
    assert.equal(fight.mapSize.width / fight.mapSize.height, fight.aspect);
    assert(fs.existsSync(fight.portrait), fight.portrait + ' exists');
    assert(fs.existsSync(fight.map), fight.map + ' exists');
    assert(fight.abilities.length >= 3);
    assert.equal(new Set(fight.abilities.map(item=>item.id)).size, fight.abilities.length, id+' ability IDs are unique');
    for (const item of fight.abilities) {
        assert(fs.existsSync(item.icon), item.icon + ' exists');
        assert.match(item.url, /^https:\/\//, item.name + ' has a supporting source');
    }
    assert(fight.recapRows.every(row => Array.isArray(row) && row.length === 2 && row.every(Boolean)), id + ' recap rows are label/text pairs');
    for (const scene of fight.scenes) {
        assert.equal(scene.duration, id === 'hyjal-azgalor' && scene.id === 'doom' ? 26000 : 10000);
        assert(scene.jobs.length, id + ':' + scene.id + ' has role callouts');
        if (scene.animated) {
            assert(scene.briefing?.length, id + ':' + scene.id + ' has concise default briefing');
            for (const group of scene.briefing) assert(Steps[id][scene.id].some(item => item.id === group.id), id + ':' + scene.id + ' briefing resolves');
        }
    }
    assert.equal(fight.scenes.at(-1).optional, true, id + ' retains optional wave reference');
    for (const image of fight.referenceImages) assert(fs.existsSync(image.path), image.path + ' exists');
}
for (const id of ['hyjal-winterchill', 'hyjal-anetheron', 'hyjal-kazrogal', 'hyjal-azgalor']) assert.equal(Hyjal.FIGHTS[id].trashWaves.length, 8, id + ' retains all eight guild waves');
assert.equal(Hyjal.FIGHTS['hyjal-archimonde'].trashWaves, undefined, 'Archimonde has no phantom camp-wave table');
const winter = Hyjal.FIGHTS['hyjal-winterchill'];
assert.match(JSON.stringify(winter.scenes.find(scene => scene.id === 'nova')), /does not remove/i);
const anetheron = Hyjal.FIGHTS['hyjal-anetheron'];
assert.match(anetheron.scenes.find(scene => scene.id === 'infernal').caption, /not tauntable/i);
const kaz = Hyjal.FIGHTS['hyjal-kazrogal'];
assert.match(kaz.scenes.find(scene => scene.id === 'stomp').caption, /15/);
assert.doesNotMatch(kaz.scenes.find(scene => scene.id === 'mark').caption, /casted after one minute/i);
const azgalor = Hyjal.FIGHTS['hyjal-azgalor'];
assert.match(azgalor.scenes.find(scene => scene.id === 'positioning').caption, /Shadow Priests/i);
const arch = Hyjal.FIGHTS['hyjal-archimonde'];
assert.doesNotMatch(arch.scenes.find(scene => scene.id === 'positioning').mistake, /PTR/i);
assert.doesNotMatch(arch.scenes.find(scene => scene.id === 'airburst').caption, /PTR/i);
console.log('Hyjal encounter data and authored steps checks passed');
