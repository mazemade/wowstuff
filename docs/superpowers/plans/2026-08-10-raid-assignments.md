# Raid Assignments Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new fight-independent page in the wowstuff raid tool that imports a 25-man TBC roster (Raid-Helper API and/or in-game addon scan), auto-assigns boss debuffs, cooldown targets, and CC marks, and outputs the assignments as a Discord block (with @pings), share link, /raid macros, or whispers.

**Architecture:** Pure-logic engine (`assignments-engine.js`, UMD: browser global + Node module) with a static debuff catalog and deterministic auto-assign; thin DOM layer (`assignments.js`); Express proxy route for the CORS-locked Raid-Helper API; standalone WoW addon (`RaidSpecScan`) that exports raw talent triples which the web side turns into specs.

**Tech Stack:** Vanilla HTML/JS/CSS (no build step, matches repo), Express (existing `server.js`), plain-Node test script, WoW TBC Classic Lua addon.

**Spec:** `docs/superpowers/specs/2026-08-10-raid-assignments-design.md`

## Global Constraints

- Vanilla JS only — no frameworks, no build step, files served statically like the existing pages.
- `assignments-engine.js` must load in both browser (`window.AssignmentsEngine`) and Node (`module.exports`) via the UMD wrapper shown in Task 1.
- Node ≥ 18 required (global `fetch` in the proxy route). Railway's default Node satisfies this.
- Tests run with `node assignments-engine.test.js`; non-zero exit code on any failure; no test framework.
- Visual style: existing `style.css` dark theme + gold (`#ffd700`) accents; WoW class colors from the `CLASS_COLORS` constant.
- Class identifiers are uppercase tokens (`WARRIOR`, `WARLOCK`, …); spec names are the display strings in `SPEC_TREES` (e.g. `'Affliction'`, `'Beast Mastery'`).
- Player objects everywhere: `{name, class, spec, discordId?, flags: [], source?}`. Duty objects: `{id, name, category: 'debuffs'|'cooldowns', player: string|null, target?: string}`. The special target sentinel `'HEALER_RESERVE'` renders as "healer in need".
- Git commits: imperative present tense like the repo history, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine scaffold, constants, spec inference

**Files:**
- Create: `assignments-engine.js`
- Create: `assignments-engine.test.js`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: UMD module `AssignmentsEngine` exposing `SPEC_TREES` (object: CLASS→[3 tree names]), `CLASS_COLORS` (CLASS→hex), `inferSpec(cls, points)` → `{spec: string|null, ambiguous: boolean}` where `points` is a 3-element number array. Also the test harness pattern (`test(name, fn)`) that every later engine task extends.

- [ ] **Step 1: Write the failing test**

Create `assignments-engine.test.js`:

```js
'use strict';
const assert = require('node:assert');
const E = require('./assignments-engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok -', name); }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

// --- Task 1: inferSpec ---
test('inferSpec: deep prot warrior', () => {
    assert.deepStrictEqual(E.inferSpec('WARRIOR', [5, 5, 51]), { spec: 'Protection', ambiguous: false });
});
test('inferSpec: affliction lock', () => {
    assert.deepStrictEqual(E.inferSpec('WARLOCK', [41, 7, 13]), { spec: 'Affliction', ambiguous: false });
});
test('inferSpec: shallow hybrid is ambiguous but guessed', () => {
    const r = E.inferSpec('DRUID', [21, 20, 20]);
    assert.strictEqual(r.spec, 'Balance');
    assert.strictEqual(r.ambiguous, true);
});
test('inferSpec: exact tie is ambiguous', () => {
    assert.strictEqual(E.inferSpec('MAGE', [30, 30, 1]).ambiguous, true);
});
test('inferSpec: zero points gives null spec', () => {
    assert.deepStrictEqual(E.inferSpec('PRIEST', [0, 0, 0]), { spec: null, ambiguous: true });
});
test('inferSpec: unknown class gives null', () => {
    assert.deepStrictEqual(E.inferSpec('DEATHKNIGHT', [51, 0, 0]), { spec: null, ambiguous: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node assignments-engine.test.js`
Expected: crash with `Cannot find module './assignments-engine.js'`

- [ ] **Step 3: Write minimal implementation**

Create `assignments-engine.js`:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.AssignmentsEngine = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SPEC_TREES = {
        WARRIOR: ['Arms', 'Fury', 'Protection'],
        PALADIN: ['Holy', 'Protection', 'Retribution'],
        HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
        ROGUE: ['Assassination', 'Combat', 'Subtlety'],
        PRIEST: ['Discipline', 'Holy', 'Shadow'],
        SHAMAN: ['Elemental', 'Enhancement', 'Restoration'],
        MAGE: ['Arcane', 'Fire', 'Frost'],
        WARLOCK: ['Affliction', 'Demonology', 'Destruction'],
        DRUID: ['Balance', 'Feral', 'Restoration'],
    };

    const CLASS_COLORS = {
        WARRIOR: '#C69B6D', PALADIN: '#F48CBA', HUNTER: '#AAD372',
        ROGUE: '#FFF468', PRIEST: '#FFFFFF', SHAMAN: '#0070DD',
        MAGE: '#3FC7EB', WARLOCK: '#8788EE', DRUID: '#FF7C0A',
    };

    // points: [tree1, tree2, tree3] spent talent points.
    // Ambiguous when no tree reaches 31 (no defining talent) or the top two tie.
    function inferSpec(cls, points) {
        const trees = SPEC_TREES[cls];
        if (!trees) return { spec: null, ambiguous: true };
        const total = points[0] + points[1] + points[2];
        if (!total) return { spec: null, ambiguous: true };
        let max = 0;
        for (let i = 1; i < 3; i++) if (points[i] > points[max]) max = i;
        const sorted = points.slice().sort((a, b) => b - a);
        const ambiguous = points[max] < 31 || sorted[0] === sorted[1];
        return { spec: trees[max], ambiguous };
    }

    return {
        SPEC_TREES, CLASS_COLORS,
        inferSpec,
    };
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node assignments-engine.test.js`
Expected: `6 passed, 0 failed`, exit code 0

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add assignments engine scaffold with spec inference"
```

---

