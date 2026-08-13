#!/usr/bin/env node
// Sims the model's chosen layout and its alternates as FULL raids, and reports whether the
// sim agrees with the model's ranking.
//
// Usage: node sim-verify.mjs ssc-roster.json [iterations]
//
// The point is to check the surrogate, so the parties are built from real providers with the
// proto buff flags zeroed: whatever a group "buys" has to come from the players actually
// sitting in it. Disagreement is spec §8's trigger to revisit per-player gear inputs — it is
// NOT a licence to tune weights by hand.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const E = require('../assignments-engine.js');
const here = p => new URL(p, import.meta.url);

const roster = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const iterations = parseInt(process.argv[3] || '5000', 10);
mkdirSync(here('./out/'), { recursive: true });

const profileFor = p => {
    const f = here(`./out/profiles/${p.class}_${(p.spec || '').replace(/ /g, '_')}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; // healers: none, simmed as absent
};

const RAID_BUFFS = {
    arcaneBrilliance: true, giftOfTheWild: 'TristateEffectImproved', divineSpirit: 'TristateEffectImproved',
    powerWordFortitude: 'TristateEffectImproved', shadowProtection: true, thorns: 'TristateEffectImproved',
    bloodlust: true,
};
const DEBUFFS = {
    judgementOfWisdom: true, curseOfElements: 'TristateEffectImproved', misery: true, sunderArmor: true,
    faerieFire: 'TristateEffectImproved', improvedScorch: true, bloodFrenzy: true,
    huntersMark: 'TristateEffectImproved', exposeWeaknessUptime: 1, exposeWeaknessHunterAgility: 800,
};

function simLayout(groups, label) {
    const parties = groups.map(g => ({
        players: g.players.map(p => {
            const prof = profileFor(p);
            if (!prof) return null;
            const pl = JSON.parse(JSON.stringify(prof.player));
            pl.name = p.name;
            pl.buffs = { blessingOfKings: true, blessingOfWisdom: 'TristateEffectImproved', blessingOfMight: 'TristateEffectImproved' };
            return pl;
        }).filter(Boolean),
        buffs: {}, // real providers only — every proto buff bot stays OFF
    })).filter(pt => pt.players.length);

    const req = {
        raid: { parties, buffs: RAID_BUFFS, debuffs: DEBUFFS, tanks: [] },
        encounter: {
            duration: 180, durationVariation: 0,
            targets: [{ level: 73, mobType: 'MobTypeDemon', stats: [], swingSpeed: 2, minBaseDamage: 4000 }],
        },
        simOptions: { iterations, randomSeed: '42' },
    };
    const inPath = here(`./out/verify_${label}.json`).pathname;
    writeFileSync(inPath, JSON.stringify(req, null, 1));
    const out = JSON.parse(execFileSync(here('./vendor/wowsimcli').pathname, ['sim', '--infile', inPath],
        { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
    if (out.error) throw new Error(label + ': ' + out.error.message.split('\n')[0]);
    return out.raidMetrics.parties.reduce((s, pt) =>
        s + pt.players.reduce((s2, pl) => s2 + pl.dps.avg, 0), 0);
}

const res = E.proposeGroups(roster);
const rows = [];
console.log(`model layout: ${Math.round(res.score)} model-DPS, violations ${res.violations}; simming at ${iterations} iterations...`);
const bestSim = simLayout(res.groups, 'best');
rows.push({ label: 'model best', modelPct: 0, sim: bestSim });
console.log(`  model best -> ${Math.round(bestSim)} raid DPS (sim)`);

for (let i = 0; i < res.alternates.length; i++) {
    const alt = res.alternates[i];
    const names = alt.change.split(' ↔ ');
    if (names.length !== 2) {
        console.log(`  skipping move-type alternate "${alt.change}" (this script sims swaps only)`);
        continue;
    }
    const copy = res.groups.map(g => ({ role: g.role, players: g.players.slice() }));
    const find = n => {
        for (const g of copy) {
            const j = g.players.findIndex(p => p.name === n);
            if (j !== -1) return [g, j];
        }
        return null;
    };
    const a = find(names[0]), b = find(names[1]);
    if (!a || !b) { console.log(`  could not locate ${alt.change}`); continue; }
    const t = a[0].players[a[1]];
    a[0].players[a[1]] = b[0].players[b[1]];
    b[0].players[b[1]] = t;
    const s = simLayout(copy, 'alt' + i);
    rows.push({ label: `alt ${i + 1} (${alt.change})`, modelPct: alt.deltaPct, sim: s });
    console.log(`  alt ${i + 1} (${alt.change}, model ${alt.deltaPct.toFixed(2)}%) -> ${Math.round(s)} raid DPS (sim)`);
}

// Agreement: the sim must not rank an alternate ABOVE the model's pick by more than sim noise
// (~0.3% at 5000 iterations). Anything larger is the spec §8 trigger, not a rounding artifact.
const NOISE_PCT = 0.3;
let verdict = 'AGREES';
for (const r of rows.slice(1)) {
    const simPct = (r.sim - bestSim) / bestSim * 100;
    console.log(`  ${r.label}: model ${r.modelPct.toFixed(2)}% vs sim ${simPct.toFixed(2)}%`);
    if (simPct > NOISE_PCT) verdict = 'DISAGREES';
}
console.log(`\nVERDICT: the sim ${verdict} with the model's ranking (noise allowance ${NOISE_PCT}%).`);
if (verdict === 'DISAGREES') {
    console.log('Per spec §8 this is the trigger to revisit per-player gear inputs — record it and stop.');
    process.exitCode = 1;
}
