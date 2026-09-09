(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./tactics-hyjal-archimonde.js"));
  else root.TacticsHyjalData = factory(root.TacticsHyjalArchimonde);
})(typeof self !== "undefined" ? self : this, function (ARCH) {
  "use strict";
  const sheet =
    "https://docs.google.com/spreadsheets/d/1G-gKlnhkNR6RmLISbSZOCe5Disi_WNB0Gv2Tk19CxVg/edit";
  const icons = {
    armor: "maps/tactics/icon-spell_frost_summonwaterelemental.jpg",
    vampiric: "maps/tactics/icon-spell_shadow_shadowmend.jpg",
    cripple: "maps/tactics/icon-spell_shadow_shadowfury.jpg",
    icebolt: "maps/tactics/icon-spell_frost_iceshard.jpg",
    dnd: "maps/tactics/icon-spell_shadow_rainoffire.jpg",
    nova: "maps/tactics/icon-spell_frost_summonwaterelemental.jpg",
    swarm: "maps/tactics/icon-spell_shadow_shadowfury.jpg",
    infernal: "maps/tactics/icon-spell_fire_felimmolation.png",
    sleep: "maps/tactics/icon-ability_hibernation.jpg",
    cleave: "maps/tactics/icon-ability_warrior_cleave.jpg",
    mark: "maps/tactics/icon-spell_shadow_shadowmend.jpg",
    stomp: "maps/tactics/icon-ability_warrior_rampage.jpg",
    doom: "maps/tactics/icon-spell_shadow_soulleech_1.jpg",
    rain: "maps/tactics/icon-spell_shadow_rainoffire.jpg",
    howl: "maps/tactics/icon-spell_shadow_coneofsilence.jpg",
    tears: "maps/tactics/icon-spell_nature_healingwavegreater.jpg",
    airburst: "maps/tactics/icon-spell_nature_abolishmagic.jpg",
    doomfire: "maps/tactics/icon-spell_fire_felfire.png",
    fear: "maps/tactics/icon-spell_shadow_shadowfury.jpg",
    curse: "maps/tactics/icon-spell_shadow_soulleech_1.jpg",
    soulcharge: "maps/tactics/icon-spell_shadow_teleport.jpg",
  };
  const briefingIds = {
    overview: "plan",
    positioning: "plan",
    tears: "confirm",
    waves: "plan",
    icebolt: "target",
    dnd: "appears",
    nova: "root",
    swarm: "cone",
    infernal: "target",
    sleep: "sleep",
    cleave: "stack",
    mark: "prepare",
    stomp: "radius",
    doom: "marked",
    rain: "rain",
    howl: "howl",
    airburst: "launch",
    doomfire: "spawns",
    fear: "fear",
    curse: "grip",
    soulcharge: "death",
    finish: "plan",
  };
  const scene = (
    id,
    chapter,
    title,
    caption,
    call,
    why,
    jobs,
    mistake,
    duration,
    highlight,
  ) => ({
    id,
    chapter,
    title,
    caption,
    call,
    why,
    jobs,
    mistake,
    duration,
    highlight,
    formation: 1,
    // Keep the raid and remote add lanes in a stable frame throughout each demonstration.
    view: { fit: "arena" },
    actors: [],
    effects: [],
    animated: !["overview", "positioning", "tears", "waves"].includes(id),
    optional: id === "waves",
    briefing: briefingIds[id]
      ? [{ id: briefingIds[id], title, detail: call }]
      : undefined,
  });
  const ability = (id, name, description, doThis, url) => ({
    id,
    name,
    icon: icons[id],
    url,
    tier: 1,
    phase: 1,
    stageLabel: name,
    who: "Raid",
    tooltip: { description },
    doThis,
  });
  const guides = {
    "hyjal-winterchill":
      "https://www.wowhead.com/tbc/guide/rage-winterchill-hyjal-summit-strategy-burning-crusade-classic",
    "hyjal-anetheron":
      "https://www.wowhead.com/tbc/guide/anetheron-hyjal-summit-strategy-burning-crusade-classic",
    "hyjal-kazrogal":
      "https://www.wowhead.com/tbc/guide/kazrogal-hyjal-summit-strategy-burning-crusade-classic",
    "hyjal-azgalor": "https://www.wowhead.com/tbc/npc=17842/azgalor",
    "hyjal-archimonde":
      "https://www.wowhead.com/tbc/guide/archimonde-hyjal-summit-strategy-burning-crusade-classic",
  };
  const base = (
    id,
    slug,
    name,
    portrait,
    map,
    sourceImages,
    stateLabels,
    abilities,
    scenes,
    tips,
    trashWaves,
  ) => ({
    id,
    slug,
    name,
    where: "Hyjal Summit",
    portrait,
    map,
    mapSize: { width: 1600, height: 889 },
    aspect: 1600 / 889,
    mapFilter: "brightness(1.18) contrast(1.04) saturate(.8)",
    clockMode: "state",
    positioningSceneId: "positioning",
    referenceTitle: "Mechanics & sources",
    remindersTitle: "From the guild strategy sheet",
    arena: { x0: 0.08, x1: 0.92, y0: 0.08, y1: 0.92 },
    yard: 0.005,
    bossAt: { x: 0.5, y: 0.38 },
    roster: { tanks: 3, melee: 7, healers: 6, ranged: 9 },
    arcs: [
      { count: 10, radius: 18, from: 45, to: 135 },
      { count: 12, radius: 29, from: 30, to: 150 },
    ],
    stack: {
      tankApart: 0,
      tankBack: 7,
      arcRadius: 10,
      arcFrom: 35,
      arcTo: 145,
    },
    stateLabels: {
      overview: "The plan",
      complete: name + " defeated",
      ...stateLabels,
    },
    recapRows: [],
    trashWaves,
    legend: [
      { kind: "tank", label: "Tank position", exportLabel: "Blue: tank" },
      { kind: "move", label: "Movement route", exportLabel: "Pale: move" },
      { kind: "danger", label: "Danger area", exportLabel: "Orange: danger" },
    ],
    source: "Guild Hyjal strategy sheet",
    sources: [
      { name: "Guild strategy sheet — Hyjal tabs", url: sheet },
      ...sourceImages.map((item) => ({ name: item.name, url: item.path })),
      { name: "Wowhead — " + name, url: guides[id] },
    ],
    referenceImages: sourceImages,
    abilities: abilities.map((item) => ({
      ...item,
      url: item.url || guides[id],
    })),
    scenes,
    tips,
  });
  const waves = (camp) =>
    scene(
      "waves",
      "Optional wave reference",
      "Trash priorities before the boss.",
      "Use the actual eight-wave list in Mechanics & sources; this optional chapter only reinforces interrupt, control, and recovery priorities.",
      "Use the guild wave list; pause, recover, and assign control before the next pull.",
      "The boss briefing does not simulate trash.",
      [
        [
          "Raid lead",
          `Use the ${camp} camp wave table in Mechanics & sources.`,
        ],
        [
          "Interrupts",
          "Stop Necromancer casts and Banshee Wail; dispel priority effects.",
        ],
        [
          "Tanks",
          "Control Abominations and do not overextend into the next wave.",
        ],
      ],
      "Treating the reference as a timed boss simulation.",
      10000,
      [],
    );
  const winter = base(
    "hyjal-winterchill",
    "winterchill",
    "Rage Winterchill",
    "maps/rage-winterchill-icon.png",
    "maps/tactics/hyjal-alliance-map.jpg",
    [
      {
        name: "Guild formation — Rage Winterchill",
        path: "maps/tactics/hyjal-source-winterchill.png",
      },
    ],
    {
      ready: "Prepare",
      positioning: "Pull · spread",
      icebolt: "Icebolt · save target",
      dnd: "Death and Decay · move",
      nova: "Frost Nova · free movement",
      finish: "Finish",
      waves: "Wave reference",
    },
    [
      ability(
        "icebolt",
        "Icebolt",
        "A random player takes 4–5k Frost damage, is stunned, and takes another 10k Frost damage over 5 seconds.",
        "Heal the target immediately; use the available immunity or PvP trinket as assigned.",
        "https://www.wowhead.com/tbc/guide/rage-winterchill-hyjal-summit-strategy-burning-crusade-classic",
      ),
      ability(
        "dnd",
        "Death and Decay",
        "A 20-yard ground effect deals 15% maximum health each second while players remain in it.",
        "Raid players leave promptly. The guild plan allows the tank to hold position with dedicated healing.",
      ),
      ability(
        "nova",
        "Frost Nova",
        "Roots players within 20 yards for 10 seconds and deals Frost damage.",
        "Free movement fast, especially if Death and Decay is nearby.",
      ),
    ],
    [
      scene(
        "overview",
        "The plan",
        "Spread, save Icebolt, leave Death and Decay.",
        "Winterchill is a single-phase positioning fight: spread heal coverage, react to Icebolt, and move out of Death and Decay.",
        "Spread. Keep tank healing covered. Move from ground danger.",
        "Wide spacing limits overlapping pressure while assigned healers save Icebolt victims.",
        [
          [
            "Healers",
            "Assign nearby Icebolt coverage without abandoning the tank.",
          ],
          [
            "Everyone",
            "Bring the PvP trinket or a planned immunity if assigned.",
          ],
        ],
        "Everyone collapsing to heal one Icebolt target.",
        10000,
        ["icebolt", "dnd"],
      ),
      scene(
        "positioning",
        "Pull & spread",
        "Pull to the ballista and use the whole camp.",
        "A Hunter Misdirection pulls Winterchill to the ballista. The main tank faces him northeast, melee stay southwest behind him, and healers/ranged spread all around the ballista area.",
        "Lust once positioned. Keep a clear escape route from the boss.",
        "Spread groups reduce Death and Decay and retain immediate healing reach.",
        [
          ["Tank", "Hold at the ballista, facing northeast."],
          ["Melee", "Stay behind and be ready to leave ground effects."],
          [
            "Backline",
            "Use your assigned pocket; heal the nearest Icebolt target.",
          ],
        ],
        "Stacking ranged and healers in one lane.",
        10000,
        ["dnd"],
      ),
      scene(
        "icebolt",
        "Icebolt",
        "Save the frozen player without dropping the tank.",
        "The target takes immediate and ticking damage while briefly unable to act. This example is an assigned nearby-healer response, not a live cast timer.",
        "Call the target. Assigned healers heal now; tank coverage stays active.",
        "Fast distributed coverage prevents an Icebolt from becoming a tank-healing gap.",
        [
          ["Icebolt target", "Use the planned escape tool if available."],
          ["Nearby healers", "Stabilize the target immediately."],
          ["Tank healers", "Do not all leave the tank."],
        ],
        "Every healer swapping and leaving the tank exposed.",
        10000,
        ["icebolt"],
      ),
      scene(
        "dnd",
        "Death and Decay",
        "Raid moves out; keep the tank healed.",
        "The visual can be hard to see. Raid players leave the 20-yard patch. In the guild plan, the main tank can stay at the ballista while assigned healers cover the damage; melee give up uptime to get clear.",
        "Raid out of the patch. Keep dedicated heals on the tank holding the boss.",
        "Staying in a percentage-health ground effect turns small positioning errors lethal.",
        [
          ["Raid", "Move out; do not wait for a heal."],
          [
            "Tank",
            "Hold the boss at the ballista while assigned healers cover you.",
          ],
          ["Healers", "Keep moving players and tank covered."],
        ],
        "Standing in the effect because it is under another player.",
        10000,
        ["dnd"],
      ),
      scene(
        "nova",
        "Frost Nova",
        "Free movement before the next ground effect.",
        "Frost Nova roots nearby players. Priests and other available removals free melee and the tank when movement matters; Free Action Potion prevents a future application but does not remove an existing root.",
        "Remove the root when it blocks escape. Keep the next Death and Decay in mind.",
        "A root is dangerous when it overlaps the ground effect, not because it is a damage race.",
        [
          ["Dispellers", "Prioritize players who must move."],
          ["Tank", "Call immediately if rooted in danger."],
          ["Melee", "Use the available removal and leave safely."],
        ],
        "Using a prevention potion after already being rooted.",
        10000,
        ["nova"],
      ),
      scene(
        "finish",
        "Finish",
        "Keep the spread through the kill.",
        "There is no special execute mechanic: finish with the same Icebolt saves and ground discipline.",
        "Do not collapse for damage; keep the formation until the boss dies.",
        "The last deaths usually come from dropping ordinary jobs.",
        [["Raid", "Keep assigned healing and movement calls."]],
        "Ending the spread before combat ends.",
        10000,
        ["icebolt", "dnd"],
      ),
      waves("Alliance"),
    ],
    [
      "Spread heal coverage; Icebolt saves do not replace tank healing.",
      "Death and Decay is a movement call, even under the tank.",
      "Free Action Potion prevents later effects; it does not clear an existing Frost Nova.",
    ],
  );
  const anetheron = base(
    "hyjal-anetheron",
    "anetheron",
    "Anetheron",
    "maps/anetheron-icon.png",
    "maps/tactics/hyjal-alliance-map.jpg",
    [
      {
        name: "Guild formation — Anetheron",
        path: "maps/tactics/hyjal-source-anetheron.png",
      },
    ],
    {
      ready: "Prepare",
      positioning: "Pull · spread",
      swarm: "Carrion Swarm",
      infernal: "Infernal pickup",
      sleep: "Sleep",
      finish: "Finish",
      waves: "Wave reference",
    },
    [
      ability(
        "swarm",
        "Carrion Swarm",
        "A cone toward a random target damages players hit and severely reduces their healing done.",
        "Stay spread so one swarm cannot disable the healing team.",
        "https://www.wowhead.com/tbc/guide/anetheron-hyjal-summit-strategy-burning-crusade-classic",
      ),
      ability(
        "infernal",
        "Inferno",
        "An Infernal lands at a random target with a 2-second stun, then pulses 3500 Fire damage every 2 seconds within 15 yards.",
        "Target runs toward the off-tank but does not stack on them; the off-tank establishes threat away from the raid.",
      ),
      ability(
        "sleep",
        "Sleep",
        "Three random players sleep for 10 seconds; it cannot be dispelled, but damage wakes them.",
        "Use backup coverage; do not rely on sleeping healers.",
      ),
    ],
    [
      scene(
        "overview",
        "The plan",
        "Spread healers; isolate every Infernal.",
        "Carrion Swarm punishes clusters, Infernals create an add-tank job, and Sleep removes players unpredictably.",
        "Spread. Keep boss and add healing assignments.",
        "Separate responsibilities keep a random mechanic from removing all coverage.",
        [
          ["Boss tank", "Maintain boss control and mitigation."],
          ["Infernal tank", "Use Fire Resistance and wait away from the raid."],
          ["Healers", "Assign backup coverage for Sleep and Carrion Swarm."],
        ],
        "Putting all healers in the same Carrion Swarm cone.",
        10000,
        ["swarm", "infernal"],
      ),
      scene(
        "positioning",
        "Pull & positions",
        "Healers clear of rear melee lanes; tank healers opposite.",
        "Pull to the ballista and face Anetheron northeast. Keep healers off the dense rear melee lanes. Put the two tank healers diametrically opposite. Keep the Infernal tank north near Jaina, with healer coverage outside the pulse.",
        "Lust once positioned. Keep the Infernal lane clear.",
        "The layout limits Swarm overlap and makes each Infernal’s destination obvious.",
        [
          ["Infernal tank", "Wait in Fire Resistance gear away from the raid."],
          [
            "Raid",
            "Healers stay off rear melee lanes; tank healers are diametrically opposite.",
          ],
        ],
        "Standing near the add tank before an Infernal exists.",
        10000,
        ["swarm", "infernal"],
      ),
      scene(
        "swarm",
        "Carrion Swarm",
        "This Swarm hits melee, not healers.",
        "Carrion Swarm can target anyone. This example aims through dense melee and misses the healer lanes; the two tank healers remain diametrically opposite for a random healer-targeted Swarm.",
        "Healers stay off rear melee lanes. Opposite tank healers cover each other.",
        "The healing reduction, rather than the hit alone, creates the tank danger.",
        [
          ["Affected healers", "Call reduced healing."],
          ["Backups", "Cover the boss tank and affected group."],
        ],
        "Several healers sharing the same target line.",
        10000,
        ["swarm"],
      ),
      scene(
        "infernal",
        "Infernal",
        "Move toward the off-tank, then let them establish threat.",
        "The selected player moves toward the remote off-tank but stops short so the landing stun and fire pulse do not catch the tank. Infernals are not tauntable; pickup is threat, not a taunt response.",
        "Target toward the OT, not on the OT. OT uses ranged threat and keeps it away.",
        "A clean landing prevents a pulse in the raid and gives the off-tank space to establish control.",
        [
          ["Target", "Run toward the pickup lane; stop before the tank."],
          [
            "Infernal tank",
            "Use ranged threat pickup and keep Fire Resistance coverage.",
          ],
          [
            "Ranged",
            "Kill the Infernal if assigned; never stand in its pulse.",
          ],
        ],
        "Running directly onto the off-tank or expecting a taunt to fix the spawn.",
        10000,
        ["infernal"],
      ),
      scene(
        "sleep",
        "Sleep",
        "Backups cover ten seconds of missing players.",
        "Sleep can remove two or three random players and cannot be dispelled. Damage wakes sleepers, but no one should deliberately spread Infernal pulse damage to wake them.",
        "Call sleeping healers; backups take their assignments.",
        "Prepared redundancy protects tank coverage through random Sleep.",
        [
          ["Healers", "Use the backup assignments."],
          ["Raid", "Avoid waking sleepers with avoidable damage."],
        ],
        "Assuming Sleep is dispellable.",
        10000,
        ["sleep"],
      ),
      scene(
        "finish",
        "Finish",
        "Maintain the add lane through the kill.",
        "Keep healing-reduction calls and Infernal separation until Anetheron dies.",
        "Boss and add jobs remain active until combat ends.",
        "Late Infernals are still lethal if they land in the raid.",
        [["Raid", "Keep spread and off-tank healing."]],
        "Collapsing on the boss while an Infernal remains.",
        10000,
        ["infernal"],
      ),
      waves("Alliance"),
    ],
    [
      "Infernals are not tauntable; establish threat from the remote pickup lane.",
      "Carrion Swarm coverage is a healer-spacing problem.",
      "Sleep cannot be dispelled; use backup assignments.",
    ],
  );
  const kazrogal = base(
    "hyjal-kazrogal",
    "kazrogal",
    "Kaz'rogal",
    "maps/kazrogal-icon.png",
    "maps/tactics/hyjal-horde-map.jpg",
    [
      {
        name: "Guild formation — Kaz'rogal",
        path: "maps/tactics/hyjal-source-kazrogal.png",
      },
    ],
    {
      ready: "Prepare",
      positioning: "Pull · three tanks",
      cleave: "Malevolent Cleave",
      mark: "Mark of Kaz'rogal",
      stomp: "War Stomp",
      finish: "Finish",
      waves: "Wave reference",
    },
    [
      ability(
        "cleave",
        "Malevolent Cleave",
        "A 23k frontal hit is split among targets in front of the boss.",
        "Three tanks stack in front; everyone else avoids the frontal.",
      ),
      ability(
        "mark",
        "Mark of Kaz'rogal",
        "Every mana user loses 600 mana per second for five seconds; a failed drain causes a lethal nearby explosion.",
        "Stay above 3000 mana with planned resources; if doomed, leave other players.",
        "https://www.wowhead.com/tbc/guide/kazrogal-hyjal-summit-strategy-burning-crusade-classic",
      ),
      ability(
        "stomp",
        "War Stomp",
        "Players within 15 yards take damage and are stunned for five seconds.",
        "Keep ranged outside 15 yards; a Free Action Potion prevents a future stun but does not remove one already applied.",
      ),
    ],
    [
      scene(
        "overview",
        "The plan",
        "Three tanks share Cleave; mana survives Mark.",
        "Kaz’rogal is a burn with two non-negotiables: the three-tank cleave stack and mana plans that stay safely above 3000 before Marks.",
        "Stack tanks. Manage mana early. Spread for a possible explosion.",
        "A correct opening prevents both the immediate cleave wipe and the late soft enrage.",
        [
          ["Tanks", "Three tanks stack for every cleave."],
          ["Mana users", "Plan potions, runes and class tools before Marks."],
          ["Raid", "Leave room between players."],
        ],
        "Treating Mark as a precise live timer.",
        10000,
        ["cleave", "mark"],
      ),
      scene(
        "positioning",
        "Pull & three-tank stack",
        "Three tanks southeast; melee behind, backline north.",
        "The illustrated pull uses the clearing near Thrall: three tanks stack southeast of Kaz’rogal, melee stay northwest behind him, and the backline fans out north and west beyond the 15-yard Stomp radius. The near-spawn pull is an alternative.",
        "Lust once positioned near Thrall. Keep the three tanks together.",
        "The tank stack splits Cleave while the distance protects the backline.",
        [
          ["Tanks", "Stay together in front."],
          ["Ranged & healers", "Use the northern spread, beyond 15 yards."],
          ["Melee", "Remain behind, outside the frontal."],
        ],
        "Letting one tank drift out of the cleave share.",
        10000,
        ["cleave", "stomp"],
      ),
      scene(
        "cleave",
        "Malevolent Cleave",
        "Three tanks make the frontal survivable.",
        "Cleave does not reset the swing timer, so the tank stack needs continuous heavy healing as well as correct splitting.",
        "Three tanks stay stacked; healers keep the stack covered.",
        "This is a formation and healing requirement through the entire encounter.",
        [
          ["Tanks", "Do not rotate apart."],
          ["Healers", "Prioritize the stacked tanks."],
        ],
        "Sending only one tank into the frontal.",
        10000,
        ["cleave"],
      ),
      scene(
        "mark",
        "Mark of Kaz'rogal",
        "Use mana resources before the drain becomes lethal.",
        "Mark cadence accelerates as the fight continues, so this is deliberately not a live timer. Each mana user must have more than 3000 mana for the five 600-mana drains.",
        "Use planned mana tools early; if you cannot survive, move away from others.",
        "A failed drain explodes near other players, turning personal mana failure into raid damage.",
        [
          [
            "Mana users",
            "Potion, rune, or class resource before the danger point.",
          ],
          [
            "Mages & paladins",
            "Ice Block or Divine Shield can negate one Mark.",
          ],
          ["Raid", "Keep spacing for an emergency separation."],
        ],
        "Waiting until out of mana to begin a recovery plan.",
        10000,
        ["mark"],
      ),
      scene(
        "stomp",
        "War Stomp",
        "Hold the conservative 15-yard radius.",
        "The guild diagram says 12 yards; current guide data reports 15. This briefing uses 15 as the safe boundary.",
        "Backline stays beyond 15 yards; melee use prevention before a future Stomp if assigned.",
        "A conservative radius keeps both raid players and healers available.",
        [
          ["Ranged", "Remain beyond 15 yards."],
          [
            "Melee",
            "Use Free Action Potion before an expected Stomp; it does not remove an existing stun.",
          ],
        ],
        "Using the 12-yard sketch as a guaranteed safe edge.",
        10000,
        ["stomp"],
      ),
      scene(
        "finish",
        "Finish",
        "Burn without spending the last mana unsafely.",
        "The increasing Mark pressure is the soft enrage. Finish while keeping tank stack and mana decisions intact.",
        "Burn, but do not let mana fall below the Mark requirement.",
        "The final Mark is still a raid mechanic.",
        [["Raid", "Keep positions and consume remaining mana tools."]],
        "Ignoring mana because the boss is almost dead.",
        10000,
        ["mark", "cleave"],
      ),
      waves("Horde"),
    ],
    [
      "Three tanks share Malevolent Cleave.",
      "Use a 15-yard War Stomp safety radius.",
      "Mark timing accelerates; manage mana by state, not a simulated clock.",
    ],
  );
  const azgalor = base(
    "hyjal-azgalor",
    "azgalor",
    "Azgalor",
    "maps/azgalor-icon.png",
    "maps/tactics/hyjal-horde-map.jpg",
    [
      {
        name: "Guild formation — Azgalor",
        path: "maps/tactics/hyjal-source-azgalor.png",
      },
    ],
    {
      ready: "Prepare",
      positioning: "Pull · range ring",
      doom: "Doom · 20 seconds",
      rain: "Rain of Fire",
      howl: "Howl",
      finish: "Finish",
      waves: "Wave reference",
    },
    [
      ability(
        "doom",
        "Doom",
        "A marked target dies after 20 seconds and creates a Doomguard with War Stomp.",
        "Soulstone the marker before death and move the Doomguard to the off-tank away from melee.",
      ),
      ability(
        "rain",
        "Rain of Fire",
        "Rain of Fire affects a 15-yard area for 10 seconds, and Azgalor only targets it within 30 yards; touching it applies a persistent Fire damage-over-time effect.",
        "Move immediately; maximize range where your class allows.",
      ),
      ability(
        "howl",
        "Howl of Azgalor",
        "A five-second silence pressures tank healing and raid recovery.",
        "Keep HoTs rolling on the tank throughout the fight; refresh them before Howl silences healers.",
      ),
    ],
    [
      scene(
        "overview",
        "The plan",
        "Range avoids Rain; Doom creates a controlled add.",
        "Azgalor combines survivability tank healing with range positioning and a timed Doom death/add sequence.",
        "Max range where possible. Soulstone Doom. Keep the add away.",
        "Avoiding Rain prevents persistent damage from colliding with Silence.",
        [
          [
            "Tanks & healers",
            "Keep HoTs rolling on the tank at all times; refresh before every Howl.",
          ],
          ["Ranged", "Stay at maximum practical range."],
          ["Off-tank", "Reserve a Doomguard lane away from melee."],
        ],
        "Treating the Doom death as an uncontrolled raid casualty.",
        10000,
        ["doom", "rain"],
      ),
      scene(
        "positioning",
        "Pull & range ring",
        "Melee behind; ranged outside Rain range when possible.",
        "Set Azgalor near Thrall, facing southeast with melee behind to the northwest. Ranged and healers use the northern side of the 30-yard boundary. The Doomguard lane is at the northern Tauren tents, clear of the ranged line. Shadow Priests use a closer position.",
        "Lust once positioned. Keep the Doomguard lane clear.",
        "The ring removes most avoidable raid damage without promising every specialization can outrange Rain.",
        [
          ["Ranged", "Max range if your spells allow."],
          [
            "Shadow Priests",
            "Use a safer closer slot; do not assume full Rain range.",
          ],
          ["Melee", "Stay behind; leave immediately if Rain lands."],
        ],
        "Promising every ranged player can stand outside 30 yards.",
        10000,
        ["rain"],
      ),
      scene(
        "doom",
        "Doom",
        "20 seconds: Soulstone, die safely, then control the Doomguard.",
        "This scene uses the real 20-second Doom window: the marked player receives a Soulstone and dies at the northern Tauren tents. The off-tank picks up the Doomguard at that lane, away from melee.",
        "Soulstone marker. Die at the northern tents; off-tank picks up there.",
        "The Doomguard has War Stomp, so its location is part of the mechanic.",
        [
          [
            "Doom target",
            "Move to the northern Tauren tents and accept the Soulstone.",
          ],
          ["Off-tank", "Pick up and isolate the Doomguard at the tents."],
          ["Raid", "Do not stack on the marker or Doomguard."],
        ],
        "Dragging the Doomguard through melee.",
        26000,
        ["doom"],
      ),
      scene(
        "rain",
        "Rain of Fire",
        "Move before the persistent burn stacks.",
        "Rain is only cast within 30 yards, but the Fire damage-over-time persists after leaving it. Avoid contact rather than trying to heal through a late exit.",
        "Leave at first contact; re-form at a safe range.",
        "The persistent burn causes wipes after players think they are safe.",
        [
          ["Everyone", "Move immediately."],
          ["Tank", "Reposition if Rain removes the melee area."],
          [
            "Healers",
            "Recover the persistent burn without losing tank coverage.",
          ],
        ],
        "Stepping out late because the visual ground effect ended.",
        10000,
        ["rain"],
      ),
      scene(
        "howl",
        "Howl",
        "Keep tank HoTs rolling before every silence.",
        "Keep healing-over-time effects (HoTs) active on the tank throughout the fight and refresh them before Howl, so healing continues through its five-second silence. Howl can be resisted with Shadow Resistance; use the guild-assigned resistance setup.",
        "Keep tank HoTs active at all times. Refresh before Howl; resume direct healing when silence ends.",
        "Silence plus Rain damage is the dangerous overlap.",
        [
          ["Healers", "Maintain tank HoTs throughout the fight; refresh before silence and resume direct heals afterward."],
          ["Raid", "Health potions are valuable safety resources."],
        ],
        "Saving all personal healing for damage instead of Rain recovery.",
        10000,
        ["howl"],
      ),
      scene(
        "finish",
        "Finish",
        "Keep Doom and Rain jobs until death.",
        "The fight does not become safe at low health: a final Doomguard or Rain still needs its assigned response.",
        "Keep range, the Doom lane, and tank HoTs rolling through the kill.",
        "The kill call does not cancel a pending Doom.",
        [["Raid", "Finish without collapsing into the Doomguard lane."]],
        "Stacking for damage near a Doom marker.",
        10000,
        ["doom", "rain"],
      ),
      waves("Horde"),
    ],
    [
      "Doom is a real 20-second sequence: Soulstone, northern-tents death, remote Doomguard.",
      "Rain leaves a damage-over-time effect after contact.",
      "Maximum range is role-dependent; Shadow Priests need a closer safe slot.",
    ],
  );
  const archimonde = base(
    "hyjal-archimonde",
    "archimonde",
    "Archimonde",
    "maps/archimonde-icon.png",
    "maps/tactics/hyjal-summit-map.jpg",
    [
      {
        name: "Guild formation — Archimonde",
        path: "maps/tactics/hyjal-source-archimonde.png",
      },
      {
        name: "Guild tooltip — Tears of the Goddess",
        path: "maps/tactics/hyjal-source-tears.png",
      },
      {
        name: "Guild Soul Charge references",
        path: "maps/tactics/hyjal-source-soul-charge.png",
      },
    ],
    {
      ready: "Prepare",
      tears: "Tears required",
      positioning: "Pull · party stacks",
      airburst: "Air Burst",
      doomfire: "Doomfire",
      fear: "Fear",
      curse: "Grip · decurse",
      soulcharge: "Soul Charge",
      finish: "10% · victory",
      waves: "Wave reference",
    },
    [
      ability(
        "tears",
        "Tears of the Goddess",
        "A Tyrande item briefly slows falling speed and is required to survive Air Burst.",
        "Every player picks it up before pull and uses it just before landing.",
      ),
      ability(
        "airburst",
        "Air Burst",
        "Launches a player and nearby players into the air.",
        "Use Tears immediately before landing; a close party can launch together.",
      ),
      ability(
        "doomfire",
        "Doomfire Strike",
        "Moving fire leaves a dangerous trail and applies a 45-second Fire damage-over-time effect on contact.",
        "The threatened party steps sideways early; do not cross the burning trail.",
      ),
      ability(
        "fear",
        "Fear",
        "A raid-wide eight-second fear can send players into Doomfire.",
        "Use fear protection and be ready to remove it.",
      ),
      ability(
        "curse",
        "Grip of the Legion",
        "A curse deals 2500 Shadow damage every 2 seconds.",
        "Decurse is the first priority.",
      ),
      ability(
        "soulcharge",
        "Soul Charge",
        "A death causes raid-wide damage and a class-group-specific additional effect.",
        "Prevent deaths; recover and call the class effect if one occurs.",
      ),
    ],
    [
      scene(
        "overview",
        "The plan",
        "Tears, party stacks, decurse, no deaths.",
        "Archimonde uses the exact saved Positioning-tab party stacks. Each party keeps Tremor support; decurse reaches raid-wide and happens immediately. Every death triggers Soul Charge.",
        "Pick up Tears. Hold party stacks. Decurse first.",
        "The entire raid survives by preserving movement space and preventing cascading deaths.",
        [
          ["Everyone", "Pick up Tears of the Goddess before pull."],
          [
            "Groups",
            "Use the saved Positioning-tab parties; each party has Tremor support.",
          ],
          ["Healers", "Focus tank healing while preserving raid recovery."],
        ],
        "Starting without Tears or changing saved party assignments.",
        10000,
        ["tears", "curse"],
      ),
      scene(
        "tears",
        "Tears required",
        "Every player confirms the fall-slow item.",
        "Tyrande supplies Tears of the Goddess. It slows falling briefly, so use it just before landing after Air Burst; it is not a pre-pull cosmetic item.",
        "Confirm Tears before pull. Use it just before landing.",
        "Tears are the assigned default; a player without them needs another valid fall-slow response.",
        [["Everyone", "Verify the item and keybind it."]],
        "Using Tears at launch instead of before landing.",
        10000,
        ["tears"],
      ),
      scene(
        "positioning",
        "Pull & party stacks",
        "Use the saved Positioning-tab party stacks.",
        "Misdirect to the tank west of Archimonde. Use the exact Positioning-tab parties and saved adjustments: each party stacks for Tremor support. Decursers have raid-wide reach, so Grip is removed immediately rather than assigned per party.",
        "Lust once positioned. Decurse immediately.",
        "Party stacks retain Tremor support while preserving clear movement lanes.",
        [
          ["Tank", "Reposition only if Doomfire threatens tank and melee space."],
          ["Parties", "Hold your saved stack and Tremor coverage."],
        ],
        "Replacing saved party stacks with ad-hoc loose camps.",
        10000,
        ["airburst", "curse"],
      ),
      scene(
        "airburst",
        "Air Burst",
        "Use Tears just before you land.",
        "Air Burst can launch a target and their close party. This demonstration shows a party stack caught together.",
        "Airborne: use Tears immediately before landing; the party resets together.",
        "Tears converts the fall into a survivable landing.",
        [
          ["Air Burst target", "Use Tears before landing."],
          ["Party", "Use Tears if launched, then return to the saved stack."],
        ],
        "Waiting until after landing to use Tears.",
        10000,
        ["airburst", "tears"],
      ),
      scene(
        "doomfire",
        "Doomfire",
        "The threatened party steps sideways together.",
        "Doomfire curves toward one party and leaves a burning trail. That party sidesteps together before contact; the trail remains unsafe.",
        "Party sideways early. Do not cross the trail.",
        "A fear or Air Burst becomes lethal when no clean lane remains.",
        [
          ["Tank", "Reposition only if fire threatens tank and melee space."],
          ["Party", "Use an open side lane; never shortcut through fire."],
        ],
        "Walking through the trail after the moving head passes.",
        10000,
        ["doomfire"],
      ),
      scene(
        "fear",
        "Fear",
        "Prevent or break fear before Doomfire catches you.",
        "The eight-second raid fear is dangerous chiefly because it can carry players into Doomfire.",
        "Use assigned fear protection; remove it quickly and recheck your path.",
        "Fear is a movement mechanic when fire is active.",
        [
          ["Raid", "Use assigned fear tools."],
          ["Healers", "Recover anyone who entered Doomfire."],
        ],
        "Treating fear as harmless raid-wide crowd control.",
        10000,
        ["fear", "doomfire"],
      ),
      scene(
        "curse",
        "Grip of the Legion",
        "Decurse is the first priority.",
        "Grip deals recurring Shadow damage until removed. Decursers have raid-wide reach, so the first available decurser removes it immediately.",
        "Call Grip and decurse immediately; backup covers failures.",
        "Delayed decurses create preventable healing pressure and deaths.",
        [
          ["Decursers", "Act immediately."],
          ["Raid", "Keep immediate raid-wide decurse reach."],
        ],
        "Finishing a damage cast before decursing.",
        10000,
        ["curse"],
      ),
      scene(
        "soulcharge",
        "Soul Charge",
        "One death damages everyone and adds a class-specific penalty.",
        "Soul Charge deals 4500 raid damage, then differs by the fallen class group: Priest/Mage/Warlock causes a 6-second silence; Warrior/Rogue/Paladin increases damage taken by 50%; Druid/Shaman/Hunter deals 4500 Nature damage over 8 seconds and drains 2250 raid mana. The response begins by preventing the death.",
        "Prevent deaths. If one occurs, call the class effect and stabilize spread groups.",
        "Deaths can cascade because the raid-wide hit combines with a different recovery problem.",
        [
          ["Raid", "Use personal survival tools before dying."],
          ["Healers", "Stabilize the raid after the 4500 hit."],
          ["Lead", "Call the fallen class group’s follow-up effect."],
        ],
        "Treating a death as only a lost player.",
        10000,
        ["soulcharge"],
      ),
      scene(
        "finish",
        "10% victory",
        "At 10%, protect the Wisp phase.",
        "Keep normal mechanics covered until 10%; Protection of Elune then protects the raid while the Wisps finish Archimonde.",
        "Keep Tears, decurse, and movement discipline until the 10% victory.",
        "The finish rewards survival, not a collapse for damage.",
        [
          [
            "Raid",
            "Survive to 10%, then let the protected Wisp ending finish.",
          ],
        ],
        "Stopping to celebrate before the encounter ends.",
        10000,
        [],
      ),
      scene(
        "waves",
        "Optional pre-pull note",
        "No trash-wave event at the summit.",
        "Archimonde has no preceding camp-wave table in the guild sheet. This optional note preserves the pre-pull requirement: confirm Tears and group assignments.",
        "Confirm Tears, saved party stacks, Tremor support, decursers, and movement lanes before pull.",
        "The summit briefing starts with Archimonde preparation, not a trash simulation.",
        [["Raid lead", "Confirm pre-pull assignments."]],
        "Treating this as an encounter wave timer.",
        10000,
        [],
      ),
    ],
    [
      "Every player must collect Tears before pull.",
      "Default Air Burst plan covers normal raid targets; the PTR tank-only note is not the default.",
      "Decurse first; prevent deaths to avoid Soul Charge cascades.",
    ],
  );
  winter.trashWaves = [
    "10 Ghouls",
    "10 Ghouls, 2 Crypt Fiends",
    "6 Ghouls, 6 Crypt Fiends",
    "6 Ghouls, 4 Crypt Fiends, 2 Shadowy Necromancers",
    "2 Ghouls, 6 Crypt Fiends, 4 Shadowy Necromancers",
    "6 Ghouls, 6 Abominations",
    "4 Ghouls, 4 Shadowy Necromancers, 4 Abominations",
    "6 Ghouls, 4 Crypt Fiends, 2 Abominations, 2 Shadowy Necromancers",
  ];
  anetheron.trashWaves = [
    "10 Ghouls",
    "8 Ghouls, 4 Abominations",
    "4 Ghouls, 4 Crypt Fiends, 4 Shadowy Necromancers",
    "6 Crypt Fiends, 2 Banshees, 4 Shadowy Necromancers",
    "6 Ghouls, 4 Banshees, 2 Shadowy Necromancers",
    "6 Ghouls, 2 Abominations, 4 Shadowy Necromancers",
    "2 Ghouls, 4 Crypt Fiends, 4 Banshees, 4 Abominations",
    "3 Ghouls, 3 Crypt Fiends, 2 Banshees, 2 Shadowy Necromancers, 4 Abominations",
  ];
  kazrogal.trashWaves = [
    "4 Ghouls, 2 Banshees, 4 Abominations, 2 Shadowy Necromancers",
    "4 Ghouls, 10 Gargoyles",
    "6 Ghouls, 6 Crypt Fiends, 2 Shadowy Necromancers",
    "6 Crypt Fiends, 6 Gargoyles, 2 Shadowy Necromancers",
    "4 Ghouls, 4 Abominations, 4 Shadowy Necromancers",
    "8 Gargoyles, 1 Frostwyrm",
    "6 Ghouls, 4 Abominations, 1 Frostwyrm",
    "6 Ghouls, 2 Crypt Fiends, 2 Banshees, 2 Shadowy Necromancers, 4 Abominations",
  ];
  azgalor.trashWaves = [
    "6 Abominations, 6 Shadowy Necromancers",
    "5 Ghouls, 8 Gargoyles, 1 Frostwyrm",
    "6 Ghouls, 8 Infernals",
    "8 Infernals, 6 Fel Hounds",
    "6 Felstalkers, 4 Abominations, 4 Shadowy Necromancers",
    "6 Banshees, 6 Shadowy Necromancers",
    "2 Ghouls, 2 Crypt Fiends, 2 Felstalkers, 8 Infernals",
    "4 Crypt Fiends, 2 Felstalkers, 4 Banshees, 2 Shadowy Necromancers, 4 Abominations",
  ];
  winter.abilities.push(
    ability(
      "armor",
      "Frost Armor",
      "Frost Armor slows melee attackers by 50% movement speed and 25% attack speed.",
      "Melee plan for the slow; use a pre-emptive Free Action Potion only when assigned.",
      guides["hyjal-winterchill"],
    ),
  );
  anetheron.abilities.push(
    ability(
      "vampiric",
      "Vampiric Aura",
      "Anetheron, and Infernals within 25 yards, heal for 300% of melee damage dealt.",
      "Maintain Mortal Strike, Aimed Shot, or Wound Poison and keep Infernals away from the boss.",
      guides["hyjal-anetheron"],
    ),
  );
  kazrogal.abilities.push(
    ability(
      "cripple",
      "Cripple",
      "A random player, pet, or NPC has movement and attack speed reduced by 75%.",
      "Use a valid removal when assigned; do not assume a normal dispel works.",
      guides["hyjal-kazrogal"],
    ),
  );
  azgalor.abilities.push(
    ability(
      "cleave",
      "Cleave",
      "A frontal weapon hit adds 1700 damage and knocks targets back.",
      "Only the boss tank stands in front; melee remains behind.",
      guides["hyjal-azgalor"],
    ),
  );
  archimonde.referenceImages.push(
    {
      name: "Guild Soul Charge — increased damage taken",
      path: "maps/tactics/hyjal-source-soul-charge-yellow.png",
    },
    {
      name: "Guild Soul Charge — Nature damage over time",
      path: "maps/tactics/hyjal-source-soul-charge-green.png",
    },
  );
  winter.recapRows = [
    ["Spread", "Keep individual healer coverage and an escape lane."],
    [
      "Icebolt",
      "Assigned healers save the target without dropping tank healing.",
    ],
    [
      "Death and Decay",
      "Raid leaves the 20-yard patch; dedicated healers cover the tank holding position.",
    ],
    ["Frost Nova", "Free movement when a root blocks escape."],
  ];
  anetheron.recapRows = [
    ["Spread", "Do not let Carrion Swarm disable the healing team."],
    ["Infernal", "Target moves toward the remote off-tank, then stops short."],
    [
      "Pickup",
      "Infernals are not tauntable: establish threat away from the raid.",
    ],
    ["Sleep", "Backup coverage replaces sleeping players."],
  ];
  kazrogal.recapRows = [
    ["Cleave", "Three pixel-stacked tanks share every frontal hit."],
    ["Mark", "Mana users stay above 3000 before the drain."],
    ["Explosion", "If you cannot survive Mark, leave other players."],
    ["Stomp", "Ranged and healers stay beyond 15 yards."],
  ];
  azgalor.recapRows = [
    ["Range", "Use maximum practical range to avoid Rain of Fire."],
    ["Rain", "Leave immediately: contact leaves a persistent burn."],
    ["Doom", "Soulstone the marker, then isolate the Doomguard."],
    ["Howl", "Keep tank HoTs active at all times; refresh before the five-second silence."],
  ];
  archimonde.recapRows = [
    ["Tears", "Every player picks up Tears and uses them before landing."],
    ["Parties", "Hold the saved Positioning-tab stacks for Tremor support."],
    ["Decurse", "Grip is raid-wide: the first decurser acts immediately."],
    ["Doomfire", "The threatened party sidesteps; the trail keeps burning."],
    ["Deaths", "Prevent Soul Charge cascades with personal survival."],
  ];
  // Map anchors follow the guild drawings: ballista, Thrall clearing, summit.
  winter.bossAt = { x: 0.555, y: 0.395 };
  anetheron.bossAt = { x: 0.563, y: 0.4 };
  anetheron.arena.y0 = 0;
  kazrogal.bossAt = { x: 0.525, y: 0.67 };
  azgalor.bossAt = { x: 0.527, y: 0.63 };
  Object.assign(archimonde, ARCH.ENCOUNTER);
  archimonde.arena = {x0: 0, x1: 1, y0: 0, y1: 1};
  azgalor.arena.y0 = 0;
  winter.roster = { tanks: 1, melee: 7, healers: 6, ranged: 11 };
  anetheron.roster = { tanks: 2, melee: 7, healers: 6, ranged: 10 };
  azgalor.roster = { tanks: 2, melee: 7, healers: 6, ranged: 10 };
  archimonde.roster = { tanks: 1, melee: 7, healers: 6, ranged: 11 };
  anetheron.recapRows.push([
    "Healing reduction",
    "Maintain Wound Poison, Mortal Strike, or Aimed Shot to counter Vampiric Aura.",
  ]);
  anetheron.scenes
    .find((s) => s.id === "overview")
    .jobs.push([
      "Assigned damage",
      "Keep the healing-reduction debuff on Anetheron.",
    ]);
  anetheron.scenes.find((s) => s.id === "finish").call =
    "Keep the healing-reduction debuff active and retain the isolated Infernal lane through the kill.";
  const swarm = anetheron.abilities.find((a) => a.id === "swarm");
  swarm.tooltip.description =
    "A cone aimed at a random player damages everyone hit and reduces their healing done by 75%. The guild sheet lists 15 seconds; Classic references list 20. Keep unaffected tank-healing coverage until the debuff actually clears.";
  const rain = azgalor.abilities.find((a) => a.id === "rain");
  rain.tooltip.description =
    "Rain targets a location within 30 yards of Azgalor and covers a 15-yard patch. Rain deals about 1700 Fire damage every 2 seconds for 10 seconds. Contact also applies a Fire DoT that persists after leaving the ground effect.";
  azgalor.abilities.find((a) => a.name === "Cleave").doThis =
    "Only the boss tank stands in front. The Doomguard tank remains in the remote add lane.";
  const ending = archimonde.scenes.find((s) => s.id === "finish");
  ending.caption =
    "Keep ordinary mechanics covered until 10%. Protection of Elune then protects the raid while the Wisps finish Archimonde.";
  ending.call =
    "Survive to 10%. During the protected Wisp ending, let the encounter finish.";
  ending.briefing = [
    {
      id: "plan",
      title: "Survive to 10%, then let the Wisps finish.",
      detail: ending.call,
    },
  ];
  archimonde.stateLabels.wisps = "10% · protected Wisp ending";
  archimonde.referenceImages.forEach((item) => {
    if (!archimonde.sources.some((source) => source.url === item.path))
      archimonde.sources.push({ name: item.name, url: item.path });
  });
  return {
    FIGHTS: {
      "hyjal-winterchill": winter,
      "hyjal-anetheron": anetheron,
      "hyjal-kazrogal": kazrogal,
      "hyjal-azgalor": azgalor,
      "hyjal-archimonde": archimonde,
    },
  };
});
