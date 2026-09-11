'use strict';
(function () {
    const VERSION = 1;
    const CACHE_VERSION = 2;
    const sharedView = document.body.dataset.view === 'shared';
    const params = new URLSearchParams(sharedView ? '' : location.search);
    const query = {
        name: params.get('name') || '', server: params.get('server') || '', region: params.get('region') || 'eu', zone: params.get('zone') || '1060', report: params.get('report') || '',
        fightId: params.get('fightId') || params.get('fight') || '', sourceId: params.get('sourceId') || params.get('source') || '',
        race: params.get('race') || '', talentsString: params.get('talentsString') || params.get('talents') || '',
    };
    const $ = id => document.getElementById(id);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const list = value => Array.isArray(value) ? value : [];
    const number = value => typeof value === 'number' && Number.isFinite(value);
    const fmt = value => number(value) ? Math.round(value).toLocaleString('en-GB') : '—';
    const owner = value => ({ player: 'Your preparation & play', raid: 'With your raid leader', gear: 'Gear option', context: 'Fight context' }[value] || 'Review together');
    const seconds = value => number(value) ? Math.floor(Math.max(0, value) / 60) + ':' + String(Math.floor(Math.max(0, value) % 60)).padStart(2, '0') : '—';
    function safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
    function link(url, text) { const safe = safeUrl(url); return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : esc(text); }
    function evidenceText(e) { return typeof e === 'string' ? e : e && e.text || ''; }
    function evidenceHtml(e) { if (!e) return ''; if (typeof e === 'string') return esc(e); return (number(e.startSec) ? '<span class="when">' + seconds(e.startSec) + (number(e.endSec) ? '–' + seconds(e.endSec) : '') + ' · </span>' : '') + link(e.url, e.text || 'Source evidence'); }
    function detail(title, evidence, caveats) { const lines = list(evidence).map(e => '<li>' + evidenceHtml(e) + '</li>').join(''); const notes = list(caveats).map(e => '<li>' + esc(e) + '</li>').join(''); return lines || notes ? '<details><summary>' + esc(title) + '</summary>' + (lines ? '<ul>' + lines + '</ul>' : '') + (notes ? '<p>Limits of this estimate</p><ul>' + notes + '</ul>' : '') + '</details>' : ''; }
    const findingForAction = { boots: 'boots-enchant', haste: 'haste-potion', demonslaying: 'demonslaying-elixir', lotp: 'support-24932', ur: 'support-30807' };
    function orderedActions(actions) {
        const group = value => ({ player: 0, raid: 1, gear: 2, context: 3 }[value] ?? 4);
        const magnitude = action => number(action?.impact?.value) ? action.impact.value : number(action?.gainDps) ? action.gainDps : -Infinity;
        return [...list(actions)].sort((a, b) => group(a.owner) - group(b.owner) || magnitude(b) - magnitude(a));
    }
    function relatedFindings(action, findings) { const ids = new Set([action.id, findingForAction[action.id], ...list(action.findingIds)].filter(Boolean)); return list(findings).filter(finding => ids.has(finding.id)); }
    function actionEvidence(action, findings) { return [...list(action.evidence), ...relatedFindings(action, findings).flatMap(finding => [{ text: (finding.confidence === 'observed' ? 'Observed: ' : 'Inferred: ') + finding.title }, ...list(finding.evidence), ...(finding.action ? [{ text: 'Log-based advice: ' + finding.action }] : [])])]; }
    function remainingFindings(actions, findings) { const linked = new Set(actions.flatMap(action => relatedFindings(action, findings).map(finding => finding.id))); return list(findings).filter(finding => !linked.has(finding.id)); }
    const priorityRank = value => ({ high: 0, medium: 1, low: 2 }[String(value || '').toLowerCase()] ?? 3);
    function priorityExecutionFindings(findings) { return list(findings).filter(item => String(item?.category || '').toLowerCase() === 'execution' && item.action && priorityRank(item.priority) < 3).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || String(a.title).localeCompare(String(b.title))); }
    function priorityLabel(value) { return ({ high: 'High priority', medium: 'Medium priority', low: 'Low priority' }[String(value || '').toLowerCase()] || 'Priority review'); }
    function rate(value) { return number(value) ? Math.round(value * 10) / 10 : null; }
    function damageRowHtml(row) {
        const count = value => number(value) ? fmt(value) : '—';
        const dps = value => number(value) ? fmt(value) : '—';
        const difference = number(row.differenceDps) ? (row.differenceDps > 0 ? '+' : '') + fmt(row.differenceDps) : '—';
        const perMinute = value => number(value) ? rate(value).toLocaleString('en-GB') + '/min' : '—';
        const average = value => number(value) ? fmt(value) : '—';
        const account = [['Frequency', row.frequencyDps], ['Yield', row.yieldDps]].filter(([, value]) => number(value)).map(([label, value]) => label + ' ' + (value > 0 ? '+' : '') + fmt(value)).join(' · ') || '—';
        return '<tr><th scope="row">' + esc(row.name || row.id || 'Unlabelled damage') + (row.countLabel ? '<span class="damage-count-label">' + esc(row.countLabel) + '</span>' : '') + '</th><td>' + dps(row.playerDps) + '</td><td>' + dps(row.referenceDps) + '</td><td class="damage-difference">' + difference + '</td><td>' + esc(account) + '</td><td>' + count(row.playerCount) + ' / ' + count(row.referenceCount) + '</td><td>' + perMinute(row.playerPerMinute) + ' / ' + perMinute(row.referencePerMinute) + '</td><td>' + average(row.playerAverage) + ' / ' + average(row.referenceAverage) + '</td></tr>';
    }
    function damageAnalysisHtml(analysis) {
        if (!analysis || !number(analysis.gapDps)) return '';
        const rows = list(analysis.rows), visibleRows = rows.slice(0, 5), moreRows = rows.slice(5);
        const reference = analysis.reference || {}, player = analysis.player || {}, accounted = number(analysis.accountedDps) ? fmt(analysis.accountedDps) + ' DPS in listed rows' : 'listed row detail';
        const residual = number(analysis.residualDps) ? '; ' + fmt(analysis.residualDps) + ' DPS remains outside those rows' : '';
        const table = sourceRows => '<div class="comparison-wrap damage-table"><table><thead><tr><th scope="col">Damage source</th><th scope="col">This pull</th><th scope="col">Reference</th><th scope="col">Ref − you</th><th scope="col">Observed account<br><small>frequency / yield DPS</small></th><th scope="col">Count<br><small>you / ref</small></th><th scope="col">Rate<br><small>you / ref</small></th><th scope="col">Average<br><small>you / ref</small></th></tr></thead><tbody>' + sourceRows.map(damageRowHtml).join('') + '</tbody></table></div>';
        const referenceName = link(reference.url, reference.name || 'reference player');
        const duration = number(reference.durationSec) || number(player.durationSec) ? ' over ' + seconds(reference.durationSec || player.durationSec) : '';
        const notes = list(analysis.limitations).length ? detail('Comparison limits', analysis.limitations) : '';
        return '<section class="report-section diagnosis-section"><p class="eyebrow">Damage diagnosis</p><h2>What the logs show</h2><p class="diagnosis-summary">Against ' + referenceName + duration + ', the observed gap is <strong>' + fmt(analysis.gapDps) + ' DPS</strong>. The table shows where that difference appears: ' + esc(accounted + residual) + '.</p><p class="model-note">Frequency and yield describe how each recorded row differs; they are not forecasts of gains or assignments of player fault.</p>' + (visibleRows.length ? table(visibleRows) : '') + (moreRows.length ? '<details class="damage-more"><summary>Show ' + moreRows.length + ' more damage source' + (moreRows.length === 1 ? '' : 's') + '</summary>' + table(moreRows) + '</details>' : '') + notes + '</section>';
    }
    function priorityFindingsHtml(findings) {
        if (!findings.length) return '';
        return '<section class="report-section priority-section"><p class="eyebrow">Priority execution</p><h2>Change these first on the next pull</h2><div class="finding-grid">' + findings.map(item => '<div class="finding priority-' + esc(String(item.priority || '').toLowerCase()) + '"><span class="owner">' + esc(priorityLabel(item.priority)) + '<span class="evidence-tag">' + (item.confidence === 'observed' ? 'Observed' : 'Inferred') + '</span></span><h3>' + esc(item.title) + '</h3><p>' + esc(item.action) + '</p>' + detail('Inspect the evidence', item.evidence) + '</div>').join('') + '</div></section>';
    }
    function basisLabel(item) { return item.basis === 'practice' ? 'Practice next pull' : item.basis === 'correction' ? 'Correction' : ''; }
    function observedAtHtml(item) {
        const timed = list(item.evidence).find(e => e && typeof e === 'object' && number(e.startSec));
        return timed ? '<p class="coaching-observed"><strong>Observed at:</strong> ' + seconds(timed.startSec) + (number(timed.endSec) ? '–' + seconds(timed.endSec) : '') + '</p>' : '';
    }
    function coachingItemHtml(item) {
        const alternatives = list(item.alternatives).map(value => '<li>' + esc(value) + '</li>').join('');
        const basis = basisLabel(item);
        const observedAt = observedAtHtml(item);
        return '<article class="coaching-item coaching-' + esc(item.priority || 'low') + '"><span class="owner">' + esc(priorityLabel(item.priority)) + (basis ? ' · ' + basis : '') + (item.owner ? ' · ' + esc(owner(item.owner)) : '') + '</span><h3>' + esc(item.what || item.title || 'Finding') + '</h3>' + (item.observed ? '<p class="coaching-observed"><strong>Observed:</strong> ' + esc(item.observed) + '</p>' : '') + observedAt + '<p><strong>Why it matters:</strong> ' + esc(item.why || 'The supplied evidence needs review in context.') + '</p>' + (item.change ? '<p class="coaching-change"><strong>Next pull:</strong> ' + esc(item.change) + '</p>' : '') + '<p><strong>Verify:</strong> ' + esc(item.verification || 'Inspect the source evidence on the next comparable pull.') + '</p>' + (alternatives ? '<details><summary>Alternatives to check</summary><ul>' + alternatives + '</ul></details>' : '') + detail('Inspect the evidence', item.evidence) + '</article>';
    }
    function coachingItems(value) { return list(value).filter(item => item && typeof item === 'object'); }
    function coachedIds(coaching) { return new Set(['improvements', 'keeps', 'reviews'].flatMap(key => coachingItems(coaching?.[key]).map(item => item.id).filter(Boolean))); }
    function coachingSecondaryHtml(coaching) {
        const keeps = coachingItems(coaching.keeps), reviews = coachingItems(coaching.reviews), depth = coaching.depth && typeof coaching.depth === 'object' ? coaching.depth : {};
        const keepHtml = keeps.length ? '<details class="coaching-details"><summary>Keep doing (' + keeps.length + ')</summary><div class="coaching-list">' + keeps.map(coachingItemHtml).join('') + '</div></details>' : '';
        const reviewHtml = reviews.length ? '<details class="coaching-details"><summary>Open review (' + reviews.length + ')</summary><p class="model-note">These observations need encounter context before they become a change request.</p><div class="coaching-list">' + reviews.map(coachingItemHtml).join('') + '</div></details>' : '';
        const coverage = depth && (list(depth.reviewed).length || list(depth.unresolved).length) ? '<details class="coaching-depth"><summary>' + esc(depth.status === 'complete' ? 'Review coverage' : 'Inspection coverage') + '</summary><span>Reviewed: ' + esc(list(depth.reviewed).join(', ') || '—') + '</span><span>Unresolved: ' + esc(list(depth.unresolved).join(', ') || '—') + '</span></details>' : '';
        return keepHtml || reviewHtml || coverage ? '<details class="background-details coaching-background"><summary>Keep, review & coverage</summary>' + keepHtml + reviewHtml + coverage + '</details>' : '';
    }
    function coachingHtml(coaching) {
        if (!coaching || typeof coaching !== 'object') return '';
        const improvements = coachingItems(coaching.improvements);
        return '<section class="report-section coaching-section"><p class="eyebrow">Next-pull coaching</p><h2>Make these changes</h2><p class="coaching-assessment">' + esc(coaching.assessment || 'This report summarizes the available evidence.') + '</p><div class="coaching-list">' + (improvements.length ? improvements.map(coachingItemHtml).join('') : '<p class="model-note">No evidence-backed change is ready for this pull.</p>') + '</div>' + coachingSecondaryHtml(coaching) + '</section>';
    }
    const ownerTag = value => ({ you: 'You', player: 'You', raid: 'Raid', luck: 'Luck', context: 'Fight context' }[value] || 'Review');
    const sizeText = size => esc(size && size.label ? size.label : 'not sized');
    function bucketItemHtml(item) {
        const title = item.title || item.what || 'Finding';
        const isNote = item.itemKind === 'note';
        // A cross-reference is a pointer to the cause that already explains this bucket: one line,
        // no size, no action of its own — the real card carries those.
        if (item.itemKind === 'crossref')
            return '<article class="bucket-item bucket-crossref"><span class="owner">See</span><h4>' + esc(title) + '</h4>' +
                (item.observation ? '<p class="bucket-observation">' + esc(item.observation) + '</p>' : '') + '</article>';
        const action = item.itemKind === 'finding' ? item.change : item.action;
        const basis = basisLabel(item) ? ' · ' + basisLabel(item) : '';
        const observedAt = observedAtHtml(item);
        return '<article class="bucket-item owner-' + esc(item.owner || 'review') + ' size-' + esc(item.size?.kind || 'unsized') + '"><span class="owner">' + (isNote ? 'Context' : ownerTag(item.owner)) + ' · <span class="size">' + sizeText(item.size) + basis + '</span></span><h4>' + esc(title) + '</h4>' +
            (item.observation || item.observed ? '<p class="bucket-observation">' + esc(item.observation || item.observed) + '</p>' : '') + observedAt + (item.why && item.itemKind === 'finding' ? '<p><strong>Why it matters:</strong> ' + esc(item.why) + '</p>' : '') +
            (item.size && item.size.note ? '<p class="model-note">' + esc(item.size.note) + '</p>' : '') +
            (!isNote && action ? '<p class="coaching-change"><strong>Next:</strong> ' + esc(action) + '</p>' : '') + (!isNote && item.verification ? '<p><strong>Verify:</strong> ' + esc(item.verification) + '</p>' : '') + detail('Inspect the evidence', item.evidence) + '</article>';
    }
    function factorLineHtml(b) {
        const f = b.factors; if (!f || typeof f !== 'object') return '';
        const signed = v => number(v) ? (v > 0 ? '−' : '+') + fmt(Math.abs(v)) + ' DPS' : '—';
        // A partial factors object must degrade to '—', never throw inside innerHTML.
        const exact = v => number(v) ? String(v) : '—';
        const zero = f.zeroDamage || {}, per = f.rate || {}, landed = f.yield || {}, crit = landed.crit || {};
        return '<p class="factor-line">Zero-damage outcomes ' + exact(zero.player) + '% vs ' + exact(zero.reference) + '% (' + signed(zero.dps) + ') · Rate ' + exact(per.player) + ' vs ' + exact(per.reference) + '/min (' + signed(per.dps) + ') · Per landed hit ' + fmt(landed.player) + ' vs ' + fmt(landed.reference) + ' (' + signed(landed.dps) + '; crit share ' + exact(crit.player) + '% vs ' + exact(crit.reference) + '%)</p>';
    }
    // Assumptions explain a bucket's numbers (pet/periodic exclusion, "only one player
    // recorded this", the outcome-count gate, Precision/Surefooted ranges) whether or not the
    // bucket cleared the ≥20-outcomes-both-sides gate that produces `factors` — a bucket with
    // no factors is exactly the case where the reader most needs the explanation, so this must
    // not be gated on `b.factors` the way the numeric factor line is.
    function assumptionsHtml(b) {
        return list(b.assumptions).length ? '<p class="model-note">' + esc(b.assumptions.join(' ')) + '</p>' : '';
    }
    function budgetHtml(coaching) {
        const budget = coaching.budget, buckets = list(coaching.buckets); if (!budget) return '';
        const pricing = budget.pricing || {};
        const priceLine = pricing.status === 'priced' ? 'Prices use the ' + (pricing.rotation === 'validated' ? 'validated' : 'unvalidated') + ' rotation on your recorded gear.' : 'Prices are not available: ' + (pricing.reason || 'no simulator run.');
        const strip = '<div class="budget-strip"><div class="stat"><span class="stat-label">You</span><span class="stat-number">' + fmt(budget.player?.dps) + '</span><span class="stat-unit">DPS</span></div><div class="stat"><span class="stat-label">' + link(budget.reference?.url, budget.reference?.name || 'Reference') + '</span><span class="stat-number">' + fmt(budget.reference?.dps) + '</span><span class="stat-unit">DPS</span></div><div class="stat"><span class="stat-label">Gap</span><span class="stat-number">' + fmt(budget.gapDps) + '</span><span class="stat-unit">DPS</span></div></div>';
        const bucketHtml = buckets.map(b => '<section class="bucket"><div class="bucket-head"><h3>' + esc(b.name) + '</h3>' + (number(b.playerDps) ? '<span class="muted">you ' + fmt(b.playerDps) + ' · ref ' + fmt(b.referenceDps) + ' · diff ' + (b.differenceDps > 0 ? '+' : '') + fmt(b.differenceDps) + ' DPS</span>' : '') + '</div>' + factorLineHtml(b) + assumptionsHtml(b) + '<div class="bucket-items">' + list(b.items).filter(i => i && (!i.mirrored || i.itemKind === 'crossref')).map(bucketItemHtml).join('') + '</div><p class="model-note">' + esc(b.note) + '</p></section>').join('');
        return '<section class="report-section budget-section"><p class="eyebrow">Damage budget</p><h2>Where the gap is and what it is worth</h2><p class="coaching-assessment">' + esc(coaching.assessment || 'This report summarizes the available evidence.') + '</p>' + strip + (budget.headline ? '<p class="budget-headline">' + esc(budget.headline) + '</p>' : '') + '<p class="model-note">' + esc(priceLine) + ' ' + esc(list(budget.limitations).join(' ')) + '</p>' + bucketHtml + '</section>';
    }
    function nightCoachingHtml(coaching) {
        if (!coaching || typeof coaching !== 'object') return '';
        const questions = list(coaching.openQuestions);
        const changes = coachingItems(coaching.topChanges || coaching.improvements).slice(0, 5);
        const briefChange = value => { const text = String(value || '').trim(), sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] || text; return sentence.length > 160 ? sentence.slice(0, 157).trimEnd() + '…' : sentence; };
        const sized = coachingItems(coaching.topSized);
        const bossLines = list(coaching.bossLines).filter(line => line && typeof line === 'object');
        const sizedHtml = '<ol class="night-priorities">' + sized.map(item => '<li><strong>' + esc(item.what || item.title || 'Finding') + '</strong><span>' + sizeText(item.size) + ' · ' + esc(list(item.bosses).join(', ') || 'Encounter context unavailable') + '</span></li>').join('') + '</ol>'
            + (bossLines.length ? '<ul class="boss-lines">' + bossLines.map(line => '<li>' + esc(line.boss || 'Encounter') + ': you ' + fmt(line.playerDps) + ' vs ' + fmt(line.referenceDps) + ', gap ' + fmt(line.gapDps) + (line.topBucket ? ', largest bucket ' + esc(line.topBucket) : '') + '</li>').join('') + '</ul>' : '');
        const changeHtml = sized.length ? sizedHtml : changes.length ? '<ol class="night-priorities">' + changes.map(item => '<li><strong>' + esc(item.what || item.title || 'Finding') + '</strong><span>' + esc(briefChange(item.change || item.observed || 'Review the available evidence before the next pull.')) + ' · ' + esc(priorityLabel(item.priority)) + ' · ' + esc(list(item.bosses).join(', ') || 'Encounter context unavailable') + '</span></li>').join('') + '</ol>' : '';
        return '<section class="night-coaching"><p class="eyebrow">Night overview</p><p>' + esc(coaching.assessment || 'This overview summarizes the available encounter coaching.') + '</p>' + changeHtml + (questions.length ? '<details><summary>Open questions (' + questions.length + ')</summary><ul>' + questions.map(question => '<li>' + esc(question) + '</li>').join('') + '</ul></details>' : '') + '</section>';
    }
    function modelEvidence(sim) {
        const lines = [...list(sim.assumptions)], v = sim.validation || {};
        if (sim.version) lines.push('Model version: ' + sim.version);
        if (number(sim.baselineDps)) lines.push('Modeled baseline: ' + fmt(sim.baselineDps) + ' DPS. A similar baseline does not validate a reconstruction of the player’s exact actions.');
        if (number(v.iterations)) lines.push('Simulation sample: ' + fmt(v.iterations) + ' iterations per scenario.');
        if (v.stats && typeof v.stats.pass === 'boolean') lines.push(v.stats.pass ? 'Recorded combatant stats are within the model tolerance; assumptions still apply.' : 'Starting-stat validation did not pass. Treat these estimates as unvalidated.');
        if (v.potion && typeof v.potion.pass === 'boolean') lines.push(v.potion.pass ? 'The potion scenario verified a potion use and its active duration.' : 'The potion scenario did not pass its use and duration check.');
        return lines;
    }
    function hasCharacter() { return !!(query.name && query.server); }
    function hasNamedReport() { return !!(query.name && query.report); }
    function hasDirectPull() { return !!(query.report && query.sourceId); }
    function canBuild() { return hasCharacter() || hasNamedReport() || hasDirectPull(); }
    function cacheKey() { const base = [query.region, query.server, query.name.toLowerCase(), query.zone, query.report].map(encodeURIComponent).join('/'); const extra = [query.fightId, query.sourceId, query.race, query.talentsString]; return 'raidEvaluation:v' + CACHE_VERSION + ':' + base + (extra.some(Boolean) ? '/' + extra.map(encodeURIComponent).join('/') : ''); }
    let shareJobId = null;
    let current = null, fightIndex = 0, userSelectedFight = false, generation = 0, timer = null, busy = false;
    function savedJob() { try { const saved = JSON.parse(localStorage.getItem(cacheKey())); return saved && saved.version === CACHE_VERSION && typeof saved.id === 'string' ? saved.id : null; } catch { return null; } }
    function saveJob(id) { try { localStorage.setItem(cacheKey(), JSON.stringify({ version: CACHE_VERSION, id })); } catch { /* Storage is optional. */ } }
    function clearJob() { try { localStorage.removeItem(cacheKey()); } catch { /* Storage may be blocked. */ } }
    function error(message) { $('errorBox').textContent = message; $('errorBox').hidden = false; }
    function setBusy(value) { busy = value; if ($('shareBtn')) $('shareBtn').disabled = value || !shareJobId; $('refreshBtn').disabled = value || !canBuild(); $('refreshBtn').textContent = value ? 'Evaluating…' : current ? 'Rebuild evaluation' : 'Build evaluation'; }
    async function request(url, options) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
        try { const res = await fetch(url, { ...options, signal: controller.signal }); const body = await res.json().catch(() => ({})); if (!res.ok) { const e = new Error(body.error || (res.status === 429 ? 'Warcraft Logs is rate limited. Retry shortly.' : 'Request failed (' + res.status + ').')); e.status = res.status; throw e; } return body; }
        finally { clearTimeout(timeout); }
    }
    function progress(job) { const p = job.progress || {}; $('jobStatus').hidden = false; $('stageLabel').textContent = p.stage ? String(p.stage).replace(/[_-]/g, ' ') : 'Evaluating'; $('statusText').textContent = p.message || 'Reading encounter evidence and testing supported changes. You can leave and return to this page.'; if (number(p.total) && p.total > 0 && number(p.completed)) { $('jobProgress').max = p.total; $('jobProgress').value = Math.min(p.total, Math.max(0, p.completed)); } else $('jobProgress').removeAttribute('value'); }
    async function handleJob(job, run) {
        if (run !== generation) return;
        if (!job || typeof job.id !== 'string') throw invalidReport('The evaluation service returned an invalid job.');
        saveJob(job.id);
        shareJobId = job.status === 'complete' && job.result ? job.id : null;
        if (job.result && (list(job.result.fights).length || !['queued', 'running'].includes(job.status))) render(job.result);
        if (job.status === 'complete') { if (!job.result) throw invalidReport('The completed evaluation has no report. Rebuild to retry.'); $('jobStatus').hidden = true; setBusy(false); return; }
        if (job.status === 'failed') { clearJob(); $('jobStatus').hidden = true; setBusy(false); error((job.error || 'The evaluation could not finish.') + (current ? ' Available encounter evidence is shown below.' : ' Rebuild to retry.')); return; }
        if (!['queued', 'running'].includes(job.status)) throw invalidReport('The evaluation service returned an unknown status.');
        progress(job); timer = setTimeout(() => poll(job.id, run), 2000);
    }
    async function poll(id, run) {
        try { const job = await request('/api/vet/evaluation/' + encodeURIComponent(id)); if (run !== generation) return; $('errorBox').hidden = true; await handleJob(job, run); }
        catch (e) { if (run !== generation) return; if (e.invalidReport) { clearJob(); setBusy(false); $('jobStatus').hidden = true; error(e.message); return; } if ([404, 410].includes(e.status)) { clearJob(); setBusy(false); $('jobStatus').hidden = true; error('This saved evaluation has expired. Build it again to read fresh evidence.'); return; } error('Connection interrupted: ' + e.message + ' The report will reconnect automatically.'); timer = setTimeout(() => poll(id, run), 6000); }
    }
    function evaluationBody(force) {
        const body = { name: query.name || undefined, server: query.server || undefined, region: query.region || undefined, zone: query.zone || undefined, report: query.report || undefined, fightId: query.fightId || undefined, sourceId: query.sourceId || undefined };
        if (query.race || query.talentsString) body.modelOverrides = { race: query.race || undefined, talentsString: query.talentsString || undefined };
        if (force) body.force = true;
        return body;
    }
    async function build(force) {
        if (!canBuild()) { error('Enter a character and realm, or paste a report with a character name or source ID.'); return; }
        const run = ++generation; shareJobId = null; if ($('shareLinkBox')) $('shareLinkBox').hidden = true; clearTimeout(timer); $('errorBox').hidden = true; setBusy(true); $('emptyState').hidden = true;
        progress({ progress: { stage: 'Preparing report', message: 'Reading the selected pull. Tested improvements run when a model covers this role and specialization.' } });
        const previous = force ? null : savedJob(); if (previous) { await poll(previous, run); return; }
        try { await handleJob(await request('/api/vet/evaluation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evaluationBody(force)) }), run); }
        catch (e) { if (run !== generation) return; setBusy(false); $('jobStatus').hidden = true; error('Could not start the evaluation: ' + e.message); }
    }
    function invalidReport(message) { const e = new Error(message); e.invalidReport = true; return e; }
    function validReport(data) { return data && [VERSION, VERSION + 1].includes(data.schemaVersion) && data.player && (!query.name || String(data.player.name).toLowerCase() === query.name.toLowerCase()) && Array.isArray(data.fights); }
    function roleFor(fight) { return String(fight.player?.role || fight.coverage?.role || current?.player?.role || '').toLowerCase(); }
    function metricFor(observed) { const metric = String(observed?.metric || (number(observed?.hps) ? 'hps' : number(observed?.dtps) ? 'dtps' : 'dps')).toLowerCase(); return ['dps', 'hps', 'dtps'].includes(metric) ? metric : 'dps'; }
    function metricInfo(observed) {
        const metric = metricFor(observed);
        return metric === 'hps' ? { metric, title: 'Effective healing / HPS', unit: 'Effective healing / HPS observed', comparison: 'Healing outcomes in this pull', context: 'Effective healing is context, not a target to maximize. Use assignments, casts, coverage, and avoidable loss to decide the next action.' } :
            metric === 'dtps' ? { metric, title: 'Incoming damage / DTPS', unit: 'Incoming damage / DTPS observed', comparison: 'Incoming damage in this pull', context: 'Incoming damage is context, not a tank score. Lower DTPS is not automatically better; check mitigation, avoidance, assignments, and encounter duties.' } :
                { metric, title: 'DPS', unit: 'DPS observed', comparison: 'What the other player logged', context: 'Differences describe the logs. A higher count or outcome alone does not prove an execution mistake.' };
    }
    function observedValues(observed) { const metric = metricFor(observed); const suffix = metric === 'dps' ? 'Dps' : metric === 'hps' ? 'Hps' : 'Dtps'; return { player: observed?.playerValue ?? observed?.[metric] ?? observed?.dps, reference: observed?.referenceValue ?? observed?.['reference' + suffix] ?? observed?.referenceDps, difference: observed?.gapValue ?? observed?.['gap' + suffix] ?? observed?.gapDps }; }
    function impactFor(item, modeled) {
        if (item?.impact?.kind === 'modeled' && !modeled) return null;
        if (item?.impact && number(item.impact.value)) return { value: item.impact.value, unit: item.impact.unit || '', label: item.impact.label || (item.impact.kind === 'modeled' ? 'modeled' : item.impact.kind === 'measured' ? 'measured' : 'capacity'), kind: item.impact.kind || 'measured', low: item.impact.low, high: item.impact.high };
        if (modeled && number(item?.gainDps)) return { value: item.gainDps, unit: 'DPS', label: 'modeled', kind: 'modeled' };
        return null;
    }
    function impactText(impact) { if (!impact) return 'Evidence only'; const range = number(impact.low) || number(impact.high) ? ' (' + fmt(impact.low) + '–' + fmt(impact.high) + ')' : ''; return (impact.value > 0 ? '+' : '') + fmt(impact.value) + (impact.unit ? ' ' + impact.unit : '') + range; }
    function impactLabel(impact) { return impact ? (impact.label || impact.kind || 'tested impact') : 'Evidence only'; }
    function usableActions(sim, modeled) { return orderedActions(sim.actions).filter(action => { if (!action?.title) return false; const impact = impactFor(action, modeled); if (action.impact || number(action.gainDps)) return !!impact && (impact.kind !== 'modeled' || impact.value > 0); return true; }); }
    function usablePackages(sim, modeled) { return list(sim.packages).filter(p => { const impact = impactFor(p, modeled); return !!impact && (impact.kind !== 'modeled' || impact.value > 0); }); }
    function coverageHtml(coverage, role) {
        const checks = list(coverage?.checks); if (!checks.length) return '<section class="report-section coverage-section"><p class="eyebrow">Coverage</p><h2>What was checked</h2><p class="model-note">The response did not include a coverage checklist. Use the encounter evidence and report link to validate this pull.</p></section>';
        const roleText = coverage?.role || role || 'this role', specText = coverage?.spec || '';
        return '<section class="report-section coverage-section"><p class="eyebrow">Coverage</p><h2>What was checked for ' + esc([specText, roleText].filter(Boolean).join(' ')) + '</h2><p class="model-note">Checked means this report contained the needed evidence. Unknown means the next pull needs that evidence before drawing a conclusion.</p><ul class="coverage-list">' + checks.map(check => '<li class="coverage-check ' + esc(check.status || 'unknown') + '"><strong>' + esc(check.label || check.id || 'Check') + '</strong><span>' + esc(check.status === 'checked' ? 'Checked' : check.status === 'not-applicable' ? 'Not applicable' : 'Unknown') + (check.reason ? ' · ' + esc(check.reason) : '') + '</span></li>').join('') + '</ul></section>';
    }
    function render(data) {
        if (!validReport(data)) throw invalidReport('The report format or selected player does not match. Rebuild this evaluation.');
        current = data;
        if (!userSelectedFight) {
            let coachingIndex = -1, bestCoaching = null;
            data.fights.forEach((fight, index) => coachingItems(fight?.coaching?.improvements).forEach(item => {
                if (!bestCoaching || priorityRank(item.priority) < priorityRank(bestCoaching.priority) ||
                    (priorityRank(item.priority) === priorityRank(bestCoaching.priority) && (number(item.priorityScore) ? item.priorityScore : 0) > (number(bestCoaching.priorityScore) ? bestCoaching.priorityScore : 0))) {
                    coachingIndex = index; bestCoaching = item;
                }
            }));
            const modeledIndex = data.fights.findIndex(fight => fight.simulation?.status === 'complete');
            fightIndex = coachingIndex >= 0 ? coachingIndex : Math.max(0, modeledIndex);
        } else fightIndex = Math.min(fightIndex, Math.max(0, data.fights.length - 1));
        $('report').hidden = false; $('emptyState').hidden = true;
        $('playerTitle').textContent = data.player.name || 'Player evaluation'; $('playerMeta').textContent = [data.player.spec, data.player.role, data.player.classToken || data.player.class, sharedView ? data.player.server : query.server, sharedView ? data.player.region?.toUpperCase() : query.region?.toUpperCase()].filter(Boolean).join(' · ');
        document.title = (data.player.name || 'Player') + ' · Deep evaluation';
        const date = new Date(data.generatedAt); $('reportStamp').textContent = [data.night?.date || data.night?.code || (query.report ? 'Selected report' : ''), !Number.isNaN(date.getTime()) ? 'Evaluated ' + date.toLocaleString() : ''].filter(Boolean).join(' · ');
        $('copyPlanBtn').disabled = !data.fights.length; $('copyReportBtn').disabled = !data.fights.length;
        $('nightOverview').innerHTML = nightCoachingHtml(data.coaching); $('reportLimitations').innerHTML = detail('Report coverage & limitations', list(data.limitations)); renderFight();
    }
    function renderFight() {
        const fights = current.fights;
        $('fightTabs').innerHTML = fights.map((f, i) => '<button type="button" role="tab" id="fight-tab-' + i + '" aria-controls="fightReport" aria-selected="' + (i === fightIndex) + '" tabindex="' + (i === fightIndex ? 0 : -1) + '" data-fight="' + i + '">' + esc(f.name) + '</button>').join('');
        const f = fights[fightIndex]; if (!f) { $('fightReport').innerHTML = '<div class="unmodeled"><h2>No encounter evidence available</h2><p>This report has no supported pulls to evaluate.</p></div>'; $('sourceLink').hidden = true; return; }
        $('fightReport').setAttribute('aria-labelledby', 'fight-tab-' + fightIndex);
        const source = safeUrl(f.wclUrl); $('sourceLink').hidden = !source; if (source) $('sourceLink').href = source;
        const fightPlayer = f.player || current.player || {}, o = f.observed || {}, values = observedValues(o), info = metricInfo(o), role = roleFor(f), sim = f.simulation || {}, modeled = sim.status === 'complete';
        $('playerTitle').textContent = fightPlayer.name || current.player.name || 'Player evaluation'; $('playerMeta').textContent = [fightPlayer.spec, fightPlayer.role || role, fightPlayer.classToken || fightPlayer.class, sharedView ? current.player.server : query.server, sharedView ? current.player.region?.toUpperCase() : query.region?.toUpperCase()].filter(Boolean).join(' · ');
        const actions = usableActions(sim, modeled), packages = usablePackages(sim, modeled);
        const stats = [['This pull', values.player], ['Reference', values.reference], ['Observed difference', values.difference]].map(([label, value]) => '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-number">' + fmt(value) + '</span><span class="stat-unit">' + esc(info.unit) + '</span></div>').join('');
        const actionHtml = actions.map(a => { const impact = impactFor(a, modeled); return '<li class="action"><div class="action-content"><span class="owner">' + owner(a.owner) + '</span><h3>' + esc(a.title) + '</h3><p>' + esc(a.change) + '</p>' + (a.when ? '<p class="when">When: ' + esc(a.when) + '</p>' : '') + detail('Why this change · evidence & assumptions', actionEvidence(a, f.findings), a.caveats) + '</div><div class="action-gain">' + impactText(impact) + '<small>' + esc(impactLabel(impact)) + '</small></div></li>'; }).join('');
        const packageHtml = packages.map(p => { const impact = impactFor(p, modeled); return '<div class="package"><h3>' + esc(p.title) + '</h3><span class="gain">' + impactText(impact) + '<span class="stat-unit">' + esc(impactLabel(impact)) + '</span></span><p>' + esc(list(p.actionIds).map(id => actions.find(a => a.id === id)?.title).filter(Boolean).join(' + ')) + '</p></div>'; }).join('');
        const coaching = f.coaching && typeof f.coaching === 'object' ? f.coaching : null, coachingIdsForFight = coachedIds(coaching);
        const damageAnalysis = info.metric === 'dps' ? f.damageAnalysis : null, priorityFindings = (info.metric === 'dps' ? priorityExecutionFindings(f.findings) : []).filter(item => !coachingIdsForFight.has(item.id));
        const priorityIds = new Set(priorityFindings.map(item => item.id));
        const findings = remainingFindings(actions, f.findings).filter(item => !priorityIds.has(item.id) && !coachingIdsForFight.has(item.id));
        const findingHtml = findings.map(item => '<div class="finding"><span class="owner">' + owner(item.owner) + '<span class="evidence-tag">' + (item.confidence === 'observed' ? 'Observed' : 'Inferred') + '</span></span><h3>' + esc(item.title) + '</h3><p>' + esc(item.action) + '</p>' + detail('Inspect the evidence', item.evidence) + '</div>').join('');
        const comparisons = list(f.comparison);
        const comparisonHtml = comparisons.length ? '<section class="report-section"><p class="eyebrow">The comparison</p><h2>' + esc(info.comparison) + '</h2><p class="model-note">' + esc(info.context) + '</p><div class="comparison-wrap"><table><thead><tr><th scope="col">Measure</th><th scope="col">This player</th><th scope="col">Reference</th><th scope="col">Context</th></tr></thead><tbody>' + comparisons.map(c => '<tr><th scope="row">' + esc(c.name) + '</th><td>' + esc(c.player == null ? '—' : c.player) + (c.unit ? ' ' + esc(c.unit) : '') + '</td><td>' + esc(c.reference == null ? '—' : c.reference) + (c.unit ? ' ' + esc(c.unit) : '') + '</td><td>' + esc(c.note) + '</td></tr>').join('') + '</tbody></table></div></section>' : '';
        const timeline = list(f.timeline);
        const timelineHtml = timeline.length ? '<section class="report-section"><p class="eyebrow">Pull timeline</p><h2>Where the evidence happens</h2><ol class="timeline">' + timeline.map(t => '<li><time>' + seconds(t.startSec) + (number(t.endSec) ? '–' + seconds(t.endSec) : '') + '</time><div class="event">' + esc(t.label) + '</div></li>').join('') + '</ol></section>' : '';
        const planTitle = modeled ? 'Tested equipment & support options' : 'Options supported by this pull';
        const modelCoverage = sim.coverage || {}, modelLabel = modelCoverage.kind === 'conditional' ? 'Conditional model' : modelCoverage.kind === 'native' ? 'Native model' : modeled ? 'Controlled estimate' : 'Encounter evidence';
        const planNote = (modeled ? 'Use one tested package at a time. Do not add overlapping estimates together.' : 'These are useful options supported by this pull.') + (modelCoverage.reason ? ' ' + modelCoverage.reason : '');
        const bucketed = !!(coaching && list(coaching.buckets).length && coaching.budget);
        const hasPrimaryCoaching = bucketed || coachingItems(coaching?.improvements).length || priorityFindings.length;
        const noActions = '<div class="unmodeled"><h3>' + (info.metric === 'dps' ? 'DPS gains are not quantified for this pull' : 'No tested option for this pull') + '</h3><p>' + esc(sim.reason || 'No tested change is ready for this pull yet.') + '</p></div>';
        const optionsHtml = actions.length || !hasPrimaryCoaching ? '<section aria-label="Tested options" class="tested-options"><div class="section-top"><div><p class="eyebrow">Useful modeled actions</p><h2>' + esc(planTitle) + '</h2></div><span class="model-label">' + esc(modelLabel) + '</span></div>' + (packageHtml ? '<div class="package-grid">' + packageHtml + '</div>' : '') + '<p class="model-note">' + esc(planNote) + '</p>' + (actions.length ? '<ol class="action-list">' + actionHtml + '</ol>' : noActions) + '</section>' : '';
        const explain = info.metric === 'dtps' ? 'Incoming damage differs by mechanics, assignments, cooldown coverage, and who was targeted. Treat this comparison as context for a mitigation and survival review.' : info.metric === 'hps' ? 'Effective healing differs with damage patterns, assignments, overhealing, and other healers. Treat this comparison as context for the next healing plan.' : 'The observed difference can include gear, support, encounter conditions, random outcomes, and execution. It is context for the next pull, not a measure of player fault.';
        const background = damageAnalysisHtml(damageAnalysis) + (findingHtml ? '<section class="report-section"><p class="eyebrow">Additional findings</p><h2>Evidence to review</h2><div class="finding-grid">' + findingHtml + '</div></section>' : '') + coverageHtml(f.coverage, role) + comparisonHtml + timelineHtml + '<section class="report-section"><h2>' + (info.metric === 'dps' ? 'Comparison context' : 'Pull context') + '</h2><p class="model-note">' + esc(explain) + '</p>' + detail('Model assumptions & validation', modelEvidence(sim)) + detail('Encounter limitations', list(f.limitations)) + '</section>';
        const primaryHtml = bucketed ? budgetHtml(coaching) + priorityFindingsHtml(priorityFindings) + coachingSecondaryHtml(coaching) : coachingHtml(coaching) + priorityFindingsHtml(priorityFindings);
        const testedHtml = bucketed && optionsHtml ? '<details class="background-details tested-background"><summary>Tested packages</summary>' + optionsHtml + '</details>' : optionsHtml;
        $('fightReport').innerHTML = '<div class="fight-title"><h2>' + esc(f.name) + '</h2><span class="muted">' + seconds(f.durationSec) + ' pull</span></div>' + primaryHtml + testedHtml + '<div class="observed-strip">' + stats + '</div>' + (background ? '<details class="background-details report-background"><summary>Background details & evidence</summary><div class="background-content">' + background + '</div></details>' : '');
    }
    function reportText(full) {
        const fights = full ? current.fights : [current.fights[fightIndex]], lines = [current.player.name + ' — ' + (full ? 'deep evaluation' : 'next raid action plan'), current.night?.date || current.night?.code || 'Selected report'];
        if (full && current.coaching?.assessment) {
            lines.push('Night overview: ' + current.coaching.assessment);
            list(current.coaching.openQuestions).forEach(question => lines.push('Open question: ' + question));
        }
        fights.filter(Boolean).forEach(f => {
            const sim = f.simulation || {}, modeled = sim.status === 'complete', values = observedValues(f.observed || {}), info = metricInfo(f.observed || {}), actions = usableActions(sim, modeled), packages = usablePackages(sim, modeled);
            lines.push('', f.name, 'Observed: ' + fmt(values.player) + ' ' + info.title + '; reference ' + fmt(values.reference) + '; observed difference ' + fmt(values.difference) + '.');
            const coaching = f.coaching && typeof f.coaching === 'object' ? f.coaching : {};
            const budget = coaching.budget, budgetBuckets = list(coaching.buckets), bucketed = !!(budget && budgetBuckets.length);
            const coachingChanges = coachingItems(coaching.improvements);
            if (coaching.assessment) lines.push('Coaching assessment: ' + coaching.assessment);
            if (bucketed) {
                lines.push('Budget: you ' + Math.round(budget.player?.dps || 0) + ' DPS, ' + (budget.reference?.name || 'reference') + ' ' + Math.round(budget.reference?.dps || 0) + ' DPS, gap ' + Math.round(budget.gapDps || 0) + '.');
                if (budget.headline) lines.push(budget.headline);
                budgetBuckets.forEach(b => {
                    lines.push('Bucket ' + b.name + ': ' + (number(b.playerDps) ? 'you ' + Math.round(b.playerDps) + ', ref ' + Math.round(b.referenceDps) + ', ' : '') + 'diff ' + Math.round(b.differenceDps || 0) + '.');
                    list(b.items).filter(item => item && (!item.mirrored || item.itemKind === 'crossref')).forEach(item => {
                        const action = item.itemKind === 'finding' ? item.change : item.action, observation = item.observation || item.observed || '';
                        if (item.itemKind === 'crossref') { lines.push('- [see] ' + (item.title || 'Covered elsewhere') + (observation ? ' ' + observation : '')); return; }
                        lines.push('- [' + (item.owner === 'player' ? 'you' : item.owner || 'review') + '] ' + (item.title || item.what || 'Finding') + ' — ' + (item.size?.label || 'not sized') + (item.size?.note ? ' (' + item.size.note + ')' : '') + '.' + (observation ? ' ' + observation : '') + (action ? ' Next: ' + action : ''));
                        if (full) list(item.evidence).forEach(e => lines.push('  Evidence: ' + (number(e.startSec) ? seconds(e.startSec) + ' ' : '') + evidenceText(e) + (safeUrl(e.url) ? ' ' + safeUrl(e.url) : '')));
                    });
                });
                list(budget.limitations).forEach(l => lines.push('Budget limitation: ' + l));
            }
            [...(bucketed ? [] : coachingChanges), ...(full ? [...coachingItems(coaching.keeps), ...coachingItems(coaching.reviews)] : [])].forEach(item => {
                const basis = item.basis === 'practice' ? ' · Practice next pull' : item.basis === 'correction' ? ' · Correction' : '';
                const label = coachingChanges.includes(item) ? 'Coaching change (' + priorityLabel(item.priority) + basis + ')' : coachingItems(coaching.keeps).includes(item) ? 'Keep' : 'Review';
                lines.push(label + ': ' + (item.what || item.title || 'Finding') + (item.observed ? ' Observed: ' + item.observed : '') + ' — Why: ' + (item.why || '') + (item.change ? ' Change: ' + item.change : '') + ' Verify: ' + (item.verification || ''));
                if (full) { list(item.alternatives).forEach(value => lines.push('  Alternative: ' + value)); list(item.evidence).forEach(e => lines.push('  Evidence: ' + (number(e.startSec) ? seconds(e.startSec) + ' ' : '') + evidenceText(e) + (safeUrl(e.url) ? ' ' + safeUrl(e.url) : ''))); }
            });
            const analysis = info.metric === 'dps' ? f.damageAnalysis : null;
            const coachingIdsForFight = coachedIds(coaching), priorityFindings = (info.metric === 'dps' ? priorityExecutionFindings(f.findings) : []).filter(item => !coachingIdsForFight.has(item.id));
            if (full && analysis && number(analysis.gapDps)) {
                const reference = analysis.reference || {};
                lines.push('Damage diagnosis: ' + (reference.name || 'reference player') + ' logged ' + fmt(analysis.gapDps) + ' DPS more' + (number(reference.durationSec) ? ' over ' + seconds(reference.durationSec) : '') + '.');
                list(analysis.rows).forEach(row => { const account = [['frequency', row.frequencyDps], ['yield', row.yieldDps]].filter(([, value]) => number(value)).map(([label, value]) => label + ' ' + (value > 0 ? '+' : '') + fmt(value) + ' DPS').join(', '); lines.push('Damage source: ' + (row.name || row.id || 'Unlabelled damage') + ' — you ' + fmt(row.playerDps) + ' DPS, reference ' + fmt(row.referenceDps) + ' DPS, ref − you ' + (number(row.differenceDps) && row.differenceDps > 0 ? '+' : '') + fmt(row.differenceDps) + ' DPS' + (account ? '; ' + account : '') + '; count ' + fmt(row.playerCount) + ' / ' + fmt(row.referenceCount) + '.'); });
                lines.push('These rows describe the logged difference; they are not a forecast of gains or a player-fault assignment.');
            }
            priorityFindings.forEach(item => { lines.push('Priority execution (' + priorityLabel(item.priority) + '): ' + item.title + ' — ' + item.action); if (full) list(item.evidence).forEach(e => lines.push('  Evidence: ' + (number(e.startSec) ? seconds(e.startSec) + ' ' : '') + evidenceText(e) + (safeUrl(e.url) ? ' ' + safeUrl(e.url) : ''))); });
            actions.forEach(a => { const impact = impactFor(a, modeled); lines.push('- ' + owner(a.owner) + ': ' + a.title + ' — ' + a.change + (a.when ? ' When: ' + a.when + '.' : '') + ' [' + impactText(impact) + ' ' + impactLabel(impact) + ']'); if (full) { actionEvidence(a, f.findings).forEach(e => lines.push('  Evidence: ' + (number(e.startSec) ? seconds(e.startSec) + ' ' : '') + evidenceText(e) + (safeUrl(e.url) ? ' ' + safeUrl(e.url) : ''))); list(a.caveats).forEach(c => lines.push('  Limit: ' + c)); } });
            if (!actions.length && !coachingChanges.length && !priorityFindings.length && !bucketed) lines.push('Next step: check the coverage and logged evidence before the next pull.');
            packages.forEach(p => { const impact = impactFor(p, modeled); lines.push('Tested package: ' + p.title + ' = ' + impactText(impact) + ' ' + impactLabel(impact) + '.'); });
            const priorityIds = new Set(priorityFindings.map(item => item.id));
            if (full) remainingFindings(actions, f.findings).filter(item => !priorityIds.has(item.id) && !coachingIdsForFight.has(item.id)).forEach(item => { lines.push('- ' + owner(item.owner) + ': ' + item.title + ' — ' + item.action + ' [' + (item.confidence === 'observed' ? 'Observed' : 'Inferred') + ']'); list(item.evidence).forEach(e => lines.push('  Evidence: ' + (number(e.startSec) ? seconds(e.startSec) + ' ' : '') + evidenceText(e) + (safeUrl(e.url) ? ' ' + safeUrl(e.url) : ''))); });
            if (full) { list(f.coverage?.checks).forEach(c => lines.push('Coverage: ' + (c.label || c.id) + ' — ' + (c.status || 'unknown') + (c.reason ? ': ' + c.reason : ''))); list(f.comparison).forEach(c => lines.push(c.name + ': ' + (c.player ?? 'unknown') + ' vs ' + (c.reference ?? 'unknown') + (c.unit ? ' ' + c.unit : '') + '. ' + (c.note || ''))); list(f.timeline).forEach(t => lines.push(seconds(t.startSec) + (number(t.endSec) ? '–' + seconds(t.endSec) : '') + ': ' + t.label)); modelEvidence(sim).forEach(a => lines.push('Model assumption: ' + a)); list(f.limitations).forEach(l => lines.push('Limitation: ' + l)); }
            if (full && info.metric === 'dps') lines.push('Any remaining difference is not assigned to player fault.');
            if (safeUrl(f.wclUrl)) lines.push(safeUrl(f.wclUrl));
        });
        if (full) list(current.limitations).forEach(l => lines.push('Report limitation: ' + l)); return lines.join('\n');
    }
    async function copy(full) {
        if (!current) return; const text = reportText(full);
        try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text); else { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); const done = document.execCommand('copy'); area.remove(); if (!done) throw new Error('Copy was blocked by the browser.'); } $('copyStatus').textContent = full ? 'Full report copied.' : 'Action plan for this encounter copied.'; }
        catch { $('copyStatus').textContent = 'Clipboard unavailable. Select the report text to copy it.'; }
    }
    async function loadNights() {
        if (!hasCharacter()) { $('nightSelect').innerHTML = '<option value="">Paste a report and source ID for a direct pull</option>'; return; }
        try { const q = new URLSearchParams({ name: query.name, server: query.server, region: query.region, zone: query.zone }); const body = await request('/api/vet/nights?' + q); const nights = list(body.nights); $('nightSelect').innerHTML = '<option value="">Choose a raid night…</option>' + nights.map(n => '<option value="' + esc(n.code) + '">' + esc([n.date, n.zoneName, list(n.bosses).length + ' bosses'].filter(Boolean).join(' · ')) + '</option>').join(''); if (query.report && !nights.some(n => n.code === query.report)) { const option = document.createElement('option'); option.value = query.report; option.textContent = 'Selected report · ' + query.report; $('nightSelect').appendChild(option); } $('nightSelect').value = query.report; if (!nights.length && !query.report) $('emptyState').innerHTML = '<h2>No ranked raid nights found.</h2><p>Paste a readable Warcraft Logs report and source ID to evaluate this character directly.</p>'; }
        catch (e) { if (query.report) { const option = document.createElement('option'); option.value = query.report; option.textContent = 'Selected report · ' + query.report; $('nightSelect').replaceChildren(option); } else { $('nightSelect').innerHTML = '<option value="">Raid nights unavailable</option>'; error('Could not load raid nights: ' + e.message); } }
    }
    function readReportInput(value) {
        const raw = String(value || '').trim(); if (!raw) return { report: '', fightId: '', sourceId: '' };
        let report = raw, fightId = '', sourceId = '';
        try { const url = new URL(raw); const match = url.pathname.match(/\/reports\/([A-Za-z0-9]{16})/i); if (match) report = match[1]; const fragment = new URLSearchParams(url.hash.replace(/^#/, '')); fightId = fragment.get('fight') || ''; sourceId = fragment.get('source') || ''; }
        catch { const match = raw.match(/^([A-Za-z0-9]{16})(?:#(.*))?$/); if (match) { report = match[1]; const fragment = new URLSearchParams(match[2] || ''); fightId = fragment.get('fight') || ''; sourceId = fragment.get('source') || ''; } }
        return { report, fightId, sourceId };
    }
    function syncInputs() { $('nameInput').value = query.name; $('serverInput').value = query.server; $('regionInput').value = query.region; $('reportInput').value = query.report; $('fightInput').value = query.fightId; $('sourceInput').value = query.sourceId; $('raceInput').value = query.race; $('talentsInput').value = query.talentsString; }
    function updateUrl() { const url = new URL(location.href); ['name', 'server', 'region', 'zone', 'report', 'fightId', 'sourceId', 'race', 'talentsString'].forEach(key => query[key] ? url.searchParams.set(key, query[key]) : url.searchParams.delete(key)); url.searchParams.delete('fight'); url.searchParams.delete('source'); url.searchParams.delete('talents'); history.replaceState(null, '', url); }
    function resetReport() { current = null; shareJobId = null; if ($('shareLinkBox')) $('shareLinkBox').hidden = true; fightIndex = 0; userSelectedFight = false; clearJob(); $('report').hidden = true; $('copyPlanBtn').disabled = true; $('copyReportBtn').disabled = true; $('copyStatus').textContent = ''; }
    $('fightTabs').addEventListener('click', event => { const button = event.target.closest('[data-fight]'); if (button) { userSelectedFight = true; fightIndex = Number(button.dataset.fight); renderFight(); $('fight-tab-' + fightIndex).focus(); $('copyStatus').textContent = ''; } });
    $('fightTabs').addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !current?.fights.length) return; event.preventDefault(); userSelectedFight = true; const count = current.fights.length; fightIndex = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (fightIndex + (event.key === 'ArrowRight' ? 1 : -1) + count) % count; renderFight(); $('fight-tab-' + fightIndex).focus(); });
    window.addEventListener('pagehide', () => { ++generation; clearTimeout(timer); });
    $('copyPlanBtn').addEventListener('click', () => copy(false));
    $('copyReportBtn').addEventListener('click', () => copy(true));
    if (sharedView) {
        const token = location.hash.slice(1);
        $('emptyState').hidden = true;
        if (!/^[a-f0-9]{48}$/.test(token)) { error('This shared report link is invalid. Ask the sender for a new link.'); return; }
        $('sharedStatus').textContent = 'Loading your evaluation…';
        request('/api/shared-evaluation/' + token).then(body => {
            render(body.result); $('sharedStatus').textContent = 'Shared evaluation · Saved when this link was created.';
        }).catch(() => { $('sharedStatus').textContent = ''; error('This shared report is unavailable. Ask the sender for a new link.'); });
        return;
    }
    async function shareReport() {
        if (!shareJobId || busy) return;
        const jobId = shareJobId, run = generation;
        $('shareBtn').disabled = true; $('copyStatus').textContent = 'Creating the player’s share link…';
        try {
            const body = await request('/api/vet/evaluation/' + encodeURIComponent(jobId) + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (generation !== run || jobId !== shareJobId) return;
            if (!/^[a-f0-9]{48}$/.test(body.token)) throw new Error('Invalid share link response.');
            const url = new URL('/shared-evaluation.html', location.origin); url.hash = body.token;
            $('shareLinkInput').value = url.href; $('shareLinkBox').hidden = false;
            try { await navigator.clipboard.writeText(url.href); $('copyStatus').textContent = 'Player link copied.'; }
            catch { $('shareLinkInput').focus(); $('shareLinkInput').select(); $('copyStatus').textContent = 'Your link is ready. Copy it from the field below.'; }
        } catch (e) { if (generation === run) $('copyStatus').textContent = 'Could not create the share link: ' + e.message; }
        finally { if (generation === run) $('shareBtn').disabled = busy || !shareJobId; }
    }
    $('shareBtn').addEventListener('click', shareReport);
    $('identityForm').addEventListener('submit', event => {
        event.preventDefault(); const parsed = readReportInput($('reportInput').value); query.name = $('nameInput').value.trim(); query.server = $('serverInput').value.trim().toLowerCase(); query.region = $('regionInput').value; query.report = parsed.report; query.fightId = $('fightInput').value.trim() || parsed.fightId; query.sourceId = $('sourceInput').value.trim() || parsed.sourceId; query.race = $('raceInput').value.trim(); query.talentsString = $('talentsInput').value.trim(); updateUrl(); syncInputs(); resetReport(); $('errorBox').hidden = true; setBusy(false); loadNights(); if (canBuild()) build(false);
    });
    $('refreshBtn').addEventListener('click', () => build(true));
    $('nightSelect').addEventListener('change', event => { if (!event.target.value || event.target.value === query.report) return; query.report = event.target.value; query.fightId = ''; query.sourceId = ''; updateUrl(); resetReport(); setBusy(false); build(false); });
    const initialPull = readReportInput(query.report); if (initialPull.report !== query.report) { query.report = initialPull.report; query.fightId = query.fightId || initialPull.fightId; query.sourceId = query.sourceId || initialPull.sourceId; }
    syncInputs(); $('playerTitle').textContent = query.name || 'Player evaluation'; setBusy(false); loadNights(); if (canBuild()) build(false);
}());
