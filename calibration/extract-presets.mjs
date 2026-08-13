#!/usr/bin/env node
// Pulls each spec's UI preset out of the pinned wowsims checkout: consumables, talent
// strings, race, professions and distance-from-target.
//
// These are the same values the hosted UI loads when you pick a spec and its preset — i.e.
// exactly what a share link would carry — so reading them here gives the plan's intended
// profile without a manual capture and without the proto-vintage risk that decoding a
// hosted link would carry (a link is base64(zlib(protobuf)); it only decodes correctly if
// the site's field numbers match this checkout's).
//
// A small regex reader rather than a TS toolchain: the repo ships no esbuild, and these are
// flat literals of `key: number | boolean`. The one wrinkle is a single level of object
// spread (warrior/dps and warrior/protection spread ui/warrior/presets.ts), resolved below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const REPO = new URL('./vendor/tbc-new/', import.meta.url);
const read = rel => readFileSync(new URL(rel, REPO), 'utf8');

// Grab `export const <name> = <Ctor>.create({ ... });` or `export const <name> = { ... };`
function block(src, name) {
    // `export const X = {` and `export const X: Partial<T> = {` both occur.
    const m = new RegExp(`export const ${name}\\s*(:[^=]+)?=`).exec(src);
    if (!m) return null;
    const start = m.index;
    const open = src.indexOf('{', start);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(open + 1, i);
        }
    }
    return null;
}

const stripComments = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// Flat `key: value` pairs. Values are numbers, booleans, `undefined`, or Enum.Member
// (kept as the member name — the Go side maps the handful it needs).
function fields(body) {
    // Race comes from each spec's Go test fixture rather than its UI preset, deliberately.
// Two reasons: several presets omit race entirely, and the Elemental preset is Draenei —
// which would silently corrupt the Heroic/Inspiring Presence marginals, because a Draenei
// player carries the racial whether or not the PartyBuffs flag under test is set. Every
// race below is the one the repo's own sim tests use, and none of them is Draenei.
const RACE = {
    'HUNTER:Beast Mastery': 'RaceOrc', 'HUNTER:Survival': 'RaceOrc', 'HUNTER:Marksmanship': 'RaceOrc',
    'WARRIOR:Fury': 'RaceOrc', 'WARRIOR:Arms': 'RaceOrc', 'WARRIOR:Protection': 'RaceOrc',
    'PALADIN:Retribution': 'RaceBloodElf', 'PALADIN:Protection': 'RaceBloodElf',
    'ROGUE:Combat': 'RaceHuman', 'PRIEST:Shadow': 'RaceTroll',
    'SHAMAN:Elemental': 'RaceTroll', 'SHAMAN:Enhancement': 'RaceTroll',
    'MAGE:Arcane': 'RaceTroll', 'WARLOCK:Destruction': 'RaceOrc', 'WARLOCK:Affliction': 'RaceOrc', 'WARLOCK:Demonology': 'RaceOrc',
    'DRUID:Balance': 'RaceNightElf', 'DRUID:Feral': 'RaceNightElf', 'DRUID:Guardian': 'RaceNightElf',
};

const out = {};
    for (const line of stripComments(body).split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(.+?),?\s*$/);
        if (!m) continue;
        const [, k, raw] = m;
        const v = raw.trim().replace(/,$/, '');
        if (v === 'true') out[k] = true;
        else if (v === 'false') out[k] = false;
        else if (v === 'undefined') out[k] = null;
        else if (/^-?\d+$/.test(v)) out[k] = parseInt(v, 10);
        else if (/^[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(v)) out[k] = v.split('.')[1];
    }
    return out;
}

function spreads(body) {
    return [...stripComments(body).matchAll(/\.\.\.\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/g)]
        .map(m => ({ ns: m[1], name: m[2] }));
}

// Resolve `import * as X from '...'` so a spread can be followed one level up.
function importPath(src, ns, fromDir) {
    const m = src.match(new RegExp(`import\\s+\\*\\s+as\\s+${ns}\\s+from\\s+'([^']+)'`));
    if (!m) return null;
    const rel = m[1].replace(/^\.\//, '');
    const joined = new URL(rel + '.ts', new URL(fromDir + '/', REPO));
    return existsSync(joined) ? joined : null;
}

function consumables(dir) {
    const file = dir + '/presets.ts';
    const src = read(file);
    const body = block(src, 'DefaultConsumables');
    if (!body) return {};
    let base = {};
    for (const { ns, name } of spreads(body)) {
        const p = importPath(src, ns, dir);
        if (p) {
            const parentBody = block(readFileSync(p, 'utf8'), name);
            if (parentBody) base = Object.assign(base, fields(parentBody));
        }
    }
    return Object.assign(base, fields(body));
}

function talentString(dir, constName) {
    const body = block(read(dir + '/presets.ts'), constName);
    if (!body) return null;
    const m = stripComments(body).match(/talentsString:\s*'([^']*)'/);
    return m ? m[1] : null;
}

