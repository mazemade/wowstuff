'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const positive = require('./fixtures/evaluation/roles-positive.json');
const counterexample = require('./fixtures/evaluation/roles-counterexamples.json');
const wclRegression = require('./fixtures/evaluation/wcl-role-regressions.json');
const { SPECS, resolveSpec } = require('./evaluation-specs');
const { analyzeRole } = require('./evaluation-role-evidence');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function base(sample, spec, sourceId = 7) {
  const fixture = clone(sample);
  return { player: { name: 'Tester', classToken: spec.classToken, spec: spec.spec, role: spec.role }, fightId: fixture.fight.id, sourceId,
    context: { fights: [fixture.fight], dmgAll: fixture.dmgAll, healAll: { data: { entries: [{ id: sourceId, name: 'Tester', total: 12000, effectiveHealing: 9000 }] } }, masterData: { actors: [] }, deaths: [] },
    tables: fixture.tables, events: fixture.events };
}
function capturedRole(key) {
  const sample = clone(wclRegression), role = sample[key];
  return { player: role.player, fightId: sample.fight.id, sourceId: role.sourceId, reportCode: 'X6mnbPQpGhjJC2TN',
    context: { fights: [sample.fight], dmgAll: { data: { entries: [] } }, healAll: { data: { entries: [] } }, masterData: { actors: sample.actors }, deaths: [] },
    tables: { casts: { data: { entries: role.casts || [] } }, healing: { data: { entries: role.healing || [] } }, damageTaken: { data: { entries: role.damageTaken || [] } }, buffs: { data: { auras: [] } }, dmg: { data: { entries: [] } } },
    events: { complete: true, data: role.events || [] }, damageTakenEvents: { complete: true, data: role.damageTakenEvents || [] } };
}

test('catalog resolves all 28 selectable TBC specs and feral aliases', () => {
  assert.equal(SPECS.length, 28);
  for (const spec of SPECS) {
    assert.equal(resolveSpec({ classToken: spec.classToken, spec: spec.spec }).id, spec.id);
    assert.ok(spec.mechanics.length >= 1, spec.id + ' has a meaningful telemetry check');
  }
  assert.equal(resolveSpec({ class: 'DRUID', spec: 'Feral Cat' }).id, 'DRUID:Feral');
  assert.equal(resolveSpec({ class: 'DRUID', spec: 'bear' }).id, 'DRUID:Guardian');
  assert.equal(resolveSpec({ class: 'PALADIN', spec: 'Justicar' }).id, 'PALADIN:Protection');
  assert.equal(resolveSpec({ class: 'WARRIOR', spec: 'Champion' }).id, 'WARRIOR:Arms');
  assert.equal(resolveSpec({ class: 'DRUID', spec: 'Feral', role: 'tank' }).id, 'DRUID:Guardian');
});

test('Retribution seal switching is not treated as a generic low-uptime fault', () => {
  const spec = resolveSpec({ classToken: 'PALADIN', spec: 'Retribution' });
  const raw = base(positive, spec);
  raw.tables.buffs.data.auras = [{ guid: 348700, name: 'Seal of the Martyr', totalUptime: 30000, bands: [{ startTime: 1010000, endTime: 1040000 }] }];
  const result = analyzeRole(raw);
  assert.equal(result.findings.some(f => f.id === 'coverage-seal-of-blood'), false);
  assert.match(result.coverage.checks.find(c => c.id === 'seal-of-blood').reason, /Seal switching/);
});

