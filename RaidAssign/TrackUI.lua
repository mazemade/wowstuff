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

-- === /racheck scoreboard =====================================================
local CHECK_ROWS = 20
local view          -- built lazily
local viewIndex     -- 1-based index into RaidAssignAPI.Pulls()

local function PullRows(p)
    -- Flatten a pull record into display rows. `who` is whoever a whisper would go to.
    local rows = {}
    for _, r in ipairs(p.debuffs) do
        local pct = (p.duration > 0) and (r.uptime / p.duration) or 0
        local share = (r.uptime > 0) and (r.byAssignee / r.uptime) or 0
        local label = RowColor(pct) .. r.name .. "  " .. Pct(pct) .. "|r  — " .. (r.player or "?")
        if r.absent then
            label = label .. " |cFF999999(not in raid)|r"
        elseif not r.noattrib then
            label = label .. "  |cFF999999" .. Pct(share) .. " by them|r"
        end
        table.insert(rows, { label = label, who = (not r.absent) and r.player or nil,
            body = string.format("%s pull %d: %s up %s — assigned to you",
                p.encounter, p.ordinal, r.name, Pct(pct)),
            summary = r.name .. " " .. Pct(pct), pct = pct })
    end
    for _, b in ipairs(p.buffs or {}) do
        local pct = b.fraction or 0
        table.insert(rows, { label = RowColor(pct) .. b.name .. " (G" .. b.group .. ")  "
                .. Pct(pct) .. "|r  — " .. (b.provider or "?"),
            who = b.provider,
            body = string.format("%s pull %d: %s in group %d up %s — your totem/shout",
                p.encounter, p.ordinal, b.name, b.group, Pct(pct)),
            summary = b.name .. " G" .. b.group .. " " .. Pct(pct), pct = pct })
    end
    return rows
end

local function Render()
    local pulls = RaidAssignAPI.Pulls()
    local p = pulls[viewIndex]
    if not p then view:Hide() return end
    view.title:SetText(string.format("%s #%d — %s — %d:%02d",
        p.encounter, p.ordinal, p.success and "kill" or "wipe",
        math.floor(p.duration / 60), math.floor(p.duration % 60)))
    local rows = PullRows(p)
    for i = 1, CHECK_ROWS do
        local w, r = view.rows[i], rows[i]
        if r then
            w.label:SetText(r.label)
            w.entry = r
            w.check:SetChecked(false)
            if r.who then w.check:Show() else w.check:Hide() end
            w.label:Show()
        else
            w.entry = nil
            w.check:Hide()
            w.label:Hide()
        end
    end
    if viewIndex > 1 then view.prevBtn:Enable() else view.prevBtn:Disable() end
    if viewIndex < #pulls then view.nextBtn:Enable() else view.nextBtn:Disable() end
end

local function BuildView()
    local f = CreateFrame("Frame", "RaidAssignCheckFrame", UIParent, "BackdropTemplate")
    f:SetSize(520, 90 + CHECK_ROWS * 18)
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

    f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    f.title:SetPoint("TOP", 0, -18)

    f.rows = {}
    for i = 1, CHECK_ROWS do
        local row = {}
        row.check = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
        row.check:SetSize(18, 18)
        row.check:SetPoint("TOPLEFT", 20, -(40 + (i - 1) * 18))
        row.label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        row.label:SetPoint("TOPLEFT", 44, -(42 + (i - 1) * 18))
        row.label:SetJustifyH("LEFT")
        f.rows[i] = row
    end

    local function Button(label, width, x)
        local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
        b:SetSize(width, 22)
        b:SetPoint("BOTTOMLEFT", x, 14)
        b:SetText(label)
        return b
    end
    f.prevBtn = Button("◀", 34, 20)
    f.prevBtn:SetScript("OnClick", function() viewIndex = viewIndex - 1; Render() end)
    f.nextBtn = Button("▶", 34, 58)
    f.nextBtn:SetScript("OnClick", function() viewIndex = viewIndex + 1; Render() end)
    f.whisperBtn = Button("Whisper selected", 130, 100)
    f.whisperBtn:SetScript("OnClick", function()
        -- Nothing here sends by itself: only the checked rows, only on this click.
        local entries = {}
        for i = 1, CHECK_ROWS do
            local w = f.rows[i]
            if w.entry and w.entry.who and w.check:GetChecked() then
                table.insert(entries, { name = w.entry.who, body = w.entry.body })
            end
        end
        if #entries == 0 then Print("Nothing selected.") return end
        local ok, countOrReason = RaidAssignAPI.SendRaw(entries)
        if ok then Print("Whispering " .. countOrReason .. " player(s).")
        else Print(countOrReason) end
    end)
    f.postBtn = Button("Post summary", 110, 238)
    f.postBtn:SetScript("OnClick", function()
        local p = RaidAssignAPI.Pulls()[viewIndex]
        if not p then return end
        -- One header plus the sub-90% offenders; a full dump of green rows is noise.
        SendChatMessage(string.format("%s pull %d (%s):", p.encounter, p.ordinal,
            p.success and "kill" or "wipe"), "RAID")
        for _, r in ipairs(PullRows(p)) do
            if r.pct < 0.9 then SendChatMessage(r.summary, "RAID") end
        end
    end)
    f.closeBtn = Button("Close", 70, 430)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)
    return f
end

SLASH_RACHECK1 = "/racheck"
SlashCmdList["RACHECK"] = function(msg)
    local arg = (msg or ""):match("^%s*(%S*)"):lower()
    if arg == "live" then
        RaidAssignDB = RaidAssignDB or {}
        RaidAssignDB.liveView = (RaidAssignDB.liveView == false)
        Print("Live view " .. (RaidAssignDB.liveView ~= false and "on" or "off") .. ".")
        return
    end
    local pulls = RaidAssignAPI.Pulls()
    if #pulls == 0 then
        Print("No pulls recorded yet — load an RSW3 payload from the web tool, then pull a boss.")
        return
    end
    viewIndex = #pulls
    if not view then view = BuildView() end
    Render()
    view:Show()
end
