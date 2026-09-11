'use strict';

const F = require('./vet-feedback.js');
const { analyzeFight } = require('./evaluation-evidence.js');
const { evaluateFight } = require('./evaluation-sim.js');
const { resolveSpec } = require('./evaluation-specs.js');
const { analyzeRole } = require('./evaluation-role-evidence.js');
const { analyzeCommon } = require('./evaluation-common-evidence.js');
const { analyzeDamage, chooseReference } = require('./evaluation-damage-analysis.js');
const { analyzePaladin } = require('./evaluation-paladin-evidence.js');
const { analyzeRogue } = require('./evaluation-rogue-evidence.js');
const { analyzeHunter } = require('./evaluation-hunter-evidence.js');
const { analyzeDecisions } = require('./evaluation-decision-evidence.js');
const { analyzeInvestigation, requestsFor } = require('./evaluation-investigation.js');
const { selectReferences } = require('./evaluation-reference.js');
const { analyzeBudget } = require('./evaluation-budget.js');
const { attributeCauses } = require('./evaluation-attribution.js');
const { priceCauses } = require('./evaluation-pricing.js');
const { buildFightCoaching, buildNightCoaching } = require('./evaluation-coaching.js');
const { encounterContext } = require('./evaluation-encounters.js');
const V = require('./vet-engine.js');
const P = require('./vet-profile.js');
const VERSION = 'deep-evaluation-5';
const MAX_EVENT_PAGES = 20;

function eventQuery(incoming) {
    return 'query($c:String!,$f:[Int]!,$s:Int!,$start:Float){reportData{report(code:$c){events(fightIDs:$f,' +
        // WCL Debuffs events use sourceID for the affected player, despite returned combat
        // events retaining the hostile caster's sourceID and this player's targetID. Verified
        // on Kaz'rogal: targetID alone returned only Sated and silently omitted War Stomp.
        (incoming === 'damageTaken' ? 'sourceID:$s,dataType:DamageTaken,includeResources:true,' : incoming ? 'sourceID:$s,dataType:Debuffs,' : 'sourceID:$s,includeResources:true,') +
        'startTime:$start,limit:10000){data nextPageTimestamp}}}}';
}

async function collectEvents(query, raw, incoming = false) {
    const data = [];
    let start = null;
    try {
        for (let page = 0; page < MAX_EVENT_PAGES; page++) {
            const response = await query(eventQuery(incoming), { c: raw.reportCode, f: [raw.fightId], s: raw.sourceId, start });
            const events = response?.reportData?.report?.events;
            if (!events || !Array.isArray(events.data)) return { data, complete: false, reason: 'Warcraft Logs did not return an event stream.' };
            data.push(...events.data);
            if (events.nextPageTimestamp == null) return { data, complete: true };
            if (!Number.isFinite(events.nextPageTimestamp) || (start !== null && events.nextPageTimestamp <= start)) {
                return { data, complete: false, reason: 'Warcraft Logs event pagination did not advance.' };
            }
            start = events.nextPageTimestamp;
        }
        return { data, complete: false, reason: 'The event stream exceeded the evaluation page limit.' };
    } catch (err) {
        return { data, complete: false, reason: err.code === 'RATE_LIMIT' ? 'Warcraft Logs rate limit interrupted event collection.' : 'Warcraft Logs event collection was interrupted.' };
    }
}

async function collectInvestigation(query, raw, request) {
    const fight = raw.context.fights[0], startTime = request.startTime ?? fight.startTime, endTime = request.endTime ?? fight.endTime;
    const source = Number.isInteger(request.sourceId);
    const q = 'query($c:String!,$start:Float,$end:Float,$filter:String!' + (source ? ',$s:Int!' : ',$f:[Int]!') + '){reportData{report(code:$c){events(dataType:' + request.dataType + ',' +
        (source ? 'sourceID:$s,' : 'fightIDs:$f,') + 'startTime:$start,endTime:$end,filterExpression:$filter,limit:10000){data nextPageTimestamp}}}}';
    const data = []; let start = startTime;
    try {
        for (let page = 0; page < 3; page++) {
            const response = await query(q, { c: raw.reportCode, start, end: endTime, filter: request.filter || 'ability.id IN (' + request.ids.join(',') + ')', ...(source ? { s: request.sourceId } : { f: [raw.fightId] }) });
            const stream = response?.reportData?.report?.events;
            if (!Array.isArray(stream?.data)) throw Error('Missing investigation stream');
            data.push(...stream.data);
            if (stream.nextPageTimestamp == null) return { data, complete: true, startTime, endTime, scope: source ? 'player' : 'raid' };
            if (!Number.isFinite(stream.nextPageTimestamp) || stream.nextPageTimestamp <= start) throw Error('Nonadvancing investigation cursor');
            start = stream.nextPageTimestamp;
        }
    } catch (_) { /* Retain positive evidence, never turn a failed query into absence. */ }
    return { data, complete: false, startTime, endTime, scope: source ? 'player' : 'raid', reason: 'Supplementary ' + request.key + ' evidence was incomplete; dependent timing conclusions are withheld.' };
}

