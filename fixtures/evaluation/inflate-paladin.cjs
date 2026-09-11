'use strict';
function inflate(sample, reference) {
    const start = sample.fight.startTime, sourceID = sample.sourceId;
    const event = (time, type, abilityGameID) => ({ timestamp: start + time * 1000, type, abilityGameID, sourceID, targetID: sample.fightId + 70 });
    const events = [], series = sample.series, bloodCast = sample.player.name === 'Varenthil' ? 31892 : 348700, bloodProc = sample.player.name === 'Varenthil' ? 31893 : 348701;
    const add = (times, type, id) => (times || []).forEach(time => events.push(event(time, type, id)));
    add(series.commandRemove, 'removebuff', 20375); add(series.commandApply, 'applybuff', 20375); add(series.commandRefresh, 'refreshbuff', 20375);
    add(series.bloodRemove, 'removebuff', bloodCast); add(series.bloodApply, 'applybuff', bloodCast); add(series.bloodCast, 'cast', bloodCast);
    add(series.white, 'damage', 1); add(series.cs, 'cast', 35395); add(series.cs, 'damage', 35395); add(series.judgement, 'cast', 20271);
    add(series.commandProc, 'damage', 20424); add(series.bloodProc, 'damage', bloodProc); add(series.exo, 'cast', 27138); add(series.aw, 'cast', 31884);
    events.sort((a, b) => a.timestamp - b.timestamp || ({ removebuff: 0, applybuff: 1, refreshbuff: 1, cast: 2, damage: 3 }[a.type] - { removebuff: 0, applybuff: 1, refreshbuff: 1, cast: 2, damage: 3 }[b.type]));
    const raw = {
        reportCode: sample.reportCode, fightId: sample.fightId, sourceId: sourceID, player: sample.player,
        context: { fights: [sample.fight], masterData: { actors: sample.actors }, dmgAll: { data: { entries: [{ id: sourceID, total: 100000 }] } } },
        tables: { dmg: { data: { entries: [{ guid: 1, name: 'Melee', total: 100000, hitCount: series.white.length }] } }, buffs: { data: { auras: sample.buffs.map(aura => ({ ...aura, bands: aura.bands.map(band => ({ startTime: start + band[0] * 1000, endTime: start + band[1] * 1000 })) })) } } },
        events: { complete: true, data: events },
        incoming: { complete: true, data: sample.incoming.map(([time, type, abilityGameID]) => ({ timestamp: start + time * 1000, type, abilityGameID, sourceID: sample.actors.find(actor => actor.type === 'NPC').id, targetID: sourceID })) },
    };
    if (reference) raw.references = [{ ...inflate(reference), kind: 'benchmark' }];
    return raw;
}
module.exports = { inflate };
