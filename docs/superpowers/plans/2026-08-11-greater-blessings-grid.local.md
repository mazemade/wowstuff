# Greater Blessings Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PallyPower-style paladin × class matrix that auto-fills by paladin spec, flags gaps and duplicates, and is fully editable — because Greater Blessings are the most-assigned thing in a TBC raid and the tool currently ignores them entirely.

**Architecture:** Greater Blessings are cast per **class**, not per player — one cast covers every warrior in the raid for 30 minutes. That is why the model is paladin × class and not paladin × player. The engine produces a default grid plus warnings; the UI renders it as a table of dropdowns whose edits live in `state.blessings` and override the default cell by cell.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests via `node assignments-engine.test.js`.

**Depends on:** `2026-08-11-catalog-rules-and-warning-split.md`, and `2026-08-11-group-layout-proposer.md` for `bucketOf` — the per-class blessing defaults are derived from the actual specs in the roster rather than a fixed list, and `bucketOf` is what turns a spec into "wants mana" or "wants attack power".

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper.
- **Per class, never per player.** A cell is (paladin, class) → blessing. Any design that assigns a blessing to an individual is wrong for Greater Blessings.
- **Only classes present in the roster get columns.** A grid with nine columns for a raid with five classes is noise.
- **Edits survive re-import.** `state.blessings` is keyed by paladin name and class token, and reconciles like `state.overrides` does — a cell pointing at a paladin who left the roster is dropped in `recompute`.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Default grid from paladin specs

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: `GREATER_BLESSINGS -> [String]` and
  `proposeBlessings(roster, overrides) -> { classes: [String], rows: [{ paladin, spec, cells: { CLASS: blessing|null } }], warnings: [String] }`.
  Tasks 2–3 rely on this exact shape. `overrides` is `{ '<paladin>|<CLASS>': blessing }`.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
function palRoster() {
    return [
        P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'),
        P('Bubbles', 'PALADIN', 'Protection'),
        P('Thunderfist', 'WARRIOR', 'Protection'), P('Stabby', 'ROGUE', 'Combat'),
        P('Mage1', 'MAGE', 'Fire'), P('Holymel', 'PRIEST', 'Holy'),
    ];
}

