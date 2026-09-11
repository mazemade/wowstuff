'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeBudget } = require('./evaluation-budget');
const { attributeCauses } = require('./evaluation-attribution');
const recorded = require('./fixtures/evaluation/utopik-investigation.json');
const fight = name => structuredClone(recorded.fights.find(f => f.name === name));
const causesFor = name => { const raw = fight(name); return attributeCauses(raw, analyzeBudget(raw)).causes; };

test('Winterchill expertise gap resolves to Fang of Vashj with the reference luck stated', () => {
    const causes = causesFor('Rage Winterchill');
    const expertise = causes.find(c => c.id === 'stat-expertise');
    assert.equal(expertise.owner, 'you'); assert.equal(expertise.kind, 'gear'); assert.equal(expertise.bucket, 'melee'); assert.equal(expertise.factor, 'zeroDamage');
    assert.match(expertise.observation, /15 dodges against 6/);
    assert.match(expertise.observation, /0 expertise.*21/s);
    assert.ok(expertise.evidence.some(e => /Fang of Vashj/.test(e.text) && /21 expertise/.test(e.text)));
    assert.match(expertise.observation, /luck|variance/i, 'the reference dodge count below expectation is named');
    assert.deepEqual(expertise.statDelta, { 24: 21 });
    assert.deepEqual(expertise.sim, { bonusStats: { 24: 21 } });
    const miss = causes.find(c => c.id === 'luck-melee-miss');
    assert.equal(miss.owner, 'luck'); assert.match(miss.observation, /13 misses against 6/);
});

test('Winterchill auras at pull: flask against elixir, Kings, Unleashed Rage; trinket without damage stats', () => {
    const causes = causesFor('Rage Winterchill');
    const flask = causes.find(c => c.id === 'aura-flask');
    assert.equal(flask.owner, 'you'); assert.match(flask.observation, /Elixir of Major Agility/); assert.match(flask.observation, /Flask of Relentless Assault/);
    assert.deepEqual(flask.sim, { consumable: { field: 'flaskId', id: 22854, clear: ['battleElixirId', 'guardianElixirId'] } });
    const kings = causes.find(c => c.id === 'aura-25898');
    assert.equal(kings.owner, 'raid'); assert.match(kings.title, /Blessing of Kings/);
    const ur = causes.find(c => c.id === 'uptime-30807');
    assert.equal(ur.owner, 'raid'); assert.match(ur.observation, /79\.5%/); assert.match(ur.observation, /0%/);
    const dst = causes.find(c => c.id === 'proc-28830');
    assert.equal(dst.owner, 'you'); assert.match(dst.observation, /Dragonspine Trophy/); assert.match(dst.observation, /Medallion of the Horde/);
    assert.deepEqual(dst.sim, { equip: { slot: 12, id: 28830, replaces: 28240 } });
    const drums = causes.find(c => c.id === 'uptime-35476');
    assert.equal(drums.owner, 'raid');
    const snd = causes.find(c => c.id === 'uptime-6774');
    assert.equal(snd, undefined, 'the player has more Slice and Dice uptime than the reference; no cause');
});

test('no cause is manufactured when both sides lack a table', () => {
    const raw = fight('Rage Winterchill'); delete raw.tables.buffs; for (const r of raw.references) delete r.tables.buffs;
    const result = attributeCauses(raw, analyzeBudget(raw));
    assert.ok(!result.causes.some(c => c.id.startsWith('uptime-')));
    assert.ok(result.limitations.some(l => /[Bb]uff bands/.test(l)));
});

test('Bloodlust and Heroism are one family, so a faction difference is not a cause', () => {
    const causes = causesFor('Rage Winterchill');
    assert.equal(causes.find(c => c.id === 'uptime-32182'), undefined);
    assert.equal(causes.find(c => c.id === 'uptime-2825'), undefined, 'Utopik 28% Bloodlust against Jofrey 31% Heroism is below the 10-point threshold');
});
