'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_DIR = path.join(ROOT, 'config');
const APP_CONFIG_FILE = path.join(ROOT, 'camillaNodeConfig.json');
const CURRENT_CONFIG_FILE = path.join(ROOT, 'currentConfig.json');
const SAVED_CONFIGS_FILE = path.join(ROOT, 'savedConfigs.dat');
const STARTUP_CONFIG_FILE = path.join(ROOT, 'startupConfig.json');
const DEFAULT_APP_CONFIG = { port: 80 };

fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadAppConfig() {
    if (!fs.existsSync(APP_CONFIG_FILE)) {
        fs.writeFileSync(APP_CONFIG_FILE, JSON.stringify(DEFAULT_APP_CONFIG), { mode: 0o600 });
        return { ...DEFAULT_APP_CONFIG };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, 'utf8'));
        return { ...DEFAULT_APP_CONFIG, ...parsed };
    } catch (error) {
        console.error('Invalid camillaNodeConfig.json; using defaults:', error.message);
        return { ...DEFAULT_APP_CONFIG };
    }
}

const appConfig = loadAppConfig();
const PORT = Number.parseInt(process.env.CAMILLANODE_PORT || appConfig.port || DEFAULT_APP_CONFIG.port, 10);
const DSP_HOST = process.env.CAMILLADSP_PROXY_HOST || '127.0.0.1';
const DSP_PORT = Number.parseInt(process.env.CAMILLADSP_PORT || '1234', 10);
const SPECTRUM_PORT = Number.parseInt(process.env.CAMILLA_SPECTRUM_PORT || '6413', 10);
const DEMO_MODE = process.env.ESTACK_DEMO === '1';

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

function sendPage(file) {
    return (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'html', file));
}

app.get('/', sendPage('main.html'));
app.get('/basic', sendPage('basic.html'));
app.get('/connections', sendPage('connections.html'));
app.get('/equalizer', sendPage('equalizer.html'));
app.get('/signal-generator', sendPage('signal-generator.html'));
app.get('/per-way', (_req, res) => res.redirect(308, '/signal-generator'));
app.get('/advanced', sendPage('advanced.html'));
app.get('/preferences', sendPage('preferences.html'));

app.get('/api/runtime', (_req, res) => {
    res.json({
        mode: DEMO_MODE ? 'demo' : 'hardware',
        httpPort: PORT,
        dspPort: DSP_PORT,
        spectrumPort: SPECTRUM_PORT,
        camillaGuiProxy: DEMO_MODE ? '/camillagui/gui/index.html' : null
    });
});

// The measurement generator owns its exact normal-config snapshot and automatic
// restore. Register it before the generic /api proxy used by CamillaGUI in demo.
require('./server/signalGenerator')(app, {
    WebSocket,
    host: DSP_HOST,
    port: DSP_PORT
});

// Startup recall is server-side so a selected System Configuration is restored
// at Raspberry boot even when no browser is open. It changes DSP processing only;
// live hardware devices and mixer routing remain owned by the boot YAML.
const startupConfiguration = require('./server/startupConfiguration')(app, {
    WebSocket,
    host: DSP_HOST,
    port: DSP_PORT,
    root: ROOT,
    stateFile: STARTUP_CONFIG_FILE,
    savedConfigsFile: SAVED_CONFIGS_FILE,
    demo: DEMO_MODE
});

// Codespaces only: keep CamillaGUI on the CamillaNode origin. Raspberry installs
// use CamillaGUI directly and never enter this proxy path.
const camillaGuiProxyEnabled = DEMO_MODE;
const camillaGuiProxyHost = process.env.CAMILLAGUI_PROXY_HOST || '127.0.0.1';
const camillaGuiProxyPort = Number.parseInt(process.env.CAMILLAGUI_PORT || '5005', 10);

function proxyCamillaGuiHttp(req, res, upstreamPath) {
    const headers = { ...req.headers };
    headers.host = `${camillaGuiProxyHost}:${camillaGuiProxyPort}`;
    delete headers['content-length'];

    const upstream = http.request({
        hostname: camillaGuiProxyHost,
        port: camillaGuiProxyPort,
        method: req.method,
        path: upstreamPath,
        headers
    }, upstreamRes => {
        const responseHeaders = { ...upstreamRes.headers };
        if (responseHeaders.location) {
            try {
                const location = new URL(responseHeaders.location, `http://${camillaGuiProxyHost}:${camillaGuiProxyPort}`);
                if (location.hostname === camillaGuiProxyHost && Number(location.port || 80) === camillaGuiProxyPort) {
                    responseHeaders.location = `/camillagui${location.pathname}${location.search}${location.hash}`;
                }
            } catch (_) {}
        }
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        upstreamRes.pipe(res);
    });

    upstream.on('error', error => {
        console.error(`CamillaGUI HTTP proxy error for ${upstreamPath}:`, error.message);
        if (!res.headersSent) res.status(502).send('CamillaGUI backend unavailable');
        else res.end();
    });
    req.pipe(upstream);
}

if (camillaGuiProxyEnabled) {
    app.use('/camillagui', (req, res) => {
        const upstreamPath = req.originalUrl.replace(/^\/camillagui/, '') || '/';
        proxyCamillaGuiHttp(req, res, upstreamPath);
    });
    app.use('/api', (req, res) => proxyCamillaGuiHttp(req, res, req.originalUrl));
}

function readBody(req, limitBytes = 2 * 1024 * 1024) {
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

function parseJson(text, label = 'JSON') {
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`Invalid ${label}`);
    }
}

