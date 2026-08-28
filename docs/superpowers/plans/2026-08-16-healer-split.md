# Healer Split (Tank / Raid buckets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-propose a tank-healing / raid-healing split of the roster's healers, with per-healer overrides, delivered through the sheet, Discord, /raid, whispers, addon payload, and the share view.

**Architecture:** Two new duty rows (`tankheal`, `raidheal`) in a new `healing` category, produced inside `autoAssign` in the pure engine (`assignments-engine.js`). They use the rotations' `players: []` shape plus a `targets: []` field naming the tanks. Output builders special-case the category; the browser UI adds one card with bucket-toggle chips.

**Tech Stack:** Plain JS (UMD engine + browser scripts), node built-in test harness (`npm test`), no dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-healer-split-design.md` — read it first; it records the owner's settled decisions (two buckets, auto + overrides, MT flags as tank source) and the TBC affinity rationale.

## Global Constraints

- Whisper-path text must be ASCII only (WoW 255-char chat budget is counted in UTF-16 units and assumed to equal UTF-8 bytes — see comment above `buildAddonWhispers`). Use `-`, never `—`, in whisper bodies.
- Duty shape is NOT uniform across categories (BRANCH-STATE §4): rotations/healing carry `players: []`, single duties carry `player`. Do not "normalize" this.
- `assignments.js` cannot be `require`d by the node test suite (BRANCH-STATE §4). All testable logic goes in `assignments-engine.js`; UI tasks are verified in a browser via the CDP harness (see the `wowstuff-verification-harness` memory).
- Do NOT touch the `RaidAssign/` addon. The healing lines ride the existing `Name=body` whisper lines of the RSW3 payload; no new `@` directive, no wire-format bump.
- Do not modify the group optimizer's use of `p.mt` (`layoutViolations`).
- Test command: `npm test` (runs `node assignments-engine.test.js && node wcl-mult.test.js`). All pre-existing tests must stay green.

---

### Task 1: Engine — healing buckets in `autoAssign`

**Files:**
- Modify: `assignments-engine.js` (insert after the ROTATIONS loop, currently ending ~line 620, before the `passives` computation)
- Test: `assignments-engine.test.js` (append a `--- Healer split ---` section)

**Interfaces:**
- Consumes: `bucketOf(p)` (already defined later in the file — function declarations hoist within the UMD closure, same as `bucketOf`'s existing use inside `autoAssign` would; if you prefer, mirror how other helpers are referenced), `overrides` param of `autoAssign`.
- Produces: two duty objects in `autoAssign().duties`:
  - `{ id: 'tankheal', name: 'Tank Healing', category: 'healing', players: string[], targets: string[], tanksAutoDetected?: true }`
  - `{ id: 'raidheal', name: 'Raid Healing', category: 'healing', players: string[], note?: string }`
  - Override shape read: `overrides.healing = { [playerName]: 'tank' | 'raid' }` (note: this occupies key `'healing'` in the duty-id-keyed overrides map; no duty has that id, so no collision).

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`:

