(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(require('./assignments-engine.js')); }
    else { root.HyjalPositions = factory(root.AssignmentsEngine); }
}(typeof self !== 'undefined' ? self : this, function (E) {
    'use strict';

    // Every coordinate is a fraction of the map image: x of width, y of height. The map can
    // be swapped for another screenshot of the same viewport without touching code. Distance
    // math converts y through the image aspect so rings stay circular on screen.
    const ENCOUNTERS = {
        'hyjal-b12': {
            id: 'hyjal-b12',
            name: 'Hyjal · Rage Winterchill & Anetheron',
            map: 'maps/hyjal-ballista.png',
            aspect: 1698 / 926,
            bosses: [
                { id: 'winterchill', name: 'Rage Winterchill' },
                { id: 'anetheron', name: 'Anetheron',
                  station: { x: 0.65, y: 0.12, label: 'Infernals → Jaina' } },
            ],
            // Digitized from maps/reference-winterchill-annotated.png (same viewport).
            anchors: {
                boss: { x: 0.56, y: 0.40 },
                mt: { x: 0.60, y: 0.37 },
                clump: { x: 0.53, y: 0.46 },
            },
            ring: { rBase: 0.145, rJitter: 0.018, startDeg: -90 },
        },
    };

    function slotAngles(n, startDeg) {
        const out = [];
        for (let i = 0; i < n; i++) out.push(startDeg + i * 360 / n);
        return out;
    }

    function angleToXY(center, r, deg, aspect) {
        const rad = deg * Math.PI / 180;
        return { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) * aspect };
    }

    function circGap(a, b) {
        let d = Math.abs(a - b) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    return { ENCOUNTERS, slotAngles, angleToXY, circGap };
}));
