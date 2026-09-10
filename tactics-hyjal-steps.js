(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TacticsHyjalSteps = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const step = (id, title, detail, startMs, holdAtMs, options = {}) => ({
    id,
    title,
    detail,
    startMs,
    holdAtMs,
    optional: !!options.optional,
    countdownSeconds: options.countdownSeconds || 0,
    loop: options.loop || "hold",
  });
  const beats = (duration, rows) =>
    rows.map((row, index) =>
      step(
        row[1],
        row[2],
        row[3],
        row[0],
        index + 1 < rows.length ? rows[index + 1][0] - 1 : duration,
        row[4] || {},
      ),
    );
  const staticStep = (title, detail) => [step("plan", title, detail, 0, 0)];
  const common = (camp) =>
    staticStep(
      "Optional wave reference.",
      `Use the guild sheet’s ${camp} wave list for assignments, interrupts, crowd control, and recovery; this briefing does not simulate trash.`,
    );
  return {
    "hyjal-winterchill": {
      overview: staticStep(
        "Spread, save Icebolt, leave Death and Decay.",
        "Keep distributed Icebolt coverage while preserving tank healing.",
      ),
      positioning: staticStep(
        "Pull to the ballista and spread.",
        "Face Winterchill northeast at the ballista. Melee stays southwest; healers and ranged spread all around him.",
      ),
      icebolt: beats(10000, [
        [
          0,
          "target",
          "Icebolt hits and freezes a player.",
          "The target takes immediate Frost damage and starts taking the dangerous Icebolt tick.",
        ],
        [
          800,
          "trinket",
          "Use the PvP trinket immediately.",
          "It removes the Icebolt stun and ticking damage; healers still recover the initial hit.",
        ],
        [
          1800,
          "top-off",
          "Assigned healers top off the target.",
          "Tank healers retain their assignment after the trinket breaks Icebolt.",
        ],
        [
          6500,
          "recover",
          "The target recovers.",
          "Return to spread positions.",
        ],
      ]),
      dnd: beats(10000, [
        [
          0,
          "appears",
          "Death and Decay appears.",
          "Treat the 20-yard ground area as immediately unsafe.",
        ],
        [
          1800,
          "move",
          "Raid leaves the ground effect.",
          "Move first; heal while moving.",
        ],
        [
          6000,
          "reset",
          "Raid is clear; tank healing stays assigned.",
          "The tank holds at the ballista with dedicated heals. Melee waits outside the patch.",
        ],
      ]),
      nova: beats(10000, [
        [
          0,
          "root",
          "Frost Nova roots nearby players.",
          "Call the players whose movement is blocked.",
        ],
        [
          2500,
          "free",
          "Remove the root where escape needs it.",
          "Free Action prevents a future effect; it does not clear this root.",
        ],
        [
          6500,
          "ready",
          "Movement is available again.",
          "Keep watching for Death and Decay.",
        ],
      ]),
      finish: beats(10000, [
        [
          0,
          "plan",
          "Keep the spread through the kill.",
          "Icebolt saves and Death and Decay movement continue until combat ends.",
        ],
        [
          10000,
          "complete",
          "Encounter complete.",
          "No active combat jobs remain.",
        ],
      ]),
      waves: common("Alliance"),
    },
    "hyjal-anetheron": {
      overview: staticStep(
        "Spread healers; isolate every Infernal.",
        "Carrion Swarm, Sleep, and remote Infernal pickup each have backup coverage.",
      ),
      positioning: staticStep(
        "Keep healers off rear melee lanes.",
        "Two tank healers stand diametrically opposite. Other healers use lanes away from dense rear melee.",
      ),
      swarm: beats(10000, [
        [
          0,
          "cone",
          "Carrion Swarm sweeps through the melee cluster.",
          "This melee-targeted example misses healers; the random mechanic can target anyone.",
        ],
        [
          2200,
          "backup",
          "Backup healers cover the boss tank.",
          "Opposite tank healers keep coverage if a later Swarm targets healers.",
        ],
        [6500, "recover", "The local group is stable.", "Maintain the spread."],
      ]),
      infernal: beats(10000, [
        [
          0,
          "target",
          "Inferno selects a player.",
          "They head toward the remote off-tank.",
        ],
        [
          3000,
          "landing",
          "The target stops short of the off-tank.",
          "The landing stun and fire pulse stay out of the pickup position.",
        ],
        [
          5000,
          "pickup",
          "Off-tank establishes threat.",
          "Infernals are not tauntable; use ranged threat and isolate them.",
        ],
      ]),
      sleep: beats(10000, [
        [
          0,
          "sleep",
          "Several players fall asleep.",
          "Sleep cannot be dispelled.",
        ],
        [
          1800,
          "backup",
          "Backup healers take missing assignments.",
          "Do not deliberately wake sleepers with Infernal damage.",
        ],
        [
          10000,
          "return",
          "Sleepers return when the effect ends or damage wakes them.",
          "Re-establish normal coverage.",
        ],
      ]),
      finish: beats(10000, [
        [
          0,
          "plan",
          "Maintain the add lane through the kill.",
          "A late Infernal still stays away from the raid.",
        ],
        [
          10000,
          "complete",
          "Encounter complete.",
          "No active combat jobs remain.",
        ],
      ]),
      waves: common("Alliance"),
    },
    "hyjal-kazrogal": {
      overview: staticStep(
        "Three tanks share Cleave; mana survives Mark.",
        "Manage mana before each accelerating Mark instead of following a fixed timer.",
      ),
      positioning: staticStep(
        "Set the three-tank stack.",
        "Ranged and healers remain beyond the safe 15-yard Stomp radius; Thrall stays behind the boss.",
      ),
      cleave: beats(10000, [
        [
          0,
          "stack",
          "Three tanks share Malevolent Cleave.",
          "The tanks remain pixel-stacked in front.",
        ],
        [
          4000,
          "heal",
          "Heavy tank healing continues.",
          "Cleave does not reset the swing timer.",
        ],
        [7500, "hold", "The tank formation holds.", "No tank rotates away."],
      ]),
      mark: beats(10000, [
        [
          0,
          "prepare",
          "Danger example: only 2800 mana remains.",
          "Mark needs five 600-mana drains. Restore mana early; this example shows the fallback if that is impossible.",
        ],
        [
          1500,
          "isolate",
          "Leave before the final mana drain fails.",
          "Move beyond 15 yards of every ally while the mark still drains.",
        ],
        [
          2500,
          "drain",
          "The mark keeps draining during the exit.",
          "Continue to the clear space; do not run through another group.",
        ],
        [
          6000,
          "detonate",
          "The final drain fails: the isolated player detonates.",
          "The explosion stays away from the raid. Prevent this with early mana recovery whenever possible.",
        ],
      ]),
      stomp: beats(10000, [
        [
          0,
          "radius",
          "The 15-yard safety boundary is active.",
          "The guild sketch says 12; this briefing uses the safer current 15-yard value.",
        ],
        [
          3500,
          "stomp",
          "War Stomp hits the close range.",
          "Ranged remains clear; prevention only works before the stun.",
        ],
        [
          7000,
          "resume",
          "The backline remains available.",
          "Continue tank coverage.",
        ],
      ]),
      finish: beats(10000, [
        [
          0,
          "plan",
          "Burn without spending the last mana unsafely.",
          "Keep the cleave stack and Mark plan until Kaz’rogal dies.",
        ],
        [
          10000,
          "complete",
          "Encounter complete.",
          "No active combat jobs remain.",
        ],
      ]),
      waves: common("Horde"),
    },
    "hyjal-azgalor": {
      overview: staticStep(
        "Range avoids Rain; Doom creates a controlled add.",
        "Keep tank HoTs active throughout the fight; use the Doom lane and maximum practical range.",
      ),
      positioning: staticStep(
        "Set the ranged ring and Doomguard lane.",
        "Most ranged stay beyond Rain range; Shadow Priests use their safe closer slot.",
      ),
      doom: beats(26000, [
        [
          0,
          "marked",
          "Doom marks a player.",
          "Apply the assigned Soulstone and move to the northern Tauren tents.",
        ],
        [
          19000,
          "final-seconds",
          "Doom is nearly due.",
          "Keep everyone clear of the marker.",
        ],
        [
          20000,
          "death",
          "Doom kills the marked player and summons a Doomguard.",
          "The Doomguard drops at the northern Tauren tents; resurrect only after pickup is secure.",
        ],
        [
          22000,
          "pickup",
          "Off-tank takes the Doomguard remote.",
          "Pick up at the northern tents and keep its War Stomp away from melee.",
        ],
      ]),
      rain: beats(10000, [
        [
          0,
          "rain",
          "Rain of Fire lands near the group.",
          "Contact applies a persistent burn.",
        ],
        [
          1600,
          "leave",
          "Players move before damage stacks.",
          "Do not wait for the visual to finish.",
        ],
        [
          6500,
          "recover",
          "The raid is clear of the rain.",
          "Heal the lingering burn and reset range.",
        ],
      ]),
      howl: beats(10000, [
        [
          0,
          "howl",
          "Tank HoTs must be rolling before Howl.",
          "Maintain tank HoTs at all times and refresh before the five-second silence; they keep healing while you cannot cast.",
        ],
        [
          5000,
          "ends",
          "The five-second silence ends.",
          "Resume direct tank healing and refresh HoTs for the next Howl, especially after Rain.",
        ],
      ]),
      finish: beats(10000, [
        [
          0,
          "plan",
          "Keep Doom and Rain jobs until death.",
          "Do not collapse into the Doomguard lane at low health.",
        ],
        [
          10000,
          "complete",
          "Encounter complete.",
          "No active combat jobs remain.",
        ],
      ]),
      waves: common("Horde"),
    },
    "hyjal-archimonde": {
      overview: staticStep(
        "Tears, party stacks, decurse, no deaths.",
        "Every player takes Tears; saved parties stack for Tremor, while decurse reaches the raid immediately.",
      ),
      tears: beats(10000, [
        [
          0,
          "confirm",
          "Every player confirms Tears of the Goddess.",
          "It is required before the pull.",
        ],
        [
          4000,
          "landing",
          "Practice the use point: just before landing.",
          "Using it at launch wastes its brief fall-slow window.",
        ],
      ]),
      positioning: staticStep(
        "Use the saved Positioning-tab party stacks.",
        "Tank west. Each saved party holds its Tremor stack; Grip has raid-wide immediate decurse reach.",
      ),
      airburst: beats(10000, [
        [
          0,
          "launch",
          "Air Burst launches a target.",
          "A close party can launch together.",
        ],
        [
          4500,
          "tears",
          "Use Tears immediately before landing.",
          "The target lands safely.",
        ],
        [
          7500,
          "reset",
          "Group resumes its space.",
          "Return to the saved party stack and keep a clear Doomfire lane.",
        ],
      ]),
      doomfire: beats(10000, [
        [
          0,
          "spawns",
          "Doomfire approaches the group.",
          "It curves toward one party and leaves a burning trail.",
        ],
        [
          1800,
          "move",
          "Move early along an open lane.",
          "That party steps sideways together; never cross the trail.",
        ],
        [
          6500,
          "reset",
          "The group preserves its movement space.",
          "The tank moves only if fire threatens tank and melee space; the trail still burns.",
        ],
      ]),
      fear: beats(10000, [
        [
          0,
          "fire-nearby",
          "Doomfire lands nearby.",
          "Leave the small fire patch while you still control your character.",
        ],
        [
          1400,
          "move-clear",
          "Move clear before Fear begins.",
          "Hold the clear ground you created; do not wait for the fear response.",
        ],
        [
          2000,
          "fear",
          "Raid-wide Fear begins.",
          "The player is already away from Doomfire; Tremor or another assigned response restores control.",
        ],
        [
          3500,
          "break",
          "Covered groups regain control.",
          "Groups without nearby Tremor retain their own fear plan.",
        ],
        [10000, "ready", "Fear recovery is complete.", "Stay out of Doomfire."],
      ]),
      curse: beats(10000, [
        [0, "grip", "Grip of the Legion lands.", "Call the curse immediately."],
        [
          1000,
          "decurse",
          "Decurser removes Grip.",
          "This has priority over damage casts.",
        ],
        [
          6000,
          "backup",
          "Backup decurser confirms coverage.",
          "Decurse has raid-wide reach; keep it immediate.",
        ],
      ]),
      soulcharge: beats(10000, [
        [
          0,
          "death",
          "A player dies: Soul Charge hits the raid.",
          "Everyone takes the initial 4500 damage.",
        ],
        [
          2500,
          "class-effect",
          "The fallen class group adds its unique effect.",
          "Call the 6-second silence for Priest/Mage/Warlock, 50% increased damage taken for Warrior/Rogue/Paladin, or 4500 Nature damage over 8 seconds plus a 2250 raid mana drain for Druid/Shaman/Hunter.",
        ],
        [
          7000,
          "stabilize",
          "Raid stabilizes without another death.",
          "Preventing the first death remains the real solution.",
        ],
      ]),
      finish: beats(10000, [
        [
          0,
          "plan",
          "Survive to ten percent.",
          "Keep normal movement and survival jobs until Protection of Elune begins.",
        ],
        [
          3000,
          "wisps",
          "Protection of Elune: let the Wisps finish.",
          "The protected raid waits while the Wisps defeat Archimonde.",
        ],
        [
          10000,
          "complete",
          "Archimonde is defeated.",
          "The World Tree is safe.",
        ],
      ]),
      waves: staticStep(
        "Before Archimonde: confirm the raid is ready.",
        "There are no eight trash waves here. Collect Tears and confirm saved party stacks, Tremor, decurse, fear support, and movement lanes.",
      ),
    },
  };
});
