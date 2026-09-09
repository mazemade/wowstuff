'use strict';
const assert = require('node:assert/strict');
const Data = require('./tactics-data.js');
const Layout = require('./tactics-layout.js');
const Najentus = require('./tactics-najentus.js');
const Hyjal = require('./tactics-hyjal.js');
const Presentation = require('./tactics-presentation.js');
const adapters = {
    'bt-najentus': Najentus,
    'bt-akama': require('./tactics-akama.js'),
    'bt-reliquary': require('./tactics-reliquary.js'),
    'bt-bloodboil': require('./tactics-bloodboil.js'),
    'bt-mother': require('./tactics-mother.js'),
    'bt-council': require('./tactics-council.js'),
    'bt-illidan': require('./tactics-illidan.js'),
    'hyjal-winterchill': Hyjal,
    'hyjal-anetheron': Hyjal,
    'hyjal-kazrogal': Hyjal,
    'hyjal-azgalor': Hyjal,
    'hyjal-archimonde': Hyjal,
};

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok -', name); } catch (error) { failed++; console.error('FAIL -', name, '\n   ', error.message); } }
const scene = (fight, id) => fight.scenes.find(item => item.id === id);
const ids = (fight, sc, frame) => Presentation.abilityIds(fight, sc, frame);

test('supports every registered fullscreen fight and rejects unknown fights', () => {
    assert.deepEqual(Object.keys(Data.FIGHTS).filter(id => Presentation.supports(id)).sort(), Object.keys(Data.FIGHTS).sort());
    assert.equal(Presentation.supports('bt-not-a-boss'), false);
});

test('every newly supported fight suppresses setup cards and resolves real active chapters', () => {
    Object.entries(adapters).filter(([id]) => id !== 'bt-najentus' && id !== 'hyjal-winterchill').forEach(([id, adapter]) => {
        const fight = Data.FIGHTS[id], prepare = sc => adapter.prepareScene(fight, sc, Layout.assign(fight, null));
        fight.scenes.filter(sc => ['overview', 'positioning', 'p1-stand', 'door', 'waves'].includes(sc.id)).forEach(sc => {
            const prepared = prepare(sc);
            assert.deepEqual(ids(fight, prepared, adapter.simulate(fight, prepared, 0)), [], id + ':' + sc.id + ' is quiet');
        });
        const action = fight.scenes.find(sc => !['overview', 'positioning', 'p1-stand', 'door', 'waves', 'cycle'].includes(sc.id) && sc.highlight.length);
        const prepared = prepare(action), selected = ids(fight, prepared, adapter.simulate(fight, prepared, 0));
        assert.ok(selected.length > 0 && selected.length <= 2, id + ':' + action.id + ' selects one or two cards');
        selected.forEach(abilityId => assert.ok(fight.abilities.some(ability => ability.id === abilityId), id + ':' + action.id + ' selects a real ability'));
    });
});

test('repeating scenes follow their simulated active mechanic and clear complete frames', () => {
    const at = (fightId, time) => {
        const fight = Data.FIGHTS[fightId], adapter = adapters[fightId], sc = adapter.prepareScene(fight, scene(fight, 'cycle'), Layout.assign(fight, null));
        return ids(fight, sc, adapter.simulate(fight, sc, time));
    };
    assert.deepEqual(at('bt-akama', 0), ['channel']);
    assert.deepEqual(at('bt-akama', 21000), ['adds']);
    assert.deepEqual(at('bt-akama', 41999), []);
    assert.deepEqual(at('bt-reliquary', 0), ['drain', 'fixate']);
    assert.deepEqual(at('bt-reliquary', 50000), ['deaden']);
    assert.deepEqual(at('bt-reliquary', 99999), []);
    assert.deepEqual(at('bt-bloodboil', 0), []);
    assert.deepEqual(at('bt-bloodboil', 12000), ['bloodboil', 'wound']);
    assert.deepEqual(at('bt-bloodboil', 55000), ['rage', 'geyser']);
    assert.deepEqual(at('bt-bloodboil', 85000), ['wound']);
    assert.deepEqual(at('bt-mother', 9000), ['attraction']);
    assert.deepEqual(at('bt-mother', 20000), ['beam', 'shriek']);
    assert.deepEqual(at('bt-mother', 39999), []);
    assert.deepEqual(at('bt-council', 0), ['heal']);
    assert.deepEqual(at('bt-council', 15000), ['consecration']);
    assert.deepEqual(at('bt-council', 27000), ['blessings']);
    assert.deepEqual(at('bt-council', 30000), ['poison']);
    assert.deepEqual(at('bt-illidan', 0), ['shear', 'front']);
    assert.deepEqual(at('bt-illidan', 16000), ['flames', 'tether']);
    assert.deepEqual(at('bt-illidan', 32000), ['shadow', 'demons']);
});

