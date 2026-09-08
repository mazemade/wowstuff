'use strict';
const assert = require('node:assert/strict');
const D = require('./tactics-bloodboil-data.js');
const L = require('./tactics-layout.js');
const B = require('./tactics-bloodboil.js');
const RawSteps = require('./tactics-bloodboil-steps.js');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok -', name); } catch (error) { failed++; console.error('FAIL -', name, '\n   ', error.message); } }
const prepare = (id, roster) => B.prepareScene(D, D.scenes.find(s => s.id === id), L.assign(D, roster || null));

test('all nine chapters provide independent guidance and finite bounded frames', () => {
    assert.equal(D.scenes.length, 9);
    D.scenes.forEach(source => {
        ['chapter', 'caption', 'call', 'why', 'mistake'].forEach(key => assert.ok(source[key], source.id + ' ' + key));
        assert.ok(source.jobs.length >= 3);
        const sc = prepare(source.id);
        [0, source.duration / 2, source.duration].forEach(t => {
            const frame = B.simulate(D, sc, t);
            assert.equal(Object.keys(frame.pos).length, 25);
            Object.values(frame.pos).forEach(p => { assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); assert.ok(p.x >= D.arena.x0 && p.x <= D.arena.x1 && p.y >= D.arena.y0 && p.y <= D.arena.y1); });
            assert.ok(D.stateLabels[frame.stage]);
        });
    });
});

test('each Bloodboil recipient set is the actual five farthest at its event position', () => {
    const sc = prepare('rotation');
    [10000, 20000, 30000, 40000, 50000].forEach((at, i) => {
        const frame = B.simulate(D, sc, at), applied = frame.bloodboil.find(x => x.at === at);
        const ordered = sc.raid.slice().sort((a, b) => L.dist(D, frame.pos[b.id], frame.boss) - L.dist(D, frame.pos[a.id], frame.boss) || a.slotIndex - b.slotIndex).slice(0, 5).map(p => p.id);
        assert.deepEqual(applied.targetIds.slice().sort(), sc.groupMembers[['G1','G2','G3','G1','G2'][i]].slice().sort());
        assert.deepEqual(applied.targetIds, ordered);
    });
});

test('five applications rotate G1 G2 G3 G1 G2 and each debuff expires after 24 seconds', () => {
    const sc = prepare('rotation');
    const at = t => B.simulate(D, sc, t);
    assert.deepEqual(at(50000).bloodboil.map(x => x.group), ['G3', 'G1', 'G2']);
    assert.ok(!at(34000).bloodboil.some(x => x.at === 10000));
    assert.equal(at(33999).bloodboil.some(x => x.at === 10000), true);
    assert.equal(at(34000).bloodboil.some(x => x.at === 10000), false);
    assert.equal(at(40000).bloodboil.filter(x => x.group === 'G1').length, 1, 'G1 did not receive an invented second stack');
});

test('partial rosters omit unavailable roles and do not invent healing recovery', () => {
    const sc = prepare('cycle', { tanks: ['Tank'], melee: [], healers: [], ranged: ['Range'] });
    assert.match(sc.missingRoles.join(' '), /No healer/);
    const rage = B.simulate(D, sc, 60000);
    assert.equal(rage.rage.active, true); assert.equal(rage.rage.targetId, sc.back[0]); assert.ok(rage.hp[rage.rage.targetId] < B.simulate(D, sc, 55000).hp[rage.rage.targetId]); assert.equal(rage.healLinks.length, 0);
    const empty = prepare('rotation', { tanks: ['Tank'], melee: [], healers: [], ranged: [] });
    assert.deepEqual(B.simulate(D, empty, 10000).bloodboil[0].targetIds, empty.tanks, 'an incomplete plan does not make tanks immune to the distance mechanic');
    const expiry = prepare('rotation', { tanks: ['Tank'], ranged: Array.from({length:15},(_,i)=>'R'+i) });
    const id = expiry.groupMembers.G1[0];
    assert(B.simulate(D,expiry,34000).hp[id] <= B.simulate(D,expiry,33999).hp[id], 'debuff expiration does not heal without a healer');
});

test('both Fel Rage lessons place their victim according to role and make the boss follow', () => {
    const ranged = prepare('rage-ranged'), melee = prepare('rage-melee');
    const rf = B.simulate(D, ranged, 4000), mf = B.simulate(D, melee, 4000);
    assert.equal(rf.rage.kind, 'ranged'); assert.equal(mf.rage.kind, 'melee');
    assert.ok(rf.pos[rf.rage.targetId].x < D.bossAt.x); assert.deepEqual(mf.pos[mf.rage.targetId], { x: .73, y: .49 });
    assert.ok(L.dist(D, rf.boss, rf.pos[rf.rage.targetId]) >= 4.9); assert.ok(L.dist(D, mf.boss, mf.pos[mf.rage.targetId]) >= 4.9);
});

