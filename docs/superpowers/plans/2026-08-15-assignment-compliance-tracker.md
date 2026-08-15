# Assignment Compliance Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The RaidAssign addon tracks, live during a boss pull and in a post-fight scoreboard, whether assigned boss debuffs and group totem/party buffs were actually kept up — and by whom — with optional post-fight whispers to selected offenders.

**Architecture:** The web tool's Addon-tab payload (currently `RSW2`) becomes `RSW3` and gains `@T` tracking lines derived from the assignment sheet (aura names + accountable player/group). The addon parses them; a new `Track.lua` watches `ENCOUNTER_START/END`, the combat log (boss debuffs, with source attribution) and periodic `UnitAura` scans (group buffs), storing per-pull results in `RaidAssignDB.pulls`. A new `TrackUI.lua` renders a live in-fight list and a `/racheck` scoreboard with checkbox-selected whispers. `Minimap.lua`'s cursor menu becomes a small hub panel with a status line and a Check results button.

**Tech Stack:** Vanilla JS (UMD module, no deps), WoW Anniversary 2.5.6 Lua addon (plain frames, no libraries), tests via `node assignments-engine.test.js` and `luajit <file>.test.lua`.

**Spec:** `docs/superpowers/specs/2026-08-15-assignment-compliance-tracker-design.md` (read it first; it explains the aura-NAME matching decision and the v1 scope cuts).

## Global Constraints

- No addon libraries, no `EasyMenu`/dropdown machinery — it is nil on wow_anniversary 2.5.6.69110; hand-rolled plain frames only (see existing `Minimap.lua` comment).
- Addon files share **no locals**; they talk only through the `RaidAssignAPI` global. Each file must keep working if a sibling file fails to load (`RaidAssignAPI = RaidAssignAPI or {}` when extending it).
- Aura matching is by **English in-game aura name**, never spell ID (spec §1 revision). A payload field may carry several comma-separated candidate names.
- Payload text is ASCII-only; `|` and `,` are field/list separators and never appear in names.
- Boss fights only: `ENCOUNTER_START`/`ENCOUNTER_END`. No trash, no blessings, no WCL (spec "out of scope").
- Nothing ever auto-posts to chat or auto-whispers; every send is a click.
- Tests: engine tests go in `assignments-engine.test.js` (node, `assert`, `test(name, fn)` pattern); addon tests in `raid-assign.test.lua` / new `raid-track.test.lua` (luajit, stub WoW globals, drive public surface only — never reach into addon locals).
- Comment style: explain constraints the code can't show, at the density of the existing files.

## File Structure

- Modify `assignments-engine.js` — `TRACK_AURAS` table, `@T` line generation inside `buildAddonWhispers`, header bump to RSW3.
- Modify `assignments-engine.test.js` — new tests; update any test asserting the `RSW2` header.
- Modify `RaidAssign/RaidAssign.lua` — accept RSW3, parse `@T` lines, expose `RaidAssignAPI.GetTracking()` and `RaidAssignAPI.SendRaw()`, history-recording flag on the whisper queue.
- Create `RaidAssign/Track.lua` — tracking engine + per-pull storage + `RaidAssignAPI.TrackLive/Pulls/LastPullInfo`.
- Create `RaidAssign/TrackUI.lua` — live view frame + `/racheck` scoreboard + whisper-selected.
- Modify `RaidAssign/RaidAssign.toc` — add the two files (after `RaidAssign.lua`, before `Minimap.lua`).
- Modify `RaidAssign/Minimap.lua` — hub panel replaces the cursor menu; Check results entry.
- Modify `raid-assign.test.lua` — RSW3 parsing tests, SendRaw test, minimap-hub test updates.
- Create `raid-track.test.lua` — tracker tests with synthetic encounters/combat-log events.

Run tests from the repo root: `node assignments-engine.test.js`, `luajit raid-assign.test.lua`, `luajit raid-track.test.lua`.

---

### Task 1: Engine — RSW3 header and `@T D` debuff lines

**Files:**
- Modify: `assignments-engine.js` (function `buildAddonWhispers`, ~line 789)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `sheet.duties` rows `{ id, name, category, player }` produced by `autoAssign(roster)`; duty `name` is the provider name (`'Sunder Armor'`, `'Curse of Elements'`, …).
- Produces: `buildAddonWhispers(roster, sheet, groupsResult)` returns a payload whose first line is `RSW3` and which contains one `@T D|<id>|<display>|<auraCSV>|<player>[|noattrib]` line per assigned, trackable debuff duty. Later tasks (addon) parse exactly this shape.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js` (before the pass/fail summary at the bottom; follow the file's `test(name, fn)` style):

```js
// --- Compliance tracking payload (@T lines) ---
test('buildAddonWhispers: RSW3 header', () => {
    const roster = [{ name: 'Zug', class: 'WARLOCK', spec: 'Affliction', flags: [] }];
    const sheet = E.autoAssign(roster);
    assert.strictEqual(E.buildAddonWhispers(roster, sheet, null).split('\n')[0], 'RSW3');
});
test('buildAddonWhispers: assigned debuff gets a @T D line with its aura name', () => {
    const roster = [
        { name: 'Zug', class: 'WARLOCK', spec: 'Affliction', flags: [] },
        { name: 'Twig', class: 'DRUID', spec: 'Balance', flags: [] },
    ];
    const sheet = E.autoAssign(roster);
    const lines = E.buildAddonWhispers(roster, sheet, null).split('\n');
    assert.ok(lines.includes('@T D|coe|Curse of Elements|Curse of the Elements|Zug'),
        'missing CoE line in:\n' + lines.filter(l => l.startsWith('@T')).join('\n'));
    assert.ok(lines.includes('@T D|ff|Faerie Fire|Faerie Fire,Faerie Fire (Feral)|Twig'));
});
test('buildAddonWhispers: noattrib flag rides on Sunder Armor', () => {
    const roster = [{ name: 'Tank', class: 'WARRIOR', spec: 'Protection', flags: [] }];
    const sheet = E.autoAssign(roster);
    const lines = E.buildAddonWhispers(roster, sheet, null).split('\n');
    assert.ok(lines.includes('@T D|armor|Sunder Armor|Sunder Armor|Tank|noattrib'));
});
test('buildAddonWhispers: unassigned/untrackable duties emit no @T line', () => {
    // Personal curses ('Curse of Doom/Agony (personal)') and cooldowns must not appear.
    const roster = [
        { name: 'Zug', class: 'WARLOCK', spec: 'Affliction', flags: [] },
        { name: 'Bob', class: 'WARLOCK', spec: 'Destruction', flags: [] },
    ];
    const sheet = E.autoAssign(roster);
    const tLines = E.buildAddonWhispers(roster, sheet, null).split('\n').filter(l => l.startsWith('@T'));
    assert.ok(!tLines.some(l => l.includes('personal')), tLines.join('\n'));
    assert.ok(!tLines.some(l => l.includes('Soulstone')), tLines.join('\n'));
});
```

Notes for the implementer: the duty `id` in the `@T` line is the duty row's `id` field (`d.id`) — the same key the overrides use (`'coe'`, `'armor'`, …). Verify by reading `record()` inside `autoAssign` (~line 500s); if a duty row turns out not to carry `id`, fix the test expectation to what the sheet really stores and key the line on that. The armor row's duty id is `'armor'` with `name` `'Sunder Armor'` (the chosen provider's name).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: the four new tests FAIL (header is `RSW2`, no `@T` lines); everything else passes.

- [ ] **Step 3: Implement**

In `assignments-engine.js`, directly above `buildAddonWhispers` (~line 789), add:

```js
    // In-game aura names for assigned boss debuffs, keyed by duty name (the provider name
    // record() stores). Values are what COMBAT_LOG_EVENT_UNFILTERED reports as spellName —
    // NOT always the ability name (Improved Scorch's debuff is 'Fire Vulnerability').
    // Comma-separated alternatives are all matched by the addon; the in-game verification
    // pass (plan Task 9) prunes wrong variants. noattrib marks rows where "applied by the
    // assignee" is meaningless: every warrior stacks Sunder, and Screech comes from a pet.
    const TRACK_AURAS = {
        'Sunder Armor':              { auras: 'Sunder Armor', noattrib: true },
        'Improved Expose Armor':     { auras: 'Expose Armor' },
        'Curse of Elements':         { auras: 'Curse of the Elements' },
        'Curse of Recklessness':     { auras: 'Curse of Recklessness' },
        'Judgement of the Crusader': { auras: 'Judgement of the Crusader' },
        'Judgement of Wisdom':       { auras: 'Judgement of Wisdom' },
        'Faerie Fire':               { auras: 'Faerie Fire,Faerie Fire (Feral)' },
        "Hunter's Mark":             { auras: "Hunter's Mark" },
        'Improved Scorch':           { auras: 'Fire Vulnerability' },
        "Winter's Chill":            { auras: "Winter's Chill" },
        'Demoralizing Shout':        { auras: 'Demoralizing Shout' },
        'Curse of Weakness':         { auras: 'Curse of Weakness' },
        'Demoralizing Roar':         { auras: 'Demoralizing Roar' },
        'Screech (pet)':             { auras: 'Screech', noattrib: true },
        'Thunder Clap':              { auras: 'Thunder Clap' },
        'Insect Swarm':              { auras: 'Insect Swarm' },
        'Hemorrhage':                { auras: 'Hemorrhage' },
    };

    // @T tracking lines for the addon's compliance tracker: what to watch, who answers
    // for it. Only assigned debuff duties with a known boss aura produce a line — personal
    // curses, cooldowns and rotations have nothing uptime-shaped to check.
    function buildTrackingLines(sheet, groupsResult) {
        const lines = [];
        (sheet.duties || []).filter(d => d.category === 'debuffs' && d.player).forEach(d => {
            const t = TRACK_AURAS[d.name];
            if (!t) return;
            lines.push('@T D|' + d.id + '|' + d.name + '|' + t.auras + '|' + d.player
                + (t.noattrib ? '|noattrib' : ''));
        });
        return lines; // Task 2 appends @T B group-buff lines here
    }
