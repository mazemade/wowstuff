-- RaidSpecSend: takes the assignment payload from the web tool and whispers it to the raid.
-- Payload (RSW1): a version line, then one "CharacterName=message body" line per whisper.
-- A player with many duties owns several lines; each is sent as its own whisper.

local ADDON, ns = ...
local Print = ns.Print

local sheet = nil        -- array of { name, body } from the last successful paste
local malformed = {}     -- pasted lines that had no "=" in them
local frame              -- built lazily on first /specsend

-- Returns entries, or nil plus a human-readable reason.
local function ParsePayload(text)
    local entries, bad, sawHeader = {}, {}, false
    for line in (text or ""):gmatch("[^\r\n]+") do
        line = line:match("^%s*(.-)%s*$")
        if line ~= "" then
            if not sawHeader then
                if line ~= "RSW1" then
                    return nil, "That is not an RSW1 payload. Copy the Addon tab from the web tool."
                end
                sawHeader = true
            else
                local name, body = line:match("^([^=]+)=(.+)$")
                if name then
                    table.insert(entries, { name = name, body = body })
                else
                    table.insert(bad, line)
                end
            end
        end
    end
    if not sawHeader then return nil, "Nothing pasted." end
    if #entries == 0 then return nil, "No assignment lines in that payload." end
    return entries, nil, bad
end

-- Raid roster keyed by lowercased name without the realm suffix, mapping to the
-- full name to whisper. Cross-realm players appear as "Name-Realm" and must be
-- whispered with the suffix intact, but the payload only carries the short name.
local function RaidTargets()
    local map = {}
    if not IsInRaid() then return map end
    for i = 1, GetNumGroupMembers() do
        local full = GetRaidRosterInfo(i)
        if full then
            local short = full:match("^([^-]+)") or full
            map[short:lower()] = full
        end
    end
    return map
end

-- Splits the payload into what can actually be sent and who is not in the raid.
local function Resolve(entries)
    local targets, sendable, skipped, seen = RaidTargets(), {}, {}, {}
    for _, e in ipairs(entries) do
        local short = (e.name:match("^([^-]+)") or e.name):lower()
        local target = targets[short]
        if target then
            table.insert(sendable, { name = e.name, target = target, body = e.body })
        elseif not seen[e.name] then
            seen[e.name] = true
            table.insert(skipped, e.name)
        end
    end
    return sendable, skipped
end

local SEND_INTERVAL = 1.0 -- seconds; faster bursts get eaten by the spam filter

local sendFrame = CreateFrame("Frame")
local queue, qIndex, qElapsed, sending = {}, 0, 0, false

local function SendTick(_, dt)
    qElapsed = qElapsed + dt
    if qElapsed < SEND_INTERVAL then return end
    qElapsed = 0
    qIndex = qIndex + 1
    local item = queue[qIndex]
    if not item then
        sending = false
        sendFrame:SetScript("OnUpdate", nil)
        Print("Done — " .. #queue .. " whispers sent.")
        if frame and frame:IsShown() then frame.status:SetText("Sent " .. #queue .. " whispers.") end
        return
    end
    SendChatMessage(item.body, "WHISPER", nil, item.target)
    Print(qIndex .. "/" .. #queue .. " to " .. item.name)
end

local function StartSending(list)
    queue, qIndex, sending = list, 0, true
    qElapsed = SEND_INTERVAL -- fire the first one immediately
    Print("Sending " .. #list .. " whispers, one per second…")
    sendFrame:SetScript("OnUpdate", SendTick)
end

-- Preview text: one row per whisper, plus a trailing note for anything unusable.
local function PreviewText()
    local rows = {}
    for _, e in ipairs(sheet) do
        table.insert(rows, e.name .. "  —  " .. e.body)
    end
    if #malformed > 0 then
        table.insert(rows, "")
        table.insert(rows, "Skipped " .. #malformed .. " unreadable line(s).")
    end
    return table.concat(rows, "\n")
end

local function ShowPaste()
    frame.title:SetText("Paste the Addon tab payload, then press Load")
    frame.editBox:SetText("")
    frame.editBox:SetFocus()
    frame.status:SetText("")
    frame.loadBtn:Show()
    frame.sendBtn:Hide()
    frame.backBtn:Hide()
end

local function ShowPreview()
    frame.title:SetText(#sheet .. " whispers ready — nothing is sent until you press Send")
    frame.editBox:SetText(PreviewText())
    frame.editBox:ClearFocus()
    if IsInRaid() then
        frame.status:SetText("")
        frame.sendBtn:Enable()
    else
        frame.status:SetText("Not in a raid — you can review, but not send.")
        frame.sendBtn:Disable()
    end
    frame.loadBtn:Hide()
    frame.sendBtn:Show()
    frame.backBtn:Show()
end

local function OnLoadClicked()
    local entries, err, bad = ParsePayload(frame.editBox:GetText())
    if not entries then
        frame.status:SetText("|cFFFF6B6B" .. err .. "|r")
        return
    end
    sheet, malformed = entries, bad or {}
    ShowPreview()
end

local function BuildFrame()
    local f = CreateFrame("Frame", "RaidSpecSendFrame", UIParent, "BackdropTemplate")
    f:SetSize(560, 400)
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
    f:SetScript("OnHide", function() frame.editBox:ClearFocus() end)

    f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    f.title:SetPoint("TOP", 0, -18)

    local scroll = CreateFrame("ScrollFrame", "RaidSpecSendScroll", f, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 22, -46)
    scroll:SetPoint("BOTTOMRIGHT", -36, 66)

    local edit = CreateFrame("EditBox", nil, scroll)
    edit:SetMultiLine(true)
    edit:SetFontObject(ChatFontNormal)
    edit:SetWidth(480)
    edit:SetMaxLetters(0)
    edit:SetMaxBytes(0)
    edit:SetAutoFocus(false)
    edit:SetScript("OnEscapePressed", function() f:Hide() end)
    scroll:SetScrollChild(edit)
    f.editBox = edit

    f.status = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    f.status:SetPoint("BOTTOMLEFT", 24, 42)
    f.status:SetJustifyH("LEFT")

    local function Button(label, width, x)
        local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        b:SetSize(width, 22)
        b:SetPoint("BOTTOMLEFT", x, 14)
        b:SetText(label)
        return b
    end

    f.loadBtn = Button("Load", 100, 24)
    f.loadBtn:SetScript("OnClick", OnLoadClicked)

    f.sendBtn = Button("Send all", 130, 24)
    f.sendBtn:SetScript("OnClick", function()
        if sending then f.status:SetText("Already sending.") return end
        if not IsInRaid() then f.status:SetText("|cFFFF6B6BYou are not in a raid.|r") return end
        local sendable, skipped = Resolve(sheet)
        if #sendable == 0 then
            f.status:SetText("|cFFFF6B6BNobody in this payload is in your raid.|r")
            return
        end
        if #skipped > 0 then
            Print("Skipping " .. #skipped .. " not in raid: " .. table.concat(skipped, ", "))
        end
        StartSending(sendable)
        f:Hide()
    end)

    f.backBtn = Button("Back", 100, 160)
    f.backBtn:SetScript("OnClick", ShowPaste)

    f.closeBtn = Button("Close", 100, 430)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)

    return f
end

SLASH_RAIDSPECSEND1 = "/specsend"
SlashCmdList["RAIDSPECSEND"] = function()
    if sending then Print("Already sending — wait for it to finish.") return end
    if not frame then frame = BuildFrame() end
    if sheet then ShowPreview() else ShowPaste() end
    frame:Show()
end
