'use strict';
const assert = require('node:assert/strict');
const D = require('./tactics-data.js');
const L = require('./tactics-layout.js');
const R = require('./tactics-reliquary.js');
const Render = require('./tactics-reliquary-render.js');

const fight = D.FIGHTS['bt-reliquary'];
const prepare = (id, roster, classes = {}) => {
    const assigned = L.assign(fight, roster);
    assigned.forEach(p => { p.class = classes[p.name] || null; });
    return R.prepareScene(fight, fight.scenes.find(s => s.id === id), assigned);
};
let passed = 0;
function test(name, fn) { fn(); console.log('ok -', name); passed++; }

test('registers an eleven-chapter Reliquary after Akama with complete guidance', () => {
    assert.deepEqual(Object.keys(D.FIGHTS), ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary', 'bt-bloodboil', 'bt-mother']);
    assert.equal(fight.scenes.length, 11);
    fight.scenes.forEach(s => {
        ['chapter', 'title', 'caption', 'call', 'why', 'mistake'].forEach(k => assert.ok(s[k], s.id + ' ' + k));
        assert.ok(s.jobs.length >= 3);
        assert.ok(s.duration > 0);
    });
    fight.abilities.forEach(a => assert.ok(a.url && !a.url.includes('undefined'), a.id + ' source URL'));
});

test('Fixate holds one tank through repeated checks, then makes a health-based handoff', () => {
    const sc = prepare('fixate');
    const [start, check5, check10, low, incoming, handoff, settled] = [0, 5000, 10000, 13000, 14999, 15000, 16000].map(time => R.simulate(fight, sc, time));
    assert.equal(start.bossTarget, check5.bossTarget);
    assert.equal(check5.bossTarget, check10.bossTarget);
    assert.equal(check10.nextTankAt, null, 'no movement cue while the tank is healthy enough');
    assert.ok(check10.hp[check10.bossTarget] < check5.hp[check5.bossTarget], 'same tank visibly loses health across checks');
    assert.equal(low.lowHealth, true);
    assert.equal(incoming.handoffDue, true);
    assert.notEqual(handoff.bossTarget, incoming.bossTarget);
    assert.ok(Math.abs(handoff.hp[incoming.bossTarget] - incoming.hp[incoming.bossTarget]) < .001, 'previous tank damage remains through the boundary');
    assert.equal(settled.hp[incoming.bossTarget], handoff.hp[incoming.bossTarget], 'previous tank health holds after handoff');
    assert.ok(handoff.hp[handoff.bossTarget] < 1, 'fresh receiver takes the next check');
});

test('Suffering keeps health lost across rotations and only assigns known valid utility', () => {
    const sc = prepare('suffering', { tanks: ['Tank A', 'Tank B'], healers: ['Priest'], ranged: ['Mage'] }, { Priest: 'PRIEST', Mage: 'MAGE' });
    const first = R.simulate(fight, sc, 5000), second = R.simulate(fight, sc, 10000);
    assert.ok(first.hp[sc.tanks[0]] < 1);
    assert.ok(second.hp[sc.tanks[0]] < 1, 'former receiver is not healed during Suffering');
    assert.equal(R.simulate(fight, sc, 1000).drains.length, 1);
    assert.equal(R.simulate(fight, sc, 3000).drains[0].dispelled, true);
    assert.ok(R.simulate(fight, sc, 3000).absorbs.length, 'known priest gets an absorb job');
    const unknown = prepare('suffering', { tanks: ['Tank'], healers: ['Unknown'] });
    assert.equal(R.simulate(fight, unknown, 3000).drains[0].dispelled, false);
    assert.equal(R.simulate(fight, unknown, 3000).absorbs.length, 0);
    const mage = prepare('suffering', { tanks: ['Tank'], ranged: ['Mage'] }, { Mage: 'MAGE' });
    assert.equal(R.simulate(fight, mage, 3000).drains[0].dispelled, false, 'mages do not receive invented friendly dispels');
});

test('Suffering prepares one tank for Enrage without forcing a five-second rotation', () => {
    const sc = prepare('suffering');
    const prep = R.simulate(fight, sc, 9000), survival = R.simulate(fight, sc, 12000), end = R.simulate(fight, sc, 17999);
    assert.equal(prep.bossTarget, survival.bossTarget);
    assert.equal(survival.bossTarget, end.bossTarget);
    assert.equal(prep.tankDefense.prepared, true);
    assert.equal(survival.tankDefense.active, true);
    assert.match(survival.actions[0].kind, /enrage-survival/);
    assert.doesNotMatch(survival.instructionRows.map(row => row.join(' ')).join(' '), /rotate|five-second turn/i);
    assert.equal(end.hp[sc.tanks[1]], 1, 'a waiting tank does not take damage during the prepared-tank lesson');
});

test('a one-tank Fixate roster keeps taking damage and states that no handoff is available', () => {
    const sc = prepare('fixate', { tanks: ['Tank'] }, { Tank: 'WARRIOR' });
    const low = R.simulate(fight, sc, 13000), later = R.simulate(fight, sc, 16000);
    assert.ok(later.hp[sc.tanks[0]] < low.hp[sc.tanks[0]], 'the active tank does not freeze at a handoff that cannot happen');
    assert.equal(low.instructionRows.find(row => row[0] === 'Swap decision')[1], 'Health is low; no fresh tank is loaded.');
    assert.equal(later.bossTarget, sc.tanks[0]);
});

test('a fresh Suffering receiver moves in only after the health decision and no health is restored', () => {
    const sc = prepare('fixate');
    const incoming = sc.tanks[1], healthy = R.simulate(fight, sc, 10000), at14000 = R.simulate(fight, sc, 14000), at14999 = R.simulate(fight, sc, 14999), at15000 = R.simulate(fight, sc, 15000);
    assert.equal(healthy.nextTankAt, null);
    assert(L.dist(fight, at14999.pos[incoming], at14999.boss) < L.dist(fight, at14000.pos[incoming], at14000.boss));
    assert.ok(at15000.hp[sc.tanks[0]] <= at14999.hp[sc.tanks[0]], 'past receiver never receives forbidden healing');
});

test('Suffering front lanes keep every tank distinct through each handoff', () => {
    const sc = prepare('fixate');
    [0, 5000, 10000, 13000, 14000, 14999, 15000].forEach(time => {
        const frame = R.simulate(fight, sc, time);
        assert.ok(frame.tankLanes, 'front lanes are exposed for the renderer');
        sc.tanks.forEach((id, index) => sc.tanks.slice(index + 1).forEach(other => {
            assert.ok(L.dist(fight, frame.pos[id], frame.pos[other]) > 1.5, time + 'ms keeps ' + id + ' and ' + other + ' readable');
        }));
    });
    const incoming = sc.tanks[1], before = R.simulate(fight, sc, 14999), after = R.simulate(fight, sc, 15000);
    assert.ok(L.dist(fight, before.pos[incoming], after.pos[incoming]) < .1, 'the incoming tank has no selection-boundary teleport');
    assert.deepEqual(before.nextTankAt, before.tankLanes[before.nextTank].near, 'the next marker uses that tank’s lane');
});

test('a fourth Suffering tank keeps an in-bounds lane and becomes closest on its turn', () => {
    const sc = prepare('fixate', { tanks: ['Tank 1', 'Tank 2', 'Tank 3', 'Tank 4'] }, { 'Tank 1': 'WARRIOR', 'Tank 2': 'WARRIOR', 'Tank 3': 'WARRIOR', 'Tank 4': 'WARRIOR' });
    [0, 5000, 10000, 15000].forEach(time => {
        const frame = R.simulate(fight, sc, time), current = frame.pos[frame.bossTarget];
        assert.ok(current.x >= fight.arena.x0 && current.x <= fight.arena.x1 && current.y >= fight.arena.y0 && current.y <= fight.arena.y1, time + 'ms current lane stays on the arena');
        sc.tanks.filter(id => id !== frame.bossTarget).forEach(id => assert.ok(L.dist(fight, current, frame.boss) < L.dist(fight, frame.pos[id], frame.boss), time + 'ms selects the closest tank'));
    });
});

test('Suffering keeps every partial and oversized tank roster in-bounds with a unique closest receiver', () => {
    [1, 2, 3, 5, 8].forEach(count => {
        const tanks = Array.from({ length: count }, (_, index) => 'Tank ' + (index + 1));
        const classes = Object.fromEntries(tanks.map(name => [name, 'WARRIOR']));
        const sc = prepare('fixate', { tanks }, classes);
        for (let time = 0; time < sc.duration; time += 5000) {
            const frame = R.simulate(fight, sc, time), current = frame.pos[frame.bossTarget];
            sc.tanks.forEach(id => {
                const position = frame.pos[id];
                assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), count + '-tank roster has finite coordinates');
                assert.ok(position.x >= fight.arena.x0 && position.x <= fight.arena.x1 && position.y >= fight.arena.y0 && position.y <= fight.arena.y1, count + '-tank roster stays in arena');
            });
            sc.tanks.filter(id => id !== frame.bossTarget).forEach(id => assert.ok(L.dist(fight, current, frame.boss) < L.dist(fight, frame.pos[id], frame.boss), count + '-tank roster selects one closest receiver'));
        }
    });
});

