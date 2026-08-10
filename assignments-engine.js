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
        const tokens = (text || '').trim().split(/[\n;]+/).map(t => t.trim()).filter(Boolean);
        tokens.forEach(tok => {
            if (/^RSS\d+$/i.test(tok)) return; // format header
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
            const cls = m[2].toUpperCase();
            if (!SPEC_TREES[cls]) { errors.push('Unknown class in: ' + tok); return; }
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
            players.push({ name: m[1], class: cls, spec, flags, source: 'addon' });
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
        if (!Array.isArray(signUps) || !signUps.length) errors.push('No signups found in event');
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

    return {
        SPEC_TREES, CLASS_COLORS,
        inferSpec, parseAddonExport, parseRaidHelper, mergeRosters,
    };
}));
