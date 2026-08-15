#!/usr/bin/env node
// For each profile: one fully-buffed baseline RaidSimRequest, plus one request per buff with
// only that buff toggled OFF.
//
// Toggling OFF from a fully-buffed baseline (rather than ON from a bare one) is deliberate —
// Battle Shout and Unleashed Rage are both attack power and have diminishing joint value, and
// what the optimizer actually decides is a buff's MARGINAL worth in a realistic party. Each
// request holds exactly one real simmed player, with the buff under test supplied through the
// PartyBuffs / IndividualBuffs proto flags. That is what those fields exist for, and it avoids
// the trap of "removing" a buff by removing its provider, which perturbs far more than the
// one buff.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
function argOf(flag, dflt) {
    const i = args.indexOf(flag);
    return i === -1 ? dflt : args[i + 1];
}
// Spec D1: anchors are simmed one duration at a time. Spec D2: the SP feeding Vampiric
// Touch is a real raid member, not wowsims' 500-dps default — 1150 ≈ the measured Shadow
// unbuffed baseline, which itself moves only ~3% across the anchor range. VT scales
// SUB-linearly in this number (spec F4), which is exactly why it is set here at sim time
// instead of scaled after the fact.
const DURATION = parseInt(argOf('--duration', '200'), 10);
const SP_DPS = parseInt(argOf('--sp-dps', '1150'), 10);

// Verified against vendor/tbc-new/proto/common.proto at the pinned SHA:
// enum TristateEffect { Missing = 0; Regular = 1; Improved = 2 } and
// `int32 ferocious_inspiration` / `int32 totem_of_wrath` / `int32 mana_tide_totems`.
const BASE_PARTY = {
    windfuryTotem: 'TristateEffectImproved',
    graceOfAirTotem: 'TristateEffectImproved',
    wrathOfAirTotem: 'TristateEffectRegular',
    strengthOfEarthTotem: 'TristateEffectImproved',
    totemOfWrath: 1,
    manaSpringTotem: 'TristateEffectRegular',
    manaTideTotems: 1,
    battleShout: 'TristateEffectImproved',
    ferociousInspiration: 1,
    trueshotAura: true,
    moonkinAura: 'TristateEffectRegular',
    leaderOfThePack: 'TristateEffectRegular',
    sanctityAura: 'TristateEffectRegular',
    devotionAura: 'TristateEffectRegular',
    retributionAura: 'TristateEffectRegular',
    concentrationAura: 'TristateEffectRegular',
    draeneiRacialMelee: true,
    draeneiRacialCaster: true,
    // Left OFF on purpose: totemTwisting, because the ENGINE models twisting itself. If the
    // sim twisted too, each air totem's marginal value would be measured inside a twist and
    // the engine would then compound it a second time.
};
const BASE_INDIVIDUAL = { unleashedRage: true, shadowPriestDps: SP_DPS };

// buffName (MUST match the engine's PARTY_BUFFS row names) -> [scope, field, offValue]
const TOGGLES = {
    'Windfury Totem': ['party', 'windfuryTotem', 'TristateEffectMissing'],
    'Grace of Air': ['party', 'graceOfAirTotem', 'TristateEffectMissing'],
    'Wrath of Air': ['party', 'wrathOfAirTotem', 'TristateEffectMissing'],
    'Strength of Earth': ['party', 'strengthOfEarthTotem', 'TristateEffectMissing'],
    'Totem of Wrath': ['party', 'totemOfWrath', 0],
    'Mana Spring Totem': ['party', 'manaSpringTotem', 'TristateEffectMissing'],
    'Mana Tide Totem': ['party', 'manaTideTotems', 0],
    'Battle Shout': ['party', 'battleShout', 'TristateEffectMissing'],
    'Ferocious Inspiration': ['party', 'ferociousInspiration', 0],
    'Trueshot Aura': ['party', 'trueshotAura', false],
    'Moonkin Aura': ['party', 'moonkinAura', 'TristateEffectMissing'],
    'Leader of the Pack': ['party', 'leaderOfThePack', 'TristateEffectMissing'],
    'Sanctity Aura': ['party', 'sanctityAura', 'TristateEffectMissing'],
    'Devotion Aura': ['party', 'devotionAura', 'TristateEffectMissing'],
    'Retribution Aura': ['party', 'retributionAura', 'TristateEffectMissing'],
    'Concentration Aura': ['party', 'concentrationAura', 'TristateEffectMissing'],
    'Heroic Presence': ['party', 'draeneiRacialMelee', false],
    'Inspiring Presence': ['party', 'draeneiRacialCaster', false],
    'Unleashed Rage': ['individual', 'unleashedRage', false],
    'Vampiric Touch': ['individual', 'shadowPriestDps', 0],
};

