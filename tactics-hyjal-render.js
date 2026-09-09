(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TacticsHyjalRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function ring(ctx, p, r, tone, fill = "transparent") {
    ctx.save();
    ctx.strokeStyle = tone;
    ctx.fillStyle = fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function line(ctx, a, b, tone) {
    ctx.save();
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
  function draw(layer, api, scene, frame) {
    const { ctx, px, yd } = api,
      e = frame.effects || {};
    const area = api.action || { x: 0, y: 0, w: api.width, h: api.height };
    const occupied = [];
    function label(point, text, tone = "#cde7da") {
      ctx.save();
      ctx.font = '600 16px "Barlow Condensed", sans-serif';
      ctx.textAlign = "center";
      const w = Math.min(area.w - 12, ctx.measureText(text).width + 16);
      const x = Math.max(
        area.x + w / 2 + 4,
        Math.min(area.x + area.w - w / 2 - 4, point.x),
      );
      let y = Math.max(area.y + 22, Math.min(area.y + area.h - 9, point.y));
      for (
        let i = 0;
        i < 5 &&
        occupied.some(
          (b) =>
            Math.abs(b.x - x) < (b.w + w) / 2 + 4 && Math.abs(b.y - y) < 26,
        );
        i++
      )
        y = Math.max(area.y + 22, y - 28);
      occupied.push({ x, y, w });
      ctx.fillStyle = "rgba(7,13,10,.94)";
      ctx.fillRect(x - w / 2, y - 18, w, 25);
      ctx.fillStyle = tone;
      ctx.fillText(text, x, y, w - 10);
      ctx.restore();
    }
    const panel = (text, tone) =>
      label({ x: area.x + area.w / 2, y: area.y + 28 }, text, tone);
    if (frame.stage === "complete") return;
    if (layer === "floor") {
      if (scene.id === "positioning" && scene.positioningGuide?.rainRange)
        ring(ctx, px(frame.boss), yd(30), "#90b8c6", "rgba(125,176,195,.07)");
      if (e.doomfire) {
        const trail = e.doomfire.trail.map(px);
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Dark burned ground, orange flame edges, and a hot core make the
        // advancing head distinct from the persistent dangerous trail.
        for (const [width, color] of [
          [12, "rgba(68,23,13,.9)"],
          [10, "rgba(214,69,15,.8)"],
          [6, "rgba(255,133,24,.9)"],
          [2, "#ffd071"],
        ]) {
          ctx.lineWidth = yd(width);
          ctx.strokeStyle = color;
          ctx.beginPath();
          trail.forEach((q, i) =>
            i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y),
          );
          ctx.stroke();
        }
        trail.forEach((q, i) => {
          if (i % 3) return;
          const flicker = (Math.sin(frame.timeMs / 160 + i * 2) + 1) / 2;
          const r = yd(2 + flicker);
          ctx.fillStyle = i > trail.length - 5 ? "#fff0ad" : "#ffc34a";
          ctx.beginPath();
          ctx.moveTo(q.x - r, q.y + r / 2);
          ctx.quadraticCurveTo(
            q.x - r / 2,
            q.y - r,
            q.x + r / 3,
            q.y - r * 2.1,
          );
          ctx.quadraticCurveTo(q.x + r, q.y, q.x + r, q.y + r / 2);
          ctx.closePath();
          ctx.fill();
        });
        const head = px(e.doomfire.at);
        ring(ctx, head, yd(5), "#ffe3a1", "rgba(255,189,66,.6)");
        if (trail.length > 1) {
          const previous = trail[Math.max(0, trail.length - 4)],
            angle = Math.atan2(head.y - previous.y, head.x - previous.x),
            r = yd(9);
          ctx.translate(head.x, head.y);
          ctx.rotate(angle);
          ctx.fillStyle = "#ffe4a5";
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.lineTo(r - 8, -6);
          ctx.lineTo(r - 8, 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      } else
        (frame.hazards || []).forEach((h) =>
          ring(ctx, px(h), yd(h.yards), "#f58d69", "rgba(228,95,44,.17)"),
        );
      (frame.routes || []).forEach((r) =>
        line(ctx, px(r.from), px(r.to), "#d6e9df"),
      );
      (frame.adds || []).forEach((a) => {
        if (a.radiusYards)
          ring(
            ctx,
            px(a.at),
            yd(a.radiusYards),
            "#eeaa70",
            "rgba(238,155,55,.08)",
          );
      });
      if (e.mark)
        ring(
          ctx,
          px(frame.pos[e.mark.targetId]),
          yd(15),
          e.mark.exploding ? "#f19f75" : "#bb95df",
          "rgba(189,114,221,.08)",
        );
      if (e.airburst)
        ring(
          ctx,
          px(scene.baseById[e.airburst.targetId]),
          yd(13),
          "#8fbfe5",
          "rgba(102,171,225,.07)",
        );
      if (e.carrion?.active) {
        const b = px(frame.boss),
          p = px(e.carrion.coneAt),
          angle = Math.atan2(p.y - b.y, p.x - b.x);
        ctx.save();
        ctx.fillStyle = "rgba(204,127,217,.24)";
        ctx.strokeStyle = "#d89be7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.arc(b.x, b.y, yd(40), angle - Math.PI / 6, angle + Math.PI / 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (e.stomp)
        ring(
          ctx,
          px(frame.boss),
          yd(15),
          "#dcad73",
          e.stomp.active ? "rgba(224,169,66,.18)" : "rgba(224,169,66,.04)",
        );
      if (e.wisps) {
        ring(ctx, px(frame.boss), yd(16), "#b7eaf4", "rgba(148,221,242,.12)");
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + e.wisps.progress * 4,
            b = px(frame.boss),
            r = yd(18) * (1 - e.wisps.progress * 0.6);
          ring(
            ctx,
            { x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r },
            4,
            "#e4ffff",
            "#bdeaff",
          );
        }
      }
      return;
    }
    if (scene.id === "positioning") {
      const isKazrogalFormation =
        !scene.positioningGuide?.rainRange &&
        scene.positioningGuide?.landmarks?.some(
          (item) => item.label === "Thrall",
        );
      const isAzgalorFormation = !!scene.positioningGuide?.rainRange;
      const groupLabelY = { left: -Infinity, right: -Infinity };
      (scene.groups || [])
        .slice()
        .sort((a, b) => a.at.y - b.at.y)
        .forEach((g) => {
          const side = g.at.x < frame.boss.x ? "left" : "right";
          const p = px(g.at || scene.baseById[g.members[0]]);
          const callout = {
            x: px({ x: g.at.x < frame.boss.x ? 0.2 : 0.86, y: g.at.y }).x,
            y: Math.max(
              p.y + (g.at.y < frame.boss.y ? -22 : 22),
              groupLabelY[side] + 32,
            ),
          };
          groupLabelY[side] = callout.y;
          line(ctx, p, { ...callout, y: callout.y - 6 }, "#76aa98");
          label(
            callout,
            "Group " + g.id + (g.shamans.length ? " · Tremor" : " · no Shaman"),
            "#9dccba",
          );
        });
      if (scene.tankHealers)
        scene.tankHealers.forEach((id, i) => {
          const p = px(frame.pos[id]);
          ring(ctx, p, yd(3), "#a4ebc5");
          label(
            { x: p.x, y: p.y + (i === 0 ? -25 : 35) },
            "Tank healer " + (i + 1),
            "#a4ebc5",
          );
        });
      if (isKazrogalFormation && scene.tanks?.length) {
        const stack = px(frame.pos[scene.tanks[0]]);
        label(
          { x: stack.x + yd(15), y: stack.y + yd(13) },
          Math.min(3, scene.tanks.length) + " / 3 tanks · Cleave stack",
          "#b6e9d0",
        );
      }
      if (isAzgalorFormation && scene.shadowPriests?.length) {
        scene.shadowPriests.forEach((id) =>
          ring(
            ctx,
            px(frame.pos[id]),
            Math.max(15, yd(4)),
            "#c7a8ec",
            "rgba(174,128,224,.12)",
          ),
        );
        const slot = px(frame.pos[scene.shadowPriests[0]]);
        const callout = { x: slot.x - yd(8), y: slot.y + yd(14) };
        line(ctx, slot, callout, "#c7a8ec");
        label(callout, "Shadow Priest · inside 30 yd", "#d8b2f4");
      }
    }
    if (scene.id === "positioning") {
      (scene.positioningGuide?.landmarks || []).forEach((item) =>
        label(px(item.at), item.label, "#dec6a2"),
      );
      if (scene.positioningGuide?.rainRange)
        label(
          { ...px(frame.boss), y: px(frame.boss).y + yd(30) + 22 },
          "30 yd · Rain targeting range",
          "#b1d2de",
        );
    }
    if (
      scene.positioningGuide?.doomDrop &&
      (scene.id === "positioning" || scene.id === "doom")
    ) {
      const p = px(scene.positioningGuide.doomDrop);
      ring(ctx, p, yd(4), "#dfb4ee", "rgba(155,102,185,.16)");
      label(
        { x: p.x, y: p.y - yd(5) - 12 },
        "Tauren tents · Doom drop",
        "#dfb4ee",
      );
    }
    if (e.dnd?.tankId && e.dnd?.healerId) {
      line(
        ctx,
        px(frame.pos[e.dnd.healerId]),
        px(frame.pos[e.dnd.tankId]),
        "#9fe0c4",
      );
      label(
        {
          ...px(frame.pos[e.dnd.tankId]),
          y: px(frame.pos[e.dnd.tankId]).y - 30,
        },
        "Tank holds · dedicated heals",
        "#b6e9d0",
      );
    }
    if (e.doomfire)
      label(
        { ...px(e.doomfire.at), y: px(e.doomfire.at).y - yd(7) - 12 },
        "Advancing flame · trail keeps burning",
        "#ffbf91",
      );
    else
      (frame.hazards || []).forEach((h) => {
        const p = px(h);
        label(
          { x: p.x, y: p.y - yd(h.yards) - 10 },
          h.kind + " · " + h.yards + " yd",
          "#ffbf91",
        );
      });
    if (e.cleave?.active && e.cleave.targetIds.length)
      ring(
        ctx,
        px(frame.pos[e.cleave.targetIds[0]]),
        Math.max(14, yd(3)),
        "#ffd17d",
        "rgba(255,197,97,.18)",
      );
    if (e.mark) {
      const p = px(frame.pos[e.mark.targetId]);
      label(
        { x: p.x, y: p.y - 26 },
        e.mark.exploding
          ? "Failed drain · explosion isolated"
          : e.mark.mana + " mana · leave before the failed tick",
        "#d8b2f4",
      );
    }
    if (e.icebolt) {
      const p = px(frame.pos[e.icebolt.targetId]);
      ring(ctx, p, Math.max(14, yd(3)), "#a7dcff", "rgba(81,167,230,.2)");
      if (e.icebolt.healing && e.icebolt.healerId)
        line(ctx, px(frame.pos[e.icebolt.healerId]), p, "#96e4ba");
      label(
        { x: p.x, y: p.y - 26 },
        e.icebolt.stunned
          ? "Icebolt · heal the frozen target"
          : "Icebolt ends · keep healing coverage",
        "#b7e8ff",
      );
    }
    if (e.nova) {
      e.nova.affectedIds.forEach((id) =>
        ring(
          ctx,
          px(frame.pos[id]),
          Math.max(12, yd(2)),
          e.nova.removedIds.includes(id) ? "#90e1bd" : "#a7dfff",
        ),
      );
      panel(
        e.nova.dispelled
          ? "Root removal · " + e.nova.removedIds.length + " players freed"
          : "Frost Nova · root until removed or expired",
        "#b7e8ff",
      );
    }
    if (e.airburst) {
      e.airburst.targetIds.forEach((id) => {
        const p = px(frame.pos[id]),
          lift = Math.min(yd(13), p.y - area.y - 38) * e.airburst.height;
        line(ctx, p, { x: p.x, y: p.y - lift }, "#a9ddff");
        ring(ctx, { x: p.x, y: p.y - lift }, Math.max(12, yd(2)), "#a9ddff");
      });
      panel(
        e.airburst.lofted
          ? "Air Burst · " +
              e.airburst.targetIds.length +
              " nearby players rise"
          : e.airburst.descent
            ? "Descending · use Tears before landing"
            : "Safe landing · Tears slowed the fall",
        "#a9ddff",
      );
    }
    if (e.carrion?.penaltyActive) {
      e.carrion.healerIds.forEach((id) =>
        ring(ctx, px(frame.pos[id]), Math.max(13, yd(2)), "#d89be7"),
      );
      panel(
        e.carrion.healerIds.length
          ? "Affected healers: −75% healing done · backups cover tanks"
          : "Swarm through melee · both tank healers stay clear",
        "#e7baef",
      );
    }
    if (e.sleep?.active) {
      e.sleep.targetIds.forEach((id) =>
        ring(ctx, px(frame.pos[id]), Math.max(13, yd(2)), "#b997dc"),
      );
      panel("Sleep · backups cover the missing players", "#c7a8ec");
    }
    if (e.howl)
      panel(
        e.howl.active
          ? "Howl · 5s silence · tank HoTs pre-applied"
          : "Silence ends · direct heals + refresh HoTs",
        "#ffbc9b",
      );
    if (e.fear)
      panel(
        e.fear.broken
          ? "Tremor helps this group · stop before the fire"
          : e.fear.active
            ? "Fear can push players into Doomfire"
            : "Fear ends · regain safe positions",
        "#f1c287",
      );
    if (e.curse && frame.pos[e.curse.targetId]) {
      const p = px(frame.pos[e.curse.targetId]);
      ring(
        ctx,
        p,
        Math.max(13, yd(3)),
        e.curse.decursed ? "#99e0b9" : "#d8a5ff",
      );
      if (e.curse.decursed)
        line(ctx, px(frame.pos[e.curse.decurserId]), p, "#99e0b9");
      label(
        { x: p.x, y: p.y - 26 },
        e.curse.decursed ? "Grip removed" : "Grip · decurse now",
        e.curse.decursed ? "#99e0b9" : "#d8a5ff",
      );
    }
    if (e.doom && !e.doom.dead) {
      const p = px(frame.pos[e.doom.targetId]);
      ring(ctx, p, Math.max(13, yd(3)), "#d6a1f0");
      label(
        { x: p.x, y: p.y - 25 },
        "Doom · " + e.doom.remainingSeconds + "s to death",
        "#d6a1f0",
      );
    }
    (frame.adds || []).forEach((add) => {
      const p = px(add.at);
      ring(ctx, p, Math.max(14, yd(3)), "#ffab73", "rgba(229,98,44,.25)");
      label(
        { x: p.x, y: p.y + yd(add.radiusYards || 3) + 25 },
        add.id === "infernal"
          ? add.threatPickup
            ? "Infernal · OT has threat"
            : "Infernal spawns · build threat"
          : add.threatPickup
            ? "Doomguard controlled · Tauren tents"
            : "Doomguard spawns · pickup",
        "#ffca9d",
      );
    });
    if (e.stomp) panel("15 yd · backline stays outside War Stomp", "#ffd2a7");
    if (e.soulcharge)
      panel("Soul Charge · " + e.soulcharge.classEffect, "#e9bcf4");
    if (e.wisps)
      panel("Protection of Elune · Wisps finish the encounter", "#c3f2ff");
  }
  return { draw };
});
