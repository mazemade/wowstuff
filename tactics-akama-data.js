(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsAkamaData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const scene = (id, chapter, title, caption, call, why, jobs, mistake, duration, sequence, highlight) => ({
        id, chapter, title, caption, call, why, jobs, mistake, duration, sequence: sequence || {},
        phase: id === 'burn' ? 2 : 1, formation: 1, view: { fit: 'arena' }, actors: [], effects: [],
        animated: !['overview', 'positioning'].includes(id), highlight: highlight || []
    });
    const kills = [2000, 4000, 6000, 8000, 10000, 12000];
    const sheet = 'https://docs.google.com/spreadsheets/d/1FyVLgyE6RAgppltXd72VcGEi3OPGBhKn0iEwmD0U4yk/edit';
    return {
        id: 'bt-akama', slug: 'akama', name: 'Shade of Akama', where: 'Black Temple',
        portrait: 'maps/tactics/boss-akama.jpg', map: 'maps/tactics/akama-map.jpg',
        mapSize: { width: 1600, height: 889 }, aspect: 1600 / 889,
        mapFilter: 'brightness(1.42) contrast(1.04) saturate(.72)', clockMode: 'state',
        stateLabels: { bound: 'Phase 1 · Break the channels', adds: 'Phase 1 · Control the hallways', sorcerer: 'Phase 1 · Kill the sorcerer', fire: 'Phase 1 · Move out of fire', approach: 'Transition · Clear remaining adds', burn: 'Phase 2 · Burn the Shade', complete: 'Shade defeated · Akama survives' },
        positioningSceneId: 'positioning', referenceTitle: 'Mechanics & sources', remindersTitle: 'From the guild’s spreadsheet & strategy image',
        arena: { x0: .17, x1: .83, y0: .01, y1: .83 }, yard: .005,
        bossAt: { x: .5, y: .10 }, akamaAt: { x: .5, y: .74 }, engageAt: { x: .5, y: .65 },
        doors: [{ x: .21, y: .51 }, { x: .79, y: .51 }],
        roster: { tanks: 3, healers: 6, melee: 7, ranged: 9 },
        arcs: [{ count: 25, radius: 24, from: 25, to: 155 }],
        stack: { tankApart: 2, tankBack: 6, arcRadius: 8, arcFrom: 25, arcTo: 155 },
        legend: [
            { kind: 'binding', label: 'Binding channel', exportLabel: 'Violet: binding' },
            { kind: 'priority', label: 'Kill priority', exportLabel: 'Gold: priority' },
            { kind: 'trap', label: 'Frost Trap', exportLabel: 'Blue: Frost Trap' },
            { kind: 'rain', label: 'Rain of Fire', exportLabel: 'Orange: fire' },
            { kind: 'ally', label: 'Akama (ally)', exportLabel: 'Green: Akama' }
        ],
        source: 'Guild Black Temple spreadsheet, Boss Shade of Akama tab and embedded strategy image for doorway setup, trap readiness and the burn plan; supplementary Classic references for Channeler and Sorcerer mechanics; Raidplan artwork',
        sources: [
            { name: 'Guild spreadsheet — Boss Shade of Akama tab & strategy image', url: sheet },
            { name: 'Wowhead — Shade of Akama strategy', url: 'https://www.wowhead.com/tbc/guide/shade-of-akama-black-temple-bt-strategy-burning-crusade-classic' },
            { name: 'Method — Shade of Akama', url: 'https://www.method.gg/guides/black-temple/shade-of-akama' },
            { name: 'Icy Veins — Channelers & Sorcerers', url: 'https://www.icy-veins.com/tbc-classic/shade-of-akama-guide-strategy-abilities-loot' },
            { name: 'Raidplan — Black Temple map', url: 'https://raidplan.io/plan/create?raid=wow.tbc.blacktemple' }
        ],
        abilities: [
            { id: 'channel', name: 'Channelers & Sorcerers', url: 'https://www.wowhead.com/tbc/npc=23421/ashtongue-channeler', icon: 'maps/tactics/icon-spell_nature_faeriefire.jpg', tier: 1, phase: 1, stageLabel: 'Phase 1 · Binding', who: 'Channeler damage team', tooltip: { castTime: 'Channeled', description: 'Six Channelers bind the Shade and do not attack. Reinforcing Sorcerers add more binding channels.' }, doThis: 'Kill the Channelers quickly and switch to incoming Sorcerers. These channeling enemies need no tank.' },
            { id: 'adds', name: 'Hallway adds & Frost Traps', url: 'https://www.wowhead.com/tbc/npc=23216/ashtongue-defender', icon: 'maps/tactics/role-tank.svg', tier: 1, phase: 1, stageLabel: 'Phase 1 · Tank control', who: 'Tanks, hunters & assigned healers', tooltip: { description: 'Elementalists, Spiritbinders and Rogues arrive through the side hallways, with separate Defenders. Frost Traps can slow the waves for tank kiting.' }, doThis: 'Prepare both entrances. Keep Defenders away from healers; a third tank can support the side without a protection paladin.' },
            { id: 'heal', name: 'Spiritbinder heals', spell: 42027, url: 'https://www.wowhead.com/tbc/spell=42027/chain-heal', icon: 'maps/tactics/icon-spell_nature_healingwavegreater.jpg', tier: 1, phase: 1, stageLabel: 'Phase 1 · Interrupt', who: 'Assigned interrupters', tooltip: { castTime: 'Chain Heal: 1 sec cast', description: 'Spiritbinders use Chain Heal, Spirit Mend and Spirit Heal. Healing a Channeler undoes the raid’s progress.' }, doThis: 'Interrupt heals, especially near the Channelers. Control or kill dangerous adds when tank survival needs it.' },
            { id: 'fire', name: 'Rain of Fire', spell: 42023, url: 'https://www.wowhead.com/tbc/spell=42023/rain-of-fire', icon: 'maps/tactics/icon-spell_shadow_rainoffire.jpg', tier: 1, phase: 1, stageLabel: 'Either phase · Ground danger', who: 'Anyone in the fire', rangeYards: 10, tooltip: { description: 'An Elementalist burns a fixed patch of ground. The fire stays where it was cast.' }, doThis: 'Leave the orange area promptly, then resume your job. Healers keep their tanks in range.' },
            { id: 'burn', name: 'Akama’s damage race', url: 'https://www.wowhead.com/tbc/npc=22841/shade-of-akama', icon: 'maps/tactics/icon-spell_nature_bloodlust.jpg', tier: 1, phase: 2, stageLabel: 'Phase 2 · Lust & burn', who: 'Damage dealers', tooltip: { description: 'Akama fights his own Shade. The sheet budgets about one minute to kill the Shade before Akama dies; displayed health and timing are illustrative.' }, doThis: 'Clean up adds during the walk, then use Bloodlust / Heroism and damage cooldowns on the Shade. Tanks retain any surviving adds.' }
        ],
        scenes: [
            scene('overview', 'The plan', 'Free the Shade. Save Akama.', 'Two phases: break the binding, then win Akama’s damage race.', 'Kill channels. Control the doors. Lust on the Shade.', 'Fast channeler damage limits the number of add waves the tanks must hold.', [['Damage', 'Kill Channelers and reinforcing Sorcerers.'], ['Tanks & healers', 'Control the hallways and keep assigned tanks alive.'], ['Everyone', 'Leave Rain of Fire; burn the Shade once Akama engages.']], 'Treating the Shade as a player-tanked boss.', 6000, {}, ['channel', 'burn']),
            scene('positioning', 'Pull & positions', 'Set both hallways before talking to Akama', 'Example layout follows the sheet: melee at the platform, ranged on the steps, healers central and tanks at the entrances.', 'Tanks at both doors. Healers know your tank. Then start.', 'A prepared pickup keeps incoming enemies off healers while damage stays on Channelers.', [['Tanks', 'Split left and right; a third tank helps the side without a protection paladin.'], ['Hunters & healers', 'Frost Traps at the hallways if available; confirm tank healing assignments.'], ['Damage & caller', 'Set up by the Channelers. Talk to friendly Akama when everyone is ready.']], 'Starting the event before both hallway teams are ready.', 6000, { traps: true }, ['adds']),
            scene('channelers', 'Break the binding', 'Six Channelers. Keep damage on the objective.', 'Gold marks the next example kill target; each dead Channeler loses its violet beam.', 'Nuke the Channelers. Tanks hold the incoming adds.', 'Channelers do not fight back. Spending too long on side adds invites more waves.', [['Damage', 'Focus the Channelers; the order shown is an example.'], ['Tanks', 'Pick up adds rather than trying to tank a Channeler.'], ['Healers', 'Support the hallway tanks and keep out of add melee range.']], 'Moving all damage to the doorways while the binding stays intact.', 14000, { kills }, ['channel']),
            scene('doorways', 'Hold the hallways', 'Catch the wave before it reaches healers', 'One example wave at each door and a separate Defender show tank pickup, Frost Trap lanes and an interrupted heal.', 'Catch adds. Interrupt heals. Keep channeler damage going.', 'The spreadsheet prioritizes fast Channelers; kill side adds when control or tank survival demands it.', [['Tanks', 'Collect waves at the doors. Use slows to kite and mitigate damage.'], ['Interrupters', 'Stop Spiritbinder heals, especially if they can reach the Channelers.'], ['Healers & damage', 'Heal assigned tanks. Keep primary damage on Channelers; control dangerous extras.']], 'Letting a Spiritbinder heal the Channelers or a Defender bash a healer.', 11000, { wavesAt: 1000, traps: true, interruptAt: 5500 }, ['adds', 'heal']),
            scene('sorcerers', 'Reinforcing sorcerers', 'Do not let a new beam stall the release', 'This example starts with one surviving Channeler. A Sorcerer runs in and renews the binding.', 'New Sorcerer. Kill it, then finish the remaining channel.', 'A reinforcement replaces lost binding pressure; the objective remains clearing the channels.', [['Damage', 'Switch to the reinforcing Sorcerer, then finish the Channeler.'], ['Tanks', 'Keep doorway enemies under control.'], ['Healers', 'Keep supporting the tanks while damage handles the binding.']], 'Ignoring new channeling enemies because the original six were nearly dead.', 11000, { initialChannels: 1, sorcerer: { spawnAt: 1000, channelAt: 4000, dieAt: 8000 }, kills: [10000] }, ['channel']),
            scene('fire', 'Leave Rain of Fire', 'Step out, then return to your job', 'Orange is a fixed danger area. Highlighted players move clear while the fire stays behind.', 'Out of Rain of Fire. Keep your tank in healing range.', 'Avoiding the ground damage leaves healers free to maintain tank coverage.', [['Affected players', 'Leave the entire orange area, then resume your job.'], ['Healers', 'Move without losing coverage of your assigned tank.'], ['Tanks & damage', 'Maintain add control and channeler damage while teammates reposition.']], 'Standing in fire to finish one more cast.', 9000, { wavesAt: 0, fireAt: 1500 }, ['fire']),
            scene('burn', 'Lust & burn', 'Akama holds the Shade. You kill it.', 'This chapter starts after the walk and add cleanup. Illustrative health bars show the race; this is not a live one-minute timer.', 'Lust now. Burn the Shade. Tanks keep any remaining adds.', 'Akama dies if the raid is too slow. Player tanks keep surviving adds controlled.', [['Damage', 'Use Bloodlust / Heroism and offensive cooldowns on the Shade.'], ['Tanks', 'Hold surviving adds near the fight for safe cleave; Akama tanks the Shade.'], ['Healers', 'Keep add tanks alive and stay out of any remaining fire.']], 'Trying to taunt the Shade or continuing an unnecessary add-only damage phase.', 14000, { initialChannels: 0, survivingAdds: ['defender'], approachAt: 0, engageAt: 0, winAt: 12000 }, ['burn']),
            scene('cycle', 'Put it together', 'Channels → cleanup during the walk → Lust', 'A compressed teaching example: one wave, a Sorcerer, ground fire, add cleanup during the walk and the final burn.', 'Kill channels. Hold doors. Prepare the burn.', 'The spreadsheet’s transition is a cleanup window before damage switches fully to the Shade.', [['Damage', 'Kill channels; clean up adds during the walk; burn the Shade on engagement.'], ['Tanks', 'Use hallway slows, then bring remaining adds toward the Shade under control.'], ['Healers', 'Maintain assigned tank coverage throughout both phases.']], 'Using Lust on the add phase or abandoning tank control during the walk.', 36000, { kills: [4000, 6000, 8000, 10000, 12000, 14000], wavesAt: 3000, traps: true, interruptAt: 7500, fireAt: 9000, sorcerer: { spawnAt: 7000, channelAt: 10000, dieAt: 16000 }, approachAt: 16000, engageAt: 22000, winAt: 34000 }, ['channel', 'adds', 'heal', 'fire', 'burn'])
        ],
        tips: [
            'The guild sheet drives the doorway setup, trap readiness and burn plan; supplementary encounter guides describe Channeler and Sorcerer mechanics.',
            'Without imported tank classes, the right-side third-tank spot is an illustrative sheet example; support the opposite side when a protection paladin is identified.',
            'Talk to Akama only after the hallway tanks, available Frost Traps and tank-healing assignments are ready.',
            'The sheet suggests an extra tank on the side without a protection paladin.',
            'Fast Channeler kills can avoid needing to kill the first waves. Tanks still pick up and control them.',
            'Interrupt Spiritbinder heals; move out of Elementalist Rain of Fire.',
            'Optional sheet tactic: a controlled add near the Channelers can carry Seed of Corruption splash. Keep healer adds interrupted; do not delay the release to set this up.',
            'During the Shade’s walk, bring remaining adds closer under tank control and use the travel time for cleanup.',
            'Once Akama engages the Shade, use Lust and damage cooldowns. Aim to finish within the sheet’s roughly one-minute burn window.'
        ]
    };
}));
