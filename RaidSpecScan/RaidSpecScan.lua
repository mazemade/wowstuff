-- RaidSpecScan: exports raid class + talent point totals for the assignments web tool.
-- Usage: /specscan while in a raid. Players out of inspect range (28yd), offline,
-- or timing out export as "?" and get fixed manually in the web tool.

local ADDON, ns = ...

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
ns.Print = Print

-- 2.5.6: GetTalentTabInfo(tab, isInspect) -> id, name, description, iconTexture, pointsSpent, fileName
-- Read pointsSpent by position, the way every other addon on this client does. An earlier
-- version scanned for "the first numeric return" and picked up `id` instead — a few hundred,
-- so the highest tab id always won and every player got the same confidently wrong spec.
local function TabPoints(tab, isInspect)
    local _, _, _, _, pointsSpent = GetTalentTabInfo(tab, isInspect)
    return tonumber(pointsSpent) or 0
end

-- 61 points at level 70; the headroom is slack, not a real cap.
local MAX_TALENT_POINTS = 71

-- Returns "?" rather than a number triple whenever the totals are impossible, so a future
-- signature change shows up as an obviously unscanned player instead of a plausible lie.
local function TalentString(isInspect)
    local t1, t2, t3 = TabPoints(1, isInspect), TabPoints(2, isInspect), TabPoints(3, isInspect)
    local total = t1 + t2 + t3
    if total == 0 or total > MAX_TALENT_POINTS then return "?" end
    return t1 .. "/" .. t2 .. "/" .. t3
end

local function AddResult(unit, points)
    local name = UnitName(unit)
    local _, classToken = UnitClass(unit)
    if name and classToken then
        table.insert(results, name .. ":" .. classToken .. ":" .. points)
    end
end

local function ShowExport()
    local text = "RSS1;" .. table.concat(results, ";")
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

local function FinishUnit(points)
    AddResult(current, points)
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
        AddResult(current, TalentString(false)) -- own talents readable directly
        current = nil
        return -- OnUpdate picks the next unit next frame
    end
    if not UnitIsConnected(current) or not CanInspect(current) then
        AddResult(current, "?")
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
    FinishUnit(TalentString(true))
end)

local function OnUpdate(_, dt)
    if not scanning then return end
    if current then
        elapsed = elapsed + dt
        if elapsed > INSPECT_TIMEOUT then
            FinishUnit("?") -- timed out, mark unscanned
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