test('Supremus uses its authored action highlights while suppressing the static stand scene', () => {
    const fight = Data.FIGHTS['bt-supremus'];
    assert.deepEqual(ids(fight, scene(fight, 'p1-stand'), { stage: 'ready' }), []);
    assert.deepEqual(ids(fight, scene(fight, 'p1-flame'), { stage: 'flame' }), ['flame', 'punch']);
});

test('a missing Bloodboil rage target does not leave a target-only Geyser card behind', () => {
    const fight = Data.FIGHTS['bt-bloodboil'];
    const sc = adapters['bt-bloodboil'].prepareScene(
        fight,
        scene(fight, 'cycle'),
        Layout.assign(fight, { tanks: ['MT'], healers: [], melee: [], ranged: [] }),
    );
    const frame = adapters['bt-bloodboil'].simulate(fight, sc, 55000);
    assert.equal(frame.rage.targetId, null);
    assert.deepEqual(ids(fight, sc, frame), ['rage']);
});

test('Akama multi-effect chapters follow the live add, interrupt and burn beat', () => {
    const fight = Data.FIGHTS['bt-akama'], adapter = adapters['bt-akama'];
    const at = (sceneId, time) => {
        const sc = adapter.prepareScene(fight, scene(fight, sceneId), Layout.assign(fight, null));
        return ids(fight, sc, adapter.simulate(fight, sc, time));
    };
    assert.deepEqual(at('doorways', 0), ['adds']);
    assert.deepEqual(at('doorways', 4950), ['heal']);
    assert.deepEqual(at('walk', 0), ['adds']);
    assert.deepEqual(at('walk', 15999), ['burn']);
    assert.deepEqual(at('aoe', 0), ['channel']);
    assert.deepEqual(at('aoe', 7700), ['adds']);
    assert.deepEqual(at('aoe', 17325), ['burn']);
    assert.deepEqual(at('aoe', 38499), []);
});

test('Council and Illidan direct chapters select the ability active in their real frame', () => {
    const at = (fightId, sceneId, time) => {
        const fight = Data.FIGHTS[fightId], adapter = adapters[fightId];
        const sc = adapter.prepareScene(fight, scene(fight, sceneId), Layout.assign(fight, null));
        return ids(fight, sc, adapter.simulate(fight, sc, time));
    };
    assert.deepEqual(at('bt-council', 'interrupts', 0), []);
    assert.deepEqual(at('bt-council', 'interrupts', 500), ['heal']);
    assert.deepEqual(at('bt-council', 'interrupts', 5000), ['blessings']);
    assert.deepEqual(at('bt-council', 'interrupts', 10000), ['blessings']);
    assert.deepEqual(at('bt-council', 'hazards', 1500), ['blizzard', 'flamestrike']);
    assert.deepEqual(at('bt-council', 'rotation', 0), []);
    assert.deepEqual(at('bt-council', 'rotation', 2800), ['consecration']);
    assert.deepEqual(at('bt-illidan', 'ground', 0), ['shear']);
    assert.deepEqual(at('bt-illidan', 'ground', 2400), ['crash']);
    assert.deepEqual(at('bt-illidan', 'barrage', 2000), ['fireball']);
    assert.deepEqual(at('bt-illidan', 'barrage', 4500), ['barrage']);
    assert.deepEqual(at('bt-illidan', 'barrage', 9000), []);
    assert.deepEqual(at('bt-illidan', 'landing', 0), ['shear']);
    assert.deepEqual(at('bt-illidan', 'landing', 5400), ['agonizing']);
    assert.deepEqual(at('bt-illidan', 'demon', 0), ['shadow']);
    assert.deepEqual(at('bt-illidan', 'demon', 6300), ['demons']);
    assert.deepEqual(at('bt-illidan', 'return', 0), ['agonizing']);
    assert.deepEqual(at('bt-illidan', 'return', 4500), ['shear']);
    assert.deepEqual(at('bt-illidan', 'maiev', 0), ['trap']);
});

