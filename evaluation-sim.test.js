'use strict';

const assert = require('assert');
const fs = require('fs');
const Sim = require('./evaluation-sim.js');
const Models = require('./evaluation-models.js');

function raw(overrides = {}) {
  const info = {
    timestamp: 1000, type: 'combatantinfo', sourceID: 4,
    gear: Array.from({ length: 19 }, (_, index) => ({ id: index + 100, permanentEnchant: index === 7 ? undefined : 1, gems: [] })),
    talents: [{ id: 21 }, { id: 40 }, { id: 0 }],
    strength: 658, agility: 325, intellect: 99, attackPower: 2981, hitMelee: 170, critMelee: 322,
    auras: [{ ability: 25898 }, { ability: 27141 }, { ability: 25895 }, { ability: 26993 }, { ability: 28497 }],
  };
  return {
    reportCode: 'abc', fightId: 14, sourceId: 4, name: 'Test', encounterId: 17808,
    player: { name: 'Test', classToken: 'Warrior', spec: 'Fury' },
    context: { fights: [{ id: 14, name: 'Anetheron', startTime: 1000, endTime: 116830 }], masterData: { actors: [] } },
    tables: {}, events: { complete: true, data: [info, { sourceID: 4, abilityGameID: 20572 }] },
    incoming: { complete: true, data: [] }, references: [], ...overrides,
  };
}

