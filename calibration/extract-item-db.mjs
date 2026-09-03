#!/usr/bin/env node
// Trims the pinned wowsims item database down to what the vetting page needs and writes it to
// data/tbc-item-db.json, which IS committed. calibration/vendor/ is gitignored, so the server
// must never read db.json directly — a fresh checkout or the Railway deploy would not have it.
//
// Run from the repo root after updating the wowsims checkout:
//   node calibration/extract-item-db.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = new URL('./vendor/tbc-new/assets/database/db.json', import.meta.url);
const OUT = new URL('../data/tbc-item-db.json', import.meta.url);

// wowsims stores stats as a 42-slot array (gems, enchants, socket bonuses) or as an object
// keyed by stat index (items). Both become { index: value } with zeros dropped.
function sparse(stats) {
    const out = {};
    if (Array.isArray(stats)) stats.forEach((v, i) => { if (v) out[i] = v; });
    else if (stats && typeof stats === 'object') Object.keys(stats).forEach(k => { if (stats[k]) out[k] = stats[k]; });
    return out;
}

const db = JSON.parse(readFileSync(SRC, 'utf8'));

const items = db.items
    .filter(i => i.scalingOptions && i.scalingOptions['0'])
    .map(i => {
        const so = i.scalingOptions['0'];
        const o = { id: i.id, name: i.name, type: i.type || 0, ilvl: so.ilvl || 0, quality: i.quality || 0,
                    gemSockets: i.gemSockets || [], socketBonus: sparse(i.socketBonus), stats: sparse(so.stats) };
        if (i.handType) o.handType = i.handType;
        if (i.weaponType) o.weaponType = i.weaponType;
        if (i.rangedWeaponType) o.rangedWeaponType = i.rangedWeaponType;
        return o;
    });
const gems = db.gems.map(g => ({ id: g.id, name: g.name, color: g.color || 0, stats: sparse(g.stats) }));
const enchants = db.enchants.map(e => ({ effectId: e.effectId, name: e.name, type: e.type || 0, stats: sparse(e.stats) }));

const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'wowsims/tbc-new assets/database/db.json',
    items, gems, enchants,
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`wrote ${items.length} items, ${gems.length} gems, ${enchants.length} enchants`);
