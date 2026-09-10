'use strict';

// Encounter context is a scope guard, not an avoidance or assignment classifier. Native
// simulator encounter scripts and WCL event evidence take precedence over these labels.
const RAIDS = {
    Karazhan: ['Attumen the Huntsman', 'Moroes', 'Maiden of Virtue', 'Opera Hall', 'Opera Event', 'The Big Bad Wolf', 'The Crone', 'Romulo and Julianne', 'The Curator', 'Terestian Illhoof', 'Shade of Aran', 'Netherspite', 'Chess Event', 'Prince Malchezaar', 'Nightbane'],
    "Gruul's Lair": ['High King Maulgar', 'Gruul the Dragonkiller'],
    "Magtheridon's Lair": ['Magtheridon'],
    'Serpentshrine Cavern': ['Hydross the Unstable', 'The Lurker Below', 'Leotheras the Blind', 'Fathom-Lord Karathress', 'Morogrim Tidewalker', 'Lady Vashj'],
    'Tempest Keep': ["Al'ar", 'Void Reaver', 'High Astromancer Solarian', "Kael'thas Sunstrider"],
    'Hyjal Summit': ['Rage Winterchill', 'Anetheron', "Kaz'rogal", 'Azgalor', 'Archimonde'],
    'Black Temple': ["High Warlord Naj'entus", 'Supremus', 'Shade of Akama', 'Teron Gorefiend', 'Gurtogg Bloodboil', 'Reliquary of Souls', 'Mother Shahraz', 'The Illidari Council', 'Illidari Council', 'Illidan Stormrage'],
    "Zul'Aman": ["Nalorakk", "Akil'zon", "Jan'alai", "Halazzi", 'Hex Lord Malacrass', "Zul'jin"],
    'Sunwell Plateau': ['Kalecgos', 'Brutallus', 'Felmyst', 'Eredar Twins', "M'uru", "Kil'jaeden"],
};
const fold = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const PHASED = new Set(['Hydross the Unstable', 'The Lurker Below', 'Leotheras the Blind', 'Lady Vashj', "Al'ar", 'High Astromancer Solarian', "Kael'thas Sunstrider", 'Supremus', 'Shade of Akama', 'Teron Gorefiend', 'Reliquary of Souls', 'Illidan Stormrage', 'Nightbane', 'Netherspite', 'Kalecgos', 'Felmyst', "M'uru", "Kil'jaeden", "Zul'jin"].map(fold));
const MULTI = new Set(['Attumen the Huntsman', 'Moroes', 'Opera Hall', 'Opera Event', 'The Crone', 'Romulo and Julianne', 'Terestian Illhoof', 'High King Maulgar', 'Magtheridon', 'Fathom-Lord Karathress', 'Morogrim Tidewalker', 'Anetheron', 'Azgalor', 'The Illidari Council', 'Illidari Council', "Jan'alai", 'Halazzi', 'Hex Lord Malacrass', 'Eredar Twins'].map(fold));
// Only populate creature types needed by an existing, source-checked consumable scenario.
const DEMONS = new Set(['Anetheron', "Kaz'rogal", 'Azgalor', 'Archimonde', 'Magtheridon', 'Brutallus', 'Prince Malchezaar', 'Mother Shahraz'].map(fold));
function encounterContext(fight) {
    const key = fold(fight?.name);
    const raid = Object.entries(RAIDS).find(([, names]) => names.some(name => fold(name) === key))?.[0] || null;
    const model = !raid ? 'unknown' : PHASED.has(key) ? 'phased' : MULTI.has(key) ? 'multi-target' : 'single-target';
    const limitations = ['Assignments, target availability and avoidability are not established by the boss name. Review the linked event windows before attributing mistakes.'];
    if (!raid) limitations.push('This encounter has no validated TBC encounter profile. Generic observations remain available; encounter-specific conclusions are unknown.');
    if (model === 'phased' || model === 'multi-target') limitations.push('Phase changes, adds and assigned targets can change output. A stationary single-target model is a conditional equipment comparison, not a replay of this encounter.');
    if (fight?.kill === false) limitations.push('This was an unsuccessful attempt. Kill-time, execute-phase and survival comparisons with kills are not equivalent.');
    return { id: fight?.encounterID ?? fight?.encounterId ?? null, name: fight?.name || 'Unknown encounter', raid,
        mobType: DEMONS.has(key) ? 'Demon' : 'Unknown', model,
        assumptions: ['Creature armor, movement and assignments must come from a named model or explicit assumption; this catalog does not supply them.'], limitations };
}
module.exports = { RAIDS, encounterContext };