```

In `buildAddonWhispers`, change `const lines = ['RSW2'];` to `const lines = ['RSW3'];` and, after the existing `@G` loop, add:

```js
        buildTrackingLines(sheet, groupsResult).forEach(l => lines.push(l));
```

- [ ] **Step 4: Fix any existing test asserting the RSW2 header**

Run: `grep -n "RSW2" assignments-engine.test.js assignments.js`
Update test expectations to `RSW3` (payload consumers in `assignments.js` don't check the version string — confirm with the grep; if any code branches on `'RSW2'`, update it too).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: RSW3 payload — @T D debuff tracking lines with aura names and assignee"
```

---

### Task 2: Engine — `@T B` group-buff lines

**Files:**
- Modify: `assignments-engine.js` (`buildTrackingLines` from Task 1)
- Test: `assignments-engine.test.js`

**Interfaces:**
- Consumes: `groupsResult.groups[i].players` (roster player objects) from `proposeGroups`; module-internal `airChoiceNamesOf(players)` (~line 1913) — in scope for `buildTrackingLines` since both live in the same UMD closure.
- Produces: `@T B|<id>|<display>|<auraCSV>|<groupNumber>|<provider>` lines, one per expected maintainable party buff per group: the group's air-totem choice(s), Strength of Earth + Mana Spring when a shaman is present, Totem of Wrath when an Elemental shaman is present, Battle Shout when a warrior is present. Mana Tide is a 5-minute cooldown, not an uptime buff — deliberately not tracked.

- [ ] **Step 1: Write the failing tests**

```js
test('buildAddonWhispers: shaman group gets earth/water totem @T B lines', () => {
    const sham = { name: 'Sham', class: 'SHAMAN', spec: 'Enhancement', flags: [] };
    const warr = { name: 'Warr', class: 'WARRIOR', spec: 'Fury', flags: [] };
    const roster = [sham, warr];
    const sheet = E.autoAssign(roster);
    const groupsResult = { groups: [{ players: [sham, warr] }] };
    const lines = E.buildAddonWhispers(roster, sheet, groupsResult).split('\n');
    assert.ok(lines.includes('@T B|soe|Strength of Earth|Strength of Earth,Strength of Earth Totem|1|Sham'));
    assert.ok(lines.includes('@T B|spring|Mana Spring|Mana Spring,Mana Spring Totem|1|Sham'));
    assert.ok(lines.includes('@T B|shout|Battle Shout|Battle Shout|1|Warr'));
    // The air slot is the score model's choice — assert one air row exists rather than which.
    assert.ok(lines.some(l => /^@T B\|(wf|goa|woa)\|/.test(l)),
        lines.filter(l => l.startsWith('@T B')).join('\n'));
});
test('buildAddonWhispers: elemental shaman group tracks Totem of Wrath', () => {
    const ele = { name: 'Zap', class: 'SHAMAN', spec: 'Elemental', flags: [] };
    const groupsResult = { groups: [{ players: [ele] }] };
    const lines = E.buildAddonWhispers([ele], E.autoAssign([ele]), groupsResult).split('\n');
    assert.ok(lines.includes('@T B|tow|Totem of Wrath|Totem of Wrath|1|Zap'));
});
test('buildAddonWhispers: shamanless group gets no totem lines', () => {
    const mage = { name: 'Ice', class: 'MAGE', spec: 'Frost', flags: [] };
    const groupsResult = { groups: [{ players: [mage] }] };
    const bLines = E.buildAddonWhispers([mage], E.autoAssign([mage]), groupsResult)
        .split('\n').filter(l => l.startsWith('@T B'));
    assert.deepStrictEqual(bLines, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: the three new tests FAIL (no `@T B` lines yet).

- [ ] **Step 3: Implement**

In `buildTrackingLines`, replace the `return lines; // Task 2 …` line with:

```js
        // Group buffs: one line per maintainable party aura the layout expects in that
        // group. Air rows follow airChoiceNamesOf so tracker and group notes can never
        // disagree about which air totem a group runs. Aura-name variants ('X' vs
        // 'X Totem') are listed until the in-game pass (Task 9) settles the real one.
        ((groupsResult && groupsResult.groups) || []).forEach((g, i) => {
            if (!g.players.length) return;
            const shamans = g.players.filter(p => p.class === 'SHAMAN');
            const first = (list, pred) => { const p = list.find(pred); return p && p.name; };
            const push = (id, name, auras, provider) => {
                if (provider) lines.push('@T B|' + id + '|' + name + '|' + auras + '|' + (i + 1) + '|' + provider);
            };
            const air = shamans.length ? airChoiceNamesOf(g.players) : [];
            if (air.indexOf('Windfury Totem') !== -1)
                push('wf', 'Windfury Totem', 'Windfury Totem',
                     first(shamans, p => p.spec === 'Enhancement') || shamans[0].name);
            if (air.indexOf('Grace of Air') !== -1)
                push('goa', 'Grace of Air', 'Grace of Air,Grace of Air Totem', shamans[0].name);
            if (air.indexOf('Wrath of Air') !== -1)
                push('woa', 'Wrath of Air', 'Wrath of Air,Wrath of Air Totem', shamans[0].name);
            if (shamans.length) {
                push('soe', 'Strength of Earth', 'Strength of Earth,Strength of Earth Totem', shamans[0].name);
                push('spring', 'Mana Spring', 'Mana Spring,Mana Spring Totem', shamans[0].name);
            }
            push('tow', 'Totem of Wrath', 'Totem of Wrath',
                 first(shamans, p => p.spec === 'Elemental'));
            push('shout', 'Battle Shout', 'Battle Shout', first(g.players, p => p.class === 'WARRIOR'));
        });
        return lines;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: all PASS. If the air-row assertion fails, print the `@T B` lines — `airChoiceNamesOf` may legitimately return no air row for an odd solo-player group; use a two-shaman-free melee group in the fixture rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "feat: @T B group-buff tracking lines — totems and Battle Shout per group"
```

---

### Task 3: Addon — parse RSW3 `@T` lines, `GetTracking`, `SendRaw`

**Files:**
- Modify: `RaidAssign/RaidAssign.lua` (`ParsePayload` ~line 23, `StartSending`/`SendTick` ~line 144, `OnLoadClicked` ~line 362, `RaidAssignAPI` ~line 472)
- Test: `raid-assign.test.lua`

**Interfaces:**
- Consumes: the `@T` line formats from Tasks 1–2, verbatim.
- Produces (later tasks depend on these exact names):
  - `RaidAssignAPI.GetTracking()` → `nil`, or `{ debuffs = { {id, name, auras, player, noattrib} … }, buffs = { {id, name, auras, group, provider} … } }` (auras = the raw comma-separated string).
  - `RaidAssignAPI.SendRaw(entries)` → `ok, countOrReason, skipped`; entries are `{ name, body }`; resolves in-raid targets like assignment whispers but **never** touches `RaidAssignDB.lastSent`.

- [ ] **Step 1: Write the failing tests**

Append to `raid-assign.test.lua`, using the file's existing `BuildWorld`/`LoadPayload`/`Tick` helpers (they `dofile` the addon and drive the real UI):

```lua
test('RSW3: @T lines land in GetTracking', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    LoadPayload({
        'RSW3',
        'Zug=Your assignments: Curse of Elements',
        '@T D|coe|Curse of Elements|Curse of the Elements|Zug',
        '@T D|armor|Sunder Armor|Sunder Armor|Tank|noattrib',
        '@T B|wf|Windfury Totem|Windfury Totem|3|Thrallson',
        '@G1=Zug',
    })
    local t = RaidAssignAPI.GetTracking()
    assertEqual(#t.debuffs, 2)
    assertEqual(t.debuffs[1].id, 'coe')
    assertEqual(t.debuffs[1].player, 'Zug')
    assertEqual(t.debuffs[1].auras, 'Curse of the Elements')
    assertEqual(t.debuffs[2].noattrib, true)
    assertEqual(t.buffs[1].group, 3)
    assertEqual(t.buffs[1].provider, 'Thrallson')
end)

test('RSW3: malformed @T line is skipped, payload still loads', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    LoadPayload({ 'RSW3', 'Zug=Hi', '@T D|broken' })
    assertEqual(#RaidAssignAPI.GetTracking().debuffs, 0)
    assertMatch(RaidAssignFrame.editBox:GetText(), 'Skipped 1 unreadable')
end)

test('RSW1 payload leaves tracking nil', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    LoadPayload({ 'RSW1', 'Zug=Hi' })
    assertEqual(RaidAssignAPI.GetTracking(), nil)
end)

test('SendRaw whispers without touching send history', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 }, { name = 'Bob', subgroup = 1 } } })
    LoadPayload({ 'RSW3', 'Zug=Hi' }) -- initialise the addon UI path
    local ok = RaidAssignAPI.SendRaw({ { name = 'Zug', body = 'Gruul pull 1: CoE up 41% - assigned to you' } })
    assertEqual(ok, true)
    Tick(2.0) -- one whisper per SEND_INTERVAL tick
    assertEqual(#world.whispers, 1)
    assertMatch(world.whispers[1], 'CoE up 41%%')
    assertEqual((RaidAssignDB.lastSent or {})['Zug'], nil)
end)
```

