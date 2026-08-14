(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.WclMult = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Verified live 2026-08-14 against WCL API v2: zone 1056 is the Anniversary SSC/TK tier.
    // 1010 is the 2021 TBC Classic tier and 1052 is Titan Reforged — both are wrong here, and
    // worldData.zones is stale and never lists 1056, so it must be addressed by id.
    const DEFAULT_ZONE = 1056;

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

    function shouldOverwrite(meta) {
        if (!meta || typeof meta.mult !== 'number') return true;
        if (typeof meta.multAuto === 'number') return meta.mult === meta.multAuto;
        return meta.mult === 1;
    }

    function median(xs) {
        if (!xs.length) return null;
        const s = xs.slice().sort((a, b) => a - b);
        const n = s.length;
        return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }

    const WINDOW_MS = 28 * 24 * 3600 * 1000;   // spec §2: the last 4 weeks
    const MIN_PLAYERS_PER_BOSS = 3;            // spec §2: below this the boss scale is noise

    // One player's median parse per boss, after the window and same-spec filters. A boss the
    // player never qualified on is absent rather than zero — callers distinguish the two.
    function playerBossMedians(opts) {
        const windowMs = opts.windowMs || WINDOW_MS;
        const ranks = opts.ranksByEncounter || {};
        const out = {};
        Object.keys(ranks).forEach(function (encId) {
            const amounts = (ranks[encId] || [])
                .filter(r => r && typeof r.amount === 'number' && typeof r.startTime === 'number')
                .filter(r => opts.nowMs - r.startTime <= windowMs)
                .filter(r => specNameToKey(opts.classKey, r.spec) === opts.specKey)
                .map(r => r.amount);
            const m = median(amounts);
            if (m !== null && m > 0) out[encId] = m;
        });
        return out;
    }

    // spec §2. Three passes: each player's per-boss median; one scale per boss fitted from the
    // roster; then every player's ratio against that scale, averaged over their bosses.
    function computeRosterMults(opts) {
        const windowMs = opts.windowMs || WINDOW_MS;
        const minPlayers = opts.minPlayersPerBoss || MIN_PLAYERS_PER_BOSS;
        const entries = (opts.players || [])
            .filter(p => p && p.baseline > 0)
            .map(p => ({
                name: p.name,
                baseline: p.baseline,
                medians: playerBossMedians({
                    ranksByEncounter: p.ranksByEncounter, classKey: p.classKey,
                    specKey: p.specKey, nowMs: opts.nowMs, windowMs: windowMs,
                }),
            }));

        // The scale absorbs whatever the fight itself contributes — length, adds, target count,
        // the raid's gear on the night — so a ratio compares players and not encounters. Median
        // rather than mean: one hero parse must not redefine the boss for everyone else.
        const scaleByBoss = {};
        const bosses = {};
        entries.forEach(e => Object.keys(e.medians).forEach(b => { bosses[b] = true; }));
        Object.keys(bosses).forEach(function (b) {
            const index = entries.filter(e => e.medians[b] > 0).map(e => e.medians[b] / e.baseline);
            if (index.length < minPlayers) return;
            const c = median(index);
            if (c > 0) scaleByBoss[b] = c;
        });

        const out = {};
        entries.forEach(function (e) {
            const ratios = Object.keys(e.medians)
                .filter(b => scaleByBoss[b] > 0)
                .map(b => e.medians[b] / (e.baseline * scaleByBoss[b]));
            if (!ratios.length) return;
            const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
            out[e.name] = {
                mult: Math.min(2, Math.max(0.5, Math.round(mean * 100) / 100)),
                bosses: ratios.length,
            };
        });
        return out;
    }

    return { DEFAULT_ZONE, specNameToKey, shouldOverwrite, playerBossMedians, computeRosterMults };
}));
