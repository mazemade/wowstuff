'use strict';
/*
 * TBC spec vocabulary shared by the evaluator and its presentation layer.  `mechanics`
 * deliberately lists only telemetry we can observe from a Warcraft Logs table; it is not a
 * priority list or a claim that a talent is present just because a player declared a spec.
 */
const role = (classToken, spec, value, mechanics) => ({ id: classToken + ':' + spec, classToken, spec, role: value, mechanics });
const list = value => Array.isArray(value) ? value : [value];
const observable = (id, label, spells, kind, extra = {}) => {
  const spellIds = list(spells);
  return { id, label, spell: spellIds[spellIds.length - 1], spellIds, kind, ...extra };
};
const dot = (id, label, spells, auras = spells) => observable(id, label, spells, 'dot', { aura: list(auras).at(-1), auraIds: list(auras) });
const hot = (id, label, spells, auras = spells) => observable(id, label, spells, 'hot', { aura: list(auras).at(-1), auraIds: list(auras) });
const targetDebuff = (id, label, spells, auras = spells) => observable(id, label, spells, 'target-debuff', { aura: list(auras).at(-1), auraIds: list(auras) });
const targetBuff = (id, label, spells, auras = spells) => observable(id, label, spells, 'target-buff', { aura: list(auras).at(-1), auraIds: list(auras) });
const cd = (id, label, spells, cooldown) => observable(id, label, spells, 'cooldown', { cooldown });
const cast = (id, label, spells) => observable(id, label, spells, 'cast');
const aura = (id, label, spells, auras = spells) => observable(id, label, spells, 'aura', { aura: list(auras).at(-1), auraIds: list(auras) });

// Healing ranks are intentionally complete. Downranking is normal TBC play, and WCL records the
// rank-specific cast/aura ID rather than one canonical family ID.
const HOLY_LIGHT = [635, 639, 647, 1026, 1042, 3472, 10328, 10329, 25292, 27135, 27136];
const FLASH_OF_LIGHT = [19750, 19939, 19940, 19941, 19942, 19943, 27137];
const POWER_WORD_SHIELD = [17, 592, 600, 3747, 6065, 6066, 10898, 10899, 10900, 10901, 25217, 25218];
const CIRCLE_OF_HEALING = [34861, 34863, 34864, 34865, 34866];
const RENEW = [139, 6074, 6075, 6076, 6077, 6078, 10927, 10928, 10929, 25315, 25221, 25222];
const CHAIN_HEAL = [1064, 10622, 10623, 25422, 25423];
const EARTH_SHIELD = [974, 32593, 32594];
const REJUVENATION = [774, 1058, 1430, 2090, 2091, 3627, 8910, 9839, 9840, 9841, 25299, 26981, 26982];

