'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeBudget } = require('./evaluation-budget');
const { attributeCauses, ownerFor } = require('./evaluation-attribution');
const recorded = require('./fixtures/evaluation/utopik-investigation.json');
const fight = name => structuredClone(recorded.fights.find(f => f.name === name));
const causesFor = name => { const raw = fight(name); return attributeCauses(raw, analyzeBudget(raw)).causes; };
const funkellHunter = require('./fixtures/evaluation/funkell-hunter.json');

test('Winterchill expertise gap resolves to Fang of Vashj with the reference luck stated', () => {
    const causes = causesFor('Rage Winterchill');
    const expertise = causes.find(c => c.id === 'stat-expertise');
    assert.equal(expertise.owner, 'you'); assert.equal(expertise.kind, 'gear'); assert.equal(expertise.bucket, 'melee'); assert.equal(expertise.factor, 'zeroDamage');
    assert.match(expertise.observation, /15 dodges against 6/);
    assert.match(expertise.observation, /0 expertise.*21/s);
    assert.ok(expertise.evidence.some(e => /Fang of Vashj/.test(e.text) && /21 expertise/.test(e.text)));
    assert.match(expertise.observation, /luck|variance/i, 'the reference dodge count below expectation is named');
    assert.deepEqual(expertise.statDelta, { 24: 21 });
    assert.deepEqual(expertise.sim, { bonusStats: { 24: 21 } });
    const miss = causes.find(c => c.id === 'luck-melee-miss');
    assert.equal(miss.owner, 'luck'); assert.match(miss.observation, /13 misses against 6/);
    // Round 2 item 1: expertise's bucket mapping must cover every decomposed melee-yellow bucket
    // too (not just melee-white), so a dodge difference on Mutilate is not a separate luck cause.
    assert.equal(causes.find(c => c.id === 'luck-mutilate-dodge'), undefined);
    assert.ok(expertise.alsoBuckets.includes('mutilate'));
});

