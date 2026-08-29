'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
let failures = 0;

function fail(message) {
    failures += 1;
    console.error(`FAIL: ${message}`);
}

function ok(message) {
    console.log(`OK:   ${message}`);
}

function exists(relative) {
    return fs.existsSync(path.join(ROOT, relative));
}

function checkRequired(relative) {
    if (!exists(relative)) fail(`missing ${relative}`);
}

const required = [
    'index.js',
    'server/signalGenerator.js',
    'server/startupConfiguration.js',
    'server/wiimLoudnessApi.js',
    'scripts/wiim-loudness-service.js',
    'scripts/install-wiim-loudness.sh',
    'wiimLoudnessConfig.example.json',
    'public/html/main.html',
    'public/html/basic.html',
    'public/html/loudness.html',
    'public/html/global-eq.html',
    'public/html/equalizer.html',
    'public/html/signal-generator.html',
    'public/html/advanced.html',
    'public/html/preferences.html',
    'public/html/connections.html',
    'public/src/estackConfigManagerFix.js',
    'public/src/estackPeqModel.js',
    'public/src/estackOutputPeq.js',
    'public/src/estackOutputPhase.js',
    'public/src/estackPhaseGraph.js',
    'public/css/estackSignalGenerator.css',
    'public/css/estackPhaseGraph.css'
];
required.forEach(checkRequired);

const forbiddenTracked = [
    'public/html/per-way.html',
    'public/src/estackPerWay.js',
    'public/css/estackPerWay.css',
    'public/src/estackPeqIsolationFix.js',
    'public/src/estackDynamicPeq.js',
    'public/src/estackOutputPresetGuard.js',
    'views',
    'install.sh',
    '_dev.log'
];

function trackedFiles() {
    try {
        return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
            .split(/\r?\n/)
            .filter(Boolean);
    } catch (error) {
        fail(`git ls-files failed: ${error.message}`);
        return [];
    }
}

const tracked = trackedFiles();
for (const forbidden of forbiddenTracked) {
    if (tracked.some(file => file === forbidden || file.startsWith(`${forbidden}/`))) {
        fail(`legacy path is still tracked: ${forbidden}`);
    }
}

for (const runtime of [
    'camillaNodeConfig.json', 'currentConfig.json', 'savedConfigs.dat', 'startupConfig.json',
    'wiimLoudnessConfig.json', 'wiimLoudnessStatus.json'
]) {
    if (tracked.includes(runtime)) fail(`runtime file must not be tracked: ${runtime}`);
}
for (const file of tracked.filter(file => file.startsWith('config/') && file !== 'config/.gitkeep')) {
    fail(`runtime config must not be tracked: ${file}`);
}

const activeHtml = [
    'main.html', 'basic.html', 'loudness.html', 'global-eq.html', 'equalizer.html',
    'signal-generator.html', 'advanced.html', 'preferences.html', 'connections.html'
];
const assetPattern = /(?:src|href)=["'](\/(?:src|css|img)\/[^"'#?]+)["']/g;
for (const file of activeHtml) {
    const full = path.join(PUBLIC, 'html', file);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, 'utf8');
    for (const match of html.matchAll(assetPattern)) {
        const asset = path.join(PUBLIC, match[1].replace(/^\//, ''));
        if (!fs.existsSync(asset)) fail(`${file} references missing asset ${match[1]}`);
    }
}

const mainHtml = fs.readFileSync(path.join(PUBLIC, 'html', 'main.html'), 'utf8');
if (!mainHtml.includes('target="/signal-generator"')) fail('main navigation is missing /signal-generator');
if (mainHtml.includes('target="/per-way"')) fail('main navigation still exposes legacy /per-way');
if (!mainHtml.includes('System Configurations')) fail('main navigation is missing system configuration manager label');
if (!mainHtml.includes('id="presetInd"')) fail('header is missing active preset indicator');
if (mainHtml.includes('estackOutputPresetGuard.js')) fail('obsolete page-scoped output preset layer is still loaded');

const serverSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
if (!serverSource.includes("app.get('/signal-generator'")) fail('server is missing /signal-generator route');
if (!serverSource.includes("app.get('/per-way'")) fail('legacy /per-way redirect is missing');
if (!serverSource.includes("require('./server/signalGenerator')")) fail('signal generator backend is not isolated under server/');
if (!serverSource.includes("require('./server/startupConfiguration')")) fail('startup configuration backend is not registered');
if (!serverSource.includes("require('./server/wiimLoudnessApi')")) fail('WiiM loudness backend is not registered');

const loudnessSource = fs.readFileSync(path.join(PUBLIC, 'src', 'estackLoudness.js'), 'utf8');
if (!loudnessSource.includes('ESTACK_LOUDNESS_FADER = "Aux1"')) fail('Loudness UI is not Aux1-linked');
if (!loudnessSource.includes('/api/loudness/bridge')) fail('Loudness UI is missing bridge status monitoring');
if (!loudnessSource.includes('/api/loudness/settings')) fail('Loudness UI is missing curve settings API');

const configManagerSource = fs.readFileSync(path.join(PUBLIC, 'src', 'estackConfigManagerFix.js'), 'utf8');
if (!configManagerSource.includes('/api/startup-config')) fail('system configuration UI is missing startup configuration API');
if (!configManagerSource.includes('/api/startup-config/active')) fail('system configuration UI is missing active preset tracking');

for (const file of [
    'index.js',
    'server/signalGenerator.js',
    'server/startupConfiguration.js',
    'server/wiimLoudnessApi.js',
    'scripts/wiim-loudness-service.js',
    'scripts/repo-check.js',
    'public/src/estackConfigManagerFix.js',
    'public/src/estackLoudness.js'
]) {
    try {
        execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
    } catch (error) {
        fail(`syntax check failed for ${file}: ${String(error.stderr || error.message).trim()}`);
    }
}

if (failures) {
    console.error(`\nE-Stack repository check failed: ${failures} issue(s).`);
    process.exit(1);
}

ok('active UI assets resolve');
ok('legacy duplicate paths are not tracked');
ok('runtime state is repository-independent');
ok('startup configuration integration is present');
ok('WiiM loudness bridge integration is present');
ok('server-side JavaScript parses');
console.log('\nE-Stack repository check passed.');
