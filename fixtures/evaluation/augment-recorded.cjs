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
function augment(fixtureFile, rawDir) {
    const file = path.join(root, 'fixtures', 'evaluation', fixtureFile);
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const fight of fixture.fights) {
        const raw = JSON.parse(fs.readFileSync(path.join(root, 'output', rawDir, 'raw-' + fight.fightId + '.json'), 'utf8'));
        fight.tables.ci ||= ciFor(raw); fight.tables.buffs ||= bands(raw.tables.buffs); fight.gearAudit ||= audit(fight.tables.ci, raw.player.classToken);
        fight.context.debuffs ||= bands(raw.context.debuffs); fight.context.dmgAll ||= raw.context.dmgAll;
        for (const ref of fight.references || []) {
            const source = (raw.references || []).find(r => r.reportCode === ref.reportCode && r.fightId === ref.fightId && r.sourceId === ref.sourceId);
            if (!source) continue;
            ref.tables.ci = ciFor(source); ref.tables.buffs = bands(source.tables.buffs); ref.gearAudit = audit(ref.tables.ci, source.player.classToken);
            ref.context.dmgAll = { data: { entries: (source.context?.dmgAll?.data?.entries || []).filter(a => a.id === source.sourceId).map(a => ({ id: a.id, name: a.name, total: a.total, activeTime: a.activeTime })) } };
        }
    }
    fs.writeFileSync(file, JSON.stringify(fixture));
    console.log('augmented', fixtureFile);
}
augment('utopik-investigation.json', 'utopik-deep-dive');
augment('funkell-hunter.json', 'funkell-deep-dive');
