# In-Game Assignment Whispers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the raid leader paste one string into the RaidSpecScan addon and have it whisper every player their assignments, instead of pasting 25 `/w` lines by hand.

**Architecture:** The web page cannot talk to WoW, so this is a copy-paste round trip mirroring the existing `/specscan` export. A new engine function emits a versioned `RSW1` payload, a new output tab shows it, and a new addon file parses it, previews it, and sends the whispers on a one-second timer with a changed-only diff held in SavedVariables.

**Tech Stack:** Vanilla JS (no build step, no framework), UMD module pattern, hand-rolled test harness, WoW TBC Classic Lua (interface 20506).

**Spec:** `docs/superpowers/specs/2026-08-10-addon-whispers-design.md`

## Global Constraints

- **No build step, no bundler, no framework, no new dependencies.** Files are served statically by `server.js`.
- **Engine tests run with `node assignments-engine.test.js` and must exit 0** after every engine task.
- `assignments-engine.js` is UMD: it must keep working as both a browser global (`window.AssignmentsEngine`) and a Node `require`.
- **No data-derived string may reach `innerHTML`.** Build DOM with `createElement` / `textContent`.
- New tests go at the **end** of `assignments-engine.test.js`, immediately above the final two summary lines, under a `// --- <label> ---` comment.
- **Never `git add -A` or `git add .`** — stage only the files named in the task. The working tree holds unrelated untracked work (`ssc.html`, `ssc.js`, `chain-heal-sim.html`, `HideBlizzardLoot/`, `RepeatSplit/`, `Weakaura/`) and a modified `style.css`.
- **No `Co-Authored-By` trailer** on any commit. Work on the `main` branch.
- Addon `.toc` interface version is **20506** (client build 2.5.6). Do not change it.
- WoW caps a chat message body at **255 characters**.
- After any change to a file under `RaidSpecScan/`, copy it to
  `/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/` so the installed copy stays in sync.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `assignments-engine.js` | `whisperMap` (shared duty aggregation), `buildAddonWhispers` (RSW1 payload) | Modify |
| `assignments-engine.test.js` | Tests for the above | Modify |
| `assignments.html` | Fifth output tab button | Modify |
| `assignments.js` | `renderOutput` branch for the new tab | Modify |
| `RaidSpecScan/RaidSpecScan.toc` | Load the new Lua file; declare SavedVariables | Modify |
| `RaidSpecScan/RaidSpecScan.lua` | Expose `Print` on the addon namespace; drop the temporary probe | Modify |
| `RaidSpecScan/RaidSpecSend.lua` | Payload parsing, preview window, throttled sender, send history | Create |

The addon gains a second Lua file rather than growing the existing one: scanning and sending are independent features that share only a print helper.

---

### Task 1: Engine — the RSW1 payload

**Files:**
- Modify: `assignments-engine.js:387-397` (`buildWhispers`) and the export block at `assignments-engine.js:399-406`
- Test: `assignments-engine.test.js` (append at end)

**Interfaces:**
- Consumes: existing `packChat(prefix, items, sep, max)`, `displayTarget(t)`, `ccAbilityName(id)` — all already defined earlier in the same closure.
- Produces: `buildAddonWhispers(roster, sheet) -> string`. A newline-joined payload whose first line is `RSW1` and whose remaining lines are `<name>=<body>`. Every `<body>` is at most 255 characters. A player may own more than one line.

- [ ] **Step 1: Write the failing tests**

Append to `assignments-engine.test.js`, immediately above the `console.log(...)` summary line:

