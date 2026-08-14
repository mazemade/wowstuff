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

local menuFrame
btn:SetScript("OnClick", function()
    menuFrame = menuFrame or CreateFrame("Frame", "RaidAssignMinimapMenu", UIParent, "UIDropDownMenuTemplate")
    EasyMenu({
        { text = "RaidAssign", isTitle = true, notCheckable = true },
        { text = "Scan raid", notCheckable = true,
          func = function() SlashCmdList["RAIDSPECSCAN"]("") end },
        { text = "Assignments…", notCheckable = true,
          func = function() SlashCmdList["RAIDASSIGN"]("") end },
        { text = "Apply groups", notCheckable = true,
          func = function() RaidAssignAPI.ApplyGroups() end },
    }, menuFrame, "cursor", 0, 0, "MENU")
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