### Task 2: Addon export parser

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `inferSpec`, `SPEC_TREES` from Task 1.
- Produces: `parseAddonExport(text)` → `{players: Player[], errors: string[]}`. Accepted format: tokens separated by `;` or newlines; optional `RSS1` header token; each player token `Name:CLASS:t1/t2/t3` or `Name:CLASS:?` (unscanned). Unscanned → flag `'spec-unknown'`; ambiguous triple → flag `'spec-ambiguous'` (spec still set to best guess). `source: 'addon'` on every player.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js` (above the final summary lines — all later tasks append in the same place):

```js
// --- Task 2: parseAddonExport ---
test('parseAddonExport: happy path with header', () => {
    const r = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/5/51;Bob:WARLOCK:41/7/13');
    assert.strictEqual(r.errors.length, 0);
    assert.deepStrictEqual(r.players[0], { name: 'Thunderfist', class: 'WARRIOR', spec: 'Protection', flags: [], source: 'addon' });
    assert.strictEqual(r.players[1].spec, 'Affliction');
});
test('parseAddonExport: newline separated works', () => {
    const r = E.parseAddonExport('Frostina:MAGE:10/48/3\nStabby:ROGUE:15/41/5');
    assert.strictEqual(r.players.length, 2);
    assert.strictEqual(r.players[0].spec, 'Fire');
});
test('parseAddonExport: unscanned player flagged spec-unknown', () => {
    const r = E.parseAddonExport('Afkguy:HUNTER:?');
    assert.strictEqual(r.players[0].spec, null);
    assert.deepStrictEqual(r.players[0].flags, ['spec-unknown']);
});
test('parseAddonExport: ambiguous build flagged but keeps guess', () => {
    const r = E.parseAddonExport('Hybrid:DRUID:21/20/20');
    assert.strictEqual(r.players[0].spec, 'Balance');
    assert.deepStrictEqual(r.players[0].flags, ['spec-ambiguous']);
});
test('parseAddonExport: junk lines collected as errors', () => {
    const r = E.parseAddonExport('RSS1;garbage here;Bob:WARLOCK:41/7/13;Nope:BADCLASS:1/2/3');
    assert.strictEqual(r.players.length, 1);
    assert.strictEqual(r.errors.length, 2);
});
test('parseAddonExport: empty input gives empty result', () => {
    assert.deepStrictEqual(E.parseAddonExport(''), { players: [], errors: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 6 new FAIL lines (`E.parseAddonExport is not a function`), exit code 1

- [ ] **Step 3: Implement**

Add to `assignments-engine.js` (below `inferSpec`), and add `parseAddonExport` to the returned object:

```js
    function parseAddonExport(text) {
        const players = [];
        const errors = [];
        const tokens = (text || '').trim().split(/[\n;]+/).map(t => t.trim()).filter(Boolean);
        tokens.forEach(tok => {
            if (/^RSS\d+$/i.test(tok)) return; // format header
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
            const cls = m[2].toUpperCase();
            if (!SPEC_TREES[cls]) { errors.push('Unknown class in: ' + tok); return; }
            const flags = [];
            let spec = null;
            if (m[3] === undefined) {
                flags.push('spec-unknown');
            } else {
                const r = inferSpec(cls, [Number(m[3]), Number(m[4]), Number(m[5])]);
                spec = r.spec;
                if (!spec) flags.push('spec-unknown');
                else if (r.ambiguous) flags.push('spec-ambiguous');
            }
            players.push({ name: m[1], class: cls, spec, flags, source: 'addon' });
        });
        return { players, errors };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `12 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add addon export parser with spec inference flags"
```

---

### Task 3: Raid-Helper parser

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `SPEC_TREES`.
- Produces: `parseRaidHelper(eventJson)` → `{players: Player[], excluded: [{name, reason}], errors: string[], title: string}`. Reads `eventJson.signUps` (Raid-Helper v2 event shape). Signups whose `className` is a status pseudo-class (`Bench`, `Late`, `Tentative`, `Absence`) or whose `status` isn't `'primary'` go to `excluded`. `userId` becomes `discordId` (string). Spec names are normalized (trailing digits stripped, `Beastmastery`→`Beast Mastery`, `Guardian`→`Feral`); unknown specs → `spec: null` + flag `'spec-unknown'`. `source: 'raidhelper'`.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Task 3: parseRaidHelper ---
function rhFixture() {
    return {
        title: 'SSC Tuesday',
        signUps: [
            { name: 'Dave', className: 'Warlock', specName: 'Affliction', userId: 111, status: 'primary' },
            { name: 'Pyro', className: 'Mage', specName: 'Fire', userId: '222', status: 'primary' },
            { name: 'Benchy', className: 'Bench', specName: 'Bench', userId: 333, status: 'primary' },
            { name: 'Maybe', className: 'Rogue', specName: 'Combat', userId: 444, status: 'queued' },
            { name: 'Tanky', className: 'Paladin', specName: 'Protection1', userId: 555, status: 'primary' },
            { name: 'Petguy', className: 'Hunter', specName: 'Beastmastery', userId: 666, status: 'primary' },
            { name: 'Wat', className: 'Boomkin', specName: 'Balance', userId: 777, status: 'primary' },
            { name: 'NoSpec', className: 'Priest', specName: 'Flex', userId: 888, status: 'primary' },
        ],
    };
}
test('parseRaidHelper: primary signups become players with discordId', () => {
    const r = E.parseRaidHelper(rhFixture());
    const dave = r.players.find(p => p.name === 'Dave');
    assert.deepStrictEqual(dave, { name: 'Dave', class: 'WARLOCK', spec: 'Affliction', discordId: '111', flags: [], source: 'raidhelper' });
    assert.strictEqual(r.title, 'SSC Tuesday');
});
test('parseRaidHelper: bench and non-primary are excluded with reasons', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.deepStrictEqual(r.excluded, [{ name: 'Benchy', reason: 'Bench' }, { name: 'Maybe', reason: 'queued' }]);
});
test('parseRaidHelper: spec names normalized', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.strictEqual(r.players.find(p => p.name === 'Tanky').spec, 'Protection');
    assert.strictEqual(r.players.find(p => p.name === 'Petguy').spec, 'Beast Mastery');
});
test('parseRaidHelper: unknown class is an error, unknown spec is flagged', () => {
    const r = E.parseRaidHelper(rhFixture());
    assert.strictEqual(r.errors.length, 1);
    assert.ok(r.errors[0].includes('Boomkin'));
    const ns = r.players.find(p => p.name === 'NoSpec');
    assert.strictEqual(ns.spec, null);
    assert.deepStrictEqual(ns.flags, ['spec-unknown']);
});
test('parseRaidHelper: empty event reports error', () => {
    const r = E.parseRaidHelper({});
    assert.deepStrictEqual(r.players, []);
    assert.strictEqual(r.errors.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 5 new FAIL lines, exit code 1

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`, and add `parseRaidHelper` to the returned object:

```js
    const RH_STATUS_CLASSES = ['Bench', 'Late', 'Tentative', 'Absence'];
    const RH_CLASS_NAMES = {
        Warrior: 'WARRIOR', Paladin: 'PALADIN', Hunter: 'HUNTER', Rogue: 'ROGUE',
        Priest: 'PRIEST', Shaman: 'SHAMAN', Mage: 'MAGE', Warlock: 'WARLOCK', Druid: 'DRUID',
    };
    const RH_SPEC_ALIASES = { Beastmastery: 'Beast Mastery', Guardian: 'Feral' };

    function parseRaidHelper(eventJson) {
        const players = [];
        const excluded = [];
        const errors = [];
        const signUps = (eventJson && eventJson.signUps) || [];
        if (!Array.isArray(signUps) || !signUps.length) errors.push('No signups found in event');
        signUps.forEach(su => {
            const rawClass = su.className || '';
            if (RH_STATUS_CLASSES.includes(rawClass)) { excluded.push({ name: su.name, reason: rawClass }); return; }
            if (su.status && su.status !== 'primary') { excluded.push({ name: su.name, reason: su.status }); return; }
            const cls = RH_CLASS_NAMES[rawClass];
            if (!cls) { errors.push('Unknown class "' + rawClass + '" for ' + su.name); return; }
            let spec = (su.specName || '').replace(/\d+$/, '');
            spec = RH_SPEC_ALIASES[spec] || spec;
            const flags = [];
            if (!SPEC_TREES[cls].includes(spec)) { spec = null; flags.push('spec-unknown'); }
            players.push({
                name: su.name, class: cls, spec,
                discordId: su.userId !== undefined && su.userId !== null ? String(su.userId) : null,
                flags, source: 'raidhelper',
            });
        });
        return { players, excluded, errors, title: (eventJson && eventJson.title) || '' };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `17 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add Raid-Helper event parser with status filtering"
```

---

### Task 4: Roster merge and identity linking

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Player shape from Tasks 2–3.
- Produces: `mergeRosters(addonPlayers, rhPlayers, linkMap)` → `{roster: Player[], unmatched: {addon: Player[], raidhelper: Player[]}, mismatches: [{name, signed, actual}]}`. `linkMap` maps `discordId` → character name (persisted by the UI). Addon data wins for class/spec; matched Raid-Helper signups contribute `discordId`; spec disagreement adds flag `'signed-as:<spec>'` and a `mismatches` entry. If `addonPlayers` is empty the Raid-Helper players ARE the roster. `unmatched.addon` = roster entries with no `discordId` after merging; `unmatched.raidhelper` = signups matched to nobody.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Task 4: mergeRosters ---
function P(name, cls, spec, extra) {
    return Object.assign({ name, class: cls, spec, flags: [] }, extra || {});
}
test('mergeRosters: exact case-insensitive match attaches discordId', () => {
    const r = E.mergeRosters([P('Bob', 'WARLOCK', 'Affliction')], [P('bob', 'WARLOCK', 'Affliction', { discordId: '1' })], {});
    assert.strictEqual(r.roster[0].discordId, '1');
    assert.strictEqual(r.unmatched.raidhelper.length, 0);
});
test('mergeRosters: linkMap match beats name mismatch', () => {
    const r = E.mergeRosters([P('Grimshade', 'WARLOCK', 'Destruction')], [P('Dave', 'WARLOCK', 'Destruction', { discordId: '9' })], { 9: 'Grimshade' });
    assert.strictEqual(r.roster[0].discordId, '9');
});
test('mergeRosters: unique fuzzy containment matches', () => {
    const r = E.mergeRosters([P('Frostina', 'MAGE', 'Fire')], [P('frosti', 'MAGE', 'Fire', { discordId: '2' })], {});
    assert.strictEqual(r.roster[0].discordId, '2');
});
test('mergeRosters: spec disagreement flags and reports, addon wins', () => {
    const r = E.mergeRosters([P('Moonpie', 'DRUID', 'Balance')], [P('Moonpie', 'DRUID', 'Restoration', { discordId: '3' })], {});
    assert.strictEqual(r.roster[0].spec, 'Balance');
    assert.ok(r.roster[0].flags.includes('signed-as:Restoration'));
    assert.deepStrictEqual(r.mismatches, [{ name: 'Moonpie', signed: 'Restoration', actual: 'Balance' }]);
});
test('mergeRosters: unmatched on both sides reported', () => {
    const r = E.mergeRosters([P('Xx', 'ROGUE', 'Combat')], [P('TotallyDifferent', 'ROGUE', 'Combat', { discordId: '4' })], {});
    assert.strictEqual(r.unmatched.raidhelper.length, 1);
    assert.strictEqual(r.unmatched.addon.length, 1);
});
test('mergeRosters: no addon players means raid-helper is the roster', () => {
    const r = E.mergeRosters([], [P('Dave', 'WARLOCK', 'Affliction', { discordId: '1' })], {});
    assert.strictEqual(r.roster.length, 1);
    assert.strictEqual(r.roster[0].name, 'Dave');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 6 new FAIL lines

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`, and add `mergeRosters` to the returned object:

```js
    function normName(s) { return (s || '').toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, ''); }

    function mergeRosters(addonPlayers, rhPlayers, linkMap) {
        linkMap = linkMap || {};
        const unmatched = { addon: [], raidhelper: [] };
        const mismatches = [];
        if (!addonPlayers || !addonPlayers.length) {
            return { roster: (rhPlayers || []).map(p => Object.assign({}, p)), unmatched, mismatches };
        }
        const roster = addonPlayers.map(p => Object.assign({}, p, { flags: (p.flags || []).slice() }));
        (rhPlayers || []).forEach(rh => {
            let m = null;
            if (rh.discordId && linkMap[rh.discordId]) {
                m = roster.find(p => p.name === linkMap[rh.discordId]) || null;
            }
            if (!m) m = roster.find(p => normName(p.name) === normName(rh.name)) || null;
            if (!m) {
                const a = normName(rh.name);
                const cands = roster.filter(p => {
                    const b = normName(p.name);
                    return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
                });
                if (cands.length === 1) m = cands[0];
            }
            if (m) {
                m.discordId = rh.discordId;
                if (rh.spec && m.spec && rh.spec !== m.spec) {
                    m.flags.push('signed-as:' + rh.spec);
                    mismatches.push({ name: m.name, signed: rh.spec, actual: m.spec });
                }
            } else {
                unmatched.raidhelper.push(rh);
            }
        });
        roster.forEach(p => { if (!p.discordId) unmatched.addon.push(p); });
        return { roster, unmatched, mismatches };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `23 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add roster merge with fuzzy matching and persistent link map"
```

---

### Task 5: Debuff catalog and auto-assignment

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Player shape; `P()` test helper from Task 4.
- Produces: `DEBUFF_CATALOG` (exported array), `PASSIVES` (exported array), and `autoAssign(roster, overrides)` → `{duties: Duty[], uncovered: [{id, name}], passives: [{name, player}]}`. `overrides` maps duty id → `{player?: string, target?: string}`; an override wins even if the player is "ineligible" by preference (user's choice). Exclusivity: one `curse`-group duty per warlock, one `judgement`-group duty per paladin. Players flagged `'spec-unknown'` are never auto-picked. Warlocks without a curse get personal duty `curse:<Name>`. Duty ids produced here: `sunder`, `coe`, `cor`, `jow`, `jol`, `joc`, `scorch`, `ff`, `hm`, `demo`, `curse:<Name>`. (Task 6 adds `innervate:<i>`, `soulstone:0`.)

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Task 5: autoAssign debuffs ---
function fullRoster() {
    return [
        P('Thunderfist', 'WARRIOR', 'Protection'), P('Smashy', 'WARRIOR', 'Arms'),
        P('Bob', 'WARLOCK', 'Affliction'), P('Grimshade', 'WARLOCK', 'Destruction'), P('Doomlord', 'WARLOCK', 'Demonology'),
        P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'), P('Bubbles', 'PALADIN', 'Protection'),
        P('Frostina', 'MAGE', 'Fire'), P('Sheepmaster', 'MAGE', 'Frost'),
        P('Moonpie', 'DRUID', 'Balance'), P('Treebeard', 'DRUID', 'Restoration'),
        P('Shadowmel', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy'),
        P('Legolass', 'HUNTER', 'Marksmanship'), P('Stabby', 'ROGUE', 'Combat'),
    ];
}
function duty(r, id) { return r.duties.find(d => d.id === id); }

test('autoAssign: full comp covers all core debuffs with right players', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'sunder').player, 'Thunderfist'); // prot preferred
    assert.strictEqual(duty(r, 'coe').player, 'Bob');            // affliction preferred
    assert.ok(['Grimshade', 'Doomlord'].includes(duty(r, 'cor').player));
    assert.strictEqual(duty(r, 'jow').player, 'Retdin');
    assert.strictEqual(duty(r, 'jol').player, 'Lightbringer');
    assert.ok(duty(r, 'joc'));                                   // 3 paladins present
    assert.strictEqual(duty(r, 'scorch').player, 'Frostina');    // fire required
    assert.strictEqual(duty(r, 'ff').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hm').player, 'Legolass');
    assert.strictEqual(duty(r, 'demo').player, 'Smashy');        // arms/fury preferred over tank
    assert.strictEqual(r.uncovered.length, 0);
});
test('autoAssign: one curse per warlock, spare lock gets personal curse', () => {
    const r = E.autoAssign(fullRoster(), {});
    const lockDuties = r.duties.filter(d => ['Bob', 'Grimshade', 'Doomlord'].includes(d.player));
    const curseHolders = new Set(r.duties.filter(d => ['coe', 'cor'].includes(d.id)).map(d => d.player));
    assert.strictEqual(curseHolders.size, 2);
    const spare = ['Bob', 'Grimshade', 'Doomlord'].find(n => !curseHolders.has(n));
    assert.ok(duty(r, 'curse:' + spare));
});
test('autoAssign: no paladins puts judgements in uncovered, joc omitted', () => {
    const roster = fullRoster().filter(p => p.class !== 'PALADIN');
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.some(u => u.id === 'jow'));
    assert.ok(r.uncovered.some(u => u.id === 'jol'));
    assert.ok(!r.uncovered.some(u => u.id === 'joc'));
    assert.ok(!duty(r, 'joc'));
});
test('autoAssign: only 2 paladins means no joc row at all', () => {
    const roster = fullRoster().filter(p => p.name !== 'Bubbles');
    const r = E.autoAssign(roster, {});
    assert.ok(!duty(r, 'joc'));
    assert.ok(!r.uncovered.some(u => u.id === 'joc'));
});
test('autoAssign: no warriors falls back demo shout to Curse of Weakness', () => {
    const roster = fullRoster().filter(p => p.class !== 'WARRIOR');
    const r = E.autoAssign(roster, {});
    const demo = duty(r, 'demo');
    assert.strictEqual(demo.name, 'Curse of Weakness');
    assert.strictEqual(r.duties.filter(d => d.player === demo.player && ['coe', 'cor', 'demo'].includes(d.id)).length, 1);
    assert.ok(r.uncovered.some(u => u.id === 'sunder'));
});
test('autoAssign: manual override wins and displaced lock still gets a curse duty', () => {
    const r = E.autoAssign(fullRoster(), { coe: { player: 'Grimshade' } });
    assert.strictEqual(duty(r, 'coe').player, 'Grimshade');
    assert.ok(r.duties.some(d => d.player === 'Bob' && (d.id === 'cor' || d.id === 'curse:Bob')));
});
test('autoAssign: spec-unknown players are never auto-picked', () => {
    const roster = [P('Mystery', 'MAGE', null, { flags: ['spec-unknown'] })];
    const r = E.autoAssign(roster, {});
    assert.ok(r.uncovered.some(u => u.id === 'scorch'));
});
test('autoAssign: passives detected from comp', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.ok(r.passives.some(p => p.name === 'Misery' && p.player === 'Shadowmel'));
    assert.ok(r.passives.some(p => p.name === 'Blood Frenzy' && p.player === 'Smashy'));
    assert.ok(r.passives.some(p => p.name === "Winter's Chill" && p.player === 'Sheepmaster'));
});
test('autoAssign: empty roster gives all core debuffs uncovered', () => {
    const r = E.autoAssign([], {});
    assert.strictEqual(r.duties.length, 0);
    assert.ok(r.uncovered.length >= 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 9 new FAIL lines

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`, and add `DEBUFF_CATALOG`, `PASSIVES`, `autoAssign` to the returned object:

```js
    const DEBUFF_CATALOG = [
        { id: 'sunder', name: 'Sunder Armor', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Protection'] },
        { id: 'coe', name: 'Curse of Elements', category: 'debuffs', class: 'WARLOCK', preferSpecs: ['Affliction'], group: 'curse' },
        { id: 'cor', name: 'Curse of Recklessness', category: 'debuffs', class: 'WARLOCK', preferSpecs: [], group: 'curse' },
        { id: 'jow', name: 'Judgement of Wisdom', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Retribution'], group: 'judgement' },
        { id: 'jol', name: 'Judgement of Light', category: 'debuffs', class: 'PALADIN', preferSpecs: ['Holy', 'Protection'], group: 'judgement' },
        { id: 'joc', name: 'Judgement of the Crusader', category: 'debuffs', class: 'PALADIN', preferSpecs: [], group: 'judgement', minClassCount: 3 },
        { id: 'scorch', name: 'Improved Scorch', category: 'debuffs', class: 'MAGE', requireSpec: 'Fire' },
        { id: 'ff', name: 'Faerie Fire', category: 'debuffs', class: 'DRUID', preferSpecs: ['Balance'] },
        { id: 'hm', name: "Hunter's Mark", category: 'debuffs', class: 'HUNTER', preferSpecs: ['Marksmanship'] },
        { id: 'demo', name: 'Demoralizing Shout', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'],
          fallback: { name: 'Curse of Weakness', class: 'WARLOCK', preferSpecs: [], group: 'curse' } },
    ];

    const PASSIVES = [
        { name: 'Misery', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Shadow Weaving', class: 'PRIEST', spec: 'Shadow' },
        { name: 'Improved Shadow Bolt', class: 'WARLOCK', spec: 'Destruction' },
        { name: 'Blood Frenzy', class: 'WARRIOR', spec: 'Arms' },
        { name: 'Mangle', class: 'DRUID', spec: 'Feral' },
        { name: 'Expose Weakness', class: 'HUNTER', spec: 'Survival' },
        { name: "Winter's Chill", class: 'MAGE', spec: 'Frost' },
    ];

    function specRank(p, entry) {
        const i = (entry.preferSpecs || []).indexOf(p.spec);
        return i === -1 ? 99 : i;
    }

    function rankPool(pool, entry, dutyCount) {
        return pool.slice().sort((a, b) => {
            const sa = specRank(a, entry), sb = specRank(b, entry);
            if (sa !== sb) return sa - sb;
            const ca = dutyCount[a.name] || 0, cb = dutyCount[b.name] || 0;
            if (ca !== cb) return ca - cb;
            return a.name.localeCompare(b.name);
        });
    }

    function autoAssign(roster, overrides) {
        overrides = overrides || {};
        const duties = [];
        const uncovered = [];
        const dutyCount = {};
        const groupUsed = {}; // '<group>:<player>' -> true
        const byName = {};
        roster.forEach(p => { byName[p.name] = p; });

        function eligible(p, entry) {
            if (p.class !== entry.class) return false;
            if ((p.flags || []).includes('spec-unknown')) return false;
            if (entry.requireSpec && p.spec !== entry.requireSpec) return false;
            if (entry.group && groupUsed[entry.group + ':' + p.name]) return false;
            return true;
        }

        function record(entry, displayName, player, target) {
            const d = { id: entry.id, name: displayName, category: entry.category, player: player ? player.name : null };
            if (target) d.target = target;
            duties.push(d);
            if (player) {
                dutyCount[player.name] = (dutyCount[player.name] || 0) + 1;
                if (entry.group) groupUsed[entry.group + ':' + player.name] = true;
            }
        }

        DEBUFF_CATALOG.forEach(entry => {
            if (entry.minClassCount && roster.filter(p => p.class === entry.class).length < entry.minClassCount) return;
            const o = overrides[entry.id] || {};
            if (o.player && byName[o.player]) { record(entry, entry.name, byName[o.player]); return; }
            let pool = rankPool(roster.filter(p => eligible(p, entry)), entry, dutyCount);
            if (pool.length) { record(entry, entry.name, pool[0]); return; }
            if (entry.fallback) {
                const fb = Object.assign({}, entry.fallback, { id: entry.id, category: entry.category });
                pool = rankPool(roster.filter(p => eligible(p, fb)), fb, dutyCount);
                if (pool.length) { record(fb, fb.name, pool[0]); return; }
            }
            uncovered.push({ id: entry.id, name: entry.name });
        });

        // Spare warlocks keep a personal DPS curse
        roster.filter(p => p.class === 'WARLOCK' && !groupUsed['curse:' + p.name])
            .forEach(p => duties.push({ id: 'curse:' + p.name, name: 'Curse of Doom/Agony (personal)', category: 'debuffs', player: p.name }));

        const passives = PASSIVES.map(ps => {
            const p = roster.find(x => x.class === ps.class && (!ps.spec || x.spec === ps.spec));
            return p ? { name: ps.name, player: p.name } : null;
        }).filter(Boolean);

        return { duties, uncovered, passives };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `32 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add debuff catalog and priority-based auto-assignment"
```

---

### Task 6: Cooldown and crowd-control assignment

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `autoAssign` internals from Task 5 (`record`, `byName`, `overrides` handling — extend inside the same function, before the `passives` computation and final return).
- Produces: `autoAssign` additionally emits cooldown duties: `innervate:<i>` (one per druid, `player` = druid, `target` = mage name or `'HEALER_RESERVE'`; the LAST druid always reserves, so a lone druid reserves) and `soulstone:0` (first warlock, `target` = Holy/Disc priest, else Holy paladin / Resto druid / Resto shaman, else no target). Also new exports: `CC_ABILITIES` `[{id, name, class}]`, `MARKS` (8 mark ids), `MARK_EMOJI` (mark id → emoji), and `defaultCC(roster)` → `[{mark, ability, player}]` (moon/triangle Polymorph for first two mages, square Sap for first rogue).

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Task 6: cooldowns + CC ---
test('autoAssign: two druids innervate first mage and reserve last', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.deepStrictEqual(duty(r, 'innervate:0'), { id: 'innervate:0', name: 'Innervate', category: 'cooldowns', player: 'Moonpie', target: 'Frostina' });
    assert.strictEqual(duty(r, 'innervate:1').target, 'HEALER_RESERVE');
});
test('autoAssign: lone druid reserves innervate for healers', () => {
    const roster = fullRoster().filter(p => p.name !== 'Treebeard');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'innervate:0').target, 'HEALER_RESERVE');
});
test('autoAssign: soulstone goes to first lock on holy priest', () => {
    const r = E.autoAssign(fullRoster(), {});
    assert.strictEqual(duty(r, 'soulstone:0').player, 'Bob');
    assert.strictEqual(duty(r, 'soulstone:0').target, 'Holymel');
});
test('autoAssign: soulstone target falls back to non-priest healer', () => {
    const roster = fullRoster().filter(p => p.name !== 'Holymel');
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'soulstone:0').target, 'Lightbringer'); // holy paladin
});
test('autoAssign: innervate target override honored', () => {
    const r = E.autoAssign(fullRoster(), { 'innervate:0': { target: 'Sheepmaster' } });
    assert.strictEqual(duty(r, 'innervate:0').target, 'Sheepmaster');
});
test('defaultCC: mages sheep moon/triangle, rogue saps square', () => {
    assert.deepStrictEqual(E.defaultCC(fullRoster()), [
        { mark: 'moon', ability: 'polymorph', player: 'Frostina' },
        { mark: 'triangle', ability: 'polymorph', player: 'Sheepmaster' },
        { mark: 'square', ability: 'sap', player: 'Stabby' },
    ]);
});
test('defaultCC: rows only for available classes', () => {
    const r = E.defaultCC(fullRoster().filter(p => p.class !== 'MAGE' && p.class !== 'ROGUE'));
    assert.deepStrictEqual(r, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 7 new FAIL lines

- [ ] **Step 3: Implement**

Inside `autoAssign`, insert between the personal-curses block and the `passives` computation:

```js
        // Innervates: one row per druid; last druid (or a lone druid) reserves for healers
        const druids = roster.filter(p => p.class === 'DRUID');
        const mages = roster.filter(p => p.class === 'MAGE');
        druids.forEach((d, i) => {
            const id = 'innervate:' + i;
            const o = overrides[id] || {};
            const player = (o.player && byName[o.player]) ? byName[o.player] : d;
            const target = o.target || ((i < druids.length - 1 && i < mages.length) ? mages[i].name : 'HEALER_RESERVE');
            record({ id, category: 'cooldowns' }, 'Innervate', player, target);
        });

        // Soulstone: one row, first warlock, priest healer preferred
        const locks = roster.filter(p => p.class === 'WARLOCK');
        if (locks.length) {
            const id = 'soulstone:0';
            const o = overrides[id] || {};
            const player = (o.player && byName[o.player]) ? byName[o.player] : locks[0];
            const priests = roster.filter(p => p.class === 'PRIEST' && (p.spec === 'Holy' || p.spec === 'Discipline'));
            const altHealers = roster.filter(p =>
                (p.class === 'PALADIN' && p.spec === 'Holy') ||
                ((p.class === 'DRUID' || p.class === 'SHAMAN') && p.spec === 'Restoration'));
            const target = o.target || (priests[0] && priests[0].name) || (altHealers[0] && altHealers[0].name) || null;
            record({ id, category: 'cooldowns' }, 'Soulstone', player, target || undefined);
        }
```

Add at module level (near the other constants), and export `CC_ABILITIES`, `MARKS`, `MARK_EMOJI`, `defaultCC`:

```js
    const CC_ABILITIES = [
        { id: 'polymorph', name: 'Polymorph', class: 'MAGE' },
        { id: 'sap', name: 'Sap', class: 'ROGUE' },
        { id: 'trap', name: 'Freezing Trap', class: 'HUNTER' },
        { id: 'banish', name: 'Banish', class: 'WARLOCK' },
        { id: 'shackle', name: 'Shackle Undead', class: 'PRIEST' },
        { id: 'hibernate', name: 'Hibernate', class: 'DRUID' },
    ];
    const MARKS = ['skull', 'cross', 'square', 'moon', 'triangle', 'diamond', 'circle', 'star'];
    const MARK_EMOJI = { skull: '💀', cross: '❌', square: '🟦', moon: '🌙', triangle: '🔺', diamond: '💎', circle: '🟠', star: '⭐' };

    function defaultCC(roster) {
        const mages = roster.filter(p => p.class === 'MAGE');
        const rogues = roster.filter(p => p.class === 'ROGUE');
        const cc = [];
        if (mages[0]) cc.push({ mark: 'moon', ability: 'polymorph', player: mages[0].name });
        if (mages[1]) cc.push({ mark: 'triangle', ability: 'polymorph', player: mages[1].name });
        if (rogues[0]) cc.push({ mark: 'square', ability: 'sap', player: rogues[0].name });
        return cc;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `39 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add innervate, soulstone and crowd-control assignment"
```

---

### Task 7: Output builders (Discord, /raid, whispers)

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `sheet` = `{duties, uncovered, passives, cc}` (the UI composes it from `autoAssign(...)` + a cc array); roster for discordId lookup.
- Produces: `buildDiscord(roster, sheet, opts)` → single string (`opts = {pings: bool, title: string}`); `buildRaidLines(roster, sheet)` → array of `/raid ` strings each ≤ 255 chars; `buildWhispers(roster, sheet)` → array of `/w Name …` strings, one per assigned player. `'HEALER_RESERVE'` renders as `healer in need`. CC lines in chat outputs use WoW's `{mark}` icon syntax.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Task 7: output builders ---
function sampleSheet() {
    const roster = fullRoster();
    roster.find(p => p.name === 'Bob').discordId = '42';
    const r = E.autoAssign(roster, {});
    return { roster, sheet: Object.assign({}, r, { cc: E.defaultCC(roster) }) };
}
test('buildDiscord: has title, sections, and plain names without pings', () => {
    const { roster, sheet } = sampleSheet();
    const out = E.buildDiscord(roster, sheet, { pings: false, title: 'SSC Tuesday' });
    assert.ok(out.includes('SSC Tuesday'));
    assert.ok(out.includes('**Debuffs**'));
    assert.ok(out.includes('**Cooldowns**'));
    assert.ok(out.includes('**Crowd Control**'));
    assert.ok(out.includes('Curse of Elements — Bob'));
    assert.ok(!out.includes('<@'));
});
test('buildDiscord: pings replace linked names only', () => {
    const { roster, sheet } = sampleSheet();
    const out = E.buildDiscord(roster, sheet, { pings: true, title: '' });
    assert.ok(out.includes('<@42>'));
    assert.ok(out.includes('Thunderfist')); // no discordId -> plain
});
test('buildDiscord: healer reserve rendered readably', () => {
    const { roster, sheet } = sampleSheet();
    assert.ok(E.buildDiscord(roster, sheet, { pings: false, title: '' }).includes('healer in need'));
});
test('buildDiscord: uncovered warning included', () => {
    const roster = fullRoster().filter(p => p.class !== 'HUNTER');
    const r = E.autoAssign(roster, {});
    const out = E.buildDiscord(roster, Object.assign({}, r, { cc: [] }), { pings: false, title: '' });
    assert.ok(out.includes('Uncovered'));
    assert.ok(out.includes("Hunter's Mark"));
});
test('buildRaidLines: all lines fit chat limit and carry prefix', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildRaidLines(roster, sheet);
    assert.ok(lines.length >= 1);
    lines.forEach(l => { assert.ok(l.startsWith('/raid ')); assert.ok(l.length <= 255); });
    assert.ok(lines.join(' ').includes('{moon}'));
});
test('buildWhispers: one line per assigned player, duties combined', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildWhispers(roster, sheet);
    const bob = lines.find(l => l.startsWith('/w Bob '));
    assert.ok(bob.includes('Curse of Elements'));
    assert.ok(bob.includes('Soulstone'));
    assert.strictEqual(lines.filter(l => l.startsWith('/w Bob ')).length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 6 new FAIL lines

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`, and add `buildDiscord`, `buildRaidLines`, `buildWhispers` to the returned object:

```js
    function displayTarget(t) { return t === 'HEALER_RESERVE' ? 'healer in need' : t; }
    function ccAbilityName(id) {
        const a = CC_ABILITIES.find(x => x.id === id);
        return a ? a.name : id;
    }
    function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    function buildDiscord(roster, sheet, opts) {
        opts = opts || {};
        const byName = {};
        roster.forEach(p => { byName[p.name] = p; });
        const nm = n => {
            const p = byName[n];
            return (opts.pings && p && p.discordId) ? '<@' + p.discordId + '>' : n;
        };
        const lines = ['**__RAID ASSIGNMENTS' + (opts.title ? ' — ' + opts.title : '') + '__**', ''];
        [['debuffs', 'Debuffs'], ['cooldowns', 'Cooldowns']].forEach(pair => {
            const rows = sheet.duties.filter(d => d.category === pair[0] && d.player);
            if (!rows.length) return;
            lines.push('**' + pair[1] + '**');
            rows.forEach(d => {
                let s = d.name + ' — ' + nm(d.player);
                if (d.target) s += ' → ' + (byName[d.target] ? nm(d.target) : displayTarget(d.target));
                lines.push(s);
            });
            lines.push('');
        });
        if (sheet.cc && sheet.cc.length) {
            lines.push('**Crowd Control**');
            sheet.cc.filter(c => c.player).forEach(c => {
                lines.push(MARK_EMOJI[c.mark] + ' ' + capitalize(c.mark) + ' ' + ccAbilityName(c.ability) + ' — ' + nm(c.player));
            });
            lines.push('');
        }
        if (sheet.uncovered && sheet.uncovered.length) {
            lines.push('⚠ **Uncovered:** ' + sheet.uncovered.map(u => u.name).join(', '));
        }
        return lines.join('\n').trim();
    }

    function packChat(prefix, items, sep, max) {
        const lines = [];
        let cur = '';
        items.forEach(it => {
            const next = cur ? cur + sep + it : prefix + it;
            if (next.length > max && cur) { lines.push(cur); cur = prefix + it; }
            else cur = next;
        });
        if (cur) lines.push(cur);
        return lines;
    }

    function buildRaidLines(roster, sheet) {
        const items = [];
        sheet.duties.filter(d => d.player).forEach(d => {
            let s = d.name + ': ' + d.player;
            if (d.target) s += ' -> ' + displayTarget(d.target);
            items.push(s);
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            items.push('{' + c.mark + '} ' + ccAbilityName(c.ability) + ': ' + c.player);
        });
        return packChat('/raid ', items, ' | ', 255);
    }

    function buildWhispers(roster, sheet) {
        const per = {};
        const add = (name, txt) => { (per[name] = per[name] || []).push(txt); };
        sheet.duties.filter(d => d.player).forEach(d => {
            add(d.player, d.name + (d.target ? ' on ' + displayTarget(d.target) : ''));
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            add(c.player, ccAbilityName(c.ability) + ' on {' + c.mark + '}');
        });
        return Object.keys(per).map(n => '/w ' + n + ' Your assignments: ' + per[n].join('; '));
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: `45 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add Discord, raid-chat and whisper output builders"
```

---

### Task 8: Raid-Helper proxy route

**Files:**
- Modify: `server.js` (insert BEFORE the `app.get('*', …)` catch-all — Express matches in order, so a route added after it is dead code)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `GET /api/raidhelper/:eventId` → passes through Raid-Helper's JSON (`https://raid-helper.dev/api/v2/events/{id}`). 400 `{error}` on malformed id, upstream status + `{error}` on upstream failure, 502 `{error}` on network failure. The UI (Task 9) calls exactly this path.

- [ ] **Step 1: Add the route**

In `server.js`, directly above the comment `// Serve index.html for other routes (fallback)`, insert:

```js
// Proxy for Raid-Helper event API (their CORS policy blocks direct browser calls)
app.get('/api/raidhelper/:eventId', async (req, res) => {
  const id = req.params.eventId;
  if (!/^\d{5,25}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid event id' });
  }
  try {
    const upstream = await fetch(`https://raid-helper.dev/api/v2/events/${id}`);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Raid-Helper returned ${upstream.status}` });
    }
    res.json(await upstream.json());
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Raid-Helper' });
  }
});
```

- [ ] **Step 2: Verify manually**

```bash
node server.js &
sleep 1
curl -s http://localhost:3000/api/raidhelper/notanid          # expect {"error":"Invalid event id"}
curl -s http://localhost:3000/api/raidhelper/12345678901234567 # expect {"error":"Raid-Helper returned 404"}
kill %1
```

Expected: the two JSON error bodies shown above (the second proves the upstream call works end-to-end).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add Raid-Helper API proxy route"
```

---

### Task 9: Page skeleton — import, roster, persistence

**Files:**
- Create: `assignments.html`
- Create: `assignments.css`
- Create: `assignments.js`
- Modify: `index.html` (add fight-card)

**Interfaces:**
- Consumes: `AssignmentsEngine` global (all Tasks 1–7 functions); proxy route from Task 8.
- Produces: the page shell and this state model, which Tasks 10–11 build on. `assignments.js` module-level names other tasks rely on: `state` (`{sources: {addon, rh}, manual: [], excluded: [], overrides: {}, cc: null, pings: true, title: ''}`), `linkMap` (discordId→charName), computed `roster`, `mergeInfo`, `sheet`, `activeTab`; functions `loadState()`, `saveState()`, `recompute()`, `renderAll()`, `setStatus(msg, isError)`; stub functions `renderAssignments()` and `renderOutput()` (filled in Tasks 10–11).

- [ ] **Step 1: Create `assignments.css`**

```css
/* Raid Assignments page — extends style.css */
.panel { background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.panel h2 { color: #ffd700; font-size: 1.2em; margin-bottom: 12px; }
.import-row { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: flex-start; }
.import-row input, .import-row textarea, .import-row select {
    background: rgba(0, 0, 0, 0.3); border: 1px solid #555; border-radius: 6px;
    color: #e0e0e0; padding: 8px 10px; font-size: 0.95em;
}
.import-row input { flex: 1; min-width: 240px; }
.import-row textarea { flex: 1; min-width: 240px; min-height: 60px; font-family: monospace; }
.status { color: #b0b0b0; margin-top: 6px; min-height: 1.2em; }
.status.error { color: #ff6b6b; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 12px;
    font-weight: 600; font-size: 0.85em; color: #111; margin: 3px; cursor: default; }
.pill .flag { background: rgba(0,0,0,0.35); color: #ffdddd; border-radius: 8px; padding: 0 6px; font-size: 0.85em; }
.pill button { background: none; border: none; cursor: pointer; font-size: 0.9em; padding: 0; color: #111; }
.cards { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
.card { background: rgba(0, 0, 0, 0.25); border: 1px solid #444; border-radius: 8px; padding: 14px; flex: 1; min-width: 280px; }
.card h3 { color: #ffd700; font-size: 1em; margin-bottom: 10px; }
.assign-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; flex-wrap: wrap; }
.assign-row .duty-name { min-width: 160px; font-weight: 600; }
.assign-row select { background: rgba(0,0,0,0.3); border: 1px solid #555; border-radius: 4px; color: #e0e0e0; padding: 3px 6px; }
.assign-row.passive { opacity: 0.55; }
.warn { background: rgba(255, 107, 107, 0.12); border: 1px solid #ff6b6b; color: #ff9b9b;
    border-radius: 6px; padding: 8px 12px; margin: 10px 0; }
.hidden { display: none; }
.tabbar { display: flex; gap: 4px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.tab { background: rgba(255,255,255,0.06); border: none; color: #e0e0e0; padding: 6px 14px;
    border-radius: 6px 6px 0 0; cursor: pointer; font-size: 0.95em; }
.tab.active { background: #ffd700; color: #111; font-weight: 700; }
.tabbar .spacer { flex: 1; }
#outputBox { background: #2b2d31; color: #dbdee1; border-radius: 8px; padding: 14px;
    font-size: 0.9em; line-height: 1.5; white-space: pre-wrap; word-break: break-word; min-height: 80px; }
#linkPanel { margin-top: 10px; }
.link-row { display: flex; gap: 8px; align-items: center; padding: 3px 0; }
```

- [ ] **Step 2: Create `assignments.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Raid Assignments</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="assignments.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>Raid Assignments</h1>
            <p>Debuffs, cooldowns &amp; crowd control — import, auto-assign, share</p>
            <a href="index.html" class="btn">← All tools</a>
        </header>

        <section class="panel">
            <h2>1 · Import</h2>
            <div class="import-row">
                <input id="rhInput" placeholder="Raid-Helper event link or ID…">
                <button id="rhImportBtn" class="btn btn-primary">Import from Raid-Helper</button>
            </div>
            <div class="import-row">
                <textarea id="addonInput" placeholder="Paste the /specscan export from the RaidSpecScan addon…"></textarea>
                <button id="addonImportBtn" class="btn btn-primary">Import addon scan</button>
            </div>
            <div class="import-row">
                <button id="addPlayerBtn" class="btn">+ Add player</button>
                <button id="clearRosterBtn" class="btn">Clear roster</button>
            </div>
            <div class="import-row hidden" id="manualForm">
                <input id="manualName" placeholder="Character name" style="min-width:140px; flex:0 1 160px;">
                <select id="manualClass"></select>
                <select id="manualSpec"></select>
                <button id="manualSaveBtn" class="btn btn-primary">Save</button>
                <button id="manualCancelBtn" class="btn">Cancel</button>
            </div>
            <p id="importStatus" class="status"></p>
        </section>

        <section class="panel">
            <h2>2 · Roster (<span id="rosterCount">0</span>)</h2>
            <div id="rosterPills"></div>
            <div id="linkPanel" class="hidden"></div>
        </section>

        <section class="panel">
            <h2>3 · Assignments</h2>
            <button id="autoAssignBtn" class="btn btn-primary">⚡ Auto-assign all</button>
            <div id="uncoveredBox" class="warn hidden"></div>
            <div class="cards">
                <div class="card"><h3>Boss Debuffs</h3><div id="debuffRows"></div><div id="passiveRows"></div></div>
                <div class="card"><h3>Cooldowns</h3><div id="cooldownRows"></div></div>
                <div class="card"><h3>Crowd Control</h3><div id="ccRows"></div><button id="addCcBtn" class="btn">+ Add CC</button></div>
            </div>
        </section>

        <section class="panel">
            <h2>4 · Output</h2>
            <div class="tabbar">
                <button class="tab active" data-tab="discord">Discord</button>
                <button class="tab" data-tab="share">Share link</button>
                <button class="tab" data-tab="raid">/raid macro</button>
                <button class="tab" data-tab="whispers">Whispers</button>
                <span class="spacer"></span>
                <label id="pingToggle"><input type="checkbox" id="pingCheckbox" checked> @mentions</label>
                <button id="copyBtn" class="btn">📋 Copy</button>
            </div>
            <pre id="outputBox"></pre>
        </section>
    </div>
    <script src="assignments-engine.js"></script>
    <script src="assignments.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `assignments.js` (part 1: state, persistence, import, roster)**

```js
/* global AssignmentsEngine */
'use strict';
const E = AssignmentsEngine;
const STORAGE_KEY = 'raidAssignmentsState';
const LINK_KEY = 'raidAssignmentsLinkMap';

let state = {
    sources: { addon: null, rh: null }, // Player[] or null per source
    manual: [],                          // manually added/edited players
    excluded: [],                        // names removed from the roster by hand
    overrides: {},                       // dutyId -> {player?, target?}
    cc: null,                            // [{mark, ability, player}] or null = engine defaults
    pings: true,
    title: '',
};
let linkMap = {};   // discordId -> character name (persists across roster resets)
let roster = [];
let mergeInfo = { unmatched: { addon: [], raidhelper: [] }, mismatches: [] };
let sheet = null;
let activeTab = 'discord';

function loadState() {
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch (e) { /* fresh start */ }
    try { linkMap = JSON.parse(localStorage.getItem(LINK_KEY)) || {}; } catch (e) { linkMap = {}; }
}
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LINK_KEY, JSON.stringify(linkMap));
}

function recompute() {
    mergeInfo = E.mergeRosters(state.sources.addon || [], state.sources.rh || [], linkMap);
    const base = mergeInfo.roster.filter(p =>
        !state.excluded.includes(p.name) && !state.manual.some(m => m.name === p.name));
    const manual = state.manual.filter(m => !state.excluded.includes(m.name)).map(m => {
        const src = mergeInfo.roster.find(p => p.name === m.name);
        return Object.assign({}, m, { discordId: src ? src.discordId : m.discordId });
    });
    roster = base.concat(manual);
    const result = E.autoAssign(roster, state.overrides);
    sheet = Object.assign({}, result, { cc: state.cc || E.defaultCC(roster) });
}

function renderAll() {
    recompute();
    saveState();
    renderRoster();
    renderLinkPanel();
    renderAssignments();
    renderOutput();
}

function setStatus(msg, isError) {
    const el = document.getElementById('importStatus');
    el.textContent = msg;
    el.className = 'status' + (isError ? ' error' : '');
}

// --- Import handlers ---
async function importRaidHelper() {
    const raw = document.getElementById('rhInput').value.trim();
    const m = raw.match(/(\d{5,25})/);
    if (!m) { setStatus('Could not find an event ID in that link.', true); return; }
    setStatus('Fetching event…');
    try {
        const res = await fetch('/api/raidhelper/' + m[1]);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || ('HTTP ' + res.status));
        }
        const parsed = E.parseRaidHelper(await res.json());
        state.sources.rh = parsed.players;
        if (parsed.title) state.title = parsed.title;
        let msg = 'Imported ' + parsed.players.length + ' signups';
        if (parsed.excluded.length) msg += ' · excluded: ' + parsed.excluded.map(x => x.name + ' (' + x.reason + ')').join(', ');
        if (parsed.errors.length) msg += ' · ' + parsed.errors.join('; ');
        setStatus(msg, parsed.errors.length > 0);
        renderAll();
    } catch (err) {
        setStatus('Raid-Helper import failed: ' + err.message, true);
    }
}