Check how `world.whispers` is populated (the `SendChatMessage` stub near the top of the file) and match its shape — if it stores `{msg, target}` tables, adapt the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-assign.test.lua`
Expected: new tests FAIL — "That is not an RSW1/RSW2 payload" for the RSW3 ones, nil `SendRaw` for the last.

- [ ] **Step 3: Implement**

In `RaidAssign/RaidAssign.lua`:

1. Module state: `local sheet = nil` block gains `local tracking = nil`.
2. `ParsePayload`: track a local `tracking` alongside `layout`; header check becomes

```lua
                if line ~= "RSW1" and line ~= "RSW2" and line ~= "RSW3" then
                    return nil, "That is not an RSW1/RSW2/RSW3 payload. Copy the Addon tab from the web tool."
                end
```

3. The `@`-line branch becomes a three-way dispatch (existing `@G` handling unchanged):

```lua
            elseif line:sub(1, 1) == "@" then
                -- "@" cannot start a character name, so these are unambiguously directives.
                local kind, rest = line:match("^@T ([DB])|(.+)$")
                if kind then
                    local f = {}
                    for field in rest:gmatch("[^|]+") do table.insert(f, field) end
                    trk = trk or { debuffs = {}, buffs = {} }
                    if kind == "D" and #f >= 4 then
                        table.insert(trk.debuffs, { id = f[1], name = f[2], auras = f[3],
                            player = f[4], noattrib = (f[5] == "noattrib") or nil })
                    elseif kind == "B" and #f >= 5 and tonumber(f[4]) then
                        table.insert(trk.buffs, { id = f[1], name = f[2], auras = f[3],
                            group = tonumber(f[4]), provider = f[5] })
                    else
                        table.insert(bad, line)
                    end
                else
                    local n, names = line:match("^@G([1-8])=(.+)$")
                    ... (existing @G body, unchanged)
                end
