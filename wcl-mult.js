(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.WclMult = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Verified live in Task 4 — 0 is a deliberate "not yet verified" placeholder.
    const DEFAULT_ZONE = 0;

    // WCL spec names, lowercased with non-letters stripped, per engine class.
    const WCL_SPEC_NAMES = {
        WARRIOR: { arms: 'Arms', fury: 'Fury', protection: 'Protection' },
        PALADIN: { retribution: 'Retribution', protection: 'Protection', holy: 'Holy' },
        HUNTER: { beastmastery: 'Beast Mastery', marksmanship: 'Marksmanship', survival: 'Survival' },
        ROGUE: { assassination: 'Assassination', combat: 'Combat', subtlety: 'Subtlety' },
        PRIEST: { shadow: 'Shadow', holy: 'Holy', discipline: 'Discipline' },
        SHAMAN: { elemental: 'Elemental', enhancement: 'Enhancement', restoration: 'Restoration' },
        MAGE: { arcane: 'Arcane', fire: 'Fire', frost: 'Frost' },
        WARLOCK: { affliction: 'Affliction', demonology: 'Demonology', destruction: 'Destruction' },
        DRUID: { balance: 'Balance', feral: 'Feral', guardian: 'Guardian', restoration: 'Restoration' },
    };

    function specNameToKey(className, specName) {
        if (!className || !specName) return null;
        const cls = String(className).toUpperCase();
        const table = WCL_SPEC_NAMES[cls];
        if (!table) return null;
        const spec = table[String(specName).toLowerCase().replace(/[^a-z]/g, '')];
        return spec ? cls + ':' + spec : null;
    }

    // Every spec with a nonzero engine baseline — what the medians sweep queries.
    // className/specName are the forms WCL's GraphQL arguments expect.
    const WCL_SPECS = [
        ['Warrior', 'Arms'], ['Warrior', 'Fury'], ['Warrior', 'Protection'],
        ['Paladin', 'Retribution'], ['Paladin', 'Protection'],
        ['Hunter', 'BeastMastery'], ['Hunter', 'Marksmanship'], ['Hunter', 'Survival'],
        ['Rogue', 'Assassination'], ['Rogue', 'Combat'], ['Rogue', 'Subtlety'],
        ['Priest', 'Shadow'],
        ['Shaman', 'Elemental'], ['Shaman', 'Enhancement'],
        ['Mage', 'Arcane'], ['Mage', 'Fire'], ['Mage', 'Frost'],
        ['Warlock', 'Affliction'], ['Warlock', 'Demonology'], ['Warlock', 'Destruction'],
        ['Druid', 'Balance'], ['Druid', 'Feral'],
    ].map(([className, specName]) => ({ className, specName, specKey: specNameToKey(className, specName) }));

    return { DEFAULT_ZONE, specNameToKey, WCL_SPECS };
}));
