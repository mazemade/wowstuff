(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.VetEngine = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    // wowsims Stat enum indices (proto/common.proto). Only the ones the page reads are named.
    const STAT = {
        STRENGTH: 0, AGILITY: 1, STAMINA: 2, INTELLECT: 3, HEALING: 4, SPELL_DAMAGE: 5,
        SPELL_HIT: 12, SPELL_CRIT: 13, SPELL_HASTE: 14, SPIRIT: 16,
        ATTACK_POWER: 17, RANGED_ATTACK_POWER: 18, MELEE_HIT: 20, MELEE_CRIT: 21, MELEE_HASTE: 22,
        ARMOR_PEN: 23, EXPERTISE: 24, DEFENSE: 25, BLOCK_RATING: 26, BLOCK_VALUE: 27,
        DODGE: 28, PARRY: 29, ARMOR: 31, MP5: 35,
    };

    const RATING = {
        MELEE_HIT_PER_PCT: 15.77, SPELL_HIT_PER_PCT: 12.62,
        EXPERTISE_PER_POINT: 3.94, DEFENSE_PER_POINT: 2.37, BASE_DEFENSE: 350,
    };

    // WCL's combatantinfo gear array is in inventory-slot order; 3 (shirt) and 18 (tabard) are
    // cosmetic and skipped.
    const SLOTS = [
        { key: 'head', wclIndex: 0, label: 'Head' }, { key: 'neck', wclIndex: 1, label: 'Neck' },
        { key: 'shoulder', wclIndex: 2, label: 'Shoulder' }, { key: 'chest', wclIndex: 4, label: 'Chest' },
        { key: 'waist', wclIndex: 5, label: 'Waist' }, { key: 'legs', wclIndex: 6, label: 'Legs' },
        { key: 'feet', wclIndex: 7, label: 'Feet' }, { key: 'wrist', wclIndex: 8, label: 'Wrist' },
        { key: 'hands', wclIndex: 9, label: 'Hands' }, { key: 'finger1', wclIndex: 10, label: 'Ring 1' },
        { key: 'finger2', wclIndex: 11, label: 'Ring 2' }, { key: 'trinket1', wclIndex: 12, label: 'Trinket 1' },
        { key: 'trinket2', wclIndex: 13, label: 'Trinket 2' }, { key: 'back', wclIndex: 14, label: 'Back' },
        { key: 'mainHand', wclIndex: 15, label: 'Main hand' }, { key: 'offHand', wclIndex: 16, label: 'Off hand' },
        { key: 'ranged', wclIndex: 17, label: 'Ranged' },
    ];

    // Gem colour -> socket colours it satisfies (wowsims GemColor: 1 meta 2 red 3 blue 4 yellow
    // 5 green 6 orange 7 purple 8 prismatic).
    const GEM_FITS = { 1: [1], 2: [2], 3: [3], 4: [4], 5: [3, 4], 6: [2, 4], 7: [2, 3], 8: [2, 3, 4] };

    const ALWAYS_ENCHANTABLE = { head: 1, shoulder: 1, back: 1, chest: 1, wrist: 1, hands: 1, legs: 1, feet: 1, mainHand: 1 };
    const WEAPON_TYPE_HELD = 5;
    const RANGED_ENCHANTABLE = { 1: true, 2: true, 3: true }; // bow, crossbow, gun (scopes)

    function indexDb(db) {
        return {
            items: new Map(db.items.map(i => [i.id, i])),
            gems: new Map(db.gems.map(g => [g.id, g])),
            enchants: new Map(db.enchants.map(e => [e.effectId, e])),
        };
    }

    function addStats(into, stats) {
        if (!stats) return;
        Object.keys(stats).forEach(k => { into[k] = (into[k] || 0) + stats[k]; });
    }

    function isEnchantable(slotKey, item, classToken, ringEnchanter) {
        if (ALWAYS_ENCHANTABLE[slotKey]) return true;
        // A weapon or a shield can be enchanted; a held-in-off-hand item cannot.
        if (slotKey === 'offHand') return !!item && item.type === 13 && item.weaponType !== WEAPON_TYPE_HELD;
        if (slotKey === 'ranged') return classToken === 'HUNTER' && !!item && !!RANGED_ENCHANTABLE[item.rangedWeaponType];
        if (slotKey === 'finger1' || slotKey === 'finger2') return ringEnchanter;
        return false;
    }

    function summarizeGear(wclGear, db, classToken) {
        const gear = Array.isArray(wclGear) ? wclGear : [];
        const stats = {};
        const unknownItems = [];
        // An enchanted ring means the player is an enchanter, so both rings count as enchantable.
        const ringEnchanter = [10, 11].some(i => gear[i] && gear[i].id && gear[i].permanentEnchant);
        let ilvlSum = 0, missingEnchants = 0, emptySockets = 0;
        const slots = SLOTS.map(slot => {
            const g = gear[slot.wclIndex];
            if (!g || !g.id) return { key: slot.key, label: slot.label, id: 0, empty: true };
            const item = db.items.get(g.id);
            if (!item) unknownItems.push(g.id);
            const itemLevel = g.itemLevel || (item && item.ilvl) || 0;
            ilvlSum += itemLevel;
            addStats(stats, item && item.stats);
            let enchant = null;
            if (g.permanentEnchant) {
                const e = db.enchants.get(g.permanentEnchant);
                enchant = { id: g.permanentEnchant, name: e ? e.name : 'Unknown enchant ' + g.permanentEnchant };
                addStats(stats, e && e.stats);
            }
            const sockets = item ? (item.gemSockets || []) : [];
            const gemsIn = (g.gems || []).map(x => {
                const gem = db.gems.get(x.id);
                addStats(stats, gem && gem.stats);
                return { id: x.id, name: gem ? gem.name : 'Unknown gem ' + x.id, color: gem ? gem.color : 0 };
            });
            const slotEmpty = Math.max(0, sockets.length - gemsIn.length);
            emptySockets += slotEmpty;
            const bonusActive = sockets.length > 0 && slotEmpty === 0 &&
                sockets.every((c, j) => gemsIn[j] && (GEM_FITS[gemsIn[j].color] || []).indexOf(c) !== -1);
            if (bonusActive) addStats(stats, item.socketBonus);
            const enchantable = isEnchantable(slot.key, item, classToken, ringEnchanter);
            if (enchantable && !enchant) missingEnchants++;
            return {
                key: slot.key, label: slot.label, id: g.id, name: item ? item.name : 'Unknown item ' + g.id,
                itemLevel, quality: g.quality != null ? g.quality : (item ? item.quality : 0),
                enchant, gems: gemsIn.map(x => ({ id: x.id, name: x.name })), sockets: sockets.length,
                emptySockets: slotEmpty, socketBonusActive: bonusActive, enchantable,
            };
        });
        return {
            slots, avgItemLevel: Math.round(ilvlSum / SLOTS.length * 100) / 100, stats,
            missingEnchants, emptySockets, unknownItems,
            socketBonusesApplied: true, setBonusesApplied: false,
        };
    }

    function pick(reported, key, fallback) {
        return reported && typeof reported[key] === 'number' ? reported[key] : (fallback || 0);
    }

    function derivedStats(stats, reported) {
        const s = stats || {};
        const expertiseRating = pick(reported, 'expertise', s[STAT.EXPERTISE]);
        const defenseRating = s[STAT.DEFENSE] || 0;
        return {
            spellDamage: s[STAT.SPELL_DAMAGE] || 0, healing: s[STAT.HEALING] || 0,
            attackPower: s[STAT.ATTACK_POWER] || 0, rangedAttackPower: s[STAT.RANGED_ATTACK_POWER] || 0,
            mp5: s[STAT.MP5] || 0,
            defenseRating, defenseSkill: RATING.BASE_DEFENSE + Math.floor(defenseRating / RATING.DEFENSE_PER_POINT),
            expertiseRating, expertiseSkill: Math.floor(expertiseRating / RATING.EXPERTISE_PER_POINT),
            meleeHit: pick(reported, 'hitMelee', s[STAT.MELEE_HIT]),
            rangedHit: pick(reported, 'hitRanged', s[STAT.MELEE_HIT]),
            spellHit: pick(reported, 'hitSpell', s[STAT.SPELL_HIT]),
            meleeCrit: pick(reported, 'critMelee', s[STAT.MELEE_CRIT]),
            spellCrit: pick(reported, 'critSpell', s[STAT.SPELL_CRIT]),
            meleeHaste: pick(reported, 'hasteMelee', s[STAT.MELEE_HASTE]),
            spellHaste: pick(reported, 'hasteSpell', s[STAT.SPELL_HASTE]),
            armor: pick(reported, 'armor', s[STAT.ARMOR]),
            strength: pick(reported, 'strength', s[STAT.STRENGTH]), agility: pick(reported, 'agility', s[STAT.AGILITY]),
            stamina: pick(reported, 'stamina', s[STAT.STAMINA]), intellect: pick(reported, 'intellect', s[STAT.INTELLECT]),
            spirit: pick(reported, 'spirit', s[STAT.SPIRIT]),
        };
    }

    return { STAT, RATING, SLOTS, GEM_FITS, indexDb, summarizeGear, derivedStats };
}));
