'use strict';

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
    let assessment;
    if (improvements.length)
        assessment = 'Your first priority on ' + name + ': ' + improvements[0].what + '.';
    else if (keeps.length)
        assessment = name + ' records behavior worth keeping, with no evidence-backed change ready yet.';
    else assessment = name + ' has no evidence-backed change ready yet.';
    if (tested.length && !improvements.length)
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
    const assessment = topChanges.length
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
    };
}

module.exports = { buildFightCoaching, buildNightCoaching };
