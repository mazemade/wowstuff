(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsCouncilSteps = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const step = (id, title, detail, startMs, holdAtMs) => ({ id, title, detail, startMs, holdAtMs, optional: false, countdownSeconds: 0, loop: 'hold' });
    const one = (title, detail) => [step('plan', title, detail, 0, 0)];
    const beats = (duration, rows) => rows.map(([start, id, title, detail], i) => step(id, title, detail, start, i + 1 < rows.length ? rows[i + 1][0] - 1 : duration));
    return {
        overview: one('Four bosses. One shared health pool.', 'Keep tank control, stop Malande’s heals, leave AoE immediately and heal poison through Envenom.'),
        positioning: one('Name all four tank jobs and their healers.', 'Gathios and Veras move together on the right. Malande stays with her interrupt team; Zerevor stays isolated with a mage tank.'),
        pull: beats(10000, [
            [0, 'protect', 'Protect the mage before the pull.', 'The guild pull uses a Paladin’s Blessing of Protection. Other tanks and healers are ready.'],
            [1500, 'steal', 'Mage: Spellsteal Dampen Magic.', 'The three other tanks pick up their assigned bosses immediately; available Misdirections help.'],
            [4500, 'control', 'Confirm control before raid damage.', 'Keep the mage protected by the stolen buff and all four tank jobs covered.']
        ]),
        rotation: beats(14000, [
            [0, 'ready', 'Move when ground appears under the pack.', 'The route is 1 → 2 → 3 → 4, checking each destination for clear ground.'],
            [1200, 'move-two', 'Move tanks and melee to clear point 2.', 'Gathios and Veras travel together; Malande’s dedicated interrupters retain their job.'],
            [4500, 'move-three', 'Another patch: continue to point 3.', 'The previous dangerous ground stays behind. Healers maintain range.'],
            [8500, 'move-four', 'Continue to clear point 4.', 'Move for Consecration, Blizzard or Flamestrike. Do not walk back into an old patch.'],
            [11000, 'hold-clear', 'Hold clear ground until the next movement call.', 'Continue the route only when the next location is safe; the numbered positions are examples.']
        ]),
        interrupts: beats(15000, [
            [0, 'physical', 'No immunity: use the assigned physical kick.', 'Stop Circle of Healing. Keep Curse of Tongues available and cover Divine Wrath too.'],
            [1500, 'physical-result', 'Confirm the heal was stopped.', 'Reflective Shield does not itself block interrupts; be careful of reflected damage.'],
            [5000, 'protection', 'Protection: the magical interrupter takes over.', 'Physical kicks are blocked. Use Earth Shock or Counterspell from the assigned backup.'],
            [6500, 'magic-result', 'Confirm the magical interrupt landed.', 'Do not rely on the distant mage tank as your sole backup.'],
            [10000, 'warding', 'Spell Warding: use the physical interrupter.', 'Magic is blocked. Kick, Pummel or Shield Bash can still stop the heal.'],
            [11500, 'warding-result', 'Keep the physical rotation under Spell Warding.', 'These are separate immunity examples; each live blessing lasts 15 seconds.']
        ]),
        hazards: beats(9000, [
            [0, 'spread', 'Leave room between backline players.', 'Spread on both sides without losing healer or interrupt reach.'],
            [1000, 'ground', 'Blizzard and Flamestrike appear: move now.', 'Every affected player takes an open path out. Do not finish the cast.'],
            [3500, 'clear', 'Resume your job from clear ground.', 'Old patches remain dangerous. Keep spreading and preserve tank healing.']
        ]),
        poison: beats(10000, [
            [0, 'vanish', 'Veras vanishes; his tank stays ready.', 'Poison healing continues alongside every other tank assignment.'],
            [1000, 'poison', 'Poison targets: start focused recovery.', 'The assigned healer follows the targets through the coming Envenom burst.'],
            [5000, 'envenom', 'Envenom follows: keep healing.', 'Poison fading is not the all-clear. Recover the finishing hit.'],
            [8000, 'recover', 'Recover targets while staying clear of AoE.', 'Use available personal survival tools when needed.'],
            [9000, 'pickup', 'Veras returns: his tank reacquires him.', 'Allow the pickup before damage resumes on Veras.']
        ]),
        mage: beats(11000, [
            [0, 'range', 'Keep more than 10 yards from Zerevor.', 'The mage tanks at range with dedicated healing. Everyone leaves this lane clear.'],
            [1500, 'dampen', 'Maintain stolen Dampen Magic.', 'The boss buff protects the mage against Arcane Bolt; maintain a threat lead.'],
            [6000, 'renew', 'Boss reapplies Dampen: prepare the fresh steal.', 'Cancel your old stolen buff only immediately before Spellsteal, with the new boss buff available.'],
            [7500, 'renewed', 'Keep the new protection and healing coverage.', 'Continue at range; do not dispel Zerevor’s buff before the mage steals it.']
        ]),
        kite: beats(28000, [
            [0, 'secure', 'Optional: secure threat before the ramp kite.', 'Follow the guild’s practiced ramp route only after the normal pull is stable.'],
            [2500, 'ramp', 'Follow the ramp while keeping space from Zerevor.', 'This animation shows one ramp segment. Use the guild image for the complete route; stay away from ramp edges.'],
            [24500, 'bottom', 'Return within healing reach at the bottom.', 'Top the mage, renew Spellsteal when needed and monitor threat before continuing.']
        ]),
        cycle: beats(40000, [
            [0, 'opening', 'Coordinate the mage pull and other pickups.', 'Protection, Spellsteal and tank control precede raid damage.'],
            [8000, 'moving-pack', 'Carry Gathios and Veras onto clear ground.', 'Move together on each ground effect; old patches remain.'],
            [22000, 'shield-check', 'Read Malande’s blessing for the interrupt.', 'Use the appropriate assigned physical or magical interrupt.'],
            [30000, 'poison-watch', 'Cover Vanish, poison and Envenom.', 'Keep the poison healer free while tank healers retain their jobs.'],
            [39000, 'repeat', 'Pick Veras up and maintain the same jobs.', 'The encounter continues until the shared health is gone. This teaching sequence is accelerated.']
        ])
    };
}));