// Retain real reference records while the existing discovery pipeline runs. Its aggregate
// checklist is deliberately not used as evidence or as a source of causal claims here.
function captureQueries(query) {
    const contexts = new Map(), tables = new Map();
    return {
        contexts, tables,
        async query(q, vars) {
            const result = await query(q, vars);
            const report = result?.reportData?.report;
            if (report && q === F.FIGHT_QUERY) contexts.set(vars.c + '/' + vars.f[0], report);
            if (report && q === F.PLAYER_QUERY) tables.set(vars.c + '/' + vars.f[0] + '/' + vars.s, report);
            return result;
        },
    };
}

function capturedPlayer(capture, code, fightId, sourceId) {
    const context = capture.contexts.get(code + '/' + fightId);
    const tables = capture.tables.get(code + '/' + fightId + '/' + sourceId);
    if (!context || !tables) return null;
    const actor = context.masterData?.actors?.find(a => a.id === sourceId);
    return { reportCode: code, fightId, sourceId, context, tables, name: actor?.name || '' };
}

function rawFights(facts, capture) {
    const ownName = facts.player.name.toLowerCase();
    const candidates = [...capture.tables.keys()].map(key => {
        const [code, fight, source] = key.split('/');
        return capturedPlayer(capture, code, Number(fight), Number(source));
    }).filter(Boolean);
    return facts.kills.map(k => {
        const context = capture.contexts.get(k.reportCode + '/' + k.fightId);
        const actor = context?.masterData?.actors?.find(a => a.name?.toLowerCase() === ownName);
        const me = actor && capturedPlayer(capture, k.reportCode, k.fightId, actor.id);
        if (!me) return null;
        const row = context.dmgAll?.data?.entries?.find(p => p.id === actor.id);
        const icon = typeof row?.icon === 'string' ? row.icon.split('-') : [];
        const player = { ...facts.player, classToken: (icon[0] || facts.player.classToken || facts.player.class || '').toUpperCase(), spec: icon[1] || null };
        return Object.assign(me, {
            name: k.name, encounterId: k.encounterId, player,
            // Discovery already filters spec/item-level. Match the actual encounter as well;
            // the evidence module chooses and labels one named duration-comparable reference.
            references: candidates.filter(p => p.name.toLowerCase() !== ownName &&
                p.context.fights?.[0]?.name === context.fights?.[0]?.name),
        });
    }).filter(Boolean);
}

