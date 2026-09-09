'use strict';

const { test, expect } = require('@playwright/test');
const WebSocket = require('ws');

const baseURL = process.env.ESTACK_E2E_BASE_URL || 'http://127.0.0.1:8080';
const target = new URL(baseURL);
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
async function outputFrame(page) {
  await expect.poll(() => page.frames().some(frame => new URL(frame.url()).pathname.endsWith('/pages/output-processing/page.html'))).toBeTruthy();
  return page.frames().find(frame => new URL(frame.url()).pathname.endsWith('/pages/output-processing/page.html'));
}
function stage(config, channel, matcher) { return config.pipeline.find(entry => entry.type === 'Filter' && (entry.channels || []).map(Number).includes(channel) && matcher(entry)); }
function protectedView(config, allowedFilter, selectedStage) {
  const next = clone(config); delete next.filters[allowedFilter]; if (selectedStage) { const copy = next.pipeline[next.pipeline.indexOf(selectedStage)]; copy.names = copy.names.filter(name => name !== allowedFilter); } return next;
}

test.describe('Output Processing live CamillaNode demo', () => {
  test('round trips a shared MID crossover and a temporary MID L PEQ through the product', async ({ page, request }) => {
    await requireDemoRuntime(request); const original = await dspCommand('GetConfigJson');
    await page.goto('/estack-dsp/?transport=camillanode#output-processing'); const frame = await outputFrame(page);
    try {
      await expect(page.locator('.prototype-banner')).toContainText('CAMILLANODE MODE');
      await expect.poll(() => frame.evaluate(() => ({ mode: window.EStackDSPBridge?.mode, page: document.documentElement.dataset.prototypePage, mock: !!window.EStackPrototypeFixtures || !!window.EStackPrototypeDSP }))).toEqual({ mode: 'camillanode', page: 'output-processing', mock: false });
      await expect(frame.locator('.way-card')).toHaveCount(6); await expect(frame.locator('[data-way-channel="6"],[data-way-channel="7"]')).toHaveCount(0);
      await expect(frame.locator('button[data-graph-mode="magnitude"]')).toBeVisible(); await expect(frame.locator('#responseGraph')).toHaveAttribute('data-graph-mode', 'magnitude');
      const graphOnlyConfig = await dspCommand('GetConfigJson');
      await frame.locator('button[data-graph-mode="phase"]').click(); await expect(frame.locator('#responseGraph')).toHaveAttribute('data-graph-mode', 'phase');
      await frame.locator('button[data-graph-mode="xo"]').click(); await frame.locator('#xoPair').selectOption('sub-kick'); await expect(frame.locator('#xoReadout')).toContainText('SUB / KICK');
      await frame.locator('button[data-graph-mode="magnitude"]').click(); await frame.locator('#analyzerEnabled').check(); await expect.poll(() => frame.locator('#analyzerStatus').textContent()).toMatch(/LIVE|UNAVAILABLE/);
      expect(await dspCommand('GetConfigJson')).toEqual(graphOnlyConfig);
      await expect(frame.locator('#systemEdit')).toContainText('LOCKED'); await expect(frame.locator('[data-xo-freq="hpf"]')).toBeDisabled();
      const originalMid = original.filters.mid_hpf_300_lr24.parameters.freq; const lockedView = await dspCommand('GetConfigJson');
      await frame.locator('[data-xo-freq="hpf"]').evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('change', { bubbles: true })); }, originalMid + 1);
      await page.waitForTimeout(200); expect(await dspCommand('GetConfigJson')).toEqual(lockedView);

      await frame.locator('#systemEdit').click(); await frame.locator('[data-way-channel="2"]').click(); await expect(frame.locator('[data-xo-freq="hpf"]')).toBeEnabled();
      const midLStageOriginal = stage(original, 2, entry => entry.names.includes('mid_l_gain')); const midRStageOriginal = stage(original, 3, entry => entry.names.includes('mid_r_gain'));
      await frame.locator('[data-xo-freq="hpf"]').fill(String(originalMid + 1)); await frame.locator('[data-xo-freq="hpf"]').press('Tab');
      await expect.poll(async () => (await dspCommand('GetConfigJson')).filters.mid_hpf_300_lr24.parameters.freq).toBe(originalMid + 1);
      const crossoverChanged = await dspCommand('GetConfigJson'); const midLStageChanged = stage(crossoverChanged, 2, entry => entry.names.includes('mid_l_gain')); const midRStageChanged = stage(crossoverChanged, 3, entry => entry.names.includes('mid_r_gain'));
      expect(midLStageChanged.names).toEqual(midLStageOriginal.names); expect(midRStageChanged.names).toEqual(midRStageOriginal.names); expect(midLStageChanged.names).toContain('mid_hpf_300_lr24'); expect(midRStageChanged.names).toContain('mid_hpf_300_lr24');
      await frame.locator('[data-xo-freq="hpf"]').fill(String(originalMid)); await frame.locator('[data-xo-freq="hpf"]').press('Tab'); await expect.poll(async () => (await dspCommand('GetConfigJson')).filters.mid_hpf_300_lr24.parameters.freq).toBe(originalMid);
      console.log(`Output E2E shared MID HPF: ${originalMid} Hz -> ${originalMid + 1} Hz -> ${originalMid} Hz`);

      const temporarySlot = Array.from({ length: 10 }, (_, slot) => slot).find(slot => !original.filters[`USER_CH2_PEQ_${String(slot + 1).padStart(2, '0')}`]); const temporaryName = `USER_CH2_PEQ_${String(temporarySlot + 1).padStart(2, '0')}`;
      await frame.locator('#addPeq').click(); await expect(frame.locator(`[data-peq-slot="${temporarySlot}"]`)).toHaveCount(1);
      const gain = frame.locator(`[data-peq-field="gain"][data-slot="${temporarySlot}"]`); await gain.fill('1'); await gain.press('Tab');
      await expect.poll(async () => (await dspCommand('GetConfigJson')).filters[temporaryName]?.parameters?.gain).toBe(1);
      const peqChanged = await dspCommand('GetConfigJson'); const midLPeqStage = stage(peqChanged, 2, entry => entry.names.includes('mid_l_gain')); const midRPeqStage = stage(peqChanged, 3, entry => entry.names.includes('mid_r_gain'));
      expect(midLPeqStage.names.indexOf(temporaryName)).toBeLessThan(midLPeqStage.names.indexOf('mid_l_gain')); expect(midRPeqStage.names).not.toContain(temporaryName);
      await frame.locator(`[data-peq-delete="${temporarySlot}"]`).click(); await expect.poll(async () => (await dspCommand('GetConfigJson')).filters[temporaryName]).toBeUndefined();
      expect(await dspCommand('GetConfigJson')).toEqual(original); console.log(`Output E2E MID L PEQ: ${temporaryName} added at +1.0 dB then deleted.`);
    } finally {
      const current = await dspCommand('GetConfigJson'); if (JSON.stringify(current) !== JSON.stringify(original)) await dspCommand({ SetConfigJson: JSON.stringify(original) });
      expect(await dspCommand('GetConfigJson')).toEqual(original);
    }
  });
});
