(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsData = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Every coordinate is a fraction of the map image: x of width, y of height — the same
    // convention as hyjal-positions.js, so a map can be re-captured without touching code.
    // Distances are authored in YARDS and converted through `yard`, so a danger radius drawn
    // on the map is the radius the tooltip actually states.
    //
    // Ability text and icons: the in-game dungeon journal, read through raidplan.io's public
    // gamedata API (encounter 602). Tips: the raid's Black Temple cheat sheet.

    const SUPREMUS = {
        id: 'bt-supremus',
        name: 'Supremus',
        where: 'Black Temple',
        portrait: 'maps/tactics/boss-supremus.png',
        map: 'maps/tactics/supremus-map.jpg',
        aspect: 1600 / 889,

        // The courtyard mat, measured off the map capture. Roughly 90 yards across, which
        // sets the yard: 0.435 of the map width spans that, so one yard is ~0.0048.
        arena: { x0: 0.285, x1: 0.720, y0: 0.060, y1: 0.950 },
        yard: 0.0048,

        // Both phases run 60 seconds, forever, and threat wipes at every swap.
        phaseSeconds: 60,

        roster: { tanks: 2, healers: 6, melee: 7, ranged: 10 },

        source: 'Dungeon journal via raidplan.io · Black Temple cheat sheet',

        // ---- the hazard rail ----------------------------------------------------------
        // tier drives how much room the card gets: 1 kills you, 2 hurts, 3 is background.
        abilities: [
            {
                id: 'hateful',
                name: 'Hateful Strike',
                spell: 41926,
                icon: 'maps/tactics/icon-ability_criticalstrike.png',
                tier: 1,
                phase: 1,
                who: 'Tanks',
                rangeYards: 8,
                tooltip: {
                    castTime: 'Instant',
                    range: 'Melee Range',
                    description: 'Deals 7384 damage to a threatening target with the highest health within melee range.'
                },
                doThis: 'Two tanks stacked on him, nobody else in melee range but the melee — he swings at whoever is healthiest up close.'
            },
            {
                id: 'flame',
                name: 'Molten Flame',
                spell: 40265,
                icon: 'maps/tactics/icon-spell_fire_felfire.png',
                tier: 1,
                phase: 1,
                who: 'One random player',
                tooltip: {
                    castTime: 'Instant',
                    duration: '20 sec',
                    description: 'Deals 2067 Fire damage to enemies within the flames.'
                },
                doThis: 'It chases you for ten seconds and then keeps burning. Step sideways out of it and never drag it through your camp.'
            },
            {
                id: 'fixate',
                name: 'Fixate',
                spell: 41951,
                icon: 'maps/tactics/icon-ability_fixated_state_red.png',
                tier: 1,
                phase: 2,
                who: 'One random player, swapping every 10 sec',
                rangeYards: 8,
                tooltip: {
                    castTime: 'Instant',
                    range: 'Unlimited range',
                    duration: '10 sec',
                    description: 'Causes the caster to fixate on a random target.',
                    aura: 'Fixated!'
                },
                doThis: 'If he turns to you, run and keep running. Everybody else gets out of the lane between him and whoever he wants.'
            },
            {
                id: 'geyser',
                name: 'Volcanic Geyser',
                spell: 42055,
                icon: 'maps/tactics/icon-spell_fire_volcano.png',
                tier: 2,
                phase: 2,
                who: 'Anyone standing near one',
                radiusYards: 8,
                tooltip: {
                    castTime: 'Instant',
                    range: '100 yd range',
                    duration: '18 sec',
                    description: 'A volcano bursts forth from the ground, dealing 2002 Fire damage to nearby enemies with 8 yds.'
                },
                doThis: 'Move the moment one cracks open under you. They keep firing for eighteen seconds.'
            },
            {
                id: 'punch',
                name: 'Molten Punch',
                spell: 40126,
                icon: 'maps/tactics/icon-spell_fire_felimmolation.png',
                tier: 3,
                phase: 1,
                who: 'The floor',
                tooltip: {
                    castTime: 'Instant',
                    cooldown: '8 sec cooldown',
                    duration: '8 sec',
                    description: 'Supremus punches the ground, creating a Flame Gout that creates Molten Flame periodically.'
                },
                doThis: 'This is the tell — the fire you have to dodge comes out of it.'
            }
        ],

        // ---- the walkthrough ----------------------------------------------------------
        scenes: [
            {
                id: 'overview',
                view: { cx: 0.500, cy: 0.505, spanYards: 112 },
                phase: 0,
                title: 'Two phases, a minute each',
                caption: 'He alternates on a strict timer and never stops. Threat wipes completely at every swap.',
                duration: 6000,
                highlight: [],
                actors: [{ id: 'boss', kind: 'boss', at: { x: 0.500, y: 0.480 }, scale: 1.6 }],
                effects: [
                    { kind: 'sweep', from: 'boss', radiusYards: 24, start: 0, end: 3000 },
                    { kind: 'sweep', from: 'boss', radiusYards: 24, start: 3000, end: 6000 }
                ]
            },
            {
                id: 'p1-hateful',
                view: { cx: 0.500, cy: 0.430, spanYards: 62 },
                phase: 1,
                title: 'Hateful Strike',
                caption: 'He swings at whoever has the most health in melee range. Tanks stack so one healer covers both; melee sit behind him on less health and never get picked.',
                duration: 7000,
                highlight: ['hateful'],
                actors: [
                    { id: 'boss', kind: 'boss', at: { x: 0.500, y: 0.400 } },
                    {
                        id: 'mt', kind: 'tank', at: { x: 0.4925, y: 0.366 }, label: 'MT', labelDx: -1,
                        hp: [{ t: 0, v: 0.95 }, { t: 1800, v: 0.62 }, { t: 3200, v: 0.86 }, { t: 4600, v: 0.90 }, { t: 7000, v: 0.95 }]
                    },
                    {
                        id: 'ot', kind: 'tank', at: { x: 0.5075, y: 0.368 }, label: 'OT', labelDx: 1,
                        hp: [{ t: 0, v: 0.78 }, { t: 1800, v: 0.84 }, { t: 3200, v: 0.94 }, { t: 4600, v: 0.61 }, { t: 7000, v: 0.80 }]
                    },
                    { id: 'm1', kind: 'melee', at: { x: 0.470, y: 0.446 }, hp: [{ t: 0, v: 0.58 }] },
                    { id: 'm2', kind: 'melee', at: { x: 0.500, y: 0.458 }, hp: [{ t: 0, v: 0.63 }] },
                    { id: 'm3', kind: 'melee', at: { x: 0.530, y: 0.446 }, hp: [{ t: 0, v: 0.55 }] }
                ],
                effects: [
                    { kind: 'ring', from: 'boss', radiusYards: 8, label: 'melee range', start: 0, end: 7000 },
                    { kind: 'impact', target: 'mt', start: 1500, end: 2300 },
                    { kind: 'impact', target: 'ot', start: 4300, end: 5100 }
                ]
            },
            {
                id: 'p1-flame',
                view: { cx: 0.520, cy: 0.520, spanYards: 78 },
                phase: 1,
                title: 'Molten Flame',
                caption: 'He punches the ground and the fire hunts one player for ten seconds. Step out sideways.',
                duration: 8000,
                highlight: ['flame', 'punch'],
                actors: [
                    { id: 'boss', kind: 'boss', at: { x: 0.500, y: 0.380 } },
                    {
                        id: 'r1', kind: 'ranged', at: { x: 0.620, y: 0.560 }, label: 'you',
                        path: [
                            { x: 0.620, y: 0.560, t: 0 },
                            { x: 0.620, y: 0.560, t: 900 },
                            { x: 0.648, y: 0.520, t: 2100 },
                            { x: 0.682, y: 0.474, t: 3400 },
                            { x: 0.700, y: 0.440, t: 4400 },
                            { x: 0.700, y: 0.440, t: 8000 }
                        ]
                    },
                    { id: 'c1', kind: 'ranged', at: { x: 0.404, y: 0.646 } },
                    { id: 'c2', kind: 'healer', at: { x: 0.440, y: 0.694 } },
                    { id: 'c3', kind: 'ranged', at: { x: 0.386, y: 0.706 } }
                ],
                effects: [
                    { kind: 'sweep', from: 'boss', radiusYards: 12, start: 0, end: 1100 },
                    { kind: 'ring', from: 'c2', radiusYards: 9, label: 'your camp', start: 0, end: 8000 },
                    { kind: 'trail', from: 'boss', follow: 'r1', start: 800, end: 8000, chaseMs: 4600 }
                ]
            },
            {
                id: 'p1-stand',
                view: { cx: 0.500, cy: 0.545, spanYards: 108 },
                phase: 1,
                title: 'Where you stand in Phase 1',
                caption: 'Tanks stacked on him, melee behind him, everyone else in loose camps well back.',
                duration: 5000,
                highlight: ['hateful', 'flame'],
                formation: 'stack',
                bossAt: { x: 0.500, y: 0.360 },
                actors: [],
                effects: []
            },
            {
                id: 'swap',
                view: { cx: 0.512, cy: 0.482, spanYards: 76 },
                phase: 0,
                title: 'Threat resets',
                caption: 'Every swap wipes the table. Slow down before Phase 1 comes back, and misdirect the moment it does.',
                duration: 7600,
                highlight: [],
                actors: [
                    { id: 'boss', kind: 'boss', at: { x: 0.500, y: 0.420 } },
                    { id: 'mt', kind: 'tank', at: { x: 0.4915, y: 0.362 }, label: 'MT', labelDx: -1 },
                    { id: 'ot', kind: 'tank', at: { x: 0.5085, y: 0.364 }, label: 'OT', labelDx: 1 },
                    { id: 'hunter', kind: 'ranged', at: { x: 0.588, y: 0.566 }, label: 'misdirect' }
                ],
                effects: [{ kind: 'threat', from: 'boss', start: 0, end: 7600 }]
            },
            {
                id: 'p2-fixate',
                view: { cx: 0.492, cy: 0.548, spanYards: 100 },
                phase: 2,
                title: 'He hunts you',
                caption: 'Threat is gone. He picks someone, walks them down, and picks again ten seconds later.',
                duration: 8000,
                highlight: ['fixate'],
                actors: [
                    {
                        id: 'boss', kind: 'boss', at: { x: 0.470, y: 0.330 },
                        path: [
                            { x: 0.470, y: 0.330, t: 0 },
                            { x: 0.432, y: 0.430, t: 1700 },
                            { x: 0.404, y: 0.512, t: 3400 },
                            { x: 0.450, y: 0.556, t: 4600 },
                            { x: 0.540, y: 0.598, t: 6200 },
                            { x: 0.596, y: 0.620, t: 8000 }
                        ]
                    },
                    {
                        id: 'p1', kind: 'ranged', at: { x: 0.372, y: 0.560 }, label: 'run',
                        path: [
                            { x: 0.372, y: 0.560, t: 0 },
                            { x: 0.348, y: 0.626, t: 1700 },
                            { x: 0.330, y: 0.694, t: 3400 },
                            { x: 0.328, y: 0.748, t: 5000 },
                            { x: 0.328, y: 0.748, t: 8000 }
                        ]
                    },
                    { id: 'p2', kind: 'healer', at: { x: 0.560, y: 0.430 } },
                    {
                        id: 'p3', kind: 'ranged', at: { x: 0.648, y: 0.640 },
                        path: [
                            { x: 0.648, y: 0.640, t: 0 },
                            { x: 0.648, y: 0.640, t: 3600 },
                            { x: 0.686, y: 0.712, t: 5400 },
                            { x: 0.700, y: 0.790, t: 7200 },
                            { x: 0.700, y: 0.790, t: 8000 }
                        ]
                    },
                    { id: 'p4', kind: 'melee', at: { x: 0.470, y: 0.760 } }
                ],
                effects: [
                    { kind: 'ring', from: 'boss', radiusYards: 8, label: 'knockback', start: 0, end: 8000 },
                    { kind: 'gaze', from: 'boss', target: 'p1', start: 200, end: 3500 },
                    { kind: 'gaze', from: 'boss', target: 'p3', start: 3700, end: 8000 }
                ]
            },
            {
                id: 'p2-geyser',
                view: { cx: 0.500, cy: 0.545, spanYards: 104 },
                phase: 2,
                title: 'Volcanic Geysers',
                caption: 'Volcanoes open anywhere in the room and keep firing for eighteen seconds. Never stand still.',
                duration: 8000,
                highlight: ['geyser'],
                actors: [
                    { id: 'boss', kind: 'boss', at: { x: 0.494, y: 0.372 } },
                    {
                        id: 'v1', kind: 'ranged', at: { x: 0.590, y: 0.664 }, label: 'move',
                        path: [
                            { x: 0.590, y: 0.664, t: 0 },
                            { x: 0.590, y: 0.664, t: 1900 },
                            { x: 0.646, y: 0.720, t: 3200 },
                            { x: 0.672, y: 0.760, t: 4200 },
                            { x: 0.672, y: 0.760, t: 8000 }
                        ]
                    },
                    { id: 'v2', kind: 'healer', at: { x: 0.360, y: 0.560 } },
                    { id: 'v3', kind: 'ranged', at: { x: 0.404, y: 0.740 } },
                    { id: 'v4', kind: 'melee', at: { x: 0.560, y: 0.474 } },
                    { id: 'v5', kind: 'ranged', at: { x: 0.336, y: 0.664 } },
                    { id: 'v6', kind: 'healer', at: { x: 0.652, y: 0.500 } },
                    { id: 'v7', kind: 'ranged', at: { x: 0.612, y: 0.784 } }
                ],
                effects: [
                    { kind: 'volcano', at: { x: 0.402, y: 0.430 }, radiusYards: 8, start: 300, end: 8000 },
                    { kind: 'volcano', at: { x: 0.572, y: 0.648 }, radiusYards: 8, start: 1800, end: 8000 },
                    { kind: 'volcano', at: { x: 0.442, y: 0.752 }, radiusYards: 8, start: 4200, end: 8000 }
                ]
            },
            {
                id: 'p2-stand',
                view: { cx: 0.500, cy: 0.505, spanYards: 112 },
                phase: 2,
                title: 'Where you stand in Phase 2',
                caption: 'Spread before the swap, not after it. Everyone on the ring, nobody sharing a geyser.',
                duration: 5000,
                highlight: ['fixate', 'geyser'],
                formation: 'spread',
                bossAt: { x: 0.500, y: 0.400 },
                actors: [],
                effects: []
            }
        ],

        // Carried from the raid's own cheat sheet, in its words.
        tips: [
            'Have misdirects assigned after every Phase 2.',
            'Supremus does not crush, and neither do his hatefuls, so tanks can gear towards stamina.',
            'Both phases are on strict timers: pre-spread before Phase 2, and slow DPS before Phase 1 resets.',
            'Paladin tanks can stack Seal of Vengeance during Phase 2 for snap threat going into Phase 1.'
        ]
    };

    return { FIGHTS: { 'bt-supremus': SUPREMUS } };
}));
