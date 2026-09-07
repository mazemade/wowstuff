(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsPlayback = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    function create(duration) {
        let offset = 0, anchor = 0, speed = 1, playing = false;
        const clamp = t => Math.max(0, Math.min(duration, t));
        const api = {
            get playing() { return playing; },
            time(now) {
                const t = clamp(offset + (playing ? (now - anchor) * speed : 0));
                if (t >= duration) { offset = duration; playing = false; }
                return t;
            },
            play(now) { offset = api.time(now); if (offset >= duration) offset = 0; anchor = now; playing = true; },
            pause(now) { offset = api.time(now); playing = false; },
            seek(t, now) { offset = clamp(t); anchor = now; },
            setSpeed(value, now) { offset = api.time(now); anchor = now; speed = value; },
            reset(length, now) { duration = length; offset = 0; anchor = now; playing = false; }
        };
        return api;
    }
    return { create };
}));
