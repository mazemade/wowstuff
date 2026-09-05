# Feedback Report v4 — Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the model-written feedback note with a deterministic, capped checklist report (one row per habit, fixed fix text, a verdict line) and move it out of the roster row into its own page.

**Architecture:** A new pure module `vet-checklist.js` reads the existing facts sheet (per-pull `kills[]` with `me`, `reference`, `fight`, `debuffs`, `gap`, `findings`; `gear.findings`; `overall.badPulls` / `ceiling`) and produces `overall.checklist` plus the plain-text report. `vet-feedback.js` loses `mergeFindings`, `positives`, the prompt and both guards; `server.js` stops calling OpenAI for this route. A new `feedback.html` page fetches `/api/vet/feedback` itself and renders the checklist as cards; the vetting page keeps only a "Report" link per row.

**Tech Stack:** Node ≥ 20 (no dependencies; `node --env-file=.env` for local runs), plain browser JS/CSS (no build step), the repo's own `test(name, fn)` harness (`node <file>.test.js` prints `N passed, M failed`, exits non-zero on failure), headless Chrome over CDP for the page smoke test.

**Spec:** `docs/superpowers/specs/2026-09-05-feedback-v4-checklist-design.md` — read it first; every task below cites the section it implements.

## Global Constraints

- No new npm dependencies. Node-only modules stay pure: no `fetch`, no I/O in `vet-checklist.js`.
- `vet-checklist.js` must not `require('./vet-feedback.js')` (vet-feedback requires it; that would be circular). Anything it needs from there moves to `vet-gap.js` (Task 2).
- Every row id appears at most once in `checklist.rows` (spec §2 "one habit, one row").
- Caps: `ROW_CAPS = { fixFirst: 3, also: 5, asks: 3 }` (spec §4.6). The text is under 320 words for the Lovestoned fixture (spec §5).
- Reference label everywhere: `players at your item level among the top 2000 parses` (`GAP.REF_LABEL`).
- Plain text report: second person, no markdown, sections in the spec §5 order, last line exactly `Pick one thing to change next raid.`
- The `Sec-Fetch-Site` gate, caches and in-flight dedup on `/api/vet/feedback` are unchanged (spec §3).
- Commit after every task; `npm test` must pass at every commit (run the individual suite you touched during a task, the whole thing before committing).
- Test harness pattern (copy it exactly in new test files):
  ```js
  'use strict';
  const assert = require('node:assert');
  let passed = 0, failed = 0;
  function test(name, fn) {
      try { fn(); passed++; console.log('ok -', name); }
      catch (e) { failed++; console.error('FAIL -', name, '\n   ', e.message); }
  }
  // ...tests...
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  ```

## File structure

| File | Responsibility |
|---|---|
| `vet-gap.js` (modify) | gains `POTION_LABEL`, `UTILITY_CAST`, `RACIAL`, `ENCOUNTER_ITEM` (moved from vet-feedback); loses `FINDING_ANCHOR` |
| `vet-checklist.js` (create) | constants (§4.4), aggregation helpers (§4.2), one function per check family (§4.3), `verdict` (§4.5), `buildChecklist` (§4.6), `renderReport` (§5) |
| `vet-checklist.test.js` (create) | unit tests on synthetic sheets + golden test on `fixtures/facts-lovestoned-v3.json` |
| `vet-feedback.js` (modify) | `fightContext` adds `fight.sameClass`; `gearFindings` rows carry `value`/`bar`; `buildFacts` emits `overall.checklist`; prompt/guards/merge/positives removed |
| `vet-feedback.test.js`, `vet-gap.test.js` (modify) | tests of removed functions deleted; `buildFacts` tests read `overall.checklist` |
| `server.js`, `server.test.js` (modify) | route returns `{ facts, report, generatedAt }`, no OpenAI |
| `feedback.html`, `feedback.js`, `feedback.css` (create) | the report page (§6) |
| `vetting.html`, `vetting.js`, `vetting.css` (modify) | Report link; feedback box and its state removed |
| `package.json`, `README.md` (modify) | test script includes the new suite; docs |

---

### Task 1: `fight.sameClass` — same-class players in the pull

**Files:**
- Modify: `vet-feedback.js:134-205` (`fightContext`), `vet-feedback.js:901-935` (`killFacts`)
- Test: `vet-feedback.test.js`

**Interfaces:**
- Produces: `fightContext(ctx, playerName, role, refDurationSec, metric, name, classToken)` — new 7th argument; `fight.sameClass: [{ name, amount, isMe }]` sorted by `amount` descending, `amount` = `Math.round(total / durationSec)`; `[]` when the class or the table is unknown.

- [ ] **Step 1: Write the failing test** (append to `vet-feedback.test.js` before the final summary lines)

```js
test('fightContext (v4 §3): fight.sameClass lists every same-class player row by DPS, pets excluded, the player flagged', () => {
    const ctx = {
        fights: [{ id: 1, startTime: 0, endTime: 100000 }],
        rankings: { data: [{ roles: { dps: { characters: [{ name: 'Lovestoned', amount: 1000, rankPercent: 20 }] } } }] },
        dmgAll: { data: { totalTime: 100000, entries: [
            { name: 'Cartis', type: 'Warlock', total: 137200, activeTime: 90000 },
            { name: 'Lovestoned', type: 'Warlock', total: 136300, activeTime: 90000 },
            { name: 'Xeasha', type: 'Warlock', total: 131900, activeTime: 90000 },
            { name: 'Disxia', type: 'Pet', total: 5000, activeTime: 90000 },
            { name: 'Craqu', type: 'Mage', total: 200000, activeTime: 90000 },
        ] } },
        deaths: { data: { entries: [] } },
    };
    const fc = F.fightContext(ctx, 'Lovestoned', 'caster', null, 'dps', 'Void Reaver', 'WARLOCK');
    assert.deepStrictEqual(fc.fight.sameClass, [
        { name: 'Cartis', amount: 1372, isMe: false }, { name: 'Lovestoned', amount: 1363, isMe: true }, { name: 'Xeasha', amount: 1319, isMe: false },
    ]);
    assert.deepStrictEqual(F.fightContext(ctx, 'Lovestoned', 'caster', null, 'dps', 'Void Reaver').fight.sameClass, [], 'no class token: empty');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node vet-feedback.test.js 2>&1 | grep -A2 "sameClass"`
Expected: `FAIL - fightContext (v4 §3): fight.sameClass …` (deepStrictEqual on `undefined`)

- [ ] **Step 3: Implement**

In `fightContext`, change the signature to `function fightContext(ctx, playerName, role, refDurationSec, metric, name, classToken)` and, after `const raidActivePercent = …`, add:

```js
    // v4 §3: the player's same-class peers in this pull, from the fight-wide table already
    // fetched. WCL's `type` is the class name ("Warlock"); the profile's token is "WARLOCK".
    const cls = lower(classToken);
    const sameClass = (cls && durationSec) ? rows.filter(r => r.type !== 'Pet' && lower(r.type) === cls)
        .map(r => ({ name: r.name, amount: Math.round((r.total || 0) / durationSec), isMe: lower(r.name) === me }))
        .sort((a, b) => b.amount - a.amount) : [];
```

and add `sameClass,` to the returned `fight` object (after `raidActivePercent,`). In `killFacts` change the `fightContext(...)` call to pass `player.classToken` as the 7th argument.

- [ ] **Step 4: Run the suite**

Run: `node vet-feedback.test.js 2>&1 | tail -3`
Expected: `… passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): fight.sameClass — same-class players in the pull, from the fight-wide table"
```

---

### Task 2: Move shared name tables to `vet-gap.js`; `gearFindings` rows carry `value`/`bar`

**Files:**
- Modify: `vet-gap.js` (constants + exports), `vet-feedback.js:245-290, 462-515, 661-688` and its `module.exports`
- Test: `vet-gap.test.js`, `vet-feedback.test.js`

