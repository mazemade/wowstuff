-- TrackUI.lua: the human-facing half of Track.lua — a live in-fight list and the
-- /racheck scoreboard with selective whispers. Reads RaidAssignAPI only, so it degrades
-- to an empty list rather than an error if Track.lua or RaidAssign.lua failed to load.

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

-- Never visible at login. Showing is event-driven, not poll-driven: a hidden frame's
-- OnUpdate does not run in the real client, so the poll could never show it back.
-- The poll still hides — it is the safety net for a pull with no tracking payload.
-- Restoring the dragged position must wait for SavedVariables, hence PLAYER_LOGIN.
live:Hide()
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_LOGIN")
loader:RegisterEvent("ENCOUNTER_START")
loader:RegisterEvent("ENCOUNTER_END")
loader:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        local p = RaidAssignDB and RaidAssignDB.livePos
        if p then live:ClearAllPoints(); live:SetPoint(p.point, UIParent, p.point, p.x, p.y)
        else live:SetPoint("LEFT", UIParent, "LEFT", 30, 0) end
    elseif event == "ENCOUNTER_START" then
        if not (RaidAssignDB and RaidAssignDB.liveView == false) then live:Show() end
    else
        live:Hide()
    end
end)
