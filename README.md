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
- Player vetting page (`vetting.html`): type a character name or load the roster, and get gear,
  hit and other stats, enchants, sockets and parses from Warcraft Logs with a pass / warn /
  fail / unverified verdict against editable thresholds. Gear is scored primarily with GearScore
  (the same TacoTip formula TBC players run), with average item level shown alongside it. Needs
  the WCL credentials below.
  - **Feedback report** (`Report` link in a player's row, opens `feedback.html`): a checklist of
    what is holding their parses back — one row per habit, aggregated over their live pulls,
    each with the measured number, what same-spec players within two item levels do on the same
    boss, and a fixed fix. A verdict line says what share of the gap is theirs, the raid's setup,
    or nobody's; "Fix first" holds the three biggest items, "Ask your raid leader" the group
    asks, "Where you stand" shows their DPS next to the other same-class players in their raid.
    Raid-wide bad pulls are counted under "Not on you". Everything is measured from Warcraft Logs
    (`/api/vet/feedback`, `vet-feedback.js`, `vet-gap.js`, `vet-checklist.js`) and rendered
    deterministically — no model is involved. "Copy text" copies the plain-text version. Needs
    `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`. Optional `report=<WCL report code>` analyses one raid
    night. The facts sheet carries `overall.checklist` (rows, verdict, caps) and per-pull `gap`.
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
