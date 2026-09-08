(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tactics-steps.js'));
    else root.TacticsReliquarySteps = factory(root.TacticsSteps);
}(typeof self !== 'undefined' ? self : this, function (Steps) {
    'use strict';
    return Steps.forFight('bt-reliquary');
}));
