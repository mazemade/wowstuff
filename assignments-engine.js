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
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
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
            players.push({ name, class: cls, spec, flags, source: 'addon' });
        });
        return { players, errors };
    }

    const RH_STATUS_CLASSES = ['Bench', 'Late', 'Tentative', 'Absence'];
    const RH_CLASS_NAMES = {
        Warrior: 'WARRIOR', Paladin: 'PALADIN', Hunter: 'HUNTER', Rogue: 'ROGUE',
        Priest: 'PRIEST', Shaman: 'SHAMAN', Mage: 'MAGE', Warlock: 'WARLOCK', Druid: 'DRUID',
    };
    const RH_SPEC_ALIASES = { Beastmastery: 'Beast Mastery', Guardian: 'Feral' };

    function parseRaidHelper(eventJson) {
        const players = [];
        const excluded = [];
        const errors = [];
        const signUps = (eventJson && eventJson.signUps) || [];
        if (!Array.isArray(signUps) || !signUps.length) {
            errors.push('No signups found in event');
            return { players, excluded, errors, title: (eventJson && eventJson.title) || '' };
        }
        signUps.forEach(su => {
            const rawClass = su.className || '';
            if (RH_STATUS_CLASSES.includes(rawClass)) { excluded.push({ name: su.name, reason: rawClass }); return; }
            if (su.status && su.status !== 'primary') { excluded.push({ name: su.name, reason: su.status }); return; }
            const cls = RH_CLASS_NAMES[rawClass];
            if (!cls) { errors.push('Unknown class "' + rawClass + '" for ' + su.name); return; }
            let spec = (su.specName || '').replace(/\d+$/, '');
            spec = RH_SPEC_ALIASES[spec] || spec;
            const flags = [];
            if (!SPEC_TREES[cls].includes(spec)) { spec = null; flags.push('spec-unknown'); }
            players.push({
                name: su.name, class: cls, spec,
                discordId: su.userId !== undefined && su.userId !== null ? String(su.userId) : null,
                flags, source: 'raidhelper',
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
        { id: 'sunder', name: 'Sunder Armor', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Protection'] },
        { id: 'coe', name: 'Curse of Elements', category: 'debuffs', class: 'WARLOCK', preferSpecs: ['Affliction'], group: 'curse' },
        { id: 'cor', name: 'Curse of Recklessness', category: 'debuffs', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Retribution'], group: 'judgement' },
        { id: 'jol', name: 'Judgement of Light', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', preferSpecs: [], group: 'judgement', minClassCount: 3 },
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire' },
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance'] },
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'] },
        { id: 'demo', name: 'Demoralizing Shout', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'],
          fallback: { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' } },
    ];

    const CC_ABILITIES = [
        { id: 'polymorph', name: 'Polymorph', class: 'MAGE' },
        { id: 'sap', name: 'Sap', class: 'ROGUE' },
        { id: 'trap', name: 'Freezing Trap', class: 'HUNTER' },
        { id: 'banish', name: 'Banish', class: 'WARLOCK' },
        { id: 'shackle', name: 'Shackle Undead', class: 'PRIEST' },
        { id: 'hibernate', name: 'Hibernate', class: 'DRUID' },
    ];
    const MARKS = ['skull', 'cross', 'square', 'moon', 'triangle', 'diamond', 'circle', 'star'];
    const MARK_EMOJI = { skull: '💀', cross: '❌', square: '🟦', moon: '🌙', triangle: '🔺', diamond: '💎', circle: '🟠', star: '⭐' };

    function defaultCC(roster) {
        const mages = roster.filter(p => p.class === 'MAGE');
        const rogues = roster.filter(p => p.class === 'ROGUE');
        const cc = [];
        if (mages[0]) cc.push({ mark: 'moon', ability: 'polymorph', player: mages[0].name });
        if (mages[1]) cc.push({ mark: 'triangle', ability: 'polymorph', player: mages[1].name });
        if (rogues[0]) cc.push({ mark: 'square', ability: 'sap', player: rogues[0].name });
        return cc;
    }

    const PASSIVES = [
        { name: 'Misery', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Shadow Weaving', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Improved Shadow Bolt', class: 'WARLOCK', spec: 'Destruction' },
        { name: 'Blood Frenzy', class: 'WARRIOR', spec: 'Arms' },
        { name: 'Mangle', class: 'DRUID', spec: 'Feral' },
        { name: 'Expose Weakness', class: 'HUNTER', spec: 'Survival' },
        { name: "Winter's Chill", class: 'MAGE', spec: 'Frost' },
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
        const uncovered = [];
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
            duties.push(d);
            if (player) {
                dutyCount[player.name] = (dutyCount[player.name] || 0) + 1;
                if (entry.group) groupUsed[entry.group + ':' + player.name] = true;
            }
        }

        DEBUFF_CATALOG.forEach(entry => {
            if (entry.minClassCount && roster.filter(p => p.class === entry.class).length < entry.minClassCount) return;
            const o = overrides[entry.id] || {};
            if (o.player && byName[o.player]) {
                const chosen = byName[o.player];
                const useFb = entry.fallback && chosen.class === entry.fallback.class;
                const eff = useFb ? Object.assign({}, entry.fallback, { id: entry.id, category: entry.category }) : entry;
                record(eff, eff.name, chosen);
                return;
            }
            if (isExplicitlyUnassigned(o)) { record(entry, entry.name, null); uncovered.push({ id: entry.id, name: entry.name }); return; }
            let pool = rankPool(roster.filter(p => eligible(p, entry)), entry, dutyCount);
            if (pool.length) { record(entry, entry.name, pool[0]); return; }
            if (entry.fallback) {
                const fb = Object.assign({}, entry.fallback, { id: entry.id, category: entry.category });
                pool = rankPool(roster.filter(p => eligible(p, fb)), fb, dutyCount);
                if (pool.length) { record(fb, fb.name, pool[0]); return; }
            }
            uncovered.push({ id: entry.id, name: entry.name });
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
        if (sheet.uncovered && sheet.uncovered.length) {
            lines.push('⚠ **Uncovered:** ' + sheet.uncovered.map(u => u.name).join(', '));
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

    function buildWhispers(roster, sheet) {
        const per = {};
        const add = (name, txt) => { (per[name] = per[name] || []).push(txt); };
        sheet.duties.filter(d => d.player).forEach(d => {
            add(d.player, d.name + (d.target ? ' on ' + displayTarget(d.target) : ''));
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            add(c.player, ccAbilityName(c.ability) + ' on {' + c.mark + '}');
        });
        return Object.keys(per).map(n => '/w ' + n + ' Your assignments: ' + per[n].join('; '));
    }

    return {
        SPEC_TREES, CLASS_COLORS,
        inferSpec, parseAddonExport, parseRaidHelper, mergeRosters,
        DEBUFF_CATALOG, PASSIVES, autoAssign,
        CC_ABILITIES, MARKS, MARK_EMOJI, defaultCC,
        buildDiscord, buildRaidLines, buildWhispers,
    };
}));