```js
// --- Healer split ---
const HEAL_ROSTER = [
    { name: 'Bearford', class: 'DRUID', spec: 'Guardian' },
    { name: 'Warrison', class: 'WARRIOR', spec: 'Protection' },
    { name: 'Palaheal', class: 'PALADIN', spec: 'Holy' },
    { name: 'Droodheal', class: 'DRUID', spec: 'Restoration' },
    { name: 'Discy', class: 'PRIEST', spec: 'Discipline' },
    { name: 'Holyp', class: 'PRIEST', spec: 'Holy' },
    { name: 'Chainz', class: 'SHAMAN', spec: 'Restoration' },
    { name: 'Chainzz', class: 'SHAMAN', spec: 'Restoration' },
];
function healBuckets(roster, overrides) {
    const duties = E.autoAssign(roster, overrides || {}).duties;
    return { tank: duties.find(d => d.id === 'tankheal'), raid: duties.find(d => d.id === 'raidheal') };
}
test('healing: 2 detected tanks, 6 healers -> 3/3 split in affinity order', () => {
    const { tank, raid } = healBuckets(HEAL_ROSTER);
    assert.deepStrictEqual(tank.players, ['Palaheal', 'Droodheal', 'Discy']);
    assert.deepStrictEqual(raid.players, ['Holyp', 'Chainz', 'Chainzz']);
    assert.deepStrictEqual(tank.targets, ['Bearford', 'Warrison']);
    assert.strictEqual(tank.tanksAutoDetected, true);
    assert.strictEqual(tank.category, 'healing');
});
test('healing: MT flags beat detected tanks and shrink the bucket', () => {
    const roster = HEAL_ROSTER.map(p => Object.assign({}, p, p.name === 'Warrison' ? { mt: true } : {}));
    const { tank } = healBuckets(roster);
    assert.deepStrictEqual(tank.targets, ['Warrison']);
    assert.deepStrictEqual(tank.players, ['Palaheal', 'Droodheal']); // round(1.5*1) = 2
    assert.strictEqual(tank.tanksAutoDetected, undefined);
});
test('healing: zero tanks -> everyone raid-heals, tankheal row empty', () => {
    const healersOnly = HEAL_ROSTER.filter(p => !['Bearford', 'Warrison'].includes(p.name));
    const { tank, raid } = healBuckets(healersOnly);
    assert.deepStrictEqual(tank.players, []);
    assert.strictEqual(raid.players.length, 6);
});
test('healing: solo healer goes to raid bucket with a note', () => {
    const { tank, raid } = healBuckets([HEAL_ROSTER[0], HEAL_ROSTER[1], HEAL_ROSTER[2]]);
    assert.deepStrictEqual(tank.players, []);
    assert.deepStrictEqual(raid.players, ['Palaheal']);
    assert.ok(raid.note && raid.note.includes('Solo healer'));
});
test('healing: bucket clamps to leave at least one raid healer', () => {
    // 3 tanks would want round(4.5) = 5 tank healers; only 2 healers exist -> clamp to 1.
    const roster = [
        { name: 'T1', class: 'WARRIOR', spec: 'Protection' },
        { name: 'T2', class: 'PALADIN', spec: 'Protection' },
        { name: 'T3', class: 'DRUID', spec: 'Guardian' },
        { name: 'Palaheal', class: 'PALADIN', spec: 'Holy' },
        { name: 'Chainz', class: 'SHAMAN', spec: 'Restoration' },
    ];
    const { tank, raid } = healBuckets(roster);
    assert.deepStrictEqual(tank.players, ['Palaheal']);
    assert.deepStrictEqual(raid.players, ['Chainz']);
});
test('healing: spec-unknown and non-healer priests are excluded', () => {
    const roster = HEAL_ROSTER.concat([
        { name: 'Afk', class: 'PRIEST', spec: null, flags: ['spec-unknown'] },
        { name: 'Shadowy', class: 'PRIEST', spec: 'Shadow' },
    ]);
    const { tank, raid } = healBuckets(roster);
    const all = tank.players.concat(raid.players);
    assert.ok(!all.includes('Afk'));
    assert.ok(!all.includes('Shadowy'));
});
test('healing: overrides force buckets and the rest still fills to target', () => {
    const { tank, raid } = healBuckets(HEAL_ROSTER, { healing: { Palaheal: 'raid', Chainz: 'tank' } });
    assert.ok(raid.players.includes('Palaheal'));
    assert.ok(tank.players.includes('Chainz'));
    assert.strictEqual(tank.players.length, 3); // target size unchanged
    assert.deepStrictEqual(tank.players, ['Chainz', 'Droodheal', 'Discy']);
});
test('healing: forced tanks beyond target size are all kept', () => {
    const { tank } = healBuckets(HEAL_ROSTER,
        { healing: { Palaheal: 'tank', Droodheal: 'tank', Discy: 'tank', Holyp: 'tank' } });
    assert.strictEqual(tank.players.length, 4);
});
test('healing: override naming a departed player is ignored without crashing', () => {
    const { tank } = healBuckets(HEAL_ROSTER, { healing: { Ghost: 'tank' } });
    assert.deepStrictEqual(tank.players, ['Palaheal', 'Droodheal', 'Discy']);
});
test('healing: no healers -> no healing duties at all', () => {
    const duties = E.autoAssign([{ name: 'T1', class: 'WARRIOR', spec: 'Protection' }], {}).duties;
    assert.ok(!duties.some(d => d.category === 'healing'));
});
test('healing: deterministic across runs', () => {
    assert.deepStrictEqual(healBuckets(HEAL_ROSTER), healBuckets(HEAL_ROSTER));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js 2>&1 | grep -A1 "FAIL - healing"`
