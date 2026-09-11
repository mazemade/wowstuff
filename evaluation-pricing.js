'use strict';
// Sizes causes with the pinned simulator (same character, one change) and execution findings
// with observed-rate bounds. Never sums; never prints absolute DPS from an unvalidated rotation.
const Models = require('./evaluation-models.js');
const Sim = require('./evaluation-sim.js');
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => finite(x) ? Math.round(x * 10) / 10 : null;
const clone = v => JSON.parse(JSON.stringify(v));
const SANITY = { low: 0.7, high: 1.5 };
const ITERATIONS = 3000;
const MAX_SCENARIOS = 12;

function boundFor(finding, bucket) {
    const m = finding?.measure, duration = Number(bucket?.durationSec);
    if (!m || !(duration > 0)) return { kind: 'unsized', label: 'not sized' };
    let dps = null;
    if (finite(m.lostSeconds) && finite(m.activeRateDps)) dps = m.activeRateDps * m.lostSeconds / duration;
    else if (finite(m.lostCasts) && finite(m.averageDamage)) dps = m.lostCasts * m.averageDamage / duration;
    if (!finite(dps) || dps <= 0) return { kind: 'unsized', label: 'not sized' };
    const cap = finite(bucket?.differenceDps) && bucket.differenceDps > 0 ? bucket.differenceDps
        : finite(bucket?.playerDps) && bucket.playerDps > 0 ? bucket.playerDps : Infinity;
    const capped = dps > cap;
    const value = round(Math.min(dps, cap));
    return { kind: 'bound', dps: value, capped, label: 'up to about ' + Math.round(value) + ' DPS on this pull' + (capped ? ' (capped at the bucket difference)' : '') + (m.note ? '. ' + m.note : '') };
}

function setPath(target, path, value) {
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (node[key] === undefined || node[key] === null) node[key] = {};
        node = node[key];
    }
    node[path[path.length - 1]] = value;
}
function applyChange(request, change) {
    const player = request.raid.parties[0].players[0];
    if (change.set) for (const [path, value] of change.set) setPath(request, path, value);
    if (change.bonusStats) { const stats = new Array(40).fill(0); for (const [index, delta] of Object.entries(change.bonusStats)) stats[Number(index)] = Number(delta); player.bonusStats = { stats, pseudoStats: [] }; }
    if (change.consumable) { const c = player.consumables || (player.consumables = {}); c[change.consumable.field] = change.consumable.id; for (const f of change.consumable.clear || []) delete c[f]; if (change.consumable.field === 'potId') c.potions = [...new Set([...(c.potions || []), change.consumable.id])]; }
    if (change.equip) {
        const slot = change.equip.slot;
        if (!Number.isInteger(slot) || slot < 0 || slot > 16) throw new Error('equip slot ' + slot + ' is not a valid equipment index');
        player.equipment.items[slot] = { id: change.equip.id, enchant: 0, gems: [] };
    }
}

async function priceCauses(raw, { budget, causes }, deps = {}) {
    const d = { modelFor: Models.modelFor, combatant: Sim._internals.combatant, buildBaseline: Sim._internals.buildModelBaseline, checkedBinaries: Sim._internals.checkedBinaries, simulate: Sim._internals.simulate, ...deps };
    const result = { status: 'unavailable', rotation: 'unvalidated', prices: {}, assumptions: [] };
    if (!budget || budget.status !== 'decomposed') return { ...result, reason: 'No damage budget to price.' };
    const resolved = d.modelFor(raw?.player);
    if (resolved.kind !== 'native' || resolved.model.role === 'TANK') return { ...result, reason: resolved.reason || 'No native DPS model for this specialization.' };
    const model = resolved.model;
    result.rotation = model.requiresTalentOverride || model.id === 'rogue-assassination' || !raw?.modelOverrides?.talentsString ? 'unvalidated' : 'validated';
    let binaries; try { binaries = await d.checkedBinaries(); } catch (error) { return { ...result, reason: error.message }; }
    let info; try { info = d.combatant(raw); } catch (error) { return { ...result, reason: error.message }; }
    if (!info?.gear || !Array.isArray(info.gear) || info.gear.length < 16) return { ...result, reason: 'A complete combatant equipment snapshot is required to price changes.' };
    let built; try { built = d.buildBaseline(raw, info, model); } catch (error) { return { ...result, reason: 'Model build failed: ' + error.message }; }
    const baselineRequest = clone(built.request); baselineRequest.simOptions.iterations = ITERATIONS;
    let baseline; try { baseline = await d.simulate(baselineRequest, binaries.sim); } catch (error) { return { ...result, reason: 'WoWSims execution failed: ' + error.message }; }
    const playerObserved = Number(budget.player?.dps) || 0;
    const referenceObserved = Number(budget.reference?.dps) || 0;
    const sane = observed => observed > 0 && baseline.dps / observed >= SANITY.low && baseline.dps / observed <= SANITY.high;
    result.baselineDps = Math.round(baseline.dps);
    if (!sane(playerObserved) && !sane(referenceObserved)) {
        const referenceName = budget.reference?.name || 'reference';
        return { ...result, status: 'withheld', reason: 'The model baseline (' + Math.round(baseline.dps) + ' DPS) cannot reproduce the observed ' + Math.round(playerObserved) + ' (you) or ' + Math.round(referenceObserved) + ' (' + referenceName + ') DPS; enter your talents in Model settings to price gear and buffs.' };
    }
    let priced; try {
        const size = c => c.bucket === 'all' ? Math.abs(Number(budget.gapDps) || 0) : Math.abs(Number(budget.buckets.find(b => b.id === c.bucket)?.differenceDps) || 0);
        priced = (causes || []).filter(c => c.sim && ['you', 'raid'].includes(c.owner)).sort((a, b) => size(b) - size(a)).slice(0, MAX_SCENARIOS);
    } catch (error) { return { ...result, reason: error.message }; }
    for (const cause of priced) {
        const request = clone(built.request); request.simOptions.iterations = ITERATIONS;
        try { applyChange(request, cause.sim); const run = await d.simulate(request, binaries.sim); result.prices[cause.id] = { dps: Math.round(run.dps - baseline.dps), iterations: run.iterations }; }
        catch (error) { result.assumptions.push(cause.id + ' could not be priced: ' + error.message); }
    }
    result.status = 'priced';
    result.assumptions.unshift('Prices are one change at a time on your reconstructed character with ' + ITERATIONS + ' iterations; ' + (result.rotation === 'validated' ? 'validated rotation.' : 'unvalidated rotation, so only stat deltas are shown and never an absolute DPS.'));
    return result;
}
module.exports = { boundFor, priceCauses, applyChange, SANITY, ITERATIONS, MAX_SCENARIOS };
