'use strict';
// The feedback page's report cache, in IndexedDB. Loaded by feedback.html and vetting.html.
//
// Reports used to live in localStorage: one ~40 KB entry per player per raid night, never evicted.
// The origin's 5 MB localStorage budget is shared with the vetting and assignments pages, so once
// enough reports had been opened the vetting page's own save() threw for every newly added player
// and a fetched profile turned into an "error" row (2026-09-07, Bejoux and Smellmystaff).
//
// Nothing is evicted here either, on purpose: a raid night's report never goes stale (the log is
// fixed) and rebuilding one costs up to 360 WCL rate-limit points and up to a minute. IndexedDB
// simply has the room. Every method resolves rather than rejects — a cache that cannot be used
// means a report is fetched again, never a page that fails to render.
(function (root) {
    const DB_NAME = 'raidFeedbackCache';
    const STORE = 'reports';
    const PREFIX = 'raidFeedback:'; // the localStorage key prefix reports were stored under before

    let dbPromise = null;
    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(resolve => {
            try {
                const idb = root.indexedDB;
                if (!idb) return resolve(null);
                const req = idb.open(DB_NAME, 1);
                req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (e) { resolve(null); }
        });
        return dbPromise;
    }
    // Runs one request inside one transaction; resolves to the request's result once the
    // transaction has committed, or to undefined when anything about it failed.
    function tx(mode, run) {
        return open().then(db => new Promise(resolve => {
            if (!db) return resolve(undefined);
            try {
                const t = db.transaction(STORE, mode);
                const req = run(t.objectStore(STORE));
                t.oncomplete = () => resolve(req.result);
                t.onerror = () => resolve(undefined);
                t.onabort = () => resolve(undefined);
            } catch (e) { resolve(undefined); }
        }));
    }
    // get(key) -> the stored value, or null.
    function get(key) { return tx('readonly', s => s.get(key)).then(v => (v === undefined ? null : v)); }
    // set(key, value) -> true when stored, false otherwise.
    function set(key, value) { return tx('readwrite', s => s.put(value, key)).then(r => r !== undefined); }

    // Moves every report a previous version left in localStorage into IndexedDB, freeing the
    // shared budget. Resolves to the number moved. An entry is only removed once it is safely
    // stored; one that does not parse is dropped, since it could never have rendered anyway.
    function migrate() {
        const keys = [];
        try {
            for (let i = 0; i < root.localStorage.length; i++) {
                const k = root.localStorage.key(i);
                if (k && k.indexOf(PREFIX) === 0) keys.push(k);
            }
        } catch (e) { return Promise.resolve(0); }
        const remove = k => { try { root.localStorage.removeItem(k); } catch (e) { /* nothing to free */ } };
        return keys.reduce((p, k) => p.then(n => {
            let value;
            try { value = JSON.parse(root.localStorage.getItem(k)); } catch (e) { remove(k); return n; }
            return set(k, value).then(ok => { if (!ok) return n; remove(k); return n + 1; });
        }), Promise.resolve(0));
    }

    root.FeedbackCache = { get, set, migrate, PREFIX };
})(typeof window !== 'undefined' ? window : this);