```js
// --- Addon whispers: RSW1 paste payload ---
test('buildAddonWhispers: RSW1 header, then one Name=body line per player', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n');
    assert.strictEqual(lines[0], 'RSW1');
    const bob = lines.filter(l => l.startsWith('Bob='));
    assert.strictEqual(bob.length, 1);
    assert.ok(bob[0].includes('Curse of Elements'));
    assert.ok(bob[0].includes('Soulstone'));
});
test('buildAddonWhispers: same recipients as the Whispers tab', () => {
    const { roster, sheet } = sampleSheet();
    const fromAddon = E.buildAddonWhispers(roster, sheet).split('\n').slice(1)
        .map(l => l.slice(0, l.indexOf('=')));
    const fromWhispers = E.buildWhispers(roster, sheet).map(l => l.split(' ')[1]);
    assert.deepStrictEqual(
        Array.from(new Set(fromAddon)).sort(),
        Array.from(new Set(fromWhispers)).sort());
});
test('buildAddonWhispers: players with no duties get no line', () => {
    const { roster, sheet } = sampleSheet();
    const names = E.buildAddonWhispers(roster, sheet).split('\n').slice(1)
        .map(l => l.slice(0, l.indexOf('=')));
    assert.ok(!names.includes('Stabby'));
});
test('buildAddonWhispers: mark tokens survive verbatim', () => {
    const { roster, sheet } = sampleSheet();
    assert.ok(E.buildAddonWhispers(roster, sheet).includes('Polymorph on {moon}'));
});
test('buildAddonWhispers: duty text containing ; / and parentheses survives intact', () => {
    const { roster, sheet } = sampleSheet();
    const lines = E.buildAddonWhispers(roster, sheet).split('\n').slice(1);
    const personal = lines.find(l => l.includes('Curse of Doom/Agony (personal)'));
    assert.ok(personal, 'expected a spare warlock to carry the personal curse');
    // The name/body split is on the FIRST '=', so a body may contain anything else.
    const name = personal.slice(0, personal.indexOf('='));
    assert.ok(name.length > 0 && name.indexOf(' ') === -1);
});
test('buildAddonWhispers: a heavily loaded player splits across lines, all within 255', () => {
    const sheet = {
        duties: Array.from({ length: 30 }, (_, i) => ({
            id: 'd' + i, name: 'Very Long Duty Name Number ' + i, category: 'debuffs', player: 'Bob',
        })),
        uncovered: [], passives: [], cc: [],
    };
    const lines = E.buildAddonWhispers([], sheet).split('\n').slice(1);
    assert.ok(lines.length > 1, 'expected the payload to wrap onto several lines');
    lines.forEach(l => {
        assert.ok(l.startsWith('Bob='));
        const body = l.slice('Bob='.length);
        assert.ok(body.length <= 255, 'body was ' + body.length + ' chars');
        assert.ok(body.startsWith('Your assignments: '));
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node assignments-engine.test.js`
Expected: 6 failures, each `E.buildAddonWhispers is not a function`.

- [ ] **Step 3: Extract the shared aggregation and add the builder**

In `assignments-engine.js`, replace the whole `buildWhispers` function with:

```js
    // Per-player duty text, shared by every whisper-shaped output so the two can't drift.
    function whisperMap(sheet) {
        const per = {};
        const add = (name, txt) => { (per[name] = per[name] || []).push(txt); };
        sheet.duties.filter(d => d.player).forEach(d => {
            add(d.player, d.name + (d.target ? ' on ' + displayTarget(d.target) : ''));
        });
        (sheet.cc || []).filter(c => c.player).forEach(c => {
            add(c.player, ccAbilityName(c.ability) + ' on {' + c.mark + '}');
        });
        return per;
    }

    function buildWhispers(roster, sheet) {
        const per = whisperMap(sheet);
        return Object.keys(per).map(n => '/w ' + n + ' Your assignments: ' + per[n].join('; '));
    }

    // Paste payload for the RaidSpecScan addon: one "Name=body" line per whisper.
    // packChat keeps each body inside WoW's 255-character chat limit, so a player with
    // many duties simply gets more than one line — the addon sends each as its own whisper.
    function buildAddonWhispers(roster, sheet) {
        const per = whisperMap(sheet);
        const lines = ['RSW1'];
        Object.keys(per).forEach(n => {
            packChat('Your assignments: ', per[n], '; ', 255).forEach(body => {
                lines.push(n + '=' + body);
            });
        });
        return lines.join('\n');
    }
```

