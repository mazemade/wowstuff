(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsRaids = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const raids = {
        bt: { id: 'bt', name: 'Black Temple', shortName: 'BT', location: 'Shadowmoon Valley', image: 'maps/tactics/raid-black-temple.jpg', description: 'Enter the temple. Face the Betrayer.', fights: ['bt-najentus', 'bt-supremus', 'bt-akama', 'bt-bloodboil', 'bt-reliquary', 'bt-mother', 'bt-council', 'bt-illidan'] },
        hyjal: { id: 'hyjal', name: 'Mount Hyjal', shortName: 'Hyjal', location: 'Caverns of Time', image: 'maps/tactics/raid-hyjal.jpg', description: 'Hold the camps. Defend the World Tree.', fights: ['hyjal-winterchill', 'hyjal-anetheron', 'hyjal-kazrogal', 'hyjal-azgalor', 'hyjal-archimonde'] }
    };
    function forFight(fightId) { return Object.values(raids).find(raid => raid.fights.includes(fightId)) || null; }
    function route(search, fights) {
        const params = new URLSearchParams(search), requested = params.get('fight');
        if (requested && Object.hasOwn(fights, requested) && forFight(requested)) return { fight: fights[requested], raid: forFight(requested), invalid: false };
        const raid = Object.hasOwn(raids, params.get('raid')) ? raids[params.get('raid')] : null;
        return { fight: null, raid, invalid: !!requested || (!!params.get('raid') && !raid) };
    }
    return { raids, forFight, route };
}));