function importAddon() {
    const parsed = E.parseAddonExport(document.getElementById('addonInput').value);
    if (!parsed.players.length) { setStatus('No players found in that export.', true); return; }
    state.sources.addon = parsed.players;
    let msg = 'Imported ' + parsed.players.length + ' players from addon scan';
    if (parsed.errors.length) msg += ' · ' + parsed.errors.join('; ');
    setStatus(msg, parsed.errors.length > 0);
    renderAll();
}

// --- Manual add/edit ---
function openManualForm(player) {
    document.getElementById('manualForm').classList.remove('hidden');
    const clsSel = document.getElementById('manualClass');
    clsSel.innerHTML = Object.keys(E.SPEC_TREES).map(c => '<option value="' + c + '">' + c + '</option>').join('');
    if (player) {
        document.getElementById('manualName').value = player.name;
        clsSel.value = player.class;
    }
    fillManualSpecs(player ? player.spec : null);
}
function fillManualSpecs(selected) {
    const cls = document.getElementById('manualClass').value;
    const specSel = document.getElementById('manualSpec');
    specSel.innerHTML = E.SPEC_TREES[cls].map(s => '<option value="' + s + '">' + s + '</option>').join('');
    if (selected && E.SPEC_TREES[cls].includes(selected)) specSel.value = selected;
}
function saveManualPlayer() {
    const name = document.getElementById('manualName').value.trim();
    if (!name) { setStatus('Name is required.', true); return; }
    state.manual = state.manual.filter(m => m.name !== name);
    state.manual.push({
        name,
        class: document.getElementById('manualClass').value,
        spec: document.getElementById('manualSpec').value,
        flags: [], source: 'manual',
    });
    state.excluded = state.excluded.filter(n => n !== name);
    document.getElementById('manualForm').classList.add('hidden');
    document.getElementById('manualName').value = '';
    renderAll();
}
function removePlayer(name) {
    state.excluded.push(name);
    Object.keys(state.overrides).forEach(id => {
        if (state.overrides[id] && state.overrides[id].player === name) delete state.overrides[id].player;
        if (state.overrides[id] && state.overrides[id].target === name) delete state.overrides[id].target;
    });
    renderAll();
}

