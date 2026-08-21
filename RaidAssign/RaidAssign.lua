-- RaidAssign: takes the assignment payload from the web tool and whispers it to the raid.
-- Payload (RSW1): a version line, then one "CharacterName=message body" line per whisper.
-- A player with many duties owns several lines; each is sent as its own whisper.
--
-- Scan.lua (/specscan) feeds the web tool and this file reads the web tool's output back.
-- The two files live in one addon but share no state; each works if the other fails to load.

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cFF33FF99[RaidAssign]|r " .. msg)
end

local sheet = nil        -- array of { name, body } from the last successful paste
local malformed = {}     -- pasted lines the parser could not read
local layout = nil       -- group layout from the last paste's @G lines, or nil
local tracking = nil     -- compliance-tracking table from the last paste's @T lines, or nil
local frame              -- built lazily on first /specsend

-- Returns { entries, malformed, layout, tracking }, or nil plus a human-readable reason.
-- layout is nil when the payload has no @G lines; otherwise:
--   byName      short lowered name -> group number 1..8 (how the engine matches the roster)
--   groups      [n] -> display names in payload order (how messages name people)
--   playerCount total distinct names placed
--   duplicates  names that appeared a second time; first placement wins
-- tracking is nil when the payload has no @T lines (every RSW1/RSW2 payload); otherwise
-- { debuffs = { {id, name, auras, player, noattrib} … },
--   buffs   = { {id, name, auras, group, provider} … } } — auras is the raw comma-separated
-- string, split by Track.lua, because the addon matches by aura NAME, never spell id.
local function ParsePayload(text)
    local entries, bad, layout, trk, sawHeader = {}, {}, nil, nil, false
    for line in (text or ""):gmatch("[^\r\n]+") do
        line = line:match("^%s*(.-)%s*$")
        if line ~= "" then
            if not sawHeader then
                if line ~= "RSW1" and line ~= "RSW2" and line ~= "RSW3" then
                    return nil, "That is not an RSW1/RSW2/RSW3 payload. Copy the Addon tab from the web tool."
                end
                sawHeader = true
            elseif line:sub(1, 1) == "@" then
                -- "@" cannot start a character name, so these are unambiguously directives.
                local kind, rest = line:match("^@T ([DB])|(.+)$")
                if kind then
                    local f = {}
                    for field in rest:gmatch("[^|]+") do table.insert(f, field) end
                    trk = trk or { debuffs = {}, buffs = {} }
                    if kind == "D" and #f >= 4 then
                        table.insert(trk.debuffs, { id = f[1], name = f[2], auras = f[3],
                            player = f[4], noattrib = (f[5] == "noattrib") or nil })
                    elseif kind == "B" and #f >= 5 and tonumber(f[4]) then
                        table.insert(trk.buffs, { id = f[1], name = f[2], auras = f[3],
                            group = tonumber(f[4]), provider = f[5] })
                    else
                        table.insert(bad, line)
                    end
                else
                    local n, names = line:match("^@G([1-8])=(.+)$")
                    if not n then
                        table.insert(bad, line)
                    else
                        layout = layout or { byName = {}, groups = {}, playerCount = 0, duplicates = {} }
                        n = tonumber(n)
                        layout.groups[n] = layout.groups[n] or {}
                        for name in names:gmatch("[^,]+") do
                            name = name:match("^%s*(.-)%s*$")
                            if name ~= "" then
                                local key = (name:match("^([^-]+)") or name):lower()
                                if layout.byName[key] then
                                    table.insert(layout.duplicates, name)
                                else
                                    layout.byName[key] = n
                                    table.insert(layout.groups[n], name)
                                    layout.playerCount = layout.playerCount + 1
                                end
                            end
                        end
                    end
                end
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
    if #entries == 0 and not layout then return nil, "No assignment or group lines in that payload." end
    return { entries = entries, malformed = bad, layout = layout, tracking = trk }
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

-- Account-wide, not per-character: the leader may swap toons between nights, but
-- the raid's assignments are the same either way.
local function History()
    RaidAssignDB = RaidAssignDB or {}
    RaidAssignDB.lastSent = RaidAssignDB.lastSent or {}
    return RaidAssignDB.lastSent
end

-- A player's signature is all their lines joined, so a player who gains a second
-- duty counts as changed even though their first line is untouched.
local function Signatures(entries)
    local sig = {}
    for _, e in ipairs(entries) do
        sig[e.name] = sig[e.name] and (sig[e.name] .. "\n" .. e.body) or e.body
    end
    return sig
end