test('each spec has checked positive evidence when its mechanic is logged', () => {
  for (const spec of SPECS) {
    const raw = base(positive, spec);
    const mechanic = spec.mechanics[0];
    raw.tables.casts.data.entries.push({ guid: mechanic.spell, total: 2 });
    raw.tables.dmg.data.entries.push({ guid: mechanic.spell, total: 1000, hitCount: 2 });
    if (mechanic.aura) raw.tables.buffs.data.auras.push({ guid: mechanic.aura, totalUptime: 60000, bands: [{ startTime: 1010000, endTime: 1070000 }] });
    if (['dot', 'hot', 'target-debuff', 'target-buff'].includes(mechanic.kind)) {
      const buff = mechanic.kind === 'hot' || mechanic.kind === 'target-buff';
      raw.events.data.push({ type: buff ? 'applybuff' : 'applydebuff', sourceID: 7, targetID: 99, abilityGameID: mechanic.aura, timestamp: 1010000 }, { type: buff ? 'removebuff' : 'removedebuff', sourceID: 7, targetID: 99, abilityGameID: mechanic.aura, timestamp: 1070000 });
    }
    const result = analyzeRole(raw);
    assert.equal(result.coverage.spec, spec.id);
    assert.equal(result.coverage.checks.find(check => check.id === mechanic.id).status, 'checked', spec.id);
    assert.ok(result.limitations.some(message => /never derives a causal DPS gain/.test(message)));
  }
});

test('missing cooldown data is unknown, not an assertion that the talent was available', () => {
  const raw = base(counterexample, resolveSpec({ classToken: 'HUNTER', spec: 'Beast Mastery' }), 8);
  const result = analyzeRole(raw);
  const cooldown = result.coverage.checks.find(check => check.id === 'bestial-wrath');
  assert.equal(cooldown.status, 'unknown');
  assert.match(cooldown.reason, /declared spec alone does not prove/);
  assert.equal(result.findings.some(finding => /Bestial Wrath.*missing|missed/i.test(finding.title)), false);
});

test('healing output is descriptive and does not label low HPS bad', () => {
  const spec = resolveSpec({ classToken: 'PRIEST', spec: 'Holy' });
  const raw = base(positive, spec);
  raw.tables.healing = { data: { entries: [{ guid: 34861, total: 10000, effectiveHealing: 5500, overheal: 4500 }] } };
  const result = analyzeRole(raw);
  assert.ok(result.findings.some(finding => finding.id === 'healing-composition'));
  assert.equal(result.findings.some(finding => /low hps|bad hps/i.test(finding.title + finding.action)), false);
});

test('tank evidence distinguishes active damage and pre-death context from fault', () => {
  const spec = resolveSpec({ classToken: 'DRUID', spec: 'Guardian' });
  const raw = base(positive, spec);
  raw.context.deaths = [{ targetID: 7, timestamp: 1119000 }];
  raw.damageTakenEvents = { complete: true, data: [{ type: 'damage', targetID: 7, timestamp: 1114000, amount: 12000 }, { type: 'damage', targetID: 7, timestamp: 1118000, amount: 15000 }] };
  const result = analyzeRole(raw);
  assert.equal(result.coverage.checks.find(check => check.id === 'active-tanking').status, 'checked');
  const death = result.findings.find(finding => finding.id.startsWith('tank-predeath-'));
  assert.ok(death); assert.equal(death.owner, 'context'); assert.match(death.action, /does not attribute/);
});

test('target DoTs require attributed outgoing debuff events, never a self-buff substitute', () => {
  const spec = resolveSpec({ classToken: 'DRUID', spec: 'Feral' });
  const raw = base(positive, spec);
  raw.events = { complete: false, data: [] };
  raw.tables.buffs.data.auras.push({ guid: 27008, totalUptime: 110000, bands: [{ startTime: 1000000, endTime: 1110000 }] });
  const result = analyzeRole(raw);
  assert.equal(result.coverage.checks.find(check => check.id === 'rip').status, 'unknown');
});

test('target raid effects require source-attributed events rather than buffs seen on the player', () => {
  const survival = base(positive, resolveSpec({ classToken: 'HUNTER', spec: 'Survival' }));
  survival.events = { complete: false, data: [] };
  survival.tables.buffs.data.auras.push({ guid: 34503, totalUptime: 110000, bands: [{ startTime: 1000000, endTime: 1110000 }] });
  assert.equal(analyzeRole(survival).coverage.checks.find(check => check.id === 'expose-weakness').status, 'unknown');

  const enhancement = base(positive, resolveSpec({ classToken: 'SHAMAN', spec: 'Enhancement' }));
  enhancement.events.data.push(
    { type: 'applybuff', sourceID: 7, targetID: 11, abilityGameID: 30809, timestamp: 1010000 },
    { type: 'removebuff', sourceID: 7, targetID: 11, abilityGameID: 30809, timestamp: 1070000 }
  );
  const rage = analyzeRole(enhancement).coverage.checks.find(check => check.id === 'unleashed-rage');
  assert.equal(rage.status, 'checked');
  assert.match(rage.reason, /50% recorded/);
});

