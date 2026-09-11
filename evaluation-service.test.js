'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./vet-feedback.js');
const { collectEvents, rawFights, captureQueries, buildEvaluation } = require('./evaluation-service.js');

test('events paginate and incoming mechanics use WCL affected-player Debuffs semantics', async () => {
    const calls = [];
    const query = async (q, v) => {
        calls.push({ q, v });
        return { reportData: { report: { events: v.start === null ? { data: [{ timestamp: 1 }], nextPageTimestamp: 2 } : { data: [{ timestamp: 2 }], nextPageTimestamp: null } } } };
    };
    const result = await collectEvents(query, { reportCode: 'abcdefghijklmnop', fightId: 38, sourceId: 4 }, true);
    assert.equal(result.complete, true); assert.equal(result.data.length, 2);
    assert.match(calls[0].q, /sourceID:\$s,dataType:Debuffs/);
    assert.equal(calls[1].v.start, 2);
});

test('a later page failure retains events without asserting the stream is complete', async () => {
    let count = 0;
    const result = await collectEvents(async () => {
        if (count++) throw new Error('temporary timeout');
        return { reportData: { report: { events: { data: [{ timestamp: 1 }], nextPageTimestamp: 2 } } } };
    }, { reportCode: 'abcdefghijklmnop', fightId: 38, sourceId: 4 });
    assert.equal(result.data.length, 1); assert.equal(result.complete, false);
});

test('nonadvancing cursors stop rather than duplicate an unbounded event stream', async () => {
    const result = await collectEvents(async () => ({ reportData: { report: { events: { data: [], nextPageTimestamp: 2 } } } }), { reportCode: 'abcdefghijklmnop', fightId: 38, sourceId: 4 });
    assert.equal(result.complete, false); assert.match(result.reason, /did not advance/);
});

test('raw evidence retains individual reference tables and does not reuse old causal findings', async () => {
    const contexts = {
        own: { fights: [{ id: 38, name: 'Anetheron', startTime: 100, endTime: 120100 }], masterData: { actors: [{ id: 4, name: 'Warrior' }] }, dmgAll: { data: { entries: [{ id: 4, icon: 'Warrior-Arms' }] } } },
        ref: { fights: [{ id: 2, name: 'Anetheron', startTime: 100, endTime: 110100 }], masterData: { actors: [{ id: 24, name: 'Reference' }] } },
    };
    const captured = captureQueries(async (q, v) => ({ reportData: { report: q === F.FIGHT_QUERY ? contexts[v.c] : { dmg: { data: { entries: [] } } } } }));
    await captured.query(F.FIGHT_QUERY, { c: 'own', f: [38] });
    await captured.query(F.PLAYER_QUERY, { c: 'own', f: [38], s: 4 });
    await captured.query(F.FIGHT_QUERY, { c: 'ref', f: [2] });
    await captured.query(F.PLAYER_QUERY, { c: 'ref', f: [2], s: 24 });
    const raw = rawFights({ player: { name: 'Warrior', class: 'WARRIOR', spec: 'Fury' }, kills: [{ reportCode: 'own', fightId: 38, name: 'Anetheron', findings: ['Press more'] }] }, captured)[0];
    assert.equal(raw.references[0].name, 'Reference'); assert.equal(raw.references[0].sourceId, 24);
    assert.equal(raw.findings, undefined);
    assert.equal(raw.player.spec, 'Arms'); assert.equal(raw.player.classToken, 'WARRIOR');
});

test('simulation failure leaves useful evidence and reports missing estimates', async () => {
    const context = { fights: [{ id: 38, name: 'Anetheron', startTime: 100, endTime: 120100 }], masterData: { actors: [{ id: 4, name: 'Warrior' }] } };
    const result = await buildEvaluation({ name: 'Warrior', report: 'abcdefghijklmnop' }, {
        loadProfile: async () => ({ profile: { parses: {} } }), getDbIndex: () => ({}),
        query: async q => ({ reportData: { report: q === F.FIGHT_QUERY ? context : q === F.PLAYER_QUERY ? {} : { events: { data: [], nextPageTimestamp: null } } } }),
        fetchFeedback: async query => {
            await query(F.FIGHT_QUERY, { c: 'abcdefghijklmnop', f: [38] });
            await query(F.PLAYER_QUERY, { c: 'abcdefghijklmnop', f: [38], s: 4 });
            return { player: { name: 'Warrior' }, kills: [{ name: 'Anetheron', reportCode: 'abcdefghijklmnop', fightId: 38 }] };
        },
        analyzeFight: raw => ({ findings: [{ title: 'Measured observation' }], limitations: [], complete: raw.events.complete }),
        evaluateFight: async () => { throw new Error('simulation failure'); },
    });
    assert.equal(result.fights[0].simulation.status, 'unavailable');
    assert.equal(result.fights[0].findings[0].title, 'Measured observation');
    assert.equal(result.fights[0].complete, true);
});

