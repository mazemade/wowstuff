"use strict";

const assert = require("node:assert/strict");
const E = require("./assignments-engine.js");
const HP = require("./hyjal-positions.js");
const Archimonde = require("./tactics-hyjal-archimonde.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (error) {
    console.error("FAIL - " + name + "\n   " + error.message);
    process.exitCode = 1;
  }
}

const player = (name, cls, spec, extra) =>
  Object.assign({ name, class: cls, spec, flags: [] }, extra || {});
function roster() {
  return [
    player("Mt", "WARRIOR", "Protection", { mt: true }),
    player("Ot", "PALADIN", "Protection"),
    player("Rsham", "SHAMAN", "Restoration"),
    player("Esham", "SHAMAN", "Enhancement"),
    player("Csham", "SHAMAN", "Elemental"),
    player("Hpal", "PALADIN", "Holy"),
    player("Priest", "PRIEST", "Holy"),
    player("Druid", "DRUID", "Restoration"),
    player("Rogue", "ROGUE", "Combat"),
    player("Fury", "WARRIOR", "Fury"),
    player("Hunter", "HUNTER", "Beast Mastery"),
    player("Mage", "MAGE", "Arcane"),
    player("Lock", "WARLOCK", "Destruction"),
  ];
}
function kindFor(p) {
  const bucket = E.bucketOf(p);
  return bucket === "tanks"
    ? "tank"
    : bucket === "healers"
      ? "healer"
      : bucket === "melee"
        ? "melee"
        : "ranged";
}
function sceneFor(players) {
  return {
    raid: players.map((p, index) => ({
      id: "p" + index,
      name: p.name,
      kind: kindFor(p),
      class: p.class,
    })),
    baseById: {},
    bossAt: { x: 0.1, y: 0.1 },
    bossActor: { id: "boss", at: { x: 0.1, y: 0.1 } },
  };
}
function expected(players, state) {
  const scope = state.encounters["hyjal-archimonde"];
  return HP.computePositions(
    players,
    E.proposeGroups(players),
    E.autoAssign(players, {}).duties,
    {
      encounter: "hyjal-archimonde",
      boss: "archimonde",
      swapTanks: !!state.swapTanks.archimonde,
      nudges: HP.combineNudges(scope.saved.nudges, scope.nudges),
      anchorNudges: HP.combineNudges(
        scope.saved.anchorNudges,
        scope.anchorNudges,
      ),
    },
  );
}
function named(markers) {
  return markers
    .filter((marker) => marker.name)
    .map((marker) => ({
      name: marker.name,
      kind: marker.kind,
      party: marker.party,
      x: marker.x,
      y: marker.y,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

test("exports the Positioning tab's Archimonde map contract", () => {
  assert.deepEqual(Archimonde.ENCOUNTER, {
    id: "hyjal-archimonde",
    map: HP.ENCOUNTERS["hyjal-archimonde"].map,
    mapSize: { width: 1681, height: 936 },
    aspect: 1681 / 936,
    bossAt: HP.ENCOUNTERS["hyjal-archimonde"].anchors.boss,
  });
});

test("uses proposeGroups and computePositions exactly for a named Positioning roster", () => {
  const players = roster();
  const state = {
    encounters: {
      "hyjal-archimonde": {
        nudges: {},
        anchorNudges: {},
        saved: { nudges: {}, anchorNudges: {} },
      },
    },
    swapTanks: {},
  };
  const scene = sceneFor(players);
  const actual = Archimonde.applyFormation({}, scene, {
    positioningRoster: players,
    positioningState: state,
  });
  const direct = expected(players, state);
  assert.deepEqual(named(actual.markers), named(direct.markers));
  direct.markers
    .filter((marker) => marker.name)
    .forEach((marker) => {
      const actor = scene.raid.find((p) => p.name === marker.name);
      assert.deepEqual(
        scene.baseById[actor.id],
        { x: marker.x, y: marker.y },
        marker.name,
      );
    });
  const directGroups = E.proposeGroups(players).groups.map((group, index) => ({
    id: index + 1,
    members: group.players.map(
      (p) => scene.raid.find((actor) => actor.name === p.name).id,
    ),
  }));
  assert.deepEqual(
    scene.groups.map((group) => ({ id: group.id, members: group.members })),
    directGroups,
  );
  scene.raid.forEach((actor) =>
    assert.equal(
      actor.group,
      directGroups.findIndex((group) => group.members.includes(actor.id)),
    ),
  );
});

test("combines saved and live person, party, and boss nudges and honors the Positioning tank swap", () => {
  const players = roster();
  const state = {
    encounters: {
      "hyjal-archimonde": {
        saved: {
          nudges: { Mage: { dx: 0.01, dy: 0.02 } },
          anchorNudges: {
            boss: { dx: 0.02, dy: -0.01 },
            "party-1": { dx: -0.01, dy: 0.02 },
          },
        },
        nudges: { Mage: { dx: 0.03, dy: -0.01 } },
        anchorNudges: {
          boss: { dx: 0.01, dy: 0.02 },
          "party-1": { dx: 0.02, dy: -0.01 },
        },
      },
    },
    swapTanks: { archimonde: true },
  };
  const scene = sceneFor(players);
  const actual = Archimonde.applyFormation({}, scene, {
    positioningRoster: players,
    positioningState: state,
  });
  const direct = expected(players, state);
  assert.deepEqual(named(actual.markers), named(direct.markers));
  assert.equal(scene.primaryTank, scene.raid.find((p) => p.name === "Ot").id);
  assert.deepEqual(scene.bossAt, { x: 0.5196, y: 0.5089 });
  assert.ok(
    scene.groups.some((group) =>
      group.members.includes(scene.raid.find((p) => p.name === "Mt").id),
    ),
    "old MT remains in its actual party",
  );
});

test("an anonymous 25-player demonstration uses internal stable identities without exposing phantom names", () => {
  const kinds = [
    "tank",
    "tank",
    "tank",
    "healer",
    "healer",
    "healer",
    "healer",
    "healer",
    "healer",
  ].concat(Array(7).fill("melee"), Array(9).fill("ranged"));
  const scene = {
    raid: kinds.map((kind, index) => ({
      id: "p" + index,
      name: null,
      kind,
      class: null,
    })),
    baseById: {},
    bossAt: { x: 0.1, y: 0.1 },
    bossActor: { id: "boss", at: { x: 0.1, y: 0.1 } },
  };
  const actual = Archimonde.applyFormation({}, scene, {});
  assert.equal(scene.raid.filter((p) => p.name).length, 0);
  assert.equal(actual.markers.filter((marker) => marker.name).length, 0);
  assert.equal(scene.groups.flatMap((group) => group.members).length, 25);
  assert.ok(
    Object.values(scene.baseById).every(
      (at) => Number.isFinite(at.x) && Number.isFinite(at.y),
    ),
  );
  assert.ok(!JSON.stringify({ scene, actual }).includes("__archimonde_actor_"));
});

test("preserves the Positioning overflow party beyond 25 players", () => {
  const players = roster();
  while (players.length < 26)
    players.push(player("Extra" + players.length, "MAGE", "Arcane"));
  const scene = sceneFor(players),
    actual = Archimonde.applyFormation({}, scene, {
      positioningRoster: players,
    });
  const direct = HP.computePositions(
    players,
    E.proposeGroups(players),
    E.autoAssign(players, {}).duties,
    { encounter: "hyjal-archimonde", boss: "archimonde" },
  );
  assert.deepEqual(named(actual.markers), named(direct.markers));
  assert.equal(scene.groups.length, 6);
  assert.equal(new Set(scene.groups.flatMap((g) => g.members)).size, 26);
  for (const marker of direct.markers.filter((m) => m.kind === "stack")) {
    const actor = scene.raid.find((p) => p.name === marker.name);
    assert.equal(actor.group + 1, marker.party);
  }
});
test("ignores flat legacy nudges belonging to the Alliance camp", () => {
  const players = roster(),
    legacy = sceneFor(players),
    fresh = sceneFor(players);
  Archimonde.applyFormation({}, legacy, {
    positioningRoster: players,
    positioningState: {
      nudges: { Mage: { dx: 0.1, dy: 0.1 } },
      anchorNudges: { boss: { dx: 0.1, dy: 0.1 } },
      saved: { anchorNudges: { "party-1": { dx: 0.1, dy: 0.1 } } },
    },
  });
  Archimonde.applyFormation({}, fresh, { positioningRoster: players });
  assert.deepEqual(legacy.baseById, fresh.baseById);
  assert.deepEqual(legacy.bossAt, fresh.bossAt);
});

console.log("\n" + passed + " tests passed");
