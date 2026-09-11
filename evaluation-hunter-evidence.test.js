'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHunter, validMana } = require('./evaluation-hunter-evidence');
const { buildFightCoaching, buildNightCoaching } = require('./evaluation-coaching');
const { analyzeDamage } = require('./evaluation-damage-analysis');
const recorded = require('./fixtures/evaluation/funkell-hunter.json');
const raw = name => structuredClone(recorded.fights.find(r => r.name === name));
const finding = (r, id) => analyzeHunter(r).findings.find(f => f.id === id);

test('recorded Funkell pet deaths become specific recovery and ground-damage advice', () => {
    const az = finding(raw('Azgalor'), 'hunter-pet-survival');
    assert.match(az.title, /2 pet deaths; 44.2 seconds/);
    assert.match(az.action, /Recall the pet/);
    assert.match(az.action, /Mend Pet/);
    assert.ok(az.evidence.some(e => /Unquenchable Flames/.test(e.text)));
    assert.ok(az.evidence.some(e => e.startSec === 84.4 && e.endSec === 102.3));
    const arch = finding(raw('Archimonde'), 'hunter-pet-survival');
    assert.match(arch.title, /3 pet deaths/);
    assert.ok(arch.evidence.some(e => /Doomfire/.test(e.text)));
    assert.ok(arch.evidence.some(e => /no further pet damage/.test(e.text)));
    assert.ok(arch.evidence.some(e => /3.2 seconds later/.test(e.text)));
    assert.match(arch.why, /same pet-survival issue/);
    assert.equal(arch.gainDps, undefined);
});

test('shared opening deaths are a pull plan and Feign Death is not an actual death', () => {
    const r = raw('Rage Winterchill');
    const result = finding(r, 'hunter-pull-survival');
    assert.match(result.actionTitle, /Misdirection/);
    assert.equal(result.basis, 'practice');
    assert.equal(result.evidence.filter(e => /Player death/.test(e.text)).length, 1);
    for (const e of r.events.data) if (e.type === 'death') e.feign = true;
    assert.equal(finding(r, 'hunter-pet-survival')?.disposition, 'keep');
    assert.equal(finding(r, 'hunter-pull-survival'), undefined);
});

test('Kaz shot and command advice is conditional practice, never an invented mana/DPS loss', () => {
    const r = raw("Kaz'rogal");
    const result = analyzeHunter(r);
    const shot = result.findings.find(f => f.id === 'hunter-shot-rhythm');
    assert.match(shot.title, /5 long Steady Shot gaps/);
    assert.ok(shot.evidence.some(e => e.startSec === 50.1 && e.endSec === 68.8 && /10 Auto/.test(e.text)));
    assert.equal(shot.basis, 'practice');
    assert.match(shot.action, /able to spend mana/);
    assert.ok(shot.alternatives.some(a => /malformed/.test(a)));
    const kc = result.findings.find(f => f.id === 'hunter-kill-command');
    assert.match(kc.title, /^2 refreshed/);
    assert.deepEqual(kc.evidence.map(e => [e.startSec, e.endSec]), [[51.8, 55.7], [79.1, 86.1]]);
    assert.equal(kc.basis, 'practice');
    assert.match(kc.action, /\/cast Kill Command/);
    assert.ok(result.findings.some(f => f.id === 'hunter-bestial-wrath-reuse' && f.disposition === 'keep'));
    assert.ok(result.checks.some(c => c.id === 'hunter-mana-validation' && c.status === 'unknown'));
    assert.ok(result.findings.every(f => f.gainDps === undefined));
});

test('unavailable streams, controls, actual low mana and other specs cannot trigger shot practice', () => {
    let r = raw("Kaz'rogal");
    r.events.complete = false;
    assert.deepEqual(analyzeHunter(r).findings, []);
    r = raw("Kaz'rogal"); r.incoming.complete = false;
    assert.equal(finding(r, 'hunter-shot-rhythm'), undefined);
    assert.equal(finding(r, 'hunter-kill-command'), undefined);
    r = raw("Kaz'rogal");
    r.incoming.data = [{ type: 'applydebuff', abilityGameID: 31480, targetID: r.sourceId, timestamp: r.context.fights[0].startTime }];
    assert.equal(finding(r, 'hunter-shot-rhythm'), undefined);
    r = raw("Kaz'rogal");
    for (const e of r.events.data.filter(e => e.sourceID === r.sourceId)) {
        e.resourceActor = 1; e.classResources = [{ type: 0, amount: 0, max: 6000 }];
    }
    assert.equal(finding(r, 'hunter-shot-rhythm'), undefined);
    assert.equal(finding(r, 'hunter-kill-command'), undefined);
    r.player.classToken = 'ROGUE';
    assert.deepEqual(analyzeHunter(r).findings, []);
});