```

(name the parse-local `trk` to avoid shadowing confusion; declare it in the `local entries, bad, layout, sawHeader` line and return it as `result.tracking`.)

4. `OnLoadClicked`: `sheet, malformed, layout, tracking = result.entries, result.malformed, result.layout, result.tracking`.
5. `StartSending(list)` → `StartSending(list, record)`; the history-clearing block runs only `if record`; each queued item gets `item.record = record`. In `SendTick`, wrap the two history lines in `if item.record then … end`. The two existing call sites in `SendFiltered` pass `true`.
6. Extend the API table:

```lua
RaidAssignAPI = {
    ApplyGroups = ApplyGroups,
    LayoutInfo = LayoutSummary,
    GetTracking = function() return tracking end,
    -- Compliance whispers (TrackUI): same queue and raid-target resolution as
    -- assignment sends, but never recorded in lastSent — a scoreboard nag must not
    -- make the next real assignment send think the player already got their duties.
    SendRaw = function(entries)
        if sending then return false, "Already sending" end
        local sendable, skipped = Resolve(entries)
        if #sendable == 0 then return false, "Nobody selected is in the raid" end
        StartSending(sendable, false)
        return true, #sendable, skipped
    end,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-assign.test.lua`
Expected: all PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/RaidAssign.lua raid-assign.test.lua
git commit -m "feat: addon parses RSW3 @T tracking lines; SendRaw whisper path without history"
```

---

### Task 4: `Track.lua` — encounter lifecycle, boss-debuff uptime, storage

**Files:**
- Create: `RaidAssign/Track.lua`
- Modify: `RaidAssign/RaidAssign.toc` (add `Track.lua` after `RaidAssign.lua`)
- Test: create `raid-track.test.lua`

**Interfaces:**
- Consumes: `RaidAssignAPI.GetTracking()` (Task 3 shape).
- Produces:
  - `RaidAssignDB.pulls`: array, newest last, capped at 20, of `{ encounter, encounterID, ordinal, success (bool), duration, when, debuffs = { {id, name, player, noattrib, absent, uptime, byAssignee} … }, buffs = {} }` (buffs filled by Task 5). `uptime`/`byAssignee` are seconds.
  - `RaidAssignAPI.TrackLive()` → `nil` outside a pull; during one, array of `{ kind='D', name, pct, down }` (`down` = seconds the aura has currently been missing, nil while it's up).
  - `RaidAssignAPI.Pulls()` → the stored array (possibly empty).
  - `RaidAssignAPI.LastPullInfo()` → one-line headline like `"Gruul #3 — 2 of 9 below 90%"`, or nil.

- [ ] **Step 1: Write the failing tests**

Create `raid-track.test.lua`:

```lua
-- Tests for RaidAssign/Track.lua. Run from the repo root:
--
--     luajit raid-track.test.lua
--
-- Same approach as raid-assign.test.lua: stub the WoW globals, dofile the real file,
-- and drive it through events the way the client does — ENCOUNTER_START, combat-log
-- events via CombatLogGetCurrentEventInfo, OnUpdate ticks, ENCOUNTER_END. Time is a
-- controllable clock (world.time) so uptime math is exact.

local passed, failed = 0, 0
local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then passed = passed + 1; print('ok - ' .. name)
    else failed = failed + 1; io.stderr:write('FAIL - ' .. name .. '\n    ' .. tostring(err) .. '\n') end
end
local function assertEqual(actual, expected)
    if actual ~= expected then
        error('\n    expected: ' .. tostring(expected) .. '\n    actual:   ' .. tostring(actual), 2)
    end
end
local function assertClose(actual, expected)
    if math.abs(actual - expected) > 1e-6 then
        error('\n    expected ~' .. expected .. ', got ' .. tostring(actual), 2)
    end
end

local world
local function MockFrame()
    local f = { scripts = {}, events = {} }
    setmetatable(f, { __index = function() return function() return MockFrame() end end })
    rawset(f, 'SetScript', function(self, k, fn) rawset(self.scripts, k, fn) end)
    rawset(f, 'GetScript', function(self, k) return self.scripts[k] end)
    rawset(f, 'RegisterEvent', function(self, e) self.events[e] = true end)
    rawset(f, 'UnregisterEvent', function(self, e) self.events[e] = nil end)
    return f
end

-- opts.raid: array of { name, subgroup, dead, buffs = {names…} }, index = raid index.
local function BuildWorld(opts)
    opts = opts or {}
    world = { time = 0, raid = opts.raid or {}, tracking = opts.tracking,
              frames = {}, messages = {} }
    _G.RaidAssignDB = nil
    _G.DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) world.messages[#world.messages + 1] = m end }
    _G.UIParent = MockFrame()
    _G.CreateFrame = function() local f = MockFrame(); world.frames[#world.frames + 1] = f; return f end
    _G.GetTime = function() return world.time end
    _G.date = function() return '2026-08-15 21:00' end
    _G.IsInRaid = function() return #world.raid > 0 end
    _G.GetNumGroupMembers = function() return #world.raid end
    _G.GetRaidRosterInfo = function(i)
        local m = world.raid[i]
        if m then return m.name, nil, m.subgroup end
    end
    _G.UnitIsDeadOrGhost = function(unit)
        local m = world.raid[tonumber(unit:match('^raid(%d+)$') or 0)]
        return (m and m.dead) or false
    end
    _G.UnitAura = function(unit, j)
        local m = world.raid[tonumber(unit:match('^raid(%d+)$') or 0)]
        return m and m.buffs and m.buffs[j] or nil
    end
    _G.CombatLogGetCurrentEventInfo = function() return unpack(world.cleu) end
    _G.RaidAssignAPI = { GetTracking = function() return world.tracking end }
    dofile('RaidAssign/Track.lua')
    world.tracker = world.frames[1]
end

local function Fire(event, ...)
    world.tracker.scripts.OnEvent(world.tracker, event, ...)
end
local function Cleu(sub, srcName, destGUID, spellName)
    world.cleu = { 0, sub, false, 'Player-1-AAAA', srcName, 0, 0,
                   destGUID, 'Boss', 0, 0, 12345, spellName, 0, 'DEBUFF' }
    Fire('COMBAT_LOG_EVENT_UNFILTERED')
end
local function Tick(dt)
    world.time = world.time + dt
    local h = world.tracker.scripts.OnUpdate
    if h then h(world.tracker, dt) end
end

local COE = { id = 'coe', name = 'Curse of Elements', auras = 'Curse of the Elements', player = 'Zug' }

test('debuff uptime accumulates with assignee attribution', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1-1-1-19044-000', 'Curse of the Elements')
    world.time = 50
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1-1-1-19044-000', 'Curse of the Elements')
    world.time = 60
    Cleu('SPELL_AURA_APPLIED', 'Mag', 'Creature-0-1-1-1-19044-000', 'Curse of the Elements')
    world.time = 100
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    local p = RaidAssignDB.pulls[1]
    assertEqual(p.encounter, 'Gruul')
    assertEqual(p.ordinal, 1)
    assertEqual(p.success, true)
    assertClose(p.duration, 100)
    assertClose(p.debuffs[1].uptime, 90)     -- 0..50 by Zug, 60..100 by Mag
    assertClose(p.debuffs[1].byAssignee, 50)
end)

test('refresh reattributes the running segment', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 30
    Cleu('SPELL_AURA_REFRESH', 'Mag', 'Creature-0-1', 'Curse of the Elements')
    world.time = 50
    Cleu('SPELL_AURA_REMOVED', 'Mag', 'Creature-0-1', 'Curse of the Elements')
    world.time = 50
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 0)
    local r = RaidAssignDB.pulls[1].debuffs[1]
    assertClose(r.uptime, 50)
    assertClose(r.byAssignee, 30)
    assertEqual(RaidAssignDB.pulls[1].success, false)
end)

test('fight end closes an open segment', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 80
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertClose(RaidAssignDB.pulls[1].debuffs[1].uptime, 80)
end)

test('multi-target: the dest with the most uptime is reported', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 623, 'Vashj', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-BOSS', 'Curse of the Elements')
    world.time = 10
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-ADD', 'Curse of the Elements')
    world.time = 15
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-ADD', 'Curse of the Elements')
    world.time = 90
    Fire('ENCOUNTER_END', 623, 'Vashj', 173, 25, 0)
    assertClose(RaidAssignDB.pulls[1].debuffs[1].uptime, 90) -- boss 0..90, not the add's 5
end)

test('friendly/player dest GUIDs are ignored', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Player-1-BBBB', 'Curse of the Elements')
    world.time = 90
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertClose(RaidAssignDB.pulls[1].debuffs[1].uptime, 0)
end)

test('no tracking payload: nothing recorded', function()
    BuildWorld({ raid = {}, tracking = nil })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    world.time = 100
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertEqual(RaidAssignDB and RaidAssignDB.pulls and #RaidAssignDB.pulls or 0, 0)
    assertEqual(RaidAssignAPI.TrackLive(), nil)
end)

test('pull cap keeps the newest 20', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    for i = 1, 21 do
        Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
        world.time = world.time + 60
        Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 0)
    end
    assertEqual(#RaidAssignDB.pulls, 20)
    assertEqual(RaidAssignDB.pulls[20].ordinal, 21)
    assertEqual(RaidAssignDB.pulls[1].ordinal, 2)
end)

test('absent assignee is flagged, not accused', function()
    BuildWorld({ raid = { { name = 'SomeoneElse', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    world.time = 10
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 0)
    assertEqual(RaidAssignDB.pulls[1].debuffs[1].absent, true)
end)

test('TrackLive reports pct and down-time mid-fight', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 50
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 60
    local rows = RaidAssignAPI.TrackLive()
    assertEqual(rows[1].name, 'Curse of Elements')
    assertClose(rows[1].pct, 50 / 60)
    assertClose(rows[1].down, 10)
end)

test('LastPullInfo headline counts sub-90% rows', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 40
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 100
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertEqual(RaidAssignAPI.LastPullInfo(), 'Gruul #1 — 1 of 1 below 90%')
end)

print(string.format('\n%d passed, %d failed', passed, failed))
if failed > 0 then os.exit(1) end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-track.test.lua`
Expected: FAIL at `dofile` — `RaidAssign/Track.lua` does not exist.

- [ ] **Step 3: Implement `RaidAssign/Track.lua`**

```lua
-- Track.lua: scores a boss pull against the loaded tracking payload (RSW3 @T lines).
-- Boss debuffs come from the combat log with source attribution; group buffs (this
-- file, Task 5) from periodic UnitAura scans. Results land in RaidAssignDB.pulls,
-- newest last, capped. Talks to the rest of the addon only through RaidAssignAPI:
-- if RaidAssign.lua failed to load, GetTracking is nil and this file stays inert.

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99[RaidAssign]|r " .. msg)
end

local PULL_CAP = 20
local active = nil      -- current pull state, nil outside encounters
local counters = {}     -- encounter name -> pull ordinal this session

local function AuraSet(csv)
    local set = {}
    for name in csv:gmatch("[^,]+") do set[name] = true end
    return set
end

local function ShortName(s) return s and (s:match("^([^-]+)") or s) or "" end

local function RaidShortNames()
    local set = {}
    if IsInRaid() then
        for i = 1, GetNumGroupMembers() do
            local full = GetRaidRosterInfo(i)
            if full then set[ShortName(full):lower()] = true end
        end
    end
    return set
end

-- Intervals accumulate per destGUID: multi-mob fights apply the same aura to several
-- units, and the report keeps the dest with the most uptime (the boss, in practice).
local function DestState(d, guid)
    local s = d.dests[guid]
    if not s then
        s = { uptime = 0, mine = 0, since = nil, sinceMine = false, lastDrop = nil }
        d.dests[guid] = s
    end
    return s
end

local function CloseSegment(s, now)
    if s.since then
        s.uptime = s.uptime + (now - s.since)
        if s.sinceMine then s.mine = s.mine + (now - s.since) end
        s.since = nil
    end
end

local function PrimaryDest(d)
    local best
    for _, s in pairs(d.dests) do
        if not best or s.uptime > best.uptime then best = s end
    end
    return best
end

local function OnAura(sub, sourceShort, destGUID, spellName, now)
    for _, d in ipairs(active.debuffs) do
        if d.set[spellName] then
            local s = DestState(d, destGUID)
            if sub == "SPELL_AURA_REMOVED" then
                CloseSegment(s, now)
                s.lastDrop = now
            else
                -- APPLIED / REFRESH / APPLIED_DOSE: (re)start a segment attributed to
                -- this source, so a refresh by someone else stops crediting the assignee.
                CloseSegment(s, now)
                s.since = now
                s.sinceMine = (sourceShort == d.player)
            end
        end
    end
end

local f = CreateFrame("Frame")
f:RegisterEvent("ENCOUNTER_START")
f:RegisterEvent("ENCOUNTER_END")

local function StartPull(encounterID, name)
    local tracking = RaidAssignAPI and RaidAssignAPI.GetTracking and RaidAssignAPI.GetTracking()
    if not tracking then return end
    counters[name] = (counters[name] or 0) + 1
    local inRaid = RaidShortNames()
    active = { encounterID = encounterID, encounter = name, ordinal = counters[name],
               startedAt = GetTime(), debuffs = {}, buffs = {}, scanElapsed = 0 }
    for _, t in ipairs(tracking.debuffs or {}) do
        table.insert(active.debuffs, { id = t.id, name = t.name, set = AuraSet(t.auras),
            player = t.player, noattrib = t.noattrib, dests = {},
            absent = (not inRaid[(t.player or ""):lower()]) or nil })
    end
    -- Task 5 seeds active.buffs and starts the scan ticker here.
    f:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
end

local function EndPull(success)
    local now = GetTime()
    local rec = { encounter = active.encounter, encounterID = active.encounterID,
                  ordinal = active.ordinal, success = (success == 1),
                  duration = now - active.startedAt, when = date("%Y-%m-%d %H:%M"),
                  debuffs = {}, buffs = {} }
    for _, d in ipairs(active.debuffs) do
        for _, s in pairs(d.dests) do CloseSegment(s, now) end
        local s = PrimaryDest(d) or { uptime = 0, mine = 0 }
        table.insert(rec.debuffs, { id = d.id, name = d.name, player = d.player,
            noattrib = d.noattrib, absent = d.absent,
            uptime = s.uptime, byAssignee = s.mine })
    end
    -- Task 5 appends buff records here.
    RaidAssignDB = RaidAssignDB or {}
    RaidAssignDB.pulls = RaidAssignDB.pulls or {}
    table.insert(RaidAssignDB.pulls, rec)
    while #RaidAssignDB.pulls > PULL_CAP do table.remove(RaidAssignDB.pulls, 1) end
    active = nil
    f:UnregisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
    Print(rec.encounter .. " pull " .. rec.ordinal .. " recorded — /racheck for the scoreboard.")
end

f:SetScript("OnEvent", function(_, event, ...)
    if event == "ENCOUNTER_START" then
        local id, name = ...
        StartPull(id, name)
    elseif event == "ENCOUNTER_END" and active then
        local _, _, _, _, success = ...
        EndPull(success)
    elseif event == "COMBAT_LOG_EVENT_UNFILTERED" and active then
        local _, sub, _, _, sourceName, _, _, destGUID, _, _, _, _, spellName, _, auraType =
            CombatLogGetCurrentEventInfo()
        -- Only hostile NPC targets: the same aura names can exist on players (PvP trinkets
        -- aside, a mind-controlled raider taking Faerie Fire must not count).
        if auraType == "DEBUFF" and destGUID
           and (destGUID:find("^Creature") or destGUID:find("^Vehicle"))
           and (sub == "SPELL_AURA_APPLIED" or sub == "SPELL_AURA_REFRESH"
                or sub == "SPELL_AURA_APPLIED_DOSE" or sub == "SPELL_AURA_REMOVED") then
            OnAura(sub, ShortName(sourceName), destGUID, spellName, GetTime())
        end
    end
end)

RaidAssignAPI = RaidAssignAPI or {}

-- Live rows for the in-fight view; nil outside an encounter (TrackUI hides on nil).
RaidAssignAPI.TrackLive = function()
    if not active then return nil end
    local now = GetTime()
    local elapsed = now - active.startedAt
    if elapsed <= 0 then elapsed = 0.001 end
    local rows = {}
    for _, d in ipairs(active.debuffs) do
        local s = PrimaryDest(d)
        local up = s and (s.uptime + (s.since and (now - s.since) or 0)) or 0
        local down
        if not (s and s.since) then
            down = now - ((s and s.lastDrop) or active.startedAt)
        end
        table.insert(rows, { kind = "D", name = d.name, pct = up / elapsed, down = down })
    end
    -- Task 5 appends kind="B" rows.
    return rows
end

RaidAssignAPI.Pulls = function()
    return (RaidAssignDB and RaidAssignDB.pulls) or {}
end

RaidAssignAPI.LastPullInfo = function()
    local pulls = (RaidAssignDB and RaidAssignDB.pulls) or {}
    local p = pulls[#pulls]
    if not p then return nil end
    local low, total = 0, 0
    for _, r in ipairs(p.debuffs) do
        total = total + 1
        if p.duration <= 0 or r.uptime / p.duration < 0.9 then low = low + 1 end
    end
    for _, r in ipairs(p.buffs or {}) do
        total = total + 1
        if (r.fraction or 0) < 0.9 then low = low + 1 end
    end
    return p.encounter .. " #" .. p.ordinal .. " — " .. low .. " of " .. total .. " below 90%"
end
```

Add `Track.lua` to `RaidAssign/RaidAssign.toc` after `RaidAssign.lua` (order matters: it extends `RaidAssignAPI`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-track.test.lua` and `luajit raid-assign.test.lua`
Expected: all PASS. (raid-assign tests don't load Track.lua; run them anyway to prove no global bled.)

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/Track.lua RaidAssign/RaidAssign.toc raid-track.test.lua
git commit -m "feat: Track.lua — boss-debuff uptime with assignee attribution, per-pull storage"
```

---

### Task 5: `Track.lua` — group-buff scanning

**Files:**
- Modify: `RaidAssign/Track.lua`
- Test: `raid-track.test.lua`

**Interfaces:**
- Consumes: `tracking.buffs` rows (Task 3 shape); `world.raid[i].buffs` arrays in the test harness.
- Produces: pull records gain `buffs = { {id, name, group, provider, fraction} … }` where `fraction` is the mean, over group members who were alive at least once, of (buffed sample time / alive sample time). `TrackLive()` gains `{ kind='B', name='Windfury Totem (G3)', have, total, pct }` rows.

- [ ] **Step 1: Write the failing tests**

Append to `raid-track.test.lua` (above the summary print):

```lua
local WF = { id = 'wf', name = 'Windfury Totem', auras = 'Windfury Totem', group = 1, provider = 'Sham' }

test('group buff fraction is the mean of member uptimes', function()
    BuildWorld({ raid = {
        { name = 'A', subgroup = 1, buffs = { 'Windfury Totem' } },
        { name = 'B', subgroup = 1, buffs = {} },
        { name = 'C', subgroup = 2, buffs = { 'Windfury Totem' } }, -- wrong group: ignored
    }, tracking = { debuffs = {}, buffs = { WF } } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    for _ = 1, 10 do Tick(1.0) end
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    local b = RaidAssignDB.pulls[1].buffs[1]
    assertEqual(b.id, 'wf')
    assertEqual(b.group, 1)
    assertClose(b.fraction, 0.5) -- A 100%, B 0%
end)

test('dead members do not count against the buff', function()
    BuildWorld({ raid = {
        { name = 'A', subgroup = 1, buffs = { 'Windfury Totem' } },
        { name = 'B', subgroup = 1, buffs = {}, dead = true },
    }, tracking = { debuffs = {}, buffs = { WF } } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    for _ = 1, 5 do Tick(1.0) end
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertClose(RaidAssignDB.pulls[1].buffs[1].fraction, 1.0) -- B never alive, excluded
end)

test('aura name variants match', function()
    BuildWorld({ raid = { { name = 'A', subgroup = 1, buffs = { 'Strength of Earth Totem' } } },
                 tracking = { debuffs = {}, buffs = {
                     { id = 'soe', name = 'Strength of Earth',
                       auras = 'Strength of Earth,Strength of Earth Totem', group = 1, provider = 'S' } } } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    for _ = 1, 4 do Tick(1.0) end
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    assertClose(RaidAssignDB.pulls[1].buffs[1].fraction, 1.0)
end)

test('TrackLive shows current buffed count per group', function()
    BuildWorld({ raid = {
        { name = 'A', subgroup = 1, buffs = { 'Windfury Totem' } },
        { name = 'B', subgroup = 1, buffs = {} },
    }, tracking = { debuffs = {}, buffs = { WF } } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Tick(1.0)
    local rows = RaidAssignAPI.TrackLive()
    assertEqual(rows[1].kind, 'B')
    assertEqual(rows[1].name, 'Windfury Totem (G1)')
    assertEqual(rows[1].have, 1)
    assertEqual(rows[1].total, 2)
end)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-track.test.lua`
Expected: the four new tests FAIL (`buffs[1]` nil / no OnUpdate handler).

- [ ] **Step 3: Implement**

In `Track.lua`:

1. Above `StartPull`, add the scanner:

```lua
local SCAN_INTERVAL = 1.0

local function UnitHasAny(unit, set)
    for j = 1, 40 do
        local name = UnitAura(unit, j, "HELPFUL")
        if not name then return false end
        if set[name] then return true end
    end
    return false
end

-- Sampling, not events: totem auras flicker on range and UNIT_AURA fires constantly in
-- a raid. One pass per second over 25 units is cheap and the error is bounded by the
-- sample step. Dead time is excluded per member; a member never sampled alive drops out.
local function ScanTick(_, dt)
    if not active then return end
    active.scanElapsed = active.scanElapsed + dt
    if active.scanElapsed < SCAN_INTERVAL then return end
    local step = active.scanElapsed
    active.scanElapsed = 0
    for i = 1, GetNumGroupMembers() do
        local full, _, subgroup = GetRaidRosterInfo(i)
        if full and subgroup then
            local unit = "raid" .. i
            if not UnitIsDeadOrGhost(unit) then
                for _, b in ipairs(active.buffs) do
                    if b.group == subgroup then
                        local m = b.members[full] or { alive = 0, buffed = 0 }
                        b.members[full] = m
                        m.alive = m.alive + step
                        if UnitHasAny(unit, b.set) then m.buffed = m.buffed + step end
                    end
                end
            end
        end
    end
end
```

2. In `StartPull`, replace the Task-5 placeholder comment with:

```lua
    for _, t in ipairs(tracking.buffs or {}) do
        table.insert(active.buffs, { id = t.id, name = t.name, set = AuraSet(t.auras),
            group = t.group, provider = t.provider, members = {} })
    end
    if #active.buffs > 0 then f:SetScript("OnUpdate", ScanTick) end
```

3. In `EndPull`, replace the Task-5 placeholder comment with:

```lua
    for _, b in ipairs(active.buffs) do
        local sum, n = 0, 0
        for _, m in pairs(b.members) do
            if m.alive > 0 then sum = sum + m.buffed / m.alive; n = n + 1 end
        end
        table.insert(rec.buffs, { id = b.id, name = b.name, group = b.group,
            provider = b.provider, fraction = (n > 0) and (sum / n) or 0 })
    end
```

and add `f:SetScript("OnUpdate", nil)` next to the `UnregisterEvent` line.

4. In `TrackLive`, replace the Task-5 placeholder comment with:

```lua
    for _, b in ipairs(active.buffs) do
        local have, total = 0, 0
        for i = 1, GetNumGroupMembers() do
            local full, _, subgroup = GetRaidRosterInfo(i)
            if full and subgroup == b.group then
                local unit = "raid" .. i
                if not UnitIsDeadOrGhost(unit) then
                    total = total + 1
                    if UnitHasAny(unit, b.set) then have = have + 1 end
                end
            end
        end
        table.insert(rows, { kind = "B", name = b.name .. " (G" .. b.group .. ")",
            have = have, total = total, pct = (total > 0) and (have / total) or 0 })
    end
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-track.test.lua`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/Track.lua raid-track.test.lua
git commit -m "feat: group-buff (totem) uptime scanning per group, dead time excluded"
```

---

### Task 6: `TrackUI.lua` — live view

**Files:**
- Create: `RaidAssign/TrackUI.lua`
- Modify: `RaidAssign/RaidAssign.toc` (add `TrackUI.lua` after `Track.lua`)
- Test: `raid-track.test.lua`

**Interfaces:**
- Consumes: `RaidAssignAPI.TrackLive()` (Tasks 4–5 shape).
- Produces: `RaidAssignLiveFrame` (global frame name), shown during encounters unless `RaidAssignDB.liveView == false`. Task 7 adds the `/racheck live` toggle.

- [ ] **Step 1: Write the failing tests**

The live view is mostly rendering; test the behavior that matters — shows on encounter start, hides on end, honors the toggle, row text. Append to `raid-track.test.lua`. The harness must now also `dofile('RaidAssign/TrackUI.lua')` — add it at the END of `BuildWorld` (after Track.lua), and give MockFrame the fontstring-ish members TrackUI needs (`CreateFontString` already works via the metatable: it returns a MockFrame whose `SetText`/`GetText` need to exist — extend MockFrame with `text` handling copied from raid-assign.test.lua's MockFrame: `SetText`, `GetText`, `Show`, `Hide`, `IsShown`).

```lua
test('live view appears on pull, rows render, hides on end', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 50
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 60
    -- TrackUI refreshes on its own OnUpdate: tick every frame's handlers
    for _, fr in ipairs(world.frames) do
        local h = fr.scripts.OnUpdate
        if h then h(fr, 1.0) end
    end
    assertEqual(RaidAssignLiveFrame:IsShown(), true)
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'Curse of Elements')
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), '83%%')      -- 50/60
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'down 10s')
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    for _, fr in ipairs(world.frames) do
        local h = fr.scripts.OnUpdate
        if h then h(fr, 1.0) end
    end
    assertEqual(RaidAssignLiveFrame:IsShown(), false)
