'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const loudnessModel = require('./loudnessPresetModel');

module.exports = function registerWiimLoudnessApi(app, options = {}) {
    const root = options.root || path.resolve(__dirname, '..');
    const configFile = process.env.ESTACK_WIIM_LOUDNESS_CONFIG || path.join(root, 'wiimLoudnessConfig.json');
    const exampleFile = path.join(root, 'wiimLoudnessConfig.example.json');
    const statusFile = process.env.ESTACK_WIIM_LOUDNESS_STATUS || '/dev/shm/estack-wiim-loudness-status.json';
    const staleMs = Number.parseInt(process.env.ESTACK_WIIM_LOUDNESS_STALE_MS || '4000', 10);
    const dspHost = options.host || process.env.CAMILLADSP_PROXY_HOST || '127.0.0.1';
    const dspPort = Number(options.port || process.env.CAMILLADSP_PORT || 1234);
    let presetQueue = Promise.resolve();

    function ensureConfig() {
        if (fs.existsSync(configFile)) return;
        if (!fs.existsSync(exampleFile)) throw new Error('WiiM loudness example config is missing');
        fs.copyFileSync(exampleFile, configFile);
        try { fs.chmodSync(configFile, 0o600); } catch (_) {}
    }

    function readConfig() {
        ensureConfig();
        return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }

    function atomicWriteConfig(config) {
        const temp = `${configFile}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temp, configFile);
    }

    function readBody(req, limitBytes = 64 * 1024) {
        return new Promise((resolve, reject) => {
            let text = '';
            req.on('data', chunk => {
                text += chunk;
                if (Buffer.byteLength(text, 'utf8') > limitBytes) {
                    reject(new Error('Request body too large'));
                    req.destroy();
                }
            });
            req.on('end', () => resolve(text));
            req.on('error', reject);
        });
    }

    function finiteInRange(value, min, max, label) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < min || number > max) {
            throw new Error(`${label} must be between ${min} and ${max}`);
        }
        return number;
    }

    function publicSettings(config) {
        return {
            curve: {
                startDb: Number(config?.curve?.startDb ?? -10),
                fullDb: Number(config?.curve?.fullDb ?? -30),
                power: Number(config?.curve?.power ?? 1)
            },
            nativeLoudness: {
                referenceDb: Number(config?.nativeLoudness?.referenceDb ?? -10),
                spanDb: Number(config?.nativeLoudness?.spanDb ?? 20)
            },
            wiim: {
                host: String(config?.wiim?.host || ''),
                pollMs: Number(config?.wiim?.pollMs ?? 500)
            }
        };
    }

    function presetState(config) {
        const raw = config?.presetState || {};
        const selected = loudnessModel.preset(raw.selected)?.key || 'reference';
        const lastEnabledPreset = loudnessModel.preset(raw.lastEnabledPreset);
        return {
            selected,
            lastEnabledPreset: lastEnabledPreset && !lastEnabledPreset.disabled
                ? lastEnabledPreset.key
                : 'home'
        };
    }

    function persistPresetState(selectedKey, livePreset = null) {
        const config = readConfig();
        const current = presetState(config);
        const selected = loudnessModel.preset(selectedKey);
        if (!selected) return;

        const next = {
            selected: selected.key,
            lastEnabledPreset: current.lastEnabledPreset
        };
        if (!selected.disabled) next.lastEnabledPreset = selected.key;
        else if (livePreset && loudnessModel.preset(livePreset) && !loudnessModel.preset(livePreset).disabled) {
            next.lastEnabledPreset = livePreset;
        }

        config.presetState = next;
        atomicWriteConfig(config);
    }

    function openDsp(timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://${dspHost}:${dspPort}`);
            const timer = setTimeout(() => {
                try { ws.terminate(); } catch (_) {}
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

    function dspRequest(ws, message, timeoutMs = 3500) {
        const command = typeof message === 'string' ? message : Object.keys(message || {})[0];
        if (!command) return Promise.reject(new Error('Invalid CamillaDSP command'));

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                ws.off('message', onMessage);
                reject(new Error(`${command} timed out`));
            }, timeoutMs);

            function onMessage(data) {
                let response;
                try { response = JSON.parse(String(data)); }
                catch (_) { return; }
                if (!Object.prototype.hasOwnProperty.call(response, command)) return;

                clearTimeout(timer);
                ws.off('message', onMessage);
                const payload = response[command] || {};
                if (payload.result !== 'Ok') {
                    reject(new Error(`${command} failed: ${payload.value || payload.result || 'unknown error'}`));
                    return;
                }

                let value = payload.value;
                if (command === 'GetConfigJson') {
                    try { value = JSON.parse(value); }
                    catch (_) {
                        reject(new Error('CamillaDSP returned invalid configuration JSON'));
                        return;
                    }
                }
                resolve(value);
            }

            ws.on('message', onMessage);
            try { ws.send(JSON.stringify(message)); }
            catch (error) {
                clearTimeout(timer);
                ws.off('message', onMessage);
                reject(error);
            }
        });
    }

    function enqueuePresetOperation(operation) {
        const run = presetQueue.then(operation, operation);
        presetQueue = run.catch(() => {});
        return run;
    }

    async function readLivePreset() {
        const settings = presetState(readConfig());
        const ws = await openDsp();
        try {
            const live = await dspRequest(ws, 'GetConfigJson');
            const key = loudnessModel.detectPreset(live, settings.selected);
            return {
                key,
                enabled: loudnessModel.isEnabled(live),
                config: live
            };
        } finally {
            try { ws.close(); } catch (_) {}
        }
    }

    async function applyLivePreset(key) {
        const selected = loudnessModel.preset(key);
        if (!selected) throw new Error(`Unknown loudness preset '${key}'`);

        return enqueuePresetOperation(async () => {
            const previousState = presetState(readConfig());
            const ws = await openDsp();
            try {
                const live = await dspRequest(ws, 'GetConfigJson');
                const previousLivePreset = loudnessModel.detectPreset(live, previousState.selected);
                const next = loudnessModel.applyPreset(live, selected.key);
                loudnessModel.assertOnlyLoudnessChanged(live, next);
                await dspRequest(ws, { SetConfigJson: JSON.stringify(next) });
                const verified = await dspRequest(ws, 'GetConfigJson');
                loudnessModel.validateApplied(verified, selected.key);
                persistPresetState(selected.key, previousLivePreset);
                return {
                    key: loudnessModel.detectPreset(verified, selected.key),
                    enabled: loudnessModel.isEnabled(verified)
                };
            } finally {
                try { ws.close(); } catch (_) {}
            }
        });
    }

    function isDspError(error) {
        return /CamillaDSP|GetConfigJson|SetConfigJson|connection timeout|ECONNREFUSED/i.test(String(error?.message || error));
    }

    app.get('/api/loudness/settings', (_req, res) => {
        try {
            res.json({ status: 'ok', ...publicSettings(readConfig()) });
        } catch (error) {
            res.status(500).json({ status: 'error', reason: error.message });
        }
    });

    app.post('/api/loudness/settings', async (req, res) => {
        try {
            const payload = JSON.parse(await readBody(req));
            const config = readConfig();
            const startDb = finiteInRange(payload?.curve?.startDb, -40, 0, 'START');
            const fullDb = finiteInRange(payload?.curve?.fullDb, -60, -5, 'FULL');
            const power = finiteInRange(payload?.curve?.power, 0.25, 4, 'SHAPE');
            if (fullDb >= startDb - 2) throw new Error('FULL must be at least 2 dB below START');

            config.curve = { ...config.curve, startDb, fullDb, power };
            atomicWriteConfig(config);
            res.json({ status: 'ok', ...publicSettings(config) });
        } catch (error) {
            res.status(400).json({ status: 'error', reason: error.message });
        }
    });

    app.get('/api/loudness/preset', async (_req, res) => {
        try {
            const live = await readLivePreset();
            res.json({
                status: 'ok',
                ok: true,
                preset: live.key,
                enabled: live.enabled
            });
        } catch (error) {
            res.status(isDspError(error) ? 503 : 500).json({
                status: 'error',
                ok: false,
                reason: error.message
            });
        }
    });

    app.post('/api/loudness/preset', async (req, res) => {
        try {
            const payload = JSON.parse(await readBody(req));
            const key = String(payload?.preset || '').trim().toLowerCase();
            if (!loudnessModel.preset(key)) {
                return res.status(400).json({
                    status: 'error',
                    ok: false,
                    reason: `Unknown loudness preset '${key || 'empty'}'`,
                    allowed: Object.keys(loudnessModel.PRESETS)
                });
            }

            const result = await applyLivePreset(key);
            res.json({
                status: 'ok',
                ok: true,
                preset: result.key,
                enabled: result.enabled
            });
        } catch (error) {
            res.status(isDspError(error) ? 503 : 400).json({
                status: 'error',
                ok: false,
                reason: error.message
            });
        }
    });

    app.post('/api/loudness/toggle', async (_req, res) => {
        try {
            const live = await readLivePreset();
            const state = presetState(readConfig());
            const target = live.enabled ? 'reference' : state.lastEnabledPreset || 'home';
            if (live.enabled && loudnessModel.preset(live.key) && !loudnessModel.preset(live.key).disabled) {
                const config = readConfig();
                config.presetState = {
                    ...presetState(config),
                    selected: live.key,
                    lastEnabledPreset: live.key
                };
                atomicWriteConfig(config);
            }

            const result = await applyLivePreset(target);
            res.json({
                status: 'ok',
                ok: true,
                preset: result.key,
                enabled: result.enabled
            });
        } catch (error) {
            res.status(isDspError(error) ? 503 : 500).json({
                status: 'error',
                ok: false,
                reason: error.message
            });
        }
    });

    app.get('/api/loudness/bridge', (_req, res) => {
        try {
            if (!fs.existsSync(statusFile)) {
                return res.json({
                    status: 'ok',
                    serviceAlive: false,
                    state: 'offline',
                    wiimConnected: false,
                    camillaConnected: false,
                    reason: 'Loudness bridge is not running'
                });
            }

            const stat = fs.statSync(statusFile);
            const bridge = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
            const updatedAtMs = Number(bridge.updatedAtMs || stat.mtimeMs || 0);
            const ageMs = Math.max(0, Date.now() - updatedAtMs);
            const serviceAlive = ageMs <= staleMs;
            const connected = serviceAlive && bridge.wiimConnected === true && bridge.camillaConnected === true;

            res.json({
                status: 'ok',
                serviceAlive,
                connected,
                ageMs,
                ...bridge,
                state: connected ? 'connected' : serviceAlive ? 'degraded' : 'offline',
                reason: connected
                    ? null
                    : !serviceAlive
                        ? 'Loudness bridge heartbeat lost'
                        : bridge.error || (!bridge.wiimConnected ? 'WiiM connection lost' : 'CamillaDSP connection lost')
            });
        } catch (error) {
            res.json({
                status: 'ok',
                serviceAlive: false,
                connected: false,
                state: 'offline',
                wiimConnected: false,
                camillaConnected: false,
                reason: `Loudness status unavailable: ${error.message}`
            });
        }
    });

    return { configFile, statusFile };
};
