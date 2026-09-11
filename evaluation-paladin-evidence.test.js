'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzePaladin } = require('./evaluation-paladin-evidence.js');
const captured = require('./fixtures/evaluation/varenthil-ret.json');

const clone = value => JSON.parse(JSON.stringify(value));
const { inflate } = require('./fixtures/evaluation/inflate-paladin.cjs');

const capturedVarenthil = inflate(captured.own, captured.reference);

test('captured Varenthil pull identifies Ret execution evidence without grading Blood aura uptime', () => {
    const result = analyzePaladin(capturedVarenthil);
    const twist = result.checks.find(check => check.id === 'ret-seal-twist');
    assert.equal(twist.status, 'checked');
    assert.match(twist.reason, /12 of 14 observed Command-to-Blood\/Martyr applications/);
    assert.match(twist.reason, /4 of 7 Command damage procs/);

    const twistFinding = result.findings.find(finding => finding.id === 'ret-seal-twist-execution');
    assert.equal(twistFinding.priority, 'high');
    assert.equal(twistFinding.category, 'execution');
    assert.match(twistFinding.action, /final 0\.4 seconds/);
    assert.match(twistFinding.action, /do not chase 100% Blood uptime/);
    assert.equal(result.findings.some(finding => /47\.9%|low.*Blood|Blood.*coverage/i.test(finding.title)), false);
    assert.ok(twistFinding.evidence.some(item => /during Frost Nova/.test(item.text)));
});

test('captured Varenthil pull reports actual Crusader Strike, Judgement and cooldown timing', () => {
    const result = analyzePaladin(capturedVarenthil);
    assert.deepEqual(result.comparison.find(row => row.name === 'Crusader Strike casts'), {
        name: 'Crusader Strike casts', player: 16, reference: 20, unit: 'casts',
        note: 'Button presses from complete cast events. The simulator implements a six-second cooldown.',
    });
    const crusader = result.findings.find(finding => finding.id === 'ret-crusader-strike-cadence');
    assert.match(crusader.title, /^1 Crusader Strike cadence window needs replay review$/);
    assert.equal(crusader.category, 'context');
    assert.equal(crusader.priority, 'medium');
    assert.ok(crusader.evidence.some(item => item.startSec === 27.9 && item.endSec === 33.8 && /Frost Nova.*Icebolt/.test(item.text)));

    assert.equal(result.comparison.find(row => row.name === 'Judgement casts').player, 11);
    assert.equal(result.comparison.find(row => row.name === 'Judgement casts').reference, 12);
    assert.equal(result.comparison.find(row => row.name === 'Shortest observed Judgement interval').player, 8);
    assert.match(result.checks.find(check => check.id === 'ret-cooldown-window').reason, /100% of Avenging Wrath overlapped/);
    assert.ok(result.timeline.some(item => item.label === 'Avenging Wrath' && item.startSec === 29 && item.endSec === 49));
    assert.ok(result.timeline.some(item => item.label === 'Bloodlust' && item.startSec === 26.7 && item.endSec === 66.7));
});

test('captured aura state exposes white swings before resealing and keeps control context attached', () => {
    const result = analyzePaladin(capturedVarenthil);
    const finding = result.findings.find(item => item.id === 'ret-post-judgement-seal');
    assert.equal(finding.priority, 'high');
    assert.match(finding.title, /^White swings occurred/);
    assert.match(finding.action, /clean 146\.6–149\.8s reseal window first/);
    assert.ok(finding.evidence.some(item => item.startSec === 27.5 && item.endSec === 35.3 && /29\.3, 32\.9, 35\.1s/.test(item.text) && /Frost Nova and Icebolt/.test(item.text)));
    assert.ok(finding.evidence.some(item => item.startSec === 146.6 && item.endSec === 149.8 && /2 white-swing outcomes/.test(item.text)));
    assert.equal(result.comparison.find(row => row.name === 'White-swing outcomes before resealing after Judgement').reference, 0);
});

