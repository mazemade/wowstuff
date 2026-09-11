'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { utopikReport } = require('./fixtures/evaluation/recorded-coaching.cjs');
const { combinedEvidence } = require('./evaluation-service');
const { buildFightCoaching } = require('./evaluation-coaching');
const { evaluateFight } = require('./evaluation-sim');
const report = utopikReport();
const byBoss = name => report.fights.find(f => f.name === name);
const execution = name => byBoss(name).coaching.improvements.filter(f => f.category !== 'equipment').map(f => f.id);

test('recorded Utopik report produces the human-review priority actions, without a simulation', () => {
    assert.deepEqual(execution('Rage Winterchill'), ['rogue-snd-midfight-gap']);
    assert.deepEqual(execution('Anetheron'), []);
    assert.deepEqual(execution("Kaz'rogal"), ['stomp-potion-timing']);
    assert.deepEqual(new Set(execution('Azgalor')), new Set(['trinket-window-29383', 'rain-of-fire-exposure']));
    assert.deepEqual(new Set(execution('Archimonde')), new Set(['late-demonslaying', 'rogue-deadly-five-stack-expiry']));
    for (const item of report.coaching.improvements) { assert.ok(item.why && item.change && item.verification && item.evidence.length); assert.equal(item.gainDps, undefined); }
});
test('recorded rogue analysis preserves good retries, control context and independent named cadence comparison', () => {
    assert.ok(byBoss('Azgalor').coaching.keeps.some(f => /Cold Blood survived/.test(f.what)));
    assert.ok(byBoss('Archimonde').coaching.keeps.some(f => /Control effects/.test(f.what)));
    assert.ok(byBoss('Anetheron').coaching.keeps.some(f => /Mutilate frequency is not lower than Revànx/.test(f.what)));
    assert.notEqual(byBoss('Anetheron').damageAnalysis.reference.name, 'Utopik');
    assert.notEqual(byBoss('Azgalor').damageAnalysis.reference.name, 'Utopik');
    const poison = byBoss('Archimonde').coaching.improvements.find(f => f.id === 'rogue-deadly-five-stack-expiry');
    assert.ok(poison.evidence.some(e => /25 white outcomes/.test(e.text)));
    assert.ok(byBoss('Anetheron').coaching.reviews.some(f => f.id === 'rogue-deadly-five-stack-expiry'));
});
test('night plan prioritizes actual encounter changes and retains per-boss evidence', () => {
    assert.ok(report.coaching.topChanges.every(c => c.bosses.length && c.occurrences.length));
    assert.ok(report.coaching.topChanges.slice(0, 3).every(c => c.priority === 'high'));
    assert.equal(report.fights.every(f => f.coverage.depth.status === 'partial'), true, 'observed spells cannot mean complete expertise');
});
test('Fury and Retribution keep their existing execution findings in the coaching layer', () => {
    const fury = require('./fixtures/evaluation/culuneta.json').winterchill;
    const furyCoaching = buildFightCoaching({ name: 'Rage Winterchill', ...combinedEvidence(fury) });
    assert.ok(furyCoaching.improvements.some(f => f.id === 'battle-shout-gap'));
    const ret = require('./fixtures/evaluation/varenthil-ret.json');
    const raw = require('./fixtures/evaluation/inflate-paladin.cjs').inflate(ret.own, ret.reference);
    const result = combinedEvidence(raw);
    const coaching = buildFightCoaching(result);
    const actual = result.findings.filter(f => f.category === 'execution' && ['ret-post-judgement-seal', 'ret-seal-at-swing', 'ret-seal-twist-execution'].includes(f.id));
    assert.ok(actual.length); assert.ok(actual.every(f => coaching.improvements.some(c => c.id === f.id)));
});
test('detailed talents do not bypass the unvalidated Assassination finisher model', async () => {
    const raw = structuredClone(require('./fixtures/evaluation/utopik-investigation.json').fights[0]);
    raw.modelOverrides = { talentsString: '0053201252-023305200005015002321151' };
    const result = await evaluateFight(raw);
    assert.notEqual(result.status, 'complete'); assert.deepEqual(result.actions, []);
    assert.match(result.reason, /poison, Rupture and Envenom/);
});
test('recorded fixtures carry reference combatant info, buff bands and gear audits', () => {
    const utopik = require('./fixtures/evaluation/utopik-investigation.json').fights[0];
    assert.ok(utopik.tables.ci && utopik.gearAudit && utopik.context.debuffs, 'own snapshot, audit and debuffs');
    const jofrey = utopik.references.find(r => r.player.name === 'Jofrey');
    assert.ok(jofrey.tables.ci && jofrey.tables.buffs && jofrey.gearAudit && jofrey.context.dmgAll, 'reference snapshot, bands, audit, totals');
    assert.equal(jofrey.gearAudit.slots.find(s => s.label === 'Main hand').stats[24], 21);
    const funkell = require('./fixtures/evaluation/funkell-hunter.json').fights.find(f => f.name === 'Archimonde');
    assert.ok(funkell.tables.ci && funkell.references[0].tables.ci && funkell.references[0].gearAudit);
});
test('recorded Utopik Winterchill leads with the budget and names every source behind the melee bucket', () => {
    const w = byBoss('Rage Winterchill');
    assert.equal(w.budget.status, 'decomposed'); assert.equal(Math.round(w.budget.gapDps), 269); // real capture: 268.54 rounds to 269 (brief's worked example said 268; see evaluation-budget.test.js:15)
    const ids = w.coaching.buckets.flatMap(b => b.items.map(i => i.id));
    for (const id of ['stat-expertise', 'luck-melee-miss', 'aura-flask', 'aura-25898', 'uptime-30807', 'proc-28830', 'rogue-snd-midfight-gap']) assert.ok(ids.includes(id), id);
    const melee = w.coaching.buckets.find(b => b.id === 'melee');
    assert.equal(melee.items.find(i => i.id === 'rogue-snd-midfight-gap').size.kind, 'bound');
    assert.equal(melee.items.find(i => i.id === 'stat-expertise').size.kind, 'unsized', 'no simulator in the recorded replay');
    assert.ok(!w.findings.some(f => f.id.startsWith('damage-driver-') || f.id === 'comparison-equipment'), 'legacy driver cards are superseded');
    assert.match(w.coaching.assessment, /1546 DPS against Jofrey's 1815/);
});
test('recorded Utopik Anetheron states the execution headline and the expertise gear action', () => {
    const a = byBoss('Anetheron');
    assert.match(a.budget.headline || '', /matched .* with more stats/);
    assert.ok(a.causes.some(c => c.id === 'stat-expertise' && /Fang of Vashj|Mooyootoo/.test(c.evidence.map(e => e.text).join(' '))));
});
test('recorded Funkell Archimonde bounds the pet bucket', () => {
    const raw = structuredClone(require('./fixtures/evaluation/funkell-hunter.json').fights.find(f => f.name === 'Archimonde'));
    const fight = { name: 'Archimonde', durationSec: 231.3, ...combinedEvidence(raw), pricing: { status: 'unavailable', prices: {} } };
    const coaching = buildFightCoaching(fight);
    const pet = coaching.buckets.find(b => b.id === 'pet-damage');
    assert.ok(pet, 'pet bucket'); assert.equal(pet.items[0].id, 'hunter-pet-survival'); assert.equal(pet.items[0].size.kind, 'bound');
    assert.ok(pet.items[0].size.dps > 150 && pet.items[0].size.dps <= Math.abs(pet.differenceDps), 'bound between 150 and the bucket difference: ' + pet.items[0].size.dps);
});
test('recorded Funkell Kaz\'rogal bounds an expired Kill Command opportunity inside the pet bucket', () => {
    const raw = structuredClone(require('./fixtures/evaluation/funkell-hunter.json').fights.find(f => f.name === "Kaz'rogal"));
    const f = raw.context.fights.find(x => x.id === raw.fightId) || raw.context.fights[0];
    const durationSec = (f.endTime - f.startTime) / 1000;
    const fight = { name: "Kaz'rogal", durationSec, ...combinedEvidence(raw), pricing: { status: 'unavailable', prices: {} } };
    const coaching = buildFightCoaching(fight);
    const pet = coaching.buckets.find(b => b.id === 'pet-damage');
    assert.ok(pet, 'pet bucket');
    const kc = pet.items.find(i => i.id === 'hunter-kill-command');
    assert.ok(kc, 'hunter-kill-command in the pet bucket');
    assert.equal(kc.size.kind, 'bound');
    assert.ok(kc.size.dps > 5, 'about 2 attempts x ~671 over ~182s ~= 7.4 DPS: ' + kc.size.dps);
});
