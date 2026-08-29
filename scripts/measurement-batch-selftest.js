'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const model = require('../server/measurementBatchModel');

const ROOT = path.resolve(__dirname, '..');

function syntax(relative) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, relative)], { stdio: 'pipe' });
}

for (const file of [
    'server/measurementBatchModel.js',
    'server/measurementBatch.js',
    'public/src/estackMeasurementBatch.js'
]) syntax(file);

for (const file of [
    'public/html/measurement-batch.html',
    'public/css/estackMeasurementBatch.css',
    'examples/measurement-batch-kick-mid.example.json'
]) assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);

const indexSource = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
assert.ok(indexSource.includes("app.get('/measurement-batch'"), 'missing Measurement Batch route');
assert.ok(indexSource.includes("require('./server/measurementBatch')"), 'missing Measurement Batch backend registration');
const mainSource = fs.readFileSync(path.join(ROOT, 'public/html/main.html'), 'utf8');
assert.ok(mainSource.includes('target="/measurement-batch"'), 'missing Measurement Batch navigation');

function fixture() {
    const gain = (value, inverted = false) => ({ type: 'Gain', parameters: { gain: value, scale: 'dB', inverted, mute: false } });
    const delay = value => ({ type: 'Delay', parameters: { delay: value, unit: 'ms', subsample: false } });
    const xo = (type, freq, order = 4) => ({ type: 'BiquadCombo', parameters: { type, freq, order } });
    return {
        title: 'fixture',
        devices: {
            samplerate: 48000,
            chunksize: 512,
            capture: { type: 'Alsa', channels: 8, device: 'estack_capture' },
            playback: { type: 'Alsa', channels: 8, device: 'hw:fixture' }
        },
        filters: {
            GLOBAL_EQ: { type: 'Biquad', parameters: { type: 'Peaking', freq: 162, gain: -4, q: 0.7 } },
            ESTACK_LOUDNESS: { type: 'Loudness', parameters: { fader: 'Aux1', reference_level: -10, low_boost: 6, high_boost: 2.5, attenuate_mid: false } },
            sub_hpf: xo('ButterworthHighpass', 40), sub_lpf: xo('LinkwitzRileyLowpass', 130), sub_gain: gain(-9.5), sub_delay: delay(0),
            kick_hpf: xo('LinkwitzRileyHighpass', 130), kick_lpf: xo('LinkwitzRileyLowpass', 300), kick_gain: gain(-19.3, true), kick_delay: delay(0),
            mid_hpf: xo('LinkwitzRileyHighpass', 300), mid_lpf: xo('LinkwitzRileyLowpass', 2000), mid_l_gain: gain(-14), mid_l_delay: delay(2.76), mid_r_gain: gain(-14), mid_r_delay: delay(2.76),
            high_hpf: xo('LinkwitzRileyHighpass', 2000), high_l_gain: gain(-7.6), high_l_delay: delay(2.72), high_r_gain: gain(-7.6), high_r_delay: delay(2.72),
            sub_limit: { type: 'Limiter', parameters: { clip_limit: -13.5 } },
            kick_limit: { type: 'Limiter', parameters: { clip_limit: -16.7 } }
        },
        mixers: {
            estack: { channels: { in: 8, out: 8 }, mapping: [{ dest: 0, sources: [{ channel: 0 }] }] }
        },
        processors: { protection: { type: 'Compressor', parameters: { channels: 8 } } },
        pipeline: [
            { type: 'Filter', channels: [0, 1], names: ['GLOBAL_EQ'] },
            { type: 'Filter', channels: [0, 1], names: ['ESTACK_LOUDNESS'], description: 'E-Stack loudness input stage' },
            { type: 'Mixer', name: 'estack' },
            { type: 'Filter', channels: [0], names: ['sub_hpf', 'sub_lpf', 'sub_gain', 'sub_delay'] },
            { type: 'Filter', channels: [1], names: ['kick_hpf', 'kick_lpf', 'kick_gain', 'kick_delay'] },
            { type: 'Filter', channels: [2], names: ['mid_hpf', 'mid_lpf', 'mid_l_gain', 'mid_l_delay'] },
            { type: 'Filter', channels: [3], names: ['mid_hpf', 'mid_lpf', 'mid_r_gain', 'mid_r_delay'] },
            { type: 'Filter', channels: [4], names: ['high_hpf', 'high_l_gain', 'high_l_delay'] },
            { type: 'Filter', channels: [5], names: ['high_hpf', 'high_r_gain', 'high_r_delay'] },
            { type: 'Processor', name: 'protection' },
            { type: 'Filter', channels: [0], names: ['sub_limit'] },
            { type: 'Filter', channels: [1], names: ['kick_limit'] }
        ]
    };
}

