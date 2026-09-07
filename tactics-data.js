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

        // Where he is parked for Phase 1, and the grid of standing spots behind him. The
        // raid's own sheet spreads for the whole fight ("spread out to mitigate those hit by
        // Molten Flame"), so there is one set of spots, not one per phase — see
        // tactics-layout.js.
        bossAt: { x: 0.500, y: 0.205 },
        grid: { x0: 0.320, x1: 0.690, y0: 0.390, y1: 0.900, jitterX: 0.024, jitterY: 0.038 },
        stack: { tankApart: 1.7, tankBack: 4.4, arcRadius: 13.5, arcFrom: 18, arcTo: 162 },

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
                // The tooltip says "Melee Range" without a figure. He is a very large model,
                // so his reach from centre is drawn at 14 yards — an estimate from the model,
                // not a documented number, and the only radius on this page that is not.
                rangeYards: 14,
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
        // Every step after the title card is played on the whole raid: the mechanics land on
        // the formation people actually stand in, and the engine walks anyone caught in one
        // out of it. `cast` names the raid members a step happens to; ids are slot order,
        // so p0/p1 are the tanks, p2..p8 the melee, p9..p24 the spread.
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
                id: 'p1-stand',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 1,
                title: 'Where you stand in Phase 1',
                caption: 'Tanks stacked on him, melee behind him, everyone else on their own spot. That spread holds for the whole fight.',
                duration: 5000,
                highlight: ['flame'],
                formation: 1,
                actors: [],
                effects: []
            },
            {
                id: 'p1-hateful',
                view: { cx: 0.500, cy: 0.330, spanYards: 100 },
                phase: 1,
                title: 'Hateful Strike',
                caption: 'He swings at whoever has the most health in melee range. Tanks stack so one healer covers both; melee sit behind him on less health and never get picked.',
                duration: 7000,
                highlight: ['hateful'],
                formation: 1,
                actors: [],
                effects: [
                    { kind: 'ring', from: 'boss', radiusYards: 14, label: 'his reach', start: 0, end: 7000 },
                    { kind: 'impact', target: 'p0', start: 1500, end: 2300 },
                    { kind: 'impact', target: 'p1', start: 4300, end: 5100 }
                ]
            },
            {
                id: 'p1-flame',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 1,
                title: 'Molten Flame',
                caption: 'He punches the ground and the fire hunts one player for ten seconds. Walk it away from everyone else — it burns for another ten where you leave it.',
                duration: 10000,
                highlight: ['flame', 'punch'],
                formation: 1,
                cast: { burned: 'p9' },
                actors: [],
                effects: [
                    { kind: 'sweep', from: 'boss', radiusYards: 14, start: 0, end: 1100 },
                    { kind: 'trail', from: 'boss', follow: 'burned', avoid: 6, start: 700, end: 10000, chaseMs: 7600 }
                ]
            },
            {
                id: 'swap',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 0,
                title: 'Melee move out',
                caption: 'As the minute mark comes up, tanks and melee walk out to their own spots. Threat wipes anyway, and nobody wants to be stood on him when he turns.',
                duration: 8000,
                highlight: [],
                morph: { from: 1, to: 2, start: 700, end: 5200 },
                actors: [],
                effects: [{ kind: 'threat', mode: 'wipe', from: 'boss', start: 0, end: 8000 }]
            },
            {
                id: 'p2-fixate',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 2,
                title: 'He hunts you',
                caption: 'Threat is gone. He picks someone and walks them down, then picks again ten seconds later. Get out of the lane he is walking.',
                duration: 10000,
                highlight: ['fixate'],
                formation: 2,
                cast: { hunted: 'p19', second: 'p11' },
                chaseSpeed: 0.0044,
                actors: [],
                effects: [
                    { kind: 'ring', from: 'boss', radiusYards: 8, label: 'knockback', start: 0, end: 10000 },
                    { kind: 'gaze', from: 'boss', target: 'hunted', avoid: 11, start: 300, end: 5000 },
                    { kind: 'gaze', from: 'boss', target: 'second', avoid: 11, start: 5200, end: 10000 }
                ]
            },
            {
                id: 'p2-geyser',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 2,
                title: 'Volcanic Geysers',
                caption: 'Volcanoes open anywhere in the room and keep firing for eighteen seconds. If one opens under you, move — the spread means it only ever catches one of you.',
                duration: 9000,
                highlight: ['geyser'],
                formation: 2,
                actors: [],
                effects: [
                    { kind: 'volcano', at: { x: 0.402, y: 0.470 }, radiusYards: 8, avoid: 10, start: 400, end: 9000 },
                    { kind: 'volcano', at: { x: 0.596, y: 0.660 }, radiusYards: 8, avoid: 10, start: 2400, end: 9000 },
                    { kind: 'volcano', at: { x: 0.470, y: 0.836 }, radiusYards: 8, avoid: 10, start: 4800, end: 9000 }
                ]
            },
            {
                id: 'back',
                view: { cx: 0.500, cy: 0.545, spanYards: 152 },
                phase: 0,
                title: 'Back to Phase 1',
                caption: 'Before the next swap, everyone repositions and DPS slows down so the tanks can hold. Misdirects go out the moment he turns back.',
                duration: 8000,
                highlight: ['hateful'],
                morph: { from: 2, to: 1, start: 600, end: 5000 },
                cast: { md: 'p13' },
                actors: [],
                effects: [{ kind: 'threat', mode: 'rebuild', from: 'boss', md: 'md', start: 0, end: 8000 }]
            }
        ],

        // Carried from the raid's own cheat sheet, in its words.
        tips: [
            'Spread out to mitigate those hit by Molten Flame.',
            'Lust ASAP.',
            'Have assigned healers on the main tank and the hateful tank. An extra hateful tank helps in early weeks.',
            'As the 1 minute marker approaches, melee DPS should start moving to avoid fixate deaths.',
            'Prioritise surviving over DPSing during fixate, and keep an eye out for geyser spawns.',
            'As the next minute marker approaches, start repositioning back to Phase 1 and slow DPS so the tanks can establish threat.',
            'Have misdirects ready for the tanks right when Phase 1 restarts.'
        ]
    };

    return { FIGHTS: { 'bt-supremus': SUPREMUS } };
}));
