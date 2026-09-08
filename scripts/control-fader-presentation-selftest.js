'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'public/prototypes/estack-ui/pages/control/fader-presentation.js');
const livePath = path.join(root, 'public/prototypes/estack-ui/pages/control/live-page.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), context, { filename: helperPath });
const fader = context.window.EStackControlFaderPresentation;

assert.ok(fader, 'Control fader presentation helper was not loaded');
for (const [value, position] of [[6, 4], [0, 18], [-12, 42], [-30, 68], [-60, 100]]) {
  assert.strictEqual(fader.positionPercent(value, -60, 6), position, `output fader anchor ${value} dB is wrong`);
  assert.strictEqual(fader.valueAtPosition(position, -60, 6), value, `output fader inverse anchor ${position}% is wrong`);
}
assert.strictEqual(fader.positionPercent(0, -50, 0), 0, 'MASTER 0 dB must be at the top of its linear fader');
assert.strictEqual(fader.positionPercent(-25, -50, 0), 50, 'MASTER linear midpoint is wrong');
assert.strictEqual(fader.positionPercent(-50, -50, 0), 100, 'MASTER -50 dB must be at the bottom of its linear fader');
assert.strictEqual(fader.roundToStep(-12.24, -50, 0, .5), -12, 'MASTER commits must quantize to 0.5 dB');
assert.strictEqual(fader.roundToStep(-12.26, -50, 0, .5), -12.5, 'MASTER commits must quantize to 0.5 dB');

const live = fs.readFileSync(livePath, 'utf8');
assert.match(live, /legacy-fader-handle/, 'live Control is missing the visible fader handle');
assert.match(live, /legacy-gain-scale/, 'live Control is missing the gain scale');
assert.match(live, /data-level-lock/, 'live Control is missing Level Lock');
assert.match(live, /estack\.control\.level\.locked/, 'Level Lock persistence key changed unexpectedly');
assert.match(live, /if \(isWayLocked\(key\)\) return;/, 'way-gain mutations are not guarded by Level Lock');
assert.match(live, /key === 'master' \? service\.setMaster\(value\) : service\.setWayGain/, 'MASTER no longer uses its dedicated mutation path');

console.log('OK:   Control fader presentation anchors, MASTER stepping and Level Lock surface');
