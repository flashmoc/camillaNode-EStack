'use strict';

const fs = require('fs');
const path = require('path');
const model = require('./measurementBatchModel');

const SAFE_TRANSITION_VOLUME_DB = -60;

module.exports = function registerMeasurementBatch(app, options = {}) {
    const WebSocket = options.WebSocket || require('ws');
    const host = options.host || process.env.CAMILLADSP_PROXY_HOST || '127.0.0.1';
    const port = Number(options.port || process.env.CAMILLADSP_PORT || 1234);
    const root = options.root || path.resolve(__dirname, '..');
    const runtimeDir = options.runtimeDir || path.join(root, 'config');
    const batchFile = options.batchFile || path.join(runtimeDir, 'measurement-batch.json');
    const sessionFile = options.sessionFile || path.join(runtimeDir, 'measurement-batch-session.json');
    const signalSnapshotPath = options.signalSnapshotPath || process.env.ESTACK_SIGNAL_SNAPSHOT || '/tmp/camillanode-estack-test-signal.json';

    fs.mkdirSync(runtimeDir, { recursive: true });
    let transition = Promise.resolve();

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function currentBootId() {
        try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); }
        catch (_) { return null; }
    }

    function atomicWrite(file, value) {
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temp, file);
    }

    function readJsonFile(file, fallback = null) {
        try {
            if (!fs.existsSync(file)) return fallback;
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            throw new Error(`${path.basename(file)} is invalid: ${error.message}`);
        }
    }

    function readBatch() {
        const raw = readJsonFile(batchFile, null);
        return raw ? model.normalizeBatch(raw) : null;
    }

    function writeBatch(batch) {
        atomicWrite(batchFile, model.normalizeBatch(batch));
    }

    const readSession = () => readJsonFile(sessionFile, null);
    const writeSession = session => atomicWrite(sessionFile, session);
    function clearSession() {
        try { fs.unlinkSync(sessionFile); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }

    function readBody(req, limitBytes = 2 * 1024 * 1024) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
                if (Buffer.byteLength(body, 'utf8') > limitBytes) {
                    reject(new Error('Measurement batch request is too large'));
                    req.destroy();
                }
            });
            req.on('end', () => {
                if (!body.trim()) return resolve({});
                try { resolve(JSON.parse(body)); }
                catch (_) { reject(new Error('Invalid JSON body')); }
            });
            req.on('error', reject);
        });
    }

    function openDsp(timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${host}:${port}`);
            const timer = setTimeout(() => {
                try { ws.terminate?.(); } catch (_) {}
                reject(new Error('CamillaDSP connection timeout'));
            }, timeoutMs);
            ws.once('open', () => {
                clearTimeout(timer);
                resolve(ws);
            });
            ws.once('error', error => {
                clearTimeout(timer);
                reject(new Error(`CamillaDSP unavailable: ${error.message}`));
            });
        });
    }

    function dspRequest(ws, command, timeoutMs = 4000) {
        const expected = typeof command === 'string' ? command : Object.keys(command || {})[0];
        if (!expected) return Promise.reject(new Error('Invalid CamillaDSP command'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                ws.off('message', onMessage);
                reject(new Error(`${expected} timed out`));
            }, timeoutMs);

            function onMessage(data) {
                let response;
                try { response = JSON.parse(String(data)); }
                catch (_) { return; }
                if (!Object.prototype.hasOwnProperty.call(response, expected)) return;
                clearTimeout(timer);
                ws.off('message', onMessage);
                const payload = response[expected] || {};
                if (payload.result !== 'Ok') {
                    reject(new Error(`${expected} failed: ${payload.value || payload.result || 'unknown error'}`));
                    return;
                }
                let value = payload.value;
                if (expected === 'GetConfigJson') {
                    try { value = JSON.parse(value); }
                    catch (_) {
                        reject(new Error('CamillaDSP returned invalid configuration JSON'));
                        return;
                    }
                }
                resolve(value);
            }

            ws.on('message', onMessage);
            try { ws.send(JSON.stringify(command)); }
            catch (error) {
                clearTimeout(timer);
                ws.off('message', onMessage);
                reject(error);
            }
        });
    }

    function queueTransition(operation) {
        const next = transition.then(operation, operation);
        transition = next.catch(() => {});
        return next;
    }

    async function getLiveConfig() {
        const ws = await openDsp();
        try { return await dspRequest(ws, 'GetConfigJson'); }
        finally { try { ws.close(); } catch (_) {} }
    }

    async function applyProcessing(targetConfig, settleMs = 0) {
        const ws = await openDsp();
        let restoreVolume = null;
        let volumeRestored = false;
        try {
            const volume = Number(await dspRequest(ws, 'GetVolume'));
            if (Number.isFinite(volume)) restoreVolume = volume;
            const transitionVolume = restoreVolume == null ? SAFE_TRANSITION_VOLUME_DB : Math.min(restoreVolume, SAFE_TRANSITION_VOLUME_DB);
            await dspRequest(ws, { SetVolume: transitionVolume });

            const live = await dspRequest(ws, 'GetConfigJson');
            const next = model.mergeProcessingIntoLive(live, targetConfig);
            await dspRequest(ws, { SetConfigJson: JSON.stringify(next) }, 6500);
            const verified = await dspRequest(ws, 'GetConfigJson', 5000);
            if (!model.sameProcessing(verified, targetConfig)) {
                throw new Error('CamillaDSP did not retain the requested measurement processing state');
            }

            if (restoreVolume != null) {
                await dspRequest(ws, { SetVolume: restoreVolume });
                volumeRestored = true;
            }
        } finally {
            if (!volumeRestored && restoreVolume != null) {
                try { await dspRequest(ws, { SetVolume: restoreVolume }, 1800); } catch (_) {}
            }
            try { ws.close(); } catch (_) {}
        }
        if (settleMs > 0) await sleep(settleMs);
    }

    function preflightBatch(batch, baselineConfig) {
        if (baselineConfig?.devices?.capture?.type === 'SignalGenerator') {
            throw new Error('Stop the E-Stack Signal Generator before starting a measurement batch');
        }
        for (let index = 0; index < batch.steps.length; index += 1) {
            try { model.applyStep(baselineConfig, batch, index); }
            catch (error) { throw new Error(`${batch.steps[index].id}: ${error.message}`); }
        }
    }

    const sessionBatch = session => session?.batch ? model.normalizeBatch(session.batch) : null;

    function messageForState(batch, session) {
        if (!batch) return 'NO BATCH · import a Measurement Batch JSON file';
        if (!session) return `READY · ${batch.name} · ${batch.steps.length} measurements`;
        const current = model.describeStep(batch.steps[session.currentIndex], session.currentIndex, batch.steps.length);
        return `READY · ${current.summary}`;
    }

    function publicState(extra = {}) {
        let storedBatch = null;
        let session = null;
        let loadError = null;
        try { storedBatch = readBatch(); }
        catch (error) { loadError = error.message; }
        try { session = readSession(); }
        catch (error) { loadError = loadError || error.message; }

        const batch = session ? sessionBatch(session) : storedBatch;
        const total = batch?.steps?.length || 0;
        const active = !!session && !!batch;
        const completed = active && Array.isArray(session.completed)
            ? [...new Set(session.completed.map(Number))].filter(Number.isInteger).sort((a, b) => a - b)
            : [];
        const sequence = batch
            ? batch.steps.map((step, index) => model.describeStep(step, index, total))
            : [];
        const current = active ? sequence[session.currentIndex] : null;
        const next = active && session.currentIndex + 1 < total ? sequence[session.currentIndex + 1] : null;

        return {
            ok: !loadError,
            phase: loadError ? 'error' : active ? 'active' : batch ? 'ready' : 'empty',
            error: loadError,
            batch: batch ? {
                schema: batch.schema,
                version: batch.version,
                name: batch.name,
                description: batch.description,
                total,
                defaults: model.clone(batch.defaults)
            } : null,
            sequence,
            active,
            progress: {
                currentIndex: active ? session.currentIndex : null,
                currentNumber: active ? session.currentIndex + 1 : null,
                total,
                completedCount: completed.length,
                completed
            },
            current,
            next,
            startedAt: active ? session.startedAt : null,
            message: loadError || messageForState(batch, active ? session : null),
            endpoints: {
                status: '/api/measurement-batch/status',
                next: '/api/measurement-batch/next',
                previous: '/api/measurement-batch/previous',
                retry: '/api/measurement-batch/retry',
                abort: '/api/measurement-batch/abort'
            },
            ...extra
        };
    }

    async function startInternal() {
        if (readSession()) return publicState();
        const batch = readBatch();
        if (!batch) throw new Error('Import a Measurement Batch before starting');
        if (fs.existsSync(signalSnapshotPath)) throw new Error('Stop the E-Stack Signal Generator before starting a measurement batch');

        const baselineConfig = await getLiveConfig();
        preflightBatch(batch, baselineConfig);
        const session = {
            version: 1,
            bootId: currentBootId(),
            startedAt: new Date().toISOString(),
            batch,
            baselineConfig,
            currentIndex: 0,
            completed: []
        };
        writeSession(session);

        try {
            await applyProcessing(model.applyStep(baselineConfig, batch, 0), batch.defaults.settleMs);
            return publicState({ applied: true });
        } catch (error) {
            try { await applyProcessing(baselineConfig, 0); } catch (_) {}
            clearSession();
            throw error;
        }
    }

    async function applyIndexInternal(index, completed) {
        const session = readSession();
        if (!session) throw new Error('No active measurement batch');
        const batch = sessionBatch(session);
        if (!Number.isInteger(index) || index < 0 || index >= batch.steps.length) throw new Error('Measurement index is out of range');
        await applyProcessing(model.applyStep(session.baselineConfig, batch, index), batch.defaults.settleMs);
        session.currentIndex = index;
        session.completed = [...new Set((completed || session.completed || []).map(Number))]
            .filter(value => Number.isInteger(value) && value >= 0 && value < batch.steps.length)
            .sort((a, b) => a - b);
        writeSession(session);
        return publicState({ applied: true });
    }

    async function nextInternal() {
        const session = readSession();
        if (!session) return startInternal();
        const batch = sessionBatch(session);
        const completed = [...new Set([...(session.completed || []), session.currentIndex])].sort((a, b) => a - b);
        if (session.currentIndex < batch.steps.length - 1) {
            return applyIndexInternal(session.currentIndex + 1, completed);
        }

        await applyProcessing(session.baselineConfig, batch.defaults.settleMs);
        clearSession();
        return {
            ...publicState(),
            phase: 'complete',
            active: false,
            restored: true,
            completed: true,
            progress: {
                currentIndex: null,
                currentNumber: null,
                total: batch.steps.length,
                completedCount: batch.steps.length,
                completed: Array.from({ length: batch.steps.length }, (_, index) => index)
            },
            message: `COMPLETE · ${batch.name} · ${batch.steps.length}/${batch.steps.length} · normal DSP processing restored`
        };
    }

    async function previousInternal() {
        const session = readSession();
        if (!session) throw new Error('No active measurement batch');
        const target = Math.max(0, session.currentIndex - 1);
        return applyIndexInternal(target, (session.completed || []).filter(index => Number(index) < target));
    }

    async function retryInternal() {
        const session = readSession();
        if (!session) throw new Error('No active measurement batch');
        return applyIndexInternal(session.currentIndex, session.completed || []);
    }

    async function gotoInternal(body) {
        const session = readSession();
        if (!session) throw new Error('No active measurement batch');
        const batch = sessionBatch(session);
        let index = body?.index != null ? Number(body.index) : null;
        if (index == null && body?.number != null) index = Number(body.number) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= batch.steps.length) throw new Error('Provide a valid measurement index or 1-based number');
        return applyIndexInternal(index, (session.completed || []).filter(value => Number(value) < index));
    }

    async function abortInternal(reason = 'manual abort') {
        const session = readSession();
        if (!session) return publicState({ restored: false, reason: 'No active measurement batch' });
        const batch = sessionBatch(session);
        await applyProcessing(session.baselineConfig, batch.defaults.settleMs);
        clearSession();
        return publicState({
            restored: true,
            aborted: true,
            message: `RESTORED · ${batch.name} · ${reason} · normal DSP processing restored`
        });
    }

    function statusCodeFor(error) {
        return /CamillaDSP|GetConfigJson|SetConfigJson|GetVolume|SetVolume|connection timeout|ECONNREFUSED/i.test(String(error?.message || error)) ? 503 : 400;
    }

    function sendError(res, error) {
        res.status(statusCodeFor(error)).json({ ok: false, phase: 'error', error: error.message, message: error.message });
    }

    app.get('/api/measurement-batch/status', (_req, res) => {
        try { res.json(publicState()); }
        catch (error) { res.status(500).json({ ok: false, phase: 'error', error: error.message, message: error.message }); }
    });

    app.post('/api/measurement-batch/import', async (req, res) => {
        try {
            if (readSession()) throw new Error('Abort or complete the active measurement batch before importing another batch');
            const body = await readBody(req);
            writeBatch(model.normalizeBatch(body.batch ?? body));
            res.json(publicState({ imported: true }));
        } catch (error) { sendError(res, error); }
    });

    app.post('/api/measurement-batch/start', async (_req, res) => {
        try { res.json(await queueTransition(startInternal)); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/next', async (_req, res) => {
        try { res.json(await queueTransition(nextInternal)); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/previous', async (_req, res) => {
        try { res.json(await queueTransition(previousInternal)); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/retry', async (_req, res) => {
        try { res.json(await queueTransition(retryInternal)); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/goto', async (req, res) => {
        try { res.json(await queueTransition(() => gotoInternal(await readBody(req, 64 * 1024)))); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/abort', async (_req, res) => {
        try { res.json(await queueTransition(() => abortInternal('manual abort'))); }
        catch (error) { sendError(res, error); }
    });
    app.post('/api/measurement-batch/clear', async (_req, res) => {
        try {
            if (readSession()) throw new Error('Abort or complete the active batch before clearing it');
            try { fs.unlinkSync(batchFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            res.json(publicState({ cleared: true }));
        } catch (error) { sendError(res, error); }
    });

    function recoverAfterRestart(attempt = 1) {
        const session = readSession();
        if (!session) return;
        const bootId = currentBootId();
        if (session.bootId && bootId && session.bootId !== bootId) {
            clearSession();
            console.warn('Measurement Batch: discarded stale session from a previous Raspberry boot; startup recall owns the new boot state.');
            return;
        }

        queueTransition(async () => {
            const current = readSession();
            if (!current?.baselineConfig) return true;
            const batch = sessionBatch(current);
            try {
                await applyProcessing(current.baselineConfig, batch?.defaults?.settleMs || 0);
                clearSession();
                console.warn('Measurement Batch: restored normal DSP processing after CamillaNode restart.');
                return true;
            } catch (error) {
                console.error(`Measurement Batch recovery attempt ${attempt} failed:`, error.message);
                return false;
            }
        }).then(done => {
            if (!done && attempt < 15) setTimeout(() => recoverAfterRestart(attempt + 1), 2000);
        }).catch(error => {
            console.error('Measurement Batch recovery failed:', error.message);
            if (attempt < 15) setTimeout(() => recoverAfterRestart(attempt + 1), 2000);
        });
    }

    setTimeout(() => recoverAfterRestart(), 1800);

    return {
        getState: publicState,
        start: () => queueTransition(startInternal),
        next: () => queueTransition(nextInternal),
        abort: () => queueTransition(() => abortInternal('external abort'))
    };
};