test('souls only restore resources after nearby deaths when damage exists', () => {
    const sc = prepare('souls');
    const approaching = R.simulate(fight, sc, 4000), dead = R.simulate(fight, sc, 5000);
    assert.equal(approaching.souls.filter(s => s.dead).length, 0);
    assert.equal(dead.souls.filter(s => s.dead).length, 1);
    assert.ok(Object.values(dead.hp).some(v => v > approaching.hp[Object.keys(approaching.hp)[0]]));
    const noDamage = prepare('souls', { tanks: ['Tank'], healers: ['Healer'] });
    assert.equal(R.simulate(fight, noDamage, 9000).souls.filter(s => s.dead).length, 0);
});

test('Desire links recoil and healing while its maximum mana ceiling shrinks', () => {
    const sc = prepare('desire');
    const early = R.simulate(fight, sc, 1900), hit = R.simulate(fight, sc, 2000), late = R.simulate(fight, sc, 9000);
    assert.equal(early.recoil.length, 0);
    assert.equal(hit.recoil.length, 1);
    assert.ok(hit.maxMana < early.maxMana);
    assert.ok(late.maxMana < hit.maxMana);
    const recoiled = hit.recoil[0].targetId;
    assert.ok(late.hp[recoiled] > hit.hp[recoiled], 'healer recovery follows the recoil pulse');
});

