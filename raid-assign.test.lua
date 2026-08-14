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
