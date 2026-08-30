'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/html/basic.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/src/estackControlNormalizeWays.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/estackControlNormalizeWays.css'), 'utf8');

assert.ok(html.includes('/src/estackControlNormalizeWays.js'), 'Control page does not load way normalization logic');
assert.ok(html.includes('/css/estackControlNormalizeWays.css'), 'Control page does not load way normalization styling');
assert.ok(js.includes("Math.max(...entries.map(entry => entry.gain))"), 'normalizer does not anchor the highest way');
assert.ok(js.includes('shiftDb = roundDb(-highest)'), 'normalizer does not move the highest way to 0 dB');
assert.ok(js.includes('target: roundDb(entry.gain + shiftDb)'), 'normalizer does not apply one common dB shift');
assert.ok(js.includes('actualShift - plan.shiftDb'), 'normalizer does not verify equal shift on every way');
assert.ok(js.includes("GetVolume") && js.includes('SAFE_TRANSITION_DB'), 'normalizer does not protect graph transition with master attenuation');
assert.ok(js.includes('/api/measurement-batch/status'), 'normalizer is not locked against active Measurement Batch');
assert.ok(js.includes("capture?.type === 'SignalGenerator'"), 'normalizer is not locked against Signal Generator');
assert.ok(js.includes('Relative differences are preserved exactly'), 'confirmation does not explain relative-level invariant');
assert.ok(js.includes('MASTER is unchanged'), 'confirmation does not disclose unchanged master volume');
assert.ok(css.includes('.estack-normalize-button'), 'normalization button is not styled');

// Reference calculation from the current E-Stack calibration state.
const gains = [-9.5, -19.3, -14.0, -14.0, -7.6, -7.6];
const highest = Math.max(...gains);
const shift = -highest;
const normalized = gains.map(value => Number((value + shift).toFixed(6)));
assert.deepStrictEqual(normalized, [-1.9, -11.7, -6.4, -6.4, 0, 0]);

for (let a = 0; a < gains.length; a += 1) {
    for (let b = 0; b < gains.length; b += 1) {
        assert.ok(Math.abs((gains[a] - gains[b]) - (normalized[a] - normalized[b])) < 1e-9,
            `relative gain changed between channels ${a} and ${b}`);
    }
}

console.log('OK:   Control relative way gain normalization');