test('Desire accelerates the sourced 2:40 mana loss to zero for standalone and cycle teaching', () => {
    const standalone = prepare('desire'), midpoint = R.simulate(fight, standalone, 7000), end = R.simulate(fight, standalone, 14000);
    assert.equal(Math.round(midpoint.maxMana), 50);
    assert.equal(end.maxMana, 0);
    assert.equal(end.manaState.elapsedMs, 160000);
    const cycle = prepare('cycle'), cycleEnd = R.simulate(fight, cycle, 60000 - 1);
    assert.equal(cycleEnd.maxMana, 0);
});

test('Rune Shield blocks kicks until an eligible remover takes it off', () => {
    const valid = prepare('interrupts', { tanks: ['Tank'], ranged: ['Mage', 'Warlock'] }, { Mage: 'MAGE', Warlock: 'WARLOCK' });
    assert.equal(R.simulate(fight, valid, 5000).shield.active, true);
    assert.equal(R.simulate(fight, valid, 7000).shield.active, false);
    assert.equal(R.simulate(fight, valid, 9600).cast.interrupted, true);
    const missing = prepare('interrupts', { tanks: ['Tank'], ranged: ['Hunter'] }, { Hunter: 'HUNTER' });
    assert.equal(R.simulate(fight, missing, 7000).shield.active, true);
    assert.equal(R.simulate(fight, missing, 9600).cast.interrupted, false);
    assert.ok(missingFrameRows(missing, 6000).some(row => /No known interrupt|missed/i.test(row[1])), 'missing kick coverage stays explicit');
});

