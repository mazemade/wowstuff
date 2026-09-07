(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsNajentusData = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const scene = (id, chapter, title, caption, call, why, jobs, mistake, duration, sequence, animated, highlight) => ({
        id, chapter, title, caption, call, why, jobs, mistake, duration,
        phase: 1, formation: 1, view: { fit: 'arena' }, actors: [], effects: [],
        sequence: sequence || {}, animated: !!animated, highlight: highlight || []
    });

    return {
        id: 'bt-najentus', slug: 'najentus', name: 'High Warlord Naj’entus', where: 'Black Temple',
        portrait: 'maps/najentus-icon.png', map: 'maps/bt-najentus.png',
        mapSize: { width: 2088, height: 1146 }, aspect: 2088 / 1146,
        mapFilter: 'brightness(1.20) contrast(1.04) saturate(.75)', clockMode: 'state',
        positioningSceneId: 'positioning', referenceTitle: 'Briefing reminders', remindersTitle: 'Briefing reminders',
        legend: [
            { kind: 'needle', label: 'Needle splash', exportLabel: 'Cyan: Needle splash' },
            { kind: 'spine', label: 'Impaled / collected spine', exportLabel: 'Gold: spine' },
            { kind: 'shield', label: 'Tidal Shield', exportLabel: 'Blue: shield' },
            { kind: 'move', label: 'Example route', exportLabel: 'Pale: example route' }
        ],
        arena: { x0: 0.315, x1: 0.665, y0: 0.16, y1: 0.79 }, yard: 0.0050,
        bossAt: { x: 0.490, y: 0.288 }, roster: { tanks: 1, healers: 6, melee: 7, ranged: 11 },
        arcs: [
            { count: 7, radius: 16, from: 25, to: 155 },
            { count: 9, radius: 23, from: 25, to: 155 },
            { count: 9, radius: 30, from: 25, to: 155 }
        ],
        stack: { tankApart: 0, tankBack: 5.5, arcRadius: 8, arcFrom: 25, arcTo: 155 },
        source: 'Naj’entus strategy references',
        sources: [
            { name: 'Wowhead — Naj’entus strategy', url: 'https://www.wowhead.com/tbc/guide/high-warlord-najentus-black-temple-bt-strategy-burning-crusade-classic' },
            { name: 'Method — High Warlord Naj’entus', url: 'https://www.method.gg/guides/black-temple/high-warlord-najentus' }
        ],
        abilities: [
            { id: 'needle', name: 'Needle Spine', spell: 39835, url: 'https://www.wowhead.com/tbc/spell=39835/needle-spine', icon: 'maps/tactics/icon-spell_frost_icestorm.jpg', tier: 1, phase: 1, stageLabel: 'Normal combat', who: 'Several raid members', rangeYards: 6, tooltip: { castTime: 'Instant', range: '6 yd splash', description: 'Several targets are struck; nearby allies can take the Needle Spine explosion.' }, doThis: 'Give the targets room and heal the hit. Melee use the space available to them.' },
            { id: 'impale', name: 'Impaling Spine', spell: 39837, url: 'https://www.wowhead.com/tbc/spell=39837/impaling-spine', icon: 'maps/tactics/icon-spell_frost_iceshard.jpg', tier: 1, phase: 1, stageLabel: 'Normal combat', who: 'One non-main-tank raider', tooltip: { castTime: 'Instant', description: 'The victim is pinned until another raider clicks the spine. The rescuer receives a Naj’entus Spine.' }, doThis: 'A nearby free player clicks the spine, frees the ally, and keeps the item.' },
            { id: 'shield', name: 'Tidal Shield', spell: 39872, url: 'https://www.wowhead.com/tbc/spell=39872/tidal-shield', icon: 'maps/tactics/icon-spell_nature_crystalball.jpg', tier: 1, phase: 1, stageLabel: 'Shield window', who: 'Naj’entus', tooltip: { castTime: 'Instant', description: 'Naj’entus is immune while the shield is active and heals during the pause.' }, doThis: 'Top the whole raid before the called break; the tank alone being healthy is not enough.' },
            { id: 'hurl', name: 'Hurl Spine', spell: 39948, url: 'https://www.wowhead.com/tbc/spell=39948/hurl-spine', itemUrl: 'https://www.wowhead.com/tbc/item=32408/najentus-spine', icon: 'maps/tactics/icon-spell_frost_iceshard.jpg', tier: 2, phase: 1, stageLabel: 'Shield break', who: 'One spine holder within 25 yd', rangeYards: 25, tooltip: { castTime: 'Instant', range: '25 yd range', description: 'A designated holder throws a collected Naj’entus Spine at the boss to break the shield.' }, doThis: 'One holder throws only on the call. Keep any spare spine for the next shield.' },
            { id: 'burst', name: 'Tidal Burst', spell: 39878, url: 'https://www.wowhead.com/tbc/spell=39878/tidal-burst', icon: 'maps/tactics/icon-spell_frost_summonwaterelemental.jpg', tier: 1, phase: 1, stageLabel: 'Shield break', who: 'Everyone', tooltip: { castTime: 'Instant', description: 'Breaking the shield causes one simultaneous 8,500 Frost raidwide hit.' }, doThis: 'Have enough buffed maximum health to survive 8,500 Frost damage; use stamina gear or buffs if needed, then heal and use a healthstone for recovery.' }
        ],
        scenes: [
            scene('overview', 'The loop', 'One fight, repeated shield interruptions', 'The rhythm is spread, rescue, heal, one called throw, then recovery.', 'Spread. Free the impaled. Heal up. One called throw.', 'The same jobs return through one sustained tanking phase.', [['Tank', 'One main tank holds the boss.'], ['Raid', 'Spread, free impaled allies and retain their spines.'], ['Healers & holder', 'Top the raid, then break the shield on the call.']], 'Throwing the first spine as soon as the shield appears.', 6000),
            scene('positioning', 'Pull & positions', 'One tank, room for everyone else', 'Keep healers in reach and leave practical room for the 6-yard Needle splash.', 'One tank. Use your space. Keep healers in reach.', 'A position is a starting example, not a promise that every melee player can be 6 yards apart.', [['Main tank', 'Hold the boss in front, away from the raid.'], ['Melee', 'Work behind him and use available spacing.'], ['Ranged & healers', 'Leave room while keeping healing coverage.']], 'Tightly stacking the whole raid because a diagram has one backline.', 6000),
            scene('needle', 'Needle Spine', 'Needle targets need room and healing', 'Highlighted recipients show the target-centered 6-yard splash; a nearby ally demonstrates collateral damage.', 'Give Needle targets room. Heal the hit.', 'This is a splash lesson, not a projectile dodge route.', [['Targets', 'Give nearby allies room where possible.'], ['Neighbors', 'Reduce splash exposure from your starting spacing.'], ['Healers', 'Cover unavoidable melee splash.']], 'Confusing the splash with the clickable Impaling Spine.', 9000, { needles: [{ at: 1000 }], clusteredNeedle: true }, true, ['needle']),
            scene('impale', 'Free an ally', 'Click the spine, then keep it', 'The victim remains pinned until a free raider reaches and clicks the spine.', 'Nearest free player: click the spine, then keep it.', 'The victim does not loot their own spine; the rescuer takes it for the shield.', [['Victim', 'Call your location while pinned.'], ['Rescuer', 'Click the spine, free the ally and retain the item.'], ['Healers', 'Support the victim and keep the tank stable.']], 'The whole raid converging, or asking the pinned victim to free themself.', 10000, { impales: [{ id: 'first', at: 1000, approachAt: 2000, extractAt: 4500, homeAt: 7500 }], initialSpines: 0 }, true, ['impale']),
            scene('shield', 'Heal before the break', 'Use the shield pause to make the raid ready', 'This example starts after a spine was collected. Raid bars rise before any caller gives a throw order.', 'Shield up. Top the raid. Hold your spine.', 'Full health cannot make an undersized maximum-health pool safe; prepare enough buffed health for the burst.', [['Damage', 'Pause attacks into immunity.'], ['Healers', 'Top everyone, not only the tank.'], ['Holder', 'Keep the collected spine until the call.']], 'Treating a full tank bar as proof that the raid is ready.', 9000, { initialSpines: 1, shield: { at: 0, readyAt: 4500, recoverAt: 9000 } }, true, ['shield']),
            scene('burst', 'One called throw', 'One throw, one raidwide recovery', 'This example starts shielded with a collected spine. One holder moves into 25 yards and throws on the call.', 'Raid ready. One holder throws; heal the burst.', 'The 8,500 Frost hit lands on everyone together; running away does not solve it.', [['Caller & holder', 'Check raid recovery, then throw one spine in range.'], ['Other holders', 'Save spare spines.'], ['Healers', 'Recover the simultaneous hit; a healthstone can help.']], 'Trying to outrun the burst or spending every spine.', 11000, { initialSpines: 1, shield: { at: 0, readyAt: 3500, throwAt: 5000, hitAt: 5700, recoverAt: 10000 } }, true, ['shield', 'hurl', 'burst']),
            scene('cycle', 'Put it together', 'Keep the rescue, shield and recovery rhythm', 'Two rescues create a primary and spare spine before the shield interruption.', 'Keep the rhythm: rescue, prepare, call, recover.', 'Watch teammates and raid health so the next shield has a ready holder.', [['Raid', 'Spread for Needle and free each impaled ally.'], ['Holders', 'Keep the first spine for the call and save the spare.'], ['Healers', 'Top the raid before and recover it after the burst.']], 'Finishing one mechanic and forgetting the spine or next shield.', 76000, { needles: [{ at: 8000 }, { at: 32000 }], impales: [{ id: 'first', at: 20000, approachAt: 21000, extractAt: 24000, homeAt: 28000 }, { id: 'second', at: 40000, approachAt: 41000, extractAt: 44000, homeAt: 48000 }], initialSpines: 0, shield: { at: 60000, readyAt: 65000, throwAt: 67000, hitAt: 67700, recoverAt: 75000 } }, true, ['needle', 'impale', 'shield', 'hurl', 'burst'])
        ],
        tips: ['Spread for Needle splash.', 'Free impaled allies.', 'Keep collected spines.', 'Heal before the shield break.', 'One holder throws within 25 yards on the call.', 'Tidal Burst hits the entire raid together.']
    };
}));
