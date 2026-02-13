-- Gruul Positions Exporter
-- Exports your current raid roster to import into the positioning tool

local GruulPositions = {}

-- Role detection based on class and spec (simplified for TBC)
local function GetRaiderRole(unit)
    local class = UnitClass(unit)
    
    -- Simple role mapping for TBC classes
    if class == "Warrior" or class == "Paladin" then
        -- Check if they have defensive aura/stance for tank detection
        local isTank = false
        for i = 1, 40 do
            local name = UnitBuff(unit, i)
            if name and (string.find(name, "Defensive") or string.find(name, "Righteous Fury")) then
                isTank = true
                break
            end
        end
        if isTank then
            return "tank"
        end
    end
    
    -- Healers
    if class == "Priest" or class == "Druid" or class == "Shaman" or class == "Paladin" then
        -- If they're in a healing role (simplified check)
        local role = UnitGroupRolesAssigned(unit)
        if role == "HEALER" then
            return "healer"
        end
    end
    
    -- Melee DPS
    if class == "Rogue" or class == "Warrior" or class == "Paladin" or 
       class == "Druid" or class == "Shaman" or class == "Hunter" then
        return "melee"
    end
    
    -- Ranged DPS (default)
    return "ranged"
end

-- Export raid roster
function GruulPositions:ExportRaid()
    if not IsInRaid() then
        print("|cFFFF0000[Gruul Positions]|r You must be in a raid to export.")
        return
    end
    
    local raidData = {}
    
    -- Get all raid members
    for i = 1, GetNumGroupMembers() do
        local unit = "raid" .. i
        if UnitExists(unit) then
            local name = UnitName(unit)
            local class = UnitClass(unit)
            local role = GetRaiderRole(unit)
            
            table.insert(raidData, {
                name = name,
                class = class,
                role = role
            })
        end
    end
    
    -- Sort by role for better organization
    table.sort(raidData, function(a, b)
        local roleOrder = {tank = 1, healer = 2, melee = 3, ranged = 4}
        return roleOrder[a.role] < roleOrder[b.role]
    end)
    
    -- Create export string
    local exportString = ""
    for _, raider in ipairs(raidData) do
        exportString = exportString .. raider.name .. "," .. raider.role .. "\n"
    end
    
    -- Show in a frame for easy copying
    GruulPositions:ShowExportFrame(exportString, #raidData)
end

-- Create export frame
function GruulPositions:ShowExportFrame(text, count)
    if not GruulPositionsFrame then
        -- Create frame
        local frame = CreateFrame("Frame", "GruulPositionsFrame", UIParent, "DialogBoxFrame")
        frame:SetSize(500, 400)
        frame:SetPoint("CENTER")
        frame:SetMovable(true)
        frame:EnableMouse(true)
        frame:SetClampedToScreen(true)
        
        -- Title
        local title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
        title:SetPoint("TOP", 0, -10)
        title:SetText("Gruul Positions - Raid Export")
        
        -- Instructions
        local instructions = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        instructions:SetPoint("TOP", 0, -35)
        instructions:SetText("Copy this text and paste into the bulk import:")
        
        -- Scroll frame for text
        local scrollFrame = CreateFrame("ScrollFrame", "GruulPositionsScrollFrame", frame, "UIPanelScrollFrameTemplate")
        scrollFrame:SetPoint("TOP", 0, -55)
        scrollFrame:SetSize(450, 250)
        
        -- Edit box
        local editBox = CreateFrame("EditBox", "GruulPositionsEditBox", scrollFrame)
        editBox:SetMultiLine(true)
        editBox:SetFontObject(ChatFontNormal)
        editBox:SetWidth(430)
        editBox:SetAutoFocus(false)
        scrollFrame:SetScrollChild(editBox)
        
        -- Close button
        local closeBtn = CreateFrame("Button", nil, frame, "GameMenuButtonTemplate")
        closeBtn:SetSize(100, 25)
        closeBtn:SetPoint("BOTTOM", 0, 15)
        closeBtn:SetText("Close")
        closeBtn:SetScript("OnClick", function()
            frame:Hide()
        end)
        
        frame.editBox = editBox
        frame.title = title
    end
    
    GruulPositionsFrame.title:SetText("Gruul Positions - Raid Export (" .. count .. " raiders)")
    GruulPositionsFrame.editBox:SetText(text)
    GruulPositionsFrame.editBox:HighlightText()
    GruulPositionsFrame.editBox:SetCursorPosition(0)
    GruulPositionsFrame:Show()
end

-- Slash command
SLASH_GRUULPOS1 = "/gruulpos"
SLASH_GRUULPOS2 = "/gpos"
SlashCmdList["GRUULPOS"] = function(msg)
    if msg == "export" or msg == "" then
        GruulPositions:ExportRaid()
    elseif msg == "help" then
        print("|cFFFFD700[Gruul Positions]|r Commands:")
        print("  /gruulpos or /gpos - Export current raid roster")
        print("  /gruulpos help - Show this help message")
    else
        print("|cFFFF0000[Gruul Positions]|r Unknown command. Type '/gruulpos help' for help.")
    end
end

print("|cFFFFD700[Gruul Positions]|r Loaded! Use /gruulpos to export your raid.")