test('standalone steps match chapters and are ready for the shared registry API', () => {
    assert.deepEqual(Object.keys(RawSteps), D.scenes.map(s => s.id));
    D.scenes.forEach(s => assert.ok(RawSteps[s.id].length, s.id));
    assert.deepEqual(RawSteps.rotation.map(({ id, startMs, holdAtMs }) => [id, startMs, holdAtMs]), [
        ['ready', 0, 9999], ['g1', 10000, 10999], ['switch', 11000, 19999],
        ['g2', 20000, 29999], ['g3', 30000, 39999], ['g1-again', 40000, 49999], ['g2-again', 50000, 55000]
    ]);
});

test('the first hit holds its formation, then the switch begins from that position and completes both routes', () => {
    const sc = prepare('rotation');
    const hold = B.simulate(D, sc, 10999), switchStart = B.simulate(D, sc, 11000), moving = B.simulate(D, sc, 12000), done = B.simulate(D, sc, 13000);
    assert.deepEqual(B.simulate(D, sc, 10000).pos, hold.pos, 'G1 holds the far formation while Bloodboil healing begins');
    assert.deepEqual(switchStart.pos, hold.pos, 'the switch starts from the pre-movement formation');
    assert.equal(switchStart.routes.length, 10, 'both outgoing G1 and incoming G2 receive routes');
    assert.equal(moving.routes.length, 10);
    assert.equal(done.routes.length, 0, 'the exchange has completed');
    assert.equal(done.soakGroup, 'G2');
    const expected = B.simulate(D, sc, 19999);
    assert.deepEqual(done.pos, expected.pos, 'G2 holds its completed far formation');
});

test('each subsequent rotation and cycle exchange finishes with clear routes and the intended next formation', () => {
    for (const id of ['rotation', 'cycle']) {
        const sc = prepare(id);
        [[21000, 'G3'], [31000, 'G1'], [41000, 'G2'], [51000, null]].forEach(([start, group]) => {
            const startFrame = B.simulate(D, sc, start), done = B.simulate(D, sc, start + 2000);
            assert.ok(startFrame.routes.length > 0, id + ' exchange starts with routes at ' + start);
            assert.equal(done.routes.length, 0, id + ' exchange clears routes at ' + (start + 2000));
            assert.equal(done.soakGroup, group, id + ' reaches ' + (group || 'the pre-rage formation'));
        });
    }
});

test('oversized backlines preserve the three groups and five actual recipients', () => {
    const sc = prepare('rotation', { tanks: ['T1','T2','T3'], healers: ['H1','H2'], ranged: Array.from({length:20},(_,i)=>'R'+i) });
    assert.equal(sc.raid.length, 25);
    assert.deepEqual(Object.keys(sc.groupMembers), ['G1','G2','G3']);
    assert.equal(sc.raid.filter(p=>p.group).length, 15);
    for (const [index, time] of [10000,20000,30000,40000,50000].entries()) {
        const frame = B.simulate(D, sc, time), hit = frame.bloodboil.find(w=>w.at===time);
        assert.equal(hit.targetIds.length, 5);
        assert.equal(hit.group, ['G1','G2','G3','G1','G2'][index]);
        assert.deepEqual(hit.targetIds.slice().sort(), sc.groupMembers[hit.group].slice().sort());
    }
});

test('Fel Rage keeps residual Bloodboil, frozen tank wound stacks and separate tank healing', () => {
    const sc = prepare('cycle'), start = B.simulate(D,sc,55000), late = B.simulate(D,sc,73000);
    assert.deepEqual(start.bloodboil.map(w=>w.wave), [4,5]);
    assert.deepEqual(start.tankDebuffs, late.tankDebuffs);
    assert(start.healLinks.some(h=>sc.tanks.includes(h.toId)));
    assert(start.healLinks.some(h=>h.toId===start.rage.targetId));
    assert(sc.tanks.some(id=>start.hp[id]<1));
    assert.equal(B.simulate(D,sc,74000).bloodboil.length,0);
    assert.equal(B.simulate(D,sc,85000).rage.active,false);
});

test('rage destinations keep all 25 actors distinct and other raiders out of the frontal', () => {
    for(const chapter of ['rage-ranged','rage-melee']) {
        const sc=prepare(chapter),f=B.simulate(D,sc,10000),target=f.pos[f.rage.targetId];
        const direction=Math.atan2((target.y-f.boss.y)/D.aspect,target.x-f.boss.x);
        for(const p of sc.raid) {
            if(p.id===f.rage.targetId)continue;
            const at=f.pos[p.id], angle=Math.atan2((at.y-f.boss.y)/D.aspect,at.x-f.boss.x);
            const diff=Math.abs(Math.atan2(Math.sin(angle-direction),Math.cos(angle-direction)));
            assert(L.dist(D,at,f.boss)>12 || diff>.48,p.id+' avoids the frontal');
        }
        for(let i=0;i<sc.raid.length;i++)for(let j=i+1;j<sc.raid.length;j++)
            assert(L.dist(D,f.pos[sc.raid[i].id],f.pos[sc.raid[j].id])>2,'raid actors do not collapse into a stack');
    }
});

