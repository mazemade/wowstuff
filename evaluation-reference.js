'use strict';

const fold = (value) =>
    String(value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase();
const realm = (value) => fold(value).replace(/[\s'-]/g, '');
const fightOf = (raw) => raw?.context?.fights?.find((f) => f.id === raw.fightId) || raw?.context?.fights?.[0];
function character(raw) {
    const actor = raw?.context?.masterData?.actors?.find((a) => a.id === raw.sourceId);
    return {
        name: fold(raw?.player?.name || actor?.name || raw?.name),
        server: realm(actor?.server || raw?.player?.server),
        region: fold(raw?.player?.region),
    };
}
function sameCharacter(a, b) {
    if (a.reportCode && a.reportCode === b.reportCode && a.sourceId === b.sourceId) return true;
    const x = character(a),
        y = character(b);
    // Unknown realms cannot establish that a same-name character is independent.
    return (
        !!x.name &&
        x.name === y.name &&
        !(x.server && y.server && x.server !== y.server) &&
        !(x.region && y.region && x.region !== y.region)
    );
}
function selectReferences(raw) {
    const accepted = [],
        excluded = [],
        ownFight = fightOf(raw);
    const duration = (f) => (f ? f.endTime - f.startTime : 0);
    const ordered = [...(raw.references || [])].sort(
        (a, b) =>
            Number(b.kind === 'benchmark') - Number(a.kind === 'benchmark') ||
            Math.abs(duration(fightOf(a)) - duration(ownFight)) - Math.abs(duration(fightOf(b)) - duration(ownFight)),
    );
    for (const ref of ordered) {
        const f = fightOf(ref);
        let reason;
        if (sameCharacter(raw, ref)) reason = 'Same character or independence cannot be established across uploads.';
        else if (accepted.some((other) => sameCharacter(other, ref)))
            reason = 'Duplicate character comparison; retained one independent example.';
        else if (ownFight?.name && f?.name !== ownFight.name) reason = 'Different encounter.';
        else if (typeof ownFight?.kill === 'boolean' && typeof f?.kill === 'boolean' && ownFight.kill !== f.kill)
            reason = 'Kill and wipe are not equivalent comparison outcomes.';
        else if (
            raw.player?.classToken &&
            ref.player?.classToken &&
            fold(raw.player.classToken) !== fold(ref.player.classToken)
        )
            reason = 'Different class.';
        else if (raw.player?.spec && ref.player?.spec && fold(raw.player.spec) !== fold(ref.player.spec))
            reason = 'Different specialization.';
        else if (raw.player?.role && ref.player?.role && raw.player.role !== ref.player.role)
            reason = 'Different role.';
        if (reason)
            excluded.push({
                name: ref.player?.name || ref.name,
                reportCode: ref.reportCode,
                fightId: ref.fightId,
                reason,
            });
        else accepted.push(ref);
    }
    accepted.sort(
        (a, b) =>
            Number(b.kind === 'benchmark') - Number(a.kind === 'benchmark') ||
            Math.abs(duration(fightOf(a)) - duration(ownFight)) - Math.abs(duration(fightOf(b)) - duration(ownFight)),
    );
    return { accepted, excluded };
}
module.exports = { selectReferences, sameCharacter, fightOf };