test('proposeBlessings: only classes present get a column', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.deepStrictEqual(g.classes.slice().sort(), ['MAGE', 'PALADIN', 'PRIEST', 'ROGUE', 'WARRIOR']);
});
test('proposeBlessings: one row per paladin, ret first', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.strictEqual(g.rows.length, 3);
    assert.strictEqual(g.rows[0].paladin, 'Retdin');
});
test('proposeBlessings: ret covers everything with kings', () => {
    const g = E.proposeBlessings(palRoster(), {});
    g.classes.forEach(c => assert.strictEqual(g.rows[0].cells[c], 'Greater Kings'));
});
test('proposeBlessings: holy splits might to physical, wisdom to casters', () => {
    const g = E.proposeBlessings(palRoster(), {});
    const holy = g.rows.find(r => r.paladin === 'Lightbringer');
    assert.strictEqual(holy.cells.WARRIOR, 'Greater Might');
    assert.strictEqual(holy.cells.ROGUE, 'Greater Might');
    assert.strictEqual(holy.cells.MAGE, 'Greater Wisdom');
    assert.strictEqual(holy.cells.PRIEST, 'Greater Wisdom');
});
test('proposeBlessings: an override replaces exactly one cell', () => {
    const g = E.proposeBlessings(palRoster(), { 'Retdin|MAGE': 'Greater Salvation' });
    assert.strictEqual(g.rows[0].cells.MAGE, 'Greater Salvation');
    assert.strictEqual(g.rows[0].cells.WARRIOR, 'Greater Kings');
});
test('proposeBlessings: a class default follows that class specs in THIS roster', () => {
    const base = [P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy')];
    const casterish = E.proposeBlessings(base.concat([
        P('Resto1', 'SHAMAN', 'Restoration'), P('Resto2', 'SHAMAN', 'Restoration'),
        P('Enh1', 'SHAMAN', 'Enhancement')]), {});
    assert.strictEqual(casterish.rows[1].cells.SHAMAN, 'Greater Wisdom'); // 2 of 3 want mana
    const meleeish = E.proposeBlessings(base.concat([
        P('Enh1', 'SHAMAN', 'Enhancement'), P('Enh2', 'SHAMAN', 'Enhancement'),
        P('Resto1', 'SHAMAN', 'Restoration')]), {});
    assert.strictEqual(meleeish.rows[1].cells.SHAMAN, 'Greater Might');
});
test('proposeBlessings: sanctuary only goes to a class that actually tanks', () => {
    const roster = [P('Retdin', 'PALADIN', 'Retribution'), P('Lightbringer', 'PALADIN', 'Holy'),
                    P('Bubbles', 'PALADIN', 'Protection'), P('Thunderfist', 'WARRIOR', 'Protection'),
                    P('Stabby', 'ROGUE', 'Combat')];
    const g = E.proposeBlessings(roster, {});
    assert.strictEqual(g.rows[2].cells.WARRIOR, 'Sanctuary');
    assert.strictEqual(g.rows[2].cells.ROGUE, 'Greater Salvation');
});
test('proposeBlessings: no paladins gives empty rows and a warning', () => {
    const g = E.proposeBlessings(palRoster().filter(p => p.class !== 'PALADIN'), {});
    assert.strictEqual(g.rows.length, 0);
    assert.ok(g.warnings.some(w => /no paladin/i.test(w)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `E.proposeBlessings is not a function`.

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`:

```js
    const GREATER_BLESSINGS = ['Greater Kings', 'Greater Might', 'Greater Wisdom',
                               'Greater Salvation', 'Greater Light', 'Sanctuary'];

    // Whether a class wants Might or Wisdom is a property of THIS roster, not a fixed list.
    // We know every player's tree from their talent totals, so ask: do most of this raid's
    // shamans want mana or attack power? A raid with three resto shamans and one enhance
    // gets Wisdom for SHAMAN without anyone editing a cell.
    const WISDOM_BUCKETS = ['casters', 'healers'];
    function classWantsWisdom(roster, cls) {
        const members = roster.filter(p => p.class === cls);
        if (!members.length) return false;
        const wisdom = members.filter(p => WISDOM_BUCKETS.indexOf(bucketOf(p)) !== -1).length;
        return wisdom * 2 > members.length; // strict majority; ties go to Might
    }

    // Whether a class is tanky enough for Sanctuary, again from the actual roster.
    function classHasTank(roster, cls) {
        return roster.some(p => p.class === cls && bucketOf(p) === 'tanks');
    }

    // Paladin n gets plan n. Ret takes Kings raid-wide because it is the single best blessing
    // and Ret is the least likely to be doing anything else at pull.
    const BLESSING_PLANS = [
        (cls, roster) => 'Greater Kings',
        (cls, roster) => (classWantsWisdom(roster, cls) ? 'Greater Wisdom' : 'Greater Might'),
        (cls, roster) => (classHasTank(roster, cls) ? 'Sanctuary' : 'Greater Salvation'),
        (cls, roster) => (classWantsWisdom(roster, cls) ? 'Greater Salvation' : 'Greater Light'),
    ];
    const PALADIN_ORDER = { Retribution: 0, Holy: 1, Protection: 2 };

    function proposeBlessings(roster, overrides) {
        overrides = overrides || {};
        const classes = [];
        roster.forEach(p => { if (classes.indexOf(p.class) === -1) classes.push(p.class); });
        classes.sort();

        const paladins = roster.filter(p => p.class === 'PALADIN').slice().sort((a, b) => {
            const oa = PALADIN_ORDER[a.spec], ob = PALADIN_ORDER[b.spec];
            return (oa === undefined ? 9 : oa) - (ob === undefined ? 9 : ob) || a.name.localeCompare(b.name);
        });

        const rows = paladins.map((pal, i) => {
            const plan = BLESSING_PLANS[i] || BLESSING_PLANS[BLESSING_PLANS.length - 1];
            const cells = {};
            classes.forEach(cls => {
                const key = pal.name + '|' + cls;
                cells[cls] = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : plan(cls, roster);
            });
            return { paladin: pal.name, spec: pal.spec, cells };
        });

        const warnings = [];
        if (!paladins.length && roster.length) warnings.push('No paladin in the raid — no blessings at all.');
        return { classes, rows, warnings };
    }
```

Export `GREATER_BLESSINGS` and `proposeBlessings`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: propose a greater blessings grid from paladin specs"
```

---

### Task 2: Warn about gaps and duplicates

**Files:**
- Modify: `assignments-engine.js` (`proposeBlessings`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Task 1's return value.
- Produces: `warnings` gains entries. No signature change.

- [ ] **Step 1: Write the failing tests**

```js
test('proposeBlessings: warns when a class has no blessing at all', () => {
    const g = E.proposeBlessings(palRoster(), { 'Retdin|MAGE': null, 'Lightbringer|MAGE': null, 'Bubbles|MAGE': null });
    assert.ok(g.warnings.some(w => /MAGE/.test(w) && /no blessing/i.test(w)));
});
test('proposeBlessings: warns when two paladins give a class the same blessing', () => {
    const g = E.proposeBlessings(palRoster(), { 'Lightbringer|WARRIOR': 'Greater Kings' });
    assert.ok(g.warnings.some(w => /WARRIOR/.test(w) && /Greater Kings/.test(w)));
});
test('proposeBlessings: a clean default grid has no gap or duplicate warnings', () => {
    const g = E.proposeBlessings(palRoster(), {});
    assert.deepStrictEqual(g.warnings, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `warnings` stays empty in the first two.

- [ ] **Step 3: Implement**

In `proposeBlessings`, replace the `warnings` block with:

```js
        const warnings = [];
        if (!paladins.length && roster.length) warnings.push('No paladin in the raid — no blessings at all.');
        classes.forEach(cls => {
            const given = rows.map(r => r.cells[cls]).filter(Boolean);
            if (rows.length && !given.length) warnings.push(cls + ': no blessing assigned.');
            const seen = {};
            given.forEach(b => {
                seen[b] = (seen[b] || 0) + 1;
                if (seen[b] === 2) warnings.push(cls + ': two paladins are both casting ' + b + ' — one is wasted.');
            });
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: warn about blessing gaps and duplicate coverage"
```

---

### Task 3: Render the editable grid

**Files:**
- Modify: `assignments.html` (new panel)
- Modify: `assignments.js` (`state`, `recompute`, `renderAll`, new `renderBlessings`)
- Modify: `assignments.css`

**Interfaces:**
- Consumes: `E.proposeBlessings(roster, state.blessings)` and `E.GREATER_BLESSINGS`.
- Produces: `state.blessings` — `{ '<paladin>|<CLASS>': blessing|null }`, persisted with the rest of state.

- [ ] **Step 1: Add the state field and reconcile it**

In `assignments.js`, add `blessings: {},` to the initial `state` object literal.

In `recompute`, inside the stale-reference reconciliation block (next to the existing `state.overrides` cleanup), add:

```js
    // Drop cells belonging to a paladin who is no longer on the roster, the same way
    // override players are dropped — otherwise a re-import resurrects a stale grid.
    Object.keys(state.blessings || {}).forEach(k => {
        if (!names.has(k.split('|')[0])) delete state.blessings[k];
    });
```

Also add `blessings: state.blessings` handling to the `clearRosterBtn` reset object so clearing the roster clears the grid: add `blessings: {},` alongside `overrides: {}`.

- [ ] **Step 2: Add the panel markup**

In `assignments.html`, add after the group-layout panel (or after the assignments panel if the group plan has not landed):

```html
        <section class="panel">
            <h2>Greater Blessings</h2>
            <div id="blessingWarnings" class="warn hidden"></div>
            <div id="blessingGrid"></div>
        </section>
```

Renumber the following panel headings so the `N ·` prefixes stay sequential.

- [ ] **Step 3: Render**

Add to `assignments.js`:

```js
function renderBlessings() {
    const box = document.getElementById('blessingGrid');
    const warnBox = document.getElementById('blessingWarnings');
    box.innerHTML = '';
    if (!roster.length) { box.textContent = 'Import a roster first.'; warnBox.classList.add('hidden'); return; }

    const g = E.proposeBlessings(roster, state.blessings);
    const table = document.createElement('table');
    table.className = 'blessing-grid';

    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    g.classes.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c.slice(0, 3);
        th.title = c;
        th.style.color = E.CLASS_COLORS[c];
        head.appendChild(th);
    });
    table.appendChild(head);

    const opts = E.GREATER_BLESSINGS.map(b => ({ value: b, label: b.replace('Greater ', 'G.') }));
    g.rows.forEach(row => {
        const tr = document.createElement('tr');
        const name = document.createElement('th');
        name.textContent = row.paladin;
        name.style.color = E.CLASS_COLORS.PALADIN;
        tr.appendChild(name);
        g.classes.forEach(cls => {
            const td = document.createElement('td');
            td.appendChild(makeSelect(opts, row.cells[cls], true, val => {
                state.blessings[row.paladin + '|' + cls] = val;
                renderAll();
            }));
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
    box.appendChild(table);

    if (g.warnings.length) {
        warnBox.classList.remove('hidden');
        warnBox.textContent = '⚠ ' + g.warnings.join('  ·  ');
    } else {
        warnBox.classList.add('hidden');
    }
}
```

Add `renderBlessings();` to `renderAll`.

Confirm `makeSelect(options, value, allowEmpty, onChange)` matches this call signature by reading its definition in `assignments.js` before relying on it — the `allowEmpty` argument is what lets a cell be cleared to "no blessing".

- [ ] **Step 4: Style**

Append to `assignments.css`:

```css
.blessing-grid { border-collapse: collapse; font-size: 0.85em; }
.blessing-grid th { padding: 4px 6px; text-align: left; font-weight: 600; }
.blessing-grid td { padding: 2px; }
.blessing-grid select { font-size: 0.9em; }
```

- [ ] **Step 5: Verify in the browser**

Run `npm start` and import:

```
RSS1;Retdin:PALADIN:0/0/61;Lightbringer:PALADIN:47/14/0;Bubbles:PALADIN:0/47/14;Thunderfist:WARRIOR:5/6/50;Stabby:ROGUE:15/41/5;Mage1:MAGE:0/48/13
```

Expected: a three-row grid, Retdin's row all Greater Kings, Lightbringer's row Might for Warrior/Rogue/Paladin and Wisdom for Mage. Change one cell to duplicate another paladin's blessing for the same class and confirm the duplicate warning appears. Reload the page and confirm the edit persisted. No console errors.

- [ ] **Step 6: Commit**

```bash
git add assignments.html assignments.js assignments.css
git commit -m "feat: editable greater blessings grid with gap and duplicate warnings"
```

---

### Task 4: Put blessings in the Discord output

**Files:**
- Modify: `assignments-engine.js` (`buildDiscord`)
- Modify: `assignments.js` (pass the grid into the sheet)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `proposeBlessings` output, attached to the sheet as `sheet.blessings`.

- [ ] **Step 1: Write the failing test**

```js
test('buildDiscord: renders the blessings grid when present', () => {
    const roster = palRoster();
    const sheet = E.autoAssign(roster, {});
    sheet.blessings = E.proposeBlessings(roster, {});
    const out = E.buildDiscord(roster, sheet, {});
    assert.ok(/Blessings/i.test(out));
    assert.ok(out.includes('Retdin'));
    assert.ok(out.includes('Greater Kings'));
});
test('buildDiscord: omits the blessings section when absent', () => {
    const roster = palRoster();
    const out = E.buildDiscord(roster, E.autoAssign(roster, {}), {});
    assert.ok(!/Blessings/i.test(out));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the first — nothing renders blessings yet.

- [ ] **Step 3: Implement**

In `buildDiscord`, before the uncovered warning line, add:

```js
        if (sheet.blessings && sheet.blessings.rows && sheet.blessings.rows.length) {
            lines.push('', '**Blessings**');
            sheet.blessings.rows.forEach(row => {
                // Collapse the row to "blessing → classes" so it reads as instructions rather
                // than a table Discord would mangle.
                const byBlessing = {};
                sheet.blessings.classes.forEach(cls => {
                    const b = row.cells[cls];
                    if (!b) return;
                    (byBlessing[b] = byBlessing[b] || []).push(cls.slice(0, 3));
                });
                const parts = Object.keys(byBlessing).map(b => b + ' → ' + byBlessing[b].join('/'));
                lines.push('• ' + nm(row.paladin) + ': ' + parts.join(', '));
            });
        }
```

In `assignments.js`, inside `recompute`, extend the sheet assembly:

```js
    sheet = Object.assign({}, result, {
        cc: state.cc || E.defaultCC(roster),
        blessings: E.proposeBlessings(roster, state.blessings),
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Verify in the browser**

Run `npm start`, import the Task-3 roster, open the Discord output tab, and confirm a **Blessings** section appears with one line per paladin, reading like `Retdin: Greater Kings → WAR/ROG/PAL/MAG`.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js
git commit -m "feat: include the blessings grid in the discord output"
```

---

## Open questions for the implementer

- **A split class still gets one blessing.** Greater Blessings are cast per class, so a raid with two enhancement and two restoration shamans genuinely cannot give both Might and Wisdom to shamans — the majority rule picks one and the raid lead overrides if they disagree. This is a limitation of the game, not of the tool, and the grid should not pretend otherwise.
- **Ties go to Might.** Two enhancement and two restoration shamans resolve to Might. That is an arbitrary call; if raids consistently prefer Wisdom on a tie, flip the comparison.
- **Sanctuary is not a Greater blessing in TBC** — it is single-target only, so a "Sanctuary" cell covering a whole class is a small lie. It is included because raids talk about it that way. If precision matters more than familiarity, rename the cell to "Sanctuary (per tank)" or drop it from the list.
- **The share-link view page does not show blessings.** `assignments-view.html` renders debuffs, cooldowns and CC from the shared sheet; the blessings the sheet now carries appear in the Discord output but not on the shared page. Deliberately out of scope here (opt-in surface), but flag it to the raid lead: a raider opening the share link sees no blessing grid. If that matters, rendering `sheet.blessings` on the view page is a small follow-up, not part of this plan.
