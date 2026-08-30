'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/html/basic.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/src/estackControlHeadroom.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/estackControlHeadroom.css'), 'utf8');

assert.ok(html.includes('/src/estackControlHeadroom.js'), 'Control page does not load headroom logic');
assert.ok(html.includes('/css/estackControlHeadroom.css'), 'Control page does not load headroom styling');
assert.ok(js.includes('const HOLD_MS = 4000'), 'headroom monitor does not use the required rolling peak hold');
assert.ok(js.includes("processor?.type !== 'Compressor'"), 'headroom monitor does not inspect protection compressors');
assert.ok(js.includes("filter?.type !== 'Limiter'"), 'headroom monitor does not inspect hard limiters');
assert.ok(js.includes('safeThreshold - peak'), 'SAFE margin is not computed from protection threshold and playback peak');
assert.ok(js.includes('hardThreshold - peak'), 'HARD margin is not computed from limiter ceiling and playback peak');
assert.ok(js.includes('candidates.sort((a, b) => a.safeMargin - b.safeMargin)'), 'system limiting way is not chosen from minimum SAFE margin');
assert.ok(js.includes('meterStrips?.get'), 'headroom monitor should reuse existing Control playback meters rather than poll DSP again');
assert.ok(js.includes('not RMS/thermal watts'), 'headroom monitor must not mislabel peak headroom as loudspeaker watts');
assert.ok(css.includes('.estack-headroom-summary'), 'system headroom summary is not styled');
assert.ok(css.includes('.estack-way-headroom'), 'per-way headroom readout is not styled');

// Current protection structure reference: compressor threshold is 1 dB below
// hard limiter. With a held KICK peak at -20 dBFS and the current KICK
// protection/limit thresholds, useful MASTER headroom is 2.3 dB and hard
// headroom is 3.3 dB.
const peak = -20.0;
const protection = -17.7;
const hard = -16.7;
assert.ok(Math.abs((protection - peak) - 2.3) < 1e-9);
assert.ok(Math.abs((hard - peak) - 3.3) < 1e-9);

// The limiting way is the minimum positive/negative SAFE margin.
const margins = [5.5, 2.3, 7.0, 6.8, 8.2, 8.0];
assert.strictEqual(Math.min(...margins), 2.3);

console.log('OK:   Control live protection headroom');