**Interfaces:**
- Produces: `GAP.POTION_LABEL`, `GAP.UTILITY_CAST`, `GAP.RACIAL`, `GAP.ENCOUNTER_ITEM` (identical values to today's vet-feedback constants); `F.POTION_LABEL` etc. keep working as re-exports. `gearFindings` findings gain `value: r.value` and `bar: r.key === 'hit' ? r.effective : r.threshold` (numbers; `bar` is `null` for enchants/sockets).

- [ ] **Step 1: Write the failing tests**

Append to `vet-gap.test.js`:
```js
test('v4: the cast-name tables live in vet-gap so vet-checklist can use them without a circular require', () => {
    assert.strictEqual(G.POTION_LABEL.Destruction, 'Destruction Potion');
    assert.ok(G.UTILITY_CAST.test('Life Tap') && G.RACIAL.test('Blood Fury') && G.ENCOUNTER_ITEM.test('Staff of Disintegration'));
    assert.strictEqual(G.FINDING_ANCHOR, undefined, 'FINDING_ANCHOR is gone with the completeness guard');
});
```
Append to `vet-feedback.test.js`:
```js
test('gearFindings (v4): every row carries the measured value and the bar it was judged against', () => {
    const profile = { name: 'X', gear: [], gearSummary: { gearScore: 1900, avgItemLevel: 126, emptySockets: 0 }, computed: { spellHit: 185 }, parses: null, identity: { role: 'caster', class: 'WARLOCK', spec: 'Destruction' } };
    const rows = F.gearFindings(profile, { spellHit: 202 }, Date.now());
    const hit = rows.find(r => r.key === 'gear_hit');
    assert.ok(hit, 'a hit row is emitted for 185 against 202');
    assert.strictEqual(hit.value, 185);
    assert.strictEqual(hit.bar, 202);
});
```
(If `V.evaluate` needs more profile fields to emit the hit rule, build the profile the way the existing `gearFindings` tests in this file do — grep `gearFindings(` in the test file and reuse that profile.)

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-gap.test.js 2>&1 | grep FAIL; node vet-feedback.test.js 2>&1 | grep FAIL`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement**

In `vet-gap.js`, before `module.exports`, add (copied verbatim from vet-feedback.js):
```js
// v4: cast-name tables shared by the findings (vet-feedback.js) and the checklist (vet-checklist.js).
const POTION_LABEL = { Destruction: 'Destruction Potion', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' };
const UTILITY_CAST = /life tap|healthstone|bandage|first aid|cannibalize|soulstone|soulshatter|rune$|potion|drain soul|^create |^summon |armor$|resurrection|^restore mana$/i;
const RACIAL = /blood fury|berserking|arcane torrent|stoneform|will of the forsaken|war stomp|escape artist|perception|shadowmeld|gift of the naaru/i;
const ENCOUNTER_ITEM = /mental protection field|staff of disintegration|phaseshift bulwark|netherstrand longbow|infinity blade|warp slicer|cosmic infuser/i;
```
Add them to `module.exports`; remove `FINDING_ANCHOR` (its definition and its export). In `vet-feedback.js` delete the four definitions and replace with `const { POTION_LABEL, UTILITY_CAST, RACIAL, ENCOUNTER_ITEM } = GAP;` (keep them in `module.exports`). In `gearFindings`, change the push to:
```js
        f.push(finding('gear_' + r.key, sev, 'player', text, { value: r.value, bar: (r.key === 'enchants' || r.key === 'sockets') ? null : (r.key === 'hit' ? r.effective : r.threshold) }));
```
Delete every `vet-gap.test.js` test that references `FINDING_ANCHOR` (grep `FINDING_ANCHOR vet-gap.test.js`; 8 lines today).

- [ ] **Step 4: Run both suites**

Run: `node vet-gap.test.js 2>&1 | tail -2; node vet-feedback.test.js 2>&1 | tail -2`
Expected: `0 failed` on both. (The completeness-guard tests in vet-feedback.test.js that read `GAP.FINDING_ANCHOR` will fail now — that is expected; they are deleted in Task 7. If that blocks the commit, delete those specific tests now: grep `FINDING_ANCHOR\|anchorOf` in vet-feedback.test.js.)

- [ ] **Step 5: Commit**

```bash
git add vet-gap.js vet-gap.test.js vet-feedback.js vet-feedback.test.js
git commit -m "refactor(feedback): cast-name tables move to vet-gap; gear findings carry value and bar; FINDING_ANCHOR retired"
```

---

### Task 3: `vet-checklist.js` — constants, aggregation helpers, share-based rows (casting, group, raid)

**Files:**
- Create: `vet-checklist.js`, `vet-checklist.test.js`
- Modify: `package.json` (add `&& node vet-checklist.test.js` before `&& node server.test.js`)

**Interfaces:**
- Produces (all exported): `NOMINAL_VALUE`, `ROW_CAPS`, `FINE_IDS`, `CATEGORY_ORDER`, `DEFAULT_T`, `MOVEMENT_FILLER`, `ABILITY_FIX`, `NUKE_FIX`, `BUFF_SOURCE`, `STAT_WORD`, `liveKills(facts)`, `inputOf(kill, key)`, `averageShare(kills, key)`, `largestPull(kills, key)`, `verdictForShare(share)`, `verdictForHabit(hit, of)`, `pullLabel(kill, kills)`, `row(o)`, `castingRows(facts, T)`, `groupRows(facts)`, `raidRows(facts)`.
- Row shape (spec §4.1): `{ id, category, owner, verdict, me, reference, unit, pulls: { hit, of } | null, value, text, fix, measuredOn }`.

- [ ] **Step 1: Write the failing tests** — create `vet-checklist.test.js` with the harness header from Global Constraints, then:

```js
const C = require('./vet-checklist.js');

// A minimal accounting pull: only the inputs a test names carry a share; everything else is 0.
function gapKill(name, inputs, extra) {
    const mk = (key, owner, share, me, reference, unit) => ({ key, owner, share, me, reference, unit });
    const get = (k, d) => (inputs[k] !== undefined ? inputs[k] : d);
    const casts = [mk('raid_activity', 'raid', get('raid_activity', 0), 95, 96, 'raid median active %'), mk('own_activity', 'player', get('own_activity', 0), 90, 95, 'active %'),
                   mk('channel_time', 'player', get('channel_time', 0), 1, 0, 'seconds a minute channelling'), mk('cast_pacing', 'player', get('cast_pacing', 0), 20, 24, 'damaging casts a minute')];
    const dmg = [mk('hit_under_cap', 'player', get('hit_under_cap', 0), 202, 160, 'hit rating'), mk('debuffs', 'group', get('debuffs', 0), 1.1, 1.21, 'debuff multiplier'),
                 mk('power_gear', 'player', get('power_gear', 0), 1026, 1007, 'spell power from gear'), mk('power_consumables', 'player', get('power_consumables', 0), 78, 103, 'spell power from consumables'),
                 mk('power_buffs', 'group', get('power_buffs', 0), 0, 40, 'spell power from party buffs'), mk('rotation', 'player', get('rotation', 0), 3065, 3869, 'damage per cast (crits included)')];
    const crit = [mk('crit_gear', 'player', get('crit_gear', 0), 20, 22, 'crit % from gear'), mk('crit_buffs', 'group', get('crit_buffs', 0), 0, 5, 'crit % from party buffs'), mk('crit_luck', 'noise', get('crit_luck', 0), 35, 44, 'measured crit %')];
    const sum = arr => arr.reduce((s, i) => s + i.share, 0);
    return Object.assign({
        name, date: '2026-08-20', rankPercent: 20,
        fight: { durationSec: 186, badPull: false, badPullReason: null, raidActivePercent: 96, sameClass: [] },
        debuffs: { known: true, present: [{ name: 'Curse of the Elements', uptimePercent: 98 }], missing: [{ name: 'Misery', value: '5% spell hit', source: 'a shadow priest' }, { name: 'Shadow Weaving', value: '10% more shadow damage', source: 'a shadow priest' }] },
        me: { amount: 1362, activePercent: 94.5, died: null, potionUse: 0, consumablesKnown: true, consumablesAtPull: ['Well Fed', 'Major Shadow Power'], buffsAtPull: ['Arcane Brilliance'], partyBuffs: ['Arcane Brilliance'],
              flask: null, battleElixir: 'Major Shadow Power', guardianElixir: null, food: 'Well Fed', casts: { 'Shadow Bolt': 65, 'Life Tap': 6, 'Curse of the Elements': 1 },
              abilities: [{ name: 'Shadow Bolt', share: 99, hits: 64, avgHit: 3065, avgCrit: 6261, critPercent: 35.9, resistPercent: 17 }],
              bloodlustPercent: 22, burst: [], stats: { spellHit: 203, spellCrit: 293, spellDamage: 1026 }, damagingCastsPerMinute: 21.3, damagePerDamagingCast: 3841, critRate: 35.4, channelSecPerMin: 0.4 },
        reference: { playersDps: 2217, dps: 2217, topDps: 2600, castsDurationSec: 140, flaskShare: 1, flask: 'Flask of Pure Death', consumablesAtPull: ['Well Fed', 'Flask of Pure Death'],
                     buffsAtPull: ['Moonkin Aura', 'Arcane Brilliance'], casts: { 'Shadow Bolt': 54, 'Curse of Doom': 2, 'Shadowburn': 1, Destruction: 1, 'Life Tap': 6 },
                     abilities: [{ name: 'Shadow Bolt', share: 91, avgHit: 3869, avgCrit: 8162, critPercent: 44, resistPercent: 18, hits: 54 }, { name: 'Curse of Doom', share: 7.2, avgHit: null, hits: 0 }],
                     bloodlustPercent: 28, burst: [{ name: 'Destruction', uses: 1, insideBloodlust: 1 }], damagingCastsPerMinute: 24.3, damagePerDamagingCast: 5474, critRate: 43.6, channelSecPerMin: 0, raidActivePercent: 96.7, debuffs: [], stats: { spellHit: 164, spellCrit: 370, spellDamage: 1007 } },
        findings: [],
        gap: { ratio: 1.63, factors: { casts: { value: 1.14, share: sum(casts), inputs: casts }, dmg: { value: 1.3, share: sum(dmg), inputs: dmg }, crit: { value: 1.06, share: sum(crit), inputs: crit }, residual: { value: 1, share: 0, inputs: [] } } },
    }, extra || {});
}
function sheet(kills, extra) {
    return Object.assign({ player: { name: 'Lovestoned', class: 'WARLOCK', spec: 'Destruction', role: 'caster', metric: 'dps', itemLevel: 126 },
        tier: { zoneName: 'SSC/TK', medianPercent: 28.1 }, gear: { findings: [] }, kills,
        overall: { badPulls: [], ceiling: [], gap: null, droppedKills: [] }, limited: false, nights: [], night: null }, extra || {});
}

test('averageShare / largestPull: absent pulls count 0; the biggest pull supplies the numbers', () => {
    const kills = [gapKill('A', { cast_pacing: 40 }), gapKill('B', { cast_pacing: 20 }), gapKill('C', {}, { gap: null })];
    assert.strictEqual(C.averageShare(kills, 'cast_pacing'), 30, 'averaged over the two accounting pulls only');
    assert.strictEqual(C.largestPull(kills, 'cast_pacing').kill.name, 'A');
    assert.strictEqual(C.averageShare([gapKill('C', {}, { gap: null })], 'cast_pacing'), null);
});
test('verdictForShare applies the floor once, to the average; verdictForHabit is the half-of-pulls rule', () => {
    assert.strictEqual(C.verdictForShare(5), 'fail'); assert.strictEqual(C.verdictForShare(3), 'warn'); assert.strictEqual(C.verdictForShare(2), 'pass'); assert.strictEqual(C.verdictForShare(-4), 'pass');
    assert.strictEqual(C.verdictForHabit(3, 5), 'fail'); assert.strictEqual(C.verdictForHabit(2, 5), 'warn'); assert.strictEqual(C.verdictForHabit(0, 5), 'pass'); assert.strictEqual(C.verdictForHabit(0, 0), null);
});
test('castingRows: cast_rate from cast_pacing with the spec\'s filler, activity with the raid median, channel, life_taps info', () => {
    const f = sheet([gapKill('Void Reaver', { cast_pacing: 22, own_activity: 4, channel_time: 1 })]);
    const rows = C.castingRows(f, C.DEFAULT_T);
    const cr = rows.find(r => r.id === 'cast_rate');
    assert.strictEqual(cr.verdict, 'fail'); assert.strictEqual(cr.value, 22); assert.strictEqual(cr.owner, 'player'); assert.strictEqual(cr.category, 'casting');
    assert.strictEqual(cr.text, '20 damaging casts a minute while active against 24 on Void Reaver');
    assert.strictEqual(cr.fix, 'Queue the next Shadow Bolt before the current one lands; move only when you must, and use Shadowburn or Life Tap while moving.');
    const act = rows.find(r => r.id === 'activity');
    assert.strictEqual(act.verdict, 'warn'); assert.strictEqual(act.text, 'Active 90% against 95% for comparable players (your raid: 96%) on Void Reaver');
    assert.strictEqual(rows.find(r => r.id === 'channel').verdict, 'pass');
    const lt = rows.find(r => r.id === 'life_taps');
    assert.strictEqual(lt.verdict, 'info'); assert.strictEqual(lt.value, null); assert.strictEqual(lt.text, 'Life Tap 1.9 a minute; comparable players 2.6');
});
test('castingRows: without an accounting the v2 active_low rule gives a habit row, never a share', () => {
    const k = gapKill('Al\'ar', {}, { gap: null }); k.me.activePercent = 70; k.fight.raidActivePercent = 90;
    const rows = C.castingRows(sheet([k]), C.DEFAULT_T);
    const act = rows.find(r => r.id === 'activity');
    assert.strictEqual(act.verdict, 'fail'); assert.strictEqual(act.value, null); assert.deepStrictEqual(act.pulls, { hit: 1, of: 1 });
    assert.ok(!rows.find(r => r.id === 'cast_rate'), 'no cast_rate row without an accounting');
});
test('groupRows: debuffs names what is missing on how many pulls and who brings it; party_buffs sums crit and power shares; curse is a warn ask', () => {
    const f = sheet([gapKill('Void Reaver', { debuffs: 19, crit_buffs: 8, power_buffs: 3 }), gapKill('Morogrim Tidewalker', { debuffs: 15, crit_buffs: 6 })]);
    const rows = C.groupRows(f);
    const d = rows.find(r => r.id === 'debuffs');
    assert.strictEqual(d.owner, 'group'); assert.strictEqual(d.verdict, 'fail'); assert.strictEqual(d.value, 17);
    assert.strictEqual(d.text, 'No Misery or Shadow Weaving on 2 of 2 pulls (a shadow priest)');
    const b = rows.find(r => r.id === 'party_buffs');
    assert.strictEqual(b.value, 9, 'crit 7 + power 2, each averaged over the accounting pulls first');
    assert.strictEqual(b.text, 'No Moonkin Aura in your group on 2 of 2 pulls (a moonkin)');
    const c = rows.find(r => r.id === 'curse');
    assert.strictEqual(c.verdict, 'warn'); assert.strictEqual(c.owner, 'group'); assert.strictEqual(c.value, null);
    assert.strictEqual(c.text, 'You run Curse of the Elements (assignment); comparable players run Curse of Doom, 7% of their damage');
    assert.strictEqual(c.fix, 'Rotate the assignment or give it to the warlock with the lowest DPS.');
});
test('groupRows: bloodlust ask only when the reference had it and the player did not', () => {
    const k = gapKill('Void Reaver', {}); k.me.bloodlustPercent = 0;
    assert.strictEqual(C.groupRows(sheet([k])).find(r => r.id === 'bloodlust').text, 'No Bloodlust on 1 of 1 pulls while comparable players had it');
    assert.ok(!C.groupRows(sheet([gapKill('Void Reaver', {})])).find(r => r.id === 'bloodlust'));
});
test('raidRows: raid_activity is a row only at 3% or more', () => {
    assert.strictEqual(C.raidRows(sheet([gapKill('Al\'ar', { raid_activity: 6 })]))[0].text, 'Your raid was active 95% of Al\'ar against 96% for the reference raid; phases and downtime, not you');
    assert.deepStrictEqual(C.raidRows(sheet([gapKill('Al\'ar', { raid_activity: 2 })])), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node vet-checklist.test.js`
Expected: `Cannot find module './vet-checklist.js'`

- [ ] **Step 3: Create `vet-checklist.js`**

```js
'use strict';
// Feedback report v4 (spec docs/superpowers/specs/2026-09-05-feedback-v4-checklist-design.md):
// one row per habit, aggregated over the live pulls of a facts sheet, with fixed fix text; the
// verdict, the caps, and the plain-text report. Pure: no I/O, no vet-feedback.js require.
const GAP = require('./vet-gap.js');

const NOMINAL_VALUE = { potion: 3, flask: 2, food: 1, oil: 1, burst_timing: 2, unused: 2, hit: 1 };
const ROW_CAPS = { fixFirst: 3, also: 5, asks: 3 };
const FINE_IDS = ['food', 'flask', 'potion', 'activity', 'deaths', 'power_gear', 'hit'];
const CATEGORY_ORDER = ['consumables', 'cooldowns', 'casting', 'spells', 'nuke', 'gear', 'group', 'raid'];
// The five thresholds this module reads; vet-feedback.js's T carries the same values and is
// passed in by buildFacts so the two never drift.
const DEFAULT_T = { potionMinSec: 60, unusedPerMin: 1.5, unusedPerFightCooldown: 1, extraPerMin: 1, ratioLow: 0.7 };
const MOVEMENT_FILLER = { Destruction: 'Shadowburn or Life Tap', Affliction: 'Curse of Agony or Life Tap', Demonology: 'Shadowburn or Life Tap', Fire: 'Fire Blast or Scorch', Arcane: 'Fire Blast or Arcane Explosion', Frost: 'Fire Blast or Ice Lance',
                          Shadow: 'Shadow Word: Death or Devouring Plague', Balance: 'Moonfire or Insect Swarm', Elemental: 'Flame Shock or Earth Shock', default: 'an instant' };
const ABILITY_FIX = { Shadowburn: 'Use it while moving and under 25% boss health when you have shards.', 'Curse of Doom': 'Put it up on the pull and refresh it the moment it expires.', 'Curse of Agony': 'Keep it up on the boss.',
                      'Fire Blast': 'Use it while moving.', Scorch: 'Keep five stacks of Fire Vulnerability up when you are the assigned mage.', 'Shadow Word: Death': 'Use it on every cooldown when the healers can cover it.',
                      Conflagrate: 'Use it whenever Immolate is up and about to expire.', 'Arcane Blast': 'Open with three Arcane Blasts before your filler.', Starfire: 'Cast it whenever the boss is not moving.' };
const NUKE_FIX = { Destruction: 'Check Shadow and Flame 5/5, Ruin, Shadow Bolt rank 11 and Demonic Sacrifice on a Succubus.', Affliction: 'Check Shadow Mastery 5/5, Contagion and the rank of every DoT.', Demonology: 'Check Demonic Tactics, Master Demonologist and Shadow Bolt rank 11.',
                   Fire: 'Check Fire Power 5/5, Ignite and Fireball or Scorch rank.', Arcane: 'Check Spell Power 2/2, Arcane Power and Arcane Blast rank.', Frost: 'Check Ice Shards 5/5, Piercing Ice and Frostbolt rank.',
                   Shadow: 'Check Darkness 5/5, Shadowform and Mind Blast rank.', Balance: 'Check Moonfury 5/5, Wrath of Cenarius and Starfire rank.', Elemental: 'Check Concussion 5/5, Call of Thunder and Lightning Bolt rank.' };
const BUFF_SOURCE = { 'Moonkin Aura': 'a moonkin', 'Totem of Wrath': 'an elemental shaman', 'Wrath of Air Totem': 'a shaman', 'Prayer of Spirit': 'a priest', 'Eye of the Night': 'any caster with the trinket', 'Chain of the Twilight Owl': 'any caster with the trinket',
                      'Fel Intelligence': 'a demonology warlock', 'Blood Pact': 'an imp', 'Arcane Brilliance': 'a mage', 'Greater Blessing of Kings': 'a paladin', 'Greater Blessing of Wisdom': 'a paladin', 'Mana Spring Totem': 'a shaman',
                      'Battle Shout': 'a warrior', 'Leader of the Pack': 'a feral druid', 'Trueshot Aura': 'a hunter', 'Ferocious Inspiration': 'a beast mastery hunter', 'Strength of Earth Totem': 'a shaman', 'Grace of Air Totem': 'a shaman',
                      'Unleashed Rage': 'an enhancement shaman', 'Greater Blessing of Might': 'a paladin', 'Windfury Totem': 'a shaman' };
const STAT_WORD = { spellCrit: 'spell crit', spellHaste: 'spell haste', spellDamage: 'spell power', meleeCrit: 'crit', meleeHaste: 'haste', attackPower: 'attack power', rangedAttackPower: 'ranged attack power', expertise: 'expertise', spellHit: 'spell hit', meleeHit: 'hit', rangedCrit: 'crit' };

// --- helpers (spec §4.2)
const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
const pct = x => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);
function liveKills(facts) { return ((facts && facts.kills) || []).filter(k => k && k.fight && !k.fight.badPull); }
function inputOf(kill, key) {
    if (!kill || !kill.gap) return null;
    for (const f of ['casts', 'dmg', 'crit']) { const i = kill.gap.factors[f].inputs.find(x => x.key === key); if (i) return i; }
    return null;
}
function averageShare(kills, key) {
    const acc = kills.filter(k => k.gap);
    if (!acc.length) return null;
    return Math.round(acc.reduce((s, k) => { const i = inputOf(k, key); return s + (i ? i.share : 0); }, 0) / acc.length);
}
function largestPull(kills, key) {
    let best = null;
    kills.forEach(k => { const i = inputOf(k, key); if (i && (!best || i.share > best.input.share)) best = { kill: k, input: i }; });
    return best;
}
function verdictForShare(share) { return share >= 5 ? 'fail' : share >= 3 ? 'warn' : 'pass'; }
function verdictForHabit(hit, of) { if (!of) return null; return hit * 2 >= of ? 'fail' : hit > 0 ? 'warn' : 'pass'; }
// The boss name, dated when the sheet has more than one live pull of that boss (v2 rule).
function pullLabel(kill, kills) {
    const twice = kills.filter(k => k.name === kill.name).length > 1;
    return twice && kill.date ? kill.name + ' (' + kill.date + ')' : kill.name;
}
function row(o) { return Object.assign({ owner: 'player', me: null, reference: null, unit: null, pulls: null, value: null, text: '', fix: '', measuredOn: null }, o); }
function pullsText(hit, of) { return hit + ' of ' + of + ' pulls'; }
function shareRow(facts, o) {
    const kills = liveKills(facts);
    const share = averageShare(kills, o.key);
    const best = largestPull(kills, o.key);
    if (share === null || !best) return null;
    const label = pullLabel(best.kill, kills);
    return row({ id: o.id, category: o.category, owner: o.owner || 'player', verdict: verdictForShare(share), me: best.input.me, reference: best.input.reference, unit: best.input.unit,
                 value: share > 0 ? share : null, measuredOn: label, text: o.text(best.input, best.kill, label, share), fix: typeof o.fix === 'function' ? o.fix(best.input, best.kill) : (o.fix || '') });
}
function mainAbility(kill) { const a = kill && kill.reference && Array.isArray(kill.reference.abilities) && kill.reference.abilities[0]; return a ? a.name : 'spell'; }
function perMin(count, sec) { return sec ? Math.round(10 * 60 * count / sec) / 10 : null; }

// --- casting (spec §4.3 "Casting")
function castingRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts), spec = facts.player && facts.player.spec;
    const out = [];
    const cr = shareRow(facts, { id: 'cast_rate', key: 'cast_pacing', category: 'casting',
        text: (i, k, label) => pct(i.me) + ' damaging casts a minute while active against ' + pct(i.reference) + ' on ' + label,
        fix: (i, k) => 'Queue the next ' + mainAbility(k) + ' before the current one lands; move only when you must, and use ' + (MOVEMENT_FILLER[spec] || MOVEMENT_FILLER.default) + ' while moving.' });
    if (cr) out.push(cr);
    const act = shareRow(facts, { id: 'activity', key: 'own_activity', category: 'casting',
        text: (i, k, label) => 'Active ' + pct(i.me) + '% against ' + pct(i.reference) + '% for comparable players' + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : '') + ' on ' + label,
        fix: 'Keep casting through transitions; if an assignment took you off the boss, tell the raid leader so it is counted as not on you.' });
    if (act) out.push(act);
    else {
        // v2 active_low, for sheets without an accounting (healers, no reference, player ahead).
        const measurable = kills.filter(k => num(k.me.activePercent) !== null);
        const failing = measurable.filter(k => k.me.activePercent < 85 || (num(k.fight.raidActivePercent) !== null && k.me.activePercent < 92 && k.fight.raidActivePercent - k.me.activePercent >= 8));
        const v = verdictForHabit(failing.length, measurable.length);
        if (v) {
            const k = failing[0] || measurable[0];
            out.push(row({ id: 'activity', category: 'casting', verdict: v, me: k.me.activePercent, reference: num(k.fight.raidActivePercent), unit: 'active %', pulls: { hit: failing.length, of: measurable.length }, measuredOn: pullLabel(k, kills),
                           text: 'Active ' + pct(k.me.activePercent) + '% of ' + pullLabel(k, kills) + (num(k.fight.raidActivePercent) !== null ? ' (your raid: ' + pct(k.fight.raidActivePercent) + '%)' : ''),
                           fix: 'Keep casting through transitions; if an assignment took you off the boss, tell the raid leader so it is counted as not on you.' }));
        }
    }
    const ch = shareRow(facts, { id: 'channel', key: 'channel_time', category: 'casting',
        text: (i, k, label) => 'Channelling Drain Soul and other utility ' + pct(i.me) + ' seconds of every minute on ' + label + '; comparable players ' + pct(i.reference),
        fix: 'Drain Soul only in the last seconds; never channel while the boss is targetable.' });
    if (ch) out.push(ch);
    // Life taps: shown, never graded (tbc-audit's rule).
    const withRef = kills.filter(k => k.reference && k.fight.durationSec && ((k.me.casts || {})['Life Tap'] || (k.reference.casts || {})['Life Tap']));
    if (withRef.length) {
        const k = withRef[0];
        const mine = perMin((k.me.casts || {})['Life Tap'] || 0, k.fight.durationSec), theirs = perMin((k.reference.casts || {})['Life Tap'] || 0, k.reference.castsDurationSec);
        out.push(row({ id: 'life_taps', category: 'casting', verdict: 'info', me: mine, reference: theirs, unit: 'a minute', measuredOn: pullLabel(k, kills), text: 'Life Tap ' + mine + ' a minute; comparable players ' + (theirs === null ? '—' : theirs) }));
    }
    return out;
}

// --- group asks (spec §4.3 "Group")
function halfRule(counts, of) { return Object.keys(counts).filter(n => counts[n] * 2 >= of); }
function groupRows(facts) {
    const kills = liveKills(facts), out = [];
    const d = shareRow(facts, { id: 'debuffs', key: 'debuffs', category: 'group', owner: 'group', text: () => '' });
    if (d) {
        const known = kills.filter(k => k.debuffs && k.debuffs.known);
        const counts = {}, sources = new Set();
        known.forEach(k => (k.debuffs.missing || []).forEach(m => { counts[m.name] = (counts[m.name] || 0) + 1; }));
        const names = halfRule(counts, known.length);
        known.forEach(k => (k.debuffs.missing || []).forEach(m => { if (names.includes(m.name)) sources.add(m.source); }));
        const hit = known.filter(k => (k.debuffs.missing || []).some(m => names.includes(m.name))).length;
        d.pulls = { hit, of: known.length };
        d.text = names.length ? 'No ' + names.join(' or ') + ' on ' + pullsText(hit, known.length) + ' (' + Array.from(sources).join(', ') + ')'
                              : 'Raid debuffs on ' + d.measuredOn + ' multiplied damage by ' + d.me + ' against ' + d.reference + ' for the reference raid';
        out.push(d);
    }
    const critShare = averageShare(kills, 'crit_buffs'), powerShare = averageShare(kills, 'power_buffs');
    if (critShare !== null || powerShare !== null) {
        const total = (critShare || 0) + (powerShare || 0);
        const withRef = kills.filter(k => k.reference && Array.isArray(k.reference.buffsAtPull) && k.me.consumablesKnown);
        const counts = {};
        withRef.forEach(k => k.reference.buffsAtPull.filter(b => !(k.me.partyBuffs || []).includes(b)).forEach(b => { counts[b] = (counts[b] || 0) + 1; }));
        const names = halfRule(counts, withRef.length);
        const hit = withRef.filter(k => k.reference.buffsAtPull.some(b => names.includes(b) && !(k.me.partyBuffs || []).includes(b))).length;
        const best = largestPull(kills, 'crit_buffs') || largestPull(kills, 'power_buffs');
        if (names.length) out.push(row({ id: 'party_buffs', category: 'group', owner: 'group', verdict: verdictForShare(total), value: total > 0 ? total : null, pulls: { hit, of: withRef.length }, measuredOn: best ? pullLabel(best.kill, kills) : null,
            text: 'No ' + names.join(' or ') + ' in your group on ' + pullsText(hit, withRef.length) + ' (' + Array.from(new Set(names.map(n => BUFF_SOURCE[n] || 'another class'))).join(', ') + ')' }));
    }
    const lustKills = kills.filter(k => k.reference && num(k.reference.bloodlustPercent) !== null && num(k.me.bloodlustPercent) !== null);
    const noLust = lustKills.filter(k => k.reference.bloodlustPercent > 0 && k.me.bloodlustPercent === 0);
    if (noLust.length) out.push(row({ id: 'bloodlust', category: 'group', owner: 'group', verdict: verdictForHabit(noLust.length, lustKills.length), pulls: { hit: noLust.length, of: lustKills.length }, measuredOn: pullLabel(noLust[0], kills),
        text: 'No Bloodlust on ' + pullsText(noLust.length, lustKills.length) + ' while comparable players had it' }));
    // Curse: an assignment question, one row, only when the two sides' most-cast curse differ.
    const isCurse = n => /^curse of /i.test(n);
    const most = casts => Object.keys(casts || {}).filter(isCurse).filter(n => casts[n] > 0).sort((a, b) => casts[b] - casts[a])[0] || null;
    const differ = kills.filter(k => k.reference && most(k.me.casts) && most(k.reference.casts) && most(k.me.casts) !== most(k.reference.casts) && !(k.me.casts || {})[most(k.reference.casts)]);
    if (differ.length) {
        const k = differ[0], mine = most(k.me.casts), theirs = most(k.reference.casts);
        const ab = (k.reference.abilities || []).find(a => a.name === theirs);
        out.push(row({ id: 'curse', category: 'group', owner: 'group', verdict: 'warn', pulls: { hit: differ.length, of: kills.filter(x => x.reference).length }, measuredOn: pullLabel(k, kills),
            text: 'You run ' + mine + ' (assignment); comparable players run ' + theirs + (ab && num(ab.share) !== null ? ', ' + Math.round(ab.share) + '% of their damage' : ''),
            fix: 'Rotate the assignment or give it to the warlock with the lowest DPS.' }));
    }
    return out;
}

// --- raid (spec §4.3 "Raid")
function raidRows(facts) {
    const r = shareRow(facts, { id: 'raid_activity', key: 'raid_activity', category: 'raid', owner: 'raid',
        text: (i, k, label) => 'Your raid was active ' + pct(i.me) + '% of ' + label + ' against ' + pct(i.reference) + '% for the reference raid; phases and downtime, not you' });
    return r && r.value !== null && r.value >= 3 ? [r] : [];
}

module.exports = { NOMINAL_VALUE, ROW_CAPS, FINE_IDS, CATEGORY_ORDER, DEFAULT_T, MOVEMENT_FILLER, ABILITY_FIX, NUKE_FIX, BUFF_SOURCE, STAT_WORD,
                   liveKills, inputOf, averageShare, largestPull, verdictForShare, verdictForHabit, pullLabel, row, shareRow, mainAbility, perMin, halfRule, castingRows, groupRows, raidRows };
```

Note for the `party_buffs` test: with `crit_buffs` 8 and 6 → average 7; `power_buffs` 3 and (absent → 0) → average 2 (rounded 1.5 → 2); total 9. `debuffs` 19 and 15 → 17.

- [ ] **Step 4: Run the suite**

Run: `node vet-checklist.test.js`
Expected: `8 passed, 0 failed`. If a text assertion differs by a rounding (e.g. `1.9` vs `1.93`), fix the implementation's rounding (`perMin` rounds to one decimal), not the test.

- [ ] **Step 5: Add the suite to `package.json`** — in `"test"`, insert `node vet-checklist.test.js && ` immediately before `node server.test.js`.

- [ ] **Step 6: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js package.json
git commit -m "feat(checklist): vet-checklist.js — constants, aggregation helpers, casting/group/raid rows"
```

---

### Task 4: Consumables and cooldown rows

**Files:**
- Modify: `vet-checklist.js`, `vet-checklist.test.js`

**Interfaces:**
- Produces: `consumableRows(facts, T)` → rows with ids `flask`, `food`, `oil`, `potion`; `cooldownRows(facts)` → `burst_timing`.

- [ ] **Step 1: Write the failing tests** (append; reuse `gapKill`/`sheet`)

```js
test('consumableRows: flask fails on elixirs when comparable players flask; the value is the larger of the accounting share and the nominal', () => {
    const k1 = gapKill('Lady Vashj', { power_consumables: 1 }), k2 = gapKill('Al\'ar', { power_consumables: 3 });
    k1.me.consumablesAtPull = ['Elixir of Draenic Wisdom', 'Major Shadow Power', 'Well Fed']; k1.me.guardianElixir = 'Elixir of Draenic Wisdom';
    const rows = C.consumableRows(sheet([k1, k2]), C.DEFAULT_T);
    const fl = rows.find(r => r.id === 'flask');
    assert.strictEqual(fl.verdict, 'fail'); assert.deepStrictEqual(fl.pulls, { hit: 2, of: 2 }); assert.strictEqual(fl.value, 2);
    assert.strictEqual(fl.text, 'Flask: Elixir of Draenic Wisdom + Major Shadow Power at the Lady Vashj pull; comparable players run Flask of Pure Death');
    assert.strictEqual(fl.fix, 'Run Flask of Pure Death at every pull.');
    assert.strictEqual(rows.find(r => r.id === 'food').verdict, 'pass');
    assert.ok(!rows.find(r => r.id === 'oil'), 'no oil row when the reference shows none');
});
test('consumableRows: flask passes with a flask; fails with neither flask nor both elixirs even without a reference', () => {
    const ok = gapKill('A', {}); ok.me.flask = 'Flask of Pure Death'; ok.me.consumablesAtPull = ['Flask of Pure Death', 'Well Fed'];
    assert.strictEqual(C.consumableRows(sheet([ok]), C.DEFAULT_T).find(r => r.id === 'flask').verdict, 'pass');
    const bare = gapKill('B', {}, { reference: null, gap: null }); bare.me.consumablesAtPull = ['Well Fed']; bare.me.battleElixir = null;
    const fl = C.consumableRows(sheet([bare]), C.DEFAULT_T).find(r => r.id === 'flask');
    assert.strictEqual(fl.verdict, 'fail'); assert.strictEqual(fl.text, 'Flask: nothing at the B pull'); assert.strictEqual(fl.fix, 'Run a flask at every pull.');
});
test('consumableRows: potion fails on zero potions or on never using the reference\'s damage potion; value 3 per reference potion, capped at 6', () => {
    const k1 = gapKill('Void Reaver', {}), k2 = gapKill('Al\'ar', {}), k3 = gapKill('Lady Vashj', {});
    k2.reference.casts = { 'Shadow Bolt': 80, Destruction: 2 }; k3.me.potionUse = 1; k3.me.casts.Destruction = 1;
    const p = C.consumableRows(sheet([k1, k2, k3]), C.DEFAULT_T).find(r => r.id === 'potion');
    assert.strictEqual(p.verdict, 'fail'); assert.deepStrictEqual(p.pulls, { hit: 2, of: 3 }); assert.strictEqual(p.value, 3);
    assert.strictEqual(p.text, 'Destruction Potion: 0 on 2 of 3 pulls; comparable players use 1–2 a pull (up to 2 in a fight this long)');
    assert.strictEqual(p.fix, 'Pop one on the pull and again every two minutes.');
    const short = gapKill('Short', {}); short.fight.durationSec = 40;
    assert.ok(!C.consumableRows(sheet([short]), C.DEFAULT_T).find(r => r.id === 'potion'), 'a fight under potionMinSec is not measurable');
});
test('cooldownRows: burst_timing names the item fired outside Bloodlust', () => {
    const k = gapKill('Void Reaver', {}); k.me.burst = [{ name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 0 }]; k.reference.burst = [{ name: 'Blessing of the Silver Crescent', uses: 2, insideBloodlust: 1 }];
    const b = C.cooldownRows(sheet([k])).find(r => r.id === 'burst_timing');
    assert.strictEqual(b.verdict, 'fail'); assert.strictEqual(b.value, 2);
    assert.strictEqual(b.text, 'Blessing of the Silver Crescent used outside Bloodlust on 1 of 1 pulls; comparable players line it up with Bloodlust');
    assert.strictEqual(b.fix, 'Hold Blessing of the Silver Crescent for Bloodlust.');
    assert.ok(!C.cooldownRows(sheet([gapKill('A', {})])).find(r => r.id === 'burst_timing'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node vet-checklist.test.js 2>&1 | grep FAIL`
Expected: four FAIL lines (`C.consumableRows is not a function`).

- [ ] **Step 3: Implement** (add before `module.exports`, and export `consumableRows`, `cooldownRows`)

```js
// --- consumables (spec §4.3 "Consumables")
const OIL = /wizard oil|mana oil|sharpening stone|weightstone/i;
function habitRow(o) {
    const v = verdictForHabit(o.failing.length, o.measurable.length);
    if (!v) return null;
    const k = o.failing[0] || o.measurable[0];
    return row(Object.assign({ verdict: v, pulls: { hit: o.failing.length, of: o.measurable.length }, measuredOn: pullLabel(k, o.kills) }, o.build(k, v)));
}
function consumableRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts), out = [];
    const known = kills.filter(k => k.me.consumablesKnown);
    const refFlask = k => k.reference && k.reference.flaskShare >= 0.5 && k.reference.flask ? k.reference.flask : null;
    const noFlask = k => !k.me.flask && (refFlask(k) || !(k.me.battleElixir && k.me.guardianElixir));
    const flask = habitRow({ kills, measurable: known, failing: known.filter(noFlask), build: (k, v) => {
        const had = (k.me.consumablesAtPull || []).filter(n => !/^well fed$/i.test(n) && !OIL.test(n));
        const share = averageShare(kills, 'power_consumables');
        return { id: 'flask', category: 'consumables', value: v === 'pass' ? null : Math.max(share || 0, NOMINAL_VALUE.flask),
                 text: v === 'pass' ? 'Flask at every pull' : 'Flask: ' + (had.length ? had.join(' + ') : 'nothing') + ' at the ' + pullLabel(k, kills) + ' pull' + (refFlask(k) ? '; comparable players run ' + refFlask(k) : ''),
                 fix: 'Run ' + (refFlask(k) || 'a flask') + ' at every pull.' };
    } });
    if (flask) out.push(flask);
    const food = habitRow({ kills, measurable: known, failing: known.filter(k => !k.me.food), build: (k, v) => ({ id: 'food', category: 'consumables', value: v === 'pass' ? null : NOMINAL_VALUE.food,
        text: v === 'pass' ? 'Food at every pull' : 'No food buff at the ' + pullLabel(k, kills) + ' pull', fix: 'Eat before every pull.' }) });
    if (food) out.push(food);
    const refOil = k => (k.reference && (k.reference.consumablesAtPull || []).find(n => OIL.test(n))) || null;
    const oilable = known.filter(refOil);
    const oil = habitRow({ kills, measurable: oilable, failing: oilable.filter(k => !(k.me.consumablesAtPull || []).some(n => OIL.test(n))), build: (k, v) => ({ id: 'oil', category: 'consumables', value: v === 'pass' ? null : NOMINAL_VALUE.oil,
        text: v === 'pass' ? 'Weapon oil at every pull' : 'No ' + refOil(k) + ' at the ' + pullLabel(k, kills) + ' pull', fix: 'Put ' + refOil(k) + ' on your weapon.' }) });
    if (oil) out.push(oil);
    // Potions: the reference's damage potion (a Casts-table name in POTION_LABEL) and how often.
    const refPotion = k => { const casts = (k.reference && k.reference.casts) || {}; const n = Object.keys(casts).filter(x => GAP.POTION_LABEL[x]).sort((a, b) => casts[b] - casts[a])[0]; return n ? { name: n, count: casts[n] } : null; };
    const potionable = kills.filter(k => num(k.me.potionUse) !== null && k.fight.durationSec > T.potionMinSec);
    const potionFail = k => { const p = refPotion(k); return k.me.potionUse === 0 || (p && p.count >= 0.5 && !(k.me.casts || {})[p.name]); };
    const potion = habitRow({ kills, measurable: potionable, failing: potionable.filter(potionFail), build: (k, v) => {
        const failing = potionable.filter(potionFail);
        const counts = failing.map(refPotion).filter(Boolean).map(p => Math.round(p.count)).sort((a, b) => a - b);
        const p = refPotion(k);
        const median = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
        const possible = Math.floor(k.fight.durationSec / 120) + 1;
        const label = p ? GAP.POTION_LABEL[p.name] : 'potion';
        const range = counts.length ? (counts[0] === counts[counts.length - 1] ? String(counts[0]) : counts[0] + '–' + counts[counts.length - 1]) : null;
        return { id: 'potion', category: 'consumables', value: v === 'pass' ? null : Math.min(6, NOMINAL_VALUE.potion * Math.max(1, median)),
                 text: v === 'pass' ? 'A potion on every pull' : label + ': 0 on ' + pullsText(failing.length, potionable.length) + (range ? '; comparable players use ' + range + ' a pull' : '') + ' (up to ' + possible + ' in a fight this long)',
                 fix: 'Pop one on the pull and again every two minutes.' };
    } });
    if (potion) out.push(potion);
    return out;
}

// --- cooldowns (spec §4.3 "Cooldowns"; v2 §6 burst timing)
function cooldownRows(facts) {
    const kills = liveKills(facts);
    const lustKills = kills.filter(k => k.reference && Array.isArray(k.reference.burst) && k.me.bloodlustPercent > 0);
    const outside = k => (k.me.burst || []).filter(b => { const r = k.reference.burst.find(x => x.name === b.name); return r && r.insideBloodlust >= 1 && b.uses >= 1 && b.insideBloodlust === 0; }).map(b => GAP.POTION_LABEL[b.name] || b.name);
    const failing = lustKills.filter(k => outside(k).length);
    if (!failing.length) return [];
    const names = Array.from(new Set(failing.flatMap(outside)));
    return [row({ id: 'burst_timing', category: 'cooldowns', verdict: verdictForHabit(failing.length, lustKills.length), pulls: { hit: failing.length, of: lustKills.length }, value: NOMINAL_VALUE.burst_timing, measuredOn: pullLabel(failing[0], kills),
                  text: names.join(' and ') + ' used outside Bloodlust on ' + pullsText(failing.length, lustKills.length) + '; comparable players line it up with Bloodlust', fix: 'Hold ' + names.join(' and ') + ' for Bloodlust.' })];
}
```

- [ ] **Step 4: Run the suite**

Run: `node vet-checklist.test.js`
Expected: `12 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js
git commit -m "feat(checklist): consumable and cooldown rows — flask, food, oil, potion, burst timing"
```

---

### Task 5: Spell-choice rows

**Files:**
- Modify: `vet-checklist.js`, `vet-checklist.test.js`

**Interfaces:**
- Produces: `spellRows(facts, T)` → ids `unused` (fail/warn), `under_used` (warn), `extra` (info).

- [ ] **Step 1: Write the failing tests**

```js
test('spellRows: one unused row over all pulls, curses/racials/utility/potions excluded, reference rates as a range', () => {
    const k1 = gapKill('Void Reaver', {}), k2 = gapKill('Lady Vashj', {});
    k2.reference.casts = { 'Shadow Bolt': 83, Shadowburn: 9, 'Curse of Agony': 7, 'Blood Fury': 1, 'Life Tap': 14, Destruction: 1 }; k2.reference.castsDurationSec = 420; k2.fight.durationSec = 465;
    const rows = C.spellRows(sheet([k1, k2]), C.DEFAULT_T);
    const u = rows.find(r => r.id === 'unused');
    assert.strictEqual(u.verdict, 'fail'); assert.strictEqual(u.value, 2); assert.deepStrictEqual(u.pulls, { hit: 2, of: 2 });
    assert.strictEqual(u.text, 'Never cast: Shadowburn (comparable players 0.4–1.3 a minute)');
    assert.strictEqual(u.fix, 'Use it while moving and under 25% boss health when you have shards.');
    assert.strictEqual(rows.filter(r => r.id === 'unused').length, 1);
});
test('spellRows: under_used is a warn on the reference\'s top-3 abilities cast under 70% of their rate; extra is info', () => {
    const k = gapKill('Lady Vashj', {}); k.me.casts = { 'Shadow Bolt': 71, Shadowburn: 5, 'Seed of Corruption': 8, 'Curse of the Elements': 8 }; k.fight.durationSec = 465;
    k.reference.casts = { 'Shadow Bolt': 83, Shadowburn: 9 }; k.reference.castsDurationSec = 420;
    k.reference.abilities = [{ name: 'Shadow Bolt', share: 86 }, { name: 'Shadowburn', share: 5 }];
    const rows = C.spellRows(sheet([k]), C.DEFAULT_T);
    const uu = rows.find(r => r.id === 'under_used');
    assert.strictEqual(uu.verdict, 'warn'); assert.strictEqual(uu.text, 'Shadowburn 0.6 a minute against 1.3 for comparable players on Lady Vashj');
    const ex = rows.find(r => r.id === 'extra');
    assert.strictEqual(ex.verdict, 'info'); assert.strictEqual(ex.text, 'Cast while comparable players do not: Seed of Corruption (8 on Lady Vashj)');
    assert.ok(!rows.find(r => r.id === 'unused'));
});
```

- [ ] **Step 2: Run to verify they fail** — `node vet-checklist.test.js 2>&1 | grep FAIL` → two FAILs.

- [ ] **Step 3: Implement** (add before `module.exports`; export `spellRows`)

```js
// --- spell choice (spec §4.3 "Spell choice"; the v3 rotationFindings rules, aggregated)
const isCurse = n => /^curse of /i.test(n);
const offLimits = n => isCurse(n) || GAP.RACIAL.test(n) || GAP.ENCOUNTER_ITEM.test(n) || GAP.UTILITY_CAST.test(n) || !!GAP.POTION_LABEL[n];
function spellRows(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const kills = liveKills(facts).filter(k => k.reference && k.fight.durationSec && k.reference.castsDurationSec);
    const out = [];
    const fmt = x => Math.round(x * 10) / 10;
    // unused: per ability, the pulls the reference used it on vs the pulls the player never cast it.
    const used = {}, unusedOn = {}, rates = {};
    kills.forEach(k => {
        const refMin = k.reference.castsDurationSec / 60;
        Object.keys(k.reference.casts || {}).forEach(n => {
            if (offLimits(n)) return;
            const r = k.reference.casts[n] / refMin;
            if (!(r >= T.unusedPerMin || k.reference.casts[n] >= T.unusedPerFightCooldown)) return;
            used[n] = (used[n] || 0) + 1;
            if (!(k.me.casts || {})[n]) { unusedOn[n] = (unusedOn[n] || 0) + 1; (rates[n] = rates[n] || []).push(fmt(r)); }
        });
    });
    const names = Object.keys(unusedOn).filter(n => unusedOn[n] * 2 >= used[n]).sort((a, b) => unusedOn[b] - unusedOn[a]);
    if (names.length) {
        const failing = kills.filter(k => names.some(n => (k.reference.casts || {})[n] && !(k.me.casts || {})[n]));
        const range = n => { const r = rates[n].slice().sort((a, b) => a - b); return r[0] === r[r.length - 1] ? String(r[0]) : r[0] + '–' + r[r.length - 1]; };
        out.push(row({ id: 'unused', category: 'spells', verdict: verdictForHabit(failing.length, kills.length), pulls: { hit: failing.length, of: kills.length }, value: NOMINAL_VALUE.unused, measuredOn: pullLabel(failing[0], kills),
                       text: 'Never cast: ' + names.map((n, i) => n + ' (' + (i === 0 ? 'comparable players ' : '') + range(n) + ' a minute)').join(', '),
                       fix: ABILITY_FIX[names[0]] || 'Use it as comparable players do.' }));
    }
    // under_used: a top-3 reference ability the player casts under ratioLow of the reference rate.
    const under = [];
    kills.forEach(k => {
        const top3 = (k.reference.abilities || []).slice(0, 3).map(a => a.name), min = k.fight.durationSec / 60, refMin = k.reference.castsDurationSec / 60;
        top3.forEach(n => { const r = (k.reference.casts || {})[n], p = (k.me.casts || {})[n]; if (r && p && p / min < T.ratioLow * (r / refMin)) under.push({ k, n, p: fmt(p / min), r: fmt(r / refMin) }); });
    });
    if (under.length) {
        const u = under[0];
        out.push(row({ id: 'under_used', category: 'spells', verdict: 'warn', pulls: { hit: new Set(under.map(x => x.k)).size, of: kills.length }, me: u.p, reference: u.r, unit: 'a minute', measuredOn: pullLabel(u.k, kills),
                       text: u.n + ' ' + u.p + ' a minute against ' + u.r + ' for comparable players on ' + pullLabel(u.k, kills), fix: ABILITY_FIX[u.n] || 'Use it as often as comparable players do.' }));
    }
    // extra: cast at least extraPerMin a minute while the reference never casts it — info only.
    const extra = [];
    kills.forEach(k => { const min = k.fight.durationSec / 60; Object.keys(k.me.casts || {}).forEach(n => { if ((k.reference.casts || {})[n] || offLimits(n)) return; if (k.me.casts[n] / min >= T.extraPerMin) extra.push(n + ' (' + k.me.casts[n] + ' on ' + pullLabel(k, kills) + ')'); }); });
    if (extra.length) out.push(row({ id: 'extra', category: 'spells', verdict: 'info', text: 'Cast while comparable players do not: ' + extra.join(', ') }));
    return out;
}
```

- [ ] **Step 4: Run** — `node vet-checklist.test.js` → `14 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js
git commit -m "feat(checklist): spell-choice rows — unused, under-used, extra, aggregated over pulls"
```

---

### Task 6: Nuke damage, hit, gear and pass-only rows

**Files:**
- Modify: `vet-checklist.js`, `vet-checklist.test.js`

**Interfaces:**
- Produces: `nukeRows(facts)` → `nuke_hit`; `gearRows(facts)` → `hit`, `stat_<key>`, `enchants`, `sockets`; `passRows(facts)` → `deaths`, `power_gear` (pass rows only).

- [ ] **Step 1: Write the failing tests**

```js
test('nuke_hit: observed / expected from the accounting\'s power and debuff inputs; fail under 0.9; text explains the split', () => {
    // me power 1026+78+0 = 1104, ref 1007+103+40 = 1150, K 670 → 0.975; debuffs 1.1/1.21 → 0.909; expected 0.886; observed 3065/3869 = 0.792 → residual 0.894.
    const k = gapKill('Void Reaver', { rotation: 42 });
    const n = C.nukeRows(sheet([k])).find(r => r.id === 'nuke_hit');
    assert.strictEqual(n.verdict, 'fail'); assert.strictEqual(n.value, 42); assert.strictEqual(n.owner, 'player');
    assert.strictEqual(n.text, 'Shadow Bolt hits for 3065 non-crit against 3869 at the same spell power on Void Reaver; raid debuffs explain about 9%, the remaining 11% is talents, spell rank or gear that logs cannot show');
    assert.strictEqual(n.fix, C.NUKE_FIX.Destruction);
    const fine = gapKill('A', {}); fine.me.abilities[0].avgHit = 3500;
    assert.strictEqual(C.nukeRows(sheet([fine])).find(r => r.id === 'nuke_hit').verdict, 'pass');
});
test('gearRows: hit from the current profile (value/bar) beats the pull; stat rows are warns; enchants/sockets from gear findings', () => {
    const f = sheet([gapKill('A', { hit_under_cap: -5 })], { gear: { findings: [
        { key: 'gear_hit', severity: 'major', scope: 'player', text: 'Hit rating 185 against the 202 the raid asks for', value: 185, bar: 202 },
        { key: 'gear_enchants', severity: 'minor', scope: 'player', text: 'Missing enchants: 2 (Bracers, Boots)', value: 2, bar: null },
    ] } });
    f.kills[0].findings = [{ key: 'gear_stat', owner: 'player', severity: 'minor', scope: 'player', share: null, stat: 'spellCrit', text: 'Spell crit rating 297 against 354 for players at your item level among the top 2000 parses', me: 297, reference: 354 }];
    const rows = C.gearRows(f);
    const hit = rows.find(r => r.id === 'hit');
    assert.strictEqual(hit.verdict, 'fail'); assert.strictEqual(hit.me, 185); assert.strictEqual(hit.reference, 202); assert.strictEqual(hit.value, 1);
    assert.strictEqual(hit.text, 'Hit: 185 on your current gear against the 202 cap'); assert.strictEqual(hit.fix, 'Reach 202 hit before any other stat.');
    const crit = rows.find(r => r.id === 'stat_spellCrit');
    assert.strictEqual(crit.verdict, 'warn'); assert.strictEqual(crit.text, 'Spell crit rating 297 against 354 for comparable players'); assert.strictEqual(crit.fix, 'Prefer spell crit when upgrading.');
    const en = rows.find(r => r.id === 'enchants');
    assert.strictEqual(en.verdict, 'warn'); assert.strictEqual(en.fix, 'Enchant Bracers, Boots.');
});
test('gearRows: hit at the cap on the profile is a pass row; no profile hit falls back to the pull\'s hit input', () => {
    const f = sheet([gapKill('A', {})], { gear: { findings: [] } });
    assert.ok(!C.gearRows(f).find(r => r.id === 'hit'), 'no hit row without a profile hit or a positive hit share');
    const g = sheet([gapKill('A', { hit_under_cap: 6 })], { gear: { findings: [] } });
    g.kills[0].gap.factors.dmg.inputs.find(i => i.key === 'hit_under_cap').me = 150;
    const h = C.gearRows(g).find(r => r.id === 'hit');
    assert.strictEqual(h.verdict, 'fail'); assert.strictEqual(h.value, 6); assert.strictEqual(h.text, 'Hit: 150 at the A pull against the 202 cap');
});
test('passRows: deaths and power_gear passes only when every pull passes', () => {
    const a = gapKill('A', {}), b = gapKill('B', { power_gear: 0 });
    b.gap.factors.dmg.inputs.find(i => i.key === 'power_gear').me = 1006; b.gap.factors.dmg.inputs.find(i => i.key === 'power_gear').reference = 1044;
    const ids = C.passRows(sheet([a, b])).map(r => r.id);
    assert.ok(ids.includes('deaths') && !ids.includes('power_gear'));
    assert.ok(C.passRows(sheet([a])).map(r => r.id).includes('power_gear'));
    a.me.died = { atSec: 10, by: 'Arcane Orb' };
    assert.ok(!C.passRows(sheet([a])).map(r => r.id).includes('deaths'));
});
```

- [ ] **Step 2: Run to verify they fail** — four FAILs.

- [ ] **Step 3: Implement** (add; export `nukeRows`, `gearRows`, `passRows`)

```js
// --- nuke damage (spec §4.3 "Nuke damage"): the rotation remainder, explained as far as logs allow.
function nukeRows(facts) {
    const kills = liveKills(facts).filter(k => k.gap && k.reference);
    const role = (facts.player && facts.player.role) || 'caster', K = GAP.C.POWER_BASE[role] || GAP.C.POWER_BASE.caster;
    const per = [];
    kills.forEach(k => {
        const main = mainAbility(k);
        const mine = (k.me.abilities || []).find(a => a.name === main), theirs = (k.reference.abilities || []).find(a => a.name === main);
        if (!mine || !theirs || !num(mine.avgHit) || !num(theirs.avgHit)) return;
        const sum = side => ['power_gear', 'power_consumables', 'power_buffs'].reduce((s, key) => { const i = inputOf(k, key); return s + (i && num(i[side]) !== null ? i[side] : 0); }, 0);
        const deb = inputOf(k, 'debuffs'), myDeb = deb && num(deb.me) !== null ? deb.me : 1, refDeb = deb && num(deb.reference) !== null ? deb.reference : 1;
        const myPower = sum('me'), refPower = sum('reference');
        const observed = mine.avgHit / theirs.avgHit, expected = ((myPower + K) / (refPower + K)) * (myDeb / refDeb);
        per.push({ k, main, mine, theirs, residual: observed / expected, debPct: Math.round(100 * (1 - myDeb / refDeb)), samePower: Math.abs(myPower - refPower) / Math.max(refPower, 1) < 0.05, myPower, refPower });
    });
    if (!per.length) return [];
    const avg = per.reduce((s, p) => s + p.residual, 0) / per.length;
    const worst = per.slice().sort((a, b) => a.residual - b.residual)[0];
    const verdict = avg < 0.9 ? 'fail' : avg < 0.95 ? 'warn' : 'pass';
    const share = averageShare(kills, 'rotation');
    const restPct = Math.max(0, Math.round(100 * (1 - worst.residual)));
    const label = pullLabel(worst.k, liveKills(facts));
    return [row({ id: 'nuke_hit', category: 'nuke', verdict, me: worst.mine.avgHit, reference: worst.theirs.avgHit, unit: 'non-crit hit', value: verdict === 'pass' ? null : (share > 0 ? share : null), measuredOn: label,
                  text: worst.main + ' hits for ' + worst.mine.avgHit + ' non-crit against ' + worst.theirs.avgHit + (worst.samePower ? ' at the same spell power' : ' (you had ' + worst.myPower + ' spell power, they had ' + worst.refPower + ')') + ' on ' + label +
                        (verdict === 'pass' ? '' : '; raid debuffs explain about ' + worst.debPct + '%, the remaining ' + restPct + '% is talents, spell rank or gear that logs cannot show'),
                  fix: verdict === 'pass' ? '' : (NUKE_FIX[facts.player && facts.player.spec] || 'Check your talents and the rank of ' + worst.main + '.') })];
}

// --- gear (spec §4.3 "Nuke damage" hit, "Gear")
function gearRows(facts) {
    const kills = liveKills(facts), out = [];
    const role = (facts.player && facts.player.role) || 'caster', physical = role === 'melee' || role === 'ranged' || role === 'tank';
    const perPct = physical ? GAP.C.MELEE_HIT_RATING_PER_PCT : GAP.C.HIT_RATING_PER_PCT;
    const gear = (facts.gear && facts.gear.findings) || [];
    const gearHit = gear.find(g => g.key === 'gear_hit' && num(g.value) !== null && num(g.bar) !== null);
    const hitShare = averageShare(kills, 'hit_under_cap'), hitBest = largestPull(kills, 'hit_under_cap');
    if (gearHit) {
        const under = gearHit.value < gearHit.bar;
        out.push(row({ id: 'hit', category: 'gear', verdict: under ? 'fail' : 'pass', me: gearHit.value, reference: gearHit.bar, unit: 'hit rating',
                       value: under ? Math.max(hitShare > 0 ? hitShare : 0, Math.max(1, Math.round((gearHit.bar - gearHit.value) / perPct)) * NOMINAL_VALUE.hit) : null,
                       text: under ? 'Hit: ' + gearHit.value + ' on your current gear against the ' + gearHit.bar + ' cap' : 'Hit at the cap', fix: under ? 'Reach ' + gearHit.bar + ' hit before any other stat.' : '' }));
    } else if (hitShare !== null && hitShare >= 3 && hitBest) {
        const cap = Math.round((physical ? GAP.C.HIT_CAP.melee * GAP.C.MELEE_HIT_RATING_PER_PCT : GAP.C.HIT_CAP.spell * GAP.C.HIT_RATING_PER_PCT));
        out.push(row({ id: 'hit', category: 'gear', verdict: verdictForShare(hitShare), me: hitBest.input.me, reference: cap, unit: 'hit rating', value: hitShare, measuredOn: pullLabel(hitBest.kill, kills),
                       text: 'Hit: ' + hitBest.input.me + ' at the ' + pullLabel(hitBest.kill, kills) + ' pull against the ' + cap + ' cap', fix: 'Reach ' + cap + ' hit before any other stat.' }));
    }
    // Stat priority rows come per pull from statPriorityFindings (kill.findings, key gear_stat).
    const byStat = {};
    kills.forEach(k => (k.findings || []).filter(f => f.key === 'gear_stat' && f.stat && f.stat !== 'spellHit' && f.stat !== 'meleeHit').forEach(f => { (byStat[f.stat] = byStat[f.stat] || []).push({ k, f }); }));
    Object.keys(byStat).forEach(stat => {
        const first = byStat[stat][0];
        out.push(row({ id: 'stat_' + stat, category: 'gear', verdict: 'warn', me: first.f.me, reference: first.f.reference, pulls: { hit: byStat[stat].length, of: kills.length }, measuredOn: pullLabel(first.k, kills),
                       text: first.f.text.replace(' for ' + GAP.REF_LABEL, ' for comparable players'), fix: 'Prefer ' + (STAT_WORD[stat] || stat) + ' when upgrading.' }));
    });
    gear.filter(g => g.key === 'gear_enchants' || g.key === 'gear_sockets').forEach(g => {
        const slots = /\(([^)]+)\)/.exec(g.text);
        out.push(row({ id: g.key.replace('gear_', ''), category: 'gear', verdict: g.severity === 'major' ? 'fail' : 'warn', me: num(g.value), text: g.text,
                       fix: g.key === 'gear_enchants' ? 'Enchant ' + (slots ? slots[1] : 'the missing slots') + '.' : 'Fill every socket.' }));
    });
    return out;
}

// --- pass-only rows for "Fine" (spec §4.3 "Fine")
function passRows(facts) {
    const kills = liveKills(facts), out = [];
    if (kills.length && kills.every(k => !k.me.died)) out.push(row({ id: 'deaths', category: 'casting', verdict: 'pass', text: 'no deaths' }));
    const acc = kills.filter(k => inputOf(k, 'power_gear'));
    if (acc.length && acc.every(k => { const i = inputOf(k, 'power_gear'); return num(i.me) !== null && num(i.reference) !== null && i.me >= i.reference; }))
        out.push(row({ id: 'power_gear', category: 'gear', verdict: 'pass', text: (facts.player && (facts.player.role === 'melee' || facts.player.role === 'ranged' || facts.player.role === 'tank') ? 'attack power' : 'spell power') + ' on par with comparable players' }));
    return out;
}
```

- [ ] **Step 4: Run** — `node vet-checklist.test.js` → `18 passed, 0 failed`. (For the `nuke_hit` text: debPct = round(100 × (1 − 1.1/1.21)) = 9; restPct = round(100 × (1 − 0.894)) = 11.)

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js
git commit -m "feat(checklist): nuke damage, hit, gear and pass-only rows"
```

---

### Task 7: `buildChecklist` — verdict, ordering, caps, stand, not-on-you; `renderReport`; golden test

**Files:**
- Modify: `vet-checklist.js`, `vet-checklist.test.js`
- Fixture: `fixtures/facts-lovestoned-v3.json` (already committed)

**Interfaces:**
- Produces: `buildChecklist(facts, T) → { verdict, rows, fixFirst, also, asks, fine, stand, notOnYou }` and `renderReport(checklist, facts) → string`; `fractionWord(p)`.
- `verdict = { ratioPercent, onYou, onSetup, onRest } | null`; `stand = [{ name, date, me, sameClass: [amount…] (others only), dps, topDps }]`; `notOnYou = { badPulls: { total, live, groups: [{ name, count, months: [] }] }, rows: [raid rows] }`.

- [ ] **Step 1: Write the failing tests**

```js
const fs = require('node:fs'), path = require('node:path');
const LOVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-lovestoned-v3.json'), 'utf8'));

test('buildChecklist: verdict from the median ratio and the owner sums; ids unique; caps applied and the overflow kept in rows', () => {
    const kills = [];
    for (let i = 0; i < 9; i++) { const k = gapKill('B' + i, { cast_pacing: 10 }); kills.push(k); }
    // nine distinct fails via gear findings would need nine stats; use the real families plus stat rows instead
    const f = sheet(kills, { gear: { findings: [
        { key: 'gear_hit', severity: 'major', scope: 'player', text: 'Hit rating 150 against the 202 the raid asks for', value: 150, bar: 202 },
        { key: 'gear_enchants', severity: 'major', scope: 'player', text: 'Missing enchants: 3 (Head, Bracers, Boots)', value: 3, bar: null },
        { key: 'gear_sockets', severity: 'major', scope: 'player', text: 'Empty sockets: 2', value: 2, bar: null } ] } });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    const ids = cl.rows.map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids');
    assert.strictEqual(cl.fixFirst.length, 3); assert.ok(cl.also.length <= 5); assert.ok(cl.asks.length <= 3);
    assert.strictEqual(cl.fixFirst[0], 'cast_rate', 'largest value first');
    assert.strictEqual(cl.verdict.ratioPercent, 61, '1362 / 2217');
});
test('buildChecklist: no accounting means no verdict; a player above the reference gets passes only', () => {
    const k = gapKill('A', {}, { gap: null }); k.me.amount = 2500; k.me.flask = 'Flask of Pure Death'; k.me.potionUse = 2;
    const cl = C.buildChecklist(sheet([k]), C.DEFAULT_T);
    assert.strictEqual(cl.verdict, null);
    assert.deepStrictEqual(cl.fixFirst, []);
    assert.ok(cl.fine.includes('food') && cl.fine.includes('deaths'));
});
test('buildChecklist: stand carries the ceiling pulls with same-class peers; bad pulls are grouped by boss with a month only where the boss also has a live pull', () => {
    const live = gapKill('Lady Vashj', {}, { date: '2026-08-09' }); live.fight.sameClass = [{ name: 'Cartis', amount: 640, isMe: false }, { name: 'Lovestoned', amount: 577, isMe: true }, { name: 'Xeasha', amount: 512, isMe: false }];
    const bad = (name, date) => ({ name, date, rankPercent: 1, fight: { badPull: true, badPullReason: 'x' }, me: {}, findings: [], gap: null });
    const f = sheet([live, bad('Lady Vashj', '2026-05-24'), bad('Leotheras the Blind', '2026-08-09'), bad('Leotheras the Blind', '2026-07-19')],
                    { overall: { badPulls: [{ name: 'Lady Vashj', date: '2026-05-24', reason: 'x' }, { name: 'Leotheras the Blind', date: '2026-08-09', reason: 'x' }, { name: 'Leotheras the Blind', date: '2026-07-19', reason: 'x' }],
                                 ceiling: [{ name: 'Lady Vashj', date: '2026-08-09', me: 577.3, dps: 1180, topDps: 1445 }], gap: null, droppedKills: [] } });
    const cl = C.buildChecklist(f, C.DEFAULT_T);
    assert.deepStrictEqual(cl.stand, [{ name: 'Lady Vashj', date: '2026-08-09', me: 577, sameClass: [640, 512], dps: 1180, topDps: 1445 }]);
    assert.deepStrictEqual(cl.notOnYou.badPulls, { total: 4, live: 1, groups: [{ name: 'Lady Vashj', count: 1, months: ['May'] }, { name: 'Leotheras the Blind', count: 2, months: [] }] });
});
test('fractionWord', () => {
    assert.strictEqual(C.fractionWord(85), 'almost all'); assert.strictEqual(C.fractionWord(74), 'about three quarters'); assert.strictEqual(C.fractionWord(62), 'most');
    assert.strictEqual(C.fractionWord(50), 'about half'); assert.strictEqual(C.fractionWord(30), 'about a third'); assert.strictEqual(C.fractionWord(20), 'about a quarter'); assert.strictEqual(C.fractionWord(10), 'a small part'); assert.strictEqual(C.fractionWord(3), null);
});
test('golden (Lovestoned, v3 sheet captured 2026-09-05): verdict 59, nuke/cast/activity first, one potion line, one curse line, under 320 words', () => {
    const cl = C.buildChecklist(LOVE, C.DEFAULT_T);
    assert.strictEqual(cl.verdict.ratioPercent, 59);
    assert.deepStrictEqual(cl.fixFirst, ['nuke_hit', 'cast_rate', 'activity']);
    assert.strictEqual(cl.rows.find(r => r.id === 'nuke_hit').value, 36);
    assert.strictEqual(cl.rows.find(r => r.id === 'cast_rate').value, 31);
    const act = cl.rows.find(r => r.id === 'activity').value; assert.ok(act >= 7 && act <= 10, 'activity ~8: ' + act);
    assert.ok(cl.also.indexOf('potion') === 0 && cl.also.includes('flask'), 'potion first in Also, flask present: ' + cl.also.join(','));
    assert.strictEqual(cl.asks[0], 'debuffs');
    assert.strictEqual(cl.rows.find(r => r.id === 'curse').owner, 'group');
    const ids = cl.rows.map(r => r.id); assert.strictEqual(new Set(ids).size, ids.length);
    const text = C.renderReport(cl, LOVE);
    assert.strictEqual((text.match(/Destruction Potion/g) || []).length, 1, text);
    assert.strictEqual((text.match(/Curse of the Elements/g) || []).length, 1, text);
    assert.ok(text.split(/\s+/).length < 320, 'words: ' + text.split(/\s+/).length);
    assert.ok(text.startsWith('Lovestoned — Destruction, '), text.split('\n')[0]);
    assert.ok(text.includes('\nFix first\n1. Shadow Bolt hits for '), text);
    assert.ok(text.includes('\nAsk your raid leader\n- No Misery or Shadow Weaving on 5 of 5 pulls (a shadow priest). (~17%)'), text);
    assert.ok(text.includes('8 of 13 pulls were raid-wide bad pulls ('), text);
    assert.ok(text.endsWith('Pick one thing to change next raid.'), text.slice(-80));
});
```

- [ ] **Step 2: Run to verify they fail** — five FAILs (`buildChecklist is not a function`).

- [ ] **Step 3: Implement** (add; export `buildChecklist`, `renderReport`, `fractionWord`, `verdictOf`)

```js
// --- verdict (spec §4.5)
function fractionWord(p) { return p >= 80 ? 'almost all' : p >= 70 ? 'about three quarters' : p >= 60 ? 'most' : p >= 45 ? 'about half' : p >= 28 ? 'about a third' : p >= 18 ? 'about a quarter' : p >= 8 ? 'a small part' : null; }
function medianOf(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; }
function verdictOf(facts) {
    const acc = liveKills(facts).filter(k => k.gap && k.reference && num(k.me.amount) && num(k.reference.playersDps || k.reference.dps));
    if (!acc.length) return null;
    const ratioPercent = Math.round(medianOf(acc.map(k => 100 * k.me.amount / (k.reference.playersDps || k.reference.dps))));
    const keys = {};
    acc.forEach(k => ['casts', 'dmg', 'crit'].forEach(f => k.gap.factors[f].inputs.forEach(i => { keys[i.key] = i.owner; })));
    const sumOwner = owner => Math.max(0, Object.keys(keys).filter(k => keys[k] === owner).reduce((s, k) => s + (averageShare(acc, k) || 0), 0));
    const onYou = sumOwner('player'), onSetup = sumOwner('group');
    return { ratioPercent, onYou, onSetup, onRest: Math.max(0, 100 - onYou - onSetup) };
}

// --- assembly (spec §4.6)
function buildChecklist(facts, T) {
    T = Object.assign({}, DEFAULT_T, T || {});
    const limited = !!(facts && facts.limited);
    let rows = [].concat(consumableRows(facts, T), limited ? [] : cooldownRows(facts), castingRows(facts, T), limited ? [] : spellRows(facts, T), limited ? [] : nukeRows(facts), gearRows(facts), passRows(facts), groupRows(facts), raidRows(facts));
    const seen = new Set(); rows = rows.filter(r => r && !seen.has(r.id) && seen.add(r.id));
    const cat = r => CATEGORY_ORDER.indexOf(r.category);
    const byValue = (a, b) => ((b.value ?? -1) - (a.value ?? -1)) || (cat(a) - cat(b));
    const player = rows.filter(r => r.owner === 'player');
    const fails = player.filter(r => r.verdict === 'fail').sort(byValue), warns = player.filter(r => r.verdict === 'warn').sort(byValue);
    const fixFirst = fails.slice(0, ROW_CAPS.fixFirst).map(r => r.id);
    const also = fails.slice(ROW_CAPS.fixFirst).concat(warns).slice(0, ROW_CAPS.also).map(r => r.id);
    const asks = rows.filter(r => r.owner === 'group' && (r.verdict === 'fail' || r.verdict === 'warn')).sort(byValue).slice(0, ROW_CAPS.asks).map(r => r.id);
    const fine = FINE_IDS.filter(id => rows.some(r => r.id === id && r.verdict === 'pass'));
    const live = liveKills(facts);
    const stand = ((facts.overall && facts.overall.ceiling) || []).map(c => {
        const k = live.find(x => x.name === c.name && (!c.date || x.date === c.date));
        return { name: c.name, date: c.date, me: Math.round(c.me), sameClass: k && Array.isArray(k.fight.sameClass) ? k.fight.sameClass.filter(p => !p.isMe).map(p => p.amount) : [], dps: c.dps, topDps: c.topDps };
    });
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const bad = (facts.overall && facts.overall.badPulls) || [];
    const groups = [];
    bad.forEach(b => {
        let g = groups.find(x => x.name === b.name); if (!g) { g = { name: b.name, count: 0, months: [] }; groups.push(g); }
        g.count++;
        if (b.date && live.some(k => k.name === b.name)) g.months.push(MONTHS[parseInt(b.date.slice(5, 7), 10) - 1]);
    });
    return { verdict: limited ? null : verdictOf(facts), rows, fixFirst, also, asks, fine, stand,
             notOnYou: { badPulls: { total: ((facts.kills) || []).length, live: live.length, groups }, rows: rows.filter(r => r.owner === 'raid') } };
}

// --- the text (spec §5)
function renderReport(cl, facts) {
    const p = facts.player || {}, tier = facts.tier || {}, byId = id => cl.rows.find(r => r.id === id);
    const val = r => (r.value !== null && r.value !== undefined ? ' (~' + r.value + '%)' : '');
    const line = r => r.text + '. ' + r.fix + val(r);
    const head = facts.night ? 'raid night of ' + facts.night.date + ', median parse that night ' + Math.round(facts.night.medianPercent) : 'median parse ' + Math.round(tier.medianPercent);
    const out = [p.name + ' — ' + (p.spec || '?') + ', ' + (tier.zoneName || '') + ', ' + head];
    if (cl.verdict) {
        const v = cl.verdict, parts = [];
        if (fractionWord(v.onYou)) parts.push(fractionWord(v.onYou) + ' of that gap is on you');
        if (fractionWord(v.onSetup)) parts.push(fractionWord(v.onSetup) + ' is the raid\'s setup');
        if (fractionWord(v.onRest)) parts.push('the rest is the raid\'s pulls and luck');
        out.push('You do ' + v.ratioPercent + '% of what comparable players do (' + GAP.REF_LABEL + ').' + (parts.length ? ' ' + parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : ''));
    }
    const section = (title, ids, numbered) => { if (!ids.length) return; out.push('', title); ids.forEach((id, i) => out.push((numbered ? (i + 1) + '. ' : '- ') + line(byId(id)))); };
    section(facts.limited ? 'What\'s holding your healing back' : 'Fix first', cl.fixFirst, true);
    section('Also', cl.also, false);
    if (cl.asks.length) { out.push('', 'Ask your raid leader'); cl.asks.forEach(id => { const r = byId(id); out.push('- ' + r.text + '.' + (r.fix ? ' ' + r.fix : '') + val(r)); }); }
    if (cl.fine.length) out.push('', 'Fine', cl.fine.map(id => byId(id).text).join(', ').replace(/^./, c => c.toUpperCase()) + '.');
    if (cl.stand.length) {
        const cls = String(p.class || 'player').toLowerCase();
        out.push('', 'Where you stand');
        cl.stand.forEach(s => out.push(s.name + ': you ' + s.me + (s.sameClass.length ? '; ' + cls + 's in your raid ' + s.sameClass.join(' / ') : '') + '; comparable players ' + s.dps + '; the best at your item level ' + s.topDps));
    }
    const bp = cl.notOnYou.badPulls;
    if (bp.groups.length || cl.notOnYou.rows.length) {
        out.push('', 'Not on you');
        if (bp.groups.length) out.push((bp.total - bp.live) + ' of ' + bp.total + ' pulls were raid-wide bad pulls (' + bp.groups.map(g => g.name + (g.count > 1 ? ' ×' + g.count : '') + (g.months.length ? ' (' + g.months.join(', ') + ')' : '')).join(', ') + ') and are left out.');
        cl.notOnYou.rows.forEach(r => out.push(r.text + '.'));
    }
    out.push('', 'Pick one thing to change next raid.');
    return out.join('\n');
}
```

- [ ] **Step 4: Run** — `node vet-checklist.test.js` → `23 passed, 0 failed`. Debug tips if the golden differs: print `cl.rows.map(r => [r.id, r.verdict, r.value])`; `activity`'s value is the average of `own_activity` over the five accounting pulls (39, −1, 4, 1, −4 → 8); `also` should read `potion, flask, hit, under_used, stat_spellCrit`. If `hit` is missing, the fixture's `gear.findings` lacks `value`/`bar` (captured before Task 2) — the fallback branch then needs `hit_under_cap ≥ 3`, which is negative here, so add `value: 185, bar: 202` to the fixture's `gear_hit` finding once (it is the profile's real number) and commit the fixture change.

- [ ] **Step 5: Commit**

```bash
git add vet-checklist.js vet-checklist.test.js fixtures/facts-lovestoned-v3.json
git commit -m "feat(checklist): buildChecklist (verdict, caps, stand, not-on-you) and renderReport with the Lovestoned golden"
```

---

### Task 8: Wire the checklist into `buildFacts`; retire the prompt, guards, merge and positives

**Files:**
- Modify: `vet-feedback.js` (`buildFacts` ~833-876, `killFindings` unchanged, delete 689-832 and 939-1082, exports)
- Modify: `vet-feedback.test.js`

**Interfaces:**
- Produces: `buildFacts(o)` returns the sheet with `overall.checklist` (from `Checklist.buildChecklist(facts, T)`) and **without** `overall.findings` / `overall.positives`; exports `Checklist` re-exported as `F.Checklist` for tests. Removed exports: `mergeFindings`, `positives`, `buildPrompt`, `checkNumbers`, `completeReply`.

- [ ] **Step 1: Write the failing test** (append)

```js
test('buildFacts (v4): overall.checklist replaces findings/positives; the report text renders from it', () => {
    const facts = F.buildFacts({ profile: { name: 'Rotminster', gearSummary: {}, gear: [], parses: { metric: 'dps', zone: 1060, zoneName: 'BT/Hyjal', medianPercent: 14 }, identity: {} },
                                 player: { name: 'Rotminster', classToken: 'WARLOCK', spec: 'Destruction', role: 'caster', metric: 'dps' }, kills: [], thresholds: {}, now: Date.now(), limited: false, droppedKills: [], nights: [], night: null });
    assert.ok(facts.overall.checklist && Array.isArray(facts.overall.checklist.rows));
    assert.strictEqual(facts.overall.findings, undefined); assert.strictEqual(facts.overall.positives, undefined);
    assert.strictEqual(typeof F.Checklist.renderReport(facts.overall.checklist, facts), 'string');
    assert.strictEqual(F.buildPrompt, undefined); assert.strictEqual(F.checkNumbers, undefined); assert.strictEqual(F.completeReply, undefined); assert.strictEqual(F.mergeFindings, undefined); assert.strictEqual(F.positives, undefined);
});
```

- [ ] **Step 2: Run to verify it fails** — `node vet-feedback.test.js 2>&1 | grep "buildFacts (v4)"` → FAIL.

- [ ] **Step 3: Implement**

1. At the top of `vet-feedback.js` add `const Checklist = require('./vet-checklist.js');`.
2. In `buildFacts`, replace `findings: mergeFindings(slim, gear), positives: positives(slim, player.role), ceiling,` with `ceiling,` and, after the object is built, compute the checklist on the finished sheet:
   ```js
    const facts = { /* the existing object literal */ };
    facts.overall.checklist = Checklist.buildChecklist(facts, T);
    return facts;
   ```
3. Delete `findingId`, `mergeFindings`, `positives`, `SEVERITY_ORDER`, `GROUPED_KEYS` (lines ~689-832), and `buildPrompt`, `numbersIn`, `ISO_DATE`, `DATE_PATHS`, `collectFactNumbers`, `STAT_ANCHOR`, `anchorOf`, `completeReply`, `checkNumbers` (lines ~939-1082). Grep afterwards: `grep -n "numbersIn\|mergeFindings\|positives(\|buildPrompt\|completeReply\|checkNumbers\|anchorOf" vet-feedback.js` must print nothing.
4. `module.exports`: remove `mergeFindings, positives, buildPrompt, checkNumbers, completeReply`; add `Checklist`.
5. In `vet-feedback.test.js` delete every test whose name starts with `buildPrompt`, `completeReply`, `checkNumbers`, `mergeFindings`, `positives`, `mergeFindings / positives`, `buildFacts / buildPrompt`, and any test that reads `overall.findings` or `overall.positives` or calls `F.numbersIn` (grep: `grep -n "buildPrompt\|completeReply\|checkNumbers\|mergeFindings\|positives\|overall.findings\|numbersIn\|anchorOf\|FINDING_ANCHOR" vet-feedback.test.js`). Where a test only *incidentally* asserts on `overall.findings` (e.g. the buildFacts ceiling test at ~1014), rewrite that assertion against `overall.checklist.stand` instead of deleting the test.

- [ ] **Step 4: Run** — `node vet-feedback.test.js 2>&1 | tail -2` → `0 failed`; then `node vet-gap.test.js` and `node vet-checklist.test.js` → `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add vet-feedback.js vet-feedback.test.js
git commit -m "feat(feedback): the sheet carries overall.checklist; prompt, guards, mergeFindings and positives retired"
```

---

### Task 9: Server route without the model

**Files:**
- Modify: `server.js:232-350` (`/api/vet/feedback`), `server.test.js`

**Interfaces:**
- Produces: `GET /api/vet/feedback` → `{ facts, report: string, generatedAt }`; `report = VetFeedback.Checklist.renderReport(facts.overall.checklist, facts)` after thresholds are reapplied.

- [ ] **Step 1: Rewrite the affected tests** in `server.test.js`:
  - In `setupPipeline`, replace `app.__test.setOpenaiChat(...)` with `app.__test.setOpenaiChat(async () => { throw new Error('the feedback route must not call the model'); });` (keep `openaiReply` out of the signature; update its callers).
  - "response shape" test: assert `typeof body1.report === 'string' && body1.report.startsWith('Rotminster — Destruction')` and `!('reportError' in body1)`.
  - Delete the tests "a model failure is HTTP 200 with report:null…", "a reply with a figure not in the facts is rejected…", "(v3): a model reply missing findings is completed under Also:…".
  - "different thresholds reuse the cached pipeline" test: keep, but assert on `body.facts.overall.checklist.rows.some(r => r.id === 'hit')` (or whichever gear row the thresholds change) instead of `overall.findings`.

- [ ] **Step 2: Run to verify** — `node server.test.js 2>&1 | grep FAIL` → the shape test fails (`reportError` present, report is the model stub / null).

- [ ] **Step 3: Implement** — in the route, replace the block from `const gear = VetFeedback.gearFindings(...)` to `const body = …` with:

```js
    // v4: gear rows depend on the request's thresholds, so the checklist and the text are rebuilt
    // here on the (possibly cached) sheet. No model: the text is rendered from the checklist.
    const gear = VetFeedback.gearFindings(profile, thresholds, Date.now());
    facts = Object.assign({}, facts, { tier: Object.assign({}, facts.tier, { threshold: thresholds.parse }), gear: Object.assign({}, facts.gear, { findings: gear }) });
    facts.overall = Object.assign({}, facts.overall, { checklist: VetFeedback.Checklist.buildChecklist(facts, VetFeedback.T) });
    const body = { facts, report: VetFeedback.Checklist.renderReport(facts.overall.checklist, facts), generatedAt: new Date().toISOString() };
```
Remove the `let reportText…try { openaiChat … } catch` block. Update the `X-Vet-Cache` comment: `hit` = stored body served, `miss` = the sheet was (re)built.

- [ ] **Step 4: Run** — `npm test 2>&1 | grep -E "passed|FAIL"` → every suite `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat(feedback): /api/vet/feedback returns the deterministic checklist report; no model call"
```

---

### Task 10: The report page — `feedback.html`, `feedback.js`, `feedback.css`

**Files:**
- Create: `feedback.html`, `feedback.js`, `feedback.css`
- Modify: `server.js` (nothing — `express.static` already serves the repo root; verify with `curl -sI localhost:3000/feedback.html` after `npm start`)

**Interfaces:**
- URL: `feedback.html?name=&server=&region=&zone=1060[&report=<code>][&thresholds=<json>]`.
- `localStorage['raidFeedback:' + region + '/' + server + '/' + name.toLowerCase() + '/' + zone + '/' + (report || 'all')]` = the API body plus `{ fetchedAt }`.
- Renders from cache immediately when present; fetches when absent or on Refresh.

- [ ] **Step 1: `feedback.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feedback report</title>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="assignments.css">
    <link rel="stylesheet" href="vetting.css">
    <link rel="stylesheet" href="feedback.css">
</head>
<body>
    <div class="container">
        <nav class="page-tabs">
            <a href="./" class="page-tab">Assignments</a>
            <a href="positions.html" class="page-tab">Positioning</a>
            <a href="vetting.html" class="page-tab active">Vetting</a>
        </nav>
        <header>
            <h1 id="title">Feedback report</h1>
            <p><a href="vetting.html" class="back-link">← Back to vetting</a></p>
        </header>
        <section class="panel" id="controls">
            <div class="import-row">
                <select id="nightSelect" class="feedback-night hidden"></select>
                <button id="refreshBtn" class="btn">Refresh</button>
                <button id="copyBtn" class="btn btn-primary" disabled>Copy text</button>
                <a id="wclLink" class="btn hidden" target="_blank" rel="noopener">Worst pull on WCL</a>
                <span id="stamp" class="status"></span>
            </div>
            <div id="statusLine" class="status">Loading…</div>
            <div id="errorBox" class="warn hidden"></div>
        </section>
        <div id="verdict" class="verdict-banner hidden"></div>
        <div id="cards" class="report-cards"></div>
        <section class="panel hidden" id="factsPanel"><h2>Facts</h2><div class="table-wrap" id="factsWrap"></div></section>
    </div>
    <script src="assignments-engine.js"></script>
    <script src="vet-engine.js"></script>
    <script src="feedback.js"></script>
</body>
</html>
```

- [ ] **Step 2: `feedback.css`**

```css
.back-link { color: #9ab; text-decoration: none; }
.verdict-banner { background: rgba(255, 215, 0, 0.08); border: 1px solid #665; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 1.05em; }
.report-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; margin-bottom: 20px; }
.report-card { background: rgba(0, 0, 0, 0.25); border: 1px solid #444; border-radius: 8px; padding: 14px; }
.report-card h3 { color: #ffd700; font-size: 1em; margin: 0 0 10px; }
.report-card.wide { grid-column: 1 / -1; }
.report-row { display: grid; grid-template-columns: 1.4em 1fr; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.report-row:first-of-type { border-top: none; }
.report-row .mark { font-weight: 700; text-align: center; }
.report-row.fail .mark { color: #ff6b6b; } .report-row.warn .mark { color: #ffd166; } .report-row.pass .mark { color: #8fe38f; } .report-row.info .mark { color: #9ab; }
.report-row .fix { display: block; font-weight: 600; margin-top: 2px; }
.report-row .value { color: #9ab; margin-left: 6px; }
.report-more { margin-top: 6px; } .report-more summary { cursor: pointer; color: #9ab; font-size: 0.9em; }
.stand-table td, .stand-table th { padding: 3px 8px; text-align: left; }
.fine-line { color: #8fe38f; }
```

- [ ] **Step 3: `feedback.js`** — move `factsTable` from `vetting.js:465-506` verbatim (it only needs `escapeHtml`; copy that helper too if it is not global — it lives in `vetting.js`; copy its four-line body), then:

```js
'use strict';
/* global VetEngine */
(function () {
    const params = new URLSearchParams(location.search);
    const q = { name: params.get('name') || '', server: (params.get('server') || '').toLowerCase(), region: (params.get('region') || 'eu').toLowerCase(), zone: params.get('zone') || '1060', report: params.get('report') || '', thresholds: params.get('thresholds') || '' };
    const key = () => 'raidFeedback:' + q.region + '/' + q.server + '/' + q.name.toLowerCase() + '/' + q.zone + '/' + (q.report || 'all');
    const $ = id => document.getElementById(id);
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    // factsTable(facts) — pasted from vetting.js here.

    let current = null;
    function readCache() { try { return JSON.parse(localStorage.getItem(key())); } catch (e) { return null; } }
    function writeCache(body) { try { localStorage.setItem(key(), JSON.stringify(Object.assign({}, body, { fetchedAt: Date.now() }))); } catch (e) { /* quota: the page still renders */ } }
    function apiUrl() {
        return '/api/vet/feedback?name=' + encodeURIComponent(q.name) + '&server=' + encodeURIComponent(q.server) + '&region=' + encodeURIComponent(q.region) + '&zone=' + encodeURIComponent(q.zone) +
               (q.report ? '&report=' + encodeURIComponent(q.report) : '') + (q.thresholds ? '&thresholds=' + encodeURIComponent(q.thresholds) : '');
    }
    async function load(force) {
        const cached = force ? null : readCache();
        if (cached && cached.facts) { render(cached); return; }
        $('statusLine').textContent = 'Reading Warcraft Logs for ' + q.name + '… this takes up to a minute the first time.';
        $('refreshBtn').disabled = true;
        try {
            const res = await fetch(apiUrl());
            const body = await res.json().catch(() => ({}));
            if (res.status === 429) { showError('Warcraft Logs rate limit reached — try again in a few minutes.'); return; }
            if (!res.ok) { showError(body.error || ('HTTP ' + res.status)); return; }
            writeCache(body); render(body);
        } catch (err) { showError('Network error: ' + err.message); }
        finally { $('refreshBtn').disabled = false; }
    }
    function showError(msg) { $('errorBox').textContent = msg; $('errorBox').classList.remove('hidden'); $('statusLine').textContent = ''; }
    function rowEl(r) {
        const mark = { fail: '✗', warn: '!', pass: '✓', info: '·' }[r.verdict] || '·';
        const div = document.createElement('div'); div.className = 'report-row ' + r.verdict;
        div.innerHTML = '<span class="mark">' + mark + '</span><span><span class="text">' + escapeHtml(r.text) + '.</span>' + (r.value != null ? '<span class="value">~' + r.value + '% of the gap</span>' : '') + (r.fix ? '<span class="fix">' + escapeHtml(r.fix) + '</span>' : '') + '</span>';
        return div;
    }
    function card(title, rows, wide, more) {
        const c = document.createElement('div'); c.className = 'report-card' + (wide ? ' wide' : '');
        c.innerHTML = '<h3>' + escapeHtml(title) + '</h3>';
        rows.forEach(r => c.appendChild(rowEl(r)));
        if (more && more.length) { const d = document.createElement('details'); d.className = 'report-more'; d.innerHTML = '<summary>' + more.length + ' more</summary>'; more.forEach(r => d.appendChild(rowEl(r))); c.appendChild(d); }
        return c;
    }
    function render(body) {
        current = body;
        const facts = body.facts, cl = facts.overall.checklist, byId = id => cl.rows.find(r => r.id === id);
        $('errorBox').classList.add('hidden');
        $('title').textContent = facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + facts.tier.zoneName;
        $('statusLine').textContent = facts.night ? 'Raid night of ' + facts.night.date + ', median parse that night ' + Math.round(facts.night.medianPercent) : 'Median parse ' + Math.round(facts.tier.medianPercent) + ' across kills';
        $('stamp').textContent = body.generatedAt ? 'Generated ' + new Date(body.generatedAt).toLocaleString() : '';
        $('copyBtn').disabled = false;
        // Night selector
        const sel = $('nightSelect'), nights = Array.isArray(facts.nights) ? facts.nights : [];
        if (nights.length) {
            sel.classList.remove('hidden');
            sel.innerHTML = '<option value="">Across kills</option>' + nights.map(n => '<option value="' + escapeHtml(n.code) + '">' + escapeHtml(n.date + ' · ' + n.bosses.length + (n.bosses.length === 1 ? ' boss' : ' bosses') + ' · median ' + (n.medianPercent == null ? '—' : Math.round(n.medianPercent))) + '</option>').join('');
            sel.value = q.report;
        }
        // Worst pull link
        const worst = facts.kills.filter(k => !k.fight.badPull).sort((a, b) => (a.rankPercent == null ? 101 : a.rankPercent) - (b.rankPercent == null ? 101 : b.rankPercent))[0];
        if (worst && worst.wclUrl) { $('wclLink').href = worst.wclUrl; $('wclLink').classList.remove('hidden'); }
        // Verdict
        const v = cl.verdict, vb = $('verdict');
        if (v) { vb.textContent = body.report.split('\n')[1]; vb.classList.remove('hidden'); } else vb.classList.add('hidden');
        // Cards
        const cards = $('cards'); cards.innerHTML = '';
        const player = cl.rows.filter(r => r.owner === 'player'), listed = new Set(cl.fixFirst.concat(cl.also));
        if (cl.fixFirst.length) cards.appendChild(card(facts.limited ? "What's holding your healing back" : 'Fix first', cl.fixFirst.map(byId), true));
        const alsoMore = player.filter(r => !listed.has(r.id) && r.verdict !== 'pass');
        if (cl.also.length || alsoMore.length) cards.appendChild(card('Also', cl.also.map(byId), false, alsoMore));
        const group = cl.rows.filter(r => r.owner === 'group'), askMore = group.filter(r => !cl.asks.includes(r.id));
        if (group.length) cards.appendChild(card('Ask your raid leader', cl.asks.map(byId), false, askMore));
        if (cl.fine.length) { const c = document.createElement('div'); c.className = 'report-card'; c.innerHTML = '<h3>Fine</h3><div class="fine-line">' + escapeHtml(cl.fine.map(id => byId(id).text).join(', ')) + '</div>'; cards.appendChild(c); }
        if (cl.stand.length) {
            const c = document.createElement('div'); c.className = 'report-card wide'; c.innerHTML = '<h3>Where you stand</h3>';
            const t = document.createElement('table'); t.className = 'stand-table';
            const cls = String(facts.player.class || 'player').toLowerCase();
            t.innerHTML = '<tr><th>Pull</th><th>You</th><th>' + escapeHtml(cls) + 's in your raid</th><th>Comparable players</th><th>Best at your item level</th></tr>' +
                cl.stand.map(s => '<tr><td>' + escapeHtml(s.name + (s.date ? ' (' + s.date + ')' : '')) + '</td><td>' + s.me + '</td><td>' + (s.sameClass.length ? s.sameClass.join(' / ') : '—') + '</td><td>' + s.dps + '</td><td>' + (s.topDps == null ? '—' : s.topDps) + '</td></tr>').join('');
            c.appendChild(t); cards.appendChild(c);
        }
        const bp = cl.notOnYou.badPulls;
        if (bp.groups.length || cl.notOnYou.rows.length) {
            const c = document.createElement('div'); c.className = 'report-card wide'; c.innerHTML = '<h3>Not on you</h3>';
            const lines = body.report.split('\n'); const i = lines.indexOf('Not on you');
            if (i >= 0) lines.slice(i + 1).filter(l => l && l !== 'Pick one thing to change next raid.').forEach(l => { const d = document.createElement('div'); d.textContent = l; c.appendChild(d); });
            cards.appendChild(c);
        }
        $('factsWrap').innerHTML = ''; $('factsWrap').appendChild(factsTable(facts)); $('factsPanel').classList.remove('hidden');
    }
    async function copyText() {
        if (!current) return;
        const text = current.report, btn = $('copyBtn');
        try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
        catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); btn.textContent = 'Copied'; }
        setTimeout(() => { btn.textContent = 'Copy text'; }, 1500);
    }
    document.addEventListener('DOMContentLoaded', () => {
        if (!q.name || !q.server) { showError('Open this page from the vetting table (it needs a character name and realm).'); return; }
        $('refreshBtn').addEventListener('click', () => load(true));
        $('copyBtn').addEventListener('click', copyText);
        $('nightSelect').addEventListener('change', e => { const u = new URL(location.href); if (e.target.value) u.searchParams.set('report', e.target.value); else u.searchParams.delete('report'); location.href = u.toString(); });
        load(false);
    });
})();
```

- [ ] **Step 4: Smoke test with headless Chrome** (no WCL needed). Create `scratchpad/feedback-smoke.mjs` (outside the repo — the session's scratchpad directory; do not commit it):

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const F = (await import('/ABS/PATH/TO/REPO/vet-feedback.js')).default || await import('/ABS/PATH/TO/REPO/vet-feedback.js');
const facts = JSON.parse(fs.readFileSync('/ABS/PATH/TO/REPO/fixtures/facts-lovestoned-v3.json', 'utf8'));
facts.overall.checklist = F.Checklist.buildChecklist(facts, F.T);
const body = { facts, report: F.Checklist.renderReport(facts.overall.checklist, facts), generatedAt: new Date().toISOString(), fetchedAt: Date.now() };
const server = spawn('node', ['server.js'], { cwd: '/ABS/PATH/TO/REPO', env: Object.assign({}, process.env, { PORT: '3131' }), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);
const url = 'http://localhost:3131/feedback.html?name=Lovestoned&server=spineshatter&region=eu&zone=1060';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9345', '--user-data-dir=/tmp/claude-feedback-smoke', '--no-first-run', url], { stdio: 'ignore' });
let t = null;
for (let i = 0; i < 240 && !t; i++) { try { const l = await (await fetch('http://127.0.0.1:9345/json')).json(); t = l.find(x => x.type === 'page' && x.url.includes('feedback.html')); } catch {} if (!t) await sleep(1000); }
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);
await send('Runtime.evaluate', { expression: `localStorage.setItem('raidFeedback:eu/spineshatter/lovestoned/1060/all', ${JSON.stringify(JSON.stringify(body))}); location.reload();` });
await sleep(2500);
const r = await send('Runtime.evaluate', { expression: `JSON.stringify({ heads: Array.from(document.querySelectorAll('.report-card h3')).map(h => h.textContent), verdict: document.getElementById('verdict').textContent, copy: document.getElementById('copyBtn').disabled, facts: document.querySelectorAll('.facts-table tr').length })`, returnByValue: true });
console.log(r.result.result.value);
chrome.kill(); server.kill(); process.exit(0);
```
Run: `node scratchpad/feedback-smoke.mjs`
Expected: `heads` = `["Fix first","Also","Ask your raid leader","Fine","Where you stand","Not on you"]`, `verdict` starts with `You do 59% of what comparable players do`, `copy` false, `facts` = 14 (13 kills + header).

- [ ] **Step 5: Commit**

```bash
git add feedback.html feedback.js feedback.css
git commit -m "feat(feedback): the report page — verdict banner, checklist cards, where you stand, facts table"
```

---

### Task 11: Vetting page — Report link, feedback box removed

**Files:**
- Modify: `vetting.js` (state at 11-27, `load` 29-50, `requestFeedback` 186-215, `fallbackReport` 229-270, `factsTable` 465-506, `feedbackBox` 507-580, `detailRow` 626, `removePlayer` 333, `removeAll`/refresh 342, 658), `vetting.css:34-47`

- [ ] **Step 1: Implement**

1. `state`: drop `feedback: {}`; delete `feedbackInFlight`, `feedbackErrors`, `clearFeedbackErrors` and every call to them; in `load()` delete the `parsed.feedback` block (old stored entries are simply not read).
2. Delete `requestFeedback`, `fallbackReport`, `factsTable`, `feedbackBox` and the `copyText` helper if nothing else uses it (grep `copyText(`).
3. Add, near `toggleDetail`:
   ```js
   function feedbackUrl(r) {
       return 'feedback.html?name=' + encodeURIComponent(r.name) + '&server=' + encodeURIComponent(wcl.server) + '&region=' + encodeURIComponent(wcl.region) +
              '&zone=' + ZONE + '&thresholds=' + encodeURIComponent(JSON.stringify(state.thresholds));
   }
   ```
4. In `renderTable`, in the last cell (`rm`) before the × button, when `r.profile && r.profile.parses && wcl.server`:
   ```js
        const rep = document.createElement('a');
        rep.className = 'report-link'; rep.textContent = 'Report'; rep.href = feedbackUrl(r); rep.target = '_blank'; rep.rel = 'noopener'; rep.title = 'Open the feedback report in a new tab';
        rep.addEventListener('click', e => e.stopPropagation());
        rm.appendChild(rep);
   ```
5. In `detailRow`, replace `parseBox.appendChild(feedbackBox(r));` with the same link (a fresh element, class `report-link`, text `Feedback report →`) when parses exist.
6. `vetting.css`: delete the `.feedback-*` and `.facts-table` rules (lines 34-47); add `.report-link { color: #9ab; margin-right: 10px; text-decoration: none; } .report-link:hover { color: #ffd700; }`.
7. `grep -n "feedback" vetting.js` must show only `feedbackUrl` and the two link sites.

- [ ] **Step 2: Verify in the browser** — `npm start`, open `http://localhost:3000/vetting.html`, add a player: the row shows `Report` next to ×; clicking opens `feedback.html?name=…&server=…&region=…&zone=1060&thresholds=…` in a new tab. Headless variant: reuse the Task 10 smoke skeleton against `vetting.html`, seed `localStorage.raidVettingState` with `{ players: [{ name: 'Lovestoned' }], thresholds: {} }` and `raidAssignmentsState`'s `wcl` (see `ASSIGN_KEY` in vetting.js), reload, and assert `document.querySelector('.report-link').href` contains `name=Lovestoned&server=`.

- [ ] **Step 3: Run `npm test`** → all suites `0 failed` (vetting.js has no unit tests; the engine suites must still pass).

- [ ] **Step 4: Commit**

```bash
git add vetting.js vetting.css
git commit -m "feat(vetting): Report link per row opens the feedback page; in-row feedback box removed"
```

---

### Task 12: README and cleanup

**Files:**
- Modify: `README.md:26-37` (the feedback bullet), `README.md:72` (test line)

- [ ] **Step 1: Rewrite the feedback bullet**

```markdown
  - **Feedback report** (`Report` link in a player's row, opens `feedback.html`): a checklist of
    what is holding their parses back — one row per habit, aggregated over their live pulls,
    each with the measured number, what same-spec players within two item levels do on the same
    boss, and a fixed fix. A verdict line says what share of the gap is theirs, the raid's setup,
    or nobody's; "Fix first" holds the three biggest items, "Ask your raid leader" the group
    asks, "Where you stand" shows their DPS next to the other same-class players in their raid.
    Raid-wide bad pulls are counted under "Not on you". Everything is measured from Warcraft Logs
    (`/api/vet/feedback`, `vet-feedback.js`, `vet-gap.js`, `vet-checklist.js`) and rendered
    deterministically — no model is involved. "Copy text" copies the plain-text version. Needs
    `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`. Optional `report=<WCL report code>` analyses one raid
    night. The facts sheet carries `overall.checklist` (rows, verdict, caps) and per-pull `gap`.
```
Remove the sentence about `OPENAI_API_KEY` being needed for the prose (keep it for `/api/ai-review`). Update the `npm test` comment line to list the checklist suite.

- [ ] **Step 2: Final checks**

Run: `npm test 2>&1 | grep -E "passed|FAIL"`; `grep -rn "reportError\|overall.findings\|overall.positives\|buildPrompt" --include=*.js --include=*.md . | grep -v node_modules | grep -v "docs/superpowers"` → nothing outside the historical specs.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: feedback report v4 — checklist, report page, no model"
```

---

## Self-review (done while writing)

- Spec §3 `sameClass` → Task 1; §3 moved tables / `value`+`bar` → Task 2; §4.2–4.3 → Tasks 3–6; §4.4 constants → Task 3; §4.5–4.6 → Task 7; §5 → Task 7; §6 → Tasks 10–11; §7 → Tasks 8–9, 12; §8 golden/unit/route/page → Tasks 7, 9, 10.
- `buildChecklist(facts, T)` is the signature everywhere (Tasks 7, 8, 9, 10). Row ids used by the page (`fixFirst`, `also`, `asks`, `fine`, `stand`, `notOnYou.badPulls.groups`) are the ones Task 7 produces.
- Known soft spots for the executor: the golden test's exact `also` order and the `activity` value are hand-computed from the fixture (see Task 7 Step 4 for how to debug); the `party_buffs` text in the Lovestoned sheet names `Moonkin Aura` and `Chain of the Twilight Owl` on the Morogrim pull — if the half-rule yields a different set, print `counts` before changing the rule.
