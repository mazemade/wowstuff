-- Track.lua: scores a boss pull against the loaded tracking payload (RSW3 @T lines).
-- Boss debuffs come from the combat log with source attribution; group buffs (Task 5)
-- from periodic UnitAura scans. Results land in RaidAssignDB.pulls, newest last, capped.
-- Talks to the rest of the addon only through RaidAssignAPI: if RaidAssign.lua failed to
-- load, GetTracking is nil and this file stays inert.
--
-- Matching is by English aura NAME, never spell id: both the combat log and UnitAura
-- report names, names are stable across ranks, and an id list silently misses a rank.

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
    for _, t in ipairs(tracking.buffs or {}) do
        table.insert(active.buffs, { id = t.id, name = t.name, set = AuraSet(t.auras),
            group = t.group, provider = t.provider, members = {} })
    end
    if #active.buffs > 0 then f:SetScript("OnUpdate", ScanTick) end
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
    for _, b in ipairs(active.buffs) do
        local sum, n = 0, 0
        for _, m in pairs(b.members) do
            if m.alive > 0 then sum = sum + m.buffed / m.alive; n = n + 1 end
        end
        table.insert(rec.buffs, { id = b.id, name = b.name, group = b.group,
            provider = b.provider, fraction = (n > 0) and (sum / n) or 0 })
    end
    RaidAssignDB = RaidAssignDB or {}
    RaidAssignDB.pulls = RaidAssignDB.pulls or {}
    table.insert(RaidAssignDB.pulls, rec)
    while #RaidAssignDB.pulls > PULL_CAP do table.remove(RaidAssignDB.pulls, 1) end
    active = nil
    f:UnregisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
    f:SetScript("OnUpdate", nil)
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
