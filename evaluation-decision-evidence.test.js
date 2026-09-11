'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SPECS } = require('./evaluation-specs.js');
const { analyzeDecisions } = require('./evaluation-decision-evidence.js');

function raw(spec, events = [], extra = {}) {
  return {
    player: { name: 'Tester', classToken: spec.classToken, spec: spec.spec, role: spec.role }, sourceId: 7, reportCode: 'TEST', fightId: 1,
    context: { fights: [{ id: 1, startTime: 1000000, endTime: 1060000 }] },
    tables: { casts: { data: { entries: [] } }, dmg: { data: { entries: [] } } },
    events: { complete: true, data: events }, ...extra,
  };
}
const event = (type, id, time, targetID = 99) => ({ type, sourceID: 7, targetID, abilityGameID: id, timestamp: 1000000 + time * 1000 });

test('every catalog spec has explicit decision coverage rather than a generic uptime claim', () => {
  for (const spec of SPECS) {
    const first = spec.mechanics[0];
    const result = analyzeDecisions(raw(spec, [event(first.kind === 'dot' ? 'applydebuff' : 'cast', first.spell, 1)]));
    assert.equal(result.telemetryObserved.includes(first.id), true, spec.id);
    assert.equal(result.depth.status, 'partial', spec.id);
    assert.ok(result.checks.some(check => check.id === 'decision-' + first.id), spec.id);
  }
});

test('fixed-duration DoTs only flag a source-target refresh with unambiguous remaining time', () => {
  const spec = SPECS.find(value => value.id === 'HUNTER:Survival');
  const result = analyzeDecisions(raw(spec, [event('applydebuff', 27016, 1), event('refreshdebuff', 27016, 7)]));
  const finding = result.findings.find(value => value.id === 'dot-refresh-serpent-sting');
  assert.ok(finding); assert.match(finding.evidence[0].text, /9 seconds remaining/);
  assert.equal(finding.disposition, 'review');
  assert.equal(finding.category, 'execution');
});

test('stacking Lacerate and set-modified Moonfire are not generic fixed-duration clipping rules', () => {
  for (const [specId, id] of [['DRUID:Guardian', 33745], ['DRUID:Balance', 26988]]) {
    const spec = SPECS.find(s => s.id === specId);
    const result = analyzeDecisions(raw(spec, [event('applydebuff', id, 1), event('refreshdebuff', id, 3)]));
    assert.equal(result.findings.some(f => f.id.startsWith('dot-refresh-')), false);
  }
});

test('the reapplication itself and passive ticks cannot establish active contact throughout a DoT gap', () => {
  const spec = SPECS.find(s => s.id === 'HUNTER:Survival');
  const input = raw(spec, [event('applydebuff', 27016, 1), event('removedebuff', 27016, 16), { ...event('damage', 999, 20), tick: true }, event('cast', 27016, 25), event('applydebuff', 27016, 25)], { incoming: { data: [], complete: true } });
  assert.equal(analyzeDecisions(input).findings.some(f => f.id === 'dot-gap-serpent-sting'), false);
});

test('target swaps and recorded control suppress same-target gap accusations', () => {
  const spec = SPECS.find(value => value.id === 'MAGE:Fire');
  let result = analyzeDecisions(raw(spec, [event('damage', 27070, 1, 99), event('damage', 27070, 10, 100)]));
  assert.equal(result.findings.some(value => value.id === 'same-target-activity'), false);
  const controlled = raw(spec, [event('damage', 27070, 1), event('damage', 27070, 10)], {
    incoming: { complete: true, data: [{ type: 'applydebuff', sourceID: 50, targetID: 7, abilityGameID: 31249, timestamp: 1005000 }, { type: 'removedebuff', sourceID: 50, targetID: 7, abilityGameID: 31249, timestamp: 1009000 }] },
  });
  result = analyzeDecisions(controlled);
  assert.equal(result.findings.some(value => value.id === 'same-target-activity'), false);
});

test('partial events leave decisions unresolved instead of inventing missed use', () => {
  const spec = SPECS.find(value => value.id === 'ROGUE:Assassination');
  const result = analyzeDecisions(raw(spec, [], { events: { complete: false, data: [] } }));
  assert.equal(result.depth.status, 'partial');
  assert.equal(result.findings.length, 0);
  assert.match(result.limitations.join(' '), /Complete outgoing events/);
});

test('healer and tank decision evidence uses demand events, never HPS or DTPS rankings', () => {
  const healer = SPECS.find(value => value.id === 'PRIEST:Holy');
  const healing = raw(healer, [{ ...event('heal', 34861, 4, 22), amount: 4000, overheal: 0 }], { investigation: { raidDamage: { complete: true, scope: 'raid', data: [{ type: 'damage', sourceID: 50, targetID: 22, abilityGameID: 1, amount: 5000, timestamp: 1001000 }] } } });
  const healerResult = analyzeDecisions(healing);
  assert.ok(healerResult.findings.some(value => value.id === 'healing-demand-coverage'));
  assert.equal(healerResult.findings.some(value => /low HPS|HPS ranking/i.test(value.title)), false);
  const tank = SPECS.find(value => value.id === 'DRUID:Guardian');
  const tankResult = analyzeDecisions(raw(tank, [], { damageTakenEvents: { complete: true, data: [{ type: 'damage', targetID: 7, amount: 4000, timestamp: 1001000 }, { type: 'damage', targetID: 7, amount: 5000, timestamp: 1003000 }] } }));
  assert.ok(tankResult.findings.some(value => value.id === 'tank-demand-windows'));
  assert.equal(tankResult.findings.some(value => /DTPS ranking/i.test(value.title)), false);
});

