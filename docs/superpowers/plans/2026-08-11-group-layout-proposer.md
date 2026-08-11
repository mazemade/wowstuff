# Group Layout Proposer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propose a party layout for the roster and explain what each grouping buys, because in TBC almost every buff — all totems, all paladin auras, Battle Shout, Leader of the Pack, Trueshot, Ferocious Inspiration — is party-scoped rather than raid-wide.

**Architecture:** A rule-based greedy assigner in `assignments-engine.js`, not a search. Players are bucketed into five role buckets, groups are seeded on shamans (the scarcest party-scoped buff source), each group is filled from its matching bucket ordered by anchor value, leftovers overflow, and a final swap-only pass de-duplicates draenei. Output is advisory: it never mutates the roster or the assignment sheet.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests via `node assignments-engine.test.js`.

**Depends on:** `2026-08-11-rss2-wire-format.md` (needs `player.race` for the draenei pass; the rest works without it).

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper.
- **Advisory only.** `proposeGroups` is pure. It must never write to `state`, `roster` or `sheet`. The raid lead reads the proposal and moves people in-game.
- **Opt-in surface.** The new panel sits *after* the assignments panel and must not affect import → auto-assign → Discord output.
- **Degrade, never throw.** A 10-man roster, an all-healer roster, an empty roster and a roster with `spec: null` players must all return a sane result rather than erroring.
- **Party scope is the whole point.** Encode TBC scope, not WotLK: totems are 20 yd party-only, paladin auras are 30 yd party-only, Battle Shout is party-only. Greater Blessings are the exception — raid-wide by class, so they are irrelevant here.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Bucket players by role

