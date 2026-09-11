'use strict';
const { selectReferences } = require('./evaluation-reference.js');

// Checks shared across roles. Every conclusion is a recorded fact or a bounded review
// window. No cast-gap seconds are converted to recoverable damage/healing.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => finite(value) ? Math.round(value * 10) / 10 : null;
const body = table => table?.data || table;
const rows = table => Array.isArray(body(table)?.entries) ? body(table).entries : [];
const id = entry => Number(entry?.abilityGameID ?? entry?.ability?.guid ?? entry?.guid);
const ENCHANT_SLOTS = { 0: 'Head', 2: 'Shoulders', 4: 'Chest', 6: 'Legs', 7: 'Boots', 8: 'Wrists', 9: 'Gloves', 14: 'Back', 15: 'Main hand' };
function analyzeCommon(raw) {
    const fight = raw.context?.fights?.find(f => f.id === raw.fightId) || raw.context?.fights?.[0] || {};
    const start = fight.startTime, duration = (fight.endTime - start) / 1000;
    const url = 'https://classic.warcraftlogs.com/reports/' + raw.reportCode + '#fight=' + raw.fightId + '&source=' + raw.sourceId;
    const evidence = (text, from, to) => ({ text, url, ...(finite(from) ? { startSec: round(from) } : {}), ...(finite(to) ? { endSec: round(to) } : {}) });
    const findings = [], comparison = [], timeline = [], checks = [], limitations = [];
    const add = (key, title, owner, action, records) => findings.push({ id: key, title, owner, action, evidence: records, confidence: 'observed', gainDps: null,
        ...(key === 'cast-chaining' && raw.player?.role !== 'healer' ? { category: 'execution', priority: 'medium' } : {}),
        ...(['preparation-enchants', 'equipment-sockets'].includes(key) ? {
            disposition: 'improve', category: 'equipment', priority: 'low',
            actionTitle: key === 'equipment-sockets' ? 'Fill your empty gem sockets before the next raid' : 'Enchant your recorded unenchanted equipment',
            why: 'The equipment snapshot identifies an empty enhancement slot. Filling it provides its listed benefit without changing your rotation; the best option depends on your build.',
            verification: 'Before the next raid, inspect the listed items and confirm the chosen enhancements are equipped.',
        } : {}) });
    const check = (key, label, status, reason) => checks.push({ id: key, label, status, reason });
    const ci = raw.tables?.ci?.data?.find(e => e.sourceID === raw.sourceId) || raw.tables?.ci?.data?.find(e => e.sourceID == null);
    if (Array.isArray(ci?.gear)) {
        const positioned = ci.gear.map((g, index) => ({ ...g, slot: Number.isInteger(g.slot) ? g.slot : ci.gear.length >= 18 ? index : null }));
        const equipped = raw.gearAudit?.slots ? raw.gearAudit.slots.filter(g => g.id > 0 && g.enchantable).map(g => ({ ...g, label: g.key === 'feet' ? 'Boots' : g.label, permanentEnchant: g.enchant?.id })) : positioned.filter(g => g.id > 0 && ENCHANT_SLOTS[g.slot]).map(g => ({ ...g, label: ENCHANT_SLOTS[g.slot] }));
        const missing = equipped.filter(g => !g.permanentEnchant);
        check('preparation-enchants', 'Equipment enchants', equipped.length ? 'checked' : 'unknown', !equipped.length ? 'No identifiable enchantable slots were supplied in this equipment snapshot.' : missing.length ? missing.map(g => g.label).join(', ') + ' have no permanent enchant recorded.' : 'All checked equipment slots have a permanent enchant.');
        if (missing.length) add('preparation-enchants', missing.length + ' equipment slot' + (missing.length === 1 ? '' : 's') + ' had no permanent enchant', 'player',
            'Enchant these items with an option suited to your role before the next raid. For boots, weigh movement speed against throughput; the log alone does not rank those options.', missing.map(g => evidence(g.label + ': ' + (g.name || 'item ' + g.id) + ', no permanent enchant in the pull snapshot.')));
    } else check('preparation-enchants', 'Equipment enchants', 'unknown', 'A pull-specific equipment snapshot was unavailable.');
    if (!raw.gearAudit && ci?.gear?.[16]?.id > 0) check('offhand-enchant', 'Off-hand enchant eligibility', 'unknown', 'Item-type data is unavailable; weapons and shields can be enchanted, held off-hand items cannot.');
    if (raw.gearAudit?.slots) {
        const empty = raw.gearAudit.slots.filter(slot => slot.emptySockets > 0);
        check('equipment-sockets', 'Empty gem sockets', 'checked', empty.length ? empty.reduce((sum, slot) => sum + slot.emptySockets, 0) + ' empty sockets on identified items.' : 'No empty sockets found on identified items.');
        if (empty.length) add('equipment-sockets', 'Fill the recorded empty gem sockets', 'player', 'Add gems appropriate to the build and check meta-gem requirements before the next raid. This check identifies empty sockets; it does not claim a universal best stat.', empty.map(slot => evidence(slot.label + ': ' + slot.name + ', ' + slot.emptySockets + ' empty sockets.')));
        if (raw.gearAudit.unknownItems?.length) limitations.push('Some equipment IDs are absent from the local item database; socket counts and enchant eligibility for those items remain unknown.');
    }
    const buffs = body(raw.tables?.buffs)?.auras;
    if (Array.isArray(buffs)) {
        const food = buffs.filter(b => /well fed/i.test(b.name || ''));
        check('preparation-food', 'Food buff', 'checked', food.length ? 'A food buff was recorded during the pull.' : 'No Well Fed aura was returned for this pull.');
        if (!food.length) add('preparation-food', 'No food buff was recorded', 'player', 'Use food appropriate to your role before the next pull and confirm the buff is active after any death.', [evidence('The returned buff table contains no Well Fed aura.')]);
        const burst = buffs.filter(b => /^(Bloodlust|Heroism|Arcane Power|Icy Veins|Avenging Wrath|Bestial Wrath|Adrenaline Rush|Death Wish|Recklessness|Essence of the Martyr|Bloodlust Brooch)$/i.test(b.name || ''));
        for (const buff of burst) for (const band of buff.bands || []) {
            const from = Math.max(0, (band.startTime - start) / 1000), to = Math.min(duration, (band.endTime - start) / 1000);
            if (to > from) timeline.push({ label: buff.name, startSec: round(from), endSec: round(to), kind: 'cooldown' });
        }
    } else check('preparation-food', 'Food buff', 'unknown', 'The buff table was unavailable; absence is not established.');
    const casts = rows(raw.tables?.casts).filter(r => finite(r.total));
    const spellNames = new Map([...casts, ...rows(raw.tables?.dmg), ...rows(raw.tables?.healing)].map(r => [id(r), r.name]));
    const own = raw.events?.complete && Array.isArray(raw.events.data) ? raw.events.data.filter(e => e.sourceID === raw.sourceId && e.timestamp >= start && e.timestamp <= fight.endTime) : null;
    if (own && duration > 0) {
        const castEvents = own.filter(e => e.type === 'cast').sort((a, b) => a.timestamp - b.timestamp);
        check('cast-timeline', 'Cast sequence', 'checked', castEvents.length + ' cast events recorded; counts include utility and are not a performance grade.');
        for (const cast of casts.slice().sort((a, b) => b.total - a.total).slice(0, 8)) comparison.push({ name: cast.name + ' casts', player: cast.total, reference: null, unit: 'casts', note: 'Recorded cast-table count. Spell ranks, resource needs and assignment affect use.' });
        const gaps = castEvents.slice(1).map((event, i) => ({ before: castEvents[i], after: event, seconds: (event.timestamp - castEvents[i].timestamp) / 1000 })).filter(g => g.seconds >= 6).sort((a, b) => b.seconds - a.seconds).slice(0, 4);
        if (gaps.length) add('cast-sequence-review', 'Review the ' + gaps.length + ' longest gaps between recorded casts', 'context',
            raw.player?.role === 'healer' ? 'Check these windows against assigned targets taking damage, range and mana needs. Waiting when no healing is needed can be correct; these are review windows, not missed heals.' : 'Check target access, movement, control effects and resources in these windows. Auto-attacks and ongoing effects can continue between casts; this is not a measure of lost output.',
            gaps.map(g => evidence(round(g.seconds) + ' seconds between ' + (spellNames.get(id(g.before)) || 'spell ' + id(g.before)) + ' and ' + (spellNames.get(id(g.after)) || 'spell ' + id(g.after)) + '.', (g.before.timestamp - start) / 1000, (g.after.timestamp - start) / 1000)));
        const segments = [];
        let begun = null;
        for (const event of own.slice().sort((a, b) => a.timestamp - b.timestamp)) {
            if ([1, 75, 5019, 6603].includes(id(event))) continue;
            if (event.type === 'begincast') begun = event;
            else if (event.type === 'cast' && begun && id(begun) === id(event) && event.timestamp >= begun.timestamp) {
                if (event.timestamp > begun.timestamp && event.timestamp - begun.timestamp < 20000) segments.push({ spell: id(event), start: begun.timestamp, end: event.timestamp });
                begun = null;
            } else if (event.type === 'cast' || /^(interrupt|interruptcast|cancelcast|castcancel|castfailed)$/.test(event.type || '')) begun = null;
        }
        if (segments.length >= 3) {
            const counts = new Map();
            for (const segment of segments) counts.set(segment.spell, (counts.get(segment.spell) || 0) + 1);
            const primary = [...counts].sort((a, b) => b[1] - a[1])[0][0];
            const delays = segments.slice(1).map((segment, index) => ({ previous: segments[index], next: segment }))
                .filter(pair => pair.previous.spell === primary && pair.next.spell === primary && pair.next.start - pair.previous.end > 150 &&
                    !castEvents.some(event => event.timestamp > pair.previous.end && event.timestamp < pair.next.start));
            check('cast-chaining', 'Cast start and completion pairs', 'checked', segments.length + ' cast starts matched a same-spell completion; review windows exclude intervening recorded casts.');
            if (delays.length) {
                const seconds = delays.reduce((sum, pair) => sum + (pair.next.start - pair.previous.end) / 1000, 0);
                const name = spellNames.get(primary) || 'Spell ' + primary;
                const action = raw.player?.role === 'healer' ? 'Review these gaps against actual healing demand and assigned targets. Waiting or cancelling can conserve mana; the intervals are not missed healing.' : raw.player?.classToken === 'HUNTER' ? 'Review these timings with Auto Shot, your intended shot sequence and movement. Faster Steady Shot chaining is not automatically better if it clips Auto Shot.' : 'When a target is available and the next cast is appropriate, queue the next spell before the current cast completes. Check the longest marked gaps against movement, control effects and planned holds first.';
                add('cast-chaining', name + ': ' + round(seconds) + ' seconds between consecutive completed casts and the next start', 'context', action,
                    delays.slice().sort((a, b) => (b.next.start - b.previous.end) - (a.next.start - a.previous.end)).slice(0, 5).map(pair => evidence(name + ' completed; the next cast began ' + round((pair.next.start - pair.previous.end) / 1000) + ' seconds later. No other cast was recorded between them.', (pair.previous.end - start) / 1000, (pair.next.start - start) / 1000)));
                limitations.push('Cast-chaining intervals are observed elapsed time, not measured avoidable delay. GCD limits, latency, mechanics and decisions can explain them; no DPS loss is assigned.');
            }
        } else check('cast-chaining', 'Cast start and completion pairs', 'unknown', 'Too few cast-time start/completion pairs were available to inspect chaining.');
        // This WCL expansion currently exposes malformed classResources positional fields.
        // Only typed resourcechange amount/waste records are summarized, never inferred mana.
        const usesMana = !['WARRIOR', 'ROGUE'].includes(raw.player?.classToken) && !(raw.player?.classToken === 'DRUID' && ['Feral', 'Guardian'].includes(raw.player?.spec));
        const mana = usesMana ? raw.events.data.filter(e => e.type === 'resourcechange' && e.targetID === raw.sourceId && e.resourceChangeType === 0 && finite(e.resourceChange) && finite(e.waste) && e.resourceChange >= 0 && e.waste >= 0) : [];
        if (mana.length) {
            const sources = new Map();
            for (const event of mana) {
                const key = id(event), item = sources.get(key) || { amount: 0, waste: 0, count: 0, first: event.timestamp, last: event.timestamp };
                item.amount += event.resourceChange; item.waste += event.waste; item.count++; item.last = event.timestamp; sources.set(key, item);
            }
            check('mana-gains', 'Recorded mana restoration', 'checked', mana.length + ' typed mana-restoration events; starting mana and affordability remain unknown.');
            for (const [spell, source] of sources) comparison.push({ name: (spellNames.get(spell) || 'Mana source ' + spell) + ' recorded restoration', player: source.amount, reference: null, unit: 'mana', note: source.count + ' events; ' + source.waste + ' separately logged waste. Not a reconstruction of the mana bar.' });
            const wasted = mana.filter(e => e.waste > 0);
            if (wasted.length) add('mana-restoration-waste', 'Some mana restoration had recorded waste', 'context', 'Review the linked restoration events when planning mana cooldowns and consumables. Identify the source and whether its timing was under your control before changing usage.', wasted.slice().sort((a, b) => b.waste - a.waste).slice(0, 4).map(e => evidence((spellNames.get(id(e)) || 'Spell ' + id(e)) + ': ' + e.resourceChange + ' restoration and ' + e.waste + ' separately logged waste.', (e.timestamp - start) / 1000)));
        } else check('mana-gains', 'Recorded mana restoration', !usesMana ? 'not-applicable' : 'unknown', 'No typed mana-restoration records were available.');
        limitations.push('Class-resource snapshots are not trusted for this log format. Cast affordability, rage/energy capping and time spent out of mana are not inferred.');
    } else check('cast-timeline', 'Cast sequence', 'unknown', 'Incomplete events or invalid fight times prevent absence-of-cast conclusions.');
    if (!['healer', 'tank'].includes(raw.player?.role) && duration > 0 && !(raw.player?.classToken === 'WARRIOR' && raw.player?.spec === 'Fury')) {
        const references = selectReferences(raw).accepted.filter(r => r.player?.classToken === raw.player?.classToken && r.player?.spec === raw.player?.spec && r.context?.fights?.[0]?.name === fight.name)
            .sort((a, b) => Number(b.kind === 'benchmark') - Number(a.kind === 'benchmark') || Math.abs((a.context.fights[0].endTime - a.context.fights[0].startTime) / 1000 - duration) - Math.abs((b.context.fights[0].endTime - b.context.fights[0].startTime) / 1000 - duration));
        const reference = references[0], refFight = reference?.context?.fights?.[0], refDuration = refFight ? (refFight.endTime - refFight.startTime) / 1000 : null;
        const refRows = rows(reference?.tables?.dmg), ownDamage = rows(raw.tables?.dmg).filter(r => finite(r.total) && finite(id(r)));
        const contributions = ownDamage.map(ability => {
            const other = refRows.find(r => id(r) === id(ability));
            return { ability, other, ownDps: ability.total / duration, refDps: other && refDuration > 0 ? other.total / refDuration : null };
        }).sort((a, b) => (b.refDps === null ? b.ownDps : b.refDps - b.ownDps) - (a.refDps === null ? a.ownDps : a.refDps - a.ownDps)).slice(0, 6);
        for (const { ability, other, ownDps, refDps } of contributions) {
            comparison.push({ name: ability.name + ' damage contribution', player: round(ownDps), reference: round(refDps), unit: 'DPS', note: 'Observed contribution, not the gain from casting this ability more.' });
            if (finite(ability.critHitCount) && finite(ability.hitCount)) comparison.push({ name: ability.name + ' critical direct hits', player: ability.critHitCount, reference: finite(other?.critHitCount) ? other.critHitCount : null, unit: 'crits', note: 'Random outcomes, build, gear and support can change this count; it is not a button-press error.' });
        }
        const largest = contributions.find(c => c.refDps !== null && c.refDps - c.ownDps > 50);
        if (largest && reference) {
            const ownCast = casts.find(c => id(c) === id(largest.ability));
            const refCast = rows(reference.tables?.casts).find(c => id(c) === id(largest.ability));
            const records = [evidence(raw.player.name + ': ' + round(largest.ownDps) + ' DPS from ' + largest.ability.name + (ownCast ? ', ' + ownCast.total + ' recorded casts' : '') + ' over ' + round(duration) + ' seconds.'),
                { text: reference.player.name + ': ' + round(largest.refDps) + ' DPS from this ability' + (refCast ? ', ' + refCast.total + ' recorded casts' : '') + ' over ' + round(refDuration) + ' seconds.', url: 'https://classic.warcraftlogs.com/reports/' + reference.reportCode + '#fight=' + reference.fightId + '&source=' + reference.sourceId }];
            add('damage-composition', largest.ability.name + ' accounts for ' + round(largest.refDps - largest.ownDps) + ' DPS of the observed comparison', 'context', 'Start with this ability’s cast sequence, hit outcomes, target access and supporting buffs. The number describes where damage differs; it does not establish that this entire difference is recoverable through execution.', records);
        }
    }
    const deathRows = rows(raw.context?.deaths);
    if (Array.isArray(body(raw.context?.deaths)?.entries)) {
        const deaths = deathRows.filter(d => d.id === raw.sourceId || d.targetID === raw.sourceId);
        check('survival', 'Player deaths', 'checked', deaths.length ? deaths.length + ' death' + (deaths.length === 1 ? '' : 's') + ' recorded.' : 'No player death recorded during this pull.');
        for (const death of deaths) {
            const at = (death.timestamp - start) / 1000;
            const hit = death.killingBlow?.name || death.killingBlow?.ability?.name || death.damage?.abilities?.[0]?.name || 'the recorded final damage';
            add('death-' + death.timestamp, 'Death at ' + round(at) + ' seconds', 'context', 'Review the last incoming hits, healing, defensive use and assigned mechanic. The killing blow alone does not establish who could have prevented the death.', [evidence('The death record includes ' + hit + '.', Math.max(0, at - 8), at)]);
            timeline.push({ label: 'Player death', startSec: round(at), endSec: round(at), kind: 'death' });
        }
    } else check('survival', 'Player deaths', 'unknown', 'The deaths table was unavailable.');
    return { findings, comparison, timeline, limitations, checks };
}
module.exports = { analyzeCommon };
