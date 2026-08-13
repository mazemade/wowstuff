#!/usr/bin/env node
// Runs every request through wowsimcli and collects DPS, TPS and DTPS.
//
// One run yields all three metrics (brief §6 method note), so there is no need to sim three
// times. Results are written incrementally: a full pass is long, and a crash 300 sims in
// should not throw away the first 300.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const here = p => new URL(p, import.meta.url);
const cli = here('./vendor/wowsimcli').pathname;
const outPath = here('./out/results.json');

const results = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const files = readdirSync(here('./out/requests/')).filter(f => f.endsWith('.json')).sort();
const resume = process.argv.includes('--resume');

let done = 0;
for (const f of files) {
    const key = f.replace('.json', '');
    done++;
    if (resume && results[key]) continue;
    const inPath = here('./out/requests/' + f).pathname;
    let out;
    try {
        out = JSON.parse(execFileSync(cli, ['sim', '--infile', inPath], {
            maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
        }));
    } catch (e) {
        console.error(`${key}: CLI FAILED — ${e.message.split('\n')[0]}`);
        continue;
    }
    if (out.error) {
        console.error(`${key}: SIM ERROR — ${out.error.message.split('\n')[0]}`);
        continue;
    }
    const m = out.raidMetrics.parties[0].players[0];
    results[key] = {
        dps: m.dps.avg,
        tps: m.threat ? m.threat.avg : null,
        dtps: m.dtps ? m.dtps.avg : null,
    };
    writeFileSync(outPath, JSON.stringify(results, null, 1));
    console.log(`[${done}/${files.length}] ${key} -> ${Math.round(m.dps.avg)} dps`);
}
console.log(`done: ${Object.keys(results).length} results`);
