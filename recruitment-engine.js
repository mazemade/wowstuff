(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.RecruitmentEngine = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (AssignmentsEngine) {
    'use strict';

    // This is deliberately a small editorial model. It ranks invitations; it does not attempt
    // to predict parses, gear, execution, or a mathematically optimal raid composition.
    const SOURCE_GUIDE = { label: 'Icy Veins: TBC raid composition guide', url: 'https://www.icy-veins.com/tbc-classic/raid-composition-guide' };
    const SOURCES = {
        illidan: { label: 'Warcraft Tavern: Illidan Stormrage guide', url: 'https://www.warcrafttavern.com/tbc/guides/illidan-stormrage/' },
        council: { label: 'Warcraft Tavern: Illidari Council guide', url: 'https://www.warcrafttavern.com/tbc/guides/illidari-council/' },
        leotheras: { label: 'Icy Veins: Leotheras the Blind guide', url: 'https://www.icy-veins.com/tbc-classic/leotheras-the-blind-guide-strategy-abilities-loot' },
        kael: { label: 'Icy Veins: Kaelthas Sunstrider guide', url: 'https://www.icy-veins.com/tbc-classic/kael-thas-sunstrider-guide-strategy-abilities-loot' },
        archimonde: { label: 'Icy Veins: Archimonde guide', url: 'https://www.icy-veins.com/tbc-classic/archimonde-guide-strategy-abilities-loot' },
        protPaladin: { label: 'Icy Veins: Protection Paladin guide', url: 'https://www.icy-veins.com/tbc-classic/protection-paladin-tank-pve-guide' },
        gruul: { label: 'Wowhead: High King Maulgar strategy', url: 'https://www.wowhead.com/tbc/guide/high-king-maulgar-gruuls-lair-strategy-burning-crusade-classic' },
    };
    const PROFILES = [
        { id: 'general', name: 'General 25-player', size: 25, tanks: 3, healers: 6, notes: ['Composition advice assumes comparable gear, skill, and standard raid talents.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE] },
        { id: 'bt', name: 'Black Temple', size: 25, tanks: 3, healers: 6, notes: ['Prepare a mage tank for Council and a warlock tank for Illidan’s demon phase. Confirm specialist gear and builds; these jobs are separate from the three normal tanks.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE, SOURCES.council, SOURCES.illidan] },
        { id: 'hyjal', name: 'Mount Hyjal', size: 25, tanks: 3, healers: 6, notes: ['A Protection paladin helps with wave control; decurse is needed for Archimonde’s Grip of the Legion.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE, SOURCES.archimonde, SOURCES.protPaladin] },
        { id: 'ssc', name: 'Serpentshrine Cavern', size: 25, tanks: 3, healers: 6, notes: ['Prepare a warlock for Leotheras demon tanking, including the appropriate resistance gear and assignment.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE, SOURCES.leotheras] },
        { id: 'tk', name: 'Tempest Keep', size: 25, tanks: 3, healers: 6, notes: ['A warlock prepares the Capernian tank assignment.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE, SOURCES.kael] },
        { id: 'gruul', name: "Gruul's Lair", size: 25, tanks: 2, healers: 5, notes: ['Prepare a mage for Krosh Spellsteal tanking and a warlock for Olm demon control.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE, SOURCES.gruul] },
        { id: 'mag', name: 'Magtheridon', size: 25, tanks: 3, healers: 6, notes: ['The number of Channeler tanks is strategy-dependent; adjust the target for your plan.', 'Bloodlust is raid-wide; extra shamans need party-totem or healing value.'], sources: [SOURCE_GUIDE] },
    ];

    const VALID_CLASSES = ['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID'];
    const CANDIDATES = [
        ['WARRIOR', 'Protection', 'tank'], ['PALADIN', 'Protection', 'tank'], ['DRUID', 'Guardian', 'tank'],
        ['PALADIN', 'Holy', 'healer'], ['PRIEST', 'Discipline', 'healer'], ['PRIEST', 'Holy', 'healer'], ['SHAMAN', 'Restoration', 'healer'], ['DRUID', 'Restoration', 'healer'],
        ['WARRIOR', 'Arms', 'dps'], ['WARRIOR', 'Fury', 'dps'], ['PALADIN', 'Retribution', 'dps'],
        ['HUNTER', 'Beast Mastery', 'dps'], ['HUNTER', 'Marksmanship', 'dps'], ['HUNTER', 'Survival', 'dps'],
        ['ROGUE', 'Assassination', 'dps'], ['ROGUE', 'Combat', 'dps'], ['ROGUE', 'Subtlety', 'dps'],
        ['SHAMAN', 'Enhancement', 'dps'], ['SHAMAN', 'Elemental', 'dps'], ['MAGE', 'Arcane', 'dps'], ['MAGE', 'Fire', 'dps'], ['MAGE', 'Frost', 'dps'],
        ['WARLOCK', 'Affliction', 'dps'], ['WARLOCK', 'Demonology', 'dps'], ['WARLOCK', 'Destruction', 'dps'],
        ['DRUID', 'Balance', 'dps'], ['DRUID', 'Feral', 'dps'], ['PRIEST', 'Shadow', 'dps'],
    ].map(function (x) { return { class: x[0], spec: x[1], role: x[2] }; }).filter(function (c) {
        return !AssignmentsEngine || !AssignmentsEngine.SELECTABLE_SPECS || (AssignmentsEngine.SELECTABLE_SPECS[c.class] || []).indexOf(c.spec) !== -1;
    });

    function hasFlag(p, flag) { return Array.isArray(p.flags) && p.flags.indexOf(flag) !== -1; }
    function talentAllows(p, key, fallbackSpec) {
        const rank = AssignmentsEngine && AssignmentsEngine.talentRank ? AssignmentsEngine.talentRank(p, key) : null;
        if (rank !== null && rank !== undefined) return rank > 0;
        return !fallbackSpec || p.spec === fallbackSpec;
    }
    function roleOf(p) {
        if (!p || typeof p !== 'object') return 'unknown';
        const cls = String(p && p.class || '').toUpperCase();
        const spec = p && p.spec;
        const ambiguous = hasFlag(p, 'spec-unknown') || hasFlag(p, 'spec-ambiguous') || !spec;
        // A lead's explicit MT declaration takes priority only for classes that can tank.
        if (p && p.mt && (cls === 'WARRIOR' || cls === 'PALADIN' || cls === 'DRUID')) return 'tank';
        if (ambiguous) return 'unknown';
        if (AssignmentsEngine && AssignmentsEngine.SELECTABLE_SPECS
            && (!(AssignmentsEngine.SELECTABLE_SPECS[cls] || []).includes(spec))) return 'unknown';
        if ((cls === 'WARRIOR' || cls === 'PALADIN') && spec === 'Protection') return 'tank';
        if (cls === 'DRUID' && spec === 'Guardian') return 'tank';
        // Addon Feral cannot tell bear from cat. An unflagged Feral is DPS only if the source
        // positively identifies it as a cat; otherwise retain it as unresolved.
        if (cls === 'DRUID' && spec === 'Feral' && p && p.source === 'addon') return 'unknown';
        if (cls === 'PALADIN' && spec === 'Holy') return 'healer';
        if (cls === 'PRIEST' && (spec === 'Holy' || spec === 'Discipline')) return 'healer';
        if ((cls === 'SHAMAN' || cls === 'DRUID') && spec === 'Restoration') return 'healer';
        return VALID_CLASSES.indexOf(cls) === -1 ? 'unknown' : 'dps';
    }
    function countRoles(roster) {
        const out = { tanks: 0, healers: 0, dps: 0, unknown: 0 };
        roster.forEach(function (p) { const r = roleOf(p); out[r === 'tank' ? 'tanks' : r === 'healer' ? 'healers' : r === 'dps' ? 'dps' : 'unknown']++; });
        return out;
    }
    function int(value, fallback, max) {
        if (value === null || value === undefined || value === '') return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : fallback;
    }
    function normalizeTargets(profile, options) {
        const tanks = int(options && options.tanks, profile.tanks, 25);
        const healerFallback = Math.min(profile.healers, 25 - tanks);
        const healers = int(options && options.healers, healerFallback, 25 - tanks);
        return { tanks: tanks, healers: healers, dps: 25 - tanks - healers };
    }
    function knownSpec(p) {
        return !!p.spec && !hasFlag(p, 'spec-unknown') && !hasFlag(p, 'spec-ambiguous');
    }
    function providers(roster) {
        const hasClass = cls => roster.some(p => p.class === cls);
        const has = (cls, spec) => roster.some(p => p.class === cls && knownSpec(p) && p.spec === spec);
        const talent = (cls, key, spec) => roster.some(p => p.class === cls
            && talentAllows(p, key, knownSpec(p) ? spec : '__unresolved__'));
        return {
            kings: talent('PALADIN', 'kings', undefined),
            malediction: talent('WARLOCK', 'malediction', 'Affliction'),
            impFF: talent('DRUID', 'impFaerieFire', 'Balance'),
            crusader: talent('PALADIN', 'impSealCrusader', 'Retribution'),
            mage: hasClass('MAGE'), warlock: hasClass('WARLOCK'),
            protPal: has('PALADIN', 'Protection'), decurse: hasClass('MAGE') || hasClass('DRUID'),
            arms: has('WARRIOR', 'Arms'), survival: has('HUNTER', 'Survival'), shadow: has('PRIEST', 'Shadow'),
        };
    }
    function encounterNeed(raidId, c, covered) {
        if (raidId === 'bt' && c.class === 'MAGE' && !covered.mage) return 'Prepare the Council mage-tank assignment.';
        if (raidId === 'bt' && c.class === 'WARLOCK' && !covered.warlock) return 'Prepare the Illidan demon warlock-tank assignment.';
        if (raidId === 'ssc' && c.class === 'WARLOCK' && !covered.warlock) return 'Prepare a warlock for Leotheras demon tanking.';
        if (raidId === 'tk' && c.class === 'WARLOCK' && !covered.warlock) return 'Prepare the Capernian warlock-tank assignment.';
        if (raidId === 'gruul' && c.class === 'MAGE' && !covered.mage) return 'Prepare the Krosh mage-tank assignment.';
        if (raidId === 'gruul' && c.class === 'WARLOCK' && !covered.warlock) return 'Prepare demon control for the Olm assignment.';
        if (raidId === 'hyjal' && c.class === 'PALADIN' && c.spec === 'Protection' && !covered.protPal) return 'AoE tanking for the trash waves.';
        if (raidId === 'hyjal' && (c.class === 'MAGE' || c.class === 'DRUID') && !covered.decurse) return 'Decurse coverage for Archimonde.';
        return null;
    }
    // Ordinal weights only: role and encounter coverage dominate, then missing utility.
    // Provider capacity assumes groups can be rearranged; this does not score fixed groups.
    // Exclude the provider's own spec from its beneficiary pool, so four casters + their
    // Elemental shaman do not become five casters needing a second Elemental shaman.
    function supportReasons(c, roster) {
        const covered = providers(roster);
        const count = (cls, spec) => roster.filter(p => p.class === cls && (!spec || knownSpec(p) && p.spec === spec)).length;
        const countHealer = cls => roster.filter(p => p.class === cls && roleOf(p) === 'healer').length;
        const isPhysical = p => roleOf(p) === 'dps' && ['melee', 'ranged'].includes(AssignmentsEngine.bucketOf(p));
        const isCaster = p => roleOf(p) === 'dps' && AssignmentsEngine.bucketOf(p) === 'casters';
        const physical = roster.filter(isPhysical).length;
        const casters = roster.filter(isCaster).length;
        const manaUsers = roster.filter(p => roleOf(p) === 'healer' || isCaster(p)).length;
        const out = [];
        const add = (text, weight) => { if (weight > 0) out.push({ text, weight }); };
        const partyValue = (beneficiaries, providers, perPlayer) => Math.min(4, Math.max(0, beneficiaries - providers * 4)) * perPlayer / (1 + providers * .5);
        const specCount = (cls, spec) => count(cls, spec);
        if (c.class === 'PRIEST' && !count('PRIEST')) add('Fortitude and priest utility for the raid.', 30);
        if (c.class === 'DRUID' && !count('DRUID')) add('Mark of the Wild, Innervate and a combat resurrection.', 28);
        if (c.class === 'MAGE' && !count('MAGE')) add('Arcane Intellect and mage utility.', 15 + Math.min(10, manaUsers));
        if (c.class === 'WARLOCK' && !count('WARLOCK')) add('Curse coverage and Healthstones.', 20 + Math.min(10, casters));
        if (c.class === 'PALADIN' && count('PALADIN') < 3) add('Another simultaneous blessing for the raid.', 30 - count('PALADIN') * 5);
        if (c.class === 'SHAMAN' && !count('SHAMAN')) add('Missing raid-wide Bloodlust / Heroism.', 42);
        if (c.class === 'PALADIN' && !covered.kings) add('Blessing of Kings coverage; confirm the Kings talent.', 24);
        if (c.class === 'WARLOCK' && c.spec === 'Affliction' && !covered.malediction && casters) add('Adds missing Malediction.', 8 + casters * 3);
        if (c.class === 'DRUID' && c.spec === 'Balance') {
            if (!covered.impFF && physical) add('Adds missing Improved Faerie Fire.', 8 + physical * 2);
            add('Adds Moonkin Aura coverage.', partyValue(roster.filter(p => isCaster(p) && !(p.class === 'DRUID' && p.spec === 'Balance')).length, specCount('DRUID', 'Balance'), 6));
        }
        if (c.class === 'WARRIOR' && c.spec === 'Arms' && !covered.arms && physical) add('Adds missing Blood Frenzy.', 8 + physical * 3);
        if (c.class === 'HUNTER' && c.spec === 'Survival' && !covered.survival && physical) add('Adds missing Expose Weakness.', 10 + physical * 3);
        if (c.class === 'PRIEST' && c.spec === 'Shadow') {
            if (!covered.shadow && casters) add('Misery increases spell damage taken by the target.', 8 + casters * 2);
            const consumers = roster.filter(p => (isCaster(p) || roleOf(p) === 'healer') && !(p.class === 'PRIEST' && p.spec === 'Shadow')).length;
            add('Vampiric Touch mana support for a caster or healer party.', partyValue(consumers, specCount('PRIEST', 'Shadow'), 5));
        }
        if (c.class === 'PALADIN' && c.spec === 'Retribution' && !covered.crusader && physical + casters) add('Sanctified Crusader increases raid critical strike chance; confirm raid talents.', 10 + (physical + casters) * 1.5);
        if (c.class === 'DRUID' && (c.spec === 'Guardian' || c.spec === 'Feral')) {
            const consumers = roster.filter(p => isPhysical(p) && !(p.class === 'DRUID' && AssignmentsEngine.isFeralSpec(p.spec))).length;
            add('Adds Leader of the Pack coverage.', partyValue(consumers, specCount('DRUID', 'Guardian') + specCount('DRUID', 'Feral'), 5));
        }
        if (c.class === 'HUNTER' && c.spec === 'Beast Mastery') {
            // Ferocious Inspiration stacks across different hunters. The invite contributes
            // its own party buff; there is no invented Grace of Air cast from a hunter.
            add('Ferocious Inspiration boosts the damage of its party.', 10);
        }
        if (c.class === 'SHAMAN' && c.spec === 'Enhancement') {
            const consumers = roster.filter(p => isPhysical(p) && !(p.class === 'SHAMAN' && p.spec === 'Enhancement'));
            const wfUsers = consumers.filter(p => p.class === 'WARRIOR' || p.class === 'ROGUE' || p.class === 'PALADIN').length;
            add(wfUsers ? 'Windfury, Strength of Earth and Unleashed Rage for physical DPS.'
                : 'Grace of Air, Strength of Earth and Unleashed Rage for hunters or ferals.',
                partyValue(consumers.length, specCount('SHAMAN', 'Enhancement'), 8));
        }
        if (c.class === 'SHAMAN' && c.spec === 'Elemental') {
            const consumers = roster.filter(p => isCaster(p) && !(p.class === 'SHAMAN' && p.spec === 'Elemental')).length;
            add('Totem of Wrath and Wrath of Air for a caster party.', partyValue(consumers, specCount('SHAMAN', 'Elemental'), 8));
        }
        if (c.role === 'tank') {
            if (c.class === 'PALADIN' && !specCount('PALADIN', 'Protection')) add('Adds an AoE tank for packs and adds.', 24);
            if (c.class === 'WARRIOR' && !specCount('WARRIOR', 'Protection')) add('Adds a warrior tank with defensive cooldowns.', 18);
            if (c.class === 'DRUID') add('Flexible bear off-tank; can contribute cat damage when not tanking.', specCount('DRUID', 'Guardian') ? 8 : 20);
        }
        if (c.role === 'healer') {
            const same = countHealer(c.class);
            if (!same) {
                const descriptions = { PALADIN: 'Adds dedicated tank healing.', PRIEST: 'Adds priest healing and dispel coverage.', SHAMAN: 'Adds Chain Heal and Mana Tide.', DRUID: 'Adds rolling HoTs for tank and raid coverage.' };
                add(descriptions[c.class], 28);
            } else if (c.class === 'SHAMAN') add('Chain Heal throughput and another party Mana Tide.', 12 / same);
            if (c.class === 'PRIEST' && c.spec === 'Holy' && !specCount('PRIEST', 'Holy')) add('Circle of Healing for raid damage; confirm the talent build.', 12);
        }
        return out;
    }
    const BASE_VALUE = {
        'WARRIOR:Protection': 14, 'PALADIN:Protection': 14, 'DRUID:Guardian': 14,
        'PALADIN:Holy': 16, 'PRIEST:Holy': 18, 'PRIEST:Discipline': 10, 'SHAMAN:Restoration': 18, 'DRUID:Restoration': 16,
        'HUNTER:Beast Mastery': 30, 'HUNTER:Survival': 18, 'HUNTER:Marksmanship': 16,
        'WARLOCK:Destruction': 32, 'WARLOCK:Affliction': 18, 'WARLOCK:Demonology': 24,
        'MAGE:Arcane': 27, 'MAGE:Fire': 25, 'MAGE:Frost': 15, 'WARRIOR:Fury': 28, 'WARRIOR:Arms': 18,
        'ROGUE:Combat': 24, 'ROGUE:Assassination': 14, 'ROGUE:Subtlety': 12,
        'PALADIN:Retribution': 20, 'DRUID:Feral': 24, 'DRUID:Balance': 18, 'PRIEST:Shadow': 16,
        'SHAMAN:Enhancement': 20, 'SHAMAN:Elemental': 20,
    };
    function candidateScore(c, roster, targets, raidId) {
        const support = supportReasons(c, roster);
        let score = BASE_VALUE[c.class + ':' + c.spec] || 10;
        if (c.role === 'tank' && countRoles(roster).tanks === 0) score += 40;
        const reasons = [];
        if (c.role !== 'dps') reasons.push('Fills a ' + c.role + ' slot.');
        const encounter = encounterNeed(raidId, c, providers(roster));
        if (encounter) { score += 180; reasons.push(encounter); }
        support.forEach(u => { score += u.weight; });
        // Filler preference follows existing support, rather than a class-diversity quota.
        if (c.role === 'dps') {
            const covered = providers(roster);
            if (c.class === 'WARLOCK' && c.spec === 'Destruction' && (covered.shadow || roster.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental'))) score += 12;
            if (c.class === 'HUNTER' && c.spec === 'Beast Mastery' && covered.survival) score += 10;
            if (c.class === 'MAGE' && c.spec === 'Arcane' && covered.shadow) score += 12;
            if (c.class === 'WARRIOR' && c.spec === 'Fury' && roster.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement')) score += 12;
        }
        support.sort((a, b) => b.weight - a.weight);
        reasons.push(...support.slice(0, 3).map(u => u.text));
        if (!support.length && !encounter) reasons.push(c.role === 'dps' ? 'Damage slot suited to the available raid support.' : 'Completes the requested role coverage.');
        return { score, reasons };
    }
    function recommend(roster, options) {
        const input = (Array.isArray(roster) ? roster : []).map(p => {
            if (!p || typeof p !== 'object') return { class: '', spec: null, flags: ['spec-unknown'] };
            const cls = String(p.class || '').toUpperCase();
            const valid = Object.prototype.hasOwnProperty.call(AssignmentsEngine.SELECTABLE_SPECS, cls)
                && AssignmentsEngine.SELECTABLE_SPECS[cls].includes(p.spec);
            return Object.assign({}, p, { class: cls, spec: valid ? p.spec : null });
        });
        options = options || {};
        const profile = PROFILES.find(function (p) { return p.id === options.raidId; }) || PROFILES[0];
        const targets = normalizeTargets(profile, options);
        const current = countRoles(input);
        const openSlots = Math.max(0, 25 - input.length);
        const warnings = [];
        if (input.length > 25) warnings.push('Roster is over the 25-player cap by ' + (input.length - 25) + '.');
        if (current.unknown) warnings.push('Unresolved roster members: ' + input.filter(function (p) { return roleOf(p) === 'unknown'; }).map(function (p) { return p && p.name || 'unnamed'; }).join(', ') + '.');
        input.forEach(function (p) { if (p && p.class === 'DRUID' && p.spec === 'Feral' && p.source === 'addon' && !p.mt) warnings.push((p.name || 'Addon Feral') + ': verify bear or cat before counting this Feral.'); });
        const simulated = input.slice();
        const recommendations = [];
        for (let i = 0; i < openSlots; i++) {
            const roles = countRoles(simulated);
            // A raid cannot spend an invitation on DPS while it still lacks either staffed
            // role. Once both targets are met, tanks/healers stop being filler candidates.
            const allowed = (roles.tanks < targets.tanks || roles.healers < targets.healers)
                ? CANDIDATES.filter(function (c) { return (c.role === 'tank' && roles.tanks < targets.tanks) || (c.role === 'healer' && roles.healers < targets.healers); })
                : CANDIDATES.filter(function (c) { return c.role === 'dps'; });
            const ranked = allowed.map(function (c, index) { const r = candidateScore(c, simulated, targets, profile.id); return { c: c, index: index, score: r.score, reasons: r.reasons }; })
                .sort(function (a, b) { return b.score - a.score || a.index - b.index; });
            const best = ranked[0];
            if (!best) break;
            recommendations.push({ class: best.c.class, spec: best.c.spec, role: best.c.role, reasons: best.reasons.length ? best.reasons : ['adds flexible raid depth'] });
            simulated.push({ class: best.c.class, spec: best.c.spec, source: 'recommendation', flags: [] });
        }
        // Revisit each invitation in the context of the completed plan. This catches
        // overlap that a greedy pass cannot see: for example, a later Retribution invite
        // may supply the third blessing that originally justified a second Holy paladin.
        // Only replace suggested players, preserving each slot's role and all real players.
        // Bounded passes keep interactive updates predictable; this is a local refinement.
        for (let pass = 0; pass < 2; pass++) {
            let changed = false;
            for (let i = 0; i < recommendations.length; i++) {
                const index = input.length + i;
                const context = simulated.filter((p, n) => n !== index);
                let best = recommendations[i];
                let bestScore = candidateScore(best, context, targets, profile.id).score;
                CANDIDATES.filter(c => c.role === best.role).forEach(c => {
                    const score = candidateScore(c, context, targets, profile.id).score;
                    if (score > bestScore) { best = c; bestScore = score; }
                });
                if (best.class !== recommendations[i].class || best.spec !== recommendations[i].spec) {
                    recommendations[i] = { class: best.class, spec: best.spec, role: best.role, reasons: [] };
                    simulated[index] = { class: best.class, spec: best.spec, source: 'recommendation', flags: [] };
                    changed = true;
                }
            }
            if (!changed) break;
        }
        // Explain the final invitations in displayed order, including prior invites only.
        recommendations.forEach((c, i) => {
            c.reasons = candidateScore(c, simulated.slice(0, input.length + i), targets, profile.id).reasons;
        });
        const projected = countRoles(simulated);
        ['tanks', 'healers', 'dps'].forEach(function (key) {
            if (projected[key] < targets[key]) warnings.push((key === 'dps' ? 'DPS' : key.slice(0, -1)) + ' target short by ' + (targets[key] - projected[key]) + ' after open slots are filled.');
            if (projected[key] > targets[key]) warnings.push((key === 'dps' ? 'DPS' : key.slice(0, -1)) + ' target exceeded by ' + (projected[key] - targets[key]) + '.');
        });
        if (!openSlots && (projected.tanks < targets.tanks || projected.healers < targets.healers || projected.dps < targets.dps)) warnings.push('No open slots: adjust targets or roster; recommendations do not propose removals.');
        const specialist = function (cls) { return simulated.some(function (p) { return p && p.class === cls; }); };
        if (profile.id === 'bt' && !specialist('MAGE')) warnings.push('Black Temple readiness: no mage for Council mage-tank preparation.');
        if (profile.id === 'bt' && !specialist('WARLOCK')) warnings.push('Black Temple readiness: no warlock for Illidan demon tank preparation.');
        if (profile.id === 'ssc' && !specialist('WARLOCK')) warnings.push('SSC readiness: no warlock for Leotheras.');
        if (profile.id === 'tk' && !specialist('WARLOCK')) warnings.push('Tempest Keep readiness: no warlock for Capernian tank preparation.');
        if (profile.id === 'gruul' && !specialist('MAGE')) warnings.push("Gruul's Lair readiness: no mage for Krosh.");
        if (profile.id === 'gruul' && !specialist('WARLOCK')) warnings.push("Gruul's Lair readiness: no warlock for Olm.");
        if (profile.id === 'hyjal' && !specialist('MAGE') && !specialist('DRUID')) warnings.push('Hyjal readiness: no decurse class for Archimonde.');
        return { profile: profile, targets: targets, current: current, projected: projected, openSlots: openSlots, recommendations: recommendations, warnings: warnings, notes: profile.notes.slice() };
    }
    return { PROFILES: PROFILES, recommend: recommend, roleOf: roleOf, normalizeTargets: normalizeTargets };
}));