(async () => {
  let result = await Sim.evaluateFight(raw({ player: { name: 'Rogue', classToken: 'Rogue', spec: 'Subtlety' } }));
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason, /detailed talent string in Model settings/);

  result = await Sim.evaluateFight(raw({ player: { name: 'Healer', classToken: 'Shaman', spec: 'Restoration', role: 'healer' } }));
  assert.equal(result.status, 'not-applicable');
  assert.equal(result.coverage.kind, 'not-applicable');
  assert.match(result.reason, /healing role/);
  result = await Sim.evaluateFight(raw({ player: { name: 'Tank', classToken: 'Warrior', spec: 'Protection', role: 'tank' } }));
  assert.equal(result.status, 'not-applicable');
  assert.equal(result.actions.length, 0);
  assert.match(result.reason, /incoming hits, healing and assignment context/);
  assert.equal(Models.models.filter(model => model.role === 'DPS').length, 20);
  assert.equal(Models.models.filter(model => model.role === 'TANK').length, 3);
  for (const model of Models.models) {
    assert(fs.existsSync(model.apl), `${model.id} must ship its pinned source APL`);
    assert(fs.existsSync(model.gear), `${model.id} must ship its pinned source gear reference`);
  }
  assert.equal(Models.modelFor({ classToken: 'Warrior', spec: 'Arms' }).model.id, 'dps-warrior');
  assert.equal(Models.modelFor({ classToken: 'Rogue', spec: 'Subtlety' }).model.requiresTalentOverride, true);
  assert.equal(Models.raceFor({ player: { race: 'Troll' } }, {}, Models.modelFor({ classToken: 'Hunter', spec: 'BM' }).model).race, 'RaceTroll');
  assert.equal(Models.raceFor({ player: { race: 'Orc' } }, {}, Models.modelFor({ classToken: 'Mage', spec: 'Arcane' }).model).assumed, true);
  assert.equal(Models.raceFor({ sourceId: 4, player: { race: 'Orc' }, events: { data: [{ sourceID: 4, abilityGameID: 20554 }] } }, {}, Models.modelFor({ classToken: 'Mage', spec: 'Arcane' }).model).invalid, true, 'observed racials must not hide an invalid explicit race');

  result = await Sim.evaluateFight(raw({ events: { complete: false, data: [] } }));
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason, /Complete paginated/);

  result = await Sim.evaluateFight(raw({ player: { name: 'Mage', classToken: 'Mage', spec: 'Arcane', race: 'Orc' } }));
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason, /entered race is not valid/);

  const fixture = raw();
  fixture.events.data[0].talents = [{ id: 17 }, { id: 44 }, { id: 0 }];
  result = await Sim.evaluateFight(fixture);
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason, /21\/40\/0/);

  const eligible = raw();
  const info = Sim._internals.combatant(eligible);
  const built = Sim._internals.buildBaseline(eligible, info);
  const before = JSON.stringify(built.request);
  const mageModel = Models.modelFor({ classToken: 'Mage', spec: 'Arcane' }).model;
  const mageBaseline = Sim._internals.buildModelBaseline(raw({ player: { name: 'Mage', classToken: 'Mage', spec: 'Arcane' } }), Sim._internals.combatant(raw()), mageModel);
  const magePlayer = mageBaseline.request.raid.parties[0].players[0];
  assert(!magePlayer.dpsWarrior, 'generic model must not inherit Fury options');
  assert.equal(magePlayer.buffs.blessingOfKings, true);
  assert.equal(magePlayer.buffs.unleashedRage, false);
  assert.equal(mageBaseline.request.raid.buffs.bloodlust, false);
  assert.equal(mageBaseline.request.raid.buffs.arcaneBrilliance, false);
  assert.equal(Sim._internals.validTalentOverride(mageModel.talentsString, mageModel), true);
  assert.equal(Sim._internals.validTalentOverride('1-2-3', mageModel), false);
  assert.deepEqual(Sim._internals.talentTreeTotals(mageModel.talentsString), [40, 0, 21]);

  const retModel = Models.modelFor({ classToken: 'Paladin', spec: 'Retribution' }).model;
  const preparationBaseline = JSON.parse(before);
  const preparationGear = preparationBaseline.raid.parties[0].players[0].equipment.items;
  preparationGear[4].enchant = 0;
  preparationGear[8].enchant = 0;
  const preparationActions = Sim._internals.genericActions(preparationBaseline, new Set(), retModel);
  assert.deepEqual(preparationActions.filter(action => ['chestStats', 'legsNethercobra', 'bootsGeneric'].includes(action.id)).map(action => action.id), ['chestStats', 'legsNethercobra', 'bootsGeneric']);
  for (const [id, slot, enchant] of [['chestStats', 4, 2661], ['legsNethercobra', 8, 3012], ['bootsGeneric', 9, 2657]]) {
    const request = JSON.parse(JSON.stringify(preparationBaseline));
    Sim._internals.changes[id](request);
    assert.equal(request.raid.parties[0].players[0].equipment.items[slot].enchant, enchant, `${id} must apply the sourced enchant effect ID to its slot`);
  }
  const missingChest = JSON.parse(JSON.stringify(preparationBaseline));
  missingChest.raid.parties[0].players[0].equipment.items[4] = { id: 0, enchant: 0, gems: [] };
  assert(!Sim._internals.genericActions(missingChest, new Set(), retModel).some(action => action.id === 'chestStats'), 'an empty slot is not an enchant candidate');
  const enchantedLegs = JSON.parse(JSON.stringify(preparationBaseline));
  enchantedLegs.raid.parties[0].players[0].equipment.items[8].enchant = 3010;
  assert(!Sim._internals.genericActions(enchantedLegs, new Set(), retModel).some(action => action.id === 'legsNethercobra'), 'an already enchanted slot is not a candidate');

  const statsResult = values => ({ raidStats: { parties: [{ players: [{ finalStats: { stats: values } }] }] } });
  const baseFinal = Array(42).fill(0);
  const chestFinal = [...baseFinal]; chestFinal[0] = 8; chestFinal[1] = 7; chestFinal[3] = 6;
  const changedChest = JSON.parse(JSON.stringify(preparationBaseline));
  Sim._internals.changes.chestStats(changedChest);
  const chestProof = Sim._internals.enchantScenarioProof('chestStats', preparationBaseline, changedChest, statsResult(baseFinal), statsResult(chestFinal));
  assert.equal(chestProof.pass, true);
  assert.deepEqual(chestProof.statDeltas, { strength: 8, agility: 7, intellect: 6 });
  const noStatChange = Sim._internals.enchantScenarioProof('chestStats', preparationBaseline, changedChest, statsResult(baseFinal), statsResult(baseFinal));
  assert.equal(noStatChange.pass, false, 'setting an enchant ID without a final-stat change is not proof');
  const alreadyEnchantedBaseline = JSON.parse(JSON.stringify(preparationBaseline));
  alreadyEnchantedBaseline.raid.parties[0].players[0].equipment.items[4].enchant = 2792;
  assert.equal(Sim._internals.enchantScenarioProof('chestStats', alreadyEnchantedBaseline, changedChest, statsResult(baseFinal), statsResult(chestFinal)).pass, false, 'proof requires an unenchanted baseline slot');

  const itemDb = require('./data/tbc-item-db.json');
  assert.deepEqual(itemDb.enchants.find(enchant => enchant.effectId === 2661)?.stats, { 0: 6, 1: 6, 2: 6, 3: 6, 16: 6 });
  assert.deepEqual(itemDb.enchants.find(enchant => enchant.effectId === 3012)?.stats, { 17: 50, 18: 50, 21: 12 });
  result = await Sim.evaluateFight(raw({ player: { name: 'Rogue', classToken: 'Rogue', spec: 'Subtlety', talentSplit: [0, 20, 41] }, modelOverrides: { talentsString: Models.modelFor({ classToken: 'Rogue', spec: 'Subtlety' }).model.talentsString } }));
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason, /this pull records 0\/20\/41/);
  const simulated = { good: { dps: 110 }, zero: { dps: 100 }, bad: { dps: 90 }, failedPotion: { dps: 120 } };
  const definitions = ['good', 'zero', 'bad', 'failedPotion'].map(id => ({ id }));
  assert.deepEqual(Sim._internals.positiveDefinitions(definitions, simulated, scenario => scenario.dps, 100, { failedPotion: { pass: false } }).map(action => action.id), ['good']);
  assert.equal(Sim._internals.publishablePackage(definitions, [definitions[0]], 10), false, 'a package must not retain hidden scenario changes');
  assert.equal(Sim._internals.publishablePackage([definitions[0]], [definitions[0]], 0), false, 'a non-positive package must not be published');
  assert.equal(Sim._internals.exactStatAgreement({ pass: true, differences: { agility: 1, hitMelee: 0 } }), true);
  assert.equal(Sim._internals.exactStatAgreement({ pass: true, differences: { agility: 2, hitMelee: 0 } }), false, 'a coarse safety pass is not native final-stat agreement');
  assert.equal(Sim._internals.exactStatAgreement({ pass: true, differences: {} }), false, 'missing relevant stats are not exact agreement');
  const potionUser = raw();
  potionUser.events.data.push({ sourceID: 4, abilityGameID: 28507 });
  const potionBaseline = Sim._internals.buildBaseline(potionUser, Sim._internals.combatant(potionUser));
  assert.deepEqual(potionBaseline.request.raid.parties[0].players[0].consumables.potions, [22838]);
  assert(!Sim._internals.candidateActions(potionBaseline.request, potionBaseline.ids, potionBaseline.fight).some(action => action.id === 'haste'));
  const recordedConsumes = raw();
  recordedConsumes.events.data.push({ sourceID: 4, abilityGameID: 28508 }, { sourceID: 4, abilityGameID: 28520 });
  const recordedBaseline = Sim._internals.buildBaseline(recordedConsumes, Sim._internals.combatant(recordedConsumes));
  assert.equal(recordedBaseline.request.raid.parties[0].players[0].consumables.potId, 22839, 'Destruction Potion aura must map to its item');
  assert.equal(recordedBaseline.request.raid.parties[0].players[0].consumables.flaskId, 22854, 'Relentless Assault aura must not become Pure Death');
  const otherPlayerPotion = raw();
  otherPlayerPotion.tables = { casts: { data: [{ sourceID: 99, abilityGameID: 28507 }] } };
  const filteredBaseline = Sim._internals.buildBaseline(otherPlayerPotion, Sim._internals.combatant(otherPlayerPotion));
  assert(!filteredBaseline.request.raid.parties[0].players[0].consumables.potId, 'another actor potion must not become the player baseline');
  assert.equal(Sim._internals.combatant({ sourceId: 4, context: { members: [{ sourceID: 99, gear: [], talents: [] }] }, tables: {}, events: { data: [] } }), undefined);
  assert.equal(Sim._internals.statValidation({ raidStats: { parties: [{ players: [{ finalStats: { stats: [] } }] }] } }, {}).pass, false);
  const missingCombatantAp = raw();
  missingCombatantAp.events.data[0].attackPower = null;
  missingCombatantAp.events.data.push({ timestamp: 1000, type: 'cast', sourceID: 4, abilityGameID: 2687, attackPower: 2981 });
  const missingApInfo = Sim._internals.combatant(missingCombatantAp);
  assert.equal(Sim._internals.observedStats(missingCombatantAp, missingApInfo).attackPower, null, 'generic validation must not inherit a transient AP snapshot');
  assert.equal(Sim._internals.observedFuryStats(missingCombatantAp, missingApInfo).attackPower, 2981, 'calibrated Fury validation may use its exact pull-opening AP snapshot');
  const sunderUser = raw();
  sunderUser.context.debuffs = { data: { auras: [{ guid: 25225 }] } };
  assert.equal(Sim._internals.buildBaseline(sunderUser, Sim._internals.combatant(sunderUser)).request.raid.debuffs.sunderArmor, true);
  const haste = JSON.parse(before);
  Sim._internals.changes.haste(haste);
  assert.equal(JSON.stringify(built.request), before, 'scenario mutation must not alter baseline');
  assert.deepEqual(haste.raid.parties[0].players[0].consumables.potions, [22838]);
  assert.equal(haste.raid.parties[0].players[0].consumables.potId, 22838);
  const alternativePotion = JSON.parse(before);
  alternativePotion.raid.parties[0].players[0].consumables = { potId: 22839, potions: [22839] };
  Sim._internals.changes.haste(alternativePotion);
  assert.deepEqual(alternativePotion.raid.parties[0].players[0].consumables.potions, [22839, 22838]);

  const boots = JSON.parse(before);
  Sim._internals.changes.boots(boots);
  assert.equal(boots.raid.parties[0].players[0].equipment.items[9].enchant, 2657);
  assert.equal(JSON.stringify(built.request), before, 'gear scenario must not alter baseline');

  const dst = JSON.parse(before);
  dst.raid.parties[0].players[0].equipment.items[11].id = 30446;
  Sim._internals.changes.dst(dst);
  assert(dst.raid.parties[0].players[0].equipment.items.some(item => item.id === 28830));
  assert.equal(dst.raid.parties[0].players[0].dpsWarrior.options.classOptions.hasBsSolarianSapphire, false);
  assert.equal(JSON.stringify(built.request), before, 'trinket scenario must not alter baseline');

  const actions = Sim._internals.candidateActions(built.request, built.ids, built.fight);
  assert(actions.some(action => action.id === 'boots'));
  assert(actions.some(action => action.id === 'haste'));
  assert(actions.some(action => action.id === 'demonslaying'));

  const oldBin = process.env.WCL_SIM_BIN;
  const oldStats = process.env.WCL_SIM_STATS_BIN;
  process.env.WCL_SIM_BIN = '/definitely/missing/wowsimcli';
  process.env.WCL_SIM_STATS_BIN = '/definitely/missing/wowsimstats';
  result = await Sim.evaluateFight(raw());
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /not installed/);
  if (oldBin === undefined) delete process.env.WCL_SIM_BIN; else process.env.WCL_SIM_BIN = oldBin;
  if (oldStats === undefined) delete process.env.WCL_SIM_STATS_BIN; else process.env.WCL_SIM_STATS_BIN = oldStats;

  // Opt-in integration coverage runs each shipped native adapter against the
  // real pinned executable.  Unit tests stay fast; CI sets WCL_SIM_SMOKE=1.
  if (process.env.WCL_SIM_SMOKE === '1') {
    const originalIterations = process.env.WCL_SIM_ITERATIONS;
    process.env.WCL_SIM_ITERATIONS = '200';
    for (const model of Models.models) {
      const sourceGear = JSON.parse(fs.readFileSync(model.gear, 'utf8')).items;
      const simToWcl = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
      const wclGear = Array.from({ length: 19 }, () => ({}));
      sourceGear.forEach((item, index) => { wclGear[simToWcl[index]] = { id: item.id, permanentEnchant: item.enchant, gems: (item.gems || []).map(id => ({ id })) }; });
      assert.deepEqual(Sim._internals.normalizeGear(wclGear).map(item => [item.id, item.enchant, item.gems]), sourceGear.map(item => [item.id || 0, item.enchant || 0, item.gems || []]), `${model.id} WCL gear ordering must round-trip`);
      const candidate = raw({ player: { name: model.id, classToken: model.classToken, spec: model.specs[0] }, ...(model.requiresTalentOverride ? { modelOverrides: { talentsString: model.talentsString } } : {}) });
      candidate.events.data = [{ sourceID: 4, gear: wclGear, talents: [], auras: [] }];
      candidate.context.fights[0].name = 'Controlled smoke target';
      const native = await Sim.evaluateFight(candidate);
      if (model.role === 'TANK') {
        assert.equal(native.status, 'not-applicable', `${model.id} must use tank evidence instead of a no-incoming-damage threat model`);
        continue;
      }
      assert.equal(native.status, 'complete', `${model.id}: ${native.reason || JSON.stringify(native.validation)}`);
      assert(native.reproducibility.scenarios[0].iterations >= 200, `${model.id} did not execute`);
      assert(native.actions.every(action => action.impact.value > 0), `${model.id} returned a non-positive action`);
      assert(native.packages.every(pkg => pkg.impact.value > 0 && pkg.actionIds.every(id => native.actions.some(action => action.id === id))), `${model.id} returned a non-positive or ghost package`);
    }
    if (originalIterations === undefined) delete process.env.WCL_SIM_ITERATIONS; else process.env.WCL_SIM_ITERATIONS = originalIterations;
  }

  assert(fs.existsSync(require.resolve('./evaluation-sim/fury-template.json')));
  console.log('evaluation-sim tests: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