test('phase-two teaching stages one current action and retains Tongues as a debuff', () => {
    const sc = prepare('interrupts', { tanks: ['Tank'], healers: ['Priest'], melee: ['Rogue'], ranged: ['Mage', 'Warlock'] }, { Priest: 'PRIEST', Rogue: 'ROGUE', Mage: 'MAGE', Warlock: 'WARLOCK' });
    const tongues = R.simulate(fight, sc, 500), shield = R.simulate(fight, sc, 6000), stolen = R.simulate(fight, sc, 7000), secondKick = R.simulate(fight, sc, 9600);
    assert.equal(tongues.actions.length, 1);
    assert.equal(tongues.actions[0].kind, 'tongues');
    assert.equal(tongues.actions[0].sourceId, sc.tongues);
    assert.equal(tongues.cast.durationMs, 1600, 'Tongues adds 60% to the shown one-second cast');
    assert.equal(shield.actions[0].kind, 'shield-block');
    assert.equal(shield.debuffs.tongues.sourceId, sc.tongues);
    assert.equal(stolen.actions[0].kind, 'spellsteal');
    assert.equal(stolen.actions[0].visualFromId, 'essence');
    assert.equal(stolen.actions[0].visualToId, sc.remover);
    assert.equal(secondKick.actions[0].sourceId, sc.kickers[1]);
    assert.equal(secondKick.actions[0].result, 'Spirit Shock stopped');
    assert.match(secondKick.teaching.detail, /next/i);
});

test('teaching state advances without stale actions and carries recovery, countdown and completion facts', () => {
    const roster = { tanks: ['MT', 'OT'], healers: ['Priest'], melee: ['Rogue'], ranged: ['Mage', 'Warlock', 'Shaman'] }, classes = { MT: 'WARRIOR', OT: 'WARRIOR', Priest: 'PRIEST', Rogue: 'ROGUE', Mage: 'MAGE', Warlock: 'WARLOCK', Shaman: 'SHAMAN' };
    const suffering = prepare('suffering', roster, classes);
    assert.match(R.simulate(fight, suffering, 0).teaching.detail, /defense by 500/i);
    const souls = prepare('souls', roster, classes), killed = R.simulate(fight, souls, 5000), recovered = R.simulate(fight, souls, 5600);
    assert.equal(killed.actions[0].kind, 'soul-kill'); assert.equal(recovered.actions[0].kind, 'soul-recovery'); assert.equal(recovered.actions[0].sourceId, 'soul0');
    const spite = prepare('spite', roster, classes), pre = R.simulate(fight, spite, 7500), impact = R.simulate(fight, spite, 9000);
    assert.equal(pre.actions[0].kind, 'pre-spite-heal'); assert.equal(pre.actions[0].targetIds.length, 3); assert.equal(impact.actions[0].kind, 'spite-impact');
    const cycle = prepare('cycle', roster, classes), complete = R.simulate(fight, cycle, 99000);
    assert.deepEqual(complete.actions, []); assert.deepEqual(complete.debuffs, {}); assert.equal(complete.teaching.title, '');
});

test('Deaden shows the assigned interrupt before optional alternatives', () => {
    const sc = prepare('deaden'), cast = R.simulate(fight, sc, 3500), stopped = R.simulate(fight, sc, 4300);
    assert.equal(cast.cast.active, true);
    assert.equal(stopped.actions[0].kind, 'kick');
    assert.equal(stopped.actions[0].sourceId, stopped.cast.sourceId);
    assert.equal(stopped.cast.interrupted, true);
    assert.equal(stopped.tipVisual, null);
});

