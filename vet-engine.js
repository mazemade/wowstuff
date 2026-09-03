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

    // Hit granted by the talents every standard build takes, in percent (spec §6).
    const TALENT_HIT_ALLOWANCE = {
        'WARRIOR:Arms': 3, 'WARRIOR:Fury': 3,
        'ROGUE:Assassination': 5, 'ROGUE:Combat': 5, 'ROGUE:Subtlety': 5,
        'SHAMAN:Enhancement': 6,
        'HUNTER:Beast Mastery': 3, 'HUNTER:Marksmanship': 3, 'HUNTER:Survival': 3,
        'MAGE:Fire': 3, 'MAGE:Frost': 3, 'MAGE:Arcane': 10,
        'WARLOCK:Affliction': 10, 'PRIEST:Shadow': 10, 'DRUID:Balance': 4, 'SHAMAN:Elemental': 6,
    };

    function hitAllowanceRating(classToken, spec, role) {
        const pct = TALENT_HIT_ALLOWANCE[String(classToken).toUpperCase() + ':' + spec] || 0;
        const per = role === 'caster' ? RATING.SPELL_HIT_PER_PCT : RATING.MELEE_HIT_PER_PCT;
        return Math.round(pct * per);
    }

    const DEFAULT_THRESHOLDS = {
        ilvl: 125, meleeHit: 142, spellHit: 202, expertise: 26, defense: 490, parse: 40,
        enchantWarn: 1, enchantFail: 3, socketWarn: 1, socketFail: 3, staleDays: 28,
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

        rules.push(c ? rule('ilvl', 'item level', true, c.avgItemLevel < t.ilvl ? 'fail' : 'pass', c.avgItemLevel, t.ilvl, t.ilvl)
                     : rule('ilvl', 'item level', true, 'unknown', null, t.ilvl, t.ilvl, 'no gear data'));

        const hitApplies = role === 'melee' || role === 'ranged' || role === 'caster';
        if (!hitApplies) rules.push(rule('hit', 'hit', false, 'pass', null, null, null));
        else {
            const threshold = role === 'caster' ? t.spellHit : t.meleeHit;
            const allowance = hitAllowanceRating(cls, id.spec, role);
            const effective = threshold - allowance;
            const value = c ? (role === 'caster' ? c.spellHit : role === 'ranged' ? c.rangedHit : c.meleeHit) : null;
            let note = allowance ? threshold + ' − ' + allowance + ' from talents = ' + effective : '';
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
        else rules.push(c ? rule('defense', 'defense', true, c.defenseSkill < t.defense ? 'fail' : 'pass', c.defenseSkill, t.defense, t.defense)
                          : rule('defense', 'defense', true, 'unknown', null, t.defense, t.defense, 'no gear data'));

        const p = profile.parses;
        rules.push(p && typeof p.medianPercent === 'number'
            ? rule('parse', 'parse', true, p.medianPercent < t.parse ? 'fail' : 'pass', Math.round(p.medianPercent), t.parse, t.parse, p.fallback ? 'previous tier' : '')
            : rule('parse', 'parse', true, 'unknown', null, t.parse, t.parse, 'no parses in either tier'));

        function countRule(key, label, value, warnAt, failAt) {
            if (!g) return rule(key, label, true, 'unknown', null, warnAt, warnAt, 'no gear data');
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

        const reasons = live.filter(r => r.status === 'fail' || r.status === 'warn').map(r => {
            if (r.key === 'hit') return 'hit ' + r.value + '/' + r.effective + ' (−' + (r.effective - r.value) + ')';
            if (r.key === 'enchants' || r.key === 'sockets') return r.label + ' ' + r.value;
            if (r.key === 'stale') return 'last seen ' + r.value + 'd ago';
            return r.label + ' ' + r.value + '/' + r.threshold;
        });
        return { verdict, rules, reasons };
    }

    const VERDICT_ORDER = { fail: 0, warn: 1, unverified: 2, pass: 3 };
    function sortRows(rows) {
        return rows.slice().sort((a, b) =>
            (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) || String(a.name).localeCompare(String(b.name)));
    }

    return {
        STAT, RATING, SLOTS, GEM_FITS, WCL_CLASS_IDS, TALENT_HIT_ALLOWANCE, DEFAULT_THRESHOLDS, VERDICT_ORDER,
        indexDb, summarizeGear, derivedStats,
        normalizeWclSpec, roleOf, detectSpec, hitAllowanceRating, parseThresholds, evaluate, sortRows,
    };
}));
