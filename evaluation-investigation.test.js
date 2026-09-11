'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeInvestigation, requestsFor } = require('./evaluation-investigation');
const { selectReferences } = require('./evaluation-reference');
const { collectInvestigation } = require('./evaluation-service');
const fixture = require('./fixtures/evaluation/utopik-investigation.json');
const pull = id => structuredClone(fixture.fights.find(f => f.fightId === id));
const finding = (raw, id) => analyzeInvestigation(raw).findings.find(f => f.id === id);

test('recorded Archimonde elixir application produces a concrete pre-pull plan', () => {
    const raw = pull(49), f = finding(raw, 'late-demonslaying');
    assert.match(f.title, /103.6 seconds/); assert.equal(f.disposition, 'improve');
    assert.match(f.action, /before the pull/); assert.match(f.verification, /before the first attack/);
    assert.equal(f.gainDps, null);
    raw.tables.buffs.data.auras = raw.tables.buffs.data.auras.filter(b => b.guid !== 11406);
    assert.equal(finding(raw, 'late-demonslaying'), undefined, 'missing aura row cannot prove a missing buff');
});
test('elixir applied during approach is not treated as lost attacking time', () => {
    for (const id of [22, 35, 47]) assert.equal(finding(pull(id), 'late-demonslaying'), undefined);
});
test('Azgalor trinket plan measures buff seconds and verifies readiness', () => {
    const raw = pull(47), f = finding(raw, 'trinket-window-29383');
    assert.match(f.title, /only 8 seconds/); assert.match(f.verification, /12 additional buff seconds/);
    assert.match(f.action, /26.6 seconds/); assert.equal(f.confidence, 'inferred');
    raw.investigation.cooldownHistory.complete = false;
    assert.equal(finding(raw, 'trinket-window-29383'), undefined);
});
test('earlier cooldown use and a shared lock on the second planned use prevent the suggestion', () => {
    const raw = pull(47), start = raw.context.fights[0].startTime;
    raw.investigation.cooldownHistory.data.push({ type: 'cast', sourceID: raw.sourceId, abilityGameID: 35166, timestamp: start + 10000 });
    assert.equal(finding(raw, 'trinket-window-29383'), undefined);
    const other = pull(47);
    other.tables.ci.data[0].gear.push({ id: 29370 }); // Icon shares the on-use trinket category.
    other.investigation.cooldownHistory.data.push({ type: 'cast', sourceID: other.sourceId, abilityGameID: 35163, timestamp: start + 140000 });
    assert.equal(finding(other, 'trinket-window-29383'), undefined);
});
test('FAP absence requires complete raid-scoped evidence; player immunity is insufficient', () => {
    const raw = pull(35), f = finding(raw, 'stomp-potion-timing');
    assert.match(f.why, /3.4 seconds/); assert.match(f.action, /expected stomp/);
    raw.investigation.raidMechanics.scope = 'player';
    assert.equal(finding(raw, 'stomp-potion-timing'), undefined);
    raw.investigation.raidMechanics.scope = 'raid'; raw.investigation.raidMechanics.complete = false;
    assert.equal(finding(raw, 'stomp-potion-timing'), undefined);
});
test('a stomp inside the potion window defeats the mistimed-potion finding', () => {
    const raw = pull(35);
    raw.investigation.raidMechanics.data.push({ timestamp: raw.context.fights[0].startTime + 150000, abilityGameID: 31480, targetID: 99, amount: 2400, type: 'damage' });
    assert.equal(finding(raw, 'stomp-potion-timing'), undefined);
});
test('rain warning counts direct impacts, never lingering burn as continued ground exposure', () => {
    const raw = pull(47), f = finding(raw, 'rain-of-fire-exposure');
    assert.ok(f); assert.match(f.verification, /continue after leaving/);
    raw.damageTakenEvents.data = raw.damageTakenEvents.data.filter(e => e.abilityGameID !== 31340);
    assert.equal(finding(raw, 'rain-of-fire-exposure'), undefined);
});
test('incomplete outgoing data cannot produce timing conclusions', () => {
    const raw = pull(49); raw.events.complete = false;
    assert.equal(finding(raw, 'late-demonslaying'), undefined);
    assert.equal(finding(raw, 'contact-explained'), undefined);
});
test('supplementary collection is bounded and raid query has no player source filter', async () => {
    const raw = pull(35), req = requestsFor(raw).find(r => r.key === 'raidMechanics');
    const got = await collectInvestigation(async (q, v) => {
        assert.doesNotMatch(q, /sourceID/); assert.match(q, /dataType:DamageTaken/);
        assert.equal(v.filter, 'ability.id IN (31480)');
        return { reportData: { report: { events: { data: [], nextPageTimestamp: null } } } };
    }, raw, req);
    assert.equal(got.scope, 'raid'); assert.equal(got.complete, true);
    let count = 0;
    const partial = await collectInvestigation(async () => { count++; throw Error('timeout'); }, raw, req);
    assert.equal(count, 1); assert.equal(partial.complete, false);
});

test('absorb-only healers still request raid damage evidence', () => {
    const raw = pull(49); raw.player.role = 'healer';
    raw.events.data = [{ type: 'absorbed', amount: 2000, sourceID: raw.sourceId, timestamp: raw.context.fights[0].startTime + 1000 }];
    assert.ok(requestsFor(raw).some(r => r.key === 'raidDamage' && r.sourceId == null));
});
test('same character across uploads is excluded and independent duplicates are ranked before deduplication', () => {
    const raw = pull(22), other = (name, code, kind, duration) => ({ ...raw, reportCode: code, sourceId: 24, player: { ...raw.player, name }, context: { fights: [{ ...raw.context.fights[0], startTime: 0, endTime: duration * 1000 }] }, kind });
    raw.references = [other('Utopik', 'secondary', 'benchmark', 116), other('Independent', 'first', 'raid', 200), other('Independent', 'better', 'benchmark', 120)];
    const result = selectReferences(raw);
    assert.equal(result.accepted.length, 1); assert.equal(result.accepted[0].reportCode, 'better');
    assert.equal(result.excluded.length, 2);
});
