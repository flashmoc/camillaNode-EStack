'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = process.env.ESTACK_WIIM_LOUDNESS_CONFIG || path.join(ROOT, 'wiimLoudnessConfig.json');
const EXAMPLE_FILE = path.join(ROOT, 'wiimLoudnessConfig.example.json');
const STATUS_FILE = process.env.ESTACK_WIIM_LOUDNESS_STATUS || '/dev/shm/estack-wiim-loudness-status.json';

const DEFAULTS = {
    wiim: { host: 'WiiM-Mini-Living-room.local', port: 443, pollMs: 500, timeoutMs: 1500 },
    camilladsp: { url: 'ws://127.0.0.1:1234', auxFader: 1 },
    curve: { startDb: -10, fullDb: -30, power: 1 },
    nativeLoudness: { referenceDb: -10, spanDb: 20 },
    failSafe: { wiimTimeoutMs: 3000, safeAuxDb: 0 },
    calibration: [
        [100, 0.00], [94, -2.00], [88, -3.97], [82, -6.01], [76, -7.95],
        [69, -9.98], [63, -12.00], [57, -13.96], [51, -16.01], [44, -19.96],
        [38, -23.96], [32, -27.97], [26, -32.98], [19, -38.96], [13, -43.39],
        [7, -47.20]
    ]
};

let config = null;
let configMtimeMs = 0;
let dspSocket = null;
let dspReconnectTimer = null;
let shuttingDown = false;
let lastWiimAt = 0;
let lastCamillaAt = 0;
let lastStatusWriteAt = 0;
let lastSentAuxDb = null;
let lastSendAt = 0;
let lastWiimVolume = null;
let desiredAuxDb = 0;
const wiimAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

