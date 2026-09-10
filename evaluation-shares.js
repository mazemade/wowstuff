'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const TOKEN = /^[a-f0-9]{48}$/;

function shareDirectory(options = {}) {
    return options.directory || process.env.EVALUATION_SHARE_DIR ||
        (process.env.RAILWAY_VOLUME_MOUNT_PATH
            ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'evaluation-shares')
            : path.join(os.tmpdir(), 'wowstuff-evaluation-shares'));
}

class EvaluationShares {
    constructor(options = {}) {
        this.directory = shareDirectory(options);
        this.ready = fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
            .then(() => fs.chmod(this.directory, 0o700));
    }
    file(token) { return path.join(this.directory, token + '.json'); }
    async create(result) {
        // Stringifying before allocating a token makes the stored bytes the exact immutable
        // report snapshot. This route never accepts a report payload from a client.
        const snapshot = JSON.stringify(result);
        if (snapshot === undefined) throw new Error('Cannot share an empty evaluation.');
        await this.ready;
        for (let attempts = 0; attempts < 10; attempts++) {
            const token = crypto.randomBytes(24).toString('hex');
            const target = this.file(token);
            const temporary = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
            try {
                await fs.writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' });
                // link is an atomic create-without-replacement, so an astronomically unlikely
                // token collision cannot replace someone else's report.
                await fs.link(temporary, target);
                await fs.unlink(temporary);
                return token;
            } catch (err) {
                await fs.unlink(temporary).catch(() => {});
                if (err.code === 'EEXIST') continue;
                throw err;
            }
        }
        throw new Error('Could not allocate a share link.');
    }
    async get(token) {
        if (!TOKEN.test(token || '')) return null;
        await this.ready;
        try {
            const result = JSON.parse(await fs.readFile(this.file(token), 'utf8'));
            return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
        } catch (_) {
            return null;
        }
    }
}

function shareHeaders(res) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('Referrer-Policy', 'no-referrer');
}

function installEvaluationShareRoutes(app, jobs, allowed, options = {}) {
    const shares = options.shares || new EvaluationShares({ directory: options.shareDirectory });
    app.post('/api/vet/evaluation/:id/share', async (req, res) => {
        if (!allowed(req, res)) return;
        if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
        try {
            const job = await jobs.get(req.params.id);
            if (!job || job.status !== 'complete' || !job.result) return res.status(404).json({ error: 'Evaluation is not available to share.' });
            const token = await shares.create(job.result);
            res.set('Cache-Control', 'no-store').status(201).json({ token, url: '/shared-evaluation.html#' + token });
        } catch (_) {
            res.status(503).json({ error: 'Evaluation sharing is unavailable.' });
        }
    });
    app.get('/api/shared-evaluation/:token', async (req, res) => {
        shareHeaders(res);
        try {
            const result = await shares.get(req.params.token);
            if (!result) return res.status(404).json({ error: 'Shared evaluation not found.' });
            res.json({ result });
        } catch (_) {
            res.status(503).json({ error: 'Evaluation sharing is unavailable.' });
        }
    });
    return shares;
}

module.exports = { TOKEN, shareDirectory, EvaluationShares, installEvaluationShareRoutes };
