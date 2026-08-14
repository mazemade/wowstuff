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

    function computeMult(opts) {
        const windowMs = opts.windowMs || 28 * 24 * 3600 * 1000;
        const medians = opts.mediansByEncounter || {};
        const ratios = [];
        Object.keys(medians).forEach(function (encId) {
            const specMedian = medians[encId] && medians[encId][opts.specKey];
            if (!(specMedian > 0)) return;
            const amounts = ((opts.ranksByEncounter || {})[encId] || [])
                .filter(r => r && typeof r.amount === 'number' && typeof r.startTime === 'number')
                .filter(r => opts.nowMs - r.startTime <= windowMs)
                .filter(r => specNameToKey(opts.classKey, r.spec) === opts.specKey)
                .map(r => r.amount);
            const m = median(amounts);
            if (m !== null) ratios.push(m / specMedian);
        });
        if (!ratios.length) return null;
        const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const mult = Math.min(2, Math.max(0.5, Math.round(mean * 100) / 100));
        return { mult, bosses: ratios.length };
    }

    return { DEFAULT_ZONE, specNameToKey, shouldOverwrite, computeMult };
}));
