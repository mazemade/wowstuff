'use strict';

const { boundFor } = require('./evaluation-pricing.js');

// This layer deliberately summarizes the evaluator's findings. It does not infer
// causes, create DPS estimates, or turn an observation into a mistake.
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const priorityRank = (value) => ({ high: 0, medium: 1, low: 2 })[text(value).toLowerCase()] ?? 3;
const evidence = (finding) =>
    list(finding?.evidence).filter((item) => typeof item === 'string' || (item && text(item.text)));
const findingForAction = {
    boots: 'boots-enchant',
    haste: 'haste-potion',
    demonslaying: 'demonslaying-elixir',
    lotp: 'support-24932',
    ur: 'support-30807',
};

function findingDisposition(finding) {
    const explicit = text(finding?.disposition).toLowerCase();
    if (['improve', 'keep', 'review'].includes(explicit)) return explicit;
    // Older reports did not distinguish an observation from a conclusion. Keep
    // them reviewable instead of silently upgrading them into a coaching claim.
    return 'review';
}

function coachingFinding(finding) {
    let disposition = findingDisposition(finding);
    const observed = text(finding?.title) || 'Unlabelled log finding';
    const action = text(finding?.action);
    const records = evidence(finding);
    // A recommendation without a concrete next action and source record is a
    // question to review, even if an upstream analyzer labelled it improve.
    if (disposition === 'improve' && (!action || !records.length)) disposition = 'review';
    const why =
        text(finding?.why) ||
        (disposition === 'improve'
            ? 'The supplied evidence identifies this as a change to test; it does not quantify an outcome.'
            : 'The supplied evidence records this pattern, but does not establish a cause or fault.');
    const verification =
        text(finding?.verification) ||
        (disposition === 'improve'
            ? 'On the next comparable pull, inspect the same recorded event and its timing before deciding whether the change held.'
            : 'Review this against assignments, encounter timing, and the source evidence before changing play.');
    return {
        id: text(finding?.id) || observed,
        disposition,
        category: text(finding?.category) || 'context',
        priority: ['high', 'medium', 'low'].includes(text(finding?.priority).toLowerCase())
            ? text(finding.priority).toLowerCase()
            : 'low',
        priorityScore: Number.isFinite(finding?.priorityScore) ? finding.priorityScore : 0,
        what: text(finding?.actionTitle) || observed,
        observed: text(finding?.actionTitle) ? observed : '',
        basis: disposition === 'improve' ? (finding?.basis === 'practice' ? 'practice' : 'correction') : null,
        owner: text(finding?.owner) || 'player',
        why,
        change: action,
        verification,
        alternatives: list(finding?.alternatives).map(text).filter(Boolean),
        evidence: records,
        confidence: text(finding?.confidence) || 'observed',
    };
}

// A priced cause with dps <= 0 still ranks ahead of variance/unsized items
// (it was actually modeled), but behind any item with a measurable gain.
const sizeRank = (s) => {
    if (!s) return 3;
    if (s.kind === 'priced' || s.kind === 'bound') return Number.isFinite(s.dps) && s.dps > 0 ? 0 : 1;
    if (s.kind === 'variance') return 2;
    return 3;
};
const ownerRank = (o) => ({ you: 0, player: 0, raid: 1, luck: 2 })[o] ?? 3;
function sizeForCause(cause, pricing) {
    if (cause.owner === 'luck') return { kind: 'variance', dps: 0, label: 'variance' };
    const price = pricing?.prices?.[cause.id];
    if (price && Number.isFinite(price.dps)) {
        if (price.dps <= 0) return { kind: 'priced', dps: price.dps, label: 'no measurable gain in the model' };
        return {
            kind: 'priced',
            dps: price.dps,
            label:
                'about ' +
                price.dps +
                ' DPS for your build, priced with the ' +
                (pricing.rotation === 'validated' ? 'validated' : 'unvalidated') +
                ' rotation',
        };
    }
    return { kind: 'unsized', dps: null, label: pricing?.status === 'withheld' && pricing.reason ? 'not sized: ' + pricing.reason : 'not sized' };
}
function sortItems(items) {
    return items.sort(
        (a, b) =>
            sizeRank(a.size) - sizeRank(b.size) ||
            (b.size?.dps ?? -1) - (a.size?.dps ?? -1) ||
            ownerRank(a.owner) - ownerRank(b.owner) ||
            String(a.title || a.what).localeCompare(String(b.title || b.what)),
    );
}
function buildBuckets(fight, improvements) {
    const budget = fight.budget;
    if (!budget || budget.status !== 'decomposed') return null;
    const pricing = fight.pricing || { status: 'unavailable', prices: {} };
    const duration = fight.durationSec;
    const all = { id: 'all', name: 'Whole pull (buffs, consumables, raid support)', differenceDps: budget.gapDps, durationSec: duration, items: [] };
    const pull = { id: 'pull', name: 'Execution and survival', differenceDps: null, durationSec: duration, items: [] };
    const buckets = list(budget.buckets).map((b) => ({ ...b, durationSec: duration, items: [] }));
    const find = (id) => (id === 'all' ? all : buckets.find((b) => b.id === id) || null);
    for (const cause of list(fight.causes)) {
        const item = { ...cause, itemKind: 'cause', size: sizeForCause(cause, pricing) };
        const targets = [cause.bucket, ...list(cause.alsoBuckets)].map(find).filter(Boolean);
        (targets.length ? targets : [pull]).forEach((t, i) => t.items.push(i ? { ...item, mirrored: true } : item));
    }
    for (const finding of improvements) {
        const source = list(fight.findings).find((f) => f.id === finding.id) || {};
        const target = find(source.bucket) || pull;
        target.items.push({
            ...finding,
            bucket: target.id,
            itemKind: 'finding',
            size: source.measure ? boundFor(source, target) : { kind: 'unsized', dps: null, label: 'not sized' },
        });
    }
    const result = [all, ...buckets.filter((b) => b.items.length || Math.abs(b.differenceDps) >= 20), pull].filter(
        (b) => b.items.length || (b.id !== 'pull' && b.id !== 'all'),
    );
    for (const b of result) {
        sortItems(b.items);
        b.note = 'These values overlap and do not add up to the gap.';
    }
    return result;
}

