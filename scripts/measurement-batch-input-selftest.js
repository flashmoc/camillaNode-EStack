'use strict';

const assert = require('assert');
const model = require('../server/measurementBatchModel');
require('../server/measurementBatchInputRouting')(model);

const gain = value => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted: false, mute: false } });
const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
const xo = (type, freq, order = 4) => ({ type: 'BiquadCombo', parameters: { type, freq, order } });
const peq = (freq, gainDb, q) => ({ type: 'Biquad', parameters: { type: 'Peaking', freq, gain: gainDb, q } });
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(inputCount = 8) {
    return {
        devices: {
            samplerate: 48000,
            capture: { type: 'Alsa', channels: inputCount, device: 'estack_capture' },
            playback: { type: 'Alsa', channels: 8, device: 'hw:fixture' }
        },
        filters: {
            GLOBAL_EQ_162: peq(162, -4, 0.7),
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
            { type: 'Filter', channels: [0, 1], names: ['GLOBAL_EQ_162'] },
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
    assert.strictEqual(mapping.sources[0].gain, 0, `OUT${dest + 1} measurement source is not unity gain`);
    assert.strictEqual(mapping.sources[0].scale, 'dB');
    assert.strictEqual(mapping.sources[0].inverted, false);
    assert.ok(!Object.prototype.hasOwnProperty.call(mapping, 'mute'), 'non-canonical mapping-level mute leaked into CamillaDSP config');
}

// Shared normal Input L/R processing must also process the dedicated REW input.
const sharedInputStage = applied.pipeline.find(step => step?.type === 'Filter' && step.names?.includes('GLOBAL_EQ_162'));
assert.deepStrictEqual(sharedInputStage.channels, [0, 1, 3], 'IN4 did not inherit shared Input L/R processing');
assert.deepStrictEqual(baseline.pipeline[0].channels, [0, 1], 'baseline input processing was mutated');

assert.strictEqual(baseline.mixers.estack.mapping[0].sources[0].gain, -6.0206);
assert.strictEqual(baseline.mixers.estack.mapping[1].sources[0].gain, -6.0206);
assert.strictEqual(applied.mixers.estack.mapping[0].sources[0].gain, 0);
assert.strictEqual(applied.mixers.estack.mapping[1].sources[0].gain, 0);

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

// Simulate CamillaDSP returning a semantically equivalent mixer while omitting
// explicit default values and descriptive metadata. Verification must compare
// the actual routing, not serialization trivia.
const roundTrip = clone(applied);
delete roundTrip.mixers.estack.description;
for (const mapping of roundTrip.mixers.estack.mapping) {
    for (const source of mapping.sources) {
        if (source.gain === 0) delete source.gain;
        if (source.scale === 'dB') delete source.scale;
        if (source.inverted === false) delete source.inverted;
    }
}
assert.ok(model.sameProcessing(roundTrip, applied), 'semantic CamillaDSP mixer roundtrip was rejected');
roundTrip.mixers.estack.mapping[0].sources[0].channel = 7;
assert.ok(!model.sameProcessing(roundTrip, applied), 'real mixer routing mismatch was not detected');

const noOverride = model.applyStep(baseline, {
    version: 1,
    name: 'baseline routing',
    steps: [{ activeWays: ['KICK'] }]
}, 0);
assert.deepStrictEqual(noOverride.mixers, baseline.mixers, 'batch without measurementInput altered baseline mixer routing');
assert.deepStrictEqual(noOverride.pipeline[0].channels, [0, 1], 'baseline input stage changed without measurementInput');

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

console.log('OK:   Measurement Batch physical input routing + shared input processing');
