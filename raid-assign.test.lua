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
    local f = { scripts = {}, events = {}, text = '', shown = true, enabled = true }
    setmetatable(f, { __index = function()
        return function() return MockFrame() end
    end })
    rawset(f, 'SetScript', function(self, key, fn) rawset(self.scripts, key, fn) end)
    rawset(f, 'GetScript', function(self, key) return self.scripts[key] end)
    rawset(f, 'RegisterEvent', function(self, e) rawset(self.events, e, true) end)
    rawset(f, 'UnregisterEvent', function(self, e) rawset(self.events, e, nil) end)
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
    -- Singular, as in the live client — the plural SwapRaidSubgroups does not exist
    -- there, and stubbing it under the wrong name let a nil-call bug pass the suite.
    _G.SwapRaidSubgroup = function(i, j)
        world.ops[#world.ops + 1] = 'swap:' .. world.raid[i].name .. '<->' .. world.raid[j].name
        world.raid[i].subgroup, world.raid[j].subgroup =
            world.raid[j].subgroup, world.raid[i].subgroup
    end
    _G.Minimap = MockFrame()
    _G.Minimap.GetCenter = function() return 0, 0 end
    _G.UIParent.GetEffectiveScale = function() return 1 end
    _G.GameTooltip = MockFrame()
    -- Deliberately absent, mirroring wow_anniversary 2.5.6.69110 where type(EasyMenu) is nil
    -- even though UIDropDownMenuTemplate still resolves. The menu must not need it.
    _G.EasyMenu = nil
    _G.GetCursorPosition = function() return world.cursorX or 100, world.cursorY or 0 end
    _G.RaidAssignMinimapButton = nil
    _G.RaidAssignMinimapHub = nil
    -- Track.lua is loaded here too: the hub's status line asks it for the last pull, and a
    -- stub would let the two drift. These are the globals it needs beyond the set above.
    _G.GetTime = function() return world.time or 0 end
    _G.date = function() return '2026-08-15 21:00' end
    _G.UnitIsDeadOrGhost = function() return false end
    _G.UnitAura = function() return nil end
    _G.CombatLogGetCurrentEventInfo = function() return unpack(world.cleu or {}) end
    dofile('RaidAssign/RaidAssign.lua')
    dofile('RaidAssign/Track.lua')
    dofile('RaidAssign/Minimap.lua')
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

-- Fires an event on every frame registered for it, like the client does.
local function Fire(event, ...)
    for _, f in ipairs(world.frames) do
        if f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
    end
end

-- The raid roster changed under the addon: an invite landed, or the raid disbanded.
local function Roster()
    Fire('GROUP_ROSTER_UPDATE')
end

local function Subgroups()
    local out = {}
    for _, r in ipairs(world.raid) do out[r.name] = r.subgroup end
    return out
end

-- A /reload or relog: every Lua local in the addon is gone and the files run again from
-- scratch. Only RaidAssignDB survives, and the client hands it back after the files have
-- run, just before PLAYER_LOGIN — so that is the order this reproduces.
local function Reload(opts)
    local db = _G.RaidAssignDB
    BuildWorld(opts)
    _G.RaidAssignDB = db
    Fire('PLAYER_LOGIN')
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
    assertMatch(RaidAssignFrame.status.text, 'not an RSW1/RSW2/RSW3 payload')
end)

-- --- RSW3: @T compliance-tracking lines ---

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

-- Karazhan 2026-08-18: the client restarted between Maiden of Virtue and the Opera Hall
-- and every one of the ten remaining bosses recorded nothing, silently, because the
-- payload lived only in a local. StartPull's `if not tracking then return end` never
-- fires again once the payload is gone.
test('a reload keeps the tracking payload alive', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    LoadPayload({
        'RSW3',
        'Zug=Your assignments: Curse of Elements',
        '@T D|coe|Curse of Elements|Curse of the Elements|Zug',
        '@T B|soe|Strength of Earth|Strength of Earth|2|Slyvester',
    })
    Reload({ raid = { { name = 'Zug', subgroup = 1 } } })
    local t = RaidAssignAPI.GetTracking()
    assertEqual(t and t.debuffs[1].id, 'coe')
    assertEqual(t and t.buffs[1].provider, 'Slyvester')
end)

-- The whole point of the restore: the next boss after the restart scores again.
test('a boss pulled after a reload is scored against the restored payload', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    LoadPayload({
        'RSW3',
        'Zug=Your assignments: Curse of Elements',
        '@T D|coe|Curse of Elements|Curse of the Elements|Zug',
    })
    Reload({ raid = { { name = 'Zug', subgroup = 1 } } })
    world.time = 0
    Fire('ENCOUNTER_START', 655, 'Opera Hall')
    world.cleu = { 0, 'SPELL_AURA_APPLIED', false, 'Player-1-AAAA', 'Zug', 0, 0,
                   'Creature-0-1-1-1-17535-000', 'Boss', 0, 0, 1, 'Curse of the Elements', 0, 'DEBUFF' }
    Fire('COMBAT_LOG_EVENT_UNFILTERED')
    world.time = 40
    Fire('ENCOUNTER_END', 655, 'Opera Hall', 3, 10, 1)
    local p = (RaidAssignDB.pulls or {})[1]
    assertEqual(p and p.encounter, 'Opera Hall')
    assertEqual(p and p.debuffs[1].uptime, 40)
end)

test('SendRaw whispers without touching send history', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 }, { name = 'Bob', subgroup = 1 } } })
    LoadPayload({ 'RSW3', 'Zug=Hi' }) -- initialise the addon UI path
    local ok = RaidAssignAPI.SendRaw({ { name = 'Zug', body = 'Gruul pull 1: CoE up 41% - assigned to you' } })
    assertEqual(ok, true)
    Tick(2.0) -- one whisper per SEND_INTERVAL tick
    assertEqual(#world.whispers, 1)
    assertMatch(world.whispers[1].body, 'CoE up 41%%')
    assertEqual((RaidAssignDB.lastSent or {})['Zug'], nil)
end)

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