test('healer timing needs scoped raid damage, a recorded health deficit, and positive effective healing', () => {
  const healer = SPECS.find(value => value.id === 'PRIEST:Holy');
  const result = analyzeDecisions(raw(healer, [{ ...event('heal', 34861, 3, 22), amount: 0, overheal: 5000 }, { ...event('heal', 34861, 4, 22), amount: 4000, overheal: 5000 }], {
    investigation: { raidDamage: { complete: true, scope: 'raid', data: [{ type: 'damage', sourceID: 50, targetID: 22, amount: 8000, hitPoints: 12000, maxHitPoints: 20000, timestamp: 1001000 }] } },
  }));
  assert.ok(result.findings.some(value => value.id === 'healer-effective-response'));
  assert.match(result.findings.find(value => value.id === 'healer-effective-response').evidence[0].text, /4000 effective healing/);
  const noScope = analyzeDecisions(raw(healer, [event('heal', 34861, 4, 22)], { investigation: { raidDamage: { complete: true, data: [] } } }));
  assert.equal(noScope.checks.find(value => value.id === 'healing-demand-coverage').status, 'unknown');
});

test('tank defensive aura bands are compared only with repeated boss auto outcomes', () => {
  const tank = SPECS.find(value => value.id === 'WARRIOR:Protection');
  const result = analyzeDecisions(raw(tank, [], {
    tables: { casts: { data: { entries: [] } }, dmg: { data: { entries: [] } }, buffs: { data: { auras: [{ guid: 2565, bands: [{ startTime: 1001000, endTime: 1004000 }] }] } } },
    damageTakenEvents: { complete: true, data: [{ type: 'damage', targetID: 7, sourceID: 50, abilityGameID: 1, amount: 1000, timestamp: 1002000 }, { type: 'damage', targetID: 7, sourceID: 50, abilityGameID: 1, amount: 1100, timestamp: 1005000 }] },
  }));
  assert.ok(result.findings.some(value => value.id === 'tank-defensive-coverage'));
  assert.ok(result.findings.some(value => value.id === 'tank-defensive-uncovered'));
  assert.match(result.findings.find(value => value.id === 'tank-defensive-uncovered').action, /available/);
});

test('assassination recognizes both observed Envenom family IDs and added poison/cooldown observables', () => {
  const spec = SPECS.find(value => value.id === 'ROGUE:Assassination');
  assert.deepEqual(spec.mechanics.find(value => value.id === 'envenom').spellIds, [32645, 32684]);
  assert.ok(spec.mechanics.some(value => value.id === 'deadly-poison'));
  assert.ok(spec.mechanics.some(value => value.id === 'cold-blood'));
  const result = analyzeDecisions(raw(spec, [event('cast', 32684, 2)]));
  assert.ok(result.telemetryObserved.includes('envenom'));
});

test('DEBUFFS cannot become raid damage, removebuff is not a dispel, and all-debuff control is not accepted', () => {
  const healer = SPECS.find(value => value.id === 'PRIEST:Holy');
  const result = analyzeDecisions(raw(healer, [event('removebuff', 17, 2)], { incoming: { complete: true, data: [{ type: 'damage', sourceID: 50, targetID: 22, amount: 1000, timestamp: 1001000 }] } }));
  assert.equal(result.checks.find(value => value.id === 'healing-demand-coverage').status, 'unknown');
  assert.match(result.checks.find(value => value.id === 'utility-events').reason, /0 dispel/);
  const fire = SPECS.find(value => value.id === 'MAGE:Fire');
  const gap = analyzeDecisions(raw(fire, [event('damage', 27070, 1), event('damage', 27070, 10)], { incoming: { complete: true, data: [{ type: 'applydebuff', sourceID: 50, targetID: 7, abilityGameID: 123, timestamp: 1005000 }, { type: 'removedebuff', sourceID: 50, targetID: 7, abilityGameID: 123, timestamp: 1009000 }] } }));
  assert.ok(gap.findings.some(value => value.id === 'same-target-activity'));
});

test('DoT lapse needs same-target activity and full recognized control coverage', () => {
  const spec = SPECS.find(value => value.id === 'HUNTER:Survival');
  const result = analyzeDecisions(raw(spec, [event('applydebuff', 27016, 1), event('removedebuff', 27016, 16), event('damage', 34120, 18), event('refreshdebuff', 27016, 21)], { incoming: { complete: true, data: [] } }));
  assert.ok(result.findings.some(value => value.id === 'dot-gap-serpent-sting'));
  assert.match(result.findings.find(value => value.id === 'dot-gap-serpent-sting').action, /target will live/);
});

test('Envenom consumption cannot become a generic Deadly Poison lapse', () => {
  const spec = SPECS.find(value => value.id === 'ROGUE:Assassination');
  const result = analyzeDecisions(raw(spec, [event('applydebuff', 27187, 80), event('cast', 32684, 88), event('removedebuff', 27187, 88), event('damage', 34413, 92), event('applydebuff', 27187, 99)], { incoming: { complete: true, data: [] } }));
  assert.equal(result.findings.some(value => value.id === 'dot-gap-deadly-poison'), false);
  assert.equal(spec.mechanics.find(value => value.id === 'deadly-poison').duration, undefined);
});

test('cast pairing rejects target changes and intervening or failed casts', () => {
  const spec = SPECS.find(value => value.id === 'MAGE:Fire');
  const stream = [event('begincast', 27070, 1, 99), event('cast', 27070, 4, 99), event('castfailed', 1, 5, 99), event('begincast', 27070, 6, 99), event('cast', 27070, 9, 100)];
  const result = analyzeDecisions(raw(spec, stream, { incoming: { complete: true, data: [] } }));
  assert.equal(result.checks.find(value => value.id === 'cast-chain-decision').status, 'unknown');
});
