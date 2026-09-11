'use strict';

// Coaching from recorded hunter/pet decisions. Practice suggestions are explicitly
// conditional; attack counts and peer DPS never become promised recoverable DPS.
const { fightOf } = require('./evaluation-reference');
const { chooseReference } = require('./evaluation-damage-analysis');
const { controlBands } = require('./evaluation-investigation');
const spell = e => Number(e?.abilityGameID ?? e?.guid ?? e?.ability?.guid);
const round = n => Math.round(n * 10) / 10;
const SHOTS = new Set([75, 34120, 27019, 27021, 27065]);
const FIRE = new Map([[31340, 'Rain of Fire'], [31341, 'Unquenchable Flames'],
    [31944, 'Doomfire'], [31969, 'Doomfire damage over time']]);
const time = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
const petRows = raw => (raw.tables?.dmg?.data?.entries || []).filter(row => row.composite &&
    ((row.sources?.length && row.sources.every(s => s.type === 'Pet')) ||
     (row.subentries?.length && row.subentries.every(s => s.actorType === 'Pet'))));
function petIds(raw) {
    const actors = new Map((raw.context?.masterData?.actors || []).map(a => [a.id, a]));
    // The source-scoped Call Pet composite identifies the combat pet. Owned
    // traps/guardians also have petOwner, but cannot restore Kill Command access.
    return new Set(petRows(raw).filter(row => spell(row) === 883)
        .flatMap(row => (row.subentries || []).filter(s => s.actorType === 'Pet').map(s => s.actor))
        .filter(id => Number.isInteger(id) && (actors.get(id)?.petOwner == null || actors.get(id).petOwner === raw.sourceId)));
}
function validMana(e) {
    // Classic reports sometimes contain shifted/malformed resource records. Never
    // reinterpret their type/cost fields as mana or trust a zero maximum.
    if (e.resourceActor !== 1) return null;
    const m = e.classResources?.find(r => r.type === 0 && Number.isFinite(r.amount) &&
        Number.isFinite(r.max) && r.max > 0 && r.amount >= 0 && r.amount <= r.max);
    return m ? m.amount : null;
}
function analyzeHunter(raw = {}) {
    const out = { findings: [], checks: [], comparison: [], timeline: [], limitations: [] };
    if (String(raw.player?.classToken).toUpperCase() !== 'HUNTER') return out;
    const f = fightOf(raw);
    if (!(f?.endTime > f?.startTime)) return out;
    const duration = (f.endTime - f.startTime) / 1000;
    const at = e => (e.timestamp - f.startTime) / 1000;
    const url = r => 'https://classic.warcraftlogs.com/reports/' + r.reportCode + '#fight=' + r.fightId + '&source=' + r.sourceId;
    const evidence = (text, from, to, r = raw) => ({ text, url: url(r),
        ...(Number.isFinite(from) ? { startSec: round(from) } : {}),
        ...(Number.isFinite(to) ? { endSec: round(to) } : {}) });
    const add = (id, actionTitle, title, why, action, verification, records, options = {}) =>
        out.findings.push({ id, actionTitle, title, why, action, verification, evidence: records,
            category: 'execution', owner: 'player', priority: 'medium', disposition: 'improve',
            confidence: 'observed', basis: 'correction', ...options });
    const check = (id, label, status, reason) => out.checks.push({ id, label, status, reason });
    if (!raw.events?.complete || !Array.isArray(raw.events.data)) {
        check('hunter-events', 'Hunter execution and pet recovery', 'unknown', 'Complete player and pet events are required.');
        return out;
    }
    const events = raw.events.data.filter(e => e.timestamp >= f.startTime && e.timestamp <= f.endTime).sort((a, b) => a.timestamp - b.timestamp);
    const own = events.filter(e => e.sourceID === raw.sourceId);
    const shots = own.filter(e => e.type === 'damage' && SHOTS.has(spell(e)) && e.amount > 0);
    const casts = own.filter(e => e.type === 'cast');
    const pets = petIds(raw);
    const petDamage = events.filter(e => pets.has(e.sourceID) && e.type === 'damage' && e.amount > 0);
    const petTotal = petDamage.reduce((n, e) => n + e.amount, 0);
    const reference = chooseReference(raw);
    const refFight = fightOf(reference);
    const refDuration = refFight && (refFight.endTime - refFight.startTime) / 1000;
    const refPetRows = reference ? petRows(reference) : [];
    const petComparison = refPetRows.length && refDuration > 0
        ? evidence(reference.player.name + ' recorded ' + round(refPetRows.reduce((n, r) => n + r.total, 0) / refDuration) +
            ' pet DPS over ' + round(refDuration) + ' seconds; you recorded ' + round(petTotal / duration) +
            ' over ' + round(duration) + '. Duration, pet, gear and buffs differ; this is context, not a gain estimate.', undefined, undefined, reference)
        : null;
    const deathEvents = events.filter(e => e.type === 'death' && pets.has(e.targetID) && !e.feign);
    const playerDeaths = events.filter(e => e.type === 'death' && e.targetID === raw.sourceId && !e.feign);
    const deadWindows = [];
    for (const death of deathEvents) {
        // Positive attack evidence bounds recovery, including summon/replacement pets.
        // Do not call this exact dead time: revive and travel can occur before it.
        const next = petDamage.find(e => e.timestamp > death.timestamp);
        const end = next?.timestamp ?? f.endTime;
        if (deadWindows.some(w => death.timestamp < w.end)) continue;
        const during = shots.filter(e => e.timestamp > death.timestamp && e.timestamp < end);
        const damageBefore = events.filter(e => e.type === 'damage' && e.targetID === death.targetID &&
            e.timestamp >= death.timestamp - 6000 && e.timestamp <= death.timestamp && e.amount > 0);
        deadWindows.push({ death, end, next, during, damageBefore });
    }
    check('hunter-pet-survival', 'Pet deaths and return to damage', pets.size ? 'checked' : 'unknown',
        pets.size ? deathEvents.length + ' combat-pet death events; recovery is bounded by the next observed combat-pet damage.' : 'A combat pet could not be identified from the source-scoped Call Pet damage rows.');
    if (deadWindows.length) {
        const seconds = deadWindows.reduce((sum, w) => sum + (w.end - w.death.timestamp) / 1000, 0);
        const shotCount = deadWindows.reduce((sum, w) => sum + w.during.length, 0);
        const fire = deadWindows.some(w => w.damageBefore.some(e => FIRE.has(spell(e))));
        const bossMelee = deadWindows.some(w => w.damageBefore.some(e => spell(e) === 1));
        const records = deadWindows.map(w => evidence('Pet died at ' + time(at(w.death)) + '; ' +
            (w.next ? 'next pet damage at ' + time(at(w.next)) : 'no further pet damage before the pull ended') +
            '. You landed ' + w.during.length + ' shots during that interval.' +
            (w.damageBefore.length ? ' Last six seconds: ' + [...new Set(w.damageBefore.map(e => FIRE.get(spell(e)) || (spell(e) === 1 ? 'melee' : 'spell ' + spell(e))))].join(', ') +
                ' dealt ' + w.damageBefore.reduce((n, e) => n + e.amount, 0) + ' damage.' : ''), at(w.death), (w.end - f.startTime) / 1000));
        if (petComparison) records.push(petComparison);
        const sharedPullDeath = deadWindows.some(w => at(w.death) < 10 && playerDeaths.some(d => Math.abs(d.timestamp - w.death.timestamp) < 5000));
        add(sharedPullDeath ? 'hunter-pull-survival' : 'hunter-pet-survival', sharedPullDeath ? 'Agree on the pull and Misdirection timing' : fire ? 'Move your pet out of damaging ground effects early' : 'Keep your pet alive through the pull',
            deathEvents.length + ' pet death' + (deathEvents.length === 1 ? '' : 's') + '; ' + round(seconds) + ' seconds from death to resumed pet damage or pull end',
            (sharedPullDeath ? 'You and your pet both died near the start. Establish a safe opener with the tank before concentrating on shot timing. ' : '') +
            'Your pet supplied ' + round(petTotal / duration) + ' DPS on this pull. Its deaths also stopped pet attacks while you landed ' + shotCount +
                ' shots. No combat-pet damage was observed in those intervals; Kill Command damage is unavailable while the pet is dead. ' +
                (fire ? 'The recorded damage before death includes fire effects, giving you a specific warning to react to.' : 'The recovery intervals include any time spent reviving and returning to the target.'),
            (fire ? 'Put pet health where you can see it. Recall the pet as ground damage starts, reposition so it can reach the target safely, then send it back in. Use Mend Pet before its health becomes critical; healing does not replace moving out of continuing damage. ' : '') +
            (bossMelee ? 'For the pull, use the agreed Misdirection and let the tank establish the target before sending your pet. Check pet threat as well as your own. ' : '') +
            'Keep pet attack and passive/follow on accessible keys. If it dies, revive only from a safe position and explicitly send it back to attack.',
            'Aim for a pull with no pet deaths; if one occurs, compare the death-to-next-attack interval. Keep required pet recalls and your own survival ahead of uptime.',
            [...records, ...(sharedPullDeath ? playerDeaths.map(d => evidence('Player death (not Feign Death).', at(d))) : [])],
            { priority: 'high', priorityScore: 100 + round(seconds), basis: sharedPullDeath ? 'practice' : 'correction',
                alternatives: ['Boss targeting, unavoidable damage and healing support can contribute; the log does not assign all responsibility to the hunter.'],
                bucket: 'pet-damage', measure: { lostSeconds: round(seconds), activeRateDps: round(petTotal / Math.max(1, duration - seconds)), note: 'Pet damage rate while the pet was alive on this pull.' } });
    } else if (petDamage.length) {
        add('hunter-pet-survival', 'Keep your pet contributing throughout the pull',
            'No pet death recorded; ' + round(petTotal / duration) + ' pet DPS',
            'Keeping the pet alive preserves its attacks and lets you use Kill Command.',
            'Keep the same pet health monitoring and safe attack positioning.',
            'Check that the next comparable pull also has no pet deaths.',
            [evidence(petDamage.length + ' positive pet damage events; no pet death in the complete stream.'), ...(petComparison ? [petComparison] : [])],
            { disposition: 'keep', priority: 'low' });
    }

    const controls = raw.incoming?.complete ? controlBands(raw) : null;
    const controlled = (a, b) => !controls || controls.some(c => c.start < b && c.end > a);
    const recovering = (a, b) => playerDeaths.some(e => e.timestamp >= a && e.timestamp <= b) ||
        own.some(e => spell(e) === 982 && ['cast', 'begincast'].includes(e.type) && e.timestamp >= a && e.timestamp <= b);
    const steady = casts.filter(e => spell(e) === 34120);
    const auto = casts.filter(e => spell(e) === 75);
    const gaps = steady.slice(1).map((end, i) => ({ start: steady[i], end })).filter(w =>
        w.end.timestamp - w.start.timestamp >= 8000 && w.start.targetID > 0 && w.start.targetID === w.end.targetID &&
        !controlled(w.start.timestamp, w.end.timestamp) && !recovering(w.start.timestamp, w.end.timestamp)).map(w => ({ ...w,
        autos: auto.filter(e => e.targetID === w.start.targetID && e.timestamp > w.start.timestamp && e.timestamp < w.end.timestamp) }))
        .filter(w => w.autos.length >= 4 && !w.autos.every(e => validMana(e) !== null && validMana(e) < 110));
    check('hunter-shot-rhythm', 'Auto / Steady Shot recovery windows', controls ? 'checked' : 'unknown',
        controls ? gaps.length + ' same-target intervals of at least eight seconds with four autos and no completed Steady Shot, excluding recognized control and revival.' : 'Incoming control coverage is incomplete.');
    if (gaps.length) {
        const worst = [...gaps].sort((a, b) => b.end.timestamp - b.start.timestamp - (a.end.timestamp - a.start.timestamp))[0];
        const damage = shots.filter(e => spell(e) === 34120);
        const average = damage.length ? round(damage.reduce((sum, e) => sum + e.amount, 0) / damage.length) : null;
        const resourcesKnown = gaps.every(w => w.autos.every(e => validMana(e) !== null));
        const lostSteady = gaps.reduce((s, w) => s + Math.max(0, (w.end.timestamp - w.start.timestamp) / 1000 - 3), 0);
        const steadyTotal = damage.reduce((sum, e) => sum + e.amount, 0);
        // This is a conditional practice plan, not an assertion that movement or
        // resource spending was wrong. There is no missing-cast counterfactual.
        add('hunter-shot-rhythm', 'Resume Steady Shot promptly when you can stand still',
            gaps.length + ' long Steady Shot gaps while Auto Shot continued; longest ' + round((worst.end.timestamp - worst.start.timestamp) / 1000) + ' seconds',
            'Auto Shot kept connecting to the same target, but Steady Shot stopped between ' + time(at(worst.start)) + ' and ' + time(at(worst.end)) +
            '. Steady Shot supplied ' + round(damage.reduce((sum, e) => sum + e.amount, 0) / duration) + ' DPS on this pull' +
            (average ? ' and averaged ' + average + ' per landed hit' : '') + '. These are windows to improve your recovery after moving, not proof that every second was available to cast.',
            'Use a ranged swing timer. Once safely stationary and able to spend mana, resume fitting Steady Shot between Auto Shots. Recheck the timing during Bloodlust and Rapid Fire instead of forcing a fixed shot ratio. Keep Auto Shot running during necessary movement.',
            'Review ' + time(at(worst.start)) + '–' + time(at(worst.end)) + ' first. On the next pull, aim to resume Steady immediately after movement ends, without delaying Auto Shot or spending mana needed for the encounter.',
            gaps.slice(0, 4).map(w => evidence(round((w.end.timestamp - w.start.timestamp) / 1000) + ' seconds between completed Steady Shots; ' + w.autos.length +
                ' Auto Shot casts on the same target. No recognized control or Revive Pet overlaps.', at(w.start), at(w.end))),
            { basis: 'practice', confidence: 'inferred', alternatives: [resourcesKnown ? 'Recorded mana snapshots do not reconstruct regeneration or the intended mana reserve.' : 'Mana snapshots are unavailable or malformed; the evaluator cannot establish affordability.', 'Movement, latency and assignments can explain these intervals. No extra Steady Shot count or DPS gain is claimed.'],
                bucket: 'steady shot', measure: { lostSeconds: round(lostSteady), activeRateDps: round(steadyTotal / Math.max(1, duration - lostSteady)), note: 'Steady Shot rate outside the gaps; the first three seconds of each gap are allowed for movement.' } });
    }

    const kc = casts.filter(e => spell(e) === 34026);
    const missed = [];
    const critical = shots.filter(e => e.hitType === 2);
    // Crits refresh one five-second opportunity; they are not independent procs.
    // A command consumes that opportunity and starts a five-second cooldown.
    for (let i = 0; i <= kc.length; i++) {
        const previous = kc[i - 1]?.timestamp ?? f.startTime;
        const next = kc[i]?.timestamp ?? Infinity;
        const clusters = [];
        for (const crit of critical.filter(e => e.timestamp > previous && e.timestamp < next)) {
            const cluster = clusters[clusters.length - 1];
            if (cluster && crit.timestamp <= cluster.end) {
                cluster.last = crit; cluster.end = crit.timestamp + 5000;
            } else clusters.push({ first: crit, last: crit, end: crit.timestamp + 5000 });
        }
        for (const cluster of clusters) {
            const start = Math.max(cluster.first.timestamp, previous + 5000), end = cluster.end;
            if (end > f.endTime || end >= next - 100 || end - start < 1500 ||
                controlled(start, end) || recovering(start, end)) continue;
            // Target switches are not treated as lost commands on the old target.
            if (shots.some(e => e.timestamp >= start && e.timestamp <= end && e.targetID !== cluster.last.targetID)) continue;
            const petHits = petDamage.filter(e => e.targetID === cluster.last.targetID && e.timestamp >= start && e.timestamp <= end);
            if (petHits.length < 2 || deadWindows.some(w => w.death.timestamp < end && w.end > start)) continue;
            const samples = own.filter(e => e.timestamp >= start && e.timestamp <= end && validMana(e) !== null);
            if (samples.length >= 2 && samples.every(e => validMana(e) < 75)) continue;
            missed.push({ ...cluster, start });
        }
    }
    check('hunter-kill-command', 'Kill Command after critical shots', controls && pets.size ? 'checked' : 'unknown',
        controls && pets.size ? missed.length + ' refreshed crit opportunities expired after the cooldown was ready with active pet damage and no Kill Command; affordability and range are separate checks.' : 'Complete control and owned-pet evidence are required.');
    if (missed.length >= 2) {
        const kcDamage = events.filter(e => pets.has(e.sourceID) && e.type === 'damage' && spell(e) === 34027);
        add('hunter-kill-command', 'Make Kill Command easy to trigger after a critical shot',
            missed.length + ' refreshed critical-shot opportunit' + (missed.length === 1 ? 'y expired' : 'ies expired') + ' without Kill Command while the pet attacked',
            'A hunter critical shot opens a short Kill Command opportunity. In these windows the pet was dealing damage to the same target and no recent Kill Command cast explains the omission. That makes input timing worth practicing; mana, command range and pet control still matter.',
            'Put Kill Command on an easy key or add a separate /cast Kill Command line to the shot buttons you already press. Trigger it after a crit when it is ready and your pet can attack; keep checking pet range and mana. A macro still requires your key press.',
            'Check the linked opportunity windows. On the next pull, look for Kill Command following eligible crits while the pet is alive, in range and you have mana; do not set a fixed casts-per-minute target.',
            missed.slice(0, 4).map(w => evidence('Critical shots opened/refreshed the opportunity at ' + time(at(w.first)) + '–' + time(at(w.last)) +
                '. Kill Command cooldown was ready by ' + time((w.start - f.startTime) / 1000) + '; the opportunity expired at ' + time((w.end - f.startTime) / 1000) +
                ' with no command, despite pet damage on the same target. Mana and command range remain unverified.', (w.start - f.startTime) / 1000, (w.end - f.startTime) / 1000)),
            { basis: 'practice', confidence: 'inferred', alternatives: ['The pet attacking the boss does not prove command range from the hunter. Mana snapshots do not establish affordability in malformed Classic records.', 'No hypothetical command count or DPS gain is assigned.'],
                bucket: 'pet-damage', measure: { lostCasts: missed.length, averageDamage: kcDamage.length ? round(kcDamage.reduce((s, e) => s + e.amount, 0) / kcDamage.length) : 0, note: "One Kill Command per expired opportunity at this pull's average landed damage." } });
    }

    const bw = casts.filter(e => spell(e) === 19574);
    if (bw.length && pets.size) {
        const short = bw.map(c => {
            const death = deathEvents.find(e => e.timestamp >= c.timestamp && e.timestamp < c.timestamp + 18000);
            return death && { cast: c, death };
        }).filter(Boolean);
        if (short.length) {
            const survival = out.findings.find(item => ['hunter-pet-survival', 'hunter-pull-survival'].includes(item.id));
            if (survival) {
                survival.why += ' The pet also died during Bestial Wrath, cutting short its 18-second damage window. This is part of the same pet-survival issue.';
                survival.action += ' Before Bestial Wrath, check that the pet is healthy, attacking and out of ground damage; reposition or heal it first when needed.';
                survival.evidence.push(...short.map(w => evidence('Bestial Wrath at ' + time(at(w.cast)) + '; pet died ' + round((w.death.timestamp - w.cast.timestamp) / 1000) + ' seconds later.', at(w.cast), at(w.death))));
            }
        }
        const pairs = bw.slice(1).map((cast, i) => (cast.timestamp - bw[i].timestamp) / 1000);
        if (pairs.length && pairs.every(gap => gap >= 119 && gap <= 123) && !short.length)
            add('hunter-bestial-wrath-reuse', 'Keep reusing Bestial Wrath when it becomes ready',
                'Bestial Wrath repeated after ' + pairs.map(round).join(', ') + ' seconds',
                'The recorded reuse is close to its two-minute cooldown; there is no reason to hold this good habit behind generic cooldown advice.',
                'Keep using the next Bestial Wrath when ready and the pet can safely attack. Avoid holding it so long that a use disappears before the kill.',
                'Keep checking actual reuse timing against pet safety and fight length.',
                bw.map(c => evidence('Bestial Wrath cast.', at(c))), { disposition: 'keep', priority: 'low' });
    }
    if (own.some(e => e.classResources?.length) && !own.some(e => validMana(e) !== null)) {
        check('hunter-mana-validation', 'Mana snapshot validity', 'unknown', 'Resource fields did not contain a valid source mana amount and maximum; affordability is not inferred.');
        out.limitations.push('Hunter resource snapshots are malformed or unsupported. Mana costs, remaining mana and avoidable shot deficits are not reconstructed from these fields.');
    }
    out.limitations.push('Hunter coaching separates confirmed pet deaths from conditional shot and Kill Command practice. Observed damage and peer differences are not recoverable DPS estimates.');
    return out;
}
module.exports = { analyzeHunter, petIds, petRows, validMana };