end)

test('liveView=false keeps the frame hidden', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RaidAssignDB = { liveView = false }
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    for _, fr in ipairs(world.frames) do
        local h = fr.scripts.OnUpdate
        if h then h(fr, 1.0) end
    end
    assertEqual(RaidAssignLiveFrame:IsShown(), false)
end)
```

Note: MockFrame in this file starts `shown = false`? raid-assign.test.lua's starts `shown = true` — TrackUI must call `fr:Hide()` at build time, so the assertions hold either way; keep MockFrame's default `shown = true` to force TrackUI to hide explicitly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-track.test.lua`
Expected: FAIL — `RaidAssign/TrackUI.lua` missing (dofile error) once BuildWorld is updated; fix harness first, then the two tests fail on nil `RaidAssignLiveFrame`.

- [ ] **Step 3: Implement `RaidAssign/TrackUI.lua`** (live-view half; Task 7 adds the scoreboard in this same file)

```lua
-- TrackUI.lua: the human-facing half of Track.lua — a live in-fight list (this task)
-- and the /racheck scoreboard with selective whispers (Task 7). Reads RaidAssignAPI only.

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99[RaidAssign]|r " .. msg)
end

local ROWS_MAX = 14
local REFRESH = 0.5

local function Pct(x) return string.format("%d%%", math.floor(x * 100 + 0.5)) end

local function RowColor(pct)
    if pct >= 0.9 then return "|cFF55FF55" end
    if pct >= 0.7 then return "|cFFFFDD55" end
    return "|cFFFF6B6B"
end

local live = CreateFrame("Frame", "RaidAssignLiveFrame", UIParent, "BackdropTemplate")
live:SetSize(280, 24 + ROWS_MAX * 14)
live:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 } })
live:SetMovable(true)
live:EnableMouse(true)
live:RegisterForDrag("LeftButton")
live:SetScript("OnDragStart", live.StartMoving)
live:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, _, x, y = self:GetPoint()
    RaidAssignDB = RaidAssignDB or {}
    RaidAssignDB.livePos = { point = point, x = x, y = y }
end)

live.title = live:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
live.title:SetPoint("TOPLEFT", 10, -8)
live.title:SetText("Assignments")

live.rows = {}
for i = 1, ROWS_MAX do
    local r = live:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    r:SetPoint("TOPLEFT", 10, -(22 + (i - 1) * 14))
    r:SetJustifyH("LEFT")
    live.rows[i] = r
end

local elapsed = 0
live:SetScript("OnUpdate", function(self, dt)
    elapsed = elapsed + dt
    if elapsed < REFRESH then return end
    elapsed = 0
    local rows = RaidAssignAPI.TrackLive and RaidAssignAPI.TrackLive()
    if not rows or (RaidAssignDB and RaidAssignDB.liveView == false) then
        if self:IsShown() then self:Hide() end
        return
    end
    if not self:IsShown() then self:Show() end
    for i = 1, ROWS_MAX do
        local d = rows[i]
        if not d then
            self.rows[i]:SetText("")
        elseif d.kind == "D" then
            local txt = RowColor(d.pct) .. d.name .. "  " .. Pct(d.pct) .. "|r"
            if d.down then
                txt = txt .. " |cFFFF6B6B down " .. math.floor(d.down + 0.5) .. "s|r"
            end
            self.rows[i]:SetText(txt)
        else
            self.rows[i]:SetText(RowColor(d.pct) .. d.name .. "  " .. d.have .. "/" .. d.total .. "|r")
        end
    end
end)

-- Never visible at login; the OnUpdate poll shows it when a tracked pull is running.
-- Restoring the dragged position must wait for SavedVariables, hence PLAYER_LOGIN.
live:Hide()
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", function()
    local p = RaidAssignDB and RaidAssignDB.livePos
    if p then live:ClearAllPoints(); live:SetPoint(p.point, UIParent, p.point, p.x, p.y)
    else live:SetPoint("LEFT", UIParent, "LEFT", 30, 0) end
end)
```

