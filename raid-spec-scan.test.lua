-- Tests for RaidSpecScan.lua. Run from the repo root:
--
--     luajit raid-spec-scan.test.lua
--
-- The addon is pure logic over WoW's global functions, so the whole file loads under plain
-- LuaJIT once those globals are stubbed. Tests drive the real code path a scan takes —
-- /specscan, an OnUpdate tick, the inspect event, a final tick — and assert on the RSS3
-- string that lands in the export box. Nothing reaches into the addon's locals.

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

-- Every frame method the addon touches is either a no-op or a frame constructor, so one
-- catch-all metatable covers CreateFontString, SetBackdrop, SetPoint and the rest. SetScript
-- and SetText are the two we actually care about: the first hands us the addon's OnUpdate and
-- OnEvent handlers, the second is how the finished export string escapes.
local captured = {}

local function MockFrame()
    local f = { scripts = {} }
    setmetatable(f, { __index = function()
        return function() return MockFrame() end
    end })
    rawset(f, 'SetScript', function(self, key, fn) rawset(self.scripts, key, fn) end)
    rawset(f, 'SetText', function(_, text) captured[#captured + 1] = text end)
    return f
end

-- The fixture is a single rogue standing in the raid with two saved specs. Group 1 is the
-- stale one the client hands out when nobody names a group; group 2 is what he is actually
-- playing. Talent counts match across groups because the number of talents in a tree is a
-- property of the tree, not of the spec.
local XAVAMROS = {
    name = 'Xavamros', class = 'ROGUE', race = 'Scourge', guid = 'Player-Xavamros', subgroup = 1,
    activeGroup = 2,
    specs = {
        [1] = { -- Subtlety: the offspec that leaked into the bad export
            points = { 20, 0, 41 },
            talents = {
                [1] = { { name = 'Improved Expose Armor', rank = 0 } },
                [2] = {},
                [3] = { { name = 'Hemorrhage', rank = 1 } },
            },
        },
        [2] = { -- Combat: what he actually raids as
            points = { 15, 41, 5 },
            talents = {
                [1] = { { name = 'Improved Expose Armor', rank = 2 } },
                [2] = {},
                [3] = { { name = 'Hemorrhage', rank = 0 } },
            },
        },
    },
}

-- opts.dualSpec = false models a client that never gained dual spec: GetActiveTalentGroup does
-- not exist and the talentGroup argument is ignored, so only spec 1 is readable.
--
-- opts.activeGroupUnknown = true models the dangerous middle case: the unit demonstrably has
-- two specs, but the client will not say which one is live — inspect data that was not fully
-- populated when INSPECT_READY fired, say.
local function BuildWorld(player, opts)
    opts = opts or {}
    local dualSpec = opts.dualSpec ~= false
    local activeKnown = opts.activeGroupUnknown ~= true
    captured = {}

    -- Reproduces the behaviour under test: asked for no particular group, the client answers
    -- for saved spec 1 rather than the unit's active one.
    local function SpecFor(group)
        if not dualSpec then return player.specs[1] end
        return player.specs[group or 1] or player.specs[1]
    end

    _G.RaidSpecScanExportFrame = nil
    _G.UIParent = MockFrame()
    _G.ChatFontNormal = {}
    _G.DEFAULT_CHAT_FRAME = { AddMessage = function() end }
    _G.SlashCmdList = {}

    local frames = {}
    _G.CreateFrame = function(_, name)
        local f = MockFrame()
        frames[#frames + 1] = f
        if name then _G[name] = f end
        return f
    end

    _G.GetActiveTalentGroup = (dualSpec and activeKnown) and function() return player.activeGroup end or nil
    _G.GetNumTalentGroups = dualSpec and function() return #player.specs end or nil

    _G.GetTalentTabInfo = function(tab, _, _, group)
        local spec = SpecFor(group)
        -- id, name, description, iconTexture, pointsSpent, fileName
        return 100 + tab, 'Tab' .. tab, '', '', spec.points[tab], ''
    end

    _G.GetNumTalentTabs = function() return 3 end
    _G.GetNumTalents = function(tab) return #(player.specs[1].talents[tab] or {}) end

    _G.GetTalentInfo = function(tab, index, _, _, group)
        local entry = SpecFor(group).talents[tab][index]
        if not entry then return nil end
        -- name, iconTexture, tier, column, rank
        return entry.name, '', 1, 1, entry.rank
    end

    _G.IsInRaid = function() return true end
    _G.GetNumGroupMembers = function() return 1 end
    _G.UnitExists = function(unit) return unit == 'raid1' end
    _G.UnitName = function() return player.name end
    _G.UnitClass = function() return player.class, player.class end
    _G.UnitRace = function() return player.race, player.race end
    _G.UnitGUID = function() return player.guid end
    _G.UnitIsUnit = function(unit, other) return unit == other end
    _G.UnitIsConnected = function() return true end
    _G.CanInspect = function() return true end
    _G.NotifyInspect = function() end
    _G.ClearInspectPlayer = function() end
    _G.GetRaidRosterInfo = function(i)
        if i ~= 1 then return nil end
        return player.name, 0, player.subgroup
    end

    dofile('RaidSpecScan/RaidSpecScan.lua')
    return frames[1]
end

-- Walks a full scan of one inspected raid member and returns the exported RSS3 string.
local function RunScan(player, opts)
    local frame = BuildWorld(player, opts)
    _G.SlashCmdList['RAIDSPECSCAN']()
    frame.scripts.OnUpdate(frame, 0.1)                          -- pulls raid1 off the queue, inspects
    frame.scripts.OnEvent(frame, 'INSPECT_READY', player.guid)  -- inspect data arrives
    frame.scripts.OnUpdate(frame, 0.1)                          -- queue empty, opens the export

    for i = #captured, 1, -1 do
        if captured[i]:sub(1, 5) == 'RSS3;' then return captured[i] end
    end
    error('no RSS3 export was produced')
end

test('inspected player on their second spec exports the ACTIVE spec, not saved spec 1', function()
    assertEqual(RunScan(XAVAMROS),
        'RSS3;Xavamros:ROGUE:15/41/5:1:Scourge:hemorrhage=0,impExposeArmor=2')
end)

test('tracked talent ranks come from the active spec too', function()
    -- Guards the half of the bug that is easy to miss: points and ranks are read by two
    -- different functions, so a fix that only threads the group into one of them still
    -- exports combat point totals with subtlety talent ranks attached.
    local export = RunScan(XAVAMROS)
    assertEqual(export:match('hemorrhage=(%d+)'), '0')
    assertEqual(export:match('impExposeArmor=(%d+)'), '2')
end)

test('client without dual spec still exports its only spec', function()
    -- Degrade path: no GetActiveTalentGroup, so the group stays nil and behaviour is exactly
    -- what it is today. Passes before and after the fix by design — it is here to catch a fix
    -- that assumes the API exists.
    assertEqual(RunScan(XAVAMROS, { dualSpec = false }),
        'RSS3;Xavamros:ROGUE:20/0/41:1:Scourge:hemorrhage=1,impExposeArmor=0')
end)

test('dual-spec player whose active group is undeterminable exports "?" rather than a guess', function()
    -- The addon's existing rule, applied to one more way of being wrong: an unreadable player
    -- must look obviously unscanned so they get fixed by hand, instead of silently inheriting
    -- saved spec 1 and reading as a confident answer.
    assertEqual(RunScan(XAVAMROS, { activeGroupUnknown = true }),
        'RSS3;Xavamros:ROGUE:?:1:Scourge:')
end)

print(string.format('\n%d passed, %d failed', passed, failed))
os.exit(failed == 0 and 0 or 1)
