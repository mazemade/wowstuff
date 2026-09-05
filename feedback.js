'use strict';
/* global VetEngine */
(function () {
    const params = new URLSearchParams(location.search);
    const q = { name: params.get('name') || '', server: (params.get('server') || '').toLowerCase(), region: (params.get('region') || 'eu').toLowerCase(), zone: params.get('zone') || '1060', report: params.get('report') || '', thresholds: params.get('thresholds') || '' };
    const key = () => 'raidFeedback:' + encodeURIComponent(q.region) + '/' + encodeURIComponent(q.server) + '/' + encodeURIComponent(q.name.toLowerCase()) + '/' + encodeURIComponent(q.zone) + '/' + encodeURIComponent(q.report || 'all');
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
    function rowEl(r, n) {
        const mark = { fail: '✗', warn: '!', pass: '✓', info: '·' }[r.verdict] || '·';
        const div = document.createElement('div'); div.className = 'report-row ' + r.verdict;
        // spec §6: Fix first is numbered in render order (1., 2., 3.); every other card stays
        // unnumbered. The number is an addition inside the second (1fr) grid column, ahead of the
        // text — it never touches the 1.4em .mark column, so other cards' alignment is untouched.
        const num = n != null ? '<span class="num">' + n + '.</span> ' : '';
        div.innerHTML = '<span class="mark">' + mark + '</span><span>' + num + '<span class="text">' + escapeHtml(r.text) + '.</span>' + (r.value != null ? '<span class="value">~' + r.value + '% of the gap</span>' : '') + (r.fix ? '<span class="fix">' + escapeHtml(r.fix) + '</span>' : '') + '</span>';
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
        $('nightSelect').addEventListener('change', e => { const u = new URL(location.href); if (e.target.value) u.searchParams.set('report', e.target.value); else u.searchParams.delete('report'); location.href = u.toString(); });
        load(false);
    });
})();
