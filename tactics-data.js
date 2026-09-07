(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsData = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Map fractions are illustrative. The sheet and Classic strategy guide supply the
    // encounter rules; the journal artwork supplies icons, not level-scaled damage values.
    const SUPREMUS = {
        id: 'bt-supremus',
        name: 'Supremus',
        where: 'Black Temple',
        portrait: 'maps/tactics/boss-supremus.png',
        map: 'maps/tactics/supremus-map.jpg',
        aspect: 1600 / 889,

        // A schematic courtyard scale; no circle or slot is an in-game range check.
        arena: { x0: 0.285, x1: 0.720, y0: 0.060, y1: 0.950 },
        yard: 0.0070,

        // Both phases run 60 seconds, forever, and threat wipes at every swap.
        phaseSeconds: 60,

        roster: { tanks: 2, healers: 6, melee: 7, ranged: 10 },

        // Example pull positions. Actual spell reach and available floor vary; movement
        // scenes show leaving these spots whenever a hazard demands it.
        bossAt: { x: 0.500, y: 0.235 },
        arcs: [
            { count: 5, radius: 15, from: 28, to: 152 },
            { count: 9, radius: 22, from: 15, to: 165 },
            { count: 11, radius: 29.5, from: 12, to: 168 }
        ],
        stack: { tankApart: 1.7, tankBack: 6, arcRadius: 11, arcFrom: 28, arcTo: 152 },

        source: 'Black Temple cheat sheet · Wowhead Classic strategy · raidplan.io artwork',
        sources: [
            { name: 'Guild spreadsheet & strategy image', url: 'https://docs.google.com/spreadsheets/d/1FyVLgyE6RAgppltXd72VcGEi3OPGBhKn0iEwmD0U4yk/edit?gid=1595734724#gid=1595734724' },
            { name: 'Wowhead — Supremus, TBC Classic', url: 'https://www.wowhead.com/tbc/guide/supremus-black-temple-bt-strategy-burning-crusade-classic' }
        ],

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
                // not a measured collision boundary.
                rangeYards: 14,
                tooltip: {
                    castTime: 'Instant',
                    range: 'Melee Range',
                    // Classic spell tooltip; keep encounter targeting advice separately.
                    spellText: 'Deals 27,750 to 32,250 damage to a threatening target with the highest health within melee range.',
                    description: 'Checks the top three threat players in melee range, excluding the main tank, then selects the highest current health.'
                },
                doThis: 'Assign a main tank and a Hateful soak. Keep the soak high on threat and topped up; melee wait for the tanks to establish.'
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
                    spellText: 'Deals 3,325 to 3,675 Fire damage to enemies within the flames.',
                    description: 'Blue ground fire follows a player for about 10 seconds, then remains for about 10 more. Anyone touching the trail takes damage.'
                },
                doThis: 'Move sideways into clear ground. Avoid the entire trail, including the part the fire has already passed.'
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
                doThis: 'If targeted, run toward clear ground. Others clear his route. Watch each target switch and stay within reach of healers.'
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
                    // The Classic database leaves this scripted spell's damage unresolved.
                    spellText: 'A volcano bursts from the ground, dealing Fire damage to nearby enemies.',
                    description: 'Volcanoes erupt around the room and damage nearby players. The diagram uses an illustrative 8 yds danger radius; leave a generous margin.'
                },
                doThis: 'Move immediately when one appears nearby. Spreading reduces how many players must move; it does not guarantee safety.'
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
                    description: 'The ground punch signals the approaching Molten Flame. Watch for the blue fire.'
                },
                doThis: 'This is the tell — the fire you have to dodge comes out of it.'
            }
        ],

        // Scenes teach one decision at a time. Paths are examples, not mandatory routes.
        // Cast roles are resolved against the imported roster by the presenter.
        scenes: [
            {
                id: 'overview', chapter: 'The loop', view: { fit: 'arena' }, phase: 0,
                title: 'Two phases. Two different jobs.',
                caption: 'One minute of controlled damage, one minute of movement. Every phase change resets threat.',
                call: 'Damage in Phase 1. Survival in Phase 2.',
                why: 'Learn the two transitions first. They decide when you move and when you stop attacking.',
                jobs: [['Phase 1 · 60 sec', 'Tanks hold him. Raid spreads loosely and dodges blue fire.'], ['Phase 2 · 60 sec', 'Run if fixated. Dodge volcanoes and keep a route to your healers.'], ['Every reset', 'Prepare before the timer ends. Let tanks regain control when Phase 1 returns.']],
                mistake: 'Using your Phase 1 position as a fixed home during Phase 2.',
                duration: 6000, highlight: [], formation: 1, actors: [], effects: []
            },
            {
                id: 'p1-stand', chapter: 'Pull & positions', view: { fit: 'arena' }, phase: 1, fightStart: 0,
                title: 'Start with tank control and a loose spread',
                caption: 'Face him away from the raid. These positions are examples: adjust for fire, range and your actual roster.',
                call: 'Tanks first. Spread loosely. Lust early.',
                why: 'Give the tanks control, then use the first damage window while everyone is in position.',
                jobs: [['Tanks', 'Main tank holds the boss; assigned Hateful tank stays in melee and builds threat.'], ['Healers', 'Assign coverage to both tanks. Keep the Hateful tank topped up.'], ['Damage', 'Melee behind; ranged spread with healers nearby. Lust as soon as the pull is controlled.']],
                mistake: 'Starting damage before both tanks are established, or stacking everyone in one fire path.',
                duration: 6000, highlight: ['hateful'], formation: 1, actors: [], effects: []
            },
            {
                id: 'p1-hateful', chapter: 'Hateful Strike', view: { fit: 'front' }, phase: 1, fightStart: 12,
                title: 'Two tank jobs. Keep the soak healthy.',
                caption: 'Normal swings hit the main tank. Hateful selects by current health among eligible high-threat melee targets, excluding the main tank.',
                call: 'Hateful tank high on threat, high on health.',
                why: 'Standing behind the boss does not make melee immune to Hateful Strike.',
                jobs: [['Main tank', 'Holds the boss and takes regular melee swings.'], ['Hateful tank', 'Stays in melee, builds threat and takes Hateful Strikes. An extra soak can help during progression.'], ['Healers & melee', 'Keep the soak topped up. DPS wait for tank threat; deliberately staying injured is not the strategy.']],
                mistake: 'Assuming a melee player can never be selected, or assigning only one healer to cover both tank jobs by default.',
                duration: 8000, highlight: ['hateful'], formation: 1, focus: ['tank', 'melee'],
                cast: { mt: 'p0', soak: 'p1' }, castRoles: { mt: ['tank', 0], soak: ['tank', 1] },
                actors: [], effects: [
                    { kind: 'impact', target: 'mt', label: 'Melee', start: 1200, end: 2000 },
                    { kind: 'impact', target: 'soak', label: 'Hateful', start: 3200, end: 4000 },
                    { kind: 'impact', target: 'soak', label: 'Hateful', start: 6200, end: 7000 }
                ]
            },
            {
                id: 'p1-flame', chapter: 'Blue fire', view: { fit: 'action' }, phase: 1, fightStart: 25,
                title: 'Step across the fire, then leave it behind',
                caption: 'Watch the highlighted player move into open ground. The blue trail remains dangerous after it stops chasing.',
                call: 'Sideways out of blue fire. Keep the trail clear.',
                why: 'Moving early gives you room to avoid the trail without making the whole raid move.',
                jobs: [['Targeted player', 'Move across its approach into open ground. The shown route is one example.'], ['Nearby players', 'Move if the trail reaches you. Do not cross the burning ground.'], ['After the chase', 'The fire follows for about 10 seconds, then persists for about 10 more.']],
                mistake: 'Running through the raid, or stepping back onto a trail because its head has moved away.',
                duration: 22000, highlight: ['flame', 'punch'], formation: 1,
                cast: { burned: 'p11' }, castRoles: { burned: ['ranged', 1] }, roles: { burned: 'Move out' },
                starts: { burned: { x: 0.41, y: 0.49 } },
                paths: { burned: [{ t: 0, x: 0.41, y: 0.49 }, { t: 2400, x: 0.36, y: 0.57 }, { t: 5700, x: 0.38, y: 0.72 }, { t: 10200, x: 0.54, y: 0.78 }] },
                actors: [], effects: [
                    { kind: 'sweep', from: 'boss', radiusYards: 14, start: 0, end: 1000 },
                    { kind: 'trail', from: 'boss', follow: 'burned', avoid: 3.5, start: 1000, end: 21000, chaseMs: 10000 },
                    { kind: 'call', text: 'The chase stops. The trail still burns.', start: 11000, end: 20000 }
                ]
            },
            {
                id: 'swap', chapter: 'Spread before P2', view: { fit: 'arena' }, phase: 0, fightStart: 55,
                title: 'Make space before the phase changes',
                caption: 'Melee creates distance early. Tanks keep tanking until fixate begins, then react to the first target.',
                call: 'Melee out. Tanks hold until fixate.',
                why: 'The first fixate can select someone who was just standing at his feet.',
                jobs: [['Melee', 'Create distance before the swap. Be ready to run if selected.'], ['Tanks', 'Keep tanking and soaking Hateful Strike until fixate begins. Then move with the raid.'], ['Ranged & healers', 'Keep space; continue healing both tanks until the change.'], ['At the change', 'Threat resets. Watch the first fixate target and clear their route.']],
                mistake: 'Tanks leaving early while normal attacks and Hateful Strike are still active.',
                duration: 8000, highlight: ['fixate'], morph: { from: 1, to: 2, start: 0, end: 4200 },
                countdown: { phase: 2, at: 5000 }, actors: [], effects: [
                    { kind: 'threat', mode: 'wipe', from: 'boss', start: 0, end: 8000 },
                    { kind: 'call', text: 'Melee out · Tanks keep tanking', start: 0, end: 4800 },
                    { kind: 'call', text: 'Phase 2 — watch the fixate target', start: 5000, end: 8000 }
                ]
            },
            {
                id: 'p2-fixate', chapter: 'Fixate', view: { fit: 'raid' }, phase: 2, fightStart: 60,
                title: 'A new target means a new route',
                caption: 'The red line shows who he follows. The pale arrow shows an example escape route. Watch the target change after ten seconds.',
                call: 'Target runs. Everyone else clears the route.',
                why: 'React to where the boss is now, not where he stood at the pull.',
                jobs: [['Fixated player', 'Run toward clear ground, away from the boss and through no one.'], ['Everyone else', 'Clear the route and watch for the next target. Survival comes before damage.'], ['Healers', 'Move with the raid so runners stay within healing reach.']],
                mistake: 'Following a fixed clockwise route even when the boss or hazards make it unsafe.',
                duration: 20000, highlight: ['fixate'], formation: 2,
                cast: { hunted: 'p19', second: 'p11' }, castRoles: { hunted: ['ranged', 5], second: ['ranged', 1] },
                starts: { hunted: { x: 0.60, y: 0.43 }, second: { x: 0.38, y: 0.55 } },
                paths: {
                    hunted: [{ t: 0, x: 0.60, y: 0.43 }, { t: 2000, x: 0.68, y: 0.55 }, { t: 6000, x: 0.68, y: 0.88 }, { t: 10000, x: 0.49, y: 0.88 }],
                    second: [{ t: 0, x: 0.38, y: 0.55 }, { t: 10000, x: 0.38, y: 0.55 }, { t: 12000, x: 0.32, y: 0.41 }, { t: 15500, x: 0.32, y: 0.12 }, { t: 20000, x: 0.53, y: 0.12 }]
                },
                chaseSpeed: 0.0044, actors: [], effects: [
                    { kind: 'gaze', from: 'boss', target: 'hunted', avoid: 14, start: 0, end: 10000 },
                    { kind: 'gaze', from: 'boss', target: 'second', avoid: 14, start: 10000, end: 20000 }
                ]
            },
            {
                id: 'p2-geyser', chapter: 'Volcanoes', view: { fit: 'raid' }, phase: 2, fightStart: 75,
                title: 'Move everyone near the eruption',
                caption: 'A loose spread reduces how many players are caught. It does not make a volcano a one-player mechanic.',
                call: 'Volcano nearby? Move now. Leave a margin.',
                why: 'The affected players light up together. Each must leave the danger area.',
                jobs: [['Near a volcano', 'Move immediately into clear ground, beyond the danger ring.'], ['While moving', 'Check the boss and other volcanoes before choosing your next position.'], ['Spread', 'Use open space and stay in healing reach. The rings are illustrative, not a range checker.']],
                mistake: 'Stopping at the exact edge of a diagram circle or trusting an assigned spot to stay safe.',
                duration: 12000, highlight: ['geyser'], formation: 2, actors: [], effects: [
                    { kind: 'volcano', at: { x: 0.392, y: 0.452 }, radiusYards: 8, avoid: 10, start: 1000, end: 12000 },
                    { kind: 'volcano', at: { x: 0.604, y: 0.512 }, radiusYards: 8, avoid: 10, start: 3500, end: 12000 },
                    { kind: 'volcano', at: { x: 0.492, y: 0.582 }, radiusYards: 8, avoid: 10, start: 6000, end: 12000 }
                ]
            },
            {
                id: 'p2-together', chapter: 'Put it together', view: { fit: 'arena' }, phase: 2, fightStart: 95,
                title: 'Read the target and the ground together',
                caption: 'Two fixates and overlapping volcanoes. The runners use the open sides while nearby players move out of the eruptions.',
                call: 'Run if targeted. Dodge volcanoes on the way.',
                why: 'The mechanics overlap in the fight. A route only works while its ground stays clear.',
                jobs: [['Targeted player', 'Follow open ground and keep checking ahead. Change direction if a new hazard blocks you.'], ['Raid', 'Clear the boss route and leave volcanoes immediately. Keep the runners in healing reach.'], ['Next transition', 'Watch the timer. Prepare tank pickup and Misdirect as Phase 1 approaches.']],
                mistake: 'Watching only the boss while running straight into a volcano.',
                duration: 20000, highlight: ['fixate', 'geyser'], formation: 2,
                cast: { hunted: 'p19', second: 'p11' }, castRoles: { hunted: ['ranged', 5], second: ['ranged', 1] },
                starts: { hunted: { x: 0.60, y: 0.43 }, second: { x: 0.38, y: 0.55 } },
                paths: {
                    hunted: [{ t: 0, x: 0.60, y: 0.43 }, { t: 2000, x: 0.68, y: 0.55 }, { t: 6000, x: 0.68, y: 0.88 }, { t: 10000, x: 0.49, y: 0.88 }],
                    second: [{ t: 0, x: 0.38, y: 0.55 }, { t: 10000, x: 0.38, y: 0.55 }, { t: 12000, x: 0.32, y: 0.41 }, { t: 15500, x: 0.32, y: 0.12 }, { t: 20000, x: 0.53, y: 0.12 }]
                },
                chaseSpeed: 0.0044, actors: [], effects: [
                    { kind: 'gaze', from: 'boss', target: 'hunted', avoid: 14, start: 0, end: 10000 },
                    { kind: 'gaze', from: 'boss', target: 'second', avoid: 14, start: 10000, end: 20000 },
                    { kind: 'volcano', at: { x: 0.53, y: 0.53 }, radiusYards: 8, avoid: 10, start: 1500, end: 19500 },
                    { kind: 'volcano', at: { x: 0.48, y: 0.70 }, radiusYards: 8, avoid: 10, start: 8500, end: 26500 }
                ]
            },
            {
                id: 'back', chapter: 'Reset & repeat', view: { fit: 'arena' }, phase: 0, fightStart: 115,
                title: 'Pick him up first. Reposition second.',
                caption: 'Start where the chase ended. At the reset, tanks take control and hunters Misdirect. Only then does melee return and the boss move back.',
                call: 'Ease off. MD on reset. Wait for tank control.',
                why: 'Threat is wiped again. Being in your original position does not mean the tank has the boss.',
                jobs: [['Tanks', 'Prepare within reach. Pick him up after the reset, then return to a clear tanking position.'], ['Hunters', 'Assign Misdirect to the pickup tank and use it as Phase 1 restarts.'], ['Damage & healers', 'Ease off before the reset. Melee return after pickup; continue essential healing and watch aggro.']],
                mistake: 'Running into melee before Phase 2 ends, or assuming Phase 2 threat carries over.',
                duration: 15000, highlight: ['hateful'], focus: ['tank'], continueFrom: 'p2-together',
                morph: { from: 2, to: 1, start: 8500, end: 13000 }, countdown: { phase: 1, at: 5000 },
                cast: { md: 'p13' }, castRoles: { md: ['ranged', 0] }, roles: { md: 'Misdirect' }, actors: [], effects: [
                    { kind: 'threat', mode: 'rebuild', from: 'boss', md: 'md', start: 0, end: 15000 },
                    { kind: 'call', text: 'Ease off — prepare for the reset', start: 0, end: 4800 },
                    { kind: 'call', text: 'Threat reset — tanks pick up, MD now', start: 5000, end: 8300 },
                    { kind: 'call', text: 'Tank control — melee in, reposition', start: 8500, end: 15000 }
                ]
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
