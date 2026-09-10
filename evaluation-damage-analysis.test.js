'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeDamage } = require('./evaluation-damage-analysis');
test('real Varenthil comparison recovers the omitted Martyr family and all 1052.6 DPS', () => {
    const raw = require('./fixtures/evaluation/varenthil-damage.json');
    const result = analyzeDamage(raw), r = result.damageAnalysis;
    assert.equal(r.gapDps, 1052.6); assert.equal(r.accountedDps, 1052.6); assert.equal(r.residualDps, 0);
    assert.equal(r.rows.find(r => r.id === 'blood-martyr').differenceDps, 399.6);
    assert.equal(r.rows.find(r => r.id === 'melee').playerCount, 41);
    assert.equal(r.rows.find(r => r.id === 'melee').referenceCount, 57);
    assert.equal(r.rows.find(r => r.id === 'crusader strike').referenceCount, 20);
    assert(result.findings.every(f => f.gainDps === null));
    assert(result.findings.find(f => f.id === 'throughput-stat-context').evidence.some(e => /591 versus 1022/.test(e.text)));
});
function player(name, sourceId, duration, rows) {
    return { sourceId, reportCode: 'abcdefghijklmnop', fightId: 1, player: { name, classToken: 'PALADIN', spec: 'Retribution', role: 'melee' },
        context: { fights: [{ id: 1, name: 'Boss', startTime: 1000, endTime: 1000 + duration * 1000 }] }, tables: { dmg: { data: { entries: rows.map(row => ({ tickCount: 0, missCount: 0, tickMissCount: 0, ...row })) } } } };
}
test('all abilities reconcile the gap, including faction equivalents and reference-only output', () => {
    const a = player('Me', 1, 100, [{ guid: 31893, name: 'Seal of Blood', total: 10000, hitCount: 10 }, { guid: 1, name: 'Melee', total: 20000, hitCount: 20 }]);
    a.references = [player('Peer', 2, 80, [{ guid: 348701, name: 'Seal of the Martyr', total: 24000, hitCount: 20 }, { guid: 1, name: 'Melee', total: 24000, hitCount: 20 }, { guid: 27138, name: 'Exorcism', total: 4000, hitCount: 4 }])];
    const r = analyzeDamage(a).damageAnalysis;
    assert.equal(r.rows.length, 3); assert.equal(r.gapDps, 350); assert.equal(r.accountedDps, 350); assert.equal(r.residualDps, 0);
    const seal = r.rows.find(r => r.id === 'blood-martyr'); assert.equal(seal.differenceDps, 200);
    assert.equal(round(seal.frequencyDps + seal.yieldDps), seal.differenceDps);
    const ex = r.rows.find(r => r.name === 'Exorcism'); assert.equal(ex.playerCount, 0); assert.equal(ex.referenceDps, 50); assert.equal(ex.frequencyDps, null);
});
const round = n => Math.round(n * 10) / 10;
test('negative contributions remain offsets and actor/table differences stay residual', () => {
    const a = player('Me', 1, 100, [{ guid: 1, name: 'Melee', total: 50000, hitCount: 20 }]);
    const b = player('Peer', 2, 100, [{ guid: 1, name: 'Melee', total: 30000, hitCount: 20 }, { guid: 2, name: 'Proc', total: 40000, hitCount: 30 }]);
    b.context.dmgAll = { data: { entries: [{ id: 2, total: 90000 }] } }; a.references = [b];
    const r = analyzeDamage(a).damageAnalysis;
    assert.equal(r.rows.find(r => r.name === 'Melee').differenceDps, -200);
    assert.equal(r.gapDps, 400); assert.equal(r.accountedDps, 200); assert.equal(r.residualDps, 200);
});
test('damage outcomes include ticks and misses without counting critical hits twice', () => {
    const row = { guid: 4, name: 'Dot', total: 3000, hitCount: 1, tickCount: 9, missCount: 1, tickMissCount: 1, critHitCount: 1, critTickCount: 3 };
    const a = player('Me', 1, 100, [row]); a.references = [player('Peer', 2, 100, [{ ...row, total: 4000 }])];
    assert.equal(analyzeDamage(a).damageAnalysis.rows[0].playerCount, 12);
});
test('missing counts are unknown and same-name ranks combine; different specs are excluded', () => {
    const a = player('Me', 1, 100, [{ guid: 100, name: 'Spell (Rank 1)', total: 3000 }]);
    const b = player('Peer', 2, 100, [{ guid: 200, name: 'Spell (Rank 2)', total: 4000, hitCount: 3 }]); a.references = [b];
    const r = analyzeDamage(a).damageAnalysis;
    assert.equal(r.rows.length, 1); assert.equal(r.rows[0].playerCount, null); assert.equal(r.rows[0].frequencyDps, null);
    b.player.spec = 'Protection'; assert.equal(analyzeDamage(a).damageAnalysis, undefined);
    a.player.role = 'healer'; assert.equal(analyzeDamage(a).damageAnalysis, undefined);
});
test('reference priority matches the selected benchmark and rates use each pull duration', () => {
    const a = player('Me', 1, 100, [{ guid: 1, name: 'Melee', total: 30000, hitCount: 10 }]);
    const b = player('Raid', 2, 100, [{ guid: 1, name: 'Melee', total: 40000, hitCount: 20 }]);
    const c = player('Benchmark', 3, 50, [{ guid: 1, name: 'Melee', total: 30000, hitCount: 10 }]);c.kind = 'benchmark'; a.references = [b,c];
    const r = analyzeDamage(a).damageAnalysis; assert.equal(r.reference.name, 'Benchmark'); assert.equal(r.rows[0].referencePerMinute, 12); assert.equal(r.rows[0].playerPerMinute, 6);
});
test('omitted outcome fields and crit counters stay unknown; punctuation does not merge unrelated names', () => {
    const a = player('Me', 1, 100, [{ guid: 1, name: 'A-B', total: 1000, hitCount: 10 }]);
    const b = player('Peer', 2, 100, [{ guid: 2, name: 'AB', total: 2000, hitCount: 10, critHitCount: 0 }]);
    delete a.tables.dmg.data.entries[0].missCount; a.references = [b];
    const r = analyzeDamage(a).damageAnalysis;
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows.find(r => r.name === 'A-B').playerCount, null);
    assert.equal(r.rows.find(r => r.name === 'A-B').playerCritPercent, null);
    assert.equal(r.rows.find(r => r.name === 'AB').referenceCritPercent, 0);
});
test('buff maintenance compares recorded auras without interpreting omitted long buffs as absent', () => {
    const a = player('Me', 1, 100, []), b = player('Peer', 2, 100, []); a.references = [b];
    a.tables.buffs = { data: { auras: [{ name: 'Battle Shout', totalUptime: 60000 }] } };
    b.tables.buffs = { data: { auras: [{ name: 'Battle Shout', totalUptime: 100000 }, { name: 'Wrath of Air Totem', totalUptime: 100000 }] } };
    const r = analyzeDamage(a);
    assert.match(r.findings.find(f => f.id === 'buff-maintenance-comparison').evidence[0].text, /40 seconds/);
    assert(!r.comparison.some(r => r.name.startsWith('Wrath of Air')));
});
