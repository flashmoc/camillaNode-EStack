'use strict';

const assert = require('assert');
const model = require('../server/measurementBatchModel');
require('../server/measurementBatchInputRouting')(model);

const gain = value => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted: false, mute: false } });
const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
const xo = (type, freq, order = 4) => ({ type: 'BiquadCombo', parameters: { type, freq, order } });

function fixture(inputCount = 8) {
    return {
        devices: {
            samplerate: 48000,
            capture: { type: 'Alsa', channels: inputCount, device: 'estack_capture' },
            playback: { type: 'Alsa', channels: 8, device: 'hw:fixture' }
        },
        filters: {
            sub_hpf: xo('ButterworthHighpass', 40), sub_lpf: xo('LinkwitzRileyLowpass', 130), sub_gain: gain(-9.5), sub_delay: delay(0),
            kick_hpf: xo('LinkwitzRileyHighpass', 130), kick_lpf: xo('LinkwitzRileyLowpass', 300), kick_gain: gain(-19.3), kick_delay: delay(0),
            mid_hpf: xo('LinkwitzRileyHighpass', 300), mid_lpf: xo('LinkwitzRileyLowpass', 2000), mid_l_gain: gain(-14), mid_l_delay: delay(2.76), mid_r_gain: gain(-14), mid_r_delay: delay(2.76),
            high_hpf: xo('LinkwitzRileyHighpass', 2000), high_l_gain: gain(-7.6), high_l_delay: delay(2.72), high_r_gain: gain(-7.6), high_r_delay: delay(2.72)
        },
        mixers: {
            estack: {
                description: 'normal stereo routing',
                channels: { in: inputCount, out: 8 },
                mapping: [0, 1, 2, 3, 4, 5].map(dest => ({
                    dest,
                    sources: [{ channel: dest % 2, gain: dest < 2 ? -6.0206 : 0, scale: 'dB', inverted: false }]
                }))
            }
        },
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
const batch = model.normalizeBatch({
    schema: 'estack.measurement-batch',
    version: 1,
    name: 'IN4 routing test',
    defaults: { measurementInput: 4, muteUnlisted: true },
    steps: [{ id: 'M01', activeWays: ['KICK', 'MID_L'] }]
});
assert.strictEqual(batch.defaults.measurementInput, 4, 'physical input was lost during normalization');

const applied = model.applyStep(baseline, batch, 0);
for (let dest = 0; dest <= 5; dest += 1) {
    const mapping = applied.mixers.estack.mapping.find(item => Number(item.dest) === dest);
    assert.ok(mapping, `missing OUT${dest + 1} mapping`);
    assert.strictEqual(mapping.sources.length, 1);
    assert.strictEqual(mapping.sources[0].channel, 3, `OUT${dest + 1} did not use physical IN4 / channel 3`);
    assert.strictEqual(mapping.sources[0].gain, 0);
    assert.strictEqual(mapping.sources[0].scale, 'dB');
    assert.strictEqual(mapping.sources[0].inverted, false);
    assert.strictEqual(mapping.mute, false);
}
assert.strictEqual(baseline.mixers.estack.mapping[0].sources[0].channel, 0, 'baseline mixer was mutated');
assert.strictEqual(applied.filters.kick_gain.parameters.mute, false);
assert.strictEqual(applied.filters.mid_l_gain.parameters.mute, false);
assert.strictEqual(applied.filters.sub_gain.parameters.mute, true);

const processing = model.processingOf(applied);
assert.ok(processing.mixers?.estack, 'batch processing snapshot does not own temporary mixer routing');

const live = fixture();
live.devices.capture.device = 'live-capture-must-survive';
live.mixers.estack.description = 'live mixer should be replaced during batch';
const merged = model.mergeProcessingIntoLive(live, applied);
assert.strictEqual(merged.devices.capture.device, 'live-capture-must-survive', 'batch overwrote live hardware devices');
assert.strictEqual(merged.mixers.estack.description, applied.mixers.estack.description, 'temporary measurement mixer routing was not applied');
assert.ok(model.sameProcessing(merged, applied), 'mixer-aware processing verification failed');

const noOverride = model.applyStep(baseline, {
    version: 1,
    name: 'baseline routing',
    steps: [{ activeWays: ['KICK'] }]
}, 0);
assert.deepStrictEqual(noOverride.mixers, baseline.mixers, 'batch without measurementInput altered baseline mixer routing');

assert.throws(() => model.normalizeBatch({
    version: 1,
    name: 'invalid physical input',
    defaults: { measurementInput: 9 },
    steps: [{ activeWays: ['KICK'] }]
}), /measurementInput/);

assert.throws(() => model.applyStep(fixture(2), {
    version: 1,
    name: 'unavailable physical input',
    defaults: { measurementInput: 4 },
    steps: [{ activeWays: ['KICK'] }]
}, 0), /IN4 is unavailable/);

console.log('OK:   Measurement Batch physical input routing');
