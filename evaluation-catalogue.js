'use strict';
// Verified ids only. An id that is not in these tables is never guessed into a source.
const player = (...rest) => ['raid', 'parties', 0, 'players', 0, ...rest];
const party = (...rest) => ['raid', 'parties', 0, 'buffs', ...rest];
const raid = (...rest) => ['raid', 'buffs', ...rest];
const consumable = (field, id, clear = []) => ({ consumable: { field, id, clear } });
const set = (...pairs) => ({ set: pairs });
// `stats` is the stat affinity of a source: the item-db stat indices it actually supplies
// (0 strength, 1 agility, 3 intellect, 5 spell power, 12/13/14 spell hit/crit/haste, 17 attack
// power, 18 ranged attack power, 20 melee/ranged hit, 21 melee/ranged crit, 22 melee/ranged
// haste). A stat-gap sentence may only name a source whose affinity contains that stat's index,
// so "the remaining 80 haste matches Battle Shout" can never be printed. An empty array means the
// source supplies no rated stat (Sanctity Aura, Wisdom, Ferocious Inspiration: percentages and
// regeneration, not ratings) and is therefore never named for a stat gap.

const AURAS_AT_PULL = new Map([
    // Consumables: aura id → sim item id (pairs from evaluation-sim.js applyRecordedConsumables)
    [28520, { name: 'Flask of Relentless Assault', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22854, ['battleElixirId', 'guardianElixirId']), stats: [17, 18] }],
    [28540, { name: 'Flask of Pure Death', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22866, ['battleElixirId', 'guardianElixirId']), stats: [5] }],
    [28521, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']), stats: [5] }],
    [46840, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']), stats: [5] }],
    [28497, { name: 'Elixir of Major Agility', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22831), stats: [1, 21] }],
    [11406, { name: 'Elixir of Demonslaying', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 9224), stats: [17, 18] }],
    [33721, { name: "Adept's Elixir", kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 28103), stats: [5, 13] }],
    [28503, { name: 'Elixir of Major Shadow Power', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22545), stats: [5] }],
    [33256, { name: 'Roasted Clefthoof', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27658), stats: [0] }],
    [33254, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657), stats: [5] }],
    [33263, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657), stats: [5] }],
    [33261, { name: 'Warp Burger', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27659), stats: [1, 17, 18] }],
    [43764, { name: 'Well Fed (food not identified)', kind: 'consumable', slot: 'food', owner: 'you', sim: null, stats: [] }],
    [12174, { name: 'Scroll of Agility V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollAgi'), true]), statDelta: { 1: 20 }, stats: [1] }],
    [12179, { name: 'Scroll of Strength V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollStr'), true]), statDelta: { 0: 20 }, stats: [0] }],
    // Blessings and party/raid buffs present at pull (sim toggles as in evaluation-sim.js buildModelBaseline)
    [25898, { name: 'Greater Blessing of Kings', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfKings'), true]), stats: [0, 1, 3] }],
    [27141, { name: 'Greater Blessing of Might', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfMight'), 'TristateEffectImproved']), stats: [17, 18] }],
    [25895, { name: 'Greater Blessing of Salvation', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfSalvation'), true]), stats: [] }],
    [27143, { name: 'Greater Blessing of Wisdom', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfWisdom'), 'TristateEffectImproved']), stats: [] }],
    [24932, { name: 'Leader of the Pack', kind: 'party', owner: 'raid', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']), stats: [21] }],
    [2048, { name: 'Battle Shout', kind: 'party', owner: 'raid', sim: set([party('battleShout'), 'TristateEffectRegular']), stats: [17, 18] }],
    [30807, { name: 'Unleashed Rage', kind: 'party', owner: 'raid', sim: set([player('buffs', 'unleashedRage'), true]), stats: [17, 18] }],
    [33077, { name: 'Grace of Air Totem', kind: 'party', owner: 'raid', sim: set([party('graceOfAirTotem'), 'TristateEffectRegular']), stats: [1] }],
    [33082, { name: 'Strength of Earth Totem', kind: 'party', owner: 'raid', sim: set([party('strengthOfEarthTotem'), 'TristateEffectRegular']), stats: [0] }],
    [25584, { name: 'Windfury Totem', kind: 'party', owner: 'raid', sim: set([party('windfuryTotem'), 'TristateEffectRegular']), stats: [] }],
    [34456, { name: 'Ferocious Inspiration', kind: 'party', owner: 'raid', sim: set([party('ferociousInspiration'), 1]), stats: [] }],
    [20218, { name: 'Sanctity Aura', kind: 'party', owner: 'raid', sim: set([party('sanctityAura'), 'TristateEffectImproved']), stats: [] }],
    [35476, { name: 'Drums of Battle', kind: 'party', owner: 'raid', sim: set([party('drums'), 'GreaterDrumsOfBattle']), stats: [22, 14] }],
    [27127, { name: 'Arcane Brilliance', kind: 'raid', owner: 'raid', sim: set([raid('arcaneBrilliance'), true]), stats: [3] }],
    [25392, { name: 'Prayer of Fortitude', kind: 'raid', owner: 'raid', sim: set([raid('powerWordFortitude'), 'TristateEffectImproved']), stats: [] }],
    [26991, { name: 'Gift of the Wild', kind: 'raid', owner: 'raid', sim: set([raid('giftOfTheWild'), 'TristateEffectRegular']), stats: [0, 1, 3] }],
    [32999, { name: 'Prayer of Spirit', kind: 'raid', owner: 'raid', sim: set([raid('divineSpirit'), 'TristateEffectRegular']), stats: [] }],
].map(([id, entry]) => [id, { id, ...entry }]));

const UPTIME = new Map([
    [2825, { name: 'Bloodlust', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null, stats: [] }],
    [32182, { name: 'Heroism', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null, stats: [] }],
    [35476, { name: 'Drums of Battle', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: set([party('drums'), 'GreaterDrumsOfBattle']), stats: [22, 14] }],
    [30807, { name: 'Unleashed Rage', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([player('buffs', 'unleashedRage'), true]), stats: [] }],
    [24932, { name: 'Leader of the Pack', kind: 'raid-buff', owner: 'raid', affects: 'crit', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']), stats: [21] }],
    [2048, { name: 'Battle Shout', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([party('battleShout'), 'TristateEffectRegular']), stats: [17, 18] }],
    [34456, { name: 'Ferocious Inspiration', kind: 'raid-buff', owner: 'raid', affects: 'all', sim: set([party('ferociousInspiration'), 1]), stats: [] }],
    [34775, { name: 'Dragonspine Flurry', kind: 'proc', owner: 'luck', itemId: 28830, affects: 'rate', sim: null, stats: [22, 14] }],
    [36041, { name: 'Heartrazor', kind: 'proc', owner: 'luck', itemId: 29962, affects: 'perHit', sim: null }],
    [28093, { name: 'Lightning Speed', kind: 'proc', owner: 'luck', enchantId: 2673, affects: 'rate', sim: null, stats: [1] }],
    [28507, { name: 'Haste Potion', kind: 'potion', owner: 'you', affects: 'rate', sim: consumable('potId', 22838), stats: [22, 14] }],
    [28508, { name: 'Destruction Potion', kind: 'potion', owner: 'you', affects: 'all', sim: consumable('potId', 22839) }],
    [6774, { name: 'Slice and Dice', kind: 'maintained', owner: 'you', affects: 'rate', sim: null }],
    [3045, { name: 'Rapid Fire', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [19574, { name: 'Bestial Wrath', kind: 'cooldown', owner: 'you', affects: 'all', sim: null }],
    [13750, { name: 'Adrenaline Rush', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [13877, { name: 'Blade Flurry', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [12292, { name: 'Death Wish', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [1719, { name: 'Recklessness', kind: 'cooldown', owner: 'you', affects: 'crit', sim: null }],
    [31884, { name: 'Avenging Wrath', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [12042, { name: 'Arcane Power', kind: 'cooldown', owner: 'you', affects: 'perHit', sim: null }],
    [12472, { name: 'Icy Veins', kind: 'cooldown', owner: 'you', affects: 'rate', sim: null }],
    [14177, { name: 'Cold Blood', kind: 'cooldown', owner: 'you', affects: 'crit', sim: null }],
    [31238, { name: 'Find Weakness', kind: 'maintained', owner: 'you', affects: 'perHit', sim: null }],
].map(([id, entry]) => [id, { id, ...entry }]));

const DEBUFFS = new Map([
    [25225, { name: 'Sunder Armor', affects: 'perHit', sim: set([['raid', 'debuffs', 'sunderArmor'], true]) }],
    [26866, { name: 'Expose Armor', affects: 'perHit', sim: set([['raid', 'debuffs', 'exposeArmor'], 'TristateEffectImproved']) }],
    [26993, { name: 'Faerie Fire', affects: 'perHit', sim: set([['raid', 'debuffs', 'faerieFire'], 'TristateEffectRegular']) }],
    [25602, { name: 'Faerie Fire', affects: 'perHit', sim: set([['raid', 'debuffs', 'faerieFire'], 'TristateEffectRegular']) }],
    [27226, { name: 'Curse of Recklessness', affects: 'perHit', sim: set([['raid', 'debuffs', 'curseOfRecklessness'], true]) }],
    [27228, { name: 'Curse of the Elements', affects: 'perHit', sim: null }],
    [33200, { name: 'Misery', affects: 'perHit', sim: null }],
    [15258, { name: 'Shadow Weaving', affects: 'perHit', sim: null }],
    [27159, { name: 'Judgement of the Crusader', affects: 'perHit', sim: null }],
    [34501, { name: 'Expose Weakness', affects: 'perHit', sim: null }],
    [14325, { name: "Hunter's Mark", affects: 'perHit', sim: null }],
].map(([id, entry]) => [id, { id, owner: 'raid', ...entry }]));

const byItem = new Map([...UPTIME.values()].filter(e => e.itemId).map(e => [e.itemId, e]));
const lookup = (map) => (id) => map.get(Number(id)) || null;
module.exports = { AURAS_AT_PULL, UPTIME, DEBUFFS, lookupAura: lookup(AURAS_AT_PULL), lookupUptime: lookup(UPTIME), lookupDebuff: lookup(DEBUFFS), procForItem: (id) => byItem.get(Number(id)) || null };
