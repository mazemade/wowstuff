'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRogue } = require('./evaluation-rogue-evidence');
const captured = require('./fixtures/evaluation/utopik-azgalor.json');
const clone = value => JSON.parse(JSON.stringify(value));
test('real Utopik capture counts Mutilate parent attempts and Envenom damage attempts', () => {
  const result=analyzeRogue(captured);
  assert.equal(result.checks.find(x=>x.id==='rogue-mutilate-attempts').status,'checked');
  assert.match(result.checks.find(x=>x.id==='rogue-envenom-outcomes').reason,/32684 damage attempts/);
  assert.ok(result.comparison.some(x=>x.name==='Mutilate attempts' && x.note.includes('Parent 34413')));
});
test('a missing stream is unknown and does not invent rogue failures', () => {
  const raw=clone(captured); raw.events.complete=false;
  const result=analyzeRogue(raw); assert.equal(result.checks[0].status,'unknown'); assert.equal(result.findings.length,0);
});
test('natural poison removal is not called an Envenom spend', () => {
  const raw=clone(captured); raw.events.data=raw.events.data.filter(e=>!(e.abilityGameID===32684 && e.type==='damage'));
  const result=analyzeRogue(raw); assert.match(result.checks.find(x=>x.id==='rogue-deadly-consumption').reason,/not simultaneous/);
});
test('Cold Blood dodge followed by landed retry is kept, not blamed', () => {
  const result=analyzeRogue(captured); const finding=result.findings.find(x=>x.id.startsWith('rogue-cold-blood-retry-'));
  assert.ok(finding); assert.equal(finding.disposition,'keep'); assert.equal(finding.owner,'player');
});

test('unrelated crits cannot become a Cold Blood Mutilate conversion', () => {
  const raw = clone(captured), start = raw.context.fights[0].startTime;
  raw.events.data = [
    { type: 'applybuff', abilityGameID: 14177, timestamp: start, sourceID: raw.sourceId, targetID: raw.sourceId },
    { type: 'damage', abilityGameID: 34418, timestamp: start + 100, sourceID: raw.sourceId, targetID: 2, hitType: 2 },
    { type: 'damage', abilityGameID: 34419, timestamp: start + 200, sourceID: raw.sourceId, targetID: 3, hitType: 2 },
    { type: 'removebuff', abilityGameID: 14177, timestamp: start + 5000, sourceID: raw.sourceId, targetID: raw.sourceId },
  ];
  assert.equal(analyzeRogue(raw).findings.some(f => f.id.startsWith('rogue-cold-blood-mutilate')), false);
});

test('continued attacks without any poison reapplication still support recovery advice', () => {
  const raw = clone(require('./fixtures/evaluation/utopik-investigation.json').fights.find(f => f.fightId === 49));
  const start = raw.context.fights[0].startTime;
  const expiry = start + 74821;
  raw.events.data = raw.events.data.filter(e => e.abilityGameID !== 27187 || e.timestamp <= expiry);
  const finding = analyzeRogue(raw).findings.find(f => f.id === 'rogue-deadly-five-stack-expiry');
  assert.equal(finding.disposition, 'improve');
  assert.match(finding.evidence[0].text, /before fight end/);
});
test('compact Utopik multi-boss white bands preserve observed SnD counts', () => {
  const sample=(inside,total)=>({fightId:1,sourceId:5,player:{classToken:'ROGUE'},context:{fights:[{id:1,startTime:0,endTime:400000}]},incoming:{complete:true,data:[]},tables:{buffs:{data:{auras:[{guid:6774,name:'Slice and Dice',bands:[{startTime:0,endTime:inside*1000}]}]}}},events:{complete:true,data:Array.from({length:total},(_,i)=>({timestamp:i*1000,type:'damage',abilityGameID:1,sourceID:5}))}});
  const expected=['211/226','188/196','241/247','272/276','340/346'];
  assert.deepEqual([[211,226],[188,196],[241,247],[272,276],[340,346]].map(pair => analyzeRogue(sample(...pair)).checks.find(x=>x.id==='rogue-snd-attack-coverage').reason.match(/^\d+\/\d+/)[0]),expected);
});
