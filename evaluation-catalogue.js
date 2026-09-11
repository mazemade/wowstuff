'use strict';
// Verified ids only. An id that is not in these tables is never guessed into a source.
const player = (...rest) => ['raid', 'parties', 0, 'players', 0, ...rest];
const party = (...rest) => ['raid', 'parties', 0, 'buffs', ...rest];
const raid = (...rest) => ['raid', 'buffs', ...rest];
const consumable = (field, id, clear = []) => ({ consumable: { field, id, clear } });
const set = (...pairs) => ({ set: pairs });

const AURAS_AT_PULL = new Map([
    // Consumables: aura id → sim item id (pairs from evaluation-sim.js applyRecordedConsumables)
    [28520, { name: 'Flask of Relentless Assault', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22854, ['battleElixirId', 'guardianElixirId']) }],
    [28540, { name: 'Flask of Pure Death', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22866, ['battleElixirId', 'guardianElixirId']) }],
    [28521, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']) }],
    [46840, { name: 'Flask of Blinding Light', kind: 'consumable', slot: 'flask', owner: 'you', sim: consumable('flaskId', 22861, ['battleElixirId', 'guardianElixirId']) }],
    [28497, { name: 'Elixir of Major Agility', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22831) }],
    [11406, { name: 'Elixir of Demonslaying', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 9224) }],
    [33721, { name: "Adept's Elixir", kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 28103) }],
    [28503, { name: 'Elixir of Major Shadow Power', kind: 'consumable', slot: 'battle', owner: 'you', sim: consumable('battleElixirId', 22545) }],
    [33256, { name: 'Roasted Clefthoof', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27658) }],
    [33254, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657) }],
    [33263, { name: 'Blackened Basilisk', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27657) }],
    [33261, { name: 'Warp Burger', kind: 'consumable', slot: 'food', owner: 'you', sim: consumable('foodId', 27659) }],
    [43764, { name: 'Well Fed (food not identified)', kind: 'consumable', slot: 'food', owner: 'you', sim: null }],
    [12174, { name: 'Scroll of Agility V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollAgi'), true]), stats: { 1: 20 } }],
    [12179, { name: 'Scroll of Strength V', kind: 'scroll', owner: 'you', sim: set([player('consumables', 'scrollStr'), true]), stats: { 0: 20 } }],
    // Blessings and party/raid buffs present at pull (sim toggles as in evaluation-sim.js buildModelBaseline)
    [25898, { name: 'Greater Blessing of Kings', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfKings'), true]) }],
    [27141, { name: 'Greater Blessing of Might', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfMight'), 'TristateEffectImproved']) }],
    [25895, { name: 'Greater Blessing of Salvation', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfSalvation'), true]) }],
    [27143, { name: 'Greater Blessing of Wisdom', kind: 'blessing', owner: 'raid', sim: set([player('buffs', 'blessingOfWisdom'), 'TristateEffectImproved']) }],
    [24932, { name: 'Leader of the Pack', kind: 'party', owner: 'raid', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']) }],
    [2048, { name: 'Battle Shout', kind: 'party', owner: 'raid', sim: set([party('battleShout'), 'TristateEffectRegular']) }],
    [30807, { name: 'Unleashed Rage', kind: 'party', owner: 'raid', sim: set([player('buffs', 'unleashedRage'), true]) }],
    [33077, { name: 'Grace of Air Totem', kind: 'party', owner: 'raid', sim: set([party('graceOfAirTotem'), 'TristateEffectRegular']) }],
    [33082, { name: 'Strength of Earth Totem', kind: 'party', owner: 'raid', sim: set([party('strengthOfEarthTotem'), 'TristateEffectRegular']) }],
    [25584, { name: 'Windfury Totem', kind: 'party', owner: 'raid', sim: set([party('windfuryTotem'), 'TristateEffectRegular']) }],
    [34456, { name: 'Ferocious Inspiration', kind: 'party', owner: 'raid', sim: set([party('ferociousInspiration'), 1]) }],
    [20218, { name: 'Sanctity Aura', kind: 'party', owner: 'raid', sim: set([party('sanctityAura'), 'TristateEffectImproved']) }],
    [27127, { name: 'Arcane Brilliance', kind: 'raid', owner: 'raid', sim: set([raid('arcaneBrilliance'), true]) }],
    [25392, { name: 'Prayer of Fortitude', kind: 'raid', owner: 'raid', sim: set([raid('powerWordFortitude'), 'TristateEffectImproved']) }],
    [26991, { name: 'Gift of the Wild', kind: 'raid', owner: 'raid', sim: set([raid('giftOfTheWild'), 'TristateEffectRegular']) }],
    [32999, { name: 'Prayer of Spirit', kind: 'raid', owner: 'raid', sim: set([raid('divineSpirit'), 'TristateEffectRegular']) }],
].map(([id, entry]) => [id, { id, ...entry }]));

const UPTIME = new Map([
    [2825, { name: 'Bloodlust', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null }],
    [32182, { name: 'Heroism', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: null }],
    [35476, { name: 'Drums of Battle', kind: 'raid-buff', owner: 'raid', affects: 'rate', sim: set([party('drums'), 'GreaterDrumsOfBattle']) }],
    [30807, { name: 'Unleashed Rage', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([player('buffs', 'unleashedRage'), true]) }],
    [24932, { name: 'Leader of the Pack', kind: 'raid-buff', owner: 'raid', affects: 'crit', sim: set([party('leaderOfThePack'), 'TristateEffectRegular']) }],
    [2048, { name: 'Battle Shout', kind: 'raid-buff', owner: 'raid', affects: 'perHit', sim: set([party('battleShout'), 'TristateEffectRegular']) }],
    [34456, { name: 'Ferocious Inspiration', kind: 'raid-buff', owner: 'raid', affects: 'all', sim: set([party('ferociousInspiration'), 1]) }],
    [34775, { name: 'Dragonspine Flurry', kind: 'proc', owner: 'luck', itemId: 28830, affects: 'rate', sim: null }],
    [36041, { name: 'Heartrazor', kind: 'proc', owner: 'luck', itemId: 29962, affects: 'perHit', sim: null }],
    [28093, { name: 'Lightning Speed', kind: 'proc', owner: 'luck', enchantId: 2673, affects: 'rate', sim: null }],
    [28507, { name: 'Haste Potion', kind: 'potion', owner: 'you', affects: 'rate', sim: consumable('potId', 22838) }],
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
