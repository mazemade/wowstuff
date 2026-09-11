'use strict';
// Replay the production evidence and composition functions on projected real WCL data.
const { combinedEvidence, VERSION } = require('../../evaluation-service');
const { buildFightCoaching, buildNightCoaching } = require('../../evaluation-coaching');
const captures = require('./utopik-investigation.json');
function utopikReport() {
    const result = { schemaVersion: 2, version: VERSION, player: captures.fights[0].player, night: { code: captures.provenance.reportCode, date: captures.provenance.date }, generatedAt: '2026-09-11T10:00:00.000Z', limitations: [] };
    result.fights = captures.fights.map(capture => {
        const raw = structuredClone(capture), f = raw.context.fights[0];
        const fight = { id: raw.reportCode + '/' + raw.fightId, name: raw.name, player: raw.player, durationSec: (f.endTime - f.startTime) / 1000, encounter: raw.encounter,
            wclUrl: 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId,
            ...combinedEvidence(raw), simulation: { status: 'unsupported', actions: [], packages: [], reason: 'Recorded evidence replay; no modeled gains are assigned.' },
            pricing: { status: 'unavailable', reason: 'Recorded evidence replay; no simulator.', prices: {} } };
        fight.coaching = buildFightCoaching(fight); return fight;
    });
    result.coaching = buildNightCoaching(result);
    return result;
}
module.exports = { utopikReport };
