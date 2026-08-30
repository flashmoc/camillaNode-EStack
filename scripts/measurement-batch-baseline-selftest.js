'use strict';

const assert = require('assert');
const { summarizeBaseline, processingFingerprint } = require('../server/measurementBatchBaseline');

const config = {
    devices: { samplerate: 48000 },
    filters: {
        GLOBAL_EQ_162: { type: 'Biquad', parameters: { type: 'Peaking', freq: 162, gain: -4, q: 0.7 } },
        ESTACK_LOUDNESS: { type: 'Loudness', description: 'E-Stack loudness · HOME', parameters: { fader: 'Aux1', reference_level: -10, low_boost: 6, high_boost: 2.5 } },
        kick_lpf: { type: 'BiquadCombo', parameters: { type: 'LinkwitzRileyLowpass', freq: 300, order: 4 } },
        kick_peq: { type: 'Biquad', parameters: { type: 'Peaking', freq: 420, gain: -2.5, q: 1.1 } },
        kick_gain: { type: 'Gain', parameters: { gain: -19.3, scale: 'dB', inverted: true, mute: false } },
        mid_hpf: { type: 'BiquadCombo', parameters: { type: 'LinkwitzRileyHighpass', freq: 300, order: 4 } },
        mid_peq_shared: { type: 'Biquad', parameters: { type: 'Peaking', freq: 520, gain: -1.5, q: 1.4 } },
        mid_l_gain: { type: 'Gain', parameters: { gain: -14, scale: 'dB', inverted: false, mute: false } },
        mid_r_gain: { type: 'Gain', parameters: { gain: -14, scale: 'dB', inverted: false, mute: false } }
    },
    mixers: {
        estack: {
            channels: { in: 8, out: 8 },
            mapping: []
        }
    },
    processors: {},
    pipeline: [
        { type: 'Filter', channels: [0, 1], names: ['GLOBAL_EQ_162', 'ESTACK_LOUDNESS'] },
        { type: 'Mixer', name: 'estack' },
        { type: 'Filter', channels: [1], names: ['kick_lpf', 'kick_peq', 'kick_gain'] },
        { type: 'Filter', channels: [2], names: ['mid_hpf', 'mid_peq_shared', 'mid_l_gain'] },
        { type: 'Filter', channels: [3], names: ['mid_hpf', 'mid_peq_shared', 'mid_r_gain'] }
    ]
};

const summary = summarizeBaseline(config, {
    captured: true,
    capturedAt: '2026-08-30T08:00:00.000Z',
    measurementInput: 4
});

assert.strictEqual(summary.captured, true);
assert.strictEqual(summary.capturedAt, '2026-08-30T08:00:00.000Z');
assert.strictEqual(summary.measurementInput, 4);
assert.strictEqual(summary.sharedInputMirrored, true);
assert.strictEqual(summary.counts.inputEq, 1);
assert.strictEqual(summary.counts.sharedInputEq, 1);
assert.strictEqual(summary.input.eqFilters[0].name, 'GLOBAL_EQ_162');
assert.strictEqual(summary.input.eqFilters[0].freqHz, 162);
assert.strictEqual(summary.input.eqFilters[0].gainDb, -4);
assert.strictEqual(summary.input.eqFilters[0].q, 0.7);
assert.strictEqual(summary.input.dynamicFilters[0].name, 'ESTACK_LOUDNESS');
assert.strictEqual(summary.input.dynamicFilters[0].kind, 'forced-off');
assert.deepStrictEqual(summary.measurementPolicy.forcedOffFilters, ['ESTACK_LOUDNESS']);
assert.strictEqual(summary.measurementPolicy.loudness, 'forced-off');
assert.ok(!summary.warnings.some(text => /ESTACK_LOUDNESS|Dynamic input processing/.test(text)), 'forced-off loudness must not be presented as an active-measurement warning');
assert.match(summary.input.dynamicFilters[0].description, /forces this filter OFF/);
assert.strictEqual(summary.ways.KICK.eqCount, 1);
assert.strictEqual(summary.ways.KICK.eqFilters[0].name, 'kick_peq');
assert.strictEqual(summary.ways.MID_L.eqCount, 1);
assert.strictEqual(summary.ways.MID_R.eqCount, 1);
assert.strictEqual(summary.counts.outputEqUnique, 2, 'shared MID PEQ should count once in unique output EQ total');
assert.match(summary.id, /^[A-F0-9]{12}$/);
assert.strictEqual(summary.id, processingFingerprint(config));

const baselineRouting = summarizeBaseline(config, { measurementInput: null });
assert.strictEqual(baselineRouting.sharedInputMirrored, false);
assert.strictEqual(baselineRouting.measurementInputMode, 'baseline-routing');

console.log('OK:   Measurement Batch baseline processing provenance');
