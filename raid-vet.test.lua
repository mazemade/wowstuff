-- Tests for RaidAssign/Vet.lua (the copy-a-vetting-link half of the RaidAssign addon). Run from
-- the repo root:
--
--     luajit raid-vet.test.lua
--
-- Same shape as raid-spec-scan.test.lua: stub the WoW globals, dofile the real addon file, drive
-- it through a chat click, a whisper event and the /vet command, and assert on the link that lands
-- in the copy box. Nothing reaches into the addon's locals.

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

local BASE = 'https://wowstuff-production.up.railway.app/vetting.html#add='

-- Everything the addon's copy box does is SetText on an EditBox, so that is the one method that
-- records; every other frame method is a no-op or a frame constructor. The event frame's
-- OnEvent handler is picked up through SetScript.
local captured, printed, frames, originalRefs

local function MockFrame()
    local f = { scripts = {} }
    setmetatable(f, { __index = function()
        return function() return MockFrame() end
    end })
    rawset(f, 'SetScript', function(self, key, fn) rawset(self.scripts, key, fn) end)
    rawset(f, 'SetText', function(_, text) captured[#captured + 1] = text end)
    return f
end

local function BuildWorld(opts)
    opts = opts or {}
    captured, printed, frames, originalRefs = {}, {}, {}, {}

    _G.RaidAssignVetFrame = nil
    _G.UIParent = MockFrame()
    _G.ChatFontNormal = {}
    _G.DEFAULT_CHAT_FRAME = { AddMessage = function(_, msg) printed[#printed + 1] = msg end }
    _G.SlashCmdList = {}
    _G.CreateFrame = function(_, name)
        local f = MockFrame()
        frames[#frames + 1] = f
        if name then _G[name] = f end
        return f
    end
    _G.IsControlKeyDown = function() return opts.ctrl == true end
    _G.UnitName = function(unit)
        if unit == 'target' then return opts.target end
        return nil
    end
    -- The stock handler the addon wraps. Whatever it is not interested in must reach this.
    _G.SetItemRef = function(...) originalRefs[#originalRefs + 1] = { ... } end

    dofile('RaidAssign/Vet.lua')
end

local function EventFrame()
    for _, f in ipairs(frames) do
        if f.scripts.OnEvent then return f end
    end
    error('no event frame registered an OnEvent handler')
end

local function LastLink()
    for i = #captured, 1, -1 do
        if captured[i]:sub(1, #BASE) == BASE then return captured[i] end
    end
    error('no vetting link was put in the copy box')
end

test('ctrl+click on a chat name copies a vetting link with the name percent-encoded', function()
    BuildWorld({ ctrl = true })
    _G.SetItemRef('player:Náme:12:WHISPER:Náme', '|Hplayer:Náme:12:WHISPER:Náme|h[Náme]|h', 'LeftButton', {})
    assertEqual(LastLink(), BASE .. 'N%C3%A1me')
    assertEqual(#originalRefs, 0)
end)

test('ctrl+click strips a cross-realm suffix', function()
    BuildWorld({ ctrl = true })
    _G.SetItemRef('player:Xavamros-Spineshatter:12:WHISPER:Xavamros-Spineshatter', '', 'LeftButton', {})
    assertEqual(LastLink(), BASE .. 'Xavamros')
end)

test('a plain click on a chat name reaches the stock handler untouched', function()
    BuildWorld({ ctrl = false })
    _G.SetItemRef('player:Xavamros:12:WHISPER:Xavamros', 'text', 'LeftButton', 'chatframe')
    assertEqual(#captured, 0)
    assertEqual(#originalRefs, 1)
    assertEqual(originalRefs[1][1], 'player:Xavamros:12:WHISPER:Xavamros')
    assertEqual(originalRefs[1][4], 'chatframe')
end)

test('ctrl+click on a non-player link reaches the stock handler', function()
    BuildWorld({ ctrl = true })
    _G.SetItemRef('item:29434:0:0:0', 'text', 'LeftButton', {})
    assertEqual(#captured, 0)
    assertEqual(#originalRefs, 1)
end)

test('/vet list copies one link holding everyone who whispered, in order, without repeats', function()
    BuildWorld()
    local f = EventFrame()
    f.scripts.OnEvent(f, 'CHAT_MSG_WHISPER', 'inv pls', 'Pepasexa')
    f.scripts.OnEvent(f, 'CHAT_MSG_WHISPER', 'can i come', 'Náme-Spineshatter')
    f.scripts.OnEvent(f, 'CHAT_MSG_WHISPER', 'hello?', 'Pepasexa')
    _G.SlashCmdList['RAIDVET']('list')
    assertEqual(LastLink(), BASE .. 'Pepasexa,N%C3%A1me')
end)

test('/vet list with nobody whispering says so instead of opening an empty link', function()
    BuildWorld()
    _G.SlashCmdList['RAIDVET']('list')
    assertEqual(#captured, 0)
    assertEqual(#printed, 1)
end)

test('/vet with no argument copies the current target', function()
    BuildWorld({ target = 'Svartneon' })
    _G.SlashCmdList['RAIDVET']('')
    assertEqual(LastLink(), BASE .. 'Svartneon')
end)

test('/vet with no argument and no target prints help', function()
    BuildWorld()
    _G.SlashCmdList['RAIDVET']('')
    assertEqual(#captured, 0)
    assertEqual(#printed, 1)
end)

test('/vet <name> copies that name', function()
    BuildWorld()
    _G.SlashCmdList['RAIDVET']('  Pepasexa-Spineshatter ')
    assertEqual(LastLink(), BASE .. 'Pepasexa')
end)

print(string.format('\n%d passed, %d failed', passed, failed))
os.exit(failed == 0 and 0 or 1)
