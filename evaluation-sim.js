'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const Models = require('./evaluation-models');

const PINNED_COMMIT = '72e0c8a8feaf62da67add31090666773d6040f69';
const VERSION = `tbc-new@${PINNED_COMMIT}`;
const TEMPLATE = path.join(__dirname, 'evaluation-sim', 'fury-template.json');
const DEFAULT_BIN = path.join(__dirname, 'evaluation-sim', 'vendor', 'wowsimcli');
const DEFAULT_STATS_BIN = path.join(__dirname, 'evaluation-sim', 'vendor', 'wowsimstats');
const MAX_SECONDS = 45;
let queue = Promise.resolve();

const clone = value => JSON.parse(JSON.stringify(value));
const player = request => request.raid.parties[0].players[0];
const party = request => request.raid.parties[0].buffs;

function allObjects(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (!Array.isArray(value)) out.push(value);
  for (const child of Object.values(value)) allObjects(child, out);
  return out;
}

function combatant(raw) {
  const candidates = allObjects([raw.tables?.ci, raw.events]);
  return candidates.find(value => value.sourceID === raw.sourceId &&
    Array.isArray(value.gear) && Array.isArray(value.talents));
}

function observedStats(raw, info) {
  const fight = fightInfo(raw);
  const stableSpellSnapshot = allObjects(raw.events).find(value => value.sourceID === raw.sourceId &&
    Number.isFinite(value.spellPower) && value.spellPower > 0 && Number(value.timestamp) >= Number(fight?.startTime || 0) + 10000);
  // CombatantInfo has the authoritative static physical values. Event AP on
  // the first pull action can predate Demonslaying or other applied buffs, so
  // it is evidence only and never treated as a full-uptime reconstruction.
  return { ...info, spellPower: stableSpellSnapshot?.spellPower, spellPowerSnapshot: Boolean(stableSpellSnapshot) };
}

function observedFuryStats(raw, info) {
  if (Number.isFinite(info?.attackPower)) return info;
  const fight = fightInfo(raw);
  const attackPowerSnapshot = allObjects(raw.events).filter(value => value.sourceID === raw.sourceId &&
    Number.isFinite(value.attackPower) && value.attackPower > 0 && Number(value.timestamp) >= Number(fight?.startTime || 0))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))[0];
  return { ...info, attackPower: attackPowerSnapshot?.attackPower, attackPowerSnapshot: Boolean(attackPowerSnapshot) };
}

function abilityIds(value) {
  const ids = new Set();
  for (const object of allObjects(value)) {
    for (const key of ['abilityGameID', 'guid', 'ability']) {
      const id = typeof object[key] === 'object' ? object[key]?.guid : object[key];
      if (Number.isFinite(id)) ids.add(id);
    }
  }
  return ids;
}

function sourceAbilityIds(raw, extra) {
  const ids = new Set();
  for (const object of allObjects([raw.tables, raw.events, extra])) {
    if (Number.isFinite(object.sourceID) && object.sourceID !== raw.sourceId) continue;
    for (const key of ['abilityGameID', 'guid', 'ability']) {
      const id = typeof object[key] === 'object' ? object[key]?.guid : object[key];
      if (Number.isFinite(id)) ids.add(id);
    }
  }
  return ids;
}

function firstAuraStart(value, ids, fight) {
  for (const object of allObjects(value)) {
    if (!ids.has(Number(object.guid ?? object.abilityGameID ?? object.ability?.guid))) continue;
    const start = object.bands?.map(band => band.startTime).find(Number.isFinite);
    if (Number.isFinite(start)) return Math.max(0, (start - fight.startTime) / 1000);
  }
  return null;
}

function fightInfo(raw) {
  const fights = allObjects(raw.context).filter(value =>
    Number.isFinite(value.startTime) && Number.isFinite(value.endTime));
  return fights.find(value => value.id === raw.fightId) || fights[0];
}

function unsupported(reason) {
  return { status: 'unsupported', reason, actions: [], packages: [], assumptions: [], validation: {}, version: VERSION };
}

function unavailable(reason) {
  return { status: 'unavailable', reason, actions: [], packages: [], assumptions: [], validation: {}, version: VERSION };
}

function normalizeGear(gear) {
  // WCL's combatant-info order is inventory order (shirt and tabard included),
  // while WoWSims expects equipment order with back before chest/wrist/hands.
  const wclToSim = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
  return wclToSim.map(index => gear[index] || {}).map(item => ({
    id: Number(item?.id) || 0,
    enchant: Number(item?.permanentEnchant) || 0,
    gems: (item?.gems || []).map(gem => Number(gem.id)).filter(Boolean),
  }));
}

// WCL records use spell/aura IDs while the simulator consumes item IDs.  This
// deliberately maps only verified TBC pairs; unknown aura IDs never become a
// guessed consumable.
function applyRecordedConsumables(modeled, ids, info) {
  const consumables = modeled.consumables || (modeled.consumables = {});
  const choices = [
    ['potId', 22838, [28507, 22838]], // Haste Potion (spell, item)
    ['potId', 22839, [28508, 22839]], // Destruction Potion
    ['potId', 22832, [17531, 22832]], // Super Mana Potion
    ['flaskId', 22854, [28520, 22854]], // Flask of Relentless Assault
    ['flaskId', 22866, [28540, 22866]], // Flask of Pure Death
    ['flaskId', 22861, [28521, 46840, 22861]], // Flask of Blinding Light, including Shattrath flask aura
    ['battleElixirId', 22831, [28497, 22831]], // Elixir of Major Agility
    ['battleElixirId', 9224, [11406, 9224]], // Elixir of Demonslaying
    ['battleElixirId', 28103, [33721, 28103]], // Adept's Elixir
    ['battleElixirId', 22545, [28503, 22545]], // Elixir of Major Shadow Power
    ['foodId', 27658, [33256, 27658]], // Roasted Clefthoof
    ['foodId', 27657, [33254, 33263, 27657]], // Blackened Basilisk
    ['foodId', 27659, [33261, 27659]], // Warp Burger
  ];
  for (const [field, item, evidence] of choices) {
    if (!evidence.some(id => ids.has(id))) continue;
    consumables[field] = item;
    if (field === 'potId') consumables.potions = [...new Set([...(consumables.potions || []), item])];
  }
  const imbues = new Map([
    [2628, 25122], // Brilliant Wizard Oil
    [2678, 28017], // Superior Wizard Oil
    [2713, 29453], // Adamantite Sharpening Stone
    [2955, 34340], // Adamantite Weightstone
    [2643, 27186], // Deadly Poison VII
  ]);
  const mhImbue = imbues.get(Number(info.gear?.[15]?.temporaryEnchant));
  const ohImbue = imbues.get(Number(info.gear?.[16]?.temporaryEnchant));
  if (mhImbue) consumables.mhImbueId = mhImbue;
  if (ohImbue) consumables.ohImbueId = ohImbue;
}

function selectPotion(request, itemId) {
  const consumes = player(request).consumables;
  consumes.potId = itemId;
  consumes.potions = [...new Set([...(consumes.potions || []), itemId])];
}