test('DTPS falls back to the per-player DamageTaken ability table', () => {
  const spec = resolveSpec({ classToken: 'DRUID', spec: 'Guardian' });
  const raw = base(positive, spec);
  raw.context.damageTaken = undefined;
  raw.tables.damageTaken = { data: { entries: [{ guid: 1, total: 24000 }, { guid: 31306, total: 12000 }] } };
  const result = analyzeRole(raw);
  assert.deepEqual(result.observed, { metric: 'dtps', playerValue: 300, referenceValue: null, gapValue: null });
});

test('DTPS excludes absorbed damage and matches damage-event amounts', () => {
  const raw = base(positive, resolveSpec({ classToken: 'DRUID', spec: 'Guardian' }));
  raw.tables.damageTaken = { data: { entries: [{ guid: 1, total: 15000, totalReduced: 12000 }, { guid: 31306, total: 3000 }] } };
  raw.damageTakenEvents = { complete: true, data: [{ type: 'damage', targetID: 7, timestamp: 1010000, amount: 12000, absorbed: 3000 }, { type: 'damage', targetID: 7, timestamp: 1020000, amount: 3000 }] };
  const result = analyzeRole(raw);
  assert.equal(result.observed.playerValue, 125);
  assert.equal(result.comparison.find(row => row.name === 'Recorded incoming damage').player, 15000);
});

test('rank-aware healer checks and friendly HoT coverage use all WCL rank IDs', () => {
  const raw = base(positive, resolveSpec({ classToken: 'PRIEST', spec: 'Holy' }));
  raw.tables.casts.data.entries.push({ guid: 34866, total: 6 }, { guid: 25222, total: 2 }, { guid: 25315, total: 1 });
  raw.events.data.push(
    { type: 'cast', sourceID: 7, targetID: 11, abilityGameID: 34866, timestamp: 1010000 },
    { type: 'applybuff', sourceID: 7, targetID: 11, abilityGameID: 25222, timestamp: 1020000 },
    { type: 'refreshbuff', sourceID: 7, targetID: 11, abilityGameID: 25315, timestamp: 1040000 },
    { type: 'removebuff', sourceID: 7, targetID: 11, abilityGameID: 25315, timestamp: 1080000 }
  );
  const result = analyzeRole(raw);
  assert.match(result.coverage.checks.find(check => check.id === 'circle-of-healing').reason, /6 recorded casts/);
  assert.match(result.coverage.checks.find(check => check.id === 'renew').reason, /50% recorded/);
});

test('captured WCL healer rows recognize max-rank Circle of Healing and friendly Renew events', () => {
  const result = analyzeRole(capturedRole('healer'));
  assert.match(result.coverage.checks.find(check => check.id === 'circle-of-healing').reason, /6 recorded casts/);
  assert.match(result.coverage.checks.find(check => check.id === 'renew').reason, /27\.6% recorded/);
  assert.match(result.coverage.checks.find(check => check.id === 'renew').label, /any-recorded-target coverage/);
  assert.ok(result.comparison.some(row => row.name === 'Renew on target 7' && row.player === 27.6));
  assert.match(result.coverage.checks.find(check => check.id === 'healing-targets').reason, /^2 distinct targets/);
});

test('captured WCL tank table uses health damage rather than damage plus absorbs for DTPS', () => {
  const result = analyzeRole(capturedRole('tank'));
  assert.equal(result.observed.playerValue, 1165.7);
});