Add `TrackUI.lua` to the TOC after `Track.lua`. A hidden frame's `OnUpdate` does not run in the real client — but the poll is also the show trigger, so showing must not depend on it: change the hide/show to event-driven. **Correction, do it this way:** register `ENCOUNTER_START`/`ENCOUNTER_END` on `loader` too; on START `live:Show()` (the poll then self-hides if `TrackLive()` is nil or the toggle is off), on END `live:Hide()`. Keep the poll's nil-check as a safety net. The tests in Step 1 pass either way because mocks run OnUpdate regardless — the event registration is for the real client; add it before running the tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-track.test.lua` and `luajit raid-assign.test.lua`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/TrackUI.lua RaidAssign/RaidAssign.toc raid-track.test.lua
git commit -m "feat: live in-fight compliance view — uptime and down-time per assignment"
```

---

### Task 7: `TrackUI.lua` — `/racheck` scoreboard and selective whispers

**Files:**
- Modify: `RaidAssign/TrackUI.lua`
- Test: `raid-track.test.lua`

**Interfaces:**
- Consumes: `RaidAssignAPI.Pulls()`, `RaidAssignAPI.SendRaw(entries)` (needs `RaidAssignAPI` from RaidAssign.lua loaded — in tests, stub `SendRaw` in `BuildWorld` and capture calls).
- Produces: `SLASH_RACHECK1 = "/racheck"`; global frame `RaidAssignCheckFrame` with `rows` (each row: `check` CheckButton, `label` FontString, `entry` = the pull record row), `prevBtn`, `nextBtn`, `whisperBtn`, `postBtn`, `closeBtn`, `title`. `/racheck live` toggles `RaidAssignDB.liveView`.

- [ ] **Step 1: Write the failing tests**

Extend the harness: `BuildWorld` stubs `_G.SlashCmdList = {}` (Track/TrackUI need it now), `_G.SendChatMessage = function(msg, chan) world.sent[#world.sent+1] = chan .. ':' .. msg end` with `world.sent = {}`, and a capturing `SendRaw`:

```lua
    world.raw = {}
    _G.RaidAssignAPI = {
        GetTracking = function() return world.tracking end,
        SendRaw = function(entries) world.raw[#world.raw + 1] = entries; return true, #entries, {} end,
    }
```

MockFrame needs `Click` (copy from raid-assign.test.lua) and CheckButton semantics: `SetChecked/GetChecked` —

```lua
    rawset(f, 'SetChecked', function(self, v) self.checked = v end)
    rawset(f, 'GetChecked', function(self) return self.checked end)
```

Then:

