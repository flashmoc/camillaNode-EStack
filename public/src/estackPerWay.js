const ESTACK_TEST_WAYS = {
    0: { name: 'SUB', out: 1 },
    1: { name: 'KICK', out: 2 },
    2: { name: 'MID L', out: 3 },
    3: { name: 'MID R', out: 4 },
    4: { name: 'HIGH L', out: 5 },
    5: { name: 'HIGH R', out: 6 }
};
const ESTACK_TEST_CHANNELS = [0, 1, 2, 3, 4, 5];

let DSP;
let testStatus = { active: false, targets: [] };
let statusTimer = null;

function wayName(channel) {
    return ESTACK_TEST_WAYS[channel]?.name || `OUT ${Number(channel) + 1}`;
}

function waitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function setPageStatus(message, state = 'info') {
    const el = document.getElementById('signalPageStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function selectedTargets() {
    return [...document.querySelectorAll('#signalTargets button.active')]
        .map(button => Number(button.dataset.channel));
}

function renderTargets() {
    const root = document.getElementById('signalTargets');
    root.replaceChildren();
    for (const channel of ESTACK_TEST_CHANNELS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.channel = channel;
        button.className = 'signal-target';
        const active = testStatus.active
            ? (testStatus.targets || []).includes(channel)
            : channel === 0;
        button.classList.toggle('active', active);
        button.disabled = !!testStatus.active;
        button.innerHTML = `<strong>${wayName(channel)}</strong><span>OUT ${channel + 1}</span>`;
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            if (!selectedTargets().length) button.classList.add('active');
            renderQuickFrequencies();
            updateSafety();
        });
        root.appendChild(button);
    }
}

function selectedCrossoverFrequencies() {
    if (!DSP) return [];
    const values = [];
    for (const channel of selectedTargets()) {
        const names = typeof DSP.getChannelFiltersList === 'function'
            ? DSP.getChannelFiltersList(channel)
            : [];
        for (const name of names) {
            const filter = DSP.config?.filters?.[name];
            if (filter?.type !== 'BiquadCombo') continue;
            if (!/pass/i.test(String(filter?.parameters?.type || ''))) continue;
            const freq = Number(filter?.parameters?.freq);
            if (Number.isFinite(freq)) values.push(Math.round(freq));
        }
    }
    return values;
}

function quickFrequencies() {
    const base = [40, 50, 60, 80, 100, 130, 300, 1000, 2000, 4000, 10000];
    return [...new Set([...base, ...selectedCrossoverFrequencies()])]
        .filter(value => value >= 10 && value <= 20000)
        .sort((a, b) => a - b);
}

function renderQuickFrequencies() {
    const root = document.getElementById('quickFrequencies');
    root.replaceChildren();
    for (const freq of quickFrequencies()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = !!testStatus.active;
        button.textContent = freq >= 1000
            ? `${Number((freq / 1000).toFixed(freq % 1000 ? 1 : 0))}k`
            : String(freq);
        button.title = `${freq} Hz`;
        button.addEventListener('click', () => {
            document.getElementById('testFrequency').value = String(freq);
        });
        root.appendChild(button);
    }
}

function clientSafeCap(type, targets) {
    const white = type === 'WhiteNoise';
    if (targets.some(channel => channel >= 4)) return white ? -30 : -20;
    if (targets.some(channel => channel >= 2)) return white ? -25 : -15;
    return white ? -20 : -10;
}

function updateSafety() {
    const type = document.getElementById('testType').value;
    const targets = selectedTargets();
    const cap = clientSafeCap(type, targets);
    const level = document.getElementById('testLevel');
    level.max = String(cap);
    if (Number(level.value) > cap) level.value = String(cap);

    const note = document.getElementById('signalSafety');
    note.textContent = `Safety ceiling: ${cap} dBFS${type === 'WhiteNoise' ? ' in white noise' : ''}. Recommended starting level: -40 dBFS.`;
}