test('pet contribution stays unknown for an incomplete actor roster and accepts explicit legacy pet ownership', () => {
  const spec = resolveSpec({ classToken: 'HUNTER', spec: 'Beast Mastery' });
  const partial = base(positive, spec, 43);
  partial.context.actorRosterComplete = false;
  partial.context.masterData.actors = wclRegression.actors;
  partial.events.data.push({ type: 'damage', sourceID: 51, targetID: 94, abilityGameID: 27049, timestamp: 1010000, amount: 500 });
  let pet = analyzeRole(partial).coverage.checks.find(check => check.id === 'pet-contribution');
  assert.equal(pet.status, 'unknown');
  assert.match(pet.reason, /full actor roster is unavailable/);

  const missing = base(positive, spec, 43);
  pet = analyzeRole(missing).coverage.checks.find(check => check.id === 'pet-contribution');
  assert.equal(pet.status, 'unknown');

  const legacy = base(positive, spec, 43);
  legacy.context.masterData.actors = wclRegression.actors;
  legacy.events.data.push({ type: 'damage', sourceID: 51, targetID: 94, abilityGameID: 27049, timestamp: 1010000, amount: 500 });
  pet = analyzeRole(legacy).coverage.checks.find(check => check.id === 'pet-contribution');
  assert.equal(pet.status, 'checked');
  assert.match(pet.reason, /^500 pet damage from 1 owned actor/);
});

test('healer targets and death windows exclude non-healing applybuff events', () => {
  const raw = base(positive, resolveSpec({ classToken: 'PRIEST', spec: 'Holy' }));
  raw.context.deaths = [{ id: 12, timestamp: 1060000 }];
  raw.events.data.push(
    { type: 'heal', sourceID: 7, targetID: 11, abilityGameID: 25235, timestamp: 1050000, amount: 100 },
    { type: 'absorbed', sourceID: 7, targetID: 12, abilityGameID: 25218, timestamp: 1055000, amount: 200 },
    { type: 'applybuff', sourceID: 7, targetID: 13, abilityGameID: 25389, timestamp: 1059000 }
  );
  const result = analyzeRole(raw);
  assert.match(result.coverage.checks.find(check => check.id === 'healing-targets').reason, /^2 distinct targets/);
  assert.match(result.findings.find(finding => finding.id === 'death-healing-context').evidence[0].text, /1 provided player heal\/absorb events/);
});

test('resource evidence follows the affected player and keeps resource pools separate', () => {
  const raw = base(positive, resolveSpec({ classToken: 'HUNTER', spec: 'Beast Mastery' }));
  raw.events.data.push(
    { type: 'resourcechange', sourceID: 7, targetID: 70, resourceChangeType: 2, waste: 90, timestamp: 1010000 },
    { type: 'resourcechange', sourceID: 88, targetID: 7, resourceChangeType: 0, waste: 12, timestamp: 1020000 },
    { type: 'resourcechange', sourceID: 7, targetID: 7, resourceChangeType: 0, waste: 3, timestamp: 1030000 }
  );
  const reason = analyzeRole(raw).coverage.checks.find(check => check.id === 'resource-context').reason;
  assert.match(reason, /^2 player resource-change events/);
  assert.match(reason, /mana: 2 changes, 15 in WCL’s waste field/);
  assert.doesNotMatch(reason, /focus/);
});

test('tank quiet-gap evidence preserves each original adjacent pair', () => {
  const raw = base(positive, resolveSpec({ classToken: 'DRUID', spec: 'Guardian' }));
  raw.damageTakenEvents = { complete: true, data: [0, 1, 20, 21, 50].map(second => ({ type: 'damage', targetID: 7, timestamp: 1000000 + second * 1000, amount: 1 })) };
  const gaps = analyzeRole(raw).findings.find(finding => finding.id === 'tank-idle-windows').evidence;
  assert.deepEqual(gaps.map(gap => [gap.startSec, gap.endSec]), [[1, 20], [21, 50]]);
});

test('raid peer evidence links to the peer source rather than the evaluated player', () => {
  const raw = base(positive, resolveSpec({ classToken: 'PRIEST', spec: 'Holy' }));
  raw.reportCode = 'abcdefghijklmnop'; raw.references = [{ kind: 'raid', reportCode: raw.reportCode, fightId: raw.fightId, sourceId: 12, player: { name: 'Peer', classToken: 'PRIEST', spec: 'Holy' }, context: { fights: [positive.fight], healAll: { data: { entries: [{ id: 12, total: 9000 }] } } }, tables: {} }];
  const peer = analyzeRole(raw).findings.find(finding => finding.id === 'raid-peer-context');
  assert.match(peer.evidence[0].url, /source=12$/);
});