// --- Roster rendering ---
function renderRoster() {
    document.getElementById('rosterCount').textContent = roster.length;
    const box = document.getElementById('rosterPills');
    box.innerHTML = '';
    roster.forEach(p => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.style.background = E.CLASS_COLORS[p.class] || '#999';
        const flags = (p.flags || [])
            .map(f => f === 'spec-unknown' ? '?spec' : f === 'spec-ambiguous' ? '~spec' : f)
            .map(f => '<span class="flag">' + f + '</span>').join('');
        pill.innerHTML = p.name + ' · ' + (p.spec || '?') + flags +
            ' <button title="Edit" data-act="edit">✎</button><button title="Remove" data-act="del">✕</button>';
        pill.querySelector('[data-act=edit]').addEventListener('click', () => openManualForm(p));
        pill.querySelector('[data-act=del]').addEventListener('click', () => removePlayer(p.name));
        box.appendChild(pill);
    });
}

// --- Identity linking (unmatched Raid-Helper signups -> addon characters) ---
function renderLinkPanel() {
    const panel = document.getElementById('linkPanel');
    const needsLink = mergeInfo.unmatched.raidhelper;
    const candidates = mergeInfo.unmatched.addon;
    if (!needsLink.length || !candidates.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="warn">Unlinked Raid-Helper signups — link them to characters to enable @pings:</div>';
    needsLink.forEach(rh => {
        const row = document.createElement('div');
        row.className = 'link-row';
        const opts = candidates.map(p => '<option value="' + p.name + '">' + p.name + '</option>').join('');
        row.innerHTML = '<span>' + rh.name + ' (' + rh.class + ')</span> ▸ <select>' + opts +
            '</select> <button class="btn">Link</button>';
        row.querySelector('button').addEventListener('click', () => {
            linkMap[rh.discordId] = row.querySelector('select').value;
            renderAll();
        });
        panel.appendChild(row);
    });
}

// --- Stubs completed in later tasks ---
function renderAssignments() { /* Task 10 */ }
function renderOutput() { /* Task 11 */ }

// --- Wiring ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    document.getElementById('rhImportBtn').addEventListener('click', importRaidHelper);
    document.getElementById('addonImportBtn').addEventListener('click', importAddon);
    document.getElementById('addPlayerBtn').addEventListener('click', () => openManualForm(null));
    document.getElementById('manualClass').addEventListener('change', () => fillManualSpecs(null));
    document.getElementById('manualSaveBtn').addEventListener('click', saveManualPlayer);
    document.getElementById('manualCancelBtn').addEventListener('click', () =>
        document.getElementById('manualForm').classList.add('hidden'));
    document.getElementById('clearRosterBtn').addEventListener('click', () => {
        if (!confirm('Clear the whole roster and assignments? (Name links are kept.)')) return;
        state = { sources: { addon: null, rh: null }, manual: [], excluded: [], overrides: {}, cc: null, pings: state.pings, title: '' };
        renderAll();
    });
    document.getElementById('autoAssignBtn').addEventListener('click', () => {
        state.overrides = {};
        state.cc = null;
        renderAll();
    });
    renderAll();
});
```

- [ ] **Step 4: Add the card to `index.html`**

Directly after the Serpentshrine Cavern `fight-card` div (which ends with `</div>` before the closing `</div>` of `fight-selection`), insert:

```html
            <div class="fight-card" onclick="window.location.href='assignments.html'">
                <h2>Raid Assignments</h2>
                <p>Debuffs, cooldowns &amp; CC — import, auto-assign, share</p>
                <button class="btn btn-primary">Open</button>
            </div>