function buildBaseline(raw, info) {
  const request = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const modeled = player(request);
  modeled.name = `${raw.name || raw.player?.name || 'Warrior'} model`;
  modeled.equipment.items = normalizeGear(info.gear);
  modeled.race = 'RaceOrc';
  modeled.consumables = {};

  // FIGHT_QUERY context contains every raid member. Only the source-filtered
  // player tables/events may establish personal and party buffs.
  const ids = sourceAbilityIds(raw, info.auras);
  const debuffs = abilityIds(raw.context?.debuffs || []);
  const auras = abilityIds(info.auras || []);
  applyRecordedConsumables(modeled, ids, info);

  modeled.buffs.blessingOfKings = ids.has(25898);
  modeled.buffs.blessingOfMight = ids.has(27141) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  modeled.buffs.blessingOfSalvation = ids.has(25895);
  modeled.buffs.unleashedRage = ids.has(30807);
  modeled.dpsWarrior.options.classOptions.hasBsSolarianSapphire = info.gear.some(item => item?.id === 30446);

  const pb = party(request);
  pb.windfuryTotem = ids.has(25584) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  // WCL's combatant snapshot includes these stats but commonly omits their
  // long-lived aura rows. They are inferred, then checked against final stats.
  pb.strengthOfEarthTotem = 'TristateEffectRegular';
  pb.graceOfAirTotem = ids.has(33077) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.leaderOfThePack = ids.has(24932) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.sanctityAura = ids.has(20218) ? 'TristateEffectImproved' : 'TristateEffectMissing';

  request.raid.buffs.bloodlust = ids.has(2825) || ids.has(32182);
  request.raid.buffs.arcaneBrilliance = ids.has(27127);
  request.raid.buffs.giftOfTheWild = 'TristateEffectRegular';

  request.raid.debuffs = {
    exposeArmor: debuffs.has(26866) ? 'TristateEffectImproved' : 'TristateEffectMissing',
    sunderArmor: debuffs.has(25225) && !debuffs.has(26866),
    faerieFire: debuffs.has(26993) ? 'TristateEffectRegular' : 'TristateEffectMissing',
    curseOfRecklessness: debuffs.has(27226),
    exposeWeaknessUptime: debuffs.has(34501) ? 0.9 : 0,
    exposeWeaknessHunterAgility: debuffs.has(34501) ? 900 : 0,
  };

  const fight = fightInfo(raw);
  request.encounter.duration = (fight.endTime - fight.startTime) / 1000;
  request.encounter.durationVariation = 0;
  request.encounter.executeProportion20 = 0.2;
  request.encounter.targets[0].name = fight.name || 'Boss model';
  request.encounter.targets[0].mobType = 'MobTypeDemon';
  request.encounter.targets[0].stats[31] = 6200;
  const bloodlustAt = firstAuraStart(raw.tables, new Set([2825, 32182]), fight);
  const bloodlustVariable = allObjects(request).find(value => value.name === 'Bloodlust time' && value.value?.const);
  if (bloodlustVariable && bloodlustAt !== null) bloodlustVariable.value.const.val = `${bloodlustAt.toFixed(3)}s`;
  request.simOptions.iterations = Math.max(200, Math.min(10000, Number(process.env.WCL_SIM_ITERATIONS) || 10000));
  request.simOptions.randomSeed = '20260910';
  return { request, ids, fight, bloodlustAt };
}

const changes = {
  boots(request) {
    const boots = player(request).equipment.items[9];
    if (boots) boots.enchant = 2657;
  },
  haste(request) {
    selectPotion(request, 22838);
  },
  demonslaying(request) { player(request).consumables.battleElixirId = 9224; },
  dst(request) {
    const trinket = player(request).equipment.items.find(item => item.id === 30446);
    if (trinket) Object.assign(trinket, { id: 28830, enchant: 0, gems: [] });
    player(request).dpsWarrior.options.classOptions.hasBsSolarianSapphire = false;
  },
  lotp(request) { party(request).leaderOfThePack = 'TristateEffectRegular'; },
  ur(request) { player(request).buffs.unleashedRage = true; },
  wrath(request) { party(request).wrathOfAirTotem = 'TristateEffectRegular'; },
  might(request) { player(request).buffs.blessingOfMight = 'TristateEffectImproved'; },
  flaskAssault(request) { const consumes = player(request).consumables; consumes.flaskId = 22854; delete consumes.battleElixirId; delete consumes.guardianElixirId; },
  flaskDeath(request) { const consumes = player(request).consumables; consumes.flaskId = 22866; delete consumes.battleElixirId; delete consumes.guardianElixirId; },
  flaskLight(request) { const consumes = player(request).consumables; consumes.flaskId = 22861; delete consumes.battleElixirId; delete consumes.guardianElixirId; },
  destructionPot(request) { selectPotion(request, 22839); },
  manaPot(request) { selectPotion(request, 22832); },
  foodMelee(request) { player(request).consumables.foodId = 27658; },
  foodCaster(request) { player(request).consumables.foodId = 27657; },
  foodHunter(request) { player(request).consumables.foodId = 27659; },
  chestStats(request) { const chest = player(request).equipment.items[4]; if (chest) chest.enchant = 2661; },
  legsNethercobra(request) { const legs = player(request).equipment.items[8]; if (legs) legs.enchant = 3012; },
  bootsGeneric(request) { const boots = player(request).equipment.items[9]; if (boots) boots.enchant = 2657; },
};

function command(file, args, timeout = MAX_SECONDS * 1000) {
  return new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout);
  }));
}

async function checkedBinaries() {
  const sim = process.env.WCL_SIM_BIN || DEFAULT_BIN;
  const stats = process.env.WCL_SIM_STATS_BIN || DEFAULT_STATS_BIN;
  if (!fs.existsSync(sim) || !fs.existsSync(stats)) throw new Error('WoWSims runner is not installed; run evaluation-sim/build.sh during deployment');
  const reported = (await command(sim, ['version'], 5000)).trim();
  if (reported !== PINNED_COMMIT && reported !== VERSION && process.env.WCL_SIM_ALLOW_DEVELOPMENT !== '1') {
    throw new Error(`WoWSims runner version ${reported || 'unknown'} does not match pinned ${PINNED_COMMIT}`);
  }
  return { sim, stats, reported };
}