test('renderer draws the current Reliquary action label at its connected actors', () => {
    const seen = [], ctx = new Proxy({ roundRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, setLineDash() {}, fillRect() {}, strokeRect() {}, measureText: text => ({ width: String(text).length * 7 }) }, { get(target, key) { if (key === 'fillText') return text => seen.push(text); return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; } });
    const api = { ctx, width: 800, yd: value => value * 8, px: point => ({ x: point.x * 800, y: point.y * 450 }) };
    Render.draw('foreground', api, { raid: [] }, { essence: 'Desire', bossHp: 1, boss: { x: .5, y: .24 }, pos: { warlock: { x: .3, y: .5 } }, actions: [{ kind: 'tongues', sourceId: 'warlock', targetId: 'essence', label: 'Warlock · Curse of Tongues', result: 'Cast slowed · more reaction time' }], shield: { active: false }, cast: { active: false }, pressure: 0, absorbs: [], drains: [], souls: [], recoil: [], shadowPulses: [], spite: [], lust: { active: false }, seethe: { active: false }, scream: { active: false } });
    assert.ok(seen.some(text => /Curse of Tongues/.test(text)));
    assert.ok(seen.some(text => /reaction time/.test(text)));
});

function missingFrameRows(scene, time) { return R.simulate(fight, scene, time).instructionRows; }

test('Rune Shield focus does not retain a completed interrupt chip', () => {
    const seen = [], ctx = new Proxy({ roundRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, setLineDash() {}, fillRect() {}, strokeRect() {}, measureText: text => ({ width: String(text).length * 7 }) }, { get(target, key) { if (key === 'fillText') return text => seen.push(text); return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; } });
    const api = { ctx, width: 800, yd: value => value * 8, px: point => ({ x: point.x * 800, y: point.y * 450 }) };
    Render.draw('foreground', api, { raid: [] }, { essence: 'Desire', bossHp: 1, boss: { x: .5, y: .24 }, pos: {}, shield: { active: true }, cast: { interrupted: true, kind: 'Spirit Shock' }, pressure: 0, absorbs: [], drains: [], souls: [], recoil: [], shadowPulses: [], spite: [], lust: { active: false }, seethe: { active: false }, scream: { active: false } });
    assert.ok(!seen.some(text => /INTERRUPTED/.test(text)));
});

test('live instruction rows make tank, Tongues, shield and kick ownership readable', () => {
    const suffering = prepare('suffering', { tanks: ['MT', 'OT', 'Tank 3'], healers: ['Priest'] }, { Priest: 'PRIEST' });
    const held = R.simulate(fight, suffering, 4500);
    assert.deepEqual(held.instructionRows.slice(0, 2), [['Current tank', 'MT — closest through the next Fixate check'], ['Swap decision', 'Hold the current tank while health, shields and cooldowns are enough.']]);

    const desire = prepare('interrupts', { tanks: ['Tank'], healers: ['Priest'], ranged: ['Mage', 'Warlock'], melee: ['Rogue'] }, { Priest: 'PRIEST', Mage: 'MAGE', Warlock: 'WARLOCK', Rogue: 'ROGUE' });
    const shield = R.simulate(fight, desire, 5000);
    assert.ok(shield.instructionRows.some(row => /Shield remover/.test(row[0]) && /Mage.*Spellsteal/.test(row[1])));
    assert.ok(shield.instructionRows.some(row => /Curse of Tongues/.test(row[0]) && /Warlock.*reaction time/.test(row[1])));
    assert.ok(shield.instructionRows.some(row => /Completed kick/.test(row[0]) && /Rogue/.test(row[1])));
    assert.ok(shield.instructionRows.some(row => /Next kick/.test(row[0]) && /Mage/.test(row[1])));
});

