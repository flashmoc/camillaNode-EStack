'use strict';

const assert = require('assert');
const model = require('../server/measurementBatchModel');
require('../server/measurementBatchInputRouting')(model);

const gain = (value, inverted = false) => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted, mute: false } });
const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
const xo = (type, freq, order = 4) => ({ type: 'BiquadCombo', parameters: { type, freq, order } });

const baseline = {
    devices: {
        samplerate: 48000,
        capture: { type: 'Alsa', channels: 8, device: 'estack_capture' },
        playback: { type: 'Alsa', channels: 8, device: 'hw:test' }
    },
    filters: {
        GLOBAL_EQ_162: { type: 'Biquad', parameters: { type: 'Peaking', freq: 162, gain: -4, q: 0.7 } },
        ESTACK_LOUDNESS: {
            type: 'Loudness',
            description: 'E-Stack loudness · HOME',
            parameters: { fader: 'Aux1', reference_level: -10, high_boost: 2.5, low_boost: 6, attenuate_mid: false }
        },
        sub_hpf: xo('ButterworthHighpass', 40), sub_lpf: xo('LinkwitzRileyLowpass', 130), sub_gain: gain(-9.5), sub_delay: delay(0),
        kick_hpf: xo('LinkwitzRileyHighpass', 130), kick_lpf: xo('LinkwitzRileyLowpass', 300), kick_gain: gain(-19.3, true), kick_delay: delay(0),
        mid_hpf: xo('LinkwitzRileyHighpass', 300), mid_lpf: xo('LinkwitzRileyLowpass', 2000), mid_l_gain: gain(-14), mid_l_delay: delay(2.76), mid_r_gain: gain(-14), mid_r_delay: delay(2.76),
        high_hpf: xo('LinkwitzRileyHighpass', 2000), high_l_gain: gain(-7.6), high_l_delay: delay(2.72), high_r_gain: gain(-7.6), high_r_delay: delay(2.72)
    },
    mixers: {
        estack: {
            channels: { in: 8, out: 8 },
            mapping: [0, 1, 2, 3, 4, 5].map(dest => ({
                dest,
                sources: [{ channel: dest % 2, gain: dest < 2 ? -6.0206 : 0, scale: 'dB', inverted: false }]
            }))
        }
    },
    processors: {},
    pipeline: [
        { type: 'Filter', channels: [0, 1], names: ['GLOBAL_EQ_162'] },
        { type: 'Filter', channels: [0, 1], names: ['ESTACK_LOUDNESS'], description: 'E-Stack loudness input stage', bypassed: false },
        { type: 'Mixer', name: 'estack' },
        { type: 'Filter', channels: [0], names: ['sub_hpf', 'sub_lpf', 'sub_gain', 'sub_delay'] },
        { type: 'Filter', channels: [1], names: ['kick_hpf', 'kick_lpf', 'kick_gain', 'kick_delay'] },
        { type: 'Filter', channels: [2], names: ['mid_hpf', 'mid_lpf', 'mid_l_gain', 'mid_l_delay'] },
        { type: 'Filter', channels: [3], names: ['mid_hpf', 'mid_lpf', 'mid_r_gain', 'mid_r_delay'] },
        { type: 'Filter', channels: [4], names: ['high_hpf', 'high_l_gain', 'high_l_delay'] },
        { type: 'Filter', channels: [5], names: ['high_hpf', 'high_r_gain', 'high_r_delay'] }
    ]
};

const batch = {
    schema: 'estack.measurement-batch',
    version: 1,
    name: 'Loudness measurement invariant',
    defaults: { measurementInput: 4, muteUnlisted: true },
    steps: [{ id: 'M01', activeWays: ['KICK', 'MID_L'] }]
};

const applied = model.applyStep(baseline, batch, 0);

assert.ok(baseline.filters.ESTACK_LOUDNESS, 'fixture baseline lost loudness');
assert.ok(baseline.pipeline.some(step => (step.names || []).includes('ESTACK_LOUDNESS')), 'fixture baseline loudness stage missing');
assert.ok(!applied.filters.ESTACK_LOUDNESS, 'Measurement Batch retained ESTACK_LOUDNESS filter');
assert.ok(!applied.pipeline.some(step => (step.names || []).includes('ESTACK_LOUDNESS')), 'Measurement Batch retained loudness pipeline stage');

const globalStage = applied.pipeline.find(step => (step.names || []).includes('GLOBAL_EQ_162'));
assert.deepStrictEqual(globalStage.channels, [0, 1, 3], 'shared Input/Global PEQ was not inherited by physical IN4');
assert.ok(!globalStage.names.includes('ESTACK_LOUDNESS'), 'loudness was mirrored into the measurement input chain');

assert.strictEqual(applied.filters.kick_gain.parameters.mute, false);
assert.strictEqual(applied.filters.mid_l_gain.parameters.mute, false);
assert.strictEqual(applied.filters.sub_gain.parameters.mute, true);
assert.strictEqual(baseline.filters.kick_gain.parameters.mute, false, 'baseline was mutated');
assert.ok(baseline.filters.ESTACK_LOUDNESS, 'baseline loudness must remain available for finish/abort restore');

console.log('OK:   Measurement Batch forces E-Stack Loudness OFF while preserving baseline restore state');
