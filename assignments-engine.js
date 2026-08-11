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

    const CLASS_COLORS = {
        WARRIOR: '#C69B6D', PALADIN: '#F48CBA', HUNTER: '#AAD372',
        ROGUE: '#FFF468', PRIEST: '#FFFFFF', SHAMAN: '#0070DD',
        MAGE: '#3FC7EB', WARLOCK: '#8788EE', DRUID: '#FF7C0A',
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
            // RSS1: name:CLASS:41/20/0        RSS2 adds :subgroup:Race, both optional so a
            // partially-upgraded raid still parses. Group and race read null when absent.
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)(?::(\d+)(?::([A-Za-z]+))?)?$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
            let group = null;
            if (m[6] !== undefined) {
                group = Number(m[6]);
                if (group < 1 || group > 8) { errors.push('Subgroup out of range in: ' + tok); return; }
            }
            const race = m[7] === undefined ? null : m[7];
            const name = m[1];
            const cls = m[2].toUpperCase();
            if (!SPEC_TREES[cls]) { errors.push('Unknown class in: ' + tok); return; }
            if (seen.has(name)) { errors.push('Duplicate name: ' + name); return; }
            const flags = [];
            let spec = null;
            if (m[3] === undefined) {
                flags.push('spec-unknown');
            } else {
                const r = inferSpec(cls, [Number(m[3]), Number(m[4]), Number(m[5])]);
                spec = r.spec;
                if (!spec) flags.push('spec-unknown');
                else if (r.ambiguous) flags.push('spec-ambiguous');
            }
            seen.add(name);
            players.push({ name, class: cls, spec, flags, source: 'addon', group, race });
        });
        return { players, errors };
    }

    const RH_STATUS_CLASSES = ['Bench', 'Late', 'Tentative', 'Absence'];
    const RH_CLASS_NAMES = {
        Warrior: 'WARRIOR', Paladin: 'PALADIN', Hunter: 'HUNTER', Rogue: 'ROGUE',
        Priest: 'PRIEST', Shaman: 'SHAMAN', Mage: 'MAGE', Warlock: 'WARLOCK', Druid: 'DRUID',
    };
    const RH_SPEC_ALIASES = { Beastmastery: 'Beast Mastery', Guardian: 'Feral' };

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
            const cls = RH_CLASS_NAMES_LC[rawClass.toLowerCase()];
            if (!cls) { errors.push('Unknown class "' + rawClass + '" for ' + su.name); return; }
            let spec = String(rhPick(su, ['specName', 'spec']) || '').replace(/\d+$/, '');
            spec = RH_SPEC_ALIASES_LC[spec.toLowerCase()] || spec;
            const flags = [];
            const canonical = SPEC_TREES[cls].find(s => s.toLowerCase() === spec.toLowerCase());
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
                    m.flags.push('signed-as:' + rh.spec);
                    mismatches.push({ name: m.name, signed: rh.spec, actual: m.spec });
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
            { name: 'Improved Expose Armor', class: 'ROGUE', preferSpecs: ['Subtlety', 'Combat'] },
            { name: 'Sunder Armor', class: 'WARRIOR', preferSpecs: ['Protection'] },
        ] },
        { id: 'coe', name: 'Curse of Elements', category: 'debuffs', class: 'WARLOCK', preferSpecs: ['Affliction'], group: 'curse' },
        { id: 'cor', name: 'Curse of Recklessness', category: 'debuffs', class: 'WARLOCK', preferSpecs: [], group: 'curse',
          caution: '−800 armor but +136 melee AP on the boss. Clear this row on enrage or AP-scaling fights.' },
        // The value here is Improved Seal of the Crusader (Ret tier 2): +3% crit to all
        // attacks on the target. Untalented it is worth nothing, so one Ret beats three bodies.
        // Ordered before jow: judgements are one-per-paladin, so the Ret must be claimed
        // for JoC before the generic judgements can swallow them.
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', requireSpec: 'Retribution', group: 'judgement',
          applicableWhen: roster => roster.some(p => p.class === 'PALADIN' && p.spec === 'Retribution') },
        // Ret keeps Seal of Blood/Command for its own damage; the support paladins judge at
        // pull, and any Ret's Crusader Strike then refreshes every paladin's judgement.
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        // Improved Faerie Fire (+3% melee/ranged hit) is Balance-only, but the 610 armor
        // applies regardless — so keep the duty and rank Feral above Resto, who would
        // otherwise spend a GCD and mana they would rather heal with.
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance', 'Feral'] },
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'] },
        // Fire Vulnerability is +3% fire damage taken per stack, not spell crit (that is
        // WotLK), and the fire mage maintains it through their own rotation. Low priority.
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire' },
        // A maintained 5-stack debuff, not passive coverage. +2% frost crit per stack.
        // Does not conflict with Improved Scorch — different schools entirely.
        { id: 'wc', name: "Winter's Chill", category: 'debuffs', class: 'MAGE', requireSpec: 'Frost' },
        // Strongest applies, they do not stack. Talented, Demo Shout and CoW tie at -420;
        // untalented, CoW (-350) actually beats Demo Shout (-300). Talent picks are invisible
        // to the addon, so this order is a spec-level guess the override exists to correct.
        { id: 'ap', name: 'Attack power reduction', category: 'debuffs', providers: [
            { name: 'Demoralizing Shout', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'] },
            { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
            { name: 'Demoralizing Roar', class: 'DRUID', preferSpecs: ['Feral'] },
            { name: 'Screech (pet)', class: 'HUNTER', preferSpecs: ['Beast Mastery'] },
        ] },
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
                  requireSpec: entry.requireSpec, group: entry.group, caution: entry.caution }];
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
        { name: 'Mangle', class: 'DRUID', spec: 'Feral' },
        { name: 'Expose Weakness', class: 'HUNTER', spec: 'Survival' },
    ];

    function specRank(p, entry) {
        const i = (entry.preferSpecs || []).indexOf(p.spec);
        return i === -1 ? 99 : i;
    }

    function rankPool(pool, entry, dutyCount) {
        return pool.slice().sort((a, b) => {
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
            if (entry.requireSpec && p.spec !== entry.requireSpec) return false;
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
            for (let i = 0; i < provs.length; i++) {
                const prov = Object.assign({}, provs[i], { id: entry.id, category: entry.category });
                const pool = rankPool(roster.filter(p => eligible(p, prov)), prov, dutyCount);
                if (pool.length) { record(prov, prov.name, pool[0]); return; }
            }
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

        const passives = PASSIVES.map(ps => {
            const p = roster.find(x => x.class === ps.class && (!ps.spec || x.spec === ps.spec));
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
                lines.push(s);
            });
            lines.push('');
        });
        if (sheet.cc && sheet.cc.length) {
            lines.push('**Crowd Control**');
            sheet.cc.filter(c => c.player).forEach(c => {
                lines.push(MARK_EMOJI[c.mark] + ' ' + capitalize(c.mark) + ' ' + ccAbilityName(c.ability) + ' — ' + nm(c.player));
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
            case 'DRUID':   return s === 'Restoration' ? 'healers' : (s === 'Balance' ? 'casters' : 'melee');
            case 'PRIEST':  return s === 'Shadow' ? 'casters' : 'healers';
            case 'SHAMAN':  return s === 'Restoration' ? 'healers' : (s === 'Elemental' ? 'casters' : 'melee');
            case 'ROGUE':   return 'melee';
            case 'HUNTER':  return 'ranged';
            default:        return 'casters';
        }
    }

    // Scarcity order: this is both the order groups are created for a short roster and the
    // order a limited number of shamans is spent. Windfury/Strength of Earth on melee is the
    // largest single delta; Totem of Wrath's spell hit is next; tanks gain least.
    const GROUP_ROLES = ['melee', 'casters', 'healers', 'ranged', 'tanks'];
    const SHAMAN_ROLE = { Enhancement: 'melee', Elemental: 'casters', Restoration: 'healers' };
    const GROUP_CAP = 5;

    // Within a role, place the players whose buffs are party-scoped first — they are the
    // reason the group exists, so they must not be crowded out by a filler DPS.
    function anchorScore(p) {
        if (p.class === 'WARRIOR' && p.spec !== 'Protection') return 0; // Battle Shout
        if (p.class === 'DRUID' && p.spec === 'Feral') return 0;        // Leader of the Pack
        if (p.class === 'DRUID' && p.spec === 'Balance') return 0;      // Moonkin Aura
        if (p.class === 'PRIEST' && p.spec === 'Shadow') return 0;      // Vampiric Touch
        if (p.class === 'HUNTER' && p.spec === 'Beast Mastery') return 0; // Ferocious Inspiration
        if (p.class === 'PALADIN') return 1;                            // an aura, any group
        return 2;
    }

    function proposeGroups(roster) {
        const n = roster.length;
        const groupCount = n ? Math.min(5, Math.ceil(n / GROUP_CAP)) : 0;
        const groups = GROUP_ROLES.slice(0, groupCount).map(role => ({ role, players: [] }));
        const byRole = {};
        groups.forEach(g => { byRole[g.role] = g; });
        const placed = new Set();

        function place(p, g) {
            if (!g || placed.has(p.name) || g.players.length >= GROUP_CAP) return false;
            g.players.push(p);
            placed.add(p.name);
            return true;
        }

        // 1. Shamans seed first — one per group, spec-matched, then spare shamans spread out.
        const shamans = roster.filter(p => p.class === 'SHAMAN');
        shamans.forEach(sh => place(sh, byRole[SHAMAN_ROLE[sh.spec]]));
        shamans.filter(p => !placed.has(p.name)).forEach(sh => {
            place(sh, groups.find(g => !g.players.some(x => x.class === 'SHAMAN') && g.players.length < GROUP_CAP));
        });

        // 2. Fill each group from its own bucket, anchors first.
        groups.forEach(g => {
            roster.filter(p => !placed.has(p.name) && bucketOf(p) === g.role)
                .sort((a, b) => anchorScore(a) - anchorScore(b) || a.name.localeCompare(b.name))
                .forEach(p => place(p, g));
        });

        // 3. Overflow: whoever is left goes wherever there is room, fullest-first so we do
        //    not scatter three leftovers across three otherwise-clean groups.
        const unplaced = [];
        roster.filter(p => !placed.has(p.name)).forEach(p => {
            const g = groups.filter(g => g.players.length < GROUP_CAP)
                .sort((a, b) => b.players.length - a.players.length)[0];
            if (!place(p, g)) unplaced.push(p);
        });

        return { groups, unplaced };
    }

    return {
        SPEC_TREES, CLASS_COLORS,
        inferSpec, parseAddonExport, parseRaidHelper, mergeRosters,
        DEBUFF_CATALOG, PASSIVES, autoAssign, missingList, providersOf,
        CC_ABILITIES, MARKS, MARK_EMOJI, defaultCC,
        buildDiscord, buildRaidLines, buildWhispers, buildAddonWhispers,
        bucketOf, proposeGroups,
    };
}));