test('the same evidence works for renamed players and pets; another owner does not donate deaths', () => {
    const r = raw('Azgalor'); r.player.name = 'Anotherhunter';
    r.context.masterData.actors.forEach(a => { a.name = 'Renamed'; });
    assert.match(finding(r, 'hunter-pet-survival').title, /2 pet deaths/);
    r.context.masterData.actors.forEach(a => { if (a.petOwner) a.petOwner = 9999; });
    r.tables.dmg.data.entries = r.tables.dmg.data.entries.filter(row => !row.composite);
    assert.equal(finding(r, 'hunter-pet-survival'), undefined);
});

test('owned traps cannot end a combat-pet death interval or provide Kill Command contact', () => {
    const r = raw('Archimonde');
    const before = finding(r, 'hunter-pet-survival');
    const death = r.events.data.find(e => e.type === 'death' && e.targetID === 26);
    r.events.data.push({ timestamp: death.timestamp + 1000, type: 'damage', sourceID: 48,
        targetID: 120, abilityGameID: 13812, amount: 200 });
    const after = finding(r, 'hunter-pet-survival');
    assert.deepEqual(after, before);
});

test('later critical shots refresh the opportunity and a command consumes the entire cluster', () => {
    const r = raw("Kaz'rogal"), start = r.context.fights[0].startTime;
    // The recorded 49.2 and 50.7 crits form one opportunity, ready at 51.8.
    // Consuming it at 54s leaves only one expired cluster, below the practice threshold.
    r.events.data.push({ timestamp: start + 54000, type: 'cast', sourceID: r.sourceId,
        targetID: 98, abilityGameID: 34026 });
    const result = analyzeHunter(r);
    assert.equal(result.findings.some(f => f.id === 'hunter-kill-command'), false);
    assert.match(result.checks.find(c => c.id === 'hunter-kill-command').reason, /^1 refreshed/);
});

test('pet names reconcile as one damage family without double counting composite children', () => {
    const r = raw('Archimonde');
    const analysis = analyzeDamage(r).damageAnalysis;
    const pets = analysis.rows.filter(row => row.id === 'pet-damage');
    assert.equal(pets.length, 1);
    assert.equal(pets[0].playerDps, Math.round(50916 / ((r.context.fights[0].endTime - r.context.fights[0].startTime) / 1000) * 10) / 10);
    assert.ok(pets[0].referenceDps > 0);
    assert.equal(analysis.rows.some(row => /BugLightyear|Thorbjörn/.test(row.name)), false);
    assert.ok(Math.abs(analysis.residualDps) < 1);
});

test('night advice retains each boss action and prioritizes pet survival over practice', () => {
    const fights = recorded.fights.map(r => ({ name: r.name, ...analyzeHunter(r) }));
    for (const f of fights) f.coaching = buildFightCoaching(f);
    const night = buildNightCoaching({ fights });
    assert.equal(night.topChanges[0].id, 'hunter-pet-survival');
    assert.match(night.topChanges[0].observed, /3 pet deaths/);
    assert.deepEqual(night.topChanges[0].bosses, ['Azgalor', 'Archimonde']);
    assert.ok(night.topChanges[0].occurrences.every(o => o.change && o.verification && o.evidence.length));
    assert.equal(fights.find(f => f.name === 'Anetheron').coaching.improvements.length, 0);
});

test('mana validation never reinterprets malformed positional or target resource fields', () => {
    assert.equal(validMana({ resourceActor: 1, classResources: [{ amount: 7603, max: 0, type: 3202, cost: 5581 }] }), null);
    assert.equal(validMana({ resourceActor: 2, classResources: [{ amount: 1000, max: 6000, type: 0 }] }), null);
    assert.equal(validMana({ resourceActor: 1, classResources: [{ amount: 1000, max: 6000, type: 0 }] }), 1000);
});

test('pet survival findings carry a bucket and an observed-rate measure', () => {
    const arch = finding(raw('Archimonde'), 'hunter-pet-survival');
    assert.equal(arch.bucket, 'pet-damage');
    assert.equal(Math.round(arch.measure.lostSeconds * 10) / 10, 115.7);
    assert.ok(arch.measure.activeRateDps > 300 && arch.measure.activeRateDps < 600, 'pet rate while alive, not over the whole pull: ' + arch.measure.activeRateDps);
    const kc = finding(raw("Kaz'rogal"), 'hunter-kill-command');
    // This fixture's Kill Command casts (34026) never appear as a hunter-sourced damage
    // event, so the observed average is correctly 0, not invented: see task-6-report.md.
    assert.equal(kc.bucket, 'kill command'); assert.equal(kc.measure.lostCasts, 2); assert.equal(kc.measure.averageDamage, 0);
    const steady = finding(raw("Kaz'rogal"), 'hunter-shot-rhythm');
    assert.equal(steady.bucket, 'steady shot'); assert.ok(steady.measure.lostSeconds > 40 && steady.measure.lostSeconds < 60, 'five gaps minus three seconds each: ' + steady.measure.lostSeconds);
    assert.ok(steady.measure.activeRateDps > 364.8, 'rate outside the gaps exceeds the whole-pull 364.8 DPS');
});