function renderGeneratorState() {
    const active = !!testStatus.active;
    const type = document.getElementById('testType');
    const freq = document.getElementById('testFrequency');
    const level = document.getElementById('testLevel');
    const duration = document.getElementById('testDuration');
    const start = document.getElementById('startTestSignal');
    const stop = document.getElementById('stopTestSignal');

    [type, level, duration, start].forEach(el => { el.disabled = active; });
    freq.disabled = active || type.value === 'WhiteNoise';
    stop.disabled = !active;

    document.querySelectorAll('#signalTargets button').forEach(button => {
        button.disabled = active;
        if (active) button.classList.toggle('active', (testStatus.targets || []).includes(Number(button.dataset.channel)));
    });
    document.querySelectorAll('#quickFrequencies button').forEach(button => { button.disabled = active; });

    const state = document.getElementById('signalRuntimeState');
    state.classList.toggle('active', active);
    if (active) {
        const remaining = Math.max(0, Math.ceil(Number(testStatus.remainingMs || 0) / 1000));
        const signal = testStatus.type === 'Sine'
            ? `${Math.round(Number(testStatus.freq))} Hz SINE`
            : 'WHITE NOISE';
        state.innerHTML = `<strong>TEST ACTIVE</strong><span>${signal} · ${Number(testStatus.level).toFixed(1)} dBFS · ${(testStatus.targets || []).map(wayName).join(' + ')} · ${remaining}s</span>`;
    } else {
        state.innerHTML = '<strong>NORMAL INPUT</strong><span>WiiM / USB capture path restored</span>';
    }
    updateSafety();
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
}

async function refreshStatus() {
    try {
        testStatus = await fetchJson('/api/test-signal/status');
        renderGeneratorState();
    } catch (error) {
        setPageStatus(`Generator unavailable: ${error.message}`, 'error');
    }
}

async function startSignal() {
    const type = document.getElementById('testType').value;
    const targets = selectedTargets();
    if (!targets.length) {
        setPageStatus('Select at least one output.', 'error');
        return;
    }

    const payload = {
        type,
        targets,
        level: Number(document.getElementById('testLevel').value),
        duration: Number(document.getElementById('testDuration').value)
    };
    if (type === 'Sine') payload.freq = Number(document.getElementById('testFrequency').value);

    try {
        setPageStatus('Starting protected test signal…', 'busy');
        testStatus = await fetchJson('/api/test-signal/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        renderGeneratorState();
        setPageStatus(`Signal active on ${(testStatus.targets || []).map(wayName).join(' + ')}.`, 'ok');
    } catch (error) {
        setPageStatus(`START ERROR: ${error.message}`, 'error');
        await refreshStatus();
    }
}

async function stopSignal({ silent = false } = {}) {
    try {
        if (!silent) setPageStatus('Stopping signal and restoring normal input…', 'busy');
        await fetchJson('/api/test-signal/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        testStatus = { active: false, targets: [] };
        try { await DSP.downloadConfig(); } catch (_) {}
        renderTargets();
        renderQuickFrequencies();
        renderGeneratorState();
        if (!silent) setPageStatus('Normal input and original routing restored.', 'ok');
        return true;
    } catch (error) {
        if (!silent) setPageStatus(`STOP ERROR: ${error.message}`, 'error');
        return false;
    }
}

async function initSignalGenerator() {
    DSP = await waitForDSP();
    await DSP.downloadConfig();

    renderTargets();
    renderQuickFrequencies();

    document.getElementById('testType').addEventListener('change', () => {
        const white = document.getElementById('testType').value === 'WhiteNoise';
        document.getElementById('testFrequency').disabled = white || !!testStatus.active;
        updateSafety();
    });
    document.getElementById('testLevel').addEventListener('change', updateSafety);
    document.getElementById('startTestSignal').addEventListener('click', startSignal);
    document.getElementById('stopTestSignal').addEventListener('click', () => stopSignal());

    await refreshStatus();
    setPageStatus('Ready. The internal generator enters before mixer, crossover, EQ, alignment and protection.', 'info');

    statusTimer = setInterval(async () => {
        const wasActive = !!testStatus.active;
        await refreshStatus();
        if (wasActive && !testStatus.active) {
            try { await DSP.downloadConfig(); } catch (_) {}
            renderTargets();
            renderQuickFrequencies();
            setPageStatus('Auto-stop completed; normal input restored.', 'ok');
        }
    }, 1000);

    window.addEventListener('pagehide', () => {
        if (!testStatus.active) return;
        try {
            navigator.sendBeacon('/api/test-signal/stop', new Blob(['{}'], { type: 'application/json' }));
        } catch (_) {
            fetch('/api/test-signal/stop', {
                method: 'POST',
                body: '{}',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true
            }).catch(() => {});
        }
    });
}

window.addEventListener('beforeunload', () => {
    if (statusTimer) clearInterval(statusTimer);
});
document.addEventListener('DOMContentLoaded', initSignalGenerator);
