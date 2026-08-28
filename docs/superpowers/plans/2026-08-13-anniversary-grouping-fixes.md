# Anniversary Grouping Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the group-layout proposer respect Raid-Helper tank signups (the "Tank" pseudo-class and Guardian druids) and stop stacking same-spec shamans in one party, with buff scopes verified against TBC *Anniversary* realms.

**Architecture:** Three surgical changes to existing functions in `assignments-engine.js` — `parseRaidHelper` learns Raid-Helper's "Tank" pseudo-class, `bucketOf`/`anchorScore`/`NOTE_RULES` learn Guardian, and the shaman seeding pass in `proposeGroups` seeds at most one shaman per group so duplicates fall through to the existing spread pass. No new modules, no signature changes.

**Tech Stack:** Plain ES5-compatible JavaScript inside the existing UMD wrapper, no build step. Tests via `node assignments-engine.test.js`.

**Spec:** This plan implements the findings of the 2026-08-13 analysis of raid event `1536119496337653871`: (1) both Tank signups were dropped by `parseRaidHelper` with `Unknown class "Tank"` errors, so the bear tank fell back to the addon's `Feral` and was grouped as melee DPS; (2) two Restoration shamans were both seeded into the healer group, wasting every totem the second one drops.

**Depends on:** `2026-08-12-guardian-druid-spec.md` **must be fully executed first**. This plan consumes `isFeralSpec` and `SELECTABLE_SPECS` from that plan's Task 1, and assumes `parseRaidHelper` canonicalizes specs against `SELECTABLE_SPECS[cls]` (so `Guardian` survives parsing) and that `RH_SPEC_ALIASES` no longer contains `Guardian: 'Feral'`.

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper in `assignments-engine.js`.
- **Advisory only.** `proposeGroups` stays pure — never writes to `state`, `roster`, or `sheet`.
- **Test command:** `node assignments-engine.test.js`. The suite currently passes 204/204 (after the Guardian plan it will be higher); it must end at zero failures after every task.
- **Buff scopes are TBC Anniversary, verified 2026-08-13:** Bloodlust/Heroism is **raid-wide** on Anniversary realms (with a 10-minute Sated-style debuff that resets on boss kills/wipes) and therefore must NEVER appear in the grouping model or group notes. Everything else the engine models is still **party-scoped** on Anniversary: all totems (Windfury, Strength of Earth, Grace of Air, Wrath of Air, Totem of Wrath, Mana Tide), paladin auras, Battle Shout, Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration, Vampiric Touch, and the draenei presences. Sources: wowclassicui.com and wowcarry.com Anniversary change lists; a Blizzard forum thread requesting more raid-wide buffs confirms none of the others were changed.
- **Raid-Helper "Tank" pseudo-class facts (from the live event JSON for `1536119496337653871`):** signups made via the Tank emote arrive as `className: "Tank"` with `specName` one of exactly `Protection` (warrior), `Protection1` (paladin), or `Guardian` (druid). The digit suffix is Raid-Helper's disambiguator for classes sharing a spec name (the same convention as `Restoration` = druid vs `Restoration1` = shaman, already covered by an existing test asserting `Protection1` → `Protection` for a Paladin). `cClass` is also `"Tank"`, so there is no other field carrying the real class.

---

### Task 1: Resolve Raid-Helper's "Tank" pseudo-class to the real class

Today both tank signups in a real event are dropped with `Unknown class "Tank" for <name>` errors, so their class/spec silently ride on addon-scan data alone — and a bear tank scans as `Feral`.

