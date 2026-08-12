# Talent-Aware Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read individual talent ranks from the game instead of guessing them from talent-tree totals, so the four rows where spec-guessing is measurably wrong pick the right player.

**Architecture:** `RaidSpecScan` walks `GetTalentInfo`, matches the handful of talents the catalog cares about **by name**, and exports them as `key=rank` pairs in a new `RSS3` line format with fixed, independently-optional fields. The engine holds the same keys with their max rank and display name — no coordinates anywhere. `rankPool` gains a leading tier — talented → unknown → known-untalented — ahead of the existing spec preference.

**Tech Stack:** Plain ES5-compatible JavaScript in a UMD wrapper, no build step. Lua 5.1 for the addon. Tests via `node assignments-engine.test.js`.

**Spec:** `docs/superpowers/specs/2026-08-12-talent-aware-assignments-design.md`

**Depends on:** the `debuff-coverage` branch (all six prior plans). Baseline at plan start: **148 passed, 0 failed**.

## Global Constraints

- **No build step.** ES5-compatible JS only, inside the existing UMD wrapper. No dependencies.
- **RSS1 and RSS2 must keep parsing unchanged.** The pinned `RSS1 regression: a full raid export parses to exactly this roster` fixture at `assignments-engine.test.js:546` is the branch's parse guard — **add** RSS3 fixtures beside it, never migrate it.
- **The addon matches talents by name.** It holds the tracked-talent list; the engine holds only the
  same keys with their max rank and display name. The keys are the one coupling across the wire.
- **`null` means unknown, and unknown is not the same as untalented.** A Raid-Helper signup or a manually added player has no talent data; they must never be ranked as though they lack the talent.
- **Talent names are localized**, and the addon matches on the English name. This is safe *only* because `/specscan` inspects the whole raid from one client, so only the scanner's locale is ever involved. Do not move name matching anywhere else.
- **All emitted text stays ASCII.** `record()` output feeds `buildAddonWhispers`, whose 255-character budget is counted in UTF-16 units against WoW's UTF-8 limit; they agree only for ASCII.
- **Every new test must be proven falsifiable by mutation** — delete the rule, run the suite, paste the failure, restore. This branch's dominant defect across six plans is tests that pass whether or not the behaviour exists.
- **Test command:** `node assignments-engine.test.js`
- **Lua syntax check:** `luajit -b <file> /dev/null` (available at `/opt/homebrew/bin/luajit`).

---

## Prerequisite

- [ ] **P1: Install `RaidSpecScan` 3.0 before any in-game verification.**

The copy in `/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/` is **v1.0
and still exports `RSS1`** — it predates subgroups and races entirely. Task 2 raises the worktree
copy to 3.0; copy it over the installed one when Task 2 is ready to verify. Nothing in Tasks 1–6 is
blocked by this, only the in-game checks at the end.

There is **no coordinate capture step** — the addon resolves talents by name at scan time, so no
`(tab, index)` values are hardcoded anywhere.

---

### Task 1: Remove Scorpid Sting

The owner ruled Scorpid Sting useless. Removing it first keeps it out of the duty-count arithmetic that later tasks reason about.