```

- [ ] **Step 5: Verify manually**

```bash
node server.js
```

Open `http://localhost:3000/` — the new card appears and opens `assignments.html`. On the page:
1. Paste this into the addon textarea and click "Import addon scan":
   `RSS1;Thunderfist:WARRIOR:5/5/51;Smashy:WARRIOR:41/20/0;Bob:WARLOCK:41/7/13;Grimshade:WARLOCK:0/21/40;Doomlord:WARLOCK:0/41/20;Retdin:PALADIN:0/5/56;Lightbringer:PALADIN:41/20/0;Bubbles:PALADIN:0/49/12;Frostina:MAGE:10/48/3;Sheepmaster:MAGE:3/7/51;Moonpie:DRUID:41/0/20;Treebeard:DRUID:1/11/49;Shadowmel:PRIEST:14/0/47;Holymel:PRIEST:23/38/0;Legolass:HUNTER:5/41/15;Stabby:ROGUE:15/41/5;Afkguy:HUNTER:?`
2. Expect 17 class-colored pills; Afkguy shows a `?spec` flag.
3. Add a manual player, edit a pill (✎), remove one (✕).
4. Refresh the page — everything persists. "Clear roster" empties it.

- [ ] **Step 6: Commit**

```bash
git add assignments.html assignments.css assignments.js index.html
git commit -m "Add assignments page skeleton with dual import and roster management"
```