let status = {
    service: true,
    state: 'starting',
    wiimConnected: false,
    camillaConnected: false,
    wiimVolume: null,
    wiimMute: null,
    realAttenuationDb: null,
    compensationFactor: 0,
    aux1Db: 0,
    error: null,
    updatedAt: null,
    updatedAtMs: 0,
    pid: process.pid
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function mergeConfig(raw) {
    const out = clone(DEFAULTS);
    if (raw && typeof raw === 'object') {
        for (const key of ['wiim', 'camilladsp', 'curve', 'nativeLoudness', 'failSafe']) {
            if (raw[key] && typeof raw[key] === 'object') Object.assign(out[key], raw[key]);
        }
        if (Array.isArray(raw.calibration) && raw.calibration.length >= 2) out.calibration = raw.calibration;
    }

    out.wiim.host = String(out.wiim.host || DEFAULTS.wiim.host).trim();
    out.wiim.port = clampNumber(out.wiim.port, 1, 65535, DEFAULTS.wiim.port);
    out.wiim.pollMs = clampNumber(out.wiim.pollMs, 200, 5000, DEFAULTS.wiim.pollMs);
    out.wiim.timeoutMs = clampNumber(out.wiim.timeoutMs, 500, 10000, DEFAULTS.wiim.timeoutMs);
    out.camilladsp.url = String(out.camilladsp.url || DEFAULTS.camilladsp.url).trim();
    out.camilladsp.auxFader = Math.round(clampNumber(out.camilladsp.auxFader, 1, 4, 1));
    out.curve.startDb = clampNumber(out.curve.startDb, -40, 0, -10);
    out.curve.fullDb = clampNumber(out.curve.fullDb, -60, -5, -30);
    if (out.curve.fullDb >= out.curve.startDb - 2) out.curve.fullDb = out.curve.startDb - 20;
    out.curve.power = clampNumber(out.curve.power, 0.25, 4, 1);
    out.nativeLoudness.referenceDb = clampNumber(out.nativeLoudness.referenceDb, -30, 0, -10);
    out.nativeLoudness.spanDb = clampNumber(out.nativeLoudness.spanDb, 5, 40, 20);
    out.failSafe.wiimTimeoutMs = clampNumber(out.failSafe.wiimTimeoutMs, 1000, 30000, 3000);
    out.failSafe.safeAuxDb = clampNumber(out.failSafe.safeAuxDb, -10, 0, 0);
    out.calibration = out.calibration
        .map(row => [Number(row?.[0]), Number(row?.[1])])
        .filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]))
        .sort((a, b) => b[0] - a[0]);
    if (out.calibration.length < 2) out.calibration = clone(DEFAULTS.calibration);
    return out;
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function ensureConfigFile() {
    if (fs.existsSync(CONFIG_FILE)) return;
    if (fs.existsSync(EXAMPLE_FILE)) {
        fs.copyFileSync(EXAMPLE_FILE, CONFIG_FILE);
        return;
    }
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(DEFAULTS, null, 2)}\n`, { mode: 0o600 });
}

function loadConfig(force = false) {
    try {
        ensureConfigFile();
        const stat = fs.statSync(CONFIG_FILE);
        if (!force && stat.mtimeMs === configMtimeMs) return false;
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config = mergeConfig(raw);
        configMtimeMs = stat.mtimeMs;
        status.error = null;
        if (lastWiimVolume !== null) applyWiimVolume(lastWiimVolume, status.wiimMute, true);
        return true;
    } catch (error) {
        status.error = `Config: ${error.message}`;
        if (!config) config = mergeConfig(DEFAULTS);
        return false;
    }
}

function interpolateCalibration(volume) {
    const table = config.calibration;
    if (volume >= table[0][0]) return table[0][1];
    const last = table[table.length - 1];
    if (volume <= last[0]) return last[1];

    for (let i = 0; i < table.length - 1; i += 1) {
        const [v1, db1] = table[i];
        const [v2, db2] = table[i + 1];
        if (volume <= v1 && volume >= v2) {
            const t = (volume - v1) / (v2 - v1);
            return db1 + t * (db2 - db1);
        }
    }
    return last[1];
}

function compensationFactor(realDb) {
    const start = config.curve.startDb;
    const full = config.curve.fullDb;
    if (realDb >= start) return 0;
    if (realDb <= full) return 1;
    const linear = Math.max(0, Math.min(1, (start - realDb) / (start - full)));
    return Math.pow(linear, config.curve.power);
}

function factorToAuxDb(factor) {
    return config.nativeLoudness.referenceDb - config.nativeLoudness.spanDb * factor;
}

function writeStatus(force = false) {
    const now = Date.now();
    if (!force && now - lastStatusWriteAt < 500) return;
    lastStatusWriteAt = now;
    status.service = true;
    status.updatedAtMs = now;
    status.updatedAt = new Date(now).toISOString();
    status.curve = clone(config?.curve || DEFAULTS.curve);
    if (status.state !== 'stopping') status.state = status.wiimConnected && status.camillaConnected ? 'connected' : 'degraded';

    try {
        const dir = path.dirname(STATUS_FILE);
        fs.mkdirSync(dir, { recursive: true });
        const temp = `${STATUS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(status)}\n`, { mode: 0o600 });
        fs.renameSync(temp, STATUS_FILE);
    } catch (error) {
        if (force) console.error('Unable to write loudness status:', error.message);
    }
}

function connectCamilla() {
    if (shuttingDown || !config) return;
    if (dspSocket && (dspSocket.readyState === WebSocket.OPEN || dspSocket.readyState === WebSocket.CONNECTING)) return;

    try {
        dspSocket = new WebSocket(config.camilladsp.url);
    } catch (error) {
        status.camillaConnected = false;
        status.error = `CamillaDSP: ${error.message}`;
        scheduleCamillaReconnect();
        writeStatus(true);
        return;
    }

    dspSocket.on('open', () => {
        status.camillaConnected = true;
        lastCamillaAt = Date.now();
        status.error = null;
        lastSentAuxDb = null;
        sendAux(desiredAuxDb, true);
        writeStatus(true);
    });

    dspSocket.on('message', raw => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.SetFaderExternalVolume && msg.SetFaderExternalVolume.result !== 'Ok') {
                status.error = `CamillaDSP rejected Aux1: ${msg.SetFaderExternalVolume.result}`;
            }
        } catch (_) {}
    });

    dspSocket.on('error', error => {
        status.error = `CamillaDSP: ${error.message}`;
    });

    dspSocket.on('close', () => {
        status.camillaConnected = false;
        dspSocket = null;
        writeStatus(true);
        scheduleCamillaReconnect();
    });
}

function scheduleCamillaReconnect() {
    if (shuttingDown || dspReconnectTimer) return;
    dspReconnectTimer = setTimeout(() => {
        dspReconnectTimer = null;
        connectCamilla();
    }, 1000);
}

function sendAux(db, force = false) {
    desiredAuxDb = clampNumber(db, -60, 0, 0);
    status.aux1Db = desiredAuxDb;
    if (!dspSocket || dspSocket.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const changed = lastSentAuxDb === null || Math.abs(desiredAuxDb - lastSentAuxDb) >= 0.02;
    const heartbeat = now - lastSendAt >= 2000;
    if (!force && !changed && !heartbeat) return;

    try {
        dspSocket.send(JSON.stringify({
            SetFaderExternalVolume: [config.camilladsp.auxFader, Number(desiredAuxDb.toFixed(3))]
        }));
        lastSentAuxDb = desiredAuxDb;
        lastSendAt = now;
        lastCamillaAt = now;
        status.camillaConnected = true;
    } catch (error) {
        status.camillaConnected = false;
        status.error = `CamillaDSP send: ${error.message}`;
    }
}

function applyWiimVolume(volume, mute, force = false) {
    const realDb = interpolateCalibration(volume);
    const factor = compensationFactor(realDb);
    const auxDb = factorToAuxDb(factor);

    lastWiimVolume = volume;
    status.wiimVolume = volume;
    status.wiimMute = !!mute;
    status.realAttenuationDb = Number(realDb.toFixed(3));
    status.compensationFactor = Number(factor.toFixed(5));
    status.aux1Db = Number(auxDb.toFixed(3));
    sendAux(auxDb, force);
}

function readWiim() {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: config.wiim.host,
            port: config.wiim.port,
            path: '/httpapi.asp?command=getPlayerStatusEx',
            method: 'GET',
            timeout: config.wiim.timeoutMs,
            rejectUnauthorized: false,
            agent: wiimAgent
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    const volume = Number(parsed.vol);
                    if (!Number.isFinite(volume)) throw new Error('invalid vol field');
                    resolve({ volume, mute: String(parsed.mute) === '1' });
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', reject);
        request.end();
    });
}

async function pollWiim() {
    if (shuttingDown) return;
    try {
        const { volume, mute } = await readWiim();
        lastWiimAt = Date.now();
        status.wiimConnected = true;
        status.error = null;
        applyWiimVolume(volume, mute);
    } catch (error) {
        const age = lastWiimAt ? Date.now() - lastWiimAt : Infinity;
        status.error = `WiiM: ${error.message}`;
        if (age >= config.failSafe.wiimTimeoutMs) {
            status.wiimConnected = false;
            status.compensationFactor = 0;
            status.realAttenuationDb = null;
            sendAux(config.failSafe.safeAuxDb, true);
        }
    }
    writeStatus();
    setTimeout(pollWiim, config.wiim.pollMs);
}

function housekeeping() {
    if (shuttingDown) return;
    loadConfig(false);
    if (!status.wiimConnected && lastWiimAt && Date.now() - lastWiimAt >= config.failSafe.wiimTimeoutMs) {
        sendAux(config.failSafe.safeAuxDb);
    }
    if (status.camillaConnected && Date.now() - lastCamillaAt > 5000) sendAux(desiredAuxDb, true);
    writeStatus();
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: setting loudness Aux fail-safe and stopping.`);
    try {
        if (dspReconnectTimer) clearTimeout(dspReconnectTimer);
        if (dspSocket?.readyState === WebSocket.OPEN) {
            dspSocket.send(JSON.stringify({
                SetFaderExternalVolume: [config.camilladsp.auxFader, config.failSafe.safeAuxDb]
            }));
        }
    } catch (_) {}
    status.state = 'stopping';
    status.wiimConnected = false;
    writeStatus(true);
    setTimeout(() => process.exit(0), 120);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
    status.error = `Fatal: ${error.message}`;
    writeStatus(true);
    shutdown('uncaughtException');
});
process.on('unhandledRejection', error => {
    console.error('Unhandled rejection:', error);
    status.error = `Fatal: ${error?.message || error}`;
    writeStatus(true);
});

loadConfig(true);
desiredAuxDb = config.failSafe.safeAuxDb;
status.aux1Db = desiredAuxDb;
writeStatus(true);
connectCamilla();
pollWiim();
setInterval(housekeeping, 1000);

console.log(`E-Stack WiiM loudness bridge started: ${config.wiim.host} -> ${config.camilladsp.url} Aux${config.camilladsp.auxFader}`);