const baseline = fixture();
const batch = model.normalizeBatch({
    version: 1,
    name: 'self test',
    defaults: { muteUnlisted: true, settleMs: 500, disabledFilters: ['GLOBAL_EQ'] },
    steps: [{
        id: 'M01',
        name: 'KICK + MID L',
        activeWays: ['KICK', 'MID L'],
        ways: { MID_L: { delayOffsetMs: 0.5, polarity: 'inverted', gainOffsetDb: -1 } },
        crossovers: {
            KICK: { lpf: { freqHz: 275, family: 'LinkwitzRiley', order: 4 } },
            MID_L: { hpf: { freqHz: 275, family: 'LinkwitzRiley', order: 4 } }
        },
        rew: { measurementName: 'M01_KICK_MID', startHz: 120, endHz: 1200, levelDbfs: -20, timingReference: true }
    }]
});

const applied = model.applyStep(baseline, batch, 0);
assert.strictEqual(applied.filters.sub_gain.parameters.mute, true);
assert.strictEqual(applied.filters.kick_gain.parameters.mute, false);
assert.strictEqual(applied.filters.mid_l_gain.parameters.mute, false);
assert.strictEqual(applied.filters.mid_r_gain.parameters.mute, true);
assert.strictEqual(applied.filters.high_l_gain.parameters.mute, true);
assert.strictEqual(applied.filters.mid_l_delay.parameters.delay, 3.26);
assert.strictEqual(applied.filters.mid_l_gain.parameters.inverted, true);
assert.strictEqual(applied.filters.mid_l_gain.parameters.gain, -15);
assert.strictEqual(applied.filters.kick_lpf.parameters.freq, 275);
assert.strictEqual(applied.filters.mid_hpf.parameters.freq, 275);
assert.ok(!applied.pipeline.some(step => (step.names || []).includes('GLOBAL_EQ')));
assert.ok(applied.pipeline.some(step => (step.names || []).includes('ESTACK_LOUDNESS')));
assert.deepStrictEqual(applied.processors, baseline.processors);
assert.strictEqual(baseline.filters.mid_l_delay.parameters.delay, 2.76, 'baseline mutated');
assert.strictEqual(baseline.filters.sub_gain.parameters.mute, false, 'baseline mute mutated');

assert.throws(() => model.normalizeBatch({
    version: 1,
    name: 'unsafe gain',
    steps: [{ id: 'M01', activeWays: ['KICK'], ways: { KICK: { gainOffsetDb: 1 } } }]
}), /gainOffsetDb/);

assert.throws(() => model.applyStep(baseline, {
    version: 1,
    name: 'unsafe filter bypass',
    defaults: { disabledFilters: ['kick_gain'] },
    steps: [{ id: 'M01', activeWays: ['KICK'] }]
}, 0), /pre-routing\/input processing/);

assert.throws(() => model.applyStep(baseline, {
    version: 1,
    name: 'wide crossover',
    steps: [{ id: 'M01', activeWays: ['KICK'], crossovers: { KICK: { lpfHz: 50 } } }]
}, 0), /guarded range/);

assert.throws(() => model.applyStep(baseline, {
    version: 1,
    name: 'shared conflict',
    steps: [{
        id: 'M01',
        activeWays: ['MID_L', 'MID_R'],
        crossovers: { MID_L: { hpfHz: 275 }, MID_R: { hpfHz: 325 } }
    }]
}, 0), /Conflicting crossover overrides/);

const changedLive = fixture();
changedLive.devices.chunksize = 1024;
changedLive.mixers.estack.description = 'live routing metadata';
const merged = model.mergeProcessingIntoLive(changedLive, applied);
assert.strictEqual(merged.devices.chunksize, 1024, 'live devices were overwritten');
assert.strictEqual(merged.mixers.estack.description, 'live routing metadata', 'live mixer was overwritten');
assert.ok(model.sameProcessing(merged, applied), 'processing merge mismatch');

console.log('OK:   Measurement Batch syntax and safety model');
