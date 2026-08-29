'use strict';

const assert = require('assert');
const model = require('../server/measurementBatchModel');

const gain = (value, inverted = false) => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted, mute: false } });
const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
const xo = (type, freq, order = 4) => ({ type: 'BiquadCombo', parameters: { type, freq, order } });

function fixture() {
    return {
        devices: { samplerate: 48000 },
        filters: {
            sub_hpf: xo('ButterworthHighpass', 40), sub_lpf: xo('LinkwitzRileyLowpass', 130), sub_gain: gain(-9.5), sub_delay: delay(0),
            kick_hpf: xo('LinkwitzRileyHighpass', 130), kick_lpf: xo('LinkwitzRileyLowpass', 300), kick_gain: gain(-19.3, true), kick_delay: delay(0),
            mid_hpf: xo('LinkwitzRileyHighpass', 300), mid_lpf: xo('LinkwitzRileyLowpass', 2000), mid_l_gain: gain(-14), mid_l_delay: delay(2.76), mid_r_gain: gain(-14), mid_r_delay: delay(2.76),
            high_hpf: xo('LinkwitzRileyHighpass', 2000), high_l_gain: gain(-7.6), high_l_delay: delay(2.72), high_r_gain: gain(-7.6), high_r_delay: delay(2.72)
        },
        mixers: { estack: { channels: { in: 8, out: 8 }, mapping: [] } },
        processors: {},
        pipeline: [
            { type: 'Mixer', name: 'estack' },
            { type: 'Filter', channels: [0], names: ['sub_hpf', 'sub_lpf', 'sub_gain', 'sub_delay'] },
            { type: 'Filter', channels: [1], names: ['kick_hpf', 'kick_lpf', 'kick_gain', 'kick_delay'] },
            { type: 'Filter', channels: [2], names: ['mid_hpf', 'mid_lpf', 'mid_l_gain', 'mid_l_delay'] },
            { type: 'Filter', channels: [3], names: ['mid_hpf', 'mid_lpf', 'mid_r_gain', 'mid_r_delay'] },
            { type: 'Filter', channels: [4], names: ['high_hpf', 'high_l_gain', 'high_l_delay'] },
            { type: 'Filter', channels: [5], names: ['high_hpf', 'high_r_gain', 'high_r_delay'] }
        ]
    };
}

const baseline = fixture();
const phaseBatch = {
    version: 1,
    name: 'phase test',
    steps: [{
        id: 'M01',
        activeWays: ['KICK', 'MID_L'],
        ways: { MID_L: { phase: { degrees: -45, reference: 'hpf' } } },
        crossovers: {
            KICK: { lpfHz: 275 },
            MID_L: { hpfHz: 275 }
        }
    }]
};

const applied = model.applyStep(baseline, phaseBatch, 0);
const phase = applied.filters.ESTACK_PHASE_CH2;
assert.ok(phase, 'MID L phase filter was not created');
assert.strictEqual(phase.type, 'Biquad');
assert.strictEqual(phase.parameters.type, 'AllpassFO');
assert.ok(phase.description.includes('-45.0 deg @ 275.0 Hz'), 'phase did not use the step HPF as reference');
assert.ok(Number.isFinite(phase.parameters.freq) && phase.parameters.freq > 0, 'all-pass design frequency is invalid');
const midStage = applied.pipeline.find(step => Array.isArray(step.channels) && step.channels.length === 1 && step.channels[0] === 2);
assert.ok(midStage.names.indexOf('ESTACK_PHASE_CH2') >= 0, 'phase filter is not attached to MID L');
assert.ok(midStage.names.indexOf('ESTACK_PHASE_CH2') < midStage.names.indexOf('mid_l_gain'), 'phase filter must be before output Gain');
assert.strictEqual(baseline.filters.ESTACK_PHASE_CH2, undefined, 'baseline was mutated');

const fixedReference = model.applyStep(baseline, {
    version: 1,
    name: 'fixed phase reference',
    steps: [{ activeWays: ['KICK'], ways: { KICK: { phase: { degrees: -60, referenceHz: 300 } } } }]
}, 0);
assert.ok(fixedReference.filters.ESTACK_PHASE_CH1.description.includes('@ 300.0 Hz'));

const zero = model.applyStep(applied, {
    version: 1,
    name: 'phase zero',
    steps: [{ activeWays: ['MID_L'], ways: { MID_L: { phase: 0 } } }]
}, 0);
assert.strictEqual(zero.filters.ESTACK_PHASE_CH2, undefined, '0 degrees must remove the E-Stack phase filter');
assert.ok(!zero.pipeline.some(step => (step.names || []).includes('ESTACK_PHASE_CH2')), '0 degrees left phase in pipeline');

assert.throws(() => model.normalizeBatch({
    version: 1,
    name: 'invalid phase',
    steps: [{ activeWays: ['MID_L'], ways: { MID_L: { phase: { degrees: -45, reference: 'hpf', referenceHz: 300 } } } }]
}), /both reference and referenceHz/);

console.log('OK:   Measurement Batch phase all-pass model');
