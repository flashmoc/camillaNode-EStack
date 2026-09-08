'use strict';

const { test, expect } = require('@playwright/test');
const WebSocket = require('ws');

const baseURL = process.env.ESTACK_E2E_BASE_URL || 'http://127.0.0.1:8080';
const target = new URL(baseURL);
const globalNames = Array.from({ length: 10 }, (_, index) => `GLOBAL_EQ_${String(index + 1).padStart(2, '0')}`);
const GLOBAL_STEP = 'E-Stack global input EQ';
const DELAY_STEP = 'E-Stack input delay';
const DELAY_FILTER = 'ESTACK_INPUT_DELAY';
const clone = value => JSON.parse(JSON.stringify(value));

function assertLocalLinuxDemo() {
  if (process.platform !== 'linux') throw new Error('E-Stack E2E must run inside the Linux Dev Container.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) throw new Error(`E-Stack E2E refuses non-local target '${baseURL}'.`);
}
function dspCommand(command, timeoutMs = 5_000) {
  const name = typeof command === 'string' ? command : Object.keys(command || {})[0];
  const endpoint = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}/ws/dsp`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint); const finish = (error, value) => { clearTimeout(timer); socket.removeAllListeners(); try { socket.close(); } catch (_) {} error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(`${name} timed out through CamillaNode /ws/dsp.`)), timeoutMs);
    socket.once('error', error => finish(error)); socket.once('open', () => socket.send(JSON.stringify(command)));
    socket.on('message', raw => { let reply; try { reply = JSON.parse(String(raw)); } catch (_) { return; } if (!Object.prototype.hasOwnProperty.call(reply, name)) return; const result = reply[name] || {}; if (result.result !== 'Ok') return finish(new Error(result.value || `${name} failed.`)); let value = result.value; if (name === 'GetConfigJson' && typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return finish(new Error('CamillaDSP returned invalid configuration JSON.')); } } finish(null, value); });
  });
}
async function requireDemoRuntime(request) {
  assertLocalLinuxDemo(); const response = await request.get('/api/runtime'); expect(response.ok()).toBeTruthy(); expect(await response.json()).toMatchObject({ mode: 'demo', httpPort: 8080, dspPort: 1234, spectrumPort: 6413 });
}
async function inputFrame(page) {
  await expect.poll(() => page.frames().some(frame => new URL(frame.url()).pathname.endsWith('/pages/input-processing/page.html'))).toBeTruthy();
  return page.frames().find(frame => new URL(frame.url()).pathname.endsWith('/pages/input-processing/page.html'));
}
function protectedView(config) {
  const next = clone(config); globalNames.forEach(name => delete next.filters[name]); delete next.filters[DELAY_FILTER]; next.pipeline = next.pipeline.filter(step => step.description !== GLOBAL_STEP && step.description !== DELAY_STEP); return next;
}
function assertEqScope(before, after, expectedGain) {
  expect(protectedView(after)).toEqual(protectedView(before));
  expect(after.filters.GLOBAL_EQ_01.parameters.gain).toBeCloseTo(expectedGain, 6);
  const step = after.pipeline.find(entry => entry.description === GLOBAL_STEP); expect(step).toMatchObject({ type: 'Filter', channels: [0, 1], names: ['GLOBAL_EQ_01'], bypassed: false });
  expect(after.pipeline.indexOf(step)).toBeLessThan(after.pipeline.findIndex(entry => entry.type === 'Mixer'));
}

test.describe('Input Processing live CamillaNode demo', () => {
  test('round trips Global EQ and Input Delay through the product and restores the exact demo configuration', async ({ page, request }) => {
    await requireDemoRuntime(request); const original = await dspCommand('GetConfigJson'); const originalEq = original.filters.GLOBAL_EQ_01?.parameters?.gain ?? 0; expect(Number(originalEq)).toBeGreaterThanOrEqual(-12); expect(Number(originalEq)).toBeLessThanOrEqual(12);
    expect(Number(original.filters[DELAY_FILTER]?.parameters?.delay || 0)).toBe(0);
    const testGain = Number(originalEq) >= 11.8 ? Number((Number(originalEq) - .2).toFixed(1)) : Number((Number(originalEq) + .2).toFixed(1));
    const keys = globalNames.map(name => `estack.globalEq.disabled.${name}`); const storage = {};
    await page.goto('/estack-dsp/?transport=camillanode#input-processing'); keys.forEach(key => { storage[key] = null; });
    for (const key of keys) storage[key] = await page.evaluate(item => window.localStorage.getItem(item), key);
    await page.evaluate(items => items.forEach(key => window.localStorage.removeItem(key)), keys); await page.reload();
    let frame = await inputFrame(page); let restoredByProduct = false;
    try {
      await expect(page.locator('.prototype-banner')).toContainText('CAMILLANODE MODE'); await expect(page.locator('.shell-context')).toContainText('DSP API READY');
      await expect.poll(() => frame.evaluate(() => ({ mode: window.EStackDSPBridge?.mode, page: document.documentElement.dataset.prototypePage, mock: !!window.EStackPrototypeDSP }))).toEqual({ mode: 'camillanode', page: 'input-processing', mock: false });
      await expect(frame.locator('.eq-band')).toHaveCount(10); await expect(frame.locator('[data-knob="GLOBAL_EQ_01"]')).toHaveCount(3); await expect(frame.locator('#spectrumState')).toHaveClass(/is-live/);
      const gain = frame.locator('[data-input-slot="GLOBAL_EQ_01"][data-field="gain"]'); await gain.fill(String(testGain)); await gain.press('Tab');
      await expect.poll(async () => Number((await dspCommand('GetConfigJson')).filters.GLOBAL_EQ_01?.parameters?.gain)).toBeCloseTo(testGain, 6);
      const eqChanged = await dspCommand('GetConfigJson'); assertEqScope(original, eqChanged, testGain);
      const delay = frame.locator('#delayNumber'); await delay.fill('1.0'); await delay.press('Tab');
      await expect.poll(async () => Number((await dspCommand('GetConfigJson')).filters[DELAY_FILTER]?.parameters?.delay)).toBeCloseTo(1, 6);
      const delayChanged = await dspCommand('GetConfigJson'); expect(protectedView(delayChanged)).toEqual(protectedView(original)); expect(delayChanged.pipeline.find(step => step.description === DELAY_STEP)).toMatchObject({ type: 'Filter', channels: [0, 1], names: [DELAY_FILTER], bypassed: false });
      await delay.fill('0'); await delay.press('Tab'); await expect.poll(async () => (await dspCommand('GetConfigJson')).filters[DELAY_FILTER]).toBeUndefined();
      await gain.fill(String(originalEq)); await gain.press('Tab'); await expect.poll(async () => (await dspCommand('GetConfigJson')).filters.GLOBAL_EQ_01?.parameters?.gain ?? 0).toBeCloseTo(Number(originalEq), 6);
      expect(await dspCommand('GetConfigJson')).toEqual(original); restoredByProduct = true;
      console.log(`Input E2E GLOBAL_EQ_01 gain: ${Number(originalEq).toFixed(1)} dB -> ${testGain.toFixed(1)} dB -> ${Number(originalEq).toFixed(1)} dB`); console.log('Input E2E delay: 0.0 ms -> 1.0 ms -> 0.0 ms');
    } finally {
      const live = await dspCommand('GetConfigJson'); if (JSON.stringify(live) !== JSON.stringify(original)) {
        if (!restoredByProduct) { try { await dspCommand({ SetConfigJson: JSON.stringify(original) }); } catch (_) {} } else await dspCommand({ SetConfigJson: JSON.stringify(original) });
      }
      expect(await dspCommand('GetConfigJson')).toEqual(original);
      await page.evaluate(items => items.forEach(({ key, value }) => value === null ? window.localStorage.removeItem(key) : window.localStorage.setItem(key, value)), Object.entries(storage).map(([key, value]) => ({ key, value })));
    }
  });
});
