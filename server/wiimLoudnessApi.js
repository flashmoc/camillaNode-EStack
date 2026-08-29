'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function registerWiimLoudnessApi(app, options = {}) {
    const root = options.root || path.resolve(__dirname, '..');
    const configFile = process.env.ESTACK_WIIM_LOUDNESS_CONFIG || path.join(root, 'wiimLoudnessConfig.json');
    const exampleFile = path.join(root, 'wiimLoudnessConfig.example.json');
    const statusFile = process.env.ESTACK_WIIM_LOUDNESS_STATUS || '/dev/shm/estack-wiim-loudness-status.json';
    const staleMs = Number.parseInt(process.env.ESTACK_WIIM_LOUDNESS_STALE_MS || '4000', 10);

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