test('buildEvaluation prices causes after simulation and survives a pricing failure', async () => {
    const context = { fights: [{ id: 38, name: 'Anetheron', startTime: 100, endTime: 120100 }], masterData: { actors: [{ id: 4, name: 'Warrior' }] } };
    const stages = [];
    const result = await buildEvaluation({ name: 'Warrior', report: 'abcdefghijklmnop' }, {
        loadProfile: async () => ({ profile: { parses: {} } }), getDbIndex: () => ({}),
        query: async q => ({ reportData: { report: q === F.FIGHT_QUERY ? context : q === F.PLAYER_QUERY ? {} : { events: { data: [], nextPageTimestamp: null } } } }),
        fetchFeedback: async query => {
            await query(F.FIGHT_QUERY, { c: 'abcdefghijklmnop', f: [38] });
            await query(F.PLAYER_QUERY, { c: 'abcdefghijklmnop', f: [38], s: 4 });
            return { player: { name: 'Warrior' }, kills: [{ name: 'Anetheron', reportCode: 'abcdefghijklmnop', fightId: 38 }] };
        },
        analyzeFight: raw => ({ findings: [{ title: 'Measured observation' }], limitations: [], budget: { status: 'unavailable', buckets: [], limitations: [] }, causes: [] }),
        evaluateFight: async () => ({ status: 'unsupported', reason: 'test', actions: [], packages: [], assumptions: [] }),
        priceCauses: async () => { throw new Error('boom'); },
    }, progress => { stages.push(progress.stage); });
    assert.equal(result.fights[0].pricing.status, 'unavailable');
    assert.match(result.fights[0].pricing.reason, /boom/);
    assert.ok(stages.indexOf('pricing') > stages.indexOf('simulation'), 'pricing must run after simulation');
    assert.equal(result.fights[0].findings[0].title, 'Measured observation');
});

test('buildEvaluation passes the analyzed budget and causes to priceCauses and keeps a successful price', async () => {
    const context = { fights: [{ id: 38, name: 'Anetheron', startTime: 100, endTime: 120100 }], masterData: { actors: [{ id: 4, name: 'Warrior' }] } };
    const seenArgs = [];
    const result = await buildEvaluation({ name: 'Warrior', report: 'abcdefghijklmnop' }, {
        loadProfile: async () => ({ profile: { parses: {} } }), getDbIndex: () => ({}),
        query: async q => ({ reportData: { report: q === F.FIGHT_QUERY ? context : q === F.PLAYER_QUERY ? {} : { events: { data: [], nextPageTimestamp: null } } } }),
        fetchFeedback: async query => {
            await query(F.FIGHT_QUERY, { c: 'abcdefghijklmnop', f: [38] });
            await query(F.PLAYER_QUERY, { c: 'abcdefghijklmnop', f: [38], s: 4 });
            return { player: { name: 'Warrior' }, kills: [{ name: 'Anetheron', reportCode: 'abcdefghijklmnop', fightId: 38 }] };
        },
        analyzeFight: raw => ({ findings: [{ title: 'Measured observation' }], limitations: [], budget: { status: 'decomposed', gapDps: 100, player: { name: 'Warrior', dps: 1000 }, reference: { name: 'Ref', dps: 1100 }, buckets: [], limitations: [] }, causes: [{ id: 'stat-hit' }] }),
        evaluateFight: async () => ({ status: 'unsupported', reason: 'test', actions: [], packages: [], assumptions: [] }),
        priceCauses: async (raw, args) => { seenArgs.push(args); return { status: 'priced', rotation: 'validated', prices: {}, assumptions: [] }; },
    }, () => {});
    assert.equal(result.fights[0].pricing.status, 'priced');
    assert.deepEqual(seenArgs[0], { budget: result.fights[0].budget, causes: result.fights[0].causes });
});

