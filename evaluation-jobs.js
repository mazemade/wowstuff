'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { installEvaluationShareRoutes } = require('./evaluation-shares.js');
const { readFileSync, readdirSync } = require('node:fs');
const { buildEvaluation, VERSION, REPORT_QUERY, ROLE_CONTEXT_QUERY, ROLE_PLAYER_QUERY } = require('./evaluation-service.js');
const F = require('./vet-feedback.js');
const DAY = 24 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function modelFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        if (entry.name === 'vendor') return [];
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? modelFiles(file) : /\.(json|go|sh)$/.test(file) ? [file] : [];
    });
}
const ENGINE_KEY = hash([VERSION, process.env.WCL_SIM_ITERATIONS || 'default',
    ...['evaluation-service.js', 'evaluation-reference.js', 'evaluation-investigation.js', 'evaluation-rogue-evidence.js', 'evaluation-hunter-evidence.js', 'evaluation-decision-evidence.js', 'evaluation-coaching.js', 'data/evaluation-on-use.json', 'evaluation-evidence.js', 'evaluation-role-evidence.js', 'evaluation-common-evidence.js', 'evaluation-damage-analysis.js', 'evaluation-paladin-evidence.js', 'evaluation-specs.js', 'evaluation-encounters.js', 'evaluation-models.js', 'evaluation-sim.js', 'vet-engine.js', 'vet-feedback.js', 'data/tbc-item-db.json'].map(file => path.join(__dirname, file)),
    ...modelFiles(path.join(__dirname, 'evaluation-sim')),
].map(value => path.isAbsolute(value) ? readFileSync(value, 'utf8') : value).join('\n'));

const REQUIRED_REPORT_FIELDS = new Map([[REPORT_QUERY, ['title', 'startTime', 'masterData', 'fights']], [ROLE_CONTEXT_QUERY, ['healAll', 'masterData']], [ROLE_PLAYER_QUERY, ['healing', 'damageTaken']], [F.FIGHT_QUERY, ['masterData', 'fights', 'rankings', 'dmgAll', 'deaths', 'summary', 'debuffs']], [F.PLAYER_QUERY, ['dmg', 'casts', 'buffs', 'ci']]]);
function cacheable(data, query) {
    if (!data || typeof data !== 'object') return false;
    const report = data.reportData?.report;
    if (report) {
        const expected = REQUIRED_REPORT_FIELDS.get(query);
        if (expected?.some(field => !(field in report))) return false;
        if (expected?.includes('masterData') && !Array.isArray(report.masterData?.actors)) return false;
        if (expected?.includes('fights') && !Array.isArray(report.fights)) return false;
        if ('events' in report && (!Array.isArray(report.events?.data) ||
            (report.events.nextPageTimestamp != null && !Number.isFinite(report.events.nextPageTimestamp)))) return false;
        for (const field of ['dmg', 'casts', 'buffs', 'ci', 'dmgAll', 'debuffs', 'healing', 'healAll', 'damageTaken']) {
            if (field in report && (report[field]?.data == null)) return false;
        }
        return Object.keys(report).length > 0;
    }
    return !!(data.characterData?.character || data.worldData?.encounter);
}