const SPECS = Object.freeze([
  role('WARRIOR', 'Arms', 'melee', [dot('rend', 'Rend', 25208), cast('mortal-strike', 'Mortal Strike', 30330), cd('death-wish', 'Death Wish', 12292, 180)]),
  role('WARRIOR', 'Fury', 'melee', [cast('bloodthirst', 'Bloodthirst', 30335), cast('whirlwind', 'Whirlwind', 1680), cd('recklessness', 'Recklessness', 1719, 1800)]),
  role('WARRIOR', 'Protection', 'tank', [cast('shield-slam', 'Shield Slam', 30356), cast('devastate', 'Devastate', 30016), aura('shield-block', 'Shield Block', 2565)]),
  role('PALADIN', 'Holy', 'healer', [cast('holy-light', 'Holy Light', HOLY_LIGHT), cast('flash-of-light', 'Flash of Light', FLASH_OF_LIGHT), cd('divine-illumination', 'Divine Illumination', 31842, 180)]),
  role('PALADIN', 'Protection', 'tank', [cast('consecration', 'Consecration', 27173), aura('holy-shield', 'Holy Shield', 27179), cast('avengers-shield', "Avenger's Shield", 27180)]),
  role('PALADIN', 'Retribution', 'melee', [cast('crusader-strike', 'Crusader Strike', 35395), { ...aura('seal-of-blood', 'Seal of Blood / the Martyr', [31892, 348700]), coverageContext: 'Seal switching changes this coverage. Judge seal timing at swings, not a target of 100% aura uptime.' }, cd('avenging-wrath', 'Avenging Wrath', 31884, 180)]),
  role('HUNTER', 'Beast Mastery', 'ranged', [cast('steady-shot', 'Steady Shot', 34120), cast('kill-command', 'Kill Command', 34026), cd('bestial-wrath', 'Bestial Wrath', 19574, 120)]),
  role('HUNTER', 'Marksmanship', 'ranged', [cast('steady-shot', 'Steady Shot', 34120), cast('aimed-shot', 'Aimed Shot', 27065), cd('rapid-fire', 'Rapid Fire', 3045, 300)]),
  role('HUNTER', 'Survival', 'ranged', [cast('steady-shot', 'Steady Shot', 34120), dot('serpent-sting', 'Serpent Sting', 27016), targetDebuff('expose-weakness', 'Expose Weakness', 34503)]),
  role('ROGUE', 'Assassination', 'melee', [dot('rupture', 'Rupture', 26867), cast('mutilate', 'Mutilate', 34413), cast('envenom', 'Envenom', 32645)]),
  role('ROGUE', 'Combat', 'melee', [aura('slice-and-dice', 'Slice and Dice', 6774), cast('sinister-strike', 'Sinister Strike', 26862), cd('adrenaline-rush', 'Adrenaline Rush', 13750, 300)]),
  role('ROGUE', 'Subtlety', 'melee', [dot('rupture', 'Rupture', 26867), cast('hemorrhage', 'Hemorrhage', 26864), cd('shadowstep', 'Shadowstep', 36554, 30)]),
  role('PRIEST', 'Discipline', 'healer', [targetBuff('power-word-shield', 'Power Word: Shield', POWER_WORD_SHIELD), cast('prayer-of-mending', 'Prayer of Mending', 33076), cd('pain-suppression', 'Pain Suppression', 33206, 180)]),
  role('PRIEST', 'Holy', 'healer', [cast('prayer-of-mending', 'Prayer of Mending', 33076), cast('circle-of-healing', 'Circle of Healing', CIRCLE_OF_HEALING), hot('renew', 'Renew', RENEW)]),
  role('PRIEST', 'Shadow', 'caster', [dot('vampiric-touch', 'Vampiric Touch', 34914), dot('shadow-word-pain', 'Shadow Word: Pain', 25368), cast('mind-blast', 'Mind Blast', 25375)]),
  role('SHAMAN', 'Elemental', 'caster', [cast('lightning-bolt', 'Lightning Bolt', 25449), cast('chain-lightning', 'Chain Lightning', 25442), cast('totem-of-wrath', 'Totem of Wrath', 30706)]),
  role('SHAMAN', 'Enhancement', 'melee', [cast('stormstrike', 'Stormstrike', 17364), cast('earth-shock', 'Earth Shock', 25454), targetBuff('unleashed-rage', 'Unleashed Rage', 30809)]),
  role('SHAMAN', 'Restoration', 'healer', [cast('chain-heal', 'Chain Heal', CHAIN_HEAL), targetBuff('earth-shield', 'Earth Shield', EARTH_SHIELD), cd('mana-tide', 'Mana Tide Totem', 16190, 300)]),
  role('MAGE', 'Arcane', 'caster', [cast('arcane-blast', 'Arcane Blast', 30451), cast('arcane-missiles', 'Arcane Missiles', 27075), cd('arcane-power', 'Arcane Power', 12042, 180)]),
  role('MAGE', 'Fire', 'caster', [cast('fireball', 'Fireball', 27070), targetDebuff('improved-scorch', 'Improved Scorch', 27074, [12873, 22959]), cd('combustion', 'Combustion', 11129, 180)]),
  role('MAGE', 'Frost', 'caster', [cast('frostbolt', 'Frostbolt', 27071), targetDebuff('winters-chill', "Winter's Chill", 12579), cd('icy-veins', 'Icy Veins', 12472, 180)]),
  role('WARLOCK', 'Affliction', 'caster', [dot('corruption', 'Corruption', 27216), dot('unstable-affliction', 'Unstable Affliction', 30108), dot('curse-of-agony', 'Curse of Agony', 27218)]),
  role('WARLOCK', 'Demonology', 'caster', [cast('shadow-bolt', 'Shadow Bolt', 27209), aura('demonic-sacrifice', 'Demonic Sacrifice', 18788, [18789, 18790, 18791, 18792]), dot('corruption', 'Corruption', 27216)]),
  role('WARLOCK', 'Destruction', 'caster', [dot('immolate', 'Immolate', 27215), cast('shadow-bolt', 'Shadow Bolt', 27209), cast('conflagrate', 'Conflagrate', 30912)]),
  role('DRUID', 'Balance', 'caster', [dot('moonfire', 'Moonfire', 26988), dot('insect-swarm', 'Insect Swarm', 27013), cast('starfire', 'Starfire', 27073)]),
  role('DRUID', 'Feral', 'melee', [dot('rip', 'Rip', 27008), cast('mangle-cat', 'Mangle (Cat)', 33983), cast('shred', 'Shred', 27002)]),
  role('DRUID', 'Guardian', 'tank', [cast('mangle-bear', 'Mangle (Bear)', 33987), dot('lacerate', 'Lacerate', 33745), targetDebuff('demoralizing-roar', 'Demoralizing Roar', 26998)]),
  role('DRUID', 'Restoration', 'healer', [hot('lifebloom', 'Lifebloom', 33763), hot('rejuvenation', 'Rejuvenation', REJUVENATION), cast('swiftmend', 'Swiftmend', 18562)])
]);

const normalize = value => String(value || '').replace(/[^a-z]/gi, '').toLowerCase();
const byKey = new Map(SPECS.map(spec => [normalize(spec.classToken) + ':' + normalize(spec.spec), spec]));
function resolveSpec(player = {}) {
  const classToken = String(player.classToken || player.class || '').toUpperCase();
  let spec = String(player.spec || '');
  const declaredRole = normalize(player.role);
  // Warcraft Logs uses encounter-role labels for a few TBC trees rather than their talent-tree
  // names. Keep this local so role evidence can also consume a raw WCL classification.
  if (classToken === 'PALADIN' && normalize(spec) === 'justicar') spec = 'Protection';
  if (classToken === 'WARRIOR' && normalize(spec) === 'champion') spec = 'Arms';
  // Raid Helper and old addon exports sometimes call either feral form "Feral Cat"/"Feral Bear".
  if (classToken === 'DRUID' && /^(feralcat|cat)$/i.test(normalize(spec))) spec = 'Feral';
  if (classToken === 'DRUID' && /^(feralbear|bear|guardian)$/i.test(normalize(spec))) spec = 'Guardian';
  if (classToken === 'DRUID' && normalize(spec) === 'feral' && /^(tank|tanks|bear)$/.test(declaredRole)) spec = 'Guardian';
  return byKey.get(normalize(classToken) + ':' + normalize(spec)) || null;
}

module.exports = { SPECS, resolveSpec };