Expected: every `healing:` test FAILs (tankheal/raidheal duties don't exist yet, so `tank` is `undefined`).

- [ ] **Step 3: Implement the healing bucket block**

In `assignments-engine.js`, inside `autoAssign`, directly after the `ROTATIONS.forEach(...)` block and before `const passives = ...`, insert:

```js
        // Healer split: two buckets, tank vs raid (spec 2026-08-16-healer-split-design.md).
        // Tank set = MT-flagged players if any are flagged, else detected tanks. Affinity
        // order is the TBC meta: single-target/HoT healers (pally, druid lifebloom, disc)
        // babysit tanks; Chain Heal and deep Holy cover the raid.
        const HEALING_TANK_AFFINITY = ['PALADIN:Holy', 'DRUID:Restoration', 'PRIEST:Discipline',
                                       'PRIEST:Holy', 'SHAMAN:Restoration'];
        const healers = roster.filter(p => bucketOf(p) === 'healers' && !(p.flags || []).includes('spec-unknown'));
        if (healers.length) {
            const mtFlagged = roster.filter(p => p.mt);
            const tanks = mtFlagged.length ? mtFlagged : roster.filter(p => bucketOf(p) === 'tanks');
            const affinity = p => {
                const i = HEALING_TANK_AFFINITY.indexOf(p.class + ':' + p.spec);
                return i === -1 ? HEALING_TANK_AFFINITY.length : i;
            };
            // Target size: ~1.5 healers per tank, but never drain the raid bucket. The
            // Math.max(…, 1) is defensive per spec — round(1.5*n) >= 2 for n >= 1, so it
            // can only matter if the multiplier is ever tuned below 1.
            let want = Math.min(Math.round(1.5 * tanks.length), healers.length - 1);
            if (tanks.length > 0 && healers.length >= 2) want = Math.max(want, 1);
            const forced = (overrides && overrides.healing) || {};
            const tankBucket = healers.filter(p => forced[p.name] === 'tank');
            const raidBucket = healers.filter(p => forced[p.name] === 'raid');
            healers.filter(p => !forced[p.name])
                .map((p, i) => ({ p, i }))                                  // decorate: ties break by roster order
                .sort((a, b) => (affinity(a.p) - affinity(b.p)) || (a.i - b.i))
                .forEach(x => { (tankBucket.length < want ? tankBucket : raidBucket).push(x.p); });
            const tankRow = { id: 'tankheal', name: 'Tank Healing', category: 'healing',
                              players: tankBucket.map(p => p.name), targets: tanks.map(t => t.name) };
            if (!mtFlagged.length && tanks.length) tankRow.tanksAutoDetected = true;
            duties.push(tankRow);
            const raidRow = { id: 'raidheal', name: 'Raid Healing', category: 'healing',
                              players: raidBucket.map(p => p.name) };
            if (healers.length === 1 && tanks.length) raidRow.note = 'Solo healer covers tanks and raid.';
            duties.push(raidRow);
        }
```

Note: `bucketOf` is a `function` declaration inside the same UMD closure, defined below `autoAssign` — it hoists, so calling it here is fine (verify with the test run, not by assumption).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all new `healing:` tests PASS and every pre-existing test stays green. Watch specifically for pre-existing whisper/raid-line tests — they may now see healing rows (fix expectations only if a test asserts on the full duty list; do not weaken assertions).

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: healer split — tank/raid buckets proposed in autoAssign"
```

---

### Task 2: Engine — healing in Discord, /raid, whispers, addon payload

**Files:**
- Modify: `assignments-engine.js` — `buildDiscord` (~line 659), `buildRaidLines` (~line 740), `whisperMap` (~line 757)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: the `tankheal`/`raidheal` duty rows from Task 1 (`players: string[]`, `targets: string[]` on tankheal).
- Produces: whisper text `TANK HEALING - keep <t1>, <t2> up` / `RAID HEALING` (ASCII only); a `**Healing**` Discord section; `Tank Healing: A, B on T1, T2` raid-macro items. `buildAddonWhispers` needs no edit — it consumes `whisperMap`.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js` (reuses `HEAL_ROSTER` from Task 1):

```js
function healSheet(roster, overrides) {
    const r = roster || HEAL_ROSTER;
    return Object.assign({}, E.autoAssign(r, overrides || {}), { cc: [] });
}
test('healing whispers: tank healers get tank names, raid healers get RAID HEALING', () => {
    const w = E.buildWhispers(HEAL_ROSTER, healSheet());
    const pala = w.find(l => l.startsWith('/w Palaheal '));
    assert.ok(pala.includes('TANK HEALING - keep Bearford, Warrison up'), pala);
    const chainz = w.find(l => l.startsWith('/w Chainz '));
    assert.ok(chainz.includes('RAID HEALING'), chainz);
    assert.ok(!chainz.includes('TANK HEALING'), chainz);
});
test('healing whispers: no ordinal slot text on healing rows', () => {
    const w = E.buildWhispers(HEAL_ROSTER, healSheet()).join('\n');
    assert.ok(!/TANK HEALING \(\d/.test(w), w);
    assert.ok(!/RAID HEALING \(\d/.test(w), w);
});
test('healing whisper text is ASCII only (addon length budget)', () => {
    const w = E.buildWhispers(HEAL_ROSTER, healSheet()).join('\n');
    // eslint-disable-next-line no-control-regex
    assert.ok(/^[\x00-\x7F]*$/.test(w.split('TANK HEALING')[1] || ''), 'non-ASCII in healing whisper');
});
test('healing in Discord output as its own section', () => {
    const out = E.buildDiscord(HEAL_ROSTER, healSheet(), {});
    assert.ok(out.includes('**Healing**'), out);
    assert.ok(out.includes('Tank Healing:'), out);
    assert.ok(out.includes('Raid Healing:'), out);
});
test('healing: empty tank bucket is omitted from Discord', () => {
    const healersOnly = HEAL_ROSTER.filter(p => !['Bearford', 'Warrison'].includes(p.name));
    const out = E.buildDiscord(healersOnly, healSheet(healersOnly), {});
    assert.ok(!out.includes('Tank Healing:'), out);
    assert.ok(out.includes('Raid Healing:'), out);
});
test('healing in /raid lines without rotation arrows', () => {
    const lines = E.buildRaidLines(HEAL_ROSTER, healSheet()).join('\n');
    assert.ok(lines.includes('Tank Healing: Palaheal, Droodheal, Discy on Bearford, Warrison'), lines);
    assert.ok(!lines.includes('Tank Healing: Palaheal >'), lines);
});
test('healing rides the addon payload via whisper lines', () => {
    const payload = E.buildAddonWhispers(HEAL_ROSTER, healSheet(), null);
    assert.ok(payload.split('\n').some(l => l.startsWith('Palaheal=') && l.includes('TANK HEALING')), payload);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js 2>&1 | grep "FAIL"`
Expected: the new tests FAIL. Note the exact current failure mode: `whisperMap`'s `d.players` branch already picks healing rows up and emits wrong ordinal text (`Tank Healing (1st of 3)`), so the "no ordinal" test must be failing — that proves the test detects the bug it guards against.

- [ ] **Step 3: Implement**

In `whisperMap`, change the rotation branch and add a healing branch:

```js
        // A rotation has no single owner, so each member is told their own slot in the order —
        // knowing you are third is the whole point of a Fear Ward rotation.
        sheet.duties.filter(d => d.players && d.category !== 'healing').forEach(d => {
            d.players.forEach((n, i) => add(n, d.name + ' (' + ordinal(i + 1) + ' of ' + d.players.length + ')'));
        });
        // Healing buckets are unordered; everyone in a bucket gets the same line, and tank
        // healers are told their tanks by name so the whisper stands alone on voice-less
        // pulls. ASCII only — this text feeds the addon whisper path.
        sheet.duties.filter(d => d.category === 'healing').forEach(d => {
            const txt = d.id === 'tankheal'
                ? 'TANK HEALING' + (d.targets && d.targets.length ? ' - keep ' + d.targets.join(', ') + ' up' : '')
                : 'RAID HEALING';
            d.players.forEach(n => add(n, txt));
        });
```

In `buildRaidLines`, make the same category split:

```js
        sheet.duties.filter(d => d.players && d.category !== 'healing').forEach(d => {
            items.push(d.name + ': ' + d.players.join(' > '));
        });
        sheet.duties.filter(d => d.category === 'healing' && d.players.length).forEach(d => {
            let s = d.name + ': ' + d.players.join(', ');
            if (d.targets && d.targets.length) s += ' on ' + d.targets.join(', ');
            items.push(s);
        });
```

In `buildDiscord`, after the `[['debuffs', 'Debuffs'], ['cooldowns', 'Cooldowns']].forEach(...)` block and before the rotations block, insert:

```js
        const healing = sheet.duties.filter(d => d.category === 'healing' && d.players && d.players.length);
        if (healing.length) {
            lines.push('**Healing**');
            healing.forEach(d => {
                let s = '• **' + d.name + ':** ' + d.players.map(nm).join(', ');
                if (d.targets && d.targets.length) s += ' → ' + d.targets.map(nm).join(', ');
                lines.push(s);
            });
            lines.push('');
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS, including the pre-existing rotation whisper tests (the `category !== 'healing'` filter must not have disturbed them).

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: healer split flows to Discord, /raid, whispers and addon payload"
```

---

### Task 3: Sheet UI — Healing card with bucket toggles

**Files:**
- Modify: `assignments.html` (Assignments section cards, ~line 51-56)
- Modify: `assignments.js` — `recompute()` stale sweep (~line 61-71), new `healingRow()` next to `rotationRow()` (~line 387), `renderAssignments()` (~line 759)

**Interfaces:**
- Consumes: `tankheal`/`raidheal` duty rows; `state.overrides.healing = { [name]: 'tank'|'raid' }` (written here, read by the engine from Task 1).
- Produces: DOM only. Reuses `.assign-row.rotation`, `.rotation-list`, `.rotation-chip`, `.chip-btn`, `.passive` CSS classes — no stylesheet changes.

- [ ] **Step 1: Add the card to assignments.html**

In the `<div class="cards">` of section "3 · Assignments", after the Cooldowns card and before Crowd Control:

```html
                <div class="card"><h3>Healing</h3><div id="healingRows"></div></div>
```

- [ ] **Step 2: Add the stale-name sweep in recompute()**

In `recompute()`, directly after the existing `Object.values(state.overrides).forEach(...)` sweep (which skips the healing map harmlessly — it has no `player`/`target`/`players` keys), add:

```js
    // overrides.healing is keyed by player name, not duty id, so the generic sweep above
    // cannot see its stale names — sweep it the same way blessings cells are swept.
    if (state.overrides.healing) {
        Object.keys(state.overrides.healing).forEach(n => {
            if (!names.has(n)) delete state.overrides.healing[n];
        });
    }
```

- [ ] **Step 3: Add healingRow() and wire renderAssignments()**

After `rotationRow()` in `assignments.js`:

```js
function healingRow(d) {
    const wrap = document.createElement('div');
    wrap.className = 'assign-row rotation';
    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name + (d.targets && d.targets.length ? ' (' + d.targets.join(', ') + ')' : '');
    if (d.note) label.title = d.note;
    wrap.appendChild(label);
    const list = document.createElement('div');
    list.className = 'rotation-list';
    d.players.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'rotation-chip';
        chip.textContent = name;
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'chip-btn';
        move.textContent = '⇄';
        move.setAttribute('aria-label', 'Move ' + name + ' to ' + (d.id === 'tankheal' ? 'raid' : 'tank') + ' healing');
        move.addEventListener('click', () => {
            const map = Object.assign({}, state.overrides.healing);
            map[name] = d.id === 'tankheal' ? 'raid' : 'tank';
            state.overrides.healing = map;
            renderAll();
        });
        chip.appendChild(move);
        list.appendChild(chip);
    });
    wrap.appendChild(list);
    return wrap;
}
```

In `renderAssignments()`, after the cooldowns block:

```js
    const healBox = document.getElementById('healingRows');
    healBox.innerHTML = '';
    const healingDuties = sheet.duties.filter(d => d.category === 'healing');
    healingDuties.forEach(d => healBox.appendChild(healingRow(d)));
    if (healingDuties.some(d => d.tanksAutoDetected)) {
        const note = document.createElement('div');
        note.className = 'assign-row passive';
        note.textContent = 'No MTs flagged — using detected tanks. Flag MTs in the player tuning panel.';
        healBox.appendChild(note);
    }
```

- [ ] **Step 4: Verify in the browser**

`assignments.js` is not node-testable — verify against the served page. Start the server (`node server.js`; use the port it logs) and drive headless Chrome over CDP per the `wowstuff-verification-harness` memory (it lists the gotchas; read it before starting). Verify, with a pasted RSS roster containing 2 tanks and 3+ healers:

1. The Healing card shows Tank Healing (with tank names in the label) and Raid Healing rows, healers split per the affinity order.
2. Clicking ⇄ on a tank healer moves them to Raid Healing and the change survives the re-render (`renderAll`) and a page reload (localStorage).
3. With no MT flagged, the "No MTs flagged" hint shows; flagging an MT in the player tuning panel makes the hint disappear and the label show only that tank.
4. The Output tab's Discord/whispers text includes the Healing section (Task 2's engine output reaching the page).

