(function () {
    'use strict';
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    function showIfNeeded() {
        const fights = window.TacticsData.FIGHTS, route = window.TacticsRaids.route(location.search, fights);
        if (route.fight) { document.querySelector('.brief').hidden = false; return false; }
        const hub = document.getElementById('tacticsHub');
        hub.hidden = false;
        document.body.classList.add('is-hub');
        const raid = route.raid;
        document.title = (raid ? raid.name : 'Raid tactics') + ' — guided briefings';
        document.getElementById('hubTitle').textContent = raid ? raid.name : 'Know the fight.';
        document.getElementById('hubIntro').textContent = raid ? 'Choose a boss. Walk through the positions, the mechanics, and your job.' : 'Choose your raid. Bring a clear plan to every pull.';
        document.getElementById('hubEyebrow').textContent = raid ? raid.location + ' / Boss briefings' : 'The Burning Crusade / Raid tactics';
        document.getElementById('hubBack').hidden = !raid;
        if (route.invalid) {
            document.getElementById('hubNotice').hidden = false;
            document.getElementById('hubNotice').textContent = 'That briefing could not be found. Choose a raid or boss below.';
        }
        const content = document.getElementById('hubContent');
        content.className = raid ? 'encounter-grid' : 'raid-grid';
        if (raid) {
            document.getElementById('hubHeader').style.setProperty('--raid-image', 'url("' + raid.image + '")');
            document.getElementById('hubHeader').classList.add('hub-header--raid');
            raid.fights.filter(id => Object.hasOwn(fights, id)).forEach((id, index) => {
                const fight = fights[id], card = element('a', 'encounter-card');
                card.href = '?fight=' + id;
                const portrait = element('img', 'encounter-card__portrait'); portrait.src = fight.portrait; portrait.alt = ''; portrait.width = 72; portrait.height = 72;
                const copy = element('div', 'encounter-card__copy');
                copy.append(element('span', 'eyebrow', 'Briefing ' + String(index + 1).padStart(2, '0')), element('h2', '', fight.name), element('p', '', fight.scenes[0].title));
                const arrow = element('span', 'card-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true');
                card.append(portrait, copy, arrow); content.append(card);
            });
        } else Object.values(window.TacticsRaids.raids).forEach(raid => {
            const card = element('a', 'raid-card raid-card--' + raid.id); card.href = '?raid=' + raid.id;
            const artwork = element('img', 'raid-card__image'); artwork.src = raid.image; artwork.alt = ''; artwork.width = 1200; artwork.height = 800;
            const copy = element('div', 'raid-card__copy');
            copy.append(element('span', 'eyebrow', raid.location), element('h2', '', raid.name), element('p', '', raid.description));
            const foot = element('div', 'raid-card__foot');
            foot.append(element('span', '', raid.fights.filter(id => Object.hasOwn(fights, id)).length + ' guided briefings'), element('span', '', 'Choose a boss ↗'));
            card.append(artwork, copy, foot); content.append(card);
        });
        return true;
    }
    window.TacticsHub = { showIfNeeded };
}());