async function withTempRequest(request, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wcl-eval-sim-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'output.json');
  try {
    fs.writeFileSync(input, JSON.stringify(request));
    return await callback(input, output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function computeStats(request, binary) {
  return withTempRequest(request, async input => JSON.parse(await command(binary, [input])));
}

async function simulate(request, binary) {
  return withTempRequest(request, async (input, output) => {
    await command(binary, ['sim', '--infile', input, '--outfile', output]);
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (result.error) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
    const metrics = result.raidMetrics?.parties?.[0]?.players?.[0];
    if (!metrics?.dps) throw new Error('WoWSims returned no player DPS metrics');
    return { result, metrics, dps: metrics.dps.avg, iterations: result.iterationsDone };
  });
}

function statValidation(stats, info) {
  const final = stats.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.stats;
  if (!final) return { pass: false, reason: 'stats helper returned no final stats' };
  const expected = { strength: info.strength, agility: info.agility, intellect: info.intellect,
    attackPower: info.attackPower, hit: info.hitMelee, crit: info.critMelee };
  if (Object.values(expected).some(value => !Number.isFinite(value))) {
    return { pass: false, reason: 'All six observed stats are required to validate the reconstructed character.', expected };
  }
  const modeled = { strength: final[0], agility: final[1], intellect: final[3], attackPower: final[17], hit: final[20], crit: final[21] };
  const differences = Object.fromEntries(Object.keys(expected).filter(key => Number.isFinite(expected[key]))
    .map(key => [key, Math.round((modeled[key] - expected[key]) * 10) / 10]));
  const pass = Object.values(differences).every(value => Math.abs(value) <= 1);
  return { pass, expected, modeled, differences };
}

function potionProof(simulation) {
  const action = simulation.metrics.actions?.find(value => value.id?.itemId === 22838);
  const aura = simulation.metrics.auras?.find(value => value.id?.itemId === 22838 || value.id?.spellId === 28507);
  const casts = action ? action.targets.reduce((sum, target) => sum + target.casts, 0) / simulation.iterations : 0;
  return { casts, uptimeSeconds: aura?.uptimeSecondsAvg || 0, pass: casts >= 0.99 && (aura?.uptimeSecondsAvg || 0) >= 14.9 };
}

function potionUseProof(simulation, itemId) {
  const action = simulation.metrics.actions?.find(value => value.id?.itemId === itemId);
  const casts = action ? action.targets.reduce((sum, target) => sum + target.casts, 0) / simulation.iterations : 0;
  return { casts, pass: casts >= 0.99 };
}

function candidateActions(base, ids, fight) {
  const gear = player(base).equipment.items;
  const result = [];
  if (gear[9] && !gear[9].enchant) result.push({ id: 'boots', title: 'Enchant boots', owner: 'player', change: 'Add Enchant Boots – Dexterity (+12 Agility).', when: 'Before the next raid', evidence: ['The combatant snapshot records no permanent boot enchant.'], caveats: ['A movement-speed enchant can be better on movement-heavy encounters; this full-contact model tests +12 Agility.'] });
  if (!ids.has(28507) && !ids.has(22838)) result.push({ id: 'haste', title: 'Use a planned Haste Potion', owner: 'player', change: 'Use a Haste Potion during a safe melee burst window; on longer fights, use it again when the cooldown and encounter allow.', when: 'During Bloodlust or another uninterrupted 15-second contact window', evidence: ['No Haste Potion cast or active aura was recorded.'], caveats: ['Potion cooldown may be needed for survival or control immunity.'] });
  if (fight.name?.toLowerCase().includes('anetheron') && player(base).consumables.battleElixirId !== 9224) result.push({ id: 'demonslaying', title: 'Use Elixir of Demonslaying', owner: 'player', change: 'Replace the current battle elixir with Elixir of Demonslaying for this demon boss.', when: 'Apply shortly before the boss after Hyjal waves', evidence: ['The encounter is modeled as a demon and another battle elixir is recorded.'], caveats: ['The five-minute elixir can expire during waves; it does not stack with another battle elixir.'] });
  if (gear.some(item => item.id === 30446)) result.push({ id: 'dst', title: 'Test Dragonspine Trophy', owner: 'gear', change: 'If it is available, replace Solarian’s Sapphire with Dragonspine Trophy for this boss.', when: 'If the item is available, review the Battle Shout tradeoff with the raid leader before equipping it', evidence: ['The combatant snapshot has Solarian’s Sapphire equipped.'], caveats: ['The log cannot establish inventory ownership.', 'Removing Solarian’s Sapphire also removes its party-wide enhanced Battle Shout value; the model drops that enhancement.'] });
  if (party(base).leaderOfThePack !== 'TristateEffectRegular') result.push({ id: 'lotp', title: 'Add Leader of the Pack support', owner: 'raid', change: 'Place the warrior with a Feral Druid when raid composition permits.', when: 'For sustained boss contact', evidence: ['No Leader of the Pack aura was recorded for the player.'], caveats: ['This is a raid-allocation result and may move damage away from another group.'] });
  if (!player(base).buffs.unleashedRage) result.push({ id: 'ur', title: 'Add Unleashed Rage support', owner: 'raid', change: 'Use an Enhancement Shaman melee group with reliable proximity.', when: 'For sustained boss contact', evidence: ['No Unleashed Rage aura was recorded for the player.'], caveats: ['The model assumes full uptime; real uptime depends on shaman crits, range, and survival.'] });
  return result;
}

async function runFuryEvaluation(raw, options) {
  if (!raw || String(raw.player?.classToken || '').toLowerCase() !== 'warrior') return unsupported('Simulation currently supports Warrior only.');
  if (String(raw.player?.spec || '').toLowerCase() !== 'fury') return unsupported('The recorded pull must identify the player as Fury.');
  if (!raw.events?.complete || !raw.incoming?.complete) return unsupported('Complete paginated player and incoming events are required.');
  const info = combatant(raw);
  if (!info?.gear || !Array.isArray(info.talents)) return unsupported('A complete combatant snapshot with gear and talents is required.');
  if (info.gear.length !== 19 || !info.gear[15]?.id || !info.gear[16]?.id) return unsupported('A complete dual-wield equipment snapshot is required.');
  if (info.gear[16]?.temporaryEnchant && info.gear[16].temporaryEnchant !== 2713) return unsupported('This off-hand weapon imbue is not yet modeled by the validated Fury adapter.');
  const talentSplit = info.talents.map(value => Number(value.id ?? value));
  if (talentSplit.join('/') !== '21/40/0') return unsupported(`Only the validated 21/40/0 Fury build is supported; recorded ${talentSplit.join('/') || 'unknown'}.`);
  const fight = fightInfo(raw);
  if (!fight || !/anetheron/i.test(fight.name || '')) return unsupported('The first validated encounter model supports Anetheron only.');
  if (!abilityIds(raw.events).has(20572)) return unsupported('The first validated model supports Orc Fury warriors with observed Blood Fury only.');

  let binaries;
  try { binaries = await checkedBinaries(); } catch (error) { return unavailable(error.message); }
  const { request: baseline, ids, bloodlustAt } = buildBaseline(raw, info);
  options.onProgress?.('Validating the reconstructed character stats.');
  let stats;
  try { stats = await computeStats(baseline, binaries.stats); } catch (error) { return unavailable(`WoWSims stats validation failed: ${error.message}`); }
  // The calibrated Fury adapter validates the exact pull-opening AP snapshot.
  // WCL omits AP from some CombatantInfo rows, while its first positive source
  // event retains the same fully reconstructed static AP used by this adapter.
  const statCheck = statValidation(stats, observedFuryStats(raw, info));
  if (!statCheck.pass) return unsupported(statCheck.reason || `Modeled character stats do not match the combatant snapshot: ${JSON.stringify(statCheck.differences)}`);

  const definitions = candidateActions(baseline, ids, fight);
  const scenarios = [{ id: 'baseline', request: baseline }];
  for (const definition of definitions) {
    const request = clone(baseline);
    changes[definition.id](request);
    scenarios.push({ id: definition.id, request });
  }
  const packageGroups = {
    personal: definitions.filter(action => action.owner !== 'raid' && action.id !== 'dst'),
    support: definitions.filter(action => action.owner === 'raid'),
    recommended: definitions.filter(action => action.id !== 'dst'),
    withDst: definitions,
  };
  for (const [id, actions] of Object.entries(packageGroups)) {
    if (!actions.length) continue;
    const request = clone(baseline);
    actions.forEach(action => changes[action.id](request));
    scenarios.push({ id, request });
  }

  const simulations = {};
  try {
    for (let index = 0; index < scenarios.length; index += 1) {
      options.onProgress?.(`Running simulation ${index + 1} of ${scenarios.length}: ${scenarios[index].id}.`);
      simulations[scenarios[index].id] = await simulate(scenarios[index].request, binaries.sim);
    }
  } catch (error) { return unavailable(`WoWSims execution failed: ${error.message}`); }

  const baselineDps = simulations.baseline.dps;
  const actions = definitions.map(definition => ({ ...definition, gainDps: Math.round(simulations[definition.id].dps - baselineDps) }))
    .filter(action => action.gainDps > 0);
  const potion = definitions.some(action => action.id === 'haste') ? potionProof(simulations.haste) : null;
  if (potion && !potion.pass) return unavailable('Haste Potion scenario failed its cast and 15-second aura invariant.');
  if (potion) {
    const action = actions.find(a => a.id === 'haste');
    action.when = bloodlustAt === null ? action.when : `Begin near ${bloodlustAt.toFixed(1)} seconds, with Bloodlust or Heroism and sustained melee contact.`;
    action.evidence.push(`This estimate models ${potion.casts.toFixed(1)} potion uses and ${potion.uptimeSeconds.toFixed(1)} seconds of potion uptime per fight.`);
  }
  options.onProgress?.('Simulation comparisons complete.');
  return {
    status: 'complete', baselineDps: Math.round(baselineDps), actions,
    coverage: { kind: 'conditional', spec: raw.player.spec, reason: 'The calibrated Fury adapter assumes the pinned 21/40 profile; detailed talent ranks are not present in normal WCL combatant information.' },
    packages: [
      packageGroups.personal.length && { id: 'personal', title: 'Personal preparation', actionIds: packageGroups.personal.map(action => action.id), gainDps: Math.round(simulations.personal.dps - baselineDps) },
      packageGroups.support.length && { id: 'support', title: 'Melee party support', actionIds: packageGroups.support.map(action => action.id), gainDps: Math.round(simulations.support.dps - baselineDps) },
      packageGroups.recommended.length && { id: 'recommended', title: 'Preparation and melee support', actionIds: packageGroups.recommended.map(action => action.id), gainDps: Math.round(simulations.recommended.dps - baselineDps) },
      packageGroups.withDst.length !== packageGroups.recommended.length && { id: 'with-dst', title: 'Preparation, support and Dragonspine Trophy', actionIds: packageGroups.withDst.map(action => action.id), gainDps: Math.round(simulations.withDst.dps - baselineDps) },
    ].filter(pkg => pkg && pkg.gainDps > 0 && pkg.actionIds.every(id => actions.some(action => action.id === id))),
    assumptions: ['Anetheron is modeled as a level-73 demon with 6,200 base armor.', 'Regular Gift of the Wild and Strength of Earth are inferred from the combatant stats because WCL omits their long-duration aura rows; exact final-stat agreement is required.', 'Sanctity Aura talent rank is not exposed by WCL; an observed aura is modeled as improved.', 'The model assumes full melee contact and averages combat outcomes.', 'Observed armor debuffs are modeled at full strength and uptime: improved Expose Armor or five Sunder Armor stacks. Opening delays are not reconstructed.', 'Observed Expose Weakness is modeled at 90% uptime with an assumed 900 hunter Agility.', 'Detailed talent ranks are unknown; the pinned 21/40/0 allocation is an assumption. Execute occupies an assumed final 20% of fight duration.', 'Recorded Haste Potion use is retained in the baseline. Potion and personal cooldown timings follow the model rotation, including repeat uses on longer fights; this is not an exact replay.', bloodlustAt === null ? 'Bloodlust timing was unavailable; the pinned APL fallback is 17 seconds.' : `Bloodlust starts at the observed ${bloodlustAt.toFixed(1)}-second mark.`, 'Leader of the Pack and Unleashed Rage scenarios assume full uptime.', 'The default 21/40 Fury APL is a decision benchmark, not a replay of the player’s casts.'],
    validation: { stats: statCheck, iterations: simulations.baseline.iterations, runnerVersion: binaries.reported, potion, baselineMatchesStatsOnly: true, dpsMatchIsNotValidation: true },
    reproducibility: {
      baselineInput: baseline,
      scenarios: scenarios.map(scenario => ({
        id: scenario.id,
        changes: scenario.id === 'baseline' ? [] : packageGroups[scenario.id]?.map(action => action.id) || [scenario.id],
        inputHash: crypto.createHash('sha256').update(JSON.stringify(scenario.request)).digest('hex'),
        dps: simulations[scenario.id].dps,
        standardDeviation: simulations[scenario.id].metrics.dps.stdev,
        iterations: simulations[scenario.id].iterations,
      })),
    },
    version: VERSION,
  };
}

function encounterModel(raw, fight, request) {
  const encounter = raw.encounter || {};
  const duration = Number(encounter.duration || ((fight.endTime - fight.startTime) / 1000));
  const target = request.encounter.targets[0];
  target.name = encounter.name || fight.name || 'Single target model';
  const mobTypes = { demon: 'MobTypeDemon', humanoid: 'MobTypeHumanoid', undead: 'MobTypeUndead', dragonkin: 'MobTypeDragonkin', elemental: 'MobTypeElemental' };
  const explicitMobType = mobTypes[String(encounter.mobType || '').toLowerCase()];
  const nameImpliesDemon = String(target.name).toLowerCase().includes('demon');
  target.mobType = explicitMobType || (nameImpliesDemon ? 'MobTypeDemon' : 'MobTypeHumanoid');
  const hasArmor = encounter.armor !== null && encounter.armor !== undefined && encounter.armor !== '' && Number.isFinite(Number(encounter.armor));
  target.stats[31] = hasArmor ? Number(encounter.armor) : 6200;
  request.encounter.duration = Math.max(20, duration);
  request.encounter.durationVariation = 0;
  return { duration: request.encounter.duration, model: encounter.model || 'unknown', mobType: target.mobType, mobTypeSource: explicitMobType ? 'encounter metadata' : nameImpliesDemon ? 'boss-name inference' : 'generic controlled-target default', armor: target.stats[31], armorSource: hasArmor ? 'encounter metadata' : 'generic controlled-target default', limitations: [...(encounter.limitations || []), encounter.model === 'multi-target' ? 'Adds and target availability are not replayed; this remains a single controlled target.' : null].filter(Boolean) };
}

function buildModelBaseline(raw, info, model) {
  const request = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const modeled = player(request);
  const fight = fightInfo(raw);
  const race = Models.raceFor(raw, info, model);
  modeled.name = `${raw.name || raw.player?.name || model.id} model`;
  modeled.class = model.className;
  modeled.race = race.race;
  // fury-template.json is only a protobuf envelope. Reset every player/raid
  // knob it carries before applying source-filtered evidence for this model.
  delete modeled.dpsWarrior;
  modeled.buffs = {};
  modeled.cooldowns = {};
  modeled.itemSwap = undefined;
  modeled.bonusStats = undefined;
  delete modeled.profession1;
  delete modeled.profession2;
  modeled.distanceFromTarget = ['mage', 'mage-fire', 'mage-frost', 'shadow-priest', 'warlock-affliction', 'warlock-demonology', 'warlock-destruction', 'balance-druid', 'elemental-shaman', 'hunter-bm', 'hunter-sv', 'hunter-mm'].includes(model.id) ? 20 : 0;
  modeled.inFrontOfTarget = model.role === 'TANK';
  modeled[model.playerKey] = clone(model.options);
  if (model.id === 'dps-warrior') {
    const classOptions = modeled.dpsWarrior.options.classOptions;
    const wrathPieces = new Set([16959, 16960, 16961, 16962, 16963, 16964, 16965, 16966]);
    classOptions.hasBsT2 = info.gear.filter(item => wrathPieces.has(Number(item?.id))).length >= 3;
    classOptions.hasBsSolarianSapphire = info.gear.some(item => Number(item?.id) === 30446);
  }
  modeled.talentsString = raw.modelOverrides?.talentsString || model.talentsString;
  modeled.rotation = JSON.parse(fs.readFileSync(model.apl, 'utf8'));
  modeled.equipment.items = normalizeGear(info.gear);
  modeled.consumables = {};
  const ids = sourceAbilityIds(raw, info.auras);
  applyRecordedConsumables(modeled, ids, info);
  modeled.buffs.blessingOfKings = ids.has(25898);
  modeled.buffs.blessingOfSalvation = ids.has(25895);
  modeled.buffs.blessingOfMight = ids.has(27141) ? 'TristateEffectImproved' : 'TristateEffectMissing';
  modeled.buffs.blessingOfWisdom = ids.has(27143) ? 'TristateEffectImproved' : 'TristateEffectMissing';
  request.raid.parties[0].buffs = {};
  request.raid.buffs = {};
  const pb = party(request);
  pb.windfuryTotem = ids.has(25584) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.graceOfAirTotem = ids.has(33077) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.leaderOfThePack = ids.has(24932) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.wrathOfAirTotem = (ids.has(2895) || ids.has(3738)) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.battleShout = ids.has(2048) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.strengthOfEarthTotem = ids.has(33082) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.moonkinAura = ids.has(24907) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  pb.sanctityAura = ids.has(20218) ? 'TristateEffectImproved' : 'TristateEffectMissing';
  pb.bloodPact = ids.has(27268) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  modeled.buffs.unleashedRage = ids.has(30807);
  request.raid.buffs.bloodlust = ids.has(2825) || ids.has(32182);
  request.raid.buffs.arcaneBrilliance = ids.has(27127);
  request.raid.buffs.powerWordFortitude = ids.has(25392) ? 'TristateEffectImproved' : 'TristateEffectMissing';
  request.raid.buffs.giftOfTheWild = ids.has(26991) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  request.raid.buffs.divineSpirit = ids.has(32999) ? 'TristateEffectRegular' : 'TristateEffectMissing';
  request.raid.debuffs = {
    exposeArmor: abilityIds(raw.context?.debuffs || []).has(26866) ? 'TristateEffectImproved' : 'TristateEffectMissing',
    sunderArmor: abilityIds(raw.context?.debuffs || []).has(25225) && !abilityIds(raw.context?.debuffs || []).has(26866),
    faerieFire: abilityIds(raw.context?.debuffs || []).has(26993) ? 'TristateEffectRegular' : 'TristateEffectMissing',
    curseOfRecklessness: abilityIds(raw.context?.debuffs || []).has(27226),
  };
  const encounter = encounterModel(raw, fight, request);
  request.simOptions.iterations = Math.max(200, Math.min(10000, Number(process.env.WCL_SIM_ITERATIONS) || 10000));
  request.simOptions.randomSeed = '20260910';
  return { request, ids, fight, race, encounter };
}

function genericStatValidation(stats, info, model = {}) {
  const final = stats.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.stats;
  if (!final) return { pass: false, severe: true, reason: 'stats helper returned no final stats' };
  const caster = ['mage', 'mage-fire', 'mage-frost', 'shadow-priest', 'warlock-affliction', 'warlock-demonology', 'warlock-destruction', 'balance-druid', 'elemental-shaman'].includes(model.id);
  const hunter = ['hunter-bm', 'hunter-sv', 'hunter-mm'].includes(model.id);
  const fields = caster
    ? [['intellect', 3], ['spirit', 16], ['spellPower', 5], ['hitSpell', 12], ['critSpell', 13]]
    : hunter ? [['agility', 1], ['intellect', 3], ['hitRanged', 20], ['critRanged', 21]]
      : [['strength', 0], ['agility', 1], ['attackPower', 17], ['hitMelee', 20], ['critMelee', 21]];
  const defensive = [['stamina', 2]];
  const expected = Object.fromEntries(fields.filter(([key]) => Number.isFinite(info[key])).map(([key]) => [key, info[key]]));
  const defensiveExpected = Object.fromEntries(defensive.filter(([key]) => Number.isFinite(info[key])).map(([key]) => [key, info[key]]));
  if (!Object.keys(expected).length) return { pass: null, severe: false, reason: 'Relevant combatant stats were not present; model remains conditional and does not claim stat agreement.' };
  const differences = Object.fromEntries(fields.filter(([key]) => key in expected).map(([key, index]) => [key, Math.round((final[index] - expected[key]) * 10) / 10]));
  const defensiveDifferences = Object.fromEntries(defensive.filter(([key]) => key in defensiveExpected).map(([key, index]) => [key, Math.round((final[index] - defensiveExpected[key]) * 10) / 10]));
  const severe = Object.entries(differences).some(([key, difference]) => Math.abs(difference) > Math.max(40, Math.abs(expected[key]) * 0.25));
  return { pass: !severe, severe, expected, modeled: Object.fromEntries(fields.filter(([key, index]) => key in expected).map(([key, index]) => [key, final[index]])), differences, defensive: { expected: defensiveExpected, differences: defensiveDifferences, limitation: Object.values(defensiveDifferences).some(value => Math.abs(value) > 1) ? 'Defensive stats differ; no survival or mitigation claim is made.' : undefined } };
}

function validTalentOverride(value, model) {
  let trees;
  try { trees = require(path.join(__dirname, 'evaluation-sim', 'talents', `${model.classToken}.json`)); } catch { return false; }
  const supplied = String(value).split('-');
  if (supplied.length > trees.length || supplied.some(tree => !/^\d*$/.test(tree))) return false;
  let total = 0;
  for (let treeIndex = 0; treeIndex < trees.length; treeIndex += 1) {
    const talents = trees[treeIndex].talents;
    const points = [...(supplied[treeIndex] || '')].map(Number);
    if (points.length > talents.length) return false;
    for (let index = 0; index < points.length; index += 1) {
      const talent = talents[index];
      const rank = points[index];
      if (rank > talent.maxPoints) return false;
      const spentBeforeTier = points.slice(0, index).reduce((sum, point) => sum + point, 0);
      if (rank && spentBeforeTier < talent.location.rowIdx * 5) return false;
      if (rank && talent.prereqLocation) {
        const prerequisite = talents.find(candidate => candidate.location.rowIdx === talent.prereqLocation.rowIdx && candidate.location.colIdx === talent.prereqLocation.colIdx);
        const prerequisiteIndex = talents.indexOf(prerequisite);
        if (prerequisiteIndex < 0 || points[prerequisiteIndex] !== prerequisite.maxPoints) return false;
      }
      total += rank;
    }
  }
  return total === 61;
}

function talentTreeTotals(value) {
  return String(value).split('-').map(tree => [...tree].reduce((sum, rank) => sum + Number(rank), 0));
}

function modelOptionAssumptions(model, modeled) {
  if (['hunter-bm', 'hunter-sv', 'hunter-mm'].includes(model.id)) return ["Hunter settings assume Warden's Arrows, a 15% quiver, and a Ravager pet with 100% uptime."];
  if (['mage', 'mage-fire', 'mage-frost'].includes(model.id)) return ['Mage Armor is the pinned source model default.'];
  if (model.id === 'shadow-priest') return ['The pinned source model starts in Shadowform.'];
  if (model.id === 'enhancement-shaman') return ['Both weapons use Windfury Weapon and the off-hand swing uses the pinned delayed-sync setting.'];
  if (model.id === 'warlock-affliction') return ['The model uses Fel Armor, an active Imp, and Curse of the Elements without Demonic Sacrifice.'];
  if (model.id === 'warlock-demonology') return ['The model uses Fel Armor, an active Succubus, and Curse of Recklessness without Demonic Sacrifice.'];
  if (model.id === 'warlock-destruction') return ['The model uses Fel Armor, sacrifices a Succubus, and uses Curse of Recklessness.'];
  if (['rogue', 'rogue-assassination', 'rogue-subtlety'].includes(model.id)) {
    const names = new Map([[26891, 'Instant Poison VII'], [27186, 'Deadly Poison VII'], [27188, 'Wound Poison VII']]);
    const imbues = [['main hand', modeled.consumables.mhImbueId], ['off hand', modeled.consumables.ohImbueId]]
      .filter(([, id]) => names.has(id)).map(([hand, id]) => `${hand} ${names.get(id)}`);
    return imbues.length ? [`Rogue poison settings reconstructed from the logged temporary weapon enchants: ${imbues.join(', ')}.`] : ['No supported rogue poison was identifiable from the logged temporary weapon enchants; modeled poison damage may be understated.'];
  }
  if (model.id === 'dps-warrior') {
    const options = modeled.dpsWarrior.options.classOptions;
    return [`The warrior starts with 50 rage in Berserker Stance and uses the pinned stance-snapshot setting. The Tier 2 Battle Shout bonus is ${options.hasBsT2 ? 'enabled from at least three equipped Wrath pieces' : 'disabled because fewer than three Wrath pieces were recorded'}.`];
  }
  return [];
}

function genericActions(base, ids, model) {
  const actions = [];
  const caster = ['mage', 'mage-fire', 'mage-frost', 'shadow-priest', 'warlock-affliction', 'warlock-demonology', 'warlock-destruction', 'balance-druid', 'elemental-shaman'].includes(model.id);
  const hunter = ['hunter-bm', 'hunter-sv', 'hunter-mm'].includes(model.id);
  const melee = !caster && !hunter;
  if ((melee || hunter) && !ids.has(28507) && !ids.has(22838)) actions.push({ id: 'haste', title: 'Use a planned Haste Potion', owner: 'player', change: 'Use a Haste Potion during an uninterrupted physical damage or threat window.', when: 'During a sustained contact window', evidence: ['No Haste Potion cast or active aura was recorded.'], caveats: ['This controlled model retains the source APL and does not replay movement or mechanics.'] });
  const consumes = player(base).consumables;
  const pureDeath = ['mage-fire', 'mage-frost', 'shadow-priest', 'warlock-affliction', 'warlock-demonology', 'warlock-destruction'].includes(model.id);
  if (pureDeath && consumes.potId !== 22839) actions.push({ id: 'destructionPot', title: 'Use a planned Destruction Potion', owner: 'player', change: 'Use a Destruction Potion during an uninterrupted spell-damage window.', when: 'During a sustained casting window', evidence: ['No Destruction Potion cast or active aura was recorded.'], caveats: ['Only reported if the source APL actually casts it.'] });
  if (['mage', 'balance-druid', 'elemental-shaman'].includes(model.id) && consumes.potId !== 22832) actions.push({ id: 'manaPot', title: 'Use a planned Super Mana Potion', owner: 'player', change: 'Use a Super Mana Potion according to the source APL mana threshold.', when: 'When the source APL reaches its mana threshold', evidence: ['No Super Mana Potion cast or active aura was recorded.'], caveats: ['Only reported if the source APL actually casts it.'] });
  if (caster && party(base).wrathOfAirTotem !== 'TristateEffectRegular') actions.push({ id: 'wrath', title: 'Add Wrath of Air Totem', owner: 'raid', change: 'Place the caster with a Wrath of Air Totem when raid composition permits.', when: 'For sustained casting', evidence: ['No Wrath of Air Totem aura was recorded.'], caveats: ['This is a raid-allocation result.'] });
  if ((melee || hunter) && party(base).leaderOfThePack !== 'TristateEffectRegular') actions.push({ id: 'lotp', title: 'Add Leader of the Pack support', owner: 'raid', change: 'Place the player with a Feral Druid when raid composition permits.', when: 'For sustained contact', evidence: ['No Leader of the Pack aura was recorded.'], caveats: ['This is a raid-allocation result.'] });
  if (melee && !player(base).buffs.unleashedRage) actions.push({ id: 'ur', title: 'Add Unleashed Rage support', owner: 'raid', change: 'Place the player with an Enhancement Shaman when composition permits.', when: 'For sustained contact', evidence: ['No Unleashed Rage aura was recorded.'], caveats: ['The controlled model assumes full uptime.'] });
  const gear = player(base).equipment.items;
  if (gear[4]?.id && !gear[4].enchant) actions.push({ id: 'chestStats', title: 'Enchant chest with Exceptional Stats', owner: 'player', change: 'Add Enchant Chest – Exceptional Stats (+6 to all attributes).', when: 'Before the next raid', evidence: ['The equipment snapshot has an equipped chest with no permanent enchant.'], caveats: [] });
  if ((melee || hunter) && gear[8]?.id && !gear[8].enchant) actions.push({ id: 'legsNethercobra', title: 'Apply Nethercobra Leg Armor', owner: 'player', change: 'Add Nethercobra Leg Armor (+50 Attack Power and +12 Critical Strike Rating).', when: 'Before the next raid', evidence: ['The equipment snapshot has equipped legs with no permanent enchant.'], caveats: [] });
  if ((melee || hunter) && gear[9]?.id && !gear[9].enchant) actions.push({ id: 'bootsGeneric', title: 'Enchant boots with Dexterity', owner: 'player', change: 'Add Enchant Boots – Dexterity (+12 Agility).', when: 'Before the next raid', evidence: ['The equipment snapshot has equipped boots with no permanent enchant.'], caveats: ['Movement speed can be preferable on movement-heavy encounters.'] });
  return actions;
}

const enchantProofDefinitions = {
  chestStats: { slot: 4, enchant: 2661, stats: { strength: 0, agility: 1, intellect: 3 } },
  legsNethercobra: { slot: 8, enchant: 3012, stats: { attackPower: 17, rangedAttackPower: 18, critRating: 21 } },
  bootsGeneric: { slot: 9, enchant: 2657, stats: { agility: 1 } },
};

function enchantScenarioProof(id, baselineRequest, scenarioRequest, baselineStats, scenarioStats) {
  const definition = enchantProofDefinitions[id];
  if (!definition) return null;
  const baselineItem = player(baselineRequest).equipment.items[definition.slot];
  const scenarioItem = player(scenarioRequest).equipment.items[definition.slot];
  const baselineFinal = baselineStats?.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.stats;
  const scenarioFinal = scenarioStats?.raidStats?.parties?.[0]?.players?.[0]?.finalStats?.stats;
  const statDeltas = baselineFinal && scenarioFinal ? Object.fromEntries(Object.entries(definition.stats)
    .map(([name, index]) => [name, Math.round((scenarioFinal[index] - baselineFinal[index]) * 10) / 10])) : {};
  const equippedUnenchantedBaseline = Boolean(baselineItem?.id) && !baselineItem.enchant;
  const sameItem = Boolean(scenarioItem?.id) && scenarioItem.id === baselineItem?.id;
  const expectedEnchantApplied = scenarioItem?.enchant === definition.enchant;
  const statsChanged = Object.keys(statDeltas).length === Object.keys(definition.stats).length && Object.values(statDeltas).every(delta => delta > 0);
  return { pass: equippedUnenchantedBaseline && sameItem && expectedEnchantApplied && statsChanged,
    slot: definition.slot, itemId: baselineItem?.id || 0, baselineEnchant: baselineItem?.enchant || 0,
    scenarioEnchant: scenarioItem?.enchant || 0, expectedEnchant: definition.enchant, statDeltas };
}

function positiveDefinitions(definitions, simulations, metric, baselineValue, potionProofs = {}) {
  return definitions.filter(definition => (!potionProofs[definition.id] || potionProofs[definition.id].pass) &&
    Math.round(metric(simulations[definition.id]) - baselineValue) > 0);
}

function publishablePackage(group, active, gain) {
  return active.length > 0 && active.length === group.length && gain > 0;
}

function exactStatAgreement(statCheck) {
  const differences = Object.values(statCheck?.differences || {});
  return statCheck?.pass === true && differences.length > 0 && differences.every(value => Math.abs(value) <= 1);
}

async function runModelEvaluation(raw, options, model) {
  if (!raw.events?.complete) return unsupported('Complete paginated player events are required.');
  const info = combatant(raw);
  if (!info?.gear || !Array.isArray(info.gear) || info.gear.length < 16) return unsupported('A complete combatant equipment snapshot is required.');
  const fight = fightInfo(raw);
  if (!fight) return unsupported('Fight timing is required for a controlled encounter model.');
  const race = Models.raceFor(raw, info, model);
  if (race.invalid) return unsupported(`The entered race is not valid for ${raw.player.classToken}; correct it in Model settings.`);
  const override = raw.modelOverrides?.talentsString;
  if (model.requiresTalentOverride && !override) return unsupported(`${raw.player.spec} needs a detailed talent string in Model settings because normal WCL combatant data does not contain it for this rotation.`);
  if (override && !validTalentOverride(override, model)) return unsupported('The detailed talent string in Model settings must be a legal 61-point build for this class.');
  const observedTalentSplit = (raw.player?.talentSplit || info.talents?.map(value => Number(value.id ?? value)) || []).map(Number);
  if (override && observedTalentSplit.length && observedTalentSplit.some(Number.isFinite) && talentTreeTotals(override).join('/') !== observedTalentSplit.join('/')) {
    return unsupported(`The detailed talent string allocates ${talentTreeTotals(override).join('/')} points, but this pull records ${observedTalentSplit.join('/')}.`);
  }
  let binaries;
  try { binaries = await checkedBinaries(); } catch (error) { return unavailable(error.message); }
  const built = buildModelBaseline(raw, info, model);
  let stats;
  try { stats = await computeStats(built.request, binaries.stats); } catch (error) { return unavailable(`WoWSims stats validation failed: ${error.message}`); }
  const statCheck = genericStatValidation(stats, observedStats(raw, info), model);
  if (statCheck.severe) return unsupported(`Modeled character stats substantially diverge from the combatant snapshot: ${JSON.stringify(statCheck.differences)}`);
  const definitions = genericActions(built.request, built.ids, model);
  const scenarios = [{ id: 'baseline', request: built.request }];
  for (const definition of definitions) { const request = clone(built.request); changes[definition.id](request); scenarios.push({ id: definition.id, request }); }
  const packageGroups = {
    personal: definitions.filter(definition => definition.owner === 'player'),
    support: definitions.filter(definition => definition.owner === 'raid'),
  };
  for (const [id, group] of Object.entries(packageGroups)) {
    if (group.length < 2) continue;
    const request = clone(built.request);
    group.forEach(definition => changes[definition.id](request));
    scenarios.push({ id: `package-${id}`, request });
  }
  const simulations = {};
  try {
    for (let index = 0; index < scenarios.length; index += 1) {
      options.onProgress?.(`Running ${model.id} simulation ${index + 1} of ${scenarios.length}: ${scenarios[index].id}.`);
      simulations[scenarios[index].id] = await simulate(scenarios[index].request, binaries.sim);
    }
  } catch (error) { return unavailable(`WoWSims execution failed: ${error.message}`); }
  const baseline = simulations.baseline;
  const tank = model.role === 'TANK';
  const metric = simulation => tank ? (simulation.metrics.threat?.avg || simulation.metrics.tps?.avg || 0) : simulation.dps;
  const baselineValue = metric(baseline);
  const potionProofs = Object.fromEntries(definitions.filter(definition => ['haste', 'destructionPot', 'manaPot'].includes(definition.id)).map(definition => [definition.id, definition.id === 'haste' ? potionProof(simulations[definition.id]) : potionUseProof(simulations[definition.id], definition.id === 'destructionPot' ? 22839 : 22832)]));
  const enchantProofs = {};
  for (const definition of definitions.filter(candidate => enchantProofDefinitions[candidate.id])) {
    let scenarioStats;
    try { scenarioStats = await computeStats(scenarios.find(scenario => scenario.id === definition.id).request, binaries.stats); }
    catch (error) { return unavailable(`WoWSims enchant validation failed: ${error.message}`); }
    enchantProofs[definition.id] = enchantScenarioProof(definition.id, built.request, scenarios.find(scenario => scenario.id === definition.id).request, stats, scenarioStats);
  }
  const potion = potionProofs.haste || null;
  const gainFor = definition => Math.round(metric(simulations[definition.id]) - baselineValue);
  const scenarioProofs = { ...potionProofs, ...enchantProofs };
  const activeDefinitions = positiveDefinitions(definitions, simulations, metric, baselineValue, scenarioProofs);
  const actions = activeDefinitions.map(definition => {
    const enchantProof = enchantProofs[definition.id];
    const evidence = enchantProof ? [...definition.evidence, `The validated scenario kept equipped item ${enchantProof.itemId}, changed permanent enchant ${enchantProof.baselineEnchant} to ${enchantProof.scenarioEnchant}, and changed final modeled stats: ${Object.entries(enchantProof.statDeltas).map(([name, delta]) => `${name} +${delta}`).join(', ')}.`]
      : definition.id === 'haste' ? [...definition.evidence, `The native APL fired ${potion.casts.toFixed(1)} potion uses with ${potion.uptimeSeconds.toFixed(1)} seconds uptime per fight.`] : definition.evidence;
    return { ...definition, evidence, ...(tank ? { impact: { value: gainFor(definition), unit: 'TPS', label: 'modeled threat', kind: 'modeled' } } : { gainDps: gainFor(definition), impact: { value: gainFor(definition), unit: 'DPS', label: 'modeled damage', kind: 'modeled' } }) };
  });
  const assumptions = [
    `Pinned source model: ${model.id}, APL and talent profile from ${Models.SOURCE_COMMIT}.`,
    built.race.assumed ? `Race is conditional: ${built.race.race} is the ${built.race.source}; enter the race in Model settings to replace it.` : `Race is ${built.race.race} from ${built.race.source}.`,
    raw.modelOverrides?.talentsString ? 'Detailed talent string entered in Model settings.' : `WCL does not expose detailed talents; the ${model.id} preset talent profile is assumed.`,
    ...modelOptionAssumptions(model, player(built.request)),
    `${built.encounter.model} controlled encounter for ${built.encounter.duration.toFixed(1)} seconds; this is not an exact encounter replay.`,
    built.encounter.armorSource === 'encounter metadata' ? `Target armor ${built.encounter.armor} comes from encounter metadata.` : `Target armor ${built.encounter.armor} is a generic controlled-target default, not a claimed boss armor.`,
    built.encounter.mobTypeSource === 'encounter metadata' ? `Target creature type ${built.encounter.mobType} comes from encounter metadata.` : built.encounter.mobTypeSource === 'boss-name inference' ? `Target creature type ${built.encounter.mobType} is inferred from the boss name.` : `Target creature type ${built.encounter.mobType} is a generic controlled-target default because the log metadata did not identify it.`,
    'Observed Might, Wisdom, Sanctity Aura, and Fortitude use improved support ranks; WCL aura IDs do not expose the supporting player’s talent rank. Other recorded tristate buffs use their regular rank.',
    Object.values(potionProofs).some(proof => !proof.pass) ? 'A missing potion was not reported because its source APL did not fire it.' : null,
    ...built.encounter.limitations,
  ].filter(Boolean);
  const encounterValidated = raw.encounter?.model === 'single-target' && Boolean(raw.encounter?.mobType) && raw.encounter?.armor !== null && raw.encounter?.armor !== undefined && raw.encounter?.armor !== '' && Number.isFinite(Number(raw.encounter?.armor));
  const exactStats = exactStatAgreement(statCheck);
  const nativeCoverage = exactStats && !built.race.assumed && Boolean(raw.modelOverrides?.talentsString) && encounterValidated;
  const coverageReason = nativeCoverage ? 'Recorded race, supplied detailed talents, final-stat agreement, and a single-target encounter model all validated.' : [
    exactStats ? null : statCheck.pass === true ? 'Relevant final stats passed the coarse safety gate but do not agree within one point.' : statCheck.reason,
    built.race.assumed ? 'Race is inferred from the source preset.' : null,
    raw.modelOverrides?.talentsString ? null : 'Detailed talent ranks are not available in normal WCL combatant data.',
    encounterValidated ? null : 'Encounter target, armor, or shape is a controlled assumption.',
  ].filter(Boolean).join(' ');
  return {
    status: 'complete', coverage: { kind: nativeCoverage ? 'native' : 'conditional', spec: raw.player.spec, reason: coverageReason },
    ...(tank ? { baselineTps: Math.round(baselineValue), mitigation: { kind: 'conditional', reason: 'Incoming damage is not replayed, so mitigation is not graded.' } } : { baselineDps: Math.round(baselineValue) }),
    actions,
    packages: Object.entries(packageGroups).filter(([id, group]) => group.length && (group.length === 1 || simulations[`package-${id}`])).map(([id, group]) => {
      const active = group.filter(definition => activeDefinitions.some(candidate => candidate.id === definition.id));
      if (!active.length || active.length !== group.length) return null;
      const simulation = simulations[`package-${id}`] || simulations[active[0].id];
      const gain = Math.round(metric(simulation) - baselineValue);
      if (!publishablePackage(group, active, gain)) return null;
      return { id, title: id === 'personal' ? 'Personal preparation' : 'Party support', actionIds: active.map(definition => definition.id), ...(tank ? { impact: { value: gain, unit: 'TPS', label: 'modeled threat', kind: 'modeled' } } : { gainDps: gain, impact: { value: gain, unit: 'DPS', label: 'modeled damage', kind: 'modeled' } }) };
    }).filter(Boolean),
    assumptions, validation: { stats: statCheck, iterations: baseline.iterations, runnerVersion: binaries.reported, potion, potions: potionProofs, enchants: enchantProofs, controlledEncounter: built.encounter }, version: VERSION,
    reproducibility: { baselineInput: built.request, model: model.id, sourceCommit: Models.SOURCE_COMMIT, scenarios: scenarios.map(scenario => ({ id: scenario.id, inputHash: crypto.createHash('sha256').update(JSON.stringify(scenario.request)).digest('hex'), iterations: simulations[scenario.id].iterations, dps: simulations[scenario.id].dps })) },
  };
}

async function runEvaluation(raw, options) {
  const resolved = Models.modelFor(raw?.player);
  if (resolved.kind === 'not-applicable') return { status: 'not-applicable', reason: resolved.reason, coverage: { kind: 'not-applicable', spec: raw?.player?.spec, reason: resolved.reason }, actions: [], packages: [], assumptions: [], validation: { evidenceEngine: 'healing evidence is evaluated outside the DPS/TPS simulator.' }, version: VERSION };
  if (resolved.kind !== 'native') return { ...unsupported(resolved.reason), coverage: { kind: 'conditional', spec: raw?.player?.spec, reason: resolved.reason } };
  if (resolved.model.role === 'TANK') {
    const reason = 'Tank mitigation and threat depend on incoming hits, healing and assignment context that this controlled DPS model does not replay; use the pull evidence instead.';
    return { status: 'not-applicable', reason, coverage: { kind: 'not-applicable', spec: raw?.player?.spec, reason }, actions: [], packages: [], assumptions: [], validation: { evidenceEngine: 'tank evidence is evaluated outside the DPS simulator.' }, version: VERSION };
  }
  // The original Fury path is retained for the calibrated Culuneta/Anetheron
  // case, including its exact stat invariant and scenario outputs.
  if (resolved.model.id === 'dps-warrior' && String(raw.player?.spec).toLowerCase() === 'fury' && /anetheron/i.test(fightInfo(raw)?.name || '') && abilityIds(raw.events).has(20572)) return runFuryEvaluation(raw, options);
  return runModelEvaluation(raw, options, resolved.model);
}

async function evaluateFight(raw, { onProgress } = {}) {
  const work = queue.then(() => runEvaluation(raw, { onProgress }));
  queue = work.catch(() => {});
  return work;
}

module.exports = { evaluateFight, _internals: { abilityIds, buildBaseline, buildModelBaseline, candidateActions, changes, combatant, enchantScenarioProof, exactStatAgreement, fightInfo, genericActions, genericStatValidation, modelFor: Models.modelFor, normalizeGear, observedFuryStats, observedStats, positiveDefinitions, potionProof, publishablePackage, sourceAbilityIds, statValidation, talentTreeTotals, validTalentOverride } };
