'use strict';

// This is a generated-from-source catalog.  The APL JSON files beside it were
// copied from wowsims/tbc at SOURCE_COMMIT; do not hand-edit them.
const path = require('path');

const SOURCE_COMMIT = '72e0c8a8feaf62da67add31090666773d6040f69';
const APL = (...parts) => path.join(__dirname, 'evaluation-sim', 'apls', ...parts);
const GEAR = id => path.join(__dirname, 'evaluation-sim', 'gears', `${id}.json`);
const sourceOptions = {
  mage: { options: { classOptions: { defaultMageArmor: 'MageArmorMageArmor' } } },
  'mage-fire': { options: { classOptions: { defaultMageArmor: 'MageArmorMageArmor' } } },
  'mage-frost': { options: { classOptions: { defaultMageArmor: 'MageArmorMageArmor' } } },
  'hunter-bm': { options: { classOptions: { ammo: 'WardensArrow', quiverBonus: 'Speed15', petType: 'Ravager', petUptime: 1, petSingleAbility: false } } },
  'hunter-sv': { options: { classOptions: { ammo: 'WardensArrow', quiverBonus: 'Speed15', petType: 'Ravager', petUptime: 1, petSingleAbility: false } } },
  'hunter-mm': { options: { classOptions: { ammo: 'WardensArrow', quiverBonus: 'Speed15', petType: 'Ravager', petUptime: 1, petSingleAbility: false } } },
  'enhancement-shaman': { options: { classOptions: { shieldProcrate: 0, imbueMh: 'WindfuryWeapon' }, imbueOh: 'WindfuryWeapon', syncType: 'DelayOffhandSwings' } },
  'elemental-shaman': { options: { classOptions: { shieldProcrate: 0 } } },
  'shadow-priest': { options: { classOptions: { preShadowform: true } } },
  'warlock-affliction': { options: { classOptions: { armor: 'FelArmor', curseOptions: 'Elements', sacrificeSummon: false, summon: 'Imp' } } },
  'warlock-demonology': { options: { classOptions: { armor: 'FelArmor', curseOptions: 'Recklessness', sacrificeSummon: false, summon: 'Succubus' } } },
  'warlock-destruction': { options: { classOptions: { armor: 'FelArmor', curseOptions: 'Recklessness', sacrificeSummon: true, summon: 'Succubus' } } },
  // The source UI defaults hasBsT2 to true as a manual simulator knob.  It is
  // reconstructed from equipped set pieces below instead of being assumed for
  // every logged warrior.
  'dps-warrior': { options: { classOptions: { queueDelay: 250, startingRage: 50, defaultShout: 'WarriorShoutBattle', defaultStance: 'WarriorStanceBerserker', hasBsT2: false, stanceSnapshot: true } } },
  'protection-warrior': { options: { classOptions: { queueDelay: 250, startingRage: 100, defaultShout: 'WarriorShoutCommanding', defaultStance: 'WarriorStanceDefensive', hasBsT2: true, stanceSnapshot: true } } },
};
const racesByClass = {
  druid: ['RaceNightElf', 'RaceTauren'], hunter: ['RaceDwarf', 'RaceNightElf', 'RaceDraenei', 'RaceOrc', 'RaceTroll', 'RaceTauren'],
  mage: ['RaceHuman', 'RaceGnome', 'RaceDraenei', 'RaceTroll', 'RaceUndead', 'RaceBloodElf'], paladin: ['RaceHuman', 'RaceDwarf', 'RaceDraenei', 'RaceBloodElf'],
  priest: ['RaceHuman', 'RaceDwarf', 'RaceNightElf', 'RaceDraenei', 'RaceTroll', 'RaceUndead', 'RaceBloodElf'], rogue: ['RaceHuman', 'RaceDwarf', 'RaceGnome', 'RaceNightElf', 'RaceOrc', 'RaceTroll', 'RaceUndead', 'RaceBloodElf'],
  shaman: ['RaceDraenei', 'RaceOrc', 'RaceTroll', 'RaceTauren'], warlock: ['RaceHuman', 'RaceGnome', 'RaceOrc', 'RaceUndead', 'RaceBloodElf'],
  warrior: ['RaceHuman', 'RaceDwarf', 'RaceGnome', 'RaceNightElf', 'RaceDraenei', 'RaceOrc', 'RaceTroll', 'RaceTauren', 'RaceUndead'],
};

