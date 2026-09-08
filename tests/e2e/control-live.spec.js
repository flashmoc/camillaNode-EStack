'use strict';

const { test, expect } = require('@playwright/test');
const WebSocket = require('ws');

const baseURL = process.env.ESTACK_E2E_BASE_URL || 'http://127.0.0.1:8080';
const target = new URL(baseURL);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function assertLocalLinuxDemo() {
    if (process.platform !== 'linux') throw new Error('E-Stack E2E must run inside the Linux Dev Container.');
    if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) throw new Error(`E-Stack E2E refuses non-local target '${baseURL}'.`);
}

function dspCommand(command, timeoutMs = 5_000) {
    const name = typeof command === 'string' ? command : Object.keys(command || {})[0];
    if (!name) return Promise.reject(new Error('Invalid CamillaDSP command.'));
    const endpoint = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}/ws/dsp`;
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(endpoint);
        const finish = (error, value) => {
            clearTimeout(timer);
            socket.removeAllListeners();
            try { socket.close(); } catch (_) {}
            if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error(`${name} timed out through CamillaNode /ws/dsp.`)), timeoutMs);
        socket.once('error', error => finish(error));
        socket.once('open', () => socket.send(JSON.stringify(command)));
        socket.on('message', raw => {
            let reply;
            try { reply = JSON.parse(String(raw)); } catch (_) { return; }
            if (!Object.prototype.hasOwnProperty.call(reply, name)) return;
            const result = reply[name] || {};
            if (result.result !== 'Ok') return finish(new Error(result.value || `${name} failed.`));
            let value = result.value;
            if (name === 'GetConfigJson' && typeof value === 'string') {
                try { value = JSON.parse(value); } catch (_) { return finish(new Error('CamillaDSP returned invalid configuration JSON.')); }
            }
            finish(null, value);
        });
    });
}

async function requireDemoRuntime(request) {
    assertLocalLinuxDemo();
    const response = await request.get('/api/runtime');
    expect(response.ok()).toBeTruthy();
    const runtime = await response.json();
    expect(runtime).toMatchObject({ mode: 'demo', httpPort: 8080, dspPort: 1234, spectrumPort: 6413 });
}

async function controlFrame(page) {
    await expect.poll(() => page.frames().some(frame => new URL(frame.url()).pathname.endsWith('/pages/control/page.html'))).toBeTruthy();
    return page.frames().find(frame => new URL(frame.url()).pathname.endsWith('/pages/control/page.html'));
}

function assertOnlySubGainChanged(before, after, targetGain) {
    expect(after.devices).toEqual(before.devices);
    expect(after.mixers).toEqual(before.mixers);
    expect(after.pipeline).toEqual(before.pipeline);
    expect(after.processors).toEqual(before.processors);
    expect(Object.keys(after.filters).sort()).toEqual(Object.keys(before.filters).sort());
    for (const name of Object.keys(before.filters)) {
        if (name === 'sub_gain') continue;
        expect(after.filters[name]).toEqual(before.filters[name]);
    }
    const originalSub = clone(before.filters.sub_gain);
    const changedSub = clone(after.filters.sub_gain);
    delete originalSub.parameters.gain;
    delete changedSub.parameters.gain;
    expect(changedSub).toEqual(originalSub);
    expect(after.filters.sub_gain.parameters.mute).toBe(before.filters.sub_gain.parameters.mute);
    expect(after.filters.sub_gain.parameters.gain).toBeCloseTo(targetGain, 6);
}

async function setSubGainThroughProduct(frame, targetGain) {
    const control = frame.locator('input[data-number="0"]');
    await expect(control).toBeVisible();
    await control.fill(targetGain.toFixed(1));
    await control.press('Tab');
}

test.describe('Control live CamillaNode demo', () => {
    test('renders live Control and restores a narrow SUB gain round trip', async ({ page, request }) => {
        await requireDemoRuntime(request);
        const original = await dspCommand('GetConfigJson');
        const originalGain = Number(original?.filters?.sub_gain?.parameters?.gain);
        expect(Number.isFinite(originalGain)).toBeTruthy();
        const testGain = Math.max(-60, Math.min(6, Number((originalGain - 0.2).toFixed(1))));
        expect(testGain).not.toBe(originalGain);

        await page.goto('/estack-dsp/?transport=camillanode#control');
        await expect(page.locator('.prototype-banner')).toContainText('CAMILLANODE MODE');
        await expect(page.locator('.shell-context')).toContainText('DSP API READY');
        const frame = await controlFrame(page);
        await expect(frame.locator('.control-page')).toBeVisible();
        await expect.poll(() => frame.evaluate(() => ({
            mode: window.EStackDSPBridge?.mode,
            connected: window.EStackDSPBridge?.connected,
            page: document.documentElement.dataset.prototypePage
        }))).toEqual({ mode: 'camillanode', connected: true, page: 'control' });
        await expect(frame.locator('article.mixer-strip:not(.master-strip)')).toHaveCount(6);
        await expect(frame.locator('article.master-strip')).toHaveCount(1);
        await expect(frame.locator('[data-link-toggle]')).toHaveCount(2);
        await expect(frame.locator('[data-mute]')).toHaveCount(6);
        await expect(frame.locator('article.mixer-strip').filter({ hasText: 'OUT 7' })).toHaveCount(0);
        await expect(frame.locator('article.mixer-strip').filter({ hasText: 'OUT 8' })).toHaveCount(0);
        await expect.poll(() => frame.locator('[data-input-meter]').count()).toBeGreaterThan(0);

        let restoredByProduct = false;
        try {
            await setSubGainThroughProduct(frame, testGain);
            await expect.poll(async () => Number((await dspCommand('GetConfigJson')).filters.sub_gain.parameters.gain)).toBeCloseTo(testGain, 6);
            const changed = await dspCommand('GetConfigJson');
            assertOnlySubGainChanged(original, changed, testGain);

            await setSubGainThroughProduct(frame, originalGain);
            await expect.poll(async () => Number((await dspCommand('GetConfigJson')).filters.sub_gain.parameters.gain)).toBeCloseTo(originalGain, 6);
            const restored = await dspCommand('GetConfigJson');
            expect(restored).toEqual(original);
            restoredByProduct = true;
            console.log(`Control E2E SUB gain: ${originalGain.toFixed(1)} dB -> ${testGain.toFixed(1)} dB -> ${originalGain.toFixed(1)} dB`);
        } finally {
            // An assertion failure must not leave the demo altered. Prefer the
            // product path; the guarded same-origin proxy fallback restores the
            // exact captured demo snapshot only after the demo-only guard above.
            const live = await dspCommand('GetConfigJson');
            if (JSON.stringify(live) !== JSON.stringify(original)) {
                if (!restoredByProduct) {
                    try {
                        await setSubGainThroughProduct(frame, originalGain);
                        await expect.poll(async () => Number((await dspCommand('GetConfigJson')).filters.sub_gain.parameters.gain)).toBeCloseTo(originalGain, 6);
                    } catch (_) {
                        await dspCommand({ SetConfigJson: JSON.stringify(original) });
                    }
                } else {
                    await dspCommand({ SetConfigJson: JSON.stringify(original) });
                }
            }
            expect(await dspCommand('GetConfigJson')).toEqual(original);
        }
    });
});
