# Parse Feedback Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Feedback report" button on the vetting page that produces a short, copyable, player-facing note explaining why a player's parses are low and what to do about it, from measured Warcraft Logs facts.

**Architecture:** A Node-only module `vet-feedback.js` gathers per-kill fight data from Warcraft Logs (WCL), compares the player with same-spec players within two item levels, and derives a deterministic facts sheet of findings. The server route `GET /api/vet/feedback` builds that sheet, asks OpenAI to write the prose under a facts-only prompt, guards the reply against invented numbers, and caches the result. The vetting page renders the report with a Copy button and a collapsible facts table.

**Tech Stack:** Node 18+ (no new dependencies), Express 4, vanilla browser JS, the repo's hand-rolled `assert`-based node test runner (`node <file>.test.js`), headless Chrome over CDP for the browser smoke check.

**Spec:** `docs/superpowers/specs/2026-09-04-parse-feedback-report-design.md`

## Global Constraints

- No new npm dependencies (`package.json` has only `express`). Node `>=18`; the server uses global `fetch`.
- WCL classic API v2 at `https://classic.warcraftlogs.com/api/v2/client` through the existing `wclQuery()` in `server.js`. Credentials come from `.env` (`WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`); never hardcode them.
- OpenAI through `process.env.OPENAI_API_KEY`, model `process.env.OPENAI_MODEL || 'gpt-5-mini'`, exactly as `/api/ai-review` does today.
- Current tier zone id **1060** (BT / Hyjal); previous tier **1056**. Encounter ids come from the vetting profile's `parses.bosses[].encounterId`.
- `vet-feedback.js` is Node-only (plain `require`, no UMD), like `vet-profile.js`. All pure logic must be testable with the fixture and no network.
- Test files follow `vet-profile.test.js`: `assert` from `node:assert`, a local `test(name, fn)` helper that also accepts promises, a final `${passed} passed, ${failed} failed` line and `process.exitCode = failed ? 1 : 0`.
- Reference band: item level ±2, widen once to ±4, stop paging at 8 in-band ranks, at most 5 pages, need at least 3; per-cast comparisons use the 3 highest-ranked in-band players; reference cache 24 hours; analyse at most 8 killed bosses, lowest median first.
- Every failure on the page is a row state or a status line. No `alert()`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not commit the unrelated modified files `RaidAssign/Scan.lua` and `raid-spec-scan.test.lua` or the `.local.md` plans; stage only the files each task names.

---

## File map

| File | Responsibility |
|---|---|
| `fixtures/wcl-feedback-rotminster.json` (on disk, untracked) | Real WCL answers captured 2026-09-04 for Rotminster-Spineshatter (EU, Destruction warlock): encounter ranks, two kills' fight context and player tables, two bosses' reference ranking pages and three reference players each. Trimmed to the fields the module reads. |
| `vet-feedback.js` (create) | Constants and tables; fight context and bad-pull detection; ability, cast, aura and stat facts; reference band selection and summary; findings; merge and ranking; facts sheet; prompt; number guard; WCL orchestration `fetchFeedback`. |
| `vet-feedback.test.js` (create) | Node tests for all of the above against the fixture and a stubbed `query`. |
| `server.js` (modify) | Extract `loadProfile`, `openaiChat`, `ANNIVERSARY_RULES`; add `GET /api/vet/feedback` with a 15-minute cache and the shared reference cache. |
| `vetting.js`, `vetting.css` (modify) | "Feedback report" button, report box, Copy, facts table, local persistence. |
| `package.json` (modify) | Add `vet-feedback.test.js` to `npm test`. |
| `README.md` (modify) | Document the report and its two env vars. |

## Fixture shape (read this before any task)

```
{
  capturedAt, source, player: { name, server, region }, classID: 10,
  encounterRankings: { "50619": { totalKills, ranks: [ { rankPercent, duration, amount, bracketData, spec, startTime, report: { code, fightID } } ] }, "50620": {...} },
  kills: { "50619": { code, fightID, sourceID: 12,
             context: { masterData: { actors: [ { id, name, subType } ] }, fights: [ { id, name, startTime, endTime, kill } ],
                        rankings: { data: [ { duration, deaths, bracketData, speed: { rankPercent }, execution: { rankPercent },
                                              roles: { dps: { characters: [ { name, amount, rankPercent } ] }, healers: {...}, tanks: {...} } } ] },
                        dmgAll: { data: { totalTime, entries: [ { name, type, total, activeTime, activeTimeReduced, itemLevel, gear?, talents? } ] } },
                        deaths: { data: { entries: [ { name, timestamp, killingBlow: { name } } ] } },
                        summary: { data: { totalTime, itemLevel, playerDetails: { dps: [ { name, id, potionUse, healthstoneUse, minItemLevel } ] } } },
                        debuffs: { data: { totalTime, auras: [ { name, guid, totalUptime, totalUses } ] } } },
             tables: { dmg: { data: { totalTime, entries: [ { name, guid, total, uses, hitCount, critHitCount, missCount, tickCount, critTickCount, hitdetails: [ { type, count, total } ] } ] } },
                       casts: { data: { totalTime, entries: [ { name, guid, total } ] } },
                       buffs: { data: { totalTime, auras: [ { name, guid, totalUptime, totalUses } ] } },
                       ci: { data: [ { sourceID, auras: [ { name, ability } ], talents, gear, hitSpell, critSpell, ... } ] } } },
           "50620": { ... ci.data is EMPTY for this kill ... } },
  reference: { "50619": { pages: [ { page, hasMorePages, count, rankings: [ { name, class, spec, amount, duration, bracketData, server, report: { code, fightID } } ] } ],
                          players: [ { rank, sourceID, context: { fights, dmgAll: { data: { totalTime, entries: [ one row with gear ] } }, masterData: { actors: [ me ] } }, tables: { dmg, casts, buffs, ci } } ] },
               "50620": {...} }
}
```

Numbers the tests below assert were computed from this fixture on 2026-09-04 with `data/tbc-item-db.json`:

| Fact | Anetheron (50619) | Kaz'rogal (50620) |
|---|---|---|
| Fight length | 130.855 s | 1130.635 s |
| Rotminster active | 91.6% (raid DPS median 92.4%) | 16.7% |
| Raid DPS | 16, Rotminster 9th, median percentile 25.5 | 19, all 19 under percentile 5 |
| Shadow Bolt | 42 hits, crit 26.2%, avg non-crit 3087, share 93.3% | crit 20.0% |
| Casts | 55 total, 25.2/min, Immolate 5, Shadow Bolt 43 | Seed of Corruption 119 |
| Pull auras | Elixir of Draenic Wisdom, Major Shadow Power, Well Fed, Arcane Brilliance, Greater Blessing of Kings/Wisdom/Salvation | no CombatantInfo row |
| Potions | 1 | 2 |
| Bloodlust uptime | 31% | 4% |
| Debuffs | Curse of the Elements 91%; no Misery, Shadow Weaving, Fire Vulnerability | Curse of the Elements 33% |
| Gear stats | spell damage 986, spell crit rating 222, spell hit 207, GearScore 1854, avg ilvl 123.82 | |
| Reference, band 122–126 | page 1 holds 29 in-band ranks; median DPS 2684, median length 94.7 s | |
| Reference players | Zûl 122, Cosmos 126, Thiatal 126: Shadow Bolt crit medians 58.8%, avg non-crit 4215; spell damage 1001; crit rating 345; 30.5 casts/min; active 89.5%; Moonkin Aura on 3/3, Prayer of Spirit 2/3, a flask on 2/3 (Flask of Pure Death) | Daini 125, Zhaur 123, Outstandingx 126 |

---

### Task 1: Fixture, module skeleton, spec names, schools, kill selection

