'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeCommon } = require('./evaluation-common-evidence');
function raw() { return { reportCode: 'abcdefghijklmnop', fightId: 1, sourceId: 2, player: { classToken: 'PRIEST', role: 'healer' }, context: { fights: [{ id: 1, startTime: 1000, endTime: 121000 }], deaths: { data: { entries: [] } } }, tables: {}, events: { complete: true, data: [] } }; }
test('missing equipment, buff tables and incomplete streams stay unknown', () => {
    const r = raw(); r.events.complete = false;
    const result = analyzeCommon(r);
    assert.equal(result.findings.length, 0);
    for (const id of ['preparation-enchants', 'preparation-food', 'cast-timeline']) assert.equal(result.checks.find(c => c.id === id).status, 'unknown');
});
test('equipped slots need enchants; empty shirt/tabard/weapon placeholders do not', () => {
    const r = raw(); r.tables.ci = { data: [{ sourceID: 2, gear: [{ id: 100, slot: 7 }, { id: 101, slot: 3 }, { id: 0, slot: 15 }, { id: 103, slot: 4, permanentEnchant: 200 }] }] };
    const result = analyzeCommon(r);
    assert.equal(result.findings.length, 1); assert.equal(result.findings[0].evidence.length, 1); assert.match(result.findings[0].evidence[0].text, /Boots/);
});
test('healer cast gaps are bounded review windows and never missed healing estimates', () => {
    const r = raw(); r.events.data = [{ type: 'cast', sourceID: 2, timestamp: 2000, abilityGameID: 1 }, { type: 'cast', sourceID: 2, timestamp: 16000, abilityGameID: 2 }, { type: 'cast', sourceID: 3, timestamp: 9000 }];
    const result = analyzeCommon(r), finding = result.findings.find(f => f.id === 'cast-sequence-review');
    assert.deepEqual([finding.evidence[0].startSec, finding.evidence[0].endSec], [1, 15]);
    assert.match(finding.action, /Waiting when no healing is needed can be correct/); assert.equal(finding.gainDps, null);
});
test('malformed resource snapshots cannot turn into a mana or rage diagnosis', () => {
    const r = raw(); r.events.data = [{ type: 'cast', sourceID: 2, timestamp: 2000, classResources: [{ amount: 11910, max: 390, type: 11910, cost: 5006 }] }];
    const result = analyzeCommon(r); assert.equal(result.checks.find(c => c.id === 'mana-gains').status, 'unknown'); assert.ok(!result.findings.some(f => /mana/.test(f.id)));
});
test('mana gains use typed incoming restoration with separately reported waste', () => {
    const r = raw(); r.events.data = [{ type: 'resourcechange', sourceID: 3, targetID: 2, timestamp: 10000, resourceChangeType: 0, resourceChange: 400, waste: 100, abilityGameID: 9 }, { type: 'resourcechange', sourceID: 2, targetID: 3, timestamp: 12000, resourceChangeType: 0, resourceChange: 900, waste: 0, abilityGameID: 9 }];
    const result = analyzeCommon(r); assert.equal(result.comparison[0].player, 400); assert.match(result.comparison[0].note, /100 separately/); assert.equal(result.findings[0].owner, 'context');
});
test('death evidence belongs to this player and retains its precise window', () => {
    const r = raw(); r.context.deaths.data.entries = [{ id: 3, timestamp: 20000 }, { id: 2, timestamp: 11000, damage: { abilities: [{ name: 'Carrion Swarm' }] } }];
    const result = analyzeCommon(r), death = result.findings.find(f => f.id.startsWith('death-'));
    assert.match(death.title, /10 seconds/); assert.match(death.evidence[0].text, /Carrion Swarm/); assert.equal(death.owner, 'context');
});

test('cast chaining uses actual begin/complete pairs and excludes intervening utility', () => {
    const r = raw(); r.player = { classToken: 'WARLOCK', role: 'caster' };
    r.tables.casts = { data: { entries: [{ guid: 27209, name: 'Shadow Bolt', total: 4 }] } };
    r.events.data = [
        { timestamp: 1000, type: 'begincast', sourceID: 2, abilityGameID: 27209 }, { timestamp: 3500, type: 'cast', sourceID: 2, abilityGameID: 27209 },
        { timestamp: 4000, type: 'begincast', sourceID: 2, abilityGameID: 27209 }, { timestamp: 6500, type: 'cast', sourceID: 2, abilityGameID: 27209 },
        { timestamp: 7000, type: 'cast', sourceID: 2, abilityGameID: 27222 },
        { timestamp: 9000, type: 'begincast', sourceID: 2, abilityGameID: 27209 }, { timestamp: 11500, type: 'cast', sourceID: 2, abilityGameID: 27209 },
    ];
    const finding = analyzeCommon(r).findings.find(f => f.id === 'cast-chaining');
    assert.match(finding.title, /0.5 seconds/); assert.equal(finding.evidence.length, 1); assert.equal(finding.evidence[0].startSec, 2.5); assert.equal(finding.gainDps, null);
});