**Files:**
- Modify: `assignments-engine.js` (`DEBUFF_CATALOG`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: the `sting` duty id no longer exists. Nothing else consumes it.

- [ ] **Step 1: Delete the catalog entry**

In `assignments-engine.js`, delete this entry and the three comment lines above it that explain the stacking question:

```js
        // Scorpid Sting (-5% hit) and Insect Swarm (-2%) stacked in 2.4.3; the exclusivity is
        // a 3.0.2 change. One report suggests TBC Classic may have shipped the later
        // behaviour, so this is worth an in-game check before trusting both at once.
        { id: 'sting', name: 'Scorpid Sting', category: 'debuffs', class: 'HUNTER', preferSpecs: ['Survival', 'Marksmanship'],
          caution: 'Stacked with Insect Swarm in 2.4.3, but TBC Classic 2.5.x may not — verify in-game.' },
```

- [ ] **Step 2: Delete the two tests that only cover `sting`**

Delete `autoAssign: scorpid sting carries a stacking caution` (around `assignments-engine.test.js:1167`) and `autoAssign: scorpid sting prefers a survival hunter` (around `:1190`) in full.

- [ ] **Step 3: Narrow the shared test**

`autoAssign: thunder clap, insect swarm, scorpid sting and hemorrhage are assigned` (around `:1152`) asserts four rows including `sting`. Delete only the `sting` assertion and rename the test so it does not claim coverage it no longer has:

```js
test('autoAssign: thunder clap, insect swarm and hemorrhage are assigned', () => {
    const roster = [P('Smashy', 'WARRIOR', 'Arms'), P('Moonpie', 'DRUID', 'Balance'),
                    P('Legolass', 'HUNTER', 'Marksmanship'), P('Sneaky', 'ROGUE', 'Subtlety')];
    const r = E.autoAssign(roster, {});
    assert.strictEqual(duty(r, 'tclap').player, 'Smashy');
    assert.strictEqual(duty(r, 'swarm').player, 'Moonpie');
    assert.strictEqual(duty(r, 'hemo').player, 'Sneaky');
});
```

- [ ] **Step 4: Run the suite**

Run: `node assignments-engine.test.js`

Expected: **145 passed, 0 failed** (148 baseline − 3 deleted). If any *other* test fails, STOP and report — removing a catalog entry changes duty counts, and a failure elsewhere means a test was depending on `sting` without saying so.

- [ ] **Step 5: Re-prove the Tranq Shot fixture still has teeth**

Removing `sting` takes a duty away from hunters, and duty count is the tiebreak that silently neutralised this exact test once already on this branch. Do not assume it survived.

Copy `assignments-engine.js` and `assignments-engine.test.js` to a scratch directory, delete `preferSpecs: ['Beast Mastery', 'Marksmanship'],` from the `tranq` entry in the copy, and run the suite there.

Expected: **at least one failure**, naming `autoAssign: tranq shot rotation lists hunters`. If it still passes, the fixture is toothless again — STOP and report with the output rather than proceeding.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: drop scorpid sting, it is not worth a hunter's sting slot"
```

---

### Task 2: Addon resolves talents by name and exports RSS3

**Files:**
- Modify: `RaidSpecScan/RaidSpecScan.lua`
- Modify: `RaidSpecScan/RaidSpecScan.toc`

**Interfaces:**
- Produces: export lines shaped `Name:CLASS:points:subgroup:race:talents`, header `RSS3;`. `talents` is a comma-separated list of `key=rank` pairs for the tracked talents of that player's class, or empty. Every field after `points` may be empty. Task 3 parses exactly this.

- [ ] **Step 1: Add the tracked-talent table and the resolver**

Add below `TalentString`:

```lua
-- The talents the web tool reasons about, under a stable key it also knows. Matching on the
-- English name is safe here because /specscan inspects the whole raid from ONE client — the
-- scanner's — so only that client's locale is ever involved.
local TRACKED_TALENTS = {
    ROGUE   = { impExposeArmor  = "Improved Expose Armor" },
    WARRIOR = { impThunderClap  = "Improved Thunder Clap",
                impDemoShout    = "Improved Demoralizing Shout" },
    PALADIN = { impSealCrusader = "Improved Seal of the Crusader" },
}

-- Emits "key=rank" for every tracked talent of this class, INCLUDING rank 0. An untaken talent
-- must read as "=0" rather than being left out, or the web tool cannot tell "they did not take
-- it" from "we have no data at all". A name we cannot find is omitted instead, which reads as
-- unknown — the honest answer if a talent is ever renamed out from under us.
local function TalentPairs(classToken, isInspect)
    local wanted = TRACKED_TALENTS[classToken]
    if not wanted then return "" end
    local found = {}
    local tabs = (GetNumTalentTabs and GetNumTalentTabs()) or 3
    for tab = 1, tabs do
        local count = (GetNumTalents and GetNumTalents(tab)) or 0
        for i = 1, count do
            local name, _, _, _, rank = GetTalentInfo(tab, i, isInspect)
            if name then
                for key, wantedName in pairs(wanted) do
                    if name == wantedName then found[key] = tonumber(rank) or 0 end
                end
            end
        end
    end
    local out = {}
    for key in pairs(wanted) do
        -- `~= nil` on purpose: rank 0 is a real answer, and 0 is truthy in Lua but this reads
        -- wrong to anyone arriving from JS.
        if found[key] ~= nil then out[#out + 1] = key .. "=" .. found[key] end
    end
    table.sort(out) -- stable order, so two exports diff cleanly
    return table.concat(out, ",")
end
```

- [ ] **Step 2: Rewrite `AddResult` to emit fixed positions**

`AddResult` already resolves the class token, so it computes the talent field itself; it only needs
to be told whether this unit is being inspected. Replace the whole existing `AddResult` with:

```lua
-- RSS3 is positional with fixed slots: name:CLASS:points:subgroup:race:talents. Every field
-- after points may be empty and is independent of the others. RSS2 nested race inside the
-- subgroup check, so one missing subgroup silently took the race with it.
local function AddResult(unit, points, isInspect)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if not (name and classToken) then return end
    local subgroup = SubgroupOf(unit, name)
    -- Second return is the locale-independent token ("Draenei"); the first is localized and
    -- would break the web tool on a non-English client.
    local _, raceToken = UnitRace(unit)
    -- A player we could not scan has no talent data either; "?" points and an empty talent
    -- field must travel together.
    local talents = (points ~= "?") and TalentPairs(classToken, isInspect) or ""
    local line = name .. ":" .. classToken .. ":" .. points
        .. ":" .. (subgroup and tostring(subgroup) or "")
        .. ":" .. (raceToken or "")
        .. ":" .. talents
    table.insert(results, line)
end
```

- [ ] **Step 3: Thread `isInspect` through the four call sites**

`FinishUnit` gains the same argument:

```lua
local function FinishUnit(points, isInspect)
    AddResult(current, points, isInspect)
    ClearInspectPlayer()
    current = nil
    elapsed = 0
end
```

Update the four callers:

| where | was | becomes |
|---|---|---|
| inspect success, in the `OnEvent` handler | `FinishUnit(TalentString(true))` | `FinishUnit(TalentString(true), true)` |
| inspect timeout, in `OnUpdate` | `FinishUnit("?")` | `FinishUnit("?", true)` |
| own talents, in `NextUnit` | `AddResult(current, TalentString(false))` | `AddResult(current, TalentString(false), false)` |
| cannot inspect, in `NextUnit` | `AddResult(current, "?")` | `AddResult(current, "?", false)` |

- [ ] **Step 4: Bump the header and version**

In `ShowExport`, change `"RSS2;"` to `"RSS3;"`. In `RaidSpecScan.toc`, change `## Version: 2.0` to `## Version: 3.0`.

- [ ] **Step 5: Syntax-check**

Run: `luajit -b RaidSpecScan/RaidSpecScan.lua /dev/null`

Expected: no output, exit 0. This catches syntax only — it does not resolve WoW globals or prove behaviour.

- [ ] **Step 6: Commit**

```bash
git add RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc
git commit -m "feat: resolve tracked talents by name and export them as RSS3"
```

---

### Task 3: Parse RSS3

**Files:**
- Modify: `assignments-engine.js` (`parseAddonExport`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: Task 2's line format.
- Produces: `player.talents` — `{ key: Number }` or `null` when absent. Tasks 4 and 5 read it.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log`:

```js
test('parseAddonExport: RSS3 carries tracked talent ranks', () => {
    const r = E.parseAddonExport('RSS3;Smashy:WARRIOR:33/28/0:4:Orc:impThunderClap=3,impDemoShout=0').players;
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].group, 4);
    assert.strictEqual(r[0].race, 'Orc');
    assert.deepStrictEqual(r[0].talents, { impThunderClap: 3, impDemoShout: 0 });
});
test('parseAddonExport: rank 0 is data, not absence', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:1:Human:impExposeArmor=0').players;
    assert.strictEqual(r[0].talents.impExposeArmor, 0);
});
test('parseAddonExport: an empty field does not take the later ones with it', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5::Human:impExposeArmor=2').players;
    assert.strictEqual(r[0].group, null);
    assert.strictEqual(r[0].race, 'Human');            // RSS2 dropped this
    assert.strictEqual(r[0].talents.impExposeArmor, 2);
    const r2 = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4::impExposeArmor=2').players;
    assert.strictEqual(r2[0].group, 4);
    assert.strictEqual(r2[0].race, null);
    assert.strictEqual(r2[0].talents.impExposeArmor, 2);
});
test('parseAddonExport: no talent field means unknown, not empty', () => {
    const r = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human:').players;
    assert.strictEqual(r[0].talents, null);
    const r2 = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human').players;
    assert.strictEqual(r2[0].talents, null);
});
test('parseAddonExport: RSS2 and RSS1 lines still parse, with no talent data', () => {
    const two = E.parseAddonExport('RSS2;Stabby:ROGUE:15/41/5:4:Human').players;
    assert.strictEqual(two[0].group, 4);
    assert.strictEqual(two[0].race, 'Human');
    assert.strictEqual(two[0].talents, null);
    const one = E.parseAddonExport('RSS1;Stabby:ROGUE:15/41/5').players;
    assert.strictEqual(one[0].group, null);
    assert.strictEqual(one[0].race, null);
    assert.strictEqual(one[0].talents, null);
});
test('parseAddonExport: a malformed talent field rejects the line', () => {
    const res = E.parseAddonExport('RSS3;Stabby:ROGUE:15/41/5:4:Human:impExposeArmor');
    assert.strictEqual(res.players.length, 0);
    assert.ok(res.errors.some(e => /Stabby/.test(e)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — the current regex rejects a six-field line outright, so the RSS3 tests report `Unrecognized line`. The RSS1/RSS2 test should already pass except for its `talents` assertions.

- [ ] **Step 3: Replace the regex parse with a positional split**

In `parseAddonExport`, replace the `const m = tok.match(...)` block and everything through `push` with:

```js
            // RSS1, RSS2 and RSS3 all parse positionally:
            //   name:CLASS:points[:subgroup[:race[:talents]]]
            // Every field after points may be empty and is independent, so a missing subgroup
            // no longer takes the race and talents with it the way RSS2's nesting did. Names
            // cannot contain ':' in WoW, and no other field uses it, so the split is
            // unambiguous.
            const f = tok.split(':');
            if (f.length < 3 || f.length > 6) { errors.push('Unrecognized line: ' + tok); return; }
            const name = f[0];
            const cls = (f[1] || '').toUpperCase();
            const points = f[2];
            const rawGroup = f[3] === undefined ? '' : f[3];
            const rawRace = f[4] === undefined ? '' : f[4];
            const rawTalents = f[5] === undefined ? '' : f[5];

            if (!name) { errors.push('Unrecognized line: ' + tok); return; }
            if (!/^[A-Za-z]+$/.test(f[1] || '')) { errors.push('Unrecognized line: ' + tok); return; }
            if (!SPEC_TREES[cls]) { errors.push('Unknown class in: ' + tok); return; }
            if (!/^(\d+\/\d+\/\d+|\?)$/.test(points)) { errors.push('Unrecognized line: ' + tok); return; }
            if (seen.has(name)) { errors.push('Duplicate name: ' + name); return; }

            let group = null;
            if (rawGroup !== '') {
                if (!/^\d+$/.test(rawGroup)) { errors.push('Unrecognized line: ' + tok); return; }
                group = Number(rawGroup);
                if (group < 1 || group > 8) { errors.push('Subgroup out of range in: ' + tok); return; }
            }
            if (rawRace !== '' && !/^[A-Za-z]+$/.test(rawRace)) { errors.push('Unrecognized line: ' + tok); return; }
            const race = rawRace === '' ? null : rawRace;

            // null means the scan told us nothing. An explicit "key=0" means the scan told us
            // they have not taken it — a different, useful fact.
            let talents = null;
            if (rawTalents !== '') {
                if (!/^\w+=\d+(,\w+=\d+)*$/.test(rawTalents)) { errors.push('Unrecognized line: ' + tok); return; }
                talents = {};
                rawTalents.split(',').forEach(pair => {
                    const kv = pair.split('=');
                    talents[kv[0]] = Number(kv[1]);
                });
            }

            const flags = [];
            let spec = null;
            if (points === '?') {
                flags.push('spec-unknown');
            } else {
                const r = inferSpec(cls, points.split('/').map(Number));
                spec = r.spec;
                if (!spec) flags.push('spec-unknown');
                else if (r.ambiguous) flags.push('spec-ambiguous');
            }
            seen.add(name);
            players.push({ name, class: cls, spec, flags, source: 'addon', group, race, talents });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: **151 passed, 0 failed** (145 + 6 new). The pinned RSS1 regression fixture at `:546` must still pass untouched — if it does not, the positional parser has changed RSS1 behaviour and that is a defect, not a fixture to update.

- [ ] **Step 5: Prove the tests can fail**

Two mutations, each applied to a scratch copy, run, then discarded:

1. Treat an empty talent field as an empty object: change `if (rawTalents !== '')` to `if (true)`. Expected: `no talent field means unknown, not empty` fails.
2. Restore RSS2's nesting: change `const rawRace = f[4] === undefined ? '' : f[4];` to `const rawRace = rawGroup === '' ? '' : (f[4] === undefined ? '' : f[4]);`. Expected: `an empty field does not take the later ones with it` fails.

Paste both failures.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: parse RSS3 talent pairs with independent positional fields"
```

---

### Task 4: The talent table and lookup

**Files:**
- Modify: `assignments-engine.js`
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `player.talents` from Task 3.
- Produces: `TALENTS`, `talentRank(player, key) -> Number|null`, and `talentDrift(roster) -> [{ name, key }]`. Task 5 consumes `talentRank`. All three are exported.

- [ ] **Step 1: Write the failing tests**

`P()` does not set `talents`, so attach it inline where a test needs it.

```js
function withTalents(p, t) { p.talents = t; return p; }
test('talentRank: reads the rank the addon reported', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 2 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), 2);
});
test('talentRank: rank 0 is a real answer, not unknown', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 0 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), 0);
});
test('talentRank: no talent data is unknown, not zero', () => {
    assert.strictEqual(E.talentRank(P('Stabby', 'ROGUE', 'Combat'), 'impExposeArmor'), null);
    // scanned, but this key was not among the pairs — the addon could not find the talent
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), {});
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
});
test('talentRank: a key belonging to another class is unknown', () => {
    const p = withTalents(P('Smashy', 'WARRIOR', 'Arms'), { impExposeArmor: 2 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
});
test('talentRank: a rank above maxRank is treated as unknown, not trusted', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 9 });
    assert.strictEqual(E.talentRank(p, 'impExposeArmor'), null);
    assert.deepStrictEqual(E.talentDrift([p]), [{ name: 'Stabby', key: 'impExposeArmor' }]);
});
test('talentDrift: a clean roster reports nothing', () => {
    const p = withTalents(P('Stabby', 'ROGUE', 'Combat'), { impExposeArmor: 2 });
    assert.deepStrictEqual(E.talentDrift([p, P('Smashy', 'WARRIOR', 'Arms')]), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `E.talentRank is not a function`.

- [ ] **Step 3: Implement**

Add near `SPEC_TREES`:

```js
    // The talents the catalog reasons about, under the same keys RaidSpecScan exports. The
    // addon resolved these by name at scan time, so there are no coordinates here to drift.
    // `maxRank` is the guard for the one thing that CAN drift: these keys and the addon's
    // TRACKED_TALENTS are maintained on opposite sides of the wire.
    const TALENTS = {
        impExposeArmor:  { class: 'ROGUE',   maxRank: 2, name: 'Improved Expose Armor' },
        impThunderClap:  { class: 'WARRIOR', maxRank: 3, name: 'Improved Thunder Clap' },
        impDemoShout:    { class: 'WARRIOR', maxRank: 5, name: 'Improved Demoralizing Shout' },
        impSealCrusader: { class: 'PALADIN', maxRank: 3, name: 'Improved Seal of the Crusader' },
    };

    // null means "we do not know" — a Raid-Helper signup, a manually added player, or a talent
    // the addon could not find. That must never be confused with "we know they lack it", which
    // is rank 0.
    function talentRank(player, key) {
        const def = TALENTS[key];
        if (!def || def.class !== player.class || !player.talents) return null;
        const rank = player.talents[key];
        if (typeof rank !== 'number' || isNaN(rank)) return null;
        if (rank > def.maxRank) return null;
        return rank;
    }

    // A key mismatch between the addon and this table is systemic — it hits every player of
    // that class at once — so surface it rather than letting the whole class read as unknown.
    function talentDrift(roster) {
        const out = [];
        roster.forEach(p => {
            if (!p.talents) return;
            Object.keys(p.talents).forEach(key => {
                const def = TALENTS[key];
                if (def && def.class === p.class && p.talents[key] > def.maxRank) {
                    out.push({ name: p.name, key: key });
                }
            });
        });
        return out;
    }
```

Export `TALENTS`, `talentRank` and `talentDrift`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: **157 passed, 0 failed** (151 + 6 new).

- [ ] **Step 5: Prove the guards are load-bearing**

Two mutations on a scratch copy, each run then restored:

1. Delete `if (rank > def.maxRank) return null;` from `talentRank`. Expected: `a rank above maxRank is treated as unknown, not trusted` fails.
2. Delete `def.class !== player.class ||` from the same guard. Expected: `a key belonging to another class is unknown` fails.

Paste both.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: talent table keyed to the addon's exported names"
```

---

### Task 5: Rank by talent ahead of spec

**Files:**
- Modify: `assignments-engine.js` (`rankPool`, `DEBUFF_CATALOG`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `talentRank` from Task 4.
- Produces: `improvedBy` honoured on entries and providers; `rankPool` ordering changes only for rows that declare it. Task 6 renders the consequence.

- [ ] **Step 1: Write the failing tests**

```js
function rogue(name, spec, rank) {
    const p = P(name, 'ROGUE', spec);
    if (rank !== null) p.talents = { impExposeArmor: rank };
    return p;
}
test('autoAssign: a talented off-spec rogue beats an untalented on-spec one', () => {
    // Subtlety is the preferred spec, but the talent is the thing the spec was a proxy for.
    const r = E.autoAssign([rogue('Asub', 'Subtlety', 0), rogue('Zcombat', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zcombat');
});
test('autoAssign: unknown outranks known-untalented', () => {
    const r = E.autoAssign([rogue('Aknown', 'Combat', 0), rogue('Zunknown', 'Combat', null)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zunknown');
});
test('autoAssign: a higher rank wins inside the talented tier', () => {
    const r = E.autoAssign([rogue('Alow', 'Combat', 1), rogue('Zhigh', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').player, 'Zhigh');
});
test('autoAssign: a row without improvedBy is unaffected by talent data', () => {
    // hemo has no improvedBy, so spec order must still decide even when talents are present.
    const r = E.autoAssign([rogue('Asub', 'Subtlety', 0), rogue('Zcombat', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'hemo').player, 'Asub');
});
function warrior(name, spec, rank) {
    const p = P(name, 'WARRIOR', spec);
    if (rank !== null) p.talents = { impThunderClap: rank };
    return p;
}
test('autoAssign: improvedBy survives providersOf on a single-class entry', () => {
    // tclap is single-class, so providersOf rebuilds its provider field by field from an
    // explicit allowlist. A field left out of that list is silently dropped, and this row
    // would ignore talents entirely while the providers-based rows worked fine.
    const r = E.autoAssign([warrior('Aarms', 'Arms', 0), warrior('Zprot', 'Protection', 3)], {});
    assert.strictEqual(duty(r, 'tclap').player, 'Zprot');
});
```

`Aarms` is both the preferred spec and alphabetically first, so this test can only pass if the
talent tier reached the row — which requires `improvedBy` to survive `providersOf`.

Every fixture is deliberately anti-alphabetical: `rankPool` falls back to `a.name.localeCompare(b.name)`, so a fixture whose alphabetical order matches its expected order proves nothing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL on the first three — without the tier, `Asub` wins `armor` on spec order and on the name tiebreak. The fourth should already pass.

- [ ] **Step 3: Add the tier to `rankPool`**

Replace `rankPool` with:

```js
    // Talent beats spec: preferSpecs was only ever a proxy for "did they take the talent", so
    // once the real value is known the proxy defers to it. Unknown sits between — "we do not
    // know" must not lose to "we know they cannot".
    function talentTier(p, entry) {
        if (!entry.improvedBy) return 0;
        const rank = talentRank(p, entry.improvedBy);
        if (rank === null) return 1;
        return rank > 0 ? 0 : 2;
    }

    function rankPool(pool, entry, dutyCount) {
        return pool.slice().sort((a, b) => {
            const ta = talentTier(a, entry), tb = talentTier(b, entry);
            if (ta !== tb) return ta - tb;
            if (ta === 0 && entry.improvedBy) {
                const ra = talentRank(a, entry.improvedBy) || 0, rb = talentRank(b, entry.improvedBy) || 0;
                if (ra !== rb) return rb - ra; // higher rank first
            }
            const sa = specRank(a, entry), sb = specRank(b, entry);
            if (sa !== sb) return sa - sb;
            const ca = dutyCount[a.name] || 0, cb = dutyCount[b.name] || 0;
            if (ca !== cb) return ca - cb;
            return a.name.localeCompare(b.name);
        });
    }
```

- [ ] **Step 4: Carry `improvedBy` through `providersOf`**

`providersOf` rebuilds a single-class entry from an explicit field allowlist, so a new field is
dropped unless it is named. Two of the four rows below (`tclap`, `joc`) are single-class and would
silently ignore talents without this. Change the final return:

```js
        return [{ name: entry.name, class: entry.class, preferSpecs: entry.preferSpecs,
                  requireSpec: entry.requireSpec, group: entry.group, caution: entry.caution,
                  improvedBy: entry.improvedBy }];
```

The `entry.providers` branch above needs no change — provider objects are passed through as-is, so
an `improvedBy` written on a provider already survives.

- [ ] **Step 5: Wire `improvedBy` onto the four rows**

`improvedBy` goes on whatever object carries `class` — the provider for a providers entry, the entry itself otherwise.

```js
            { name: 'Improved Expose Armor', class: 'ROGUE', preferSpecs: ['Subtlety', 'Combat'], improvedBy: 'impExposeArmor' },
```

```js
            { name: 'Demoralizing Shout', class: 'WARRIOR', preferSpecs: ['Arms', 'Fury'], improvedBy: 'impDemoShout' },
```

```js
        { id: 'tclap', name: 'Thunder Clap', category: 'debuffs', class: 'WARRIOR', preferSpecs: ['Arms', 'Protection'], improvedBy: 'impThunderClap' },
```

For `joc`, add `improvedBy: 'impSealCrusader'` to the existing entry, leaving `requireSpec`, `group` and `applicableWhen` exactly as they are.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: **162 passed, 0 failed** (157 + 5 new). If a pre-existing test fails, STOP and report which assignment moved and why — do not adjust the test.

- [ ] **Step 7: Prove the tier and the allowlist fix are both load-bearing**

Two mutations on a scratch copy, each run then discarded:

1. Make `talentTier` always return `0`. Expected: at least the first two new tests fail.
2. Remove `improvedBy: entry.improvedBy` from the `providersOf` return. Expected: `improvedBy survives providersOf on a single-class entry` fails, and **only** that one — which is the proof that it is the test carrying this fix.

Restore after each, re-run, paste both failures.

- [ ] **Step 8: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: rank by talent ahead of spec on the four rows that need it"
```

---

### Task 6: The row explains itself

**Files:**
- Modify: `assignments-engine.js` (`record`, `buildDiscord`)
- Modify: `assignments.js` (`dutyRow`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `improvedBy` and `talentRank`.
- Produces: `duty.qualifier` — a short ASCII String, or absent. Rendered only in the Assignments panel and the Discord output.

- [ ] **Step 1: Write the failing tests**

These reuse the `rogue(name, spec, rank)` helper added in Task 5 Step 1 — same file, already in
scope. Do not redefine it.

```js
test('autoAssign: an improvedBy row states the talent it found', () => {
    const r = E.autoAssign([rogue('Zcombat', 'Combat', 2)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'Improved Expose Armor 2/2');
});
test('autoAssign: an improvedBy row says so when the talent is missing', () => {
    const r = E.autoAssign([rogue('Zcombat', 'Combat', 0)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'no Improved Expose Armor');
});
test('autoAssign: an improvedBy row says so when the talent is unknown', () => {
    const r = E.autoAssign([rogue('Zcombat', 'Combat', null)], {});
    assert.strictEqual(duty(r, 'armor').qualifier, 'talent unknown');
});
test('autoAssign: a row without improvedBy carries no qualifier', () => {
    const r = E.autoAssign([rogue('Asub', 'Subtlety', 2)], {});
    assert.strictEqual(duty(r, 'hemo').qualifier, undefined);
});
test('buildDiscord: the qualifier rides along on the duty line', () => {
    const roster = [rogue('Zcombat', 'Combat', 0)];
    const out = E.buildDiscord(roster, E.autoAssign(roster, {}), {});
    const line = out.split('\n').find(l => /Improved Expose Armor —/.test(l));
    assert.ok(line, 'no armor line in the output');
    assert.ok(/\(no Improved Expose Armor\)$/.test(line), line);
});
test('buildDiscord: the qualifier stays ASCII', () => {
    const roster = [rogue('Zcombat', 'Combat', 0)];
    const sheet = E.autoAssign(roster, {});
    sheet.duties.filter(d => d.qualifier).forEach(d => {
        assert.ok(!/[^\x00-\x7F]/.test(d.qualifier), d.qualifier);
    });
    assert.ok(sheet.duties.some(d => d.qualifier), 'expected at least one qualifier to check');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAIL — `qualifier` is `undefined` everywhere.

- [ ] **Step 3: Set the qualifier in `record`**

`record` already receives the resolved entry (or provider) and the chosen player, so it needs no new plumbing. Add before `duties.push(d)`:

```js
            // An improvedBy row can pick an off-spec player because they hold the talent, which
            // reads as a bug unless the row says why. ASCII only — this object feeds the addon
            // whisper path, whose length budget assumes it.
            if (entry.improvedBy && player) {
                const def = TALENTS[entry.improvedBy];
                const rank = talentRank(player, entry.improvedBy);
                if (def) {
                    if (rank === null) d.qualifier = 'talent unknown';
                    else if (rank === 0) d.qualifier = 'no ' + def.name;
                    else d.qualifier = def.name + ' ' + rank + '/' + def.maxRank;
                }
            }
```

- [ ] **Step 4: Render it in the Discord output**

In `buildDiscord`, in the debuffs/cooldowns row loop, change:

```js
                let s = d.name + ' — ' + nm(d.player);
                if (d.target) s += ' → ' + (byName[d.target] ? nm(d.target) : displayTarget(d.target));
```

to:

```js
                let s = d.name + ' — ' + nm(d.player);
                if (d.target) s += ' → ' + (byName[d.target] ? nm(d.target) : displayTarget(d.target));
                if (d.qualifier) s += ' (' + d.qualifier + ')';
```

Leave `buildRaidLines`, `whisperMap` and `buildAddonWhispers` untouched — they are terse and length-bound, and a raider needs to know what to do, not why they were picked.

- [ ] **Step 5: Render it in the Assignments panel**

In `assignments.js`'s `dutyRow`, after the `makeSelect` call that appends the player dropdown, add:

```js
    if (d.qualifier) {
        const q = document.createElement('span');
        q.className = 'duty-qualifier';
        q.textContent = '(' + d.qualifier + ')';
        row.appendChild(q);
    }
```

Append to `assignments.css`:

```css
.duty-qualifier { font-size: 0.82em; opacity: 0.7; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: **168 passed, 0 failed** (162 + 6 new).

- [ ] **Step 7: Prove the qualifier tests can fail**

On a scratch copy, delete the whole `if (entry.improvedBy && player)` block from `record`. Expected: the first three tests plus both `buildDiscord` tests fail. Restore, re-run, paste the output.

- [ ] **Step 8: Verify in the browser**

There is no browser tool in this harness. Use the headless-Chrome CDP driver in the session scratchpad (`cdp.js`, usage `node cdp.js <url> <script-file>`); adapted drivers `verify-blessings.js` and `verify-rotations.js` sit beside it and are the better starting point — they run one Chrome session with two `Page.navigate` calls, which is what makes a reload check honest, since `cdp.js` gets a fresh profile per invocation.

Start the server with `npm start` from the worktree root (serves `http://localhost:3000`) if it is not already running.

Import this roster. The talent field is now human-writable, so no helper is needed — `Zcombat` has
the talent, `Asub` demonstrably does not:

```
RSS3;Zcombat:ROGUE:15/41/5:1:Human:impExposeArmor=2;Asub:ROGUE:20/0/41:1:Human:impExposeArmor=0
```

Confirm: the Assignments panel shows `Zcombat` on the `Major armor reduction` row with
`(Improved Expose Armor 2/2)` beside it — note `Asub` is both the preferred spec and alphabetically
first, so `Zcombat` winning is the whole point; the Discord tab shows the same qualifier in
parentheses; and there are zero console errors. Never click `Share link` — it hangs on the clipboard API.

Paste the actual observed output.

- [ ] **Step 9: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js assignments.css
git commit -m "feat: explain why an improvedBy row picked who it picked"
```

---

## After the plan

In-game verification, once `RaidSpecScan` 3.0 is installed (prerequisite P2):

1. `/specscan` in a real raid produces an export beginning `RSS3;`.
2. For at least two players of different classes, the talent digits match their actual talent panes — spot-check two talents each.
3. A player who cannot be inspected still appears, with `?` for points and an empty talent field.
4. Pasting the export into the web tool yields the same roster it would have before, plus talent-driven picks on the four wired rows.
5. Confirm on a real rogue: if they lack Improved Expose Armor, the armor row says so rather than claiming it.

## Open questions for the implementer

- **The four talent names in the addon's `TRACKED_TALENTS` are English strings typed from memory.** `Improved Seal of the Crusader` was confirmed verbatim from a probe run; the other three were not. If a row never sees talent data, check the spelling against `/tprobe target <partial name>` before suspecting the ranking logic — a name that does not match is silently omitted, which reads as unknown.
- **`talentDrift` is exported but nothing renders it.** That is deliberate — it exists so a shifted table is diagnosable from a test or a console call. Wiring it into the UI is a follow-up, not part of this plan.
- **Scorpid Sting's removal changes hunter duty counts.** Task 1 Step 5 re-proves the Tranq Shot fixture, but if any other hunter-related assertion starts behaving oddly later in the plan, that removal is the first place to look.
