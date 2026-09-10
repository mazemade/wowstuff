"use strict";
const assert = require("node:assert/strict");
const Data = require("./tactics-data.js");
const Layout = require("./tactics-layout.js");
const Hyjal = require("./tactics-hyjal.js");
const ids = [
  "hyjal-winterchill",
  "hyjal-anetheron",
  "hyjal-kazrogal",
  "hyjal-azgalor",
  "hyjal-archimonde",
];
const roster = {
  tanks: ["Tank 1", "Tank 2", "Tank 3"],
  healers: ["Healer 1", "Healer 2"],
  melee: ["Melee 1", "Melee 2"],
  ranged: ["Ranged 1", "Ranged 2"],
};
const scene = (fight, id) => fight.scenes.find((s) => s.id === id);
const prep = (fight, id, r = roster) =>
  Hyjal.prepareScene(fight, scene(fight, id), Layout.assign(fight, r));
const frame = (fight, sc, t) => Hyjal.simulate(fight, sc, t);

for (const id of ids) {
  const fight = Data.FIGHTS[id];
  assert(fight, id + " is registered");
  for (const source of fight.scenes) {
    const sc = prep(fight, source.id),
      mid = Math.floor(source.duration * 0.53);
    const expected = frame(fight, sc, mid);
    frame(fight, sc, 0);
    frame(fight, sc, source.duration);
    assert.deepEqual(
      frame(fight, sc, mid),
      expected,
      id + " " + source.id + " reverse seeking is deterministic",
    );
    assert.equal(
      Object.keys(expected.pos).length,
      9,
      "only real roster actors are rendered",
    );
  }
}
const winter = Data.FIGHTS["hyjal-winterchill"];
const icebolt = prep(winter, "icebolt");
assert(frame(winter, icebolt, 500).effects.icebolt.stunned);
assert.equal(
  frame(winter, icebolt, 1000).effects.icebolt.trinketUsed,
  true,
  "Icebolt's target uses a PvP trinket to break the stun and ticking damage",
);
assert.equal(
  frame(winter, icebolt, 1000).effects.icebolt.dotActive,
  false,
  "the PvP trinket removes Icebolt's ticking damage",
);
assert(
  frame(winter, icebolt, 3000).effects.icebolt.healing,
  "Icebolt rescue uses real healing coverage",
);
const nova = prep(winter, "nova");
assert.equal(frame(winter, nova, 1700).effects.nova.dispelled, false);
assert.equal(
  frame(winter, nova, 1800).effects.nova.dispelled,
  false,
  "a healer is not fabricated as a dispeller",
);
const dispelRoster = Layout.assign(winter, roster);
dispelRoster.find((p) => p.kind === "healer").class = "PRIEST";
const novaWithDispel = Hyjal.prepareScene(
  winter,
  scene(winter, "nova"),
  dispelRoster,
);
assert.equal(frame(winter, novaWithDispel, 2500).effects.nova.dispelled, true);
assert.equal(
  frame(winter, novaWithDispel, 5000).effects.nova.removedIds.length,
  frame(winter, novaWithDispel, 5000).effects.nova.affectedIds.length,
  "Mass Dispel frees the rooted group",
);

const anetheron = Data.FIGHTS["hyjal-anetheron"],
  swarm = prep(anetheron, "swarm"),
  infernal = prep(anetheron, "infernal");
assert(frame(anetheron, swarm, 1000).effects.carrion.active);
assert.equal(
  frame(anetheron, infernal, 4000).adds[0].tauntable,
  false,
  "infernal is shown as threat pickup, not taunt",
);
assert(frame(anetheron, infernal, 4000).effects.infernal.isolated);

const kaz = Data.FIGHTS["hyjal-kazrogal"],
  cleave = prep(kaz, "cleave"),
  mark = prep(kaz, "mark");