function validateIdentity(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Provide a character and raid night.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const server = typeof body.server === 'string' ? body.server.toLowerCase() : '';
    const region = typeof body.region === 'string' ? body.region.toLowerCase() : '';
    const zone = body.zone == null || body.zone === '' ? 1060 : Number(body.zone);
    const report = body.report || null;
    const direct = report !== null;
    if ((!direct || name) && !/^[^\s/\\"<>]{2,24}$/.test(name)) throw new Error('Invalid character name.');
    if (body.name != null && typeof body.name !== 'string') throw new Error('Invalid character name.');
    if ((!direct || server) && !/^[a-z0-9-]{2,40}$/.test(server)) throw new Error('Invalid server slug.');
    if ((!direct || region) && !/^(eu|us|kr|tw|cn)$/.test(region)) throw new Error('Invalid region.');
    if (!Number.isSafeInteger(zone) || zone < 1 || zone > 99999) throw new Error('Invalid raid zone.');
    if (direct && (typeof report !== 'string' || !/^[A-Za-z0-9]{16}$/.test(report))) throw new Error('Invalid report code.');
    const ids = {};
    for (const field of ['sourceId', 'fightId']) {
        if (body[field] == null || body[field] === '') continue;
        const value = Number(body[field]);
        if (!direct || !Number.isSafeInteger(value) || value < 1 || value > 10000000) throw new Error('Invalid ' + field + '. Use a positive ID with a report code.');
        ids[field] = value;
    }
    if (direct && !name && !ids.sourceId) throw new Error('Provide a player name or source ID for this report.');
    let modelOverrides;
    if (body.modelOverrides != null) {
        const value = body.modelOverrides;
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid model settings.');
        if (Object.keys(value).some(key => !['race', 'talentsString'].includes(key))) throw new Error('Unknown model setting.');
        modelOverrides = {};
        if (value.race != null && value.race !== '') {
            if (typeof value.race !== 'string' || !/^[A-Za-z ]{3,20}$/.test(value.race)) throw new Error('Invalid model race.');
            modelOverrides.race = value.race.trim();
        }
        if (value.talentsString != null && value.talentsString !== '') {
            if (typeof value.talentsString !== 'string' || !/^[0-5]{0,30}(?:-[0-5]{0,30}){1,2}$/.test(value.talentsString) || value.talentsString === '--') throw new Error('Invalid talent string. Use numeric talent trees separated by hyphens.');
            modelOverrides.talentsString = value.talentsString;
        }
        if (!Object.keys(modelOverrides).length) modelOverrides = undefined;
    }
    return { name, server, region, zone, report, ...ids, ...(modelOverrides ? { modelOverrides } : {}) };

}

class EvaluationJobs {
    constructor(deps, options = {}) {
        this.deps = deps;
        this.build = options.build || buildEvaluation;
        this.directory = options.directory || process.env.EVALUATION_CACHE_DIR || path.join(os.tmpdir(), 'wowstuff-evaluation');
        this.maxPending = options.maxPending || 4;
        this.maxJobs = options.maxJobs || 60;
        this.now = options.now || Date.now;
        this.jobs = new Map(); this.queue = []; this.running = false;
        this.queries = new Map(); this.starting = new Map(); this.finalizing = new Set();
        this.ready = fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    }
    file(id) { return path.join(this.directory, id + '.json'); }
    async read(id) {
        await this.ready;
        try { return JSON.parse(await fs.readFile(this.file(id), 'utf8')); } catch (_) { return null; }
    }
    async write(id, data) {
        await this.ready;
        const temp = this.file(id) + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
        await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 });
        await fs.rename(temp, this.file(id));
    }
    public(job) {
        return { id: job.id, status: this.finalizing.has(job.id) ? 'running' : job.status, progress: job.progress, result: job.result || undefined, error: job.error || undefined };
    }
    async get(id) {
        if (!/^[a-f0-9]{32}$/.test(id)) return null;
        let job = this.jobs.get(id);
        if (!job) {
            job = await this.read(id);
            if (!job || job.id !== id || job.engineKey !== ENGINE_KEY || this.now() - job.updatedAt > DAY) return null;
            if (job.status === 'running' || job.status === 'queued') {
                job.status = 'failed'; job.error = 'The server restarted before this evaluation finished. Start the evaluation again to retry.';
            }
            this.jobs.set(id, job);
        }
        return this.public(job);
    }
    async start(identity, force = false) {
        const id = hash(JSON.stringify([ENGINE_KEY, identity.region, identity.server, (identity.name || '').toLowerCase(), identity.zone, identity.report, identity.fightId || null, identity.sourceId || null, identity.modelOverrides?.race || null, identity.modelOverrides?.talentsString || null])).slice(0, 32);
        if (this.starting.has(id)) return this.starting.get(id);
        const pending = this.create(id, identity, force);
        this.starting.set(id, pending);
        try { return await pending; } finally { this.starting.delete(id); }
    }
    async create(id, identity, force) {
        const existing = await this.get(id);
        const stored = this.jobs.get(id);
        if (existing && ['queued', 'running'].includes(existing.status)) return existing;
        const partial = stored?.result?.partial || stored?.result?.fights?.some(f => f.simulation?.status === 'unavailable' || f.limitations?.some(x => /incomplete|interrupted|unavailable/i.test(x)));
        const ttl = partial ? 10 * 60 * 1000 : DAY;
        if (!force && existing?.status === 'complete' && this.now() - stored.updatedAt < ttl) return existing;
        if ([...this.jobs.values()].filter(j => ['queued', 'running'].includes(j.status)).length >= this.maxPending) {
            const error = new Error('The evaluation queue is full. Try again after the current evaluations finish.'); error.status = 429; throw error;
        }
        const job = { id, engineKey: ENGINE_KEY, identity, status: 'queued', updatedAt: this.now(), progress: { stage: 'queued', message: 'Waiting to analyse this raid night.', completed: 0, total: 0 } };
        this.jobs.set(id, job);
        try { await this.write(id, job); } catch (err) { this.jobs.delete(id); throw err; }
        this.queue.push(job);
        setImmediate(() => this.drain());
        return this.public(job);
    }
    async cachedQuery(q, vars) {
        const key = 'query-' + hash(JSON.stringify([q, vars]));
        if (this.queries.has(key)) return this.queries.get(key);
        const pending = (async () => {
            const cached = await this.read(key);
            if (cached && cacheable(cached.data, q) && this.now() - cached.at < DAY) return cached.data;
            const data = await this.deps.query(q, vars);
            // Null/private reports and malformed responses remain retryable.
            if (cacheable(data, q)) {
                await this.write(key, { at: this.now(), data });
            }
            return data;
        })();
        this.queries.set(key, pending);
        try { return await pending; } finally { this.queries.delete(key); }
    }
    async drain() {
        if (this.running) return;
        const job = this.queue.shift();
        if (!job) return;
        this.running = true;
        job.status = 'running';
        const deadline = this.now() + 20 * 60 * 1000;
        const checkDeadline = () => { if (this.now() > deadline) throw new Error('This evaluation exceeded its time budget. Completed query evidence is cached for a retry.'); };
        try {
            await this.write(job.id, job);
            job.result = await this.build(job.identity, { ...this.deps, query: (q, v) => { checkDeadline(); return this.cachedQuery(q, v); } }, (progress, result) => {
                checkDeadline(); job.progress = progress; if (result) job.result = result;
            });
            this.finalizing.add(job.id);
            job.status = 'complete';
            job.progress = { stage: 'complete', message: 'Evaluation ready.', completed: job.result.fights.length, total: job.result.fights.length };
        } catch (err) {
            this.finalizing.add(job.id);
            job.status = 'failed';
            // Return known application errors, never arbitrary upstream payloads or stack traces.
            job.error = err.code === 'NO_CREDS' ? 'Warcraft Logs credentials are not configured on this server.' :
                err.code === 'RATE_LIMIT' ? 'Warcraft Logs rate limit reached. Retry when the limit resets.' :
                err.code === 'EVALUATION_INPUT' || /^No ranked kills|^No readable kills|^Fight tables|^This evaluation exceeded/.test(err.message || '') ? err.message :
                'The evaluation could not finish. Completed evidence is cached; retry to continue.';
        } finally {
            job.updatedAt = this.now();
            try { await this.write(job.id, job); await this.prune(); } catch (_) { /* The in-memory report remains readable. */ }
            this.finalizing.delete(job.id);
            this.running = false;
            setImmediate(() => this.drain());
        }
    }
    async prune() {
        const idle = [...this.jobs.values()].filter(j => !['queued', 'running'].includes(j.status)).sort((a, b) => b.updatedAt - a.updatedAt);
        for (const j of idle.slice(this.maxJobs)) this.jobs.delete(j.id);
        const names = (await fs.readdir(this.directory)).filter(n => /^(query-[a-f0-9]{64}|[a-f0-9]{32})\.json$/.test(n));
        const files = await Promise.all(names.map(async name => ({ name, stat: await fs.stat(path.join(this.directory, name)).catch(() => null) })));
        files.sort((a, b) => (b.stat?.mtimeMs || 0) - (a.stat?.mtimeMs || 0));
        await Promise.all(files.filter((f, i) => f.stat && (this.now() - f.stat.mtimeMs > 2 * DAY || i >= 2000)).map(f => fs.unlink(path.join(this.directory, f.name)).catch(() => {})));
    }
}