const models = [
  ['druid', ['balance', 'boomkin'], 'balance-druid', 'ClassDruid', 'balanceDruid', 'RaceNightElf', '510022312503135231351--520033', APL('balance-druid', 'default.apl.json'), 'DPS'],
  ['druid', ['feral', 'feral cat', 'cat'], 'feral-cat', 'ClassDruid', 'feralCatDruid', 'RaceNightElf', '-503032132322105301251-05503301', APL('feral-cat', 'default.apl.json'), 'DPS'],
  ['druid', ['feral bear', 'bear', 'guardian'], 'feral-bear', 'ClassDruid', 'feralBearDruid', 'RaceNightElf', '-503032132322105301251-05503301', APL('feral-bear', 'default.apl.json'), 'TANK'],
  ['hunter', ['beast mastery', 'bm'], 'hunter-bm', 'ClassHunter', 'hunter', 'RaceOrc', '522002005150122431051-0505201205', APL('hunter', 'default.apl.json'), 'DPS'],
  ['hunter', ['survival', 'sv'], 'hunter-sv', 'ClassHunter', 'hunter', 'RaceOrc', '502-0550201205-333200022003223005103', APL('hunter', 'default.apl.json'), 'DPS'],
  ['hunter', ['marksman', 'marksmanship', 'mm'], 'hunter-mm', 'ClassHunter', 'hunter', 'RaceOrc', '522002005150122431051-0505201205', APL('hunter', 'marksman.apl.json'), 'DPS', true],
  ['mage', ['arcane'], 'mage', 'ClassMage', 'mage', 'RaceTroll', '2500052300030150330125--053500031003001', APL('mage', 'arcane.apl.json'), 'DPS'],
  ['mage', ['fire'], 'mage-fire', 'ClassMage', 'mage', 'RaceTroll', '2500052300030150330125--053500031003001', APL('mage', 'fire.apl.json'), 'DPS', true],
  ['mage', ['frost'], 'mage-frost', 'ClassMage', 'mage', 'RaceTroll', '2500052300030150330125--053500031003001', APL('mage', 'frost.apl.json'), 'DPS', true],
  ['paladin', ['retribution', 'ret'], 'retribution-paladin', 'ClassPaladin', 'retributionPaladin', 'RaceBloodElf', '5-053201-0523005120033125331051', APL('retribution-paladin', 'default.apl.json'), 'DPS'],
  ['paladin', ['protection', 'prot'], 'protection-paladin', 'ClassPaladin', 'protectionPaladin', 'RaceBloodElf', '-0530513050000142521051-052050003003', APL('protection-paladin', 'default.apl.json'), 'TANK'],
  ['priest', ['shadow', 'spriest'], 'shadow-priest', 'ClassPriest', 'priest', 'RaceTroll', '500230013--503250510240103051451', APL('shadow-priest', 'default.apl.json'), 'DPS'],
  ['rogue', ['combat', 'combat swords'], 'rogue', 'ClassRogue', 'rogue', 'RaceHuman', '0053201252-023305200005015002321151', APL('rogue', 'swords.apl.json'), 'DPS'],
  ['rogue', ['assassination', 'ass'], 'rogue-assassination', 'ClassRogue', 'rogue', 'RaceHuman', '0053201252-023305200005015002321151', APL('rogue', 'assassination.apl.json'), 'DPS', true],
  ['rogue', ['subtlety', 'sub'], 'rogue-subtlety', 'ClassRogue', 'rogue', 'RaceHuman', '0053201252-023305200005015002321151', APL('rogue', 'subtlety.apl.json'), 'DPS', true],
  ['shaman', ['elemental', 'ele'], 'elemental-shaman', 'ClassShaman', 'elementalShaman', 'RaceDraenei', '55003105100213351051--05105301005', APL('elemental-shaman', 'default.apl.json'), 'DPS'],
  ['shaman', ['enhancement', 'enh'], 'enhancement-shaman', 'ClassShaman', 'enhancementShaman', 'RaceOrc', '03-500502210501133531151-50005301', APL('enhancement-shaman', 'default.apl.json'), 'DPS'],
  ['warlock', ['affliction', 'aff'], 'warlock-affliction', 'ClassWarlock', 'warlock', 'RaceOrc', '05022221112351055003--50500051220001', APL('warlock', 'affliction.apl.json'), 'DPS'],
  ['warlock', ['demonology', 'demo'], 'warlock-demonology', 'ClassWarlock', 'warlock', 'RaceOrc', '01-205003213305010150134-50500251020001', APL('warlock', 'demonology.apl.json'), 'DPS'],
  ['warlock', ['destruction', 'destro'], 'warlock-destruction', 'ClassWarlock', 'warlock', 'RaceOrc', '-20500301332101-50500051220051053105', APL('warlock', 'destruction.apl.json'), 'DPS'],
  ['warrior', ['fury'], 'dps-warrior', 'ClassWarrior', 'dpsWarrior', 'RaceOrc', '3400502130201-05050005505012050115', APL('dps-warrior', 'fury.apl.json'), 'DPS'],
  ['warrior', ['arms'], 'dps-warrior', 'ClassWarrior', 'dpsWarrior', 'RaceOrc', '32005011352010500221-0550000500521203', APL('dps-warrior', 'arms.apl.json'), 'DPS'],
  ['warrior', ['protection', 'prot'], 'protection-warrior', 'ClassWarrior', 'protectionWarrior', 'RaceOrc', '35000301302-03-0055511033001101501351', APL('protection-warrior', 'default.apl.json'), 'TANK'],
].map(([classToken, specs, id, className, playerKey, defaultRace, talentsString, apl, role, requiresTalentOverride]) => ({ classToken, specs, id, className, playerKey, defaultRace, talentsString, apl, gear: GEAR(({ 'hunter-bm': 'hunter', 'hunter-sv': 'hunter', 'hunter-mm': 'hunter', 'rogue-assassination': 'rogue', 'rogue-subtlety': 'rogue', 'mage-fire': 'mage', 'mage-frost': 'mage', 'warlock-affliction': 'warlock', 'warlock-demonology': 'warlock', 'warlock-destruction': 'warlock' })[id] || id), races: racesByClass[classToken], role, options: sourceOptions[id] || { options: { classOptions: {} } }, requiresTalentOverride: Boolean(requiresTalentOverride) }));

