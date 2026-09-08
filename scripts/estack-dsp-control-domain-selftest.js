'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/prototypes/estack-ui/shared/domain/control-model.js'), 'utf8');
const context = { window: {}, console };
vm.runInNewContext(source, context, { filename: 'control-model.js' });
const M = context.window.EStackControlModel;

const gain = value => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted: false, mute: false } });
const limiter = value => ({ type: 'Limiter', parameters: { clip_limit: value } });
const peq = () => ({ type: 'Biquad', parameters: { type: 'Peaking', freq: 800, gain: 2, q: 1.1 } });
const crossover = () => ({ type: 'BiquadCombo', parameters: { type: 'LinkwitzRileyHighpass', freq: 180, order: 4 } });
function fixture() {
  return {
    devices: { capture: { type: 'Alsa', channels: 2 }, playback: { type: 'Alsa', channels: 6 } },
    mixers: { estack: { channels: { in: 2, out: 6 }, mapping: [{ dest: 0, sources: [{ channel: 0, gain: 0, mute: false }] }] } },
    processors: { protect: { type: 'Compressor', parameters: { process_channels: [0], threshold: -8 } } },
    filters: { subGain: gain(-12), subLimiter: limiter(-3), subXo: crossover(), subPeq: peq(), kickGain: gain(-16) },
    pipeline: [
      { type: 'Mixer', name: 'estack' }, { type: 'Processor', name: 'protect' },
      { type: 'Filter', channel: 0, names: ['subXo', 'subPeq', 'subGain', 'subLimiter'] },
      { type: 'Filter', channel: 1, names: ['kickGain'] }
    ]
  };
}
const mutate = (base, callback) => { const next = M.clone(base); callback(next); return next; };
const base = fixture();
const narrow = mutate(base, next => { next.filters.subGain.parameters.gain = -10; next.filters.subGain.parameters.mute = true; });
assert.doesNotThrow(() => M.assertOnlyWayGainChanged(base, narrow, [{ channel: 0, name: 'subGain', filter: base.filters.subGain }]));
for (const [label, callback] of [
  ['devices', next => { next.devices.playback.channels = 8; }],
  ['mixer routing', next => { next.mixers.estack.mapping[0].sources[0].mute = true; }],
  ['crossover', next => { next.filters.subXo.parameters.freq = 200; }],
  ['PEQ', next => { next.filters.subPeq.parameters.gain = 4; }],
  ['limiter', next => { next.filters.subLimiter.parameters.clip_limit = -6; }],
  ['protection', next => { next.processors.protect.parameters.threshold = -12; }]
]) {
  assert.throws(() => M.assertOnlyWayGainChanged(base, mutate(base, callback), [{ channel: 0, name: 'subGain', filter: base.filters.subGain }]), new RegExp('unexpectedly'), `${label} mutation was not rejected`);
}
const trimBase = fixture();
const trimNext = M.installInputTrim(M.clone(trimBase), 4.5);
assert.doesNotThrow(() => M.assertOnlyInputTrimChanged(trimBase, trimNext));
assert.strictEqual(M.inputTrimValue(trimNext), 4.5);
assert.throws(() => M.assertOnlyInputTrimChanged(trimBase, mutate(trimNext, next => { next.filters.subPeq.parameters.q = 2; })), /outside Input Trim/);
assert.strictEqual(M.hardLimitForChannel(base, 0).clip, -3);
assert.strictEqual(M.protectionForChannel(base, 0).threshold, -8);

const liveSource = fs.readFileSync(path.join(root, 'public/prototypes/estack-ui/pages/control/live-page.js'), 'utf8');
assert.ok(liveSource.includes('EStackControlService'), 'Control live page bypasses shared domain service');
assert.ok(!liveSource.includes('EStackPageFixtures'), 'Control live page reads fixture operational values');
assert.ok(!liveSource.includes('SetConfigJson'), 'Control live page owns DSP mutation logic');
console.log('OK:   E-Stack DSP Control scoped domain transactions');