test('melee gaps name only verified hostile effects and preserve the unallocated portion', () => {
    const raw = clone(capturedVarenthil);
    raw.incoming.data.push(
        { timestamp: raw.context.fights[0].startTime + 38000, type: 'applydebuff', sourceID: 42, targetID: 37, abilityGameID: 999001 },
        { timestamp: raw.context.fights[0].startTime + 61000, type: 'removedebuff', sourceID: 42, targetID: 37, abilityGameID: 999001 },
    );
    const result = analyzePaladin(raw);
    const check = result.checks.find(item => item.id === 'ret-melee-contact');
    assert.match(check.reason, /20\.8 seconds overlapped recorded hostile debuffs/);
    const finding = result.findings.find(item => item.id === 'ret-melee-contact-gaps');
    assert.ok(finding.evidence.some(item => /13\.9s overlapped Death & Decay and Frost Nova/.test(item.text)));
    assert.equal(finding.evidence.some(item => /999001/.test(item.text)), false, 'friendly player debuffs are not classified as hostile');
    assert.match(finding.action, /shorten only the portion the replay confirms was avoidable/);
});

test('incomplete and off-pull streams cannot manufacture Ret absence or cadence claims', () => {
    const incomplete = clone(capturedVarenthil);
    incomplete.events.complete = false;
    const unknown = analyzePaladin(incomplete);
    assert.equal(unknown.findings.length, 0);
    assert.equal(unknown.checks.find(check => check.id === 'ret-seal-twist').status, 'unknown');

    const bounded = clone(capturedVarenthil);
    const start = bounded.context.fights[0].startTime, end = bounded.context.fights[0].endTime;
    bounded.events.data.push(
        { timestamp: start - 1000, type: 'cast', sourceID: 37, abilityGameID: 35395 },
        { timestamp: end + 1000, type: 'cast', sourceID: 37, abilityGameID: 35395 },
    );
    assert.equal(analyzePaladin(bounded).comparison.find(row => row.name === 'Crusader Strike casts').player, 16);
});

test('short or incompletely contextualized fights never receive a hardcoded clean reseal window', () => {
    const short = clone(capturedVarenthil);
    short.context.fights[0].endTime = short.context.fights[0].startTime + 113000;
    const shortFinding = analyzePaladin(short).findings.find(item => item.id === 'ret-post-judgement-seal');
    assert.equal(shortFinding.priority, 'medium');
    assert.equal(shortFinding.category, 'context');
    assert.doesNotMatch(shortFinding.action, /146\.6|149\.8/);

    const unknown = clone(capturedVarenthil);
    unknown.incoming.complete = false;
    const unknownFinding = analyzePaladin(unknown).findings.find(item => item.id === 'ret-post-judgement-seal');
    assert.equal(unknownFinding.priority, 'medium');
    assert.doesNotMatch(unknownFinding.action, /Practice the clean/);
});

test('non-Retribution players do not receive Ret evidence', () => {
    const raw = clone(capturedVarenthil);
    raw.player.spec = 'Protection';
    assert.deepEqual(analyzePaladin(raw), { findings: [], comparison: [], timeline: [], checks: [], limitations: [] });
});

test('seal state at white outcomes identifies repeated Command-only swings, including faction equivalents', () => {
    const result = analyzePaladin(capturedVarenthil);
    assert.match(result.checks.find(row => row.id === 'ret-seal-at-swing').reason, /23 of 41.*11 had Command alone; 7 had no recorded seal/);
    assert.equal(result.comparison.find(row => row.name === 'White outcomes with Blood/Martyr active').reference, 56);
    const finding = result.findings.find(row => row.id === 'ret-seal-at-swing');
    assert.equal(finding.priority, 'high');
    assert.equal(finding.gainDps, null);
    const samples = finding.evidence.filter(row => row.text.startsWith('White outcome'));
    assert.equal(new Set(samples.map(row => row.text)).size, samples.length);

    const strong = analyzePaladin(inflate(captured.reference));
    assert.equal(strong.findings.find(row => row.id === 'ret-seal-at-swing')?.priority, 'medium');
    assert.match(strong.checks.find(row => row.id === 'ret-seal-at-swing').reason, /56 of 57/);
});

test('missing or malformed aura bands leave swing seal state unknown', () => {
    for (const bands of [undefined, [{ startTime: 'bad', endTime: 42 }], [{ startTime: 42, endTime: 41 }]]) {
        const raw = clone(capturedVarenthil);
        raw.tables.buffs.data.auras.find(row => row.guid === 31892).bands = bands;
        const result = analyzePaladin(raw);
        assert.equal(result.checks.find(row => row.id === 'ret-seal-at-swing').status, 'unknown');
        assert.equal(result.findings.some(row => row.id === 'ret-seal-at-swing'), false);
    }
});