const { REPORT_QUERY, ROLE_CONTEXT_QUERY, ROLE_PLAYER_QUERY, selectActor, pullPlayer } = require('./evaluation-service.js');
function directDeps({ fights = [{ id: 38, name: 'Anetheron', startTime: 0, endTime: 120000, encounterID: 50619, kill: true }], role = 'healer', spec = 'Holy', missingRole = false } = {}) {
    const actor = { id: 2, name: 'Priest', subType: 'Priest', server: 'Spineshatter' };
    const row = { id: 2, name: 'Priest', icon: 'Priest-' + spec, total: 12000, itemLevel: 120 };
    const ci = { sourceID: 2, talents: [{ id: 20 }, { id: 41 }, { id: 0 }], gear: [] };
    let profileLoads = 0;
    const seen = [];
    return {
        seen, get profileLoads() { return profileLoads; },
        loadProfile: async () => { profileLoads++; return { profile: { lastSeen: { reportCode: 'abcdefghijklmnop' }, parses: null } }; },
        getDbIndex: () => ({}), getReference: async () => null,
        query: async (q, v) => {
            if (q === REPORT_QUERY) return { reportData: { report: { title: 'Unranked raid', startTime: 1788719156313, masterData: { actors: [actor] }, fights } } };
            const fight = fights.find(f => f.id === v.f[0]);
            let report;
            if (q === F.FIGHT_QUERY) report = { fights: [fight], masterData: { actors: [actor] }, dmgAll: { data: { entries: [row] } }, rankings: { data: [{ roles: { [role === 'healer' ? 'healers' : 'dps']: { characters: [{ name: actor.name, class: 'Priest', spec }] } } }] } };
            else if (q === F.PLAYER_QUERY) report = { ci: { data: [ci] }, casts: { data: { entries: [] } }, buffs: { data: { auras: [] } }, dmg: { data: { entries: [] } } };
            else if (q === ROLE_CONTEXT_QUERY) { if (missingRole) throw Error('temporary'); report = { healAll: { data: { entries: [{ ...row, total: 240000 }] } }, masterData: { actors: [actor] } }; }
            else if (q === ROLE_PLAYER_QUERY) { if (missingRole) throw Error('temporary'); report = { healing: { data: { entries: [] } }, damageTaken: { data: { entries: [] } } }; }
            else report = { events: { data: [], nextPageTimestamp: null } };
            return { reportData: { report } };
        },
        analyzeFight: raw => { seen.push(raw); return { findings: [], limitations: [], coverage: { role: raw.player.role, checks: [] } }; },
        evaluateFight: async raw => ({ status: raw.player.role === 'healer' ? 'not-applicable' : 'complete', actions: [], packages: [] }),
    };
}
test('direct report and source evaluate an unranked healer without loading a ranked profile', async () => {
    const deps = directDeps();
    const result = await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2, fightId: 38 }, deps);
    assert.equal(deps.profileLoads, 0); assert.equal(result.player.name, 'Priest'); assert.equal(result.player.role, 'healer');
    assert.equal(result.night.code, 'abcdefghijklmnop'); assert.equal(result.fights[0].simulation.status, 'not-applicable');
    assert.equal(deps.seen[0].context.healAll.data.entries[0].total, 240000); assert.equal(deps.seen[0].damageTakenEvents.complete, true);
});
test('direct report evaluates every kill beyond the old eight-kill cap, and a selected wipe', async () => {
    const fights = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: 'Boss ' + i, startTime: i * 130000, endTime: i * 130000 + 120000, encounterID: 100 + i, kill: true }));
    fights.push({ id: 11, name: 'Failed attempt', startTime: 1500000, endTime: 1530000, encounterID: 200, kill: false });
    const result = await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2 }, directDeps({ fights }));
    assert.equal(result.fights.length, 10);
    const wipe = await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2, fightId: 11 }, directDeps({ fights }));
    assert.equal(wipe.fights.length, 1); assert.match(wipe.fights[0].limitations.join(' '), /unsuccessful attempt/);
});
test('character with no parses discovers its latest readable report', async () => {
    const deps = directDeps();
    const result = await buildEvaluation({ name: 'Priest', server: 'spineshatter', region: 'eu' }, deps);
    assert.equal(deps.profileLoads, 1); assert.equal(result.fights.length, 1);
});
test('unavailable role tables stay unknown while own fight evidence survives', async () => {
    const deps = directDeps({ missingRole: true });
    await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2 }, deps);
    assert.equal(deps.seen[0].tables.healing, undefined); assert.equal(deps.seen[0].context.healAll, undefined);
});
test('duplicate names require an exact report actor instead of choosing the first', () => {
    const meta = { masterData: { actors: [{ id: 1, name: 'Same', server: 'RealmOne' }, { id: 2, name: 'Same', server: 'RealmTwo' }] } };
    assert.throws(() => selectActor(meta, { name: 'Same' }), /multiple players/);
    assert.equal(selectActor(meta, { name: 'Same', server: 'realm-two' }).id, 2);
    assert.equal(selectActor(meta, { sourceId: 1 }).id, 1);
    assert.throws(() => selectActor(meta, { sourceId: 1, name: 'Different' }), /not found/);
});
test('incoming damage query retains affected-player source semantics', async () => {
    let seen;
    await collectEvents(async q => { seen = q; return { reportData: { report: { events: { data: [], nextPageTimestamp: null } } } }; }, { reportCode: 'abcdefghijklmnop', sourceId: 2, fightId: 38 }, 'damageTaken');
    assert.match(seen, /sourceID:\$s,dataType:DamageTaken/);
});
test('pull classification wins over old talent labels and distinguishes feral tank', () => {
    const context = { dmgAll: { data: { entries: [{ id: 1, icon: 'Druid-Guardian' }] } } };
    const p = pullPlayer(context, { ci: { data: [{ sourceID: 1, talents: [{ id: 0 }, { id: 44 }, { id: 17 }] }] } }, { id: 1, name: 'Bear', subType: 'Druid' });
    assert.equal(p.spec, 'Guardian'); assert.equal(p.role, 'tank');
});