// dir = the spec's UI directory; talents = the preset const holding its talent string.
const SPECS = {
    'HUNTER:Beast Mastery': { dir: 'ui/hunter/dps', talents: 'BMTalents' },
    'HUNTER:Survival': { dir: 'ui/hunter/dps', talents: 'SVTalents' },
    'WARRIOR:Fury': { dir: 'ui/warrior/dps', talents: 'FuryTalents' },
    'WARRIOR:Arms': { dir: 'ui/warrior/dps', talents: 'ArmsTalents' },
    'WARRIOR:Protection': { dir: 'ui/warrior/protection', talents: 'DefaultTalents' },
    'PALADIN:Retribution': { dir: 'ui/paladin/retribution', talents: 'DefaultTalents' },
    'PALADIN:Protection': { dir: 'ui/paladin/protection', talents: 'DefaultTalents' },
    'ROGUE:Combat': { dir: 'ui/rogue/dps', talents: 'Talents' },
    'PRIEST:Shadow': { dir: 'ui/priest/dps', talents: 'StandardTalents' },
    'SHAMAN:Elemental': { dir: 'ui/shaman/elemental', talents: 'StandardTalents' },
    'SHAMAN:Enhancement': { dir: 'ui/shaman/enhancement', talents: 'SubRestoIWT' },
    'MAGE:Arcane': { dir: 'ui/mage/dps', talents: 'ARCANE_TALENTS' },
    'WARLOCK:Destruction': { dir: 'ui/warlock/dps', talents: 'TalentsDestruction' },
    'WARLOCK:Affliction': { dir: 'ui/warlock/dps', talents: 'TalentsAffliction' },
    'WARLOCK:Demonology': { dir: 'ui/warlock/dps', talents: 'TalentsDemoFelguard' },
    'DRUID:Balance': { dir: 'ui/druid/balance', talents: 'StandardTalents' },
    'DRUID:Feral': { dir: 'ui/druid/feralcat', talents: 'StandardTalents' },
    'DRUID:Guardian': { dir: 'ui/druid/feralbear', talents: 'StandardTalents' },
};

// Race comes from each spec's Go test fixture rather than its UI preset, deliberately.
// Two reasons: several presets omit race entirely, and the Elemental preset is Draenei —
// which would silently corrupt the Heroic/Inspiring Presence marginals, because a Draenei
// player carries the racial whether or not the PartyBuffs flag under test is set. Every
// race below is the one the repo's own sim tests use, and none of them is Draenei.
const RACE = {
    'HUNTER:Beast Mastery': 'RaceOrc', 'HUNTER:Survival': 'RaceOrc', 'HUNTER:Marksmanship': 'RaceOrc',
    'WARRIOR:Fury': 'RaceOrc', 'WARRIOR:Arms': 'RaceOrc', 'WARRIOR:Protection': 'RaceOrc',
    'PALADIN:Retribution': 'RaceBloodElf', 'PALADIN:Protection': 'RaceBloodElf',
    'ROGUE:Combat': 'RaceHuman', 'PRIEST:Shadow': 'RaceTroll',
    'SHAMAN:Elemental': 'RaceTroll', 'SHAMAN:Enhancement': 'RaceTroll',
    'MAGE:Arcane': 'RaceTroll', 'WARLOCK:Destruction': 'RaceOrc', 'WARLOCK:Affliction': 'RaceOrc', 'WARLOCK:Demonology': 'RaceOrc',
    'DRUID:Balance': 'RaceNightElf', 'DRUID:Feral': 'RaceNightElf', 'DRUID:Guardian': 'RaceNightElf',
};

const out = {};
for (const [key, { dir, talents }] of Object.entries(SPECS)) {
    const other = fields(block(read(dir + '/presets.ts'), 'OtherDefaults') || '');
    out[key] = {
        dir,
        consumables: consumables(dir),
        talentsConst: talents,
        talents: talentString(dir, talents),
        race: RACE[key],
        presetRace: other.race || null,
        profession1: other.profession1 || null,
        profession2: other.profession2 || null,
        distanceFromTarget: typeof other.distanceFromTarget === 'number' ? other.distanceFromTarget : 0,
    };
}

writeFileSync(new URL('./presets.json', import.meta.url), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
    console.log(`${k}: talents=${v.talents ? 'ok' : 'MISSING(' + v.talentsConst + ')'} race=${v.race} consumables=${Object.keys(v.consumables).length}`);
}
