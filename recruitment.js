/* global RecruitmentEngine, AssignmentsEngine */
'use strict';
const RecruitmentUI = (() => {
    let latest = null;
    let version = 0;
    const el = id => document.getElementById('recruitment' + id);
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    const className = cls => cls.charAt(0) + cls.slice(1).toLowerCase();
    const specName = p => p.spec === 'Guardian' ? 'Feral (bear) Druid' : p.spec + ' ' + className(p.class);
    const roleName = role => ({ tank: 'Tank', healer: 'Healer', dps: 'DPS' })[role];

    function copyText(result) {
        const current = result.current;
        return [
            result.profile.name + ' — ' + (current.tanks + current.healers + current.dps + current.unknown) + '/' + result.profile.size,
            'Targets: ' + result.targets.tanks + ' tanks, ' + result.targets.healers + ' healers, ' + result.targets.dps + ' DPS.',
            ...result.recommendations.map((p, i) => (i + 1) + '. ' + specName(p) + ' (' + roleName(p.role) + ') — ' + p.reasons.join(' ')),
            ...result.warnings.map(w => 'Check: ' + w),
            ...result.notes.map(n => 'Preparation: ' + n),
            'Composition advice; assumes comparable gear/skill and standard raid talents. Confirm specialist preparation.',
        ].join('\n');
    }

    function init(onChange) {
        RecruitmentEngine.PROFILES.forEach(profile => {
            const option = node('option', profile.name);
            option.value = profile.id;
            el('Raid').appendChild(option);
        });
        const defaults = () => onChange({ raidId: el('Raid').value });
        el('Raid').addEventListener('change', defaults);
        el('Reset').addEventListener('click', defaults);
        ['Tanks', 'Healers'].forEach(key => el(key).addEventListener('change', () => {
            const read = id => el(id).value.trim() === '' ? undefined : Number(el(id).value);
            onChange({ raidId: el('Raid').value, tanks: read('Tanks'), healers: read('Healers') });
        }));
        el('Copy').addEventListener('click', async () => {
            if (!latest) return;
            const text = copyText(latest);
            const copyVersion = version;
            try {
                await navigator.clipboard.writeText(text);
                if (copyVersion === version) el('CopyStatus').textContent = 'Invite list copied.';
            } catch {
                if (copyVersion !== version) return;
                el('CopyText').textContent = text;
                el('CopyText').classList.remove('hidden');
                el('CopyStatus').textContent = 'Clipboard unavailable. Select and copy the invite list below.';
            }
        });
    }

    function render(roster, settings) {
        const result = RecruitmentEngine.recommend(roster, settings || {});
        latest = result;
        version++;
        el('Raid').value = result.profile.id;
        el('Tanks').value = result.targets.tanks;
        el('Healers').value = result.targets.healers;
        el('Copy').disabled = !roster.length || !result.recommendations.length;
        el('CopyStatus').textContent = '';
        el('CopyText').textContent = '';
        el('CopyText').classList.add('hidden');
        const summary = el('Summary');
        summary.replaceChildren();
        summary.appendChild(node('strong', roster.length + ' / ' + result.profile.size, 'recruitment-count'));
        summary.appendChild(node('span', !roster.length ? 'Import a roster to find your next invites.'
            : result.openSlots ? result.openSlots + (result.openSlots === 1 ? ' open slot · suggested invite below' : ' open slots · suggested invites below')
            : roster.length > result.profile.size ? 'Over capacity · review your roster before inviting'
            : 'No open slots · review any remaining gaps below'));

        const roles = el('Roles');
        roles.replaceChildren();
        if (roster.length) {
            [['tanks', 'Tanks'], ['healers', 'Healers'], ['dps', 'DPS']].forEach(([key, label]) => {
                const box = node('div', undefined, 'recruitment-role');
                box.appendChild(node('span', label));
                box.appendChild(node('strong', result.current[key] + ' → ' + result.projected[key]));
                box.appendChild(node('small', 'Now → with invites · target ' + result.targets[key]));
                roles.appendChild(box);
            });
            if (result.current.unknown) roles.appendChild(node('p', result.current.unknown + ' unresolved ' + (result.current.unknown === 1 ? 'role' : 'roles') + ' · edit these players in the roster above.', 'recruitment-unresolved'));
        }
        const warnings = el('Warnings');
        warnings.replaceChildren();
        warnings.classList.toggle('hidden', !roster.length || !result.warnings.length);
        result.warnings.forEach(w => warnings.appendChild(node('p', w)));
        const list = el('List');
        list.replaceChildren();
        if (roster.length) result.recommendations.forEach((p, i) => {
            const row = node('li', undefined, 'recruitment-invite');
            row.style.setProperty('--class-color', AssignmentsEngine.CLASS_COLORS[p.class] || '#ddd');
            row.appendChild(node('span', String(i + 1).padStart(2, '0'), 'recruitment-rank'));
            const who = node('div', undefined, 'recruitment-who');
            who.appendChild(node('strong', specName(p)));
            who.appendChild(node('span', roleName(p.role), 'recruitment-role-label'));
            row.appendChild(who);
            row.appendChild(node('p', p.reasons.join(' '), 'recruitment-reason'));
            list.appendChild(row);
        });
        el('Notes').replaceChildren(...result.notes.map(n => node('li', n)));
        el('Sources').replaceChildren();
        result.profile.sources.forEach(source => {
            const link = node('a', source.label);
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            el('Sources').appendChild(link);
        });
        return result;
    }
    return { init, render };
})();
