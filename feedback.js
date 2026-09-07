'use strict';
/* global VetEngine */
(function () {
    const params = new URLSearchParams(location.search);
    const q = { name: params.get('name') || '', server: (params.get('server') || '').toLowerCase(), region: (params.get('region') || 'eu').toLowerCase(), zone: params.get('zone') || '1060',
                report: params.get('report') || '', all: params.get('all') === '1', thresholds: params.get('thresholds') || '' };
    const key = () => 'raidFeedback:' + encodeURIComponent(q.region) + '/' + encodeURIComponent(q.server) + '/' + encodeURIComponent(q.name.toLowerCase()) + '/' + encodeURIComponent(q.zone) + '/' + encodeURIComponent(q.report || 'all');
    // logs-first A4: the night list is cached apart from any analysis — it is what the bare URL
    // shows, and it costs five WCL requests, not 140.
    const NIGHTS_TTL = 15 * 60 * 1000;
    const nightsKey = () => 'raidFeedbackNights:' + encodeURIComponent(q.region) + '/' + encodeURIComponent(q.server) + '/' + encodeURIComponent(q.name.toLowerCase()) + '/' + encodeURIComponent(q.zone);
    const shortTier = z => (/^[^\s/]+/.exec(z || '') || [z || ''])[0];
    const $ = id => document.getElementById(id);
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    // factsTable(facts) — pasted from vetting.js (lines 469-506).
    function factsTable(facts) {
        const t = document.createElement('table');
        t.className = 'facts-table';
        // Minor 11 / carried finding: label the column by metric so a healer's HPS is not shown under
        // a header literally saying "DPS" (the same mislabelling the me.dps -> me.amount rename in
        // vet-feedback.js was meant to remove, just moved from the model's prose into this header).
        const metricLabel = facts.player.metric === 'hps' ? 'HPS' : 'DPS';
        t.innerHTML = '<tr><th>Boss</th><th>Parse</th><th>Length</th><th>Active</th><th>Raid rank</th><th>' + metricLabel + ' vs band</th><th>Crit %</th><th>Gap</th><th>Pull consumables</th><th>Log</th></tr>';
        const multi = new Set(facts.kills.map(k => k.name)).size < facts.kills.length;
        facts.kills.forEach(k => {
            const tr = document.createElement('tr');
            if (k.fight.badPull) { tr.className = 'bad-pull'; tr.title = k.fight.badPullReason; }
            else if (k.gap) { tr.title = ['casts', 'dmg', 'crit'].flatMap(f => k.gap.factors[f].inputs.map(i => i.key + ' (' + i.owner + ') ' + i.share + '%')).join('\n'); }
            const ref = k.reference;
            const topMe = k.me.abilities[0], topRef = ref && topMe ? ref.abilities.find(a => a.name === topMe.name) : null;
            const fmt = x => (x == null ? '—' : x);
            const cells = [
                escapeHtml(k.name) + (k.killsOnBoss > 1 ? ' <span class="cell-unknown">(kill ' + escapeHtml(String(k.killIndex)) + ' of ' + escapeHtml(String(k.killsOnBoss)) + ' kills)</span>' : '') +
                    (k.fight.badPull ? ' <span class="cell-unknown">(bad pull)</span>' : '') +
                    (multi && k.date ? ' <span class="cell-unknown">' + escapeHtml(k.date) + '</span>' : ''),
                fmt(k.rankPercent == null ? null : Math.round(k.rankPercent)),
                fmt(k.fight.durationSec == null ? null : Math.round(k.fight.durationSec) + 's') + (ref && ref.durationSec != null ? ' / ' + Math.round(ref.durationSec) + 's' : ''),
                fmt(k.me.activePercent == null ? null : k.me.activePercent + '%'),
                k.fight.raidGroupRank ? k.fight.raidGroupRank + ' of ' + k.fight.raidGroupCount : '—',
                // Defensive rather than a live bug today: a reference only exists once >= 3 in-band
                // ranks were collected, and both fields are medians over that non-empty array. Guarded
                // anyway to match the fmt() treatment the neighbouring cells get.
                fmt(k.me.amount) + (ref && ref.dps != null ? ' / ' + ref.dps : ''),
                topMe && topMe.critPercent != null ? escapeHtml(topMe.name) + ' ' + topMe.critPercent + '%' + (topRef && topRef.critPercent != null ? ' / ' + topRef.critPercent + '%' : '') : '—',
                k.gap ? escapeHtml('casts ' + k.gap.factors.casts.share + '% · per cast ' + k.gap.factors.dmg.share + '% · crit ' + k.gap.factors.crit.share + '% · unexplained ' + k.gap.factors.residual.share + '%') : '—',
                k.me.consumablesKnown ? (k.me.consumablesAtPull.length ? escapeHtml(k.me.consumablesAtPull.join(', ')) : '<span class="slot-missing">none</span>') : '<span class="cell-unknown">unknown</span>',
                '<a href="' + escapeHtml(k.wclUrl) + '" target="_blank" rel="noopener">WCL</a>',
            ];
            tr.innerHTML = cells.map(c => '<td>' + c + '</td>').join('');
            t.appendChild(tr);
        });
        return t;
    }

    let current = null;
    function readCache() {
        try {
            const c = JSON.parse(localStorage.getItem(key()));
            // Belt-and-suspenders against a stale/foreign key format (or a pre-encoding key from
            // before this fix) rendering another player's cached report: only trust a cache hit
            // whose own facts actually name the player this page was opened for.
            if (c && c.facts && c.facts.player && typeof c.facts.player.name === 'string' && c.facts.player.name.toLowerCase() === q.name.toLowerCase()) return c;
            return null;
        } catch (e) { return null; }
    }
    function writeCache(body) { try { localStorage.setItem(key(), JSON.stringify(Object.assign({}, body, { fetchedAt: Date.now() }))); } catch (e) { /* quota: the page still renders */ } }
    function apiUrl() {
        return '/api/vet/feedback?name=' + encodeURIComponent(q.name) + '&server=' + encodeURIComponent(q.server) + '&region=' + encodeURIComponent(q.region) + '&zone=' + encodeURIComponent(q.zone) +
               (q.report ? '&report=' + encodeURIComponent(q.report) : '') + (q.thresholds ? '&thresholds=' + encodeURIComponent(q.thresholds) : '');
    }
    function nightsUrl() {
        return '/api/vet/nights?name=' + encodeURIComponent(q.name) + '&server=' + encodeURIComponent(q.server) + '&region=' + encodeURIComponent(q.region) + '&zone=' + encodeURIComponent(q.zone);
    }
    // One renderer for both states: the bare page (nothing selected) and a finished analysis
    // (its night, or 'all', selected). Nights are labelled with their tier — the list now spans
    // BT / Hyjal and SSC / TK.
    function renderPicker(nights, selected) {
        const sel = $('nightSelect');
        sel.classList.remove('hidden');
        const label = n => n.date + ' · ' + shortTier(n.zoneName) + ' · ' + n.bosses.length + (n.bosses.length === 1 ? ' boss' : ' bosses') + ' · median ' + (n.medianPercent == null ? '—' : Math.round(n.medianPercent));
        sel.innerHTML = '<option value="">Choose a raid night…</option>' +
            '<option value="all"' + (nights.length ? '' : ' disabled') + '>Across all kills' + (nights.length ? '' : ' (no ranked kills)') + '</option>' +
            nights.map(n => '<option value="' + escapeHtml(n.code) + '">' + escapeHtml(label(n)) + '</option>').join('');
        sel.value = selected;
    }
    function showPicker(body) {
        $('errorBox').classList.add('hidden');
        $('title').textContent = q.name + ' — feedback report';
        const nights = Array.isArray(body.nights) ? body.nights : [];
        renderPicker(nights, '');
        $('statusLine').textContent = nights.length ? 'Choose a raid night, or analyse across all kills.' : 'No ranked kills on Warcraft Logs for ' + q.name + ' in either tier.';
    }
    async function loadNights(force) {
        let cached = null;
        if (!force) { try { const c = JSON.parse(localStorage.getItem(nightsKey())); if (c && Array.isArray(c.nights) && Date.now() - c.fetchedAt < NIGHTS_TTL) cached = c; } catch (e) { cached = null; } }
        if (cached) { showPicker(cached); return; }
        $('statusLine').textContent = 'Reading ' + q.name + '’s raid nights from Warcraft Logs…';
        $('refreshBtn').disabled = true;
        try {
            const res = await fetch(nightsUrl());
            const body = await res.json().catch(() => ({}));
            if (res.status === 429) { showError('Warcraft Logs rate limit reached — try again in a few minutes.'); return; }
            if (!res.ok) { showError(body.error || ('HTTP ' + res.status)); return; }
            try { localStorage.setItem(nightsKey(), JSON.stringify(Object.assign({}, body, { fetchedAt: Date.now() }))); } catch (e) { /* quota: the page still renders */ }
            showPicker(body);
        } catch (err) { showError('Network error: ' + err.message); }
        finally { $('refreshBtn').disabled = false; }
    }
    async function load(force) {
        if (!q.report && !q.all) return loadNights(force);
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
    function rowEl(r, n) {
        const mark = { fail: '✗', warn: '!', pass: '✓', info: '·' }[r.verdict] || '·';
        const div = document.createElement('div'); div.className = 'report-row ' + r.verdict;
        // spec §6: Fix first is numbered in render order (1., 2., 3.); every other card stays
        // unnumbered. The number is an addition inside the second (1fr) grid column, ahead of the
        // text — it never touches the 1.4em .mark column, so other cards' alignment is untouched.
        const num = n != null ? '<span class="num">' + n + '.</span> ' : '';
        // Critical 2 (whole-branch review): this card view is the primary UI ("Copy text" is
        // secondary), and it used to print r.value raw — so a share of 169 reached the screen as
        // "~169% of the gap" even after renderReport() in vet-checklist.js learned to drop it.
        // There is now ONE rule, not two: vet-checklist.js's row()/displayShare decides what a
        // share may show and stamps it on every row as `displayValue`; this renderer and
        // renderReport() both read that field, so they cannot drift again. A shared helper is not
        // possible here — vet-checklist.js is a CommonJS module that requires vet-gap.js at load
        // and is never served to the browser (feedback.html loads only assignments-engine.js,
        // vet-engine.js and this file) — so the rule is shared as data on the row instead.
        // A body restored from an older localStorage cache carries no displayValue and simply
        // shows no badge, which is the safe direction; Refresh restores it.
        const shown = r.displayValue != null ? '<span class="value">~' + r.displayValue + '% of the gap</span>' : '';
        div.innerHTML = '<span class="mark">' + mark + '</span><span>' + num + '<span class="text">' + escapeHtml(r.text) + '.</span>' + shown + (r.fix ? '<span class="fix">' + escapeHtml(r.fix) + '</span>' : '') + '</span>';
        return div;
    }
    function card(title, rows, wide, more, numbered) {
        const c = document.createElement('div'); c.className = 'report-card' + (wide ? ' wide' : '');
        c.innerHTML = '<h3>' + escapeHtml(title) + '</h3>';
        rows.forEach((r, i) => c.appendChild(rowEl(r, numbered ? i + 1 : null)));
        if (more && more.length) { const d = document.createElement('details'); d.className = 'report-more'; d.innerHTML = '<summary>' + more.length + ' more</summary>'; more.forEach(r => d.appendChild(rowEl(r))); c.appendChild(d); }
        return c;
    }
    function render(body) {
        current = body;
        const facts = body.facts, cl = facts.overall.checklist, byId = id => cl.rows.find(r => r.id === id);
        $('errorBox').classList.add('hidden');
        const tiers = Array.isArray(facts.tiers) && facts.tiers.length ? facts.tiers : [facts.tier];
        $('title').textContent = facts.player.name + ' — ' + (facts.player.spec || '?') + ', ' + (facts.night && facts.night.zoneName ? facts.night.zoneName : tiers[0].zoneName);
        // logs-first A2: across kills, the two tiers' own WCL medians side by side — never a blend.
        $('statusLine').textContent = facts.night
            ? 'Raid night of ' + facts.night.date + (facts.night.zoneName ? ' (' + facts.night.zoneName + ')' : '') + ', median parse that night ' + Math.round(facts.night.medianPercent)
            : 'Median parse across kills: ' + tiers.map(t => t.zoneName + ' ' + Math.round(t.medianPercent)).join(' · ');
        $('stamp').textContent = body.generatedAt ? 'Generated ' + new Date(body.generatedAt).toLocaleString() : '';
        $('copyBtn').disabled = false;
        renderPicker(Array.isArray(facts.nights) ? facts.nights : [], q.report || (q.all ? 'all' : ''));
        // Worst pull link
        const worst = facts.kills.filter(k => !k.fight.badPull).sort((a, b) => (a.rankPercent == null ? 101 : a.rankPercent) - (b.rankPercent == null ? 101 : b.rankPercent))[0];
        if (worst && worst.wclUrl) { $('wclLink').href = worst.wclUrl; $('wclLink').classList.remove('hidden'); }
        // Verdict
        const v = cl.verdict, vb = $('verdict');
        if (v) { vb.textContent = body.report.split('\n')[1]; vb.classList.remove('hidden'); } else vb.classList.add('hidden');
        // Cards
        const cards = $('cards'); cards.innerHTML = '';
        const player = cl.rows.filter(r => r.owner === 'player'), listed = new Set(cl.fixFirst.concat(cl.also));
        if (cl.fixFirst.length) cards.appendChild(card(facts.limited ? "What's holding your healing back" : 'Fix first', cl.fixFirst.map(byId), true, null, true));
        const alsoMore = player.filter(r => !listed.has(r.id) && r.verdict !== 'pass');
        if (cl.also.length || alsoMore.length) cards.appendChild(card('Also', cl.also.map(byId), false, alsoMore));
        const group = cl.rows.filter(r => r.owner === 'group'), askMore = group.filter(r => !cl.asks.includes(r.id) && r.verdict !== 'pass');
        if (cl.asks.length || askMore.length) cards.appendChild(card('Ask your raid leader', cl.asks.map(byId), false, askMore));
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
        $('nightSelect').addEventListener('change', e => {
            const u = new URL(location.href);
            u.searchParams.delete('report'); u.searchParams.delete('all');
            if (e.target.value === 'all') u.searchParams.set('all', '1');
            else if (e.target.value) u.searchParams.set('report', e.target.value);
            else return;
            location.href = u.toString();
        });
        load(false);
    });
})();