Paste the actual observed results (screenshot or DOM text) into the task report — do not claim success without them.

- [ ] **Step 5: Commit**

```bash
git add assignments.html assignments.js
git commit -m "feat: Healing card on the sheet with tank/raid bucket toggles"
```

---

### Task 4: Share view page — Healing card

**Files:**
- Modify: `assignments-view.html` (cards markup ~line 14-18, render script ~line 59-70)

**Interfaces:**
- Consumes: `sheet.duties` healing rows from the share payload (already included — the payload serializes the whole sheet).
- Produces: DOM only.

- [ ] **Step 1: Add the card and its rendering**

In the `<div class="cards">`, after the Cooldowns card:

```html
            <div class="card"><h3>Healing</h3><div id="healingRows"></div></div>
```

In the render script, after the cooldowns `forEach` and before the CC block:

```js
            const healing = document.getElementById('healingRows');
            sheet.duties.filter(d => d.category === 'healing' && d.players && d.players.length)
                .forEach(d => row(healing, d.name + ' — ' + d.players.join(', ')
                    + (d.targets && d.targets.length ? ' → ' + d.targets.join(', ') : '')));
```

(Old share links carry no healing rows; the filter leaves the card empty, which matches how the page already treats absent blessings/rotations. Do not fix that pre-existing gap here.)

