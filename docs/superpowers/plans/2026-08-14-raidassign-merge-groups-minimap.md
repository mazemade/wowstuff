# RaidAssign Merge, Auto-Grouping & Minimap Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One in-game addon (RaidAssign) that scans the raid, whispers assignments, and applies the web tool's optimizer group layout with one click, all reachable from a minimap icon.

**Architecture:** The web tool's Addon-tab payload is bumped RSW1→RSW2 and gains `@G<n>=names` lines carrying the `proposeGroups` layout. RaidSpecScan's file moves into the RaidAssign addon unchanged. RaidAssign parses the layout at Load time (import never acts), and a new throttled one-shot engine issues `SetRaidSubgroup`/`SwapRaidSubgroups` calls until the live roster matches. A hand-rolled minimap button opens a menu: Scan raid / Assignments… / Apply groups.

**Tech Stack:** WoW Classic 2.5.x (Interface 20506) Lua addon, no addon libraries. Web side is vanilla JS. Tests: `node` via `npm test` (JS), `luajit <file>.test.lua` with stubbed WoW globals (Lua).

**Spec:** `docs/superpowers/specs/2026-08-14-raidassign-merge-groups-minimap-design.md`

## Global Constraints

- Interface 20506 client APIs only; no addon libraries (no Ace, no LibDBIcon) — hand-rolled UI, `UIDropDownMenuTemplate`/`EasyMenu` from the stock client.
- `SavedVariables: RaidAssignDB` is the addon's only saved table.
- Wire format: header `RSW2`; whisper lines `Name=body`; group lines `@G<n>=<comma-separated short names>`, `n` in 1..8. Addon must still accept `RSW1`.
- Importing a payload must never send whispers or move players.
- Whisper send throttle `SEND_INTERVAL = 1.5` is untouched; group-move throttle is `APPLY_INTERVAL = 0.5`.
- Lua tests follow the existing `raid-spec-scan.test.lua` pattern: stub `_G`, `dofile` the addon file, drive slash commands / scripts, never reach into locals. Run from repo root with `luajit`.
- JS tests run with `npm test` from repo root.
- Every commit message body ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: RSW2 payload on the web side

`buildAddonWhispers` gains a third argument (the `proposeGroups` result) and emits the `RSW2` header plus `@G` lines. The Addon tab passes the layout through.

**Files:**
- Modify: `assignments-engine.js:787-796` (`buildAddonWhispers`)
- Modify: `assignments.js:757` (Addon tab call site)
- Test: `assignments-engine.test.js` (the `--- Addon whispers ---` block starting ~line 512)

**Interfaces:**
- Consumes: `proposeGroups(roster)` → `{ groups: [{ role, players: [{name,...}] }], unplaced: [...] }` (already exists).
- Produces: `buildAddonWhispers(roster, sheet, groupsResult)` → string; header line `RSW2`; after all whisper lines, one `@G<i+1>=name1,name2,...` line per non-empty `groupsResult.groups[i]`; omitting `groupsResult` (or passing one without `groups`) yields a payload with no `@G` lines but still the `RSW2` header. Tasks 3–4 parse exactly this format.

- [ ] **Step 1: Update the two header assertions and add the new tests**

In `assignments-engine.test.js`, change the existing header test (~line 513) to expect `RSW2`:

```js
test('buildAddonWhispers: RSW2 header, then one Name=body line per player', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n');
    assert.strictEqual(lines[0], 'RSW2');
    const bob = lines.filter(l => l.startsWith('Bob='));
    assert.strictEqual(bob.length, 1);
    assert.ok(bob[0].includes('Curse of Elements'));
    assert.ok(bob[0].includes('Soulstone'));
});
```

Then append to the same block:

```js
test('buildAddonWhispers: @G lines carry the proposed layout, groups in order, placed players exactly once', () => {
    const { roster, sheet } = sampleSheet();
    const res = E.proposeGroups(roster);
    const lines = E.buildAddonWhispers(roster, sheet, res).split('\n');
    const gLines = lines.filter(l => l.startsWith('@G'));
    assert.strictEqual(gLines.length, res.groups.filter(g => g.players.length).length);
    gLines.forEach(l => assert.ok(/^@G[1-8]=[^,]+(,[^,]+)*$/.test(l), 'bad group line: ' + l));
    // group numbers follow the proposal's order
    assert.deepStrictEqual(
        gLines.map(l => l.slice(2, l.indexOf('='))),
        res.groups.map((g, i) => g.players.length ? String(i + 1) : null).filter(Boolean));
    // every placed player appears exactly once across all @G lines
    const names = gLines.map(l => l.slice(l.indexOf('=') + 1).split(',')).flat();
    const placed = res.groups.map(g => g.players.map(p => p.name)).flat();
    assert.deepStrictEqual(names.slice().sort(), placed.slice().sort());
});
test('buildAddonWhispers: @G lines come after every whisper line', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet, E.proposeGroups(roster)).split('\n');
    const firstG = lines.findIndex(l => l.startsWith('@G'));
    assert.ok(firstG > 0);
    lines.slice(firstG).forEach(l => assert.ok(l.startsWith('@G'), 'whisper line after groups: ' + l));
});
test('buildAddonWhispers: unplaced players and empty groups produce no @G entries', () => {
    const { roster, sheet } = sampleSheet();
    // Structural test with a hand-built proposal: only groups[] is read, unplaced never appears.
    const fake = {
        groups: [{ role: 'melee', players: [{ name: 'Aaa' }, { name: 'Bbb' }] },
                 { role: 'casters', players: [] }],
        unplaced: [{ name: 'Zzz' }],
    };
    const gLines = E.buildAddonWhispers(roster, sheet, fake).split('\n').filter(l => l.startsWith('@G'));
    assert.deepStrictEqual(gLines, ['@G1=Aaa,Bbb']);
});
test('buildAddonWhispers: no groups argument still yields RSW2 with zero @G lines', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n');
    assert.strictEqual(lines[0], 'RSW2');
    assert.strictEqual(lines.filter(l => l.startsWith('@G')).length, 0);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — the header test expects `RSW2` but gets `RSW1`, and the `@G` tests find no group lines. Paste the actual failing output.

- [ ] **Step 3: Implement**

In `assignments-engine.js`, replace `buildAddonWhispers` (keep the existing UTF-8 comment above it, update the first comment line to say RaidAssign):

```js
    // Paste payload for the RaidAssign addon: one "Name=body" line per whisper, then the
    // optimizer's group layout as "@G<n>=name,name,..." lines ("@" can never start a WoW
    // character name, so the addon needs no escaping to tell the two apart).
    // packChat keeps each body inside WoW's 255-character chat limit, so a player with
    // many duties simply gets more than one line — the addon sends each as its own whisper.
    // Note: the 255 count above is in JS UTF-16 code units, while WoW enforces its chat
    // limit in UTF-8 bytes. Duty names (and thus body text) are ASCII-only today, where
    // one UTF-16 unit is always one UTF-8 byte, so the counts agree and this cannot bite.
    // If non-ASCII text is ever introduced here, this length check would need to switch
    // to counting UTF-8 bytes to stay accurate.
    function buildAddonWhispers(roster, sheet, groupsResult) {
        const per = whisperMap(sheet);
        const lines = ['RSW2'];
        Object.keys(per).forEach(n => {
            packChat('Your assignments: ', per[n], '; ', 255).forEach(body => {
                lines.push(n + '=' + body);
            });
        });
        ((groupsResult && groupsResult.groups) || []).forEach((g, i) => {
            if (g.players.length) lines.push('@G' + (i + 1) + '=' + g.players.map(p => p.name).join(','));
        });
        return lines.join('\n');
    }
