'use strict';
const assert = require('node:assert/strict');
const { analyzeFight } = require('./evaluation-evidence');
const fixture = require('./fixtures/evaluation/culuneta.json');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const copy = x => JSON.parse(JSON.stringify(x));
const find = (out, id) => out.findings.find(f => f.id === id);
const row = (out, name) => out.comparison.find(r => r.name === name);
const setBuffs = (raw, values) => { raw.tables.buffs = { data: { auras: values } }; };
function tiny() {
    return { reportCode: 'example', fightId: 1, sourceId: 4, name: 'Player', player: { classToken: 'WARRIOR', spec: 'Fury' },
        context: { fights: [{ id: 1, name: 'Anetheron', startTime: 100000, endTime: 140000 }] },
        tables: { dmg: { data: { entries: [] } }, buffs: { data: { auras: [] } } },
        events: { complete: true, data: [0, 5, 15, 20, 30, 35].map(s => ({ type: 'damage', timestamp: 100000 + s * 1000, sourceID: 4, abilityGameID: 1 })) },
        incoming: { complete: true, data: [] } };
}
test('Anetheron reproduces the real 904 DPS difference and actual Heroic Strike outcomes', () => {
    const out = analyzeFight(fixture.anetheron);
    assert.equal(out.observed.dps, 1650.6); assert.equal(out.observed.referenceDps, 2555); assert.equal(out.observed.gapDps, 904.4);
    assert.deepEqual([row(out, 'Heroic Strike attempts').player, row(out, 'Heroic Strike attempts').reference], [34, 35]);
    assert.deepEqual([row(out, 'Heroic Strike critical hits').player, row(out, 'Heroic Strike critical hits').reference], [12, 23]);
    assert.deepEqual([row(out, 'Heroic Strike dodges').player, row(out, 'Heroic Strike dodges').reference], [3, 0]);
    assert.equal(row(out, 'Heroic Strike damage').player, 474.1);
    assert.match(row(out, 'Heroic Strike attempts').note, /Dakkone/);
});
test('Anetheron does not invent a Shout gap, contact fault, downrank or rage error', () => {
    const out = analyzeFight(fixture.anetheron);
    for (const id of ['battle-shout-gap', 'melee-contact-gaps', 'recklessness-contact']) assert.equal(find(out, id), undefined);
    assert.equal(row(out, 'Battle Shout coverage').player, 100);
    assert(!out.findings.some(f => /downrank|wrong rank|press.*heroic|rage.cap|starv|incorrect.*talent/i.test(f.title + f.action)));
    assert(out.limitations.some(x => /Rage telemetry/.test(x)));
    assert(out.findings.every(f => f.gainDps === null));
});
test('real Winterchill identifies a 39-second Shout hole and 12 seconds of Recklessness during gaps', () => {
    const out = analyzeFight(fixture.winterchill);
    const shout = find(out, 'battle-shout-gap');
    assert(shout); assert.equal(shout.evidence[0].startSec, 17.9); assert.equal(shout.evidence[0].endSec, 56.9);
    assert.match(find(out, 'recklessness-contact').title, /12 seconds/);
    assert.equal(out.timeline.filter(x => x.kind === 'contact-gap').length, 2);
    assert.equal(find(out, 'melee-contact-gaps').owner, 'context');
    assert.match(find(out, 'melee-contact-gaps').action, /does not prove.*avoidable/);
});
test('spell IDs distinguish Dragonstrike from a potion and Death Wish from the mislabeled Bloodbath', () => {
    const out = analyzeFight(fixture.winterchill);
    assert(find(out, 'haste-potion'));
    assert(out.timeline.some(x => x.label === 'Death Wish'));
    assert(!out.timeline.some(x => x.label === 'Bloodbath'));
    const raw = copy(fixture.winterchill);
    raw.tables.buffs.data.auras.push({ guid: 28507, name: 'Wrong label', totalUptime: 15000, bands: [{ startTime: 1857557, endTime: 1872557 }] });
    assert.equal(find(analyzeFight(raw), 'haste-potion'), undefined);
});
test('Major Agility is recognized and demon advice is encounter-specific', () => {
    const demon = analyzeFight(fixture.anetheron), undead = analyzeFight(fixture.winterchill);
    assert.equal(row(demon, 'Major Agility coverage').player, 100);
    assert.equal(row(undead, 'Major Agility coverage').player, 100);
    assert(find(demon, 'demonslaying-elixir')); assert.equal(find(undead, 'demonslaying-elixir'), undefined);
    assert(!demon.findings.some(f => /no offensive consumable|no flask/i.test(f.title + f.action)));
});
test('unenchanted boots and absent party support are observed preparation facts with no assigned gains', () => {
    const out = analyzeFight(fixture.anetheron);
    assert(find(out, 'boots-enchant')); assert.equal(find(out, 'support-24932').owner, 'raid'); assert.equal(find(out, 'support-30807').owner, 'raid');
    assert.equal(row(out, 'Leader of the Pack coverage').player, 0);
    assert(row(out, 'Leader of the Pack coverage').reference > 95);
    const raw = copy(fixture.anetheron); raw.tables.ci.data[0].gear[7].permanentEnchant = 2657;
    assert.equal(find(analyzeFight(raw), 'boots-enchant'), undefined);
});
test('missing buff data never becomes evidence that buffs or potions were absent', () => {
    const raw = copy(fixture.anetheron); delete raw.tables.buffs;
    const out = analyzeFight(raw);
    for (const id of ['support-24932', 'support-30807', 'haste-potion', 'battle-shout-gap', 'demonslaying-elixir']) assert.equal(find(out, id), undefined);
    assert(out.limitations.some(x => /Buff coverage is unavailable/.test(x)));
});
test('partial outgoing streams cannot produce contact or cooldown-overlap findings', () => {
    const raw = copy(fixture.winterchill); raw.events.complete = false;
    const out = analyzeFight(raw);
    assert.equal(find(out, 'melee-contact-gaps'), undefined); assert.equal(find(out, 'recklessness-contact'), undefined);
    assert(find(out, 'battle-shout-gap'), 'Complete buff table still supports independent evidence');
});
test('overlapping stuns and slows count as a union rather than adding durations', () => {
    const raw = tiny();
    for (const [spell, from, to] of [[31480, 8, 13], [31477, 6, 12], [31480, 22, 27]]) {
        raw.incoming.data.push({ type: 'applydebuff', timestamp: 100000 + from * 1000, targetID: 4, sourceID: 99, abilityGameID: spell },
            { type: 'removedebuff', timestamp: 100000 + to * 1000, targetID: 4, sourceID: 99, abilityGameID: spell });
    }
    const out = analyzeFight(raw);
    assert.match(find(out, 'control-exposure').title, /12 seconds/); // 6–13 plus22–27
    assert.match(find(out, 'melee-contact-gaps').evidence.at(-1).text, /overlap 12 seconds/);
    assert.equal(out.timeline.filter(x => x.kind === 'mechanic').length, 3);
});
test('partial incoming streams do not assign causes to melee gaps', () => {
    const raw = tiny(); raw.incoming.complete = false;
    raw.incoming.data.push({ type: 'applydebuff', timestamp: 108000, targetID: 4, abilityGameID: 31480 });
    const out = analyzeFight(raw);
    assert.equal(find(out, 'control-exposure'), undefined); assert(find(out, 'melee-contact-gaps'));
    assert(out.limitations.some(x => /Incoming events are incomplete/.test(x)));
});
test('other players attacks and periodic ticks do not fill this players contact gap', () => {
    const raw = tiny();
    raw.events.data.push({ type: 'damage', timestamp: 110000, sourceID: 5, abilityGameID: 1 },
        { type: 'damage', timestamp: 111000, sourceID: 4, abilityGameID: 12721 });
    const out = analyzeFight(raw);
    assert.equal(out.timeline.filter(x => x.kind === 'contact-gap').length, 2);
});
test('buff bands clip to fight bounds, merge overlaps and ignore sub-three-second rounding holes', () => {
    const raw = tiny();
    setBuffs(raw, [{ guid: 2048, bands: [{ startTime: 99000, endTime: 125000 }, { startTime: 120000, endTime: 139999 }] }]);
    const out = analyzeFight(raw);
    assert.equal(find(out, 'battle-shout-gap'), undefined); assert.equal(row(out, 'Battle Shout coverage').player, 100);
});
test('missing aura bands do not create invented timestamped Shout gaps', () => {
    const raw = tiny(); setBuffs(raw, [{ guid: 2048, totalUptime: 10000 }]);
    assert.equal(find(analyzeFight(raw), 'battle-shout-gap'), undefined);
});
test('cross-spec references are excluded and Fury coaching never leaks to other specs', () => {
    const raw = copy(fixture.anetheron); raw.references[0].context.dmgAll.data.entries[0].icon = 'Warrior-Arms';
    assert.equal(analyzeFight(raw).observed.referenceDps, null);
    raw.player.spec = 'Arms'; const out = analyzeFight(raw);
    assert(!out.findings.some(f => /support-|haste-potion|battle-shout|recklessness|demonslaying/.test(f.id)));
    assert(out.limitations.some(x => /Fury-specific advice/.test(x)));
});
test('reference selection retains one real duration-matched player, never synthetic abilities', () => {
    const raw = copy(fixture.anetheron), other = copy(raw.references[0]); other.name = 'Slower reference';
    other.context.fights[0].endTime += 60000; other.tables.dmg.data.entries.find(x => x.guid === 29707).critHitCount = 2;
    raw.references.unshift(other);
    const out = analyzeFight(raw);
    assert.equal(row(out, 'Heroic Strike critical hits').reference, 23); assert.match(row(out, 'Heroic Strike critical hits').note, /Dakkone/);
    assert(find(out, 'reference-context').evidence[1].url.includes('MRHdBZvVXfh4826n'));
});
test('missing timestamps and empty input stay explicitly unknown and JSON serializable', () => {
    const out = analyzeFight({});
    assert.deepEqual(out.observed, { dps: null, referenceDps: null, gapDps: null });
    assert.equal(out.timeline.length, 0); assert.equal(out.findings.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});
test('a normal 21/40/0 build and the correct Heroic Strike29707 receive no speculative correction', () => {
    const raw = copy(fixture.anetheron); raw.tables.ci.data[0].talents = [{ id: 21 }, { id: 40 }, { id: 0 }];
    for (const x of raw.tables.dmg.data.entries) if (x.guid === 29707) x.total = 1;
    const out = analyzeFight(raw);
    assert(!out.findings.some(f => /rank|talent|rampage|heroic strike/i.test(f.title + f.action)));
});
test('boss display names do not replace the actual character in evidence', () => {
    const raw = copy(fixture.anetheron); raw.name = 'Anetheron';
    const out = analyzeFight(raw);
    assert.match(find(out, 'reference-context').evidence[0].text, /^Culuneta:/);
});
test('multiple sources of one control effect merge correctly without creating time before the apply', () => {
    const raw = tiny();
    for (const [sourceID, from, to] of [[90, 8, 12], [91, 10, 14]]) {
        raw.incoming.data.push({ type: 'applydebuff', timestamp: 100000 + from * 1000, targetID: 4, sourceID, abilityGameID: 31480 },
            { type: 'removedebuff', timestamp: 100000 + to * 1000, targetID: 4, sourceID, abilityGameID: 31480 });
    }
    raw.incoming.data.push({ type: 'removedebuff', timestamp: 105000, targetID: 4, sourceID: 92, abilityGameID: 31480 });
    const out = analyzeFight(raw);
    assert.match(find(out, 'control-exposure').title, /6 seconds/);
});
test('analysis does not mutate source evidence', () => {
    const raw = copy(fixture.winterchill), before = JSON.stringify(raw);
    analyzeFight(raw); assert.equal(JSON.stringify(raw), before);
});
console.log(passed + ' evaluation evidence tests passed');
