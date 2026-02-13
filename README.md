# Gruul's Lair Positioning Tool

A web-based tool for managing raid positioning in World of Warcraft: The Burning Crusade Classic - Gruul's Lair encounter.

## Features

- **Visual Map**: Interactive map showing Gruul and all 25 raid positions with proper 18-yard spacing
- **Auto-Assignment**: Intelligent role-based positioning algorithm
- **WoW Addon Integration**: Export your raid directly from the game
- **Multiple Import Options**: CSV, addon export, or names-only formats
- **Role Management**: Support for Tanks, Healers, Melee DPS, and Ranged DPS
- **Export Configuration**: Save your setup as JSON for later use

## Quick Start

### 1. Start the Web Tool

Open a terminal in this folder and run:

```bash
python3 -m http.server 8000
```

Then open your browser to: `http://localhost:8000`

### 2. Option A: Use the WoW Addon (Recommended)

#### Install the Addon

1. Navigate to your WoW folder:
   - Windows: `C:\Program Files (x86)\World of Warcraft\_classic_\Interface\AddOns\`
   - Mac: `/Applications/World of Warcraft/_classic_/Interface/AddOns/`

2. Create a new folder called `GruulPositions`

3. Copy these files into that folder:
   - `GruulPositions.toc`
   - `GruulPositions.lua`

4. Restart WoW or type `/reload` in-game

#### Export Your Raid

1. Get into your Gruul's Lair raid group (25 players)
2. Type `/gruulpos` or `/gpos` in-game
3. A window will pop up with your raid export
4. **Ctrl+A** to select all, then **Ctrl+C** to copy
5. Go to the web tool and click "Bulk Import"
6. Select the "WoW Addon Export" tab
7. Paste the data and click "Import"

### 2. Option B: Manual Import

#### CSV Format

Click "Bulk Import" and paste in this format (one raider per line):

```
Name,Role
Tankwarrior,tank
Holypally,healer
Rogue1,melee
Mage1,ranged
```

**Valid Roles:**
- `tank` - Main tanks
- `healer` - All healers
- `melee` - Melee DPS (Rogues, Ret Paladins, Feral Druids, Enhancement Shamans)
- `ranged` - Ranged DPS and Hunters (Mages, Warlocks, Hunters, Shadow Priests, Balance Druids, Ele Shamans)

#### Names Only Format

If you just have a list of names, you can:
1. Click "Bulk Import"
2. Select "Names Only" tab
3. Choose a default role (you can change individual roles later)
4. Paste the names (one per line)

## How to Use

### Adding Raiders

1. **Manual Add**: Click "Add Raider Manually" to add one at a time
2. **Bulk Import**: Import multiple raiders at once (see formats above)
3. **WoW Addon**: Use the in-game addon to export your raid directly

### Assigning Positions

Once your raiders are imported:

1. Click **"Auto-Assign Positions"** to automatically place all raiders
   - Melee DPS and Tanks → Inner ring (12 yards from Gruul)
   - Ranged DPS and Healers → Middle (30 yards) and Outer rings (45 yards)
   - All positions maintain 18-yard spacing

2. **Manual Adjustment**:
   - Click any assigned position on the map to unassign that raider
   - Then manually assign them elsewhere

### Map Controls

- **Show Grid Lines**: Toggle concentric circles showing distance from Gruul
- **Role Colors**: Toggle color-coding by role (Red=Tank, Green=Healer, Yellow=Melee, Blue=Ranged)

### Filtering & Management

- Use role filters to view specific groups of raiders
- Click "Remove" on any raider to delete them from the list
- Click "Clear All" to start fresh
- Click "Clear Assignments" to keep raiders but remove position assignments

### Exporting Your Setup

Click **"Export Setup"** to download a JSON file with your complete configuration. You can reload this later if needed.

## Positioning Strategy

The tool uses three rings around Gruul:

- **Inner Ring** (12 yards, 8 positions)
  - Intended for: Tanks and Melee DPS
  - These players need to be close but still maintain 18-yard spacing

- **Middle Ring** (30 yards, 9 positions)
  - Intended for: Ranged DPS and Healers
  - Safe distance from boss while maintaining range

- **Outer Ring** (45 yards, 8 positions)
  - Intended for: Ranged DPS and Healers
  - Maximum safety from the boss

**Total: 25 positions** with proper 18-yard spacing for Shatter mechanic

## Tips

1. **Hunter Positioning**: Hunters can be placed in melee range if you have too many melee DPS, as they can shoot at any range
2. **Healer Spread**: Distribute healers evenly across rings for better healing coverage
3. **Main Tank**: Typically position your main tank at position 1-2 in the inner ring
4. **Assignment Markers**: In-game, you can use raid markers/world markers to mark positions 1, 5, 9, 13, etc. as reference points

## Troubleshooting

### Addon Not Showing Up in WoW
- Make sure the folder is named exactly `GruulPositions` (case-sensitive on Mac)
- Check that both `.toc` and `.lua` files are inside the folder
- Try `/reload ui` in-game
- Check addon list at character select screen

### Auto-Detect Role Issues
The addon attempts to detect roles automatically but may not always be accurate. Simply adjust roles after import if needed.

### Position Assignment Issues
If auto-assignment doesn't work perfectly for your raid composition, use the manual assignment feature by clicking positions on the map.

## System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Python 3 (for running the local server)
- World of Warcraft: The Burning Crusade Classic (for the addon)

## Credits

Created for World of Warcraft: The Burning Crusade Classic raid positioning.

## License

Free to use and modify for personal or guild use.
