(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-steps.js'), require('./tactics-data.js'));
    else root.TacticsBriefing = factory(root.TacticsSteps, root.TacticsData);
}(typeof self !== 'undefined' ? self : this, function (STEPS, DATA) {
    'use strict';

    // Each entry names the first detailed beat represented by a briefing stop.
    // The detailed registry remains the source of both animation and mechanics.
    const groups = {
        'bt-najentus': {
            needle: [{ id: 'spread', title: 'Needle: spread, heal, and reset.', detail: 'Give Needle targets room, heal the splash, then resume practical spacing before the next rescue.' }],
            impale: [{ id: 'watch', title: 'Rescue the pinned ally and keep the spine.', detail: 'A free nearby player clicks the spine; the victim cannot free themself. Save the collected spine for the shield call.' }],
            shield: [{ id: 'shield-up', title: 'Tidal Shield: top the raid before the throw.', detail: 'Damage pauses into immunity. Adequate buffed maximum health is required for the 8,500 Frost burst; the holder waits for the call.' }],
            burst: [{ id: 'shield-window', title: 'Top the raid, make one called throw, then recover.', detail: 'One holder throws within 25 yards on the call; other holders keep their spare spines. Tidal Burst hits everyone for 8,500 Frost damage, then heal the raid together.' }],
            cycle: [{ id: 'opening', title: 'Full shield cycle.', detail: 'Follow the uninterrupted cycle: spread, rescue, save spines, top the raid, make one called throw, then recover.' }]
        },
        'bt-supremus': {
            'p1-hateful': [{ id: 'mt-swing', title: 'Set the Hateful soak before the strike.', detail: 'The main tank holds the boss while the eligible high-threat melee soak stays healthy and in range.' }, { id: 'hateful-hit', title: 'Heal the Hateful soak for the next strike.', detail: 'Restore the soak after Hateful Strike; it remains in melee, high on threat and health.' }],
            'p1-flame': [{ id: 'punch-tell', title: 'Molten Punch: leave an open route.', detail: 'Watch the tell and move sideways into clear ground as the blue fire starts.' }, { id: 'chase-stops', title: 'The chase stops; the trail still burns.', detail: 'Continue from safe ground. Do not step back onto the burning path.' }],
            swap: [{ id: 'make-space', title: 'Make space for the Phase 2 threat reset.', detail: 'Melee clears the route while tanks continue tanking until Fixate begins.' }],
            'p2-fixate': [{ id: 'first-target', title: 'Fixate: clear each runner’s route.', detail: 'The selected player runs toward clear ground; read every target change and keep the raid in healing reach.' }],
            'p2-geyser': [{ id: 'spread-ready', title: 'Volcanoes: spread and move every nearby player.', detail: 'Keep open ground available. Each eruption changes the safe space, so nearby players move with a margin.' }],
            'p2-together': [{ id: 'read-both', title: 'Read Fixate and volcanoes together.', detail: 'Keep an open route for the runner while nearby players leave every eruption.' }, { id: 'next-fixate', title: 'Re-read the route when Fixate changes.', detail: 'Change direction if the ground ahead is unsafe and keep the new runner in healing reach.' }],
            back: [{ id: 'ease-off', title: 'Ease off before the return reset.', detail: 'Tanks prepare within reach before Phase 1 returns.' }, { id: 'pickup', title: 'Tanks pick up before melee returns.', detail: 'Use Misdirect when available; reposition after tank control is established.' }]
        },
        'bt-akama': {
            channelers: [{ id: 'binding', title: 'Kill Channelers to free the Shade.', detail: 'Damage stays on the binding objective until every beam disappears; tanks keep incoming adds controlled.' }],
            doorways: [{ id: 'doors-ready', title: 'Door teams catch waves before they reach healers.', detail: 'Tanks hold their lane while damage remains on Channelers.' }, { id: 'interrupt', title: 'Interrupt the Spiritbinder heal.', detail: 'Stop the heal, then keep the wave controlled while damage finishes the Channeler objective.' }],
            sorcerers: [{ id: 'watch', title: 'Watch for the reinforcing Sorcerer.', detail: 'The binding objective remains the priority until a Sorcerer enters.' }, { id: 'renewed-binding', title: 'Kill the Sorcerer, then finish the binding.', detail: 'Its renewed binding stalls release; remove it before returning to the remaining Channeler.' }],
            fire: [{ id: 'clear-ground', title: 'Rain of Fire: leave the orange ground.', detail: 'Affected players move clear without abandoning their tank or Channeler job; the fire remains where it landed.' }],
            walk: [{ id: 'walk-start', title: 'Bring controlled packs with the walking Shade.', detail: 'Tanks move their packs beside the Shade and healers travel with their assigned tanks.' }, { id: 'engage', title: 'Clean up, then burn the Shade.', detail: 'Use the rendezvous for add cleanup; save Lust for Akama’s engagement.' }],
            burn: [{ id: 'engaged', title: 'Akama engages: use Lust and damage cooldowns.', detail: 'Akama holds the Shade; player tanks keep any remaining adds controlled until the kill.' }],
            cycle: [{ id: 'start', title: 'Full encounter cycle.', detail: 'Follow the uninterrupted route from Channelers and hallway control through the Shade burn.' }],
            aoe: [{ id: 'optional-plan', title: 'Optional stacked AoE route.', detail: 'Keep the uninterrupted optional route controlled: reliable tank healing and interrupts support AoE at the Channelers.' }]
        },
        'bt-bloodboil': {
            rotation: [{ id: 'ready', title: 'Bloodboil: G1 → G2 → G3 → G1 → G2.', detail: 'Switch after each application. This rotation example repeats; the real fight proceeds to Fel Rage after the fifth hit.', loop: 'repeat', shortenRotationWaits: true }],
            tanks: [{ id: 'outgoing', title: 'Outgoing tank slows damage; incoming tank builds threat.', detail: 'Threat makes the handoff; Gurtogg cannot be taunted. Keep all tanks high on threat.' }, { id: 'incoming', title: 'Keep the backup ready for Bewildering Strike.', detail: 'The next tank on threat catches the boss when the current tank is confused. Healers still cover the outgoing tank’s wounds.' }, { id: 'bewilder-ends', title: 'Eject drops threat: the next tank catches the boss.', detail: 'As tanks recover from confusion or knockback, keep a backup high on threat and the front clear.' }],
            breath: [{ id: 'clear-front', title: 'Keep the frontal lane clear.', detail: 'Melee starts behind on the left; leave room to move when the facing changes.' }, { id: 'breath', title: 'Breath turns toward melee: clear that frontal.', detail: 'Other players leave the selected facing; heal the target. Stay out of Arcing Smash, whose healing penalty adds pressure during Fel Rage.' }],
            'rage-ranged': [{ id: 'target', title: 'Ranged Fel Rage: heal the target on the left.', detail: 'Healers start immediately. Neighbors clear Fel Geyser; the raid clears the boss’s route and front.' }, { id: 'ramp', title: 'Keep healing through the full 30-second Rage.', detail: 'Damage ramps up: use personal defenses and focused healing until Rage ends.' }],
            'rage-melee': [{ id: 'target', title: 'Melee Fel Rage: move to the original tank spot.', detail: 'Healers start immediately. Neighbors clear Fel Geyser and the boss’s route while the target moves.' }, { id: 'ramp', title: 'Keep healing through the full 30-second Rage.', detail: 'Damage ramps up: use personal defenses and focused healing until Rage ends.' }],
            recovery: [{ id: 'rage-ended', title: 'Fel Rage ends: hold raid damage.', detail: 'Give the tanks time to establish control before resuming.' }, { id: 'tank-control', title: 'Tank control confirmed: resume your group jobs.', detail: 'Misdirect can help the pickup when available. Resume damage and the soak rotation on the control call.' }],
            cycle: [{ id: 'set', title: 'Full encounter cycle.', detail: 'Follow the uninterrupted Bloodboil rotation, Fel Rage response, and tank recovery.' }]
        },
        'bt-reliquary': {
            fixate: [{ id: 'hold-fixates', title: 'Hold Fixate while the tank is healthy.', detail: 'Fixate checks who is closest every five seconds. Swap when health, shields or cooldowns call for it.' }, { id: 'incoming-tank', title: 'Move the fresh tank closest for the handoff.', detail: 'The current tank moves out; the fresh tank becomes closest for the next Fixate check.' }],
            suffering: [{ id: 'suffering-rule', title: 'Suffering: dispel Soul Drain immediately.', detail: 'Healing and mana regeneration are disabled. Prioritize the magic dispel; absorbs can still protect the tank.' }, { id: 'priest-shield', title: 'Healers: use absorbs and contribute damage.', detail: 'Priest shields still protect the tank. Help damage while maintaining priority magic dispels.' }, { id: 'enrage-prep', title: 'Prepare survival cooldowns for Enrage.', detail: 'Prepare a tank with cooldowns and avoidance before the Enrage window.' }, { id: 'enrage-survival', title: 'Survive Enrage with the prepared tank.', detail: 'Use the planned cooldowns and avoidance while the tank remains safe.' }],
            souls: [{ id: 'gather-souls', title: 'Gather ghosts at the raid.', detail: 'Bring souls to the group; do not kill them across the room.' }, { id: 'kill-soul', title: 'Kill the gathered soul for recovery.', detail: 'A nearby soul death restores health and mana to the raid.' }],
            desire: [{ id: 'mana-depletion', title: 'Desire drains maximum mana over time.', detail: 'Preserve priority casts as maximum mana shrinks toward zero.' }, { id: 'desire-damage', title: 'Damage reflects back: heal the attackers.', detail: 'Half of damage returns to its attacker. Healing is doubled; keep damage going while healers recover the recoil.' }],
            interrupts: [{ id: 'tongues', title: 'Keep Tongues up and assign the kick.', detail: 'Curse of Tongues gives the assigned interrupter more time. A missed Spirit Shock incapacitates the tank and swaps threat.' }, { id: 'rune-shield', title: 'Remove Rune Shield, then interrupt.', detail: 'Mage Spellsteal is preferred; purge or dispel is fallback. The next assigned interrupt can land after removal.' }],
            deaden: [{ id: 'deaden-cast', title: 'Interrupt Deaden with the assigned kick.', detail: 'Deaden doubles incoming damage. Keep the normal interrupt assignment; use alternatives only when coordinated.' }],
            anger: [{ id: 'anger-preparation', title: 'Prepare Anger and secure the pickup.', detail: 'Use Shadow Protection, keep the front clear, and let the off-tank establish the first pickup.' }, { id: 'anger-taunt', title: 'Main tank taunts at 0:02; raid damages at 0:06.', detail: 'After the main-tank taunt, wait four more seconds before raid damage and Bloodlust; keep Soul Scream frontal clear.' }, { id: 'soul-scream', title: 'Spend resources before Soul Scream.', detail: 'Spend rage first, paladins spend mana, and keep Anger faced away from the raid.' }],
            spite: [{ id: 'spite-countdown', title: 'Spite marks: heal before immunity ends.', detail: 'Marked players are immune for six seconds. Heal them before the Nature impact.' }, { id: 'spite-impact', title: 'Spite impacts; recover the marked players.', detail: 'The immunity ends once, then about 7,500 Nature damage lands and healers recover the marks.' }],
            cycle: [{ id: 'suffering-hold', title: 'Full Reliquary cycle.', detail: 'Follow the uninterrupted sequence through Suffering, Desire, Anger, and the final recovery.' }]
        },
        'bt-illidan': {
            ground: [{"id": "front", "title": "Protect against Shear and move the boss out of fire.", "detail": "Keep his front away from the raid. After Flame Crash, move the tank, boss, melee and pets onto clear ground."}],
            parasites: [{"id": "marked", "title": "Isolate the carrier, then kill both parasites.", "detail": "Leave before the ten-second expiry. Heal the carrier and kill both spawns before they spread another infection."}],
            flames: [{"id": "pickup", "title": "Pick up both Flames and move compactly out of fire.", "detail": "Face Flame Blast outward and keep both glaive tethers short. Three central groups preserve gaps for Fireball."}, {"id": "first", "title": "First Flame down: switch to the survivor.", "detail": "Keep its tank fully healed and wait for safe access before melee follows."}],
            eye: [{"id": "read", "title": "Read Eye Blast and adjust onto clear ground.", "detail": "Paths vary. Stay on the safe side of the beam, keep the Flame tethered and avoid its lingering blue trail."}],
            barrage: [{"id": "groups", "title": "Heal Fireball groups and focus the Barrage target.", "detail": "Keep gaps between groups. A separate raid healer covers splash and Dark Barrage while tank healers retain both Flames."}],
            landing: [{"id": "hold", "title": "Landing: main tank first, then spread for Agonizing Flames.", "detail": "Hold damage until control is confirmed; Misdirection helps. Stay more than five yards apart and prepare immediate tank healing."}, {"id": "burn", "title": "Burn toward 30%; prepare Demon Form if needed.", "detail": "Use Lust and saved cooldowns while doing the ground mechanics. A partial transform may still produce a Shadow Blast."}],
            demon: [{"id": "spread", "title": "Demon Form: isolate the Shadow tank and spread.", "detail": "Everyone leaves the 15-yard boss aura, stays 5 yards apart and keeps 20 yards away from the Shadow tank."}, {"id": "demons", "title": "Four Shadow Demons paralyze their targets.", "detail": "Targets cannot run. Free players switch immediately and kill the demons before contact."}],
            return: [{"id": "hold", "title": "Demon ends: secure the main tank before resuming.", "detail": "Hold damage through the handoff. Main-tank control and healing come first; resume the spread ground formation on the call."}],
            maiev: [{"id": "prison", "title": "At 30%, prepare the tank pickup after Maiev’s arrival.", "detail": "The raid is stunned during RP. Heal the main tank as it ends, re-establish control and keep doing ground mechanics."}, {"id": "enrage", "title": "Cover Enrage, arm a reachable trap and pull him across.", "detail": "A nearby player clicks the trap. Keep the boss’s front away from the raid and burn during the cage’s increased-damage window."}],
            cycle: [{"id": "ground", "title": "Ground: protect the tank and clear fire.", "detail": "This accelerated example connects phase jobs; its timestamps are not encounter timers."}]
        },
        'bt-council': {
            pull: [{ id: 'protect', title: 'Protect the mage, steal Dampen, secure the other bosses.', detail: 'Coordinate the guild pull with available Blessing of Protection and Misdirections. Confirm all four tank jobs before committing damage.' }],
            rotation: [{ id: 'ready', title: 'Ground effect: move the pack onto the next clear spot.', detail: 'Gathios, Veras and melee follow 1 → 2 → 3 → 4 when AoE lands. Old patches remain; every destination needs to be clear.' }],
            interrupts: [{ id: 'physical', title: 'No immunity: the assigned physical kick stops the heal.', detail: 'Stop every Circle of Healing and cover Divine Wrath. Reflective Shield does not itself prevent interrupts.' }, { id: 'protection', title: 'Protection: magical interrupt takes over.', detail: 'Physical kicks are blocked. The assigned Earth Shock or Counterspell stops the heal.' }, { id: 'warding', title: 'Spell Warding: physical interrupt takes over.', detail: 'Magic is blocked. Use Kick, Pummel or Shield Bash. These are separate immunity examples.' }],
            hazards: [{ id: 'spread', title: 'Blizzard or Flamestrike: move immediately.', detail: 'Affected players leave the patch, then resume their jobs from safe ground. Keep tank healing covered.' }],
            poison: [{ id: 'vanish', title: 'Heal poison through Envenom; prepare Veras’s pickup.', detail: 'The poison healer follows the targets through the finishing burst. Veras’s tank reacquires him on return.' }],
            mage: [{ id: 'range', title: 'Keep stolen Dampen Magic and tank Zerevor at range.', detail: 'Stay more than 10 yards away and in healing reach. When the boss reapplies Dampen, cancel the old stolen buff only immediately before re-stealing.' }],
            kite: [{ id: 'secure', title: 'Optional mage ramp kite.', detail: 'Secure threat first, follow the practiced ramp route and recover within healing reach at the bottom. Renew stolen protection when needed.' }],
            cycle: [{ id: 'opening', title: 'Optional combined Council example.', detail: 'Follow the coordinated pull, pack movement, interrupt handoff and poison recovery. Real mechanics overlap; this sequence is illustrative.' }]
        },
        'bt-mother': {
            saber: [{ id: 'tank-stack', title: 'Three tanks share Saber Lash.', detail: 'Keep the tank stack together and heal it continuously.' }],
            attraction: [{ id: 'split', title: 'Split until every pair is 25 yards apart.', detail: 'Choose different open paths away from the raid. Keep moving until your effects clear.' }],
            return: [{ id: 'return-safe', title: 'All pairs clear: return safely.', detail: 'One runner being clear is not enough; the distant runner uses available personal recovery if needed.' }],
            beams: [{ id: 'beam-hit', title: 'Recover the beam hit outside Shriek range.', detail: 'Respond to the direct hit, knockup, DoT or mana drain that occurred; return to the statue group.' }],
            finish: [{ id: 'ten-percent', title: 'At 10%, burn in formation.', detail: 'Tanks use survival cooldowns. Healers keep their assignments; damage finishes the boss.' }],
            cycle: [{ id: 'positions', title: 'Optional full Mother Shahraz cycle.', detail: 'Follow the uninterrupted formation, separation, recovery and finish.' }],
            door: [{ id: 'plan', title: 'Optional door formation.', detail: 'Landmarks change; Saber Lash, Shriek and Fatal Attraction rules do not.' }]
        }
    };
    const optionalSceneNames = new Set(['cycle', 'aoe', 'door', 'kite']);

    // Keep each two-second walk at normal speed; shorten only stationary waits.
    function rotationTimeline(waves, end) {
        const points = [[0, 0]];
        let elapsed = 0;
        waves.forEach(at => {
            points.push([elapsed += 500, at], [elapsed += 500, at + 1000], [elapsed += 2000, at + 3000]);
        });
        points.push([elapsed + 500, end]);
        return Object.freeze(points.map(point => Object.freeze(point)));
    }
    function mapTime(points, time, from, to) {
        const next = points.findIndex(point => point[from] >= time);
        if (next <= 0) return points[next === 0 ? 0 : points.length - 1][to];
        const a = points[next - 1], b = points[next];
        return a[to] + (b[to] - a[to]) * (time - a[from]) / (b[from] - a[from]);
    }

    function sourceStep(source, sceneId, sourceTimeMs) {
        const rows = source.forScene(sceneId);
        if (!rows.length) return null;
        const time = Number.isFinite(sourceTimeMs) ? sourceTimeMs : rows[0].startMs;
        const containing = rows.filter(item => item.startMs <= time && time <= item.holdAtMs);
        const pool = containing.length ? containing : rows.filter(item => item.startMs <= time);
        return pool.length ? pool.reduce((latest, item) => item.startMs >= latest.startMs ? item : latest) : rows[0];
    }

    function makeFight(fightId) {
        const source = STEPS.forFight(fightId);
        const fightData = DATA && DATA.FIGHTS && Object.hasOwn(DATA.FIGHTS, fightId) ? DATA.FIGHTS[fightId] : null;
        const sceneData = fightData ? new Map(fightData.scenes.map(scene => [scene.id, scene])) : null;
        const fightGroups = Object.hasOwn(groups, fightId) ? groups[fightId] : null;
        const order = source.order.filter(sceneId => !sceneData || sceneData.has(sceneId));
        const optionalScenes = order.filter(sceneId => optionalSceneNames.has(sceneId) || sceneData?.get(sceneId)?.optional);
        const primaryOrder = order.filter(sceneId => !optionalScenes.includes(sceneId));
        const chapters = new Map();

        order.forEach(sceneId => {
            const rows = source.forScene(sceneId);
            if (!rows.length) return;
            const isStatic = rows.length === 1 && rows[0].startMs === 0 && rows[0].holdAtMs === 0;
            const configured = fightGroups && Object.hasOwn(fightGroups, sceneId) ? fightGroups[sceneId] : sceneData?.get(sceneId)?.briefing;
            if (!configured && !isStatic) throw new Error('Missing briefing groups for ' + fightId + ':' + sceneId);
            const specs = configured || [{ id: rows[0].id, title: rows[0].title, detail: rows[0].detail }];
            const sourceById = new Map(rows.map(item => [item.id, item]));
            const starts = specs.map(spec => {
                if (!Object.hasOwn(spec, 'id') || !sourceById.has(spec.id)) throw new Error('Unknown briefing source id for ' + fightId + ':' + sceneId + ':' + spec.id);
                if (!spec.title || !spec.detail) throw new Error('Missing briefing copy for ' + fightId + ':' + sceneId + ':' + spec.id);
                return sourceById.get(spec.id);
            });
            const sourceEnd = Math.max(...rows.map(item => item.holdAtMs));
            const declaredDuration = sceneData && sceneData.get(sceneId) ? sceneData.get(sceneId).duration || 0 : 0;
            const sceneStart = Math.min(...rows.map(item => item.startMs));
            const sceneEnd = isStatic ? 0 : Math.max(sourceEnd, declaredDuration);
            const merged = starts.map((first, localIndex) => {
                const spec = specs[localIndex];
                const startMs = localIndex === 0 ? sceneStart : first.startMs;
                const holdAtMs = localIndex + 1 < starts.length ? starts[localIndex + 1].startMs - 1 : sceneEnd;
                return {
                    ...first,
                    id: first.id,
                    title: spec.title || first.title,
                    detail: spec.detail || first.detail,
                    startMs,
                    holdAtMs,
                    sampleMs: startMs,
                    range: [startMs, holdAtMs],
                    localIndex,
                    count: starts.length,
                    sceneId,
                    chapterId: sceneId,
                    optional: optionalScenes.includes(sceneId) || !!first.optional,
                    loop: spec.loop === 'repeat' ? 'repeat' : 'hold',
                    playbackTimeline: spec.shortenRotationWaits ? rotationTimeline(sceneData.get(sceneId).sequence.waves, sceneEnd) : null,
                    countdownSeconds: sceneId === 'spite' && first.id === 'spite-countdown' ? 6 : 0
                };
            });
            chapters.set(sceneId, merged);
        });
        const allSteps = order.flatMap(sceneId => chapters.get(sceneId) || []).map((item, index) => Object.freeze({ ...item, index, range: Object.freeze([...item.range]) }));
        const byId = new Map(allSteps.map(item => [item.sceneId + ':' + item.id, item]));
        const forScene = sceneId => allSteps.filter(item => item.sceneId === sceneId);
        const indexFor = (sceneId, sourceTimeMs) => {
            const item = sourceStep({ forScene }, sceneId, sourceTimeMs);
            return item ? item.index : -1;
        };
        return Object.freeze({
            order: Object.freeze([...order]), optionalScenes: Object.freeze(optionalScenes), primaryOrder: Object.freeze(primaryOrder),
            forScene, all: () => allSteps, get: (sceneId, id) => byId.get(sceneId + ':' + id) || null,
            frameAt: (item, elapsedMs) => {
                const elapsed = Math.max(0, elapsedMs), duration = item.playbackTimeline ? item.playbackTimeline.at(-1)[0] : item.holdAtMs - item.startMs;
                if (item.playbackTimeline) return mapTime(item.playbackTimeline, item.loop === 'repeat' ? elapsed % duration : elapsed, 0, 1);
                return item.loop === 'repeat' && duration > 0
                    ? item.startMs + elapsed % duration
                    : Math.min(item.holdAtMs, item.startMs + elapsed);
            },
            countdownAt: (item, elapsedMs) => item.countdownSeconds ? Math.max(0, Math.ceil((item.countdownSeconds * 1000 - elapsedMs) / 1000)) : null,
            indexFor,
            sourceStep: (sceneId, sourceTimeMs) => sourceStep(source, sceneId, sourceTimeMs),
            timelineFor(sceneId, sourceTimeMs) { const index = indexFor(sceneId, sourceTimeMs), item = allSteps[index]; if (!item) return null; const time = Math.max(item.startMs, Math.min(item.holdAtMs, sourceTimeMs)); return { index, localIndex: item.localIndex, elapsedMs: item.playbackTimeline ? mapTime(item.playbackTimeline, time, 1, 0) : time - item.startMs, sourceTimeMs: time, sampleMs: item.startMs, range: [...item.range], step: item }; },
            chapterBoundary(sceneId, localIndex) { const chapterIndex = order.indexOf(sceneId), nextSceneId = order[chapterIndex + (localIndex < 0 ? -1 : 1)]; if (!nextSceneId) return null; const chapter = forScene(nextSceneId); return { sceneId: nextSceneId, localIndex: localIndex < 0 ? Math.max(0, chapter.length - 1) : 0 }; }
        });
    }
    const registries = Object.create(null);
    (DATA && DATA.FIGHTS ? Object.keys(DATA.FIGHTS) : STEPS.fights).forEach(fightId => { registries[fightId] = makeFight(fightId); });
    const empty = makeFight('__unknown__');
    return { forFight: fightId => Object.hasOwn(registries, fightId) ? registries[fightId] : empty, fights: Object.keys(registries) };
}));
