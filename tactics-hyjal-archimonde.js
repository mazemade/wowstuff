(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./assignments-engine.js"),
      require("./hyjal-positions.js"),
    );
  else
    root.TacticsHyjalArchimonde = factory(
      root.AssignmentsEngine,
      root.HyjalPositions,
    );
})(typeof self !== "undefined" ? self : this, function (E, HP) {
  "use strict";

  // Keep this in step with the Positioning tab. The presenter uses the same image and the
  // same fractional coordinates, so its scene can consume HP's marker positions directly.
  const positionEncounter = HP.ENCOUNTERS["hyjal-archimonde"];
  const ENCOUNTER = {
    id: positionEncounter.id,
    map: positionEncounter.map,
    mapSize: { width: 1681, height: 936 },
    aspect: positionEncounter.aspect,
    bossAt: {
      x: positionEncounter.anchors.boss.x,
      y: positionEncounter.anchors.boss.y,
    },
  };

  const DEMO_BY_KIND = {
    tank: { class: "WARRIOR", spec: "Protection" },
    healer: { class: "PRIEST", spec: "Holy" },
    melee: { class: "ROGUE", spec: "Combat" },
    ranged: { class: "MAGE", spec: "Arcane" },
  };
  const ROLE_SPECS = {
    WARRIOR: {
      tank: "Protection",
      melee: "Fury",
      healer: "Fury",
      ranged: "Fury",
    },
    PALADIN: {
      tank: "Protection",
      melee: "Retribution",
      healer: "Holy",
      ranged: "Holy",
    },
    HUNTER: {
      tank: "Beast Mastery",
      melee: "Beast Mastery",
      healer: "Beast Mastery",
      ranged: "Beast Mastery",
    },
    ROGUE: {
      tank: "Combat",
      melee: "Combat",
      healer: "Combat",
      ranged: "Combat",
    },
    PRIEST: { tank: "Holy", melee: "Holy", healer: "Holy", ranged: "Shadow" },
    SHAMAN: {
      tank: "Enhancement",
      melee: "Enhancement",
      healer: "Restoration",
      ranged: "Elemental",
    },
    MAGE: {
      tank: "Arcane",
      melee: "Arcane",
      healer: "Arcane",
      ranged: "Arcane",
    },
    WARLOCK: {
      tank: "Destruction",
      melee: "Destruction",
      healer: "Destruction",
      ranged: "Destruction",
    },
    DRUID: {
      tank: "Guardian",
      melee: "Feral",
      healer: "Restoration",
      ranged: "Balance",
    },
  };

  const copyPoint = (p) => ({ x: p.x, y: p.y });
  const isName = (name) => typeof name === "string" && name.length > 0;

  function temporaryName(actor, index, used) {
    const base = "__archimonde_actor_" + (actor.id || index);
    let name = base,
      suffix = 1;
    while (used.has(name)) name = base + "_" + suffix++;
    used.add(name);
    return name;
  }

  // A prepared scene can be an anonymous teaching roster or a sparse import. Its actors are
  // not Positioning-tab records, so create records only when there was no original roster to
  // preserve. Named actors without a class intentionally remain classless: inventing a class
  // would create misleading Shaman/decurse coverage. A known class with no spec gets the scene
  // role's normal spec, which is the engine's supported way to retain that role in grouping.
  function rosterFromScene(scene) {
    const used = new Set(
      scene.raid.filter((p) => isName(p.name)).map((p) => p.name),
    );
    const temporaryNames = new Set();
    const actorsByName = new Map();
    const roster = scene.raid.map((actor, index) => {
      const anonymous = !isName(actor.name);
      const name = anonymous ? temporaryName(actor, index, used) : actor.name;
      const knownClass = actor.class ? String(actor.class).toUpperCase() : null;
      const fallback = DEMO_BY_KIND[actor.kind] || DEMO_BY_KIND.ranged;
      const playerClass = knownClass || (anonymous ? fallback.class : null);
      const spec =
        actor.spec ||
        (playerClass && ROLE_SPECS[playerClass]
          ? ROLE_SPECS[playerClass][actor.kind] ||
            ROLE_SPECS[playerClass].ranged
          : anonymous
            ? fallback.spec
            : null);
      if (anonymous) temporaryNames.add(name);
      actorsByName.set(name, actor);
      return Object.assign({}, actor, {
        name,
        class: playerClass,
        spec,
        mt: actor.mt || actor.kind === "tank",
        flags: actor.flags || [],
      });
    });
    return { roster, actorsByName, temporaryNames, source: "scene" };
  }

  function rosterFromPositioning(scene, positioningRoster) {
    const actorsByName = new Map();
    scene.raid.forEach((actor) => {
      if (isName(actor.name) && !actorsByName.has(actor.name))
        actorsByName.set(actor.name, actor);
    });
    // Do not clone or normalize imported records. Their metadata and order are precisely the
    // inputs that the Positioning tab passes to proposeGroups.
    return {
      roster: positioningRoster,
      actorsByName,
      temporaryNames: new Set(),
      source: "positioningRoster",
    };
  }

  function effectivePositioningOptions(positioningState) {
    const state = positioningState || {};
    // Flat legacy fields belong to hyjal-b12, exactly as positions.js migrates them.
    const scope = (state.encounters && state.encounters[ENCOUNTER.id]) || {};
    const saved = scope.saved || {};
    return {
      encounter: ENCOUNTER.id,
      boss: "archimonde",
      swapTanks: !!(state.swapTanks || {}).archimonde,
      nudges: HP.combineNudges(saved.nudges, scope.nudges),
      anchorNudges: HP.combineNudges(saved.anchorNudges, scope.anchorNudges),
    };
  }

  function actorForName(actorsByName, name) {
    return actorsByName.get(name) || null;
  }

  function isMeleeMajority(players) {
    return (
      players.filter((player) => {
        const bucket = E.bucketOf(player);
        return bucket === "melee" || bucket === "tanks";
      }).length *
        2 >
      players.length
    );
  }

  function applyFormation(fight, scene, options) {
    options = options || {};
    const supplied =
      Array.isArray(options.positioningRoster) &&
      options.positioningRoster.length;
    const input = supplied
      ? rosterFromPositioning(scene, options.positioningRoster)
      : rosterFromScene(scene);
    const roster = input.roster;
    const groupsResult = E.proposeGroups(roster);
    const duties = options.positioningDuties || E.autoAssign(roster, {}).duties;
    const positionOptions = effectivePositioningOptions(
      options.positioningState,
    );
    const computed = HP.computePositions(
      roster,
      groupsResult,
      duties,
      positionOptions,
    );

    const markersByName = new Map();
    const handlesByParty = new Map();
    computed.markers.forEach((marker) => {
      if (isName(marker.name)) markersByName.set(marker.name, marker);
      if (marker.kind === "stackhandle")
        handlesByParty.set(marker.party, marker);
    });

    scene.baseById = {};
    scene.raid.forEach((actor) => {
      const marker =
        markersByName.get(actor.name) ||
        [...input.actorsByName.entries()].find(
          (entry) => entry[1] === actor && markersByName.has(entry[0]),
        )?.[0];
      const resolved =
        typeof marker === "string" ? markersByName.get(marker) : marker;
      if (resolved) {
        scene.baseById[actor.id] = copyPoint(resolved);
        actor.at = copyPoint(resolved);
      }
    });

    const boss = computed.markers.find((marker) => marker.kind === "boss");
    if (boss) {
      scene.bossAt = copyPoint(boss);
      if (scene.bossActor) scene.bossActor.at = copyPoint(boss);
    }
    const mt = computed.markers.find((marker) => marker.kind === "mt");
    const mtActor = mt && actorForName(input.actorsByName, mt.name);
    scene.primaryTank = mtActor ? mtActor.id : null;

    const allGroups = groupsResult.groups.slice();
    for (const party of handlesByParty.keys()) {
      if (party <= allGroups.length) continue;
      const names = new Set(
        computed.markers
          .filter((marker) => marker.party === party && marker.name)
          .map((marker) => marker.name),
      );
      allGroups[party - 1] = {
        players: roster.filter((player) => names.has(player.name)),
      };
    }
    scene.groups = allGroups
      .map((group, index) => {
        const party = index + 1;
        const members = group.players
          .map((player) => actorForName(input.actorsByName, player.name))
          .filter(Boolean);
        members.forEach((actor) => {
          actor.group = index;
        });
        const handle = handlesByParty.get(party);
        const fallback =
          members.map((actor) => scene.baseById[actor.id]).find(Boolean) ||
          scene.bossAt;
        return {
          id: party,
          at: copyPoint(handle || fallback),
          name: "Group " + party,
          members: members.map((actor) => actor.id),
          shamans: group.players
            .filter((player) => player.class === "SHAMAN")
            .map((player) => actorForName(input.actorsByName, player.name))
            .filter(Boolean)
            .map((actor) => actor.id),
          decursers: group.players
            .filter(
              (player) => player.class === "MAGE" || player.class === "DRUID",
            )
            .map((player) => actorForName(input.actorsByName, player.name))
            .filter(Boolean)
            .map((actor) => actor.id),
          melee: isMeleeMajority(
            group.players.filter((player) => player.name !== mt?.name),
          ),
        };
      })
      .filter((group) => group.members.length);

    // HP owns these mechanic checks. Keep party Tremor omissions separately for the presenter
    // callout and leave raid-wide decurse (and future HP warnings) intact.
    scene.groupCoverageMissing = computed.warnings.filter((warning) =>
      /^Group \d+ has no shaman — no Tremor Totem for fears\.$/.test(warning),
    );
    scene.positioningWarnings = computed.warnings.filter(
      (warning) => scene.groupCoverageMissing.indexOf(warning) === -1,
    );
    scene.positioningSource = {
      encounter: ENCOUNTER.id,
      map: ENCOUNTER.map,
      mapSize: Object.assign({}, ENCOUNTER.mapSize),
      aspect: ENCOUNTER.aspect,
      bossAt: Object.assign({}, ENCOUNTER.bossAt),
      rosterSource: input.source,
      playerCount: roster.length,
      partyCount: scene.groups.length,
    };

    // Do not leak temporary anonymous-record names into the presenter's public scene/result.
    // Named markers retain their exact Positioning-tab shape and coordinates for parity checks.
    const publicMarkers = computed.markers.map((marker) => {
      if (!input.temporaryNames.has(marker.name))
        return Object.assign({}, marker);
      const actor = actorForName(input.actorsByName, marker.name);
      const out = Object.assign({}, marker, { actorId: actor && actor.id });
      delete out.name;
      return out;
    });
    return {
      markers: publicMarkers,
      warnings: computed.warnings.slice(),
      groups: scene.groups,
      source: scene.positioningSource,
    };
  }

  return { ENCOUNTER, ARCHIMONDE_ENCOUNTER: ENCOUNTER, applyFormation };
});