test('damage composition explains an observed difference without claiming a causal gain', () => {
    const r = raw(); r.player = { name: 'Player', classToken: 'WARLOCK', spec: 'Destruction', role: 'caster' }; r.context.fights[0].name = 'Anetheron';
    r.tables.dmg = { data: { entries: [{ guid: 27209, name: 'Shadow Bolt', total: 60000, hitCount: 30, critHitCount: 5 }] } };
    r.references = [{ reportCode: 'abcdefghijklmnop', fightId: 1, sourceId: 3, kind: 'raid', player: { ...r.player, name: 'Peer' }, context: r.context, tables: { dmg: { data: { entries: [{ guid: 27209, name: 'Shadow Bolt', total: 120000, hitCount: 40, critHitCount: 15 }] } } } }];
    const result = analyzeCommon(r), finding = result.findings.find(f => f.id === 'damage-composition');
    assert.match(finding.title, /500 DPS/); assert.equal(finding.gainDps, null); assert.match(finding.evidence[1].url, /source=3/);
});

test('live WCL positional combatant gear identifies unenchanted boots', () => {
    const r = raw(); const gear = Array.from({ length: 19 }, () => ({ id: 0 }));
    gear[7] = { id: 28608, permanentEnchant: 0 }; gear[15] = { id: 28439, permanentEnchant: 2673 };
    r.tables.ci = { data: [{ sourceID: 2, gear }] };
    const finding = analyzeCommon(r).findings.find(f => f.id === 'preparation-enchants');
    assert.equal(finding.evidence.length, 1); assert.match(finding.evidence[0].text, /Boots/);
});
test('an unpositioned truncated gear snapshot cannot pass all enchant checks', () => {
    const r = raw(); r.tables.ci = { data: [{ sourceID: 2, gear: [{ id: 28608 }] }] };
    assert.equal(analyzeCommon(r).checks.find(c => c.id === 'preparation-enchants').status, 'unknown');
});

test('automatic ranged attacks never become a spell-queue recommendation', () => {
    const r = raw(); r.player = { classToken: 'HUNTER', role: 'ranged' };
    r.events.data = [2000, 5000, 8000].flatMap(timestamp => [{ type: 'begincast', sourceID: 2, abilityGameID: 75, timestamp }, { type: 'cast', sourceID: 2, abilityGameID: 75, timestamp: timestamp + 500 }]);
    assert.equal(analyzeCommon(r).findings.some(f => f.id === 'cast-chaining'), false);
});

test('off-hand weapons and shields are checked without treating held frills as enchantable', () => {
    const r = raw(); r.tables.ci = { data: [{ sourceID: 2, gear: Array.from({ length: 19 }, () => ({ id: 0 })) }] };
    r.gearAudit = { slots: [{ key: 'offHand', label: 'Off hand', id: 30082, name: 'Weapon', enchantable: true, enchant: null }], unknownItems: [] };
    assert.match(analyzeCommon(r).findings.find(f => f.id === 'preparation-enchants').evidence[0].text, /Off hand/);
    r.gearAudit.slots[0].enchantable = false;
    assert.equal(analyzeCommon(r).findings.some(f => f.id === 'preparation-enchants'), false);
});
test('an intervening different cast clears an unmatched begin-cast', () => {
    const r = raw(); r.player = { classToken: 'WARLOCK', role: 'caster' };
    r.events.data = [1000, 5000].flatMap(timestamp => [{ type: 'begincast', sourceID: 2, abilityGameID: 27209, timestamp }, { type: 'cast', sourceID: 2, abilityGameID: 27209, timestamp: timestamp + 2500 }]);
    r.events.data.push({ type: 'begincast', sourceID: 2, abilityGameID: 27209, timestamp: 10000 }, { type: 'cast', sourceID: 2, abilityGameID: 27222, timestamp: 10500 }, { type: 'cast', sourceID: 2, abilityGameID: 27209, timestamp: 14000 });
    assert.equal(analyzeCommon(r).checks.find(c => c.id === 'cast-chaining').status, 'unknown');
});