test('Anger names OT pickup, MT taunt, then damage and Lust four seconds later while Seethe remains active', () => {
    const sc = prepare('anger', { tanks: ['MT', 'OT'], ranged: ['Shaman'] }, { MT: 'WARRIOR', OT: 'WARRIOR', Shaman: 'SHAMAN' });
    const pickup = R.simulate(fight, sc, 0), taunt = R.simulate(fight, sc, 2000), burn = R.simulate(fight, sc, 6000);
    assert.ok(pickup.instructionRows.some(row => row[0] === 'OT pickup' && /OT/.test(row[1])));
    assert.ok(taunt.instructionRows.some(row => row[0] === 'MT taunt' && /MT/.test(row[1])));
    assert.equal(burn.lust.active, true);
    assert.equal(burn.seethe.active, true);
    assert.ok(burn.instructionRows.some(row => row[0] === 'Raid damage + Bloodlust' && /start now/.test(row[1])));
});

test('Anger does not invent OT pickup or MT taunt with one or no loaded tanks', () => {
    const one = prepare('anger', { tanks: ['OnlyTank'], ranged: ['Shaman'] }, { OnlyTank: 'WARRIOR', Shaman: 'SHAMAN' });
    const oneStart = R.simulate(fight, one, 0), oneLater = R.simulate(fight, one, 3000);
    assert.ok(oneStart.instructionRows.some(row => row[0] === 'Tank pickup' && /OnlyTank.*pick up/.test(row[1])));
    assert.doesNotMatch(oneLater.instructionRows.map(row => row.join(' ')).join('\n'), /OT pickup|MT taunt|taunted at 0:02/);
    const none = prepare('anger', { ranged: ['Mage'] }, { Mage: 'MAGE' });
    assert.ok(R.simulate(fight, none, 0).instructionRows.some(row => row[0] === 'Tank pickup' && /No tank loaded/.test(row[1])));
    assert.ok(R.simulate(fight, none, 6000).instructionRows.some(row => row[0] === 'Raid damage + Bloodlust' && /Hold damage/.test(row[1])));
});

test('completed Spirit Shock kick is not shown as the next kick', () => {
    const sc = prepare('interrupts', { tanks: ['Tank'], melee: ['Rogue', 'Warrior'], ranged: ['Mage'] }, { Tank: 'WARRIOR', Rogue: 'ROGUE', Warrior: 'WARRIOR', Mage: 'MAGE' });
    const afterFirst = R.simulate(fight, sc, 6000);
    assert.ok(afterFirst.instructionRows.some(row => row[0] === 'Completed kick' && /Rogue.*completed/.test(row[1])));
    assert.ok(afterFirst.instructionRows.some(row => row[0] === 'Next kick' && /Warrior.*0:08/.test(row[1])));
    assert.ok(!afterFirst.instructionRows.some(row => row[0] === 'Current kick' && /Rogue.*next/.test(row[1])));
});

test('Anger shows an honest two-tank handoff and Spite resolves immunity then impact', () => {
    const anger = prepare('anger');
    assert.notEqual(R.simulate(fight, anger, 1999).bossTarget, R.simulate(fight, anger, 2000).bossTarget);
    assert.equal(R.simulate(fight, anger, 14000).scream.active, true);
    const spite = prepare('spite');
    assert.equal(R.simulate(fight, spite, 3000).spite.length, 3);
    assert.ok(R.simulate(fight, spite, 5000).spite.every(s => s.immune));
    assert.ok(R.simulate(fight, spite, 9000).spite.every(s => s.impacted));
    const pressure = R.simulate(fight, anger, 13000), scream = R.simulate(fight, anger, 14000);
    assert.ok(pressure.shadowPulses.length && pressure.shadowPulses.every(p => p.targetIds.length === pressure.raidCount));
    assert.ok(Object.values(pressure.hp).every(v => v < 1));
    assert.ok(scream.scream.tankHit > 0 && pressure.tankResource.spendCue && scream.scream.tankHit < scream.scream.unspentHit && scream.hp[scream.bossTarget] < pressure.hp[pressure.bossTarget]);
});

