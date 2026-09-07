# Raid Assignments

A raid-leading suite for World of Warcraft: The Burning Crusade (Anniversary/Classic 2.5.6):
a web tool that plans debuff, cooldown and group assignments for a 25-man roster, and a
companion in-game addon that scans the raid, whispers everyone their job, rearranges the
groups, and checks live whether assignments were actually done.

## The two halves

**Web tool** (`assignments.html` + `assignments-engine.js`, served by `server.js`)

- Import your roster from Raid-Helper (Discord event ID) or straight from the in-game addon
  (`/specscan` export string with per-player specs and tracked talents).
- Auto-assigns boss debuffs, crowd control and cooldowns per boss, talent-aware
  (e.g. only an Improved Scorch mage gets the Scorch assignment).
- Greater Blessings grid for paladins.
- Group layout optimizer: hill-climb with sim-calibrated, duration-aware buff weights
  (see `calibration/`), optional per-player performance multipliers prefetched from
  Warcraft Logs.
- Player vetting page (`vetting.html`): type a character name, load the roster, or **load a whole
  raid from a Warcraft Logs report** (pick one of your guild's recent nights, or paste a report
  code / URL) — gear, hit, enchants and sockets appear at once from that log's combatant data and
  parses stream in behind them. Each row gets a pass / warn / fail / unverified verdict against
  editable thresholds. Gear is scored primarily with GearScore
  (the same TacoTip formula TBC players run), with average item level shown alongside it. Needs
  the WCL credentials below.
  - **Feedback report** (`Report` link in a player's row, opens `feedback.html`): a checklist of
    what is holding their parses back — one row per habit, aggregated over their live pulls,
    each with the measured number, what same-spec players ahead of them at their item level do on
    the same boss — the reference sits halfway between them and the best parse within two item
    levels, so it is a reachable target above them rather than a middle they may already beat.
    On a pull where nobody at their item level beat them there is no reference at all and the
    report says so instead of inventing one. Each row also carries a fixed fix. A verdict line says
    what share of the gap is theirs, the raid's setup, or nobody's; "Fix first" holds the three
    biggest items, "Ask your raid leader" the group asks, "Where you stand" shows their DPS next
    to the other same-class players in their raid.
    Raid-wide bad pulls are counted under "Not on you". Everything is measured from Warcraft Logs
    (`/api/vet/feedback`, `vet-feedback.js`, `vet-gap.js`, `vet-checklist.js`) and rendered
    deterministically — no model is involved. "Copy text" copies the plain-text version. Needs
    `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`.
    The page opens on a night picker listing every raid night from both tiers (BT / Hyjal and
    SSC / TK); choosing one runs the analysis for that night, "Across all kills" runs it over
    both tiers. `report=<WCL report code>` in the URL (which a Report link from a log-loaded
    vetting row carries) opens straight onto that night. The facts sheet carries
    `overall.checklist` (rows, verdict, caps) and per-pull `gap`.
- **Fight briefings** ([High Warlord Naj’entus](tactics.html?fight=bt-najentus), [Supremus](tactics.html?fight=bt-supremus), [Shade of Akama](tactics.html?fight=bt-akama), [Reliquary of Souls](tactics.html?fight=bt-reliquary)): Supremus has nine guided scenes for explaining positions,
  Hateful Strike, blue fire, fixate, volcanoes and both phase transitions. Each scene has
  a main raid call, relevant spell tooltip cards, role instructions and a common mistake. Play/pause, replay, speed
  and scrubbing let the raid leader control the demonstration; animations hold at the end.
  Space plays/pauses, arrows change scenes, R replays and F toggles fullscreen.
  The page uses the imported roster and its main-tank flag, including an optional third
  tank. Player names appear during positioning; mechanics use icons and short role labels.
  Tanks keep tanking during the early melee spread, moving once fixate begins.
  Without a roster it shows a labelled example raid. Positions, routes and danger
  circles are illustrative. "Copy briefing" includes the current guidance and roster;
  "Copy image" includes the current map and main call. Detailed mechanics and source
  links are under "Mechanics & sources". Naj’entus has seven state-driven chapters: the loop,
  positions, Needle splash, freeing an Impaling Spine, healing through Tidal Shield, one called
  Hurl Spine, and the complete cycle. Its state display and exports follow the current illustrative frame.
  Shade of Akama has ten chapters based on the guild spreadsheet, its strategy image and the raid’s alternate AoE tactic,
  with channeler and sorcerer bindings, hallway tank control and Frost Traps, Rain of Fire,
  a dedicated slow RP walk with tanks gathering their adds around the moving Shade before cleanup,
  and the final Lust burn while Akama tanks the Shade. The alternative chapter demonstrates
  pulling doorway packs up to the Channelers, AoEing them together, then focusing the Shade
  while tanks keep the few surviving adds controlled.
  Reliquary of Souls has eleven chapters based on the guild sheet: closest-player Suffering rotations and Soul Drain, gathered soul recovery, Desire recoil and shrinking maximum mana, Rune Shield removal before interrupt rotations, Deaden, Anger threat control and facing, Spite, and the complete essence cycle. Teaching chapters use manual explanations: Left/Right or Previous/Next advances one explanation, with unlimited reading time. Replay repeats the current demonstration; chapter tabs jump to its first explanation. "Put it together" retains continuous playback. Positions, health and resources are illustrative, and exports follow the selected explanation.
  Its map, current calls and roster exports follow the same frame; timing and health are illustrative.
  Tabs follow boss order, and the default briefing opens Naj’entus.
- Output: share links (`assignments-view.html`), Discord-ready text, and an addon payload
  (RSW3) that carries whispers, the group layout, and compliance-tracking lines.

**In-game addon** (`RaidAssign/`)

- `/specscan` — scan raid specs and talents, export for the web tool.
- `/vet` — copy a link that adds a player to the vetting page: Ctrl+click a name in chat or a
  row in the Looking for Group browser (a group row carries every member), `/vet` for your target, `/vet <name>`, or `/vet list` for everyone who whispered since login.
  Paste it into the address bar of the open vetting tab; the page adds the player there.
- `/specsend` — import the RSW3 payload; whisper each player their assignments, apply the
  optimizer's group layout with one click.
- `/racheck` — per-pull compliance scoreboard: were assigned debuffs and group buffs
  actually kept up, and by whom. A live in-fight view shows uptimes as they happen.
- Minimap hub with status lines and buttons for all of the above.

Install by copying the `RaidAssign/` folder into `Interface/AddOns/`.

## Running the web tool

```bash
npm install
npm start          # serves on http://localhost:3000
```

Optional environment (in `.env` or the shell):

- `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` — enables the Warcraft Logs performance-multiplier
  prefill (`/api/wcl/player`).
- `OPENAI_API_KEY` — enables the `/api/ai-review` endpoint.

Deploys to Railway as-is (`railway.json`, `npm start`).

## Tests

```bash
npm test                          # engine, WCL multiplier, positions, item table, vetting, feedback, gap, checklist and server suites (node, no deps)
npm run test:tactics-browser       # Node 22+ and Chrome; isolated profile, optional CHROME_BIN override
npm run test:storage-browser       # same harness; vetting/feedback browser storage (IndexedDB report cache, full-localStorage saves)
luajit raid-assign.test.lua       # addon: payload parsing, whisper queue
luajit raid-spec-scan.test.lua    # addon: talent scanning
luajit raid-track.test.lua        # addon: compliance tracking
```

The Lua suites stub the WoW API and drive the addon's public surface; run them from the
repo root.

## Calibration

`calibration/` holds the pipeline that produces the optimizer's buff weights: wowsims-driven
sims at several fight durations (200/300/520s), anchor interpolation, and verification
gates. See `calibration/README.md` before regenerating weights.

## Item table

`data/tbc-item-db.json` is the trimmed wowsims item/gem/enchant table the vetting page's stat
math runs on. Regenerate it after updating the wowsims checkout under `calibration/vendor/`:

```bash
node calibration/extract-item-db.mjs
```

## History

The repo previously also contained standalone positioning tools for Gruul's Lair and
Magtheridon; they were removed in the 2026-08 cleanup and live on in git history.