local function Classify(entries)
    local last, sig, status = History(), Signatures(entries), {}
    for name, s in pairs(sig) do
        if last[name] == nil then
            status[name] = "NEW"
        elseif last[name] ~= s then
            status[name] = "CHANGED"
        else
            status[name] = "UNCHANGED"
        end
    end
    return status, sig
end

local function ChangedOnly(entries)
    local status = Classify(entries)
    local out = {}
    for _, e in ipairs(entries) do
        if status[e.name] ~= "UNCHANGED" then table.insert(out, e) end
    end
    return out
end

local SEND_INTERVAL = 1.5 -- seconds; 1.0 saturates the ~10 msgs/10s chat budget, so any manual reply mid-send got the tail eaten

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
    -- Only assignment sends write history. A compliance nag (SendRaw) must not, or the
    -- next real assignment send would read the player as UNCHANGED and skip their duties.
    if item.record then
        local last = History()
        last[item.name] = last[item.name] and (last[item.name] .. "\n" .. item.body) or item.body
    end
    Print(qIndex .. "/" .. #queue .. " to " .. item.name)
end

local function StartSending(list, record)
    queue, qIndex, sending = list, 0, true
    qElapsed = SEND_INTERVAL
    for _, item in ipairs(list) do item.record = record end
    -- Do not write signatures up front: if the send is interrupted (disconnect,
    -- /reload, logout) partway through, anyone not yet whispered must NOT be
    -- recorded as sent, or they would read UNCHANGED next time and be skipped
    -- forever. Instead, clear their prior signature now — SendTick rebuilds it
    -- line-by-line as each whisper actually goes out, so an interrupted send
    -- leaves the un-whispered tail looking CHANGED (or NEW) and gets re-sent.
    if record then
        local last = History()
        for name in pairs(Signatures(list)) do last[name] = nil end
    end
    Print("Sending " .. #list .. " whispers, one every " .. SEND_INTERVAL .. "s…")
    sendFrame:SetScript("OnUpdate", SendTick)
end

-- === Group layout application ================================================
-- One-shot: converge the live roster onto `layout`, one operation per tick, then stop.
-- Never precompute a move list — the server reorders the roster between ops, so each
-- tick re-reads it and decides the single next move.

local APPLY_INTERVAL = 0.5 -- seconds between ops; the server needs each GROUP_ROSTER_UPDATE to settle
local MAX_APPLY_OPS = 50   -- backstop only: every op below places >=1 player correctly, so a
                           -- 40-man needs at most 40 — hitting 50 means the server is ignoring us

local applyFrame = CreateFrame("Frame")
local applying, applyElapsed, applyOps = false, 0, 0
local applyTargets, applyMissing

-- Live roster as { index, name (short, lowered — same normalization as RaidTargets),
-- display (the full name, for messages), subgroup }.
local function ApplyRoster()
    local out = {}
    for i = 1, GetNumGroupMembers() do
        local full, _, sub = GetRaidRosterInfo(i)
        if full and sub then
            table.insert(out, { index = i, name = (full:match("^([^-]+)") or full):lower(),
                                display = full, subgroup = sub })
        end
    end
    return out
end

-- The single next operation: "set", raidIndex, group / "swap", indexA, indexB /
-- nil, stuckNames when nothing movable remains. Correctly placed players are never
-- displaced, so every returned op is net progress and convergence is guaranteed.
local function NextMove(targets)
    local roster = ApplyRoster()
    local counts = {}
    for _, r in ipairs(roster) do counts[r.subgroup] = (counts[r.subgroup] or 0) + 1 end
    local stuck = {}
    for _, r in ipairs(roster) do
        local want = targets[r.name]
        if want and want ~= r.subgroup then
            if (counts[want] or 0) < 5 then return "set", r.index, want end
            -- Target group full: swap with a misplaced occupant, preferring one headed
            -- for r's current group so a single swap settles two players.
            local fallback
            for _, o in ipairs(roster) do
                if o.subgroup == want and targets[o.name] and targets[o.name] ~= want then
                    if targets[o.name] == r.subgroup then return "swap", r.index, o.index end
                    fallback = fallback or o.index
                end
            end
            if fallback then return "swap", r.index, fallback end
            -- Everyone in the full target group belongs there: the layout over-fills it.
            table.insert(stuck, r.display)
        end
    end
    return nil, stuck
end

local function FinishApply(abortReason, stuck)
    applying = false
    applyFrame:SetScript("OnUpdate", nil)
    if abortReason then
        Print("Group apply aborted — " .. abortReason .. " (" .. applyOps .. " move(s) made). Re-run when ready.")
        return
    end
    local msg = "Groups applied — " .. applyOps .. " move(s)."
    if #applyMissing > 0 then
        msg = msg .. " Not in raid: " .. table.concat(applyMissing, ", ") .. "."
    end
    if stuck and #stuck > 0 then
        msg = msg .. " Could not place (target group full): " .. table.concat(stuck, ", ") .. "."
    end
    Print(msg)
end

local function ApplyTick(_, dt)
    applyElapsed = applyElapsed + dt
    if applyElapsed < APPLY_INTERVAL then return end
    applyElapsed = 0
    if InCombatLockdown() then FinishApply("combat started") return end
    local kind, a, b = NextMove(applyTargets)
    if not kind then FinishApply(nil, a) return end -- a = stuck names when kind is nil
    if applyOps >= MAX_APPLY_OPS then FinishApply("hit the " .. MAX_APPLY_OPS .. "-move cap") return end
    applyOps = applyOps + 1
    if kind == "set" then SetRaidSubgroup(a, b) else SwapRaidSubgroups(a, b) end
end

local function ApplyGroups()
    if not layout then Print("No layout loaded — open Assignments (/specsend) and paste the web tool payload.") return end
    if applying then Print("Already applying groups.") return end
    if not IsInRaid() then Print("You are not in a raid.") return end
    if not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        Print("You need raid lead or assist to move players.")
        return
    end
    if InCombatLockdown() then Print("Cannot move players in combat.") return end
    local inRaid = RaidTargets()
    local targets, missing = {}, {}
    for key, group in pairs(layout.byName) do
        if inRaid[key] then targets[key] = group end
    end
    for n = 1, 8 do
        for _, name in ipairs(layout.groups[n] or {}) do
            if not inRaid[(name:match("^([^-]+)") or name):lower()] then
                table.insert(missing, name)
            end
        end
    end
    applyTargets, applyMissing = targets, missing
    applying, applyOps, applyElapsed = true, 0, APPLY_INTERVAL -- first op on the next tick
    Print("Applying group layout…")
    applyFrame:SetScript("OnUpdate", ApplyTick)
end

local function PreviewText()
    local status = Classify(sheet)
    local rows, changed = {}, 0
    for _, e in ipairs(sheet) do
        local tag = status[e.name]
        if tag ~= "UNCHANGED" then changed = changed + 1 end
        table.insert(rows, string.format("%-10s %s  —  %s", tag, e.name, e.body))
    end
    if #malformed > 0 then
        table.insert(rows, "")
        table.insert(rows, "Skipped " .. #malformed .. " unreadable line(s).")
        for _, line in ipairs(malformed) do
            if #line > 80 then line = line:sub(1, 80) end
            table.insert(rows, line)
        end
    end
    if layout and #layout.duplicates > 0 then
        table.insert(rows, "")
        table.insert(rows, "Duplicate group entries ignored: " .. table.concat(layout.duplicates, ", "))
    end
    return table.concat(rows, "\n"), changed
end

local function LayoutSummary()
    if not layout then return nil end
    local groups = 0
    for _ in pairs(layout.groups) do groups = groups + 1 end
    return "Group layout loaded: " .. groups .. " groups, " .. layout.playerCount .. " players."
end

local function ShowPaste()
    frame.title:SetText("Paste the Addon tab payload, then press Load")
    frame.editBox:SetText("")
    frame.editBox:SetFocus()
    frame.status:SetText("")
    frame.loadBtn:Show()
    frame.changedBtn:Hide()
    frame.sendBtn:Hide()
    frame.applyBtn:Hide()
    frame.backBtn:Hide()
end

-- Everything on the preview screen that depends on live raid state: which buttons are
-- usable, and what the status line says. Split out of ShowPreview because the raid changes
-- underneath an open frame — the invite lands late, someone disbands mid-planning — and
-- GROUP_ROSTER_UPDATE must be able to re-run just this much without rebuilding the preview
-- text under a leader who is reading it. Computed once at Load, this left the Apply button
-- dead for the rest of the session, and a disabled button swallows the click in silence:
-- ApplyGroups prints on all six of its exit paths, but none of them is ever reached.
local function RefreshLiveState()
    if not (frame and sheet) then return end
    local _, changed = PreviewText()
    frame.changedBtn:SetText("Send " .. changed .. " changed")
    local bits = {}
    if layout then table.insert(bits, LayoutSummary()) end
    if IsInRaid() then
        frame.sendBtn:Enable()
        if changed > 0 then frame.changedBtn:Enable() else frame.changedBtn:Disable() end
    else
        table.insert(bits, "Not in a raid — you can review, but not send.")
        frame.sendBtn:Disable()
        frame.changedBtn:Disable()
    end
    frame.status:SetText(table.concat(bits, "  "))
    if layout and IsInRaid() then frame.applyBtn:Enable() else frame.applyBtn:Disable() end
end

local function ShowPreview()
    frame.title:SetText(#sheet .. " whispers ready — nothing is sent until you press Send")
    local text = PreviewText()
    frame.editBox:SetText(text)
    frame.editBox:ClearFocus()
    RefreshLiveState()
    frame.loadBtn:Hide()
    frame.changedBtn:Show()
    frame.sendBtn:Show()
    frame.applyBtn:Show()
    frame.backBtn:Show()
end

-- The only event this file listens to. Roster churn is the one thing that can invalidate
-- the preview screen without the leader touching it.
local rosterWatch = CreateFrame("Frame")
rosterWatch:RegisterEvent("GROUP_ROSTER_UPDATE")
rosterWatch:SetScript("OnEvent", function()
    if frame and frame:IsShown() then RefreshLiveState() end
end)

local function OnLoadClicked()
    local result, err = ParsePayload(frame.editBox:GetText())
    if not result then
        frame.status:SetText("|cFFFF6B6B" .. err .. "|r")
        return
    end
    sheet, malformed, layout, tracking = result.entries, result.malformed, result.layout, result.tracking
    ShowPreview()
end

local function SendFiltered(entries)
    if sending then frame.status:SetText("Already sending.") return end
    if not IsInRaid() then frame.status:SetText("|cFFFF6B6BYou are not in a raid.|r") return end
    if #entries == 0 then frame.status:SetText("Nothing to send.") return end
    local sendable, skipped = Resolve(entries)
    if #sendable == 0 then
        frame.status:SetText("|cFFFF6B6BNobody in this payload is in your raid.|r")
        return
    end
    if #skipped > 0 then
        Print("Skipping " .. #skipped .. " not in raid: " .. table.concat(skipped, ", "))
    end
    StartSending(sendable, true)
    frame:Hide()
end

local function BuildFrame()
    local f = CreateFrame("Frame", "RaidAssignFrame", UIParent, "BackdropTemplate")
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
    f:SetScript("OnHide", function() f.editBox:ClearFocus() end)

    f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    f.title:SetPoint("TOP", 0, -18)

    local scroll = CreateFrame("ScrollFrame", "RaidAssignScroll", f, "UIPanelScrollFrameTemplate")
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

    f.changedBtn = Button("Send 0 changed", 140, 24)
    f.changedBtn:SetScript("OnClick", function() SendFiltered(ChangedOnly(sheet)) end)

    f.sendBtn = Button("Send all", 100, 172)
    f.sendBtn:SetScript("OnClick", function() SendFiltered(sheet) end)

    f.applyBtn = Button("Apply groups", 110, 280)
    f.applyBtn:SetScript("OnClick", function() ApplyGroups() end)

    f.backBtn = Button("Back", 70, 398)
    f.backBtn:SetScript("OnClick", ShowPaste)

    f.closeBtn = Button("Close", 70, 476)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)

    return f
end

SLASH_RAIDASSIGN1 = "/specsend"
SlashCmdList["RAIDASSIGN"] = function(msg)
    local arg = (msg or ""):match("^%s*(%S*)"):lower()
    if arg == "reset" then
        RaidAssignDB = RaidAssignDB or {}
        RaidAssignDB.lastSent = {}
        Print("Send history cleared — everyone counts as NEW again.")
        if frame and frame:IsShown() and sheet then ShowPreview() end
        return
    end
    if sending then Print("Already sending — wait for it to finish.") return end
    if not frame then frame = BuildFrame() end
    if sheet then ShowPreview() else ShowPaste() end
    frame:Show()
end

-- Entry points for Minimap.lua. A global on purpose: the addon's files share no locals,
-- so this table is the whole surface they talk across.
RaidAssignAPI = {
    ApplyGroups = ApplyGroups,
    LayoutInfo = LayoutSummary,
    GetTracking = function() return tracking end,
    -- Compliance whispers (TrackUI): same queue and raid-target resolution as
    -- assignment sends, but never recorded in lastSent — a scoreboard nag must not
    -- make the next real assignment send think the player already got their duties.
    SendRaw = function(entries)
        if sending then return false, "Already sending" end
        local sendable, skipped = Resolve(entries)
        if #sendable == 0 then return false, "Nobody selected is in the raid" end
        StartSending(sendable, false)
        return true, #sendable, skipped
    end,
}