assert.equal(frame(kaz, cleave, 2000).effects.cleave.targetIds.length, 3);
assert.equal(
  new Set(
    cleave.tanks
      .slice(0, 3)
      .map((id) => JSON.stringify(frame(kaz, cleave, 0).pos[id])),
  ).size,
  1,
  "cleave tanks physically stack",
);
assert(frame(kaz, mark, 6500).effects.mark.exploding);
assert(
  frame(kaz, mark, 6500).effects.mark.isolated,
  "OOM example exits beyond 15 yards",
);
assert.equal(
  frame(kaz, mark, 6500).effects.mark.targetId,
  mark.manaUser.id,
  "mana mechanic never chooses a rage tank",
);
assert.equal(
  frame(kaz, mark, 5000).effects.mark.mana,
  400,
  "failure example has less than 600 mana for the final tick",
);
assert.equal(
  frame(kaz, mark, 6000).effects.mark.mana,
  0,
  "the fifth attempted drain exhausts the remaining 400 mana",
);

const az = Data.FIGHTS["hyjal-azgalor"],
  rain = prep(az, "rain"),
  doom = prep(az, "doom");
assert(
  frame(az, rain, 6500).effects.rain.dotPersists,
  "Rain of Fire DoT persists after movement",
);
assert(
  frame(az, rain, 3500).effects.rain.withinBoss30,
  "Rain is demonstrated within the 30-yard cast range",
);
assert(
  Layout.dist(
    az,
    frame(az, rain, 3500).pos[rain.primaryTank],
    frame(az, rain, 3500).boss,
  ) < 15,
  "tank moves with the boss",
);
assert.equal(frame(az, doom, 20000).effects.doom.dead, true);
assert.equal(
  frame(az, doom, 20000).effects.doom.revived,
  false,
  "Doom scene does not fabricate a revive",
);
assert.equal(frame(az, doom, 20000).adds[0].id, "doomguard");

const arch = Data.FIGHTS["hyjal-archimonde"],
  air = prep(arch, "airburst"),
  fire = prep(arch, "doomfire"),
  curse = prep(arch, "curse");
assert(
  Layout.dist(
    arch,
    frame(arch, air, 0).pos[air.primaryTank],
    frame(arch, air, 0).boss,
  ) < 15,
  "Archimonde MT begins at the boss",
);
assert(frame(arch, air, 2000).effects.airburst.lofted);
assert.equal(
  frame(arch, air, 5000).effects.airburst.tearsUsed,
  true,
  "Tears scene teaches the required pre-pull item for the named target",
);
const tearsRoster = Layout.assign(arch, roster);
tearsRoster.forEach((p) => {
  p.hasTears = true;
});
const airWithTears = Hyjal.prepareScene(
  arch,
  scene(arch, "airburst"),
  tearsRoster,
);
assert(frame(arch, airWithTears, 5000).effects.airburst.tearsUsed);
assert(frame(arch, fire, 5000).effects.doomfire.trail.length >= 2);
assert.equal(
  frame(arch, fire, 5000).hazards[0].yards,
  4,
  "Doomfire uses the smaller four-yard visual and hazard radius",
);
assert.equal(frame(arch, curse, 500).effects.curse.decursed, false);
assert.equal(
  frame(arch, curse, 2500).effects.curse.decursed,
  false,
  "a healer is not fabricated as a decurser",
);
const decurseRoster = Layout.assign(arch, roster);
const restoDruid = decurseRoster.find((p) => p.kind === "healer");
restoDruid.class = "DRUID";
restoDruid.spec = "Restoration";
const curseWithDecurse = Hyjal.prepareScene(
  arch,
  scene(arch, "curse"),
  decurseRoster,
);
assert.equal(frame(arch, curseWithDecurse, 2500).effects.curse.decursed, true);
assert.equal(
  curseWithDecurse.decurser,
  restoDruid.id,
  "a Restoration Druid, rather than the tank, owns Grip decurse",
);
const guardianTankRoster = Layout.assign(arch, roster);
const guardianTank = guardianTankRoster.find((p) => p.kind === "tank");
guardianTank.class = "DRUID";
guardianTank.spec = "Guardian";
const guardianResto = guardianTankRoster.find((p) => p.kind === "healer");
guardianResto.class = "DRUID";
guardianResto.spec = "Restoration";
const curseWithGuardianTank = Hyjal.prepareScene(
  arch,
  scene(arch, "curse"),
  guardianTankRoster,
);
assert.equal(
  curseWithGuardianTank.decurser,
  guardianResto.id,
  "a Guardian main tank is never selected to decurse Grip",
);