- [ ] **Step 4: Export it**

In the return block at the end of `assignments-engine.js`, change:

```js
        buildDiscord, buildRaidLines, buildWhispers,
```

to:

```js
        buildDiscord, buildRaidLines, buildWhispers, buildAddonWhispers,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node assignments-engine.test.js`
Expected: PASS, `68 passed, 0 failed`. All 62 pre-existing tests must still pass — the `buildWhispers` refactor is behaviour-preserving, so any change to an older test result is a bug in the extraction.

- [ ] **Step 6: Commit**

```bash
git add assignments-engine.js assignments-engine.test.js
git commit -m "Add buildAddonWhispers for the RaidSpecScan paste payload"
```

---

### Task 2: Web — the Addon output tab

**Files:**
- Modify: `assignments.html:62-65` (tab bar)
- Modify: `assignments.js:372-385` (`renderOutput`)

**Interfaces:**
- Consumes: `E.buildAddonWhispers(roster, sheet)` from Task 1.
- Produces: a tab whose `data-tab` value is `addon`. Nothing later depends on it.

The existing tab machinery needs no changes: the click handler at `assignments.js:418` already reads `tab.dataset.tab` into `activeTab` and re-renders, and the Copy button already copies `#outputBox.textContent`.

- [ ] **Step 1: Add the tab button**

In `assignments.html`, after the Whispers tab button, add:

```html
                <button class="tab" data-tab="addon">Addon</button>
```

The tab bar should then read, in order: Discord, Share link, /raid macro, Whispers, Addon.

- [ ] **Step 2: Render it**

In `assignments.js`, in `renderOutput`, add a branch after the `whispers` branch:

```js
    } else if (activeTab === 'addon') {
        box.textContent = E.buildAddonWhispers(roster, sheet);
```

- [ ] **Step 3: Verify in the browser**

Start the server if it isn't running: `node server.js`

Open `http://localhost:3000/assignments.html`, import a real roster, or paste this addon-scan string into the addon-import box:

```
RSS1;Tanky:WARRIOR:5/6/50;Dave:WARLOCK:41/0/20;Frostina:MAGE:0/11/50;Sheepmaster:MAGE:40/21/0;Healbot:PRIEST:23/38/0
```

Expected on the **Addon** tab: first line `RSW1`, then `Tanky=Your assignments: Sunder Armor` and similar. Confirm the 📋 Copy button copies it, and that switching to another tab and back re-renders correctly.

Kill the server afterwards if you started it.

- [ ] **Step 4: Commit**

```bash
git add assignments.html assignments.js
git commit -m "Add Addon output tab emitting the RSW1 payload"
```

---

### Task 3: Addon — paste window and preview

**Files:**
- Create: `RaidSpecScan/RaidSpecSend.lua`
- Modify: `RaidSpecScan/RaidSpecScan.toc`
- Modify: `RaidSpecScan/RaidSpecScan.lua` (expose `Print` on the namespace)

**Interfaces:**
- Produces, on the addon namespace table `ns`: `ns.Print(msg)`.
- Produces, file-local to `RaidSpecSend.lua`: `ParsePayload(text) -> entries, err` where `entries` is an array of `{ name = string, body = string }`; and `sheet`, the module-level array holding the last successfully parsed entries. Tasks 4 and 5 build on both.

This task delivers the window and the parse only. **No whispers are sent** — the Send button arrives in Task 4.

- [ ] **Step 1: Expose Print on the namespace**

In `RaidSpecScan/RaidSpecScan.lua`, add a namespace capture as the first line of the file, above the existing comment block is fine but keep it before any use:

```lua
local ADDON, ns = ...
```

Then, immediately after the existing `Print` function definition (`local function Print(msg) ... end`), add:

```lua
ns.Print = Print
```

Change nothing else in this file during this task.

- [ ] **Step 2: Load the new file**

In `RaidSpecScan/RaidSpecScan.toc`, change the file list at the bottom from:

```
RaidSpecScan.lua
```

to:

```
RaidSpecScan.lua
RaidSpecSend.lua
```

Order matters — `RaidSpecScan.lua` must run first so `ns.Print` exists.

- [ ] **Step 3: Create the send module with parsing and a preview window**

Create `RaidSpecScan/RaidSpecSend.lua`:

```lua
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
    frame.status:SetText("")
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
        f.status:SetText("Sending is not wired up yet.")
    end)

    f.backBtn = Button("Back", 100, 160)
    f.backBtn:SetScript("OnClick", ShowPaste)

    f.closeBtn = Button("Close", 100, 430)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)

    return f
end

SLASH_RAIDSPECSEND1 = "/specsend"
SlashCmdList["RAIDSPECSEND"] = function()
    if not frame then frame = BuildFrame() end
    if sheet then ShowPreview() else ShowPaste() end
    frame:Show()
end
```

- [ ] **Step 4: Syntax-check and install**

```bash
cd /Users/maxvanzoelen/wowstuff
luajit -bl RaidSpecScan/RaidSpecSend.lua /dev/null && echo "RaidSpecSend.lua OK"
luajit -bl RaidSpecScan/RaidSpecScan.lua /dev/null && echo "RaidSpecScan.lua OK"
cp RaidSpecScan/RaidSpecSend.lua RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc \
   "/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/"
```

Expected: both files report OK. `luajit -bl` only proves the file parses — it cannot check WoW API calls.

- [ ] **Step 5: Manual in-game check (cannot be automated)**

Fully quit and relaunch WoW, then:

1. `/specsend` — the window opens with an empty box and a Load button
2. Press Load with the box empty — expect the red message "Nothing pasted."
3. Paste `hello world`, press Load — expect "That is not an RSW1 payload…"
4. Paste a real payload from the Addon tab, press Load — expect the preview listing every player and duty, with Send all / Back / Close
5. Press Send all — expect "Sending is not wired up yet." (correct for this task)
6. Press Back — returns to the paste box

Record the result in the task report. If the window does not appear at all, `BackdropTemplate` may be unavailable on this client — report that rather than working around it, because it affects the existing export window too.

- [ ] **Step 6: Commit**

```bash
git add RaidSpecScan/RaidSpecSend.lua RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc
git commit -m "Add /specsend paste window and RSW1 payload parsing"
```

---

### Task 4: Addon — throttled sending

**Files:**
- Modify: `RaidSpecScan/RaidSpecSend.lua`

**Interfaces:**
- Consumes: `sheet` and the frame built in Task 3.
- Produces, file-local: `Resolve(entries) -> sendable, skipped` and `StartSending(list)`. Task 5 reuses both.

- [ ] **Step 1: Add raid-roster resolution**

In `RaidSpecSend.lua`, insert after `ParsePayload`:

```lua
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
```

- [ ] **Step 2: Add the sender**

Insert after `Resolve`:

```lua
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
```

- [ ] **Step 3: Wire the Send button**

Replace the placeholder `f.sendBtn:SetScript` block from Task 3 with:

```lua
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
```

- [ ] **Step 4: Disable Send when not in a raid**

In `ShowPreview`, replace `frame.status:SetText("")` with:

```lua
    if IsInRaid() then
        frame.status:SetText("")
        frame.sendBtn:Enable()
    else
        frame.status:SetText("Not in a raid — you can review, but not send.")
        frame.sendBtn:Disable()
    end
```

- [ ] **Step 5: Guard the slash command**

In the `/specsend` handler, add as the first line of the function body:

```lua
    if sending then Print("Already sending — wait for it to finish.") return end
```

- [ ] **Step 6: Syntax-check and install**

```bash
cd /Users/maxvanzoelen/wowstuff
luajit -bl RaidSpecScan/RaidSpecSend.lua /dev/null && echo "OK"
cp RaidSpecScan/RaidSpecSend.lua "/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/"
```

- [ ] **Step 7: Manual in-game check (cannot be automated)**

