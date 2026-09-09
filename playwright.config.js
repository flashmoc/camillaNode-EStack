'use strict';

const { defineConfig } = require('@playwright/test');

const baseURL = process.env.ESTACK_E2E_BASE_URL || 'http://127.0.0.1:8080';
const target = new URL(baseURL);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
    throw new Error(`E-Stack E2E refuses non-local target '${baseURL}'. Run only against the Dev Container demo.`);
}

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 45_000,
    fullyParallel: false,
    // All live suites share one demo DSP and restore its configuration.
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL,
        browserName: 'chromium',
        headless: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    }
});
