(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.AssignmentsEngine = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SPEC_TREES = {
        WARRIOR: ['Arms', 'Fury', 'Protection'],
        PALADIN: ['Holy', 'Protection', 'Retribution'],
        HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
        ROGUE: ['Assassination', 'Combat', 'Subtlety'],
        PRIEST: ['Discipline', 'Holy', 'Shadow'],
        SHAMAN: ['Elemental', 'Enhancement', 'Restoration'],
        MAGE: ['Arcane', 'Fire', 'Frost'],
        WARLOCK: ['Affliction', 'Demonology', 'Destruction'],
        DRUID: ['Balance', 'Feral', 'Restoration'],
    };

    // SPEC_TREES is positional — inferSpec indexes it by talent tab, so it must stay three
    // entries per class. Guardian is a role a human declares, not something talent totals can
    // reveal (bear and cat are the same tree), so it lives here instead.
    const SELECTABLE_SPECS = Object.keys(SPEC_TREES).reduce((acc, cls) => {
        acc[cls] = SPEC_TREES[cls].slice();
        return acc;
    }, {});
    SELECTABLE_SPECS.DRUID = ['Balance', 'Feral', 'Guardian', 'Restoration'];

    // A bear casts Faerie Fire, Demoralizing Roar and carries Leader of the Pack exactly like
    // a cat. Guardian differs only in which group it belongs to.
    function isFeralSpec(spec) { return spec === 'Feral' || spec === 'Guardian'; }

    // The talents the catalog reasons about, under the same keys RaidSpecScan exports. The
    // addon resolved these by name at scan time, so there are no coordinates here to drift.
    // `maxRank` is the guard for the one thing that CAN drift: these keys and the addon's
    // TRACKED_TALENTS are maintained on opposite sides of the wire.
    const TALENTS = {
        impExposeArmor:  { class: 'ROGUE',   maxRank: 2, name: 'Improved Expose Armor' },
        hemorrhage:      { class: 'ROGUE',   maxRank: 1, name: 'Hemorrhage' },
        impThunderClap:  { class: 'WARRIOR', maxRank: 3, name: 'Improved Thunder Clap' },
        impDemoShout:    { class: 'WARRIOR', maxRank: 5, name: 'Improved Demoralizing Shout' },
        impSealCrusader: { class: 'PALADIN', maxRank: 3, name: 'Improved Seal of the Crusader' },
        kings:           { class: 'PALADIN', maxRank: 1, name: 'Blessing of Kings' },
        impMight:        { class: 'PALADIN', maxRank: 5, name: 'Improved Blessing of Might' },
        impWisdom:       { class: 'PALADIN', maxRank: 2, name: 'Improved Blessing of Wisdom' },
        malediction:     { class: 'WARLOCK', maxRank: 3, name: 'Malediction' },
        impFaerieFire:   { class: 'DRUID',   maxRank: 3, name: 'Improved Faerie Fire' },
        feralAggression: { class: 'DRUID',   maxRank: 5, name: 'Feral Aggression' },
        insectSwarm:     { class: 'DRUID',   maxRank: 1, name: 'Insect Swarm' },
        impScorch:       { class: 'MAGE',    maxRank: 3, name: 'Improved Scorch' },
        wintersChill:    { class: 'MAGE',    maxRank: 5, name: "Winter's Chill" },
        impHuntersMark:  { class: 'HUNTER',  maxRank: 5, name: "Improved Hunter's Mark" },
    };

    // null means "we do not know" — a Raid-Helper signup, a manually added player, or a talent
    // the addon could not find. That must never be confused with "we know they lack it", which
    // is rank 0.
    function talentRank(player, key) {
        const def = TALENTS[key];
        if (!def || def.class !== player.class || !player.talents) return null;
        const rank = player.talents[key];
        if (typeof rank !== 'number' || isNaN(rank)) return null;
        if (rank > def.maxRank) return null;
        return rank;
    }

    // The gate for talents that ARE the spell (Winter's Chill, Hemorrhage, ...): a known
    // rank decides outright — a positive rank can cast regardless of what the tree totals
    // implied, rank 0 cannot cast at all. Only when the scan told us nothing does the old
    // spec proxy get a vote. This is the degrade-to-today rule as one function.
    function gateAllows(p, talentKey, fallbackSpec) {
        const rank = talentRank(p, talentKey);
        if (rank !== null) return rank > 0;
        return !fallbackSpec || p.spec === fallbackSpec;
    }

    // A key mismatch between the addon and this table is systemic — it hits every player of
    // that class at once — so surface it rather than letting the whole class read as unknown.
    function talentDrift(roster) {
        const out = [];
        roster.forEach(p => {
            if (!p.talents) return;
            Object.keys(p.talents).forEach(key => {
                const def = TALENTS[key];
                if (def && def.class === p.class && p.talents[key] > def.maxRank) {
                    out.push({ name: p.name, key: key });
                }
            });
        });
        return out;
    }

    const CLASS_COLORS = {
        WARRIOR: '#C69B6D', PALADIN: '#F48CBA', HUNTER: '#AAD372',
        ROGUE: '#FFF468', PRIEST: '#FFFFFF', SHAMAN: '#0070DD',
        MAGE: '#3FC7EB', WARLOCK: '#8788EE', DRUID: '#FF7C0A',
    };

    // Discord lines have no tooltip, and WARRIOR/WARLOCK both truncate to "WAR" — which of the
    // two is getting Might is exactly what the raid lead needs to read at a glance. These are
    // the short forms raiders actually say out loud.
    const CLASS_ABBREV = {
        WARRIOR: 'WAR', PALADIN: 'PAL', HUNTER: 'HUNT', ROGUE: 'ROG', PRIEST: 'PRI',
        SHAMAN: 'SHAM', MAGE: 'MAGE', WARLOCK: 'LOCK', DRUID: 'DRU',
    };

    // points: [tree1, tree2, tree3] spent talent points.
    // Ambiguous when no tree reaches 31 (no defining talent) or the top two tie.
    function inferSpec(cls, points) {
        const trees = SPEC_TREES[cls];
        if (!trees) return { spec: null, ambiguous: true };
        const total = points[0] + points[1] + points[2];
        if (!total) return { spec: null, ambiguous: true };
        let max = 0;
        for (let i = 1; i < 3; i++) if (points[i] > points[max]) max = i;
        const sorted = points.slice().sort((a, b) => b - a);
        const ambiguous = points[max] < 31 || sorted[0] === sorted[1];
        return { spec: trees[max], ambiguous };
    }

    function parseAddonExport(text) {
        const players = [];
        const errors = [];
        const seen = new Set();
        const tokens = (text || '').trim().split(/[\n;]+/).map(t => t.trim()).filter(Boolean);
        tokens.forEach(tok => {
            if (/^RSS\d+$/i.test(tok)) return; // format header
            // RSS1, RSS2 and RSS3 all parse positionally:
            //   name:CLASS:points[:subgroup[:race[:talents]]]
            // Every field after points may be empty and is independent, so a missing subgroup
            // no longer takes the race and talents with it the way RSS2's nesting did. Names
            // cannot contain ':' in WoW, and no other field uses it, so the split is
            // unambiguous.
            const f = tok.split(':');
            if (f.length < 3 || f.length > 6) { errors.push('Unrecognized line: ' + tok); return; }
            const name = f[0];
            const cls = (f[1] || '').toUpperCase();
            const points = f[2];
            const rawGroup = f[3] === undefined ? '' : f[3];
            const rawRace = f[4] === undefined ? '' : f[4];
            const rawTalents = f[5] === undefined ? '' : f[5];

            if (!name) { errors.push('Unrecognized line: ' + tok); return; }
            if (!/^[A-Za-z]+$/.test(f[1] || '')) { errors.push('Unrecognized line: ' + tok); return; }
            if (!SPEC_TREES[cls]) { errors.push('Unknown class in: ' + tok); return; }
            if (!/^(\d+\/\d+\/\d+|\?)$/.test(points)) { errors.push('Unrecognized line: ' + tok); return; }
            if (seen.has(name)) { errors.push('Duplicate name: ' + name); return; }

            let group = null;
            if (rawGroup !== '') {
                if (!/^\d+$/.test(rawGroup)) { errors.push('Unrecognized line: ' + tok); return; }
                group = Number(rawGroup);
                if (group < 1 || group > 8) { errors.push('Subgroup out of range in: ' + tok); return; }
            }
            if (rawRace !== '' && !/^[A-Za-z]+$/.test(rawRace)) { errors.push('Unrecognized line: ' + tok); return; }
            const race = rawRace === '' ? null : rawRace;

            // null means the scan told us nothing. An explicit "key=0" means the scan told us
            // they have not taken it — a different, useful fact.
            let talents = null;
            if (rawTalents !== '') {
                if (!/^\w+=\d+(,\w+=\d+)*$/.test(rawTalents)) { errors.push('Unrecognized line: ' + tok); return; }
                talents = {};
                rawTalents.split(',').forEach(pair => {
                    const kv = pair.split('=');
                    talents[kv[0]] = Number(kv[1]);
                });
            }

            const flags = [];
            let spec = null;
            if (points === '?') {
                flags.push('spec-unknown');
            } else {
                const r = inferSpec(cls, points.split('/').map(Number));
                spec = r.spec;
                if (!spec) flags.push('spec-unknown');
                else if (r.ambiguous) flags.push('spec-ambiguous');
            }
            seen.add(name);
            players.push({ name, class: cls, spec, flags, source: 'addon', group, race, talents });
        });
        return { players, errors };
    }

    const RH_STATUS_CLASSES = ['Bench', 'Late', 'Tentative', 'Absence'];
    const RH_CLASS_NAMES = {
        Warrior: 'WARRIOR', Paladin: 'PALADIN', Hunter: 'HUNTER', Rogue: 'ROGUE',
        Priest: 'PRIEST', Shaman: 'SHAMAN', Mage: 'MAGE', Warlock: 'WARLOCK', Druid: 'DRUID',
    };
    const RH_SPEC_ALIASES = { Beastmastery: 'Beast Mastery' };

    // The Tank sign-up emote reports class "Tank", not the real class. Raid-Helper's spec
    // names disambiguate: a digit suffix separates classes sharing a spec name (Protection =
    // warrior, Protection1 = paladin — same convention as Restoration/Restoration1 for
    // druid/shaman), and Guardian is the druid tank. TBC has exactly these three tank
    // classes, so this map is total. Keys are lowercased raw specs BEFORE digit stripping.
    const RH_TANK_SPECS = {
        protection: { class: 'WARRIOR', spec: 'Protection' },
        protection1: { class: 'PALADIN', spec: 'Protection' },
        guardian: { class: 'DRUID', spec: 'Guardian' },
    };

    // Raid-Helper's endpoints disagree on how they case these names and fields,
    // so match on lowercase throughout and take the first field name that's present.
    function lowerKeyed(obj) {
        const out = {};
        Object.keys(obj).forEach(k => { out[k.toLowerCase()] = obj[k]; });
        return out;
    }
    const RH_STATUS_CLASSES_LC = RH_STATUS_CLASSES.map(s => s.toLowerCase());
    const RH_CLASS_NAMES_LC = lowerKeyed(RH_CLASS_NAMES);
    const RH_SPEC_ALIASES_LC = lowerKeyed(RH_SPEC_ALIASES);

    function rhPick(su, names) {
        for (let i = 0; i < names.length; i++) {
            const v = su[names[i]];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    function parseRaidHelper(eventJson) {
        const players = [];
        const excluded = [];
        const errors = [];
        const signUps = (eventJson && (eventJson.signUps || eventJson.signups)) || [];
        if (!Array.isArray(signUps) || !signUps.length) {
            errors.push('No signups found in event');
            return { players, excluded, errors, title: (eventJson && eventJson.title) || '' };
        }
        signUps.forEach(su => {
            const rawClass = String(rhPick(su, ['className', 'class']) || '');
            if (RH_STATUS_CLASSES_LC.includes(rawClass.toLowerCase())) { excluded.push({ name: su.name, reason: rawClass }); return; }
            if (su.status && su.status !== 'primary') { excluded.push({ name: su.name, reason: su.status }); return; }
            const rawSpec = String(rhPick(su, ['specName', 'spec']) || '');
            let cls, spec;
            if (rawClass.toLowerCase() === 'tank') {
                const t = RH_TANK_SPECS[rawSpec.toLowerCase()];
                if (!t) { errors.push('Unknown tank spec "' + rawSpec + '" for ' + su.name); return; }
                cls = t.class;
                spec = t.spec;
            } else {
                cls = RH_CLASS_NAMES_LC[rawClass.toLowerCase()];
                if (!cls) { errors.push('Unknown class "' + rawClass + '" for ' + su.name); return; }
                spec = rawSpec.replace(/\d+$/, '');
                spec = RH_SPEC_ALIASES_LC[spec.toLowerCase()] || spec;
            }
            const flags = [];
            const canonical = SELECTABLE_SPECS[cls].find(s => s.toLowerCase() === spec.toLowerCase());
            if (canonical) { spec = canonical; } else { spec = null; flags.push('spec-unknown'); }
            const userId = rhPick(su, ['userId', 'userid']);
            players.push({
                name: su.name, class: cls, spec,
                discordId: userId !== undefined ? String(userId) : null,
                flags, source: 'raidhelper', group: null, race: null,
            });
        });
        return { players, excluded, errors, title: (eventJson && eventJson.title) || '' };
    }

    function normName(s) { return (s || '').toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, ''); }

    function mergeRosters(addonPlayers, rhPlayers, linkMap) {
        linkMap = linkMap || {};
        const unmatched = { addon: [], raidhelper: [] };
        const mismatches = [];
        if (!addonPlayers || !addonPlayers.length) {
            return { roster: (rhPlayers || []).map(p => Object.assign({}, p, { flags: (p.flags || []).slice() })), unmatched, mismatches };
        }
        const roster = addonPlayers.map(p => Object.assign({}, p, { flags: (p.flags || []).slice() }));
        (rhPlayers || []).forEach(rh => {
            let m = null;
            if (rh.discordId && linkMap[rh.discordId]) {
                m = roster.find(p => p.name === linkMap[rh.discordId]) || null;
            }
            if (!m) m = roster.find(p => normName(p.name) === normName(rh.name)) || null;
            if (!m) {
                const a = normName(rh.name);
                const cands = roster.filter(p => {
                    const b = normName(p.name);
                    return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
                });
                if (cands.length === 1) m = cands[0];
            }
            if (m) {
                m.discordId = rh.discordId;
                if (rh.spec && m.spec && rh.spec !== m.spec) {
                    // Talent totals cannot tell a bear from a cat, so an addon scan always
                    // says Feral. A Guardian signup is strictly more information, not a
                    // contradiction — take it rather than flagging a mismatch that is really
                    // just the addon's blind spot.
                    if (isFeralSpec(rh.spec) && isFeralSpec(m.spec)) {
                        m.spec = rh.spec;
                    } else {
                        m.flags.push('signed-as:' + rh.spec);
                        mismatches.push({ name: m.name, signed: rh.spec, actual: m.spec });
                    }
                }
            } else {
                unmatched.raidhelper.push(Object.assign({}, rh, { flags: (rh.flags || []).slice() }));
            }
        });
        roster.forEach(p => { if (!p.discordId) unmatched.addon.push(p); });
        return { roster, unmatched, mismatches };
    }

    const DEBUFF_CATALOG = [
        // Expose blocks Sunder outright ("A more powerful spell is already active"), so this
        // is one row with two providers, not two rows that cancel. Improved Expose Armor is
        // 3075 armor against a maxed Sunder stack's 2600 — worth roughly 3.5% raid physical.
        { id: 'armor', name: 'Major armor reduction', category: 'debuffs', providers: [
            { name: 'Improved Expose Armor', class: 'ROGUE', preferSpecs: ['Subtlety', 'Combat'], improvedBy: 'impExposeArmor' },
            { name: 'Sunder Armor', class: 'WARRIOR', preferSpecs: ['Protection'] },
        ] },
        { id: 'coe', name: 'Curse of Elements', category: 'debuffs', class: 'WARLOCK', preferSpecs: ['Affliction'], group: 'curse', improvedBy: 'malediction' },
        { id: 'cor', name: 'Curse of Recklessness', category: 'debuffs', class: 'WARLOCK', preferSpecs: [], group: 'curse',
          caution: '−800 armor but +136 melee AP on the boss. Clear this row on enrage or AP-scaling fights.' },
        // The value here is Improved Seal of the Crusader (Ret tier 2): +3% crit to all
        // attacks on the target. Untalented it is worth nothing, so one Ret beats three bodies.
        // Ordered before jow: judgements are one-per-paladin, so the Ret must be claimed
        // for JoC before the generic judgements can swallow them.
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', requireSpec: 'Retribution', group: 'judgement', improvedBy: 'impSealCrusader',
          applicableWhen: roster => roster.some(p => p.class === 'PALADIN' && p.spec === 'Retribution') },
        // Ret keeps Seal of Blood/Command for its own damage; the support paladins judge at
        // pull, and any Ret's Crusader Strike then refreshes every paladin's judgement.
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        // Improved Faerie Fire (+3% melee/ranged hit) is Balance-only, but the 610 armor
        // applies regardless — so keep the duty and rank Feral above Resto, who would
        // otherwise spend a GCD and mana they would rather heal with.
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Guardian', 'Feral'], improvedBy: 'impFaerieFire' },
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'], improvedBy: 'impHuntersMark' },
        // Fire Vulnerability is +3% fire damage taken per stack, not spell crit (that is
        // WotLK), and the fire mage maintains it through their own rotation. Low priority.
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire', requireTalent: 'impScorch' },
        // A maintained 5-stack debuff, not passive coverage. +2% frost crit per stack.
        // Does not conflict with Improved Scorch — different schools entirely.
        { id: 'wc', name: "Winter's Chill", category: 'debuffs', class: 'MAGE', requireSpec: 'Frost', requireTalent: 'wintersChill' },
        // Strongest applies, they do not stack. Talented, Demo Shout and CoW tie at -420;
        // untalented, CoW (-350) actually beats Demo Shout (-300). improvedBy now makes the
        // ordering among warriors talent-aware, but the choice between providers — Demo
        // Shout vs Curse of Weakness vs Demo Roar vs Screech — is still a spec-level guess
        // the override exists to correct.
        { id: 'ap', name: 'Attack power reduction', category: 'debuffs', providers: [
            { name: 'Demoralizing Shout', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'], improvedBy: 'impDemoShout' },
            { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
            { name: 'Demoralizing Roar', class: 'DRUID', preferSpecs: ['Guardian', 'Feral'], improvedBy: 'feralAggression' },
            { name: 'Screech (pet)', class: 'HUNTER', preferSpecs: ['Beast Mastery'] },
        ] },
        // Improved Thunder Clap is −20% attack speed at 3/3 (base 10% plus 10%), and it is an
        // Arms talent — a protection warrior may well have skipped it, so the Arms warrior is
        // the safer bet even though the tank is on the boss permanently. Its own effect group
        // with Chilled and Thunderfury — strongest applies, they do not stack.
        { id: 'tclap', name: 'Thunder Clap', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Protection'], improvedBy: 'impThunderClap' },
        { id: 'swarm', name: 'Insect Swarm', category: 'debuffs', class: 'DRUID', requireSpec: 'Balance', requireTalent: 'insectSwarm' },
        // Hemorrhage needs a Subtlety rogue, and essentially no TBC raid brings one. Warning
        // about it every night would be permanent unfixable noise, so it stays quiet unless
        // someone who can actually cast it is present.
        { id: 'hemo', name: 'Hemorrhage', category: 'debuffs', class: 'ROGUE', requireSpec: 'Subtlety', requireTalent: 'hemorrhage',
          applicableWhen: roster => roster.some(p => p.class === 'ROGUE' && gateAllows(p, 'hemorrhage', 'Subtlety')) },
    ];

    // Duties that need an ordered list rather than one player. Fear Ward is TBC-only and
    // mandatory on Magtheridon, Gurtogg Bloodboil and Azgalor; Tranq Shot on Gruul and Mag.
    const ROTATIONS = [
        { id: 'fearward', name: 'Fear Ward', class: 'PRIEST', preferSpecs: ['Discipline', 'Holy'],
          note: '30s cooldown, 3min duration — rotate so one is always banked.' },
        { id: 'tranq', name: 'Tranquilizing Shot', class: 'HUNTER', preferSpecs: ['Beast Mastery', 'Marksmanship'],
          note: '20s cooldown — call the order, do not let two fire at once.' },
    ];

    // One effect can have several possible providers, best first. Entries that name a single
    // class are just a one-element list, so the assignment loop has one code path rather
    // than a special case for fallbacks. `caution` must ride along here: the assignment loop
    // only ever hands provider-derived objects to record(), so any entry-level field a duty
    // needs to carry has to survive this normalization.
    function providersOf(entry) {
        if (entry.providers) {
            if (!entry.caution) return entry.providers;
            // An entry-level caution applies however the row ends up covered, so it has to
            // reach every provider — record() only ever sees provider-derived objects. A
            // provider that states its own caution keeps it.
            return entry.providers.map(pr =>
                pr.caution ? pr : Object.assign({}, pr, { caution: entry.caution }));
        }
        return [{ name: entry.name, class: entry.class, preferSpecs: entry.preferSpecs,
                  requireSpec: entry.requireSpec, requireTalent: entry.requireTalent,
                  group: entry.group, caution: entry.caution,
                  improvedBy: entry.improvedBy }];
    }

    const CC_ABILITIES = [
        { id: 'polymorph', name: 'Polymorph', class: 'MAGE' },
        { id: 'trap', name: 'Freezing Trap', class: 'HUNTER' },
        { id: 'banish', name: 'Banish', class: 'WARLOCK' },
        { id: 'shackle', name: 'Shackle Undead', class: 'PRIEST' },
        { id: 'hibernate', name: 'Hibernate', class: 'DRUID' },
    ];
    const MARKS = ['skull', 'cross', 'square', 'moon', 'triangle', 'diamond', 'circle', 'star'];
    const MARK_EMOJI = { skull: '💀', cross: '❌', square: '🟦', moon: '🌙', triangle: '🔺', diamond: '💎', circle: '🟠', star: '⭐' };

    function defaultCC(roster) {
        const mages = roster.filter(p => p.class === 'MAGE');
        const cc = [];
        if (mages[0]) cc.push({ mark: 'moon', ability: 'polymorph', player: mages[0].name });
        if (mages[1]) cc.push({ mark: 'triangle', ability: 'polymorph', player: mages[1].name });
        return cc;
    }

    const PASSIVES = [
        { name: 'Misery', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Shadow Weaving', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Improved Shadow Bolt', class: 'WARLOCK', spec: 'Destruction' },
        { name: 'Blood Frenzy', class: 'WARRIOR', spec: 'Arms' },
        { name: 'Mangle', class: 'DRUID', specs: ['Feral', 'Guardian'] },
        { name: 'Expose Weakness', class: 'HUNTER', spec: 'Survival' },
    ];

    function specRank(p, entry) {
        const i = (entry.preferSpecs || []).indexOf(p.spec);
        return i === -1 ? 99 : i;
    }

    // Talent beats spec: preferSpecs was only ever a proxy for "did they take the talent", so
    // once the real value is known the proxy defers to it. Unknown sits between — "we do not
    // know" must not lose to "we know they cannot".
    function talentTier(p, entry) {
        if (!entry.improvedBy) return 0;
        const rank = talentRank(p, entry.improvedBy);
        if (rank === null) return 1;
        return rank > 0 ? 0 : 2;
    }

    function rankPool(pool, entry, dutyCount) {
        return pool.slice().sort((a, b) => {
            const ta = talentTier(a, entry), tb = talentTier(b, entry);
            if (ta !== tb) return ta - tb;
            if (ta === 0 && entry.improvedBy) {
                // Both candidates are tier 0 here, which per talentTier only happens when
                // talentRank returned a positive number for each — so ra and rb are already
                // guaranteed non-null and > 0. The `|| 0` fallbacks below are defensive only,
                // not load-bearing; they never actually trigger on this path.
                const ra = talentRank(a, entry.improvedBy) || 0, rb = talentRank(b, entry.improvedBy) || 0;
                if (ra !== rb) return rb - ra; // higher rank first
            }
            const sa = specRank(a, entry), sb = specRank(b, entry);
            if (sa !== sb) return sa - sb;
            const ca = dutyCount[a.name] || 0, cb = dutyCount[b.name] || 0;
            if (ca !== cb) return ca - cb;
            return a.name.localeCompare(b.name);
        });
    }

    function autoAssign(roster, overrides) {
        overrides = overrides || {};
        const duties = [];
        // missing = the raid wants this and nobody can provide it. notApplicable = this
        // comp cannot have it at all, so warning about it would be noise.
        const uncovered = { missing: [], notApplicable: [] };
        const dutyCount = {};
        const groupUsed = {}; // '<group>:<player>' -> true
        const byName = {};
        roster.forEach(p => { byName[p.name] = p; });

        function eligible(p, entry) {
            if (p.class !== entry.class) return false;
            if ((p.flags || []).includes('spec-unknown')) return false;
            if (entry.requireTalent) {
                if (!gateAllows(p, entry.requireTalent, entry.requireSpec)) return false;
            } else if (entry.requireSpec && p.spec !== entry.requireSpec) return false;
            if (entry.group && groupUsed[entry.group + ':' + p.name]) return false;
            return true;
        }

        // An override with an explicit falsy `player` (e.g. { player: null }) means the user
        // deliberately cleared the row, as opposed to no override being present at all.
        function isExplicitlyUnassigned(o) {
            return Object.prototype.hasOwnProperty.call(o, 'player') && !o.player;
        }

        function record(entry, displayName, player, target) {
            const d = { id: entry.id, name: displayName, category: entry.category, player: player ? player.name : null };
            if (target) d.target = target;
            if (entry.caution) d.caution = entry.caution;
            // An improvedBy or requireTalent row can pick an off-spec player because they hold
            // the talent, which reads as a bug unless the row says why. ASCII only — this
            // object feeds the addon whisper path, whose length budget assumes it.
            //
            // Only speak up here if the player was scanned at all (player.talents is set).
            // A Raid-Helper signup, a manually added player, or a player the addon never
            // inspected has no talents object, and "talent unknown" about them would only
            // restate that the roster has no scan data for anyone like them — noise, not a
            // finding, and the common case on most rosters. A player who WAS scanned but whose
            // talents object lacks this specific key is a different animal: the addon resolves
            // talent names by string and silently drops any name it cannot find, so a missing
            // key there means a real talent-name drift between the addon and TALENTS above, or
            // a known scan-bounds bug in the addon. That is worth saying "talent unknown" about,
            // so it must not be folded into the same silence as the wholly-unscanned case.
            const explainKey = entry.improvedBy || entry.requireTalent;
            if (explainKey && player && player.talents) {
                const def = TALENTS[explainKey];
                const rank = talentRank(player, explainKey);
                if (def) {
                    if (rank === null) d.qualifier = 'talent unknown';
                    else if (rank === 0) d.qualifier = 'no ' + def.name;
                    else d.qualifier = def.name + ' ' + rank + '/' + def.maxRank;
                }
            }
            duties.push(d);
            if (player) {
                dutyCount[player.name] = (dutyCount[player.name] || 0) + 1;
                if (entry.group) groupUsed[entry.group + ':' + player.name] = true;
            }
        }

        DEBUFF_CATALOG.forEach(entry => {
            const o = overrides[entry.id] || {};
            const provs = providersOf(entry);

            if (o.player && byName[o.player]) {
                const chosen = byName[o.player];
                // Honour the override even for an off-list class: fall back to the first
                // provider's label rather than dropping the assignment on the floor.
                const prov = provs.find(pr => pr.class === chosen.class) || provs[0];
                // Exclusivity groups encode a hard game rule (one curse per warlock), not a
                // guess the raid lead might know better than — unlike the applicability gates
                // below, an override cannot buy its way past this one. If the group slot is
                // already taken, leave the row alone and fall through to the normal provider
                // loop, so it still lands on another eligible player instead of going blank.
                const groupConflict = prov.group && groupUsed[prov.group + ':' + chosen.name];
                if (!groupConflict) {
                    record(Object.assign({}, prov, { id: entry.id, category: entry.category }), prov.name, chosen);
                    return;
                }
            }
            // An explicit override is the raid lead telling the tool it is wrong about
            // applicability, so it must win over these gates; everything downstream of
            // this point still respects them.
            if (entry.minClassCount && roster.filter(p => p.class === entry.class).length < entry.minClassCount) {
                uncovered.notApplicable.push({ id: entry.id, name: entry.name });
                return;
            }
            if (entry.applicableWhen && !entry.applicableWhen(roster)) {
                uncovered.notApplicable.push({ id: entry.id, name: entry.name });
                return;
            }
            if (isExplicitlyUnassigned(o)) {
                record(entry, entry.name, null);
                uncovered.missing.push({ id: entry.id, name: entry.name });
                return;
            }
            // A provider whose best candidate is KNOWN to lack the improving talent loses its
            // place in line: pass 1 takes the first provider in catalog order whose best
            // candidate is not tier 2, pass 2 accepts anyone. Unknown data (tier 1) never
            // demotes — a Raid-Helper roster keeps today's order — and a known-untalented
            // candidate still beats an empty row.
            const ranked = [];
            for (let i = 0; i < provs.length; i++) {
                const prov = Object.assign({}, provs[i], { id: entry.id, category: entry.category });
                const pool = rankPool(roster.filter(p => eligible(p, prov)), prov, dutyCount);
                if (pool.length) ranked.push({ prov: prov, pool: pool });
            }
            let pick = null;
            for (let i = 0; i < ranked.length && !pick; i++) {
                if (talentTier(ranked[i].pool[0], ranked[i].prov) !== 2) pick = ranked[i];
            }
            if (!pick && ranked.length) pick = ranked[0];
            if (pick) { record(pick.prov, pick.prov.name, pick.pool[0]); return; }
            uncovered.missing.push({ id: entry.id, name: entry.name });
        });

        // Spare warlocks keep a personal DPS curse
        roster.filter(p => p.class === 'WARLOCK' && !groupUsed['curse:' + p.name])
            .forEach(p => duties.push({ id: 'curse:' + p.name, name: 'Curse of Doom/Agony (personal)', category: 'debuffs', player: p.name }));

        // Innervates: one row per druid; last druid (or a lone druid) reserves for healers
        const druids = roster.filter(p => p.class === 'DRUID');
        const mages = roster.filter(p => p.class === 'MAGE');
        druids.forEach((d, i) => {
            const id = 'innervate:' + i;
            const o = overrides[id] || {};
            if (isExplicitlyUnassigned(o)) { record({ id, category: 'cooldowns' }, 'Innervate', null); return; }
            const player = (o.player && byName[o.player]) ? byName[o.player] : d;
            const hasTarget = Object.prototype.hasOwnProperty.call(o, 'target');
            const target = hasTarget ? o.target : ((i < druids.length - 1 && i < mages.length) ? mages[i].name : 'HEALER_RESERVE');
            record({ id, category: 'cooldowns' }, 'Innervate', player, target);
        });

        // Soulstone: one row, first warlock, priest healer preferred
        const locks = roster.filter(p => p.class === 'WARLOCK');
        if (locks.length) {
            const id = 'soulstone:0';
            const o = overrides[id] || {};
            if (isExplicitlyUnassigned(o)) {
                record({ id, category: 'cooldowns' }, 'Soulstone', null);
            } else {
                const player = (o.player && byName[o.player]) ? byName[o.player] : locks[0];
                const priests = roster.filter(p => p.class === 'PRIEST' && (p.spec === 'Holy' || p.spec === 'Discipline'));
                const altHealers = roster.filter(p =>
                    (p.class === 'PALADIN' && p.spec === 'Holy') ||
                    ((p.class === 'DRUID' || p.class === 'SHAMAN') && p.spec === 'Restoration'));
                const hasTarget = Object.prototype.hasOwnProperty.call(o, 'target');
                const target = hasTarget ? o.target : ((priests[0] && priests[0].name) || (altHealers[0] && altHealers[0].name) || null);
                record({ id, category: 'cooldowns' }, 'Soulstone', player, target || undefined);
            }
        }

        // A rotation is fight-specific: no eligible class means the row simply does not
        // apply, so it is neither rendered nor warned about.
        ROTATIONS.forEach(rot => {
            const o = overrides[rot.id] || {};
            let players;
            if (o.players) {
                players = o.players.filter(n => byName[n]);
            } else {
                players = rankPool(roster.filter(p => p.class === rot.class && !(p.flags || []).includes('spec-unknown')),
                                   rot, dutyCount).map(p => p.name);
            }
            if (!players.length) return;
            duties.push({ id: rot.id, name: rot.name, category: 'rotations', players, note: rot.note });
        });

        const passives = PASSIVES.map(ps => {
            const p = roster.find(x => x.class === ps.class
                && (ps.specs ? ps.specs.indexOf(x.spec) !== -1 : (!ps.spec || x.spec === ps.spec)));
            return p ? { name: ps.name, player: p.name } : null;
        }).filter(Boolean);

        return { duties, uncovered, passives };
    }

    function displayTarget(t) { return t === 'HEALER_RESERVE' ? 'healer in need' : t; }
    function ccAbilityName(id) {
        const a = CC_ABILITIES.find(x => x.id === id);
        return a ? a.name : id;
    }
    function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // 1st, 2nd, 3rd, 4th... — English ordinal suffixes, with the 11/12/13 exception
    // (11th not 11st). Raid rotations rarely run past a handful of names, but the rule
    // costs nothing to get right.
    function ordinal(n) {
        const rem100 = n % 100;
        if (rem100 >= 11 && rem100 <= 13) return n + 'th';
        switch (n % 10) {
            case 1: return n + 'st';
            case 2: return n + 'nd';
            case 3: return n + 'rd';
            default: return n + 'th';
        }
    }

    // Sheets serialized before the missing/notApplicable split carry a flat array. Share
    // links outlive deploys, so both shapes have to render.
    function missingList(uncovered) {
        if (!uncovered) return [];
        return Array.isArray(uncovered) ? uncovered : (uncovered.missing || []);
    }

    function buildDiscord(roster, sheet, opts) {
        opts = opts || {};
        const byName = {};
        roster.forEach(p => { byName[p.name] = p; });
        const nm = n => {
            const p = byName[n];
            return (opts.pings && p && p.discordId) ? '<@' + p.discordId + '>' : n;
        };
        const lines = ['**__RAID ASSIGNMENTS' + (opts.title ? ' — ' + opts.title : '') + '__**', ''];
        [['debuffs', 'Debuffs'], ['cooldowns', 'Cooldowns']].forEach(pair => {
            const rows = sheet.duties.filter(d => d.category === pair[0] && d.player);
            if (!rows.length) return;
            lines.push('**' + pair[1] + '**');
            rows.forEach(d => {
                let s = d.name + ' — ' + nm(d.player);
                if (d.target) s += ' → ' + (byName[d.target] ? nm(d.target) : displayTarget(d.target));
                if (d.qualifier) s += ' (' + d.qualifier + ')';
                lines.push(s);
            });
            lines.push('');
        });
        const rotations = sheet.duties.filter(d => d.category === 'rotations');
        if (rotations.length) {
            lines.push('**Rotations**');
            rotations.forEach(d => {
                lines.push('• **' + d.name + ':** ' + d.players.map((n, i) => (i + 1) + '. ' + nm(n)).join('  '));
                if (d.note) lines.push('  _' + d.note + '_');
            });
            lines.push('');
        }
        if (sheet.cc && sheet.cc.length) {
            lines.push('**Crowd Control**');
            sheet.cc.filter(c => c.player).forEach(c => {
                lines.push(MARK_EMOJI[c.mark] + ' ' + capitalize(c.mark) + ' ' + ccAbilityName(c.ability) + ' — ' + nm(c.player));
            });
            lines.push('');
        }
        if (sheet.blessings && sheet.blessings.rows && sheet.blessings.rows.length) {
            lines.push('**Blessings**');
            sheet.blessings.rows.forEach(row => {
                // Collapse the row to "blessing → classes" so it reads as instructions rather
                // than a table Discord would mangle.
                const byBlessing = {};
                sheet.blessings.classes.forEach(cls => {
                    const b = row.cells[cls];
                    if (!b) return;
                    (byBlessing[b] = byBlessing[b] || []).push(CLASS_ABBREV[cls] || cls);
                });
                const parts = Object.keys(byBlessing).map(b => b + ' → ' + byBlessing[b].join('/'));
                // A fourth paladin's row is empty by default — with four blessings there is
                // nothing new left to give — so skip rows the lead has not filled in rather
                // than printing a name with nothing after it.
                if (!parts.length) return;
                lines.push('• ' + nm(row.paladin) + ': ' + parts.join(', '));
            });
            lines.push('');
        }
        const missing = missingList(sheet.uncovered);
        if (missing.length) {
            lines.push('⚠ **Uncovered:** ' + missing.map(u => u.name).join(', '));
        }
        return lines.join('\n').trim();
    }

    function packChat(prefix, items, sep, max) {
        const lines = [];
        let cur = '';
        items.forEach(it => {
            const next = cur ? cur + sep + it : prefix + it;
            if (next.length > max) {
                if (cur) lines.push(cur);
                const solo = prefix + it;
                cur = solo.length > max ? solo.slice(0, max) : solo;
            } else {
                cur = next;
            }
        });
        if (cur) lines.push(cur);
        return lines;
    }

    function buildRaidLines(roster, sheet) {
        const items = [];
        sheet.duties.filter(d => d.player).forEach(d => {
            let s = d.name + ': ' + d.player;
            if (d.target) s += ' -> ' + displayTarget(d.target);
            items.push(s);
        });
        sheet.duties.filter(d => d.players).forEach(d => {
            items.push(d.name + ': ' + d.players.join(' > '));
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            items.push('{' + c.mark + '} ' + ccAbilityName(c.ability) + ': ' + c.player);
        });
        return packChat('/raid ', items, ' | ', 255);
    }

    // Per-player duty text, shared by every whisper-shaped output so the two can't drift.
    function whisperMap(sheet) {
        const per = {};
        const add = (name, txt) => { (per[name] = per[name] || []).push(txt); };
        sheet.duties.filter(d => d.player).forEach(d => {
            add(d.player, d.name + (d.target ? ' on ' + displayTarget(d.target) : ''));
        });
        // A rotation has no single owner, so each member is told their own slot in the order —
        // knowing you are third is the whole point of a Fear Ward rotation.
        sheet.duties.filter(d => d.players).forEach(d => {
            d.players.forEach((n, i) => add(n, d.name + ' (' + ordinal(i + 1) + ' of ' + d.players.length + ')'));
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            add(c.player, ccAbilityName(c.ability) + ' on {' + c.mark + '}');
        });
        return per;
    }

    function buildWhispers(roster, sheet) {
        const per = whisperMap(sheet);
        return Object.keys(per).map(n => '/w ' + n + ' Your assignments: ' + per[n].join('; '));
    }

    // Paste payload for the RaidSpecScan addon: one "Name=body" line per whisper.
    // packChat keeps each body inside WoW's 255-character chat limit, so a player with
    // many duties simply gets more than one line — the addon sends each as its own whisper.
    // Note: the 255 count above is in JS UTF-16 code units, while WoW enforces its chat
    // limit in UTF-8 bytes. Duty names (and thus body text) are ASCII-only today, where
    // one UTF-16 unit is always one UTF-8 byte, so the counts agree and this cannot bite.
    // If non-ASCII text is ever introduced here, this length check would need to switch
    // to counting UTF-8 bytes to stay accurate.
    function buildAddonWhispers(roster, sheet) {
        const per = whisperMap(sheet);
        const lines = ['RSW1'];
        Object.keys(per).forEach(n => {
            packChat('Your assignments: ', per[n], '; ', 255).forEach(body => {
                lines.push(n + '=' + body);
            });
        });
        return lines.join('\n');
    }

    // Hunters are deliberately NOT melee. Windfury is a main-hand weapon enchant and ranged
    // attacks do not proc it, so a hunter in the Windfury group wastes the slot. They want
    // Grace of Air, Trueshot, Ferocious Inspiration and Battle Shout instead.
    function bucketOf(p) {
        const s = p.spec;
        switch (p.class) {
            case 'WARRIOR': return s === 'Protection' ? 'tanks' : 'melee';
            case 'PALADIN': return s === 'Holy' ? 'healers' : (s === 'Protection' ? 'tanks' : 'melee');
            case 'DRUID':   return s === 'Restoration' ? 'healers'
                                 : (s === 'Balance' ? 'casters'
                                 : (s === 'Guardian' ? 'tanks' : 'melee'));
            case 'PRIEST':  return s === 'Shadow' ? 'casters' : 'healers';
            case 'SHAMAN':  return s === 'Restoration' ? 'healers' : (s === 'Elemental' ? 'casters' : 'melee');
            case 'ROGUE':   return 'melee';
            case 'HUNTER':  return 'ranged';
            default:        return 'casters';
        }
    }

    // Scarcity order: this is the order a limited number of shamans is spent. Windfury/Strength
    // of Earth on melee is the largest single delta; Totem of Wrath's spell hit is next; tanks
    // gain least.
    //
    // Anniversary-realm scope, verified 2026-08-13: Bloodlust/Heroism is RAID-wide there
    // (10-minute Sated-style debuff, resets on boss kills/wipes), so it is deliberately
    // absent from this model — do not add it as a grouping reason. Everything modeled below
    // is still party-scoped on Anniversary: all totems, paladin auras, Battle Shout, Leader
    // of the Pack, Moonkin Aura, Trueshot, Ferocious Inspiration, Vampiric Touch, Mana Tide
    // and the draenei presences.
    const GROUP_ROLES = ['melee', 'casters', 'healers', 'ranged', 'tanks'];
    const SHAMAN_ROLE = { Enhancement: 'melee', Elemental: 'casters', Restoration: 'healers' };
    const GROUP_CAP = 5;

    // Party-buff value model (spec: docs/superpowers/specs/2026-08-13-group-optimizer-
    // ai-review-design.md). Units are ordinal, not simulated: 10 is the largest single
    // delta in the game (Windfury on a windfury user), 1 is minor. Only the ORDER of
    // the weights needs to be right — the optimizer compares sums, never absolute values.
    function buffArchetype(p) {
        switch (p.class) {
            case 'WARRIOR': return p.spec === 'Protection' ? 'protWarrior' : 'wfMelee';
            case 'ROGUE':   return 'wfMelee';
            case 'PALADIN': return p.spec === 'Protection' ? 'protPaladin'
                                 : (p.spec === 'Holy' ? 'healer' : 'wfMelee');
            case 'DRUID':   return p.spec === 'Restoration' ? 'healer'
                                 : (p.spec === 'Balance' ? 'caster'
                                 : (p.spec === 'Guardian' ? 'bear' : 'feralCat'));
            case 'PRIEST':  return p.spec === 'Shadow' ? 'caster' : 'healer';
            case 'SHAMAN':  return p.spec === 'Enhancement' ? 'enhShaman'
                                 : (p.spec === 'Elemental' ? 'caster' : 'healer');
            case 'HUNTER':  return 'hunter';
            default:        return 'caster'; // mage, warlock
        }
    }

    function specKey(p) { return p.class + ':' + (p.spec || ''); }

    // Value tables are keyed by specKey. The hand-written provisional numbers below are
    // expressed per ARCHETYPE and expanded, because that is the granularity the old ordinal
    // table encoded; the calibration harness replaces the whole block with per-spec numbers.
    const SPECS_BY_ARCHETYPE = {
        wfMelee: ['WARRIOR:Arms', 'WARRIOR:Fury', 'ROGUE:Assassination', 'ROGUE:Combat',
                  'ROGUE:Subtlety', 'PALADIN:Retribution'],
        enhShaman: ['SHAMAN:Enhancement'],
        feralCat: ['DRUID:Feral'],
        bear: ['DRUID:Guardian'],
        protWarrior: ['WARRIOR:Protection'],
        protPaladin: ['PALADIN:Protection'],
        hunter: ['HUNTER:Beast Mastery', 'HUNTER:Marksmanship', 'HUNTER:Survival'],
        caster: ['MAGE:Arcane', 'MAGE:Fire', 'MAGE:Frost', 'WARLOCK:Affliction',
                 'WARLOCK:Demonology', 'WARLOCK:Destruction', 'PRIEST:Shadow',
                 'SHAMAN:Elemental', 'DRUID:Balance'],
        healer: ['PRIEST:Discipline', 'PRIEST:Holy', 'PALADIN:Holy', 'SHAMAN:Restoration',
                 'DRUID:Restoration'],
    };
    function expandV(byArchetype) {
        const v = {};
        Object.keys(byArchetype).forEach(a =>
            SPECS_BY_ARCHETYPE[a].forEach(k => { v[k] = byArchetype[a]; }));
        return v;
    }

    // === CALIBRATION START (provisional hand values; regenerated by calibration/inject-weights.mjs — do not hand-edit once generated) ===
    // BASELINE: unbuffed-party sim DPS per spec. Healers are 0 BY DESIGN — they enter the
    // model through floors, never the objective (spec §1). Provisional values only encode
    // plausible magnitudes and ordering.
    const BASELINE = {
        'WARRIOR:Arms': 900, 'WARRIOR:Fury': 1000, 'WARRIOR:Protection': 350,
        'PALADIN:Holy': 0, 'PALADIN:Protection': 400, 'PALADIN:Retribution': 900,
        'HUNTER:Beast Mastery': 1050, 'HUNTER:Marksmanship': 950, 'HUNTER:Survival': 900,
        'ROGUE:Assassination': 950, 'ROGUE:Combat': 1000, 'ROGUE:Subtlety': 800,
        'PRIEST:Discipline': 0, 'PRIEST:Holy': 0, 'PRIEST:Shadow': 900,
        'SHAMAN:Elemental': 950, 'SHAMAN:Enhancement': 900, 'SHAMAN:Restoration': 0,
        'MAGE:Arcane': 1000, 'MAGE:Fire': 950, 'MAGE:Frost': 900,
        'WARLOCK:Affliction': 1000, 'WARLOCK:Demonology': 900, 'WARLOCK:Destruction': 1050,
        'DRUID:Balance': 850, 'DRUID:Feral': 900, 'DRUID:Guardian': 400, 'DRUID:Restoration': 0,
    };
    // BUFF_V: fractional throughput value per (buff, spec). 0.10 = +10% DPS.
    const BUFF_V = {
        'Windfury Totem': expandV({ wfMelee: 0.10, protWarrior: 0.05 }),
        'Grace of Air': expandV({ wfMelee: 0.02, enhShaman: 0.02, feralCat: 0.05, bear: 0.05,
                                  hunter: 0.06, protWarrior: 0.01, protPaladin: 0.01 }),
        'Wrath of Air': expandV({ caster: 0.04, protPaladin: 0.03 }),
        'Strength of Earth': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03,
                                       bear: 0.02, protWarrior: 0.02, protPaladin: 0.01 }),
        'Totem of Wrath': expandV({ caster: 0.06, protPaladin: 0.02 }),
        'Mana Spring Totem': {},
        'Mana Tide Totem': {},
        'Battle Shout': expandV({ wfMelee: 0.04, enhShaman: 0.04, feralCat: 0.04, bear: 0.03,
                                  protWarrior: 0.03 }),
        'Unleashed Rage': expandV({ wfMelee: 0.05, feralCat: 0.04, bear: 0.02,
                                    protWarrior: 0.02, hunter: 0.05 }),
        'Leader of the Pack': expandV({ wfMelee: 0.05, enhShaman: 0.04, feralCat: 0.05,
                                        bear: 0.03, hunter: 0.05, protWarrior: 0.02 }),
        'Ferocious Inspiration': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03,
                                           bear: 0.03, hunter: 0.03, caster: 0.03,
                                           protWarrior: 0.03, protPaladin: 0.03 }),
        'Trueshot Aura': expandV({ wfMelee: 0.03, enhShaman: 0.03, feralCat: 0.03, hunter: 0.05,
                                   protWarrior: 0.01 }),
        'Moonkin Aura': expandV({ caster: 0.05 }),
        'Vampiric Touch': expandV({ caster: 0.02 }),
        'Devotion Aura': {},
        'Retribution Aura': {},
        'Concentration Aura': {},
        'Sanctity Aura': { 'PALADIN:Retribution': 0.05, 'PALADIN:Protection': 0.05 },
        'Heroic Presence': expandV({ wfMelee: 0.02, enhShaman: 0.02, feralCat: 0.02, bear: 0.01,
                                     hunter: 0.02, protWarrior: 0.01, protPaladin: 0.01 }),
        'Inspiring Presence': expandV({ caster: 0.02 }),
    };
    // === CALIBRATION END ===

    // element:'air' rows compete — a shaman runs ONE air totem, so groupBuffs picks a
    // single air row per group. Windfury is absent for enhShaman (own imbues), feralCat
    // and bear (weapon-imbue totems do not affect shapeshifted druids) and hunters
    // (main-hand proc, ranged attacks never trigger it). `count` returns how many providers
    // the group has; `mode: 'once'` clamps it to 1 (duplicate providers are wasted), while
    // 'stacks' keeps the full count — Ferocious Inspiration is the one row that compounds.
    const PARTY_BUFFS = [
        { name: 'Windfury Totem', element: 'air', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Windfury Totem'] || {} },
        { name: 'Grace of Air', element: 'air', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Grace of Air'] || {} },
        { name: 'Wrath of Air', element: 'air', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Wrath of Air'] || {} },
        { name: 'Strength of Earth', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Strength of Earth'] || {} },
        { name: 'Totem of Wrath', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN' && p.spec === 'Elemental').length,
          v: BUFF_V['Totem of Wrath'] || {} },
        { name: 'Mana Tide Totem', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN' && p.spec === 'Restoration').length,
          v: BUFF_V['Mana Tide Totem'] || {} },
        // Mana Tide is a 5-minute cooldown; Mana Spring is the water-slot UPTIME buff, and
        // the healer floor is really about it. DPS value ~0, so it exists for the floor
        // and the note rather than the objective (brief §3 fix #3).
        { name: 'Mana Spring Totem', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN').length,
          v: BUFF_V['Mana Spring Totem'] || {} },
        { name: 'Battle Shout', mode: 'once',
          count: ps => ps.filter(p => p.class === 'WARRIOR').length,
          v: BUFF_V['Battle Shout'] || {} },
        { name: 'Unleashed Rage', mode: 'once',
          count: ps => ps.filter(p => p.class === 'SHAMAN' && p.spec === 'Enhancement').length,
          v: BUFF_V['Unleashed Rage'] || {} },
        { name: 'Leader of the Pack', mode: 'once',
          count: ps => ps.filter(p => p.class === 'DRUID' && isFeralSpec(p.spec)).length,
          v: BUFF_V['Leader of the Pack'] || {} },
        // The one row that compounds: two BM hunters in a party give 1.03² = +6.09%
        // (wowsims: `int32 ferocious_inspiration` — a COUNT, not a flag).
        { name: 'Ferocious Inspiration', mode: 'stacks',
          count: ps => ps.filter(p => p.class === 'HUNTER' && p.spec === 'Beast Mastery').length,
          v: BUFF_V['Ferocious Inspiration'] || {} },
        { name: 'Trueshot Aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'HUNTER' && p.spec === 'Marksmanship').length,
          v: BUFF_V['Trueshot Aura'] || {} },
        { name: 'Moonkin Aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'DRUID' && p.spec === 'Balance').length,
          v: BUFF_V['Moonkin Aura'] || {} },
        { name: 'Vampiric Touch', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PRIEST' && p.spec === 'Shadow').length,
          v: BUFF_V['Vampiric Touch'] || {} },
        // element:'aura' rows compete for paladin aura slots: a group with k paladins runs
        // the top k by group value (wowsims models all four separately, brief §3 fix #6).
        { name: 'Devotion Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Devotion Aura'] || {} },
        { name: 'Retribution Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Retribution Aura'] || {} },
        { name: 'Concentration Aura', element: 'aura', mode: 'once',
          count: ps => ps.filter(p => p.class === 'PALADIN').length,
          v: BUFF_V['Concentration Aura'] || {} },
        { name: 'Sanctity Aura', element: 'aura', mode: 'once',
          // Ret talent: available only when a Retribution paladin is in the group.
          count: ps => ps.some(p => p.class === 'PALADIN' && p.spec === 'Retribution')
              ? ps.filter(p => p.class === 'PALADIN').length : 0,
          v: BUFF_V['Sanctity Aura'] || {} },
        { name: 'Draenei presence', mode: 'once',
          count: ps => ps.filter(p => p.race === 'Draenei').length,
          v: BUFF_V['Draenei presence'] || {} },
    ];

    function multOf(p) { return typeof p.mult === 'number' ? p.mult : 1; }

    // What a buff is worth to a whole group, in raid DPS — the quantity the air argmax and
    // the aura selection compare. Unlike playerBuffScore this ignores the other active
    // buffs, so it ranks candidates without needing the set it is choosing.
    function groupValueOf(buff, players) {
        return players.reduce((s, p) =>
            s + (BASELINE[specKey(p)] || 0) * multOf(p) * (buff.v[specKey(p)] || 0), 0);
    }

    function groupBuffs(players) {
        const active = [];
        PARTY_BUFFS.filter(b => !b.element).forEach(b => {
            const n = b.count(players);
            if (n > 0) active.push({ buff: b, count: b.mode === 'stacks' ? n : 1 });
        });
        const airs = PARTY_BUFFS.filter(b => b.element === 'air' && b.count(players) > 0);
        if (airs.length) {
            if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement')) {
                // Totem twisting (Max's ruling; wowsims `totem_twisting`): Windfury AND
                // Grace of Air together — twist two, not three, so Wrath of Air stays out.
                // A totem worth 0 to every member is dropped from the set rather than
                // claimed: it contributes nothing to the score either way, and the notes
                // must not tell a raid lead that a healer group "buys" Windfury.
                airs.filter(b => b.name !== 'Wrath of Air')
                    .filter(b => groupValueOf(b, players) > 0)
                    .forEach(b => active.push({ buff: b, count: 1 }));
            } else if (players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental')) {
                // An Elemental shaman always keeps Wrath of Air — established ruling (it
                // will not sacrifice its own spell damage to imbue melee).
                const woa = airs.filter(b => b.name === 'Wrath of Air')[0];
                if (woa) active.push({ buff: woa, count: 1 });
            } else {
                // Argmax of group value, ties keep table order (Windfury first).
                let bestAir = null, bestVal = -1;
                airs.forEach(b => {
                    const v = groupValueOf(b, players);
                    if (v > bestVal) { bestVal = v; bestAir = b; }
                });
                if (bestAir) active.push({ buff: bestAir, count: 1 });
            }
        }
        const auras = PARTY_BUFFS.filter(b => b.element === 'aura' && b.count(players) > 0);
        if (auras.length) {
            const nPal = players.filter(p => p.class === 'PALADIN').length;
            auras.map(b => ({ b, val: groupValueOf(b, players) }))
                .sort((x, y) => y.val - x.val) // stable: ties keep table order
                .slice(0, Math.min(nPal, auras.length))
                .forEach(x => active.push({ buff: x.b, count: 1 }));
        }
        return active;
    }

    // The uplift a player takes from their group, as a fraction: Π(1 + v)^count − 1.
    // Multiplicative by design (spec §1) — it is what makes the BM-hunter split rule fall
    // out of the score instead of being special-cased.
    function playerBuffScore(p, players) {
        return groupBuffs(players).reduce((f, a) =>
            f * Math.pow(1 + (a.buff.v[specKey(p)] || 0), a.count), 1) - 1;
    }

    function playerScore(p, players) {
        return (BASELINE[specKey(p)] || 0) * multOf(p) * (1 + playerBuffScore(p, players));
    }

    // Layout score = raid DPS in real units. No cohesion term: once weights are % DPS,
    // the old 0.25 nudge is a unit collision, not a tiebreak (brief §8 Q3). Readability
    // comes from the seed, the relabel pass and the deterministic enumeration order.
    function scoreLayout(groups) {
        return groups.reduce((sum, g) =>
            sum + g.players.reduce((s, p) => s + playerScore(p, g.players), 0), 0);
    }

    // Within a role, place the players whose buffs are party-scoped first — they are the
    // reason the group exists, so they must not be crowded out by a filler DPS.
    function anchorScore(p) {
        if (p.class === 'WARRIOR' && p.spec !== 'Protection') return 0; // Battle Shout
        if (p.class === 'DRUID' && isFeralSpec(p.spec)) return 0;       // Leader of the Pack (bear or cat)
        if (p.class === 'DRUID' && p.spec === 'Balance') return 0;      // Moonkin Aura
        if (p.class === 'PRIEST' && p.spec === 'Shadow') return 0;      // Vampiric Touch
        if (p.class === 'HUNTER' && p.spec === 'Beast Mastery') return 0; // Ferocious Inspiration
        if (p.class === 'PALADIN') return 1;                            // an aura, any group
        return 2;
    }

    function proposeGroups(roster) {
        const n = roster.length;
        const groupCount = n ? Math.min(5, Math.ceil(n / GROUP_CAP)) : 0;
        // Scarcity order still decides priority, but only among roles this roster can actually
        // fill — otherwise an all-healer raid gets told its healers are a melee group.
        const present = GROUP_ROLES.filter(role => roster.some(p => bucketOf(p) === role));
        const roleOrder = present.concat(GROUP_ROLES.filter(r => present.indexOf(r) === -1));
        const groups = roleOrder.slice(0, groupCount).map(role => ({ role, players: [] }));
        const byRole = {};
        groups.forEach(g => { byRole[g.role] = g; });
        const placed = new Set();

        function place(p, g) {
            if (!g || placed.has(p) || g.players.length >= GROUP_CAP) return false;
            g.players.push(p);
            placed.add(p);
            return true;
        }

        // 1. Shamans seed first — one per group, spec-matched. A second shaman of the same
        //    spec duplicates every totem the first one drops (totems are party-scoped and do
        //    not stack), so it is a spare, not a seed: the spread pass below sends it to a
        //    group that has no shaman at all.
        const shamans = roster.filter(p => p.class === 'SHAMAN');
        shamans.forEach(sh => {
            const g = byRole[SHAMAN_ROLE[sh.spec]];
            if (g && !g.players.some(x => x.class === 'SHAMAN')) place(sh, g);
        });
        shamans.filter(p => !placed.has(p)).forEach(sh => {
            place(sh, groups.find(g => !g.players.some(x => x.class === 'SHAMAN') && g.players.length < GROUP_CAP));
        });

        // 2. Fill each group from its own bucket, anchors first.
        groups.forEach(g => {
            roster.filter(p => !placed.has(p) && bucketOf(p) === g.role)
                .sort((a, b) => anchorScore(a) - anchorScore(b) || a.name.localeCompare(b.name))
                .forEach(p => place(p, g));
        });

        // 3. Overflow: whoever is left goes wherever there is room, fullest-first so we do
        //    not scatter three leftovers across three otherwise-clean groups.
        const unplaced = [];
        roster.filter(p => !placed.has(p)).forEach(p => {
            const g = groups.filter(g => g.players.length < GROUP_CAP)
                .sort((a, b) => b.players.length - a.players.length)[0];
            if (!place(p, g)) unplaced.push(p);
        });

        // Heroic/Inspiring Presence is party-scoped and does not stack for non-draenei, so a
        // second draenei in a group is wasted. Swap-only: sizes never change, and only filler
        // players trade places. Anchors are off-limits on BOTH sides of the swap — a draenei
        // rogue must never displace the Windfury shaman — so the seeding and anchor placement
        // from steps 1-2 cannot be undone by THIS pass. (The hill-climb in step 4 runs after
        // this pass and can still relocate these players, subject to its own relocatability
        // rules — that guarantee is local to the draenei swap, not a promise about the
        // roster as a whole.) anchorScore treats shamans as fillers (score 2,
        // same as any other non-anchor DPS), but a shaman is the reason the group's totem notes
        // are true regardless of whether it landed there by seeding or by overflow, so the
        // explicit class check keeps every shaman off-limits alongside the real anchors. A
        // surplus draenei who IS an anchor (a draenei BM hunter next to
        // another draenei) simply stays put: wasting a racial beats breaking a buff group.
        function swappable(p) { return p.class !== 'SHAMAN' && anchorScore(p) === 2; }
        groups.forEach(g => {
            const dr = g.players.filter(p => p.race === 'Draenei')
                .sort((a, b) => anchorScore(a) - anchorScore(b)); // keep the most anchor-like one in place
            dr.slice(1).forEach(extra => {
                if (!swappable(extra)) return;
                const target = groups.find(o => o !== g
                    && !o.players.some(p => p.race === 'Draenei')
                    && o.players.some(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra)));
                if (!target) return;
                const swap = target.players.find(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra));
                g.players[g.players.indexOf(extra)] = swap;
                target.players[target.players.indexOf(swap)] = extra;
            });
        });

        // 4. Buff-aware hill-climb (spec: docs/superpowers/specs/2026-08-13-group-
        // optimizer-ai-review-design.md). Enumerate every cross-group swap and every move
        // into an empty seat in a fixed order, apply the single best strictly-positive
        // improvement, repeat until nothing improves. Determinism is the point: the seed
        // is deterministic, the enumeration order is deterministic, and ties keep the
        // first candidate found, so the same roster always yields the same layout. The
        // iteration cap is a runaway guard, not a tuning knob — convergence happens in a
        // handful of moves on any real roster.
        function trySwap(gA, iA, gB, iB) {
            const t = gA.players[iA]; gA.players[iA] = gB.players[iB]; gB.players[iB] = t;
        }
        // Only the seed's actual defects are eligible to move — not every player who
        // happens to sit in a buff-suboptimal seat. The spec's Problem section blames the
        // overflow pass specifically ("leftover players go to the fullest group with
        // room ... this parked a combat rogue and a destruction warlock with the healers
        // and left both tanks alone in a 2-man group with 3 empty seats"), and its
        // Consequences section promises groups stay recognizable archetypes — a promise
        // an unrestricted hill-climb cannot keep on a full roster with no slack seats. A
        // player is relocatable only if (a) the seed could not place them in their own
        // bucket's group — bucketOf(p) !== their group's role, exactly the overflow the
        // spec blames (the relabel block runs after this pass, so g.role here is still
        // the seed's label, not a post-hoc relabeling) — or (b) their group is under-full,
        // the tank-island pathology. Relocatability alone still lets two FULL groups swap
        // two mutually-overflowed players, which on an every-bucket-full roster (raid25's
        // 8-strong melee bucket against a 5-seat group) reshuffles two clean groups into
        // each other for a real buff gain, and can flip a relabel tie against the group
        // the spec never asked to touch. So the swap candidate additionally requires that
        // at least one endpoint group is under-full: a swap that touches only full groups
        // is never a repair, only a reshuffle, and reshuffling is not this pass's job.
        // Under that combined guard, a fully-seeded roster (no under-full group) allows no
        // relocation at all, so its role groups are provably intact — not "no relocatable
        // player exists" (that was disproved: overflow players are relocatable there too)
        // but "no relocation can fire without an under-full group to fire into." Evaluated
        // off the live layout at each check, not cached from the seed, so a group a move
        // leaves under-full correctly becomes eligible on a later iteration.
        function relocatable(g, p) {
            return bucketOf(p) !== g.role || g.players.length < GROUP_CAP;
        }
        for (let iter = 0; iter < 500; iter++) {
            const base = scoreLayout(groups);
            let best = null;
            for (let a = 0; a < groups.length; a++) {
                for (let ia = 0; ia < groups[a].players.length; ia++) {
                    for (let b = 0; b < groups.length; b++) {
                        if (b === a) continue;
                        if (b > a) { // each swap pair once
                            for (let ib = 0; ib < groups[b].players.length; ib++) {
                                if ((groups[a].players.length < GROUP_CAP || groups[b].players.length < GROUP_CAP)
                                    && relocatable(groups[a], groups[a].players[ia]) && relocatable(groups[b], groups[b].players[ib])) {
                                    trySwap(groups[a], ia, groups[b], ib);
                                    const d = scoreLayout(groups) - base;
                                    trySwap(groups[a], ia, groups[b], ib);
                                    if (d > 0 && (!best || d > best.delta)) best = { delta: d, kind: 'swap', a, ia, b, ib };
                                }
                            }
                        }
                        if (groups[b].players.length < GROUP_CAP && relocatable(groups[a], groups[a].players[ia])) {
                            const p = groups[a].players[ia];
                            groups[a].players.splice(ia, 1);
                            groups[b].players.push(p);
                            const d = scoreLayout(groups) - base;
                            groups[b].players.pop();
                            groups[a].players.splice(ia, 0, p);
                            if (d > 0 && (!best || d > best.delta)) best = { delta: d, kind: 'move', a, ia, b };
                        }
                    }
                }
            }
            if (!best) break;
            if (best.kind === 'swap') trySwap(groups[best.a], best.ia, groups[best.b], best.ib);
            else groups[best.b].players.push(groups[best.a].players.splice(best.ia, 1)[0]);
        }

        // The role list is chosen up front from which buckets exist, but group COUNT comes from
        // headcount, so a short or lopsided roster can leave a group labelled with a role nobody
        // in it has. Relabel from who actually landed here — the label is what the panel prints.
        // A tie keeps the role the group was created for: the tank group holding two tanks and
        // two mages is still the tank group. Only a strict majority renames it.
        groups.forEach(g => {
            if (!g.players.length) return;
            const tally = {};
            g.players.forEach(p => { const b = bucketOf(p); tally[b] = (tally[b] || 0) + 1; });
            const best = Math.max.apply(null, Object.keys(tally).map(k => tally[k]));
            if ((tally[g.role] || 0) === best) return;
            g.role = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a.localeCompare(b))[0];
        });

        // Say what the grouping actually buys, so the raid lead can sanity-check it rather
        // than trust it. Only claim a buff when the provider is genuinely in the group.

        // The air-note rules delegate to the score model's air-totem choice, so the notes
        // and the optimizer can never disagree about which air totem a group runs — and the
        // one-air-note invariant holds by construction instead of by rule coordination.
        // Plural since the twisting ruling: an enh-shaman group runs TWO air totems, so a
        // note rule asks whether its totem is among the group's choices, not whether it is
        // the single choice.
        function airChoiceNames(g) {
            return groupBuffs(g.players).filter(a => a.buff.element === 'air').map(a => a.buff.name);
        }
        function auraNames(g) {
            return groupBuffs(g.players).filter(a => a.buff.element === 'aura').map(a => a.buff.name);
        }

        const NOTE_RULES = [
            { text: 'Windfury Totem',
              has: g => airChoiceNames(g).indexOf('Windfury Totem') !== -1
                     && g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
            { text: 'Unleashed Rage (+10% AP)', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
            { text: 'Totem of Wrath (+3% spell hit and crit)', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental') },
            { text: 'Wrath of Air (+101 spell damage and healing)',
              has: g => airChoiceNames(g).indexOf('Wrath of Air') !== -1 },
            { text: 'Grace of Air (+77 agility)',
              has: g => airChoiceNames(g).indexOf('Grace of Air') !== -1 },
            { text: 'Windfury Totem (baseline)',
              has: g => airChoiceNames(g).indexOf('Windfury Totem') !== -1
                     && !g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
            // Strength of Earth is an EARTH totem: any shaman drops it regardless of which
            // AIR totem airChoice() picks for the group, so it cannot ride along on the
            // Windfury note above — it has to be its own rule or it scores with no note.
            { text: 'Strength of Earth', has: g => g.players.some(p => p.class === 'SHAMAN') },
            { text: 'Mana Spring Totem', has: g => g.players.some(p => p.class === 'SHAMAN') },
            { text: 'Mana Tide Totem', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Restoration') },
            { text: 'Battle Shout', has: g => g.players.some(p => p.class === 'WARRIOR') },
            { text: 'Leader of the Pack (+5% melee/ranged crit)', has: g => g.players.some(p => p.class === 'DRUID' && isFeralSpec(p.spec)) },
            { text: 'Moonkin Aura (+5% spell crit)', has: g => g.players.some(p => p.class === 'DRUID' && p.spec === 'Balance') },
            { text: 'Ferocious Inspiration (+3% damage, stacks per BM hunter)', has: g => g.players.some(p => p.class === 'HUNTER' && p.spec === 'Beast Mastery') },
            { text: 'Trueshot Aura (+125 attack power)',
              has: g => g.players.some(p => p.class === 'HUNTER' && p.spec === 'Marksmanship')
                     && g.players.some(p => !(p.class === 'HUNTER' && p.spec === 'Marksmanship')
                          && (bucketOf(p) === 'melee' || bucketOf(p) === 'tanks' || bucketOf(p) === 'ranged')) },
            { text: 'Vampiric Touch (mana to the party)', has: g => g.players.some(p => p.class === 'PRIEST' && p.spec === 'Shadow') },
            { text: 'Devotion Aura', has: g => auraNames(g).indexOf('Devotion Aura') !== -1 },
            { text: 'Retribution Aura', has: g => auraNames(g).indexOf('Retribution Aura') !== -1 },
            { text: 'Concentration Aura', has: g => auraNames(g).indexOf('Concentration Aura') !== -1 },
            { text: 'Sanctity Aura (+10% Holy damage)', has: g => auraNames(g).indexOf('Sanctity Aura') !== -1 },
            { text: '+1% hit from Draenei presence', has: g => g.players.some(p => p.race === 'Draenei') },
        ];
        groups.forEach(g => { g.notes = NOTE_RULES.filter(r => r.has(g)).map(r => r.text); });

        return { groups, unplaced };
    }

    const GREATER_BLESSINGS = ['Greater Kings', 'Greater Might', 'Greater Wisdom', 'Greater Salvation'];

    // Classes whose raid role is predominantly physical. Druid, Shaman and Paladin are
    // genuinely mixed — they land here because Might is the safer default for them, and the
    // grid is editable precisely because that call depends on the comp.
    const PHYSICAL_CLASSES = ['WARRIOR', 'ROGUE', 'HUNTER', 'DRUID', 'SHAMAN', 'PALADIN'];

    // A Greater Blessing is cast on a whole class, so Salvation on WARRIOR lands on the tank too
    // and cannot be withheld from him. Any class holding a tank therefore skips Salvation and the
    // raid lead covers that tank with a single-target blessing instead. isFeralSpec counts as a
    // tank: a declared Guardian IS a bear, full stop, and silently handing him Salvation is the
    // failure mode this rule exists to prevent. Feral stays included too, as the conservative
    // case — an undeclared cat might in truth be a bear nobody bothered to relabel, and a cat
    // losing Salvation costs little next to that risk.
    function classHoldsTank(roster, cls) {
        return roster.some(p => p.class === cls
            && (p.spec === 'Protection' || (p.class === 'DRUID' && isFeralSpec(p.spec))));
    }

    // Paladin n gets plan n. Ret takes Kings raid-wide because it is the single best blessing
    // and Ret is the least likely to be doing anything else at pull. With only four blessings a
    // fourth paladin has nothing new to give, so their row starts empty for the lead to fill.
    const BLESSING_PLANS = [
        (cls, roster) => 'Greater Kings',
        (cls, roster) => (PHYSICAL_CLASSES.indexOf(cls) !== -1 ? 'Greater Might' : 'Greater Wisdom'),
        (cls, roster) => (classHoldsTank(roster, cls) ? null : 'Greater Salvation'),
        (cls, roster) => null,
    ];
    const PALADIN_ORDER = { Retribution: 0, Holy: 1, Protection: 2 };

    // 0 = talented, 1 = unknown, 2 = known-untalented — the same ordering rankPool's tier
    // uses, so the grid and the duty rows cannot disagree about what talent data means.
    function blessingTier(pal, key) {
        const r = talentRank(pal, key);
        return r === null ? 1 : (r > 0 ? 0 : 2);
    }

    function proposeBlessings(roster, overrides) {
        overrides = overrides || {};
        const classes = [];
        roster.forEach(p => { if (classes.indexOf(p.class) === -1) classes.push(p.class); });
        classes.sort();

        const paladins = roster.filter(p => p.class === 'PALADIN').slice().sort((a, b) => {
            const oa = PALADIN_ORDER[a.spec], ob = PALADIN_ORDER[b.spec];
            return (oa === undefined ? 9 : oa) - (ob === undefined ? 9 : ob) || a.name.localeCompare(b.name);
        });

        const warnings = [];

        // Match plans to paladins talent-aware. Kings is a 1-point Protection talent, not a
        // baseline spell: a paladin known not to have it cannot cast it at all, so they are
        // excluded from that plan rather than merely ranked last. With no talent data every
        // tier is 1, every sort below is stable, and paladin N gets plan N exactly as before.
        const planOf = {};
        const unassigned = paladins.slice();
        function takeBest(tierOf, exclude) {
            const pool = exclude ? unassigned.filter(p => tierOf(p) !== 2) : unassigned;
            if (!pool.length) return null;
            const best = pool.slice().sort((a, b) =>
                tierOf(a) - tierOf(b) || paladins.indexOf(a) - paladins.indexOf(b))[0];
            unassigned.splice(unassigned.indexOf(best), 1);
            return best;
        }
        const kingsPal = takeBest(p => blessingTier(p, 'kings'), true);
        if (kingsPal) planOf[kingsPal.name] = 0;
        else if (paladins.length) warnings.push('Nobody can cast Blessing of Kings — it is a Protection talent.');
        const mwPal = takeBest(p => Math.min(blessingTier(p, 'impMight'), blessingTier(p, 'impWisdom')), false);
        if (mwPal) planOf[mwPal.name] = 1;
        const salvPal = takeBest(function () { return 0; }, false);
        if (salvPal) planOf[salvPal.name] = 2;
        unassigned.slice().forEach(p => { planOf[p.name] = 3; });

        const rows = paladins.map(pal => {
            const plan = BLESSING_PLANS[planOf[pal.name]] || BLESSING_PLANS[BLESSING_PLANS.length - 1];
            const cells = {};
            classes.forEach(cls => {
                const key = pal.name + '|' + cls;
                cells[cls] = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : plan(cls, roster);
            });
            return { paladin: pal.name, spec: pal.spec, cells };
        });

        // A manually assigned cell is never blocked (respecs happen, the lead may know
        // better), but a Kings cell on a paladin the scan says cannot cast it deserves the
        // same visibility as a duplicate blessing.
        rows.forEach(r => {
            const pal = paladins.find(p => p.name === r.paladin);
            if (blessingTier(pal, 'kings') === 2
                && classes.some(cls => r.cells[cls] === 'Greater Kings')) {
                warnings.push(r.paladin + ' cannot cast Blessing of Kings (talent not taken).');
            }
        });

        if (!paladins.length && roster.length) warnings.push('No paladin in the raid — no blessings at all.');
        classes.forEach(cls => {
            // A null cell here is the salvation rule deliberately withholding a blessing from a
            // class that holds a tank, not a paladin forgetting to fill the row in — so
            // filter(Boolean) drops it from `given` rather than counting it toward the
            // no-blessing-assigned warning below.
            const given = rows.map(r => r.cells[cls]).filter(Boolean);
            if (rows.length && !given.length) warnings.push(cls + ': no blessing assigned.');
            const seen = {};
            given.forEach(b => {
                seen[b] = (seen[b] || 0) + 1;
                if (seen[b] === 2) warnings.push(cls + ': two paladins are both casting ' + b + ' — one is wasted.');
            });
        });
        return { classes, rows, warnings };
    }

    return {
        SPEC_TREES, SELECTABLE_SPECS, isFeralSpec, CLASS_COLORS, CLASS_ABBREV,
        TALENTS, talentRank, talentDrift, gateAllows,
        inferSpec, parseAddonExport, parseRaidHelper, mergeRosters,
        DEBUFF_CATALOG, ROTATIONS, PASSIVES, autoAssign, missingList, providersOf,
        CC_ABILITIES, MARKS, MARK_EMOJI, defaultCC,
        buildDiscord, buildRaidLines, buildWhispers, buildAddonWhispers,
        bucketOf, proposeGroups, playerBuffScore, playerScore, scoreLayout,
        specKey, BASELINE, BUFF_V, PARTY_BUFFS, groupBuffs,
        GREATER_BLESSINGS, proposeBlessings,
    };
}));
