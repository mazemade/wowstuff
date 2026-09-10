(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./tactics-layout.js"),
      require("./tactics-hyjal-archimonde.js"),
      require("./assignments-engine.js"),
      require("./hyjal-positions.js"),
    );
  else
    root.TacticsHyjal = factory(
      root.TacticsLayout,
      root.TacticsHyjalArchimonde,
      root.AssignmentsEngine,
      root.HyjalPositions,
    );
})(typeof self !== "undefined" ? self : this, function (L, ARCH, E, HP) {
  "use strict";
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n)),
    cp = (p) => ({ x: p.x, y: p.y }),
    mix = (a, b, t) => ({
      x: a.x + (b.x - a.x) * clamp(t),
      y: a.y + (b.y - a.y) * clamp(t),
    }),
    cls = (p) => String(p.class || "").toUpperCase(),
    dist = (f, a, b) => L.dist(f, a, b);
  const inside = (f, p) => ({
      x: clamp(p.x, f.arena.x0 + 0.015, f.arena.x1 - 0.015),
      y: clamp(p.y, f.arena.y0 + 0.015, f.arena.y1 - 0.015),
    }),
    homes = (s) =>
      Object.fromEntries(
        Object.entries(s.baseById).map(([id, p]) => [id, cp(p)]),
      );
  const demo = {
    tank: ["WARRIOR", "DRUID", "PALADIN"],
    healer: ["PRIEST", "SHAMAN", "PALADIN", "DRUID"],
    melee: ["ROGUE", "WARRIOR", "SHAMAN"],
    ranged: ["MAGE", "WARLOCK", "HUNTER", "DRUID"],
  };
  const isDispel = (p) => ["PRIEST", "PALADIN"].includes(cls(p)),
    isDecurse = (p) =>
      cls(p) === "MAGE" ||
      (cls(p) === "DRUID" && /^(restoration|resto)$/i.test(p.spec || ""));
  const b12Spec = (p) => {
    const byClass = {
      WARRIOR: p.kind === "tank" ? "Protection" : "Fury",
      PALADIN: p.kind === "tank" ? "Protection" : p.kind === "healer" ? "Holy" : "Retribution",
      DRUID: p.kind === "tank" ? "Guardian" : p.kind === "healer" ? "Restoration" : p.kind === "melee" ? "Feral" : "Balance",
      PRIEST: p.kind === "ranged" ? "Shadow" : "Holy",
      SHAMAN: p.kind === "healer" ? "Restoration" : p.kind === "melee" ? "Enhancement" : "Elemental",
      HUNTER: "Beast Mastery",
      ROGUE: "Combat",
      MAGE: "Arcane",
      WARLOCK: "Destruction",
    };
    return p.spec || byClass[cls(p)] || "Arcane";
  };
  function applyB12Formation(fight, sc, options) {
    const state = options.positioningState || {};
    const scope = (state.encounters && state.encounters["hyjal-b12"]) || {};
    const saved = scope.saved || {};
    const hasSavedFormation = [saved.nudges, saved.anchorNudges, scope.nudges, scope.anchorNudges]
      .some((layer) => layer && Object.keys(layer).length);
    const boss = fight.id === "hyjal-anetheron" ? "anetheron" : "winterchill";
    // Templates are stored as offsets from Positioning's exact computed seats.
    // With no saved template, keep the authored wide teaching formation below;
    // with one, do not alter the Positioning baseline before restoring its offsets.
    if (!hasSavedFormation) {
      sc.positioningSource = { encounter: "hyjal-b12", boss, rosterSource: "authored-wide" };
      return;
    }
    const supplied = Array.isArray(options.positioningRoster) && options.positioningRoster.length;
    const roster = supplied
      ? options.positioningRoster
      : sc.raid.map((actor, index) => {
          const name = actor.name || "__b12_actor_" + (actor.id || index);
          return {
            name,
            class: cls(actor),
            spec: b12Spec(actor),
            mt: actor.id === sc.primaryTank,
            flags: actor.flags || [],
          };
        });
    const byName = new Map(sc.raid.filter((actor) => actor.name).map((actor) => [actor.name, actor]));
    if (!supplied)
      sc.raid.forEach((actor, index) =>
        byName.set(actor.name || "__b12_actor_" + (actor.id || index), actor),
      );
    const baseDuties = options.positioningDuties || E.autoAssign(roster, {}).duties;
    const dutyTankHealers = (baseDuties.find((duty) => duty.id === "tankheal") || {}).players || [];
    // Use the exact assignment result that Positioning uses. Saved templates are
    // offsets from these seats, so replacing its tank-healer row would shift every
    // saved token before the offsets were restored.
    const computed = HP.computePositions(roster, E.proposeGroups(roster), baseDuties, {
      encounter: "hyjal-b12",
      boss,
      swapTanks: !!(state.swapTanks || {})[boss],
      nudges: HP.combineNudges(saved.nudges, scope.nudges),
      anchorNudges: HP.combineNudges(saved.anchorNudges, scope.anchorNudges),
    });
    const markersByName = new Map();
    computed.markers.forEach((marker) => {
      if (marker.name) markersByName.set(marker.name, marker);
      (marker.names || []).forEach((name) => markersByName.set(name, marker));
    });
    sc.baseById = {};
    sc.raid.forEach((actor) => {
      const marker = markersByName.get(actor.name) || [...byName.entries()].find(([name, value]) => value === actor && markersByName.has(name))?.[0];
      const resolved = typeof marker === "string" ? markersByName.get(marker) : marker;
      if (resolved) sc.baseById[actor.id] = cp(resolved);
    });
    const bossMarker = computed.markers.find((marker) => marker.kind === "boss");
    if (bossMarker) sc.bossAt = cp(bossMarker);
    const mtMarker = computed.markers.find((marker) => marker.kind === "mt");
    if (mtMarker && byName.get(mtMarker.name)) sc.primaryTank = byName.get(mtMarker.name).id;
    const offTankMarker = computed.markers.find((marker) => marker.kind === "offtank");
    sc.offTank = offTankMarker && byName.get(offTankMarker.name)
      ? byName.get(offTankMarker.name).id
      : boss === "anetheron" ? null : sc.offTank;
    const dutyNames = [
      ...(options.tankHealerNames || []).filter(Boolean),
      ...dutyTankHealers,
      ...roster.filter((player) => E.bucketOf(player) === "healers").map((player) => player.name),
    ].filter((name, index, names) => names.indexOf(name) === index).slice(0, 2);
    sc.tankHealers = dutyNames
      .map((name) => byName.get(name))
      .filter((actor) => actor && sc.healers.includes(actor.id))
      .slice(0, 2)
      .map((actor) => actor.id);
    if (sc.tankHealers.length < 2)
      sc.tankHealers = sc.healers.slice(0, 2);
    if (boss === "anetheron") {
      const station = computed.markers.find((marker) => marker.kind === "station");
      sc.infernalStation = station ? cp(station) : null;
      sc.addHealer = sc.healers
        .filter((id) => !sc.tankHealers.includes(id))
        .sort((a, b) =>
          dist(fight, sc.baseById[a], station || sc.bossAt) -
          dist(fight, sc.baseById[b], station || sc.bossAt),
        )[0] || sc.tankHealers[0] || null;
      // The closest ranged player runs to the already-reserved station.  This
      // keeps the demonstration readable at normal movement speed without
      // putting a healer in the Carrion Swarm/melee lane.
      sc.target = sc.raid
        .filter((actor) => actor.kind === "ranged" && actor.id !== sc.offTank)
        .sort((a, b) =>
          dist(fight, sc.baseById[a.id], sc.infernalStation || sc.bossAt) -
          dist(fight, sc.baseById[b.id], sc.infernalStation || sc.bossAt),
        )[0] || sc.target;
    }
    sc.positioningWarnings = computed.warnings.slice();
    sc.positioningSource = { encounter: "hyjal-b12", boss, rosterSource: supplied ? "positioningRoster" : "scene", saved: true };
  }
  function fireTrail(plan, t) {
    const progress = clamp((t - 900) / 6500) * (plan.path.length - 1);
    const point = (u) => {
      const i = Math.min(plan.path.length - 2, Math.floor(u));
      return mix(plan.path[i], plan.path[i + 1], u - i);
    };
    const trail = [];
    for (let u = 0; u < progress; u += 0.06) trail.push(point(u));
    trail.push(point(progress));
    return trail;
  }
  function planDoomfire(fight, sc) {
    // Pick a clear teaching lane from the actual party formation. The fire curls
    // into the party's old space while that party takes a perpendicular exit.
    let best = null;
    const groups = sc.groups.filter(
      (g) => !g.melee && g.members.some((id) => id !== sc.primaryTank),
    );
    for (const group of groups) {
      const members = group.members.filter((id) => id !== sc.primaryTank);
      const center = members.reduce(
        (a, id) => ({
          x: a.x + sc.baseById[id].x / members.length,
          y: a.y + sc.baseById[id].y / members.length,
        }),
        { x: 0, y: 0 },
      );
      const dx = center.x - sc.bossAt.x,
        dy = (center.y - sc.bossAt.y) / fight.aspect,
        length = Math.hypot(dx, dy) || 0.1;
      const radial = { x: dx / length, y: dy / length },
        side = { x: -radial.y, y: radial.x };
      const point = (r, l) => ({
        x: sc.bossAt.x + radial.x * r + side.x * l,
        y: sc.bossAt.y + (radial.y * r + side.y * l) * fight.aspect,
      });
      for (const sign of [-1, 1])
        for (const start of [0.45, 0.6, 0.72]) {
          const shift = {
            x: side.x * sign * 22 * fight.yard,
            y: side.y * sign * 22 * fight.yard * fight.aspect,
          };
          const plan = {
            groupId: group.id,
            members,
            path: [
              point(length * start, -sign * 8 * fight.yard),
              point(length * 0.78, -sign * 5 * fight.yard),
              center,
              point(length + 8 * fight.yard, sign * 3 * fight.yard),
            ],
            shift,
          };
          let clearance = Infinity;
          for (let t = 0; t <= 10000; t += 400) {
            const trail = fireTrail(plan, t),
              travel = clamp((t - 250) / 3500);
            for (const actor of sc.raid) {
              const at = sc.baseById[actor.id],
                moving = members.includes(actor.id);
              const location = moving
                ? { x: at.x + shift.x * travel, y: at.y + shift.y * travel }
                : at;
              if (
                location.x < 0.02 ||
                location.x > 0.98 ||
                location.y < 0.02 ||
                location.y > 0.98
              )
                clearance = -100;
              for (const h of trail)
                clearance = Math.min(clearance, dist(fight, location, h) - 6);
            }
          }
          if (!best || clearance > best.clearance)
            best = { ...plan, clearance };
        }
    }
    return (
      best || {
        groupId: null,
        members: [],
        shift: { x: 0, y: 0 },
        path: [
          { x: 0.7, y: 0.6 },
          { x: 0.76, y: 0.65 },
          { x: 0.79, y: 0.75 },
        ],
        clearance: 0,
      }
    );
  }
  function planFearEscape(fight, sc, target) {
    const from = sc.baseById[target.id],
      fireRadius = 4,
      safeDistance = 18,
      blockers = sc.raid
        .filter((p) => p.id !== target.id)
        .map((p) => sc.baseById[p.id])
        .concat(sc.bossAt),
      baseAngle = Math.atan2(
        (from.y - sc.bossAt.y) / fight.aspect,
        from.x - sc.bossAt.x,
      ),
      offsets = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI];
    const clearance = (at, points) =>
      Math.min(...points.map((point) => dist(fight, at, point)));
    let fallback = null;
    for (const radius of [8, 10, 12]) {
      let best = null;
      for (const offset of offsets) {
        const angle = baseAngle + offset,
          fire = inside(fight, {
            x: from.x + Math.cos(angle) * radius * fight.yard,
            y: from.y + Math.sin(angle) * radius * fight.yard * fight.aspect,
          }),
          fireDistance = dist(fight, from, fire),
          to = inside(fight, {
            x: fire.x + ((from.x - fire.x) * safeDistance) / fireDistance,
            y: fire.y + ((from.y - fire.y) * safeDistance) / fireDistance,
          }),
          fireClearance = clearance(fire, blockers),
          routeClearance = Math.min(
            ...Array.from({ length: 11 }, (_, index) =>
              clearance(mix(from, to, index / 10), blockers),
            ),
          ),
          candidate = { fire, to, fireDistance, fireClearance, routeClearance };
        if (!fallback || fireClearance > fallback.fireClearance)
          fallback = candidate;
        if (
          fireDistance >= fireRadius &&
          fireClearance >= fireRadius + 2 &&
          routeClearance >= fireRadius
        ) {
          if (
            !best ||
            Math.min(fireClearance, routeClearance) >
              Math.min(best.fireClearance, best.routeClearance)
          )
            best = candidate;
        }
      }
      if (best) return best;
    }
    return fallback;
  }
  function prepareScene(fight, source, assigned, options = {}) {
    const sc = JSON.parse(JSON.stringify(source)),
      g = { tank: [], melee: [], healer: [], ranged: [] },
      isDemo = assigned.length === 25 && assigned.every((p) => !p.name);
    const demoClasses =
      fight.id === "hyjal-archimonde"
        ? {
            ...demo,
            healer: [
              "PRIEST",
              "SHAMAN",
              "SHAMAN",
              "SHAMAN",
              "SHAMAN",
              "SHAMAN",
            ],
            ranged: [
              "MAGE",
              "MAGE",
              "MAGE",
              "MAGE",
              "MAGE",
              "WARLOCK",
              "HUNTER",
              "WARLOCK",
              "HUNTER",
            ],
          }
        : fight.id === "hyjal-azgalor"
          ? {
              ...demo,
              ranged: [
                "PRIEST",
                "MAGE",
                "WARLOCK",
                "HUNTER",
                "MAGE",
                "WARLOCK",
                "HUNTER",
                "DRUID",
                "MAGE",
                "WARLOCK",
              ],
            }
          : demo;
    sc.raid = assigned.map((p) => {
      const q = {
        ...p,
        class:
          p.class ||
          (isDemo
            ? demoClasses[p.kind][g[p.kind].length % demoClasses[p.kind].length]
            : null),
      };
      g[p.kind].push(q);
      return q;
    });
    sc.shadowPriests = g.ranged
      .filter((p) => cls(p) === "PRIEST")
      .map((p) => p.id);
    sc.tanks = g.tank.map((p) => p.id);
    sc.healers = g.healer.map((p) => p.id);
    sc.damage = g.melee.concat(g.ranged).map((p) => p.id);
    sc.primaryTank = sc.tanks[0] || null;
    sc.offTank = sc.tanks[1] || null;
    sc.target = g.ranged[0] || g.healer[0] || g.melee[0] || null;
    sc.manaUser = g.healer.at(-1) || g.ranged.at(-1) || null;
    sc.dispeller = sc.raid.find(isDispel)?.id || null;
    sc.decurser = sc.raid.find(isDecurse)?.id || null;
    sc.shaman = sc.raid.find((p) => cls(p) === "SHAMAN")?.id || null;
    // This teaching example assumes the required pre-pull item was collected.
    // A roster import cannot inspect inventory.
    sc.hasTears = true;
    // Icebolt's stun and damage-over-time are both removable with a PvP trinket.
    // Treat the prepared scene as a player who brought the assigned trinket.
    sc.hasPvpTrinket = true;
    sc.warlock = sc.raid.find((p) => cls(p) === "WARLOCK")?.id || null;
    sc.missingRoles = [];
    if (!sc.primaryTank) sc.missingRoles.push("No main tank loaded.");
    if (!sc.healers.length)
      sc.missingRoles.push("No healer loaded: recovery is not demonstrated.");
    if (!sc.damage.length)
      sc.missingRoles.push(
        "No damage player loaded: a kill is not demonstrated.",
      );
    if (["hyjal-anetheron", "hyjal-azgalor"].includes(fight.id) && !sc.offTank)
      sc.missingRoles.push("No off-tank loaded for the isolated add pickup.");
    if (fight.id === "hyjal-kazrogal" && sc.tanks.length < 3)
      sc.missingRoles.push(
        "Malevolent Cleave needs 3 tanks; only " + sc.tanks.length + " loaded.",
      );
    if (fight.id === "hyjal-winterchill" && !sc.dispeller)
      sc.missingRoles.push(
        "No Priest or Paladin loaded for Frost Nova removal.",
      );
    if (fight.id === "hyjal-azgalor" && !sc.warlock)
      sc.missingRoles.push(
        "Soulstone coverage is missing: no Warlock is loaded. Doom is still lethal; the target remains dead after the add pickup.",
      );
    if (fight.id === "hyjal-archimonde") {
      if (!sc.decurser)
        sc.missingRoles.push("No Mage or Druid loaded for Grip decurse.");
      if (!sc.shaman)
        sc.missingRoles.push("No Shaman loaded for group fear coverage.");
    }
    sc.baseById = {};
    sc.groups = [];
    sc.bossAt = cp(fight.bossAt);
    const back = g.healer.concat(g.ranged);
    // These are map positions, traced from the guild's annotated formations.
    // Backline tokens represent individual spread slots; melee share the rear hitbox.
    const slots = {
      "hyjal-winterchill": {
        facing: -25,
        healer: [
          [0.475, 0.148],
          [0.611, 0.148],
          [0.425, 0.36],
          [0.693, 0.55],
          [0.49, 0.619],
          [0.62, 0.64],
        ],
        ranged: [
          [0.539, 0.16],
          [0.428, 0.25],
          [0.714, 0.4],
          [0.37, 0.5],
          [0.5, 0.72],
          [0.586, 0.24],
          [0.68, 0.275],
          [0.73, 0.49],
          [0.55, 0.7],
          [0.365, 0.4],
          [0.42, 0.58],
        ],
      },
      "hyjal-anetheron": {
        facing: -25,
        healer: [
          [0.475, 0.148],
          [0.611, 0.148],
          [0.425, 0.36],
          [0.693, 0.55],
          [0.49, 0.619],
          [0.62, 0.64],
        ],
        ranged: [
          [0.539, 0.16],
          [0.428, 0.25],
          [0.714, 0.4],
          [0.37, 0.5],
          [0.5, 0.72],
          [0.586, 0.24],
          [0.68, 0.275],
          [0.73, 0.49],
          [0.55, 0.7],
          [0.365, 0.4],
          [0.42, 0.58],
        ],
        offTank: [0.72, 0.16],
      },
      "hyjal-kazrogal": {
        facing: 30,
        healer: [
          [0.535, 0.44],
          [0.595, 0.515],
          [0.635, 0.605],
          [0.585, 0.43],
          [0.65, 0.52],
          [0.495, 0.475],
        ],
        ranged: [
          [0.38, 0.635],
          [0.396, 0.578],
          [0.42, 0.534],
          [0.355, 0.53],
          [0.455, 0.435],
          [0.385, 0.47],
          [0.45, 0.52],
          [0.35, 0.69],
          [0.405, 0.71],
        ],
      },
      "hyjal-azgalor": { facing: 30, offTank: [0.54, 0.17] },
      "hyjal-archimonde": { facing: 165 },
    }[fight.id];
    const polar = (radius, degrees) => ({
      x:
        fight.bossAt.x +
        Math.cos((degrees * Math.PI) / 180) * radius * fight.yard,
      y:
        fight.bossAt.y +
        Math.sin((degrees * Math.PI) / 180) *
          radius *
          fight.yard *
          fight.aspect,
    });
    const spreadSlot = (list, index) => {
      const anchor = list[index % list.length],
        overflow = Math.floor(index / list.length);
      return {
        x: anchor[0] + overflow * 0.023,
        y: anchor[1] + overflow * 0.032,
      };
    };
    const rear = sc.raid.filter(
      (p) =>
        p.kind === "melee" ||
        (p.kind === "tank" &&
          p.id !== sc.primaryTank &&
          !(slots.offTank && p.id === sc.offTank)),
    );
    sc.raid.forEach((p) => {
      const index = g[p.kind].indexOf(p);
      let at;
      if (
        p.id === sc.primaryTank ||
        (fight.id === "hyjal-kazrogal" && p.kind === "tank" && index < 3)
      )
        at = polar(9, slots.facing);
      else if (p.id === sc.offTank && slots.offTank)
        at = { x: slots.offTank[0], y: slots.offTank[1] };
      else if (rear.includes(p))
        at = polar(
          8.5,
          ["hyjal-winterchill", "hyjal-anetheron"].includes(fight.id)
            ? slots.facing + 180
            : slots.facing +
              180 -
              38 +
              (76 * rear.indexOf(p)) / Math.max(1, rear.length - 1),
        );
      else if (fight.id === "hyjal-azgalor") {
        const radius = p.kind === "healer" ? 31 : cls(p) === "PRIEST" ? 24 : 37;
        at = polar(
          radius,
          -153 + (125 * index) / Math.max(1, g[p.kind].length - 1),
        );
      } else if (slots[p.kind]) at = spreadSlot(slots[p.kind], index);
      else
        at = polar(
          28,
          -135 + (270 * back.indexOf(p)) / Math.max(1, back.length - 1),
        );
      sc.baseById[p.id] = inside(fight, at);
    });
    if (["hyjal-winterchill", "hyjal-anetheron"].includes(fight.id))
      applyB12Formation(fight, sc, options);
    if (["hyjal-winterchill", "hyjal-anetheron"].includes(fight.id) && !sc.positioningSource?.saved) {
      const preferred = (options.tankHealerNames || [])
        .map((name) => g.healer.find((p) => p.name === name))
        .filter(Boolean);
      const ordered = [
        ...preferred,
        ...g.healer.filter((p) => !preferred.includes(p)),
      ];
      sc.tankHealers = ordered.slice(0, 2).map((p) => p.id);
      // Your B12 template intentionally gives the tank-healer pair the left and
      // right anchors, never the stacked melee rear. Fill the remaining wide
      // anchors in order so no two healer tokens overlap.
      const healerAnchors = [slots.healer[2], slots.healer[3], slots.healer[0], slots.healer[1], ...slots.healer.slice(4)];
      ordered.forEach((p, index) => {
        sc.baseById[p.id] = inside(fight, spreadSlot(healerAnchors, index));
      });
      if (sc.tankHealers.length < 2)
        sc.missingRoles.push(
          "Two tank healers are required on opposite sides; only " +
            sc.tankHealers.length +
            " loaded.",
        );
      if (fight.id === "hyjal-anetheron")
        sc.addHealer = ordered
          .slice(2)
          .sort((a, b) =>
            dist(fight, sc.baseById[a.id], sc.baseById[sc.offTank]) -
            dist(fight, sc.baseById[b.id], sc.baseById[sc.offTank]),
          )[0]?.id || ordered[0]?.id || null;
    }
    if (fight.id === "hyjal-archimonde") {
      ARCH.applyFormation(fight, sc, options);
      sc.offTank = null; // Additional tanks stay in their parties; there is no Archimonde add-tank duty.
    }
    sc.positioningGuide = {
      facing: slots.facing,
      landmarks:
        fight.id.includes("winterchill") || fight.id.includes("anetheron")
          ? [{ at: { x: 0.66, y: 0.33 }, label: "Ballista" }]
          : fight.id.includes("kazrogal") || fight.id.includes("azgalor")
            ? [{ at: { x: 0.51, y: 0.745 }, label: "Thrall" }]
            : [],
      rainRange: fight.id === "hyjal-azgalor" ? 30 : null,
      doomDrop: fight.id === "hyjal-azgalor" ? { x: 0.575, y: 0.1 } : null,
    };
    sc.groupCoverageMissing ||= [];
    if (sc.positioningWarnings) sc.missingRoles.push(...sc.positioningWarnings);
    if (sc.groupCoverageMissing.length)
      sc.missingRoles.push(...sc.groupCoverageMissing);
    sc.raid.forEach((p) => {
      p.at = cp(sc.baseById[p.id]);
      p.label =
        sc.id === "positioning" ? (p.kind !== "tank" ? p.name || "" : "") : "";
    });
    sc.bossAt ||= cp(fight.bossAt);
    sc.bossActor = { id: "boss", at: cp(sc.bossAt), scale: 0.82 };
    if (fight.id === "hyjal-archimonde" && sc.id === "doomfire") {
      sc.doomfirePlan = planDoomfire(fight, sc);
      if (sc.doomfirePlan.clearance <= 0)
        sc.missingRoles.push(
          "The saved formation has no clear escape for this Doomfire example. Adjust the party positions.",
        );
    }
    if (fight.id === "hyjal-archimonde" && sc.id === "fear" && sc.target)
      sc.fearEscape = planFearEscape(fight, sc, sc.target);
    return sc;
  }
  function move(f, id, from, to, t) {
    if (!id) return;
    f.pos[id] = mix(from, to, t);
    if (t < 1) f.routes.push({ targetId: id, from: cp(f.pos[id]), to: cp(to) });
  }
  function frame(sc, t) {
    const f = {
      pos: homes(sc),
      boss: cp(sc.bossAt),
      bossTarget: sc.primaryTank,
      hp: {},
      roles: {},
      focus: {},
      timeMs: t,
      phase: 1,
      stage: sc.id,
      call: sc.call || "",
      instructionRows: sc.jobs || [],
      routes: [],
      hazards: [],
      adds: [],
      effects: {},
    };
    sc.raid.forEach((p) => {
      f.hp[p.id] = 1;
    });
    if (sc.primaryTank) f.roles[sc.primaryTank] = "MT";
    if (sc.offTank) f.roles[sc.offTank] = "OT";
    return f;
  }
  function kazStack(sc, f) {
    sc.tanks.slice(0, 3).forEach((id, i) => {
      f.pos[id] = cp(sc.baseById[id]);
      if (i) delete f.roles[id];
      else
        f.roles[id] =
          sc.tanks.length >= 3
            ? "3 tanks · share Cleave"
            : sc.tanks.length + "/3 tanks · incomplete";
      f.focus[id] = true;
    });
    f.effects.cleave = {
      targetIds: sc.tanks.slice(0, 3),
      active: sc.id === "cleave" && f.timeMs >= 1600 && f.timeMs < 4300,
    };
  }
  function simulate(fight, sc, timeMs) {
    const t = clamp(
        Number.isFinite(timeMs) ? timeMs : 0,
        0,
        sc.duration || 10000,
      ),
      f = frame(sc, t),
      target = sc.target?.id,
      healer = sc.healers[0];
    if (fight.id === "hyjal-kazrogal") {
      kazStack(sc, f);
      if (sc.id === "positioning") f.focus = {};
    }
    if (fight.id === "hyjal-winterchill") {
      if (sc.id === "icebolt" && target) {
        const frozen = cp(sc.baseById[target]);
        const nearest = sc.healers
          .slice()
          .sort(
            (a, b) =>
              dist(fight, f.pos[a], frozen) - dist(fight, f.pos[b], frozen),
          )[0];
        const trinketAt = 800,
          trinketUsed = sc.hasPvpTrinket && t >= trinketAt;
        f.effects.icebolt = {
          targetId: target,
          frozenAt: frozen,
          stunned: !trinketUsed && t < 4000,
          dotActive: !trinketUsed && t < 4000,
          trinketUsed,
          trinketAt,
          healerId: nearest || null,
          healing: !!nearest && t >= 400,
          immunity: false,
        };
        f.focus[target] = true;
        f.hp[target] =
          nearest && t >= 400 ? 0.55 + 0.4 * clamp((t - 400) / 3200) : 0.4;
        f.call = !trinketUsed
          ? "Icebolt freezes the target: use the PvP trinket immediately."
          : healer
            ? "PvP trinket removes Icebolt; assigned healer tops the target off."
            : "PvP trinket removes Icebolt; the target still needs healer coverage.";
      }
      if (sc.id === "dnd") {
        const h = {
          ...sc.bossAt,
          y: sc.bossAt.y + 0.06,
          yards: 20,
          kind: "Death and Decay",
        };
        f.hazards.push(h);
        const k = clamp((t - 500) / 4500);
        sc.raid
          .filter(
            (p) =>
              p.id !== sc.primaryTank && dist(fight, sc.baseById[p.id], h) < 20,
          )
          .forEach((p) => {
            const start = sc.baseById[p.id],
              dx = start.x - h.x,
              dy = (start.y - h.y) / fight.aspect,
              length = Math.hypot(dx, dy) || 0.01;
            const to = inside(fight, {
              x: h.x + (dx / length) * 23 * fight.yard,
              y: h.y + (dy / length) * 23 * fight.yard * fight.aspect,
            });
            move(f, p.id, start, to, k);
            f.focus[p.id] = true;
          });
        if (sc.primaryTank) f.focus[sc.primaryTank] = true;
        f.effects.dnd = {
          tankId: sc.primaryTank,
          healerId: sc.healers[0] || null,
          tankHolds: !!sc.primaryTank,
        };
        f.call =
          "Raid leaves Death and Decay. The tank holds at the ballista with dedicated healing, as in the guild plan.";
      }
      if (sc.id === "nova") {
        const ids = sc.raid
          .filter((p) => dist(fight, sc.baseById[p.id], sc.bossAt) <= 20)
          .map((p) => p.id);
        const priest = sc.raid.find((p) => cls(p) === "PRIEST"),
          released = !!sc.dispeller && t >= 2500;
        const removedIds = released ? (priest ? ids : ids.slice(0, 1)) : [];
        f.effects.nova = {
          affectedIds: ids,
          active: t < 10000 && removedIds.length < ids.length,
          dispelled: released,
          removedIds,
          expiresAt: 10000,
          dispellerId: sc.dispeller,
        };
        ids.forEach((id) => {
          f.focus[id] = true;
        });
        f.call = released
          ? priest
            ? "Mass Dispel frees the rooted group."
            : "Cleanse frees one rooted player; continue the individual dispels."
          : "Rooted players wait for removal; the root naturally ends after ten seconds.";
      }
    }
    if (fight.id === "hyjal-anetheron") {
      if (sc.id === "swarm" && target) {
        const melee = sc.raid.filter((p) => p.kind === "melee");
        const aimed = melee[Math.floor(melee.length / 2)]?.id || target;
        const aim = cp(sc.baseById[aimed]),
          angle = Math.atan2(
            (aim.y - f.boss.y) / fight.aspect,
            aim.x - f.boss.x,
          );
        const hits = sc.raid
          .filter((p) => {
            const q = f.pos[p.id],
              a = Math.atan2((q.y - f.boss.y) / fight.aspect, q.x - f.boss.x);
            return (
              Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) <=
              Math.PI / 6
            );
          })
          .map((p) => p.id);
        f.effects.carrion = {
          targetId: aimed,
          coneAt: aim,
          active: t >= 500 && t < 1500,
          affectedIds: t >= 500 ? hits : [],
          healingDoneReduction: 0.75,
          healerIds: sc.healers.filter((id) => hits.includes(id)),
          penaltyActive: t >= 500,
        };
        hits.forEach((id) => {
          f.focus[id] = true;
          f.hp[id] = t >= 500 ? (healer ? 0.78 : 0.45) : 1;
        });
        f.call =
          "Swarm hits one direction. Unaffected healers cover tanks while affected healers have 75% reduced output.";
      }
      if (sc.id === "infernal" && target) {
        const spawn = sc.infernalStation || { x: 0.69, y: 0.12 },
          retreat = sc.baseById[target],
          tankAt = sc.baseById[sc.offTank] || spawn;
        move(f, target, sc.baseById[target], spawn, t / 3000);
        if (t >= 5500) move(f, target, spawn, retreat, (t - 5500) / 3500);
        if (sc.offTank && t >= 3500)
          move(
            f,
            sc.offTank,
            sc.baseById[sc.offTank],
            tankAt,
            (t - 3500) / 1500,
          );
        const picked = !!sc.offTank && t >= 5000;
        if (t >= 3500)
          f.adds.push({
            id: "infernal",
            at: cp(spawn),
            targetId: picked ? sc.offTank : null,
            tauntable: false,
            threatPickup: picked,
            radiusYards: 15,
          });
        f.effects.infernal = {
          targetId: target,
          spawnAt: spawn,
          offTankId: sc.offTank,
          isolated: sc.raid
            .filter((p) => p.id !== target && p.id !== sc.offTank)
            .every((p) => dist(fight, spawn, f.pos[p.id]) > 15),
          stunned: t >= 3500 && t < 5500,
          targetRetreating: t >= 5500,
        };
        f.focus[target] = true;
        if (sc.offTank) f.focus[sc.offTank] = true;
        f.call = picked
          ? "Infernal tank has threat; the target leaves after the landing stun."
          : "Target runs toward the off-tank, stops short, and keeps the impact away from the raid.";
      }
      if (sc.id === "sleep") {
        const ids = sc.raid
          .filter((p) => p.kind !== "tank")
          .slice(0, 3)
          .map((p) => p.id);
        f.effects.sleep = {
          targetIds: ids,
          active: t < 10000,
          durationSeconds: 10,
        };
        ids.forEach((id) => {
          f.focus[id] = true;
          if (t < 10000) f.roles[id] = "Asleep";
        });
      }
    }
    if (fight.id === "hyjal-kazrogal") {
      if (sc.id === "mark" && sc.manaUser) {
        const elapsed = clamp((t - 1000) / 5000),
          mana = Math.max(0, 2800 - Math.floor(elapsed * 5) * 600),
          exit = { x: 0.33, y: 0.38 };
        if (t >= 1500)
          move(
            f,
            sc.manaUser.id,
            sc.baseById[sc.manaUser.id],
            exit,
            (t - 1500) / 4200,
          );
        const exploding = t >= 6000;
        f.effects.mark = {
          targetId: sc.manaUser.id,
          manaStart: 2800,
          mana,
          drains: Math.floor(elapsed * 5),
          exploding,
          isolated:
            exploding &&
            sc.raid
              .filter((p) => p.id !== sc.manaUser.id)
              .every(
                (p) => dist(fight, f.pos[p.id], f.pos[sc.manaUser.id]) > 15,
              ),
        };
        f.focus[sc.manaUser.id] = true;
        if (exploding) f.hp[sc.manaUser.id] = 0.2;
        f.call = exploding
          ? "The fifth drain cannot take 600 mana: the isolated player detonates away from the raid."
          : "Mark drains 600 mana each second for five ticks; use resources before the final drain.";
      }
      if (sc.id === "stomp") {
        f.effects.stomp = {
          radiusYards: 15,
          at: cp(f.boss),
          affectedIds: sc.raid
            .filter((p) => dist(fight, f.pos[p.id], f.boss) < 15)
            .map((p) => p.id),
          active: t >= 3500 && t < 8500,
        };
      }
    }
    if (fight.id === "hyjal-azgalor") {
      if (sc.id === "rain") {
        const h = {
          x: sc.bossAt.x - 0.035,
          y: sc.bossAt.y - 0.07,
          yards: 15,
          kind: "Rain of Fire",
        };
        const affected = sc.raid
          .filter((p) => dist(fight, sc.baseById[p.id], h) < 15)
          .map((p) => p.id);
        const k = clamp((t - 700) / 5000),
          shift = 0.085;
        f.hazards.push(h);
        sc.raid
          .filter((p) => p.id !== sc.offTank)
          .forEach((p) => {
            const start = sc.baseById[p.id];
            if (p.kind === "ranged" || p.kind === "healer") {
              const futureBoss = { x: sc.bossAt.x + shift, y: sc.bossAt.y };
              const futureTank = sc.primaryTank
                ? {
                    x: sc.baseById[sc.primaryTank].x + shift,
                    y: sc.baseById[sc.primaryTank].y,
                  }
                : futureBoss;
              const bossDistance = dist(fight, start, futureBoss),
                healingDistance = dist(fight, start, futureTank);
              const practical =
                p.kind === "healer"
                  ? healingDistance <= 40
                  : bossDistance <= 40;
              const avoidsRain =
                bossDistance > 30 ||
                (cls(p) === "PRIEST" &&
                  p.kind === "ranged" &&
                  bossDistance <= 24);
              if (!affected.includes(p.id) && practical && avoidsRain) return;
              const peers = sc.raid.filter((q) => q.kind === p.kind),
                index = peers.indexOf(p);
              const angle =
                ((-112 + (84 * index) / Math.max(1, peers.length - 1)) *
                  Math.PI) /
                180;
              const radius =
                p.kind === "healer" ? 31 : cls(p) === "PRIEST" ? 24 : 37;
              const end = inside(fight, {
                x: sc.bossAt.x + shift + Math.cos(angle) * radius * fight.yard,
                y:
                  sc.bossAt.y +
                  Math.sin(angle) * radius * fight.yard * fight.aspect,
              });
              // Clear the northern edge before moving east; a straight translation
              // would carry the western ranged/healer slots through the Rain patch.
              const corner = { x: start.x, y: end.y },
                d1 = dist(fight, start, corner),
                d2 = dist(fight, corner, end),
                progress = clamp((t - 700) / 6500),
                split = d1 / (d1 + d2 || 1);
              if (progress < split)
                move(f, p.id, start, corner, progress / split);
              else
                move(
                  f,
                  p.id,
                  corner,
                  end,
                  (progress - split) / (1 - split || 1),
                );
            } else
              move(
                f,
                p.id,
                start,
                inside(fight, { x: start.x + shift, y: start.y }),
                k,
              );
          });
        if (sc.primaryTank)
          f.boss = { x: sc.bossAt.x + shift * k, y: sc.bossAt.y };
        f.effects.rain = {
          active: true,
          withinBoss30: dist(fight, h, sc.bossAt) <= 30,
          dotPersists: t >= 5700,
          targetIds: affected,
        };
        affected.forEach((id) => {
          f.focus[id] = true;
          f.hp[id] = healer ? 0.72 : 0.45;
        });
        f.call =
          t < 5700
            ? "Rain lands within 30 yards: tank and melee move together onto clear ground."
            : "The raid left the 15-yard Rain patch; heal the burn that persists after contact.";
      }
      if (sc.id === "howl") {
        f.effects.howl = {
          active: t < 5000,
          seconds: 5,
          healerIds: sc.healers,
        };
        f.call =
          "Keep tank HoTs active at all times; refresh before the 5-second Howl silence, then resume direct healing.";
      }
      if (sc.id === "doom" && target) {
        const lane = { x: 0.575, y: 0.1 },
          dead = t >= 20000;
        move(f, target, sc.baseById[target], lane, t / 14000);
        if (sc.offTank && dead)
          move(
            f,
            sc.offTank,
            sc.baseById[sc.offTank],
            { x: 0.55, y: 0.12 },
            (t - 20000) / 1300,
          );
        const revived = dead && !!sc.offTank && !!sc.warlock && t >= 23000;
        f.hp[target] = revived ? 0.6 : dead ? 0 : 1;
        f.effects.doom = {
          targetId: target,
          remainingSeconds: Math.max(0, Math.ceil((20000 - t) / 1000)),
          dead,
          revived,
          soulstoneAvailable: !!sc.warlock,
        };
        if (revived)
          move(f, target, lane, sc.baseById[target], (t - 23000) / 12000);
        if (dead)
          f.adds.push({
            id: "doomguard",
            at: lane,
            targetId: sc.offTank && t >= 21300 ? sc.offTank : null,
            threatPickup: !!sc.offTank && t >= 21300,
            isolatedLane: true,
            radiusYards: 10,
          });
        f.call = dead
          ? sc.offTank
            ? t < 21300
              ? "Doomguard spawns; the off-tank moves to pick it up."
              : revived
                ? "Doomguard controlled. The Soulstone target returns after resurrection."
                : "Doomguard controlled at the Tauren tents; use the assigned Soulstone after pickup."
            : "Doomguard has no off-tank pickup."
          : "Doom is lethal in 20 seconds: move to the northern Tauren tents.";
      }
    }
    if (fight.id === "hyjal-archimonde") {
      if (sc.id === "tears")
        f.effects.tears = {
          assumedCollected: true,
          ready: sc.hasTears,
          used: false,
        };
      if (sc.id === "airburst" && target) {
        const loft = t < 4400,
          descent = t >= 4400 && t < 5700,
          landing = cp(sc.baseById[target]);
        if (descent || t >= 5700)
          move(f, target, sc.baseById[target], landing, (t - 4400) / 1300);
        f.effects.airburst = {
          targetId: target,
          targetIds: sc.raid
            .filter(
              (p) =>
                p.id !== sc.primaryTank &&
                dist(fight, sc.baseById[p.id], sc.baseById[target]) <= 13,
            )
            .map((p) => p.id),
          splashYards: 13,
          lofted: loft,
          descent,
          height: loft
            ? clamp(t / 1000)
            : descent
              ? clamp((5700 - t) / 1300)
              : 0,
          tearsUsed: sc.hasTears && descent,
          safeLanding: sc.hasTears && t >= 5700,
        };
        f.focus[target] = true;
        f.call = loft
          ? "Air Burst lofts the target. Save Tears for descent."
          : descent
            ? "Descending now: use Tears before impact."
            : f.effects.airburst.safeLanding
              ? "Tears absorbed the fall; rejoin a clear group slot."
              : "Watch the Air Burst target; keep Tears ready for the descent.";
      }
      if (sc.id === "doomfire") {
        const plan = sc.doomfirePlan,
          trail = fireTrail(plan, t),
          head = trail.at(-1);
        f.hazards = trail.map((p) => ({ ...p, yards: 4, kind: "Doomfire" }));
        plan.members.forEach((id) => {
          const start = sc.baseById[id],
            to = { x: start.x + plan.shift.x, y: start.y + plan.shift.y };
          if (plan.clearance > 0) move(f, id, start, to, (t - 250) / 3500);
          f.focus[id] = true;
        });
        f.effects.doomfire = {
          at: head,
          trail,
          dotSeconds: 45,
          groupId: plan.groupId,
          movingIds: plan.members,
          clearRoute: plan.clearance > 0,
        };
        f.call =
          plan.clearance <= 0
            ? "These saved positions leave a fire conflict: adjust the party's escape lane before the pull."
            : t < 3750
              ? "Group " +
                plan.groupId +
                ": step sideways together as the flame approaches. Keep the tank and melee in place while their ground is clear."
              : "The flame has moved on, but its trail still burns. Stay in the clear party position; never cross back through the fire.";
      }
      if (sc.id === "fear" && target) {
        const from = sc.baseById[target],
          // Keep the teaching fire out of every saved player position, then
          // show the target leaving it while they still have control.
          escape = sc.fearEscape,
          fire = escape.fire;
        const support = sc.raid.find(
          (p) =>
            cls(p) === "SHAMAN" &&
            p.group === sc.target.group &&
            dist(fight, sc.baseById[p.id], from) < 30,
        )?.id;
        const fearAt = 2000,
          brokenAt = fearAt + 1500;
        const fireHazard = { ...fire, yards: 4, kind: "Doomfire" };
        move(f, target, from, escape.to, t / 1400);
        f.hazards.push(fireHazard);
        f.effects.fear = {
          active: t >= fearAt && t < fearAt + 8000,
          seconds: 8,
          startsAt: fearAt,
          shamanId: support || null,
          covered: false,
          exampleGroupCovered: !!support,
          broken: !!support && t >= brokenAt,
          targetId: target,
          fire: fireHazard,
        };
        f.focus[target] = true;
        f.call =
          t < fearAt
            ? "Doomfire is nearby: move clear while you still control your character."
            : support
              ? "Tremor restores this group's control; they were already clear of Doomfire."
              : "No nearby Tremor support: stay clear before Fear begins; this group remains uncontrolled.";
      }
      if (sc.id === "curse") {
        const removed = !!sc.decurser && t >= 1000;
        f.effects.curse = {
          targetId: target,
          active: !removed,
          decurserId: sc.decurser,
          decursed: removed,
        };
        if (target) f.focus[target] = true;
        f.call = removed
          ? "Grip is decursed."
          : "Grip remains: a Mage or Druid decurser is required.";
      }
      if (sc.id === "soulcharge" && target) {
        f.hp[target] = 0;
        f.effects.soulcharge = {
          deadId: target,
          raidHit: 4500,
          classEffect: ["PRIEST", "MAGE", "WARLOCK"].includes(cls(sc.target))
            ? "6s silence"
            : ["WARRIOR", "ROGUE", "PALADIN"].includes(cls(sc.target))
              ? "+50% damage taken"
              : ["DRUID", "SHAMAN", "HUNTER"].includes(cls(sc.target))
                ? "4500 Nature DoT + 2250 mana drain"
                : "Class effect depends on the fallen player",
        };
        sc.raid
          .filter((p) => p.id !== target)
          .forEach((p) => (f.hp[p.id] = healer ? 0.72 : 0.48));
        f.call =
          "Soul Charge hits the raid for 4500 and triggers the fallen class group effect.";
      }
    }
    if (sc.id === "finish") {
      const ready =
        !!sc.primaryTank && !!sc.healers.length && !!sc.damage.length;
      f.bossHp =
        fight.id === "hyjal-archimonde" ? 0.12 : 0.15 * (1 - clamp(t / 10000));
      if (fight.id !== "hyjal-archimonde" && ready && t >= 10000) {
        f.stage = "complete";
        f.bossVisible = false;
        f.roles = {};
        f.focus = {};
        f.instructionRows = [];
        f.effects = {};
        f.call = fight.name + " defeated.";
      }
      if (fight.id === "hyjal-archimonde" && ready && t >= 3000) {
        f.stage = t >= 10000 ? "complete" : "wisps";
        f.roles = {};
        f.focus = {};
        f.instructionRows = [
          ["Raid", "Protected by Elune: let the Wisps finish."],
        ];
        f.bossHp = 0.1 * (1 - clamp((t - 3000) / 7000));
        f.effects.wisps = {
          protected: true,
          progress: clamp((t - 3000) / 7000),
        };
        f.call =
          t >= 10000
            ? "Archimonde defeated. The World Tree is safe."
            : "At 10% the raid receives protection. Let the Wisps finish Archimonde.";
        if (t >= 10000) {
          f.bossVisible = false;
          f.roles = {};
          f.focus = {};
          f.instructionRows = [];
        }
      }
      if (!ready) {
        f.bossHp = 0.15;
        f.call = "Coverage is incomplete; the finish is not demonstrated.";
      }
    }
    return f;
  }
  function copyText(fight, sc, f) {
    return [
      fight.name + " — illustrative assignments",
      ...sc.raid
        .filter((p) => p.name)
        .map((p) => p.name + " — " + (f.roles[p.id] || p.kind)),
      ...sc.missingRoles,
    ].join("\n");
  }
  function resolveExplanation(e, sc) {
    if (!e) return e;
    let message = "";
    if (sc.id === "positioning" && sc.groupCoverageMissing?.length)
      message =
        "Party Tremor coverage is incomplete. Adjust the group assignments.";
    if (
      sc.tankHealers &&
      sc.tankHealers.length < 2 &&
      ["positioning", "swarm"].includes(sc.id)
    )
      message =
        "Opposite-side tank healing is incomplete: two healers are required.";
    if (sc.id === "nova" && !sc.dispeller)
      message =
        "Frost Nova removal is missing: no Priest or Paladin is loaded.";
    if (sc.id === "curse" && !sc.decurser)
      message = "Grip decurse is missing: no Mage or Druid is loaded.";
    if (["infernal", "doom"].includes(sc.id) && !sc.offTank)
      message = "Off-tank pickup is missing for this add.";
    if (sc.id === "doom" && !sc.warlock && sc.offTank)
      message =
        "Soulstone coverage is missing; the Doom target remains dead after pickup.";
    if (sc.id === "icebolt" && !sc.healers.length)
      message = "Icebolt healing coverage is missing.";
    if (
      ["positioning", "cleave"].includes(sc.id) &&
      sc.missingRoles.some((x) => x.includes("Malevolent Cleave"))
    )
      message =
        "Cleave stack incomplete: " + sc.tanks.length + " of 3 tanks loaded.";
    if (sc.id === "mark" && !sc.manaUser)
      message = "No mana-user target is loaded for the Mark example.";
    if (sc.id === "doomfire" && sc.doomfirePlan?.clearance <= 0)
      message = "Doomfire escape lane is blocked. Adjust party positions.";
    if (sc.id === "fear" && !sc.shaman)
      message = "Tremor coverage is missing; assign available fear protection.";
    if (
      sc.id === "finish" &&
      (!sc.primaryTank || !sc.healers.length || !sc.damage.length)
    )
      message =
        "Finish coverage is missing: tank, healer and damage roles are required.";
    if (
      ["infernal", "doom", "icebolt", "airburst", "curse", "swarm"].includes(
        sc.id,
      ) &&
      !sc.target
    )
      message = "No eligible target is loaded for this example.";
    if (
      sc.id === "nova" &&
      sc.dispeller &&
      !sc.raid.some((p) => cls(p) === "PRIEST") &&
      e.id !== "root"
    )
      return {
        ...e,
        title: "Cleanse one root, then continue individual dispels.",
        detail:
          "No Priest is loaded for Mass Dispel. Other affected players remain rooted until their own removal or natural expiry.",
      };
    return message
      ? {
          ...e,
          title: message,
          detail:
            sc.missingRoles.join(" ") ||
            "Load the required raid roles to demonstrate this action.",
        }
      : e;
  }
  return { prepareScene, simulate, copyText, resolveExplanation };
});
