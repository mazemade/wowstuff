-- Vetting links: the shortest path from a name on screen to the web tool's vetting page.
--
-- The client has no clipboard or browser API, so the exit is an edit box the leader Ctrl+C's
-- from. What goes in the box is not the bare name but a link to the vetting page with the
-- name in the fragment — pasted into the address bar of the tab that is already open, the page
-- adds the player without a reload and without anyone having to aim for the name field.
-- Accented names come along untyped, which is the whole point.
--
-- Three ways in:
--   Ctrl+click a player name in chat   → link for that one player
--   /vet                               → link for the current target
--   /vet list                          → one link for everyone who whispered since login
--   /vet <name>                        → link for a typed name
--
-- Cross-realm names arrive as Name-Realm; the page vets on its one configured realm, so the
-- suffix is dropped here. Character names cannot contain a hyphen, so the split is safe.

local VET_URL = "https://wowstuff-production.up.railway.app/vetting.html#add="
local MAX_WHISPERERS = 50

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99RaidVet:|r " .. msg)
end

local function StripRealm(name)
    local dash = name:find("-", 1, true)
    if dash then return name:sub(1, dash - 1) end
    return name
end

-- Percent-encodes every byte outside the URL-unreserved set, so multi-byte UTF-8 letters
-- become %XX%XX sequences that decodeURIComponent on the page turns back into the name.
local function Encode(s)
    return (s:gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

local function BuildLink(names)
    local parts = {}
    for _, n in ipairs(names) do parts[#parts + 1] = Encode(n) end
    return VET_URL .. table.concat(parts, ",")
end

local function ShowLink(names)
    local f = RaidAssignVetFrame
    if not f then
        f = CreateFrame("Frame", "RaidAssignVetFrame", UIParent, "BackdropTemplate")
        f:SetSize(460, 130)
        f:SetPoint("CENTER", 0, 120)
        f:SetFrameStrata("DIALOG")
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
        title:SetText("Vetting link — Ctrl+C, then paste into the browser address bar")

        -- The link itself is unreadable; this line is how you check it is the right person.
        f.who = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
        f.who:SetPoint("TOP", 0, -38)
        f.who:SetWidth(420)

        local edit = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
        edit:SetSize(420, 24)
        edit:SetPoint("TOP", 0, -58)
        edit:SetFontObject(ChatFontNormal)
        edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() f:Hide() end)
        edit:SetScript("OnEnterPressed", function() f:Hide() end)
        -- Any keystroke other than a copy replaces the link; put it back so the box is never
        -- holding a half-edited URL.
        edit:SetScript("OnTextChanged", function(self, userInput)
            if userInput and f.link and self:GetText() ~= f.link then
                self:SetText(f.link)
                self:HighlightText()
            end
        end)
        f.editBox = edit

        local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        close:SetSize(80, 22)
        close:SetPoint("BOTTOM", 0, 16)
        close:SetText("Close")
        close:SetScript("OnClick", function() f:Hide() end)
    end
    f.link = BuildLink(names)
    f.who:SetText(#names == 1 and names[1] or (#names .. " players: " .. table.concat(names, ", ")))
    f.editBox:SetText(f.link)
    f.editBox:HighlightText()
    f.editBox:SetFocus()
    f:Show()
end

-- Everyone who whispered since login, first whisper first, no repeats. Not saved: an invite
-- request is only interesting tonight.
local whisperers, seen = {}, {}

local frame = CreateFrame("Frame")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:SetScript("OnEvent", function(_, event, _, sender)
    if event ~= "CHAT_MSG_WHISPER" or not sender or sender == "" then return end
    local name = StripRealm(sender)
    if seen[name] then return end
    if #whisperers >= MAX_WHISPERERS then return end
    seen[name] = true
    whisperers[#whisperers + 1] = name
end)

-- Wrap the stock hyperlink handler: a Ctrl+left-click on a player name is ours, everything else
-- (shift-click to insert, right-click menu, plain click to whisper, item links) passes through
-- unchanged. Ctrl+click has no stock meaning on a player link, so nothing is lost.
local stockSetItemRef = SetItemRef
SetItemRef = function(link, text, button, chatFrame, ...)
    if button == "LeftButton" and IsControlKeyDown() and link:sub(1, 7) == "player:" then
        local name = link:match("^player:([^:]+)")
        if name and name ~= "" then
            ShowLink({ StripRealm(name) })
            return
        end
    end
    return stockSetItemRef(link, text, button, chatFrame, ...)
end

SLASH_RAIDVET1 = "/vet"
SlashCmdList["RAIDVET"] = function(msg)
    local arg = (msg or ""):match("^%s*(.-)%s*$")
    if arg == "list" then
        if #whisperers == 0 then
            Print("Nobody has whispered you since login.")
            return
        end
        ShowLink(whisperers)
    elseif arg ~= "" then
        ShowLink({ StripRealm(arg) })
    else
        local target = UnitName("target")
        if target then
            ShowLink({ StripRealm(target) })
        else
            Print("No target. /vet with a target, /vet <name>, /vet list for tonight's whisperers, or Ctrl+click a name in chat.")
        end
    end
end