test('tank handoff, eight-second Bewildering Strike and Eject change the actual target', () => {
    const sc=prepare('tanks'), target=t=>B.simulate(D,sc,t).bossTarget;
    assert.equal(target(0),sc.tanks[0]);
    assert.equal(target(9000),sc.tanks[1]);
    assert.equal(target(11000),sc.tanks[2]);
    assert.equal(target(18999),sc.tanks[2]);
    assert.equal(target(19000),sc.tanks[1]);
    assert.equal(target(22000),sc.tanks[2]);
});

test('a breath turns toward its selected melee player and neighbors move clear', () => {
    const sc=prepare('breath'),before=B.simulate(D,sc,0),cast=B.simulate(D,sc,2500),clear=B.simulate(D,sc,4000);
    assert.notEqual(cast.bossTarget,before.bossTarget);
    assert(sc.melee.includes(cast.bossTarget));
    assert(cast.routes.length>0);
    for(const route of cast.routes) assert(L.dist(D,cast.pos[route.fromId],clear.pos[route.fromId])>1);
    assert.equal(B.simulate(D,sc,5000).bossTarget,before.bossTarget);
});

test('selected melee fill soak vacancies and stay melee in every chapter', () => {
    const roster = { tanks:['T1','T2','T3'], melee:Array.from({length:10},(_,i)=>'M'+i), healers:['H1','H2','H3','H4','H5','H6'], ranged:['R1','R2','R3','R4','R5','R6'] };
    const assigned=L.assign(D,roster), options={meleeSoakers:['name:M0','name:M4','name:M7']};
    for(const source of D.scenes) {
        const sc=B.prepareScene(D,source,assigned,options);
        assert.deepEqual(Object.values(sc.groupMembers).map(ids=>ids.length),[5,5,5]);
        assert(!sc.missingRoles.some(note=>note.includes('Soak groups incomplete')));
        assert.equal(sc.raid.filter(p=>p.kind==='melee').length,10);
        for(const name of ['M0','M4','M7']) assert.equal(sc.raid.find(p=>p.name===name).group,'G3');
        assert.equal(sc.raid.find(p=>p.name==='M1').group,null);
    }
    const sc=B.prepareScene(D,D.scenes.find(s=>s.id==='rotation'),assigned,options);
    for(const time of [10000,20000,30000,40000,50000]) {
        const frame=B.simulate(D,sc,time),wave=frame.bloodboil.find(w=>w.at===time);
        assert.deepEqual(wave.targetIds.slice().sort(),sc.groupMembers[wave.group].slice().sort());
    }
    const selected=sc.raid.find(p=>p.name==='M4'),out=B.simulate(D,sc,30000),returned=B.simulate(D,sc,34000);
    assert(L.dist(D,out.pos[selected.id],returned.pos[selected.id])>15);
    assert.deepEqual(returned.pos[selected.id],sc.baseById[selected.id]);
    assert.match(B.copyText(D,sc,returned),/G3:.*M0.*M4.*M7/);
    assert.match(B.copyText(D,sc,returned),/M4 — Melee soaker: return behind the boss/);
    assert.doesNotMatch(B.resolveExplanation(RawSteps.rotation[0],sc).title,/missing/i);
});

test('melee selection rejects tanks and absent names, caps vacancies, and survives roster reordering by name', () => {
    const roster={tanks:['T'],healers:Array.from({length:6},(_,i)=>'H'+i),ranged:Array.from({length:7},(_,i)=>'R'+i),melee:['A','B','C']};
    const assigned=L.assign(D,roster);
    const plan=B.soakAssignment(assigned,['name:B','name:B','name:T','name:Absent']);
    assert.deepEqual(plan.selectedKeys,['name:B']);assert.equal(plan.vacancies,1);
    assert.equal(B.soakAssignment(assigned,['name:A','name:B','name:C']).players.length,15);
    assert.equal(B.soakAssignment(assigned,{invalid:true}).melee.length,0);
    const reordered=L.assign(D,{...roster,melee:['C','B','A'],tanks:['Another','T']});
    assert.deepEqual(B.soakAssignment(reordered,plan.selectedKeys).selectedKeys,['name:B']);
    const full=L.assign(D,{...roster,ranged:Array.from({length:9},(_,i)=>'R'+i)});
    assert.equal(B.soakAssignment(full,plan.selectedKeys).melee.length,0);
    assert.equal(B.soakAssignment(assigned,['name:B']).vacancies,1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
