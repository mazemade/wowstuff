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
local function assertMatch(s, pattern)
    if not tostring(s):find(pattern) then
        error('\n    expected to match: ' .. pattern .. '\n    actual: ' .. tostring(s), 2)
    end
end

local world
-- shown starts true on purpose: TrackUI must hide the live frame explicitly at build
-- time, or it would sit on screen at login. A default of false would hide that bug.
local function MockFrame()
    local f = { scripts = {}, events = {}, text = '', shown = true, enabled = true }
    setmetatable(f, { __index = function() return function() return MockFrame() end end })
    rawset(f, 'SetScript', function(self, k, fn) rawset(self.scripts, k, fn) end)
    rawset(f, 'GetScript', function(self, k) return self.scripts[k] end)
    rawset(f, 'RegisterEvent', function(self, e) self.events[e] = true end)
    rawset(f, 'UnregisterEvent', function(self, e) self.events[e] = nil end)
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
    rawset(f, 'SetChecked', function(self, v) self.checked = v end)
    rawset(f, 'GetChecked', function(self) return self.checked end)
    return f
end

-- opts.raid: array of { name, subgroup, dead, buffs = {names…} }, index = raid index.
local function BuildWorld(opts)
    opts = opts or {}
    world = { time = 0, raid = opts.raid or {}, tracking = opts.tracking,
              frames = {}, messages = {}, sent = {}, raw = {} }
    _G.RaidAssignDB = nil
    _G.RaidAssignLiveFrame = nil
    _G.RaidAssignCheckFrame = nil
    _G.SlashCmdList = {}
    _G.SendChatMessage = function(msg, chan) world.sent[#world.sent + 1] = chan .. ':' .. msg end
    _G.DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) world.messages[#world.messages + 1] = m end }
    _G.UIParent = MockFrame()
    _G.ChatFontNormal = {}
    _G.CreateFrame = function(_, name)
        local f = MockFrame()
        world.frames[#world.frames + 1] = f
        if name then _G[name] = f end
        return f
    end
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
    -- SendRaw is RaidAssign.lua's, which this harness does not load: capture the entries
    -- TrackUI hands over instead, so the assertions are about what would be whispered.
    _G.RaidAssignAPI = {
        GetTracking = function() return world.tracking end,
        SendRaw = function(entries) world.raw[#world.raw + 1] = entries; return true, #entries, {} end,
    }
    dofile('RaidAssign/Track.lua')
    world.tracker = world.frames[1]
    dofile('RaidAssign/TrackUI.lua')
end

-- Every frame's OnUpdate, the way the client drives them: the tracker's scan ticker and
-- TrackUI's refresh poll both live on OnUpdate and neither knows about the other.
local function TickAll(dt)
    for _, fr in ipairs(world.frames) do
        local h = fr.scripts.OnUpdate
        if h then h(fr, dt or 1.0) end
    end
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
    assertEqual(rows[1].who, 'Zug')   -- who to call out on voice
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
    assertEqual(rows[1].who, 'Sham')
    assertEqual(rows[1].have, 1)
    assertEqual(rows[1].total, 2)
end)

-- --- Live view (TrackUI.lua) ---

test('live view appears on pull, rows render, hides on end', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 50
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 60
    TickAll()
    assertEqual(RaidAssignLiveFrame:IsShown(), true)
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'Curse of Elements')
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), '83%%')      -- 50/60
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'down 10s')
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'Zug')       -- callable on voice
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 1)
    TickAll()
    assertEqual(RaidAssignLiveFrame:IsShown(), false)
end)

test('liveView=false keeps the frame hidden', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    RaidAssignDB = { liveView = false }
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    TickAll()
    assertEqual(RaidAssignLiveFrame:IsShown(), false)
end)

-- --- /racheck scoreboard (TrackUI.lua) ---

local function RecordPull(uptimeSecs)
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = world.time + uptimeSecs
    Cleu('SPELL_AURA_REMOVED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = world.time + (100 - uptimeSecs)
    Fire('ENCOUNTER_END', 649, 'Gruul', 173, 25, 0)
end

test('/racheck renders the latest pull with uptime and assignee share', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
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
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
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
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    SlashCmdList['RACHECK']('')
    RaidAssignCheckFrame.whisperBtn:Click()
    assertEqual(#world.raw, 0)
end)

test('prev/next walk stored pulls', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
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
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    SlashCmdList['RACHECK']('')
    assertMatch(world.messages[#world.messages], 'No pulls recorded')
end)

test('/racheck live toggles the live view', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    SlashCmdList['RACHECK']('live')
    assertEqual(RaidAssignDB.liveView, false)
    SlashCmdList['RACHECK']('live')
    assertEqual(RaidAssignDB.liveView, true)
end)

test('post summary goes to raid chat on click only', function()
    BuildWorld({ raid = { { name = 'Zug', subgroup = 1 } },
                 tracking = { debuffs = { COE }, buffs = {} } })
    RecordPull(41)
    assertEqual(#world.sent, 0)
    SlashCmdList['RACHECK']('')
    RaidAssignCheckFrame.postBtn:Click()
    assertEqual(world.sent[1] ~= nil, true)
    assertMatch(world.sent[1], 'RAID:')
    local found = false
    for _, line in ipairs(world.sent) do
        if line:find('Curse of Elements 41%%') then found = true end
    end
    assertEqual(found, true)
end)

test('/racheck demo previews the live view outside a pull', function()
    BuildWorld({ raid = {}, tracking = nil })
    SlashCmdList['RACHECK']('demo')
    TickAll()
    assertEqual(RaidAssignLiveFrame:IsShown(), true)
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), 'Curse of Elements')
    assertMatch(RaidAssignLiveFrame.rows[2]:GetText(), 'down ')
    SlashCmdList['RACHECK']('demo')
    TickAll()
    assertEqual(RaidAssignLiveFrame:IsShown(), false)
end)

test('a real pull overrides the demo rows', function()
    BuildWorld({ raid = {}, tracking = { debuffs = { COE }, buffs = {} } })
    SlashCmdList['RACHECK']('demo')
    Fire('ENCOUNTER_START', 649, 'Gruul', 173, 25)
    Cleu('SPELL_AURA_APPLIED', 'Zug', 'Creature-0-1', 'Curse of the Elements')
    world.time = 20
    TickAll()
    assertMatch(RaidAssignLiveFrame.rows[1]:GetText(), '100%%')  -- live data, not the sample
    assertEqual(RaidAssignLiveFrame.rows[2]:GetText(), '')
end)

print(string.format('\n%d passed, %d failed', passed, failed))
if failed > 0 then os.exit(1) end
