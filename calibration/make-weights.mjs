#!/usr/bin/env node
// Turns raw sim results into the engine's tables: v = baseline/without − 1 per (spec, buff).
//
// Usage: node make-weights.mjs <date>   e.g. node make-weights.mjs 2026-08-13
// The date is an argument rather than Date.now() so a rerun reproduces byte-identical output.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = p => new URL(p, import.meta.url);
const results = JSON.parse(readFileSync(here('./out/results.json'), 'utf8'));

// Sim noise floor. At 10000 iterations a true-zero buff still wanders a few tenths of a
// percent, and a spurious 0.2% is enough to move a layout. Anything under this is recorded
// as exactly 0 rather than as a small real effect.
const NOISE = 0.002;

// specFile -> specKey. Filenames are CLASS_Spec_Name; a class never contains '_', so the
// FIRST underscore is the separator and the rest are spaces. Verified on HUNTER_Beast_Mastery.
function specKeyOf(specFile) {
    const i = specFile.indexOf('_');
    return specFile.slice(0, i) + ':' + specFile.slice(i + 1).replace(/_/g, ' ');
}

const baselines = {}, buffs = {}, floors = [];
for (const key of Object.keys(results)) {
    const [specFile, buffFile] = key.split('__');
    if (buffFile !== 'BASELINE') continue;
    const specKey = specKeyOf(specFile);
    baselines[specKey] = Math.round(results[key].dps);
    if (results[key].tps != null) {
        floors.push({ specKey, dps: results[key].dps, tps: results[key].tps, dtps: results[key].dtps });
    }
}

// Clamped negatives, reported rather than hidden. A TBC party buff cannot reduce your
// throughput, so v < 0 is by definition a sim artifact — the known one is Windfury Totem on
// pure casters (~-2%), where wowsims' WindfuryTotemAura registers a periodic action every 5s
// regardless of class and perturbs a caster's cast scheduling. Windfury procs off melee
// auto-attacks and cannot touch a mage. Max ruled 2026-08-13: clamp to 0, log what was
// clamped. (Irrelevant buffs like Grace of Air measure exactly 0.00% for the same specs, so
// this is systematic, not noise.)
const clamped = [];
for (const key of Object.keys(results)) {
    const [specFile, buffFile] = key.split('__');
    if (buffFile === 'BASELINE') continue;
    const specKey = specKeyOf(specFile);
    const buffName = buffFile.replace(/_/g, ' ');
    const base = baselines[specKey];
    const without = results[key].dps;
    if (!base || !without) continue;
    let v = base / without - 1;
    if (v < -NOISE) {
        clamped.push(`${specKey} / ${buffName}: ${(v * 100).toFixed(2)}% -> 0`);
        v = 0;
    }
    (buffs[buffName] = buffs[buffName] || {})[specKey] = Math.abs(v) < NOISE ? 0 : Math.round(v * 1e4) / 1e4;
}

// Drop the zeros: the engine reads `v[specKey] || 0`, so an explicit 0 is noise in the file.
for (const b of Object.keys(buffs)) {
    for (const k of Object.keys(buffs[b])) if (buffs[b][k] === 0) delete buffs[b][k];
}

// Specs wowsims does not model as distinct builds. It ships no gear set, talent preset or
// APL for these, so there is nothing to measure — but leaving them out is NOT safe: the
// engine reads `BASELINE[specKey] || 0`, which would quietly rate an Affliction warlock as
// contributing nothing and park them in the dry group. Each one inherits its nearest simmed
// sibling, recorded here and printed on every run so the substitution never passes for a
// measurement. (Subtlety in particular is a weaker raid spec than Combat; treating them as
// equal OVERSTATES it. Sim it properly if a Subtlety rogue ever joins the roster.)
const SUBSTITUTES = {
    'HUNTER:Marksmanship': 'HUNTER:Survival',
    'ROGUE:Assassination': 'ROGUE:Combat',
    'ROGUE:Subtlety': 'ROGUE:Combat',
    'MAGE:Fire': 'MAGE:Arcane',
    'MAGE:Frost': 'MAGE:Arcane',
};
const substituted = [];
for (const [target, source] of Object.entries(SUBSTITUTES)) {
    if (baselines[target] != null) continue; // it got simmed after all — leave the real number
    if (baselines[source] == null) throw new Error(`substitute source ${source} was never simmed`);
    baselines[target] = baselines[source];
    for (const b of Object.keys(buffs)) {
        if (buffs[b][source] != null) buffs[b][target] = buffs[b][source];
    }
    substituted.push(`${target} <- ${source} (${baselines[target]} dps)`);
}

// Healers have no wowsims sim and no profile. Their baseline is 0 BY DESIGN (spec §1): they
// enter the model through floors, never the objective.
for (const k of ['PRIEST:Holy', 'PRIEST:Discipline', 'PALADIN:Holy', 'SHAMAN:Restoration', 'DRUID:Restoration']) {
    baselines[k] = 0;
}
// Every PARTY_BUFFS row must have a key, even the ones with no DPS component, or the engine's
// BUFF_V lookup would be missing a name the table references.
for (const k of ['Mana Spring Totem', 'Mana Tide Totem']) buffs[k] = buffs[k] || {};

let sha = process.env.WOWSIMS_SHA;
if (!sha) {
    try {
        sha = execFileSync('git', ['-C', here('./vendor/tbc-new').pathname, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { sha = 'see README'; }
}

const weights = {
    meta: {
        wowsimsSha: sha,
        encounter: '180s single target, level 73 demon',
        iterations: 10000,
        date: process.argv[2] || 'set-me',
        noiseFloor: NOISE,
        profileSource: 'ui/<spec>/presets.ts + phase_2 gear_sets, via calibration/dump-profiles',
    },
    baselines,
    buffs,
};
writeFileSync(here('./weights.json'), JSON.stringify(weights, null, 1));

writeFileSync(here('./floors-report.md'),
    '# Tank threat and damage-taken, from the calibration baselines\n\n' +
    'Measured in the same fully-buffed single-player runs that produced the DPS baselines\n' +
    '(180s single target, 10000 iterations). This is the evidence behind spec §2\'s floors:\n' +
    'the threat floor exists because a Protection paladin\'s TPS is driven by spell damage\n' +
    '(Improved Righteous Fury), and the survival floor because DTPS is what a missing shaman\n' +
    'costs a main tank.\n\n' +
    '| Spec | DPS | TPS | DTPS |\n|---|---|---|---|\n' +
    floors.map(f => `| ${f.specKey} | ${Math.round(f.dps)} | ${Math.round(f.tps)} | ${Math.round(f.dtps)} |`).join('\n') +
    '\n');

const nBuffs = Object.keys(buffs).length;
const nVals = Object.values(buffs).reduce((n, o) => n + Object.keys(o).length, 0);
console.log(`weights.json: ${Object.keys(baselines).length} baselines, ${nBuffs} buffs, ${nVals} non-zero values`);
console.log(`floors-report.md: ${floors.length} tank rows`);
if (substituted.length) {
    console.log(`\nSUBSTITUTED ${substituted.length} specs wowsims does not model separately:`);
    substituted.forEach(s => console.log('  ' + s));
}
if (clamped.length) {
    console.log(`\nCLAMPED ${clamped.length} negative marginals to 0 (sim artifacts — see the comment above):`);
    clamped.forEach(s => console.log('  ' + s));
}