test('partially fulfilled role queries retain usable tables and explain missing evidence', async () => {
    const deps = directDeps(), query = deps.query;
    deps.query = async (q, v) => q === ROLE_PLAYER_QUERY ? { reportData: { report: { healing: { data: { entries: [] } } } } } : query(q, v);
    const result = await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2 }, deps);
    assert.ok(deps.seen[0].tables.healing); assert.equal(deps.seen[0].tables.damageTaken, undefined);
    assert.equal(result.partial, true); assert.match(result.fights[0].limitations.join(' '), /Incoming damage table was unavailable/);
});

test('selected DPS reference events are collected and interrupted comparison timing stays retryable', async () => {
    for (const fail of [false, true]) {
        const deps = directDeps({ role: 'caster', spec: 'Shadow' }), query = deps.query;
        const peer = { id: 3, name: 'Peer', subType: 'Priest', type: 'Player', server: 'Spineshatter' };
        let referenceEvents = 0;
        deps.query = async (q, v) => {
            if (q.includes('limit:10000') && v.s === 3) {
                referenceEvents++;
                if (fail) throw Error('temporary reference outage');
                return { reportData: { report: { events: { data: [{ type: 'cast', sourceID: 3, timestamp: 1000, abilityGameID: 25387 }], nextPageTimestamp: null } } } };
            }
            const result = await query(q, v), report = result.reportData.report;
            if (report.masterData) report.masterData.actors.push(peer);
            if (report.dmgAll) report.dmgAll.data.entries.push({ id: 3, name: 'Peer', icon: 'Priest-Shadow', total: 24000, itemLevel: 120 });
            if (q === F.PLAYER_QUERY && v.s === 3) report.ci.data = [{ sourceID: 3, talents: [{ id: 14 }, { id: 0 }, { id: 47 }], gear: [] }];
            return result;
        };
        const result = await buildEvaluation({ report: 'abcdefghijklmnop', sourceId: 2 }, deps);
        assert.equal(referenceEvents, 2);
        assert.equal(deps.seen[0].references[0].events.complete, !fail);
        assert.equal(result.partial, fail);
        if (fail) assert.match(result.fights[0].limitations.join(' '), /Comparison event timing was incomplete/);
    }
});
