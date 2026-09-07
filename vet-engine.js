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
    const HAND_TYPE_TWO_HAND = 4;
    const RANGED_ENCHANTABLE = { 1: true, 2: true, 3: true }; // bow, crossbow, gun (scopes)

    // GearScore, using the TacoTip algorithm (anzz1/TacoTip gearscore.lua) — the GearScore
    // variant TBC players actually run. The load-bearing difference from the original WotLK
    // GearScore is the bracket selection below: epics stay in bracket B up to item level 167.
    // The WotLK original switches to bracket A above 120, which sits dead centre of the TBC gear
    // range and inverts there — an ilvl 121 epic scores 42% LOWER than an ilvl 120 one and does
    // not recover until ilvl 143. Under these brackets the score is monotonic across TBC.
    const GS_SCALE = 1.8618;
    const GS_FORMULA = {
        A: { 4: { A: 91.45, B: 0.65 }, 3: { A: 81.375, B: 0.8125 }, 2: { A: 73, B: 1 } },
        // B[1] (common) can never be selected: itemGearScore remaps rarity 0/1 to 2 before any
        // table lookup. Kept anyway because it mirrors the TacoTip source table verbatim.
        B: { 4: { A: 26, B: 1.2 }, 3: { A: 0.75, B: 1.8 }, 2: { A: 8, B: 2 }, 1: { A: 0, B: 2.25 } },
        C: { 4: { A: 0.25, B: 1.6275 } },
    };
    const GS_SLOTMOD = {
        INVTYPE_HEAD: 1.0, INVTYPE_NECK: 0.5625, INVTYPE_SHOULDER: 0.75, INVTYPE_CLOAK: 0.5625,
        INVTYPE_CHEST: 1.0, INVTYPE_WAIST: 0.75, INVTYPE_LEGS: 1.0, INVTYPE_FEET: 0.75,
        INVTYPE_WRIST: 0.5625, INVTYPE_HAND: 0.75, INVTYPE_FINGER: 0.5625, INVTYPE_TRINKET: 0.5625,
        INVTYPE_2HWEAPON: 2.0, INVTYPE_WEAPONMAINHAND: 1.0, INVTYPE_WEAPONOFFHAND: 1.0,
        INVTYPE_WEAPON: 1.0, INVTYPE_SHIELD: 1.0, INVTYPE_HOLDABLE: 1.0,
        INVTYPE_RANGED: 0.3164, INVTYPE_RANGEDRIGHT: 0.3164, INVTYPE_THROWN: 0.3164,
        INVTYPE_RELIC: 0.3164,
    };
    // Hunters: TacoTip discounts the weapon slots and heavily weights the ranged slot, since a
    // hunter's bow is their primary weapon.
    const GS_HUNTER_WEAPON = 0.3164;
    const GS_HUNTER_RANGED = 5.3224;
    const GS_IS_WEAPON_INV = {
        INVTYPE_2HWEAPON: 1, INVTYPE_WEAPONMAINHAND: 1, INVTYPE_WEAPONOFFHAND: 1,
        INVTYPE_WEAPON: 1, INVTYPE_HOLDABLE: 1,
    };

    // Our slot key plus the item-table row -> TacoTip's INVTYPE. The item table's `type` is
    // already implied by the slot key, so only the weapon and ranged slots need the item.
    const GS_INV_BY_SLOT = {
        head: 'INVTYPE_HEAD', neck: 'INVTYPE_NECK', shoulder: 'INVTYPE_SHOULDER',
        back: 'INVTYPE_CLOAK', chest: 'INVTYPE_CHEST', waist: 'INVTYPE_WAIST',
        legs: 'INVTYPE_LEGS', feet: 'INVTYPE_FEET', wrist: 'INVTYPE_WRIST', hands: 'INVTYPE_HAND',
        finger1: 'INVTYPE_FINGER', finger2: 'INVTYPE_FINGER',
        trinket1: 'INVTYPE_TRINKET', trinket2: 'INVTYPE_TRINKET',
    };
    const WEAPON_TYPE_SHIELD = 7;

    function gsInvType(slotKey, item) {
        if (GS_INV_BY_SLOT[slotKey]) return GS_INV_BY_SLOT[slotKey];
        if (slotKey === 'ranged') {
            if (!item) return 'INVTYPE_RANGEDRIGHT';
            if (item.rangedWeaponType >= 6) return 'INVTYPE_RELIC';
            if (item.rangedWeaponType === 4) return 'INVTYPE_THROWN';
            return 'INVTYPE_RANGEDRIGHT';
        }
        if (slotKey === 'mainHand' || slotKey === 'offHand') {
            if (!item) return 'INVTYPE_WEAPON';
            if (item.handType === HAND_TYPE_TWO_HAND) return 'INVTYPE_2HWEAPON';
            if (slotKey === 'offHand') {
                if (item.weaponType === WEAPON_TYPE_SHIELD) return 'INVTYPE_SHIELD';
                if (item.weaponType === WEAPON_TYPE_HELD) return 'INVTYPE_HOLDABLE';
                return 'INVTYPE_WEAPONOFFHAND';
            }
            return item.handType === 1 ? 'INVTYPE_WEAPONMAINHAND' : 'INVTYPE_WEAPON';
        }
        return null;
    }

    function itemGearScore(itemLevel, quality, invType) {
        const mod = GS_SLOTMOD[invType];
        if (!mod) return 0;
        let rarity = quality, qualityScale = 1;
        if (rarity === 5) { qualityScale = 1.3; rarity = 4; }
        else if (rarity === 1 || rarity === 0) { qualityScale = 0.005; rarity = 2; }
        let table;
        if (itemLevel < 100 && rarity === 4) table = GS_FORMULA.C;
        else if (itemLevel < 168 && rarity === 4) table = GS_FORMULA.B;
        else if (itemLevel < 148 && rarity === 3) table = GS_FORMULA.B;
        else if (itemLevel < 138 && rarity === 2) table = GS_FORMULA.B;
        else if (itemLevel <= 120) table = GS_FORMULA.B;
        else table = GS_FORMULA.A;
        const t = table[rarity];
        if (!t) return 0;
        return Math.max(0, Math.floor(((itemLevel - t.A) / t.B) * mod * GS_SCALE * qualityScale));
    }

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
        const hunter = String(classToken).toUpperCase() === 'HUNTER';
        let ilvlWeighted = 0, ilvlWeight = 0, gearScore = 0, missingEnchants = 0, emptySockets = 0;
        const slots = SLOTS.map(slot => {
            const g = gear[slot.wclIndex];
            if (!g || !g.id) return { key: slot.key, label: slot.label, id: 0, empty: true };
            const item = db.items.get(g.id);
            if (!item) unknownItems.push(g.id);
            const itemLevel = g.itemLevel || (item && item.ilvl) || 0;
            const twoHanded = !!(item && item.handType === HAND_TYPE_TWO_HAND);
            // A two-hander occupies both weapon slots, so it counts for both in the average.
            ilvlWeighted += itemLevel * (twoHanded ? 2 : 1);
            ilvlWeight += (twoHanded ? 2 : 1);
            const invType = gsInvType(slot.key, item);
            const quality = g.quality != null ? g.quality : (item ? item.quality : 0);
            let slotScore = itemGearScore(itemLevel, quality, invType);
            if (hunter) {
                if (GS_IS_WEAPON_INV[invType]) slotScore = Math.floor(slotScore * GS_HUNTER_WEAPON);
                else if (invType === 'INVTYPE_RANGEDRIGHT' || invType === 'INVTYPE_RANGED') slotScore = Math.floor(slotScore * GS_HUNTER_RANGED);
            }
            gearScore += slotScore;
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
            slots, avgItemLevel: Math.round(ilvlWeighted / Math.max(ilvlWeight, SLOTS.length) * 100) / 100, stats,
            missingEnchants, emptySockets, unknownItems, gearScore,
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

    const WCL_CLASS_IDS = { 2: 'DRUID', 3: 'HUNTER', 4: 'MAGE', 6: 'PALADIN', 7: 'PRIEST', 8: 'ROGUE', 9: 'SHAMAN', 10: 'WARLOCK', 11: 'WARRIOR' };

    const WCL_SPEC_FOLD = { 'PALADIN:justicar': 'Protection', 'WARRIOR:gladiator': 'Protection', 'DRUID:guardian': 'Guardian' };

    function normalizeWclSpec(classToken, name) {
        if (!classToken || !name) return null;
        const cls = String(classToken).toUpperCase();
        const flat = String(name).toLowerCase().replace(/[^a-z]/g, '');
        const folded = WCL_SPEC_FOLD[cls + ':' + flat];
        if (folded) return folded;
        const trees = E.SPEC_TREES[cls] || [];
        const hit = trees.find(t => t.toLowerCase().replace(/[^a-z]/g, '') === flat);
        return hit || null;
    }

    const ARCHETYPE_ROLE = {
        healer: 'healer', bear: 'tank', protWarrior: 'tank', protPaladin: 'tank',
        caster: 'caster', hunter: 'ranged', wfMelee: 'melee', enhShaman: 'melee', feralCat: 'melee',
    };
    const ROLE_BY_SPEC = {};
    Object.keys(E.SPECS_BY_ARCHETYPE).forEach(a => E.SPECS_BY_ARCHETYPE[a].forEach(k => { ROLE_BY_SPEC[k] = ARCHETYPE_ROLE[a] || null; }));

    function roleOf(classToken, spec) {
        return ROLE_BY_SPEC[String(classToken).toUpperCase() + ':' + spec] || null;
    }

    function detectSpec(classToken, talentPoints, wclSpecName) {
        const cls = classToken ? String(classToken).toUpperCase() : null;
        let spec = null, detectedFrom = null, ambiguous = true;
        if (cls && Array.isArray(talentPoints) && talentPoints.length === 3) {
            const r = E.inferSpec(cls, talentPoints);
            if (r.spec && !r.ambiguous) { spec = r.spec; detectedFrom = 'talents'; ambiguous = false; }
        }
        const fromWcl = cls ? normalizeWclSpec(cls, wclSpecName) : null;
        if (!spec && fromWcl) { spec = fromWcl; detectedFrom = 'wcl'; }
        // Bear and cat share a tree; only WCL's kill classification can tell them apart.
        if (cls === 'DRUID' && spec === 'Feral' && fromWcl === 'Guardian') spec = 'Guardian';
        return { spec, role: spec ? roleOf(cls, spec) : null, detectedFrom, ambiguous };
    }

    // Hit granted by each spec's standard talent, in percent (spec §6), gated on the tree total
    // needed to hold that talent at full rank: 5 * rowIdx + maxPoints, from the wowsims trees.
    // WCL reports only the three-tree split, so this is the finest check available — and it is
    // enough: a 41/20/0 hunter has no Survival points and therefore no Surefooted.
    const TALENT_HIT_ALLOWANCE = {
        'WARRIOR:Arms':         { pct: 3,  tree: 1, minPoints: 33, talent: 'Precision' },  // Fury row 7
        'WARRIOR:Fury':         { pct: 3,  tree: 1, minPoints: 33, talent: 'Precision' },
        'ROGUE:Assassination':  { pct: 5,  tree: 1, minPoints: 10, talent: 'Precision' },  // Combat row 2
        'ROGUE:Combat':         { pct: 5,  tree: 1, minPoints: 10, talent: 'Precision' },
        'ROGUE:Subtlety':       { pct: 5,  tree: 1, minPoints: 10, talent: 'Precision' },
        'SHAMAN:Enhancement':   { pct: 6,  tree: 1, minPoints: 33, talent: 'Dual Wield Specialization' },  // Enh row 7
        'HUNTER:Beast Mastery': { pct: 3,  tree: 2, minPoints: 18, talent: 'Surefooted' },  // Survival row 4
        'HUNTER:Marksmanship':  { pct: 3,  tree: 2, minPoints: 18, talent: 'Surefooted' },
        'HUNTER:Survival':      { pct: 3,  tree: 2, minPoints: 18, talent: 'Surefooted' },
        'MAGE:Fire':            { pct: 3,  tree: 2, minPoints: 3,  talent: 'Elemental Precision' },  // Frost row 1
        'MAGE:Frost':           { pct: 3,  tree: 2, minPoints: 3,  talent: 'Elemental Precision' },
        'MAGE:Arcane':          { pct: 10, tree: 0, minPoints: 5,  talent: 'Arcane Focus' },  // Arcane row 1
        'WARLOCK:Affliction':   { pct: 10, tree: 0, minPoints: 5,  talent: 'Suppression' },  // Affliction row 1
        'PRIEST:Shadow':        { pct: 10, tree: 2, minPoints: 10, talent: 'Shadow Focus' },  // Shadow row 2
        'DRUID:Balance':        { pct: 4,  tree: 0, minPoints: 27, talent: 'Balance of Power' },  // Balance row 6
        'SHAMAN:Elemental':     { pct: 6,  tree: 0, minPoints: 28, talent: 'Elemental Precision' },  // Ele row 6
        'PALADIN:Retribution':  { pct: 3,  tree: 1, minPoints: 8,  talent: 'Precision' },  // Protection row 2
    };

    function hitAllowanceRating(classToken, spec, role, talentSplit) {
        const entry = TALENT_HIT_ALLOWANCE[String(classToken).toUpperCase() + ':' + spec];
        if (!entry) return 0;
        if (!Array.isArray(talentSplit) || talentSplit.length !== 3) return 0;
        const points = talentSplit[entry.tree];
        if (typeof points !== 'number' || !Number.isFinite(points) || points < entry.minPoints) return 0;
        const per = role === 'caster' ? RATING.SPELL_HIT_PER_PCT : RATING.MELEE_HIT_PER_PCT;
        return Math.round(entry.pct * per);
    }

    // Defense skill granted by Anticipation (5 ranks, +4 each), the talent every plate tank
    // takes. Same gating as the hit table: the tree total must reach 5 * rowIdx + maxPoints.
    // Without this, every prot warrior and paladin reads 20 skill under their character sheet —
    // the 2026-09-03 calibration's "two crittable tanks at 478 and 471" were 498 and 491.
    const TALENT_DEFENSE_ALLOWANCE = {
        'PALADIN:Protection': { skill: 20, tree: 1, minPoints: 20, talent: 'Anticipation' },  // Protection row 4
        'WARRIOR:Protection': { skill: 20, tree: 2, minPoints: 5,  talent: 'Anticipation' },  // Protection row 1
    };

    function defenseAllowanceSkill(classToken, spec, talentSplit) {
        const entry = TALENT_DEFENSE_ALLOWANCE[String(classToken).toUpperCase() + ':' + spec];
        if (!entry) return 0;
        if (!Array.isArray(talentSplit) || talentSplit.length !== 3) return 0;
        const points = talentSplit[entry.tree];
        if (typeof points !== 'number' || !Number.isFinite(points) || points < entry.minPoints) return 0;
        return entry.skill;
    }

    // Calibrated 2026-09-03 against a real 45-character roster; see spec §6 "Calibration pass".
    const DEFAULT_THRESHOLDS = {
        gs: 1700, ilvl: 110, meleeHit: 142, spellHit: 202, expertise: 0, defense: 490, parse: 20,
        enchantWarn: 2, enchantFail: 4, socketWarn: 1, socketFail: 3, staleDays: 28,
    };

    function parseThresholds(obj) {
        const t = Object.assign({}, DEFAULT_THRESHOLDS);
        if (obj && typeof obj === 'object') Object.keys(DEFAULT_THRESHOLDS).forEach(k => {
            const v = Number(obj[k]);
            if (obj[k] !== null && obj[k] !== '' && Number.isFinite(v)) t[k] = v;
        });
        return t;
    }

    function rule(key, label, applies, status, value, threshold, effective, note) {
        return { key, label, applies, status, value, threshold, effective, note: note || '' };
    }

    function evaluate(profile, thresholds, nowMs) {
        const t = parseThresholds(thresholds);
        const id = profile.identity || {};
        const cls = id.class ? String(id.class).toUpperCase() : null;
        const role = id.role || null;
        const c = profile.computed || null;
        const g = profile.gearSummary || null;
        const rules = [];

        const gsValue = g && typeof g.gearScore === 'number' ? g.gearScore : null;
        rules.push(gsValue !== null
            ? rule('gs', 'gearscore', true, gsValue < t.gs ? 'fail' : 'pass', gsValue, t.gs, t.gs)
            : rule('gs', 'gearscore', true, 'unknown', null, t.gs, t.gs, 'no gear data'));

        rules.push(c ? rule('ilvl', 'item level', true, c.avgItemLevel < t.ilvl ? 'fail' : 'pass', c.avgItemLevel, t.ilvl, t.ilvl)
                     : rule('ilvl', 'item level', true, 'unknown', null, t.ilvl, t.ilvl, 'no gear data'));

        const hitApplies = role === 'melee' || role === 'ranged' || role === 'caster';
        if (!hitApplies) rules.push(rule('hit', 'hit', false, 'pass', null, null, null));
        else {
            const threshold = role === 'caster' ? t.spellHit : t.meleeHit;
            const allowance = hitAllowanceRating(cls, id.spec, role, id.talentSplit);
            const effective = threshold - allowance;
            const value = c ? (role === 'caster' ? c.spellHit : role === 'ranged' ? c.rangedHit : c.meleeHit) : null;
            let note = allowance ? threshold + ' − ' + allowance + ' from talents = ' + effective : '';
            if (!allowance) {
                const entry = TALENT_HIT_ALLOWANCE[cls + ':' + id.spec];
                if (entry) note = entry.talent + ' not reachable with ' + (Array.isArray(id.talentSplit) ? id.talentSplit[entry.tree] : 0) + ' ' + (E.SPEC_TREES[cls] || [])[entry.tree] + ' (needs ' + entry.minPoints + ') — no allowance';
            }
            const gearOnly = profile.gearOnly;
            if (c && gearOnly) {
                const fromGear = role === 'caster' ? gearOnly.spellHit : gearOnly.meleeHit;
                if (typeof fromGear === 'number' && Math.abs(fromGear - value) > 0.05 * threshold) {
                    note += (note ? ' · ' : '') + 'gear sums to ' + fromGear + ', WCL reported ' + value;
                }
            }
            rules.push(c ? rule('hit', 'hit', true, value < effective ? 'fail' : 'pass', value, threshold, effective, note)
                         : rule('hit', 'hit', true, 'unknown', null, threshold, effective, 'no gear data'));
        }

        const expApplies = role === 'melee' || (role === 'tank' && (cls === 'WARRIOR' || cls === 'PALADIN'));
        if (!expApplies) rules.push(rule('expertise', 'expertise', false, 'pass', null, null, null));
        else rules.push(c ? rule('expertise', 'expertise', true, c.expertiseSkill < t.expertise ? 'warn' : 'pass', c.expertiseSkill, t.expertise, t.expertise)
                          : rule('expertise', 'expertise', true, 'unknown', null, t.expertise, t.expertise, 'no gear data'));

        const defApplies = role === 'tank' && cls !== 'DRUID';
        if (!defApplies) rules.push(rule('defense', 'defense', false, 'pass', null, null, null));
        else if (!c) rules.push(rule('defense', 'defense', true, 'unknown', null, t.defense, t.defense, 'no gear data'));
        else {
            // Talent defense is added to the value (not subtracted from the cap, as hit does) so the
            // cell shows the same number as the character sheet.
            const allowance = defenseAllowanceSkill(cls, id.spec, id.talentSplit);
            const value = c.defenseSkill + allowance;
            let note = allowance ? c.defenseSkill + ' + ' + allowance + ' from ' + TALENT_DEFENSE_ALLOWANCE[cls + ':' + id.spec].talent + ' = ' + value : '';
            if (!allowance) {
                const entry = TALENT_DEFENSE_ALLOWANCE[cls + ':' + id.spec];
                if (entry) note = entry.talent + ' not reachable with ' + (Array.isArray(id.talentSplit) ? id.talentSplit[entry.tree] : 0) + ' ' + (E.SPEC_TREES[cls] || [])[entry.tree] + ' (needs ' + entry.minPoints + ') — no allowance';
            }
            rules.push(rule('defense', 'defense', true, value < t.defense ? 'fail' : 'pass', value, t.defense, t.defense, note));
        }

        const p = profile.parses;
        let parseNote = '';
        if (p && p.other) {
            parseNote = p.zoneName + ' ' + Math.round(p.medianPercent) + ' · ' + p.other.zoneName + ' ' + Math.round(p.other.medianPercent);
        } else if (p && p.fallback) {
            parseNote = 'previous tier';
        }
        rules.push(p && typeof p.medianPercent === 'number'
            ? rule('parse', 'parse', true, p.medianPercent < t.parse ? 'fail' : 'pass', Math.round(p.medianPercent), t.parse, t.parse, parseNote)
            : rule('parse', 'parse', true, 'unknown', null, t.parse, t.parse, 'no parses in either tier'));

        function countRule(key, label, value, warnAt, failAt) {
            if (!g) return rule(key, label, true, 'unknown', null, warnAt, warnAt, 'no gear data');
            if (typeof value !== 'number' || !Number.isFinite(value)) return rule(key, label, true, 'unknown', null, warnAt, warnAt, 'no gear data');
            const status = value >= failAt ? 'fail' : value >= warnAt ? 'warn' : 'pass';
            return rule(key, label, true, status, value, warnAt, failAt, 'warn at ' + warnAt + ', fail at ' + failAt);
        }
        rules.push(countRule('enchants', 'enchants missing', g ? g.missingEnchants : null, t.enchantWarn, t.enchantFail));
        rules.push(countRule('sockets', 'sockets empty', g ? g.emptySockets : null, t.socketWarn, t.socketFail));

        const ls = profile.lastSeen;
        if (ls && typeof ls.timestamp === 'number') {
            const days = Math.floor((nowMs - ls.timestamp) / 86400e3);
            rules.push(rule('stale', 'last seen', true, days > t.staleDays ? 'warn' : 'pass', days, t.staleDays, t.staleDays, days + ' days ago'));
        } else rules.push(rule('stale', 'last seen', true, 'unknown', null, t.staleDays, t.staleDays, 'never logged'));

        const live = rules.filter(r => r.applies);
        const verdict = live.some(r => r.status === 'fail') ? 'fail'
            : live.some(r => r.status === 'warn') ? 'warn'
            : live.some(r => r.status === 'unknown') ? 'unverified' : 'pass';

        const short = n => Math.round(n * 100) / 100;
        const reasons = live.filter(r => r.status === 'fail' || r.status === 'warn').map(r => {
            if (r.key === 'hit') return 'hit ' + r.value + '/' + r.effective + ' (−' + short(r.effective - r.value) + ')';
            if (r.key === 'gs') return 'gearscore ' + r.value + '/' + r.threshold + ' (−' + short(r.threshold - r.value) + ')';
            if (r.key === 'ilvl') return 'item level ' + r.value + '/' + r.threshold + ' (−' + short(r.threshold - r.value) + ')';
            if (r.key === 'enchants' || r.key === 'sockets') return r.label + ' ' + r.value;
            if (r.key === 'stale') return 'last seen ' + r.value + 'd ago';
            return r.label + ' ' + r.value + '/' + r.threshold;
        });
        return { verdict, rules, reasons };
    }

    // --- name intake ---
    // Names arrive pasted from anywhere (one per line, comma lists, a whisper log) or through the
    // #add= fragment the addon's copy link carries. Cross-realm names come as Name-Realm; the page
    // vets on its one configured realm, so the suffix is dropped. Character names cannot contain
    // a hyphen, so everything from the first one on is realm.
    function parseNameList(text) {
        if (typeof text !== 'string') return [];
        const seen = new Set();
        const out = [];
        text.split(/[\s,;]+/).forEach(tok => {
            const name = tok.replace(/-.*$/, '');
            if (!name) return;
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(name);
        });
        return out;
    }
    function namesFromHash(hash) {
        const m = /^#add=(.+)$/.exec(String(hash || ''));
        if (!m) return [];
        let decoded;
        try { decoded = decodeURIComponent(m[1]); } catch (e) { return []; }
        return parseNameList(decoded);
    }
    // A Warcraft Logs report is a 16-character code; people paste either the bare code or a
    // report URL (…/reports/<code>#fight=3). Anything else is null.
    function parseReportCode(text) {
        const s = String(text || '').trim();
        const m = /\/reports\/([A-Za-z0-9]{16})(?:[\/?#]|$)/.exec(s) || /^([A-Za-z0-9]{16})$/.exec(s);
        return m ? m[1] : null;
    }

    const VERDICT_ORDER = { fail: 0, warn: 1, unverified: 2, pass: 3 };
    function sortRows(rows) {
        return rows.slice().sort((a, b) =>
            (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) || String(a.name).localeCompare(String(b.name)));
    }

    return {
        STAT, RATING, SLOTS, GEM_FITS, WCL_CLASS_IDS, TALENT_HIT_ALLOWANCE, TALENT_DEFENSE_ALLOWANCE, DEFAULT_THRESHOLDS, VERDICT_ORDER,
        GS_SCALE, GS_FORMULA, GS_SLOTMOD, gsInvType, itemGearScore,
        indexDb, summarizeGear, derivedStats,
        normalizeWclSpec, roleOf, detectSpec, hitAllowanceRating, defenseAllowanceSkill, parseThresholds, evaluate, sortRows,
        parseNameList, namesFromHash, parseReportCode,
    };
}));
