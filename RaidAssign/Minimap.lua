-- Minimap button: one icon opening a small hub — status lines plus four actions. Talks to
-- the other files only through their slash handlers and RaidAssignAPI, so a load failure on
-- either side leaves the rest working.

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

-- The hub is hand-rolled out of plain frames rather than built on EasyMenu /
-- UIDropDownMenuTemplate. On wow_anniversary 2.5.6.69110 the template still resolves but the
-- EasyMenu global is gone, so the wrapper call threw on a nil and the button looked dead —
-- WoW swallows addon errors unless scriptErrors is on, so it failed silently. Nothing below
-- touches the stock dropdown machinery, which also keeps the "no addon libraries" rule.
-- A small anchored panel with real buttons also carries status (payload? last pull?) that
-- a cursor menu had no room for.
local HUB_W, BTN_H, PAD = 190, 22, 10

local ACTIONS = {
    { text = "Scan raid",     run = function() SlashCmdList["RAIDSPECSCAN"]("") end },
    { text = "Assignments…",  run = function() SlashCmdList["RAIDASSIGN"]("") end },
    { text = "Apply groups",  run = function() RaidAssignAPI.ApplyGroups() end },
    { text = "Check results", run = function() SlashCmdList["RACHECK"]("") end },
}

local hub

local function BuildHub()
    local f = CreateFrame("Frame", "RaidAssignMinimapHub", UIParent, "BackdropTemplate")
    f:SetFrameStrata("DIALOG")
    f:EnableMouse(true)
    f:SetSize(HUB_W, PAD + 16 + 2 * 13 + 6 + #ACTIONS * (BTN_H + 4) + PAD)
    f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 16,
        insets = { left = 4, right = 4, top = 4, bottom = 4 } })

    local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    title:SetPoint("TOPLEFT", PAD, -PAD)
    title:SetText("RaidAssign")

    f.status1 = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    f.status1:SetPoint("TOPLEFT", PAD, -(PAD + 16))
    f.status1:SetJustifyH("LEFT")
    f.status2 = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    f.status2:SetPoint("TOPLEFT", PAD, -(PAD + 16 + 13))
    f.status2:SetJustifyH("LEFT")

    f.items = {}
    for i, action in ipairs(ACTIONS) do
        local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        b:SetSize(HUB_W - 2 * PAD, BTN_H)
        b:SetPoint("TOPLEFT", PAD, -(PAD + 16 + 2 * 13 + 6 + (i - 1) * (BTN_H + 4)))
        b:SetText(action.text)
        -- The template's own font string is not reachable from the test harness, so the
        -- label mirrors the text: one hidden font string, and the button's name stays
        -- assertable. The client draws both identically.
        local label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        label:SetPoint("CENTER")
        label:SetText(action.text)
        b.label = label
        b:SetScript("OnClick", function()
            f:Hide()
            action.run()
        end)
        f.items[i] = b
    end
    f:Hide()
    return f
end

-- Both statuses are guarded: Track.lua may have failed to load, and the addon's files are
-- required to keep working alone.
local function RefreshHub()
    hub.status1:SetText((RaidAssignAPI.LayoutInfo and RaidAssignAPI.LayoutInfo()) or "No payload loaded.")
    hub.status2:SetText((RaidAssignAPI.LastPullInfo and RaidAssignAPI.LastPullInfo()) or "No pulls recorded.")
end

btn:SetScript("OnClick", function()
    hub = hub or BuildHub()
    if hub:IsShown() then hub:Hide() return end
    RefreshHub()
    hub:ClearAllPoints()
    hub:SetPoint("TOPRIGHT", btn, "BOTTOMLEFT", 0, 0)
    hub:Show()
end)

btn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("RaidAssign")
    GameTooltip:AddLine(RaidAssignAPI.LayoutInfo() or "No payload loaded.", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Click to open the hub. Drag to move.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
end)
btn:SetScript("OnLeave", function() GameTooltip:Hide() end)

-- SavedVariables are not loaded while this file runs; place the button at the default
-- immediately so it is never at 0,0, then again at login from the saved angle.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", Reposition)
Reposition()
