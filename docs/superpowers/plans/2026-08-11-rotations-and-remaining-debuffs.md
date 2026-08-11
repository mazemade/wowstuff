# Rotations + Remaining Debuffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add duties that need an *ordered list* of players rather than a single one — Fear Ward and Tranquilizing Shot — and finish the debuff catalog with the entries the TBC research turned up.

**Architecture:** A new `rotations` duty category whose duty objects carry `players: [name]` instead of `player: name`. It reuses the existing catalog, ranking and override machinery; only the record shape and the renderer are new. The remaining debuff entries are plain catalog additions requiring no new mechanism.

**Tech Stack:** Plain ES5-compatible JavaScript, no build step. Tests via `node assignments-engine.test.js`.

**Depends on:** `2026-08-11-catalog-rules-and-warning-split.md`. Task 3 additionally assumes `2026-08-11-providers-and-expose-armor.md` has landed (it references duty id `ap`).

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper.
- **Rotation duties are a distinct category.** `category: 'rotations'`, so existing code filtering on `'debuffs'` and `'cooldowns'` is untouched and cannot accidentally render a `players` array where it expects a `player` string.
- **Empty rotations do not render.** No priests means no Fear Ward row at all — not an empty row, and not an `uncovered.missing` entry, because a rotation is fight-specific rather than always-wanted.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Rotation duties in the engine

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: `ROTATIONS -> [{ id, name, class, preferSpecs, note }]`, and `autoAssign` appends duties shaped `{ id, name, category: 'rotations', players: [String] }`. Overrides use `overrides[id] = { players: [String] }`.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('autoAssign: fear ward rotation lists every priest, holy first', () => {
    const roster = [P('Shadowmel', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy'), P('Discy', 'PRIEST', 'Discipline')];
    const r = E.autoAssign(roster, {});
    const fw = duty(r, 'fearward');
    assert.strictEqual(fw.category, 'rotations');
    assert.deepStrictEqual(fw.players, ['Discy', 'Holymel', 'Shadowmel']);
});
test('autoAssign: tranq shot rotation lists hunters', () => {
    const r = E.autoAssign([P('Legolass', 'HUNTER', 'Marksmanship'), P('Beastly', 'HUNTER', 'Beast Mastery')], {});
    assert.deepStrictEqual(duty(r, 'tranq').players, ['Beastly', 'Legolass']);
});
test('autoAssign: a rotation with nobody eligible produces no row and no warning', () => {
    const r = E.autoAssign([P('Stabby', 'ROGUE', 'Combat')], {});
    assert.ok(!duty(r, 'fearward'));
    assert.ok(!r.uncovered.missing.some(u => u.id === 'fearward'));
    assert.ok(!r.uncovered.notApplicable.some(u => u.id === 'fearward'));
});
test('autoAssign: a rotation override replaces the order and drops absent names', () => {
    const roster = [P('Shadowmel', 'PRIEST', 'Shadow'), P('Holymel', 'PRIEST', 'Holy')];
    const r = E.autoAssign(roster, { fearward: { players: ['Shadowmel', 'Ghost', 'Holymel'] } });
    assert.deepStrictEqual(duty(r, 'fearward').players, ['Shadowmel', 'Holymel']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — no `fearward` or `tranq` duty exists.

- [ ] **Step 3: Implement**

Add to `assignments-engine.js`, after `DEBUFF_CATALOG`:

```js
    // Duties that need an ordered list rather than one player. Fear Ward is TBC-only and
    // mandatory on Magtheridon, Gurtogg Bloodboil and Azgalor; Tranq Shot on Gruul and Mag.
    const ROTATIONS = [
        { id: 'fearward', name: 'Fear Ward', class: 'PRIEST', preferSpecs: ['Discipline', 'Holy'],
          note: '30s cooldown, 3min duration — rotate so one is always banked.' },
        { id: 'tranq', name: 'Tranquilizing Shot', class: 'HUNTER', preferSpecs: ['Beast Mastery', 'Marksmanship'],
          note: '20s cooldown — call the order, do not let two fire at once.' },
    ];
```

In `autoAssign`, after the soulstone block and before the `passives` computation, add:

```js
        // A rotation is fight-specific: no eligible class means the row simply does not
        // apply, so it is neither rendered nor warned about.
        ROTATIONS.forEach(rot => {
            const o = overrides[rot.id] || {};
            let players;
            if (o.players) {
                players = o.players.filter(n => byName[n]);
            } else {
                players = rankPool(roster.filter(p => p.class === rot.class && !(p.flags || []).includes('spec-unknown')),
                                   rot, dutyCount).map(p => p.name);
            }
            if (!players.length) return;
            duties.push({ id: rot.id, name: rot.name, category: 'rotations', players, note: rot.note });
        });
```

Export `ROTATIONS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. Check the Fear Ward order in the output — `Discipline` then `Holy` then `Shadow` comes from `preferSpecs`, with `rankPool`'s name tiebreak behind it.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: fear ward and tranq shot rotations"
```

---

### Task 2: Render rotations

**Files:**
- Modify: `assignments.html:52-55` (assignments cards)
- Modify: `assignments.js` (`renderAssignments`, new `rotationRow`)
- Modify: `assignments.css`

**Interfaces:**
- Consumes: rotation duties from Task 1. Writes `state.overrides[id].players`.

- [ ] **Step 1: Add the card**

In `assignments.html`, inside the `<div class="cards">` block, add a fourth card after the Crowd Control one:

```html
                <div class="card"><h3>Rotations</h3><div id="rotationRows"></div></div>
```

- [ ] **Step 2: Render the ordered list**

Add to `assignments.js` above `renderAssignments`:

```js
function rotationRow(d) {
    const wrap = document.createElement('div');
    wrap.className = 'assign-row rotation';

    const label = document.createElement('span');
    label.className = 'duty-name';
    label.textContent = d.name;
    if (d.note) label.title = d.note;
    wrap.appendChild(label);

    const list = document.createElement('div');
    list.className = 'rotation-list';
    d.players.forEach((name, i) => {
        const chip = document.createElement('span');
        chip.className = 'rotation-chip';
        chip.textContent = (i + 1) + '. ' + name;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'chip-btn';
        up.textContent = '↑';
        up.disabled = i === 0;
        up.setAttribute('aria-label', 'Move ' + name + ' earlier');
        up.addEventListener('click', () => {
            const order = d.players.slice();
            order.splice(i - 1, 0, order.splice(i, 1)[0]);
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id], { players: order });
            renderAll();
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'chip-btn';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Remove ' + name + ' from ' + d.name);
        del.addEventListener('click', () => {
            state.overrides[d.id] = Object.assign({}, state.overrides[d.id],
                { players: d.players.filter(n => n !== name) });
            renderAll();
        });

        chip.appendChild(up);
        chip.appendChild(del);
        list.appendChild(chip);
    });
    wrap.appendChild(list);
    return wrap;
}
```

In `renderAssignments`, add after the crowd-control block:

```js
    const rotBox = document.getElementById('rotationRows');
    rotBox.innerHTML = '';
    sheet.duties.filter(d => d.category === 'rotations').forEach(d => rotBox.appendChild(rotationRow(d)));
```

- [ ] **Step 3: Style**

Append to `assignments.css`:

```css
.rotation { flex-wrap: wrap; }
.rotation-list { display: flex; flex-wrap: wrap; gap: 4px; }
.rotation-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 0.82em;
                 border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 1px 6px; }
.chip-btn { background: none; border: none; color: inherit; cursor: pointer; padding: 0 2px; opacity: 0.6; }
.chip-btn:hover:not(:disabled) { opacity: 1; }
.chip-btn:disabled { opacity: 0.2; cursor: default; }
```

- [ ] **Step 4: Verify in the browser**

Run `npm start` and import:

```
RSS1;Holymel:PRIEST:23/38/0;Shadowmel:PRIEST:0/0/41;Discy:PRIEST:38/23/0;Legolass:HUNTER:0/41/20;Beastly:HUNTER:41/20/0
```

Expected: a Rotations card with Fear Ward (three priests, Discy first) and Tranquilizing Shot (two hunters). Reorder with ↑, remove someone with ✕, reload, and confirm both survived. Hover the duty name to see the cooldown note. No console errors.

- [ ] **Step 5: Commit**

```bash
git add assignments.html assignments.js assignments.css
git commit -m "feat: render reorderable rotation lists"
```

---

### Task 3: The remaining debuff entries

**Files:**
- Modify: `assignments-engine.js` (`DEBUFF_CATALOG`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `caution` from the providers plan, `applicableWhen` from the catalog-rules plan.

- [ ] **Step 1: Write the failing tests**

```js
test('autoAssign: thunder clap, insect swarm, scorpid sting and hemorrhage are assigned', () => {
    const roster = [P('Smashy', 'WARRIOR', 'Arms'), P('Moonpie', 'DRUID', 'Balance'),
                    P('Legolass', 'HUNTER', 'Marksmanship'), P('Sneaky', 'ROGUE', 'Subtlety')];
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'tclap').player, 'Smashy');
    assert.strictEqual(duty(r, 'swarm').player, 'Moonpie');
    assert.strictEqual(duty(r, 'sting').player, 'Legolass');
    assert.strictEqual(duty(r, 'hemo').player, 'Sneaky');
});
test('autoAssign: insect swarm needs a balance druid, hemorrhage a sub rogue', () => {
    const r = E.autoAssign([P('Treebeard', 'DRUID', 'Restoration'), P('Stabby', 'ROGUE', 'Combat')], {});
    assert.ok(!duty(r, 'swarm'));
    assert.ok(!duty(r, 'hemo'));
    assert.ok(r.uncovered.missing.some(u => u.id === 'swarm'));
});
test('autoAssign: scorpid sting carries a stacking caution', () => {
    const r = E.autoAssign([P('Legolass', 'HUNTER', 'Marksmanship')], {});
    assert.ok(/Insect Swarm/.test(duty(r, 'sting').caution));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — none of these ids exist.

- [ ] **Step 3: Add the entries**

Append to `DEBUFF_CATALOG`, after the `ap` entry:

```js
        // Improved Thunder Clap is -20% attack speed at 3/3 (base 10% plus 10%). Its own
        // effect group with Chilled and Thunderfury — strongest applies, they do not stack.
        { id: 'tclap', name: 'Thunder Clap', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Protection', 'Arms'] },
        { id: 'swarm', name: 'Insect Swarm', category: 'debuffs', class: 'DRUID', requireSpec: 'Balance' },
        // Scorpid Sting (-5% hit) and Insect Swarm (-2%) stacked in 2.4.3; the exclusivity is
        // a 3.0.2 change. One report suggests TBC Classic may have shipped the later
        // behaviour, so this is worth an in-game check before trusting both at once.
        { id: 'sting', name: 'Scorpid Sting', category: 'debuffs', class: 'HUNTER', preferSpecs: ['Survival', 'Marksmanship'],
          caution: 'Stacked with Insect Swarm in 2.4.3, but TBC Classic 2.5.x may not — verify in-game.' },
        { id: 'hemo', name: 'Hemorrhage', category: 'debuffs', class: 'ROGUE', requireSpec: 'Subtlety' },
```

**Curse of Tongues is deliberately not added.** A catalog entry would consume a warlock's one curse slot ahead of Curse of Doom, which is worth more on anything living 60 seconds. Spare warlocks already get a personal-curse row that covers this.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. Then check the full-comp test still passes — four new rows now compete for warriors, druids, hunters and rogues, and `rankPool`'s duty-count balancing may have moved an existing assignment. If a pre-existing assertion broke, decide whether the new spread is *better* before changing the test to match.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: thunder clap, insect swarm, scorpid sting and hemorrhage"
```

---

### Task 4: Rotations in the Discord output

**Files:**
- Modify: `assignments-engine.js` (`buildDiscord`)
- Modify: `assignments-engine.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('buildDiscord: renders rotations as a numbered order', () => {
    const roster = [P('Holymel', 'PRIEST', 'Holy'), P('Discy', 'PRIEST', 'Discipline')];
    const out = E.buildDiscord(roster, E.autoAssign(roster, {}), {});
    assert.ok(/Fear Ward/.test(out));
    assert.ok(out.indexOf('Discy') < out.indexOf('Holymel'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node assignments-engine.test.js`

Expected: FAIL — rotations are not rendered.

- [ ] **Step 3: Implement**

In `buildDiscord`, alongside the existing category sections, add:

```js
        const rotations = sheet.duties.filter(d => d.category === 'rotations');
        if (rotations.length) {
            lines.push('', '**Rotations**');
            rotations.forEach(d => {
                lines.push('• **' + d.name + ':** ' + d.players.map((n, i) => (i + 1) + '. ' + nm(n)).join('  '));
                if (d.note) lines.push('  _' + d.note + '_');
            });
        }
```

Place it immediately after the block that renders the `cooldowns` category, so the ordering reads debuffs → cooldowns → rotations → CC.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Verify in the browser**

Run `npm start`, import the Task-2 roster, and confirm the Discord tab shows a Rotations section with the numbered order and the cooldown note. Toggle @mentions and confirm the names render both ways.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: include rotations in the discord output"
```

---

## Open questions for the implementer

- **Rotation order has no in-game enforcement.** The tool prints an order; whether the third priest actually waits is a raid-discipline problem. Do not build cooldown tracking here — that belongs in an addon, not this sheet.
- **Thunder Clap competes with Sunder and Demo Shout for the same warriors.** `rankPool` balances by duty count, so a single-warrior raid will pile three rows on them. That is honest — one warrior genuinely cannot do all three well — but a "this player has 4 duties" warning would make it visible. Not in scope here.
- **Scorpid Sting's caution is a real open question**, not a formality. If in-game testing shows it does not stack with Insect Swarm on 2.5.x, the two entries should become one row with two providers, using the mechanism from the providers plan.
- **The share-link view page does not show rotations.** `assignments-view.html` filters duties by the `debuffs` and `cooldowns` categories, so `rotations` duties are silently absent from shared sheets even though they appear in the Discord output. Deliberately out of scope here (opt-in surface), but flag it: a raider opening the share link will not see the Fear Ward order. If that matters, rendering the `rotations` category on the view page is a small follow-up, not part of this plan.