```lua
local function RecordPull(uptimeSecs)
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = world.time + uptimeSecs
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = world.time + (100 - uptimeSecs)
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 0)
end

test('/racheck renders the latest pull with uptime and assignee share', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    SlashCmdList['RACHECK']('')
    assertEqual(RaidAssignCheckFrame:IsShown(), true)
    assertMatch(RaidAssignCheckFrame.title:GetText(), 'Gruul #1')
    local row = RaidAssignCheckFrame.rows[1]
    assertMatch(row.label:GetText(), 'Curse of Elements')
    assertMatch(row.label:GetText(), '41%%')
    assertMatch(row.label:GetText(), 'Zug')
end)

test('whisper selected sends through SendRaw with a factual body', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    SlashCmdList['RACHECK']('')
    RaidAssignCheckFrame.rows[1].check:SetChecked(true)
    RaidAssignCheckFrame.whisperBtn:Click()
    assertEqual(#world.raw, 1)
    assertEqual(world.raw[1][1].name, 'Zug')
    assertMatch(world.raw[1][1].body, 'Gruul pull 1')
    assertMatch(world.raw[1][1].body, 'Curse of Elements up 41%%')
end)

test('nothing selected: whisper button sends nothing', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    SlashCmdList['RACHECK']('')
    RaidAssignCheckFrame.whisperBtn:Click()
    assertEqual(#world.raw, 0)
end)

test('prev/next walk stored pulls', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    RecordPull(95)
    SlashCmdList['RACHECK']('')
    assertMatch(RaidAssignCheckFrame.title:GetText(), '#2')
    RaidAssignCheckFrame.prevBtn:Click()
    assertMatch(RaidAssignCheckFrame.title:GetText(), '#1')
    RaidAssignCheckFrame.nextBtn:Click()
    assertMatch(RaidAssignCheckFrame.title:GetText(), '#2')
end)

test('/racheck with no pulls explains itself', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    SlashCmdList['RACHECK']('')
    assertMatch(world.messages[#world.messages], 'No pulls recorded')
end)

test('/racheck live toggles the live view', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    SlashCmdList['RACHECK']('live')
    assertEqual(RaidAssignDB.liveView, false)
    SlashCmdList['RACHECK']('live')
    assertEqual(RaidAssignDB.liveView, true)
end)

test('post summary goes to raid chat on click only', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    assertEqual(#world.sent, 0)
    SlashCmdList['RACHECK']('')
    RaidAssignCheckFrame.postBtn:Click()
    assertEqual(world.sent[1] ~= nil, true)
    assertMatch(world.sent[1], 'RAID:')
    assertMatch(world.sent[1], 'Curse of Elements 41%%')
end)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-track.test.lua`
Expected: new tests FAIL (`SlashCmdList['RACHECK']` nil).

- [ ] **Step 3: Implement** — append to `TrackUI.lua`:

```lua
-- === /racheck scoreboard =====================================================
local CHECK_ROWS = 20
local view          -- built lazily
local viewIndex     -- 1-based index into RaidAssignAPI.Pulls()

local function PullRows(p)
    -- Flatten a pull record into display rows. `who` is whoever a whisper would go to.
    local rows = {}
    for _, r in ipairs(p.debuffs) do
        local pct = (p.duration > 0) and (r.uptime / p.duration) or 0
        local share = (r.uptime > 0) and (r.byAssignee / r.uptime) or 0
        local label = RowColor(pct) .. r.name .. "  " .. Pct(pct) .. "|r  — " .. (r.player or "?")
        if r.absent then
            label = label .. " |cFF999999(not in raid)|r"
        elseif not r.noattrib then
            label = label .. "  |cFF999999" .. Pct(share) .. " by them|r"
        end
        table.insert(rows, { label = label, who = (not r.absent) and r.player or nil,
            body = string.format("%s pull %d: %s up %s — assigned to you",
                p.encounter, p.ordinal, r.name, Pct(pct)),
            summary = r.name .. " " .. Pct(pct), pct = pct })
    end
    for _, b in ipairs(p.buffs or {}) do
        local pct = b.fraction or 0
        table.insert(rows, { label = RowColor(pct) .. b.name .. " (G" .. b.group .. ")  "
                .. Pct(pct) .. "|r  — " .. (b.provider or "?"),
            who = b.provider,
            body = string.format("%s pull %d: %s in group %d up %s — your totem/shout",
                p.encounter, p.ordinal, b.name, b.group, Pct(pct)),
            summary = b.name .. " G" .. b.group .. " " .. Pct(pct), pct = pct })
    end
    return rows
end

local function Render()
    local pulls = RaidAssignAPI.Pulls()
    local p = pulls[viewIndex]
    if not p then view:Hide() return end
    view.title:SetText(string.format("%s #%d — %s — %d:%02d",
        p.encounter, p.ordinal, p.success and "kill" or "wipe",
        math.floor(p.duration / 60), math.floor(p.duration % 60)))
    local rows = PullRows(p)
    for i = 1, CHECK_ROWS do
        local w, r = view.rows[i], rows[i]
        if r then
            w.label:SetText(r.label)
            w.entry = r
            w.check:SetChecked(false)
            if r.who then w.check:Show() else w.check:Hide() end
            w.label:Show()
        else
            w.entry = nil
            w.check:Hide()
            w.label:Hide()
        end
    end
    if view.prevBtn then
        if viewIndex > 1 then view.prevBtn:Enable() else view.prevBtn:Disable() end
        if viewIndex < #pulls then view.nextBtn:Enable() else view.nextBtn:Disable() end
    end
end

local function BuildView()
    local f = CreateFrame("Frame", "RaidAssignCheckFrame", UIParent, "BackdropTemplate")
    f:SetSize(520, 90 + CHECK_ROWS * 18)
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

    f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    f.title:SetPoint("TOP", 0, -18)

    f.rows = {}
    for i = 1, CHECK_ROWS do
        local row = {}
        row.check = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
        row.check:SetSize(18, 18)
        row.check:SetPoint("TOPLEFT", 20, -(40 + (i - 1) * 18))
        row.label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        row.label:SetPoint("TOPLEFT", 44, -(42 + (i - 1) * 18))
        row.label:SetJustifyH("LEFT")
        f.rows[i] = row
    end

    local function Button(label, width, x)
        local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        b:SetSize(width, 22)
        b:SetPoint("BOTTOMLEFT", x, 14)
        b:SetText(label)
        return b
    end
    f.prevBtn = Button("◀", 34, 20)
    f.prevBtn:SetScript("OnClick", function() viewIndex = viewIndex - 1; Render() end)
    f.nextBtn = Button("▶", 34, 58)
    f.nextBtn:SetScript("OnClick", function() viewIndex = viewIndex + 1; Render() end)
    f.whisperBtn = Button("Whisper selected", 130, 100)
    f.whisperBtn:SetScript("OnClick", function()
        local entries = {}
        for i = 1, CHECK_ROWS do
            local w = f.rows[i]
            if w.entry and w.entry.who and w.check:GetChecked() then
                table.insert(entries, { name = w.entry.who, body = w.entry.body })
            end
        end
        if #entries == 0 then Print("Nothing selected.") return end
        local ok, countOrReason = RaidAssignAPI.SendRaw(entries)
        if ok then Print("Whispering " .. countOrReason .. " player(s).")
        else Print(countOrReason) end
    end)
    f.postBtn = Button("Post summary", 110, 238)
    f.postBtn:SetScript("OnClick", function()
        local p = RaidAssignAPI.Pulls()[viewIndex]
        if not p then return end
        -- One header plus the sub-90% offenders; a full dump of green rows is noise.
        SendChatMessage(string.format("%s pull %d (%s):", p.encounter, p.ordinal,
            p.success and "kill" or "wipe"), "RAID")
        for _, r in ipairs(PullRows(p)) do
            if r.pct < 0.9 then SendChatMessage(r.summary, "RAID") end
        end
    end)
    f.closeBtn = Button("Close", 70, 430)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)
    return f
end

SLASH_RACHECK1 = "/racheck"
SlashCmdList["RACHECK"] = function(msg)
    local arg = (msg or ""):match("^%s*(%S*)"):lower()
    if arg == "live" then
        RaidAssignDB = RaidAssignDB or {}
        RaidAssignDB.liveView = (RaidAssignDB.liveView == false)
        Print("Live view " .. (RaidAssignDB.liveView ~= false and "on" or "off") .. ".")
        return
    end
    local pulls = RaidAssignAPI.Pulls()
    if #pulls == 0 then
        Print("No pulls recorded yet — load an RSW3 payload from the web tool, then pull a boss.")
        return
    end
    viewIndex = #pulls
    if not view then view = BuildView() end
    Render()
    view:Show()
end
```

Note on the post-summary test: the header line goes out first, so `world.sent[1]` is the header — the test asserts `world.sent[1]` exists and a CoE line exists; adjust the assertions to search `world.sent` for the CoE line rather than fixing its index if this bites. `Pct` renders 41/100 as `41%`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-track.test.lua` and `luajit raid-assign.test.lua`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/TrackUI.lua raid-track.test.lua
git commit -m "feat: /racheck scoreboard — per-pull uptimes, selective whispers, manual raid summary"
```

---

### Task 8: Minimap hub

