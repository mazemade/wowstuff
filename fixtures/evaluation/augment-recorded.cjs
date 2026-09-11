'use strict';
// Adds the fields the damage-budget engine needs to the two recorded fixtures, from local raw
// captures that are not committed. Run from the repo root: node fixtures/evaluation/augment-recorded.cjs
const fs = require('fs'), path = require('path');
const V = require('../../vet-engine');
const db = V.indexDb(require('../../data/tbc-item-db.json'));
const root = path.join(__dirname, '..', '..');
const bands = (table) => table && { data: { auras: (table.data?.auras || []).map(a => ({ name: a.name, guid: a.guid, type: a.type, totalUptime: a.totalUptime, totalUses: a.totalUses, bands: a.bands })) } };
const audit = (ci, classToken) => { const row = ci?.data?.[0]; if (!row?.gear) return undefined; const a = V.summarizeGear(row.gear.map(g => ({ ...g, gems: g.gems?.filter(gem => gem.id > 0) })), db, classToken); return { slots: a.slots, unknownItems: a.unknownItems }; };
const ciFor = (raw) => { const row = raw.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId); return row ? { data: [row] } : undefined; };
// funkell-hunter.json rows carry hitdetails but no missdetails (the Utopik fixture has both).
// Copy missdetails from the matching raw row so damage-budget factors are not silently null.
function addMissdetails(fixtureTable, rawTable) {
    const fixtureRows = fixtureTable?.data?.entries, rawRows = rawTable?.data?.entries;
    if (!Array.isArray(fixtureRows) || !Array.isArray(rawRows)) return;
    for (const row of fixtureRows) {
        if (Array.isArray(row.missdetails)) continue;
        const match = rawRows.find(r => r.guid === row.guid) || rawRows.find(r => r.name === row.name);
        if (Array.isArray(match?.missdetails)) row.missdetails = match.missdetails;
    }
}
function augment(fixtureFile, rawDir) {
    const file = path.join(root, 'fixtures', 'evaluation', fixtureFile);
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const fight of fixture.fights) {
        const raw = JSON.parse(fs.readFileSync(path.join(root, 'output', rawDir, 'raw-' + fight.fightId + '.json'), 'utf8'));
        // Unconditional refresh, matching how references are already handled below: an earlier
        // capture left this fixture's own combatant row stripped to {sourceID, gear}, with no
        // strength/agility/hitMelee/expertise — the budget engine needs those, and the current
        // raw capture has the full WCL combatant-info row, so prefer it over any stale stub.
        fight.tables.ci = ciFor(raw) || fight.tables.ci; fight.tables.buffs ||= bands(raw.tables.buffs); fight.gearAudit ||= audit(fight.tables.ci, raw.player.classToken);
        fight.context.debuffs ||= bands(raw.context.debuffs); fight.context.dmgAll ||= raw.context.dmgAll;
        addMissdetails(fight.tables.dmg, raw.tables.dmg);
        for (const ref of fight.references || []) {
            const source = (raw.references || []).find(r => r.reportCode === ref.reportCode && r.fightId === ref.fightId && r.sourceId === ref.sourceId);
            if (!source) continue;
            ref.tables.ci = ciFor(source); ref.tables.buffs = bands(source.tables.buffs); ref.gearAudit = audit(ref.tables.ci, source.player.classToken);
            ref.context.dmgAll = { data: { entries: (source.context?.dmgAll?.data?.entries || []).filter(a => a.id === source.sourceId).map(a => ({ id: a.id, name: a.name, total: a.total, activeTime: a.activeTime })) } };
            addMissdetails(ref.tables.dmg, source.tables.dmg);
        }
    }
    fs.writeFileSync(file, JSON.stringify(fixture));
    console.log('augmented', fixtureFile);
}
augment('utopik-investigation.json', 'utopik-deep-dive');
augment('funkell-hunter.json', 'funkell-deep-dive');