---

### Task 10: Assignment cards UI — dropdowns, overrides, CC editor

**Files:**
- Modify: `assignments.js` (replace the `renderAssignments` stub)

**Interfaces:**
- Consumes: `state`, `roster`, `sheet`, `renderAll()` from Task 9; `E.DEBUFF_CATALOG`, `E.CC_ABILITIES`, `E.MARKS`, `E.MARK_EMOJI`, `E.SPEC_TREES` from the engine.
- Produces: interactive assignment section. Changing any dropdown writes `state.overrides[dutyId] = {player?, target?}` (or mutates `state.cc`) and calls `renderAll()`. "Auto-assign all" (already wired in Task 9) resets overrides and cc to defaults.

- [ ] **Step 1: Replace the `renderAssignments` stub in `assignments.js`**

```js
function eligibleForDuty(dutyId) {
    if (dutyId.startsWith('innervate:')) return roster.filter(p => p.class === 'DRUID');
    if (dutyId.startsWith('soulstone:')) return roster.filter(p => p.class === 'WARLOCK');
    const entry = E.DEBUFF_CATALOG.find(e => e.id === dutyId);
    if (!entry) return roster;
    return roster.filter(p => p.class === entry.class || (entry.fallback && p.class === entry.fallback.class));
}

function makeSelect(options, current, allowEmpty, onChange) {
    const sel = document.createElement('select');
    let html = allowEmpty ? '<option value="">— unassigned —</option>' : '';
    html += options.map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('');
    sel.innerHTML = html;
    sel.value = current || '';
    sel.addEventListener('change', () => onChange(sel.value || null));
    return sel;
}

function playerOptions(players) {
    return players.map(p => ({ value: p.name, label: p.name + ' (' + (p.spec || '?') + ')' }));
}

function dutyRow(d) {
    const row = document.createElement('div');
    row.className = 'assign-row';
    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name;
    row.appendChild(label);

    if (d.id.startsWith('curse:')) { // personal curse: fixed player, no dropdown
        const who = document.createElement('span');
        who.textContent = d.player;
        row.appendChild(who);
        return row;
    }

    row.appendChild(makeSelect(playerOptions(eligibleForDuty(d.id)), d.player, true, val => {
        state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { player: val });
        renderAll();
    }));

    if (d.id.startsWith('innervate:') || d.id.startsWith('soulstone:')) {
        const on = document.createElement('span');
        on.textContent = 'on';
        row.appendChild(on);
        const targetOpts = playerOptions(roster);
        if (d.id.startsWith('innervate:')) targetOpts.push({ value: 'HEALER_RESERVE', label: '💚 healer in need' });
        row.appendChild(makeSelect(targetOpts, d.target, true, val => {
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { target: val });
            renderAll();
        }));
    }
    return row;
}

function ccRow(c, index) {
    const row = document.createElement('div');
    row.className = 'assign-row';
    function materialize() { if (!state.cc) state.cc = sheet.cc.map(x => Object.assign({}, x)); return state.cc; }

    const markOpts = E.MARKS.map(m => ({ value: m, label: E.MARK_EMOJI[m] + ' ' + m }));
    row.appendChild(makeSelect(markOpts, c.mark, false, val => { materialize()[index].mark = val; renderAll(); }));

    const abilityOpts = E.CC_ABILITIES.map(a => ({ value: a.id, label: a.name }));
    row.appendChild(makeSelect(abilityOpts, c.ability, false, val => {
        const cc = materialize();
        cc[index].ability = val;
        cc[index].player = null; // class changed, old player likely invalid
        renderAll();
    }));

    const ability = E.CC_ABILITIES.find(a => a.id === c.ability);
    const pool = ability ? roster.filter(p => p.class === ability.class) : roster;
    row.appendChild(makeSelect(playerOptions(pool), c.player, true, val => { materialize()[index].player = val; renderAll(); }));

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = '✕';
    del.addEventListener('click', () => { materialize().splice(index, 1); renderAll(); });
    row.appendChild(del);
    return row;
}

function renderAssignments() {
    const uncoveredBox = document.getElementById('uncoveredBox');
    if (sheet.uncovered.length && roster.length) {
        uncoveredBox.classList.remove('hidden');
        uncoveredBox.textContent = '⚠ Uncovered: ' + sheet.uncovered.map(u => u.name).join(', ');
    } else {
        uncoveredBox.classList.add('hidden');
    }

    const debuffBox = document.getElementById('debuffRows');
    debuffBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'debuffs').forEach(d => debuffBox.appendChild(dutyRow(d)));

    const passiveBox = document.getElementById('passiveRows');
    passiveBox.innerHTML = '';
    sheet.passives.forEach(ps => {
        const row = document.createElement('div');
        row.className = 'assign-row passive';
        row.textContent = ps.name + ' — auto-covered by ' + ps.player;
        passiveBox.appendChild(row);
    });

    const cdBox = document.getElementById('cooldownRows');
    cdBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'cooldowns').forEach(d => cdBox.appendChild(dutyRow(d)));

    const ccBox = document.getElementById('ccRows');
    ccBox.innerHTML = '';
    sheet.cc.forEach((c, i) => ccBox.appendChild(ccRow(c, i)));
}
```

