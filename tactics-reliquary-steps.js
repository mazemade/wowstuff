(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsReliquarySteps = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const order = ['overview', 'positioning', 'fixate', 'suffering', 'souls', 'desire', 'interrupts', 'deaden', 'anger', 'spite', 'cycle'];
    const step = (id, title, detail, startMs, holdAtMs, options = {}) => ({ id, title, detail, startMs, holdAtMs, tip: options.tip || '', optional: !!options.optional, countdownSeconds: options.countdownSeconds || 0, loop: options.loop || 'hold' });
    const chapters = {
        overview: [step('encounter-plan', 'Three essences. One controlled sequence.', 'Suffering → souls → Desire → souls → Anger. Each essence changes the raid job.', 0, 0)],
        positioning: [step('formation', 'Use the sheet formation before the pull.', 'Tanks in front, melee behind, ranged split wide and healers central enough to cover both sides.', 0, 0)],
        fixate: [
            step('closest-tank', 'The closest tank receives Suffering.', 'This is positional selection, not a taunt rotation.', 0, 900),
            step('incoming-tank', 'The next tank moves into its front lane.', 'The next receiver moves closest before Fixate while the current tank retreats along its own lane.', 3900, 4999),
            step('first-handoff', 'The first handoff completes.', 'The new receiver has Fixate; the previous tank is back in its waiting position.', 5000, 5900),
            step('second-handoff', 'The second receiver moves in.', 'The next tank again becomes closest in its own front lane before the next five-second selection.', 8900, 9999),
            step('third-handoff', 'The third handoff completes.', 'The rotation continues with damage remaining on prior receivers.', 10000, 10900)
        ],
        suffering: [
            step('suffering-rule', 'No healing or mana regeneration.', 'Armor is removed and defense is reduced by 500 while Suffering is active.', 0, 900),
            step('soul-drain', 'Soul Drain arrives.', 'It drains health and mana. Magic dispel takes priority.', 1000, 2900),
            step('dispel-drain', 'Dispel Soul Drain first.', 'Remove the magic debuff before other dispels.', 3000, 4900),
            step('priest-shield', 'Priest shield still works.', 'Absorbs protect the current tank even though healing cannot.', 5000, 6900),
            step('healer-dps', 'Healers DPS during Suffering.', 'Healing and mana regeneration remain disabled.', 7000, 8900),
            step('enrage-rotation', 'Enrage needs three closest-tank turns.', 'At real fight time 0:45, Enrage lasts 15 seconds. Each tank survives five seconds with avoidance and cooldowns.', 12000, 17999),
            step('rogue-evasion', 'Optional: Rogue Evasion.', 'A Rogue can use Evasion as an optional Enrage survival reminder.', 14900, 14900, { optional: true, loop: 'effect' }),
            step('hunter-deterrence', 'Optional: Hunter Deterrence.', 'A Hunter can use Deterrence as an optional Enrage survival reminder.', 15100, 16900, { optional: true, loop: 'effect' })
        ],
        souls: [
            step('gather-souls', 'Gather ghosts at the raid.', 'Bring souls to the group. Do not kill them across the room.', 1000, 4000),
            step('kill-soul', 'Kill the gathered soul.', 'Only souls killed at the raid restore health and mana.', 5000, 5400),
            step('soul-recovery', 'Soul recovery reaches the raid.', 'Health and mana return together after the nearby death.', 5500, 6499)
        ],
        desire: [
            step('desire-damage', 'Damage starts the recoil.', 'Fifty percent of damage returns to its attacker.', 2000, 2290),
            step('desire-recoil', 'Recoil returns to the attacker.', 'The same player takes the return damage.', 2300, 2890),
            step('desire-heal', 'Healing recovers the recoil.', 'Healing is doubled during Aura of Desire.', 2900, 3800),
            step('mana-depletion', 'Maximum mana shrinks toward zero.', 'This accelerated demonstration reaches the real-fight 2:40 zero-mana point; preserve priority casts.', 0, 14000)
        ],
        interrupts: [
            step('tongues', 'Curse of Tongues stays up.', 'The Warlock makes the one-second Spirit Shock cast 1.6 seconds for a bigger kick window.', 0, 1190, { loop: 'effect' }),
            step('first-spirit-shock', 'The assigned player interrupts Spirit Shock.', 'Use the assigned kick. A missed Shock incapacitates the tank and swaps threat.', 2000, 4200),
            step('rune-shield', 'Rune Shield blocks interrupts.', 'Remove Rune Shield before kicking. Mage Spellsteal is preferred; purge or dispel is fallback.', 5000, 6900),
            step('spellsteal', 'Remove Rune Shield.', 'After Spellsteal or the eligible fallback removal, the next interrupt can land.', 7000, 7900),
            step('next-spirit-shock', 'The next assigned player interrupts Spirit Shock.', 'Keep Curse of Tongues up and continue the assigned kick rotation.', 8000, 9999)
        ],
        deaden: [
            step('deaden-cast', 'Deaden doubles incoming damage.', 'The assigned interrupter stops the cast.', 3000, 3990),
            step('deaden-kick', 'Use the normal assigned Deaden kick.', 'The normal interrupt is the plan.', 4000, 4990),
            step('spell-reflection', 'Optional: Protection Warrior Spell Reflection.', 'A coordinated Spell Reflection is an optional alternative that makes the boss take doubled damage.', 5000, 7490, { optional: true }),
            step('deadly-throw', 'Optional: Rogue Deadly Throw backup.', 'Rogue arena gloves can add an interrupt backup; they are not required for the rotation.', 7500, 9999, { optional: true })
        ],
        anger: [
            step('anger-preparation', 'Prepare Shadow Protection.', 'Use Shadow Protection before Anger and keep the front clear for Soul Scream.', 0, 1900),
            step('anger-pickup', 'The off-tank picks up Anger.', 'The raid waits while the off-tank establishes the first pickup.', 0, 1900),
            step('anger-taunt', 'The main tank taunts at 0:02.', 'Seethe is a tank survival cue. Wait four more seconds before raid damage.', 2000, 5900),
            step('anger-burn', 'Threat is set: raid burns.', 'Start damage and available Bloodlust at 0:06. Keep Soul Scream frontal clear.', 6000, 13900),
            step('soul-scream', 'Spend rage before Soul Scream.', 'Soul Scream burns rage for extra damage. Spend it first; paladins spend mana. Face Anger away.', 10000, 17999)
        ],
        spite: [
            step('spite-countdown', 'Spite marks: prepare for impact.', 'Marked players are immune for six seconds. Heal them before the Nature impact.', 3000, 9000, { countdownSeconds: 6 }),
            step('spite-impact', 'Spite impacts for about 7500 Nature damage.', 'The immunity ends once; the impact lands and the marked players need recovery.', 9000, 10799),
            step('spite-recovery', 'Recover after Spite.', 'Healers recover marked players while damage continues.', 10800, 11500),
            step('spite-healthstone', 'Use a healthstone after Spite.', 'Healthstones are an optional personal recovery reminder after the impact.', 10800, 11999, { optional: true })
        ],
        cycle: []
    };
    const allSteps = order.flatMap(sceneId => (chapters[sceneId] || []).map((item, localIndex) => ({ ...item, sceneId, chapterId: sceneId, localIndex, count: chapters[sceneId].length, sampleMs: item.startMs, range: [item.startMs, item.holdAtMs] })));
    const byId = new Map(allSteps.map((item, index) => [item.sceneId + ':' + item.id, { ...item, index }]));
    function forScene(sceneId) { return chapters[sceneId] || []; }
    function all() { return allSteps; }
    function frameAt(item, elapsedMs) { return Math.min(item.holdAtMs, item.startMs + Math.max(0, elapsedMs)); }
    function countdownAt(item, elapsedMs) { return item.countdownSeconds ? Math.max(0, Math.ceil((item.countdownSeconds * 1000 - elapsedMs) / 1000)) : null; }
    function indexFor(sceneId, sourceTimeMs) {
        const candidates = allSteps.filter(item => item.sceneId === sceneId);
        const containing = candidates.filter(item => item.startMs <= sourceTimeMs && sourceTimeMs <= item.holdAtMs);
        const pool = containing.length ? containing : candidates.filter(item => item.startMs <= sourceTimeMs);
        const selected = pool.reduce((chosen, item) => item.startMs >= chosen.startMs ? item : chosen, pool[0]);
        return selected ? allSteps.indexOf(selected) : -1;
    }
    function timelineFor(sceneId, sourceTimeMs) {
        const index = indexFor(sceneId, sourceTimeMs), item = allSteps[index];
        if (!item) return null;
        return { index, localIndex: item.localIndex, elapsedMs: Math.max(0, Math.min(item.holdAtMs, sourceTimeMs) - item.startMs), sourceTimeMs: Math.min(item.holdAtMs, sourceTimeMs), sampleMs: item.startMs, range: [item.startMs, item.holdAtMs], step: item };
    }
    function chapterBoundary(sceneId, localIndex) {
        const chapterIndex = order.indexOf(sceneId), nextSceneId = order[chapterIndex + (localIndex < 0 ? -1 : 1)];
        if (!nextSceneId) return null;
        const steps = forScene(nextSceneId);
        return { sceneId: nextSceneId, localIndex: localIndex < 0 ? Math.max(0, steps.length - 1) : 0 };
    }
    function get(sceneId, id) { return byId.get(sceneId + ':' + id) || null; }
    return { order, forScene, all, get, frameAt, countdownAt, indexFor, timelineFor, chapterBoundary };
}));
