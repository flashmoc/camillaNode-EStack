'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const model = require('../server/measurementBatchModel');
require('../server/measurementBatchInputRouting')(model);

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/html/basic.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/src/estackControlInputPreamp.js'), 'utf8');

assert.ok(html.includes('/src/estackControlInputPreamp.js'), 'Control page does not load Input Preamp logic');
assert.ok(html.includes('/css/estackControlInputPreamp.css'), 'Control page does not load Input Preamp styling');
assert.ok(js.includes("const FILTER = 'ESTACK_INPUT_PREAMP'"), 'Input Preamp has no stable DSP filter identity');
assert.ok(js.includes('const MAX_DB = 12'), 'Input Preamp maximum is not guarded at +12 dB');
assert.ok(js.includes('const AUTO_RESERVE_DB = 1.0'), 'automatic headroom action must preserve a protection reserve');
assert.ok(js.includes('fingerprintWithoutPreamp'), 'Input Preamp update does not guard unrelated DSP processing');
assert.ok(js.includes("SetVolume: safeMaster"), 'Input Preamp config transition is not temporarily attenuated');
assert.ok(js.includes('measurementBatchActive()'), 'Input Preamp is not locked during Measurement Batch');
assert.ok(js.includes("devices?.capture?.type === 'SignalGenerator'"), 'Input Preamp is not locked during Signal Generator');
assert.ok(js.includes('window.estackResetHeadroomHold?.()'), 'headroom peak hold is not reset after Input Preamp changes');

const gain = value => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted: false, mute: false } });
const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
const xo = (type, freq) => ({ type: 'BiquadCombo', parameters: { type, freq, order: 4 } });
const peq = (freq, gainDb, q) => ({ type: 'Biquad', parameters: { type: 'Peaking', freq, gain: gainDb, q } });

function fixture() {
    return {
        devices: {
            samplerate: 48000,
            capture: { type: 'Alsa', channels: 8, device: 'fixture' },
            playback: { type: 'Alsa', channels: 8, device: 'fixture' }
        },
        filters: {
            ESTACK_INPUT_PREAMP: gain(5),
            GLOBAL_EQ_162: peq(162, -4, 0.7),
            sub_hpf: xo('ButterworthHighpass', 40), sub_lpf: xo('LinkwitzRileyLowpass', 130), sub_gain: gain(-1.9), sub_delay: delay(0),
            kick_hpf: xo('LinkwitzRileyHighpass', 130), kick_lpf: xo('LinkwitzRileyLowpass', 300), kick_gain: gain(-11.7), kick_delay: delay(0),
            mid_hpf: xo('LinkwitzRileyHighpass', 300), mid_lpf: xo('LinkwitzRileyLowpass', 2000), mid_l_gain: gain(-6.4), mid_l_delay: delay(2.76), mid_r_gain: gain(-6.4), mid_r_delay: delay(2.76),
            high_hpf: xo('LinkwitzRileyHighpass', 2000), high_l_gain: gain(0), high_l_delay: delay(2.72), high_r_gain: gain(0), high_r_delay: delay(2.72)
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
            { type: 'Filter', channels: [0, 1], names: ['ESTACK_INPUT_PREAMP'], description: 'E-Stack input preamp' },
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
const applied = model.applyStep(baseline, {
    schema: 'estack.measurement-batch',
    version: 1,
    name: 'Preamp measurement invariant',
    defaults: { measurementInput: 4, muteUnlisted: true },
    steps: [{ id: 'M01', activeWays: ['KICK', 'MID_L'] }]
}, 0);

assert.ok(baseline.filters.ESTACK_INPUT_PREAMP, 'fixture baseline lost listening preamp');
assert.ok(!applied.filters.ESTACK_INPUT_PREAMP, 'Measurement Batch did not force Input Preamp OFF');
assert.ok(!(applied.pipeline || []).some(step => (step.names || []).includes('ESTACK_INPUT_PREAMP')), 'Measurement Batch pipeline still references Input Preamp');
const globalStage = applied.pipeline.find(step => (step.names || []).includes('GLOBAL_EQ_162'));
assert.deepStrictEqual(globalStage.channels, [0, 1, 3], 'shared Global EQ was not mirrored to IN4 after preamp removal');
assert.ok(!globalStage.names.includes('ESTACK_INPUT_PREAMP'), 'listening preamp leaked into dedicated measurement input chain');
assert.ok(baseline.pipeline[0].names.includes('ESTACK_INPUT_PREAMP'), 'captured baseline was mutated while building measurement state');

console.log('OK:   Control Input Preamp + Measurement Batch forced-off invariant');