function depthCoverage(fight) {
    const depth = fight?.coverage?.depth;
    if (!depth || typeof depth !== 'object') return null;
    const reviewed = list(depth.reviewed).map(text).filter(Boolean);
    const unresolved = list(depth.unresolved).map(text).filter(Boolean);
    return { status: text(depth.status) || 'partial', reviewed, unresolved };
}

function buildFightCoaching(fight = {}) {
    const tested =
        fight.simulation?.status === 'complete'
            ? list(fight.simulation.actions).filter((a) => a?.title && (a.gainDps > 0 || a.impact?.value > 0))
            : [];
    const linked = new Set(
        tested.flatMap((a) => [a.id, findingForAction[a.id], ...list(a.findingIds)]).filter(Boolean),
    );
    // Tested options retain their own evidence and assumptions below the coaching report.
    // Do not simultaneously present the same established option as an unresolved question.
    const items = list(fight.findings)
        .filter((item) => item && typeof item === 'object' && !linked.has(item.id))
        .map(coachingFinding);
    const improvements = items
        .filter((item) => item.disposition === 'improve')
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.priorityScore - a.priorityScore || a.what.localeCompare(b.what));
    const keeps = items.filter((item) => item.disposition === 'keep').sort((a, b) => a.what.localeCompare(b.what));
    const reviews = items
        .filter((item) => item.disposition === 'review')
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.what.localeCompare(b.what));
    const depth = depthCoverage(fight);
    const name = text(fight.name) || 'This pull';
    const buckets = buildBuckets(fight, improvements);
    const sized = buckets
        ? sortItems(
              buckets.flatMap((b) =>
                  b.items.filter((i) => ['priced', 'bound'].includes(i.size?.kind) && !i.mirrored).map((i) => ({ ...i, bucket: b.id })),
              ),
          )
        : [];
    let assessment;
    if (buckets) {
        const budget = fight.budget;
        assessment =
            'On ' +
            name +
            ' you did ' +
            Math.round(budget.player.dps) +
            ' DPS against ' +
            budget.reference.name +
            "'s " +
            Math.round(budget.reference.dps) +
            '.' +
            (budget.headline ? ' ' + budget.headline : '') +
            (sized.length
                ? ' The biggest sized lever: ' + (sized[0].title || sized[0].what) + ' (' + sized[0].size.label + ').'
                : ' No cause could be sized on this pull.');
    } else if (improvements.length) {
        assessment = 'Your first priority on ' + name + ': ' + improvements[0].what + '.';
    } else if (keeps.length) {
        assessment = name + ' records behavior worth keeping, with no evidence-backed change ready yet.';
    } else {
        assessment = name + ' has no evidence-backed change ready yet.';
    }
    if (!buckets && tested.length && !improvements.length)
        assessment +=
            ' ' +
            tested.length +
            ' separately modeled option' +
            (tested.length === 1 ? ' is' : 's are') +
            ' available below, with their assumptions.';
    return {
        assessment,
        improvements,
        keeps,
        reviews,
        depth,
        openQuestions: [...list(depth?.unresolved), ...list(fight.limitations).map(text).filter(Boolean)],
        ...(buckets
            ? {
                  buckets,
                  sized,
                  budget: {
                      player: fight.budget.player,
                      reference: fight.budget.reference,
                      gapDps: fight.budget.gapDps,
                      headline: fight.budget.headline,
                      residualDps: fight.budget.residualDps,
                      limitations: fight.budget.limitations,
                      pricing: {
                          status: fight.pricing?.status || 'unavailable',
                          rotation: fight.pricing?.rotation,
                          reason: fight.pricing?.reason,
                          ...(fight.pricing?.rotation === 'validated' ? { baselineDps: fight.pricing.baselineDps } : {}),
                      },
                  },
              }
            : {}),
    };
}

