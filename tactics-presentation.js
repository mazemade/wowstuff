(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.TacticsPresentation = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Keep this local rather than deriving it from TacticsData: the browser loads this
    // helper before the data bundle on some briefing pages.
    const supported = new Set([
        'bt-najentus', 'bt-supremus', 'bt-akama', 'bt-reliquary', 'bt-bloodboil',
        'bt-mother', 'bt-council', 'bt-illidan', 'hyjal-winterchill',
        'hyjal-anetheron', 'hyjal-kazrogal', 'hyjal-azgalor', 'hyjal-archimonde'
    ]);
    const quietScenes = new Set(['overview', 'positioning', 'p1-stand', 'door', 'waves']);

    function idsInFight(fight, ids) {
        const available = new Set((fight && fight.abilities || []).map(ability => ability.id));
        return [...new Set(ids)].filter(id => available.has(id));
    }

    function najentusShieldId(frame) {
        if (!frame) return null;
        if (frame.burst && ['burst', 'recover'].includes(frame.stage)) return 'burst';
        if (frame.projectile || frame.stage === 'throw' || (frame.ready && frame.stage === 'ready')) return 'hurl';
        return frame.shield ? 'shield' : null;
    }

    function najentusIds(scene, frame) {
        const sceneId = scene && scene.id;
        if (sceneId === 'needle') return ['needle'];
        if (sceneId === 'impale') return ['impale'];
        if (sceneId === 'shield') return ['shield'];
        if (sceneId === 'burst') return [najentusShieldId(frame)].filter(Boolean);
        if (sceneId !== 'cycle') return [];

        const ids = [];
        if (frame && frame.needles && frame.needles.length) ids.push('needle');
        if (frame && frame.impaled && frame.impaled.length) ids.push('impale');
        const shieldId = najentusShieldId(frame);
        if (shieldId) ids.push(shieldId);
        return ids;
    }

    function winterchillIds(scene, frame) {
        const sceneId = scene && scene.id;
        if (['icebolt', 'dnd', 'nova'].includes(sceneId)) return [sceneId];
        if (sceneId === 'finish' && (!frame || frame.stage !== 'complete')) return ['icebolt', 'dnd'];
        return [];
    }

    function cycleIds(fight, frame) {
        if (!frame || frame.stage === 'complete') return [];
        switch (fight.id) {
        case 'bt-akama':
            return frame.stage === 'fire' ? ['fire']
                : frame.stage === 'aoe' ? ['channel', 'adds']
                    : frame.stage === 'burn' ? ['burn']
                        : ['adds', 'approach'].includes(frame.stage) ? ['adds'] : ['channel'];
        case 'bt-reliquary':
            return ({ fixate: ['fixate'], suffering: ['drain', 'fixate'], souls: ['souls'],
                desire: ['desire'], interrupts: ['shield'], deaden: ['deaden'],
                anger: ['seethe'], spite: ['spite'] })[frame.stage] || [];
        case 'bt-bloodboil':
            if (frame.rage && frame.rage.active) return ['rage'].concat(frame.geyser ? ['geyser'] : []);
            if (frame.stage === 'recovery') return ['wound'];
            return (frame.bloodboil && frame.bloodboil.length ? ['bloodboil'] : []).concat(
                frame.tankDebuffs && Object.keys(frame.tankDebuffs).length ? ['wound'] : []);
        case 'bt-mother':
            if (frame.stage === 'finish') return ['enrage'];
            if (frame.fatal) return ['attraction'];
            if (frame.beam) return ['beam', 'shriek'];
            return frame.saber ? ['saber'] : [];
        case 'bt-council':
            if (frame.poison) return ['poison'];
            if (frame.shield && frame.shield.active) return ['blessings'];
            if (frame.hazards && frame.hazards.length) return ['consecration'];
            return frame.rotationPoints ? ['consecration'] : ['heal'];
        case 'bt-illidan':
            if (frame.prison) return ['trap'];
            if (frame.shadowBlast) return ['shadow', 'demons'];
            if (frame.pickup) return ['agonizing', 'shear'];
            if (frame.flames) return ['flames', 'tether'];
            return frame.shear ? ['shear', 'front'] : [];
        default:
            return [];
        }
    }

    function activeSceneIds(fight, scene, frame) {
        if (fight.id === 'bt-akama') {
            if (scene.id === 'doorways') return frame.npcs && frame.npcs.some(npc => npc.status === 'Healing…' || npc.status === 'Interrupted') ? ['heal'] : ['adds'];
            if (scene.id === 'walk') return frame.stage === 'burn' ? ['burn'] : ['adds'];
            if (scene.id === 'aoe') return frame.stage === 'complete' ? []
                : frame.damageTarget === 'channels' ? ['channel']
                    : frame.damageTarget === 'channels-and-adds' ? ['adds'] : ['burn'];
        }
        if (fight.id === 'bt-council') {
            if (scene.id === 'interrupts') {
                const cast = frame.casts && frame.casts[0];
                if (cast && cast.active) return ['heal'];
                if (frame.shield && frame.shield.active) return ['blessings'];
                return [];
            }
            if (scene.id === 'rotation') return frame.hazards && frame.hazards.length ? ['consecration'] : [];
            if (scene.id === 'hazards') return (frame.hazards || []).map(hazard => hazard.kind.toLowerCase());
            if (scene.id === 'kite') return ['dampen'];
        }
        if (fight.id === 'bt-illidan') {
            if (scene.id === 'ground') return frame.hazards && frame.hazards.length ? ['crash'] : ['shear'];
            if (scene.id === 'parasites') return ['parasites'];
            if (scene.id === 'flames') return ['flames'];
            if (scene.id === 'eye') return ['eye'];
            if (scene.id === 'barrage') return frame.barrage && frame.barrage.active ? ['barrage']
                : frame.fireball && frame.fireball.active ? ['fireball'] : [];
            if (scene.id === 'landing') return frame.agonizing ? ['agonizing'] : ['shear'];
            if (scene.id === 'demon') return frame.demons && frame.demons.length ? ['demons'] : ['shadow'];
            if (scene.id === 'return') return frame.pickup && frame.pickup.controlled ? ['shear'] : ['agonizing'];
            if (scene.id === 'maiev') return frame.trap || frame.prison ? ['trap'] : ['agonizing'];
        }
        return null;
    }

    function generalIds(fight, scene, frame) {
        if (!scene || !frame || quietScenes.has(scene.id) || frame.stage === 'complete') return [];
        if (scene.id === 'cycle') return cycleIds(fight, frame);
        const active = activeSceneIds(fight, scene, frame);
        if (active) return active;
        // A chapter is already the authored explanation of its current mechanic.
        // Limit multi-effect chapters to the two cards a player can act on together.
        return (scene.highlight || []).slice(0, 2);
    }

    function supports(fightId) {
        return supported.has(fightId);
    }

    function abilityIds(fight, scene, frame) {
        if (!fight || !supports(fight.id)) return [];
        const ids = fight.id === 'bt-najentus' ? najentusIds(scene, frame)
            : fight.id === 'hyjal-winterchill' ? winterchillIds(scene, frame)
                : generalIds(fight, scene, frame);
        return idsInFight(fight, ids);
    }

    function spellDescription(fight, ability) {
        if (fight.id === 'hyjal-azgalor' && ability.id === 'rain')
            return 'Targets within 30 yards; covers a 15-yard area for 10 sec. Deals Fire damage every 2 sec and leaves a lingering Fire DoT.';
        return ability.tooltip.spellText || ability.tooltip.description;
    }

    return { supports, abilityIds, spellDescription };
}));