-- Regression: the apply button's enabled state was computed once, in ShowPreview, and the
-- addon registered no events — so a payload loaded before the raid invite left the button
-- dead for the rest of the session. A disabled UIPanelButtonTemplate swallows clicks in the
-- real client, so this is the one path in the file that prints nothing at all: ApplyGroups
-- has a Print on every one of its exit paths, but it is never reached.
test('apply button wakes up when you join the raid after loading the payload', function()
    BuildWorld({ raid = {} })                       -- payload pasted while still solo
    LoadPayload({ 'RSW2', 'Alice=Tank stuff', '@G2=Alice' })
    assertEqual(RaidAssignFrame.applyBtn.enabled, false)
    world.raid = { { name = 'Alice', subgroup = 1 } }  -- the invite lands
    Roster()
    assertEqual(RaidAssignFrame.applyBtn.enabled, true)
end)

test('apply button goes dead again when the raid disbands under it', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    LoadPayload({ 'RSW2', 'Alice=Tank stuff', '@G2=Alice' })
    assertEqual(RaidAssignFrame.applyBtn.enabled, true)
    world.raid = {}
    Roster()
    assertEqual(RaidAssignFrame.applyBtn.enabled, false)
end)

test('RaidAssignAPI.LayoutInfo mirrors the loaded layout', function()
    BuildWorld({ raid = { { name = 'Alice', subgroup = 1 } } })
    assertEqual(RaidAssignAPI.LayoutInfo(), nil)
    LoadPayload({ 'RSW2', '@G1=Alice,Bob' })
    assertMatch(RaidAssignAPI.LayoutInfo(), 'Group layout loaded: 1 groups, 2 players%.')
end)

-- --- Minimap button ---

-- The bug this file exists to prevent: the shipped 2.5.6 client has no EasyMenu global, so
-- the old menu threw on a nil call and the button looked dead. Nothing below may reach for it.
test('the hub opens on a client with no EasyMenu global', function()
    BuildWorld({})
    assertEqual(EasyMenu, nil)
    RaidAssignMinimapButton:Click()
    assertEqual(RaidAssignMinimapHub.shown, true)
end)

test('clicking the minimap button opens a hub with the four actions', function()
    BuildWorld({})
    RaidAssignMinimapButton:Click()
    local texts = {}
    for _, item in ipairs(RaidAssignMinimapHub.items) do
        texts[#texts + 1] = item:GetText()
    end
    assertEqual(table.concat(texts, '|'), 'Scan raid|Assignments…|Apply groups|Check results')
end)

test('hub actions call the scan slash, the assignments slash, and ApplyGroups', function()
    BuildWorld({})
    local scanCalled = false
    _G.SlashCmdList['RAIDSPECSCAN'] = function() scanCalled = true end
    RaidAssignMinimapButton:Click()
    RaidAssignMinimapHub.items[1]:Click()
    assertEqual(scanCalled, true)
    RaidAssignMinimapButton:Click()
    RaidAssignMinimapHub.items[2]:Click()
    assertEqual(RaidAssignFrame ~= nil, true)     -- assignments window built and shown
    assertEqual(RaidAssignFrame.shown, true)
    RaidAssignMinimapButton:Click()
    RaidAssignMinimapHub.items[3]:Click()
    assertMatch(LastMessage(), 'No layout loaded') -- ApplyGroups guard fired
end)

test('choosing an action closes the hub', function()
    BuildWorld({})
    _G.SlashCmdList['RAIDSPECSCAN'] = function() end
    RaidAssignMinimapButton:Click()
    RaidAssignMinimapHub.items[1]:Click()
    assertEqual(RaidAssignMinimapHub.shown, false)
end)

test('clicking the button again toggles the hub shut', function()
    BuildWorld({})
    RaidAssignMinimapButton:Click()
    assertEqual(RaidAssignMinimapHub.shown, true)
    RaidAssignMinimapButton:Click()
    assertEqual(RaidAssignMinimapHub.shown, false)
end)

test('minimap hub: four actions, status lines refresh on open', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } } })
    _G.SlashCmdList['RACHECK'] = function() end
    RaidAssignDB = { pulls = { { encounter = 'Gruul', ordinal = 3, duration = 100, success = false,
        debuffs = { { id = 'coe', name = 'Curse of Elements', player = 'Zug', uptime = 41, byAssignee = 41 } },
        buffs = {} } } }
    RaidAssignMinimapButton.scripts.OnClick(RaidAssignMinimapButton)
    assertEqual(RaidAssignMinimapHub:IsShown(), true)
    assertEqual(#RaidAssignMinimapHub.items, 4)
    assertEqual(RaidAssignMinimapHub.items[4]:GetText(), 'Check results')
    assertMatch(RaidAssignMinimapHub.status2:GetText(), 'Gruul #3')
    -- clicking an action hides the hub
    RaidAssignMinimapHub.items[4]:Click()
    assertEqual(RaidAssignMinimapHub:IsShown(), false)
end)

test('minimap hub: status lines say so when nothing is loaded or recorded', function()
    BuildWorld({})
    RaidAssignMinimapButton:Click()
    assertMatch(RaidAssignMinimapHub.status1:GetText(), 'No payload loaded%.')
    assertMatch(RaidAssignMinimapHub.status2:GetText(), 'No pulls recorded%.')
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

print(string.format('\n%d passed, %d failed', passed, failed))
os.exit(failed == 0 and 0 or 1)