const REPORT_QUERY = 'query($c:String!){reportData{report(code:$c){title startTime masterData{actors(type:"Player"){id name subType server}} fights(killType:Encounters){id name startTime endTime kill encounterID}}}}';
const ROLE_CONTEXT_QUERY = 'query($c:String!,$f:[Int]!){reportData{report(code:$c){healAll:table(dataType:Healing,fightIDs:$f) masterData{actors{id name type subType petOwner server}}}}}';
const ROLE_PLAYER_QUERY = 'query($c:String!,$f:[Int]!,$s:Int!){reportData{report(code:$c){healing:table(dataType:Healing,fightIDs:$f,sourceID:$s) damageTaken:table(dataType:DamageTaken,fightIDs:$f,sourceID:$s)}}}';
const reportOf = data => data?.reportData?.report;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function inputError(message) { const error = new Error(message); error.code = 'EVALUATION_INPUT'; return error; }
function selectActor(report, identity) {
    const actors = report.masterData?.actors || [];
    let matches = identity.sourceId ? actors.filter(a => a.id === identity.sourceId) : actors.filter(a => a.name?.toLowerCase() === identity.name?.toLowerCase());
    if (identity.name && identity.sourceId) matches = matches.filter(a => a.name?.toLowerCase() === identity.name.toLowerCase());
    if (identity.server) matches = matches.filter(a => !a.server || slug(a.server) === slug(identity.server));
    if (!matches.length) throw inputError('The selected player was not found in this report. Check the player name, realm or source ID.');
    if (matches.length > 1) throw inputError('This report has multiple players with that name. Use the source ID from the player’s Warcraft Logs link: ' + matches.map(a => a.id + ' (' + (a.server || 'unknown realm') + ')').join(', ') + '.');
    return matches[0];
}
function pullPlayer(context, tables, actor, identity = {}) {
    const rows = [...(context.dmgAll?.data?.entries || []), ...(context.healAll?.data?.entries || [])];
    const row = rows.find(p => p.id === actor.id);
    const ranks = context.rankings?.data?.[0]?.roles || {};
    let ranked, rankRole;
    for (const [role, group] of Object.entries(ranks)) {
        const candidates = (group.characters || []).filter(p => p.name?.toLowerCase() === actor.name?.toLowerCase() && (!actor.server || !p.server?.name || slug(p.server.name) === slug(actor.server)));
        if (candidates.length === 1) { ranked = candidates[0]; rankRole = role; break; }
    }
    const icon = typeof row?.icon === 'string' ? row.icon.split('-') : [];
    const ci = tables.ci?.data?.find(e => e.sourceID === actor.id) || tables.ci?.data?.find(e => e.sourceID == null);
    const classToken = String(ranked?.class || icon[0] || actor.subType || '').toUpperCase();
    const talentSplit = ci?.talents?.map(t => t.id);
    // Prefer this pull's explicit classification. A recent character profile may be another spec.
    const detected = V.detectSpec(classToken, talentSplit, ranked?.spec || icon[1]);
    const explicit = resolveSpec({ classToken, spec: ranked?.spec || icon[1], role: rankRole === 'tanks' ? 'tank' : undefined });
    const spec = explicit?.spec || detected.spec;
    const canonical = resolveSpec({ classToken, spec, role: rankRole === 'tanks' ? 'tank' : detected.role });
    return { name: actor.name, server: actor.server || identity.server || null, region: identity.region || ranked?.server?.region?.toLowerCase() || null,
        classToken, spec: canonical?.spec || spec || null, role: canonical?.role || detected.role || null,
        itemLevel: row?.itemLevel ?? ranked?.bracketData ?? null, talentSplit: talentSplit || null,
        rankPercent: ranked?.rankPercent ?? null, specSource: explicit ? 'pull classification' : detected.detectedFrom || 'unknown' };
}
async function discoverRaws(identity, deps, captured, progress) {
    let code = identity.report;
    if (!code) {
        const loaded = await deps.loadProfile(identity.name, identity.server, identity.region, identity.zone);
        code = loaded?.profile?.lastSeen?.reportCode;
        if (!code) {
            const character = (await captured.query(P.CHAR_QUERY, { name: identity.name, server: identity.server, region: identity.region }))?.characterData?.character;
            code = character?.recentReports?.data?.[0]?.code;
        }
        if (!code) throw inputError('No recent readable report was found. Open a Warcraft Logs report containing this player and provide its report link.');
    }
    const meta = reportOf(await captured.query(REPORT_QUERY, { c: code }));
    if (!meta) throw inputError('This report is unavailable. Check its code and whether it is readable with the configured Warcraft Logs access.');
    const actor = selectActor(meta, identity);
    const all = (meta.fights || []).filter(f => f.encounterID > 0 && f.endTime > f.startTime);
    let selected = identity.fightId ? all.filter(f => f.id === identity.fightId) : all.filter(f => f.kill);
    if (!identity.fightId && !selected.length) selected = [...new Map(all.map(f => [f.encounterID, f])).values()];
    if (!selected.length) throw inputError('No readable boss pulls matched this selection. Check the fight ID in the Warcraft Logs report.');
    const raws = [], limitations = [], refCache = new Map();
    for (const f of selected) {
        progress({ stage: 'logs', message: 'Reading ' + actor.name + ' on ' + f.name + '.', completed: raws.length, total: selected.length });
        const vars = { c: code, f: [f.id], s: actor.id };
        const results = await Promise.allSettled([
            captured.query(F.FIGHT_QUERY, { c: code, f: [f.id] }), captured.query(F.PLAYER_QUERY, vars),
            captured.query(ROLE_CONTEXT_QUERY, { c: code, f: [f.id] }), captured.query(ROLE_PLAYER_QUERY, vars),
        ]);
        const [base, own, roleContext, roleTables] = results.map(r => r.status === 'fulfilled' ? reportOf(r.value) : null);
        if (!base || !own) { limitations.push(f.name + ': fight tables were unavailable; retry to recover this pull.'); continue; }
        const actorsById = new Map();
        for (const member of [...(meta.masterData?.actors || []), ...(base.masterData?.actors || []), ...(roleContext?.masterData?.actors || [])]) {
            const previous = actorsById.get(member.id) || {};
            actorsById.set(member.id, { ...previous, ...member, server: member.server || previous.server });
        }
        const context = { ...base, ...roleContext, masterData: { actors: [...actorsById.values()] }, actorRosterComplete: Array.isArray(roleContext?.masterData?.actors), fights: [{ ...f, ...(base.fights?.[0] || {}) }] };
        const collectionLimitations = [];
        if (!context.actorRosterComplete) collectionLimitations.push('Full player/pet/target actor roster was unavailable; pet ownership and target labels may be incomplete.');
        for (const [label, table, key] of [['Raid healing', roleContext?.healAll, 'entries'], ['Player healing', roleTables?.healing, 'entries'], ['Incoming damage', roleTables?.damageTaken, 'entries'], ['Outgoing damage', own.dmg, 'entries'], ['Player casts', own.casts, 'entries'], ['Player buffs', own.buffs, 'auras']]) {
            if (!Array.isArray(table?.data?.[key])) collectionLimitations.push(label + ' table was unavailable or incomplete; retry to recover this evidence.');
        }
        const tables = { ...own, ...roleTables };
        const present = [...(context.dmgAll?.data?.entries || []), ...(context.healAll?.data?.entries || [])].some(p => p.id === actor.id) || tables.ci?.data?.some(e => e.sourceID === actor.id);
        if (!present) { limitations.push(f.name + ': no participation by this player was recorded in the returned combatant and output tables.'); continue; }
        const expansion = tables.ci?.data?.find(e => e.sourceID === actor.id)?.expansion;
        if (expansion && expansion !== 'tbc') { limitations.push(f.name + ': this combatant snapshot is for ' + expansion + '; TBC mechanics are not applied.'); continue; }
        const player = pullPlayer(context, tables, actor, identity);
        let gearAudit;
        const combatant = tables.ci?.data?.find(e => e.sourceID === actor.id);
        if (combatant?.gear?.length >= 18) {
            try { const audit = V.summarizeGear(combatant.gear.map(g => ({ ...g, gems: g.gems?.filter(gem => gem.id > 0) })), deps.getDbIndex(), player.classToken); gearAudit = { slots: audit.slots, unknownItems: audit.unknownItems }; } catch (_) { /* Shared preparation observations remain available without the item database. */ }
        }
        const raw = { gearAudit, reportCode: code, fightId: f.id, sourceId: actor.id, name: f.name, encounterId: f.encounterID,
            context, tables, player, collectionLimitations, references: [], encounter: encounterContext(f), modelOverrides: identity.modelOverrides };
        // Named same-pull peers preserve shared raid context. Healers/tanks are contextual
        // examples, never HPS/DTPS performance targets or assumed equivalent assignments.
        const peers = (context.masterData?.actors || []).filter(a => a.id !== actor.id && (!a.type || a.type === 'Player')).map(a => ({ actor: a, player: pullPlayer(context, {}, a, identity) }))
            .filter(p => p.player.classToken === player.classToken && p.player.spec === player.spec && p.player.role === player.role).slice(0, 3);
        for (const peer of peers) {
            try {
                const pv = { c: code, f: [f.id], s: peer.actor.id };
                const [pt, rt] = await Promise.allSettled([captured.query(F.PLAYER_QUERY, pv), captured.query(ROLE_PLAYER_QUERY, pv)]);
                if (pt.status === 'fulfilled' && reportOf(pt.value)) raw.references.push({ reportCode: code, fightId: f.id, sourceId: peer.actor.id, name: peer.actor.name,
                    kind: 'raid', player: peer.player, context, tables: { ...reportOf(pt.value), ...(rt.status === 'fulfilled' ? reportOf(rt.value) : {}) } });
            } catch (_) { /* Missing peers do not prevent own-pull analysis. */ }
        }
        if (player.role && !['healer', 'tank'].includes(player.role) && player.spec && player.region && Number.isFinite(player.itemLevel) && f.kill) {
            try {
                const row = context.dmgAll?.data?.entries?.find(p => p.id === actor.id);
                await (deps.getReference || F.getReference)(captured.query, { encounterId: f.encounterID, classToken: player.classToken, spec: player.spec,
                    role: player.role, region: player.region, itemLevel: player.itemLevel, playerAmount: row?.total / ((f.endTime - f.startTime) / 1000),
                    playerRankPercent: player.rankPercent, dbIndex: deps.getDbIndex(), refCache, now: Date.now() });
                for (const key of captured.tables.keys()) {
                    const [rc, rf, rs] = key.split('/');
                    if (rc === code) continue;
                    const ref = capturedPlayer(captured, rc, +rf, +rs);
                    if (!ref || ref.context.fights?.[0]?.name !== f.name) continue;
                    const ra = ref.context.masterData?.actors?.find(a => a.id === +rs);
                    ref.kind = 'benchmark';
                    ref.player = pullPlayer(ref.context, ref.tables, ra || { id: +rs, name: ref.name }, identity);
                    if (ref.player.classToken === player.classToken && ref.player.spec === player.spec && ref.player.role === player.role) raw.references.push(ref);
                }
            } catch (_) { limitations.push(f.name + ': external reference discovery was unavailable; own-pull evidence is still evaluated.'); }
        }
        raws.push(raw);
    }
    if (!raws.length && limitations.some(text => /TBC mechanics are not applied/.test(text))) throw inputError('This evaluator supports The Burning Crusade reports. The selected pull uses a different expansion.');
    if (!raws.length) throw inputError('No readable player pulls were found. Check the selected player and report, or retry unavailable fight tables.');
    return { raws, player: raws[0].player, night: { code, title: meta.title, date: Number.isFinite(meta.startTime) ? new Date(meta.startTime).toISOString().slice(0, 10) : null }, limitations };
}
function specEvidence(raw) {
    const role = analyzeRole(raw);
    const spec = resolveSpec(raw.player);
    if (spec?.classToken !== 'WARRIOR' || spec?.spec !== 'Fury') return role;
    const fury = analyzeFight(raw);
    const ids = new Set(fury.findings.map(f => f.id));
    return { ...fury, observed: { ...fury.observed, ...role.observed }, coverage: role.coverage,
        comparison: [...fury.comparison, ...role.comparison.filter(r => !fury.comparison.some(f => f.name === r.name))],
        findings: [...fury.findings, ...role.findings.filter(f => !ids.has(f.id))],
        timeline: [...fury.timeline, ...role.timeline].sort((a, b) => a.startSec - b.startSec), limitations: [...new Set([...fury.limitations, ...role.limitations])] };
}
function combinedEvidence(raw) {
    const refs = selectReferences(raw);
    raw = { ...raw, references: refs.accepted, referenceExclusions: [...(raw.referenceExclusions || []), ...refs.excluded] };
    const specific = specEvidence(raw), common = analyzeCommon(raw), damage = analyzeDamage(raw);
    const budget = analyzeBudget(raw), attribution = attributeCauses(raw, budget);
    const paladin = analyzePaladin(raw);
    const decisions = analyzeDecisions(raw), rogue = analyzeRogue(raw), hunter = analyzeHunter(raw), investigation = analyzeInvestigation(raw);
    const depth = { ...decisions.depth, reviewed: [...new Set([...(decisions.depth?.reviewed || []), ...[rogue, paladin, hunter, investigation].flatMap(result => result.checks.filter(c => c.status === 'checked' && !['rogue-events', 'investigation-events'].includes(c.id)).map(c => c.label))])] };
    for (const extra of [paladin, rogue, hunter, decisions, investigation]) {
        for (const key of ['findings', 'comparison', 'timeline', 'checks', 'limitations']) common[key].push(...(extra[key] || []));
    }
    if (damage.damageAnalysis) {
        // The complete ledger supersedes the former single-largest-ability hint.
        common.findings = common.findings.filter(f => f.id !== 'damage-composition');
        common.comparison = common.comparison.filter(c => !/ (damage contribution|critical direct hits)$/.test(c.name));
        common.findings.push(...damage.findings);
        common.comparison.push(...damage.comparison);
        common.checks.push(...damage.checks);
    }
    common.checks.push(...attribution.checks);
    common.limitations.push(...attribution.limitations);
    if (budget.status === 'decomposed') {
        // Buckets and named causes supersede the former single-comparison driver cards.
        common.findings = common.findings.filter(f => !/^damage-driver-/.test(f.id) && f.id !== 'throughput-stat-context' && f.id !== 'comparison-equipment');
    }
    const specificIds = new Set(specific.findings.map(f => f.id));
    const comparisons = new Set(specific.comparison.map(c => c.name));
    const timeline = [...specific.timeline, ...common.timeline];
    return { ...specific, observed: specific.observed || { metric: raw.player?.role === 'healer' ? 'hps' : raw.player?.role === 'tank' ? 'dtps' : 'dps', playerValue: null, referenceValue: null, gapValue: null },
        ...(damage.damageAnalysis ? { damageAnalysis: damage.damageAnalysis } : {}),
        budget, causes: attribution.causes,
        findings: [...specific.findings, ...common.findings.filter(f => !specificIds.has(f.id) && !(f.id === 'preparation-enchants' && specificIds.has('boots-enchant') && f.evidence.length === 1 && f.evidence[0].text.startsWith('Boots:')))],
        comparison: [...specific.comparison, ...common.comparison.filter(c => !comparisons.has(c.name))],
        timeline: timeline.filter((t, i) => timeline.findIndex(x => x.label === t.label && x.startSec === t.startSec && x.endSec === t.endSec) === i).sort((a, b) => a.startSec - b.startSec),
        coverage: { ...specific.coverage, depth, checks: [...(specific.coverage?.checks || []), ...common.checks] },
        limitations: [...new Set([...specific.limitations, ...common.limitations])] };
}
async function buildEvaluation(identity, deps, progress = () => {}) {
    await progress({ stage: 'logs', message: 'Reading this player’s pull, role and comparison evidence.', completed: 0, total: 0 });
    const captured = captureQueries(deps.query);
    let discovery;
    // Compatibility seam for existing recorded discovery tests; production uses report actors
    // and every selected boss pull, without requiring rankings or limiting to eight kills.
    if (deps.fetchFeedback) {
        const { profile } = await deps.loadProfile(identity.name, identity.server, identity.region, identity.zone);
        const facts = await deps.fetchFeedback(captured.query, { profile, dbIndex: deps.getDbIndex(), refCache: new Map(), report: identity.report });
        discovery = { raws: rawFights(facts, captured), player: facts.player, night: facts.night || { code: identity.report }, limitations: [] };
    } else discovery = await discoverRaws(identity, deps, captured, progress);
    const { raws } = discovery;
    const result = { schemaVersion: 2, version: VERSION, player: discovery.player, night: discovery.night,
        generatedAt: new Date().toISOString(), fights: [], limitations: discovery.limitations };
    const analyze = deps.analyzeFight || combinedEvidence, simulate = deps.evaluateFight || evaluateFight;
    for (const raw of raws) {
        await progress({ stage: 'events', message: 'Reading ' + raw.name + ' fight events.', completed: result.fights.length, total: raws.length }, result);
        [raw.events, raw.incoming, raw.damageTakenEvents] = await Promise.all([
            collectEvents(captured.query, raw), collectEvents(captured.query, raw, true), collectEvents(captured.query, raw, 'damageTaken'),
        ]);
        const refs = selectReferences(raw);
        raw.references = refs.accepted;
        raw.referenceExclusions = refs.excluded;
        raw.investigation = {};
        for (const request of requestsFor(raw)) {
            await progress({ stage: 'investigation', message: 'Checking ' + (request.key === 'cooldownHistory' ? 'earlier cooldown availability' : 'raid mechanic timing') + ' on ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result);
            raw.investigation[request.key] = await collectInvestigation(captured.query, raw, request);
        }
        const primaryReference = !['healer', 'tank'].includes(raw.player?.role) && chooseReference(raw);
        const timingReferences = primaryReference ? [primaryReference, ...(raw.player?.classToken === 'ROGUE' ? raw.references.filter(r => r !== primaryReference && chooseReference({ ...raw, references: [r] })) : [])].slice(0, 3) : [];
        for (const reference of timingReferences) {
            const ci = reference.tables?.ci?.data?.find(e => e.sourceID === reference.sourceId);
            if (ci?.gear?.length >= 18) {
                try { const audit = V.summarizeGear(ci.gear.map(g => ({ ...g, gems: g.gems?.filter(gem => gem.id > 0) })), deps.getDbIndex(), reference.player.classToken); reference.gearAudit = { slots: audit.slots, unknownItems: audit.unknownItems }; } catch (_) { /* Missing item data does not prevent timing comparisons. */ }
            }
            await progress({ stage: 'events', message: 'Reading ' + reference.player.name + ' comparison timing on ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result);
            [reference.events, reference.incoming] = await Promise.all([
                collectEvents(captured.query, reference), collectEvents(captured.query, reference, true),
            ]);
            if (!reference.events.complete || !reference.incoming.complete) {
                const key = reference === primaryReference ? 'collectionLimitations' : 'referenceTimingLimitations';
                raw[key] ||= [];
                raw[key].push((reference === primaryReference ? 'Comparison' : 'Additional comparison for ' + reference.player.name) + ' event timing was incomplete; table comparisons remain available, but retry for full execution evidence.');
            }
        }
        raw.encounter ||= encounterContext(raw.context.fights[0]);
        raw.modelOverrides = identity.modelOverrides;
        const evidence = analyze(raw);
        const fight = { partial: !!raw.collectionLimitations?.length || !raw.events.complete || !raw.incoming.complete || !raw.damageTakenEvents.complete || (raw.player?.role === 'healer' && !raw.tables.healing), id: raw.reportCode + '/' + raw.fightId, name: raw.name, player: raw.player, encounter: raw.encounter,
            durationSec: (raw.context.fights[0].endTime - raw.context.fights[0].startTime) / 1000,
            wclUrl: 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId, ...evidence };
        fight.limitations = [...(fight.limitations || []), ...(raw.collectionLimitations || []), ...[raw.events, raw.incoming, raw.damageTakenEvents].filter(stream => !stream.complete && stream.reason).map(stream => stream.reason), ...raw.encounter.limitations];
        fight.limitations.push(...Object.values(raw.investigation).filter(stream => !stream.complete).map(stream => stream.reason));
        fight.limitations.push(...(raw.referenceTimingLimitations || []));
        fight.partial ||= Object.values(raw.investigation).some(stream => !stream.complete);
        await progress({ stage: 'simulation', message: 'Testing improvements for ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result);
        try {
            fight.simulation = await simulate(raw, { onProgress: message => progress({ stage: 'simulation', message: typeof message === 'string' ? message : 'Testing improvements for ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result) });
        } catch (_) {
            fight.simulation = { status: 'unavailable', reason: 'Simulation could not finish. The fight evidence is still available.', actions: [], packages: [], assumptions: [] };
        }
        await progress({ stage: 'pricing', message: 'Pricing gear and buff changes for ' + raw.name + '.', completed: result.fights.length, total: raws.length }, result);
        try { fight.pricing = await (deps.priceCauses || priceCauses)(raw, { budget: fight.budget, causes: fight.causes }); }
        catch (error) { fight.pricing = { status: 'unavailable', reason: 'Pricing could not finish: ' + ((error && error.message) || String(error)), prices: {} }; }
        fight.coaching = buildFightCoaching(fight);
        result.fights.push(fight);
        result.coaching = buildNightCoaching(result);
        await progress({ stage: 'analysis', message: raw.name + ' evaluation ready.', completed: result.fights.length, total: raws.length }, result);
    }
    result.partial = result.fights.some(f => f.partial) || result.limitations.some(text => /unavailable|retry/.test(text));
    if (result.fights.some(f => !['complete', 'not-applicable'].includes(f.simulation.status))) result.limitations.push('Some estimates are conditional or unavailable. Review model coverage and assumptions before treating an estimated gain as attainable on this pull.');
    return result;
}
module.exports = { VERSION, MAX_EVENT_PAGES, REPORT_QUERY, ROLE_CONTEXT_QUERY, ROLE_PLAYER_QUERY, eventQuery, collectEvents, collectInvestigation, captureQueries, rawFights, selectActor, pullPlayer, discoverRaws, combinedEvidence, buildEvaluation };