- [ ] **Step 2: Verify in the browser**

Generate a share URL from a real sheet and open it headless (server from Task 3 still running):

```bash
node -e "
const E = require('./assignments-engine.js');
const roster = [
  { name: 'Bearford', class: 'DRUID', spec: 'Guardian' },
  { name: 'Warrison', class: 'WARRIOR', spec: 'Protection' },
  { name: 'Palaheal', class: 'PALADIN', spec: 'Holy' },
  { name: 'Chainz', class: 'SHAMAN', spec: 'Restoration' },
  { name: 'Holyp', class: 'PRIEST', spec: 'Holy' },
];
const payload = { title: 'Healer split test', sheet: Object.assign(E.autoAssign(roster, {}), { cc: [] }) };
const enc = Buffer.from(unescape(encodeURIComponent(JSON.stringify(payload))), 'binary').toString('base64');
console.log('/assignments-view.html?data=' + encodeURIComponent(enc));
"
```

Open the printed path on the local server via the CDP harness and confirm the Healing card shows `Tank Healing — Palaheal, Holyp → Bearford, Warrison` and `Raid Healing — Chainz`. (Two detected tanks → `want = min(round(3), 3−1) = 2`; affinity picks the Holy paladin then the Holy priest, leaving the Chain Heal shaman on raid.) Paste the rendered DOM text into the task report.

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test`
Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add assignments-view.html
git commit -m "feat: share view renders the healer split"
```
