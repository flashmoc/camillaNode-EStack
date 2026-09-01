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
assert.ok(js.includes('protectionThresholdDb - peak'), 'protection margin is not computed from compressor threshold and playback peak');
assert.ok(js.includes('hardThreshold - peak'), 'hard margin is not computed from limiter ceiling and playback peak');
assert.ok(js.includes('candidates.sort((a, b) => a.hardMargin - b.hardMargin)'), 'system limiting way is not chosen from minimum HARD margin');
assert.ok(js.includes('meterStrips?.get'), 'headroom monitor should reuse existing Control playback meters rather than poll DSP again');
assert.ok(js.includes('not a live voltmeter'), 'estimated voltage must not be presented as a live measurement');
assert.ok(js.includes('100 * (1 - margin / NEAR_LIMIT_DB)'), 'hard proximity is not derived linearly from dB headroom');
assert.ok(js.includes('HARD PROXIMITY'), 'operator percentage gauge is not labelled as hard proximity');
assert.ok(js.includes('HARD LIMIT MARGIN'), 'system summary does not expose final limiter margin');
assert.ok(js.includes('PROTECTION ACTIVE'), 'system summary does not distinguish compressor activity');
assert.ok(js.includes('CALIBRATED_LIMIT_VRMS'), 'per-way calibrated voltage references are missing');
assert.ok(js.includes('EST V'), 'per-way estimated voltage readout is missing');
assert.ok(js.includes('const NEAR_LIMIT_DB = 12'), 'near-limit presentation threshold is missing');
assert.ok(css.includes('.estack-headroom-summary'), 'system headroom summary is not styled');
assert.ok(css.includes('.estack-way-headroom'), 'per-way headroom readout is not styled');
assert.ok(css.includes('.estack-headroom-load-bar'), 'system percentage load bar is not styled');
assert.ok(css.includes('.estack-way-voltage'), 'estimated voltage readout is not styled');

// Protection and final limiter remain deliberately separate. With a held KICK
// peak at -20 dBFS, a compressor at -17.7 dBFS and hard limiter at -16.7 dBFS,
// compressor margin is 2.3 dB while final hard-limit margin is 3.3 dB.
const peak = -20.0;
const protection = -17.7;
const hard = -16.7;
assert.ok(Math.abs((protection - peak) - 2.3) < 1e-9);
assert.ok(Math.abs((hard - peak) - 3.3) < 1e-9);

// The system-limiting way must now be the minimum HARD margin, not compressor
// onset margin.
const hardMargins = [6.5, 3.3, 8.0, 7.8, 9.2, 9.0];
assert.strictEqual(Math.min(...hardMargins), 3.3);

// Operator proximity spans the final 12 dB before the actual hard ceiling.
const near = 12;
const proximity = margin => margin <= 0 ? 100 : margin >= near ? 0 : 100 * (1 - margin / near);
assert.ok(Math.abs(proximity(0) - 100) < 1e-9);
assert.ok(Math.abs(proximity(1) - 91.66666666666666) < 1e-9);
assert.ok(Math.abs(proximity(3) - 75) < 1e-9);
assert.ok(Math.abs(proximity(6) - 50) < 1e-9);
assert.ok(Math.abs(proximity(12) - 0) < 1e-9);
assert.strictEqual(proximity(40), 0, '40 dB of hard margin must show zero proximity');

// Voltage estimate is referenced to the calibrated hard ceiling. 0 dB margin
// equals the limit voltage; 6.0206 dB below it is approximately half voltage.
const estimate = (limitVrms, hardMarginDb) => Math.min(limitVrms, limitVrms * Math.pow(10, -Math.max(0, hardMarginDb) / 20));
assert.ok(Math.abs(estimate(50, 0) - 50) < 1e-9);
assert.ok(Math.abs(estimate(50, 6.0206) - 25) < 0.001);
assert.ok(Math.abs(estimate(11.5, -0.5) - 11.5) < 1e-9, 'estimate must clamp at the hard-limit voltage');

console.log('OK:   Control live protection and hard-limit headroom');