Also add the "+ Add CC" wiring inside the `DOMContentLoaded` handler (next to the other listeners):

```js
    document.getElementById('addCcBtn').addEventListener('click', () => {
        if (!state.cc) state.cc = sheet.cc.map(x => Object.assign({}, x));
        state.cc.push({ mark: 'star', ability: 'polymorph', player: null });
        renderAll();
    });
```

- [ ] **Step 2: Run the engine tests (regression guard)**

Run: `node assignments-engine.test.js`
Expected: `45 passed, 0 failed` (UI changes must not touch the engine)

- [ ] **Step 3: Verify manually**

With `node server.js` running and the Task 9 sample roster imported:
1. Debuffs card shows Sunder→Thunderfist, CoE→Bob, JoW→Retdin, Improved Scorch→Frostina, etc.; personal curse row for the spare lock.
2. Cooldowns card: Innervate Moonpie→Frostina, Treebeard→"healer in need", Soulstone Bob→Holymel.
3. CC card: Moon/Triangle Polymorph by the two mages, Square Sap by Stabby; "+ Add CC" adds a Star row; changing ability to Sap restricts the player dropdown to rogues.
4. Reassign CoE to Grimshade via dropdown — Bob picks up a curse duty elsewhere. Click "⚡ Auto-assign all" — everything resets to defaults.
5. Remove Legolass and Afkguy (both hunters) — the red "Uncovered: Hunter's Mark" box appears.

- [ ] **Step 4: Commit**

```bash
git add assignments.js
git commit -m "Add interactive assignment cards with overrides and CC editor"
```

---

### Task 11: Output tabs, share link, read-only view page

**Files:**
- Modify: `assignments.js` (replace the `renderOutput` stub, add tab/copy/ping wiring)
- Create: `assignments-view.html`

**Interfaces:**
- Consumes: `E.buildDiscord`, `E.buildRaidLines`, `E.buildWhispers`; `state`, `roster`, `sheet`, `activeTab` from Task 9.
- Produces: working output section; share links of the form `assignments-view.html?data=<base64 JSON {title, roster, sheet}>` using the same encoding as the existing gruul/ssc share links (`btoa(unescape(encodeURIComponent(json)))`).

- [ ] **Step 1: Replace the `renderOutput` stub in `assignments.js`**

```js
function buildShareLink() {
    const payload = { title: state.title, roster, sheet };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return location.origin + location.pathname.replace('assignments.html', 'assignments-view.html') + '?data=' + encoded;
}

function renderOutput() {
    const box = document.getElementById('outputBox');
    document.getElementById('pingToggle').style.display = activeTab === 'discord' ? '' : 'none';
    if (!roster.length) { box.textContent = 'Import a roster first.'; return; }
    if (activeTab === 'discord') {
        box.textContent = E.buildDiscord(roster, sheet, { pings: state.pings, title: state.title });
    } else if (activeTab === 'raid') {
        box.textContent = E.buildRaidLines(roster, sheet).join('\n');
    } else if (activeTab === 'whispers') {
        box.textContent = E.buildWhispers(roster, sheet).join('\n');
    } else if (activeTab === 'share') {
        box.textContent = buildShareLink();
    }
}
```

Add inside the `DOMContentLoaded` handler:

```js
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            renderOutput();
        });
    });
    const pingCheckbox = document.getElementById('pingCheckbox');
    pingCheckbox.checked = state.pings;
    pingCheckbox.addEventListener('change', () => { state.pings = pingCheckbox.checked; renderAll(); });
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const btn = document.getElementById('copyBtn');
        await navigator.clipboard.writeText(document.getElementById('outputBox').textContent);
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
    });
```