// Every party-scoped effect switched off, for the unbuffed baseline.
const ALL_PARTY_OFF = Object.fromEntries(Object.keys(BASE_PARTY).map(k => {
    const v = BASE_PARTY[k];
    return [k, typeof v === 'number' ? 0 : (typeof v === 'boolean' ? false : 'TristateEffectMissing')];
}));
const ALL_INDIVIDUAL_OFF = { unleashedRage: false, shadowPriestDps: 0 };

const here = p => new URL(p, import.meta.url);

// Raid-wide buffs and target debuffs are held CONSTANT across every request. They are not
// what the optimizer chooses between (Bloodlust is raid-wide on Anniversary, debuffs are
// applied to the target, not the party), but leaving them off would measure every party buff
// against an unrealistically weak character.
const RAID_BUFFS = {
    arcaneBrilliance: true, giftOfTheWild: 'TristateEffectImproved', divineSpirit: 'TristateEffectImproved',
    powerWordFortitude: 'TristateEffectImproved', shadowProtection: true, thorns: 'TristateEffectImproved',
    bloodlust: true,
};
const DEBUFFS = {
    judgementOfWisdom: true, curseOfElements: 'TristateEffectImproved',
    misery: true, sunderArmor: true, faerieFire: 'TristateEffectImproved',
    improvedScorch: true, bloodFrenzy: true, huntersMark: 'TristateEffectImproved',
    exposeWeaknessUptime: 1, exposeWeaknessHunterAgility: 800,
};
const INDIVIDUAL_EXTRA = {
    blessingOfKings: true, blessingOfWisdom: 'TristateEffectImproved',
    blessingOfMight: 'TristateEffectImproved',
};

function makeRequest(entry, partyOverrides, individualOverrides) {
    const player = JSON.parse(JSON.stringify(entry.player));
    player.buffs = Object.assign({}, BASE_INDIVIDUAL, INDIVIDUAL_EXTRA, individualOverrides);
    return {
        raid: {
            parties: [{ players: [player], buffs: Object.assign({}, BASE_PARTY, partyOverrides) }],
            buffs: RAID_BUFFS,
            debuffs: DEBUFFS,
            tanks: entry.isTank ? [{ type: 'Player', index: 0 }] : [],
        },
        encounter: {
            duration: DURATION,
            durationVariation: 0,
            targets: [{ level: 73, mobType: 'MobTypeDemon', stats: [], swingSpeed: 2, minBaseDamage: 4000 }],
        },
        simOptions: { iterations: 10000, randomSeed: '42' },
    };
}

mkdirSync(here(`./out/requests-${DURATION}/`), { recursive: true });
let n = 0;
for (const f of readdirSync(here('./out/profiles/')).filter(f => f.endsWith('.json')).sort()) {
    const specFile = f.replace('.json', '');
    const entry = JSON.parse(readFileSync(here('./out/profiles/' + f), 'utf8'));
    const w = (name, req) => {
        writeFileSync(here(`./out/requests-${DURATION}/${specFile}__${name}.json`), JSON.stringify(req, null, 1));
        n++;
    };
    w('BASELINE', makeRequest(entry, {}, {}));
    // Spec §1: BASELINE is the spec's UNBUFFED-PARTY dps, not the fully-buffed one. It has to
    // be measured separately — each spec's party-buff package is worth a different amount
    // (1.09x for a shadow priest, 1.55x for a ret paladin), so using the fully-buffed number
    // as the baseline would inflate melee against casters by ~40%. Raid buffs, debuffs and
    // blessings stay ON: they are not party-scoped, so they are not what the model chooses.
    w('UNBUFFED', makeRequest(entry, ALL_PARTY_OFF, ALL_INDIVIDUAL_OFF));
    for (const [buff, [scope, field, off]] of Object.entries(TOGGLES)) {
        w(buff.replace(/ /g, '_'),
            makeRequest(entry,
                scope === 'party' ? { [field]: off } : {},
                scope === 'individual' ? { [field]: off } : {}));
    }
}
console.log(`${n} requests written`);