test('Winterchill shows only each demonstrated mechanic and two finish reminders', () => {
    const fight = Data.FIGHTS['hyjal-winterchill'];
    const prepare = id => Hyjal.prepareScene(fight, scene(fight, id), Layout.assign(fight, null));
    const simulated = id => {
        const sc = prepare(id);
        return [sc, Hyjal.simulate(fight, sc, 1000)];
    };
    ['overview', 'positioning', 'waves'].forEach(id => {
        const [sc, frame] = simulated(id);
        assert.deepEqual(ids(fight, sc, frame), [], id + ' has no spell card');
    });
    ['icebolt', 'dnd', 'nova'].forEach(id => {
        const [sc, frame] = simulated(id);
        assert.deepEqual(ids(fight, sc, frame), [id]);
    });
    const [finish, finishFrame] = simulated('finish');
    assert.deepEqual(ids(fight, finish, finishFrame), ['icebolt', 'dnd']);
    assert.deepEqual(ids(fight, finish, { ...finishFrame, stage: 'complete' }), []);
});

test('Najentus direct chapters select their own mechanic', () => {
    const fight = Data.FIGHTS['bt-najentus'];
    const prepare = id => Najentus.prepareScene(fight, scene(fight, id), Layout.assign(fight, null));
    [['needle', 'needle'], ['impale', 'impale'], ['shield', 'shield']].forEach(([id, expected]) => {
        const sc = prepare(id);
        assert.deepEqual(ids(fight, sc, Najentus.simulate(fight, sc, 0)), [expected]);
    });
});

test('Najentus burst follows shield, throw and recovery simulation boundaries', () => {
    const fight = Data.FIGHTS['bt-najentus'];
    const sc = Najentus.prepareScene(fight, scene(fight, 'burst'), Layout.assign(fight, null));
    const at = time => ids(fight, sc, Najentus.simulate(fight, sc, time));
    assert.deepEqual(at(0), ['shield']);
    assert.deepEqual(at(3500), ['hurl']);
    assert.deepEqual(at(5000), ['hurl']);
    assert.deepEqual(at(5001), ['hurl']);
    assert.deepEqual(at(5700), ['burst']);
    assert.deepEqual(at(9999), ['burst']);
    assert.deepEqual(at(10000), []);
});

test('Najentus cycle uses active effects and clears them after recovery', () => {
    const fight = Data.FIGHTS['bt-najentus'];
    const sc = Najentus.prepareScene(fight, scene(fight, 'cycle'), Layout.assign(fight, null));
    const at = time => ids(fight, sc, Najentus.simulate(fight, sc, time));
    assert.deepEqual(at(0), []);
    assert.deepEqual(at(8000), ['needle']);
    assert.deepEqual(at(20000), ['impale']);
    assert.deepEqual(at(23999), ['impale']);
    assert.deepEqual(at(24000), []);
    assert.deepEqual(at(60000), ['shield']);
    assert.deepEqual(at(65000), ['hurl']);
    assert.deepEqual(at(67000), ['hurl']);
    assert.deepEqual(at(67700), ['burst']);
    assert.deepEqual(at(74999), ['burst']);
    assert.deepEqual(at(75000), []);
    assert.deepEqual(at(76000), []);
});

test('a roster without a holder leaves the active Najentus shield visible', () => {
    const fight = Data.FIGHTS['bt-najentus'];
    const sc = Najentus.prepareScene(
        fight,
        scene(fight, 'burst'),
        Layout.assign(fight, { tanks: ['MT'], healers: [], melee: [], ranged: [] }),
    );
    const frame = Najentus.simulate(fight, sc, 5700);
    assert.equal(frame.shield, true);
    assert.equal(frame.burst, null);
    assert.deepEqual(ids(fight, sc, frame), ['shield']);
});

test('helper never returns an id absent from the current fight', () => {
    const fight = { id: 'bt-najentus', abilities: [{ id: 'shield' }] };
    assert.deepEqual(ids(fight, { id: 'burst' }, { shield: true, ready: true, stage: 'ready' }), []);
    assert.deepEqual(ids({ id: 'bt-akama', abilities: [{ id: 'shield' }] }, { id: 'shield' }, { shield: true }), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