```

In `assignments.js` line 757, change the Addon tab branch to:

```js
    } else if (activeTab === 'addon') {
        box.textContent = E.buildAddonWhispers(roster, sheet, E.proposeGroups(roster));
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, exit 0. Paste the tail of the output.

- [ ] **Step 5: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js assignments.js
git commit -m "feat: RSW2 addon payload carries the optimizer group layout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Merge RaidSpecScan into the RaidAssign addon

Pure file move — no logic changes. The scan code becomes `RaidAssign/Scan.lua`, the standalone RaidSpecScan addon disappears, and its test follows.

**Files:**
- Move: `RaidSpecScan/RaidSpecScan.lua` → `RaidAssign/Scan.lua` (contents unchanged)
- Delete: `RaidSpecScan/RaidSpecScan.toc` (and the now-empty `RaidSpecScan/` folder)
- Modify: `RaidAssign/RaidAssign.toc` (title/notes/version/file list)
- Modify: `RaidAssign/RaidAssign.lua:1-6` (header comment only)
- Modify: `raid-spec-scan.test.lua:1-8,141` (comment + `dofile` path)

**Interfaces:**
- Produces: `/specscan` and `SlashCmdList["RAIDSPECSCAN"]` now load from the RaidAssign addon; Task 5's menu relies on that. No function signatures change.

- [ ] **Step 1: Move the file and update the paths**

```bash
git mv RaidSpecScan/RaidSpecScan.lua RaidAssign/Scan.lua
git rm RaidSpecScan/RaidSpecScan.toc
```

Replace the whole of `RaidAssign/RaidAssign.toc` with:

```
## Interface: 20506
## Title: RaidAssign
## Notes: Scans raid talents, whispers assignments, and applies group layouts from the Raid Assignments web tool
## Author: mazemade
## Version: 2.0
## SavedVariables: RaidAssignDB

Scan.lua
RaidAssign.lua
```

In `raid-spec-scan.test.lua`: change line 1's comment to `-- Tests for RaidAssign/Scan.lua (the /specscan half of the RaidAssign addon). Run from the repo root:` and change the `dofile` at line 141 to `dofile('RaidAssign/Scan.lua')`.

In `RaidAssign/RaidAssign.lua`, replace the header comment's standalone paragraph (lines 5-6) with:

```lua
-- Scan.lua (/specscan) feeds the web tool and this file reads the web tool's output back.
-- The two files live in one addon but share no state; each works if the other fails to load.
```

- [ ] **Step 2: Run the scan tests against the new path**

Run: `luajit raid-spec-scan.test.lua`
Expected: `4 passed, 0 failed`, exit 0. Paste the output.

- [ ] **Step 3: Commit**

```bash
git add -A RaidSpecScan RaidAssign raid-spec-scan.test.lua
git commit -m "refactor: fold RaidSpecScan into the RaidAssign addon as Scan.lua

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: RSW2 parsing and layout state in the addon

`ParsePayload` learns `RSW2` and `@G` lines; Load stores the layout in memory; the preview reports it. No moving of players yet — that's Task 4.

**Files:**
- Modify: `RaidAssign/RaidAssign.lua` (`ParsePayload`, `OnLoadClicked`, `ShowPreview`, `PreviewText`, new `layout` local + `LayoutSummary`)
- Create: `raid-assign.test.lua` (repo root — harness + parsing tests)

**Interfaces:**
- Consumes: RSW2 format from Task 1.
- Produces, for Task 4 and 5 (same file / harness):
  - local `layout` — `nil`, or `{ byName = { ["alice"] = 3, ... }, groups = { [3] = { "Alice", ... } }, playerCount = N, duplicates = { "Bob", ... } }` (keys in `byName` are short names, lowercased; `groups` holds display names in payload order).
  - `ParsePayload(text)` → `{ entries, malformed, layout }` or `nil, err`.
  - local `LayoutSummary()` → `"Group layout loaded: G groups, N players."` or `nil` when no layout.
  - Test harness `BuildWorld(opts)` / `Tick(dt)` / `world` described below, which Task 4's engine tests and Task 5's minimap tests extend.

- [ ] **Step 1: Write the test harness and the parsing tests**

Create `raid-assign.test.lua`:

```lua
-- Tests for RaidAssign/RaidAssign.lua. Run from the repo root:
--
--     luajit raid-assign.test.lua
--
-- Same approach as raid-spec-scan.test.lua: stub the WoW globals, dofile the real addon,
-- and drive it the way a raid leader does — /specsend, paste, Load, buttons, OnUpdate
-- ticks. Nothing reaches into the addon's locals. The mock frames here are slightly
-- richer than the scan test's: EditBox text round-trips and buttons remember their
-- OnClick, enabled and shown state, because the tests assert on exactly those.

local passed, failed = 0, 0

local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
        print('ok - ' .. name)
    else
        failed = failed + 1
        io.stderr:write('FAIL - ' .. name .. '\n    ' .. tostring(err) .. '\n')
    end
end

local function assertEqual(actual, expected)
    if actual ~= expected then
        error('\n    expected: ' .. tostring(expected) .. '\n    actual:   ' .. tostring(actual), 2)
    end
end

local function assertMatch(s, pattern)
    if not tostring(s):find(pattern) then
        error('\n    expected to match: ' .. pattern .. '\n    actual: ' .. tostring(s), 2)
    end
end

local function MockFrame()
    local f = { scripts = {}, text = '', shown = true, enabled = true }
    setmetatable(f, { __index = function()
        return function() return MockFrame() end
    end })
    rawset(f, 'SetScript', function(self, key, fn) rawset(self.scripts, key, fn) end)
    rawset(f, 'GetScript', function(self, key) return self.scripts[key] end)
    rawset(f, 'SetText', function(self, t) self.text = t end)
    rawset(f, 'GetText', function(self) return self.text end)
    rawset(f, 'Show', function(self) self.shown = true end)
    rawset(f, 'Hide', function(self) self.shown = false end)
    rawset(f, 'IsShown', function(self) return self.shown end)
    rawset(f, 'Enable', function(self) self.enabled = true end)
    rawset(f, 'Disable', function(self) self.enabled = false end)
    rawset(f, 'Click', function(self)
        if self.scripts.OnClick then self.scripts.OnClick(self) end
    end)
    return f
end

local world

-- opts.raid: array of { name, subgroup }, index = raid roster index.
local function BuildWorld(opts)
    opts = opts or {}
    world = { raid = opts.raid or {}, inCombat = false, isLeader = true,
              messages = {}, frames = {}, whispers = {}, ops = {} }
    _G.RaidAssignDB = nil
    _G.RaidAssignFrame = nil
    _G.RaidAssignAPI = nil
    _G.UIParent = MockFrame()
    _G.ChatFontNormal = {}
    _G.DEFAULT_CHAT_FRAME = { AddMessage = function(_, msg)
        world.messages[#world.messages + 1] = msg
    end }
    _G.SlashCmdList = {}
    _G.CreateFrame = function(_, name)
        local f = MockFrame()
        world.frames[#world.frames + 1] = f
        if name then _G[name] = f end
        return f
    end
    _G.IsInRaid = function() return #world.raid > 0 end
    _G.GetNumGroupMembers = function() return #world.raid end
    _G.GetRaidRosterInfo = function(i)
        local r = world.raid[i]
        if not r then return nil end
        return r.name, 0, r.subgroup
    end
    _G.SendChatMessage = function(body, _, _, target)
        world.whispers[#world.whispers + 1] = { body = body, target = target }
    end
    _G.UnitIsGroupLeader = function() return world.isLeader end
    _G.UnitIsGroupAssistant = function() return false end
    _G.InCombatLockdown = function() return world.inCombat end
    _G.SetRaidSubgroup = function(i, g)
        world.ops[#world.ops + 1] = 'set:' .. world.raid[i].name .. '->' .. g
        world.raid[i].subgroup = g
    end
    _G.SwapRaidSubgroups = function(i, j)
        world.ops[#world.ops + 1] = 'swap:' .. world.raid[i].name .. '<->' .. world.raid[j].name
        world.raid[i].subgroup, world.raid[j].subgroup =
            world.raid[j].subgroup, world.raid[i].subgroup
    end
    dofile('RaidAssign/RaidAssign.lua')
end

-- Fires every registered OnUpdate once. dt defaults past APPLY_INTERVAL so each call
-- lets the group engine take exactly one action.
local function Tick(dt)
    for _, f in ipairs(world.frames) do
        local h = f.scripts.OnUpdate
        if h then h(f, dt or 0.6) end
    end
end

local function LoadPayload(lines)
    _G.SlashCmdList['RAIDASSIGN']('')
    RaidAssignFrame.editBox:SetText(table.concat(lines, '\n'))
    RaidAssignFrame.loadBtn:Click()
end

local function LastMessage()
    return world.messages[#world.messages] or ''
end

local function Subgroups()
    local out = {}
    for _, r in ipairs(world.raid) do out[r.name] = r.subgroup end
    return out
end

-- --- ParsePayload: RSW1 / RSW2 ---

test('RSW1 payload still loads and reports no layout', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW1', 'Alice=Tank stuff' })
    assertMatch(RaidAssignFrame.title.text, 'whispers ready')
    assertEqual(RaidAssignFrame.status.text, '')
end)

test('RSW2 payload with @G lines reports the loaded layout', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', 'Alice=Tank stuff', '@G1=Alice,Bob', '@G3=Carol' })
    assertMatch(RaidAssignFrame.status.text, 'Group layout loaded: 2 groups, 3 players%.')
end)

test('RSW2 with no @G lines behaves like RSW1', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', 'Alice=Tank stuff' })
    assertEqual(RaidAssignFrame.status.text, '')
end)

test('a groups-only RSW2 payload loads with zero whispers', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', '@G1=Alice' })
    assertMatch(RaidAssignFrame.title.text, '0 whispers ready')
    assertMatch(RaidAssignFrame.status.text, 'Group layout loaded: 1 groups, 1 players%.')
end)

test('malformed @G lines are reported like other unreadable lines', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', 'Alice=Tank stuff', '@G9=Bob', '@Gx=Carol' })
    assertMatch(RaidAssignFrame.editBox.text, 'Skipped 2 unreadable line%(s%)%.')
end)

test('a name in two groups keeps its first placement and reports the duplicate', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', '@G1=Alice', '@G2=Alice,Bob' })
    assertMatch(RaidAssignFrame.status.text, 'Group layout loaded: 2 groups, 2 players%.')
    assertMatch(RaidAssignFrame.editBox.text, 'Duplicate group entries ignored: Alice')
end)

test('not an RSW payload is rejected with a reason', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSS3;Alice:ROGUE:15/41/5:1::' })
    assertMatch(RaidAssignFrame.status.text, 'not an RSW1/RSW2 payload')
end)

print(string.format('\n%d passed, %d failed', passed, failed))
os.exit(failed == 0 and 0 or 1)
```

(`Tick`, `world.ops`, `Subgroups`, `LastMessage`, and the roster/leader/combat stubs are unused until Task 4 — they are part of this harness on purpose so Task 4 only appends tests.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `luajit raid-assign.test.lua`
Expected: FAIL — the RSW2/`@G`/duplicate tests fail (`ParsePayload` rejects `RSW2` headers today); the RSW1 test may already pass. Paste the actual output.

- [ ] **Step 3: Implement parsing and preview**

In `RaidAssign/RaidAssign.lua`:

**3a.** Change the state line `local sheet = nil` block (lines 12-14) to:

```lua
local sheet = nil        -- array of { name, body } from the last successful paste
local malformed = {}     -- pasted lines the parser could not read
local layout = nil       -- group layout from the last paste's @G lines, or nil
local frame              -- built lazily on first /specsend
```

**3b.** Replace `ParsePayload` entirely:

```lua
-- Returns { entries, malformed, layout }, or nil plus a human-readable reason.
-- layout is nil when the payload has no @G lines; otherwise:
--   byName      short lowered name -> group number 1..8 (how the engine matches the roster)
--   groups      [n] -> display names in payload order (how messages name people)
--   playerCount total distinct names placed
--   duplicates  names that appeared a second time; first placement wins
local function ParsePayload(text)
    local entries, bad, layout, sawHeader = {}, {}, nil, false
    for line in (text or ""):gmatch("[^\r\n]+") do
        line = line:match("^%s*(.-)%s*$")
        if line ~= "" then
            if not sawHeader then
                if line ~= "RSW1" and line ~= "RSW2" then
                    return nil, "That is not an RSW1/RSW2 payload. Copy the Addon tab from the web tool."
                end
                sawHeader = true
            elseif line:sub(1, 1) == "@" then
                -- "@" cannot start a character name, so this is unambiguously a group line.
                local n, names = line:match("^@G([1-8])=(.+)$")
                if not n then
                    table.insert(bad, line)
                else
                    layout = layout or { byName = {}, groups = {}, playerCount = 0, duplicates = {} }
                    n = tonumber(n)
                    layout.groups[n] = layout.groups[n] or {}
                    for name in names:gmatch("[^,]+") do
                        name = name:match("^%s*(.-)%s*$")
                        if name ~= "" then
                            local key = (name:match("^([^-]+)") or name):lower()
                            if layout.byName[key] then
                                table.insert(layout.duplicates, name)
                            else
                                layout.byName[key] = n
                                table.insert(layout.groups[n], name)
                                layout.playerCount = layout.playerCount + 1
                            end
                        end
                    end
                end
            else
                local name, body = line:match("^([^=]+)=(.+)$")
                if name then
                    table.insert(entries, { name = name, body = body })
                else
                    table.insert(bad, line)
                end
            end
        end
    end
    if not sawHeader then return nil, "Nothing pasted." end
    if #entries == 0 and not layout then return nil, "No assignment or group lines in that payload." end
    return { entries = entries, malformed = bad, layout = layout }
end
```

**3c.** In `PreviewText`, after the malformed block, add:

```lua
    if layout and #layout.duplicates > 0 then
        table.insert(rows, "")
        table.insert(rows, "Duplicate group entries ignored: " .. table.concat(layout.duplicates, ", "))
    end
```

**3d.** Add `LayoutSummary` just above `ShowPaste`:

```lua
local function LayoutSummary()
    if not layout then return nil end
    local groups = 0
    for _ in pairs(layout.groups) do groups = groups + 1 end
    return "Group layout loaded: " .. groups .. " groups, " .. layout.playerCount .. " players."
end
```

**3e.** In `ShowPreview`, replace the `if IsInRaid() ... end` block with:

```lua
    local bits = {}
    if layout then table.insert(bits, LayoutSummary()) end
    if IsInRaid() then
        frame.sendBtn:Enable()
    else
        table.insert(bits, "Not in a raid — you can review, but not send.")
        frame.sendBtn:Disable()
        frame.changedBtn:Disable()
    end
    frame.status:SetText(table.concat(bits, "  "))
```

**3f.** Replace `OnLoadClicked`'s body:

```lua
local function OnLoadClicked()
    local result, err = ParsePayload(frame.editBox:GetText())
    if not result then
        frame.status:SetText("|cFFFF6B6B" .. err .. "|r")
        return
    end
    sheet, malformed, layout = result.entries, result.malformed, result.layout
    ShowPreview()
end
```

- [ ] **Step 4: Run both Lua test files to verify they pass**

Run: `luajit raid-assign.test.lua && luajit raid-spec-scan.test.lua`
Expected: all pass, exit 0. Paste the output.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/RaidAssign.lua raid-assign.test.lua
git commit -m "feat: parse RSW2 group layout on Load; import still never acts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: One-shot group apply engine + Apply groups button

The engine converges the live roster onto `layout` one throttled operation at a time, then reports. The preview window gains the **Apply groups** button; `RaidAssignAPI` exposes the entry points Task 5's minimap menu needs.

**Files:**
- Modify: `RaidAssign/RaidAssign.lua` (engine after the whisper queue block; button in `BuildFrame`/`ShowPaste`/`ShowPreview`; `RaidAssignAPI` at file end)
- Test: `raid-assign.test.lua` (append engine tests before the final print)

**Interfaces:**
- Consumes: `layout`, `LayoutSummary()`, `RaidTargets()` from Task 3; harness `BuildWorld`/`Tick`/`world.ops`/`Subgroups`/`LastMessage`.
- Produces: global `RaidAssignAPI = { ApplyGroups = <function()>, LayoutInfo = <function() -> string|nil> }` — Task 5 calls exactly these; `frame.applyBtn` shown on preview, enabled iff a layout is loaded and `IsInRaid()`.

- [ ] **Step 1: Append the engine tests**

Insert into `raid-assign.test.lua`, before the final `print`:

```lua
-- --- Group apply engine ---

local function LoadAndApply(raid, payloadLines)
    BuildWorld({ raid = raid })
    LoadPayload(payloadLines)
    RaidAssignFrame.applyBtn:Click()
end

test('a player moves into a group with room via SetRaidSubgroup', function()
    LoadAndApply(
        { { name = 'Alice', subgroup = 1 }, { name = 'Bob', subgroup = 2 } },
        { 'RSW2', '@G2=Alice,Bob' })
    Tick(); Tick(); Tick()
    assertEqual(Subgroups().Alice, 2)
    assertEqual(#world.ops, 1)
    assertEqual(world.ops[1], 'set:Alice->2')
    assertMatch(LastMessage(), 'Groups applied — 1 move')
end)

test('cross-realm roster names still match short payload names', function()
    LoadAndApply(
        { { name = 'Alice-Whitemane', subgroup = 1 } },
        { 'RSW2', '@G2=Alice' })
    Tick(); Tick()
    assertEqual(Subgroups()['Alice-Whitemane'], 2)
end)

test('a full target group is resolved by one swap that settles two players', function()
    LoadAndApply(
        { { name = 'A1', subgroup = 1 }, { name = 'A2', subgroup = 1 },
          { name = 'B1', subgroup = 2 }, { name = 'B2', subgroup = 2 },
          { name = 'B3', subgroup = 2 }, { name = 'B4', subgroup = 2 },
          { name = 'B5', subgroup = 2 } },
        -- A1 belongs in full group 2; B5 belongs in group 1: one swap fixes both.
        { 'RSW2', '@G1=A2,B5', '@G2=A1,B1,B2,B3,B4' })
    Tick(); Tick(); Tick()
    local g = Subgroups()
    assertEqual(g.A1, 2)
    assertEqual(g.B5, 1)
    assertEqual(#world.ops, 1)
    assertEqual(world.ops[1], 'swap:A1<->B5')
end)

test('a three-way cycle across full groups converges', function()
    -- Groups 1..3 each hold five players; the first of each belongs in the next group.
    local raid, lines = {}, { 'RSW2' }
    local wants = {}
    for grp = 1, 3 do
        for slot = 1, 5 do
            local name = 'P' .. grp .. slot
            raid[#raid + 1] = { name = name, subgroup = grp }
            wants[name] = (slot == 1) and (grp % 3 + 1) or grp
        end
    end
    local byGroup = {}
    for name, g in pairs(wants) do
        byGroup[g] = byGroup[g] or {}
        table.insert(byGroup[g], name)
    end
    for g = 1, 3 do
        table.sort(byGroup[g])
        lines[#lines + 1] = '@G' .. g .. '=' .. table.concat(byGroup[g], ',')
    end
    LoadAndApply(raid, lines)
    for _ = 1, 10 do Tick() end
    for name, g in pairs(wants) do assertEqual(Subgroups()[name], g) end
    assertMatch(LastMessage(), 'Groups applied')
end)

test('layout names missing from the raid are reported, not moved', function()
    LoadAndApply(
        { { name = 'Alice', subgroup = 1 } },
        { 'RSW2', '@G2=Alice,Ghost' })
    Tick(); Tick(); Tick()
    assertEqual(Subgroups().Alice, 2)
    assertMatch(LastMessage(), 'Not in raid: Ghost')
end)

test('an over-filled target group skips the extra player and says so', function()
    LoadAndApply(
        { { name = 'A1', subgroup = 1 },
          { name = 'B1', subgroup = 2 }, { name = 'B2', subgroup = 2 },
          { name = 'B3', subgroup = 2 }, { name = 'B4', subgroup = 2 },
          { name = 'B5', subgroup = 2 } },
        -- Six people told to be in group 2; B1..B5 are already home, A1 can never fit.
        { 'RSW2', '@G2=A1,B1,B2,B3,B4,B5' })
    Tick(); Tick()
    assertEqual(Subgroups().A1, 1)
    assertEqual(#world.ops, 0)
    assertMatch(LastMessage(), 'Could not place %(target group full%): A1')
end)

test('entering combat aborts mid-run and leaves the engine stopped', function()
    LoadAndApply(
        { { name = 'Alice', subgroup = 1 }, { name = 'Bob', subgroup = 1 } },
        { 'RSW2', '@G2=Alice', '@G3=Bob' })
    Tick()                       -- first move lands
    world.inCombat = true
    Tick()                       -- abort instead of second move
    assertEqual(#world.ops, 1)
    assertMatch(LastMessage(), 'combat')
    world.inCombat = false
    Tick()                       -- engine must be detached: no further ops
    assertEqual(#world.ops, 1)
end)

test('an op that the server ignores hits the move cap instead of looping forever', function()
    LoadAndApply(
        { { name = 'Alice', subgroup = 1 } },
        { 'RSW2', '@G2=Alice' })
    _G.SetRaidSubgroup = function(i, g)  -- server silently refuses; roster never changes
        world.ops[#world.ops + 1] = 'set:refused'
    end
    for _ = 1, 60 do Tick() end
    assertEqual(#world.ops, 50)
    assertMatch(LastMessage(), 'cap')
end)

test('apply refuses without lead or assist', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    world.isLeader = false
    LoadPayload({ 'RSW2', '@G2=Alice' })
    RaidAssignFrame.applyBtn:Click()
    Tick()
    assertEqual(#world.ops, 0)
    assertMatch(LastMessage(), 'lead or assist')
end)

test('apply refuses in combat before touching anyone', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    world.inCombat = true
    LoadPayload({ 'RSW2', '@G2=Alice' })
    RaidAssignFrame.applyBtn:Click()
    Tick()
    assertEqual(#world.ops, 0)
    assertMatch(LastMessage(), 'combat')
end)

test('apply button is disabled when the payload has no layout', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW1', 'Alice=Tank stuff' })
    assertEqual(RaidAssignFrame.applyBtn.shown, true)
    assertEqual(RaidAssignFrame.applyBtn.enabled, false)
end)

test('RaidAssignAPI.ApplyGroups without a layout explains itself', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    RaidAssignAPI.ApplyGroups()
    assertMatch(LastMessage(), 'No layout loaded')
end)

test('RaidAssignAPI.LayoutInfo mirrors the loaded layout', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    assertEqual(RaidAssignAPI.LayoutInfo(), nil)
    LoadPayload({ 'RSW2', '@G1=Alice,Bob' })
    assertMatch(RaidAssignAPI.LayoutInfo(), 'Group layout loaded: 1 groups, 2 players%.')
end)
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `luajit raid-assign.test.lua`
Expected: FAIL — `applyBtn` doesn't exist (`Click` on nil) and `RaidAssignAPI` is nil. Task 3's tests still pass. Paste the actual output.

- [ ] **Step 3: Implement the engine**

In `RaidAssign/RaidAssign.lua`, insert after the whisper-queue block (after `StartSending`, before `PreviewText`):

```lua
-- === Group layout application ================================================
-- One-shot: converge the live roster onto `layout`, one operation per tick, then stop.
-- Never precompute a move list — the server reorders the roster between ops, so each
-- tick re-reads it and decides the single next move.

local APPLY_INTERVAL = 0.5 -- seconds between ops; the server needs each GROUP_ROSTER_UPDATE to settle
local MAX_APPLY_OPS = 50   -- backstop only: every op below places >=1 player correctly, so a
                           -- 40-man needs at most 40 — hitting 50 means the server is ignoring us

local applyFrame = CreateFrame("Frame")
local applying, applyElapsed, applyOps = false, 0, 0
local applyTargets, applyMissing

-- Live roster as { index, name (short, lowered — same normalization as RaidTargets),
-- display (the full name, for messages), subgroup }.
local function ApplyRoster()
    local out = {}
    for i = 1, GetNumGroupMembers() do
        local full, _, sub = GetRaidRosterInfo(i)
        if full and sub then
            table.insert(out, { index = i, name = (full:match("^([^-]+)") or full):lower(),
                                display = full, subgroup = sub })
        end
    end
    return out
end

-- The single next operation: "set", raidIndex, group / "swap", indexA, indexB /
-- nil, stuckNames when nothing movable remains. Correctly placed players are never
-- displaced, so every returned op is net progress and convergence is guaranteed.
local function NextMove(targets)
    local roster = ApplyRoster()
    local counts = {}
    for _, r in ipairs(roster) do counts[r.subgroup] = (counts[r.subgroup] or 0) + 1 end
    local stuck = {}
    for _, r in ipairs(roster) do
        local want = targets[r.name]
        if want and want ~= r.subgroup then
            if (counts[want] or 0) < 5 then return "set", r.index, want end
            -- Target group full: swap with a misplaced occupant, preferring one headed
            -- for r's current group so a single swap settles two players.
            local fallback
            for _, o in ipairs(roster) do
                if o.subgroup == want and targets[o.name] and targets[o.name] ~= want then
                    if targets[o.name] == r.subgroup then return "swap", r.index, o.index end
                    fallback = fallback or o.index
                end
            end
            if fallback then return "swap", r.index, fallback end
            -- Everyone in the full target group belongs there: the layout over-fills it.
            table.insert(stuck, r.display)
        end
    end
    return nil, stuck
end

local function FinishApply(abortReason, stuck)
    applying = false
    applyFrame:SetScript("OnUpdate", nil)
    if abortReason then
        Print("Group apply aborted — " .. abortReason .. " (" .. applyOps .. " move(s) made). Re-run when ready.")
        return
    end
    local msg = "Groups applied — " .. applyOps .. " move(s)."
    if #applyMissing > 0 then
        msg = msg .. " Not in raid: " .. table.concat(applyMissing, ", ") .. "."
    end
    if stuck and #stuck > 0 then
        msg = msg .. " Could not place (target group full): " .. table.concat(stuck, ", ") .. "."
    end
    Print(msg)
end

local function ApplyTick(_, dt)
    applyElapsed = applyElapsed + dt
    if applyElapsed < APPLY_INTERVAL then return end
    applyElapsed = 0
    if InCombatLockdown() then FinishApply("combat started") return end
    local kind, a, b = NextMove(applyTargets)
    if not kind then FinishApply(nil, a) return end -- a = stuck names when kind is nil
    if applyOps >= MAX_APPLY_OPS then FinishApply("hit the " .. MAX_APPLY_OPS .. "-move cap") return end
    applyOps = applyOps + 1
    if kind == "set" then SetRaidSubgroup(a, b) else SwapRaidSubgroups(a, b) end
end

local function ApplyGroups()
    if not layout then Print("No layout loaded — open Assignments (/specsend) and paste the web tool payload.") return end
    if applying then Print("Already applying groups.") return end
    if not IsInRaid() then Print("You are not in a raid.") return end
    if not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        Print("You need raid lead or assist to move players.")
        return
    end
    if InCombatLockdown() then Print("Cannot move players in combat.") return end
    local inRaid = RaidTargets()
    local targets, missing = {}, {}
    for key, group in pairs(layout.byName) do
        if inRaid[key] then targets[key] = group end
    end
    for n = 1, 8 do
        for _, name in ipairs(layout.groups[n] or {}) do
            if not inRaid[(name:match("^([^-]+)") or name):lower()] then
                table.insert(missing, name)
            end
        end
    end
    applyTargets, applyMissing = targets, missing
    applying, applyOps, applyElapsed = true, 0, APPLY_INTERVAL -- first op on the next tick
    Print("Applying group layout…")
    applyFrame:SetScript("OnUpdate", ApplyTick)
end
```

- [ ] **Step 4: Wire the button and the API**

Still in `RaidAssign/RaidAssign.lua`:

**4a.** In `BuildFrame`, re-lay the bottom row — replace the `backBtn`/`closeBtn` creation and add `applyBtn`:

```lua
    f.applyBtn = Button("Apply groups", 110, 280)
    f.applyBtn:SetScript("OnClick", function() ApplyGroups() end)

    f.backBtn = Button("Back", 70, 398)
    f.backBtn:SetScript("OnClick", ShowPaste)

    f.closeBtn = Button("Close", 70, 476)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)
```

**4b.** In `ShowPaste`, add `frame.applyBtn:Hide()` next to the other `Hide()` calls.

**4c.** In `ShowPreview`, after the status block from Task 3, add:

```lua
    if layout and IsInRaid() then frame.applyBtn:Enable() else frame.applyBtn:Disable() end
```

and add `frame.applyBtn:Show()` beside the other `Show()` calls at the end.

**4d.** At the very end of the file (after the slash handler), add:

```lua
-- Entry points for Minimap.lua. A global on purpose: the addon's files share no locals,
-- so this table is the whole surface they talk across.
RaidAssignAPI = {
    ApplyGroups = ApplyGroups,
    LayoutInfo = LayoutSummary,
}
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `luajit raid-assign.test.lua && luajit raid-spec-scan.test.lua && npm test`
Expected: everything passes, exit 0. Paste the tail of the output.

- [ ] **Step 6: Commit**

```bash
git add RaidAssign/RaidAssign.lua raid-assign.test.lua
git commit -m "feat: one-shot Apply groups — throttled SetRaidSubgroup/Swap engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Minimap button and menu

A hand-rolled minimap icon: drag around the rim (angle saved in `RaidAssignDB.minimap.angle`), click for a menu of the three actions, tooltip shows layout state.

**Files:**
- Create: `RaidAssign/Minimap.lua`
- Modify: `RaidAssign/RaidAssign.toc` (append `Minimap.lua`)
- Test: `raid-assign.test.lua` (harness additions + minimap tests)

**Interfaces:**
- Consumes: `RaidAssignAPI.ApplyGroups` / `RaidAssignAPI.LayoutInfo` (Task 4), `SlashCmdList["RAIDASSIGN"]` and `SlashCmdList["RAIDSPECSCAN"]` (existing).
- Produces: global frame `RaidAssignMinimapButton`; nothing else depends on this file.

- [ ] **Step 1: Extend the harness and write the tests**

In `raid-assign.test.lua`, inside `BuildWorld` just before the `dofile` line, add:

```lua
    _G.Minimap = MockFrame()
    _G.Minimap.GetCenter = function() return 0, 0 end
    _G.UIParent.GetEffectiveScale = function() return 1 end
    _G.GameTooltip = MockFrame()
    _G.EasyMenu = function(items) world.menu = items end
    _G.GetCursorPosition = function() return world.cursorX or 100, world.cursorY or 0 end
    _G.RaidAssignMinimapButton = nil
```

and change the `dofile` line to load both files in TOC order:

```lua
    dofile('RaidAssign/RaidAssign.lua')
    dofile('RaidAssign/Minimap.lua')
```

Append before the final `print`:

```lua
-- --- Minimap button ---

test('clicking the minimap button opens a menu with the three actions', function()
    BuildWorld({})
    RaidAssignMinimapButton:Click()
    local texts = {}
    for _, item in ipairs(world.menu) do texts[#texts + 1] = item.text end
    assertEqual(table.concat(texts, '|'), 'RaidAssign|Scan raid|Assignments…|Apply groups')
end)

test('menu actions call the scan slash, the assignments slash, and ApplyGroups', function()
    BuildWorld({})
    local scanCalled = false
    _G.SlashCmdList['RAIDSPECSCAN'] = function() scanCalled = true end
    RaidAssignMinimapButton:Click()
    world.menu[2].func()
    assertEqual(scanCalled, true)
    world.menu[3].func()
    assertEqual(RaidAssignFrame ~= nil, true)     -- assignments window built and shown
    assertEqual(RaidAssignFrame.shown, true)
    world.menu[4].func()
    assertMatch(LastMessage(), 'No layout loaded') -- ApplyGroups guard fired
end)

test('dragging the button saves the angle to RaidAssignDB', function()
    BuildWorld({})
    world.cursorX, world.cursorY = 0, 80          -- straight up from the minimap centre
    RaidAssignMinimapButton.scripts.OnDragStart(RaidAssignMinimapButton)
    RaidAssignMinimapButton.scripts.OnUpdate(RaidAssignMinimapButton)
    RaidAssignMinimapButton.scripts.OnDragStop(RaidAssignMinimapButton)
    assertEqual(RaidAssignDB.minimap.angle, 90)
    assertEqual(RaidAssignMinimapButton.scripts.OnUpdate, nil)
end)
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `luajit raid-assign.test.lua`
Expected: FAIL — `dofile 'RaidAssign/Minimap.lua'` cannot open the file. Paste the actual output.

- [ ] **Step 3: Implement Minimap.lua and the TOC**

Create `RaidAssign/Minimap.lua`:

```lua
-- Minimap button: one icon, three actions. Talks to the other files only through their
-- slash handlers and RaidAssignAPI, so a load failure on either side leaves the rest working.

local DEFAULT_ANGLE = 220 -- degrees; lower-left, where the stock icons leave room
local RADIUS = 80         -- distance from minimap centre, the rim for the default minimap

local btn = CreateFrame("Button", "RaidAssignMinimapButton", Minimap)
btn:SetSize(32, 32)
btn:SetFrameStrata("MEDIUM")
btn:SetFrameLevel(8)
btn:RegisterForClicks("AnyUp")
btn:RegisterForDrag("LeftButton")

local overlay = btn:CreateTexture(nil, "OVERLAY")
overlay:SetSize(53, 53)
overlay:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
overlay:SetPoint("TOPLEFT")

local icon = btn:CreateTexture(nil, "BACKGROUND")
icon:SetSize(20, 20)
icon:SetTexture("Interface\\Icons\\INV_Misc_GroupLooking")
icon:SetPoint("TOPLEFT", 7, -5)

local function Reposition()
    local angle = (RaidAssignDB and RaidAssignDB.minimap and RaidAssignDB.minimap.angle) or DEFAULT_ANGLE
    local rad = math.rad(angle)
    btn:ClearAllPoints()
    btn:SetPoint("CENTER", Minimap, "CENTER", RADIUS * math.cos(rad), RADIUS * math.sin(rad))
end

local function OnDragUpdate()
    local mx, my = Minimap:GetCenter()
    local scale = UIParent:GetEffectiveScale()
    local cx, cy = GetCursorPosition()
    RaidAssignDB = RaidAssignDB or {}
    RaidAssignDB.minimap = RaidAssignDB.minimap or {}
    RaidAssignDB.minimap.angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
    Reposition()
end

btn:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", OnDragUpdate) end)
btn:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)

local menuFrame
btn:SetScript("OnClick", function()
    menuFrame = menuFrame or CreateFrame("Frame", "RaidAssignMinimapMenu", UIParent, "UIDropDownMenuTemplate")
    EasyMenu({
        { text = "RaidAssign", isTitle = true, notCheckable = true },
        { text = "Scan raid", notCheckable = true,
          func = function() SlashCmdList["RAIDSPECSCAN"]("") end },
        { text = "Assignments…", notCheckable = true,
          func = function() SlashCmdList["RAIDASSIGN"]("") end },
        { text = "Apply groups", notCheckable = true,
          func = function() RaidAssignAPI.ApplyGroups() end },
    }, menuFrame, "cursor", 0, 0, "MENU")
end)

btn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("RaidAssign")
    GameTooltip:AddLine(RaidAssignAPI.LayoutInfo() or "No payload loaded.", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Click for options. Drag to move.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
end)
btn:SetScript("OnLeave", function() GameTooltip:Hide() end)

-- SavedVariables are not loaded while this file runs; place the button at the default
-- immediately so it is never at 0,0, then again at login from the saved angle.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", Reposition)
Reposition()
```

Append `Minimap.lua` on its own line at the end of `RaidAssign/RaidAssign.toc`.

- [ ] **Step 4: Run all Lua tests to verify they pass**

Run: `luajit raid-assign.test.lua && luajit raid-spec-scan.test.lua`
Expected: all pass, exit 0. Paste the output.

- [ ] **Step 5: Commit**

```bash
git add RaidAssign/Minimap.lua RaidAssign/RaidAssign.toc raid-assign.test.lua
git commit -m "feat: minimap button with Scan / Assignments / Apply groups menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and final verification

**Files:**
- Modify: `README.md` (only if it mentions RaidSpecScan as a separate addon — check first)

**Interfaces:** none.

- [ ] **Step 1: Update stale references**

Run: `grep -rn "RaidSpecScan" README.md docs/ --include="*.md" | grep -v superpowers`
For any hit in `README.md`, rewrite it to describe the merged addon: RaidAssign now provides `/specscan` (scan), `/specsend` (paste + whisper + apply groups), and a minimap button. Leave historical specs/plans untouched.

- [ ] **Step 2: Full verification run**

Run: `npm test && luajit raid-assign.test.lua && luajit raid-spec-scan.test.lua && git status --short`
Expected: every suite passes with exit 0; `git status` shows only intended changes (or nothing if Step 1 found no hits). Paste the real output.

- [ ] **Step 3: Commit (only if Step 1 changed anything)**

```bash
git add README.md
git commit -m "docs: README reflects the merged RaidAssign addon

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