**Files:**
- Modify: `RaidAssign/Minimap.lua`
- Test: `raid-assign.test.lua` (this file's BuildWorld dofiles Minimap.lua — grep for existing menu tests and update)

**Interfaces:**
- Consumes: `SlashCmdList["RAIDSPECSCAN"|"RAIDASSIGN"|"RACHECK"]`, `RaidAssignAPI.ApplyGroups/LayoutInfo/LastPullInfo`.
- Produces: global `RaidAssignMinimapHub` frame replacing `RaidAssignMinimapMenu` — title, two status lines, four `UIPanelButtonTemplate` buttons (Scan raid / Assignments… / Apply groups / Check results). Click toggles it; clicking any action hides it.

- [ ] **Step 1: Update/write the failing tests**

Run `grep -n "MinimapMenu\|MinimapButton" raid-assign.test.lua` first. Update existing menu assertions to the hub shape, and add:

```lua
test('minimap hub: four actions, status lines refresh on open', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    RaidAssignDB = { pulls = { { encounter = 'Gruul', ordinal = 3, duration = 100, success = false,
        debuffs = { { id = 'coe', name = 'Curse of Elements', player = 'Zug', uptime = 41, byAssignee = 41 } },
        buffs = {} } } }
    RaidAssignMinimapButton.scripts.OnClick(RaidAssignMinimapButton)
    assertEqual(RaidAssignMinimapHub:IsShown(), true)
    assertEqual(#RaidAssignMinimapHub.items, 4)
    assertEqual(RaidAssignMinimapHub.items[4].label:GetText(), 'Check results')
    assertMatch(RaidAssignMinimapHub.status2:GetText(), 'Gruul #3')
    -- clicking an action hides the hub
    RaidAssignMinimapHub.items[4]:Click()
    assertEqual(RaidAssignMinimapHub:IsShown(), false)
end)
```

Caveat: in this test file `RaidAssignAPI.LastPullInfo` comes from the real Track.lua only if BuildWorld dofiles it — it does not. Either have `Minimap.lua` guard (`RaidAssignAPI.LastPullInfo and RaidAssignAPI.LastPullInfo()`, showing "No pulls recorded." when absent) and assert THAT here, or add `dofile('RaidAssign/Track.lua')` to this BuildWorld too (then GetTime/date stubs must exist — copy from raid-track.test.lua). Prefer the guard + dofile Track.lua: the hub status is worth a real assertion. Also add `_G.RaidAssignMinimapHub = nil` to BuildWorld's global resets.

- [ ] **Step 2: Run tests to verify they fail**

Run: `luajit raid-assign.test.lua`
Expected: new test FAILS (`RaidAssignMinimapHub` nil); pre-existing menu tests may fail once renamed — that's the work list for Step 3.

- [ ] **Step 3: Implement**

In `Minimap.lua`, replace the `ACTIONS`/`BuildMenu`/OnClick block (lines ~44–112) with:

```lua
-- The hub is hand-rolled out of plain frames rather than EasyMenu — see the git history:
-- EasyMenu is nil on wow_anniversary 2.5.6.69110 while the template still resolves, and
-- the failure was silent. A small anchored panel with real buttons also carries status
-- (payload? groups? last pull?) that a cursor menu had no room for.
local HUB_W, BTN_H, PAD = 190, 22, 10

local ACTIONS = {
    { text = "Scan raid",     run = function() SlashCmdList["RAIDSPECSCAN"]("") end },
    { text = "Assignments…",  run = function() SlashCmdList["RAIDASSIGN"]("") end },
    { text = "Apply groups",  run = function() RaidAssignAPI.ApplyGroups() end },
    { text = "Check results", run = function() SlashCmdList["RACHECK"]("") end },
}

local hub

local function BuildHub()
    local f = CreateFrame("Frame", "RaidAssignMinimapHub", UIParent, "BackdropTemplate")
    f:SetFrameStrata("DIALOG")
    f:EnableMouse(true)
    f:SetSize(HUB_W, PAD + 16 + 2 * 13 + 6 + #ACTIONS * (BTN_H + 4) + PAD)
    f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 16,
        insets = { left = 4, right = 4, top = 4, bottom = 4 } })

    local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    title:SetPoint("TOPLEFT", PAD, -PAD)
    title:SetText("RaidAssign")

    f.status1 = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    f.status1:SetPoint("TOPLEFT", PAD, -(PAD + 16))
    f.status1:SetJustifyH("LEFT")
    f.status2 = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    f.status2:SetPoint("TOPLEFT", PAD, -(PAD + 16 + 13))
    f.status2:SetJustifyH("LEFT")

    f.items = {}
    for i, action in ipairs(ACTIONS) do
        local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        b:SetSize(HUB_W - 2 * PAD, BTN_H)
        b:SetPoint("TOPLEFT", PAD, -(PAD + 16 + 2 * 13 + 6 + (i - 1) * (BTN_H + 4)))
        b:SetText(action.text)
        local label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        label:SetPoint("CENTER")
        label:SetText(action.text)
        b.label = label
        b:SetScript("OnClick", function()
            f:Hide()
            action.run()
        end)
        f.items[i] = b
    end
    f:Hide()
    return f
end

local function RefreshHub()
    hub.status1:SetText((RaidAssignAPI.LayoutInfo and RaidAssignAPI.LayoutInfo()) or "No payload loaded.")
    hub.status2:SetText((RaidAssignAPI.LastPullInfo and RaidAssignAPI.LastPullInfo()) or "No pulls recorded.")
end

btn:SetScript("OnClick", function()
    hub = hub or BuildHub()
    if hub:IsShown() then hub:Hide() return end
    RefreshHub()
    hub:ClearAllPoints()
    hub:SetPoint("TOPRIGHT", btn, "BOTTOMLEFT", 0, 0)
    hub:Show()
end)
```

(The extra `b.label` fontstring exists because `UIPanelButtonTemplate:SetText` isn't inspectable by the mock harness — the label mirrors the text and the harness asserts on it; the real client just shows both identically. If that reads as a hack: it is, in the harness's favor, and it costs one hidden fontstring per button. Alternatively teach MockFrame `GetText` after `SetText` on buttons and drop `b.label` — pick whichever keeps the existing tests greenest, and note that `f.items[i].label` is what the Step-1 test asserts.)

Delete the now-unused `WHITE`/`MENU_W`/`ROW_H`/`TITLE_H` locals if nothing else references them. Update the tooltip line "Click for options." if the old wording mentions the menu.

- [ ] **Step 4: Run tests to verify they pass**

Run: `luajit raid-assign.test.lua` and `luajit raid-track.test.lua`
Expected: all PASS, including updated legacy menu tests.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/Minimap.lua raid-assign.test.lua
git commit -m "feat: minimap hub panel — status lines and Check results replace the cursor menu"
```

---

### Task 9: In-game verification gate (manual)

**Files:**
- Modify: `assignments-engine.js` (`TRACK_AURAS` / `buildTrackingLines` — prune wrong aura-name variants found in-game)
- Modify: `docs/superpowers/specs/2026-08-15-assignment-compliance-tracker-design.md` (tick off the manual gate)

No code up front — this is the spec's manual gate, run by the raid leader (Max) in the Anniversary client. The executor's job is to prepare and hand over a checklist message, then apply the findings when they come back.

- [ ] **Step 1: Hand the user this checklist** (paste it verbatim in the final report):

```
In-game verification (10 min at a training dummy / 1 raid night):
1. /reload with the new addon, load an RSW3 payload from the web tool's Addon tab.
2. Party with a shaman; drop each totem and run:
   /run for i=1,40 do local n=UnitAura("player",i,"HELPFUL") if n then print(i,n) end end
   Note the EXACT buff names for: Windfury Totem, Grace of Air, Wrath of Air,
   Strength of Earth, Mana Spring, Totem of Wrath, Battle Shout.
3. On a dummy/boss, apply each assigned debuff and run:
   /run for i=1,40 do local n=UnitAura("target",i,"HARMFUL") if n then print(i,n) end end
   Confirm: Curse of the Elements, Curse of Recklessness, Sunder Armor, Expose Armor,
   Faerie Fire (both druid forms), Hunter's Mark, Fire Vulnerability, Winter's Chill,
   Demoralizing Shout/Roar, Thunder Clap, Insect Swarm, Judgement of Wisdom/Crusader.
4. Pull a boss (or dummy won't fire ENCOUNTER_START — use a real boss/raid dummy that does),
   watch the live frame, then /racheck after the kill/wipe.
5. Cross-check one pull's uptimes against the same fight's Warcraft Logs report.
Report back any aura name that differs from the payload's list.
```

- [ ] **Step 2: Apply findings** — for each verified aura name, collapse the comma-separated variants in `TRACK_AURAS` / `buildTrackingLines` to the single real name; run `node assignments-engine.test.js` and update the affected expectations.

- [ ] **Step 3: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "fix: pin verified in-game aura names for tracking payload"
```

---

## Self-Review (completed)

- **Spec coverage:** §1 payload → Tasks 1–3; §2 tracker (segmentation, debuffs, attribution, group buffs, storage) → Tasks 4–5; §3 live view → Task 6; §4 overview + whispers + manual post → Task 7; §5 minimap hub → Task 8; §6 error handling → absent-assignee (Task 4 test), malformed `@T` (Task 3 test), no-payload idle (Task 4 test), `/racheck` with nothing recorded (Task 7 test); mid-fight `/reload` discard is inherent (state is in locals, not SavedVariables); §7 testing → per-task tests + Task 9 manual gate.
- **Type consistency:** `GetTracking()` shape (Task 3) matches Track.lua consumption (Task 4); `TrackLive/Pulls/LastPullInfo/SendRaw` names match across Tasks 4–8; pull-record fields (`uptime`, `byAssignee`, `fraction`, `absent`, `noattrib`, `ordinal`, `success`, `duration`) match between producer (Tasks 4–5) and consumers (Tasks 7–8).
- **Known judgment calls an executor must NOT "fix" silently:** aura-name matching (spec revision, not IDs); Mana Tide untracked; boss-only (`ENCOUNTER_START`); nothing auto-posts; `SendRaw` bypasses `lastSent` on purpose.