**Files:**
- Modify: `assignments-engine.js` (the `RH_SPEC_ALIASES` block near the top of the Raid-Helper section, and `parseRaidHelper` — currently around lines 172–226; find them by searching for `RH_SPEC_ALIASES` and `function parseRaidHelper`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `SELECTABLE_SPECS` canonicalization inside `parseRaidHelper` (from the Guardian plan, already landed).
- Produces: `parseRaidHelper` returns `{ class: 'WARRIOR', spec: 'Protection' }` / `{ class: 'PALADIN', spec: 'Protection' }` / `{ class: 'DRUID', spec: 'Guardian' }` players for Tank signups. Task 2's grouping relies on the `DRUID`/`Guardian` output.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log` in `assignments-engine.test.js`:

```js
test('parseRaidHelper: Tank pseudo-class resolves to the real class via its spec', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Warbear', className: 'Tank', specName: 'Guardian', userId: 1, status: 'primary' },
        { name: 'Bubbles', className: 'Tank', specName: 'Protection1', userId: 2, status: 'primary' },
        { name: 'Shieldy', className: 'Tank', specName: 'Protection', userId: 3, status: 'primary' },
    ] });
    assert.strictEqual(r.errors.length, 0);
    const by = n => r.players.find(p => p.name === n);
    assert.deepStrictEqual([by('Warbear').class, by('Warbear').spec], ['DRUID', 'Guardian']);
    assert.deepStrictEqual([by('Bubbles').class, by('Bubbles').spec], ['PALADIN', 'Protection']);
    assert.deepStrictEqual([by('Shieldy').class, by('Shieldy').spec], ['WARRIOR', 'Protection']);
});
test('parseRaidHelper: a Tank signup with an unrecognized spec is an error, not a crash', () => {
    const r = E.parseRaidHelper({ signUps: [
        { name: 'Confused', className: 'Tank', specName: 'Holy', userId: 4, status: 'primary' },
    ] });
    assert.strictEqual(r.players.length, 0);
    assert.strictEqual(r.errors.length, 1);
    assert.ok(r.errors[0].includes('tank spec') && r.errors[0].includes('Confused'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: BOTH new tests FAIL — the first gets three `Unknown class "Tank"` errors and zero players; the second currently errors with `Unknown class "Tank"`, not the new `Unknown tank spec` message the assertion demands.

- [ ] **Step 3: Implement**

In `assignments-engine.js`, immediately below the `RH_SPEC_ALIASES` line, add:

```js
    // The Tank sign-up emote reports class "Tank", not the real class. Raid-Helper's spec
    // names disambiguate: a digit suffix separates classes sharing a spec name (Protection =
    // warrior, Protection1 = paladin — same convention as Restoration/Restoration1 for
    // druid/shaman), and Guardian is the druid tank. TBC has exactly these three tank
    // classes, so this map is total. Keys are lowercased raw specs BEFORE digit stripping.
    const RH_TANK_SPECS = {
        protection: { class: 'WARRIOR', spec: 'Protection' },
        protection1: { class: 'PALADIN', spec: 'Protection' },
        guardian: { class: 'DRUID', spec: 'Guardian' },
    };
```

In `parseRaidHelper`, the current body of the per-signup callback resolves `cls` from `RH_CLASS_NAMES_LC` and then derives `spec` by stripping trailing digits and applying aliases. Replace that class/spec resolution — the lines from `const cls = RH_CLASS_NAMES_LC[...]` through the `spec = RH_SPEC_ALIASES_LC[...] || spec;` line — with:

```js
            const rawSpec = String(rhPick(su, ['specName', 'spec']) || '');
            let cls, spec;
            if (rawClass.toLowerCase() === 'tank') {
                const t = RH_TANK_SPECS[rawSpec.toLowerCase()];
                if (!t) { errors.push('Unknown tank spec "' + rawSpec + '" for ' + su.name); return; }
                cls = t.class;
                spec = t.spec;
            } else {
                cls = RH_CLASS_NAMES_LC[rawClass.toLowerCase()];
                if (!cls) { errors.push('Unknown class "' + rawClass + '" for ' + su.name); return; }
                spec = rawSpec.replace(/\d+$/, '');
                spec = RH_SPEC_ALIASES_LC[spec.toLowerCase()] || spec;
            }
```

Leave the canonicalization line that follows (`const canonical = SELECTABLE_SPECS[cls].find(...)`) untouched — `Guardian` is in `SELECTABLE_SPECS.DRUID` after the Guardian plan, so it canonicalizes cleanly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. The pre-existing `rhFixture` tests must still pass — that fixture contains no Tank entries, so its error-count assertion (`r.errors.length === 1` for Boomkin) is unaffected.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: resolve Raid-Helper Tank signups to their real class and spec"
```

---

### Task 2: Guardian buckets as a tank and still anchors Leader of the Pack

The group-layout plan was implemented before the Guardian plan existed, so `bucketOf` has no Guardian case (a bear buckets as melee) and `anchorScore`/`NOTE_RULES` match `spec === 'Feral'` literally.

**Files:**
- Modify: `assignments-engine.js` (`bucketOf`, `anchorScore`, and the `Leader of the Pack` entry in `NOTE_RULES` — find them by searching for `function bucketOf`, `function anchorScore`, and `Leader of the Pack`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `isFeralSpec(spec)` from the Guardian plan; `parseRaidHelper` Guardian output from Task 1; the existing `raid25()`, `groupOf(res, name)`, and `P(name, cls, spec, extra)` test helpers already defined in `assignments-engine.test.js`.
- Produces: `bucketOf({class:'DRUID', spec:'Guardian'}) === 'tanks'`. Task 4's regression test relies on it.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('bucketOf: Guardian is a tank, not melee', () => {
    assert.strictEqual(E.bucketOf(P('bear', 'DRUID', 'Guardian')), 'tanks');
});
test('proposeGroups: a Guardian lands with the tanks and still notes Leader of the Pack', () => {
    const roster = raid25().map(p => p.name === 'Feral' ? P('Feral', 'DRUID', 'Guardian') : p);
    const res = E.proposeGroups(roster);
    assert.strictEqual(groupOf(res, 'Feral'), 'tanks');
    const tanks = res.groups.find(g => g.players.some(p => p.name === 'Feral'));
    assert.ok(tanks.notes.some(t => /Leader of the Pack/.test(t)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `bucketOf` returns `melee` for Guardian.

- [ ] **Step 3: Implement**

In `bucketOf`, replace the `DRUID` case:

```js
            case 'DRUID':   return s === 'Restoration' ? 'healers'
                                 : (s === 'Balance' ? 'casters'
                                 : (s === 'Guardian' ? 'tanks' : 'melee'));
```

In `anchorScore`, replace the Feral line with the ability-level check (a bear carries Leader of the Pack exactly like a cat):

```js
        if (p.class === 'DRUID' && isFeralSpec(p.spec)) return 0;       // Leader of the Pack (bear or cat)
```

In `NOTE_RULES`, replace the Leader of the Pack entry's `has`:

```js
            { text: 'Leader of the Pack (+5% melee/ranged crit)', has: g => g.players.some(p => p.class === 'DRUID' && isFeralSpec(p.spec)) },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: Guardian druids group with the tanks and keep the LotP note"
```

---

### Task 3: Seed at most one shaman per group

Today `proposeGroups` seeds *every* shaman into its spec-matched group as long as there is room, so two Restoration shamans both land with the healers. The second one duplicates every totem the first drops — near-zero marginal value — while another group goes without any totems. The existing "spare shamans spread out" pass already does the right thing; it just never receives the duplicates because seeding grabs them first.

**Files:**
- Modify: `assignments-engine.js` (step 1 of `proposeGroups` — find the comment `// 1. Shamans seed first`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: the existing `raid25()`, `groupOf()`, `P()` test helpers.
- Produces: no signature change; two same-spec shamans never share a group when a shaman-less group with room exists.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('proposeGroups: two resto shamans never share a group', () => {
    const roster = raid25().filter(p => p.name !== 'Ret2').concat([P('Resto2', 'SHAMAN', 'Restoration')]);
    const res = E.proposeGroups(roster);
    assert.notStrictEqual(groupOf(res, 'Resto'), groupOf(res, 'Resto2'));
});
test('proposeGroups: the spare resto shaman lands in a group that had no shaman', () => {
    const roster = raid25().filter(p => p.name !== 'Ret2').concat([P('Resto2', 'SHAMAN', 'Restoration')]);
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto2'));
    assert.strictEqual(g.players.filter(p => p.class === 'SHAMAN').length, 1);
});
```

(The fixture swap keeps the roster at exactly 25 so the existing "places 25" assertions stay valid.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — both resto shamans sit in the healers group.

- [ ] **Step 3: Implement**

Replace the seeding line (`shamans.forEach(sh => place(sh, byRole[SHAMAN_ROLE[sh.spec]]));`) and its comment with:

```js
        // 1. Shamans seed first — one per group, spec-matched. A second shaman of the same
        //    spec duplicates every totem the first one drops (totems are party-scoped and do
        //    not stack), so it is a spare, not a seed: the spread pass below sends it to a
        //    group that has no shaman at all.
        const shamans = roster.filter(p => p.class === 'SHAMAN');
        shamans.forEach(sh => {
            const g = byRole[SHAMAN_ROLE[sh.spec]];
            if (g && !g.players.some(x => x.class === 'SHAMAN')) place(sh, g);
        });
```

Leave the spread pass that follows (`shamans.filter(p => !placed.has(p)).forEach(...)`) exactly as it is — it already places leftovers into the first shaman-less group with room, in scarcity order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures, including the pre-existing `shamans seed their matching group, one each` test (one shaman of each spec still seeds spec-matched).

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: spare same-spec shamans spread to totem-less groups instead of stacking"
```

---

### Task 4: Anniversary scope notes, air-totem group notes, and the real-roster regression test

Two honesty gaps in the panel: a non-enhancement shaman placed with hunters says nothing about *why* it is there (Grace of Air), and nothing records that Bloodlust is deliberately absent from the model — the next person to touch this file will "helpfully" add it back as a party buff.

**Files:**
- Modify: `assignments-engine.js` (`NOTE_RULES` and the comment block above `GROUP_ROLES`)
- Modify: `assignments.html:60` (the Group layout panel hint)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 landed; `isFeralSpec`; existing `groupOf()`/`P()` helpers.
- Produces: nothing new for later tasks — this is the closing task.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`. The second test is the regression test for the raid that motivated this plan (event `1536119496337653871`, 2026-08-13, the 21 primary signups as the merged roster resolves them after Tasks 1–2):

```js
test('proposeGroups: a lone shaman among hunters notes Grace of Air, not Windfury', () => {
    const roster = [
        P('Resto', 'SHAMAN', 'Restoration'),
        P('Hunt1', 'HUNTER', 'Beast Mastery'), P('Hunt2', 'HUNTER', 'Beast Mastery'),
    ];
    const res = E.proposeGroups(roster);
    const g = res.groups.find(g => g.players.some(p => p.name === 'Resto'));
    assert.ok(g.notes.some(t => /Grace of Air/.test(t)), 'missing GoA note: ' + g.notes.join(' | '));
    assert.ok(!g.notes.some(t => /Windfury/.test(t)));
});
test('proposeGroups: regression — the 2026-08-13 SSC roster', () => {
    const R = [
        P('Sylvanor', 'PALADIN', 'Protection'), P('Smellmystaff', 'DRUID', 'Guardian'),
        P('Haku', 'SHAMAN', 'Enhancement'), P('Culuneta', 'WARRIOR', 'Fury'),
        P('Davina', 'WARRIOR', 'Arms'), P('RedNeko', 'WARRIOR', 'Fury'),
        P('utopik', 'ROGUE', 'Combat'), P('xavamros', 'ROGUE', 'Combat'),
        P('Warzilla', 'DRUID', 'Feral'),
        P('Connylloyd', 'HUNTER', 'Beast Mastery'), P('Funkell', 'HUNTER', 'Beast Mastery'),
        P('produdu', 'HUNTER', 'Survival'),
        P('Slyvester', 'SHAMAN', 'Elemental'), P('Craqu', 'MAGE', 'Arcane'),
        P('JohnNoozeMusume', 'MAGE', 'Arcane'), P('Cartis', 'WARLOCK', 'Destruction'),
        P('Lovestoned', 'WARLOCK', 'Destruction'),
        P('Gouken', 'SHAMAN', 'Restoration'), P('woptenwodei', 'SHAMAN', 'Restoration'),
        P('Frawa', 'DRUID', 'Restoration'), P('sspope', 'PRIEST', 'Holy'),
    ];
    const res = E.proposeGroups(R);
    assert.strictEqual(groupOf(res, 'Smellmystaff'), 'tanks');   // the bug that started all this
    assert.strictEqual(groupOf(res, 'Sylvanor'), 'tanks');
    assert.notStrictEqual(groupOf(res, 'Gouken'), groupOf(res, 'woptenwodei'));
    assert.strictEqual(res.groups.filter(g => g.players.some(p => p.class === 'SHAMAN')).length, 4);
    const spare = res.groups.find(g => g.players.some(p => p.name === 'woptenwodei'));
    assert.ok(spare.notes.some(t => /Grace of Air/.test(t)));    // she's with the hunters for GoA
    assert.strictEqual(res.unplaced.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the Grace of Air assertions only — the placement assertions already pass after Tasks 1–3. If a *placement* assertion fails, stop and re-check Tasks 2–3 rather than adjusting the test.

- [ ] **Step 3: Implement the notes and the scope comment**

In `NOTE_RULES`, add after the `Wrath of Air` entry (a shaman can run only one air totem at a time, so these three rules must stay mutually consistent: the enhancement-with-melee case claims Windfury, everything else with hunters claims Grace of Air):

```js
            { text: 'Grace of Air (+77 agility)',
              has: g => g.players.some(p => p.class === 'SHAMAN')
                     && g.players.some(p => p.class === 'HUNTER')
                     && !(g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement')
                          && g.players.some(p => p.class !== 'SHAMAN' && (bucketOf(p) === 'melee' || bucketOf(p) === 'tanks'))) },
            { text: 'Windfury Totem (baseline)',
              has: g => g.players.some(p => p.class === 'SHAMAN')
                     && !g.players.some(p => p.class === 'SHAMAN' && p.spec === 'Enhancement')
                     && !g.players.some(p => p.class === 'HUNTER')
                     && g.players.some(p => p.class !== 'SHAMAN' && (bucketOf(p) === 'melee' || bucketOf(p) === 'tanks')) },
```

Above the `GROUP_ROLES` constant, extend the scarcity-order comment with the Anniversary scope note:

```js
    // Anniversary-realm scope, verified 2026-08-13: Bloodlust/Heroism is RAID-wide there
    // (10-minute Sated-style debuff, resets on boss kills/wipes), so it is deliberately
    // absent from this model — do not add it as a grouping reason. Everything modeled below
    // is still party-scoped on Anniversary: all totems, paladin auras, Battle Shout, Leader
    // of the Pack, Moonkin Aura, Trueshot, Ferocious Inspiration, Vampiric Touch, Mana Tide
    // and the draenei presences.
```

In `assignments.html` line 60, extend the panel hint:

```html
            <h2>4 · Group layout <span class="hint">(advisory — move people in-game yourself; Bloodlust is raid-wide on Anniversary and ignored here)</span></h2>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: zero failures. Also confirm no pre-existing note test broke — the enhancement-shaman-with-melee fixture must still say `Windfury Totem + Strength of Earth` and must NOT gain a Grace of Air note.

- [ ] **Step 5: Verify in the browser against the real event**

Run `npm start`, open `http://localhost:3000`, and import Raid-Helper event `1536119496337653871` via the Raid-Helper box (no addon paste). Confirm:

- No `Unknown class "Tank"` import errors; Sylvanor arrives as Paladin/Protection and Mr.SmellmyWand as Druid/Guardian.
- The Group layout panel puts both in the tank group, and Gouken and woptenwodei are in different groups, with the spare resto shaman among the hunters carrying a `Grace of Air` note.
- No group note mentions Bloodlust anywhere.
- The assignments panel and Discord output are unchanged apart from the corrected specs.

If the roster is instead built by pasting an addon scan and then importing Raid-Helper, the bear only becomes Guardian if the signup name matches or is linked to the addon character (the identity-linking UI); with mismatched names like `Mr.SmellmyWand` vs `Smellmystaff`, link them there and confirm Guardian survives the merge — that path is the Guardian plan's Task 2 and should already work.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments.html assignments-engine.test.js
git commit -m "feat: air-totem group notes and Anniversary Bloodlust scope documentation"
```

---

## Open questions for the implementer

- **Redundant Battle Shout warriors can still crowd the Windfury group.** With three non-prot warriors, all three sort as anchors and can fill melee slots ahead of rogues. All of them are Windfury beneficiaries too, so the value lost is small (one group's worth of a duplicated shout), and fixing it needs a placement-aware fill pass. Deliberately out of scope — same YAGNI call as the group-layout plan's deferred hill-climb. Revisit only if real rosters show it mattering.
- **The overflow pass can still drop a melee DPS into the healer group** (fullest-first placement, no buff awareness). Same deferral, same reason.
- **`RH_TANK_SPECS` is TBC-specific.** If the tool ever targets another expansion's Raid-Helper templates (e.g. a Healer pseudo-class, or death knights), the map needs revisiting; the unknown-tank-spec error path is the safety net.