function installEvaluationRoutes(app, deps, options) {
    const jobs = new EvaluationJobs(deps, options);
    const allowed = (req, res) => {
        const site = req.get('Sec-Fetch-Site');
        if (site && site !== 'same-origin') { res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return false; }
        return true;
    };
    app.post('/api/vet/evaluation', async (req, res) => {
        if (!allowed(req, res)) return;
        if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
        let identity;
        try { identity = validateIdentity(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
        try {
            const job = await jobs.start(identity, req.body.force === true);
            res.set('Cache-Control', 'no-store').status(job.status === 'complete' ? 200 : 202).json(job);
        } catch (err) { res.status(err.status || 503).json({ error: err.status === 429 ? err.message : 'Evaluation storage is unavailable.' }); }
    });
    app.get('/api/vet/evaluation/:id', async (req, res) => {
        if (!allowed(req, res)) return;
        try {
            const job = await jobs.get(req.params.id);
            res.set('Cache-Control', 'no-store');
            if (!job) return res.status(404).json({ error: 'This evaluation is no longer available. Start it again.' });
            res.json(job);
        } catch (_) { res.status(503).json({ error: 'Evaluation storage is unavailable.' }); }
    });
    installEvaluationShareRoutes(app, jobs, allowed, options || {});
    return jobs;
}

module.exports = { validateIdentity, EvaluationJobs, installEvaluationRoutes };
