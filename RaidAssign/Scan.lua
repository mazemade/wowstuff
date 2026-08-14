-- RaidSpecScan: exports raid class + talent point totals for the assignments web tool.
-- Usage: /specscan while in a raid. Players out of inspect range (28yd), offline,
-- or timing out export as "?" and get fixed manually in the web tool.

local INSPECT_TIMEOUT = 3 -- seconds per player before giving up

local frame = CreateFrame("Frame")
local queue = {}          -- raid unit ids still to inspect
local results = {}        -- ordered list of {name, class, points}
local current = nil       -- unit currently being inspected
local elapsed = 0
local scanning = false

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99[RaidSpecScan]|r " .. msg)
end

-- GetTalentTabInfo(tab, isInspect, isPet, talentGroup) -> id, name, description, iconTexture,
-- pointsSpent, fileName. Read pointsSpent by position, the way every other addon on this client
-- does. An earlier version scanned for "the first numeric return" and picked up `id` instead —
-- a few hundred, so the highest tab id always won and every player got the same confidently
-- wrong spec.
--
-- talentGroup is NOT optional in practice. Omit it on a dual-spec client and you get saved
-- spec 1, which is whatever the player last saved in that slot — not what they are raiding as.
-- That exported a whole raid's offspecs once. Clients that never gained the parameter ignore
-- the extra arguments, so passing them is safe everywhere.
local function TabPoints(tab, isInspect, group)
    local _, _, _, _, pointsSpent = GetTalentTabInfo(tab, isInspect, false, group)
    return tonumber(pointsSpent) or 0
end

-- Missing or unsupported means one spec exists, so there is nothing to be wrong about.
local function GroupCount(isInspect)
    if type(GetNumTalentGroups) ~= "function" then return 1 end
    local ok, count = pcall(GetNumTalentGroups, isInspect, false)
    if ok and type(count) == "number" and count > 0 then return count end
    return 1
end

-- Returns the talent group to read, plus "we could not tell". A nil group is only safe when the
-- unit has ONE spec — then it means "this client has no talent groups" and the talent API's own
-- default is the only answer there is. A nil group on a unit with TWO specs is the dangerous
-- case: the API would quietly hand back saved spec 1, which is a plausible-looking lie of
-- exactly the kind this addon exports "?" for everywhere else. Happens when inspect data has
-- not finished populating by the time INSPECT_READY fires.
--
-- pcall because a client that exposes the name without supporting inspect groups should degrade
-- to an obviously-unscanned player rather than abort the whole raid scan.
local function ActiveGroup(isInspect)
    if type(GetActiveTalentGroup) == "function" then
        local ok, group = pcall(GetActiveTalentGroup, isInspect, false)
        if ok and type(group) == "number" and group > 0 then return group, false end
    end
    return nil, GroupCount(isInspect) > 1
end

-- 61 points at level 70; the headroom is slack, not a real cap.
local MAX_TALENT_POINTS = 71

-- Returns "?" rather than a number triple whenever the totals are impossible, so a future
-- signature change shows up as an obviously unscanned player instead of a plausible lie.
local function TalentString(isInspect, group)
    local t1, t2, t3 = TabPoints(1, isInspect, group), TabPoints(2, isInspect, group), TabPoints(3, isInspect, group)
    local total = t1 + t2 + t3
    if total == 0 or total > MAX_TALENT_POINTS then return "?" end
    return t1 .. "/" .. t2 .. "/" .. t3
end

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

-- The talents the web tool reasons about, under a stable key it also knows. Matching on the
-- English name is safe here because /specscan inspects the whole raid from ONE client — the
-- scanner's — so only that client's locale is ever involved.
local TRACKED_TALENTS = {
    ROGUE   = { impExposeArmor  = "Improved Expose Armor",
                hemorrhage      = "Hemorrhage" },
    WARRIOR = { impThunderClap  = "Improved Thunder Clap",
                impDemoShout    = "Improved Demoralizing Shout" },
    PALADIN = { impSealCrusader = "Improved Seal of the Crusader",
                kings           = "Blessing of Kings",
                impMight        = "Improved Blessing of Might",
                impWisdom       = "Improved Blessing of Wisdom" },
    WARLOCK = { malediction     = "Malediction" },
    DRUID   = { impFaerieFire   = "Improved Faerie Fire",
                feralAggression = "Feral Aggression",
                insectSwarm     = "Insect Swarm" },
    MAGE    = { impScorch       = "Improved Scorch",
                wintersChill    = "Winter's Chill" },
    HUNTER  = { impHuntersMark  = "Improved Hunter's Mark" },
}

-- Emits "key=rank" for every tracked talent of this class, INCLUDING rank 0. An untaken talent
-- must read as "=0" rather than being left out, or the web tool cannot tell "they did not take
-- it" from "we have no data at all". A name we cannot find is omitted instead, which reads as
-- unknown — the honest answer if a talent is ever renamed out from under us.
local function TalentPairs(classToken, isInspect, group)
    local wanted = TRACKED_TALENTS[classToken]
    if not wanted then return "" end
    local found = {}
    local tabs = (GetNumTalentTabs and GetNumTalentTabs()) or 3
    for tab = 1, tabs do
        local count = (GetNumTalents and GetNumTalents(tab)) or 0
        for i = 1, count do
            local name, _, _, _, rank = GetTalentInfo(tab, i, isInspect, false, group)
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