test('ground effects remain cast activity and Improved Scorch uses its debuff aura ID', () => {
  const paladin = base(positive, resolveSpec({ classToken: 'PALADIN', spec: 'Protection' }));
  paladin.tables.casts.data.entries.push({ guid: 27173, total: 4 });
  const consecration = analyzeRole(paladin);
  assert.match(consecration.coverage.checks.find(check => check.id === 'consecration').label, /activity/);
  assert.equal(consecration.findings.some(finding => finding.id === 'coverage-consecration'), false);

  const mage = base(positive, resolveSpec({ classToken: 'MAGE', spec: 'Fire' }));
  mage.tables.casts.data.entries.push({ guid: 27074, total: 5 });
  mage.events.data.push({ type: 'applydebuff', sourceID: 7, targetID: 99, abilityGameID: 22959, timestamp: 1010000 }, { type: 'removedebuff', sourceID: 7, targetID: 99, abilityGameID: 22959, timestamp: 1070000 });
  assert.match(analyzeRole(mage).coverage.checks.find(check => check.id === 'improved-scorch').reason, /50% recorded/);
});

test('damage total is never presented as a cast count when the casts table is absent', () => {
  const spec = resolveSpec({ classToken: 'MAGE', spec: 'Arcane' });
  const raw = base(positive, spec);
  raw.tables.casts.data.entries = [];
  raw.tables.dmg.data.entries = [{ guid: 30451, total: 42000 }];
  const result = analyzeRole(raw);
  assert.equal(result.coverage.checks.find(check => check.id === 'arcane-blast').status, 'unknown');
});

test('DPS prefers a benchmark while healer and tank outputs keep raid peers as ungraded context', () => {
  const mage = resolveSpec({ classToken: 'MAGE', spec: 'Arcane' });
  const raw = base(positive, mage);
  raw.references = [
    { kind: 'raid', player: { name: 'Raid Mage', classToken: 'MAGE', spec: 'Arcane' }, fightId: 91, sourceId: 9, context: { fights: [positive.fight], dmgAll: { data: { entries: [{ id: 9, total: 36000 }] } } }, tables: {} },
    { kind: 'benchmark', player: { name: 'Benchmark Mage', classToken: 'MAGE', spec: 'Arcane' }, fightId: 91, sourceId: 10, context: { fights: [positive.fight], dmgAll: { data: { entries: [{ id: 10, total: 48000 }] } } }, tables: {} },
  ];
  const dps = analyzeRole(raw);
  assert.equal(dps.observed.referenceValue, 400);
  assert.ok(dps.findings.some(finding => /benchmark/.test(finding.title)));
  const healer = base(positive, resolveSpec({ classToken: 'PRIEST', spec: 'Holy' }));
  healer.references = [{ kind: 'raid', player: { name: 'Peer', classToken: 'PRIEST', spec: 'Holy' }, fightId: 91, sourceId: 11, context: { fights: [positive.fight], healAll: { data: { entries: [{ id: 11, effectiveHealing: 18000 }] } } }, tables: {} }];
  const hps = analyzeRole(healer);
  assert.equal(hps.observed.referenceValue, null);
  assert.equal(hps.observed.gapValue, null);
  assert.ok(hps.findings.some(finding => finding.id === 'raid-peer-context'));
});

test('WCL Deaths table wrappers are unwrapped before healer death-window context', () => {
  const spec = resolveSpec({ classToken: 'PRIEST', spec: 'Holy' });
  const raw = base(positive, spec);
  raw.context.deaths = { data: { entries: [{ id: 12, timestamp: 1110000 }] } };
  raw.events = { complete: true, data: [{ type: 'heal', sourceID: 7, targetID: 12, timestamp: 1107000, abilityGameID: 34861 }] };
  const result = analyzeRole(raw);
  assert.ok(result.findings.some(finding => finding.id === 'death-healing-context'));
});