const healerSpecs = new Map([
  ['druid:restoration', 'Restoration Druid is a healing role; the DPS simulator cannot produce a meaningful HPS grade.'],
  ['paladin:holy', 'Holy Paladin is a healing role; the DPS simulator cannot produce a meaningful HPS grade.'],
  ['shaman:restoration', 'Restoration Shaman is a healing role; the DPS simulator cannot produce a meaningful HPS grade.'],
  ['priest:holy', 'Holy Priest is a healing role; the DPS simulator cannot produce a meaningful HPS grade.'],
  ['priest:discipline', 'Discipline Priest is a healing role; the DPS simulator cannot produce a meaningful HPS grade.'],
]);

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }
function modelFor(player) {
  const classToken = normalize(player?.classToken);
  const spec = normalize(player?.spec);
  const healer = healerSpecs.get(`${classToken}:${spec}`);
  if (healer || normalize(player?.role) === 'healer') return { kind: 'not-applicable', reason: healer || 'The recorded player role is healer; this DPS/TPS simulator does not fabricate HPS.' };
  const model = models.find(candidate => candidate.classToken === classToken && candidate.specs.includes(spec));
  return model ? { kind: 'native', model } : { kind: 'conditional', reason: `No pinned native model exactly matches ${player?.classToken || 'unknown'} ${player?.spec || 'unknown'}; no other specialization was substituted.` };
}

const knownRaces = new Map(Object.entries({
  orc: 'RaceOrc', troll: 'RaceTroll', tauren: 'RaceTauren', undead: 'RaceUndead', human: 'RaceHuman', dwarf: 'RaceDwarf', gnome: 'RaceGnome', 'night elf': 'RaceNightElf', nightelf: 'RaceNightElf', draenei: 'RaceDraenei', 'blood elf': 'RaceBloodElf', bloodelf: 'RaceBloodElf',
}));
function raceFor(raw, info, model) {
  const supplied = raw?.modelOverrides?.race || raw?.player?.race || info?.race;
  const eventIds = new Set((raw?.events?.data || []).filter(event => event.sourceID === raw.sourceId).map(event => event.abilityGameID));
  const racial = eventIds.has(20554) ? 'RaceTroll' : eventIds.has(20572) ? 'RaceOrc' : undefined;
  const race = knownRaces.get(normalize(supplied));
  if (supplied) {
    if (race && model.races.includes(race)) return { race, assumed: false, source: 'recorded or user override' };
    return { race: model.defaultRace, assumed: true, invalid: true, source: `supplied ${supplied} is not valid for ${model.classToken}` };
  }
  if (racial && model.races.includes(racial)) return { race: racial, assumed: false, source: 'observed racial spell' };
  return { race: model.defaultRace, assumed: true, invalid: false, source: `pinned ${model.id} preset default` };
}

module.exports = { SOURCE_COMMIT, models, modelFor, raceFor, normalize };
