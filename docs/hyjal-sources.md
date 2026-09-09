# Hyjal Summit briefing sources

The guided briefings use the guild’s Hyjal cheat sheet as the raid-plan source. The copied images preserve the formation annotations used by the presenter; they are teaching diagrams, not measured collision or timer data.

- [Guild strategy sheet](https://docs.google.com/spreadsheets/d/1G-gKlnhkNR6RmLISbSZOCe5Disi_WNB0Gv2Tk19CxVg/edit) — encounter plans, camp formations, wave tables, consumable notes, and Archimonde class-group Soul Charge tooltips.
- [Rage Winterchill guide](https://www.wowhead.com/tbc/guide/rage-winterchill-hyjal-summit-strategy-burning-crusade-classic) — Icebolt, Frost Nova, and Death and Decay mechanics. The sheet’s prevention-potion advice is stated precisely: Free Action Potion prevents a later effect and does not remove an existing root.
- [Anetheron guide](https://www.wowhead.com/tbc/guide/anetheron-hyjal-summit-strategy-burning-crusade-classic) — Carrion Swarm healer spacing, Sleep, remote Fire Resistance Infernal tanking, and the roughly minute-scale Inferno cadence. The guild diagram explicitly says Infernals are not tauntable; the briefing teaches threat pickup.
- [Kaz'rogal guide](https://www.wowhead.com/tbc/guide/kazrogal-hyjal-summit-strategy-burning-crusade-classic) — Mark’s five 600-mana drains, explosion condition, three-way Cleave split, and 15-yard War Stomp. The sheet’s 12-yard sketch is retained as a source note, while the briefing uses the safer 15-yard distance. Mark cadence accelerates and is intentionally not presented as a live timer.
- [Azgalor NPC strategy notes](https://www.wowhead.com/tbc/npc=17842/azgalor) — tank/ranged camp placement. Guild sheet supplies the 20-second Doom sequence, Soulstone call, the northern-Tauren-tents Doomguard lane, persistent Rain of Fire damage-over-time warning, and shorter-range Shadow Priest exception.
- [Archimonde guide](https://www.wowhead.com/tbc/guide/archimonde-hyjal-summit-strategy-burning-crusade-classic) — Tears of the Goddess, Doomfire, Fear, Grip of the Legion, and Air Burst. The sheet records a PTR-only tank Air Burst observation as source context; it does not override the selected party-stack briefing.

The Winterchill demonstration follows the sheet: the main tank holds at the ballista with dedicated healing through Death and Decay while affected raid players leave the patch. The Archimonde sheet’s Soul Charge tooltips are the 6-second-silence version; current guide text may describe a different post-nerf duration, so the presenter labels the sheet value as its selected raid-plan version.

## Guild diagrams retained in the site

- `maps/tactics/hyjal-source-winterchill.png` — Winterchill Alliance camp formation.
- `maps/tactics/hyjal-source-anetheron.png` — Anetheron spread and Infernal lane.
- `maps/tactics/hyjal-source-kazrogal.png` — Kaz'rogal Horde camp three-tank stack and ranged positions.
- `maps/tactics/hyjal-source-azgalor.png` — Azgalor Rain of Fire ring and Doomguard lane.
- `maps/tactics/hyjal-source-archimonde.png` — historical Archimonde loose-group diagram.
- `maps/tactics/hyjal-source-tears.png`, `maps/tactics/hyjal-source-soul-charge.png`, `maps/tactics/hyjal-source-soul-charge-yellow.png`, and `maps/tactics/hyjal-source-soul-charge-green.png` — Tears and all three Soul Charge tooltip references.

## Formation interpretation

The clean camp maps use the same orientation as the embedded guild diagrams.
Positions are anchored to those landmarks; the sketches are not a measured yard grid.

- Winterchill: ballista, main tank northeast, melee southwest; healers and ranged distributed around the entire boss.
- Anetheron: same ballista facing and full perimeter spread, with the Infernal tank north near Jaina. Healers avoid the dense rear melee lanes; the two tank healers are diametrically opposite. The add healer stays outside the pulse; the target stops short of the waiting tank, then leaves after the landing stun.
- Kaz'rogal: the illustrated Thrall location in the lower Horde camp, three tanks together southeast, melee behind to the northwest, healers north/east and ranged west/north. The alternate near-spawn pull remains a textual option.
- Azgalor: lower camp, tank southeast and melee northwest, ranged/healers on the northern side of the 30-yard targeting boundary. Doom death and drop are at the northern Tauren tents; the off-tank picks up there. Shadow Priests use a closer slot. Rain moves the boss formation east, preserving its facing and the separate add lane.
- Archimonde: the presenter uses the Positioning tab’s imported party assignments and saved adjustments, not the historical loose-group diagram. Each party stacks for Tremor support. Grip decurse is raid-wide and immediate, not a per-party requirement. Doomfire can curve toward one party, which sidesteps together while the trail remains; the tank only repositions when fire threatens tank and melee space.

## User-selected overrides

The source images establish encounter mechanics and historical landmarks. The following current raid-lead choices override their formation interpretation in the briefing: Anetheron healer lanes and diametrically opposite tank healers; Azgalor’s northern-Tauren-tents Doom lane; and Archimonde’s exact Positioning-tab party stacks with saved adjustments. These are selected raid-plan instructions, not claims made by the historical diagrams or external guides.

Validation checks these spatial relationships as well as range, safe routes, and viewport bounds. Passing a canvas-boundary check alone does not establish fidelity to a strategy diagram.
