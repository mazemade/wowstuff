-- Minimap button: one icon, three actions. Talks to the other files only through their
-- slash handlers and RaidAssignAPI, so a load failure on either side leaves the rest working.

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

-- The menu is hand-rolled out of plain frames rather than built on EasyMenu /
-- UIDropDownMenuTemplate. On wow_anniversary 2.5.6.69110 the template still resolves but the
-- EasyMenu global is gone, so the wrapper call threw on a nil and the button looked dead —
-- WoW swallows addon errors unless scriptErrors is on, so it failed silently. Nothing below
-- touches the stock dropdown machinery, which also keeps the "no addon libraries" rule.
local WHITE = "Interface\\Buttons\\WHITE8X8"
local MENU_W, ROW_H, TITLE_H, PAD = 150, 18, 16, 6

local ACTIONS = {
    { text = "Scan raid",    run = function() SlashCmdList["RAIDSPECSCAN"]("") end },
    { text = "Assignments…", run = function() SlashCmdList["RAIDASSIGN"]("") end },
    { text = "Apply groups", run = function() RaidAssignAPI.ApplyGroups() end },
}

local menu

local function BuildMenu()
    local f = CreateFrame("Frame", "RaidAssignMinimapMenu", UIParent)
    f:SetFrameStrata("DIALOG")
    f:EnableMouse(true)
    f:SetSize(MENU_W, PAD + TITLE_H + #ACTIONS * ROW_H + PAD)

    local border = f:CreateTexture(nil, "BACKGROUND")
    border:SetAllPoints()
    border:SetTexture(WHITE)
    border:SetVertexColor(0.45, 0.45, 0.45, 0.95)

    local bg = f:CreateTexture(nil, "BORDER")
    bg:SetPoint("TOPLEFT", 1, -1)
    bg:SetPoint("BOTTOMRIGHT", -1, 1)
    bg:SetTexture(WHITE)
    bg:SetVertexColor(0.05, 0.05, 0.05, 0.95)

    local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    title:SetPoint("TOPLEFT", PAD + 2, -PAD)
    title:SetText("RaidAssign")

    f.items = {}
    for i, action in ipairs(ACTIONS) do
        local b = CreateFrame("Button", nil, f)
        b:SetSize(MENU_W - 2 * PAD, ROW_H)
        b:SetPoint("TOPLEFT", PAD, -(PAD + TITLE_H + (i - 1) * ROW_H))
        b:SetHighlightTexture(WHITE)
        local hl = b:GetHighlightTexture()
        if hl then hl:SetVertexColor(1, 1, 1, 0.18) end
        local label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        label:SetPoint("LEFT", 2, 0)
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

btn:SetScript("OnClick", function()
    menu = menu or BuildMenu()
    if menu:IsShown() then menu:Hide() return end
    -- Anchor the top-left corner at the cursor, in UI (not screen) coordinates.
    local cx, cy = GetCursorPosition()
    local scale = UIParent:GetEffectiveScale()
    menu:ClearAllPoints()
    menu:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", cx / scale, cy / scale)
    menu:Show()
end)

btn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("RaidAssign")
    GameTooltip:AddLine(RaidAssignAPI.LayoutInfo() or "No payload loaded.", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Click for options. Drag to move.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
end)
btn:SetScript("OnLeave", function() GameTooltip:Hide() end)

-- SavedVariables are not loaded while this file runs; place the button at the default
-- immediately so it is never at 0,0, then again at login from the saved angle.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_LOGIN")
loader:SetScript("OnEvent", Reposition)
Reposition()
