(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TacticsLessonRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    function wrap(ctx, value, width) {
        const words = String(value || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        const lines = [], current = [];
        words.forEach(word => {
            const next = current.concat(word).join(' ');
            if (current.length && ctx.measureText(next).width > width) { lines.push(current.join(' ')); current.length = 0; }
            current.push(word);
        });
        if (current.length) lines.push(current.join(' '));
        return lines;
    }
    const textHeight = (lines, lineHeight) => Math.max(lineHeight, lines.length * lineHeight);
    function layout(ctx, width, height, lesson) {
        const inset = width < 700 ? 14 : 22, contentWidth = Math.max(80, width - inset * 2);
        ctx.font = '600 24px "Barlow Condensed", sans-serif';
        const titleLines = wrap(ctx, lesson.title, contentWidth - 28);
        ctx.font = '400 17px "IBM Plex Sans", sans-serif';
        const detailLines = wrap(ctx, lesson.detail, contentWidth - 28);
        const tipLines = lesson.tip ? wrap(ctx, lesson.tip, contentWidth - 46) : [];
        const headerHeight = Math.max(94, inset + 25 + titleLines.length * 26 + 5 + Math.max(0, detailLines.length - 1) * 20 + (tipLines.length ? 9 + Math.max(0, tipLines.length - 1) * 18 : 0) + 14);
        const columnCount = width >= 760 ? Math.min(4, Math.max(1, lesson.rows.length)) : 1;
        const columnWidth = (contentWidth - 10 * (columnCount - 1)) / columnCount;
        const rows = lesson.rows.map(([role, job]) => {
            ctx.font = '600 12px "IBM Plex Sans", sans-serif'; const roleLines = wrap(ctx, role, columnWidth - 24);
            ctx.font = '400 15px "IBM Plex Sans", sans-serif'; const jobLines = wrap(ctx, job, columnWidth - 24);
            return { role, job, roleLines, jobLines, height: roleLines.length * 14 + 3 + jobLines.length * 18 };
        });
        const columns = lesson.recap ? [] : Array.from({ length: columnCount }, () => []);
        if (!lesson.recap) rows.forEach((row, index) => columns[index % columns.length].push(row));
        const roleHeight = Math.max(0, ...columns.map(column => column.reduce((sum, row) => sum + row.height + 7, 0)));
        ctx.font = '400 15px "IBM Plex Sans", sans-serif'; const warningLines = lesson.warning ? wrap(ctx, lesson.warning, contentWidth - 24) : [];
        const footerHeight = Math.max(54, warningLines.length ? 55 + roleHeight + Math.max(0, warningLines.length - 1) * 17 : 18 + roleHeight);
        const actionY = headerHeight + 8, actionHeight = Math.max(0, height - actionY - footerHeight - 8);
        return { inset, header: { x: inset, y: inset, w: contentWidth, h: headerHeight - inset, titleLines, detailLines, tipLines }, footer: { x: inset, y: height - footerHeight, w: contentWidth, h: footerHeight, rows, columns, warningLines, columnCount }, action: { x: 0, y: actionY, w: width, h: actionHeight }, overviewCards: lesson.recap ? lesson.rows.map(([role, job]) => ({ role, job })) : [] };
    }
    function panel(ctx, rect, stroke) {
        ctx.save(); ctx.fillStyle = 'rgba(7, 13, 10, .88)'; ctx.strokeStyle = stroke || 'rgba(108, 146, 122, .54)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    function lines(ctx, values, x, y, lineHeight, colour) { ctx.fillStyle = colour; values.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight)); return y + values.length * lineHeight; }
    function drawOverview(ctx, rect, cards) {
        const gap = 10, columns = rect.w > 760 ? 2 : 1, rows = Math.ceil(cards.length / columns);
        const cardWidth = Math.min(430, (rect.w - 32 - gap * (columns - 1)) / columns), cardHeight = Math.max(58, Math.min(94, (rect.h - 28 - gap * (rows - 1)) / rows));
        const startX = (rect.w - (cardWidth * columns + gap * (columns - 1))) / 2, startY = rect.y + Math.max(14, (rect.h - (cardHeight * rows + gap * (rows - 1))) / 2);
        cards.forEach((card, index) => {
            const column = index % columns, row = Math.floor(index / columns), box = { x: startX + column * (cardWidth + gap), y: startY + row * (cardHeight + gap), w: cardWidth, h: cardHeight };
            panel(ctx, box, 'rgba(255, 173, 103, .56)'); ctx.font = '600 17px "Barlow Condensed", sans-serif'; const role = wrap(ctx, card.role, box.w - 24);
            ctx.font = '400 15px "IBM Plex Sans", sans-serif'; const job = wrap(ctx, card.job, box.w - 24);
            lines(ctx, role, box.x + 12, box.y + 19, 18, '#ffd4aa'); lines(ctx, job, box.x + 12, box.y + 39, 17, '#d6dfd8');
        });
    }
    function draw(api, lesson, box) {
        const { ctx } = api; ctx.save(); ctx.textBaseline = 'alphabetic'; panel(ctx, box.header);
        ctx.font = '600 24px "Barlow Condensed", sans-serif'; let y = lines(ctx, box.header.titleLines, box.header.x + 14, box.header.y + 25, 26, '#f0eadc') + 5;
        ctx.font = '400 17px "IBM Plex Sans", sans-serif'; y = lines(ctx, box.header.detailLines, box.header.x + 14, y, 20, '#c8d2ca');
        if (box.header.tipLines.length) { ctx.font = '600 14px "IBM Plex Sans", sans-serif'; lines(ctx, box.header.tipLines, box.header.x + 24, y + 9, 18, '#ffcf9e'); }
        panel(ctx, box.footer); const roleWidth = box.footer.w - 24, columnWidth = (roleWidth - 10 * (box.footer.columnCount - 1)) / box.footer.columnCount;
        box.footer.columns.forEach((column, columnIndex) => { let y = box.footer.y + 17, x = box.footer.x + 12 + columnIndex * (columnWidth + 10); column.forEach(row => { ctx.font = '600 12px "IBM Plex Sans", sans-serif'; y = lines(ctx, row.roleLines, x, y, 14, '#ffcf9e') + 3; ctx.font = '400 15px "IBM Plex Sans", sans-serif'; y = lines(ctx, row.jobLines, x, y, 18, '#d6dfd8') + 7; }); });
        if (box.footer.warningLines.length) { const warningY = box.footer.y + 17 + Math.max(0, ...box.footer.columns.map(column => column.reduce((sum, row) => sum + row.height + 7, 0))) + 4; ctx.font = '600 12px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#ffad67'; ctx.fillText('WATCH OUT', box.footer.x + 12, warningY); ctx.font = '400 15px "IBM Plex Sans", sans-serif'; lines(ctx, box.footer.warningLines, box.footer.x + 12, warningY + 20, 17, '#ffd4aa'); }
        if (lesson.recap && box.overviewCards.length) drawOverview(ctx, box.action, box.overviewCards); ctx.restore();
    }
    return { layout, draw, wrap };
}));
