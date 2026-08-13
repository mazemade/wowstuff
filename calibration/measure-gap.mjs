#!/usr/bin/env node
// Brute-force the true optimum for small rosters (n <= 11) and compare with the hill-climb.
// Answers spec §8's question: is exact set-partitioning search worth building at all?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../assignments-engine.js');

const P = (name, cls, spec) => ({ name, class: cls, spec });
const ROSTERS = {
    'enh-melee-hunters-10': [
        P('Enh', 'SHAMAN', 'Enhancement'), P('W1', 'WARRIOR', 'Fury'), P('W2', 'WARRIOR', 'Fury'),
        P('W3', 'WARRIOR', 'Arms'), P('H1', 'HUNTER', 'Beast Mastery'), P('Sh2', 'SHAMAN', 'Restoration'),
        P('H2', 'HUNTER', 'Beast Mastery'), P('H3', 'HUNTER', 'Survival'), P('Cat', 'DRUID', 'Feral'),
        P('R1', 'ROGUE', 'Combat'),
    ],
    'caster-pally-9': [
        P('Ele', 'SHAMAN', 'Elemental'), P('M1', 'MAGE', 'Arcane'), P('M2', 'MAGE', 'Arcane'),
        P('L1', 'WARLOCK', 'Destruction'), P('PP', 'PALADIN', 'Protection'), P('SP', 'PRIEST', 'Shadow'),
        P('H1', 'PRIEST', 'Holy'), P('H2', 'DRUID', 'Restoration'), P('RSh', 'SHAMAN', 'Restoration'),
    ],
    'two-full-groups-10': [
        P('Enh', 'SHAMAN', 'Enhancement'), P('W1', 'WARRIOR', 'Fury'), P('W2', 'WARRIOR', 'Fury'),
        P('W3', 'WARRIOR', 'Arms'), P('R1', 'ROGUE', 'Combat'), P('R2', 'ROGUE', 'Combat'),
        P('H1', 'HUNTER', 'Beast Mastery'), P('H2', 'HUNTER', 'Beast Mastery'),
        P('H3', 'HUNTER', 'Survival'), P('Sh2', 'SHAMAN', 'Restoration'),
    ],
    'mt-floor-11': [
        Object.assign(P('Tank', 'WARRIOR', 'Protection'), { mt: true }),
        P('Resto', 'SHAMAN', 'Restoration'), P('Holy1', 'PRIEST', 'Holy'), P('Holy2', 'PRIEST', 'Holy'),
        P('Holy3', 'PRIEST', 'Holy'), P('Hunt1', 'HUNTER', 'Survival'), P('Hunt2', 'HUNTER', 'Survival'),
        P('Hunt3', 'HUNTER', 'Survival'), P('Hunt4', 'HUNTER', 'Survival'),
        P('Bear1', 'DRUID', 'Guardian'), P('Bear2', 'DRUID', 'Guardian'),
    ],
};

function bestPartition(roster, groupCount) {
    let best = null;
    const groups = Array.from({ length: groupCount }, () => []);
    (function assign(i, maxUsed) {
        if (i === roster.length) {
            const layout = groups.map(g => ({ role: 'x', players: g.slice() }));
            const v = E.layoutViolations(layout), s = E.scoreLayout(layout);
            if (!best || v < best.v || (v === best.v && s > best.s)) {
                best = { v, s, layout: layout.map(g => g.players.map(p => p.name)) };
            }
            return;
        }
        // canonical: player i may open at most one new group — kills group-permutation symmetry
        for (let g = 0; g <= Math.min(maxUsed + 1, groupCount - 1); g++) {
            if (groups[g].length >= 5) continue;
            groups[g].push(roster[i]);
            assign(i + 1, Math.max(maxUsed, g));
            groups[g].pop();
        }
    })(0, -1);
    return best;
}

for (const [name, roster] of Object.entries(ROSTERS)) {
    const groupCount = Math.min(5, Math.ceil(roster.length / 5));
    const exact = bestPartition(roster, groupCount);
    const res = E.proposeGroups(roster);
    const gapPct = exact.s ? (exact.s - res.score) / exact.s * 100 : 0;
    console.log(`${name}: exact (v=${exact.v}) ${exact.s.toFixed(1)} vs climb (v=${res.violations}) ${res.score.toFixed(1)} -> gap ${gapPct.toFixed(2)}%`);
    if (gapPct > 0.005) {
        console.log(`    exact: ${exact.layout.map(g => g.join(',')).join(' | ')}`);
        console.log(`    climb: ${res.groups.map(g => g.players.map(p => p.name).join(',')).join(' | ')}`);
    }
}
