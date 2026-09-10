'use strict';
/* Role-aware, evidence-only coaching for TBC logs.  See docs/evaluation-mechanics-sources.md. */
const { resolveSpec } = require('./evaluation-specs');

const n = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const round = value => n(value) === null ? null : Math.round(value * 10) / 10;
const body = table => table && table.data && !Array.isArray(table.data) ? table.data : table;
const entries = table => Array.isArray(body(table)?.entries) ? body(table).entries : [];
const auras = table => Array.isArray(body(table)?.auras) ? body(table).auras : [];
const spellId = row => Number(row && (row.abilityGameID ?? row.guid ?? row.ability?.guid ?? row.ability));
const sum = (rows, field) => rows.reduce((total, row) => total + (n(row[field]) || 0), 0);
const ids = value => new Set((value instanceof Set ? [...value] : Array.isArray(value) ? value : [value]).map(Number).filter(Number.isFinite));
const mechanicIds = (mechanic, field) => ids(mechanic[field + 'Ids'] || mechanic[field]);
const canonical = value => String(value || '').replace(/[^a-z]/gi, '').toLowerCase();
function fightOf(raw) { return (raw.context?.fights || []).find(f => f.id === raw.fightId) || raw.context?.fights?.[0] || {}; }
function durationOf(raw, fight) { const duration = (fight.endTime - fight.startTime) / 1000; return duration > 0 ? duration : null; }
function urlOf(raw) { return raw.reportCode && raw.fightId != null && raw.sourceId != null ? 'https://classic.warcraftlogs.com/reports/' + encodeURIComponent(raw.reportCode) + '#fight=' + encodeURIComponent(raw.fightId) + '&source=' + encodeURIComponent(raw.sourceId) : undefined; }
function rowFor(table, raw) {
  return entries(table).find(row => row.id === raw.sourceId || row.sourceID === raw.sourceId || (!raw.sourceId && row.name === raw.player?.name));
}
function metricOf(raw, role, duration) {
  const requested = raw.player?.metric || (role === 'healer' ? 'hps' : role === 'tank' ? 'dtps' : 'dps');
  const table = requested === 'hps' ? raw.context?.healAll : requested === 'dtps' ? raw.context?.damageTaken : raw.context?.dmgAll;
  const row = rowFor(table, raw);
  // DamageTaken is fetched per player, not as a raid aggregate. Its rows are abilities, so
  // sum their totals when no context aggregate exists instead of hiding a valid DTPS value.
    // WCL DamageTaken `total` includes absorbed damage while `totalReduced` is health damage.
    // DTPS here means damage that reached the player, matching the event-window `amount` sums.
    const taken = value => n(value?.totalReduced) ?? n(value?.total);
    const detailRows = entries(raw.tables?.damageTaken);
    const detail = requested === 'dtps' && detailRows.length ? detailRows.reduce((total, value) => total + (taken(value) || 0), 0) : null;
    const total = requested === 'hps' ? (n(row?.effectiveHealing) ?? n(row?.total)) : requested === 'dtps' ? (taken(row) ?? detail) : n(row?.total);
  return { metric: requested === 'hps' ? 'hps' : requested === 'dtps' ? 'dtps' : 'dps', value: duration && total !== null ? total / duration : null, total, row };
}
function describe(raw, role) {
  const fight = fightOf(raw), duration = durationOf(raw, fight), metric = metricOf(raw, role, duration);
  return { raw, fight, duration, ...metric, name: raw.player?.name || raw.name || metric.row?.name || 'Player', url: urlOf(raw) };
}
function intervals(aurasRows, id, info) {
  if (!info.duration) return [];
  return aurasRows.filter(row => spellId(row) === id).flatMap(row => Array.isArray(row.bands) ? row.bands.map(b => [
    Math.max(0, (b.startTime - info.fight.startTime) / 1000), Math.min(info.duration, (b.endTime - info.fight.startTime) / 1000)
  ]).filter(b => b[1] > b[0]) : []);
}
function merge(input) {
  const result = [];
  input.slice().sort((a, b) => a[0] - b[0]).forEach(interval => {
    const last = result[result.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else result.push(interval.slice());
  });
  return result;
}
function length(input) { return merge(input).reduce((total, interval) => total + interval[1] - interval[0], 0); }
function coverageByTarget(bands, duration) {
  if (!duration) return [];
  const grouped = new Map();
  for (const band of bands) {
    const intervals = grouped.get(band.target) || [];
    intervals.push(band.interval); grouped.set(band.target, intervals);
  }
  return [...grouped].map(([target, intervals]) => ({ target, coverage: 100 * length(intervals) / duration })).sort((a, b) => b.coverage - a.coverage);
}
function uptimeFrom(table, wanted, info) {
  const spellIds = ids(wanted);
  const rows = auras(table).filter(row => spellIds.has(spellId(row)));
  if (!Array.isArray(body(table)?.auras) || !info.duration) return null;
  if (!rows.length) return 0;
  if (rows.every(row => Array.isArray(row.bands))) return 100 * length([...spellIds].flatMap(id => intervals(rows, id, info))) / info.duration;
  if (rows.length === 1 && n(rows[0].totalUptime) !== null) return 100 * rows[0].totalUptime / (info.duration * 1000);
  return null;
}
function uptime(raw, wanted, info) { return uptimeFrom(raw.tables?.buffs, wanted, info); }
function effectUptime(raw, mechanic, info) {
  // Player auras can be read from the buff table. Target DoTs and HoTs are reconstructed from
  // attributed outgoing events in analyzeRole, so a self-buff row is never substituted for them.
  if (!['dot', 'hot', 'target-debuff', 'target-buff'].includes(mechanic.kind)) return uptime(raw, mechanicIds(mechanic, 'aura'), info);
  // Retain the table fallback for direct callers, but target-effect coverage normally bypasses it.
  return Array.isArray(body(raw.tables?.debuffs)?.auras) ? uptimeFrom(raw.tables?.debuffs, mechanicIds(mechanic, 'aura'), info) : null;
}
const tableRows = table => entries(table).concat(auras(table));
function attempts(table, wanted, source) {
  const spellIds = ids(wanted);
  const rows = entries(table).filter(row => spellIds.has(spellId(row)));
  if (!rows.length) return null;
  if (source === 'casts') return { count: sum(rows, 'total'), source, rows };
  // Damage/healing table totals are amounts, never button presses. Counts below are logged
  // hit/heal records only and are labelled that way at the call site.
  const landed = sum(rows, 'hitCount') + sum(rows, 'missCount');
  return landed ? { count: landed, source, rows } : null;
}
function eventSec(event, info) { return info.duration && n(event.timestamp) !== null ? (event.timestamp - info.fight.startTime) / 1000 : null; }
function eventAmount(event) { return n(event.amount) ?? n(event.unmitigatedAmount) ?? 0; }
function eventsFor(stream, predicate) { return stream?.complete && Array.isArray(stream.data) ? stream.data.filter(predicate) : null; }
function targetIds(raw) { return new Set((raw.context?.masterData?.actors || raw.context?.masterData?.data?.actors || []).filter(a => a.petOwner === raw.sourceId || a.ownerID === raw.sourceId).map(a => a.id)); }
function deathsOf(raw) {
  const deaths = raw.context?.deaths;
  if (Array.isArray(deaths)) return deaths;
  // WCL's Deaths table is a JSON wrapper; retain only real death-event records rather than
  // treating the wrapper as an iterable array.
  return Array.isArray(deaths?.data?.entries) ? deaths.data.entries : Array.isArray(deaths?.data) ? deaths.data : [];
}
function spellEvents(raw, wanted, info) {
  const spellIds = ids(wanted);
  const stream = eventsFor(raw.events, event => event.sourceID === raw.sourceId && spellIds.has(spellId(event)));
  return stream === null ? null : stream.map(event => eventSec(event, info)).filter(time => time !== null).sort((a, b) => a - b);
}
function attributedEffectBands(raw, wanted, info, kind) {
  if (!raw.events?.complete || !info.duration) return null;
  const spellIds = ids(wanted);
  const friendly = kind === 'hot' || kind === 'target-buff';
  const add = friendly ? new Set(['applybuff', 'refreshbuff']) : new Set(['applydebuff', 'refreshdebuff']);
  const remove = friendly ? 'removebuff' : 'removedebuff';
  const open = new Map(), result = [];
  const events = (raw.events.data || []).filter(event => event.sourceID === raw.sourceId && event.targetID != null && spellIds.has(spellId(event)) &&
    (add.has(event.type) || event.type === remove)).sort((a, b) => a.timestamp - b.timestamp);
  for (const event of events) {
    const at = eventSec(event, info);
    if (at === null) continue;
    const target = event.targetID;
    if (add.has(event.type)) {
      // A refresh can be the first event retained in a partial-prepull log. It establishes
      // presence from this timestamp forward, never invents a start at the pull.
      if (!open.has(target)) open.set(target, at);
    } else if (open.has(target)) {
      result.push({ target, interval: [open.get(target), at] }); open.delete(target);
    }
  }
  // A complete outgoing stream establishes that this player's last observed application had
  // not been removed before the fight ended; it does not claim anything before its first event.
  for (const [target, start] of open) result.push({ target, interval: [start, info.duration] });
  return result;
}
function targetLabel(raw, target) {
  const actor = (raw.context?.masterData?.actors || []).find(item => item.id === target);
  return actor?.name || 'target ' + target;
}

function analyzeRole(raw = {}) {
  const spec = resolveSpec(raw.player || {});
  const role = spec?.role || raw.player?.role || 'caster';
  const info = describe(raw, role), findings = [], comparison = [], timeline = [], limitations = [], checks = [];
  const evidence = (text, startSec, endSec) => ({ text, ...(n(startSec) !== null ? { startSec: round(startSec) } : {}), ...(n(endSec) !== null ? { endSec: round(endSec) } : {}), ...(info.url ? { url: info.url } : {}) });
  const add = (id, title, owner, action, records, confidence = 'observed', impact) => findings.push({ id, title, owner, action, evidence: records, confidence, gainDps: null, ...(impact ? { impact } : {}) });
  const check = (id, label, status, reason) => checks.push({ id, label, status, ...(reason ? { reason } : {}) });
  const compare = (name, player, reference, unit, note) => comparison.push({ name, player: round(player), reference: round(reference), unit, ...(note ? { note } : {}) });

  if (!spec) {
    limitations.push('The declared class/spec is not in the TBC assignment catalog, so no spec-specific telemetry is interpreted.');
    return { comparison, findings, timeline, limitations, coverage: { spec: null, role, checks } };
  }
  if (!info.duration) limitations.push('Fight timestamps are missing or invalid; rates and timing windows cannot be calculated.');
  const references = (raw.references || []).map(reference => describe(reference, role)).filter(reference =>
    reference.duration && reference.value !== null && canonical(reference.raw.player?.classToken || reference.raw.player?.class) === canonical(spec.classToken) && canonical(reference.raw.player?.spec) === canonical(spec.spec)
  ).sort((a, b) => Math.abs(a.duration - (info.duration || 0)) - Math.abs(b.duration - (info.duration || 0)));
  const benchmark = references.filter(candidate => candidate.raw.kind === 'benchmark');
  const raidPeers = references.filter(candidate => candidate.raw.kind === 'raid' || !candidate.raw.kind);
  // A DPS benchmark is preferred when it is duration-comparable; healer/tank rate is context,
  // never a success grade, so retain same-pull peers only as named assignment evidence.
  const reference = role === 'healer' || role === 'tank' ? null : (benchmark[0] || raidPeers[0] || null);
  const raidPeer = raidPeers.find(candidate => candidate !== reference) || (role === 'healer' || role === 'tank' ? raidPeers[0] : null);
  if (info.value !== null && role !== 'healer' && role !== 'tank') compare(info.metric.toUpperCase(), info.value, reference?.value, info.metric.toUpperCase(), reference ? 'Same declared class and spec; pull length, assignment, gear and support still differ.' : 'No compatible reference was supplied.');
  if (reference) add('reference-context', 'DPS comparison uses a same-spec ' + (reference.raw.kind === 'benchmark' ? 'benchmark' : 'raid pull'), 'context', 'Compare assignments, uptime and raid support before interpreting a DPS difference as recoverable.', [evidence(info.name + ': ' + round(info.value) + ' DPS over ' + round(info.duration) + ' seconds.'), { text: reference.name + ': ' + round(reference.value) + ' DPS over ' + round(reference.duration) + ' seconds.', ...(reference.url ? { url: reference.url } : {}) }]);
  else if (role !== 'healer' && role !== 'tank') limitations.push('No compatible named same-spec reference with valid timing was supplied.');
  if (raidPeer) add('raid-peer-context', 'Named same-pull peer provides assignment context', 'context', role === 'healer' || role === 'tank' ? 'Review assignments, incoming damage and support around both players. This is context only; healer and tank rates are not graded.' : 'Review target access, assignments and support around both players before interpreting their output difference.', [{ text: raidPeer.name + ': ' + round(raidPeer.value) + ' ' + raidPeer.metric.toUpperCase() + ' over ' + round(raidPeer.duration) + ' seconds.', ...(raidPeer.url ? { url: raidPeer.url } : {}) }]);

  // Every declared spec gets evidence for its real spells. A zero in a table establishes a
  // count, not that the spell was talented, affordable, or appropriate for this encounter.
  for (const mechanic of spec.mechanics) {
    const spellIds = mechanicIds(mechanic, 'spell'), auraIds = mechanicIds(mechanic, 'aura');
    const castInfo = attempts(raw.tables?.casts, spellIds, 'casts');
    const activityInfo = castInfo || attempts(raw.tables?.dmg, spellIds, 'damage') || attempts(raw.tables?.healing, spellIds, 'healing');
    const times = spellEvents(raw, spellIds, info);
    const targetEffect = ['dot', 'hot', 'target-debuff', 'target-buff'].includes(mechanic.kind);
    const effectBands = targetEffect ? attributedEffectBands(raw, auraIds, info, mechanic.kind) : null;
    const auraCoverage = targetEffect ? (effectBands === null ? null : (info.duration ? 100 * length(effectBands.map(band => band.interval)) / info.duration : null)) : (mechanic.aura ? effectUptime(raw, mechanic, info) : null);
    if (targetEffect || mechanic.kind === 'aura') {
      const coverageLabel = mechanic.label + (targetEffect ? ' any-recorded-target coverage' : ' coverage');
      if (auraCoverage === null) check(mechanic.id, coverageLabel, 'unknown', targetEffect ? 'A complete attributed outgoing effect stream is unavailable.' : 'The buff response has no usable aura bands.');
      else {
        check(mechanic.id, coverageLabel, 'checked', round(auraCoverage) + '% recorded.' + (mechanic.coverageContext ? ' ' + mechanic.coverageContext : ''));
        const refBands = targetEffect ? attributedEffectBands(reference?.raw || {}, auraIds, reference || {}, mechanic.kind) : null;
        const refCoverage = targetEffect ? (refBands === null || !reference?.duration ? null : 100 * length(refBands.map(band => band.interval)) / reference.duration) : (reference ? effectUptime(reference.raw, mechanic, reference) : null);
        compare(mechanic.label + (targetEffect ? ' any-recorded-target coverage' : ' coverage'), auraCoverage, refCoverage, '%', mechanic.coverageContext);
        const bands = targetEffect ? effectBands : [...auraIds].flatMap(id => intervals(auras(raw.tables?.buffs), id, info)).map(interval => ({ interval }));
        if (targetEffect) {
          const perTarget = coverageByTarget(bands, info.duration).slice(0, 5);
          perTarget.forEach(item => compare(mechanic.label + ' on ' + targetLabel(raw, item.target), item.coverage, null, '%', 'Per-target observed coverage; assignments and target need are not inferred.'));
          if ((mechanic.kind === 'hot' || mechanic.kind === 'target-buff') && role === 'healer' && perTarget.length) add('healing-targets-' + mechanic.id, mechanic.label + ' per-target coverage is recorded', 'context', 'Match these targets and gaps to the healing assignment and incoming-damage windows before changing coverage.', perTarget.map(item => evidence(mechanic.label + ' was recorded on ' + targetLabel(raw, item.target) + ' for ' + round(item.coverage) + '% of the pull.')));
        }
        if (auraCoverage > 0 && auraCoverage < 70 && !mechanic.coverageContext) {
          const isHarmful = mechanic.kind === 'dot' || mechanic.kind === 'target-debuff';
          const isFriendly = mechanic.kind === 'hot' || mechanic.kind === 'target-buff';
          const windows = bands.slice(0, 5).map(band => {
            const interval = band.interval;
            const subject = targetEffect ? targetLabel(raw, band.target) : 'the player';
            return evidence(mechanic.label + ' active on ' + subject + ' from ' + round(interval[0]) + ' to ' + round(interval[1]) + ' seconds.', interval[0], interval[1]);
          });
          add('coverage-' + mechanic.id, mechanic.label + ' had ' + round(auraCoverage) + '% recorded ' + (targetEffect ? 'any-recorded-target' : 'self') + ' coverage', 'player', isHarmful ? 'Review these target-debuff windows against target swaps, movement and the recorded resource stream. The log establishes coverage, not that every gap was avoidable.' : isFriendly ? 'Review these friendly-target aura windows against assignments, incoming damage and resources. The log establishes coverage, not that every gap needed this effect.' : 'Review these self-buff windows against movement and the recorded resource stream. The log establishes coverage, not that every gap was avoidable.', windows);
          timeline.push(...bands.map(band => ({ label: mechanic.label + ' on ' + (targetEffect ? targetLabel(raw, band.target) : 'player'), startSec: round(band.interval[0]), endSec: round(band.interval[1]), kind: isHarmful ? 'debuff' : 'buff' })));
        }
        if (auraCoverage === 0 && castInfo) add('coverage-' + mechanic.id, mechanic.label + ' was cast but no attributed ' + (targetEffect ? 'target' : 'self') + ' aura was recorded', 'context', targetEffect ? 'Verify event attribution before drawing a maintenance conclusion; unrelated self-buff rows are not used as substitute target coverage.' : 'Verify buff-table attribution before drawing a maintenance conclusion.', [evidence('Cast table records ' + castInfo.count + ' ' + mechanic.label + ' casts, with no matching attributed aura event.')], 'inferred');
      }
    } else if (mechanic.kind === 'cooldown') {
      if (!castInfo) check(mechanic.id, mechanic.label + ' timing', 'unknown', 'No use is recorded; the declared spec alone does not prove the talent or availability.');
      else {
        const uses = castInfo.count || 0;
        check(mechanic.id, mechanic.label + ' timing', 'checked', uses + ' recorded use' + (uses === 1 ? '' : 's') + '.');
        (times || []).forEach(at => timeline.push({ label: mechanic.label, startSec: round(at), endSec: round(at), kind: 'cooldown' }));
        if (mechanic.cooldown && uses > 0 && info.duration && times?.length > 1) {
          const longest = times.slice(1).reduce((best, time, index) => Math.max(best, time - times[index]), 0);
          if (longest > mechanic.cooldown * 1.5) add('cooldown-spacing-' + mechanic.id, mechanic.label + ' had a ' + round(longest) + '-second observed gap between uses', 'player', 'Review the two timestamped uses against movement and encounter holds. A recorded use proves this character can use the ability, but this is not labelled a missed cast.', [evidence('Largest gap between recorded ' + mechanic.label + ' events: ' + round(longest) + ' seconds.')]);
        }
      }
    } else {
      if (!activityInfo) check(mechanic.id, mechanic.label + ' activity', 'unknown', 'No cast row or countable hit/heal row is available; talent, target and resource state are not inferred.');
      else {
        const unit = activityInfo.source === 'casts' ? 'casts' : activityInfo.source === 'damage' ? 'damage events' : 'heal events';
        const detail = times?.length ? '; timestamps ' + round(times[0]) + (times.length > 1 ? '–' + round(times[times.length - 1]) : '') + ' seconds.' : '.';
        check(mechanic.id, mechanic.label + ' activity', 'checked', activityInfo.count + ' recorded ' + unit + detail);
        const refActivity = reference && (attempts(reference.raw.tables?.casts, spellIds, 'casts') || attempts(reference.raw.tables?.dmg, spellIds, 'damage') || attempts(reference.raw.tables?.healing, spellIds, 'healing'));
        compare(mechanic.label + ' ' + unit, activityInfo.count, refActivity?.count, unit);
        if (times?.length) timeline.push({ label: mechanic.label + ' activity', startSec: round(times[0]), endSec: round(times[times.length - 1]), kind: 'spell' });
      }
    }
  }

  // Resource events name the affected unit with targetID. A hunter's outgoing stream, for
  // example, also contains focus changes whose target is the pet and must not become player waste.
  const resourceEvents = eventsFor(raw.events, event => event.targetID === raw.sourceId && event.type === 'resourcechange');
  if (resourceEvents === null) {
    check('resource-context', 'Resource context', 'unknown', 'Outgoing events are incomplete; affordability and capping are not evaluated.');
    limitations.push('No trusted resource stream is present; the evaluator does not label an ability gap as rage, energy, mana, or focus waste.');
  } else if (!resourceEvents.length) {
    check('resource-context', 'Resource context', 'unknown', 'The complete outgoing stream has no resource-change records.');
    limitations.push('No resource-change events were recorded; the evaluator does not label an ability gap as rage, energy, mana, or focus waste.');
  } else {
    const resourceNames = { 0: 'mana', 1: 'rage', 2: 'focus', 3: 'energy', 4: 'combo points' };
    const groups = new Map();
    for (const event of resourceEvents) {
      const type = event.resourceChangeType;
      const group = groups.get(type) || { count: 0, waste: 0 };
      group.count++; group.waste += n(event.waste) || 0; groups.set(type, group);
    }
    const detail = [...groups].map(([type, group]) => (resourceNames[type] || ('resource type ' + type)) + ': ' + group.count + ' changes, ' + round(group.waste) + ' in WCL’s waste field').join('; ');
    const first = eventSec(resourceEvents[0], info), last = eventSec(resourceEvents[resourceEvents.length - 1], info);
    check('resource-context', 'Resource context', 'checked', resourceEvents.length + ' player resource-change events from ' + round(first) + ' to ' + round(last) + ' seconds (' + detail + '). Different pools are kept separate; form, affordability and avoidability are not inferred.');
  }

  if (role === 'healer') {
    const healingRows = entries(raw.tables?.healing);
    if (!healingRows.length) limitations.push('Healing-table detail is unavailable; effective-healing and overheal composition cannot be calculated.');
    else {
      const effective = sum(healingRows, 'effectiveHealing') || sum(healingRows, 'total');
      const overheal = sum(healingRows, 'overheal');
      const denom = effective + overheal;
      compare('Effective healing', effective, reference ? (sum(entries(reference.raw.tables?.healing), 'effectiveHealing') || sum(entries(reference.raw.tables?.healing), 'total')) : null, 'healing');
      compare('Overheal share', denom ? 100 * overheal / denom : null, reference ? (() => { const rows = entries(reference.raw.tables?.healing), e = sum(rows, 'effectiveHealing') || sum(rows, 'total'), o = sum(rows, 'overheal'); return e + o ? 100 * o / (e + o) : null; })() : null, '%', 'Overheal is context-sensitive and is not treated as a performance failure.');
      add('healing-composition', 'Healing composition is recorded', 'context', 'Use effective healing, overheal, assignments and damage windows together; raw HPS alone cannot establish healer performance.', [evidence('Effective healing: ' + round(effective) + '; overheal: ' + round(overheal) + '.')]);
    }
    const healEvents = eventsFor(raw.events, event => event.sourceID === raw.sourceId && (event.type === 'heal' || event.type === 'absorbed') && eventAmount(event) > 0);
    if (healEvents === null) limitations.push('Outgoing healing events are incomplete, so target coverage and death-window context are unknown.');
    else {
      const targets = new Set(healEvents.map(event => event.targetID).filter(id => id != null));
      check('healing-targets', 'Effective healing and absorb target coverage', 'checked', targets.size + ' distinct targets received a recorded heal or absorb in the complete outgoing stream.');
      const deaths = deathsOf(raw);
      const relevant = deaths.filter(death => (death.targetID ?? death.id) != null).map(death => {
        const target = death.targetID ?? death.id;
        const at = eventSec(death, info); const prior = healEvents.filter(event => event.targetID === target && at !== null && eventSec(event, info) !== null && eventSec(event, info) >= at - 8 && eventSec(event, info) <= at);
        return { death, at, prior: prior.length };
      }).filter(item => item.at !== null);
      if (relevant.length) add('death-healing-context', relevant.length + ' raid death window' + (relevant.length === 1 ? '' : 's') + ' with player healing/absorb context', 'context', 'Review the provided effective-heal and absorb events with incoming damage, range and assignment. Other-healer activity is not claimed unless it was supplied separately.', relevant.map(item => evidence('Death at ' + round(item.at) + ' seconds had ' + item.prior + ' provided player heal/absorb events in the preceding 8 seconds.', Math.max(0, item.at - 8), item.at)));
    }
  }

  if (role === 'tank') {
    const incoming = eventsFor(raw.damageTakenEvents || raw.incoming, event => event.targetID === raw.sourceId && (event.type === 'damage' || event.type === 'miss'));
    if (incoming === null) limitations.push('The complete incoming damage stream is unavailable; active-tanking windows and pre-death damage cannot be reconstructed.');
    else {
      const damaging = incoming.filter(event => event.type === 'damage');
      const total = damaging.reduce((value, event) => value + eventAmount(event), 0);
      compare('Recorded incoming damage', total, reference ? (eventsFor(reference.raw.damageTakenEvents || reference.raw.incoming, event => event.targetID === reference.raw.sourceId && event.type === 'damage') || []).reduce((value, event) => value + eventAmount(event), 0) : null, 'damage');
      check('active-tanking', 'Active tanking evidence', 'checked', damaging.length + ' incoming damage events; ' + round(total) + ' recorded damage.');
      const times = damaging.map(event => eventSec(event, info)).filter(time => time !== null).sort((a, b) => a - b);
      if (times.length > 1) {
        const quiet = times.slice(1).map((end, index) => ({ start: times[index], end })).filter(gap => gap.end - gap.start > 12);
        if (quiet.length) add('tank-idle-windows', quiet.length + ' incoming-damage gap' + (quiet.length === 1 ? '' : 's') + ' exceeded 12 seconds', 'context', 'Review swaps, boss movement and target availability before interpreting these as idle tanking.', quiet.map(gap => evidence('No recorded incoming damage for more than 12 seconds before ' + round(gap.end) + ' seconds.', gap.start, gap.end)));
      }
      const deaths = deathsOf(raw).filter(death => death.targetID === raw.sourceId || death.id === raw.sourceId);
      deaths.forEach(death => { const at = eventSec(death, info); if (at === null) return; const window = damaging.filter(event => { const time = eventSec(event, info); return time !== null && time >= at - 6 && time <= at; }); add('tank-predeath-' + round(at), 'Pre-death damage window', 'context', 'Inspect mitigation buffs, healer range and mechanics in this window; the log alone does not attribute the death.', [evidence(round(window.reduce((value, event) => value + eventAmount(event), 0)) + ' incoming damage from ' + window.length + ' events in the final 6 seconds.', Math.max(0, at - 6), at)]); });
    }
  }

  if (spec.classToken === 'HUNTER') {
    const pets = targetIds(raw);
    const rosterComplete = raw.context?.actorRosterComplete;
    const rosterSupportsPetCount = rosterComplete === true || (rosterComplete == null && pets.size > 0);
    const outgoing = eventsFor(raw.events, event => pets.has(event.sourceID) && event.type === 'damage');
    if (!rosterSupportsPetCount) check('pet-contribution', 'Pet contribution', 'unknown', 'The full actor roster is unavailable, so owned pets and their contribution may be missing.');
    else if (outgoing === null) check('pet-contribution', 'Pet contribution', 'unknown', 'Outgoing events are incomplete.');
    else { const petDamage = outgoing.reduce((total, event) => total + eventAmount(event), 0); check('pet-contribution', 'Pet contribution', 'checked', round(petDamage) + ' pet damage from ' + pets.size + ' owned actor(s).'); compare('Pet damage', petDamage, null, 'damage'); }
  }

  const debuffRows = tableRows(raw.tables?.debuffs || raw.context?.debuffs);
  if (!debuffRows.length) check('raid-debuff-context', 'Raid debuff context', 'unknown', 'No target-debuff table was supplied; armor and spell-vulnerability ownership is not inferred.');
  else {
    const physical = [25225, 8647, 770, 35387].some(id => debuffRows.some(row => spellId(row) === id));
    const spell = [17800, 1490, 22959].some(id => debuffRows.some(row => spellId(row) === id));
    check('raid-debuff-context', 'Raid debuff context', 'checked', (physical ? 'physical armor reduction recorded' : 'no recognized physical armor reduction row') + '; ' + (spell ? 'spell vulnerability recorded.' : 'no recognized spell vulnerability row.'));
  }
  if (spec.classToken === 'HUNTER') {
    const aspects = auras(raw.tables?.buffs).filter(row => /aspect of/i.test(row.name || ''));
    if (!Array.isArray(body(raw.tables?.buffs)?.auras)) check('hunter-aspect', 'Hunter aspect', 'unknown', 'Buff coverage is unavailable.');
    else check('hunter-aspect', 'Hunter aspect', 'checked', aspects.length ? aspects.map(row => row.name).join(', ') + ' recorded.' : 'No aspect row is recorded; report visibility and movement phases remain unknown.');
  }
  if (spec.classToken === 'PALADIN') {
    const seals = auras(raw.tables?.buffs).filter(row => /seal of/i.test(row.name || ''));
    if (!Array.isArray(body(raw.tables?.buffs)?.auras)) check('paladin-seal', 'Seal coverage', 'unknown', 'Buff coverage is unavailable.');
    else check('paladin-seal', 'Seal coverage', 'checked', seals.length ? seals.map(row => row.name).join(', ') + ' recorded.' : 'No seal row is recorded; this does not establish which seal was available or intended.');
  }
  if (spec.classToken === 'ROGUE') {
    const poisons = entries(raw.tables?.dmg).filter(row => /poison/i.test(row.name || ''));
    if (!Array.isArray(body(raw.tables?.dmg)?.entries)) check('rogue-poison', 'Poison contribution', 'unknown', 'Damage-table detail is unavailable.');
    else check('rogue-poison', 'Poison contribution', 'checked', poisons.length ? poisons.map(row => row.name).join(', ') + ' recorded.' : 'No poison damage row is recorded; target immunity and report visibility are not inferred.');
  }
  if (role === 'tank' && Array.isArray(body(raw.tables?.buffs)?.auras)) {
    const defensive = auras(raw.tables?.buffs).filter(row => [2565, 871, 12975, 22812, 498, 642, 1022].includes(spellId(row)));
    check('defensive-buffers', 'Defensive buffers', 'checked', defensive.length ? defensive.map(row => row.name || ('spell ' + spellId(row))).join(', ') + ' recorded.' : 'No recognized personal defensive aura is recorded; talent and mechanic availability are not inferred.');
    defensive.forEach(row => intervals([row], spellId(row), info).forEach(band => timeline.push({ label: row.name || 'Defensive buff', startSec: round(band[0]), endSec: round(band[1]), kind: 'defensive' })));
  }
  limitations.push('Counts, coverage and damage windows are observations. The evaluator never derives a causal DPS gain; a controlled simulation is required for that claim.');
  return { observed: info.value === null ? undefined : { metric: info.metric, playerValue: round(info.value), referenceValue: role === 'healer' || role === 'tank' ? null : round(reference?.value), gapValue: role === 'healer' || role === 'tank' ? null : (reference && info.value !== null ? round(reference.value - info.value) : null) }, comparison, findings, timeline, limitations, coverage: { spec: spec.id, role, checks } };
}

module.exports = { analyzeRole };