**Files:**
- Commit: `fixtures/wcl-feedback-rotminster.json` (already on disk, untracked; verify with `ls -la fixtures/`)
- Create: `vet-feedback.js`
- Create: `vet-feedback.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `wclSpecName(spec) -> string`, `schoolsOf(classToken, spec, role) -> string[]`, `pickKills(profile) -> [{ encounterId, name, medianPercent }]`, `median(numbers) -> number|null`, `round1(x) -> number|null`, constants `KILL_LIMIT`, `REF`, `T`, `WCL_CLASS_NAME`.

- [ ] **Step 1: Verify the fixture exists and parses**

Run: `node -e "const f=require('./fixtures/wcl-feedback-rotminster.json'); console.log(Object.keys(f.kills), f.reference['50619'].players.length)"`
Expected: `[ '50619', '50620' ] 3`

- [ ] **Step 2: Write the failing tests**

Create `vet-feedback.test.js`:

```js
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vet-engine.js');
const P = require('./vet-profile.js');
const F = require('./vet-feedback.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
    try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { passed++; console.log('ok -', name); }, e => { failed++; console.error('FAIL -', name, '\n   ', e.message); })); } else { passed++; console.log('ok -', name); } }
    catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
}

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-feedback-rotminster.json'), 'utf8'));
const db = V.indexDb(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tbc-item-db.json'), 'utf8')));
const PLAYER = { name: 'Rotminster', classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', schools: ['shadow'] };
const NAMES = { 50619: 'Anetheron', 50620: "Kaz'rogal" };

// --- Task 1: names, schools, kill selection
test('wclSpecName strips spaces the way WCL spells specs', () => {
    assert.strictEqual(F.wclSpecName('Beast Mastery'), 'BeastMastery');
    assert.strictEqual(F.wclSpecName('Destruction'), 'Destruction');
    assert.strictEqual(F.WCL_CLASS_NAME.WARLOCK, 'Warlock');
});
test('schoolsOf: casters by spec, physical roles physical, healers none', () => {
    assert.deepStrictEqual(F.schoolsOf('WARLOCK', 'Destruction', 'caster'), ['shadow']);
    assert.deepStrictEqual(F.schoolsOf('MAGE', 'Fire', 'caster'), ['fire']);
    assert.deepStrictEqual(F.schoolsOf('ROGUE', 'Combat', 'melee'), ['physical']);
    assert.deepStrictEqual(F.schoolsOf('PALADIN', 'Retribution', 'melee'), ['physical', 'holy']);
    assert.deepStrictEqual(F.schoolsOf('PRIEST', 'Holy', 'healer'), []);
});
test('pickKills: killed bosses only, lowest median first, capped at KILL_LIMIT', () => {
    const bosses = [];
    for (let i = 0; i < 12; i++) bosses.push({ encounterId: 100 + i, name: 'B' + i, medianPercent: 50 - i, kills: i === 3 ? 0 : 1 });
    bosses.push({ encounterId: 200, name: 'NoMedian', medianPercent: null, kills: 1 });
    const picked = F.pickKills({ parses: { bosses } });
    assert.strictEqual(picked.length, F.KILL_LIMIT);
    assert.strictEqual(picked[0].encounterId, 111);          // median 39, the lowest
    assert.ok(!picked.some(k => k.encounterId === 103));     // no kills
    assert.ok(!picked.some(k => k.encounterId === 200));     // null median sorts last, past the cap
    assert.deepStrictEqual(F.pickKills({ parses: null }), []);
});
test('median and round1', () => {
    assert.strictEqual(F.median([3, 1, 2]), 2);
    assert.strictEqual(F.median([4, 1, 2, 3]), 2.5);
    assert.strictEqual(F.median([]), null);
    assert.strictEqual(F.round1(130.855), 130.9);
    assert.strictEqual(F.round1(null), null);
});

Promise.all(pending).then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node vet-feedback.test.js`
Expected: throws `Cannot find module './vet-feedback.js'`.

- [ ] **Step 4: Create the module skeleton**

Create `vet-feedback.js`:

```js
'use strict';
// Node-only. Turns Warcraft Logs fight data into a parse feedback facts sheet for one player, and
// builds the prompt that turns that sheet into a player-facing report. The GraphQL `query`
// function is injected, as in vet-profile.js: the server passes wclQuery, the tests pass a stub.
const V = require('./vet-engine.js');

const KILL_LIMIT = 8;
// Reference selection: same spec, same boss, same region, item level within `band` of the
// player; widened once to `wideBand` when fewer than `min` ranks are found.
const REF = { band: 2, wideBand: 4, target: 8, min: 3, players: 3, maxPages: 5, cacheMs: 24 * 60 * 60 * 1000 };
// Finding thresholds (spec §4). Not user-editable in v1.
const T = {
    activeMajor: 85, activeGap: 8, castsLowRatio: 0.85, diedBefore: 0.9,
    unusedPerMin: 1.5, extraPerMin: 1, ratioLow: 0.7,
    critGap: 10, hitRatio: 0.85, resistGap: 10,
    statPrimaryRatio: 0.9, statSecondaryRatio: 0.85,
    debuffUptime: 70, potionMinSec: 60,
    longFightRatio: 2, raidUnderPercent: 5, raidUnderShare: 0.8, raidSpeedLow: 5,
};

const WCL_CLASS_NAME = { DRUID: 'Druid', HUNTER: 'Hunter', MAGE: 'Mage', PALADIN: 'Paladin', PRIEST: 'Priest', ROGUE: 'Rogue', SHAMAN: 'Shaman', WARLOCK: 'Warlock', WARRIOR: 'Warrior' };
// WCL spells spec names without spaces: 'Beast Mastery' -> 'BeastMastery'.
function wclSpecName(spec) { return String(spec || '').replace(/[^A-Za-z]/g, ''); }

// Damage schools per spec, used to pick the raid debuffs that matter to the player. Specs not
// listed are physical when the role is melee/ranged/tank and have no school otherwise (healers).
const SPEC_SCHOOLS = {
    'PRIEST:Shadow': ['shadow'], 'WARLOCK:Affliction': ['shadow'], 'WARLOCK:Demonology': ['shadow'], 'WARLOCK:Destruction': ['shadow'],
    'MAGE:Arcane': ['arcane'], 'MAGE:Fire': ['fire'], 'MAGE:Frost': ['frost'], 'DRUID:Balance': ['arcane'],
    'SHAMAN:Elemental': ['nature'], 'PALADIN:Retribution': ['physical', 'holy'],
};
function schoolsOf(classToken, spec, role) {
    const s = SPEC_SCHOOLS[String(classToken || '').toUpperCase() + ':' + spec];
    if (s) return s;
    return (role === 'melee' || role === 'ranged' || role === 'tank') ? ['physical'] : [];
}

// The gating tier's killed bosses, lowest median first, capped: the worst parses are where the
// explanation lives, and every boss costs about ten WCL points.
function pickKills(profile) {
    const p = profile && profile.parses;
    if (!p || !Array.isArray(p.bosses)) return [];
    const med = b => (typeof b.medianPercent === 'number' ? b.medianPercent : 101);
    return p.bosses.filter(b => b && b.kills > 0 && b.encounterId)
        .slice().sort((a, b) => med(a) - med(b))
        .slice(0, KILL_LIMIT)
        .map(b => ({ encounterId: b.encounterId, name: b.name, medianPercent: b.medianPercent }));
}

function median(values) {
    const v = (values || []).filter(x => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function round1(x) { return typeof x === 'number' ? Math.round(x * 10) / 10 : null; }
function lower(s) { return String(s || '').toLowerCase(); }

module.exports = { KILL_LIMIT, REF, T, WCL_CLASS_NAME, SPEC_SCHOOLS, wclSpecName, schoolsOf, pickKills, median, round1, lower };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node vet-feedback.test.js`
Expected: `4 passed, 0 failed`

- [ ] **Step 6: Wire into npm test**

In `package.json`, change the `test` script to end with `&& node vet-profile.test.js && node vet-feedback.test.js`.

Run: `npm test 2>&1 | tail -3`
Expected: the last suite prints `4 passed, 0 failed` and the command exits 0.

- [ ] **Step 7: Commit**

```bash
git add fixtures/wcl-feedback-rotminster.json vet-feedback.js vet-feedback.test.js package.json
git commit -m "feat: feedback report fixture, module skeleton and kill selection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Fight context and bad-pull detection

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `T`, `median`, `round1`, `lower` from Task 1.
- Produces: `fightContext(ctx, playerName, role, refDurationSec) -> { fight, me, meRow }` where `fight = { durationSec, referenceDurationSec, raidDeaths, raidSpeedPercent, raidExecutionPercent, raidGroup, raidGroupCount, raidGroupRank, raidGroupMedianPercent, raidActivePercent, badPull, badPullReason }`, `me = { dps, activePercent, died: { atSec, by } | null, potionUse, healthstoneUse }`, `meRow` = the player's fight-wide DamageDone entry (carries `gear` when WCL has it) or null.

- [ ] **Step 1: Write the failing tests**

Append to `vet-feedback.test.js` before the `Promise.all` line:

```js
// --- Task 2: fight context
test('fightContext on Anetheron: length, active time, raid rank, potions, not a bad pull', () => {
    const fc = F.fightContext(FX.kills['50619'].context, 'Rotminster', 'caster', 94.7);
    assert.strictEqual(fc.fight.durationSec, 130.9);
    assert.strictEqual(fc.fight.referenceDurationSec, 94.7);
    assert.strictEqual(fc.fight.raidGroup, 'dps');
    assert.strictEqual(fc.fight.raidGroupCount, 16);
    assert.strictEqual(fc.fight.raidGroupRank, 9);
    assert.strictEqual(fc.fight.raidGroupMedianPercent, 25.5);
    assert.strictEqual(fc.fight.raidDeaths, 1);
    assert.strictEqual(fc.fight.raidSpeedPercent, 30);
    assert.strictEqual(fc.fight.raidActivePercent, 92.4);
    assert.strictEqual(fc.fight.badPull, false);
    assert.strictEqual(fc.fight.badPullReason, null);
    assert.strictEqual(fc.me.activePercent, 91.6);
    assert.strictEqual(fc.me.dps, 1300.7);
    assert.strictEqual(fc.me.died, null);
    assert.strictEqual(fc.me.potionUse, 1);
    assert.strictEqual(fc.me.healthstoneUse, 0);
    assert.ok(fc.meRow && Array.isArray(fc.meRow.gear));
});
test('fightContext on Kaz\'rogal: an 1131 s pull where all 19 DPS parsed under 5 is a bad pull', () => {
    const fc = F.fightContext(FX.kills['50620'].context, 'Rotminster', 'caster', 93);
    assert.strictEqual(fc.fight.durationSec, 1130.6);
    assert.strictEqual(fc.fight.badPull, true);
    assert.ok(/1131s against a typical 93s/.test(fc.fight.badPullReason), fc.fight.badPullReason);
    assert.ok(/19 of 19 dps in the raid parsed under 5/.test(fc.fight.badPullReason), fc.fight.badPullReason);
    assert.strictEqual(fc.me.activePercent, 16.7);
    assert.strictEqual(fc.me.potionUse, 2);
    assert.strictEqual(fc.fight.raidDeaths, 3);
});
test('fightContext: a death is reported with time and killing blow; missing tables give nulls', () => {
    const fc = F.fightContext(FX.kills['50619'].context, 'Slyvester', 'caster', null);
    assert.deepStrictEqual(fc.me.died, { atSec: 33, by: 'Immolation' });
    const empty = F.fightContext({}, 'Nobody', 'caster', null);
    assert.strictEqual(empty.fight.durationSec, null);
    assert.strictEqual(empty.fight.raidGroupCount, 0);
    assert.strictEqual(empty.fight.badPull, false);
    assert.strictEqual(empty.me.activePercent, null);
    assert.strictEqual(empty.meRow, null);
});
test('fightContext: healers are ranked among healers, tanks among tanks', () => {
    const ctx = { fights: [{ startTime: 0, endTime: 100000 }], rankings: { data: [{ speed: { rankPercent: 50 }, execution: { rankPercent: 50 },
        roles: { dps: { characters: [{ name: 'D', amount: 1000, rankPercent: 50 }] }, healers: { characters: [{ name: 'H1', amount: 900, rankPercent: 60 }, { name: 'H2', amount: 700, rankPercent: 2 }] }, tanks: { characters: [] } } }] } };
    const fc = F.fightContext(ctx, 'h2', 'healer', null);
    assert.strictEqual(fc.fight.raidGroup, 'healers');
    assert.strictEqual(fc.fight.raidGroupRank, 2);
    assert.strictEqual(fc.fight.raidGroupCount, 2);
    assert.strictEqual(fc.me.dps, 700);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep FAIL`
Expected: four `FAIL - fightContext ...` lines with `F.fightContext is not a function`.

- [ ] **Step 3: Implement fightContext**

Insert into `vet-feedback.js` before the `module.exports` line:

```js
const ROLE_GROUP = { healer: 'healers', tank: 'tanks' };
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// Everything the fight-wide tables say about one pull: its length, how the raid itself ranked,
// where the player sat among their role, active time, death and potions, and whether the pull
// was so bad raid-wide that it says nothing about the player.
function fightContext(ctx, playerName, role, refDurationSec) {
    ctx = ctx || {};
    const fight = Array.isArray(ctx.fights) ? ctx.fights[0] : null;
    const durationSec = fight ? round1((fight.endTime - fight.startTime) / 1000) : null;
    const rank = ctx.rankings && ctx.rankings.data && ctx.rankings.data[0];
    const roles = (rank && rank.roles) || {};
    const me = lower(playerName);
    const groupOf = k => (roles[k] && Array.isArray(roles[k].characters)) ? roles[k].characters : [];
    let groupKey = ROLE_GROUP[role] || 'dps';
    let group = groupOf(groupKey);
    if (!group.some(c => lower(c.name) === me)) {
        const found = ['dps', 'healers', 'tanks'].find(k => groupOf(k).some(c => lower(c.name) === me));
        if (found) { groupKey = found; group = groupOf(found); }
    }
    const sorted = group.slice().sort((a, b) => b.amount - a.amount);
    const idx = sorted.findIndex(c => lower(c.name) === me);
    const under = group.filter(c => c.rankPercent < T.raidUnderPercent).length;

    const dmg = ctx.dmgAll && ctx.dmgAll.data;
    const totalTime = dmg ? dmg.totalTime : null;
    const rows = dmg && Array.isArray(dmg.entries) ? dmg.entries : [];
    const activeOf = row => (totalTime && row && typeof row.activeTime === 'number') ? round1(100 * row.activeTime / totalTime) : null;
    const meRow = rows.find(r => lower(r.name) === me) || null;
    const groupNames = new Set(group.map(c => lower(c.name)));
    const raidActivePercent = round1(median(rows.filter(r => r.type !== 'Pet' && groupNames.has(lower(r.name))).map(activeOf)));

    const deaths = (ctx.deaths && ctx.deaths.data && Array.isArray(ctx.deaths.data.entries)) ? ctx.deaths.data.entries : [];
    const myDeath = deaths.find(d => lower(d.name) === me);
    const pd = (ctx.summary && ctx.summary.data && ctx.summary.data.playerDetails) || {};
    const detail = ['dps', 'healers', 'tanks'].flatMap(k => Array.isArray(pd[k]) ? pd[k] : []).find(p => lower(p.name) === me) || null;
    const speed = rank && rank.speed && typeof rank.speed.rankPercent === 'number' ? rank.speed.rankPercent : null;

    const reasons = [];
    if (refDurationSec && durationSec > T.longFightRatio * refDurationSec) reasons.push('the pull took ' + Math.round(durationSec) + 's against a typical ' + Math.round(refDurationSec) + 's');
    if (group.length && under >= T.raidUnderShare * group.length) reasons.push(under + ' of ' + group.length + ' ' + groupKey + ' in the raid parsed under ' + T.raidUnderPercent);
    if (speed != null && speed < T.raidSpeedLow && idx >= 0 && idx < group.length / 2) reasons.push('the raid\'s kill speed ranked ' + speed + ' while you were ' + ordinal(idx + 1) + ' of ' + group.length + ' ' + groupKey);

    return {
        fight: {
            durationSec, referenceDurationSec: typeof refDurationSec === 'number' ? refDurationSec : null, raidDeaths: deaths.length,
            raidSpeedPercent: speed, raidExecutionPercent: rank && rank.execution && typeof rank.execution.rankPercent === 'number' ? rank.execution.rankPercent : null,
            raidGroup: groupKey, raidGroupCount: group.length, raidGroupRank: idx >= 0 ? idx + 1 : null,
            raidGroupMedianPercent: round1(median(group.map(c => c.rankPercent))), raidActivePercent,
            badPull: reasons.length > 0, badPullReason: reasons.length ? reasons.join('; ') : null,
        },
        me: {
            dps: idx >= 0 ? round1(sorted[idx].amount) : null, activePercent: activeOf(meRow),
            died: myDeath && fight ? { atSec: Math.round((myDeath.timestamp - fight.startTime) / 1000), by: myDeath.killingBlow ? myDeath.killingBlow.name : null } : null,
            potionUse: detail && typeof detail.potionUse === 'number' ? detail.potionUse : null,
            healthstoneUse: detail && typeof detail.healthstoneUse === 'number' ? detail.healthstoneUse : null,
        },
        meRow,
    };
}
```

Add `fightContext` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report fight context and bad-pull detection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Ability, cast, aura and stat facts

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `round1`, `lower`, `VetEngine.summarizeGear(gear, dbIndex, classToken)`, `VetEngine.derivedStats(stats, reported)`.
- Produces:
  - `abilityStats(dmgTable) -> [{ name, total, share, hits, avgHit, avgCrit, critPercent, resistPercent }]` sorted by total desc.
  - `castCounts(castsTable) -> { [abilityName]: count }`; `castsPerMinute(casts, durationSec) -> number|null`.
  - `buffUptime(buffsTable, name) -> percent|null` (0 when the aura never appeared).
  - `classifyAuras(names) -> { flask, battleElixir, guardianElixir, food, oil, consumables: [], buffs: [] }`; `isUtilityGuardian(name) -> bool`.
  - `canonBuffs(names, role) -> string[]` (party buffs from `PARTY_BUFFS[role]` present in `names`, aliases folded).
  - `playerStats(ci, row, dbIndex, classToken) -> { spellDamage, healing, attackPower, rangedAttackPower, spellCrit, meleeCrit, rangedCrit, spellHit, meleeHit, spellHaste, meleeHaste, mp5, avgItemLevel, gearScore } | null`; constant `STAT_KEYS`.

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 3: ability, cast, aura and stat facts
const K19 = FX.kills['50619'], K20 = FX.kills['50620'];
test('abilityStats: Shadow Bolt on Anetheron, sorted by damage', () => {
    const ab = F.abilityStats(K19.tables.dmg);
    assert.strictEqual(ab[0].name, 'Shadow Bolt');
    assert.strictEqual(ab[0].hits, 42);
    assert.strictEqual(ab[0].critPercent, 26.2);
    assert.strictEqual(ab[0].avgHit, 3087);
    assert.strictEqual(ab[0].avgCrit, 6500);
    assert.strictEqual(ab[0].share, 93.3);
    assert.strictEqual(ab[0].resistPercent, 11.9);
    assert.deepStrictEqual(F.abilityStats(null), []);
});
test('castCounts and castsPerMinute', () => {
    const casts = F.castCounts(K19.tables.casts);
    assert.strictEqual(casts['Shadow Bolt'], 43);
    assert.strictEqual(casts.Immolate, 5);
    assert.strictEqual(F.castsPerMinute(casts, 130.855), 25.2);
    assert.strictEqual(F.castsPerMinute(casts, null), null);
    assert.deepStrictEqual(F.castCounts(undefined), {});
});
test('buffUptime: Bloodlust 31% on Anetheron, 0 when absent, null without a table', () => {
    assert.strictEqual(F.buffUptime(K19.tables.buffs, 'Bloodlust'), 31);
    assert.strictEqual(F.buffUptime(K19.tables.buffs, 'Not A Buff'), 0);
    assert.strictEqual(F.buffUptime(null, 'Bloodlust'), null);
});
test('classifyAuras: elixirs, food, flask forms, everything else is a buff', () => {
    const c = F.classifyAuras(K19.tables.ci.data[0].auras.map(a => a.name));
    assert.strictEqual(c.flask, null);
    assert.strictEqual(c.battleElixir, 'Major Shadow Power');
    assert.strictEqual(c.guardianElixir, 'Elixir of Draenic Wisdom');
    assert.strictEqual(c.food, 'Well Fed');
    assert.deepStrictEqual(c.consumables, ['Elixir of Draenic Wisdom', 'Major Shadow Power', 'Well Fed']);
    assert.ok(c.buffs.includes('Arcane Brilliance') && c.buffs.includes('Greater Blessing of Kings'));
    assert.strictEqual(F.classifyAuras(['Pure Death of Shattrath']).flask, 'Pure Death of Shattrath');
    assert.strictEqual(F.classifyAuras(['Flask of Pure Death']).flask, 'Flask of Pure Death');
    assert.strictEqual(F.classifyAuras(["Adept's Elixir"]).battleElixir, "Adept's Elixir");
    assert.strictEqual(F.isUtilityGuardian('Elixir of Draenic Wisdom'), true);
    assert.strictEqual(F.isUtilityGuardian('Elixir of Major Fortitude'), false);
});
test('canonBuffs: party buffs for the role, aliases folded, order of the table', () => {
    const cosmos = FX.reference['50619'].players[1].tables.ci.data[0].auras.map(a => a.name);
    const b = F.canonBuffs(cosmos, 'caster');
    assert.ok(b.includes('Moonkin Aura') && b.includes('Prayer of Spirit') && b.includes('Arcane Brilliance'));
    assert.ok(!b.includes('Greater Blessing of Salvation'));
    assert.deepStrictEqual(F.canonBuffs(['Divine Spirit', 'Battle Shout'], 'melee'), ['Battle Shout']);
    assert.deepStrictEqual(F.canonBuffs(['Divine Spirit'], 'caster'), ['Prayer of Spirit']);
});
test('playerStats: from the CombatantInfo gear with reported ratings, or from the fight-wide row', () => {
    const s = F.playerStats(K19.tables.ci.data[0], null, db, 'WARLOCK');
    assert.strictEqual(s.spellDamage, 986);
    assert.strictEqual(s.spellCrit, 222);
    assert.strictEqual(s.spellHit, 207);
    assert.strictEqual(s.gearScore, 1854);
    assert.strictEqual(s.avgItemLevel, 123.82);
    const row = K20.context.dmgAll.data.entries.find(e => e.name === 'Rotminster');
    const s2 = F.playerStats(null, row, db, 'WARLOCK');
    assert.ok(s2 && s2.spellDamage > 900, 'gear-only stats from the fight-wide row');
    assert.strictEqual(F.playerStats(null, null, db, 'WARLOCK'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `6`

- [ ] **Step 3: Implement the facts helpers**

Insert into `vet-feedback.js` before `module.exports`:

```js
// Per-ability damage facts from a sourceID-scoped DamageDone table. `hitdetails` splits hits into
// Hit / Critical Hit / Resisted Hit / Resisted Critical Hit (partial resists), which is where the
// average non-crit hit and the resist share come from.
function abilityStats(dmgTable) {
    const entries = (dmgTable && dmgTable.data && Array.isArray(dmgTable.data.entries)) ? dmgTable.data.entries : [];
    const total = entries.reduce((s, a) => s + (a.total || 0), 0);
    return entries.map(a => {
        const det = Array.isArray(a.hitdetails) ? a.hitdetails : [];
        const nonCrit = det.find(h => h.type === 'Hit');
        const crit = det.find(h => h.type === 'Critical Hit');
        const resisted = det.filter(h => /Resisted/.test(h.type)).reduce((s, h) => s + (h.count || 0), 0);
        const hits = a.hitCount || 0;
        return {
            name: a.name, total: a.total || 0, share: total ? round1(100 * a.total / total) : 0, hits,
            avgHit: nonCrit && nonCrit.count ? Math.round(nonCrit.total / nonCrit.count) : null,
            avgCrit: crit && crit.count ? Math.round(crit.total / crit.count) : null,
            critPercent: hits ? round1(100 * (a.critHitCount || 0) / hits) : null,
            resistPercent: hits ? round1(100 * resisted / hits) : null,
        };
    }).sort((a, b) => b.total - a.total);
}
function castCounts(castsTable) {
    const out = {};
    const entries = (castsTable && castsTable.data && Array.isArray(castsTable.data.entries)) ? castsTable.data.entries : [];
    entries.forEach(e => { if (e.name) out[e.name] = (out[e.name] || 0) + (e.total || 0); });
    return out;
}
function castsPerMinute(casts, durationSec) {
    if (!durationSec) return null;
    const n = Object.keys(casts || {}).reduce((s, k) => s + casts[k], 0);
    return round1(n / (durationSec / 60));
}
function buffUptime(buffsTable, name) {
    const d = buffsTable && buffsTable.data;
    if (!d || !d.totalTime) return null;
    const a = (Array.isArray(d.auras) ? d.auras : []).find(x => x.name === name);
    return a ? Math.round(100 * a.totalUptime / d.totalTime) : 0;
}

// Consumables as WCL names them in CombatantInfo auras. WCL drops "Elixir of" from some elixirs
// ("Major Shadow Power") and Shattrath flasks read "<flask> of Shattrath", so these are patterns.
const CONSUMABLE = {
    flask: [/^flask of /i, /^unstable flask/i, / of shattrath$/i],
    battle: [/^(elixir of )?major (fire|frost|shadow) ?power/i, /adept'?s elixir/i, /^(elixir of )?major agility/i, /mongoose/i,
             /^(elixir of )?major strength/i, /fel strength/i, /elixir of mastery/i, /healing power/i, /greater arcane elixir/i, /^(elixir of )?the sages/i],
    guardian: [/draenic wisdom/i, /mageblood/i, /^(elixir of )?major fortitude/i, /^(elixir of )?major defense/i, /ironshield/i, /earthen elixir/i, /^(elixir of )?major armor/i],
    food: [/^well fed$/i],
    oil: [/wizard oil/i, /mana oil/i, /sharpening stone/i, /weightstone/i],
};
// Guardian elixirs that give mana or utility rather than damage; a flask does more for a dps.
const UTILITY_GUARDIAN = [/draenic wisdom/i, /mageblood/i];
function isUtilityGuardian(name) { return UTILITY_GUARDIAN.some(re => re.test(String(name || ''))); }
function classifyAuras(names) {
    const has = (list, n) => list.some(re => re.test(n));
    const out = { flask: null, battleElixir: null, guardianElixir: null, food: null, oil: null, consumables: [], buffs: [] };
    (names || []).forEach(n => {
        if (has(CONSUMABLE.flask, n)) { out.flask = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.battle, n)) { out.battleElixir = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.guardian, n)) { out.guardianElixir = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.food, n)) { out.food = n; out.consumables.push(n); }
        else if (has(CONSUMABLE.oil, n)) { out.oil = n; out.consumables.push(n); }
        else out.buffs.push(n);
    });
    return out;
}

// Party-scoped buffs that move the metric, by role. Single-target and greater versions are one
// buff for comparison purposes (BUFF_ALIAS folds them to the canonical name).
const BUFF_ALIAS = {
    'Divine Spirit': 'Prayer of Spirit', 'Arcane Intellect': 'Arcane Brilliance',
    'Blessing of Kings': 'Greater Blessing of Kings', 'Blessing of Wisdom': 'Greater Blessing of Wisdom', 'Blessing of Might': 'Greater Blessing of Might',
};
const PARTY_BUFFS = {
    caster: ['Moonkin Aura', 'Prayer of Spirit', 'Blood Pact', 'Eye of the Night', 'Chain of the Twilight Owl', 'Totem of Wrath', 'Wrath of Air Totem',
             'Arcane Brilliance', 'Greater Blessing of Kings', 'Greater Blessing of Wisdom', 'Fel Intelligence', 'Mana Spring Totem'],
    melee: ['Battle Shout', 'Leader of the Pack', 'Trueshot Aura', 'Ferocious Inspiration', 'Strength of Earth Totem', 'Grace of Air Totem', 'Unleashed Rage',
            'Greater Blessing of Might', 'Greater Blessing of Kings', 'Windfury Totem', 'Blood Pact'],
};
PARTY_BUFFS.healer = PARTY_BUFFS.caster; PARTY_BUFFS.ranged = PARTY_BUFFS.melee; PARTY_BUFFS.tank = PARTY_BUFFS.melee;
function canonBuffs(names, role) {
    const table = PARTY_BUFFS[role] || [];
    const canon = new Set((names || []).map(n => BUFF_ALIAS[n] || n));
    return table.filter(b => canon.has(b));
}

// Gear-derived stats, the same way the vetting profile computes them: WCL-reported ratings win
// where the CombatantInfo row carries them, gear fills the rest. The fight-wide DamageDone row
// carries gear too, which is what reference players (no CombatantInfo query) use.
const STAT_KEYS = ['spellDamage', 'healing', 'attackPower', 'rangedAttackPower', 'spellCrit', 'meleeCrit', 'rangedCrit', 'spellHit', 'meleeHit', 'spellHaste', 'meleeHaste', 'mp5'];
function playerStats(ci, row, dbIndex, classToken) {
    const gear = ci && Array.isArray(ci.gear) ? ci.gear : (row && Array.isArray(row.gear) ? row.gear : null);
    if (!gear || !dbIndex) return null;
    const s = V.summarizeGear(gear, dbIndex, classToken);
    const d = V.derivedStats(s.stats, ci || null);
    const out = {};
    STAT_KEYS.forEach(k => { out[k] = k === 'rangedCrit' ? (ci && typeof ci.critRanged === 'number' ? ci.critRanged : d.meleeCrit) : d[k]; });
    out.avgItemLevel = s.avgItemLevel;
    out.gearScore = s.gearScore;
    return out;
}
```

Add `abilityStats, castCounts, castsPerMinute, buffUptime, CONSUMABLE, isUtilityGuardian, classifyAuras, BUFF_ALIAS, PARTY_BUFFS, canonBuffs, STAT_KEYS, playerStats` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `14 passed, 0 failed`. If `playerStats` asserts differ by a point, print `s` and compare with the fixture table above before touching thresholds: the numbers in this plan were computed with `summarizeGear` + `derivedStats(stats, ci)` exactly as written here.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report ability, cast, aura and stat facts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Reference band selection and summary

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: Task 3 helpers, `median`, `round1`, `lower`, `STAT_KEYS`.
- Produces:
  - `bandRanks(rankings, itemLevel, band) -> rank[]` in page order, only ranks with a report code.
  - `referenceSummary(ranks, players, dbIndex, classToken, role, band) -> { itemLevelBand, sampleSize, playersCompared, dps, topDps, durationSec, castsDurationSec, activePercent, castsPerMinute, casts, abilities, buffsAtPull, flaskShare, flask, bloodlustPercent, stats }` where `players[i] = { rank, sourceID, context: { fights, dmgAll, masterData }, tables: { dmg, casts, buffs, ci } }`.

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 4: reference
function refFor(enc) {
    const R = FX.reference[String(enc)];
    const ranks = F.bandRanks(R.pages.flatMap(p => p.rankings), 124, F.REF.band).slice(0, F.REF.target);
    return F.referenceSummary(ranks, R.players, db, 'WARLOCK', 'caster', [122, 126]);
}
test('bandRanks: item level within the band, page order kept, empty when nobody fits', () => {
    const all = FX.reference['50619'].pages.flatMap(p => p.rankings);
    const page1 = F.bandRanks(FX.reference['50619'].pages[0].rankings, 124, 2);
    assert.strictEqual(page1.length, 29);
    assert.strictEqual(F.bandRanks(all, 124, 2).length, 74);
    assert.ok(F.bandRanks(all, 124, 2).every(r => Math.abs(r.bracketData - 124) <= 2));
    assert.deepStrictEqual(F.bandRanks(all, 200, 2), []);
    assert.strictEqual(F.bandRanks(all, 124, 2)[0].name, FX.reference['50619'].players[0].rank.name);
});
test('referenceSummary on Anetheron: medians over 8 ranks and 3 players', () => {
    const ref = refFor(50619);
    assert.strictEqual(ref.sampleSize, 8);
    assert.strictEqual(ref.playersCompared, 3);
    assert.strictEqual(ref.dps, 2684);
    assert.strictEqual(ref.durationSec, 94.7);
    assert.strictEqual(ref.activePercent, 89.5);
    assert.strictEqual(ref.castsPerMinute, 30.5);
    assert.strictEqual(ref.casts['Shadow Bolt'], 36);
    assert.strictEqual(ref.casts['Life Tap'], 2);
    assert.strictEqual(ref.casts.Shadowburn, undefined, 'only one of three cast it, so it is not a reference ability');
    assert.strictEqual(ref.abilities[0].name, 'Shadow Bolt');
    assert.strictEqual(ref.abilities[0].critPercent, 58.8);
    assert.strictEqual(ref.abilities[0].avgHit, 4215);
    assert.strictEqual(ref.stats.spellDamage, 1001);
    assert.strictEqual(ref.stats.spellCrit, 345);
    assert.ok(ref.buffsAtPull.includes('Moonkin Aura') && ref.buffsAtPull.includes('Prayer of Spirit'));
    assert.strictEqual(ref.flaskShare, 0.7);
    assert.strictEqual(ref.flask, 'Flask of Pure Death');
    assert.ok(ref.topDps >= ref.dps);
    assert.deepStrictEqual(ref.itemLevelBand, [122, 126]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `2`

- [ ] **Step 3: Implement**

Insert before `module.exports`:

```js
function bandRanks(rankings, itemLevel, band) {
    return (Array.isArray(rankings) ? rankings : []).filter(r => r && typeof r.bracketData === 'number' &&
        Math.abs(r.bracketData - itemLevel) <= band && r.report && r.report.code);
}
function countNames(lists) {
    const c = {};
    lists.forEach(l => new Set(l).forEach(n => { c[n] = (c[n] || 0) + 1; }));
    return c;
}
function mostCommon(names) {
    const c = countNames(names.map(n => [n]));
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
}

// What "players like you" do on this boss: DPS and fight length are medians over every in-band
// rank collected; everything that needs a fight's tables (casts, per-ability numbers, buffs,
// consumables, stats) is a median over the fetched reference players. An ability or buff counts
// only when a majority of those players show it, so one player's one-off cast is not "unused".
function referenceSummary(ranks, players, dbIndex, classToken, role, band) {
    const per = (players || []).map(p => {
        const fight = Array.isArray(p.context.fights) ? p.context.fights[0] : null;
        const dur = fight ? (fight.endTime - fight.startTime) / 1000 : null;
        const dmg = p.context.dmgAll && p.context.dmgAll.data;
        const row = dmg && Array.isArray(dmg.entries) ? dmg.entries.find(e => lower(e.name) === lower(p.rank.name)) : null;
        const casts = castCounts(p.tables.casts);
        const ci = p.tables.ci && p.tables.ci.data && p.tables.ci.data[0];
        const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
        return {
            dur, activePercent: row && dmg.totalTime && typeof row.activeTime === 'number' ? round1(100 * row.activeTime / dmg.totalTime) : null,
            casts, castsPerMinute: castsPerMinute(casts, dur), abilities: abilityStats(p.tables.dmg), aur,
            buffs: aur ? canonBuffs(aur.buffs, role) : [], bloodlust: buffUptime(p.tables.buffs, 'Bloodlust'),
            stats: playerStats(ci, row, dbIndex, classToken),
        };
    });
    const n = per.length, majority = Math.floor(n / 2) + 1;
    const medOf = arr => round1(median(arr));
    const castNames = countNames(per.map(p => Object.keys(p.casts)));
    const casts = {};
    Object.keys(castNames).filter(nm => castNames[nm] >= majority).forEach(nm => { casts[nm] = medOf(per.map(p => p.casts[nm] || 0)); });
    const abilityNames = countNames(per.map(p => p.abilities.map(a => a.name)));
    const abilities = Object.keys(abilityNames).filter(nm => abilityNames[nm] >= majority).map(nm => {
        const rows = per.map(p => p.abilities.find(a => a.name === nm)).filter(Boolean);
        return { name: nm, share: medOf(rows.map(r => r.share)), avgHit: medOf(rows.map(r => r.avgHit)), avgCrit: medOf(rows.map(r => r.avgCrit)),
                 critPercent: medOf(rows.map(r => r.critPercent)), resistPercent: medOf(rows.map(r => r.resistPercent)) };
    }).sort((a, b) => (b.share || 0) - (a.share || 0));
    const buffCounts = countNames(per.map(p => p.buffs));
    const withCi = per.filter(p => p.aur).length;
    const flasks = per.filter(p => p.aur && p.aur.flask).map(p => p.aur.flask);
    const stats = {};
    STAT_KEYS.forEach(k => { stats[k] = medOf(per.map(p => p.stats && p.stats[k])); });
    const amounts = ranks.map(r => r.amount);
    return {
        itemLevelBand: band, sampleSize: ranks.length, playersCompared: n,
        dps: Math.round(median(amounts)), topDps: amounts.length ? Math.round(Math.max.apply(null, amounts)) : null,
        durationSec: round1(median(ranks.map(r => r.duration / 1000))), castsDurationSec: medOf(per.map(p => p.dur)),
        activePercent: medOf(per.map(p => p.activePercent)), castsPerMinute: medOf(per.map(p => p.castsPerMinute)),
        casts, abilities, buffsAtPull: Object.keys(buffCounts).filter(b => buffCounts[b] >= majority),
        flaskShare: withCi ? round1(flasks.length / withCi) : 0, flask: mostCommon(flasks),
        bloodlustPercent: medOf(per.map(p => p.bloodlust)), stats,
    };
}
```

Add `bandRanks, countNames, mostCommon, referenceSummary` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `16 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report reference band and summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Kill facts and the player-side findings (uptime, rotation, damage per cast, stats)

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `fightContext` (Task 2), Task 3 helpers, `referenceSummary` output shape (Task 4).
- Produces:
  - `finding(key, severity, scope, text, extra) -> { key, severity: 'major'|'minor'|'info', scope: 'player'|'group', text, ...extra }`.
  - `debuffFacts(debuffTable, schools) -> { known, present: [{ name, uptimePercent, value, source }], missing: [{ name, value, source }] }`; tables `RAID_DEBUFFS`, `OWN_DEBUFF`.
  - `uptimeFindings(kill)`, `rotationFindings(kill)`, `damageFindings(kill)`, `statFindings(kill, role)` each `-> finding[]`; tables `ROLE_STATS`, `STAT_LABEL`, `UTILITY_CAST`.
  - `killFindings(kill, player) -> finding[]` (Task 6 extends it).
  - `killFacts({ encounterId, name, rank, context, tables, sourceId, player, reference, referenceNote, dbIndex }) -> kill` with `{ encounterId, name, rankPercent, date, reportCode, fightId, wclUrl, fight, debuffs, me, reference, referenceNote, findings }`, where `me` = Task 2's `me` plus `{ consumablesKnown, consumablesAtPull, buffsAtPull, partyBuffs, flask, battleElixir, guardianElixir, food, castsPerMinute, casts, abilities, bloodlustPercent, stats }`. `player = { name, classToken, spec, role, schools }`.

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 5: kill facts and player findings
function killFor(enc) {
    const K = FX.kills[String(enc)];
    return F.killFacts({ encounterId: enc, name: NAMES[enc], rank: FX.encounterRankings[String(enc)].ranks[0], context: K.context, tables: K.tables,
                         sourceId: K.sourceID, player: PLAYER, reference: refFor(enc), referenceNote: null, dbIndex: db });
}
const keysOf = fs => fs.map(f => f.key);
test('debuffFacts: shadow caster on Anetheron has Curse of the Elements, lacks Misery and Shadow Weaving', () => {
    const d = F.debuffFacts(K19.context.debuffs, ['shadow']);
    assert.strictEqual(d.known, true);
    assert.deepStrictEqual(d.missing.map(m => m.name), ['Misery', 'Shadow Weaving']);
    const coe = d.present.find(p => p.name === 'Curse of the Elements');
    assert.strictEqual(coe.uptimePercent, 91);
    assert.ok(!d.present.concat(d.missing).some(x => x.name === 'Fire Vulnerability'), 'fire debuffs do not concern a shadow caster');
    assert.strictEqual(F.debuffFacts(null, ['shadow']).known, false);
    assert.deepStrictEqual(F.debuffFacts(K19.context.debuffs, ['physical']).present.map(p => p.name).sort(), ['Curse of Recklessness', 'Faerie Fire', 'Sunder Armor'].concat(F.debuffFacts(K19.context.debuffs, ['physical']).present.some(p => p.name === 'Blood Frenzy') ? ['Blood Frenzy'] : []).sort());
});
test('killFacts on Anetheron: identity, url, me, and the player-side findings', () => {
    const k = killFor(50619);
    assert.strictEqual(k.rankPercent, 31.9);
    assert.strictEqual(k.reportCode, 'BcZWRDk2PXaYghpC');
    assert.strictEqual(k.fightId, 57);
    assert.strictEqual(k.wclUrl, 'https://classic.warcraftlogs.com/reports/BcZWRDk2PXaYghpC#fight=57&source=12');
    assert.strictEqual(k.date, '2026-08-31');
    assert.strictEqual(k.fight.badPull, false);
    assert.strictEqual(k.me.consumablesKnown, true);
    assert.strictEqual(k.me.castsPerMinute, 25.2);
    assert.strictEqual(k.me.bloodlustPercent, 31);
    assert.strictEqual(k.me.stats.spellCrit, 222);
    assert.deepStrictEqual(k.me.partyBuffs, ['Arcane Brilliance', 'Greater Blessing of Kings', 'Greater Blessing of Wisdom']);
    const keys = keysOf(k.findings);
    assert.ok(keys.includes('crit_low'), keys.join());
    assert.ok(keys.includes('hit_low'), keys.join());
    assert.ok(keys.includes('stat_low'), keys.join());
    assert.ok(keys.includes('casts_low'), keys.join());
    assert.ok(keys.includes('ability_extra'), keys.join());
    assert.ok(!keys.includes('active_low') && !keys.includes('died') && !keys.includes('ability_unused'), keys.join());
    const crit = k.findings.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.severity, 'major');
    assert.strictEqual(crit.scope, 'player');
    assert.strictEqual(crit.ability, 'Shadow Bolt');
    assert.ok(/26\.2%/.test(crit.text) && /58\.8%/.test(crit.text) && /Anetheron/.test(crit.text), crit.text);
    const hit = k.findings.find(f => f.key === 'hit_low');
    assert.ok(/3087/.test(hit.text) && /4215/.test(hit.text), hit.text);
    const stat = k.findings.find(f => f.key === 'stat_low');
    assert.deepStrictEqual([stat.stat, stat.value, stat.reference, stat.severity], ['spellCrit', 222, 345, 'minor']);
    const extra = k.findings.find(f => f.key === 'ability_extra');
    assert.strictEqual(extra.ability, 'Immolate');
    assert.ok(/5 times/.test(extra.text), extra.text);
    const casts = k.findings.find(f => f.key === 'casts_low');
    assert.ok(/25\.2/.test(casts.text) && /30\.5/.test(casts.text), casts.text);
});
test('killFacts on Kaz\'rogal: bad pull, consumables unknown, Curse of Doom unused', () => {
    const k = killFor(50620);
    assert.strictEqual(k.fight.badPull, true);
    assert.strictEqual(k.me.consumablesKnown, false);
    assert.deepStrictEqual(k.me.consumablesAtPull, []);
    assert.ok(k.me.stats && k.me.stats.spellDamage > 900, 'stats fall back to the fight-wide gear row');
    const keys = keysOf(k.findings);
    assert.ok(keys.includes('active_low'), keys.join());
    assert.ok(k.findings.some(f => f.key === 'ability_unused' && f.ability === 'Curse of Doom'), keys.join());
});
test('uptimeFindings: a death before 90% of the fight and active time under 85% are major', () => {
    const base = killFor(50619);
    const dead = Object.assign({}, base, { me: Object.assign({}, base.me, { died: { atSec: 40, by: 'Carrion Swarm' }, activePercent: 70 }) });
    const f = F.uptimeFindings(dead);
    assert.deepStrictEqual(keysOf(f), ['active_low', 'died']);
    assert.ok(f.every(x => x.severity === 'major'));
    assert.ok(/40s of 131s/.test(f[1].text) && /Carrion Swarm/.test(f[1].text), f[1].text);
    const late = Object.assign({}, base, { me: Object.assign({}, base.me, { died: { atSec: 125, by: null } }) });
    assert.ok(!keysOf(F.uptimeFindings(late)).includes('died'), 'a death in the last 10% is not a finding');
});
test('statFindings: primary stat under 90% is major, nothing without a reference', () => {
    const base = killFor(50619);
    const weak = Object.assign({}, base, { me: Object.assign({}, base.me, { stats: Object.assign({}, base.me.stats, { spellDamage: 800 }) }) });
    const f = F.statFindings(weak, 'caster');
    const sp = f.find(x => x.stat === 'spellDamage');
    assert.strictEqual(sp.severity, 'major');
    assert.ok(/Spell power 800 against 1001/.test(sp.text), sp.text);
    assert.deepStrictEqual(F.statFindings(Object.assign({}, base, { reference: null }), 'caster'), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `6`

- [ ] **Step 3: Implement**

Insert before `module.exports`:

```js
function finding(key, severity, scope, text, extra) { return Object.assign({ key, severity, scope, text }, extra || {}); }

// Raid-provided debuffs on the boss that move the metric, with the schools they help. Missing
// ones are a raid-composition finding, never the player's failing, unless their own class
// provides it (OWN_DEBUFF) and it was up too little.
const RAID_DEBUFFS = [
    { name: 'Curse of the Elements', schools: ['arcane', 'fire', 'frost', 'shadow'], value: '10% more arcane, fire, frost and shadow damage', source: 'a warlock' },
    { name: 'Misery', schools: ['arcane', 'fire', 'frost', 'shadow', 'nature', 'holy'], value: '5% spell hit', source: 'a shadow priest' },
    { name: 'Shadow Weaving', schools: ['shadow'], value: '10% more shadow damage', source: 'a shadow priest' },
    { name: 'Fire Vulnerability', schools: ['fire'], value: '15% more fire damage', source: 'a fire mage with Improved Scorch' },
    { name: "Winter's Chill", schools: ['frost'], value: '10% frost crit', source: 'a frost mage' },
    { name: 'Sunder Armor', alt: ['Expose Armor'], schools: ['physical'], value: '2600 armor off the boss', source: 'a warrior or rogue' },
    { name: 'Faerie Fire', alt: ['Faerie Fire (Feral)'], schools: ['physical'], value: '610 armor off the boss', source: 'a druid' },
    { name: 'Blood Frenzy', alt: ['Expose Weakness'], schools: ['physical'], value: '4% more physical damage, or attack power from Expose Weakness', source: 'an arms warrior or a survival hunter' },
    { name: 'Curse of Recklessness', schools: ['physical'], value: '800 armor off the boss', source: 'a warlock' },
    { name: 'Judgement of the Crusader', schools: ['holy'], value: '219 more holy damage per hit', source: 'a paladin' },
];
const OWN_DEBUFF = {
    WARLOCK: ['Curse of the Elements', 'Curse of Recklessness'], PRIEST: ['Misery', 'Shadow Weaving'], MAGE: ['Fire Vulnerability', "Winter's Chill"],
    WARRIOR: ['Sunder Armor', 'Blood Frenzy'], ROGUE: ['Sunder Armor'], DRUID: ['Faerie Fire'], HUNTER: ['Blood Frenzy'], PALADIN: ['Judgement of the Crusader'],
};
function debuffFacts(debuffTable, schools) {
    const d = debuffTable && debuffTable.data;
    const auras = d && Array.isArray(d.auras) ? d.auras : [];
    const total = d ? d.totalTime : 0;
    const present = [], missing = [];
    RAID_DEBUFFS.filter(x => x.schools.some(s => (schools || []).includes(s))).forEach(x => {
        const names = [x.name].concat(x.alt || []);
        const rows = auras.filter(a => names.includes(a.name));
        if (!rows.length) missing.push({ name: x.name, value: x.value, source: x.source });
        else present.push({ name: x.name, uptimePercent: total ? Math.round(100 * Math.max.apply(null, rows.map(r => r.totalUptime)) / total) : null, value: x.value, source: x.source });
    });
    return { known: !!d, present, missing };
}

// Casts that are upkeep rather than rotation: never "unused" or "extra".
const UTILITY_CAST = /life tap|healthstone|bandage|first aid|cannibalize|soulstone|rune$|potion|drain soul|^create |^summon |armor$|resurrection|^restore mana$/i;

function uptimeFindings(kill) {
    const f = [], me = kill.me, fight = kill.fight, ref = kill.reference;
    if (typeof me.activePercent === 'number') {
        const raidTail = typeof fight.raidActivePercent === 'number' ? ' (raid median ' + fight.raidActivePercent + '%)' : '';
        if (me.activePercent < T.activeMajor) f.push(finding('active_low', 'major', 'player', 'Active ' + me.activePercent + '% of the ' + kill.name + ' fight' + raidTail));
        else if (typeof fight.raidActivePercent === 'number' && me.activePercent < 92 && fight.raidActivePercent - me.activePercent >= T.activeGap)
            f.push(finding('active_low', 'minor', 'player', 'Active ' + me.activePercent + '% of the ' + kill.name + ' fight' + raidTail));
    }
    if (me.died && fight.durationSec && me.died.atSec < T.diedBefore * fight.durationSec)
        f.push(finding('died', 'major', 'player', 'Died at ' + me.died.atSec + 's of ' + Math.round(fight.durationSec) + 's on ' + kill.name + (me.died.by ? ' to ' + me.died.by : '')));
    if (!f.some(x => x.key === 'active_low') && ref && ref.castsPerMinute && typeof me.castsPerMinute === 'number' && me.castsPerMinute < T.castsLowRatio * ref.castsPerMinute)
        f.push(finding('casts_low', 'minor', 'player', me.castsPerMinute + ' casts per minute on ' + kill.name + '; comparable players manage ' + ref.castsPerMinute));
    return f;
}

function rotationFindings(kill) {
    const f = [], ref = kill.reference;
    if (!ref || !kill.fight.durationSec || !ref.castsDurationSec) return f;
    const min = kill.fight.durationSec / 60, refMin = ref.castsDurationSec / 60;
    const top3 = ref.abilities.slice(0, 3).map(a => a.name);
    const fmt = x => Math.round(x * 10) / 10;
    Object.keys(ref.casts).forEach(name => {
        if (UTILITY_CAST.test(name)) return;
        const r = ref.casts[name] / refMin, p = (kill.me.casts[name] || 0) / min;
        if (!kill.me.casts[name]) {
            if (r >= T.unusedPerMin || top3.includes(name))
                f.push(finding('ability_unused', top3.includes(name) ? 'major' : 'minor', 'player', 'Never cast ' + name + ' on ' + kill.name + '; comparable players cast it ' + fmt(r) + ' times a minute', { ability: name }));
        } else if (top3.includes(name) && p < T.ratioLow * r) {
            f.push(finding('ability_ratio', 'minor', 'player', name + ' ' + fmt(p) + ' times a minute on ' + kill.name + ' against ' + fmt(r) + ' for comparable players', { ability: name }));
        }
    });
    Object.keys(kill.me.casts).forEach(name => {
        if (UTILITY_CAST.test(name) || ref.casts[name]) return;
        if (kill.me.casts[name] / min >= T.extraPerMin)
            f.push(finding('ability_extra', 'minor', 'player', 'Cast ' + name + ' ' + kill.me.casts[name] + ' times on ' + kill.name + '; comparable players do not use it', { ability: name }));
    });
    return f;
}

function damageFindings(kill) {
    const f = [], ref = kill.reference;
    if (!ref) return f;
    ref.abilities.slice(0, 3).forEach(ra => {
        const pa = kill.me.abilities.find(a => a.name === ra.name);
        if (!pa) return;
        const x = { ability: ra.name, share: pa.share };
        if (typeof pa.critPercent === 'number' && typeof ra.critPercent === 'number' && ra.critPercent - pa.critPercent >= T.critGap)
            f.push(finding('crit_low', 'major', 'player', ra.name + ' crit ' + pa.critPercent + '% of the time on ' + kill.name + '; comparable players crit ' + ra.critPercent + '%', x));
        if (typeof pa.avgHit === 'number' && typeof ra.avgHit === 'number' && pa.avgHit < T.hitRatio * ra.avgHit)
            f.push(finding('hit_low', 'major', 'player', ra.name + ' hit for ' + pa.avgHit + ' on ' + kill.name + ' against ' + ra.avgHit + ' for comparable players', x));
        if (typeof pa.resistPercent === 'number' && typeof ra.resistPercent === 'number' && pa.resistPercent - ra.resistPercent >= T.resistGap)
            f.push(finding('resist_high', 'minor', 'player', pa.resistPercent + '% of ' + ra.name + ' casts were resisted or partially resisted on ' + kill.name + ' against ' + ra.resistPercent + '% for comparable players; check spell hit and Curse of the Elements', x));
    });
    return f;
}

const ROLE_STATS = {
    caster: { primary: 'spellDamage', secondary: ['spellCrit', 'spellHaste'] },
    healer: { primary: 'healing', secondary: ['spellCrit', 'mp5'] },
    melee: { primary: 'attackPower', secondary: ['meleeCrit', 'meleeHaste'] },
    ranged: { primary: 'rangedAttackPower', secondary: ['rangedCrit', 'meleeHaste'] },
    tank: { primary: 'attackPower', secondary: ['meleeCrit'] },
};
const STAT_LABEL = {
    spellDamage: 'spell power', healing: 'healing power', attackPower: 'attack power', rangedAttackPower: 'ranged attack power',
    spellCrit: 'spell crit rating', meleeCrit: 'melee crit rating', rangedCrit: 'ranged crit rating', spellHaste: 'spell haste rating',
    meleeHaste: 'haste rating', spellHit: 'spell hit rating', meleeHit: 'hit rating', mp5: 'mana per five',
};
function statFindings(kill, role) {
    const f = [], ref = kill.reference, me = kill.me.stats;
    const spec = ROLE_STATS[role];
    if (!ref || !ref.stats || !me || !spec) return f;
    const cmp = (key, ratio, sev) => {
        const p = me[key], r = ref.stats[key];
        if (typeof p !== 'number' || typeof r !== 'number' || !r) return;
        const label = STAT_LABEL[key];
        if (p < ratio * r) f.push(finding('stat_low', sev, 'player', label.charAt(0).toUpperCase() + label.slice(1) + ' ' + p + ' against ' + r + ' for comparable players', { stat: key, value: p, reference: r }));
    };
    cmp(spec.primary, T.statPrimaryRatio, 'major');
    spec.secondary.forEach(k => cmp(k, T.statSecondaryRatio, 'minor'));
    return f;
}

function killFindings(kill, player) {
    let f = uptimeFindings(kill).concat(rotationFindings(kill), damageFindings(kill), statFindings(kill, player.role));
    if (!kill.reference && kill.referenceNote) f.push(finding('no_reference', 'info', 'player', kill.referenceNote + ' on ' + kill.name));
    return f;
}

function killFacts(input) {
    const { encounterId, name, rank, context, tables, sourceId, player, reference, referenceNote, dbIndex } = input;
    const fc = fightContext(context, player.name, player.role, reference ? reference.durationSec : null);
    const casts = castCounts(tables.casts);
    const ci = tables.ci && tables.ci.data && tables.ci.data[0];
    const aur = ci ? classifyAuras((ci.auras || []).map(a => a.name)) : null;
    const me = Object.assign(fc.me, {
        consumablesKnown: !!ci, consumablesAtPull: aur ? aur.consumables : [], buffsAtPull: aur ? aur.buffs : [],
        partyBuffs: aur ? canonBuffs(aur.buffs, player.role) : [],
        flask: aur ? aur.flask : null, battleElixir: aur ? aur.battleElixir : null, guardianElixir: aur ? aur.guardianElixir : null, food: aur ? aur.food : null,
        castsPerMinute: castsPerMinute(casts, fc.fight.durationSec), casts, abilities: abilityStats(tables.dmg),
        bloodlustPercent: buffUptime(tables.buffs, 'Bloodlust'), stats: playerStats(ci, fc.meRow, dbIndex, player.classToken),
    });
    const kill = {
        encounterId, name, rankPercent: round1(rank.rankPercent),
        date: rank.startTime ? new Date(rank.startTime).toISOString().slice(0, 10) : null,
        reportCode: rank.report.code, fightId: rank.report.fightID,
        wclUrl: 'https://classic.warcraftlogs.com/reports/' + rank.report.code + '#fight=' + rank.report.fightID + '&source=' + sourceId,
        fight: fc.fight, debuffs: debuffFacts(context.debuffs, player.schools), me,
        reference: reference || null, referenceNote: referenceNote || null, findings: [],
    };
    kill.findings = killFindings(kill, player);
    return kill;
}
```

Add `finding, RAID_DEBUFFS, OWN_DEBUFF, debuffFacts, UTILITY_CAST, uptimeFindings, rotationFindings, damageFindings, ROLE_STATS, STAT_LABEL, statFindings, killFindings, killFacts` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `22 passed, 0 failed`. The `date` assertion reads the rank's `startTime` (1788212807259 ms = 2026-08-31 UTC); if it fails, print `new Date(FX.encounterRankings['50619'].ranks[0].startTime).toISOString()` and fix the expected string, not the code.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report kill facts and player-side findings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Consumable, buff, debuff and gear findings; merge; the facts sheet

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: Task 5 (`killFindings` is extended here), `VetEngine.evaluate(profile, thresholds, now)` whose `rules[]` carry `{ key, applies, status, value, threshold, effective, note }` with keys `gs, ilvl, hit, expertise, defense, parse, enchants, sockets, stale`; `VetEngine.parseThresholds`.
- Produces:
  - `consumableFindings(kill)`, `debuffFindings(kill, player)` `-> finding[]`.
  - `gearFindings(profile, thresholds, now) -> finding[]` with keys `gear_<ruleKey>`.
  - `mergeFindings(kills, gearFindings) -> finding[]` (max 6, `stat_low` folded into `hit_low`).
  - `positives(kills) -> string[]`.
  - `buildFacts({ profile, player, kills, thresholds, now, limited }) -> facts` (spec §3.3 shape, with `overall = { badPulls, findings, positives }`).

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 6: consumables, buffs, debuffs, gear, merge, facts
function rotProfile() {
    const rankings = { medianPerformanceAverage: 14.0, bestPerformanceAverage: 14.0, rankings: [
        { encounter: { id: 50619, name: 'Anetheron' }, medianPercent: 31.9, rankPercent: 31.9, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50620, name: "Kaz'rogal" }, medianPercent: 0.3, rankPercent: 0.3, totalKills: 1, spec: 'Destruction', bestSpec: 'Destruction' },
        { encounter: { id: 50603, name: 'Shade of Akama' }, medianPercent: null, rankPercent: null, totalKills: 0, spec: 'Destruction', bestSpec: 'Destruction' },
    ] };
    return P.buildProfile({ name: 'Rotminster', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'WARLOCK', combatant: null, report: null,
                            rankings, rankingsZone: 1060, fallback: false, metric: 'dps', otherRankings: null, otherZone: 1056, specRankings: rankings, dbIndex: db });
}
const NOTT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wcl-vet-nottomwro.json'), 'utf8'));
function nottProfile() {
    return P.buildProfile({ name: 'Nottomwro', server: 'spineshatter', region: 'eu', zone: 1060, classToken: 'SHAMAN', combatant: NOTT.report.combatant,
                            report: { code: NOTT.report.code, startTime: NOTT.report.startTime, fightName: NOTT.report.fight.name },
                            rankings: NOTT.zoneRankings['1056'], rankingsZone: 1056, fallback: true, metric: 'dps', otherRankings: null, otherZone: 1060,
                            specRankings: NOTT.zoneRankings['1056'], dbIndex: db });
}
test('consumableFindings on Anetheron: a mana elixir instead of a flask, missing group buffs, nothing else', () => {
    const f = F.consumableFindings(killFor(50619));
    assert.deepStrictEqual(keysOf(f).sort(), ['buffs_missing', 'wrong_elixir']);
    const w = f.find(x => x.key === 'wrong_elixir');
    assert.ok(/Elixir of Draenic Wisdom/.test(w.text) && /Flask of Pure Death/.test(w.text), w.text);
    const b = f.find(x => x.key === 'buffs_missing');
    assert.strictEqual(b.scope, 'group');
    assert.ok(b.buffs.includes('Moonkin Aura') && b.buffs.includes('Prayer of Spirit'), b.buffs.join());
    assert.ok(!b.buffs.includes('Arcane Brilliance'));
});
test('consumableFindings: no flask or elixirs, no food, no potion, when the pull row shows none', () => {
    const base = killFor(50619);
    const bare = Object.assign({}, base, { me: Object.assign({}, base.me, { flask: null, battleElixir: null, guardianElixir: null, food: null, consumablesAtPull: [], potionUse: 0 }) });
    const keys = keysOf(F.consumableFindings(bare));
    assert.ok(keys.includes('no_flask_or_elixirs') && keys.includes('no_food') && keys.includes('no_potion'), keys.join());
    assert.ok(!keys.includes('wrong_elixir'));
    const unknown = Object.assign({}, base, { me: Object.assign({}, base.me, { consumablesKnown: false, potionUse: 0 }) });
    assert.deepStrictEqual(keysOf(F.consumableFindings(unknown)), ['no_potion'], 'unknown consumables are not missing consumables');
});
test('debuffFindings: missing shadow debuffs are a group finding; a low uptime on your own curse is yours', () => {
    const a = F.debuffFindings(killFor(50619), PLAYER);
    assert.deepStrictEqual(keysOf(a), ['debuff_missing']);
    assert.strictEqual(a[0].scope, 'group');
    assert.deepStrictEqual(a[0].debuffs, ['Misery', 'Shadow Weaving']);
    assert.ok(/shadow priest/.test(a[0].text), a[0].text);
    const k = F.debuffFindings(killFor(50620), PLAYER);
    const low = k.find(x => x.key === 'debuff_uptime_low');
    assert.ok(low && low.scope === 'player' && /Curse of the Elements was up 33%/.test(low.text), JSON.stringify(k));
});
test('gearFindings: vetting rules that fail or warn become gear_ findings', () => {
    const p = nottProfile();
    const f = F.gearFindings(p, { gs: 9999 }, Date.parse('2026-09-03T12:00:00Z'));
    const gs = f.find(x => x.key === 'gear_gs');
    assert.ok(gs && gs.severity === 'major' && /GearScore \d+ against the 9999/.test(gs.text), JSON.stringify(f));
    assert.ok(!f.some(x => x.key === 'gear_parse' || x.key === 'gear_stale'));
    assert.deepStrictEqual(F.gearFindings(rotProfile(), {}, Date.now()), [], 'no gear data, no gear findings');
});
test('mergeFindings: bad pulls dropped, stat_low folded into hit_low, ordered, capped at 6', () => {
    const kills = [killFor(50619), killFor(50620)];
    const m = F.mergeFindings(kills, []);
    assert.ok(m.length <= 6);
    assert.ok(!m.some(f => /Kaz'rogal/.test(f.text)), 'nothing from the bad pull');
    assert.ok(!m.some(f => f.key === 'stat_low'));
    const hit = m.find(f => f.key === 'hit_low');
    assert.ok(hit && /Spell crit rating 222 against 345/.test(hit.text), hit && hit.text);
    assert.deepStrictEqual(hit.stats, [{ stat: 'spellCrit', value: 222, reference: 345 }]);
    assert.strictEqual(m[0].severity, 'major');
    const sev = m.map(f => f.severity);
    assert.ok(sev.indexOf('minor') === -1 || sev.indexOf('minor') > sev.lastIndexOf('major'), sev.join());
    const withGear = F.mergeFindings(kills, [F.finding('gear_sockets', 'major', 'player', 'Empty sockets: 3')]);
    assert.ok(withGear.some(f => f.key === 'gear_sockets'));
});
test('mergeFindings: the same finding on two bosses is one line with a count', () => {
    const a = killFor(50619);
    const b = Object.assign({}, a, { name: 'Archimonde' });
    const m = F.mergeFindings([a, b], []);
    const crit = m.find(f => f.key === 'crit_low');
    assert.strictEqual(crit.count, 2);
    assert.ok(/\(on 2 of 2 bosses\)/.test(crit.text), crit.text);
});
test('buildFacts: the sheet the model reads', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50620), killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    assert.deepStrictEqual([facts.player.name, facts.player.class, facts.player.spec, facts.player.role, facts.player.metric], ['Rotminster', 'WARLOCK', 'Destruction', 'caster', 'dps']);
    assert.strictEqual(facts.tier.zone, 1060);
    assert.strictEqual(facts.tier.medianPercent, 14);
    assert.strictEqual(facts.tier.threshold, V.DEFAULT_THRESHOLDS.parse);
    assert.strictEqual(facts.kills.length, 2);
    assert.deepStrictEqual(facts.overall.badPulls.map(b => b.name), ["Kaz'rogal"]);
    assert.ok(/19 of 19/.test(facts.overall.badPulls[0].reason));
    assert.ok(facts.overall.findings.length >= 3 && facts.overall.findings.length <= 6);
    assert.ok(facts.overall.positives.includes('Active 91.6% on Anetheron'), facts.overall.positives.join(' | '));
    assert.ok(facts.overall.positives.includes('No death on Anetheron'));
    assert.strictEqual(facts.limited, false);
    assert.ok(!('meRow' in facts.kills[0]) && !('meRow' in facts.kills[0].me), 'bulky gear rows are not in the sheet');
    assert.ok(JSON.stringify(facts).length < 60000, 'sheet stays small enough to send to the model');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `7`

- [ ] **Step 3: Implement**

Insert before `module.exports`:

```js
function consumableFindings(kill) {
    const f = [], me = kill.me, ref = kill.reference;
    if (me.consumablesKnown) {
        if (!me.flask && !(me.battleElixir && me.guardianElixir))
            f.push(finding('no_flask_or_elixirs', 'major', 'player', 'No flask and no battle plus guardian elixir at the ' + kill.name + ' pull' + (me.consumablesAtPull.length ? ' (had ' + me.consumablesAtPull.join(', ') + ')' : '')));
        else if (!me.flask && me.guardianElixir && isUtilityGuardian(me.guardianElixir) && ref && ref.flaskShare >= 0.5 && ref.flask)
            f.push(finding('wrong_elixir', 'minor', 'player', me.guardianElixir + ' at the ' + kill.name + ' pull, while comparable players ran ' + ref.flask + '; a flask does more for your damage'));
        if (!me.food) f.push(finding('no_food', 'minor', 'player', 'No food buff at the ' + kill.name + ' pull'));
        if (ref && ref.buffsAtPull.length) {
            const missing = ref.buffsAtPull.filter(b => !me.partyBuffs.includes(b));
            if (missing.length) f.push(finding('buffs_missing', 'minor', 'group', 'Group buffs comparable players had at the pull that you did not on ' + kill.name + ': ' + missing.join(', ') + '. Worth asking to be grouped with them', { buffs: missing }));
        }
    }
    if (me.potionUse === 0 && kill.fight.durationSec > T.potionMinSec)
        f.push(finding('no_potion', 'minor', 'player', 'No potion used on ' + kill.name + ' (' + Math.round(kill.fight.durationSec) + 's)'));
    if (ref && ref.bloodlustPercent > 0 && me.bloodlustPercent === 0)
        f.push(finding('bloodlust_uptime', 'minor', 'group', 'No Bloodlust on ' + kill.name + ' while comparable players had it'));
    return f;
}

function debuffFindings(kill, player) {
    const f = [], d = kill.debuffs;
    if (!d || !d.known) return f;
    if (d.missing.length)
        f.push(finding('debuff_missing', 'minor', 'group', 'Raid debuffs missing on ' + kill.name + ': ' + d.missing.map(m => m.name + ' (' + m.value + ', needs ' + m.source + ')').join('; ') + '. Raid composition, not your doing', { debuffs: d.missing.map(m => m.name) }));
    const own = OWN_DEBUFF[String(player.classToken || '').toUpperCase()] || [];
    d.present.filter(p => typeof p.uptimePercent === 'number' && p.uptimePercent < T.debuffUptime).forEach(p => {
        const mine = own.includes(p.name);
        f.push(finding('debuff_uptime_low', 'minor', mine ? 'player' : 'group', p.name + ' was up ' + p.uptimePercent + '% of ' + kill.name + (mine ? '; keep it up' : ''), { debuff: p.name }));
    });
    return f;
}

const GEAR_LABEL = { gs: 'GearScore', ilvl: 'Average item level', hit: 'Hit rating', expertise: 'Expertise', defense: 'Defense', enchants: 'Missing enchants', sockets: 'Empty sockets' };
function gearFindings(profile, thresholds, now) {
    const ev = V.evaluate(profile, V.parseThresholds(thresholds || {}), now);
    const f = [];
    (ev.rules || []).forEach(r => {
        if (!r.applies || !GEAR_LABEL[r.key]) return;
        const sev = r.status === 'fail' ? 'major' : r.status === 'warn' ? 'minor' : null;
        if (!sev) return;
        let text;
        if (r.key === 'enchants') {
            const slots = Array.isArray(profile.gear) ? profile.gear.filter(s => s.enchantable && !s.enchant && !s.empty).map(s => s.label) : [];
            text = GEAR_LABEL[r.key] + ': ' + r.value + (slots.length ? ' (' + slots.join(', ') + ')' : '');
        } else if (r.key === 'sockets') {
            text = GEAR_LABEL[r.key] + ': ' + r.value;
        } else {
            text = GEAR_LABEL[r.key] + ' ' + r.value + ' against the ' + (r.key === 'hit' ? r.effective : r.threshold) + ' the raid asks for';
        }
        f.push(finding('gear_' + r.key, sev, 'player', text));
    });
    return f;
}

// One list for the whole report: bad pulls contribute nothing, the same finding on several
// bosses is one line, stat shortfalls attach to the weak-hit line they explain, majors first.
const SEVERITY_ORDER = { major: 0, minor: 1, info: 2 };
function mergeFindings(kills, gear) {
    const live = kills.filter(k => !k.fight.badPull);
    const byId = new Map();
    live.forEach(k => k.findings.forEach(fd => {
        const id = fd.key + '|' + (fd.ability || fd.stat || fd.debuff || '');
        const cur = byId.get(id);
        if (cur) { cur.count++; cur.bosses.push(k.name); }
        else byId.set(id, Object.assign({}, fd, { count: 1, bosses: [k.name] }));
    }));
    let merged = Array.from(byId.values());
    const hitLow = merged.find(f => f.key === 'hit_low');
    const statLow = merged.filter(f => f.key === 'stat_low');
    if (hitLow && statLow.length) {
        hitLow.text += '. ' + statLow.map(s => s.text).join('; ');
        hitLow.stats = statLow.map(s => ({ stat: s.stat, value: s.value, reference: s.reference }));
        merged = merged.filter(f => f.key !== 'stat_low');
    }
    merged.forEach(f => { if (f.count > 1) f.text += ' (on ' + f.count + ' of ' + live.length + ' bosses)'; });
    merged = merged.concat((gear || []).map(g => Object.assign({ count: live.length || 1, bosses: [] }, g)));
    merged.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (b.count - a.count) || ((b.share || 0) - (a.share || 0)));
    return merged.slice(0, 6);
}

function positives(kills) {
    const out = [];
    kills.filter(k => !k.fight.badPull).forEach(k => {
        if (typeof k.me.activePercent === 'number' && k.me.activePercent >= 90) out.push('Active ' + k.me.activePercent + '% on ' + k.name);
        if (!k.me.died) out.push('No death on ' + k.name);
        if (k.me.consumablesKnown && (k.me.flask || (k.me.battleElixir && k.me.guardianElixir)) && k.me.food) out.push('Flask or elixirs and food at the ' + k.name + ' pull');
        if (k.reference && k.me.stats && typeof k.me.stats.gearScore === 'number' && typeof k.reference.stats.spellDamage === 'number' && k.me.stats.spellDamage >= k.reference.stats.spellDamage) out.push('Spell power ' + k.me.stats.spellDamage + ' matches comparable players on ' + k.name);
    });
    return out.slice(0, 6);
}

function buildFacts(o) {
    const { profile, player, kills, thresholds, now, limited } = o;
    const th = V.parseThresholds(thresholds || {});
    const gear = gearFindings(profile, th, now);
    const gs = profile.gearSummary || {};
    const slim = kills.map(k => Object.assign({}, k, { me: Object.assign({}, k.me) }));
    slim.forEach(k => { delete k.meRow; delete k.me.meRow; });
    return {
        player: { name: profile.name, class: player.classToken, spec: player.spec, role: player.role, metric: profile.parses.metric,
                  itemLevel: typeof gs.avgItemLevel === 'number' ? gs.avgItemLevel : null, gearScore: typeof gs.gearScore === 'number' ? gs.gearScore : null,
                  talentSplit: profile.identity ? profile.identity.talentSplit : null },
        tier: { zone: profile.parses.zone, zoneName: profile.parses.zoneName, medianPercent: round1(profile.parses.medianPercent), threshold: th.parse },
        gear: { gearScore: typeof gs.gearScore === 'number' ? gs.gearScore : null, avgItemLevel: typeof gs.avgItemLevel === 'number' ? gs.avgItemLevel : null,
                missingEnchants: Array.isArray(profile.gear) ? profile.gear.filter(s => s.enchantable && !s.enchant && !s.empty).map(s => s.label) : [],
                emptySockets: typeof gs.emptySockets === 'number' ? gs.emptySockets : null, findings: gear },
        kills: slim,
        overall: {
            badPulls: slim.filter(k => k.fight.badPull).map(k => ({ name: k.name, rankPercent: k.rankPercent, reason: k.fight.badPullReason })),
            findings: mergeFindings(slim, gear), positives: positives(slim),
        },
        limited: !!limited,
    };
}
```

Then change `killFindings` (Task 5) to include the two new groups:

```js
function killFindings(kill, player) {
    let f = uptimeFindings(kill).concat(rotationFindings(kill), damageFindings(kill), statFindings(kill, player.role), consumableFindings(kill), debuffFindings(kill, player));
    if (!kill.reference && kill.referenceNote) f.push(finding('no_reference', 'info', 'player', kill.referenceNote + ' on ' + kill.name));
    return f;
}
```

Add `consumableFindings, debuffFindings, gearFindings, mergeFindings, positives, buildFacts` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `29 passed, 0 failed`. If `gearFindings` on the Nottomwro profile fails because `V.evaluate` returns a rule shape other than `{ key, applies, status, value, threshold, effective }`, read `vet-engine.js` around the `function rule(` definition and adapt only the property names in `gearFindings`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report consumable, buff, debuff and gear findings; facts sheet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Prompt and the number guard

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: `buildFacts` output (Task 6).
- Produces: `buildPrompt(facts, rulesLines) -> { system, user }`; `checkNumbers(text, facts) -> { ok, foreign: number[] }`.

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 7: prompt and number guard
const RULES = ['- Bloodlust/Heroism is RAID-wide.', '- Everything else is party-scoped.'];
test('buildPrompt: facts-only rules, structure, Anniversary lines, healer note only when limited', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const p = F.buildPrompt(facts, RULES);
    assert.ok(/Use ONLY the facts/.test(p.system));
    assert.ok(/Bloodlust\/Heroism is RAID-wide/.test(p.system));
    assert.ok(/What's holding your damage back/.test(p.system) && /What's fine/.test(p.system) && /Not on you/.test(p.system));
    assert.ok(/Under 350 words/.test(p.system));
    assert.ok(!/healer/i.test(p.system));
    assert.ok(p.user.startsWith('Facts sheet:\n{'));
    assert.ok(p.user.includes('"Rotminster"'));
    const h = F.buildPrompt(Object.assign({}, facts, { limited: true }), RULES);
    assert.ok(/healer/i.test(h.system));
});
test('checkNumbers: figures from the sheet pass with rounding, foreign figures fail, small numbers ignored', () => {
    const facts = F.buildFacts({ profile: rotProfile(), player: PLAYER, kills: [killFor(50619)], thresholds: {}, now: Date.now(), limited: false });
    const good = 'Rotminster, Destruction warlock, BT/Hyjal, median parse 14.\n1. Crit: your Shadow Bolts crit 26% of the time; comparable players crit 59%. Your crit rating is 222 against 345.\n2. Shadow Bolt hit for 3,087 against 4215.\nWhat\'s fine: active 92%, no deaths.';
    assert.deepStrictEqual(F.checkNumbers(good, facts), { ok: true, foreign: [] });
    const bad = good + '\nAim for 7777 DPS next week.';
    const r = F.checkNumbers(bad, facts);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.foreign, [7777]);
    assert.strictEqual(F.checkNumbers('Three things, in 2 groups of 5.', facts).ok, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `2`

- [ ] **Step 3: Implement**

Insert before `module.exports`:

```js
// The model writes, the sheet decides. Every claim it may make is in `facts`; the system prompt
// forbids anything else, and checkNumbers() enforces the part that matters most.
function buildPrompt(facts, rulesLines) {
    const system = [
        'You are writing a short note to a World of Warcraft TBC Anniversary raider on behalf of their raid leader, about why their parses are low and what to do about it.',
        'Second person, friendly, direct, no fluff. Plain text: no markdown, no # headings, no ** bold.',
        'Use ONLY the facts in the JSON sheet. Never invent a number, an ability, a buff, an item or a percentage. If the sheet does not support a claim, leave it out.',
        'Findings with scope "group" are about raid composition (party buffs, raid debuffs, Bloodlust): phrase them as things to ask the raid leader for, never as the player\'s failing.',
        '"Comparable players" means players of the same spec on the same boss within the item-level band in each kill\'s reference.itemLevelBand.',
        'Anniversary rules that differ from original TBC:',
    ].concat(rulesLines || [], [
        'Structure, in this order:',
        '1. One header line: name, spec, tier, median parse percentile.',
        '2. A line "What\'s holding your damage back", then overall.findings biggest first, at most 5, each as one short paragraph: what it is, your measured number next to the comparable-player number, one concrete fix.',
        '3. A line "What\'s fine", then one or two sentences built from overall.positives.',
        '4. If overall.badPulls is not empty, a line "Not on you", then one line per bad pull with its reason.',
        'Under 350 words.',
        facts && facts.limited ? 'This player is a healer: the sheet has no per-cast comparison, so write only about uptime, deaths, consumables, buffs and gear.' : '',
    ]).filter(Boolean).join('\n');
    return { system, user: 'Facts sheet:\n' + JSON.stringify(facts) };
}

function numbersIn(s) {
    return (String(s).replace(/(\d),(\d{3})\b/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}
// Every figure over 10 in the reply must appear in the sheet, give or take one for rounding.
// Small numbers are list numerals and counts like "3 of 4 bosses", which the sheet also holds
// in one form or another, so they are not worth a false alarm.
function checkNumbers(text, facts) {
    const allowed = new Set();
    numbersIn(JSON.stringify(facts)).forEach(n => { allowed.add(Math.round(n)); allowed.add(Math.floor(n)); allowed.add(Math.ceil(n)); });
    const foreign = numbersIn(text).filter(n => {
        if (n <= 10) return false;
        const r = Math.round(n);
        return ![r - 1, r, r + 1].some(x => allowed.has(x));
    });
    return { ok: foreign.length === 0, foreign: Array.from(new Set(foreign)) };
}
```

Add `buildPrompt, checkNumbers` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `31 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report prompt and number guard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Warcraft Logs orchestration with the reference cache

**Files:**
- Modify: `vet-feedback.js`
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Consumes: everything above; a `query(queryText, variables) -> Promise<data>` function shaped like `wclQuery` in `server.js`.
- Produces:
  - Query builders/constants: `encounterRankQuery(encounterIds, metric) -> string`, `FIGHT_QUERY`, `PLAYER_QUERY`, `refPageQuery(encounterId, className, specName, region, page) -> string`.
  - `getReference(query, { encounterId, classToken, spec, role, region, itemLevel, dbIndex, refCache, now }) -> Promise<{ summary, note }>` with in-flight sharing and a 24-hour cache (`refCache` is a `Map`).
  - `fetchFeedback(query, { profile, dbIndex, refCache, thresholds, now }) -> Promise<facts | null>`.
  - `mapLimit(items, limit, fn) -> Promise<results[]>`.

- [ ] **Step 1: Write the failing tests**

Append before `Promise.all`:

```js
// --- Task 8: orchestration
// A stub WCL that answers from the fixture by query kind and records what was asked.
function stubQuery() {
    const calls = [];
    const byFight = new Map();
    Object.keys(FX.kills).forEach(e => { const k = FX.kills[e]; byFight.set(k.code + '/' + k.fightID, { context: k.context, tables: { [k.sourceID]: k.tables } }); });
    Object.keys(FX.reference).forEach(e => FX.reference[e].players.forEach(p => {
        const key = p.rank.report.code + '/' + p.rank.report.fightID;
        const cur = byFight.get(key) || { context: p.context, tables: {} };
        cur.tables[p.sourceID] = p.tables;
        byFight.set(key, cur);
    }));
    const query = async (q, vars) => {
        calls.push({ q, vars });
        if (q.includes('encounterRankings(')) {
            const ch = { id: 1, classID: 10 };
            Object.keys(FX.encounterRankings).forEach(e => { ch['e' + e] = FX.encounterRankings[e]; });
            return { characterData: { character: ch } };
        }
        if (q === F.FIGHT_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.context : null } }; }
        if (q === F.PLAYER_QUERY) { const hit = byFight.get(vars.c + '/' + vars.f[0]); return { reportData: { report: hit ? hit.tables[vars.s] || null : null } }; }
        if (q.includes('characterRankings(')) {
            const enc = /encounter\(id:(\d+)\)/.exec(q)[1], page = +/page:(\d+)/.exec(q)[1];
            const pg = FX.reference[enc].pages[page - 1];
            return { worldData: { encounter: { characterRankings: pg || { page, hasMorePages: false, count: 0, rankings: [] } } } };
        }
        throw new Error('unexpected query: ' + q.slice(0, 60));
    };
    return { calls, query };
}
test('query builders', () => {
    assert.ok(F.encounterRankQuery([50619, 50620], 'dps').includes('e50619:encounterRankings(encounterID:50619,metric:dps)'));
    assert.ok(F.encounterRankQuery([1], 'hps').includes('metric:hps'));
    assert.ok(/serverSlug:\$server/.test(F.encounterRankQuery([1], 'dps')));
    const rq = F.refPageQuery(50619, 'Warlock', 'Destruction', 'eu', 2);
    assert.ok(rq.includes('encounter(id:50619)') && rq.includes('className:"Warlock"') && rq.includes('specName:"Destruction"') && rq.includes('serverRegion:"eu"') && rq.includes('page:2'));
    assert.ok(F.FIGHT_QUERY.includes('debuffs:table(dataType:Debuffs') && F.FIGHT_QUERY.includes('summary:table(dataType:Summary'));
    assert.ok(F.PLAYER_QUERY.includes('ci:events(dataType:CombatantInfo'));
});
test('mapLimit keeps at most N in flight and returns results in order', async () => {
    let inFlight = 0, peak = 0;
    const out = await F.mapLimit([1, 2, 3, 4, 5], 2, async x => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return x * 2; });
    assert.deepStrictEqual(out, [2, 4, 6, 8, 10]);
    assert.strictEqual(peak, 2);
});
test('fetchFeedback: two kills analysed, references from page 1, cache reused on the second run', async () => {
    const s = stubQuery();
    const refCache = new Map();
    const now = Date.now();
    const facts = await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache, thresholds: {}, now });
    assert.strictEqual(facts.kills.length, 2);
    assert.deepStrictEqual(facts.kills.map(k => k.name), ["Kaz'rogal", 'Anetheron'], 'worst parse first');
    assert.strictEqual(facts.kills[1].reference.sampleSize, 8);
    assert.deepStrictEqual(facts.kills[1].reference.itemLevelBand, [122, 126]);
    assert.strictEqual(facts.overall.badPulls.length, 1);
    const pageCalls = s.calls.filter(c => c.q.includes('characterRankings('));
    assert.strictEqual(pageCalls.length, 2, 'page 1 already holds 8 in-band ranks for each boss');
    const playerCalls = s.calls.filter(c => c.q === F.PLAYER_QUERY);
    assert.strictEqual(playerCalls.length, 2 + 2 * F.REF.players);
    assert.strictEqual(refCache.size, 2);
    const before = s.calls.length;
    await F.fetchFeedback(s.query, { profile: rotProfile(), dbIndex: db, refCache, thresholds: {}, now: now + 1000 });
    assert.strictEqual(s.calls.slice(before).filter(c => c.q.includes('characterRankings(')).length, 0, 'reference cache hit');
    assert.strictEqual(s.calls.slice(before).filter(c => c.q === F.PLAYER_QUERY).length, 2, 'only the player\'s own tables again');
});
test('fetchFeedback: a healer gets the limited sheet with no reference queries', async () => {
    const s = stubQuery();
    const p = rotProfile();
    p.parses.metric = 'hps';
    const facts = await F.fetchFeedback(s.query, { profile: p, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() });
    assert.strictEqual(facts.limited, true);
    assert.ok(facts.kills.every(k => k.reference === null));
    assert.strictEqual(s.calls.filter(c => c.q.includes('characterRankings(')).length, 0);
    assert.ok(!facts.overall.findings.some(f => ['crit_low', 'hit_low', 'stat_low', 'ability_unused'].includes(f.key)));
});
test('fetchFeedback: no parses gives null; WCL errors propagate', async () => {
    const s = stubQuery();
    const p = rotProfile();
    p.parses = null;
    assert.strictEqual(await F.fetchFeedback(s.query, { profile: p, dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() }), null);
    const boom = async () => { const e = new Error('WCL rate limit reached'); e.code = 'RATE_LIMIT'; throw e; };
    await assert.rejects(F.fetchFeedback(boom, { profile: rotProfile(), dbIndex: db, refCache: new Map(), thresholds: {}, now: Date.now() }), /rate limit/);
});
test('getReference: widens once when the band is thin, gives a note when still too few, shares in-flight work', async () => {
    const pages = FX.reference['50619'].pages;
    const thin = pages.flatMap(p => p.rankings).filter(r => r.bracketData === 119);
    const twoPages = { page: 1, hasMorePages: false, count: thin.length, rankings: thin };
    let pageCalls = 0;
    const query = async q => {
        if (q.includes('characterRankings(')) { pageCalls++; return { worldData: { encounter: { characterRankings: twoPages } } }; }
        throw new Error('no fight data in this stub');
    };
    const base = { encounterId: 50619, classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', region: 'eu', dbIndex: db, now: Date.now() };
    const none = await F.getReference(query, Object.assign({ itemLevel: 150, refCache: new Map() }, base));
    assert.strictEqual(none.summary, null);
    assert.ok(/too few same-item-level parses/.test(none.note));
    const cache = new Map();
    const a = F.getReference(query, Object.assign({ itemLevel: 150, refCache: cache }, base));
    const b = F.getReference(query, Object.assign({ itemLevel: 150, refCache: cache }, base));
    await Promise.all([a, b]);
    assert.strictEqual(pageCalls, 2, 'one page fetch for the first call, one shared fetch for the pair');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node vet-feedback.test.js 2>&1 | grep -c FAIL`
Expected: `6`

- [ ] **Step 3: Implement**

Insert before `module.exports`:

```js
// --- WCL queries (verified live 2026-09-04, spec §9). The metric, class, spec, region and
// encounter id are inlined after validation, matching the probe text exactly: WCL's classic
// schema types some of these arguments in ways that reject plain String variables.
function encounterRankQuery(encounterIds, metric) {
    const m = metric === 'hps' ? 'hps' : 'dps';
    return 'query($name:String!,$server:String!,$region:String!){characterData{character(name:$name,serverSlug:$server,serverRegion:$region){id classID ' +
        encounterIds.map(id => 'e' + id + ':encounterRankings(encounterID:' + id + ',metric:' + m + ')').join(' ') + '}}}';
}
const FIGHT_QUERY = 'query($c:String!,$f:[Int]!){reportData{report(code:$c){' +
    'masterData{actors(type:"Player"){id name subType}} fights(fightIDs:$f){id name startTime endTime kill} rankings(fightIDs:$f) ' +
    'dmgAll:table(dataType:DamageDone,fightIDs:$f) deaths:table(dataType:Deaths,fightIDs:$f) summary:table(dataType:Summary,fightIDs:$f) ' +
    'debuffs:table(dataType:Debuffs,fightIDs:$f,hostilityType:Enemies)}}}';
const PLAYER_QUERY = 'query($c:String!,$f:[Int]!,$s:Int!){reportData{report(code:$c){' +
    'dmg:table(dataType:DamageDone,fightIDs:$f,sourceID:$s) casts:table(dataType:Casts,fightIDs:$f,sourceID:$s) ' +
    'buffs:table(dataType:Buffs,fightIDs:$f,sourceID:$s) ci:events(dataType:CombatantInfo,fightIDs:$f,sourceID:$s,limit:5){data}}}}';
function refPageQuery(encounterId, className, specName, region, page) {
    const safe = s => String(s).replace(/[^A-Za-z]/g, '');
    return '{worldData{encounter(id:' + (parseInt(encounterId, 10) || 0) + '){characterRankings(metric:dps,className:"' + safe(className) +
        '",specName:"' + safe(specName) + '",serverRegion:"' + safe(region).toLowerCase() + '",page:' + (parseInt(page, 10) || 1) + ')}}}';
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

async function fightAndTables(query, code, fightID, playerName) {
    const ctxD = await query(FIGHT_QUERY, { c: code, f: [fightID] });
    const ctx = ctxD && ctxD.reportData && ctxD.reportData.report;
    if (!ctx || !ctx.masterData) return null;
    const actor = (ctx.masterData.actors || []).find(a => a.name && lower(a.name) === lower(playerName));
    if (!actor) return null;
    const tD = await query(PLAYER_QUERY, { c: code, f: [fightID], s: actor.id });
    const tables = tD && tD.reportData && tD.reportData.report;
    if (!tables) return null;
    return { ctx, tables, sourceId: actor.id };
}

// Reference per (boss, class, spec, region, band). Shared across every player of that spec, so
// it is cached for a day and an in-flight fetch is handed to concurrent callers.
async function getReference(query, o) {
    const key = [o.encounterId, o.classToken, o.spec, o.region, o.itemLevel - REF.band, o.itemLevel + REF.band].join('/');
    const hit = o.refCache.get(key);
    if (hit && hit.value && o.now - hit.at < REF.cacheMs) return hit.value;
    if (hit && hit.pending) return hit.pending;
    const pending = (async () => {
        const pages = [];
        let ranks = [];
        for (let p = 1; p <= REF.maxPages; p++) {
            const d = await query(refPageQuery(o.encounterId, WCL_CLASS_NAME[String(o.classToken).toUpperCase()], wclSpecName(o.spec), o.region, p), {});
            const cr = d && d.worldData && d.worldData.encounter && d.worldData.encounter.characterRankings;
            if (!cr || !Array.isArray(cr.rankings)) break;
            pages.push(cr);
            ranks = bandRanks(pages.flatMap(x => x.rankings), o.itemLevel, REF.band);
            if (ranks.length >= REF.target || !cr.hasMorePages) break;
        }
        let band = REF.band;
        if (ranks.length < REF.min) { band = REF.wideBand; ranks = bandRanks(pages.flatMap(x => x.rankings), o.itemLevel, REF.wideBand); }
        if (ranks.length < REF.min) return { summary: null, note: 'too few same-item-level parses to compare against' };
        ranks = ranks.slice(0, REF.target);
        const players = [];
        for (const r of ranks.slice(0, REF.players)) {
            const got = await fightAndTables(query, r.report.code, r.report.fightID, r.name);
            if (got) players.push({ rank: r, sourceID: got.sourceId, context: got.ctx, tables: got.tables });
        }
        return { summary: referenceSummary(ranks, players, o.dbIndex, o.classToken, o.role, [o.itemLevel - band, o.itemLevel + band]), note: null };
    })();
    o.refCache.set(key, { at: o.now, pending });
    try {
        const value = await pending;
        o.refCache.set(key, { at: o.now, value });
        return value;
    } catch (e) { o.refCache.delete(key); throw e; }
}

// The whole pipeline for one player (spec §3.1 steps 2–5). Returns null when there is nothing
// to analyse; WCL errors (including rate limits) propagate to the route.
async function fetchFeedback(query, o) {
    const { profile, dbIndex, refCache, thresholds, now } = o;
    if (!profile || !profile.parses) return null;
    const targets = pickKills(profile);
    if (!targets.length) return null;
    const id = profile.identity || {};
    const role = id.role || 'caster';
    const limited = profile.parses.metric === 'hps';
    const player = { name: profile.name, classToken: id.class, spec: id.spec, role, schools: schoolsOf(id.class, id.spec, role) };
    const er = await query(encounterRankQuery(targets.map(t => t.encounterId), profile.parses.metric), { name: profile.name, server: profile.server, region: profile.region });
    const ch = er && er.characterData && er.characterData.character;
    if (!ch) return null;
    const kills = (await mapLimit(targets, 3, async t => {
        const blob = ch['e' + t.encounterId];
        const ranks = blob && Array.isArray(blob.ranks) ? blob.ranks.filter(r => r && r.report && r.report.code) : [];
        const rank = ranks.slice().sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
        if (!rank) return null;
        const got = await fightAndTables(query, rank.report.code, rank.report.fightID, profile.name);
        if (!got) return null;
        const ref = (limited || !id.class || !id.spec || typeof rank.bracketData !== 'number') ? { summary: null, note: null }
            : await getReference(query, { encounterId: t.encounterId, classToken: id.class, spec: id.spec, role, region: profile.region, itemLevel: rank.bracketData, dbIndex, refCache, now });
        return killFacts({ encounterId: t.encounterId, name: t.name, rank, context: got.ctx, tables: got.tables, sourceId: got.sourceId, player, reference: ref.summary, referenceNote: ref.note, dbIndex });
    })).filter(Boolean);
    kills.sort((a, b) => (a.rankPercent == null ? 101 : a.rankPercent) - (b.rankPercent == null ? 101 : b.rankPercent));
    return buildFacts({ profile, player, kills, thresholds, now, limited });
}
```

Add `encounterRankQuery, FIGHT_QUERY, PLAYER_QUERY, refPageQuery, mapLimit, getReference, fetchFeedback` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node vet-feedback.test.js 2>&1 | tail -2`
Expected: `37 passed, 0 failed`

- [ ] **Step 5: Run the whole suite**

Run: `npm test 2>&1 | grep -E "passed|failed" `
Expected: every suite reports `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat: feedback report WCL orchestration with a shared reference cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Server route `GET /api/vet/feedback`

**Files:**
- Modify: `server.js` (the `/api/vet/player` block, the `AI_SYSTEM_PROMPT` / `/api/ai-review` block)

**Interfaces:**
- Consumes: `VetFeedback.fetchFeedback`, `buildPrompt`, `checkNumbers` (Task 8); existing `wclQuery`, `wclErrorResponse`, `getVetDbIndex`, `vetCache`, `VET_CACHE_MS`.
- Produces: `loadProfile(name, server, region, zone) -> Promise<{ profile|null, cached }>` (throws `{ code: 'NO_DB' }` when the item table is unreadable), `openaiChat(system, user, timeoutMs) -> Promise<string>` (throws `{ code: 'NO_KEY' | 'UPSTREAM' }` or a timeout error), `ANNIVERSARY_RULES: string[]`, and the route returning `{ facts, report, reportError, generatedAt }` with header `X-Vet-Cache: hit|miss`.

There is no server test file in this repo; the route is thin by design and is verified by hand in Step 5 and by the browser smoke in Task 11.

- [ ] **Step 1: Extract `loadProfile` from `/api/vet/player`**

In `server.js`, replace the body of `app.get('/api/vet/player', …)` from `const key = …` to the end of the handler with:

```js
  try {
    const { profile, cached } = await loadProfile(name, server, region, zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    res.set('X-Vet-Cache', cached ? 'hit' : 'miss');
    res.json(profile);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL vetting lookup');
  }
});
```

and add, directly above that route (after `const vetCache = new Map();`):

```js
// One profile per character, cached for VET_CACHE_MS. Shared by the vetting and feedback routes.
async function loadProfile(name, server, region, zone) {
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone;
  const hit = vetCache.get(key);
  if (hit && Date.now() - hit.at < VET_CACHE_MS) return { profile: hit.profile, cached: true };
  let db;
  try { db = getVetDbIndex(); }
  catch (err) { console.error('item table load failed:', err); const e = new Error('Item table data/tbc-item-db.json is missing or unreadable'); e.code = 'NO_DB'; throw e; }
  const profile = await VetProfile.fetchProfile(wclQuery, { name, server, region, zone }, db);
  if (!profile) return { profile: null, cached: false };
  // Reclaim memory from entries the read path above already treats as misses (past VET_CACHE_MS) —
  // this is a sweep, not an eviction policy: nothing here changes what a lookup returns.
  for (const [k, v] of vetCache) if (Date.now() - v.at >= VET_CACHE_MS) vetCache.delete(k);
  vetCache.set(key, { at: Date.now(), profile });
  return { profile, cached: false };
}
```

Run: `npm start` in one terminal, then `curl -s -i "http://localhost:3000/api/vet/player?name=Rotminster&server=spineshatter&region=eu&zone=1060" | head -5`
Expected: `HTTP/1.1 200 OK` and an `X-Vet-Cache` header; a second call says `hit`. Stop the server.

- [ ] **Step 2: Extract `ANNIVERSARY_RULES` and `openaiChat`**

Replace the `AI_SYSTEM_PROMPT` constant with:

```js
// The Anniversary-realm rules both model prompts must state, so neither repeats the
// rule-ignorant critiques a bare ChatGPT produces.
const ANNIVERSARY_RULES = [
  '- Bloodlust/Heroism is RAID-wide (10-minute Sated-style debuff). It is never a reason to group anyone.',
  '- Everything else is party-scoped: all shaman totems, paladin auras, Battle Shout, Leader of the Pack, Moonkin Aura, Trueshot Aura, Ferocious Inspiration, Vampiric Touch, Mana Tide, Blood Pact, and draenei presences.',
  '- A shaman runs only ONE air totem at a time: Windfury, Grace of Air and Wrath of Air are all air totems.',
  '- Windfury Totem does not affect shapeshifted druids or hunters, and enhancement shamans use their own weapon imbues instead.',
];
const AI_SYSTEM_PROMPT = [
  'You are reviewing a World of Warcraft TBC Anniversary-realm raid assignment sheet.',
  'Anniversary rules you must respect (they differ from original TBC):',
].concat(ANNIVERSARY_RULES, [
  '- Party mana buffs (Vampiric Touch, Mana Spring, Mana Tide) scale strongly with fight length. The payload includes fightLengthSec, and the layout weights already assume it — do not suggest mana-motivated regrouping beyond what the sheet shows unless the actual fight is much longer than fightLengthSec.',
  '- A non-enhancement shaman grouped with melee is expected to drop Windfury as baseline; the group notes say which totem each group gets.',
  'Critique the group layout, debuff assignments, blessings and uncovered list as an advisory second opinion.',
  'Suggest concrete swaps where they genuinely help; say so if the sheet is already sound.',
  'Under 400 words. Plain text, no markdown headings.',
]).join('\n');

// One chat completion. Errors carry a code so routes can map them to a status without
// re-deriving it from the message.
async function openaiChat(system, user, timeoutMs) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('No OPENAI_API_KEY configured — put it in .env next to server.js'); e.code = 'NO_KEY'; throw e; }
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    const msg = (data && data.error && data.error.message) || `OpenAI returned ${upstream.status}`;
    console.error('OpenAI upstream error:', upstream.status, msg);
    const e = new Error(`OpenAI returned ${upstream.status}`); e.code = 'UPSTREAM'; throw e;
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) { const e = new Error('OpenAI returned an empty response'); e.code = 'UPSTREAM'; throw e; }
  return text;
}
```

Then replace the body of `app.post('/api/ai-review', …)` after the `req.is('application/json')` check with:

```js
  try {
    const text = await openaiChat(AI_SYSTEM_PROMPT, `Review this sheet:\n${JSON.stringify(req.body)}`, 180000);
    res.json({ review: text });
  } catch (err) {
    if (err.code === 'NO_KEY') return res.status(503).json({ error: err.message });
    if (err.code === 'UPSTREAM') return res.status(502).json({ error: err.message });
    console.error('AI review failed:', err);
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return res.status(504).json({ error: 'OpenAI request timed out' });
    res.status(502).json({ error: 'Failed to reach OpenAI' });
  }
});
```

Run: `node -e "require('./server.js')" & sleep 2; curl -s -X POST -H 'Content-Type: text/plain' http://localhost:3000/api/ai-review -d x; kill %1`
Expected: `{"error":"Expected application/json"}` (the guard still runs before the model).

- [ ] **Step 3: Add the feedback route**

Add after the `/api/vet/player` route:

```js
// Parse feedback report: measured facts from WCL plus a model-written, facts-only note.
// A model failure never fails the request — the facts sheet is the product, the prose is a
// convenience — so `report` may be null with `reportError` saying why.
const VetFeedback = require('./vet-feedback.js');
const FEEDBACK_CACHE_MS = 15 * 60 * 1000;
const feedbackCache = new Map();     // key -> { at, body }
const feedbackRefCache = new Map();  // shared reference cache, see getReference in vet-feedback.js

app.get('/api/vet/feedback', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10) || 1060;
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  let thresholds = {};
  if (req.query.thresholds) {
    try { thresholds = JSON.parse(String(req.query.thresholds)); } catch (e) { return res.status(400).json({ error: 'Invalid thresholds' }); }
  }
  thresholds = VetEngine.parseThresholds(thresholds);
  const key = region + '/' + server + '/' + name.toLowerCase() + '/' + zone + '/' + JSON.stringify(thresholds);
  const hit = feedbackCache.get(key);
  if (hit && Date.now() - hit.at < FEEDBACK_CACHE_MS) { res.set('X-Vet-Cache', 'hit'); return res.json(hit.body); }
  try {
    const { profile } = await loadProfile(name, server, region, zone);
    if (!profile) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    if (!profile.parses) return res.status(404).json({ error: 'No parses to analyse' });
    const facts = await VetFeedback.fetchFeedback(wclQuery, { profile, dbIndex: getVetDbIndex(), refCache: feedbackRefCache, thresholds, now: Date.now() });
    if (!facts) return res.status(404).json({ error: 'No kills to analyse' });
    let report = null, reportError = null;
    try {
      const { system, user } = VetFeedback.buildPrompt(facts, ANNIVERSARY_RULES);
      const text = await openaiChat(system, user, 60000);
      const check = VetFeedback.checkNumbers(text, facts);
      if (check.ok) report = text;
      else reportError = 'The model introduced figures not in the facts (' + check.foreign.join(', ') + '); showing the facts only';
    } catch (err) {
      console.error('feedback report model failed:', err);
      if (err.code === 'NO_KEY') reportError = 'No OPENAI_API_KEY configured; showing the facts only';
      else if (err.name === 'AbortError' || err.name === 'TimeoutError') reportError = 'The model timed out; showing the facts only';
      else reportError = 'The model failed; showing the facts only';
    }
    const body = { facts, report, reportError, generatedAt: new Date().toISOString() };
    for (const [k, v] of feedbackCache) if (Date.now() - v.at >= FEEDBACK_CACHE_MS) feedbackCache.delete(k);
    feedbackCache.set(key, { at: Date.now(), body });
    res.set('X-Vet-Cache', 'miss');
    res.json(body);
  } catch (err) {
    if (err.code === 'NO_DB') return res.status(500).json({ error: err.message });
    wclErrorResponse(res, err, 'WCL feedback lookup');
  }
});
```

- [ ] **Step 4: Run the unit suites (nothing should have changed)**

Run: `npm test 2>&1 | grep -E "passed|failed"`
Expected: every suite `0 failed`.

- [ ] **Step 5: Verify the route live**

Run `npm start`, then:

```bash
curl -s "http://localhost:3000/api/vet/feedback?name=Rotminster&server=spineshatter&region=eu&zone=1060" > /tmp/rot-feedback.json
node -e "const b=require('/tmp/rot-feedback.json'); console.log('kills', b.facts.kills.map(k=>k.name+' '+k.rankPercent).join(' | ')); console.log('badPulls', JSON.stringify(b.facts.overall.badPulls)); console.log('findings'); b.facts.overall.findings.forEach(f=>console.log(' -', f.severity, f.key, f.text)); console.log('positives', b.facts.overall.positives); console.log('reportError', b.reportError); console.log('--- report ---'); console.log(b.report)"
curl -s -i "http://localhost:3000/api/vet/feedback?name=Rotminster&server=spineshatter&region=eu&zone=1060" | grep -i x-vet-cache
```

Expected: four kills; `Kaz'rogal` in `badPulls` with the 19-of-19 reason; findings led by `crit_low` / `hit_low` on Shadow Bolt; `reportError` null and a report in the four-part structure that mentions only numbers present in the facts (spot-check three of them against the findings); the second call prints `X-Vet-Cache: hit`. If `reportError` reports foreign figures, paste the report and the figures into the commit message body so the prompt can be tightened in a follow-up, and continue: the facts path is the deliverable.

Also check the bad inputs: `curl -s "http://localhost:3000/api/vet/feedback?name=Rotminster&server=spineshatter&region=eu&thresholds=%7B"` → `{"error":"Invalid thresholds"}`; `curl -s "http://localhost:3000/api/vet/feedback?name=Nosuchplayerxyz&server=spineshatter&region=eu"` → 404 `Character not found on Warcraft Logs`. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: /api/vet/feedback builds the facts sheet and a facts-only model report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The page: Feedback report button, report box, Copy, facts table

**Files:**
- Modify: `vetting.js` (state, `load`, `removePlayer`, `removeAll`, the refresh handler, `detailRow`)
- Modify: `vetting.css`

**Interfaces:**
- Consumes: `GET /api/vet/feedback` (Task 9) returning `{ facts, report, reportError, generatedAt }`; existing `state`, `save()`, `renderTable()`, `pause()`, `escapeHtml`, `wcl`, `ZONE`.
- Produces: `state.feedback[key] = { report, reportError, generatedAt, facts }` persisted in `raidVettingState`; `window.vetFeedback(key)` for the smoke test.

- [ ] **Step 1: State and persistence**

In `vetting.js`:

- Change the `state` line to `const state = { players: [], thresholds: Object.assign({}, V.DEFAULT_THRESHOLDS), profiles: {}, errors: {}, feedback: {} };`
- After the `state.errors` block in `load()`, add:
  ```js
      if (parsed.feedback && typeof parsed.feedback === 'object' && !Array.isArray(parsed.feedback)) {
          state.feedback = parsed.feedback;
      }
  ```
- Below `let rosterNotice = null;` add:
  ```js
  const feedbackInFlight = new Set(); // keys with a report request running
  const feedbackErrors = {};          // key -> last request error, cleared on the next request
  ```
- In `removePlayer`, after `delete state.profiles[key]; delete state.errors[key];` add `delete state.feedback[key]; delete feedbackErrors[key];`
- In `removeAll`, after `state.errors = {};` add `state.feedback = {};`
- In the `refreshBtn` handler, change `state.profiles = {}; state.errors = {};` to `state.profiles = {}; state.errors = {}; state.feedback = {};`

- [ ] **Step 2: The request**

Add after `function pause() { … }`:

```js
// --- feedback report ---
async function requestFeedback(key) {
    const player = state.players.find(p => p.name.toLowerCase() === key);
    if (!player || feedbackInFlight.has(key)) return;
    delete feedbackErrors[key];
    if (!wcl.server) { feedbackErrors[key] = 'No realm set'; renderTable(); return; }
    feedbackInFlight.add(key);
    renderTable();
    try {
        const url = '/api/vet/feedback?name=' + encodeURIComponent(player.name) + '&server=' + encodeURIComponent(wcl.server) +
            '&region=' + encodeURIComponent(wcl.region) + '&zone=' + ZONE + '&thresholds=' + encodeURIComponent(JSON.stringify(state.thresholds));
        const res = await fetch(url);
        if (!state.players.some(p => p.name.toLowerCase() === key)) return;
        if (res.status === 429) { feedbackErrors[key] = 'Warcraft Logs rate limit reached — try again after the pause'; pause(); return; }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { feedbackErrors[key] = body.error || ('HTTP ' + res.status); return; }
        state.feedback[key] = { report: body.report || null, reportError: body.reportError || null, generatedAt: body.generatedAt, facts: body.facts };
        try { save(); } catch (err) { feedbackErrors[key] = 'Report shown but could not be saved locally: ' + err.message; }
    } catch (err) {
        feedbackErrors[key] = 'Network error: ' + err.message;
    } finally {
        feedbackInFlight.delete(key);
        renderTable();
    }
}
function copyText(text, btn) {
    const done = ok => { const was = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = was; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); return; }
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
}
// The facts sheet's findings as plain text, for when the model wrote nothing usable.
function fallbackReport(facts) {
    const lines = [facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + facts.tier.zoneName + ', median parse ' + Math.round(facts.tier.medianPercent)];
    lines.push('', "What's holding your damage back");
    facts.overall.findings.forEach((f, i) => lines.push((i + 1) + '. ' + f.text));
    if (facts.overall.positives.length) lines.push('', "What's fine", facts.overall.positives.join('. ') + '.');
    if (facts.overall.badPulls.length) { lines.push('', 'Not on you'); facts.overall.badPulls.forEach(b => lines.push(b.name + ' (' + b.rankPercent + '): ' + b.reason)); }
    return lines.join('\n');
}
```

- [ ] **Step 3: Rendering**

Add after `function bossTable(bosses) { … }`:

```js
function factsTable(facts) {
    const t = document.createElement('table');
    t.className = 'facts-table';
    t.innerHTML = '<tr><th>Boss</th><th>Parse</th><th>Length</th><th>Active</th><th>Raid rank</th><th>DPS vs band</th><th>Crit vs band</th><th>Pull consumables</th><th>Log</th></tr>';
    facts.kills.forEach(k => {
        const tr = document.createElement('tr');
        if (k.fight.badPull) { tr.className = 'bad-pull'; tr.title = k.fight.badPullReason; }
        const ref = k.reference;
        const topMe = k.me.abilities[0], topRef = ref && topMe ? ref.abilities.find(a => a.name === topMe.name) : null;
        const fmt = x => (x == null ? '—' : x);
        const cells = [
            escapeHtml(k.name) + (k.fight.badPull ? ' <span class="cell-unknown">(bad pull)</span>' : ''),
            fmt(k.rankPercent == null ? null : Math.round(k.rankPercent)),
            fmt(k.fight.durationSec == null ? null : Math.round(k.fight.durationSec) + 's') + (ref ? ' / ' + Math.round(ref.durationSec) + 's' : ''),
            fmt(k.me.activePercent == null ? null : k.me.activePercent + '%'),
            k.fight.raidGroupRank ? k.fight.raidGroupRank + ' of ' + k.fight.raidGroupCount : '—',
            fmt(k.me.dps) + (ref ? ' / ' + ref.dps : ''),
            topMe && topMe.critPercent != null ? escapeHtml(topMe.name) + ' ' + topMe.critPercent + '%' + (topRef && topRef.critPercent != null ? ' / ' + topRef.critPercent + '%' : '') : '—',
            k.me.consumablesKnown ? (k.me.consumablesAtPull.length ? escapeHtml(k.me.consumablesAtPull.join(', ')) : '<span class="slot-missing">none</span>') : '<span class="cell-unknown">unknown</span>',
            '<a href="' + escapeHtml(k.wclUrl) + '" target="_blank" rel="noopener">WCL</a>',
        ];
        tr.innerHTML = cells.map(c => '<td>' + c + '</td>').join('');
        t.appendChild(tr);
    });
    return t;
}
function feedbackBox(r) {
    const box = document.createElement('div');
    box.className = 'feedback-box';
    const fb = state.feedback[r.key];
    const busy = feedbackInFlight.has(r.key);
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = busy ? 'Analysing…' : (fb ? 'Refresh report' : 'Feedback report');
    btn.disabled = busy || !r.profile.parses;
    if (!r.profile.parses) btn.title = 'No parses to analyse';
    btn.addEventListener('click', e => { e.stopPropagation(); requestFeedback(r.key); });
    box.appendChild(btn);
    if (feedbackErrors[r.key]) box.insertAdjacentHTML('beforeend', '<div class="status error feedback-status">' + escapeHtml(feedbackErrors[r.key]) + '</div>');
    if (!fb) return box;
    const text = fb.report || (fb.facts ? fallbackReport(fb.facts) : '');
    if (fb.reportError) box.insertAdjacentHTML('beforeend', '<div class="status feedback-status">' + escapeHtml(fb.reportError) + '</div>');
    const pre = document.createElement('pre');
    pre.className = 'feedback-report';
    pre.textContent = text;
    box.appendChild(pre);
    const actions = document.createElement('div');
    actions.className = 'feedback-actions';
    const copy = document.createElement('button');
    copy.className = 'btn btn-primary'; copy.textContent = 'Copy';
    copy.addEventListener('click', e => { e.stopPropagation(); copyText(text, copy); });
    actions.appendChild(copy);
    if (fb.generatedAt) actions.insertAdjacentHTML('beforeend', '<span class="status">' + escapeHtml(new Date(fb.generatedAt).toLocaleString()) + '</span>');
    box.appendChild(actions);
    if (fb.facts) {
        const det = document.createElement('details');
        det.innerHTML = '<summary>Facts</summary>';
        det.appendChild(factsTable(fb.facts));
        box.appendChild(det);
    }
    return box;
}
```

In `detailRow`, after the `if (p.missing && p.missing.length) …` line and before `grid.appendChild(parseBox);`, add `parseBox.appendChild(feedbackBox(r));`.

At the bottom, after `window.vetState = () => state;`, add `window.vetFeedback = requestFeedback;`.

- [ ] **Step 4: Styles**

Append to `vetting.css`:

```css
.feedback-box { margin-top: 10px; }
.feedback-status { margin-top: 6px; }
.feedback-report { white-space: pre-wrap; font-family: inherit; font-size: 0.9em; line-height: 1.4; background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 6px; padding: 10px; margin: 8px 0 6px; max-width: 70ch; }
.feedback-actions { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.feedback-box details { margin-top: 4px; }
.feedback-box summary { cursor: pointer; color: #ffd700; font-size: 0.9em; }
.facts-table { font-size: 0.82em; margin-top: 6px; }
.facts-table th { color: #ffd700; font-weight: 600; text-align: left; padding: 2px 6px; }
.facts-table td { padding: 2px 6px; white-space: nowrap; }
.facts-table tr.bad-pull td { color: #777; }
.facts-table a { color: #9ab; }
```

- [ ] **Step 5: Check it by hand**

Run `npm start`, open `http://localhost:3000/vetting.html`, set realm `spineshatter`, add `Rotminster`, click the row. Expected: a "Feedback report" button under the parse table; clicking it shows "Analysing…", then the report, a Copy button, a timestamp and a collapsed "Facts" section whose table greys Kaz'rogal as a bad pull with the reason in the tooltip. Copy puts the text on the clipboard. Reload the page and expand the row: the report is still there without a fetch, and the button reads "Refresh report". Remove the player and add them again: the button reads "Feedback report" (the stored report was dropped).

- [ ] **Step 6: Commit**

```bash
git add vetting.js vetting.css
git commit -m "feat: Feedback report button on the vetting page with Copy and a facts table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: README, browser smoke check, calibration on three players

**Files:**
- Modify: `README.md`
- Create (scratchpad, not committed): `vet-feedback-smoke.mjs`

- [ ] **Step 1: README**

Under the vetting page bullet in `README.md` (the one starting `- Player vetting page (`vetting.html`)`), add a sub-bullet:

```markdown
  - **Feedback report** (button in a player's expanded row): a short note you can paste to the
    player saying what is holding their parses back, biggest first, with the measured number next
    to what same-spec players within two item levels do on the same boss, and a fix for each.
    The server measures every figure from Warcraft Logs (`/api/vet/feedback`, see
    `vet-feedback.js`); the prose is written by OpenAI under a facts-only prompt and rejected if
    it introduces numbers the facts do not hold, in which case the findings are shown as a plain
    list. Raid-wide bad pulls (an 18-minute kill where every DPS parsed 0) are listed under
    "Not on you". Needs `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` and, for the prose, `OPENAI_API_KEY`
    (`OPENAI_MODEL` optional) in `.env`.
```

In the Tests section, extend the `npm test` comment to mention the feedback suite: `# engine, WCL multiplier, positions, item table, vetting and feedback suites (node, no deps)`.

- [ ] **Step 2: Browser smoke check**

Write `vet-feedback-smoke.mjs` in the scratchpad directory (the session's scratchpad path from the environment, not the repo). It needs `npm start` running on port 3000 with real credentials in `.env`, and Chrome at the path below. Chrome cold start can exceed two minutes: run it in the background and poll.

```js
// Throwaway: drives headless Chrome over CDP through the Feedback report flow on the live page.
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=/tmp/vet-feedback-smoke-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
    for (let i = 0; i < 180; i++) {
        try { const list = await (await fetch('http://127.0.0.1:9333/json')).json(); const t = list.find(x => x.type === 'page'); if (t) return t; } catch (e) { /* not up yet */ }
        await sleep(1000);
    }
    throw new Error('no chrome page target');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const waiting = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
async function until(expr, label, seconds) { for (let i = 0; i < seconds; i++) { const v = await evaluate(expr); if (v) return v; await sleep(1000); } throw new Error('timeout waiting for ' + label); }
async function load() { await send('Page.navigate', { url: 'http://localhost:3000/vetting.html' }); await until('typeof window.vetAdd === "function"', 'page', 60); }
await send('Page.enable', {});
await load();
await evaluate('localStorage.clear(); true');
await load();
await evaluate('(() => { const r = document.getElementById("realmInput"); r.value = "spineshatter"; r.dispatchEvent(new Event("change")); return window.vetAdd("Rotminster"); })()');
await until('!!window.vetState().profiles.rotminster', 'profile', 120);
await evaluate('document.querySelector(\'tr[data-name="Rotminster"]\').click(); true');
await until('!!document.querySelector(".feedback-box button")', 'button', 10);
console.log('button text before:', await evaluate('document.querySelector(".feedback-box button").textContent'));
await evaluate('document.querySelector(".feedback-box button").click(); true');
console.log('button text while busy:', await evaluate('document.querySelector(".feedback-box button").textContent'));
const text = await until('(document.querySelector(".feedback-report") || document.querySelector(".feedback-status.error") || {}).textContent || ""', 'report', 300);
console.log('--- report or error ---\n' + text + '\n---');
console.log('facts rows:', await evaluate('document.querySelectorAll(".facts-table tr").length'));
console.log('bad-pull rows:', await evaluate('document.querySelectorAll(".facts-table tr.bad-pull").length'));
await load();
await evaluate('document.querySelector(\'tr[data-name="Rotminster"]\').click(); true');
console.log('persisted after reload:', await evaluate('!!document.querySelector(".feedback-report")'));
console.log('button text after reload:', await evaluate('document.querySelector(".feedback-box button").textContent'));
chrome.kill();
process.exit(0);
```

Run: `npm start` in the background, then `node <scratchpad>/vet-feedback-smoke.mjs` (foreground, up to 10 minutes).
Expected output: `button text before: Feedback report`, `button text while busy: Analysing…`, a report in the four-part structure (or a `.feedback-status.error` text you must then explain), `facts rows: 5` (header plus four kills), `bad-pull rows: 1`, `persisted after reload: true`, `button text after reload: Refresh report`. Paste the actual output into the commit message body of Step 4.

- [ ] **Step 3: Calibration on three failing players**

With the server running, generate reports for Rotminster and two other players the vetting table currently fails on parse (pick them from the leader's roster; the recent calibration named Xavamros and Pepasexa as low-parse examples). For each, read the report against its facts table and note in a short list: any finding that is noise (fires but says nothing useful), any obvious cause the report missed, and whether the model's numbers all appear in the facts. If a threshold in `T` is clearly wrong (for example `casts_low` firing on everyone at 0.85), change that one constant, rerun `node vet-feedback.test.js`, and adjust only the assertion that threshold moves. Record what was changed and why in the commit message.

- [ ] **Step 4: Commit**

```bash
git add README.md vet-feedback.js vet-feedback.test.js
git commit -m "docs: feedback report; calibration notes from three live reports

<paste the smoke output and the calibration list here>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Plan self-review

- **Spec coverage.** §2 data sources → Task 8 queries; §3.1 route steps → Tasks 8–9; §3.2 rate limits and in-flight sharing → Task 8 `getReference`, Task 9 `wclErrorResponse`; §3.3 facts sheet → Task 6 `buildFacts` (field names follow the spec with `raidGroup*` replacing `raidDps*` so healers and tanks rank among their own role); §3.4 reference → Tasks 4 and 8; §4.1–4.6 → Tasks 2, 5, 6; §4.8 stats → Task 5 `statFindings` plus Task 6 merge; §4.9 debuffs → Tasks 5–6; §4.10 ranking → Task 6; §5.1–5.3 → Tasks 7, 9, 10 (`fallbackReport`); §6 client → Task 10; §7 tests → every task, browser smoke in Task 11; §8 out of scope untouched.
- **Placeholder scan.** Every code step carries its code; the only judgement calls are Task 11's calibration, which says exactly what to look at and what may change.
- **Type consistency.** `fightContext` → `{ fight, me, meRow }` is what `killFacts` consumes; `referenceSummary` fields (`durationSec`, `castsDurationSec`, `castsPerMinute`, `casts`, `abilities`, `buffsAtPull`, `flaskShare`, `flask`, `bloodlustPercent`, `stats`) are the names `uptimeFindings`, `rotationFindings`, `damageFindings`, `statFindings`, `consumableFindings` and `factsTable` read; `getReference` returns `{ summary, note }` and `fetchFeedback` passes `summary` as `reference`; the route's `{ facts, report, reportError, generatedAt }` is what `requestFeedback` stores and `feedbackBox` renders.