for (const id of ids) {
  const fight = Data.FIGHTS[id],
    partial = prep(fight, "finish", { tanks: ["Only tank"] });
  const done = frame(fight, partial, partial.duration);
  assert.notEqual(
    done.stage,
    "complete",
    id + " cannot fabricate a kill from an incomplete roster",
  );
  assert(done.bossHp > 0);
  for (const source of fight.scenes) {
    const sparse = prep(fight, source.id, { tanks: ["Only tank"] });
    for (const t of [0, source.duration, -1, Infinity]) {
      const f = frame(fight, sparse, t);
      assert.equal(Object.keys(f.pos).length, 1);
      assert(
        Object.values(f.pos).every(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
      );
    }
  }
}
for (const id of ids) {
  const fight = Data.FIGHTS[id];
  for (const source of fight.scenes) {
    const sc = prep(fight, source.id, null);
    let previous;
    for (let t = 0; t <= source.duration; t += 250) {
      const f = frame(fight, sc, t);
      for (const [actor, p] of Object.entries(f.pos)) {
        assert(
          Number.isFinite(p.x) && Number.isFinite(p.y),
          id + ":" + source.id + " finite " + actor,
        );
        assert(
          p.x >= fight.arena.x0 &&
            p.x <= fight.arena.x1 &&
            p.y >= fight.arena.y0 &&
            p.y <= fight.arena.y1,
          id + ":" + source.id + " inside arena",
        );
        if (previous)
          assert(
            Layout.dist(fight, previous.pos[actor], p) <= 3.0,
            id +
              ":" +
              source.id +
              " movement does not teleport " +
              actor +
              " at " +
              t,
          );
      }
      previous = f;
    }
  }
  const finish = prep(fight, "finish", null),
    done = frame(fight, finish, 10000);
  assert.equal(
    done.stage,
    "complete",
    id + " reaches positive completion with teaching roles",
  );
  assert.equal(done.bossVisible, false);
  assert.deepEqual(done.roles, {}, id + " completion clears active jobs");
  const setup = prep(fight, "positioning", null),
    positions = frame(fight, setup, 0);
  if (id === "hyjal-archimonde") continue; // Arch geometry is owned by Positioning; exact parity is tested separately.
  assert(
    Layout.dist(fight, positions.pos[setup.primaryTank], positions.boss) < 10,
    id + " MT is in boss reach",
  );
  setup.raid
    .filter((p) => p.kind === "melee")
    .forEach((p) =>
      assert(
        Layout.dist(fight, positions.pos[p.id], positions.boss) < 12,
        id + " melee remains in boss reach",
      ),
    );
}
const frozenDemo = prep(winter, "icebolt", null);
for (const t of [0, 1000, 2500, 4999])
  assert.deepEqual(
    frame(winter, frozenDemo, t).pos[frozenDemo.target.id],
    frozenDemo.baseById[frozenDemo.target.id],
    "Icebolt victim never runs while stunned",
  );
assert.deepEqual(
  frame(winter, nova, 9999).pos,
  nova.baseById,
  "a missing dispel does not free rooted players",
);
for (const [fight, chapter] of [
  [winter, "dnd"],
  [az, "rain"],
]) {
  const sc = prep(fight, chapter, null),
    start = frame(fight, sc, 0);
  for (const t of [1000, 3000, 6000, 10000]) {
    const f = frame(fight, sc, t);
    assert(
      Math.abs(
        Layout.dist(fight, f.pos[sc.primaryTank], f.boss) -
          Layout.dist(fight, start.pos[sc.primaryTank], start.boss),
      ) < 0.001,
      "tank and boss travel together",
    );
  }
  const clear = frame(fight, sc, 6500),
    hazard = clear.hazards[0];
  sc.raid
    .filter(
      (p) =>
        p.kind === "melee" || (fight !== winter && p.id === sc.primaryTank),
    )
    .forEach((p) =>
      assert(
        Layout.dist(fight, clear.pos[p.id], hazard) > hazard.yards,
        "raid actually clears the ground effect",
      ),
    );
  if (fight === winter) {
    assert.deepEqual(
      clear.boss,
      start.boss,
      "guild Winterchill plan holds the boss",
    );
    assert.deepEqual(
      clear.pos[sc.primaryTank],
      start.pos[sc.primaryTank],
      "tank stays with assigned healing",
    );
  }
}
const infernalDemo = prep(anetheron, "infernal", null);
assert.equal(frame(anetheron, infernalDemo, 3400).adds.length, 0);
assert.equal(
  frame(anetheron, infernalDemo, 3500).adds[0].threatPickup,
  false,
  "spawn precedes tank pickup",
);
assert.equal(frame(anetheron, infernalDemo, 5000).adds[0].threatPickup, true);
assert(
  Layout.dist(
    anetheron,
    infernalDemo.bossAt,
    frame(anetheron, infernalDemo, 5000).adds[0].at,
  ) > 25,
  "Infernal is outside Vampiric Aura",
);
assert(
  frame(anetheron, infernalDemo, 5000).effects.infernal.isolated,
  "pulse is clear of every non-target raid member",
);
assert.deepEqual(
  frame(anetheron, infernalDemo, 4000).pos[infernalDemo.target.id],
  frame(anetheron, infernalDemo, 5400).pos[infernalDemo.target.id],
  "Inferno target respects the two-second landing stun",
);
for (const source of kaz.scenes) {
  const sc = prep(kaz, source.id, null),
    f = frame(kaz, sc, 4000);
  assert.equal(
    new Set(sc.tanks.slice(0, 3).map((id) => JSON.stringify(f.pos[id]))).size,
    1,
    "Kaz tank stack persists in " + source.id,
  );
}
const rainDemo = prep(az, "rain", null);
assert.equal(frame(az, rainDemo, 3000).hazards[0].yards, 15);
assert.deepEqual(
  frame(az, rainDemo, 9000).pos[rainDemo.offTank],
  rainDemo.baseById[rainDemo.offTank],
  "Rain never drags the Doomguard tank into boss melee",
);
const archAir = prep(arch, "airburst", null),
  airFrame = frame(arch, archAir, 2000);
assert(
  airFrame.effects.airburst.targetIds.length > 1,
  "Air Burst visibly includes nearby allies",
);
assert(!airFrame.effects.airburst.targetIds.includes(archAir.primaryTank));
const fearDemo = prep(arch, "fear", null);
assert(
  fearDemo.groups.every((group) => group.shamans.length),
  "teaching parties have Shaman support",
);
const fearStart = frame(arch, fearDemo, 0),
  fearClear = frame(arch, fearDemo, 1400),
  fearBegins = frame(arch, fearDemo, 2000),
  fearBroken = frame(arch, fearDemo, 3500),
  fearFire = fearStart.hazards[0];
assert.equal(fearStart.hazards.length, 1, "Fear keeps one nearby Doomfire visible");
assert.equal(fearFire.yards, 4, "Fear uses a smaller stationary Doomfire patch");
assert.deepEqual(
  fearStart.effects.fear.fire,
  fearFire,
  "Fear exposes the persistent fire for its dedicated render treatment",
);
assert.deepEqual(
  fearClear.hazards,
  fearStart.hazards,
  "the Doomfire stays in place while the player moves clear before Fear",
);
assert(
  Layout.dist(arch, fearClear.pos[fearDemo.target.id], fearFire) >= 14,
  "the target reaches clear ground before Fear starts",
);
assert.equal(fearClear.effects.fear.active, false, "Fear has not started during the escape");
assert.equal(fearBegins.effects.fear.active, true, "Fear begins after the early move");
assert.deepEqual(
  fearBegins.pos[fearDemo.target.id],
  fearClear.pos[fearDemo.target.id],
  "Fear does not walk the prepared player back toward Doomfire",
);
assert.equal(fearBroken.effects.fear.broken, true, "Tremor restores control for the covered example group");
const fearWithoutTremor = prep(arch, "fear", roster);
assert.equal(
  frame(arch, fearWithoutTremor, 3500).effects.fear.shamanId,
  null,
  "a roster without a nearby Shaman does not invent Tremor coverage",
);
assert.equal(
  frame(arch, fearWithoutTremor, 3500).effects.fear.broken,
  false,
  "Fear remains uncontrolled when nearby Tremor coverage is missing",
);
const namedFearRoster = Layout.assign(arch, {
  tanks: ["Tank"],
  healers: Array.from({ length: 6 }, (_, index) => "Resto " + (index + 1)),
  melee: Array.from({ length: 7 }, (_, index) => "Rogue " + (index + 1)),
  ranged: Array.from({ length: 11 }, (_, index) => "Mage " + (index + 1)),
});
namedFearRoster.forEach((player) => {
  player.class =
    player.kind === "tank"
      ? "WARRIOR"
      : player.kind === "healer"
        ? "SHAMAN"
        : player.kind === "melee"
          ? "ROGUE"
          : "MAGE";
});
const namedFear = Hyjal.prepareScene(arch, scene(arch, "fear"), namedFearRoster),
  namedFearStart = frame(arch, namedFear, 0),
  namedFearFire = namedFearStart.effects.fear.fire;
for (const player of namedFear.raid.filter((p) => p.id !== namedFear.target.id))
  assert(
    Layout.dist(arch, namedFear.baseById[player.id], namedFearFire) >=
      namedFearFire.yards + 2,
    "named Fear fire stays clear of " + player.name,
  );
assert(
  Layout.dist(arch, namedFear.bossAt, namedFearFire) >=
    namedFearFire.yards + 2,
  "named Fear fire stays clear of Archimonde",
);
for (const time of [0, 350, 700, 1050, 1400]) {
  const fearFrame = frame(arch, namedFear, time),
    targetAt = fearFrame.pos[namedFear.target.id];
  assert(
    Layout.dist(arch, targetAt, namedFearFire) >= namedFearFire.yards,
    "the named target's escape remains outside Doomfire at " + time + "ms",
  );
  for (const player of namedFear.raid.filter((p) => p.id !== namedFear.target.id))
    assert(
      Layout.dist(arch, targetAt, namedFear.baseById[player.id]) >= 4,
      "the named target's route stays clear of " + player.name,
    );
}
const partialGroups = prep(arch, "positioning", roster);
assert(
  partialGroups.groupCoverageMissing.length,
  "an imported roster exposes missing group capabilities",
);
assert.match(
  Hyjal.resolveExplanation({ id: "plan" }, partialGroups).title,
  /coverage is incomplete/i,
);
const ending = prep(arch, "finish", null);
assert.equal(frame(arch, ending, 3000).stage, "wisps");
assert.equal(frame(arch, ending, 3000).effects.wisps.protected, true);
for (const [fight, chapter] of [
  [winter, "nova"],
  [anetheron, "infernal"],
  [kaz, "cleave"],
  [az, "doom"],
  [arch, "curse"],
]) {
  const sc = prep(fight, chapter, { tanks: ["Only tank"] });
  const explanation = require("./tactics-steps.js")
    .forFight(fight.id)
    .forScene(chapter)
    .at(-1);
  assert.match(
    Hyjal.resolveExplanation(explanation, sc).title,
    /missing|incomplete|no eligible/i,
    "missing roles replace a successful instruction",
  );
}
for (const id of ids) {
  const fight = Data.FIGHTS[id],
    sc = prep(fight, "positioning", null);
  if (id === "hyjal-archimonde") continue;
  sc.raid
    .filter((p) => p.kind === "ranged")
    .forEach((p) =>
      assert(
        Layout.dist(fight, p.at, sc.bossAt) <= 40,
        id + " ranged can cast at the boss",
      ),
    );
  sc.raid
    .filter((p) => p.kind === "healer")
    .forEach((p) => {
      const tank =
        id === "hyjal-anetheron" && p.id === sc.addHealer
          ? sc.offTank
          : sc.primaryTank;
      assert(
        Layout.dist(fight, p.at, sc.baseById[tank]) <= 40,
        id + " healer is in range of assigned tank",
      );
    });
}
const fireDemo = prep(arch, "doomfire", null);
for (let t = 0; t <= fireDemo.duration; t += 250) {
  const f = frame(arch, fireDemo, t);
  for (const p of fireDemo.raid)
    assert(
      f.hazards.every((h) => Layout.dist(arch, f.pos[p.id], h) > h.yards),
      "Doomfire escape never crosses the trail",
    );
}
assert.deepEqual(
  frame(arch, ending, 5000).roles,
  {},
  "protected ending clears ordinary role jobs",
);
assert(
  !JSON.stringify(frame(arch, ending, 5000).instructionRows).includes("curse"),
);
const doomDemo = prep(az, "doom", null);
assert.equal(
  frame(az, doomDemo, 22500).effects.doom.revived,
  false,
  "Soulstone waits for pickup",
);
assert.equal(
  frame(az, doomDemo, 23000).effects.doom.revived,
  true,
  "assigned Soulstone revives after pickup",
);
assert.equal(
  frame(az, doom, 26000).effects.doom.revived,
  false,
  "no Warlock never fabricates a Soulstone",
);
assert.match(
  Hyjal.resolveExplanation({ id: "plan" }, doom).title,
  /Soulstone coverage is missing/,
);
const greenRoster = Layout.assign(arch, roster);
greenRoster
  .filter((p) => p.kind === "ranged")
  .forEach((p) => (p.class = "HUNTER"));
const green = Hyjal.prepareScene(arch, scene(arch, "soulcharge"), greenRoster);
assert.match(
  frame(arch, green, 2000).effects.soulcharge.classEffect,
  /2250 mana drain/,
);
const priestRoster = Layout.assign(az, roster);
priestRoster
  .filter((p) => p.kind === "ranged")
  .forEach((p) => (p.class = "PRIEST"));
const priestSetup = Hyjal.prepareScene(
  az,
  scene(az, "positioning"),
  priestRoster,
);
priestSetup.raid
  .filter((p) => p.kind === "ranged")
  .forEach((p) =>
    assert(
      Layout.dist(az, p.at, priestSetup.bossAt) < 25,
      "Shadow Priests use a closer practical casting position",
    ),
  );
// Source-formation regressions: relationship to landmarks and other roles,
// not just finite coordinates or fitting the canvas.
const angleOf = (fight, p, boss) =>
  Math.atan2((p.y - boss.y) / fight.aspect, p.x - boss.x);
for (const fight of [winter, anetheron]) {
  const sc = prep(fight, "positioning", null),
    b = sc.bossAt,
    mt = sc.baseById[sc.primaryTank];
  assert(
    b.x > 0.53 && b.x < 0.59 && b.y > 0.36 && b.y < 0.43,
    "Alliance boss is at the ballista clearing",
  );
  assert(mt.x > b.x && mt.y < b.y, "Alliance boss faces northeast");
  for (const kind of fight === anetheron ? ["ranged"] : ["healer", "ranged"]) {
    const players = sc.raid.filter((p) => p.kind === kind);
    const quadrants = new Set(
      players.map(
        (p) => (p.at.x > b.x ? "E" : "W") + (p.at.y > b.y ? "S" : "N"),
      ),
    );
    assert.equal(
      quadrants.size,
      4,
      fight.id +
        " " +
        kind +
        " surrounds the boss instead of using a rear semicircle",
    );
    const angles = players
      .map((p) => angleOf(fight, p.at, b))
      .sort((a, b) => a - b);
    const gaps = angles.map(
      (a, i) =>
        (angles[(i + 1) % angles.length] - a + Math.PI * 2) % (Math.PI * 2),
    );
    assert(
      Math.max(...gaps) < Math.PI * 0.85,
      "spread does not leave a whole empty side",
    );
  }
}
for (const fight of [kaz, az]) {
  const sc = prep(fight, "positioning", null),
    b = sc.bossAt,
    mt = sc.baseById[sc.primaryTank];
  assert(
    b.y > 0.6 && b.y < 0.72,
    "Horde boss uses the lower clearing near Thrall",
  );
  assert(mt.x > b.x && mt.y > b.y, "Horde boss faces southeast");
  assert(
    sc.raid.filter((p) => p.kind === "healer").every((p) => p.at.y < b.y),
    "healers stand on the northern side",
  );
}
for (const id of ids) {
  const fight = Data.FIGHTS[id],
    sc = prep(fight, "positioning", null),
    b = sc.bossAt,
    mt = sc.baseById[sc.primaryTank];
  if (id === "hyjal-archimonde") continue;
  const facing = { x: mt.x - b.x, y: (mt.y - b.y) / fight.aspect };
  sc.raid
    .filter((p) => p.kind === "melee")
    .forEach((p) =>
      assert(
        (p.at.x - b.x) * facing.x + ((p.at.y - b.y) / fight.aspect) * facing.y <
          0,
        "melee remains behind the facing shown in the guild diagram",
      ),
    );
}
assert.equal(
  prep(winter, "positioning", null).tanks.length,
  1,
  "Winterchill has one active tanking assignment",
);
assert.equal(
  prep(arch, "positioning", null).tanks.length,
  1,
  "Archimonde has one active tanking assignment",
);
const sourceArch = prep(arch, "positioning", null);
assert.equal(
  sourceArch.positioningSource.map,
  require("./hyjal-positions").ENCOUNTERS["hyjal-archimonde"].map,
);
assert.deepEqual(
  sourceArch.baseById,
  prep(arch, "airburst", null).baseById,
  "party positions stay consistent between chapters",
);
assert.equal(
  new Set(sourceArch.groups.flatMap((g) => g.members)).size,
  25,
  "each player has exactly one Positioning party",
);
const azDoomFrame = frame(az, doomDemo, 22000),
  doomAdd = azDoomFrame.adds[0];
assert(
  doomAdd.at.y < az.bossAt.y - 0.25,
  "Doom pickup is north toward the Tauren",
);
doomDemo.raid
  .filter((p) => p.id !== doomDemo.target.id && p.id !== doomDemo.offTank)
  .forEach((p) =>
    assert(
      Layout.dist(az, azDoomFrame.pos[p.id], doomAdd.at) > 15,
      "Doomguard lane is isolated from every raid member",
    ),
  );
const archFire = frame(arch, fireDemo, 6500);
assert.deepEqual(
  archFire.boss,
  fireDemo.bossAt,
  "tank holds while fire threatens an outer party",
);
assert.deepEqual(
  archFire.pos[fireDemo.primaryTank],
  fireDemo.baseById[fireDemo.primaryTank],
);
const moved = fireDemo.raid
  .filter((p) => JSON.stringify(archFire.pos[p.id]) !== JSON.stringify(p.at))
  .map((p) => p.id)
  .sort();
assert.deepEqual(
  moved,
  archFire.effects.doomfire.movingIds.slice().sort(),
  "only the threatened party moves",
);
const oldFire = frame(arch, fireDemo, 3500).hazards;
assert(
  oldFire.every((h) =>
    archFire.hazards.some((later) => Layout.dist(arch, h, later) < 1),
  ),
  "the early fire remains dangerous behind the advancing head",
);
const rainStart = frame(az, rainDemo, 0);
for (let t = 0; t <= rainDemo.duration; t += 250) {
  const f = frame(az, rainDemo, t);
  rainDemo.raid
    .filter((p) => !rainStart.effects.rain.targetIds.includes(p.id))
    .forEach((p) =>
      assert(
        f.hazards.every((h) => Layout.dist(az, f.pos[p.id], h) > h.yards),
        "Rain relocation does not lead unaffected players through fire",
      ),
    );
}
const azSetupDemo = prep(az, "positioning", null);
assert(
  azSetupDemo.shadowPriests.length,
  "Az demo visibly includes the source Shadow Priest exception",
);
azSetupDemo.shadowPriests.forEach((id) =>
  assert(
    Layout.dist(az, azSetupDemo.baseById[id], azSetupDemo.bossAt) < 25,
    "demo Shadow Priest takes the closer slot",
  ),
);
const anSetup = prep(anetheron, "positioning", null),
  boss = anSetup.bossAt;
const angularGap = (a, b) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const healerAngles = anSetup.raid
  .filter((p) => p.kind === "healer")
  .map((p) => angleOf(anetheron, p.at, boss));
for (const melee of anSetup.raid.filter((p) => p.kind === "melee")) {
  const angle = angleOf(anetheron, melee.at, boss);
  assert(
    healerAngles.every((a) => angularGap(a, angle) > Math.PI / 6),
    "no healer is behind any melee-targeted Swarm cone",
  );
}
const tankHealAngles = anSetup.tankHealers.map((id) =>
  angleOf(anetheron, anSetup.baseById[id], boss),
);
assert(
  angularGap(...tankHealAngles) >= (5 * Math.PI) / 6,
  "two tank healers stand on opposite sides of the formation",
);
assert.equal(
  frame(anetheron, prep(anetheron, "swarm", null), 1000).effects.carrion
    .healerIds.length,
  0,
  "illustrated melee Swarm spares tank healers",
);
const assignedAn = Layout.assign(anetheron, roster),
  preferredHealers = ["Healer 2", "Healer 1"];
const preferredAn = Hyjal.prepareScene(
  anetheron,
  scene(anetheron, "positioning"),
  assignedAn,
  { tankHealerNames: preferredHealers },
);
assert.deepEqual(
  preferredAn.tankHealers.map(
    (id) => preferredAn.raid.find((p) => p.id === id).name,
  ),
  preferredHealers,
  "assignment tank healers retain their duties",
);
assert(
  doomAdd.at.y < doomDemo.baseById[doomDemo.offTank].y,
  "Doom drop lies north of the original off-tank station",
);
assert.deepEqual(
  doomAdd.at,
  doomDemo.positioningGuide.doomDrop,
  "Doom death and tent landmark agree",
);
const crowdedBase = prep(arch, "positioning", roster);
const crowdedNudges = Object.fromEntries(
  crowdedBase.raid.map((p) => [
    p.name,
    { dx: crowdedBase.bossAt.x - p.at.x, dy: crowdedBase.bossAt.y - p.at.y },
  ]),
);
const crowdedFire = Hyjal.prepareScene(
  arch,
  scene(arch, "doomfire"),
  Layout.assign(arch, roster),
  {
    positioningState: {
      encounters: { "hyjal-archimonde": { nudges: crowdedNudges } },
    },
  },
);
assert.equal(
  frame(arch, crowdedFire, 6500).effects.doomfire.clearRoute,
  false,
  "crowded saved positions cannot invent a safe fire route",
);
assert.match(
  Hyjal.resolveExplanation({ id: "reset", title: "Safe" }, crowdedFire).title,
  /blocked/i,
  "blocked escape replaces the successful walkthrough callout",
);
assert.deepEqual(
  frame(arch, crowdedFire, 6500).pos,
  crowdedFire.baseById,
  "a blocked example does not send players off the map",
);
console.log("Hyjal encounter simulation checks passed");