-- RSS3 is positional with fixed slots: name:CLASS:points:subgroup:race:talents. Every field
-- after points may be empty and is independent of the others. RSS2 nested race inside the
-- subgroup check, so one missing subgroup silently took the race with it.
-- `group` is resolved once per unit by the caller and passed down rather than looked up again
-- here: points and talent ranks are read by two different functions against a live inspect that
-- FinishUnit clears immediately afterwards, so two independent lookups can straddle a change and
-- pair one spec's totals with the other spec's ranks — worse than being consistently wrong.
local function AddResult(unit, points, isInspect, group)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if not (name and classToken) then return end
    local subgroup = SubgroupOf(unit, name)
    -- Second return is the locale-independent token ("Draenei"); the first is localized and
    -- would break the web tool on a non-English client.
    local _, raceToken = UnitRace(unit)
    -- A player we could not scan has no talent data either; "?" points and an empty talent
    -- field must travel together.
    local talents = (points ~= "?") and TalentPairs(classToken, isInspect, group) or ""
    local line = name .. ":" .. classToken .. ":" .. points
        .. ":" .. (subgroup and tostring(subgroup) or "")
        .. ":" .. (raceToken or "")
        .. ":" .. talents
    table.insert(results, line)
end

local function ShowExport()
    local text = "RSS3;" .. table.concat(results, ";")
    local f = RaidSpecScanExportFrame
    if not f then
        f = CreateFrame("Frame", "RaidSpecScanExportFrame", UIParent, "BackdropTemplate")
        f:SetSize(500, 300)
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

        local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        title:SetPoint("TOP", 0, -16)
        title:SetText("RaidSpecScan export — Ctrl+A, Ctrl+C, paste into the web tool")

        local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 20, -40)
        scroll:SetPoint("BOTTOMRIGHT", -30, 50)

        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetMultiLine(true)
        edit:SetFontObject(ChatFontNormal)
        edit:SetWidth(440)
        edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() f:Hide() end)
        scroll:SetScrollChild(edit)
        f.editBox = edit

        local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        close:SetSize(80, 22)
        close:SetPoint("BOTTOM", 0, 16)
        close:SetText("Close")
        close:SetScript("OnClick", function() f:Hide() end)
    end
    f.editBox:SetText(text)
    f.editBox:HighlightText()
    f.editBox:SetFocus()
    f:Show()
end

local function FinishUnit(points, isInspect, group)
    AddResult(current, points, isInspect, group)
    ClearInspectPlayer()
    current = nil
    elapsed = 0
end

local function NextUnit()
    if #queue == 0 then
        scanning = false
        frame:SetScript("OnUpdate", nil)
        Print("Scan complete: " .. #results .. " players. Opening export…")
        ShowExport()
        return
    end
    current = table.remove(queue, 1)
    elapsed = 0
    if UnitIsUnit(current, "player") then
        -- own talents readable directly
        local group, unknown = ActiveGroup(false)
        AddResult(current, unknown and "?" or TalentString(false, group), false, group)
        current = nil
        return -- OnUpdate picks the next unit next frame
    end
    if not UnitIsConnected(current) or not CanInspect(current) then
        AddResult(current, "?", false)
        current = nil
        return
    end
    NotifyInspect(current)
end

-- 2.5.6 fires INSPECT_READY(guid); older TBC builds used INSPECT_TALENT_READY. Registering an
-- event the client doesn't know throws, and that would abort this file before /specscan is
-- registered at the bottom — so try both names and keep whichever the client accepts.
local inspectEvents = {}
for _, e in ipairs({ "INSPECT_READY", "INSPECT_TALENT_READY" }) do
    if pcall(frame.RegisterEvent, frame, e) then inspectEvents[e] = true end
end
if not next(inspectEvents) then
    Print("|cFFFF6B6BNo inspect event available on this client — /specscan will report everyone as ?|r")
end

frame:SetScript("OnEvent", function(_, event, guid)
    if not (inspectEvents[event] and scanning and current) then return end
    -- INSPECT_READY names the unit it answers for. A reply that lands after we gave up on
    -- someone would otherwise be recorded against whoever is being inspected now — a confident
    -- but wrong spec. Ignoring it lets the timeout mark that player "?" instead.
    if guid and UnitGUID(current) ~= guid then return end
    local group, unknown = ActiveGroup(true)
    FinishUnit(unknown and "?" or TalentString(true, group), true, group)
end)

local function OnUpdate(_, dt)
    if not scanning then return end
    if current then
        elapsed = elapsed + dt
        if elapsed > INSPECT_TIMEOUT then
            FinishUnit("?", true) -- timed out, mark unscanned
        end
    else
        NextUnit()
    end
end

SLASH_RAIDSPECSCAN1 = "/specscan"
SlashCmdList["RAIDSPECSCAN"] = function()
    if scanning then Print("Already scanning.") return end
    if not IsInRaid() then Print("You must be in a raid.") return end
    queue = {}
    results = {}
    for i = 1, GetNumGroupMembers() do
        local unit = "raid" .. i
        if UnitExists(unit) then table.insert(queue, unit) end
    end
    scanning = true
    Print("Scanning " .. #queue .. " raid members (stay within 28yd)…")
    frame:SetScript("OnUpdate", OnUpdate)
end