function buildNightCoaching(result = {}) {
    const fights = list(result.fights);
    const fightCoaching = fights.map((fight) => fight?.coaching || buildFightCoaching(fight));
    const byId = new Map();
    fights.forEach((fight, index) => {
        const coaching = fightCoaching[index] || {};
        list(coaching.improvements).forEach((item) => {
            const key = text(item.id) || text(item.what) || 'unlabelled';
            let grouped = byId.get(key) || { ...item, bosses: [], occurrences: [] };
            // A recurring theme can have different causes on different bosses.
            // Keep the strongest example and preserve each boss's actual advice.
            if (priorityRank(item.priority) < priorityRank(grouped.priority) ||
                (priorityRank(item.priority) === priorityRank(grouped.priority) && item.priorityScore > grouped.priorityScore))
                grouped = { ...item, bosses: grouped.bosses, occurrences: grouped.occurrences };
            const boss = text(fight?.name) || 'Unlabelled pull';
            grouped.bosses.push(boss);
            grouped.occurrences.push({ boss, what: item.what, observed: item.observed, why: item.why,
                change: item.change, verification: item.verification, basis: item.basis, evidence: list(item.evidence) });
            if (priorityRank(item.priority) < priorityRank(grouped.priority)) grouped.priority = item.priority;
            byId.set(key, grouped);
        });
    });
    const changes = [...byId.values()]
        .map((item) => ({ ...item, bosses: [...new Set(item.bosses)] }))
        .sort(
            (a, b) =>
                priorityRank(a.priority) - priorityRank(b.priority) ||
                b.priorityScore - a.priorityScore ||
                b.occurrences.length - a.occurrences.length ||
                a.what.localeCompare(b.what),
        );
    const keeps = fightCoaching.flatMap((item) => item.keeps);
    const reviews = fightCoaching.flatMap((item) => item.reviews);
    const topChanges = changes.slice(0, 5);

    // Sized items (priced causes and bound findings) are deduped by id across
    // fights, keeping the largest observation and accumulating every boss it
    // showed up on.
    const sizedById = new Map();
    fights.forEach((fight, index) => {
        const coaching = fightCoaching[index] || {};
        const boss = text(fight?.name) || 'Unlabelled pull';
        list(coaching.sized).forEach((item) => {
            const key = text(item.id) || text(item.title || item.what) || 'unlabelled';
            const existing = sizedById.get(key);
            if (!existing || (item.size?.dps ?? -Infinity) > (existing.size?.dps ?? -Infinity)) {
                sizedById.set(key, { ...item, bosses: [...(existing?.bosses || []), boss] });
            } else {
                existing.bosses.push(boss);
            }
        });
    });
    const topSized = sortItems([...sizedById.values()]).slice(0, 5);

    const bossLines = fightCoaching
        .map((coaching, index) => {
            const budget = coaching?.budget;
            if (!budget) return null;
            const boss = text(fights[index]?.name) || 'Unlabelled pull';
            const namedBuckets = list(coaching.buckets).filter((b) => b.id !== 'all' && b.id !== 'pull');
            const topBucket = namedBuckets.length
                ? namedBuckets.reduce((best, b) => (Math.abs(b.differenceDps ?? 0) > Math.abs(best.differenceDps ?? 0) ? b : best)).name
                : null;
            return {
                boss,
                playerDps: budget.player?.dps ?? null,
                referenceDps: budget.reference?.dps ?? null,
                gapDps: budget.gapDps ?? null,
                topBucket,
            };
        })
        .filter(Boolean);

    const assessment = topSized.length
        ? 'Across ' +
          fights.length +
          ' pull' +
          (fights.length === 1 ? '' : 's') +
          ' the biggest sized lever is ' +
          (topSized[0].title || topSized[0].what) +
          ' (' +
          topSized[0].size.label +
          ') on ' +
          topSized[0].bosses.join(', ') +
          '.'
        : topChanges.length
          ? 'Across ' +
            fights.length +
            ' pull' +
            (fights.length === 1 ? '' : 's') +
            ', start with ' +
            topChanges.slice(0, 1).map((item) => item.what + ' on ' + item.bosses.join(', ')).join('; ') +
            '.'
          : 'Across ' +
            fights.length +
            ' pull' +
            (fights.length === 1 ? '' : 's') +
            ', the evidence records no ready-to-test change yet.';
    return {
        assessment,
        improvements: changes,
        topChanges,
        keeps,
        reviews,
        openQuestions: [...new Set(fightCoaching.flatMap((item) => item.openQuestions))],
        fights: fightCoaching,
        topSized,
        bossLines,
    };
}

module.exports = { buildFightCoaching, buildNightCoaching };