Relaunch WoW. Solo first, then in a raid:

1. Solo, `/specsend` → load a payload → preview shows "Not in a raid", Send is greyed out
2. In a raid of at least two, with a payload naming a real raid member → Send all whispers them roughly one per second, with `1/N to Name` progress in chat
3. A payload naming someone not in the raid → chat reports them as skipped, no whisper attempted
4. Press `/specsend` mid-send → "Already sending"

Report whether the whispers actually arrive. **This is the step that proves the design** — if `SendChatMessage` is blocked, nothing arrives and the feature needs rethinking. The `/specwhispertest` probe already in the addon answers the same question in isolation if this step is ambiguous.

- [ ] **Step 8: Commit**

```bash
git add RaidSpecScan/RaidSpecSend.lua
git commit -m "Send assignment whispers on a one-second timer"
```

---

### Task 5: Addon — changed-only re-sends

**Files:**
- Modify: `RaidSpecScan/RaidSpecSend.lua`
- Modify: `RaidSpecScan/RaidSpecScan.toc` (declare SavedVariables)
- Modify: `RaidSpecScan/RaidSpecScan.lua` (remove the temporary probe)

**Interfaces:**
- Consumes: `Resolve`, `StartSending`, `sheet` from Tasks 3 and 4.
- Produces: the global `RaidSpecScanDB` SavedVariable, shape `{ lastSent = { [characterName] = signature } }`.

- [ ] **Step 1: Declare the SavedVariable**

In `RaidSpecScan/RaidSpecScan.toc`, add after the `## Version:` line:

```
## SavedVariables: RaidSpecScanDB
```

- [ ] **Step 2: Add history and classification**

In `RaidSpecSend.lua`, insert after `Resolve`:

```lua
-- Account-wide, not per-character: the leader may swap toons between nights, but
-- the raid's assignments are the same either way.
local function History()
    RaidSpecScanDB = RaidSpecScanDB or {}
    RaidSpecScanDB.lastSent = RaidSpecScanDB.lastSent or {}
    return RaidSpecScanDB.lastSent
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
```

- [ ] **Step 3: Show the tags in the preview**

Replace `PreviewText` with:

```lua
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
    end
    return table.concat(rows, "\n"), changed
end
```

And in `ShowPreview`, replace the `frame.editBox:SetText(PreviewText())` line with:

```lua
    local text, changed = PreviewText()
    frame.editBox:SetText(text)
    frame.changedBtn:SetText("Send " .. changed .. " changed")
    if changed > 0 then frame.changedBtn:Enable() else frame.changedBtn:Disable() end
```

- [ ] **Step 4: Add the changed-only button**

In `BuildFrame`, move the existing buttons along and insert a new one. Replace the four `Button(...)` calls with:

```lua
    f.loadBtn = Button("Load", 100, 24)
    f.loadBtn:SetScript("OnClick", OnLoadClicked)

    f.changedBtn = Button("Send 0 changed", 140, 24)
    f.changedBtn:SetScript("OnClick", function() SendFiltered(ChangedOnly(sheet)) end)

    f.sendBtn = Button("Send all", 100, 172)
    f.sendBtn:SetScript("OnClick", function() SendFiltered(sheet) end)

    f.backBtn = Button("Back", 90, 280)
    f.backBtn:SetScript("OnClick", ShowPaste)

    f.closeBtn = Button("Close", 90, 430)
    f.closeBtn:SetScript("OnClick", function() f:Hide() end)
```

Both send buttons now share one path. Add `SendFiltered` immediately above `BuildFrame`, replacing the send logic that lived inline in the Task 4 button handler:

```lua
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
    StartSending(sendable)
    frame:Hide()
end
```

Also update `ShowPreview`'s not-in-raid branch to disable both buttons:

```lua
    if IsInRaid() then
        frame.status:SetText("")
        frame.sendBtn:Enable()
    else
        frame.status:SetText("Not in a raid — you can review, but not send.")
        frame.sendBtn:Disable()
        frame.changedBtn:Disable()
    end
```