test('cycle preserves mechanic boundaries and direct seeking never mutates inputs', () => {
    const sc = prepare('cycle'), snapshot = JSON.stringify({ fight, sc });
    assert.equal(R.simulate(fight, sc, 0).bossTarget, R.simulate(fight, sc, 5000).bossTarget);
    assert.equal(R.simulate(fight, sc, 5000).bossTarget, R.simulate(fight, sc, 10000).bossTarget);
    assert.equal(R.simulate(fight, sc, 17500).tankDefense.active, true, 'cycle includes prepared Enrage survival after the health-based handoff');
    assert.equal(R.simulate(fight, sc, 20000).essence, 'Souls');
    assert.equal(R.simulate(fight, sc, 32000).essence, 'Desire');
    assert.equal(R.simulate(fight, sc, 72000).essence, 'Anger');
    assert.ok(R.simulate(fight, sc, 3000).drains.length, 'cycle includes Suffering Drain');
    assert.equal(R.simulate(fight, sc, 49600).cast.interrupted, true, 'cycle carries Rune Shield removal into the second Shock kick');
    assert.ok(R.simulate(fight, sc, 91000).spite.length, 'cycle marks Spite targets in Anger');
    assert.ok(R.simulate(fight, sc, 93999).spite.every(s => s.immune), 'cycle keeps the full six-second Spite immunity');
    assert.ok(R.simulate(fight, sc, 94000).spite.every(s => s.impacted), 'cycle resolves Spite impact before recovery');
    assert.equal(R.simulate(fight, sc, 99000).stage, 'complete');
    const direct = R.simulate(fight, sc, 10000);
    R.simulate(fight, sc, 0);
    assert.deepEqual(R.simulate(fight, sc, 10000), direct);
    assert.equal(JSON.stringify({ fight, sc }), snapshot);
    const beforeEnd = R.simulate(fight, sc, 98499), atEnd = R.simulate(fight, sc, 98500), complete = R.simulate(fight, sc, 99000);
    assert.deepEqual(atEnd.shadowPulses.map(p => p.targetIds), beforeEnd.shadowPulses.map(p => p.targetIds));
    assert.equal(complete.bossTarget, null);
    assert.equal(complete.lust.active, false);
    assert.equal(complete.scream.active, false);
    assert.equal(complete.spite.length, 0);
    assert.equal(complete.pressure, 0);
    assert.equal(complete.tankResource, null);
});

test('cycle keeps Desire resources through intermission until nearby soul deaths and hides the withdrawn essence', () => {
    const sc = prepare('cycle'), firstBefore = R.simulate(fight, sc, 19999), firstStart = R.simulate(fight, sc, 20000), before = R.simulate(fight, sc, 59999), start = R.simulate(fight, sc, 60000), first = R.simulate(fight, sc, 6500 + 60000);
    assert.deepEqual(firstStart.hp, firstBefore.hp);
    assert.deepEqual(start.hp, before.hp);
    assert.equal(start.mana, before.mana);
    assert.equal(start.bossVisible, false);
    assert.ok(first.mana > start.mana);
    [before, start, first].forEach(f => assert.ok(f.mana <= f.maxMana));
    const gathered = R.simulate(fight, sc, 64000);
    sc.tanks.forEach(id => assert(L.dist(fight, gathered.pos[id], gathered.souls[0].at) < 12));
});