test('the expertise observation names the reference item that supplies the stat', () => {
    const expertise = causesFor('Rage Winterchill').find(c => c.id === 'stat-expertise');
    assert.match(expertise.observation, /Fang of Vashj \(Main hand\)/);
    assert.match(expertise.observation, /Jofrey's 21 expertise comes from/);
});

test('Winterchill auras at pull: flask against elixir, Kings, Unleashed Rage; trinket without damage stats', () => {
    const causes = causesFor('Rage Winterchill');
    const flask = causes.find(c => c.id === 'aura-flask');
    assert.equal(flask.owner, 'you'); assert.match(flask.observation, /Elixir of Major Agility/); assert.match(flask.observation, /Flask of Relentless Assault/);
    assert.deepEqual(flask.sim, { consumable: { field: 'flaskId', id: 22854, clear: ['battleElixirId', 'guardianElixirId'] } });
    const kings = causes.find(c => c.id === 'aura-25898');
    assert.equal(kings.owner, 'raid'); assert.match(kings.title, /Blessing of Kings/);
    const ur = causes.find(c => c.id === 'uptime-30807');
    assert.equal(ur.owner, 'raid'); assert.match(ur.observation, /79\.5%/); assert.match(ur.observation, /0%/);
    const dst = causes.find(c => c.id === 'proc-28830');
    assert.equal(dst.owner, 'you'); assert.match(dst.observation, /Dragonspine Trophy/); assert.match(dst.observation, /Medallion of the Horde/);
    assert.deepEqual(dst.sim, { equip: { slot: 12, id: 28830, replaces: 28240 } });
    const drums = causes.find(c => c.id === 'uptime-35476');
    assert.equal(drums.owner, 'raid');
    const snd = causes.find(c => c.id === 'uptime-6774');
    assert.equal(snd, undefined, 'the player has more Slice and Dice uptime than the reference; no cause');
});

test('no cause is manufactured when both sides lack a table', () => {
    const raw = fight('Rage Winterchill'); delete raw.tables.buffs; for (const r of raw.references) delete r.tables.buffs;
    const result = attributeCauses(raw, analyzeBudget(raw));
    assert.ok(!result.causes.some(c => c.id.startsWith('uptime-')));
    assert.ok(result.limitations.some(l => /[Bb]uff bands/.test(l)));
});

test('Bloodlust and Heroism are one family, so a faction difference is not a cause', () => {
    const causes = causesFor('Rage Winterchill');
    assert.equal(causes.find(c => c.id === 'uptime-32182'), undefined);
    assert.equal(causes.find(c => c.id === 'uptime-2825'), undefined, 'Utopik 28% Bloodlust against Jofrey 31% Heroism is below the 10-point threshold');
});

// --- Round 2 fixes ---

test('a reference-only proc with no qualifying trinket to swap is luck, not a gear recommendation', () => {
    const causes = causesFor('Anetheron');
    const luckProc = causes.find(c => c.id === 'proc-aura-34775');
    assert.ok(luckProc, 'expected proc-aura-34775 to exist');
    assert.equal(luckProc.owner, 'luck');
    assert.equal(luckProc.kind, 'proc');
    assert.equal(luckProc.action, 'No change; proc uptime is variance.');
    assert.equal(causes.find(c => c.id === 'proc-28830'), undefined, 'both of Utopik\'s trinkets already carry damage stats; there is no qualifying trinket to swap');
});

test('a missing player gear audit disables proc comparison and the contradictory equipment action', () => {
    const raw = fight('Rage Winterchill'); delete raw.gearAudit;
    const result = attributeCauses(raw, analyzeBudget(raw));
    assert.ok(!result.causes.some(c => c.id.startsWith('proc-')));
    assert.ok(result.limitations.some(l => /equipment audit is unavailable/i.test(l)));
    const expertise = result.causes.find(c => c.id === 'stat-expertise');
    assert.match(expertise.action, /unavailable/);
});

test('missing fight timing does not corrupt uptime percentages', () => {
    // analyzeBudget and attributeCauses both call chooseReference(raw) independently and
    // deterministically, so a decomposed budget always implies durationOf(raw) > 0 and
    // durationOf(reference) > 0 at the moment attributeCauses runs normally. The only way to
    // reach the timing guard through the public path is to desynchronize the two: compute the
    // budget first (with valid timing), then corrupt raw's own fight duration afterwards.
    const raw = fight('Rage Winterchill');
    const budget = analyzeBudget(raw);
    const ownFight = raw.context.fights.find(f => f.id === raw.fightId) || raw.context.fights[0];
    ownFight.endTime = ownFight.startTime;
    const result = attributeCauses(raw, budget);
    assert.ok(!result.causes.some(c => c.id.startsWith('uptime-') || c.id.startsWith('proc-')));
    assert.ok(result.limitations.some(l => /timing/i.test(l)));
});

test('debuff aliases collapse by catalogue name, not id, so two Faerie Fire spell ids are one debuff', () => {
    const raw = fight('Rage Winterchill');
    const jofrey = raw.references.find(r => r.player?.name === 'Jofrey');
    raw.context.debuffs = { data: { auras: [{ name: 'Faerie Fire', guid: 25602, totalUptime: 1000, bands: [] }] } };
    jofrey.context.debuffs = { data: { auras: [{ name: 'Faerie Fire', guid: 26993, totalUptime: 1000, bands: [] }] } };
    const budget = analyzeBudget(raw);
    let result = attributeCauses(raw, budget);
    assert.ok(!result.causes.some(c => c.id.startsWith('debuff-')), 'both sides have Faerie Fire, just under different spell ids');
    raw.context.debuffs.data.auras = [];
    result = attributeCauses(raw, analyzeBudget(raw));
    const ff = result.causes.find(c => c.id.startsWith('debuff-'));
    assert.ok(ff, 'the player no longer has any Faerie Fire variant');
    assert.match(ff.title, /Faerie Fire/);
});

test('parries are positioning, not stat luck: only flagged when the player is parried more than the reference', () => {
    const noCause = causesFor('Rage Winterchill'); // recorded: 2 player parries against 3 reference parries
    assert.equal(noCause.find(c => c.id.startsWith('positioning-') && c.id.endsWith('-parry')), undefined);
    assert.equal(noCause.find(c => c.id === 'luck-melee-parry'), undefined, 'parry no longer produces a generic luck cause');
    const raw = fight('Rage Winterchill');
    const meleeRow = raw.tables.dmg.data.entries.find(r => r.name === 'Melee');
    meleeRow.missdetails.find(m => m.type === 'Parry').count = 5;
    const causes = attributeCauses(raw, analyzeBudget(raw)).causes;
    const positioning = causes.find(c => c.id === 'positioning-melee-parry');
    assert.ok(positioning, 'expected positioning-melee-parry when the player is parried more than the reference');
    assert.equal(positioning.owner, 'you');
    assert.match(positioning.observation, /5 of your attacks were parried against 3/);
});

test('a buff already named as an aura-at-pull cause is not priced again as an uptime cause (Funkell/Anetheron Battle Shout)', () => {
    const raw = structuredClone(funkellHunter.fights.find(f => f.name === 'Anetheron'));
    const causes = attributeCauses(raw, analyzeBudget(raw)).causes;
    assert.ok(causes.some(c => c.id === 'aura-2048'), 'expected aura-2048 (Battle Shout at pull) to exist');
    assert.equal(causes.find(c => c.id === 'uptime-2048'), undefined, 'Battle Shout must not also be priced as an uptime cause');
});

// --- Fix round 1 ---

test('a gear audit captured without per-slot stats treats gearDiff as unavailable, not zero (Utopik Winterchill expertise)', () => {
    const raw = fight('Rage Winterchill');
    for (const s of raw.references[0].gearAudit.slots) delete s.stats;
    const causes = attributeCauses(raw, analyzeBudget(raw)).causes;
    const expertise = causes.find(c => c.id === 'stat-expertise');
    assert.match(expertise.observation, /unavailable for one side/);
    assert.doesNotMatch(expertise.observation, /explains 0/);
});

test('the stat-gap remainder names the auras the reference had at pull instead of a vague "buffs, scrolls or consumables" (Funkell/Anetheron agility)', () => {
    const raw = structuredClone(funkellHunter.fights.find(f => f.name === 'Anetheron'));
    const causes = attributeCauses(raw, analyzeBudget(raw)).causes;
    const agility = causes.find(c => c.id === 'stat-agility');
    assert.match(agility.observation, /matches auras the reference had at pull: .*Kings/);
    assert.doesNotMatch(agility.observation, /buffs, scrolls or consumables/);
});

// --- Final fix wave ---

const funkell = name => structuredClone(funkellHunter.fights.find(f => f.name === name));
const funkellCauses = name => { const raw = funkell(name); return attributeCauses(raw, analyzeBudget(raw)).causes; };

test("a stat gap only names sources that actually supply that stat (Funkell Kaz'rogal ranged haste)", () => {
    const haste = funkellCauses("Kaz'rogal").find(c => c.id === 'stat-haste');
    assert.match(haste.observation, /Drums of Battle/, 'Drums of Battle is the only recorded source of ranged haste rating');
    assert.doesNotMatch(haste.observation, /Warp Burger|Battle Shout|Sanctity Aura|Wisdom|Leader of the Pack|Kings/);
});

test('an agility gap names the agility buffs and not the attack-power ones (Funkell Anetheron)', () => {
    const agility = funkellCauses('Anetheron').find(c => c.id === 'stat-agility');
    assert.match(agility.observation, /Kings|Warp Burger/);
    assert.doesNotMatch(agility.observation, /Battle Shout|Prayer of Spirit|Demonslaying/);
});

test('a stat with no source on either side says so instead of listing unrelated auras', () => {
    const raw = funkell("Kaz'rogal");
    for (const r of raw.references) r.tables.buffs.data.auras = r.tables.buffs.data.auras.filter(a => Number(a.guid) !== 35476);
    const haste = attributeCauses(raw, analyzeBudget(raw)).causes.find(c => c.id === 'stat-haste');
    assert.match(haste.observation, /is not explained by equipment or auras at pull/);
});

test('a trinket the item database does not know is never named as the one with no damage stats', () => {
    const raw = fight('Rage Winterchill');
    const trinket = raw.gearAudit.slots.find(s => s.key === 'trinket1');
    Object.assign(trinket, { id: 18846, name: 'Unknown item 18846', stats: {} });
    raw.gearAudit.unknownItems = [18846];
    const causes = attributeCauses(raw, analyzeBudget(raw)).causes;
    assert.equal(causes.filter(c => /Unknown item/.test(c.action || '') || /Unknown item/.test(c.observation || '')).length, 0);
    assert.ok(causes.some(c => c.id === 'proc-aura-34775'), 'falls back to the luck proc cause');
});

test('"comes from" is only used when the named slots cover the reference total', () => {
    const expertise = causesFor('Rage Winterchill').find(c => c.id === 'stat-expertise');
    assert.match(expertise.observation, /Jofrey's 21 expertise comes from Fang of Vashj \(Main hand\)/);
    const agility = funkellCauses('Anetheron').find(c => c.id === 'stat-agility');
    assert.match(agility.observation, /The equipment lead sits in .+\(.+, \+\d+\) and .+\(.+, \+\d+\)\./);
    assert.doesNotMatch(agility.observation, /agility comes from/);
});

test('an unidentified food buff is stated as unidentified and never priced (Funkell Anetheron)', () => {
    const food = funkellCauses('Anetheron').find(c => c.id === 'aura-food');
    assert.equal(food.sim, null, 'the baseline has no food to price against');
    assert.equal(food.unsizedReason, 'your food is not identified');
    assert.match(food.observation, /At pull you had a food buff the log does not identify; Swagfan had Warp Burger\./);
    assert.match(food.action, /^Use Warp Burger/);
});

test('a maintained buff the player keeps better than the reference is recorded as a keep', () => {
    const keep = causesFor('Rage Winterchill').find(c => c.id === 'keep-uptime-6774');
    assert.ok(keep, 'expected keep-uptime-6774');
    assert.equal(keep.kind, 'keep'); assert.equal(keep.owner, 'you'); assert.equal(keep.bucket, 'all');
    assert.equal(keep.title, 'Your Slice and Dice uptime beats Jofrey');
    assert.match(keep.observation, /91/); assert.match(keep.observation, /82/);
    assert.equal(keep.action, 'Keep it.');
    assert.equal(keep.sim, null, 'a keep is never priced');
});

test("a hunter's own Ferocious Inspiration is owned by the player with a pet action", () => {
    const fi = funkellCauses('Archimonde').find(c => c.id === 'uptime-34456');
    assert.equal(fi.owner, 'you');
    assert.equal(fi.action, 'Keep your pet alive and attacking; Ferocious Inspiration only lasts while it crits.');
    assert.equal(ownerFor({ id: 30807, owner: 'raid' }, { classToken: 'SHAMAN', spec: 'Enhancement' }), 'you', 'an enhancement shaman provides their own Unleashed Rage');
    assert.equal(ownerFor({ id: 30807, owner: 'raid' }, { classToken: 'ROGUE', spec: 'Assassination' }), 'raid');
    assert.equal(ownerFor({ id: 34456, owner: 'raid' }, { classToken: 'ROGUE', spec: 'Assassination' }), 'raid');
});

test('an uptime the player already partly had asks to compare the windows, not the raid leader', () => {
    const bloodlust = funkellCauses('Archimonde').find(c => c.id === 'uptime-2825');
    assert.match(bloodlust.action, /^Compare when Bloodlust started and how long it lasted on each pull; Acamaz's raid had it \d/);
    assert.doesNotMatch(bloodlust.action, /Ask your raid leader/);
});

test('a ranged role attributes stat gaps to the Auto Shot bucket when it is decomposed', () => {
    assert.equal(funkellCauses("Kaz'rogal").find(c => c.id === 'stat-agility').bucket, 'auto shot');
    assert.equal(funkellCauses('Anetheron').find(c => c.id === 'stat-agility').bucket, 'auto shot', 'Auto Shot is preferred over the larger Steady Shot bucket');
});

test('the luck title names a stat deficit, not a stat difference', () => {
    const miss = causesFor('Rage Winterchill').find(c => c.id === 'luck-melee-miss');
    assert.equal(miss.title, 'Misses on Melee differ without a stat deficit');
});