function safeConfigName(input) {
    const name = String(input || '').trim();
    if (!name || name.length > 120 || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
        throw new Error('Invalid configuration name');
    }
    return name;
}

function configPath(name) {
    return path.join(CONFIG_DIR, `${safeConfigName(name)}.json`);
}

app.post('/saveConfigName', async (req, res) => {
    try {
        const body = await readBody(req, 64 * 1024);
        parseJson(body, 'configuration name payload');
        fs.writeFileSync(CURRENT_CONFIG_FILE, body, { mode: 0o600 });
        res.end();
    } catch (error) {
        res.status(400).json({ status: 'error', reason: error.message });
    }
});

app.get('/getConfigName', (_req, res) => {
    const current = fs.existsSync(CURRENT_CONFIG_FILE)
        ? fs.readFileSync(CURRENT_CONFIG_FILE, 'utf8')
        : JSON.stringify({ configName: '', configShortcut: '' });
    // Preserve the historical API shape: a JSON string containing the payload.
    res.send(JSON.stringify(current));
});

app.post('/saveConfig', async (req, res) => {
    try {
        const config = parseJson(await readBody(req), 'configuration payload');
        const file = configPath(config.configName);
        fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
        res.end();
    } catch (error) {
        res.status(400).json({ status: 'error', reason: error.message });
    }
});

app.post('/saveConfigFile', async (req, res) => {
    try {
        const config = parseJson(await readBody(req, 8 * 1024 * 1024), 'saved configuration payload');
        fs.writeFileSync(SAVED_CONFIGS_FILE, JSON.stringify(config), { mode: 0o600 });
        res.end();
    } catch (error) {
        res.status(400).json({ status: 'error', reason: error.message });
    }
});

app.get('/getConfigFile', (_req, res) => {
    if (!fs.existsSync(SAVED_CONFIGS_FILE)) return res.send(JSON.stringify([]));
    res.type('application/json').send(fs.readFileSync(SAVED_CONFIGS_FILE, 'utf8'));
});

app.get('/getConfigList', (_req, res) => {
    const list = fs.readdirSync(CONFIG_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => file.slice(0, -5));
    res.json(list);
});

app.get('/getConfig', (req, res) => {
    try {
        const file = configPath(req.query.configName);
        if (!fs.existsSync(file)) return res.status(404).json({ status: 'error', reason: 'Config not found' });
        res.type('application/json').send(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        res.status(400).json({ status: 'error', reason: error.message });
    }
});

app.get('/configExists', (req, res) => {
    try {
        res.send(String(fs.existsSync(configPath(req.query.configName))));
    } catch (_) {
        res.send('false');
    }
});

app.get('/deleteConfig', (req, res) => {
    try {
        const file = configPath(req.query.configName);
        if (!fs.existsSync(file)) return res.status(404).json({ status: 'error', reason: 'Config not found' });
        fs.unlinkSync(file);
        res.send('Deleted');
    } catch (error) {
        res.status(400).json({ status: 'error', reason: error.message });
    }
});

// Same-origin WebSocket proxy. Browser clients talk only to CamillaNode; the
// server forwards to the local CamillaDSP processes over loopback.
const server = http.createServer(app);
const proxyWss = new WebSocket.Server({ noServer: true });
const proxyTargets = {
    '/ws/dsp': DSP_PORT,
    '/ws/spectrum': SPECTRUM_PORT
};

function bridgeWebSocket(client, upstream) {
    const pendingClientMessages = [];
    let closed = false;

    const closeBoth = () => {
        if (closed) return;
        closed = true;
        try {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
        } catch (_) {}
        try {
            if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
        } catch (_) {}
    };

    client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else if (upstream.readyState === WebSocket.CONNECTING) pendingClientMessages.push({ data, isBinary });
    });

    upstream.on('open', () => {
        for (const message of pendingClientMessages.splice(0)) {
            upstream.send(message.data, { binary: message.isBinary });
        }
    });
    upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on('error', error => {
        console.error('WebSocket proxy upstream error:', error.message);
        closeBoth();
    });
    upstream.on('close', closeBoth);
    client.on('error', closeBoth);
    client.on('close', closeBoth);
}

server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
        pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch (_) {
        socket.destroy();
        return;
    }

    if (camillaGuiProxyEnabled && pathname.startsWith('/api/')) {
        proxyWss.handleUpgrade(request, socket, head, client => {
            const protocolHeader = request.headers['sec-websocket-protocol'];
            const protocols = protocolHeader
                ? String(protocolHeader).split(',').map(value => value.trim()).filter(Boolean)
                : undefined;
            const upstreamUrl = `ws://${camillaGuiProxyHost}:${camillaGuiProxyPort}${request.url}`;
            const upstream = protocols?.length ? new WebSocket(upstreamUrl, protocols) : new WebSocket(upstreamUrl);
            bridgeWebSocket(client, upstream);
        });
        return;
    }

    const targetPort = proxyTargets[pathname];
    if (!targetPort) {
        socket.destroy();
        return;
    }

    proxyWss.handleUpgrade(request, socket, head, client => {
        bridgeWebSocket(client, new WebSocket(`ws://${DSP_HOST}:${targetPort}`));
    });
});

server.listen(PORT, () => {
    const mode = DEMO_MODE ? ' [E-Stack demo]' : '';
    console.log(`CamillaNode is running on port ${PORT}${mode}...`);
    startupConfiguration.scheduleBootApply();
});