test('interrupt jobs rotate actual damage interrupters and one-tank Anger stays a hold', () => {
    const sc = prepare('interrupts', { tanks: ['Tank'], melee: ['Rogue'], ranged: ['Mage', 'Shaman'] }, { Tank: 'WARRIOR', Rogue: 'ROGUE', Mage: 'MAGE', Shaman: 'SHAMAN' });
    const first = R.simulate(fight, sc, 2000), second = R.simulate(fight, sc, 8000);
    assert.match(first.call, /casting/i); assert.notEqual(first.cast.sourceId, second.cast.sourceId);
    assert.equal(first.jobs[first.cast.sourceId], 'Next Spirit Shock kick');
    const solo = prepare('anger', { tanks: ['Solo'] }, { Solo: 'WARRIOR' }), frame = R.simulate(fight, solo, 2000);
    assert.match(frame.jobs[solo.tanks[0]], /Hold Anger/);
    assert.doesNotMatch(R.copyText(fight, solo, frame).split('Current roster')[1], /handoff/i);
});

test('Spite recovery needs a loaded healer', () => {
    const missing = prepare('spite', { tanks: ['Tank'], melee: ['Rogue'] }, { Tank: 'WARRIOR', Rogue: 'ROGUE' });
    const marked = R.simulate(fight, missing, 9000).spite[0].targetId;
    assert.ok(R.simulate(fight, missing, 11500).hp[marked] <= .48);
    const covered = prepare('spite', { tanks: ['Tank'], melee: ['Rogue'], healers: ['Priest'] }, { Tank: 'WARRIOR', Rogue: 'ROGUE', Priest: 'PRIEST' });
    assert.ok(R.simulate(fight, covered, 11500).hp[R.simulate(fight, covered, 9000).spite[0].targetId] > .48);
});

test('Anger only claims known tank resources and Spite immunity excludes marked players from shadow pulses', () => {
    const warrior = prepare('anger', { tanks: ['Warrior'], healers: ['Priest'] }, { Warrior: 'WARRIOR', Priest: 'PRIEST' });
    const paladin = prepare('anger', { tanks: ['Paladin'] }, { Paladin: 'PALADIN' });
    const unknown = prepare('anger', { tanks: ['Unknown'] });
    assert.equal(R.simulate(fight, warrior, 12000).tankResource.kind, 'Rage');
    assert.equal(R.simulate(fight, paladin, 12000).tankResource.kind, 'Mana');
    assert.equal(R.simulate(fight, unknown, 12000).tankResource, null);
    const spite = prepare('spite');
    const immune = R.simulate(fight, spite, 6000);
    const marked = new Set(immune.spite.filter(s => s.immune).map(s => s.targetId));
    assert.ok(immune.shadowPulses.every(p => p.targetIds.every(id => !marked.has(id))));
});

test('exports retain exact current jobs and clear them at completion', () => {
    const sc = prepare('suffering', { tanks: ['Tank'], healers: ['Priest'] }, { Tank: 'WARRIOR', Priest: 'PRIEST' });
    const text = R.copyText(fight, sc, R.simulate(fight, sc, 3000));
    assert.match(text, /Priest — Dispel Soul Drain; shield receiving tank/);
    const cycle = prepare('cycle', { tanks: ['Tank'], melee: ['Rogue'] }, { Tank: 'WARRIOR', Rogue: 'ROGUE' });
    assert.match(R.copyText(fight, cycle, R.simulate(fight, cycle, 99000)), /no active combat job/);
    assert.doesNotMatch(R.copyText(fight, cycle, R.simulate(fight, cycle, 99000)), /Burn Anger|Hold Anger/);
});

test('partial and oversized rosters preserve named players without fabricated coverage', () => {
    const roster = { tanks: ['Only tank'], ranged: Array.from({ length: 30 }, (_, i) => 'R' + i) };
    const sc = prepare('cycle', roster), frame = R.simulate(fight, sc, 88000), text = R.copyText(fight, sc, frame);
    assert.deepEqual(sc.raid.map(p => p.name).sort(), Object.values(roster).flat().sort());
    assert.match(text, /Only tank/);
    assert.match(text, /missing/i);
    assert.equal(frame.lust.active, false);
    Object.values(frame.pos).forEach(p => assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)));
});

console.log(`\n${passed} Reliquary of Souls checks passed`);