- [ ] **Step 2: Create `assignments-view.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Raid Assignments — View</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="assignments.css">
</head>
<body>
    <div class="container">
        <header><h1 id="viewTitle">Raid Assignments</h1></header>
        <div id="viewError" class="warn hidden">Could not read this share link.</div>
        <div class="cards">
            <div class="card"><h3>Boss Debuffs</h3><div id="debuffRows"></div><div id="passiveRows"></div></div>
            <div class="card"><h3>Cooldowns</h3><div id="cooldownRows"></div></div>
            <div class="card"><h3>Crowd Control</h3><div id="ccRows"></div></div>
        </div>
        <div id="uncoveredBox" class="warn hidden"></div>
    </div>
    <script src="assignments-engine.js"></script>
    <script>
    /* global AssignmentsEngine */
    (function () {
        'use strict';
        const E = AssignmentsEngine;
        function row(parent, text, cls) {
            const div = document.createElement('div');
            div.className = 'assign-row' + (cls ? ' ' + cls : '');
            div.textContent = text;
            parent.appendChild(div);
        }
        function target(t) { return t === 'HEALER_RESERVE' ? 'healer in need' : t; }
        try {
            const encoded = new URLSearchParams(location.search).get('data');
            const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
            if (payload.title) document.getElementById('viewTitle').textContent = 'Raid Assignments — ' + payload.title;
            const sheet = payload.sheet;
            const debuffs = document.getElementById('debuffRows');
            sheet.duties.filter(d => d.category === 'debuffs' && d.player)
                .forEach(d => row(debuffs, d.name + ' — ' + d.player));
            const passives = document.getElementById('passiveRows');
            (sheet.passives || []).forEach(p => row(passives, p.name + ' — auto-covered by ' + p.player, 'passive'));
            const cds = document.getElementById('cooldownRows');
            sheet.duties.filter(d => d.category === 'cooldowns' && d.player)
                .forEach(d => row(cds, d.name + ' — ' + d.player + (d.target ? ' → ' + target(d.target) : '')));
            const cc = document.getElementById('ccRows');
            (sheet.cc || []).filter(c => c.player).forEach(c =>
                row(cc, E.MARK_EMOJI[c.mark] + ' ' + c.mark + ' ' +
                    (E.CC_ABILITIES.find(a => a.id === c.ability) || { name: c.ability }).name + ' — ' + c.player));
            if (sheet.uncovered && sheet.uncovered.length) {
                const u = document.getElementById('uncoveredBox');
                u.classList.remove('hidden');
                u.textContent = '⚠ Uncovered: ' + sheet.uncovered.map(x => x.name).join(', ');
            }
        } catch (e) {
            document.getElementById('viewError').classList.remove('hidden');
        }
    }());
    </script>
</body>
</html>
```

- [ ] **Step 3: Run the engine tests (regression guard)**

Run: `node assignments-engine.test.js`
Expected: `45 passed, 0 failed`

- [ ] **Step 4: Verify manually**

With `node server.js` running and the sample roster loaded:
1. Discord tab shows the grouped block; toggling "@mentions" changes nothing yet (no discordIds without a Raid-Helper import) — import a real Raid-Helper event or temporarily link one to see `<@id>`.
2. /raid tab: every line starts `/raid ` and is under 255 chars. Whispers tab: one `/w` line per assigned player.
3. Copy button puts the visible text on the clipboard.
4. Share link tab: open the generated URL in a new tab — the read-only view renders the same assignments; mangle the `data=` param — the error banner shows.

- [ ] **Step 5: Commit**

```bash
git add assignments.js assignments-view.html
git commit -m "Add output tabs with share link and read-only view page"
```

---

### Task 12: RaidSpecScan addon

**Files:**
- Create: `RaidSpecScan/RaidSpecScan.toc`
- Create: `RaidSpecScan/RaidSpecScan.lua`

**Interfaces:**
- Consumes: nothing from the web code.
- Produces: `/specscan` slash command that scans the raid and shows a copyable export string in the exact format `parseAddonExport` (Task 2) accepts: `RSS1;Name:CLASS:t1/t2/t3;…` with `?` for unscannable players.

- [ ] **Step 1: Create `RaidSpecScan/RaidSpecScan.toc`**

```
## Interface: 20505
## Title: RaidSpecScan
## Notes: Scans raid talents and exports them for the Raid Assignments web tool
## Author: mazemade
## Version: 1.0

RaidSpecScan.lua
```

Note: if the addon shows as out-of-date in game, get the correct interface number with `/run print((select(4, GetBuildInfo())))` and update this line.

- [ ] **Step 2: Create `RaidSpecScan/RaidSpecScan.lua`**

```lua
-- RaidSpecScan: exports raid class + talent point totals for the assignments web tool.
-- Usage: /specscan while in a raid. Players out of inspect range (28yd), offline,
-- or timing out export as "?" and get fixed manually in the web tool.

local INSPECT_TIMEOUT = 3 -- seconds per player before giving up

local frame = CreateFrame("Frame")
local queue = {}          -- raid unit ids still to inspect
local results = {}        -- ordered list of {name, class, points}
local current = nil       -- unit currently being inspected
local elapsed = 0
local scanning = false

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99[RaidSpecScan]|r " .. msg)
end

-- BCC-era API: GetTalentTabInfo(tab, isInspect) -> name, texture, pointsSpent, background
-- (retail-classic variants shuffle returns, so find the first numeric value)
local function TabPoints(tab, isInspect)
    local a, b, c, d, e = GetTalentTabInfo(tab, isInspect)
    if type(c) == "number" then return c end
    if type(a) == "number" then return a end
    if type(e) == "number" then return e end
    return 0
end

local function TalentString(isInspect)
    return TabPoints(1, isInspect) .. "/" .. TabPoints(2, isInspect) .. "/" .. TabPoints(3, isInspect)
end

local function AddResult(unit, points)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if name and classToken then
        table.insert(results, name .. ":" .. classToken .. ":" .. points)
    end
end

local function ShowExport()
    local text = "RSS1;" .. table.concat(results, ";")
    local f = RaidSpecScanExportFrame
    if not f then
        f = CreateFrame("Frame", "RaidSpecScanExportFrame", UIParent, "BackdropTemplate")
        f:SetSize(500, 300)
        f:SetPoint("CENTER")
        f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
            edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
            tile = true, tileSize = 32, edgeSize = 32,
            insets = { left = 11, right = 12, top = 12, bottom = 11 } })
        f:SetMovable(true)
        f:EnableMouse(true)
        f:RegisterForDrag("LeftButton")
        f:SetScript("OnDragStart", f.StartMoving)
        f:SetScript("OnDragStop", f.StopMovingOrSizing)

        local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        title:SetPoint("TOP", 0, -16)
        title:SetText("RaidSpecScan export — Ctrl+A, Ctrl+C, paste into the web tool")

        local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 20, -40)
        scroll:SetPoint("BOTTOMRIGHT", -30, 50)

        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetMultiLine(true)
        edit:SetFontObject(ChatFontNormal)
        edit:SetWidth(440)
        edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() f:Hide() end)
        scroll:SetScrollChild(edit)
        f.editBox = edit

        local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        close:SetSize(80, 22)
        close:SetPoint("BOTTOM", 0, 16)
        close:SetText("Close")
        close:SetScript("OnClick", function() f:Hide() end)
    end
    f.editBox:SetText(text)
    f.editBox:HighlightText()
    f.editBox:SetFocus()
    f:Show()
end

local function FinishUnit(points)
    AddResult(current, points)
    ClearInspectPlayer()
    current = nil
    elapsed = 0
end

local function NextUnit()
    if #queue == 0 then
        scanning = false
        frame:SetScript("OnUpdate", nil)
        Print("Scan complete: " .. #results .. " players. Opening export…")
        ShowExport()
        return
    end
    current = table.remove(queue, 1)
    elapsed = 0
    if UnitIsUnit(current, "player") then
        AddResult(current, TalentString(false)) -- own talents readable directly
        current = nil
        return -- OnUpdate picks the next unit next frame
    end
    if not UnitIsConnected(current) or not CanInspect(current) then
        AddResult(current, "?")
        current = nil
        return
    end
    NotifyInspect(current)
end

frame:RegisterEvent("INSPECT_TALENT_READY")
frame:SetScript("OnEvent", function(_, event)
    if event == "INSPECT_TALENT_READY" and scanning and current then
        FinishUnit(TalentString(true))
    end
end)

local function OnUpdate(_, dt)
    if not scanning then return end
    if current then
        elapsed = elapsed + dt
        if elapsed > INSPECT_TIMEOUT then
            FinishUnit("?") -- timed out, mark unscanned
        end
    else
        NextUnit()
    end
end

SLASH_RAIDSPECSCAN1 = "/specscan"
SlashCmdList["RAIDSPECSCAN"] = function()
    if scanning then Print("Already scanning.") return end
    if not IsInRaid() then Print("You must be in a raid.") return end
    queue = {}
    results = {}
    for i = 1, GetNumGroupMembers() do
        local unit = "raid" .. i
        if UnitExists(unit) then table.insert(queue, unit) end
    end
    scanning = true
    Print("Scanning " .. #queue .. " raid members (stay within 28yd)…")
    frame:SetScript("OnUpdate", OnUpdate)
end
```

- [ ] **Step 3: Syntax-check if a Lua binary is available**

```bash
command -v luac >/dev/null && luac -p RaidSpecScan/RaidSpecScan.lua && echo "syntax OK" || echo "no luac — skip"
```

Expected: `syntax OK`, or skip if luac isn't installed.

- [ ] **Step 4: Verify the export format round-trips through the parser**

```bash
node -e "
const E = require('./assignments-engine.js');
const r = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/5/51;Afkguy:HUNTER:?');
console.assert(r.players.length === 2 && r.errors.length === 0, 'round-trip failed');
console.log('round-trip OK');
"
```

Expected: `round-trip OK`

- [ ] **Step 5: Document in-game verification (manual, next raid)**

Add to the commit message body — cannot be automated: install the folder into `Interface/AddOns/`, `/specscan` in a raid, confirm progress message, export window opens, paste into the web tool imports everyone, out-of-range players show `?spec` flags.

- [ ] **Step 6: Commit**

```bash
git add RaidSpecScan/
git commit -m "Add RaidSpecScan addon exporting raid talent scans

In-game verification pending next raid: /specscan in a 25-man,
confirm export string imports into assignments.html with out-of-range
players flagged for manual spec entry."
```

---

## Final verification (after all tasks)

- [ ] `node assignments-engine.test.js` → all pass, exit 0
- [ ] `node server.js` → index card opens the page; full manual flow: addon paste → auto-assign → all four output tabs → share link renders in a second browser tab
- [ ] Import a real Raid-Helper event (your guild's next signup) and confirm: signups appear, bench excluded, link panel appears for name mismatches, linking enables `<@id>` pings in the Discord tab
