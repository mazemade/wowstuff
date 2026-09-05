# RSS2 Wire Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry each player's raid subgroup, race, and **full per-talent ranks** from the addon to the web tool — so party-scoped assignments become possible, draenei can be placed, and every talent-conditional rule in the tool stops being a guess based on spec.

**Architecture:** The web parser learns the new format *first* and keeps accepting the old one, so a mixed raid works during rollout. Only then does the addon start emitting it. `player.group`, `player.race` and `player.talents` are `null` for `RSS1` input and for any player the addon could not inspect.

The addon already holds full inspect data when it reads tab totals — `GetTalentTabInfo` is just the summary view of what `GetTalentInfo(tab, index, isInspect)` exposes per talent. Capturing the individual ranks costs one extra loop at scan time and removes the tool's single largest source of wrong guesses.

**Tech Stack:** Lua 5.1 (WoW 2.5.6 client API) for the addon; plain ES5-compatible JavaScript for the parser. Tests via `node assignments-engine.test.js`.

**Depends on:** nothing. Blocks the group-layout plan.

## Global Constraints

- **RSS1 must keep working forever.** A raider on the old addon produces a roster identical to today's, with `group` and `race` reading `null`. Every existing test passes unmodified **except exactly two**: the fixtures that `deepStrictEqual` a full player object (`RSS1 regression: a full raid export parses to exactly this roster` and `parseAddonExport: happy path with header`) gain `group: null, race: null` on their expected players, because every parsed player now carries those keys. Those two edits are expected and are the *only* allowed test edits — anything else failing means the parser regressed.
- **One addon, not two.** `RaidSpecScan` is bumped in place. There is no parallel "live" addon — two `/specscan` commands in one raid is a worse failure mode than a missing group number.
- **Locale independence.** Use the *second* return of `UnitRace` (the file/token name, e.g. `Draenei`), never the localized first return, or the tool breaks for non-English clients.
- **Order: parser first, addon second.** Shipping the addon first would produce exports the deployed site cannot read.
- **Test command:** `node assignments-engine.test.js`

---

### Task 1: Teach the parser both formats

**Files:**
- Modify: `assignments-engine.js:39-65` (`parseAddonExport`)
- Modify: `assignments-engine.test.js`

**Interfaces:**
- Produces: player objects gain `group: Number|null` and `race: String|null`. The group-layout plan relies on both.

- [ ] **Step 1: Write the failing tests**

Append above the final `console.log` in `assignments-engine.test.js`:

```js
test('parseAddonExport: RSS2 carries subgroup and race', () => {
    const r = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:1:Human;Zapp:SHAMAN:0/41/20:2:Draenei');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, 1);
    assert.strictEqual(r.players[0].race, 'Human');
    assert.strictEqual(r.players[1].group, 2);
    assert.strictEqual(r.players[1].race, 'Draenei');
});
test('parseAddonExport: RSS1 still parses, with group and race null', () => {
    const r = E.parseAddonExport('RSS1;Thunderfist:WARRIOR:5/6/50');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, null);
    assert.strictEqual(r.players[0].race, null);
    assert.strictEqual(r.players[0].spec, 'Protection');
});
test('parseAddonExport: RSS2 unscanned player keeps group and race', () => {
    const r = E.parseAddonExport('RSS2;Mystery:HUNTER:?:4:Orc');
    assert.ok(r.players[0].flags.includes('spec-unknown'));
    assert.strictEqual(r.players[0].group, 4);
    assert.strictEqual(r.players[0].race, 'Orc');
});
test('parseAddonExport: RSS2 tolerates a missing trailing race', () => {
    const r = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:3');
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.players[0].group, 3);
    assert.strictEqual(r.players[0].race, null);
});
test('parseAddonExport: an out-of-range subgroup is an error, not a silent bad group', () => {
    const r = E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:9:Human');
    assert.strictEqual(r.players.length, 0);
    assert.ok(r.errors.length === 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`

Expected: FAILs — the regex rejects the extra `:1:Human` fields, so those lines land in `errors` and `players` is empty.

- [ ] **Step 3: Extend the parser**

In `assignments-engine.js`, replace the header-skip line and the match line inside `parseAddonExport`:

```js
            if (/^RSS\d+$/i.test(tok)) return; // format header
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
```

with:

```js
            if (/^RSS\d+$/i.test(tok)) return; // format header
            // RSS1: name:CLASS:41/20/0        RSS2 adds :subgroup:Race, both optional so a
            // partially-upgraded raid still parses. Group and race read null when absent.
            const m = tok.match(/^([^:]+):([A-Za-z]+):(?:(\d+)\/(\d+)\/(\d+)|\?)(?::(\d+)(?::([A-Za-z]+))?)?$/);
            if (!m) { errors.push('Unrecognized line: ' + tok); return; }
            let group = null;
            if (m[6] !== undefined) {
                group = Number(m[6]);
                if (group < 1 || group > 8) { errors.push('Subgroup out of range in: ' + tok); return; }
            }
            const race = m[7] === undefined ? null : m[7];
```

Then add both fields to the pushed player object:

```js
            players.push({ name, class: cls, spec, flags, source: 'addon', group, race });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`

Expected: the five new tests PASS, and **exactly two existing tests fail**, both `deepStrictEqual` fixtures asserting full player objects:

1. `RSS1 regression: a full raid export parses to exactly this roster` (the catalog-rules plan's pinned fixture) — update its nine expected objects to include `group: null, race: null`.
2. `parseAddonExport: happy path with header` — its first assertion compares a whole player object; add `group: null, race: null` there too.

Both are the fixtures doing their job as the wire format grows. If **any other** test fails, stop — the parser change broke something it shouldn't have. Note in the commit that the wire format grew.

- [ ] **Step 5: Run the tests again**

Run: `node assignments-engine.test.js`

Expected: zero failures.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: parse RSS2 subgroup and race, keeping RSS1 support"
```

---

### Task 2: Emit RSS2 from the addon

**Files:**
- Modify: `RaidSpecScan/RaidSpecScan.lua:39-48` (`AddResult`, `ShowExport`)
- Modify: `RaidSpecScan/RaidSpecScan.toc`

**Interfaces:**
- Consumes: the parser from Task 1.
- Produces: exports of the form `RSS2;name:CLASS:41/20/0:3:Draenei`.

- [ ] **Step 1: Add a subgroup lookup**

In `RaidSpecScan.lua`, immediately above `AddResult`, add:

```lua
-- The unit token is the reliable source: UnitInRaid's return base changed across expansions,
-- so parse the index out of "raidN" and fall back to a name scan for anything else (the
-- player's own "player" token, mainly).
local function SubgroupOf(unit, name)
    local idx = tonumber(string.match(unit or "", "^raid(%d+)$"))
    if idx then
        local _, _, subgroup = GetRaidRosterInfo(idx)
        if subgroup then return subgroup end
    end
    for i = 1, GetNumGroupMembers and GetNumGroupMembers() or 40 do
        local rname, _, rsub = GetRaidRosterInfo(i)
        if rname and rname == name then return rsub end
    end
    return nil
end
```

- [ ] **Step 2: Include subgroup and race in each result line**

Replace `AddResult`:

```lua
local function AddResult(unit, points)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if name and classToken then
        table.insert(results, name .. ":" .. classToken .. ":" .. points)
    end
end
```

with:

```lua
local function AddResult(unit, points)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if name and classToken then
        local line = name .. ":" .. classToken .. ":" .. points
        local subgroup = SubgroupOf(unit, name)
        if subgroup then
            line = line .. ":" .. subgroup
            -- Second return is the locale-independent token ("Draenei"); the first is
            -- localized and would break the web tool on a non-English client.
            local _, raceToken = UnitRace(unit)
            if raceToken then line = line .. ":" .. raceToken end
        end
        table.insert(results, line)
    end
end
```

Note the nesting: race is only appended when a subgroup was found, because the format is positional and a race cannot occupy the subgroup slot.

- [ ] **Step 3: Bump the header and the version**

In `ShowExport`, change:

```lua
    local text = "RSS1;" .. table.concat(results, ";")
```

to:

```lua
    local text = "RSS2;" .. table.concat(results, ";")
```

In `RaidSpecScan/RaidSpecScan.toc`, change `## Version: 1.0` to `## Version: 2.0`.

- [ ] **Step 4: Verify the output shape without a game client**

There is no Lua test harness in this repo, so verify by inspection and by round-tripping a hand-built string through the parser:

```bash
node -e "const E=require('./assignments-engine.js');
const r=E.parseAddonExport('RSS2;Thunderfist:WARRIOR:5/6/50:1:Human;Mystery:HUNTER:?:2:Draenei');
console.log(JSON.stringify(r,null,2));"
```

Expected: two players, no errors, groups 1 and 2, races `Human` and `Draenei`.

Then re-read the three edited Lua functions and confirm: `SubgroupOf` returns `nil` rather than erroring when `GetRaidRosterInfo` has nothing to say about the unit, and `AddResult` then emits a plain RSS1-shaped line with no trailing colon. Note that `/specscan` refuses to run outside a raid (the `IsInRaid()` guard at the bottom of the file), so the `nil` path is defensive depth, not a live scenario — it exists so a weird roster state degrades to "no group" instead of a Lua error mid-scan.

- [ ] **Step 5: Commit**

```bash
git add RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc
git commit -m "feat: export subgroup and race as RSS2"
```

- [ ] **Step 6: In-game verification (requires a client — do not skip before release)**

Load the addon in TBC 2.5.6, join a raid with players in at least two different subgroups, run `/specscan`, and confirm:

1. The export begins `RSS2;`.
2. Lines carry a subgroup that matches the actual raid frames.
3. Race tokens are English even on a non-English client, if one is available to test.
4. Running `/specscan` **outside a raid** still prints the "You must be in a raid." message and nothing else.
5. Pasting the export into the web tool produces the same roster it would have before.

Record the result in the commit or PR description. If a client is unavailable, say so explicitly rather than marking this step done.

---

## Open questions for the implementer

- **`GetNumGroupMembers` exists on this client** — the shipped addon already calls it unguarded in the `/specscan` handler (`RaidSpecScan.lua:161`) and works in production, so this question is settled. Keep the `GetNumGroupMembers and ... or 40` guard anyway; it costs nothing and matches the file's defensive idiom (see the `pcall`-guarded `RegisterEvent` loop).
- **Race is only useful for draenei today.** Everything else the group planner needs comes from class and spec. If carrying race turns out to be a privacy or size concern, dropping it costs only the draenei de-duplication pass.