**Files:**
- Modify: `assignments-engine.js` (new function, add to exports at the bottom)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: `bucketOf(player) -> 'tanks' | 'melee' | 'ranged' | 'casters' | 'healers'`. Task 2 relies on these exact strings.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('bucketOf: specs map to the right role bucket', () => {
    assert.strictEqual(E.bucketOf(P('a', 'WARRIOR', 'Protection')), 'tanks');
    assert.strictEqual(E.bucketOf(P('b', 'WARRIOR', 'Fury')), 'melee');
    assert.strictEqual(E.bucketOf(P('c', 'PALADIN', 'Holy')), 'healers');
    assert.strictEqual(E.bucketOf(P('d', 'PALADIN', 'Retribution')), 'melee');
    assert.strictEqual(E.bucketOf(P('e', 'DRUID', 'Balance')), 'casters');
    assert.strictEqual(E.bucketOf(P('f', 'DRUID', 'Restoration')), 'healers');
    assert.strictEqual(E.bucketOf(P('g', 'PRIEST', 'Shadow')), 'casters');
    assert.strictEqual(E.bucketOf(P('h', 'PRIEST', 'Holy')), 'healers');
    assert.strictEqual(E.bucketOf(P('i', 'SHAMAN', 'Enhancement')), 'melee');
    assert.strictEqual(E.bucketOf(P('j', 'SHAMAN', 'Elemental')), 'casters');
    assert.strictEqual(E.bucketOf(P('k', 'ROGUE', 'Combat')), 'melee');
    assert.strictEqual(E.bucketOf(P('l', 'MAGE', 'Fire')), 'casters');
});
test('bucketOf: hunters are their own bucket, never melee', () => {
    assert.strictEqual(E.bucketOf(P('m', 'HUNTER', 'Beast Mastery')), 'ranged');
    assert.strictEqual(E.bucketOf(P('n', 'HUNTER', 'Survival')), 'ranged');
});
test('bucketOf: a null spec still returns a bucket', () => {
    assert.strictEqual(E.bucketOf(P('o', 'WARLOCK', null)), 'casters');
    assert.strictEqual(E.bucketOf(P('p', 'WARRIOR', null)), 'melee');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `E.bucketOf is not a function`.

- [ ] **Step 3: Implement**

In `assignments-engine.js`, add above the `return { ... }` export block:

```js
    // Hunters are deliberately NOT melee. Windfury is a main-hand weapon enchant and ranged
    // attacks do not proc it, so a hunter in the Windfury group wastes the slot. They want
    // Grace of Air, Trueshot, Ferocious Inspiration and Battle Shout instead.
    function bucketOf(p) {
        const s = p.spec;
        switch (p.class) {
            case 'WARRIOR': return s === 'Protection' ? 'tanks' : 'melee';
            case 'PALADIN': return s === 'Holy' ? 'healers' : (s === 'Protection' ? 'tanks' : 'melee');
            case 'DRUID':   return s === 'Restoration' ? 'healers' : (s === 'Balance' ? 'casters' : 'melee');
            case 'PRIEST':  return s === 'Shadow' ? 'casters' : 'healers';
            case 'SHAMAN':  return s === 'Restoration' ? 'healers' : (s === 'Elemental' ? 'casters' : 'melee');
            case 'ROGUE':   return 'melee';
            case 'HUNTER':  return 'ranged';
            default:        return 'casters';
        }
    }
```

Add `bucketOf` to the exported object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: bucket players into TBC group roles"
```

---

### Task 2: Propose the layout

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `bucketOf` from Task 1.
- Produces: `proposeGroups(roster) -> { groups: [{ role, players: [Player] }], unplaced: [Player] }`. Tasks 3 and 4 extend this same return value.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
function raid25() {
    const r = [];
    ['Tank1', 'Tank2'].forEach(n => r.push(P(n, 'WARRIOR', 'Protection')));
    ['Rog1', 'Rog2', 'Rog3'].forEach(n => r.push(P(n, 'ROGUE', 'Combat')));
    r.push(P('Fury1', 'WARRIOR', 'Fury'));
    r.push(P('Ret1', 'PALADIN', 'Retribution'));
    r.push(P('Ret2', 'PALADIN', 'Retribution')); // 25th body — without it the fixture is a 24-man and every "places 25" assertion fails
    ['Hunt1', 'Hunt2', 'Hunt3'].forEach(n => r.push(P(n, 'HUNTER', 'Beast Mastery')));
    ['Mage1', 'Mage2', 'Lock1', 'Lock2'].forEach(n =>
        r.push(P(n, n.indexOf('Mage') === 0 ? 'MAGE' : 'WARLOCK', n.indexOf('Mage') === 0 ? 'Fire' : 'Affliction')));
    r.push(P('Spriest', 'PRIEST', 'Shadow'));
    r.push(P('Boomy', 'DRUID', 'Balance'));
    ['Heal1', 'Heal2'].forEach(n => r.push(P(n, 'PRIEST', 'Holy')));
    r.push(P('Hpal', 'PALADIN', 'Holy'));
    r.push(P('Tree', 'DRUID', 'Restoration'));
    r.push(P('Enh', 'SHAMAN', 'Enhancement'));
    r.push(P('Ele', 'SHAMAN', 'Elemental'));
    r.push(P('Resto', 'SHAMAN', 'Restoration'));
    r.push(P('Feral', 'DRUID', 'Feral'));
    return r;
}
function groupOf(res, name) {
    const g = res.groups.find(g => g.players.some(p => p.name === name));
    return g ? g.role : null;
}

test('proposeGroups: makes five groups of at most five and places everyone', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(res.groups.length, 5);
    res.groups.forEach(g => assert.ok(g.players.length <= 5, g.role + ' has ' + g.players.length));
    assert.strictEqual(res.unplaced.length, 0);
    const placed = res.groups.reduce((n, g) => n + g.players.length, 0);
    assert.strictEqual(placed, 25);
});
test('proposeGroups: no player is placed twice', () => {
    const res = E.proposeGroups(raid25());
    const names = res.groups.flatMap(g => g.players.map(p => p.name));
    assert.strictEqual(new Set(names).size, names.length);
});
test('proposeGroups: shamans seed their matching group, one each', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(groupOf(res, 'Enh'), 'melee');
    assert.strictEqual(groupOf(res, 'Ele'), 'casters');
    assert.strictEqual(groupOf(res, 'Resto'), 'healers');
});
test('proposeGroups: hunters group together, away from windfury', () => {
    const res = E.proposeGroups(raid25());
    assert.strictEqual(groupOf(res, 'Hunt1'), 'ranged');
    assert.strictEqual(groupOf(res, 'Hunt2'), 'ranged');
});
test('proposeGroups: scarce shamans go to melee first, then casters', () => {
    const roster = raid25().filter(p => p.name !== 'Ele' && p.name !== 'Resto');
    const res = E.proposeGroups(roster);
    assert.strictEqual(groupOf(res, 'Enh'), 'melee');
});
test('proposeGroups: a ten-man roster degrades to two groups without throwing', () => {
    const res = E.proposeGroups(raid25().slice(0, 10));
    assert.strictEqual(res.groups.length, 2);
    assert.strictEqual(res.unplaced.length, 0);
});
test('proposeGroups: an empty roster returns no groups and does not throw', () => {
    const res = E.proposeGroups([]);
    assert.strictEqual(res.groups.length, 0);
    assert.strictEqual(res.unplaced.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `E.proposeGroups is not a function`.

- [ ] **Step 3: Implement**

Add to `assignments-engine.js` below `bucketOf`:

```js
    // Scarcity order: this is both the order groups are created for a short roster and the
    // order a limited number of shamans is spent. Windfury/Strength of Earth on melee is the
    // largest single delta; Totem of Wrath's spell hit is next; tanks gain least.
    const GROUP_ROLES = ['melee', 'casters', 'healers', 'ranged', 'tanks'];
    const SHAMAN_ROLE = { Enhancement: 'melee', Elemental: 'casters', Restoration: 'healers' };
    const GROUP_CAP = 5;

    // Within a role, place the players whose buffs are party-scoped first — they are the
    // reason the group exists, so they must not be crowded out by a filler DPS.
    function anchorScore(p) {
        if (p.class === 'WARRIOR' && p.spec !== 'Protection') return 0; // Battle Shout
        if (p.class === 'DRUID' && p.spec === 'Feral') return 0;        // Leader of the Pack
        if (p.class === 'DRUID' && p.spec === 'Balance') return 0;      // Moonkin Aura
        if (p.class === 'PRIEST' && p.spec === 'Shadow') return 0;      // Vampiric Touch
        if (p.class === 'HUNTER' && p.spec === 'Beast Mastery') return 0; // Ferocious Inspiration
        if (p.class === 'PALADIN') return 1;                            // an aura, any group
        return 2;
    }

    function proposeGroups(roster) {
        const n = roster.length;
        const groupCount = n ? Math.min(5, Math.ceil(n / GROUP_CAP)) : 0;
        const groups = GROUP_ROLES.slice(0, groupCount).map(role => ({ role, players: [] }));
        const byRole = {};
        groups.forEach(g => { byRole[g.role] = g; });
        const placed = new Set();

        function place(p, g) {
            if (!g || placed.has(p.name) || g.players.length >= GROUP_CAP) return false;
            g.players.push(p);
            placed.add(p.name);
            return true;
        }

        // 1. Shamans seed first — one per group, spec-matched, then spare shamans spread out.
        const shamans = roster.filter(p => p.class === 'SHAMAN');
        shamans.forEach(sh => place(sh, byRole[SHAMAN_ROLE[sh.spec]]));
        shamans.filter(p => !placed.has(p.name)).forEach(sh => {
            place(sh, groups.find(g => !g.players.some(x => x.class === 'SHAMAN') && g.players.length < GROUP_CAP));
        });

        // 2. Fill each group from its own bucket, anchors first.
        groups.forEach(g => {
            roster.filter(p => !placed.has(p.name) && bucketOf(p) === g.role)
                .sort((a, b) => anchorScore(a) - anchorScore(b) || a.name.localeCompare(b.name))
                .forEach(p => place(p, g));
        });

        // 3. Overflow: whoever is left goes wherever there is room, fullest-first so we do
        //    not scatter three leftovers across three otherwise-clean groups.
        const unplaced = [];
        roster.filter(p => !placed.has(p.name)).forEach(p => {
            const g = groups.filter(g => g.players.length < GROUP_CAP)
                .sort((a, b) => b.players.length - a.players.length)[0];
            if (!place(p, g)) unplaced.push(p);
        });

        return { groups, unplaced };
    }
```

Add `proposeGroups` to the exported object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. If the 25-man test reports someone unplaced, the bug is in step 3's overflow — check that `GROUP_CAP * groupCount >= roster.length` holds for 25.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: propose a TBC party layout from the roster"
```

---

### Task 3: De-duplicate draenei

**Files:**
- Modify: `assignments-engine.js` (`proposeGroups`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `player.race` from the RSS2 plan, `proposeGroups` from Task 2.
- Produces: no signature change — the pass runs inside `proposeGroups`.

Heroic Presence (+1% melee/ranged hit) and Inspiring Presence (+1% spell hit) are party-scoped and **do not stack for non-draenei**, so a second draenei in the same group is wasted. This is a swap-only pass: it never changes group sizes.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('proposeGroups: spreads draenei across groups rather than doubling up', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Human' }));
    roster.filter(p => ['Rog1', 'Rog2'].includes(p.name)).forEach(p => { p.race = 'Draenei'; });
    const res = E.proposeGroups(roster);
    const perGroup = res.groups.map(g => g.players.filter(p => p.race === 'Draenei').length);
    assert.ok(Math.max.apply(null, perGroup) <= 1, 'a group has two draenei: ' + perGroup.join(','));
});
test('proposeGroups: the draenei pass never changes group sizes', () => {
    const roster = raid25().map(p => Object.assign({}, p, { race: 'Draenei' }));
    const res = E.proposeGroups(roster);
    assert.strictEqual(res.groups.reduce((n, g) => n + g.players.length, 0), 25);
    res.groups.forEach(g => assert.ok(g.players.length <= 5));
});
test('proposeGroups: a roster with no race data is unaffected', () => {
    const withRace = E.proposeGroups(raid25().map(p => Object.assign({}, p, { race: null })));
    const without = E.proposeGroups(raid25());
    assert.deepStrictEqual(withRace.groups.map(g => g.players.map(p => p.name)),
                           without.groups.map(g => g.players.map(p => p.name)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the first test — the melee group fills up with anchors (shaman, feral, fury warrior, the two rets), so Rog1 and Rog2 both overflow into the same group and sit there together. Also expect the second test to fail on nothing but the placement count if raid25 was left at 24 players — it must total 25 before this task starts.

- [ ] **Step 3: Implement**

In `proposeGroups`, immediately before `return { groups, unplaced };`, add:

```js
        // Heroic/Inspiring Presence is party-scoped and does not stack for non-draenei, so a
        // second draenei in a group is wasted. Swap-only: sizes never change, and only filler
        // players trade places. Anchors are off-limits on BOTH sides of the swap — a draenei
        // rogue must never displace the Windfury shaman — so the seeding and anchor placement
        // from steps 1-2 cannot be undone here. anchorScore treats shamans as fillers (they
        // are placed by seeding, before anchor sorting ever runs), hence the explicit class
        // check alongside it. A surplus draenei who IS an anchor (a draenei BM hunter next to
        // another draenei) simply stays put: wasting a racial beats breaking a buff group.
        function swappable(p) { return p.class !== 'SHAMAN' && anchorScore(p) === 2; }
        groups.forEach(g => {
            const dr = g.players.filter(p => p.race === 'Draenei')
                .sort((a, b) => anchorScore(a) - anchorScore(b)); // keep the most anchor-like one in place
            dr.slice(1).forEach(extra => {
                if (!swappable(extra)) return;
                const target = groups.find(o => o !== g
                    && !o.players.some(p => p.race === 'Draenei')
                    && o.players.some(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra)));
                if (!target) return;
                const swap = target.players.find(p => p.race !== 'Draenei' && swappable(p) && bucketOf(p) === bucketOf(extra));
                g.players[g.players.indexOf(extra)] = swap;
                target.players[target.players.indexOf(swap)] = extra;
            });
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. Note the all-draenei test proves the pass gives up gracefully rather than looping — if it hangs, the `find` is matching the group being iterated. Also eyeball the first test's resulting layout: the enhancement shaman must still be in the melee group afterwards. The `swappable` guard exists precisely so this pass cannot trade the Windfury shaman away for a draenei rogue — if the shaman moved, the guard is broken.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: spread draenei one per party for heroic presence"
```

---

### Task 4: Explain each group, and render the panel

**Files:**
- Modify: `assignments-engine.js` (`proposeGroups`)
- Modify: `assignments.html:56` (new panel after the assignments section)
- Modify: `assignments.js` (`renderAll`, new `renderGroups`)
- Modify: `assignments.css`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `proposeGroups` from Tasks 2–3.
- Produces: each group gains `notes: [String]`.

- [ ] **Step 1: Write the failing test**

Append above the final `console.log`:

```js
test('proposeGroups: each group explains what its composition buys', () => {
    const res = E.proposeGroups(raid25());
    const melee = res.groups.find(g => g.role === 'melee');
    assert.ok(melee.notes.some(t => /Windfury/.test(t)));
    const casters = res.groups.find(g => g.role === 'casters');
    assert.ok(casters.notes.some(t => /Totem of Wrath/.test(t)));
    res.groups.forEach(g => assert.ok(Array.isArray(g.notes)));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node assignments-engine.test.js`

Expected: FAIL — `notes` is `undefined`.

- [ ] **Step 3: Implement the notes**

In `proposeGroups`, immediately before `return`, add:

```js
        // Say what the grouping actually buys, so the raid lead can sanity-check it rather
        // than trust it. Only claim a buff when the provider is genuinely in the group.
        const NOTE_RULES = [
            { text: 'Windfury Totem + Strength of Earth', has: g => g.role === 'melee' && g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
            { text: 'Unleashed Rage (+10% AP)', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement') },
            { text: 'Totem of Wrath (+3% spell hit and crit)', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental') },
            { text: 'Wrath of Air (+101 spell damage and healing)', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Elemental') },
            { text: 'Mana Tide Totem', has: g => g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Restoration') },
            { text: 'Battle Shout', has: g => g.players.some(p => p.class === 'WARRIOR' && p.spec !== 'Protection') },
            { text: 'Leader of the Pack (+5% melee/ranged crit)', has: g => g.players.some(p => p.class === 'DRUID' && p.spec === 'Feral') },
            { text: 'Moonkin Aura (+5% spell crit)', has: g => g.players.some(p => p.class === 'DRUID' && p.spec === 'Balance') },
            { text: 'Ferocious Inspiration (+3% damage, stacks per BM hunter)', has: g => g.players.some(p => p.class === 'HUNTER' && p.spec === 'Beast Mastery') },
            { text: 'Vampiric Touch (mana to the party)', has: g => g.players.some(p => p.class === 'PRIEST' && p.spec === 'Shadow') },
            { text: 'A paladin aura', has: g => g.players.some(p => p.class === 'PALADIN') },
            { text: '+1% hit from Draenei presence', has: g => g.players.some(p => p.race === 'Draenei') },
        ];
        groups.forEach(g => { g.notes = NOTE_RULES.filter(r => r.has(g)).map(r => r.text); });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Add the panel markup**

In `assignments.html`, insert this section immediately after the closing `</section>` of the assignments panel (the one containing `debuffRows`), before the Output panel:

```html
        <section class="panel">
            <h2>4 · Group layout <span class="hint">(advisory — move people in-game yourself)</span></h2>
            <div id="groupsBox"></div>
        </section>
```

Renumber the Output panel's heading from `4 · Output` to `5 · Output`.

- [ ] **Step 6: Render it**

In `assignments.js`, add this function above `renderAssignments`:

```js
const ROLE_LABELS = { melee: 'Melee', casters: 'Casters', healers: 'Healers', ranged: 'Hunters', tanks: 'Tanks' };

function renderGroups() {
    const box = document.getElementById('groupsBox');
    box.innerHTML = '';
    if (!roster.length) { box.textContent = 'Import a roster first.'; return; }
    const res = E.proposeGroups(roster);
    if (roster.some(p => p.group == null)) {
        const note = document.createElement('p');
        note.className = 'status';
        note.textContent = 'Some players have no in-game group (imported from an older addon version), so this is a proposal only.';
        box.appendChild(note);
    }
    res.groups.forEach((g, i) => {
        const card = document.createElement('div');
        card.className = 'group-card';
        const h = document.createElement('h4');
        h.textContent = 'Group ' + (i + 1) + ' — ' + (ROLE_LABELS[g.role] || g.role);
        card.appendChild(h);
        g.players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'group-player';
            row.textContent = p.name + (p.spec ? ' (' + p.spec + ')' : '');
            row.style.color = E.CLASS_COLORS ? E.CLASS_COLORS[p.class] : '';
            card.appendChild(row);
        });
        g.notes.forEach(t => {
            const n = document.createElement('div');
            n.className = 'group-note';
            n.textContent = '✓ ' + t;
            card.appendChild(n);
        });
        box.appendChild(card);
    });
    if (res.unplaced.length) {
        const warn = document.createElement('div');
        warn.className = 'warn';
        warn.textContent = '⚠ No room for: ' + res.unplaced.map(p => p.name).join(', ');
        box.appendChild(warn);
    }
}
```

Add `renderGroups();` to `renderAll`, between `renderAssignments();` and `renderOutput();`.

`CLASS_COLORS` is already exported from the engine (it sits in the return block alongside `SPEC_TREES`), so `E.CLASS_COLORS[p.class]` resolves — simplify the line to `row.style.color = E.CLASS_COLORS[p.class];`.

- [ ] **Step 7: Style it**

Append to `assignments.css`:

```css
#groupsBox { display: flex; flex-wrap: wrap; gap: 12px; }
.group-card { flex: 1 1 180px; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 10px; }
.group-card h4 { margin: 0 0 6px; font-size: 0.95em; }
.group-player { font-size: 0.9em; }
.group-note { font-size: 0.78em; opacity: 0.65; margin-top: 3px; }
.hint { font-weight: normal; font-size: 0.7em; opacity: 0.6; }
```

- [ ] **Step 8: Verify in the browser**

Run `npm start`, open `http://localhost:3000`, and import this 25-man roster via the addon box:

```
RSS2;Tank1:WARRIOR:5/6/50:1:Draenei;Tank2:WARRIOR:5/6/50:1:Human;Enh:SHAMAN:0/41/20:2:Orc;Rog1:ROGUE:15/41/5:2:Human;Rog2:ROGUE:15/41/5:2:Human;Fury1:WARRIOR:18/43/0:2:Orc;Ret1:PALADIN:0/0/61:2:Human;Ele:SHAMAN:41/0/20:3:Draenei;Mage1:MAGE:0/48/13:3:Human;Lock1:WARLOCK:43/0/18:3:Human;Spriest:PRIEST:0/0/41:3:Human;Boomy:DRUID:43/18/0:3:Human;Resto:SHAMAN:0/0/41:4:Draenei;Heal1:PRIEST:23/38/0:4:Human;Hpal:PALADIN:47/14/0:4:Human;Tree:DRUID:0/0/43:4:Human;Heal2:PRIEST:23/38/0:4:Human;Hunt1:HUNTER:41/20/0:5:Orc;Hunt2:HUNTER:41/20/0:5:Orc;Hunt3:HUNTER:0/41/20:5:Human;Feral:DRUID:0/47/14:5:Human;Mage2:MAGE:0/48/13:1:Human;Lock2:WARLOCK:43/0/18:1:Human;Rog3:ROGUE:15/41/5:1:Human;Ret2:PALADIN:0/0/61:1:Human
```

Expected: five group cards, each with at most five players; the enhancement shaman sits with melee, the elemental shaman with casters, the resto shaman with healers, and hunters are together. Notes appear under each card. No console errors. Confirm the assignments panel and Discord output are unchanged from before this panel existed.

- [ ] **Step 9: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.html assignments.js assignments.css
git commit -m "feat: propose and render a party layout with buff explanations"
```

---

## Open questions for the implementer

- **Feral druids bucket as melee, always.** A feral tank is common in TBC and belongs in the tank group. There is no way to tell a bear from a cat with tab totals alone, so this will misplace feral tanks. If it matters, the fix is a manual role override per player, not a smarter guess.
- **`proposeGroups` recomputes on every render.** It is cheap (25 players, no search), but if the panel ever gets drag-to-reorder it will need to hold state rather than recompute, or edits will be discarded on the next keystroke elsewhere.
- **The hill-climb polish pass from the spec is deliberately not implemented.** The greedy result was judged good enough. Add it only if real rosters produce visibly poor layouts — and if you do, score against a buff-value table rather than intuition.