- [ ] **Step 5: Record history after a successful send**

In `StartSending`, record the signatures of what is being sent. Replace the function with:

```lua
local function StartSending(list)
    queue, qIndex, sending = list, 0, true
    qElapsed = SEND_INTERVAL
    local last, sig = History(), Signatures(list)
    for name, s in pairs(sig) do last[name] = s end
    Print("Sending " .. #list .. " whispers, one per second…")
    sendFrame:SetScript("OnUpdate", SendTick)
end
```

History is written up front rather than per-message: a send that is interrupted mid-batch would otherwise leave the tail permanently marked NEW, and re-sending everything is the safer failure mode than a silent gap. Note this in the report.

- [ ] **Step 6: Add the reset command**

Replace the `/specsend` handler with:

```lua
SLASH_RAIDSPECSEND1 = "/specsend"
SlashCmdList["RAIDSPECSEND"] = function(msg)
    local arg = (msg or ""):match("^%s*(%S*)"):lower()
    if arg == "reset" then
        RaidSpecScanDB = RaidSpecScanDB or {}
        RaidSpecScanDB.lastSent = {}
        Print("Send history cleared — everyone counts as NEW again.")
        return
    end
    if sending then Print("Already sending — wait for it to finish.") return end
    if not frame then frame = BuildFrame() end
    if sheet then ShowPreview() else ShowPaste() end
    frame:Show()
end
```

- [ ] **Step 7: Remove the temporary probe**

In `RaidSpecScan/RaidSpecScan.lua`, delete the entire block introduced by the comment `-- TEMPORARY probe for the whisper feature` through the end of the `SlashCmdList["RAIDSPECWHISPERTEST"]` function. Its job is done — `/specsend` now exercises `SendChatMessage` for real.

- [ ] **Step 8: Syntax-check and install**

```bash
cd /Users/maxvanzoelen/wowstuff
luajit -bl RaidSpecScan/RaidSpecSend.lua /dev/null && echo "send OK"
luajit -bl RaidSpecScan/RaidSpecScan.lua /dev/null && echo "scan OK"
cp RaidSpecScan/RaidSpecSend.lua RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc \
   "/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan/"
```

- [ ] **Step 9: Manual in-game check (cannot be automated)**

Relaunch WoW (SavedVariables need a clean load), then:

1. First `/specsend` with a fresh payload → everyone tagged `NEW`, "Send N changed" equals the full count
2. Send all → whispers go out
3. `/specsend` again with the **same** payload → everyone tagged `UNCHANGED`, "Send 0 changed" is greyed out
4. Change one player's duty in the web tool, re-copy, paste → that player tagged `CHANGED`, everyone else `UNCHANGED`, "Send 1 changed" enabled
5. Send changed → exactly one whisper
6. `/specsend reset` → the next preview tags everyone `NEW` again
7. `/reload`, then `/specsend` → history survived the reload
8. `/specwhispertest` → should now be an unknown command

- [ ] **Step 10: Commit**

```bash
git add RaidSpecScan/RaidSpecSend.lua RaidSpecScan/RaidSpecScan.lua RaidSpecScan/RaidSpecScan.toc
git commit -m "Send only changed assignments on repeat sends"
```

---

## Final Verification

- [ ] `node assignments-engine.test.js` exits 0 with 68 passing
- [ ] `luajit -bl` parses both Lua files
- [ ] The Addon tab renders a valid `RSW1` payload for a real imported roster
- [ ] Files under `RaidSpecScan/` in the repo are byte-identical to the installed copies:
      `diff -r RaidSpecScan "/Applications/World of Warcraft/_anniversary_/Interface/AddOns/RaidSpecScan"`
- [ ] `git status` shows no unintended files staged across the five commits
- [ ] The in-game checks from Tasks 3, 4 and 5 are recorded as done or explicitly listed as pending

**Known to be unverifiable without a raid:** every in-game step. Report them as pending rather than assumed passing.
